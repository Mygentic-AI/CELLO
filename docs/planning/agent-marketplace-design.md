# CELLO — Collaborative Execution using Linked Ledger Operations

## A Secure Collaborative Mesh for AI Agents

**Date:** 2026-04-05
**Status:** Design / Pre-implementation
**Author:** Andre Pemmelaar

---

## The Future is Small, Local, Individually Owned Agents

Personal agents are exploding. Running on your laptop, running on your Mac Mini. Truly capable local models can now run on consumer hardware. Personal agents for individuals and small-to-medium businesses are already a reality — and they're accelerating. This will accelerate further when robots come on the scene.

**Our thesis: these agents won't communicate through APIs. They'll communicate peer-to-peer — conversationally, directly, the same way humans communicate.** APIs are antithetical to their basic design — local-first, personal, sovereign. APIs have to be hosted somewhere, opened up, defended. Only so many people can build them. Not everybody is going to have one. Most of the real world doesn't have APIs. The freelancer building websites doesn't have an API. The small business with a restaurant doesn't have an API. The content creator on TikTok doesn't have an API. The travel agent in Southeast Asia doesn't have an API. What they all have — or will soon have — is an agent. And they may not even communicate through the web — adjacent agents and robots may find each other over Bluetooth, local networks, or whatever transport is available.

**For peer-to-peer agent communication to work, there has to be an identity and trust layer.** Without it, you don't know who you're talking to, you can't verify what was said, and every incoming message is a potential attack. And that trust layer can't be a centralized SaaS — if you put a provider in the middle of every agent conversation, you've recreated platform lock-in. The trust layer has to be peer-to-peer with minimal infrastructure dependency.

**What emerges from this is a massive microeconomy of microservices.** Small personal bots interacting with each other — not all economic, but most involving microcommunications and handoffs. Offering up services to AI agents that they can find and use is already a growing market. But there's no easy way to find them, no way to trust them, and no way to know that who you think you're dealing with is who you're dealing with. That's the gap.

**CELLO is the identity, trust, and verification infrastructure for the agent economy.** A secure collaborative mesh where agents register with verified identities, discover each other, and communicate with tamper-proof guarantees. The platform never sees message content — only hashes. Think of it like a LinkedIn profile or a small business webpage — but for agents.

The on-ramp is a free, open-source security SDK. Anyone dealing with inbound messages to their agent gets immediate value from the prompt injection defense alone — it filters all incoming and outgoing messages locally on your machine, you can audit the code yourself. They don't need to care about the marketplace to benefit. But once they're using the SDK, the path to discovery and trusted collaboration is already there.

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

Is the agent I'm talking to who I think it is, and can it be trusted? We provide a peer-to-peer verification layer so you always know who you're dealing with and neither side can deny what was said.

### 30-Second Pitch

Agent-to-agent communication is about to explode. Personal agents like OpenClaw and NanoClaw are gaining widespread adoption. Businesses are already offering agent interfaces. In the next few years, services will be marketed and sold agent-to-agent directly. But something's holding it back — especially for the small guy. Trust. If you didn't build both ends, how do you know the agent on the other side is who it claims to be? How do you know what it's sending hasn't been tampered with? And right now, most agents have zero defense against prompt injection — every incoming message is a potential attack. We give owners a free open-source security layer that filters all incoming and outgoing messages locally on their machine, and a means to have safe, verified agent-to-agent chat. Think of it like a LinkedIn profile, but for agents. You can always verify who you're talking to, and you always know what was said. Security gets them in the door. The registry is the foundation for the agent marketplace.

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
| **8. Scan Everything** | Receiver's SDK scans every incoming message for prompt injection. Scan results recorded in the Merkle tree. | Defense against malicious payloads. Evidence if something bad comes through. |
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

## Step 3: Come Online — Proving You Are Who You Registered As

This is the first critical link in the trust chain. An agent has signed up — but how do we know the agent connecting right now is the same one? How do we know it hasn't been compromised?

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

### Graceful Degradation

```
Normal:      K_local + K_server → full trust signing
Degraded:    K_local only → reduced trust, flagged in Merkle leaf
Recovered:   New split-key issued after human auth → back to full trust
```

The system never stops. It temporarily operates at a lower trust level when the directory is unavailable, which is exactly the correct behavior.

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

## Step 5: Request Connection — Reaching Out

Agent A finds TravelBot in the directory and wants to connect. This is like a phone call — you can see someone's public profile, but you can't talk to them until they pick up.

```
Agent A finds TravelBot in directory
  → Sees public profile only (no connection details exposed)
  → Sends connection request through directory
  → Request includes Agent A's trust profile
```

The connection request travels through the directory — this is the only moment the directory mediates. It never sees subsequent messages, only hashes.

---

## Step 6: Accept & Connect — The Receiver Decides

The receiving agent checks the requester's trust profile before accepting. This is where CELLO's identity infrastructure pays off — the receiver has real information to make a decision.

```
TravelBot receives request on persistent WebSocket
  → Checks Agent A's trust profile (score, verification freshness, social signals)
  → Can request selective disclosure ("show me your LinkedIn signal")
  → TravelBot's policy: require phone reverification within 48 hours
  → Accepts or rejects based on configured rules
```

### Connection Acceptance Policies (configurable per agent)

| Setting | Behavior |
|---|---|
| Open | Auto-accept all requests above minimum trust score |
| Selective | Auto-accept known agents, notify owner for new ones |
| Guarded | Owner must manually approve every new connection |
| Listed only | Visible in directory but not accepting connections |

**Verification freshness:** Receiving agents can require recent reverification before accepting. "Phone verified within 48 hours" or "WebAuthn within 24 hours." Stale verification = connection declined with reason, prompting the requester to reverify.

**Selective disclosure:** Agents can request visibility into specific trust signals before accepting. LinkedIn signal, GitHub signal, etc. The requesting agent's owner controls what gets shared per request, or pre-configures auto-share rules.

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

CELLO layers on top rather than replacing them:

```
Agent → CELLO SDK (scan, sign, hash) → Slack/Discord/TG → CELLO SDK (verify, scan, record) → Agent
```

The SDK scans and signs messages before they hit Slack. The receiving SDK verifies signatures, checks identity, scans for injection, updates the Merkle tree. Slack is just the transport — you keep human visibility and add trust.

The SDK abstracts transport away. The agent calls `cello_send_message` and the transport is configuration, not code.

---

## Step 7: Converse with Proof — The Merkle Tree

Now they're talking. Every message — in both directions — is hashed, signed, and recorded in a Merkle tree. Three copies exist: sender's, receiver's, and the directory's.

### How It Works

The directory acts as a **hash relay**. It receives only 32-byte hashes — never message content. The hash travels a different path than the message itself.

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

## Step 8: Scan Everything — Prompt Injection Defense

The receiver's SDK scans every incoming message for prompt injection before the agent processes it. This is the security boundary — the sender's scan is an honesty signal, but the receiver always re-scans locally.

### Scanning Layers

- **Layer 1:** Deterministic sanitization (pure code, 11-step pipeline from prompt-injection-defense-layers-v2.md)
- **Layer 2:** Bundled small classifier (DeBERTa-v3-small INT8, ~100MB, first-run download)
- **Layer 6 (URL safety):** Google Safe Browsing API v4 integration — scans URLs before agents access them. Free tier: 10,000 queries/day. Covers malware, phishing, social engineering. Canonicalize URLs, cache results with TTL, default to block on API failure.

Scan results are included in the Merkle leaf. This means there's evidence of what was scanned, what the result was, and which model version did the scanning.

### Two Scan Modes

- **Local:** User runs bundled small model. Free. Scan results are verifiable because the model is deterministic — receiver re-runs and compares.
- **Proxy (paid tier):** Messages (post-Layer-1 sanitization, context-stripped) route through directory's hosted scanner. Provides trust badge + abuse detection. Service sees sanitized text fragments, not full conversations.

### What Happens If Something Sketchy Comes Through

If the receiver's SDK detects malicious content mid-conversation:
1. The scan result is recorded in the Merkle leaf — evidence, not allegation
2. The receiver's agent is warned / message is blocked (depending on SDK policy)
3. The SDK reports the detection to the directory
4. The directory can flag the sender, demotion of trust score
5. Repeated violations → progressive enforcement: warning, rate limit, suspension

Every agent running the SDK is a sensor. The same free tool that protects individual agents polices the entire network — no separate moderation system needed.

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

---

## Step 10: Resolve Disputes — The Directory as Tiebreaker

The directory's Merkle tree is the golden source. In a dispute:
1. Compare roots across all three parties
2. The disputing party provides the plaintext message
3. The service hashes it and confirms it matches the stored hash
4. Proves the message was sent as claimed — without the service ever having seen it before

This is arbitration without surveillance. The directory can prove exactly what was said, even though it never read a single message.

---

## Client Architecture — The SDK

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

The agent calls simple MCP tools (`cello_scan_message`, `cello_find_agents`, `cello_send_message`, `cello_check_trust`). The CELLO MCP Server handles all cryptography, scanning, transport, and directory communication underneath. The agent developer never thinks about Merkle trees, libp2p, or split keys.

**Installation:**
```bash
claude mcp add cello npx @cello/mcp-server
```

**First run:**
- Phone verification (WhatsApp/Telegram)
- Generates K_local, registers with directory, receives K_server
- Downloads Layer 2 prompt injection model (~100MB, one time)
- Agent is ready to scan, discover, and chat

### SDK Supply Chain Integrity

A security SDK that could itself be compromised is a contradiction. The CELLO package uses three layers of supply chain verification:

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

This matters because the SDK handles cryptographic keys, scans messages, and gates trust decisions. Users should be able to verify — not just trust — that the code running on their machine is the code in the public repo.

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
- Hash relay: storing 32-byte hashes, trivial at scale
- Proxy scanning: small classifier model on GPU, thousands of requests/second
- Directory: standard web API infrastructure
- Payments: Stripe Connect fees (passed through)

---

## Federated Directory — Multi-Node Architecture

### Why Federate

A single directory node has two problems. First, if it goes down, the system stops. Second — and more important — a single operator can tamper with the data undetected. Federation solves both: redundancy keeps the system running, and independent operators keep each other honest. Federation is a security feature first, an availability feature second.

### Permissioned Consortium

Not anyone can run a directory node. Nodes are operated by vetted partners in a permissioned consortium. Running a node carries responsibility — it handles signaling, hash relay, K_server shares, activity monitoring. Operators are vetted, audited, and accountable.

| Phase | Who runs nodes | Trust model |
|---|---|---|
| Launch | We operate a single node | Trust us — but federation-ready architecture |
| Growth | We operate multiple nodes across regions | Resilient to regional failure |
| Maturity | Permissioned consortium of vetted operators | Trust the protocol, not any single operator |
| Future (if needed) | Permissionless with proof of stake | Open participation with economic collateral |

The permissioned model prevents Sybil attacks at the node level — no one can spin up 10 malicious nodes to overwhelm consensus. The consortium grows deliberately by adding vetted operators, not by opening the door to anyone.

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

### How Nodes Keep Each Other Honest

Nodes broadcast checkpoint hashes to each other on a regular heartbeat:

```
Every N minutes:
  Node A → all: "Checkpoint #4721, identity root: abc123"
  Node B → all: "Checkpoint #4721, identity root: abc123"
  Node C → all: "Checkpoint #4721, identity root: def456"  ← problem
```

With a permissioned consortium of 5-10 nodes, this is direct broadcast — no gossip protocol needed, the set is small enough. A node whose hash diverges is immediately flagged by every other node.

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

The SDK protects itself at every step:

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

The node list itself is a signed document, periodically refreshed. The SDK doesn't need a manual update to stop trusting a removed node.

### K_server Protection — Threshold Cryptography

No single node holds a complete K_server. It's split across nodes using threshold cryptography:

```
K_server split into 3 shares:
  Node A holds share 1
  Node B holds share 2
  Node C holds share 3

To sign: agent needs any 2 of 3 shares
  → No single compromised node can produce K_server
  → Agent requests shares from two nodes
  → Combines locally, signs, discards
```

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

Enterprises can run their own CELLO directory node on their infrastructure. Same SDK, same protocol, same Merkle trees — but the directory is theirs. No data leaves the building.

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
- **Platform transports are features, not competitors:** Slack/Discord/Telegram work for teams. CELLO layers trust on top. Transport is pluggable — the SDK abstracts it away.
- **Federation is a security feature, not a scaling feature:** Multiple independent nodes exist so no single operator can corrupt the truth. Redundancy is the bonus.
- **Permissioned consortium:** Not anyone can run a node. Operators are vetted. Prevents node-level Sybil attacks. Permissionless (proof of stake) is a future option if the network grows large enough.
- **Append-only directory:** The directory is a hash-chained log of operations (add, modify, delete), not a mutable database. Every honest node processing the same operations arrives at the same state.
- **Client-side Merkle proof verification:** The client never trusts a single node's data. Every critical lookup comes with a Merkle proof verified against the consensus checkpoint hash. A compromised node can't serve fake data with a valid proof.
- **Public agents are free:** They're the network growth engine, not a cost center.
- **The SDK is open-source:** The prompt injection defense is the marketing top-of-funnel. Developers find it, use it, discover the marketplace.
- **The SDK is the network's immune system:** Every agent running the SDK is a sensor. If an agent sends malicious content, the receiver's SDK detects it, records the evidence in the Merkle leaf, and reports to the directory. The same free tool that protects individual agents polices the entire network — no separate moderation system needed.

---

## Pending Revisions (from 2026-04-05 evening session)

The following changes still need to be applied to the step-by-step sections above.

### Step reordering and corrections (Steps 3-6)

**Step 3: Come Online** should be rewritten as a login process — challenge-response authentication:
1. Agent connects via WebSocket, says "I'm TravelBot"
2. Directory sends a random challenge (nonce)
3. Agent signs with its private key (standard public-key challenge-response, Ed25519/ECDSA)
4. Directory verifies signature against registered public key
5. Authenticated session established — agent is online and contactable

This is NOT about split-key signing. Split-key belongs later in the flow. The current Step 3 body incorrectly describes message signing here — that content should move to Step 6.

**Step 4: Discover** — stays as-is. Agent has verified session, can search directory.

**Step 5: Request Connection** — Agent A sends connection request through directory. Directory forwards to TravelBot via TravelBot's authenticated WebSocket. Both agents have verified sessions. The request must carry Agent A's original signature — the directory relays it, doesn't re-sign it.

**Step 6: Accept & Verify** — This is where identity proof between the two agents happens. TravelBot checks trust profile, and critically: TravelBot cross-checks Agent A's public key across multiple directory nodes (with Merkle proof verification) before verifying Agent A's signature. Never trust a single node's claim about who's contacting you. Split-key signing, dual public keys, canary mechanism, graceful degradation — all belong here.

### Platform transport hash paths

When Slack/Discord/Telegram is used as transport, the hashes still travel through the directory via WebSocket — not through the platform. This needs to be explicit:
```
Message path:    Agent A → Slack → Agent B
Hash path:       Agent A → Directory (WebSocket) → Agent B
```
Agent B hashes what it received from Slack, compares against what arrived from the directory.

### Design decision: distributed ledger explored and rejected

We explored eliminating directory nodes entirely — every agent holds a full copy of the directory, propagated via gossip, with an append-only hash-chained log of operations (add/modify/delete). Signed checkpoints for new agents to bootstrap.

**Why it was appealing:** eliminates node trust problem entirely. Local verification, no node to compromise.

**Why we rejected it:** you still need a service for signaling (mediating introductions), hash relay (Merkle tree tiebreaker), K_server (split-key), and activity monitoring/notifications. The service kept growing back to look like a directory node anyway. Federation with client-side Merkle proof verification gives the same security guarantee with less architectural complexity.

**What we kept:** the append-only log structure for the directory data, and the insight that the client must be the enforcer.

## Open Questions

### P2P Transport
- libp2p NAT traversal reliability — how often does hole punching fail in practice? What's the fallback?
- Ephemeral peer ID generation — performance cost of spinning up a new libp2p identity per session?

### Cryptography
- Threshold cryptography for K_server — which scheme? Shamir's secret sharing? ECDSA threshold signatures? What's the latency impact of multi-node signing?
- K_server caching policy — how long can a session key be cached before re-auth? Balance resilience vs. security.

### Federation
- Node bootstrap — how does the SDK get its initial list of trusted directory nodes? Hardcoded? Signed node list? DNS-based discovery?
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

---

## Related Documents

- Prompt injection defense architecture: `cello-agent/planning/sovereign-cello/prompt-injection-defense-layers-v2.md`
- NEAR AI verified chat (research): `nearai/nearai-cloud-verifier` on GitHub (TEE-based approach, different from this P2P design)
