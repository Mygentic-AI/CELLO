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

**OUTSTANDING — not yet fixed:**

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
