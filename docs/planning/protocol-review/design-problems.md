---
name: Design Problems
type: review
date: 2026-04-08
topics: [fallback-mode, trust-recovery, sybil-defense, trust-farming, succession, GDPR, deanonymization, phone-verification, append-only-log]
status: open
description: 7 unsolved design problems requiring mechanism work — fallback downgrade attack, trust score recovery, phone Sybil floor, trust farming, agent succession, GDPR vs append-only log, home node deanonymization.
---

# Design Problems

Problems that require real design work — not a single decision but a mechanism, a policy, or an architectural change. Each one scopes what makes it hard and what the work involves.

Full analysis in [[00-synthesis|day-zero-review/]].

## Related Documents

- [[cello-design|CELLO Design Document]] — the architecture these problems apply to
- [[open-decisions|Open Decisions]] — resolved decisions (compare: those are settled; these are not)
- [[00-synthesis|Protocol Review — Synthesis]] — the adversarial review that identified these problems
- [[2026-04-08_1800_account-compromise-and-recovery|Account Compromise and Recovery]] — resolves Problem 2 (trust score recovery)
- [[2026-04-08_1600_data-residency-and-compliance|Data Residency and Compliance]] — addresses Problem 6 (GDPR vs. append-only log)
- [[2026-04-08_1930_client-side-trust-data-ownership|Client-Side Trust Data Ownership]] — also addresses Problem 6 and Problem 7 (home node deanonymization)
- [[2026-04-10_1000_connection-endorsements-and-attestations|Connection Endorsements and Attestations]] — pre-computed endorsements and anti-farming rule address Problems 3 (phone Sybil floor) and 4 (trust farming)
- [[2026-04-10_1100_fallback-downgrade-attack-defense|Fallback Downgrade Attack Defense]] — relay node separation, random pool selection, and tiered degraded-mode policy close Problem 1
- [[2026-04-10_1200_psi-for-endorsement-intersection|PSI for Endorsement Intersection]] — makes targeted endorsement farming harder (Problem 4); PSI prevents contact graph leakage during connection attempts

---

---

### 1. Fallback mode as a downgrade attack

**The problem:** When the directory is unavailable, agents fall back to K_local-only signing. An attacker who previously stole K_local can force fallback by DDoS-ing the directory, then impersonate the agent. The split-key scheme was designed to prevent exactly this, but fallback mode nullifies it on demand. At scale, a directory outage causes mass fallback, the compromise canary fires for everyone simultaneously (signal-to-noise goes to zero), and panicked owners self-revoke via "Not me."

**What makes it hard:** Fallback mode exists because the alternative — agents can't operate at all when the directory is down — is worse for availability. The tension is between security (never accept K_local-only signatures) and availability (don't let infrastructure failures stop all commerce). You also need to distinguish "home node down" from "possible compromise" at the protocol level, which affects how receiving agents respond.

**Design work needed:**
- Define what fallback agents are allowed to do (continue existing conversations? initiate new connections? transact?)
- Design a time-limited fallback token signed by the directory during the last successful connection, proving recent contact
- Add a "node outage status" to the directory so the consortium can signal that fallback is infrastructure-related, not compromise-related
- Design the SDK's behavior when switching modes, including user-facing notifications

*Ref: day-zero-review/01 #4; day-zero-review/08, Section 1.1*

**How we thought through it (2026-04-10):**

The first insight was separating two distinct DDoS problems. Hammering — raw volume attacks — is a solved problem (CloudFront-style mitigation). The real threat is resource-tying: flooding the connection layer to make it unavailable, forcing agents into fallback. These require different treatments.

The second insight was that the problem has two separate infrastructure surfaces. If you separate connection nodes (public-facing, handle new authentication) from relay nodes (serve only established, already-authenticated sessions), a DDoS against connection nodes can't reach relay nodes. Existing sessions never fall back — they stay on split-key because the relay infrastructure isn't under attack. The attacker has to take down two distinct, differently-addressable layers to force fallback on any established session.

For new connections under load, random pool selection rather than FIFO queuing means a flood can't create a hard wall. If an attacker sends 90% of requests, 10% of legitimate users still get through. The cost of the attack scales proportionally with its effectiveness — it can never guarantee blocking a specific target.

The third insight inverted the fallback assumption entirely. The current design says degraded mode = lower trust but still accept. That's backwards. A degraded state is a reason to raise your guard, not lower it. The client already has the signal — it pings multiple nodes and knows when it can't reach a quorum. So the default during degraded mode should be: refuse new unauthenticated connections. Not a silent drop — a clear reason sent to the requester so legitimate agents know to retry.

On top of that, the client manages two separate lists: a whitelist (preferential treatment under normal authenticated conditions) and a degraded-mode list (agents trusted enough to talk to when the directory is completely unavailable). The degraded-mode list is expected to be much shorter — a stronger statement of trust. An agent can be on both lists, one but not the other, or neither. The owner decides.

Finally: the client tracks only its own lists. It does not track which other agents have listed it. An attacker who compromises a machine gets no map of who to target — they have to probe blindly, burning resources and generating detectable noise.

**What this closes:** The core attack — steal K_local, DDoS directory, impersonate — is blocked at every stage. Existing sessions don't fall back. New connections default to refuse. Even if an agent is on the degraded-mode list, the session is flagged in the Merkle leaf. The time-limited fallback token (from the original design work list) is less necessary with this architecture but remains a potential refinement for new connections.

**What's still unspecified:** The fallback token mechanism itself — a signed "I was online as of T" proof the directory issues during normal operation. Not a blocker, but would add a layer of assurance. See [[2026-04-10_1100_fallback-downgrade-attack-defense|Fallback Downgrade Attack Defense]] for the full mechanism.

---

### 2. Trust score recovery after compromise

**The problem:** An agent gets hacked, the attacker sends malicious messages, the trust score tanks. Owner re-keys, attacker is locked out. But the trust score is in the gutter and there's no recovery mechanism. Nobody will transact because the score is too low, and the score can't rise because nobody will transact. A temporary security event permanently destroys a business.

**What makes it hard:** You need to distinguish "this agent was compromised and has recovered" from "this agent is malicious and re-keyed to evade penalties." Both look the same from the outside. Recovery mechanisms that are too generous get exploited by bad actors. Mechanisms that are too strict punish honest victims. The solution also needs to work for the SMB owner whose livelihood depends on their agent — a 30-day recovery timeline might be survivable for enterprise but fatal for a freelancer.

**Design work needed:**
- Define a formal "compromise recovery event" in the append-only log (WebAuthn-authenticated, timestamped, distinct from routine key rotation)
- Design a trust score recovery schedule (accelerated penalty decay after verified re-key)
- Define a trust score floor based on pre-compromise history
- Design a mechanism for previously-connected agents to reconnect at reduced trust without meeting full policy thresholds
- Consider a "recovery badge" visible in the trust profile

*Ref: day-zero-review/05, Sections 1.1-1.2*

---

### 3. Phone verification Sybil floor

**The problem:** Bulk SMS verification costs $0.05-0.50 per identity. VoIP numbers are free. The entire downstream trust system assumes the baseline identity has meaningful cost. It doesn't. A $1,000 budget creates 2,000-20,000 fake agents.

**What makes it hard:** Phone verification is the onboarding path — it needs to be low-friction for legitimate users while being expensive for attackers. Any Sybil defense that adds friction also adds friction for the restaurant owner in Accra who just wants to set up an agent. The solution needs to work globally across carriers with wildly different verification reliability. VoIP detection helps but isn't foolproof. A deposit system changes the economics but creates a barrier to entry.

**Design work needed:**
- Evaluate phone number intelligence APIs (Twilio Lookup, Telesign) — what can they detect, at what cost, across which geographies?
- Design the VoIP/virtual number detection policy (reject? lower trust? flag?)
- Evaluate a refundable deposit ($1-5) — does this work globally? What about regions without easy digital payment?
- Design rate limiting by carrier, prefix, and geography
- Consider carrier reputation scoring

*Ref: day-zero-review/02, Findings #1, #12, #19*

---

### 4. Trust score farming via closed-loop transactions

**The problem:** 10 Sybil agents transacting with each other in round-robin at $0.01/transaction build legitimate-looking trust scores for ~$300. Combined with PageRank-style rating amplification, a small "authority" cluster can boost hundreds of downstream agents. This is the SEO link-farm playbook applied to trust scores.

**What makes it hard:** You need to detect coordinated fake activity without penalizing legitimate clusters (a small business and its regular suppliers will also have a dense transaction graph). Closed-loop detection works for simple patterns but attackers can add noise transactions with real agents. Minimum transaction floors help but change what kinds of micro-commerce the platform can support. The trust score formula itself needs to be resistant to gaming, which means understanding graph theory attacks before the formula is finalized.

**Design work needed:**
- Design closed-loop money flow detection (A pays B, B pays C, C pays A within N hops)
- Define minimum transaction values and counterparty diversity requirements
- Evaluate TrustRank (anti-spam variant of PageRank) seeded from manually verified agents
- Design rating velocity limits (how many ratings per agent per time window)
- Define what "meaningful transaction" means — message exchange duration, content diversity, minimum value

*Ref: day-zero-review/02, Findings #2-3; day-zero-review/07, Section 8.4*

---

### 5. Agent succession and ownership transfer

**The problem:** Agent identities are economic assets bound to a single human owner's phone and WebAuthn credentials. If the owner dies, the agent dies. If the business is sold, the trust score can't transfer. If co-owners split, there's no concept of shared ownership or disputed control.

**What makes it hard:** Succession and transfer are security-sensitive operations that could be exploited (social engineering someone's "designated recovery contacts," hostile takeover disguised as a business sale). The mechanism needs time delays, multi-party authorization, and abuse resistance — but also needs to actually work for a grieving business partner who needs the agent running tomorrow. Transfer also raises a philosophical question: should trust score be transferable? The history belongs to the old owner, but the new owner needs it to operate.

**Design work needed:**
- Design designated recovery contacts (how many, how designated, what authentication, what cooling period)
- Design the succession flow (joint authentication of recovery contacts + time delay + original owner cancel window)
- Design the transfer protocol (current owner initiates with WebAuthn, new owner completes identity verification, announcement period to connected agents)
- Decide trust score transfer policy (carry history but reset identity verification components?)
- Consider multi-signatory ownership for business agents

*Ref: day-zero-review/05, Sections 3.1-3.4*

---

### 6. GDPR vs. append-only log

**The problem:** The directory is an append-only, hash-chained log. GDPR Article 17 grants the right to erasure. European agent owners can demand deletion of personal data. The log can't remove entries without breaking the hash chain. Phone numbers, public keys, trust score history, and identity operations are personal data. Non-compliance: fines up to 4% of global revenue.

**What makes it hard:** The append-only property is a security feature — it's what makes tampering detectable. Breaking it undermines the trust model. But GDPR is not optional for any business operating in the EU. The solution needs to satisfy both: preserve hash chain integrity while making personal data actually deletable. "We only store hashes of personal data" helps for messages but doesn't help for the identity log, which contains actual personal data.

**Design work needed:**
- Design "logical deletion" — append a deletion marker, then cryptographically erase the associated personal data while keeping the hash chain intact (the hash of the deleted data remains as a tombstone)
- Separate personal data from the hash chain: the log stores hashes of identity operations, actual personal data stored separately and deletable
- Determine which data falls under "necessary for the performance of a contract" (GDPR Article 6(1)(b)) vs. requiring explicit consent
- Get a privacy lawyer involved before launch — this is a legal design constraint, not just a technical one

*Ref: day-zero-review/04, Section 7.1; day-zero-review/06, Section 3.1*

---

### 7. Home node deanonymization

**The problem:** The home node stores phone numbers (for notifications) and receives hash relay data (who talks to whom, when). A rogue operator just correlates the two — no hacking required. This is architectural: the home node must have both datasets to function. The privacy guarantee ("directory never sees content") is real but the metadata exposure to the home node operator is total.

**What makes it hard:** Separating the notification function from the hash relay function means no single operator has both datasets — but it adds complexity and a second trust relationship. Cryptographic notification routing (home node triggers a notification without knowing which conversation caused it) is possible but non-trivial. The alternative is accepting this as a known risk and controlling it through operator agreements and audits — but that's "trust the operator," which is exactly what the protocol is designed to avoid.

**Design work needed:**
- Evaluate whether notification and hash relay functions can be architecturally separated
- Design cryptographic notification routing if separation is feasible
- If not feasible, design operator agreements with specific data handling requirements, audit rights, and penalties
- Consider periodic home node rotation so no single operator accumulates a long history
- Assess whether PIR (Private Information Retrieval) is practical for directory queries

*Ref: day-zero-review/04, Section 2.1*
