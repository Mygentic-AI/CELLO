---
name: CELLO Protocol Map
type: design
date: 2026-04-16
topics: [identity, trust, FROST, merkle-tree, connection-policy, endorsements, PSI, prompt-injection, dispute-resolution, discovery, compliance, recovery, key-management, federation, transport, sybil-defense, persistence, MCP-tools, quantum-resistance, session-termination, notifications, succession]
status: active
description: Top-level orientation document — protocol domains, what's decided, where to find the deep reference, which discussion logs matter, and readiness for user stories.
---

# CELLO Protocol Map

CELLO is a peer-to-peer identity and trust layer for agent-to-agent communication. Agents register with verified identities, discover each other through a federated directory, and communicate with tamper-proof guarantees — without trusting a centralized platform. The directory never sees message content; it sees only SHA-256 hashes. Disputes are resolved by comparing Merkle trees — arbitration without surveillance.

The on-ramp is a free, open-source secure communication client. The prompt injection defense works standalone — no sign-up, no network dependency. Once an agent uses the client, the path to discovery and trusted collaboration is already there.

**Core invariants** — if a proposed mechanism violates any of these, it needs to be redesigned:

1. **Hash relay, not content relay.** The directory sees hashes, never content.
2. **Client is the enforcer.** Merkle proofs, endorsement hashes, scan results, signature checks — verified locally.
3. **FROST bookends the conversation.** Session establishment and seal use FROST; individual messages use K_local.
4. **Degraded state raises the guard.** Directory unavailability is a reason to refuse new connections, not accept weaker ones.
5. **All identity signals are optional enrichment.** Phone OTP and email are the only registration requirements.
6. **Non-repudiation is the foundation of commerce.** A 32-byte Merkle root proves an entire conversation.

---

## How to Use This Document

This is the first document an agent or human should read. It maps the entire protocol across eight domains. Each domain tells you:

- **What's decided** — 3-5 sentences summarizing the current design
- **Canonical source** — the section of [[end-to-end-flow|end-to-end-flow.md]] that covers this in full
- **Key discussion logs** — the design sessions that shaped this domain, ordered by importance
- **Readiness** — whether the domain is ready for user stories

For the deep narrative connecting all domains into a single story, read [[end-to-end-flow|CELLO End-to-End Protocol Flow]]. For the original brainstorm and vision, see [[cello-design|CELLO Design Document]].

---

## Domain 1: Identity and Trust Signals

**What's decided.** Registration is autonomous via WhatsApp/Telegram — phone OTP and email are the only requirements. The human owner can optionally strengthen the trust profile via a web portal: WebAuthn, TOTP 2FA, LinkedIn/GitHub/Twitter OAuth, and more. Every verification produces a structured JSON record; the directory hashes it (SHA-256), stores only the hash, and discards the original. The client is the custodian of its own identity data. Trust is expressed as named signals evaluated independently — there is no single numeric trust score, no TrustRank, no propagated score. Connection policies specify named signal requirements via `SignalRequirementPolicy`.

Device attestation (TPM, Play Integrity, App Attest) requires a native app and is a zero-friction Sybil defense when available. WebAuthn is classified as an account security signal (tethering), not device sacrifice. SIM age and carrier intelligence are day-two enhancements that further raise the Sybil floor.

**Canonical source:** [[end-to-end-flow|end-to-end-flow.md]] — Part 1: Identity (§1.1–§1.5)

**Key discussion logs:**
- [[2026-04-17_1000_trust-signal-pickup-queue|Trust Signal Pickup Queue]] — async oracle handoff design; encrypted pickup queue using identity_key; three-state trust signal UI (active / pending delivery / expired)
- [[2026-04-14_1500_deprecate-trust-seeders-and-trustrank|Deprecate Trust Seeders and TrustRank]] — removes TrustRank and Trust Seeders; the signal-based model is canonical
- [[2026-04-13_1000_device-attestation-reexamination|Device Attestation Reexamination]] — corrects WebAuthn classification; native app required for platform attestation
- [[2026-04-08_1930_client-side-trust-data-ownership|Client-Side Trust Data Ownership]] — hash-everything model; client as data custodian
- [[2026-04-11_1000_sybil-floor-and-trust-farming-defenses|Sybil Floor and Trust Farming Defenses]] — 8-layer anti-Sybil architecture
- [[2026-04-11_1400_security-architecture-layers-and-trust-signal-classes|Security Architecture Layers and Trust Signal Classes]] — four-class trust signal taxonomy

**Readiness: Stable.** All design decisions resolved. No blocking open items. Implementation choices (API selection, scoring weights) are engineering decisions.

---

## Domain 2: Directory Infrastructure

**What's decided.** The directory is an append-only log of signed operations, not a mutable database. Two separate Merkle trees: an identity tree (agent profiles, keys, trust signal hashes — checkpointed periodically) and a message tree (per-conversation hash chain — updated per message). A global meta-Merkle tree (MMR) over all conversation registrations prevents fabricated conversation attacks.

Nodes deploy in three phases: Alpha (~6 CELLO-operated, ~4-of-6), Consortium (~20 vetted multi-cloud, ~11-of-20), Public (50+ permissionless with proof-of-stake, rotating ~5-of-7). Directory nodes (public-facing, handle auth, FROST, connection brokering) are separated from relay nodes (session-level Merkle engines: hash relay, sequence numbering, tree building during active sessions, plus NAT traversal). PII lives in the signup portal — directory nodes hold only public keys, trust signal hashes, K_server_X shares (envelope-encrypted), and Merkle trees. All directory data is fully federated across all nodes.

Consensus is only needed for directory state changes and canonical sequence numbers. The real-time path (primary assigns sequence numbers, ACKs agents) is fully separated from consensus (periodic background checkpoints). Primary/backup replication with fire-and-forget to 2-3 lowest-latency nodes ensures no hash loss on primary failure. Client-side latency monitoring with lightweight pings enables proactive session migration.

**Canonical source:** [[end-to-end-flow|end-to-end-flow.md]] — Part 2: The Directory Infrastructure (§2.1–§2.5)

**Key discussion logs:**
- [[2026-04-17_1400_directory-relay-architecture-reassessment|Directory/Relay Architecture Reassessment]] — relay nodes as session-level Merkle engines; directory as bookend authority; resolves C-2; supersedes dumb-pipe characterisation
- [[2026-04-13_1400_meta-merkle-tree-design|Meta-Merkle Tree Design]] — MMR for conversation proof ledger; identity tree structure; storage analysis
- [[2026-04-08_1700_node-architecture-and-replication|Node Architecture and Replication]] — three-phase deployment; primary/backup replication; client-side routing
- [[2026-04-15_0900_session-level-frost-signing|Session-Level FROST Signing]] — FROST at session/seal only; directory as passive notary
- [[2026-04-15_1100_key-rotation-design|Key Rotation Design]] — per-agent K_server; independent rotation; envelope encryption
- [[2026-04-11_1400_libp2p-dht-and-peer-connectivity|libp2p, DHT, and Peer Connectivity]] — transport feasibility; bootstrap discovery; NAT traversal

**Also see:**
- [[open-decisions|Open Decisions]] — 12 resolved decisions (FROST, Ed25519, SHA-256, thresholds, Merkle construction, sequence numbers)

**Readiness: Stable.** Node deployment phases, replication model, and Merkle tree designs are fully specified. Remaining items (node bootstrap mechanism, node incentive economics, checkpoint frequency) are operational decisions for implementation.

---

## Domain 3: Connections

**What's decided.** Connection requests travel through the directory carrying the requester's original Ed25519 signature — the directory relays but does not re-sign. Before accepting, the receiver cross-checks the requester's public key across multiple nodes with Merkle proof verification. Six connection acceptance policies (Open, Require endorsements, Require introduction, Selective, Guarded, Listed only) plus hard gates on specific verification factors and freshness.

Pre-computed endorsements replace just-in-time introductions as the primary web-of-trust mechanism. Endorsements are signed, hashed, stored by the client, and verified via hash lookup — milliseconds, no round-trips. PSI (Private Set Intersection) prevents contact graph leakage during endorsement intersection computation. Anti-farming: same-owner endorsements are rejected at submission time. Connection staking provides economic defense for open institutions; flat connection fees defend against creative time-wasters. The gate pyramid ensures inference is the last gate, not the first.

Trust data relay during connection requests follows a one-round negotiation with mandatory vs. discretionary signal disclosure. Contact aliases provide revocable, privacy-preserving identifiers for sharing outside the directory.

**Canonical source:** [[end-to-end-flow|end-to-end-flow.md]] — Part 5: Connecting to Another Agent (§5.1–§5.7)

**Key discussion logs:**
- [[2026-04-14_1300_connection-request-flow-and-trust-relay|Connection Request Flow and Trust Relay]] — definitive design for trust data relay and selective disclosure
- [[2026-04-10_1000_connection-endorsements-and-attestations|Connection Endorsements and Attestations]] — pre-computed endorsements; anti-farming; bootstrapping
- [[2026-04-10_1200_psi-for-endorsement-intersection|PSI for Endorsement Intersection]] — PSI-CA and full PSI variants
- [[2026-04-08_1900_connection-staking-and-institutional-defense|Connection Staking and Institutional Defense]] — staking mechanics; gate pyramid
- [[2026-04-14_1000_contact-alias-design|Contact Alias Design]] — revocable aliases for external sharing
- [[2026-04-10_1100_fallback-downgrade-attack-defense|Fallback Downgrade Attack Defense]] — degraded-mode connection policy; trust-weighted pool selection
- [[2026-04-18_1357_connection-bond-usage-and-policy|Connection Bond Usage and Policy]] — two-mode bond model; mandatory intent declaration; policy-first connection flow; updates required for §5.1–§5.7

**Readiness: Stable with deferred items.**
- *PSI*: Not a day-one requirement. Endorsement mechanism first → PSI-CA second phase → full PSI third.
- *Connection staking*: Defaults to zero at launch; hooks exist from day one.

---

## Domain 4: Conversations

**What's decided.** Every message follows two paths: the direct channel (message + embedded signed hash) and the directory relay (signed hash only, for notarization). The Merkle tree uses RFC 6962 construction with domain separation. Leaf format includes sender pubkey, sequence number, message content, scan result, prev_root (creating a hash chain), and timestamp. Three copies exist: sender, receiver, directory.

Session termination is first-class: CLOSE/CLOSE-ACK → SEAL (mutual), SEAL-UNILATERAL (timeout), EXPIRE (inactivity), ABORT (security event). Control leaves (`0x01`) are hashed and signed identically to message leaves. Session close attestations (CLEAN/FLAGGED/PENDING) serve triple duty: "last known good" timestamp for compromise detection, forced LLM self-audit, and escrow release trigger. Notification messages are fire-and-forget: self-contained, self-sealing, no session, prior conversation required.

Multi-party (N>2) conversations separate authorship from ordering. Two modes: serialized (single-speaker token) and concurrent (per-sender sequence + merge points). Client-side receive windows handle LLM agent participation. Group rooms are the primary multi-party venue: invite-only and selective configurations, owner/admin model, throttle manifest with cost protection, violation enforcement, and CONCURRENT+GCD conversation mode.

**Canonical source:** [[end-to-end-flow|end-to-end-flow.md]] — Part 6: The Conversation (§6.1–§6.7); Part 3: Coming Online (§3.1–§3.3)

**Key discussion logs:**
- [[2026-04-08_1530_message-delivery-and-termination|Message Delivery and Termination]] — delivery failure tree (Cases A–D); session termination protocol
- [[2026-04-08_1430_protocol-strength-and-commerce|Protocol Strength and Commerce]] — non-repudiation as commerce primitive; fabricated conversation defense
- [[2026-04-13_1500_multi-party-conversation-design|Multi-Party Conversation Design]] — N-party Merkle; serialized and concurrent modes
- [[2026-04-08_1830_notification-message-type|Notification Message Type]] — fire-and-forget primitive; filtering rule engine
- [[2026-04-11_1400_libp2p-dht-and-peer-connectivity|libp2p, DHT, and Peer Connectivity]] — dual-path hash relay; Merkle chain as implicit ACK
- [[2026-04-19_2045_group-room-design|Group Room Design]] — complete group room specification: room configuration, ownership/admin model, violation enforcement with auto-mute, CONCURRENT+GCD mode, attention modes, wallet protection, 20-participant cap

**Readiness: Stable.** Delivery failure handling, termination protocol, multi-party support, group rooms, and notification system are fully designed.

---

## Domain 5: Security and Prompt Injection Defense

**What's decided.** Six-layer defense architecture. Layer 1: deterministic sanitization (11-step pipeline, no API calls, fails closed). Layer 2: dedicated LLM scanner (separate from agent's model) returning structured JSON with score-overrides-verdict. Two scan modes: local (bundled DeBERTa-v3-small INT8) and proxy (paid tier through directory). Layer 3: outbound content gate with terms-violation self-check (local model, zero API cost). Layer 4: redaction pipeline (secrets → PII → notification). Layer 5: runtime governance (spend/volume/lifetime limits, duplicate detection). Layer 6: access control (deny-all file system, URL safety with DNS rebind prevention).

The receiver's scan is the security boundary. The sender's scan is an honesty signal recorded in the Merkle leaf. Scan results (score, model_hash, sanitization_stats) are part of the conversation record for dispute resolution. The ML model supply chain is secured by SHA-256 hash pinning in the SDK source code. The gate pyramid (connection → message → pattern → classifier → LLM) ensures attack traffic is shed before reaching expensive inference.

**Canonical source:** [[end-to-end-flow|end-to-end-flow.md]] — Part 7: Prompt Injection Defense (§7.1–§7.2); also [[prompt-injection-defense-layers-v2|Prompt Injection Defense Architecture]] for the full 6-layer specification

**Key discussion logs:**
- [[2026-04-11_1400_security-architecture-layers-and-trust-signal-classes|Security Architecture Layers and Trust Signal Classes]] — four-layer system model; where scanning fits
- [[2026-04-08_1900_connection-staking-and-institutional-defense|Connection Staking and Institutional Defense]] — gate pyramid principle
- [[2026-04-13_1100_quantum-resistance-design|Quantum Resistance Design]] — FROST stays for session/seal; ML-DSA for all non-threshold signatures; library choice (liboqs)

**Also see:**
- [[design-problems|Design Problems]] — Problem 8 (ML supply chain, resolved) and Problem 12 (false positive handling, resolved with one deferred edge case)

**Readiness: Stable with deferred item.**
- *Subtle manipulation edge case*: Innocuous-looking inputs that through reasoning chains cause flaggable output. Known limitation of statistical classifiers; no CELLO-specific fix designed. Deferred as future refinement.

---

## Domain 6: Compromise and Recovery

**What's decided.** Compromise detection is continuous: failed FROST at session start, failed scans, burst activity, unusual hours, unknown peers — all trigger alerts to the owner's phone (WhatsApp/Telegram), an out-of-band channel independent from agent infrastructure. "Not me" instantly revokes K_server; re-keying requires WebAuthn/2FA. Three tombstone types (voluntary, compromise-initiated, social recovery-initiated) with immediate effects: K_server burned, social proofs frozen 30 days, phone flagged as "in recovery."

Social recovery uses M-of-N pre-designated recovery contacts with a 48-hour mandatory waiting period (old key can contest). Voucher accountability: two bad outcomes → permanent revocation of vouching privileges (global, not per-account). Trust signals floor at a function of pre-compromise history — they do not reset to zero. Compromise window is anchored to directory-logged events, not owner memory; most recent CLEAN close is the hard "last known good" anchor.

Agent succession supports voluntary transfer (identity_migration_log + announcement period) and involuntary succession (dead-man's switch with 30+ day waiting period, M-of-N attestation). Optional encrypted succession package for track record continuity.

**Canonical source:** [[end-to-end-flow|end-to-end-flow.md]] — Part 8: Compromise and Recovery (§8.1–§8.9)

**Key discussion logs:**
- [[2026-04-17_1100_not-me-session-termination|"Not Me" Session Termination — Dual-Path Forced Abort]] — resolves FC-4/AC-C6; all active sessions terminate on "Not Me"; EMERGENCY_SESSION_ABORT + PEER_COMPROMISED_ABORT mechanism
- [[2026-04-08_1800_account-compromise-and-recovery|Account Compromise and Recovery]] — social recovery; tombstones; voucher accountability; session attestation; dispute resolution
- [[2026-04-14_0700_agent-succession-and-ownership-transfer|Agent Succession and Ownership Transfer]] — voluntary transfer; dead-man's switch; succession package
- [[2026-04-15_1100_key-rotation-design|Key Rotation Design]] — per-agent K_server; independent K_local/K_server rotation
- [[2026-04-15_0900_session-level-frost-signing|Session-Level FROST Signing]] — compromise canary operates at session boundaries
- [[2026-04-10_1100_fallback-downgrade-attack-defense|Fallback Downgrade Attack Defense]] — degraded-mode policy prevents mass fallback exploitation

**Also see:**
- [[design-problems|Design Problems]] — Problems 1 (fallback downgrade, closed), 2 (trust recovery, closed), 9 (K_server rotation, closed), 11 (Not Me DoS, closed)

**Readiness: Stable.** All 12 design problems are closed. Recovery mechanisms, succession, and key rotation are fully designed.

---

## Domain 7: Discovery

**What's decided.** Three-class discoverable entity model: agent directory (individual agents with profiles and trust signals), bulletin board (posted service listings, decoupled from agent identity), and group chat rooms (topic-organized, Merkle-tree-backed). Unified search stack: BM25 for text retrieval + vector similarity for semantic matching. Discovery requires an active FROST-authenticated session — the directory cannot be scraped anonymously.

Agents expose bio (static, public, rate-limited changes — stability is a trust signal), capability tags, trust signal hashes, verification freshness, and optional pricing. Greeting is contextual, per-recipient, sent at connection request time — recorded in the Merkle tree. Contact aliases extend discovery with revocable identifiers shareable outside the directory. Group rooms are discoverable (if configured) with the two-flag model (discoverable / private) and appear in search results with participant count, trust signal requirements, and pricing signals.

**Canonical source:** [[end-to-end-flow|end-to-end-flow.md]] — Part 4: Discovery (§4.1–§4.2)

**Key discussion logs:**
- [[2026-04-13_1200_discovery-system-design|Discovery System Design]] — three-class model; search architecture; location privacy; QR codes
- [[2026-04-14_1000_contact-alias-design|Contact Alias Design]] — revocable aliases for external sharing
- [[2026-04-14_1500_deprecate-trust-seeders-and-trustrank|Deprecate Trust Seeders and TrustRank]] — discovery and organic endorsements replace seeder bootstrapping
- [[2026-04-19_2045_group-room-design|Group Room Design]] — group room discovery via two-flag model; discoverable rooms appear in search results with manifest information

**Readiness: Stable.** Discovery model is fully designed. Search implementation details (index technology, ranking weights) are engineering decisions.

---

## Domain 8: Compliance and Privacy

**What's decided.** The architecture naturally satisfies data residency: PII (phone, WebAuthn, OAuth) lives in the signup portal, which is deployed in the owner's jurisdiction — never on directory or relay nodes. Message content goes P2P — never touches infrastructure. Directory nodes hold only hashes (non-PII), public keys (pseudonymous), and encrypted K_server_X shares. Only hashes, public keys, and voluntarily published bios cross borders.

GDPR right to erasure is satisfied by the separation: signup portal PII is fully deleted on account deletion. The append-only log on directory nodes retains only hashes — cryptographically meaningless without the deleted source data. Conversation records belong to both parties — deletion of one account does not erase the counterparty's records (defensible under GDPR Article 6(1)(b)).

Bios are voluntary broadcasts — the owner wrote and published them. Trust signals are associated with pseudonymous public keys — only personal data if you can link key to person, and that link is not in the protocol.

**Canonical source:** [[end-to-end-flow|end-to-end-flow.md]] — Part 10: Privacy and Compliance (§10.1–§10.3)

**Key discussion logs:**
- [[2026-04-08_1600_data-residency-and-compliance|Data Residency and Compliance]] — GDPR analysis; UAE residency; pseudonymity model
- [[2026-04-08_1930_client-side-trust-data-ownership|Client-Side Trust Data Ownership]] — hash-everything model; GDPR simplification

**Also see:**
- [[design-problems|Design Problems]] — Problem 6 (GDPR vs append-only log, closed — not an issue) and Problem 7 (home node deanonymization, closed — concept dropped; three-system separation eliminates the attack)

**Readiness: Stable.** No open compliance questions. The architecture resolves GDPR and data residency by design.

---

## Domain 9: Commerce

**What's decided.** Micropublishing via push-publish: subscribed agents receive scheduled content pushes from publishers without maintaining persistent sessions. Subscription agreements store publisher/subscriber, content type, frequency, price, and personalization. Each push delivery triggers a micropayment (per-delivery or periodic billing). Human-relay agent tier enables humans to sell services to AI agents — task requests, completion verification, skill signals via LinkedIn/credentials. Merchant CRM data stash: per-contact JSON blobs for tracking free samples, interaction history, personalization parameters. All merchant data is client-side only; directory never sees it. Purchase attestations capture what is being delivered, at what price, on what schedule — signed by both parties, hashed into Merkle records. Fraud detection via behavioral anomalies: seller concentration, transaction velocity, lifecycle patterns. Flagged accounts above $500+ thresholds may be required to submit raw attestations and chat logs for ephemeral inference review. KYC on sellers (not buyers) limits attack surface for money transfer abuse.

**Canonical source:** No unified end-to-end section yet; see discussion logs for detailed designs.

**Key discussion logs:**
- [[2026-04-18_1407_push-publish-subscription-model|Push-Publish Subscription Model]] — micropublishing delivery mechanism; subscription records; per-delivery payment triggers; cancellation and refunds
- [[2026-04-18_1412_human-agent-marketplace|Human-Agent Marketplace]] — humans selling skills to AI agents; hosted lightweight relay agent tier; task verification; skill signals
- [[2026-04-18_1454_merchant-crm-data-stash-and-free-samples|Merchant CRM Data Stash and Free Sample Tracking]] — client-side per-contact JSON blobs; universal identifier (identity_key); key rotation continuity
- [[2026-04-18_1620_commerce-attestation-and-fraud-detection|Commerce Attestation and Fraud Detection]] — signed purchase attestations; behavioral fraud detection model; ephemeral chat log review for flagged accounts; KYC on sellers
- [[2026-04-24_1530_inference-billing-protocol|Inference Billing Protocol]] — token-priced specialized inference: rate card binding at session establishment, signed cumulative billing in Merkle leaves, Layer 5 cost cap enforcement, ABORT-BILLING termination, three tokenizer verification modes (local, hosted opt-in, trust-only)

**Readiness: Stable with deferred items.**
- *Multi-party escrow*: Not yet designed. Group commerce is an open item — requires multi-party escrow before group rooms support commerce transactions.
- *CAC and revenue streams*: Economic model and hosted agent tiers (referenced but not yet written as a design document).

---

## Cross-Domain References

These documents span multiple domains and are important for understanding how the pieces connect:

| Document | What it covers |
|---|---|
| [[end-to-end-flow\|CELLO End-to-End Protocol Flow]] | The deep canonical narrative — every domain in one coherent story |
| [[cello-design\|CELLO Design Document]] | Original architecture and vision — the 10-step trust chain, revenue model, client architecture, competitive landscape |
| [[2026-04-11_1700_persistence-layer-design\|Persistence Layer Design]] | Complete schema for every protocol entity across all domains |
| [[2026-04-14_1100_cello-mcp-server-tool-surface\|CELLO MCP Server Tool Surface]] | 33 MCP tools implementing the agent-facing interface across sessions, security, discovery, connections, groups, notifications, policy |
| [[open-decisions\|Open Decisions]] | 12 resolved cryptographic and protocol decisions (FROST, Ed25519, SHA-256, thresholds, etc.) |
| [[design-problems\|Design Problems]] | 12 design problems — all closed |
| [[00-synthesis\|Protocol Review — Synthesis]] | Adversarial review: 8 critical, 23 high findings — all addressed |
| [[day-0-agent-driven-development-plan\|Day-0 Development Plan]] | Implementation plan using Claude-Flow multi-agent orchestration |

---

## Protocol Readiness Summary

| Domain | Status | Deferred Items |
|---|---|---|
| 1. Identity & Trust Signals | **Stable** | — |
| 2. Directory Infrastructure | **Stable** | — |
| 3. Connections | **Stable** | PSI (phased rollout); connection staking (defaults to zero) |
| 4. Conversations | **Stable** | — |
| 5. Security & Scanning | **Stable** | Subtle manipulation edge case (classifier limitation) |
| 6. Compromise & Recovery | **Stable** | — |
| 7. Discovery | **Stable** | — |
| 8. Compliance & Privacy | **Stable** | — |
| 9. Commerce | **Stable** | Multi-party escrow (requires design); CAC & revenue streams (model document); group commerce blind spots (fraud detection in multi-party contexts) |

All 12 design problems are closed. All 12 open decisions are resolved. The protocol is ready for user story development across all domains.

---

## Related Documents

- [[end-to-end-flow|CELLO End-to-End Protocol Flow]]
- [[cello-design|CELLO Design Document]]
- [[user-story-format|CELLO User Story Format]] — formal template for all user stories combining intent with EARS behavioral rigor, designed for TDD with AI coders
- [[server-infrastructure|Server Infrastructure Requirements]] — complete requirements for signup portal, directory nodes, and relay nodes, with all conflicts and gaps identified
- [[prompt-injection-defense-layers-v2|Prompt Injection Defense Architecture]]
- [[open-decisions|Open Decisions]]
- [[design-problems|Design Problems]]
- [[00-synthesis|Protocol Review — Synthesis]]
- [[day-0-agent-driven-development-plan|Day-0 Development Plan]]
- [[frontend|CELLO Frontend Requirements]] — complete requirements for portal, mobile app, and desktop app, with all conflicts and gaps identified
- [[2026-04-16_1400_companion-device-architecture|Companion Device Architecture]] — companion device P2P connection, human injection, and local persistence model
- [[agent-client|CELLO Agent Client Requirements]] — complete requirements for the locally-running CELLO client: identity and key management, P2P transport, Merkle operations, prompt injection defense, connection management, trust data custody, persistence, companion device API, and MCP tool surface
- [[2026-04-17_1000_trust-signal-pickup-queue|Trust Signal Pickup Queue]] — async oracle handoff; encrypted pickup queue using identity_key bridges the gap when the agent client is offline during trust enrichment
- [[2026-04-17_1100_not-me-session-termination|"Not Me" Session Termination — Dual-Path Forced Abort]] — resolves FC-4; all active sessions terminated immediately on compromise declaration via EMERGENCY_SESSION_ABORT + PEER_COMPROMISED_ABORT
- [[2026-04-17_1400_directory-relay-architecture-reassessment|Directory/Relay Architecture Reassessment]] — relay nodes as session-level Merkle engines; directory as bookend authority; resolves C-2; home node concept dropped
- [[2026-04-18_1357_connection-bond-usage-and-policy|Connection Bond Usage and Policy]] — two-mode bond design (voluntary trust signal vs. defensive receiver requirement); mandatory intent declaration and policy-first connection flow; protocol update required for §5.1–§5.7
- [[2026-04-18_1407_push-publish-subscription-model|Push-Publish Subscription Model]] — micropublishing via scheduled content pushes; subscription agreements; per-delivery and periodic billing
- [[2026-04-18_1412_human-agent-marketplace|Human-Agent Marketplace]] — humans selling skills to AI agents; lightweight relay agent tier; task verification and skill signals
- [[2026-04-18_1454_merchant-crm-data-stash-and-free-samples|Merchant CRM Data Stash and Free Sample Tracking]] — client-side per-contact JSON storage; universal identifier via identity_key; key rotation continuity
- [[2026-04-18_1620_commerce-attestation-and-fraud-detection|Commerce Attestation and Fraud Detection]] — signed purchase attestations; behavioral fraud detection; ephemeral chat log review for flagged accounts; KYC on sellers
- [[2026-04-19_2045_group-room-design|Group Room Design]] — complete design of Class 3 group rooms: two-flag room model, ownership/admin structure, CONCURRENT+GCD conversation mode, digest batching, attention modes, violation enforcement with logarithmic auto-mute, wallet protection, relay defense, and 20-participant cap
- [[2026-04-24_1530_inference-billing-protocol|Inference Billing Protocol]] — token-priced specialized inference: rate card binding at session establishment, signed cumulative billing in Merkle leaves, Layer 5 cost cap enforcement, ABORT-BILLING termination, three tokenizer verification modes (local, hosted opt-in, trust-only)
