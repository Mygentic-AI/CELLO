---
name: 008-RELAY — An agent cannot flood a relay's reservation slots
type: micro-work-order
date: 2026-09-01
status: open
description: >
  A relay grants circuit reservation slots to anyone holding any keypair, and counts nothing. Mint
  keys and take the table; or, once that is closed, open thousands of sessions between two agents you
  own and take it anyway. Gate slots on a directory-issued token bound to the agent key, then account
  for slots per agent and per identity pair. Extracted from 003-RELAY, which carries the decision.
---

# **<ins>MICRO</ins>** WORK ORDER 008-RELAY — An agent cannot flood the reservation slots

> ## THE RULES OF A MICRO WORK ORDER
>
> 1. **This file is the whole world.** Do not read or write `M15-DEFINITION-OF-DONE.md`,
>    `M15-BUILD-JOURNAL.md`, or any other milestone document. Everything you need is here.
> 2. **MICRO means small.** One mission. Follow it to its end. **Never grow the mission.**
> 3. **Found something else?** Write it under *Newly discovered* at the foot of this file and
>    **keep going**. Do not fix it. Do not open a line for it. Do not investigate it.
> 4. **500 lines, hard cap.** If this file is growing, you are writing detail nobody needs.
>    Minimal without omitting anything. No scratchpad. No narration of what you tried.
> 5. **Standard procedure still applies:** implement → review (`cello-unit-reviewer`) → fix every
>    finding → commit. Commit per fix, push after every commit.
> 6. **Done is done.** When the Definition of Done below is met, stop. Do not look for more.

> ⚠️ **This one is NOT relay-only.** It changes the directory (issue the token), the client (present
> it, refresh it, re-present assignments on reconnect) and the relay (verify, count, reap). Bilateral
> order applies: the relay must accept every new shape before any client depends on it.

---

## The problem, plainly

A relay holds 4096 circuit reservation slots — the standing invitations that make an agent behind NAT
reachable at all. **It grants them to anyone who asks and counts nothing.**

Generating a keypair is free, and the only test to keep a slot is signing a challenge, which proves
you hold *a* key and nothing more. So mint 4096 keys, take every slot, and no real agent can be
reached by anyone. Close that, and a second door is still open: nothing bounds how many sessions two
agents may hold, so open 4096 sessions between two agents you own, put one message down each, and
take the table again.

**What that costs an operator:** their agent comes up, reports itself online, and is reachable by
nobody. The relay looks healthy. Nothing in the logs says an attack happened, because every
individual request was well-formed and legitimate.

> **The 4096 ceiling is ours, not a default.** libp2p ships 15, which caused a real outage — fifteen
> slots vanish immediately in normal use, because every agent needs one and every daemon restart
> mints a fresh peer id that takes a NEW slot instead of reusing its own. Raising it fixed that
> outage and is not to be reverted. It also means the ceiling is a number we chose and may revisit.

---

## Part 1 — the token: only registered agents get slots

Note: 002-RELAY's "the relay does not query the directory" is a preference for keeping that unit
focused, not a prohibition — the relay already talks to the directory for several things. Prefer not
to, but it's fine where it helps.

**What this rests on: the directory already knows you started, one step before you need it to.**
Startup order is — daemon opens a persistent signaling stream to the directory → directory
authenticates it and marks the agent **online** → *then* the standing receiver asks a relay for a
slot. The fact the relay is missing is established before the relay is contacted.

**The proposal.** When it marks an agent online, the directory issues a short-lived signed token:
*this public key is a registered agent, valid until T*. The client presents it when asking for a
slot. The relay verifies one signature against directory keys it already holds.

| | Real agent | Attacker's throwaway key |
|---|---|---|
| 1. Open signaling stream | directory authenticates it | no registration to authenticate |
| 2. Directory issues token | gets one | **stops here — cannot obtain one** |
| 3. Present token for a slot | relay verifies signature, grants | nothing to present |

**Why it beats the others:**
- **vs. option 1:** an assignment only exists after a session, so a brand-new agent has none — a
  chicken-and-egg at exactly the wrong moment. A token is issued at *start*.
- **vs. option 2b:** no capped pool, so no first-run agent is the one that degrades.
- **vs. the relay asking the directory per reservation:** no round-trip on the reservation path, so
  a relay that cannot reach a directory need not choose between refusing everyone and failing open.

**Why it stops the attack:** minting 4096 keypairs takes seconds. Minting 4096 *registered agents*
does not — registration is email-gated and involves a threshold ceremony.

**Two requirements, NOT open questions — without either, this check has no teeth:**

1. **The token must name the pubkey, and the relay must check it against the key doing the
   challenge-response.** A token that only says "some registered agent" is a bearer pass: lift one
   from anywhere — a log, a shared machine, a modified peer — and present it with your own throwaway
   key. Binding it to the key means a stolen token is useless without the private key it names, which
   the existing challenge-response already proves.
2. **A relay with no directory public key configured must REFUSE, not wave callers through.** This is
   how a check like this quietly becomes decorative: a misconfigured relay cannot verify anything,
   the natural default is to allow, and the flood works exactly as if the feature had never shipped.
   Verification is not optional at the composition root.

Neither is about the signature verification itself — the relay is already configured with the
directory pubkey and the consortium set, and already verifies directory signatures on admin frames
and on session assignments. The token rides existing machinery. A modified daemon can present
anything, but cannot produce a valid signature over its own key without the directory's private key.

**Answered 2026-09-01 — these were listed as open questions and mostly were not.** None blocks the
design:

- **Lifetime:** short, on the order of an hour, refreshed over the signaling stream the daemon
  already holds open to the directory. No new channel.
- **Which directory issues it:** the one you are connected to. The relay already accepts signatures
  from any node in the consortium set, so it does not matter which.
- **Revocation:** the short lifetime does the work. Only worth building if tokens were long-lived,
  and they should not be.
- **Unreachable directory:** fail closed. No token, no slot, so the agent is unreachable — but an
  agent that cannot reach a directory cannot be offered a session anyway, because offers arrive on
  that same stream. It is already unreachable for other reasons, so failing closed costs nothing.

## Part 2 — the token alone is NOT enough: slot accounting

The token stops **unregistered** keys from taking slots. It does not stop a **registered** agent
from taking too many, and that hole is wide: promoted slots were not going to be counted, and nothing
bounds how many sessions two agents may open. So open 4096 sessions between two agents you own, send
one message down each to make them active, and you hold the whole table without ever tripping a cap.

**The token is also what makes the rest of this possible.** Today the relay knows only transport peer
ids, and those change on every daemon restart — which is why a restart consumes a fresh slot instead
of reclaiming its old one. The relay cannot tell it is the same agent. Once a slot is attributable to
a directory-signed agent key, "this agent already holds an unused slot" and "this agent holds too
many" become answerable. Without it, they are not.

**1. Reuse or release an unused slot.** If an agent asks for a slot while already holding one that
has never carried traffic, release the old one and grant a new one — or reinitiate the existing one
if the transport permits. This is not only anti-abuse: it fixes an ordinary bug, since today every
daemon restart strands its previous slot for the full TTL.

**2. Audit every reason a session should close — this is the biggest piece.** Enumerate every way a
session ends, decide for each whether the relay is INFORMED or can DETECT it, and close on all of
them. Expect the finding to be that the relay is simply never told about most of them: a relay that
gated a dial but never witnessed the session sees no seal, so today only an idle timer frees it.

**3. Per-agent cap.** No agent may hold more than X slots on one relay. Bounds the session-factory
attack: at 32, filling a 4096 table needs ~128 registered agents, each email-gated.

**4. Tuple cap.** No more than a handful of concurrent sessions between the SAME two identities —
five at most. This is what makes the two-agents-you-own attack pointless, and no legitimate pair of
agents needs more.

**5. Reaper, then refusal — in that order.** As the table approaches full, close inactive slots early
rather than waiting out the TTL. Refuse only at the absolute ceiling.

> ⚠️ **Point 5's ordering is the safety property, not a nicety.** Every outage in this area came from
> refusing too eagerly, and the relay's view of what is "in use" is imperfect. Reaping first means a
> counting mistake costs an idle slot; refusing first means it costs a real agent its front door.
> When unsure whether a slot is in use, treat it as in use.

## 🔴 TWO NON-NEGOTIABLES — these govern everything else

**1. EVERY refusal names its cause, and that cause reaches the human and the LM.** Not a log line on
the relay. Not `relay_unavailable`. The reason must survive every hop back to the operator, so that
someone who runs `cello_use_agent` and gets rebuked learns *why* they were rebuked.

**And every refusal carries an affordance — what to DO about it — chosen for that specific cause.**
Refused because you already hold an unused standing receiver? Perhaps restart the daemon. Refused
because you have too many sessions open with one counterparty? Then say how many, and which, so they
can close some.

> **The reason this matters more here than it looks: people do not know what sessions they have
> open.** Sessions fall apart and sit there — idle, unreachable, still counted. Every cap on this
> list will therefore be hit by someone who believes they have nothing open. A refusal that does not
> show them the state it is refusing on is a dead end, and they will read it as the product being
> broken. Affordances are not polish here; they are what makes these caps usable at all.

**The reason must be MACHINE-readable as well as human-readable, because the daemon is the second
consumer.** We run several relays, and the daemon must fail over to another when refused — but *which
refusals justify that depends on the reason*, so it has to branch on a code, not parse prose:

| Refusal | Daemon's move |
|---|---|
| this relay's table is full | try another relay — correct |
| this relay has no directory key configured | it is broken; try another |
| token expired or invalid | **do not** try another — every relay refuses identically, and retrying makes a client problem look like a relay outage |
| you already hold too many slots here | another relay will grant it, but that papers over leaked sessions and it recurs on the next relay — surface it, do not silently spread |

The daemon already walks a candidate list and takes the first relay that grants. What is missing is
reacting differently by reason rather than simply moving on.

**2. The reaper NEVER touches a session with activity in the last SIX HOURS.** That is a floor, not a
tuning parameter. Under pressure the reaper takes the quietest slots first and stops at that line —
if everything is inside six hours, it refuses at the ceiling instead of reaping a live conversation.

**And a reaped party must be TOLD.** Silent teardown is how "my agent just stopped working" happens.
The notice says the session was closed to reclaim capacity, and what to do — reconnect, or start a
new session.

---

## Build checklist

**State the relay must hold per slot** — none of this exists today:
the agent's public key from the token (without this nothing else here is countable); whether traffic
has ever flowed and when it last did; whether an assignment naming this slot's node was presented;
granted-at time.

**Indexes:** slots per agent key; unused slots per agent key; concurrent sessions per identity pair;
total in use against the ceiling.

**Checks at slot-grant time:** token signature verifies against configured directory keys; token
names the same key completing the challenge-response; token not expired; **refuse outright if no
directory key is configured**; per-agent cap not exceeded; if the agent already holds an unused slot,
release or reuse it rather than granting a second.

**Check at session-record time:** tuple cap not exceeded for this identity pair.

**Every path that must free a slot:** session sealed; idle timeout fires; **client disconnects** —
today the slot is held for its full TTL regardless; agent re-reserves while holding an unused slot;
reaper fires under pressure; and every other way a session ends, which is what the audit in part 2 is
for.

**Caps, starting values:** unused slots per agent 1; total slots per agent per relay 32; concurrent
sessions per identity pair 5; reaper threshold some fraction of the ceiling; hard ceiling 4096,
refusing only there.

**Guards that must not be violated:** never refuse before reaping; never treat an ambiguous slot as
idle — when unsure, in use; never fail open when verification is impossible; never leave a slot
permanently exempt from counting, so every "in use" needs a demotion path.

**Client changes:** present the token when reserving; refresh it over the existing signaling stream;
**re-present the session assignment as part of reconnecting**, not as a reaction to a failed submit —
that is what removes the cold-start ambiguity after a relay restart.

**Directory change:** issue a short-lived token bound to the agent's public key when it marks the
agent online.

**Observability:** every refusal logged with reason and agent key; every reap logged with what was
freed and why; slot-table occupancy exposed with an alarm before the ceiling.

---

## Definition of Done

1. A slot request without a valid, unexpired, correctly-bound token is refused.
2. A slot request from a registered agent already at its per-agent cap is refused.
3. A session-record beyond the tuple cap for that identity pair is refused.
4. An agent asking for a slot while holding an unused one does not consume a second.
5. A relay with no directory public key configured refuses every slot request.
6. Under pressure the reaper frees inactive slots, and **never** one with activity inside six hours.
7. **Every refusal above reaches the operator with its cause AND an affordance** — asserted in a test
   that reads what the CLIENT surfaced, not what the relay logged.
8. A reaped party is told it happened and what to do about it.
9. The daemon fails over to another relay for relay-specific refusals, and does NOT for
   client-specific ones.
10. Tests cover every refusal and the happy path, and **each has been made to fail on purpose** —
    revert the fix, confirm it reddens, confirm it reddens for the reason you expect.
11. `pnpm run test`, `pnpm run lint`, `pnpm run typecheck` pass in both repos.
12. Reviewed by `cello-unit-reviewer`, every finding fixed, verdict quoted below.

**Not in scope:** the 24-hour session idle timer's value (settled, and a reclaimer not a conversation
timeout); the dial-through gate (002-RELAY, done); anything about who may DIAL an agent, which is a
different question from who may HOLD a slot.

---

## Traps recorded before you start

- **Refusing too eagerly is the failure mode here, not refusing too little.** Every outage in this
  area came from denying a legitimate agent its slot. Reap before you refuse; when unsure whether a
  slot is in use, treat it as in use.
- **A refusal that only reaches the relay's log does not exist.** See non-negotiable 1.
- **Bilateral order.** The relay must accept the token before any client sends one.
- **Do not weaken an existing assertion to make a new test pass.**

---

## Review

*(Reviewer verdict. One quote. Not a transcript.)*

---

## Newly discovered

*(One or two lines each. Do not act on them.)*
