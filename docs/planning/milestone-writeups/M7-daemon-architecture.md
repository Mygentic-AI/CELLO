---
name: M7 Daemon Architecture & Ephemeral Session Transport
type: milestone-writeup
date: 2026-06-12
milestone: M7
status: in-progress
description: >
  Living writeup for M7. Each story appends a section when it closes.
  Format: what was delivered, bugs found and fixed, what this unblocks.
---

# M7 — Daemon Architecture & Ephemeral Session Transport

## M7-DAEMON-001 — Daemon Foundation

**Delivered:** Long-running daemon process with Unix domain socket IPC, lock file
management, agent identity loading from `~/.cello/agents/*.yaml`, structured JSON
logging, status/shutdown IPC methods, and CLI binary (`cello-daemon`). 52 tests.

**Branch:** `m7/daemon-001` in cello-client

**Unblocks:** M7-DAEMON-002, M7-MCP-001, M7-SIGNAL-001

---

## M7-DAEMON-002 — Ephemeral Session Nodes

**Delivered:** `SessionNodeManager` managing per-session ephemeral libp2p nodes
with fresh transport key + Peer ID. Standing receiver node (pre-created, open
gater, immediately replaced on handoff). `SessionConnectionGater` and
`DirectoryConnectionGater` enforcing single-peer allowlists in both inbound and
outbound directions. 32-node cap enforced on both `createSessionNode` and
`acceptSession`. SQLite session tracking (`active` → `sealed`/`interrupted`).
SIGKILL orphan detection at startup. Standing receiver bounded retry (3 attempts,
exponential backoff) with `session.standing_receiver.permanently_unavailable`
alert. 76 tests total (28 new in session-node-manager.test.ts).

**Branch:** `m7/daemon-002` in cello-client (stacked on daemon-001)

**Bugs found and fixed:**

| Symptom | Root cause | Fix | Rule |
|---------|-----------|-----|------|
| `gracefulShutdown` logged `session.node.destroyed` even when node stop failed | `.catch().then()` chain — catch resolves, so then always fires | `.then().catch()` — destroyed only on success | Observability events must only fire on the condition they describe |
| AC-012 test always green | Assertion wrapped in `if (caughtError !== null)` + old stream API | Unconditional assertion + server stop to force error + v3 API | Tests must not conditionally assert the behavior they verify |
| Standing receiver permanently unavailable after one factory failure | No retry in the catch handler | Bounded retry (3 attempts, exponential backoff) | Background infrastructure must self-heal with bounded retries |
| `INSERT OR REPLACE` overwrites `created_at` on duplicate sessionId | SQLite `REPLACE` = DELETE + INSERT | Plain `INSERT` — let constraint violation surface | Use plain INSERT unless idempotency is an explicit requirement |
| DirectoryConnectionGater missing outbound gate | Only `denyInbound` implemented | Added `denyOutbound` with shared `#denyIfNotDirectory` | Defense-in-depth: gate both directions on every gater |
| `daemon.shutdown.failed` indistinguishable between SIGTERM and logout | IPC path logged `{ error }` only | Added `signal: "logout"` field | Every error event must carry enough context to identify the trigger path |
| Binary AC-009 test: SIGTERM didn't mark synthetic rows interrupted | `gracefulShutdown()` iterated in-memory map only | Batch `UPDATE ... WHERE status = 'active'` covers all rows | Shutdown must update all persistent state, not just in-memory tracked objects |

**Unblocks:** M7-DAEMON-003, M7-WIRE-001, M7-SESSION-001, M7-MCP-002
