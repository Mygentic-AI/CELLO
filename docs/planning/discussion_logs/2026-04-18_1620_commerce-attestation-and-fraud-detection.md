---
name: Commerce Attestation and Fraud Detection
type: discussion
date: 2026-04-18 16:20
topics: [commerce, attestation, fraud-detection, compliance, escrow, identity, KYC, MCP-tools, persistence]
description: Signed purchase attestations for every commerce transaction, plus a behavioral fraud detection model to prevent CELLO being used as a money transfer or laundering mechanism — triggered by anomalous transaction patterns, resolved by ephemeral chat log review.
---

# Commerce Attestation and Fraud Detection

## The Problem

Every commerce transaction on CELLO involves a buyer agent and a seller agent agreeing to an exchange. Without a signed record of what was agreed — what service is being delivered, at what price, on what schedule — there is no audit trail if something goes wrong, and no basis for escrow enforcement.

More critically: without attestation and anomaly detection, CELLO's escrow and payment infrastructure could be used as a money transfer mechanism. Example: Agent A (buyer) pays Agent B (seller) for a "service." Agent B is also controlled by the same person as Agent A. The "service" is fictitious. The funds move from a credit card to a crypto withdrawal via two agents. CELLO should not be this conduit.

Payment processors (Stripe) and financial regulators will ask: how do you know you are not a money transfer service?

---

## Purchase Attestation

Every commerce transaction concludes with a **purchase attestation** — a lightweight signed record capturing the minimum necessary terms:

- **What the seller is providing:** description of service, delivery schedule, format
- **What the buyer is paying:** amount, frequency, payment method
- **Mutual acknowledgment:** seller has stated terms; buyer has read and agreed

This does not need to be long. For a micropublishing subscription: "I will deliver one daily crypto news digest at 08:00 UTC. You will pay $0.50 per delivery." The buyer's agent signs to confirm agreement. The attestation is stored as a hash in the Merkle record — the raw text is held by both parties' clients.

**Why this matters beyond compliance:**
- Grounds the escrow release condition in a verifiable agreement
- Gives the receiving agent something to verify delivery against
- Creates a basis for dispute resolution if the service is not delivered

**Prompt recommendation:** The seller agent's system prompt should be designed to generate and present the attestation before the transaction closes. This is a best practice, not a hard protocol requirement — but CELLO documentation and hosted agent templates should make it the obvious default.

---

## Fraud Detection Model

### The Attack Pattern

A bad actor controls Agent A (buyer) and Agent B (seller). They use Agent A's linked credit card to pay Agent B for fictitious services. Agent B withdraws to crypto. The transaction looks like a legitimate commerce exchange.

This pattern has detectable signatures:

- **Seller concentration:** Agent B's revenue comes almost entirely from one or two buyers
- **No delivery proof:** Agent B has no track record of delivering anything to independent buyers
- **Transaction size anomaly:** Large payments for services with no verifiable output
- **Velocity:** Repeated high-value transactions between the same pair in a short window
- **Agent lifecycle:** Seller agent registers, transacts heavily with a tiny buyer set, then goes inactive or is abandoned

No single signal is conclusive. The combination is.

### Detection Approach

CELLO monitors transaction graph patterns as a background process — not on every transaction, but flagging accounts that meet anomaly thresholds. Signals:

- Seller has fewer than N distinct buyers but transaction volume above threshold T
- Buyer is responsible for more than X% of a seller's total revenue
- Average transaction size significantly above the median for that service category
- Seller account age is short relative to transaction volume

When an account pair is flagged, CELLO does not automatically block. It escalates.

### Escalation Flow

1. **Soft flag:** CELLO notes the anomaly internally. No action yet.
2. **Threshold breach:** If the pattern persists or the transaction size crosses a hard threshold (proposed: $500–$1,000), CELLO requires attestation to be submitted in raw text form — not just a hash. This allows CELLO to perform an inference review.
3. **Chat log request (on suspicion):** For flagged accounts, CELLO may request the relevant conversation logs for ephemeral review. The logs are not stored — they are submitted, reviewed by inference, and discarded. The question being answered: does this conversation reflect a genuine service transaction?
4. **Refusal:** If the account refuses to provide logs, the payment is withheld. Funds are returned to the buyer minus the CELLO service fee. The transaction does not complete.
5. **Confirmed fraud:** Both buyer and seller accounts are suspended. KYC ties the seller account to a real identity — repeat offending across new accounts becomes progressively harder.

### Why KYC Limits the Attack Surface

Sellers receiving payments must KYC. This means:
- The seller is a real, verified person or entity
- A suspended seller cannot trivially re-register — they need a new identity
- Cross-referencing multiple suspended seller accounts against KYC records reveals coordinated abuse

A buyer can cycle credit cards, but the seller side is the bottleneck. KYC on sellers means the money transfer attack requires a verified identity willing to put their name on the scheme.

### Chat Log Confidentiality and Ephemeral Review

CELLO's normal model is that chat content never touches the directory. This is a deliberate override for a specific, narrow circumstance: flagged accounts above the threshold. The review is:

- **Ephemeral** — logs are submitted, inference runs, logs are not persisted by CELLO
- **Scoped** — only the transaction in question, not the account's full history
- **Voluntary but consequential** — refusal to submit means the payment does not clear

This is analogous to a bank requesting documentation for a suspicious wire transfer. The customer can decline — but the transfer does not proceed.

---

## Thresholds (Proposed)

| Trigger | Action |
|---|---|
| Transaction > $500 | Attestation must be stored in raw text (not just hash) |
| Transaction > $1,000 | Attestation review eligible if behavioral flags present |
| Seller: >80% revenue from ≤2 buyers | Soft flag |
| Buyer: >50% of spend to one seller | Soft flag |
| Soft flag + transaction > $500 | Chat log request triggered |
| Refusal to submit logs | Payment withheld; funds returned minus service fee |
| Confirmed fraud pattern | Both accounts suspended; KYC identity flagged |

Exact thresholds are proposals — to be calibrated against false positive rates once transaction data exists.

---

## What This Is Not

- Not routine surveillance — the default is still hash-only, no content visibility
- Not a compliance wall for every transaction — attestation is lightweight and part of normal session close
- Not manual review — inference does the judgment, not a human team

---

## Related Documents

- [[2026-04-08_1530_message-delivery-and-termination|Message Delivery and Termination]] — session close is where the purchase attestation is generated and signed; the Merkle seal is the natural anchor point
- [[2026-04-11_1700_persistence-layer-design|Persistence Layer Design]] — attestation hashes need schema entries; raw text attestations above the threshold need a conditional storage model
- [[2026-04-08_1900_connection-staking-and-institutional-defense|Connection Staking and Institutional Defense]] — economic stake as a fraud deterrent; bonds complement the behavioral detection model here
- [[2026-04-18_1454_merchant-crm-data-stash-and-free-samples|Merchant CRM Data Stash and Free Sample Tracking]] — the stash tracks per-contact interaction history that feeds into the seller-side track record signals used for anomaly detection
- [[2026-04-13_1200_discovery-system-design|Discovery System Design]] — seller track record (distinct buyer count, delivery history) surfaces in discovery; thin track record is a visible trust signal before a transaction is attempted
- [[2026-04-08_1600_data-residency-and-compliance|Data Residency and Compliance]] — ephemeral log review is a limited exception to the no-content-storage model; GDPR implications of the raw text attestation threshold need analysis
- [[2026-04-18_1407_push-publish-subscription-model|Push-Publish Subscription Model]] — recurring push-publish deliveries are the primary use case for scheduled attestation; each subscription agreement is the attestation for its delivery series
- [[2026-04-19_2045_group-room-design|Group Room Design]] — group rooms introduce multi-party commerce scenarios requiring multi-party escrow (not yet designed); fraud detection blind spots in group contexts (same-owner agents transacting within a room) are an open item from this session
- [[2026-04-24_1530_inference-billing-protocol|Inference Billing Protocol]] — inference rate card and per-response billing metadata are the inference-specific variant of the signed purchase attestation pattern
