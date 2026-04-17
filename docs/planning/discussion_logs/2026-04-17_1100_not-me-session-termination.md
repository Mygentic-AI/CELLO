---
name: "Not Me" Session Termination — Dual-Path Forced Abort
type: discussion
date: 2026-04-17 11:00
topics: [session-termination, compromise-canary, FROST, K_server, K_local, libp2p, directory, notifications, security]
description: Resolves FC-4 / AC-C6. Establishes that all active sessions must be terminated immediately on "Not Me". Designs a dual-path forced abort mechanism to close existing P2P sessions that K_server revocation alone cannot reach.
---

# "Not Me" Session Termination — Dual-Path Forced Abort

## The Problem

Burning K_server_X prevents new FROST session establishment but does nothing to existing P2P sessions. Those are direct libp2p connections between agent clients — not routed through the directory. Changing the directory's key material cannot close them.

The owner has declared a compromise. They don't know whether K_local was taken, what has been sent in the last ten minutes, or whether the agent is mid-negotiation with an attacker right now. Leaving existing sessions open because they are "technically still valid under K_local" works against the owner's intent. The attacker still holds K_local and can continue operating on those live channels.

**Decision: all active sessions receive SEAL-UNILATERAL immediately on "Not Me". No session continues after the owner declares a compromise.**

---

## The Mechanism: Two Parallel Abort Paths

K_server revocation alone cannot close existing sessions. Two additional actions fire simultaneously when "Not Me" commits at the directory:

### Path 1 — Directory → compromised agent client (WebSocket control message)

The directory sends an `EMERGENCY_SESSION_ABORT` control message to the agent's existing authenticated persistent WebSocket. The client receives it and:

1. Sends a signed ABORT control leaf (K_local, `COMPROMISE_INITIATED` reason code) to each active counterparty via the existing P2P channels
2. Disconnects all P2P sessions
3. Drops its own WebSocket connection to the directory

This is the cooperative path. It applies when the agent process is still running normally — e.g., K_local was stolen and is being used from elsewhere, but the legitimate agent process is still connected.

### Path 2 — Directory → each counterparty (WebSocket notification)

Simultaneously, for every active session the directory has on record for this agent, the directory sends a `PEER_COMPROMISED_ABORT` notification directly to each counterparty's authenticated WebSocket.

The counterparty client seals unilaterally on receipt — regardless of whether an ABORT leaf arrives from the compromised side.

This is the non-cooperative path. It applies when the agent process is offline, crashed, or actively controlled by the attacker. The directory knows every active session it facilitated and can always execute Path 2 regardless of what the compromised client does.

**Path 2 is the more important path.** Path 1 is an optimisation that produces a cleaner Merkle record when available.

---

## What Goes in the Merkle Tree

**Path 1 executes:** An ABORT control leaf (K_local signed, `COMPROMISE_INITIATED` reason code) is appended to each conversation tree by the agent client before disconnecting. The record is clean — both parties have a signed, reason-coded close.

**Only Path 2 executes:** Counterparties record SEAL-UNILATERAL from their side. No ABORT leaf from the compromised agent. The `PEER_COMPROMISED_ABORT` notification with its timestamp, combined with the directory's anomaly event log, provides the evidentiary anchor. The absence of an ABORT leaf from the compromised side is itself meaningful — it confirms the client was unresponsive at termination time.

---

## New Protocol Additions

**`EMERGENCY_SESSION_ABORT`** — directory-to-client control message (WebSocket). Triggers the client to abort all active sessions and disconnect. Not a notification type — it is a directory control instruction.

**`PEER_COMPROMISED_ABORT`** — added to the formal notification type registry. Sent by the directory to counterparties of a compromised agent. Payload: `{ compromised_agent_id, tombstone_id, notified_at }`.

---

## What This Does NOT Change

- K_server_X revocation — still fires first, blocking new FROST sessions
- The tombstone model — COMPROMISE_INITIATED tombstone still filed
- The 48-hour waiting period for re-keying — unchanged
- Social proof freeze, phone number flagging — unchanged
- The "Not Me" UX flow — same steps, but the confirmation screen now accurately states all active sessions will be closed immediately

---

## Related Documents

- [[frontend|CELLO Frontend Requirements]] — FC-4 resolved; "Not Me" flow and confirmation screen updated; PEER_COMPROMISED_ABORT added to notification event stream
- [[server-infrastructure|CELLO Server Infrastructure Requirements]] — directory must fire both abort paths simultaneously on K_server revocation; EMERGENCY_SESSION_ABORT and PEER_COMPROMISED_ABORT are server-side operations
- [[agent-client|CELLO Agent Client Requirements]] — client must handle EMERGENCY_SESSION_ABORT control message: abort all sessions, send ABORT leaves, disconnect; AC-C6 resolved
- [[2026-04-08_1800_account-compromise-and-recovery|Account Compromise and Recovery]] — tombstone effects section; all active sessions seal on any tombstone (this log operationalises the mechanism)
- [[2026-04-15_0900_session-level-frost-signing|Session-Level FROST Signing]] — K_server revocation only blocks new FROST ceremonies; this log provides the mechanism to close existing sessions that K_server revocation cannot reach
- [[2026-04-08_1530_message-delivery-and-termination|Message Delivery and Termination]] — ABORT control leaf semantics and SEAL-UNILATERAL recording
