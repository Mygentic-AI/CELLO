---
name: 012-JOIN — The join step, carried over a session with the channel's admin
type: micro-work-order
date: 2026-09-02
status: draft
source: DOD-M16-JOIN-1
depends_on: [005-IDENTITY-DIRECTORY deployed, 006-NOCONVERSE]
description: >
  DRAFT — written without a recon pass; see the planner pre-issue checklist. Subscribing to
  a channel is a structured exchange inside an ORDINARY sealed one-to-one session between
  the subscriber and the channel's admin agent (the channel itself never converses). Open
  channels auto-admit; invite-only channels queue the request for the admin's approval. The
  reply delivers the group key bundle (013), the notification guidance, the TTL, and channel
  metadata. The publisher-side subscriber list is written here.
---

# **<ins>MICRO</ins>** WORK ORDER 012-JOIN — The join step (DRAFT)

> ## ⚠️ PLANNER PRE-ISSUE CHECKLIST — this order is NOT issuable until every box is ticked
> - [ ] Verify how structured (non-prose) frames travel inside a session today — the
>       document-sharing frames (`core/protocol-types/src/document-proposal.ts` and
>       `core/daemon/src/document-inbound.ts`) are the likely copy-anchor for "a typed request
>       inside a session that the daemon handles without the agent." Name the exact dispatch
>       function and how the daemon distinguishes a doc frame from a message.
> - [ ] Verify where the admin identity's daemon can auto-reply inside a session without an
>       agent turn (the document handshake auto-ack path).
> - [ ] Confirm the moniker/contact tier gate does not block a stranger's join session on an
>       OPEN channel (unknown-sender bounds in `acceptInboundAssignment`) — decide: join
>       sessions to an admin count against the normal unknown-sender bound (yes, no special
>       case; abuse handle preserved).
> - [ ] Replace every "≈" below with an exact file:function.

> ## THE RULES OF A MICRO WORK ORDER
> 1. Read [[M16-PROCEDURE]] IN FULL first; arm the watchdog cron; do not read the DoD, the
>    journal, or any design log. 2. One mission, never grown. 3. *Newly discovered* at the
>    foot, five lines, keep going. 4. 500 lines hard cap. 5. Tests first → implement → review
>    (`cello-unit-reviewer`) → fix every finding → commit per fix, push per commit; flip
>    `status:` to `complete` in the verdict commit. 6. Done is done.

---

## The problem, plainly

To receive a channel you must join it, and the join step is where three settled things land:
the group key (so the relay never reads bodies), the channel's notification guidance (a
reputation-bearing promise), and the TTL (so the daemon can size its poll). There is no
transport for any of that. **Decision: reuse sessions.** The channel never converses, but its
ADMIN is an ordinary agent — a subscriber opens a normal session with the admin, and the
join is a typed exchange inside it, handled by the admin's DAEMON (auto-admit for open
channels) or surfaced to the admin AGENT for approval (invite-only). No new transport, no
relay frames, and the whole thing is sealed like any session.

**Repos: `cello-client` (`core/protocol-types` frames, `core/daemon` handling).**

---

## The work

### 1. Frames — new `core/protocol-types/src/channel-join.ts`
```ts
export interface ChannelJoinRequest  { type: "channel_join_request"; channel_pubkey: Uint8Array; subscriber_pubkey: Uint8Array; note: string /* ≤200 chars, validated like a title */ }
export interface ChannelJoinAccepted { type: "channel_join_accepted"; channel_pubkey: Uint8Array; key_bundle: Uint8Array /* 013 */; guidance: string /* ≤2000 chars */; ttl_seconds: number; access: "open" | "invite_only"; members_visible: boolean }
export interface ChannelJoinRefused  { type: "channel_join_refused"; channel_pubkey: Uint8Array; reason: "not_admin_of_channel" | "pending_approval" | "refused_by_admin" | "already_member" | "ejected" }
```
CBOR arrays via the house encoder; strict decode-with-reasons; barrel exports.

### 2. Channel settings and member list — `core/daemon/src/channel-members-store.ts`
Tables (same store pattern as 007): `channel_settings (channel_pubkey PK, access TEXT NOT
NULL, members_visible INTEGER NOT NULL, guidance TEXT NOT NULL, ttl_seconds INTEGER NOT NULL,
key_generation INTEGER NOT NULL DEFAULT 0)` and `channel_members (channel_pubkey, subscriber_pubkey,
joined_at, status TEXT NOT NULL /* "active" | "pending" | "ejected" */, PRIMARY KEY
(channel_pubkey, subscriber_pubkey))`. An ejected row is never deleted — an ejected pubkey
re-requesting gets `ejected`.

### 3. Handling on the ADMIN's daemon (≈ the document-frame dispatch)
On `channel_join_request` inside a session: verify the session counterparty pubkey equals
`subscriber_pubkey`; verify this daemon administers the channel (`admin_pubkey` of that
channel's local identity record equals this admin agent's pubkey — else
`not_admin_of_channel`); consult `channel_members` (`already_member` / `ejected`); for
`open` → insert active, build key bundle for this member (013's `wrapGroupKeyFor`), reply
`_accepted`; for `invite_only` → insert `pending`, reply `_refused: pending_approval`, and
enqueue an inbox notice for the admin agent (≈ the notification path refusals use), which
the admin resolves through IPC `cello_channel_approve { channel, subscriber }` /
`cello_channel_refuse` — approval sends `_accepted` into the SAME session if still open,
else the subscriber's next join request is accepted immediately.

### 4. Handling on the SUBSCRIBER's daemon
On `_accepted`: verify and unwrap the key bundle (013), write the subscription row (015 owns
that table — 012 calls its `SubscriptionStore.upsert`), store guidance and ttl. Emit
`channel.member.joined` (both sides; fields `correlationId`, `channel_pubkey`,
`subscriber_pubkey`, `access`).

### Observability
`channel.join.requested`, `channel.member.joined`, `channel.join.refused` (+`reason`),
`channel.join.pending` — on the daemon that produced each.

---

## ⚠️ WHAT MUST NOT CHANGE
- **The channel identity never participates.** Joins go to the ADMIN. A join request sent to
  the channel pubkey is refused by 006's gate before this code runs; do not add a bypass.
- **The session counterparty must equal `subscriber_pubkey`** — no joining on someone else's
  behalf.
- **Invite-only means the admin AGENT decides.** No auto-approve heuristics, no "approve
  known contacts automatically."
- **The unknown-sender abuse bound applies to join sessions.** No special case.
- **Ejected stays ejected** until an admin explicitly re-approves (014).

## Tests (to be enumerated to exact assertions at issue time; the properties are fixed)
open auto-admit round trip; invite-only → pending → approve → accepted; refuse → refused;
counterparty mismatch refused; non-admin daemon refuses; already_member; ejected re-request;
subscriber stores guidance/ttl; both daemons log `channel.member.joined`.

## Enforcer
Two real daemons (spine harness or spawn-real-daemon ×2): admin + subscriber, open channel,
join completes, subscriber's `cello_channels` (015) lists it; then invite-only with approval.

## Not in scope
Group-key cryptography (013 — this order calls its two functions); ejection and re-key (014);
the subscription table (015 — called, not built); delivery (Tier 3); MCP tools beyond the two
approval IPC verbs.

## Newly discovered
*(five lines max each; keep going)*
