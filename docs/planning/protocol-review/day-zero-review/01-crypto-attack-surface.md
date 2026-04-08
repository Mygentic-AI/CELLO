# CELLO Protocol -- Adversarial Cryptographic Security Review

**Reviewer:** Senior Cryptographic Security Researcher
**Date:** 2026-04-08
**Document reviewed:** `docs/planning/cello-design.md`
**Scope:** Full cryptographic design analysis, pre-implementation

---

## Executive Summary

The CELLO design demonstrates sound security intuitions in several areas -- hash-relay privacy, dual public keys as a compromise canary, and append-only directory logs. However, the cryptographic specification is dangerously underspecified in its most critical component: the split-key scheme. Multiple attack surfaces exist due to ambiguous key derivation, unspecified threshold cryptography, and several protocol-level race conditions. Below are 22 findings, 4 of which are Critical.

---

## Finding 1: Phantom Key Derivation

**Severity:** Critical

**Description:** The document states that the signing key is `derived(K_local + K_server)` and the primary public key is `derived(K_local + K_server)`. The `+` operator is never defined. This is the single most important cryptographic decision in the entire protocol, and it is unspecified.

The security properties differ radically depending on the derivation scheme:

- **Additive key combination (EC point addition):** `K_combined = K_local + K_server` on the elliptic curve. This is homomorphic and enables a clean split, but requires both parties to prove knowledge of their discrete log (via a Schnorr proof or similar) during setup, otherwise one party can choose their key to cancel the other's and control the combined key. Specifically: if the directory generates K_server *after* seeing K_local's public key, it can set `K_server = target - K_local` and control the combined key entirely.
- **Concatenation + KDF:** `K_combined = KDF(K_local || K_server)`. This destroys the algebraic structure needed for threshold signing. The agent would need to receive the full K_server to compute the combined key, which means K_server must be transmitted and temporarily exists in full on the agent's machine -- defeating the purpose of the split.
- **Shamir reconstruction:** K_server is a share and K_local is a share of some master key. But the doc describes K_local as independently generated on the agent, which is incompatible with Shamir's setup phase (a trusted dealer generates all shares).

**Attack (Rogue Key Attack):** If additive combination is used without proof-of-knowledge of the discrete log:

1. Agent registers, generates K_local, publishes `K_local_pub`.
2. Directory (or attacker who compromised the directory) sees `K_local_pub`.
3. Directory sets `K_server = k_target - K_local` where `k_target` is a private key the directory controls.
4. Combined public key is `K_local_pub + K_server_pub = Target_pub`.
5. Directory can now sign messages as the agent.

**Prerequisites:** Compromised directory node, or a malicious insider.

**Impact:** Complete identity theft. The directory can impersonate any agent.

**Mitigation:** (a) Use a provably secure two-party key generation protocol such as GG20 or FROST. (b) Require zero-knowledge proofs of discrete log knowledge during key setup. (c) Specify the exact derivation scheme formally, then get it audited.

---

## Finding 2: K_server Reconstruction via Share Collection

**Severity:** Critical

**Description:** The document describes K_server as "split into 3 shares" across nodes, with "any 2 of 3" needed to sign. The agent then "requests shares from two nodes, combines locally, signs, discards." This means the full K_server is reconstructed on the agent's machine during every signing operation.

This defeats the entire purpose of threshold cryptography. The goal of threshold signing is that the secret key *never exists in one place*. If the agent reconstructs K_server locally:

1. Any memory dump, side-channel attack, or malware on the agent's machine during signing captures K_server in the clear.
2. The agent now has both K_local and K_server -- the split provides zero protection during the signing window.
3. A compromised agent has everything needed to sign independently, permanently.

**Attack (Signing Window Extraction):**

1. Attacker installs memory-scraping malware on the agent's machine.
2. Agent requests 2 of 3 K_server shares from directory nodes.
3. Agent reconstructs K_server in memory.
4. Malware captures K_server and K_local from memory.
5. Attacker now has the full signing key permanently, even after K_server rotation (they just repeat the scrape next rotation).

**Prerequisites:** Code execution on the agent's machine (common in the threat model -- the doc explicitly discusses stolen K_local).

**Impact:** Complete key compromise. The split-key security model provides no protection.

**Mitigation:** Use true threshold signing (e.g., FROST for Ed25519, GG20 for ECDSA) where partial signatures are computed on each node and combined, without ever reconstructing the secret key. This is the only correct approach.

---

## Finding 3: K_server Rotation Overlap Window

**Severity:** High

**Description:** The document states: "The directory rotates K_server on a schedule without requiring action from the agent." It shows:

```
Monday:    K_local + K_server_v1 -> signing_key_1
Tuesday:   K_local + K_server_v2 -> signing_key_2
```

The document does not specify:
- How the agent learns K_server has rotated.
- Whether there is a grace period where both K_server_v1 and K_server_v2 are valid.
- How in-flight signatures are handled during rotation.
- Whether the primary_pubkey changes on rotation (it must, if the derivation changes).

**Attack (Rotation Race Replay):**

1. Attacker captures a split-key signature signed with K_server_v1.
2. K_server_v2 is deployed, but during the transition window, nodes still accept v1.
3. Attacker replays the captured signature during the overlap.
4. If the grace period is long (hours), the attacker has a persistent replay window.

**Attack (Primary Public Key Confusion):**

1. K_server rotates. The derived primary_pubkey changes.
2. Agents who cached the old primary_pubkey now see all signatures as invalid.
3. They fall back to treating messages as fallback-only (K_local), which *reduces trust*.
4. The attacker doesn't need to do anything -- K_server rotation itself triggers a false compromise signal across the network.

**Prerequisites:** Observation of signed messages (passive attacker), or simply waiting for scheduled rotation.

**Impact:** Replay attacks during overlap, or network-wide trust degradation after each rotation cycle.

**Mitigation:** (a) Include K_server version identifier in every signed message. (b) Signatures must include the rotation epoch; verifiers reject signatures from expired epochs. (c) Publish new primary_pubkey atomically with rotation, and give clients a notification mechanism. (d) Define a precise overlap window and hard cutoff.

---

## Finding 4: Fallback Mode Downgrade Attack

**Severity:** Critical

**Description:** When the directory is unavailable, agents fall back to signing with K_local only. The receiver verifies against `fallback_pubkey` and accepts the connection at "reduced trust." The document treats this as graceful degradation. An attacker sees it as a downgrade attack surface.

**Attack (Forced Fallback via Directory DoS):**

1. Attacker DDoS attacks the directory nodes (or just the target agent's home node).
2. Target agent cannot reach the directory to obtain K_server shares.
3. Target agent falls back to K_local-only signing.
4. Attacker, who previously stole K_local (e.g., from a backup, a side-channel, or malware that was already removed), now has a fully valid signing key.
5. Attacker signs messages as the agent. Receiver sees "fallback mode" but accepts it because the directory is down for everyone.
6. The legitimate agent is also signing in fallback mode -- so the attacker's signatures are indistinguishable from the real agent's.

**Prerequisites:** Stolen K_local (which the doc explicitly models as a threat) + ability to DDoS the directory.

**Impact:** Full impersonation. The split-key scheme was designed to prevent exactly this scenario (stolen K_local should be useless), but fallback mode nullifies that protection on demand.

**Mitigation:** (a) Fallback-only signatures must be severely restricted -- perhaps only for reading, not initiating new connections. (b) Consider a time-limited fallback token signed by the directory during the last successful connection, which expires after N minutes. The agent proves recent directory contact even in fallback mode. (c) Receivers should reject fallback-signed connection requests from agents they have no prior relationship with. (d) Rate-limit the number of new connections an agent can initiate in fallback mode.

---

## Finding 5: Threshold Scheme Non-Specification

**Severity:** High

**Description:** The document acknowledges this is an open question ("which scheme? Shamir's secret sharing? ECDSA threshold signatures?") but proceeds to describe an architecture that depends on it. The security implications differ fundamentally:

| Scheme | Secret Reconstructed? | Signing Latency | Vulnerability |
|---|---|---|---|
| Shamir's Secret Sharing + local reconstruction | Yes (on agent) | Low (one round) | Finding 2 applies -- full key in memory |
| Threshold ECDSA (GG20/GG18) | No | High (multiple rounds, expensive MPC) | Requires honest majority; vulnerable to malicious abort |
| Threshold Ed25519 (FROST) | No | Medium (2 rounds) | Requires honest majority; simpler than GG20 |
| BLS threshold signatures | No | Low (non-interactive) | Requires pairing-friendly curves; not Ed25519 |

If Shamir is chosen (as the current description implies), Findings 1 and 2 are fatal. If FROST or GG20 is chosen, the protocol works but the architecture description (agent "combines locally, signs, discards") is wrong and must be rewritten.

**Impact:** The entire split-key security model is unimplementable as described.

**Mitigation:** Choose FROST (for Ed25519) or GG20 (for ECDSA) and redesign the signing flow as a proper MPC protocol between the agent and threshold nodes. The agent never holds K_server or any reconstructable share of it.

---

## Finding 6: Merkle Tree Ordering Ambiguity

**Severity:** High

**Description:** The document shows Merkle tree growth as sequential (msg 1, msg 2, msg 3). But it also acknowledges: "Race conditions -- what if both agents send simultaneously?" If Agent A and Agent B both send at the same instant:

1. Agent A's SDK creates leaf with `sequence_number = 5, prev_root = Root_4`.
2. Agent B's SDK creates leaf with `sequence_number = 5, prev_root = Root_4`.
3. The directory receives both hashes. Which is leaf 5 and which is leaf 6?
4. If the directory picks A first, it gets one tree. If B first, a different tree.
5. The sender, receiver, and directory now have divergent Merkle trees.

The `prev_root` chaining means the order of insertion is load-bearing. There is no conflict resolution mechanism described.

**Attack (Merkle Divergence Exploit):**

1. Attacker (one of the two agents) deliberately sends rapid-fire messages timed to collide with the counterparty's messages.
2. The three Merkle trees (sender, receiver, directory) diverge.
3. In a dispute, none of the three trees match, making the "directory as tiebreaker" mechanism useless.
4. The attacker denies what was said and points to the divergence as evidence of system unreliability.

**Prerequisites:** Timing control over message sends (trivial for any participant).

**Impact:** Non-repudiation guarantee is broken for concurrent messages.

**Mitigation:** (a) The directory must be the canonical ordering authority -- it assigns sequence numbers when hashes arrive. (b) Both agents must wait for the directory to acknowledge a hash and return the canonical sequence number before computing their local tree update. (c) Define a total ordering protocol (e.g., Lamport timestamps + directory tiebreaker).

---

## Finding 7: First Message Edge Case in prev_root Chaining

**Severity:** Medium

**Description:** The leaf format includes `prev_root` which "chains to previous state, creates hash chain." For the very first message in a conversation, there is no previous root. What value is used?

If `prev_root = null` or `prev_root = 0x00...00`, this is a known constant. An attacker could pre-compute the first leaf hash of any conversation between any two agents (since `sender_pubkey` is public, `sequence_number` is 1, and `prev_root` is known), reducing the hash to depending only on `message_content`, `scan_result`, and `timestamp`.

More importantly: if the first message uses a sentinel value for `prev_root`, there is no chain integrity for the first message. The chain only starts providing value from message 2 onward.

**Attack:** An attacker who controls the directory could substitute a different first message hash (since there is no prior root to chain against) and construct a valid tree from that point forward.

**Prerequisites:** Compromised directory node.

**Impact:** The first message of every conversation has weaker integrity guarantees.

**Mitigation:** (a) Define a conversation initialization hash that both parties agree on before any messages are sent (e.g., `hash(agent_A_pubkey || agent_B_pubkey || session_id || timestamp)`). (b) Use this as the `prev_root` for the first leaf. Both parties can independently compute it.

---

## Finding 8: Directory Selective Hash Withholding

**Severity:** High

**Description:** The directory receives hashes from both agents and relays them. The protocol assumes the directory faithfully relays all hashes. But a compromised directory node (or a node under legal compulsion) could:

1. **Withhold a hash entirely:** Agent A sends hash to directory. Directory never relays it to Agent B. Agent B never receives the hash to compare. Agent B receives the message via the separate transport path but has no hash to verify against.
2. **Delay a hash:** Directory holds the hash for hours, then delivers it. During the delay, Agent B has no way to verify message integrity.
3. **Selectively drop hashes:** Drop hashes only for certain conversations, creating targeted blind spots.

The document states Agent B "hashes received msg, compares to relay hash" -- but what happens when the relay hash never arrives? The protocol does not specify a timeout or a "hash not received" behavior.

**Attack (Selective Censorship):**

1. Law enforcement or a state actor compels the directory to suppress hashes for a target conversation.
2. Messages still flow (via the separate transport), but the integrity guarantee silently disappears.
3. The target agents see messages arriving without corresponding hashes and have no specified behavior for this case.
4. An active MITM on the message transport can now modify messages without detection.

**Prerequisites:** Compromised or coerced directory.

**Impact:** Complete loss of tamper detection for targeted conversations.

**Mitigation:** (a) Define an explicit timeout: if a hash is not received within N seconds of a message, the SDK must alert the user and refuse to process the message (or flag it prominently). (b) Both agents should periodically exchange Merkle roots directly (out of band from the directory) to detect withholding. (c) Agents should be able to send hashes to each other directly as a backup path.

---

## Finding 9: Nonce Predictability in Challenge-Response

**Severity:** Medium

**Description:** The challenge-response authentication sends a "random challenge (nonce)" from the directory. The security depends entirely on the quality of this nonce. The document does not specify:

- The nonce length (should be at least 128 bits).
- The entropy source (CSPRNG required).
- Whether the nonce is single-use (must be).
- Whether the nonce includes a timestamp or binding to the session.

**Attack (Precomputed Signature Table):**

1. If the nonce space is small or predictable (e.g., timestamp-based, sequential, or weak PRNG), an attacker who stole K_local could precompute signatures for likely future nonces.
2. When the directory issues a predicted nonce, the attacker responds instantly with the precomputed signature.

**Attack (Compromised Directory Issues Known Nonces):**

1. A compromised directory node issues a nonce that was previously used in another authentication session.
2. If the directory has recorded the legitimate agent's response to that nonce, it replays the response to authenticate as the agent.
3. This works because the challenge-response doesn't bind to a session identifier or timestamp.

**Prerequisites:** Compromised directory (for replay) or weak PRNG + stolen K_local (for precomputation).

**Impact:** Authentication bypass.

**Mitigation:** (a) Nonces must be 256-bit CSPRNG output. (b) Nonces must be single-use, tracked in a nonce store with expiry. (c) The signed response must include: the nonce, the agent's ID, the directory node's ID, and a timestamp. This binds the response to a specific session and prevents cross-node replay. (d) Consider mutual authentication -- the agent should also challenge the directory to prove it holds a legitimate node key.

---

## Finding 10: No Mutual Authentication

**Severity:** High

**Description:** The challenge-response protocol is one-directional: the directory challenges the agent. The agent never verifies the directory's identity cryptographically during the WebSocket handshake.

**Attack (Rogue Directory Node):**

1. Attacker sets up a fake directory node.
2. Agent connects (via DNS poisoning, BGP hijack, or compromised node list).
3. Fake directory sends a challenge. Agent signs it (proving its identity to the attacker).
4. Fake directory now has a valid signature from the agent on a nonce the attacker chose.
5. If this signed nonce can be replayed to a real directory node (see Finding 9), the attacker can impersonate the agent.
6. Even without replay, the fake directory can serve false public keys for other agents, causing the agent to communicate with attacker-controlled endpoints while believing it is talking to legitimate agents.

**Prerequisites:** Ability to redirect the agent's WebSocket connection (DNS poisoning, compromised initial node list, network-level attack).

**Impact:** Agent unknowingly connects to a fake directory, leading to impersonation or misdirection.

**Mitigation:** (a) Mutual TLS with certificate pinning for directory nodes. (b) The agent should verify the directory node's identity by checking its signature against the consortium's known node keys. (c) The challenge-response should be bidirectional.

---

## Finding 11: Ed25519 Nonce Safety vs ECDSA Nonce Catastrophe

**Severity:** Medium

**Description:** The document mentions "Ed25519/ECDSA" as signature scheme options but does not commit. The nonce risk profile is dramatically different:

- **Ed25519:** Deterministic nonces (RFC 8032). The nonce is derived from the private key and the message. No external randomness needed. Nonce reuse is impossible in a correct implementation. This is the safe choice.
- **ECDSA:** The standard algorithm uses random nonces. If the PRNG is weak, biased, or fails, the private key can be recovered from *a single signature*. This is not theoretical -- it has happened in production (Sony PS3 ECDSA breach, Android Bitcoin wallet vulnerability, multiple smart contract exploits).

If ECDSA is chosen, the protocol inherits all nonce-related vulnerabilities. If the agent runs on constrained hardware (embedded systems, IoT, robots -- explicitly in scope), the risk of weak randomness is elevated.

**Prerequisites:** ECDSA choice + weak PRNG on agent hardware.

**Impact:** Private key recovery from observed signatures.

**Mitigation:** (a) Mandate Ed25519 as the primary signature scheme. (b) If ECDSA must be supported, require RFC 6979 deterministic nonces. (c) Never use raw random nonces for ECDSA.

---

## Finding 12: Hash Correlation and Traffic Analysis

**Severity:** Medium

**Description:** The directory receives 32-byte hashes for every message. It does not see message content. However, it sees:

- **Who is talking to whom** (agent IDs on each hash).
- **When** (timestamp on each hash).
- **Message frequency** (hash arrival rate).
- **Message size** (if the hash covers a length field, or via timing correlation with the transport path).
- **Conversation duration and patterns** (start/end times, burst patterns).

This is metadata, and metadata is surveillance. The NSA's former general counsel stated: "We kill people based on metadata."

**Attack (Conversation Fingerprinting):**

1. Directory (or entity with access to directory logs) observes that Agent X always sends a 5-message burst to Agent Y every Monday at 9am.
2. This pattern, combined with public knowledge of what Agent Y does (e.g., a legal review agent), reveals that Agent X has a weekly legal consultation.
3. No message content needed.

**Attack (Cross-Conversation Linkability):**

1. Agent A talks to Agent B, then Agent B talks to Agent C with similar timing.
2. The directory can infer a message chain: A -> B -> C.
3. Over time, the directory builds a social graph of agent interactions.

**Prerequisites:** Access to directory hash relay logs (available to any directory operator).

**Impact:** Metadata surveillance. The privacy guarantee ("directory never sees content") is real but narrower than it sounds.

**Mitigation:** (a) Acknowledge this limitation in the threat model. (b) Consider mixing/batching hashes with random delays to obscure timing (at the cost of real-time verification). (c) For high-sensitivity conversations, allow agents to relay hashes through an onion-routed path rather than direct to the directory. (d) Minimize the metadata attached to each hash -- consider whether agent IDs can be pseudonymized at the hash relay layer.

---

## Finding 13: Merkle Tree Padding Oracle

**Severity:** Low

**Description:** The tree growth example shows:

```
After msg 3: Root_3 = hash(hash(L1+L2) + hash(L3+padding))
```

When the number of leaves is not a power of 2, padding is required. The choice of padding value matters:

- If padding is a constant (e.g., `0x00...00`), it is distinguishable from a real leaf. An attacker who can observe the tree structure can determine the exact message count (not just "odd or even").
- If padding is a copy of the sibling leaf (RFC 6962 approach to avoid second-preimage attacks), this changes the security properties.

More critically: in RFC 6962 (Certificate Transparency), the standard approach uses a domain separator (`0x00` for leaf nodes, `0x01` for internal nodes) to prevent second-preimage attacks where an internal node hash is reinterpreted as a leaf hash. The document does not mention domain separation.

**Attack (Second Preimage via Missing Domain Separation):**

1. Attacker crafts a message whose leaf hash equals an internal node hash in the tree.
2. This allows the attacker to substitute a subtree with a single crafted message, altering the tree without changing the root.

**Prerequisites:** Ability to craft messages with specific hash values (computationally infeasible for SHA-256, but becomes relevant with weaker hashes or truncated hashes).

**Impact:** Tree manipulation without root change. Low practical risk with SHA-256 but a design flaw nonetheless.

**Mitigation:** (a) Use domain-separated hashing: `leaf_hash = H(0x00 || leaf_data)`, `node_hash = H(0x01 || left || right)`. (b) Follow RFC 6962 Merkle tree construction exactly. (c) Specify the padding scheme explicitly.

---

## Finding 14: Sequence Number Manipulation

**Severity:** Medium

**Description:** The leaf format includes `sequence_number`. The document does not specify who assigns sequence numbers or how they are validated. If the sender assigns their own sequence numbers:

**Attack (Gap Insertion):**

1. Attacker (a malicious agent) sends messages with sequence numbers 1, 2, 5, 6.
2. The receiver sees a gap (3, 4 missing).
3. Was this a network issue or did the attacker intentionally skip messages?
4. If the receiver's policy is to accept gaps (network unreliability), the attacker can selectively omit messages from the Merkle tree.

**Attack (Sequence Reset):**

1. After a "key rotation," the attacker resets the sequence number to 1.
2. Old messages with the same sequence numbers now exist under different keys.
3. The prev_root chain should catch this, but if the rotation also resets the Merkle tree (new conversation), historical evidence is partitioned.

**Prerequisites:** Participation in a conversation (any agent).

**Impact:** Ability to omit messages from the verifiable record.

**Mitigation:** (a) The directory must assign and enforce contiguous sequence numbers. (b) Both agents must reject messages with gaps until the gap is resolved. (c) Sequence numbers must never reset within a conversation, even across key rotations.

---

## Finding 15: Emergency Revocation Race Condition

**Severity:** High

**Description:** The "Not me" button revokes K_server "instantly." But the attacker has already signed messages. Between the moment of compromise and the moment of revocation:

1. Attacker signs messages with the valid split-key.
2. These messages have valid signatures and valid Merkle tree entries.
3. After revocation, these messages remain in the Merkle tree as valid.
4. The receiver has no way to distinguish pre-revocation legitimate messages from pre-revocation attacker messages.

The window between compromise and revocation could be seconds (if the owner is watching) or days (if the owner is asleep or away).

**Attack (Sprint Signing):**

1. Attacker compromises K_local and K_server (or forces fallback mode per Finding 4).
2. Attacker signs hundreds of messages -- contracts, agreements, transfers -- in minutes.
3. Owner wakes up, taps "Not me."
4. The signed messages are in the Merkle tree with valid signatures.
5. Third parties who received these messages have cryptographic proof they were signed by the agent's key.

**Prerequisites:** Key compromise + any delay in owner detection.

**Impact:** Non-repudiable fraudulent messages.

**Mitigation:** (a) Define a "dispute window" after revocation where all messages signed within N hours before revocation are flagged as potentially fraudulent. (b) Receivers should treat recent messages from a revoked key as disputed, not confirmed. (c) High-value operations (fund transfers, contract signing) should require fresh human authentication, not just agent signatures.

---

## Finding 16: Phone-as-Root-of-Trust Fragility

**Severity:** High

**Description:** The phone number is the root of trust for: registration, KMS auth, activity monitoring, and emergency revocation. The document acknowledges SIM-swap risk but characterizes it as comparable to other systems. The specific threat to CELLO is worse because:

1. A SIM-swap gives the attacker control of the registration channel.
2. The attacker can register a *new* agent with the same phone number.
3. Or the attacker can perform emergency revocation on the legitimate agent (DoS).
4. If the agent has no WebAuthn registered (phone-only baseline), the attacker has full account control.

The document says "without WebAuthn are more exposed" but the baseline tier (the most common user) has phone-only auth.

**Attack (SIM-Swap Full Takeover):**

1. Attacker SIM-swaps the target's phone.
2. Attacker taps "Not me" -- revokes the legitimate agent's K_server.
3. Attacker initiates re-keying.
4. If no WebAuthn is registered: attacker completes re-keying with phone OTP alone.
5. Attacker now controls the agent's identity. The legitimate owner is locked out.

**Prerequisites:** SIM-swap (cost: $50-500 on criminal markets, well-documented attack).

**Impact:** Complete account takeover for phone-only agents.

**Mitigation:** (a) Re-keying should never be possible with phone-only auth. If no WebAuthn is registered, re-keying requires an out-of-band identity verification process (e.g., video call with CELLO support, government ID). (b) Consider requiring at least one WebAuthn factor before the agent can hold any funds or perform marketplace transactions. (c) Add a time delay (24-48 hours) for re-keying on phone-only accounts, with notifications to the original phone number and any linked email/social accounts.

---

## Finding 17: Append-Only Log Ordering Attack

**Severity:** Medium

**Description:** The append-only directory log uses entry-level hash chaining: each entry hashes the previous one. The document does not specify how entries from different registration events are ordered when multiple nodes receive registrations concurrently.

**Attack (Registration Front-Running):**

1. Attacker observes Agent A beginning registration on Node 1.
2. Attacker simultaneously registers a similar agent on Node 2 with a confusingly similar name/capability.
3. Depending on how the log entries are ordered across nodes, the attacker's entry might appear first.
4. Agents searching the directory find the attacker's agent before the legitimate one.

**Prerequisites:** Observation of registration activity + ability to register quickly.

**Impact:** Impersonation via name squatting.

**Mitigation:** (a) Define a deterministic ordering protocol for the append-only log (e.g., consensus-based ordering, or a single leader for log appends). (b) Agent names/identifiers should be cryptographically bound to the registrant's key, not first-come-first-served.

---

## Finding 18: Consensus Checkpoint Lag Exploitation

**Severity:** Medium

**Description:** The identity Merkle tree is checkpointed "periodically" (frequency unspecified). Between checkpoints, a compromised node can serve stale or manipulated data that the client cannot verify against a checkpoint.

**Attack (Inter-Checkpoint Data Manipulation):**

1. Checkpoint N is published at time T.
2. At T+1, Agent X updates their public key (legitimate rotation).
3. A compromised node continues serving the old public key from Checkpoint N.
4. Client requests Agent X's key, receives the old key with a valid Merkle proof against Checkpoint N.
5. Client accepts the old key because the proof is valid against the most recent checkpoint.
6. Client connects to Agent X using an expired key, enabling a MITM by anyone who holds the old key.

**Prerequisites:** Compromised node + time between checkpoints.

**Impact:** Stale key serving enables MITM during the inter-checkpoint window.

**Mitigation:** (a) Critical operations (key rotation, revocation) must trigger an immediate checkpoint. (b) Clients should request data from multiple nodes and reject responses where nodes disagree. (c) Include a "last modified" timestamp in the response, and reject data that is fresher than the checkpoint it proves against (indicating the proof is stale).

---

## Finding 19: Hash Function Non-Specification

**Severity:** Medium

**Description:** The document mentions "32-byte hashes" and references SHA-256 in example output but never formally specifies the hash function. The Merkle tree security depends entirely on the collision resistance of the chosen hash.

If the protocol allows negotiation of hash functions (for "future-proofing"), an attacker could downgrade to a weaker function. If different nodes use different hash functions, the trees diverge silently.

**Mitigation:** (a) Mandate a single hash function (SHA-256 is appropriate). (b) Encode the hash algorithm in the protocol version, not negotiated per-session. (c) Plan for hash algorithm migration as a protocol version bump, not a runtime option.

---

## Finding 20: No Forward Secrecy for Message Content

**Severity:** Medium

**Description:** Messages are signed but the document does not mention encryption. If messages are sent in plaintext (which appears to be the case for platform transports like Slack/Discord), the signing provides authentication and integrity but not confidentiality.

For P2P (libp2p) connections, the document mentions "ephemeral libp2p peer IDs" which suggests Noise protocol encryption is likely, but this is not specified.

If messages are encrypted using the split-key or K_local, there is no forward secrecy -- compromise of K_local reveals all past encrypted messages.

**Impact:** No confidentiality guarantee. The protocol provides authentication and integrity but not secrecy.

**Mitigation:** (a) For P2P connections, mandate ephemeral Diffie-Hellman key exchange (e.g., X25519) with the Noise protocol for forward secrecy. (b) For platform transports, acknowledge that confidentiality depends on the platform. (c) Do not use the signing keys for encryption -- this is a well-known anti-pattern.

---

## Finding 21: Conclaves -- Gate Node Single Point of Failure

**Severity:** Medium

**Description:** The brief Conclaves section mentions a "gate node" that "scans every inbound message before distribution." This gate node:

1. Sees all message content (unlike the hash-relay model).
2. Is a single point of compromise -- if the gate node is compromised, all group messages are exposed.
3. Can selectively censor messages to specific participants.
4. Can inject messages into the group.

This is a fundamentally different security model from the peer-to-peer design and breaks the "directory never sees content" principle.

**Mitigation:** (a) The gate node should only receive hashes, not content, consistent with the peer-to-peer model. (b) If content scanning is needed, each participant should scan locally (as in the P2P model). (c) If a centralized gate node is required, it must be operated under explicit trust with clear threat model documentation.

---

## Finding 22: SDK Auto-Update as Attack Vector

**Severity:** Medium

**Description:** The document specifies `npx @cello/mcp-server` as the installation command. `npx` fetches and executes the latest version from npm on every run. Combined with the fact that the SDK "handles all cryptography, scanning, transport, and directory communication":

**Attack (Supply Chain via npm):**

1. Attacker compromises the npm publishing pipeline (compromised CI, stolen npm token, dependency confusion).
2. Publishes a malicious version of `@cello/mcp-server`.
3. Every agent using `npx` (which fetches latest) automatically runs the malicious code on next invocation.
4. Malicious SDK exfiltrates K_local, or signs attacker-chosen messages, or disables prompt injection scanning.

The document mentions npm provenance, Sigstore, and reproducible builds as mitigations, but `npx` does not verify any of these by default. The verification commands (`npm audit signatures`) are manual.

**Prerequisites:** Compromise of the npm publishing pipeline (has happened to high-profile packages before: event-stream, ua-parser-js, colors.js).

**Impact:** Mass compromise of all CELLO agents simultaneously.

**Mitigation:** (a) Do not recommend `npx` for production use -- recommend pinned versions with lockfiles. (b) The SDK should verify its own integrity on startup (self-check against a known hash). (c) Implement automatic Sigstore verification in the installation process.

---

## Open Questions Requiring Formal Analysis

1. **Key derivation scheme:** The `derived(K_local + K_server)` notation must be formally specified. Until this is defined, no security proof is possible. This is the most urgent gap.

2. **Threshold scheme choice and parameters:** The choice between FROST, GG20, and Shamir determines whether Finding 2 is fatal or moot. This must be decided before any implementation begins.

3. **Merkle tree specification:** The exact tree construction (hash function, domain separation, padding, leaf serialization format) needs a formal spec. Subtle deviations cause interoperability failures and can introduce vulnerabilities.

4. **Formal threat model:** The document describes attacks informally but lacks a formal adversary model. What can the adversary observe? What can they corrupt? What is the corruption model for directory nodes (crash-only? Byzantine? adaptive?)? Without this, security claims cannot be evaluated rigorously.

5. **Key lifecycle formalization:** The complete state machine for key states (active, rotating, revoked, expired) and the valid transitions between them needs formal specification. Race conditions in state transitions are a common source of vulnerabilities.

6. **Concurrency model for the Merkle tree:** The three-party tree (sender, receiver, directory) must converge deterministically. The protocol for achieving this under concurrent message sends is not specified and is non-trivial.

---

## Summary of Findings by Severity

| Severity | Count | Findings |
|---|---|---|
| Critical | 3 | #1 (Phantom Key Derivation), #2 (K_server Reconstruction), #4 (Forced Fallback Downgrade) |
| High | 7 | #3 (Rotation Overlap), #5 (Threshold Non-Specification), #6 (Merkle Ordering), #8 (Selective Hash Withholding), #10 (No Mutual Auth), #15 (Sprint Signing), #16 (Phone Root-of-Trust) |
| Medium | 11 | #7 (First Message Edge Case), #9 (Nonce Predictability), #11 (Ed25519 vs ECDSA Nonces), #12 (Traffic Analysis), #13 (Padding Oracle), #14 (Sequence Number Manipulation), #17 (Log Ordering), #18 (Checkpoint Lag), #19 (Hash Non-Specification), #20 (No Forward Secrecy), #21 (Conclaves Gate Node), #22 (SDK Auto-Update) |
| Low | 1 | #13 (Merkle Padding Oracle) |

The three Critical findings (#1, #2, #4) are blocking. They represent fundamental design issues in the split-key scheme that must be resolved before implementation begins. Finding #1 (key derivation is unspecified) and #2 (secret reconstruction defeats the security model) mean the core security primitive does not currently work as described. Finding #4 (forced fallback nullifies split-key protection) means an attacker with a stolen K_local can bypass the split-key at will.

The recommended priority: choose and formally specify a threshold signing scheme (FROST for Ed25519), redesign the signing flow as a true MPC protocol, eliminate fallback mode for security-critical operations, and add mutual authentication to the directory protocol. These four changes address the most serious vulnerabilities and provide a sound foundation for the rest of the protocol.
