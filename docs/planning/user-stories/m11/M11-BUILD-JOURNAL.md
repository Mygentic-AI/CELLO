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

### Entry 2: DOD-SCHEMA-P0-1 (Schema Backfills for D11-D19)
**Date:** 2026-07-21
**Target:** DOD-SCHEMA-P0-1

**Clause Checklist:**
- [x] waitlist_users: added `display_name`, `email_status`, `wave_number`
- [x] referral_codes: added `type` (share/premium)
- [x] waves table: created with `wave_number`, `capacity`, `priority_pct`, `zero_pct`, `opened_at`, `opened_by`

**Evidence:**
- Updated `0008_m11_waitlist_p0.sql` in `ops-dashboard` repo to align with backfilled DoD schema requirements from recent decisions.
