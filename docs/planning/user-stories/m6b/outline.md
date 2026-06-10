---
name: M6B — Beta Hardening
milestone: M6B
type: outline
date: 2026-06-03
status: active
topics: [hardening, reliability, dx, operations, process-management, error-propagation, relay, iac, serialization, networking, registration, refactor]
description: >
  M6B is a hardening milestone that closes operational gaps discovered during
  M6 beta launch and E2E testing. It eliminates the debugging amnesia that made
  every broken session a multi-hour investigation. It stabilises the relay,
  irons out IaC gaps, prevents orphan processes from accumulating, and closes
  registration data integrity gaps identified during the Sybil defense audit.
  M6B must complete before M7 implementation begins.
---

# M6B — Beta Hardening

## Why This Milestone Exists

M6 shipped working code. But operating it was brutal. Every session that went
wrong cost hours of debugging because the errors were opaque, the infra was
fragile, and the processes accumulated silently. Three patterns repeated:

1. **Debugging amnesia** — the same root causes (orphan processes, stale K_server
   shares, dead signaling streams) were rediscovered from scratch each time because
   the error messages gave no information. `directory_below_threshold` covered
   every possible FROST failure. `seal_deferred` gave no indication why. There was
   no recipe for recovery — just hours of log archaeology.

2. **Deploy cascades** — deploying the relay changed its peer ID, stalening the
   manifest, breaking session initiation. Deploying the directory lost the ops-agent
   504 route because the ECS LoadBalancers block was missing. Every deploy touched
   multiple things that needed manual follow-up.

3. **Process accumulation** — every new Claude Code session added another cello-mcp
   orphan. After a day of debugging, N processes competed for FROST ceremonies while
   holding the SQLite write lock. The only fix was `pkill -f cello-mcp`.

M6B fixes all three patterns systematically. As E2E testing continued, further
gaps were identified (sovereign node networking, Sybil defense, startup-order
dependency between directory and relay, codebase size) and resolved as additional
stories within the same milestone.

---

## What This Milestone Delivers

### End of debugging amnesia

- **M6B-001**: New cello-mcp startup kills the prior process (PID lock file),
  releasing the SQLite write lock before the new process opens the DB. No more
  `pkill`.
- **M6B-002**: `ceremony_exhausted` reason surfaces instead of
  `directory_below_threshold`. The tool response includes the exact 4-step
  re-registration recipe. Never debug this again.
- **M6B-003**: ~~`closeSession()` reconnect-before-seal + seal_deferred retry~~
  **Already implemented** — both fixes landed in cello-client commit 39a0c6a
  (fix/seal-reconnect-retry) on 2026-06-03. Story deleted.

### Stable infrastructure

- **M6B-004**: The port-8081 ALB target group is added to the ECS service
  `LoadBalancers` block. ECS auto-registers tasks on deploy and restart.
  The ops-agent 504 on directory restart is eliminated permanently. V28
  migration grants UPDATE on `agent_profiles` to `cello_service`.
- **M6B-005**: SQLCipher WAL mode and global install path.
- **M6B-006**: Relay gets a stable transport key via Secrets Manager and
  auto-registers with the directory on startup. Directory re-signs the manifest
  when `healthCheckUrl` changes. Relay deploys no longer cascade into broken
  session initiation.
- **M6B-007**: Relay gets a public WebSocket ALB (port 4002). External agents
  can reach the relay at `wss://relay-us1.cello.mygentic.ai`. ALB deregistration
  delay reduced to 30s to fix eu-central-1 pipeline timeout.
- **M6B-008**: RelayPoolManager polls S3 for manifest updates every 2 minutes.
  No directory restart needed to pick up a new relay manifest.
- **M6B-014**: NAT gateway added to VPC so relay in private subnet can reach
  the directory's public ALB for auto-registration. Fixes the root cause of
  all relay→directory registration failures post-nuclear reset. `deploy.sh`
  updated to construct `CELLO_DIRECTORY_MULTIADDR` from SSM peer-id at deploy
  time instead of hardcoding an IP.

### Addressing the startup-order dependency

- **M6B-019**: SSM node registry. `deploy.sh` writes
  `/cello/{env}/nodes/{role}/aws-{region}` parameters (hostname, peerId, port,
  transport, status). Directory reads at startup, constructs DNS multiaddrs,
  pre-populates the relay pool manifest and `NetworkRelayAdapter`. The directory
  can now reach the relay immediately after any restart regardless of whether
  the relay has re-registered. `CELLO_RELAY_MULTIADDR` removed from ECS task
  definitions. The startup-ordering dependency between directory and relay is
  eliminated in production.

### Capacity, correctness, and quality

- **M6B-009**: pg connection pool env var, RDS t3.medium, relay stream caps,
  idle session sweep.
- **M6B-010**: Directory restores pending connection requests, session
  participants, and session last-activity from Postgres on restart via V29
  migration and new `PgDirectoryStore` methods. A directory restart no longer
  orphans in-flight connection negotiations.
- **M6B-011**: Ops-agent Telegram bot gives honest failure messages, warns
  before re-issuing tokens, and reads migration version from SSM
  (`/cello/{env}/ops-agent/expected-migration-version`) instead of a hardcoded
  string. New `cello-ssm-parameters` CloudFormation stack.
- **M6B-012**: PERSIST-019 test gap — adds Uint8Array round-trip integrity
  checks to the notification queue and pending connection request tests.
- **M6B-013**: Replaces `@journeyapps/sqlcipher` (always compiles from source,
  20-40s install) with `@signalapp/sqlcipher` (pre-built binaries, <5s install,
  Windows support). SQLCipher client store rewritten to synchronous API.

### Registration data integrity and security

- **M6B-016**: Registration data integrity. `email_domain` dropped from
  `registrations` and `pre_authorization_tokens`; replaced with `email_stub_hash`
  (SHA-256 of normalised full email). `handleExistingUser()` enforces email hash
  continuity on re-registration. `channel_identities` table added (permanent
  `phone_stub_hash → channel_user_id` mapping) with RLS. Bot copy fix. V30
  migration.

### Rename and refactor

- **M6B-015**: Rename operations-agent → portal-backend across all repos, IaC,
  Secrets Manager paths, SSM parameters, ECR, IAM, CloudWatch, CodePipeline,
  buildspecs, TypeScript source, and docs. V31 migration renames the
  `cello_ops_agent` PostgreSQL role. **Ready to implement — M6B-016 is deployed
  healthy.**
- **M6B-017**: `core/client/src/client.ts` (6,198 lines) extracted into 6 focused
  manager classes behind a thin facade: `SessionManager`, `SealManager`,
  `RelayStreamManager`, `RegistrationManager`, `ConnectionManager`,
  `SignalingManager`. All 319 tests pass unmodified. Diagnostic logging from
  0.0.33–0.0.36 cleaned up. `@cello-protocol/connect@0.0.32` promoted to
  `@latest`.

### Signaling stream reliability (investigation complete)

- **M6B-018**: Signaling stream keepalive + reconnect. The directory must sweep
  idle clients after 60s; the client must send a ping every 20s and reconnect
  with exponential backoff on stream close. Investigation report complete
  (`M6B-018-investigation-report.md`). **Story YAML not yet written** — depends
  on M6B-017 being fully wired first (all `client.ts` signaling call sites
  delegated to `SignalingManager`).

---

## Story Breakdown

| ID | Title | Priority | Depends on | Status |
|----|-------|----------|------------|--------|
| M6B-001 | cello-mcp PID lock file — kill prior process on startup | P0 | — | ✅ merged |
| M6B-002 | FROST ceremony error propagation + re-registration recipe | P0 | — | ✅ merged |
| ~~M6B-003~~ | ~~closeSession reconnect-before-seal + seal_deferred retry~~ | ~~P0~~ | Already done | deleted |
| M6B-004 | ECS LoadBalancers block for port-8081 internal API + V28 migration | P0 | — | ✅ merged |
| M6B-005 | SQLCipher WAL mode + global install path | P0 | — | ✅ merged |
| M6B-006 | Relay transport key + auto-registration + manifest re-sign | P0 | — | ✅ merged |
| M6B-007 | Relay public WebSocket ALB | P0 | M6B-006 | ✅ merged |
| M6B-008 | RelayPoolManager S3 manifest poll loop | P0 | M6B-006 | ✅ merged |
| M6B-009 | Capacity hardening (pg pool, RDS, relay stream caps, session sweep) | P1 | — | ✅ merged |
| M6B-010 | Directory in-memory state restoration on restart | P1 | — | ✅ merged |
| M6B-011 | Ops-agent UX + SSM migration version | P1 | — | ✅ merged |
| M6B-012 | PERSIST-019 Uint8Array round-trip test | P1 | — | ✅ merged |
| M6B-013 | Replace @journeyapps/sqlcipher with pre-built library | P1 | M6B-005 | ✅ merged |
| M6B-014 | NAT gateway + sovereign node networking | P0 | — | ✅ merged |
| M6B-015 | Rename operations-agent → portal-backend | P1 | M6B-016 deployed | ⏳ ready |
| M6B-016 | Registration data integrity (email hash, handleExistingUser, channel_identities) | P0 | — | ✅ merged |
| M6B-017 | client.ts structural extraction into manager classes | P1 | — | ✅ merged |
| M6B-018 | Signaling stream keepalive + reconnect | P1 | M6B-017 wired | ⏳ story not written |
| M6B-019 | SSM node registry for DNS-based relay addressing | P0 | M6B-014 | ✅ merged |

**17 merged. 1 ready to implement (M6B-015). 1 story not yet written (M6B-018).**

---

## Dependency Graph

```
M6B-001  (independent)
M6B-002  (independent)
M6B-004  (independent)
M6B-005  (independent) → M6B-013
M6B-006  (independent) → M6B-007
                       → M6B-008
M6B-009  (independent)
M6B-010  (independent)
M6B-011  (independent)
M6B-012  (independent)
M6B-014  (independent) → M6B-019
M6B-016  (independent) → M6B-015 (after deployed healthy)
M6B-017  (independent) → M6B-018 (after signaling call sites fully wired)
```

---

## M7 Dependencies

Two M6B stories must land before M7 implementation begins:

**M6B-004 → CELLO-MULTI-008:** The port-8081 ECS LoadBalancers block and V28
migration are prerequisites for MULTI-008's integration gate.

**M6B-005 → CELLO-MULTI-002:** WAL mode must be carried forward when MULTI-002
rewrites the composition root. The MULTI-002 implementer must read M6B-005 before
writing the AgentRegistry store open sequence.

M6B-019 also directly benefits M7: the SSM node registry is the infrastructure
M7's multi-relay topology will build on.

---

## Milestone Close Gate

M6B closes when:

1. No new Claude Code session requires `pkill -f cello-mcp` — the new cello-mcp
   process kills the prior one automatically (M6B-001). ✅
2. `cello_initiate_session` after a K_server share mismatch returns
   `ceremony_exhausted` with the 4-step re-registration recipe (M6B-002). ✅
3. `cello_close_session` after a full message exchange seals the session without
   `seal_deferred` (M6B-003 already implemented; verified in M6-E2E-001 AC-006
   on 2026-06-10). ✅
4. Deploying a new relay image does not break session initiation — the directory
   picks up the new manifest within 2 minutes (M6B-006 + M6B-008). ✅
5. The portal-backend is reachable at the directory's internal API immediately
   after a directory ECS task replacement, without manual target re-registration
   (M6B-004). ✅
6. Directory restart does not require a relay restart to re-establish the
   relay→directory connection (M6B-019). ✅ Verified 2026-06-10.
7. M6B-015 (rename) implemented and deployed. ⏳
8. M6B-018 (signaling keepalive) story written and implemented. ⏳

---

## Key Codebase Locations

| What | Where |
|------|-------|
| cello-mcp entry point | `cello-client/core/adapter-claude-code/src/bin/cello-mcp.ts` |
| FROST ceremony failure mapping | `trustless-cello/packages/directory/src/directory-node.ts` |
| mcp-server tool error responses | `cello-client/core/client/src/mcp-server.ts` |
| Session manager (post-M6B-017) | `cello-client/core/client/src/session-manager.ts` |
| Signaling manager (post-M6B-017) | `cello-client/core/client/src/signaling-manager.ts` |
| ECS relay template | `trustless-cello/infra/cloudformation/cello-ecs-relay.yaml` |
| SQLCipher store | `cello-client/core/client/src/sqlcipher-client-store.ts` |
| Relay pool manager | `trustless-cello/packages/directory/src/relay-pool-manager.ts` |
| SSM node registry (M6B-019) | `trustless-cello/infra/deploy.sh` (writes), `trustless-cello/packages/directory/src/bin/directory.ts` (reads) |
| portal-backend source (pending rename) | `trustless-cello/packages/operations-agent/src/` |
| persist-019 test | `trustless-cello/packages/directory/src/__tests__/persist-019-notification-queue.test.ts` |

---

## Related Documents

- [[user-stories/m6b/COORDINATION]] — agent coordination log, full story history
- [[milestone-writeups/M6-beta-launch|M6 Beta Launch Writeup]] — post-mortem that identified the original M6B gaps
- [[user-stories/m6b/M6B-018-investigation-report]] — deep investigation of signaling keepalive design
- [[discussion_logs/2026-06-03_1146_beta-launch-brittleness-analysis|Beta Launch Brittleness Analysis]] — root cause analysis for location-based addressing brittleness
- [[discussion_logs/2026-06-06_2100_sovereign-node-networking-requirements|Sovereign Node Networking Requirements]] — engineering analysis that led to M6B-014
