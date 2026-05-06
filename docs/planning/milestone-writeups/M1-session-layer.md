---
name: M1 — Session Layer
type: design
date: 2026-05-06
topics: [milestone, M1, relay, directory, merkle, session, seal, mcp]
status: active
description: Post-completion write-up for M1. What was built, what was proved, what remains open.
---

# M1 — Session Layer

**Completed:** 2026-05-06  
**Stories:** MERKLE-001, MERKLE-002, MSG-003, MSG-004, NODE-002, SESSION-002, NODE-001, SESSION-003, MCP-002, ADAPTER-002

---

## What M1 Set Out to Prove

A session between two agents is cryptographically verifiable after the fact. Every message is committed to a Merkle tree that neither agent controls. When the session ends, the relay hands the tree to the directory, which notarizes it with a signed sealed root. Either agent can produce an inclusion proof for any message — verifiable against the root, independent of the other party, without trusting the directory to tell the truth.

The relay never sees message content. The directory never sees message content. The session receipt is 32 bytes.

---

## What Was Built

### Packages shipped

| Package | What it adds in M1 |
|---|---|
| `@cello/crypto` | `buildMerkleTree`, `merkleRoot`, `inclusionProof`, `verifyInclusion` (RFC 6962); `computeGenesisPrevRoot` |
| `@cello/protocol-types` | Structure 1 (sender-signed: content hash, session_id, sequence fields); Structure 2 (relay-built: adds prev_root, relay signature, relay sequence); CBOR codecs for both; `buildStructure1`, `encodeStructure2`, `validateStructure2Signature`; `computeGenesisPrevRoot`; `encodeSealPayload` / `decodeSealPayload` |
| `@cello/relay` | `CelloRelayNode`: accepts Structure 1 on `/cello/relay/1.0.0`; assigns canonical sequence numbers; computes `prev_root` from the running Merkle tree; constructs Structure 2; delivers to counterparty; relay auth challenge-response (Ed25519 over nonce + pubkey); `relay_auth_ok` confirms auth before any leaf delivery; leaf delivery queue for reconnecting clients; in-process `InMemoryRelayStore` |
| `@cello/directory` | `CelloDirectoryNode`: persistent signaling stream on `/cello/signaling/1.0.0`; challenge-response auth; `session_request` processing; `SessionAssignment` issuance (directory-signed, CBOR TBS); bilateral seal verification; `session_sealed` / `session_seal_rejected` delivery; reconnect delivery queue (`DB-002`) |
| `@cello/client` | `receiveSessionAssignment` (full flow: dir sig verify, genesis root compute, relay auth, content dial); `sendMessage` / `receiveMessage` (session-keyed); `initiateSessionSeal`; `listSessions`; `onSessionAssignment` callback; `SessionRecord` with Merkle leaf log; `createMcpSessionServer` (9 M1 tools) |
| `@cello/adapter-claude-code` | Replaces M0 tool set with M1 session tools; `cello_initiate_session` polls for directory assignment; `cello_await_session` with event-driven resolver (CRITICAL-2 stale-resolver fix); `cello_session_request` MCP notification (SI-001: exactly `{type, from, session_id}`) |
| `@cello/e2e-tests` | `mcp-002.test.ts`: 6 e2e tests using real directory + relay + two libp2p nodes; AC-001 verifies `genesis_prev_root` is byte-identical across A and B (SESSION-002 AC-002); M0 e2e tests retired to `describe.skip` |

### Test counts at M1 close
- **358 tests passing, 20 skipped** (retired M0 tests), **5 todo** (explicitly deferred transport-recovery items)
- Zero lint errors, zero TypeScript errors
- 10 stories, 7 packages

---

## What Was Proved

### In automated tests

**Merkle tree**
- RFC 6962 build, root, inclusion proof, and verification: 7-leaf mixed tree with external cross-implementation vector from a separate implementation
- `genesis_prev_root` is deterministic: same inputs always produce the same 32-byte root, verified with pinned test vectors

**Message flow (Structure 1 / Structure 2)**
- Structure 1 signing: session_id, last_seen_seq, content hash, Ed25519 signature
- Structure 2 construction: relay adds prev_root, relay signature, global sequence number
- Causal-chain check: incoming `last_seen_seq` must not exceed own `last_sent_seq`; violation → `session_desynchronized`
- Tampered Structure 2 sender signature → B desynchronizes
- Tampered content frame hash → B desynchronizes
- Replay attack (duplicate sequence number) → rejected
- Content never reaches the relay: no `content_deliver` frame exists; no protocol path exists

**Session establishment (SESSION-002)**
- Directory issues signed `SessionAssignment`; both clients independently verify the directory signature before proceeding
- Relay records assignment before any `session_assignment` frame is delivered to clients (ordering verified by call-order counter, not wall-clock)
- Relay and client both compute identical `genesis_prev_root` from the same deterministic pure function
- Directory discards relay session if either client stream closes before assignment delivered; provisional sessions are cleaned up

**Seal ceremony (SESSION-003)**
- A calls `initiateSessionSeal`; B auto-responds; both sessions transition to `sealing`
- Directory receives SEAL leaves from relay, verifies each Structure 1 signature, recomputes Merkle root, signs `SealNotarization`
- Both clients receive `session_sealed`; `sealed_root` is byte-identical on A and B
- Directory signature over `SealNotarization` verifies with the directory's public key
- Further sends after `sealed` → `session_sealed` error
- Tampered `directory_signature` on `session_sealed` → client rejects, stays in `sealing`

**MCP tool surface (MCP-002 / ADAPTER-002)**
- `cello_initiate_session` polls `listSessions()` until a session with the target pubkey appears; returns `{session_id, counterparty_pubkey, relay_endpoint, genesis_prev_root}`
- `genesis_prev_root` from A's `cello_initiate_session` equals `genesis_prev_root` from B's `cello_await_session` (cross-asserted in e2e AC-001 test)
- `cello_await_session` event-driven: fires immediately when an assignment is queued; stale-resolver bug fixed (timeout=0 no longer swallows the next event)
- `cello_send` returns `leaf_hash` (SHA-256 of `kind_byte || s2_cbor`) after relay echo confirms the leaf
- `cello_receive` returns `{type, content, sender_pubkey, sequence_number, leaf_hash}`
- `cello_list_sessions` returns `leaf_count` (live count of confirmed leaves)
- `cello_session_request` MCP notification carries exactly `{type, from, session_id}` — no genesis root, no multiaddrs, no content (SI-001)
- Null-client guard on all session tools: `client_not_initialized` error instead of crash

---

## What Remains Open

### Transport recovery (relay reconnect)
**Status:** Explicitly deferred — marked `it.todo`  
**What's missing:** Client-side relay reconnect after stream drop; relay queuing pending `leaf_deliver` during client reconnect; relay rejection handling during recovery  
**Why deferred:** The relay's delivery queue is implemented and tested at the relay layer (DB-001 passes); the client-side reconnect flow requires a dedicated story  
**Resolution:** DB-001 / DB-002 client stories. Must close before Beta.

### prev_root causal check on receive
**Status:** Explicitly deferred — marked `it.todo`  
**What's missing:** Client rejects a Structure 2 where the relay-supplied `prev_root` doesn't match the locally computed value  
**Why deferred:** The relay is authoritative on `prev_root` in M1; the client verifies relay signatures but trusts the relay's tree state. Full client-side tree reconstruction is a M2 hardening item.  
**Resolution:** Client-side Merkle reconstruction story.

### Cross-machine e2e
**Status:** Deferred from M0, still deferred  
**What's missing:** Session establishment and message delivery traversing a real NAT  
**Resolution:** Same as M0: re-run with two physical machines or cloud instances. All relay, directory, and client code is ready.

### `cello_initiate_session` directory signaling stream
**Status:** Stubbed — polls `listSessions()` instead of sending a `session_request` to the directory  
**What's missing:** The MCP tool sending an explicit `session_request` frame to the directory's `/cello/signaling/1.0.0` stream; the full NODE-001 initiator flow from the MCP layer  
**Why deferred:** In M1, `cello_initiate_session` is driven by the test harness delivering the assignment directly via `receiveSessionAssignment`. The directory signaling path is exercised in NODE-001 unit tests but not wired to the MCP surface.  
**Resolution:** Requires the adapter to hold a persistent directory signaling stream. M2 story.

---

## Key Design Decisions Made During M1

- **Hash relay, not message relay.** The relay sees Structure 1 (content hash, not content) and builds Structure 2. Content flows peer-to-peer on `/cello/content/1.0.0`. This is not a performance optimization — it is an architectural invariant. There is no frame type that would carry content to the relay.

- **`genesis_prev_root` is a pure function of public inputs.** `SHA-256(min(pubA,pubB) || max(pubA,pubB) || session_id || timestamp_be8)`. Both clients and the relay compute it independently from the same assignment data. No one issues it; it cannot be faked without forging the directory signature over the assignment.

- **Relay auth challenge-response before any leaf delivery.** The relay sends `relay_auth_challenge` on stream open; the client signs `SHA-256("CELLO-RELAY-AUTH-v1" || nonce || pubkey)`; the relay sends `relay_auth_ok` before flushing any queued deliveries. This eliminates the window where a client could receive leaves before auth completes.

- **`onSessionAssignment` is last-writer-wins.** `CelloClient.onSessionAssignment` replaces the prior handler. One `McpSessionServer` per client instance; creating two would silently drop session events from the first. Documented as an invariant comment in `createMcpSessionServer`.

- **Stale-resolver fix in `cello_await_session`.** The resolver is pushed into `sessionEventResolvers` *before* the timer is started, not after. If `timeout_ms=0`, the timer fires on the next tick — but the resolver is already registered, so the next real event reaches it. The original code pushed the resolver after starting the timer, leaving a window where a zero-timeout call would register a stale resolver that would swallow the subsequent event.

- **`leaf_hash` from the last local tree leaf, not a full tree rebuild.** After `sendMessage` returns, the leaf is already in `local_tree_leaves`. `SHA-256(kind_byte || s2_cbor)` is computed directly from that entry. No full-tree rebuild on every send.

- **`close_timestamp` from the sealed record, not `Date.now()`.** `cello_close_session` returns the `close_timestamp` that the directory signed into the `SealNotarization`. Using `Date.now()` would produce a value that cannot be verified against the directory signature. Fixed during code review (HIGH-2).

- **SI-003: inclusion proof root must equal directory-sealed root.** `cello_get_inclusion_proof` rebuilds the local Merkle tree and checks that `merkleRoot(tree)` matches `record.sealed_root` before returning the proof. A mismatch means the local leaf log diverged from what the directory sealed — returns `local_tree_inconsistent` error.

---

## What M2 Builds On

M1 proved that sessions are notarizable. M2 adds trust signal exchange within sessions — agents carrying signed attestations about their counterparty, FROST-split signing for split-key receipts, and the directory's trust data layer (hashes only, never content). The session model is complete; what changes is what agents do with it.

---

## Related Documents
- [[CELLO-MCP-002]] — session-aware MCP surface story
- [[CELLO-SESSION-003]] — bilateral seal story
- [[CELLO-NODE-001]] — directory node story
- [[CONTEXT]] — canonical glossary
- [[implementation-roadmap]] — full milestone map
- [[M0-peer-to-peer-walking-skeleton]] — M0 write-up
