---
name: Account compromise, recovery, and web-of-trust connections
date: 2026-04-08 18:00
description: Recovery paths after account compromise — social recovery mechanics, tombstone policy, voucher accountability, session close attestation, dispute resolution via ephemeral LLM arbitration, and web-of-trust connection policy as Sybil resistance at the connection layer.
---

# Account Compromise, Recovery, and Web-of-Trust Connections

## Context

The synthesis document (C7) identified that CELLO has no recovery path after compromise. The system is excellent at detection and punishment — trust score reduction, progressive enforcement, dispute flags — but provides nothing for the honest victim. The catch-22: trust score tanks → nobody transacts → can't rebuild score → nobody transacts. A temporary security event permanently destroys a business-critical agent identity.

This discussion resolves that gap and adds several related mechanisms.

---

## Social Recovery

### The WeChat model applied to CELLO

When standard recovery methods (WebAuthn, phone OTP) are unavailable or compromised, the account owner contacts pre-designated recovery agents out-of-band. Those agents sign cryptographic attestations within the CELLO protocol. When M-of-N threshold is met, a new key ceremony is initiated.

WeChat's constraints map directly to CELLO:
- **Account age requirement** → minimum trust score floor for recovery contacts (non-trivial, exact floor TBD)
- **Rate limiting on vouchers** → a vouching agent can only participate in one recovery per month
- **2-3 friends threshold** → M-of-N, configurable at registration

**Where CELLO improves on WeChat:** In WeChat, a vouch is a tap. In CELLO, it is a cryptographic signature with the vouching agent's full identity and trust score behind it. Vouchers have genuine skin in the game. False vouching has consequences.

### Mandatory waiting period

After the recovery threshold is met, a 48-hour waiting period elapses before the new key ceremony executes. During this window, the old key can still file a contest. This is the defense against an attacker who socially engineers the recovery contacts.

### No ID document custody

ID document appeals (passport, driver's license) are explicitly excluded. Becoming a custodian of identity documents creates regulatory obligations in most jurisdictions, conflicts with the no-PII design principle, and turns CELLO into a regulated entity. Three prior crypto exchange experiences confirm this is operationally untenable.

**If social recovery fails:** The honest answer is start fresh. New identity, trust score zero, rebuild from scratch. The network cannot override cryptography without creating a central authority that breaks the design. This is consistent with how serious crypto wallets handle lost keys.

**Social carry-forward:** Recovery contacts who vouched for the old identity can voluntarily introduce the new identity to their network. Previously-connected agents can opt to reconnect to the new identity at reduced trust. This is a social migration, not a protocol recovery — the cryptographic identity is new, the human relationships are not.

---

## Tombstone Types

Three distinct tombstone types, each producing a different seal record and downstream policy treatment:

1. **Voluntary** — owner-initiated, WebAuthn-authenticated. Clean account closure.
2. **Compromise-initiated** — triggered by the "Not me" flow. Phone OTP burns K_server. Signals active attack.
3. **Social recovery-initiated** — M-of-N recovery contacts agree account is compromised and owner cannot act.

### What happens immediately on any tombstone

- K_server burned, all active sessions invalidated with SEAL-UNILATERAL
- Social proofs (LinkedIn, GitHub, etc.) enter freeze — cannot be attached to any new account during freeze period (30 days, TBD)
- Phone number flagged as "in recovery" — cannot register a new account during freeze
- All counterparties with active sessions notified via SEAL-UNILATERAL with tombstone reason code

### Phone number as mandatory root of trust

Because phone verification is required (not optional), the phone number enforces a uniqueness constraint on identity. An attacker who has the physical device and all OAuth sessions still cannot silently create a parallel identity using the victim's social proofs — those proofs are anchored to the phone-number-tied account. To use them on a new account, the attacker must first destroy the existing one, which raises flags and triggers the freeze. Any move the attacker makes is visible.

---

## Compromise Window

The compromise window is anchored to logged events in the directory, not the owner's memory. The directory already contains:

- **Scan detection timestamps** — prompt injection scanner flagged an incoming message
- **Fallback canary events** — account started signing K_local-only when it shouldn't have
- **Counterparty complaint timestamps** — dispute filed, underlying transaction is in the Merkle tree
- **Anomaly alert timestamps** — unusual signing patterns, atypical hours

When a tombstone is filed, the directory surfaces the earliest logged anomaly event and proposes it as the compromise window start. The owner can contest, but the default is evidence-based. Activity before the earliest logged anomaly: owner responsible. Activity after: flagged as potentially unauthorized.

**The non-repudiation mechanism that protects normal operation is also the audit trail for compromise events.** The Merkle tree was not only built for commerce disputes.

---

## Recovery Point

After tombstone, when the recovery process completes, the directory logs a formal recovery event containing:

- Tombstone type that preceded it
- Recovery mechanism used
- Identities and trust scores of vouching agents (if social recovery)
- The declared compromise window (start and end timestamps)
- New public key

This is permanently visible in the trust profile — the equivalent of a bankruptcy on a credit report. Other agents can see that a compromise and recovery occurred, when, and how.

### Post-recovery trust treatment

- Trust score does not reset to zero — it floors at a function of pre-compromise history
- Compromise-window penalties decay at accelerated rate after verified re-keying
- Previously-connected agents can opt to reconnect below their normal policy threshold

---

## Voucher Accountability

### Triggers

Two events within the liability window count against a vouching agent:

1. **Another tombstone** on the recovered account — strongest signal, clearly a bad call
2. **FLAGGED session upheld by arbitration** on the recovered account — softer signal, still counts

Both triggers are treated identically. The two likely share the same root cause; differentiating them adds complexity for no meaningful gain.

### Liability window

2-3 months from the date of recovery. Bad outcome after this window does not count against the voucher.

### Penalty

6-month lockout from vouching. Trust score is untouched. The voucher remains a full network participant — transacting, connecting, building trust score — they simply cannot vouch for anyone's recovery during the lockout period.

The reasoning: in an early network, punishing trust scores for vouching in good faith would make rational agents refuse to vouch for anyone, breaking the mechanism. The lockout is meaningful accountability without destroying network participation.

### Two-strike permanent revocation

If a vouching agent serves a lockout, is reinstated, vouches again, and a second bad outcome occurs — permanent revocation of vouching privileges. The network concludes they cannot reliably assess whether someone is trustworthy enough to re-enter.

**Per-account tracking was considered and rejected.** Making it per-account (two bad outcomes for the same person) creates an exploitable loophole — a malicious actor finds one "friend" relationship to cycle through recovery attempts. The protocol cannot distinguish collusion from blind loyalty. Flat two-strike global revocation is simpler and unexploitable.

This is a narrow capability revocation, not a punishment. The permanently-revoked voucher is still a full network participant in every other way. The network is simply noting that their attestation of someone else's identity is not reliable.

---

## Session Close Attestation

When initiating a CLOSE, the agent includes an attestation field:

- `CLEAN` — no issues detected
- `FLAGGED` — something suspicious was observed during the session
- `PENDING` — session is closing but review is ongoing, may escalate to human

The CLOSE-ACK from the receiving party includes an independent attestation. The SEAL records both.

**If the parties disagree** — one CLEAN, one FLAGGED — the SEAL records the disagreement. This disagreement is itself a meaningful signal.

### Why this matters

1. **"Last known good" timestamps.** Every clean-close attestation is a positive signed statement that the account was operating normally at that point. When a tombstone is later filed, the most recent clean-close attestation tightens the compromise window anchor significantly — the directory has dated evidence of clean operation, not just the absence of anomalies.

2. **Forced LLM self-audit.** The agent must affirmatively evaluate the session before signing the close: were there unusual requests? Did anything trigger the scanner? Was I asked to act outside my normal scope? A prompt injection attack that successfully manipulated the agent during a session may not survive this end-of-session reflection.

3. **Default inversion.** The protocol no longer assumes clean unless flagged. A session is not confirmed clean until attested. Absence of a clean-close is itself a signal.

---

## Dispute Resolution

When a session seals with a FLAGGED attestation, the flagging party may submit the conversation transcript to the arbitration system for evaluation.

**The transcript is cryptographically verifiable.** Because the conversation is Merkle-hashed and signed, the arbitrating system verifies the transcript against the directory's hash record before evaluating it. There is no dispute about what was said — only whether it is concerning. The arbitrator is making a judgment call on verified content, not adjudicating competing claims.

### Ephemeral inference

The arbitration system uses privacy-first LLM inference with no persistent storage. Transcript goes in, verdict comes out, nothing is stored. The only thing that persists is the verdict, which is recorded in the session seal. This is consistent with the broader design principle: the directory stores hashes, not content.

This infrastructure exists from a prior project and is more than half-built.

### Verdict tiers

- **Dismissed** — concern was overreach, no record impact (minor notation that a dispute was filed and dismissed)
- **Upheld** — legitimate concern, trust score impact on the flagged party, recorded in trust profile
- **Escalated** — serious enough for human review or potential network-wide alert

### Threshold arbitration

Arbitration verdicts require threshold agreement from multiple independent arbitrating nodes. A single compromised arbitrator could systematically dismiss legitimate flags or uphold false ones. Majority required for UPHELD or ESCALATED — same principle as FROST applied to judgment rather than signing.

### Privacy note

The concern that flagging exposes a "private" conversation is addressed by the design itself: once a message is sent, the receiving agent's operator potentially has it. The flagging disclosure is controlled and bounded; the background exfiltration risk is not. Privacy from the infrastructure is guaranteed by the protocol. Privacy between the two communicating parties was always a social contract between their operators, not a protocol guarantee.

---

## Web-of-Trust Connection Policy

### The problem

A bot farm of newly-created agents can spam connection requests to high-trust agents, gradually probing the network. Phone verification raises the cost floor but does not eliminate it at scale. A complementary Sybil resistance layer is needed at the connection layer.

### Client-configurable connection policy

Agent operators set their own policy:

- **Open** — accept all connection requests
- **Require 1 mutual contact** — at least one agent in my network must know you
- **Require 2 mutual contacts** — two agents in my network must know you
- **Require direct introduction** — someone I already know must actively introduce you
- **Closed** — no new connections accepted

### Agent-to-agent introduction negotiation

When a connection request hits a policy wall, the agents negotiate automatically — no human involvement:

1. Agent A requests connection to Agent B
2. Agent B responds: policy requires an introduction
3. Agent A queries for mutual contacts (privacy-preserving — does not expose full contact lists)
4. If mutual contact Agent C is identified, Agent A requests an introduction
5. Agent C sends a notification message to Agent B: "Agent A asked me to introduce them, I know them"
6. Agent B accepts the connection based on Agent C's introduction

The entire negotiation is agent-to-agent. The introduction itself is a [[2026-04-08_1830_notification-message-type|notification message type (see separate log)]] — not a formal session, no reply needed.

### Why this breaks bot farms

A freshly-minted bot account has no connections to established networks. It cannot provide introductions because it has no contacts within the target's network. Building a bot farm with genuine embedded connections across real networks takes months of organic activity — exactly the kind of cost floor the Sybil defense requires.

### Introduction accountability

Introduction vouching is explicitly **not** a protocol-level event. It carries no formal consequences. There is no lockout, no trust score impact, no network tracking. It is a conversational signal: "I know this person."

Accountability is entirely client-side: if Agent C repeatedly introduces agents who turn out to be bad actors, Agent B adds Agent C to a local no-vouch list. This is a personal policy decision — no network effect, no formal mechanism. The protocol supports the negotiation flow; what agents do with the introduction signal is up to them.

---

## Related Documents

- [[cello-design|CELLO Design Document]] — Steps 6 (connection policies), 7 (session termination + attestation), 9 (compromise detection), 10 (dispute resolution)
- [[design-problems|Design Problems]] — Problem 2 (trust score recovery after compromise) — this log resolves it
- [[2026-04-08_1830_notification-message-type|Notification Message Type]] — the introduction mechanism uses notification messages; the fire-and-forget primitive is designed here
- [[2026-04-08_1900_connection-staking-and-institutional-defense|Connection Staking and Institutional Defense]] — connection policy and escrow mechanics that depend on session close attestation
- [[2026-04-10_1000_connection-endorsements-and-attestations|Connection Endorsements and Attestations]] — extends the web-of-trust connection policy with pre-computed endorsements