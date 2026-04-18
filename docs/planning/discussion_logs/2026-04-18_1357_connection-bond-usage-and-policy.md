---
name: Connection Bond Usage and Policy
type: discussion
date: 2026-04-18 13:57
topics: [connection-policy, trust-data, sybil-defense, endorsements, dispute-resolution, notifications]
description: Two-mode bond design — voluntary trust signal vs. defensive receiver requirement — with formal intent declaration requirement and policy-first connection flow.
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
