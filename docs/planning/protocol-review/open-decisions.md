---
name: Open Decisions
type: decision
date: 2026-04-08
topics: [FROST, Ed25519, SHA-256, threshold-signing, hash-relay, merkle-tree, sequence-numbers, DeBERTa, SDK, mutual-authentication, nonce, supply-chain]
status: resolved
description: 12 resolved design decisions from the day-zero protocol review — threshold scheme (FROST), signature scheme (Ed25519), hash function (SHA-256), threshold parameters (3-of-5), signed hash relay, RFC 6962 Merkle construction, and more.
---

# Open Decisions

Decisions that resolve with a clear choice. Work through these, update the design doc, and archive this file.

Each item: what needs deciding, the recommended choice, and why. Full analysis in [[00-synthesis|day-zero-review/]].

## Related Documents

- [[end-to-end-flow|CELLO End-to-End Protocol Flow]] — synthesis document that incorporates all 12 decisions into the full protocol narrative
- [[cello-initial-design|CELLO Design Document]] — these decisions are reflected in the current design
- [[00-synthesis|Protocol Review — Synthesis]] — the adversarial review that surfaced these decisions
- [[design-problems|Design Problems]] — the harder problems requiring mechanism work (not just decisions)
- [[2026-04-08_1700_node-architecture-and-replication|Node Architecture and Replication]] — discussion log expanding on decisions 1, 3, 4, 12

---

---

### 1. Threshold signing scheme

**Decision:** FROST or GG20?

**Recommended:** FROST (Flexible Round-Optimized Schnorr Threshold signatures)

**Why:** FROST is designed for Ed25519, requires only 2 rounds, is simpler than GG20, and the Ed25519 signature scheme uses deterministic nonces (RFC 8032) — eliminating the entire class of nonce-reuse vulnerabilities that have historically destroyed ECDSA deployments (Sony PS3, Android Bitcoin wallets). GG20 is the right choice only if you need ECDSA compatibility for some external reason.

**Updates to design doc:** Replace all `derived(K_local + K_server)` language with a description of the FROST signing flow. The agent never holds K_server or any reconstructable share of it — partial signatures are computed on each node and combined.

*Ref: day-zero-review/01, Findings #1, #2, #5*

**Agreed — 2026-04-08**

---

### 2. Signature scheme

**Decision:** Ed25519 or ECDSA?

**Recommended:** Ed25519

**Why:** Deterministic nonces make it impossible to leak the private key through bad randomness. ECDSA with random nonces is a footgun on constrained hardware (embedded systems, IoT, robots — all in scope). If ECDSA must be supported later, require RFC 6979 deterministic nonces.

**Updates to design doc:** Commit to Ed25519 everywhere the doc says "Ed25519/ECDSA."

*Ref: day-zero-review/01, Finding #11*

**Agreed — 2026-04-08**

---

### 3. Hash function

**Decision:** Which hash function for Merkle tree and hash relay?

**Recommended:** SHA-256

**Why:** The doc already implies 32-byte hashes. SHA-256 is the obvious choice — well-studied, hardware-accelerated, collision-resistant. Encode the hash algorithm in the protocol version, not negotiated per-session. Future migration happens as a protocol version bump.

**Updates to design doc:** Replace "32-byte hashes" with "SHA-256" everywhere.

*Ref: day-zero-review/01, Finding #19*

**Agreed — 2026-04-08**

---

### 4. Threshold parameters

**Decision:** What threshold for K_server shares?

**Recommended:** 3-of-5 minimum, moving to 5-of-7 at maturity

**Why:** 2-of-3 means compromising 2 nodes gives every agent's K_server. That's realistic for a nation-state and even feasible for a well-funded attacker. 3-of-5 requires compromising 3 nodes across different jurisdictions and cloud providers — significantly harder. The design doc used 2-of-3 as an illustration, not a deliberate choice.

**Updates to design doc:** Replace the 2-of-3 example with 3-of-5, add a note that the threshold increases as the consortium grows.

*Ref: day-zero-review/01, Finding #5; day-zero-review/04, Section 3.1*

**Agreed — 2026-04-08**

**Note:** The threshold choice also determines the boundary between full and degraded operation. With 3-of-5, the protocol requires 3 nodes for FROST session establishment and seal. With 5-of-7, it requires 5. A higher threshold is more secure but less resilient — it becomes easier to slip into degraded mode (no new FROST sessions, existing conversations continue with K_local) when nodes go offline. This tradeoff should be considered when increasing the threshold at maturity.

---

### 5. Hash relay must carry sender signature

**Decision:** Does the hash submitted to the directory include the sender's signature?

**Recommended:** Yes — the hash payload is signed by the sender, and the receiver verifies the sender's signature directly (not trusting the directory's version).

**Why:** Without this, an attacker who controls the network between the sender and the outside world can replace both the message AND the hash. The dual-path MITM defense only works if the hash carries a signature the directory can't forge. The design already has signing on connection requests — this is the same principle applied to the hash relay.

**Updates to design doc:** Add to Step 7 that hash relay payloads are end-to-end signed by the sender and verified by the receiver against the sender's public key.

*Ref: day-zero-review/03, Section 1.1*

**Agreed — 2026-04-08**

**Note:** As written, this decision only describes signed hashes on the relay path (sender → directory → receiver). The protocol also requires that signed hashes are embedded in direct channel messages. Every message sent on the direct channel must bundle the content with its signed hash. This is what enables degraded-mode operation: when the directory is unavailable, the receiver can still verify message integrity from the embedded signed hash alone. The dual-path design means signed hashes travel both routes — via the relay for third-party notarization, and embedded in the direct message for local verification.

---

### 6. Merkle tree construction standard

**Decision:** What tree construction to use?

**Recommended:** Follow RFC 6962 (Certificate Transparency)

**Why:** Solves three issues at once: (a) domain separation (`0x00` for leaf nodes, `0x01` for internal nodes) prevents second-preimage attacks, (b) defines the padding scheme, (c) is a well-audited standard rather than a custom construction.

**Updates to design doc:** Reference RFC 6962 in the Merkle tree section.

*Ref: day-zero-review/01, Finding #13*

**Agreed — 2026-04-08**

---

### 7. First message prev_root initialization

**Decision:** What value does `prev_root` take for the first message in a conversation?

**Recommended:** `prev_root = hash(agent_A_pubkey || agent_B_pubkey || session_id || timestamp)`

**Why:** Both parties can independently compute this from public information. It anchors the chain from message 1 (not message 2), and prevents a compromised directory from substituting the first message hash.

**Updates to design doc:** Add the initialization hash formula to the leaf format section.

*Ref: day-zero-review/01, Finding #7*

**Agreed — 2026-04-08**

---

### 8. Mutual authentication for directory connections

**Decision:** Should the directory prove its identity to the agent (not just the other way around)?

**Recommended:** Yes — bidirectional challenge-response plus certificate pinning.

**Why:** Currently the agent proves identity to the directory, but the directory never proves identity to the agent. A fake directory (via DNS poisoning or compromised node list) can collect signed nonces from agents and serve fake public keys for other agents. Bidirectional challenge-response is standard practice.

**Updates to design doc:** Add mutual authentication to Step 3. The agent verifies the directory node's signature against the consortium's known node keys.

*Ref: day-zero-review/01, Finding #10*

**Agreed — 2026-04-08**

---

### 9. Nonce specification for challenge-response

**Decision:** What are the nonce requirements?

**Recommended:** 256-bit CSPRNG output, single-use with expiry, and the signed response must bind to: the nonce, the agent's ID, the directory node's ID, and a timestamp.

**Why:** Prevents precomputation attacks (weak PRNG), replay across sessions (no session binding), and cross-node replay (no node binding). All standard practice, just needs to be specified.

**Updates to design doc:** Add nonce requirements to Step 3.

*Ref: day-zero-review/01, Finding #9*

**Agreed — 2026-04-08**

---

### 10. DeBERTa model verification

**Decision:** How is the prompt injection model secured?

**Recommended:** Pin the model's SHA-256 hash in the SDK source code. Bundle the model in the npm package rather than downloading at runtime.

**Why:** A runtime download from an unspecified source with no verification is a supply chain vulnerability that compromises the entire network's security layer. 100MB is large for an npm package but acceptable for a security-critical dependency. If bundling isn't feasible, sign the model with a CELLO-held key and verify on download.

**Updates to design doc:** Add model verification to the SDK section under "First run."

*Ref: day-zero-review/04, Section 1.3*

**Revised — 2026-04-08**

**Concern:** The recommendation assumes we control the prompt injection model. We don't. DeBERTa and similar classifiers are third-party models available on Hugging Face. We vet them and ship a recommended default, but the client can swap in any classifier that meets the interface.

**Revised recommendation:** The SDK must verify the integrity of whatever classifier it loads — the default model is pinned by SHA-256 hash and bundled in the package. If the user substitutes a different model, the SDK logs the substitution and the model's hash. This is an SDK implementation detail, not a protocol-level decision. The protocol does not mandate a specific model; it mandates that the client runs a prompt injection classifier and that the model's identity is verifiable.

---

### 11. SDK install instructions — pin versions

**Decision:** Should the default install use `npx @cello/mcp-server` (latest) or a pinned version?

**Recommended:** Pinned version: `npx @cello/mcp-server@1.2.3`

**Why:** `npx` without a version pin fetches latest on every run. A compromised npm publish = instant mass compromise of every agent that restarts. Pinning is a one-line change to the docs.

**Updates to design doc:** Change the install command in the SDK section.

*Ref: day-zero-review/04, Section 5.1*

**Agreed — 2026-04-08**

---

### 12. Sequence number assignment

**Decision:** Who assigns sequence numbers in the Merkle tree — the sender or the directory?

**Recommended:** The directory assigns canonical sequence numbers when hashes arrive.

**Why:** If senders assign their own, concurrent messages from both agents create duplicate sequence numbers and divergent trees. The directory is the natural ordering authority since it already receives all hashes. Both agents wait for the directory's acknowledgment before computing their local tree update.

**Updates to design doc:** Add to Step 7 that the directory assigns sequence numbers and both parties wait for acknowledgment.

*Ref: day-zero-review/01, Finding #6*

**Revised — 2026-04-08**

**Concern:** The recommendation assumes the directory is always available. The protocol must degrade gracefully when it isn't. If the directory assigns all sequence numbers and the directory is down, nobody can sequence messages — the Merkle tree can't grow and communication halts. This contradicts the graceful degradation design principle.

**Revised recommendation:** Sequence number assignment follows the degradation spectrum:

- **Directory available:** The directory assigns canonical sequence numbers. Both parties wait for acknowledgment. This is the strongest ordering guarantee and the normal mode of operation.
- **Directory unavailable:** Both parties assign local sequence numbers based on their own message order. The hash chain itself still provides ordering — each hash includes the previous Merkle root, so the sequence is embedded in the math. Ordering is maintained; what's lost is the canonical third-party authority over that ordering.
- **Reconciliation:** When the directory returns, both parties submit their locally-sequenced hashes. If both chains agree (same hashes, same order), the directory adopts the sequence and assigns canonical numbers retroactively. If they disagree, the discrepancy is flagged for investigation.

The hash chain is the primary ordering mechanism. Directory-assigned sequence numbers are an authoritative overlay, not the sole source of order.
