---
name: Node Architecture, Replication, and Client Routing
type: discussion
date: 2026-04-08 17:00
topics: [federation, nodes, FROST, threshold-signing, replication, consensus, latency, backup, primary-node, load-balancing]
description: Three-phase node deployment strategy, threshold signing parameters per phase, primary/backup replication topology, and client-side latency monitoring for dynamic routing.
---

# Node Architecture, Replication, and Client Routing

## Node pool and threshold — three phases

**Alpha (~6 nodes, CELLO-operated):**
All AWS, one per major region: North America, Europe, Middle East, India, two in Asia. Threshold ~4-of-6. Operational simplicity is the priority — all on one cloud provider, CELLO-operated. The threat model here is reliability, not sophisticated attackers.

**Consortium / Beta (~20 nodes, vetted operators):**
Multiple cloud providers (AWS + GCP + Azure), geographically distributed. Threshold ~11-of-20. Every operator is vetted, contracted, and audited. The threat model is a rogue or compromised operator. A majority threshold is appropriate when you know and trust the pool but not unconditionally.

**Public blockchain (50+ nodes, permissionless):**
Proof-of-stake collateral required to operate a node. Smaller rotating signing committee (~5-of-7) selected per operation. Security comes from economic stake and slashing, not quorum size. Extra nodes exist for geographic and provider redundancy, not for consensus strength. As the pool grows, the threshold per operation comes down.

**The key insight on thresholds:** as the pool grows, the threshold per operation comes down. More nodes = more redundancy. Security shifts from "we need a supermajority to agree" to "an attacker needs to compromise geographically dispersed nodes across different providers and jurisdictions, and loses their stake if caught."

## Where consensus is actually needed

FROST signing itself requires no consensus — just t partial signatures from any t of the n nodes. No nodes need to agree on anything; they just independently compute partial signatures.

Two things do require consensus:

1. **Directory state changes** — agent registrations, key rotations, trust score updates, tombstones. These are infrequent but must be consistent across all nodes. All nodes must process the same operations in the same order to arrive at the same state.

2. **Conversation hash ledger** — canonical sequence numbers for the global append-only ledger. Every message hash needs a canonical position. Ordering matters. This happens at message frequency.

These happen at very different speeds. Directory changes are occasional. Hash ordering happens on every message.

## Real-time vs. consensus paths are separate

The critical insight: agents never wait for consensus. The real-time path and the consensus path operate independently.

- **Real-time:** One primary node per session receives hashes, assigns sequence numbers, ACKs to agents. Fast. On the critical path.
- **Propagation:** Primary pushes hashes to other nodes asynchronously. Background. Not on the critical path.
- **Consensus:** Periodic checkpoint where nodes agree on ledger state. Happens in the background. Agents are unaffected.

## Primary + backup replication

To protect against primary failure before propagation:

- Agent simultaneously sends signed hash to the primary **and** 2-3 backup nodes at session establishment. Fire and forget to backups — no latency cost, agent does not wait for backup ACK.
- Backups store hashes tagged as **PENDING** — received, but no canonical sequence number yet.
- Primary propagates sequence numbers to backups. Backups update from PENDING to canonical.

**If primary fails before propagating:**
- Backups already hold all hashes — nothing is lost.
- One backup promotes to primary for this session.
- New primary sequences the accumulated PENDING hashes.
- Agents reconnect to the new primary and continue.
- No resubmission required from agents.

**Backup node selection is dynamic per session** — not fixed. The agent picks the 2-3 lowest-latency nodes at session establishment. Different conversations use different backup sets. Load spreads naturally across the pool without any central coordination.

## Client-side latency monitoring

Clients maintain persistent connections to all nodes and send lightweight status pings on a regular interval (10-30 seconds, configurable).

**Ping design:**
- Tiny packet — a timestamp out, a timestamp back, plus a single byte load indicator from the node.
- Negligible overhead even across 20 nodes at 30-second intervals.

**What the client does with it:**
- Maintains a live latency table for all nodes — current RTT and trend.
- Session establishment picks the currently fastest node as primary. No guessing, no cold starts.
- If primary latency trends up, the client migrates the session to a faster node proactively — before degradation becomes visible to the agent.

**Node self-regulation:**
- Nodes return a higher load indicator as they approach capacity.
- Clients naturally route new sessions to less-loaded nodes.
- Distributed load balancing with no central coordinator — each client makes the locally optimal choice, and the effect is globally distributed load.

---

## Related Documents

- [[cello-design|CELLO Design Document]] — Federated Directory section; three-phase node deployment and FROST signing described there
- [[open-decisions|Open Decisions]] — Decisions 1 (FROST), 3 (SHA-256), 4 (3-of-5 threshold), 12 (sequence number assignment) all resolved in this area
- [[00-synthesis|Protocol Review — Synthesis]] — Critical findings C1/C2 (split-key underspecification), High findings on threshold and node architecture
- [[design-problems|Design Problems]] — Problem 1 (fallback mode as downgrade attack) is the key unresolved problem in this space
- [[2026-04-10_1100_fallback-downgrade-attack-defense|Fallback Downgrade Attack Defense]] — relay node separation (connection nodes vs. relay nodes) directly extends the node architecture designed here
- [[2026-04-11_1400_libp2p-dht-and-peer-connectivity|libp2p, DHT, and Peer Connectivity]] — the transport layer (persistent bidirectional WebSocket) and connection setup (ephemeral Peer IDs, directory as signaling channel) for the persistent client-to-node connections this log designs around
- [[2026-04-11_1700_persistence-layer-design|Persistence Layer Design]] — extends this node architecture with PostgreSQL schema, append-only RLS enforcement, hash chain integrity, and the full federation replication strategy for all directory tables
