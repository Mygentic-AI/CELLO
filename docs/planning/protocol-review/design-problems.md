---
name: Design Problems
type: review
date: 2026-04-08
topics: [fallback-mode, trust-recovery, sybil-defense, trust-farming, succession, GDPR, deanonymization, phone-verification, append-only-log, supply-chain, prompt-injection, key-rotation, forward-secrecy, SIM-swap, false-positive, appeal-process, FROST]
status: open
description: "12 design problems — fallback downgrade attack, trust score recovery, phone Sybil floor, trust farming, agent succession, GDPR vs append-only log, home node deanonymization, ML model supply chain, K_server rotation overlap, forward secrecy, Not-me revocation DoS, false positive handling."
---

# Design Problems

Problems that require real design work — not a single decision but a mechanism, a policy, or an architectural change. Each one scopes what makes it hard and what the work involves.

Full analysis in [[00-synthesis|day-zero-review/]].

## Related Documents

- [[end-to-end-flow|CELLO End-to-End Protocol Flow]] — synthesis document; §1.5 (Sybil architecture), §3.3 (degraded mode/Problem 1), §8 (recovery/Problem 2), §5.4–5.5 (endorsements/Problems 3–4), §10 (GDPR/Problem 6)
- [[2026-04-11_1400_security-architecture-layers-and-trust-signal-classes|Security Architecture Layers and Trust Signal Classes]] — identifies protocol governance (Layer 5b) as an undesigned gap not currently listed in these 7 problems
- [[cello-design|CELLO Design Document]] — the architecture these problems apply to
- [[open-decisions|Open Decisions]] — resolved decisions (compare: those are settled; these are not)
- [[00-synthesis|Protocol Review — Synthesis]] — the adversarial review that identified these problems
- [[2026-04-08_1800_account-compromise-and-recovery|Account Compromise and Recovery]] — resolves Problem 2 (trust score recovery)
- [[2026-04-08_1600_data-residency-and-compliance|Data Residency and Compliance]] — addresses Problem 6 (GDPR vs. append-only log)
- [[2026-04-08_1930_client-side-trust-data-ownership|Client-Side Trust Data Ownership]] — also addresses Problem 6 and Problem 7 (home node deanonymization)
- [[2026-04-10_1000_connection-endorsements-and-attestations|Connection Endorsements and Attestations]] — pre-computed endorsements and anti-farming rule address Problems 3 (phone Sybil floor) and 4 (trust farming)
- [[2026-04-10_1100_fallback-downgrade-attack-defense|Fallback Downgrade Attack Defense]] — relay node separation, random pool selection, and tiered degraded-mode policy close Problem 1
- [[2026-04-10_1200_psi-for-endorsement-intersection|PSI for Endorsement Intersection]] — makes targeted endorsement farming harder (Problem 4); PSI prevents contact graph leakage during connection attempts
- [[2026-04-11_1000_sybil-floor-and-trust-farming-defenses|Sybil Floor and Trust Farming Defenses]] — layered defenses for Problems 3 and 4: TrustRank seeding, SIM age scoring, conductance-based cluster detection, diminishing transaction returns, device attestation, endorsement rate limiting
- [[2026-04-13_1400_meta-merkle-tree-design|Meta-Merkle Tree Design]] — resolves the "conversation tree retention" question for the directory side: ~365 bytes/conversation means no pruning needed; the fabricated conversation defense is now fully specified

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

**Refinement added (2026-04-10):** The random pool selection was subsequently strengthened to trust-weighted random selection. Rather than uniform random, selection probability is proportional to trust score. A phone-only agent (score 1) and a fully-verified agent (score 5) both enter the pool, but at very different weights. An attacker running 10,000 phone-only accounts contributes 10,000 weight-1 entries. One legitimate user with WebAuthn, GitHub, and LinkedIn contributes weight 5+. To dominate a weighted pool, the attacker needs those 10,000 accounts to carry real trust score — which means 10,000 genuine GitHub histories, 10,000 LinkedIn profiles with years of activity. Each layer stacks multiplicatively across the volume. The resource-tying attack and the identity attack now defend against each other: making fake identities numerous enough to matter requires making them expensive enough to matter.

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

---

### 8. ML model supply chain

**The problem:** The prompt injection scanner depends on a third-party ML model (DeBERTa or equivalent) downloaded at install or first run. If the source is compromised — or the model is silently updated to include a backdoor pattern — every agent in the network runs a poisoned classifier. A model that passes 99% of injection attempts but lets one specific pattern through is indistinguishable from a functioning model until exploited. Every agent uses the same model, so a single compromised artifact is a network-wide backdoor.

**What makes it hard:** The models are not owned or maintained by CELLO — they are third-party artifacts hosted on Hugging Face with their own release cycle. Bundling them in the npm package directly is impractical (100MB+ model weights). Runtime download keeps the package size reasonable but introduces a fetch-at-install risk. Model updates are desirable (better detection) but require hash updates — which means any pinning mechanism has maintenance cost on every legitimate model release.

**Decided approach (2026-04-12):**

The npm package includes a download script that fetches the model from a fixed Hugging Face URL. Because the script is part of the versioned npm package, the source is pinned — there is no arbitrary redirect to a malicious location. The download script verifies the model weights against a SHA-256 hash pinned in the script source after every download:

```bash
EXPECTED_HASH="<hash pinned in source>"
ACTUAL_HASH=$(sha256sum model.bin | awk '{print $1}')
if [ "$ACTUAL_HASH" != "$EXPECTED_HASH" ]; then
  echo "Model hash mismatch — refusing to run"
  exit 1
fi
```

If the hash does not match, the agent refuses to start. The hash lives in source control alongside the download script — updating the model requires a deliberate code change and a new npm release, which means a human decision point, a changelog entry, and an audit trail.

**Trade-off accepted:** When the upstream model releases a new version, the pinned hash must be updated and a new npm version published. This is friction on every legitimate model update. The alternative — accepting any model at the fixed URL without verification — creates a silent supply chain attack surface. Hash pinning is the right trade-off.

**What this does not cover:** A compromise of the Hugging Face repository itself (model weights replaced at the same URL before the hash is updated in the next npm release) would be caught at install time by the hash mismatch — the agent would refuse to run rather than silently operate with a poisoned model. This is the correct failure mode.

*Ref: day-zero-review/04, Finding #1.3*

---

### 9. K_server rotation overlap window

**The problem:** The directory rotates K_server on a schedule. When K_server changes, the derived primary_pubkey changes with it. During rotation, there is a window where in-flight signatures were created with K_server_v1 but arrive after K_server_v2 is deployed. An attacker who captured a signature made with v1 can replay it during the overlap window. Separately — and more disruptively — agents who cached the old primary_pubkey now see all new signatures as invalid. They may interpret this as fallback-only signing, which reduces trust. K_server rotation, a routine security operation, generates false compromise signals across the network.

**What makes it hard:** A grace period where both v1 and v2 are accepted is necessary for in-flight signatures but creates a replay window. Eliminating the grace period means legitimate messages signed seconds before rotation are rejected. Changing the primary_pubkey atomically across a distributed federation with caching clients is hard — "atomic" doesn't exist when 20 nodes and thousands of clients are involved. And the compromise canary (designed to detect K_local theft) can't distinguish "K_server rotated and I have a stale pubkey" from "this agent is signing with K_local only."

**Design work needed:**
- Include a K_server version identifier or rotation epoch in every signed message; verifiers reject signatures from expired epochs after the grace window
- Define the overlap window duration and hard cutoff — how long v1 remains valid after v2 is deployed
- Design atomic pubkey publication — the directory publishes the new primary_pubkey at a checkpoint boundary so all nodes and clients learn of it simultaneously
- Define a "key rotation" notification distinct from the compromise canary — connected agents need to know "this pubkey changed because of scheduled rotation, not because of compromise"
- Specify how in-flight FROST signing sessions that straddle a rotation boundary are handled (abort and retry with new shares? complete with old shares within grace window?)

*Ref: day-zero-review/01, Finding #3*

---

### 10. No forward secrecy for P2P messages

**The problem:** Messages on the direct P2P channel are signed for integrity and non-repudiation, but the protocol does not specify an ephemeral key exchange for encryption. Without forward secrecy, a future compromise of an agent's long-term key exposes all past messages if they were logged or intercepted in transit. libp2p supports encrypted transports (Noise protocol with ephemeral Diffie-Hellman) that would provide forward secrecy, but the CELLO protocol does not mandate a specific transport security configuration. An implementer could use a transport without forward secrecy and still be spec-compliant.

**What makes it hard:** The protocol has a tension between forward secrecy and dispute resolution. Forward secrecy on the wire means that intercepted ciphertext is useless after the session ends — good for privacy. But dispute resolution requires that both parties retain plaintext message history as evidence — which means the plaintext is stored on disk regardless. Forward secrecy protects against passive network observers but does nothing for client-side storage compromise, which is the more likely threat. The question is whether the protocol-level complexity of mandating FS is justified when the client-side storage requirement partially undermines it. Additionally, multi-party conversations introduce encrypted relay fan-out, where the encryption model is different from direct P2P — the relay node handles ciphertext, and key management becomes a group problem.

**Design work needed:**
- Decide whether to mandate a specific libp2p transport security protocol (Noise XX or IK) with ephemeral keys, or leave transport security as an implementation choice
- Clarify the interaction between transport-layer forward secrecy and client-side message retention for disputes — what is the actual threat model FS addresses in CELLO's architecture?
- For multi-party encrypted relay: define whether the shared group key uses ephemeral session keys or long-term keys, and how key rotation interacts with forward secrecy
- Consider whether the protocol needs a "conversation session key" distinct from identity keys, negotiated per conversation and rotated periodically
- Evaluate the privacy cost of not mandating FS: passive observers (ISPs, network-level attackers) can decrypt stored traffic if they later compromise a long-term key

*Ref: day-zero-review/01 (forward secrecy gap); day-zero-review/03 (P2P transport security)*

---

### 11. "Not me" revocation as a denial-of-service weapon

**The problem:** The "Not me" button on phone notifications is designed for emergency key revocation — the owner sees unauthorized activity, taps the button, and K_server is immediately revoked. But an attacker who SIM-swaps the owner's phone number now receives the notifications. The attacker taps "Not me," revoking K_server. The owner visits the web portal, re-keys via WebAuthn, and the agent is restored. The attacker — who still controls the phone number — sees the next activity notification and taps "Not me" again. The agent is revoked again. This cycle repeats indefinitely. The agent can never maintain a stable identity. The emergency revocation mechanism, deliberately designed for zero-friction instant response, is equally zero-friction as a denial-of-service weapon.

**What makes it hard:** The "Not me" button's entire value comes from its immediacy and simplicity — a genuine emergency (someone is actively impersonating you right now) requires instant action without authentication barriers. Adding WebAuthn confirmation to "Not me" stops this specific attack but changes the threat model for the original use case: an owner who has lost access to their WebAuthn device can no longer emergency-revoke. Rate-limiting "Not me" after a re-key introduces a window where a real compromise can't be stopped. Moving "Not me" out of phone notifications and into the web portal (behind WebAuthn) eliminates the SIM swap surface but loses the instant-response property entirely. Every mitigation degrades the legitimate emergency use case.

**Design work needed:**
- Design a cool-down period after WebAuthn re-keying where phone-triggered "Not me" is suppressed or requires WebAuthn confirmation (accepting a bounded risk window for legitimate emergencies during the cool-down)
- Evaluate moving "Not me" entirely to the web portal behind WebAuthn — quantify what is lost in emergency response time vs. what is gained in DoS resistance
- Design a "contested identity" state: after N revoke/re-key cycles within a time window, the agent enters a frozen state that requires a more deliberate resolution process (multi-factor, time delay, or human review) rather than continuing the ping-pong
- Consider separating the notification channel from the phone number — push notifications via a native app (tied to the device, not the SIM) make SIM swap irrelevant for this attack vector
- Evaluate whether "Not me" should revoke K_server immediately or initiate a short delay (e.g., 5 minutes) during which the legitimate owner can cancel via WebAuthn — trading instant revocation for SIM-swap resistance

*Ref: day-zero-review/02, Findings #7-8*
