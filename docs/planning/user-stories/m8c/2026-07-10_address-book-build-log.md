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
- **DEC-AB-3 (from DOD-TIER-4 review F1, 2026-07-10 — engagement-promotes, NOT accept-promotes):**
  DOD-TIER-4 AC3 and design §1a say "on accept → KNOWN." The implementation instead stamps KNOWN on
  ENGAGEMENT (a committed reply into an accepted inbound session, daemon.ts:5658, provenance 'accepted';
  or an outbound initiate, or an explicit add) — a mere transport-accept adds nothing. **Decision:
  keep engagement-promotes** (the tighter, security-conservative reading), for three reasons: (1) it
  preserves CC-1 (BUILD-JOURNAL Entry 50, 2026-07-07, live-verified in the A/B run: a stranger who
  merely knocks is not promoted); (2) the standing overnight rule is "take the tighter/fail-safe option
  and flag" — accept-promotes would auto-grant KNOWN reachability (richer away text, larger caps) to
  anyone who opens a session, a looser posture; (3) design §1a's premise sentence ("accepting a session
  today adds the sender") was already FALSE when written (CC-1 removed add-on-accept three days
  earlier), so §1a cannot be read as authoritative on the accept-vs-engage seam. **Flag for Andre:** if
  he intended literal add-on-accept-at-KNOWN (with the "operator is then offered the upgrade" prompt),
  that is a small follow-up unit — say so and it will be built. Until then the tighter reading ships.

## Step 2 — DOD-TIER-2 / DOD-TIER-3: tiered bounds + blocked — ✅ DONE (green + reviewed)

**Commits:** `8040bd4` (build), `e4bb1b9` (self-found re-check fix), `0471fc0` (review fixes).

**Delivered.** The binary "known contacts exempt entirely, else 3/25MB" became a tier-graduated grid:
- `DEFAULT_TIER_BOUNDS` (contacts-tier-migration) — per-tier {maxSessionsPerSender, maxBytesPerSession}:
  BLOCKED 0/0, UNKNOWN 3/25MB, KNOWN 5/100MB, WHITELISTED 20/500MB, VIP 50/2GB. Single source (AC4);
  all FINITE (VIP ≠ Infinity, INV-TIER-BOUND). `tierBoundsFor` total. Legacy ABUSE_MAX_* consts now
  DERIVE from grid[UNKNOWN] so they cannot drift.
- `checkUnknownSenderAcceptanceBound` keys the per-sender cap on getTier. **DOD-TIER-3 falls out for
  free:** BLOCKED cap 0 → refused via the SAME reason/path an over-cap UNKNOWN takes (no oracle). Global
  anti-swarm cap applies only when tier === UNKNOWN.
- Both per-session byte-cap gates use the sender's tier cap, applied to EVERY sender (contact no longer
  exempt). `countActiveSessionsFromUnknownSenders` keys the stranger pool on `tier >= KNOWN` (≤ VIP), not
  row-existence — a merely-recorded UNKNOWN contact no longer escapes the anti-swarm cap.

**Self-found before review (`e4bb1b9`):** the SECOND byte-cap gate (post-screenInbound re-check) was
missed by the first conversion (its log carries `recheck:true`, so the replace_all pattern skipped it) —
it still exempted contacts. Fixed to mirror the primary gate. (The reviewer independently flagged this
same gate as F1 HIGH — already fixed by the time the review landed.)

**Review (Fable 5, on 8040bd4).** F1 (HIGH) = the re-check gate, already fixed. F2 (LOW) = two stale
"contacts exempt" comments in the accept path → rewritten. Three test-teeth gaps closed (`0471fc0`):
- BLOCKED real-wiring test: an injected inbound knock from a BLOCKED sender produces the refusal event
  and NO node.created / accepted / away.response.sent / doorbell.sent / sessions row (TIER-3 AC2, and the
  direct test for a "move away above the bound check" bypass).
- Global-pool distinguishing tests: an UNKNOWN-tier CONTACT counts toward the pool (a KNOWN+ one doesn't),
  and is refused with the global reason when the pool is full — red under the old row-existence query.
- KNOWN byte cap proven behaviorally finite (100 MB prior + tip → refused) — kills a `tier>=KNOWN?Infinity`.

**Gate:** daemon 767, workspace 1975 pass; lint, typecheck, build clean.

## Step 3 — DOD-TIER-4 / CONTACT-VIEW-1 / RENAME-1: address book + Option C — ✅ DONE + LIVE-CERTIFIED

Split into three review-units. Commits: TIER-4 `cfc0783` + fixes `c2bef79`; CONTACT-VIEW-1 `b539bd0`;
RENAME-1 `2886c65`.

- **DOD-TIER-4 — ✅ done + reviewed.** isContact split into isKnown(≥KNOWN, the away-wording site) /
  isAutoAccept(≥WHITELISTED, the LEAVEMSG seam). addContact gained an explicit `tier` (default UNKNOWN
  floor); the 3 creation paths pass KNOWN (initiate/engage/explicit-add). Review: F1 → DEC-AB-3
  (engagement-promotes, journaled); F2 → end-to-end KNOWN assertions for all 3 paths; F3 → addContact
  throws on out-of-range tier. Gate: daemon 777.
- **DOD-CONTACT-VIEW-1 — ✅ done (3b review in flight).** cello_contact_set_tier (validates 0..4, emits
  contact.tier.changed) + MCP tool + CLI `cello contact tier`. listContacts extended with a read-side
  LEFT JOIN: tier, provenance, sealed-session count, last-spoke — per-agent scoped, no-sessions=never.
  Corrected the stale "exempt from screening" MCP descriptions.
- **DEC-AB-4 (from DOD-RENAME-1 3b review F1 — rename baseline updates on ACCEPTANCE, not raw
  offer-seen):** AC1 says "set last_offered_moniker unconditionally when the offer is SEEN." The
  implementation updates the baseline (and any notice) right AFTER the acceptance-bound check passes —
  so a BLOCKED or over-cap peer, whose offer is refused before any session state, does NOT update the
  operator's rename baseline or push notices into their inbox. **Decision: keep the acceptance-gated
  placement** (tighter: a peer you blocked or who is flooding you must not be able to drive your
  address book or spam your inbox). Moved the call from the post-`acceptSession` point to immediately
  after `bound.ok` so an ALLOWED peer is still tracked even if session formation transiently fails
  (closing the reviewer's transient-failure gap). Tested both ways: an accepted differing offer →
  notice; a BLOCKED named contact's differing offer → no notice.
- **DOD-RENAME-1 — ✅ done (3b review in flight).** Option C: contact_rename_notices table +
  recordOfferedMoniker (at the offer-SEEN point, AFTER the acceptance bound — so a BLOCKED/over-cap
  sender can't manipulate the rename baseline; verified secure) / getRenameNotices / clearRenameNotice.
  Notices surface via cello_check_notifications (INBOX, not a push), rendered as an untrusted quoted
  claim; cleared on set_moniker (adopt) or remove. Local pet name never overwritten (AC2). 7 manager
  tests + an end-to-end integration.

Gate at RENAME-1 commit: daemon 785, workspace 1993 pass; lint, typecheck, build clean. 3b (CONTACT-VIEW-1
+ RENAME-1) awaiting the Fable-5 review; TIER-4 already reviewed.

## Step 4 — DOD-SETTINGS-1 / TIER-BOUNDS-SETTINGS / AWAY-TIER-1: settings + away messages — ✅ DONE + LIVE-CERTIFIED

- **DOD-SETTINGS-1 — ✅ done (review pending).** Commit `d385fca`. New agent_settings(agent_id, key,
  value, updated_at) table + getSetting/setSetting(upsert, fail-closed)/getAllSettings. New
  agent-settings-keys.ts: the key namespace — `bounds.<tier>.{max_sessions,max_bytes}` and
  `away.default` / `away.tier.<tier>` for the settable tiers (unknown/known/whitelisted/vip; BLOCKED
  fixed 0/0, never overridable). cello_settings_get/set handlers; unknown key REFUSED (invalid_key);
  unset key → null so the consumer applies the default. Gate: daemon 794. Fable-5 review to run.
  Review (Fable 5): F1 (typo'd GET key → invalid_key, not null), F2 (setSetting store-level backstop),
  F3 (non-string key → missing_params), T1 (agent_id-keying proven via raw-SQL), T2 (fail-closed write).
  All fixed (`2e5c602`). Gate: daemon 802.
- **DOD-TIER-BOUNDS-SETTINGS — ✅ done + reviewed.** Commit `805b8f0` + fixes `cc063e0`.
  `resolveTierBound(agent, tier, field)` reads a per-agent `bounds.<tier>.<field>` override, else the
  grid (checkUnknownSenderAcceptanceBound + both byte-cap gates). No settings = byte-identical to Step 2.
  validateSettingValue rejects Infinity/negative/0/decimal (INV-TIER-BOUND — a setting cannot REMOVE a
  bound). Review: F1 (log settings.bound.corrupt on the fallback), F3 (settableTierName keys off TIER
  constants), T1 (max_bytes override proven through the real byte-cap gate). Gate: daemon 809.
- **DOD-AWAY-TIER-1 — ✅ done (review in flight).** Commit `cad3544`. resolveAwayMessage resolves
  most-specific-first: per-contact away_message → away.tier.<tier> → away.default → null (caller applies
  the system default AWAY_TEXT[kind]/STRANGER_TEXT — total). setContactAwayMessage + cello_contact_set_away
  handler + MCP tool + CLI `cello contact away`. **SI:** sendAwayResponse now SCREENS the resolved away
  text via securityGateway.screenOutbound (block/warn → not sent; redact → altered bytes) — it does not
  bypass the gateway; mirrors the tested cello_send verdict handling. Observability `contact.away.resolved`
  (which level matched) added post-commit (staged for the review-fix batch). Gate: daemon 808, workspace
  2016. Fable-5 review running.

## 🎉 Address book DONE — all 9 DoD lines built + reviewed + fixed

TIER-1, TIER-2, TIER-3, TIER-4, CONTACT-VIEW-1, RENAME-1, SETTINGS-1, TIER-BOUNDS-SETTINGS, AWAY-TIER-1 —
**all nine** through a Fable-5 cello-unit-reviewer pass with every finding fixed and re-gated. Full
workspace **2021 pass** (daemon 813); lint, typecheck, build clean throughout.

**AWAY-TIER-1 review (Fable 5, `cad3544`) fixes — `81c02b5` (observability) + `d5557f9`:** F1 (the
`contact.away.resolved` event — already committed in 81c02b5 before the review landed), F2 (empty/
whitespace away text CLEARS, never stores a blank reply — fixed the MCP-vs-CLI inconsistency), F3 (away
text length-bounded at 2048), T1 (the away RESPONSE using the resolution is now tested end-to-end — a
per-contact text lands in the transcript), T2 (the SI — an injected gateway proves a BLOCK sends nothing
and a REDACT sends the ALTERED bytes, never the draft).

**Decisions journaled:** DEC-AB-1 (explicit add→KNOWN), DEC-AB-2 (no Step1→3 window backfill), DEC-AB-3
(engagement-promotes, not accept-promotes), DEC-AB-4 (rename baseline updates on acceptance, not raw
offer-seen).

## DOD-SETTINGS-SURFACE-1 — operator surface for the settings store (added post-audit) — ✅ done + reviewed

The done-auditor flagged that `cello_settings_get/set` existed only as daemon IPC — the tier bound
overrides and the per-tier/agent-default away messages shipped operator-UNREACHABLE. Andre chose GO on
adding the surface before publish (don't ship dead features). Commits `2b8c448` (surface) + `1af5bb1`
(review F1).
- MCP tools `cello_settings_get`/`cello_settings_set` + CLI `cello settings get|set` — forward-only
  (D7); validation stays daemon-side (invalid_key / invalid_value; unset→null). Red-first CLI test vs a
  real daemon.
- Fable-5 review: FAITHFUL / NO SILENT FALLBACKS / TESTS HAVE TEETH. F1 (LOW, fixed): POSIX `--`
  end-of-flags terminator so a dash-leading value (negative bound, away text "- back Monday") reaches the
  daemon. T1 (pre-existing pattern): the argv switch is untested — no binary-spawn infra exists CLI-wide;
  logged as a follow-up (with the byte-cap 2nd-gate race test), not blocking.
- Gate: workspace 2025 pass; lint, typecheck, build clean.

**Head commit (cello-client):** `1af5bb1` — origin/main confirmed == HEAD. Client-side only — no directory
change, no deploy. Reported to Ms_Chelly over CELLO; she owns the delta verify + the one publish cascade.

**Remaining — ALL DONE (Ms_Chelly, 2026-07-11):** delta-verified, published v0.0.94, promoted to `latest`,
live-smoke certified. See the close section below.

## ✅ PUBLISHED + LIVE-SMOKE CERTIFIED — 2026-07-11 (Ms_Chelly)

**Published & promoted.** Delta-verified `1af5bb1` independently (read the migration / bounds / screening /
settings-validation diffs; own 4-part gate 2025 pass), cut the cascade **v0.0.94 → daemon 0.0.46 / cli
0.0.44 / connect 0.0.65**, verified against the npm binary (dist contains `migrateContactsAddTierMetadata`,
`validateSettingValue`, `cello_settings_set`; cross-pins real, no `workspace:*`; smoke-tag green). Andre
promoted all three to `latest` and installed.

**Migration incident on first live login — RESOLVED, no data loss.** The `agent_id` backfill (0.0.45, a
PREREQUISITE that runs before the tier ADD COLUMN) aborted `agent_id_backfill_ambiguous`: the name
`Ms_Chelly` resolved to two `agent_id`s (a June-25 agent retired June-26, and the July-6 active one that
reused the freed name — hazard #1, retire-reuse). Root cause **proven from the DB** (not the error's
say-so): the retired identity owns **zero** rows — all 67 sessions / 154 transcript / 3 contacts postdate
the active agent, so nothing is truly ambiguous. Fixed by hand: **renamed the defunct retired row**
`Ms_Chelly → Ms_Chelly_retired_b3e96900` (one `UPDATE`, DB backed up first) → the map became unambiguous →
`cello login` migrated clean: `daemon.migration.agent_id_backfill` (11 agents, 133 sessions) then
`contacts.tier.grandfathered count:6 tier:3`. Full incident + the launch-hardening finding:
[[2026-07-11_retire-reuse-migration-incident]].

**Live A/B smoke — all 9 lines + the surface, certified LIVE (not vitest-green):**
- Solo (Ms_Chelly): grandfather → all contacts WHITELISTED (tier 3); contact-view JOIN (sealed count +
  last-spoke); settings round-trip; INV-TIER-BOUND rejections (`0`/`2.5`/`Infinity` → `invalid_value`;
  `blocked` not a settable tier); `invalid_key`; away-text set. ✅
- Wire (with CELLO_Support as counterparty): **RENAME-1** ✅ (notice fired on the `_v2` rename, named by
  the operator's pet name, new name as an unverified quoted claim; the revert REPLACED it — bidirectional,
  one-per-contact; local moniker never overwritten). **AWAY-TIER-1** ✅ (`away.default` resolved at
  `agent_default` level, sent, screened outbound, received verbatim). **TIER-3** ✅ (blocked knock refused
  `reason:"abuse_bound_sessions_per_sender"` server-side — byte-identical to an over-cap unknown, no away
  reply; from the blocked initiator's side, `dispatched_to_relay` + silence, **byte-for-byte
  indistinguishable from "offline"** — no oracle, confirmed both ends).

**Two known-behavior findings (logged, coherent, not defects):**
1. **BLOCKED mutes existing sessions, not just new-session acceptance.** A blocked contact's byte cap is 0,
   so its content is rejected at ingest on an already-open session too ("blocked = fully cut off").
2. **`delivered:true` yet ingest-rejected asymmetry.** A blocked sender's `cello_send` reports
   `delivered:true` (bytes reached the wire) even though the daemon drops the content at ingest — which
   *preserves* the no-oracle property on existing sessions. Worth a one-line note in known behavior.

## Related
- [[2026-07-10_address-book-implementation-spec]] — the spec (authority).
- [[2026-07-10_contact-address-book-design]] — the design (decisions §1).
- [[2026-07-10_agent-id-joinkey]] — the foundation.
