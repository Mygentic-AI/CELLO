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

## M7 Error Discipline — Non-Negotiable

M5/M6 cost days of debugging because errors were obscured at two levels: (1)
catch blocks mapped multiple distinct failure causes to the same generic error
code, making diagnosis impossible; and (2) MCP tool responses returned a reason
code with no guidance, leaving the calling LLM unable to recover. M7 introduces
a daemon layer, a new IPC transport, and rewrites the MCP adapter — three new
error surfaces. Every story must enforce both rules below.

### Rule 1: Every distinct failure cause produces a distinct error

**The M6B-002 pattern:** Three FROST failure modes (timeout waiting for
directory response, all directory nodes exhausted, directory node returned
malformed commitment) all surfaced as `directory_below_threshold`. The operator
saw one error for three different problems. The fix for each was different. Days
were spent proving which cause was actually firing because the error provided no
signal.

**The M7 risk:** The daemon adds new failure surfaces — IPC serialization errors,
daemon not running, wrong daemon version, agent not online, session node creation
failure, signaling reconnect in progress. If these all surface as a generic
`daemon_error` or `internal_error`, the same pattern repeats.

**What every story must include:**

For every catch block or error return path in the story's scope:
- A distinct error code (not shared with any other failure cause)
- The actual exception message preserved in the error event (never swallowed)
- Enough context to identify the producer of the failed precondition

**AC pattern (include in every story that has error paths):**
```yaml
- id: AC-[N]-error-distinctness
  given: "All error paths in this story's implementation"
  when: "each distinct failure cause is triggered independently"
  then: "each produces a unique error code distinguishable from all other
    failure causes in the same package; no catch block returns a hardcoded
    reason string without logging the actual exception; the operator can
    determine from the error alone which failure cause fired and what
    component produced it"
  test_type: unit
  component_under_test: [component]
```

**Lateral catch audit:** If this story touches a package that has existing catch
blocks with generic reason strings, the story must include an AC requiring the
implementer to scan ALL catch blocks in that package and fix or report any that
swallow exceptions silently. This is not optional — it prevents the "fixed the
new code but the old code in the same file still obscures errors" pattern.

### Rule 2: Every MCP tool failure includes actionable guidance

**The M6-E2E-001 pattern:** `cello_send` returned
`{ delivered: false, reason: "session_not_active" }`. The calling LLM had no
idea what to do. The correct action was to call `cello_close_session` because
the counterparty had already initiated the seal ceremony. But nothing in the
response said that.

**The M7 risk:** M7 introduces new MCP tools (`cello_use_agent`,
`cello_list_agents`, `cello_start_agent`, `cello_stop_agent`) and rewrites
existing ones to route through the daemon. Each tool has multiple failure modes.
An LLM calling these tools cannot read source code — it needs the response to
tell it what happened and what to do next.

**What every MCP tool failure response must include:**

```typescript
{
  ok: false,
  reason: "connection_not_found",           // machine-readable, distinct
  guidance: "No active connection exists with this counterparty. " +
            "Call cello_request_connection first to establish one."
}
```

The `guidance` field is a plain-English instruction for the LLM. It must answer:
1. What happened (in terms the LLM can understand without code context)
2. What to do next (which specific tool to call, or what state to wait for)

**AC pattern (include in every story that exposes MCP tool responses):**
```yaml
- id: AC-[N]-actionable-guidance
  given: "Every failure response path in MCP tools introduced or modified by
    this story"
  when: "each failure path is triggered"
  then: "the response includes a `guidance` field that names the specific
    next action the calling LLM should take; the guidance is sufficient for
    an LLM with no code access to recover without human intervention"
  test_type: unit
  component_under_test: adapter-claude-code
```

### M7 Error Surface Map

Story authors must anticipate these failure modes in their ACs. Each must have
a distinct code and actionable guidance:

| Story | New failure modes (each needs distinct code + guidance) |
|-------|-------------------------------------------------------|
| M7-DAEMON-001 | daemon_not_running, daemon_version_mismatch, ipc_connection_refused, ipc_connection_limit, agent_not_found, agent_not_online, login_already_active (idempotent success), directory_unreachable_at_login |
| M7-MCP-001 | no_current_agent, agent_already_current, agent_not_online (distinguish from not_found), ipc_deserialization_error |
| M7-DAEMON-002 | max_sessions_reached, session_node_creation_failed, standing_receiver_unavailable, connectionGater_rejected_peer |
| M7-WIRE-001 | assignment_missing_session_peer_id, assignment_peer_id_mismatch, assignment_tbs_verification_failed (distinguish from existing frost_verification_failed) |
| M7-TRANSPORT-001 | autonat_unavailable, direct_dial_failed_falling_back_to_relay, relay_fallback_also_failed, dcutr_upgrade_failed (non-fatal) |
| M7-SESSION-001 | session_already_interrupted, seal_interrupted_counterparty_unavailable, seal_interrupted_rejected_by_counterparty |
| M7-SIGNAL-001 | signaling_reconnecting (not an error — but tool calls during this state need guidance: "wait and retry"), signaling_lost (operator intervention needed), outbound_queue_full |
| M7-DAEMON-003 | retry_queue_full (oldest evicted — inform caller), nonce_duplicate_detected (silent discard, but logged) |
| M7-MANIFEST-002 | manifest_expired, manifest_signature_invalid, manifest_version_rollback, directory_challenge_failed |

---

## M6/M6B Lessons — Patterns That Must Not Repeat

These failure patterns each cost 1–4 days of debugging time. They are all fixed
in M6/M6B code. M7 introduces new surfaces (daemon, IPC, CLI, session nodes,
manifest polling) where the same patterns can recur. Every story author must
read this list and verify their story doesn't reintroduce any of them.

### L1: Typed fields corrupted through serialization

**What happened:** `JSON.stringify` silently converts `Uint8Array` to
`{"0":1,"1":2,...}`. Bytes round-trip correctly but the TYPE is lost. Crypto
operations fail later with no link back to the serialization bug. PERSIST-005
cost 2 days — the error surfaced as `directory_below_threshold`, not as a
serialization failure.

**M7 risk:** S8 persists retry queue entries and nonce sets to SQLCipher. Any
`Uint8Array` field (message content hashes, nonces) that passes through JSON
without a typed serializer will corrupt silently.

**Story AC requirement:** Every story that persists a domain object must include
a round-trip AC that (a) uses a real domain instance (not `randomBytes`), (b)
serializes → persists → restarts → loads → deserializes, and (c) exercises the
object in its actual production use (sign with it, verify with it, send it).
Byte equality alone is not sufficient.

---

### L2: In-memory state not loaded from DB at startup

**What happened:** The directory's `PgDirectoryStore` had ~15 in-memory Maps
populated during runtime but never loaded from Postgres at startup. Every
restart made all registered agents invisible. Also: `FrostThresholdSigner` was
restored without `setBootstrapContext` — signatures failed.

**M7 risk:** The daemon holds agent state, session metadata, connection records,
retry queues, nonce sets, and the manifest version. If any of these are
populated at runtime but not loaded from SQLCipher at `cello login`, the daemon
appears healthy but is non-functional.

**Story AC requirement:** Every story that adds a runtime-populated data
structure must include an AC that: (1) populates the structure during normal
operation, (2) stops and restarts the daemon, (3) verifies the structure is
loaded and functional after restart — not just present, but usable in its
actual protocol operation.

---

### L3: Composition root never wired

**What happened:** PERSIST-024 built the entire persistence layer — classes,
methods, tests all passing. The composition root (`cello-mcp.ts`) never called
any of it. Everything was dead code. Discovered only during live deployment.

**M7 risk:** M7 creates two new entrypoints: `packages/daemon/src/server.ts`
(daemon) and `packages/cli/src/bin.ts` (CLI). Both are composition roots that
must instantiate every component. If a story delivers a class but the
composition root doesn't instantiate it, the feature doesn't exist in
production.

**Story AC requirement:** Every story must include an AC that verifies the
composition root constructs and calls the new component — not just that the
component exists and passes its own tests. The AC's `then` clause must assert
observable behavior from the entrypoint (e.g. "calling `cello status` via CLI
shows the new field"), not just that a class method returns the right value.

---

### L4: Tests exercise preconditions, not actual operations

**What happened:** After M6-DX-001, `registered=true` and
`directory_reachable=true` both verified. But calling `cello_initiate_session`
(which triggers a real FROST ceremony) still failed — because
`setBootstrapContext` was never called on the restored signer stub. Tests that
checked "is setup correct?" all passed. The test that checked "does the
operation work?" didn't exist.

**M7 risk:** The daemon has a complex startup sequence (load agents, validate
connections, connect to directory, create standing receiver). Tests that assert
"daemon started successfully" or "agent status = online" verify preconditions.
Only a test that actually sends a message through the full path (IPC → daemon →
session node → counterparty) proves the system works.

**Story AC requirement:** At least one AC per story must exercise the END
operation, not just the setup. For S1 that means "a CLI command reaches the
directory and gets a response." For S3 that means "a message is delivered via
the ephemeral session node." State-only assertions (`status === 'online'`) are
precondition checks, not behavior proof.

---

### L5: Silent signaling stream death

**What happened:** After ~2 minutes of idle signaling, the stream dropped. The
process stayed alive with `directory_reachable: false`. No reconnect, no error,
no user-visible indication. FROST ceremonies silently failed. Seal frames went
into a dead stream.

**M7 risk:** S7 addresses signaling resilience directly. But every OTHER story
that sends anything over the signaling stream (S4: session assignment, S6:
interrupted handling, S12: manifest poll) must assume the stream can be dead at
the moment of use. Operations must check `directory_signaling` status before
sending, or queue for delivery after reconnect.

**Story AC requirement:** Any story that sends a frame over the directory
signaling stream must include an AC where the stream is dead at the moment of
the operation. The expected behavior is either: (a) the operation queues and
succeeds after reconnect, or (b) the operation returns a distinct error with
guidance ("directory connection lost — reconnecting, retry in N seconds"). Never
silent failure.

---

### L6: Error objects serialized as `[object Object]`

**What happened:** The relay's TCP error (`EHOSTUNREACH to 10.0.85.235:4001`)
was caught and stringified. The catch block logged `reason: relay_unavailable`
with the error object interpolated as `[object Object]`. The actual cause was
invisible for days.

**M7 risk:** The daemon introduces IPC (Unix socket) and multiple libp2p nodes.
Socket errors, connection refusals, and libp2p dial failures all produce Error
objects. If any catch block logs `${error}` or interpolates an object without
`.message`, the same pattern recurs.

**Story AC requirement:** Every catch block in M7 code must log
`error.message` (string) explicitly — never the error object directly. The
`/cello-review` lateral catch audit enforces this, but story authors should
specify it in their error-path ACs to prevent the bug from being written in
the first place.

---

### L7: `NODE_ENV=test` shortcuts bypassing real protocol paths

**What happened:** `bootstrapKeyShares` (a test-only shortcut) made all FROST
tests pass without running a real multi-party ceremony. The real ceremony path
had bugs that were invisible until production.

**M7 risk:** The daemon introduces an IPC layer between the MCP adapter and the
protocol core. If tests call the daemon's internal methods directly (bypassing
IPC), the IPC serialization/deserialization path is never tested. Same for
session nodes — if tests skip node creation and inject mock connections, the
`connectionGater` path is never exercised.

**Story AC requirement:** Integration and E2E ACs must explicitly state that the
test path goes through the real transport boundary (IPC socket, libp2p stream,
session node connectionGater). An AC that says "the daemon processes the request"
must specify "received via IPC from a separate process/connection, not via
internal method call." `/cello-story`'s stub-resistance rules apply here.

---

### L8: Health check conflates liveness with readiness

**What happened:** Relay health endpoint returned 503 until registered with the
directory. ECS uses health checks for liveness. Result: ECS killed tasks before
they could register → 29-task crash loop across 3 regions.

**M7 risk:** The daemon has a startup sequence: open DB → load agents → connect
to directory → validate connections → create standing receiver. If the health
endpoint (used by process supervisors or IPC clients) gates on "fully ready,"
a slow directory connection blocks everything.

**Story AC requirement:** S1 must specify: the daemon's health/liveness signal
(e.g. responding to IPC `ping`) reflects "process is alive and accepting
connections," NOT "directory connected and all agents online." Readiness for
operations is a separate status field (`cello status` output), not a liveness
gate. A daemon that is alive but reconnecting to the directory must still accept
IPC connections and report its state — not refuse connections or exit.

---

## Coordination

Two files govern parallel work on M7. **Read both before starting any story.**

**`COORDINATION.md`** — structural state; edit in place.
- Story ownership claims (who is working on what)
- Package ownership table (which stories touch which packages)
- Migration version registry
- Cross-repo pipeline batching status
- Active blockers

Read this in 60 seconds at the start of every session. It answers: "what can I
touch, what is already claimed, what is blocked."

**`WORKLOG.md`** — append-only running diary.
- Debugging sessions and root cause findings
- Deployment results and ECS/pipeline observations
- Mid-story decisions and AC interpretations
- Anything useful for a future agent hitting the same problem

Append freely. Never edit existing entries. When a log entry produces a durable
rule, promote it to `outline.md`, `CLAUDE.md`, or the milestone writeup — the
log entry stays as history, but rules must not live only in the log.

---

## Story Breakdown

## Story IDs

Stories use the format `M7-{DOMAIN}-{NNN}`:

| Story ID | Title | Depends on | Repo(s) | Primary package(s) |
|----------|-------|------------|---------|-------------------|
| **CELLO-M7-E2E-001** | M7 integration gate — daemon running, two Claude sessions via IPC, two agents with ephemeral session nodes, full exchange, bidirectional auth exercised, signaling resilience verified | all others | **both** | `packages/e2e-tests` |
| **M7-DAEMON-001** | Daemon foundation — IPC socket, connect-or-start, `cello login/logout/status`, agent loading, backwards compat, connection validation on login | — | cello-client | `packages/daemon` (new), `packages/cli` (new) |
| **M7-MCP-001** | MCP adapter — stdio-to-socket proxy, per-connection current-agent state, `cello_use_agent / list_agents / start_agent / stop_agent` | M7-DAEMON-001 | cello-client | `packages/adapter-claude-code` |
| **M7-DAEMON-002** | Ephemeral session nodes — create/teardown lifecycle, connectionGater, standing receiver node | M7-DAEMON-001 | cello-client | `packages/daemon/src/session-node-manager.ts` (new) |
| **M7-WIRE-001** | SessionAssignment wire format — add `counterparty_session_peer_id` + `counterparty_session_addrs` to signed frame (cross-repo: directory, relay, client) | M7-DAEMON-002 | **both** | `packages/protocol-types`, `packages/directory`, `packages/relay`, `packages/client` |
| **M7-TRANSPORT-001** | AutoNAT + direct P2P default — `autonat()` in createNode, dialability observable, direct dial default, relay fallback, dcutr upgrade | M7-WIRE-001 | cello-client | `packages/transport/src/node.ts`, `packages/daemon` |
| **M7-SESSION-001** | Interrupted session handling — relay `session_interrupted` frame, DB `interrupted` status, login surfacing, seal-interrupted protocol flow | M7-DAEMON-002, M7-WIRE-001 | **both** | `packages/relay`, `packages/daemon`, `packages/client` |
| **M7-SIGNAL-001** | Signaling stream resilience — heartbeat/keepalive on signaling stream, exponential backoff reconnect, `directory_signaling` status, queued outbound ops retry after reconnect | M7-DAEMON-001 | cello-client | `packages/transport/src/signaling-manager.ts`, `packages/daemon` |
| **M7-DAEMON-003** | Nonce dedup + retry queue — rehoused in daemon; SQLCipher `retry_queue` and `session_seen_nonces` tables | M7-DAEMON-002 | cello-client | `packages/daemon`, `packages/client` |
| **M7-MCP-002** | Agent-aware notifications — `agent` field on existing notifications, session node lifecycle as presence signals | M7-MCP-001, M7-DAEMON-002, M7-DAEMON-003 | cello-client | `packages/adapter-claude-code`, `packages/daemon` |
| **M7-MANIFEST-001** | Manifest schema + initial manifest — JSON schema (`version`, `not_before`, `expires`, threshold sig), officer key ceremony, N root key constants in binary | — | cello-client | `packages/crypto`, `packages/protocol-types` |
| **M7-MANIFEST-002** | Client verification + handshake step 6 + manifest polling — threshold sig check, version/expiry enforcement, directory signs challenge response, client verifies against manifest; 6–12 hour background poll in daemon | M7-DAEMON-001, M7-MANIFEST-001 | **both** | `packages/transport`, `packages/daemon`, `packages/directory` |
| **M7-CICD-001** | Cross-repo CI/CD — wire cello-client as second source into integration pipelines; cello-client push triggers build→e2e→block npm publish on failure | — | trustless-cello | `infra/` |

---

## Story Writing Order

Write stories in this order. CELLO-M7-E2E-001 is written first as the anchor —
it defines the observable end state that all component stories work toward.
After all component stories are written, do a **cohesion pass on CELLO-M7-E2E-001**
to align its ACs with what the component stories actually specify.

1. CELLO-M7-E2E-001 *(write now; revise after all others are written)*
2. M7-DAEMON-001
3. M7-MCP-001
4. M7-DAEMON-002
5. M7-SIGNAL-001
6. M7-DAEMON-003
7. M7-MANIFEST-001
8. M7-WIRE-001
9. M7-TRANSPORT-001
10. M7-SESSION-001
11. M7-MCP-002
12. M7-MANIFEST-002
13. M7-CICD-001
14. CELLO-M7-E2E-001 *(cohesion pass — revise ACs to match component stories)*

---

## Implementation Order

Implementation order differs from writing order. CELLO-M7-E2E-001 is implemented
**last** — it is the close gate, not the starting point.

1. M7-DAEMON-001 *(no deps; everything else flows from here)*
2. M7-MANIFEST-001 *(independent; start in parallel with M7-DAEMON-001)*
3. M7-CICD-001 *(independent; can run any time)*
4. M7-DAEMON-002 *(needs M7-DAEMON-001)*
5. M7-SIGNAL-001 *(needs M7-DAEMON-001)*
6. M7-MCP-001 *(needs M7-DAEMON-001)*
7. M7-DAEMON-003 *(needs M7-DAEMON-002)*
8. M7-WIRE-001 *(needs M7-DAEMON-002; cross-repo deploy — batch with M7-SESSION-001 and M7-MANIFEST-002)*
9. M7-SESSION-001 *(needs M7-DAEMON-002 + M7-WIRE-001; batch pipeline push with M7-WIRE-001)*
10. M7-MANIFEST-002 *(needs M7-DAEMON-001 + M7-MANIFEST-001; batch pipeline push with M7-WIRE-001)*
11. M7-TRANSPORT-001 *(needs M7-WIRE-001)*
12. M7-MCP-002 *(needs M7-MCP-001 + M7-DAEMON-002 + M7-DAEMON-003)*
13. CELLO-M7-E2E-001 *(implemented last — close gate)*

**Pipeline batching note:** M7-WIRE-001, M7-SESSION-001, and M7-MANIFEST-002
all require directory/relay CloudFormation deploys (~25-30 min each). Never
push these one at a time. Batch all three into a single pipeline push.

---

## Dependency Map

```
DAEMON-001 ──→ MCP-001   ────────────────────────────────────────┐
           ├──→ DAEMON-002 ──→ WIRE-001 ──→ TRANSPORT-001 ──────→ │
           │               │           └──→ SESSION-001  ──────→ │
           │               └──→ DAEMON-003 ──→ MCP-002   ──────→ E2E-001 (gate)
           └──→ SIGNAL-001 ────────────────────────────────────→ │
                                                                  │
MANIFEST-001 ──→ MANIFEST-002 ──────────────────────────────────→ │

CICD-001  (independent — no deps, no blockers)
```

**Three independent tracks** run from day one:

| Track | Stories | Bottleneck |
|-------|---------|------------|
| **Daemon + transport track** | DAEMON-001 → DAEMON-002 → WIRE-001 → TRANSPORT-001/SESSION-001 + SIGNAL-001 + DAEMON-003 → MCP-002 | WIRE-001 (cross-repo deploy) |
| **Security track** | MANIFEST-001 → MANIFEST-002 | Key ceremony (MANIFEST-001) is operational work before code |
| **CI/CD track** | CICD-001 | Independent — can run any time |

**Critical path:** DAEMON-001 → DAEMON-002 → WIRE-001 → TRANSPORT-001 → E2E-001 (five stories deep).

**WIRE-001 is the pipeline bottleneck.** It is a cross-repo protocol change
requiring directory and relay CloudFormation deploys (~25-30 min each). Batch
all pending directory/relay changes (WIRE-001 + SESSION-001 + MANIFEST-002)
before triggering the pipeline.

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
| Concurrent session nodes per daemon | 32 | M7-DAEMON-002 | `initiate_session` returns `{ ok: false, reason: "max_sessions_reached", guidance: "Close an existing session before starting a new one." }` |
| IPC connections per daemon | 16 | M7-DAEMON-001 | New connection attempt receives an error frame and socket closes gracefully |
| Retry queue depth per session | 1000 messages | M7-DAEMON-003 | Oldest message evicted (FIFO) with `message.retry.evicted` event |
| Nonce dedup set size per session | 10,000 entries | M7-DAEMON-003 | Oldest nonce evicted (LRU); acceptable because nonces older than the queue depth cannot arrive via legitimate retry |
| Pending outbound ops during signaling reconnect | 64 | M7-SIGNAL-001 | New ops return `{ ok: false, reason: "signaling_queue_full", guidance: "Wait for directory reconnection." }` |
| Standing receiver nodes | 1 per daemon | M7-DAEMON-002 | Only one pre-created; additional inbound sessions wait for node creation (~50ms) |

---

## Test Infrastructure

### Fixture status and extensions needed

The current `createSessionFixture()` assumes one `CelloClient` per agent in the
same process. M7 fundamentally changes this assumption. The fixture must be
extended — story authors should note these extensions in their ACs.

**Proposed fixture extensions (first story that needs each capability adds it):**

| Extension | Needed by | What it does |
|-----------|-----------|-------------|
| `opts.daemon: true` | M7-DAEMON-001 | Start a daemon process instead of direct CelloClient; returns IPC socket path |
| `opts.ipcClients: number` | M7-MCP-001 | Connect N test MCP clients to daemon via IPC |
| `opts.ephemeralSessionNodes: true` | M7-DAEMON-002 | Use per-session nodes (default for M7+ once DAEMON-002 lands) |
| `opts.directP2P: true` | M7-TRANSPORT-001 | Skip relay for session transport; dial counterparty directly |
| `opts.standingReceiver: true` | M7-DAEMON-002 | Pre-create a standing receiver node at daemon startup |
| `opts.manifest: ManifestConfig` | M7-MANIFEST-002 | Provide a test manifest with specified keys and expiry |

### Stories requiring `CELLO_E2E_LIVE`

These stories require a running daemon, real directory connection, or real
network conditions that `createSessionFixture()` cannot provide in-process:

- **M7-TRANSPORT-001** — AutoNAT requires real network (or at minimum, multiple libp2p nodes on distinct ports performing dial-back)
- **M7-SIGNAL-001** — Signaling resilience requires a killable signaling stream (daemon + real directory or mock directory process)
- **CELLO-M7-E2E-001** — Full integration gate — all processes live
- **M7-MANIFEST-002** — Handshake step 6 against a real directory node with a signed challenge

**Stories testable in-process via fixture extension:**

- **M7-DAEMON-001** — Daemon lifecycle and IPC (test daemon as a spawned child process)
- **M7-MCP-001** — MCP proxy (test against daemon socket)
- **M7-DAEMON-002** — Ephemeral node lifecycle (multiple libp2p nodes in-process)
- **M7-WIRE-001** — Wire format (serialization tests are pure; integration needs fixture)
- **M7-SESSION-001** — Interrupted handling (simulate disconnect in-process)
- **M7-DAEMON-003** — Retry queue + nonce dedup (pure logic + SQLCipher round-trip)
- **M7-MCP-002** — Notifications (test against daemon socket)
- **M7-MANIFEST-001** — Manifest schema (pure crypto, no network)

---

## Observability Events

Story authors must use these exact event names in their `observability:` blocks
and corresponding ACs. All events follow the `domain.noun.verb` taxonomy.

### Daemon lifecycle (M7-DAEMON-001)

| Event | Level | Context fields |
|-------|-------|---------------|
| `daemon.started` | info | `pid`, `ipcSocketPath`, `agentCount` |
| `daemon.stopped` | info | `pid`, `reason` (graceful / signal / error) |
| `daemon.ipc.connected` | info | `connectionId`, `clientType` (mcp / cli) |
| `daemon.ipc.disconnected` | info | `connectionId`, `reason` |
| `daemon.login.validation.complete` | info | `verifiedCount`, `staleCount`, `goneCount` |

### Agent state (M7-DAEMON-001, M7-MCP-001)

| Event | Level | Context fields |
|-------|-------|---------------|
| `agent.online` | info | `agentName`, `agentPubkey` |
| `agent.offline` | info | `agentName`, `reason` |
| `agent.current.switched` | info | `connectionId`, `fromAgent`, `toAgent` |

### Session nodes (M7-DAEMON-002)

| Event | Level | Context fields |
|-------|-------|---------------|
| `session.node.created` | info | `sessionId`, `agentName`, `sessionPeerId`, `correlationId` |
| `session.node.destroyed` | info | `sessionId`, `agentName`, `reason` (sealed / interrupted / error) |
| `session.node.cap.reached` | warn | `agentName`, `currentCount`, `maxCount` |

### Session assignment (M7-WIRE-001)

| Event | Level | Context fields |
|-------|-------|---------------|
| `session.assignment.received` | info | `sessionId`, `counterpartyPubkey`, `transportMode` (direct / relay), `correlationId` |
| `session.assignment.verification.failed` | error | `sessionId`, `reason`, `correlationId` |

### AutoNAT + direct P2P (M7-TRANSPORT-001)

| Event | Level | Context fields |
|-------|-------|---------------|
| `transport.autonat.result` | info | `dialable`, `publicAddr`, `nodeType` (standing_receiver / session) |
| `session.transport.mode.selected` | info | `sessionId`, `mode` (direct / relay / dcutr_upgrade), `correlationId` |
| `session.transport.dcutr.upgraded` | info | `sessionId`, `correlationId` |

### Interrupted sessions (M7-SESSION-001)

| Event | Level | Context fields |
|-------|-------|---------------|
| `session.interrupted.detected` | warn | `sessionId`, `agentName`, `source` (relay_frame / stream_close) |
| `session.interrupted.sealed` | info | `sessionId`, `agentName`, `leafCount` |

### Signaling resilience (M7-SIGNAL-001)

| Event | Level | Context fields |
|-------|-------|---------------|
| `directory.signaling.connected` | info | `directoryNodeId`, `manifestVersion` |
| `directory.signaling.disconnected` | warn | `directoryNodeId`, `reason` |
| `directory.signaling.reconnecting` | info | `attempt`, `backoffMs`, `directoryNodeId` |
| `directory.signaling.reconnect.failed` | error | `attempt`, `maxAttempts`, `lastError` |

### Retry queue + nonce dedup (M7-DAEMON-003)

| Event | Level | Context fields |
|-------|-------|---------------|
| `message.retry.queued` | info | `sessionId`, `nonce`, `queueDepth` |
| `message.retry.delivered` | info | `sessionId`, `nonce`, `attemptsTotal` |
| `message.retry.evicted` | warn | `sessionId`, `nonce`, `queueDepth` |
| `message.nonce.duplicate` | debug | `sessionId`, `nonce`, `senderPubkey` |

### Bidirectional auth (M7-MANIFEST-002)

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
| **Sovereign node invariant** | M7-MANIFEST-001, M7-MANIFEST-002, M7-WIRE-001 | Directory nodes are independent. The manifest lists multiple nodes across providers and regions. No story may assume co-location, shared networking, or single-provider deployment. Each directory node signs independently. |
| **No console.log** | All stories | All log events go through the injected `Logger` interface. No `console.log` in implementation code. |
| **Never push Docker from local** | M7-CICD-001 | CI/CD pipeline is the only image push mechanism. |
| **workspace:\* is a bug** | M7-WIRE-001, M7-SESSION-001, M7-MANIFEST-002 (any cross-repo story) | References to cello-client packages in trustless-cello must be pinned semver, never `workspace:*`. |
| **Adapter pattern mandatory** | M7-DAEMON-002, M7-TRANSPORT-001 | Session node creation, AutoNAT, and transport selection are behind interfaces with local stubs. |
| **Batch before push** | M7-WIRE-001 (cross-repo deploy) | Never push a small fix alone when other directory/relay changes are pending. Pipeline is 25-30 min. |
| **FROST TBS domain separation** | M7-WIRE-001 | Context string `"cello-frost-session-establishment-v1"` must be used; new fields in TBS extend the positional array. |
| **Cross-repo version bump** | M7-WIRE-001, M7-SESSION-001, M7-MANIFEST-002 | Stories that change cello-client packages require version-bump + trustless-cello dependency-update ACs. |
| **IaC-only resource creation** | M7-CICD-001 | Never create AWS resources manually that CloudFormation should manage. |
| **connectionGater per session node** | M7-DAEMON-002 | Each session node accepts connections from exactly one peer. The directory-facing node only accepts directory Peer IDs. |

---

## Cross-Repo Stories — Version Bump Triggers

The following stories modify cello-client packages and therefore **require** both
the `AC-version-bump` and `AC-trustless-cello-dependency-update` ACs defined in
`/cello-story`:

| Story | What changes in cello-client | What changes in trustless-cello |
|-------|------------------------------|-------------------------------|
| M7-DAEMON-001 | New `packages/daemon`, `packages/cli` | — |
| M7-MCP-001 | `packages/adapter-claude-code` rewrite | — |
| M7-DAEMON-002 | `packages/daemon` (session node manager) | — |
| M7-WIRE-001 | `packages/protocol-types`, `packages/client` | `packages/directory`, `packages/relay` |
| M7-TRANSPORT-001 | `packages/transport` (AutoNAT) | — |
| M7-SESSION-001 | `packages/client` (interrupted handling) | `packages/relay` (new frame type) |
| M7-SIGNAL-001 | `packages/transport` (signaling manager) | — |
| M7-DAEMON-003 | `packages/daemon`, `packages/client` | — |
| M7-MCP-002 | `packages/adapter-claude-code` | — |
| M7-MANIFEST-001 | `packages/crypto`, `packages/protocol-types` | — |
| M7-MANIFEST-002 | `packages/transport`, `packages/daemon` | `packages/directory` (signs challenge) |

**M7-WIRE-001, M7-SESSION-001, and M7-MANIFEST-002 touch both repos.** Their
version-bump ACs must include the trustless-cello dependency update and a push
triggering the directory/relay pipeline. Batch all three before pushing.

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
