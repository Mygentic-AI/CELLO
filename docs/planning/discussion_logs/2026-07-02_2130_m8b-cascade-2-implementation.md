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

## FINDING-5 — client re-derives the unilateral frontier (SI-002) — DONE, committed, reviewed (2 rounds)

**Commits: `02c6ad5f` (directory) + `49eeeac` + `1b42b4f` + `946ab5d`(partial) (cello-client daemon).**

**Reviewer verdict (2 rounds): resolved via OVERRIDE-not-reject (the brief's "reject/override").**
- Round 1 raised two Criticals: (1) the lenient no-leaves carve-out was inconsistent with the bilateral
  fail-closed precedent (omission-bypass); (2) ANY client rejection of a unilateral cert is
  UNRECOVERABLE — the directory's `#unilateralSeals` dedup guard is set before the client reacts and
  never cleared, so a retry close is silently ignored (FINDING-1 dead-end, worse). Reject is the wrong
  tool on the unilateral path.
- Fix (`1b42b4f`): `checkUnilateralFrontier` now OVERRIDES an inflated CLIENT-VERIFIABLE ('live') frontier
  DOWN to the re-derived value (directory can't forge signed leaves → derived = truth); never rejects →
  never dead-ends; always persists. Statuses: verified / corrected / directory_attested (no leaves) /
  leaves_invalid.
- Round 2 found the `leaves_invalid` path left the inflated value UNCORRECTED (easier bypass). Fix
  (`946ab5d`): forged/cross-session leaves = zero trustworthy evidence → 'live' frontier corrected DOWN
  to 0 (strongest tamper → strongest correction), status stays leaves_invalid for the loud audit log.
- Deferred (tracked below): the directory `#unilateralSeals` dead-end is a PRE-EXISTING issue (reachable
  only via the pre-existing bad-FROST-signature rejection path, unchanged here); reviewer agreed to defer.

Original commit prose:

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

## FINDING-6 — absent party (B) persists its receipt — DONE, committed (client-only); review running

**Commit `946ab5d` (cello-client daemon). Client-only — no directory change (the 3a decision below held).**

**3a done CLIENT-SIDE (deviates from the brief, confirmed):** the brief's 3a says "add legibility to
`seal_upgrade_confirmed`" (directory). But the directory does not persist the seal leaves/legibility
anywhere reachable at upgrade time, so instead — on a VERIFIED `seal_upgrade_confirmed` — each party
upgrades its OWN already-persisted receipt (`upgradeAbsentToRecovered`: counterparty 'absent' →
'recovered'). 'recovered' is a valid attestation_mode (seal-legibility-tbs.ts: live=1/recovered=2/
absent=3). The seal signatures don't bind the (unsigned) legibility, so the client-side flip is sound.
Net: FINDING-5's `frontier_leaves` is the ONLY directory change in the cascade-2 deploy.

- **3b (unilateral receipt for B):** the daemon `attemptSealUpgrade` wrapper captures the module's
  `{sent}`; on `sent:true` (⟺ the KERNEL content-recovery/verify/completeness gate passed) it persists
  B's unilateral cert from the notification's legibility via `recordSealCertificateEnsuringRow`. NEVER
  persists on `sent:false` (tampered/unrecoverable/incomplete → NO receipt).
- **Stub-session trap fixed:** `recordSealCertificate` is a silent-no-op `UPDATE` without a row;
  `recordSealCertificateEnsuringRow` INSERT-OR-IGNOREs a stub row (counterparty = notification
  `present_pubkey`) first.
- Unit tests: `finding-6-absent-receipt.test.ts` (stub-row persistence + the pure flip). The named LIVE
  check (B reconnect post-restart → `cello_get_sealed_receipt(B)` returns the cert) is task 4.
- `feature-dev:code-reviewer` running on `946ab5d`.

## Batch publish / deploy / live-verify — NOT STARTED (task 4) — HUMAN-GATED

**Baseline confirmed (2026-07-02):** the concurrent FINDING-3 publish LANDED + promoted to latest —
daemon 0.0.23 / cli 0.0.21 / connect 0.0.53 / client 0.0.41 / crypto 0.0.14 / transport 0.0.11 /
protocol-types 0.0.11 (all beta==latest). Highest cello-client tag `v0.0.64`.

**Client publish plan (daemon-only changes → cascade-1 precedent):**
- daemon 0.0.23 → **0.0.24**; cli 0.0.21 → **0.0.22** (re-pins daemon 0.0.24).
- connect 0.0.53 **unchanged** (pure IPC shim; new result fields pass through). crypto/transport/
  protocol-types/client **unchanged**.
- Tag **v0.0.65** (next free after v0.0.64) → CI → beta. Verify daemon@0.0.24 dist greps:
  `createRosterAwareEndpointResolver`, `checkUnilateralFrontier`, `recordSealCertificateEnsuringRow`,
  `upgradeAbsentToRecovered`. cli@0.0.22 pins daemon@0.0.24 (never workspace:*).
- **NO trustless-cello cross-repo pin update** — directory/relay pin crypto/transport/protocol-types/
  client/connect; NONE changed. (This differs from the brief's generic version-bump AC, which assumed a
  cross-repo package changed; here only `daemon` did, and directory/relay don't depend on daemon.)

**Directory deploy plan:** ONE `deploy.sh` (all 3 regions, ~25-30 min) for the ONLY directory change —
FINDING-5 `frontier_leaves` on `seal_unilateral_confirmed` (backward-compatible: old clients ignore the
new field). **Deploy the directory BEFORE promoting the new client to latest** so a new client never
meets an old (no-frontier_leaves) directory (avoids the FINDING-5 back-compat window). No Flyway
migration (no schema change) → `OpsAgentExpectedMigrationVersion` unchanged.

**Human-gated sequence (needs Andre + coordination owner):**
1. Rebase `m8b-cascade-2` onto current main (both repos), merge to main. Coordinate with the concurrent
   coder (push order — M5 rule: push after each merge).
2. Version bump commit LAST + tag v0.0.65 (Andre's go via `/cello-publish`) → beta.
3. Directory `deploy.sh` (Andre's go; ~30 min; disruptive to shared dev infra).
4. Update EC2 demo agent + local stack to daemon 0.0.24/cli 0.0.22.
5. LIVE verify (coordination owner holds infra + demo agent; do NOT perturb unannounced):
   - **FINDING-4:** down the us-east-1 directory ECS task → client fails over to eu1/ap1, comes online,
     completes a real session + seal on the fallback (ALSO runs #12/#13/#5). Restore per `infra/CLAUDE.md`
     (relay re-register + sign-manifest.sh). If session/seal fails on the fallback even though signaling
     connected → LOG A NEW FINDING (any-directory routing gap), do not paper over.
   - **FINDING-6:** B reconnects post-restart → drains the durable notification → after the KERNEL gate →
     `cello_get_sealed_receipt(B)` returns the cert (was not_found).
6. Promote to latest (Andre): `npm dist-tag add @cello-protocol/{cli,daemon}@<new> latest` (+ the
   unchanged transitive set stays as-is).
7. Update `infra/STATE.md` if infra touched (directory deploy → deploy.sh auto-updates it; manual changes
   by hand). Mark FINDING-4/5/6 resolved in the test-results journal.

## Deferred follow-up findings (tracked, NOT this batch)

- **Directory `#unilateralSeals` dead-end (cascade-2 reviewer Critical 2):** once a client REJECTS a
  unilateral cert (the PRE-EXISTING bad-FROST-signature path — FINDING-5's override path never rejects),
  the directory's in-memory `#unilateralSeals` dedup guard (set before the client reacts, never
  TTL'd/swept) silently ignores any retry `seal_unilateral` → no receipt ever produced (FINDING-1
  dead-end, worse). Fix options: TTL/eviction on `#unilateralSeals`, clear-on-rejection, or a distinct
  terminal-failure signal. **Open question (unprovable from code):** is the guard per-node only (so
  FINDING-4 failover to another node gets a fresh attempt) or does the durable `seal_notarizations`
  UNIQUE(session_id) row block a retry cross-node? Resolve against the multi-region model before fixing.
- **FINDING-5 residual omission (leaves-absent):** a directory that ships NO frontier_leaves + an inflated
  'live' frontier is persisted directory-attested (logged), not corrected (nothing to derive from). Low
  risk — the exposed value is the operator's own self-evident frontier; the dangerous absent-party value
  is directory-attested regardless; a post-FINDING-5 directory always ships ≥1 leaf for the live party.

## Related Documents

- [[2026-07-02_2014_m8b-fix-briefs-cascade-2|M8B fix briefs — cascade 2]] — the authoritative brief.
- [[2026-07-02_1122_m8b-e2e-test-results-journal|M8B E2E test-results journal]] — FINDING-4/5/6 evidence.
- [[2026-07-02_1640_m8b-cascade-1-implementation-and-publish|M8B cascade 1 — implementation & publish]] — the shape this record mirrors.
