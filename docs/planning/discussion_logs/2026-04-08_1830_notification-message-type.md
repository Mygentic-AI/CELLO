---
name: Notification message type — fire-and-forget
date: 2026-04-08 18:30
description: A self-contained, self-sealing message type that delivers a single payload with no session, no reply, and no ceremony. First use case is agent introduction requests, but this is a general protocol primitive with broad application.
---

# Notification Message Type — Fire-and-Forget

## Context

The [[2026-04-08_1800_account-compromise-and-recovery|web-of-trust introduction mechanism (see companion log)]] requires one agent to inform another: "this person asked me to introduce them, I know them." There is no conversation here — just a delivery. The existing message model (OPEN → exchange → CLOSE/CLOSE-ACK/SEAL) is the wrong shape for this. Opening a full session, exchanging pleasantries, then closing is unnecessary overhead for what is fundamentally a one-way notification.

This surfaced a gap: CELLO has no message type for one-way, no-reply, self-terminating communication.

---

## Design

A notification message is self-contained and self-sealing. It is a single atomic unit:

- **No session opened.** There is no OPEN handshake, no session ID established, no channel negotiated.
- **No reply expected.** The sender does not wait for acknowledgment. The protocol does not provide a reply path.
- **CLOSE is baked in.** The message carries its own termination. On delivery, the exchange is complete by definition.
- **Still signed and hashed.** Non-repudiation applies. The sender is accountable for what they sent. The recipient can verify the sender's identity and that the content was not tampered with.
- **Not tied to a conversation Merkle tree.** There is no ongoing conversation to append to. The directory records a hash of the notification as a standalone signed event — non-repudiation applies, the sender cannot deny it was sent. But it is a single-entry record, not a leaf chained into a growing session tree with prev_root sequencing.

The receiving client surfaces it as a distinct message type — a structured signal, not a chat message. The client handles it according to the operator's policy for that notification type.

Every notification carries a **declared type** from a standardized registry. Types are not freeform strings — senders cannot invent types to evade filters. Declaring a misleading type (e.g., typing a promotional message as `order-update`) is a signed, verifiable act and a trust score event if flagged. Predefined types include at minimum: `introduction`, `order-update`, `alert`, `promotional`, `system`.

**Prior conversation requirement:** a notification can only be sent to an agent with whom the sender has had at least one prior conversation. This prevents cold-contact spam entirely — a new agent cannot reach a stranger via notification without first establishing a conversational relationship.

---

## First Use Case: Agent Introduction

An introduction notification carries:

- Sender identity (the introducing agent)
- Subject identity (the agent being introduced)
- Optional short note from the introducer ("I worked with them on X, they're reliable")
- No reply path

The receiving agent's client presents this as: "Agent C is introducing Agent A." The agent handles it according to its connection policy. The introducer has no further involvement.

---

## Broader Application

The introduction use case is the first instance, but the notification type is a general primitive. Any situation where the protocol needs to deliver information without opening a dialogue:

- **Tombstone notifications** — informing counterparties that an identity has been tombstoned
- **Directory alerts** — node-to-client system notifications
- **Trust events** — notifications about changes to connected agents' trust status
- **Recovery events** — informing previously-connected agents that a recovered identity is re-entering the network
- **Session close attestation disputes** — the FLAGGED party may notify the other party that a dispute has been filed

In each case: one-way, signed, delivered, done.

---

## Filtering Architecture

Filtering is a **rule engine, not an inference engine.** No LLM is involved in deciding whether to accept or reject a notification. Each incoming notification is evaluated against a deterministic rule stack:

1. **Global type rules** — "I never accept `promotional` from anyone"
2. **Sender overrides** — "except Agent X — I want `promotional` from them specifically"
3. **Whitelist / blacklist** — explicit sender lists that override type rules

**Precedence:** sender override beats global type rule.

Accept or reject. O(1) per notification regardless of volume. If filtering required LLM inference, spam would become a compute DoS attack — each notification burning the recipient's tokens. Rule-based filtering eliminates this entirely. The LLM only fires after a notification has cleared the filter and the agent decides to act on it.

---

## Rate Limiting

Two distinct attack vectors with different mitigations:

**Spam** — mitigated by the prior conversation requirement (cold contact impossible) and by type-based filtering (recipient controls what lands). Warm-contact spam (a service you've engaged with sending ongoing promotions) is handled by the filter stack — the recipient opts out of `promotional` globally or per-sender.

**DDoS** — notification messages are cheaper to generate than full sessions. Rate limiting is layered:
- **Per-sending-agent:** N notifications per hour, enforced at the directory. Exact limit TBD.
- **Trust score gated:** lower trust score = stricter rate limit. High-trust agents get more headroom.
- **Node-level shedding:** nodes deprioritize notification hashes from low-trust senders under high load.

**Verified businesses can apply for elevated rate limits** and pay for them. The rationale: we know who they are (institutional verification), they have a trust score and identity at stake, and their communication volumes are legitimately higher (a hospital notifying patients about appointments is not spam). The recipient's opt-out always overrides the sender's rate limit — a higher rate limit means more can be sent, not that more will be received.

---

## Key Properties Summary

| Property | Value |
|---|---|
| Session | None |
| Reply path | None |
| Termination | Self-contained |
| Signing | Required — sender accountable |
| Hashing | Required — tamper detection |
| Directory hash | Yes — single-entry record, not chained into a session tree |
| Delivery acknowledgment | Optional at transport layer; not a protocol requirement |
| Client presentation | Distinct message type, not chat |

---

## Open Questions

- Does a notification message require directory routing, or can it be sent peer-to-peer directly?
- Should the directory maintain a log of sent notifications (for audit purposes), or only the hash?
- What are the exact default rate limits per trust score tier?
- What is the process for institutional verification to qualify for elevated rate limits?

---

## Related Documents

- [[cello-design|CELLO Design Document]] — Notification Messages section in Step 7; this log specifies the design in full
- [[2026-04-08_1800_account-compromise-and-recovery|Account Compromise and Recovery]] — the companion log that surfaced the need for this primitive (web-of-trust introductions)
- [[2026-04-08_1900_connection-staking-and-institutional-defense|Connection Staking and Institutional Defense]] — rate limiting and DDoS defense applies to notifications too
- [[2026-04-10_1000_connection-endorsements-and-attestations|Connection Endorsements and Attestations]] — endorsements replace some just-in-time introduction notifications with pre-computed lookups
