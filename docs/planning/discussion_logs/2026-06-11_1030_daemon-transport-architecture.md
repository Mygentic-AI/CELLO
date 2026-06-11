---
name: daemon-transport-architecture
type: discussion
date: 2026-06-11
topics: [architecture, transport, libp2p, daemon, ephemeral-peer-id, multi-session, multi-agent, security, ddos, persistence, m7]
status: active
description: >
  Architectural breakthrough for CELLO's client transport model. Emerged from
  the transport security audit's investigation of Peer ID ephemerality as a
  DDoS defense. Resolves the tension between session-scoped unlinkability and
  multi-session concurrency via a daemon model with two distinct transport
  identities: a stable directory-facing node and ephemeral per-session nodes.
  Supersedes M7's transport assumptions. Addresses DB persistence model.
---

# Daemon Transport Architecture

## 1. How We Got Here

The [[transport-security-audit-and-libp2p-primitives]] (2026-06-11) identified
ephemeral Peer IDs as an active security defense against DDoS and peer mining.
Investigation of how this actually works in the code revealed a gap: the current
implementation gives process-scoped Peer IDs, not session-scoped. The Peer ID
is stable for the entire lifetime of one cello-mcp process — potentially days.

Three candidate solutions were evaluated:
- Rotate on process restart (current behavior, insufficient)
- Per-session libp2p nodes (correct isolation, but the analysis initially
  framed the resource cost as conflicting with M7 multi-session goals)
- Rotate when no sessions open (compromise, degrades for multi-session users)

The resolution emerged from questioning the framing. The "per-session nodes
break relay multiplexing" concern assumed a single-process architecture where
all transport runs through one libp2p node. But cello-mcp's transport has two
fundamentally different concerns:

1. **Signaling to the directory** — persistent, reconnects on failure, only
   the directory ever sees this identity
2. **Data exchange with session counterparties** — ephemeral, one per session,
   needs to vanish when the session ends

These are separate concerns with different lifecycles, different trust
requirements, and different audiences. They should be separate nodes.

---

## 2. The Architecture

```
┌─────────────────────────────────────────────────────────┐
│  cello daemon (single process, runs in background)       │
│                                                         │
│  ┌───────────────────────────────────────────────────┐  │
│  │ Directory-Facing Node                              │  │
│  │ - One per daemon                                   │  │
│  │ - Peer ID changes on reconnect (same as today)     │  │
│  │ - Only the directory ever sees this Peer ID        │  │
│  │ - Handles: signaling, registration, FROST, seal    │  │
│  │ - Transport key: generated fresh on each connect   │  │
│  └───────────────────────────────────────────────────┘  │
│                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │ Session Node  │  │ Session Node  │  │ Session Node  │  │
│  │ (Alice↔Bob)   │  │ (Alice↔Carol) │  │ (Dave↔Eve)   │  │
│  │ Ephemeral     │  │ Ephemeral     │  │ Ephemeral     │  │
│  │ PeerId: aX7.. │  │ PeerId: k9Q.. │  │ PeerId: mR2..│  │
│  └──────────────┘  └──────────────┘  └──────────────┘  │
│                                                         │
│  ┌───────────────────────────────────────────────────┐  │
│  │ MCP Interface                                      │  │
│  │ - Multiple Claude sessions connect simultaneously  │  │
│  │ - Per-connection agent routing                     │  │
│  │ - Sessions belong to agents, not connections       │  │
│  └───────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

### Directory-Facing Node

- One per daemon process
- Dials the directory, maintains the signaling stream
- Handles registration, FROST ceremonies, seal coordination, connection
  negotiation, session assignment requests
- Peer ID changes on reconnect to the directory — same behavior as today's
  cello-mcp. Not persisted across process restarts.
- Only the directory ever learns this Peer ID — it is never shared with
  counterparties, never exposed to the mesh
- If the directory goes away, the node detects loss of signaling (keepalive
  failure or stream drop), then reconnects with a fresh transport key to
  whichever directory node is available

### Ephemeral Session Nodes

- One per active session
- Created during session negotiation, AFTER the counterparty accepts the
  connection request
- Fresh transport key, fresh Peer ID — generated at session creation time
- Torn down when the session closes (either by explicit close or seal)
- Each session node's Peer ID is communicated to the counterparty via the
  SessionAssignment (protocol change required — see §4)
- After session close, the Peer ID vanishes. Any address the counterparty
  recorded leads nowhere. DDoS defense and unlinkability are achieved at
  session granularity, not process granularity.

### Session Establishment Flow (Changed)

```
Alice                    Directory                    Bob
  │                         │                          │
  │ request_connection ───→ │                          │
  │                         │ ──→ connection_request   │
  │                         │ ←── accept               │
  │ ←── connection_accepted │                          │
  │                         │                          │
  │ initiate_session ─────→ │                          │
  │                         │ ──→ session_offer        │
  │                         │                          │
  │                         │     Bob creates          │
  │                         │     ephemeral session    │
  │                         │     node, reports its    │
  │                         │     Peer ID + multiaddr  │
  │                         │                          │
  │                         │ ←── session_accept       │
  │                         │     { peer_id, addrs }   │
  │                         │                          │
  │ ←── session_assignment  │ ──→ session_assignment   │
  │     { bob_session_peer, │     { alice_session_peer,│
  │       bob_addrs,        │       alice_addrs,       │
  │       relay_endpoint }  │       relay_endpoint }   │
  │                         │                          │
  │ Alice creates her own   │                          │
  │ ephemeral session node  │                          │
  │ and reports Peer ID     │                          │
  │                         │                          │
  │ ←─────────────── direct P2P or via relay ────────→ │
  │   (using ephemeral session Peer IDs only)          │
```

**Key difference from today:** Both Alice and Bob create ephemeral session
nodes during negotiation and report their session Peer IDs to the directory.
The SessionAssignment carries both session Peer IDs and multiaddrs so each
side can dial the other's session-specific identity.

---

## 3. Security Properties Achieved

| Property | How |
|----------|-----|
| **Session-scoped DDoS defense** | Counterparty's address for you dies when the session node tears down. Cannot flood you after session ends. |
| **Session-scoped unlinkability** | Each session has a unique Peer ID. No observer can correlate sessions by transport identity. |
| **Directory connection privacy** | Directory-facing Peer ID never shared with counterparties. Counterparties cannot reach your signaling layer. |
| **Multi-session isolation** | Sessions share nothing at the transport level. A compromised session node reveals nothing about other sessions. |
| **connectionGater is trivial** | Each session node accepts connections from exactly one peer: its counterparty. Everyone else rejected before Noise handshake. Simpler and stronger than the shared-node allowlist approach discussed in the audit. |
| **No address broadcasting** | Session Peer IDs travel through the directory only, in the SessionAssignment. Never broadcast to a DHT or gossipsub mesh. |

---

## 4. Protocol Change: SessionAssignment Wire Format

The current SessionAssignment carries a `relay_endpoint` — the relay's
multiaddr and Peer ID — so both parties can dial the relay. In the new model
it must also carry:

- `counterparty_session_peer_id` — the ephemeral Peer ID the counterparty
  created for this session
- `counterparty_session_addrs` — multiaddrs where that session node is
  reachable (or relay circuit address if behind NAT)

This is a **wire format change** to the SessionAssignment frame. The FROST
threshold signature covers these fields (they are part of the TBS), preventing
a compromised relay from substituting a different Peer ID.

**Ordering constraint:** Bob must create his ephemeral session node and report
its identity to the directory BEFORE the directory can issue Alice's
SessionAssignment. Alice must do the same before Bob's assignment is
finalized. This adds a round-trip to session establishment:

1. Alice requests session
2. Directory contacts Bob, Bob accepts and creates session node, reports Peer ID
3. Directory issues partial assignment to Alice (contains Bob's session Peer ID)
4. Alice creates her session node, reports Peer ID back to directory
5. Directory issues final assignment to both (each has the other's session Peer ID)

Whether this can be collapsed to fewer round-trips is a design question for the
story specification. The important constraint is: both session Peer IDs must be
known and signed into the assignment before either party starts exchanging
content.

---

## 5. The Daemon Model

### Why "daemon" and not "session process"

Today cello-mcp is a session process — started when Claude needs it, owned by
that session, M6B-001 kills any prior instance on startup. This was sufficient
for single-agent, single-session use.

The daemon model is required by the convergence of three needs:

1. **Multiple Claude sessions using CELLO simultaneously.** Two Claude Code
   windows open, both want to use their agents without conflating state or
   killing each other's process.

2. **Multiple agent identities per operator.** One user has agent X and agent Y.
   Both are registered, both can be online. Switching between them does not
   require killing a process.

3. **Session-scoped ephemeral nodes.** The directory-facing connection must
   survive session creation and teardown. If creating/closing a session kills
   the whole process, you lose your directory signaling. The directory-facing
   node must outlive any individual session.

The daemon starts at login (or on first use), runs in the background, and
multiple MCP client connections (from different Claude sessions) connect to it
independently. Each sees its own agent context. The daemon holds all agent
identities, all active sessions, the directory connection, and the SQLite
database.

### What M6B-001's PID lock becomes

M6B-001's kill-on-startup behavior is wrong for a daemon. The lock file becomes
a "connect or start" mechanism:

- If the lock file exists and the process is alive → connect to it (IPC)
- If the lock file is stale (process dead) → start a new daemon, take the lock
- No process ever kills another

### MCP connection model

Each MCP client connection (one per Claude session) is a lightweight handle into
the daemon's state. It tracks:

- Which agent is "current" for this connection
- Which sessions this connection is interacting with

The daemon manages:
- All registered agent identities
- All online agents (those with active directory registrations)
- All session nodes (created on demand, torn down on session close)
- The directory-facing node (single, shared, reconnects on failure)

---

## 6. Persistence Model Under the New Architecture

The DB staleness problem identified in COORDINATION.md (2026-06-10) changes
substantially under this architecture. The question "what does a persisted
connection mean?" has different answers now.

### What gets persisted (SQLite)

- **Agent identities** — K_local keys, FROST shares, registration state.
  Persisted permanently. Survive daemon restarts.
- **Connection records** — "Alice and Bob once negotiated a connection."
  Persisted, but semantics need definition (see below).
- **Session history** — sealed session records (Merkle roots, receipts).
  Persisted permanently as the tamper-evident record.

### What is purely transient (in-memory only)

- **Session nodes** — ephemeral by design. Never persisted. A session node
  exists only while the session is active. On daemon restart, all session
  nodes are gone.
- **Session transport state** — Peer IDs, streams, relay connections. All
  die with the session node.
- **Retry queue contents** — messages awaiting delivery. Lost on daemon
  restart (same as current M7 design; persistence is a future story).
- **Nonce dedup sets** — seen nonces per session. Lost on daemon restart.

### Connection records: what "persisted" means

A persisted connection record means: "Alice and Bob completed the connection
negotiation protocol at some point in the past." It does NOT mean:

- Bob is currently reachable
- Bob still uses the same pubkey
- Bob's current connection policy still accepts Alice
- A session can be initiated without any further validation

**On daemon restart:** All connection records are loaded from SQLite but marked
`unverified`. The first time an agent attempts to use a connection (initiate a
session), the daemon validates it against the directory:

- Is the counterparty's pubkey still current?
- Does the counterparty still have this connection record?
- Does the counterparty's current policy still accept connections from us?

If validation fails, the connection record is marked `stale` and the user is
informed they need to re-request the connection.

### Active sessions cannot survive daemon restart

This is an explicit design decision, not a limitation to be worked around.
When the daemon restarts:

- All session nodes are gone (ephemeral transport keys lost)
- The relay has no in-memory state for those sessions
- The counterparty's session node is dialing an address that no longer exists

There is nothing to "resume." The session is over. The history (sealed or
unsealed) is in the DB. If the conversation needs to continue, a new session
must be initiated — which creates fresh session nodes on both sides.

**Unseal-on-restart behavior:** Sessions that were active when the daemon
stopped should be marked `interrupted` in the DB. On next communication with
the counterparty, both sides can agree to seal the interrupted session (if
enough messages were exchanged) or discard it (if it was trivial). This is
a protocol-level concern that needs its own story.

---

## 7. Resource Considerations

### Relay connections

Each session node dials the relay independently. N concurrent sessions = N TCP
connections to the relay. This is the cost of session isolation.

Mitigations:
- The relay is designed to handle many connections — it's infrastructure
- Most operators will have 1-5 concurrent sessions, not hundreds
- Not all sessions use the relay — direct connections bypass it entirely
- Connection pooling at the TCP level (if libp2p supports it) could reduce
  overhead without sharing Peer IDs

### Per-session node overhead

Each libp2p node carries:
- A TCP listener (one port per node)
- Noise handshake state
- Yamux multiplexer state
- Protocol handler registrations

For 3-5 concurrent sessions this is negligible. The threshold where it becomes
a problem should be measured empirically before adding complexity to address it.
If it turns out to be a concern at scale, the relay connection can be made
shared (single TCP connection, multiplexed by session ID) as an optimization
without changing the Peer ID isolation model.

### Port allocation

Each session node binds a port. On most systems the ephemeral port range
(49152-65535) provides ~16,000 ports. With 5 concurrent sessions this is not
a concern. If an operator somehow runs 100+ concurrent sessions, port
exhaustion becomes possible — but that's an extreme edge case that should be
addressed by limits, not by compromising the architecture.

---

## 8. What M7 Becomes

M7 as currently written (Multi-Agent MCP Server outline, 2026-05-28) assumed
one CelloClient per agent, each with its own libp2p node — but those nodes
were conceived as persistent-per-agent, not ephemeral-per-session. The
architecture was a multiplexing layer bolted onto the wrong transport model.

**M7 must be redesigned from scratch on the daemon foundation.**

What survives from M7 old:
- K_local storage convention (`~/.cello/agents/<name>/`) — still correct
- The UX goal: one operator, multiple agent identities, concurrent sessions
- Presence detection (peer:connect/disconnect) — still needed
- Retry queue + nonce dedup — still needed
- Per-connection agent routing — still needed

What changes fundamentally:
- One libp2p node per agent → one directory-facing node shared + ephemeral
  session nodes
- CelloClient architecture — the "client" is now the daemon; agents are
  identities within it, not separate client instances
- Session lifecycle — session creation now includes ephemeral node creation;
  the protocol gains a round-trip
- The integration gate — "two agents talk to each other" now means ephemeral
  session nodes on both sides, not two persistent nodes

M7 old should be archived. New M7 should be designed from this document
forward, harvesting individual stories from M7 old where the scope is still
valid.

---

## 9. Open Design Questions

1. **Session establishment round-trips.** Can the "Bob creates node, reports
   Peer ID; Alice creates node, reports Peer ID" exchange be collapsed? Or is
   the extra round-trip acceptable for the security guarantee?

2. **NAT traversal for session nodes.** A session node behind NAT cannot be
   dialed directly. It must either use the relay as a circuit, or hole-punch
   via dcutr. dcutr requires a coordination point. How does a freshly-created
   session node that is behind NAT become reachable by its counterparty?

3. **Interrupted session handling.** When the daemon restarts and active
   sessions die, what is the protocol for the counterparty to learn this?
   Do they detect the dead session node via Yamux keepalive failure? How long
   should they wait before giving up? Should the directory be notified?

4. **IPC mechanism.** How do multiple Claude sessions connect to the running
   daemon? Unix domain socket? stdio proxy? Named pipe? This has platform
   implications (macOS, Linux, Windows).

5. **Daemon lifecycle on desktop.** Does it start at login? On first MCP
   connection? Does it shut down after idle timeout? Or run indefinitely?

6. **Connection validation on restart.** The `unverified` → validate-with-
   directory flow needs protocol support. Does the directory offer a
   "is this connection still valid?" query? Or does the client just attempt
   `initiate_session` and handle the failure?

---

## 10. Relationship to Other Open Work

- **5-line counterparty pubkey fix** — still needed on the session node's
  receive path; same fix, different location (session node's relay stream
  manager instead of global)
- **connectionGater** — trivially solved per session node (allow only the one
  counterparty); the directory-facing node needs its own gater (allow only
  known directory Peer IDs)
- **Directory bidirectional auth** — unrelated to this architecture; still
  needs its own audit
- **AutoNAT** — relevant to session node NAT traversal (question 2 above);
  placement in new M7 depends on whether session nodes need self-knowledge
  of dialability

---

## References

- [[transport-security-audit-and-libp2p-primitives]] — the audit that surfaced the Peer ID ephemerality gap and led to this architecture
- [[peer-reconnect-libp2p-primitives]] — AutoNAT, dcutr, and reconnect analysis
- [[2026-06-06_2100_sovereign-node-networking-requirements]] — NAT requirements
- [[end-to-end-flow]] — current session establishment flow (will need updating)
- M7 outline (2026-05-28) — superseded by this architecture; to be archived
- COORDINATION.md M6B (2026-06-10) — DB staleness scenarios that motivated §6
