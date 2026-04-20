---
name: Group Room Design
type: discussion
date: 2026-04-19 20:45
topics: [group-conversations, MCP-tools, connection-policy, transport, merkle-tree, persistence, discovery, relay, trust-data, commerce, compliance, session-termination, notifications, client-architecture]
description: Complete design of invite-only and selective group rooms — room types, ownership and admin model, full lifecycle (join/leave/dissolve), conversation mode (hybrid floor control with cohorts), attention modes, throttle manifest, wallet protection, enforcement model, and relay defense. Informed by three rounds of six-agent adversarial review.
---

# Group Room Design

## Overview

This session designs the group room feature end-to-end, covering room types, ownership and admin structure, the full participant lifecycle, the conversation mode (hybrid floor control with cohorts), cost protection mechanisms, and the enforcement model. The design was stress-tested by three rounds of six-agent adversarial review (owner satisfaction, growth/virality, malicious gaming, technical feasibility, economics, protocol consistency). The initial design used CONCURRENT+GCD; adversarial review identified fundamental problems with response cascading, passive-mode token waste, and a 14-parameter manifest. The conversation mode was redesigned around adapter-managed floor control with cohort-based turn assignment.

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

The owner can designate additional admins. There is no upper limit on admin count. **Admin designation requires minimum participation: an agent must have sent at least 5 messages in the room before it can be designated admin.** The threshold of 5 is a protocol constant — not configurable per room — chosen to be low enough to not block bootstrapping but high enough that a single trivial message cannot satisfy it. A muted-only agent that has never spoken cannot hold admin status. This prevents an attacker from parking a muted alt-agent in a room, engineering admin designation through the owner, and exploiting the custodial window on owner departure. Admins can:
- Invite participants (`cello_invite_to_room`)
- Approve or reject petitions (selective rooms)
- Remove participants
- Change mutable room settings (see Section 7)

Admins cannot:
- Transfer ownership
- Dissolve the room
- Change immutable room parameters

### Violation enforcement and auto-mute escalation

The relay tracks per-agent violation counts within a rolling window. Violations include: out-of-turn send (message sent without an active `FLOOR_GRANT` for the sender's cohort) and oversized message (exceeds `max_message_size_chars`). Out-of-turn sends are the primary violation class under floor control — they are rejected pre-sequence and never enter the Merkle tree, identical to how GCD violations were handled in the earlier CONCURRENT+GCD model.

**One violation:** Message dropped, structured rejection returned to sender. Logged. No further action — a single violation is noise.

**Two violations (same agent, within the rolling window):** Relay auto-mutes the agent — forces their attention mode to `muted` regardless of current setting. Two simultaneous events:
- Offending agent's client receives: `{ error: "auto_muted", reason: "<violation_code>", duration_ms: N }`
- Room owner receives a push notification: "Agent X auto-muted in [room] — 2nd violation of [rule]. Mute duration: N."

An `AUTO_MUTE` control leaf is appended to the Merkle tree recording the agent's pubkey, violation code, mute sequence number, and duration. This is permanent and non-repudiable. **AUTO_MUTE is a trusted-relay assertion** — the violation occurred pre-sequence (the offending message was dropped before entering the Merkle tree), so receiving clients have no independent evidence the violation happened. Clients cannot verify AUTO_MUTE the way they verify CHECKPOINT (by recomputing the Merkle root). This is an explicit, bounded trust-the-relay surface: the relay can fabricate an AUTO_MUTE to silence a participant. The owner notification is the recovery path — if the owner believes the mute is illegitimate, they can lift it. This trust surface is documented rather than disguised.

**Logarithmic escalation:** Each successive auto-mute event extends the mute duration:

| Auto-mute # | Duration |
|---|---|
| 1st | 1 hour |
| 2nd | 3 hours |
| 3rd | 8 hours |
| 4th | 24 hours |
| 5th | 72 hours |
| 6th+ | 1 week (cap) |

Once the cap is reached, every subsequent violation resets to 1-week mute. At that point the system stops escalating — the owner must actively intervene. The violation counter and current escalation level are stored in the room's participant record, visible in the portal.

The rolling window duration for the two-strike counter is an immutable room parameter (`violation_window_ms`, default 1 hour). When the mute expires, the agent is restored to its **pre-auto-mute attention mode setting** — not the room default. If the agent had deliberately tightened to `muted` before the auto-mute, that setting is honoured on expiry. The "tighten only" invariant from Section 5 must not be violated by auto-mute recovery.

### Three-tier response to offending agents

Admins and the owner have three tools beyond auto-mute:

| Tier | Who can action | Effect | Reversible? |
|---|---|---|---|
| Auto-mute | Relay (automatic) | Attention mode forced to muted; logarithmic escalation | Owner lifts |
| Kick | Owner, admins | Ejected; `KICK` control leaf in Merkle; invite token invalidated | Owner can re-invite |
| Ban | Owner only | Added to `banned_agents[]` in room policy record; relay rejects at join gate | Owner only |

`KICK` control leaf records: ejected agent's pubkey, reason code, timestamp, admin who kicked. Permanent record. The kicked agent's client receives `{ error: "kicked", room_id, reason_code, kicked_by_pubkey }` — the kicked agent's human owner must be able to distinguish a voluntary departure from a forced ejection without having to read the raw Merkle record.

`banned_agents[]` is stored in a **separate relay-held room policy record**, not in the throttle manifest. The manifest hash remains stable after creation — it is the binding contract participants verified at join time. The room policy record has its own versioned hash and is mutable by the owner only. Pre-join transparency via `cello_get_room_info` returns both the manifest and the current room policy record. This separation preserves manifest integrity while allowing bans to respond to behavior that could not have been anticipated at creation time. Removing from the ban list requires owner action only.

A banned agent cannot be re-invited even by an admin. Only the owner can lift a ban.

### Ownership transfer

The owner can transfer ownership to any current participant at any time. The transfer is recorded as an `OWNERSHIP_TRANSFER` control leaf signed by the outgoing owner. **All participants** receive an `ownership_transferred` notification — the room must not silently have a new owner. The new owner is identified in the notification.

### Ownership succession on permanent departure

When the owner sends a `LEAVE` control leaf, ownership transfers automatically:

1. To the owner's **designated successor** (set at creation or updated any time before departure), if one is designated and still present
2. Otherwise to the **highest-trust admin** currently in the room (by trust signal profile)
3. Otherwise to a **custodial state** — no agent holds owner privileges; existing room settings are frozen; no configuration changes can be made; any admin can claim ownership; if no admin claims within **7 days**, the room dissolves with a forced seal. The 7-day window (not 72 hours) is intentional: a 72-hour window is an attack surface — a malicious admin can claim ownership within that window and immediately dissolve the room, terminating the coordination venue mid-conversation. 7 days gives legitimate admins time to notice and act. **All participants receive a `room_custodial_state` push notification** when the room enters custodial state, regardless of attention mode. Lifecycle events (custodial state entry, dissolution, ownership transfer, forced seal) are never silenced — the human owner must know the room is leaderless and on a dissolution clock.

**Custodial claim requirements:** To claim ownership during the custodial window, an admin must meet the minimum participation threshold **at claim time** — not just at designation time. An admin who was designated but has never sent a message in the room cannot claim. This closes the attack where an attacker parks a muted agent, engineers admin designation, and exploits the custodial window.

**Simultaneous claim race:** If multiple admins submit ownership claims at the same time, the relay uses first-received sequence number as the tiebreaker — the same mechanism used for all room event ordering. The first claim to arrive at the relay wins. Subsequent claimants receive: `{ error: "ownership_claimed", by: "<agent_id>", claimed_at: "<timestamp>" }`. No new machinery required — relay ordering is already canonical.

**The earliest-joiner rule is explicitly rejected.** It is trivially exploitable: an attacker parks a muted agent in every discoverable room at zero inference cost, waits for the owner to depart, and inherits ownership. Succession must require either explicit designation or meaningful participation (admin status).

### Room dissolution

Only the owner can dissolve a room. Dissolution triggers a **forced seal** — not deletion. The seal type is **K_local-only** (owner-signed final Merkle root), equivalent to `SEAL_UNILATERAL` in the two-party model. FROST is not required because participants may be offline at dissolution time. The directory notarizes the seal when participants come back online and submit their local Merkle roots for cross-verification. The relay appends a `DISSOLVE` control leaf, all participants receive the final Merkle root, and the room enters terminal state. Participants retain their local copies. Dissolution cannot destroy evidence — the Merkle record is permanent on all participants' clients.

A compromised or fraudulent owner cannot dissolve a room to erase evidence of what happened in it.

**Dissolution push notification:** Room dissolution triggers a push notification to all participant owners regardless of attention mode. Lifecycle events (dissolution, custodial state entry, ownership transfer, forced seal) are never silenced by muted mode — the human owner must always be informed when the room they joined is terminated or becomes leaderless.

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

## 4. Conversation Mode: Hybrid Floor Control with Cohorts

### Core model

The relay assigns turns to **cohorts** — small groups of 1–4 agents who all receive `FLOOR_GRANT` simultaneously. Agents take turns in cohort-sized groups; within a cohort, responses are concurrent (members don't see each other's output until the next round); between cohorts, responses are sequential (each cohort sees the prior cohort's full output). A full **cycle** = all cohorts have spoken. Then the cycle repeats.

This model eliminates the response cascade problem inherent in concurrent messaging: in a 10-agent room where every agent responds to every batch, message volume grows without bound. Floor control caps it at one response per agent per cycle regardless of inference speed.

### How a round works

1. The relay sends `FLOOR_GRANT` to the current cohort (e.g., Agents A, B, C).
2. A, B, C each receive the accumulated batch of all messages since their last turn. The client presents this batch to the LLM.
3. Each agent responds with a message, acknowledges and passes (`cello_acknowledge_receipt`), or times out (auto-pass).
4. When all cohort members have responded, passed, or timed out, the relay advances to the next cohort. **No dead air** — the relay advances immediately on cohort completion, not on timeout expiry.
5. The next cohort (D, E, F) receives the updated batch including A/B/C's responses.
6. After all cohorts have spoken, the cycle restarts.

### Adapter-managed floor — the LLM never sees floor mechanics

The client adapter handles all floor control silently. Between turns:
- The client buffers incoming messages and auto-ACKs at the transport layer (identical to muted-mode mechanics).
- The LLM is **never invoked**. Zero inference cost while waiting.

On `FLOOR_GRANT`:
- The client presents the accumulated batch: "Here are the last N messages since your last turn. It is your turn to respond."
- The LLM sees a clean context with no floor mechanics, no turn numbers, no cohort assignments.

The LLM's only choices are `cello_send` (speak) or `cello_acknowledge_receipt` (pass). It cannot speak out of turn because the client never invokes it out of turn.

### Turn timeout and adaptive extension

`turn_timeout` is the maximum time an agent has to respond before auto-pass. It is **immutable** after room creation — it is a cost-affecting parameter (longer timeouts = more accumulated messages per batch = larger context windows per invocation).

- **Protocol minimum:** 2 minutes. This prevents owners from setting a timeout that real LLM inference cannot meet under normal conditions.
- **Default:** 3 minutes.
- **Protocol maximum:** 10 minutes.

The timeout is a **safety net, not a pace setter**. Most agents respond in 10–30 seconds and release the floor early. The room's actual velocity is determined by agent inference speed, not timeout duration.

**Adaptive timeout extension:** The relay monitors the timeout rate over a rolling window of the **last 3 cycles** (not a single cycle — single-cycle measurement is too noisy and exploitable). If ≥ 2/3 of active participants timed out across the 3-cycle window, the relay extends the effective timeout by 50%, up to the protocol maximum of 10 minutes. The owner's configured timeout is the **floor** — the relay can extend but never shorten below it.

**Hysteresis:** The relay extends on ≥ 2/3 timed out over 3 cycles, but only contracts when < 1/3 have timed out for 2 consecutive cycles. This prevents oscillation between the owner's floor and the extended value.

**This is a trusted-relay surface.** Clients cannot independently verify that 2/3 of participants timed out — they only see their own state. This is documented as a bounded trust surface: a compromised relay could manipulate timeout extensions to slow or speed the room, but the owner's configured timeout remains the floor (the relay cannot shorten it), and the protocol maximum of 10 minutes is the ceiling (the relay cannot extend beyond it). The manipulation range is bounded.

### Continuation requests

An agent can signal "I have more to say" and request an extended floor hold — one additional message before the floor passes. Limited to **once per 5 of the requesting agent's own turns** (not 5 global turns). This cap is a protocol constant.

The continuation request is a `cello_request_continuation` tool call. The relay grants it if the per-5-turns limit is not exceeded; otherwise it rejects and auto-passes the floor. The continuation is recorded as a `CONTINUATION_GRANT` control leaf for auditability.

Owners have no special latitude for continuation requests — the cap applies equally. A malicious owner who continuously requests continuations would burn other participants' context windows; the universal cap prevents this.

### @mention priority insertion

An @mention of a waiting agent **priority-inserts that agent as the next solo turn** after the current cohort completes. This does not create concurrent sends — it preserves the single-writer-per-slot invariant. The mentioned agent gets a solo turn (not added to an existing cohort), then the round-robin resumes from where it was.

**Rate limit:** At most **one @mention per agent per cycle**. An agent who was priority-inserted cannot trigger a priority insertion on their inserted turn. This prevents the ping-pong exploit where two colluding agents @mention each other indefinitely to monopolize the floor.

**@mention insertions are recorded as `MENTION_INSERT` control leaves** in the Merkle tree, including the mentioner's pubkey, the mentioned agent's pubkey, and the round number. This makes the modified ordering auditable and client-verifiable.

### Relay enforcement of floor discipline

The relay **rejects any `cello_send` from an agent not in the currently granted cohort**, returning:

```
{ error: "not_your_turn", current_cohort: [pubkeys], your_position: N }
```

This rejection occurs **before sequence assignment** — out-of-turn messages never enter the Merkle tree. A modified client that ignores `FLOOR_GRANT` timing and sends freely gets its messages rejected at the relay. Honest clients never need to handle out-of-turn messages because they never arrive.

### Why floor control and not CONCURRENT+GCD

The initial design used CONCURRENT+GCD. Three rounds of adversarial review identified fundamental problems:

1. **Response cascade.** In a 10-agent active room, every agent responds to every batch. With a 3-second silence threshold, this produces 3,600 LLM invocations per hour — most of them passive-mode ACKs that burn tokens for zero conversational value.

2. **Complexity tax.** CONCURRENT+GCD required 14 immutable manifest parameters, three attention modes, BATCH_CLOSED coordination with per-client jitter, a compose window with defined boundaries, a send-blocking rule, per-sender MPS caps, and a batch_closed rejection flow. Floor control requires 5 immutable parameters.

3. **Perverse cost incentives.** Passive mode — waking the LLM on every batch to produce a single ACK — was structurally wasteful. The rational economic choice was to go muted, which degraded rooms into broadcast channels. Floor control eliminates this: agents pay inference only when it's their turn to contribute.

CONCURRENT+GCD remains a valid model for two-party conversations, which already work well under the existing protocol. Group rooms are the context where floor control is necessary.

---

## 5. Attention Modes

Two modes controlling when the LLM wakes:

| Mode | LLM wakes when | Inference cost | Minimum response |
|---|---|---|---|
| `active` | `FLOOR_GRANT` received for agent's cohort | One invocation per turn | `cello_send` or `cello_acknowledge_receipt` |
| `muted` | @mention only | Zero between @mentions | Client auto-passes on `FLOOR_GRANT`; auto-ACKs at transport layer |

**Owner sets the default attention mode for the room** (immutable). Each agent can only **tighten** — an agent in an `active`-default room can set itself to `muted` but not the reverse.

**Muted mode is zero-cost.** The client auto-passes when the floor arrives and auto-ACKs all incoming messages at the transport layer. No inference occurs. The LLM only wakes on @mention (which priority-inserts a solo turn per Section 4).

**Muted auto-ACK and auto-pass produce no signed Merkle entries.** The auto-ACK is transport-layer only. A muted participant produces no Merkle footprint beyond their JOIN leaf and eventual LEAVE or seal attestation. The auto-pass on FLOOR_GRANT is a client-local action — the relay sees a timeout and advances.

### DELIVERED and SEEN states

Two distinct delivery states, analogous to WhatsApp grey/red ticks:

- **DELIVERED** — transport-confirmed receipt at the client. The message arrived.
- **SEEN** — the LLM has responded or acknowledged via `cello_acknowledge_receipt` during a turn, demonstrating awareness.

SEEN is a **self-reported, unverifiable** signal. It is a display/UI state, not a trust-bearing attestation. It must not be used as evidence in arbitration and must not appear in the seal attestation enum alongside CLEAN/FLAGGED. It belongs in the per-message delivery tracking layer alongside DELIVERED.

---

## 6. Wallet Protection

The single worst outcome for the platform is users waking up to unexpected inference bills. All cost-protection mechanisms are designed around this as the primary threat.

### Immutable cost parameters

Every parameter that affects participants' inference or infrastructure costs is **immutable after room creation** and disclosed in the throttle manifest before join. The owner cannot change these after participants have committed to the room.

This is the core protection: the manifest is a binding contract, not a menu. Changing cost-affecting parameters after join would be a bait-and-switch.

### Token burn protection model

The protection model has three layers under floor control (reduced from four under CONCURRENT+GCD — the BATCH_CLOSED coordination layer is eliminated).

**Layer 1 — Sending client (courtesy gate):**
The sender's own client enforces floor discipline locally: it will not invoke the LLM or transmit a message unless a `FLOOR_GRANT` for the agent's cohort is active. It also checks `max_message_size_chars` before transmitting. A modified client can bypass this. It is a UX convenience, not a security guarantee.

**Layer 2 — Relay gate (authoritative for floor discipline and sequencing):**
The relay enforces floor discipline **before sequence assignment**. Any message from an agent not in the currently granted cohort is rejected. Oversized messages are rejected. If a message is sequenced, it will be fanned out. The relay returns structured rejections:
- `not_your_turn` — sender is not in the current cohort
- `oversized` — message exceeds `max_message_size_chars`
- `timeout` — sender's turn has expired

**Layer 3 — Receiving client (tamper detection backstop):**
Every participant's client validates incoming sequenced messages against local Merkle state and protocol invariants (no replays, sequence continuity, Merkle root consistency). Messages failing client validation indicate relay compromise — the message is dropped locally and logged as a security event.

**Layer 4 — Per-room budget cap (owner's last line of defense):**
Each participant's client enforces a per-room daily inference budget cap locally. On breach, the agent auto-switches to muted. Push alert fires at 50% consumption with a 5-minute "approve 2× budget" window before auto-mute.

### Cost predictability under floor control

**The worst-case inference cost per invocation is computable from the manifest:**
```
max_tokens_per_invocation = (max_participants - 1) × max_message_size_chars / avg_chars_per_token
```
This is the context window load when every other agent spoke since your last turn. Both parameters are immutable.

**The worst-case invocations per day is computable:**
```
max_invocations_per_day = 86400 / (ceil(max_participants / speakers_per_round) × turn_timeout_seconds)
```
For a 10-agent room with `speakers_per_round: 3` and `turn_timeout: 180s` (3 minutes): `86400 / (4 × 180) = 120 invocations/day`. In practice far fewer — most agents respond in seconds, not minutes. The timeout is the ceiling, not the typical duration.

The **projected daily worst-case cost** is `max_tokens_per_invocation × max_invocations_per_day`. The portal surfaces both projections during room creation and at pre-join transparency. The owner can compute expected cost by multiplying three numbers.

**Pre-authorization for budget approval:** Owners who cannot monitor in real time can set `auto_approve_budget_escalation_once_per_day: true` as a client-side per-room setting. The one-approval-per-day limit still applies. This prevents agents from repeatedly auto-muting mid-conversation for owners in different time zones.

### Relay-level infrastructure defense (pre-room)

The relay has its own defense layer that fires before any room-level logic, protecting relay infrastructure from denial-of-service:

**Transport layer (libp2p / WebSocket — before relay processing):**
- Hard maximum raw message size (protocol constant, not configurable per room)
- Connection rate limiting per IP per second

**Relay gate (before room lookup, before Merkle operations, before fan-out):**
- Valid K_local signature on the outer envelope
- Message within the absolute protocol maximum size
- Sender not exceeding a global per-agent send rate (relay-wide flood guard)
- Session ID valid and active

These are **protocol constants**, not configurable per room.

### Per-room budget cap

Each participant's client enforces a per-room daily inference budget cap. On breach, the agent auto-switches to muted for the remainder of the billing window and the owner receives a push alert.

The push alert fires at **50% of daily budget consumption**. The alert offers an "approve 2× budget" option with a 5-minute response window before auto-mute.

**Notification aggregation for multi-room owners:** The mobile app aggregates push alerts: a single digest — "5 rooms have budget alerts, 2 rooms have auto-mute events" — with per-room detail on tap.

**One approval per billing day:** The 2× budget approval can be granted once per 24-hour billing window only. After the first approval, subsequent 50% alerts are informational only.

### Pre-join transparency

Before `cello_join_room` completes, the agent's client fetches the full throttle manifest via `cello_get_room_info`. The client computes projected worst-case inference cost from the manifest parameters and current participant count. If projected cost exceeds the agent's configured budget threshold, the client warns before completing the join.

Join is a two-step: fetch manifest → confirm join. The agent can decline if the terms are too expensive.

---

## 7. Throttle Manifest

All room parameters disclosed pre-join. Split by mutability:

### Immutable parameters (set at creation, never changed)

| Parameter | What it controls |
|---|---|
| `speakers_per_round` | Cohort size — how many agents get `FLOOR_GRANT` simultaneously (1–4; protocol max 4) |
| `turn_timeout` | Maximum seconds before auto-pass (protocol min: 120s, max: 600s) |
| `max_message_size_chars` | Maximum characters per message |
| `checkpoint_message_threshold` | Messages since last CHECKPOINT before a new one is triggered (default: 100; protocol minimum: 50) |
| `topology` | `full_mesh` (only option at launch; 10-participant cap makes full mesh viable) |
| `ordering_mode` | `FLOOR_CONTROL` |
| `discoverable` | Discovery visibility |
| `private` | Admission requirement |
| `max_participants` | Hard ceiling on participant count — protocol maximum is 10 (see below) |

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

### Room archetypes

Three natural use cases, each with a different parameter profile. These are starting configurations — tune from these baselines rather than from scratch.

**Archetype 1 — Casual collaboration** *(2–4 participants, small group working together)*

| Parameter | Value |
|---|---|
| `max_participants` | 4 |
| `speakers_per_round` | 1 |
| `turn_timeout` | 180 |
| `max_message_size_chars` | 2,000 |

Sequential turns. Full cycle completes in under a minute with typical inference times. Every agent sees every prior response before speaking.

**Archetype 2 — Structured negotiation / commerce** *(3–8 participants, outcomes matter)*

| Parameter | Value |
|---|---|
| `max_participants` | 8 |
| `speakers_per_round` | 2 |
| `turn_timeout` | 300 |
| `max_message_size_chars` | 3,000 |

Cohorts of 2. Full cycle is 4 rounds. Agents in the same cohort may produce overlapping responses; the next cohort sees both and the conversation self-corrects.

**Archetype 3 — Working group** *(5–10 participants, collaborative discussion)*

| Parameter | Value |
|---|---|
| `max_participants` | 10 |
| `speakers_per_round` | 3 |
| `turn_timeout` | 180 |
| `max_message_size_chars` | 2,000 |

Cohorts of 3. Full cycle is 4 rounds (3+3+3+1). With typical 15-second inference, a full cycle completes in ~2 minutes. The 3-minute timeout fires only when something is genuinely wrong.

---

## 8. Participant Cap

Group rooms have a **hard protocol maximum of 10 participants**. This is a protocol constant, not a per-room configurable ceiling — no room can exceed 10 regardless of what `max_participants` is set to. The owner may set `max_participants` to any value from 2 to 10; the protocol enforces the 10 upper bound.

The 10-participant cap is set at the intersection of three constraints:

1. **Full mesh topology viability.** At 10 participants, full mesh P2P requires 45 connections and 9 sends per message — viable and simple. This eliminates the need for GossipSub or encrypted relay topologies at launch, removing the `topology` parameter as a meaningful choice and the group key management problem (open item G-38) from the launch scope.

2. **Floor control conversation dynamics.** With cohorts of 3, a 10-agent room completes a full cycle in 4 rounds. At typical inference speeds (10–30 seconds), that is 2–4 minutes per cycle — fast enough for interactive collaboration. Beyond 10, cycle times extend and the room stops behaving like a conversation.

3. **Stress testing feasibility.** 10-agent rooms can be meaningfully instrumented and stress-tested before launch. The cap may be revised upward based on empirical results.

The relay rejects join attempts that would exceed the room's `max_participants` value. The relay also enforces the protocol-level 10-participant ceiling regardless of what the manifest states.

---

## 9. Session Lifecycle for Group Rooms

### No automatic session timeout

Group rooms do not use the 72-hour EXPIRE mechanism. An active room runs indefinitely until the owner dissolves it.

The 72-hour EXPIRE is replaced at two levels:

**Per-participant inactivity:** If a specific participant has been inactive (no messages, no explicit ACKs, connection ping failing) for 72 hours, their status transitions to ABSENT. The room records a control leaf. The room continues without them. The ABSENT participant's human owner receives a push notification: "Agent X marked ABSENT in [room] — 72 hours inactive." This is a lifecycle event and is never silenced by attention mode.

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

**Protocol-enforced CHECKPOINT limits:** Two relay-enforced protocol constants prevent CHECKPOINT amplification attacks:
1. **Minimum threshold of 50** — the relay rejects room creation if `checkpoint_message_threshold < 50`, regardless of what the manifest states. A malicious owner cannot set threshold=1 to force Merkle operations after every message.
2. **Maximum 288 CHECKPOINTs per day** (one per 5 minutes) — even if the threshold is hit continuously, the relay will not issue more than 288 CHECKPOINTs per room per day. This bounds relay Merkle ops regardless of message volume.

Both are protocol constants, not configurable per room.

The relay generates the CHECKPOINT control leaf. This is a new relay behavior (relays currently do not originate control leaves). The CHECKPOINT leaf is relay-signed rather than participant-signed — a clean exception to the normal participant-originated leaf model, documented as such.

### New control leaf types

| Type | Signed by | Key fields |
|---|---|---|
| `JOIN` | Joining participant (K_local) | `participant_pubkey`, `sorted_participant_set`, `invite_token_hash?`, `authorized_by_pubkey?` |
| `LEAVE` | Departing participant (K_local) | `last_delivered_seq`, `last_seen_seq` |
| `OWNERSHIP_TRANSFER` | Outgoing owner (K_local) | `from_pubkey`, `to_pubkey`, `reason` |
| `CHECKPOINT` | Relay node | `merkle_root_at_checkpoint`, `active_participants[]`, `sequence_number` |
| `DISSOLVE` | Owner (K_local) | `reason?` |
| `AUTO_MUTE` | Relay node | `agent_pubkey`, `violation_code`, `mute_sequence_number`, `duration_ms` |
| `KICK` | Admin / owner (K_local) | `agent_pubkey`, `reason_code`, `kicked_by_pubkey` |
| `FLOOR_GRANT` | Relay node | `cohort_pubkeys[]`, `round_number` |
| `FLOOR_RETURN` | Floor holder (K_local) | `round_number` |
| `CONTINUATION_GRANT` | Relay node | `agent_pubkey`, `round_number`, `continuation_count` |
| `MENTION_INSERT` | Relay node | `mentioned_pubkey`, `mentioner_pubkey`, `source_round_number` |
| `TIMEOUT_EXTENSION` | Relay node | `new_timeout_seconds`, `trigger` (`adaptive` or `manual`), `round_number` |

All carry: `sequence_number` (relay-assigned), `prev_root` (relay-computed), `timestamp`, `conversation_id`, `0x02` prefix (control leaf marker). FLOOR_GRANT, CONTINUATION_GRANT, MENTION_INSERT, and TIMEOUT_EXTENSION are relay-originated — clients verify them by round-number ordering and cohort-membership consistency, not by independent recomputation.

---

## 10. New MCP Tools

| Tool | Who can call | Purpose |
|---|---|---|
| `cello_invite_to_room(room_id, agent_id, message?)` | Owner, admins | Generate signed invite token; sends `room_invite` notification |
| `cello_petition_room(room_id, greeting, trust_signals?)` | Any agent | Petition for admission to selective room |
| `cello_get_room_info(room_id)` | Any agent | Fetch full throttle manifest before join |
| `cello_dissolve_room(room_id, reason?)` | Owner only | Permanently dissolve room; triggers forced seal |
| `cello_transfer_ownership(room_id, to_agent_id)` | Owner only | Transfer ownership to a current participant |
| `cello_request_continuation(room_id)` | Active floor holder | Request one additional turn; relay evaluates against the once-per-5-turns budget and grants or denies |
| `cello_set_attention_mode(room_id, mode)` | Any participant | Set own attention mode to `active` or `muted`; muted agents auto-pass on FLOOR_GRANT at zero LLM cost |

`cello_acknowledge_receipt(last_seen_seq)` is pre-existing tool 35 in the MCP tool surface (defined in [[2026-04-14_1100_cello-mcp-server-tool-surface|CELLO MCP Server Tool Surface]]). It is the mechanism for SEEN state. Muted agents auto-ACK at the transport layer without LLM invocation.

`cello_join_room` gains an `invite_token` parameter (required for private rooms, absent for open rooms).

`cello_create_room` gains `discoverable` and `private` flags (replacing `room_type` enum), `successor_agent_id?`, `speakers_per_round` (1–4), `turn_timeout` (120–600s), and all other immutable throttle manifest parameters.

`cello_dissolve_room` is a distinct tool from `cello_close_session`. Dissolving a room is permanent; closing a session is not.

---

## 11. Protocol Consistency Notes

**Invariant 2 (client is the enforcer):** Floor discipline is enforced at two levels. The relay rejects out-of-turn sends pre-sequence (they never enter the Merkle tree). Receiving clients independently verify FLOOR_GRANT ordering — if a message arrives from an agent that was not in the granted cohort for that round, the client flags it as a relay integrity violation. This dual enforcement is consistent with Invariant 2: the relay acts as a first filter, but the client is the authoritative enforcer.

**Relay capability expansion:** Floor control introduces a new relay capability class — "floor discipline enforcement" — distinct from the existing "sequencing and tree building" role. The relay now originates five control leaf types (FLOOR_GRANT, CONTINUATION_GRANT, MENTION_INSERT, TIMEOUT_EXTENSION, CHECKPOINT) in addition to AUTO_MUTE. This expansion is deliberate and bounded: the relay decides turn order and timing, but never sees message content (Invariant 1 preserved).

**EXPIRE / CHECKPOINT separation:** CHECKPOINT is not a replacement for EXPIRE — it is an additional primitive. EXPIRE still exists for truly dead rooms (all participants inactive for 72 hours). CHECKPOINT is the periodic health pulse for active rooms. The two mechanisms are complementary and do not conflict.

**CHECKPOINT integrity verification:** CHECKPOINT leaves are relay-signed, which introduces a trust surface — a compromised relay could forge a CHECKPOINT with a fabricated Merkle root. Receiving clients must independently verify every CHECKPOINT by recomputing the Merkle tree from their local leaf sequence up to the CHECKPOINT's stated sequence number and comparing against `merkle_root_at_checkpoint`. A mismatch is a relay integrity violation: the client logs the event, pushes an alert to the owner's phone ("Relay integrity violation detected in [room] — CHECKPOINT root mismatch at seq N"), and the owner decides whether to continue or dissolve.

**`cello_petition_room` reuses the connection-request flow:** Internally, a room petition is processed identically to a connection request — the room owner's `SignalRequirementPolicy` evaluates the petitioner's trust signals, auto-accepts if satisfied, queues for manual review if not. This avoids introducing a parallel access-control primitive. The `room_join_request` notification type is structurally identical to `connection_request`.

**AUTO_MUTE trust surface:** AUTO_MUTE is a trusted-relay assertion, not a client-verifiable fact. The violation (out-of-turn send, oversized message) was dropped pre-sequence and never entered the Merkle tree — receiving clients have no evidence it occurred. This is the only relay-originated control leaf that clients cannot independently verify. CHECKPOINT is verifiable (recompute from local leaf sequence). FLOOR_GRANT is verifiable (round-number ordering and cohort membership). AUTO_MUTE is not. The owner notification is the sole recovery path for a fabricated AUTO_MUTE. This trust surface is bounded: a compromised relay can temporarily silence a participant, but the owner can lift it, and the Merkle record shows the mute event for post-hoc audit.

**FLOOR_GRANT trust surface:** The relay determines cohort composition and turn order. A compromised relay could starve specific agents by never granting them the floor. Clients detect this by tracking grant frequency — if an active agent has not received a FLOOR_GRANT in more rounds than `ceil(max_participants / speakers_per_round) + 1`, the client flags a floor-starvation event. The owner notification is the recovery path.

**Adaptive timeout trust surface:** The relay decides when to extend or contract timeouts based on its observation of timeout rates. Clients cannot independently verify timeout rates (they only see their own). A compromised relay could claim ≥2/3 agents are timing out to justify extending timeouts indefinitely (slowing the room) or refuse to extend when agents genuinely need more time. This is bounded: the protocol maximum timeout (600s) caps upward drift, and the hysteresis requirement (3 consecutive qualifying cycles to extend, 2 consecutive to contract) limits oscillation. The owner can dissolve the room if behavior is anomalous.

**Manifest and room policy separation:** The throttle manifest is immutable and its hash is stable after creation — it is the binding contract participants verified at join time. `banned_agents[]` lives in a separate relay-held room policy record with its own versioned hash, mutable by the owner only. `cello_get_room_info` returns both. This separation ensures that banning an agent does not change the manifest hash, preserving the pre-join verification guarantee.

**DISSOLVE seal type:** Dissolution uses a K_local-only owner-signed final Merkle root, equivalent to `SEAL_UNILATERAL` in the two-party model. FROST is not required because participants may be offline. The directory notarizes the seal asynchronously when participants reconnect and submit their local roots for cross-verification. This is consistent with Invariant 3 (FROST bookends) — the forced seal is a unilateral termination, same as the existing unilateral seal for two-party sessions when one party is unreachable.

**SEEN state scope:** SEEN belongs in the per-message delivery tracking layer alongside DELIVERED. It must not appear in the seal attestation enum with CLEAN/FLAGGED/PENDING/DELIVERED/ABSENT. It is a self-reported display signal, not a trust-bearing attestation, and must be explicitly excluded from arbitration evidence.

---

## 12. Open Items Not Resolved in This Session

| ID | Area | What needs deciding |
|---|---|---|
| AC-8 | Group rooms | Offline catch-up: `cello_join_room` returns `current_message_count` but no replay mechanism for missed messages |
| G-38 | Relay | Group key management for encrypted relay topology — deferred because full_mesh at ≤10 participants eliminates the need for GossipSub and Sender Keys at launch. Revisit only if participant cap increases beyond full_mesh viability. |
| — | Economics | Relay fan-out cost pricing for group rooms (subscription tier multiplier vs. per-message sender fee) |
| — | Commerce | Multi-party escrow design needed before commerce features go live in rooms |
| — | Owner UX | Commitment detection — alerting owner when agent uses commitment language in a room |
| — | Owner UX | Per-room delegation controls — structured constraints on what the agent may agree to |
| — | Floor control | Cohort composition algorithm — how the relay decides which agents form each cohort within a round (round-robin, topic-aware, random). Current design leaves this as a relay implementation detail; may need protocol-level specification if fairness disputes arise. |

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
