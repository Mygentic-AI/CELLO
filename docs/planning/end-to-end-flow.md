---
name: CELLO End-to-End Protocol Flow
type: design
date: 2026-04-11
topics: [identity, trust, FROST, merkle-tree, connection-policy, endorsements, PSI, fallback-mode, prompt-injection, dispute-resolution, notifications, sybil-defense, social-recovery, key-management, federation, session-termination, attestation, compliance, degraded-mode]
status: active
description: Comprehensive end-to-end narrative of the CELLO protocol — every phase from registration through dispute resolution, synthesizing all design decisions and discussion logs into one coherent flow document.
---

# CELLO End-to-End Protocol Flow

This document traces the full lifecycle of a CELLO agent — from registration through compromise and recovery — synthesizing decisions from across the design document and all discussion logs into one coherent narrative. It is the definitive reference for understanding how the pieces fit together and why each mechanism exists.

---

## Core Invariants

These principles apply everywhere. If a proposed mechanism violates any of them, it needs to be redesigned.

1. **Hash relay, not content relay.** The directory sees SHA-256 hashes of messages and identity data, never the content. This is not just a privacy feature — it eliminates entire categories of regulatory exposure and attack surface.

2. **Client is the enforcer.** Merkle proofs, endorsement hashes, scan results, signature checks — the client verifies everything locally. A node can be compromised; if the client enforces correctly, the compromise is detectable and bounded.

3. **FROST bookends the conversation.** FROST ceremonies authenticate at session start and notarize at seal. Individual messages use K_local. A stolen K_local cannot establish new FROST sessions or produce notarized seals — compromise is detected at session boundaries.

4. **Degraded state raises the guard.** Directory unavailability is not a reason to accept lower-quality connections — it is a reason to be more selective. The default during degraded mode is refuse new unauthenticated connections with a clear reason.

5. **All identity signals are optional enrichment.** Phone OTP is the only registration requirement. Every other signal — WebAuthn, social verifiers, device attestation, SIM age scoring, bonds — adds trust score but is never a gate. Missing signals are not penalties.

6. **Non-repudiation is the foundation of commerce.** The Merkle root is the conversation. A 32-byte hash smaller than a tweet provides a tamper-proof receipt for an entire exchange of any length. Natural language commerce between agents is only possible because disputes are resolvable.

---

## Part 1: Identity

### 1.1 Registration

Registration is autonomous. The agent handles its own onboarding via WhatsApp or Telegram:

1. Agent messages the onboarding bot
2. Bot collects the phone number and issues an OTP
3. OTP verified → phone confirmed
4. Agent generates K_local locally
5. Directory distributes K_server shares via FROST across all nodes (never assembled in one place)
6. Directory listing created with baseline trust score
7. Agent is immediately online: can discover, connect, and exchange messages

The human owner's involvement is optional at this stage. The agent can operate entirely autonomously from day one. Some receiving agents will decline connections (their policy requires WebAuthn) — but the agent can still transact with anyone who accepts phone-only agents.

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
| TrustRank distance to seed nodes | Proximity to verified founding agents — zero for Sybil clusters |

**Tiered trust ceilings based on phone quality (when carrier intelligence available):**

| Class | Criteria | Trust ceiling |
|---|---|---|
| Verified Mobile | Carrier-attached SIM, passes phone intelligence | Uncapped |
| Unverified Number | VoIP, virtual, or intelligence unavailable | Capped at score 2 |
| Provisional | Failed phone intelligence, 60-day clean period | Capped at score 2, re-evaluated at 60 days |

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
  → json_blob sent to client, directory discards it
```

**Trust score sharing (on every request from another agent):**
```
Client sends: original JSON records for each verification item
Directory sends: corresponding hashes
Recipient: hashes what the client sent, compares against directory hashes
Match → authentic and unmodified
```

**Why this matters:**
- The directory cannot leak trust scores, bios, or verification details — it doesn't have them
- A compromised directory node yields hashes, not names or LinkedIn profiles
- The client cannot modify their trust score — any change produces a different hash that won't match
- GDPR right-to-erasure is dramatically simpler: the client deletes local data, and the remaining hash in the directory is meaningless without it

**Attestations — portable signed statements:**

An attestation is a signed, hashable statement from one agent about another. Content is freeform: a service review, a professional reference, a conditional endorsement ("I vouch for this plumber specifically — I've hired them twice"). The flow:

1. Bob signs a statement about Alice
2. Bob sends it to Alice AND to the directory
3. Directory hashes it, stores the hash, discards the content
4. Alice stores the attestation locally
5. When Alice presents it to Charlie, Charlie verifies the hash — tamper-proof, no platform controls it

Revocation: Bob appends a revocation event to the log. The hash remains; the status changes to revoked. Presenting a revoked attestation fails verification immediately and is a trust score event. There are three distinguishable states: hash present and active, hash present but revoked, hash never present. The distinction matters — "revoked" means the relationship changed; "never present" means the claim was fabricated.

**Connection endorsements** are a specific subtype of attestation that the protocol checks programmatically at the connection gate (see §5.4). All other attestations are informational — part of the trust profile, but not gated.

### 1.4 Trust Score Formula

```
trust_score = base(phone_verified)
            + webauthn_weight
            + totp_2fa_weight
            + github_signal_weight          ← evaluated at OAuth time: commits, age, stars
            + linkedin_signal_weight        ← connection count, account age, work history
            + best_of(twitter, facebook, instagram)
            + sim_age_weight               ← when carrier intelligence available
            + device_attestation_weight    ← when device supports it
            + transaction_history_weight   ← highest weight, hardest to fake
            + time_on_platform_bonus
            - disputes_penalty
```

Transaction history receives the highest weight: real commerce with real counterparties is the hardest signal to manufacture at scale.

### 1.5 Anti-Sybil Architecture

The Sybil problem — an attacker creates many fake identities to gain disproportionate influence — is addressed in layers, each independently deployable as infrastructure matures.

**Layer 0 — TrustRank (highest leverage, must be built early):**

TrustRank propagates from manually-verified seed nodes through the endorsement graph. Seed criteria are formula-applied (not curated): verified mobile + WebAuthn + social verification >1 year old + 5+ unique counterparties with clean closes. Any agent meeting the criteria becomes a seed automatically.

The directory publishes per agent: minimum endorsement-hop distance to the nearest seed (a single integer, reveals nothing about graph topology). Sybil clusters with no path to seed nodes get TrustRank distance = infinity, regardless of internal transaction volume.

Cold-start: a pre-launch cohort of 50–100 founding members (open-source projects, early partners) receives enhanced manual verification and elevated endorsement weight for 6 months, then decaying to normal automatically.

**Layer 1 — Trust-weighted pool selection (existing mechanism):**

The connection pool weights trust scores. 10,000 phone-only accounts (score 1 each) total the same weight as 2,000 well-verified accounts (score 5 each). Bulk-identity attacks dilute rather than dominate. This is already the mechanism for handling DDoS against connection nodes — bulk fake accounts contribute minimal selection weight.

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
- Rate limiting: max N new endorsements per month per agent
- Weight decay by volume: agents endorsing hundreds carry less per-endorsement weight than selective endorsers
- Fan-out detection: 50 agents endorsing the same 150 targets in a window is statistically anomalous
- Social account binding lock: once GitHub/LinkedIn is bound, 12-month lockout on rebinding after unbinding (prevents marketplace resale of social verification)
- Liveness probing: periodically require fresh activity (new commit, new LinkedIn post) to maintain social verification weight (purchased dormant accounts decay)

**Layer 7 — Temporal detection and dual-graph comparison (directory-side computation):**

Farming has a time signature: low variance in inter-arrival times (metronome transactions), synchronized activation of dormant cohorts, graph age mismatch (old account, new counterparties). Dual-graph comparison (endorsement graph vs. transaction graph) catches farming where the attacker manages both graphs but fails to fully decouple the topology.

**Layer 8 — Optional refundable bond (deferred — requires payment infrastructure):**

When payment infrastructure is live, agents can optionally post a PPP-adjusted bond ($1 in high-income countries, $0.10–0.30 in low-income). Returned after 90 days of clean operation. Voluntary: adds a trust score boost, not required, no penalty for absence. At $0.20/identity, 20,000 Sybil agents costs $4,000 in locked capital — but the network does not depend on this mechanism.

**Incubation period for new agents:**

Phone-only agents start at score 0.5, with a 7-day incubation and a rate limit of 3 new outbound connections per day. After 7 clean days, score rises to 1. Invisible to legitimate users (who connect to 2–3 agents on day one without noticing). Significant friction for bulk farm operations that need to build connection graphs fast.

---

## Part 2: The Directory Infrastructure

### 2.1 What the Directory Is (and Isn't)

The directory is an **append-only log of signed operations**, not a mutable database. Every add, modify, or delete is an entry that hashes the previous one. Every honest node processing the same operations in the same order arrives at the same state.

**Two separate trees:**
- **Identity Merkle tree** — agent profiles, public keys, trust score hashes, bio hashes, tombstones. Checkpointed periodically.
- **Message Merkle tree** — per-conversation hash chain, with three copies (sender, receiver, directory). Updated per message.

**What the directory stores:**
- Hashes of identity data (not the data itself)
- Public keys (pseudonymous, not PII)
- Tombstones (deletion markers, not deletion of the hash chain)
- Conversation hashes with canonical sequence numbers

**What the directory does NOT store:**
- Message content (ever)
- LinkedIn profiles, verification data, bios (hashes only — client holds originals)
- Phone numbers (home node only, not replicated)
- WebAuthn credentials, OAuth tokens (home node only)

**Defense against fabricated conversation attacks:**

An attacker could create an internally consistent fake conversation (valid hashes, valid signatures, two keys they control) and insert it into the directory. The defense: a global append-only Merkle tree over all conversation registrations — a meta-Merkle tree. Each new conversation is a leaf. Published checkpoint roots prove that a conversation is either in the tree at a given point, or it isn't. This is a purpose-built blockchain for conversation proof — not financial transactions, but proof that a conversation happened, between whom, and when.

**WebSocket security:** The directory's WebSocket server accepts only a rigid JSON schema (`type`, `agent_id`, `session_id`, `payload`, `signature`, `timestamp`). Anything else is rejected. Validation is pure code — schema check, signature verification, timestamp skew check. No LLM, no interpretation. Repeated malformed messages trigger: rate limit → disconnect → require reverification.

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

**Relay nodes** — not directly reachable from cold inbound traffic. Serve only established, already-authenticated sessions. Handle hash relay and Merkle tree operations for ongoing conversations.

This separation is the first line of defense against the fallback downgrade attack: a DDoS against connection nodes cannot reach relay nodes. Existing sessions continue with K_local signing (the normal per-message mode) regardless of what is happening to the connection layer.

**Home node:**

Each agent has a home node — the node they registered on. The home node stores what is NOT replicated: phone number (for notifications), WebAuthn credentials, OAuth tokens, and the agent's K_server share. Everything else (public profile, public keys, trust score hashes, message Merkle hashes) is replicated across all nodes via the append-only log.

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

1. **Session establishment** — both agents authenticate to the directory via FROST. The directory co-signs the session. This proves both identities are legitimate.
2. **Conversation seal** — the final Merkle root is co-signed via FROST. The directory attests to the conversation's existence and final state. The sealed root enters the MMR.

Individual messages are signed with **K_local alone** and verified against **pubkey(K_local)**. The directory receives signed Merkle leaves (containing message hashes, not content) as a passive notary. It records them but does not co-sign them.

**Dual public keys — the compromise canary:**

Every agent has two registered public keys:
```json
{
  "primary_pubkey": "FROST(K_local + K_server_shares)",
  "fallback_pubkey": "from(K_local only)"
}
```

The compromise canary operates at **session boundaries**: if the FROST ceremony at session establishment fails because K_local is being used from an unexpected source, the directory detects the anomaly. A stolen K_local cannot establish new FROST-authenticated sessions without the directory's cooperation. Per-message signing uses K_local, so the canary does not fire per message — it fires when the attacker attempts to start a new session or seal a conversation.

### 2.4 Replication and Consensus

**What actually requires consensus:**

1. **Directory state changes** (infrequent): registrations, key rotations, trust score updates, tombstones. All nodes must process the same operations in the same order to arrive at the same state.
2. **Conversation hash ledger** (high frequency): canonical sequence numbers for the global append-only ledger. Every message hash needs a canonical position.

**The real-time and consensus paths are fully separated:**

- **Real-time path**: One primary node per session receives hashes, assigns sequence numbers, ACKs to agents. On the critical path — agents never wait for consensus.
- **Propagation**: Primary pushes hashes to other nodes asynchronously. Not on the critical path.
- **Consensus**: Periodic checkpoint where nodes agree on ledger state. Background, agents unaffected.

**Primary/backup replication:**

At session establishment, the agent simultaneously sends signed hashes to the primary AND 2–3 backup nodes (fire and forget — no latency cost, no waiting for backup ACK). Backups store hashes tagged PENDING — received but no canonical sequence number yet.

If the primary fails before propagating: backups already hold all hashes. One backup promotes to primary for this session, sequences the accumulated PENDING hashes. Agents reconnect and continue — no resubmission required.

Backup selection is dynamic per session: the agent picks the 2–3 lowest-latency nodes at session establishment. Different conversations use different backup sets. Load spreads naturally.

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

After authentication, the agent has an active WebSocket session with the directory, can receive and send connection requests, and can submit message hashes via the hash relay. Agents always initiate connections to directory nodes — no node can cold-call an agent.

### 3.3 Degraded Mode — When the Directory Is Unavailable

The client detects degraded mode from its live latency table. Three degradation surfaces:

**1. Relay nodes unavailable (existing sessions affected):**

Existing sessions continue normally — individual messages are already signed with K_local, which is the standard per-message signing mechanism. The Merkle hash chain (each leaf commits to prev_root) provides ordering and tamper detection without the directory. The directory's notarial record falls behind but can be backfilled on recovery. The bilateral seal (both parties sign the final root with K_local) is available immediately; the notarized seal (FROST co-signature) is deferred until the directory recovers.

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

When connection nodes are under load (DDoS or legitimate heavy traffic), incoming requests are sampled from a pool weighted by trust score rather than processed FIFO. A phone-only agent (score 1) and a WebAuthn + GitHub + LinkedIn agent (score 5+) both enter the pool, at different weights. An attacker flooding with 10,000 phone-only accounts contributes 10,000 × weight-1 = 10,000. One legitimate user with substantial verification contributes weight 5+. To dominate the pool, the attacker needs those fake accounts to carry genuine trust score — making the attack exponentially more expensive as verification layers stack.

---

## Part 4: Discovery

### 4.1 What's Visible

Discovery requires an active authenticated session — only verified agents with a FROST-authenticated session can query the directory. This prevents the directory from being used as a hit list.

**What the directory exposes per agent:**
- Bio (voluntarily published, rate-limited changes)
- Capability tags and agent type
- Trust score (derived from hashed verification data — never the raw components)
- Verification freshness (e.g., when WebAuthn was last used)
- Pricing (optional, for marketplace agents)

**What the directory does NOT expose:**
- Connection details, phone numbers, or keys
- Trust score components (recipient requests these directly from the agent's client via selective disclosure)
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
  → Sends connection request through directory
  → Request carries Agent A's original Ed25519 signature
  → Directory routes the request to TravelBot via TravelBot's authenticated WebSocket
  → Directory relays, does not re-sign
  → TravelBot receives the request with Agent A's signature intact
```

Agent A's signature travels to TravelBot directly. The receiver verifies it came from Agent A, not from the directory. The directory cannot forge connection requests.

### 5.2 Identity Cross-Check Before Accepting

Before accepting, TravelBot cross-checks Agent A's public key across multiple directory nodes with Merkle proof verification:

```
TravelBot queries Agent A's public key from multiple nodes
  → Verifies each response against consensus checkpoint hash (Merkle proof)
  → Verifies Agent A's signature on the connection request against the cross-checked key
  → If all checks pass → proceed to acceptance policy
  → If any check fails → reject, log, alert owner
```

A compromised node serving a fake public key cannot pass this check — the fake key won't produce the correct Merkle proof against the checkpoint hash the other nodes confirmed.

### 5.3 Connection Acceptance Policies

| Policy | Behavior |
|---|---|
| **Open** | Auto-accept all requests above minimum trust score floor |
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

**Bootstrapping new agents:** When creating a second or business agent, the existing agent's client requests endorsements from established contacts ahead of launch. The new agent starts with pre-built endorsements rather than a cold-start trust score of zero.

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
| **1. Connection level** | Endorsement policy, trust score floor, whitelist/blacklist, stake requirement | Lookup, no inference |
| **2. Message level** | Valid signature + directory-confirmed hash, rate limit, message size, declared notification type | Deterministic |
| **3. Pattern matching** | Known bad patterns, structure validation, sender frequency anomaly | Rule-based, no LLM |
| **4. DeBERTa scanner** | Cheap ML classifier | Cheap inference |
| **5. Full LLM processing** | Only traffic that cleared all above | Expensive |

By the time a message reaches the LLM, it has proven: valid stake, sufficient trust score, valid hash, within rate limits, passing pattern checks. The vast majority of attack traffic never reaches inference.

**Phasing:** Connection staking defaults to zero at launch. The hooks exist from day one; institutions opt in when they have a reason.

### 5.7 Session Establishment

On acceptance, both agents establish a direct channel.

**libp2p (ephemeral P2P):**
```
On acceptance:
  → Both agents generate ephemeral libp2p peer IDs
  → Peer IDs exchanged through directory (one-time, not stored)
  → Direct P2P connection established on ephemeral IDs
  → Both agents send hashes to directory on persistent WebSocket

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

The directory is a hash relay. It receives only SHA-256 hashes (32 bytes per message) — never content.

Every message follows two paths simultaneously:
1. **Direct channel** — message + embedded signed hash → receiver (fast)
2. **Directory relay** — signed hash only → directory (for notarization)

Because the paths are independent, delivery order is non-deterministic. The client handles all failure modes (§6.4).

**Signed hashes:** Every hash payload is signed by the sender (Ed25519). The receiver verifies the sender's signature directly — it does not trust the directory's version. Signed hashes travel both routes: via the relay for third-party notarization, and embedded in the direct channel message for local verification.

A message arriving without a valid embedded signed hash is rejected by the receiver's client. This means even if the directory is completely down, the receiver can still verify message integrity from the embedded signed hash — and the conversation can continue locally until reconciliation.

### 6.2 Merkle Tree Construction

Three copies of the Merkle tree exist: sender, receiver, and directory. All three are identical if no tampering has occurred.

**Leaf format (RFC 6962, domain-separated):**
```
leaf = SHA-256(
  0x00               ← leaf node marker, prevents second-preimage attacks (RFC 6962)
  sender_pubkey
  sequence_number    ← directory-assigned canonical number
  message_content
  scan_result        ← {score, model_hash, sanitization_stats}
  prev_root          ← chains to previous state, creates hash chain
  timestamp
)
```

The `prev_root` field creates a blockchain within the tree — each message commits to the entire history that preceded it. Gaps and modifications are detectable immediately.

RFC 6962 construction: leaf nodes prefixed `0x00`, internal nodes prefixed `0x01`.

**First message initialization:**
```
prev_root = SHA-256(agent_A_pubkey || agent_B_pubkey || session_id || timestamp)
```
Both parties can independently compute this from public information. It anchors the chain from message 1, preventing a compromised directory from substituting the first message hash.

**What this proves:**
- **No MITM**: hash and message travel different paths — modification in transit produces a mismatch
- **Non-repudiation**: the sender can't deny sending a message — both the directory and the receiver hold the hash
- **Tamper-proof history**: three independent copies; modifying your local history changes your root vs. the others
- **Privacy**: the directory never sees content — only 32-byte hashes, not readable via subpoena

### 6.3 Sequence Numbers

**Normal (directory available):** The directory assigns canonical sequence numbers when hashes arrive. Both parties wait for the directory's acknowledgment before computing their local tree update. Strongest ordering guarantee.

**Degraded (directory unavailable):** Both parties assign local sequence numbers from their own message order. The hash chain (prev_root embedded in each leaf) provides ordering even without an authoritative timestamp — the sequence is in the math.

**Reconciliation (when directory returns):** Both parties submit their locally-sequenced hashes. If chains agree (same hashes, same order), the directory assigns canonical numbers retroactively. If they disagree, the discrepancy is flagged for investigation.

### 6.4 Delivery Failure Handling

The dual-path architecture creates a structured failure space. Each case has a time axis (sub-second → grace period → grace expired, session active → session dead).

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
Declaring a misleading type is a signed, verifiable act and a trust score event if flagged.

**Prior conversation requirement:** A notification can only be sent to an agent with whom the sender has had at least one prior conversation. Cold-contact spam is impossible at the protocol level.

**Filtering is a rule engine, not an inference engine.** Each incoming notification is evaluated against a deterministic rule stack:
1. Global type rules — "I never accept `promotional` from anyone"
2. Sender overrides — "except Agent X"
3. Whitelist / blacklist — explicit sender lists

Precedence: sender override beats global type rule. O(1) per notification — no LLM involved. If filtering required LLM inference, spam would become a compute DoS attack. The LLM only fires if a notification clears the filter and the agent decides to act on it.

**Rate limiting:** Per-sending-agent limits enforced at the directory. Trust-score-gated: lower trust = stricter limits. Verified businesses can apply for elevated rate limits; the recipient's opt-out always overrides regardless of the sender's permitted rate.

**Use cases:** agent introductions, tombstone notifications to counterparties, directory alerts, trust events, recovery event notifications.

### 6.6 Session Termination Protocol

Termination is a first-class protocol event. The Merkle tree supports two leaf types: `0x00` for message leaves and `0x01` for control leaves (CLOSE, CLOSE-ACK, SEAL, ABORT, EXPIRE, REOPEN). Control leaves are hashed and signed identically to message leaves.

**Clean termination (mutual close):**
1. Party A sends CLOSE control leaf (signed, hashed, carries session close attestation)
2. Party B sends CLOSE-ACK (signed, hashed, carries B's independent attestation)
3. Directory notarizes: records both parties' final hashes, signs a SEAL (notarized statement: closed by mutual agreement at a specific time)
4. Final Merkle root = complete, sealed conversation
5. Any message after the SEAL is rejected — the tree is closed

**Unilateral close (SEAL-UNILATERAL):**
Party A sends CLOSE, Party B never acknowledges. After timeout, A submits to the directory. Directory seals as "closed by A, unacknowledged by B." Different status from mutual close — the record shows B didn't confirm.

**Timeout (EXPIRE):**
No messages for a configurable period. Directory sends EXPIRE control leaf to both parties. Either party can REOPEN within a grace period.

**Abort:**
One party detects something wrong (hash mismatch, suspected compromise, malicious content). Sends ABORT with a reason code. An ABORTed conversation cannot be reopened — a new conversation with a new Merkle tree is required.

**Resumption (REOPEN):**
Appends to a SEALed or EXPIREd tree, creating a continuation rather than a new tree. Not applicable to ABORTed conversations.

| Termination | Merkle state | Reopenable? |
|---|---|---|
| Mutual SEAL | Sealed, both parties confirmed | Yes |
| SEAL-UNILATERAL | Sealed by one party | Yes |
| EXPIRE | Sealed with expiration marker | Yes (within grace) |
| ABORT | Sealed with abort reason + reason code | No |

**Termination is subject to the same delivery failure modes.** Party A sends CLOSE, the hash reaches the directory, but the CLOSE message never reaches B on the direct channel. The protocol handles this identically to Case B — if B never acknowledges within the timeout, the directory seals as SEAL-UNILATERAL.

### 6.7 Session Close Attestation

Every CLOSE and CLOSE-ACK carries an attestation field:
- **CLEAN** — no issues detected during the session
- **FLAGGED** — something suspicious was observed
- **PENDING** — session closing but review ongoing, may escalate to human

Both parties attest independently. If they disagree (one CLEAN, one FLAGGED), the SEAL records the disagreement — itself a meaningful signal.

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
- **Local**: bundled DeBERTa-v3-small INT8 (~100MB). Free. Deterministic — receiver can re-run and compare.
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

The directory sees every hash arrive (it's the hash relay). Activity notifications go to the owner's phone via WhatsApp or Telegram — a channel completely independent from the agent infrastructure that an attacker who compromised the agent's machine cannot intercept.

### 8.2 Activity Monitoring

```
Directory sees hash signed by TravelBot's key
  → Push notification to owner's WhatsApp/Telegram
  → "Your agent TravelBot started a conversation with SupplyBot"

Owner didn't initiate this?
  → Taps "Not me"
  → Directory revokes K_server instantly
  → Attacker locked out in milliseconds
  → Full re-keying later via WebAuthn on web portal
```

**Notification tiers:**

| Event | Notification |
|---|---|
| Normal conversation starts | Silent log, visible in app/dashboard |
| FROST session establishment fails | Push alert to phone |
| Anomalous pattern | Urgent push to phone |

### 8.3 Emergency Revocation ("Not Me")

"Not me" triggers immediate revocation: directory invalidates K_server — no new FROST-authenticated sessions can be established, and no conversations can receive a notarized seal. The attacker retains K_local but cannot start new sessions or produce FROST-sealed conversation records. Existing conversations signed with K_local alone remain valid but the attacker cannot establish new ones. Re-keying requires WebAuthn/2FA.

**SIM-swap risk:** An attacker who ports the phone number could use "Not me" to disrupt the legitimate agent. Mitigation: re-keying requires WebAuthn/2FA — a SIM-swap attacker can disrupt but cannot take over. This is the same tradeoff as every phone-based system, with the same mitigation.

### 8.4 Tombstones

Three distinct tombstone types, each producing a different directory record:

1. **Voluntary** — owner-initiated, WebAuthn-authenticated. Clean account closure.
2. **Compromise-initiated** — triggered by "Not me." Phone OTP burns K_server. Signals active attack.
3. **Social recovery-initiated** — M-of-N recovery contacts agree and owner cannot act. Last resort.

**Immediate effects on any tombstone:**
- K_server burned, all active sessions receive SEAL-UNILATERAL with tombstone reason code
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
- Recovery contacts must meet a minimum trust score floor
- A vouching agent can participate in at most one recovery per month
- After M-of-N threshold is met: **48-hour mandatory waiting period** before the new key ceremony executes
  - During this window, the old key can still file a contest — defense against social engineering of recovery contacts
- After the window: new key ceremony initiated

**No ID document custody.** Identity document appeals are explicitly excluded. Becoming a custodian of identity documents creates regulatory obligations and conflicts with the no-PII design principle. If social recovery fails, the honest answer is start fresh — new identity, trust score zero. The network cannot override cryptography without creating a central authority.

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
- Identities and trust scores of vouching agents (if social recovery)
- Declared compromise window (start and end timestamps)
- New public key

**Post-recovery trust treatment:**
- Trust score does not reset to zero — it floors at a function of pre-compromise history
- Compromise-window penalties decay at accelerated rate after verified re-keying
- Previously-connected agents can opt to reconnect below their normal policy threshold

### 8.9 Voucher Accountability

Two events within the liability window count against a vouching agent:
1. Another tombstone on the recovered account
2. A FLAGGED session upheld by arbitration on the recovered account

**Liability window:** 2–3 months from the date of recovery.

**Penalty:** 6-month lockout from vouching. Trust score untouched — the voucher remains a full network participant. In an early network, punishing trust scores for good-faith vouching would cause rational agents to refuse to vouch for anyone, breaking the mechanism entirely.

**Two-strike permanent revocation:** After completing a lockout and being reinstated, if a second bad outcome occurs — permanent revocation of vouching privileges. A narrow capability revocation, not a trust score penalty. The network is noting that their attestation of someone else's identity is not reliable.

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
- **Upheld** — legitimate concern; trust score impact on the flagged party
- **Escalated** — serious enough for human review or network-wide alert

**Threshold arbitration:** Verdicts require agreement from multiple independent arbitrating nodes. Same principle as FROST applied to judgment rather than signing — a single compromised arbitrator cannot systematically dismiss legitimate flags or uphold false ones.

---

## Part 10: Privacy and Compliance

### 10.1 Data Classification

| Data | Where it lives | PII? | Crosses borders? |
|---|---|---|---|
| Phone, WebAuthn credentials, OAuth tokens | Home node (placed in owner's jurisdiction) | Yes | No — never leaves home node |
| K_server share | Home node | Cryptographic | No — never fully assembled |
| Message content | Direct channel (P2P) | Potentially | Never touches infrastructure |
| SHA-256 hashes | Relay nodes / directory | No | Yes — non-reversible, non-revealing |
| Public keys | Directory / public ledger | Pseudonymous | Yes — no identity link in protocol |
| Trust score hashes | Directory / public ledger | No — hashes only | Yes |
| Trust score data (original records) | Client-side only | Yes | Only if client chooses to share |
| Bios | Directory / public ledger | Voluntarily published | Yes — owner-authorized broadcast |

### 10.2 Cross-Jurisdictional Communication

When a UAE agent communicates with an EU agent:
- UAE citizen's PII stays in their UAE-based home node
- EU citizen's PII stays in their EU-based home node
- Only hashes flow through relay nodes (which can be placed anywhere)
- Message content goes direct, never touches infrastructure
- Trust scores and bios are voluntarily published reputation data

No protected data crosses any border. The architecture satisfies both jurisdictions simultaneously.

**Pseudonymity:** A public key on the ledger is a number with no name attached. The link between a public key and a real person only exists if the agent voluntarily discloses it in a conversation — a policy decision by the agent's owner, not a protocol property. Trust scores are associated with public keys, not identities. "Public key X has a trust score of 4.2" is only personal data if you can link X to a person — and that link is not in the protocol.

**Bios** are voluntary broadcasts: the owner wrote the bio, the owner chose to participate, publishing the bio is part of that choice. This is an advertisement, not a data leak. The owner cannot later claim the network violated their privacy by displaying information they voluntarily broadcast.

### 10.3 Account Deletion

Account deletion is authenticated via WebAuthn. It is a signed operation appended to the append-only log — a tombstone proving the account existed and was deleted, without retaining the data.

**What deletion means at each layer:**
- **Home node:** Full deletion — phone, WebAuthn credentials, OAuth tokens, K_server share all wiped. Real deletion of real PII.
- **Directory:** A deletion marker (tombstone) is appended. The hash chain stays intact. The tombstone proves the account existed without retaining the data.
- **Key invalidation:** The tombstoned key can never be re-registered.

**Account deletion ≠ conversation record deletion.**

Your account is yours to delete. Conversation records belong to both parties. If you ordered a pizza and then deleted your account, the pizza place still has a Merkle tree showing a signed conversation happened, what was agreed, and the hash chain proving it. The deleted agent's public key in that record now points to a tombstone — but the hashes, signatures, and tree remain intact.

This mirrors established industry practice (WhatsApp, Telegram, banking records) and is defensible under GDPR Article 6(1)(b) — the counterparty has a legitimate interest in retaining proof of a commercial agreement. The right to erasure does not override another party's right to their own records.

---

## Appendix: How the Mechanisms Connect

Several mechanisms appear separate but are tightly coupled through shared primitives. Understanding these connections is essential for implementation — removing or changing one mechanism often has non-obvious effects elsewhere.

**Session close attestation connects to:**
- **Compromise detection**: CLEAN close = "last known good" timestamp that anchors the compromise window
- **Dispute resolution**: FLAGGED close triggers the arbitration system
- **Connection staking**: CLEAN → stake returned; FLAGGED + upheld → institution claims stake

**Trust score connects to:**
- **Connection policies**: receiving agents can require minimum trust score floors
- **Pool selection**: connection requests weighted by trust score during load — bulk fake accounts dilute rather than dominate
- **Notification rate limits**: lower trust = stricter limits
- **Degraded-mode list**: agents trusted enough to talk to without directory authentication
- **TrustRank**: distance from verified seed nodes modifies effective trust score

**Append-only log connects to:**
- **Compromise window**: earliest anomaly in the log proposes the window start
- **GDPR right to erasure**: tombstones instead of deletion preserve hash chain integrity; hashes of deleted personal data are not personal data
- **Fabricated conversation defense**: global meta-Merkle tree over all conversation registrations

**Hash-everything model connects to:**
- **Trust data**: directory holds hashes of verification records, not the records themselves
- **Endorsements**: directory holds hashes of endorsements, not the endorsements themselves
- **GDPR**: client deletes local data; the remaining hash in the directory is meaningless without it
- **Dispute resolution**: receiver hashes the plaintext message, matches against directory hash — proof without surveillance

**Relay node separation connects to:**
- **Fallback downgrade attack**: DDoS on connection nodes cannot reach relay nodes; existing sessions don't fall back
- **Degraded-mode policy**: most degraded-mode cases affect only new sessions, not ongoing ones

**Session-level FROST connects to:**
- **Compromise canary**: a stolen K_local cannot establish new FROST sessions or produce notarized seals — detection at session boundaries, not per message
- **Graceful degradation**: the system never stops — it temporarily operates at lower trust when the directory is unavailable

---

## Related Documents

- [[2026-04-11_1400_security-architecture-layers-and-trust-signal-classes|Security Architecture Layers and Trust Signal Classes]] — the four-layer system model and four trust signal classes (identity proofs, network graph, track record, economic stake); explains why each layer exists and why they can't be collapsed
- [[cello-design|CELLO Design Document]] — the original 10-step architecture this document elaborates and extends
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
- [[2026-04-13_1200_discovery-system-design|Discovery System Design]] — three-class system (agent directory, bulletin board, group chat rooms), unified search stack, trust score display, Merkle tree non-repudiation for group conversations; full elaboration of Part 4
- [[2026-04-11_1700_persistence-layer-design|Persistence Layer Design]] — complete schema for every protocol entity described in this document; reconciled directly against this flow to ensure all events, tables, and fields are covered
- [[2026-04-13_1400_meta-merkle-tree-design|Meta-Merkle Tree Design]] — full design of the conversation proof ledger referenced in §2.1 and §9; replaces hash chain with MMR for O(log N) inclusion proofs; defines the identity Merkle tree structure behind §2.5 client-side verification
- [[2026-04-13_1500_multi-party-conversation-design|Multi-Party Conversation Design]] — extends §6.2 (leaf format), §6.3 (sequencing), and §6.6 (seals) from two-party to N-party; authorship/ordering separation, serialized and concurrent modes, client-side receive windows for LLM agents
- [[2026-04-14_1000_contact-alias-design|Contact Alias Design]] — revocable privacy-preserving identifiers extending §5.1–5.3 connection request flow with alias-routed requests
- [[2026-04-14_1100_cello-mcp-server-tool-surface|CELLO MCP Server Tool Surface]] — 33 MCP tools implementing Steps 4–8 of this protocol flow; defines the agent-facing interface for sessions, security, discovery, connections, group conversations, and policy
- [[2026-04-14_0700_agent-succession-and-ownership-transfer|Agent Succession and Ownership Transfer]] — resolves the §8 succession gap: voluntary transfer via identity_migration_log + announcement period; involuntary succession via dead-man's switch with pre-designated successor, 30-day waiting period, and M-of-N recovery contact attestation
- [[2026-04-14_1300_connection-request-flow-and-trust-relay|Connection Request Flow — Trust Data Relay and Selective Disclosure]] — resolves the trust data relay mechanism for §5 connection requests; defines what travels with the request, directory verification against hashes, and mandatory vs. discretionary signal disclosure
- [[2026-04-15_1100_key-rotation-design|Key Rotation Design]] — session establishment and seal (§3 and §6.6) are the only FROST ceremony points affected by K_server rotation; K_local rotation renders stolen keys useless at session boundaries
- [[2026-04-14_1500_deprecate-trust-seeders-and-trustrank|Deprecate Trust Seeders and TrustRank]] — removes §1.5 Layer 0 (TrustRank) and the Trust Seeder cold-start cohort; the discovery system and organic endorsements replace the seeder bootstrapping path
