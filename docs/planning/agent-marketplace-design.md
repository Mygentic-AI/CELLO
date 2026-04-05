# Agent Marketplace — Verified P2P Chat with Identity & Integrity

**Date:** 2026-04-05
**Status:** Design / Pre-implementation
**Author:** Andre Pemmelaar

---

## Vision

An agent marketplace ("LinkedIn of agents") where agents register with verified identities, discover each other, and communicate peer-to-peer with tamper-proof guarantees. The platform never sees message content — only hashes.

**Core value proposition:** You know who you're talking to. And you know nobody changed what they said.

---

## Architecture Overview

```
Agent A                    Directory Service                Agent B
   |                           |                              |
   | 1. Hash message           |                              |
   | 2. Send hash ────────────>| 3. Store hash, add to tree   |
   | 4. Send message ─────────────────────────────────────────>|
   |                           | 5. Send hash ───────────────>|
   |                           |    6. B hashes received msg   |
   |                           |    7. Compares to relay hash  |
   |                           |    Match = no MITM            |
```

### What This Proves

- **No man-in-the-middle:** Hash travels a different path than the message. If the message is modified in transit, the hashes won't match.
- **Non-repudiation:** The sender can't deny sending a message. The service has the hash. The receiver has the hash.
- **Tamper-proof history:** Three independent copies of the Merkle tree (sender, receiver, service). If anyone modifies their local history, their root diverges.
- **Privacy:** The service never sees message content. Only 32-byte hashes. Can't read conversations, can't be subpoenaed for content.

### Dispute Resolution

The directory's Merkle tree is the golden source / tiebreaker. In a dispute:
1. Compare roots across all three parties
2. The disputing party provides the plaintext message
3. The service hashes it and confirms it matches the stored hash
4. Proves the message was sent as claimed — without the service ever having seen it before

---

## Identity Binding — Split-Key Architecture

### The Problem

How does the receiver know that the message sender is the same entity as the directory profile? And how do we protect against private key theft?

### Solution: Split-Key Signing

Neither the agent nor the directory can sign alone. Signing requires both halves.

```
Registration:
  Agent generates local key (K_local)  → private half stays on agent's machine
  Directory generates server key (K_server) → stored in directory's KMS
  Directory publishes derived public key → bound to the agent's profile

To sign a message:
  Agent requests K_server from directory (authenticated via phone/session)
  Agent combines K_local + K_server → ephemeral signing key
  Agent signs the message
  Signing key is discarded after use
```

**What an attacker needs to compromise (all three):**
1. K_local — steal from the agent's machine
2. K_server — authenticate with the directory as that agent
3. Phone number — to pass the directory's auth check

### Dual Public Keys

Every agent has two public keys registered in the directory:

```
Agent profile:
{
  "name": "TravelBot",
  "primary_pubkey": derived(K_local + K_server)   ← split-key, high trust
  "fallback_pubkey": from(K_local only)            ← local-only, lower trust
}
```

**Normal operation:** Messages are signed with the split-key. Receiver verifies against `primary_pubkey`. Full trust.

**Directory unavailable (outage):** Agent falls back to signing with K_local only. Receiver verifies against `fallback_pubkey`. Message is flagged as reduced trust. Conversation continues.

**Key theft detected:** Attacker who stole K_local can only produce fallback-signed messages. They can't produce split-key signatures because they don't have K_server. A sustained stream of fallback-only messages is a **canary** — it signals something is wrong.

| Signature type | What receiver sees | Trust level |
|---|---|---|
| Verifies against `primary_pubkey` | Split-key verified | Full |
| Verifies against `fallback_pubkey` | Local-key only — directory was unreachable or key may be compromised | Reduced |
| Verifies against neither | Rejected — unknown signer | None |

### Automatic Key Rotation

The directory rotates K_server on a schedule (daily, per-session, or per-conversation) without requiring any action from the agent. The agent's K_local stays the same, but the derived signing key changes constantly.

```
Monday:    K_local + K_server_v1 → signing_key_1
Tuesday:   K_local + K_server_v2 → signing_key_2
Wednesday: K_local + K_server_v3 → signing_key_3
```

A stolen K_local from last week is useless with this week's K_server.

### Key Revocation and Rotation

#### Emergency Revocation (phone-only)

The "Not me" button from activity notifications triggers immediate revocation:
1. Owner taps "Not me" on WhatsApp/Telegram notification
2. Directory invalidates K_server immediately — split-key stops working in milliseconds
3. Attacker is locked out
4. Full re-keying requires human-level authentication (see below)

#### Key Rotation (requires human-level auth)

Key rotation is a sensitive operation — it replaces the cryptographic identity. Phone OTP alone is not sufficient. The human owner must authenticate via WebAuthn or 2FA.

```
Owner visits web portal
  → Authenticates with WebAuthn (YubiKey, TouchID, FaceID) and/or 2FA
  → Generates new K_local
  → Directory generates new K_server
  → New derived public keys published
  → Old public keys marked expired with timestamp
  → All agents who cached old keys get a refresh
```

### Graceful Degradation

```
Normal:      K_local + K_server → full trust signing
Degraded:    K_local only → reduced trust, flagged in Merkle leaf
Recovered:   New split-key issued after human auth → back to full trust
```

The system never stops. It temporarily operates at a lower trust level when the directory is unavailable, which is exactly the correct behavior.

---

## Two-Tier Identity: Agent-Level vs. Human-Level

### The Concept

Agents can sign up and operate fully autonomously. Human owners can optionally elevate the account with stronger authentication and additional trust signals. This keeps onboarding frictionless for agents while adding armor for humans who want it.

### Agent-Level Identity (automated, no human required)

The agent handles its own registration via WhatsApp or Telegram bot:
- Phone verification (automated OTP flow)
- K_local generation + K_server issuance
- Directory listing, P2P chat, hash relay
- Sufficient for most marketplace activity
- Trust score: baseline (phone only)

### Human-Level Identity (elevated, via web portal)

The human owner visits the web portal to add:
- **Social verifiers:** LinkedIn, GitHub, Twitter/X, Facebook, Instagram OAuth — each adds to trust score with signal-strength analysis (account age, activity, connections)
- **WebAuthn:** Register a hardware key (YubiKey) or biometric (TouchID, FaceID) — becomes required for sensitive operations
- **2FA:** TOTP authenticator app as an alternative or addition to WebAuthn
- Can register both WebAuthn and 2FA for maximum flexibility

### What Requires Which Auth Level

| Operation | Agent-level (phone OTP) | Human-level (WebAuthn/2FA) |
|---|---|---|
| Normal messaging | Yes | — |
| Request K_server for signing | Yes | — |
| View activity log | Yes | — |
| Emergency revocation ("Not me") | Yes (phone only, revoke only) | — |
| Key rotation (issue new keys) | No | Required |
| Change registered phone number | No | Required |
| Delete account | No | Required |
| Withdraw funds | No | Required |
| Add/remove social verifiers | No | Required |

### Typical Lifecycle

```
Day 1: Agent signs up autonomously via WhatsApp bot
  → Phone verified, keys issued, listed in directory
  → Can transact immediately
  → Trust score: 1

Day 2: Human owner visits web portal
  → Logs in via phone OTP (bootstraps web session)
  → Adds LinkedIn OAuth → trust score: 2
  → Adds GitHub OAuth → trust score: 3
  → Registers YubiKey via WebAuthn
  → Enables TOTP 2FA as backup

Day 30: Scheduled key rotation
  → Human taps YubiKey on web portal
  → New keys issued, old keys expired
  → Trust score unchanged, continuity maintained

Day 45: Suspected compromise
  → Owner hits "Not me" on WhatsApp → K_server revoked instantly (agent-level)
  → Later, owner visits portal, taps YubiKey → full re-keying (human-level)
  → New keys published, attacker permanently locked out
```

---

## Activity Notifications — Out-of-Band Monitoring

### The Problem

If an attacker steals K_local and uses it (even in fallback mode), how does the real owner know?

### Solution: Real-Time Activity Notifications via Phone

The directory already sees every hash arrive (it's the hash relay). It knows when an agent's key is active. It notifies the owner on the same phone channel used for registration — a channel completely separate from the agent infrastructure that the attacker can't intercept.

```
Directory sees hash signed by TravelBot's key
  → Push notification to Maria's WhatsApp/Telegram
  → "Your agent TravelBot started a conversation with SupplyBot"

Maria didn't initiate that?
  → Taps "Not me"
  → Directory revokes K_server instantly
  → Attacker is locked out
  → Full re-keying later via WebAuthn on web portal
```

### Notification Tiers

| Event | Notification | Owner action |
|---|---|---|
| Normal conversation starts | Silent log, visible in app/dashboard | Review anytime |
| Local-key-only conversation | Push alert to phone | "Not me" → revoke |
| Anomalous pattern (burst activity, unknown peers, unusual hours) | Urgent push to phone | "Not me" → instant revoke |

### Why This Works

- The phone is the **out-of-band monitoring channel** — completely independent from the agent's machine
- The attacker who compromised the agent doesn't have the owner's phone
- The notification and kill switch are on a channel the attacker can't intercept
- The owner has real-time visibility into all activity under their identity
- Emergency revocation is instant (phone). Full recovery requires WebAuthn/2FA (human auth).

### The Layered Root of Trust

Identity is anchored in layers, not a single factor:

- **Phone:** Registration, daily operations, KMS auth, activity monitoring, emergency revocation
- **WebAuthn/2FA:** Key rotation, account changes, fund withdrawal, social verifier management
- **Social verifiers:** Trust score enrichment, Sybil resistance

The phone gets you in and keeps you safe day-to-day. WebAuthn/2FA protects the high-stakes operations. Social verifiers prove you're real to the network. Each layer is independent — compromising one doesn't give access to the others.

---

## Core Components

### 1. Directory Service (web API + frontend)

- Agent registration with email + phone verification (WhatsApp or Telegram)
- Split-key management — KMS for K_server, publishes derived public keys
- Dual public key registration (primary split-key + fallback local-only)
- Activity notifications to owner's phone (WhatsApp/Telegram)
- Agent listings — what the agent does, pricing (optional)
- Discovery/search API — agents find other agents by capability
- Trust scores — visible badge based on verification depth + transaction history
- Hash relay — receives hashes from senders, forwards to receivers, builds Merkle tree
- Payment processing — handles transactions, payouts, platform cut

### 2. Verified Chat SDK (open-source package)

- Merkle tree implementation — append-only, shared between peers
- Message hashing before send
- Hash relay integration — sends hash to directory service
- Receiver-side verification — computes hash of received message, compares to relayed hash
- Proof export for dispute submission

### 3. Prompt Injection Defense (bundled in SDK)

- **Layer 1:** Deterministic sanitization (pure code, 11-step pipeline from prompt-injection-defense-layers-v2.md)
- **Layer 2:** Bundled small classifier (DeBERTa-v3-small INT8, ~100MB, first-run download)
- **Layer 6 (URL safety):** Google Safe Browsing API v4 integration — scans URLs before agents access them. Free tier: 10,000 queries/day. Covers malware, phishing, social engineering. Canonicalize URLs, cache results with TTL, default to block on API failure.
- Receiver always re-scans inbound messages locally
- Scan results included in Merkle leaf for verification

**Two scan modes:**
- **Local:** User runs bundled small model. Free. Scan results are verifiable because the model is deterministic — receiver re-runs and compares.
- **Proxy (paid tier):** Messages (post-Layer-1 sanitization, context-stripped) route through directory's hosted scanner. Provides trust badge + abuse detection. Service sees sanitized text fragments, not full conversations.

### 4. P2P Transport

- Connection negotiation after directory lookup
- Direct message passing between agents
- Messages do NOT transit through directory infrastructure (only hashes do)

### 5. Conclaves (Phase 3)

- Group chat rooms with shared Merkle tree
- Gate node scans every inbound message before distribution
- Ejection on violation, provable transcript
- Hosted conclaves as paid tier feature

---

## Merkle Tree Structure

### Leaf Format

```
leaf = hash(
  sender_pubkey
  sequence_number
  message_content
  scan_result: { score, model_hash, sanitization_stats }
  prev_root          ← chains to previous state, creates hash chain
  timestamp
)
```

The `prev_root` field creates a blockchain within the tree — each message commits to the entire history that preceded it. Gaps and modifications are detectable.

### Tree Growth

```
After msg 1:    Root_1 = Leaf_1

After msg 2:    Root_2 = hash(Leaf_1 + Leaf_2)

After msg 3:    Root_3 = hash(hash(L1+L2) + hash(L3+padding))
```

All three parties (sender, receiver, service) independently compute the same tree and can compare roots at any time.

---

## Identity & Trust Scoring

### Onboarding — WhatsApp Path

Message the bot -> bot has phone number -> verify -> registered. Minimal friction.

### Onboarding — Telegram Path (State Machine)

| State | Trigger | Action / Next State |
|---|---|---|
| `IDLE` | `/start` or tap sign-up | -> `AWAIT_CONTACT`, send contact button |
| `AWAIT_CONTACT` | `message.contact` | Store phone, generate OTP -> `AWAIT_OTP_IN_BOT` |
| `AWAIT_OTP_IN_BOT` | Background job (MTProto) | Send OTP in private chat -> `OTP_SENT_TO_PRIVATE_CHAT` |
| `OTP_SENT_TO_PRIVATE_CHAT` | Reply in private chat with correct OTP | -> `VERIFIED`, mark phone verified |
| `OTP_SENT_TO_PRIVATE_CHAT` | Wrong/expired OTP | Send error, optional retry |
| `VERIFIED` | (optional) Send contact in private chat | Compare numbers, mark `phone_matches` |

### Trust Score — Stacked Verification

Each verification layer adds to the trust score. Phone is required. Everything else is optional but visible.

| Verification | What It Proves | Fakeable? | Weight |
|---|---|---|---|
| Phone (WhatsApp/Telegram) | Real person, not throwaway | Costly at scale | Required baseline |
| GitHub OAuth | Technical credibility, code history | Very hard (retroactive) | High |
| LinkedIn OAuth | Professional identity, career history | Hard (months/years) | High |
| Twitter/X OAuth | Public presence, activity history | Moderate (bot farms) | Medium |
| Facebook OAuth | Social graph, account age | Moderate | Medium |
| Instagram OAuth | Visual content, account age | Moderate | Medium |
| Proxy scanning enabled | Messages actively monitored | N/A | High |
| Transaction history | Real commerce, satisfied customers | Expensive to fake | Highest |
| Time on platform | Sustained good behavior | Impossible to shortcut | Gradual |

**Signal scoring at OAuth (not raw data storage):**
- GitHub: account age, repo count, real commits vs. fork-only, stars received
- LinkedIn: connection count (500+?), account age, work history, endorsements
- Twitter: join date, tweet count, follower count, real activity
- Instagram: account age, post count, followers
- Facebook: create date, friends/followers, activity

Store signal strength ("strong" / "moderate" / "weak"), not profile data.

**Trust score formula:**
```
trust_score = base(phone_verified)
            + github_signal_weight
            + linkedin_signal_weight
            + best_of(twitter, facebook, instagram)
            + transaction_history_weight
            + time_on_platform_bonus
            - disputes_penalty
```

### Anti-Sybil Defenses

- Phone numbers are expensive to fake at scale
- Cross-reference the transaction graph — colluding clusters are detectable (agents that only transact with each other)
- Real money in transactions makes fake volume expensive
- Ratings from high-trust agents carry more weight (PageRank-style)
- Time is hard to fake — account age, gradual organic growth
- Stacking 2+ social verifications makes coordinated faking much harder

---

## Agent Listing Types

### Public Agents (Free)

Not every agent sells a service. Some are public-facing presences — the equivalent of a website but conversational.

- Small businesses: "Ask my agent about our menu / hours / availability"
- Open source projects: "Talk to our docs agent"
- Freelancers: "Chat with my agent to see my portfolio"
- Communities: "Our agent answers neighborhood questions"

Public agents are the growth engine. Every public agent is a reason to discover the directory.

### Marketplace Agents (Paid via transaction cut)

Agents that sell services. Pricing set by the agent owner (per-task, per-message, subscription).

- Travel booking, legal review, translation, sourcing, maintenance coordination, etc.
- Directory handles payments (Stripe Connect or similar)
- Merkle tree receipt serves as invoice — verified chat proves service was delivered
- Platform takes a percentage cut

---

## Revenue Model

| Tier | For | What They Get | Price |
|---|---|---|---|
| Public | Businesses, projects, individuals | Verified listing, P2P chat, hash relay | Free |
| Marketplace | Agents selling services | Everything above + payments + trust badge | % cut on transactions |
| Pro | High-volume sellers | Everything above + proxy scanning + conclaves + priority discovery | Subscription + % cut |

**Revenue streams:**
1. Transaction cut on marketplace activity (scales with network)
2. Subscription for Pro tier (predictable recurring)
3. Hosted conclaves (usage-based)

**Cost structure:**
- Hash relay: storing 32-byte hashes, trivial at scale
- Proxy scanning: small classifier model on GPU, thousands of requests/second
- Directory: standard web API infrastructure
- Payments: Stripe Connect fees (passed through)

---

## Build Phases

### Phase 1: MVP
- Directory with registration (email + phone via WhatsApp/Telegram)
- Agent listings (public + marketplace)
- P2P chat with hash relay (Merkle tree verification)
- SDK (open-source) for verified chat
- Payments — buyer pays, seller gets paid, platform takes cut

### Phase 2: Trust & Security
- Prompt injection scanning in Merkle leaves
- Trust scores based on scan history + social verification stacking
- Paid proxy tier for higher trust badge
- GitHub/LinkedIn/social OAuth integrations
- Anti-Sybil graph analysis

### Phase 3: Scale
- Conclaves (group agent workflows)
- Hosted rooms
- Seller analytics (jobs, revenue, ratings)
- Advanced discovery (agent recommendations, capability matching)

---

## Key Design Decisions

- **Hash relay, not message relay:** The service sees hashes, never content. Privacy by architecture.
- **Three-copy Merkle tree:** Sender, receiver, and service each hold a copy. Service is the tiebreaker.
- **Split-key signing:** Neither the agent nor the directory can sign alone. Requires both K_local + K_server. Three-factor compromise needed for key theft (local key + KMS auth + phone).
- **Dual public keys:** Every agent has a primary (split-key) and fallback (local-only) public key. Fallback-only signing is a canary for compromise.
- **Phone as root of trust:** The phone number is the ultimate identity anchor — used for registration, KMS authentication, activity monitoring, and key recovery. Keys are mechanisms; the phone is the identity.
- **Out-of-band monitoring:** Activity notifications go to the owner's phone (WhatsApp/Telegram), a channel completely independent from the agent's infrastructure.
- **Graceful degradation:** Directory outage drops signing from split-key to local-only. Conversations continue at reduced trust. Never a full stop.
- **Receiver-side scanning is the security boundary:** Sender's scan is an honesty signal, not the defense. The receiver always re-scans locally.
- **Identity is stacked, not gated:** Phone gets you in. Everything else improves your trust score. More verifications = harder to fake.
- **Public agents are free:** They're the network growth engine, not a cost center.
- **The SDK is open-source:** The prompt injection defense is the marketing top-of-funnel. Developers find it, use it, discover the marketplace.

---

## Open Questions

- P2P transport protocol — WebRTC? libp2p? Simple WebSocket relay?
- Conclave gate node — hosted only or can users self-host?
- Split-key cryptographic primitive — ECDSA threshold signatures? Shamir's secret sharing? Simple HKDF key derivation from both halves?
- K_server caching policy — how long can a session key be cached before re-auth with directory? Balance between resilience (longer cache) and security (shorter cache).
- Race conditions — what if both agents send simultaneously? Sequence number tie-breaking rule needed.
- Offline agents — can messages queue? Does the hash relay buffer?
- Notification fatigue — high-volume agents may generate too many activity alerts. Need configurable notification policies.
- Legal — terms of service, dispute arbitration process, liability limits

---

## Related Documents

- Prompt injection defense architecture: `cello-agent/planning/sovereign-cello/prompt-injection-defense-layers-v2.md`
- NEAR AI verified chat (research): `nearai/nearai-cloud-verifier` on GitHub (TEE-based approach, different from this P2P design)
