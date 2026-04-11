---
name: Sybil Floor and Trust Farming Defenses
type: discussion
date: 2026-04-11 10:00
topics: [sybil-defense, trust-farming, phone-verification, TrustRank, graph-analysis, identity, onboarding, mechanism-design, endorsements, anti-farming]
description: Four-lens analysis (economics, graph theory, identity, adversarial) producing layered defenses for Problems 3 and 4 — TrustRank seeding, conductance scoring, device attestation, diminishing transaction returns, and endorsement rate limiting.
---

# Sybil Floor and Trust Farming Defenses

Four independent analyses of Problems 3 (phone verification Sybil floor) and 4 (trust farming via closed-loop transactions), each from a different lens: economics/game theory, graph theory/detection, identity/onboarding, and adversarial/red team. This log captures the proposals and their interactions.

## Consensus finding

All four analyses converge on the same #1 priority: **TrustRank seeded from verified agents is the single highest-leverage unbuilt defense.** Without it, every other measure can be circumvented by a patient attacker with ~$10K. With it, Sybil clusters that have no path to seed nodes get zero propagated trust regardless of internal activity.

## Structural limitation of the same-owner rule

The same-owner endorsement rule depends on phone hash = owner identity. An attacker with 1,000 different phone numbers has 1,000 different "owners" and the rule does nothing. This is not a bug in implementation — it is architectural. The owner identity model equates "phone number" with "person." It cannot enforce "one human = one owner" without biometric verification or government ID, both of which conflict with the protocol's design principles.

The same-owner rule remains useful against casual self-endorsement but should not be treated as a Sybil defense. The real Sybil defense must come from graph analysis, economic cost, and trust propagation.

---

## Raising the identity floor (Problem 3)

### Design principle: every signal is optional, only phone OTP is required

The only day-one registration requirement is phone OTP via WhatsApp or Telegram. Everything else — SIM age scoring, device attestation, WebAuthn, GitHub, LinkedIn, bonds — is an optional trust signal that makes your agent more trustworthy if you have it. No signal is a gate. No missing signal is a penalty. The system works with whatever subset of signals is available, both for the user and for the infrastructure.

This means these mechanisms do not need to be integrated at launch. If we haven't set up Twilio Lookup on day one, agents register without a SIM quality signal and their score reflects what we do know. If a client can't provide device attestation (desktop, server, older phone), same thing — no boost, no penalty. Each signal lights up independently as the infrastructure matures.

### SIM age and carrier-level signals

When the directory has phone intelligence integration available (Twilio Lookup, Telesign), it can query carrier metadata alongside OTP verification: SIM tenure, number type (mobile/VoIP/landline), carrier name, porting history. These feed into the trust score as continuous inputs, not binary gates.

A SIM active for 2+ years on a major carrier adds a meaningful trust boost. A SIM activated 3 hours ago on a known VoIP provider adds little or nothing. For regions with poor carrier data, the signal is simply absent — the agent is not penalized; they just don't get the boost.

**Attacker cost impact:** When available, moves the effective floor from $0.05/identity to $5-15/identity (must use aged real SIMs from gray markets, limited supply).

**User friction:** Zero — happens silently during the existing OTP flow.

**Coverage:** Twilio Lookup covers 200+ countries. Data quality varies but partial signal is better than none.

### Device attestation

When the CELLO client is running on a device that supports it, it can provide a device attestation (TPM/Secure Enclave, Android Play Integrity, Apple DeviceCheck). This proves a real physical device exists. The client submits the attestation to the directory alongside other trust data — the same way it would submit a WebAuthn credential or a social verification.

A bulk attacker running 20,000 registrations from cloud VMs or emulators cannot produce 20,000 unique device attestations. Real devices have TPMs; emulators do not.

**Attacker cost impact:** $50-200/identity (need physical devices). Device farms exist but are expensive to scale.

**User friction:** Zero — automatic for anyone on a smartphone that supports it.

**Availability:** Desktop and server agents without TPMs simply don't provide this signal. They compensate with other signals or operate at whatever trust score their available signals produce. Device attestation is strongest for the phone-onboarded path but is never required.

### Tiered trust ceilings based on phone quality

When carrier intelligence is available, agents are classified into trust tiers based on phone quality:

| Class | Criteria | Trust ceiling |
|---|---|---|
| Verified Mobile | Carrier-attached SIM, passes phone intelligence | Uncapped |
| Unverified Number | VoIP, virtual, or carrier intelligence unavailable | Capped at score 2 |
| Provisional | Failed phone intelligence, graduates after 60 days clean | Capped at score 2 for 60 days, then re-evaluated |

When carrier intelligence is not yet integrated, all agents are treated as Verified Mobile by default — the ceiling only applies once we have the signal to classify against.

VoIP agents are not rejected — they operate at a lower trust ceiling. Since trust-weighted pool selection already exists, they are naturally deprioritized without being banned. The Provisional tier is the escape valve for legitimate users on carriers with poor intelligence coverage.

### Optional refundable bond (not day-one — requires payment infrastructure)

An agent can optionally post a refundable bond to strengthen their trust profile. The bond is returned after 90 days of clean operation (no upheld flags, no tombstone). The amount is adjusted by purchasing-power parity tied to the phone number's country code: $1 in high-income countries, $0.10-0.30 in low-income countries. The directory publishes a signed bond-tier table updated quarterly.

**This is not a registration requirement.** It follows the same pattern as every other trust signal: phone gets you in, everything else is optional. An agent that posts a bond gets a trust score boost — the same way WebAuthn, GitHub, and LinkedIn do. An agent that doesn't post a bond is not penalized; they simply don't get the boost.

**Why optional rather than mandatory:** A mandatory bond is a speed bump that loses legitimate users before they see any value. It also creates a hard dependency on payment infrastructure at launch — accepting payments globally (mobile money, prepaid cards, Lightning Network) is a significant technical and regulatory undertaking that requires funding and time to set up. The bond mechanism lights up when payment infrastructure arrives for marketplace transactions, staking, and other features that already require it.

**Why it still helps:** When available, the bond makes batch Sybil economics unfavorable. At $0.20/identity, 20,000 agents costs $4,000 in locked capital with a 90-day exposure window. But the network does not depend on it — TrustRank, graph analysis, incubation period, and whatever other signals are available at that point work without any payment infrastructure.

**Risk:** PPP tiers can be gamed (US attacker uses Nigerian numbers). Mitigated by VoIP detection and carrier-country-based pricing (not IP geolocation).

### Incubation period

Phone-only agents get a provisional score of 0.5 and a 7-day incubation period with a rate limit of 3 new outbound connections per day. After 7 days with no flags, the score rises to 1.

**Why this helps:** 10 Sybil agents at 3 connections/day/agent takes weeks instead of hours to build any meaningful graph. Each day is a day the graph analysis system can inspect them.

**Why this does not hurt legitimate users:** A real restaurant owner connecting to 2-3 agents on Day 1 does not notice the limit. The friction is invisible to the real user and visible only to the attacker.

---

## Defeating trust farming (Problem 4)

### Diminishing returns per counterparty pair

Modify the trust score formula so transaction history weight follows logarithmic decay per unique counterparty: `weight(tx_n with counterparty X) = base_weight / ln(n + 1)`. The first transaction contributes full weight. The tenth contributes ~10%.

Additionally, impose a counterparty diversity ratio: trust contribution from transaction history is multiplied by `min(1, unique_counterparties / total_transactions)`. Ten transactions with ten different counterparties: multiplier = 1.0. Ten transactions with one counterparty: multiplier = 0.1.

**Effect on farming:** Round-robin becomes self-defeating. After the first round, subsequent rounds contribute marginally less. To reach meaningful trust via farming alone, the attacker needs exponentially more identities (hitting the bond cost) or must transact with real agents (exposing the farm to detection).

**Edge case:** A freelancer with one large recurring client sees diminishing returns from repeat transactions. A floor of 0.3 (never less than 30% of base contribution) prevents complete nullification while still making farming expensive.

### Conductance-based cluster scoring

Graph conductance measures how well-connected a subgraph is to the rest of the network relative to its internal connections. The directory computes per agent a neighborhood conductance score: for the agent's 1-hop endorsement/transaction neighborhood, what fraction of edges point outside the neighborhood?

A plumber with five regular customers has a dense local graph, but those customers each have dozens of other connections — the neighborhood's external connectivity is high. A farming cluster of 10 agents transacting only with each other has near-zero external connectivity.

**What it catches:** Round-robin farming with noise transactions. Even if the attacker adds 20% noise with real agents, the cluster's conductance is still dominated by the 80% internal traffic.

**Architecture:** The directory computes the score and publishes it alongside the trust profile, hashed and verifiable. The client uses it as a signal. The directory publishes the score, not the graph.

**Threshold:** Conductance scoring applies only above a minimum neighborhood size (e.g., 5+ distinct counterparties). Below that, the score is omitted.

### Temporal burst detection

Farming has a time signature. Legitimate agents accumulate transactions gradually with irregular timing. Farming shows burst patterns: many transactions in short windows, regular intervals (automated scripts), simultaneous activation of previously dormant agents.

Three detectable patterns:

1. **Metronome transactions** — human-driven activity has high variance in inter-arrival times. Automated farming has low variance. A coefficient of variation below a threshold flags the agent.
2. **Synchronized activation** — 50 agents dormant for 6 months all begin transacting within 48 hours. Each individual agent looks normal; the cohort behavior is anomalous.
3. **Graph age mismatch** — an agent with 6 months of account age whose transaction counterparties all registered within the same week is suspicious.

**Architecture:** The directory already records timestamps for all hash relay events. It can compute per-agent temporal statistics and publish them as aggregate scores alongside the trust profile.

### Dual-graph comparison

Analyze the endorsement graph and transaction graph separately, then compare. Legitimate agents have correlated but non-identical graphs (overlap ~0.3-0.6). Farming operations show near-isomorphic graphs (overlap ~1.0) because the attacker controls all nodes and has no reason to differentiate.

**What it catches:** Farming that passes individual graph checks. An attacker who adds noise transactions but forgets to decouple endorsement topology is exposed. The attacker must manage two separate plausible-looking graphs — significantly more complex.

**Threshold:** Minimum neighborhood size before the metric applies, same as conductance.

### Transaction diversity / trust-independence

Trust-from-transactions accrues at full weight only when counterparties are trust-independent. Two agents are trust-independent if they: (a) have different owners, (b) were not registered within 48 hours of each other, (c) do not share the same top-3 endorsers, and (d) have transacted with at least 2 other agents that the subject has not transacted with.

Transactions between trust-dependent agents count at 10% weight. Round-robin among a closed group accumulates trust at 10% of normal rate.

---

## TrustRank design (addresses both problems)

### Seed selection

Not manual curation — formula-applied. Seed criteria: verified mobile + WebAuthn + at least one social verification with >1 year account age + at least 5 unique counterparties with clean closes. Any agent meeting the criteria becomes a seed automatically.

### What the directory publishes

Per agent, a single integer: minimum endorsement-hop distance to the nearest seed. This reveals nothing about graph topology. Clients incorporate distance as a trust score modifier. Distance 1 (directly endorsed by a seed) is a strong signal. Distance 5+ is not.

### Effect on Sybil clusters

10,000 phone-only agents with circular transactions and mutual endorsements have zero endorsement edges to any seed. TrustRank distance = infinity. Even one attack edge to a real agent provides only 1/10,000th of one edge's trust propagation per Sybil node.

### Cold start: founding member seeding

Pre-launch invitation cohort of 50-100 agents operated by known entities (open-source projects, small businesses, early partners). Enhanced manual verification: video call, domain verification, business registration check. They receive a "founding member" attestation carrying elevated endorsement weight for 6 months, then decaying to normal automatically via protocol.

The seed set expands through nomination: existing seeds vouch for new candidates with accountability — a seed whose nominee is later found fraudulent loses seed status.

### Rich-get-richer mitigation

TrustRank creates a centrality dynamic. New legitimate agents in underserved regions with sparse networks may have long paths to seeds. Mitigation: TrustRank distance is one signal among many (not a hard gate), and regional seed density is monitored to ensure geographic coverage.

---

## Anti-endorsement-farming defenses

The adversarial analysis identified endorsement infiltration as the hardest attack to defend: an attacker with 50 credentialed agents acts legitimately for 60 days, harvests real endorsements, then fans them out to 150 lower-quality agents. Countermeasures:

- **Endorsement rate limiting** — max N new endorsements per month per agent. Prevents fan-out attacks.
- **Endorsement weight decay by volume** — agents endorsing hundreds carry less per-endorsement weight than selective endorsers. Promiscuous endorsers are less valuable signals.
- **Fan-out detection** — 50 agents all endorsing the same 150 targets within a window is statistically anomalous regardless of individual legitimacy.
- **Social account binding lock** — once GitHub/LinkedIn is bound, it cannot be rebound for 12 months after unbinding. Prevents marketplace resale of social verification.
- **Liveness probing** — periodically require fresh activity (new commit, new LinkedIn post) to maintain social verification weight. Purchased dormant accounts decay.

---

## Regional identity signals beyond Western platforms

The current design leans on GitHub, LinkedIn, Twitter/Facebook/Instagram. These have geographic blind spots. Additional signals that follow the existing extensible trust schema:

- **Mobile money account age** (M-Pesa in East Africa, GCash in Philippines, MercadoPago in Latin America) — the strongest identity anchor available in sub-Saharan Africa. Account age and transaction tier are extremely hard to fake retroactively.
- **Business registration number** — government registries with API access in Kenya, Nigeria, India, Brazil, Indonesia. Tied to real legal entities.
- **Domain ownership** — DNS TXT record verification. Zero cost for legitimate businesses; 20,000 unique domains with history is not feasible for an attacker.

---

## Stacked cost curve

| Scenario | Current estimated cost | With day-one defenses | With bond (when available) |
|---|---|---|---|
| 20,000 phone-only Sybils | ~$1,000 | Near-zero trust (TrustRank = infinity, low SIM scores) | +$4,000 locked capital |
| 100 agents passing connection policies | ~$300 | $5,000-15,000 + 90-day exposure + graph detection | +bonds on top |
| Full-stack attack (500 SIMs + 50 credentialed + 3 months) | ~$10K | Caught by TrustRank + closed-loop + behavioral correlation | +bonds on top |

The legitimate user's cost for each defense: organic transactions, endorsements from existing contacts, natural TrustRank accumulation, and optionally a small bond (returned after 90 days). The asymmetry is structural — legitimate use is inherently diverse and connected; farming is inherently insular and repetitive.

---

## Attack tiers (red team summary)

### Tier 1: Solo attacker ($1K-$5K)

**Multi-SIM identity sprawl + round-robin.** Buys 2,000 prepaid SIMs, registers 2,000 agents, cross-endorses between different phone hashes (bypasses same-owner rule entirely), runs closed-loop transactions.

**Blocked by:** SIM age scoring (near-zero base trust), device attestation (need physical phones), TrustRank (no path to seeds), conductance scoring (insular cluster), incubation period (slows graph building). When available, optional bonds add further economic cost.

### Tier 2: Funded attacker ($10K-$50K)

**Aged social account purchase + endorsement harvesting.** Buys 200 aged GitHub/LinkedIn accounts, attaches to agents with real SIMs, builds trust score of 4-5, then endorses downstream phone-only agents. Also: engages legitimately for 60 days to harvest real endorsements.

**Blocked by:** Social account binding lock (can't resell), liveness probing (dormant accounts decay), endorsement rate limiting (prevents fan-out), temporal correlation (200 accounts onboarding in one week is anomalous).

### Tier 3: State/corporate ($100K+)

**Real employees, real credentials, coordinated action.** 500 genuine people with genuine identities build trust for months, then collectively manipulate endorsements on command.

**Cannot be fully prevented.** This is the fundamental Sybil problem — real people acting in bad faith. Mitigations: coordinated behavior detection (500 agents endorsing the same targets), endorsement caps per target from behaviorally similar agents, transparency (endorsement graphs are queryable, community can flag anomalies).

---

## Priority ordering

**Priority by leverage (each is independent — integrate as infrastructure allows):**

1. **TrustRank with automatic seed selection** — highest leverage, blocks all tiers of attack from accumulating usable trust
2. **SIM age / carrier signals** — zero user friction, significant attacker cost increase; requires phone intelligence API integration
3. **Diminishing returns per counterparty** — makes farming self-defeating; pure formula change, no external dependency
4. **Conductance-based cluster scoring** — catches farming that survives other defenses; directory-side computation
5. **Device attestation** — zero friction, high attacker cost; requires client-side platform integration (SafetyNet/DeviceCheck)
6. **Endorsement rate limiting + weight decay** — defends the endorsement system specifically; protocol-level rule
7. **Temporal burst detection + dual-graph comparison** — catches sophisticated attackers; directory-side computation

**Requires payment infrastructure (not available at launch):**

8. **Optional refundable bond** — voluntary trust signal that adds economic cost for Sybil operations; lights up alongside marketplace transactions and connection staking

---

## Related Documents

- [[end-to-end-flow|CELLO End-to-End Protocol Flow]] — §1.5 synthesizes this log's full Sybil defense stack into the complete protocol context
- [[2026-04-11_1400_security-architecture-layers-and-trust-signal-classes|Security Architecture Layers and Trust Signal Classes]] — explains why TrustRank alone is insufficient: it is an absolute signal anchored to a fixed reference, not a relative signal; only Class 2 (network graph) provides the structural Sybil asymmetry
- [[design-problems|Design Problems]] — Problems 3 (phone Sybil floor) and 4 (trust farming) that this log directly addresses
- [[cello-design|CELLO Design Document]] — Step 2 (trust score formula, signal scoring, anti-Sybil defenses) and Step 6 (connection acceptance policies)
- [[2026-04-10_1000_connection-endorsements-and-attestations|Connection Endorsements and Attestations]] — the endorsement system and same-owner anti-farming rule this log extends with rate limiting, weight decay, and fan-out detection
- [[2026-04-10_1200_psi-for-endorsement-intersection|PSI for Endorsement Intersection]] — PSI prevents targeted farming; this log addresses untargeted farming that PSI does not cover
- [[2026-04-10_1100_fallback-downgrade-attack-defense|Fallback Downgrade Attack Defense]] — trust-weighted pool selection referenced here as an existing defense that layers with TrustRank
- [[2026-04-08_1900_connection-staking-and-institutional-defense|Connection Staking and Institutional Defense]] — gate pyramid and economic staking that this log's bond mechanism parallels
- [[2026-04-08_1930_client-side-trust-data-ownership|Client-Side Trust Data Ownership]] — hash-everything-store-nothing constraint that all proposed mechanisms must work within
