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

## Status legend
✅ PROVEN (enforcer-green) · 🟡 BUILT/UNVERIFIED-LIVE · 🟠 PARTIAL · ❌ NOT BUILT · 🅿️ PARKED

---

## Tier I — Invariants (must hold in every phase, every line)

- **DOD-INV-NO-SAAS** — no paid SaaS is used or referenced. Every service (email, tracking, analytics, URL shortening) is self-hosted on AWS, GCP, or open-source. Any implementation that takes a dependency on a billable third-party service is a blocking finding. — ❌
- **DOD-INV-DOMAIN** — all public and internal URLs are subdomains of `cello.mygentic.ai`. No other domain is used, linked to, or referenced in code, copy, or configuration. — ❌
- **DOD-INV-TWO-DOOR** — the waitlist has exactly two admission paths: (1) the slow door — signed up, earned points, admitted in a wave; (2) the fast door — an admitted user spends a premium invite code. No third path exists. — ❌
- **DOD-INV-WAVE-GATE** — wave admission is triggered by an operator action (infrastructure checkpoint), never by a calendar date or time-based automation. The wave-assembly function cannot be invoked except by an authenticated ops dashboard action. — ❌
- **DOD-INV-POINTS-CAPS** — no action can award points beyond its stated cap. Cap enforcement is at insert time in the DB, not in the application layer alone. A direct SQL insert past the cap must fail. — ❌
- **DOD-INV-HANDLE-UNIQUE** — one social handle maps to exactly one waitlist entry. `(platform, handle)` UNIQUE constraint on `waitlist_social_profiles`. A duplicate attempt at the DB layer is a hard reject. — ❌
- **DOD-INV-TOKEN-SINGLE-USE** — a waitlist token, once burned (`used_at` set), can never be re-used. A second attempt to burn the same token returns a clear error. No mechanism exists to un-burn a token. — ❌
- **DOD-INV-NO-PII-DIRECTORY** — the CELLO directory stores no PII. Waitlist-related data (email, social handles, queue position) lives in the waitlist Postgres DB only. `waitlist_agent_links` stores only `agent_pubkey` and `waitlist_user_id` — never email. — ❌
- **DOD-INV-STABLE-PK** — every new table keys on a stable UUID PK. No join, foreign key, or WHERE-match uses `email`, `agent_name`, or any other mutable attribute as an identity anchor. Looking up a user by email to *retrieve* their `waitlist_id` is correct; storing email as a FK in another table is not. — ❌

- **DOD-INV-NO-INFLATION** — queue positions and wave estimates are always computed from real data. No fabricated counts, padded queue sizes, or manufactured social proof exist anywhere in the system. A queue position of #84 means there are exactly 83 higher-ranked users. Any hardcoded queue size or fake wave assignment is a blocking finding. — ❌

---

## P0 — Capture (blocks everything)

- **DOD-LANDING-1** — signup form working end-to-end on the primary `cello.mygentic.ai/waitlist` page. **Existing:** `app/waitlist/WaitlistContent.tsx` already renders a form (email + name fields) and POSTs to a Lambda; duplicate-email 409 and confirm-inbox states both handled. **P0 remaining work:** (a) wire form to the new schema endpoint (new Postgres DB, not the old Lambda); (b) include `anon_id` + `touchpoints[]` in the POST body (per DOD-TRACKING-1 script); (c) extract `ref` from `localStorage` touchpoints and include in submission; (d) the name field is optional — schema allows it but the new `waitlist_users` table has no `name` column, so drop it or map to a notes field. Do NOT rebuild the page. — 🟠

- **DOD-SCHEMA-P0-1** — migrations for all P0 tables deployed and idempotent:
  - `waitlist_users`: `waitlist_id` (UUID PK), `email` (unique), `anon_id`, `points_total` (default 0), `status` (waiting/admitted/banned), `email_verified` (bool), `content_alerts` (bool, default false), `feedback_eligible` (bool, default false), `feedback_eligible_date` (timestamptz nullable), `first_touch_source`, `first_touch_ref`, `last_touch_source`, `last_touch_ref`, `touchpoints_json` (JSONB), `created_at`, `admitted_at` (nullable), `first_win_at` (nullable).
  - `waitlist_touchpoints`: `id` (UUID PK), `waitlist_user_id` (FK), `anon_id`, `ts`, `url`, `referrer`, `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`, `ref`.
  - `referral_codes`: `code` (unique), `owner_waitlist_user_id` (FK), `active` (bool).
  - `referrals`: `id` (UUID PK), `referrer_user_id` (FK), `referred_user_id` (FK, UNIQUE), `referral_code`.
  - `email_jobs`: `id` (UUID PK), `user_id` (FK), `template` (enum), `scheduled_at`, `sent_at` (nullable), `status` (pending/sent/skipped).
  - `auth_tokens`: `token` (UUID PK), `waitlist_user_id` (FK), `created_at`, `expires_at` (15 minutes), `used_at` (nullable). Single-use magic-link credential — distinct from `waitlist_tokens` (wave admission grants).
  Fresh schema == migrated schema. — ❌

- **DOD-TRACKING-1** — localStorage tracking script deployed on every page of corp-cello-site:
  - Generates and persists `wl_anon_id` (UUID) on first visit.
  - Captures UTM params + `ref` code on every page load with meaningful signal. Appends to `wl_touchpoints[]`. De-duplicates identical consecutive entries. Caps at 20 entries.
  - Sets `wl_user_id` in localStorage post-signup.
  Verified: open the landing page in an incognito window, check localStorage for `wl_anon_id` and `wl_touchpoints`. Visit again with `?utm_source=test` — a new touchpoint is appended. Visit again immediately with the same params — no duplicate. — ❌

- **DOD-SIGNUP-1** — signup endpoint accepts `{email, anon_id, touchpoints[]}`. Inserts `waitlist_users`, bulk-inserts `waitlist_touchpoints`, derives first/last touch, generates `referral_code` in `referral_codes`, enqueues E1 email within 60 seconds. If a `ref=CODE` touchpoint exists and the code is valid + active, inserts a row in `referrals` and enqueues a +10 point job for the referrer (cap enforced). Duplicate email returns a clear error (not a server 500). — ❌

- **DOD-AUTH-1** — auth + session flows live in corp-cello-site (new routes, same repo and design system — no separate deployment). **Existing:** `app/confirm/ConfirmContent.tsx` already handles the E1 token-verify flow (GET `?token=`, success/expired/invalid states). **Borrow from cello-portal:** `src/server/magic-link.ts` (single-use token, `FOR UPDATE SKIP LOCKED`, rate-limiting, no-enumeration pattern), `src/server/session-cookie.ts` (HttpOnly cookie, Secure/SameSite), `src/server/session.ts` (session CRUD), `src/server/email.ts` (SES via task role, HTML template pattern). The status-site variant is simpler: the directory lookup in `requestMagicLink` is replaced by a `waitlist_users` email lookup; everything else copies verbatim. **P0 remaining work:**
  1. **E1 upgrade:** update `/confirm` to also set `email_verified = true` in the new Postgres DB, issue a 30-day HttpOnly session cookie, and redirect to `/status` on success.
  2. **`/auth` page (new):** email input. If email not in `waitlist_users` → redirect to `/waitlist` with message "We don't have this email on the waitlist." If found → send magic link (new `auth_tokens` row, 15-min expiry, single-use), show "Check your inbox." No indication of whether the email was found (prevents enumeration).
  3. **Session guard:** unauthenticated visits to `/status` redirect to `/auth`. Sessions expire after 30 days of issue; expiry redirects to `/auth`.
  Verified: (a) click E1 link → land on `/status` with session; (b) visit `/auth` with unknown email → `/waitlist` redirect; (c) visit `/auth` with known email → magic link arrives, clicking creates session; (d) re-use the same magic link → rejected. — 🟠

- **DOD-STATUS-STUB-1** — P0 stub `/status` page (authenticated, session-gated). Shows: confirmation they're on the waitlist, their queue position (live computed), their personal referral link with a copy button. No survey, no OAuth buttons, no points breakdown — those are P1 (DOD-STATUS-PAGE-1 replaces this stub). Corp site branding. — ❌

- **DOD-EMAIL-INFRA-1** — SES + Lambda email pipeline. **Existing:** SES domain verification and DKIM/DMARC are already live (Lambda at `h8dh7rbhb1.execute-api.us-east-1.amazonaws.com` is in production sending E1 today). **P0 remaining work:** (a) confirm SES production access is already granted (not sandbox); (b) wire the new `email_jobs` table → SQS → Lambda → SES path (the existing Lambda is not driven by `email_jobs` — it responds to direct API calls; this replaces that pattern); (c) add bounce + complaint SNS handling if not already present. If SES prod access is confirmed and DKIM/DMARC are set, the domain-verification AC is ✅ as-is. — 🟠

- **DOD-E1-1** — E1 (confirmation) email template updated. **Existing:** E1 confirmation email already sends via the current Lambda (24-hour token link, confirm-your-spot body). **P0 remaining work:** update the template to include (a) queue position (computed from new DB), (b) personal referral link, (c) a one-sentence "how waves work" note, (d) update the verify link to point to `/confirm` on the new auth path (which issues a session on click). Old 24-hour token window → new 15-minute `auth_tokens` window for the magic-link re-access flow; the E1 link itself can remain longer-lived (24-hour is fine for initial verify). Sent within 60 seconds of signup. — 🟠

- **DOD-QUEUE-VIEW-1** — `queue_position` is a computed SQL view (never a stored column). Uses `RANK()` over `points_total DESC, created_at ASC` where `status = 'waiting'`. Verified: insert two users with different points; confirm position 1 is the higher-points user; insert a third between them on points; confirm positions shift. — ❌

- **DOD-SES-PROD-1** — SES production access granted by AWS. Sending limits confirmed in console. Bounce + complaint handling: SNS topic → Lambda → marks `status = 'bounced'` or `status = 'complained'` on `waitlist_users`. Bounced/complained users receive no further emails. Verified: send to an SES simulator bounce address; confirm the user's status is updated within 2 minutes. — ❌

---

## P1 — Priority Engine (needs P0)

- **DOD-SCHEMA-P1-1** — migrations for all P1 tables deployed and idempotent:
  - `points_ledger`: `id` (UUID PK), `waitlist_user_id` (FK), `points` (signed int), `reason` (enum: survey/technical_readiness/share_conversion/public_post/interview_commit), `meta` (JSONB), `created_at`. Insert trigger updates `waitlist_users.points_total`. Cap enforcement at insert: for capped actions, the sum of existing rows for that reason plus the new `points` may not exceed the cap; overflow inserts are rejected with a named error.
  - `waitlist_social_profiles`: `id` (UUID PK), `waitlist_user_id` (FK), `platform` (enum: x/reddit/linkedin), `handle`, `oauth_access_token` (encrypted). UNIQUE on `(platform, handle)`.
  - `post_review_queue`: `id` (UUID PK), `waitlist_user_id` (FK), `platform`, `post_url`, `submitted_at`, `reviewed_at` (nullable), `outcome` (nullable enum: approved/rejected).
  — ❌

- **DOD-SURVEY-1** — survey page (linked from status page and E2 email). Staged form: completes in one submit. `POST /waitlist/survey` inserts a +30 row in `points_ledger`. Idempotent — a second submit is a no-op (the cap is 30 with no re-award). Verified: complete survey twice; `points_total` increases by exactly 30, not 60. — ❌

- **DOD-READINESS-1** — technical readiness action: `POST /waitlist/readiness`. +20 points. Idempotent. The frontend prompt is: "Star the repo on GitHub and run `npx @cello-protocol/connect` once." The endpoint requires neither — the stars and the `npm install` event are not yet verifiable programmatically; this is an honor system +20 for now. (Post-v1: wire to GitHub star webhook + npm install event.) Verified: call the endpoint twice; points increase by exactly 20, not 40. — ❌

- **DOD-OAUTH-SOCIAL-1** — OAuth flows for X, Reddit, LinkedIn. On completion: write to `waitlist_social_profiles`. Enforce `(platform, handle)` uniqueness — duplicate returns a user-facing error explaining the handle is already registered. Token encrypted at rest. Verified: connect two different waitlist accounts to the same X handle; the second attempt fails with a clear message. — ❌

- **DOD-POST-CREDIT-1** — `POST /waitlist/post-url` writes to `post_review_queue` (status: pending). Credit is NOT awarded immediately. A `platform` field is required; post URL must at least be parseable for the correct domain (x.com, reddit.com, linkedin.com). Verified: submit a URL; `post_review_queue` gains a row with `reviewed_at = NULL`. — ❌

- **DOD-INTERVIEW-COMMIT-1** — `POST /waitlist/interview-commit` awards +15 points. Idempotent. Records a `meta: {committed_at: iso8601}` in the ledger row. Verified: call twice; points increase by exactly 15, not 30. — ❌

- **DOD-STATUS-PAGE-1** — authenticated status page (email-verified session). Shows: queue position (live computed), points total, points breakdown by action (with cap indicators), survey link (if not completed), referral link with share button, OAuth connect buttons for X/Reddit/LinkedIn, post URL submission field (for platforms where OAuth is connected), content alert opt-in checkbox (unchecked by default). No fabricated queue estimates. — ❌

- **DOD-CONTENT-ALERTS-1** — content alert opt-in: checkbox on status page, unchecked by default. Label: *"Notify me when new articles, demos, or posts are published. (During launch this may arrive up to twice a day — unsubscribe anytime.)"* Sets `content_alerts = true` in `waitlist_users`. Unsubscribe link in every E-alert email sets `content_alerts = false` in one click, no other action. Verified: opt in, check DB, unsubscribe via link, check DB again. — ❌

- **DOD-EMAIL-DRIP-1** — drip pipeline: EventBridge cron polling `email_jobs` every minute via Lambda.
  - E2 (+1 day after signup): enqueued at signup with `scheduled_at = created_at + 1 day`. Body: survey link, share link, readiness checklist.
  - E3 (every 2 weeks while `status = 'waiting'`): sent to base list only (`content_alerts` flag irrelevant). Body: build-log update + wave movement note. First E3 is enqueued at signup; each send enqueues the next.
  Verified: set `scheduled_at` to now on a test E2 job; confirm Lambda fires and SES delivers within 2 minutes. — ❌

- **DOD-UTM-TOOL-1** — UTM link generator in the ops dashboard (see P2, but the data model is P1). Inputs: base URL, channel, campaign slug, optional creator `ref`. Output: fully tagged URL with `utm_source`, `utm_medium`, `utm_campaign`, `utm_content` (optional), `ref`. Every piece of outbound content uses a link from this tool. (The UI surface is in DOD-OPS-DASHBOARD-1; this line defines the endpoint and format.) — ❌

---

## P2 — Admission & Invites (needs P1; Wave 1 can run manually before P2 is complete)

- **DOD-SCHEMA-P2-1** — migrations for all P2 tables deployed and idempotent:
  - `waitlist_tokens`: `token` (UUID PK), `waitlist_user_id` (FK), `created_at`, `expires_at`, `used_at` (nullable).
  - `telegram_accounts`: `telegram_id` (TEXT PK), `waitlist_user_id` (FK, nullable), `source` (enum: waitlist_token/ops_override), `linked_at`.
  - `waitlist_agent_links`: `agent_pubkey` (TEXT PK), `waitlist_user_id` (FK), `linked_at`.
  - `creator_tracking`: `id` (UUID PK), `creator_handle`, `event_type` (enum: visit/signup/activation), `session_id`, `created_at`.
  — ❌

- **DOD-WAVE-ASSEMBLY-1** — wave assembly logic (called only from ops dashboard, never automated):
  - Premium invitees fill the front of capacity first.
  - ~75% of remaining capacity → highest `points_total`, tie-broken by `created_at ASC`.
  - ~25% of remaining capacity → `points_total = 0` users by `created_at ASC`.
  - Sets `status = 'admitted'`, `admitted_at = NOW()` on affected rows.
  - Mints one `waitlist_token` per admitted user (UUID, `expires_at = NOW() + 14 days`, `used_at = NULL`).
  - Enqueues E-inv email for each admitted user.
  Verified: seed 10 users with varying points; run assembly for capacity 4; confirm the right 4 are admitted and each has a token. — ❌

- **DOD-E-INV-1** — E-inv (wave admission) email: sent within 60 seconds of wave assembly. Body: install command, the user's single-use waitlist token, 14-day claim window. **Wave 1 variant** includes a calendar link for scheduling the mandatory 30-minute onboarding call. **Wave 2+ variant** includes a quickstart link instead. The wave number is passed to the email template and determines which variant renders. Under 200 words. Verified: trigger wave assembly for one user; confirm E-inv arrives within 60 seconds containing the correct token and the correct variant content. — ❌

- **DOD-TELEGRAM-GATE-1** — Telegram bot gate logic updated:
  1. Is `telegram_id` in `telegram_accounts`? Yes → proceed as normal.
  2. No → ask for waitlist token.
  3. Validate: token exists + `used_at IS NULL` + `expires_at > NOW()`. Fail on any condition with a named error message.
  4. On success: set `used_at = NOW()`, insert `telegram_accounts` (`source = 'waitlist_token'`), insert `waitlist_agent_links` (`agent_pubkey`, `waitlist_user_id`). Proceed to DKG.
  Live end-to-end enforcer: burn a real token on a test Telegram account; confirm DKG proceeds; confirm `used_at` is set; confirm a second burn attempt fails. — ❌

- **DOD-FIRST-WIN-1** — first-win event detection. Fires when a session seals for the first time for this `waitlist_user_id` (globally — not per-agent). Trigger: session seal event from the daemon → lookup `waitlist_agent_links` by `agent_pubkey` → if `waitlist_users.first_win_at IS NULL` for the linked user, this is the first win.
  On first win:
  - Issue 3 premium invite codes (new rows in `referral_codes` with `owner_waitlist_user_id` set, `active = true`).
  - Set `first_win_at = NOW()` on `waitlist_users`.
  - Enqueue E-win email.
  Idempotent: a second sealed session for the same user changes nothing. Verified: simulate two seal events for the same user; confirm 3 invite codes exist, `first_win_at` is set once, and only one E-win email is enqueued. — ❌
  **Note:** The mutual-connection reward (inviter + invitee auto-added to each other's address book when an invitee reaches first win) is a portal/client coordination item, not purely waitlist plumbing. It is tracked as a dependency here but designed and implemented in the portal/client work stream.

- **DOD-E-WIN-1** — E-win email template: subject, body. Contains: the 3 invite codes, a testimonial ask, a "share your first session" prompt (link to gallery if the session is shareable). Under 300 words. — ❌

- **DOD-FEEDBACK-DETECTION-1** — §5c high-activity detection Lambda on EventBridge daily schedule:
  - Thresholds: `≥5 sealed sessions within 14 days of admitted_at`, OR `≥1 cross-operator session within 14 days`.
  - Writes `feedback_eligible = true`, `feedback_eligible_date = NOW()` where not already set. Idempotent.
  - Verified: seed session telemetry crossing the threshold; run Lambda manually; confirm `feedback_eligible = true` and `feedback_eligible_date` set. Idempotency: run again; no change to existing rows. — ❌

- **DOD-FEEDBACK-OUTREACH-1** — outreach sequence automation:
  - Day 0 (same day `feedback_eligible` is set): enqueue a `CELLO_FEEDBACK` session initiation event AND an SES email (under 150 words, calendar link). `email_jobs` with `scheduled_at = NOW()`.
  - Day 6, no response: auto-grant 2 premium invite codes; set a status-page note.
  - "Call completed" action in ops dashboard: grant 4 invites (if 2 already issued, grant 2 more).
  Verified: set `feedback_eligible = true` on a test user; confirm both same-day items are enqueued. — ❌

- **DOD-E-RE-1** — re-engagement email (E-re): scheduled 60 days after `created_at` for users still `status = 'waiting'` with no activity in 30 days. Body: brief update + explicit "no hard feelings" unsubscribe path (one click, permanent, sets `status = 'unsubscribed'`). — ❌

- **DOD-OPS-DASHBOARD-1** — ops dashboard live at `operations.cello.mygentic.ai`. New repo (cello-portal clone — copy the repo as the starting point). **Borrow from cello-portal verbatim:** `src/server/magic-link.ts`, `src/server/session-cookie.ts`, `src/server/session.ts`, `src/server/session-request.ts`, `src/server/email.ts`, `src/server/db.ts`, `src/server/config.ts`, `src/server/logger.ts`, the full `src/app/api/auth/magic-link/` route tree, `migrations/0001_init.sql` (accounts + sessions) and `migrations/0002_magic_link_requests.sql`. Strip: WebAuthn, TOTP, trust signals, directory client, agents — none of that belongs here. **Auth change from portal:** instead of directory-gated entry (resolves email against CELLO directory), the ops dashboard resolves against a static allowlist from AWS Secrets Manager key `cello/ops/allowed-emails` (JSON array). Magic link to an unknown email → silent rejection (same no-enumeration shape). Pages:
  - **Post review queue:** list of pending URLs with Approve/Reject buttons. Approve → inserts +15 to `points_ledger` (cap enforced).
  - **Wave management:** queue view (position, email, points, status); "Open wave" form (capacity integer → runs DOD-WAVE-ASSEMBLY-1 logic).
  - **Feedback pipeline:** list of `feedback_eligible = true` users; "Mark call complete" button.
  - **Content alert trigger:** article URL + one-sentence description → enqueues E-alert to all `content_alerts = true` users.
  - **Telegram accounts:** add a `telegram_id` with `source = ops_override` (staff bypass); view existing linked accounts.
  - **UTM link generator:** outputs a fully tagged URL.
  Verified: log in with an allowed email, confirm magic link arrives, confirm each page loads and its primary action completes successfully. — ❌

- **DOD-E-ALERT-1** — content alert email (E-alert): sent only to `content_alerts = true` users. Triggered from ops dashboard. One sentence + link. Under 100 words. Hard limit: the ops dashboard blocks a second E-alert send within the same calendar day (UTC). — ❌

- **DOD-DYNAMIC-ESTIMATOR-1** — dynamic wave estimator on the status page. Shows estimated wave number based on current queue position and planned wave sizes. Recalculates on every page load. Never shows a hardcoded wave assignment. Copy: "Your estimated wave" with a note that it updates as the queue moves. — ❌

---

## P3 — Gallery & GEO Infrastructure (can run in parallel with P1/P2)

- **DOD-GALLERY-1** — gallery live at `gallery.cello.mygentic.ai` in corp-cello-site repo. Corp site header + footer, same design system. Corp site nav gains a "Gallery" item linking to the gallery index. No auth required on any gallery page. SSR-rendered (bot-indexable). Robots.txt allows all crawlers on `/gallery/*`. — ❌

- **DOD-GALLERY-RECEIPT-1** — individual receipt page at `gallery.cello.mygentic.ai/receipt/[hash]`. Shows: both agent monikers, session timestamp, Merkle hash, directory verification status ("Verified by N-of-3 nodes"), message count. Share buttons: copy link, share to X (pre-filled text), share to LinkedIn. The sealed receipt footer on every CELLO session carries `Verified by CELLO — gallery.cello.mygentic.ai/receipt/[hash]`. — ❌

- **DOD-GALLERY-PRIVACY-1** — publishing a receipt is opt-in. Default: sealed receipts are private (no public URL exists). The portal/client "Share publicly" action publishes a receipt by writing to the gallery's data store. Published receipts are irrevocable (the hash is permanent — no delete UI). The gallery page makes no reference to unpublished receipts. — ❌

- **DOD-GALLERY-INDEX-1** — gallery index at `gallery.cello.mygentic.ai/` shows a card grid of published receipts: agent monikers, timestamp, verification badge. Cards link to the receipt page. Supports at least basic pagination (20 per page). — ❌

- **DOD-BLOG-INFRA-1** — blog infrastructure complete. **Existing:** the blog is already a Next.js route in corp-cello-site at `/blog` (not Ghost — do not change this). Two articles are live. JSON-LD blog/itemList/breadcrumb schemas are present. **Remaining work:** (a) Google Search Console property verified for `cello.mygentic.ai`; (b) GA4 tracking script deployed site-wide; (c) every article has `datePublished` + `dateModified` in Article schema and a visible "Last updated" line below H1; (d) FAQPage JSON-LD on articles that have FAQ sections; (e) confirm robots.txt allows all crawlers on `/blog/*`. Do NOT migrate to Ghost. — 🟠

- **DOD-OPENCLAW-SKILL-1** — `cello.md` skill file published to the OpenClaw skill directory. Covers: `cello_start_agent`, `cello_initiate_session`, `cello_send`, `cello_receive`, `cello_contacts`, `cello_sealed_receipt`. Contains 3–4 worked scenarios. Verified: the skill is discoverable in the OpenClaw directory by searching "CELLO" or "agent identity". — ❌

- **DOD-MCP-REGISTRY-1** — `@cello-protocol/connect` listed on: mcp.so, Smithery, Glama, and submitted to awesome-mcp-servers. Description text optimized for BOFU queries ("agent-to-agent identity", "trust signals", "MCP server for agent communication"). Verified: search "CELLO" on each platform; listing appears. — ❌

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

- **M11-D2 (2026-07-20, Andre) — All CELLO URLs are `*.cello.mygentic.ai`.** No other domain exists or is proposed. Gallery is `gallery.cello.mygentic.ai`. Ops dashboard is `operations.cello.mygentic.ai`. Blog is `blog.cello.mygentic.ai`. The receipt verifier is at `gallery.cello.mygentic.ai/receipt/[hash]`. This is final. Reverse: only if a domain acquisition changes the asset picture.

- **M11-D3 (2026-07-20) — Wave admission is operator-triggered, not automated.** Wave assembly is a function called by an authenticated ops dashboard action. No cron, no automatic threshold, no calendar date triggers admission. Reverse: automate after Wave 3, once the infrastructure-checkpoint pattern is understood.

- **M11-D4 (2026-07-20) — Social post credits require manual ops spot-check, not automated verification.** OAuth proves ownership of the platform handle. Post URL submission writes to `post_review_queue`. Credit applied only on ops approval. Automated scraping of post metrics introduces TOS risk and maintenance burden. Reverse: automate specific platforms post-v1 if volume makes manual review unscalable.

- **M11-D5 (2026-07-20) — Telegram gate is a single `telegram_accounts` table with a `source` column.** Both waitlist token holders and staff (ops override) are one lookup: "does this `telegram_id` exist in `telegram_accounts`?" Staff bypass writes a row with `source = 'ops_override'`, `waitlist_user_id = NULL`. No separate table, no flag on users, no code branch. Reverse: none foreseen — the single lookup is load-bearing for the simplicity of the gate logic.

- **M11-D6 (2026-07-20) — The first-win trigger uses `waitlist_agent_links` as the bridge.** The session seal event carries `agent_pubkey`. The waitlist DB has no `agent_pubkey` column. `waitlist_agent_links` is written at token-burn time (the one moment both identities are simultaneously present) and is the join key for `first_win_at` detection. Reverse: if a future onboarding path bypasses the Telegram gate, a second linking mechanism will be needed.

- **M11-D7 (2026-07-20) — Ops dashboard is a separate repo, cloned from cello-portal.** Does not share a deployment with the portal. Shares the same Postgres DB via a restricted IAM role. Separate repo enables independent deploy, separate allowlist management, and no risk of cello-portal's auth surface being accidentally widened. Reverse: merge back if maintenance of two Next.js deployments becomes a real burden.

- **M11-D9 (2026-07-20, revised 2026-07-20) — Waitlist status pages live in corp-cello-site, not a separate repo.** The `/auth` and `/status` pages are new routes in corp-cello-site. The existing `/confirm` page already does the E1 token-verify flow and shares the corp-site design system — extending it in-repo is strictly less work than cloning cello-portal. The cello-portal clone pattern is correct only for the ops dashboard (separate security boundary). Session cookie: 30-day HttpOnly, regardless of activity. Magic link (re-access) expiry: 15 minutes, single-use. `/auth` silently rejects unknown emails (no enumeration). Reverse: none foreseen — this was always the correct architecture.

- **M11-D10 (2026-07-20) — Wave 1 is categorically different from later waves.** Wave 1 is 10–20 hand-picked design partners. Onboarding call is mandatory. E-inv includes a calendar link. First win happens during the call. Later waves are self-serve: E-inv includes a quickstart link, no mandatory call. The E-inv template takes a wave number and renders the correct variant. Reverse: make all waves self-serve if Wave 1 logistics prove unscalable.

- **M11-D8 (2026-07-20) — Gallery is in corp-cello-site, not a standalone repo.** The gallery shares the corp site's header, footer, and design system. Adding it to the corp site is a new Next.js route, not a new service. Reverse: extract to a standalone Next.js app if gallery rendering needs differ substantially from the corp site (e.g. heavy SSG, separate CDN config).

---

## Parked
*(Genuine undecidable forks. Never silently dropped.)*

- **Automated post-URL verification (post-v1).** Programmatically verifying that a submitted post URL (a) actually exists, (b) is authored by the connected OAuth account, and (c) mentions CELLO — requires platform-specific scraping or API calls. TOS risk varies by platform. Currently: OAuth proves handle ownership; URL submission is honor system pending ops review. The volume question (how many submissions per day at scale) determines whether manual review is sustainable. Park until Wave 2 data exists.

- **Stable `issued_at` for idempotent re-minting (post-v1).** The first-win invite codes issued via `referral_codes` are per-event but idempotent by the `first_win_at IS NULL` gate. Fine for v1. A future re-trigger scenario (e.g. force-re-run of first-win detection) would need idempotency via a stable derived key. Park until the case arises.

- **Onboarding agent first-trigger design (`CELLO_ONBOARDING` per-human-user DKG).** The `CELLO_ONBOARDING` agent should fire on the first-ever global DKG for a human user — not a second device or fifth agent. Reliable "has this human ever DKG'd before" detection without violating blind-witness privacy is undesolved. Do not ship this component until the design is complete. Park pending design.

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
