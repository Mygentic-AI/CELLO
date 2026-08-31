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

*(Reviewer verdict. One quote. Not a transcript.)*

---

## Newly discovered

*(One or two lines each. Do not act on them.)*
