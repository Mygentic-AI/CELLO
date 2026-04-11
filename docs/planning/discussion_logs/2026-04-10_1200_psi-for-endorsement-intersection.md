---
name: Private Set Intersection for Endorsement Verification
type: discussion
date: 2026-04-10 12:00
topics: [PSI, private-set-intersection, endorsements, connection-policy, privacy, anti-farming, cryptography, zero-knowledge, whitelist]
description: Private Set Intersection (PSI) as the cryptographic mechanism for endorsement intersection computation at connection time — preventing contact list leakage without sacrificing verification.
---

# Private Set Intersection for Endorsement Verification

## The privacy leak in the current endorsement flow

The endorsement verification flow (see [[2026-04-10_1000_connection-endorsements-and-attestations|Connection Endorsements and Attestations]]) requires computing:

```
Charlie's contacts ∩ Alice's endorsers
```

Without a privacy-preserving mechanism, one of two things leaks:

- Alice reveals her **full endorser list** to Charlie — Charlie learns everyone who has ever endorsed Alice, including endorsers unrelated to this connection
- Charlie reveals his **full contact list** to Alice — Alice learns everyone Charlie knows

Either direction is a significant information leak. An attacker making a connection attempt could use a refused connection to harvest Charlie's full contact graph — then target those specific people for manufactured endorsements in a future attempt.

## Private Set Intersection

PSI lets two parties compute the intersection of their sets without either party learning anything about the other's set beyond the intersection itself.

**How it works at a high level:**

Agent A (Alice) hashes and cryptographically blinds her endorser keys, sends these to the facilitator (directory). Agent B (Charlie) hashes his contact keys, the facilitator checks blinded values against each other using OPRF (Oblivious Pseudorandom Function) or similar. Only matched keys are output — neither party learns the other's unmatched entries.

The directory facilitates the computation without learning either full set. It learns only that some intersection exists, not the size or contents beyond what it needs to route.

## Two PSI variants for two policy types

### PSI-CA (Cardinality only) — for threshold policies

Charlie's policy: "Accept if at least N agents I know have endorsed Alice."

PSI-CA reveals only the size of the intersection, not which specific agents matched. Charlie learns "3 of your endorsers are in my contact list" — not which 3. Alice learns nothing about Charlie's contact list.

This is the right fit for numeric threshold policies. Implementation cost is lower than full PSI.

### Full PSI — for content verification

Charlie's policy: "Accept if specific high-trust agents I know have endorsed Alice."

Full PSI reveals which agents are in the intersection, allowing Charlie to fetch and verify the actual endorsement content against the directory hash. Charlie can confirm the endorsement was signed by a specific known agent, check the optional context string, and verify the timestamp.

Both variants belong in the client policy toolkit. The endorsement policy setting (see Step 6 of the design document) determines which variant the client uses.

## Directory as PSI facilitator

The directory is a natural PSI server for this computation. It already holds endorsement hashes — it does not need to learn full contact lists to facilitate the intersection.

**Protocol sketch:**

```
Alice prepares connection request
  → Alice's client sends blinded hashes of her endorsers to the directory

Charlie receives connection request
  → Charlie's client sends blinded hashes of his contact list to the directory

Directory runs PSI computation
  → Outputs only intersection hints (matched hashes, or just cardinality for PSI-CA)
  → Discards all inputs after computation — not stored
  → Neither party's full set is retained

Charlie's client receives intersection result
  → Evaluates against configured policy (threshold count, or specific verified agents)
  → Accepts or declines
```

The directory learns that a connection attempt occurred and that some intersection exists. It does not learn Charlie's full contact list or Alice's full endorser set. This is consistent with the hash-everything-store-nothing principle — the PSI inputs are transient, never persisted.

## How PSI stacks with asymmetric whitelist knowledge

These two mechanisms address the same attack at different stages:

**Asymmetric whitelist knowledge** (see [[2026-04-10_1100_fallback-downgrade-attack-defense|Fallback Downgrade Attack Defense]]) — the client does not track whose whitelist it is on. An attacker who has compromised a machine cannot learn who has listed the compromised agent, so cannot identify which agents to target for manufactured endorsements *before* making a connection attempt.

**PSI at connection time** — even during an active connection attempt, the intersection computation leaks nothing about Charlie's contact list. A failed connection attempt teaches Alice (or an attacker) nothing about who Charlie knows, preventing post-attempt intelligence gathering.

Together they close the attack at both stages:
- Before the attempt: can't learn who to target
- During the attempt: can't learn who Charlie knows even from a failed attempt

## What PSI does not solve

PSI prevents contact graph leakage. It does not prevent endorsement farming against the general network:

- An attacker can still attempt to acquire endorsements from randomly-targeted agents
- PSI makes targeted farming harder (no intelligence about which agents to target) but does not eliminate untargeted farming
- The direct anti-farming defenses remain the same-owner rule (protocol-level rejection) and closed-loop transaction detection (Problem 4, not yet designed)

PSI is a privacy layer stacked on top of the anti-farming rules — not a replacement for them.

## Implementation notes

PSI adds cryptographic complexity. This is not a day-one requirement.

**Priority order:**
1. The endorsement mechanism itself (pre-computed, hash-verified) — day one
2. PSI-CA for threshold policies — second phase, when endorsement policies are in production use
3. Full PSI for content-verified intersection — third phase, when more sophisticated per-agent policies are needed

**Candidate libraries:**
- Rust: `oprf` crate + custom PSI over it; or `private-join-and-compute`-style implementation
- The directory PSI facilitator fits naturally into the WebSocket server's existing request handling — PSI inputs arrive as structured JSON, computation runs server-side, intersection hints returned

The OPRF-based approach is preferred over homomorphic encryption for this use case — lower latency, lower computational cost, and sufficient privacy guarantee for contact-list intersection.

---

## Related Documents

- [[2026-04-10_1000_connection-endorsements-and-attestations|Connection Endorsements and Attestations]] — the endorsement verification flow this log extends with PSI; the intersection computation is where PSI slots in
- [[cello-design|CELLO Design Document]] — Step 6 (connection acceptance policies); PSI applies to the endorsement policy evaluation
- [[2026-04-08_1930_client-side-trust-data-ownership|Client-Side Trust Data Ownership]] — hash-everything-store-nothing principle; PSI inputs follow the same transient, never-persisted pattern
- [[2026-04-10_1100_fallback-downgrade-attack-defense|Fallback Downgrade Attack Defense]] — asymmetric whitelist knowledge; PSI and this principle are complementary defenses against contact graph leakage
- [[design-problems|Design Problems]] — Problem 4 (trust farming); PSI makes targeted farming harder but closed-loop detection is still needed for the general case
- [[2026-04-11_1000_sybil-floor-and-trust-farming-defenses|Sybil Floor and Trust Farming Defenses]] — addresses untargeted farming that PSI does not cover: TrustRank, conductance scoring, diminishing transaction returns, closed-loop detection
