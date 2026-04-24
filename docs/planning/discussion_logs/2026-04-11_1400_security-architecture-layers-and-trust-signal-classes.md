---
name: Security Architecture Layers and Trust Signal Classes
type: discussion
date: 2026-04-11 15:00
topics: [security-architecture, system-layers, trust-signals, sybil-defense, prompt-injection, relative-signals, absolute-signals, PSI, enforcement, governance]
description: A four-layer system model and four-class trust signal taxonomy for CELLO's security architecture, with the key insight that network graph signals are structurally different from all other signals — relative rather than absolute.
---

# Security Architecture Layers and Trust Signal Classes

## The four-layer model

CELLO's security architecture has four distinct layers with distinct goals and distinct threat models. They are often conflated in the design document; separating them clarifies why each exists.

### Layer 1 — Transport and cryptography

libp2p, peer discovery, FROST threshold signing (session establishment and seal), K_local per-message signing, Merkle trees, hash relay, directory infrastructure. The cryptographic substrate everything else is built on.

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
- **Account security**: WebAuthn (hardware-bound login credential; phishing-resistant; proves the owner has a physical device but does not sacrifice it — one device can register WebAuthn credentials for many accounts).
- **Device sacrifice**: platform attestation (TPM on Windows, Play Integrity on Android, App Attest on iOS/macOS). Provides a stable device identifier that the directory enforces one-account-per-device against. Requires a native app — not available from a web browser. See [[2026-04-13_1000_device-attestation-reexamination|Device Attestation Reexamination]] for the full distinction.

### Class 2 — Network graph

Who do I know that knows you. Connection endorsements, just-in-time introductions.

> **Note:** TrustRank distance to seed nodes and the Trust Seeder role were originally part of this class but have been formally deprecated — see [[2026-04-14_1500_deprecate-trust-seeders-and-trustrank|Deprecate Trust Seeders and TrustRank]]. The cold-start problem they addressed is handled by the discovery system's group rooms, bulletin listings, and open connection policies.

**Vouching skin-in-the-game** is what gives Class 2 signals teeth. An endorsement that costs the endorser nothing is a weak signal — it degrades toward LinkedIn. The design includes accountability consequences for endorsers whose vouches turn out to be for bad actors: the voucher's ability to endorse is constrained, not their general network participation. This keeps the signal meaningful without making endorsing prohibitively risky for honest actors.

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

**Absolute-but-anchored signals (historical note):**

> TrustRank has been formally deprecated — see [[2026-04-14_1500_deprecate-trust-seeders-and-trustrank|Deprecate Trust Seeders and TrustRank]]. The analysis below is preserved as context for understanding why it was considered and why it was ultimately removed.

TrustRank occupied an interesting middle ground. It was absolute (computed from a global reference set of seed nodes) but anchored against a fixed, attacker-can't-choose reference point. An attacker could try to get endorsed by a seed node — but seed criteria are strict and the set is monitored. This was harder than manufacturing arbitrary endorsements, but still categorically different from Class 2: it didn't depend on the *checking party's* specific graph. Two people with very different contact graphs see the same TrustRank score for the same agent — which is why it contradicts the signal-based model and was removed.

---

## The fifth layer: enforcement and governance

The four layers above describe *how the system works mechanically*. There is an argument for a fifth layer — but it is actually two distinct concerns being bundled.

### Layer 5a — Enforcement mechanisms

What happens when trust signals reveal a problem. Connection policies, progressive enforcement (rate limits, warnings, suspension), arbitration verdicts, tombstones, trust signal penalties, voucher accountability, rate limits. This is the **consequences layer** — the system's response to violation.

This layer is substantially designed. It lives in the protocol as defined behaviors triggered by events in the other layers.

**Exponential backoff** for Trust Seeder accountability was part of this layer. The Trust Seeder role has been deprecated — see [[2026-04-14_1500_deprecate-trust-seeders-and-trustrank|Deprecate Trust Seeders and TrustRank]]. General voucher accountability (the 6-month lockout model from Step 9 of the design) remains active.

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

- [[2026-04-11_1400_libp2p-dht-and-peer-connectivity|libp2p, DHT, and Peer Connectivity]] — Layer 1 (transport and cryptography) in full detail; bootstrap discovery, ephemeral Peer IDs, three-layer NAT traversal, and dual-path hash relay vetted for technical feasibility
- [[2026-04-10_1100_fallback-downgrade-attack-defense|Fallback Downgrade Attack Defense]] — Layer 2 (node integrity) mechanism; relay node separation, trust-weighted pool selection, and degraded-mode policy
- [[2026-04-08_1900_connection-staking-and-institutional-defense|Connection Staking and Institutional Defense]] — spans Layer 2 (DDoS defense via staking) and Layer 3 (gate pyramid as the client-side filtering architecture); both layers in one mechanism
- [[2026-04-08_1800_account-compromise-and-recovery|Account Compromise and Recovery]] — Layer 5a (enforcement) in practice; tombstone types, voucher accountability, and recovery paths are the consequence layer operating on signals from all other layers
- [[end-to-end-flow|CELLO End-to-End Protocol Flow]] — the full protocol narrative; the four-layer model provides the organizing framework for understanding how its sections relate
- [[cello-initial-design|CELLO Design Document]] — the 10-step architecture; complementary framing to the layer model here
- [[prompt-injection-defense-layers-v2|Prompt Injection Defense Architecture]] — Layer 3 (client protection) in full detail
- [[2026-04-11_1000_sybil-floor-and-trust-farming-defenses|Sybil Floor and Trust Farming Defenses]] — Layer 2 (node integrity) in full detail; the absolute vs. relative signal distinction here explains why the remaining Sybil stack works without TrustRank
- [[2026-04-10_1200_psi-for-endorsement-intersection|PSI for Endorsement Intersection]] — the mechanism that makes the relative property of Class 2 signals unexploitable; PSI is what prevents a failed connection attempt from leaking the checking party's contact graph
- [[2026-04-10_1000_connection-endorsements-and-attestations|Connection Endorsements and Attestations]] — Class 2 signals in full detail; the endorsement system is the practical implementation of the relative signal principle
- [[design-problems|Design Problems]] — the 7 open problems; protocol governance (Layer 5b) is a gap not currently listed there
- [[2026-04-11_1700_persistence-layer-design|Persistence Layer Design]] — the four trust signal classes map directly to the persistence hierarchy: identity proofs (social verifications + device attestations), network graph (endorsements), track record (pseudonym model), and economic stake (financial schema)
- [[2026-04-13_1000_device-attestation-reexamination|Device Attestation Reexamination]] — corrects Class 1 Technical signals here: WebAuthn (account security / tethering) and device sacrifice (platform attestation) are distinct sub-classes with different Sybil-defense properties
- [[2026-04-14_0700_agent-succession-and-ownership-transfer|Agent Succession and Ownership Transfer]] — directly applies the four signal class taxonomy in its transfer table: Class 3 (track record) transfers if seed phrase available; Class 1 (identity proofs) and Class 2 (network graph) do not transfer because they are bound to a specific human, not the agent
- [[2026-04-14_1500_deprecate-trust-seeders-and-trustrank|Deprecate Trust Seeders and TrustRank]] — removes the Trust Seeder role and TrustRank metric defined here in Class 2 and Layer 5a; the cold-start problem is solved by discovery and group rooms, and TrustRank contradicts the signal-based trust model
- [[frontend|CELLO Frontend Requirements]] — the four trust signal classes (identity proofs, network graph, track record, economic stake) map directly to the trust card taxonomy and signal badge hierarchy in the frontend
