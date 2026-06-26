---
name: m8-journey-agents
type: journey
date: 2026-06-25
topics: [m8, portal, agents, presence, sessions, directory, federation, liveness, daemon-channel, not-me, suspend-burn, t-of-n, dashboard, landing-home]
status: draft
description: >
  Second M8 portal journey — the Agents section, which is also the M8 landing home.
  Where an operator sees their agents and each agent's online/last-seen status, and
  triggers the emergency suspend/burn lever. Resolves the data-availability questions
  (what the directory DB holds, how online presence is persisted), folds the Dashboard
  into the Agents home (the standalone operational Dashboard is deferred), and scopes
  the per-agent detail page and transcript to a future portal→daemon channel. Single-
  focus working doc; folds into the M8 outline + user stories later.
---

# M8 Journey — Agents

One of several single-focus journey docs for the M8 operator portal. Captures the
2026-06-25 working session on the **Agents** section: what it shows, where the data
comes from, and the line between what's buildable for launch and what's deferred.
Working spec, not a final user story.

## What the operator wants (the journey)

- **Agents section = where you see your agents.** Each agent shows whether the
  directory considers it online (last-seen) and carries the emergency suspend/burn lever.
- **The per-agent detail page is DEFERRED in full (D9).** Launch is the Agents **list**
  only. A per-agent page — its sessions, who each session is with, counterparty detail,
  and the evolving transcript — needs the portal→daemon channel and does not ship in M8.
- **The only agent-control action is the emergency suspend/"Not Me" lever (D10)** — a
  three-position pause / retire / burn, account-authorized, enforced server-side by the
  T-of-N node federation. There is no register / start / stop / set-current in the portal
  — agents *appear* after the local ceremony; the daemon owns process lifecycle.
  (See [[project-portal-model]], [[project_threshold_t_of_n_not_2_of_2]].)
- **The Agents view is also the M8 landing/home page (D11).** At M8 a separate Dashboard
  would be virtually identical to the agent list, so there is no standalone Dashboard — the
  Agents home carries a thin alerts + posture header, and the operational Dashboard is
  deferred to the daemon-channel milestone.

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

> Note: most of these directory facts (connection graph, sessions) are only *displayed* on
> the deferred per-agent page (D9). The Agents **list** at launch needs only identity
> (fingerprint) + presence (below) + the lever (D10).

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
See your agents and their last-seen status; trigger the emergency suspend/burn lever (D10).
No register / start / stop / set-current. The per-agent detail page is deferred in full (D9).

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
it. Do not invent names. (Applies to the per-agent page, D9 — itself deferred.)

**D8 — Transcript + counterparty enrichment are deferred to a portal→daemon channel.**
Showing live transcript or rich counterparty detail requires streaming directly from the
operator's local daemon to the frontend, never persisting in any intermediary. This is a
new daemon capability and a significant lift — **out of scope for launch.** It is the
*same* deferred capability for both transcript and the (optional, fresher) real-time
presence alternative, which keeps the deferral tidy.

**D9 — The per-agent detail page is deferred in full.**
Launch ships the Agents **list** only (identity by fingerprint, last-seen status, the
suspend/burn lever per row). Clicking into an agent — its connection graph, in-flight and
sealed sessions, who each session is with, counterparty detail, and the live transcript —
is **deferred until the portal→daemon channel exists.** This supersedes the earlier framing
(per-agent page shows directory-readable facts at launch): the operator wants the page to be
*about the live agent*, and the live substance only arrives over the daemon channel. Rather
than ship a thin directory-only page now and a rich one later, the whole page waits for the
channel.

**D10 — The emergency suspend/burn lever (the "Not Me" control).**
- **Lives on the Agents list**, per row (since the per-agent page is deferred). It is the
  *only* agent-control action in the portal.
- **Three positions** (from the identity-lifecycle thread,
  `discussion_logs/2026-06-25_2109_agent-identity-lifecycle-discovery.md` §5):
  - **Pause** — reversible freeze; the node federation withholds co-signing. Share intact.
  - **Retire** — orderly drain of in-flight sessions, then destroy share + tombstone
    (`reason=voluntary`).
  - **Burn** — instant destroy share + tombstone (`reason=compromise`). The emergency kill.
- **Mechanism is T-of-N, NOT 2-of-2.** The current code's 2-of-2 (client + one *mandatory*
  node) is a **known stopgap bug, not the design** ([[project_threshold_t_of_n_not_2_of_2]]).
  Do **not** ground the lever on "one node withholds." Correct mechanism: an
  **account-authorized, replicated revocation flag** (suspended fact / tombstone) that
  **every sovereign node independently honors** by refusing to contribute its share — since
  a signature needs a *threshold* of nodes and the honest ones all refuse, no threshold
  forms and signing is blocked. **Burn** additionally destroys the server-side share
  material across the federation.
- **Works even when the operator's device is the compromise** — the block is server-side
  across the federation, independent of the client share. A thief holding the laptop and the
  client share still cannot sign.
- **Capability dies, accountability survives** — burn kills *future* signing, never *past*
  accountability: counterparties hold the sealed records, the directory keeps the identity
  binding resolvable, and the burn is itself a signed, timestamped event.
- **Account-authorized, step-up gated** — triggered via portal strong-auth (Journey 01), not
  by the agent's own key. Authorize (portal) → node federation executes (withhold / destroy)
  → directory records (revocation flag / tombstone). No central control plane.
- **Scope (DECIDED — all three ship in M8):** pause / retire / burn all land in M8. Under
  T-of-N even **pause** needs the replicated-flag plumbing (revocation-flag table + a check
  in the ceremony/co-signing path + replication), so it's a contained addition rather than
  free; **burn** adds coordinated share destruction across the federation. The directory
  revocation record already exists — `agent_revocations` (V32, deployed all regions; see
  `infra/STATE.md`) — so the record shape is in place; the lever wires the portal trigger +
  the ceremony-path honor check on top.

**D11 — The Agents home is the M8 landing page; the standalone Dashboard is deferred.**
At M8 a separate "Dashboard" and the Agents list would be virtually identical — the only
thing that would distinguish a dashboard (live session event feed, active-connection /
retry / interrupted metrics, daemon/signaling status cards) is exactly the **deferred
daemon-channel telemetry**. So there is **no separate Dashboard screen at M8**:
- **The landing page after login *is* the Agents home** — the agent list with presence +
  the lever — plus a thin header for **identity/security alerts** (directory / ops-agent
  sourced; honest empty state) and **account posture** (strong-auth status, trust-signal
  coverage). This satisfies the roadmap's "operator dashboard / agent health and status."
- **The real operational Dashboard** (live event feed, metrics, daemon status) is **deferred
  to the milestone that brings the portal→daemon channel** — where a dashboard finally shows
  something a list doesn't. The old dashboard screenshot was a *daemon-console* dashboard:
  the daemon / directory-signaling / standing-receiver cards, retry-queue / interrupted-
  session metrics, and the live session feed are all `cello_status` (local-daemon) state a
  hosted portal cannot see without that channel.
- The distinct bits absorb cleanly: **alerts** → a strip atop the Agents home; **posture** →
  Account & Security (strong-auth) + the Trust Signals section (coverage).

## Launch scope vs. deferred

**Launch (the Agents home — directory-readable + new presence table):**
- The **Agents home** is the M8 landing page (D11): the agent **list** — each agent with
  identity (fingerprint), **online / last-seen** status, and the per-row **suspend/burn
  lever** (D10) — plus a thin header for **identity/security alerts** and **account posture**.
- That's the whole Agents UI at launch. No per-agent detail page, no separate Dashboard.

**Deferred (needs the portal→daemon channel):**
- The **entire per-agent detail page** (D9): connection graph, in-flight + sealed sessions,
  who each session is with.
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
- **Suspend/burn lever (D10):** a replicated **revocation-flag / tombstone** record, a
  check in the ceremony path so every node honors it, account-authorized trigger from the
  portal (step-up), and — for burn — coordinated server-side share destruction. T-of-N, not
  2-of-2. (Scope split M8 vs M15 being settled with the identity-lifecycle thread.)

## Rejected / not doing

- **Register / create / start / stop / set-current an agent in the portal.** Agents appear
  after the local ceremony; the daemon owns lifecycle. Only the emergency lever exists.
- **A per-agent detail page at launch** (even a thin directory-only one). Deferred in full
  (D9) — it waits for the daemon channel rather than shipping thin-then-rich.
- **Grounding the suspend/burn lever on "one mandatory node."** Rejected — that's the 2-of-2
  stopgap bug, not the design. Use the replicated revocation flag honored by the T-of-N
  federation ([[project_threshold_t_of_n_not_2_of_2]]).
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

- Per-agent page **UI** — deferred in full (D9); to be designed when the portal→daemon
  channel is built. Not an M8 concern.
- **Suspend/burn lever:** scope DECIDED — all three (pause / retire / burn) ship M8 (D10).
  Remaining: the exact revocation-record fields (`agent_revocations` V32 exists) and the
  ceremony-path honor check — coordinate with the identity-lifecycle thread.
- The masked-phone display seen on the old Account screen (`+1 ••• ••• 4417`) can't come
  from the directory (it stores only `phone_stub_hash`). Reconcile in the account journey.
- Exact freshness windows (per-node heartbeat cadence, "last seen" thresholds for the dot).
