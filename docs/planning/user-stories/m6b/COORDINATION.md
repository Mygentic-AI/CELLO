---
name: M6B-coordination
type: coordination
date: 2026-06-03
topics: [m6b, coordination, pre-m7, hardening]
status: active
description: >
  Coordination log for Milestone 6B — pre-M7 hardening stories. All 13 stories
  are independent of each other except where noted. Intended to be implemented
  in priority order before M7 begins.
---

# M6B Agent Coordination Log

Milestone 6B is a hardening milestone. It contains 13 stories extracted from
the M6 post-mortem and E2E testing sessions. These stories fix operational
brittleness, debugging amnesia, and reliability gaps discovered during M6 beta
launch. They are prerequisites for M7 implementation to proceed without constant
operational interruptions.

**All stories are in the m6b/ folder. Do not put M6B stories in m7/.**

Read this file at the start of every M6B session. Append, never overwrite.

---

## Story List — Priority Order

These are ordered by pain elimination priority. Implement them in this order.

| ID | What it fixes | Dependencies |
|----|--------------|--------------|
| CELLO-M6B-001 | cello-mcp PID lock file — kills prior orphan process on startup; releases SQLite write lock before new process opens DB | none |
| CELLO-M6B-002 | `ceremony_exhausted` error reason + 4-step re-registration recipe in tool output — eliminates re-registration debugging amnesia | none |
| ~~CELLO-M6B-003~~ | ~~`closeSession()` reconnect-before-seal + seal_deferred retry~~ — **DELETED: both fixes were already implemented in commit 39a0c6a (merged 2026-06-03) before this story was written. See cello-client fix/seal-reconnect-retry branch.** | — |
| CELLO-M6B-004 | ECS LoadBalancers block for port-8081 internal API target group — eliminates ops-agent 504 after every directory restart | none |
| CELLO-M6B-005 | SQLCipher WAL mode + global install path — eliminates write lock deadlock on version bump | none |
| CELLO-M6B-006 | Relay transport key in Secrets Manager + auto-registration on startup + directory re-signs manifest | none |
| CELLO-M6B-007 | Relay public WebSocket ALB — external clients can connect to relay | depends on M6B-006 |
| CELLO-M6B-008 | RelayPoolManager S3 manifest poll loop — directory picks up new manifest without restart | depends on M6B-006 |
| CELLO-M6B-009 | Capacity hardening: pg pool env var, RDS t3.medium, relay stream caps, idle session sweep | none |
| CELLO-M6B-010 | Directory in-memory state restoration: pending connection requests, session participants, session last activity | none |
| CELLO-M6B-011 | Ops-agent UX: honest failure message, re-registration warning, SSM for migration version | none |
| CELLO-M6B-012 | PERSIST-019 AC-003 Uint8Array round-trip test gap | none |
| CELLO-M6B-013 | Replace @journeyapps/sqlcipher with pre-built alternative — eliminates 20-40s native compilation | depends on M6B-005 |

---

## M7 Impact

M6B-004 blocks CELLO-MULTI-008 (M6B-004 must land before MULTI-008 integration gate).
M6B-005 is carried forward by CELLO-MULTI-002 (WAL mode must be applied in MULTI-002's AgentRegistry store open sequence).

All other M6B stories are independent of M7 stories and can be merged in any order.

---

## Coordination Entries

<!-- Append entries below. Format: Date | Story | Status | Notes -->

### 2026-06-03 — Milestone created

Stories extracted from M7 PREP domain and rehoused as standalone M6B milestone.
Priority order reflects operational pain from M6 beta launch post-mortem.

Sprint review status:
- M6B-002 (was PREP-006): APPROVED (2 BLOCKED rounds + medium fixes)
- M6B-004 (was PREP-001): APPROVED
- M6B-005 (was PREP-002): APPROVED
- M6B-006 (was PREP-003): APPROVED (2 BLOCKED rounds)
- M6B-007 (was PREP-007): APPROVED (2 BLOCKED rounds + medium fix)
- M6B-009 (was PREP-005): APPROVED

NOT YET SPRINT-REVIEWED — must be reviewed before implementation begins:
- M6B-001 (PID lock file) — REVIEWED, all findings fixed; APPROVED
- M6B-008 (manifest poll loop)
- M6B-010 (directory state restoration)
- M6B-011 (ops-agent UX)
- M6B-012 (persist-019 Uint8Array test)
- M6B-013 (SQLCipher replacement)

REMOVED (already implemented before story was written):
- M6B-003 — seal_deferred reconnect+retry: both fixes landed in cello-client commit
  39a0c6a (Merge fix/seal-reconnect-retry) on 2026-06-03. Story file deleted.

Implementation agents may begin in any order within each group:

**No dependencies — dispatch immediately in any combination:**
M6B-001, M6B-002, M6B-004, M6B-005, M6B-006, M6B-009, M6B-010, M6B-011, M6B-012

**Wait for M6B-006 to merge:** M6B-007, M6B-008

**Wait for M6B-005 to merge:** M6B-013
