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

## 🔴 REOPENED 2026-09-01 — the order was met to the letter and failed its intent

**The intent, and it governs everything below:** a malicious agent or a botnet cannot fill a relay's
reservation slots. Every clause in this order serves that sentence. A clause that passes while that
sentence is false has not been met.

**What shipped, and why it failed.** The relay verified the directory token on CELLO's own auth
stream — correctly, with honest tests for every refusal. But libp2p hands
`denyInboundRelayReservation` a peer id and nothing else: there is nowhere to carry a token, and the
client has not sent one yet, because the token rides a protocol that runs *after* the reservation. So
the slot was granted unconditionally and the credential checked afterwards. **An attacker who never
opens an auth stream never meets the check at all.** Reserve, hold for the grace window, reconnect —
one machine, and the whole table.

Two further attempts made it worse before they made it better, and both are recorded because the
mistake is the same each time: **compensating downstream for a gate that is not there.**

1. *Refusing past an unproven budget.* Once 512 unproven reservations existed, every new reservation
   was refused — including every honest agent's, since an agent's reservation is unproven at the
   instant it is made. Denying the whole relay went from needing 4096 slots to needing 512.
2. *Evicting the oldest instead.* An attacker's slots churn and stay young; an honest agent's sits
   still for one handshake, so it becomes the oldest thing in the table and is hung up mid-handshake.

Each fix was a heuristic about *who looks bad* rather than a check for *who is allowed*, and a
botnet walks through all of them, because the only thing they can see at reservation time is an IP
address.

## The design that meets the intent: authenticate, THEN reserve

The wall was never real. The relay cannot see a token at reservation time **only because the client
asks for the slot before presenting one.** Reverse that and the check becomes a gate:

1. Client dials the relay.
2. Client presents its directory-issued online token over `/cello/relay/1.0.0`.
3. Relay records that this transport peer belongs to a registered agent.
4. Client asks for the circuit reservation.
5. **The relay refuses any reservation from a peer that has not proven itself.**

**⚠️ THE OBVIOUS WAY TO DO STEP 4 DOES NOT WORK, and it was measured rather than reasoned.** Taking
the reservation by hand after authenticating — `reservationStore.addRelay(relayPeerId, "configured")`
— does get the slot, and libp2p then announces NO circuit address for it: its listener returns early
on a `configured` reservation and announces addresses only for ones its own relay-discovery made. The
agent would hold a slot nobody could dial through. Proven in
`core/transport/src/__tests__/dod-m15-relayslots-1-reserve-on-demand.test.ts`.

**So the client proves on one connection and reserves on another, keeping the same transport
identity, and the relay remembers the proof across the gap** (`#provenPeers`, two minutes — long
enough for one reconnect, short enough that it is not a standing licence).

**The cheapest way to arrange that, and the one to build (Andre, alpha, no users):** do not add a
prover node. Let the first attempt fail.

1. The receiver is built exactly as it is today, with its circuit listen address. The relay refuses
   it — nothing has proved anything yet.
2. It authenticates ANYWAY. Today the daemon only authenticates once it holds a reservation; that
   order flips.
3. The reservation watchdog already rebuilds a receiver that holds no reservation. Make that rebuild
   **reuse the transport seed** rather than minting a new one, so it returns as the identity the
   relay just vouched for.
4. The second attempt is granted.

Nothing new to reason about — the retry path exists and is tested — and revival gets the same
treatment for free, which the prover-node approach did not. The cost is that an agent is unreachable
for one retry cycle at first start. It self-heals, and with no users it costs nothing.

**One assumption to verify before building it:** that a refused reservation does not make libp2p
blacklist that relay for the retry. Review reported it does not; verify directly rather than
inheriting the claim, because the whole approach rests on it.

**What this costs an attacker.** Nothing they can do with IP addresses — no token, no slot, at the
door. To take slots at all they need registered agents, which are email-gated and involve a threshold
ceremony, and then the per-agent and tuple caps below apply. Filling 4096 slots needs roughly 128
registered agents instead of a few thousand addresses.

**What gets DELETED, because it exists only to compensate for the missing gate.** Leaving it would
be worse than not having written it — dead defence reads as defence:
- the per-source (IP) unproven reservation cap,
- the global unproven reservation budget,
- the eviction rule, its minimum-age floor and its overshoot multiple,
- the grace-window revoke timer for an unproven holder (nothing unproven can hold a reservation now).

**What stays, because it is still right:** the online token itself; the per-agent slot cap, which now
moves to reservation time where it belongs, since the relay knows *which agent* is asking before it
grants; the tuple cap; the reaper; and releasing the real libp2p reservation on every reclaim path.

**Risks, stated rather than discovered later:**
- **Bilateral order is now strict, and the note that used to sit here was dangerous.** It read
  "publish the client before deploying the relays", which sounds like sequencing code that exists.
  The client half did NOT exist — following that instruction literally would have published the
  transport, deployed the relays, and refused every agent permanently. **Neither half ships until the
  client actually proves before it reserves.**
- **No directory, no relay reachability.** An agent that cannot obtain a token gets no slot at all.
  That is fail-closed, which this order already chose, but it is a harder failure than before.
- A peer can still open connections without reserving. That is connection exhaustion, a different
  resource, and not this order's mission.

---

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

> ### 0. THE INTENT CLAUSE — checked FIRST, and it outranks every clause below it
>
> **With this shipped, a machine with no registered agent cannot hold a relay reservation slot, and
> a botnet with any number of addresses cannot either.** Asserted by a test that mints throwaway
> keys, floods, and measures **HOW MANY SLOTS THE ATTACKER ENDS UP HOLDING** — never how many
> refusals were logged.
>
> This clause exists because every clause below it passed while the headline was false. Each refusal
> was correct; the attacker held the whole table. **A test that counts refusals cannot see that.**
> If clause 0 fails, the order is not met however many of the rest are green.

1. A reservation request from a peer that has not presented a valid, unexpired, correctly-bound
   token is **refused at the reservation**, before any slot is granted.
2. A registered agent already at its per-agent cap is refused **at the reservation**, since the
   relay now knows which agent is asking before it grants.
3. A session-record beyond the tuple cap for that identity pair is refused.
4. A relay with no directory public key configured refuses every reservation.
5. Under pressure the reaper frees inactive slots, and **never** one with activity inside six hours.
6. Reclaiming a slot **actually returns the libp2p reservation**, not merely the relay's own
   bookkeeping — asserted against a real relay, because `hangUp` alone does not.
7. **Every refusal reaches the operator with its cause AND an affordance** — asserted in a test that
   reads what the CLIENT surfaced, not what the relay logged.
8. A reaped party is told it happened and what to do about it.
9. The daemon fails over to another relay for relay-specific refusals, and does NOT for
   client-specific ones.
10. The client authenticates BEFORE requesting a reservation, and a relay that refuses an unproven
    one is recoverable — the client obtains its slot on the next attempt, not never.
11. Tests cover every refusal and the happy path, and **each has been made to fail on purpose** —
    revert the fix, confirm it reddens, confirm it reddens for the reason you expect.
12. `pnpm run test`, `pnpm run lint`, `pnpm run typecheck` pass in both repos.
13. Reviewed by `cello-unit-reviewer`, every finding fixed, verdict quoted below.

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

## Revert proofs — Part 1 (the token)

Each mutation applied ALONE, compiled and linted before running (a mutant that fails the gate proves
nothing — the red came from the mutation, not from a broken build), then restored. `git diff` empty
afterwards, verified.

| Mutation | What reddened | Reason it gave |
|---|---|---|
| Relay: never act on the token refusal | 7 of 10 refusal tests; the 3 happy paths stayed green | `expected 'relay_auth_ok' to be 'relay_auth_failed'` |
| Relay: skip the token→challenge key comparison | exactly 1 — the lifted-token test | same, and only that one, so the binding is isolated by one assertion |
| Directory: issue a token without reading the profile | exactly 1 — the unregistered-key test | `expected Uint8Array[…] to be undefined` |
| Verifier: treat an empty directory key set as valid | 2 — the unit test AND the over-the-wire test | `expected { ok: true } to deeply equal { ok: false }` |
| Client: never attach the token to the auth frame | 2 of 3 | `expected null to be 'a5a5a5…'` |
| Client: snapshot the token at construction instead of reading it fresh | exactly 1 — the refresh test | `expected '1111…' to be '2222…'`, i.e. the mutation produces the real symptom (a stale token), not merely a failure |

The client's red was also captured before any implementation existed, as a typecheck failure naming
each missing API. **That needed a positive control to be worth anything:** the root typecheck first
reported exit 0 against a test calling methods that did not exist, because the file was outside the
daemon's typecheck allowlist. A deliberate `const x: number = "not a number"` in the same file also
reported exit 0 — which is what proved the gate could not see the file at all.

## Revert proofs — Part 2 (slot accounting)

Same discipline: one mutation at a time, typechecked and linted before running, then restored.
`git diff` empty in both repos afterwards, verified.

| Mutation | What reddened | Reason it gave |
|---|---|---|
| Per-agent cap never refuses | 2 — the ledger test and the over-the-wire one | `expected true to be false` on the cap; `relay_auth_ok` where a refusal was due |
| Reaper's six-hour activity floor removed | 2 — the floor test and the never-used-slot test | `expected [ { peerId: 'peer-0' } ] to deeply equal []` |
| Tuple cap never refuses | 4 of 5 tuple tests | `{ ok: true }` where a refusal was due |
| Every refusal fails over to another relay | 3 — including the slot-cap and unknown-reason defaults | `expected true to be false` |
| **Reclaim floor removed** | 2 — the ledger test AND the pre-existing reservation-purpose test | `expected 'timeout' to be 'leaf_deliver'` |

**The last one is the one to read.** Removing the five-minute reclaim floor does not merely fail an
assertion — it reproduces the production symptom exactly: a live receiver waits for its
counterparty's message and it never arrives, because the ledger hung its slot up. That mutation is
also how the fault was found in the first place, by an existing test written for something else.

## Revert proofs — the review fixes

| Mutation | What reddened | Reason it gave |
|---|---|---|
| Reclaim's peer-liveness guard removed | 1 — the waited-hours promotion test | `expected [ 'peer-promoted' ] to deeply equal []` |
| Operator surface never written | 2 of the client's 6 | the surface reads null where a refusal was due |
| Failover branch removed | exactly 1 — the quarantine test | `expected false to be true` |

## Clause 4 — a deviation, stated rather than left implicit

> *"An agent asking for a slot while holding an unused one does not consume a second."*

**As built, it consumes a second unless the old slot's peer has GONE.** That is deliberate and it
is the fix for the defect review found: a "spare" slot and a standing receiver waiting for its first
caller are the same thing until someone calls, so releasing on idleness alone hangs up the receiver
carrying a conversation that has just started. Reclaim is therefore a backstop for a disconnect the
relay never observed; the ordinary case — a daemon restart — is handled by the disconnect path,
which frees the slot at once. The clause's purpose (a restart must not strand a slot for its full
TTL) is met; its literal wording is not.

## Review

**One pass, per the rules. Verdict, in the reviewer's own words:**

> *SPEC: DEVIATIONS FOUND* — clause 8 (no consumer for the reaped-party notice) and clause 9 (no
> failover branch) are un-journaled and [blocking]. … *SILENT FALLBACKS FOUND* — H1 is [blocking]:
> the reclaim rule hangs up a live promoted receiver and the test that names the case only covers a
> 5-minute window. … *ERROR SUBSTITUTION FOUND* … *HOLLOW TESTS FOUND* … *REMOVALS PROVEN.*

Eight findings, all fixed: **H1** the reclaim floor did not prevent what it was written to prevent;
**H2** clause 9 was a flag nothing branched on; **H3** the reaped-party notice had no consumer and
raced its own disconnect; **M1** one refusal label for three different causes; **M2** the tuple cap
never reached the operator; **M3** the ledger counted connections against a reservation ceiling;
**L1** a refusal reason with no producer; **L2** a stale refusal survived a transport failure.

The reviewer also confirmed the parts that hold: the token check cannot be bypassed (one call site
for `recordAuthenticated`, strictly after the token check, and the binding compares against the
already-verified key); omitted-vs-empty is consistent across directory, wire and relay; the
registration-lookup premise is correct; the three fail-open candidates all point the safe way; and
the fourteen pre-existing relay test files were changed **additively only — confirmed by diffing
every removed assertion, not asserted.**

---

## Newly discovered

- **`relay_slot_reclaimed` reaches only an agent with an open delivery stream.** A bare standing
  receiver proves its reservation and closes the stream, so for the case the notice was written for
  there is nothing to write to and the hangup is the only signal. It recovers either way; what it
  loses is the explanation.
- **The three caps are judgement calls with no occupancy data behind them** — 32 slots per agent, 5
  sessions per identity pair, reaper at 80% of the ceiling. Worth revisiting once a relay has run
  with real traffic. The six-hour activity floor is not in this category; it is a floor.
- **Deploy ordering is not enforced by anything.** Publish the client before deploying the relays: an
  old relay ignores the extra field, but an enforcing relay in front of clients that send no token
  refuses every agent.
