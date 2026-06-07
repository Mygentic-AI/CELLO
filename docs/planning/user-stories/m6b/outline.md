---
name: M6B — Beta Hardening
milestone: M6B
type: outline
date: 2026-06-03
status: active
topics: [hardening, reliability, dx, operations, process-management, error-propagation, relay, iac, serialization]
description: >
  M6B is a hardening milestone that closes operational gaps discovered during
  M6 beta launch and E2E testing. It eliminates the debugging amnesia that made
  every broken session a multi-hour investigation. It also stabilises the relay,
  irons out IaC gaps, and prevents orphan processes from accumulating. M6B must
  complete before M7 implementation begins.
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

M6B fixes all three patterns systematically.

---

## What This Milestone Delivers

### End of debugging amnesia

- **M6B-001**: New cello-mcp startup kills the prior process (PID lock file),
  releasing the SQLite write lock before the new process opens the DB. No more
  `pkill`.
- **M6B-002**: `ceremony_exhausted` reason surfaces instead of
  `directory_below_threshold`. The tool response includes the exact 4-step
  re-registration recipe (delete agent_key_shares, delete agent_profiles,
  restart directory ECS task, fresh client.db + new token). Never debug this again.
- **M6B-003**: ~~`closeSession()` reconnects the signaling stream before sending the SEAL frame, and retries on `seal_deferred`.~~ **Already implemented** — both fixes landed in cello-client commit 39a0c6a (fix/seal-reconnect-retry) on 2026-06-03. Story deleted.

### Stable infrastructure

- **M6B-004**: The port-8081 ALB target group is added to the ECS service
  `LoadBalancers` block. ECS auto-registers tasks on deploy and restart.
  The ops-agent 504 on directory restart is eliminated permanently.
- **M6B-005**: SQLCipher WAL mode and global install path.
- **M6B-006**: Relay gets a stable transport key via Secrets Manager and
  auto-registers with the directory on startup. Directory re-signs the manifest
  when health_check_url changes. Relay deploys no longer cascade into broken
  session initiation.
- **M6B-007**: Relay gets a public WebSocket ALB. External agents can reach
  the relay at `ws://relay-us1.cello.mygentic.ai`.
- **M6B-008**: RelayPoolManager polls S3 for manifest updates every 2 minutes.
  No directory restart needed to pick up a new relay.

### Capacity, correctness, and quality

- **M6B-009**: pg connection pool env var, RDS t3.medium, relay stream caps,
  idle session sweep.
- **M6B-010**: Directory restores pending connection requests, session participants,
  and session last-activity from Postgres on restart. A directory restart no longer
  orphans in-flight connection negotiations.
- **M6B-011**: Ops-agent Telegram bot gives honest failure messages, warns before
  re-issuing tokens, and reads migration version from SSM instead of a hardcoded string.
- **M6B-012**: PERSIST-019 test gap — adds Uint8Array round-trip integrity checks
  to the notification queue tests.
- **M6B-013**: Replaces `@journeyapps/sqlcipher` (always compiles from source,
  20-40s install) with a pre-built alternative.

---

## Story Breakdown

| ID | Title | Priority | Depends on |
|----|-------|----------|------------|
| M6B-001 | cello-mcp PID lock file — kill prior process on startup | P0 | — |
| M6B-002 | FROST ceremony error propagation + re-registration recipe | P0 | — |
| ~~M6B-003~~ | ~~closeSession reconnect-before-seal + seal_deferred retry~~ | ~~P0~~ | Already done — deleted |
| M6B-004 | ECS LoadBalancers block for port-8081 internal API + V28 migration | P0 | — |
| M6B-005 | SQLCipher WAL mode + global install path | P0 | — |
| M6B-006 | Relay transport key + auto-registration + manifest re-sign | P0 | — |
| M6B-007 | Relay public WebSocket ALB | P0 | M6B-006 |
| M6B-008 | RelayPoolManager S3 manifest poll loop | P0 | M6B-006 |
| M6B-009 | Capacity hardening (pg pool, RDS, relay stream caps, session sweep) | P1 | — |
| M6B-010 | Directory in-memory state restoration on restart | P1 | — |
| M6B-011 | Ops-agent UX + SSM migration version | P1 | — |
| M6B-012 | PERSIST-019 Uint8Array round-trip test | P1 | — |
| M6B-013 | Replace @journeyapps/sqlcipher with pre-built library | P1 | M6B-005 |
| M6B-014 | NAT gateway + remove interface endpoints (sovereign node networking) | P0 | — |

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
M6B-014  (independent)
```

11 stories are fully independent. 3 stories have a single upstream dependency.
All 11 independent stories can be dispatched in parallel from day one.

---

## Parallelism Map

**Batch 1 — dispatch all at once (no dependencies):**

| Story | Repo | Primary file |
|-------|------|-------------|
| M6B-001 | cello-client | `core/adapter-claude-code/src/bin/cello-mcp.ts` |
| M6B-002 | trustless-cello + cello-client | `packages/directory/src/directory-node.ts`, `core/client/src/mcp-server.ts` |
| ~~M6B-003~~ | ~~cello-client~~ | Already implemented — deleted |
| M6B-004 | trustless-cello | `infra/cloudformation/cello-ecs-directory.yaml`, `cello-vpc.yaml`, V28 migration |
| M6B-005 | cello-client | `core/client/src/sqlcipher-client-store.ts`, `SKILL.md` |
| M6B-006 | trustless-cello + cello-client | `infra/cloudformation/cello-ecs-relay.yaml`, `packages/relay/src/` |
| M6B-009 | trustless-cello | `packages/directory/src/bin/directory.ts`, `infra/cloudformation/cello-rds.yaml` |
| M6B-010 | trustless-cello | `packages/directory/src/bin/directory.ts`, `packages/directory/src/adapters/` |
| M6B-011 | trustless-cello | `packages/operations-agent/src/registration/state-machine.ts` |
| M6B-012 | trustless-cello | `packages/directory/src/__tests__/persist-019-notification-queue.test.ts` |
| M6B-014 | trustless-cello | `infra/cloudformation/cello-vpc.yaml`, `infra/deploy.sh` |

**Batch 2 — unblocks after batch 1 merges:**

| Story | Blocked on |
|-------|-----------|
| M6B-007 | M6B-006 merged |
| M6B-008 | M6B-006 merged |
| M6B-013 | M6B-005 merged |

---

## M7 Dependencies

Two M6B stories must land before M7 implementation begins:

**M6B-004 → CELLO-MULTI-008:** The `/agent-lookup` ALB rule and V28 migration
(port-8081 ECS LoadBalancers block) are prerequisites for MULTI-008's integration
gate. MULTI-008 AC-002 and AC-004 will fail without them.

**M6B-005 → CELLO-MULTI-002:** WAL mode must be carried forward when MULTI-002
rewrites the composition root. The MULTI-002 implementer must read M6B-005 before
writing the AgentRegistry store open sequence.

---

## Milestone Close Gate

M6B closes when:

1. A new Claude Code session starts without requiring `pkill -f cello-mcp` — the
   new cello-mcp process kills the prior one automatically (M6B-001).
2. `cello_initiate_session` after a K_server share mismatch returns
   `ceremony_exhausted` with the 4-step re-registration recipe in the response
   (M6B-002).
3. `cello_close_session` after 5+ minutes of P2P messaging successfully seals
   the session without `seal_deferred` (M6B-003 — already implemented in
   cello-client commit 39a0c6a; verify in E2E test).
4. Deploying a new relay image does not break session initiation — the directory
   picks up the new manifest within 2 minutes (M6B-006 + M6B-008).
5. The ops-agent is reachable at `https://directory-us1.cello.mygentic.ai/internal/pre-authorize`
   (HTTP 401, not 502 or 504) immediately after a directory ECS task replacement,
   without manual target re-registration (M6B-004).

---

## Key Codebase Locations

| What | Where |
|------|-------|
| cello-mcp entry point | `cello-client/core/adapter-claude-code/src/bin/cello-mcp.ts` |
| FROST ceremony failure mapping | `trustless-cello/packages/directory/src/directory-node.ts` lines 1986-1989 |
| ThresholdSignatureError reasons | `trustless-cello/packages/crypto/src/frost/types.ts` lines 36-44 |
| mcp-server tool error responses | `cello-client/core/client/src/mcp-server.ts` line 479 |
| closeSession SEAL path | `cello-client/core/client/src/client.ts` (find closeSession()) |
| initiateUnilateralSeal reconnect pattern | `cello-client/core/client/src/client.ts` lines ~1795-1800 |
| ECS relay template | `trustless-cello/infra/cloudformation/cello-ecs-relay.yaml` |
| relay.ts WS listen addr | `trustless-cello/packages/relay/src/bin/relay.ts` lines 59-60, 225-227 |
| SQLCipher store | `cello-client/core/client/src/sqlcipher-client-store.ts` |
| ops-agent state machine | `trustless-cello/packages/operations-agent/src/registration/state-machine.ts` |
| persist-019 test | `trustless-cello/packages/directory/src/__tests__/persist-019-notification-queue.test.ts` |

---

## Related Documents

- [[user-stories/m6b/COORDINATION]] — agent coordination log and story table
- [[milestone-writeups/M6-beta-launch|M6 Beta Launch Writeup]] — post-mortem that identified all M6B gaps
- [[discussion_logs/2026-06-03_1146_beta-launch-brittleness-analysis|Beta Launch Brittleness Analysis]] — root cause analysis for location-based addressing brittleness
- [[discussion_logs/2026-06-06_2100_sovereign-node-networking-requirements|Sovereign Node Networking Requirements]] — engineering analysis that led to M6B-014; establishes NAT gateways as required primitive for multi-cloud peer-to-peer communication
