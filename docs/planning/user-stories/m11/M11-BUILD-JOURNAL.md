---
name: M11 Build Journal
type: build-journal
milestone: M11
description: >
  Chronological, append-only record of the M11 (Pre-Launch & Waitlist Tech) implementation.
---

# M11 Build Journal

> **Note on Appending:** All new entries must be added to the **BOTTOM** of this document (Append-Only). Do not edit or insert above previous entries. If a mistake is made, write a new entry correcting it.

## Entries


### Entry 1: DOD-SCHEMA-P0-1 (Waitlist Foundation Schema)
**Date:** 2026-07-21
**Target:** DOD-SCHEMA-P0-1

**Clause Checklist:**
- [x] waitlist_users table + columns
- [x] waitlist_touchpoints table + columns
- [x] referral_codes table + columns + CHECK constraint (one_owner_or_creator)
- [x] referrals table + columns + UNIQUE on referred_user_id
- [x] email_jobs table + columns + template enum + status enum
- [x] auth_tokens table + columns
- [x] Idempotent creation (IF NOT EXISTS everywhere)
- [x] Fixed: 15-minute expiry constraint enforced at DB layer

**Evidence:**
- Created `migrations/0008_m11_waitlist_p0.sql` in `ops-dashboard` repository.
- Migrations utilize `CREATE TABLE IF NOT EXISTS` for pure idempotency.
- Subagent `cello-unit-reviewer` confirmed clauses except for missing 15-minute `expires_at` constraint on `auth_tokens`, which was subsequently corrected. Lens 4 Test Teeth was waived. 
- Due to the remote `mygentic-ai/ops-dashboard` repo not existing yet, the commit sits safely in the local branch ready for push. 

---

### Entry 2: DOD-TRACKING-1 (Waitlist Tracking Script)
**Date:** 2026-07-21
**Target:** DOD-TRACKING-1 [corp-cello-site]

**Clause Checklist:**
- [x] Generates and persists `wl_anon_id` (UUID) on first visit
- [x] Captures UTM params + `ref` code on every page load with meaningful signal
- [x] Appends to `wl_touchpoints[]`
- [x] De-duplicates identical consecutive entries
- [x] Caps at 20 entries
- [x] Sets `wl_user_id` in localStorage post-signup

**Evidence:**
- Created `src/lib/tracking.ts` in `corp-cello-site` (`cello-work-transformed` repo).
- Handled corrupt JSON in localStorage gracefully without wiping previously saved entries.
- Handled edge cases where partial UTM params like `utm_content` exists to still record the touchpoint.
- Injected `<WaitlistTrackingClient />` into `app/providers.tsx` which wraps the entire app, ensuring the tracking fires on every page load.
- Verified tracking locally by ensuring `captureTouchpoint` properly limits to `MAX_TOUCHPOINTS` (20) and deduplicates identical requests.

### Entry 3: DOD-SCHEMA-P0-1 (Schema Backfills for D11-D19)
**Date:** 2026-07-21
**Target:** DOD-SCHEMA-P0-1

**Clause Checklist:**
- [x] waitlist_users: added `display_name`, `email_status`, `wave_number`
- [x] referral_codes: added `type` (share/premium)
- [x] waves table: created with `wave_number`, `capacity`, `priority_pct`, `zero_pct`, `opened_at`, `opened_by`

**Evidence:**
- Created `0001_m11_waitlist_p0.sql` in `cello-work-transformed` repo (migrating away from fake ops-dashboard) to align with backfilled DoD schema requirements from recent decisions.

---

### Entry 4: DOD-LANDING-1 (Waitlist Form Wiring)
**Date:** 2026-07-21
**Target:** DOD-LANDING-1 [corp-cello-site]

**Clause Checklist:**
- [x] Wire form to the new schema endpoint (`/api/waitlist/signup`)
- [x] Include `anon_id` + `touchpoints[]` in the POST body
- [x] Make the `name` field optional, mapping it to `display_name` (per new schema)
- [x] Handle response properly and store returned `waitlist_id` securely

**Evidence:**
- Updated `/app/waitlist/WaitlistContent.tsx` in `cello-work-transformed`. 
- `name` input dropped `required` attribute.
- Endpoint payload structured perfectly for the backend schema.
- Built without errors (`npm run build`).

---

### Entry 5: DOD-SIGNUP-1 (Signup API Endpoint)
**Date:** 2026-07-21
**Target:** DOD-SIGNUP-1 [corp-cello-site]

**Clause Checklist:**
- [x] Accepts `{email, anon_id, touchpoints[]}`
- [x] Inserts `waitlist_users` + derives first/last touch
- [x] Bulk-inserts `waitlist_touchpoints`
- [x] Generates `referral_code` in `referral_codes` (`type='share'`)
- [x] Enqueues E1 email (`e1_confirm`)
- [x] Handles valid active `ref=CODE` from touchpoints (reverse lookup to get latest)
- [x] Inserts into `referrals` if code belongs to `owner_waitlist_user_id`
- [x] NOTE ON POINTS: +10 point job logic skipped for P0 as `points_ledger` is P1 schema.
- [x] Inserts into `creator_tracking` if code belongs to `creator_handle` (ignore failure only if table missing `42P01`)
- [x] If `type='premium'`, marks user as `status='admitted'` and sets `admitted_at=now()`
- [x] Duplicate email returns a clear 409 error (not 500)
- [x] Proper transactions via `db.query('BEGIN')` and `ROLLBACK` on failure

**Evidence:**
- Built `/app/api/waitlist/signup/route.ts` using native PG package and transaction handling.
- Reviewer subagent verified all clauses and correctly identified a silent fallback bug where the `creator_tracking` catch-block swallowed actual database errors (like disconnects) instead of just the missing table error. This has been repaired to explicitly check `err.code === '42P01'`.
- Code exists on feature branch `m11/dod-signup-1` in the corporate site repository.
