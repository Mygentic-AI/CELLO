---
name: Relay Session Mechanics and Recovery
type: discussion
date: 2026-05-14 17:02
topics: [relay-nodes, persistence, hash-relay, recovery, merkle-tree, session-management, WAL, agent-hash-queue, pre-seal-reconciliation, signed-ACK, P2P, robustness]
description: Relay WAL scoped to crash recovery only. Agent-side hash queue established as first-class protocol primitive and primary robustness guarantee. Pre-seal reconciliation protocol and signed relay ACKs required. P2P-first model means relay failure does not interrupt conversation.
---

# Relay Session Mechanics and Recovery

## The P2P-First Robustness Model

The relay is not load-bearing for conversation continuity. Agent A and Agent B communicate directly via P2P. The relay is a secondary infrastructure concern: hash submission for the Merkle record, and circuit relay for the NAT-failed minority (~20–30% of sessions).

If the relay fails, A and B keep talking. The conversation does not stop. What stops is Merkle accounting — hashes are not being sequenced and committed. That is a bookkeeping problem, not a communication problem.

This distinction is fundamental. The relay failing must never cause a conversation to halt.

---

## Agent Hash Queue — First-Class Protocol Primitive

When relay connectivity is interrupted, agents queue their message hashes locally. This is not an implementation convenience — it is a first-class protocol primitive and the primary robustness guarantee.

When relay connectivity is restored, or when a new relay is assigned, agents submit the queued hashes in order. The relay sequences them, both trees catch up, and seal proceeds normally.

**The queue is the recovery mechanism.** The relay's own WAL (see below) is the relay's crash-recovery tool. The agents' hash queues are what make the protocol correct under relay failure. These are two different mechanisms serving two different failure modes.

---

## Relay WAL — Crash Recovery Only

Relay nodes are designed as stateless. Ephemeral per-session Merkle state is held in memory and destroyed after seal handoff to the directory.

However, relay nodes should maintain a per-session write-ahead log (WAL) on local disk for crash recovery purposes only. On relay failure and restart, the WAL allows the relay to reconstruct in-memory Merkle state and resume sequencing from the last confirmed leaf — rather than requiring agents to re-submit the full leaf sequence from the beginning.

**What the WAL contains per leaf:**
- Sequence number
- Sender public key
- Message content hash
- Sender signature (Structure 1)
- Scan result
- `prev_root`
- Relay's signed ACK timestamp

**WAL lifetime:** Written during the active session. Destroyed after the directory confirms the seal. Never replicated. Never persisted beyond session end.

**Why this is not a database:** No schema, no migrations, no query interface. A simple append-only file per session, flushed to disk after each leaf write. Each entry is one serialized leaf. The relay reads it sequentially on restart to reconstruct state.

**Storage cost:** ~250 bytes per message. A very long three-day session with thousands of messages is a few megabytes. This is operationally negligible.

---

## Signed Relay ACKs — Cryptographic Commitments

When the relay sequences a hash and ACKs to the sender, that ACK must be a signed cryptographic receipt, not merely a network-level delivery confirmation.

**Relay ACK contains:**
- Hash H that was received
- Sequence number assigned
- Timestamp
- Relay's signature over (H || sequence_number || timestamp)

The sender stores this signed ACK. It becomes evidence in any dispute about whether a message entered the Merkle record.

**Why this matters:** If a relay is faulty or compromised and claims a hash was never submitted, the sender can present the relay's own signed ACK proving it was. A relay cannot deny sequencing something it already signed an ACK for.

This is a gap in the current design — relay ACKs are described as protocol-level confirmations but are not specified as cryptographic commitments. They must be.

---

## One-Sided Loss Scenarios

### Scenario 1: A → Relay fails, A → B (P2P) succeeds

A sends content to B directly — B receives it. A sends hash to relay — fails.

State:
- A: message content sent, hash not confirmed at relay, local tree at leaf N-1
- B: message content received, no Merkle entry, local tree at leaf N-1
- Relay: tree at leaf N-1

All three are consistent — nobody has a divergent tree. A queues the hash locally. On relay recovery or reassignment, A submits the queued hash. Relay sequences it, delivers to B, trees advance. No divergence, clean recovery.

### Scenario 2: A → Relay succeeds, Relay → B delivery fails

A sends content to B directly — B receives it. A sends hash to relay — relay sequences it as leaf N, ACKs to A. Relay forwards sequenced hash to B — B's relay connection drops.

State:
- A: leaf N confirmed, signed ACK stored, tree at N
- B: message content received via P2P, tree stuck at N-1, waiting for sequenced hash
- Relay: leaf N in WAL, knows delivery to B failed

This is the divergence case. A is ahead of B. If the session attempts to seal now, A and B have different final roots and FROST cannot proceed.

Recovery: pre-seal reconciliation (see below) detects the divergence. Relay serves leaf N to B from WAL. B's tree catches up. Seal proceeds.

### Scenario 3: Persistent relay-to-B failure

B is not receiving sequenced hashes despite receiving message content via P2P. After a timeout threshold, B signals the directory: relay X is not delivering to me.

A and B continue the conversation via P2P throughout. Both accumulate hash queues locally.

Directory assigns a new relay. Agents submit queued hashes to the new relay in order. New relay sequences them, delivers to both parties, trees synchronize. Seal proceeds normally.

**Reassignment and WAL handoff:** If the old relay is still accessible, it hands its WAL to the new relay as part of reassignment. If the old relay is gone, the agents' local hash queues are the authoritative source. The new relay validates re-submitted hashes against the sender's signed ACKs from the old relay.

---

## Pre-Seal Reconciliation Protocol

Before either party sends CLOSE, both parties exchange their last confirmed sequence number. If they agree, seal proceeds immediately. If they diverge, a gap-fill step runs before CLOSE is sent.

**Gap-fill mechanism:**
1. The party with the lower sequence number requests missing leaves from the relay
2. Relay serves them from WAL
3. Requesting party verifies each leaf against the sender's signature and the hash chain
4. Once trees are consistent, both parties confirm their sequence number
5. CLOSE proceeds

**Why the relay serves gap-fill rather than the counterparty:** If the ahead party (A) fills the gap, A is in control of what B receives. A could substitute content. The relay serving from WAL is authoritative — the relay sequenced and signed those leaves at the time of submission.

**WAL retention during reconciliation:** The relay holds the WAL until both parties confirm consistent trees and the seal is complete — not merely until CLOSE is initiated. Premature WAL deletion before confirmed reconciliation would leave the gap-fill mechanism without its source.

**Current gap in the design:** The relay reassignment protocol specifies "agents report last confirmed sequence number, must agree" but does not specify the resolution path when they disagree. Disagreement is exactly the scenario that most commonly triggers reassignment. This reconciliation protocol is the missing piece.

---

## What the Relay Does NOT Need

- A full database with schema and migrations
- Replication of session state to other nodes
- Long-term storage after seal
- Any record of message content (it never has this)
- Any record of agent identities beyond the session assignment (public keys only, received from directory)

The relay's persistence surface is: one WAL file per active session, deleted on seal. Operational metadata (session counts, anomaly signals, timing) retained separately for billing and accountability — small, no message content, no hashes.

---

## Related Documents

- [[2026-04-17_1400_directory-relay-architecture-reassessment|Directory/Relay Architecture Reassessment]] — established relay as session-level Merkle engine; this log extends that with WAL design, signed ACKs, pre-seal reconciliation, and the P2P-first robustness model
- [[2026-04-11_1700_persistence-layer-design|Persistence Layer Design]] — directory and client persistence; relay WAL is explicitly outside the scope of that design
- [[2026-04-08_1700_node-architecture-and-replication|Node Architecture and Replication]] — primary/backup replication for directory nodes; relay backup selection is analogous but lighter (WAL handoff, not full replication)
- [[server-infrastructure|CELLO Server Infrastructure Requirements]] — relay node section should be updated to reflect WAL, signed ACKs, and pre-seal reconciliation as explicit requirements
- [[2026-05-14_1702_arbitration-mechanics-and-dispute-resolution|Arbitration Mechanics and Dispute Resolution]] — client-side hash queue retention and backup obligations are the non-repudiation guarantee; losing the local record is losing the right to dispute
- [[2026-06-20_2220_tier5-recovery-substrate-disposition|Tier-5 Recovery Substrate Disposition]] — resolves this log's signed-relay-ACK and pre-seal-reconciliation items as M7 DoD REC-1 (satisfied by PERSIST-012) and REC-2 (subsumed by the directory-authoritative seal rebuild + MSG-001 recovery + POSTMORTEM D-3)
