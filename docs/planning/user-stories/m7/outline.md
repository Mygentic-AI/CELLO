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
| Retry queue | SQLCipher `retry_queue` table | Yes |
| Nonce dedup sets | SQLCipher `session_seen_nonces` table | Yes |

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

**Writing order:** Write S10 (integration gate) FIRST as the E2E story — it is
the `/cello-story` anchor that all component stories reference. Then write
S1–S9, S11–S12, and S14 as component stories that depend on it.
Implementation order is different — S10 is implemented last.

| ID | Title | Depends on | Repo(s) | Primary package(s) |
|----|-------|------------|---------|-------------------|
| **S1** | Daemon foundation — IPC socket, connect-or-start, `cello login/logout/status`, agent loading, backwards compat, connection validation on login | — | cello-client | `packages/daemon` (new), `packages/cli` (new) |
| **S2** | MCP adapter — stdio-to-socket proxy, per-connection current-agent state, `cello_use_agent / list_agents / start_agent / stop_agent` | S1 | cello-client | `packages/adapter-claude-code` |
| **S3** | Ephemeral session nodes — create/teardown lifecycle, connectionGater, standing receiver node | S1 | cello-client | `packages/daemon/src/session-node-manager.ts` (new) |
| **S4** | SessionAssignment wire format — add `counterparty_session_peer_id` + `counterparty_session_addrs` to signed frame (cross-repo: directory, relay, client) | S3 | **both** | `packages/protocol-types`, `packages/directory`, `packages/relay`, `packages/client` |
| **S5** | AutoNAT + direct P2P default — `autonat()` in createNode, dialability observable, direct dial default, relay fallback, dcutr upgrade | S4 | cello-client | `packages/transport/src/node.ts`, `packages/daemon` |
| **S6** | Interrupted session handling — relay `session_interrupted` frame, DB `interrupted` status, login surfacing, seal-interrupted protocol flow | S3, S4 | **both** | `packages/relay`, `packages/daemon`, `packages/client` |
| **S7** | Signaling stream resilience — heartbeat/keepalive on signaling stream, exponential backoff reconnect, `directory_signaling` status, queued outbound ops retry after reconnect | S1 | cello-client | `packages/transport/src/signaling-manager.ts`, `packages/daemon` |
| **S8** | Nonce dedup + retry queue — rehoused in daemon; SQLCipher `retry_queue` and `session_seen_nonces` tables | S3 | cello-client | `packages/daemon`, `packages/client` |
| **S9** | Agent-aware notifications — `agent` field on existing notifications, session node lifecycle as presence signals | S2, S3, S8 | cello-client | `packages/adapter-claude-code`, `packages/daemon` |
| **S10** | M7 integration gate — daemon running, two Claude sessions via IPC, two agents with ephemeral session nodes, full exchange, bidirectional auth exercised, signaling resilience verified | S1–S9, S12 | **both** | `packages/e2e-tests` |
| **S11** | Manifest schema + initial manifest — JSON schema (`version`, `not_before`, `expires`, threshold sig), officer key ceremony, N root key constants in binary | — | cello-client | `packages/crypto`, `packages/protocol-types` |
| **S12** | Client verification + handshake step 6 + manifest polling — threshold sig check, version/expiry enforcement, directory signs challenge response, client verifies against manifest; 6–12 hour background poll in daemon | S1, S11 | **both** | `packages/transport`, `packages/daemon`, `packages/directory` |
| **S14** | Cross-repo CI/CD — wire cello-client as second source into integration pipelines; cello-client push triggers build→e2e→block npm publish on failure | — | trustless-cello | `infra/` |

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

S14  (independent — no deps, no blockers)
```

**Three independent tracks** run from day one:

| Track | Stories | Bottleneck |
|-------|---------|------------|
| **Daemon + transport track** | S1 → S3 → S4 → S5/S6 + S7 + S8 → S9 | S4 (cross-repo deploy) |
| **Security track** | S11 → S12 | Key ceremony (S11) is operational work before code |
| **CI/CD track** | S14 | Independent — can run any time |

**Critical path:** S1 → S3 → S4 → S5 → S10 (five stories deep).

**S4 is the serialization bottleneck.** It is a cross-repo protocol change
requiring directory and relay CloudFormation deploys (~25-30 min each). Batch
all pending directory/relay changes before triggering the pipeline.

---

## Shared Interface: SessionAssignment Wire Format (S4)

S4 modifies the most widely-consumed wire format in the protocol. Story authors
for S4 (and all stories that depend on it) must enumerate all producers and
consumers:

**Producer:**
- Directory node (`packages/directory/src/directory-node.ts`) — constructs and
  FROST-signs the `SessionAssignment` after session negotiation

**Consumers:**
- Initiator client (`session-manager.ts`) — reads `counterparty_session_peer_id`
  + `counterparty_session_addrs` to create its own session node and dial
- Target client (`session-manager.ts`) — reads `initiator_session_peer_id` +
  `initiator_session_addrs` to configure its standing receiver's connectionGater
- Relay node (`packages/relay/src/relay-node.ts`) — reads session Peer IDs for
  participant binding enforcement on relayed sessions. **Open question resolved:**
  the relay still receives `SessionAssignment` for relayed sessions (NAT
  fallback); for direct P2P sessions where the relay is not in the path, the
  relay does NOT receive the assignment — it has no role.

**TBS array change:** The FROST to-be-signed array for session establishment
must be extended to include the new fields. Both `signer_pubkey` verification
paths (initiator self-check, counterparty directory-trust) must handle the
enlarged TBS.

---

## Resolved Design Questions

These questions are answered here so that story authors do not block on them.
Each answer is authoritative for M7 story writing.

### Q1: Session establishment round-trips

Alice creates her ephemeral session node at `initiate_session` time (she already
knows she wants a session). Her session Peer ID travels in the session request
to the directory. Bob creates his session node when he accepts the session offer
and reports his Peer ID in the acceptance. The directory now has both Peer IDs
and can issue both `SessionAssignment` frames simultaneously. **One extra
round-trip over today, not two.**

The standing receiver node optimization means Bob's inbound-ready node already
exists before the session offer arrives — eliminating setup latency from the
acceptance path.

### Q2: `cello login` when already logged in

**Idempotent.** If the daemon is already running and healthy, `cello login`
connects to it and reports the current status. It does NOT restart the daemon,
does NOT kill the running process, does NOT re-run connection validation. The
operator sees the same output as `cello status`. If the daemon is running but
the directory connection is in `reconnecting` or `lost` state, `cello login`
reports that state — it does not force a fresh connection attempt (the daemon's
backoff loop is already handling it).

### Q3: Who provides the counterparty's multiaddr to the session node?

The `SessionAssignment` frame carries it. Specifically:
- `counterparty_session_peer_id` — the ephemeral Peer ID of the counterparty's
  session node
- `counterparty_session_addrs` — one or more multiaddrs where that node is
  reachable (direct addresses if dialable via AutoNAT, or circuit relay address
  if behind NAT)

No separate discovery step. The directory collects both sides' session node
addresses during negotiation and delivers them in the signed assignment.

### Q4: `session_interrupted` — new frame type or reuse of seal?

**New frame type.** `session_interrupted` is a relay-originated control frame
(not a client frame) that the relay pushes to the remaining participant when
the other disconnects mid-session. It is NOT a seal — no Merkle root is
committed, no FROST ceremony runs. The remaining participant marks the session
`interrupted` locally and can initiate a "seal-interrupted" flow at next contact
with the counterparty (or discard the session). The seal-interrupted flow is a
bilateral agreement: both sides sign SEAL control leaves committing to whatever
Merkle state existed at interruption, then the normal FROST seal ceremony runs.

### Q5: Signaling reconnect — re-authenticate or resume?

**Full re-authentication.** On signaling stream drop, the daemon reconnects to
a directory node (same or different — whichever is reachable from the manifest
node list) and runs the full 7-step handshake (steps 1–6 + session
established). There is no resume token. This is deliberate: the directory-facing
Peer ID changes on every reconnect anyway (fresh transport key), so a resume
would need to re-prove identity regardless. Re-running the full handshake also
means the client re-verifies the directory's identity against the manifest on
every reconnect — preventing a MITM from hijacking an existing session.

### Q6: Retry queue and nonce dedup — persist or ephemeral?

**Persisted.** SQLCipher tables `retry_queue` and `session_seen_nonces` survive
daemon restarts. This is a change from the archived MULTI-006 design which was
explicitly ephemeral. The daemon model makes persistence viable (the daemon
outlives any individual MCP connection and its SQLite handle is always open).
Messages queued for retry survive a brief daemon restart (e.g. system update);
nonce dedup sets survive to prevent duplicates across restart boundaries.

---

## Resource Caps and Graceful Degradation

Stories must include ACs for graceful behavior at these limits. Numbers are
authoritative for M7 — story authors use these values directly:

| Resource | Cap | Story | Degradation behavior |
|----------|-----|-------|---------------------|
| Concurrent session nodes per daemon | 32 | S3 | `initiate_session` returns `{ ok: false, reason: "max_sessions_reached", guidance: "Close an existing session before starting a new one." }` |
| IPC connections per daemon | 16 | S1 | New connection attempt receives an error frame and socket closes gracefully |
| Retry queue depth per session | 1000 messages | S8 | Oldest message evicted (FIFO) with `message.retry.evicted` event |
| Nonce dedup set size per session | 10,000 entries | S8 | Oldest nonce evicted (LRU); acceptable because nonces older than the queue depth cannot arrive via legitimate retry |
| Pending outbound ops during signaling reconnect | 64 | S7 | New ops return `{ ok: false, reason: "signaling_queue_full", guidance: "Wait for directory reconnection." }` |
| Standing receiver nodes | 1 per daemon | S3 | Only one pre-created; additional inbound sessions wait for node creation (~50ms) |

---

## Test Infrastructure

### Fixture status and extensions needed

The current `createSessionFixture()` assumes one `CelloClient` per agent in the
same process. M7 fundamentally changes this assumption. The fixture must be
extended — story authors should note these extensions in their ACs.

**Proposed fixture extensions (first story that needs each capability adds it):**

| Extension | Needed by | What it does |
|-----------|-----------|-------------|
| `opts.daemon: true` | S1 | Start a daemon process instead of direct CelloClient; returns IPC socket path |
| `opts.ipcClients: number` | S2 | Connect N test MCP clients to daemon via IPC |
| `opts.ephemeralSessionNodes: true` | S3 | Use per-session nodes (default for M7+ once S3 lands) |
| `opts.directP2P: true` | S5 | Skip relay for session transport; dial counterparty directly |
| `opts.standingReceiver: true` | S3 | Pre-create a standing receiver node at daemon startup |
| `opts.manifest: ManifestConfig` | S12 | Provide a test manifest with specified keys and expiry |

### Stories requiring `CELLO_E2E_LIVE`

These stories require a running daemon, real directory connection, or real
network conditions that `createSessionFixture()` cannot provide in-process:

- **S5** — AutoNAT requires real network (or at minimum, multiple libp2p nodes
  on distinct ports performing dial-back)
- **S7** — Signaling resilience requires a killable signaling stream (daemon +
  real directory or mock directory process)
- **S10** — Full integration gate — all processes live
- **S12** — Handshake step 6 against a real directory node with a signed challenge

**Stories testable in-process via fixture extension:**

- **S1** — Daemon lifecycle and IPC (test daemon as a spawned child process)
- **S2** — MCP proxy (test against daemon socket)
- **S3** — Ephemeral node lifecycle (multiple libp2p nodes in-process)
- **S4** — Wire format (serialization tests are pure; integration needs fixture)
- **S6** — Interrupted handling (simulate disconnect in-process)
- **S8** — Retry queue + nonce dedup (pure logic + SQLCipher round-trip)
- **S9** — Notifications (test against daemon socket)
- **S11** — Manifest schema (pure crypto, no network)

---

## Observability Events

Story authors must use these exact event names in their `observability:` blocks
and corresponding ACs. All events follow the `domain.noun.verb` taxonomy.

### Daemon lifecycle (S1)

| Event | Level | Context fields |
|-------|-------|---------------|
| `daemon.started` | info | `pid`, `ipcSocketPath`, `agentCount` |
| `daemon.stopped` | info | `pid`, `reason` (graceful / signal / error) |
| `daemon.ipc.connected` | info | `connectionId`, `clientType` (mcp / cli) |
| `daemon.ipc.disconnected` | info | `connectionId`, `reason` |
| `daemon.login.validation.complete` | info | `verifiedCount`, `staleCount`, `goneCount` |

### Agent state (S1, S2)

| Event | Level | Context fields |
|-------|-------|---------------|
| `agent.online` | info | `agentName`, `agentPubkey` |
| `agent.offline` | info | `agentName`, `reason` |
| `agent.current.switched` | info | `connectionId`, `fromAgent`, `toAgent` |

### Session nodes (S3)

| Event | Level | Context fields |
|-------|-------|---------------|
| `session.node.created` | info | `sessionId`, `agentName`, `sessionPeerId`, `correlationId` |
| `session.node.destroyed` | info | `sessionId`, `agentName`, `reason` (sealed / interrupted / error) |
| `session.node.cap.reached` | warn | `agentName`, `currentCount`, `maxCount` |

### Session assignment (S4)

| Event | Level | Context fields |
|-------|-------|---------------|
| `session.assignment.received` | info | `sessionId`, `counterpartyPubkey`, `transportMode` (direct / relay), `correlationId` |
| `session.assignment.verification.failed` | error | `sessionId`, `reason`, `correlationId` |

### AutoNAT + direct P2P (S5)

| Event | Level | Context fields |
|-------|-------|---------------|
| `transport.autonat.result` | info | `dialable`, `publicAddr`, `nodeType` (standing_receiver / session) |
| `session.transport.mode.selected` | info | `sessionId`, `mode` (direct / relay / dcutr_upgrade), `correlationId` |
| `session.transport.dcutr.upgraded` | info | `sessionId`, `correlationId` |

### Interrupted sessions (S6)

| Event | Level | Context fields |
|-------|-------|---------------|
| `session.interrupted.detected` | warn | `sessionId`, `agentName`, `source` (relay_frame / stream_close) |
| `session.interrupted.sealed` | info | `sessionId`, `agentName`, `leafCount` |

### Signaling resilience (S7)

| Event | Level | Context fields |
|-------|-------|---------------|
| `directory.signaling.connected` | info | `directoryNodeId`, `manifestVersion` |
| `directory.signaling.disconnected` | warn | `directoryNodeId`, `reason` |
| `directory.signaling.reconnecting` | info | `attempt`, `backoffMs`, `directoryNodeId` |
| `directory.signaling.reconnect.failed` | error | `attempt`, `maxAttempts`, `lastError` |

### Retry queue + nonce dedup (S8)

| Event | Level | Context fields |
|-------|-------|---------------|
| `message.retry.queued` | info | `sessionId`, `nonce`, `queueDepth` |
| `message.retry.delivered` | info | `sessionId`, `nonce`, `attemptsTotal` |
| `message.retry.evicted` | warn | `sessionId`, `nonce`, `queueDepth` |
| `message.nonce.duplicate` | debug | `sessionId`, `nonce`, `senderPubkey` |

### Bidirectional auth (S12)

| Event | Level | Context fields |
|-------|-------|---------------|
| `directory.auth.manifest.verified` | info | `manifestVersion`, `signerCount` |
| `directory.auth.manifest.expired` | error | `manifestVersion`, `expiresAt` |
| `directory.auth.manifest.poll.success` | info | `oldVersion`, `newVersion` |
| `directory.auth.challenge.verified` | info | `directoryNodeId` |
| `directory.auth.challenge.failed` | error | `directoryNodeId`, `reason` |

---

## Constraints Inherited from CLAUDE.md

These constraints are load-bearing for M7 stories. Story authors must restate
them inline in the relevant story's behavior or ACs — not only in
`implementation_notes`.

| Constraint | Applies to | What to restate |
|-----------|-----------|----------------|
| **Sovereign node invariant** | S11, S12, S4 | Directory nodes are independent. The manifest lists multiple nodes across providers and regions. No story may assume co-location, shared networking, or single-provider deployment. Each directory node signs independently. |
| **No console.log** | All stories | All log events go through the injected `Logger` interface. No `console.log` in implementation code. |
| **Never push Docker from local** | S14 | CI/CD pipeline is the only image push mechanism. |
| **workspace:\* is a bug** | S4, S6, S12 (any cross-repo story) | References to cello-client packages in trustless-cello must be pinned semver, never `workspace:*`. |
| **Adapter pattern mandatory** | S3, S5 | Session node creation, AutoNAT, and transport selection are behind interfaces with local stubs. |
| **Batch before push** | S4 (cross-repo deploy) | Never push a small fix alone when other directory/relay changes are pending. Pipeline is 25-30 min. |
| **FROST TBS domain separation** | S4 | Context string `"cello-frost-session-establishment-v1"` must be used; new fields in TBS extend the positional array. |
| **Cross-repo version bump** | S4, S6, S12 | Stories that change cello-client packages require version-bump + trustless-cello dependency-update ACs. |
| **IaC-only resource creation** | S14 | Never create AWS resources manually that CloudFormation should manage. |
| **connectionGater per session node** | S3 | Each session node accepts connections from exactly one peer. The directory-facing node only accepts directory Peer IDs. |

---

## Cross-Repo Stories — Version Bump Triggers

The following stories modify cello-client packages and therefore **require** both
the `AC-version-bump` and `AC-trustless-cello-dependency-update` ACs defined in
`/cello-story`:

| Story | What changes in cello-client | What changes in trustless-cello |
|-------|------------------------------|-------------------------------|
| S1 | New `packages/daemon`, `packages/cli` | — |
| S2 | `packages/adapter-claude-code` rewrite | — |
| S3 | `packages/daemon` (session node manager) | — |
| S4 | `packages/protocol-types`, `packages/client` | `packages/directory`, `packages/relay` |
| S5 | `packages/transport` (AutoNAT) | — |
| S6 | `packages/client` (interrupted handling) | `packages/relay` (new frame type) |
| S7 | `packages/transport` (signaling manager) | — |
| S8 | `packages/daemon`, `packages/client` | — |
| S9 | `packages/adapter-claude-code` | — |
| S11 | `packages/crypto`, `packages/protocol-types` | — |
| S12 | `packages/transport`, `packages/daemon` | `packages/directory` (signs challenge) |

**S4, S6, and S12 touch both repos.** Their version-bump ACs must include the
trustless-cello dependency update and a push triggering the directory/relay
pipeline.

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
