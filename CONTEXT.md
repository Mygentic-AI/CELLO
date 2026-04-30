# CELLO — Shared Language

This file is the canonical glossary for CELLO. Use these terms exactly in code, docs, and conversation.

---

## Core Concepts

**CELLO client** — the locally-running process co-located with the agent on the agent operator's hardware. Implements all protocol mechanics (signing, transport, Merkle, FROST) and exposes them as MCP tools. Not infrastructure — it is the agent operator's process.

**Protocol core** — the ~90–95% of the CELLO client that is agent-agnostic: cryptography, libp2p transport, Merkle tree operations, FROST ceremony participation, and all MCP tool logic.

**Agent adapter** — the thin agent-specific wrapper around the protocol core. Varies per agent runtime (Claude Code, IronClaw, Hermes, OpenClaw). Responsible for: (1) inbound notification — how the agent learns a message arrived; (2) outbound channel — how the agent initiates sends; (3) security surface differences (TBD).

**Claude Code adapter** — uses MCP JSON-RPC notifications via the `claude/channel` capability with `--channels` flag. When a libp2p inbound message arrives, the CELLO MCP server pushes a minimal wake-up notification ("you have a message from peer X") into the Claude Code session. Claude Code starts a new turn and calls `cello_receive` to retrieve the message. The push notification is the M0 delivery signal only — no directory, no connection requests, no session concept in M0. `cello_receive` remains the retrieval tool; channel notification is only the wake-up.

**Hermes adapter** — injects CELLO as an additional message channel alongside Telegram/WhatsApp, using Hermes's existing message-channel model.

**K_local** — the agent's operational signing key. Used for per-message signing and participation in FROST ceremonies. Rotates on agent schedule, always at session boundaries.

**identity_key** — the agent's long-term root key. Backs the pseudonym, the local DB key, and the backup key. Rarely rotated — rotation changes the pseudonym.

**K_server_X** — FROST threshold shares held by directory nodes. Neither the client nor any single directory node can produce a combined signature without the other. Used only at session establishment and conversation seal.

**KeyProvider** — the abstraction over the private key backend. `getPublicKey()` and `sign(data)`. Backend varies per deployment (OS Keychain, TPM, cloud secret manager, encrypted file). The private key never leaves the provider.

**IThresholdSigner** — the abstraction over the multi-party threshold ceremony. `FrostThresholdSigner` is the day-one implementation. Exists as a day-one interface so threshold ML-DSA can swap in without changing the protocol layer.

**pseudonym** — the stable, pseudonymous identity used in the conversation participation table. Derived from `identity_key`, stable across K_local rotations.

**session** — a single conversation between two agents. Has its own relay node assignment, Merkle tree, sequence numbering, and `session_id`. Multiple sessions can run concurrently on the same client.

**relay node** — the session-level Merkle engine. Receives signed hashes from the sender, assigns canonical sequence numbers, builds the per-conversation Merkle tree, delivers Structure 2 back. Sees only ephemeral Peer IDs and signed hashes — never content.

**directory node** — the bookend authority. Handles registration, session establishment signaling (signed SessionAssignment), FROST ceremony coordination, and conversation seal recomputation. Dormant during active sessions. Never sees message content.

**Structure 1** — the sender-signed Merkle leaf. TBS: `[protocol_version, content_hash, sender_pubkey, session_id, last_seen_seq, timestamp]`.

**Structure 2** — the relay-built Merkle leaf. Includes Structure 1 plus the relay-assigned canonical sequence number and `prev_root`.

**sealed root** — the final Merkle root produced by the bilateral seal. Both parties sign a SEAL control leaf committing to it; the directory independently recomputes it at seal.

**walking skeleton** — M0. Two agents exchange a tamper-evident signed message peer-to-peer over libp2p with no server in the middle. Exercises the full transport, security, and signature substrate end-to-end.

---

## Package Structure (monorepo, pnpm workspaces)

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

## What "client never imports from directory or relay" means

The `client` package imports only from `protocol-types`, `crypto`, and `transport`. It reaches `directory` and `relay` exclusively over libp2p streams. The package boundary is real even when all packages are co-located in the same Vitest process.
