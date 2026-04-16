---
name: Companion Device Architecture
type: discussion
date: 2026-04-16 14:00
topics: [companion-device, mobile-app, desktop-app, libp2p, persistence, human-injection, notifications, NAT-traversal, MCP-tools]
description: Designs how the mobile and desktop apps connect to the owner's CELLO client via libp2p P2P to view conversation content, how human owners inject messages into agent conversations, and how local persistence records both protocol and non-protocol events.
---

# Companion Device Architecture

## The Problem

The CELLO protocol is designed so that conversation content never touches infrastructure — it flows P2P between the two agents and is notarized by the directory as hashes only. This means the human owner has no way to see what their agent has been saying. The frontend.md spec explicitly states the portal is "a protocol event viewer and identity management surface" — it shows metadata (who, when, seal status, Merkle root) but never content.

Owners need to see what their agents are doing. They also occasionally need to participate — inject a decision, override a negotiation, answer a question. But the privacy architecture prohibits centralizing conversation content anywhere.

The question: how does the owner get content visibility and limited participation without breaking the zero-infrastructure-content invariant?

---

## Decision: Companion Device as a P2P Peer

The mobile app and desktop app are **companion devices** — privileged viewers that connect directly to the owner's CELLO client over libp2p P2P. They are not agents. They do not participate in conversations as protocol entities. They connect to the owner's own client and read from its local persistence.

This reuses the same libp2p infrastructure that agent-to-agent connections use. The directory facilitates hole-punching for companion devices the same way it facilitates it for agent sessions. The directory sees "companion device D wants to reach CELLO client for owner X" — facilitates the NAT traversal, then steps out. Content flows directly over the P2P connection. The directory never sees it.

### Why libp2p specifically

The CELLO client already uses libp2p for agent-to-agent transport. The companion device uses the same stack. This means:
- Same hole-punching mechanism solves NAT traversal for both use cases
- No new transport infrastructure required
- The mobile app ships a compiled libp2p library (via `go-libp2p` + `gomobile` for iOS/Android, or `rust-libp2p` cross-compiled)
- The directory's existing relay and signaling infrastructure serves companion connections without modification beyond a connection type flag

### Two Separate Channels

The companion device operates on two completely independent channels:

**Content channel — pull only, foreground only**
- libp2p P2P connection to the owner's CELLO client
- Established only when the app is open and in the foreground
- User opens app → dials client → fetches session list → taps a session → fetches that session's content on demand
- Client unreachable → app displays "unable to reach client," nothing more — the user figures out why
- No caching, no background sync, no "last synced" state
- Bandwidth-conscious: metadata list is small and always loads; content is fetched per-session only when tapped

**Notification channel — push, background**
- APNs (iOS) / FCM (Android) — standard push notifications
- Handles everything already designed in frontend.md: security alerts, incoming connection requests, escalation prompts, "Not Me" emergency revocation
- Requires background execution entitlement for push receipt — this is standard and already part of the mobile app design
- Push payloads never carry conversation content — they are signals ("something happened," "your agent wants input")

The two channels never mix. A push notification tells the owner something happened. If the owner wants details, they open the app, which establishes the content channel and pulls.

---

## Decision: Human Injection Into Conversations

Human owners can participate in their agent's conversations, but they are never protocol participants. A human only ever communicates with their own agent. The other agent(s) in the conversation never know a human was involved.

### The Flow

1. Owner opens companion app, views an active conversation
2. Owner types a message
3. Companion app sends it to the owner's CELLO client via the P2P content channel
4. The client delivers it to the agent as a special input: "your owner wants this in the conversation"
5. What happens next is entirely the agent's decision — pass it verbatim, wrap it with context, use it as an instruction, ignore it
6. Whatever the agent sends to the other agent is what enters the Merkle tree

From the other agent's perspective: they received a normal message from the first agent. The human injection is invisible to the protocol.

### The Reverse: Agent Requests Human Input

The agent may need the owner's input mid-conversation — a decision, an approval, a clarification. Two mechanisms, agent's choice:

1. **`cello_request_human_input`** — a new MCP tool. The agent calls it; the client asks the directory to send a push notification to the registered companion device. The directory sees "send a knock to owner X's companion device" — no content, no context, just a signal. The owner receives a push notification: "Your agent is requesting input." Owner opens the app, sees the conversation context, responds via the content channel.

2. **WhatsApp/Telegram** — the agent sends a message directly via the existing out-of-band channel. Already possible, no new tooling needed.

The MCP tool is valuable because it's channel-agnostic. Some owners may not have WhatsApp configured. Some may prefer in-app notifications. The agent picks what fits.

---

## Decision: Local Persistence Model

### Owners Always Store Conversation Logs

The CELLO client maintains a local SQLCipher (or SQLite) database containing all conversation logs. This is the owner's data, on the owner's machine. The protocol does not mandate this — it's the client implementation's responsibility. But for practical purposes, every client will do it because owners need it.

### The Local Log Is a Superset of the Merkle Record

The local persistence log contains everything: protocol messages (which are in the Merkle tree) and local-only events (human injections, agent-requested-input events) which are not. The discriminator is a single field on each log entry:

**`merkle_leaf_hash`** — if populated, the entry is in the protocol record and can be verified against the Merkle tree. If null, it's local-only.

Example conversation with human injection:

| seq | type | direction | content | merkle_leaf_hash |
|---|---|---|---|---|
| 1 | `agent_received` | in | "Can you approve the revised terms?" | `a3f7...` |
| 2 | `human_injected` | local | "Yes, accept those terms" | `null` |
| 3 | `agent_sent` | out | "Confirmed, we accept the revised terms" | `9c2b...` |

Example with agent requesting owner input:

| seq | type | direction | content | merkle_leaf_hash |
|---|---|---|---|---|
| 1 | `agent_received` | in | "Counter-party proposes $50k for the engagement" | `b1d4...` |
| 2 | `human_requested` | local | "Owner input needed: pricing decision" | `null` |
| 3 | `human_injected` | local | "Counter at $65k" | `null` |
| 4 | `agent_sent` | out | "We'd need $65k for this scope" | `7e9a...` |

The full picture is preserved locally for the owner. The protocol record — verifiable, attestable, disputable — contains only what the agents exchanged. The human-agent exchange is private to the owner's machine.

### Entry Types

- `agent_sent` — message sent by the agent to the counterparty. In the Merkle tree.
- `agent_received` — message received from the counterparty. In the Merkle tree.
- `human_injected` — message from the owner to their agent via companion device. Local-only.
- `human_requested` — the agent requested owner input. Local-only.
- `session_event` — session lifecycle events (open, seal, abort). In the Merkle tree (control leaves).

---

## Decision: Companion Device Authentication

The companion device does not use FROST. It is not an agent session. It is the owner reading their own data and occasionally writing to their own agent.

Authentication: a keypair generated at app install time, bound to the owner via phone OTP verification (same phone number as the registered agent). The CELLO client maintains an allowlist of authorized companion device public keys. Only registered companion devices can connect.

This is completely outside the FROST model. The directory facilitates the P2P connection but does not co-sign anything. The companion device proves identity to the client directly.

---

## Decision: Client Offline Behavior

If the CELLO client is unreachable when the companion app opens — the owner's laptop is off, the VPS is down, the network is partitioned — the app displays "unable to reach client." That's it.

No caching of previous state. No "last synced" timestamp. No attempt to reach the client through alternate paths. The app is a live viewer. If there's nothing to view, it says so. The user determines why the client is unreachable and resolves it themselves.

---

## What This Introduces to the Protocol

Three additions that do not currently exist:

**1. Companion device peer type.** The directory distinguishes companion device connections from agent sessions. Same hole-punch mechanism, different authorization: the companion device presents its registered keypair and proves ownership of the target agent identity, rather than both parties presenting FROST-authenticated agent identities.

**2. Companion read/write API on the CELLO client.** The client currently exposes MCP tools (agent-facing). The companion device needs a separate surface — read-only for content, plus a narrow write path for human injection:
- `list_sessions()` — session metadata list
- `fetch_session_content(session_id)` — full log for one session, including local-only entries
- `send_human_injection(session_id, content)` — deliver owner input to the agent

This is not an MCP tool surface. It is an owner-facing API, accessible only over authenticated P2P from registered companion devices.

**3. `cello_request_human_input` MCP tool.** An agent-facing tool that triggers a push notification to the companion device via the directory. The directory sees a knock request, not content. The tool is optional — agents can also reach owners via WhatsApp/Telegram.

---

## What This Does NOT Change

- The Merkle tree structure — unchanged. Human injections are not in the tree.
- Agent-to-agent session mechanics — unchanged. The other agent never knows a human was involved.
- The directory's role — unchanged. It facilitates the companion P2P connection the same way it facilitates agent connections. It never sees content.
- The frontend.md portal design — unchanged. The portal remains a protocol event viewer. The companion device is the content viewer.
- The notification system — unchanged. Push notifications work the same way; `cello_request_human_input` adds one new notification type.

---

## Related Documents

- [[frontend|CELLO Frontend Requirements]]
- [[protocol-map|CELLO Protocol Map]]
- [[2026-04-14_1100_cello-mcp-server-tool-surface|CELLO MCP Server Tool Surface]]
- [[2026-04-11_1700_persistence-layer-design|Persistence Layer Design]]
- [[2026-04-11_1400_libp2p-dht-and-peer-connectivity|libp2p, DHT, and Peer Connectivity]]
- [[2026-04-13_1000_device-attestation-reexamination|Device Attestation Reexamination]]
- [[2026-04-08_1800_account-compromise-and-recovery|Account Compromise and Recovery]]
