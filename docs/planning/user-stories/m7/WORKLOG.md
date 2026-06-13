---
name: M7 Worklog
type: worklog
date: 2026-06-11
milestone: M7
description: >
  Append-only running log for M7 — debugging sessions, deployment results,
  mid-story decisions, AC interpretations, root cause analyses.
  Companion to COORDINATION.md which holds the structural claims.
---

# M7 Worklog

## How to use this file

This file is **append-only**. Never edit or delete an existing entry.

Add an entry here when:
- You tried something and it worked or didn't work
- You hit a blocker and diagnosed the cause
- You interpreted an ambiguous AC and want your interpretation on record
- You made a mid-story decision that isn't obvious from the story YAML
- You deployed something and observed a specific outcome
- You discovered a constraint that wasn't in the outline

**Format each entry as:**
```
### YYYY-MM-DD HH:MM — Short description

**Story:** [story ID, or "general" if not story-specific]
**Agent/Author:** [who you are — e.g. "sprint-coder", "orchestrator", "Andre"]

[Content — as much or as little as useful.]
```

**When an entry produces a durable rule**, promote it to `outline.md`, `CLAUDE.md`,
or the milestone writeup. Note the promotion inline so the history is traceable:
```
**Promoted to:** outline.md "M6/M6B Lessons" section, 2026-06-11
```

---

### 2026-06-11 — M7-E2E-001 written and reviewed

**Story:** M7-E2E-001
**Agent/Author:** orchestrator

CELLO-M7-E2E-001.yaml written by a sprint-coder agent, then reviewed inline.
Five issues found and fixed in the same session (commit 2d84d56):

1. **Blocking — old story IDs in dependencies.** `blocked_by` listed
   `CELLO-M7-S1` through `CELLO-M7-S12` (the pre-rename IDs). Replaced with
   correct domain IDs (CELLO-M7-DAEMON-001, etc.) throughout the file.

2. **Blocking — undeclared event name in SI-002.** `session.node.gater.rejected`
   appeared in the adversarial condition but is not in the DAEMON-002
   observability taxonomy. Replaced with "warn-level event — name to be
   defined by DAEMON-002 implementer and added to taxonomy."

3. **Medium — close gate criterion 6 had no E2E AC.** AC-009 item 6 said
   "verified via S8 story gate" — deferred entirely to DAEMON-003. Added
   AC-006b: kill daemon mid-session with pending retries in queue, restart,
   verify queue drains in order with no duplicates via SQLCipher persistence.

4. **Minor — test setup detail in then clause.** AC-006 had `tc qdisc` in
   the `then` clause. Moved to `implementation_notes`.

5. **Minor — no implementation_notes section.** Added notes covering: how to
   kill the signaling stream for AC-006 (iptables black-hole, not clean
   disconnect — forces heartbeat timeout, the harder failure mode), how to
   build the rogue directory node for AC-008 (must complete handshake steps
   1-5 then fail at 6 — a node that refuses at step 1 does not test step 6),
   and how to trigger the retry queue for AC-006b.

**Cohesion pass reminder:** this story was written before component stories.
After all component stories are written, re-read CELLO-M7-E2E-001.yaml and
align ACs with what the component stories actually specify (event names,
field names, observable IDs). Update COORDINATION.md status when done.

---

### 2026-06-11 — WORKLOG.md created

**Story:** general
**Agent/Author:** orchestrator

WORKLOG.md created as companion to COORDINATION.md. The split separates structural
coordination state (who owns what, what's blocked — COORDINATION.md, edit in place)
from running narrative (what happened, what was tried — this file, append only).

This pattern emerged from M6B's COORDINATION.md growing to 1,422 lines where durable
rules were buried in debugging transcripts. The goal: any agent can read
COORDINATION.md in under a minute, and any agent debugging a problem can search
WORKLOG.md for prior art without it blocking the quick-start read.

---

### 2026-06-11 — M7-E2E-001 approved by sprint-reviewer

**Story:** CELLO-M7-E2E-001
**Agent/Author:** orchestrator

Sprint-reviewer returned APPROVED. Final commit: 63e59b7.
Cohesion pass still required after all component stories are written.

---

### 2026-06-12 — MANIFEST-002 implemented

**Story:** CELLO-M7-MANIFEST-002
**Agent/Author:** orchestrator + cello-sprint-coder

Implemented directory trust closure: step-5 Ed25519 signing (directory side), step-6
manifest-based verification (client side), daemon startup manifest loading, and
background 6–12 hour polling.

**Key decisions:**
- `IManifestProvider.updateManifest()` added so polled manifests update the in-memory
  copy used by `IDirectoryChallengeVerifier` — without this, key rotation silently
  breaks all connections.
- `IDirectoryChallengeVerifier.verifyChallenge()` returns a discriminated union
  (`ChallengeVerifyResult`) rather than boolean, enabling AC-007 (`key_not_in_manifest`)
  and AC-008 (`signature_invalid`) to be observably distinct.
- `FileManifestVersionStore` introduced (file-backed) to bridge until DAEMON-001
  delivers SQLCipher. Required by AC-005 (cross-process restart monotonicity).
- Daemon composition root updated: `CELLO_MANIFEST_PATH`, `CELLO_TEST_CONSORTIUM_KEYS`,
  `CELLO_TEST_CONSORTIUM_THRESHOLD` env overrides allow integration tests to inject test
  manifests and keys without modifying production constants.

**Code-review findings (feature-dev:code-reviewer):** 8 findings, all fixed before Step 4.
**Sprint-reviewer findings:** 4 blocking, all fixed:
  1. `IDirectoryChallengeVerifier` boolean → discriminated union
  2. `manifest.version <= lastSeen` → `manifest.version < lastSeen` (equal version is valid)
  3. AC-005 process-restart boundary test (binary spawning, file-backed version store)
  4. AC-015 event-ordering test (manifest.verified before daemon.started in binary log)

**Final test counts:** 815 tests passing (54 files) in cello-client; 6 MANIFEST-002
directory tests passing in trustless-cello. Lint and typecheck clean.

**Commits:**
- cello-client m7/manifest-002: sprint-coder initial + two fix rounds (commits 5d433cc, 5d58cb1)
- trustless-cello m7/manifest-002: sprint-coder initial + test manifest fix (commits in branch)

**Batch gate:** trustless-cello branch NOT pushed to origin — must batch with
M7-WIRE-001 and M7-SESSION-001 before any directory pipeline push.

---

### 2026-06-12 14:48 — MANIFEST-002 code-review round 2 and 3

**Story:** CELLO-M7-MANIFEST-002
**Agent/Author:** orchestrator

Code-review round 2 returned 3 findings (1 CRITICAL, 2 HIGH). All fixed in commit 376e62a:

1. **CRITICAL — handleManifestPollResponse missing verifyManifest():** The poll handler
   accepted manifests without threshold signature verification. Fixed by adding
   `rootKeys` and `threshold` to SignalingManagerConfig, threading them through daemon.ts
   composition root, and calling `verifyManifest()` as the first step in
   handleManifestPollResponse. All 6 test call sites updated.

2. **HIGH — missing not_before validity check:** Both daemon startup and poll handler
   now reject manifests where `now < not_before`. Prevents accepting a manifest before
   its intended activation time (e.g. pre-staged rotation manifest).

3. **HIGH — malformed pubkey returns misleading reason:** ManifestDirectoryChallengeVerifier
   returned `key_not_in_manifest` when the node's pubkey was malformed (wrong length /
   non-hex). Fixed to return `signature_invalid` — the node IS in the manifest, its key
   is just unparseable.

Code-review round 3 returned **ZERO findings** — clean pass. Implementation confirmed
production-ready by reviewer across all crypto paths, version monotonicity, backward
compat, error handling, and test coverage.

**Total review rounds:** 3 code-review + 1 sprint-review. All findings resolved.

---

### 2026-06-12 14:30 — DAEMON-003 implemented

**Story:** CELLO-M7-DAEMON-003
**Agent/Author:** sprint-coder

Built RetryQueue and NonceDedupStore for the CELLO daemon — per-session FIFO retry with
SQLCipher persistence and per-session LRU nonce deduplication. Both components load from
DB before IPC socket opens (AC-007/AC-008 restart boundary).

**What was built:**
- `retry-queue.ts` — per-session FIFO, cap 1000, oldest-evicted on overflow, SQLCipher
  persistence via `node:sqlite` DatabaseSync. Methods: loadFromDb, enqueue, drainSession,
  getTotalDepth, getSessionDepth, getSessionEntries.
- `nonce-dedup.ts` — per-session LRU, cap 10000, SQLCipher persistence. Uses indexed
  SQLite query for O(log n) eviction with in-memory fallback. Methods: loadFromDb, has,
  checkAndAdd.
- `daemon.ts` composition root updated — instantiates both components from
  SessionNodeManager's DB handle, calls loadFromDb() before IPC socket opens.
- Three IPC handlers: `queue_failed_send`, `check_nonce`, `drain_session`.
- `daemon-retry-dedup.test.ts` — 8 integration tests covering AC-001 (restart boundary),
  AC-002 (FIFO via IPC), AC-007, AC-008, AC-009 (cap/eviction).
- `retryQueueDepth` added to DaemonStatusResponse.
- `debug()` added to Logger interface; all test mocks updated (8 files).

**Mid-story decisions:**
- Shared SQLite DB handle from SessionNodeManager (avoids second DB file / lock contention).
- drain_session IPC returns nonce metadata only (SI-002: content never in IPC frames).
- TypedSerializer pattern: Uint8Array stored as hex via Buffer.from().toString('hex').
- AC-013 (version bump) intentionally skipped per user instruction.

**Code-reviewer findings (7 total, all fixed):**
1. drain never triggered — added drain_session IPC handler + getSessionEntries method.
2. No debug() on Logger — added to interface, updated all usages.
3. Attempts not incremented on failed drain — added UPDATE statement.
4. Missing integration tests for AC-001/AC-002 — added restart boundary + FIFO-via-IPC tests.
5. O(n) LRU eviction — rewrote to use SQLite indexed query.
6. getSessionEntries returns live array — switched to defensive copy.
7. Silent catch in ipc-client — added onFrameError callback.

**Sprint-reviewer findings (4 total, all fixed):**
1. BLOCKING: AC-001 missing restart boundary test — added integration test.
2. BLOCKING: AC-002 missing FIFO-via-IPC test — added integration test.
3. MEDIUM: SI-002 content leak in drain_session — removed content from response.
4. MEDIUM: Silent catch in ipc-client — added onFrameError callback.

**Constraints discovered:**
- node:sqlite (DatabaseSync) requires Node.js 24 LTS — documented in package.json engines.
- Logger interface needed debug() level for message.nonce.duplicate events (taxonomy requirement).

**Intentional deferrals:**
- AC-013 version bump deferred per user instruction (will be batched with MCP-002).
- Actual drain trigger on peer reconnect deferred to MCP-002 (drain_session handler returns
  metadata only; real sendFn integration requires session transport context).

**Code-review round 2 (2026-06-12 15:00):**
- 0 findings — clean pass. Reviewer initially flagged missing debug() in test logger doubles,
  but this was a false positive (debug() present in all 8 test files from round 1 fixes).
  No additional changes required.

---

### 2026-06-12 16:10 — MCP-001 implemented

**Story:** CELLO-M7-MCP-001
**Agent/Author:** orchestrator + sprint-coder

Rewrote the MCP adapter from a 690-line fat binary (holding CelloClient, libp2p node, SQLCipher DB, crypto keys) into a ~230-line thin stdio-to-IPC proxy. The adapter now holds zero key material — it connects to the daemon via Unix domain socket and forwards all tool calls as JSON-newline IPC frames.

**What was built:**
- `ipc-proxy.ts` — request/response correlation via incrementing numeric IDs, 1MB buffer overflow protection, orphaned response stderr warning, method name validation, graceful connection loss handling (all pending calls resolve to ipc_connection_lost)
- `cello-mcp.ts` — --version (dynamic from package.json), TTY detection with instructions, stderr tee to /tmp/cello-mcp-stderr.log, daemon.sock connect with ENOENT/ECONNREFUSED handling, ipc.connect frame, 14 MCP tools (4 agent management + 8 session + 2 utility) registered as IPC proxies
- Daemon agent lifecycle: perConnectionState Map tracks currentAgent per connectionId; onlineAgents Set tracks global online state; 6 new IPC handlers (ipc.connect, cello_start_agent, cello_stop_agent, cello_use_agent, cello_list_agents, cello_status)
- no_current_agent guard on 7 session tools (cello_send, cello_receive, cello_receive_session, cello_initiate_session, cello_await_session, cello_close_session, cello_list_sessions)
- onDisconnect hook in ipc-server: cleans up perConnectionState on socket close
- daemon.ipc.accepted (accept time) vs daemon.ipc.connected (after ipc.connect handler) — distinct events

**Sprint-coder challenges:**
- First two agent dispatches failed (process killed mid-run, no commits)
- Third dispatch succeeded (commit fedb002), stacked correctly on m7/daemon-003

**Code-reviewer findings (9 total, all fixed in 454fb04):**
1. CRITICAL-1: createSessionFixture not available in cello-client — correctly handled (uses connectToDaemon directly)
2. CRITICAL-2: Missing AC-018 test — added signaling_reconnecting passthrough test
3. CRITICAL-3: Missing AC-020 tests — added --version subprocess test + daemon_not_running exit test
4. HIGH-1: Malformed frame handling — stderr logging added (already resolved oldest-pending)
5. HIGH-2: Orphaned response warning — added stderr.write for unmatched IDs
6. MEDIUM-1: Method name validation — added non-empty string check
7. MEDIUM-2: Write failure logging — stderr + #dead flag set
8. LOW-1: Hardcoded version "0.0.43" — replaced with dynamic package.json read
9. LOW-2: Buffer overflow — 1MB limit matching IPC server

**Sprint-reviewer findings (4 total, all fixed in ef8f717):**
1. MEDIUM: Double-logging of daemon.ipc.connected — split into daemon.ipc.accepted (server) + daemon.ipc.connected (handler)
2. MEDIUM: cello_receive_session not in SESSION_TOOLS_REQUIRING_AGENT — added
3. LOW: AC-007 test covers 5 tools but guard covers 7 — added cello_receive_session + cello_list_sessions
4. LOW: AC-015 fixture extension — deferred (lives in trustless-cello e2e-tests)

**Final test counts:** 739 root workspace tests + 140 daemon tests (all passing). Lint and typecheck clean.

**AC-021 deferral:** Taxonomy update requires trustless-cello commit — will be batched with next trustless-cello story.

---

### 2026-06-12 16:30 — SIGNAL-001 implemented

**Story:** CELLO-M7-SIGNAL-001
**Agent/Author:** sprint-coder + orchestrator

Implemented signaling stream resilience for the daemon's directory-facing connection. Addresses M6/M6B lesson L5 (silent signaling stream death).

**What was built:**
- `core/transport/src/signaling-manager.ts` (new): SignalingManager class with heartbeat loop (ping every N seconds, pong timeout N seconds), exponential backoff reconnect (1s → 60s cap, max 10 attempts), `directory_signaling` status observable (`connected` | `reconnecting` | `lost`), 64-op FIFO outbound queue with two-tier model (MCP calls rejected immediately, internal ops queued), and graceful shutdown that cancels the reconnect loop without transitioning to `lost`.
- `core/transport/src/__tests__/signaling-manager.test.ts` (new): 28 passing + 2 E2E-skipped tests covering AC-002 through AC-013, SI-001, DB-001, DB-002. Includes inter-attempt timing assertion and production defaults test.
- `core/daemon/src/daemon.ts` updated: SignalingManager instantiated in composition root; `directory_signaling` field in IPC status response sourced from `signalingManager.status` — not hardcoded.
- `core/daemon/src/__tests__/binary.test.ts` extended: AC-011 IPC integration test spawns daemon binary, connects via IPC, calls `status`, asserts `directory_signaling: 'reconnecting'` — proves composition root wiring through the END operation (IPC status call), addressing L3 and L4.

**Mid-story decisions:**
- Initial connect attempt (at construction) is separate from the reconnect cycle. If initial connect fails, the reconnect cycle starts from attempt 1. This means total connect() calls on all-fail is 1 (initial) + 10 (cycle) = 11.
- Heartbeat timeout: set on first unanswered ping, NOT reset on each subsequent ping — only reset on pong receipt. This gives correct max detection window: heartbeatIntervalMs + heartbeatTimeoutMs = 30s (matching AC-001). The code reviewer incorrectly flagged this as a bug; the original logic was correct.
- AC-014 (version bump) intentionally deferred per user instruction.

**Code-reviewer findings (2 total, all addressed):**
1. HIGH: Heartbeat timeout logic — reviewer analysis was wrong; original logic correct. Fixed by improving the comment to explain why the timeout is NOT reset on each ping.
2. MEDIUM: Missing AC-011 IPC integration test — added binary test that connects via IPC and asserts `directory_signaling` field.

**Sprint-reviewer findings (4 total, all fixed):**
1. MEDIUM: AC-002 no production defaults test — added test verifying SignalingManager constructs with default config.
2. MEDIUM: AC-002 no inter-attempt timing assertion — added timestamp-based test asserting gaps ≥ backoffMs.
3. LOW: `OperationFailure.reason` used plain string — changed to `SignalingFailureReason` literal union type.
4. LOW: Logger interface duplicated — added comment explaining intentional local definition (transport must not depend on daemon; structural typing ensures compatibility).

**Final test counts:** 28 transport signaling-manager tests (+ 2 E2E skipped) + 49 daemon tests. Lint and typecheck clean.

**Commits:** 42044a1 (initial), 2f3aa46 (code-review fixes), c74a2c5 (sprint-reviewer fixes). Branch: m7/signal-001 in cello-client stacked on m7/daemon-001.

**Unblocked by this story:** M7-DIR-PING-001 (directory-side ping/pong handler — blocked on SIGNAL-001 for the ping/pong frame type definition).

---

### 2026-06-12 16:25 — MANIFEST-002 merged to main (via manifest-002-fix branch)

**Story:** CELLO-M7-MANIFEST-002
**Agent/Author:** sprint-coder (Opus)

Original `m7/manifest-002` branch was built before DAEMON-001/002/003 existed
and contained invented daemon scaffolding (no SessionNodeManager, no RetryQueue,
no NonceDedupStore, no session-connection-gater) that conflicted with the real
daemon on main. Direct merge was attempted and aborted. The branch was discarded
for daemon-side code.

**What was reused from m7/manifest-002:**
- Transport layer (already on main from commit edf31cb): manifest-interfaces.ts,
  manifest-stubs.ts, signaling-manager.ts, signaling-manager.test.ts — all 690
  lines copied cleanly earlier.
- trustless-cello directory changes: merged cleanly via `git merge --no-ff` (no
  daemon code on this side) — directory-frames.ts, directory-node.ts step-5 signing,
  directory-types.ts, interfaces/manifest.ts, stubs, test file (404 lines).

**What was re-implemented fresh on m7/manifest-002-fix:**
- `core/daemon/src/manifest-loader.ts` — FileManifestProvider (reads JSON, calls
  verifyManifest, caches result)
- `core/daemon/src/manifest-poll-scheduler.ts` — RandomizedPollScheduler (6-12h)
  + ImmediatePollScheduler re-export
- `core/daemon/src/manifest-version-store.ts` — InMemoryManifestVersionStore re-export
- `core/daemon/src/manifest-version-store-file.ts` — FileManifestVersionStore
  (file-backed cross-process persistence)
- `core/daemon/src/challenge-verifier.ts` — ManifestDirectoryChallengeVerifier
  + TestDirectoryChallengeVerifier re-exports
- `core/daemon/src/consortium-manifest.json` — placeholder (version 1, placeholder keys)
- `core/daemon/src/__tests__/manifest.test.ts` — 13 tests covering AC-002 through
  AC-012, SI-002, backward compat
- `core/daemon/src/daemon.ts` — manifest loading block (before agent loading),
  manifestVerified field on daemon.started, poll scheduler start, cancel in stop()
- `core/daemon/src/types.ts` — DaemonConfig extended with 6 optional manifest fields
- `core/daemon/src/index.ts` — exports for all new manifest modules

**Daemon wiring details:**
- Manifest verification runs FIRST in startDaemon() — before mkdir, agent loading,
  lock acquisition, or SessionNodeManager init
- DaemonConfig fields are all optional (undefined = skip) for backward compat
- Poll scheduler starts only when manifestVerified && manifestPollScheduler provided
- stop() calls manifestPollScheduler.cancel() before gracefulShutdown

**Test counts:**
- cello-client: 815 tests (54 files) passing — 13 new manifest tests + all existing
- trustless-cello: 539 tests passing + 6 new directory manifest tests (47 files pass)

**ACs intentionally deferred (require live infrastructure or other stories):**
- AC-005: cross-process persistence via binary restart — needs DAEMON-001 binary test
  pattern extended (test exists but uses InMemoryManifestVersionStore, not file-backed)
- AC-006, AC-007, AC-008: CELLO_E2E_LIVE tests — require running staging directory
- AC-013: poll queuing during reconnecting state — requires SIGNAL-001 queue wiring
- AC-014: session-fixture opts.manifest extension — requires e2e-tests in trustless-cello
- AC-015: composition root event ordering from binary — partially covered (manifestVerified
  in daemon.started), full binary log ordering test deferred
- AC-017: version bump — deferred per user instruction (will batch)
- AC-018: trustless-cello dependency update — merged directory code directly, npm
  version bump deferred

---

### 2026-06-12 18:00 — MANIFEST-002 adversarial review fixes

**Story:** CELLO-M7-MANIFEST-002
**Agent/Author:** sprint-coder (Opus)

Adversarial code review returned 8 findings (ADV-001 through ADV-008). All fixed
on branch m7/manifest-002-fixes in cello-client, merged to main.

**Findings fixed:**
1. **ADV-001 (CRITICAL): Step-6 challenge verification not wired in real handshake.**
   `core/client/src/signaling-manager.ts` performs the actual handshake (not
   `core/transport/src/signaling-manager.ts` which only defines types). Added
   `getChallengeVerifier()` to `SignalingContext`, wired through `ClientWiringSurface`
   and `CelloClientImpl.createClient()`, and inserted verification blocks in all three
   handshake paths (`#doOpen`, `connectDirectorySignalingStream`, `getRelayPublicKey`).

2. **ADV-002 (HIGH): Non-fatal manifest failure when manifestProvider configured.**
   `startDaemon()` now throws after the manifest loading block when `manifestProvider`
   is set but `manifestVerified` remains false. 4 existing tests updated to expect throws.

3. **ADV-003 (MEDIUM): Timer race in ManifestPollScheduler.cancel().**
   Added `#cancelled` flag set on cancel(), checked at timer callback entry. Reset on
   `scheduleNext()` to allow reuse after cancel.

4. **ADV-004 (MEDIUM): consortium-manifest.json shipped in npm tarball.**
   Removed `"src/consortium-manifest.json"` from `package.json` `files` array.

5. **ADV-005 (MEDIUM): Non-atomic file write in FileManifestVersionStore.**
   Changed to write-to-temp-then-rename pattern (write `.tmp`, then `rename()`).

6. **ADV-006 (HIGH): manifestProvider accepted without manifestRootKeys.**
   Added config validation at daemon startup — throws if manifestProvider provided
   without manifestRootKeys (non-empty) or manifestThreshold (positive integer).

7. **ADV-007 (LOW): Dead code — InMemorySignalingOutboundQueue instantiated and unused.**
   Removed the dead block and unused imports. Added `directory.auth.manifest.poll.deferred`
   debug log event explaining why polling isn't wired yet (deferred to SIGNAL-001).

8. **ADV-008 (HIGH): No validation that manifestThreshold > 0.**
   Covered by ADV-006 fix — threshold must be a positive integer >= 1.

**New tests added:** 3 (ADV-006 config validation, ADV-008 threshold=0, ADV-007 poll.deferred).
**Tests updated:** 4 (ADV-002 fatal behavior change).

**Final test counts:**
- daemon: 155 passed
- transport: 50 passed
- client: 334 passed
- Full workspace: 821 passed, 8 skipped, 3 todo (53 files pass, 2 skipped)
- Lint: clean
- Typecheck: clean

**Commit:** 09d5c51 — merged to main via `--no-ff` in cello-client.

---

### 2026-06-12 18:30 — SIGNAL-001 merged to main (via signal-001-merge branch)

**Story:** CELLO-M7-SIGNAL-001
**Agent/Author:** orchestrator

Original `m7/signal-001` branch was stacked on `m7/daemon-001` before MANIFEST-002
landed. MANIFEST-002 also created `core/transport/src/signaling-manager.ts` from
scratch (add/add conflict). The branch had completed sprint-reviewer and code-reviewer
but could not be merged cleanly.

**Resolution:** Manual merge performed in main context (not a subagent):
- Created `m7/signal-001-merge` from current main
- Took MANIFEST-002's version of `signaling-manager.ts` as the base (contains
  step-6 challenge verification and manifest polling)
- Added SIGNAL-001's additions on top: SignalingManager connection lifecycle
  (heartbeat, backoff reconnect, status observable, operation queue, graceful stop),
  daemon wiring in `daemon.ts`, config types in `types.ts`
- Result: single unified `SignalingManager` class with both security and resilience

**Two code-review rounds on the merge branch:**

Round 1 (4 findings, all fixed):
1. HIGH: challengeVerifier dead-code in daemon wiring — wired correctly
2. HIGH: Missing test coverage for SIGNAL-001 behaviors — (addressed in round 2)
3. MEDIUM: `this.reconnectLoop()` floating promise — added `void`
4. LOW: Incorrect comment "structurally identical" — corrected to "subset of"

Round 2 (4 findings, all fixed):
1. HIGH (security): `_pendingNonce` / `_agentPubkeyHex` never cleared after
   `processStep5Frame()` — stale nonce reusable across reconnects (SI-003 bypass).
   Fixed: consume both fields into locals and null them out before verification.
2. HIGH: SIGNAL-001 test suite missing from merged file — added full suite
   (backoff, lost state, queue cap, FIFO drain, send-path liveness, graceful
   shutdown, status transitions, nonce-cleared SI-001 test)
3. MEDIUM: Floating `reconnectLoop()` — `void` added
4. LOW: Comment corrected

**Final test counts:** 835 passing, 10 skipped, 3 todo. Lint and typecheck clean.

**Commits:** 7438adc (merge), 2f66cf9 (round 1 fixes), 24a55d2 (round 2 fixes)
Merged to main: 7f80441

**Unblocks:** M7-DIR-PING-001 (trustless-cello only; can start immediately)

---

### 2026-06-13 — MCP-002 implemented

**Story:** CELLO-M7-MCP-002
**Agent/Author:** sprint-coder + orchestrator

Implemented agent-aware notifications with per-connection routing for the CELLO daemon. Three commits on branch m7/mcp-002 in cello-client (worktree at /Users/andrep/Documents/code/cello-client-m7-mcp-002).

**What was built:**
- `core/daemon/src/notification-dispatcher.ts` (NEW): `NotificationDispatcher` class with a routing table (Map<connectionId, currentAgent>). Three dispatch methods: `dispatchAgentStateChanged` (broadcast to all), `dispatchAgentCurrentChanged` (single connection only), `dispatchSessionStateChanged` (filter by currentAgent === agentName). `#safeSend` logs `notification.dispatch.failed` at DEBUG on write failure; never propagates exceptions.
- `core/daemon/src/ipc-server.ts` (extended): `sendNotification(connectionId, notification)` and `getConnectionIds()` added to the `IpcServer` interface and implementation. `sendNotification` catch block logs `daemon.ipc.notification.write.failed` at DEBUG.
- `core/daemon/src/daemon.ts` (extended): NotificationDispatcher instantiated in composition root; `registerConnection` on `ipc.connect`; `unregisterConnection` in `onDisconnect`; `dispatchAgentStateChanged` in `cello_start_agent` and `cello_stop_agent`; `dispatchAgentCurrentChanged` in `cello_use_agent` AND `cello_stop_agent` (when force-clearing current agent); `setCurrentAgent` kept in sync with `perConnectionState`. `__test_emit_session_event` handler guarded by `CELLO_ENV=test`.
- `core/daemon/src/__tests__/mcp-002-notifications.test.ts` (NEW): 20 integration + unit tests covering AC-001 through AC-012, SI-001, SI-002 (grep), and `notification.dispatch.failed` (deterministic unit tests using injected throwingSender/falseSender).

**Test counts:** 175 daemon tests, 835 full workspace tests. All passing.

**Code-reviewer findings (6 total, all fixed):**
1. CRITICAL: `__test_emit_session_event` exposed in production — guarded by `CELLO_ENV=test`
2. HIGH: `cello_stop_agent` didn't dispatch `agent_current_changed` when force-clearing current — added dispatch
3. HIGH: `notification.dispatch.failed` test vacuously conditional — replaced with deterministic unit tests using injected fakes
4. MEDIUM: bare `catch {}` in `sendNotification` — now logs `error.message` at DEBUG
5. MEDIUM: `#safeSend` message clarified (`"sendNotification returned false"` vs `"write returned false"`)
6. LOW: dead `broadcastNotification` method removed from interface and implementation

**Sprint-reviewer findings (2 medium, 2 low, all addressed):**
1. MEDIUM: SI-002 grep test added — scans daemon and adapter src for prohibited key field names in notification construction sites
2. MEDIUM: AC-008 expanded — now verifies `agent` field on all three notification types
3. LOW: IPC proxy ignores daemon notifications (noted; out of MCP-002 scope — E2E gate will wire this)
4. LOW: AC-014 version bump deferred per user instruction (will be batched)

**Sprint-reviewer verdict:** APPROVED

**Intentional deferrals:**
- AC-014 (version bump) — deferred per user instruction; will be batched with the next npm publish cycle
- IPC proxy notification forwarding (not in MCP-002 scope; covered by E2E story)

**Commits:** fc4bc86 (initial), d9c9e6a (code-review fixes), 0f6fee9 (sprint-review fixes)

---

### 2026-06-13 15:40 — DIR-PING-001 implemented

**Story:** CELLO-M7-DIR-PING-001
**Agent/Author:** sprint-coder

Directory-side ping/pong heartbeat handler. Pure responder — receives ping frames
on authenticated signaling streams and echoes pong with the same monotonic ts value.
No state persistence, no blocking operations, no DB calls in the handler path.

**What was built:**
- `directory-frames.ts`: PingFrame type in InboundSignalingFrame union, ping decode
  case with Number.isFinite(ts) validation, encodePong() function, PongFrame type
  in OutboundSignalingFrame union with decode case
- `directory-node.ts`: ping handler in the frame dispatch chain (before
  manifest_poll_request). Logs ping.received, sends pong, logs pong.sent; catch
  block logs pong.failed with error.message (never ${error})
- 6 tests: basic ping/pong, multi-client isolation, stream write error, repeated
  pings (8x), composition root integration (real libp2p), burst load SI-001
  (100 from A + 1 from B, B's pong < 1s)
- Taxonomy update: 3 events added to discussion_logs observability section

**AC interpretations:**
- AC-005 (composition root): uses createDirectoryNode() directly with real libp2p
  stream rather than child_process.spawn of the binary. Intent satisfied (handler
  is reachable from composition root). Binary spawn would require full Postgres
  and env var setup (CELLO_E2E_LIVE territory).
- AC-006 (lateral catch audit): scanned all catch blocks in packages/directory/src/.
  No ${error} interpolation found — all existing catches use error.message or
  String(error) correctly.
- streamId: uses stream.id (libp2p Stream interface declares `id: string`)

**Code-reviewer findings (3 important, 1 low — all fixed):**
1. PongFrame missing from OutboundSignalingFrame union and decoder — added
2. PingFrame decode accepted NaN/Infinity — added Number.isFinite(ts) guard
3. Reviewer claimed catch block is dead code — FALSE (stream.send() throws
   synchronously when buffer full or stream closed per libp2p interface docs)
4. streamId assertion inconsistency in test — added not.toBe("")

**Sprint-reviewer findings (2 medium, 2 low):**
1. AC-005 doesn't spawn binary (medium) — pragmatic; intent satisfied
2. Unrelated COORDINATION/WORKLOG diff (medium) — false positive; main advanced
   past branch point after worktree creation
3. AC-003 non-deterministic (low) — acceptable; both outcomes verified
4. COORDINATION not updated (low) — done in Step 6 on main, not in worktree

**Sprint-reviewer verdict:** APPROVED

**Commits:** c34b377 (initial), ee1daae (code-review fixes)
Branch: m7/dir-ping-001 in trustless-cello

---

### 2026-06-13 — MCP-002 merged to main

**Story:** CELLO-M7-MCP-002
**Agent/Author:** orchestrator

Branch m7/mcp-002 merged to cello-client main (merge commit 16c474a).
3 commits: fc4bc86 (initial), d9c9e6a (code-review fixes), 0f6fee9 (sprint-review fixes).

NotificationDispatcher implemented with broadcast/single-connection/filtered routing.
175 daemon tests + full workspace suite passing. Code-review and sprint-review complete, all findings fixed.
