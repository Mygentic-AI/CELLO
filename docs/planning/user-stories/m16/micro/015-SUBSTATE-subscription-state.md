---
name: 015-SUBSTATE — Subscription state (not contacts)
type: micro-work-order
date: 2026-09-02
status: draft
source: DOD-M16-SUBSTATE-1
depends_on: [013-GROUPKEY]
description: >
  DRAFT — see the planner pre-issue checklist. The subscriber-side store: one row per (agent,
  channel) keyed on agent_id + channel pubkey, holding the unwrapped group keys by generation,
  guidance, TTL, a local moniker, and the two read positions delivered_through /
  processed_through (Tier 3 advances them). Not a contact; listed by cello_channels, never by
  cello_contacts. Carries the IDENTITY-1 clause deferred here: a subscriber refuses inbound
  sessions from any pubkey it holds as a channel.
---

# **<ins>MICRO</ins>** WORK ORDER 015-SUBSTATE — Subscription state (DRAFT)

> ## ⚠️ PLANNER PRE-ISSUE CHECKLIST
> - [ ] Confirm the `agent_id` accessor the daemon uses for the acting agent (the
>       `agent-id-migration.ts` rekeyed tables — copy the exact column + lookup) so this table
>       is keyed correctly from day one.
> - [ ] Confirm how `contact_signal_prefs` / moniker rows validate a moniker (reuse
>       `core/protocol-types/src/moniker.ts` validation).
> - [ ] Name the exact slot in `inbound-sessions.ts` (same slot 006 used) for the
>       subscribed-channel refusal, and add the `REFUSAL_REASONS` member
>       `SESSION_FROM_SUBSCRIBED_CHANNEL` + guidance.
> - [ ] Enumerate tests to exact assertions.

> ## THE RULES OF A MICRO WORK ORDER
> 1. Read [[M16-PROCEDURE]] IN FULL first; arm the watchdog cron; do not read the DoD, the
>    journal, or any design log. 2. One mission, never grown. 3. *Newly discovered* at the
>    foot. 4. 500 lines hard cap. 5. Tests first → implement → review (`cello-unit-reviewer`)
>    → fix every finding → commit per fix, push per commit; `status:` flips in the verdict
>    commit. 6. Done is done.

---

## The problem, plainly
A subscription is not a contact: a channel cannot hold a session, so contact tiers mean
nothing for it, and mixing channels into `cello_contacts` would mislead every tool that reads
contacts. It needs its own row: which agent subscribed, to which channel, with which keys,
under what guidance, and how far it has read. **Repo: `cello-client`, `core/daemon`.**

## The work — `core/daemon/src/subscription-store.ts`
```sql
CREATE TABLE IF NOT EXISTS channel_subscriptions (
  agent_id           TEXT NOT NULL,        -- the SUBSCRIBING local agent (stable key, never agent_name)
  channel_pubkey     TEXT NOT NULL,
  admin_pubkey       TEXT NOT NULL,
  access             TEXT NOT NULL,
  guidance           TEXT NOT NULL,
  ttl_seconds        INTEGER NOT NULL,
  moniker            TEXT,                 -- local nickname; validated by the moniker rules
  delivered_through  INTEGER NOT NULL DEFAULT 0,   -- advanced by the fetch (Tier 3)
  processed_through  INTEGER NOT NULL DEFAULT 0,   -- advanced only by the agent's read (Tier 3)
  joined_at          INTEGER NOT NULL,
  status             TEXT NOT NULL,        -- "active" | "left" | "ejected"
  PRIMARY KEY (agent_id, channel_pubkey)
);
CREATE TABLE IF NOT EXISTS channel_subscription_keys (
  agent_id TEXT NOT NULL, channel_pubkey TEXT NOT NULL, generation INTEGER NOT NULL,
  key BLOB NOT NULL, received_at INTEGER NOT NULL,
  PRIMARY KEY (agent_id, channel_pubkey, generation)
);
```
Class `SubscriptionStore`: `upsert(row)`, `addKey(agentId, ch, gk)`, `keysFor(agentId, ch):
GroupKey[]` (all generations, newest first), `get`, `list(agentId)`, `setMoniker`,
`advanceDelivered(agentId, ch, seq)` / `advanceProcessed(...)` (monotonic — a lower value
throws `position_regression`), `isSubscribedChannel(agentId, pubkeyHex)`, `markLeft`,
`markEjected`. Keys are stored in the SQLCipher DB (encrypted at rest like everything else);
never logged.

**IPC:** `cello_channels { agent }` lists subscriptions (moniker, channel pubkey, access,
positions, unread = delivered − processed); `cello_channel_set_moniker`. **Not** in
`cello_contacts` — add a test that `cello_contacts` output for an agent with subscriptions
contains no channel pubkeys.

**The deferred IDENTITY-1 clause:** in `inbound-sessions.ts`, at the slot 006 used, if
`isSubscribedChannel(localAgentId, parsed.participantAPubkeyHex)` → `refuseInboundSession`
with `REFUSAL_REASONS.SESSION_FROM_SUBSCRIBED_CHANNEL` (+ total-map guidance: "This sender is
a channel you subscribe to; channels do not open sessions. Treat this as suspicious.").

## ⚠️ WHAT MUST NOT CHANGE
- **Keyed on `agent_id`, never `agent_name`.** This is the first M16 subscriber table; it sets
  the precedent.
- **Two positions, never one.** A fetch never touches `processed_through`; an agent read
  never touches `delivered_through`. Regression throws.
- **Not a contact.** No row in `contacts`, no tier, no appearance in `cello_contacts`.
- **Keys never logged; old generations never deleted** (old content stays readable).

## Tests (properties fixed; enumerate at issue)
upsert/get round trip; keys by generation newest-first; position monotonicity both ways
(regression throws); `cello_channels` lists + unread arithmetic; `cello_contacts` excludes
channels; moniker validation reuses the moniker rules; subscribed-channel inbound refusal
fires only for subscribed pubkeys (neighbor: an unsubscribed stranger is handled by the normal
gates); `agent_name` change does not orphan the row.

## Enforcer
Real daemon via spawn-real-daemon: seed a subscription; over IPC `cello_channels` shows it and
`cello_contacts` does not; rename the agent; `cello_channels` still shows it.

## Not in scope
Fetching/delivery (Tier 3 advances the positions); join/eject flows (012/014 call this
store); MCP tools beyond the two IPC verbs (Tier 5).

## Newly discovered
*(five lines max each; keep going)*
