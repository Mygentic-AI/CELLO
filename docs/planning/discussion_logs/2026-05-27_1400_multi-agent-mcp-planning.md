---
name: 2026-05-27_1400_multi-agent-mcp-planning
type: discussion
date: 2026-05-27
topics: [multi-agent, mcp-server, k-local, presence, retry-queue, nonce-deduplication, per-connection-state, agent-lifecycle, m7]
status: complete
description: Planning session for M7 — Multi-Agent MCP Server. Defines agent states, storage convention, new MCP tools, presence detection, retry queue, nonce deduplication, and architecture decision (Option A).
---

# M7 — Multi-Agent MCP Server: Planning Session

## Context

Today the MCP server is single-agent. One K_local at startup, fixed for the process lifetime. The most common early beta use case is a single human operator running two agents on the same machine and having them talk to each other — requiring painful env-var ceremony today.

## Decisions Made

### Agent States (three-tier)
- **Registered** — exists in `~/.cello/agents/<name>/`, completed FROST, known to network. Not online. Dormant.
- **Online** — live on the network from this server. Transport up, can receive messages.
- **Current** — the one online agent this connection's tool calls route to. Per-connection. One at a time.

Switching current: `cello_use_agent(name)` atomically makes the named agent current for that connection. Previous current becomes online. Sessions belong to agents, not connections.

### K_local Storage Convention
- Old: `~/.cello/key` (single file)
- New: `~/.cello/agents/<name>/key` (directory per agent)
- Default: `~/.cello/agents/default/`
- Backwards compat: legacy `~/.cello/key` treated as `default`
- Auto-start: when exactly one agent is registered at startup, it is automatically started and set as current

### MCP Tools Added
- `cello_list_agents` — shows all agents with state
- `cello_start_agent(name)` — brings registered agent online
- `cello_use_agent(name)` — makes online agent current for THIS connection
- `cello_stop_agent(name)` — takes agent offline, closes sessions
- `cello_add_agent` — REMOVED (server loads all keys at startup)

### Notification Updates
- All existing notifications gain `agent` field: `{ type, from, agent }`
- New: `cello_peer_offline` — `{ type, peer, agent }`
- New: `cello_peer_online` — `{ type, peer, agent }`
- `cello_send` and `cello_receive` gain optional `agent` parameter for one-off routing without switching current

### Presence Detection
- `peer:connect` and `peer:disconnect` already emitted by libp2p
- Currently only wired for logging in directory-node.ts and relay-node.ts
- M7 wires them into CelloClient — resolution from Peer ID → K_local pubkey via #peers map

### Retry Queue
- On send failure: message held in per-agent per-session retry queue
- On `peer:connect`: queue drains in original send order
- Retry queue cleared when session seals

### Nonce-Based Deduplication
- Every outbound message carries a unique nonce (32 bytes, crypto.getRandomValues)
- Nonce placement: **signed wrapper field alongside the CBOR envelope** — NOT in Structure 1 TBS. This preserves the TBS definition, avoids protocol_version bump, and keeps protocol-types out of scope.
- Receiver maintains Set<string> of seen nonces per session
- Duplicate nonce → discard silently (after signature verification)
- Set cleared when session seals
- Retry queue and nonce dedup MUST ship together

### Architecture Decision: Option A
One CelloClient per agent, own libp2p node per agent. Already the pattern — just needs the MCP server to manage a registry of them.

### Session Ownership Rule for cello_send Agent Override
When `cello_send` is called with an optional `agent` parameter, the named agent must own the `session_id`. If the session_id belongs to a different agent's CelloClient, the call returns an error: "Session <session_id> is not owned by agent <name>." Session IDs are per-agent — each CelloClient has its own session map.

### Notification Delivery Model
Notifications for ALL agents are delivered to ALL connected MCP client connections. The `agent` field in the notification payload lets each connection filter events relevant to it. There is no server-side filtering by current agent — the Claude Code adapter receives all events and uses the `agent` field to route internally.

### Application-Level Delivery Receipt
Agreed it should exist but needs careful design (small ACK frame, Merkle implications). Deferred as a separate future story. Retry queue with TCP-level detection is sufficient for M7.

## Scope Boundary
In scope: `adapter-claude-code` (now `@cello-protocol/connect`), `packages/client`, `packages/transport`
NOT in scope: protocol-types, directory, relay, database changes, registration ceremony changes
NOT in scope: nonce in Structure 1 TBS (nonce goes in signed envelope wrapper to avoid protocol-types)
