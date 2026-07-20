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

## 1. Database & State (The Foundation)

**The Why:** 
To run a referral-driven waitlist without paid SaaS, we need to own the data. We must track users, their priority scores, and exactly how they found us. For Tactic 5 (Micro-Influencer Seeding) and general GTM tracking, we must map multi-touch journeys (e.g., Reddit -> X -> Signup) to understand which content actually drives conversions.

**The What:**
*   **`waitlist_users` table:** Tracks `email`, `anon_id`, `points_total`, `status` (waiting/admitted), and timestamps.
*   **`waitlist_touchpoints` table:** Stores the multi-touch history (`url`, `utm_source`, `utm_campaign`, `ref`, `timestamp`) linked to the user's anonymous ID and eventual user ID.
*   **`points_ledger` table:** An append-only ledger tracking point events (e.g., +30 for survey, +10 for referral) to ensure auditability and trigger milestone events.
*   **`referrals` / `creator_tracking` tables:** Specifically designed to link a new signup to the `ref` code of the micro-influencer or existing user who invited them.

## 2. Waitlist API & Priority Engine

**The Why:**
The waitlist strategy relies on a "Dynamic Wave + 75/25 Quota" model. We want to reward active promoters with queue jumps while ensuring early, passive signups don't languish forever. We also need to eliminate hardcoded cohort sizes so we can adjust admission volumes based on live infrastructure capacity.

**The What:**
*   **Signup & Touchpoint Ingestion Endpoint:** An API that accepts the email along with the client's `localStorage` array of historical touchpoints.
*   **Queue Sorting Algorithm:** A computed view or logic layer that sorts users into two buckets for admission:
    *   75% allocated to Point-Earners (Ranked by highest points, tie-broken by oldest signup).
    *   25% allocated to Zero-Point users (Ranked by oldest signup).
*   **Dynamic Wave Estimator:** Logic to expose the user's estimated wave placement based on current planned capacity, rather than writing a fixed wave number to the database.
*   **Action Endpoints:** APIs to receive survey data, generate personal referral links, and submit public post URLs for manual review.

## 3. Identity Linking & Telegram Gate

**The Why:**
Signing up for the waitlist on the web must securely translate to permission to join the actual network. We use the existing Telegram Operations Agent to orchestrate DKG (Distributed Key Generation) ceremonies, so we need a gate that requires a waitlist admission before Telegram will respond.

**The What:**
*   **Waitlist Token Generator:** A system that mints a single-use "Waitlist Token" when a user's wave is admitted.
*   **Telegram Ops Agent Update:** The bot must prompt the user for their Waitlist Token, validate it against the database, and burn it before unlocking the DKG flow.
*   **Account Linking:** A mechanism to reconcile the email provided during the Telegram setup with the original waitlisted email (suggesting a match, but handling exceptions gracefully).

## 4. The "Day 1" Client Experience (Onboarding & Artifacts)

**The Why:**
To generate viral word-of-mouth (Tactic 2, Tactic 4), the product must demo beautifully. Users need an immediate dopamine hit—a "wow" moment—when they install the daemon, and they need a visually compelling "Sealed Transcript" to screenshot and share on social media.

**The What:**
*   **Pre-Populated Address Book:** The `cello-client` installer must automatically inject and whitelist `CELLO_SUPPORT`, `CELLO_FEEDBACK`, `CELLO_DEMO`, and `CELLO_ONBOARDING` into the user's contacts.
*   **Personalized Onboarding Agent:** 
    *   An automated agent that sends a welcome message containing waitlist context (e.g., their wave, inviter pubkey).
    *   Requires a privacy-preserving trigger (firing only on the user's *first global DKG*).
    *   Requires a secure data bridge passing the web waitlist context into the agent's payload.
*   **The Viral Artifact Renderer:** The client/portal must generate a clean, shareable UI rendering of the "Sealed Transcript" (showing agent names, the exchange, the hash, timestamp, and directory verification status) upon session close.

## 5. Client-Side Tracking & Link Generation

**The Why:**
To track the full user journey before they give us an email, we must persist their anonymous touches. Additionally, to keep tracking clean, we need a standardized way to generate UTM tags for every piece of content we post (Reddit, X, LinkedIn).

**The What:**
*   **`localStorage` Tracking Logic:** Client-side scripts to generate a `wl_anon_id` and maintain a rolling array of touchpoints (UTMs, referrers, timestamps) across sessions, without requiring cookies.
*   **UTM Link Generator Tool:** A simple internal utility to generate standardized outbound links (e.g., `?utm_source=reddit&utm_medium=social&utm_campaign=launch&ref=[creator]`) to ensure data hygiene.

## 6. AWS-Native Email Automation

**The Why:**
Waitlist engagement drops sharply if users aren't nurtured. We need immediate transactional emails (Day 0) and delayed sequences (Day 1 bump, bi-weekly updates, milestone alerts) without paying for external drip software like Mailchimp.

**The What:**
*   **Transactional Pipeline:** AWS Lambda + SES integration for instant confirmation emails containing queue position and referral links.
*   **Delayed/Drip Pipeline:** An EventBridge or SQS-driven pipeline linked to an `email_jobs` table to handle time-delayed sequences and event-driven emails (e.g., triggering when a user earns enough points to skip a cohort).

## 7. GTM Distribution Tech Assets

**The Why:**
Specific tactics in the GTM playbook require technical assets to be deployed in the wild to capture search intent and developer ecosystems.

**The What:**
*   **OpenClaw Skill (`cello.md`):** A downloadable markdown file exposing our core capabilities (`cello_start_agent`, `cello_initiate_session`, `cello_sealed_receipt`) for Tactic 9.
*   **MCP Registry Packages:** Prepared manifests for `@cello-protocol/connect` for Tactic 1 (mcp.so, Smithery, Glama).
*   **SEO Infrastructure:** A deployed Ghost blog (`blog.cello.so`) wired with Google Search Console and GA4 for Tactic 1 (GEO Listicle tracking).

## 8. Source Documents
These requirements were synthesized directly from the following internal GTM and Waitlist strategy documents:
- `docs/planning/discussion_logs_drafts/Product rollout/2-waitlist-induction/2026-07-12_0622_waitlist-launch-plan.md`
- `docs/planning/gtm/00_MASTER_PLAYBOOK.md`
- `docs/planning/gtm/00_PRELAUNCH_DEMAND_PLAYBOOK.md`
- `docs/planning/gtm/00_GEO_LISTICLE_STRATEGY.md`
- `docs/planning/gtm/00_MICRO_INFLUENCER_SEEDING.md`
- `docs/planning/gtm/00_X_ARTICLE_STRATEGY.md`
- `docs/planning/gtm/00_DEMO_POST_STRATEGY.md`
- `docs/planning/gtm/00_WAITLIST_ANALYTICS_ARCHITECTURE.md` (Perplexity Technical Research)
