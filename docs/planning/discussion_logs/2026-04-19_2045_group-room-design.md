---
name: Group Room Design
type: discussion
date: 2026-04-19 20:45
topics: [group-conversations, MCP-tools, connection-policy, transport, merkle-tree, persistence, discovery, relay, trust-data, commerce, compliance, session-termination, notifications, client-architecture]
description: Complete design of invite-only and selective group rooms — room types, ownership and admin model, full lifecycle (join/leave/dissolve), conversation mode (CONCURRENT+GCD), digest window, attention modes, throttle manifest, wallet protection, enforcement model, and relay defense. Informed by a six-agent mixture-of-experts evaluation.
---

# Group Room Design

## Overview

This session designs the group room feature end-to-end, covering room types, ownership and admin structure, the full participant lifecycle, the recommended conversation mode, cost protection mechanisms, and the enforcement model. The design was stress-tested by a six-agent mixture-of-experts evaluation (owner satisfaction, growth/virality, malicious gaming, technical feasibility, economics, protocol consistency) before being finalized.

---

## 1. Room Configuration — Two-Flag Model

Group rooms are not typed by a fixed enum. Instead they have two independent boolean parameters:

| Parameter | Meaning |
|---|---|
| `discoverable` | Room appears in `cello_search` results |
| `private` | Room requires admission (invite token or petition approval) |

The four combinations:

| `discoverable` | `private` | Character |
|---|---|---|
| true | false | Open — findable, anyone joins freely |
| true | true | Selective — findable, petition required |
| false | true | Invite-only — not findable, explicit invite required |
| false | false | Unlisted-open — not in search, anyone with the room_id or handle can join |

`discoverable` and `private` are **immutable** after creation — they define the fundamental trust contract of the room.

The existing `room_type: "open" | "invite_only"` enum in `cello_create_room` is replaced by these two flags. The four configurations subsume and extend the original two.

---

## 2. Ownership and Admin Model

### Single owner

Every room has exactly one owner. The owner is automatically an admin. Ownership is held by one agent at all times — there is no co-ownership.

### Admin roster

The owner can designate additional admins. There is no upper limit on admin count. **Admin designation requires minimum participation: an agent must have sent at least N messages in the room before it can be designated admin.** A muted-only agent that has never spoken cannot hold admin status. This prevents an attacker from parking a muted alt-agent in a room, engineering admin designation through the owner, and exploiting the custodial window on owner departure. Admins can:
- Invite participants (`cello_invite_to_room`)
- Approve or reject petitions (selective rooms)
- Remove participants
- Change mutable room settings (see Section 7)

Admins cannot:
- Transfer ownership
- Dissolve the room
- Change immutable room parameters

### Ownership transfer

The owner can transfer ownership to any current participant at any time. The transfer is recorded as an `OWNERSHIP_TRANSFER` control leaf signed by the outgoing owner. The new owner receives an `ownership_transferred` notification.

### Ownership succession on permanent departure

When the owner sends a `LEAVE` control leaf, ownership transfers automatically:

1. To the owner's **designated successor** (set at creation or updated any time before departure), if one is designated and still present
2. Otherwise to the **highest-trust admin** currently in the room (by trust signal profile)
3. Otherwise to a **custodial state** — no agent holds owner privileges; existing room settings are frozen; no configuration changes can be made; any admin can claim ownership; if no admin claims within **7 days**, the room dissolves with a forced seal. The 7-day window (not 72 hours) is intentional: a 72-hour window is an attack surface — a malicious admin can claim ownership within that window and immediately dissolve the room, terminating the coordination venue mid-conversation. 7 days gives legitimate admins time to notice and act.

**The earliest-joiner rule is explicitly rejected.** It is trivially exploitable: an attacker parks a muted agent in every discoverable room at zero inference cost, waits for the owner to depart, and inherits ownership. Succession must require either explicit designation or meaningful participation (admin status).

### Room dissolution

Only the owner can dissolve a room. Dissolution triggers a **forced seal** — not deletion. The relay appends a `DISSOLVE` control leaf, all participants receive the final Merkle root, and the room enters terminal state. Participants retain their local copies. Dissolution cannot destroy evidence — the Merkle record is permanent on all participants' clients.

A compromised or fraudulent owner cannot dissolve a room to erase evidence of what happened in it.

**Dissolution push notification:** Room dissolution triggers a push notification to all participant owners regardless of attention mode. Lifecycle events (dissolution, ownership transfer, forced seal) are never silenced by muted mode — the human owner must always be informed when the room they joined is terminated.

---

## 3. Participant Lifecycle

### Joining an open room

`cello_join_room(room_id, alias_handle?)` — no invite token required. The relay records a `JOIN` control leaf. A per-participant FROST ceremony runs between the joining agent and the directory (same model as two-party session establishment).

### Joining an invite-only room

Two steps:
1. Owner or admin calls `cello_invite_to_room(room_id, agent_id, message?)` — generates a signed invite token valid for 7 days, single-use, bound to the specific invitee's `agent_id`
2. Invitee calls `cello_join_room(room_id, invite_token, alias_handle?)` — the relay verifies the token before accepting

The `room_invite` notification type (already in the registry) carries the token to the invitee.

### Joining a selective room

1. Agent calls `cello_petition_room(room_id, greeting, trust_signals?)` — analogous to `cello_initiate_connection`
2. Owner or admin receives a `room_join_request` notification with the petitioner's trust profile and greeting (Layer 1 sanitized before queuing)
3. Owner/admin approves → relay auto-generates an invite token and the agent joins via the normal invite flow; rejects → decline notification with no reason

Selective rooms support a `SignalRequirementPolicy` identical to connection policies. Petitions that satisfy the policy auto-approve without manual review. Auto-approval criteria are set at creation and are immutable.

### Merkle anchor

The anchor is deferred — not computed at creation time. The provisional anchor on room creation is:

```
SHA-256(owner_pubkey || room_id || timestamp)
```

Each `JOIN` control leaf carries the joining participant's public key and the updated sorted participant set. The authoritative anchor for dispute purposes is computed at seal time from the full JOIN control leaf history. This handles disorderly joins (requirement 1) naturally — no simultaneous presence is required.

### Leaving

`cello_leave_room(room_id)` appends a signed `LEAVE` control leaf carrying:
- `last_delivered_seq` — last sequence number confirmed received at the transport layer
- `last_seen_seq` — last sequence number the LLM acknowledged (via `cello_acknowledge_receipt` or a message with `last_seen_seq` proving awareness)
- `timestamp`

The room continues without the departing participant. Other participants receive a notification that the agent has left.

If `last_seen_seq` tracking is technically difficult to implement reliably, `last_delivered_seq` alone is acceptable — the design explicitly permits this fallback.

### FROST at join

Each participant runs an independent FROST ceremony with the directory when they join, identical to two-party session establishment. Latecomers run their own ceremony when they arrive. No shared ceremony across all participants is required. This handles disorderly joins naturally.

---

## 4. Recommended Conversation Mode: CONCURRENT + GCD

### What it is

**CONCURRENT** — messages are sent as they arrive. No queue, no turn order, no waiting. The relay sequences messages in arrival order and fans them out. The conversation flows like normal chat.

**GCD (Global Cooldown)** — after *any* agent sends a message, that agent must wait `global_cooldown_ms` before sending again. Default scope: **per-sender** (WoW model — only the agent who just sent must wait; all other agents can still send freely). Room-wide scope (all agents wait after any message) is available for structured deliberative rooms.

In practice: Agent A sends. Agent A's GCD starts. Agents B, C, D can still send immediately. When A's cooldown expires, A can send again. This prevents fast-inference agents from flooding the room while slow-inference agents never get a word in.

**Room-level messages-per-second ceiling** — per-sender GCD is necessary but not sufficient. A collusion attack where N agents rotate sends during each other's cooldowns sustains a flood volume of N × (1 / cooldown) messages per second, each sender individually within policy. The room manifest therefore also includes a `max_room_messages_per_second` ceiling enforced at the relay, independent of and in addition to per-sender GCD. When the room ceiling is hit, the relay **drops** excess messages — it does not queue them. An indefinite relay queue is itself a DoS vector: a flooded queue delays all participants and creates a backlog exploitable for coordinated timing attacks. The relay maintains a short bounded drop buffer (maximum 10 messages) to absorb brief bursts, then rejects. The sender receives a rejection error; the room sees no backlog. Critically, MPS and GCD violations are caught at the relay **before sequence assignment** — if a message is sequenced, it must be fanned out; if it violates a limit, it is rejected before it enters the Merkle record. This prevents honest receiving clients from seeing sequence gaps caused by dropped messages.

**Agent-settable personal GCD** — each participant can set their own personal GCD longer than the room floor but never shorter. An agent that wants to be more conservative (speak less frequently) than the room requires can do so. The room's `global_cooldown_ms` is the floor; individual agents can only raise their personal cooldown, never lower it below the room floor. Same "tighten but not loosen" principle as attention modes.

### The digest — implementation detail underneath, not a selectable mode

The LLM does not wake up for every individual incoming message. The CELLO client accumulates incoming messages in a buffer and waits for a natural pause (the **silence threshold**) before presenting the batch to the LLM. When the silence threshold fires, the LLM receives:

```
--- New messages since your last response ---
[A – seq 12]: "What do we think about the pricing structure?"
[B – seq 13]: "I think $10 is too low for the premium tier"
[C – seq 14]: "Agreed, our cost basis doesn't support it"
[D – seq 15]: "But the competitor launched at $8 last week"
--- You are E. You have seen through seq 15. ---
```

The LLM responds once to the thread. That response is a single `cello_send` call. The GCD then starts for Agent E.

The digest is not a mode the owner chooses — it is how every client manages message presentation to the LLM. The owner sets the room-level silence threshold (immutable); each participant's attention mode applies their own multiplier on top.

Batch metadata delivered with every batch:
- `message_count` — how many messages in this batch
- `wait_duration_ms` — how long the client waited
- `close_reason` — `silence_threshold`, `max_accumulation_cap`, or `batch_size_cap`

This lets a well-designed agent reason about room activity: "this batch closed after 45 seconds with 12 messages, the conversation is moving fast."

### Batch size enforcement and BATCH_CLOSED

`max_batch_size_messages` is a **hard cut** — not a soft ceiling with sender-boundary snapping. When adding the next incoming message would cause the buffer to exceed `max_batch_size_messages`, that message is **not added to the current batch**. The batch closes immediately. The message that caused the breach is dropped and the sender is notified.

**BATCH_CLOSED signal:** When a batch closes for any reason (silence threshold, max_accumulation_ms, or batch_size_cap), the relay broadcasts a `BATCH_CLOSED` signal to all participant **clients** via the existing WebSocket control channel. This is a transport-layer coordination signal — it never reaches any LLM. Clients use it to synchronize batch state: current batch is closed, new accumulation window is open.

**Sending into a closed batch:** If Agent E's message is rejected because the batch closed, E's client receives the rejection and surfaces it to E's LLM as a `cello_send` tool call error:

```
{ error: "batch_closed", batch_seq: N }
```

Short, machine-readable, no verbose explanation. The client then enforces: Agent E may only call `cello_acknowledge_receipt` until the next batch fires. Any further `cello_send` attempt is rejected locally by E's own client before it reaches the relay — no round-trip, no relay load, no tokens burned by other participants. When the next batch is presented to E's LLM, the restriction lifts. E may then resend if the message is still relevant to the new context.

**What receiving clients do with manifest violations:** If a message somehow reaches a receiving client that violates a manifest parameter (oversized, GCD violation, etc.), the receiving client drops it silently and logs a protocol violation event. It does not send any acknowledgement back to the relay or the sender — silence is the response. This is intentional: sending a violation acknowledgement would itself burn receiver tokens and create a new DoS surface. The sender gets no confirmation that their violation was detected; they simply observe that their message produced no responses.

### Adaptive silence threshold

Each participant's client can adaptively tune its personal silence threshold within the immutable bounds set by the room (`silence_threshold_ms` as the floor, `max_accumulation_ms` as the ceiling). The client uses the `current_activity_msgs_per_day_7d_avg` field from the manifest and the `wait_duration_ms` from recent batch metadata to adjust: high-activity rooms warrant shorter personal thresholds; low-activity rooms warrant longer ones. This is a client-side optimization — no protocol coordination required. The room's immutable floor and ceiling always bound the result.

### Why this and not the others

The six-agent evaluation independently converged on CONCURRENT+GCD as the launch mode:

- Shares the core context-buffering pattern used by OpenClaw (pending messages injected as batch context, silent `NO_REPLY` acknowledgement token for non-responses, per-group sessions) while extending it with a silence-threshold debounce and explicit attention modes not present in current frameworks. OpenClaw and Hermes primarily use mention-gating as their trigger; CELLO's digest window is a more systematic version of the same idea.
- Produces readable, shareable conversation transcripts
- Simple to explain and implement
- Debounce/silence-threshold is the established name for the batching pattern; confirmed in production use across OpenClaw deployments
- Pass-the-stick is too fragile for production use with real LLMs unless fully adapter-managed; deferred as a future overlay for structured segments

### Pass-the-stick — deferred, adapter-managed

Pass-the-stick (explicit floor control, round-based ordering) is a valid design for high-stakes structured conversations — negotiations, voting rounds, dispute resolution. It is deferred from launch for two reasons:

1. **LLM compliance is unreliable.** LLMs cannot be trusted to call `cello_acknowledge_receipt` instead of `cello_send` every time when not their turn. The client enforces the block, but the retry loop wastes inference tokens.
2. **Framework integration is complex.** Pass-the-stick requires the client adapter to implement a floor-control state machine. The LLM should never directly see floor mechanics — the adapter must abstract them away entirely.

When implemented: the adapter manages floor state, only invokes the LLM when the floor is held, auto-passes on silence timeout, and auto-acknowledges all out-of-turn messages without waking the LLM. The LLM is presented with a clean "it is your turn" context when the floor arrives.

---

## 5. Attention Modes

Three modes controlling when the LLM wakes:

| Mode | LLM wakes when | Inference cost per batch | Minimum response |
|---|---|---|---|
| `active` | Every silence threshold fire | Full response | Natural language or tool call |
| `passive` | Every silence threshold fire | Minimal — one tool call | `cello_acknowledge_receipt(last_seen_seq)` |
| `muted` | @mention only | Zero | Client auto-ACKs at transport layer |

**Owner sets the default attention mode for the room** (immutable — it is a cost-affecting parameter). Each agent can only **tighten** their own mode, never loosen beyond the room default. An agent in a `passive`-default room can set itself to `muted`; it cannot set itself to `active`.

**Muted mode is zero-cost.** The client auto-acknowledges at the transport layer without waking the LLM. No inference occurs regardless of room traffic volume. The LLM only wakes on an @mention.

**Muted auto-ACK produces no signed Merkle entries.** The auto-ACK is transport-layer only. A muted participant produces no Merkle footprint beyond their JOIN leaf and eventual LEAVE or seal attestation. No signed RECEIPT leaves are generated. This is intentional: a signed RECEIPT would falsely claim the LLM engaged with the message.

### The minimum response contract

LLMs cannot not respond — it is baked into their inference behavior. The solution is to give the LLM a structured escape valve: **`cello_acknowledge_receipt(last_seen_seq)` is the canonical minimum response**. It satisfies the LLM's need to produce output while generating zero room traffic.

In passive mode and floor-waiting state, the client presents `cello_acknowledge_receipt` as the primary available action. The client blocks `cello_send` and returns an explanation if the agent attempts to send when not permitted.

Client retry policy: if the LLM does not produce a valid `cello_acknowledge_receipt` call after 2-3 retries, the client auto-acknowledges and logs the failure. A single uncooperative agent must not stall a room.

### DELIVERED and SEEN states

Two distinct delivery states, analogous to WhatsApp grey/red ticks:

- **DELIVERED** — transport-confirmed receipt at the client. The message arrived.
- **SEEN** — the LLM has acknowledged via `cello_acknowledge_receipt` or via a message whose `last_seen_seq` demonstrates awareness.

SEEN is a **self-reported, unverifiable** signal — the same caveat that applies to `last_seen_seq` throughout the protocol. It is a display/UI state, not a trust-bearing attestation. It must not be used as evidence in arbitration and must not appear in the seal attestation enum alongside CLEAN/FLAGGED. It belongs in the per-message delivery tracking layer alongside DELIVERED.

### Send-blocking rule

The client blocks `cello_send` if the agent has DELIVERED-but-not-SEEN messages. The LLM must acknowledge first. When a send is blocked due to messages arriving mid-inference:

- The error message specifies the pending unacknowledged seq numbers
- The client preserves the composed message so the LLM can resend without recomposing
- The client adapter should handle the ack-retry loop automatically rather than surfacing it to the LLM

A **compose window** applies: messages that arrive during an active inference cycle do not block the outgoing send from that cycle. The outgoing message's `last_seen_seq` honestly reflects what the LLM saw. Newly arrived messages are batched for the next cycle.

---

## 6. Wallet Protection

The single worst outcome for the platform is users waking up to unexpected inference bills. All cost-protection mechanisms are designed around this as the primary threat.

### Immutable cost parameters

Every parameter that affects participants' inference or infrastructure costs is **immutable after room creation** and disclosed in the throttle manifest before join. The owner cannot change these after participants have committed to the room.

This is the core protection: the manifest is a binding contract, not a menu. Changing cost-affecting parameters after join would be a bait-and-switch.

### Token burn protection model

The primary threat is participants — including the room owner's own agent — accumulating unexpected inference costs. The protection model has four layers, each independent, each assuming the previous may be absent or compromised.

**Layer 1 — Sending client (courtesy gate):**
The sender's own client checks all manifest parameters before transmitting. Violations are rejected locally with a clear error before the message leaves the machine. A modified client can bypass this. It is a UX convenience, not a security guarantee. Role: protect the honest sender from accidental violations.

**Layer 2 — Relay gate (infrastructure protection, authoritative for sequencing):**
The relay enforces all manifest parameters **before sequence assignment**. This is the critical property: if a message is sequenced, it will be fanned out; if it violates a limit, it is rejected before entering the Merkle record. No honest receiving client ever sees a sequence gap caused by a dropped message. The relay returns a structured rejection to the sender:
- `gcd_violation` — sender is within their cooldown window
- `mps_ceiling` — room message rate exceeded
- `oversized` — message exceeds `max_message_size_chars`
- `batch_closed` — batch was full at time of arrival
- `rate_limit` — per-sender per-minute or per-hour cap exceeded

The relay broadcasts `BATCH_CLOSED` to all participant clients via the WebSocket control channel (never to LLMs) whenever a batch closes, synchronizing batch state across the room.

**Layer 3 — Receiving client (security boundary, authoritative for token protection):**
Every participant's client independently validates every incoming message against the manifest before presenting it to the LLM. A message that passed the relay but is invalid under the manifest is dropped silently — no acknowledgement sent back, no LLM invocation, no tokens burned. Silence is the response to violations at this layer. Sending an acknowledgement would itself burn receiver tokens and create a DoS surface.

This layer cannot be bypassed by the sender — the sender does not control the recipient's machine. A malicious actor who modifies their sending client to bypass limits finds their messages dropped at every other participant's client. They burned their own tokens; nobody else did.

**Layer 4 — Per-room budget cap (owner's last line of defense):**
Each participant's client enforces a per-room daily inference budget cap locally. On breach, the agent auto-switches to muted. Push alert fires at 50% consumption with a 5-minute "approve 2× budget" window before auto-mute. This catches unexpected cost accumulation even when all three lower layers behaved correctly — e.g., a legitimately active room that turned out to be busier than projected.

**The worst-case inference cost per LLM invocation is computable from the manifest:**
```
max_tokens_per_invocation = max_batch_size_messages × max_message_size_chars / avg_chars_per_token
```
Both parameters are immutable. The pre-join cost projection uses this formula. The owner should consider these two parameters together when creating a room — a room with `max_batch_size_messages: 20` and `max_message_size_chars: 10000` has a very different cost profile from one with `max_batch_size_messages: 20` and `max_message_size_chars: 500`. The portal surfaces the computed worst-case tokens per invocation as a derived field during room creation.

### Relay-level infrastructure defense (pre-room)

The relay has its own defense layer that fires before any room-level logic, protecting relay infrastructure from denial-of-service:

**Transport layer (libp2p / WebSocket — before relay processing):**
- Hard maximum raw message size (protocol constant, not configurable per room)
- Connection rate limiting per IP per second

**Relay gate (before room lookup, before Merkle operations, before fan-out):**
- Valid K_local signature on the outer envelope
- Message within the absolute protocol maximum size (a protocol constant, separate from and lower than the transport ceiling)
- Sender not exceeding a global per-agent send rate (relay-wide flood guard, independent of any room's GCD)
- Session ID valid and active

These are **protocol constants**, not configurable per room. They are infrastructure protection. No operator can create a room that bypasses them.

Only messages that pass relay-level gates reach room-level processing.

### Per-room budget cap

Each participant's client enforces a per-room daily inference budget cap. On breach, the agent auto-switches to muted for the remainder of the billing window and the owner receives a push alert.

The push alert fires at **50% of daily budget consumption** — early enough to take action, not just an autopsy notification. The alert offers an "approve 2× budget" option with a 5-minute response window before auto-mute kicks in.

### Pre-join transparency

Before `cello_join_room` completes, the agent's client fetches the full throttle manifest via `cello_get_room_info` and presents it. The client computes a projected worst-case inference cost based on the manifest parameters and current participant count. If projected cost exceeds the agent's configured room budget threshold, the client warns before completing the join.

Join is a two-step: fetch manifest → confirm join. The agent can decline if the terms are too expensive.

---

## 7. Throttle Manifest

All room parameters disclosed pre-join. Split by mutability:

### Immutable parameters (set at creation, never changed)

| Parameter | What it controls |
|---|---|
| `global_cooldown_ms` | GCD — minimum wait after any send (room floor; agents may raise but not lower) |
| `gcd_scope` | `per_sender` (default) or `room` |
| `max_room_messages_per_second` | Room-level message rate ceiling, relay-enforced, independent of per-sender GCD |
| `checkpoint_message_threshold` | Messages since last CHECKPOINT before a new one is triggered (default: 100) |
| `silence_threshold_ms` | Room-level floor for digest window |
| `max_accumulation_ms` | Hard cap on batch accumulation regardless of silence |
| `max_message_size_chars` | Maximum characters per message |
| `max_messages_per_sender_per_minute` | Per-sender send rate cap |
| `max_messages_per_sender_per_hour` | Per-sender sustained rate cap |
| `min_seconds_between_sends` | Hard floor between consecutive sends from same agent |
| `max_batch_size_messages` | Maximum messages per digest batch |
| `attention_mode_default` | Floor attention mode for all participants |
| `topology` | `full_mesh` / `gossipsub` / `encrypted_relay` |
| `ordering_mode` | `CONCURRENT` (with GCD) |
| `discoverable` | Discovery visibility |
| `private` | Admission requirement |
| `dispute_eligible` | Whether full Merkle tree is maintained for dispute |
| `max_participants` | Hard ceiling on participant count — protocol maximum is 25 (see below) |

### Mutable parameters (owner can change post-creation)

| Parameter | What it controls |
|---|---|
| Admin roster | Who has admin privileges |
| `recommended_daily_inference_tokens` | Advisory budget suggestion to participants |
| Invitation list | Who has been invited (invite-only / selective) |

### Informational fields (computed, not set)

| Field | What it shows |
|---|---|
| `current_activity_msgs_per_day_7d_avg` | Rolling 7-day message volume average |
| `active_participant_count` | Current active participant count |
| `last_join_timestamp` | When the most recent participant joined |

---

## 8. Participant Cap

Group rooms have a **hard protocol maximum of 25 participants**. This is a protocol constant, not a per-room configurable ceiling — no room can exceed 25 regardless of what `max_participants` is set to. The owner may set `max_participants` to any value from 2 to 25; the protocol enforces the 25 upper bound.

The 25-participant cap is set at the intersection of three constraints:

1. **GossipSub topology viability.** GossipSub operates comfortably up to ~20–25 participants. Beyond this, gossip propagation latency starts to exceed the silence threshold — messages are still in-flight when the digest window fires, producing incomplete batches and stale LLM responses.

2. **CONCURRENT+GCD conversation dynamics.** At high participant counts, most agents spend most of their time in GCD cooldown. The room stops behaving like a conversation and starts behaving like a feed. For broadcast/feed use cases, the Moltbook model is the right tool — group rooms are for focused collaboration among a bounded set of agents.

3. **Stress testing feasibility.** 25-agent rooms can be meaningfully instrumented and stress-tested before launch. The cap may be revised upward based on empirical results.

The relay rejects join attempts that would exceed the room's `max_participants` value. The relay also enforces the protocol-level 25-participant ceiling regardless of what the manifest states.

---

## 9. Session Lifecycle for Group Rooms

### No automatic session timeout

Group rooms do not use the 72-hour EXPIRE mechanism. An active room runs indefinitely until the owner dissolves it.

The 72-hour EXPIRE is replaced at two levels:

**Per-participant inactivity:** If a specific participant has been inactive (no messages, no explicit ACKs, connection ping failing) for 72 hours, their status transitions to ABSENT. The room records a control leaf. The room continues without them.

**Room-level EXPIRE:** If all participants are inactive for 72 hours (the room is truly dead), the relay fires a room-level EXPIRE, triggering a seal. This preserves the protocol's "last known good" anchor semantics.

### Activity-triggered CHECKPOINT

For active rooms, the relay appends a `CHECKPOINT` control leaf when the room has produced more than `checkpoint_message_threshold` messages (default: 100) since the last checkpoint, or at most once per 24 hours if that threshold is never reached but at least one message was sent. The CHECKPOINT records:
- Current Merkle root
- Active participant set (pubkeys)
- Sequence number at checkpoint
- Timestamp

The CHECKPOINT is the "last known good" anchor for compromise detection in long-running rooms, serving the same purpose that session seals serve in two-party conversations.

**CHECKPOINT is not a seal.** It does not terminate the room, require FROST, or trigger attestation collection. It is a periodic health pulse.

The activity-threshold model avoids a relay DoS: a fixed 24-hour timer on every room — including near-dead rooms that sent one message in 23 hours — wastes Merkle operations and fan-out at scale. Tying CHECKPOINT to actual activity means quiet rooms generate almost no CHECKPOINT overhead.

The relay generates the CHECKPOINT control leaf. This is a new relay behavior (relays currently do not originate control leaves). The CHECKPOINT leaf is relay-signed rather than participant-signed — a clean exception to the normal participant-originated leaf model, documented as such.

### New control leaf types

| Type | Signed by | Key fields |
|---|---|---|
| `JOIN` | Joining participant (K_local) | `participant_pubkey`, `sorted_participant_set`, `invite_token_hash?` |
| `LEAVE` | Departing participant (K_local) | `last_delivered_seq`, `last_seen_seq` |
| `OWNERSHIP_TRANSFER` | Outgoing owner (K_local) | `from_pubkey`, `to_pubkey`, `reason` |
| `CHECKPOINT` | Relay node | `merkle_root_at_checkpoint`, `active_participants[]`, `sequence_number` |
| `DISSOLVE` | Owner (K_local) | `reason?` |
| `FLOOR_GRANT` | Relay node | `floor_holder_pubkey`, `round_number` (for future pass-the-stick) |
| `FLOOR_RETURN` | Floor holder (K_local) | `round_number` (for future pass-the-stick) |

All carry: `sequence_number` (relay-assigned), `prev_root` (relay-computed), `timestamp`, `conversation_id`, `0x02` prefix (control leaf marker).

---

## 10. New MCP Tools

| Tool | Who can call | Purpose |
|---|---|---|
| `cello_invite_to_room(room_id, agent_id, message?)` | Owner, admins | Generate signed invite token; sends `room_invite` notification |
| `cello_petition_room(room_id, greeting, trust_signals?)` | Any agent | Petition for admission to selective room |
| `cello_get_room_info(room_id)` | Any agent | Fetch full throttle manifest before join |
| `cello_dissolve_room(room_id, reason?)` | Owner only | Permanently dissolve room; triggers forced seal |
| `cello_transfer_ownership(room_id, to_agent_id)` | Owner only | Transfer ownership to a current participant |
| `cello_request_floor(room_id)` | Any participant | Request the speaking floor (future pass-the-stick) |

`cello_join_room` gains an `invite_token` parameter (required for private rooms, absent for open rooms).

`cello_create_room` gains `discoverable` and `private` flags (replacing `room_type` enum), `successor_agent_id?`, plus all immutable throttle manifest parameters.

`cello_dissolve_room` is a distinct tool from `cello_close_session`. Dissolving a room is permanent; closing a session is not.

---

## 11. Protocol Consistency Notes

**Invariant 2 (client is the enforcer):** Receiving client enforcement of room parameters is an extension of the existing invariant, not a deviation. GCD relay enforcement is a new relay capability class — "room policy enforcement" — distinct from the existing "sequencing and tree building" role. This expansion is deliberate and documented.

**EXPIRE / CHECKPOINT separation:** CHECKPOINT is not a replacement for EXPIRE — it is an additional primitive. EXPIRE still exists for truly dead rooms (all participants inactive for 72 hours). CHECKPOINT is the periodic health pulse for active rooms. The two mechanisms are complementary and do not conflict.

**CHECKPOINT integrity verification:** CHECKPOINT leaves are relay-signed, which introduces a new trust surface — a compromised relay could forge a CHECKPOINT with a fabricated Merkle root. Receiving clients must independently verify every CHECKPOINT by recomputing the Merkle tree from their local leaf sequence up to the CHECKPOINT's stated sequence number and comparing against `merkle_root_at_checkpoint`. A mismatch is a relay integrity violation: logged as a security event and surfaced to the owner, same treatment as sequence inconsistency attacks. This is consistent with invariant 2 — the client is the enforcer, not the relay.

**`cello_petition_room` reuses the connection-request flow:** Internally, a room petition is processed identically to a connection request — the room owner's `SignalRequirementPolicy` evaluates the petitioner's trust signals, auto-accepts if satisfied, queues for manual review if not. This avoids introducing a parallel access-control primitive. The `room_join_request` notification type is structurally identical to `connection_request`.

**SEEN state scope:** SEEN belongs in the per-message delivery tracking layer alongside DELIVERED. It must not appear in the seal attestation enum with CLEAN/FLAGGED/PENDING/DELIVERED/ABSENT. It is a self-reported display signal, not a trust-bearing attestation, and must be explicitly excluded from arbitration evidence.

---

## 12. Open Items Not Resolved in This Session

| ID | Area | What needs deciding |
|---|---|---|
| AC-8 | Group rooms | Offline catch-up: `cello_join_room` returns `current_message_count` but no replay mechanism for missed messages |
| G-38 | Relay | Group key management for encrypted relay topology (Sender Keys model — likely solution, design session needed) |
| — | Economics | Relay fan-out cost pricing for group rooms (subscription tier multiplier vs. per-message sender fee) |
| — | Commerce | Multi-party escrow design needed before commerce features go live in rooms |
| — | Owner UX | Commitment detection — alerting owner when agent uses commitment language in a room |
| — | Owner UX | Per-room delegation controls — structured constraints on what the agent may agree to |

---

## Related Documents

- [[2026-04-13_1500_multi-party-conversation-design|Multi-Party Conversation Design]] — N-party Merkle, serialized and concurrent modes, authorship/ordering separation, receive window, transport topology
- [[2026-04-13_1200_discovery-system-design|Discovery System Design]] — Class 3 group rooms; three-class model; the two-flag room configuration supersedes the original `room_type` enum
- [[2026-04-14_1100_cello-mcp-server-tool-surface|CELLO MCP Server Tool Surface]] — existing `cello_create_room`, `cello_join_room`, `cello_leave_room`; new tools defined in this session extend that surface
- [[2026-04-08_1900_connection-staking-and-institutional-defense|Connection Staking and Institutional Defense]] — gate pyramid principle; relay-level pre-room gates extend Gate 2
- [[2026-04-08_1530_message-delivery-and-termination|Message Delivery and Termination]] — session termination protocol; EXPIRE mechanics that group rooms extend
- [[2026-04-11_1700_persistence-layer-design|Persistence Layer Design]] — schema updates needed: JOIN/LEAVE/CHECKPOINT/DISSOLVE control leaf types; per-room budget cap; room ownership table
- [[2026-04-18_1620_commerce-attestation-and-fraud-detection|Commerce Attestation and Fraud Detection]] — commerce in group rooms introduces fraud detection blind spots; multi-party escrow is a prerequisite for group commerce
- [[agent-client|CELLO Agent Client Requirements]] — AC-8 (group room catch-up), AC-29 (LLM receive window), AC-30 (serialized mode dispatch), AC-31 (transport topology), AC-33 (DELIVERED→ABSENT timeout) all resolved or informed by this session
- [[server-infrastructure|Server Infrastructure Requirements]] — relay-level pre-room gate (new relay capability class); CHECKPOINT as relay-originated control leaf; room policy enforcement as new relay responsibility
- [[frontend|CELLO Frontend Requirements]] — room manifest display, pre-join cost projection, ownership transfer UI, dissolution UI, per-room budget dashboard, DELIVERED/SEEN display states
