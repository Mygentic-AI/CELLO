---
name: Milestone Sequence Revision — M4 through M14
type: discussion
date: 2026-05-14 18:53
topics: [milestones, roadmap, persistence, production-infrastructure, operations-agent, portal, discovery, prompt-injection, sequencing, investor-visibility]
description: Confirms the revised milestone sequence inserting M4–M7 before the original milestones, dissolves the proposed M8 Security and Defense into M5, and pulls Discovery and Notifications forward to M8 for investor visibility. Records the reasoning behind each sequencing decision.
---

# Milestone Sequence Revision — M4 through M14

## The Revised Sequence

| Milestone | Name | Notes |
|---|---|---|
| M4 | Persistence | New — single node, federation deferred to M5 |
| M5 | Production Infrastructure | New — includes operational security |
| M6 | Operations Agent | New |
| M7 | Portal & Trust Signals | New |
| M8 | Discovery & Notifications | Was M5 — pulled forward |
| M9 | Prompt Injection Defense | Was M4 — pushed back |
| M10 | Social Trust | Was M6 |
| M11 | Compromise & Recovery | Was M7 |
| M12 | Group Rooms | Was M8 |
| M13 | Commerce | Was M9 |
| M14 | Federation | Was M10 |

---

## Decision: M4 Boundary — Single Node, No Federation

M4 delivers the persistence foundation on a single directory node. Multi-node replication and federation are deferred to M5.

**Why:** At Alpha all nodes are CELLO-operated on AWS. Federation at Alpha is PostgreSQL logical replication across 6 nodes — largely a configuration task. It belongs in M5 alongside the rest of the production deployment work, not in M4 which is about getting the schema, integrity guarantees, and encryption correct on a single node.

**Checkpoint cross-signing** across federation nodes is also deferred to M5 for the same reason — it requires live communicating nodes before it can be implemented and tested.

M4 delivers:

**Directory (single node):**
- PostgreSQL schema — all append-only tables with RLS enforcement (no UPDATE, no DELETE)
- Hash chain on every INSERT — application-layer implementation
- KMS envelope encryption for K_server_X shares
- pgaudit log shipping to external storage
- MMR tables and single-node construction
- Analytics cron job — materialized view refresh, graph edge table, clustering results (simple batch job against the existing database, runs on one node, results replicate via logical replication)

**Client:**
- SQLCipher with correct key derivation (`HKDF(private_key, "local-db-key", agent_id)`)
- Key provider abstraction with pluggable backends
- Encrypted cloud backup
- Agent hash queue as first-class protocol primitive
- Signed relay ACK storage

**Protocol correctness (co-located with M4):**
- Pre-seal reconciliation — gap-fill request from relay WAL, retry seal
- Relay WAL — per-session append-only crash-recovery file, destroyed after seal
- SEAL_UNILATERAL notification on reconnect

---

## Decision: Pre-Seal Reconciliation Absorbed into M4

Pre-seal reconciliation is a protocol correctness concern, not a persistence concern — but it belongs in M4 because:

1. It naturally exercises the relay WAL and client hash queue that M4 is building
2. It is a prerequisite for any real session to close correctly
3. The design is essentially complete — three clean cases, no new protocol machinery required

The three cases:
- **Both parties present, B is behind**: gap-fill from relay WAL, retry seal
- **B unreachable**: timeout, SEAL_UNILATERAL, notify B on reconnect
- **Both parties agree**: seal proceeds immediately

None require new protocol machinery beyond what already exists. The story is small and co-located with M4 without making M4 unwieldy.

---

## Decision: M8 Security and Defense Dissolved into M5

The proposed M8 "Security and Defense" milestone was intended to cover operational security infrastructure — CloudWatch, WAF, DDoS mitigation, rate limiting enforcement, secrets rotation, vulnerability scanning, certificate management. This is not a standalone milestone. These concerns are inseparable from production infrastructure — you cannot deploy production infrastructure without them. They belong in M5.

Prompt Injection Defense (the six-layer client-side scanning pipeline) is a separate, well-defined deliverable that was always M4 in the original sequence. It is not operational security infrastructure. Naming a milestone "Security and Defense" alongside it created a false overlap. With M8 dissolved, the naming confusion disappears.

---

## Decision: Discovery and Notifications Pulled Forward to M8

In the original sequence, Discovery and Notifications was M5. Prompt Injection Defense was M4. The revised sequence swaps them — Discovery and Notifications becomes M8 (immediately after Portal and Trust Signals), and Prompt Injection Defense becomes M9.

**Why:** Discovery and Notifications is the first milestone that produces something highly visible and immediately comprehensible to investors. An agent publishes a bio, a second agent searches and finds it, connects, and has a conversation — that is a complete product story. It demonstrates network effect potential directly.

Prompt Injection Defense is critical infrastructure but invisible in a demo. "Messages are safe from injection" does not land the same way. Pushing it to M9 — still well before Commerce (M13) and Group Rooms (M12), where it most matters — has no correctness consequences.

**The investor milestone:** By end of M8 the system has: peer-to-peer conversations (M0–M3), persistent identity and records (M4), production deployment (M5), operator onboarding via bot (M6), web portal with trust signals (M7), and discoverable agents that can find and connect to each other (M8). That is a demonstrable, fundable product.

---

## Related Documents

- [[implementation-roadmap|CELLO Implementation Roadmap]] — to be updated to reflect this sequence
- [[2026-05-13_1130_infrastructure-and-product-onboarding-alignment|Infrastructure and Product Onboarding Alignment]] — earlier session that first proposed inserting M4–M8 before the original milestones
- [[2026-05-13_1549_onboarding-and-operations-agent-architecture|Onboarding and Operations Agent Architecture]] — M6 Operations Agent scope
- [[2026-05-14_1702_relay-session-mechanics-and-recovery|Relay Session Mechanics and Recovery]] — relay WAL and pre-seal reconciliation design that informed the M4 boundary decision
