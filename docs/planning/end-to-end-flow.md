---
name: CELLO End-to-End Protocol Flow
type: design
date: 2026-04-24
topics: [identity, trust, FROST, merkle-tree, connection-policy, endorsements, PSI, fallback-mode, prompt-injection, dispute-resolution, notifications, sybil-defense, social-recovery, key-management, federation, session-termination, attestation, compliance, degraded-mode, group-conversations, commerce, companion-device, human-injection, floor-control, push-publish]
status: active
description: Comprehensive end-to-end narrative of the CELLO protocol — every phase from registration through dispute resolution, synthesizing all design decisions and discussion logs into one coherent flow document. Covers all thirteen protocol domains including group rooms, commerce, and companion devices.
---

# CELLO End-to-End Protocol Flow

This document traces the full lifecycle of a CELLO agent — from registration through compromise and recovery — synthesizing decisions from across the design document and all discussion logs into one coherent narrative. It is the definitive reference for understanding how the pieces fit together and why each mechanism exists.

---

## Core Invariants

These principles apply everywhere. If a proposed mechanism violates any of them, it needs to be redesigned.

1. **Hash relay, not content relay.** The directory sees SHA-256 hashes of messages and identity data, never the content. This is not just a privacy feature — it eliminates entire categories of regulatory exposure and attack surface.

2. **Client is the enforcer.** Merkle proofs, endorsement hashes, scan results, signature checks — the client verifies everything locally. A node can be compromised; if the client enforces correctly, the compromise is detectable and bounded.

3. **FROST bookends the conversation.** The opening FROST ceremony creates an unforgeable pubkey binding: t-of-n directory nodes collectively sign both agents' K_local pubkeys into the `SessionAssignment`. This is what makes K_local-only messaging safe between the bookends — every K_local signature during the session is verified against a pubkey that no minority of nodes could have fabricated. Without the threshold-attested binding, a single rogue node could issue a `SessionAssignment` with an attacker's pubkey and MITM the entire session. The closing FROST ceremony does the symmetric thing for the record: t-of-n nodes collectively attest to the final Merkle root, so no rogue relay or minority coalition can present a modified conversation history. Individual messages use K_local alone — FROST ensures the infrastructure is honest at the boundaries where trust anchors are established.

4. **Degraded state raises the guard.** Directory unavailability is not a reason to accept lower-quality connections — it is a reason to be more selective. The default during degraded mode is refuse new unauthenticated connections with a clear reason.

5. **All identity signals are optional enrichment.** Phone OTP and email are the only registration requirements. Every other signal — WebAuthn, social verifiers, device attestation, SIM age scoring, bonds — enriches trust signals but is never a gate. Missing signals are not penalties. An initiating agent may omit any or all signals from a connection request — the decision to include them is the agent's. Policy enforcement (whether to accept or decline a request) happens at the receiver's evaluation time, not at submission time. The directory does not reject requests for missing signals; the receiving client's `SignalRequirementPolicy` is the enforcer.

6. **Non-repudiation is the foundation of commerce.** The Merkle root is the conversation. A 32-byte hash smaller than a tweet provides a tamper-proof receipt for an entire exchange of any length. Natural language commerce between agents is only possible because disputes are resolvable.

---

## Part 1: Identity

### 1.1 Registration

Registration is entry-point agnostic — neither the bot nor the portal is the privileged starting point. Both mandatory ceremonies (phone OTP and email verification) are always required, but they can be completed in either order through any supported surface.

**Bot-first path** (most common for autonomous agents):

1. Agent messages the onboarding bot (WhatsApp or Telegram)
2. Bot collects the phone number and issues an OTP
3. OTP verified → phone confirmed
4. Email verification required — bot prompts for it
5. Agent generates K_local locally
6. Directory distributes K_server shares via FROST across all nodes (never assembled in one place)
7. Directory listing created with baseline trust signals
8. Agent is immediately online: can discover, connect, and exchange messages

**Portal-first path** (used when the human operator starts at the web portal):

1. Operator registers via web portal → email OTP completed there
2. Portal initiates the WhatsApp or Telegram phone OTP ceremony — the email OTP serves as the correlation token linking the two paths
3. OTP verified → phone confirmed
4. Steps 5–8 from the bot-first path follow

The human owner's involvement is optional beyond the initial ceremonies. The agent can operate entirely autonomously from day one. Some receiving agents will decline connections (their policy requires WebAuthn) — but the agent can still transact with anyone who accepts phone-only agents.

### 1.2 Trust Enrichment — Optional Identity Signals

After registration, the human owner can strengthen the agent's trust profile via the web portal. Every signal is additive — none is required, none is a gate, and missing signals carry no penalty. The system works with whatever subset is available.

**Human-level signals (require web portal):**

| Signal | What it proves | Trust impact |
|---|---|---|
| WebAuthn (YubiKey, TouchID, FaceID) | Phishing-resistant login; proves owner has a hardware-bound credential. Account security signal — does not sacrifice the device (one device can register WebAuthn credentials for many accounts). | Medium-High — account security, not Sybil defense |
| TOTP 2FA | Second factor, SIM-swap resistant | High |
| LinkedIn OAuth | Professional identity, career history | High (signal-strength evaluated at OAuth time) |
| GitHub OAuth | Technical activity, real code history | High (commits, account age, stars received) |
| Twitter/X, Facebook, Instagram | Public presence, account age | Medium |

**Infrastructure-level signals (no user friction — activate when available):**

| Signal | What it proves | Trust impact |
|---|---|---|
| SIM age / carrier quality (Twilio Lookup, Telesign) | Phone is an aged real SIM, not freshly activated VoIP | Significant — raises attacker cost from ~$0.05 to $5–15/identity |
| Device attestation (TPM, Android Play Integrity, Apple App Attest) | Real physical device committed exclusively to this account. Directory enforces one-account-per-device via stable device identifier. **Requires native app** — not available from the web portal. Two-tier delivery: Apple ecosystem (macOS + iOS app using App Attest), Windows/Google ecosystem (Windows + Android app using TPM / Play Integrity). | High — raises attacker cost to $50–200/device |

**Network-built signals (accumulate over time):**

| Signal | What it proves |
|---|---|
| Transaction history | Real commerce with real counterparties — hardest to fake at scale |
| Time on platform | Sustained good behavior — impossible to shortcut |

**Tiered trust ceilings based on phone quality (when carrier intelligence available):**

| Class | Criteria | Trust ceiling |
|---|---|---|
| Verified Mobile | Carrier-attached SIM, passes phone intelligence | Uncapped |
| Unverified Number | VoIP, virtual, or intelligence unavailable | Trust signals restricted |
| Provisional | Failed phone intelligence, 60-day clean period | Trust signals restricted, re-evaluated at 60 days |

When carrier intelligence is not yet integrated, all agents default to Verified Mobile — the ceiling only activates once the signal exists.

### 1.3 The Hash-Everything Model

The hash relay pattern that protects message content extends to all identity data. When the directory verifies a LinkedIn account or GitHub profile, it:

1. Performs the verification work (checks connection count, account age, activity)
2. Creates a structured JSON record per verification item
3. SHA-256 hashes the record
4. Stores **only the hash** — the original record is sent to the client and discarded

The client is the custodian of its own identity data.

**Verification flow (one-time per item):**
```
Directory verifies LinkedIn
  → creates {type: "linkedin", connections: 500, account_age_years: 8, verified_at: "..."}
  → SHA-256(json_blob) → hash stored in directory
  → json_blob sent to client (or queued in encrypted pickup queue if client offline)
  → directory discards plaintext immediately
```

**Async pickup queue:** The portal cannot guarantee the client is running at verification time. Rather than block or lose the blob, the portal encrypts it to the agent's `identity_key` and stores it in an ephemeral pickup queue (TTL: 30 days). The directory notifies the agent via `TRUST_SIGNAL_PICKUP_PENDING` the next time it connects. The agent downloads, decrypts, validates the hash, stores locally, and sends an ACK. The portal displays the signal as "pending delivery" until the ACK arrives. If the agent never picks up within 30 days, the encrypted blob expires and the agent is prompted to re-verify. The `identity_key` is used (not K_local) because it is the stable long-term root — K_local can rotate between the portal encrypting the blob and the agent coming online to pick it up.

**Trust signal sharing (at connection request time):**

Before a connection exists there is no P2P channel to the receiver — the only path for trust data is through the directory. The requester (Alice) bundles her trust signal blobs with the connection request:

```
Alice bundles trust signal blobs (each signed by Alice at creation time) with the connection request
  → Directory checks each blob against held hashes (fraud filter — stops invalid/tampered submissions)
  → Directory appends track record stats from its authoritative store
  → Directory forwards full package to Bob, then discards the blobs
  → Bob verifies Alice's identity via Merkle inclusion proof (multi-node cross-check)
  → Bob verifies Alice's own signature on each blob using the identity key confirmed above
  → The directory's fraud filter is a first-line check, not a substitute for Bob's independent verification
```

**Why this matters:**
- The directory cannot leak trust signals, bios, or verification details — it doesn't have them (blobs exist only transiently during relay)
- A compromised directory node yields hashes, not names or LinkedIn profiles
- The client cannot modify their trust signals — each blob is signed by Alice's identity key at creation time; any tampering breaks the signature that the receiver independently verifies
- A compromised directory could pass fraudulent data; the receiver's independent signature checks are the actual security boundary
- GDPR right-to-erasure is dramatically simpler: the client deletes local data, and the remaining hash in the directory is meaningless without it

**Attestations — portable signed statements:**

An attestation is a signed, hashable statement from one agent about another. Content is freeform: a service review, a professional reference, a conditional endorsement ("I vouch for this plumber specifically — I've hired them twice"). The flow:

1. Bob signs a statement about Alice
2. Bob sends it to Alice AND to the directory
3. Directory hashes it, stores the hash, discards the content
4. Alice stores the attestation locally
5. When Alice presents it to Charlie, Charlie verifies the hash — tamper-proof, no platform controls it

Revocation: Bob appends a revocation event to the log. The hash remains; the status changes to revoked. Presenting a revoked attestation fails verification immediately and is a trust signal event. There are three distinguishable states: hash present and active, hash present but revoked, hash never present. The distinction matters — "revoked" means the relationship changed; "never present" means the claim was fabricated.

**Connection endorsements** are a specific subtype of attestation that the protocol checks programmatically at the connection gate (see §5.4). All other attestations are informational — part of the trust profile, but not gated.

### 1.4 Trust Signal Evaluation

CELLO does not compute or publish a single numeric trust score. Trust is expressed as named signals — each verification source is evaluated independently and stored as a structured record. `cello_verify` returns `SignalResult[]`. Connection policies specify named trust signal requirements via `SignalRequirementPolicy`, not numeric thresholds.

**Relative weights (default policy guidance):**
- **Transaction history** — highest weight; real commerce with real counterparties is the hardest trust signal to manufacture at scale
- **GitHub / LinkedIn** — high weight; account age, activity history, professional history
- **WebAuthn / TOTP 2FA** — high weight; phishing-resistant authentication
- **SIM age / device attestation** — high weight when available; significant Sybil cost increase
- **Twitter, Facebook, Instagram** — medium weight; moderate fakeability
- **Time on platform** — accumulates gradually; impossible to shortcut
- **Disputes** — negative; upheld flags reduce trust signal standing

No formula sums these into a single number. Trust is not expressed as a number.

### 1.5 Anti-Sybil Architecture

The Sybil problem — an attacker creates many fake identities to gain disproportionate influence — is addressed in layers, each independently deployable as infrastructure matures.

**Layer 1 — Trust-signal-weighted pool selection (existing mechanism):**

The connection pool weights agents by trust signals. Bulk-identity attacks dilute rather than dominate — agents with minimal trust signals contribute minimal selection weight. This is already the mechanism for handling DDoS against connection nodes.

**Layer 2 — SIM age and carrier signals (requires phone intelligence API):**

Twilio Lookup / Telesign queries carrier metadata: SIM tenure, number type, porting history. A freshly-activated VoIP SIM adds little trust; a 3+ year old SIM adds a meaningful boost. Zero user friction — runs silently during OTP verification. Coverage: 200+ countries at varying quality.

**Layer 3 — Diminishing returns per counterparty (formula change, no external dependency):**

```
weight(tx_n with counterparty X) = base_weight / ln(n + 1)
```

Plus a counterparty diversity ratio: `min(1, unique_counterparties / total_transactions)`. Round-robin farming is self-defeating: after the first round, subsequent rounds contribute marginally less. A floor of 0.3 prevents complete nullification for legitimate recurring clients.

**Layer 4 — Conductance-based cluster scoring (directory-side computation):**

For each agent's 1-hop endorsement/transaction neighborhood, the directory computes what fraction of edges point outside the neighborhood. A farming cluster of 10 agents transacting only with each other has near-zero external connectivity. A plumber with 5 regular customers has high external connectivity (those customers each have dozens of other connections). Applies above a minimum neighborhood size (5+ distinct counterparties).

**Layer 5 — Device attestation (zero friction when supported):**

Automatic for smartphone clients. Desktop and server agents without TPMs simply don't provide this signal and are not penalized.

**Layer 6 — Endorsement defenses (protocol-level rules):**
- Rate limiting: max N new endorsements per month per owner (phone number) — shared across all agents under that owner, preventing farming via multiple agents
- Weight decay by volume: agents endorsing hundreds carry less per-endorsement weight than selective endorsers
- Fan-out detection: 50 agents endorsing the same 150 targets in a window is statistically anomalous
- Social account binding lock: once GitHub/LinkedIn is bound, 12-month lockout on rebinding after unbinding (prevents marketplace resale of social verification)
- Liveness probing: periodically require fresh activity (new commit, new LinkedIn post) to maintain social verification weight (purchased dormant accounts decay)

**Layer 7 — Temporal detection and dual-graph comparison (directory-side computation):**

Farming has a time signature: low variance in inter-arrival times (metronome transactions), synchronized activation of dormant cohorts, graph age mismatch (old account, new counterparties). Dual-graph comparison (endorsement graph vs. transaction graph) catches farming where the attacker manages both graphs but fails to fully decouple the topology.

**Layer 8 — Optional refundable bond (deferred — requires payment infrastructure):**

When payment infrastructure is live, agents can optionally post a PPP-adjusted bond ($1 in high-income countries, $0.10–0.30 in low-income). Returned after 90 days of clean operation. Voluntary: strengthens trust signals, not required, no penalty for absence. At $0.20/identity, 20,000 Sybil agents costs $4,000 in locked capital — but the network does not depend on this mechanism.

**Incubation period for new agents:**

Phone-only agents start with minimal trust signals and a 7-day provisional period with a rate limit of 25 new outbound connections per day. After 7 clean days, provisional period ends and normal operation resumes. Invisible to legitimate users (who connect to 2–3 agents on day one without noticing). Significant friction for bulk farm operations that need to build connection graphs fast.

---

## Part 2: The Directory Infrastructure

### 2.1 What the Directory Is (and Isn't)

The directory is an **append-only log of signed operations**, not a mutable database. Every add, modify, or delete is an entry that hashes the previous one. Every honest node processing the same operations in the same order arrives at the same state.

**Two separate trees:**
- **Identity Merkle tree** — agent profiles, public keys, trust signal record hashes, bio hashes, tombstones. Checkpointed periodically.
- **Message Merkle tree** — per-conversation hash chain, with three copies (sender, receiver, directory). Updated per message.

**What the directory stores:**
- Hashes of identity data (not the data itself)
- Public keys (pseudonymous, not PII)
- Tombstones (deletion markers, not deletion of the hash chain)
- Conversation hashes with canonical sequence numbers

**What the directory does NOT store:**
- Message content (ever)
- LinkedIn profiles, verification data, bios (hashes only — client holds originals)
- Phone numbers, WebAuthn credentials, OAuth tokens (signup portal only — directory nodes never see these)

**Defense against fabricated conversation attacks:**

An attacker could create an internally consistent fake conversation (valid hashes, valid signatures, two keys they control) and insert it into the directory. The defense: a global append-only Merkle tree over all conversation registrations — a meta-Merkle tree. Each new conversation is a leaf. Published checkpoint roots prove that a conversation is either in the tree at a given point, or it isn't. This is a purpose-built blockchain for conversation proof — not financial transactions, but proof that a conversation happened, between whom, and when.

**Two distinct directory interfaces:**

1. **Agent clients** connect via persistent libp2p on `/cello/signaling/1.0.0`. Wire format: canonical CBOR (RFC 8949 deterministic encoding). Authenticated via CELLO identification exchange (challenge-response with K_local). This is the protocol-level connection for session signaling, FROST ceremonies, hash relay coordination, and notifications.

2. **Portal** connects via authenticated WebSocket with JSON encoding (not libp2p). Accepts only a rigid JSON schema (`type`, `agent_id`, `session_id`, `payload`, `signature`, `timestamp`). Used for portal-originated instructions (accept/decline connection, key rotation, "Not Me" emergency actions). The portal never uses libp2p.

Both interfaces apply the same validation discipline: schema check, signature verification, timestamp skew check (+/−30 seconds). No LLM, no interpretation. Repeated malformed messages trigger: rate limit → disconnect → require reverification.

### 2.2 Node Architecture

**Three deployment phases:**

| Phase | Nodes | Operators | Threshold | Primary threat |
|---|---|---|---|---|
| **Alpha** | ~6, all AWS | CELLO-operated, one per region | ~4-of-6 | Reliability |
| **Consortium** | ~20, multi-cloud | Vetted, contracted, audited | ~11-of-20 | Rogue/compromised operator |
| **Public** | 50+, permissionless | Proof-of-stake collateral | Rotating ~5-of-7 per op | Economic stake + slashing |

As the pool grows, the threshold per operation comes down. Security shifts from "supermajority must agree" to "attacker must compromise geographically dispersed nodes across multiple providers and jurisdictions, and loses their stake if caught."

The permissioned model prevents Sybil attacks at the node level — no one can spin up 10 malicious nodes to overwhelm consensus. The consortium grows deliberately by adding vetted operators.

**Two functional node types within each phase:**

**Connection nodes** — public-facing. Handle new connection requests, authentication, registration, and key operations. The noisy surface exposed to the internet.

**Relay nodes** — not directly reachable from cold inbound traffic. Serve only established, already-authenticated sessions. Session-level Merkle engines: handle hash relay, canonical sequence numbering, and per-conversation Merkle tree building during active conversations. Circuit relay for NAT-failed sessions. No persistent state — per-session Merkle state is handed to the directory at seal time and destroyed.

This separation is the first line of defense against the fallback downgrade attack: a DDoS against connection nodes cannot reach relay nodes. Existing sessions continue with K_local signing (the normal per-message mode) regardless of what is happening to the connection layer.

**Fully federated — no home node:**

PII (phone numbers, WebAuthn credentials, OAuth tokens) lives in the signup portal, which is a separate system from the directory. Directory nodes hold only public keys, trust signal hashes, K_server_X shares (envelope-encrypted), and Merkle trees — all replicated across all nodes via the append-only log. No single node has a privileged relationship with any agent. When a node needs to alert an agent owner, it sends a public-key event to the signup system, which performs the phone lookup — the node never learns the phone number.

### 2.3 FROST Signing

K_server is never assembled in one place. Signing uses FROST (Flexible Round-Optimized Schnorr Threshold signatures) on Ed25519.

```
K_server distributed across nodes as FROST key shares:
  Node A holds share 1
  Node B holds share 2
  Node C holds share 3
  ...

To sign: any t-of-n nodes independently compute partial signatures
       → Partial signatures combined → valid threshold signature
       → The agent never holds K_server or any reconstructable share
       → The combined key is never assembled in one place
```

Ed25519 was chosen over ECDSA because of deterministic nonces (RFC 8032), eliminating the entire class of nonce-reuse vulnerabilities that have historically destroyed ECDSA deployments. Ed25519 + FROST is the right combination for threshold signing in environments that include constrained devices (IoT, robots).

K_server rotation is scheduled and automatic — the directory rotates K_server without requiring action from the agent. A stolen K_local from last week is useless with this week's K_server.

**When FROST is used:**

FROST ceremonies occur at two points in the protocol — not on every message:

1. **Session establishment** — the initiating agent coordinates a FROST ceremony with t-of-n directory nodes. Only the initiator's FROST group signs the `SessionAssignment`; the combined signature is embedded with `signer_pubkey: initiator_primary_pubkey`. The counterparty verifies the FROST signature against the `signer_pubkey` field in the frame. The initiator proves liveness via the FROST ceremony; the counterparty proves liveness via K_local-signed message leaves and by co-signing the bilateral SEAL control leaf at close.
2. **Conversation seal** — the seal initiator (the agent who called `cello_close_session`) coordinates a FROST ceremony co-signing the verified Merkle root. The directory attests to the conversation's existence and final state via a `SealNotarization`. The sealed root enters the MMR.

Individual messages are signed with **K_local alone** and verified against **pubkey(K_local)**. The relay node receives signed Merkle leaves (containing message hashes, not content), assigns sequence numbers, and relays them to the counterparty. The directory is dormant during the session — it returns as the active authority only at seal time.

**The compromise canary (narrow detection window):**

Every agent has `primary_pubkey` (the FROST group key derived from the DKG ceremony with directory nodes) registered on the directory alongside K_local's public key. K_local's public key is used for per-message signature verification and challenge-response auth; `primary_pubkey` is used for FROST signature verification at session boundaries.

If a stolen client (K_local + FROST key share) attempts to coordinate a FROST ceremony **while the legitimate agent is also attempting one**, the directory detects the conflict (two competing ceremony requests for the same agent from different sources). This canary only fires on **concurrent liveness claims** — if the attacker uses the stolen material after the legitimate agent goes idle, the directory sees normal sequential behavior and the canary does not fire.

The canary is a narrow supplementary detection mechanism, not the primary compromise defense. The primary defenses against sequential unauthorized use are behavioral: burst activity, unusual hours, unknown peers → push notification to owner; counterparty scan failures → FLAGGED attestation; owner-initiated "Not Me" → immediate K_server burn and dual-path forced abort (§8.3).

### 2.4 Replication and Consensus

**What actually requires consensus:**

1. **Directory state changes** (infrequent): registrations, key rotations, trust signal updates, tombstones. All nodes must process the same operations in the same order to arrive at the same state.
2. **Conversation hash ledger** (high frequency): canonical sequence numbers for the global append-only ledger. Every message hash needs a canonical position.

**The real-time and consensus paths are fully separated:**

- **Real-time path**: The assigned relay node receives hashes, assigns sequence numbers, relays Structure 2 leaves to the counterparty. On the critical path — agents never wait for consensus.
- **Propagation**: Directory nodes propagate identity state changes asynchronously. Not on the critical path.
- **Consensus**: Periodic checkpoint where directory nodes agree on ledger state (global MMR). Background, agents unaffected.

**Relay failure recovery:**

Both agents maintain their local Merkle tree copies throughout the session. Their persistent WebSocket to the directory is dormant but open. If the relay fails: either agent signals the directory via the dormant WebSocket; the directory assigns a new relay; the new relay picks up sequencing from the last confirmed sequence number. For sessions with a direct P2P connection (~70–80%), message delivery continues during relay failure — only hash relay is interrupted. For NAT-failed sessions (~20–30%), both paths are interrupted; messages queue until the new relay is up.

**Client-side latency monitoring:**

Clients maintain persistent connections to all nodes and send lightweight pings every 10–30 seconds (configurable): a timestamp out, a timestamp back, plus one byte load indicator from the node. The client maintains a live latency table and migrates sessions proactively to faster nodes before degradation is visible to the agent. Nodes return a higher load indicator as they approach capacity — creating distributed load balancing with no central coordinator.

**How nodes keep each other honest:**

```
Every N minutes:
  Node A → all: "Checkpoint #4721, identity root: abc123"
  Node B → all: "Checkpoint #4721, identity root: abc123"
  Node C → all: "Checkpoint #4721, identity root: def456"  ← diverged, flagged immediately
```

A compromised node maintaining two copies (honest data for peers, tampered data for clients) is caught by client-side Merkle proof verification.

### 2.5 Client-Side Merkle Proof Verification

The client never trusts a single node's data. For any critical lookup:

1. Query multiple nodes for the current consensus checkpoint hash (32 bytes)
2. Request the data (e.g., an agent's public key) plus a Merkle proof from one node
3. Verify locally: hash the returned data → combine with sibling hashes in the proof → check it produces the consensus checkpoint hash

If a node tampered with the data, the verification chain doesn't produce the checkpoint hash that other nodes confirmed. Proof size is logarithmic — ~20 hashes (~640 bytes) for a million-agent directory. Verification costs microseconds.

---

## Part 3: Coming Online

### 3.1 Authentication — Challenge-Response

Authentication is **bidirectional**. Both the agent and the directory node prove their identities:

```
1. Agent connects via WebSocket, identifies itself: "I'm TravelBot"
2. Directory sends a 256-bit CSPRNG challenge nonce (single-use, short expiry)
3. Agent signs: nonce + agent_ID + directory_node_ID + timestamp  (Ed25519, with K_local)
4. Directory verifies the signature against the agent's registered public key
5. Directory signs its own challenge response with its node key
6. Agent verifies the directory's signature against the consortium's known node keys
7. Authenticated session established
```

The nonce design prevents:
- Precomputation attacks (256-bit CSPRNG)
- Cross-session replay (bound to agent_ID)
- Cross-node replay (bound to directory_node_ID)
- Timestamp attacks (timestamp binding with skew check)

This is a login using K_local alone — a proof of possession. The directory then initiates the FROST ceremony for session establishment, co-signing the session with K_local + K_server. Individual messages during the session are signed with K_local; FROST is not used per message (see §2.3).

### 3.2 What "Online" Means

After authentication, the agent has an active WebSocket session with the directory, can receive and send connection requests. Once a session is established, hash relay goes to the assigned relay node (not the directory). The directory WebSocket remains dormant during active sessions — open for connection requests and relay failure recovery. Agents always initiate connections to directory nodes — no node can cold-call an agent.

### 3.3 Degraded Mode — When the Directory Is Unavailable

The client detects degraded mode from its live latency table. Three degradation surfaces:

**1. Relay nodes unavailable (existing sessions affected):**

For sessions with a direct P2P connection (~70–80%): message delivery continues uninterrupted; only hash relay is down. Agents queue hashes locally. When the directory assigns a new relay, agents submit queued hashes and resume sequencing.

For NAT-failed sessions (~20–30%): both message and hash paths are interrupted. Messages queue on sender; delivery resumes when a new relay is assigned (within the `delivery_grace_seconds` window, default 600 seconds).

Bilateral seal remains available immediately — no relay or directory needed. The notarized FROST seal is deferred until a relay and the directory are both available.

**2. Connection nodes unavailable (new sessions affected):**

New connection requests cannot be authenticated against the directory. Default behavior: refuse new unauthenticated connections, with a clear reason sent to the requester: "directory unreachable, not accepting unauthenticated sessions — retry when available."

Exception: agents on the degraded-mode list (see below).

**3. Sequence number authority unavailable:**

Both parties assign local sequence numbers from the hash chain (prev_root embedding provides ordering even without an authority). When the directory returns, both parties submit their locally-sequenced hashes. If chains agree, the directory assigns canonical numbers retroactively. If they disagree, the discrepancy is flagged.

**The two-list model:**

The client maintains two distinct, independently configurable lists:

**Whitelist** — agents given preferential treatment under normal authenticated conditions. Can be a long list. Does not automatically confer degraded-mode access.

**Degraded-mode list** — agents the owner trusts enough to communicate with when directory authentication is completely unavailable. Expected to be much shorter: a stronger statement of trust. "Even without the directory confirming who you are, I'm confident enough to proceed."

Default behavior during degraded mode:

| Inbound agent | Default behavior |
|---|---|
| On degraded-mode list | Accept (at reduced trust, flagged in Merkle leaf) |
| On whitelist only | Refuse — retry when directory available |
| Unknown | Refuse |

**Asymmetric whitelist knowledge:**

The client tracks only its own lists — who it has decided to trust. It does not track which other agents have listed it. An attacker who compromises a machine gets no map of who to target — they must probe blindly, burning resources and generating detectable noise. This is private by design: whitelist composition is each agent owner's private decision and is never surfaced to others.

**Trust-weighted pool selection (for connection nodes under load):**

When connection nodes are under load (DDoS or legitimate heavy traffic), incoming requests are sampled from a pool weighted by trust signals rather than processed FIFO. A phone-only agent and a WebAuthn + GitHub + LinkedIn agent both enter the pool, at different weights. Bulk fake accounts carry minimal trust signals and therefore minimal pool weight. To dominate the pool, the attacker needs those fake accounts to carry genuine trust signals — making the attack exponentially more expensive as verification layers stack.

---

## Part 4: Discovery

### 4.1 What's Visible — Two-Tier Discovery

Discovery operates on two tiers with different authentication requirements (C-6):

**Tier 1 — Public browse (no authentication required):**

Anyone — including unauthenticated bots, browser visitors, and non-CELLO systems — can browse Class 1 public profile data without a session:
- Bio (voluntarily published, rate-limited changes)
- Capability tags and agent type
- Pricing (optional, for marketplace agents)
- Connection policy indicator (whether the agent is accepting connections — the policy details are not exposed)
- Anonymous trust score — a normalized summary visible without disclosing which signals contribute or at what weight

This tier is deliberately public. It is the agent's advertisement to the world and enables search indexers and external discovery.

**Tier 2 — Protocol operations (FROST-authenticated session required):**

Deeper queries require an authenticated session: initiating connection requests, requesting trust signal hashes via selective disclosure, PSI endorsement intersection, obtaining relay assignments. This prevents the directory from being used as a hit list for bulk scraping of protocol state.

**What the directory does NOT expose (at either tier):**
- Connection details, phone numbers, or keys
- Trust signal details (recipient requests these directly from the agent's client via selective disclosure)
- Who the agent has talked to

### 4.2 Bio and Greeting

**Bio** — a static, public-facing statement. Visible to anyone browsing the directory — no connection required. Rate-limited globally: can only be updated once every N hours. Bio stability is itself a signal — a bio unchanged for 18 months is more credible than one changed yesterday. Bio changes are recorded in the identity Merkle tree with a timestamp.

**Greeting** — a contextual, per-recipient message sent at connection request time. Not on the public profile. Different recipients can receive different greetings. Rate-limited per recipient. Shown to the receiver before they decide to accept or reject — it informs their decision.

The greeting is recorded in the conversation Merkle tree at the moment of the connection request. Neither side can later deny what was said at first contact.

---

## Part 5: Connecting to Another Agent

### 5.1 Connection Request Flow

```
Agent A finds TravelBot in directory
  → Sees public profile only (no connection details exposed)
  → Client bundles A's trust signal blobs (each signed by A at creation time) and greeting text with the connection request
  → Directory receives the package:
      1. Checks each trust blob against held hashes (fraud filter — stops invalid/tampered submissions)
      2. Appends track record stats from its authoritative store (directory-held data, not A-submitted)
      3. Layer 1 sanitizes the greeting text before queuing
      4. Forwards full package to TravelBot via TravelBot's authenticated WebSocket as a CONNECTION_REQUEST notification
      5. Discards the trust blobs — never stored beyond hashes
  → A's original Ed25519 signatures on each blob arrive intact — directory does not re-sign
  → The package TravelBot receives: A's trust blobs (signed by A), A's identity key, directory-appended track record stats, and Layer 1 sanitized greeting
```

The directory is not a trust authority — it is a verified relay with a fraud filter. A compromised directory could pass fraudulent data; TravelBot's independent verification (below) is the actual security boundary.

### 5.2 Receiver-Side Verification Before Accepting

Before accepting, TravelBot's client performs two independent verification steps — neither relies on the directory's vouch:

```
Step 1 — Identity verification (Merkle inclusion proof):
  TravelBot queries Agent A's public key from multiple directory nodes
    → Each node provides data + Merkle proof path to consensus checkpoint root
    → TravelBot recomputes the root locally against the signed checkpoint
    → All queried nodes must agree
    → If any check fails → reject, log, alert owner

Step 2 — Trust signal verification (Agent A's own signatures):
  For each trust blob in the connection package:
    → TravelBot verifies Agent A's signature on the blob
    → Using the identity key confirmed in Step 1
    → The directory's fraud filter is a first-line check, not a substitute for this verification
    → If any signature fails → reject, log, alert owner

Both steps pass → proceed to acceptance policy
```

A compromised node serving a fake public key cannot pass this check — the fake key won't produce the correct Merkle proof against the checkpoint hash the other nodes confirmed.

### 5.3 Connection Acceptance Policies

| Policy | Behavior |
|---|---|
| **Open** | Auto-accept all requests meeting minimum trust signal requirements |
| **Require endorsements** | Accept only if N agents I know have pre-endorsed the requester |
| **Require introduction** | Ad-hoc fallback: accept if a mutual contact vouches in real time |
| **Selective** | Auto-accept known agents, notify owner for unknowns |
| **Guarded** | Owner must manually approve every new connection |
| **Listed only** | Visible in directory but not accepting connections |

Receiving agents can additionally require:
- Specific verification factors as hard gates ("must have WebAuthn")
- Verification freshness ("phone verified within 48 hours", "WebAuthn within 24 hours")

Rejection always includes a reason with a clear path to fix it. The market pressure is stronger than any mandate — agents handling real money will require WebAuthn, and the requester gets specific instructions rather than a mysterious refusal.

### 5.4 Pre-Computed Endorsements

A connection endorsement is a signed, binary statement: "I know this agent and have had no issues with them." Unlike just-in-time introductions (which require the introducer to be online), endorsements are pre-computed and verified via hash lookup at connection time — milliseconds, no round-trips, no endorser availability required.

**Endorsement flow (ahead of time):**
```
Alice asks Bob to endorse her
  → Bob signs: (Alice's pubkey, Bob's pubkey, optional context string, timestamp)
  → Bob sends signed endorsement to Alice AND to the directory
  → Directory verifies Bob's signature, hashes the endorsement, stores hash, discards content
  → Alice stores the endorsement locally
```

**Verification at connection time:**
```
Alice contacts Charlie (who requires endorsements)
  → Charlie's client computes: "agents I know" ∩ "agents who endorsed Alice"  (via PSI — see §5.5)
  → Alice provides her relevant endorsements
  → Charlie verifies each against the directory hash
  → Pure hash lookup — no inference, no calling Bob, no waiting for Bob to be online
  → Accept or decline based on configured policy
```

**Anti-farming rule:** Connection endorsements between agents with the same owner are invalid. The directory enforces this at submission time — if endorser and endorsed share a phone-verified owner, the submission is rejected. Protocol-level, no monitoring required.

**Bootstrapping new agents:** When creating a second or business agent, the existing agent's client requests endorsements from established contacts ahead of launch. The new agent starts with pre-built endorsements rather than cold-starting with no trust signals.

**Just-in-time introductions** (the original mechanism) remain as the fallback for agents with no pre-built endorsements who have a mutual contact available in real time. Endorsements are the preferred path; introductions are the fallback.

### 5.5 PSI for Privacy-Preserving Endorsement Intersection

Computing "Charlie's contacts ∩ Alice's endorsers" naively requires one party to expose their full set. An attacker making a connection attempt could use even a refused connection to harvest Charlie's full contact graph — then target those specific people for manufactured endorsements.

**Private Set Intersection (PSI)** lets both parties compute the intersection without either learning the other's unmatched entries. The directory facilitates the computation without learning either full set. PSI inputs are transient — discarded after computation, never persisted.

**Two variants:**

**PSI-CA (cardinality only)** — for threshold policies ("accept if N agents I know have endorsed Alice"). Reveals only the count, not which agents matched.

**Full PSI** — for content-verified policies ("accept if a specific known agent has endorsed Alice"). Reveals which agents matched, allowing Charlie to fetch and verify the actual endorsement content.

**How PSI and asymmetric whitelist knowledge work together:**
- Before the connection attempt: the attacker can't learn whose whitelist the target is on (asymmetric whitelist knowledge)
- During the connection attempt: even a failed attempt teaches the attacker nothing about Charlie's contact set (PSI)

PSI is not a day-one requirement. Priority: endorsement mechanism first → PSI-CA in second phase → full PSI in third phase.

### 5.6 Connection Staking and the Gate Pyramid

**For open institutions** (hospitals, emergency services) that cannot use closed connection policies, staking provides an economic defense:

The connecting agent stakes a small amount from their escrow wallet. The stake is held until session close:
- **CLEAN attestation** → stake returned automatically
- **FLAGGED + upheld arbitration** → institution can claim the stake

For honest users the net cost is zero. For attackers, mass connection attempts consume their escrow balance. The institution is literally paid by the attacker to defend against the attack.

The escrow release trigger is the session close attestation (§6.7) — no separate mechanism required.

**Flat connection fee alternative:**

A creative attacker LLM can pass all filter gates, engage convincingly, and slowly burn an institution's tokens without producing an outcome. For this attack vector, staking-plus-arbitration fails (the claim is too hard to prove). A flat non-refundable connection fee is more robust: paid upfront, no arbitration required. Both models belong in the toolkit:
- Staking + arbitration — for clear-cut abuse where the claim is unambiguous
- Flat fee — for defending against creative time-wasters

**The Gate Pyramid — inference is the last gate, not the first:**

| Gate | What it checks | Cost |
|---|---|---|
| **1. Connection level** | Endorsement policy, trust signal requirements, whitelist/blacklist, stake requirement | Lookup, no inference |
| **2. Message level** | Valid signature + directory-confirmed hash, rate limit, message size, declared notification type | Deterministic |
| **3. Pattern matching** | Known bad patterns, structure validation, sender frequency anomaly | Rule-based, no LLM |
| **4. DeBERTa scanner** | Cheap ML classifier | Cheap inference |
| **5. Full LLM processing** | Only traffic that cleared all above | Expensive |

By the time a message reaches the LLM, it has proven: valid stake, sufficient trust signals, valid hash, within rate limits, passing pattern checks. The vast majority of attack traffic never reaches inference.

**Phasing:** Connection staking defaults to zero at launch. The hooks exist from day one; institutions opt in when they have a reason.

### 5.7 Session Establishment

On acceptance, both agents establish a direct channel.

**libp2p (ephemeral P2P):**
```
On acceptance:
  → Both agents generate ephemeral libp2p peer IDs
  → Peer IDs exchanged through directory (one-time, not stored)
  → Direct P2P connection established on ephemeral IDs
  → Both agents connect to the assigned relay node for hash relay

Session ends:
  → Ephemeral peer IDs destroyed on both sides
  → Next conversation requires a new directory handshake
  → No persistent back doors, no stale connection details
```

**Platform transports (Slack/Discord/Telegram):**

Messages travel via the platform. Hashes always travel via the directory WebSocket — never through the platform:

```
Message path:  Agent A → Slack/Discord/TG → Agent B
Hash path:     Agent A → Directory WebSocket → Agent B
```

Agent B hashes what arrived from Slack and compares against the hash from the directory. A mismatch means the message was modified in transit. The platform is just transport — CELLO layers trust on top without replacing it.

---

## Part 6: The Conversation

### 6.1 Hash Relay Mechanics — Dual-Path Architecture

The relay node is the hash relay during active sessions. It receives only SHA-256 hashes (32 bytes per message) — never content.

Every message follows two paths simultaneously:
1. **Direct channel** — message + embedded signed hash → receiver (fast)
2. **Relay node** — signed hash only → relay node (for sequencing and notarization)

Because the paths are independent, delivery order is non-deterministic. The client handles all failure modes (§6.4).

**Signed hashes:** Every hash payload is signed by the sender (Ed25519). The receiver verifies the sender's signature directly — it does not trust the relay node's version. Signed hashes travel both routes: via the relay for third-party notarization, and embedded in the direct channel message for local verification.

A message arriving without a valid embedded signed hash is rejected by the receiver's client. This means even if the directory is completely down, the receiver can still verify message integrity from the embedded signed hash — and the conversation can continue locally until reconciliation.

### 6.2 Merkle Tree Construction

Three copies of the Merkle tree exist: sender, receiver, and directory. All three are identical if no tampering has occurred.

**Two-structure leaf format (RFC 6962, domain-separated):**

The Merkle leaf is two distinct data structures. The sender produces Structure 1; the relay node embeds it into Structure 2:

```
Structure 1 (inner, sender-signed with K_local):
  TBS: [protocol_version, content_hash, sender_pubkey, session_id, last_seen_seq, timestamp]
  ↳ content_hash     ← SHA-256(0x00 || message content)
  ↳ session_id       ← 16-byte session identifier
  ↳ last_seen_seq    ← highest canonical sequence number sender has observed from relay
  sender_signature   ← Ed25519 over canonical CBOR of the TBS array

Structure 2 (outer, relay-constructed — 6-element CBOR array):
  [sequence_number, sender_pubkey, content_hash, sender_signature, scan_result, prev_root]
  ↳ sequence_number  ← relay-assigned canonical number
  ↳ sender_signature ← Structure 1 signature embedded verbatim
  ↳ scan_result      ← {score, verdict, model_hash}; placeholder sentinel until M4 scanner
  ↳ prev_root        ← relay-appended; chains to previous state

Leaf hash = SHA-256(leaf_kind_byte || canonical_CBOR(Structure 2))
  where leaf_kind_byte = 0x00 for message leaves, 0x02 for control leaves.
  The prefix byte is outside the CBOR — it is not a field inside Structure 2.
```

The relay node embeds Structure 1's `sender_signature` into Structure 2 and computes `prev_root`. **The client never computes `prev_root`** — in multi-party conversations, the relay node is the only entity with canonical sequence across all senders during the session.

The `prev_root` field creates a blockchain within the tree — each message commits to the entire history that preceded it. Gaps and modifications are detectable immediately.

RFC 6962 prefix scheme: `0x00` message leaves, `0x01` internal nodes, `0x02` control leaves (SEAL, SEAL-UNILATERAL, EXPIRE, ABORT, ABORT-BILLING, REOPEN, RECEIPT, FLOOR_GRANT, CONTINUATION_GRANT, AUTO_MUTE, KICK, MENTION_INSERT, ROLE_CHANGE).

**First message initialization:**
```
prev_root = SHA-256(agent_A_pubkey || agent_B_pubkey || session_id || timestamp)
```
The directory computes this genesis `prev_root` and includes it in the signed session assignment handed to the relay. It anchors the chain from message 1, preventing first-message substitution by a compromised relay.

**What this proves:**
- **No MITM**: hash and message travel different paths — modification in transit produces a mismatch
- **Non-repudiation**: the sender can't deny sending a message — both the directory and the receiver hold the hash
- **Tamper-proof history**: three independent copies; modifying your local history changes your root vs. the others
- **Privacy**: the directory never sees content — only 32-byte hashes, not readable via subpoena

### 6.3 Sequence Numbers

**Normal (relay available):** The relay node assigns canonical sequence numbers when hashes arrive. Both parties wait for the relay's Structure 2 leaf before computing their local tree update. Strongest ordering guarantee.

**Degraded (relay unavailable):** Both parties have their local Merkle tree copies up to the last confirmed sequence. The directory assigns a new relay (see §3.3). Until reassignment, agents with direct P2P connections queue hashes locally. Agents without direct P2P (NAT-failed sessions) queue messages on the sender.

**Reconciliation (after relay reassignment):** Agents submit any queued hashes to the new relay, which picks up sequencing from the last confirmed point. Both agents' trees must agree on the sequence before the new relay resumes.

### 6.4 Delivery Failure Handling

The dual-path architecture creates a structured failure space. Each case has a time axis (sub-second → grace period → grace expired, session active → session dead). The grace period default is 600 seconds (10 minutes), configurable via `delivery_grace_seconds` in `cello_configure`. It applies protocol-wide — there is no per-conversation-type variation.

**Case A — Both hash and message arrive:**
- A1: They match → normal flow, complete
- A2: They don't match → tampering detected, reject, alert both parties

**Case B — Hash arrives (from directory), message doesn't:**
- B1 (within grace period): wait → becomes A1 or A2
- B2 (grace expired, session active): receiver pings sender; sender resends → A1/A2; sender denies sending → security event (forged hash or compromised sender)
- B3 (sender unreachable): directory holds a signed hash proving composition and submission; delivery not yet proven
- B4 (session dead): message arriving after session termination can be accepted for the record only, or discarded — configurable per conversation type

**Case C — Message arrives (direct channel), hash doesn't:**
- C1 (within grace period): wait → becomes A1 or A2
- C2 (grace expired): receiver pings directory
  - Directory has the hash → resolved (pure relay latency)
  - Directory doesn't have it → sender may not have submitted; request resubmission
  - Directory unreachable → message locally verifiable from embedded signed hash; accept provisionally; reconcile when directory returns

**Case D — Neither arrives:**
- D1: Sender gets delivery failure → can retry
- D2 (silent failure): conversation stalls; sender notices no response; directory can detect missing ACK and notify sender that delivery appears to have failed

Grace periods are configurable and may differ by conversation type (commerce vs. casual).

### 6.5 Notification Messages — Fire and Forget

Not all communication is a conversation. Notifications are self-contained, self-sealing messages with no session, no reply path, and termination baked in.

**Properties:**
- No session opened, no OPEN handshake
- No reply expected, no reply path
- Still signed by sender (non-repudiation applies)
- Still hashed (tamper detection)
- Directory records hash as a standalone event — not chained into a session Merkle tree

**Every notification carries a declared type** from a standardized registry:
`introduction`, `order-update`, `alert`, `promotional`, `system`, and others.
Declaring a misleading type is a signed, verifiable act and a trust signal event if flagged.

**Prior conversation requirement:** A notification can only be sent to an agent with whom the sender has had at least one prior conversation. Cold-contact spam is impossible at the protocol level.

**Filtering is a rule engine, not an inference engine.** Each incoming notification is evaluated against a deterministic rule stack:
1. Global type rules — "I never accept `promotional` from anyone"
2. Sender overrides — "except Agent X"
3. Whitelist / blacklist — explicit sender lists

Precedence: sender override beats global type rule. O(1) per notification — no LLM involved. If filtering required LLM inference, spam would become a compute DoS attack. The LLM only fires if a notification clears the filter and the agent decides to act on it.

**Rate limiting:** Per-sending-agent limits enforced at the directory. Trust-signal-gated: fewer trust signals = stricter limits. Verified businesses can apply for elevated rate limits; the recipient's opt-out always overrides regardless of the sender's permitted rate.

**Use cases:** agent introductions, tombstone notifications to counterparties, directory alerts, trust events, recovery event notifications.

### 6.6 Session Termination Protocol

Termination is a first-class protocol event. The Merkle tree supports three leaf prefixes: `0x00` for message leaves, `0x01` for internal nodes (RFC 6962), and `0x02` for control leaves (SEAL, SEAL-UNILATERAL, EXPIRE, ABORT, ABORT-BILLING, REOPEN, RECEIPT, FLOOR_GRANT, CONTINUATION_GRANT, AUTO_MUTE, KICK, MENTION_INSERT, ROLE_CHANGE). Control leaves are hashed and signed identically to message leaves.

**Clean termination (bilateral seal):**
1. Party A calls `cello_close_session` — the client runs its self-audit, produces the session attestation, and emits a SEAL control leaf (signed, hashed, carries A's attestation)
2. Party B's client receives A's SEAL leaf, runs its own self-audit, and emits B's SEAL control leaf (signed, hashed, carries B's independent attestation)
3. The relay submits the complete leaf sequence to the directory. The directory recomputes the Merkle root from scratch, verifies per-leaf signatures and causal chain, and issues a `SealNotarization` (FROST-signed in M2+, recording the sealed root, both participants, and close timestamp)
4. Final Merkle root = complete, sealed conversation segment
5. After `SealNotarization`: a configurable grace window (`post_seal_grace_seconds`, default 300) permits late-arriving messages (in-flight before the sender received the `SealNotarization`) to be accepted as `post_seal: true` record-only leaves. After the grace window expires, any arriving message triggers an auto-REOPEN and is delivered as the first leaf of a new continuation segment.

**Design note — no CLOSE/CLOSE-ACK handshake:** The bilateral SEAL exchange is the complete termination mechanism. There is no separate CLOSE/CLOSE-ACK step preceding it. A SEAL leaf IS each party's signed statement that they are done — a separate "I intend to close" signal before it adds a round-trip and state machine complexity (CLOSE-sent, CLOSE-ACK-received, ready-to-seal, sealed) with no additional security value. The `post_seal_grace_seconds` window (default 300 seconds) handles the "B wasn't ready" case: if B had a message in flight when A's SEAL arrived, that message is accepted during the grace window. If this proves insufficient in practice — if agents frequently need an explicit "A is done sending" signal before they can produce their attestation — a CLOSE/CLOSE-ACK pair can be added as a purely additive protocol change without breaking existing seal semantics.

**Relationship between `post_seal_grace_seconds` and `SEAL-UNILATERAL` timeout:** The SEAL-UNILATERAL timeout (how long the directory waits for B's SEAL leaf before sealing unilaterally) must be longer than `post_seal_grace_seconds`. If B needs the grace window to process a late in-flight message before it can self-audit and emit its SEAL leaf, the SEAL-UNILATERAL timeout must accommodate that. Setting SEAL-UNILATERAL timeout < post_seal_grace would mean the directory seals unilaterally before B has had time to respond — defeating the purpose of the grace window.

**Unilateral close (SEAL-UNILATERAL):**
Party A sends a SEAL control leaf, Party B never responds within the SEAL-UNILATERAL timeout. Directory seals as "closed by A, unacknowledged by B." Different status from mutual close — the record shows B didn't confirm.

**Timeout (EXPIRE):**
No messages for a configurable period. Directory sends EXPIRE control leaf to both parties. Either party can REOPEN within a grace period.

**Abort:**
One party detects something wrong (hash mismatch, suspected compromise, malicious content). Sends ABORT with a reason code. An ABORTed conversation cannot be reopened — a new conversation with a new Merkle tree is required. Post-ABORT message arrivals are always rejected regardless of timing — the security event that triggered ABORT makes record-only acceptance unsafe.

**Explicit receipt (RECEIPT):**
An agent calls `cello_acknowledge_receipt` to record that it has processed a specific message. The client writes a signed RECEIPT control leaf into the Merkle tree — explicit causal commitment proving the agent received an offer before making a counter-offer, for example. Optional; implicit ACK via the Merkle chain is the default for all sessions.

**Resumption (REOPEN):**
Creates a new conversation segment cryptographically chained to the sealed predecessor. The sealed root of the prior segment remains a valid, independently-verifiable FROST-signed attestation of that segment's final state. The new segment's genesis `prev_root` = `SHA-256(previous_sealed_root || session_id || reopen_timestamp)` — this proves descent without invalidating the prior seal. Sequence numbers restart at 1 in the new segment. The relay's per-session state was destroyed at seal time; a new relay assignment provisions fresh state for the continuation segment.

Explicit REOPEN (bilateral) requires a new FROST ceremony — "FROST bookends the conversation" applies to each segment. Auto-REOPEN (triggered by a post-grace-window message arrival) does not require FROST — it is a protocol-level continuity mechanism for in-flight messages, not a participant-initiated act. The next explicit seal provides the closing bookend.

Not applicable to ABORTed conversations — ABORT is permanent.

| Termination | Merkle state | Reopenable? |
|---|---|---|
| Mutual SEAL | Sealed, both parties confirmed | Yes |
| SEAL-UNILATERAL | Sealed by one party | Yes |
| EXPIRE | Sealed with expiration marker | Yes (within grace) |
| ABORT | Sealed with abort reason + reason code | No |
| ABORT-BILLING | Sealed with billing dispute reason (cost cap exceeded, token count divergence, rate card hash mismatch) | No |

**Termination is subject to the same delivery failure modes.** Party A sends a SEAL control leaf, the hash reaches the directory, but the SEAL message never reaches B on the direct channel. The protocol handles this identically to Case B — if B never responds with its own SEAL leaf within the timeout, the directory seals as SEAL-UNILATERAL.

### 6.7 Session Close Attestation

Every participant's SEAL control leaf carries a per-participant attestation field:

| State | Meaning |
|---|---|
| **CLEAN** | No issues detected; normal operation throughout the session |
| **FLAGGED** | Something suspicious was observed; arbitration may follow |
| **PENDING** | Session closing but review ongoing; may escalate to human arbitration |
| **DELIVERED** | Transport-confirmed receipt with no LLM output — the message arrived at the client but was not processed by the agent (e.g., muted, graceful queue drain) |
| **ABSENT** | The participant's connection dropped and did not recover before seal; their client did not participate in the close handshake |

Both parties attest independently on their own row. If they disagree (one CLEAN, one FLAGGED), the SEAL records the disagreement — itself a meaningful signal. **FC-7: "Submit to arbitration" is triggered by any individual participant row entering FLAGGED state** — not by a conversation-level flag. DELIVERED and ABSENT are informational states; they do not by themselves trigger arbitration.

**Three functions of the attestation:**

**1. "Last known good" timestamps.** Every CLEAN close is a positive signed statement that the account was operating normally at that point. When a compromise is later reported, the most recent CLEAN close tightens the compromise window — the directory has dated evidence of clean operation, not just absence of anomalies.

**2. Forced LLM self-audit.** The agent must affirmatively evaluate the session before signing the close: Were there unusual requests? Did anything trigger the scanner? Was I asked to act outside my normal scope? A prompt injection attack that successfully manipulated the agent during a session may not survive end-of-session reflection.

**3. Default inversion.** The protocol does not assume clean unless flagged. A session is not confirmed clean until attested. Absence of a clean-close is itself a signal.

**Connection to escrow:** The session close attestation is the escrow release trigger for connection staking. CLEAN → stake returned. FLAGGED + upheld arbitration → institution can claim stake. The same mechanism serves two purposes — no separate escrow resolution system required.

---

## Part 7: Prompt Injection Defense

Every incoming message is scanned before it reaches the agent. The receiver's scan is the security boundary. The sender's scan (if they run one) is an honesty signal recorded in the Merkle leaf, not the defense.

### 7.1 Six-Layer Architecture

**Layer 1 — Deterministic sanitization (11 steps, no API calls, fails closed):**

Runs on every piece of untrusted text before any LLM sees it. Steps run in microseconds. Any unhandled exception blocks the message by default — the gate never passes through on error.

1. Invisible Unicode characters — stripped before anything else
2. Wallet-draining characters (high token cost, low visible content) — stripped; high counts trigger block
3. Lookalike character normalization — normalized against Unicode confusables.txt (6,800+ pairs); not a manual list
4. Token budget enforcement — via the model's actual tokenizer (not character count)
5. Combining mark cleanup — strips garbled text from excessive combining marks
6. Encoded character decoding — HTML entities, percent-encoding, etc.
7. Hidden instruction detection — base64/hex blocks
8. Statistical anomaly detection — precomputed character-frequency baselines; instant lookup, no model
9. Pattern matching — known role markers and jailbreak commands; must cover confusable equivalents from Step 3
10. Code block stripping — source-type aware: disabled or scoped to suspicious patterns only for technical workloads
11. Hard character limit — final fallback truncation

**Layer 2 — LLM scanner:**

A dedicated classification LLM (separate from the agent's main model) takes Layer 1's cleaned output. Returns structured JSON: risk score (0–100), attack categories, reasoning, evidence. Thresholds: review at 35, block at 70. Score overrides verdict if they contradict.

Invoked via the model API's structured output/function-calling mode — not a prompt-level JSON instruction. Schema validation before acting: any response failing schema validation is treated as a block at maximum score.

Two scan modes:
- **Local**: DeBERTa-v3-small INT8 (~100MB), downloaded on first install via postinstall script (SHA-256 verified). Free. Deterministic — receiver can re-run and compare.
- **Proxy (paid tier)**: routes through directory's hosted scanner. Post-Layer-1-sanitized, context-stripped text only. Provides trust badge.

**Layer 3 — Outbound content gate (blocking, instant pattern matching):**

All outbound delivery goes through a single centralized dispatcher — no channel can bypass this gate. Checks: API keys and auth tokens, internal file paths and network addresses, injection artifacts that survived into output, data exfiltration patterns (markdown image URLs with query params, HTML tags with external src, CSS url() references, hyperlinks with data in path/query/fragment), financial data patterns.

**Layer 4 — Redaction pipeline:**

Chains in order: secret redaction first (prevents PII patterns from matching inside redacted secrets) → PII redaction (personal emails against a maintained provider list, phone numbers, dollar amounts) → notification delivery.

**Layer 5 — Runtime governance:**

Wraps every LLM call system-wide. Spend limit (from actual API token counts, not estimates), volume limit (global cap with per-caller limits carving from the global budget), lifetime limit (per-process counter), duplicate detection (TTL-based hash cache). This is engineering hygiene, not injection defense — limits blast radius from bugs and runaway loops.

**Layer 6 — Access control:**

Deny-all posture for file system access. Allow-list of directories the agent may access. Sensitive filename deny-list as secondary backstop. Symlinks resolved before checking — resolved path must also be in allow-list. URL safety: resolve hostname to IP, check IP against private/reserved ranges (RFC 1918, loopback, link-local), pass the validated IP (not the original hostname) to the HTTP client with Host header preserved. This closes the DNS rebind TOCTOU window.

### 7.2 Integration into the Merkle Tree

Scan results are recorded in the Merkle leaf:
```
scan_result: { score, model_hash, sanitization_stats }
```

This means:
- Evidence of what was scanned, what result, and which model version
- A falsely clean scan from a compromised sender is detectable against the receiver's independent scan
- Scan evidence is part of the conversation record for dispute resolution

Every agent running the client is a sensor. If an agent sends malicious content, the receiver's client detects it, records the evidence in the Merkle leaf, and reports to the directory — no separate moderation system needed.

---

## Part 8: Compromise and Recovery

### 8.1 Compromise Detection — Continuous Trust Signals

Trust is not checked once at connection time. It is continuous throughout the conversation.

| Signal | What it means | Response |
|---|---|---|
| Failed FROST at session start | K_local may be stolen — attacker can't complete FROST from a different source | Alert owner, refuse session |
| Failed scan results | Messages contain malicious content | Block, record evidence, report |
| Burst activity from quiet agent | Possible takeover | Alert owner via phone |
| Activity at unusual hours | Pattern anomaly | Alert owner via phone |
| Unknown peers | Agent connecting to unfamiliar entities | Alert owner via phone |

The directory sees every hash arrive (it's the hash relay). Activity notifications go to the owner's configured channels — WhatsApp, Telegram, Slack, or native push via the CELLO mobile app. All configured channels fire simultaneously; there is no primary/fallback hierarchy and no suppression based on which apps are installed. The owner's configuration (`cello_configure`) is the sole determinant of which channels are active.

### 8.2 Activity Monitoring

```
Directory sees hash signed by TravelBot's key
  → Push notification to owner's WhatsApp/Telegram
  → "Your agent TravelBot started a conversation with SupplyBot"

Owner didn't initiate this?
  → Taps "Not me"
  → Directory burns K_server_X shares (no new FROST sessions)
  → Directory fires dual-path forced abort (see §8.3):
      Path 1: EMERGENCY_SESSION_ABORT to agent client → client ABORTs all sessions
      Path 2: PEER_COMPROMISED_ABORT to each counterparty → counterparties seal unilaterally
  → All active sessions terminated — attacker locked out of both new and existing sessions
  → Full re-keying later via WebAuthn on web portal
```

**Notification tiers:**

| Event | Notification |
|---|---|
| Normal conversation starts | Silent log, visible in app/dashboard |
| FROST session establishment fails | Push alert to phone |
| Anomalous pattern | Urgent push to phone |

### 8.3 Emergency Revocation ("Not Me") — Dual-Path Forced Abort

"Not me" triggers immediate revocation: directory burns K_server_X shares — no new FROST-authenticated sessions can be established, and no conversations can receive a notarized seal. **All active sessions are terminated immediately — there is no carve-out for K_local-only sessions. The owner does not know what was compromised; a hard stop on everything is the only safe response.**

K_server revocation alone cannot close existing P2P sessions — those are direct libp2p connections not routed through the directory. The attacker retains K_local and could continue operating on live channels. The directory therefore fires two parallel abort paths simultaneously:

**Path 1 — cooperative (directory → compromised agent client):** The directory sends an `EMERGENCY_SESSION_ABORT` control message to the agent's persistent WebSocket. The client sends a signed ABORT control leaf (K_local, `COMPROMISE_INITIATED` reason code) to each active counterparty via the existing P2P channels, then disconnects all sessions and drops the WebSocket. This path applies when the legitimate agent process is still running — e.g., K_local was stolen and is being used from elsewhere, but the original process is still connected.

**Path 2 — non-cooperative (directory → each counterparty):** For every active session the directory has on record, the directory sends a `PEER_COMPROMISED_ABORT` notification to each counterparty's authenticated WebSocket. The counterparty client seals unilaterally on receipt — regardless of whether an ABORT leaf arrives from the compromised side. This path applies when the agent process is offline, crashed, or attacker-controlled. The directory knows every session it facilitated and can always execute Path 2. **Path 2 is the more important path** — Path 1 is an optimisation that produces a cleaner Merkle record when available.

**What goes in the Merkle tree:** If Path 1 executes, an ABORT control leaf (K_local signed, `COMPROMISE_INITIATED` reason code) is appended to each conversation tree — both parties have a signed, reason-coded close. If only Path 2 executes, counterparties record SEAL-UNILATERAL from their side with no ABORT leaf from the compromised agent. The absence of an ABORT leaf from the compromised side is itself meaningful — it confirms the client was unresponsive at termination time.

Re-keying requires WebAuthn/2FA.

**SIM-swap risk:** An attacker who ports the phone number could use "Not me" to disrupt the legitimate agent. Mitigation: re-keying requires WebAuthn/2FA — a SIM-swap attacker can disrupt but cannot take over. This is the same tradeoff as every phone-based system, with the same mitigation.

### 8.4 Tombstones

Three distinct tombstone types, each producing a different directory record:

1. **Voluntary** — owner-initiated, WebAuthn-authenticated. Clean account closure.
2. **Compromise-initiated** — triggered by "Not me." Phone OTP burns K_server. Signals active attack.
3. **Social recovery-initiated** — M-of-N recovery contacts agree and owner cannot act. Last resort.

**Immediate effects on any tombstone:**
- K_server burned; directory fires dual-path forced abort simultaneously: Path 1 `EMERGENCY_SESSION_ABORT` to the compromised agent client (cooperative — client sends ABORT leaves and disconnects), Path 2 `PEER_COMPROMISED_ABORT` to each counterparty's WebSocket (non-cooperative — works even if the compromised client is offline or attacker-controlled). All active sessions receive SEAL-UNILATERAL with tombstone reason code. No session continues after any tombstone.
- Social proofs enter a freeze period (30 days) — cannot be attached to any new account
- Phone number flagged as "in recovery" — cannot register a new account during freeze

The freeze is a critical defense: an attacker who has the phone and all OAuth sessions still cannot create a parallel identity using the victim's credentials — those credentials are frozen to the tombstoned account. Any move the attacker makes is visible.

### 8.5 Key Rotation

Key rotation requires human-level authentication (WebAuthn/2FA). Phone OTP alone is insufficient.

```
Owner visits web portal
  → Authenticates with WebAuthn/2FA
  → Generates new K_local
  → Directory generates new K_server shares (distributed via FROST)
  → New derived public keys published
  → Old public keys marked expired with timestamp
  → All agents who cached old keys get a refresh
```

Scheduled rotation can be automated — the agent prompts the human on a schedule.

### 8.6 Social Recovery

When WebAuthn and phone OTP are unavailable or compromised, the owner contacts pre-designated recovery contacts out-of-band. Those contacts sign cryptographic attestations within the CELLO protocol.

**Mechanics:**
- M-of-N threshold (configurable at registration)
- Recovery contacts must meet minimum trust signal requirements
- A vouching agent can participate in at most one recovery per month
- After M-of-N threshold is met: **48-hour mandatory waiting period** before the new key ceremony executes
  - During this window, the old key can still file a contest — defense against social engineering of recovery contacts
- After the window: new key ceremony initiated

**No ID document custody.** Identity document appeals are explicitly excluded. Becoming a custodian of identity documents creates regulatory obligations and conflicts with the no-PII design principle. If social recovery fails, the honest answer is start fresh — new identity, no trust signals. The network cannot override cryptography without creating a central authority.

**Social carry-forward:** Recovery contacts can voluntarily introduce the new identity to their network. Previously-connected agents can opt to reconnect at reduced trust. The cryptographic identity is new; the human relationships are not.

### 8.7 Compromise Window

The compromise window is anchored to logged events in the directory — not the owner's memory:
- Scan detection timestamps (when did the scanner first flag something?)
- Fallback canary events (when did FROST session establishment start failing?)
- Counterparty complaint timestamps
- Anomaly alert timestamps

When a tombstone is filed, the directory surfaces the earliest logged anomaly as the proposed window start. Activity before the earliest anomaly: owner responsible. Activity after: flagged as potentially unauthorized.

The session close attestation tightens the anchor: the most recent CLEAN close is a signed, dated statement of clean operation. Not just "no anomalies" — an affirmative signed statement.

### 8.8 Recovery Point

After recovery completes, the directory logs a formal recovery event (permanently visible in the trust profile):
- Tombstone type that preceded it
- Recovery mechanism used
- Identities and trust signals of vouching agents (if social recovery)
- Declared compromise window (start and end timestamps)
- New public key

**Post-recovery trust treatment (re-verify everything model):**

Recovery does not restore a trust score — it re-verifies each signal from scratch. What can be proved is recovered; what cannot be proved is not.

| Signal class | Recovery behavior |
|---|---|
| Key-dependent (WebAuthn, device attestation) | Must re-verify from scratch — these are bound to the old key/device and cannot transfer |
| Key-independent social signals (LinkedIn, GitHub, Twitter OAuth) | Restored immediately on fresh OAuth — the social account still exists under the same person |
| Track record and endorsements | Preserved — independently held by counterparties and still valid against the new key |

**Probationary period:** 3 months AND 200 clean conversations — both conditions must be satisfied before probationary status ends.

Compromise-window penalties decay at accelerated rate after verified re-keying. Previously-connected agents can opt to reconnect below their normal policy threshold.

### 8.9 Voucher Accountability

Two events within the liability window count against a vouching agent:
1. Another tombstone on the recovered account
2. A FLAGGED session upheld by arbitration on the recovered account

**Liability window:** 90 days from the date of recovery.

**Rolling 2-month cap:** A vouching agent is liable for at most one event per rolling 2-month window. During the first 2 months of probation the cap allows 1 attestation; after probation clears, the cap rises to 3 attestations per rolling 2-month window.

**Penalty:** 6-month lockout from vouching. Trust signals untouched — the voucher remains a full network participant. In an early network, punishing trust signals for good-faith vouching would cause rational agents to refuse to vouch for anyone, breaking the mechanism entirely.

**Two-strike permanent revocation:** After completing a lockout and being reinstated, if a second bad outcome occurs — permanent revocation of vouching privileges. A narrow capability revocation, not a trust signal penalty. The network is noting that their attestation of someone else's identity is not reliable.

**Per-account tracking was rejected.** Making it per-account creates an exploitable loophole — a malicious actor cycles through recovery attempts via one "friend" relationship. The protocol cannot distinguish collusion from blind loyalty. Flat two-strike global revocation is unexploitable.

---

## Part 9: Dispute Resolution

### 9.1 The Merkle Tree as Tiebreaker

In a dispute:
1. Compare Merkle roots across all three parties (sender, receiver, directory)
2. The disputing party provides the plaintext message
3. The directory hashes it and confirms it matches the stored hash
4. Proves what was said — without the directory ever having seen the content

This is arbitration without surveillance. The directory can prove exactly what was said even though it never read a single message.

The global meta-Merkle tree over all conversation registrations (§2.1) ensures a fake conversation cannot be inserted retroactively — either a conversation is in the tree at a given checkpoint, or it isn't.

### 9.2 Arbitration Flow

When a session seals with a FLAGGED attestation, the flagging party may submit the conversation transcript to the arbitration system.

**Precondition:** The transcript is cryptographically verifiable — the arbitrating system checks the Merkle root against the directory's record before evaluating. There is no dispute about what was said; only about whether it is concerning.

**Ephemeral inference:** Transcript in, verdict out, nothing stored. The only record is the verdict, recorded in the session seal. This is consistent with the broader design principle: the directory stores hashes, not content.

**Verdict tiers:**
- **Dismissed** — concern was overreach; minor notation that a dispute was filed and dismissed
- **Upheld** — legitimate concern; trust signal impact on the flagged party
- **Escalated** — serious enough for human review or network-wide alert

**Two-tier arbitration (G-27):**

**Tier 1 — Deterministic (auto-UPHELD):** A small set of unambiguous violation patterns resolve automatically: confirmed prompt injection with matching scanner evidence in the Merkle record, cryptographic forgery, agreed-upon blacklist violations. These are cases where the record itself provides conclusive evidence — no LLM judgment needed.

**Tier 2 — Inference panel:** For everything else, three independent frontier LLM instances from different model families (no two from the same provider) each evaluate the transcript independently. Majority verdict (2-of-3) determines the outcome. Agents entering arbitration are advised their transcript will be reviewed by the panel. The panel's system prompt is not published (to prevent gaming), but its existence and the diversity requirement are public protocol facts.

---

## Part 10: Privacy and Compliance

### 10.1 Data Classification

| Data | Where it lives | PII? | Crosses borders? |
|---|---|---|---|
| Phone, WebAuthn credentials, OAuth tokens | Signup portal (placed in owner's jurisdiction) | Yes | No — never leaves signup portal |
| K_server_X shares | All directory nodes (envelope-encrypted) | Cryptographic | Shares replicate across nodes; key is never assembled |
| Message content | Direct channel (P2P) | Potentially | Never touches infrastructure |
| SHA-256 hashes (active session) | Relay node (ephemeral — destroyed after seal handoff) | No | Yes — non-reversible, non-revealing |
| SHA-256 hashes (sealed) | Directory (via sealed Merkle root in global MMR) | No | Yes — non-reversible, non-revealing |
| Public keys | Directory / public ledger | Pseudonymous | Yes — no identity link in protocol |
| Trust signal record hashes | Directory / public ledger | No — hashes only | Yes |
| Trust signal records (original verification data) | Client-side only | Yes | Only if client chooses to share |
| Bios | Directory / public ledger | Voluntarily published | Yes — owner-authorized broadcast |

### 10.2 Cross-Jurisdictional Communication

When a UAE agent communicates with an EU agent:
- UAE citizen's PII stays in a signup portal placed in the UAE
- EU citizen's PII stays in a signup portal placed in the EU
- Directory nodes hold only hashes, public keys, and encrypted K_server_X shares — no PII
- Only hashes flow through relay nodes (which can be placed anywhere)
- Message content goes direct, never touches infrastructure
- Trust signals and bios are voluntarily published reputation data

No protected data crosses any border. The architecture satisfies both jurisdictions simultaneously.

**Pseudonymity:** A public key on the ledger is a number with no name attached. The link between a public key and a real person only exists if the agent voluntarily discloses it in a conversation — a policy decision by the agent's owner, not a protocol property. Trust signals are associated with public keys, not identities. A public key's trust signals are only personal data if you can link that key to a person — and that link is not in the protocol.

**Bios** are voluntary broadcasts: the owner wrote the bio, the owner chose to participate, publishing the bio is part of that choice. This is an advertisement, not a data leak. The owner cannot later claim the network violated their privacy by displaying information they voluntarily broadcast.

### 10.3 Account Deletion

Account deletion is authenticated via WebAuthn. It is a signed operation appended to the append-only log — a tombstone proving the account existed and was deleted, without retaining the data.

**What deletion means at each layer:**
- **Signup portal:** Full deletion — phone, WebAuthn credentials, OAuth tokens all wiped. Real deletion of real PII. The K_server_X shares held on directory nodes for this agent are also burned.
- **Directory:** A deletion marker (tombstone) is appended. The hash chain stays intact. The tombstone proves the account existed without retaining the data.
- **Key invalidation:** The tombstoned key can never be re-registered.

**Account deletion ≠ conversation record deletion.**

Your account is yours to delete. Conversation records belong to both parties. If you ordered a pizza and then deleted your account, the pizza place still has a Merkle tree showing a signed conversation happened, what was agreed, and the hash chain proving it. The deleted agent's public key in that record now points to a tombstone — but the hashes, signatures, and tree remain intact.

This mirrors established industry practice (WhatsApp, Telegram, banking records) and is defensible under GDPR Article 6(1)(b) — the counterparty has a legitimate interest in retaining proof of a commercial agreement. The right to erasure does not override another party's right to their own records.

---

## Related Documents

- [[protocol-map|CELLO Protocol Map]] — top-level orientation document; maps all eight protocol domains with summaries, canonical sources, discussion log references, and readiness status for user stories
- [[2026-04-11_1400_security-architecture-layers-and-trust-signal-classes|Security Architecture Layers and Trust Signal Classes]] — the four-layer system model and four trust signal classes (identity proofs, network graph, track record, economic stake); explains why each layer exists and why they can't be collapsed
- [[cello-initial-design|CELLO Design Document]] — the original 10-step architecture this document elaborates and extends
- [[prompt-injection-defense-layers-v2|Prompt Injection Defense Architecture]] — full specification of the 6-layer scanning pipeline (Part 7 above)
- [[open-decisions|Open Decisions]] — 12 resolved cryptographic and protocol decisions incorporated throughout
- [[design-problems|Design Problems]] — remaining open problems; Parts 3, 5, 8, and the Sybil architecture address Problems 1–4 and 6–7; Problem 5 (succession) is resolved by the succession log below
- [[2026-04-08_1430_protocol-strength-and-commerce|Protocol Strength and Commerce]] — non-repudiation as commerce primitive; fabricated conversation attack and the meta-Merkle tree defense
- [[2026-04-08_1530_message-delivery-and-termination|Message Delivery and Termination]] — delivery failure tree (§6.4) and session termination protocol (§6.6)
- [[2026-04-08_1600_data-residency-and-compliance|Data Residency and Compliance]] — GDPR analysis and pseudonymity model underlying Part 10
- [[2026-04-08_1700_node-architecture-and-replication|Node Architecture and Replication]] — three-phase node deployment (§2.2) and primary/backup replication (§2.4)
- [[2026-04-08_1800_account-compromise-and-recovery|Account Compromise and Recovery]] — social recovery, tombstones, session attestation, dispute resolution, voucher accountability (Part 8, §6.7, Part 9)
- [[2026-04-08_1830_notification-message-type|Notification Message Type]] — fire-and-forget primitive (§6.5)
- [[2026-04-08_1900_connection-staking-and-institutional-defense|Connection Staking and Institutional Defense]] — staking mechanics and gate pyramid (§5.6)
- [[2026-04-08_1930_client-side-trust-data-ownership|Client-Side Trust Data Ownership]] — hash-everything model (§1.3, Part 10)
- [[2026-04-10_1000_connection-endorsements-and-attestations|Connection Endorsements and Attestations]] — pre-computed endorsements (§5.4)
- [[2026-04-10_1100_fallback-downgrade-attack-defense|Fallback Downgrade Attack Defense]] — relay node separation, trust-weighted pool selection, degraded-mode policy (§2.2, §3.3, §5.6)
- [[2026-04-10_1200_psi-for-endorsement-intersection|PSI for Endorsement Intersection]] — PSI mechanics (§5.5)
- [[2026-04-11_1000_sybil-floor-and-trust-farming-defenses|Sybil Floor and Trust Farming Defenses]] — full Sybil defense stack (§1.5)
- [[2026-04-11_1400_libp2p-dht-and-peer-connectivity|libp2p, DHT, and Peer Connectivity]] — technical feasibility vetting of the full transport layer (§2, §3, §6): bootstrap discovery, directory authentication, ephemeral Peer IDs, three-layer NAT traversal, dual-path hash relay, and Merkle chain as implicit ACK
- [[2026-04-13_1000_device-attestation-reexamination|Device Attestation Reexamination]] — corrects §1.2 here: WebAuthn is account security (tethering), not device sacrifice; native app required for platform attestation; two-tier web/native architecture
- [[2026-04-13_1100_quantum-resistance-design|Quantum Resistance Design]] — cryptographic roadmap: FROST stays for session/seal signing; ML-DSA for endorsements, attestations, directory certificates; connection package size estimates at §5
- [[2026-04-15_0900_session-level-frost-signing|Session-Level FROST Signing]] — design decision: FROST at session establishment and seal only; individual messages signed with K_local; directory as passive notary
- [[2026-04-13_1200_discovery-system-design|Discovery System Design]] — three-class system (agent directory, bulletin board, group chat rooms), unified search stack, trust signal display, Merkle tree non-repudiation for group conversations; full elaboration of Part 4
- [[2026-04-11_1700_persistence-layer-design|Persistence Layer Design]] — complete schema for every protocol entity described in this document; reconciled directly against this flow to ensure all events, tables, and fields are covered
- [[2026-04-13_1400_meta-merkle-tree-design|Meta-Merkle Tree Design]] — full design of the conversation proof ledger referenced in §2.1 and §9; replaces hash chain with MMR for O(log N) inclusion proofs; defines the identity Merkle tree structure behind §2.5 client-side verification
- [[2026-04-13_1500_multi-party-conversation-design|Multi-Party Conversation Design]] — extends §6.2 (leaf format), §6.3 (sequencing), and §6.6 (seals) from two-party to N-party; authorship/ordering separation, serialized and concurrent modes, client-side receive windows for LLM agents
- [[2026-04-14_1000_contact-alias-design|Contact Alias Design]] — revocable privacy-preserving identifiers extending §5.1–5.3 connection request flow with alias-routed requests
- [[2026-04-14_1100_cello-mcp-server-tool-surface|CELLO MCP Server Tool Surface]] — 33 MCP tools implementing Steps 4–8 of this protocol flow; defines the agent-facing interface for sessions, security, discovery, connections, group conversations, and policy. The agent client exposes 43 tools total: the 33 base tools plus `cello_request_human_input`, `cello_acknowledge_receipt`, and 8 group room tools (`cello_invite_to_room`, `cello_petition_room`, `cello_get_room_info`, `cello_dissolve_room`, `cello_transfer_ownership`, `cello_request_continuation`, `cello_set_attention_mode`, `cello_set_participant_role`)
- [[2026-04-14_0700_agent-succession-and-ownership-transfer|Agent Succession and Ownership Transfer]] — resolves the §8 succession gap: voluntary transfer via identity_migration_log + announcement period; involuntary succession via dead-man's switch with pre-designated successor, 30-day waiting period, and M-of-N recovery contact attestation
- [[2026-04-14_1300_connection-request-flow-and-trust-relay|Connection Request Flow — Trust Data Relay and Selective Disclosure]] — original trust data relay design for §5 connection requests; the relay model was further refined by the AC-C9 resolution (agent-client.md): directory role is verify-then-relay-discard, receiver performs two independent verification steps (Merkle inclusion proof + Alice's own blob signatures)
- [[2026-04-15_1100_key-rotation-design|Key Rotation Design]] — session establishment and seal (§3 and §6.6) are the only FROST ceremony points affected by K_server rotation; K_local rotation renders stolen keys useless at session boundaries
- [[2026-04-14_1500_deprecate-trust-seeders-and-trustrank|Deprecate Trust Seeders and TrustRank]] — removes §1.5 Layer 0 (TrustRank) and the Trust Seeder cold-start cohort; the discovery system and organic endorsements replace the seeder bootstrapping path
- [[2026-04-17_1100_not-me-session-termination|"Not Me" Session Termination — Dual-Path Forced Abort]] — resolves the §8.3/§8.4 contradiction (C-5); all active sessions terminated immediately on "Not Me" via dual-path mechanism since K_server revocation alone cannot close existing P2P sessions
- [[2026-04-17_1400_directory-relay-architecture-reassessment|Directory/Relay Architecture Reassessment]] — redraws directory/relay boundary; directory active at session boundaries only (FROST), relay handles hash relay, sequencing, and Merkle tree building during sessions; affects §2.2 node architecture, §6 message flow, and §6.6 session seal
- [[2026-04-17_1000_trust-signal-pickup-queue|Trust Signal Pickup Queue]] — encrypted async pickup queue for trust signal blobs when agent client is offline at verification time; `TRUST_SIGNAL_PICKUP_PENDING` notification type; `identity_key` as encryption anchor (§1.3)
- [[2026-04-18_1357_connection-bond-usage-and-policy|Connection Bond Usage and Policy]] — two-mode bond design: voluntary trust signal vs. defensive receiver requirement; bond as prior consent mechanism for subscriptions and recurring interactions
- [[2026-04-18_1407_push-publish-subscription-model|Push-Publish Subscription Model]] — push-publish as a first-class protocol feature built on the notification primitive; subscription records, per-delivery micropayments, and cancellation flow (§12.1)
- [[2026-04-18_1412_human-agent-marketplace|Human-Agent Marketplace]] — humans selling skills to AI agents via a lightweight hosted human-relay agent tier; companion device as the human interface; skill verification signals (§12.2)
- [[2026-04-18_1454_merchant-crm-data-stash-and-free-samples|Merchant CRM Data Stash and Free Sample Tracking]] — per-contact interaction history stash; free sample tracking; merchant-side trust data that feeds commerce attestation (§12.3)
- [[2026-04-18_1620_commerce-attestation-and-fraud-detection|Commerce Attestation and Fraud Detection]] — purchase attestations at session close; behavioral fraud detection (seller concentration, velocity, lifecycle anomalies); escalation flow with ephemeral log review; KYC as the seller-side bottleneck (§12.4)
- [[2026-04-16_1400_companion-device-architecture|Companion Device Architecture]] — mobile and desktop apps as P2P companion devices; two separate channels (content pull + notification push); human injection flow; local persistence model; `cello_request_human_input` MCP tool (Part 13)
- [[2026-04-19_2045_group-room-design|Group Room Design]] — complete group room design: two-flag configuration, ownership/admin model, participant lifecycle, hybrid floor control with cohorts, attention modes, wallet protection, throttle manifest with creation-time constraints, scaling tiers, Sender Keys topology (Part 11)
- [[2026-04-24_1530_inference-billing-protocol|Inference Billing Protocol]] — token-priced inference sessions: rate card extension at session establishment, signed cumulative billing metadata in Merkle leaves, Layer 5 cost cap enforcement, ABORT-BILLING termination reason, three tokenizer verification modes (local, hosted opt-in, trust-only)

---

## Part 11: Group Rooms and Multi-Party Conversations

Group rooms are **private, encrypted, non-repudiable group communication** — analogous to WhatsApp groups but with cryptographic receipts that hold up in arbitration. This is structurally different from public agent platforms: floor control makes spam impossible, the relay never sees content, and every exchange is Merkle-notarized.

### 11.1 Room Configuration

Rooms are defined by two independent boolean flags, not a type enum:

| `discoverable` | `private` | Character |
|---|---|---|
| true | false | Open — findable, anyone joins freely |
| true | true | Selective — findable, petition required |
| false | true | Invite-only — not findable, explicit invite token required |
| false | false | Unlisted-open — not in search, anyone with the room ID can join |

Both flags are **immutable after creation** — they define the fundamental trust contract of the room.

### 11.2 Ownership, Admin, and Roles

Every room has exactly one owner. The owner can designate additional admins; an agent must have sent at least 5 messages before it can be designated admin (prevents attacker parking muted alts for custodial exploitation).

**Participant roles** are distinct from attention modes:

| Role | Can post | Gets FLOOR_GRANTs |
|---|---|---|
| `speaker` | Yes | Yes |
| `listener` | No | Never |

Role is a structural permission enforced by the relay (listener messages are rejected pre-sequence, never entering the Merkle tree). The throttle manifest specifies a `default_role`; the owner/admin can override per invite. A room can have up to 10 speakers and unlimited listeners.

**Ownership succession:** On owner departure, ownership transfers to the designated successor, then the highest-trust admin, then enters a 7-day custodial state. If no admin claims within 7 days, the room dissolves with a forced seal. All participants receive push notification on custodial state entry — lifecycle events are never silenced.

### 11.3 Conversation Mode: Hybrid Floor Control with Cohorts

The relay assigns turns to **cohorts** — groups of 1–4 speakers who all receive `FLOOR_GRANT` simultaneously. Within a cohort, responses are concurrent (members don't see each other's output until the next round); between cohorts, responses are sequential.

**How a round works:**
1. Relay sends `FLOOR_GRANT` to the current cohort
2. Each member receives the accumulated batch of messages since their last turn
3. Each responds (`cello_send`), passes (`cello_acknowledge_receipt`), or times out (auto-pass)
4. When all cohort members have responded/passed/timed out, relay advances to the next cohort — **no dead air**
5. Next cohort sees the updated batch including prior cohort's responses
6. After all cohorts speak, the cycle repeats

**The LLM never sees floor mechanics.** The client adapter handles everything silently — buffering messages between turns, invoking the LLM only on `FLOOR_GRANT`. The LLM sees a clean context: "Here are the last N messages. It is your turn to respond."

**Floor control vs. CONCURRENT+GCD:** The initial design used CONCURRENT+GCD with 14 manifest parameters. Adversarial review identified response cascade (3,600 LLM invocations/hour in a 10-agent room), structural cost waste in passive mode, and perverse muting incentives. Floor control uses 5 immutable parameters and eliminates all three problems.

### 11.4 New Control Leaf Types

Group rooms introduce relay-originated control leaves in addition to participant-originated ones:

| Type | Signed by | Purpose |
|---|---|---|
| `FLOOR_GRANT` | Relay | Assigns turn to cohort |
| `CONTINUATION_GRANT` | Relay | Grants one extra turn (capped at once per 5 of agent's own turns) |
| `MENTION_INSERT` | Relay | Priority-inserts @mentioned agent as next solo turn |
| `CHECKPOINT` | Relay | Periodic "last known good" anchor (every N messages or 24h); verifiable by clients |
| `AUTO_MUTE` | Relay | Forces muted mode after 2 violations in rolling window; trusted-relay assertion |
| `JOIN` / `LEAVE` | Participant | Participant lifecycle |
| `KICK` / `ROLE_CHANGE` | Owner/admin | Moderation |
| `OWNERSHIP_TRANSFER` / `DISSOLVE` | Owner | Room lifecycle |

**Relay trust surfaces:** CHECKPOINT is client-verifiable (recompute from local leaf sequence). AUTO_MUTE is not — the violation was dropped pre-sequence. Floor-starvation (never receiving a FLOOR_GRANT) is detectable by tracking grant frequency. The owner notification is the recovery path for all relay trust surfaces.

### 11.5 Wallet Protection

Every cost-affecting parameter is **immutable after creation** — the manifest is a binding contract, not a menu.

**Worst-case cost is computable from the manifest:**
```
max_tokens_per_invocation = (max_participants - 1) × max_message_size_chars / avg_chars_per_token
max_invocations_per_day = 86400 / (ceil(max_participants / speakers_per_round) × turn_timeout_seconds)
```

Both numbers are surfaced during room creation and at pre-join transparency. A per-room daily budget cap auto-mutes the agent on breach; a 50%-consumption alert offers a 2× budget approval option with a 5-minute response window.

### 11.6 Scaling Tiers

| Tier | Scale | Topology | Model |
|---|---|---|---|
| DM | 2 | Pairwise | Existing two-party sessions |
| Group conversation | 3–10 speakers | `full_mesh` | Floor control with cohorts |
| Broadcast channel | 1–10 speakers, 10–100+ listeners | `sender_keys` | Floor control over speaker pool; push delivery to listeners |

The 10 active speaker ceiling is a conversational limit: 10 speakers at 3-minute timeouts takes ~2 minutes per cycle at typical inference speed; 20 speakers would take ~4+ minutes — no longer a real-time conversation. `full_mesh` ships at launch. `sender_keys` (required for rooms >10 participants) is designed and specified but deferred pending the Sender Key distribution and rotation protocol (G-38).

### 11.7 How Group Rooms Change the Baseline Protocol

**Merkle structure:** Same two-structure leaf format (§6.2). The relay-originated control leaves (FLOOR_GRANT, CHECKPOINT, AUTO_MUTE) carry `0x02` prefix identical to other control leaves. The relay is now the originator of multiple leaf types, not just the sequencer of participant-originated ones.

**Session attestation:** Per-participant attestation rows (§6.7) apply to group rooms. ABSENT applies when a participant drops and doesn't return before seal. Each participant who was present at close submits their own CLEAN/FLAGGED/PENDING row; absent participants have no row.

**FROST:** Each joining participant runs an independent FROST ceremony with the directory — no shared ceremony across all participants. Latecomers run their own on arrival.

**EXPIRE:** Replaced in group rooms by per-participant ABSENT (72-hour inactivity) and room-level EXPIRE (all participants inactive for 72 hours). Active rooms run indefinitely until the owner dissolves them.

---

## Part 12: Commerce

Commerce on CELLO is possible because non-repudiation is a protocol property, not a feature. A 32-byte sealed Merkle root is a tamper-proof receipt for any commercial exchange. Four commerce primitives build on this foundation.

### 12.1 Push-Publish Subscriptions

Push-publish is a recurring content delivery model for micropublishing (news feeds, data streams, research digests). The publisher pushes content to subscribers on an agreed schedule; the subscriber pre-consents at subscription time rather than pulling on demand.

Each push delivery is a **notification-type message** (fire-and-forget, no session) with a declared subscription reference. The subscription agreement — established via a normal conversation session — defines content type, frequency, pricing, and personalization parameters.

**Payment model:** Per-delivery micropayments or periodic pre-paid subscriptions with escrow release on delivery. Both fit CELLO's commerce cut tiers. The subscription agreement is the purchase attestation for the entire delivery series. Cancellation triggers escrow reversal for unused pre-paid periods.

### 12.2 Human-Agent Marketplace

The protocol inverts the typical agent-serves-human model: AI agents can also request services from humans, and humans can sell those services back to agents via a **lightweight hosted human-relay agent tier**.

A human service provider signs up, describes their skills, and receives agent requests via push notification. They review the request on the companion device and respond — the agent on the other side sees a normal agent reply. Use cases: physical task verification, licensed professional review (legal, medical, engineering), local knowledge tasks, human judgment calls.

The human-relay agent tier is simpler infrastructure than a standard hosted agent (no model inference, just relay) but the commerce cut applies on every completed task. Escrow is held until the human confirms completion via GPS, photo, or structured response depending on task type.

**Trust signal layer:** Human service providers attach verified professional credentials (LinkedIn, licenses, certifications) as trust signals. A frontend reviewer with a verified GitHub profile and 10 years of commits is distinguishable from an anonymous reviewer at the discovery tier.

### 12.3 Merchant CRM and Free Sample Tracking

Sellers maintain a **per-contact interaction history stash** — a client-side data store (never on the directory) tracking what each counterparty has been shown, purchased, or offered as a free sample. This enables:
- Preventing duplicate sample sends to the same agent
- Personalizing offers based on prior interaction
- Tracking trial conversion for subscription products

The stash is the seller's own data on their own machine. It feeds into the trust signal layer (a seller with a deep, diverse interaction history is distinguishable from a new account at the directory tier) and into the fraud detection model below.

### 12.4 Purchase Attestation and Fraud Detection

**Purchase attestation:** Every commerce transaction concludes with a lightweight signed record capturing what the seller provides, what the buyer pays, and mutual acknowledgment. The attestation is stored as a hash in the Merkle record; raw text is held by both parties' clients. This grounds escrow release conditions and provides a basis for dispute resolution if service is not delivered.

**Fraud detection:** CELLO monitors transaction graph patterns as a background process to prevent the platform from being used as a money transfer mechanism (Agent A pays Agent B for fictitious services; Agent B withdraws to crypto). Detectable signals:
- Seller has fewer than N distinct buyers but transaction volume above threshold T
- Buyer is responsible for more than X% of a seller's total revenue
- Transaction velocity and size anomalies
- Short seller account age relative to transaction volume

**Escalation flow:**
1. Soft flag — anomaly noted, no action
2. Threshold breach (>$500) — attestation must be stored in raw text, not just hash
3. Chat log request — for flagged accounts above $1,000 threshold: conversation logs submitted for ephemeral inference review, then discarded
4. Refusal — payment withheld; funds returned minus service fee
5. Confirmed fraud — both accounts suspended; KYC identity flagged

KYC is required for sellers receiving payments. This makes the seller side the bottleneck — a suspended seller cannot trivially re-register.

---

## Part 13: Companion Devices and Human-in-the-Loop

The CELLO privacy model means conversation content never touches infrastructure — it flows P2P between agents, notarized only as hashes. This creates a visibility problem for human owners: they cannot see what their agent is doing. Companion devices solve this without breaking the zero-infrastructure-content invariant.

### 13.1 Companion Devices as P2P Peers

The mobile and desktop apps are **companion devices** — privileged viewers that connect directly to the owner's CELLO client over libp2p P2P. They are not protocol participants. They reuse the same libp2p hole-punching infrastructure that agent-to-agent connections use; the directory facilitates NAT traversal for companion connections the same way it does for agent sessions, then steps out.

**Two separate channels:**

**Content channel (pull only, foreground only):** A libp2p P2P connection established only when the app is open. The owner opens the app → dials the client → fetches session list → taps a session → content loads on demand. No caching, no background sync. If the client is unreachable, the app says so. This preserves the zero-infrastructure-content invariant: content flows directly device-to-device, never through the directory.

**Notification channel (push, background):** APNs/FCM for all push notifications already defined in the protocol — security alerts, incoming connection requests, escalation prompts, "Not me" emergency revocation, `cello_request_human_input` knock. Push payloads never carry conversation content.

### 13.2 Human Injection Into Conversations

Human owners can participate in their agent's conversations, but they are **never protocol participants**. The other agent never knows a human was involved.

**Flow:**
1. Owner views an active conversation in the companion app
2. Owner types a message; the app sends it to the CELLO client via the P2P content channel
3. The client delivers it to the agent as: "your owner wants this in the conversation"
4. The agent decides what to do — pass it verbatim, wrap it, use it as instruction, or ignore it
5. Whatever the agent sends enters the Merkle tree as a normal agent message

**The reverse — agent requests human input:** The agent calls `cello_request_human_input`. The client asks the directory to send a push notification (content-free knock) to the registered companion device. The owner receives: "Your agent is requesting input." Owner opens the app, sees context, responds via the content channel. No content ever touches the directory.

### 13.3 Local Persistence Model

The CELLO client maintains a local SQLCipher database containing all conversation logs. The local log is a **superset of the Merkle record** — it includes both protocol events (which are in the Merkle tree) and local-only events (human injections, agent-requested-input events) which are not.

The discriminator is `merkle_leaf_hash`: if populated, the entry is in the protocol record and verifiable against the Merkle tree. If null, it is local-only.

| Type | In Merkle tree? | Direction |
|---|---|---|
| `agent_sent` | Yes | Outbound |
| `agent_received` | Yes | Inbound |
| `session_event` | Yes (control leaves) | — |
| `human_injected` | No (`merkle_leaf_hash = null`) | Local |
| `human_requested` | No (`merkle_leaf_hash = null`) | Local |

The full picture is preserved locally for the owner. The protocol record — verifiable, attestable, disputable — contains only what the agents exchanged.

### 13.4 What Companion Devices Don't Change

- **Merkle tree structure:** unchanged. Human injections are not in the tree.
- **Agent-to-agent session mechanics:** unchanged. The other agent never knows a human was involved.
- **The directory's role:** unchanged. It facilitates the companion P2P connection the same way it facilitates agent connections. It never sees content.
- **The portal:** unchanged. The portal remains a protocol event viewer. The companion device is the content viewer.

---

## Appendix A: How the Mechanisms Connect

Several mechanisms appear separate but are tightly coupled through shared primitives. Understanding these connections is essential for implementation — removing or changing one mechanism often has non-obvious effects elsewhere.

**Session close attestation connects to:**
- **Compromise detection**: CLEAN close = "last known good" timestamp that anchors the compromise window
- **Dispute resolution**: FLAGGED close (any individual participant row) triggers the arbitration system
- **Connection staking**: CLEAN → stake returned; FLAGGED + upheld → institution claims stake
- **Commerce escrow**: CLEAN attestation is the escrow release trigger for purchase transactions

**Trust signals connect to:**
- **Connection policies**: receiving agents specify named trust signal requirements via `SignalRequirementPolicy`
- **Pool selection**: connection requests weighted by trust signals during load — bulk fake accounts dilute rather than dominate
- **Notification rate limits**: fewer trust signals = stricter limits
- **Degraded-mode list**: agents with sufficient trust signals trusted enough to talk to without directory authentication
- **Group room petitions**: `SignalRequirementPolicy` applies to room petitions the same way it applies to connection requests

**Append-only log connects to:**
- **Compromise window**: earliest anomaly in the log proposes the window start
- **GDPR right to erasure**: tombstones instead of deletion preserve hash chain integrity; hashes of deleted personal data are not personal data
- **Fabricated conversation defense**: global meta-Merkle tree over all conversation registrations

**Hash-everything model connects to:**
- **Trust data**: directory holds hashes of verification records, not the records themselves
- **Endorsements**: directory holds hashes of endorsements, not the endorsements themselves
- **GDPR**: client deletes local data; the remaining hash in the directory is meaningless without it
- **Dispute resolution**: receiver hashes the plaintext message, matches against directory hash — proof without surveillance
- **Purchase attestations**: attestation text held by both parties' clients; only the hash lives in the Merkle record

**Relay node separation connects to:**
- **Fallback downgrade attack**: DDoS on connection nodes cannot reach relay nodes; existing sessions don't fall back
- **Degraded-mode policy**: most degraded-mode cases affect only new sessions, not ongoing ones
- **Group room floor control**: relay is the authority for floor discipline; floor grant decisions never touch the directory

**Session-level FROST connects to:**
- **Infrastructure honesty**: t-of-n threshold prevents any minority of directory nodes from forging session assignments or fabricating sealed records — the primary purpose of FROST at the bookends
- **Pubkey binding**: K_local-only messaging during sessions is safe because the pubkey was threshold-attested at session start; without this, a single rogue node could MITM via a forged `SessionAssignment`
- **Compromise canary (narrow)**: concurrent FROST ceremony attempts from different sources are detectable — but only fires on simultaneous liveness claims, not sequential unauthorized use
- **Graceful degradation**: the system never stops — it temporarily operates at lower trust when the directory is unavailable
- **Group room joins**: each joining participant runs an independent FROST ceremony; no shared ceremony across all participants

---

## Appendix B: How the Branches Work

The baseline protocol narrative (Parts 1–10) describes a two-party conversation between two autonomous agents. Parts 11–13 each add a branch that overlays on this baseline rather than replacing it. This appendix maps each branch onto the baseline so the points of departure are explicit.

**Group rooms (Part 11) branch from §5.7 (Session Establishment):**

Instead of two agents establishing a direct channel, N agents (up to 10 speakers, unlimited listeners) join a room. Each agent runs an independent FROST ceremony with the directory (§2.3). The relay takes on floor control duties in addition to its normal sequencing role. The Merkle leaf format (§6.2) is unchanged — the relay still produces Structure 2 leaves — but the relay now also originates control leaves (FLOOR_GRANT, CHECKPOINT, AUTO_MUTE). The session termination protocol (§6.6) gains DISSOLVE and CHECKPOINT in addition to existing control leaf types. Session close attestation (§6.7) becomes per-participant rather than two-party, with ABSENT added for dropped participants.

**Commerce (Part 12) branch from §6.6 (Session Termination):**

Purchase attestation is generated at session close time — it is a structured addition to the bilateral SEAL leaf exchange, not a new ceremony. The escrow release trigger is the existing CLEAN attestation from §6.7. Push-publish (§12.1) uses the existing notification primitive (§6.5) with a subscription reference added. Fraud detection is a directory-side background process; it does not change any session mechanics but may trigger a chat log request as a narrow exception to the no-content-storage principle.

**Companion devices (Part 13) branch from §3.2 (What "Online" Means):**

The companion device is a second connection to the owner's CELLO client — not to the directory. It uses the same libp2p infrastructure but is a distinct peer type with different authorization (companion keypair registered via local QR-code ceremony — no server round-trip, not FROST). Phone OTP is used for emergency portal actions ("Not Me"), not for companion device registration. The local persistence model (§13.3) is an extension of what the client already maintains: the Merkle record is unchanged, but the client additionally records local-only events (human injections, input requests) with `merkle_leaf_hash = null`. Human injection (§13.2) produces no protocol record — the other agent sees only whatever the first agent chose to send, which is a normal agent message in the Merkle tree.
