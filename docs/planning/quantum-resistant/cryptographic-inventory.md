---
name: Quantum-Resistant Migration — Cryptographic Inventory
type: research
date: 2026-06-28
topics: [cryptography, post-quantum, quantum-resistance, ed25519, frost, ml-dsa, ml-kem, x25519, security, migration]
status: draft
description: Complete inventory of every cryptographic technique used across the CELLO codebase, sorted by quantum exposure, with file-level evidence and a prioritized post-quantum (PQC) migration roadmap.
---

# Quantum-Resistant Migration — Cryptographic Inventory

> **Purpose.** This document is the starting point for CELLO's post-quantum cryptography (PQC) research. It catalogs every cryptographic technique currently employed, where it lives, what it protects, and whether a cryptographically-relevant quantum computer (CRQC) breaks it. It exists so the migration to quantum-resistant equivalents can be planned against a complete, evidence-backed picture rather than guesswork.

## How to read this document

Cryptographic primitives fall into two quantum-threat classes:

- **Shor's algorithm** breaks all discrete-log / elliptic-curve / factoring-based cryptography **completely**. Every digital signature and key-exchange primitive in CELLO is in this class. These are the items that require true PQC *replacements*.
- **Grover's algorithm** gives only a quadratic speedup against symmetric ciphers and hash functions — it *halves* effective bit-strength. These are fixed by *sizing* (e.g. AES-256 stays safe; SHA-256 keeps 128-bit collision margin), not by replacing the algorithm.

Everything below is sorted into those buckets:

- 🔴 **Tier 1 — Quantum-BROKEN (Shor):** needs a PQC replacement.
- 🟡 **Tier 2 — Quantum-WEAKENED (Grover):** review sizing; mostly retained.
- 🟢 **Tier 3 — Not directly affected:** inventory for completeness.

### Scope note

This inventory was produced against the **`trustless-cello`** repository (server-side: directory node, relay node, operations agent, e2e tests, infrastructure). The client-side cryptography package **`@cello-protocol/crypto`** and the transport package **`@cello-protocol/transport`** are maintained in the separate **`cello-client`** repository. Their *usage* and *imports* are confirmed here (`buildMerkleTree`, `verify`, `mlDsaKeygen`, `ed25519_FROST`, the `KeyProvider` abstraction, etc.), but their *implementations* were not directly read. **The PQC migration spans both repositories**, and per the project's cross-repo rules, any change to the five published `@cello-protocol/*` packages requires the full version-bump cascade.

---

## Headline finding: a PQC signature scaffold already exists

CELLO is **not greenfield** for post-quantum signatures. **ML-DSA-44 (NIST FIPS 204)** is already wired into the type system and test surface:

- `FakeMlDsaKeyProvider` test stub — `packages/test-fixtures/src/index.ts` — `sign() = HMAC-SHA256(seed, msg)` padded to **2420 bytes**; `getPublicKey() = SHA-256(seed)` padded to **1312 bytes**.
- Constants `ML_DSA_PUBKEY_BYTES = 1312`, `ML_DSA_SIGNATURE_BYTES = 2420` in `protocol-types`.
- Registration responses and endorsements already carry an `ml_dsa_pubkey` field (`packages/e2e-tests/src/__tests__/mcp-003-e2e.test.ts`, `connreq-002-session-006-e2e.test.ts`).
- `mlDsaKeygen` exported from `@cello-protocol/crypto`.
- The `IThresholdSigner` abstraction exists **explicitly** (per `CONTEXT.md`) so that threshold ML-DSA can swap in without changing the protocol layer.

**Implication.** The wire formats, registration payloads, and threshold-signer interface were deliberately built to *receive* ML-DSA. The migration is therefore less "design from scratch" and more "replace stubs with real ML-DSA implementations and wire the threshold variant." The real (non-stub) depth of this scaffolding must be confirmed in `cello-client`.

---

## 🔴 Tier 1 — Quantum-BROKEN (Shor). Require PQC replacements.

These are the load-bearing identity, authenticity, and confidentiality primitives. Every one is elliptic-curve / discrete-log based and falls completely to a CRQC.

| # | Technique | Where | Used for | PQC direction |
|---|-----------|-------|----------|---------------|
| 1 | **Ed25519** signatures (RFC 8032) | `@noble/curves/ed25519`; `K_local`, `identity_key`; `directory.ts:42,150`; `directory-node.ts:168,815-831`; envelope signing via `KeyProvider` | Every signed envelope, message authenticity, Structure-1 leaf signatures, node identity | **ML-DSA** (FIPS 204) / **SLH-DSA** (FIPS 205) |
| 2 | **FROST threshold signatures** (RFC 9591) over edwards25519 | `ed25519_FROST` (`@noble/curves`); `frost-handler.ts:78-79`; `directory-node.ts:896-1185`; `K_server_X` shares, `primary_pubkey` | Session establishment + conversation seal — the **sovereign-node threshold invariant itself** | **Threshold ML-DSA** via the existing `IThresholdSigner` seam. Hardest problem — no standardized threshold lattice scheme yet (track NIST IR 8214C). |
| 3 | **FROST DKG** (distributed key generation) | `frost-dkg-frames.ts` (3-round ceremony on `/cello/frost/1.0.0`); `directory-node.ts:1109-1180` | Generating split `K_server_X` shares with no trusted dealer | PQC DKG — research-stage; coupled to #2 |
| 4 | **Ed25519 consortium manifest signing** (t-of-n, 3-of-5 at Alpha) | `e2e-tests/src/spine/auth-manifest.ts:25-111`; consortium root keys embedded in client binary; `directory.ts:841-848` | The **trust anchor** for the entire directory-authentication chain (TUF-aligned manifest) | ML-DSA or SLH-DSA. **Root keys are compiled into the binary** → algorithm change forces a client release. In-band rotation helps the *key*, not the *algorithm*. |
| 5 | **Ed25519 directory/relay node keys** | `node-private-key` secret; `manifest-signer-pubkey` SSM; `relay-pool-manager.ts`; `directory-node.ts:694` (relay registration verify) | Node identity, relay pool manifest signatures | ML-DSA / SLH-DSA |
| 6 | **X25519 ECDH inside libp2p Noise (XX)** | `@chainsafe/libp2p-noise` (`relay/src/index.ts:96`, `connectionEncrypters: [noise()]`); `@libp2p/crypto` Peer ID keypair | Transport-layer session-key agreement + transport peer authentication (all agent↔directory, agent↔relay, inter-node) | **Harvest-now-decrypt-later** target. Needs a PQ/hybrid KEM (**ML-KEM**, FIPS 203) Noise variant — **gated on the libp2p ecosystem**, longest lead time. |
| 7 | **X25519 ECDH content sealing** | `e2e-tests/src/spine/content-seal-fixture.ts:16,26-42` (Ed25519→Montgomery per RFC 7748 §4.1; `x25519.getSharedSecret`; ephemeral X25519) | End-to-end content encryption to a recipient's key (independent of the Noise transport layer) | **ML-KEM** (FIPS 203). Partly in CELLO's own code → more migratable than the libp2p-gated #6. |
| 8 | **libp2p Peer ID keypair** (transport identity) | `@libp2p/crypto`; per-region transport keys (`openssl rand -hex 32`) | Per-session & directory-facing Peer IDs (Noise handshake auth) | Coupled to #6 / libp2p |
| 9 | **TLS at the ALB** (port 443, agent-facing) | `infra/cloudformation/cello-ecs-directory.yaml` (ACM cert, HTTPS/WebSocket termination); RDS/in-transit TLS | Agent↔directory channel confidentiality | TLS 1.3 **hybrid KEM** (X25519+ML-KEM) — depends on AWS ALB PQC support |

---

## 🟡 Tier 2 — Quantum-WEAKENED (Grover). Review sizing; mostly retained.

Grover gives at most a quadratic speedup, so these survive — audit that the post-halving margin is adequate. **Hash-based constructions are an asset here** (SLH-DSA is hash-based and quantum-safe), so the existing hash investment composes well with a conservative PQC fallback.

| # | Technique | Where | Used for | Action |
|---|-----------|-------|----------|--------|
| 10 | **SHA-256** application hash chain | `directory/src/hash-chain.ts:17,21-23,167-170` (`chain_hash = SHA-256(record ‖ prev)`, genesis `SHA-256("CELLO_CHAIN_GENESIS")`); chained tables at `hash-chain.ts:248-262` | Tamper-evidence for all append-only tables | 128-bit post-Grover collision margin — generally OK. Consider SHA-512/SHA-3 for headroom on new designs. |
| 11 | **SHA-256 Merkle tree / MMR** | `relay-node.ts:76,568-610` (`buildMerkleTree`, `merkleRoot`, `msgLeafHash`, `ctrlLeafHash`, `nodeHash` from `@cello-protocol/crypto`); `sealed root` | Per-conversation Merkle tree, sealed root, checkpoints | Same as #10 |
| 12 | **SHA-256 content / ack / id hashing** | `content-park.ts:87`; `relay-node.ts:697`; `directory.ts:241,964` (agent-id derivation); `pre-auth-token-repository.ts:140,413` (token chain) | Content addressing, relay-ack auth, agent-id derivation, token-consumption chain | Same |
| 13 | **HKDF-SHA256** (RFC 5869) | `content-seal-fixture.ts:17-18,42` — `hkdf(sha256, shared, ephPk, "cello-content-seal", 32)` | Derives the AES-256-GCM content key from the X25519 shared secret | Safe primitive, but **its input dies with #7** — the X25519 secret is the weak link, not HKDF |
| 14 | **AES-256-GCM envelope encryption** | `interfaces/src/stubs/local-envelope-key-provider.ts:47,103-132` (NIST SP 800-38D, 96-bit random nonce, AAD=keyId, 28-byte overhead) | Encrypting `K_server_X` shares at rest | AES-**256** → ~128-bit post-Grover → **adequate, no change needed** |
| 15 | **AES-256-GCM content encryption** | `content-seal-fixture.ts:19,44-50` (random IV per encryption) | Encrypting message content under the HKDF-derived key | Adequate; only the key-agreement step (#7) is at risk |
| 16 | **AWS KMS** (key rotation enabled) | `infra/cloudformation/cello-kms.yaml` (one master key per env per region; directory task role Decrypt/DescribeKey only) | Wrapping the envelope keys at rest | AWS-managed symmetric — quantum-safe; track KMS PQC roadmap |
| 17 | **SHA-256 OTP hashing + 128-bit salt** | `operations-agent/src/registration/otp.ts` (`SHA-256(otp‖salt)`, `randomInt`, `timingSafeEqual`) | Registration OTP storage + constant-time verification | Fine. Arguably should be a slow KDF regardless of quantum concerns. |
| 18 | **HMAC-SHA256** | `otp.ts`; `test-fixtures/src/index.ts:71` (fake ML-DSA signatures) | Message authentication / deterministic test signatures | Quantum properties track SHA-256 — no immediate risk |
| 19 | **SQLCipher** (client local DB at-rest) | referenced in `e2e-tests` spine tests; implementation in `cello-client` | Encrypting the operator's local SQLite DB (key shares, session state, history) | AES-based → quantum-safe; **audit the password→key KDF** |

---

## 🟢 Tier 3 — Not directly affected, inventoried for completeness

| # | Technique | Where | Note |
|---|-----------|-------|------|
| 20 | **CSPRNG** (`node:crypto` `randomBytes`, `randomInt`, `randomUUID`, `getRandomValues`) | throughout — nonces, salts, transport keys, ceremony/session IDs, officer seeds | Quantum-safe as-is, but it is the entropy source feeding every primitive above. NIST SP 800-90A. |
| 21 | **`timingSafeEqual`** constant-time comparison | `otp.ts:57-59` | Side-channel defense — orthogonal to quantum threat |
| 22 | **Pre-auth tokens** (`randomBytes(25)` → base58, rejection-sampled) | `pre-auth-token-repository.ts:61` | One-time DKG-ceremony auth gate — high-entropy random, not asymmetric → unaffected |
| 23 | **CBOR canonical encoding** (RFC 8949 §4.2.1) | `frost-dkg-frames.ts`; FROST TBS arrays | Not crypto, but it is the byte-canonicalization the signatures commit to. Any PQC migration **must preserve domain-separation context strings** (`cello-frost-session-establishment-v1`, `cello-frost-seal-v1`, `cello-content-seal`). |
| 24 | **WebAuthn / PIN portal login, magic links** | Account onboarding (`CONTEXT.md`); not fully implemented in the audited window | WebAuthn authenticators have their own PQC timeline (FIDO2) — flag for completeness |
| 25 | **Infra at-rest / network isolation** | RDS encryption (`cello-rds.yaml`), S3 SSE, Secrets Manager, VPC peering (ports 4001/5432), WAF (`cello-waf.yaml`) | At-rest = AES (safe). VPC peering / WAF are network controls, not cryptographic. In-transit TLS is the X25519-vulnerable surface (#9). |

---

## FROST to-be-signed (TBS) schemas — must be preserved across migration

Domain-separated context strings are the cross-ceremony confusion guard. A PQC migration changes the *signature algorithm* but must keep these contexts and field orderings intact (`directory-node.ts:86-88`, `CONTEXT.md`):

- **Session establishment** — context `"cello-frost-session-establishment-v1"`, 10 fields: `[session_id, agent_A_pubkey, agent_B_pubkey, genesis_prev_root, timestamp, initiator_session_peer_id, initiator_session_addrs_canonical, counterparty_session_peer_id, counterparty_session_addrs_canonical, transport_mode]`.
- **Conversation seal** — context `"cello-frost-seal-v1"`, 4 fields: `[session_id, sealed_root, leaf_count, timestamp]`.

A new signature scheme will need its own versioned context (e.g. `-v2`) if the field set or encoding changes, so that a PQC signature can never be confused with a classical one during a hybrid transition.

---

## Crypto library dependencies

| Library | Version | Purpose |
|---------|---------|---------|
| `@noble/curves` | 2.2.0 | Ed25519, Ed25519-FROST, X25519 — signatures & key exchange |
| `@noble/hashes` | 2.2.0 | SHA-256, HKDF-SHA256 |
| `@chainsafe/libp2p-noise` | ^17.0.0 | Noise XX transport security (wraps X25519) |
| `@chainsafe/libp2p-yamux` | ^8.0.1 | Stream multiplexing (non-crypto) |
| `@libp2p/crypto` | ^5.0.0 | libp2p keypair & Peer ID derivation |
| `libp2p` | ^3.2.3 | Full libp2p stack |
| `node:crypto` | Node 24 LTS | `createHash`, `createHmac`, `createCipheriv` (AES-256-GCM), `randomBytes`, `randomInt`, `timingSafeEqual` |
| `@cello-protocol/crypto` | 0.0.7 | Ed25519 `KeyProvider`, FROST signing, Merkle ops, ML-DSA (`mlDsaKeygen`) — maintained in `cello-client` |

**Candidate PQC library:** `@noble/post-quantum` (ML-DSA / ML-KEM / SLH-DSA) shares the same audit lineage and pure-JS guarantee that `CONTEXT.md` cites as the reason `@noble/curves` was chosen — the natural fit for keeping the existing constraint.

---

## Prioritized migration roadmap

Ordered by a combination of criticality, lead time, and migratability.

1. **Threshold ML-DSA (replaces FROST, items #2–#3) — critical path, hardest.**
   It is the heart of the sovereign-node invariant. There is **no standardized threshold lattice signature scheme yet** — this is the long-pole research item. The `IThresholdSigner` abstraction is the designed seam; start here. Track NIST IR 8214C (threshold cryptography).

2. **ML-KEM for both X25519 sites (#6, #7) — harvest-now-decrypt-later exposure.**
   - **Content sealing (#7)** is partly in CELLO's own code → more migratable; do this first of the two.
   - **Noise transport (#6)** is **gated on the libp2p ecosystem** (needs a PQ/hybrid Noise pattern). Longest external lead time — open this dependency thread early.

3. **ML-DSA for single signatures (#1, #4, #5) — likely the quickest win.**
   FIPS 204 is a clean drop-in, and the **ML-DSA scaffold already exists** in the type system and tests. Swap `FakeMlDsaKeyProvider` for a real implementation; wire `mlDsaKeygen` into the live `KeyProvider`/`SigningKeyProvider`.

4. **Manifest + consortium root keys (#4) — plan the release/rotation strategy now.**
   The algorithm change forces a **client-binary release** because root keys are compiled in. Design a hybrid (dual-signature) manifest and a rotation path before committing.

5. **Hash/symmetric sizing review (#10–#19) — low effort, do opportunistically.**
   AES-256-GCM and SHA-256 are retained. Optionally adopt SHA-512/SHA-3 for *new* hash-chain/Merkle designs to widen the post-Grover margin; verify SQLCipher's password→key KDF.

### Quantum-safe today (no replacement needed)

AES-256-GCM (envelope + content), SHA-256 (pre-image use: hash chain, OTP, content addressing), HMAC-SHA256, HKDF-SHA256 (the primitive — not its X25519 input), CSPRNG output, KMS-wrapped symmetric keys, SQLCipher at-rest (pending KDF audit).

---

## Open questions / verification needed

These items could not be confirmed from the `trustless-cello` repo alone and should be resolved before planning commits:

1. **Real vs. stub ML-DSA depth.** Confirm in `cello-client` whether `@cello-protocol/crypto` ships a real FIPS 204 implementation or only the `FakeMlDsaKeyProvider` stub, and where `ml_dsa_pubkey` is actually consumed/verified (vs. merely carried).
2. **Secrets Manager KDF.** The claim that AWS Secrets Manager uses PBKDF2 internally is an assumption about AWS internals, not repo evidence — do not rely on it.
3. **Client-side crypto inventory.** `@cello-protocol/crypto` and `@cello-protocol/transport` implementations (Ed25519 signing internals, Merkle hashing, manifest verifier, X25519 sealing) live in `cello-client` and were inventoried by *usage* only here.
4. **ALB / RDS PQC support.** Confirm the AWS roadmap for hybrid-KEM TLS 1.3 termination before depending on it for #9.

---

## References

- **RFC 8032** — Ed25519 (EdDSA)
- **RFC 9591** — FROST threshold Schnorr signatures + DKG
- **RFC 7748** — X25519 / Curve25519 (Montgomery)
- **RFC 5869** — HKDF
- **RFC 6234 / NIST FIPS 180-4** — SHA-256
- **NIST SP 800-38D** — AES-GCM
- **NIST SP 800-90A** — CSPRNG (DRBG)
- **NIST FIPS 203** — ML-KEM (Kyber) — PQC key encapsulation
- **NIST FIPS 204** — ML-DSA (Dilithium) — PQC signatures
- **NIST FIPS 205** — SLH-DSA (SPHINCS+) — hash-based PQC signatures
- **NIST IR 8214C** — threshold cryptography (tracking for threshold ML-DSA)
- Internal: `CONTEXT.md` (glossary, identity hierarchy, `IThresholdSigner`), `infra/cloudformation/cello-kms.yaml`
