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
| M7-E2E-001 — Integration gate | — | written — cohesion pass pending | Written 2026-06-11; cohesion pass required after all component stories written |
| M7-DAEMON-001 — Daemon foundation | — | written — review pending | Written 2026-06-11 |
| M7-MCP-001 — MCP adapter | — | written — review pending | Written 2026-06-11; blocked on M7-DAEMON-001 for implementation |
| M7-DAEMON-002 — Ephemeral session nodes | — | written — review pending | Written 2026-06-12; blocked on M7-DAEMON-001 for implementation |
| M7-WIRE-001 — SessionAssignment wire format | — | not started | Blocked on M7-DAEMON-002; cross-repo; batch with M7-SESSION-001 + M7-MANIFEST-002 |
| M7-TRANSPORT-001 — AutoNAT + direct P2P | — | not started | Blocked on M7-WIRE-001 |
| M7-SESSION-001 — Interrupted session handling | — | not started | Blocked on M7-DAEMON-002 + M7-WIRE-001 |
| M7-SIGNAL-001 — Signaling stream resilience | — | written — review pending | Written 2026-06-12; blocked on M7-DAEMON-001 for implementation |
| M7-DAEMON-003 — Nonce dedup + retry queue | — | not started | Blocked on M7-DAEMON-002 |
| M7-MCP-002 — Agent-aware notifications | — | not started | Blocked on M7-MCP-001 + M7-DAEMON-002 + M7-DAEMON-003 |
| M7-MANIFEST-001 — Manifest schema | — | written — review pending | Written 2026-06-12; independent; no other story blocks it |
| M7-MANIFEST-002 — Client verification + polling | — | not started | Blocked on M7-DAEMON-001 + M7-MANIFEST-001 |
| M7-CICD-001 — Cross-repo CI/CD | — | written — review pending | Written 2026-06-12; independent; no other story blocks it |

### Migration Version Registry

No Flyway migrations in M7. If any story discovers a DB schema change is needed,
claim a version here before writing the migration.

| Version | Story | Status |
|---------|-------|--------|
| (none yet) | | |

### Package Ownership

| Package | Story | Notes |
|---------|-------|-------|
| `packages/daemon` (new) | M7-DAEMON-001 | Created by DAEMON-001; DAEMON-002, SIGNAL-001, DAEMON-003 add to it |
| `packages/cli` (new) | M7-DAEMON-001 | Created by DAEMON-001 |
| `packages/adapter-claude-code` | M7-MCP-001, M7-MCP-002 | Major rewrite in MCP-001; MCP-002 adds notifications |
| `packages/transport` | M7-TRANSPORT-001, M7-SIGNAL-001 | SIGNAL-001 adds signaling manager; TRANSPORT-001 adds AutoNAT |
| `packages/protocol-types` | M7-WIRE-001, M7-MANIFEST-001 | Wire format extensions + manifest schema |
| `packages/client` | M7-WIRE-001, M7-SESSION-001, M7-DAEMON-003 | Session assignment + interrupted handling + nonce dedup |
| `packages/crypto` | M7-MANIFEST-001 | Manifest schema crypto |
| `packages/relay` | M7-WIRE-001, M7-SESSION-001 | Wire format + interrupted frame |
| `packages/directory` | M7-WIRE-001, M7-MANIFEST-002 | Wire format + challenge signing |
| `packages/e2e-tests` | M7-E2E-001 | Integration gate |
| `infra/` | M7-CICD-001 | CI/CD pipeline changes |

### Cross-Repo Pipeline Batching

S4, S6, and S12 all require directory/relay CloudFormation deploys (~25-30 min).
**Never push one of these stories alone.** Before any pipeline push that includes
directory or relay changes, ask: are S4, S6, and S12 all ready to batch?

Current batch status:
- M7-WIRE-001 ready to batch: **no**
- M7-SESSION-001 ready to batch: **no**
- M7-MANIFEST-002 ready to batch: **no**

### Blocked / Waiting

_(empty — no current blockers)_

---

## Log

_(append new entries below this line — newest at bottom)_

### 2026-06-11 — COORDINATION.md created

Coordination file and WORKLOG.md created at M7 start. Claims section populated
from outline.md story table. No stories assigned yet. M7-E2E-001 (integration
gate / E2E story) will be written first per `/cello-story` rules, then revised
after all component stories are written for cohesion.

### 2026-06-11 — M7-DAEMON-001 written

CELLO-M7-DAEMON-001 YAML written. Resolves the E2E-001 AC-002b design question:
cello login does NOT auto-start agents. Registered state is observable after
login; Online requires explicit cello_start_agent (MCP-001 scope). Story marked
written — review pending. Sprint reviewer dispatched.

### 2026-06-12 — M7-DAEMON-002 written

CELLO-M7-DAEMON-002 YAML written. Covers SessionNodeManager (new component at
packages/daemon/src/session-node-manager.ts), standing receiver node (pre-created
at startup, handed to inbound session, replaced immediately), connectionGater per
session node (designated counterparty only), directory-facing node gater (DirectoryPeerIdProvider
stub in DAEMON-002; MANIFEST-002 wires the real check), 32-node cap, SQLite
interrupted session marking on graceful shutdown and SIGKILL recovery at login,
and standing_receiver_ready field added to cello status. Story marked written —
review pending.

### 2026-06-11 — M7-MCP-001 written

CELLO-M7-MCP-001 YAML written. Specifies the MCP adapter rewrite as a thin
stdio-to-IPC proxy. Key decisions: all key material and protocol objects removed
from cello-mcp.ts; four new tools (cello_start_agent, cello_use_agent,
cello_stop_agent, cello_list_agents); per-connection current agent state held in
daemon; full M7 error surface map coverage for MCP failure codes; SI-001 (cross-
connection leakage impossible), SI-002 (no key material in adapter, grep-verifiable);
opts.ipcClients fixture extension for multi-connection integration tests. Story
marked written — review pending.

### 2026-06-12 — M7-MANIFEST-001 written

CELLO-M7-MANIFEST-001 YAML written. Key decisions: ConsortiumManifest and
OfficerSignature types in protocol-types; canonicalManifestBody (sorted keys, no
whitespace) and verifyManifest (t-of-n Ed25519, dedup by officerIndex) in crypto;
CONSORTIUM_ROOT_KEYS (5 placeholder hex values pre-ceremony) and TEST_CONSORTIUM_ROOT_KEYS
(5 deterministic test keys, disjoint from production) in consortium-keys.ts; officer
key ceremony spec documented in implementation_notes (jurisdiction requirement: ≥3
distinct legal jurisdictions). 'manifest_version_rollback' and 'manifest_expired'
error codes defined as constants; runtime enforcement deferred to MANIFEST-002. No
log events emitted by this story — observability lives in MANIFEST-002's transport
layer. Story marked written — review pending. AC-015 and AC-016 are the version-bump
gate; MANIFEST-001 touches only crypto and protocol-types in cello-client.

### 2026-06-12 — M7-CICD-001 written

CELLO-M7-CICD-001 YAML written. Key decisions: GitHub Actions in cello-client is
the authoritative publish gate (direct StartPipelineExecution call + poll); the
webhook/pipeline-filter Lambda route is secondary/observability only. OIDC role
(GitHubOidcRole) grants StartPipelineExecution on cello-e2e-tests-pipeline only
— SI-001 forbids escalation to other pipelines. Candidate tarballs uploaded to
s3://cello-artifacts-dev/candidates/{sha}/ with 7-day lifecycle TTL. CodeBuild
install phase is bifurcated: CELLO_CANDIDATE_SHA set → install from S3 tarball;
unset → install from npm registry. Dead pipeline cleanup (cello-crypto-pipeline,
cello-transport-pipeline, cello-client-pipeline, cello-protocol-types-pipeline)
confirmed complete at CFN and mappings level; deploy-lambdas.sh dev filter run
is an explicit AC. Story marked written — review pending.

### 2026-06-12 — M7-SIGNAL-001 written

CELLO-M7-SIGNAL-001 YAML written. Addresses M6/M6B lesson L5 (silent signaling
stream death). Key decisions: heartbeat 15s interval + 15s pong timeout (30s
max detection window, matching E2E-001 AC-006 observable); backoff formula
min(initialMs * 2^(attempt-1), 60000ms), 10-attempt cap; 'lost' state reached
after exhaustion; 64-op FIFO outbound queue with full queue returning
signaling_queue_full immediately; full 7-step re-auth on reconnect (Q5
authoritative — no resume token); injectable connect() function (adapter
pattern — all backoff/queue logic testable without CELLO_E2E_LIVE); sovereign
node constraint: reconnect iterates entire manifest node list, not a hardcoded
endpoint. packages/transport/src/signaling-manager.ts is the primary new file.
Story marked written — review pending.
