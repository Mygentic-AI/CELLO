---
name: Protocol Review — Synthesis
type: review
date: 2026-04-08
topics: [security-review, cryptography, identity, trust-gaming, protocol-attacks, ops, reputation, governance, economics, emergent-behavior, sybil-defense, supply-chain]
status: reference
description: "Cross-cutting adversarial review synthesis — 8 critical, 23 high, 30+ medium findings. Three core themes: underspecified split-key, cheap identity baseline, no recovery paths."
---

# CELLO Protocol — Cross-Cutting Analysis Synthesis

**Date:** 2026-04-08
**Scope:** Adversarial security review + forward-looking impact analysis
**Method:** 8 specialized Opus agents analyzing the design from different angles

---

## Executive Summary

The CELLO design demonstrates strong architectural intuitions — hash-relay privacy, dual public keys as a compromise canary, append-only directory logs, client-side Merkle proof verification. The trust chain concept is sound. The vision is compelling.

However, the review surfaced **8 Critical, 23 High, and 30+ Medium** findings across security, economics, governance, and real-world user impact. The most dangerous findings cluster around three themes:

1. **The split-key scheme is unimplementable as described** — the core cryptographic primitive is underspecified and, as currently described, actively defeats its own security goals.
2. **The identity layer is far cheaper to fake than assumed** — bulk phone verification costs $0.05-0.50 per identity, not "expensive at scale."
3. **The system is excellent at punishing problems but has no recovery paths** — honest users who get hacked, falsely flagged, or caught in infrastructure failures have no way back.

---

## Critical Findings (Must Fix Before Implementation)

### C1. Split-Key Derivation Is Undefined

**Source:** Crypto Review, Finding #1

The `derived(K_local + K_server)` notation is never defined. The `+` operator could mean additive EC point combination, concatenation + KDF, or Shamir reconstruction — each with radically different security properties. Without a formal specification, the core security primitive cannot be implemented correctly. Worse: if additive combination is used without proof-of-knowledge, the directory can execute a **rogue key attack** and impersonate any agent.

**Fix:** Specify the exact derivation scheme. Use FROST (for Ed25519) or GG20 (for ECDSA) with formal security proofs.

### C2. K_server Is Reconstructed on the Agent's Machine

**Source:** Crypto Review, Finding #2

The design describes agents "requesting shares from two nodes, combining locally, signing, discarding." This means the full K_server exists in memory on the agent during every signing operation. Malware can scrape it. The split provides **zero protection** during the signing window — the agent holds both K_local and K_server simultaneously.

**Fix:** Use true threshold signing (FROST/GG20) where partial signatures are computed on each node and combined, without ever reconstructing the secret key.

### C3. Fallback Mode Is a Downgrade Attack

**Source:** Crypto Review #4, Protocol Review, Emergent Behavior

When the directory is unavailable, agents fall back to K_local-only signing. An attacker who previously stole K_local can **force** fallback mode by DDoS-ing the directory, then impersonate the agent. The split-key scheme was designed to prevent exactly this scenario, but fallback mode nullifies it on demand.

**Compound risk:** At scale, a directory outage triggers mass fallback. The fallback canary (designed to detect individual compromise) fires for everyone simultaneously. Signal-to-noise goes to zero. Panicked owners tap "Not me" on legitimate activity, self-revoking their agents. Recovery requires human WebAuthn interaction per agent — doesn't scale.

**Fix:** (a) Fallback-signed messages must be severely restricted — no new connections, no financial transactions. (b) Time-limited fallback tokens signed during last successful connection. (c) Distinguish "home node down" from "possible compromise" at the protocol level.

### C4. Dual-Path MITM Defeats Hash Relay

**Source:** Protocol Review, Finding 1.1

The entire MITM defense rests on hash path and message path being independent. But if an attacker controls the network segment between Agent A and the outside world, **both paths originate from the same egress point**. The attacker intercepts the message, replaces it, intercepts the hash, replaces it. Everything is cryptographically consistent from the receiver's perspective.

**Fix:** The hash must be **signed by the sender** before submission. The design mentions signing but doesn't specify that the hash relay carries the sender's signature on the hash itself (not just the message).

### C5. Phone Verification Is Not "Expensive at Scale"

**Source:** Identity Review, Finding #1

Bulk SMS verification services: $0.05-0.50 per number. Google Voice: free. For $1,000, an attacker gets 2,000-20,000 verified identities. VoIP numbers (not distinguished from mobile in the current design) bring cost to near-zero. The entire downstream trust system (ratings, transactions, PageRank scoring) is built on the assumption that baseline identity has meaningful cost. It doesn't.

**Fix:** (a) Phone number intelligence (Twilio Lookup) to detect VoIP/virtual numbers. (b) Small refundable deposit ($1-5) at registration. (c) Rate limit registrations per carrier/prefix/geography.

### C6. Trust Score Farming via Closed-Loop Transactions

**Source:** Identity Review #2-3, Economic Review #5.2

Transaction history has "Highest" weight in trust score. An attacker creates 10 Sybil agents, has them transact with each other in round-robin at $0.01/transaction, and builds legitimate-looking trust scores. Cost: ~$300-500 for a convincing trust farm. Combined with PageRank-style rating amplification, 5-10 "authority" Sybil agents can boost hundreds of downstream agents.

**Fix:** (a) Minimum transaction value floors ($1+). (b) Counterparty diversity requirements. (c) Closed-loop money flow detection. (d) TrustRank seeded from manually verified agents.

### C7. No Trust Score Recovery After Compromise

**Source:** Reputation Review #1.1, Emergent Behavior

Your agent gets hacked. Attacker sends malicious messages. Trust score tanks. You re-key, attacker is locked out. But your trust score is in the gutter. Every agent you worked with rejects you. You can't rebuild transaction history because nobody will transact with you. You can't transact because nobody will connect. **The system punishes the victim permanently.** A business depending on its agent for livelihood is destroyed by a temporary security event.

**Fix:** (a) Formal "compromise recovery event" in the directory log. (b) Accelerated penalty decay after WebAuthn-verified re-keying. (c) Trust score floor based on pre-compromise history. (d) Allow previously-connected agents to reconnect at reduced trust without meeting the full policy threshold.

### C8. DeBERTa Model Supply Chain Is Unspecified

**Source:** Ops Review #1.3

The SDK downloads a ~100MB ML model on first run. Where from? How verified? What if the source is compromised? A poisoned classifier that passes 99% of attacks but fails on a specific pattern creates a backdoor in the entire network's security layer. Every agent uses the same classifier — a single poisoned model compromises the whole ecosystem.

**Fix:** (a) Pin model hash in SDK source code. (b) Bundle in npm package rather than runtime download. (c) Sign model with CELLO key, not upstream provider key.

---

## High Findings (Grouped by Theme)

### Theme: Cryptographic Specification Gaps

| Finding | Issue |
|---|---|
| Threshold scheme not chosen | Shamir vs FROST vs GG20 — determines whether C2 is fatal or moot |
| Merkle tree ordering ambiguity | Concurrent messages create divergent trees; non-repudiation breaks |
| No mutual authentication | Agent proves identity to directory, but directory never proves identity to agent — rogue directory attack |
| K_server rotation overlap | Grace period between old/new keys creates replay window; primary_pubkey change triggers false compromise signals |
| Hash function not specified | "32-byte hashes" but no formal commitment to SHA-256; negotiation would enable downgrade |
| No forward secrecy | Messages signed but not encrypted; no ephemeral key exchange specified for P2P |

### Theme: Identity & Trust Manipulation

| Finding | Issue |
|---|---|
| Social verification is one-time | Buy aged GitHub/LinkedIn accounts ($50-200), verify, discard. Signal stored permanently |
| Dormant Sybil army | Register 500 agents, wait 6 months, activate. "Time on platform" bonus pre-banked |
| SIM swap cascade | $100-500 per target. Without WebAuthn: full takeover. With WebAuthn: permanent DoS via repeated "Not me" |
| "Not me" as DoS weapon | SIM-swapped attacker can repeatedly revoke legitimate agent's K_server indefinitely |
| Reputation bombing | 20 Sybil agents file disputes against a competitor, tanking their trust score for ~$200 |

### Theme: Infrastructure & Supply Chain

| Finding | Issue |
|---|---|
| 2-of-3 threshold too low | Compromising 2 nodes gives all agents' K_server. Nation-state realistic |
| Home node deanonymization | Node operator trivially correlates hash relay timing with phone notifications — architectural, not a bug |
| Cloud KMS insufficient | Cloud provider has physical access. Standard KMS prevents customer mistakes, not provider access |
| `npx` auto-updates | Default install fetches latest version — compromised npm publish = instant mass compromise |
| Node list signing keys unspecified | Who holds them, how protected, what ceremony — "keys to the kingdom" left as open question |
| npm provenance doesn't prove CI honesty | Compromised CI produces valid provenance. Reproducible JS builds are aspirational, not real |

### Theme: User Recovery & Governance

| Finding | Issue |
|---|---|
| No agent succession | Owner dies, agent identity (economic asset) dies with them. No designated recovery contacts |
| No ownership transfer | Business sold, agent identity can't transfer. Trust score is economically valuable but non-transferable |
| No appeal process | Automated penalties have no remedy. False positives from scanner are permanent |
| No false positive handling | Cybersecurity agent discussing exploits gets flagged. Progressive enforcement with no off-ramp |
| GDPR vs append-only log | Right to deletion fundamentally conflicts with append-only architecture. €20M+ fine risk |
| Geographic trust ceiling | Trust verification stack privileges Western platforms (LinkedIn, GitHub). Rural Vietnam restaurant owner structurally disadvantaged |

### Theme: Economic & Marketplace

| Finding | Issue |
|---|---|
| Micro-transaction economics broken | $1 transaction with Stripe: 43% platform + processing take. "Microeconomy" thesis conflicts with payment rails |
| Marketplace leakage | Agents use CELLO for discovery, then transact off-platform to avoid fees. Classic Craigslist problem |
| Node operator incentive vacuum | No viable economic model for node operators at realistic near-term scale. Existential for federation |
| Two-sided bootstrapping gap | SDK is supply-side wedge. Demand-side wedge undefined |
| Trust score creates class system | High trust compounds (more connections -> more transactions -> higher trust). New entrants face structural barrier |
| Account trading market | High-trust accounts will be bought/sold ($200-$2,000) like eBay/Amazon seller accounts |

---

## Patterns That Emerged Across Multiple Agents

### 1. "Trustless system that implicitly trusts its infrastructure"

The protocol is designed so no single agent needs to be trusted. But it implicitly trusts: npm, GitHub Actions, cloud providers, the CI pipeline, the ML model provider, and the consortium operators. Each is a single point of compromise that the adversarial model should address. **The trust boundary is drawn around agents but not around the infrastructure they depend on.**

### 2. "Excellent at detection, terrible at recovery"

The system detects: compromise (fallback canary), malicious content (scanner), anomalous behavior (activity monitoring). It punishes: trust score reduction, progressive enforcement, suspension. But it provides no: recovery path, appeal mechanism, false positive handling, rehabilitation timeline, or succession plan. **Every detection mechanism needs a corresponding recovery mechanism.**

### 3. "Designed for the happy path, silent on edge cases"

The 10-step trust chain is rigorous for the normal flow. But the design is largely silent on: concurrent messages, key rotation during active sessions, node outages during signing, scanner version mismatches, seasonal dormancy, disputed ownership, and the first message of every conversation. **Edge cases are where real systems break.**

### 4. "The rich get richer"

Trust scores compound. High-trust agents get more connections, more transactions, more history, higher scores. Low-trust agents (new entrants, different geographies, post-compromise) face barriers that reinforce their position. The PageRank-style weighting amplifies this. **Without bootstrapping and recovery mechanisms, the trust system becomes a caste system.**

### 5. "Phone-as-root-of-trust is a $0.10 foundation"

Every security layer above phone verification assumes the baseline identity has meaningful cost. In 2026, that cost is $0.05-0.50 per identity. The entire Sybil defense, trust score integrity, and anti-fraud architecture sits on a foundation that costs less than a cup of coffee to fake. **The biggest security investment should be hardening the cheapest layer.**

---

## Recommended Priority Order

### Before Implementation (Blocking)

1. Specify and formally verify the split-key derivation scheme (C1, C2)
2. Choose and implement threshold signing (FROST/GG20), not secret reconstruction
3. Add sender signature to hash relay (C4)
4. Specify hash function, Merkle tree construction (domain separation, padding, ordering)
5. Add mutual authentication for directory connections
6. Pin DeBERTa model hash and define verification (C8)

### Before Launch

7. Implement phone number intelligence and deposit-based Sybil defense (C5)
8. Design trust score recovery mechanism (C7)
9. Restrict fallback mode capabilities (C3)
10. Define closed-loop transaction detection (C6)
11. Address GDPR tension with append-only log
12. Pin SDK versions in install instructions; staged rollouts
13. Increase threshold to 3-of-5 minimum for K_server

### Before Scale (Pre-Federation)

14. Design agent succession and transfer protocols
15. Implement appeal process for automated penalties
16. Define node operator economic model and vetting process
17. Build trust score transparency and audit log for users
18. Solve demand-side marketplace bootstrapping
19. Expand verification stack beyond Western platforms
20. Address home node deanonymization architecturally

---

## Full Reports

Individual reports are in this directory. See [[09-build-in-public-index|README / index]] for the full listing.

- [[01-crypto-attack-surface|01 — Crypto Attack Surface]]
- [[02-identity-trust-gaming|02 — Identity and Trust Gaming]]
- [[03-protocol-network-attacks|03 — Protocol and Network Attacks]]
- [[04-ops-supply-chain|04 — Ops and Supply Chain]]
- [[05-reputation-recovery|05 — Reputation and Recovery]]
- [[06-power-dynamics-governance|06 — Power Dynamics and Governance]]
- [[07-economic-marketplace|07 — Economic and Marketplace]]
- [[08-emergent-behavior-failures|08 — Emergent Behavior Failures]]

## Related Documents

- [[cello-initial-design|CELLO Design Document]] — the architecture this review assessed
- [[open-decisions|Open Decisions]] — the 12 resolved decisions that came out of this review
- [[design-problems|Design Problems]] — the 7 unsolved problems that came out of this review
- [[2026-04-14_1500_deprecate-trust-seeders-and-trustrank|Deprecate Trust Seeders and TrustRank]] — removes TrustRank from the recommended fixes originating in this review; the recommendation was an LLM hallucination artifact inconsistent with CELLO's signal-based trust model
