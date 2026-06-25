---
name: m8-journey-agents
type: journey
date: 2026-06-25
topics: [m8, portal, agents, presence, sessions, directory, federation, liveness, daemon-channel]
status: draft
description: >
  Second M8 portal journey — the Agents section. Where an operator sees their
  agents, each agent's online/last-seen status, and its sessions (who it's
  connected to / talking with). Resolves the hard data-availability questions:
  what the directory DB holds, how online presence is persisted, and what is
  deferred to a future portal→daemon channel. Single-focus working doc; folds
  into the M8 outline + user stories later.
---

# M8 Journey — Agents

One of several single-focus journey docs for the M8 operator portal. Captures the
2026-06-25 working session on the **Agents** section: what it shows, where the data
comes from, and the line between what's buildable for launch and what's deferred.
Working spec, not a final user story.

## What the operator wants (the journey)

- **Agents section = where you see your agents.** Each agent shows whether the
  directory considers it online.
- **Click an agent → a dedicated per-agent page.** Everything about that one agent.
- On that page: **its sessions, and who each session is with.**
- **Later:** click into **information about the counterparties** it's talking to, and
  view the **evolving transcript** of a live session.
- **The only agent-control action is the emergency "Not Me" shutdown** of a compromised
  agent (carried in the dedicated security journey; referenced, not defined here). There
  is no register / start / stop / set-current in the portal — agents *appear* after the
  local ceremony; the daemon owns process lifecycle. (See [[project-portal-model]].)

## The hard invariant being guarded

The directory stores **almost nothing about a session's substance**. It is a
**notarization + federation layer, not a message store**. No transcript, no message
bodies, no counterparty profile — counterparties are only ever a **pubkey/fingerprint**.
Any future feature that shows transcript or rich session detail must stream it
**directly from the operator's local daemon to the frontend, never resting in any
intermediary**. That is the "no message content, ever, in any intermediary" rule applied
to transport, not just storage.

## What the directory actually holds per agent (verified against the schema)

Keyed on the agent's identity pubkey (`k_local_pubkey`):

- **Static identity** (`agent_profiles`, V9/V23/V27): three public keys (Ed25519 identity,
  FROST group key, ML-DSA), `phone_stub_hash`, `registered_at`, `status`, `account_id`,
  `agent_id`. **No display name, no bio, no avatar** — crypto identity + admin metadata only.
- **Connection graph** (`connections`, V15): **who it's connected to, by pubkey** —
  `participant_a` / `participant_b`, `established_at`, `status`.
- **In-flight sessions** (`sessions`, V18/V29): `session_id`, `owning_node_id`,
  `initiator_pubkey_hex` / `target_pubkey_hex`. An unsealed session here is effectively
  "open."
- **Sealed/closed session history** (`conversation_seals` + `seal_notarizations`, V2/V12/V31):
  `merkle_root` (a **hash, never content**), `close_type`, `seal_date`, participant
  pubkeys, FROST notarization signature, attestations.
- **Connection-request outcomes** (`connection_requests`): accepted/rejected/expired, by
  pseudonym.

## Federation: replicated reads, sovereign writes, per-node memory

- **DB records are replicated across the federation** (logical replication;
  `checkpoint-coordinator`, `verifyReplicatedRow` → `federation.replication.verified`).
  Given replication time, **every node's DB eventually holds every record**, so the
  portal can read account/agent/session data from **any** node — not coupled to one.
- **Write-ownership stays sovereign** — only the owning node may extend a given session's
  hash chain (`sessions.owning_node_id`, V18). Nodes share data but cannot forge each
  other's. Replication is read-redundancy, not a violation of sovereignty.
- **Carve-out:** `channel_identities` (Telegram IDs) is **not** replicated and the
  directory never sees it (`V30`; ops-agent role only).
- **Online presence is the one fact that is per-node, in-memory, and never persisted.**
  The directory tracks live connections in `#streams: Map<pubkeyHex → stream>`
  (`directory-node.ts:457`), added post-auth, removed on stream close, kept fresh by a
  15s ping/pong heartbeat. It is **private, has no query API, and is not replicated.**
  This is the gap the presence design below closes.

## Two distinct "online" concepts — do not conflate

1. **"Is my daemon's link to the directory healthy?"** — the daemon's view of its *own*
   connection (`directory_signaling: connected | reconnecting | lost` in `cello_status`).
   Meaningful for a local console; **not meaningful for a hosted portal** (the portal
   isn't the daemon).
2. **"Does the directory consider agent X reachable?"** — directory `#streams` presence.
   **This is the per-agent dot the portal wants.**

## Decisions (locked)

**D1 — The Agents section is an observe surface + the one emergency lever.**
See your agents and their status; open a per-agent page; see sessions and counterparties.
No register / start / stop / set-current. The only control is the emergency "Not Me"
shutdown (defined in the security journey).

**D2 — The portal reads replicated global DB state, from any node.**
It does not couple to a single node and does not (for launch) reach into the local daemon.

**D3 — Persist anything in-memory the portal needs; don't chase per-node memory.**
General principle. The portal reads replicated persisted state like everything else, so
any runtime fact it must show gets written to a replicated table. Presence is the only
significant in-memory-only fact today (in-flight sessions and pending requests are
already persisted: `sessions` V29, `active_connection_requests` V29).

**D4 — Online presence → a new replicated `agent_presence` table, edge-triggered.**
- The node holding an agent's live connection writes a **last-seen / online** record.
  Write-ownership is **sovereign** — a node writes presence only for agents connected to
  *it* (same pattern as `sessions.owning_node_id`). Replication makes it globally
  readable, so the portal reads it from any node.
- **Mutable upsert table, NOT append-only / hash-chained.** One row per agent, updated in
  place (like `registrations`, unlike the tamper-evident tables). High-churn, low-history.
- **Edge-triggered writes only.** Check liveness frequently in memory (the existing 15s
  heartbeat), but **write to the table only on a state transition** — connect → `online`,
  stream dead/closed → `offline`. An idle-but-connected agent generates zero writes and
  zero replication traffic. The heartbeat's add/remove on `#streams` are the transition
  points the write hooks onto.

**D5 — Node-level liveness guard against false "online" on node death.**
Edge-triggering alone leaves agents stuck `online` if a node *crashes* (the "offline"
write never fires). Fix without losing the optimization:
- **Per-agent presence stays edge-triggered** (write only on connect/disconnect).
- **Per-node**, write **one** coarse liveness heartbeat (refresh `directory_nodes.last_heartbeat_at`
  every ~30–60s) — one tiny write per node, not per agent.
- **Portal read rule:** an agent is `online` **only if** its presence row says `online`
  **AND** its owning node's heartbeat is fresh. If a node goes dark, all its agents age
  out together via that single node-level timestamp.
- **On node restart**, the node boots with empty `#streams`, reconciles its owned presence
  rows to `offline`, and re-marks `online` as agents reconnect.

**D6 — Render presence honestly.**
Because presence is persisted + replicated, freshness = transition-write + replication
lag (and the node-heartbeat window). Show **"online / last seen 2 min ago,"** never a
falsely-precise real-time dot. Real data or honest empty state — no faked liveness.

**D7 — Counterparties are fingerprints at launch.**
The directory has no names or bios, so "with whom" renders as a **pubkey/fingerprint**
until either the trust/profile layer fills it in or the deferred daemon channel enriches
it. Do not invent names.

**D8 — Transcript + counterparty enrichment are deferred to a portal→daemon channel.**
Showing live transcript or rich counterparty detail requires streaming directly from the
operator's local daemon to the frontend, never persisting in any intermediary. This is a
new daemon capability and a significant lift — **out of scope for launch.** It is the
*same* deferred capability for both transcript and the (optional, fresher) real-time
presence alternative, which keeps the deferral tidy.

## Launch scope vs. deferred

**Launch (directory-readable + new presence table):**
- Agents list: each agent with identity (fingerprint), **online / last-seen** status.
- Per-agent page: its **connection graph** (who, by fingerprint), **in-flight sessions**
  (with whom, by fingerprint), **sealed-session history** (hashes, close type, dates),
  last activity.
- Emergency "Not Me" lever (security journey).

**Deferred (needs the portal→daemon channel):**
- Live, evolving **transcript** of a session.
- **Counterparty enrichment** beyond a fingerprint.
- Real-time (sub-replication-lag) presence, if ever wanted.

## New work this journey implies

- **`agent_presence`** replicated mutable table + edge-triggered presence writer in the
  directory node (hook `#streams` add/remove).
- **`directory_nodes.last_heartbeat_at`** coarse node-liveness heartbeat + the portal's
  "online = row online AND node fresh" read rule + startup reconciliation.
- **Authenticated portal read path** to the (replicated) directory data, scoped to the
  operator's account (`account_id`).

## Rejected / not doing

- **Register / create / start / stop / set-current an agent in the portal.** Agents appear
  after the local ceremony; the daemon owns lifecycle. Only the emergency brake exists.
- **In-memory presence gossip across nodes.** Rejected — couples sovereign nodes; we
  persist instead.
- **Per-node presence routing from the portal** (query the specific node's memory).
  Rejected for launch — the portal reads replicated state, node-agnostic.
- **Level-triggered presence writes** (write every heartbeat tick). Rejected — replication
  amplification; edge-triggered only.
- **Append-only / hash-chained `agent_presence`.** Rejected — it's high-churn mutable
  state, not tamper-evident history.
- **Inventing counterparty names or a live dot we can't back.** Rejected — honest data only.

## Downstream / open items

- Per-agent page **UI** detail (layout of sessions, how a fingerprint counterparty is
  presented, what "last seen" looks like). Not yet narrated.
- Where the **"Not Me"** emergency brake lives in the IA and how it relates to this page
  — cross-reference the security journey once written; avoid duplication.
- The masked-phone display seen on the old Account screen (`+1 ••• ••• 4417`) can't come
  from the directory (it stores only `phone_stub_hash`). Reconcile in the account journey.
- Exact freshness windows (per-node heartbeat cadence, "last seen" thresholds for the dot).
