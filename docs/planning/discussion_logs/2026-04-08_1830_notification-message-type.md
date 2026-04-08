---
name: Notification message type — fire-and-forget
date: 2026-04-08 18:30
description: A self-contained, self-sealing message type that delivers a single payload with no session, no reply, and no ceremony. First use case is agent introduction requests, but this is a general protocol primitive with broad application.
---

# Notification Message Type — Fire-and-Forget

## Context

The web-of-trust introduction mechanism (see companion log) requires one agent to inform another: "this person asked me to introduce them, I know them." There is no conversation here — just a delivery. The existing message model (OPEN → exchange → CLOSE/CLOSE-ACK/SEAL) is the wrong shape for this. Opening a full session, exchanging pleasantries, then closing is unnecessary overhead for what is fundamentally a one-way notification.

This surfaced a gap: CELLO has no message type for one-way, no-reply, self-terminating communication.

---

## Design

A notification message is self-contained and self-sealing. It is a single atomic unit:

- **No session opened.** There is no OPEN handshake, no session ID established, no channel negotiated.
- **No reply expected.** The sender does not wait for acknowledgment. The protocol does not provide a reply path.
- **CLOSE is baked in.** The message carries its own termination. On delivery, the exchange is complete by definition.
- **Still signed and hashed.** Non-repudiation applies. The sender is accountable for what they sent. The recipient can verify the sender's identity and that the content was not tampered with.
- **Not tied to a conversation Merkle tree.** There is no ongoing conversation to append to. The notification is recorded in the directory as a standalone signed event, not as a leaf in a session tree.

The receiving client surfaces it as a distinct message type — a structured signal, not a chat message. The client handles it according to the operator's policy for that notification type.

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

## Key Properties Summary

| Property | Value |
|---|---|
| Session | None |
| Reply path | None |
| Termination | Self-contained |
| Signing | Required — sender accountable |
| Hashing | Required — tamper detection |
| Merkle tree | Standalone directory event, not session leaf |
| Delivery acknowledgment | Optional at transport layer; not a protocol requirement |
| Client presentation | Distinct message type, not chat |

---

## Open Questions

- Does a notification message require directory routing, or can it be sent peer-to-peer directly?
- Should the directory maintain a log of sent notifications (for audit purposes), or only the hash?
- Rate limiting: should the protocol define a maximum notification rate to prevent notification spam as a harassment vector?
