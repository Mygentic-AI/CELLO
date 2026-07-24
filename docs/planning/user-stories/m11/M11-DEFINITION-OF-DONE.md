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

---

## Tier I — Invariants (must hold in every phase, every line)

- **DOD-INV-NO-SAAS** [all repos] — no paid SaaS is used or referenced. Every service (email, tracking, analytics, URL shortening) is self-hosted on AWS, GCP, or open-source. Any implementation that takes a dependency on a billable third-party service is a blocking finding. — 🟡 checked by `infra/scripts/verify-m11-invariants.sh` (denylist of named vendors); green → Journal Entry 19
- **DOD-INV-DOMAIN** [all repos] — all public and internal URLs are subdomains of `cello.mygentic.ai`. No other domain is used, linked to, or referenced in code, copy, or configuration. — 🟡 checked by `verify-m11-invariants.sh`; green → Journal Entry 19
- **DOD-INV-TWO-DOOR** [corp-cello-site, ops-dashboard] — the waitlist has exactly two admission paths: (1) the slow door — signed up, earned points, admitted in a wave; (2) the fast door — an admitted user spends a premium invite code. No third path exists. — 🟡 both doors exist and are distinguishable in the data (`premium_referred` split from `status='admitted'` in `0003`); no third path writes `status='admitted'`. Owed: wave assembly (P2) for the slow door's other half → Journal Entry 20
- **DOD-INV-WAVE-GATE** [ops-dashboard] — wave admission is triggered by an operator action (infrastructure checkpoint), never by a calendar date or time-based automation. The wave-assembly function cannot be invoked except by an authenticated ops dashboard action. — 🟠 no schedule exists and `opened_by` is required and recorded, so a wave always names its operator. Owed: the authenticated ops dashboard itself — until it exists, nothing but IAM restricts who invokes the function → Journal Entry 21
- **DOD-INV-POINTS-CAPS** [corp-cello-site] — no action can award points beyond its stated cap. Cap enforcement is at insert time in the DB, not in the application layer alone. A direct SQL insert past the cap must fail. — 🟡 BEFORE INSERT trigger in `0003`; proven by direct SQL (4th +10 share_conversion raises `points_cap_exceeded`). Owed: portal RDS → Journal Entry 10
- **DOD-INV-HANDLE-UNIQUE** [corp-cello-site] — one social handle maps to exactly one waitlist entry. `(platform, handle)` UNIQUE constraint on `waitlist_social_profiles`. A duplicate attempt at the DB layer is a hard reject. — 🟡 enforced in BOTH directions — `(platform, handle)` and `(waitlist_user_id, platform)` — with SQL-level tests for each. Owed: portal RDS → Journal Entry 16
- **DOD-INV-TOKEN-SINGLE-USE** [corp-cello-site] — a waitlist token, once burned (`used_at` set), can never be re-used. A second attempt to burn the same token returns a clear error. No mechanism exists to un-burn a token. — 🟠 one live grant per user enforced by a partial unique index, 14-day bound by CHECK, and nothing anywhere sets `used_at` back to NULL. Owed: the Telegram gate that burns it (DOD-TELEGRAM-GATE-1) → Journal Entry 21
- **DOD-INV-NO-PII-DIRECTORY** [corp-cello-site] — the CELLO directory stores no PII. Waitlist-related data (email, social handles, queue position) lives in the waitlist Postgres DB only. `waitlist_agent_links` stores only `agent_pubkey` and `waitlist_user_id` — never email. — 🟡 checked: no M11 Lambda references email alongside a directory table → Journal Entry 19
- **DOD-INV-STABLE-PK** [corp-cello-site, ops-dashboard] — every new table keys on a stable UUID PK. No join, foreign key, or WHERE-match uses `email`, `agent_name`, or any other mutable attribute as an identity anchor. Looking up a user by email to *retrieve* their `waitlist_id` is correct; storing email as a FK in another table is not. — 🟡 checked structurally (FK/PK/JOIN only, not WHERE) + all 12 tables assert a PK; `creator_tracking` moved off a TEXT `session_id` to a real FK in `0012` → Journal Entry 19

- **DOD-INV-NO-INFLATION** [corp-cello-site, ops-dashboard] — queue positions and wave estimates are always computed from real data. No fabricated counts, padded queue sizes, or manufactured social proof exist anywhere in the system. A queue position of #84 means there are exactly 83 higher-ranked users. Any hardcoded queue size or fake wave assignment is a blocking finding. — 🟡 queue position is a computed view, never stored; reviewer confirmed no hardcoded counts in the P0 diff → Journal Entries 8, 11

- **DOD-INV-NO-DIRECTORY-RELAY** [trustless-cello] — M11 never modifies directory node or relay node code. The only trustless-cello touches are Lambda code (Telegram gate, first-win detection, feedback detection) and docs. Any change to `packages/directory/`, `packages/relay/`, or their CloudFormation stacks is out of scope and a blocking finding. No directory deploy is triggered by M11 work. — 🟡 checked by git diff over the whole M11 range; zero files touched → Journal Entry 19

- **DOD-INV-SINGLE-DB** [corp-cello-site, ops-dashboard] — all M11 database work targets the portal's existing RDS instance. No new database is provisioned. Waitlist tables are additive schema in the portal DB. No M11 migration, query, or connection touches the CELLO directory databases (one per region). An import or connection string pointing at a directory DB is a blocking finding. — 🟡 checked: no directory-DB reference and no hardcoded RDS endpoint anywhere; every Lambda connects via `DATABASE_URL` → Journal Entry 19

- **DOD-INV-EMAIL-SEGMENTS** [trustless-cello] — two email segments exist and are never conflated: the **base list** (all verified signups, receives E1/E2/E3/E-inv/E-win/E-re) and the **content alert list** (`content_alerts = true`, receives E-alert only). An E-alert query that omits the `content_alerts = true` filter is a blocking finding. An E3 send that filters on `content_alerts` is also wrong — E3 goes to the base list unconditionally. — 🟡 enforced in the dispatcher; both directions tested (an e_alert to a non-opted-in user, and E1 unaffected by the flag). Owed: live send → Journal Entry 12

- **DOD-INV-EMAIL-SUPPRESS** [trustless-cello] — the email pipeline must check `email_status = 'active'` before every send. A send to a suppressed address (`bounced` / `complained` / `unsubscribed`) is a blocking finding. Suppression is independent of waitlist lifecycle status — an `admitted` user with `email_status = 'bounced'` receives zero emails. — 🟡 checked before every send; bounced/complained/unsubscribed all tested, plus the admitted-but-bounced case explicitly. Owed: live send + the bounce SNS handler that SETS these statuses → Journal Entry 12

- **DOD-INV-PREMIUM-BEARER** [corp-cello-site] — premium invite codes are bearer tokens burned on first successful signup. They are never email-bound. The `/invite/CODE` route stores the code in localStorage; the signup form reads and submits it silently. A code that burns without a completed signup (e.g. on a failed validation) is a defect. An unburned code remains live for the inviter to share with someone else. — 🟡 `/invite` stores + forwards without validating or burning; the form reads and submits it silently; burn is server-side under `FOR UPDATE` on a completed signup, with a two-thread test. Owed: a live run → Journal Entry 20

- **DOD-INV-NO-ENUMERATION** [corp-cello-site] — `/auth` must never reveal whether an email exists in the system. The response ("Check your inbox") is identical for known and unknown emails. Any observable difference — redirect, message text, HTTP status, or response timing — between the two cases is a blocking finding. — 🟡 identical body/status/headers asserted, plus a fixed response floor with a test bounding the known-vs-unknown timing gap under 60ms; rate limiting counts requested addresses regardless of existence → Journal Entry 14

---

## P0 — Capture (blocks everything)

- **DOD-LANDING-1** [corp-cello-site] — signup form working end-to-end on the primary `cello.mygentic.ai/waitlist` page. **Existing:** `app/waitlist/WaitlistContent.tsx` already renders a form (email + name fields) and POSTs to a Lambda; duplicate-email 409 and confirm-inbox states both handled. **P0 remaining work:** (a) wire form to the new schema endpoint (new Postgres DB, not the old Lambda); (b) include `anon_id` + `touchpoints[]` in the POST body (per DOD-TRACKING-1 script); (c) extract `ref` from `localStorage` touchpoints and include in submission; (d) the name field is optional — schema allows it but the new `waitlist_users` table has no `name` column, so drop it or map to a notes field. Do NOT rebuild the page. — 🟠 form wiring exists but POSTs to `/api/waitlist/signup`, which does not exist in the deployed static export — 404 in production → Journal Entry 6

- **DOD-SCHEMA-P0-1** [corp-cello-site] — migrations for all P0 tables deployed and idempotent:
  - `waitlist_users`: `waitlist_id` (UUID PK), `email` (unique), `anon_id`, `display_name` (TEXT NULL), `points_total` (default 0), `status` (waiting/admitted/banned), `email_status` (active/unsubscribed/complained/bounced), `email_verified` (bool), `content_alerts` (bool, default false), `feedback_eligible` (bool, default false), `feedback_eligible_date` (timestamptz nullable), `first_touch_source`, `first_touch_ref`, `last_touch_source`, `last_touch_ref`, `touchpoints_json` (JSONB), `created_at`, `admitted_at` (nullable), `first_win_at` (nullable), `wave_number` (nullable).
  - `waitlist_touchpoints`: `id` (UUID PK), `waitlist_user_id` (FK), `anon_id`, `ts`, `url`, `referrer`, `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`, `ref`.
  - `referral_codes`: `code` (unique), `owner_waitlist_user_id` (FK **nullable**), `creator_handle` (TEXT nullable), `type` (enum: share/premium), `active` (bool). CHECK constraint: exactly one of `owner_waitlist_user_id` or `creator_handle` is non-null. Waitlist-user codes (regular referral, premium invite) set `owner_waitlist_user_id`; external creator codes set `creator_handle` with `owner_waitlist_user_id = NULL`.
  - `referrals`: `id` (UUID PK), `referrer_user_id` (FK), `referred_user_id` (FK, UNIQUE), `referral_code`.
  - `email_jobs`: `id` (UUID PK), `user_id` (FK), `template` (enum), `scheduled_at`, `sent_at` (nullable), `status` (pending/sent/skipped).
  - `auth_tokens`: `token` (UUID PK), `waitlist_user_id` (FK), `created_at`, `expires_at` (15 minutes), `used_at` (nullable). Single-use magic-link credential — distinct from `waitlist_tokens` (wave admission grants).
  Fresh schema == migrated schema. — 🟡 H5 FIXED. `schema_migrations` ledger + checksums added; `0001` restored to immutable form with its edits moved to `0002`; enforcer now replays the original migration set forward and proves tampering is rejected. All five properties green on Postgres 16. Owed: application to the portal RDS (M11-D22) → Journal Entry 9

- **DOD-TRACKING-1** [corp-cello-site] — localStorage tracking script deployed on every page of corp-cello-site:
  - Generates and persists `wl_anon_id` (UUID) on first visit.
  - Captures UTM params + `ref` code on every page load with meaningful signal. Appends to `wl_touchpoints[]`. De-duplicates identical consecutive entries. Caps at 20 entries.
  - Sets `wl_user_id` in localStorage post-signup.
  Verified: open the landing page in an incognito window, check localStorage for `wl_anon_id` and `wl_touchpoints`. Visit again with `?utm_source=test` — a new touchpoint is appended. Visit again immediately with the same params — no duplicate. — 🟡 script ships in the static export and is unit-tested, but the stated browser verification was never performed → Journal Entry 6

- **DOD-SIGNUP-1** [corp-cello-site] — signup endpoint accepts `{email, anon_id, touchpoints[]}`. Inserts `waitlist_users`, bulk-inserts `waitlist_touchpoints`, derives first/last touch, generates `referral_code` in `referral_codes` (`owner_waitlist_user_id` set, `creator_handle = NULL`, `type = 'share'`), enqueues E1 email within 60 seconds. If a `ref=CODE` touchpoint exists and the code is valid + active: (a) if `owner_waitlist_user_id` is set → inserts into `referrals`, enqueues +10 point job for referrer (cap enforced); (b) if `creator_handle` is set → inserts into `creator_tracking` (`event_type = 'signup'`, `creator_handle` from the code row), no points awarded. If the code has `type = 'premium'`, marks the new user as premium-referred and skips queue. Duplicate email returns a clear error (not a server 500). — 🟡 ported to `infra/lambda/waitlist-signup/` (Python 3.12) with all reviewer fixes; 21 tests green against real Postgres, revert-tested. Owed: VPC-attached deploy + API Gateway route (M11-D20 refinement) → Journal Entry 10

- **DOD-AUTH-1** [corp-cello-site] — auth + session flows live in corp-cello-site (new routes, same repo and design system — no separate deployment). **Existing:** `app/confirm/ConfirmContent.tsx` already handles the E1 token-verify flow (GET `?token=`, success/expired/invalid states). **Borrow from cello-portal** (read-only source): `src/server/magic-link.ts` (single-use token, `FOR UPDATE SKIP LOCKED`, rate-limiting, no-enumeration pattern), `src/server/session-cookie.ts` (HttpOnly cookie, Secure/SameSite), `src/server/session.ts` (session CRUD), `src/server/email.ts` (SES via task role, HTML template pattern). The status-site variant is simpler: the directory lookup in `requestMagicLink` is replaced by a `waitlist_users` email lookup; everything else copies verbatim. **P0 remaining work:**
  1. **E1 upgrade:** update `/confirm` to also set `email_verified = true` in the new Postgres DB, issue a 30-day HttpOnly session cookie, and redirect to `/status` on success.
  2. **`/auth` page (new):** email input. If email not in `waitlist_users` → redirect to `/waitlist` with message "We don't have this email on the waitlist." If found → send magic link (new `auth_tokens` row, 15-min expiry, single-use), show "Check your inbox." No indication of whether the email was found (prevents enumeration).
  3. **Session guard:** unauthenticated visits to `/status` redirect to `/auth`. Sessions expire after 30 days of issue; expiry redirects to `/auth`.
  Verified: (a) click E1 link → land on `/status` with session; (b) visit `/auth` with unknown email → `/waitlist` redirect; (c) visit `/auth` with known email → magic link arrives, clicking creates session; (d) re-use the same magic link → rejected. — 🟡 auth Lambda built (`infra/lambda/waitlist-auth/`): request/verify/session routes, hashed 30-day sessions, 15-min single-use magic links, atomic burn. 21 tests green. Owed: the static `/auth` + `/status` pages that call it, and a live run → Journal Entry 14

- **DOD-STATUS-STUB-1** [corp-cello-site] — P0 stub `/status` page (authenticated, session-gated). Shows: confirmation they're on the waitlist, their queue position (live computed), their personal referral link with a copy button. No survey, no OAuth buttons, no points breakdown — those are P1 (DOD-STATUS-PAGE-1 replaces this stub). Corp site branding. — 🟡 `/status` + `/auth` built as static pages calling the auth Lambda; both emit to `out/`; position rendered only when the server returns one. Owed: a live run against the deployed API → Journal Entry 15

- **DOD-EMAIL-INFRA-1** [trustless-cello, corp-cello-site] — SES + Lambda email pipeline. **Existing:** SES domain verification and DKIM/DMARC are already live (Lambda at `h8dh7rbhb1.execute-api.us-east-1.amazonaws.com` is in production sending E1 today). **P0 remaining work:** (a) confirm SES production access is already granted (not sandbox); (b) wire the new `email_jobs` table → SQS → Lambda → SES path (the existing Lambda is not driven by `email_jobs` — it responds to direct API calls; this replaces that pattern); (c) add bounce + complaint SNS handling if not already present. Lambda code + CloudFormation (SQS queue, SNS topic, EventBridge rule) in trustless-cello. The `email_jobs` table + enqueue calls in corp-cello-site. If SES prod access is confirmed and DKIM/DMARC are set, the domain-verification AC is ✅ as-is. — 🟠 dispatcher Lambda built (`infra/lambda/waitlist-email/`) draining `email_jobs` with suppression + segment enforcement, 14 tests green. Owed: CFN (EventBridge rule, VPC attach), SES prod-access confirmation, bounce/complaint SNS → Journal Entry 12

- **DOD-E1-1** [trustless-cello] — E1 (confirmation) email template updated. **Existing:** E1 confirmation email already sends via the current Lambda (24-hour token link, confirm-your-spot body). **P0 remaining work:** update the template to include (a) queue position (computed from new DB), (b) personal referral link, (c) a one-sentence "how waves work" note, (d) update the verify link to point to `/confirm` on the new auth path (which issues a session on click). Old 24-hour token window → new 15-minute `auth_tokens` window for the magic-link re-access flow; the E1 link itself can remain longer-lived (24-hour is fine for initial verify). Sent within 60 seconds of signup. — 🟡 template carries real queue position, referral link and the waves sentence; 24h `email_verify` token minted at send time (`0005` kind-aware CHECK). Owed: the email enforcer — a real SES send (M11-D22 class) → Journal Entry 12

- **DOD-QUEUE-VIEW-1** [corp-cello-site] — `queue_position` is a computed SQL view (never a stored column). Uses `RANK()` over `points_total DESC, created_at ASC` where `status = 'waiting'`. Verified: insert two users with different points; confirm position 1 is the higher-points user; insert a third between them on points; confirm positions shift. — 🟡 `waitlist_queue` view in `0004`; 7 tests green on real Postgres incl. a ledger-insert-moves-position test and an assertion that no stored column exists. Owed: portal RDS (M11-D22) → Journal Entry 11

- **DOD-SES-PROD-1** [trustless-cello] — SES production access granted by AWS. Sending limits confirmed in console. Bounce + complaint handling: SNS topic → Lambda → marks `email_status = 'bounced'` or `email_status = 'complained'` on `waitlist_users`. Bounced/complained users receive no further emails. Verified: send to an SES simulator bounce address; confirm the user's email_status is updated within 2 minutes. — 🟠 bounce/complaint handler built (`infra/lambda/waitlist-bounce/`), 11 tests incl. transient-not-suppressed and one-way suppression; end-to-end test proves a bounced address then receives nothing. Owed: SES production-access confirmation, the SNS topic + subscription (CFN), and the simulator run → Journal Entry 13

---

## P1 — Priority Engine (needs P0)

- **DOD-SCHEMA-P1-1** [corp-cello-site] — migrations for all P1 tables deployed and idempotent:
  - `points_ledger`: `id` (UUID PK), `waitlist_user_id` (FK), `points` (signed int), `reason` (enum: survey/technical_readiness/share_conversion/public_post/interview_commit), `meta` (JSONB), `created_at`. Insert trigger updates `waitlist_users.points_total`. Cap enforcement at insert: for capped actions, the sum of existing rows for that reason plus the new `points` may not exceed the cap; overflow inserts are rejected with a named error.
  - `waitlist_social_profiles`: `id` (UUID PK), `waitlist_user_id` (FK), `platform` (enum: x/reddit/linkedin), `handle`, `oauth_access_token` (encrypted). UNIQUE on `(platform, handle)`.
  - `post_review_queue`: `id` (UUID PK), `waitlist_user_id` (FK), `platform`, `post_url`, `submitted_at`, `reviewed_at` (nullable), `outcome` (nullable enum: approved/rejected).
  — 🟡 `points_ledger` + cap trigger in `0003` (M11-D23), social profiles + review queue in `0008`; 11 SQL-level constraint tests green. Owed: portal RDS (M11-D22) → Journal Entry 16

- **DOD-SURVEY-1** [corp-cello-site] — survey page (linked from status page and E2 email). Staged form: completes in one submit. Questions per M11-D15: (1) What would you use CELLO for? (multi-choice), (2) How many agents do you run? (0 / 1-2 / 3-9 / 10+), (3) What platforms? (multi-select). +20 for structured questions. Free-form "How do you imagine using this?" +10. Interview commit checkbox +30. `POST /waitlist/survey` inserts rows in `points_ledger` accordingly. Idempotent — a second submit is a no-op per reason (cap enforcement at DB). Verified: complete survey twice; `points_total` increases by the correct total only once, not doubled. — 🟡 `/waitlist/survey` in the actions Lambda; +20/+10 split, answers stored in `meta`, idempotency enforced by `0009` not by checking first → Journal Entry 17

- **DOD-READINESS-1** [corp-cello-site] — technical readiness action: `POST /waitlist/readiness`. +20 points. Idempotent. The frontend prompt is: "Star the repo on GitHub and run `npx @cello-protocol/connect` once." The endpoint requires neither — the stars and the `npm install` event are not yet verifiable programmatically; this is an honor system +20 for now. (Post-v1: wire to GitHub star webhook + npm install event.) Verified: call the endpoint twice; points increase by exactly 20, not 40. — 🟡 `/waitlist/readiness`; ten repeats award once, tested → Journal Entry 17

- **DOD-OAUTH-SOCIAL-1** [corp-cello-site] — OAuth flows for X, Reddit, LinkedIn. On completion: write to `waitlist_social_profiles`. Enforce `(platform, handle)` uniqueness — duplicate returns a user-facing error explaining the handle is already registered. Token encrypted at rest. Verified: connect two different waitlist accounts to the same X handle; the second attempt fails with a clear message. — 🅿️ PARKED — blocked on OAuth app registration with three external platforms, which only Andre can do. The DB half is done and tested (`0008` uniqueness, both directions); `/waitlist/post-url` already refuses a platform the user has not connected → Parked section

- **DOD-POST-CREDIT-1** [corp-cello-site] — `POST /waitlist/post-url` writes to `post_review_queue` (status: pending). Credit is NOT awarded immediately. A `platform` field is required; post URL must at least be parseable for the correct domain (x.com, reddit.com, linkedin.com). Verified: submit a URL; `post_review_queue` gains a row with `reviewed_at = NULL`. — 🟡 `/waitlist/post-url`; platform derived from host, unrecognised hosts REFUSED, and a post for an unconnected platform rejected 403 → Journal Entry 17

- **DOD-INTERVIEW-COMMIT-1** [corp-cello-site] — `POST /waitlist/interview-commit` awards +30 points (per M11-D15). Idempotent. Records a `meta: {committed_at: iso8601}` in the ledger row. Verified: call twice; points increase by exactly 30, not 60. — 🟡 `/waitlist/interview-commit`; `committed_at` recorded in `meta` → Journal Entry 17

- **DOD-STATUS-PAGE-1** [corp-cello-site] — authenticated status page (email-verified session). Shows: queue position (live computed), qualitative band ("top 10%", "top 25%", "top half") + explanation that waves are sized dynamically (per M11-D16 — no predicted wave number), points total, points breakdown by action (with cap indicators), survey link (if not completed), referral link with share button, OAuth connect buttons for X/Reddit/LinkedIn, post URL submission field (for platforms where OAuth is connected), content alert opt-in checkbox (unchecked by default). No fabricated queue estimates. — ❌

- **DOD-CONTENT-ALERTS-1** [corp-cello-site] — content alert opt-in: checkbox on status page, unchecked by default. Label: *"Notify me when new articles, demos, or posts are published. (During launch this may arrive up to twice a day — unsubscribe anytime.)"* Sets `content_alerts = true` in `waitlist_users`. Unsubscribe link in every E-alert email sets `content_alerts = false` in one click, no other action. Verified: opt in, check DB, unsubscribe via link, check DB again. — ❌

- **DOD-EMAIL-DRIP-1** [trustless-cello, corp-cello-site] — drip pipeline: EventBridge cron polling `email_jobs` every minute via Lambda (in trustless-cello). Enqueue calls at signup in corp-cello-site.
  - E2 (+1 day after signup): enqueued at signup with `scheduled_at = created_at + 1 day`. Body: survey link, share link, readiness checklist.
  - E3 (every 2 weeks while `status = 'waiting'`): sent to base list only (`content_alerts` flag irrelevant). Body: build-log update + wave movement note. First E3 is enqueued at signup; each send enqueues the next.
  Verified: set `scheduled_at` to now on a test E2 job; confirm Lambda fires and SES delivers within 2 minutes. — ❌

- **DOD-UTM-TOOL-1** [ops-dashboard, corp-cello-site] — UTM link generator (UI in ops dashboard per DOD-OPS-UTM-1; this line defines the data model and endpoint format). Inputs: base URL, channel, campaign slug, optional creator `ref`. Output: fully tagged URL with `utm_source`, `utm_medium`, `utm_campaign`, `utm_content` (optional), `ref`. When a creator handle is provided, creates/upserts a row in `referral_codes` (`creator_handle` set, `owner_waitlist_user_id = NULL`, `active = true`). Every piece of outbound content uses a link from this tool. — ❌

---

## P2 — Admission & Invites (needs P1; Wave 1 can run manually before P2 is complete)

- **DOD-SCHEMA-P2-1** [corp-cello-site] — migrations for all P2 tables deployed and idempotent:
  - `waitlist_tokens`: `token` (UUID PK), `waitlist_user_id` (FK), `created_at`, `expires_at`, `used_at` (nullable).
  - `telegram_accounts`: `telegram_id` (TEXT PK), `waitlist_user_id` (FK, nullable), `source` (enum: waitlist_token/ops_override), `linked_at`.
  - `waitlist_agent_links`: `agent_pubkey` (TEXT PK), `waitlist_user_id` (FK), `linked_at`.
  - `creator_tracking`: `id` (UUID PK), `creator_handle`, `event_type` (enum: visit/signup/activation), `session_id`, `created_at`.
  - `waves`: `wave_number` (PK), `capacity`, `priority_pct`, `zero_pct`, `opened_at`, `opened_by`.
  — 🟡 all five tables in `0013`, plus a split-within-capacity CHECK, one-live-grant-per-user, and telegram source consistency. Owed: portal RDS → Journal Entry 21

- **DOD-WAVE-ASSEMBLY-1** [ops-dashboard] — wave assembly logic (called only from ops dashboard, never automated):
  - Premium invitees fill the front of capacity first.
  - ~75% of remaining capacity → highest `points_total`, tie-broken by `created_at ASC`.
  - ~25% of remaining capacity → `points_total = 0` users by `created_at ASC`.
  - Sets `status = 'admitted'`, `admitted_at = NOW()`, `wave_number` on affected rows.
  - Mints one `waitlist_token` per admitted user (UUID, `expires_at = NOW() + 14 days`, `used_at = NULL`).
  - Inserts a row into `waves`.
  - Enqueues E-inv email for each admitted user.
  Verified: seed 10 users with varying points; run assembly for capacity 4; confirm the right 4 are admitted and each has a token. — 🟡 `infra/lambda/waitlist-waves/`; 27 tests incl. cohort ordering, one-token-per-user, and every capacity 1–7 admitting exactly that many. Owed: the ops dashboard that calls it, and a live run → Journal Entry 21

- **DOD-E-INV-1** [trustless-cello] — E-inv (wave admission) email: sent within 60 seconds of wave assembly. Body: install command, the user's single-use waitlist token, 14-day claim window. **Wave 1 variant** includes a calendar link for scheduling the mandatory 30-minute onboarding call. **Wave 2+ variant** includes a quickstart link instead. The wave number is passed to the email template and determines which variant renders. Under 200 words. Verified: trigger wave assembly for one user; confirm E-inv arrives within 60 seconds containing the correct token and the correct variant content. — 🟡 both variants render off `wave_number`; refuses to render without a live grant; word count asserted. Owed: the email enforcer (real SES send) → Journal Entry 22

- **DOD-TELEGRAM-GATE-1** [trustless-cello] — Telegram bot gate logic updated:
  1. Is `telegram_id` in `telegram_accounts`? Yes → proceed as normal.
  2. No → ask for waitlist token.
  3. Validate: token exists + `used_at IS NULL` + `expires_at > NOW()`. Fail on any condition with a named error message.
  4. On success: set `used_at = NOW()`, insert `telegram_accounts` (`source = 'waitlist_token'`), insert `waitlist_agent_links` (`agent_pubkey`, `waitlist_user_id`). Proceed to DKG.
  Live end-to-end enforcer: burn a real token on a test Telegram account; confirm DKG proceeds; confirm `used_at` is set; confirm a second burn attempt fails. — ❌

- **DOD-FIRST-WIN-1** [trustless-cello] — first-win event detection. Fires when a session seals for the first time for this `waitlist_user_id` (globally — not per-agent). Trigger: session seal event from the daemon → lookup `waitlist_agent_links` by `agent_pubkey` → if `waitlist_users.first_win_at IS NULL` for the linked user, this is the first win.
  On first win:
  - Issue 3 premium invite codes (new rows in `referral_codes` with `owner_waitlist_user_id` set, `type = 'premium'`, `active = true`).
  - Set `first_win_at = NOW()` on `waitlist_users`.
  - Enqueue E-win email.
  Idempotent: a second sealed session for the same user changes nothing. Verified: simulate two seal events for the same user; confirm 3 invite codes exist, `first_win_at` is set once, and only one E-win email is enqueued. — ❌
  **Note:** The mutual-connection reward (inviter + invitee auto-added to each other's address book when an invitee reaches first win) is a portal/client coordination item, not purely waitlist plumbing. It is tracked as a dependency here but designed and implemented in the portal/client work stream.

- **DOD-E-WIN-1** [trustless-cello] — E-win email template: subject, body. Contains: the 3 invite codes, a testimonial ask, a "share your first session" prompt (link to gallery if the session is shareable). Under 300 words. — 🟡 every code rendered as a usable `/invite/CODE` link; refuses to render with none; word count asserted. Owed: the email enforcer → Journal Entry 22

- **DOD-FEEDBACK-DETECTION-1** [trustless-cello] — §5c high-activity detection Lambda on EventBridge daily schedule:
  - Thresholds: `≥5 sealed sessions within 14 days of admitted_at`, OR `≥1 cross-operator session within 14 days`.
  - Writes `feedback_eligible = true`, `feedback_eligible_date = NOW()` where not already set. Idempotent.
  - Verified: seed session telemetry crossing the threshold; run Lambda manually; confirm `feedback_eligible = true` and `feedback_eligible_date` set. Idempotency: run again; no change to existing rows. — ❌

- **DOD-FEEDBACK-OUTREACH-1** [trustless-cello, ops-dashboard] — outreach sequence automation:
  - Day 0 (same day `feedback_eligible` is set): enqueue a `CELLO_FEEDBACK` session initiation event AND an SES email (under 150 words, calendar link). `email_jobs` with `scheduled_at = NOW()`. Lambda in trustless-cello.
  - Day 6, no response: auto-grant 2 premium invite codes; set a status-page note.
  - "Call completed" action in ops dashboard: grant 4 invites (if 2 already issued, grant 2 more).
  Verified: set `feedback_eligible = true` on a test user; confirm both same-day items are enqueued. — ❌

- **DOD-E-RE-1** [trustless-cello] — re-engagement email (E-re): scheduled 60 days after `created_at` for users still `status = 'waiting'` with no activity in 30 days. Body: brief update + explicit "no hard feelings" unsubscribe path (one click, permanent, sets `email_status = 'unsubscribed'`). — 🟠 template renders with the unsubscribe in the body, not the footer, and shows a real position or none. Owed: the `/unsubscribe` endpoint the link points at, plus the 60-day scheduler → Journal Entry 22

- **DOD-OPS-SHELL-1** [ops-dashboard] — ops dashboard repo created and deployed at `operations.cello.mygentic.ai`. New repo (cello-portal clone — copy the repo as the starting point; do NOT modify cello-portal itself). **Borrow from cello-portal verbatim:** `src/server/magic-link.ts`, `src/server/session-cookie.ts`, `src/server/session.ts`, `src/server/session-request.ts`, `src/server/email.ts`, `src/server/db.ts`, `src/server/config.ts`, `src/server/logger.ts`, the full `src/app/api/auth/magic-link/` route tree, `migrations/0001_init.sql` (accounts + sessions) and `migrations/0002_magic_link_requests.sql`. Strip: WebAuthn, TOTP, trust signals, directory client, agents — none of that belongs here. **Auth change from portal:** instead of directory-gated entry (resolves email against CELLO directory), the ops dashboard resolves against a static allowlist from AWS Secrets Manager key `cello/ops/allowed-emails` (JSON array). Magic link to an unknown email → silent rejection (same no-enumeration shape). Verified: log in with an allowed email, confirm magic link arrives, land on an empty dashboard shell. — ❌

- **DOD-OPS-POST-REVIEW-1** [ops-dashboard] — ops dashboard post review page. List of pending URLs from `post_review_queue` with Approve/Reject buttons. Approve → inserts +15 to `points_ledger` (cap enforced). Verified: submit a post URL from the status page; confirm it appears in the ops queue; approve it; confirm points credited. — ❌

- **DOD-OPS-WAVE-MGMT-1** [ops-dashboard] — ops dashboard wave management page. Queue view (position, email, points, status). "Open wave" form: takes a capacity integer plus priority/zero split percentages, runs DOD-WAVE-ASSEMBLY-1 logic, marks users as admitted, mints tokens, enqueues E-inv emails. Verified: seed users; open a wave for capacity 3; confirm the right users are admitted with tokens. — ❌

- **DOD-OPS-FEEDBACK-1** [ops-dashboard] — ops dashboard feedback pipeline page. List of `feedback_eligible = true` users. "Mark call complete" button → grants 4 premium invite codes (if 2 already issued from Day 6 auto-grant, grants 2 more to reach 4 total). Verified: mark a test user's call complete; confirm invite codes issued. — ❌

- **DOD-OPS-CONTENT-ALERT-1** [ops-dashboard, trustless-cello] — ops dashboard content alert trigger page. Article URL + one-sentence description → enqueues E-alert to all `content_alerts = true` users via Lambda (trustless-cello). Hard limit: blocks a second send within the same calendar day (UTC). Verified: trigger an alert; confirm email enqueued; attempt a second same-day trigger; confirm it's blocked. — ❌

- **DOD-OPS-TELEGRAM-1** [ops-dashboard] — ops dashboard Telegram accounts page. Add a `telegram_id` with `source = ops_override` (staff bypass); view existing linked accounts. Verified: add a telegram_id; confirm row appears in `telegram_accounts` with `source = 'ops_override'` and `waitlist_user_id = NULL`. — ❌

- **DOD-OPS-UTM-1** [ops-dashboard] — ops dashboard UTM link generator page. Inputs: base URL, channel, campaign slug, optional creator handle. If a creator handle is provided, the generator creates (or upserts) a row in `referral_codes` (`creator_handle` set, `owner_waitlist_user_id = NULL`, `active = true`) and includes `ref=CODE` in the output URL. Output: fully tagged URL with `utm_source`, `utm_medium`, `utm_campaign`, `utm_content` (optional), and `ref` (when a creator handle is supplied). Verified: generate a link with a creator handle; confirm `referral_codes` gains a row with `creator_handle` set and `owner_waitlist_user_id = NULL`; visit the link and sign up; confirm `creator_tracking` gains a `signup` event row. — ❌

- **DOD-E-ALERT-1** [trustless-cello] — content alert email (E-alert): sent only to `content_alerts = true` users. Triggered from ops dashboard. One sentence + link. Under 100 words. Hard limit: the ops dashboard blocks a second E-alert send within the same calendar day (UTC). — 🟠 template done, opt-in filter enforced and tested both ways, unsubscribe scoped to the alert list. Owed: the ops trigger and its same-day block → Journal Entry 22

- **DOD-DYNAMIC-ESTIMATOR-1** [corp-cello-site] — per M11-D16, no predicted wave number. Status page shows: real-time queue position, a qualitative band ("top 10%", "top 25%", "top half"), and a short explanation that waves are sized dynamically based on how the previous wave performed. Recalculates on every page load. Never shows a hardcoded wave assignment or estimated date. — ❌

---

## P3 — Gallery & GEO Infrastructure (can run in parallel with P1/P2)

- **DOD-GALLERY-1** [corp-cello-site] — gallery live at `gallery.cello.mygentic.ai` in corp-cello-site repo. Corp site header + footer, same design system. Corp site nav gains a "Gallery" item linking to the gallery index. No auth required on any gallery page. SSR-rendered (bot-indexable). Robots.txt allows all crawlers on `/gallery/*`. — ❌

- **DOD-GALLERY-RECEIPT-1** [corp-cello-site, cello-client] — individual receipt page at `gallery.cello.mygentic.ai/receipt/[hash]`. Shows: both agent monikers, session timestamp, Merkle hash, directory verification status ("Verified by N-of-3 nodes"), message count. Share buttons: copy link, share to X (pre-filled text), share to LinkedIn. The sealed receipt footer on every CELLO session carries `Verified by CELLO — gallery.cello.mygentic.ai/receipt/[hash]`. Receipt page in corp-cello-site; the footer format update is in cello-client. — ❌

- **DOD-GALLERY-PRIVACY-1** [cello-portal, corp-cello-site] — publishing a receipt is opt-in. Default: sealed receipts are private (no public URL exists). The portal "Share publicly" action (cello-portal) publishes a receipt by writing to the gallery's data store (corp-cello-site). Published receipts are irrevocable (the hash is permanent — no delete UI). The gallery page makes no reference to unpublished receipts. — ❌

- **DOD-GALLERY-INDEX-1** [corp-cello-site] — gallery index at `gallery.cello.mygentic.ai/` shows a card grid of published receipts: agent monikers, timestamp, verification badge. Cards link to the receipt page. Supports at least basic pagination (20 per page). — ❌

- **DOD-BLOG-INFRA-1** [corp-cello-site] — blog infrastructure complete. **Existing:** the blog is already a Next.js route in corp-cello-site at `/blog` (not Ghost — do not change this). Two articles are live. JSON-LD blog/itemList/breadcrumb schemas are present. **Remaining work:** (a) Google Search Console property verified for `cello.mygentic.ai`; (b) GA4 tracking script deployed site-wide; (c) every article has `datePublished` + `dateModified` in Article schema and a visible "Last updated" line below H1; (d) FAQPage JSON-LD on articles that have FAQ sections; (e) confirm robots.txt allows all crawlers on `/blog/*`. Do NOT migrate to Ghost. — 🟠

- **DOD-OPENCLAW-SKILL-1** [openclaw] — `cello.md` skill file published to the OpenClaw skill directory. Covers: `cello_start_agent`, `cello_initiate_session`, `cello_send`, `cello_receive`, `cello_contacts`, `cello_sealed_receipt`. Contains 3–4 worked scenarios. Verified: the skill is discoverable in the OpenClaw directory by searching "CELLO" or "agent identity". — ❌

- **DOD-MCP-REGISTRY-1** [no-code] — `@cello-protocol/connect` listed on: mcp.so, Smithery, Glama, and submitted to awesome-mcp-servers. Description text optimized for BOFU queries ("agent-to-agent identity", "trust signals", "MCP server for agent communication"). Verified: search "CELLO" on each platform; listing appears. — ❌

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

- **M11-D18 (2026-07-20, Andre) — `CELLO_FEEDBACK` agent is an operational provisioning task within M11.** The identity already exists in the directory. Remaining work: small EC2 instance, Hermes installed, CELLO installed, governance configured (no sensitive outbound), inbound reachability confirmed (NAT/networking). The Lambda trigger for feedback outreach is "initiate a session to this known pubkey" — standard protocol, no new code. A new DoD line covers: agent reachable inbound, responds to a test session initiation. Reverse: none.

---

## Parked
*(Genuine undecidable forks. Never silently dropped.)*

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
