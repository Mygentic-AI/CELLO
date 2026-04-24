---
name: Deprecate Trust Seeders and TrustRank
type: discussion
date: 2026-04-14 15:00
topics: [trust-seeder, TrustRank, sybil-defense, trust-signals, discovery, connection-policy, cold-start]
description: Removes the Trust Seeder role and TrustRank metric from the protocol. Trust Seeders add a privileged attack surface for a cold-start problem already solved by discovery and group rooms. TrustRank is a single propagated score that contradicts the signal-based trust model — it was never part of the design and should not be introduced.
---

# Deprecate Trust Seeders and TrustRank

## Context

Trust Seeders appear in [[2026-04-11_1400_security-architecture-layers-and-trust-signal-classes|Security Architecture Layers and Trust Signal Classes]] as the "bootstrap mechanism for Class 2 (network graph) signals," in [[2026-04-11_1700_persistence-layer-design|Persistence Layer Design]] with a full schema (registry, vouching, accountability, exponential backoff lockouts), and in [[2026-04-11_1000_sybil-floor-and-trust-farming-defenses|Sybil Floor and Trust Farming Defenses]] as the #1 priority defense.

TrustRank (propagated trust distance from seed nodes) appears throughout [[end-to-end-flow|End-to-End Flow]] (§1.5 Layer 0, described as "highest leverage, must be built early"), [[2026-04-11_1000_sybil-floor-and-trust-farming-defenses|Sybil Floor]] as a consensus #1 priority, and in [[design-problems|Design Problems]] as a recommended fix for Problems 3 and 4.

This log removes both. Neither was ever built. Both contradict design principles that have since solidified.

---

## Why Trust Seeders should be removed

### The cold-start problem is already solved

The original justification: new agents have no Class 2 (network graph) signals, so agents with endorsement-based connection policies reject them. Trust Seeders were supposed to provide the first Class 2 foothold.

But the [[2026-04-13_1200_discovery-system-design|discovery system]] already provides organic entry paths:

- **Class 2 bulletin listings** — agents post Craigslist-style ads; new agents can respond and transact
- **Class 3 group rooms** — new agents join multi-party conversations and demonstrate behavior publicly
- **Open connection policies** — some agents (especially institutions) accept connections based on Class 1 signals alone (phone verification, social accounts)

Through these paths, a new agent builds track record (Class 3) through proper behavior, earns endorsements from agents they've actually interacted with (Class 2), and accumulates a trust signal profile organically. The cold-start problem Trust Seeders were supposed to solve doesn't exist — it's solved by the discovery system and open connection policies.

### Trust Seeders have no special evaluative capability

If a Trust Seeder knows the person personally, they're just a regular endorser. The endorsement mechanism already handles this — no special role needed.

If a Trust Seeder doesn't know the person personally, they're evaluating the same signals the system already evaluates: social accounts, verification status, device attestation. They add no information that the signal blob doesn't already contain. They're a human doing what signal-based policy evaluation already does, but with less consistency and more attack surface.

A Trust Seeder is either a redundant endorser (for people they know) or a redundant signal evaluator (for people they don't).

### The role creates unnecessary attack surface

A nefarious actor with real aged social accounts, WebAuthn, and a real phone can meet the `FORMULA_QUALIFIED` criteria and become a Trust Seeder. Cost: maybe $200–500 in sacrificed social accounts. The accountability mechanism (exponential backoff lockouts) is reactive — it catches bad seeders after their nominees misbehave, not before. A patient attacker who vouches for agents that don't immediately misbehave can push many through before the first lockout triggers.

In exchange for this attack surface, we get a privileged role that requires governance infrastructure: a seeder registry, vouching logs, accountability events, lockout schedules, `MANUAL` vs. `FORMULA_QUALIFIED` paths, a pre-launch founding cohort with elevated endorsement weight. This is significant protocol complexity for something that provides no evaluative capability the system doesn't already have.

### What Trust Seeders actually provided was TrustRank anchor points

The real function of Trust Seeders in the design was to serve as seed nodes for TrustRank propagation. Without TrustRank (see below), the seeder role has no unique function.

---

## Why TrustRank should not be introduced

### CELLO does not have a single trust score

This is the fundamental issue. TrustRank is a single propagated number — "distance from verified seed nodes" — published per agent as a global metric. Every agent in the network sees the same TrustRank value for the same agent.

CELLO's trust model is signal-based, not score-based. Agents receive a trust signal blob: individual named signals (phone verified, WebAuthn, LinkedIn with N connections and M years, device attestation, conversation track record with X clean closes, endorsement count, etc.) with presence/absence and quality metadata. The receiving agent's connection policy evaluates these signals according to its own configured requirements. CELLO recommends default policy thresholds, but agents can change them to whatever they want.

There is no single number. There is no global score. `cello_verify` returns `SignalResult[]`. `SignalRequirementPolicy` specifies named signal requirements, not numeric thresholds. The [[2026-04-14_1100_cello-mcp-server-tool-surface|MCP tool surface]] explicitly states: "Trust is not expressed as a number."

TrustRank contradicts this by introducing exactly the kind of single propagated score the design deliberately avoids.

### TrustRank is an LLM hallucination artifact

TrustRank (the anti-spam variant of PageRank) keeps reappearing in design documents because it is a natural-seeming recommendation for any trust system. LLMs generating or contributing to design analysis will reliably suggest it. It appeared in the adversarial review synthesis ([[00-synthesis|day-zero-review]]), propagated into the Sybil defense analysis, the end-to-end flow, and the persistence layer.

It was never a design decision. It was never built. It should not be introduced.

### The Sybil defense it provided is handled by existing mechanisms

TrustRank's claimed value was: "Sybil clusters with no path to seed nodes get zero propagated trust regardless of internal activity." But this function is already covered by:

- **Conductance-based cluster scoring** — Sybil clusters transacting only with each other have near-zero external connectivity, which is directly measurable without any propagated score
- **Class 2 relative signals (PSI endorsement intersection)** — the question "does Alice have endorsers that I personally know?" cannot be gamed by manufacturing endorsements from arbitrary agents; the attacker needs actual overlap with the specific checking agent's contact graph
- **Counterparty diversity ratio** — `min(1, unique_counterparties / total_transactions)` directly penalizes closed-loop farming
- **Diminishing returns per counterparty** — `base_weight / ln(n + 1)` makes round-robin self-defeating

These mechanisms detect and penalize the same Sybil patterns TrustRank was supposed to flag, without requiring a global propagated score, seed nodes, or a privileged seeder role.

---

## What to remove

### Schema (from persistence layer design)

```
REMOVE: trust_seeders table
REMOVE: seeder_vouches table
REMOVE: seeder_accountability_events table
REMOVE: seeder_lockouts table
```

### Concepts

- Trust Seeder role (MANUAL and FORMULA_QUALIFIED paths)
- Trust Seeder registry and qualification criteria
- Seeder vouching and accountability (exponential backoff)
- Pre-launch founding cohort with elevated endorsement weight
- TrustRank distance metric
- TrustRank seed node selection
- "Distance to nearest seed" as a published per-agent integer
- TrustRank as Layer 0 of the Sybil defense stack

### Documents requiring updates

- [[end-to-end-flow|End-to-End Flow]] — §1.2 network-built signals table (remove TrustRank row), §1.4 trust score formula (remove references), §1.5 Layer 0 TrustRank section (remove entirely; renumber remaining layers), cold-start cohort references, Appendix trust score connections (remove TrustRank bullet)
- [[2026-04-11_1000_sybil-floor-and-trust-farming-defenses|Sybil Floor and Trust Farming Defenses]] — consensus finding (#1 priority is TrustRank), priority list, attack tier analysis (remove "TrustRank (no path to seeds)" from blocked-by lists), rich-get-richer mitigation section
- [[2026-04-11_1400_security-architecture-layers-and-trust-signal-classes|Security Architecture Layers and Trust Signal Classes]] — Class 2 section (remove Trust Seeder paragraphs), Layer 5a enforcement (remove exponential backoff for seeders), TrustRank middle-ground discussion
- [[2026-04-11_1700_persistence-layer-design|Persistence Layer Design]] — Trust Seeder status and accountability section (remove entirely), related document references
- [[design-problems|Design Problems]] — Problem 4 design work (remove TrustRank evaluation item), related document annotations
- [[cello-initial-design|CELLO Design Document]] — any Trust Seeder or TrustRank references in the architecture or related documents section
- [[00-synthesis|Protocol Review Synthesis]] — TrustRank recommendation in fix suggestions

---

## What remains

The Sybil defense stack without TrustRank or Trust Seeders:

1. **SIM age / carrier signals** — zero user friction, significant attacker cost increase
2. **Diminishing returns per counterparty** — makes farming self-defeating; pure formula
3. **Conductance-based cluster scoring** — catches insular farming clusters
4. **Device attestation** — zero friction when supported; raises per-identity cost
5. **Endorsement defenses** — rate limiting, weight decay, fan-out detection, social binding locks, liveness probing
6. **Temporal detection and dual-graph comparison** — time-signature anomalies, endorsement vs. transaction graph topology mismatch
7. **Optional refundable bond** — economic defense when payment infrastructure exists
8. **Incubation period** — 7-day rate limit for new agents

The cold-start path for new agents: discovery listings, group rooms, open connection policies, organic endorsements from actual interactions.

---

## Related Documents

- [[2026-04-11_1400_security-architecture-layers-and-trust-signal-classes|Security Architecture Layers and Trust Signal Classes]] — Class 2 section defines Trust Seeders and TrustRank middle-ground analysis; this log removes both
- [[2026-04-11_1700_persistence-layer-design|Persistence Layer Design]] — Trust Seeder registry, vouching, and accountability schema; this log removes those tables
- [[2026-04-11_1000_sybil-floor-and-trust-farming-defenses|Sybil Floor and Trust Farming Defenses]] — consensus finding names TrustRank as #1 priority; this log removes it and the remaining stack stands on its own
- [[end-to-end-flow|End-to-End Flow]] — §1.5 anti-Sybil architecture Layer 0 is TrustRank; this log removes it
- [[design-problems|Design Problems]] — Problems 3 and 4 reference TrustRank as a recommended fix
- [[2026-04-13_1200_discovery-system-design|Discovery System Design]] — the three-class discovery system that provides the organic cold-start path making Trust Seeders unnecessary
- [[2026-04-14_1100_cello-mcp-server-tool-surface|CELLO MCP Server Tool Surface]] — `cello_verify` returns `SignalResult[]` not a score; `SignalRequirementPolicy` uses named signal requirements; explicitly states "Trust is not expressed as a number"
- [[2026-04-10_1200_psi-for-endorsement-intersection|PSI for Endorsement Intersection]] — the Class 2 relative signal mechanism that provides the hard Sybil defense without TrustRank
- [[00-synthesis|Protocol Review Synthesis]] — original source of TrustRank recommendation
- [[frontend|CELLO Frontend Requirements]] — trust signal display uses named SignalResult[] not a numeric score; TrustRank UI is explicitly absent; the signal-based trust taxonomy drives the trust card design
