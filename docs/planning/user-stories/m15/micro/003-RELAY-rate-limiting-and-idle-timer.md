---
name: 003-RELAY — Relay rate limiting, and the idle timer that is off in production
type: micro-work-order
date: 2026-08-24
status: open
description: >
  Three relay paths still have no rate limiting of any kind, and the per-session idle timer exists
  but the production binary never passes it. Add per-peer and per-pubkey limits to the three
  remaining paths, and switch the timer and the relayed-connection caps on. Source: DOD-M15-RELAYABUSE-1.
---

# **<ins>MICRO</ins>** WORK ORDER 003-RELAY — Relay rate limiting and the idle timer

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

---

## The problem, plainly

Point a coding agent at the relay and ask *"what stops someone hammering this?"* and the answer is
**nothing**, on most paths. That is the shape of finding that costs trust whether or not anyone ever
exploits it.

Separately, the relay has a per-session idle timer. It is written, it works, and **the production
binary never passes it in** — so the only thing reclaiming sessions is a 24-hour sweep.

## What is already done — do not redo it

Two of the five paths were closed earlier in this milestone:

- **Content-park deposit** — has a per-peer limiter, both halves, reviewed.
- **Liveness query** — scoped to a named participant.

**Read both before you start.** If either turns out not to be as described, record it under *Newly
discovered* and work the three below anyway. Do not go and fix it.

---

## The work

### 1. Rate limiting on the three remaining paths
Per peer **and** per pubkey, on:

- **authentication**
- **hash submission**
- **gap-fill**

### 2. Turn the per-session idle timer on in production
The feature exists. `bin/relay.ts` never passes it. Pass it.

### 3. Restore the caps on relayed connections
The default limit capping a relayed connection's **duration** and **bytes** is deliberately disabled.
Restore both.

### 4. Rate limit RESERVATIONS — added 2026-08-31 by the 002-RELAY review (M2)
**Added to the mission deliberately, rather than filed under Newly discovered.** The 002 reviewer's
reason: without it this order rate-limits submits and leaves the reservation table wide open, and
whoever reads the closed order later will reasonably believe the abuse surface was covered.

A reservation is granted to any peer, up to 4096, and the grace-window revoke only requires a
successful `relay_auth` — which proves possession of *some* Ed25519 keypair, not that the key belongs
to a registered agent (002's clause 2 is NOT implemented; see that order). So an attacker with 4096
throwaway keypairs can reserve, authenticate, hold, and fill the table permanently. Every legitimate
agent then loses NAT reachability — nobody can start a session with them — with no attack visible
anywhere, because each individual peer did nothing wrong.

**Watch the trap this order already names:** a throttle that costs a peer its reservation turns a
rate limit into an outage. A rate-limited auth aborts BEFORE `recordAuthenticated`, so a peer that
trips the auth throttle also loses its circuit reservation. Neither order's tests cover the
combination.

#### ⛔ NOT IMPLEMENTED — this one needs Andre's decision, and here is why (2026-08-31)

Everything else in this order is done. This item is deliberately left open rather than guessed at,
because **every workable mitigation is a behaviour change to reservation GRANTS, and denying a grant
is what caused a previous outage** — `relay-connection-gater.ts`'s own header records it: deny at
grant time and you strand every brand-new agent, because a brand-new agent cannot have authenticated
yet. That is the DOD-NAT-REACHABILITY-1 class.

The obvious limits do not work, and it is worth writing down why so nobody re-derives them:

- **Per-peer.** Useless against the stated attack. The attacker uses 4096 *different* peers, one
  reservation each, so a per-peer limit is never approached.
- **Per-pubkey.** Same. Keypairs are free to generate.
- **Relying on the auth throttle.** Also no. It is per-peer and per-pubkey, and the attacker varies
  both, so each throwaway identity authenticates once, well inside every limit.

What would actually work, and the tradeoff each carries:

1. **Implement 002's clause 2** — require the authenticating key to be one a directory-signed
   assignment names. This removes the attack at its root: throwaway keypairs stop being admissible.
   It is the real fix, and it is a bigger change than this order.
2. ~~**Cap reservations held by peers that have NOT yet proven key possession.**~~ **WITHDRAWN
   2026-09-01 — this does not work, and the earlier note calling it "effective" was wrong.** Proving
   key possession only means holding *a* keypair, and the attacker's throwaway keys are real keys, so
   they authenticate successfully, cancel their own revoke timer, and leave the unproven pool
   immediately. Capping that pool therefore bounds nothing except a burst inside the ~15s grace
   window — and those reservations were already being reclaimed. It would have added a real risk of
   denying brand-new agents in exchange for stopping an attack nobody would run.
2b. **Cap reservations held by peers that are not VOUCHED** — named by a directory-signed assignment
   this relay has recorded — rather than merely authenticated. This is the version that bites, because
   vouching is the thing an attacker cannot mint. It is also newly cheap: `DOD-M15-RELAYAUTH-1` built
   a durable vouched-key store for the content-park gate, so the data already exists and survives
   restarts. **The cost is real and must not be glossed:** an agent that has never yet held a session
   is legitimately un-vouched, so it competes in the capped pool. It degrades (slower to become
   reachable under flood) rather than failing outright, but a first-run agent is exactly the user
   least able to diagnose it.
3. **Limit by IP or subnet** — the standard answer, because addresses are the one thing an attacker
   cannot vary for free. Needs the remote multiaddr, which the reservation hook does not currently
   receive, so it is a new plumb.

4. **⭐ RECOMMENDED — an online token, issued at agent start. Proposal below.**

**Recommendation as of 2026-09-01: option 4.**

---

### ⭐ PROPOSAL — the online token (Andre, 2026-09-01)

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

### The token alone is NOT enough — slot accounting, five parts (Andre, 2026-09-01)

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

### 🔴 TWO NON-NEGOTIABLES — these govern everything below (Andre, 2026-09-01)

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

### Build checklist

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

**⚠️ A PROPOSAL, not work for this order.** It touches directory, client and relay, so it needs its
own work order to build. 003 carries the decision, not the implementation.

---

## Definition of Done

1. ✅ **Authentication** and **hash_submit** each refuse over the wire when their limit is exceeded,
   with a NAMED reason (`relay_auth_failed`/`rate_limited`, `hash_submit_error`/`rate_limited`) —
   never a log-only refusal. **Gap-fill has no wire handler left to limit**: its frame type
   (`gap_fill_request`) was deleted from the dispatch in `DOD-M15-SEALWIRE-1` bullet 7 (confirmed by
   reading `relay-node.ts`'s comment at the dispatch site and grepping `relay-frames.ts` — no decode
   path exists for it). There is no surface to add a limiter to; this clause is satisfied vacuously.
   Content-park deposit and the liveness query were re-checked against their "already done"
   descriptions (per the trap above) and both matched: deposit has a per-peer limiter with a
   distinguishable "running blind" log for the unattributed case; liveness collapses
   no-session/not-a-participant/wrong-subject into one anti-enumeration reply.
2. ✅ Both new refusals carry `retry_after_ms`, sourced from the relay's own `DepositRateLimiter`
   (reused as-is — its own correctness is already covered by `dod-m15-deposit-rate-limit.test.ts`),
   never guessed client-side.
3. ✅ Proven from the BINARY, not the config: `dod-m15-relayabuse-1-idle-timer-binary.test.ts` spawns
   the compiled `dist/bin/relay.js`, records a real client-presented session assignment over the
   wire, and asserts the relay sends `session_interrupted`/`timeout` and tears the session down on
   its own — no `hash_submit` needed to trigger it, the timer starts at `recordAssignment`. Chosen
   default: `RELAY_SESSION_IDLE_TIMEOUT_MS` = 1 hour (an order of magnitude tighter than the 24h
   sweep it complements; a judgement call, tunable without a code change).
4. ✅ Relayed connections carry both caps, restored (not reinstating libp2p's 2-min/128-KiB toy
   defaults, which is what broke NAT reachability originally) but bounded: 7 days / 1 GiB by
   default (`RELAY_CIRCUIT_DURATION_LIMIT_MS` / `RELAY_CIRCUIT_DATA_LIMIT_BYTES`), proven ENFORCED
   (not merely configured) in `nat-reachability-relay-limits.test.ts` L2a/L2b — a real relayed
   circuit is established through the production factory and closed once the tiny test-configured
   limit is crossed.
5. ✅ Every new test made to fail on purpose: the L2a/L2b circuit-cap tests, the 5 auth/hash_submit
   rate-limit tests, and the idle-timer binary test were each run against a temporary revert of
   their fix and reddened for the expected reason (no cap → link never disconnects; no limiter →
   every attempt succeeds; no wiring → the read hangs past its deadline waiting for a timer that
   never fires). Fix restored after each; diffs confirmed identical to the committed state.
6. ✅ `pnpm run lint` clean. `pnpm run typecheck` (`tsc --build`, rebuilds `dist/` — required before
   the idle-timer binary test means anything, per §7's own warning) clean. `pnpm run test`: same
   ONE pre-existing, unrelated failure as 004-RELAY and 005-RELAY
   (`expect-present-enforcer.test.ts` / `j-suspend-tofn.spine.test.ts:279`, confirmed present on
   `main` before any M15-RELAY work in this session); every test in every file this unit touched or
   added is green.
7. ✅ Reviewed by `cello-unit-reviewer`, verdict quoted below.

**Not in scope:** requiring an assignment (002-RELAY), the admin frame types (004-RELAY),
infrastructure-level flood protection, anything in the directory or the client.

---

## Traps recorded before you start

- **A limit nobody hears is not a limit.** If the refusal only reaches a log line, it is not done.
- **Throttling is not an outage.** Guidance that tells an operator their message was lost, when it was
  queued, is worse than saying nothing. This exact mistake was made and caught earlier in this
  milestone.
- **One definition per refusal string.** Two copies that happen to agree today will drift.
- **Do not weaken an existing assertion to make a new test pass.**

---

## Review

> **1 blocking finding.** SPEC: FAITHFUL (all 7 clauses implemented as written). NO SILENT
> FALLBACKS. ERRORS NAME THEIR CAUSE. TESTS HAVE TEETH — all seven new/modified tests survive the
> revert test on direct code-path verification. REMOVALS PROVEN (gap-fill's deadness independently
> re-confirmed in both repos). **One HIGH-severity finding stood: the auth path's pre-verification,
> pubkey-keyed rate limiter let any third party who merely knows an agent's public key — information
> CELLO agents are meant to share to be reachable — lock that specific agent out of a specific relay
> at zero cost, with no proof of key possession required, by claiming its pubkey with a garbage
> signature 20+ times a minute. This is a new attack surface introduced by this unit.** Fix: move
> the pubkey-keyed check to after Ed25519 verification, leaving the peer-keyed check where it is. —
> `cello-unit-reviewer`

**Fixed in this branch, same session:** the pubkey-keyed check for authentication now runs strictly
after the signature verifies — a forged claim on someone else's pubkey fails on `signature_invalid`
before it ever reaches the limiter, so it cannot spend the real key-holder's bucket. The peer-keyed
check is unchanged (it was never vulnerable — it keys on the caller's own Noise-authenticated
transport identity, which they cannot forge). Added a regression test
(`REGRESSION: a forged attempt CLAIMING a victim's real pubkey...`) and revert-tested it against the
reintroduced vulnerable ordering: reddened with the forger's second attempt returning
`rate_limited` instead of `signature_invalid` — direct proof the victim's bucket had been spent by
an unverified claim — then passed again once restored. Hash_submit's pubkey-keyed check was never
at risk (it keys on the AUTHENTICATED sender pubkey, post-verification, by construction — there is
no pre-auth hash_submit path).

### ⚠️ OPUS RE-REVIEW (2026-08-31) — "SPEC: FAITHFUL" does NOT survive a second look

Commissioned by Andre because this unit **and its first review were both run on Sonnet**.

> The security fix in `93befef9` is correct and complete … The prior verdict of "SPEC: FAITHFUL"
> does not survive a second look. This unit's two new refusals are never heard: the daemon collapses
> `relay_auth_failed` into `auth_rejected` and reads neither the reason nor `retry_after_ms`, and a
> rate-limited `hash_submit` is written to a log line and then discarded, after which `cello_send`
> returns `{ok: true, delivered: true}` — and in the parked branch tells the operator the message is
> "sealed, witnessed and on its way" when the relay just refused to witness it. … Separately,
> turning the idle timer on at a one-hour default is a live regression rather than a hardening …
> **Blocking before this closes: surface both refusals to the caller with their retry window, and
> get Andre's decision on the idle-timer default — that number is a product call, not a coder's.**
> — `cello-unit-reviewer` (Opus)

**FIXED (Andre's rulings, 2026-08-31):**

- **F3 / D1 — the idle timer.** Shipped at 1h; that destroyed sessions of agents who had merely gone
  quiet, the `session_interrupted{timeout}` frame was dropped by a client watcher with no production
  caller, the daemon still showed the session active, and the next send failed `session_not_found`
  on an unsealable session. **Andre ruled 24h (Flow B).** Fixed + cherry-picked to `main`
  (`f659866a`), with a new test that reads the shipped default off the running binary with NO env
  var set — the old test set the value explicitly, so it stayed green for any default.
- **F1 / D2 — a throttled `hash_submit` was silently unwitnessed.** **Andre ruled: retry on the
  relay's own timing, surface only as fallback.** `#doSubmit` now waits out the relay's stated
  window and resubmits (3 attempts, per-wait ceiling so a hostile relay cannot stall a sender), and
  surfaces the refusal only if it does not clear. `retry_after_ms` is now carried on `SubmitResult`
  and read. (cello-client, branch `m15/002-relay-requires-an-assignment`.)

**ALL FIXED 2026-08-31** (`41938d1c` relay side, `9d1ee85` client side) — the list below is kept as
the record of what each one was. F5 was measured, not reasoned about: a 30-day cap fires after 3ms.
The two hollow tests were replaced by two that pull the axes apart, and the revert test now
demonstrates the point — removing either limiter reddens exactly one of them, while both original
tests stay green through both removals.

**Former OUTSTANDING list:**

1. **F2 — the auth refusal is destroyed at the client boundary.** `session-relay-client.ts`'s
   `#authenticate` inspects only `frame["type"]`, logs `reason: "auth_rejected"`, and drops both
   `reason` and `retry_after_ms`. A throttled agent is indistinguishable from a bad signature, a
   nonce failure, or a dead relay — the exact distinction the DoD line demanded. HIGH.
2. **F4 — the auth limiter sits after the expensive part.** Every new stream mints a nonce, stores
   it with a 30s TTL and sends a challenge BEFORE any limit is consulted; the nonce map is swept
   O(n) per new stream, so holding N nonces makes each open O(N). Opening streams and never replying
   is unlimited and superlinear. Fix: check the peer limiter at the top of `#handleRelayStream`.
   MEDIUM.
3. **F5 — `RELAY_CIRCUIT_DURATION_LIMIT_MS` overflow.** Guarded only for NaN and `> 0`; it reaches
   `AbortSignal.timeout(ms)`, and any value above 2,147,483,647 ms (~24.8 days) clamps to 1 ms and
   fires immediately — every relayed connection dies on establishment. `2592000000` (30 days) is a
   plausible operator value. Clamp + warn. MEDIUM.
4. **F6 — absent-key leniency lost its signal.** Both new limiters reuse `DepositRateLimiter`, whose
   absent key is allowed through; `content-park.ts` compensates with a
   `content.park.deposit.unattributed` log so "running blind" ≠ "no abuse". Neither new call site
   does. Not exploitable today (peer id is always populated) — one refactor from a silent no-op.
5. **F7 — the refusal frame races its own abort.** Every refusal does `#sendFrame` (no flush) then
   `stream.abort(...)`. Over loopback it arrives; under backpressure a reset can beat it and the
   caller sees a bare stream reset, i.e. "the relay is down" — defeating clause 1. MEDIUM.
6. **HOLLOW TESTS — the two `hash_submit` rate-limit tests do not pin the "AND".** Both use one
   client = one peer = one pubkey, so both limiters trip together. **Deleting EITHER
   `#hashSubmitPeerLimiter` or `#hashSubmitPubkeyLimiter` leaves both tests green** — a single-axis
   implementation passes a clause that says per-peer AND per-pubkey. Fix: one test with two pubkeys
   over the SAME transport peer, one with the same pubkey over two peers. (The three auth tests, the
   regression test, the idle-timer binary test and L2a all DO survive the revert test.)
7. **L2b's assertion is a weak OR.** `expect(sendThrew || disconnected).toBe(true)` — one disjunct
   can be satisfied by a muxer-level rejection unrelated to the data cap. It does still survive the
   revert, so not hollow; tighten to `expect(disconnected).toBe(true)`, since the relay tearing the
   link IS the property under test. LOW.
8. **F8 — claim-truth.** The comment says 20/min is "far above a legitimate reconnect burst (a flaky
   link retrying every few seconds)". A retry every 3s is exactly 20/min — at the limit, not far
   above it. The number is still fine (the daemon re-auths on demand, not on a grid); the
   justification's arithmetic is wrong. LOW.

**Cross-unit hazard (with DOD-M15-RELAYAUTH-1):** a rate-limited auth aborts BEFORE
`recordAuthenticated`, so a peer that trips the auth throttle also loses its circuit reservation —
a throttle becoming an outage, this order's own named trap. Low likelihood at 20/min; neither unit's
tests cover the combination.

---

## Newly discovered

*(none outstanding — the one documentation gap the reviewer noted, the speed-bump caveat missing
next to `DEFAULT_AUTH_RATE_LIMIT`/`DEFAULT_HASH_SUBMIT_RATE_LIMIT`, was closed in the same commit
as the security fix since it was a one-line addition to code already being touched.)*
