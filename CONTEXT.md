# CELLO — Shared Language

This file is the canonical glossary for CELLO. Use these terms exactly in code, docs, and conversation.

---

## Core Concepts

**CELLO client** — the locally-running process co-located with the agent on the agent operator's hardware. Implements all protocol mechanics (signing, transport, Merkle, FROST) and exposes them as MCP tools. Not infrastructure — it is the agent operator's process.

**Protocol core** — the ~90–95% of the CELLO client that is agent-agnostic: cryptography, libp2p transport, Merkle tree operations, FROST ceremony participation, and all MCP tool logic.

**Agent adapter** — the thin agent-specific wrapper around the protocol core. Varies per agent runtime (Claude Code, IronClaw, Hermes, OpenClaw). Responsible for: (1) inbound notification — how the agent learns a message arrived; (2) outbound channel — how the agent initiates sends; (3) security surface differences (TBD).

**Claude Code adapter** — uses MCP JSON-RPC notifications via the `claude/channel` capability with `--channels` flag. When a libp2p inbound message arrives, the CELLO MCP server pushes a minimal wake-up notification `{ type: 'cello_message', from: <peer_pubkey hex> }` into the Claude Code session. Claude Code starts a new turn and calls `cello_receive` to retrieve the content. The notification never carries message content — content always flows through `cello_receive` so signature verification and content validation are never bypassed.

**Hermes adapter** — injects CELLO as an additional message channel alongside Telegram/WhatsApp, using Hermes's existing message-channel model.

**K_local** — the agent's operational signing key. Used for per-message signing and participation in FROST ceremonies. Rotates on agent schedule, always at session boundaries.

**identity_key** — the agent's long-term root key. Backs the pseudonym, the local DB key, and the backup key. Rarely rotated — rotation changes the pseudonym.

**K_server_X** — FROST threshold shares held by directory nodes. Neither the client nor any single directory node can produce a combined signature without the other. Used only at session establishment and conversation seal.

**KeyProvider** — the abstraction over the private key backend. `getPublicKey()` and `sign(data)`. Backend varies per deployment (OS Keychain, TPM, cloud secret manager, encrypted file). The private key never leaves the provider. `KeyProvider` is for CELLO envelope signing only — it is NOT wired into libp2p's Noise handshake. See ADR-0001. K_local MUST persist across restarts — it is the agent's operational identity, tied to pseudonym, FROST ceremonies, and counterparty trust. In M0, `InMemoryKeyProvider` loads from a key file on startup (generated once, stored at `~/.cello/key` or `CELLO_KEY_FILE` env var). Generating a fresh key on every restart would break the protocol.

**Peer ID** — a libp2p transport identifier derived from a libp2p-managed keypair, not from K_local. Authenticates the transport connection (Noise handshake). In M1+, Peer IDs are ephemeral — fresh per session. K_local authenticates message content via envelope signatures. These are different keys serving different trust claims. See ADR-0001.

**CELLO identification exchange** — a minimal handshake that happens immediately after a libp2p connection is established on `/cello/m0/1.0.0`. The remote sends `{pubkey: <K_local hex>}` — self-reported, unverified at connect time. The first signed envelope exchange verifies it: if the signature matches the claimed pubkey, the pubkey is genuine. This is how `cello_connect_peer` returns `peer_pubkey` despite the Peer ID being separate from K_local.

**IThresholdSigner** — the abstraction over the multi-party threshold ceremony. `FrostThresholdSigner` is the day-one implementation. Exists as a day-one interface so threshold ML-DSA can swap in without changing the protocol layer.

**pseudonym** — the stable, pseudonymous identity used in the conversation participation table. Derived from `identity_key`, stable across K_local rotations.

**session** — a single conversation between two agents. Has its own relay node assignment, Merkle tree, sequence numbering, and `session_id`. Multiple sessions can run concurrently on the same client.

**session establishment (M1)** — the directory issues a signed `SessionAssignment` carrying both peers' Peer IDs and multiaddrs. In M1 the accept/decline step is stubbed — both agents are pre-authorized in the test harness and the directory issues the `SessionAssignment` directly. M3 replaces the stub with the full connection request flow (Alice requests → Bob notified → Bob accepts/declines). The `SessionAssignment` format does not change between M1 and M3.

**relay node** — the session-level Merkle engine. Receives signed hashes from the sender, assigns canonical sequence numbers, builds the per-conversation Merkle tree, delivers Structure 2 back. Sees only ephemeral Peer IDs and signed hashes — never content.

**directory node** — the bookend authority. Handles registration, session establishment signaling (signed SessionAssignment), FROST ceremony coordination, and conversation seal recomputation. Dormant during active sessions. Never sees message content.

**Structure 1** — the sender-signed Merkle leaf. TBS: `[protocol_version, content_hash, sender_pubkey, session_id, last_seen_seq, timestamp]`.

**Structure 2** — the relay-built Merkle leaf. Includes Structure 1 plus the relay-assigned canonical sequence number and `prev_root`.

**sealed root** — the final Merkle root produced by the bilateral seal. Both parties sign a SEAL control leaf committing to it; the directory independently recomputes it at seal.

**walking skeleton** — M0. Two agents on two different machines exchange a tamper-evident signed message peer-to-peer over libp2p with no server in the middle. Cross-machine connectivity (DCuTR hole-punch or circuit relay fallback) is a M0 acceptance criterion, not deferred. Exercises the full transport, security, and signature substrate end-to-end.

**test relay** — a minimal libp2p node in `e2e-tests/` that does nothing but provide circuit relay v2. Used as the fallback relay for cross-machine tests when DCuTR hole-punching fails. Not a CELLO relay node — no Merkle, no sequencing, no protocol logic. Lives in `packages/e2e-tests/` as a test fixture.

**cross-machine test** — a `pnpm run test:cross-machine` script in `packages/e2e-tests/`. One machine runs as "server", the other as "client". Executed manually by the developer to verify TRANSPORT-001's cross-machine AC. Not in CI in M0 — automated two-machine CodeBuild execution is deferred. The script and its pass criteria are codified so the test is reproducible. `test_type: cross-machine` in story ACs references this script.

---

## Package Structure (monorepo, pnpm workspaces)

**npm scope: `@cello/`** — all packages publish as `@cello/package-name` (e.g. `@cello/client`, `@cello/crypto`, `@cello/adapter-claude-code`).

**Runtime: Node.js 22 LTS.** TypeScript `target: ES2022`. All `package.json` files declare `"engines": { "node": ">=22" }`.

**CI/CD: AWS CodeBuild + CodePipeline, eu-west-1.** Same webhook chain as cello-agent: GitHub push → HMAC-validated Lambda → EventBridge → path-filter Lambda → per-package CodePipeline. Each package has its own `buildspec.yml` running `pnpm run typecheck && pnpm run test` for that package only. No Docker/ECR/ECS in M0 — deployment pipelines added when directory and relay nodes need to run (M1+). Path filter maps `packages/<name>/**` → `cello-<name>-pipeline`.

```
packages/
  protocol-types/   @cello/protocol-types  — wire types, TBS schemas, envelope definitions
  crypto/           @cello/crypto          — Ed25519 (KeyProvider), SHA-256, ML-DSA (M3+), FROST (M2+)
  transport/        @cello/transport       — libp2p node bootstrap, dial, stream handling
  client/           @cello/client          — protocol core (CelloClient); no MCP, no agent runtime
  adapter-claude-code/  @cello/adapter-claude-code  — MCP server, claude/channel notifications, stdio entrypoint; ships SKILL.md
  adapter-hermes/   @cello/adapter-hermes  — Hermes message channel integration; ships SKILL.md  (later milestone)
  adapter-ironclaw/ @cello/adapter-ironclaw — (later milestone)
  adapter-openclaw/ @cello/adapter-openclaw — (later milestone)
  directory/        @cello/directory       — directory node logic
  relay/            @cello/relay           — relay node logic
  e2e-tests/                               — in-process Vitest harness, real libp2p nodes
```

**Dependency rule:** `adapter-* → client → transport, crypto, protocol-types`. No adapter imports from `directory` or `relay`.

**Distribution:** each adapter is an npm package. Its `SKILL.md` is the installation skill for that agent runtime — the one-liner is `npm install @cello/adapter-<name>`, then follow the skill. The skill knows how to wire up that specific agent. Operators building their own integration import `@cello/client` directly.

---

## CelloClient interface (adapter boundary)

`CelloClient` in `packages/client` exposes a push-only event model. It fires events; adapters decide what to do with them. The receive queue, per-peer filtering, and timeout logic live in the adapter, not in `CelloClient`.

```typescript
interface CelloClient {
  start(): Promise<void>
  stop(): Promise<void>
  getOwnPublicKey(): Promise<string>           // lowercase hex, no 0x prefix
  getListenAddresses(): string[]               // multiaddrs
  connectPeer(multiaddr: string): Promise<{ peerId: string, peerPubkey: string }>  // peerPubkey from CELLO identification exchange
  send(peerPubkey: string, content: Uint8Array): Promise<{ contentHash: string }>
  listPeers(): Peer[]
  onMessage(handler: (msg: InboundMessage) => void): void  // push only — no receive() on CelloClient
}
```

`adapter-claude-code` registers an `onMessage` handler at startup. When a message arrives: (1) the adapter enqueues it in its own receive queue, (2) pushes a `claude/channel` notification to wake Claude Code. `cello_receive` drains the adapter's queue with per-peer filtering.

---

## What "client never imports from directory or relay" means

The `client` package imports only from `protocol-types`, `crypto`, and `transport`. It reaches `directory` and `relay` exclusively over libp2p streams. The package boundary is real even when all packages are co-located in the same Vitest process.
