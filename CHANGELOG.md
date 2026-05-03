# Changelog

All notable changes to CELLO will be documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased]

---

## [M0] — 2026-05-03 — Peer-to-Peer Walking Skeleton

Two agents exchange tamper-evident signed messages peer-to-peer over libp2p with no server in the middle. Tamper any byte mid-flight and the receiver rejects it.

### Added

- **`@cello/crypto`** — Ed25519 keypair generation, signing, and verification; SHA-256 with domain separation (msg-leaf, node, ctrl-leaf); `FileKeyProvider` with atomic write and 0o600 permissions; `InMemoryKeyProvider`
- **`@cello/protocol-types`** — CBOR envelope v0 (positional TBS); `buildEnvelope`, `serializeEnvelope`, `deserializeEnvelope`, `validateEnvelope`; content hash recomputation and signature verification on receive
- **`@cello/transport`** — libp2p node bootstrap: TCP + WebSocket, Noise-only encryption, Yamux; circuit relay v2 (HOP + transport); DCuTR; identify; `createNode` / `start` / `stop` / `dial` / `handle` / `newStream`
- **`@cello/client`** — Peer registry; FIFO per-sender receive queues; `send` / `receive` / `peekAll` / `sendRaw`; `onMessageQueued` callback
- **`@cello/adapter-claude-code`** — MCP tool surface: `cello_connect_peer`, `cello_send`, `cello_receive`, `cello_list_peers`, `cello_status`; `notifications/claude/channel` push; `cello-mcp` stdio binary; `FileKeyProvider` startup; `CELLO_KEY_FILE` / `CELLO_LISTEN_ADDR` env vars
- **`@cello/relay`** — Circuit-relay-v2-only libp2p node; persisted transport keypair for stable PeerID across restarts; `cello-relay` CLI binary
- **`@cello/e2e-tests`** — In-process harness (real TCP, real Noise, real crypto); 140 tests across all packages; E2E-001 same-machine proxy tests
- **`/cello-chat` slash command** — Guides an agent through the full CELLO peer-to-peer conversation setup and listen-reply loop
- Initial architecture and design documentation
- Prompt injection defense 6-layer architecture spec
- Agent registry and trust chain design
- Split-key signing model (FROST)

### Proved

- Tamper any byte (content, signature, or hash) — caught at `validateEnvelope`, message dropped silently
- Noise-only transport — no plaintext in stream protocols
- `notifications/claude/channel` fires with `{ type: "cello_message", from: <pubkey> }` — no content field
- `FileKeyProvider` persists the signing key: same pubkey on reload, 0o600 permissions, atomic write
- Two real Claude Code agents conducted a 13-turn autonomous conversation without human intervention in the message path

### Deferred

- **AC-001 / AC-008** — Real NAT boundary traversal; requires two machines on different networks. Resolution: re-run with EC2 or second physical machine before Alpha.
- **AC-003** — Auto-wake via `--channels`; gated behind Anthropic direct billing, not available on AWS Bedrock. Workaround: `cello_receive` polling loop (30s timeout). Resolution: retest when `--channels` becomes available on Bedrock.

---
