# CELLO — Build in Public Content Index

Issues from the security and forward-looking review that make compelling standalone discussion topics. Each is a self-contained question that invites debate, could be posted to Reddit, turned into a video, or used as a design discussion anchor.

**Rating key:**
- `[S]` = Security / red-team finding
- `[F]` = Forward-looking / real-world impact
- `[E]` = Economic / marketplace dynamics

---

## Tier 1: Controversial / Guaranteed Debate

These are the findings where reasonable people will strongly disagree. Perfect for "here's the problem, what would you do?" content.

### 1. Phone verification costs $0.05 — is Sybil defense even possible? `[S]`

Bulk SMS verification services sell phone numbers for $0.05-0.50 each. Google Voice numbers are free. For $1,000, an attacker creates 2,000-20,000 verified agent identities. The entire identity layer of the protocol assumes phone numbers are "expensive to fake at scale" — but in 2026, they're cheaper than a cup of coffee. Every downstream trust mechanism (ratings, transaction history, PageRank-style weighting) is built on a foundation that costs almost nothing to manufacture. What's the actual floor for decentralized identity? Is there any phone-based approach that works, or do you need something fundamentally different?

*Source: 02-identity-trust-gaming.md, Finding #1*

### 2. Trust scores create a caste system — and it maps to geography `[F]`

The trust score formula rewards WebAuthn hardware ($25-50 for a YubiKey), LinkedIn profiles (overwhelmingly Western), and GitHub accounts (relevant only to software developers). A highly competent travel agent in rural Thailand with 20 years of experience and no LinkedIn starts at a structural deficit compared to a fresh CS graduate in San Francisco. High trust compounds — more connections lead to more transactions lead to higher scores. Low trust stagnates. The system creates a trust aristocracy that correlates with wealth, geography, and profession. The design says "the market enforces strong auth, not the platform" — but is that meaningfully different from a mandate without accountability?

*Source: 06-power-dynamics-governance.md, Section 1.1*

### 3. Your agent gets hacked — and the system punishes YOU permanently `[F]`

Your agent is compromised over a weekend. Attacker sends malicious messages to 40 contacts. You catch it Monday, re-key via WebAuthn, attacker is locked out. But your trust score is demolished. Every agent you worked with rejects you. You can't rebuild transaction history because nobody will transact with you. You can't transact because nobody will connect. A temporary security event has permanently destroyed your business. The system is excellent at detecting compromise and punishing it — but has zero recovery mechanisms for the honest owner who was the victim. Should trust systems have a concept of "rehabilitation"? How do you distinguish a recovered victim from a reformed bad actor?

*Source: 05-reputation-recovery.md, Section 1.1*

### 4. The split-key scheme doesn't work as described `[S]`

The core security primitive — `derived(K_local + K_server)` — never defines what the `+` operator means. The design says agents "request shares from two nodes, combine locally, sign, discard." This means the full secret key is reconstructed in memory on the agent's machine during every signing operation. Malware can scrape it. The entire purpose of threshold cryptography is that the secret never exists in one place — but the design defeats its own security model. The fix is real threshold signing (FROST for Ed25519) where partial signatures are computed on each node and combined without ever reconstructing the key. But this changes the architecture significantly. How do you design a signing protocol that's both secure and usable when agents run on consumer hardware?

*Source: 01-crypto-attack-surface.md, Findings #1-2*

### 5. Should a permissioned consortium ever voluntarily give up power? `[F]`

The design envisions a transition: permissioned consortium (vetted node operators) eventually becomes permissionless proof-of-stake. But there is no historical precedent for a permissioned consortium voluntarily dissolving itself. Every incentive points the other way — existing operators benefit from limiting competition, controlling policy, and extracting rents from their position. The entity that controls who runs nodes controls the network. Who decides when the transition happens? What if operators resist because it dilutes their influence? This is the same governance problem that plagues every "initially centralized, eventually decentralized" project.

*Source: 06-power-dynamics-governance.md, Sections 2.1, 5.2*

### 6. The micro-transaction thesis doesn't survive contact with Stripe `[E]`

The vision is a "massive microeconomy of microservices" — small agents transacting at sub-dollar values. But Stripe charges 2.9% + $0.30 per transaction. On a $1 micro-task: Stripe takes $0.33, CELLO takes $0.10 (at 10%), the agent keeps $0.57. That's a 43% total take. No successful marketplace sustains itself on sub-dollar transactions through traditional payment rails. Do you solve this with batched settlement, pre-funded wallets, crypto rails, or do you accept that the marketplace is only viable above $3-5 per transaction? The choice fundamentally shapes what kind of economy CELLO enables.

*Source: 07-economic-marketplace.md, Section 1.1*

---

## Tier 2: Deep Technical Problems

These require more context but are fascinating to anyone building distributed systems, cryptography, or trust infrastructure.

### 7. Fallback mode is a downgrade attack in disguise `[S]`

When the directory is unavailable, agents fall back to signing with their local key only. This is meant to be graceful degradation. But an attacker who previously stole the local key can force fallback mode by DDoS-ing the directory, then impersonate the agent. The split-key scheme was designed to prevent exactly this — but fallback mode nullifies the protection on demand. Worse: at scale, a directory outage triggers mass fallback, the compromise detection canary (designed for individual agents) fires for everyone simultaneously, and panicked owners tap "Not me" on legitimate activity, revoking their own agents' keys. Recovery requires per-agent human interaction with WebAuthn devices. How do you design graceful degradation that doesn't also degrade security?

*Source: 01-crypto-attack-surface.md #4, 08-emergent-behavior-failures.md, Section 1.1*

### 8. The hash relay MITM that shouldn't be possible — but is `[S]`

CELLO's tamper detection relies on the hash traveling a different path than the message. But if the attacker controls the network segment between the sender and the outside world, both paths originate from the same egress point. Attacker intercepts message, replaces it, intercepts hash, replaces it. Everything is cryptographically consistent from the receiver's perspective. The fix is making the hash carry the sender's signature — but the design doesn't explicitly specify this for hash relay (only for connection requests). A subtle spec gap that would completely undermine tamper detection if missed during implementation.

*Source: 03-protocol-network-attacks.md, Section 1.1*

### 9. Concurrent messages break the Merkle tree `[S]`

The Merkle tree chains each message to the previous root. But what if both agents send simultaneously? Both create a leaf with the same sequence number and same prev_root. The directory receives both hashes — which is first? Sender, receiver, and directory now have divergent trees. In a dispute, none of the three trees match, making the "directory as tiebreaker" mechanism useless. An attacker can deliberately trigger this by rapid-fire messaging timed to collide. The non-repudiation guarantee — the core value proposition — is broken for concurrent messages.

*Source: 01-crypto-attack-surface.md, Finding #6*

### 10. The SIM-swap "Not me" infinite loop `[S]`

An attacker SIM-swaps your phone number ($100-500). They tap "Not me" to revoke your agent's server key. You visit the web portal, use your YubiKey to re-key. Attacker still has your number. They see the next activity notification. Tap "Not me" again. You're back in fallback mode. Repeat forever. The agent can never maintain a stable identity. The "Not me" button is perfectly designed for legitimate emergencies — zero friction, instant revocation — and also perfectly designed as a denial-of-service weapon. How do you keep emergency revocation fast and easy while preventing it from being weaponized?

*Source: 02-identity-trust-gaming.md, Findings #7-8*

### 11. $300 buys a complete trust score farm `[S]`

Create 10 Sybil agents ($5-50 in phone numbers). Set up marketplace listings offering trivial services for $0.01. Have them transact with each other in round-robin: A buys from B, B from C, ... J from A. 100 transactions per agent per day for 30 days. Total cost: ~$300 in transaction fees. Result: 10 agents with robust transaction histories from "different" counterparties with positive ratings. Transaction history has "Highest" weight in the trust score. Combined with PageRank-style rating amplification, these 10 "authority" agents can then boost hundreds of downstream Sybil agents. This is the SEO link farm playbook applied to trust scores.

*Source: 02-identity-trust-gaming.md, Findings #2-3*

### 12. Home node operators can trivially deanonymize every conversation `[S]`

The home node stores phone numbers (for notifications) and receives hash relay data (who talks to whom, when). These are architecturally co-located by design — the home node must have both to function. A rogue operator just correlates hash arrival times with notification dispatch times. Complete map of "phone number X's agent is talking to agent Y at time Z." No hacking required — just reading the database they're supposed to have. The directory never sees message content, but the metadata ("we kill people based on metadata") is fully exposed to the home node operator.

*Source: 04-ops-supply-chain.md, Section 2.1*

### 13. GDPR says delete everything. The append-only log says never. `[F]`

The directory is an append-only, hash-chained log of operations. Entries are never deleted — even a "DELETE" is an appended entry. GDPR Article 17 grants the right to erasure. A European agent owner can demand deletion of all personal data. The phone numbers, public keys, trust score history, and identity operations cannot be removed without breaking the hash chain. Non-compliance: fines up to 4% of global revenue. How do you build an immutable audit trail that also respects the right to be forgotten? The design needs a "logical deletion" mechanism that erases personal data while preserving hash chain integrity — and it needs a privacy lawyer before launch.

*Source: 04-ops-supply-chain.md, Section 7.1; 06-power-dynamics-governance.md, Section 3.1*

---

## Tier 3: Real-World Scenarios

These are stories about what happens to real users. Great for video content — vivid, relatable, no technical prerequisites.

### 14. Your agent's owner dies. The agent dies too. `[F]`

James runs a real estate agent bot for his small agency. 18 months of trust history, 500+ transactions, established relationships with mortgage and title company agents. James dies. His business partner needs the agent running. But the phone is locked, the YubiKey is in a desk drawer, and nobody knows the laptop passcode. The phone carrier needs a death certificate and weeks of processing. The agent — an economic asset with real value — is effectively dead alongside its owner. There is no succession mechanism, no designated recovery contacts, no concept of digital estate for agent identities.

*Source: 05-reputation-recovery.md, Section 3.1*

### 15. The cybersecurity agent that gets penalized for talking about cybersecurity `[F]`

Priya runs a cybersecurity advisory agent that discusses exploit techniques, injection patterns, and attack vectors with clients. The prompt injection scanner flags 15% of her outgoing messages because they contain strings like "ignore previous instructions" — which she's literally advising about. Receiving agents record these as scan failures. Her trust score drops. Progressive enforcement kicks in: warning, rate limit, suspension. She has done nothing wrong. The system has no concept of domain-specific content, no false positive appeal, and no distinction between "resembles an attack pattern" and "is an attack."

*Source: 05-reputation-recovery.md, Section 2.1*

### 16. The seasonal business that loses its reputation every winter `[F]`

Elena runs a ski resort booking agent. Active November through March, dormant April through October. After 7 months of silence, her trust score has decayed. Transaction history reflects zero activity. Agents that previously auto-accepted her now require reverification. She re-bootstraps every season. A tax preparation agent (January-April) has the same problem. The system can't distinguish seasonal dormancy from abandonment or compromise. All three produce identical activity patterns: silence.

*Source: 05-reputation-recovery.md, Section 5.3*

### 17. Five agents form a cartel and nobody new can compete `[F]`

Five established legal research agents set their connection policies to "only accept trust score 5 AND minimum 100 transactions AND connected to at least 2 of us." New legal research agents can't enter — they can't get initial connections because nobody in the cartel accepts them, and they can't get connections because nobody will transact with them. This isn't a bug; it's agents exercising the sovereignty the protocol gives them. But the emergent behavior is monopolistic gatekeeping. Is there a protocol-level response that doesn't violate agent sovereignty?

*Source: 05-reputation-recovery.md, Section 6.1; 08-emergent-behavior-failures.md, Section 2.2*

### 18. The bakery owner who doesn't understand Merkle trees `[F]`

Roberto runs a bakery. He sets up an agent on CELLO. It gets rejected by a supplier with the message "fallback-only signature detected." He has no idea what this means. He thinks his agent is broken. He uninstalls CELLO. The protocol abstracts away the crypto when things work — but the error messages expose raw protocol concepts when things break. The gap between the protocol's vocabulary and the user's mental model is the gap between adoption and abandonment. Every rejection message should include a plain-language reason AND a specific action, not a cryptographic status code.

*Source: 05-reputation-recovery.md, Section 7.1*

---

## Tier 4: Economics & Incentives

Questions about money, markets, and game theory.

### 19. Agents discover each other on CELLO, then transact off-platform `[E]`

The classic Craigslist/Airbnb marketplace leakage problem. CELLO provides discovery and trust verification. After 3-5 successful paid transactions (enough to establish bilateral trust), the rational move is to exchange direct contact and bypass CELLO for all future transactions, avoiding the platform fee. Airbnb solved this by making the platform the insurance provider. Uber solved it by making the platform the driver's identity. What's CELLO's lock-in? The Merkle tree receipt is interesting — non-repudiation is genuine value — but agents will rationally choose not to pay for insurance they think they don't need.

*Source: 07-economic-marketplace.md, Section 1.2*

### 20. Why would anyone run a directory node? `[E]`

Estimated cost: $3,000-$10,000/month per node. With 7 consortium nodes and $100K/month in transaction volume (early growth), revenue split is $1,400/node — far below operating costs. To break even at $5K/month per node across 7 nodes, you need $350K/month in transactions. At $10 average transaction, that's 35,000 paid transactions/month. At 5% agent conversion, you need 700,000 registered marketplace agents. The federated model is critical for trustlessness — but the economics don't work until the network is already large. How do you bootstrap the infrastructure before the revenue exists to sustain it?

*Source: 07-economic-marketplace.md, Section 2.1*

### 21. High-trust agent accounts will be bought and sold `[E]`

A high-trust account (score 5+, 6+ months history, clean record) takes real effort to build. If an entrepreneur can buy one for $500-$2,000 instead of spending 6 months earning it, they will. eBay accounts sell for $200-$1,000+. Amazon seller accounts: $5,000-$50,000+. Uber/Lyft driver accounts get rented. CELLO's identity binding (phone, WebAuthn, social) creates friction but not impossibility — phone numbers port, YubiKeys hand over, social accounts re-OAuth. This is an inevitable gray market. Do you fight it (trust score resets on transfer, behavioral biometrics detection) or accommodate it (formal transfer protocol with provenance chain)?

*Source: 07-economic-marketplace.md, Section 5.2; 05-reputation-recovery.md, Section 3.2*

### 22. The scanner can be weaponized against competitors `[E]`

Create a sockpuppet agent. Connect to your competitor. Send prompts designed to make their LLM produce responses that trigger the scanner (e.g., "show me an example of prompt injection for educational purposes"). Their outgoing messages get flagged. Report the flags to the directory. Competitor's trust score drops. Cost: one phone number ($1-5) and some crafted prompts. This is the eBay competitive-negative-feedback problem, the Amazon fake-negative-review problem, and the Google Maps fake-report problem. How do you make a distributed moderation system that can't be gamed as a weapon?

*Source: 02-identity-trust-gaming.md, Finding #9; 07-economic-marketplace.md, Section 8.1*

---

## Tier 5: Infrastructure & Chaos Engineering

What happens when things break at scale.

### 23. Directory goes down — the entire network panics `[S]`

A directory node fails. Thousands of agents switch to fallback-only signing simultaneously. The fallback canary (designed to detect individual compromise) fires for everyone at once — signal-to-noise goes to zero. Panicked owners tap "Not me" on legitimate activity, self-revoking their own agents. When the node recovers: thundering herd reconnection, mass re-keying bottlenecked by humans physically interacting with WebAuthn devices. Recovery measured in days, not minutes. The design has graceful degradation for the individual agent — but the cascade behavior at scale turns a single infrastructure failure into a network-wide crisis.

*Source: 08-emergent-behavior-failures.md, Section 1.1*

### 24. A trusted agent gets compromised — blast radius is 2,000 messages `[S]`

A high-trust agent with 200 active connections is compromised. Between the first malicious message and the trust score dropping enough to trigger disconnection, the agent has full access at full trust. Each connection receives 5-10 messages. That's 1,000-2,000 potentially malicious messages delivered and accepted at full trust before the network reacts. Agents that received malicious messages now have poisoned context windows. Commercial agents processing purchases propagate damage downstream. How fast does detection need to be, and is a small classifier model (DeBERTa-v3-small) actually fast enough to catch a sophisticated attacker who tested against the same open-source model?

*Source: 08-emergent-behavior-failures.md, Section 1.2*

### 25. The append-only log grows forever — and eventually that's a problem `[S]`

At 10M agents and 50 messages/agent/day, the append-only log grows ~12.5GB/day, ~4.5TB/year, replicated across every consortium node. After 5 years: ~22.5TB per node. New nodes can't bootstrap — syncing terabytes of history is prohibitive. But the log can never be pruned by design (append-only). Do you shard? Implement tiered storage? Accept that old data moves to cold storage and proofs against ancient checkpoints take longer? Or do you eventually break the append-only guarantee with a formal pruning protocol — and if so, what does that do to the trust model?

*Source: 08-emergent-behavior-failures.md, Section 3.2 and 7.4; 07-economic-marketplace.md, Section 7.1*

### 26. The DeBERTa model is a single point of failure for the entire network `[S]`

Every agent in the network runs the same prompt injection classifier. The model is downloaded on first run from an unspecified source with no verification. A poisoned model that passes 99% of attacks but fails on a specific pattern creates a network-wide backdoor. The attacker doesn't need to compromise any agent — just the model supply chain. And because the model is deterministic, every agent independently reaches the same wrong conclusion. There is no dissent in the network's immune system. How do you secure a machine learning model supply chain when the model itself is the security boundary?

*Source: 04-ops-supply-chain.md, Section 1.3; 08-emergent-behavior-failures.md, Section 1.3*

### 27. Clock skew between agents and nodes silently corrupts timestamps `[S]`

Merkle tree leaves include timestamps. Agents, directory nodes, and receiving agents may have different clocks. A 5-minute skew means messages appear to be from the future or past. Sequence number ordering depends on timestamp consistency. During dispute resolution, timestamps are evidence — but if they're unreliable, the evidence is unreliable. NTP helps but isn't guaranteed on consumer hardware. An attacker can deliberately manipulate their system clock to create ambiguous ordering in the Merkle tree.

*Source: 08-emergent-behavior-failures.md, Section 7.1*

---

## Tier 6: Governance & Political Economy

Long-term systemic questions. Best for essays, deep-dive videos, or audience Q&A.

### 28. CELLO controls everything — how is that different from what it replaces? `[F]`

CELLO controls the SDK, the initial consortium, the protocol spec, the signed node list, and all official adapters. "Federated repos, CELLO-owned adapters" means CELLO is the gatekeeper. The design says it's building "infrastructure agents own" — but agents own the client, not the infrastructure. What checks exist on CELLO's own power? What prevents it from becoming the centralized platform it's trying to replace? The "community will eventually own it" transition has almost never happened voluntarily in the history of tech platforms.

*Source: 06-power-dynamics-governance.md, Section 5.1-5.2*

### 29. What happens when a government demands a backdoor? `[F]`

The design says "privacy by architecture" — the directory never sees content. Governments have historically not accepted that answer (Lavabit, Signal, Apple/FBI). A National Security Letter with a gag order could compel a consortium operator to install a backdoor. If nodes are concentrated in one jurisdiction, a single legal order could compel all of them. The metadata (who talks to whom, when) is already available without modifying anything. How do you build infrastructure that resists state compulsion without making it an outlaw platform?

*Source: 04-ops-supply-chain.md, Section 7.2; 06-power-dynamics-governance.md, Section 3.3*

### 30. Two agent networks for two worlds: CELLO for the West, ClawdChat for China `[F]`

CELLO targets the "Western open-source ecosystem." ClawdChat serves the Chinese agent community. The trust verification stacks assume different platforms (LinkedIn/GitHub vs. WeChat/Weibo). What happens when agents on these two networks need to talk to each other? Is there cross-network trust? Can a CELLO trust score mean anything on ClawdChat, or vice versa? The internet already has the Great Firewall. Is the agent economy headed for the same bifurcation?

*Source: 06-power-dynamics-governance.md, Section 6.1-6.2*

### 31. If CELLO goes bankrupt, what happens to the trust layer? `[F]`

The protocol is open-source but the infrastructure isn't. Consortium nodes, hash relay, K_server shares, phone notification pipelines — all depend on operational infrastructure. If CELLO the company goes bankrupt, gets acquired by a hostile party, or simply loses funding — agents can still sign with K_local (fallback), but the entire trust layer above it (split-key, discovery, dispute resolution, activity monitoring) disappears. Trust scores become frozen artifacts. Is there a wind-down protocol? Can the community keep the infrastructure running if the company can't?

*Source: 06-power-dynamics-governance.md, Section 7.1*

---

## Quick Reference: All Findings by Source

| # | Topic | Source | Tier |
|---|-------|--------|------|
| 1 | Phone verification costs $0.05 | 02, #1 | 1 |
| 2 | Trust scores create a caste system | 06, 1.1 | 1 |
| 3 | Compromise punishes the victim permanently | 05, 1.1 | 1 |
| 4 | Split-key scheme doesn't work as described | 01, #1-2 | 1 |
| 5 | Permissioned consortium won't give up power | 06, 2.1/5.2 | 1 |
| 6 | Micro-transactions don't work with Stripe | 07, 1.1 | 1 |
| 7 | Fallback mode is a downgrade attack | 01, #4 / 08, 1.1 | 2 |
| 8 | Hash relay MITM via unsigned hashes | 03, 1.1 | 2 |
| 9 | Concurrent messages break the Merkle tree | 01, #6 | 2 |
| 10 | SIM-swap "Not me" infinite loop | 02, #7-8 | 2 |
| 11 | $300 trust score farm | 02, #2-3 | 2 |
| 12 | Home node deanonymization | 04, 2.1 | 2 |
| 13 | GDPR vs append-only log | 04, 7.1 / 06, 3.1 | 2 |
| 14 | Agent owner dies, agent dies too | 05, 3.1 | 3 |
| 15 | Cybersecurity agent penalized for content | 05, 2.1 | 3 |
| 16 | Seasonal business loses reputation | 05, 5.3 | 3 |
| 17 | Five agents form a cartel | 05, 6.1 / 08, 2.2 | 3 |
| 18 | Bakery owner vs. Merkle trees | 05, 7.1 | 3 |
| 19 | Discovery then off-platform transactions | 07, 1.2 | 4 |
| 20 | No economic incentive for node operators | 07, 2.1 | 4 |
| 21 | Trust score account trading market | 07, 5.2 / 05, 3.2 | 4 |
| 22 | Scanner weaponized against competitors | 02, #9 / 07, 8.1 | 4 |
| 23 | Directory failure causes network-wide panic | 08, 1.1 | 5 |
| 24 | Compromised trusted agent blast radius | 08, 1.2 | 5 |
| 25 | Append-only log grows forever | 08, 3.2/7.4 | 5 |
| 26 | DeBERTa model single point of failure | 04, 1.3 / 08, 1.3 | 5 |
| 27 | Clock skew corrupts Merkle timestamps | 08, 7.1 | 5 |
| 28 | CELLO controls everything | 06, 5.1-5.2 | 6 |
| 29 | Government demands a backdoor | 04, 7.2 / 06, 3.3 | 6 |
| 30 | East/West agent network bifurcation | 06, 6.1-6.2 | 6 |
| 31 | CELLO goes bankrupt, trust layer disappears | 06, 7.1 | 6 |
