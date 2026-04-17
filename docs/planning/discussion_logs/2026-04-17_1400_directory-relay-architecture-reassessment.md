---
name: Directory/Relay Architecture Reassessment — Session-Level Merkle Engine
type: discussion
date: 2026-04-17 14:00
topics: [relay-nodes, directory, FROST, session-management, merkle-tree, libp2p, transport, hash-relay, sequence-numbering, NAT, architecture, performance, security]
description: Reassesses the directory/relay node split. Drops the "relay as dumb pipe" model. Establishes relay nodes as session-level Merkle engines handling hash relay, sequence numbering, and tree building during active sessions. Directory nodes become bookend authorities — active at session establishment (FROST) and seal (FROST) only. Resolves C-2. Supersedes the hash relay contradiction in server-infrastructure.md.
---

# Directory/Relay Architecture Reassessment — Session-Level Merkle Engine

## The Problem with the Previous Design

The server-infrastructure document described relay nodes as serving two purposes:

1. Provide circuit relay for the ~20–30% of sessions that cannot hole-punch through symmetric NAT
2. Take load off directory nodes during active conversations (hash relay, fan-out for group rooms)

But the actual session architecture contradicted this. The directory node assigned canonical sequence numbers, built the per-conversation Merkle tree, and relayed hashes to the counterparty via its persistent WebSocket. The relay node forwarded hashes without sequence numbers — giving the receiver an unordered, non-authoritative copy while the receiver still depended on the directory's version.

Relay nodes as described were dumb NAT traversal pipes with a confused secondary role. The directory remained in the critical path of every message in every session, making it a real-time bottleneck rather than an authority that operates at session boundaries.

This also left Conflict C-2 unresolvable: if the directory was in the loop for every hash, the question "which node type handles the FROST seal ceremony?" had a trivial but unsatisfying answer — the directory was already there, so the separation served no purpose.

---

## The Original Intent

The original high-level intent for the split was:

- **Directory nodes are introducers.** Their role is to establish the connection between two agents, police the trust model, verify identities, and ensure there's no man-in-the-middle at session establishment. Their active role ends when agents begin talking.
- **Relay nodes handle the session.** Cheap, scalable, doing the real-time work while the directory is dormant.

This intent was never fully realized because hash relay, sequencing, and Merkle tree building were never explicitly moved to relay nodes.

---

## The Decision: Relay Nodes as Session-Level Merkle Engines

The boundary is redrawn along **frequency**: directory handles infrequent, high-security boundary operations; relay handles frequent, real-time session operations.

### Directory Nodes — Introducer and Notary

Active at session boundaries only:

| Responsibility | When |
|---|---|
| Registration, identity verification | At registration |
| Connection request brokering (verify-then-relay-discard) | At connection time |
| FROST ceremony — session establishment | Session open |
| FROST ceremony — conversation seal | Session close |
| Checkpoint consensus (global MMR) | Periodic |
| Identity Merkle tree maintenance | On agent state changes |
| Session-to-relay assignment | Session open |
| Relay failure recovery (reassignment) | On relay failure |

Directory nodes hold: public keys, trust signal hashes, K_server_X shares (envelope-encrypted, federated across all nodes), identity Merkle tree, global MMR, sealed conversation roots.

### Relay Nodes — Session-Level Merkle Engine

Active during the entire conversation:

| Responsibility | Frequency |
|---|---|
| Hash relay — receive signed hash from sender, verify signature, assign sequence number, relay to counterparty | Every message |
| Per-conversation Merkle tree building | Every message |
| NAT traversal — circuit relay for sessions that can't hole-punch | ~20–30% of sessions |
| Session state handoff to directory at seal time | Session close |

Relay nodes hold: agents' public keys (read-only, received from directory at session assignment), per-session ephemeral Merkle state (destroyed after seal).

Relay nodes do NOT hold: K_server_X shares, FROST key material, PII, identity data, the global MMR, or any append-only log.

### What Cannot Move to Relay

| Responsibility | Why it stays on directory |
|---|---|
| FROST ceremonies | Requires K_server_X shares — must never leave directory nodes |
| Registration, key operations | Identity-level operations tied to signup portal and FROST |
| Connection request brokering | Happens before a session exists — relay isn't involved yet |
| Checkpoint consensus | Directory nodes sign the global MMR checkpoint; relay's per-session trees feed in via sealed roots |
| Identity Merkle tree | Global, not per-session |

---

## The Session Lifecycle

### Session establishment (directory)

1. Both agents authenticate to a directory node via persistent WebSocket
2. Connection request flow — directory brokers the introduction, verifies trust signals
3. FROST co-signing ceremony on directory nodes — session is authenticated
4. Directory assigns the session to a relay node (or set of relay nodes), signing the assignment with its consortium key. The assignment contains: session ID, both agents' public keys, genesis `prev_root`
5. Relay verifies the directory's signature on the assignment before accepting
6. Agents establish P2P connection (direct hole-punch or via circuit relay through that same relay node)

### During session (relay — directory is dormant)

7. Agent A sends message to B via P2P (direct or relayed through the relay node for NAT-failed sessions)
8. Agent A sends signed hash to the relay node
9. Relay verifies A's signature against A's public key, assigns the next sequence number, constructs the Merkle tree leaf, relays the sequenced hash to B via B's connection to the relay
10. B verifies hash matches the message received via P2P; updates local Merkle tree
11. Repeat

Both agents independently maintain their own copy of the Merkle tree throughout.

### Session seal (directory returns)

12. Party A sends CLOSE control leaf → relay records it, relays to B
13. Party B sends CLOSE-ACK → relay records it
14. Relay hands the complete leaf sequence and final Merkle root to the directory
15. Directory verifies the tree from scratch (recomputes from the full leaf sequence — does not trust the relay's root)
16. Directory runs the FROST seal ceremony co-signing the verified final root
17. Sealed root enters the global MMR via `conversation_seals`

---

## Conflict C-2 — Resolved

**Which node type handles the FROST seal ceremony?**

The directory — always. The relay builds the Merkle tree during the session and hands the final state to the directory at seal time. The directory independently verifies the tree and runs the FROST seal ceremony. Any t-of-n directory nodes can perform the ceremony.

This is not ambiguous because the relay never holds K_server_X shares. FROST can only happen on directory nodes. The relay's role at seal time is limited to handing over the leaf sequence.

---

## Security Analysis: What Can a Compromised Relay Do?

### Cannot do (crypto prevents it)

- **Forge message hashes** — requires K_local (agent's private key)
- **Forge session seals** — requires K_server_X shares (directory-only)
- **Retroactively alter sealed trees** — MMR checkpoint root is signed by directory nodes
- **Substitute agent identities** — agents verify counterparty signatures against public keys confirmed via Merkle inclusion proof at connection time; a substituted key causes immediate verification failure

### Can do (but detectable)

- **Drop hashes (censorship)** — sender has their own copy; mismatch detected when trees diverge
- **Reorder hashes** — detected via `last_seen_seq` in each sender's signed Structure 1 (see below)
- **Assign duplicate sequence numbers** — detected by both agents and directory
- **Stall indefinitely** — denial of service; triggers relay failure recovery

**The worst a compromised relay can do is disrupt a session. It cannot fabricate evidence or forge a seal.**

### Adversarial sequencing defence

Each sender signs Structure 1 containing `last_seen_seq` — the last sequence number the sender received from the relay. This creates a causal chain: if Alice's message says "I've seen up to seq 5," the relay cannot place that message before seq 5 without the inconsistency being provable.

Agents must reject and flag any relayed hash where the sequence number is inconsistent with their local state. The directory verifies causal consistency of the full leaf sequence at seal time — `last_seen_seq` values must be monotonically consistent with assigned sequence numbers.

A relay that imposes adversarial ordering produces a tree with provable internal inconsistencies.

---

## Handoff Authentication

The directory-to-relay session assignment must be authenticated:

1. Directory signs the session assignment (session ID, agent public keys, genesis `prev_root`) with its consortium key
2. Relay verifies the directory's signature before accepting the session
3. Agents independently verify: when the relay starts relaying hashes, each agent checks that signatures match the counterparty's public key — which was confirmed via Merkle inclusion proof during the connection request, through a completely separate channel

Defence in depth: authenticated directory-to-relay channel, plus agents independently verify sender signatures against a key confirmed through a separate path.

---

## Relay Failure Recovery

If a relay node goes down mid-session:

1. Both agents detect the relay is gone (connection drops)
2. Both agents still have their local Merkle tree copies with all leaves and the last confirmed sequence number
3. Both agents still have their persistent WebSocket to the directory (dormant but open)
4. Either agent signals the directory: "relay X is down, session Y needs reassignment"
5. Directory assigns a new relay, hands it the session ID, public keys, and the last confirmed sequence number (reported by both agents — must agree)
6. New relay picks up sequencing from the confirmed point
7. Agents resume

The directory's role here is recovery coordination, not continuous involvement. The persistent WebSocket is dormant during normal operation and available when something breaks — like a fire alarm.

Messages sent between relay failure and reassignment: if the agents have a direct P2P connection (the ~70–80% case), messages continue flowing directly. Only the hash relay is interrupted. The agents queue hashes locally and submit them to the new relay on reassignment. No messages are lost.

For NAT-failed sessions (the ~20–30% using circuit relay): both message and hash paths are interrupted. Messages queue on the sender until the new relay is up. The grace window for message delivery (`delivery_grace_seconds`, default 600) accommodates this.

---

## libp2p Circuit Relay v2 Configuration

libp2p circuit relay v2 defaults to short-lived, resource-constrained reservations (2-minute duration, 128 KiB data limit). These defaults assume the relay is a stepping stone to hole-punching, not a long-lived session transport.

CELLO relay nodes must be configured with:
- **No time limit** on reservations (conversations can last hours or days)
- **No data cap** (or a cap set far above any realistic session — encrypted message traffic for NAT-failed sessions flows through the relay for the entire conversation)

This is a deployment configuration, not a protocol design issue. libp2p circuit relay v2 supports unlimited reservations. The requirement must be explicit in the relay node deployment spec to prevent default-configuration surprises during implementation.

---

## Performance Characteristics

| Dimension | Directory nodes | Relay nodes |
|---|---|---|
| **CPU** | FROST ceremonies (threshold Ed25519 — not cheap, but infrequent) | SHA-256 hashing, Ed25519 signature verification (cheap, frequent) |
| **Memory** | Identity tree + encrypted K_server_X shares (scales with total agents) | Per-session Merkle tree state (scales with concurrent sessions, ephemeral) |
| **Storage** | Append-only log, sealed conversation roots, MMR (persistent, growing) | None persistent — session state destroyed after seal handoff |
| **Scaling axis** | Number of registered agents | Number of concurrent active sessions |
| **Failure impact** | No new sessions; no seals; existing relay sessions continue | Affected sessions need reassignment; directory unaffected |

Directory and relay scale on different axes. Directory load grows with the agent population. Relay load grows with concurrent session count. They can be scaled independently.

**Predicted bottleneck:** FROST ceremony bursts on directory nodes. A popular agent starting many sessions simultaneously serializes FROST ceremonies. Consider batching or pipelining FROST rounds in future if this becomes a constraint.

---

## What This Supersedes

- **server-infrastructure.md line 605**: "Take load off directory nodes during active conversations (hash relay, fan-out for group rooms)" — the relay role is now explicitly defined as hash relay with sequencing and Merkle tree building, not offloading from directory
- **server-infrastructure.md lines 626–633**: Relay hash relay description — to be rewritten with sequence numbering and tree building authority
- **server-infrastructure.md C-2**: Resolved — FROST seal is always on directory
- **The "dumb pipe" characterisation**: Relay nodes are session-level Merkle engines, not dumb pipes. They verify signatures, assign sequence numbers, and build trees.
- **Hash relay contradiction**: The directory is no longer in the per-message critical path during active sessions. The relay handles it.

---

## Related Documents

- [[server-infrastructure|CELLO Server Infrastructure Requirements]] — C-2 resolved; relay node section must be rewritten to reflect session-level Merkle engine role; hash relay section must move from directory to relay; session setup and seal flows must reflect the handoff
- [[end-to-end-flow|CELLO End-to-End Protocol Flow]] — session lifecycle narrative must be updated to reflect directory-at-boundaries, relay-during-session model
- [[agent-client|CELLO Agent Client Requirements]] — client must validate relay sequencing against `last_seen_seq`; must handle relay failure recovery (signal directory, resume on new relay)
- [[cello-design|CELLO Design Document]] — relay node description must reflect the session-level Merkle engine role
- [[2026-04-15_0900_session-level-frost-signing|Session-Level FROST Signing]] — the session-level FROST decision that made this split possible: FROST at boundaries only means the directory can step away during the session
- [[2026-04-11_1400_libp2p-dht-and-peer-connectivity|libp2p, DHT, and Peer Connectivity]] — transport layer; circuit relay v2 configuration requirements for long-lived sessions
- [[2026-04-08_1700_node-architecture-and-replication|Node Architecture and Replication]] — primary/backup replication and client-side routing; relay nodes need analogous backup selection for session resilience
- [[protocol-review/design-problems|Design Problems]] — Problem 7 resolution (no home node) is a prerequisite: PII in signup portal, directory holds only hashes and keys, relay holds nothing persistent
