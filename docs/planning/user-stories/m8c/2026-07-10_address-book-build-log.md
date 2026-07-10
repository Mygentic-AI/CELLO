---
name: address-book-build-log
type: build-journal
date: 2026-07-10
topics: [contacts, address-book, tiers, reachability, build-log, overnight]
status: active
description: >
  Running build log for the contact address-book unit (spec: 2026-07-10_address-book-implementation-spec.md),
  built overnight by the CELLO_Support agent against cello-client main. A dedicated sibling log to avoid
  colliding with Ms_Chelly's edits to M8C-BUILD-JOURNAL (joinkey publish). Folds into M8C-BUILD-JOURNAL at
  unit close. One section per Step; each Step = its own commit(s) + a Fable-5 cello-unit-reviewer pass.
---

# Address Book — Build Log

Repo: `cello-client` (main). Foundation: `daemon@0.0.45` (DOD-AGENT-ID-JOINKEY-1, contacts agent_id-keyed).
Publish is Ms_Chelly's — this log does NOT publish or deploy. Reviewer runs on **Fable 5** (Andre's rule).

## Step 1 — DOD-TIER-1: schema + tier foundation — ✅ DONE (green + reviewed)

**Commits:** `76ddea7` (build), `976abc3` (review fixes).

**Delivered.** `contacts` gained four nullable columns on the stable agent_id key — `tier`, `provenance`,
`last_offered_moniker`, `away_message` — via a new `contacts-tier-migration.ts` (mirrors the join-key
migration's separate-module shape). Ships:
- `TIER` frozen const map (BLOCKED=0 < UNKNOWN=1 < KNOWN=2 < WHITELISTED=3 < VIP=4) — the single source,
  no bare integers at call sites. `isKnownTierValue` (the set_tier gate, reserved for Step 3).
- `normalizeTier` — TOTAL: absent (undefined) OR NULL OR out-of-range → UNKNOWN (the tighter default);
  explicit checks (never `|| UNKNOWN`, so BLOCKED(0) survives). Guards `null >= 0` and `grid[99]`.
- `migrateContactsAddTierMetadata` — idempotent, PRAGMA-guarded, **NO column DEFAULT** (a DEFAULT would
  defeat the grandfather backfill), ADD COLUMNs + grandfather (existing→WHITELISTED) in ONE transaction
  (crash-atomic). One-time grandfather gated on tier's column-birth. Runs in `initialize()` AFTER the
  agent-id re-key, so it never touches that migration's pinned DDL.
- `SessionNodeManager.getTier(agent, pubkey)` — total via normalizeTier; FAILS CLOSED (throws on
  uninitialized DB / unresolvable agent — it's a security read that Step 2 gates bounds on). Logs
  `contact.tier.corrupt` on an out-of-range stored value.
- `addContact` — stamps a new row `tier=UNKNOWN` (no NULL window) + optional `provenance`; INSERT OR
  IGNORE so tier/provenance pin at first add. Provenance WIRED in production: `'initiated'` at initiate
  (daemon.ts:3289), `'accepted'` at the engagement/reply path (5651).

**SI held:** tier is NOT consulted for any behaviour in Step 1 (isContact still gates auto-accept/bounds);
the stamp is dormant. Verified: getTier has zero production callers; no `SELECT *` leaks new columns.

**Review (Fable 5, on 76ddea7).** Five findings, all fixed in 976abc3:
- **F1 (HIGH)** non-atomic grandfather → crash between ALTER and backfill silently demotes all legacy
  contacts forever. Fixed: single transaction. Atomicity test added (injected backfill failure rolls
  the ADD COLUMNs back).
- **F2 (MED, blocking)** AC5 provenance was capability-only, no production writer. Fixed: wired both
  sites + an end-to-end assertion driving the real initiate handler.
- **F3 (MED)** getTier failed OPEN on missing DB → would admit a BLOCKED sender in Step 2. Fixed: throws.
- **F5 (LOW)** normalizeTier now total over out-of-range; docblock corrected; corrupt-tier log.
- **F4 (Step-3 decision, journaled below).**

**Reviewer-surfaced test fix (not a mask):** the join-key migration's fresh==migrated test replayed only
one of init's two migrations; its legacy replay now runs BOTH in order (faithful to `initialize()`).

**Gate:** daemon 755, workspace 1963 pass; lint, typecheck, build clean.

### Decisions carried to Step 3 (from F4)
- **DEC-AB-1:** `cello_contact_add` will stamp **KNOWN**, not WHITELISTED — whitelisting (away-reach)
  stays an explicit `cello_contact_set_tier` act (design §1). Step-1 floor is UNKNOWN (dormant).
- **DEC-AB-2:** the Step1→Step3 tier=UNKNOWN window is a source-tree artifact only (publish lands after
  the whole unit, Ms_Chelly's) — no production daemon sees it, so no window backfill needed unless that
  publish assumption changes.

## Step 2 — DOD-TIER-2 / TIER-3: tiered bounds + blocked — ⏳ NEXT (red)

Design note staged (scratchpad). Grid keyed by getTier; VIP finite; BLOCKED falls out as the same
byte-identical refusal path as an over-cap UNKNOWN (no oracle). INV-TIER-BOUND / INV-TIER-SCREEN.

## Related
- [[2026-07-10_address-book-implementation-spec]] — the spec (authority).
- [[2026-07-10_contact-address-book-design]] — the design (decisions §1).
- [[2026-07-10_agent-id-joinkey]] — the foundation.
