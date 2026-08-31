---
name: M15 relay micro orders 002–005 — follow-through
type: discussion
date: 2026-08-31
topics: [m15, relay, micro-work-orders, relayauth, relayabuse, sweep, dead-frames, compaction, follow-through]
description: >
  Cross-cutting state for the four M15 relay micro work orders (002/003/004/005) at the 2026-08-31
  compaction point: what is merged, what is on branches, what each Opus re-review found, which of
  Andre's rulings are applied, and the exact ordered list of what is still owed. The per-order detail
  lives in the micro work orders themselves; this carries only what spans them.
---

# M15 relay micro orders — follow-through at compaction (2026-08-31 ~22:00)

## Read these first, in this order

1. `docs/planning/user-stories/m15/M15-PROCEDURE.md` — the SOP. Still governs.
2. The four micro work orders in `docs/planning/user-stories/m15/micro/`. **Each carries its own
   DoD, its review verdicts, and its outstanding findings.** They are the per-order source of truth
   and were deliberately updated before this compaction:
   - `002-RELAY-requires-an-assignment.md`
   - `003-RELAY-rate-limiting-and-idle-timer.md` ← carries the Opus re-review + 8 findings
   - `004-RELAY-admin-dead-frames.md`
   - `005-RELAY-checked-then-ignored-sweep.md` ← carries the Opus re-review + 4 findings
3. This document, for what spans them.

> ⚠️ **The micro-order rules forbid reading or writing `M15-DEFINITION-OF-DONE.md` and
> `M15-BUILD-JOURNAL.md`.** That fence is why this follow-through is a discussion log rather than a
> journal entry. Do not "fix" that by writing to the journal.

## Exact state

| Repo | Branch | HEAD |
|---|---|---|
| trustless-cello | `main` | `a44653bd` |
| trustless-cello | `m15/002-relay-requires-an-assignment` | `7a9c9d7d` |
| cello-client | `main` | `a19ac55` |
| cello-client | `m15/002-relay-requires-an-assignment` | `44b2792` |

**Merged to `main` (trustless-cello):** 004 (`bd4c89d1`), 005 (`130acab9`), 003 (`cfe9fa0b`), plus
`f659866a` (the idle-timer regression fix, cherry-picked off the 002 branch because 003's regression
was live on main) and `a44653bd` (the two re-review write-ups).

**On the 002 branches, both repos, NOT merged.** Both trees are clean; everything is pushed.

Two commits ride on the trustless-cello 002 branch that are **not part of 002** and should be split
out or dropped before merge: `a2b138e8` (a root `CLAUDE.md` with gstack skill routing — the reviewer
flagged it as LOW-9, the repo already has `.claude/CLAUDE.md`) and `d4afe561` (a docs commit about
group-room broadcast).

## The model history, and why it matters

This session ran on **Sonnet 5 from 2026-08-24T15:20Z to 2026-08-31T18:37Z**, then **Opus 5 from
18:38Z onward** (verified from the session transcript's per-turn `message.model`, not from the commit
trailers — the trailers are self-report and a JSONL can be replayed under any model).

Consequence Andre acted on: **004, 005 and 003 were coded AND originally reviewed on Sonnet.** He
commissioned Opus re-reviews of 003 and 005. Both found real defects the Sonnet reviews missed.
**004 has NOT been Opus-re-reviewed** — it is Sonnet-authored, merged, and deletes code; Andre scoped
the re-reviews to 003 and 005 only. Raise it, do not silently expand scope.

## Andre's rulings this session (settled — do not re-open)

1. **Client-side changes are IN SCOPE for 002**, overriding the order's own "no client change" fence.
   His words: *"we want to make sure the reservation gating grant works correctly. We have zero
   users."* Reservation gating could not be done correctly without it.
2. **Idle timeout = 24 hours (Flow B).** A reclaimer, never a conversation timeout. Shipped at 1h,
   which destroyed the sessions of agents who had merely gone quiet — his own working pattern.
   **Applied, and on `main` as `f659866a`.**
3. **A throttled send retries on the relay's own timing, and surfaces only as a fallback** (D2:
   Option 1 with Option 2 fallback). **Applied** on the cello-client 002 branch.

## What is DONE

- **004** — merged, complete. Three dead admin frame types deleted; `discard_session` kept and proven
  live. Fleet-deadness evidence is in the order.
- **005** — merged. Security conclusion (zero checked-then-ignored bugs) **independently confirmed by
  the Opus re-review**. Coverage claim failed; four items outstanding (below).
- **003** — merged. Security fix (pubkey-lockout) confirmed correct by Opus. Both of Andre's rulings
  applied. Six findings outstanding (below).
- **002** — all three HIGH blocking findings fixed, each revert-tested. **Not yet re-reviewed, not
  merged.**

## What is OWED, in the order to take it

### A. 002 — finish and merge (highest priority; it is the launch blocker)
1. Dispatch a fresh `cello-unit-reviewer` (Opus) on the **combined** 002 diff across BOTH repos,
   including the three HIGH fixes. The previous review predates them.
2. Fix whatever it returns; commit per fix.
3. Split or drop `a2b138e8` and `d4afe561` from the trustless-cello 002 branch.
4. Merge both repos' 002 branches to their `main`s. **Bilateral order:** the relay half of the
   `purpose: "reservation"` wire field is already on the 002 branch (`7a9c9d7d`) and must land at or
   before the client half.
5. 002's remaining MEDIUM/LOW findings from the first review are listed in its work order
   (unbounded `#authenticatedPeers`, un-`unref`'d timers, `pendingRevokeCount()` with no consumer,
   two tests that do not survive the revert test, the header prose overstating the gate's reach).

### B. 005 — one real fix, three corrections (all recorded in its work order)
1. Walk `packages/relay/src/network-directory-adapter.ts` and fix `getRelayPublicKey`'s bare
   `catch { return undefined }` — it renders every transport failure as "the predecessor relay is not
   registered". Return a discriminated result.
2. Correct the `file-content-store.ts` table verdict — a corrupt parked entry is served as
   `found:false`, so the recipient is told the mailbox is empty after the sender was told `ok:true`.
   Decide whether that silent loss is also fixed here or recorded as post-launch.
3. Correct the false "malformed fields throw" mechanism (`new Uint8Array` yields zero-length, does
   not throw).
4. Add the predecessor-ACK note (verified then discarded).

### C. 003 — six outstanding findings (all recorded in its work order)
F2 (auth refusal flattened to `auth_rejected` at the client), F4 (limiter after the nonce mint),
F5 (`RELAY_CIRCUIT_DURATION_LIMIT_MS` overflow above ~24.8 days kills every relayed connection),
F6 (absent-key leniency with no signal), F7 (refusal frame races its own abort), plus the **two
hollow `hash_submit` tests** — deleting either limiter leaves both green — and L2b's weak OR.

### D. Open question for Andre (asked, not yet answered)
003's and 005's leftovers are currently being fixed on the **002 branch**. He was asked whether he
would rather they landed as separate commits on `main` so each order's history stays clean. Default
if he does not answer: keep them together and note the coupling in the merge message.

## Standing facts a fresh context will need

- **Gate:** `pnpm run test` → `lint` → `typecheck` in BOTH repos. `typecheck` IS the build (`tsc
  --build`, emits `dist/`). **Rebuild `dist/` before any test that spawns the relay binary.**
- **Two pre-existing failures, both confirmed on unmodified trees via `git stash` + re-run. Neither
  is ours; do not chase them.**
  - trustless-cello: `packages/e2e-tests/src/__tests__/expect-present-enforcer.test.ts` flagging
    `j-suspend-tofn.spine.test.ts:279`.
  - cello-client: `mcp-001-agent-lifecycle.test.ts` AC-002 — expects `cello_start_agent` to return
    exactly `{ok:true}`, now also gets `standing_receiver: "starting"`.
- A hook enforces **one vitest run at a time**. Read a finished run's log rather than re-running.
- Every fix in this session was **revert-tested** (revert, confirm red for the expected reason,
  restore). Keep doing that — it is what caught the hollow content-park test.

## The three things most worth not forgetting

1. **The obvious fix for 002's HIGH-1 was itself a bug.** Making the replacement receiver
   authenticate normally would have stolen the live session's delivery stream, because the relay
   keys delivery by pubkey and both receivers share one. Hence `purpose: "reservation"`.
2. **A clean bill of health is the most dangerous kind of finding.** 005 produced no code; its
   deliverable was "nothing found", and the Opus pass showed a whole file had never been opened.
3. **Sonnet reviews passed things Opus caught.** Where a Sonnet-era verdict is load-bearing and has
   not been re-reviewed (004), treat it as unverified rather than as settled.
