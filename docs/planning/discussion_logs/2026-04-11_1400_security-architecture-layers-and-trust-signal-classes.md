---
name: Security Architecture Layers and Trust Signal Classes
type: discussion
date: 2026-04-11 14:00
topics: [security-architecture, system-layers, trust-signals, sybil-defense, prompt-injection, relative-signals, absolute-signals, PSI, enforcement, governance]
description: A four-layer system model and four-class trust signal taxonomy for CELLO's security architecture, with the key insight that network graph signals are structurally different from all other signals — relative rather than absolute.
---

# Security Architecture Layers and Trust Signal Classes

## The four-layer model

CELLO's security architecture has four distinct layers with distinct goals and distinct threat models. They are often conflated in the design document; separating them clarifies why each exists.

### Layer 1 — Transport and cryptography

libp2p, peer discovery, FROST split-key signing, Merkle trees, hash relay, directory infrastructure. The cryptographic substrate everything else is built on.

### Layer 2 — Node integrity

DDoS defense, Sybil resistance, farming detection, rate limiting, trust-weighted pool selection, relay node separation. Protects the **network** from structural attacks — attacks that attempt to manipulate the network's information or availability at scale.

### Layer 3 — Client protection

Prompt injection defense, content scanning, gate pyramid. Protects the **individual agent's reasoning** from content-level attacks. Different goal from Layer 2.

**The critical distinction:** A fully defended network with no client protection still lets a trusted sender manipulate a receiving agent through message content. Sybil defense does not prevent prompt injection. Prompt injection defense does not prevent Sybil attacks. These are orthogonal threat models. An agent can have a perfect identity, a long transaction history, and genuine endorsements from your contacts — and still send a message crafted to override your agent's instructions. Layer 3 exists because Layer 2 cannot cover this.

### Layer 4 — Trust signals

The four classes of signals used to evaluate the trustworthiness of a connection or agent (see below).

---

## The four trust signal classes

### Class 1 — Identity proofs

Who you demonstrably are. Subdivided:

- **Social**: phone OTP, SIM age scoring, LinkedIn, GitHub, Twitter/X, Facebook, Instagram. Account age, activity level, history.
- **Technical**: WebAuthn (hardware-bound credential), device attestation (TPM, Play Integrity, DeviceCheck), hardware binding.

### Class 2 — Network graph

Who do I know that knows you. Connection endorsements, just-in-time introductions, TrustRank distance to seed nodes.

### Class 3 — Track record

Degree of successful usage over time. Transaction history, session close attestations (CLEAN), dispute rate, time on platform. The pizza restaurant with 10,000 clean interactions.

### Class 4 — Economic stake

Bonds, connection staking, flat connection fees. Real capital at risk.

---

## The structural asymmetry: absolute vs. relative signals

Classes 1, 3, and 4 are **absolute signals** — they describe the agent in isolation. Given sufficient resources, they can be farmed at scale:

- Buy 1,000 aged SIM cards → manufactured Class 1 signals
- Run 50 agents in round-robin transactions → manufactured Class 3 signals
- Post $50,000 in bonds → manufactured Class 4 signals

Class 2 is a **relative signal** — it only means something in relation to the specific checking party. It cannot be evaluated in isolation.

When Charlie checks whether Alice has endorsers he knows, the question is not "does Alice have endorsements?" (absolute) but "does Alice have endorsements from people in *my specific contact graph*?" (relative). An attacker can manufacture 1,000 endorsers — but they cannot manufacture overlap with Charlie's contact graph without either:

1. **Actually knowing people Charlie knows** — which requires real relationships with his specific network, costly in a fundamentally different way than buying SIM cards
2. **Compromising Charlie's specific contacts** — which changes the threat model entirely; now you're defending against a targeted attack on one person's circle, not a mass Sybil operation

The asymmetry is structural: the attack surface for Class 2 scales with the **target's specific social context**, not with the attacker's resources. An unlimited budget buys enough phone numbers, enough transaction volume, and enough bond capital. It cannot buy overlap with a particular person's actual contact graph.

### Why PSI is essential to this property

Without PSI, the intersection check — "which of Alice's endorsers are in Charlie's contact list?" — requires one party to expose their full set to the other. An attacker making a connection attempt could use even a refused connection to harvest Charlie's full contact graph, then go manufacture endorsements from exactly those people. The relative property of Class 2 would be neutralized: the attacker probes once, learns the target, manufactures the right endorsements.

PSI is what makes the relative property unexploitable. The intersection check happens without either party learning the other's unmatched entries. A failed connection attempt teaches the attacker nothing about whose endorsement would succeed with Charlie. The target's graph remains opaque. The attacker cannot even learn who to target — they must manufacture endorsements from random people and hope for intersection, which makes the attack scale like a random walk through the real social graph rather than a surgical operation.

**TrustRank and the limits of absolute-but-anchored signals:**

TrustRank occupies an interesting middle ground. It is absolute (computed from a global reference set of seed nodes) but anchored against a fixed, attacker-can't-choose reference point. An attacker can try to get endorsed by a seed node — but seed criteria are strict and the set is monitored. This is harder than manufacturing arbitrary endorsements, but it is still categorically different from Class 2: it doesn't depend on the *checking party's* specific graph. Two people with very different contact graphs see the same TrustRank score for the same agent.

---

## The fifth layer: enforcement and governance

The four layers above describe *how the system works mechanically*. There is an argument for a fifth layer — but it is actually two distinct concerns being bundled.

### Layer 5a — Enforcement mechanisms

What happens when trust signals reveal a problem. Connection policies, progressive enforcement (rate limits, warnings, suspension), arbitration verdicts, tombstones, trust score penalties, voucher accountability, rate limits. This is the **consequences layer** — the system's response to violation.

This layer is substantially designed. It lives in the protocol as defined behaviors triggered by events in the other layers.

### Layer 5b — Protocol governance

Who controls the rules and how they change. Node admission to the consortium, voting on protocol parameter changes (thresholds, rate limits, penalty schedules), operator agreements, the process for evolving the protocol itself.

This is almost entirely undesigned. It is also the layer most affecting long-term trust in the system. A technically perfect protocol governed badly will fail — a controlling consortium that acts adversarially, changes economic terms, or excludes legitimate operators breaks the trust model at the foundation even if all the cryptography is correct.

Protocol governance is arguably the biggest architectural gap that is not currently in the 7 design problems. It is not a day-one concern — the Alpha phase is CELLO-operated and governance is simple — but it becomes critical before the Consortium phase.

---

## Why this framing improves on the 10-step architecture

The 10-step trust chain in the design document describes the **lifecycle** of a connection — registration, authentication, discovery, connection, conversation, and so on. It is the right structure for understanding what happens when.

This four-layer model describes the **security architecture** — what defends against what, and why. The two framings are complementary, not competing. For explaining the system to a developer building on it, the 10-step chain is correct. For explaining why the system is secure, or for auditing it, the layer model is more useful.

The key thing the layer model makes explicit that the lifecycle model doesn't: **you need all four layers because each addresses a threat the others cannot**. You can't collapse them.

---

## Related Documents

- [[end-to-end-flow|CELLO End-to-End Protocol Flow]] — the full protocol narrative; the four-layer model provides the organizing framework for understanding how its sections relate
- [[cello-design|CELLO Design Document]] — the 10-step architecture; complementary framing to the layer model here
- [[prompt-injection-defense-layers-v2|Prompt Injection Defense Architecture]] — Layer 3 (client protection) in full detail
- [[2026-04-11_1000_sybil-floor-and-trust-farming-defenses|Sybil Floor and Trust Farming Defenses]] — Layer 2 (node integrity) in full detail; the absolute vs. relative signal distinction explains why TrustRank alone is insufficient
- [[2026-04-10_1200_psi-for-endorsement-intersection|PSI for Endorsement Intersection]] — the mechanism that makes the relative property of Class 2 signals unexploitable; PSI is what prevents a failed connection attempt from leaking the checking party's contact graph
- [[2026-04-10_1000_connection-endorsements-and-attestations|Connection Endorsements and Attestations]] — Class 2 signals in full detail; the endorsement system is the practical implementation of the relative signal principle
- [[design-problems|Design Problems]] — the 7 open problems; protocol governance (Layer 5b) is a gap not currently listed there
