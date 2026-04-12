---
name: Connection Staking and Institutional Defense
type: discussion
date: 2026-04-08 19:00
topics: [staking, escrow, connection-policy, gate-pyramid, DDoS-defense, institutions, flat-fee, inference-cost, session-attestation]
description: Proof-of-stake at the connection layer as a Sybil and DDoS defense for open institutions. Escrow mechanics, the gate pyramid principle, the creative LLM problem, and why the protocol provides primitives rather than prescribing policy.
---

# Connection Staking and Institutional Defense

## Context

The web-of-trust connection policy (require introduction, trust score floor) handles the personal and closed-business case well. But some institutions — hospitals, emergency services — must remain open to unknown inbound contacts by design. A closed policy defeats the purpose. This creates an attack surface: an attacker can flood an open institution with connection requests, burning its inference budget.

This is the same attack as flooding a hospital switchboard with voice calls. The question is what tools the protocol provides to defend against it.

---

## Connection Staking — Proof-of-Stake at the Personal Level

When connecting to an institution that requires it, the connecting agent stakes a small amount from their escrow wallet. The stake is held until the session concludes.

- **CLEAN close** → stake automatically released back to sender
- **FLAGGED + upheld arbitration** → institution can claim the stake

For honest users the net cost is zero — the stake is returned on every legitimate interaction. For attackers, mass connection attempts consume their escrow balance. The institution is literally paid by the attacker to defend against the attack.

This is proof-of-stake applied at the connection layer rather than the consensus layer. The economic model is identical: stake to participate, behave honestly or lose your deposit.

**The escrow release mechanism is the [[2026-04-08_1800_account-compromise-and-recovery|session close attestation already designed]].** No separate mechanism required — CLEAN/FLAGGED attestations in the CLOSE and CLOSE-ACK leaves trigger the escrow outcome automatically.

---

## The Gate Pyramid

For open institutions, filtering must be inference-free at all layers except the last. LLM inference is the most expensive operation — protecting it with cheap gates means attack traffic is shed before it ever reaches the token-burning layer.

**Gate 1 — Connection level (lookup, no inference):**
- Introduction policy check
- Trust score floor check
- Whitelist / blacklist lookup
- Stake requirement check (sufficient escrow balance?)

**Gate 2 — Message level (deterministic, no inference):**
- Valid signature and directory-confirmed hash
- Rate limit per sender
- Message size limit
- Declared notification type accepted by policy

**Gate 3 — Pattern matching (cheap, no LLM):**
- Known bad patterns via rule-based checks
- Message structure validation
- Sender frequency anomaly detection

**Gate 4 — DeBERTa scanner (cheap inference)**

**Gate 5 — Full LLM processing (expensive, only for traffic that cleared all above)**

By the time a message reaches the LLM, it has already proven it comes from an agent with a valid stake, sufficient trust score, valid hash, within rate limits, and passing pattern checks. The vast majority of attack traffic never reaches inference.

---

## The Creative LLM Problem

Connection staking plus arbitration works cleanly for obvious abuse — clear spam floods, immediate rejections, unambiguous bad faith. But a creative attacker LLM can pass all filter gates, engage convincingly enough to avoid detection, and slowly burn the institution's tokens while never producing an outcome. The transcript looks plausible. Arbitration — even cheap local inference — cannot reliably distinguish "bad faith actor" from "unproductive conversation." And the arbitration itself costs inference.

For this attack vector, escrow-plus-arbitration is the wrong model. The claim is too hard to prove and proving it is expensive.

A **flat non-refundable connection fee** to open institutions is more robust for the creative LLM case. No arbitration required. No intent question. You pay to connect, period. Honest users pay a small known cost. Attackers pay per attempt regardless of how convincing their LLM is. The institution claims nothing — the fee was already paid on connection.

Both models belong in the toolkit:
- **Staking + arbitration** — for clear-cut abuse cases where the claim is unambiguous
- **Flat connection fee** — for open institutions defending against creative time-wasters

---

## Protocol Provides Primitives, Clients Decide Policy

This attack is equivalent to flooding a hospital switchboard with voice calls. Hospitals already deal with nuisance calls — they have screening, hold queues, call blocking. CELLO provides the equivalent infrastructure; the institution decides what combination to apply.

The protocol provides:
- Connection challenge hooks (stake requirement, flat fee, external credential presentation)
- Filter gate infrastructure (rule engine, type system, rate limiting)
- Session close attestation (CLEAN/FLAGGED, escrow trigger)
- Arbitration infrastructure (ephemeral inference, threshold verdict)

What the client does with these tools is the client's decision. A hospital might require a stake, run only rule-based filters, and never engage an LLM until a human has screened the connection. Another institution might accept everything and absorb the inference cost. CELLO does not prescribe institutional defense policy.

---

## Phasing

Connection staking is not a day-one requirement. Requiring crypto escrow before the network has any utility would kill adoption. The first users are known, the attack surface is minimal, and the friction would be all cost with no benefit.

The protocol supports staking architecturally from day one — the hooks exist, the connection challenge mechanism is specified. But all stake requirements default to zero at launch. An institution opts in when it has a reason to.

By the time open institutions are on the network and genuinely at risk, the staking infrastructure is live and users are familiar with crypto wallets as a normal part of participation.

---

## Related Documents

- [[cello-design|CELLO Design Document]] — Connection Staking section in Step 6; the Gate Pyramid is reproduced there
- [[2026-04-08_1800_account-compromise-and-recovery|Account Compromise and Recovery]] — session close attestation (CLEAN/FLAGGED) is the escrow release trigger
- [[2026-04-08_1830_notification-message-type|Notification Message Type]] — notification rate limiting and DDoS defence share the same layered approach
- [[2026-04-10_1000_connection-endorsements-and-attestations|Connection Endorsements and Attestations]] — pre-computed endorsements reduce reliance on staking as a connection filter
- [[2026-04-10_1100_fallback-downgrade-attack-defense|Fallback Downgrade Attack Defense]] — degraded-mode policy applies the same gate pyramid principle: inference-free, layered filtering at every stage
- [[2026-04-11_1000_sybil-floor-and-trust-farming-defenses|Sybil Floor and Trust Farming Defenses]] — PPP-adjusted refundable bond parallels connection staking; both are economic Sybil defenses at different layers
- [[2026-04-11_1700_persistence-layer-design|Persistence Layer Design]] — financial schema (bonds, stakes, escrow) is an open item there; arbitration_verdicts table is the escrow release trigger for upheld disputes
