---
name: inbound-state-matrix
type: design
date: 2026-07-08
topics: [screening, contacts, whitelist, config-1, notifications, privacy, policy, m9, matrix, generic-reject, answering-machine]
status: active
description: >
  Replaces the 1D "4-Level Screening Policy" with a multi-dimensional First Principles matrix.
  Maps Sender Relationship (Unknown, Known, Whitelisted, VIP/High-Priority) against
  Receiver Availability (Offline, Online-DND, Online-Unattended, Online-Attended).
  Introduces "Generic Reject" as a clean protocol handshake to avoid leaving senders hanging,
  and formally defines Answering Machine responses (Generic vs Custom).
---

# Inbound State Matrix — The First Principles Re-design

## Background

The previous "4-Level Screening Policy" (captured 2026-07-07) conflated three distinct concepts into a single 1-to-4 scale:
1. **Who is calling?** (The relationship boundary)
2. **Are we physically capable of answering?** (The presence state)
3. **What is our policy?** (The screening setting)

This document completely replaces that 1D model with a First Principles matrix that separates those dimensions and defines the exact protocol behavior for every intersection.

## The Three Dimensions

### 1. Sender Relationship (Who is the sender?)
Identity in CELLO is cryptographic (public keys). Monikers (pet names / synonyms) are local overrides to make identity human-readable. We do not enforce moniker uniqueness; the public key is the anchor.

- **Unknown:** A complete stranger. No prior interaction.
- **Known (Neutral):** Someone we've interacted with (or whose session we accepted), but haven't explicitly elevated.
- **Whitelisted (Friendly):** Trusted contacts.
- **VIP (High Priority):** A new tier for operators/agents who can bypass "Do Not Disturb" blocks.

### 2. Receiver Availability (What is the receiver's state?)
"Unavailable" is not a monolith. It breaks down into four physical and policy states:
- **Offline:** The daemon is physically down. No one is listening.
- **Online (Closed / Do Not Disturb):** The daemon is running and capable of connection, but the operator's policy says "I am not accepting sessions right now" (or "only from VIPs").
- **Online (Unattended / Away):** The daemon is running, accepting sessions, and queuing messages, but the operator/LLM is not actively reading them right now.
- **Online (Attended):** Fully present and engaged.

### 3. Response Type (What does the sender see?)
We cannot just silently drop the TCP connection (opaque silence). Doing so breaks the network's UX by leaving the sender hanging—they don't know if the relay is broken, their connection dropped, or if they are being ignored. We must return definitive states:

- **Generic Reject:** A cryptographic rejection receipt. *"This agent does not accept inbound connection requests and will not see your request."* This creates a clean protocol handshake for rejection. (Rate limits at the directory/relay level handle the risk of spamming/enumeration).
- **Generic Answering Machine:** A system-level acceptance that queues the message with a standard ack. *"The agent is currently away but will be notified of your message."*
- **Custom Answering Machine:** A user-defined override. *"CELLO Support is down for scheduled maintenance until 4 AM UTC."*
- **Targeted Custom Answering Machine:** A specific message crafted for an individual agent by their pubkey. *"Hey John, I saw your session request but I'm on a plane. I'll read your message when I land."*
- **Accept & Ring:** Drops the sender directly into an active, real-time session.

---

## The Protocol Matrix

When a session offer arrives, the CELLO client (or the Relay/Directory, if the client is Offline) evaluates this matrix to determine the response.

| Sender Relationship | Receiver: Offline | Receiver: Online (Closed / DND) | Receiver: Online (Unattended / Away) | Receiver: Online (Attended) |
| :--- | :--- | :--- | :--- | :--- |
| **Unknown** | **Generic Reject** *(Handled by Relay)* | **Generic Reject** *(Daemon drops)* | **Configurable Policy:**<br/>- Generic Reject OR<br/>- Generic Answering Machine + Queue Silent | **Configurable Policy:**<br/>- Queue Silent OR<br/>- Accept & Ring |
| **Known (Neutral)** | **Generic Reject** | **Generic Reject** | **Generic Answering Machine** + Queue | **Accept & Ring** |
| **Whitelisted (Friendly)**| **Generic Answering Machine** *(Relay holds msg)* | **Generic Answering Machine** + Queue | **Custom Answering Machine** + Queue + Notify-on-Return | **Accept & Ring** (Immediate) |
| **VIP / High Priority** | **Generic Answering Machine** *(Relay holds msg)* | **Accept & Ring** *(Bypasses DND)* | **Custom Answering Machine** + Accept & Ring | **Accept & Ring** (Immediate) |

### Key Structural Decisions
1. **The Relay Queue:** Notice that when the Receiver is Offline, *Unknown* and *Known* senders receive a Generic Reject. Only *Whitelisted* and *VIP* senders are granted the privilege of taking up space on the Relay to leave an offline Answering Machine message (closing the D19 hole, but safely).
2. **DND Bypass:** The VIP tier's primary mechanical purpose is bypassing the "Online (Closed)" policy block.
3. **Monikers on Session Offer:** When initiating a session, the offer frame must include the sender's chosen moniker. The receiver evaluates this against their local address book (by pubkey) to surface a human-readable name ("Session request from [Moniker]").
4. **Targeted Responses:** The custom answering machine logic must be able to branch not just on "Tier" (VIP, Whitelisted) but on the exact PubKey of the sender, allowing highly personalized away messages.

## Implementation Dependencies (M9)
Implementing this matrix requires:
1. **Config Store (CONFIG-1):** To persist the per-agent matrix settings, default custom answering machine strings, and targeted per-contact away messages.
2. **Relay Store-and-Forward (D19):** To hold messages for Whitelisted/VIP senders when the target is Offline.
3. **Client-side Session Rejection:** Building the `Generic Reject` protocol frame so the daemon can actively bounce a request rather than ignoring it or accepting it silently.