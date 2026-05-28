---
name: M7 — Multi-Agent MCP Server
milestone: M7
type: outline
date: 2026-05-28
status: draft
topics: [multi-agent, mcp-server, k-local, presence, retry-queue, nonce-deduplication, per-connection-state, agent-lifecycle]
description: M7 transforms the single-agent MCP server into a multi-agent host. One server process holds N named K_locals simultaneously. Each MCP client connection tracks its own current agent independently. Presence detection, client-side retry queue, and nonce-based deduplication ship together. Ships BEFORE June 4 launch.
---

# M7 — Multi-Agent MCP Server

## What This Milestone Delivers

Today the MCP server is single-agent: one K_local at startup, fixed for the process lifetime. To use a different agent identity you kill the session, set `CELLO_KEY_FILE`, and restart.

**M7 delivers:** The MCP server becomes multi-agent. It can hold N named K_locals simultaneously. Each MCP client connection has its own current-agent state — switching agents in one connection does not affect another connection on the same server.

The most common early use case: a single human operator running two agents on the same machine and having them talk to each other, without manual env-var ceremony.

---

## Three Agent States

| State | Meaning |
|-------|---------|
| **Registered** | Agent exists in `~/.cello/agents/<name>/`, completed FROST, known to network. Not online from this server. Dormant. |
| **Online** | Live on the network from this server. Transport up, can receive messages, maintains sessions. Multiple agents can be online simultaneously. |
| **Current** | The one online agent this connection's tool calls route to. Per-connection. One at a time. Switching current moves the previous current back to online. |

---

## K_local Storage Convention

| Before (M6) | After (M7) |
|---|---|
| `~/.cello/key` (single file) | `~/.cello/agents/<name>/key` (directory per agent) |

- Default agent: `~/.cello/agents/default/`
- Server loads all registered agents from `~/.cello/agents/` at startup
- Backwards compat: if legacy `~/.cello/key` exists and no `~/.cello/agents/` directory, treat as agent named `default`

---

## New MCP Tools

| Tool | Purpose |
|------|---------|
| `cello_list_agents` | Shows all agents with state (registered / online / current) |
| `cello_start_agent(name)` | Brings a registered agent online (starts its CelloClient + libp2p node) |
| `cello_use_agent(name)` | Makes an online agent current for THIS connection. Previous current → online. |
| `cello_stop_agent(name)` | Takes an agent offline, closes its sessions, stops its libp2p node |

Existing tools (`cello_send`, `cello_receive`, etc.) accept an optional `agent` parameter to target a specific online agent without switching current.

---

## Per-Connection State

- Each MCP client connection tracks its own current agent independently
- Switching in one connection does not affect another connection
- Sessions belong to agents, not connections
- Sessions opened under Agent A stay alive when you switch to Agent B

---

## Presence Detection

libp2p emits `peer:connect` and `peer:disconnect` via Yamux keepalive (~30s detection). These events exist today but are only wired for logging in `directory-node.ts` and `relay-node.ts`. M7 wires them into `CelloClient` and surfaces them to the MCP notification layer.

**Server lifecycle:** laptop sleep → connections die → wake → transport reconnects automatically → agents return to online state without user intervention.

**New notifications:**
- `{ "type": "cello_peer_offline", "peer": "<pubkey>", "agent": "<name>" }`
- `{ "type": "cello_peer_online", "peer": "<pubkey>", "agent": "<name>" }`

Existing `cello_message` and `cello_session_request` notifications gain an `agent` field identifying which agent the event is for.

---

## Client-Side Retry Queue

When send fails because peer is unreachable:
- Message held locally and retried on `peer:connect`
- Messages retried in original order
- Retry queue is per-agent, per-session
- Entry: on send failure / `peer:disconnect`
- Drain: on `peer:connect`

---

## Nonce-Based Deduplication (ships WITH retry queue)

- Every outbound message carries a unique nonce (random, assigned once at creation, never changes on retry)
- Receiver maintains `Set<string>` of seen nonces per session
- Duplicate nonce → discard silently
- Set cleared when session seals

Retry queue and nonce deduplication must ship together — can't have retry without dedup.

---

## Architecture Decision

**Option A (chosen):** One `CelloClient` per agent. The MCP server holds a `Map<string, CelloClient>`, one per loaded agent. Each has its own libp2p node. Per-connection state tracks which client is "current."

This is the natural extension of the existing architecture — just needs the MCP server to manage a registry of CelloClients instead of one.

---

## Scope Boundaries

**In scope:**
- `packages/adapter-claude-code` — multi-client registry, per-connection state, new tools, notification updates
- `packages/client` — retry queue, nonce generation/deduplication, presence event handling
- `packages/transport` — surface `peer:connect` / `peer:disconnect` to consumer

**NOT in scope:**
- Protocol changes (no new TBS fields, no wire format changes; nonce goes in signed envelope wrapper, not in Structure 1 TBS)
- Database changes (no directory/relay schema work)
- Application-level delivery receipt (separate future story — needs careful design)
- Registration ceremony changes (agents still register the same way)
- `cello_add_agent` — REMOVED; server loads all keys at startup, `cello_start_agent` is sufficient

---

## Story Breakdown

### Stories

| ID | Title | Domain | Priority | Depends on |
|----|-------|--------|----------|------------|
| MULTI-001 | K_local storage convention — `~/.cello/agents/<name>/` with backwards compat | Storage | P0 | — |
| MULTI-002 | Multi-client registry in MCP server — `Map<string, CelloClient>` lifecycle | Server | P0 | MULTI-001 |
| MULTI-003 | Per-connection current-agent state and `cello_use_agent` switching | Server | P0 | MULTI-002 |
| MULTI-004 | Agent lifecycle tools — `cello_list_agents`, `cello_start_agent`, `cello_stop_agent` | Server | P0 | MULTI-002 |
| MULTI-005 | Wire `peer:connect` / `peer:disconnect` into CelloClient | Transport/Client | P0 | — |
| MULTI-006 | Client-side retry queue + nonce-based deduplication | Client | P0 | MULTI-005 |
| MULTI-007 | Notification updates — `agent` field, presence notifications, optional agent param on send/receive | Server | P0 | MULTI-002, MULTI-003, MULTI-005 |
| MULTI-008 | M7 integration gate — two local agents on one server exchange messages end-to-end | E2E | P0 | All above |

### Dependency Graph

```
MULTI-001 → MULTI-002 → MULTI-003 ─┐
                       → MULTI-004 ─┼──→ MULTI-007 → MULTI-008
                                    │
MULTI-005 → MULTI-006 ─────────────┘
          └──────────────→ MULTI-007
```

### Parallelism Map

**Two independent tracks** can execute simultaneously from day one:

| Track | Stories | What it delivers |
|-------|---------|-----------------|
| **Server track** | MULTI-001 → MULTI-002 → MULTI-003 + MULTI-004 (parallel) | Named agent storage, multi-client registry, per-connection routing, lifecycle tools |
| **Client track** | MULTI-005 → MULTI-006 | Presence detection wired into CelloClient, retry queue, nonce deduplication |

**Convergence point:** MULTI-007 (notifications) depends on both tracks — it needs per-connection state (from 003) AND presence events (from 005). After MULTI-007 merges, MULTI-008 (integration gate) exercises everything.

**Execution order for two parallel agents:**

```
Agent 1 (server track):     MULTI-001 → MULTI-002 → MULTI-003 → MULTI-007 → MULTI-008
                                                   ↘ MULTI-004 ↗

Agent 2 (client track):     MULTI-005 → MULTI-006 ─────────────→ (done, unblocks 007)
```

**If working sequentially (one agent):**

```
Phase 1: MULTI-001, MULTI-005     (parallel, no deps)
Phase 2: MULTI-002                (needs 001)
Phase 3: MULTI-003, MULTI-004, MULTI-006  (003/004 need 002; 006 needs 005)
Phase 4: MULTI-007                (needs 003 + 005)
Phase 5: MULTI-008                (needs all)
```

**Critical path:** MULTI-001 → MULTI-002 → MULTI-003 → MULTI-007 → MULTI-008 (5 stories deep). The client track (005 → 006) is shorter and finishes earlier, so it never blocks the critical path if started in parallel.

---

## Key Codebase Locations (from research)

| What | Where | Gap |
|------|-------|-----|
| MCP composition root | `packages/adapter-claude-code/src/bin/cello-mcp.ts` lines 1-262 | Explicitly single-agent (comment lines 5-7) |
| Server factory | `packages/adapter-claude-code/src/server.ts` | Creates one MCP server with one client |
| Notifications | `packages/adapter-claude-code/src/notifications.ts` | No `agent` field |
| FileKeyProvider | `packages/crypto/src/ed25519.ts` lines 45-126 | Reads single 37-byte file |
| CelloClient identity | `packages/client/src/client.ts` `#myPubkeyHex` | Single identity per instance |
| CelloClient send | `packages/client/src/client.ts` lines 552-716 | No retry queue, immediate failure |
| libp2p peer events | `packages/transport/src/node.ts` | Events emitted but NOT wired to client |
| Peer event listeners | `directory-node.ts` lines 480-489, `relay-node.ts` lines 258-265 | Logging only |
| CELLO_KEY_FILE | `cello-mcp.ts` line 57 | Single path, `~/.cello/key` default |

---

## Application-Level Delivery Receipt (SEPARATE FUTURE STORY)

Agreed it should exist but needs careful design:
- Small ACK frame from receiver after dequeuing message
- Adds round-trip to every message
- Merkle implications need thought
- Deferred — retry queue with TCP-level detection is sufficient for M7

---

## Milestone Close Gate

1. Two agents loaded on one MCP server, both online simultaneously
2. Two separate Claude Code connections, each with a different current agent
3. Agent A sends message to Agent B via the same server — message delivered
4. Laptop sleep simulation: kill transport on one agent → retry queue holds messages → reconnect → messages drain in order → no duplicates (nonce dedup verified)
5. `cello_list_agents` shows correct state for all agents at every step
6. Backwards compat: single `~/.cello/key` still works (treated as `default` agent)

---

## Related Documents

- [[2026-05-27_1400_multi-agent-mcp-planning]] — planning session decisions
- [[implementation-roadmap]] — M7 position in milestone sequence
- [[end-to-end-flow]] — protocol flow unchanged; M7 is a multiplexing layer above protocol
