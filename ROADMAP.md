# CELLO Roadmap

CELLO is a peer-to-peer identity and trust layer for agent-to-agent communication. This roadmap describes what gets built and why, milestone by milestone. Each milestone delivers a complete, testable protocol capability that the next milestone builds on.

For the full technical detail behind any milestone, see `docs/planning/implementation-roadmap.md`.

---

## How We Build

### Methodology — SPARC

Every milestone follows SPARC: Specification → Pseudocode → Architecture → Refinement → Completion. The key discipline is writing detailed user stories *before* any code exists. Each story defines behavior in EARS format, acceptance criteria as Given/When/Then test cases, and security invariants with adversarial conditions. A story is complete only when every acceptance criterion and every security invariant has a passing test. The specification format is documented in `docs/planning/user-story-format.md`.

This matters because CELLO is security infrastructure. A subtle error in a Merkle construction or key derivation routine isn't a bug — it's a vulnerability. Writing the spec in adversarial terms before implementation forces the hard questions to the surface before there is code to defend.

### Testing strategy

The test suite is not an afterthought. It is a first-class deliverable at each milestone, growing continuously from unit tests through full end-to-end integration.

**Unit tests** cover every cryptographic primitive, every Merkle operation, and every sanitization rule — including attack vectors. They run in under a second and cover the adversarial cases the security invariants describe.

**In-process integration tests** wire real libp2p nodes, real crypto, and real protocol logic together inside a single Vitest process — no Docker, no manual ports, no inter-process coordination. After M1 this means a real directory node, a real relay node, and two real client nodes all running in the same test. The protocol is exercised end-to-end with assertions on tamper detection, root equality across parties, and causal-chain violations.

**Cross-machine integration tests** run after each milestone boundary — two clients on different networks (home ISP, corporate VPN, mobile hotspot) connecting through NAT traversal. These catch the class of libp2p problem that localhost cannot surface.

This investment is necessary for two reasons. First, the protocol makes strong security claims that are only meaningful if the full stack is tested together, not just individual components. Second, as contributors join and AI coding agents do more of the implementation work, a comprehensive test suite is the ground truth that prevents regressions — human and agent alike.

---

## Milestones

### M0 — Peer-to-Peer Walking Skeleton

**What gets built:** Monorepo, cryptographic primitives (Ed25519 signing, domain-separated SHA-256), libp2p transport substrate (Noise encryption, Yamux multiplexing, DCuTR hole-punching), signed message envelope, MCP tool surface, Claude Code adapter.

**What it proves:** Two agents exchange a tamper-evident signed message peer-to-peer over libp2p with no server in the middle. Tamper any byte in transit and the receiver rejects. The full transport, encryption, and signing stack is exercised end-to-end before any server infrastructure exists.

**Why this first:** libp2p is not a transport optimization — it is the shape of every future session. Surfacing its integration surprises in the first milestone means every subsequent milestone builds on a substrate whose quirks are already known.

---

### M1 — Directory Signaling + Merkle Notarization

**What gets built:** Directory node (session brokering, signed session assignments carrying counterparty Peer IDs and multiaddrs); relay node (canonical sequence numbering, per-session RFC 6962 Merkle tree); two-structure leaf model (Structure 1 sender-signed, Structure 2 relay-built with causal `prev_root` chain); bilateral seal; MCP tools for sealed receipts and inclusion proofs.

**What it proves:** A conversation is a 32-byte receipt. Sender, receiver, and relay independently produce the same Merkle root. The directory recomputes the tree from scratch at seal and verifies the causal chain — a relay that forged, reordered, or dropped any leaf produces a provable inconsistency. Inclusion proofs are RFC 6962 standard, verifiable by any compliant implementation. The directory and relay are architecturally off the content path — neither node has a route to message plaintext.

---

### M2 — FROST Threshold Signing

**What gets built:** FROST distributed key generation (DKG), threshold co-signing at session establishment and seal, K_server share management, `IThresholdSigner` abstraction as the swap point for future post-quantum threshold signing.

**What it proves:** Neither the client nor the directory can forge a session unilaterally. A stolen K_local cannot pass the FROST ceremony — key compromise is detectable at session boundaries. The single directory signing key from M1 is replaced; there is no single point of signing authority.

---

### M3 — Connections and Policy

**What gets built:** Agent registration (stubbed OTP verification), connection request flow, trust data relay with selective disclosure, `SignalRequirementPolicy` evaluation, accept/decline. Connection package items (pseudonym binding, attestations, endorsements) are signed with ML-DSA (post-quantum, NIST FIPS 204).

**What it proves:** Agents control who can reach them. A receiver can require specific trust signals before agreeing to connect. The one-round negotiation works — what you disclose, what you withhold. Post-quantum signatures are load-bearing from the first artifact that persists beyond a session.

---

### M4 — Prompt Injection Defense

**What gets built:** Six-layer defense pipeline — deterministic sanitization, LLM-based scanner (DeBERTa), outbound exfiltration gate, redaction, runtime governance, access control. Standalone MCP tool: `cello_scan_message`.

**What it proves:** Inbound messages are safe to hand to an agent. Each defense layer catches a different attack class. The pipeline is client-side and works independently of the network — it has value even without an active session.

**Dependency:** Can run in parallel with M1–M3 after M0 because the pipeline is almost entirely client-side.

---

### M5 — Discovery and Notifications

**What gets built:** Agent profiles and bio, BM25 + vector search across the directory, contact aliases with revocation, notification event queue.

**What it proves:** The full cold-start flow works end-to-end — search for an agent, discover their trust profile, send a connection request, establish a session, converse. Contact aliases enable out-of-band sharing without exposing directory IDs.

---

### M6 — Social Trust

**What gets built:** Pre-computed endorsements, same-owner endorsement rejection, Sybil floor via conductance scoring, provisional period enforcement, carrier signal weighting.

**What it proves:** Trust is social and hard to fake. Connection policies can require endorsements from shared contacts. Building a fake identity network is expensive — Sybil clusters are detectable by graph conductance, and provisional periods prevent rapid trust farming.

---

### M7 — Compromise and Recovery

**What gets built:** Continuous compromise detection, "Not Me" revocation flow (K_server burn, all active sessions terminated), social recovery (M-of-N guardians, 48-hour wait), key rotation, trust floor preservation from pre-compromise history.

**What it proves:** Compromise is survivable. Detection is continuous, revocation is instant, recovery preserves earned trust. The session Merkle tree provides a last-known-good anchor for compromise timeline analysis.

---

### M8 — Group Rooms

**What gets built:** N-party Merkle tree (up to 20 participants), concurrent message mode with GCD floor control, owner/admin model, throttle manifests with cost protection, violation enforcement with auto-mute escalation.

**What it proves:** Groups work with provable records. Floor control prevents chaos; throttle manifests protect participants from unexpected token costs; violations escalate on a defined schedule and cannot be silently reversed.

---

### M9 — Commerce

**What gets built:** Push-publish subscriptions with per-delivery micropayments, inference billing (rate card, signed cumulative token counts as Merkle leaves, ABORT-BILLING on cap exceeded), purchase attestations, merchant CRM data stash, fraud detection.

**What it proves:** Agents can trade. Token counts are cryptographically signed and verifiable by the buyer. Fraudulent billing is caught by the buyer's client or by deterministic arbitration against the sealed Merkle tree.

---

### M10 — Federation

**What gets built:** Multi-node directory with primary/backup replication, consensus for state changes, relay operator separation from directory operators, client-side latency monitoring with proactive session migration, MMR (Meta-Merkle Tree) inclusion proofs verified against federation-signed checkpoints.

**What it proves:** The network decentralizes. A directory node failure mid-session is survivable — the client detects it and migrates. Fabricated conversation histories become detectable via MMR inclusion proofs now that federation-signed checkpoints exist to anchor them.

---

## Dependency Order

```
M0 → M1 → M2 → M3 → M5 → M6
               ↓
              M4  (parallelizable from M0)
          M2 + M3 → M7
          M1 + M3 → M8
          M3 + M5 → M9
              M2 → M10
```
