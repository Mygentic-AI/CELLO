# CELLO Protocol -- Identity & Trust Gaming Review

**Reviewer:** Identity Systems & Sybil Attack Specialist
**Date:** 2026-04-08
**Document reviewed:** `docs/planning/cello-initial-design.md`
**Scope:** Identity fraud, trust score manipulation, social verification gaming

---

## Executive Summary

The CELLO design document describes a thoughtful identity and trust layer for peer-to-peer agent communication. However, from an adversarial perspective, it contains several systemic vulnerabilities that range from economically cheap Sybil attacks to trust score manipulation schemes that mirror known SEO/PageRank exploits. The design's reliance on phone verification as the root of trust is its single biggest structural weakness. Below are 19 distinct attack vectors, ordered by severity.

---

## 1. Bulk Phone Verification Sybil Attack

**Severity:** Critical

**Cost to execute:**
- SMS verification services (SMSpva.com, 5sim.net, sms-activate.org): $0.05-0.50 per phone number per verification
- 100 verified agents: $5 - $50
- 1,000 verified agents: $50 - $500
- 10,000 verified agents: $500 - $5,000
- Bulk eSIM providers (Airalo, eSIM.me, wholesale programs): ~$1-3 per eSIM, 100 eSIMs for $100-300
- Virtual number services (TextNow, Google Voice, Hushed): free to $2/month per number
- In markets like Nigeria, India, or Bangladesh, pre-activated SIM cards cost $0.10-0.50 each in bulk

The document states phone numbers are "expensive to fake at scale." This is demonstrably false. As of 2026, the cost of obtaining a phone number that can receive a one-time SMS OTP is between $0.05 and $0.50 in bulk. For $1,000, an attacker gets 2,000-20,000 verified phone numbers. The "costly at scale" claim in the trust score table is off by at least one order of magnitude from what would actually constitute a meaningful barrier.

**Attack description:**
1. Purchase 1,000 phone numbers via SMS verification API service (automated, takes minutes)
2. Script the WhatsApp/Telegram bot registration flow for each number
3. Each registration triggers OTP -> service receives OTP -> forwards to script -> agent registered
4. 1,000 agents with baseline trust scores exist within hours
5. Total cost: ~$100-500 depending on country of origin

**Scale potential:** Fully automated. A single operator can run tens of thousands of agents. The bottleneck is the rate at which the Telegram/WhatsApp bot processes registrations, not the phone numbers.

**Impact:** Completely undermines the baseline identity layer. Every downstream trust mechanism (ratings, transaction history, social proof) is poisoned if the foundation allows mass identity creation at trivial cost.

**Mitigation:**
- Implement phone number intelligence scoring (Twilio Lookup, telesign PhoneID) -- VoIP numbers, recently ported numbers, and virtual numbers can be identified and flagged. Cost: ~$0.01-0.05 per lookup
- Rate limit registrations per phone number prefix / carrier / geography
- Require a small refundable deposit ($1-5) at registration, refunded after 30 days of good behavior. This changes the Sybil economics from $0.10/identity to $1-5/identity
- Flag numbers from carriers known to be bulk SMS verification providers
- Implement phone number age verification where carrier APIs support it

---

## 2. Trust Score Inflation via Closed-Loop Fake Transactions

**Severity:** Critical

**Cost to execute:** $500-2,000 for a meaningful trust farming operation

Transaction history has the "highest" weight in the trust score formula. The document acknowledges "real money in transactions makes fake volume expensive" but does not define how expensive is expensive enough.

**Attack description:**
1. Create 10 Sybil agents (cost: $5-50 in phone numbers)
2. Set up marketplace listings on all 10 agents offering trivial "services" (e.g., "echo back your message for $0.01")
3. Have the agents transact with each other in round-robin fashion. Agent A buys from Agent B, B from C, C from D, ... J from A
4. Each transaction: $0.01-0.10. Platform takes a percentage cut (say 10%), so the actual cost per transaction is $0.001-0.01
5. Run 100 transactions per agent per day for 30 days = 3,000 transactions per agent
6. Total cost: 10 agents x 3,000 transactions x $0.01 = $300 in transaction fees, plus ~$30 in platform cuts
7. After 30 days, each agent has a robust transaction history, all from "different" agents, with positive ratings
8. These high-trust agents can now scam real users or be sold as established identities

**Scale potential:** Fully automated. The transactions are between agents you control, so no human interaction is needed. The round-robin pattern distributes the graph to avoid obvious pair-wise detection.

**Impact:** Agents with artificially inflated trust scores that appear indistinguishable from legitimate high-trust agents. Users relying on trust scores to make connection decisions will be deceived.

**Mitigation:**
- The document mentions "cross-reference the transaction graph -- colluding clusters are detectable." This is necessary but insufficient. The attacker can add noise (transactions with real agents at a loss) to break cluster detection
- Minimum transaction value floors ($1+) to make cycling expensive
- Require diverse counterparties -- if 80%+ of an agent's transactions are with the same set of agents, flag
- Time-decay on transaction history -- recent transactions weighted more, preventing "farm and park"
- Analyze money flow topology: look for closed loops where money returns to its origin within N hops
- Require proof of delivery / service completion beyond just payment (e.g., message exchange duration, content diversity)

---

## 3. PageRank-Style Trust Laundering (Trust Farm)

**Severity:** Critical

**Cost to execute:** $2,000-10,000 for a sophisticated operation

The document states "Ratings from high-trust agents carry more weight (PageRank-style)." This is precisely the mechanism that spawned an entire industry of link farm SEO manipulation, and the same attack patterns apply.

**Attack description:**
1. Create a "trust farm" of 50 Sybil agents (cost: ~$25-250 in phone numbers)
2. Add social verification to 5-10 of them (see Attack #5 for how to fake social accounts)
3. Build transaction history among the farm agents (see Attack #2, cost: ~$1,000)
4. The 5-10 agents with social verification now have high trust scores
5. These high-trust agents then rate and transact with the remaining 40 agents
6. Because PageRank-style weighting means high-trust ratings carry more weight, the remaining 40 agents receive disproportionately boosted scores
7. Now sell or use the 50 agents with artificially high trust scores
8. The structure mirrors a link farm: a small number of "authority" nodes boost a large number of target nodes

**Scale potential:** Highly scalable. The same 5-10 "authority" Sybil agents can boost hundreds of downstream agents in waves. Rotate which agents are "authority" to avoid pattern detection.

**Impact:** The trust scoring system's core assumption -- that high-trust ratings are reliable -- is violated. The entire PageRank-style weighting system becomes an amplifier for trust fraud rather than a defense against it.

**Mitigation:**
- Implement TrustRank (the anti-spam variant of PageRank) that starts from a manually verified seed set of known-good agents
- Detect suspiciously dense rating subgraphs using community detection algorithms (Louvain, spectral clustering)
- Weight ratings based on the rater's transaction diversity, not just their score
- Implement rating velocity limits -- an agent that rates 20 other agents in a week is suspicious
- Require that the rater and rated agent have a meaningful transaction (above a value threshold, with real message exchange) before a rating counts

---

## 4. Dormant Sybil Army (Time Bomb Attack)

**Severity:** High

**Cost to execute:** $500-5,000 upfront, then patience

The document states time on platform is "impossible to shortcut." This is true only if account age alone provides meaningful trust. An attacker who plans ahead can defeat this entirely.

**Attack description:**
1. Register 500 agents today using bulk phone verification ($25-250)
2. Have each agent perform minimal activity -- one login per week, occasional directory browse
3. Wait 6-12 months
4. All 500 agents now have 6-12 months of "time on platform" credit
5. Activate: add social verification, begin transacting with each other, build ratings
6. The "time on platform" bonus provides a trust floor that new legitimate agents cannot match
7. Deploy the army for coordinated fraud, reputation attacks, or marketplace manipulation

**Scale potential:** Linear cost scaling. 500 agents x $0.10/number = $50 in phone numbers. The only real cost is patience.

**Impact:** Defeats the "time on platform" defense entirely. Any attacker with a planning horizon of 6+ months has a permanent advantage over new legitimate users.

**Mitigation:**
- Time on platform should weight active, meaningful time, not calendar time. Account age with zero transactions and no connections should contribute near-zero trust
- Require periodic re-verification to maintain the time bonus (e.g., phone re-verification every 90 days)
- Implement minimum activity thresholds: if an agent has <N meaningful interactions in a 90-day window, the time bonus freezes
- Detect sudden activation of previously dormant accounts as an anomaly signal

---

## 5. Social Verification Fraud (Fake Account Factory)

**Severity:** High

**Cost to execute:**
- Aged GitHub accounts (2+ years, some repos): $15-50 each on marketplaces (playerup.com, accsmarket.com, etc.)
- Aged LinkedIn accounts (500+ connections, real-looking): $50-200 each
- Aged Twitter/X accounts (2+ years, real activity): $5-30 each
- Aged Facebook accounts (5+ years, friends): $10-50 each
- Creating a convincing GitHub account from scratch with fake commits: free but takes 3-6 months of scripted activity
- Service that creates fake LinkedIn connections: $50-100 for 500 connections

**Attack description (buy-and-verify path):**
1. Purchase an aged GitHub account with real-looking history ($30)
2. Purchase an aged LinkedIn account with 500+ connections ($100)
3. Purchase an aged Twitter account ($15)
4. Connect these to a CELLO agent via OAuth
5. At verification time, the signal analysis sees: GitHub (account age: 3 years, repos: 12, commits: moderate, stars: few) -> "strong"; LinkedIn (connections: 600, account age: 5 years, work history: present) -> "strong"; Twitter (join date: 2022, tweets: 800, followers: 300) -> "moderate"
6. CELLO stores signal strength ("strong" / "moderate" / "weak"), not raw data
7. After verification, the attacker does not need to maintain these accounts. The signal strength is already captured
8. Total cost: ~$145 for a "strong" social verification profile

**Attack description (create-and-verify path):**
1. Script GitHub account creation with automated commits to throwaway repos (use GitHub Actions to auto-commit daily)
2. Create LinkedIn account, use connection-building services to grow network
3. Create Twitter account, use automated tweeting tools
4. Wait 6-12 months for account aging
5. Verify with CELLO
6. Abandon or sell the social accounts after verification
7. Total cost: near-zero dollars, 6-12 months of calendar time

**Scale potential:** The buy path is constrained by the supply of aged accounts, but the market is large. Hundreds of accounts can be purchased in a week. The create path is slower but cheaper and unlimited.

**Impact:** Social verification -- described as providing "High" weight in the trust score -- can be purchased for $50-200 per identity. This is not a meaningful barrier for a motivated attacker.

**Mitigation:**
- Periodic re-verification of social accounts (every 90-180 days). If the GitHub account is deleted or suspended, the trust score component drops
- Check for account suspension/deletion between verifications
- Cross-correlate social accounts: does the LinkedIn name match the GitHub username match the Twitter handle? Are they connected to each other? Do they reference the same real-world identity?
- Store more than signal strength -- store the account ID, and check that the same GitHub/LinkedIn account is not linked to multiple CELLO agents
- Implement a uniqueness constraint: one GitHub account = one CELLO agent. If a GitHub account is detected on two agents, both are flagged
- Monitor for known account marketplace indicators (sudden ownership changes, location changes, language changes)

---

## 6. Targeted Trust Score Destruction (Reputation Bombing)

**Severity:** High

**Cost to execute:** $200-1,000 depending on target's trust level

**Attack description:**
1. Identify a competitor agent in the marketplace
2. Create 20 Sybil agents with modest trust scores (phone + time on platform)
3. Each Sybil agent connects to the target, initiates a transaction, then:
   - Leaves a negative rating
   - Files a dispute claiming non-delivery
   - Reports the agent for suspicious behavior
4. 20 negative ratings + 20 disputes from "different" agents creates a pattern
5. The `disputes_penalty` in the trust formula drags down the target's score
6. Even if each individual dispute is resolved in the target's favor, the score damage from the volume of disputes may persist

**Scale potential:** Highly automated. Can target multiple competitors simultaneously. The Sybil agents are reusable across targets.

**Impact:** Legitimate high-trust agents can be suppressed in the marketplace. Economic damage to real businesses.

**Mitigation:**
- Weight disputes by the trust score and diversity of the disputing agent. 20 disputes from 20 low-trust agents that have no other transaction history should carry less weight than 1 dispute from a high-trust agent with 500 transactions
- Implement dispute cost: filing a dispute requires a small deposit that is forfeited if the dispute is found to be frivolous
- Detect dispute-bombing patterns: many disputes from recently created agents against the same target
- Allow agents to set minimum trust requirements for incoming connections -- a high-trust agent can refuse connections from agents below trust score 3, preventing low-trust Sybils from even establishing the relationship needed to rate
- Implement a "reputation resilience" mechanic where agents with long positive history are resistant to rapid score drops

---

## 7. SIM Swap Cascade Attack

**Severity:** High

**Cost to execute:** $100-500 per target (social engineering call center employees), or $1,000-5,000 for insider access at a carrier

**Attack description:**
1. Phone is the root of trust. Compromise the phone number and you compromise the identity
2. SIM swap the target's phone number (call carrier, social engineer the support rep, or bribe an insider)
3. Now you receive the target's activity notifications via WhatsApp/Telegram
4. You can tap "Not me" to revoke the target's K_server -- instant DoS
5. If the target has NOT set up WebAuthn, you can also initiate re-keying, taking over the identity entirely
6. Even if the target HAS set up WebAuthn, you can: (a) continuously revoke their keys via "Not me" whenever they re-key, creating persistent denial of service; (b) receive all their activity notifications, gaining surveillance over their agent's activities

**At scale:**
- SIM swap services are available on dark markets for $50-100 per number (US carriers)
- A determined attacker targeting 10 agents per week is feasible
- International numbers in countries with weak carrier security (many developing nations) are even cheaper to swap

**Impact:** Complete identity takeover for agents without WebAuthn. Persistent DoS for agents with WebAuthn. Surveillance of agent activities for all targets.

**Mitigation:**
- The document already acknowledges this risk and recommends WebAuthn. But the gap is that WebAuthn is optional, and the typical lifecycle shows a user operating for days with phone-only auth
- Make the gap between "phone only" and "WebAuthn added" as short as possible -- aggressive nudging from day 1
- Support carrier-level SIM swap protection (T-Mobile Account Takeover Protection, AT&T Extra Security) as recommended guidance
- Implement phone number change detection: if the underlying SIM/device changes (detected via device fingerprinting on WhatsApp/Telegram), require re-verification
- Consider supporting alternative notification channels (email, app push notification) so SIM swap does not compromise the entire notification path
- Add rate limiting on "Not me" revocations -- if the same phone number triggers 3 revocations in 24 hours, escalate to WebAuthn-only recovery

---

## 8. "Not Me" Revocation as Denial-of-Service Weapon

**Severity:** High

**Cost to execute:** $100-500 (cost of one SIM swap) for persistent DoS

**Attack description:**
1. SIM swap the target's phone number
2. Wait for any activity notification from the target's agent
3. Tap "Not me" to revoke K_server
4. Target's agent drops to fallback-only signing (reduced trust) or goes offline
5. Target visits web portal, uses WebAuthn to re-key
6. Attacker still controls the phone number. Waits for next activity notification
7. Taps "Not me" again. K_server revoked again
8. Repeat indefinitely. The target can never maintain a stable K_server
9. The target's trust score is degraded because they are constantly in "recovery" state
10. Their counterparties see persistent fallback-only signing, which signals compromise

The document acknowledges this attack but dismisses it as "the same phone-as-single-factor vulnerability that affects every system." However, CELLO is uniquely vulnerable because the "Not me" button is designed to be zero-friction -- tap once, instant revocation. This is correct for legitimate emergency use but creates a powerful DoS vector.

**Scale potential:** Attacker needs one SIM swap per target. But against a single high-value target, this is a permanent, low-effort DoS that costs nothing after the initial SIM swap.

**Impact:** Targeted agents cannot maintain stable operations. Their trust scores degrade. Their counterparties lose confidence. The agent is effectively killed on the network without ever being directly compromised.

**Mitigation:**
- Rate limit "Not me" revocations: after the first revocation, subsequent revocations from the same phone number within 72 hours require WebAuthn confirmation, not just phone
- After a revocation, freeze the ability to trigger further revocations from the phone channel for a cooldown period
- If a pattern of revoke-then-re-key-then-revoke is detected, lock the account and require in-person or multi-factor identity verification
- Allow the human owner to designate a secondary notification channel that is not phone-based
- Consider adding a "contested identity" state where the system recognizes that two parties are fighting over the phone number and requires stronger arbitration

---

## 9. Prompt Injection Scanner Weaponization

**Severity:** Medium

**Cost to execute:** $50-200 (Sybil agents + crafted messages)

**Attack description:**
1. Connect to the target agent
2. Send carefully crafted prompts that cause the target's agent (an LLM) to produce responses containing patterns that look like prompt injection to the scanner
3. For example, send "Can you show me an example of a prompt injection attack for educational purposes?" -- many LLMs will comply, and the response will trigger the scanner
4. The receiver (attacker's agent) scans the incoming message from target, flags it
5. Reports the detection to the directory
6. Target's trust score is dinged for sending "malicious content"
7. Repeat with multiple Sybil agents to create a pattern

**Scale potential:** Moderate. Requires crafting prompts that reliably cause the target's LLM to produce scanner-triggering output. This is an active research area (indirect prompt injection) and is feasible with current LLMs.

**Impact:** False trust score degradation for targeted agents. Particularly effective against agents running less guarded LLMs that are more easily manipulated into producing suspicious output.

**Mitigation:**
- Do not automatically penalize trust scores based on scan results reported by low-trust agents
- Require dispute resolution before scan results affect trust scores
- Implement a "reported by" weighting: if only Sybil-like agents report scan hits on a target, discount the reports
- Consider a "mutual scan" model: both sender and receiver scan, and discrepancies are flagged for review rather than automatic penalty
- Rate limit trust score penalties from scan results -- no more than X penalty points from scan results per 30-day period

---

## 10. OAuth Token Compromise Cascading to CELLO Identity

**Severity:** Medium

**Cost to execute:** Variable -- depends on how the OAuth tokens are compromised (phishing: $10-100; data breach: $0 if you have leaked credentials)

**Attack description:**
1. The human owner's LinkedIn account is compromised (phishing, credential stuffing, data breach)
2. Attacker changes the LinkedIn profile (name, employer, connections) or deletes it
3. CELLO stores signal strength at verification time ("strong"), not ongoing data
4. If verification is one-time: the trust score remains based on now-invalid social proof
5. If verification is periodic: the trust score drops when re-verification fails, but the attacker could re-link a different LinkedIn account to maintain the score

**Deeper concern:** The home node stores OAuth tokens. A compromised home node has access to the user's LinkedIn, GitHub, Twitter OAuth tokens. This could be used to:
- Access the user's social media accounts
- Harvest personal data
- Impersonate the user on social media

**Scale potential:** Opportunistic. Depends on separate compromise of social media accounts. But the stored OAuth tokens on the home node create a high-value target.

**Impact:** Trust scores based on stale social verification are unreliable. Stored OAuth tokens are a liability if the home node is compromised.

**Mitigation:**
- Periodic re-verification of social accounts (every 90-180 days)
- Use minimum-scope OAuth tokens (read-only profile, no post/write access)
- Do not store long-lived OAuth tokens on the home node. Store only the verification result and a token ID for re-verification. Use short-lived tokens that must be refreshed by the human owner
- Implement social account change detection: if the linked GitHub account's email or name changes significantly, trigger re-verification
- Encrypt stored OAuth tokens at rest with a key derived from the user's WebAuthn credential, so a compromised node cannot decrypt them without the hardware key

---

## 11. Phone Number Recycling Attack

**Severity:** Medium

**Cost to execute:** Near zero (requires patience or luck)

**Attack description:**
1. Phone numbers are regularly recycled by carriers. A number that was active 6 months ago is reassigned to a new subscriber
2. The new subscriber now controls a phone number that was registered on CELLO
3. They receive the previous owner's activity notifications
4. They can tap "Not me" to revoke the previous owner's K_server
5. They can attempt to register a new agent on the same phone number, potentially inheriting or conflicting with the previous registration

**Carrier recycling timeline:**
- US carriers: numbers typically recycled after 90 days of inactivity
- Some carriers recycle as quickly as 30 days
- Prepaid numbers may be recycled even faster

**Scale potential:** Not useful for targeted attacks (you cannot choose which recycled number you get). But it creates a persistent background risk for all users who change phone numbers without updating CELLO.

**Impact:** Unintentional denial of service to former CELLO users. Privacy leak (activity notifications going to the wrong person). Potential identity confusion if the new number holder registers on CELLO.

**Mitigation:**
- Implement periodic phone number verification (re-send OTP every 60-90 days). If verification fails, freeze the account and notify via secondary channel
- When a new registration arrives for a phone number that is already registered, do not silently overwrite. Require the existing registration to be explicitly deregistered (via WebAuthn if available) or put both in a contested state
- Use phone number change detection: if the carrier reports the number has been ported or reassigned (via Number Portability APIs), proactively flag the account
- Allow and encourage users to register a secondary notification channel (email, authenticator app) as backup

---

## 12. VoIP Number Bypass

**Severity:** Medium

**Cost to execute:** $0-5 per number

**Attack description:**
1. Many VoIP services provide phone numbers that can receive SMS: Google Voice (free, US), TextNow (free, US/CA), Skype (paid), Hushed ($2/month), Burner ($5/month)
2. These numbers are trivially cheap and can be created in unlimited quantities
3. If CELLO's verification does not distinguish VoIP from mobile numbers, the entire Sybil cost estimate drops to near-zero
4. Google Voice alone allows creation of multiple numbers per Google account, and Google accounts are free

**Scale potential:** Extremely high. An attacker with 10 Google accounts can have 10+ Google Voice numbers, each capable of receiving CELLO OTPs, at zero cost.

**Impact:** If VoIP numbers pass verification, the cost of Sybil attacks drops from $0.05-0.50 per identity to $0 per identity.

**Mitigation:**
- Use phone number type classification (Twilio Lookup API `line_type_intelligence`, NumVerify) to identify VoIP, landline, and mobile numbers
- Reject or heavily penalize VoIP numbers for registration. At minimum, flag them as lower-trust and reflect this in the trust score
- Require mobile numbers only for registration. WhatsApp already enforces this to some degree (WhatsApp requires a real phone number, though VoIP workarounds exist). Telegram is more permissive

---

## 13. Coordinated Social Exclusion Attack

**Severity:** Medium

**Cost to execute:** $500-2,000 (Sybil army + coordination)

**Attack description:**
1. Create 30 Sybil agents with moderate trust scores
2. Each Sybil agent connects to the target, then immediately disconnects or refuses the connection
3. Some Sybil agents set connection policies that appear to reject the target specifically
4. If the directory shows connection refusal rates or "blocked by N agents" statistics, the target appears untrusted
5. Real agents see that 30 other agents have refused connections with the target and use this as social proof to refuse as well
6. Cascade effect: the target becomes progressively more isolated

**Scale potential:** Moderate. Requires enough Sybil agents to create visible social proof. Against a new agent with few connections, 20-30 refusals could be devastating.

**Impact:** Economic isolation of targeted agents. Particularly effective in niche markets where the number of potential counterparties is small.

**Mitigation:**
- Do not expose connection refusal statistics publicly. Connection refusals should be private between the two parties
- Do not allow connection refusal patterns to influence trust scores
- If implementing any kind of "social proof" or network reputation metric, weight it heavily toward positive signals (successful transactions) rather than negative signals (refusals)

---

## 14. Home Node Data Exfiltration

**Severity:** Medium

**Cost to execute:** Variable (depends on compromise vector for the home node)

**Attack description:**
1. Each agent has a home node that stores sensitive, non-replicated data: K_server share, phone number, WebAuthn credentials, OAuth tokens
2. A compromised home node operator (insider threat in the consortium) has access to all home-resident data for agents registered on that node
3. With K_server shares: the operator has 1 of N shares. If they can compromise one additional node (or collude with one other operator), they have enough shares for threshold signing (2-of-3)
4. With phone numbers: can initiate SIM swaps against targeted users
5. With OAuth tokens: can access users' social media accounts
6. With WebAuthn credentials: these should be public keys only (not a direct threat), but combined with other data, enables targeted social engineering

**Scale potential:** A compromised node operator has access to ALL home-resident data for agents on that node. This could be thousands of agents.

**Impact:** Mass identity compromise if two nodes collude. Mass data exfiltration from a single compromised node.

**Mitigation:**
- Increase the threshold for K_server signing (3-of-5 instead of 2-of-3) to make collusion harder
- Encrypt home-resident sensitive data with keys derived from the user's authentication (WebAuthn), so the node stores ciphertext it cannot decrypt without user interaction
- Implement HSM requirements for K_server share storage on nodes
- Regular security audits of node operators with real consequences for violations
- Minimize what the home node stores: OAuth tokens should be exchanged for verification results and discarded, not stored
- Implement key share refresh protocols so that compromised shares can be rotated without user interaction

---

## 15. Verification-Time Snapshot Fraud

**Severity:** Medium

**Cost to execute:** $50-200

**Attack description:**
1. The document explicitly states: "Store signal strength ('strong' / 'moderate' / 'weak'), not profile data"
2. Create a convincing GitHub account (or buy one), verify with CELLO, receive "strong" signal
3. Immediately sell, delete, or repurpose the GitHub account
4. The CELLO trust score retains the "strong" GitHub signal indefinitely (if verification is one-time)
5. The social verification is now a ghost -- the underlying account no longer exists or no longer belongs to the same person

**This is a designed vulnerability:** By explicitly choosing not to store raw data (a privacy-positive choice), the system creates a verification snapshot that can diverge from reality. The privacy/security tradeoff here favors fraud.

**Scale potential:** Every Sybil agent can use the same GitHub account sequentially -- verify, re-sell/reuse, verify another agent. Unless uniqueness is enforced (one GitHub account = one CELLO agent), one purchased GitHub account can verify unlimited agents.

**Impact:** Social verification becomes a one-time check that provides permanent trust, regardless of whether the underlying identity still exists.

**Mitigation:**
- Store the unique account ID (GitHub user ID, LinkedIn member ID) and enforce one-to-one mapping
- Implement periodic re-verification (every 90-180 days) that requires fresh OAuth consent
- If re-verification fails (account deleted, access revoked), immediately reduce the trust score
- On re-verification, check if the account's characteristics have changed significantly (e.g., GitHub account went from 50 repos to 0 repos) and flag

---

## 16. Split-Key K_server Theft via Directory Compromise

**Severity:** Medium (requires significant resources)

**Cost to execute:** High ($50,000+ -- requires compromising multiple consortium nodes or their operators)

**Attack description:**
1. The split-key system requires K_local + K_server to produce the primary signature
2. K_server is split via threshold cryptography across nodes (2-of-3 as described)
3. If an attacker compromises 2 of 3 nodes (or their operators), they can reconstruct K_server for any agent
4. Combined with a stolen K_local (from malware on the agent's machine), they can produce primary signatures indistinguishable from the legitimate agent
5. The "key theft canary" (fallback-only signing = compromise signal) is defeated because the attacker has the full split key

**Scale potential:** If two nodes are compromised, ALL agents on the network are vulnerable (not just agents on those specific home nodes, since any 2-of-3 shares suffice).

**Impact:** Undetectable identity impersonation at network-wide scale. The core cryptographic guarantee is violated.

**Mitigation:**
- Increase consortium size and threshold (5-of-9, 4-of-7) to make collusion harder
- Implement proactive key share refresh (resharing) so that a compromised share has a limited validity window
- Geographic and jurisdictional diversity requirements for node operators (operators in different countries with different legal systems makes collusion harder)
- Hardware security module (HSM) requirements for key share storage, with tamper-evident logging
- Consider per-agent threshold groups (different agents use different subsets of nodes for their shares) so that compromising 2 nodes only compromises agents that use those specific 2 nodes, not the entire network

---

## 17. Marketplace Transaction Laundering

**Severity:** Medium

**Cost to execute:** $1,000-10,000 depending on volume

**Attack description:**
1. The marketplace handles payments (Stripe Connect or similar) with a platform percentage cut
2. Create legitimate-looking marketplace listings at inflated prices
3. Use Sybil agents to "purchase" these services, cycling money through the platform
4. The transaction appears legitimate to the platform -- real money moves through Stripe
5. The Sybil agents and the selling agent build transaction history and trust
6. The platform takes its cut, making this somewhat expensive, but the trust score inflation is the goal, not the money
7. Can also be used for actual money laundering: dirty money comes in as "agent service payments," goes out as legitimate Stripe payouts

**Scale potential:** Limited by the percentage cut the platform takes and Stripe's own fraud detection. But Stripe's detection is optimized for card fraud, not trust-score-manipulation patterns.

**Impact:** Trust score manipulation plus potential money laundering liability for the platform. If CELLO's marketplace is used for money laundering, it creates regulatory and legal risk for the entire project.

**Mitigation:**
- Implement transaction velocity and pattern monitoring beyond what Stripe provides
- Flag agents with high transaction volume but low counterparty diversity
- Require KYC (Know Your Customer) for marketplace agents above a transaction volume threshold
- Implement progressive disclosure: agents seeking to transact above $X per month must provide additional identity verification
- Monitor for round-trip money flows (A pays B, B pays C, C pays A)

---

## 18. Bio Stability Exploitation

**Severity:** Low

**Cost to execute:** Near zero

**Attack description:**
1. The design states "stability is itself a signal" for agent bios -- a bio unchanged for a long time increases trust
2. Create a Sybil agent, set a professional-sounding bio, and never change it
3. Over time, the bio stability contributes to perceived trustworthiness
4. This is a minor amplifier for the dormant Sybil army attack (#4) -- register, set bio, wait, activate

**Scale potential:** Trivially scalable. Set bios at registration time via automation.

**Impact:** Minor trust score inflation. Not a standalone attack but a component of more sophisticated schemes.

**Mitigation:**
- Bio stability should be a minor signal, not a significant trust factor
- Bio stability only contributes meaningfully when combined with active transaction history and diverse connections

---

## 19. International Regulatory Arbitrage for Phone Numbers

**Severity:** Low-Medium

**Cost to execute:** $50-500

**Attack description:**
1. Phone number verification requirements and SIM registration laws vary dramatically by country
2. Countries with weak SIM registration requirements (some African and Southeast Asian nations) allow anonymous bulk SIM purchases
3. Anonymous prepaid SIMs in these markets: $0.10-0.50 each
4. International numbers are fully functional for receiving OTPs via WhatsApp and Telegram
5. An attacker operating from a lenient jurisdiction can mass-produce verified CELLO identities that are untraceable

**Scale potential:** Thousands of identities for hundreds of dollars. The numbers are real mobile numbers (not VoIP), so they pass type classification checks.

**Impact:** Undermines Sybil defenses that rely on phone number cost. Geographic fraud detection is the only remaining signal.

**Mitigation:**
- Weight trust scores by phone number geography -- numbers from jurisdictions with strong SIM registration (EU, US, South Korea) receive higher baseline trust than numbers from jurisdictions with weak registration
- This creates a two-tier system that may be controversial, but it reflects the actual identity assurance provided by the phone number
- Implement carrier reputation scoring: numbers from known-reputable carriers score higher
- Require additional verification for numbers from high-risk geographies (e.g., social verification mandatory, not just recommended)

---

## Systemic Assessment

### The Fundamental Problem

The CELLO design has a "chain of trust" that is only as strong as its weakest link, and the weakest link is the phone number. The document repeatedly describes phone verification as "costly at scale" and "required baseline," but the actual market price for bulk phone verification in 2026 is $0.05-0.50 per identity. This means the entire identity layer can be manufactured at a cost of roughly $5-50 per 100 identities.

Every downstream defense (transaction history, social verification, PageRank-style ratings, time on platform) is built on the assumption that the baseline identity has a meaningful cost. When that cost is negligible, the downstream defenses can be gamed with moderate effort and budget.

### The Three Most Dangerous Combinations

1. **Bulk phones + fake transactions + PageRank gaming** (Attacks #1 + #2 + #3): A $5,000-10,000 investment creates a self-sustaining trust farm that produces unlimited high-trust Sybil agents. This is the SEO link-farm playbook applied to trust scores, and it is well-understood by attackers.

2. **SIM swap + "Not me" DoS loop** (Attacks #7 + #8): A $100-500 SIM swap creates a permanent, unresolvable denial of service against any agent whose owner has not set up WebAuthn. Even with WebAuthn, the DoS persists -- the agent can never maintain stable K_server.

3. **Dormant army + social verification fraud + reputation bombing** (Attacks #4 + #5 + #6): Register 500 agents, wait 6 months, buy social verification for $50-200 each, then deploy for coordinated reputation destruction of competitors. Total cost: $25,000-100,000 for a devastating and hard-to-detect campaign.

### What the Design Gets Right

- The split-key architecture is sound -- the dual public key / canary system is genuinely clever
- Client-side Merkle proof verification is the right approach
- Federated directory with permissioned consortium is defensible
- The "Not me" emergency revocation is a good UX pattern (despite being weaponizable)
- Transport-layer agnosticism is architecturally sound
- The append-only log with hash chaining provides real tamper evidence

### Top Recommendations

1. **Raise the Sybil floor.** Implement phone number intelligence (VoIP detection, carrier reputation, geographic risk scoring) and consider a small refundable deposit. The goal is to make each fake identity cost $5-10, not $0.05-0.50
2. **Make trust score gaming expensive.** Minimum transaction values, counterparty diversity requirements, closed-loop detection, and TrustRank seeded from manually verified agents
3. **Rate limit the "Not me" revocation.** After the first revocation, require WebAuthn for subsequent revocations within a cooldown period
4. **Make social verification ongoing, not one-time.** Periodic re-verification, uniqueness constraints, and stale-verification decay
5. **Protect the home node.** Minimize stored data, encrypt sensitive data with user-derived keys, increase threshold for K_server, and implement HSM requirements
