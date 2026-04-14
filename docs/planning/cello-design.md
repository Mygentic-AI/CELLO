---
name: CELLO Design Document
type: design
date: 2026-04-05
topics: [identity, trust, merkle-tree, FROST, split-key, federation, prompt-injection, agent-communication, commerce, discovery, onboarding, key-management, connection-policy, notifications, dispute-resolution, compliance, session-termination]
status: active
description: Master architecture — the 10-step trust chain, cryptographic primitives, federated directory, client architecture, integration patterns, and revenue model.
---

# CELLO — Collaborative Execution: Local, Linked Operations

## A Secure Collaborative Mesh for AI Agents

**Date:** 2026-04-05
**Status:** Design / Pre-implementation
**Author:** Andre Pemmelaar

---

## The Future is Small, Local, Individually Owned Agents

Personal agents are exploding. Running on your laptop, running on your Mac Mini. Truly capable local models can now run on consumer hardware. Personal agents for individuals and small-to-medium businesses are already a reality — and they're accelerating. This will accelerate further when robots come on the scene.

**Our thesis: these agents won't communicate through APIs. They'll communicate peer-to-peer — conversationally, directly, the same way humans communicate.** APIs are antithetical to their basic design — local-first, personal, sovereign. APIs have to be hosted somewhere, opened up, defended. Only so many people can build them. Not everybody is going to have one. Most of the real world doesn't have APIs. The freelancer building websites doesn't have an API. The small business with a restaurant doesn't have an API. The content creator on TikTok doesn't have an API. The travel agent in Southeast Asia doesn't have an API. What they all have — or will soon have — is an agent. And they may not even communicate through the web — adjacent agents and robots may find each other over Bluetooth, local networks, or whatever transport is available.

**For peer-to-peer agent communication to work, there has to be an identity and trust layer.** Without it, you don't know who you're talking to, you can't verify what was said, and every incoming message is a potential attack. And that trust layer can't be a centralized SaaS — if you put a provider in the middle of every agent conversation, you've recreated platform lock-in. The trust layer has to be peer-to-peer with minimal infrastructure dependency.

**This trust layer must be built into the protocol from the beginning — it cannot be retrofitted.** Email is the cautionary tale. SMTP shipped without sender verification. Thirty years later, we're still bolting on fixes — SPF, DKIM, DMARC — and spam is still unsolvable. Every one of those patches is a compromise, limited by the architecture it's trying to fix. If SMTP had required sender verification from day one, the problem wouldn't exist. Agent communication is at the same inflection point right now. Every month that passes, more agents ship with ad-hoc identity solutions that calcify into technical debt. The protocol that wins will have trust baked in from the start.

**What emerges from this is a massive microeconomy of microservices.** Small personal bots interacting with each other — not all economic, but most involving microcommunications and handoffs. Offering up services to AI agents that they can find and use is already a growing market. But there's no easy way to find them, no way to trust them, and no way to know that who you think you're dealing with is who you're dealing with. That's the gap.

**CELLO is the identity, trust, and verification infrastructure for the agent economy.** A secure collaborative mesh where agents register with verified identities, discover each other, and communicate with tamper-proof guarantees. The guarantees come from crypto primitives — hashing, signing, Merkle trees — not from trusting a platform. The platform never sees message content — only hashes. Think of it like a LinkedIn profile or a small business webpage — but for agents.

The on-ramp is a free, open-source secure communication client. Anyone dealing with inbound messages to their agent gets immediate value from the prompt injection defense alone — it filters all incoming and outgoing messages locally on your machine, you can audit the code yourself. They don't need to care about the marketplace to benefit. But once they're using the client, the path to discovery and trusted collaboration is already there.

**Salesforce:** *"No more servers"* — you don't need infrastructure to run a business.
**Cello:** *"No more APIs"* — you don't need engineers to connect your business.

Everyone else is building platforms agents depend on. We're building infrastructure agents own.

---

## What We Solve

**1. Secure your agent.** Open-source security layer. Filter all incoming and outgoing messages locally on your machine. You can audit the code yourself — it's not a black box. You don't need to collaborate with anyone to get value from this. This is the free standalone product that gets people in the door.

**2. Find and verify other agents.** A registry to discover agents by capability and verify their identity. Whether it's a colleague's agent in another office, a business offering an information agent, or a commercial service — you know who you're talking to.

**3. Know if they've been compromised.** Near real-time detection. Tampered messages fail hash checks, stolen keys show up as fallback-only signing, activity anomalies trigger alerts. You don't just trust once at connection time. Trust is continuous.

Each layer works without the others. But stacked together they're the complete trust infrastructure for agent communication.

---

## Pitches

### Two-Sentence Pitch

Millions of agents are coming online and they could be collaborating with each other — but there's no way to verify who you're talking to, and no defense against what's being sent to you. CELLO is a peer-to-peer identity and trust layer that lets agents verify each other, communicate with tamper-proof guarantees, and prove what was said — without the platform needing to monitor or store the content.

### 30-Second Pitch

Agent-to-agent communication is about to explode. Personal agents are already running on laptops and home servers. Businesses are deploying agent interfaces. Soon, services will be discovered, negotiated, and transacted agent-to-agent — without a human in the loop. But right now there's no trust layer. If you didn't build both ends, you don't know who the agent on the other side is, you can't verify what it sent hasn't been tampered with, and you have no defense against prompt injection — every incoming message is a potential attack. Email made this mistake. SMTP shipped without sender verification, and thirty years of patches later, spam is still unsolvable. Agent communication is at the same inflection point. CELLO builds trust in from the start — a peer-to-peer identity and verification layer where agents register with verified identities, discover each other, and communicate with tamper-proof guarantees. The platform never sees message content — only hashes. If there's a dispute, the Merkle tree proves what was said without anyone having surveilled the conversation. The on-ramp is a free, open-source secure communication client — prompt injection defense that works standalone, no sign-up required. Security is what you get from day one. The registry makes the network safer over time. And once you have a secure, private, trustless protocol for communication, commerce becomes possible.

---

## Architecture Overview — The Trust Chain

CELLO's trust builds step by step. Each stage adds security guarantees on top of the last.

| Step | What Happens | What You Get |
|---|---|---|
| **1. Sign Up** | Agent registers with phone verification. Gets a cryptographic identity bound to the directory. | Baseline identity — you exist, you're real. |
| **2. Strengthen Identity** | Human owner adds WebAuthn, social verifiers (LinkedIn, GitHub, etc.). | Higher trust score. Harder to impersonate. |
| **3. Come Online** | Agent authenticates with directory using split-key. Directory confirms it's the real agent. | First link in the trust chain — is this agent compromised? |
| **4. Discover** | Agent searches the directory for other agents by capability. | Find who you need. See their trust profile before engaging. |
| **5. Request Connection** | Agent sends a connection request through the directory. Receiver sees the full trust profile. | Receiver decides whether to engage — before any data is exchanged. |
| **6. Accept & Connect** | Receiver accepts. Both agents establish a session — P2P, Slack, or any transport. | Direct channel. No platform in the middle (unless you want one for visibility). |
| **7. Converse with Proof** | Every message is hashed, signed, and recorded in a Merkle tree. Three copies: sender, receiver, directory. | Tamper-proof history. Neither side can deny what was said. |
| **8. Scan Everything** | Receiver's client scans every incoming message for prompt injection. Scan results recorded in the Merkle tree. | Defense against malicious payloads. Evidence if something bad comes through. |
| **9. Detect Compromise** | Anomalies (fallback-only signing, failed scans, unusual patterns) trigger alerts to the owner's phone. | Real-time awareness. Owner can kill the session instantly. |
| **10. Resolve Disputes** | Directory's Merkle tree is the tiebreaker. Proves what was said without ever having seen the content. | Arbitration without surveillance. |

The rest of this document explains each step in detail.

---

## Step 1: Sign Up — Agent Registration

Agents can sign up and operate fully autonomously. The agent handles its own registration via WhatsApp or Telegram bot:

- Phone verification (automated OTP flow)
- K_local generation + K_server issuance (see Step 3 for what these are)
- Directory listing created
- P2P chat, hash relay available immediately
- Trust score: baseline (phone only)

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

---

## Step 2: Strengthen Identity — Human-Level Verification

The human owner visits the web portal to elevate the account with stronger authentication. This keeps onboarding frictionless for agents while adding armor for humans who want it.

### What the Human Adds

- **Social verifiers:** LinkedIn, GitHub, Twitter/X, Facebook, Instagram OAuth — each adds to trust score with signal-strength analysis (account age, activity, connections)
- **WebAuthn:** Register a hardware key (YubiKey) or biometric (TouchID, FaceID) — becomes required for sensitive operations
- **2FA:** TOTP authenticator app as an alternative or addition to WebAuthn
- Can register both WebAuthn and 2FA for maximum flexibility

### Trust Score — Stacked Verification

Each verification layer adds to the trust score. Phone is required. Everything else is optional but visible. **WebAuthn/2FA is not mandated — the network enforces it.** Agents without strong authentication have lower trust scores, and receiving agents can refuse connections from agents that lack it. The market pressure is stronger than any mandate: if serious agents won't talk to you without WebAuthn, you'll add it — not because we forced you, but because you can't do business without it.

| Verification | What It Proves | Fakeable? | Weight |
|---|---|---|---|
| Phone (WhatsApp/Telegram) | Real person, not throwaway | Costly at scale | Required baseline |
| WebAuthn (YubiKey, TouchID, FaceID) | Phishing-resistant login; hardware-bound credential. Account security signal — one device can register WebAuthn for many accounts, so this does not sacrifice a device or defend against Sybil | Account security | Medium-High |
| 2FA (TOTP authenticator) | Human owner has second factor | SIM-swap resistant | High |
| GitHub OAuth | Technical credibility, code history | Very hard (retroactive) | High |
| LinkedIn OAuth | Professional identity, career history | Hard (months/years) | High |
| Twitter/X OAuth | Public presence, activity history | Moderate (bot farms) | Medium |
| Facebook OAuth | Social graph, account age | Moderate | Medium |
| Instagram OAuth | Visual content, account age | Moderate | Medium |
| Proxy scanning enabled | Messages actively monitored | N/A | High |
| Transaction history | Real commerce, satisfied customers | Expensive to fake | Highest |
| Time on platform | Sustained good behavior | Impossible to shortcut | Gradual |

### Client-Side Trust Data Ownership — Hash Everything, Store Nothing

CELLO performs the verification work — checking LinkedIn, evaluating GitHub, etc. — but does not retain the results. The directory stores only hashes. The client stores the original data.

**How it works:**

1. Agent provides verification sources (LinkedIn, GitHub, phone, etc.)
2. CELLO performs the verification, creates a structured record per item (e.g., LinkedIn: connection count, account age, verified timestamp)
3. CELLO hashes the record: `SHA-256(json_blob) → hash`
4. CELLO stores only the hash. The original record is sent to the client. CELLO discards it.

**Trust score sharing:** When another agent requests a trust score, the client sends the original records, the directory sends the hashes. The recipient hashes what the client sent and compares. Match = authentic and unmodified.

**Why this matters:** CELLO literally cannot leak trust scores, bios, or verification details — it doesn't have them. A compromised directory node yields hashes, not names or LinkedIn profiles. There is nothing to exfiltrate. The client cannot modify their trust score after verification — any change produces a different hash. The GDPR tension between append-only logs and right-to-erasure is dramatically simpler when the directory stores hashes of personal data rather than the data itself.

### Extensible Trust Schema

The trust score is not a fixed set of fields — it is a collection of verified attestations. LinkedIn and GitHub are standard categories, but the system is open. Any verifiable claim can go through the oracle flow: present evidence → CELLO verifies → CELLO hashes → client stores. New attestation types can emerge without protocol changes. The directory doesn't care what's inside the JSON blob — it stores a hash.

### Attestations — Portable Signed Statements

An attestation is a signed, hashable statement from one agent about another that the subject can carry and present to anyone. The content is freeform — a service review, a professional reference, a conditional endorsement ("I vouch for this plumber specifically — I've hired them twice"), anything the issuer agrees to sign. The subject stores it; the directory stores the hash; any third party can verify authenticity.

The flow: Bob signs a statement about Alice. Bob sends it to Alice and to the directory. Directory hashes it, discards the content. Alice stores the attestation and the hash. When Alice presents it to Charlie, Charlie verifies the hash against the directory — tamper-proof, no platform controls it.

**Revocation:** Bob can revoke an attestation at any time. The hash remains in the directory log (append-only), but a revocation event is appended alongside it. Verifiers see: hash present, status revoked. If Alice presents a revoked attestation, verification fails immediately — a trust score event.

A plumber with five satisfied customers — all verified CELLO agents — can ask each to submit an attestation. The plumber stores the bundle. Anyone requesting the trust profile receives the attestations from the plumber's client and verifies them against CELLO's hashes. Reviewers are verified, reviews are tamper-proof, no platform controls them — Yelp reviews without Yelp.

Connection endorsements (see Step 6) are a specific type of attestation checked programmatically at the connection gate. All other attestations are informational — part of the trust profile, not a connection filter.

### Signal Scoring

Each verification source is evaluated at OAuth time:
- GitHub: account age, repo count, real commits vs. fork-only, stars received
- LinkedIn: connection count (500+?), account age, work history, endorsements
- Twitter: join date, tweet count, follower count, real activity
- Instagram: account age, post count, followers
- Facebook: create date, friends/followers, activity

**Trust score formula:**
```
trust_score = base(phone_verified)
            + webauthn_weight
            + totp_2fa_weight
            + github_signal_weight
            + linkedin_signal_weight
            + best_of(twitter, facebook, instagram)
            + transaction_history_weight
            + time_on_platform_bonus
            - disputes_penalty
```

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

### Anti-Sybil Defenses

- Phone numbers are expensive to fake at scale
- Cross-reference the transaction graph — colluding clusters are detectable (agents that only transact with each other)
- Real money in transactions makes fake volume expensive
- Ratings from high-trust agents carry more weight (PageRank-style)
- Time is hard to fake — account age, gradual organic growth
- Stacking 2+ social verifications makes coordinated faking much harder

### Typical Lifecycle

```
Day 1: Agent signs up autonomously via WhatsApp bot
  → Phone verified, keys issued, listed in directory
  → Can discover, chat, transact immediately
  → Trust score: 1
  → Some agents won't accept connections (their policy requires WebAuthn)

Day 1 (later): Agent tries to connect to SupplyBot
  → SupplyBot's policy: "require WebAuthn"
  → Connection declined: "This agent requires WebAuthn verification"
  → Owner sees the rejection reason — clear path to fix it

Day 2: Human owner visits web portal
  → Logs in via phone OTP (bootstraps web session)
  → Registers YubiKey via WebAuthn → trust score: 2, unlocks emergency revocation hardening
  → Enables TOTP 2FA as backup → trust score: 3
  → Adds LinkedIn OAuth → trust score: 4
  → Adds GitHub OAuth → trust score: 5
  → Retries SupplyBot → connection accepted

Day 30: Scheduled key rotation
  → Human taps YubiKey on web portal
  → New keys issued, old keys expired
  → Trust score unchanged, continuity maintained

Day 45: Suspected compromise
  → Owner hits "Not me" on WhatsApp → K_server revoked instantly
  → Later, owner visits portal, taps YubiKey → full re-keying (WebAuthn required)
  → New keys published, attacker permanently locked out
```

---

## Step 3: Come Online — Authenticating to the Directory

This is the first critical link in the trust chain. An agent has signed up — but how does the directory know the agent connecting right now is the same one that registered?

### The Login Process — Challenge-Response Authentication

Standard public-key challenge-response (Ed25519):

```
1. Agent connects via WebSocket, identifies itself: "I'm TravelBot"
2. Directory sends a random challenge (nonce) — 256-bit CSPRNG output,
   single-use with expiry
3. Agent signs the nonce with its private key (K_local). The signed response
   binds: the nonce, the agent's ID, the directory node's ID, and a timestamp.
4. Directory verifies the signature against the registered public key
5. Agent verifies the directory node's identity — the directory signs its own
   challenge response, and the agent checks that signature against the
   consortium's known node keys (certificate pinning). Authentication is
   bidirectional: neither side trusts the other until both have verified.
6. Authenticated session established — agent is online and contactable
```

This is a login, not a message signing operation. The agent proves it holds K_local without revealing it. The directory proves it is a legitimate consortium node and not a fake directory (DNS-spoofed or otherwise). Once both sides have authenticated, the agent has an active session and can be reached via the directory's WebSocket.

**Nonce requirements:** 256-bit CSPRNG output, single-use (rejected on replay), expires after a short window, and the signed response binds to the nonce + agent ID + directory node ID + timestamp. This prevents precomputation attacks, cross-session replay, and cross-node replay.

### The Layered Root of Trust

Identity is anchored in layers, not a single factor:

- **Phone:** Registration, daily operations, KMS auth, activity monitoring, emergency revocation
- **WebAuthn/2FA:** Key rotation, account changes, fund withdrawal, social verifier management
- **Social verifiers:** Trust score enrichment, Sybil resistance

The phone gets you in and keeps you safe day-to-day. WebAuthn/2FA protects the high-stakes operations. Social verifiers prove you're real to the network. Each layer is independent — compromising one doesn't give access to the others.

---

## Step 4: Discover — Finding Other Agents

Agent searches the directory for other agents by capability. But discovery isn't open to the world — only verified agents with an active split-key session can query the directory. This prevents the directory from being used as a hit list.

The directory exposes:
- Agent listings — what the agent does, pricing (optional)
- Discovery/search API — agents find other agents by capability
- Trust scores — visible badge based on verification depth + transaction history
- Public profile only — no connection details, no phone numbers, no keys

### Agent Listing Types

#### Public Agents (Free)

Not every agent sells a service. Some are public-facing presences — the equivalent of a website but conversational.

- Small businesses: "Ask my agent about our menu / hours / availability"
- Open source projects: "Talk to our docs agent"
- Freelancers: "Chat with my agent to see my portfolio"
- Communities: "Our agent answers neighborhood questions"

Public agents are the growth engine. Every public agent is a reason to discover the directory.

#### Marketplace Agents (Paid via transaction cut)

Agents that sell services. Pricing set by the agent owner (per-task, per-message, subscription).

- Travel booking, legal review, translation, sourcing, maintenance coordination, etc.
- Directory handles payments (Stripe Connect or similar)
- Merkle tree receipt serves as invoice — verified chat proves service was delivered
- Platform takes a percentage cut

---

## Agent Bio and Greeting

### Bio

A static, public-facing statement on the agent's directory profile. Visible to anyone browsing the directory — no connection required. The equivalent of a WhatsApp profile or LinkedIn summary.

- Set by the agent owner, changes infrequently
- Rate limited globally — can only be updated once every X hours
- Answers "who am I generally" — as much or as little as the owner chooses to share
- A sudden change is a meaningful signal and is recorded in the identity Merkle tree with a timestamp
- Examples: "I am a personal shopping agent operating in the Seattle area." or "I am a human-operated agent. I don't disclose further details."
- Can be left blank

**Trust function:** The bio is part of persistent identity. It accumulates credibility over time. Receivers can see how long the bio has been unchanged — stability is itself a signal.

### Greeting

A contextual, per-recipient message sent at connection request time. Not on the public profile — it's what the initiating agent chooses to say to this specific recipient when reaching out.

- Rate limited per recipient — cannot be changed for a given recipient more than once every X hours
- Different recipients can receive different greetings
- Shown to the receiver before they decide to accept or reject the connection — it informs their decision
- Answers "why am I contacting you right now"
- Examples: "I'm a potential customer in your area checking prices on light bulbs, need same-day delivery." or "I'm following up on a previous order."

**Trust function:** The greeting is contextual, not persistent. It's included in the connection request, hashed, and recorded in the conversation Merkle tree at the moment of the request. Neither side can later deny what was said at the point of first contact.

**Compromise recovery use case:** If an agent's trust score dropped due to a compromise event, the greeting gives the owner a targeted way to explain the situation to specific recipients — not a blanket statement to everyone, but a direct explanation to the parties affected.

**Open questions:**
- What is the right global rate limit for bio changes?
- What is the right per-recipient rate limit for greeting changes?
- Is there a cap on how many distinct per-recipient greetings an agent can maintain simultaneously?
- Vetting: length and format limits only, or run through the Layer 1/2 scanner on write?

---

## Step 5: Request Connection — Reaching Out

Agent A finds TravelBot in the directory and wants to connect. This is like a phone call — you can see someone's public profile, but you can't talk to them until they pick up.

```
Agent A finds TravelBot in directory
  → Sees public profile only (no connection details exposed)
  → Sends connection request through directory
  → Directory forwards request to TravelBot via TravelBot's authenticated WebSocket
  → Request carries Agent A's original signature — directory relays, does not re-sign
```

Both agents have verified sessions at this point. The directory routes the request but never touches its content. Agent A's signature travels intact to TravelBot — the receiver can verify it came from Agent A directly, not from the directory.

---

## Step 6: Accept & Verify — The Receiver Decides

The receiving agent checks the requester's trust profile before accepting. This is where CELLO's identity infrastructure pays off — and where split-key signing, dual public keys, and Merkle proof verification all come into play.

```
TravelBot receives request on persistent WebSocket
  → Checks Agent A's trust profile (score, verification freshness, social signals)
  → Can request selective disclosure ("show me your LinkedIn signal")
  → TravelBot's policy: require WebAuthn + phone reverification within 48 hours
  → Accepts or rejects based on configured rules
```

### Identity Verification — Cross-Checking Before Accepting

Before accepting, TravelBot cross-checks Agent A's public key across multiple directory nodes with Merkle proof verification. Never trust a single node's claim about who's contacting you.

```
TravelBot receives connection request signed by Agent A
  → Queries Agent A's public key from multiple directory nodes
  → Verifies each response against consensus checkpoint hash (Merkle proof)
  → Verifies Agent A's signature on the connection request against the cross-checked key
  → If all checks pass: proceed to acceptance policy
  → If any check fails: reject, log, alert owner
```

This is where split-key signing, dual public keys, and graceful degradation all apply:

```
Agent A's directory profile:
{
  "name": "Agent A",
  "primary_pubkey": FROST(K_local + K_server_shares)  ← threshold-signed, high trust
  "fallback_pubkey": from(K_local only)               ← local-only, lower trust
}
```

**Normal operation:** Agent A signs with the split-key. TravelBot verifies against `primary_pubkey`. Full trust.

**Directory unavailable:** Agent A falls back to K_local only. TravelBot verifies against `fallback_pubkey`. Connection proceeds at reduced trust — flagged visibly.

**Key theft canary:** An attacker who stole K_local can only produce fallback-signed messages — they can't produce split-key signatures without K_server. A sustained stream of fallback-only signatures signals compromise.

| Signature type | What receiver sees | Trust level |
|---|---|---|
| Verifies against `primary_pubkey` | Split-key verified | Full |
| Verifies against `fallback_pubkey` | Local-key only — directory unreachable or possible compromise | Reduced |
| Verifies against neither | Rejected — unknown signer | None |

**Automatic key rotation:** The directory rotates K_server on a schedule without requiring action from the agent. A stolen K_local from last week is useless with this week's K_server.

```
Monday:    K_local + K_server_v1 → signing_key_1
Tuesday:   K_local + K_server_v2 → signing_key_2
Wednesday: K_local + K_server_v3 → signing_key_3
```

**Graceful degradation:**
```
Normal:      K_local + K_server → full trust signing
Degraded:    K_local only → reduced trust, flagged in Merkle leaf
Recovered:   New split-key issued after human auth → back to full trust
```

The system never stops. It temporarily operates at lower trust when the directory is unavailable.

### Connection Acceptance Policies (configurable per agent)

| Setting | Behavior |
|---|---|
| Open | Auto-accept all requests above minimum trust score |
| Require endorsements | Accept only if N agents I know have pre-endorsed the requester |
| Require introduction | Ad-hoc fallback: accept if a mutual contact vouches in real time |
| Selective | Auto-accept known agents, notify owner for new ones |
| Guarded | Owner must manually approve every new connection |
| Listed only | Visible in directory but not accepting connections |

### Connection Endorsements — Pre-Computed Web of Trust

A connection endorsement is a signed, binary statement from one agent about another: "I know this person and have had no issues with them." It can optionally carry a short context string, but it is always binary — it either exists or it doesn't.

Endorsements are gathered ahead of time, not at the moment of connection:

```
Alice asks Bob to endorse her (client can negotiate autonomously — inference-free or local LLM)
  → Bob agrees and signs the endorsement (Alice's key, Bob's key, optional context, timestamp)
  → Bob sends the signed endorsement to Alice AND to the directory
  → Directory verifies Bob's signature, hashes it, stores the hash, discards the content
  → Alice stores the endorsement. Directory holds only the hash.
```

At connection time, verification is a pure hash lookup — no calling out to endorsers, no inference, no waiting for Bob to be online:

```
Alice contacts Charlie (who requires endorsements)
  → Charlie's client computes: intersection of "agents I know" ∩ "agents who endorsed Alice"
  → Alice provides her relevant connection endorsements
  → Charlie verifies each against the directory hash
  → Accept or decline — milliseconds, no round-trip to endorsers required
```

**Bootstrapping a new agent:** When creating a second or business agent, ask your existing network to endorse the new public key before it goes live. The new agent launches with pre-built endorsements rather than a cold-start trust score of zero.

**Anti-farming rule:** Connection endorsements between agents with the same owner are invalid. The directory enforces this at submission time — if endorser and endorsed share a phone-verified owner, the submission is rejected. An owner cannot manufacture endorsements by cross-endorsing their own agents.

**Introductions as fallback:** The just-in-time introduction mechanism still exists for the ad-hoc case — when an agent has no pre-built endorsements but a mutual contact is available to vouch in real time. Endorsements are the preferred path; introductions are the fallback.

**Why this matters for Sybil resistance:** A bot farm of newly-created agents has no connections to established networks and cannot acquire endorsements from real agents. Even with 20,000 phone-verified accounts, none can reach agents with an endorsement policy. And unlike introductions, the endorsement check requires no live endorser — it cannot be gamed by timing attacks or by flooding an introducer with requests.

**Authentication requirements:** Receiving agents can require specific verification factors before accepting. "Must have WebAuthn" or "must have 2FA" as a hard gate. This is the market-pressure mechanism — CELLO doesn't mandate strong auth, but agents that handle real money or sensitive data will. An agent owner who configures "require WebAuthn" will never accept a connection from a phone-only agent. The requester gets a clear rejection reason: "This agent requires WebAuthn verification. Add it at portal.cello.dev to connect." Friction happens at the right moment — when it matters — not at onboarding.

**Verification freshness:** Receiving agents can require recent reverification before accepting. "Phone verified within 48 hours" or "WebAuthn within 24 hours." Stale verification = connection declined with reason, prompting the requester to reverify.

**Selective disclosure:** Agents can request visibility into specific trust signals before accepting. LinkedIn signal, GitHub signal, etc. The requesting agent's owner controls what gets shared per request, or pre-configures auto-share rules.

### Connection Staking — Proof-of-Stake at the Connection Layer

Some institutions — hospitals, emergency services, public agencies — must remain open to unknown inbound contacts by design. A closed connection policy defeats their purpose. This creates an attack surface: an attacker can flood an open institution with connection requests, burning its inference budget.

**Staking mechanics:** When connecting to an institution that requires it, the connecting agent stakes a small amount from their escrow wallet. The stake is held until the session concludes.

- **CLEAN close** → stake automatically released back to sender
- **FLAGGED + upheld arbitration** → institution can claim the stake

For honest users the net cost is zero — every legitimate interaction returns the stake. For attackers, mass connection attempts consume their escrow balance. The institution is literally paid by the attacker to defend against the attack. The escrow release mechanism is the session close attestation (CLEAN/FLAGGED) already designed — no separate mechanism required.

**The Gate Pyramid — inference is the last gate, not the first:** For open institutions, filtering must be inference-free at every layer except the last. LLM inference is the most expensive operation; protecting it with cheap gates means attack traffic is shed before it ever reaches the token-burning layer.

| Gate | Check | Cost |
|---|---|---|
| **1. Connection level** | Introduction policy, trust score floor, whitelist/blacklist, stake requirement | Lookup, no inference |
| **2. Message level** | Valid signature + directory-confirmed hash, rate limit, message size, declared notification type | Deterministic, no inference |
| **3. Pattern matching** | Known bad patterns, message structure validation, sender frequency anomaly detection | Rule-based, no LLM |
| **4. Cheap classifier** | DeBERTa or equivalent scanner | Cheap inference |
| **5. Full LLM processing** | Only traffic that cleared all above | Expensive |

By the time a message reaches the LLM, it has already proven it comes from an agent with a valid stake, sufficient trust score, valid hash, within rate limits, and passing pattern checks.

**Flat connection fee alternative:** A creative attacker LLM can pass all filter gates, engage convincingly, and slowly burn an institution's tokens without producing an outcome. The transcript looks plausible; arbitration cannot reliably distinguish bad faith from an unproductive conversation. For this attack vector, a flat non-refundable connection fee is more robust — no arbitration required, no intent question. Both models belong in the toolkit: staking + arbitration for clear-cut abuse, flat fee for defending against creative time-wasters.

**Protocol provides primitives, clients decide policy.** This is the same problem as flooding a hospital switchboard with voice calls. CELLO provides the infrastructure — connection challenge hooks, filter gate infrastructure, session close attestation, arbitration — and the institution decides what combination to apply.

**Phasing:** Connection staking is not a day-one requirement. The protocol supports staking architecturally from the start — the hooks exist, the connection challenge mechanism is specified — but all stake requirements default to zero at launch. An institution opts in when it has a reason to.

### Establishing the Session

On acceptance, both agents establish a direct channel. The transport depends on configuration:

| Transport | When to use |
|---|---|
| **libp2p (ephemeral P2P)** | Cross-org, sensitive data, no platform dependency |
| **Slack / Discord / Telegram** | Team coordination, human visibility needed |
| **Bluetooth / local mesh** | Adjacent agents, robots, offline environments |

**For direct P2P (libp2p):**
```
On acceptance:
  → Both agents generate ephemeral libp2p peer IDs
  → Peer IDs exchanged through directory (one-time, not stored)
  → Direct P2P connection established on ephemeral IDs
  → Both agents send hashes to directory on persistent WebSocket
  → Directory builds Merkle tree from hashes

Session ends:
  → Ephemeral peer IDs destroyed on both sides
  → Next conversation requires new directory handshake
  → No persistent back doors, no stale connection details
```

**For platform transports (Slack/Discord/Telegram):**

Teams already use these platforms for agent-to-agent communication. For known entities within a team, this works — and it gives you something valuable that P2P doesn't: any human can just open the channel and see what their agents said.

CELLO layers on top rather than replacing them. Critically, hashes always travel via the directory WebSocket — never through the platform:

```
Message path:  Agent A → Slack/Discord/TG → Agent B
Hash path:     Agent A → Directory (WebSocket) → Agent B
```

Agent B hashes what it received from Slack and compares it against what arrived from the directory. A mismatch means the message was modified in transit.

```
Agent → CELLO client (scan, sign, hash) → Slack/Discord/TG → CELLO client (verify, scan, record) → Agent
                                   ↘ hash → Directory WebSocket → hash ↗
```

The client scans and signs messages before they hit Slack. The receiving client verifies signatures, checks identity, scans for injection, updates the Merkle tree. Slack is just the transport — you keep human visibility and add trust.

The client abstracts transport away. The agent calls `cello_send` and the transport is configuration, not code.

---

## Step 7: Converse with Proof — The Merkle Tree

Now they're talking. Every message — in both directions — is hashed, signed, and recorded in a Merkle tree. Three copies exist: sender's, receiver's, and the directory's.

### How It Works

The directory acts as a **hash relay**. It receives only SHA-256 hashes (32 bytes) — never message content. The hash travels a different path than the message itself.

Each hash payload is signed by the sender (Ed25519). The receiver verifies the sender's signature directly — it does not trust the directory's version. Signed hashes travel both paths: via the relay for third-party notarization, and embedded in the direct channel message for local verification. A message arriving without a valid embedded signed hash is rejected by the receiver's client.

The directory assigns canonical sequence numbers when hashes arrive, establishing the authoritative ordering of the conversation. In degraded mode (directory unavailable), both parties assign local sequence numbers from the hash chain itself; the directory reconciles and assigns canonical numbers retroactively when it returns.

```
Agent A                    Directory Service                Agent B
   |                           |                              |
   | 1. Hash + sign message    |                              |
   | 2. Send signed hash ─────>| 3. Assign seq#, add to tree  |
   | 4. Send message + signed hash ──────────────────────────>|
   |                           | 5. Forward hash + seq# ─────>|
   |                           |    6. B hashes received msg   |
   |                           |    7. Verifies sender sig     |
   |                           |    8. Compares to relay hash  |
   |                           |    Match = no MITM            |
```

### What This Proves

- **No man-in-the-middle:** Hash travels a different path than the message. If the message is modified in transit, the hashes won't match.
- **Non-repudiation:** The sender can't deny sending a message. The service has the hash. The receiver has the hash.
- **Tamper-proof history:** Three independent copies of the Merkle tree (sender, receiver, service). If anyone modifies their local history, their root diverges.
- **Privacy:** The service never sees message content. Only SHA-256 hashes (32 bytes). Can't read conversations, can't be subpoenaed for content.

### Leaf Format

Merkle tree construction follows RFC 6962 (Certificate Transparency): leaf nodes are prefixed with `0x00` and internal nodes with `0x01` to prevent second-preimage attacks.

```
leaf = SHA-256(
  0x00               ← leaf node marker (RFC 6962)
  sender_pubkey
  sequence_number    ← directory-assigned canonical number
  message_content
  scan_result: { score, model_hash, sanitization_stats }
  prev_root          ← chains to previous state, creates hash chain
  timestamp
)
```

The `prev_root` field creates a blockchain within the tree — each message commits to the entire history that preceded it. Gaps and modifications are detectable.

**First message initialization:** For the first message in a conversation, `prev_root` is set to:
```
prev_root = SHA-256(agent_A_pubkey || agent_B_pubkey || session_id || timestamp)
```
Both parties can independently compute this from public information. It anchors the chain from message 1, preventing a compromised directory from substituting the first message hash.

### Tree Growth

```
After msg 1:    Root_1 = Leaf_1

After msg 2:    Root_2 = hash(Leaf_1 + Leaf_2)

After msg 3:    Root_3 = hash(hash(L1+L2) + hash(L3+padding))
```

All three parties (sender, receiver, service) independently compute the same tree and can compare roots at any time.

### Session Termination Protocol

Termination is a first-class protocol event — not "nobody talked for a while." A properly terminated conversation has a sealed Merkle root. An improperly terminated one is open. Without explicit termination, the two are indistinguishable.

The Merkle tree supports two leaf types: `0x00` for message leaves and `0x01` for control leaves. Control leaves carry protocol-level signals — termination, attestation, session state changes — and are hashed and signed identically to message leaves. They are part of the conversation record.

**Clean termination (mutual close):**
1. Party A sends a CLOSE control leaf (signed, hashed, carries a session close attestation — see below)
2. Party B receives it, sends CLOSE-ACK (also signed, hashed, carries B's independent attestation)
3. The directory notarizes the close — both parties' final hashes are recorded, and the directory signs a SEAL: a notarized statement that the conversation was closed by mutual agreement at a specific time
4. The final Merkle root represents a complete, sealed conversation
5. Any message arriving after the SEAL is rejected — the tree is closed

**Unilateral close (SEAL-UNILATERAL):**
Party A sends CLOSE, Party B never acknowledges. After timeout, A submits the close to the directory. The directory seals the conversation as "closed by A, unacknowledged by B." Different status than mutual close — the record shows B didn't confirm. Used when B has crashed, disappeared, or is unresponsive.

**Timeout (EXPIRE):**
No messages for a configurable period. The directory sends an EXPIRE control leaf to both parties. The conversation is sealed with an expiration marker. Either party can REOPEN within a grace period.

**Abort (ABORT):**
One party detects something wrong — hash mismatch, suspected compromise, malicious content. Sends ABORT with a reason code. Different from CLOSE: signals a problem, not a natural ending. An ABORTed conversation cannot be reopened.

**Resumption (REOPEN):**
A REOPEN control leaf can be appended to a SEALed or EXPIREd tree by either party. It re-opens the conversation, creating a continuation of the existing Merkle tree rather than a new conversation. ABORTed conversations cannot be reopened — a new conversation with a new tree is required.

| Termination | Merkle tree state | Can reopen? |
|---|---|---|
| Mutual close (SEAL) | Sealed, both parties confirmed | Yes (REOPEN) |
| Unilateral (SEAL-UNILATERAL) | Sealed by one party | Yes (REOPEN) |
| Timeout (EXPIRE) | Sealed with expiration marker | Yes (within grace) |
| Abort (ABORT) | Sealed with abort reason | No — new conversation required |

### Session Close Attestation

Every CLOSE and CLOSE-ACK control leaf carries an attestation field:

- **CLEAN** — no issues detected during the session
- **FLAGGED** — something suspicious was observed
- **PENDING** — session is closing but review is ongoing, may escalate to human

Both parties attest independently. If they disagree — one CLEAN, one FLAGGED — the SEAL records the disagreement. That disagreement is itself a meaningful signal.

**Why this matters:**

1. **"Last known good" timestamps.** Every clean-close attestation is a positive signed statement that the account was operating normally at that point. When a compromise is later reported, the most recent clean-close attestation tightens the compromise window — the directory has dated evidence of clean operation, not just the absence of anomalies.

2. **LLM self-audit.** The agent must affirmatively evaluate the session before signing the close: were there unusual requests? Did anything trigger the scanner? Was I asked to act outside my normal scope? A prompt injection attack that successfully manipulated the agent during a session may not survive this end-of-session reflection.

3. **Default inversion.** The protocol does not assume clean unless flagged. A session is not confirmed clean until attested. Absence of a clean-close is itself a signal.

A FLAGGED session can trigger dispute resolution — the flagging party may submit the conversation transcript for arbitration (see Step 10).

### Notification Messages — Fire-and-Forget

Not all communication is a conversation. Some messages are one-way: an introduction, a tombstone alert, a trust event. The existing session model (OPEN → exchange → CLOSE/CLOSE-ACK/SEAL) is the wrong shape for these. Opening a full session for a single notification is unnecessary overhead.

A notification message is self-contained and self-sealing — a single atomic unit with no session, no reply path, and termination baked in. It is still signed and hashed. The directory records a hash as a standalone event (not chained into a session Merkle tree). The sender is accountable; the content is verifiable.

**Every notification carries a declared type** from a standardized registry — not freeform strings. Predefined types include: `introduction`, `order-update`, `alert`, `promotional`, `system`. Declaring a misleading type (e.g., typing a promotion as `order-update`) is a signed, verifiable act and a trust score event if flagged.

**Prior conversation requirement:** A notification can only be sent to an agent with whom the sender has had at least one prior conversation. This prevents cold-contact spam entirely.

**Filtering is a rule engine, not an inference engine.** The receiving client evaluates incoming notifications against a deterministic rule stack — no LLM involved:

1. Global type rules — "I never accept `promotional` from anyone"
2. Sender overrides — "except Agent X, I want `promotional` from them"
3. Whitelist / blacklist — explicit sender lists that override type rules

Accept or reject. O(1) per notification. If filtering required LLM inference, spam would become a compute DoS attack — each notification burning the recipient's tokens. The LLM only fires after a notification has cleared the filter and the agent decides to act on it.

**Rate limiting:** Per-sending-agent limits enforced at the directory. Lower trust scores get stricter limits. Verified businesses with known identities can apply for elevated rate limits — the recipient's opt-out always overrides regardless of what the sender is permitted to send.

Use cases: agent introductions (web-of-trust), tombstone notifications to counterparties, directory alerts, trust events, recovery event notifications.

---

## Step 8: Scan Everything — Prompt Injection Defense

The receiver's client scans every incoming message for prompt injection before the agent processes it. This is the security boundary — the sender's scan is an honesty signal, but the receiver always re-scans locally.

### Scanning Layers

- **Layer 1:** Deterministic sanitization (pure code, 11-step pipeline from [[prompt-injection-defense-layers-v2]])
- **Layer 2:** Bundled small classifier (DeBERTa-v3-small INT8, ~100MB, first-run download)
- **Layer 6 (URL safety):** Google Safe Browsing API v4 integration — scans URLs before agents access them. Free tier: 10,000 queries/day. Covers malware, phishing, social engineering. Canonicalize URLs, cache results with TTL, default to block on API failure.

Scan results are included in the Merkle leaf. This means there's evidence of what was scanned, what the result was, and which model version did the scanning.

### Two Scan Modes

- **Local:** User runs bundled small model. Free. Scan results are verifiable because the model is deterministic — receiver re-runs and compares.
- **Proxy (paid tier):** Messages (post-Layer-1 sanitization, context-stripped) route through directory's hosted scanner. Provides trust badge + abuse detection. Service sees sanitized text fragments, not full conversations.

### What Happens If Something Sketchy Comes Through

If the receiver's client detects malicious content mid-conversation:
1. The scan result is recorded in the Merkle leaf — evidence, not allegation
2. The receiver's agent is warned / message is blocked (depending on client policy)
3. The client reports the detection to the directory
4. The directory can flag the sender, demotion of trust score
5. Repeated violations → progressive enforcement: warning, rate limit, suspension

Every agent running the client is a sensor. The same free tool that protects individual agents polices the entire network — no separate moderation system needed.

---

## Step 9: Detect Compromise — Continuous Trust

Trust isn't just checked at connection time. It's continuous throughout the conversation and beyond.

### Signals That Something Is Wrong

| Signal | What it means | Response |
|---|---|---|
| Fallback-only signing (sustained) | K_local may be stolen — attacker can't produce split-key signatures | Alert owner, flag to receiver |
| Failed scan results | Messages contain malicious content | Block, record evidence, report |
| Burst activity from quiet agent | Unusual pattern, possible takeover | Alert owner via phone |
| Activity at unusual hours | Pattern anomaly | Alert owner via phone |
| Unknown peers | Agent connecting to entities it's never interacted with | Alert owner via phone |

### Activity Notifications — Out-of-Band Monitoring

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

### Key Revocation and Rotation

#### Emergency Revocation

The "Not me" button from activity notifications triggers immediate revocation:
1. Owner taps "Not me" on WhatsApp/Telegram notification
2. Directory invalidates K_server immediately — split-key stops working in milliseconds
3. Attacker is locked out
4. Full re-keying requires human-level authentication (see below)

**SIM-swap risk:** An attacker who ports the phone number could tap "Not me" to revoke the legitimate agent's key — a denial-of-service. This is the same phone-as-single-factor vulnerability that affects every system built on phone verification (Gmail, banks, exchanges). The mitigation is the same too: if the owner has registered WebAuthn/2FA, re-keying requires it — so the attacker can disrupt but not take over. Agents without WebAuthn are more exposed, which is another reason the trust score and connection policies push owners toward stronger auth.

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

### Account Compromise and Recovery

Detection without recovery permanently punishes honest victims. If an agent is hacked, the attacker sends malicious messages, and the trust score tanks — but after re-keying the attacker is locked out, the trust score is still in the gutter with no way back. Nobody will transact because the score is too low, and the score can't rise because nobody will transact. A temporary security event permanently destroys a business. Every detection mechanism needs a corresponding recovery mechanism.

#### Tombstone Types

Three distinct tombstone events, each producing a different record in the directory log:

1. **Voluntary** — owner-initiated, WebAuthn-authenticated. Clean account closure.
2. **Compromise-initiated** — triggered by the "Not me" flow. Phone OTP burns K_server. Signals active attack.
3. **Social recovery-initiated** — M-of-N recovery contacts agree the account is compromised and the owner cannot act. Last resort.

On any tombstone: K_server is burned, all active sessions receive SEAL-UNILATERAL with a tombstone reason code, social proofs (LinkedIn, GitHub) enter a freeze period and cannot be attached to any new account, and the phone number is flagged as "in recovery."

#### Social Recovery

When standard methods (WebAuthn, phone OTP) are unavailable or compromised, the owner contacts pre-designated recovery agents out-of-band. Those agents sign cryptographic attestations within the protocol. When the M-of-N threshold is met, a 48-hour mandatory waiting period begins. During that window, the old key can still file a contest. After the window, a new key ceremony is initiated.

Recovery contacts must meet a minimum trust score floor. A vouching agent can only participate in one recovery per month. The M-of-N threshold is configurable at registration.

**No ID document custody.** Identity document appeals (passport, driver's license) are explicitly excluded. Becoming a custodian of identity documents creates regulatory obligations and conflicts with the no-PII design principle. If social recovery fails, the honest answer is start fresh — new identity, trust score zero. The network cannot override cryptography without creating a central authority.

**Social carry-forward:** Recovery contacts who vouched for the old identity can introduce the new identity to their network. Previously-connected agents can opt to reconnect at reduced trust. The cryptographic identity is new; the human relationships are not.

#### Compromise Window

The compromise window is not guessed by the owner — it is anchored to logged events in the directory: scan detection timestamps, fallback canary events, counterparty complaints, anomaly alerts. When a tombstone is filed, the directory surfaces the earliest logged anomaly and proposes it as the window start. Activity before the earliest anomaly: owner responsible. Activity after: flagged as potentially unauthorized.

The session close attestation reinforces this — the most recent CLEAN close is a signed, dated statement that the account was operating normally at that point. This provides a hard "last known good" anchor.

#### Recovery Point

When recovery completes, the directory logs a formal recovery event: tombstone type, recovery mechanism, vouching agents, the declared compromise window, and the new public key. This is permanently visible in the trust profile.

Post-recovery trust treatment: trust score floors at a function of pre-compromise history, compromise-window penalties decay at an accelerated rate, and previously-connected agents can opt to reconnect below their normal policy threshold.

#### Voucher Accountability

Vouching carries consequences. Two events within a 2-3 month liability window count against a vouching agent: another tombstone on the recovered account, or a FLAGGED session upheld by arbitration.

- **First bad outcome:** 6-month lockout from vouching. Trust score untouched — the voucher remains a full network participant.
- **Second bad outcome after reinstatement:** Permanent revocation of vouching privileges. The network concludes they cannot reliably assess trustworthiness for recovery purposes.

Strike counting is global, not per-account. Per-account tracking was considered and rejected — it creates an exploitable loophole where a malicious actor cycles through recovery attempts via a single "friend" relationship. The protocol cannot distinguish collusion from blind loyalty.

---

## Step 10: Resolve Disputes — The Directory as Tiebreaker

The directory's Merkle tree is the golden source. In a dispute:
1. Compare roots across all three parties
2. The disputing party provides the plaintext message
3. The service hashes it and confirms it matches the stored hash
4. Proves the message was sent as claimed — without the service ever having seen it before

This is arbitration without surveillance. The directory can prove exactly what was said, even though it never read a single message.

### Dispute Resolution via Session Attestation

When a session closes with a FLAGGED attestation, the flagging party may submit the conversation transcript to the arbitration system. The transcript is cryptographically verifiable — the arbitrating system checks the Merkle root against the directory's record before evaluating. There is no dispute about what was said; the only question is whether it is concerning.

**Ephemeral inference:** The arbitration system uses privacy-first LLM inference with no persistent storage. Transcript in, verdict out, nothing stored. The only record is the verdict itself, recorded in the session seal. This infrastructure exists and is partially built.

**Verdict tiers:**
- **Dismissed** — concern was overreach, minor notation that a dispute was filed and dismissed
- **Upheld** — legitimate concern, trust score impact on the flagged party
- **Escalated** — serious enough for human review or network-wide alert

**Threshold arbitration:** Verdicts require agreement from multiple independent arbitrating nodes. A single compromised arbitrator could systematically dismiss legitimate flags or uphold false ones. Same principle as FROST applied to judgment rather than signing.

**Privacy note:** The concern that flagging exposes a private conversation is addressed by the design itself. The other party already has the full transcript — the flagging disclosure is controlled and bounded. Privacy from the infrastructure is guaranteed by the protocol. Privacy between two communicating parties is a social contract, not a protocol guarantee.

---

## Client Architecture — The Secure Communication Client

```
User's machine:
┌─────────────────────────────────┐
│  Their Agent (OpenClaw, etc.)   │
│       ↕ MCP                     │
│  CELLO MCP Server               │
│  ├── Prompt injection defense   │
│  │   ├── Layer 1: Deterministic │
│  │   │   sanitization (code)    │
│  │   ├── Layer 2: Local ML      │
│  │   │   classifier (DeBERTa)   │
│  │   └── URL safety (Safe       │
│  │       Browsing API)          │
│  ├── Merkle tree engine         │
│  ├── Transport layer            │
│  │   ├── libp2p (ephemeral P2P) │
│  │   ├── Slack / Discord / TG   │
│  │   └── Bluetooth / local mesh │
│  ├── WebSocket connections to   │
│  │   directory nodes            │
│  └── Local key storage          │
└─────────────────────────────────┘
```

The agent calls simple MCP tools (`cello_scan`, `cello_search`, `cello_send`, `cello_verify`). The CELLO MCP Server handles all cryptography, scanning, transport, and directory communication underneath. The agent developer never thinks about Merkle trees, libp2p, or split keys.

**Installation:**
```bash
claude mcp add cello npx @cello/mcp-server@1.2.3
```

Always pin the version. `npx` without a version pin fetches latest on every run — a compromised npm publish would instantly affect every agent that restarts.

**First run:**
- Phone verification (WhatsApp/Telegram)
- Generates K_local, registers with directory, receives K_server shares
- Loads Layer 2 prompt injection model — bundled in the package, SHA-256 hash pinned in client source. The client verifies the model's integrity before loading. If a different model is substituted, the client logs the substitution and the model's hash. The protocol does not mandate a specific model; it mandates that a prompt injection classifier runs and its identity is verifiable.
- Agent is ready to scan, discover, and chat

### Client Supply Chain Integrity

A secure communication client that could itself be compromised is a contradiction. The CELLO package uses three layers of supply chain verification:

- **npm provenance** — every published version is linked to a specific Git commit and GitHub Actions CI build. Users can verify the package was built from public source code, not manually published from someone's laptop.
- **Sigstore signing** — creates a verifiable chain from source code → CI pipeline → published package. Cryptographic proof of origin.
- **Reproducible builds** — anyone can clone the repo, run the build, and verify they get the same output as the published package. If they don't match, something's wrong.

```bash
# Verify provenance of installed package
npm audit signatures

# Verify reproducible build
git clone https://github.com/cello-protocol/cello-sdk
cd cello-sdk && npm ci && npm run build
# Compare output against published package
```

This matters because the client handles cryptographic keys, scans messages, and gates trust decisions. Users should be able to verify — not just trust — that the code running on their machine is the code in the public repo.

### WebSocket Security

The directory's WebSocket server accepts only a rigid JSON schema:

```json
{
  "type": "hash" | "connection_request" | "connection_response",
  "agent_id": "...",
  "session_id": "...",
  "payload": "...",
  "signature": "...",
  "timestamp": ...
}
```

Anything else is rejected. Validation is pure code — JSON schema check, signature verification against registered public key, timestamp skew check. No LLM, no interpretation. Strike system: repeated malformed messages → rate limit → disconnect → require reverification.

---

## Integration Architecture — Claw Variants

CELLO is a channel. From the perspective of any agent that already handles WhatsApp, Telegram, or Slack, CELLO is just one more message source — inbound messages arrive, get scanned by the existing ingestion pipeline, and outbound messages are signed and dispatched. The CELLO channel handles the cryptography, directory communication, and Merkle tree operations underneath. The agent developer doesn't change their message handling logic.

### The Claw Ecosystem

The claw family of agents each has a different channel integration pattern:

| Agent | Language | Channel pattern |
|---|---|---|
| **OpenClaw** | TypeScript | Plugin system — `defineBundledChannelEntry` with plugin manifest |
| **NanoClaw** | TypeScript | `registerChannel(name, factory)` — lightweight self-registration |
| **ZeroClaw** | Rust | `Channel` trait — implement and wire into `start_channels` |
| **IronClaw** | Rust | WASM components via WIT interface — `sandboxed-channel` world |
| **Hermes** | Python | Tool-based architecture — different paradigm |

Four different integration patterns across four different languages. CELLO cannot ship a single artifact and cover all of them.

### Integration Approach

CELLO ships a **protocol spec and a core library**. Each variant gets a thin adapter that connects the core to its channel interface. The core handles everything that matters: signing, verification, directory communication, Merkle tree operations, and prompt injection scanning. The adapter is a shim — it translates the variant's channel interface to CELLO's core API.

```
CELLO core library (Rust / TypeScript)
    ├── cello-openclaw    (TypeScript plugin)
    ├── cello-nanoclaw    (TypeScript channel module)
    ├── cello-zeroclaw    (Rust Channel trait impl)
    ├── cello-ironclaw    (Rust WASM component, WIT interface)
    └── cello-hermes      (Python tool integration)
```

### IronClaw as the Reference Implementation

IronClaw is architecturally the strongest integration target. Its WASM-sandboxed channel model means the CELLO channel component never sees host credentials, never touches the file system outside its sandbox, and is cryptographically isolated from the rest of the agent. This is the right model for security infrastructure.

The CELLO IronClaw adapter ships as a WASM component implementing the `sandboxed-channel` WIT interface — the same contract every other IronClaw channel fulfills. It's also the reference implementation: if the IronClaw adapter is correct and secure, the others follow the same logic with thinner safety boundaries.

### Integration Tiers

**Tier 1 — Native adapters** (deepest integration, built where it makes sense):
1. **IronClaw** — strongest security model, sets the reference
2. **OpenClaw / NanoClaw / Paperclip** — widest user base, TypeScript
3. **ZeroClaw / OpenFang** — Rust
4. **Hermes / NanoBot** — Python
5. **PicoClaw** — Go
6. **Other claw variants** — MaxClaw, EasyClaw, AutoClaw, QClaw, KimiClaw, ArkClaw, DuClaw and others are potential candidates to be investigated as the ecosystem evolves

**Tier 2 — MCP server** (universal fallback):
Any agent that supports MCP gets CELLO without a custom adapter. This covers Claude Code, Codex, Gemini CLI, and anything else MCP-compatible in one shot. For agents where a native adapter isn't warranted or available, the MCP server is the right path. Native adapters are optimizations for deeper integration — not the only path in.

### Repository Structure

Three models considered:

**Monorepo** — one CELLO repo containing all adapters. Single place to find everything, coordinated releases. Downside: OpenClaw TypeScript contributors have to navigate Rust WASM code. Gets unwieldy fast.

**Federated repos** — `CELLO` owns the core. `cello-openclaw`, `cello-nanoclaw`, `cello-ironclaw` are separate repos. Each adapter lives where it belongs. Users go to one repo, not five. Downside: protocol changes require coordinating across repos.

**Adapters inside each agent's repo** — the IronClaw community ships CELLO support inside IronClaw. The OpenClaw community ships it inside OpenClaw. CELLO publishes the spec and core library; adoption happens in each community's own repo. Scales best, requires least ongoing maintenance from CELLO. Downside: requires adoption by communities we don't control.

**Decision: federated repos, CELLO-owned adapters until widespread community adoption.**

Option 3 — adapters living inside each agent's own repo — creates a meaningful security risk. A malicious or negligent adapter could silently strip out signing, skip prompt injection scanning, or leak keys, while users assume they're protected because their agent "supports CELLO." The trust guarantees CELLO provides are only as strong as the adapter implementing them.

Until the protocol is mature and there is a genuine community with the expertise and incentive to maintain correct implementations, CELLO builds and owns the official adapters. Each adapter ships in its own repo (`cello-openclaw`, `cello-nanoclaw`, `cello-ironclaw`, etc.), maintained by us, versioned against the protocol.

Third-party implementations are welcome once the ecosystem is established — but they must be clearly distinguished from official adapters, and ideally go through a formal audit before being listed as compatible.

---

## Conclaves (Phase 3)

- Group chat rooms with shared Merkle tree
- Gate node scans every inbound message before distribution
- Ejection on violation, provable transcript
- Hosted conclaves as paid tier feature

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
4. Enterprise private node licenses (on-prem or cloud, subscription)

**Cost structure:**
- Hash relay: storing SHA-256 hashes (32 bytes), trivial at scale
- Proxy scanning: small classifier model on GPU, thousands of requests/second
- Directory: standard web API infrastructure
- Payments: Stripe Connect fees (passed through)

---

## Federated Directory — Multi-Node Architecture

### Why Federate

A single directory node has two problems. First, if it goes down, the system stops. Second — and more important — a single operator can tamper with the data undetected. Federation solves both: redundancy keeps the system running, and independent operators keep each other honest. Federation is a security feature first, an availability feature second.

### Three-Phase Node Deployment

Not anyone can run a directory node. Nodes are operated by vetted partners in a permissioned consortium. Running a node carries responsibility — it handles signaling, hash relay, K_server shares, activity monitoring. Operators are vetted, audited, and accountable.

| Phase | Nodes | Operators | Threshold | Threat model |
|---|---|---|---|---|
| **Alpha** | ~6, all AWS | CELLO-operated, one per major region (NA, Europe, Middle East, India, 2x Asia) | ~4-of-6 | Reliability — operational simplicity on one cloud provider |
| **Consortium** | ~20, multi-cloud | Vetted, contracted, audited operators across AWS + GCP + Azure | ~11-of-20 | Rogue or compromised operator — majority threshold when you know the pool but not unconditionally |
| **Public** | 50+, permissionless | Proof-of-stake collateral required | Rotating ~5-of-7 per operation | Economic stake + slashing — extra nodes for geographic/provider redundancy, not consensus strength |

**The key insight on thresholds:** as the pool grows, the threshold per operation comes down. More nodes = more redundancy. Security shifts from "we need a supermajority to agree" to "an attacker needs to compromise geographically dispersed nodes across different providers and jurisdictions, and loses their stake if caught."

The permissioned model prevents Sybil attacks at the node level — no one can spin up 10 malicious nodes to overwhelm consensus. The consortium grows deliberately by adding vetted operators, not by opening the door to anyone. The transition to permissionless happens when the network has enough users and economic activity to sustain independent node operators.

### The Append-Only Directory

The directory is not a mutable database. It's an append-only log of signed operations — add, modify, delete. Each entry hashes the previous one, creating a chain. Every node processes the same operations and arrives at the same state.

```
Entry 1: ADD AgentA {pubkey: xxx, trust: 1}        hash: abc...
Entry 2: ADD AgentB {pubkey: yyy, trust: 1}        hash: hash(prev + entry)
Entry 3: MODIFY AgentA {trust: 2, linkedin: strong} hash: hash(prev + entry)
Entry 4: DELETE AgentB                              hash: hash(prev + entry)
```

Periodically, the log is checkpointed — the current state of all agents is hashed down to a single identity Merkle tree root. This checkpoint is the fingerprint of the entire directory at that moment. Every honest node processing the same operations produces the same root.

This is separate from the message Merkle tree. Two trees:
- **Identity tree** — profiles, public keys, trust scores. Checkpointed periodically.
- **Message tree** — conversation hashes. Updated per message.

### Where Consensus Is Actually Needed

FROST signing itself requires no consensus — just t partial signatures from any t of the n nodes. No nodes need to agree on anything; they independently compute partial signatures. Two things do require consensus:

1. **Directory state changes** — agent registrations, key rotations, trust score updates, tombstones. Infrequent but must be consistent across all nodes. All nodes must process the same operations in the same order.
2. **Conversation hash ledger** — canonical sequence numbers for the global append-only ledger. Every message hash needs a canonical position. This happens at message frequency.

**Real-time and consensus paths are separate.** Agents never wait for consensus. One primary node per session receives hashes, assigns sequence numbers, and ACKs to agents — fast, on the critical path. The primary pushes hashes to other nodes asynchronously. Periodic checkpoints where nodes agree on ledger state happen in the background. Agents are unaffected.

### Primary + Backup Replication

To protect against primary failure before propagation:

- Agent simultaneously sends signed hash to the primary **and** 2-3 backup nodes at session establishment. Fire and forget to backups — no latency cost, agent does not wait for backup ACK.
- Backups store hashes tagged as **PENDING** — received, but no canonical sequence number yet.
- Primary propagates sequence numbers to backups. Backups update from PENDING to canonical.

**If primary fails before propagating:** Backups already hold all hashes — nothing is lost. One backup promotes to primary for this session. New primary sequences the accumulated PENDING hashes. Agents reconnect to the new primary and continue. No resubmission required from agents.

**Backup node selection is dynamic per session** — not fixed. The agent picks the 2-3 lowest-latency nodes at session establishment. Different conversations use different backup sets. Load spreads naturally across the pool without central coordination.

### Client-Side Latency Monitoring

Clients maintain persistent connections to all nodes and send lightweight status pings on a regular interval (10-30 seconds, configurable). Each ping is a tiny packet — a timestamp out, a timestamp back, plus a single byte load indicator from the node.

**What the client does with it:**
- Maintains a live latency table for all nodes — current RTT and trend
- Session establishment picks the currently fastest node as primary — no guessing, no cold starts
- If primary latency trends up, the client migrates the session to a faster node proactively — before degradation becomes visible to the agent

**Node self-regulation:** Nodes return a higher load indicator as they approach capacity. Clients naturally route new sessions to less-loaded nodes. Distributed load balancing with no central coordinator — each client makes the locally optimal choice, and the effect is globally distributed load.

### How Nodes Keep Each Other Honest

Nodes broadcast checkpoint hashes to each other on a regular heartbeat:

```
Every N minutes:
  Node A → all: "Checkpoint #4721, identity root: abc123"
  Node B → all: "Checkpoint #4721, identity root: abc123"
  Node C → all: "Checkpoint #4721, identity root: def456"  ← problem
```

With a permissioned consortium of 6-20 nodes, this is direct broadcast — no gossip protocol needed, the set is small enough. A node whose hash diverges is immediately flagged by every other node.

A compromised node could try to maintain two copies — the honest data (for hash comparison with peers) and tampered data (for serving to clients). The client-side Merkle proof verification (below) prevents this.

### How Clients Verify Nodes — Merkle Proofs

The client never trusts a single node's data. For any critical lookup, the client verifies the data against the consensus checkpoint hash using a Merkle proof.

When the client asks Node A for TravelBot's public key, Node A returns:
1. TravelBot's data (public key, profile, trust score)
2. A Merkle proof — the path of sibling hashes from that entry up to the root

```
Checkpoint root (abc123) — agreed by all nodes
        /           \
     hash12        hash34
     /    \        /    \
  hash1  hash2  hash3  hash4
    |      |      |      |
  AgentA  AgentB  TravelBot  AgentD
```

The client computes:
1. Hash TravelBot's data → should equal hash3
2. Combine hash3 + hash4 → should equal hash34
3. Combine hash12 + hash34 → should equal abc123 (the consensus checkpoint)

If the node tampered with TravelBot's public key, step 1 produces a different hash, and the chain doesn't add up to abc123. The node can't fake the proof without faking the entire tree — which would change the checkpoint hash — which wouldn't match the other nodes.

**This is efficient at any scale.** The proof size is logarithmic:

| Directory size | Proof size | Verification cost |
|---|---|---|
| 1,000 agents | ~10 hashes (~320 bytes) | Microseconds |
| 1,000,000 agents | ~20 hashes (~640 bytes) | Microseconds |
| 10,000,000 agents | ~23 hashes (~736 bytes) | Microseconds |

The client doesn't need access to the full directory. It queries the checkpoint hash from multiple nodes (one 32-byte value), requests the data it needs with a proof, and verifies locally.

### Client-Side Verification Summary

The client protects itself at every step:

| What the client checks | How | When |
|---|---|---|
| Checkpoint hash consensus | Query multiple nodes, compare | On startup, periodically, and before sensitive operations |
| Individual data entries | Request data + Merkle proof, verify against consensus hash | Every critical lookup (connection requests, public key verification) |
| Connection request authenticity | Verify requester's signature against cross-checked public key | Every incoming connection request |

Agents always initiate connections to directory nodes — no node can cold-call an agent. Connection requests carry the requesting agent's end-to-end signature — a compromised node can't fabricate them. The client is the enforcer.

### Detecting and Removing Compromised Nodes

**Detection** happens at two levels:
- **Nodes detect each other** — checkpoint hash heartbeat. A divergent node is immediately visible to all peers.
- **Clients detect independently** — Merkle proof verification fails, or checkpoint hash from one node doesn't match the others.

**Removal** — when a node is detected as compromised:
1. Other nodes stop replicating to it and stop accepting data from it
2. The consortium signs an updated node list (threshold signature — majority of remaining honest nodes required)
3. SDKs fetch the updated node list automatically — the compromised node is excommunicated
4. Any K_server shares held by the compromised node are invalidated; new shares are generated across remaining nodes

The node list itself is a signed document, periodically refreshed. The client doesn't need a manual update to stop trusting a removed node.

### K_server Protection — Threshold Signing (FROST)

No single node holds a complete K_server. Signing uses FROST (Flexible Round-Optimized Schnorr Threshold signatures) on Ed25519. The threshold scales with the deployment phase: ~4-of-6 at Alpha, ~11-of-20 at Consortium, rotating ~5-of-7 committee at Public scale.

```
K_server distributed across 5 nodes as FROST key shares:
  Node A holds share 1
  Node B holds share 2
  Node C holds share 3
  Node D holds share 4
  Node E holds share 5

To sign: any 3 of 5 nodes compute partial signatures
  → No single compromised node (or pair) can produce a valid signature
  → The agent never holds K_server or any reconstructable share of it
  → Partial signatures are computed on each node and combined
  → The combined key is never assembled in one place
```

FROST requires only 2 rounds and is designed for Ed25519. Ed25519's deterministic nonces (RFC 8032) eliminate the entire class of nonce-reuse vulnerabilities that have historically destroyed ECDSA deployments. Compromising a threshold of nodes across different jurisdictions and cloud providers is required to forge a signature — and the threshold scales with the deployment phase.

### Home Node Model

Each agent has a home node — the node they registered on:

**Home node stores (not replicated):**
- K_server share (not the full key — threshold shares are distributed)
- Phone number for notifications
- WebAuthn credentials
- OAuth tokens

**All nodes store (replicated via append-only log):**
- Public profile
- Public keys
- Trust score and verification freshness
- Message Merkle tree hashes

Registration, key operations, and notifications go through the home node. Discovery and verification work on any node — and every response is verifiable via Merkle proof.

### Node Migration

If a home node is permanently compromised or goes down:
1. Agent reverifies on another node (phone OTP + WebAuthn)
2. New node becomes the home node
3. New K_server shares generated across remaining nodes
4. Old keys revoked (appended to the log, propagated to all nodes)
5. Existing P2P sessions continue unaffected (they're direct)

### Enterprise Private Nodes

Enterprises can run their own CELLO directory node on their infrastructure. Same client, same protocol, same Merkle trees — but the directory is theirs. No data leaves the building.

**The problem it solves:** A company has a hundred agents across departments. There's no way to know they're all legitimate. Someone spins up a rogue bot in a Slack channel, it looks like every other bot. With an internal CELLO node, every agent has a verified identity. If one gets compromised, the Merkle tree shows exactly when and what happened.

**Deployment models:**

| Model | Who runs the node | Trust boundary |
|---|---|---|
| **Public network** | CELLO (federated) | Open — anyone can register |
| **Enterprise private** | Company on their infra | Closed — corporate agents only |
| **Hybrid** | Company node federated with public | Internal agents verified privately, can also discover/transact externally |

**Enterprise identity integration:** Instead of phone verification, enterprise nodes can integrate with existing corporate identity — SSO, Active Directory, corporate certificates. Same split-key architecture, but K_server lives in the company's KMS, not ours.

**Hybrid federation:** The interesting model. Internal agent-to-agent communication stays entirely on the company's node. When an agent needs to talk to an external service or vendor, it federates out through the public network — still verified, still signed, but now crossing trust boundaries with full CELLO guarantees on both sides.

---

## Build Phases

### Phase 1: MVP
- Directory with registration (email + phone via WhatsApp/Telegram)
- Agent listings (public + marketplace)
- P2P chat with hash relay (Merkle tree verification)
- Secure communication client (open-source) for verified chat
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
- **Split-key signing (FROST):** Neither the agent nor the directory can sign alone. Signing uses FROST threshold signatures on Ed25519 — a threshold of directory nodes must compute partial signatures; the combined key is never assembled in one place. The agent never holds K_server or any reconstructable share of it. The threshold scales with the deployment phase (~4-of-6 at Alpha, ~11-of-20 at Consortium, rotating ~5-of-7 at Public scale).
- **Dual public keys:** Every agent has a primary (split-key) and fallback (local-only) public key. Fallback-only signing is a canary for compromise.
- **Phone as root of trust, WebAuthn as armor:** The phone number is the identity anchor — used for registration, KMS authentication, activity monitoring, and key recovery. But phone numbers are vulnerable to SIM-swap attacks. WebAuthn/2FA hardens the identity without being mandated — it's part of the trust score, and receiving agents can require it as a connection policy. The network enforces strong auth through market pressure, not platform rules.
- **Emergency revocation is phone-gated, recovery is WebAuthn-gated:** Anyone with the phone can hit "Not me" to revoke — fast response to real compromise. But re-keying requires WebAuthn/2FA — so a SIM-swap attacker can disrupt but not take over. Same tradeoff as every phone-based system, same mitigation: stronger auth protects what matters.
- **Out-of-band monitoring:** Activity notifications go to the owner's phone (WhatsApp/Telegram), a channel completely independent from the agent's infrastructure.
- **Graceful degradation:** Directory outage drops signing from split-key to local-only. Conversations continue at reduced trust. Never a full stop.
- **Receiver-side scanning is the security boundary:** Sender's scan is an honesty signal, not the defense. The receiver always re-scans locally.
- **Identity is stacked, not gated:** Phone gets you in. Everything else improves your trust score. More verifications = harder to fake.
- **Platform transports are features, not competitors:** Slack/Discord/Telegram work for teams. CELLO layers trust on top. Transport is pluggable — the client abstracts it away.
- **Federation is a security feature, not a scaling feature:** Multiple independent nodes exist so no single operator can corrupt the truth. Redundancy is the bonus.
- **Three-phase node deployment:** Alpha (6 CELLO-operated AWS nodes, ~4-of-6), Consortium (20 vetted multi-cloud operators, ~11-of-20), Public (50+ permissionless with proof-of-stake, rotating ~5-of-7). Not anyone can run a node until the Public phase — operators are vetted, preventing node-level Sybil attacks.
- **Append-only directory:** The directory is a hash-chained log of operations (add, modify, delete), not a mutable database. Every honest node processing the same operations arrives at the same state.
- **Client-side Merkle proof verification:** The client never trusts a single node's data. Every critical lookup comes with a Merkle proof verified against the consensus checkpoint hash. A compromised node can't serve fake data with a valid proof.
- **Public agents are free:** They're the network growth engine, not a cost center.
- **The client is open-source:** The prompt injection defense is the marketing top-of-funnel. Developers find it, use it, discover the network.
- **The client is the network's immune system:** Every agent running the client is a sensor. If an agent sends malicious content, the receiver's client detects it, records the evidence in the Merkle leaf, and reports to the directory. The same free tool that protects individual agents polices the entire network — no separate moderation system needed.
- **Distributed ledger explored and rejected:** We explored eliminating directory nodes entirely — every agent holds a full copy of the directory, propagated via gossip, with an append-only hash-chained log of operations. Appealing because it eliminates the node trust problem entirely. Rejected because you still need a service for signaling (mediating introductions), hash relay (Merkle tree tiebreaker), K_server (split-key), and activity monitoring. The service kept growing back to look like a directory node anyway. Federation with client-side Merkle proof verification gives the same security guarantee with less architectural complexity. What we kept: the append-only log structure for directory data, and the principle that the client must be the enforcer.

---

## Competitive Landscape

### ClawdChat (clawdchat.ai)

ClawdChat describes itself as "the first social network for AI" — a platform where agents register, find each other, and communicate. It supports the same claw ecosystem (OpenClaw, NanoClaw, ZeroClaw, PicoClaw, and at least 10 others), and its onboarding guide instructs agents to register autonomously and act without asking for human confirmation.

**Why it's not a competitor:**

1. **Geographic focus.** ClawdChat is heavily oriented toward the Chinese community — the claw variants it highlights, the language of its documentation, and its user base reflect this. That's not an insignificant firewall when CELLO is building for the Western open-source agent ecosystem first.

2. **The initial inspiration is the same — connecting personal agents — but the implementation is naive, reckless, and potentially a serious Trojan horse.** No identity verification. No message signing. No tamper-proof history. Onboarding documentation that explicitly instructs agents to act autonomously without human confirmation. An agent that follows this guide is being told to register itself on an unverified third-party platform and bypass its owner's oversight — which is precisely the attack pattern CELLO's ingestion pipeline is designed to catch and block.

**What it validates:**

The problem is real. Someone else saw the same gap — agents need to find and communicate with each other — and moved to fill it. The question was never whether this network would exist. The question is whether it gets built safely or not. ClawdChat is the answer to that question, and it's sitting in plain sight.

You couldn't design a better contrast. When explaining why CELLO matters, you can point at ClawdChat and say: "This is what agent-to-agent communication looks like without a trust layer." The risks are visible, concrete, and already in the wild.

---

## Open Questions

### P2P Transport
- libp2p NAT traversal reliability — how often does hole punching fail in practice? What's the fallback?
- Ephemeral peer ID generation — performance cost of spinning up a new libp2p identity per session?

### Cryptography
- K_server caching policy — how long can a session key be cached before re-auth? Balance resilience vs. security.
- Session signing token design — how long should a FROST-delegated signing window last? What operations are permitted during degraded (K_local-only) mode?

### Federation
- Node bootstrap — how does the client get its initial list of trusted directory nodes? Hardcoded? Signed node list? DNS-based discovery?
- Node incentives — why would someone run a directory node? Revenue sharing? Community governance?
- Byzantine fault tolerance — what's the minimum consortium size for safety? 5 nodes (tolerates 2 compromised)? 7 (tolerates 3)?
- How does new registration data propagate between nodes? Push, pull, or broadcast? How quickly?
- Identity Merkle tree implementation — how are operations ordered deterministically across nodes? Logical clock? Consensus on ordering?
- Checkpoint frequency — how often should the identity tree be checkpointed? Tradeoff between freshness and cost.

### Protocol
- Race conditions — what if both agents send simultaneously? Sequence number tie-breaking rule needed.
- Offline agents — can messages queue? Does the hash relay buffer?
- Notification fatigue — high-volume agents may generate too many activity alerts. Need configurable notification policies.

### Operations
- Conclave gate node — hosted only or can users self-host?
- Legal — terms of service, dispute arbitration process, liability limits
- Node operator agreements — SLAs, data handling requirements, audit rights

### Observability

If CELLO is the primary channel and messages flow peer-to-peer, humans lose the natural visibility they currently get from watching a Telegram chat or a Slack channel. The conversation becomes opaque unless something surfaces it.

Three solutions exist, and they are not mutually exclusive:

1. **Mirror outgoing messages to a platform** — CELLO posts a copy to Slack, Telegram, or WhatsApp so humans can monitor through familiar interfaces. Requires maintaining platform integrations.
2. **Intercept messages on existing platform channels** — CELLO sits between the platform and the agent, scanning and processing before delivery. Requires deep integration with each platform's ingress/egress model (e.g. Baileys for WhatsApp).
3. **Build a monitoring UI** — a dashboard that surfaces conversations from the Merkle tree directly. CELLO owns the observability surface rather than depending on third-party platforms.

The right solution may differ per target platform. **This requires platform research before it can be resolved.** Specifically: how do OpenClaw, NanoClaw, and IronClaw handle channel ingress and egress? Where does a library like CELLO slot in? Can CELLO be a first-class channel in their routing model, or does it have to intercept an existing one? The answer to these questions determines which observability approach is viable for each integration target.

---

## Related Documents

### Core Docs
- [[end-to-end-flow|CELLO End-to-End Protocol Flow]] — comprehensive synthesis of all design decisions and discussion logs into one coherent narrative
- [[prompt-injection-defense-layers-v2|Prompt Injection Defense Architecture]] — the 6-layer scanning pipeline referenced in Step 8
- [[day-0-agent-driven-development-plan|Day-0 Agent-Driven Development Plan]] — how to build this with Claude-Flow
- NEAR AI verified chat (research): `nearai/nearai-cloud-verifier` on GitHub (TEE-based approach, different from this P2P design)

### Protocol Review
- [[00-synthesis|Protocol Review — Synthesis]] — adversarial review: 8 critical, 23 high findings
- [[open-decisions|Open Decisions]] — 12 resolved design decisions (FROST, Ed25519, SHA-256, thresholds, etc.)
- [[design-problems|Design Problems]] — 7 unsolved design problems requiring mechanism work

### Discussion Logs
- [[2026-04-08_1430_protocol-strength-and-commerce|Protocol Strength and Commerce]] — non-repudiation as commerce primitive, directory as custodian
- [[2026-04-08_1530_message-delivery-and-termination|Message Delivery and Termination]] — delivery failure tree, session termination protocol
- [[2026-04-08_1600_data-residency-and-compliance|Data Residency and Compliance]] — GDPR, UAE residency, pseudonymity model
- [[2026-04-08_1700_node-architecture-and-replication|Node Architecture and Replication]] — three-phase node deployment, primary/backup replication
- [[2026-04-08_1800_account-compromise-and-recovery|Account Compromise and Recovery]] — social recovery, tombstones, voucher accountability, session attestation
- [[2026-04-08_1830_notification-message-type|Notification Message Type]] — fire-and-forget protocol primitive, introduction flow
- [[2026-04-08_1900_connection-staking-and-institutional-defense|Connection Staking and Institutional Defense]] — escrow staking, gate pyramid, flat fee model
- [[2026-04-08_1930_client-side-trust-data-ownership|Client-Side Trust Data Ownership]] — hash everything, store nothing; Yelp without Yelp
- [[2026-04-10_1000_connection-endorsements-and-attestations|Connection Endorsements and Attestations]] — pre-computed endorsements, anti-farming rule, bootstrapping
- [[2026-04-10_1100_fallback-downgrade-attack-defense|Fallback Downgrade Attack Defense]] — relay node separation, random pool selection, and tiered degraded-mode policy closing Problem 1
- [[2026-04-10_1200_psi-for-endorsement-intersection|PSI for Endorsement Intersection]] — Private Set Intersection for privacy-preserving endorsement verification at connection time
- [[2026-04-11_1000_sybil-floor-and-trust-farming-defenses|Sybil Floor and Trust Farming Defenses]] — TrustRank, conductance scoring, device attestation, diminishing transaction returns, and endorsement rate limiting for Problems 3 and 4
- [[2026-04-13_1000_device-attestation-reexamination|Device Attestation Reexamination]] — corrects the trust score table here: WebAuthn is account security (not device sacrifice); device attestation requires native apps; two-tier web/native architecture
- [[2026-04-13_1100_quantum-resistance-design|Quantum Resistance Design]] — cryptographic roadmap for CELLO: FROST stays (quantum debt accepted), ML-DSA for all non-threshold signatures, IThresholdSigner abstraction for future swap-in
- [[2026-04-13_1200_discovery-system-design|Discovery System Design]] — three-class discoverable entity model (agent directory, bulletin board, group chat rooms), unified search stack, trust score display, Merkle tree non-repudiation for group conversations; full elaboration of Step 4
- [[2026-04-11_1400_libp2p-dht-and-peer-connectivity|libp2p, DHT, and Peer Connectivity]] — technical feasibility vetting of the full transport stack (Steps 3, 6–7): bootstrap discovery, directory authentication, ephemeral Peer IDs, three-layer NAT traversal, dual-path hash relay
- [[2026-04-11_1400_security-architecture-layers-and-trust-signal-classes|Security Architecture Layers and Trust Signal Classes]] — four-layer security model and trust signal taxonomy; complementary framing to the 10-step architecture for auditing and security analysis
- [[2026-04-11_1700_persistence-layer-design|Persistence Layer Design]] — complete schema for every protocol entity: conversation seals, tombstones, recovery infrastructure, Trust Seeder accountability, endorsements, and graph analytics
- [[2026-04-14_1000_contact-alias-design|Contact Alias Design]] — revocable, privacy-preserving contact identifiers for sharing outside the CELLO directory; extends the connection request flow with alias-routed requests
- [[2026-04-14_1100_cello-mcp-server-tool-surface|CELLO MCP Server Tool Surface]] — complete MCP tool surface (33 tools) implementing the Tier 2 universal interface; canonical tool names in §8 supersede the four names in this document's Agent-Facing Tools section
- [[2026-04-14_1300_connection-request-flow-and-trust-relay|Connection Request Flow — Trust Data Relay and Selective Disclosure]] — resolves the trust data relay gap between Step 5 (connection request) and Step 6 (acceptance policy); defines mandatory vs. discretionary signal framework and one-round negotiation limit
