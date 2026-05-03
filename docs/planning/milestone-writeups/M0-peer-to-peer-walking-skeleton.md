---
name: M0 — Peer-to-Peer Walking Skeleton
type: design
date: 2026-05-03
topics: [milestone, M0, transport, crypto, adapter-claude-code, e2e]
status: active
description: Post-completion write-up for M0. What was built, what was proved, what remains open.
---

# M0 — Peer-to-Peer Walking Skeleton

**Completed:** 2026-05-03  
**Sign-off log:** [[2026-05-03_1730_e2e-001-signoff]]

---

## What M0 Set Out to Prove

Two agents exchange a tamper-evident signed message peer-to-peer over libp2p with no server in the middle. Tamper any byte mid-flight and the receiver rejects it. The full transport, security, and signature substrate is exercised end-to-end.

---

## What Was Built

### Packages shipped

| Package | What it does |
|---|---|
| `@cello/crypto` | Ed25519 key generation, signing, verification; SHA-256 with domain separation (msg-leaf, node, ctrl-leaf); `FileKeyProvider` with atomic write and 0o600 permissions; `InMemoryKeyProvider` |
| `@cello/protocol-types` | CBOR envelope v0 (positional TBS); `buildEnvelope`, `serializeEnvelope`, `deserializeEnvelope`, `validateEnvelope`; content hash recomputation + signature verification on receive |
| `@cello/transport` | libp2p node bootstrap: TCP + WebSocket, Noise-only encryption (no plaintext), Yamux; circuit relay v2 (HOP + transport); DCuTR; identify; `createNode` / `start` / `stop` / `dial` / `handle` / `newStream` |
| `@cello/client` | Peer registry; FIFO per-sender receive queues; `send` (build → serialize → stream) / `receive` / `peekAll` / `sendRaw` (test escape); `onMessageQueued` callback |
| `@cello/adapter-claude-code` | MCP tool surface: `cello_connect_peer`, `cello_send`, `cello_receive`, `cello_list_peers`, `cello_status`; `claude/channel` experimental capability; `notifications/claude/channel` push; `cello-mcp` stdio binary; `FileKeyProvider` startup; `CELLO_KEY_FILE` / `CELLO_LISTEN_ADDR` env vars |
| `@cello/relay` | Circuit-relay-v2-only libp2p node; persisted transport keypair (`privateKeyToProtobuf`) for stable PeerID across restarts; `cello-relay` CLI binary |
| `@cello/e2e-tests` | In-process harness (real TCP, real Noise, real crypto); 140 tests across all packages; cross-machine vitest config; E2E-001 same-machine proxy tests |

### Test counts at M0 close
- **140 tests passing, 2 skipped** (cross-machine skips require `CELLO_RELAY_MULTIADDR`)
- Zero lint errors, zero TypeScript errors

---

## What Was Proved

### In automated tests
- Envelope signing and verification: a tampered byte (content, signature, or hash) is caught at `validateEnvelope`
- Noise-only transport: two nodes connect, no plaintext in stream protocols
- `cello_receive` never surfaces an envelope that failed MSG-002 validation
- No private key material in any MCP tool response
- `notifications/claude/channel` fires on the MCP wire with `{ type: "cello_message", from: <pubkey> }` — no content field
- `FileKeyProvider` persists the signing key: same pubkey on reload, 0o600 permissions, atomic write
- `loadOrGenerateRelayKey` persists the relay transport keypair: stable PeerID across restarts

### In live Claude Code sign-off (2026-05-03)
- Two real Claude Code agents connected over loopback TCP
- Agent A sent a message; Agent B received it with matching `sender_pubkey` and `content_hash`
- Full A→B→A round-trip exchange
- Both `cello_status` calls showed `connected_peer_count: 1`; pubkeys cross-matched
- Agents conducted a 13-turn autonomous conversation without human intervention in the message path
- Key persistence verified: Agent B's key survived a process restart mid-session

---

## What Remains Open

### AC-001 and AC-008 — Real network boundary
**Status:** Deferred — single machine available during sign-off  
**What's missing:** Connection traversing a real NAT; DCuTR hole-punch or circuit relay fallback demonstrated on real networks  
**Resolution:** Re-run with an EC2 instance or second physical machine. The relay package is ready to deploy. Closes before Alpha.

### AC-003 — Auto-wake via `--channels`
**Status:** Deferred — `--channels` not available on AWS Bedrock  
**What's missing:** Claude Code starting a new turn automatically on receipt of `notifications/claude/channel`  
**What's proven:** `cello-mcp` fires the notification correctly; the MCP wire payload is correct; the adapter code is tested  
**Resolution:** Retest when `--channels` becomes available on Bedrock, or when operator switches to direct Anthropic API billing.  
**Workaround used:** Manual `cello_receive` polling loop (30s timeout). Functionally equivalent at the protocol level; lacks the automatic-new-turn UX.

---

## Key Design Decisions Made During M0

- **ADR-0001:** Transport Peer ID key is intentionally separate from K_local signing key. libp2p generates a fresh Ed25519 keypair for the Noise handshake; `KeyProvider` is never passed into libp2p internals.
- **`peekAll()` is non-destructive:** The arrival log never shrinks. `receive()` dequeues from per-sender FIFO. This separation enables filtered receive without losing messages.
- **`cello_connect_peer` required in both directions:** Inbound connections do not auto-register peers for sending. Both agents must dial each other to establish bidirectional send capability.
- **`notifications/claude/channel` fires notification-only:** No message content in the notification. The agent must call `cello_receive` to get the content. This is the SI-001 invariant.
- **Late-bound `mcpServer` reference in `cello-mcp.ts`:** Solves the chicken-and-egg between `createClient` (needs server for notification callback) and `createMcpServer` (needs client). Client created first with closure over `let mcpServer`, server assigned synchronously before any messages can arrive.

---

## What M1 Builds On

M0 proved the transport substrate. M1 adds the directory and relay nodes, Merkle notarization, and the hash-relay model where content flows peer-to-peer and hashes flow to the relay. The conversation is still two-party; what changes is that it becomes verifiable after the fact — a sealed session produces a 32-byte receipt, and any party can prove inclusion of any message.

## Related Documents
- [[CELLO-E2E-001]] — sign-off story spec
- [[2026-05-03_1730_e2e-001-signoff]] — sign-off log
- [[agent-conversation-transcript]] — first live agent-to-agent conversation
- [[implementation-roadmap]] — full milestone map
- [[CONTEXT]] — canonical glossary
