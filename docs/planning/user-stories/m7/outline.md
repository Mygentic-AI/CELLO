---
name: M7 — Daemon Architecture & Ephemeral Session Transport
milestone: M7
type: outline
date: 2026-06-11
status: draft
topics: [daemon, ephemeral-session-nodes, cli, mcp-adapter, autonat, direct-p2p, manifest, bidirectional-auth, multi-agent, ipc]
description: >
  M7 redesigns CELLO's client architecture from the ground up on a daemon
  foundation. A single long-running daemon process holds all agent identities,
  all active sessions, and the directory-facing connection. The MCP adapter
  becomes a thin proxy into the daemon. Ephemeral per-session libp2p nodes
  replace the per-agent persistent node model, delivering session-scoped DDoS
  defense and unlinkability. Direct P2P is the default; relay is opt-in for NAT
  traversal and IP privacy. Directory bidirectional authentication (handshake
  steps 5–6) and a TUF-aligned signed manifest close the directory trust gap.
---

# M7 — Daemon Architecture & Ephemeral Session Transport

## Why This Milestone Exists

M7 as originally conceived (the `m7-archived` directory) assumed one
`CelloClient` per agent, each with its own persistent libp2p node. The
transport security audit and the daemon architecture design session
(2026-06-11) revealed that model was wrong in three ways simultaneously:

1. **DDoS / unlinkability:** Persistent per-agent Peer IDs mean a counterparty
   retains your network address across sessions. Session-scoped ephemeral nodes
   are the correct defense.
2. **Multi-session concurrency:** Multiple Claude sessions cannot share one
   cello-mcp process without conflicting. A daemon model is required.
3. **Directory trust gap:** Handshake steps 5–6 (directory → client auth) were
   never implemented. The client trusts "it responded" — not a verified
   identity.

The archived M7 work is preserved in `m7-archived/` and individual stories
there are referenced where scope remains valid.

**Canonical design references:**
- [[daemon-transport-architecture]] — primary architecture document; supersedes
  all prior transport assumptions
- [[implementing-directory-bidirectional-authentication]] — TUF analysis,
  manifest design, four resolved gaps
- [[transport-security-audit-and-libp2p-primitives]] — surfaced Peer ID
  ephemerality and bidirectional auth gaps

---

## What This Milestone Delivers

### Daemon model
A single background process (`cello daemon`) holds all agent identities, the
directory-facing connection, all active session nodes, and the local SQLite
database. Multiple Claude sessions connect to it simultaneously via IPC (Unix
domain socket / named pipe). No process ever kills another.

### CLI-first interface
`cello` is a first-class CLI application — the primary operator interface.
`cello login` starts the daemon and connects to the directory. `cello logout`
stops it gracefully. `cello status` shows connection, session, and agent state.
All protocol operations are available as CLI commands. MCP is one adapter on
top of the daemon, not the primary interface — any agent on any platform can
participate via shell.

### Ephemeral session nodes
Each active session gets its own libp2p node: fresh transport key, fresh Peer
ID, created at session establishment, torn down after seal + close. The
directory-facing node is separate and shared across all sessions. connectionGater
per session node allows exactly one counterparty — simpler and stronger than
an allowlist on a shared node.

### Direct P2P by default
Session content travels directly between agents after the directory brokers the
connection. The relay is opt-in for NAT traversal and IP privacy. The protocol
works anywhere two devices can reach each other, without CELLO infrastructure
in the path.

### Directory bidirectional authentication
Handshake steps 5–6 are implemented. The directory signs its challenge response;
the client verifies against pinned node keys from a TUF-aligned signed manifest.
The manifest carries `version`, `not_before`, `expires`, and a threshold
signature. The client enforces version monotonicity and expiry. The daemon polls
for a fresh manifest every 6–12 hours.

---

## Three Agent States

| State | Meaning |
|-------|---------|
| **Registered** | Identity exists in `~/.cello/agents/<name>/`, completed FROST, known to network. Not online from this daemon. |
| **Online** | Live on the network from this daemon. Directory connection active, can receive session requests. Multiple agents can be online simultaneously. |
| **Current** | The one online agent this MCP connection's tool calls route to. Per-connection. Switching current moves the previous current back to online. |

---

## K_local Storage Convention

| Before (M6) | After (M7) |
|---|---|
| `~/.cello/key` (single file) | `~/.cello/agents/<name>/key` (directory per agent) |

Backwards compat: if legacy `~/.cello/key` exists and no `~/.cello/agents/`
directory, treat as agent named `default`. Carried forward from `m7-archived`
MULTI-001 — scope is unchanged, loading context moves to daemon startup.

---

## Persistence Model

| What | Where | Survives restart? |
|------|-------|-------------------|
| Agent identities (K_local, FROST shares) | SQLite per agent | Yes |
| Connection records | SQLite | Yes, loaded as `unverified`; validated at login |
| Session history (sealed records) | SQLite | Yes |
| Session nodes | In-memory only | No — ephemeral by design |
| Retry queue | In-memory per session | No — persistence deferred post-M7 |
| Nonce dedup sets | In-memory per session | No |

Sessions active when the daemon stops are marked `interrupted` in the DB and
surfaced at next `cello login`.

---

## Scope Boundaries

**In scope:**
- Daemon process — IPC socket, connect-or-start, graceful shutdown
- `packages/cli` — new package; `cello login/logout/status` and full protocol CLI surface
- MCP adapter rewrite — thin stdio-to-socket proxy; per-connection agent state
- Ephemeral session node lifecycle (create, connectionGater, standing receiver, teardown)
- SessionAssignment wire format change (cross-repo: directory + relay + client)
- AutoNAT in `createNode`; direct P2P default; dcutr upgrade path; relay fallback
- Interrupted session handling (relay `session_interrupted` frame, DB status, login surfacing)
- Signaling stream resilience — heartbeat/keepalive, automatic reconnect with exponential backoff, `directory_signaling` status observable
- Nonce dedup + retry queue rehoused in daemon
- Retry queue + nonce dedup persistence (`retry_queue` and `session_seen_nonces` SQLCipher tables)
- Agent-aware MCP notifications; session lifecycle presence signals
- Manifest schema + initial signed manifest + N root key constants in binary
- Client-side manifest verification + handshake step 6 (directory→client auth)
- Manifest polling (daemon background task, ships with S12)
- Cross-repo CI/CD validation — wire cello-client as second source into integration pipelines; block npm publish if directory/relay/e2e fails
- M7 integration gate

**NOT in scope:**
- Application-level delivery receipt (separate future story — protocol design question with Merkle implications; no forcing function from current architecture gaps)
- Portal or web UI changes
- New Flyway directory schema migrations (none in M7)

---

## Story Breakdown

| ID | Title | Depends on |
|----|-------|------------|
| **S1** | Daemon foundation — IPC socket, connect-or-start, `cello login/logout/status`, agent loading, backwards compat, connection validation on login | — |
| **S2** | MCP adapter — stdio-to-socket proxy, per-connection current-agent state, `cello_use_agent / list_agents / start_agent / stop_agent` | S1 |
| **S3** | Ephemeral session nodes — create/teardown lifecycle, connectionGater, standing receiver node | S1 |
| **S4** | SessionAssignment wire format — add `counterparty_session_peer_id` + `counterparty_session_addrs` to signed frame (cross-repo: directory, relay, client) | S3 |
| **S5** | AutoNAT + direct P2P default — `autonat()` in createNode, dialability observable, direct dial default, relay fallback, dcutr upgrade | S4 |
| **S6** | Interrupted session handling — relay `session_interrupted` frame, DB `interrupted` status, login surfacing, seal-interrupted protocol flow | S3, S4 |
| **S7** | Signaling stream resilience — heartbeat/keepalive on signaling stream, exponential backoff reconnect, `directory_signaling` status, queued outbound ops retry after reconnect | S1 |
| **S8** | Nonce dedup + retry queue — rehoused in daemon; SQLCipher `retry_queue` and `session_seen_nonces` tables | S3 |
| **S9** | Agent-aware notifications — `agent` field on existing notifications, session node lifecycle as presence signals | S2, S3, S8 |
| **S10** | M7 integration gate — daemon running, two Claude sessions via IPC, two agents with ephemeral session nodes, full exchange, bidirectional auth exercised, signaling resilience verified | S1–S9, S12 |
| **S11** | Manifest schema + initial manifest — JSON schema (`version`, `not_before`, `expires`, threshold sig), officer key ceremony, N root key constants in binary | — |
| **S12** | Client verification + handshake step 6 + manifest polling — threshold sig check, version/expiry enforcement, directory signs challenge response, client verifies against manifest; 6–12 hour background poll in daemon | S1, S11 |
| **S14** | Cross-repo CI/CD — wire cello-client as second source into integration pipelines; cello-client push triggers build→e2e→block npm publish on failure | — |

---

## Dependency Map

```
S1  ──→ S2  ─────────────────────────────────────────────────┐
    ├──→ S3  ──→ S4  ──→ S5  ──────────────────────────────→ │
    │               └──→ S6  ──────────────────────────────→ │
    │       └──→ S8  ──→ S9  ──────────────────────────────→ S10 (gate)
    └──→ S7  ───────────────────────────────────────────────→ │
                                                              │
S11 ──→ S12 ───────────────────────────────────────────────→ │

S13  (independent — no deps, no blockers)
```

**Three independent tracks** run from day one:

| Track | Stories | Bottleneck |
|-------|---------|------------|
| **Daemon + transport track** | S1 → S3 → S4 → S5/S6 + S7 + S8 → S9 | S4 (cross-repo deploy) |
| **Security track** | S11 → S12 | Key ceremony (S11) is operational work before code |
| **CI/CD track** | S13 | Independent — can run any time |

**Critical path:** S1 → S3 → S4 → S5 → S10 (five stories deep).

**S4 is the serialization bottleneck.** It is a cross-repo protocol change
requiring directory and relay CloudFormation deploys (~25-30 min each). Batch
all pending directory/relay changes before triggering the pipeline.

---

## Milestone Close Gate

1. `cello login` starts the daemon; `cello status` shows directory connected,
   connections verified
2. Two Claude Code sessions connect simultaneously via IPC; each has independent
   current-agent state
3. Two agents exchange messages end-to-end using ephemeral session nodes; Peer
   IDs differ from the directory-facing node Peer ID
4. Direct P2P session established where NAT permits; relay fallback verified
   where it does not
5. Daemon stop while session active → session marked `interrupted` in DB;
   `cello login` surfaces it on next start
6. Retry queue holds messages across peer disconnect; drains in order on
   reconnect; nonce dedup verified (no duplicates); queue and nonce set survive
   daemon restart (SQLCipher persistence verified)
7. Signaling stream killed mid-session → daemon detects drop, reconnects with
   backoff, `directory_signaling` transitions through `reconnecting` → `connected`;
   queued outbound ops drain after reconnect
8. Directory handshake steps 5–6 pass: directory signs challenge response,
   client verifies against manifest; connection to a rogue node (wrong key)
   is rejected
9. `cello_list_agents` shows correct state (registered / online / current) at
   every step

---

## Post-M7 Known Gaps

### Application-level delivery receipt
Small ACK frame from receiver after dequeuing. Adds a round-trip to every
message; Merkle implications need design. Deferred — retry queue with
TCP-level detection is sufficient for M7. Needs its own design session before
a story can be written.

---

## Related Documents

### Required reading for all story implementers

- `CONTEXT.md` (repo root) — canonical glossary; all M7 terms (daemon, ephemeral session node, standing receiver node, three agent states, IPC, consortium manifest, consortium root keys, AutoNAT, `directory_signaling` status, interrupted session) are defined here. Use these terms exactly in code and story ACs.
- [[end-to-end-flow]] — canonical session establishment narrative; S3, S4, and S6 all modify this flow. Read before writing any story that touches session negotiation or the SessionAssignment wire format.
- [[agent-client]] §2 "Bootstrap discovery", §2 "Persistent authenticated connection", §2 "Degraded mode" — specifies the three-level fallback chain and consortium key model that S10/S11 implement; the exact 4-step challenge-response that S12 completes; and the expected client behavior when the directory connection drops, which S7 must not contradict.

### Design references

- [[daemon-transport-architecture]] — primary architecture document; supersedes all prior transport assumptions
- [[implementing-directory-bidirectional-authentication]] — TUF analysis, manifest design, four resolved gaps
- [[transport-security-audit-and-libp2p-primitives]] — audit that surfaced the Peer ID ephemerality and bidirectional auth gaps this milestone closes
- [[peer-reconnect-libp2p-primitives]] — AutoNAT and dcutr background; required reading for S5

### Archive

- `m7-archived/outline.md` — superseded; MULTI-001 scope reused in S1; MULTI-006 scope reused in S8
