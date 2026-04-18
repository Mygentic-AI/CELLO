---
name: Merchant CRM Data Stash and Free Sample Tracking
type: discussion
date: 2026-04-18 14:54
topics: [persistence, MCP-tools, commerce, micropublishing, connection-policy, trust-data, client-storage, identity]
description: Per-contact JSON data stash for merchants — a lightweight client-side CRM enabling free sample tracking, interaction history, and personalization. Requires a stable universal identifier that survives profile changes.
---

# Merchant CRM Data Stash and Free Sample Tracking

## The Problem

Merchants need to track per-contact state across interactions. The most common use case is free samples — a micropublisher offering two days of free content, a research agent offering one free report, an inference provider offering trial queries. Without tracking, an agent cannot enforce "one free sample per user" or personalize future interactions based on past history.

This is a common enough requirement that it should be a first-class protocol feature, not something every merchant reimplements from scratch.

## The Data Stash

A **per-contact JSON blob** stored on the merchant's client. Think of it as a lightweight CRM record — arbitrary structured data the merchant's agent can write and read against any contact it has interacted with.

**What it stores:**
- Free sample status (offered, accepted, expired)
- Interaction history (number of sessions, last contact, topics discussed)
- Personalization data (stated preferences, filter settings from push-publish subscriptions)
- Custom merchant state (anything the merchant's agent wants to remember)

**What it is not:**
- A global database — stored locally on the merchant's client, not on the directory
- Sensitive PII — merchant stores what they need for their own operation
- Shared with anyone — private to the merchant, not visible to CELLO or other agents

**MCP tool surface:**
- `cello_stash_write(contact_id, key, value)` — write a key/value into the contact's JSON blob
- `cello_stash_read(contact_id, key)` — read a value from the contact's JSON blob
- `cello_stash_read_all(contact_id)` — read the full JSON blob for a contact
- `cello_stash_delete(contact_id, key)` — delete a key from the blob

Simple, general-purpose. The merchant's agent decides what to store and how to structure it.

## The Universal Identifier Problem

The data stash is only useful if the merchant can reliably identify the same contact across interactions — even if the contact changes their profile, phone number, or display name.

The natural candidate is the **agent's public key (identity_key)**. This is:
- Stable — does not change with profile updates
- Already known to the merchant from the connection or session
- Pseudonymous — does not expose PII
- Cryptographically bound to the agent — cannot be spoofed

**The edge case:** Key rotation. When an agent rotates their identity_key (e.g. after a compromise event), their old key is tombstoned and a new key is issued. The merchant's data stash is keyed to the old identity.

**Proposed resolution:** The key rotation protocol should include an **identity continuity record** — a signed statement from the old key attesting that the new key belongs to the same agent. The merchant's client can verify this chain and migrate the data stash from old key to new key automatically.

This gives merchants a stable universal identifier that:
- Survives phone number changes
- Survives profile/bio updates
- Survives display name changes
- Handles key rotation via the continuity record

## Free Sample Enforcement — Example Flow

1. Agent B connects to Merchant A (micropublisher)
2. Merchant A's agent checks: `cello_stash_read(agent_B_identity_key, "free_sample_status")`
3. If null → offer free sample, write `{"free_sample_status": "offered", "offered_at": timestamp, "expires_at": timestamp + 5 days}`
4. After 5 days → write `{"free_sample_status": "expired"}`
5. Agent B requests another free sample → merchant reads stash, sees "expired", declines

No session state required. No directory involvement. Pure client-side enforcement.

## Privacy Considerations

- The data stash is private to the merchant — never shared with CELLO or other agents
- The contact (Agent B) does not know what data the merchant stores about them
- This is no different from any website storing a cookie or a CRM record — standard practice
- CELLO does not regulate what merchants store in their stash — it is the merchant's own data
- The merchant is responsible for compliance with applicable data retention laws in their jurisdiction

## Protocol Requirements

1. **MCP tools** — `cello_stash_write`, `cello_stash_read`, `cello_stash_read_all`, `cello_stash_delete` added to the tool surface
2. **Client-side storage** — stash records stored in the agent client's local database (SQLCipher), keyed by `contact_identity_key`
3. **Identity continuity record** — key rotation protocol updated to produce a signed continuity record; merchant client handles automatic stash migration on receipt of continuity record
4. **No directory involvement** — stash is entirely client-side; directory is not aware of its existence

---

## Related Documents

- [[2026-04-11_1700_persistence-layer-design|Persistence Layer Design]] — stash records need a schema entry in the client-side storage layer; contact_identity_key is the primary key
- [[2026-04-14_1100_cello-mcp-server-tool-surface|CELLO MCP Server Tool Surface]] — four new MCP tools needed: cello_stash_write, cello_stash_read, cello_stash_read_all, cello_stash_delete
- [[2026-04-15_1100_key-rotation-design|Key Rotation Design]] — identity continuity record needed for stash migration on key rotation; this log adds a requirement to the key rotation flow
- [[2026-04-18_1407_push-publish-subscription-model|Push-Publish Subscription Model]] — free sample tracking is a natural companion to push-publish; merchant stores subscription preferences and trial status in the stash
- [[2026-04-18_1148_cac-and-revenue-streams|CAC and Revenue Streams]] — free samples are a conversion mechanism for micropublishing and inference verticals; stash makes them enforceable without directory overhead
- [[2026-04-08_1930_client-side-trust-data-ownership|Client-Side Trust Data Ownership]] — stash follows the same client-as-custodian principle; merchant owns their own CRM data, directory never sees it
- [[2026-04-18_1620_commerce-attestation-and-fraud-detection|Commerce Attestation and Fraud Detection]] — per-contact interaction history in the stash feeds into seller-side track record signals used for anomaly detection
