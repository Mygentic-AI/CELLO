# CELLO — Shared Language

This file is the canonical glossary for CELLO. Use these terms exactly in code, docs, and conversation.

---

## Identity Hierarchy

CELLO has three tiers of identity. Every feature, story, and design decision that touches identity must be explicit about which tier it operates at.

```
Human Operator
      │
      ▼
+---------------------+
|       Account       |  ← verified via phone + email; one per human
+----------+----------+
           │ 1:N
  +--------+--------+--------+
  ▼                 ▼        ▼
Agent_A           Agent_B  Agent_N  ← each is a unique K_local + FROST ceremony
```

**Account** — the human operator's identity anchor. Created once during onboarding, verified via phone number and email address. One Account per human. The Account is the parent of all agents the operator runs. It backs:
- Portal login (magic link → WebAuthn/PIN)
- Trust signal aggregation (phone, email, LinkedIn, GitHub, and future signals attach here)
- Social recovery (M-of-N recovery contacts)
- Succession

Stored in `user_accounts`. The `phone_stub_hash` uniqueness constraint enforces one Account per phone number at the database layer.

**Agent** — a cryptographic entity owned by an Account. Defined by a unique `K_local` (Ed25519 operational signing key), a unique FROST DKG ceremony producing a unique `primary_pubkey`, and a unique `agent_profiles` row. Multiple agents per Account is supported from day one — a single human operator can run Agent_A on one machine and Agent_B on another. Each agent:
- Is cryptographically independent — compromising Agent_A does not leak Agent_B's keys
- Inherits the parent Account's verified trust signals (phone, email, social proofs) at the time of registration; those signals propagate to counterparties as an aggregate Account trust view
- Accumulates its own conversation history and endorsements
- Retains its Account link across K_local rotation — K_local rotation changes the operational key, not the Account membership

When a second Agent is added to an existing Account, re-verification of phone or email is not required — the Account identity is already proven. The directory issues a new pre-authorization token via the portal or bot's "add agent" flow and the new agent runs its own FROST DKG ceremony independently.

Counterparties receive an aggregate Account-level trust view when connecting: they see that the Agent belongs to an Account with N verified signals, without learning which specific agent contributed which signal (privacy-preserving aggregation).

**Session** — a single conversation between exactly two Agents. Has its own relay node assignment, Merkle tree, sequence numbering, and `session_id`. Multiple sessions can run concurrently on the same Agent. A Session is a protocol primitive — it does not map to an Account or span multiple Agents on either side.

---

## Core Concepts

**CELLO client** — the locally-running process co-located with the agent on the agent operator's hardware. Implements all protocol mechanics (signing, transport, Merkle, FROST) and exposes them as MCP tools. Not infrastructure — it is the agent operator's process.

**Protocol core** — the ~90–95% of the CELLO client that is agent-agnostic: cryptography, libp2p transport, Merkle tree operations, FROST ceremony participation, and all MCP tool logic.

**Agent adapter** — the thin agent-specific wrapper around the protocol core. Varies per agent runtime (Claude Code, IronClaw, Hermes, OpenClaw). Responsible for: (1) inbound notification — how the agent learns a message arrived; (2) outbound channel — how the agent initiates sends; (3) security surface differences (TBD).

**Claude Code adapter** — uses MCP JSON-RPC notifications via the `claude/channel` capability with `--channels` flag. Notification payloads are minimal wake-ups only — content never appears in a notification.

Inbound message (M0+): `{ "type": "cello_message", "from": "<peer_pubkey_hex>" }` — Claude Code calls `cello_receive` to retrieve content.

Inbound session request (M1+): `{ "type": "cello_session_request", "from": "<counterparty_pubkey_hex>", "session_id": "<hex>" }` — Claude Code calls `cello_await_session` to retrieve the session. Distinct `type` fields let the agent's system prompt handle message arrivals and session requests differently.

**Hermes adapter** — injects CELLO as an additional message channel alongside Telegram/WhatsApp, using Hermes's existing message-channel model.

**K_local** — the Agent's operational signing key. Defines Agent identity — one K_local per Agent. Used for per-message signing and participation in FROST ceremonies. Rotates on agent schedule, always at session boundaries. K_local rotation does not change Account membership — the Agent remains linked to the same Account after rotation. K_local MUST persist across restarts (see KeyProvider).

**identity_key** — the agent's long-term root key. Backs the pseudonym, the local DB key, and the backup key. Rarely rotated — rotation changes the pseudonym.

**K_server_X** — FROST threshold shares held by directory nodes. Neither the client nor any single directory node can produce a combined signature without the other. Used only at session establishment and conversation seal.

**KeyProvider** — the abstraction over the private key backend. `getPublicKey()` and `sign(data)`. Backend varies per deployment (OS Keychain, TPM, cloud secret manager, encrypted file). The private key never leaves the provider. `KeyProvider` is for CELLO envelope signing only — it is NOT wired into libp2p's Noise handshake. See ADR-0001. K_local must persist across restarts — it is the Agent's operational identity, tied to pseudonym, FROST ceremonies, and counterparty trust. Generating a fresh key on every restart would break the protocol. In M0, `InMemoryKeyProvider` loads from a key file on startup (generated once, stored at `~/.cello/key` or `CELLO_KEY_FILE` env var).

**Peer ID** — a libp2p transport identifier derived from a libp2p-managed keypair, not from K_local. Authenticates the transport connection (Noise handshake). K_local authenticates message content via envelope signatures. These are different keys serving different trust claims. See ADR-0001.

In M7+, Peer IDs operate at two distinct scopes:
- **Directory-facing node Peer ID** — changes on every reconnect to the directory. Only the directory ever sees this Peer ID. Never shared with counterparties.
- **Session node Peer ID** — fresh per session, generated when the session node is created, destroyed when the session node tears down. This is the Peer ID exchanged in the `SessionAssignment` and used for all session content exchange. After session close, the Peer ID is gone — any address a counterparty recorded leads nowhere.

Both scopes are ephemeral by design. The distinction matters for security: the directory-facing identity and the per-session identity are never the same node.

**CELLO identification exchange** — a minimal handshake that happens immediately after a libp2p connection is established on `/cello/m0/1.0.0`. The remote sends `{pubkey: <K_local hex>}` — self-reported, unverified at connect time. The first signed envelope exchange verifies it: if the signature matches the claimed pubkey, the pubkey is genuine. This is how `cello_connect_peer` returns `peer_pubkey` despite the Peer ID being separate from K_local.

**primary_pubkey** — the group public key produced by an agent's DKG ceremony with the directory cluster. Per-agent and public: each agent has a unique `primary_pubkey` derived from the directory nodes' K_server_X share commitments for that agent. Stored on the directory alongside the agent's profile; counterparties look it up to verify FROST signatures. The initiator of a session or seal coordinates the FROST ceremony using their own group (K_local + their K_server_X shares), and the resulting signature verifies only against the initiator's `primary_pubkey`. In M2, test harness wires `primary_pubkey` values directly; M3+ uses directory lookups.

**signer_pubkey** — a field carried in `SessionAssignment` and `SealNotarization` frames that identifies which agent's `primary_pubkey` the FROST signature verifies against. Always the session/seal initiator's `primary_pubkey`. Allows the counterparty to verify the FROST signature without a separate directory round-trip (the key is embedded in the frame).

**IThresholdSigner** — the abstraction over the multi-party threshold ceremony. `FrostThresholdSigner` is the day-one implementation. Exists as a day-one interface so threshold ML-DSA can swap in without changing the protocol layer. FROST implementation library: `@noble/curves` (`@noble/curves/frost`) — same audit lineage and pure-JS guarantee as the Ed25519 and SHA-256 primitives already in use. No other FROST library is used.

**FROST TBS (to-be-signed) arrays** — positional arrays signed via RFC 9591 FROST with a domain context string to prevent cross-ceremony confusion:
- Session establishment: context `"cello-frost-session-establishment-v1"`, fields `[session_id, agent_A_pubkey, agent_B_pubkey, genesis_prev_root, timestamp, initiator_session_peer_id, initiator_session_addrs_canonical, counterparty_session_peer_id, counterparty_session_addrs_canonical, transport_mode]` (10 fields; M7-WIRE-001 extended from 5). Canonical address encoding: `JSON.stringify(addrs.slice().sort())` — a JSON string as the CBOR element (fields 7 and 9). The context string is unchanged from the original 5-field version.
- Conversation seal: context `"cello-frost-seal-v1"`, fields `[session_id, sealed_root, leaf_count, timestamp]`

The domain context string is the cross-ceremony confusion guard — an establishment signature cannot be replayed as a seal signature and vice versa.

**pseudonym** — the stable, pseudonymous identity used in the conversation participation table. Derived from `identity_key`, stable across K_local rotations.

**session** — a single conversation between exactly two Agents. Has its own relay node assignment, Merkle tree, sequence numbering, and `session_id`. Multiple sessions can run concurrently on the same Agent. See the Identity Hierarchy section for how sessions relate to Accounts and Agents.

**session establishment (M1→M2)** — the directory issues a signed `SessionAssignment` carrying both peers' Peer IDs and multiaddrs. In M1 the directory signs with a single key; in M2 the initiating client coordinates a FROST ceremony and the directory embeds the combined signature with `signature_type: 'frost'` and `signer_pubkey`. The accept/decline step is stubbed through M2 — both agents are pre-authorized in the test harness. M3 replaces the stub with the full connection request flow. The `SessionAssignment` format does not change between M2 and M3.

**seal ceremony flow (M2)** — after the bilateral SEAL leaf exchange, the relay hands the leaf sequence to the directory. The directory verifies (recompute, signatures, causal chain) then pushes `seal_verified` to the seal initiator's signaling stream. The initiator coordinates a FROST ceremony and returns the signature via `seal_frost_signature`. The directory verifies, embeds in `SealNotarization`, and pushes `session_sealed` to both clients. The seal initiator is always the agent who called `cello_close_session`.

**seal-frost-timeout** — configurable timeout (default 15 seconds) after the bilateral SEAL exchange. If no `session_sealed` event arrives within this window, clients transition to `seal_deferred` with `seal_type: 'bilateral'`. The timeout detects directory unreachability without requiring an explicit failure signal from the relay.

**relay node** — the session-level Merkle engine. Receives signed hashes from the sender, assigns canonical sequence numbers, builds the per-conversation Merkle tree, delivers Structure 2 back. Sees only ephemeral Peer IDs and signed hashes — never content.

**directory node** — the bookend authority. Handles registration, session establishment signaling (signed SessionAssignment), FROST ceremony coordination, and conversation seal recomputation. Dormant during active sessions. Never sees message content.

**Structure 1** — the sender-signed Merkle leaf. TBS: `[protocol_version, content_hash, sender_pubkey, session_id, last_seen_seq, timestamp]`.

**Structure 2** — the relay-built Merkle leaf. Includes Structure 1 plus the relay-assigned canonical sequence number and `prev_root`.

**sealed root** — the final Merkle root produced by the bilateral seal. Both parties sign a SEAL control leaf committing to it; the directory independently recomputes it at seal.

**daemon** — the single long-running background process that is the CELLO client from M7 onward. Holds all agent identities, the directory-facing node, all active session nodes, and the local SQLite database. Started by `cello login`, stopped by `cello logout`. Multiple MCP client connections (from different Claude sessions) connect to it simultaneously via IPC. No process ever kills another — the lock file mechanism is connect-or-start, not kill-and-replace.

**directory-facing node** — the one libp2p node per daemon that maintains the persistent connection to the directory. Handles registration, FROST ceremonies, seal coordination, and connection negotiation. Its Peer ID changes on every reconnect; it is never shared with counterparties. Outlives any individual session — this is what allows session nodes to be created and destroyed without losing directory connectivity.

**ephemeral session node** — a libp2p node created for exactly one session. Fresh transport key, fresh Peer ID, generated during session negotiation. Torn down after seal + close. The session node's Peer ID is exchanged via the `SessionAssignment` and is the only identity the counterparty ever learns for that session. After teardown the address is permanently dead — DDoS defense and cross-session unlinkability are achieved at session granularity.

**standing receiver node** — one pre-created session node kept running at all times, ready to accept the next inbound session. When a connection is accepted, the standing node is handed to the new session. A replacement standing node is immediately spun up. Eliminates setup latency from the inbound path — the address is already known and relay-registered before any session request arrives.

**three agent states** — the M7 state model for agents within a daemon:
- **Registered** — identity exists in `~/.cello/agents/<name>/`, completed FROST, known to the network. Not currently online from this daemon.
- **Online** — live on the network from this daemon. Directory connection active, can receive session requests. Multiple agents can be online simultaneously.
- **Current** — the one online agent that this MCP connection's tool calls route to. Per-connection state — switching current in one connection does not affect other connections. One current agent per connection at a time.

**IPC** — the inter-process communication channel between MCP client connections and the daemon. Unix domain socket at `~/.cello/daemon.sock` on macOS/Linux; named pipe on Windows. Each MCP client (from a Claude session or other consumer) connects to the daemon via a thin stdio-to-socket proxy. From the MCP client's perspective it is a normal stdio MCP server.

**consortium manifest** — the TUF-aligned signed JSON document listing all current directory nodes and their public keys. Fields: `version` (monotonic integer), `not_before`, `expires`, `nodes` (array of node entries), and a threshold signature from t-of-n consortium root keys. The client enforces: version monotonicity (never accept a lower version than the last trusted), expiry (refuse to connect to any directory node when holding an expired manifest), and threshold signature validity. The daemon polls for a fresh manifest every 6–12 hours.

**consortium root keys** — N officer Ed25519 public keys embedded as constants in the client binary at build time. The trust anchor for the entire directory node authentication chain. Manifest validity requires a threshold signature from t-of-n of these keys (3-of-5 at Alpha). Rotation is in-band: a new manifest signed by the existing threshold adds a replacement key and removes the old one — no binary update required. Jurisdiction of key holders is a governance requirement: no two of the N officers may be subject to the same jurisdiction's compelled-disclosure law.

**AutoNAT** — a libp2p protocol that asks a set of known peers to attempt a dial-back to the client's advertised address. Answers the question "am I dialable from the outside?" A dialable node advertises direct multiaddrs in its `SessionAssignment`; a node behind NAT advertises a circuit relay address instead. Required for standing receiver nodes to know their own dialability from the moment they are created. Not currently in `createNode` — added in M7 S5.

**`directory_signaling` status** — the client-visible state of the signaling stream to the directory. Three values: `connected` (stream alive, operations proceeding normally), `reconnecting` (stream dropped, daemon is retrying with exponential backoff), `lost` (reconnection has failed beyond the retry budget — operator intervention required). Distinct from directory node reachability at the TCP level — the libp2p connection can be alive while the signaling stream is dead. Introduced in M7 S7 (signaling stream resilience).

**interrupted session** — a session that was active when the daemon stopped. On restart, session nodes are gone and cannot be resumed — the transport keys are destroyed. Interrupted sessions are marked with `interrupted` status in the local SQLite DB. Surfaced to the operator on `cello login` before any other operations. Both parties must agree to either seal whatever was exchanged or discard the session at next contact.

**walking skeleton** — M0. Two agents on two different machines exchange a tamper-evident signed message peer-to-peer over libp2p with no server in the middle. Cross-machine connectivity (DCuTR hole-punch or circuit relay fallback) is a M0 acceptance criterion, not deferred. Exercises the full transport, security, and signature substrate end-to-end.

**test relay** — a minimal libp2p node in `e2e-tests/` that does nothing but provide circuit relay v2. Used as the fallback relay for cross-machine tests when DCuTR hole-punching fails. Not a CELLO relay node — no Merkle, no sequencing, no protocol logic. Lives in `packages/e2e-tests/` as a test fixture.

**cross-machine test** — a `pnpm run test:cross-machine` script in `packages/e2e-tests/`. One machine runs as "server", the other as "client". Executed manually by the developer to verify TRANSPORT-001's cross-machine AC. Not in CI in M0 — automated two-machine CodeBuild execution is deferred. The script and its pass criteria are codified so the test is reproducible. `test_type: cross-machine` in story ACs references this script.

---

## Package Structure (monorepo, pnpm workspaces)

**npm scope: `@cello-protocol/`** — all packages publish as `@cello-protocol/package-name` (e.g. `@cello-protocol/client`, `@cello-protocol/crypto`, `@cello-protocol/connect`).

**Runtime: Node.js 24 LTS (Krypton).** TypeScript `target: ES2022`. All `package.json` files declare `"engines": { "node": ">=24" }`.

**CI/CD: AWS CodeBuild + CodePipeline, eu-west-1.** Same webhook chain as cello-agent: GitHub push → HMAC-validated Lambda → EventBridge → path-filter Lambda → per-package CodePipeline. Each package has its own `buildspec.yml` running `pnpm run typecheck && pnpm run test` for that package only. No Docker/ECR/ECS in M0 — deployment pipelines added when directory and relay nodes need to run (M1+). Path filter maps `packages/<name>/**` → `cello-<name>-pipeline`.

```
packages/
  protocol-types/   @cello-protocol/protocol-types  — wire types, TBS schemas, envelope definitions
  crypto/           @cello-protocol/crypto          — Ed25519 (KeyProvider), SHA-256, ML-DSA (M3+), FROST (M2+)
  transport/        @cello-protocol/transport       — libp2p node bootstrap, dial, stream handling
  client/           @cello-protocol/client          — protocol core (CelloClient); no MCP, no agent runtime
  adapter-claude-code/  @cello-protocol/connect             — MCP server, claude/channel notifications, stdio entrypoint; ships SKILL.md
  adapter-hermes/   @cello-protocol/adapter-hermes  — Hermes message channel integration; ships SKILL.md  (later milestone)
  adapter-ironclaw/ @cello-protocol/adapter-ironclaw — (later milestone)
  adapter-openclaw/ @cello-protocol/adapter-openclaw — (later milestone)
  directory/        @cello-protocol/directory       — directory node logic
  relay/            @cello-protocol/relay           — relay node logic
  e2e-tests/                               — in-process Vitest harness, real libp2p nodes
```

**Dependency rule:** `adapter-* → client → transport, crypto, protocol-types`. No adapter imports from `directory` or `relay`.

**Distribution:** each adapter is an npm package. Its `SKILL.md` is the installation skill for that agent runtime. The Claude Code adapter ships as `@cello-protocol/connect` (not `@cello-protocol/adapter-claude-code`) — the install one-liner is `claude mcp add cello npx @cello-protocol/connect`. Future adapters will follow the `@cello-protocol/adapter-<name>` convention. Operators building their own integration import `@cello-protocol/client` directly.

---

## CelloClient interface (adapter boundary)

`CelloClient` is defined in `packages/client/src/types.ts`. Adapters import this type directly — do not infer the interface from CONTEXT.md.

```typescript
interface CelloClient {
  /** Register a peer in the local registry. Called by cello_connect_peer after dial succeeds. */
  addPeer(peerPubkeyHex: string, peerId: string, multiaddrs: string[]): void;

  /** Send content to the peer identified by their K_local pubkey hex. Never throws. */
  send(peerPubkeyHex: string, content: Uint8Array): Promise<SendResult>;

  /** Register the inbound stream handler on the node. Call once after node.start(). */
  registerHandler(): Promise<void>;

  /** Dequeue the oldest received envelope from a given sender. Returns null if queue is empty. */
  receive(senderPubkeyHex: string): ReceivedEnvelope | null;

  /**
   * Return all queued envelopes (in arrival order) regardless of sender.
   * Non-destructive — items remain in the queue until receive() drains them.
   */
  peekAll(): Array<{ senderPubkeyHex: string; envelope: ReceivedEnvelope }>;
}

// SendResult is a discriminated union:
type SendResult =
  | { delivered: true; contentHash: string }
  | { delivered: false; reason: SendFailureReason };
```

`@cello-protocol/connect` (MCP-001) owns the receive queue, per-peer filtering, and timeout logic. `CelloClient` has no `onMessage` push model — `peekAll()` + `receive()` is the polling interface used by the adapter.

---

## Port assignments (M5+)

Canonical port numbers for CELLO services. These are the authoritative values for IaC security group rules.

| Port | Service | Protocol | Notes |
|------|---------|----------|-------|
| 443  | Directory node (agent-facing) | HTTPS/WebSocket | TLS termination at ALB; agents connect here |
| 4000 | Relay node health check | HTTP | Internal VPC only; never exposed via ALB; directory pings GET /health |
| 4001 | Directory inter-node checkpoint signing | libp2p/TCP | VPC Peering only; never exposed to internet; used for checkpoint round communication between directory nodes |
| 5432 | RDS PostgreSQL (logical replication) | TCP | VPC Peering only; never exposed to internet |

Security group rules on VPC Peering connections permit only ports 5432 and 4001 from peer VPC CIDR ranges.

---

## Error Code Glossary

Error codes are distinct string literals. Each code identifies exactly one failure cause and one originating component. Operators and calling LLMs can determine from the code alone what happened and where.

### Session Assignment Errors (M7-WIRE-001)

| Code | Origin | Meaning |
|------|--------|---------|
| `session_request_missing_peer_id` | directory | A session_request frame from the client omits `initiator_session_peer_id` or `initiator_session_addrs`. Indicates a pre-M7 client. |
| `assignment_missing_session_peer_id` | client | A received SessionAssignment is missing one or both session Peer ID fields (`initiator_session_peer_id`, `counterparty_session_peer_id`). May indicate a directory version mismatch. |
| `assignment_peer_id_mismatch` | client (initiator) | The initiator's self-check failed: `initiator_session_peer_id` in the FROST-signed assignment does not match the Peer ID of the session node the initiator created. Security anomaly — the directory may have substituted a different identity. |
| `assignment_tbs_verification_failed` | client | FROST signature verification over the 10-field session establishment TBS failed. The assignment may have been tampered with in transit. Distinct from `frost_verification_failed` (which applies to seal FROST operations only). |

---

## What "client never imports from directory or relay" means

The `client` package imports only from `protocol-types`, `crypto`, and `transport`. It reaches `directory` and `relay` exclusively over libp2p streams. The package boundary is real even when all packages are co-located in the same Vitest process.
