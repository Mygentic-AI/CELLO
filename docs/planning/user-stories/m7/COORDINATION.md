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
| M7-E2E-001 — Integration gate | — | written — cohesion pass complete | Cohesion pass done 2026-06-12; implements last after all component stories land |
| M7-DAEMON-001 — Daemon foundation | — | **merged to main** | cello-client main; 52 tests |
| M7-DAEMON-002 — Ephemeral session nodes | — | **merged to main** | cello-client main; 76 tests |
| M7-DAEMON-003 — Nonce dedup + retry queue | — | **merged to main** | cello-client main; 112 tests |
| M7-MANIFEST-001 — Manifest schema | — | **merged to main** | cello-client main |
| M7-MANIFEST-002 — Client verification + polling | — | **merged to main** | cello-client main (both repos); 835 tests; adversarial review complete |
| M7-MCP-001 — MCP adapter | — | **merged to main** | cello-client main |
| M7-SIGNAL-001 — Signaling stream resilience | — | **merged to main** | cello-client main; 835 tests; two code-review rounds; nonce-cleared SI-003 fix |
| M7-WIRE-001 — SessionAssignment wire format | — | written — not yet started | Blocked on M7-DAEMON-002; cross-repo; batch with M7-SESSION-001 + M7-MANIFEST-002 |
| M7-TRANSPORT-001 — AutoNAT + direct P2P | — | written — not yet started | Blocked on M7-WIRE-001; cross-repo |
| M7-SESSION-001 — Interrupted session handling | — | written — not yet started | Blocked on M7-DAEMON-002 + M7-WIRE-001; cross-repo; batch with M7-WIRE-001 + M7-MANIFEST-002 |
| M7-DIR-PING-001 — Directory-side ping/pong handler | — | written — not yet started | Blocked on M7-SIGNAL-001; trustless-cello only |
| M7-MCP-002 — Agent-aware notifications | — | **implemented — PR ready** | branch m7/mcp-002 in cello-client; 175 daemon tests + 835 full suite; NotificationDispatcher with broadcast/single/filtered routing; 3 commits (fc4bc86, d9c9e6a, 0f6fee9) |
| M7-CICD-001 — Cross-repo CI/CD | — | written — not yet started | Independent; no deps; can start any time |

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
| `packages/protocol-types` | M7-WIRE-001, M7-MANIFEST-001, M7-SESSION-001 | Wire format extensions + manifest schema + SealInterruptedRequest signaling types |
| `packages/client` | M7-WIRE-001, M7-SESSION-001, M7-DAEMON-003 | Session assignment + interrupted handling + nonce dedup |
| `packages/crypto` | M7-MANIFEST-001 | Manifest schema crypto |
| `packages/relay` | M7-WIRE-001, M7-SESSION-001 | Wire format + interrupted frame |
| `packages/directory` | M7-WIRE-001, M7-MANIFEST-002, M7-SESSION-001 | Wire format + challenge signing + SealInterruptedRequest pass-through routing |
| `packages/e2e-tests` | M7-E2E-001 | Integration gate |
| `infra/` | M7-CICD-001 | CI/CD pipeline changes |

### Cross-Repo Pipeline Batching

S4, S6, and S12 all require directory/relay CloudFormation deploys (~25-30 min).
**Never push one of these stories alone.** Before any pipeline push that includes
directory or relay changes, ask: are S4, S6, and S12 all ready to batch?

Current batch status:
- M7-WIRE-001 ready to batch: **no**
- M7-SESSION-001 ready to batch: **no**
- M7-MANIFEST-002 ready to batch: **merged — no longer in batch queue**

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

### 2026-06-12 — M7-SIGNAL-001 review findings fixed

Fixed 3 issues from user review: (1) BLOCKING — directory-side ping handler
scoped out explicitly; added CELLO-M7-DIR-PING-001 to Claims as a new story
blocked on SIGNAL-001 (frame type must exist first), touches packages/directory
in trustless-cello; implementation_notes now states heartbeat will NOT be
functional until DIR-PING-001 lands. (2) MEDIUM — AC-005b renumbered to AC-006;
existing AC-006 through AC-013 shifted to AC-007 through AC-014. (3) MEDIUM —
explicit known limitation added to implementation_notes: no self-recovery from
'lost' state; operator must run cello logout + cello login after network restores.

### 2026-06-12 — M7-DAEMON-003 written

CELLO-M7-DAEMON-003 YAML written. Moves retry queue and nonce dedup from
packages/client into packages/daemon with SQLCipher persistence. Two new
inline-migration tables: retry_queue (FIFO per session, depth 1,000,
oldest evicted on overflow) and session_seen_nonces (per-session LRU,
10,000 entries). Key ACs: serialization round-trip with real Uint8Array
nonce (L1), startup loading before IPC socket opens (L2), composition root
wiring in server.ts verified via binary-start integration test (L3), lateral
catch audit across all catch blocks in packages/daemon and packages/client
(L6), anti-replay SI across restart boundary, retryQueueDepth field added
to cello status, packages/client stripped of all retry/dedup state (grep-
verified), and version bump gate. cello-client only — no trustless-cello
package.json update needed.

### 2026-06-12 — M7-WIRE-001 written

CELLO-M7-WIRE-001 YAML written. Extends SessionAssignment with 5 new fields
(initiator_session_peer_id, initiator_session_addrs, counterparty_session_peer_id,
counterparty_session_addrs, transport_mode) and extends the FROST TBS positional
array from 5 to 10 fields. Canonical address encoding: JSON.stringify(addrs.slice().sort()).
Context string "cello-frost-session-establishment-v1" unchanged. 18 ACs cover:
TypeScript schema change, TBS extension + determinism, directory producer via
real integration test, both client consumers (initiator self-check + target
connectionGater configuration), relay participant binding (relay-path only),
3 error codes (assignment_missing_session_peer_id, assignment_peer_id_mismatch,
assignment_tbs_verification_failed — distinct from frost_verification_failed),
transport_mode authority (never infer from address format), dead signaling channel
path, composition root AC, e2e fixture extension, version bump, and trustless-cello
dependency update. 3 SIs and 2 DBs. Story marked written — review pending.

### 2026-06-12 — M7-MANIFEST-002 written

CELLO-M7-MANIFEST-002 YAML written. Closes the directory trust gap identified in
the transport security audit: after step 4 the directory was sending a plain
signaling_auth_ok frame with no cryptographic proof of identity. Key decisions:

Step-6 TBS definition: 'cello-directory-auth-challenge-v1\n' + nodeId + '\n' +
agentPubkeyHex + '\n' + nonceHex + '\n' + isoTimestamp. Context string prefix
provides cross-protocol confusion defense; nonce inclusion prevents replay.

Four new adapter interfaces: IManifestVersionStore (SQLCipher-backed version
persistence), IManifestProvider (manifest loading + verification), IDirectoryChallengeVerifier
(Ed25519 step-6 check against manifest entry), IManifestPollScheduler (randomized
6–12h interval with injectable override for tests). All in packages/interfaces/;
local stubs for CELLO_ENV=local/test.

MANIFEST-001's verifyManifest, CONSORTIUM_ROOT_KEYS, makeTestManifest used
throughout. Step-5 directory side: packages/directory in trustless-cello adds
directoryKeyProvider injection; sends nodeId + signature in signaling_auth_ok.

Critical AC lessons baked in: AC-005 crosses real process restart boundary (L2
— in-memory state not loaded from DB at startup); AC-014 verifies composition
root wiring from binary entrypoint, not direct class construction (L3). AC-012
covers poll queuing during reconnecting state (SIGNAL-001 queue consistency).

Story marked written — review pending. SIGNAL-001 added as blocking dependency
(AC-012 requires the SIGNAL-001 outbound queue interface). Cross-repo: touches
packages/transport + packages/daemon (cello-client) and packages/directory
(trustless-cello). Must batch push with M7-WIRE-001 + M7-SESSION-001 per batch
gate in AC-017-trustless-cello-dependency-update.

### 2026-06-12 — M7-SESSION-001 written

CELLO-M7-SESSION-001 YAML written. Covers: relay session_interrupted frame
(new control frame type in packages/relay — relay-originated, no Merkle root,
no FROST ceremony); client-side detection on relay frame receipt (source:
'relay_frame') and relay stream close (source: 'stream_close'); SQLite status
transition to 'interrupted'; login surfacing via interrupted_sessions field
in cello status (sessionId, agentName, counterpartyPubkey, messageCount,
interruptedAt); graceful-shutdown extension (adds SQLite columns via inline
ALTER TABLE); bilateral seal-interrupted flow (SEAL-INTERRUPTED control
leaf exchange via directory signaling stream, then normal FROST seal with
'cello-frost-seal-v1' context string and merkleRootAtInterruption);
SealInterruptedRequest/Ack/Rejection signaling types in packages/protocol-types;
directory pass-through handlers for all three seal_interrupted signaling types;
4 new error codes (session_already_sealed, seal_interrupted_in_progress,
seal_interrupted_counterparty_unavailable, seal_interrupted_rejected_by_counterparty);
Q4 SI (no auto-seal on relay frame receipt); L7-guard ACs on relay stream
(AC-001) and directory signaling (AC-008b); lateral catch audit across
packages/relay, packages/daemon, packages/client; composition root wiring AC;
version bump (AC-017 covering protocol-types, client, daemon) and trustless-cello
dependency update (AC-018). Cross-repo: packages/directory + packages/relay
(trustless-cello) + packages/protocol-types + packages/daemon + packages/client
(cello-client). Must batch with M7-WIRE-001 + M7-MANIFEST-002 before any pipeline
push. Story marked written — review pending.

### 2026-06-12 — M7-MCP-002 written

CELLO-M7-MCP-002 YAML written. Adds agent field to all MCP notifications and
introduces three new notification types: agent_state_changed (broadcast to all
IPC connections), agent_current_changed (triggering connection only),
session_state_changed (connections where affected agent is current). Explicit
routing rules enforced in ACs via opts.ipcClients: 2 fixture extension — single-
connection tests cannot verify routing correctness. message.retry.evicted
confirmed as daemon-internal only (no MCP notification). 14 ACs: multi-connection
routing proof (AC-001 through AC-010), observability (AC-011), composition root
wiring (AC-012), lateral catch audit (AC-013), version bump (AC-014). 2 SIs:
session notification routing isolation, no key material in payloads. cello-client
only — touches packages/adapter-claude-code and packages/daemon. No trustless-cello
dependency update needed (no directory/relay changes). Story marked written —
review pending.

### 2026-06-12 — M7-TRANSPORT-001 written

CELLO-M7-TRANSPORT-001 YAML written. Adds AutoNAT client service to standing
receiver and session nodes (packages/transport/src/node.ts), exposes dialability
observable ({ dialable, publicAddr }), implements three-step transport selection
(direct → relay fallback → dcutr upgrade), and enables AutoNAT service protocol
on directory nodes (one-line addition in trustless-cello/packages/directory).
Key decisions: IAutoNatService + ITransportSelector interfaces in packages/interfaces/
with local stubs; directory nodes as probers (from manifest, sovereign-independent);
conservative fallback on autonat_unavailable (assume not dialable); dcutr is
non-fatal best-effort; transport_mode from WIRE-001 is sole authority for dial
strategy (never infer from address format). 19 ACs cover: AutoNAT in createNode
(AC-001/002), dialability observable (AC-003/004), direct dial (AC-005), relay
fallback (AC-006), dcutr (AC-007), relay_fallback_also_failed (AC-008), adapter
interfaces (AC-009), composition root (AC-010), directory AutoNAT service (AC-011),
E2E live tests (AC-012/013), lateral catch audit (AC-014), transport_mode authority
(AC-015), regression (AC-016), version bump (AC-017), trustless-cello update
(AC-018), autonat-after-reconnect (AC-019). 3 SIs: transport_mode authority,
prober identity verification, dcutr non-disruption. 2 DBs. Cross-repo: packages/
transport + packages/interfaces (cello-client) and packages/directory (trustless-cello).
Story marked written — review pending.

### 2026-06-12 — Claims table synced to implementation reality

DAEMON-001 implemented and reviewed (branch m7/daemon-001, 52 tests, all findings
fixed). DAEMON-002 in progress (branch m7/daemon-002, stacked on daemon-001).
MANIFEST-001 in progress (branch m7/manifest-001). MANIFEST-002 kicked off
(branches in both repos, stacked on manifest-001). MCP-001 and SIGNAL-001 unlocked
by DAEMON-001 but not yet started. All other stories unchanged.

Rule added to all future kickoff prompts: COORDINATION.md Claims update + log
entry are a hard gate step in the sprint-coder's completion sequence, same weight
as lint and typecheck. Agents that skip this step have not completed the story.

### 2026-06-12 — M7-DAEMON-002 implemented

Branch `m7/daemon-002` in cello-client (worktree at `/Users/andrep/Documents/code/cello-client-m7-daemon-002`). 76 tests (28 in session-node-manager.test.ts + 48 existing). Implementation:

- `SessionNodeManager` (new): ephemeral libp2p node lifecycle, 32-node cap, standing receiver with bounded retry (3 attempts), SQLite tracking, SIGKILL orphan detection at startup, gracefulShutdown batch-UPDATE
- `SessionConnectionGater` / `DirectoryConnectionGater` (new): inbound AND outbound encrypted connection denial, single-peer allowlists, shared #denyIfNotAllowed / #denyIfNotDirectory helpers
- `ISessionNodeFactory`: adapter pattern for test injection (FailingNodeFactory, StubNodeFactory, RealNodeFactory in tests)
- Transport: `connectionGater` option added to `CreateNodeOptions` and spread into createLibp2p config
- Composition root: `daemon.ts` wires SessionNodeManager, calls initialize() before IPC socket opens

Key bugs found and fixed during review:
- gracefulShutdown emitted `session.node.destroyed` even when `stop()` threw (fixed: .then/.catch ordering)
- INSERT OR REPLACE silently overwrote created_at on duplicate sessionId (fixed: plain INSERT)
- Standing receiver replacement had no retry (fixed: 3-attempt exponential backoff)
- AC-012 test was hollow — conditional assertion could pass with zero checks (fixed: unconditional + server stop)
- DirectoryConnectionGater had no outbound gate (fixed: symmetric denyOutbound)

Unblocks: M7-DAEMON-003, M7-WIRE-001, M7-SESSION-001, M7-MCP-002.

### 2026-06-12 — M7-MANIFEST-002 all reviews passed

Branch `m7/manifest-002` in both repos. Three rounds of code review + one sprint
review, all findings fixed. Final state: 815 cello-client tests (54 files) + 6
directory tests passing; typecheck and lint clean.

Code-review findings fixed across 3 rounds:
- Round 1 (8 findings): IManifestProvider.updateManifest(), event name alignment,
  test assertion precision, missing edge cases
- Round 2 (3 findings): CRITICAL — verifyManifest() in poll handler (threshold
  sig verification was missing); HIGH — not_before validity check; HIGH — malformed
  pubkey reason code
- Round 3: ZERO findings — clean pass

Sprint-review findings (4 blocking, all fixed):
1. IDirectoryChallengeVerifier boolean → ChallengeVerifyResult discriminated union
2. version <= → version < (equal version is valid, not rollback)
3. AC-005 process-restart boundary test (FileManifestVersionStore + binary spawn)
4. AC-015 event-ordering test (manifest.verified before daemon.started)

Commits: 5d433cc, 5d58cb1, 376e62a (cello-client branch m7/manifest-002).
Batch gate: NOT pushed — waiting for M7-WIRE-001 + M7-SESSION-001.

### 2026-06-12 — M7-MCP-001 implemented

Branch `m7/mcp-001` in cello-client (worktree at `/Users/andrep/Documents/code/cello-client-m7-mcp-001`). Stacked on m7/daemon-003. 11 adapter proxy tests + 28 daemon agent-lifecycle tests. Implementation:

- `IpcProxy` (new): thin JSON-newline-over-Unix-socket client with request/response correlation, buffer overflow protection (1MB), orphaned response warnings, and connection loss detection
- `cello-mcp.ts` (rewritten ~230 lines): --version flag, TTY detection, stderr tee to /tmp/cello-mcp-stderr.log, daemon.sock connect, ipc.connect frame, 14 MCP tools registered as IPC proxies
- `daemon.ts` (extended): perConnectionState Map, onlineAgents Set, handlers for ipc.connect / cello_start_agent / cello_stop_agent / cello_use_agent / cello_list_agents / cello_status, no_current_agent guard on 7 session tools, onDisconnect cleanup
- `ipc-server.ts` (modified): connectionId passed to handlers, onDisconnect hook, daemon.ipc.accepted event (distinct from handler's daemon.ipc.connected)

Key decisions:
- No key material in adapter (grep-verified: SI-002)
- Per-connection isolation: separate connectionId, separate currentAgent, no cross-connection leakage (SI-001)
- agent_already_current is an error (not idempotent) — distinct from agent_not_online
- Session tools return not_implemented stub with correct no_current_agent guard (SIGNAL-001 wires real routing)
- AC-021 (taxonomy update in trustless-cello) deferred — requires separate commit in trustless-cello

Code-reviewer findings (9 total — 3 CRITICAL, 2 HIGH, 2 MEDIUM, 2 LOW):
- All fixed in commit 454fb04

Sprint-reviewer findings (2 MEDIUM, 2 LOW):
- Double-logging fixed (daemon.ipc.accepted vs daemon.ipc.connected)
- cello_receive_session added to guard
- cello_list_sessions + cello_receive_session added to AC-007 test
- (AC-015 fixture extension deferred — lives in trustless-cello e2e-tests)

All fixed in commit ef8f717. Unblocks: M7-MCP-002.

### 2026-06-12 — M7-DIR-PING-001 written

CELLO-M7-DIR-PING-001 YAML written. Directory-side ping/pong handler for signaling
heartbeat frames. The directory receives ping frames on authenticated signaling
streams and responds with pong frames within 1 second. No state persistence, no
blocking operations — pure responder. Key decisions: DEBUG-level observability
(fires every 15s per client, INFO would spam logs); client owns heartbeat detection
logic (directory only echoes back); pong failures logged but do NOT terminate the
stream (client timeout detects the failure); composition root AC verifies handler
is reachable from directory binary entrypoint (L3); lateral catch audit covers all
catch blocks in packages/directory/src/ (L6). 8 ACs cover: basic ping/pong with
1-second response (AC-001), multi-client routing isolation (AC-002), no blocking
operations (code review, AC-003), stream write error handling (AC-004), log spam
prevention (AC-005), composition root wiring via integration test (AC-006), lateral
catch audit (AC-007), CI/CD pipeline push (AC-008). 1 SI: no blocking in handler
(burst load test with 100 pings). trustless-cello only — touches packages/directory;
no cello-client package changes. Completes the end-to-end heartbeat path started by
SIGNAL-001. Story marked written — review pending.
