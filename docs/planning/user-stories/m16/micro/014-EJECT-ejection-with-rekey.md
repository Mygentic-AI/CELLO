---
name: 014-EJECT — Ejection with re-key
type: micro-work-order
date: 2026-09-02
status: draft
source: DOD-M16-EJECT-1
depends_on: [012-JOIN, 013-GROUPKEY]
description: >
  DRAFT — see the planner pre-issue checklist. An invite-only admin ejects a member: the
  member row flips to ejected, the group key generation increments, and the new key is
  wrapped per remaining member and delivered. Eject without re-key is advisory, and advisory
  is not done: the ejected member's old key reads nothing published after the eject.
---

# **<ins>MICRO</ins>** WORK ORDER 014-EJECT — Ejection with re-key (DRAFT)

> ## ⚠️ PLANNER PRE-ISSUE CHECKLIST
> - [ ] Decide and name the delivery path for the re-key bundle to remaining members: (a) the
>       next broadcast artifact carries a `rekey` control payload — but 002's format has no
>       slot, and the ext slot is reserved for co-sig; or (b) a per-member session from the
>       admin's daemon (reuses 012's join machinery: `channel_rekey` frame inside a session the
>       admin's daemon opens to each member). **Planner leaning: (b)**, because it needs no
>       format change and the member count is small at this scale (fan-out parked at ~50). The
>       cost — N sessions per eject — is stated, accepted, and logged as
>       `channel.rekey.fanout` with `member_count`.
> - [ ] Verify the daemon can open outbound sessions without an agent turn (≈ document
>       delivery worker `core/daemon/src/document-delivery-transport.ts`).
> - [ ] Enumerate tests to exact assertions; replace "≈".

> ## THE RULES OF A MICRO WORK ORDER
> 1. Read [[M16-PROCEDURE]] IN FULL first; arm the watchdog cron; do not read the DoD, the
>    journal, or any design log. 2. One mission, never grown. 3. *Newly discovered* at the
>    foot. 4. 500 lines hard cap. 5. Tests first → implement → review (`cello-unit-reviewer`)
>    → fix every finding → commit per fix, push per commit; `status:` flips in the verdict
>    commit. 6. Done is done.

---

## The problem, plainly
Removing a member from a list stops deliveries; it does not stop a departed member who kept
the key from reading anything they can still obtain. **Re-keying is what makes ejection
enforcement.** This order flips the member row, increments the key generation, and delivers
the new key to everyone still in.

**Repo: `cello-client`, `core/daemon` (+ one frame in `core/protocol-types/src/channel-join.ts`).**

## The work
1. Frame `ChannelRekey { type: "channel_rekey"; channel_pubkey; key_bundle; generation }` —
   delivered inside a session from the admin's daemon to each active member (012's handler
   file learns this frame; the member's daemon unwraps and stores the new generation on its
   subscription row — 015 — keeping older generations for reading older content).
2. IPC `cello_channel_eject { channel, subscriber }` on the admin's daemon: require this
   daemon administers the channel and `access === "invite_only"` (open channels cannot eject
   — the member could rejoin; return `eject_not_applicable_open_channel`); member row must be
   `active` → set `ejected`; `key_generation += 1` in `channel_settings`;
   `generateGroupKey(newGen)`; the PUBLISHER daemon must hold the new key for encryption —
   **the admin and the channel identity live on the same daemon in v1** (assert it; if the
   channel identity is not local, error `channel_not_local` — cross-daemon admin is post-M16
   backlog); wrap per remaining active member; deliver `channel_rekey` to each; emit
   `channel.member.ejected` and `channel.rekey.completed` (fields `channel_pubkey`,
   `generation`, `member_count`, `delivered_count`, `failed_count`).
3. Delivery failures to a member are retried by the same worker that retries other daemon
   deliveries (≈ retry-queue.ts); a member that cannot be reached keeps the OLD generation
   and will hit `unknown_generation` on new content — Tier 3 turns that into a re-key
   request; log `channel.rekey.member_unreached`.
4. Publishing after the eject uses the new generation (008/007 path picks the current
   generation from `channel_settings`).

## ⚠️ WHAT MUST NOT CHANGE
- **Eject without a completed generation bump is not an eject.** The generation increments
  in the same transaction as the row flip; delivery may lag, but encryption switches now.
- **Never re-deliver the new key to the ejected pubkey.** Test: the ejected member's daemon
  receives no `channel_rekey`, and its stored keys cannot decrypt the next artifact.
- **Old generations stay readable for old content** on remaining members.
- **No "soft eject" that only stops delivery.**

## Tests (properties fixed; enumerate at issue)
eject flips row + bumps generation atomically; open channel eject refused; non-admin refused;
remaining member receives new generation and decrypts the next artifact; ejected member
cannot decrypt it (real encryption via 013); ejected re-join refused with `ejected`; delivery
failure logs and retries; publishing uses the new generation.

## Enforcer
Three real daemons: admin/publisher, member A, member B; eject B; publish; A decrypts, B
cannot — quote both outcomes.

## Not in scope
Delivery of artifacts themselves (Tier 3); re-key REQUEST from a member (Tier 3);
cross-daemon admin (backlog); MCP tools (Tier 5).

## Newly discovered
*(five lines max each; keep going)*
