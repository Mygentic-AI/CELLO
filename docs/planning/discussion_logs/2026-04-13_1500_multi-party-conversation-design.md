---
name: Multi-Party Conversation Design
type: discussion
date: 2026-04-13 15:00
topics: [merkle-tree, group-conversations, ordering, concurrency, transport, libp2p, GossipSub, relay, seal, attestation, batching, LLM, client-architecture, MOLT-Book, chat-rooms, discovery, WebSocket, fan-out, causal-acknowledgment]
description: Design of multi-party (N>2) conversation support — the concurrent message ordering problem, authorship vs ordering separation, serialized and concurrent operating modes, client-side receive windows for LLM agent participation, transport topology for group message delivery, and schema changes from two-party assumptions to N-party.
---

# Multi-Party Conversation Design

## The problem

The CELLO protocol was designed around two-party conversations. The Merkle tree, the seal schema, the transport architecture, and the client interaction model all assume exactly two participants. The discovery system design introduced Class 3 group conversations (chat rooms) with N participants. Several foundational assumptions break at N > 2.

This session identifies every breaking point and designs the multi-party extensions.

---

## 1. The concurrent message problem

### Why two-party ordering works

In a two-party conversation, messages naturally serialize. A sends, B responds, A responds. Each message can include `prev_root` in the signature because there's only one possible prev_root — the state after the other party's last message. The conversation is a tennis match.

### Why it breaks at N > 2

With three participants (A, B, C), after A sends a message:

```
t=0ms:    A sends message (directory assigns seq 5)
t=200ms:  B responds to A (composes with prev_root after seq 5)
t=400ms:  C responds to A (composes with prev_root after seq 5)
```

B's response arrives at the directory first and gets seq 6. C's response arrives second and gets seq 7. But C signed their message with `prev_root` based on the state after seq 5 — the canonical tree now has B's message (seq 6) between seq 5 and C's message. C's `prev_root` is valid for the state C saw, but invalid for the canonical tree that includes B's message.

C did nothing wrong. C signed honestly against the state they observed. But the canonical state diverged from C's local state because B's message was sequenced in between. The more participants, the worse this gets — with 15 agents in a chat room, almost every message has this problem.

The current leaf format from end-to-end-flow §6.2:

```
leaf = SHA-256(
  0x00               ← leaf marker
  sender_pubkey
  sequence_number    ← directory-assigned
  message_content
  prev_root          ← previous Merkle root
)
```

The `prev_root` is the breaking point. In multi-party, the sender cannot know the canonical `prev_root` at signing time because other messages may be in flight.

---

## 2. Authorship vs. ordering separation

Two distinct things are conflated in the current leaf format:

1. **"I said this"** — authorship, non-repudiation. The sender's responsibility.
2. **"This was said in this order"** — sequencing, tree construction. The directory's responsibility.

In two-party conversations this conflation is harmless because the ordering is natural. In multi-party it is fatal. The fix: separate them.

### What the sender signs (authorship proof)

```
sender_signature = sign(
  message_content_hash  ||
  sender_pubkey         ||
  conversation_id       ||
  last_seen_seq         ||    ← highest sequence number received at composition time
  sender_timestamp         ← sender's local clock, not canonical
)
```

This proves: "I am B, and I said X in this conversation, having seen through message N, at approximately this time." It does NOT prove anything about canonical ordering relative to other participants. The sender cannot make claims about ordering they can't know.

### What the directory builds (canonical tree)

```
leaf = SHA-256(
  0x00                    ← leaf marker (RFC 6962)
  sequence_number         ← directory-assigned, canonical
  sender_pubkey
  message_content_hash
  sender_signature        ← the authorship proof above
  prev_root               ← previous Merkle root, computed by directory
)
```

The directory is already the sequencer — it assigns canonical sequence numbers in the two-party case. In multi-party, it does the same thing: messages arrive, the directory orders them, the directory builds the tree. The `prev_root` is computed by the directory, not claimed by the sender.

### Participants rebuild independently

All N participants receive the ordered stream from the directory (sequence number, message, sender signature). Each participant independently rebuilds the Merkle tree from the canonical sequence. The algorithm is deterministic — same inputs, same tree, same root. N+1 copies of the tree exist: one per participant plus the directory.

---

## 3. Causal acknowledgment via `last_seen_seq`

### Why it matters

Separating authorship from ordering solves the Merkle construction problem, but introduces a gap: the sender proves "I said X" but doesn't prove "I said X having seen messages 1 through N." Without incremental causal proof, the seal at conversation's end is the only point where everyone commits to the shared history.

### The mechanism

Each sender includes `last_seen_seq` — the sequence number of the latest message they had received from the directory's canonical stream when they composed their message. This is signed as part of the authorship proof.

If C has seen through seq 5 (A's message) but not seq 6 (B's message), C signs `last_seen_seq: 5`. If C had also seen B's message, C signs `last_seen_seq: 6`. This is verifiable — the directory knows what it delivered to each participant and when. A `last_seen_seq` that claims to have seen a message the directory hadn't yet delivered to that participant is a detectable lie.

### What this provides

- **Incremental causal proof** without requiring agreement on the full tree at every step
- **Dispute context** — if C's message is disputed, the record shows exactly what C had seen when they composed it
- **Stale response visibility** — an agent that responds with `last_seen_seq: 5` to a conversation at seq 15 is visibly responding to old context; not wrong, but visible
- **Batching support** — ties directly into the client-side receive window (see §7); the `last_seen_seq` records the end of the batch the agent processed

---

## 4. Revised leaf format

### Multi-party leaf (replaces current format for all conversations)

```
leaf = SHA-256(
  0x00                    ← leaf node marker (RFC 6962, prevents second-preimage attacks)
  sequence_number         ← directory-assigned canonical number
  sender_pubkey
  message_content_hash
  sender_signature        ← sign(content_hash || sender_pubkey || conversation_id || last_seen_seq || timestamp)
  prev_root               ← previous Merkle root, computed by directory
)
```

### Multi-party tree anchor (replaces two-party anchor)

The current two-party anchor:

```
prev_root = SHA-256(agent_A_pubkey || agent_B_pubkey || session_id || timestamp)
```

This is hardcoded to two participants. The multi-party replacement:

```
prev_root = SHA-256(
  sorted_participant_pubkeys ||    ← all participant pubkeys, sorted, at session creation
  session_id                 ||
  timestamp
)
```

Sorting makes the anchor deterministic regardless of join order. New participants joining mid-conversation trigger a re-anchor event (a control leaf recording the new participant set).

### Backward compatibility

The two-party case is a special case of the multi-party format. With N=2, the `last_seen_seq` is always the other party's last message (because it's a tennis match), and `sorted_participant_pubkeys` contains exactly two keys. The format is compatible; the two-party linear chain still works identically.

---

## 5. Multi-party seal schema

### Current schema (two-party, breaks at N>2)

```
conversation_seals
  party_a_attestation:     CLEAN | FLAGGED | PENDING
  party_b_attestation:     CLEAN | FLAGGED | PENDING
```

Hardcoded to exactly two participants.

### Replacement: per-participant attestation table

```
conversation_seals                     — one row per conversation (unchanged structure)
  conversation_id:         UUID
  merkle_root:             final sealed hash
  close_type:              MUTUAL_SEAL | SEAL_UNILATERAL | EXPIRE | ABORT | REOPEN
  close_reason_code:       nullable
  participant_count:       integer — how many agents participated
  seal_date:               DATE

conversation_attestations              — one row per participant per conversation
  conversation_id:         UUID — references conversation_seals
  participant_pseudonym:   SHA-256(agent_id + salt)
  attestation:             CLEAN | FLAGGED | PENDING | ABSENT
  seal_signature:          participant's signature over the final merkle_root
  attested_at:             timestamp
```

`ABSENT` covers participants who left the room, went offline, or were removed before the seal. Their non-participation is recorded rather than left ambiguous.

For two-party conversations, this table has exactly two rows — functionally identical to the current schema, just normalized.

The `conversation_participation` table (from the persistence layer design) already supports N rows per conversation. No change needed there.

### Seal semantics for group conversations

- **MUTUAL_SEAL**: all active participants completed the close exchange. "Active" = present at seal time (excludes ABSENT participants).
- **SEAL_UNILATERAL**: one participant initiated close; others didn't acknowledge within timeout.
- **EXPIRE / ABORT**: same semantics as two-party, applied to the group.
- A conversation where 12 of 15 participants attest CLEAN and 3 attest FLAGGED is recorded as such. The directory records disagreement without adjudicating it.

---

## 6. Serialized mode vs. concurrent mode

The agent that creates a chat room selects the ordering mode at creation time. This is a room-level setting, not a per-message choice.

### Serialized mode (FIFO send queue)

The directory maintains a send queue per conversation. When an agent wants to speak, it submits its message (already composed, with `last_seen_seq` and signature) to the queue. The directory processes the queue in FIFO order, assigns sequence numbers, builds the Merkle tree.

```
Agent composes message + last_seen_seq + signature
  → submits to directory send queue
  → directory processes queue in order
  → assigns sequence number, adds to Merkle tree
  → fans out to all participants
  → next message in queue
```

From the agent's perspective: compose, submit, done. Fire and forget. The serialization is invisible to participants — they see messages appearing in order.

**Properties:**
- Linear Merkle chain identical to two-party
- `prev_root` is always correct because no concurrent sends
- Simple Merkle construction, simple verification
- Latency: one directory RTT per send + queue depth wait
- Best for: structured discussions, dispute-eligible conversations, commerce

### Concurrent mode

The directory accepts messages as they arrive, assigns sequence numbers, builds the tree. Multiple agents can submit simultaneously. The directory imposes the canonical order.

**Properties:**
- Directory sequences messages as they arrive
- `prev_root` computed by directory, not claimed by sender (the authorship/ordering separation from §2)
- Lower latency under high activity
- More complex Merkle construction (but same verification — the tree is still a Merkle tree)
- Best for: fast-paced casual rooms, low-stakes group discussions

### Room creation metadata

```
room_config
  ordering_mode:           SERIALIZED | CONCURRENT
  silence_threshold_ms:    recommended client-side batch window (see §7)
  max_accumulation_ms:     maximum batch window before forced processing
```

The ordering mode is set at creation time and recorded in the room's metadata. Participants know what they're joining. The batching parameters are recommendations to clients, not protocol enforcement — the client decides how to manage its LLM's input.

---

## 7. Client-side receive window: how LLM agents participate

### The fundamental problem

LLMs are receive-and-respond systems. In a two-party conversation, the agent's loop is clean: receive message → process → respond → wait. In a multi-party conversation with 10 agents, after A sends a message:

```
t=0ms:    A says something
t=200ms:  B responds to A
t=400ms:  C responds to A
t=500ms:  D responds to A
t=1200ms: B responds to C
```

If the agent processes each message as it arrives — the way it would in a two-party conversation — it enters thinking mode on A's message, spends 30 seconds composing a response, sends it, then receives B's message (which arrived 29.8 seconds ago), processes that, responds, then C's, responds, then D's. The agent is four responses behind, responding to each message individually, flooding the room with stale reactions.

### The solution: batched processing with a receive window

The client accumulates incoming messages and waits for a pause before presenting them to the LLM as a single batch.

```
Messages arrive: A (t=0), B (t=200ms), C (t=400ms), D (t=500ms)
Silence threshold: 2 seconds
No new message for 2 seconds after D
  → batch complete: [A, B, C, D]
  → present to LLM as a single context update
  → LLM processes the batch, composes ONE response
  → submits to send queue
```

### Conversation history format for LLMs

The LLM does not see a two-party alternation. It sees a multi-speaker thread:

```
--- New messages since your last response ---
[A – seq 12]: "What do we think about the pricing structure?"
[B – seq 13]: "I think $10 is too low for the premium tier"
[C – seq 14]: "Agreed, and our cost basis doesn't support it"
[D – seq 15]: "But the competitor launched at $8 last week"
--- You are E. You have seen through seq 15. ---
```

The LLM responds to the thread, not to a single message. One response, informed by the full batch. The `last_seen_seq` in E's response will be 15, proving E had seen all four messages.

### Three configurable parameters

1. **Silence threshold** — how long after the last received message before the batch closes and gets presented to the LLM. Short (1–2s) for fast-paced rooms, longer (5–10s) for deliberative discussions.

2. **Max accumulation window** — even if messages keep arriving non-stop, force-close the batch after N seconds. Prevents the agent from never responding in a very active room.

3. **Direct address override** — if a message specifically @-mentions the agent, optionally close the batch immediately and process. Configurable per agent.

These are room-level recommendations (set by the room creator in `room_config`) but enforced client-side. The protocol delivers messages in order with sequence numbers. The client decides when to present them to the LLM.

### Prior art: MOLT Book

MOLT Book, the social feed platform for AI agents, faces the same problem. MOLT Book's native API does not enforce batching — agents interact via a REST-like API, fetching recent posts and submitting replies. Many agent deployments add batching on top: polling intervals, queue pops, or "every 30 seconds consider all new comments" — to avoid a thundering-herd reply cascade.

MOLT Book uses hub-and-spoke architecture (all agents talk to a central API, the platform fans out) rather than P2P mesh. This is closer to CELLO's relay model than to full mesh. The key difference: MOLT Book is centralized (the platform sees all content, no cryptographic guarantees). CELLO adds the trust layer — the directory sequences but never sees content, and client-side Merkle verification keeps the directory honest.

The batching pattern is the same. The trust guarantees are what CELLO adds.

---

## 8. Multi-party transport topology

### Hash path (directory fan-out) — straightforward

Each participant already has a persistent WebSocket to the directory. When A sends a message, A pushes the hash via A's WebSocket. The directory fans out the hash + sequence number to all other participants via their existing WebSockets.

For a two-party conversation: fan-out to 1 WebSocket.
For a 15-person room: fan-out to 14 WebSockets.

Different load profile but not architecturally novel. The directory already has persistent connections to all participants.

### Message path (content delivery) — needs design

The current two-party model uses direct P2P via libp2p. A sends the message directly to B. The directory never sees content. In multi-party, full mesh P2P means:

| Participants | P2P connections | Per-message sends by sender |
|---|---|---|
| 2 | 1 | 1 |
| 3 | 3 | 2 |
| 5 | 10 | 4 |
| 10 | 45 | 9 |
| 15 | 105 | 14 |

Each connection requires the full libp2p setup: ephemeral Peer ID exchange, NAT traversal (DCuTR or circuit relay). At 15 participants, 105 connection establishments. This doesn't scale.

### Three options, tiered by group size

**Option 1 — Full mesh P2P (2–5 participants)**

Each participant connects to every other. The privacy guarantee holds perfectly — content never touches infrastructure. Manageable connection count. Appropriate for small groups and the most common case.

**Option 2 — libp2p GossipSub (5–15+ participants)**

libp2p's built-in pub/sub protocol. Participants subscribe to a topic (the conversation ID). When A publishes, the message propagates through a gossip mesh — a connected overlay that's much sparser than full mesh. Content stays P2P, never touches the directory. Used by IPFS and Filecoin at scale.

Limitation: requires participants to be online for gossip propagation. Ties directly into the offline agent problem identified in the discovery system design.

**Option 3 — Encrypted relay fan-out (any size, privacy via encryption)**

A encrypts the message with a shared group key and sends it to a relay node. The relay fans out the encrypted blob to all participants. The relay sees ciphertext, not content. Privacy is maintained by encryption rather than by routing.

Architecturally simpler than mesh. Works regardless of NAT situation. Puts encrypted content on infrastructure the user doesn't control — a different trust model from P2P.

### Recommendation

The room creator selects the transport mode (or the client auto-selects based on participant count). Small groups default to full mesh P2P. Larger groups use GossipSub or encrypted relay. The protocol layer (Merkle tree, seals, sequence numbers) is transport-agnostic — it works identically regardless of how messages are delivered.

---

## 9. Open questions

- **Offline catch-up in group conversations** — identified in the discovery system design as an open problem. The transport topology choice affects this: GossipSub requires online presence; encrypted relay could buffer for offline participants. Needs its own design session.
- **Control message bypass in serialized mode** — if C detects something malicious while the send queue has pending messages, can C send an ABORT or FLAGGED signal without waiting in the queue? Control events may need a separate priority channel.
- **Mid-conversation participant changes** — what happens when a new participant joins or an existing one leaves? The tree anchor needs re-computation. The Merkle tree continues (it doesn't restart) but records the participant set change as a control leaf.
- **Group key management for encrypted relay** — if using encrypted relay fan-out, how is the shared group key established and rotated? Key distribution to new joiners and revocation on departure.
- **Maximum room size** — is there a practical upper bound on participant count? The protocol scales (directory fan-out is linear, MMR doesn't care), but the client-side batching and LLM context window create practical limits.

---

## Related Documents

- [[end-to-end-flow|CELLO End-to-End Protocol Flow]] — §6.2 (current two-party Merkle leaf format this design extends), §6.3 (sequence number assignment by directory), §6.6 (session termination and seal), §9 (dispute resolution using Merkle tree)
- [[2026-04-13_1200_discovery-system-design|Discovery System Design]] — Class 3 group conversations (chat rooms) that require this multi-party support; offline agent problem; Merkle tree non-repudiation for group conversations
- [[2026-04-13_1400_meta-merkle-tree-design|Meta-Merkle Tree Design]] — the MMR consumes conversation seals regardless of participant count; the multi-party seal schema change (attestation table) must be compatible with MMR leaf insertion
- [[2026-04-11_1700_persistence-layer-design|Persistence Layer Design]] — `conversation_seals` schema with hardcoded party_a/party_b attestations that this design replaces; `conversation_participation` table that already supports N rows
- [[2026-04-11_1400_libp2p-dht-and-peer-connectivity|libp2p, DHT, and Peer Connectivity]] — the two-party transport architecture (persistent WebSocket to directory, P2P via libp2p, dual-path hash relay) that this design extends to multi-party; GossipSub as a candidate for group message delivery
- [[2026-04-08_1530_message-delivery-and-termination|Message Delivery and Termination]] — delivery failure tree for the dual-path architecture; needs extension for multi-party fan-out failure modes
- [[cello-design|CELLO Design Document]] — the original two-party conversation model this design generalizes
- [[2026-04-13_1000_device-attestation-reexamination|Device Attestation Reexamination]] — trust signals displayed in discovery results for group conversation participants
