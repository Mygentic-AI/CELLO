---
name: M11 Pre-Launch Technical Requirements
type: requirements
milestone: M11
description: >
  Comprehensive requirements document for the M11 pre-launch, waitlist rollout, and GTM tracking.
  Pairs the "Why" (business tactic) with the "What" (technical implementation) to serve as a standalone blueprint.
---

# M11 Pre-Launch Technical Requirements

This document translates the GTM Playbooks and Waitlist Strategy into concrete software requirements. It maps the business intent (the "Why") directly to the technical components we need to build (the "What") across the database, backend engine, client, and infrastructure.

All URLs are subdomains of `cello.mygentic.ai`. No external domains are used or proposed.

---

## Build Phase Ordering

Phases are ordered by dependency. P0 unblocks everything. P1 unblocks Wave 1. P2 can run in parallel with Wave 1 calls.

**P0 — Capture (blocks everything):**
- Landing page (corp-cello-site repo)
- One-field signup form + E1 confirmation email
- `waitlist_users` table, `waitlist_touchpoints` table, `referral_codes` table
- SES domain verification + production-access (submit early — AWS review lag)
- Personal share code generated at signup
- `localStorage` tracking script deployed on corp site

**P1 — Priority Engine (needs P0):**
- Survey page + scoring logic
- `points_ledger` table with cap enforcement
- Status page: queue position, points breakdown, survey link, share link, OAuth connect buttons, post URL submission field, content alert opt-in checkbox
- Social OAuth endpoints (X, Reddit, LinkedIn) + `waitlist_social_profiles` table
- Post URL spot-check queue (feeds ops dashboard)
- Content alert opt-in (`content_alerts` boolean in `waitlist_users`)
- E2 (day 1 bump) and biweekly E3 nurture sender

**P2 — Admission & Invites (needs P1; Wave 1 can run manually before P2 is done):**
- Wave assembly logic + wave admission tooling
- Waitlist token minter + 14-day expiry tracking
- Telegram gate update (token validation + burn + `telegram_accounts` write)
- First-win event detection + invite issuance + E-win email
- `feedback_eligible` threshold detection (Lambda on daily schedule)
- §5c outreach sequence automation
- Ops dashboard (operations.cello.mygentic.ai)

**P3 — Gallery & GEO Infrastructure (can run in parallel with P1/P2):**
- Gallery (gallery.cello.mygentic.ai) in corp-cello-site repo
- Ghost blog at blog.cello.mygentic.ai connected to Google Search Console + GA4
- GEO listicle content calendar (10 listicles, 60-day schedule — see §7)

---

## Success Metrics (Acceptance Criteria for Launch Readiness)

These are the go/no-go signals. A wave does not open until the relevant metrics are confirmed.

| Metric | Target | Alarm |
|---|---|---|
| Landing page → signup conversion | 20–40% | Below 10% = page problem |
| Signup → survey completion | Watch only — no target yet | This is the activation-intent signal |
| Time to first win (install → first sealed own-agent exchange) | <15 min guided (Wave 1) / <30 min self-serve | This is THE launch metric |
| Admitted → first win before next wave | >70% | Next wave does not open below this |
| Email open rate | 30–50% | List-cold below 25% |
| Invitee activation rate (RIAR — invitees reaching first win, still active at week 2) | Primary virality metric — ignore raw invites-sent | — |
| Waitlist → active conversion after admission | ~50% within 30 days | Sunset at 60–90 days |

---

## 1. Database & State (The Foundation)

**The Why:**
To run a referral-driven waitlist without paid SaaS, we need to own the data. We must track users, their priority scores, and exactly how they found us. Multi-touch attribution maps the full journey (Reddit → X → Signup) to understand which content drives quality conversions.

**The What:**

*   **`waitlist_users` table:** Primary key is `waitlist_id` (UUID). Join on this — never on email. Columns: `email` (unique), `anon_id`, `points_total`, `status` (waiting/admitted/banned), `email_verified` (bool), `content_alerts` (bool, default false), `feedback_eligible` (bool, default false), `feedback_eligible_date` (timestamptz nullable), `first_touch_source`, `first_touch_ref`, `last_touch_source`, `last_touch_ref`, `touchpoints_json` (JSONB), `created_at`, `admitted_at`.

*   **`waitlist_touchpoints` table:** `waitlist_user_id`, `anon_id`, `ts`, `url`, `referrer`, `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`, `ref`. Inserted in bulk at signup from the `localStorage` array.

*   **`points_ledger` table:** Append-only. `waitlist_user_id`, `points` (signed integer), `reason` (enum: `survey`, `technical_readiness`, `share_conversion`, `public_post`, `interview_commit`), `meta` (JSONB), `created_at`. Cap enforcement happens at insert time — an insert that would push a capped action past its ceiling is rejected.

    Canonical point values and caps:

    | Action | Points | Cap |
    |---|---|---|
    | Staged survey completion | +30 | none |
    | Technical readiness (runs agents + repo star) | +20 | none |
    | Share link (each signup through personal link) | +10 | +30 total |
    | Public post URL (X/Reddit/LinkedIn, verified via OAuth) | +15 | +45 total (3 platforms max) |
    | Interview commit (checkbox) | +15 | none |

*   **`referral_codes` table:** `code` (unique), `owner_waitlist_user_id`, `active` (bool).

*   **`referrals` table:** `referrer_user_id`, `referred_user_id`, `referral_code`. UNIQUE on `referred_user_id` — one person can only be referred once. On insert, award +10 to referrer (respecting +30 cap).

*   **`waitlist_social_profiles` table:** `waitlist_user_id`, `platform` (enum: `x`, `reddit`, `linkedin`), `handle`, `oauth_access_token` (encrypted at rest). UNIQUE constraint on `(platform, handle)` — one handle maps to exactly one waitlist entry; one waitlist entry has at most one handle per platform. Duplicate attempts are hard-rejected with a clear error.

*   **`waitlist_tokens` table:** `token` (UUID, unique), `waitlist_user_id`, `created_at`, `expires_at` (14 days), `used_at` (nullable). A token with `used_at` set is burned — subsequent use returns an error.

*   **`telegram_accounts` table:** `telegram_id`, `waitlist_user_id` (nullable — null for staff overrides), `source` (enum: `waitlist_token`, `ops_override`), `linked_at`. UNIQUE on `telegram_id`.

*   **`email_jobs` table:** `user_id`, `template` (enum: `e1_confirm`, `e2_bump`, `e3_nurture`, `e_alert`, `e_inv`, `e_win`, `e_re`), `scheduled_at`, `sent_at`, `status` (pending/sent/skipped).

*   **`creator_tracking` table:** For Tactic 5 micro-influencer ROI. `creator_handle`, `event_type` (visit/signup/activation), `session_id`, `created_at`.

*   **`post_review_queue` table:** `waitlist_user_id`, `platform`, `post_url`, `submitted_at`, `reviewed_at` (nullable), `outcome` (nullable enum: `approved`, `rejected`). Credit applied only on `approved`.

---

## 2. Waitlist API & Priority Engine

**The Why:**
The waitlist uses a **two-door model**: the slow door (sign up, earn points, climb the global queue) and the fast door (an admitted user spends a premium invite, invitee skips the queue). Waves assemble when infrastructure checkpoints pass — never on a calendar. Queue position shown to users is always real, never inflated.

**The What:**

*   **Signup endpoint:** Accepts `email`, `anon_id`, `touchpoints[]`. Inserts `waitlist_users`, bulk-inserts `waitlist_touchpoints`, derives first/last touch, generates personal `referral_code`, enqueues E1 within 60 seconds. Applies referral attribution if any touchpoint carries a `ref=CODE`.

*   **Queue position (computed view, never a stored column):**
    ```sql
    SELECT id, 1 + COUNT(*) OVER (
      ORDER BY points_total DESC, created_at ASC
      ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
    ) AS queue_position
    FROM waitlist_users WHERE status = 'waiting'
    ```

*   **Wave assembly logic (runs when operator triggers a wave):**
    1. Premium invitees fill the front of available capacity first.
    2. ~75% of remaining capacity → highest `points_total` (tie-broken by `created_at` ASC).
    3. ~25% of remaining capacity → `points_total = 0` users by `created_at` ASC.

*   **Dynamic wave estimator:** Returns estimated wave number based on current planned capacity — never a hardcoded assignment. Recalculates on every status page load.

*   **Action endpoints:**
    - `POST /waitlist/survey` → +30 points
    - `POST /waitlist/readiness` → +20 points
    - `POST /waitlist/post-url` → writes to `post_review_queue` (credit pending manual review)
    - `POST /waitlist/interview-commit` → +15 points
    - Share link conversion webhook → +10 (cap enforced)

*   **Social OAuth endpoints (§2a — required before public post credit is possible):**
    - OAuth flows for X, Reddit, LinkedIn. On completion, write to `waitlist_social_profiles`.
    - Enforce `(platform, handle)` uniqueness — hard reject with a user-facing explanation.
    - The comment-to-access mechanic closes here: user connects X via OAuth, submits reply tweet URL as public post, goes to spot-check queue.

---

## 3. Identity Linking & Telegram Gate

**The Why:**
Wave admission on the web must translate to permission to join the network. The Telegram Operations Agent orchestrates DKG — it must be gated on a valid, unburned waitlist token.

**The What:**

*   **Token minting:** When a wave is admitted, mint one `waitlist_token` per user. Include it in the E-inv email. Token expires in 14 days — unclaimed access returns to the pool.

*   **Telegram bot gate logic (in order):**
    1. Is this `telegram_id` in `telegram_accounts`? → Yes: proceed to DKG flow as normal.
    2. No: ask for waitlist token.
    3. Validate token: exists + `used_at` IS NULL + `expires_at` > NOW(). Fail on any condition with a clear message.
    4. On success: set `used_at = NOW()`, insert into `telegram_accounts` (`source = 'waitlist_token'`, `waitlist_user_id` from token), write `(agent_pubkey → waitlist_user_id)` to `waitlist_agent_links`. Proceed to DKG.

*   **`waitlist_agent_links` table:** `agent_pubkey`, `waitlist_user_id`, `linked_at`. Written by the Telegram gate at the moment the token is burned — this is the bridge between the CELLO protocol identity and the waitlist record. The `CELLO_ONBOARDING` agent reads from this table to personalize first-session messages.

*   **Staff / existing-user bypass:** The ops dashboard has an "Add Telegram account" function. Takes a `telegram_id`, writes to `telegram_accounts` with `source = 'ops_override'`, `waitlist_user_id = NULL`. No token required. This is how Andre and any staff access the network without a waitlist token.

*   **Account linking:** At Telegram onboarding, attempt to match the email provided to the waitlisted email. Surface a confirmation prompt on match; allow graceful override on mismatch (log for ops review).

---

## 4. The "Day 1" Client Experience (Onboarding & Artifacts)

**The Why:**
The first win — two agents connecting and sealing a session — is the core virality trigger. Both parties get a live CELLO connection as the reward. The sealed transcript is the shareable artifact that generates organic discovery.

**The What:**

*   **Pre-populated address book:** On first daemon init, automatically inject and whitelist `CELLO_SUPPORT`, `CELLO_FEEDBACK`, `CELLO_DEMO`, and `CELLO_ONBOARDING`.

*   **First-win event detection:** Fires when a session seals for the first time, globally (not per-agent, not per-device — once per human user). The `waitlist_agent_links` table provides the `waitlist_user_id` from the `agent_pubkey`. On first win:
    - Issue 3 premium invite codes to the user
    - Send E-win email (congratulations + invite codes + testimonial ask)
    - Log `first_win_at` timestamp on `waitlist_users`

*   **Personalized onboarding agent (`CELLO_ONBOARDING`):**
    - Trigger: user's first-ever global DKG. Uses `waitlist_agent_links` to look up their waitlist record.
    - Payload: wave number, queue position, inviter pubkey (if admitted via premium invite), interview-commit status.
    - **Unresolved design gap:** Triggering only on the first-ever global DKG (not a second device or fifth agent) requires a reliable "has this human ever DKG'd before" check without violating the blind-witness privacy model. This must be designed before this component can have acceptance criteria. Do not ship without resolving.

*   **Viral artifact renderer (sealed transcript):**
    - The sealed transcript renders as a clean shareable page at `gallery.cello.mygentic.ai/receipt/[hash]`.
    - Every sealed receipt footer carries: `Verified by CELLO — gallery.cello.mygentic.ai/receipt/[hash]`
    - The verifier page shows: both agent monikers, the session timestamp, the Merkle hash, directory verification status ("Verified by 2-of-3 nodes"), and a share button.
    - Page is public, no auth required, SSR-rendered (bot-indexable).
    - See §6 (Gallery) for full spec.

---

## 5. Client-Side Tracking & Link Generation

**The Why:**
Pre-signup attribution requires persisting the anonymous journey client-side. Every outbound link needs standardized UTM parameters so channel and creator performance is queryable.

**The What:**

*   **`localStorage` tracking script (corp-cello-site repo):**
    - Generate `wl_anon_id` (UUID) on first visit; persist indefinitely.
    - Maintain `wl_touchpoints[]` — append only when a meaningful signal is present (UTM params, `ref` code, known campaign param). De-duplicate identical consecutive hits. Cap at 20 entries.
    - On signup: send full array + `anon_id` to backend.
    - After signup: set `wl_user_id` in localStorage so future sessions know the user is known.

*   **UTM link generator (internal tool, ops dashboard):**
    - Inputs: base URL, channel (`reddit`/`x`/`linkedin`/`newsletter`/etc.), campaign slug, optional `ref` (creator handle).
    - Output: fully tagged URL with `utm_source`, `utm_medium`, `utm_campaign`, and `ref`.
    - Every piece of outbound content — articles, DMs, replies, newsletter pitches — uses a link from this tool.

---

## 6. AWS-Native Email Automation

**The Why:**
Two distinct email segments: the **base list** (all verified signups) and the **content alert list** (explicit opt-in, unchecked by default). These must never be conflated.

**The What:**

*   **Transactional pipeline:** Lambda + SES + SQS.
    - E1 (confirm, within 60s of signup): queue position + referral link + "how waves work" link.
    - E-inv (wave admission): install command + 14-day claim window. Nothing else.

*   **Drip pipeline:** `email_jobs` table + EventBridge cron Lambda polling every minute.
    - E2 (+1 day): survey link, share link, readiness checklist.
    - E3 (every 2 weeks): build-log update + harvested testimonials + wave movement note. **Base list only.**
    - E-win (first-win event): 3 invites + testimonial ask.
    - E-re (60–90 days cold): re-engagement + explicit "no hard feelings" unsubscribe path.

*   **Content alert pipeline (separate segment):**
    - Triggered manually from the ops dashboard when new content publishes.
    - Sends only to `content_alerts = true` users.
    - Format: one sentence + link. Under 100 words. Hard limit: never more than twice per day.
    - Opt-in checkbox on status page (unchecked by default): *"Notify me when new articles, demos, or posts are published. (During launch this may arrive up to twice a day — unsubscribe anytime.)"*
    - Unsubscribe = single click, sets `content_alerts = false`. Does not touch base list subscription.

---

## 7. GTM Distribution Tech Assets

**The Why:**
Specific tactics require technical assets deployed in the wild to capture search intent, developer ecosystems, and AI engine citations.

**The What:**

*   **OpenClaw skill (`cello.md`):** Markdown file covering `cello_start_agent`, `cello_initiate_session`, `cello_send`, `cello_receive`, `cello_contacts`, `cello_sealed_receipt` with 3-4 worked scenarios. Submit to OpenClaw skill directory.

*   **MCP registry listings:** Submit `@cello-protocol/connect` to mcp.so, Smithery, Glama, awesome-mcp-servers. Description optimized for BOFU queries.

*   **GEO/SEO infrastructure (blog.cello.mygentic.ai):**
    - Ghost instance connected to Google Search Console and GA4.
    - Every article published with: FAQPage JSON-LD schema, ItemList schema (listicles), Article schema with `datePublished` + `dateModified`, year in URL slug, visible "Last updated" line below H1.
    - **10-listicle content calendar (60-day schedule):** Full spec in `00_GEO_LISTICLE_STRATEGY.md`. The calendar, distribution windows (Perplexity 30 days / ChatGPT 60 days / Google 90 days), and freshness maintenance schedule are defined there. This infrastructure enables all of it — the blog setup is P3, the content execution is ongoing from launch week.

*   **Receipt verifier page:** Lives at `gallery.cello.mygentic.ai/receipt/[hash]` — see §8 (Gallery).

---

## 8. Gallery (gallery.cello.mygentic.ai)

**The Why:**
Every shared sealed transcript is an organic CELLO discovery event. The gallery is the public-facing surface where receipts live — no auth required, fully bot-indexable, designed to be shared and cited by AI engines.

**The What:**

*   **Repo:** `corp-cello-site`. The gallery shares the corp site's header, footer, design system, and nav. The corp site header will gain a "Gallery" nav item.

*   **Public, no auth:** All gallery pages are accessible without logging in. SSR-rendered — no client-side-only content. AI crawlers and Google can index every receipt page.

*   **Individual receipt page (`/receipt/[hash]`):**
    - Shows: both agent monikers, session timestamp, Merkle hash, message exchange summary (content only if the user opted to make it public — see privacy note below), directory verification status.
    - Share buttons: copy link, share to X (pre-filled text), share to LinkedIn.
    - Footer on every page: consistent CELLO branding, link back to corp site.

*   **Gallery index (`/`):**
    - Curated or chronological feed of published receipts.
    - Design: card grid, each card shows agent monikers + timestamp + verification badge. Clicking opens the receipt page.

*   **Privacy:** Publishing a receipt to the gallery is opt-in. By default, sealed receipts are private (both parties hold them, no public URL). The user or operator explicitly chooses to publish. The portal/client exposes this as a "Share publicly" action on a sealed receipt. Published receipts are irrevocable once shared (the hash is permanent).

*   **GEO value:** Each published receipt is a unique, timestamped, schema-markable page. Over time the gallery becomes a corpus of real agent-to-agent sessions that AI engines index when answering "what does a CELLO session look like?" This is compounding organic distribution that requires no ongoing content effort.

---

## 9. Ops Dashboard (operations.cello.mygentic.ai)

**The Why:**
Several manual review and control functions are required for waitlist operations — post URL spot-checks, wave admission, feedback call confirmation, content alert triggers, Telegram account management. These need a lightweight authenticated interface that doesn't require building a full admin system from scratch.

**The What:**

*   **Repo:** New repo, cloned from `cello-portal`. Strips all portal pages and menus. Retains: Next.js framework, magic-link auth flow, SES email sending, Postgres connection.

*   **Auth:** Magic link only. Allowed emails stored in AWS Secrets Manager (not in any database table). Bot checks `email ∈ secrets_manager_list` before sending any magic link. Unknown email → silent rejection (no confirmation of whether the email exists). This is the only access control layer needed.

*   **Database:** Reads from the same Postgres instance as the portal. IAM role with:
    - Read access to all `waitlist_*` tables
    - Write access to: `post_review_queue`, `email_jobs`, `telegram_accounts`, `waitlist_users` (status, admitted_at, feedback_eligible fields only), `waitlist_tokens`

*   **Pages required (minimum viable):**
    - **Post review queue:** List of submitted post URLs, platform, submitter, submitted_at. Approve / Reject buttons. Approve triggers points credit.
    - **Wave management:** Current queue view (position, email, points, status). "Open wave" action — takes a capacity number, runs wave assembly logic, marks users as admitted, mints tokens, enqueues E-inv emails.
    - **Feedback pipeline:** List of `feedback_eligible` users. "Mark call complete" button → triggers 4 premium invite grant.
    - **Content alert trigger:** "Send content alert" button → enters article URL and one-sentence description → fires E-alert to `content_alerts = true` users.
    - **Telegram accounts:** Add a `telegram_id` with `source = ops_override` (staff bypass). View existing linked accounts.
    - **UTM link generator:** Channel + campaign + optional ref → outputs tagged URL.

*   **What it is NOT:** Not a full analytics dashboard, not a CRM, not a customer support tool. The minimum surface needed to operate the waitlist manually. SQL + a simple page for anything else.

---

## 10. §5c High-Activity User Detection

**The Why:**
The feedback flywheel — active users → 20-minute call → content raw material → articles → new users — is the sustainable demand generation engine. Requires automated detection and a triggered outreach sequence that dogfoods the product.

**The What:**

*   **Thresholds** (observable from session telemetry, without reading message content):
    - `≥5 completed (sealed) sessions` within 14 days of admission, OR
    - `≥1 cross-operator session` (session with an agent belonging to a different operator) within 14 days.
    The cross-operator threshold is lower because it signals the collaborative use case — not just solo testing.

*   **Detection:** Lambda on daily EventBridge schedule. Writes `feedback_eligible = true` + `feedback_eligible_date = NOW()` to `waitlist_users`. Idempotent.

*   **Outreach sequence:**
    1. **Day 1:** `CELLO_FEEDBACK` agent initiates a CELLO session with the user.
    2. **Day 1 (same day):** SES email follow-up, under 150 words, calendar link.
    3. **Day 6, no response:** Auto-grant 2 premium invite codes. Status page note added.
    4. **Call completed (ops dashboard confirm):** Grant 4 premium invites (replaces the 2 if already issued).

*   **Feedback call output — four destinations:**
    - Raw notes → ops dashboard record
    - Quotable moments → testimonial candidates (landing page)
    - Specific workflows → case study candidates (content pipeline)
    - Vocal X/LinkedIn users → Tactic 5 micro-influencer outreach candidates

---

## 11. Source Documents

- `docs/planning/discussion_logs_drafts/Product rollout/2-waitlist-induction/2026-07-12_0622_waitlist-launch-plan.md`
- `docs/planning/gtm/00_MASTER_PLAYBOOK.md`
- `docs/planning/gtm/00_PRELAUNCH_DEMAND_PLAYBOOK.md`
- `docs/planning/gtm/00_GEO_LISTICLE_STRATEGY.md`
- `docs/planning/gtm/00_MICRO_INFLUENCER_SEEDING.md`
- `docs/planning/gtm/00_X_ARTICLE_STRATEGY.md`
- `docs/planning/gtm/00_DEMO_POST_STRATEGY.md`
- `docs/planning/gtm/00_WAITLIST_ANALYTICS_ARCHITECTURE.md`
