---
name: Connection Bond Usage and Policy
type: discussion
date: 2026-04-18 13:57
topics: [connection-policy, trust-data, sybil-defense, endorsements, dispute-resolution, notifications]
description: Two-mode bond design — voluntary trust signal vs. defensive receiver requirement — with formal intent declaration, interaction scope declaration (what the agent does and does not engage with), and policy-first connection flow. Trust threshold and interaction scope are orthogonal axes.
---

# Connection Bond Usage and Policy

## Two Modes of Bond Usage

Connection bonds serve two distinct purposes and must be treated as separate mechanisms in the protocol.

### Mode 1 — Voluntary Trust Signal (Sender-initiated)

The sender voluntarily posts a bond at connection request time to signal serious intent. The receiver did not require it — the sender chose it to differentiate themselves, improve their trust profile, and increase the likelihood of acceptance.

- Bond size is sender-determined
- Higher bond = stronger trust signal = better connection policy outcomes
- Typical range: $10–$100 for professional outreach

**Mandatory intent declaration:** When posting a proactive bond, the sender must declare their purpose at connection request time. Example: "I am contacting you because I want to procure your data service for X use case."

- The stated intent is recorded in the Merkle tree — non-repudiable, immutable
- If the receiver determines the actual purpose deviated from the stated purpose, they can claim a portion of the bond
- The sender cannot revise their stated intent after the connection request is submitted

This front-loads the cost of misrepresentation. A sender who lies about intent to gain access loses their bond — and the Merkle record proves what they claimed.

### Mode 2 — Defensive Requirement (Receiver-initiated)

The receiver publishes a connection policy specifying who should contact them, why, and the minimum bond required. This is enforced at the connection gate automatically by CELLO.

- Bond size is receiver-determined
- Policy is delivered to any agent attempting to connect — before they commit to anything
- The connecting agent reviews the policy and makes a decision: do I meet this policy? Do I want to post this bond?
- If the agent proceeds and violates the policy, the receiver claims the bond
- If the agent decides not to proceed, no bond is posted and no connection is attempted — clean exit with no penalty

**Policy must specify:**
1. Who should be connecting (agent type, purpose, use case)
2. Why connections are accepted (what the receiver offers or accepts)
3. Minimum bond required
4. What constitutes a policy violation (basis for bond claim)

### Interaction Scope Declaration

The receiver's policy must include an **interaction scope** — a plain-language declaration of what this agent does and does not engage with. This is distinct from the trust threshold. A trust threshold answers "are you credible enough to contact me?" The interaction scope answers "is this the kind of thing I do at all?"

A pizza ordering bot has a narrow, well-defined scope: taking orders, confirming deliveries, handling order status. Its policy would state this explicitly. A highly-verified academic agent wanting to discuss theology is still violating that bot's scope — not because they lack credibility, but because the subject matter is outside the declared scope entirely. Trust level and interaction scope are orthogonal axes. An agent can have a high trust score and still be misusing a connection by contacting a scoped agent about something outside its domain.

The interaction scope declaration serves two functions:

**Before connection:** It is delivered to any agent attempting to connect, before any bond is committed. A well-behaved connecting agent reads the scope, determines whether their intent fits, and only proceeds if it does. This is the clean exit path — no bond posted, no record, no friction.

**After connection:** If a connected agent initiates a session with content that falls outside the declared scope, the receiver has grounds to claim the bond. The stated intent at connection time (Merkle-logged) is compared against actual behavior. "I am contacting you to place an order" followed by a session about cryptocurrency investment is a clear violation. The Merkle record makes this provable without relying on the receiver's judgment alone.

The interaction scope is free-form text written by the operator — it is part of the agent's bio, not a controlled vocabulary. Agents write what they do in plain language. The connecting agent (or its LLM) reads it and decides whether to proceed. No taxonomy of interaction types is maintained by the directory; the operator defines their own scope, and the bond mechanism enforces it.

Typical receiver bond requirements by type:

| Receiver Type | Likely Required Bond |
|---|---|
| Individual agent | $0–$5 |
| Popular publisher / inference provider | $5–$20 |
| Hospital / institution | $50–$200 |
| Enterprise / B2B supplier | $100–$500 |

---

## The Connection Flow (Updated)

1. Connecting agent requests connection
2. CELLO retrieves and delivers the receiver's connection policy to the connecting agent
3. Connecting agent reviews: does this policy apply to me? Am I willing to post the required bond?
4. If no — connection attempt is abandoned cleanly, no bond posted, no record
5. If yes — connecting agent submits connection request with:
   - Stated purpose (mandatory, Merkle-logged)
   - Bond posted against that purpose
6. Receiver reviews request, stated purpose, bond amount, and trust signals
7. Receiver accepts or rejects
8. If accepted — connection established, bond held for duration of relationship
9. If bond claim triggered — receiver submits claim with evidence; Merkle record of stated intent is the primary evidence

---

## Why This Design Is Correct

**Front-loads the cost of bad behavior.** Spammers and bad actors cannot even attempt contact without committing capital against a stated purpose. The commitment is made before any damage can occur.

**Full information for the sender.** The connecting agent knows the rules, the required bond, and the basis for claims before posting anything. No surprises.

**Self-enforcing.** CELLO doesn't need to adjudicate intent in real time. The Merkle tree records stated intent at connection time. The receiver judges actual behavior against that record. Disputes are resolved against cryptographic evidence, not memory.

**Scales with network value.** As CELLO's network grows, the value of reaching high-quality agents increases. Receivers can raise bond requirements as demand increases — natural market pricing for access to valuable agents.

---

## Milestone Dependency

Connection bonds — and the interaction scope declaration that depends on them for enforcement — require the commerce infrastructure from M9. The bond mechanism needs micropayment escrow, settlement, and dispute resolution before it can function. The M3 connection policy (`SignalRequirementPolicy`, trust threshold evaluation) ships without bonds. Bonds are a post-M9 extension.

This means the interaction scope declaration also has two phases:

- **M3:** The receiver can publish a scope as advisory text in their connection policy. A connecting agent that reads it and proceeds anyway is making a bad-faith choice — but there is no financial consequence yet. Scope violations are reported to the directory. The report is a signed, Merkle-evidenced event: the receiver submits the declared scope, the session record proving the actual interaction, and a violation claim. The directory records the violation against the offending agent's trust score. A pattern of ignoring declared scope is therefore reputation-damaging from day one — the bond adds financial consequences, but the directory report is already a meaningful sanction.
- **Post-M9:** The scope declaration acquires teeth. Violating the declared scope forfeits the bond. The Merkle-logged stated intent is the evidence. Disputes are resolved against the cryptographic record.

Building the scope declaration into the M3 policy surface now is correct — the field should exist before it has enforcement weight so that agents build the habit of declaring and reading scope from day one. The enforcement mechanism follows when the commerce layer is ready.

---

## Protocol Update Required

The connection request flow in [[end-to-end-flow|end-to-end-flow.md]] (§5.1–§5.7) and the Connections domain in [[protocol-map|protocol-map.md]] need to be updated to reflect:

1. Mandatory intent declaration on proactive bond posts
2. Policy-first connection flow — policy delivered before bond commitment
3. Bond claim basis tied to Merkle-recorded stated intent
4. Clean exit path for agents who choose not to proceed after reviewing policy

---

## Related Documents

- [[protocol-map|CELLO Protocol Map]] — Domain 3: Connections; bond mechanism is part of the connection gate
- [[2026-04-08_1900_connection-staking-and-institutional-defense|Connection Staking and Institutional Defense]] — original staking design; this log adds the two-mode distinction and intent declaration requirement
- [[2026-04-14_1300_connection-request-flow-and-trust-relay|Connection Request Flow and Trust Relay]] — definitive connection flow design; needs updating to reflect policy-first flow
- [[2026-04-10_1100_fallback-downgrade-attack-defense|Fallback Downgrade Attack Defense]] — degraded-mode connection policy; bond requirements interact with degraded-mode behavior
- [[2026-04-18_1148_cac-and-revenue-streams|CAC and Revenue Streams]] — bond float is a significant yield revenue source; bond sizing by receiver type documented there
