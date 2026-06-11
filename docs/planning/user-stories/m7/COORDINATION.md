---
name: M7 Coordination
type: coordination
date: 2026-06-11
milestone: M7
description: >
  Coordination file for M7 — Daemon Architecture & Ephemeral Session Transport.
  Two sections: (1) Claims — edit in place to reflect current state. (2) Log — append only, never edit entries.
---

# M7 Coordination

## How to use this file

**Claims section (above the log separator):** edit in place. When you claim a
story, change its Status. When you discover a blocker, add it. When a story
closes, mark it done and remove it from the Blocked list. Keep this section
short — it is read by every agent before starting work. It should always
answer: "what can I touch, what is claimed, what is blocked?"

**Log section (below the log separator):** append only. Add a dated entry for
anything useful: what you tried, what happened, a decision you made mid-story,
a constraint you discovered, an AC you interpreted. Never edit or delete
existing entries — they are the audit trail.

**Graduate rules to permanent homes.** When a log entry produces a durable rule
(e.g. "always restart relay after directory redeploy"), promote it to one of:
- `outline.md` Constraints or Lessons section
- `CLAUDE.md`
- The milestone writeup (`docs/planning/milestone-writeups/M7-*.md`)

The log entry stays as history. The rule must not live only in the log.

---

## Claims

### Story Ownership

| Story | Assigned to | Status | Notes |
|-------|-------------|--------|-------|
| S1 — Daemon foundation | — | not started | |
| S2 — MCP adapter | — | not started | Blocked on S1 |
| S3 — Ephemeral session nodes | — | not started | Blocked on S1 |
| S4 — SessionAssignment wire format | — | not started | Blocked on S3; cross-repo; batch with S6/S12 before pipeline push |
| S5 — AutoNAT + direct P2P | — | not started | Blocked on S4 |
| S6 — Interrupted session handling | — | not started | Blocked on S3, S4 |
| S7 — Signaling stream resilience | — | not started | Blocked on S1 |
| S8 — Nonce dedup + retry queue | — | not started | Blocked on S3 |
| S9 — Agent-aware notifications | — | not started | Blocked on S2, S3, S8 |
| S10 — M7 integration gate (E2E) | — | not started | Written first; implemented last |
| S11 — Manifest schema + initial manifest | — | not started | Independent; key ceremony is pre-implementation work |
| S12 — Client verification + handshake step 6 + polling | — | not started | Blocked on S1, S11 |
| S14 — Cross-repo CI/CD | — | not started | Independent |

### Migration Version Registry

No Flyway migrations in M7. If any story discovers a DB schema change is needed,
claim a version here before writing the migration.

| Version | Story | Status |
|---------|-------|--------|
| (none yet) | | |

### Package Ownership

| Package | Story | Notes |
|---------|-------|-------|
| `packages/daemon` (new) | S1 | Created by S1; S3, S7, S8 add to it |
| `packages/cli` (new) | S1 | Created by S1 |
| `packages/adapter-claude-code` | S2, S9 | Major rewrite in S2; S9 adds notifications |
| `packages/transport` | S5, S7 | S7 adds signaling manager; S5 adds AutoNAT |
| `packages/protocol-types` | S4, S11 | Wire format extensions |
| `packages/client` | S4, S6, S8 | Session assignment + interrupted handling + nonce dedup |
| `packages/crypto` | S11 | Manifest schema crypto |
| `packages/relay` | S4, S6 | Wire format + interrupted frame |
| `packages/directory` | S4, S12 | Wire format + challenge signing |
| `packages/e2e-tests` | S10 | Integration gate |
| `infra/` | S14 | CI/CD pipeline changes |

### Cross-Repo Pipeline Batching

S4, S6, and S12 all require directory/relay CloudFormation deploys (~25-30 min).
**Never push one of these stories alone.** Before any pipeline push that includes
directory or relay changes, ask: are S4, S6, and S12 all ready to batch?

Current batch status:
- S4 ready to batch: **no**
- S6 ready to batch: **no**
- S12 ready to batch: **no**

### Blocked / Waiting

_(empty — no current blockers)_

---

## Log

_(append new entries below this line — newest at bottom)_

### 2026-06-11 — COORDINATION.md created

Coordination file and WORKLOG.md created at M7 start. Claims section populated
from outline.md story table. No stories assigned yet. S10 (integration gate /
E2E story) will be written first per `/cello-story` rules.
