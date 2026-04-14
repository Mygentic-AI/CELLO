---
name: Meta-Merkle Tree Design
type: discussion
date: 2026-04-13 14:00
topics: [merkle-tree, conversation-proof, MMR, federation, checkpoint, inclusion-proof, identity-tree, fabricated-conversation, schema, append-only, non-repudiation]
description: Full design of the conversation proof ledger (meta-Merkle tree) — replacing the hash chain with an MMR, inclusion proof format, distributed construction across federated nodes, identity Merkle tree for mutable agent state, and storage analysis showing conversation records never need pruning.
---

# Meta-Merkle Tree Design

## The problem

The meta-Merkle tree exists as a concept across several documents — the fabricated conversation defense, the conversation proof ledger, and the checkpoint system — but no schema has been worked through. Four specific gaps:

1. The current `conversation_proof_log` schema is a hash chain (linked list), not a Merkle tree — it can't support logarithmic inclusion proofs
2. The inclusion proof format and client verification algorithm are unspecified
3. The insertion trigger (which close types enter the ledger) is undefined
4. The identity Merkle tree (referenced in checkpoints) has no schema

This session designs all four.

---

## Hash chain → Merkle Mountain Range

### Why the hash chain fails

The current schema:

```
conversation_proof_log               — append-only
  log_id                             — sequential
  seal_merkle_root                   — from conversation_seals
  log_entry_hash                     — SHA-256(seal_merkle_root || previous_log_entry_hash)
  recorded_at
```

`log_entry_hash` forms a linked list. Proving that conversation N is in the chain requires replaying from entry 0 to N. That's O(N). For a network with millions of sealed conversations, it's unusable as a verification primitive.

### The replacement: Merkle Mountain Range (MMR)

An MMR is an append-only list of perfect binary Merkle trees. It's the structure Certificate Transparency logs use at Google scale. Append-only by construction, logarithmic inclusion proofs, trivially checkpointable.

**How appending works:**

1. Add the new seal as a height-0 peak (a single leaf)
2. While the two rightmost peaks are the same height, merge them — hash their roots together to form a new peak one level higher
3. The MMR state at any point = the set of peak roots, left to right

At any moment, the MMR is a forest of at most log₂(N) perfect binary trees. Appending never modifies existing nodes — it only adds new ones and potentially merges peaks upward. No existing hash is ever changed.

### Schema

The `conversation_proof_log` table is replaced with two tables:

```
conversation_proof_leaves              — append-only, one row per sealed conversation
  leaf_index                           — sequential (0, 1, 2, ...)
  mmr_position                         — position in the MMR (deterministic from leaf_index)
  checkpoint_id                        — which checkpoint batch this leaf entered in
  seal_merkle_root                     — from conversation_seals
  leaf_hash                            — SHA-256(leaf_index || seal_merkle_root || recorded_at)
  recorded_at                          — original seal time (for audit)

conversation_proof_mmr_nodes           — append-only, internal tree nodes
  mmr_position                         — deterministic from the MMR structure
  hash                                 — SHA-256(left_child_hash || right_child_hash)
  height                               — 1+ (leaves are height 0 in the other table)
```

MMR positions are deterministic — given a leaf index, its position and all ancestor positions are computable in O(log N) arithmetic. No indexing ambiguity.

**Storage cost:** An MMR with N leaves has at most 2N - 1 total nodes. For 10 million sealed conversations: ~20M nodes × 32 bytes = ~640 MB of hashes. Trivial for PostgreSQL.

---

## Inclusion proof format and client verification

### Proof structure

```
ConversationInclusionProof
  leaf_index                — which leaf
  leaf_hash                 — SHA-256(leaf_index || seal_merkle_root || recorded_at)
  sibling_hashes[]          — path from leaf to its peak (log₂ of subtree size)
  peak_index                — which peak this leaf falls under
  other_peak_hashes[]       — the other MMR peaks at checkpoint time
  checkpoint_id             — which checkpoint attests this
  checkpoint_hash           — the attested hash
  node_signatures[]         — {node_id, signature} from federation nodes
```

### Client verification — 5 steps, all local

1. **Recompute leaf hash** from known conversation data: `SHA-256(leaf_index || seal_merkle_root || recorded_at)`. Must match `proof.leaf_hash`.

2. **Walk sibling hashes upward** from leaf to peak. At each level: `hash = SHA-256(left || right)`. Left/right determined by MMR position (deterministic). Final hash must equal the peak hash for this subtree.

3. **Reconstruct checkpoint commitment.** Concatenate all peak hashes (the one computed in step 2 + `other_peak_hashes`) in MMR left-to-right order. Hash with `identity_merkle_root` and `checkpoint_id`. Must equal `checkpoint_hash`.

4. **Verify federation signatures.** For each entry in `node_signatures`: verify against known node public keys. Count must meet threshold (4-of-6 in alpha, 11-of-20 in consortium).

5. **Accept or reject.** All steps pass: conversation provably existed before checkpoint. Any step fails: proof is invalid.

### Proof size

For a ledger with 10 million conversations, the tallest subtree is ~23 levels. Sibling hashes: 23 × 32 = 736 bytes. Peak hashes: at most 23 × 32 = 736 bytes. Plus metadata and signatures. Total proof: under 3 KB. Verification: microseconds.

---

## Insertion trigger

**Rule: every INSERT into `conversation_seals` triggers a leaf append. All close types. No exceptions.**

The proof ledger proves existence in time, not quality. An aborted conversation still existed. A unilaterally sealed conversation still existed. `close_type` and `party_attestation` values are metadata within the seal — they describe what happened, but they don't gate whether the conversation is recorded.

The trigger is a PostgreSQL `AFTER INSERT` on `conversation_seals`. Every seal gets a leaf. The directory processes it.

**Edge case — fabricated conversations between Sybil agents:** An attacker controlling two key pairs can run a real conversation through the directory and seal it honestly. The proof ledger correctly records that this conversation existed. This is not the proof ledger's problem. The Sybil defense stack (trust scores, endorsement requirements, connection policies, graph analysis) makes that attack expensive. The proof ledger defends against retroactive fabrication (claiming a conversation happened when it didn't). Sybil-mediated real conversations are a different layer's concern.

---

## Distributed MMR construction across federated nodes

### The problem

The MMR requires a canonical leaf ordering. With 20 nodes across AWS, GCP, and Azure in different regions, conversations seal on different nodes simultaneously. No shared clock, no single insertion point.

### The solution: checkpoint-batched construction

The MMR is not built in real-time. It is built in deterministic batches at checkpoint boundaries.

**Between checkpoints — accumulate seals:**

Nodes do what they already do. A conversation's primary node writes the seal to `conversation_seals`. The seal propagates to all other nodes via logical replication. Seals accumulate in a staging area. No MMR computation happens yet.

```
conversation_seal_staging              — cleared after each checkpoint
  seal_id                              — from conversation_seals
  seal_merkle_root
  conversation_id
  recorded_at
```

**At checkpoint time — deterministic batch, independent computation:**

**Step 1 — Agree on the input set.** Each node computes a hash over all seals accumulated since the last checkpoint. They exchange these hashes. If a node is missing a seal (replication lag), it catches up from peers before proceeding. This is the pre-checkpoint sync — the same mechanism the existing federation design uses for consistency checks.

**Step 2 — Deterministic sort.** All nodes sort the new batch by the same rule:

```
ORDER BY recorded_at ASC, conversation_id ASC
```

`recorded_at` gives temporal ordering. `conversation_id` (UUID) is the tiebreaker for seals at the same timestamp. The sort rule is deterministic — given the same set of seals, every node produces the same ordered list independently. No coordination needed.

**Step 3 — Extend the MMR.** Each node independently appends the sorted batch to its local copy of the MMR, in order. Because the input is identical and the append algorithm is deterministic, every node arrives at the same new peaks.

**Step 4 — Sign the checkpoint.** Each node computes the new checkpoint hash (including the new MMR peaks) and signs it. They exchange signatures. Threshold met = checkpoint confirmed.

If a node's checkpoint hash diverges from the majority, it's flagged — same as the existing divergence detection.

### Updated checkpoint schema

```
directory_checkpoints                  — append-only
  checkpoint_id                        — sequential, monotonically increasing
  mmr_leaf_count                       — how many leaves at checkpoint time
  mmr_peaks                            — ordered list of (position, hash) for current peaks
  identity_merkle_root                 — hash of all active identity records (see §Identity tree)
  checkpoint_hash                      — SHA-256(mmr_peaks_serialized || identity_merkle_root || checkpoint_id)
  created_at

checkpoint_node_signatures             — append-only
  checkpoint_id                        — references directory_checkpoints
  node_id                              — the signing federation node
  node_signature                       — node signs the checkpoint_hash
  signed_at
```

### Why this avoids the hard distributed systems problems

- **No real-time ordering consensus.** Seals accumulate unordered. Order is imposed deterministically at batch time.
- **No single sequencer.** No node has a special role in MMR construction. Every node computes independently from the same input.
- **No cross-cloud coordination during normal operation.** Replication is async. The only synchronous moment is the checkpoint exchange, which already exists.
- **Partition tolerance.** If a node is partitioned and misses seals, it catches up before signing the checkpoint. If it can't catch up, it doesn't sign — the threshold proceeds without it.

---

## Identity Merkle tree

### Why it needs a different structure

The conversation proof ledger is append-only (conversations are added, never modified). The identity tree is fundamentally different: agent state mutates. Keys rotate. Trust scores update. Tombstones mark deletion. The checkpoint needs to commit to current state, not event history.

### Structure: sorted sparse Merkle tree over agent state

Leaves are agent records, keyed by `agent_id`. Each leaf is a hash of the agent's current state:

```
identity_leaf_hash = SHA-256(
  agent_id              ||
  signing_pubkey        ||
  identity_pubkey       ||
  status                ||    — ACTIVE | TOMBSTONED | SUSPENDED
  trust_score_hash      ||
  bio_hash              ||
  social_verifications_hash || — hash of sorted list of verification hashes
  attestations_hash     ||    — hash of sorted list of attestation hashes
  endorsements_hash     ||    — hash of sorted list of endorsement hashes
  last_updated
)
```

The tree is a standard binary Merkle tree built over these sorted leaves. The root commits to the complete state of all agents at a point in time.

### Schema

```
identity_tree_leaves                   — mutable (current state, one row per agent)
  agent_id                             — primary key
  leaf_hash                            — computed from current state (formula above)
  tree_position                        — position in sorted order
  last_updated

identity_tree_nodes                    — recomputed on state change
  position                             — tree position
  height                               — 0 = leaf reference, 1+ = internal
  hash                                 — SHA-256(left_child_hash || right_child_hash)
```

### Update path

When an agent's state changes (key rotation, trust score update, new endorsement, tombstone):

1. Recompute that agent's `leaf_hash`
2. Walk from the leaf to the root, recomputing each parent = `SHA-256(left || right)`
3. New root = `identity_merkle_root` for the next checkpoint

Cost: O(log N) hash computations per state change. For 1 million agents: ~20 hashes. Negligible.

### Client verification

Same pattern as conversation proofs:

1. Query agent A's current state from one node — receive state fields + Merkle proof (sibling hashes to root)
2. Recompute `leaf_hash` from state fields — must match the leaf in the proof
3. Walk sibling hashes to root — must produce the `identity_merkle_root` from the latest confirmed checkpoint
4. Verify checkpoint signatures from federation nodes — threshold met = accept

This is what end-to-end-flow §2.5 describes ("client never trusts a single node's data") — now it has a concrete structure behind it.

### New agent registration

A new agent adds a leaf. For a static-depth tree (depth = ceil(log₂(max_agents))), empty leaves hash to a known zero value. Proof size stays O(depth) where depth ~20 for one million agents — 20 × 32 = 640 bytes.

---

## Rogue node resilience

The MMR inherits the existing federation defenses. No new trust requirements are introduced.

### Admission control (existing)

The three deployment phases prevent rogue nodes from joining: alpha is CELLO-operated only, consortium is vetted/contracted/audited, public requires proof-of-stake collateral with slashing.

### Detection (existing, applied to MMR)

| Rogue node action | How it's caught |
|---|---|
| Omit a seal from the batch | Pre-checkpoint batch hash doesn't match majority |
| Insert a fake seal | No corresponding `conversation_seals` record on other nodes; detected at batch hash comparison |
| Produce a different MMR root | Deterministic sort + deterministic MMR construction means all honest nodes produce the same root; different root = divergence = flagged |
| Refuse to sign checkpoint | Threshold proceeds without it; one node withholding doesn't block the checkpoint |

### Client-side verification (existing)

A compromised node serving tampered data to clients is caught by client-side Merkle proof verification. The client queries multiple nodes for the checkpoint hash, requests data + proof from one node, and verifies locally. A tampered response doesn't produce the checkpoint hash the other nodes confirmed.

---

## Storage analysis: conversation records never need pruning

### What the directory stores per conversation

| Table | Rows | Data |
|---|---|---|
| `conversation_seals` | 1 | UUID + merkle_root (32B) + close_type + attestations + seal_date ≈ 57 bytes |
| `conversation_participation` | 2 | UUID + party_pseudonym (32B) × 2 ≈ 96 bytes |
| MMR leaf | 1 | leaf_index + mmr_position + seal_merkle_root (32B) + leaf_hash (32B) + recorded_at ≈ 80 bytes |
| MMR internal nodes (amortized) | ~1 | position + hash (32B) ≈ 40 bytes |

**~273 bytes of data per conversation.** With PostgreSQL row overhead (~23 bytes × 4 rows ≈ 92 bytes): roughly **365 bytes per conversation**.

| Scale | Storage |
|---|---|
| 1 million conversations | ~365 MB |
| 10 million conversations | ~3.6 GB |
| 100 million conversations | ~36 GB |

There is no storage pressure to prune conversation records from the directory. The append-only property is practical, not just a security feature.

The open item in the persistence-layer-design — "Conversation tree retention — how long clients hold full Merkle trees" — is a **client-side** concern only. The directory's seal + participation record is a permanent ~365-byte summary. The client holds the full per-conversation tree (all message hashes, internal nodes). Even that is small (a few KB per conversation), but client-side retention policy is a separate question about how long clients keep dispute-eligible evidence.

---

## Schema changes summary

| Current | Replacement |
|---|---|
| `conversation_proof_log` (hash chain) | `conversation_proof_leaves` + `conversation_proof_mmr_nodes` (MMR) |
| `directory_checkpoints.conversation_merkle_root` (single hash) | `directory_checkpoints.mmr_peaks` (array of peak hashes) + `mmr_leaf_count` |
| No identity tree schema | `identity_tree_leaves` + `identity_tree_nodes` |
| No staging table | `conversation_seal_staging` (ephemeral, cleared per checkpoint) |

---

## Open items

- **ML-DSA security level** — ML-DSA-44 vs ML-DSA-65 not yet decided (from quantum resistance discussion); does not affect MMR structure but affects signature sizes in connection packages
- **Checkpoint interval tuning** — how frequently checkpoints are published; affects temporal resolution of inclusion proofs and batch size
- **Identity tree rebalancing** — strategy for new agent registrations in the sparse Merkle tree; static depth vs. dynamic
- **Notification events in the MMR** — standalone notification hashes are currently not in any Merkle structure; should they be included in the proof ledger?
- **Multi-party conversation support** — the `conversation_participation` table already supports N rows per conversation, but `conversation_seals` has hardcoded `party_a_attestation` / `party_b_attestation` columns that must change for group conversations (see separate discussion log)

---

## Related Documents

- [[end-to-end-flow|CELLO End-to-End Protocol Flow]] — §2.1 (directory as append-only log, two separate trees, fabricated conversation defense), §2.4 (checkpoint mechanism), §2.5 (client-side Merkle proof verification), §9 (dispute resolution and the meta-Merkle tree as tiebreaker)
- [[2026-04-11_1700_persistence-layer-design|Persistence Layer Design]] — the `conversation_proof_log` schema this design replaces; `conversation_seals` and `conversation_participation` tables; `directory_checkpoints` and `checkpoint_node_signatures` tables; the "conversation tree retention" open item resolved here for the directory side
- [[2026-04-08_1430_protocol-strength-and-commerce|Protocol Strength and Commerce]] — where the fabricated conversation attack and meta-Merkle tree defense were first identified
- [[2026-04-08_1530_message-delivery-and-termination|Message Delivery and Termination]] — the per-conversation Merkle tree that produces the `seal_merkle_root` consumed by the MMR
- [[2026-04-08_1700_node-architecture-and-replication|Node Architecture and Replication]] — federation model, primary/backup replication, and checkpoint mechanism that the distributed MMR construction builds on
- [[cello-design|CELLO Design Document]] — the original architecture; §2 (identity), §7 (Merkle tree), and the federation section
- [[design-problems|Design Problems]] — Problem 8 (ML model supply chain) for comparison: both involve integrity-pinned third-party artifacts; the library trust reasoning parallels the hash-pinning approach here
- [[2026-04-13_1100_quantum-resistance-design|Quantum Resistance Design]] — ML-DSA security level choice affects signature sizes but not MMR structure
- [[2026-04-13_1200_discovery-system-design|Discovery System Design]] — Class 3 group conversations require multi-party seals; the MMR consumes seals regardless of participant count
- [[2026-04-14_1100_cello-mcp-server-tool-surface|CELLO MCP Server Tool Surface]] — `cello_close_session` seals into the MMR; the `mmr_peak` return value exposes proof ledger state to the agent
