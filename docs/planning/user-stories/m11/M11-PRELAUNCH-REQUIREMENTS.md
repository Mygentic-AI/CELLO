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

---

## 1. Database & State (The Foundation)

**The Why:**
To run a referral-driven waitlist without paid SaaS, we need to own the data. We must track users, their priority scores, and exactly how they found us. For Tactic 5 (Micro-Influencer Seeding) and general GTM tracking, we must map multi-touch journeys (e.g., Reddit → X → Signup) to understand which content actually drives conversions.

**The What:**

*   **`waitlist_users` table:** Tracks `waitlist_id` (UUID, stable PK — join on this, never on email), `email` (unique), `anon_id`, `points_total`, `status` (waiting/admitted/banned), `email_verified` (bool), `content_alerts` (bool, default false), `feedback_eligible` (bool), `feedback_eligible_date` (timestamptz), first/last touch attribution columns, and timestamps.

*   **`waitlist_touchpoints` table:** Stores the multi-touch history (`url`, `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`, `ref`, `timestamp`) linked to the user's anonymous ID and eventual `waitlist_id`. Derives first-touch and last-touch on signup; stores both as fast-query columns on `waitlist_users`.

*   **`points_ledger` table:** An append-only ledger tracking point events to ensure auditability and trigger milestone events. Columns: `waitlist_user_id`, `points` (can be negative), `reason` (enum: `signup`, `survey`, `technical_readiness`, `share_conversion`, `public_post`, `interview_commit`), `meta` (JSONB). The canonical point values and caps:

    | Action | Points | Cap |
    |---|---|---|
    | Staged survey completion | +30 | none |
    | Technical readiness (runs agents + repo star) | +20 | none |
    | Share link (each signup through personal link) | +10 | +30 total |
    | Public post URL (X/Reddit/LinkedIn, verified) | +15 | +45 total (3 platforms) |
    | Interview commit (checkbox) | +15 | none |

    Caps are enforced at insertion time — a `points_ledger` insert for `share_conversion` that would push the running total past +30 is rejected. This is the anti-gaming control.

*   **`referral_codes` table:** `code` (unique), `owner_waitlist_user_id`, `active` bool.

*   **`referrals` table:** `referrer_user_id`, `referred_user_id`, `referral_code`. UNIQUE on `referred_user_id` — one person can only be referred once.

*   **`waitlist_social_profiles` table:** `waitlist_user_id`, `platform` (enum: `x`, `reddit`, `linkedin`), `handle`, `oauth_token` (encrypted at rest). UNIQUE constraint on `(platform, handle)` — one handle maps to exactly one waitlist entry, and one waitlist entry can have at most one handle per platform. Duplicate handle-to-entry or entry-to-handle is a hard rejection.

*   **`email_jobs` table:** `user_id`, `template` (enum: `e1_confirm`, `e2_bump`, `e3_nurture`, `e_alert`, `e_inv`, `e_win`, `e_re`), `scheduled_at`, `sent_at`, `status` (pending/sent/skipped).

*   **`creator_tracking` table:** For Tactic 5 micro-influencer ROI. `creator_handle`, `event_type` (visit/signup/activation), `session_id`, `created_at`.

---

## 2. Waitlist API & Priority Engine

**The Why:**
The waitlist strategy uses a **two-door model**: the slow door (sign up, earn points, climb the global queue) and the fast door (an admitted user spends a premium invite, invitee skips the queue entirely). Waves are assembled when infrastructure checkpoints pass — never on a calendar. The queue position shown to users must be real, never inflated.

**The What:**

*   **Signup & Touchpoint Ingestion Endpoint:** Accepts `email`, client-side `anon_id`, and the full `touchpoints[]` array from `localStorage`. Inserts `waitlist_users`, all `waitlist_touchpoints` rows, derives first/last touch, generates a personal `referral_code`, and enqueues the E1 confirmation email. Applies referral attribution if any touchpoint carries a `ref=CODE`.

*   **Queue Sorting (computed view):** Position = number of users ahead with higher `points_total` (tie-broken by earlier `created_at`), among `status = 'waiting'` users. Never stored as a mutable column — always computed on read.

*   **Wave Assembly Logic:**
    1. **Premium invitees** fill the front of available capacity first.
    2. **~75% of remaining capacity** → highest `points_total` users (ties broken by `created_at` ASC).
    3. **~25% of remaining capacity** → `points_total = 0` users ranked by `created_at` ASC.

*   **Dynamic Wave Estimator:** Returns the user's estimated wave number based on *current planned* wave capacity — never a hardcoded cohort assignment. When capacity changes, the estimate shifts automatically.

*   **Action Endpoints:**
    - Survey submission → award +30 points
    - Technical readiness confirmation → award +20 points
    - Public post URL submission → write to a pending spot-check queue (credit applied after manual review in ops dashboard)
    - Interview commit checkbox → award +15 points
    - Share link conversion webhook → award +10 points (respecting the +30 cap)

*   **Social OAuth Endpoints (§2a — required for public post points):** OAuth flows for X, Reddit, and LinkedIn. On completion, write to `waitlist_social_profiles`. Enforce the `(platform, handle)` uniqueness — a second registration attempt with the same handle returns a clear rejection. Credit for public post submissions is only evaluated after OAuth is connected. The comment-to-access mechanic closes here: after connecting X via OAuth, the user submits the URL of their reply tweet as the public post submission.

*   **Ops Dashboard Queue:** Submitted post URLs held in a pending-review queue. Manual spot-check before credit is applied. Errs toward crediting; rejects only clear gaming (empty tweet, private account, off-topic).

---

## 3. Identity Linking & Telegram Gate

**The Why:**
Web waitlist admission must translate to permission to join the actual network. The Telegram Operations Agent currently orchestrates DKG ceremonies — it must be gated on wave admission.

**The What:**

*   **Waitlist Token Generator:** Mints a single-use token when a user's wave is admitted. Token is burned on first use. Stored with an expiry (14-day claim window matching the wave admission mechanics).

*   **Telegram Ops Agent Update:** Prompts the user for their Waitlist Token, validates it against the database, burns it before unlocking the DKG flow.

*   **Account Linking:** Matches the email provided during Telegram onboarding to the original waitlisted email. Surfaces a confirmation prompt if they match; handles gracefully if they differ (allows override, logs for ops review).

---

## 4. The "Day 1" Client Experience (Onboarding & Artifacts)

**The Why:**
The first win — two agents connecting and exchanging a message — must happen fast. It is the core virality trigger: both parties get a live CELLO connection as the reward. The sealed transcript is the shareable artifact that generates organic discovery.

**The What:**

*   **Pre-Populated Address Book:** On first daemon init, automatically inject and whitelist `CELLO_SUPPORT`, `CELLO_FEEDBACK`, `CELLO_DEMO`, and `CELLO_ONBOARDING` into the user's contacts.

*   **First-Win Event Detection:** The event fires when a session seals for the first time. This is the trigger for:
    - Issuing 3 premium invites to the user
    - Sending the `E-win` email (congratulations + invite codes + testimonial ask)
    - Logging the activation timestamp for Wave admission analytics

    Implementation note: the trigger must fire on the *first sealed session globally*, not the first per-agent — requires a flag in the waitlist DB that is set once and never reset.

*   **Personalized Onboarding Agent (`CELLO_ONBOARDING`):**
    - Fires only on the user's first-ever global DKG (not their fifth agent or second laptop). **This trigger has an unresolved design gap: correlating multiple agents to one human user without violating the blind-witness privacy model.** Do not ship this without resolving the trigger design.
    - Payload includes: wave number, queue position, inviter pubkey (if admitted via premium invite), interview-commit status.
    - Requires a **secure data bridge** from the Portal/Postgres waitlist DB into the agent's outbound payload at trigger time.

*   **The Viral Artifact Renderer:** The sealed transcript must render as a clean, shareable UI artifact showing: agent names (monikers), the message exchange summary, the Merkle hash, the timestamp, and the directory verification status ("Verified by 2-of-3 nodes"). The receipt must carry a visible footer: `Verified by CELLO — cello.dev/verify` with a working public verifier page. This is the distribution flywheel: every shared receipt is a CELLO discovery event for the viewer.

---

## 5. Client-Side Tracking & Link Generation

**The Why:**
Pre-signup attribution requires persisting the anonymous journey client-side. Every piece of outbound content needs standardized UTM parameters so channel and creator performance is queryable.

**The What:**

*   **`localStorage` Tracking Logic:**
    - Generate `wl_anon_id` (UUID) on first visit; persist across sessions.
    - Maintain `wl_touchpoints[]` — append a new entry only when a meaningful signal is present (UTM params, `ref` code, or known campaign param). De-duplicate identical consecutive hits. Cap at 20 entries.
    - On signup: send the full array + `anon_id` to the backend.
    - After signup: set `wl_user_id` in localStorage so future sessions know the user is known.

*   **UTM Link Generator Tool:** Internal utility (a simple admin page or CLI script) that takes: base URL, channel (`reddit`/`x`/`linkedin`/`newsletter`/etc.), campaign name, and optional `ref_code`, and outputs a fully tagged URL. Every piece of outbound content — articles, DMs, replies, newsletter pitches — uses a link from this tool. Ensures `creator_tracking` attribution is clean.

    Standard schema:
    - `utm_source` = channel
    - `utm_medium` = `social` / `email` / `partner`
    - `utm_campaign` = campaign slug
    - `ref` = creator handle (for Tactic 5 micro-influencer tracking)

---

## 6. AWS-Native Email Automation

**The Why:**
Waitlist engagement collapses without nurture. We run two distinct email segments: the **base list** (all verified signups) and the **content alert list** (explicit opt-in, unchecked by default). These must never be conflated — a content alert going to people who didn't opt in undermines trust.

**The What:**

*   **Transactional Pipeline:** Lambda + SES + SQS for E1 (confirm, within 60s of signup) and E-inv (wave admission with install command and 14-day claim window).

*   **Drip Pipeline:** `email_jobs` table + EventBridge cron Lambda polling every minute. Handles:
    - E2 (+1 day): bump offer — survey link, share link, readiness checklist
    - E3 (every 2 weeks): build-log update + harvested testimonials + wave movement note. **Base list only.**
    - E-win (first win detected): 3 invites + testimonial ask
    - E-re (60–90 days cold): re-engagement with explicit unsubscribe path

*   **Content Alert Pipeline (separate segment, explicit opt-in):**
    - Triggered by a manual "publish content" action in the ops dashboard (not on a schedule).
    - Sends E-alert only to users where `content_alerts = true`.
    - E-alert format: one sentence + link. Under 100 words. Never more than twice per day.
    - Opt-in lives on the status page as an unchecked checkbox: *"Notify me when new articles, demos, or posts are published. (During launch this may arrive up to twice a day — unsubscribe anytime.)"*
    - Unsubscribe is a single click setting `content_alerts = false`. Does not affect base list subscription.

---

## 7. GTM Distribution Tech Assets

**The Why:**
Specific tactics in the GTM playbook require technical assets deployed in the wild to capture search intent, developer ecosystems, and AI engine citations.

**The What:**

*   **OpenClaw Skill (`cello.md`):** A downloadable markdown file covering `cello_start_agent`, `cello_initiate_session`, `cello_send`, `cello_receive`, `cello_contacts`, `cello_sealed_receipt` with 3-4 worked example scenarios. Submit to the OpenClaw skill directory.

*   **MCP Registry Packages:** Prepared manifests for `@cello-protocol/connect` submitted to: mcp.so, Smithery, Glama, awesome-mcp-servers GitHub list. Title and description optimized for BOFU queries: "agent identity," "agent-to-agent communication," "MCP security," "sealed receipts."

*   **SEO/GEO Infrastructure:** Ghost blog at `blog.cello.so` connected to Google Search Console and GA4. Every article published with:
    - FAQPage JSON-LD schema (3.2× multiplier for AI Overview appearances)
    - ItemList schema for listicle posts
    - Article schema with `datePublished` and `dateModified` (updated on every content refresh)
    - Year in the URL slug
    - Visible "Last updated" date below the H1

    This is not a one-time setup — the GEO listicle strategy requires a 60-day content calendar with 10 specific listicles, platform-specific distribution windows (Perplexity: 30 days, ChatGPT: 60 days, Google: 90 days), and a freshness maintenance schedule. The blog infrastructure enables all of it; the content plan is in `00_GEO_LISTICLE_STRATEGY.md`.

*   **Public Receipt Verifier Page (`cello.dev/verify`):** Accepts a receipt hash, queries the directory, returns verification status. This page is referenced in the footer of every sealed transcript — it is the organic discovery surface for every shared receipt.

---

## 8. §5c High-Activity User Detection

**The Why:**
The feedback flywheel — active users → feedback call → content raw material → new users — is the sustainable demand generation engine. It requires automated detection of engaged users and a triggered outreach sequence that dogfoods the product.

**The What:**

*   **Threshold detection** (observable from session telemetry, without reading message content):
    - `≥5 completed (sealed) sessions` within 14 days of admission, OR
    - `≥1 cross-operator session` (a session with an agent belonging to a different operator) within 14 days

    The cross-operator threshold is lower because it signals the collaborative use case — the core CELLO value proposition — not just solo testing.

*   **Threshold check:** Lambda on daily EventBridge schedule. Writes `feedback_eligible = true` and `feedback_eligible_date = NOW()` to `waitlist_users` when either threshold is crossed. Idempotent — does not re-trigger if already set.

*   **Outreach sequence (fires on flag set):**
    1. **Day 1:** `CELLO_FEEDBACK` agent initiates a session with the user. Message: *"We noticed you've been using CELLO actively. We'd love 20 minutes to hear what's working and what isn't. Your feedback directly shapes what we build next."*
    2. **Day 1 (same day):** Email follow-up via SES (under 150 words, calendar link).
    3. **Day 6 (no response):** Auto-grant 2 premium invites. Status page note: *"Thank you for being an active user — here are 2 invites to share."*
    4. **Call completed (manual confirm in ops dashboard):** Grant 4 premium invites (replaces the 2 if already issued, net 2 additional).

*   **Feedback call output pipeline:** Each call feeds four destinations: raw notes → ops dashboard, quotable moments → testimonial candidates for landing page, specific workflows → case study candidates for content pipeline, vocal X/LinkedIn users → Tactic 5 micro-influencer candidates.

---

## 9. Source Documents

These requirements were synthesized directly from the following internal GTM and Waitlist strategy documents:

- `docs/planning/discussion_logs_drafts/Product rollout/2-waitlist-induction/2026-07-12_0622_waitlist-launch-plan.md`
- `docs/planning/gtm/00_MASTER_PLAYBOOK.md`
- `docs/planning/gtm/00_PRELAUNCH_DEMAND_PLAYBOOK.md`
- `docs/planning/gtm/00_GEO_LISTICLE_STRATEGY.md`
- `docs/planning/gtm/00_MICRO_INFLUENCER_SEEDING.md`
- `docs/planning/gtm/00_X_ARTICLE_STRATEGY.md`
- `docs/planning/gtm/00_DEMO_POST_STRATEGY.md`
- `docs/planning/gtm/00_WAITLIST_ANALYTICS_ARCHITECTURE.md` (Perplexity Technical Research)
