---
name: Quantum-Resistant Migration — Aggregate Inventory
type: research
date: 2026-06-28
topics: [cryptography, post-quantum, quantum-resistance, ed25519, frost, ml-dsa, ml-kem, x25519, security, migration]
status: draft
description: Unified, de-duplicated inventory of all cryptographic primitives across the full CELLO stack (client, directory, relay, ops-agent, infra). Aggregates cryptographic-inventory.md (server/relay) and cryptographic-inventory-client.md (cello-client). Working reference for the PQC migration — each item identifies which layers it touches, where the implementation lives, and what needs to change.
---

# Quantum-Resistant Migration — Aggregate Inventory

> **How to use this document.** This is the working reference for executing the PQC migration.
> It de-duplicates the server-side inventory ([[cryptographic-inventory]]) and the client-side
> inventory ([[cryptographic-inventory-client]]) into a single list. Each item identifies all the
> layers it touches — Client, Directory, Relay, Ops-Agent, or Infra — and where the implementation
> actually lives. Items that appear in both source inventories were merged; the overlapping
> call-site evidence is consolidated here.

## Library Selection Policy

> **Confirmed 2026-06-28 via Node.js Web Crypto API docs.** Node.js 24.7+ ships native ML-KEM
> and ML-DSA support in `SubtleCrypto` — no WASM, no external dependency, FIPS-adjacent
> platform implementation. Since CELLO already requires Node ≥ 24, this is the default choice
> for all new PQC primitives.

**Decision rule (in priority order):**

1. **`node:crypto` Web Crypto (`SubtleCrypto`)** — use for ML-DSA and ML-KEM. Native, no install
   overhead, no WASM load time. Specifically: `ML-DSA-44`, `ML-DSA-65`, `ML-DSA-87`,
   `ML-KEM-512`, `ML-KEM-768`, `ML-KEM-1024` are all supported via `generateKey`, `sign`,
   `verify`, `encapsulateKey`/`decapsulateKey`, `importKey`/`exportKey`.
2. **`@noble/post-quantum`** — fallback if Web Crypto is missing a needed operation or format.
   Same audit lineage as `@noble/curves` (already in use), pure JS, consistent API shape.
3. **Never implement crypto math.** Only write key provider adapters, on-disk formats, wire
   format serialization, version tags, and domain separation strings.

**Implication for `@oqs/liboqs-js`:** The existing ML-DSA implementation in `core/crypto/src/ml-dsa.ts`
uses `@oqs/liboqs-js` (WASM). This should be **replaced** with `node:crypto` Web Crypto during
the migration. Removing the WASM dependency reduces operator install time (CLAUDE.md: WASM adds
20-40 seconds per install) and eliminates a build-time compilation step.

**No-silent-downgrade rule (mandatory AC on every migration story):** If both classical and PQC
paths exist during a transition window, the envelope format must encode the algorithm choice
explicitly. A receiver must never silently fall back from a PQC path to a classical path. Mixed-
version transcripts must be rejected, not silently accepted under the old algorithm.

---

**Layer key used throughout this document:**

| Tag | Meaning |
|-----|---------|
| `[C]` | cello-client — `core/crypto`, `core/transport`, `core/client`, `core/daemon` |
| `[D]` | Directory node — `packages/directory/` in trustless-cello |
| `[R]` | Relay node — `packages/relay/` in trustless-cello |
| `[O]` | Ops-agent — `packages/operations-agent/` in trustless-cello |
| `[I]` | Infra / AWS — CloudFormation, KMS, ALB, RDS |

---

## Master Table

| ID | Primitive | Tier | Layers | Status |
|----|-----------|------|--------|--------|
| [T1-A](#t1-a-ed25519-agent-identity--protocol-signing) | Ed25519 — agent identity & protocol signing | 🔴 MUST REPLACE | `[C]` `[D]` `[R]` | Scaffold exists (ML-DSA-44 in `core/crypto`) |
| [T1-B](#t1-b-ed25519-consortium-manifest-signing) | Ed25519 — consortium manifest signing | 🔴 MUST REPLACE | `[C]` `[D]` | Root keys compiled into client binary |
| [T1-C](#t1-c-ed25519-directoryrelay-node-keys) | Ed25519 — directory/relay node keys | 🔴 MUST REPLACE | `[D]` `[R]` | Per-region SSM secrets |
| [T1-D](#t1-d-frost-threshold-signatures--dkg) | FROST threshold signatures + DKG | 🔴 MUST REPLACE | `[C]` `[D]` | Hardest item — no standardized PQC threshold scheme |
| [T1-E](#t1-e-x25519-content-sealing) | X25519 ECDH — content sealing | 🔴 MUST REPLACE | `[C]` `[D]*` | Cleanest KEM swap; implementation in `core/crypto` |
| [T1-F](#t1-f-x25519--noise-xx-transport-handshake) | X25519 / Noise XX — transport handshake | 🔴 MUST REPLACE | `[C]` `[R]` | Gated on libp2p upstream; longest lead time |
| [T1-G](#t1-g-libp2p-peer-id-keypair) | libp2p Peer ID keypair | 🔴 MUST REPLACE | `[C]` `[R]` `[D]` | Coupled to T1-F |
| [T1-H](#t1-h-tls-at-the-alb) | TLS 1.3 at the ALB (X25519 key exchange) | 🔴 MUST REPLACE | `[I]` | Gated on AWS ALB hybrid-KEM support |
| [T2-A](#t2-a-sha-256-hash-chains-merkle-tbs-content-addressing) | SHA-256 — hash chains, Merkle, TBS, content addressing | 🟡 VERIFY SIZING | `[C]` `[D]` `[R]` `[O]` | 128-bit post-Grover margin; adequate |
| [T2-B](#t2-b-hkdf-sha256) | HKDF-SHA256 | 🟡 VERIFY SIZING | `[C]` | Safe primitive; X25519 input is the weak link |
| [T2-C](#t2-c-aes-256-gcm) | AES-256-GCM | 🟡 VERIFY SIZING | `[C]` `[D]` | 256-bit → safe; no algorithm change needed |
| [T2-D](#t2-d-aes-256-cbc--sqlcipher) | AES-256-CBC — SQLCipher at rest | 🟡 VERIFY SIZING | `[C]` | Audit password→key KDF |
| [T2-E](#t2-e-aws-kms) | AWS KMS (symmetric, key rotation on) | 🟡 VERIFY SIZING | `[I]` | AWS-managed; track KMS PQC roadmap |
| [T2-F](#t2-f-sha-256-otp--hmac-sha256) | SHA-256 OTP / HMAC-SHA256 | 🟡 VERIFY SIZING | `[O]` | Fine; consider slow KDF for OTP regardless |
| [T2-G](#t2-g-sha-512) | SHA-512 | 🟡 VERIFY SIZING | `[C]` | Safe; no action |
| [T3-A](#tier-3--not-directly-affected) | CSPRNG, `timingSafeEqual`, pre-auth tokens, CBOR | 🟢 NOT AFFECTED | All | No change needed |
| [T3-B](#tier-3--not-directly-affected) | WebAuthn / PIN / magic-link portal auth | 🟢 NOT AFFECTED | Portal | FIDO2 has its own PQC timeline |
| [T3-C](#tier-3--not-directly-affected) | Infra at-rest (RDS, S3 SSE, Secrets Manager) | 🟢 NOT AFFECTED | `[I]` | AES-based; safe |

`[D]*` = used by the directory e2e test spine; implementation lives in `[C]`

---

## 🔴 Tier 1 — Must Replace

### T1-A: Ed25519 — Agent Identity & Protocol Signing

**Layers:** `[C]` `[D]` `[R]`

This is the highest-volume primitive across the stack. It is the agent's operational identity key
(K_local), every signed protocol envelope, consortium manifest threshold verification, and relay
self-registration.

**Where the implementation lives:**

| Layer | File | Role |
|-------|------|------|
| `[C]` | `core/crypto/src/ed25519.ts` | `FileKeyProvider.load/generate`, `sign`, `verify`; K_local at `~/.cello/key` |
| `[C]` | `core/crypto/src/manifest.ts` | Consortium threshold verification |
| `[C]` | `core/crypto/src/relay-registration.ts` | Relay registration TBS + signing |
| `[C]` | `core/daemon/src/session-relay-client.ts` | Relay auth payload signing |
| `[D]` | `directory.ts:42,150` | Envelope signing via `KeyProvider` |
| `[D]` | `directory-node.ts:168,815-831` | Identity key usage, envelope verification |
| `[R]` | relay registration verify | Node verifies incoming relay registration |

**What needs to change:**
- Replace `ed25519.sign/verify` with ML-DSA-44 (FIPS 204) throughout all signing call sites.
- The `KeyProvider` / `SigningKeyProvider` abstraction in `ed25519.ts` is the designed migration
  boundary — replace the *implementation behind the interface*, not every call site.
- On-disk key format at `~/.cello/key` changes. Requires a migration path for existing operators.

**PQC target:** ML-DSA (FIPS 204) via **`node:crypto` Web Crypto** (`SubtleCrypto.generateKey`,
`sign`, `verify` with algorithm `'ML-DSA-44'`). The `core/crypto/src/ml-dsa.ts` file already has
the right abstraction (`FileMlDsaKeyProvider`, `InMemoryMlDsaKeyProvider`, `mlDsaKeygen`) — the
implementation behind those interfaces must be **rewritten to call `node:crypto` instead of
`@oqs/liboqs-js`**. The WASM dependency is then removed from the package. The
`FakeMlDsaKeyProvider` stub is removed once real tests pass.

**Open question:** ML-DSA-44 (level 2) vs. ML-DSA-65/87 for high-value keys.

---

### T1-B: Ed25519 — Consortium Manifest Signing

**Layers:** `[C]` `[D]`

The trust anchor for the entire directory-authentication chain (TUF-aligned manifest). Root keys
are **compiled into the client binary**, so an algorithm change forces a client release.

**Where the implementation lives:**

| Layer | File | Role |
|-------|------|------|
| `[C]` | `core/crypto/src/manifest.ts` | Threshold manifest verification (t-of-5 at Alpha) |
| `[C]` | `core/crypto/src/consortium-keys.ts` | Hardcoded consortium root public keys |
| `[D]` | `e2e-tests/src/spine/auth-manifest.ts:25-111` | Manifest construction and signing |
| `[D]` | `directory.ts:841-848` | Manifest verification at runtime |

**What needs to change:**
- Algorithm swap (Ed25519 → ML-DSA or SLH-DSA) forces a new root key set and a **client binary release**.
- Design a hybrid (dual-signature) manifest to allow a transition window where both old and new
  clients can verify.
- Plan the rotation path: in-band rotation handles a *key*, not an *algorithm*. An algorithm change
  requires a protocol version bump.

**PQC target:** ML-DSA or SLH-DSA (FIPS 205, stateless-hash — more conservative for root keys).

---

### T1-C: Ed25519 — Directory/Relay Node Keys

**Layers:** `[D]` `[R]`

Per-node operational identity. These are the keys stored in SSM (`node-private-key`,
`manifest-signer-pubkey`) and used to authenticate directory and relay nodes on the network.

**Where the implementation lives:**

| Layer | File | Role |
|-------|------|------|
| `[D]` | `node-private-key` SSM secret | Directory node signing key, per-region |
| `[D]` | `directory-node.ts:694` | Relay registration signature verification |
| `[R]` | `relay-pool-manager.ts` | Relay pool manifest signing |
| `[I]` | `cello-ssm-parameters.yaml` | SSM parameter definitions |

**What needs to change:**
- Generate new ML-DSA node keys per region and store in SSM.
- Update CloudFormation parameter schema to accommodate larger key sizes.
- Coordinate with T1-B (manifest signing) since node keys feed into the manifest.

**PQC target:** ML-DSA or SLH-DSA.

---

### T1-D: FROST Threshold Signatures + DKG

**Layers:** `[C]` `[D]` — **cross-cutting**

The heart of the sovereign-node invariant. The FROST ceremony spans the client and every directory
node simultaneously — a protocol-level primitive, not a library swap.

**Where the implementation lives:**

| Layer | File | Role |
|-------|------|------|
| `[C]` | `core/crypto/src/frost/frost-threshold-signer.ts` | Round 1 commits, partial sign, share verify, aggregate |
| `[C]` | `core/protocol-types/src/frost-dkg.ts` | DKG wire frames: `DkgRound1Broadcast`, `DkgRound2Share`, `DkgRound3ResponseOk` |
| `[C]` | `core/crypto/src/frost/stubs.ts` | `InProcessDirectoryNodeStub` test harness |
| `[D]` | `frost-handler.ts:78-79` | Directory-side FROST ceremony handler |
| `[D]` | `directory-node.ts:896-1185` | K_server_X share generation, ceremony state machine |
| `[D]` | `frost-dkg-frames.ts` | 3-round DKG ceremony on `/cello/frost/1.0.0` |

**Domain-separation context strings that must be preserved across migration:**
- Session establishment: `"cello-frost-session-establishment-v1"` (10 fields)
- Conversation seal: `"cello-frost-seal-v1"` (4 fields)

A PQC migration must introduce a versioned context (e.g. `-v2`) if the field set or encoding
changes, so PQC and classical signatures can never be confused during a hybrid transition.

**What needs to change:**
- There is **no NIST-standardized threshold lattice signature scheme** as of this writing.
  Track NIST IR 8214C (threshold cryptography).
- The `IThresholdSigner` abstraction in `CONTEXT.md` is the designed seam. Do not design around it.
- Options: threshold ML-DSA (research-grade), or pivot to PQC multi-signature aggregate over ML-DSA.
- The DKG wire frames (`frost-dkg.ts`) are part of the protocol surface — any change requires a
  cross-repo version bump and the full publish cascade.

**PQC target:** Threshold ML-DSA via `IThresholdSigner`. This is the long-pole item.

---

### T1-E: X25519 ECDH — Content Sealing

**Layers:** `[C]` (implementation); `[D]` via e2e test spine

End-to-end content encryption to a recipient's key. **The cleanest KEM swap** — already a
KEM-then-AEAD construction.

**Where the implementation lives:**

| Layer | File | Role |
|-------|------|------|
| `[C]` | `core/crypto/src/content-seal.ts` | Full implementation: Edwards→Montgomery, ephemeral X25519, HKDF, AES-256-GCM |
| `[D]` | `e2e-tests/src/spine/content-seal-fixture.ts:16,26-42` | End-to-end test usage (imports from `@cello-protocol/crypto`) |

**Wire format:** `ephPk(32) || iv(12) || ct || tag(16)` — `CONTENT_SEAL_OVERHEAD_BYTES = 44`.
The new ML-KEM ephemeral public key is 768 bytes (ML-KEM-512) or 1184 bytes (ML-KEM-768).
The overhead constant and any on-wire size assumptions must be updated.

**What needs to change:**
- Replace `x25519.getSharedSecret()` + Edwards→Montgomery conversion with ML-KEM encapsulate/decapsulate.
- The HKDF-SHA256 step (T2-B) and AES-256-GCM step (T2-C) are retained — only the key-agreement input changes.
- Update `CONTENT_SEAL_OVERHEAD_BYTES` and the wire format spec.
- The relay never holds a decryption key (CELLO-M7-MSG-001) — this invariant must be preserved.

**PQC target:** ML-KEM (FIPS 203) via **`node:crypto` Web Crypto** (`encapsulateKey` /
`decapsulateKey` with algorithm `'ML-KEM-768'` for level-3 security). The HKDF and AES-GCM steps
are retained unchanged — only the key-agreement input to HKDF changes from an X25519 shared
secret to the ML-KEM decapsulated secret.

**Wire format note:** ML-KEM-768 ciphertext is 1088 bytes; encapsulated public key is 1184 bytes.
`CONTENT_SEAL_OVERHEAD_BYTES = 44` becomes ~1100+ bytes. Update this constant and every relay /
message-size assumption that depends on it.

---

### T1-F: X25519 / Noise XX — Transport Handshake

**Layers:** `[C]` `[R]`

All transport-layer connection encryption — agent↔relay, agent↔directory, inter-node. **Gated on
the libp2p ecosystem.** CELLO is a consumer of `@chainsafe/libp2p-noise`; it does not own this implementation.

**Where the implementation lives:**

| Layer | File | Role |
|-------|------|------|
| `[C]` | `core/transport/src/node.ts` | `noise()` from `@chainsafe/libp2p-noise` — all TCP/WebSocket/circuit-relay connections |
| `[R]` | `relay/src/index.ts:96` | `connectionEncrypters: [noise()]` |

**What needs to change:**
- Monitor `@chainsafe/libp2p-noise` for a PQ/hybrid Noise variant (X25519 + ML-KEM hybrid).
- When upstream ships it: update the version pin in both `core/transport` and `relay`, run the
  full version-bump cascade for `@cello-protocol/transport`.
- **This has the longest external lead time** — open this dependency thread early.

**PQC target:** PQ-Noise / hybrid handshake (X25519 + ML-KEM). Tracking libp2p upstream.

---

### T1-G: libp2p Peer ID Keypair

**Layers:** `[C]` `[R]` `[D]`

The transport-layer peer identity used in Noise handshake authentication. Distinct from K_local
(ADR-0001). Per-region transport keys generated with `openssl rand -hex 32`.

**Where the implementation lives:**

| Layer | File | Role |
|-------|------|------|
| `[C]` | `@libp2p/crypto`, `@libp2p/peer-id` | Keypair generation and Peer ID derivation |
| `[R]` `[D]` | Per-region transport key in SSM | Transport keypair seeded from SSM secret |

**What needs to change:** Coupled to T1-F. When libp2p adopts a PQC Peer ID format, update the
keypair generation and SSM parameter rotation procedure.

---

### T1-H: TLS at the ALB

**Layers:** `[I]`

The agent↔directory channel confidentiality at the AWS ALB (port 443, HTTPS/WebSocket termination).
TLS 1.3 uses X25519 for key exchange in the default cipher suites — **harvest-now-decrypt-later**
exposure for recorded traffic.

**Where the implementation lives:**

| Layer | File | Role |
|-------|------|------|
| `[I]` | `infra/cloudformation/cello-ecs-directory.yaml` | ACM cert, HTTPS/WebSocket termination |
| `[I]` | RDS in-transit TLS | Database connection encryption |

**What needs to change:**
- AWS ALB must support hybrid-KEM TLS 1.3 (X25519 + ML-KEM) — **gated on the AWS roadmap**.
- No CELLO code change; this is an infrastructure configuration update when AWS enables it.
- Track [AWS post-quantum TLS roadmap](https://aws.amazon.com/security/post-quantum-cryptography/).

**AWS PQC status as of 2026-06-28:** KMS, ACM, Secrets Manager, S3, CloudFront — all already
have PQC TLS or ML-KEM/ML-DSA support deployed. **ALB is the specific remaining gap** for CELLO's
agent↔directory channel. RDS in-transit TLS status unconfirmed — check separately.

---

## 🟡 Tier 2 — Verify Sizing

### T2-A: SHA-256 — Hash Chains, Merkle, TBS, Content Addressing

**Layers:** `[C]` `[D]` `[R]` `[O]`

SHA-256 is used pervasively for tamper-evidence (hash chains), message authentication (TBS payloads),
and content addressing. Grover gives only a quadratic speedup — SHA-256 retains ~128-bit
collision resistance post-quantum. **No algorithm replacement needed.**

**Call sites by layer:**

| Layer | Usage |
|-------|-------|
| `[C]` | `core/crypto/src/hashing.ts` — Merkle leaf/node hashing (RFC 6962 domain separation: `0x00`, `0x01`, `0x02`); `core/crypto/src/checkpoint.ts`; `core/crypto/src/relay-registration.ts`; multiple TBS builders in `core/daemon/src/` |
| `[D]` | `directory/src/hash-chain.ts` — `chain_hash = SHA-256(record ‖ prev)`, genesis `SHA-256("CELLO_CHAIN_GENESIS")`; agent-id derivation (`directory.ts:241,964`); token-consumption chain (`pre-auth-token-repository.ts:140,413`) |
| `[R]` | `relay-node.ts:76,568-610` — Merkle/MMR (`buildMerkleTree`, `merkleRoot`); content/ack hashing (`relay-node.ts:697`); sealed root |
| `[O]` | `operations-agent/src/registration/otp.ts` — `SHA-256(otp‖salt)` |

**Action:** Audit that all hash-chain and Merkle designs use SHA-256 (not SHA-1 or MD5). For *new*
designs, prefer SHA-512 or SHA-3 for additional post-Grover margin.

---

### T2-B: HKDF-SHA256

**Layers:** `[C]`

Used in three distinct KDF roles:
- DB key: `core/client/src/db-key-derivation.ts` — `info = "local-db-key\x00{agentId}"`
- Backup key: `core/client/src/backup-key-derivation.ts` — `info = "backup-key\x00{agentId}"`
- Content seal: `core/crypto/src/content-seal.ts` — `info = "cello-content-seal"`, salt = ephemeral pubkey

**Action:** The HKDF primitive itself is safe. The only risk is in the content-seal path where the
input is an X25519 shared secret (T1-E). When T1-E is migrated to ML-KEM, the HKDF step is retained
unchanged — just the input changes.

---

### T2-C: AES-256-GCM

**Layers:** `[C]` `[D]`

AES-256 has ~128-bit effective security after Grover. **No replacement needed.**

| Layer | Usage |
|-------|-------|
| `[C]` | Content sealing (`core/crypto/src/content-seal.ts`); cloud backup (`core/client/src/client-backup.ts` — 96-bit random nonce, blob `[nonce(12)][auth_tag(16)][ct]`); legacy identity migration (`core/daemon/src/identity-migration.ts`) |
| `[D]` | Envelope key encryption at rest (`interfaces/src/stubs/local-envelope-key-provider.ts:47,103-132` — 96-bit random nonce, AAD=keyId, 28-byte overhead) |

**Action:** Verify all AES usages are 256-bit (not 128-bit). Confirm 96-bit random nonces
throughout. No algorithm change.

---

### T2-D: AES-256-CBC — SQLCipher at Rest

**Layers:** `[C]`

Whole-database encryption via `@signalapp/sqlcipher` (replaced `@journeyapps/sqlcipher` in M6B-013).
PRAGMA key format: `x'<hexkey>'`.

**Action:** AES-256-CBC is quantum-safe. Audit the **password→key KDF** inside SQLCipher — if it
uses PBKDF2 with a weak iteration count, the KDF is the weak link, not AES. This is independent of
the quantum threat but worth fixing in the same pass.

---

### T2-E: AWS KMS

**Layers:** `[I]`

One symmetric master key per environment per region (`infra/cloudformation/cello-kms.yaml`). Key
rotation enabled. Directory task role has `Decrypt`/`DescribeKey` only.

**Action:** AWS KMS **already supports ML-KEM hybrid key exchange and ML-DSA digital signatures**
(confirmed 2026-06-28 via AWS PQC page). ACM and Secrets Manager TLS endpoints already run
post-quantum s2n-tls. S3 and CloudFront have PQC TLS policies. **No CELLO action required here.**
The only remaining AWS gap is the ALB (T1-H).

---

### T2-F: SHA-256 OTP / HMAC-SHA256

**Layers:** `[O]`

OTP storage: `SHA-256(otp‖salt)` with 128-bit salt, `timingSafeEqual` constant-time comparison
(`operations-agent/src/registration/otp.ts`). HMAC-SHA256 in test fixtures for deterministic fake
ML-DSA signatures.

**Action:** Both are quantum-safe at current sizes. Consider replacing the OTP SHA-256 hash with a
proper slow KDF (Argon2, scrypt) regardless of quantum concerns.

---

### T2-G: SHA-512

**Layers:** `[C]`

Used in `core/crypto/src/content-seal.ts` for Ed25519 seed → Montgomery scalar derivation (per
RFC 8032 §5.1.5). SHA-512 is quantum-safe. No action needed.

---

## 🟢 Tier 3 — Not Directly Affected

| Item | Where | Note |
|------|-------|------|
| **CSPRNG** (`randomBytes`, `randomInt`, `randomUUID`, `getRandomValues`) | Throughout all layers | Quantum-safe. Feeds every primitive above — keep auditing that it is the entropy source. NIST SP 800-90A. |
| **`timingSafeEqual`** constant-time comparison | `[O]` `operations-agent/src/registration/otp.ts:57-59` | Side-channel defense, orthogonal to quantum threat. |
| **Pre-auth tokens** (`randomBytes(25)` → base58, rejection-sampled) | `[D]` `pre-auth-token-repository.ts:61` | High-entropy random, not asymmetric — unaffected. |
| **CBOR canonical encoding** (RFC 8949 §4.2.1) | `[C]` `[D]` `frost-dkg-frames.ts`, FROST TBS arrays | Not crypto; it is the byte-canonicalization the signatures commit to. Preserve all domain-separation context strings through the migration (see T1-D). |
| **WebAuthn / PIN / magic-link portal auth** | Portal (not yet fully implemented) | WebAuthn authenticators have their own FIDO2 PQC timeline. Flag for completeness; no action in this migration. |
| **Infra at-rest: RDS encryption, S3 SSE, Secrets Manager** | `[I]` | AES-based — quantum-safe. VPC peering and WAF are network controls, not cryptographic. In-transit TLS is the vulnerable surface (T1-H). |

---

## Suggested Migration Ordering

Ordered by: criticality of the invariant it protects × ease of migration × external dependencies.

**1. ML-DSA for single signatures — T1-A, T1-B, T1-C (quickest win)**
The ML-DSA-44 scaffold already exists in `core/crypto/src/ml-dsa.ts`. Rewrite the implementation
behind `FileMlDsaKeyProvider` to use `node:crypto` Web Crypto (`SubtleCrypto`) instead of
`@oqs/liboqs-js`, then wire it through `KeyProvider` / `SigningKeyProvider`. Remove `@oqs/liboqs-js`
from `package.json` once tests pass — this eliminates the WASM install overhead. Simultaneously
plan the manifest hybrid-signature strategy and client binary release for T1-B.
Bump the `@cello-protocol/crypto` and `@cello-protocol/connect` version cascade on completion.

**2. ML-KEM for content sealing — T1-E (cleanest swap)**
Self-contained in `core/crypto/src/content-seal.ts`. The KEM-then-AEAD construction already fits;
only the key-agreement step changes. Update `CONTENT_SEAL_OVERHEAD_BYTES`. The HKDF and AES-GCM
steps are retained. Cross-repo: update e2e test spine in trustless-cello after the `@cello-protocol/crypto`
version bump.

**3. Open libp2p dependency thread — T1-F, T1-G (longest external lead time)**
File an issue or watch the `@chainsafe/libp2p-noise` repo for PQ/hybrid Noise support. When
upstream ships it, the change is a version pin bump + transport key rotation in SSM. No CELLO
protocol change needed. Start this thread now so it doesn't become the blocker when everything
else is done.

**4. FROST → Threshold ML-DSA — T1-D (hardest, research-grade)**
This is the long pole. Track NIST IR 8214C. Decide early whether to pursue true threshold ML-DSA
or pivot to a PQC multi-signature aggregate. The `IThresholdSigner` abstraction is the designed
seam — any new scheme plugs in there. Domain-separation context strings must be versioned (e.g.
`-v2`) on rollout.

**5. Hybrid KEM TLS at ALB — T1-H (infrastructure, external dependency)**
Pure AWS configuration change. No CELLO code. Track the AWS hybrid-KEM TLS 1.3 roadmap and
apply when available.

**6. Hash/symmetric sizing review — T2-A through T2-G (low effort, opportunistic)**
AES-256-GCM and SHA-256 are retained. Optionally move new hash-chain/Merkle designs to SHA-512
for wider post-Grover margin. Audit SQLCipher's password→key KDF (T2-D). No algorithm
replacements required anywhere in Tier 2.

---

## Open Decisions

- **Hybrid vs. PQC-only.** Classical + PQC concatenation (e.g. X25519 + ML-KEM, Ed25519 + ML-DSA)
  is the conservative industry default during transition and protects against PQC implementation
  flaws. Decide CELLO's policy before any migration story is written.
- **Security level.** ML-DSA-44 (level 2) vs. ML-DSA-65/87 (levels 3/5); likewise ML-KEM-512 /
  768 / 1024. Higher levels mean larger keys and signatures — this changes on-wire sizes, the
  operator's `~/.cello/key` format, and the publish-cascade burden.
- **Wire format & version negotiation.** Larger PQC keys/signatures affect every envelope and
  on-disk format. Given CELLO's strict cross-repo publishing invariants (every `core/*` change
  requires a package version bump and dependency-cascade republish), plan this carefully before
  writing the first migration story.
- **FROST strategy (T1-D).** Confirm whether a true post-quantum *threshold* signature is required,
  or whether the protocol can move to a PQC multi-signature aggregate. This is the decision with the
  longest lead time and must be made before any other migration story can be sequenced around it.
- **ML-DSA security level for manifest root keys (T1-B).** Root keys are compiled into the client
  binary and changed only through a client release. They should probably use a higher level
  (ML-DSA-87 / SLH-DSA) than operational keys.
- **No-silent-downgrade (mandatory on every migration story AC).** During any hybrid transition
  window where both classical and PQC paths coexist, the algorithm choice must be encoded
  explicitly in the envelope/wire format. A receiver must reject — never silently accept — a
  message that arrives under the wrong algorithm for its negotiated version. Mixed-version
  transcripts are an attack surface, not a compatibility feature.

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
- Internal: `CONTEXT.md` (glossary, identity hierarchy, `IThresholdSigner`), [[cryptographic-inventory]] (server/relay), [[cryptographic-inventory-client]] (cello-client)
