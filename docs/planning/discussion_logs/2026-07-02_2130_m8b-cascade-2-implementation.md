---
name: M8B cascade 2 — implementation record (FINDING-4, FINDING-5, FINDING-6)
type: discussion
date: 2026-07-02
topics: [m8b, fix-briefs, directory-failover, unilateral-seal, receipts, frontier, cello-client, directory, implementation]
status: active
description: >
  Living implementation record for the M8B cascade-2 fix batch. Mirrors
  2026-07-02_1640_m8b-cascade-1-implementation-and-publish.md. Tracks FINDING-4 (bootstrap
  failover), FINDING-5 (unilateral frontier re-derivation), FINDING-6 (absent-party receipt)
  through SPARC+TDD, per-repo commits, code review, and the pending batch publish/deploy/live-verify.
  Follow-through doc for compaction — a fresh context can read this cold and continue.
---

# M8B Cascade 2 — Implementation Record

Implements [[2026-07-02_2014_m8b-fix-briefs-cascade-2]] (the authoritative brief). Companion to
[[2026-07-02_1122_m8b-e2e-test-results-journal]] (FINDING-4/5/6 evidence) and mirrors the shape of
[[2026-07-02_1640_m8b-cascade-1-implementation-and-publish]].

## Working setup (KEEP VERBATIM)

- **Both repos on branch `m8b-cascade-2`**, in worktrees (kept out of the other coder's `git status`
  via each repo's `.git/info/exclude`):
  - cello-client: `/Users/andrep/Documents/code/cello-client/.worktrees/m8b-cascade-2` — branched off
    `15c3d29` (the concurrent coder's FINDING-3 version cascade daemon 0.0.23 / cli 0.0.21; a clean
    base that already includes FINDING-3).
  - trustless-cello: `/Users/andrep/Documents/code/trustless-cello/.worktrees/m8b-cascade-2` — off
    `6f66557`.
- **A second coder is concurrently publishing the FINDING-3 client** in cello-client `main`. Rebase
  before merging this branch. Base branch pre-existing lint errors (NOT ours, do not fix here):
  `packages/e2e-tests/src/spine/j-presence.spine.test.ts` (`connectMcp` unused) and
  `packages/directory/src/bin/internal-api-only.ts` (2 unused eslint-disable directives).

## FINDING-4 — roster-aware directory failover (cello-client only) — DONE, committed

**Commit `e125cdc`** (cello-client, branch `m8b-cascade-2`).

- `createRosterAwareEndpointResolver` (`core/daemon/src/directory-bootstrap.ts`) wraps the primary
  (single-URL) resolver with the consortium roster: sticky-until-fail, primary-first, randomized
  fallback, `null` only when nothing resolves. Excludes both the current pointer AND the primary's
  identity from the fallback set. Emits `directory.bootstrap.failover`.
- ONE shared instance wired into daemon.ts signaling connect + every ceremony/refresh
  `getDirectoryEndpoint` site (signaling + ceremonies fail over to the SAME node together).
- **Critical bug the reviewer caught (and I fixed):** `createDirectoryEndpointResolver` cached
  `lastGood` and returned the STALE dead primary on any later fetch failure → the wrapper's
  "primary healthy" branch always won → roster fallback never reached in the live kill-primary
  scenario. Fix: added `staleFallback?: boolean` (default true, preserves M6/back-compat + the
  existing last-known-good test); `bin/cello-daemon.ts` builds the production resolver with
  `staleFallback:false` so a fresh failure reports the dead primary as `null`. Test 7 (composition
  regression) pins it. Re-review confirmed resolved.
- Reviewer Important (accepted + documented, not split): the shared `staleFallback:false` instance
  is also used by the registration gate (out of FINDING-4 scope) — a transient blip now fail-fasts
  instead of riding through on stale; acceptable for a rare, manual, retryable op. Comment at
  `daemon.ts` registration gate updated to reflect this.
- Gate: full workspace 1444 tests, lint, typecheck, build all green. `feature-dev:code-reviewer`
  ran twice.
- **Scope caveat (per brief):** sufficiency (any-directory routing on the fallback node — presence,
  relay assignment, ceremony against a non-home directory) is UNPROVEN by unit tests. The live
  kill-us1 failover test is the real proof and also runs #12/#13/#5. If session/seal fails on the
  fallback even though signaling connected → log a NEW finding, do not paper over.

## FINDING-5 — client re-derives the unilateral frontier (SI-002) — DONE, committed; reviewer running

**Commits: `02c6ad5f` (trustless-cello directory) + `49eeeac` (cello-client daemon).**

- **Directory** (`02c6ad5f`): `#processSealUnilateral` builds `frontier_leaves` from the verified
  carried leaves (same shape/source as the bilateral `processSeal`), threaded through both the
  single-key and FROST completion paths, attached to `seal_unilateral_confirmed` ONLY (present
  party, always live/in-memory) — NOT the absent party's notification, so FINDING-6's path and the
  durable Pg payload are unchanged. `encodeSealUnilateralConfirmed` + `SealUnilateralConfirmed` carry
  the optional field. Test hook `triggerSealUnilateralWithLeavesForTest` now registers the present
  stream (test-only) so the confirm frame is deliverable to a capturing stream.
- **Client** (`49eeeac`): `checkUnilateralFrontier` (`seal-frontier-verify.ts`) is attestation-aware:
  re-derives from `frontier_leaves` and REJECTS an inflated frontier for CLIENT-VERIFIABLE (`live`)
  parties; TOLERATES the absent party's un-derivable received-frontier remainder (stays
  directory-attested, marked); and when NO leaves are shipped (pre-FINDING-5 directory) returns
  `directory_attested` — persisted with a warn, NEVER rejected — so it never regresses the shipped
  FINDING-3 receipt and survives rollout skew. The unilateral-confirmed handler applies it before
  `recordSealCertificate`; on `unverifiable` it refuses to persist and resolves the close as
  `certificate_frontier_unverifiable`.
- Gate: cello-client 1449 tests green; directory seal/upgrade suites 49 green; changed files
  lint-clean + typecheck clean both repos.
- **OPEN — reviewer verdict pending (the brief REQUIRES folding it in):** does the omission-bypass on
  the `directory_attested` back-compat path (a malicious directory omits `frontier_leaves` + inflates
  a `live` frontier) warrant fail-closed instead of the lenient warn? My default: acceptable as
  hardening (the absent party is always directory-attested regardless; the live party is the
  operator's own; FINDING-3 already shipped the whole legibility as directory-attested; the
  degradation is logged). If the reviewer escalates → change to fail-closed for a `live` party
  claiming a frontier>0 with no leaves, and re-commit.

## FINDING-6 — absent party (B) persists its receipt — NOT STARTED (client-focused)

**Design decision that DEVIATES from the brief (flagged to Andre; reversible):** the brief's sub-case
3a says "add legibility to `seal_upgrade_confirmed`" (a directory change). But the directory does NOT
persist the leaves/legibility anywhere reachable at upgrade time (`#processSealUpgradeRequest` only
reads the storage-only `SealNotarization` row) — so the directory approach would need a new storage
path + Flyway migration. Plan instead: **do 3a client-side** — on a *verified* `seal_upgrade_confirmed`,
each party upgrades its OWN already-persisted unilateral receipt (flip the counterparty's
`attestation_mode` absent→recovered). Correct, cheaper, needs NO directory change → **FINDING-5's
`frontier_leaves` becomes the ONLY directory change in the cascade-2 deploy.**

Planned client work (cello-client daemon):
- **3b (unilateral receipt for B):** in the notification path, AFTER the KERNEL content-recovery/verify
  gate passes (`attemptSealUpgradeImpl` returns `{sent:true}` iff the gate passed), `normalizeLegibility`
  + `recordSealCertificate` the unilateral cert from the notification's legibility. NEVER persist before
  the gate (a tampered/unrecoverable-content case must yield NO receipt).
- **Stub-session trap:** `recordSealCertificate` is an `UPDATE ... WHERE` — a silent no-op if B has no
  local `sessions` row. Ensure a row first (mirror the existing `#insertSessionRow`) using the
  counterparty pubkey B can derive from the notification legibility.
- **3a (bilateral upgrade):** on verified `seal_upgrade_confirmed`, upgrade B's (and A's) stored cert's
  counterparty `attestation_mode` absent→recovered. B's own recovered frontier stays the honest
  synthetic floor (0) unless we recompute from B's content tree (optional refinement; never overstate).
- Red spine test: B reconnects post-restart → drains the durable notification → after the KERNEL gate →
  `cello_get_sealed_receipt(B)` returns the cert; regression: tampered/unrecoverable content → NO receipt.

## Batch publish / deploy / live-verify — NOT STARTED (task 4)

- ONE cello-client publish (via `/cello-publish`) for ALL daemon changes (F4 + F5-client + F6-client).
  Coordinate the version bump with the concurrent FINDING-3 publisher (they hold daemon 0.0.23/cli
  0.0.21 on main). Update `trustless-cello/packages/{directory,relay}/package.json` pins after.
- ONE directory `deploy.sh` (all 3 regions, ~25-30 min) for the ONLY directory change: FINDING-5
  `frontier_leaves`. (FINDING-6 3a is client-side → no directory change, per the decision above.)
- Live verifications (do NOT mark done on green vitest): FINDING-4 kill-us1 failover (also runs
  #12/#13/#5); FINDING-6 B-reconnect → `cello_get_sealed_receipt(B)` returns the cert. Coordinate with
  the testing/coordination owner (they hold shared dev infra + the demo agent) — do not perturb the
  cluster unannounced. Update `infra/STATE.md` if infra touched; mark findings resolved in the journal.

## Related Documents

- [[2026-07-02_2014_m8b-fix-briefs-cascade-2|M8B fix briefs — cascade 2]] — the authoritative brief.
- [[2026-07-02_1122_m8b-e2e-test-results-journal|M8B E2E test-results journal]] — FINDING-4/5/6 evidence.
- [[2026-07-02_1640_m8b-cascade-1-implementation-and-publish|M8B cascade 1 — implementation & publish]] — the shape this record mirrors.
