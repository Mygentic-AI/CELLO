---
name: M11 Pre-Launch Technical Requirements
type: requirements
milestone: M11
description: >
  The raw list of software requirements necessary for the M11 pre-launch and waitlist rollout.
  This serves as the precursor to M11-DEFINITION-OF-DONE.md.
---

# M11 Pre-Launch Technical Requirements

This document gathers all software tasks required for the pre-launch waitlist, GTM distribution, and Day 1 onboarding experience. It is a comprehensive requirements list to feed the M11 Definition of Done.

## 1. Waitlist Infrastructure & Database
- **Waitlist Table:** A new Postgres table (likely in the Portal DB) using UUIDs, indexed by email.
- **Queue Logic Engine:** 
  - System to calculate points (Survey +30, Tech Readiness +20, Referrals up to +30, Posts up to +45, Interview +15).
  - Algorithm to sort the queue: 75% point-earners (points desc, date asc), 25% zero-point (date asc).
  - Dynamic Wave Calculator to expose estimated wave placement without hardcoding cohorts.
- **API Endpoints:**
  - 1-field email capture.
  - Post-signup setup survey ingestion.
  - Public post URL submission (for manual ops approval).
- **Landing Page / Dashboard:** Secure status page showing current queue position and point-earning checklist.

## 2. Token & Identity Integration
- **Waitlist Token Generation:** System to generate a single-use "Waitlist Token" for users admitted to an active wave.
- **Telegram Ops Agent Guard:** Update the Telegram onboarding bot to prompt for, validate, and burn the Waitlist Token before unlocking the DKG ceremony.
- **Account Linking:** Logic to match the Telegram onboarding email with the Waitlist email, finalizing the waitlist lifecycle for that user.

## 3. The "Day 1" Onboarding Experience
- **Pre-populated Daemon Address Book:** The `cello-client` installer/init must automatically inject and whitelist:
  - `CELLO_SUPPORT`
  - `CELLO_FEEDBACK`
  - `CELLO_DEMO`
  - `CELLO_ONBOARDING`
- **Onboarding Trigger (Privacy Check):** Mechanism to detect a user's *first global DKG* ceremony across the entire network, without breaking blind-witness privacy, to trigger the onboarding agent precisely once per human.
- **Context Data Bridge:** A secure pipeline to pass the user's waitlist data (Wave number, queue position, inviter's pubkey, interview commitment status) from the Portal DB to the `CELLO_ONBOARDING` agent's payload.
- **Automated Agent Outreach:**
  - `CELLO_ONBOARDING` sends a personalized welcome message with inviter details and setup commands.
  - `CELLO_FEEDBACK` schedules a dogfooding interview a few days later (if the user checked the interview box).

## 4. GTM & Distribution Tech
- **OpenClaw Skill (`cello.md`):** A downloadable markdown skill exposing `cello_start_agent`, `cello_contacts`, `cello_initiate_session`, `cello_send`/`receive`, and `cello_sealed_receipt`.
- **MCP Registry Packages:** Prepare the `@cello-protocol/connect` package manifest for registries (mcp.so, Smithery, Glama).
- **SEO/Analytics Infrastructure:** 
  - Stand up a Ghost blog (`blog.cello.so` or similar).
  - Wire Google Search Console and Google Analytics (capturing waitlist-signup conversion events).
