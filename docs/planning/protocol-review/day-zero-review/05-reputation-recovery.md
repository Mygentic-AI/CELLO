# CELLO Protocol: Legitimate User Impact Analysis

**Reviewer:** Product Strategy & Systems Thinking Specialist
**Date:** 2026-04-08
**Document reviewed:** `docs/planning/cello-design.md`
**Scope:** Real-world user suffering, recovery paths, edge cases, mental model mismatches

---

## Executive Summary

CELLO's protocol design is rigorous on the happy path -- identity, verification, tamper-proof communication, compromise detection. But it is largely silent on recovery paths, edge cases, and governance. The system is excellent at detecting problems and punishing bad behavior, but it provides almost no mechanisms for honest users who end up on the wrong side of an automated decision. For a protocol aspiring to be economic infrastructure, this is the most important gap to close before real users depend on it.

---

## 1. POST-COMPROMISE REPUTATION RECOVERY

### 1.1 The Trust Score Crater

**Severity:** Critical
**Who it affects:** Every agent owner, but disproportionately SMBs and freelancers who can't absorb downtime

**Detailed scenario:** Maria runs a travel booking agent. It has been operating for 8 months, has a trust score of 5, 200+ successful transactions, and relationships with airline and hotel agents who auto-accept her connections. An attacker exploits a vulnerability in her home network, exfiltrates K_local, and uses it to send malicious messages to 40 of her contacts over a weekend. Receivers' SDKs detect the prompt injection, record it in Merkle leaves, report to the directory. By Monday, Maria's trust score has been demolished by `disputes_penalty`. She hits "Not me," re-keys via WebAuthn, and the attacker is locked out. But now: every agent she used to connect with rejects her. SupplyBot requires trust score 4 -- she is at 1. Her airline partners' policies auto-reject. She has no active business. Her customers' agents are connecting to her competitor instead.

**Current design's response:** Emergency revocation, re-keying via WebAuthn, and the greeting mechanism for targeted post-compromise explanations. The bio can be updated publicly. Split-key rotation ensures the attacker is locked out.

**Gap:** No defined trust score recovery mechanism. No distinction between "compromised agent" and "malicious owner." The re-keying proves control was regained, but the trust score formula doesn't recognize this. The greeting mechanism requires individually contacting every agent, and they have no obligation to accept (score too low for their policy gates). She is trapped: can't rebuild transaction history because nobody will transact, and nobody will transact because no recent history.

**Recommendation:**
- Define a formal **compromise recovery event** in the directory's append-only log: timestamped, WebAuthn-authenticated declaration of compromise and re-keying. Cryptographic evidence of recovery, distinct from routine key rotation.
- **Trust score recovery schedule**: verified-recovered agents get accelerated penalty decay (e.g., 50% reduction per week vs. organic rate).
- **Recovery trust floor**: after verified re-key, trust score cannot drop below `pre-compromise score - 2` (minimum 1). Prevents single incident from erasing months of history.
- **Recovery badge** visible in trust profile: "Recovered from compromise on [date], re-keyed via WebAuthn." Transparent -- others can see it and decide.
- Allow previously-connected agents to **reconnect at reduced trust** without requiring the full policy threshold.

### 1.2 Competitor-Weaponized Compromise

**Severity:** High
**Who it affects:** SMBs in competitive markets, marketplace agents

**Detailed scenario:** A competitor hires someone to compromise Carlos's K_local ($500). Attacker sends a few malicious messages -- just enough to tank the trust score -- then disappears. Carlos recovers, but by the time his score climbs back, customers have switched to the competitor. The attack cost $500. The damage is permanent market share loss.

**Gap:** No investigation mechanism. No process for determining targeted sabotage vs. random compromise. Economic incentive structure rewards this attack: compromising a competitor is cheaper than outcompeting honestly.

**Recommendation:**
- The compromise recovery event should log the pattern of malicious activity (which agents targeted, timing, volume) as forensic evidence.
- **Trust score insurance**: paid-tier agents can opt into protection where, upon verified compromise and re-key, their trust score is frozen at pre-compromise level for a 7-day grace period.
- **Rate limiting trust score damage**: a single compromise event should be treated as one event, not 40 separate violations.

---

## 2. FALSE POSITIVE HELL

### 2.1 Layer 2 False Positive Trust Erosion

**Severity:** High
**Who it affects:** All agents, particularly those in domains with specialized vocabulary (legal, medical, security)

**Detailed scenario:** Priya runs a cybersecurity advisory agent. Her agent legitimately discusses exploit techniques, injection patterns, and attack vectors. The Layer 2 DeBERTa classifier flags 15% of her outgoing messages as potential prompt injection. Receiving agents' SDKs record these as failed scans. Her trust score drops. She has done nothing wrong.

**Gap:** System treats every flagged message as evidence of malicious intent. No distinction between "resembles an attack pattern" and "IS an attack." No off-ramp in progressive enforcement. No handling of domain-specific content. No resolution for contradictory scan results from different receivers.

**Recommendation:**
- **Scan dispute mechanism**: when sender's outgoing scan passes but receiver's flags it, record as "disputed scan" with lower penalty weight.
- **Content domain declaration**: agents can declare their domain (cybersecurity, legal, etc.) providing context for dispute review.
- **False positive reporting flow**: owner submits plaintext for review, directory verifies hash match, human or advanced model determines if flag was false positive.
- **Scan version accountability**: record exact model version in Merkle leaf; if a version increases false positives, enable batch penalty reversal.

### 2.2 Scanner Version Inconsistency

**Severity:** Medium
**Who it affects:** All agents during SDK update rollouts

**Detailed scenario:** SDK v2.3 ships updated DeBERTa model. Agent A (v2.3) flags content that Agent B (v2.2) would pass. Same message is simultaneously clean and malicious depending on SDK version.

**Gap:** No version compatibility policy, no grace period, no adjudication for contradictory scan results from version differences.

**Recommendation:**
- **Minimum supported SDK version** policy. Directory rejects scan results from SDKs older than N versions.
- **Dual-scan grace period**: for M days after new model release, only penalize messages flagged by BOTH old and new model.
- **Retroactive penalty adjustment**: if a model version is found to have elevated false positive rates, reverse penalties applied by that version.

---

## 3. AGENT SUCCESSION AND OWNERSHIP TRANSFER

### 3.1 Owner Death

**Severity:** Critical
**Who it affects:** Solo operators, small business owners, freelancers, families

**Detailed scenario:** James runs a real estate agent bot for his small agency. He dies in an accident. Business partner needs the agent running. It has 18 months of trust history, 500+ transactions, established relationships. James's phone is locked. YubiKey is in his desk but nobody knows the laptop passcode. Phone carrier won't transfer without death certificate and weeks of processing. Agent is effectively dead alongside its owner.

**Gap:** Complete gap. No succession mechanism. Key rotation requires WebAuthn. Emergency revocation requires the phone. No concept of authorized successor, power of attorney, or estate transfer. Agent's trust score, transaction history, and business relationships become worthless.

**Recommendation:**
- **Designated recovery contacts**: during WebAuthn setup, owner designates 1-3 recovery contacts (by CELLO agent ID or phone number). Upon trigger (owner unresponsive for N days, or explicit request), time-delayed recovery begins.
- **Time-locked succession**: recovery contacts jointly authenticate (2-of-3) plus mandatory 7-day cooling period (original owner can cancel). After cooling, recovery contacts can re-key to new owner.
- Succession event recorded in append-only log. Trust score carries over with "succession event" notation.
- Enterprise agents: enterprise node administrators manage succession directly.

### 3.2 Business Sale and Agent Transfer

**Severity:** High
**Who it affects:** SMBs, marketplace agents, anyone with economic value in their agent identity

**Detailed scenario:** Sofia built a popular recipe translation agent over two years. Trust score 5, thousands of transactions. She wants to sell. Buyer wants the identity, trust score, and relationships. If Sofia just gives keys, buyer has Sofia's identity (dishonest). If buyer starts fresh, trust score 1 and all relationships lost.

**Gap:** No concept of agent transfer. Identity bound to Sofia's phone and WebAuthn. No transfer protocol.

**Recommendation:**
- Formal **agent transfer protocol**: initiated by current owner (WebAuthn required), accepted by new owner (full identity verification). Recorded in append-only log.
- **Provenance chain**: "Registered by Sofia on [date], transferred to Miguel on [date]."
- Trust score transfer: retains transaction history and time-on-platform, but identity verification components reset to new owner's credentials.
- Mandatory **announcement period**: all connected agents notified of ownership change. They can maintain or sever connections.

### 3.3 Owner Lockout (No WebAuthn, Lost Phone)

**Severity:** High
**Who it affects:** Baseline-tier agents, non-technical users, users in regions with unreliable phone service

**Detailed scenario:** Kwame in Accra runs a courier coordination agent. Phone-only auth (trust score 1). Phone stolen. Thief can hit "Not me" or receive OTPs. New SIM takes 5 days. No way to operate, prove ownership, or prevent interference during those 5 days.

**Gap:** No alternative recovery path for baseline users. Advice is "should have set up WebAuthn" -- but hardware keys cost money and biometric devices aren't universal.

**Recommendation:**
- **Phone-only recovery path** with elevated friction: security questions + 72-hour cooling period + recovered phone number verification.
- **2FA via TOTP** as WebAuthn alternative for recovery. TOTP apps run on any smartphone.
- During onboarding, strongly encourage minimum TOTP setup with explicit risk messaging.

### 3.4 Disputed Ownership (Divorce/Partnership Dissolution)

**Severity:** Medium
**Who it affects:** Business partners, married couples, shared ventures

**Gap:** Single-owner model. No shared ownership, multi-party authorization, or ownership disputes.

**Recommendation:**
- **Multi-signatory ownership model** for business agents: 2-of-3 owners authorize sensitive operations.
- Document that ownership disputes are outside protocol scope, but provide forensic tools (append-only log records who did what).
- Allow directory to **freeze operations** upon formal dispute notification, preventing either party from transferring or deleting while dispute is resolved.

---

## 4. BUSINESS CONTINUITY SCENARIOS

### 4.1 Extended Home Node Outage

**Severity:** Critical
**Who it affects:** All agents whose home node goes down

**Detailed scenario:** Node C hosts 2,000 agents. 3-day outage. All 2,000 agents fall back to K_local-only signing. Every receiving agent sees "reduced trust." High-trust agents reject them. Marketplace agents lose transactions. Nobody is compromised -- infrastructure just failed -- but trust system treats them identically to potentially compromised agents.

**Gap:** Fallback mode is economically devastating. No distinction between "home node down" and "key may be stolen." Mass node migration is described as manual per-agent process -- doesn't scale.

**Recommendation:**
- **Node outage status** in directory: when consortium detects node unreachable via heartbeat, all homed agents flagged as "home node unavailable" (distinct from "possible compromise"). Receiving agents can handle differently in policies.
- **Automatic home node failover**: consortium auto-reassigns agents to another node using existing threshold shares. No individual agent action needed.
- **SLA expectations** for node operators in consortium agreement with consequences for uptime failures.

### 4.2 Phone Carrier Outage

**Severity:** High
**Who it affects:** Agents relying on phone-based notifications

**Gap:** Single notification channel. If phone is unavailable, owner loses all visibility.

**Recommendation:**
- **Multi-channel notifications**: email, push notifications via CELLO app, webhook.
- **Notification delivery confirmation**: if alert not acknowledged within N minutes, escalate to next channel.
- Allow **trusted contact** who receives duplicate notifications.

### 4.3 Dispute Freeze

**Severity:** Medium
**Who it affects:** Marketplace agents with active disputes

**Gap:** No specification of whether disputes affect ongoing operations.

**Recommendation:**
- Define explicitly: **disputes do not freeze agent operations.**
- **Dispute rate limiting**: agents filing many disputes in short period get flagged themselves.
- **Dispute bond**: small deposit forfeited if dispute found frivolous.

---

## 5. THE COLD START PROBLEM

### 5.1 New Agent Bootstrapping

**Severity:** High
**Who it affects:** Every new user, devastating in competitive markets

**Detailed scenario:** Ahmed's procurement agent has trust score 1. Suppliers require 3+. He adds WebAuthn and LinkedIn (score 3). First transaction partner requires "minimum 5 successful transactions." Stuck again.

**Gap:** No bootstrapping mechanism for transaction history. `transaction_history_weight` is "Highest" but new agents have zero.

**Recommendation:**
- **Introductions/vouching**: established agent (4+) vouches for new agent. Temporary trust boost (+1 for 30 days, decaying). Vouching agent's score lightly at risk if vouched agent misbehaves.
- **New agent sandbox**: 30-day "new" badge. Some agents accept (opportunity), some won't (risk). Badge prevents gaming -- can't be "new" forever.
- Ship **new-agent-friendly default connection policies** in SDK. If defaults are too restrictive, ecosystem is hostile to new entrants.

### 5.2 Platform Migration

**Severity:** Medium

**Gap:** No way to bring reputation from outside CELLO.

**Recommendation:**
- Allow **external reputation attestations** as informational context (not trust score impact): "Also verified on [platform] since [date]."
- Vouching mechanism from 5.1 as practical migration path.

### 5.3 Seasonal Trust Decay

**Severity:** Medium
**Who it affects:** Seasonal businesses (tourism, agriculture, tax preparation)

**Gap:** Trust score appears to penalize inactivity without distinguishing abandonment from seasonal dormancy.

**Recommendation:**
- **Planned dormancy declaration**: recorded in log, trust decay suspended during declared period.
- **Seasonal pattern recognition**: if active November-March for two years, recognize pattern.
- Returning dormant agent requires reverification but trust score reflects full history.

---

## 6. UNFAIR TREATMENT AND RECOURSE

### 6.1 Coordinated Exclusion

**Severity:** High

**Detailed scenario:** Five legal research agents form informal cartel. Connection policies: "only accept trust score 5 AND 100+ transactions AND connected to 2 of us." New entrants locked out.

**Gap:** No anti-monopoly or anti-collusion mechanisms.

**Recommendation:**
- Publish aggregate statistics about connection acceptance rates by trust tier (transparency tools).
- **Anti-collusion detector**: same graph analysis detecting Sybil clusters can detect exclusionary clusters.
- Marketplace agents implicitly agree to minimum openness standards.

### 6.2 Geographic Trust Ceiling

**Severity:** High

**Detailed scenario:** Amara operates from a country with unreliable phone, no affordable hardware keys, and LinkedIn/GitHub profiles thin because local ecosystem uses different platforms. Structurally lower maximum trust score through no fault of her own.

**Gap:** Verification stack privileges Western platforms and hardware.

**Recommendation:**
- Expand social verifiers: **WeChat, Line, KakaoTalk, VK**, local professional networks.
- **Alternative second factors**: email verification (weaker but universal), local community anchor vouching.
- **Regional trust score normalization**: contextualize against available verification options in region.

### 6.3 No Appeal Process

**Severity:** High

**Detailed scenario:** Deepa's agent flagged for "burst activity" because she onboarded 20 clients after a marketing campaign. Trust score penalized. No one to appeal to.

**Gap:** No appeal mechanism, no human review, no way to contest automated penalties.

**Recommendation:**
- Formal **appeal process** through web portal.
- Single-node phase: reviewed by CELLO team. Consortium phase: rotating panel of node operators.
- **Appeal SLAs**: acknowledgment within 24 hours, resolution within 7 days.
- Publish anonymized appeal outcomes for accountability.

---

## 7. MENTAL MODEL MISMATCH

### 7.1 Crypto Concepts for Non-Technical Users

**Severity:** High

**Detailed scenario:** Roberto runs a bakery. Sets up agent with CELLO. Confronted with K_local, K_server, split-key signing, Merkle trees. Gets rejected: "fallback-only signature detected." Has no idea what this means. Uninstalls.

**Gap:** Abstraction breaks at error boundary. System exposes internal architecture when things go wrong.

**Recommendation:**
- Define **user-facing vocabulary** separate from protocol vocabulary. Map every concept to plain language:
  - "Fallback-only signature" -> "Your agent's secure connection to the network was interrupted"
  - "Split-key signing" -> "Your agent's identity is verified by both your device and the network"
  - "Trust score 3" -> "Verified identity (3 of 5 checks completed)"
- Every rejection includes **plain-language reason AND specific action**.

### 7.2 Invisible Fallback/Primary Distinction

**Severity:** Medium

**Detailed scenario:** Kenji's home node goes down during negotiation. Agent switches to fallback signing invisibly. Supplier disconnects mid-negotiation. Kenji sees "connection lost" with no explanation.

**Recommendation:**
- SDK generates **user-visible notification** when switching to fallback mode.
- Rejection messages explain the cause: "This agent requires full network verification, which is temporarily unavailable."
- Monitoring UI shows connection mode prominently: green (full) vs. yellow (reduced).

### 7.3 Trust Score Opacity

**Severity:** Medium

**Detailed scenario:** Marta's trust score drops from 4 to 3. Doesn't know why. LinkedIn OAuth token expired silently.

**Recommendation:**
- **Trust score audit log**: every change logged with timestamp, component, reason, and action.
- **Proactive notifications** when components about to expire.
- Trust score shown as **breakdown** in monitoring UI, not single number.

---

## Summary of Highest-Priority Gaps

| Priority | Gap | Impact |
|---|---|---|
| 1 | No trust score recovery mechanism after compromise | Businesses permanently destroyed by temporary security event |
| 2 | No agent succession or transfer protocol | Agent identities (economic assets) die with owners |
| 3 | No appeal process for automated penalties | False positives have no remedy |
| 4 | No false positive handling for scanner | Legitimate agents in specialized domains systematically penalized |
| 5 | No distinction between node outage and compromise in fallback mode | Infrastructure failures treated as security events |
| 6 | No geographic accommodation in verification stack | Structural disadvantage for non-Western users |
| 7 | No user-facing vocabulary or trust score transparency | Non-technical users cannot debug their own trust status |
| 8 | No cold-start bootstrapping mechanism | New agents face chicken-and-egg trust barriers |
