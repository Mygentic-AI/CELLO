---
name: Quantum Resistance Design
type: discussion
date: 2026-04-13 11:00
topics: [quantum-resistance, ML-DSA, FROST, split-key, cryptography, threshold-signatures, key-management, identity, connection-policy, liboqs]
description: Investigation and design decisions for quantum-resistant cryptography in CELLO — why FROST and ML-DSA are incompatible, the two-track approach, library choice, and connection package size implications.
---

# Quantum Resistance Design

## The problem

CELLO's session-level compromise canary depends on FROST (Flexible Round-Optimized Schnorr Threshold Signatures) — FROST ceremonies occur at session establishment and conversation seal, while individual messages are signed with K_local alone. FROST is built on elliptic curve cryptography, which is quantum-vulnerable: Shor's algorithm running on a sufficiently powerful quantum computer can recover a private key from a public key in polynomial time. When quantum computers of that capability exist, the FROST session authentication guarantee collapses.

The straightforward answer — replace EC signatures with ML-DSA (CRYSTALS-Dilithium, NIST FIPS 204) — doesn't work for FROST. Understanding why requires understanding what FROST is.

---

## Why FROST and ML-DSA are incompatible

### How FROST works

FROST exploits the linearity of Schnorr arithmetic. A Schnorr private key is a scalar — a big integer. Signing is linear arithmetic: addition and multiplication of that scalar. Because the math is linear, you can split the key into shares: Alice holds `x_1`, Bob holds `x_2`, and `x_1 + x_2 = x` (the full key). When signing, Alice computes her partial signature using her share, Bob computes his, they add the results, and the output is identical to signing with the full key — without either party ever learning `x`.

This works because the underlying group (elliptic curve over a prime field) has the algebraic structure needed for linear secret sharing. Split the key, compute partial signatures, add them together.

### Why ML-DSA breaks that trick

ML-DSA is built on lattice problems (Module Learning With Errors). The private key is not a scalar — it's a structured matrix of polynomials. More critically, the signing process includes a step called **rejection sampling**:

1. Sample a random vector `y`
2. Compute a commitment `w = A·y`
3. Compute challenge `c = H(msg, w)`
4. Compute `z = y + c·s` (where `s` is the private key)
5. **Check whether `z` is "short enough" — if not, throw everything away and retry with a new `y`**

The retry loop is what makes ML-DSA secure: it prevents `z` from leaking information about `s`. But in a threshold setting, this loop creates an unsolvable problem:

- Alice holds share `s_1`, Bob holds share `s_2`
- Each computes a partial `z`
- To check whether the combined `z` passes the rejection test, they need to see the combined value
- Seeing the combined value reveals information about each other's key shares

The rejection sampling step is non-linear and interactive in a way that breaks the "split the key, add the contributions" model FROST relies on. There is no simple equivalent of "add partial signatures together" in ML-DSA.

### Threshold ML-DSA — research state

Threshold ML-DSA schemes do exist. The most mature is a FIPS-204-compatible scheme via masked Lagrange reconstruction (see `threshold-mldsa.com`). It satisfies the core requirements — no participant ever reconstructs the full key, quantum-resistant — but requires multi-round MPC protocols significantly more complex than FROST.

Current state:
- Not standardized (NIST has no threshold ML-DSA standard yet)
- Research-grade implementations, not production-ready libraries
- Standardization timeline estimated at 5–7 years
- Signature sizes and transcripts are larger than FROST (~10–500 kB per signing transcript depending on party count)

---

## The two-track decision

Given that FROST cannot be replaced today and threshold ML-DSA is not ready, the design takes two parallel tracks:

**Track 1 — FROST (quantum-vulnerable, accepted debt)**

Used for: K_local + K_server threshold signing at session establishment and conversation seal — the compromise canary mechanism (compromise is detected when an attacker attempts a FROST session from a different source). Individual messages within a conversation are signed with K_local alone. FROST stays until threshold ML-DSA is production-ready, behind an abstracted interface so the swap is mechanical when the time comes.

**Track 2 — ML-DSA (quantum-resistant, deploy now)**

Used for: all non-threshold signatures — endorsements, attestations, directory certificates, pseudonym bindings, and connection package items. These don't require threshold properties. ML-DSA drops in directly.

### What uses which scheme

| Component | Scheme | Quantum-safe? | Rationale |
|---|---|---|---|
| Split-key signing (K_local + K_server) | FROST (Ed25519) | No | No viable threshold alternative exists |
| Endorsement records | ML-DSA | Yes | Simple signature, no threshold needed |
| Attestations | ML-DSA | Yes | Same |
| Directory certificates | ML-DSA | Yes | Same |
| Pseudonym binding | ML-DSA | Yes | Directory co-sign, single key |
| Connection package items | ML-DSA | Yes | Same |

Two-thirds of the signing surface is quantum-safe on day one. The remaining third carries documented quantum debt with a defined path to resolution.

---

## The abstraction interface

The threshold signing layer is abstracted behind an interface so the protocol never touches the underlying cryptography directly:

```
IThresholdSigner
  └── FrostThresholdSigner    ← day one (Ed25519 / Schnorr)
  └── ThresholdMlDsaSigner    ← future swap-in
```

Every call to threshold signing (session establishment and conversation seal) goes through `IThresholdSigner`. When threshold ML-DSA matures and a vetted implementation exists, `FrostThresholdSigner` is replaced with `ThresholdMlDsaSigner` — the protocol layer above it does not change.

This is not a hybrid scheme. The FROST path and the ML-DSA path are independent. No hybrid FROST + ML-DSA threshold layer: it would add complexity and operational overhead without meaningfully improving security given the quantum threat timeline.

---

## ML-DSA security level — not yet decided

ML-DSA comes in three security levels:

| Level | Equivalent security | Public key | Signature |
|---|---|---|---|
| ML-DSA-44 | 128-bit post-quantum | 1,312 bytes | 2,420 bytes |
| ML-DSA-65 | 192-bit post-quantum | 1,952 bytes | 3,293 bytes |
| ML-DSA-87 | 256-bit post-quantum | 2,592 bytes | 4,595 bytes |

128-bit post-quantum security (ML-DSA-44) is the accepted standard for new designs and is likely sufficient. ML-DSA-65 is more conservative. The choice between these has not been finalised — it depends partly on connection package size tolerance (see below) and partly on what becomes conventional in the ecosystem over the next year.

---

## Library choice

**liboqs / node-oqs** is the implementation to build and prototype against.

liboqs is maintained by the Open Quantum Safe project, implements FIPS 204 correctly, and is the most widely referenced open implementation in research and industry. The `node-oqs` bindings provide Node.js access.

The library is labelled "experimental" in OQS project documentation. This label means it has not gone through CMVP (FIPS-140-3) certification — not that the cryptographic implementation is unsound. Those are different questions.

**FIPS-140-3 validation is not a requirement for CELLO.** FIPS-140-3 is a compliance certification that matters for government contractors, financial institutions under specific regulation, and healthcare systems. CELLO is a peer-to-peer agent identity protocol. The relevant question is: does the library implement FIPS 204 correctly? The answer for liboqs is yes.

As of 2026, no FIPS-140-3 validated ML-DSA module exists in the Node.js ecosystem. AWS-LC, Bouncy Castle, and wolfSSL all have FIPS-140-3 validated modules but only for ML-KEM (key encapsulation), not ML-DSA (signatures) — key exchange has moved ahead of signatures in the validation pipeline. If CELLO ever needs to target clients with formal FIPS requirements, the path is to offload signing to a FIPS-validated service (AWS KMS-style) rather than block on a native Node.js module.

---

## Acknowledged quantum debt

The quantum vulnerability of FROST is documented, accepted, and has a defined resolution path.

**Why it is acceptable:**
- Cryptographically relevant quantum computers (capable of running Shor's algorithm on 256-bit EC keys) are estimated to be 10+ years away
- Threshold ML-DSA is expected to reach production readiness in 5–7 years — well ahead of the threat materialising
- The `IThresholdSigner` abstraction means the swap is a targeted implementation change, not a protocol redesign

**What would trigger a reassessment:** a meaningful advance in quantum hardware timelines, or a production-ready threshold ML-DSA implementation becoming available sooner than expected.

---

## Connection package size implications

The shift to ML-DSA for non-threshold signatures increases the size of the connection package Alice sends Bob at connection initiation. The following are **estimates** based on a typical well-verified agent (3 social verification blobs, 3 endorsements, 2 attestations, device attestation, pseudonym binding). Actual sizes will vary depending on the number of endorsements and attestations an agent has accumulated.

### Per-item sizes (estimated)

| Item | Ed25519 | ML-DSA-44 | ML-DSA-65 |
|---|---|---|---|
| Signature per signed item | 64 bytes | 2,420 bytes | 3,293 bytes |
| Endorsement (data + sig) | ~214 bytes | ~2,570 bytes | ~3,443 bytes |
| Attestation (data + sig) | ~364 bytes | ~2,720 bytes | ~3,593 bytes |
| Pseudonym binding (data + sig) | ~164 bytes | ~2,520 bytes | ~3,363 bytes |

### Typical package (3 social blobs, 3 endorsements, 2 attestations)

| Component | Ed25519 | ML-DSA-44 | ML-DSA-65 |
|---|---|---|---|
| Request envelope (FROST-signed) | ~340 bytes | ~340 bytes | ~340 bytes |
| Social verification blobs ×3 | ~600 bytes | ~600 bytes | ~600 bytes |
| Endorsements ×3 | ~642 bytes | ~7,710 bytes | ~10,329 bytes |
| Attestations ×2 | ~728 bytes | ~5,440 bytes | ~7,186 bytes |
| Device attestation (platform PKI) | ~1,500 bytes | ~1,500 bytes | ~1,500 bytes |
| Bio hash | 32 bytes | 32 bytes | 32 bytes |
| Pseudonym binding | ~164 bytes | ~2,520 bytes | ~3,363 bytes |
| **Estimated total** | **~4 KB** | **~18 KB** | **~23 KB** |

The social verification blobs and the FROST-signed request envelope carry no ML-DSA overhead — their integrity comes from hash comparison against the directory, not from attached signatures. Device attestation uses platform PKI (Apple/Google/TPM manufacturer), not ML-DSA. The ML-DSA overhead is concentrated on endorsements, attestations, and the pseudonym binding.

**18–23 KB is the size of a very light web page.** This is a one-time cost paid at connection establishment, not a per-message overhead. During an active conversation, only 32-byte SHA-256 hashes travel to the directory. The size increase is real and worth noting in the protocol design, but it is not a performance concern.

The ML-DSA security level (44 vs 65, i.e., 18 KB vs 23 KB) has not been decided. The 5 KB difference is unlikely to be the deciding factor — the choice will track what becomes conventional in the post-quantum ecosystem as FIPS 204 adoption matures.

---

## Related Documents

- [[cello-design|CELLO Design Document]] — Step 2 (identity and trust enrichment) and §2.3 (FROST signing) where the cryptographic primitives this log addresses are specified
- [[end-to-end-flow|CELLO End-to-End Protocol Flow]] — §1.2 (trust enrichment), §2.3 (FROST signing mechanics), and §5 (connection package contents whose sizes are estimated above)
- [[2026-04-11_1700_persistence-layer-design|Persistence Layer Design]] — the connection package schema; endorsed records, attestations, and pseudonym bindings are the ML-DSA-signed items in the size estimates
- [[design-problems|Design Problems]] — Problem 8 (ML model supply chain) for comparison: both involve a third-party artifact with integrity pinning; the supply chain thinking there parallels the library trust reasoning here
- [[2026-04-13_1400_meta-merkle-tree-design|Meta-Merkle Tree Design]] — ML-DSA security level choice (undecided here) is tracked as an open item there; signature sizes don't affect MMR structure but affect connection package estimates
- [[2026-04-15_0900_session-level-frost-signing|Session-Level FROST Signing]] — FROST remains for session/seal; scope of quantum debt narrowed to session boundaries (not per-message)
- [[2026-04-15_1100_key-rotation-design|Key Rotation Design]] — K_server rotation uses the same FROST DKG infrastructure and IThresholdSigner abstraction designed here; per-agent K_server stores one share set per node
- [[agent-client|CELLO Agent Client Requirements]] — Part 1 implements the two-track signing model table and IThresholdSigner abstraction defined here; FrostThresholdSigner day-one, ThresholdMlDsaSigner future swap-in; ML-DSA via liboqs/node-oqs for all non-threshold artifacts
