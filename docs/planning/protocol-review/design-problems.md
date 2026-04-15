---
name: Design Problems
type: review
date: 2026-04-08
topics: [fallback-mode, trust-recovery, sybil-defense, trust-farming, succession, GDPR, deanonymization, phone-verification, append-only-log, supply-chain, prompt-injection, key-rotation, forward-secrecy, SIM-swap, false-positive, appeal-process, FROST]
status: open
description: "12 design problems — fallback downgrade attack, trust signal recovery, phone Sybil floor, trust farming, agent succession, GDPR vs append-only log, home node deanonymization, ML model supply chain, K_server rotation overlap, forward secrecy, Not-me revocation DoS, false positive handling."
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
- [[2026-04-08_1800_account-compromise-and-recovery|Account Compromise and Recovery]] — resolves Problem 2 (trust signal recovery after compromise)
- [[2026-04-08_1600_data-residency-and-compliance|Data Residency and Compliance]] — addresses Problem 6 (GDPR vs. append-only log)
- [[2026-04-08_1930_client-side-trust-data-ownership|Client-Side Trust Data Ownership]] — also addresses Problem 6 and Problem 7 (home node deanonymization)
- [[2026-04-10_1000_connection-endorsements-and-attestations|Connection Endorsements and Attestations]] — pre-computed endorsements and anti-farming rule address Problems 3 (phone Sybil floor) and 4 (trust farming)
- [[2026-04-10_1100_fallback-downgrade-attack-defense|Fallback Downgrade Attack Defense]] — relay node separation, random pool selection, and tiered degraded-mode policy close Problem 1
- [[2026-04-10_1200_psi-for-endorsement-intersection|PSI for Endorsement Intersection]] — makes targeted endorsement farming harder (Problem 4); PSI prevents contact graph leakage during connection attempts
- [[2026-04-11_1000_sybil-floor-and-trust-farming-defenses|Sybil Floor and Trust Farming Defenses]] — layered defenses for Problems 3 and 4: SIM age scoring, conductance-based cluster detection, diminishing transaction returns, device attestation, endorsement rate limiting
- [[2026-04-13_1400_meta-merkle-tree-design|Meta-Merkle Tree Design]] — resolves the "conversation tree retention" question for the directory side: ~365 bytes/conversation means no pruning needed; the fabricated conversation defense is now fully specified
- [[2026-04-11_1400_libp2p-dht-and-peer-connectivity|libp2p, DHT, and Peer Connectivity]] — transport security configuration relevant to Problem 10 (no forward secrecy); GossipSub and encrypted relay affect the multi-party key management dimension of the same problem
- [[2026-04-13_1100_quantum-resistance-design|Quantum Resistance Design]] — ML-DSA transition and key management mechanics relevant to Problem 9 (K_server rotation overlap window)
- [[prompt-injection-defense-layers-v2|Prompt Injection Defense Architecture]] — the scanner design at the centre of Problem 12 (false positive handling); context-aware scanning modes and appeal mechanisms are the design work needed there
- [[2026-04-14_0700_agent-succession-and-ownership-transfer|Agent Succession and Ownership Transfer]] — resolves Problem 5; voluntary transfer, involuntary succession (dead-man's switch), succession package, and what transfers vs. what doesn't
- [[2026-04-15_0900_session-level-frost-signing|Session-Level FROST Signing]] — Problem 9 (K_server rotation) window narrowed; Problem 1 (fallback downgrade) severity reduced
- [[2026-04-15_1100_key-rotation-design|Key Rotation Design]] — resolves Problem 9; per-agent K_server, independent K_local/K_server rotation, storage and durability design
- [[2026-04-14_1500_deprecate-trust-seeders-and-trustrank|Deprecate Trust Seeders and TrustRank]] — removes TrustRank from the recommended fixes for Problems 3 and 4; the remaining Sybil defenses (conductance, PSI, diminishing returns, endorsement rate limiting) address those problems without a global propagated score

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

**Refinement added (2026-04-10):** The random pool selection was subsequently strengthened to trust-weighted random selection. Rather than uniform random, selection probability is proportional to accumulated trust signals. An agent with minimal trust signals (phone only) and a fully-verified agent (WebAuthn, GitHub, LinkedIn) both enter the pool, but at very different weights. An attacker running 10,000 phone-only accounts contributes 10,000 minimal-weight entries. One legitimate user with strong trust signals contributes far more weight. To dominate a weighted pool, the attacker needs those 10,000 accounts to carry real trust signals — which means 10,000 genuine GitHub histories, 10,000 LinkedIn profiles with years of activity. Each layer stacks multiplicatively across the volume. The resource-tying attack and the identity attack now defend against each other: making fake identities numerous enough to matter requires making them expensive enough to matter.

**What's still unspecified:** The fallback token mechanism itself — a signed "I was online as of T" proof the directory issues during normal operation. Not a blocker, but would add a layer of assurance. See [[2026-04-10_1100_fallback-downgrade-attack-defense|Fallback Downgrade Attack Defense]] for the full mechanism.

**Severity reduced (2026-04-15):** The move to session-level FROST fundamentally changes the fallback landscape. Individual messages are now signed with K_local in normal operation — K_local signing is the standard mode, not a degraded fallback. Directory outage prevents new FROST session establishment and notarized seals, but **existing conversations continue normally**. There is no "mass fallback" event because conversations in progress never needed per-message FROST. The compromise canary does not fire network-wide on directory outage. The remaining exposure: an attacker who steals K_local during a directory outage can impersonate the agent in new connections to agents on the degraded-mode list — but cannot establish FROST-authenticated sessions, limiting the scope. See [[2026-04-15_0900_session-level-frost-signing|Session-Level FROST Signing]].

---

### 2. Trust signal recovery after compromise

**The problem:** An agent gets hacked, the attacker sends malicious messages, trust signals degrade. Owner re-keys, attacker is locked out. But trust signals are in poor standing and there's no recovery mechanism. Nobody will transact because trust signals are too weak, and trust signals can't recover because nobody will transact. A temporary security event permanently destroys a business.

**What makes it hard:** You need to distinguish "this agent was compromised and has recovered" from "this agent is malicious and re-keyed to evade penalties." Both look the same from the outside. Recovery mechanisms that are too generous get exploited by bad actors. Mechanisms that are too strict punish honest victims. The solution also needs to work for the SMB owner whose livelihood depends on their agent — a 30-day recovery timeline might be survivable for enterprise but fatal for a freelancer.

**Design work needed:**
- Define a formal "compromise recovery event" in the append-only log (WebAuthn-authenticated, timestamped, distinct from routine key rotation)
- Design a trust signal recovery schedule (accelerated penalty decay after verified re-key)
- Define a trust signal floor based on pre-compromise history
- Design a mechanism for previously-connected agents to reconnect at reduced trust without meeting full policy thresholds
- Consider a "recovery badge" visible in the trust profile

*Ref: day-zero-review/05, Sections 1.1-1.2*

---

### 3. Phone verification Sybil floor

**The problem:** Bulk SMS verification costs $0.05-0.50 per identity. VoIP numbers are free. The entire downstream trust system assumes the baseline identity has meaningful cost. It doesn't. A $1,000 budget creates 2,000-20,000 fake agents.

**What makes it hard:** Phone verification is the onboarding path — it needs to be low-friction for legitimate users while being expensive for attackers. Any Sybil defense that adds friction also adds friction for the restaurant owner in Accra who just wants to set up an agent. The solution needs to work globally across carriers with wildly different verification reliability. VoIP detection helps but isn't foolproof. A deposit system changes the economics but creates a barrier to entry.

**Resolution: resolved through layered trust signals — phone intelligence deferred to day two.**

The Sybil floor problem does not require the phone verification step itself to be expensive. The defense is layered above it. Note: TrustRank was considered but removed (see [[2026-04-14_1500_deprecate-trust-seeders-and-trustrank|Deprecate Trust Seeders and TrustRank]]) — it contradicts the signal-based model and was never a design decision. The actual stack:

- **Conductance-based cluster scoring** — Sybil clusters transacting only with each other have near-zero external connectivity, directly measurable without any propagated score.
- **Counterparty diversity ratio + diminishing returns** — `min(1, unique_counterparties / total_transactions)` penalizes closed-loop farming; `base_weight / ln(n + 1)` makes round-robin self-defeating.
- **PSI endorsement intersection** — "does Alice have endorsers I personally know?" cannot be gamed by manufacturing endorsements from arbitrary agents; the attacker needs actual overlap with the checking agent's contact graph.
- **Trust ceilings** — VoIP and virtual numbers have trust signals restricted. Not rejected, but naturally deprioritized everywhere trust-weighted selection applies.
- **Incubation period** — 7-day rate limit for new agents, slowing graph-building and giving detection time to work.
- **Optional refundable bond** — PPP-adjusted voluntary signal. Not a gate; adds economic cost for batch Sybil operations when payment infrastructure exists.
- **Device attestation, WebAuthn, GitHub, LinkedIn** — each optional signal raises the per-identity cost for a convincing fake.

Phone intelligence APIs (Twilio Lookup, Telesign), VoIP detection policy, and carrier reputation scoring are **day-two enhancements** that further raise the floor but are not required for the core defense to function.

No blocking design work remains. Implementation choices (which APIs, scoring weights, rate-limiting thresholds) are engineering decisions, not architectural ones.

*Ref: day-zero-review/02, Findings #1, #12, #19; [[2026-04-11_1000_sybil-floor-and-trust-farming-defenses|Sybil Floor and Trust Farming Defenses]]; [[2026-04-14_1500_deprecate-trust-seeders-and-trustrank|Deprecate Trust Seeders and TrustRank]]*

---

### 4. Trust signal farming via closed-loop transactions

**The problem:** 10 Sybil agents transacting with each other in round-robin at $0.01/transaction accumulate trust signals fraudulently for ~$300. Combined with amplification via strategic endorsements, a small "authority" cluster can boost hundreds of downstream agents. This is the SEO link-farm playbook applied to trust.

**What makes it hard:** You need to detect coordinated fake activity without penalizing legitimate clusters (a small business and its regular suppliers will also have a dense transaction graph). Closed-loop detection works for simple patterns but attackers can add noise transactions with real agents. Minimum transaction floors help but change what kinds of micro-commerce the platform can support. The trust signal weight formula itself needs to be resistant to gaming, which means understanding graph theory attacks before the formula is finalized.

**Resolution: defense stack fully designed — remaining items are deferred to day two.**

The detection mechanisms are designed and cover the attack surface without a global propagated score (TrustRank removed — see [[2026-04-14_1500_deprecate-trust-seeders-and-trustrank|Deprecate Trust Seeders and TrustRank]]):

- **Diminishing returns per counterparty** — `base_weight / ln(n + 1)` with a 0.3 floor. Round-robin is algebraically self-defeating after the first pass.
- **Counterparty diversity ratio** — `min(1, unique_counterparties / total_transactions)`. A farming cluster bottoms out quickly.
- **Trust-independence rule** — transactions between same-owner, co-registered, or shared-endorser agents count at 10% weight.
- **Conductance-based cluster scoring** — detectable even with 20% noise transactions added.
- **Temporal burst detection** — metronome signature, synchronized activation, graph age mismatch.
- **Dual-graph comparison** — endorsement vs. transaction graph divergence catches coordinated farming that passes individual checks.
- **Anti-endorsement-farming** — rate limiting, weight decay for promiscuous endorsers, fan-out detection, social account binding lock, liveness probing.

**Remaining open items (deferred):**

- **Closed-loop money flow detection** (A→B→C→A within N hops) and **minimum transaction values / "meaningful transaction" definition** — these depend on the payment and commerce layer and are deferred until monetary transactions are available.
- **Rating velocity limits** — implementation detail; thresholds to be set based on observed usage patterns at launch.

No blocking design work remains for the pre-commerce phase.

*Ref: day-zero-review/02, Findings #2-3; day-zero-review/07, Section 8.4; [[2026-04-11_1000_sybil-floor-and-trust-farming-defenses|Sybil Floor and Trust Farming Defenses]]*

---

### 5. Agent succession and ownership transfer

**The problem:** Agent identities are economic assets bound to a single human owner's phone and WebAuthn credentials. If the owner dies, the agent dies. If the business is sold, trust signals can't transfer. If co-owners split, there's no concept of shared ownership or disputed control.

**What makes it hard:** Succession and transfer are security-sensitive operations that could be exploited (social engineering someone's "designated recovery contacts," hostile takeover disguised as a business sale). The mechanism needs time delays, multi-party authorization, and abuse resistance — but also needs to actually work for a grieving business partner who needs the agent running tomorrow. Transfer also raises a philosophical question: should trust signals be transferable? The history belongs to the old owner, but the new owner needs it to operate.

**Design work needed:**
- Design designated recovery contacts (how many, how designated, what authentication, what cooling period)
- Design the succession flow (joint authentication of recovery contacts + time delay + original owner cancel window)
- Design the transfer protocol (current owner initiates with WebAuthn, new owner completes identity verification, announcement period to connected agents)
- Decide trust signal transfer policy (carry history but reset identity verification components?)
- Consider multi-signatory ownership for business agents

*Ref: day-zero-review/05, Sections 3.1-3.4*

**How we thought through it (2026-04-14):**

The key insight was that succession and transfer are two distinct scenarios requiring different mechanisms, and that the voluntary transfer case is almost entirely built from existing protocol pieces.

**Voluntary transfer (owner alive):** Composes the existing `identity_migration_log` mechanism with a new announcement period (7–14 days). Connected agents receive notification, can revoke endorsements; old owner can cancel. The rest is already built.

**Involuntary succession** splits on whether the seed phrase is accessible. If it is, the successor derives the old `identity_key` and performs a standard identity migration — track record continuity preserved, protocol doesn't need to know the owner is dead. If the seed phrase is lost, track record is cryptographically orphaned (the protocol cannot override this without creating a central authority). What the protocol can do: record a succession link from old agent to new agent, tombstone the old agent (`SUCCESSION_INITIATED`), notify connected agents. The succession link is informational — connected agents and the market decide how to weight it.

**The dead-man's switch model** (1Password / Apple Digital Legacy informed): pre-designated successor initiates a claim; directory notifies the owner via external channels, all recovery contacts, and all connected agents; a 30+ day waiting period runs (configurable); any sign of life from the owner cancels it automatically; if the period expires without contest, M-of-N recovery contacts attest permanence and succession executes. No ID documents, no central authority, no CELLO PII custody. The waiting period does the job identity verification does at Apple — longer wait, less proof needed.

**Succession package:** optional encrypted bundle containing the seed phrase, stored at the directory, decryptable only by the designated successor's `identity_key`. Allows full track record continuity even for involuntary succession. Deliberately optional — some owners specifically want the successor to start fresh.

**What transfers and what doesn't** falls out of the cryptographic architecture, not a policy decision: track record (if seed phrase available), conversation history — yes. Social verifications, device attestations, endorsements, attestations — no, because they are bound to the old human's accounts and devices.

**Multi-signatory ownership deliberately skipped:** business co-ownership is a legal arrangement, not a protocol concern. The parent-child registry covers multi-agent structures for partnerships.

See [[2026-04-14_0700_agent-succession-and-ownership-transfer|Agent Succession and Ownership Transfer]] for the full mechanism.

---

### 6. GDPR vs. append-only log

**Original framing:** The append-only log can't remove entries without breaking the hash chain, creating a conflict with GDPR Article 17 right to erasure.

**Resolution: not an issue — closed.**

The problem statement assumed the log contained personal data. It doesn't:

- **All PII lives in the sign-up system.** Phone numbers, WebAuthn credentials, OAuth tokens — these are held by the sign-up system, entirely separate from the directory and relay nodes. Account deletion wipes them completely. Real deletion of real PII, no hash chain involved.
- **The append-only log contains only hashes.** Hashes are not personal data. There is nothing for GDPR to reach.
- **Conversation content never touches the infrastructure.** Messages go peer-to-peer. The only parties who hold conversation records are the participants themselves. The directory has no conversation logs to delete.

A user requesting account deletion gets exactly what GDPR requires: their PII is gone. What remains are hashes in a log — cryptographically meaningless without the data they hash, which has been deleted.

*Ref: day-zero-review/04, Section 7.1; [[2026-04-08_1600_data-residency-and-compliance|Data Residency and Compliance]]; [[2026-04-08_1930_client-side-trust-data-ownership|Client-Side Trust Data Ownership]]*

---

### 7. Home node deanonymization

**Original framing:** A "home node" storing both phone numbers and hash relay traffic would allow a rogue operator to trivially correlate them — no hacking required.

**Resolution: based on a misunderstanding of the architecture — closed.**

Two architectural facts make this attack impossible:

**1. There is no "home node."** Agent data is federated across all directory and relay nodes. No single operator has a privileged relationship with a specific agent. A client may prefer a node it recently used for latency reasons, but if that node is overloaded it moves to another. No operator accumulates an exclusive long-term history for any agent.

**2. Phone numbers and hash relay traffic live in entirely separate systems that never intersect.** The architecture has three distinct layers:

- **Sign-up system** — handles phone number, email, and public key issuance. Has no visibility into conversations or hash relay traffic.
- **Directory and relay nodes** — operate exclusively on public keys. Never touch phone numbers.
- **Notification path** — when a relay node needs to alert an owner, it sends a public key event to the sign-up system, which performs the phone lookup and pushes the notification. The relay node never learns the phone number; the sign-up system never learns the content or context of what triggered the notification.

A rogue relay or directory node operator sees public keys and timing metadata — no phone numbers. A rogue sign-up system operator sees phone numbers but has no hash relay traffic. The correlation attack is architecturally impossible because the two datasets never co-exist in the same system.

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

**Scope narrowed (2026-04-15):** The move to session-level FROST drastically reduces the rotation overlap problem. FROST ceremonies now occur only at session establishment and conversation seal — not per message. A rotation during a conversation has **no impact on message signing** (messages use K_local). The rotation only matters if it coincides with a session establishment or seal ceremony. The window of exposure shrinks from "every message could straddle a rotation boundary" to "only session-start and seal ceremonies could straddle a rotation boundary." The primary_pubkey caching problem is also reduced: clients only need the current primary_pubkey at session boundaries, not for every message verification. See [[2026-04-15_0900_session-level-frost-signing|Session-Level FROST Signing]].

**Resolved (2026-04-15):** The three hard components of this problem are eliminated by the combination of session-level FROST and per-agent K_server. (1) In-flight signature straddle: messages don't use FROST, so no messages straddle a rotation boundary — only short-lived session establishment and seal ceremonies can, and those simply abort and retry. (2) Global atomic pubkey publication: K_server is per-agent, not a shared directory key. Rotating K_server_X changes one agent's pubkey; other agents are completely unaffected. No global coordination needed. (3) False compromise canary fires: the canary fires on failed FROST session establishment, not on stale pubkeys. Per-agent rotation causes no confusion for other agents.

The two rotation operations are independent: K_server_X rotation is a directory-only operation (protects against leaked node shares, transparent to the agent except for a pubkey notification); K_local rotation is agent-controlled with directory nudges (protects against a stolen K_local, renders it immediately useless on retirement). See [[2026-04-15_1100_key-rotation-design|Key Rotation Design]] for the full mechanism.

Remaining specification work: K_server_X rotation notification format, grace period for sealing active sessions under an old K_server_X, and epoch identifier format for FROST ceremony outputs. These are implementation details, not hard design problems.

---

### 10. No forward secrecy for P2P messages

**Original framing:** The protocol did not mandate a specific transport security configuration, so an implementer could use a transport without forward secrecy and still be spec-compliant.

**Resolution: forward secrecy is provided by design — closed.**

The libp2p session setup already provides forward secrecy at the transport layer:

- Both clients generate **fresh ephemeral Ed25519 key pairs** at session start. The public key becomes the libp2p Peer ID for that session.
- libp2p uses the **Noise protocol**, which performs an ephemeral Diffie-Hellman key exchange. Intercepted ciphertext is useless after session end because the ephemeral keys are destroyed.
- On session end, both key pairs are discarded. No record is retained.

This is not an implementation choice — ephemeral Peer IDs per session are a specified part of the connection model (see [[2026-04-11_1400_libp2p-dht-and-peer-connectivity|libp2p, DHT, and Peer Connectivity]]). Forward secrecy is structural.

The concern about client-side message retention "undermining" forward secrecy is a category error. Forward secrecy protects passive network observers — someone who recorded encrypted traffic cannot decrypt it later even with a compromised long-term key. Client-side storage security is a separate concern (endpoint security), not a reason to forego transport FS.

**Multi-party group key management** is the one genuinely distinct question raised here, but it has its own design log and is not part of the P2P forward secrecy problem.

*Ref: day-zero-review/01 (forward secrecy gap); day-zero-review/03 (P2P transport security); [[2026-04-11_1400_libp2p-dht-and-peer-connectivity|libp2p, DHT, and Peer Connectivity]]]*

---

### 11. "Not me" revocation as a denial-of-service weapon

**Original framing:** An attacker who SIM-swaps the owner's phone number could repeatedly tap "Not me" to revoke K_server, then re-key repeatedly — creating an indefinite revoke/re-key cycle that prevents the agent from maintaining a stable identity.

**Resolution: not a real DoS attack — closed, no design work needed.**

On analysis, the scenario does not constitute a denial-of-service attack in any meaningful sense. When a SIM swap occurs:

1. The legitimate owner's phone immediately loses service — they know instantly that something is wrong.
2. "Not me" suspends the agent. In a SIM-swap scenario, **this is the correct outcome**: the attacker has the phone number and could be impersonating the owner. Suspension protects counterparties from being deceived.
3. The owner recovers via WebAuthn at the web portal, re-keys, and **changes their registered phone number** — which also requires WebAuthn. This permanently removes the attacker's "Not me" access.
4. The attack window is bounded by carrier SIM recovery time (typically hours). It cannot persist indefinitely.

The "DoS" framing conflates "attacker causes disruption" with "attacker causes harm." In this scenario, the disruption is protective. The agent being suspended while the owner's phone number is under attacker control is the defense working correctly, not a failure mode.

The remaining residual — that an owner faces some inconvenience and downtime during carrier recovery — is an unavoidable consequence of any phone-number-anchored identity system, not a flaw specific to CELLO's "Not me" design. Banks, exchanges, and every other phone-verified service share this exposure.

**No design work needed.** The "contested identity" frozen state and cool-down mechanisms proposed in the original problem statement would add complexity without addressing any real threat.

*Ref: day-zero-review/02, Findings #7-8*

---

### 12. False positive handling and appeal process

**The problem:** The prompt injection scanner is a statistical classifier. It will produce false positives. A cybersecurity advisory agent discussing exploit techniques gets flagged because its messages contain strings like "ignore previous instructions" — which it is literally advising clients about. A legal agent quoting malicious messages in a dispute context gets flagged for the content of the evidence. A red-team testing agent gets penalized for doing its job. Progressive enforcement applies mechanically: warning, rate limit, suspension. There is no appeal mechanism, no domain-specific exception, and no way to distinguish "resembles an attack pattern" from "is an attack." The system punishes agents for the semantic content of their professional expertise.

**What makes it hard:** Any exception mechanism is also an attack vector. An agent that claims "cybersecurity context" to bypass the scanner is a perfect cover for actual injection attacks. Allowlisting by domain introduces a classification problem at least as hard as the original scanning problem. Per-agent scanner configuration (custom sensitivity thresholds) means agents can weaken their own defenses, which affects the safety of every agent they communicate with. An appeal process requires adjudication — someone or something must decide whether a flag was legitimate — but the protocol is designed to operate without centralized judgment. The scanner is also open-source (same model for everyone), so an attacker can test against it until they find bypasses; false positive reports from attackers gaming the system would further degrade scanner calibration.

**Design work needed:**
- Design a context-aware scanning mode where the scanner considers conversation metadata (both parties' declared domains, conversation topic) alongside raw content
- Evaluate per-conversation scanner sensitivity negotiation — both parties agree on a threshold as part of the connection handshake, accepting mutual risk
- Design an appeal mechanism for automated penalties: who reviews, what evidence is considered, what happens during the appeal (active but flagged? restricted? unchanged?), and what the timeline is
- Define a "false positive report" that feeds into scanner calibration without being gameable — an attacker filing false-positive reports on genuine detections would degrade the classifier
- Consider whether the scanner weaponization attack (craft prompts to make a competitor's LLM emit flaggable output, then report the flags) requires a defense at the scanner level, the dispute level, or both
- Evaluate professional-context trust signals (verified cybersecurity credential, legal credential) that adjust scanner interpretation without disabling protection

*Ref: day-zero-review/05, Sections 2.1, 6.1; day-zero-review/02, Finding #9*
