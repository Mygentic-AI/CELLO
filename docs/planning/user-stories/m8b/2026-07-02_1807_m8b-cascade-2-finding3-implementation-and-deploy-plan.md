---
name: M8B cascade 2 — FINDING-3 implementation + deploy plan (unilateral seal retrievable receipt)
type: discussion
date: 2026-07-02
topics: [m8b, fix-briefs, cascade-2, seal, unilateral, legibility, cello-client, directory, deploy, handoff]
status: active
description: >
  FINDING-3 (unilateral seal completes but produces no retrievable receipt) implemented,
  gated, code-reviewed, and spine-verified — but NOT yet published or deployed. This is the
  follow-through/handoff artifact: what shipped in code, the exact version-bump + deploy runbook
  (publish cascade + directory CI/CD pipeline + relay restarts + demo update + live verify), the
  reviewer findings addressed, and the pre-change health snapshot. A fresh context resumes at
  "PUBLISH + DEPLOY RUNBOOK" below.
---

# M8B Cascade 2 — FINDING-3: unilateral seal retrievable receipt

**State at write time (2026-07-02 18:07 UTC): CODE COMPLETE + VERIFIED, NOT YET SHIPPED.**
All gates green, code review done + findings addressed, live spine (real binaries + Postgres)
passing. Nothing is published to npm and nothing is deployed to AWS yet. The code is committed
locally to `main` in both repos **but NOT pushed** (a push to `trustless-cello` main triggers the
directory CI/CD pipeline; a tag push to `cello-client` triggers the npm publish — both are held for
Andre's explicit go).

Companions: [[2026-07-02_1122_m8b-e2e-test-results-journal]] (FINDING-3 root cause + FINDING-5 +
FINDING-6 + resolution note), [[2026-07-02_1130_m8b-e2e-ux-friction-log]] (F23), [[2026-07-02_1514_m8b-fix-briefs-cascade-1]]
(the cascade-1 sibling this mirrors), [[2026-07-02_1640_m8b-cascade-1-implementation-and-publish]]
(cascade-1 publish/deploy, the process template for this one).

---

## THE FIX (what shipped in code)

**FINDING-3:** a unilateral seal (counterparty provably absent, closed after the 600s delivery-grace
window) completed but produced no retrievable receipt — `cello_close_session` returned
`{ok:true, seal_type:"unilateral", sealed_root}` but `cello_get_sealed_receipt` returned
`sealed_receipt_not_found`, and the close carried no legibility. Root cause: the unilateral
confirmation handler verified the cert but never persisted it, and the `seal_unilateral_confirmed`
frame carried no `legibility` object at all.

**Intended behavior (the fix target):** a unilateral close yields the SAME durable, legible,
retrievable receipt a bilateral close does, with the counterparty recorded ABSENT.

### Directory (`trustless-cello/packages/directory`)
- `directory-node.ts` `#processSealUnilateral`: derives the receipt-not-assent legibility via
  `buildSealLegibility(leafData.leaves, {attestationOverrides: Map(absentPartyHex→"absent")})`.
  Because a received-only counterparty authors NO leaf, appends a synthetic zero-frontier
  (`content_frontier_seq:0, last_authored_seq:0, attestation_mode:"absent"`) participant when the
  absent party is missing — so the counterparty is ALWAYS named ABSENT. Threaded through BOTH the
  single-key and FROST completion paths. New event `session.unilateral.legibility.built`.
- `directory-node.ts` `#completeUnilateralNotarization`: attaches `legibility` to the `cert`
  carried on `seal_unilateral_confirmed` AND `seal_unilateral_notification`; also carries it on the
  **durable** Pg notification-queue payload as `legibility_cbor_hex` (reviewer Critical 1 — see
  below); `unilateralNotificationFromPayload` rebuilds it (CBOR-hex, byte-lossless — a `JSON.stringify`
  would mangle the Uint8Array pubkeys). `unilateralNotificationFromPayload` is now `export`ed for test.
- `directory-frames.ts`: `encodeSealUnilateralConfirmed`/`encodeSealUnilateralNotification` encode
  `legibility`; `decodeSealCertFields` passes it through.
- `directory-types.ts`: optional `legibility?: SealLegibility` added to `SealCertificateFields`.

### Client daemon (`cello-client/core/daemon/src/daemon.ts`)
- `registerUnilateralConfirmedListener`: after `verifyUnilateralCertificate` succeeds,
  `normalizeLegibility(frame["legibility"])` → `recordSealCertificate(agentName, sidHex, rootHex,
  JSON.stringify(legibility))` **before** `destroySessionNode` (bilateral ordering) → resolves the
  waiter with `legibility`. Logs `session.unilateral.receipt.persisted` (or warns
  `session.unilateral.receipt.absent` when a pre-cascade-2 directory ships none).
- `UnilateralResult` type gained `legibility?`.
- `cello_close_session` unilateral success returns `legibility` inline (spread when present).

### Trust model (ship condition — MET)
The unilateral legibility is **directory-attested** (FROST-notarized by the consortium), NOT
co-signed by the counterparty and NOT re-derived by the client — it is **not** cryptographic
bilateral parity. Provenance is made explicit on the cert via per-participant `attestation_mode`
(the absent party is `absent`, never presented as client-verified). All "bilateral parity" comments
were corrected to say this. Hardening tracked as **FINDING-5**.

---

## REVIEWER FINDINGS (feature-dev:code-reviewer, 2026-07-02) — all addressed

- **Critical 1 (FIXED):** the durable Pg notification-queue payload dropped `legibility` (only the
  in-memory `#pendingNotifications` carried it) — an absent party reconnecting after a directory
  restart would get no cert. Fixed: `legibility_cbor_hex` added to the enqueue payload +
  reconstruction; 2 new unit tests (round-trip + back-compat).
- **Critical 2 (→ FINDING-6, deferred):** the CLIENT never persists the legibility from
  `seal_unilateral_notification` — its handler is the DOD-UP-1 upgrade path (`attemptSealUpgrade`),
  which never calls `recordSealCertificate`. So the ABSENT party's `cello_get_sealed_receipt` still
  returns `not_found`. Genuinely separable (B can't verify the cert signature the way A does; B
  should persist only after the KERNEL content-recovery/verify gate; a successful upgrade → bilateral
  receipt is its own design). The directory half already ships B the cert (both paths), so FINDING-6
  is **client-only** — no further directory deploy needed. Tracked in the test-results journal.
- **Verified fine:** persist-before-destroy ordering, synthetic-participant honesty (never overwrites
  a real frontier), FROST-path parity, back/forward compatibility, normalizeLegibility shape guards.
- **Trust model verdict:** "defensible to ship this fix first … but should not be presented as
  bilateral parity." → does NOT escalate FINDING-5 to must-fix-now. Comments corrected accordingly.

**FINDING-5** (Andre logged in the journal): unilateral legibility is directory-attested, not
client-re-derived (SI-002 asymmetry). Medium security hardening; tracked follow-up. **FINDING-6**:
absent party's client-side receipt persistence on reconnect; tracked follow-up (client-only).

---

## VERIFICATION (all green at write time)

- `cello-client` daemon: `pnpm --filter @cello-protocol/daemon test` → **489 pass**; typecheck clean;
  `eslint core/daemon/src` clean.
- `trustless-cello` directory: `pnpm --filter @cello-protocol/directory test` → **670 pass, 1 fail**.
  The 1 failure is **pre-existing and unrelated**: `deploy-001-iac-validation.test.ts` asserts
  `cello-vpc.yaml` contains `ecr.api` (a VPC-endpoint template gap); confirmed by stashing my changes.
  My 6 new FINDING-3 tests all pass.
- `trustless-cello` e2e spine (real binaries + Docker Postgres): `pnpm --filter @cello-protocol/e2e-tests
  test:spine … j-unilateral.spine.test.ts` → **3 pass**. The extended J-UNILATERAL test proves it live:
  `A seals while B is GONE` → close returns `legibility` inline with B recorded `absent`, and
  `cello_get_sealed_receipt(A)` returns the persisted cert (was `sealed_receipt_not_found`).
- typecheck + lint clean on both repos for all changed files. Docker is UP locally (spine runnable).
- New test file: `packages/directory/src/__tests__/finding-3-unilateral-legibility.test.ts` (6 tests:
  handler legibility + silent-absent + buildSealLegibility override + durable round-trip + back-compat
  + wire encoder). Spine additions in `packages/e2e-tests/src/spine/j-unilateral.spine.test.ts`.

To re-run the spine test the sandbox must be OFF (it shells `docker`): run the vitest spine command
with sandbox disabled. It rebuilds nothing — build the changed packages first (`tsc --build` via the
`typecheck` script) so `dist/` is current, because the harness spawns local `dist/bin/*.js` binaries.

---

## PUBLISH + DEPLOY RUNBOOK — resume here (NOT yet done; Andre's go required)

**Mechanism facts (from `infra/CLAUDE.md` + `infra/STATE.md`, read 2026-07-02):**
- The directory change is APPLICATION CODE → it ships via the **`cello-directory-pipeline` (CI/CD),
  triggered by a git PUSH to `trustless-cello` main** (path-filtered on `packages/directory/**`).
  Build → StagingDeploy(us-east-1) → SmokeTest → ProductionDeploy(all 3 regions). **~25-30 min.**
  **NOT `deploy.sh`** — deploy.sh is CFN-only; there is NO CFN/template change here.
- The client change is in `@cello-protocol/daemon` only → publish via **git TAG push → CI → npm beta**
  (NEVER `npm publish`/`pnpm publish` from local). Only dependent is `@cello-protocol/cli`.
  `@cello-protocol/connect` does NOT depend on daemon → **no connect bump**.
- After any directory redeploy, **restart the relay in all 3 regions** (relay has no reconnect logic;
  re-registers only at startup) or clients get `relay_unavailable`.
- **Mandatory pre/post health check across all 3 regions** (ECS 1/1 COMPLETED + all 6 DNS resolve).

### Step 1 — Publish cello-client (daemon 0.0.23 / cli 0.0.21)
1. `Skill: cello-publish` (LOAD IT — it is the authority; do not publish from memory).
2. Bump `core/daemon/package.json` **0.0.22 → 0.0.23**.
3. Bump `core/cli/package.json` **0.0.20 → 0.0.21** AND update its `@cello-protocol/daemon` dep pin to
   `0.0.23` (cli depends on daemon; check the exact spec — currently `workspace:*` internally, so the
   pin update may be a no-op in-repo, but verify per /cello-publish).
4. `connect` (adapter-claude-code, 0.0.53) — **no change** (does not depend on daemon).
5. `pnpm install` (lockfile), commit, `git tag v<connect-version-per-skill>` — NOTE: the tag name vs.
   connect version has drifted historically (see memory `feedback_load_cello_publish_skill`); the
   skill resolves the correct tag. Push the tag → CI builds → typecheck/lint/test/tarball → publishes.
6. After publish, verify the BINARY: `npm view @cello-protocol/daemon@beta version` == 0.0.23 and
   `npm view @cello-protocol/cli@beta dependencies --json` shows real versions (never `workspace:*`).

### Step 2 — Deploy the directory (CI/CD pipeline)
1. Pre-change health check (all 3 regions) — see snapshot below; re-run live before pushing.
2. `git push origin main` in `trustless-cello` (the code is already committed locally). This triggers
   `cello-directory-pipeline`. **Batch note:** FINDING-4 (signaling dialer roster failover, a
   daemon-package change) was intended to batch with FINDING-3's daemon publish — it is NOT
   implemented. Decide with Andre: ship FINDING-3 daemon now (0.0.23) and FINDING-4 later (0.0.24), or
   hold. (Independent of the directory push either way.)
3. Watch the pipeline (foreground, ~25-30 min): Build → StagingDeploy → SmokeTest → ProductionDeploy.
   Use a poll loop on ECS `rolloutState` (built-in `aws ecs wait` has a hard 10-min cap — too short).
4. Post-deploy: **restart relay in all 3 regions** (`aws ecs stop-task` per region; ECS relaunches;
   wait for `relay.already.registered` in directory CloudWatch logs). If a relay's private IP changed
   and the directory did not auto-re-sign, re-sign the S3 manifest (`infra/sign-manifest.sh`).
5. Post-change health check (all 3 regions) — same as pre-change.

### Step 3 — Update the demo agent + live verify (FINDING-3 acceptance)
Demo agent EC2 `i-0ad3e7c22470f266e` (us-east-1). Currently daemon 0.0.22 / cli 0.0.20 / connect 0.0.53.
1. `cd /opt/cello-demo && npm install @cello-protocol/cli@0.0.21 @cello-protocol/daemon@0.0.23` as
   root, then `chown -R cello-demo node_modules` (the system user can't exec npm). No DB migration;
   FROST share untouched.
2. Restart sequence (daemon MUST be ready before demo connects — stale-socket hazard):
   `systemctl stop cello-demo && systemctl stop cello-daemon && sleep 2 && systemctl start
   cello-daemon && sleep 5 && systemctl start cello-demo`. Confirm healthy startup fingerprint
   (`agent.signaling.created` → `directory.signaling.connected` → `agent.online` → `session.node.created`).
3. **Live acceptance:** open a session to the demo → kill the counterparty daemon (SIGKILL) → wait
   past the 600s grace → `cello_close_session` → confirm `cello_get_sealed_receipt` returns a
   certificate with the counterparty recorded **ABSENT** (was `sealed_receipt_not_found`). Note: the
   demo's standing receiver is the first suspect if a live session fails (`standing_receiver_unavailable`);
   check `session.node.created` in the daemon log.
   - Driving this from Claude Code MCP is fragile after a local daemon restart (stale socket, memory
     `project_mcp_stale_socket_after_daemon_restart`). The 600s grace makes a full live loop slow.

### Step 4 — Update STATE.md
Update `infra/STATE.md`: demo-agent `@cello-protocol versions` line (→ daemon 0.0.23 / cli 0.0.21) and
Service status line; note directory redeploy image tag; **correct the stale `directory-ap1` NXDOMAIN
note** — it now resolves (see snapshot). Commit STATE.md.

---

## PRE-CHANGE HEALTH SNAPSHOT (2026-07-02 18:0x UTC — re-verify live before deploying)

All 6 ECS services **1/1 COMPLETED** (directory + relay × us-east-1 / eu-central-1 / ap-northeast-1).
All 6 DNS names resolve: `directory-us1` 52.72.187.230, `directory-eu1` 3.70.142.93, **`directory-ap1`
54.199.0.195 (STATE.md's 2026-06-29 NXDOMAIN note is STALE — ap1 is healthy)**, `relay-us1`
32.196.93.0, `relay-eu1` 3.123.157.203, `relay-ap1` 18.176.202.14. Environment is HEALTHY — no
pre-existing degradation blocks the deploy.

---

## EXACT CODE STATE (files changed)

`trustless-cello` (committed locally to main, NOT pushed):
- `packages/directory/src/directory-node.ts`, `directory-frames.ts`, `directory-types.ts`
- `packages/directory/src/__tests__/finding-3-unilateral-legibility.test.ts` (new)
- `packages/e2e-tests/src/spine/j-unilateral.spine.test.ts`
- `docs/planning/discussion_logs/2026-07-02_1122_m8b-e2e-test-results-journal.md` (FINDING-3 resolved
  + FINDING-6 added; FINDING-5 was added by Andre)
- this file

`cello-client` (committed locally to main, NOT pushed):
- `core/daemon/src/daemon.ts` (version bump to 0.0.23 happens at publish time, Step 1)

Standing background machinery: NONE (no crons/watchdogs). Docker up locally.

---

## Related Documents

- [[2026-07-02_2133_well-known-agent-discovery|Well-Known Agent Discovery]] — the demo-agent
  identity-rotation / no-discovery-channel problem surfaced while running this doc's FINDING-3
  live verify (an `initiate_session` to the stale published pubkey returned `target_offline`).
- [[2026-07-02_1122_m8b-e2e-test-results-journal|M8B E2E Test Results Journal]] — FINDING-3
  resolution recorded there; FINDING-5/6 tracked follow-ups.
