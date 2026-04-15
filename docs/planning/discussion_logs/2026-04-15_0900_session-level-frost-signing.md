---
name: "Session-Level FROST Signing — Removing Per-Message FROST"
type: discussion
date: 2026-04-15 09:00
topics: [FROST, split-key, signing, K_local, K_server, session-management, seal, compromise-canary, fallback-mode, P2P, hash-relay, latency, directory-architecture]
description: "Design decision to remove per-message FROST signing. FROST ceremonies now occur only at session establishment and conversation seal. Individual messages are signed with K_local alone and verified against pubkey(K_local). The directory's real-time role becomes passive hash-relay notary, not active co-signer."
---

# Session-Level FROST Signing — Removing Per-Message FROST

## The problem with per-message FROST

The prior design required a FROST ceremony for every outbound message. The ceremony — agent contributes K_local partial signature, directory nodes contribute K_server partial signatures, combined signature produced — had to complete before the message could be delivered.

This created three problems:

1. **Sequential bottleneck.** Every message send required at least one network round trip to the directory before the message could reach the recipient. The flow was not "send to the directory and send to B simultaneously" — it was "send to the directory, complete FROST, then send to B." The directory was in the critical path of every message.

2. **Directory as centralized intermediary.** The directory was an active participant in every message exchange, not a background notary. This contradicted the design intent: the directory should be a public notary that records proof of conversations without being inserted into the real-time message flow.

3. **Single point of failure for all communication.** If the directory was unreachable, no messages could be signed, and communication halted entirely. Every conversation depended on directory availability for every message.

### What per-message FROST actually protects against

Per-message FROST detects exactly one scenario: K_local is extracted from the agent's machine while a session is already active, and the attacker uses it from a different location. The directory would see competing FROST requests from two sources.

This scenario is narrow:
- If K_local is compromised **before** session establishment, per-message FROST provides no protection — the attacker has K_local, initiates FROST, the directory co-signs. The attacker IS the agent.
- If K_local is compromised **during** a session, the attacker must also know the current Merkle tree state (prev_root) to construct a valid leaf. This requires either monitoring the conversation in real time or hijacking the P2P connection.
- If the attacker has achieved full machine compromise (can monitor conversations and extract keys), per-message FROST does not help — the attacker can use the legitimate agent's FROST sessions.

The realistic threat — remote key extraction without full machine takeover, during an active session, with the attacker racing to use the key before the session ends — is an extremely narrow attack surface. The cost of defending against it (directory RTT on every message, directory as real-time bottleneck, complete communication halt on directory outage) is disproportionate.

---

## The new model: session-level FROST

FROST ceremonies occur at two points:

1. **Session establishment** — when A and B initiate a conversation. Both agents authenticate to the directory via mutual challenge-response. The directory verifies both identities and co-signs the session establishment. This is the FROST ceremony that proves "A is who it claims to be" and "B is who it claims to be."

2. **Conversation seal** — when the conversation closes. The final Merkle root is co-signed by the participants and the directory via FROST. This is the notarial act: the directory attests that this conversation existed with this final state. The sealed root enters the MMR.

Between these two points, individual messages are signed with **K_local alone** and verified against **pubkey(K_local)**.

### The message flow

When Agent A sends a message to Agent B:

1. A composes the message.
2. A builds a signed Merkle leaf containing: hash(message), prev_root (committing to all previous messages), and A's K_local signature over the leaf.
3. A sends two things **simultaneously**:
   - To B via P2P: the signed leaf + the message content.
   - To the directory: the signed leaf (hash only, no content).
4. Neither delivery blocks the other. B processes the message immediately on receipt from A.

The directory records the signed leaf in its copy of the Merkle tree. B compares the leaf received from A against the leaf received from the directory. If they match, neither A nor the directory tampered. If they don't match, tampering is detected.

The directory never sees the message content. It receives only the signed leaf (containing the content hash). The P2P channel delivers the content. This preserves the core privacy property: hash relay, not message relay.

### What B does on receipt

**B receives from A first (common case):** B has the signed leaf and the content. B verifies: K_local signature, hash(content) matches leaf, prev_root chains correctly. B accepts and processes immediately. When the directory's copy arrives later, B confirms it matches.

**B receives from the directory first:** B has the signed leaf but no content. B waits for A's copy with the content. On arrival, B checks that hash(content) matches the leaf already received.

**Directory is slow or down:** B continues the conversation with A via P2P. The Merkle chain (each leaf commits to prev_root) provides ordering and tamper detection without the directory. The directory's notarial record falls behind but can be backfilled on recovery.

### Bilateral and notarized seals

**Bilateral seal (no directory needed):** A and B agree the conversation is over. Both have identical Merkle trees. Both sign the final root with K_local and exchange attestations. This proves A and B agree on the conversation record. Can happen with the directory completely down.

**Notarized seal (FROST):** The directory receives the complete leaf sequence (real-time or backfilled), verifies the chain, and co-signs the final root via a FROST ceremony. The sealed root enters the MMR. This adds third-party attestation — credible to parties who weren't present.

If the directory is down at conversation end, A and B complete the bilateral seal immediately. The notarized seal is deferred until recovery.

---

## Impact on the compromise canary

The compromise canary still exists but operates at session boundaries, not per message.

**Session establishment:** If the FROST ceremony at session start succeeds, both K_local and K_server participated. The session is authenticated.

**Conversation seal:** If the FROST ceremony at seal succeeds, the directory attests to the final state.

**What changes:** There is no per-message canary. If K_local is stolen mid-session, the attacker could sign messages with K_local that B would accept (because per-message verification uses K_local only). Detection happens at the next session establishment attempt, not message by message.

**Why this is acceptable:** The Merkle hash chain provides structural tamper detection. Each leaf commits to prev_root, so an attacker cannot insert, remove, or reorder messages without the chain diverging. The attacker would also need to know the current tree state to construct valid leaves. And the practical reality: if K_local is stolen during a session, it will also be stolen for subsequent sessions — the compromise is detected at the next FROST ceremony.

---

## Impact on fallback / degraded mode

The fallback problem becomes **significantly less severe** under session-level FROST.

**Previous model (per-message FROST):** Directory outage → no FROST ceremonies → no valid message signatures → all communication halts → mass fallback to K_local-only → compromise canary fires network-wide → panic.

**New model (session-level FROST):** Directory outage → cannot establish new sessions → cannot seal conversations → **but existing conversations continue normally**. Messages are signed with K_local, which is the normal signing mode. The Merkle chain provides ordering and tamper detection. A and B can complete their conversation, perform a bilateral seal, and defer the notarized seal until recovery.

The directory outage affects only: new connection establishment and conversation notarization. It does not affect conversations already in progress. This is a fundamental improvement in resilience.

---

## Impact on P2P architecture

The P2P channel is now the primary message delivery path, not a secondary path that runs after the FROST ceremony completes. The directory receives signed leaves in parallel but is not in the critical path.

The value of P2P is structural, not latency: the directory never sees message content. If all content flowed through the directory, a malicious directory could modify content and recompute the hash consistently — B could not detect tampering because both the content and the attestation came from the same source. With P2P, the directory can only tamper with the hash relay path; the content path carries A's K_local signature, which the directory cannot forge. The dual-path cross-check is what makes a dishonest directory detectable.

---

## Impact on K_server rotation (Problem 9)

K_server rotation now affects a much narrower window. FROST ceremonies only happen at session establishment and seal — not on every message. A rotation that occurs during a conversation has no impact on message signing (messages use K_local). The rotation only matters if it coincides with a session establishment or seal ceremony.

This reduces the K_server rotation problem from "every message could straddle a rotation boundary" to "only session-start and seal ceremonies could straddle a rotation boundary." The window of exposure shrinks by orders of magnitude.

---

## Summary of the signing model

| Operation | Signing mechanism | Directory involvement |
|---|---|---|
| Session establishment | FROST (K_local + K_server) | Active — co-signs |
| Per-message signing | K_local only | Passive — records signed leaf |
| Hash relay | K_local signature on leaf | Passive — relays to recipient |
| Bilateral seal | K_local only | None |
| Notarized seal | FROST (K_local + K_server) | Active — co-signs final root |

---

## Related Documents

- [[cello-design|CELLO Design Document]] — message signing flow and compromise canary sections updated to reflect this decision
- [[end-to-end-flow|CELLO End-to-End Protocol Flow]] — §2.3 (FROST signing) and message flow sections updated
- [[2026-04-14_1100_cello-mcp-server-tool-surface|CELLO MCP Server Tool Surface]] — `cello_send` no longer performs FROST; signs with K_local
- [[2026-04-13_1500_multi-party-conversation-design|Multi-Party Conversation Design]] — sender_signature uses K_local; directory builds canonical tree without per-message co-signing
- [[2026-04-13_1100_quantum-resistance-design|Quantum Resistance Design]] — FROST remains for session/seal; scope of quantum debt narrowed to session boundaries
- [[2026-04-10_1100_fallback-downgrade-attack-defense|Fallback Downgrade Attack Defense]] — fallback severity reduced: existing conversations unaffected by directory outage
- [[design-problems|Design Problems]] — Problem 9 (K_server rotation) window narrowed; Problem 1 (fallback downgrade) severity reduced
- [[2026-04-08_1430_protocol-strength-and-commerce|Protocol Strength and Commerce]] — hash signing uses K_local, not FROST
- [[2026-04-11_1400_libp2p-dht-and-peer-connectivity|libp2p, DHT, and Peer Connectivity]] — FROST is for session/seal, not per-message signing
- [[2026-04-11_1700_persistence-layer-design|Persistence Layer Design]] — no schema changes required; signing mechanism is above the persistence layer
