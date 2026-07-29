---
name: M11 Pre-Launch Definition of Done
type: definition-of-done
date: 2026-07-20
milestone: M11
status: open
topics: [m11, prelaunch, waitlist, gtm, email, analytics, telegram, gallery, ops-dashboard]
description: >
  The yardstick for M11 — the pre-launch milestone covering waitlist infrastructure, GTM
  tracking, email automation, Telegram gate, the gallery, and the ops dashboard. Every
  requirement, ordered by phase tier, with status. This document is the sole status authority.
  Pairs with M11-PRELAUNCH-REQUIREMENTS.md (the spec-of-record) and M11-BUILD-JOURNAL.md.
---

# M11 — Definition of Done

## How to use this

- Find the lowest-numbered line not ✅ — that is the next unit.
- **Evidence discipline:** a flipped tag carries ONE line of evidence plus `→ Journal Entry N`. Full run output lives in the journal, not here. This document stays a scoreboard.
- **Three enforcers:**
  - **Schema enforcer** — Flyway migration + `pnpm migrate` clean + fresh schema == migrated schema (idempotent). A migration that fails on a DB with prior data is not ✅.
  - **Email enforcer** — SES sandbox send to a verified address, open confirmed in AWS console. Production-access ACs (see DOD-SES-PROD-1) run against real SES, not a mock.
  - **Live end-to-end enforcer** — the live journey: a real signup → points accrual → wave admission → token burn → Telegram gate → DKG proceeds. Lines touching the Telegram bot or the admission flow are ✅ only after this journey passes.
- Phase order is a dependency order, not a calendar. P0 unblocks P1; P1 unblocks P2. P3 can run in parallel with P1/P2.
- All URLs are `*.cello.mygentic.ai`. Never invent external domains.
- The corp-cello-site repo is the home for the landing page, status page, and gallery. The ops dashboard is a new repo (clone of cello-portal). Existing SES + waitlist infrastructure in corp-cello-site is a starting point, not a constraint — read it before assuming what already exists.

## Repo Legend

Every DoD line carries a `[repo]` tag immediately after its ID. Use this table to find the correct local path and GitHub remote.

| Tag | GitHub remote | Local path | Notes |
|-----|--------------|-----------|-------|
| `corp-cello-site` | `Andre-Mygentic/cello-work-transformed` | `/Users/andrep/Documents/code/corp-cello-site` | Public site — landing page, waitlist, /auth, /status, gallery, blog |
| `trustless-cello` | `Mygentic-AI/CELLO` | `/Users/andrep/Documents/code/trustless-cello` | **Lambdas + docs only.** Never touch `packages/directory/` or `packages/relay/`. |
| `ops-dashboard` | *(new repo — clone cello-portal, TBD name)* | *(to be created)* | Ops dashboard at `operations.cello.mygentic.ai` — see DOD-OPS-SHELL-1 |
| `cello-portal` | `Mygentic-AI/cello-portal` | `/Users/andrep/Documents/code/cello-portal` | **Read/borrow only for M11.** Copy auth/session patterns; do not modify this repo. |
| `cello-client` | `Mygentic-AI/cello-client` | `/Users/andrep/Documents/code/cello-client` | Sealed receipt footer format only (P3) |
| `openclaw` | *(separate repo)* | `/Users/andrep/Documents/code/openclaw` | Skill directory only (P3) |

**Multi-repo lines:** when a line lists two repos, primary work is first. Secondary is the caller/consumer that needs a matching change.

## Status legend
✅ PROVEN (enforcer-green) · 🟡 BUILT/UNVERIFIED-LIVE · 🟠 PARTIAL · ❌ NOT BUILT · 🅿️ PARKED

**Every 🟡 line owes an AWS enforcer, and they are listed in dependency order in [[M11-NEXT-STEPS-AWS-AWAKE]].** That document was written while infra was hibernated and none of it could be run — read it before deploying anything, particularly §0, which gates six lines and cannot be answered by reading this repo.

---

## Tier I — Invariants (must hold in every phase, every line)

- **DOD-INV-NO-SAAS** [all repos] — no paid SaaS is used or referenced. Every service (email, tracking, analytics, URL shortening) is self-hosted on AWS, GCP, or open-source. Any implementation that takes a dependency on a billable third-party service is a blocking finding. — ✅ checked by `infra/scripts/verify-m11-invariants.sh` (denylist of named vendors); green → Journal Entry 19
  **✅ EARNED 2026-07-25:** the enforcer this line names (`verify-m11-invariants.sh`) is green, and the deployed stack is AWS-only — SES, Lambda, EventBridge, SNS, API Gateway, RDS. No billable third party is referenced or used.

- **DOD-INV-DOMAIN** [all repos] — all public and internal URLs are subdomains of `cello.mygentic.ai`. No other domain is used, linked to, or referenced in code, copy, or configuration. — ✅ checked by `verify-m11-invariants.sh`; green → Journal Entry 19
  **✅ EARNED 2026-07-25:** scanner green, and confirmed live: the deployed API serves on `api.cello.mygentic.ai` (ACM cert issued for that name, custom domain AVAILABLE), not the execute-api host the scanner also denylists.

- **DOD-INV-TWO-DOOR** [corp-cello-site, ops-dashboard] — the waitlist has exactly two admission paths: (1) the slow door — signed up, earned points, admitted in a wave; (2) the fast door — an admitted user spends a premium invite code. No third path exists. — 🟡 both doors exist and are distinguishable in the data (`premium_referred` split from `status='admitted'` in `0003`); no third path writes `status='admitted'`. Owed: wave assembly (P2) for the slow door's other half → Journal Entry 20
- **DOD-INV-WAVE-GATE** [ops-dashboard] — wave admission is triggered by an operator action (infrastructure checkpoint), never by a calendar date or time-based automation. The wave-assembly function cannot be invoked except by an authenticated ops dashboard action. — 🟠 no schedule exists and `opened_by` is required and recorded, so a wave always names its operator. The authenticated dashboard now exists (Entries 41, 42, 44): allowlist-gated sign-in, 8-hour sessions re-checked against the allowlist per request, and every wave carrying the signed-in operator as `opened_by`. Owed: **a deploy** — until it runs somewhere, nothing but IAM restricts who invokes the wave function in practice, so the invariant holds in code and not yet in the world → Journal Entry 21
- **DOD-INV-POINTS-CAPS** [corp-cello-site] — no action can award points beyond its stated cap. Cap enforcement is at insert time in the DB, not in the application layer alone. A direct SQL insert past the cap must fail. — 🟡 trigger covers INSERT **and UPDATE** (an UPDATE past a cap silently did not fail), sync covers DELETE, and a two-thread test proves the cap holds under concurrency — it did not before `0010`. **APPLIED TO THE PORTAL RDS 2026-07-25** (same 22-migration set; second invocation applied 0) → Journal Entries 10, 18, 23
- **DOD-INV-HANDLE-UNIQUE** [corp-cello-site] — one social handle maps to exactly one waitlist entry. `(platform, handle)` UNIQUE constraint on `waitlist_social_profiles`. A duplicate attempt at the DB layer is a hard reject. — 🟡 enforced in BOTH directions — `(platform, handle)` and `(waitlist_user_id, platform)` — with SQL-level tests for each. Owed: portal RDS → Journal Entry 16
- **DOD-INV-TOKEN-SINGLE-USE** [corp-cello-site] — a waitlist token, once burned (`used_at` set), can never be re-used. A second attempt to burn the same token returns a clear error. No mechanism exists to un-burn a token. — 🟡 burn is atomic (`UPDATE … WHERE used_at IS NULL RETURNING`), proven under two concurrent redemptions; a second attempt returns `token_already_used`; one live grant per user; nothing anywhere clears `used_at`. Owed: the live enforcer → Journal Entries 21, 24
- **DOD-INV-NO-PII-DIRECTORY** [corp-cello-site] — the CELLO directory stores no PII. Waitlist-related data (email, social handles, queue position) lives in the waitlist Postgres DB only. `waitlist_agent_links` stores only `agent_pubkey` and `waitlist_user_id` — never email. — 🟡 checked: no M11 Lambda references email alongside a directory table → Journal Entry 19
- **DOD-INV-STABLE-PK** [corp-cello-site, ops-dashboard] — every new table keys on a stable UUID PK. No join, foreign key, or WHERE-match uses `email`, `agent_name`, or any other mutable attribute as an identity anchor. Looking up a user by email to *retrieve* their `waitlist_id` is correct; storing email as a FK in another table is not. — ✅ checked structurally (FK/PK/JOIN only, not WHERE) + all 12 tables assert a PK; `creator_tracking` moved off a TEXT `session_id` to a real FK in `0012` → Journal Entry 19
  **✅ EARNED 2026-07-25:** both halves green — no FK/PK/JOIN anchored on a mutable attribute, and all 19 M11 tables (the line said 12; the set has grown) declare a primary key.

- **DOD-INV-NO-INFLATION** [corp-cello-site, ops-dashboard] — queue positions and wave estimates are always computed from real data. No fabricated counts, padded queue sizes, or manufactured social proof exist anywhere in the system. A queue position of #84 means there are exactly 83 higher-ranked users. Any hardcoded queue size or fake wave assignment is a blocking finding. — 🟡 queue position is a computed view, never stored; reviewer confirmed no hardcoded counts in the P0 diff → Journal Entries 8, 11

- **DOD-INV-NO-DIRECTORY-RELAY** [trustless-cello] — M11 never modifies directory node or relay node code. The only trustless-cello touches are Lambda code (Telegram gate, first-win detection, feedback detection), **the waitlist's own infrastructure** (`infra/lambda/`, `cello-waitlist.yaml`, the waitlist step in `deploy.sh`/`deploy-lambdas.sh`, `infra/scripts/`, `infra/STATE.md`), and docs. *(Clause AMENDED 2026-07-25 — see M11-D30. As originally written it said "Lambda code … and docs", which was false the moment the waitlist needed a CloudFormation stack of its own. Amending the text rather than the behaviour, because the invariant's intent — do not touch the directory or relay — held throughout and is what the checker enforces.)* Any change to `packages/directory/`, `packages/relay/`, or their CloudFormation stacks is out of scope and a blocking finding. No directory deploy is triggered by M11 work. — ✅ checked by git diff over the whole M11 range; zero files touched → Journal Entry 19
  **✅ EARNED 2026-07-25:** zero files touched under `packages/directory` or `packages/relay`, AND neither ECS stack changed, over the WHOLE milestone. The second clause was unchecked until now and the check itself was vacuous — it diffed from ~1h ago because `git log --grep --reverse -1` returns the newest match. Both fixed and proven (Entry 58).

- **DOD-INV-SINGLE-DB** [corp-cello-site, ops-dashboard] — all M11 database work targets the portal's existing RDS instance. No new database is provisioned. Waitlist tables are additive schema in the portal DB. No M11 migration, query, or connection touches the CELLO directory databases (one per region). An import or connection string pointing at a directory DB is a blocking finding. — ✅ checked: no directory-DB reference and no hardcoded RDS endpoint anywhere; every Lambda connects via `DATABASE_URL` → Journal Entry 19
  **✅ EARNED 2026-07-25:** four static checks green, and verified on the deployed function: `DATABASE_URL` is `portal_admin@cello-portal-dev…/cello_portal`, never the directory instance. An earlier draft imported the directory's exports, so this is the check worth repeating.

- **DOD-INV-EMAIL-SEGMENTS** [trustless-cello] — two email segments exist and are never conflated: the **base list** (all verified signups, receives E1/E2/E3/E-inv/E-win/E-re) and the **content alert list** (`content_alerts = true`, receives E-alert only). An E-alert query that omits the `content_alerts = true` filter is a blocking finding. An E3 send that filters on `content_alerts` is also wrong — E3 goes to the base list unconditionally. — 🟡 enforced in the dispatcher; both directions tested (an e_alert to a non-opted-in user, and E1 unaffected by the flag). Owed: live send → Journal Entry 12

- **DOD-INV-EMAIL-SUPPRESS** [trustless-cello] — the email pipeline must check `email_status = 'active'` before every send. A send to a suppressed address (`bounced` / `complained` / `unsubscribed`) is a blocking finding. Suppression is independent of waitlist lifecycle status — an `admitted` user with `email_status = 'bounced'` receives zero emails. — ✅ checked before every send; bounced/complained/unsubscribed all tested, plus the admitted-but-bounced case explicitly. Owed: live send + the bounce SNS handler that SETS these statuses → Journal Entry 12
  **✅ EARNED 2026-07-25:** both owed items done live — a real send, and BOTH suppression paths firing against the exact signups: bounce@simulator → `email_status='bounced'`, complaint@simulator → `'complained'`.

- **DOD-INV-PREMIUM-BEARER** [corp-cello-site] — premium invite codes are bearer tokens burned on first successful signup. They are never email-bound. The `/invite/CODE` route stores the code in localStorage; the signup form reads and submits it silently. A code that burns without a completed signup (e.g. on a failed validation) is a defect. An unburned code remains live for the inviter to share with someone else. — 🟡 `/invite` stores + forwards without validating or burning; the form reads and submits it silently; burn is server-side under `FOR UPDATE` on a completed signup, with a two-thread test. Owed: a live run → Journal Entry 20

- **DOD-INV-NO-ENUMERATION** [corp-cello-site] — `/auth` must never reveal whether an email exists in the system. The response ("Check your inbox") is identical for known and unknown emails. Any observable difference — redirect, message text, HTTP status, or response timing — between the two cases is a blocking finding. — ✅ identical body/status/headers; the floor is asserted directly (the earlier gap-only test passed with the floor deleted) and warns when a slow DB outruns it; a DB fault on a known address no longer returns a different status than an unknown one; rate limiting counts requested addresses regardless of existence → Journal Entries 14, 23
  **✅ EARNED 2026-07-25:** every observable the clause names, checked against the deployed API: identical body, identical 200, identical headers for a known and an unknown address, and four warm samples per path landing in the same band (1.41–1.47s vs 1.47–1.49s). The one cold sample that looked like a channel was a Lambda cold start.

---

## P0 — Capture (blocks everything)

- **DOD-LANDING-1** [corp-cello-site] — signup form working end-to-end on the primary `cello.mygentic.ai/waitlist` page. **Existing:** `app/waitlist/WaitlistContent.tsx` already renders a form (email + name fields) and POSTs to a Lambda; duplicate-email 409 and confirm-inbox states both handled. **P0 remaining work:** (a) wire form to the new schema endpoint (new Postgres DB, not the old Lambda); (b) include `anon_id` + `touchpoints[]` in the POST body (per DOD-TRACKING-1 script); (c) extract `ref` from `localStorage` touchpoints and include in submission; (d) the name field is optional — schema allows it but the new `waitlist_users` table has no `name` column, so drop it or map to a notes field. Do NOT rebuild the page. — 🟡 form posts to `api.cello.mygentic.ai/waitlist/signup` through `waitlistApi.signup` — the same-origin `/api/*` 404 is long fixed, and this note was stale. Signup was the one call still building its own URL from a second env var (`NEXT_PUBLIC_WAITLIST_API`), so a staging redirect would have moved every call except the one creating the user; consolidated with 5 tests including a revert test (Entry 45). **The API half is PROVEN live** (2026-07-25): a real signup to `api.cello.mygentic.ai/waitlist/signup` carrying `anon_id`, `touchpoints[]` and a `ref` returned `{success, waitlist_id, referral_code, referral:{applied:true, kind:'creator'}}` — clauses (a), (b), the server half of (c), and (d) via `display_name`. **THE SITE IS DEPLOYED (2026-07-25, on Andre's explicit go-ahead).** `m11/review-fixes` fast-forwarded onto `main`, the Deploy Corp Site workflow succeeded, and `/waitlist`, `/status`, `/survey`, `/invite`, `/confirm` and `/gallery` all serve 200. Verified on the SERVED BUNDLE rather than on source: the live chunk contains `https://api.cello.mygentic.ai/waitlist`, so the deployed page targets the deployed API. **Still owed: a browser run.** The client half of (c) — the browser reading `ref` out of localStorage touchpoints and putting it in the POST — is unit-tested (`tracking.spec.ts`) and has still never executed in a browser; curl cannot run it → Journal Entries 6, 45, 52

- **DOD-SCHEMA-P0-1** [corp-cello-site] — migrations for all P0 tables deployed and idempotent:
  - `waitlist_users`: `waitlist_id` (UUID PK), `email` (unique), `anon_id`, `display_name` (TEXT NULL), `points_total` (default 0), `status` (waiting/admitted/banned), `email_status` (active/unsubscribed/complained/bounced), `email_verified` (bool), `content_alerts` (bool, default false), `feedback_eligible` (bool, default false), `feedback_eligible_date` (timestamptz nullable), `first_touch_source`, `first_touch_ref`, `last_touch_source`, `last_touch_ref`, `touchpoints_json` (JSONB), `created_at`, `admitted_at` (nullable), `first_win_at` (nullable), `wave_number` (nullable).
  - `waitlist_touchpoints`: `id` (UUID PK), `waitlist_user_id` (FK), `anon_id`, `ts`, `url`, `referrer`, `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`, `ref`.
  - `referral_codes`: `code` (unique), `owner_waitlist_user_id` (FK **nullable**), `creator_handle` (TEXT nullable), `type` (enum: share/premium), `active` (bool). CHECK constraint: exactly one of `owner_waitlist_user_id` or `creator_handle` is non-null. Waitlist-user codes (regular referral, premium invite) set `owner_waitlist_user_id`; external creator codes set `creator_handle` with `owner_waitlist_user_id = NULL`.
  - `referrals`: `id` (UUID PK), `referrer_user_id` (FK), `referred_user_id` (FK, UNIQUE), `referral_code`.
  - `email_jobs`: `id` (UUID PK), `user_id` (FK), `template` (enum), `scheduled_at`, `sent_at` (nullable), `status` (pending/sent/skipped).
  - `auth_tokens`: `token` (UUID PK), `waitlist_user_id` (FK), `created_at`, `expires_at` (15 minutes), `used_at` (nullable). Single-use magic-link credential — distinct from `waitlist_tokens` (wave admission grants).
  Fresh schema == migrated schema. — ✅ H5 FIXED. `schema_migrations` ledger + checksums added; `0001` restored to immutable form with its edits moved to `0002`; enforcer now replays the original migration set forward and proves tampering is rejected. All five properties green on Postgres 16. **APPLIED TO THE PORTAL RDS 2026-07-25** — all 22 migrations, via a VPC-attached migrate Lambda built for the purpose, because a static-export repo cannot run its own migrations and the RDS is `PubliclyAccessible:false`. `schema_migrations` now holds 29 rows (the portal's 7 plus M11's 22). Idempotency verified in production: a second invocation applied 0. This is the half of the schema enforcer that could never run locally → Journal Entries 9, 51
  **✅ EARNED 2026-07-25:** both halves now green — the local enforcer (idempotent, safe over data, fresh==historic, tamper detected) and the deployed half (22 migrations applied to `cello_portal`; a second invocation applied 0).

- **DOD-TRACKING-1** [corp-cello-site] — localStorage tracking script deployed on every page of corp-cello-site:
  - Generates and persists `wl_anon_id` (UUID) on first visit.
  - Captures UTM params + `ref` code on every page load with meaningful signal. Appends to `wl_touchpoints[]`. De-duplicates identical consecutive entries. Caps at 20 entries.
  - Sets `wl_user_id` in localStorage post-signup.
  Verified: open the landing page in an incognito window, check localStorage for `wl_anon_id` and `wl_touchpoints`. Visit again with `?utm_source=test` — a new touchpoint is appended. Visit again immediately with the same params — no duplicate. — 🟡 **the "deployed on every page" clause is now PROVEN on the live site (2026-07-25)**: mounted in `app/providers.tsx`, and a fetch of all 12 deployed routes confirms each loads a chunk containing `wl_anon_id` — home, waitlist, status, survey, invite, confirm, gallery, pricing, about, security, how-it-works, contact. Owed: only the BEHAVIOURAL clauses, which need a browser — anon-id persistence, touchpoint append, de-dup, the 20 cap. Unit-tested, never executed in a browser → Journal Entry 6

- **DOD-SIGNUP-1** [corp-cello-site] — signup endpoint accepts `{email, anon_id, touchpoints[]}`. Inserts `waitlist_users`, bulk-inserts `waitlist_touchpoints`, derives first/last touch, generates `referral_code` in `referral_codes` (`owner_waitlist_user_id` set, `creator_handle = NULL`, `type = 'share'`), enqueues E1 email within 60 seconds. If a `ref=CODE` touchpoint exists and the code is valid + active: (a) if `owner_waitlist_user_id` is set → inserts into `referrals`, enqueues +10 point job for referrer (cap enforced); (b) if `creator_handle` is set → inserts into `creator_tracking` (`event_type = 'signup'`, `creator_handle` from the code row), no points awarded. If the code has `type = 'premium'`, marks the new user as premium-referred and skips queue. Duplicate email returns a clear error (not a server 500). — 🟡 **PROVEN LIVE 2026-07-25** against `api.cello.mygentic.ai/waitlist/signup`: a real signup returns `{success, waitlist_id, referral_code}`; a second with the same address returns **409 `email_already_registered`, not a 500**; a signup carrying a valid `ref` returns `{applied:true, kind:'share', points_awarded:10}`; and an unknown code returns `{applied:false, reason:'unknown_code'}` — it refuses rather than fabricating attribution. The earlier note said a VPC-attached deploy and API Gateway route were owed; both have existed since the stack went up. Owed: the premium-code branch, which needs a premium code to exist → Journal Entry 10

- **DOD-AUTH-1** [corp-cello-site] — auth + session flows live in corp-cello-site (new routes, same repo and design system — no separate deployment). **Existing:** `app/confirm/ConfirmContent.tsx` already handles the E1 token-verify flow (GET `?token=`, success/expired/invalid states). **Borrow from cello-portal** (read-only source): `src/server/magic-link.ts` (single-use token, `FOR UPDATE SKIP LOCKED`, rate-limiting, no-enumeration pattern), `src/server/session-cookie.ts` (HttpOnly cookie, Secure/SameSite), `src/server/session.ts` (session CRUD), `src/server/email.ts` (SES via task role, HTML template pattern). The status-site variant is simpler: the directory lookup in `requestMagicLink` is replaced by a `waitlist_users` email lookup; everything else copies verbatim. **P0 remaining work:**
  1. **E1 upgrade:** update `/confirm` to also set `email_verified = true` in the new Postgres DB, issue a 30-day HttpOnly session cookie, and redirect to `/status` on success.
  2. **`/auth` page (new):** email input. If email not in `waitlist_users` → redirect to `/waitlist` with message "We don't have this email on the waitlist." If found → send magic link (new `auth_tokens` row, 15-min expiry, single-use), show "Check your inbox." No indication of whether the email was found (prevents enumeration).
  3. **Session guard:** unauthenticated visits to `/status` redirect to `/auth`. Sessions expire after 30 days of issue; expiry redirects to `/auth`.
  Verified: (a) click E1 link → land on `/status` with session; (b) visit `/auth` with unknown email → `/waitlist` redirect; (c) visit `/auth` with known email → magic link arrives, clicking creates session; (d) re-use the same magic link → rejected. — 🟡 request/verify/session/logout routes, hashed 30-day sessions, 15-min single-use magic links, atomic burn, and a status gate so a banned account cannot act on a live cookie. 25 tests. **Owed and load-bearing: the `api.cello.mygentic.ai` custom domain** — without it the cookie is cross-site and no user can stay signed in → Journal Entries 14, 23
  **Live evidence 2026-07-25** (still 🟡 — the click-through needs a real inbox): against the deployed `api.cello.mygentic.ai`, a known and an unknown address return byte-identical status and body (`200 {"status": "check_your_inbox", …}`), and four warm samples each land in the same band (1.41–1.47s vs 1.47–1.49s) — the response floor holds in production, not just in tests. `GET /auth/session` without a cookie returns 401. The first cold sample was 2.3s and is a Lambda cold start, not a timing channel; two samples would have been enough to conclude wrongly.
  **2026-07-27 — THE LOOP WAS BROKEN AT THE CHECK, AND IS FIXED IN CODE ONLY.** Clause (a) — click
  the E1 link, land on `/status` with a session — never worked in production. API Gateway payload
  format 2.0 puts request cookies in a top-level `cookies` list, not in `headers`, and
  `cookie_from()` read the header: `read_session` returned None on every real request, so
  `/auth/session` 401'd every signed-in user and `/status` bounced them to `/auth`. Both doors led
  back to the sign-in form. Reproduced as 9 red tests by fixing the fixtures to the real 2.0 event
  shape, then fixed; 456 pass. Verify failures now render a PAGE with a one-click resend rather than
  the API's JSON envelope. **Still 🟡 and must not be flipped on test evidence** — infra is
  hibernated and none of it has run against the deployed API → Journal 2026-07-27

  **A second review pass found two of the first pass's thirteen fixes did not hold** — the
  credential classifier was unreachable code under a comment claiming it worked, and `/auth/request`
  still recorded refusals so the shared rate-limit window could still be pinned by a third party.
  Both fixed and covered; a premium invite also no longer admits an unconfirmed address. 470 tests.
  Still 🟡 → Journal 2026-07-27 (second review)

  **A third pass found three more, all caught by executing rather than reading.** The premium
  admission granted nothing and made the wave cohort that would have granted it unreachable
  (M11-D32); the one-job guard was read-then-write and racy; and the guard's only test never
  reached the branch it named. 472 tests. Still 🟡 → Journal 2026-07-27 (third review)

  **A fourth pass verified the loop works end to end by execution** — signup → E1 → confirm →
  logged-in `/status` with a real queue position and referral link, and the premium path through to
  the Telegram gate burning its token. It also found the round-3 fix was inverted against the
  dispatcher it was written to mirror, and that two clauses with long defending comments had no
  test that failed when the clause was removed. Every behavioural clause is now mutation-verified.
  477 tests. **Still 🟡 — nothing has run against AWS** → Journal 2026-07-27 (fourth review)

  **A mutation sweep replaced a fifth review pass** — 29 mutations over the loop's load-bearing
  clauses, 24 killed, two real gaps closed: the two guards against double-paying a referrer were
  masking each other so neither was individually tested, and `attempts < MAX_ATTEMPTS` had no
  coverage. Kept at `infra/scripts/mutation-sweep.py`. 481 tests, still 🟡
  → Journal 2026-07-28

  **The pages themselves now have render coverage** — 13 component tests over the six screens the
  front door chooses between and the just-confirmed state, each mutation-verified. That closes the
  last thing checkable without AWS; everything still open on this line is a question about the
  deployed system. 481 Python + 34 site tests, still 🟡 → Journal 2026-07-28 (later)

  **2026-07-27 (later) — the rest of the agreed flow, also code-only.** `/waitlist` is now the front
  door: it detects a live session and offers `/status` instead of a signup form, and one field decides
  whether the server sends a confirm mail, a sign-in link, or nothing (suppressed) — the 409 that
  dead-ended the most likely re-entry path is gone. A dead link renders a PAGE with a one-click
  resend that never asks for the address again. The referrer is paid at CONFIRMATION, not at signup,
  so an unverified address cannot move anyone up the queue. Confirming carries `?welcome=1` so the
  click that makes you a member says so. 460 tests; corp-cello-site green. All 🟡 → Journal 2026-07-27

  **PARKED — the returning-visitor hint cookie.** Andre asked for a non-HttpOnly "this browser has
  been here" marker so `/waitlist` could choose its copy before any network call. Not built: the
  session probe added above already answers the same question AUTHORITATIVELY, and the hint's only
  remaining value is avoiding a brief flash of the signup form. A second, forgeable signal that can
  disagree with the real one is not worth that. Revisit only if the flash is judged bad enough to
  matter.

- **DOD-STATUS-STUB-1** [corp-cello-site] — P0 stub `/status` page (authenticated, session-gated). Shows: confirmation they're on the waitlist, their queue position (live computed), their personal referral link with a copy button. No survey, no OAuth buttons, no points breakdown — those are P1 (DOD-STATUS-PAGE-1 replaces this stub). Corp site branding. — 🟡 `/status` + `/auth` built as static pages calling the auth Lambda; both emit to `out/`; position rendered only when the server returns one. Owed: a live run against the deployed API → Journal Entry 15

- **DOD-EMAIL-INFRA-1** [trustless-cello, corp-cello-site] — SES + Lambda email pipeline. **Existing:** SES domain verification and DKIM/DMARC are already live (Lambda at `h8dh7rbhb1.execute-api.us-east-1.amazonaws.com` is in production sending E1 today). **P0 remaining work:** (a) confirm SES production access is already granted (not sandbox); (b) wire the new `email_jobs` table → SQS → Lambda → SES path (the existing Lambda is not driven by `email_jobs` — it responds to direct API calls; this replaces that pattern); (c) add bounce + complaint SNS handling if not already present. Lambda code + CloudFormation (SQS queue, SNS topic, EventBridge rule) in trustless-cello. The `email_jobs` table + enqueue calls in corp-cello-site. If SES prod access is confirmed and DKIM/DMARC are set, the domain-verification AC is ✅ as-is. — ✅ dispatcher Lambda built (`infra/lambda/waitlist-email/`) draining `email_jobs` with suppression + segment enforcement, 14 tests green. CFN deployed to us-east-1 2026-07-25 (EventBridge drain rule, VPC attach to the PORTAL db, SNS topic with an SES configuration set publishing to it) and all 12 function bodies with it. SES production access CONFIRMED — see DOD-SES-PROD-1. The first real send then found a defect no unit test could see: the dispatcher passed `Headers=` to an SES API that has no such parameter, so EVERY send raised ParamValidationError; fixed by building a MIME message and using `send_raw_email` (Entry 52). Owed: the corrected send actually landing → Journal Entries 12, 40, 44, 52
  **✅ EARNED 2026-07-25:** the email_jobs → Lambda → SES path sent a real message ({"sent": 1}) after the ParamValidationError fix, and the bounce/complaint SNS path fired for real.

- **DOD-E1-1** [trustless-cello] — E1 (confirmation) email template updated. **Existing:** E1 confirmation email already sends via the current Lambda (24-hour token link, confirm-your-spot body). **P0 remaining work:** update the template to include (a) queue position (computed from new DB), (b) personal referral link, (c) a one-sentence "how waves work" note, (d) update the verify link to point to `/confirm` on the new auth path (which issues a session on click). Old 24-hour token window → new 15-minute `auth_tokens` window for the magic-link re-access flow; the E1 link itself can remain longer-lived (24-hour is fine for initial verify). Sent within 60 seconds of signup. — 🟡 template carries real queue position, referral link and the waves sentence; 24h `email_verify` token minted at send time (`0005` kind-aware CHECK). **The email enforcer RAN 2026-07-25**: `cello-waitlist-email-dev` invoked live drained the queue and reported `{sent:1, skipped:0, failed:0, retired:0}` — a real `send_raw_email` through the configuration set, for a signup created minutes earlier. Owed: nothing on this line but reading the delivered message, which needs a mailbox we do not have → Journal Entry 12

- **DOD-QUEUE-VIEW-1** [corp-cello-site] — `queue_position` is a computed SQL view (never a stored column). Uses `RANK()` over `points_total DESC, created_at ASC` where `status = 'waiting'`. Verified: insert two users with different points; confirm position 1 is the higher-points user; insert a third between them on points; confirm positions shift. — 🟡 `waitlist_queue` view in `0004`; 7 tests green on real Postgres incl. a ledger-insert-moves-position test and an assertion that no stored column exists. **APPLIED TO THE PORTAL RDS 2026-07-25** — these tables are in the 22-migration set the migrate Lambda applied to `cello_portal`; a second invocation applied 0, so the ledger agrees. The constraint behaviour is proven on identical DDL locally by the 11 SQL-level tests → Journal Entry 11

- **DOD-SES-PROD-1** [trustless-cello] — SES production access granted by AWS. Sending limits confirmed in console. Bounce + complaint handling: SNS topic → Lambda → marks `email_status = 'bounced'` or `email_status = 'complained'` on `waitlist_users`. Bounced/complained users receive no further emails. Verified: send to an SES simulator bounce address; confirm the user's email_status is updated within 2 minutes. — ✅ bounce/complaint handler built (`infra/lambda/waitlist-bounce/`), 11 tests incl. transient-not-suppressed and one-way suppression; end-to-end test proves a bounced address then receives nothing. SNS topic, topic policy, subscription, Lambda permission, SES configuration set and its bounce/complaint/reject/renderingFailure event destination are all in `cello-waitlist.yaml`, ordered after the topic policy so a first deploy cannot lose the publish-permission race (Entries 40, 44). **SES production access CONFIRMED 2026-07-25**: `aws sesv2 get-account` → `ProductionAccessEnabled: true`, quota 50,000/24h, `EnforcementStatus: HEALTHY`. That was the item that could not be answered by reading the repo, and it gated six lines. Owed: the simulator run for the bounce path → Journal Entries 13, 40, 44, 51
  **✅ EARNED 2026-07-25:** production access read from get-account (true, 50k/day, HEALTHY) AND the simulator run completed end to end: bounce@simulator → SES → configuration set → SNS → bounce Lambda → email_status='bounced', logged against the exact waitlist_id that signed up. **COMPLAINT proven too** (2026-07-25 07:33): complaint@simulator → `email_status='complained'` on its own signup — the half that had not been exercised when this was first flipped, and the reason a partial pass tagged ✅ is worth re-checking.

---

## P1 — Priority Engine (needs P0)

- **DOD-SCHEMA-P1-1** [corp-cello-site] — migrations for all P1 tables deployed and idempotent:
  - `points_ledger`: `id` (UUID PK), `waitlist_user_id` (FK), `points` (signed int), `reason` (enum: survey/technical_readiness/share_conversion/public_post/interview_commit), `meta` (JSONB), `created_at`. Insert trigger updates `waitlist_users.points_total`. Cap enforcement at insert: for capped actions, the sum of existing rows for that reason plus the new `points` may not exceed the cap; overflow inserts are rejected with a named error.
  - `waitlist_social_profiles`: `id` (UUID PK), `waitlist_user_id` (FK), `platform` (enum: x/reddit/linkedin), `handle`, `oauth_access_token` (encrypted). UNIQUE on `(platform, handle)`.
  - `post_review_queue`: `id` (UUID PK), `waitlist_user_id` (FK), `platform`, `post_url`, `submitted_at`, `reviewed_at` (nullable), `outcome` (nullable enum: approved/rejected).
  — ✅ `points_ledger` + cap trigger in `0003` (M11-D23), social profiles + review queue in `0008`; 11 SQL-level constraint tests green. Owed: portal RDS (M11-D22) → Journal Entry 16
  **✅ EARNED 2026-07-25:** deployed half done — the migrations are applied to `cello_portal` and the ledger confirms it; the local enforcer proves fresh==migrated on identical DDL.

- **DOD-SURVEY-1** [corp-cello-site] — survey page (linked from status page and E2 email). Staged form: completes in one submit. Questions per M11-D15: (1) What would you use CELLO for? (multi-choice), (2) How many agents do you run? (0 / 1-2 / 3-9 / 10+), (3) What platforms? (multi-select). +20 for structured questions. Free-form "How do you imagine using this?" +10. Interview commit checkbox +30. `POST /waitlist/survey` inserts rows in `points_ledger` accordingly. Idempotent — a second submit is a no-op per reason (cap enforcement at DB). Verified: complete survey twice; `points_total` increases by the correct total only once, not doubled. — 🟡 endpoint + `/survey` page (M11-D15 questions); +20/+10, answers stored, late free-form still paid, idempotency at the DB. Owed: a live run → Journal Entries 17, 29

- **DOD-READINESS-1** [corp-cello-site] — technical readiness action: `POST /waitlist/readiness`. +20 points. Idempotent. The frontend prompt is: "Star the repo on GitHub and run `npx @cello-protocol/connect` once." The endpoint requires neither — the stars and the `npm install` event are not yet verifiable programmatically; this is an honor system +20 for now. (Post-v1: wire to GitHub star webhook + npm install event.) Verified: call the endpoint twice; points increase by exactly 20, not 40. — 🟡 `/waitlist/readiness`; ten repeats award once, tested → Journal Entry 17

- **DOD-OAUTH-SOCIAL-1** [corp-cello-site] — OAuth flows for X, Reddit, LinkedIn. On completion: write to `waitlist_social_profiles`. Enforce `(platform, handle)` uniqueness — duplicate returns a user-facing error explaining the handle is already registered. Token encrypted at rest. Verified: connect two different waitlist accounts to the same X handle; the second attempt fails with a clear message. — 🅿️ PARKED — blocked on OAuth app registration with three external platforms, which only Andre can do. The DB half is done and tested (`0008` uniqueness, both directions); `/waitlist/post-url` already refuses a platform the user has not connected → Parked section

- **DOD-POST-CREDIT-1** [corp-cello-site] — `POST /waitlist/post-url` writes to `post_review_queue` (status: pending). Credit is NOT awarded immediately. A `platform` field is required; post URL must at least be parseable for the correct domain (x.com, reddit.com, linkedin.com). Verified: submit a URL; `post_review_queue` gains a row with `reviewed_at = NULL`. — 🟡 `/waitlist/post-url`; platform derived from host, unrecognised hosts REFUSED, and a post for an unconnected platform rejected 403 → Journal Entry 17

- **DOD-INTERVIEW-COMMIT-1** [corp-cello-site] — `POST /waitlist/interview-commit` awards +30 points (per M11-D15). Idempotent. Records a `meta: {committed_at: iso8601}` in the ledger row. Verified: call twice; points increase by exactly 30, not 60. — 🟡 `/waitlist/interview-commit`; `committed_at` recorded in `meta` → Journal Entry 17

- **DOD-STATUS-PAGE-1** [corp-cello-site] — authenticated status page (email-verified session). Shows: queue position (live computed), qualitative band ("top 10%", "top 25%", "top half") + explanation that waves are sized dynamically (per M11-D16 — no predicted wave number), points total, points breakdown by action (with cap indicators), survey link (if not completed), referral link with share button, OAuth connect buttons for X/Reddit/LinkedIn, post URL submission field (for platforms where OAuth is connected), content alert opt-in checkbox (unchecked by default). No fabricated queue estimates. — 🟡 `/status` rebuilt: position, band, points breakdown carrying the DB's real caps, survey link, referral copy, alert opt-in. Owed: OAuth buttons and the post field (blocked on the parked OAuth line) and a live run → Journal Entry 29

- **DOD-CONTENT-ALERTS-1** [corp-cello-site] — content alert opt-in: checkbox on status page, unchecked by default. Label: *"Notify me when new articles, demos, or posts are published. (During launch this may arrive up to twice a day — unsubscribe anytime.)"* Sets `content_alerts = true` in `waitlist_users`. Unsubscribe link in every E-alert email sets `content_alerts = false` in one click, no other action. Verified: opt in, check DB, unsubscribe via link, check DB again. — 🟡 checkbox + `POST /waitlist/content-alerts` + the scoped one-click `GET /waitlist/unsubscribe?list=content_alerts`; tested that either path leaves `email_status` untouched. Owed: a live run → Journal Entries 29, 30

- **DOD-EMAIL-DRIP-1** [trustless-cello, corp-cello-site] — drip pipeline: EventBridge cron polling `email_jobs` every minute via Lambda (in trustless-cello). Enqueue calls at signup in corp-cello-site.
  - E2 (+1 day after signup): enqueued at signup with `scheduled_at = created_at + 1 day`. Body: survey link, share link, readiness checklist.
  - E3 (every 2 weeks while `status = 'waiting'`): sent to base list only (`content_alerts` flag irrelevant). Body: build-log update + wave movement note. First E3 is enqueued at signup; each send enqueues the next.
  Verified: set `scheduled_at` to now on a test E2 job; confirm Lambda fires and SES delivers within 2 minutes. — 🟡 whole drip enqueued at signup (E1 now, E2 +1d, first E3 +14d); E3 chains its own successor and the chain ends on admission or suppression; 5 tests. Owed: the EventBridge rule and the email enforcer → Journal Entry 39

- **DOD-UTM-TOOL-1** [ops-dashboard, corp-cello-site] — UTM link generator (UI in ops dashboard per DOD-OPS-UTM-1; this line defines the data model and endpoint format). Inputs: base URL, channel, campaign slug, optional creator `ref`. Output: fully tagged URL with `utm_source`, `utm_medium`, `utm_campaign`, `utm_content` (optional), `ref`. When a creator handle is provided, creates/upserts a row in `referral_codes` (`creator_handle` set, `owner_waitlist_user_id = NULL`, `active = true`). Every piece of outbound content uses a link from this tool. — ✅ `infra/lambda/waitlist-utm/`: generating the link and minting the creator code are one call, code derived deterministically from the handle so regeneration reuses it; 14 tests incl. an end-to-end run of a generated link through the real signup handler. Ops-dashboard UI shipped, with the base-URL and content inputs the action already accepted but the form never offered (Entries 41, 44). Owed: a live run → Journal Entry 31
  **✅ EARNED 2026-07-25:** proven end to end against the deployed function and API. `{"channel":"x","campaign":"launch","creator_handle":"auditjournalist","content":"hero"}` → `https://cello.mygentic.ai/?utm_source=x&utm_medium=referral&utm_campaign=launch&utm_content=hero&ref=KGWDL2S2E9`, carrying every tag the line names. Idempotent: a second call with the same handle and a different campaign returned the SAME `ref`, so a creator does not accumulate codes. Then a real signup carrying that ref returned `{"referral": {"applied": true, "kind": "creator", "creator_handle": "auditjournalist"}}` — the attribution half, which can only resolve if the `referral_codes` row exists with `creator_handle` set.

---

## P2 — Admission & Invites (needs P1; Wave 1 can run manually before P2 is complete)

- **DOD-SCHEMA-P2-1** [corp-cello-site] — migrations for all P2 tables deployed and idempotent:
  - `waitlist_tokens`: `token` (UUID PK), `waitlist_user_id` (FK), `created_at`, `expires_at`, `used_at` (nullable).
  - `telegram_accounts`: `telegram_id` (TEXT PK), `waitlist_user_id` (FK, nullable), `source` (enum: waitlist_token/ops_override), `linked_at`.
  - `waitlist_agent_links`: `agent_pubkey` (TEXT PK), `waitlist_user_id` (FK), `linked_at`.
  - `creator_tracking`: `id` (UUID PK), `creator_handle`, `event_type` (enum: visit/signup/activation), `session_id`, `created_at`.
  - `waves`: `wave_number` (PK), `capacity`, `priority_pct`, `zero_pct`, `opened_at`, `opened_by`.
  — ✅ all five tables in `0013`, plus a split-within-capacity CHECK, one-live-grant-per-user, and telegram source consistency. Owed: portal RDS → Journal Entry 21
  **✅ EARNED 2026-07-25:** deployed half done — the migrations are applied to `cello_portal` and the ledger confirms it; the local enforcer proves fresh==migrated on identical DDL.

- **DOD-WAVE-ASSEMBLY-1** [ops-dashboard] — wave assembly logic (called only from ops dashboard, never automated):
  - Premium invitees fill the front of capacity first.
  - ~75% of remaining capacity → highest `points_total`, tie-broken by `created_at ASC`.
  - ~25% of remaining capacity → `points_total = 0` users by `created_at ASC`.
  - Sets `status = 'admitted'`, `admitted_at = NOW()`, `wave_number` on affected rows.
  - Mints one `waitlist_token` per admitted user (UUID, `expires_at = NOW() + 14 days`, `used_at = NULL`).
  - Inserts a row into `waves`.
  - Enqueues E-inv email for each admitted user.
  Verified: seed 10 users with varying points; run assembly for capacity 4; confirm the right 4 are admitted and each has a token. — 🟡 `infra/lambda/waitlist-waves/`; 27 tests incl. cohort ordering, one-token-per-user, and every capacity 1–7 admitting exactly that many. Ops dashboard calls it (Entry 41). Owed: a live run → Journal Entry 21

- **DOD-E-INV-1** [trustless-cello] — E-inv (wave admission) email: sent within 60 seconds of wave assembly. Body: install command, the user's single-use waitlist token, 14-day claim window. **Wave 1 variant** includes a calendar link for scheduling the mandatory 30-minute onboarding call. **Wave 2+ variant** includes a quickstart link instead. The wave number is passed to the email template and determines which variant renders. Under 200 words. Verified: trigger wave assembly for one user; confirm E-inv arrives within 60 seconds containing the correct token and the correct variant content. — 🟡 both variants render off `wave_number`; install command present (was missing); refuses to render without a live grant; word count asserted. Owed: the email enforcer (real SES send) and the EventBridge rule that makes "within 60 seconds" mean anything → Journal Entries 22, 27

- **DOD-TELEGRAM-GATE-1** [trustless-cello] — Telegram bot gate logic updated:
  1. Is `telegram_id` in `telegram_accounts`? Yes → proceed as normal.
  2. No → ask for waitlist token.
  3. Validate: token exists + `used_at IS NULL` + `expires_at > NOW()`. Fail on any condition with a named error message.
  4. On success: set `used_at = NOW()`, insert `telegram_accounts` (`source = 'waitlist_token'`), insert `waitlist_agent_links` (`agent_pubkey`, `waitlist_user_id`). Proceed to DKG.
  Live end-to-end enforcer: burn a real token on a test Telegram account; confirm DKG proceeds; confirm `used_at` is set; confirm a second burn attempt fails. — 🟡 `infra/lambda/waitlist-gate/`; atomic burn with a two-thread test proving one winner, four named refusals, and the agent bridge asserted PII-free. **The ops-agent call site is LIVE (2026-07-25)** — `cello-operations-agent-dev` running the image built from `e4b2c09`, which carries the gate and all seven review fixes; IAM confirmed on the live role (`InvokeWaitlistGate`, that one function and nothing else). **The gate Lambda is verified live by direct invoke**: unknown account → `token_required`, missing id → `missing_telegram_id`, bad token → `token_malformed`, each a well-formed decision (200 + boolean `allowed`), which is exactly the contract the client now requires. **Clause 4 is PARTIAL** — the `waitlist_agent_links` insert has no caller that can supply an `agent_pubkey` (see the parked fork *ONE FORK, THREE FACES*). Owed: the live end-to-end enforcer — burning a REAL token on a REAL Telegram account, which needs an admitted user, which needs the ops dashboard for DB visibility → Journal Entries 24, 49

- **DOD-FIRST-WIN-1** [trustless-cello] — first-win event detection. Fires when a session seals for the first time for this `waitlist_user_id` (globally — not per-agent). Trigger: session seal event from the daemon → lookup `waitlist_agent_links` by `agent_pubkey` → if `waitlist_users.first_win_at IS NULL` for the linked user, this is the first win.
  On first win:
  - Issue 3 premium invite codes (new rows in `referral_codes` with `owner_waitlist_user_id` set, `type = 'premium'`, `active = true`).
  - Set `first_win_at = NOW()` on `waitlist_users`.
  - Enqueue E-win email.
  Idempotent: a second sealed session for the same user changes nothing. Verified: simulate two seal events for the same user; confirm 3 invite codes exist, `first_win_at` is set once, and only one E-win email is enqueued. — 🟡 `infra/lambda/waitlist-firstwin/`; atomic conditional claim, 13 tests incl. a two-thread race and ten replays, revert-tested against check-then-act (which mints six codes). Owed: the seal-event call site in the daemon, and the live enforcer → Journal Entry 25
  **Note:** The mutual-connection reward (inviter + invitee auto-added to each other's address book when an invitee reaches first win) is a portal/client coordination item, not purely waitlist plumbing. It is tracked as a dependency here but designed and implemented in the portal/client work stream.

- **DOD-E-WIN-1** [trustless-cello] — E-win email template: subject, body. Contains: the 3 invite codes, a testimonial ask, a "share your first session" prompt (link to gallery if the session is shareable). Under 300 words. — 🟡 every code rendered as a usable `/invite/CODE` link; gallery prompt present and states the receipt is private by default (was missing); refuses to render with none; word count asserted. Owed: the email enforcer → Journal Entries 22, 27

- **DOD-FEEDBACK-DETECTION-1** [trustless-cello] — §5c high-activity detection Lambda on EventBridge daily schedule:
  - Thresholds: `≥5 sealed sessions within 14 days of admitted_at`, OR `≥1 cross-operator session within 14 days`.
  - Writes `feedback_eligible = true`, `feedback_eligible_date = NOW()` where not already set. Idempotent.
  - Verified: seed session telemetry crossing the threshold; run Lambda manually; confirm `feedback_eligible = true` and `feedback_eligible_date` set. Idempotency: run again; no change to existing rows. — 🟡 `infra/lambda/waitlist-feedback/` + `session_telemetry` in `0017` (metadata only); 17 tests incl. both thresholds, the 14-day window, redelivery, and multi-agent aggregation. EventBridge schedule now exists (`FeedbackSweepSchedule`, daily, in `cello-waitlist.yaml` — Entry 40). Owed: the daemon writing session telemetry, which is cello-client work → Journal Entries 26, 40

- **DOD-FEEDBACK-OUTREACH-1** [trustless-cello, ops-dashboard] — outreach sequence automation:
  - Day 0 (same day `feedback_eligible` is set): enqueue a `CELLO_FEEDBACK` session initiation event AND an SES email (under 150 words, calendar link). `email_jobs` with `scheduled_at = NOW()`. Lambda in trustless-cello.
  - Day 6, no response: auto-grant 2 premium invite codes; set a status-page note.
  - "Call completed" action in ops dashboard: grant 4 invites (if 2 already issued, grant 2 more).
  Verified: set `feedback_eligible = true` on a test user; confirm both same-day items are enqueued. — 🟠 `infra/lambda/waitlist-outreach/`: Day-0 email enqueued by the detection sweep, Day-6 grants 2, call-completed tops up TO 4; 18 tests. Day-6 status-page note added (Entry 42) — though the first version WROTE it and nothing READ it, so the clause was not actually met until the session endpoint and `/status` gained a reader (Entry 48). EventBridge schedule in `cello-waitlist.yaml`, and the ops-dashboard button shipped (Entry 41). Owed: the `CELLO_FEEDBACK` session initiation — the Day-0 half that dogfoods the product → Journal Entries 28, 41, 42

- **DOD-E-RE-1** [trustless-cello] — re-engagement email (E-re): scheduled 60 days after `created_at` for users still `status = 'waiting'` with no activity in 30 days. Body: brief update + explicit "no hard feelings" unsubscribe path (one click, permanent, sets `email_status = 'unsubscribed'`). — 🟡 template + a prefetch-safe endpoint (GET confirms, POST acts) with RFC 8058 headers so real clients keep true one-click. 60-day sweep + daily EventBridge rule added (Entry 43); bounded per run and with the inert `waitlist_touchpoints` activity clause removed after review showed it could never fire (Entry 48). **Known gap, stated rather than hidden:** a user who visits the site daily but never signs in and never earns a point will still receive this email, because nothing writes a touchpoint after signup. Closing it needs a post-signup pageview writer. Owed: only the live SES send → Journal Entries 22, 30, 38, 43

- **DOD-OPS-SHELL-1** [ops-dashboard] — ops dashboard repo created and deployed at `operations.cello.mygentic.ai`. New repo (cello-portal clone — copy the repo as the starting point; do NOT modify cello-portal itself). **Borrow from cello-portal verbatim:** `src/server/magic-link.ts`, `src/server/session-cookie.ts`, `src/server/session.ts`, `src/server/session-request.ts`, `src/server/email.ts`, `src/server/db.ts`, `src/server/config.ts`, `src/server/logger.ts`, the full `src/app/api/auth/magic-link/` route tree, `migrations/0001_init.sql` (accounts + sessions) and `migrations/0002_magic_link_requests.sql`. Strip: WebAuthn, TOTP, trust signals, directory client, agents — none of that belongs here. **Auth change from portal:** instead of directory-gated entry (resolves email against CELLO directory), the ops dashboard resolves against a static allowlist from AWS Secrets Manager key `cello/ops/allowed-emails` (JSON array). Magic link to an unknown email → silent rejection (same no-enumeration shape). Verified: log in with an allowed email, confirm magic link arrives, land on an empty dashboard shell. — 🟡 scaffolded at `/Users/andrep/Documents/code/ops-dashboard`: allowlist (fails closed 5 ways, 11 tests), 8-hour sessions re-checked against the allowlist per request, operator magic links in their own table, and a Lambda invoker holding no waitlist logic. Pages, magic-link route tree and sign-in shipped (Entry 41); the no-enumeration hole a review found in that first pass is closed and revert-tested (Entry 42): send is fire-and-forget, the request throttle fires before the allowlist, and the token is stored hashed. 60 tests. **The line used to say the only thing owed was the remote and a deploy. That was wrong — `npm run build` FAILED, and had never once been run** (2026-07-25): `config.ts` and `db.ts` throw at module load on a missing `OPS_PUBLIC_URL` / `DATABASE_URL`, and `next build` imports every route module to collect page data, so a CI image build died on `/api/auth/magic-link` and then `/api/auth/sign-out`. Fixed by separating *build* from *boot*: the values stand in during a production build, and the boot assertion moved to `instrumentation.ts` — with `experimental.instrumentationHook` enabled, without which Next 14 never calls it and the assertion is dead code. It builds now, all 9 routes, and a Dockerfile exists whose image was BUILT AND RUN: with no environment it exits 1 naming the missing variable, with the environment set it serves `/sign-in` 200. `infra/cloudformation/cello-ops-dashboard.yaml` + a `DEPLOY_OPS_DASHBOARD=1` step in deploy.sh cover ECR, the certificate, the task, the service, a host rule on the **existing portal ALB** (a dedicated one is ~$16/month for a dashboard one person opens a few times a day), its own security group, the portal-DB ingress rule and the DNS record — template validated and every import checked against the live account. **DEPLOYED AND SERVING (2026-07-25).** `operations.cello.mygentic.ai` — stack CREATE_COMPLETE, ECS 1/1, `/sign-in` 200 over HTTPS, image built by CI and pushed via OIDC (never from a laptop), sharing the portal ALB via a host rule so no second load balancer exists. Its four `ops_*` migrations applied themselves to `cello_portal` at boot. The allowlist secret is created by `cello-secrets.yaml` with a placeholder and set out-of-band. A live magic-link request for an allowed address is accepted and sent; an unknown address gets the identical 202. **Andre signed in successfully (2026-07-25)** — the magic link arrived, was redeemed, and the dashboard loaded. That closes the DoD's own stated verification (*"log in with an allowed email, confirm magic link arrives, land on a dashboard shell"*) and it is the one clause no agent could close. Owed: driving the approve/reject server actions, which cannot be done from curl → Journal Entries 36, 41, 42, 50, 51

- **DOD-OPS-POST-REVIEW-1** [ops-dashboard] — ops dashboard post review page. List of pending URLs from `post_review_queue` with Approve/Reject buttons. Approve → inserts +15 to `points_ledger` (cap enforced). Verified: submit a post URL from the status page; confirm it appears in the ops queue; approve it; confirm points credited. — 🟡 `reviewPost` action written: atomic review claim so two operators cannot double-credit, and an at-cap approval keeps the review while logging that no points were awarded. Page shipped (Entry 41). Owed: a live run → Journal Entries 36, 41

- **DOD-OPS-WAVE-MGMT-1** [ops-dashboard] — ops dashboard wave management page. Queue view (position, email, points, status). "Open wave" form: takes a capacity integer plus priority/zero split percentages, runs DOD-WAVE-ASSEMBLY-1 logic, marks users as admitted, mints tokens, enqueues E-inv emails. Verified: seed users; open a wave for capacity 3; confirm the right users are admitted with tokens. — 🟡 `openWave` action invokes the tested assembly Lambda with the operator's email as `opened_by`. Queue view (reading the `waitlist_queue` view, joined on `waitlist_id`) and the open-wave form shipped (Entry 41). Owed: a live run → Journal Entries 36, 41

- **DOD-OPS-FEEDBACK-1** [ops-dashboard] — ops dashboard feedback pipeline page. List of `feedback_eligible = true` users. "Mark call complete" button → grants 4 premium invite codes (if 2 already issued from Day 6 auto-grant, grants 2 more to reach 4 total). Verified: mark a test user's call complete; confirm invite codes issued. — 🟡 `completeFeedbackCall` action invokes the outreach Lambda, which grants TO four rather than plus four. Page shipped (Entry 41). Owed: a live run → Journal Entries 36, 41

- **DOD-OPS-CONTENT-ALERT-1** [ops-dashboard, trustless-cello] — ops dashboard content alert trigger page. Article URL + one-sentence description → enqueues E-alert to all `content_alerts = true` users via Lambda (trustless-cello). Hard limit: blocks a second send within the same calendar day (UTC). Verified: trigger an alert; confirm email enqueued; attempt a second same-day trigger; confirm it's blocked. — 🟡 `triggerContentAlert` enqueues only to opted-in, non-suppressed users and blocks a second same-day send by COUNTING what was enqueued (UTC) rather than trusting a flag. Page shipped (Entry 41). Owed: a live run → Journal Entries 36, 41

- **DOD-OPS-TELEGRAM-1** [ops-dashboard] — ops dashboard Telegram accounts page. Add a `telegram_id` with `source = ops_override` (staff bypass); view existing linked accounts. Verified: add a telegram_id; confirm row appears in `telegram_accounts` with `source = 'ops_override'` and `waitlist_user_id = NULL`. — 🟡 `addStaffTelegram` action written, logging at WARN that the account may join without a token. Page shipped (Entry 41). Owed: a live run → Journal Entries 36, 41

- **DOD-OPS-UTM-1** [ops-dashboard] — ops dashboard UTM link generator page. Inputs: base URL, channel, campaign slug, optional creator handle. If a creator handle is provided, the generator creates (or upserts) a row in `referral_codes` (`creator_handle` set, `owner_waitlist_user_id = NULL`, `active = true`) and includes `ref=CODE` in the output URL. Output: fully tagged URL with `utm_source`, `utm_medium`, `utm_campaign`, `utm_content` (optional), and `ref` (when a creator handle is supplied). Verified: generate a link with a creator handle; confirm `referral_codes` gains a row with `creator_handle` set and `owner_waitlist_user_id = NULL`; visit the link and sign up; confirm `creator_tracking` gains a `signup` event row. — 🟡 `generateUtmLink` action invokes the UTM Lambda, whose end-to-end test already proves the signup half. Page shipped (Entry 41). Owed: a live run → Journal Entries 36, 41

- **DOD-E-ALERT-1** [trustless-cello] — content alert email (E-alert): sent only to `content_alerts = true` users. Triggered from ops dashboard. One sentence + link. Under 100 words. Hard limit: the ops dashboard blocks a second E-alert send within the same calendar day (UTC). — 🟡 template done, opt-in filter enforced and tested both ways, unsubscribe scoped to the alert list. Ops trigger + the same-day (UTC) block shipped in the dashboard's Links page (Entry 41); the boundary expression was 12 hours out under a non-UTC session zone and is fixed (Entry 42). Owed: the live SES send → Journal Entries 22, 41, 42

- **DOD-DYNAMIC-ESTIMATOR-1** [corp-cello-site] — per M11-D16, no predicted wave number. Status page shows: real-time queue position, a qualitative band ("top 10%", "top 25%", "top half"), and a short explanation that waves are sized dynamically based on how the previous wave performed. Recalculates on every page load. Never shows a hardcoded wave assignment or estimated date. — 🟡 band computed server-side from the live position and queue size, absent when there is no position; no wave number or date anywhere. Owed: a live run → Journal Entry 29

---

## P3 — Gallery & GEO Infrastructure (can run in parallel with P1/P2)

- **DOD-GALLERY-1** [corp-cello-site] — gallery live at `gallery.cello.mygentic.ai` in corp-cello-site repo. Corp site header + footer, same design system. Corp site nav gains a "Gallery" item linking to the gallery index. No auth required on any gallery page. SSR-rendered (bot-indexable). Robots.txt allows all crawlers on `/gallery/*`. — 🟡 `/gallery` live in corp-cello-site with header, footer, nav item and no auth; robots.txt already allows every crawler on everything. Owed: the `gallery.` subdomain (a DNS + nginx change) and a live run → Journal Entries 32, 33

- **DOD-GALLERY-RECEIPT-1** [corp-cello-site, cello-client] — individual receipt page at `gallery.cello.mygentic.ai/receipt/[hash]`. Shows: both agent monikers, session timestamp, Merkle hash, directory verification status ("Verified by N-of-3 nodes"), message count. Share buttons: copy link, share to X (pre-filled text), share to LinkedIn. The sealed receipt footer on every CELLO session carries `Verified by CELLO — gallery.cello.mygentic.ai/receipt/[hash]`. Receipt page in corp-cello-site; the footer format update is in cello-client. — 🟠 API serves everything the page needs, with verification as two numbers so 2-of-3 cannot round to "verified". Owed: the cello-client sealed-receipt footer, and a live run. Page and share buttons built. **The same base-path defect broke this page too** and is fixed (Entries 61, 62); the receipt page's `404 → ReceiptNotPublished` branch could not run while every call failed upstream of it. **The footer is SEQUENCED, not blocked** (Entry 47): it is a contained change — one `verify_url` field on the `cello_get_sealed_receipt` payload plus its CLI/MCP display — but it must land AFTER `gallery.cello.mygentic.ai` resolves, because until then every sealed session advertises a URL that 404s, on a product whose entire claim is verifiability. The nginx server block already exists in `deploy/cello-site.conf`; what is missing is the DNS record and a site deploy. It also requires a cello-client publish, which reaches operators only when they upgrade → Journal Entries 32, 33, 47

- **DOD-GALLERY-PRIVACY-1** [cello-portal, corp-cello-site] — publishing a receipt is opt-in. Default: sealed receipts are private (no public URL exists). The portal "Share publicly" action (cello-portal) publishes a receipt by writing to the gallery's data store (corp-cello-site). Published receipts are irrevocable (the hash is permanent — no delete UI). The gallery page makes no reference to unpublished receipts. — 🟡 opt-in is structural (an unpublished receipt has no row at all, not a flag) and irrevocability is enforced by the API having no route that can express it — tested. Owed: the portal "Share publicly" action → Journal Entry 32

- **DOD-GALLERY-INDEX-1** [corp-cello-site] — gallery index at `gallery.cello.mygentic.ai/` shows a card grid of published receipts: agent monikers, timestamp, verification badge. Cards link to the receipt page. Supports at least basic pagination (20 per page). — 🟡 card grid + pagination over the real total; an empty gallery says so rather than showing sample cards. **The live run found the page broken and it is now fixed**: the client prefixed the waitlist base to a gallery path, so every call 404'd and the page rendered API Gateway's `"Not Found"` — the empty-state branch had never executed in production. Proven live on `cello.mygentic.ai` (`200 {"receipts": [], "total": 0}`). Owed: the `gallery.` subdomain (DNS), which is the host this line actually names → Journal Entries 32, 33, 61, 62

- **DOD-GALLERY-CONTENT-1** [corp-cello-site] — a published receipt carries the session transcript, and the receipt page renders it. Per M11-D33: `published_receipts` gains a transcript (ordered turns: speaker moniker + body, sequence preserved) and the receipt page shows the exchange below the seal metadata. Content is subject to the same irrevocability as the hash — there is no edit and no delete path. Turn bodies are caller-supplied strings on a public, bot-indexed page, so they are refused at the write on the same terms as monikers, never escaped at the read. A receipt with no transcript renders exactly as it does today rather than showing an empty panel. **Open and deliberately not solved here:** a transcript contains the counterparty's words and one party publishes it — acceptable for the seeded archive because both agents are Andre's, and a blocker for third-party publishing that `DOD-GALLERY-PRIVACY-1`'s portal action must answer before it ships. — ❌

- **DOD-GALLERY-SEED-1** [corp-cello-site] — the build-in-public sessions in `docs/planning/milestone-writeups/live-session-e2e-proofs/` (trustless-cello) that carry a sealed root are published to the gallery, each rendering the seal state it actually had. **Five of the fifteen files qualify** (m4 ×3, m8b, m8c) — measured by extraction, not estimated. Seven have no sealed root because those sessions were never sealed (m0 ×3, m2 ×2, m3 ×2), and `receipt_hash` is the primary key and the only thing a visitor can check, so a session with no root cannot be a receipt without inventing the hash the page exists to verify. `smoke-test-m4` has a root but no transcript and covers TWO sessions, so the root cannot be attributed to one bilateral exchange; excluded. The collection write-up is not a session. **Cross-check that makes `message_count` verified rather than asserted:** extracted turns reconcile with the leaf counts each document states independently — 25 turns/27 leaves, 10/12, 5/7 (genesis + turns + seal), and m8b states "7 content messages" for 7 extracted turns. Per M11-D34: `seal_status` is stored and displayed; `verified_by`/`node_count` are populated ONLY where the record states them and are otherwise null, with the page showing the real state (`sealed`, `sealed — attestations pending`, `seal_deferred`) instead of a badge. No count is inferred, defaulted, or back-filled from "we run three nodes". Verified: the live index lists the archive; a receipt page renders its transcript; and every published verification number traces to a line in the source document. — ❌

- **DOD-BLOG-INFRA-1** [corp-cello-site] — blog infrastructure complete. **Existing:** the blog is already a Next.js route in corp-cello-site at `/blog` (not Ghost — do not change this). Two articles are live. JSON-LD blog/itemList/breadcrumb schemas are present. **Remaining work:** (a) Google Search Console property verified for `cello.mygentic.ai`; (b) GA4 tracking script deployed site-wide; (c) every article has `datePublished` + `dateModified` in Article schema and a visible "Last updated" line below H1; (d) FAQPage JSON-LD on articles that have FAQ sections; (e) confirm robots.txt allows all crawlers on `/blog/*`. Do NOT migrate to Ghost. — 🟡 clauses (c), (d) and (e) verified locally and were already satisfied except one: the last-updated line was gated on `kind === "pillar"`, so a revised cluster article showed its original publish date while `dateModified` in the Article schema reported the revision — page and structured data disagreeing about the same fact. Now keyed on whether the post was actually updated (Entry 46). FAQPage JSON-LD is emitted only for articles that have FAQ sections; robots.txt carries no `Disallow`, so `/blog/*` is crawlable by everything. Owed: (a) Google Search Console property verification and (b) the GA4 script — both outward actions only Andre can take → Journal Entry 46

- **DOD-OPENCLAW-SKILL-1** [openclaw] — `cello.md` skill file published to the OpenClaw skill directory. Covers: `cello_start_agent`, `cello_initiate_session`, `cello_send`, `cello_receive`, `cello_contacts`, `cello_sealed_receipt`. Contains 3–4 worked scenarios. Verified: the skill is discoverable in the OpenClaw directory by searching "CELLO" or "agent identity". — 🟡 `skills/cello/SKILL.md` written and committed in the openclaw repo, matching the house frontmatter; four worked scenarios. Owed: submission to the directory, which is an outward publication step → Journal Entry 34

- **DOD-MCP-REGISTRY-1** [no-code] — `@cello-protocol/connect` listed on: mcp.so, Smithery, Glama, and submitted to awesome-mcp-servers. Description text optimized for BOFU queries ("agent-to-agent identity", "trust signals", "MCP server for agent communication"). Verified: search "CELLO" on each platform; listing appears. — 🅿️ PARKED — four external submissions (mcp.so, Smithery, Glama, awesome-mcp-servers), each needing an account and a submission Andre owns → Parked section

---

## Success Metrics (Go/No-Go for Wave 1)

These are not DoD lines — they are the real-world checks that determine whether Wave 1 opens. They must be evaluated after P0+P1 are live with real traffic.

| Metric | Target | Action if below target |
|---|---|---|
| Landing page → signup conversion | 20–40% | Below 10%: page problem — fix before Wave 1 |
| E1 delivery rate | >95% | Below 90%: SES configuration issue |
| Email open rate | 30–50% | Below 25%: subject line / list-cold issue |
| Survey completion (among signups) | Watch only — no target yet | This is the activation-intent signal |
| Time to first win (install → first sealed own-agent exchange) | <15 min guided | This is THE launch metric for Wave 1 |
| Admitted → first win before next wave | >70% | Next wave does not open below this |

---

## Decisions

*(Dated, numbered, one paragraph: the fork / choice / why / reverse. This section is the sole decisions record — no separate DECISIONS doc.)*

- **M11-D1 (2026-07-20, Andre) — No paid SaaS. Everything self-hosted on AWS/GCP/open-source.** No credit card available. Any tactic that implies a SaaS subscription is out of scope. Reverse: if runway situation changes, revisit specific high-ROI tools (e.g. Resend for email, Posthog for analytics) but the default is self-built.

- **M11-D2 (2026-07-20, Andre) — All CELLO URLs are `*.cello.mygentic.ai`.** No other domain exists or is proposed. Gallery is `gallery.cello.mygentic.ai`. Ops dashboard is `operations.cello.mygentic.ai`. The receipt verifier is at `gallery.cello.mygentic.ai/receipt/[hash]`. The blog is a path (`cello.mygentic.ai/blog`), not a subdomain — it's an existing Next.js route in corp-cello-site. This is final. Reverse: only if a domain acquisition changes the asset picture.

- **M11-D3 (2026-07-20) — Wave admission is operator-triggered, not automated.** Wave assembly is a function called by an authenticated ops dashboard action. No cron, no automatic threshold, no calendar date triggers admission. Reverse: automate after Wave 3, once the infrastructure-checkpoint pattern is understood.

- **M11-D4 (2026-07-20) — Social post credits require manual ops spot-check, not automated verification.** OAuth proves ownership of the platform handle. Post URL submission writes to `post_review_queue`. Credit applied only on ops approval. Automated scraping of post metrics introduces TOS risk and maintenance burden. Reverse: automate specific platforms post-v1 if volume makes manual review unscalable.

- **M11-D5 (2026-07-20) — Telegram gate is a single `telegram_accounts` table with a `source` column.** Both waitlist token holders and staff (ops override) are one lookup: "does this `telegram_id` exist in `telegram_accounts`?" Staff bypass writes a row with `source = 'ops_override'`, `waitlist_user_id = NULL`. No separate table, no flag on users, no code branch. Reverse: none foreseen — the single lookup is load-bearing for the simplicity of the gate logic.

- **M11-D6 (2026-07-20) — The first-win trigger uses `waitlist_agent_links` as the bridge.** The session seal event carries `agent_pubkey`. The waitlist DB has no `agent_pubkey` column. `waitlist_agent_links` is written at token-burn time (the one moment both identities are simultaneously present) and is the join key for `first_win_at` detection. Reverse: if a future onboarding path bypasses the Telegram gate, a second linking mechanism will be needed.

- **M11-D7 (2026-07-20) — Ops dashboard is a separate repo, cloned from cello-portal.** Does not share a deployment with the portal. Shares the same Postgres DB via a restricted IAM role. Separate repo enables independent deploy, separate allowlist management, and no risk of cello-portal's auth surface being accidentally widened. Reverse: merge back if maintenance of two Next.js deployments becomes a real burden.

- **M11-D9 (2026-07-20, revised 2026-07-20) — Waitlist status pages live in corp-cello-site, not a separate repo.** The `/auth` and `/status` pages are new routes in corp-cello-site. The existing `/confirm` page already does the E1 token-verify flow and shares the corp-site design system — extending it in-repo is strictly less work than cloning cello-portal. The cello-portal clone pattern is correct only for the ops dashboard (separate security boundary). Session cookie: 30-day HttpOnly, regardless of activity. Magic link (re-access) expiry: 15 minutes, single-use. `/auth` silently rejects unknown emails (no enumeration). Reverse: none foreseen — this was always the correct architecture.

- **M11-D10 (2026-07-20) — Wave 1 is categorically different from later waves.** Wave 1 is 10–20 hand-picked design partners. Onboarding call is mandatory. E-inv includes a calendar link. First win happens during the call. Later waves are self-serve: E-inv includes a quickstart link, no mandatory call. The E-inv template takes a wave number and renders the correct variant. Reverse: make all waves self-serve if Wave 1 logistics prove unscalable.

- **M11-D8 (2026-07-20) — Gallery is in corp-cello-site, not a standalone repo.** The gallery shares the corp site's header, footer, and design system. Adding it to the corp site is a new Next.js route, not a new service. Reverse: extract to a standalone Next.js app if gallery rendering needs differ substantially from the corp site (e.g. heavy SSG, separate CDN config).

- **M11-D11 (2026-07-20, Andre) — `waitlist_users.status` is lifecycle only; email suppression is a separate field.** Lifecycle: `waiting` / `admitted` / `active` / `left` / `banned`. Transition: waiting → admitted (wave), admitted → active (first-win), active → left (voluntary account deletion), any → banned (ops action). A new `email_status` column (`active` / `unsubscribed` / `complained` / `bounced`) tracks email deliverability independently. Email pipeline checks both: correct segment AND `email_status = 'active'`. Reverse: none foreseen — these are orthogonal concerns.

- **M11-D12 (2026-07-20, Andre) — Premium invites are bearer codes consumed at signup via localStorage, not email-bound.** Flow: `/invite/CODE` landing page stores the code in localStorage, redirects to `/waitlist`. Signup form reads localStorage and includes the code silently. Backend validates + burns on successful signup; marks the user as premium-referred. If the link is mangled and the user signs up without it, the code is NOT burned — the inviter can resend. A `type` column on `referral_codes` distinguishes `share` (regular referral, earns points) from `premium` (golden ticket, skips queue). Reverse: none — bearer model is strictly more flexible than email-bound.

- **M11-D13 (2026-07-20, Andre) — `/auth` page uses non-enumeration pattern.** Always shows "Check your inbox" regardless of whether the email was found. Below the message: "If you don't receive an email, you may not be on the waitlist — [sign up here]." No redirect, no confirmation of email existence. Matches cello-portal's magic-link.ts pattern. Reverse: none — enumeration prevention is a security requirement.

- **M11-D19 (2026-07-21, Andre) — Creator attribution uses nullable `owner_waitlist_user_id` in `referral_codes`, not a separate table.** External creators (journalists, writers, influencers) need trackable links without having a waitlist account. `referral_codes.owner_waitlist_user_id` is nullable; a new `creator_handle` TEXT column covers the external case. A CHECK constraint enforces exactly one of the two is non-null. The ops UTM generator issues creator codes; the signup endpoint routes `ref=CODE` lookup to either the referrals path (waitlist-user code → +10 points) or the creator-tracking path (`creator_tracking` event row, no points). A single table lookup handles both paths — no branching at the schema layer. Reverse: extract to a separate `creator_codes` table if creator-specific features (payout, tiers, dashboards) grow beyond what a column or two can hold.

- **M11-D14 (2026-07-20, Andre) — Signup form keeps a `display_name` field (nullable).** Casual moniker — not structured first/last. Column added to `waitlist_users` as `display_name TEXT NULL`. Reverse: none.

- **M11-D15 (2026-07-20, Andre) — Survey points restructured: +20 structured, +10 free-form, +30 interview commit.** Structured questions: (1) What would you use CELLO for? (multi-choice), (2) How many agents do you run? (0 / 1-2 / 3-9 / 10+), (3) What platforms? (multi-select: Claude Code, Claude Coworker, Claude.ai, Codex, Hermes, OpenClaw, Kimi, Gemini agent, ChatGPT, Other with free text). Free-form: "How do you imagine using this?" (+10). Interview commit checkbox: +30 (highest single action — feedback calls are the most valuable input). Total possible from survey page: 60. Reverse: adjust point values based on observed conversion data post-Wave 1.

- **M11-D16 (2026-07-20, Andre) — Dynamic wave estimator killed. Replaced by queue position + qualitative band.** Status page shows: real-time queue position, a qualitative band ("top 10%", "top 25%", "top half"), and a short explanation that waves are sized dynamically based on how the previous wave performed. No predicted wave number, no estimated date. DOD-DYNAMIC-ESTIMATOR-1 is redefined to match. Reverse: add a predicted wave number if wave sizes stabilize into a predictable pattern post-Wave 3.

- **M11-D17 (2026-07-20, Andre) — `waves` table is a history record, not a forward plan.** Schema: `wave_number`, `capacity`, `priority_pct`, `zero_pct`, `opened_at`, `opened_by`. Plus `wave_number` column on `waitlist_users` set at admission time. The "Open wave" form in the ops dashboard takes all inputs at trigger time (capacity, priority/zero split percentages) — nothing is pre-stored. Reverse: add a planned-waves table if wave scheduling becomes predictable.

- **M11-D20 (2026-07-24, Andre) — P0 server-side logic lives in Lambda behind the existing API Gateway. corp-cello-site stays a static export.** The fork: `corp-cello-site` sets `output: 'export'` in `next.config.js` and its CI rsyncs `out/` to a Lightsail box, so Next.js route handlers are silently dropped from the build (proven: `/api/waitlist/signup` absent from the route table and from `out/`). Option A was to drop the static export and run Next as a Node server on Lightsail; Option B, chosen, keeps the site static and puts signup / auth / session / queue-position logic in Lambda behind the API Gateway already serving `/submit` and `/confirm` at `h8dh7rbhb1.execute-api.us-east-1.amazonaws.com` (source: `infra/lambda/form-submission/handler.py` in trustless-cello). Why B: it does not rewrite the deploy path of the live public marketing site; the API-Gateway→Lambda→RDS path is already proven in production for this exact endpoint; it matches the DoD's own placement of Lambda code in trustless-cello (`DOD-EMAIL-INFRA-1`); and the static export stays fully pre-rendered for the P3 GEO/gallery work. Accepted consequence: the `/status` session gate becomes client-side (the page shell is public; the protected data requires a valid session cookie at the API). `app/api/waitlist/signup/route.ts` is retained as logic to port, not as a shipping artifact. Reverse: move to Option A if the number of authenticated server-rendered surfaces grows past what a static shell can carry cleanly.

  **Refinement (2026-07-24, same day) — what is actually proven, and what is new.** The live Lambda is `cello-web-form-handler` (python3.12), and a read-only check before hibernation returned `VpcConfig: null`. It writes to **DynamoDB** (`cello-form-pending`, `cello-form-submissions`), not Postgres. So the proven-in-production part of this decision is the API-Gateway → Lambda → SES shape; the **Lambda → private RDS leg is new**. `cello-portal-dev` is `PubliclyAccessible: false`, so the handler must be VPC-attached to reach it, which in turn requires a NAT gateway or VPC endpoints for its SES and DynamoDB calls — and NAT gateways are torn down by hibernate. Consequences: (a) this is CloudFormation work, not a console toggle, and it lands when infra is awake; (b) the runtime choice is now open — the existing handler is Python while the ported logic is TypeScript, so either the new waitlist handler is a second, separate function or the logic is rewritten in Python. Decision deferred to implementation, with the default being a **separate function** so the live form handler is never put at risk by waitlist work. Neither point changes the Option B choice.

- **M11-D21 (2026-07-24) — corp-cello-site work stays on a feature branch; never push its `main`.** This overrides M11-PROCEDURE §5d ("work directly on `main` in all repos") for this repo only. `.github/workflows/deploy.yml` triggers on push to `main` and deploys straight to the live public site `cello.mygentic.ai` (Lightsail 63.34.176.185, eu-west-1), including an nginx config overwrite and a certbot step. An unattended overnight agent must not be able to publish to or break the public marketing site. trustless-cello and its docs continue to commit and push to `main` normally. Reverse: once the waitlist work is reviewed and Andre wants it live, he merges the branch himself.

- **M11-D22 (2026-07-24) — the schema enforcer runs against local Docker Postgres; the "deployed" half is explicitly owed.** The portal RDS (`cello-portal-dev`, us-east-1) is `PubliclyAccessible: false` — private-subnet only, so it is unreachable from a development machine without ECS exec, hibernated or not. Migration idempotency (fresh schema == migrated schema, and re-running against a DB with prior data) is therefore proven locally against a real Postgres in Docker — not mocked, per the M4+ rule that RLS and constraint behaviour cannot be mocked. A line whose only remaining gap is "applied to the portal RDS" sits at 🟡 with that gap named, never ✅. Reverse: none — this is the standing pattern for any environment where the DB is not publicly reachable.

- **M11-D23 (2026-07-24) — `creator_tracking` and `points_ledger` are created at P0, not P1/P2.** The fork: `DOD-SIGNUP-1` is a P0 line whose clauses write to `creator_tracking` (assigned to `DOD-SCHEMA-P2-1`) and enqueue a `points_ledger` row (assigned to `DOD-SCHEMA-P1-1`). The phase assignment and the P0 line contradict each other. Chosen: create both in migration `0003` at P0. Why: the alternative is an endpoint that writes to tables which do not exist, and that is not a hypothetical cost — it is precisely what aborted the transaction and rolled every creator-referred signup back to zero rows while returning a 500 that named neither cause. The P1/P2 schema lines now cover these two tables as already-present. Cap enforcement ships with the ledger as a `BEFORE INSERT` trigger rather than waiting for P1, because `DOD-INV-POINTS-CAPS` requires a direct SQL insert past the cap to fail, which application code cannot deliver. Reverse: none — a table cannot be scheduled later than the code that writes to it.

- **M11-D24 (2026-07-24) — a spent premium invite code lets the signup SUCCEED, and says so.** The fork surfaced when two of my own tests disagreed: 409 for a code burned earlier in the same run, 200 for one already inactive. Those are the same state (`active = false`) reached two ways, and the handler cannot distinguish them. Chosen: the signup completes as a normal `waiting` user, and the response carries `referral: {applied: false, reason: "code_already_used"}`. Why: refusing would lose a genuinely interested person because somebody else redeemed the code first — the worse outcome by a distance. The thing that must not happen is a *silent* downgrade, where the user believes they skipped the queue and did not; returning the outcome is what prevents that, and the success screen renders it. Note this does not weaken `DOD-INV-TOKEN-SINGLE-USE`, which governs `waitlist_tokens` (wave admission grants) — those still hard-reject. Reverse: hard-reject if spent-code traffic turns out to be dominated by abuse rather than honest late arrivals.

- **M11-D25 (2026-07-25) — the waitlist DB password lands in a plaintext Lambda env var, and that is accepted for launch.** ECS keeps secrets out of the task definition with `ValueFrom`; Lambda has no equivalent, so `DATABASE_URL` is readable by anyone holding `lambda:GetFunctionConfiguration`. The alternative is a cold-start Secrets Manager fetch inside all twelve handlers — which rewrites the twelve `connect()` paths, the most heavily tested surface in M11, to buy nothing in a single-operator account where that same operator already holds `secretsmanager:GetSecretValue` on the source. Recorded rather than left implicit, because an undocumented secret in an env var reads as an oversight to the next person and gets "fixed" at a bad moment. Reverse: mandatory before a second principal gets IAM access to this account, and the shape is a shared `_db.py` where exactly one of `DATABASE_URL` / `DATABASE_SECRET_ARN` may be set — both or neither refuses, never falls back.

- **M11-D26 (2026-07-25) — the waitlist Lambdas are us-east-1 only, and the sovereign-node rule does not apply to them.** One node = one region governs directory and relay, whose independence is the security property. The waitlist is the opposite shape: twelve functions that are the only writers to one schema in one RDS instance. A second regional copy would be a second uncoordinated writer to the same rows — wave admission racing itself across an ocean. Same single-global-service class as the ops-agent and cicd. Both `deploy.sh` and `deploy-lambdas.sh` refuse other regions explicitly rather than silently no-op'ing. Reverse: none foreseen; if the waitlist ever needs regional presence it needs a replication design first, not a second deploy target.

- **M11-D27 (2026-07-25) — the email path is EventBridge polling `email_jobs`, not SQS. DOD-EMAIL-INFRA-1 says SQS; this deviates deliberately.** `email_jobs` claimed with `FOR UPDATE SKIP LOCKED` and a `pending → sending → reclaim` transition already *is* a durable queue with at-least-once semantics and a visibility window. Adding SQS on top creates a second source of truth and a dual-write on every enqueue: the row and the message can disagree, and the failure mode of that disagreement is a job that is either sent twice or never. It also buys nothing the table lacks — retries, DLQ-equivalent retirement after `EMAIL_MAX_ATTEMPTS`, and per-job audit already live in columns. Cost: a job enqueued just after a tick waits up to 60s, so "E1 within 60 seconds" is a target the p99 misses by construction; the schedule Description now says a minute rather than claiming the bound. Written up only after a reviewer flagged it as an un-journaled deviation — the engineering was fine, the omission was the defect, because an undocumented deviation is indistinguishable from an oversight.

- **M11-D28 (2026-07-25) — a rotated master password will stale the twelve Lambdas, and that is accepted until the first rotation, not indefinitely.** Both RDS instances set `ManageMasterUserPassword: true`, so the password is on an RDS-managed rotation schedule while `deploy.sh` freezes it into twelve env vars at deploy time. After the first rotation every function fails authentication until someone re-runs `deploy.sh`. This narrows M11-D25, which argued a Secrets Manager fetch "buys nothing": it buys correctness under rotation, which is a different claim from secrecy and a correct one. Not fixed tonight because the fix is a shared `_db.py` rewriting all twelve `connect()` paths — the most heavily tested surface in M11 — and the environment is hibernated so none of it can be verified live. Reversal condition upgraded from "before a second operator" to **whichever comes first: a second IAM principal, or the first observed master-secret rotation**. Verify the interval with `aws secretsmanager describe-secret --secret-id <arn> --query RotationRules` when the environment is awake.

- **M11-D30 (2026-07-25) — DOD-INV-NO-DIRECTORY-RELAY's "Lambda code and docs" clause is amended, not quietly ignored.** A reviewer pointed out the line was ✅ while one of its clauses was factually false: M11 touched `infra/cloudformation` (3 files), `deploy.sh`, `deploy-lambdas.sh`, `infra/scripts` (4), `infra/tests` (3), `STATE.md` and `.claude/`. The clause was written before the milestone knew the waitlist would need its own stack, a migrate Lambda, and a deploy path — none of which existed when the DoD was drafted. The invariant's *intent* is "do not touch the directory or relay", and that held: zero commits touched `packages/directory`, `packages/relay`, `cello-ecs-directory.yaml` or `cello-ecs-relay.yaml`, now enforced by commit-history scan rather than a net-tree diff. So the text is corrected to match what the milestone legitimately owns, and `cello-iam.yaml` — which defines the directory and relay task roles and WAS modified for the ops-agent's gate grant — is reported as a standing NOTE by the checker rather than waved through. Reverse: if a future milestone needs the clause to be literal again, narrow the allowance rather than deleting the note.

- **M11-D29 (2026-07-25) — four premium invites is a CEILING on what one person can hand out, not a running tally of rewards earned.** `grant_invites_up_to(..., scope="all")` counts everything the user already holds, so the three first-win invites count toward the four. Adding instead would leave someone who took six days to reply holding six while someone who answered at once holds four — inverting the incentive the sequence exists to create. Recorded now because `waitlist-outreach/handler.py` cited this as "M11-D28" when no such entry existed; that number has since been assigned to the master-password rotation decision, so the comment pointed at a real but unrelated decision — worse than a dangling reference, because it reads as verified. Reverse: switch to additive only if invite scarcity turns out to be suppressing feedback calls, which the ops dashboard's premium-held column would show first.

- **M11-D30 (2026-07-27) — the signup form tells a caller which mail it sent, which is a deliberate widening of what `POST /waitlist/signup` discloses.** `DOD-INV-NO-ENUMERATION` binds `/auth/*`, and it holds there. Signup is different and always was: it answered 409 `email_already_registered` for a known address, so membership itself has been observable from this endpoint since it shipped. What is new is (a) `sent` distinguishes **confirmed / unconfirmed / suppressed** rather than merely known / unknown, and (b) the endpoint now sends mail on demand to a typed address, up to the shared per-window limit, where it previously sent none. Chosen anyway: the alternative is the wall this replaced. A returning member typing the only URL they remember has to be told whether the thing in their inbox is a confirmation or a way back in, or they cannot act on it — and a suppressed address told "check your inbox" is being lied to about a message that will never arrive. Bounded by the shared `auth_link_requests` limit, which now counts SENDS rather than requests, so the disclosure costs an attacker one mail per probe against a rate limit rather than being free. Reverse if the list is ever enumerated in practice, or before the site is open to unauthenticated bulk traffic: collapse `suppressed` into the ordinary confirm screen and lose the honesty for the smaller surface. Raised by the unit reviewer as an un-journaled deviation — the engineering was a judgement call, the omission was the defect.

- **M11-D31 (2026-07-27) — a premium invite records a CLAIM at signup and grants the admission at confirmation.** The code is still burned in the signup transaction, so a bearer capability cannot be claimed twice while a confirmation is pending, and `premium_referred` is still set there — the signal that says which door someone came through survives. What moved is `status = 'admitted'`. Admitting a typed address skips the queue on no proof of a mailbox: spend a scarce invite on a stranger's address and they hold an admission nobody can revoke. This is the same rule that moved the referrer's points (M11-D30's neighbour in the same unit), applied to the case that sat twenty lines below the comment stating it. Cost: someone who is invited and never confirms consumes the code without ever being admitted, which is correct — the code bought them a place in front of the queue, not a bypass of the address check. Reverse: none foreseen; if premium invitees prove to drop off at confirmation, the fix is a reminder mail, not a weaker gate. Raised by the unit reviewer as a deviation from the very clause the unit implemented.

- **M11-D32 (2026-07-27) — SUPERSEDES M11-D31. A premium invite is not admitted at confirmation; it joins the wave's premium cohort, which is selected first.** M11-D31 moved `status = 'admitted'` from signup to the confirm click. Both were wrong for the same reason, which only showed up when the code was executed rather than read: **`status` grants nothing.** `waitlist_tokens` is minted in exactly one place — `waitlist-waves/handler.py`, atomically with the `e_inv_admission` mail — and `waitlist-gate` burns a token and never reads `status`. A premium holder with `status='admitted'` therefore had a label, no invitation, no token, and a refusal at the Telegram gate. Setting it at confirmation was additionally self-defeating: the wave's premium cohort requires `status='waiting' AND email_verified AND premium_referred`, and flipping status in the same transaction that sets `email_verified` meant no transaction could ever observe that combination — the fast door had no door. Chosen: confirmation writes no `status` at all. A confirmed claimant sits in the cohort, the wave admits them first and up to full capacity, and the wave mints the token and sends the mail. Cost: a premium invitee waits for the next wave rather than being instantly "admitted" — but instantly-admitted never granted anything, so this is the first time the invite works at all. The code is still burned in the signup transaction, so a bearer capability cannot be claimed twice while a confirmation is pending. Reverse: if premium must bypass waves entirely, extract an `admit(user_ids, wave_number)` helper from `waitlist-waves` and call it from confirmation — the requirement is that whatever grants admission also mints the token and sends the invitation, never one without the others.

- **M11-D33 (2026-07-29, Andre) — a gallery receipt carries the CONVERSATION, not only the seal metadata.** The built gallery stores and renders seven fields — hash, both monikers, `sealed_at`, `message_count`, `verified_by`, `node_count` — and no content, so a receipt page proves a session happened without showing what it was. §9 of [[M11-PRELAUNCH-REQUIREMENTS]] did specify a "message exchange summary (content only if the user opted to make it public)"; it was never built, and the omission was invisible because nothing tested for an absence. The fork: leave it as a proof-of-seal surface, or carry the transcript. Chosen: carry the transcript. The §9 GEO argument — "a corpus of real agent-to-agent sessions that AI engines index when answering *what does a CELLO session look like?*" — is answerable only by a page that contains a session; fifteen cards reading "12 messages, verified by 2 of 3" answer a different question nobody asked. Consequences accepted: content is subject to the same irrevocability as the hash, so publishing must be deliberate; and a transcript contains the COUNTERPARTY's words, which one party publishes unilaterally — for the seeded archive both sides are Andre's own agents, so this is deferred, not solved, and is called out in `DOD-GALLERY-CONTENT-1`. Reverse: if unilateral publication of a counterparty's words proves untenable, keep the transcript column and gate rendering on a both-parties flag rather than removing the capability.

- **M11-D34 (2026-07-29, Andre) — the M0–M8C build-in-public sessions seed the gallery, and each renders the seal state it actually had.** An empty gallery is a dead surface, and `docs/planning/milestone-writeups/live-session-e2e-proofs/` holds fifteen real sessions with real monikers, session IDs, sealed roots, dates and leaf counts. Use them. The one thing not recorded anywhere in those files is the directory attestation count, and it is the one field that must not be invented: `verified_by`/`node_count` render as "Verified by N of M nodes", the receipt hash is printed beside it, and the entire purpose of the surface is that a stranger can check the claim — so a fabricated badge would make the page evidence against the product. §2b of [[M11-PROCEDURE]] already makes this blocking ("any fabricated number is BLOCKING", `DOD-INV-NO-INFLATION`). It also does not need inventing: the record states what happened per session, and the states differ — `sealed` with a live 3-region bilateral FROST ceremony (m8b, m8c), `sealed` with attestations `PENDING` because the MMR checkpoint had not been written (m4), and `seal_deferred` because the directory was unreachable at close and the chain committed anyway (m3). The schema therefore gains a `seal_status` and makes the two counts nullable, so a 2026-05 session is not forced into a badge shape that did not exist until M8B. This is better material than a uniform tick: a card reading "seal deferred — directory unreachable, 16 leaves committed" demonstrates graceful degradation under failure, which is the hard claim to fake. Reverse: none for the archive; live receipts published by real users after `DOD-GALLERY-PRIVACY-1`'s portal action carry real counts and render the badge.

- **M11-D18 (2026-07-20, Andre) — `CELLO_FEEDBACK` agent is an operational provisioning task within M11.** The identity already exists in the directory. Remaining work: small EC2 instance, Hermes installed, CELLO installed, governance configured (no sensitive outbound), inbound reachability confirmed (NAT/networking). The Lambda trigger for feedback outreach is "initiate a session to this known pubkey" — standard protocol, no new code. A new DoD line covers: agent reachable inbound, responds to a test session initiation. Reverse: none.

---

## Parked

### Live verification, 2026-07-25 evening

Run against the deployed system, no browser needed. Recorded once here rather than rewritten into
each line.

- **signup** — `{success, waitlist_id, referral_code}`; a repeat address returns **409
  `email_already_registered`**, not a 500.
- **referral attribution** — a valid `ref` returns `{applied:true, kind:'share', points_awarded:10}`;
  an unknown code returns `{applied:false, reason:'unknown_code'}` and awards nothing.
- **E1 send** — `cello-waitlist-email-dev` drained the queue and reported `{sent:1, failed:0}`: a real
  `send_raw_email` through the configuration set.
- **no-enumeration** — `/waitlist/auth/request` is byte-identical for a real address and an invented
  one.
- **ops dashboard auth (run for the first time)** — the container, against a real Postgres:
  `/sign-in` 200; `/` without a session 307s rather than leaking; a magic-link request for an
  ALLOWED and a NOT-allowed address return byte-identical `202 {"status":"sent_if_allowed"}`, while
  the database tells them apart — **both** recorded in `ops_magic_link_requests` (the throttle fires
  before the allowlist, which is what stops 429-vs-202 becoming an oracle), and **only** the allowed
  address minted a row in `ops_magic_links`. Tokens are stored as 64-hex SHA-256, never raw. A
  separate run with the database unreachable still returned the same 202 and logged
  `ops.magic_link.request_failed` at ERROR — the caller learns nothing, the operator learns
  everything.
- **ops dashboard PAGES (run for the first time)** — against one local database carrying both the
  ops tables and all 22 waitlist migrations, which is the shape `DOD-INV-SINGLE-DB` mandates. With a
  minted session all five render: `/`, `/posts`, `/waves`, `/feedback`, `/links` — 200 each. A
  seeded `post_review_queue` row appears on `/posts`, so the page reads the real queue rather than a
  placeholder. **Not proven:** the approve/reject actions, which are Next server actions and cannot
  be driven from curl without reconstructing the action encoding; their atomic review-claim is
  unit-tested. That boundary is stated rather than glossed.
- **THE ADMISSION CHAIN, END TO END (first time, 2026-07-25)** — real handler code against a local
  Postgres carrying all 22 migrations. A verified user; `waitlist-waves` opens wave 2 and admits 1
  (`{admitted:1, wave_number:2, breakdown:{premium:0, priority:1, zero:0}}`), minting a token; the
  gate burns it — `{allowed:true, reason:'token_burned', waitlist_user_id:…}`; a SECOND burn of the
  same token from a DIFFERENT Telegram account is refused `{allowed:false,
  error:'token_already_used'}`; and a plain check on the now-admitted account returns
  `{allowed:true, reason:'already_linked', source:'waitlist_token'}`.

  That is `DOD-INV-TOKEN-SINGLE-USE`'s enforcer, the slow door of `DOD-INV-TWO-DOOR`, and clauses
  1–3 of `DOD-TELEGRAM-GATE-1` — executed rather than unit-tested. It also confirms the client fix
  that reads `alreadyLinked` from the gate's `reason`: the gate does emit `already_linked`.

  **Local, not the deployed database** — same standard the schema lines were held to. What remains
  is the same run against `cello_portal` with a real Telegram account, which needs an admitted
  operator and DB visibility.
- **FIRST WIN and the FAST DOOR (first time, 2026-07-25)** — same local rig.
  `waitlist-firstwin` on a sealed session: **3 premium codes minted, all active**, `first_win_at`
  set, and an `e_win_invites` email enqueued. A replay returns `{first_win:false,
  reason:'already_recorded'}` and the count stays 3, not 6.

  Spending one of those codes at signup: `{applied:true, kind:'premium'}`, the code flips
  `active:false`, and the user lands `status:'admitted', premium_referred:true` — **it skips the
  queue**. A second signup with the same code gets `{applied:false, reason:'code_already_used'}`
  and stays `waiting`. That is `DOD-INV-PREMIUM-BEARER` and the fast door of `DOD-INV-TWO-DOOR`,
  executed. Wave admission also enqueued `e_inv_admission`.

  **One caveat, stated:** `waitlist_agent_links` was seeded by hand for this run, because nothing
  writes it — the parked fork. Everything downstream of that row is proven; the row's absence in
  production is not fixed by this.
- **THE FIVE POINT-EARNING ACTIONS, each called TWICE (first time, 2026-07-25)** — real handler
  code, real session, local Postgres:

  | action | 1st | 2nd | effect |
  |---|---|---|---|
  | `/waitlist/readiness` | 200 | 200 | +20 once |
  | `/waitlist/interview-commit` | 200 | 200 | +30 once |
  | `/waitlist/survey` | 200 | 200 | +30 once (20 structured + 10 free-form) |
  | `/waitlist/post-url` | 200 | **409** | queued, **no points** — credit waits for review |
  | `/waitlist/content-alerts` | 200 | 200 | flag set, no points |

  Total 80, and the ledger holds exactly three rows — one per paying action. Calling everything
  twice is the point: idempotency and the caps are enforced in the database, so a second call
  changes nothing.

- **queue position is COMPUTED** — `waitlist_queue` ranks correctly by points then age (80, 50, 50,
  0), and `queue_position` exists on no table, only the view. `DOD-INV-NO-INFLATION` has nowhere to
  store a fabricated number.
- **UNSUBSCRIBE, prefetch-safe and scoped (first time, 2026-07-25)** — `GET` returns the
  confirmation page and changes **nothing**, which is the whole point: a mail client's link scanner
  fetches every URL in a message, and an acting GET would silently unsubscribe engaged users. `POST`
  with `list=content_alerts` clears only that flag and leaves `email_status` active. `POST` without
  a scope sets `email_status='unsubscribed'`. Three states, three outcomes, verified against the
  database rather than the response code.
- **THE BROWSER CLAUSES, run in a real browser for the first time (2026-07-25)** — against the LIVE
  site, which is the half curl could never reach:

  | clause | result |
  |---|---|
  | `wl_anon_id` generated and persisted | a UUID, on first visit |
  | UTM + `ref` captured into `wl_touchpoints[]` | `utm_source`, `utm_medium` and `ref=HARNESSPROBE` all recorded |
  | de-duplicates identical consecutive visits | reloading the same URL leaves the count at 1; a different `utm_source` appends |
  | caps at 20 | 27 distinct visits → exactly 20 kept, oldest evicted |
  | **first touch survives the cap** | `wl_first_touch` still held the ORIGINAL visit after eviction — the property attribution depends on |
  | `wl_user_id` set post-signup | a real signup through the form set it to a real `waitlist_id` |
  | the browser carries `ref` into the POST | `ref` was present in `wl_touchpoints` at submit time, and the server half (`applied:true, kind:'share', +10`) was proven separately |

  That closes `DOD-TRACKING-1`'s behavioural clauses and the client half of `DOD-LANDING-1` clause
  (c) — the ones every prior note said were "unit-tested but never executed in a browser".

- **wave gate** — `capacity` alone is refused `invalid_capacity`; with a capacity but no operator,
  refused `missing_opened_by` ("every wave names the operator who opened it"); with both, it declines
  to open a wave at all: `{admitted:0, reason:'all_unverified', waiting_total:8,
  excluded_unverified:8}`. Real counts, no wave invented to look busy.
- **gallery** — list serves; publish refuses a bogus payload 400; an unknown hash 404.
- **tracking** — the script is present on all 12 deployed pages.
- **protocol** — 8/8 smoke scenarios green against live staging, exit 0.

Every one of these is the SERVER half. The client halves — localStorage touchpoints, `ref`
extraction, the session cookie round-trip, copy buttons — remain unrun, because curl does not execute
JavaScript. No line goes ✅ on the strength of the above alone.
*(Genuine undecidable forks. Never silently dropped.)*

- **I VIOLATED `DOD-INV-NO-DIRECTORY-RELAY` AND IT COST A 3-REGION DIRECTORY DEPLOY (2026-07-25).**
  Recorded rather than quietly excluded from the checker, because the checker caught me and
  loosening it to accommodate my own commit is the worst available response.

  Commit `985fd257` repaired three permanently-broken test suites by anchoring their migration paths
  to the test file instead of `process.cwd()`. The files live under `packages/directory/src/__tests__/`.
  `infra/pipeline-mappings.json` maps the prefix `packages/directory/` — **including `__tests__`** —
  to `cello-directory-pipeline`, so a test-only edit that cannot change a single byte of deployed
  behaviour triggered a 25–30 minute three-region protocol deploy.

  **The damage, checked rather than assumed.** us-east-1's directory task restarted (16:07 CEST);
  eu-central-1 and ap-northeast-1 were untouched at that point. `infra/CLAUDE.md` says a relay must be
  restarted after every directory redeploy because it registers once and has no reconnect — so I
  checked the new directory's log before applying that runbook, and it is health-checking the relay
  every 30s (`relay.health.check.passed`, latency 3–5ms) and polling manifest v79. The directory
  learns relays from the signed S3 manifest, not only from in-band registration, so this path
  self-healed. **No relay restart was needed and none was performed.**

  **Not reverted, deliberately.** The revert also touches `packages/directory/`, so it would trigger a
  SECOND three-region deploy in order to restore three broken test suites. Paying the cost twice to
  reinstate a defect is not a fix.

  **The real defect is the mapping, and it is nobody's fault but the prefix.** Any test-only change
  under `packages/directory/` or `packages/relay/` buys a full protocol deploy. Whether the filter
  Lambda's mapping schema can express an exclusion is unverified. **Unparked by:** either teaching
  `pipeline-mappings.json` to exclude `**/__tests__/**` (and redeploying the filter Lambda, per
  infra/CLAUDE.md), or accepting that directory test edits are batched like directory code edits.

  The invariant check stays RED on this commit on purpose. A green checker that has been taught to
  ignore the one violation it found is worth less than a red one that names it.

- **The legacy confirmation link is BROKEN IN PRODUCTION, and fixing it is a product call
  (2026-07-25).** Found while auditing the built corp-site artifact before the merge.

  The chain: `/beta/apply` and `/agent/interest` POST to the form API and get a confirmation email
  linking to `cello.mygentic.ai/confirm?token=…`. That page fetches
  `api.cello.mygentic.ai/confirm`. **That route does not exist there** — the custom domain maps
  wholly (`ApiMappingKey: ""`) to `kbok0guwee` (the waitlist API), while `GET /confirm` lives on
  `h8dh7rbhb1` (`cello-form-api`), reachable only at its `execute-api` host. Verified live: the URL
  returns `404 {"message":"Not Found"}`. The page treats any non-410 as `invalid`, so **a user who
  clicks a perfectly valid confirmation link is told it is invalid**, while the database row sits
  unconfirmed. The submit half works only because those two pages skip the custom domain and call
  the raw host directly — which is itself a `DOD-INV-DOMAIN` violation (see below).

  **The fork.** Two defensible answers, different work for different reasons, and choosing wrongly
  wastes the other:
  1. **Retire the legacy funnel.** The M11 waitlist supersedes it, and two competing signup paths on
     one site is its own problem. Cheapest, deletes code, and removes both invariant violations.
  2. **Route it under the custom domain** — add `POST /submit` + `GET /confirm` to the waitlist API
     pointing at the form Lambda, so one API owns `api.cello.mygentic.ai`. Requires a
     `cello-waitlist.yaml` change and a stack deploy, and keeps a second funnel alive on purpose.

  Whether `/beta/apply` is still a live funnel post-waitlist is a product question, not an
  engineering one, so it is not an agent's to answer overnight.

  **What was done rather than left:** `DOD-INV-DOMAIN`'s scan said *"the directories M11 happened to
  touch"* while the clause says *"all repos"* — so it passed for weeks with two live public pages
  pointing at a raw `execute-api` host, the exact failure its denylist was written for, sitting one
  directory outside the allowlist. The scan now covers the corp site entire (proved non-vacuous with
  a planted violation in a previously-unscanned path), with those two files in ONE visible
  quarantine that anything new cannot join. **Unparked by:** choosing 1 or 2.

- **ONE FORK, THREE FACES: nothing carries an agent-side event to AWS (2026-07-25).**

  Three DoD lines are open, they look unrelated, and they are the same missing thing:

  | Line | What it needs | Carrying |
  |---|---|---|
  | `DOD-TELEGRAM-GATE-1` clause 4 | a writer for `waitlist_agent_links` | `agent_pubkey` |
  | `DOD-FIRST-WIN-1` | an invoker for `waitlist-firstwin` | the seal event |
  | `DOD-FEEDBACK-DETECTION-1` | a writer for `session_telemetry` | session metadata |

  In every case the fact originates on the operator's machine — in the daemon or at agent creation —
  and must arrive in the waitlist database. **The daemon holds no AWS credentials, and there is no
  path.** `waitlist-firstwin` is deployed with no invoker and its own CFN `Description` says so.
  `waitlist_agent_links` has three readers (firstwin, gallery, feedback) and no writer, so first-win
  attribution and premium-invite minting silently never fire.

  **Why it cannot simply be written at token burn.** The gate inserts the bridge only `if
  agent_pubkey`, and no caller sends one, because at burn time it does not exist: registration ends
  at `PRE_AUTH_TOKEN_ISSUED` and the operator creates the agent afterwards with `cello register`.
  Checked: the ops-agent POSTs `/internal/pre-authorize` to *issue* a token and is never told when
  one is *claimed*, so there is no existing notification to hang this on either.

  **The options, and the constraint that shapes them.** `DOD-INV-NO-DIRECTORY-RELAY` puts directory
  and relay code outside M11, which rules out the otherwise-obvious answer (the directory already
  authenticates the agent and already holds AWS credentials — it would be a few lines there).

  1. **A signature-authenticated public route on the waitlist API.** The agent signs its payload with
     the Ed25519 key it already has; the Lambda verifies against the pubkey. Serves all three lines
     with one endpoint. Note the bootstrapping order: the first such call is what *creates* the
     bridge row, so the route cannot authorise against `waitlist_agent_links` — it must carry the
     pre-auth token or a session as the proof of which waitlist user this is, and write the link as a
     side effect. Everything after that can authenticate against the link.
  2. **The directory forwards on claim.** Smallest code, cleanest trust story, and blocked by the
     invariant rather than by difficulty — so it is really a question of whether M11 may spend a
     directory change, not whether the design works.
  3. **Leave all three unshipped for launch.** They are growth-loop features — attribution, a points
     award, an outreach trigger. Under the launch-triage test they are forgivable: nobody is stopped
     from connecting two agents. The cost of choosing this is that it must be *stated*, because three
     deployed Lambdas currently read a table nothing writes, which reads as working.

  **Not decided here, and deliberately not decided by an agent overnight** — option 2 needs a ruling
  on the invariant, and option 1 is a new public authenticated surface on the trust layer, which is
  not a thing to introduce unreviewed. Recorded as one fork so it gets one decision instead of three.

  **Consequently `DOD-TELEGRAM-GATE-1` clause 4 is PARTIAL, not done**: burn and `telegram_accounts`
  are atomic and proven; the agent bridge is not written by anything.

  Lambdas querying a table nothing writes.

- **How the seal event reaches `waitlist-firstwin` (2026-07-25).** The function is deployed with **no
  invoker**, and its CFN Description says so. `DOD-FIRST-WIN-1` says the trigger is a "session seal event
  from the daemon" — but the daemon runs on the operator's laptop and holds **no AWS credentials**, so
  there is no path today. This is a fork between materially different architectures, so it is parked
  rather than guessed. The analysis, so the decision is quick:

  **Option 1 — a public, signature-authenticated route.** The daemon POSTs `{agent_pubkey, session_id,
  sealed_root, signature}` to `api.cello.mygentic.ai/waitlist/first-win`; the Lambda verifies the
  signature against the pubkey. *This is the only option that needs no new trust relationship*, because
  `waitlist_agent_links.agent_pubkey` is already the table's primary key — written at token-burn time,
  the one moment both identities are present (M11-D6). Cost: an Ed25519 verify in the Lambda (a new
  dependency in a package that currently carries only psycopg2), and a public endpoint that must refuse
  an unlinked pubkey without revealing whether it is linked.

  **Option 2 — derive it from session telemetry.** `DOD-FEEDBACK-DETECTION-1` already owes "the daemon
  writing session telemetry", and first win is derivable from it, so this adds no new call site.
  But it does not actually dodge the problem: telemetry has the *same* credential question, and it makes
  first win a sweep rather than an event, so invite codes and E-win arrive up to a day late — on the
  single moment the product most wants to feel immediate.

  **Option 3 — relay it through the portal.** The operator is already authenticated there, so the trust
  relationship exists. But it puts a protocol event on a web session, meaning first win only fires while
  somebody has the portal open — and it couples the daemon to the portal, which nothing else does.

  **Leaning:** Option 1, because the pubkey binding already exists and it is the only one that fires at
  the moment it happens. Not taken unilaterally: it adds a public write endpoint to the waitlist API and
  a crypto dependency, and "which surface may the daemon call" is Andre's architectural call, not an
  agent's. Note this also blocks `DOD-E-WIN-1`, which has nothing to send until first win fires.

- **Gallery indexability — the pages are client-rendered, and the gallery exists to be crawled (2026-07-25).** `DOD-GALLERY-1` says *"SSR-rendered (bot-indexable)"* and §9 states the compounding value plainly: *"the gallery becomes a corpus of real agent-to-agent sessions that AI engines index."* What is built is a static export that fetches receipts client-side, so **GPTBot, PerplexityBot and most AI crawlers see an empty shell.** The pages are correct, the API is correct, and the single reason the gallery is in the milestone is not delivered. This traces directly to M11-D20 (keep the static export), which was the right call for `/status` and `/auth` — those are session-gated and should never be indexed — and is the wrong shape here. **Three resolutions, none free:** (a) generate receipt pages at BUILD time via `generateStaticParams` — genuinely indexable, but CI needs access to a `PubliclyAccessible: false` RDS, and the gallery only updates on deploy (acceptable in itself, since a published receipt is immutable by design); (b) run the gallery as a small server-rendered app on its own subdomain, which is Option A from M11-D20 scoped to the one surface that needs it; (c) accept bot-invisibility and drop the GEO justification from the milestone, keeping the gallery as a share target only. This is a genuine fork with a real cost either way, so it is Andre's. **Not blocking the rest of P3** — the API, the schema, the privacy model and the pages all stand under any of the three. Unparked by: choosing (a), (b) or (c).

- **`DOD-MCP-REGISTRY-1` — four outward submissions, not a build (2026-07-25).** Listing `@cello-protocol/connect` on mcp.so, Smithery, Glama and awesome-mcp-servers means creating an account on each and submitting through their own flow. Nothing local produces a listing. **What can be prepared and is not blocked:** the description text optimised for BOFU queries ("agent-to-agent identity", "trust signals", "MCP server for agent communication") — worth drafting alongside the GEO content rather than at submission time. Unparked by: Andre submitting to each platform. Note the awesome-mcp-servers entry is a pull request rather than a form, so that one at least has a reviewable artefact.

- **`DOD-OAUTH-SOCIAL-1` — blocked on external account registration, not on design (2026-07-25).** The OAuth flows need a registered developer application on X, Reddit and LinkedIn, each with a client id/secret and a redirect URI whitelisted against `cello.mygentic.ai`. Creating those is an outward-facing action against three third-party accounts, so it is Andre's to do; no amount of local work produces a working flow without them. **What is already done:** the `waitlist_social_profiles` table with uniqueness enforced in both directions (`(platform, handle)` and `(waitlist_user_id, platform)`), tested through SQL; and `/waitlist/post-url` already returns 403 `platform_not_connected` for a platform with no profile row, so the dependency is wired and simply has nothing to satisfy it yet. **What is owed once the apps exist:** three redirect handlers, token encryption at rest, and a duplicate-handle error surface. Unparked by: registering the three apps and putting the credentials in Secrets Manager.

- **Automated post-URL verification (post-v1).** Programmatically verifying that a submitted post URL (a) actually exists, (b) is authored by the connected OAuth account, and (c) mentions CELLO — requires platform-specific scraping or API calls. TOS risk varies by platform. Currently: OAuth proves handle ownership; URL submission is honor system pending ops review. The volume question (how many submissions per day at scale) determines whether manual review is sustainable. Park until Wave 2 data exists.

- **Stable `issued_at` for idempotent re-minting (post-v1).** The first-win invite codes issued via `referral_codes` are per-event but idempotent by the `first_win_at IS NULL` gate. Fine for v1. A future re-trigger scenario (e.g. force-re-run of first-win detection) would need idempotency via a stable derived key. Park until the case arises.

- **Onboarding agent first-trigger design (`CELLO_ONBOARDING` per-human-user DKG).** The `CELLO_ONBOARDING` agent should fire on the first-ever global DKG for a human user — not a second device or fifth agent. Reliable "has this human ever DKG'd before" detection without violating blind-witness privacy is unresolved. Do not ship this component until the design is complete. Park pending design.

- **GEO content execution (ongoing, not a DoD line).** The 10-listicle portfolio and 4-article collaboration cluster defined in `00_GEO_LISTICLE_STRATEGY.md` are content work, not infrastructure work. `DOD-BLOG-INFRA-1` builds the platform; the content executes against a 60-day calendar starting from launch week. Content publication is tracked in the build journal, not in this DoD.

---

## Related Documents

- [[M11-PRELAUNCH-REQUIREMENTS]] — the spec-of-record: full data schema, business intent, acceptance criteria per section
- [[M11-BUILD-JOURNAL]] — audit trail + evidence home
- [[M11-PROCEDURE]] — operating runbook (note: the existing PROCEDURE doc contains trust-signal boilerplate from M10 that has not been updated; read with that in mind)
- [[00_MASTER_PLAYBOOK]] — GTM master playbook (docs/planning/gtm/)
- [[00_PRELAUNCH_DEMAND_PLAYBOOK]] — 19 pre-launch demand tactics
- [[00_GEO_LISTICLE_STRATEGY]] — GEO content calendar and listicle portfolio
- [[2026-07-12_0622_waitlist-launch-plan]] — primary source for waitlist design decisions
