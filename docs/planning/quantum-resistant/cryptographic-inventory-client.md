---
name: Quantum-Resistant Migration — Cryptographic Inventory (cello-client)
type: research
date: 2026-06-28
topics: [cryptography, post-quantum, quantum-resistance, ed25519, frost, ml-dsa, ml-kem, x25519, security, migration, cello-client]
status: draft
description: Complete inventory of every cryptographic technique used in the cello-client packages (core/crypto, core/transport, core/client, core/daemon), sorted by quantum exposure, with file-level evidence and a prioritized PQC migration roadmap. Companion to cryptographic-inventory.md which covers the trustless-cello server/relay/infra side.
---

# Cryptographic Inventory — Quantum-Resistance Upgrade Targets (cello-client)

**Repository:** `cello-client` (`@cello-protocol/connect` and sibling `@cello-protocol/*` packages)
**Date:** 2026-06-28
**Purpose:** Build the complete inventory of cryptographic techniques currently employed by the
CELLO client so the team can plan post-quantum cryptography (PQC) replacements.

> This document is a planning artifact. It records *what exists today* and *which primitives are
> quantum-vulnerable*. It does not change any code. Migration design decisions are tracked separately.
> See [[cryptographic-inventory]] for the server-side (trustless-cello) inventory.

---

## The Threat Model in One Line

- **Shor's algorithm** breaks all classical *asymmetric* cryptography — digital signatures, key
  exchange, and public-key encryption. Every primitive in this category must be replaced with a PQC
  equivalent. **This is where the real work is.**
- **Grover's algorithm** halves the effective strength of *symmetric* cryptography and *hashing*.
  AES-256 → ~128-bit effective security (still safe). SHA-256 → ~128-bit preimage resistance (still
  safe). These primitives generally **do not need replacing** — the action item is to *confirm*
  256-bit key sizes and SHA-256-or-stronger digests.

---

## 🔴 Tier 1 — Quantum-Broken, MUST Upgrade (Asymmetric)

| # | Primitive | Location | Used For | PQC Target |
|---|-----------|----------|----------|------------|
| 1 | **Ed25519** signatures (RFC 8032) | `core/crypto/src/ed25519.ts`; verified in `core/crypto/src/manifest.ts`, `core/crypto/src/relay-registration.ts`, `core/daemon/src/session-relay-client.ts` | Agent identity key (K_local), all protocol message signing, consortium manifest threshold verification, relay self-registration | **ML-DSA** (FIPS 204) — *already prototyped in repo*; or SLH-DSA (FIPS 205) for a conservative stateless-hash option |
| 2 | **FROST threshold signatures** (RFC 9591, Ed25519) | `core/crypto/src/frost/frost-threshold-signer.ts`; DKG wire frames in `core/protocol-types/src/frost-dkg.ts` | Multi-party session establishment & seal signatures, distributed key generation (DKG) ceremony | **Hardest problem.** No standardized PQC threshold signature yet. Candidates: threshold ML-DSA (research-grade) or restructure to PQC multi-signature over ML-DSA |
| 3 | **X25519 ECDH** (RFC 7748) | `core/crypto/src/content-seal.ts` (`sealToRecipient` / `openSealed`) | Deriving the shared secret used to encrypt parked / store-and-forward content to a recipient | **ML-KEM** (FIPS 203, Kyber) used as a KEM → output fed into HKDF |
| 4 | **Noise XX handshake** (libp2p, X25519-based ECDH) | `core/transport/src/node.ts` (`@chainsafe/libp2p-noise`) | All transport-layer connection encryption (TCP, WebSocket, circuit-relay) | PQ-Noise / hybrid handshake — **dependent on libp2p upstream**, likely hybrid X25519 + ML-KEM |

### Notes per item

- **#1 Ed25519** is the highest-volume primitive: it is the agent's operational identity key
  (K_local), and it is the verification path for manifests and relay registration. The on-disk
  format and `KeyProvider` interface in `ed25519.ts` define the abstraction boundary the migration
  must preserve.
- **#2 FROST** is the genuinely hard research item. There is no NIST-standardized post-quantum
  threshold signature scheme as of this writing. Flag this early — it may require an architectural
  pivot rather than a drop-in swap, and the DKG wire frames (`frost-dkg.ts`) are part of the
  protocol surface.
- **#3 content-seal** is the cleanest swap: it is *already* a KEM-then-AEAD construction
  (ephemeral key → shared secret → HKDF → AES-GCM), so replacing X25519 with ML-KEM is a localized,
  well-contained change.
- **#4 transport Noise** is largely *not owned by this repo* — it tracks the libp2p ecosystem's PQ
  roadmap. The client is a consumer; plan to adopt a hybrid handshake when upstream ships it.

---

## 🟡 Tier 2 — Quantum-Weakened, Verify but Likely OK (Symmetric / Hashing)

| Primitive | Location | Status Under Grover |
|-----------|----------|---------------------|
| **AES-256-GCM** | `core/crypto/src/content-seal.ts`; `core/client/src/client-backup.ts`; `core/daemon/src/identity-migration.ts` (legacy decrypt) | 256-bit → ~128-bit effective. **Safe, no action.** |
| **AES-256-CBC** (SQLCipher 4) | `core/client/src/sqlcipher-client-store.ts` via `@signalapp/sqlcipher` | Safe, no action. Whole-DB encryption at rest. |
| **SHA-256** | `core/crypto/src/hashing.ts`, `core/crypto/src/checkpoint.ts`, `core/crypto/src/merkle.ts`, `core/crypto/src/relay-registration.ts`, multiple `core/daemon/src/*` TBS builders | ~128-bit collision resistance post-Grover. **Adequate.** Consider SHA-512 only if extra margin is desired. |
| **SHA-512** | `core/crypto/src/content-seal.ts` (Ed25519 seed → Montgomery scalar derivation) | Safe. |
| **HKDF-SHA256** (RFC 5869) | `core/client/src/db-key-derivation.ts`, `core/client/src/backup-key-derivation.ts`, `core/crypto/src/content-seal.ts` | Safe as a KDF. **Caveat:** in content-seal its *input* is an X25519 secret (Tier-1 vulnerable). |
| **AES-GCM auth tags / Poly1305-style MAC** | 128-bit GCM tags throughout AEAD usage | Safe. |
| **CSPRNG** (`randomBytes`, `x25519.utils.randomSecretKey`, `randomUUID`) | `core/crypto/src/ed25519.ts`, `core/crypto/src/content-seal.ts`, `core/client/src/client-backup.ts`, `core/crypto/src/frost/stubs.ts`, `core/daemon/src/identity-migration.ts` | Not quantum-affected. |

**Tier 2 action item:** audit *key sizes*, not algorithms. Confirm everything is 256-bit symmetric
and SHA-256-or-stronger. No algorithm replacement is required for quantum resistance here.

---

## 🟢 Already In Progress — Existing PQC Head Start

- **ML-DSA-44** (FIPS 204 / CRYSTALS-Dilithium, NIST security level 2) is **already implemented** in
  `core/crypto/src/ml-dsa.ts`, backed by `@oqs/liboqs-js` (Open Quantum Safe, WASM).
  - Full `keygen` / `sign` / `verify`.
  - `InMemoryMlDsaKeyProvider` and `FileMlDsaKeyProvider` (atomic persistence).
  - Defined on-disk format: magic `ce110d5341` (5 bytes) + version (1) + public key (1312) +
    secret key (2560) = 3878 bytes total. Signatures are 2420 bytes.
  - WASM singleton loading pattern with dynamic import.
  - Covered by tests in `core/crypto/src/__tests__/ml-dsa.test.ts`.
- This is the **reference implementation** for the rest of the PQC integration and the obvious
  replacement for Tier-1 item #1.
- **Open question:** Is ML-DSA-44 (level 2) the intended target, or should higher-value keys use
  ML-DSA-65 / ML-DSA-87 (levels 3 / 5)?

---

## Full Primitive Inventory by Category

### 1. Digital Signatures

- **Ed25519 (RFC 8032)** — `core/crypto/src/ed25519.ts`
  - `ed25519.getPublicKey(seed)`, `ed25519.sign(data, seed)`, `ed25519.verify(sig, data, pub)`.
  - `FileKeyProvider.load()/generate()` — key file at `~/.cello/key`, mode `0o600`.
  - Verification call sites: `manifest.ts` (consortium threshold), `relay-registration.ts`
    (relay self-registration), `session-relay-client.ts` (relay auth), `consortium-keys.ts`
    and `manifest-test-fixture.ts` (test seeds).
- **ML-DSA-44 (FIPS 204 / CRYSTALS-Dilithium)** — `core/crypto/src/ml-dsa.ts` (see "Already In
  Progress" above).

### 2. Threshold Signatures / Multi-Party

- **FROST / Ed25519 (RFC 9591)** — `core/crypto/src/frost/frost-threshold-signer.ts`
  - `ed25519_FROST.commit()` (round 1 nonces/commitments), `signShare()` (partial signature),
    `verifyShare()` (per-share verification), `aggregate()` (combine), `verify()`,
    `validateSecret()`.
  - `bootstrapKeyShares()` — test-only trusted-dealer DKG.
  - `verifyFrostSignature()` — standalone verification for counterparties.
  - Domain-separation context strings: `cello-frost-session-establishment-v1`,
    `cello-frost-seal-v1`.
  - DKG wire frames: `core/protocol-types/src/frost-dkg.ts` (`DkgRound1Broadcast` VSS commitment +
    proof-of-knowledge, `DkgRound2Share` 32-byte signing shares, `DkgRound3ResponseOk` group
    public key).
  - Test harness: `core/crypto/src/frost/stubs.ts` (`InProcessDirectoryNodeStub`).

### 3. Key Exchange / Key Agreement

- **X25519 (RFC 7748)** — `core/crypto/src/content-seal.ts`
  - `ed25519SeedToMontgomeryScalar()` (RFC 8032 §5.1.5 + RFC 7748 clamping),
    `edwardsPubToMontgomeryU()` (RFC 7748 §4.1), `x25519.getPublicKey()`,
    `x25519.getSharedSecret()` — ephemeral-static ECDH for content sealing.
- **Noise XX / ECDH** — `core/transport/src/node.ts`
  - `noise()` from `@chainsafe/libp2p-noise`; mandatory encryption, no plaintext fallback.
  - Uses a *separate* libp2p Ed25519 transport keypair (distinct from K_local — ADR-0001).

### 4. Asymmetric Encryption / Sealing

- **Recipient content sealed box (ECIES-like hybrid)** — `core/crypto/src/content-seal.ts`
  - Blob structure: `ephPk(32) || iv(12) || ct || tag(16)`; `CONTENT_SEAL_OVERHEAD_BYTES = 44`.
  - `sealToRecipient()`: Edwards→Montgomery conversion → ephemeral X25519 → ECDH → HKDF-SHA256 →
    AES-256-GCM.
  - `openSealed()`: reverse path; returns `null` on auth failure (fail-closed).
  - Relay never holds a decryption key (CELLO-M7-MSG-001).

### 5. Symmetric Encryption

- **AES-256-GCM (NIST SP 800-38D)**
  - Cloud backup: `core/client/src/client-backup.ts` — `createCipheriv("aes-256-gcm", ...)`,
    96-bit random nonce per backup, blob `[nonce(12)][auth_tag(16)][ciphertext]`.
  - Content sealing: `core/crypto/src/content-seal.ts` — 12-byte random IV, 16-byte tag.
  - Legacy identity migration: `core/daemon/src/identity-migration.ts` — `createDecipheriv`,
    legacy blob `[iv(12)][ct][tag(16)]`.
- **AES-256-CBC (SQLCipher 4)**
  - `core/client/src/sqlcipher-client-store.ts` via `@signalapp/sqlcipher` (replaced
    `@journeyapps/sqlcipher`, M6B-013). PRAGMA key format `x'<hexkey>'`.

### 6. Hashing

- **SHA-256 (FIPS 180-4)**
  - Merkle tree (RFC 6962): `core/crypto/src/hashing.ts` — `msgLeafHash` (`0x00`),
    `nodeHash` (`0x01`), `ctrlLeafHash` (`0x02`) prefix bytes for second-preimage resistance.
  - Relay ACK TBS, checkpoint TBS (`core/crypto/src/checkpoint.ts`), relay auth payload
    (`core/daemon/src/session-relay-client.ts`), relay registration TBS
    (`core/crypto/src/relay-registration.ts`), seal legibility TBS
    (`core/daemon/src/seal-legibility-tbs.ts`), session tree root
    (`core/daemon/src/session-tree.ts`).
- **SHA-512 (FIPS 180-4)** — `core/crypto/src/content-seal.ts`, Ed25519 seed derivation.

### 7. Key Derivation Functions

- **HKDF-SHA256 (RFC 5869)**
  - DB key: `core/client/src/db-key-derivation.ts` — `info = "local-db-key\x00{agentId}"`
    (PERSIST-009), also via `node:crypto` `hkdfSync`.
  - Backup key: `core/client/src/backup-key-derivation.ts` — `info = "backup-key\x00{agentId}"`
    (PERSIST-011); distinct info string prevents collision.
  - Content seal: `core/crypto/src/content-seal.ts` — `info = "cello-content-seal"`, salt =
    ephemeral public key.

### 8. Randomness (CSPRNG)

- `randomBytes` (from `@noble/hashes/utils.js` and `node:crypto`) — Ed25519 seeds, AES-GCM IVs,
  backup nonces.
- `x25519.utils.randomSecretKey()` — ephemeral X25519 secrets.
- `randomUUID()` — temp file naming during identity migration.

### 9. Message Authentication

- AES-256-GCM 128-bit authentication tags (content seal, backup, identity migration).
- CBOR-encoded structures are the exact bytes signed/verified by Ed25519:
  `core/daemon/src/session-relay-client.ts` — relay leaf
  `[1, content_hash(32), sender_pubkey(32), session_id(16), last_seen_seq, timestamp]`.

### 10. Supporting Constructs

- **Merkle trees (RFC 6962)** — `core/crypto/src/merkle.ts`; includes `constantTimeEqual()`
  XOR-based comparison to prevent timing side-channels.
- **Canonical serialization** — sorted-key JSON for manifests/checkpoints; CBOR (`cbor-x`) for
  relay structures.

---

## Cryptographic Libraries & Dependencies

| Library | Version | Provides |
|---------|---------|----------|
| `@noble/curves` | 2.2.0 | Ed25519 (RFC 8032), X25519 (RFC 7748), FROST (RFC 9591) |
| `@noble/hashes` | 2.2.0 | SHA-256, SHA-512, HKDF-SHA256, `randomBytes` |
| `@oqs/liboqs-js` | 0.15.1 | **ML-DSA-44 (FIPS 204) post-quantum signatures** (WASM) |
| `@signalapp/sqlcipher` | 3.3.5 | AES-256-CBC whole-DB encryption at rest |
| `@chainsafe/libp2p-noise` | 17.0.0 | Noise XX transport handshake |
| `@libp2p/crypto` | 5.0.0 | libp2p peer-id keypair generation |
| `@libp2p/peer-id` | 6.0.0 | Peer identity from keys |
| `node:crypto` | Node ≥ 24 | `createHash`, `createCipheriv`/`createDecipheriv` (AES-256-GCM), `randomBytes`, `randomUUID`, `hkdfSync` |

---

## Critical Files for the Migration

1. `core/crypto/src/ed25519.ts` — all Ed25519 signing/verification; the `KeyProvider` abstraction
   boundary. **(Tier 1 #1)**
2. `core/crypto/src/frost/frost-threshold-signer.ts` + `core/protocol-types/src/frost-dkg.ts` —
   threshold ceremony and DKG wire frames. **(Tier 1 #2, hardest)**
3. `core/crypto/src/content-seal.ts` — X25519 ECDH + HKDF + AES-GCM; cleanest KEM swap. **(Tier 1 #3)**
4. `core/transport/src/node.ts` — Noise handshake; tracks libp2p upstream. **(Tier 1 #4)**
5. `core/crypto/src/ml-dsa.ts` — existing ML-DSA-44 reference implementation. **(Tier 1 enabler)**
6. `core/client/src/client-backup.ts` — AES-256-GCM backup (Tier 2; verify key size only).

---

## Suggested Upgrade Ordering

1. **Ed25519 → ML-DSA** — largely scaffolded via `ml-dsa.ts`; finish wiring it through identity,
   manifest verification, and relay registration.
2. **X25519 content-seal → ML-KEM hybrid** — self-contained; the KEM-then-AEAD pattern already fits.
3. **Transport Noise → PQ/hybrid** — track libp2p upstream; the client is a consumer.
4. **FROST → PQC threshold** — research-grade open problem; budget the most time and decide early
   whether to keep a threshold scheme or pivot to PQC multi-signature.

---

## Open Decisions to Settle Before Research

- **Hybrid vs. PQC-only.** Concatenating classical + PQC (e.g., X25519 + ML-KEM, Ed25519 + ML-DSA)
  is the conservative industry default during transition and protects against PQC implementation
  flaws. Decide whether CELLO adopts hybrid or goes PQC-only.
- **Security level.** ML-DSA-44 (level 2) vs. ML-DSA-65 / ML-DSA-87 (levels 3 / 5); likewise
  ML-KEM-512 / 768 / 1024.
- **Wire format & version negotiation.** Larger PQC keys/signatures change every envelope and
  on-disk format. Plan version negotiation carefully given the project's strict publishing
  invariants (every `core/*` source change requires a package version bump and dependency-cascade
  republish).
- **FROST strategy.** Confirm whether a true post-quantum *threshold* signature is required, or
  whether the protocol can move to a PQC multi-signature aggregate.
