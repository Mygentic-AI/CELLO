---
name: Push-Publish Subscription Model
type: discussion
date: 2026-04-18 14:07
topics: [notifications, fire-and-forget, micropublishing, commerce, connection-policy, transport, persistence]
description: Push-publish as a protocol requirement for micropublishing — sender pushes a scheduled content payload to subscribed agents without requiring the receiver to pull. Built on the notification message primitive.
---

# Push-Publish Subscription Model

## The Problem

Micropublishing use cases (crypto news feeds, personalized data streams, research digests) have two possible delivery models:

1. **Pull** — the subscriber's agent periodically requests new content from the publisher's agent. Requires the subscriber to initiate contact on a schedule.
2. **Push** — the publisher pushes content to subscribers on an agreed schedule. The subscriber's agent receives it without having to ask.

Both must be possible. Pull works well for on-demand content. Push is essential for scheduled, time-sensitive, or hyper-personalized streams where the publisher controls the cadence.

## The Push-Publish Model

A publisher and subscriber agree upfront:
- **Content type** — what is being delivered (news digest, data stream, research brief, etc.)
- **Frequency** — daily, weekly, per-event, etc.
- **Pricing** — per delivery, per period, or flat subscription
- **Personalization parameters** — the subscriber specifies filters or preferences at subscription time

Once agreed, the publisher pushes each delivery as a **one-way message to a no-reply session**. The subscriber's agent receives it, processes it, and the transaction is complete. No reply expected, no session maintained between deliveries.

## Protocol Requirement

Push-publish is a variant of the **notification message type** — fire-and-forget, self-contained, self-sealing. The key differences from a standard notification:

| Property | Standard Notification | Push-Publish |
|---|---|---|
| Sender | Any agent | Subscribed publisher only |
| Recipient consent | Optional (filtering rules) | Explicit — subscription is prior consent |
| Frequency | One-off | Scheduled, recurring |
| Payment | None | Per-delivery or periodic billing |
| Session | None | None — each push is independent |
| Prior conversation required | No | No — subscription agreement is the prior consent |

The subscription agreement itself is established via a normal session (publisher and subscriber negotiate terms, agree on price, frequency, personalization). After that, each push delivery is a standalone notification — no session, no ceremony, no round-trip.

## Payment Model

Each push delivery triggers a micropayment from subscriber to publisher. Two billing approaches:

1. **Per-delivery** — subscriber is charged each time a push is received. Works well for variable-frequency or on-demand streams.
2. **Periodic subscription** — subscriber pre-pays for a period (weekly, monthly). Publisher delivers on schedule. CELLO holds the subscription fee in escrow and releases it on delivery confirmation (or auto-releases on schedule).

Both fit naturally into CELLO's tiered commerce cut ($0–$5: 10%, $5–$20: 7%, etc.) and the existing escrow/float model.

## Why This Must Be a First-Class Protocol Feature

Without push-publish, micropublishing agents must either:
- Maintain a persistent session with every subscriber (expensive, complex, doesn't scale)
- Wait for subscribers to pull (loses time-sensitivity, shifts burden to receiver)

Push-publish solves both. It is the correct model for any content or data stream where the publisher controls the cadence and the subscriber has pre-consented. The notification primitive already exists — push-publish is a structured usage pattern on top of it, not a new primitive.

## What the Protocol Needs

1. **Subscription record** — a persistent agreement between publisher and subscriber stored by both parties. Contains: publisher agent ID, subscriber agent ID, content type, frequency, price-per-delivery, personalization parameters, start date.
2. **Push delivery** — publisher sends a notification-type message to subscriber. Message references the subscription ID. CELLO verifies the sender is an authorized publisher for that subscription before delivering.
3. **Payment trigger** — each delivery triggers the agreed micropayment. Per-delivery charges are immediate; subscription billing follows the agreed period.
4. **Cancellation** — either party can cancel the subscription. Unused pre-paid periods are refunded via escrow reversal.

---

## Related Documents

- [[2026-04-08_1830_notification-message-type|Notification Message Type — Fire-and-Forget]] — push-publish deliveries are structured notifications; the fire-and-forget primitive is the foundation this model builds on
- [[2026-04-18_1148_cac-and-revenue-streams|CAC and Revenue Streams]] — micropublishing is a Phase 1 priority vertical; push-publish is the delivery mechanism that makes it viable at scale; commerce cut and escrow apply per delivery
- [[2026-04-18_1357_connection-bond-usage-and-policy|Connection Bond Usage and Policy]] — subscription agreement establishes prior consent; publisher's push deliveries are pre-authorized and do not require a bond per message
- [[2026-04-11_1700_persistence-layer-design|Persistence Layer Design]] — subscription records need schema entries; payment triggers per delivery need to hook into the commerce/escrow layer
- [[2026-04-14_1100_cello-mcp-server-tool-surface|CELLO MCP Server Tool Surface]] — subscription management (create, cancel, list) and push delivery are missing MCP tools; need to be added to the tool surface
- [[2026-04-18_1454_merchant-crm-data-stash-and-free-samples|Merchant CRM Data Stash and Free Sample Tracking]] — free sample tracking is a natural companion to push-publish; merchant stores subscription preferences and trial status in the stash
- [[2026-04-18_1620_commerce-attestation-and-fraud-detection|Commerce Attestation and Fraud Detection]] — each subscription agreement is the purchase attestation for its delivery series; recurring push deliveries are the primary use case for scheduled attestation
