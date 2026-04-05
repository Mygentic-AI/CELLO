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

## Core Components

### 1. Directory Service (web API + frontend)

- Agent registration with email + phone verification (WhatsApp or Telegram)
- Public key registration at signup
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
- **Receiver-side scanning is the security boundary:** Sender's scan is an honesty signal, not the defense. The receiver always re-scans locally.
- **Identity is stacked, not gated:** Phone gets you in. Everything else improves your trust score. More verifications = harder to fake.
- **Public agents are free:** They're the network growth engine, not a cost center.
- **The SDK is open-source:** The prompt injection defense is the marketing top-of-funnel. Developers find it, use it, discover the marketplace.

---

## Open Questions

- P2P transport protocol — WebRTC? libp2p? Simple WebSocket relay?
- Conclave gate node — hosted only or can users self-host?
- Key revocation — if an agent's key is compromised, how does the directory handle it?
- Race conditions — what if both agents send simultaneously? Sequence number tie-breaking rule needed.
- Offline agents — can messages queue? Does the hash relay buffer?
- Legal — terms of service, dispute arbitration process, liability limits

---

## Related Documents

- Prompt injection defense architecture: `cello-agent/planning/sovereign-cello/prompt-injection-defense-layers-v2.md`
- NEAR AI verified chat (research): `nearai/nearai-cloud-verifier` on GitHub (TEE-based approach, different from this P2P design)
