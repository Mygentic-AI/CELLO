---
name: waitlist-launch-plan
type: discussion
date: 2026-07-12
topics: [waitlist, launch, gtm, growth, referral, onboarding, beta]
status: active
description: >
  The actual waitlist plan — decisions made, sequence set, ready to implement. Built from the verified
  research in [[2026-07-12_0541_waitlist-plan-source-mining]] and the GTM skeleton in
  [[2026-06-24_1630_gtm-strategy]]. Everything self-hosted on our own AWS infrastructure; no paid SaaS.
---

# CELLO Waitlist & Launch Plan

This is the plan, not the research. Evidence and alternatives live in
[[2026-07-12_0541_waitlist-plan-source-mining]]; the strategy skeleton it extends is
[[2026-06-24_1630_gtm-strategy]]. Decisions below were made by Andre on 2026-07-12.

## The model in one paragraph

Everything is gated — signing up gets you a place in a **wave**, not the product. Waves are admitted as we
prove out infrastructure (directory/relay monitoring, FROST ceremonies under load) — a real reason, stated
plainly on the page. Inside the gate, the first win is **connecting your own two agents** (Claude Code ↔
Hermes, laptop ↔ cloud) — no counterparty needed, value in minutes. The viral engine is the product itself:
CELLO is useful alone and exponentially useful together, so every referral doesn't just admit a new user — it
instantly gives both people a live cross-operator connection. Like Superhuman, there are **two doors**: the
slow door (sign up, improve your position) and the fast door (an admitted user spends an invite on you).

## 1 — Signup and the wave queue

**Signup is one field: email.** Nothing else. (Every extra field costs 10–20% conversion; qualification
happens later, in stages.)

On signup you're assigned to a wave and shown both numbers, and both are real:

> **You're in Wave 4 — #23 in your wave.**
> Waves are admitted as we scale monitoring across the node network. Here's how to reach an earlier wave.

- **Wave** = admission cohort. Wave sizes are set by infra readiness, not marketing (see §4).
- **Position within wave** = priority order inside that cohort, driven by the score in §2.
- No inflated counts, no fabricated queue. The number moves when the person does something, and they can see
  why.

The landing page shows the product concretely — the actual connect flow, a real agent-to-agent exchange — not
abstract trust-layer copy. Lead with the capability ("connect your Claude Code session to your friend's
agent — cryptographically sealed"), not the category.

## 2 — Priority: how people move up

All four signals count. Each moves position within a wave; enough movement promotes you to the previous wave.

| Action | Effect | Why it counts |
|---|---|---|
| **Staged survey** — after signup: "Want an earlier wave? Tell us about your setup" | +30 | Proves real interest; gives us the qualification data that decides who's call-worthy. This is the main engine. |
| **Technical readiness** — already runs Claude Code / Hermes / OpenClaw / ZeroClaw; repo star/fork; joined the community channel | +20 | These people reach first-win fastest and give the best feedback. Verified from survey answers + GitHub. |
| **Share link** — personal link; each signup through it | +10 each, capped at +30 | Robinhood's mechanic. Works pre-launch with zero admitted users. Capped because it attracts volume, not fit. |
| **Public post** — post on X / Reddit / LinkedIn / TikTok / Instagram that you're on the waitlist and looking forward to it, submit the URL | +15 per platform, capped at 2 platforms (+30) | Public commitment beats a private share: it's social proof to their audience AND a stronger signal than a click. Their personal share link goes in the post, so it feeds the share-link counter too. Verified by URL submission — manual spot-check at beta scale, no automation needed yet. |
| **Referral by an admitted user** | **Skip to the front of the next-admitting wave** | The fast door (§5). Strongest signal we can get, and it seeds the invitee with a known counterparty. |

The survey (5–7 questions, one screen, only offered *after* signup so it never costs a signup):
role · what agents they run today · what they'd connect first · urgency ("would you set this up this week?")
· willingness to give feedback / take a call · one open text: "describe the two agents you want talking to
each other." That last answer is worth more than the rest combined — it's qualification data and product
research at once.

## 3 — Wave 1: design partners

10–20 hand-picked people (per [[2026-06-24_1630_gtm-strategy]] — sourced from the Reddit self-identification
pieces plus top survey scorers).

- **Mandatory 30-minute call** — Wave 1 only. The call is the research: watch them onboard, find where the
  flow breaks, capture what they want their agents to do. Superhuman held 1:1 onboarding long past scale and
  credits it for conversion quality; we do it while it's cheap (20 calls max).
- **First win inside the call**: their own two agents connected and talking before the call ends. Target:
  under 15 minutes from install to first sealed exchange. If we can't hit that in a guided call, the
  self-serve waves aren't ready — that's the point of Wave 1.
- Each Wave-1 user who reaches first win gets **3 invites** (§5) and a testimonial ask (5–10 min video, per
  the GTM doc).
- Later waves: self-serve onboarding; the call becomes an *offer* to high-scoring users only.

## 4 — Wave admission mechanics

- Waves are admitted **when infra checkpoints pass**, not on a calendar: directory/relay dashboards green
  through the previous wave's load, FROST ceremony success rate, onboarding completion rate from the previous
  wave (target: >70% of admitted users reach first win before the next wave opens).
- Wave sizing: Wave 1 = 10–20. Each subsequent wave ≈ 5–10% of the current waitlist, ordered by priority
  score. Growth target is the GTM doc's ~100 steady users across the beta.
- **Admission email includes exactly one action** — the install command — and states how long they have.
  Access unclaimed after 14 days returns to the pool (keeps cohorts honest and monitoring meaningful).
- **Waitlist staleness rule**: anyone 60–90 days cold (no email opens, no survey, no share) gets one
  re-engagement email with explicit permission to leave; non-responders are marked dormant and stop counting
  toward wave sizing. A stale list converts near zero — don't let it distort the queue.

## 5 — The fast door: invites from admitted users

Superhuman's actual mechanic, now clear from the primary transcript: nobody ever browses the waitlist. An
existing user hands an invite to someone who asked — a friend, a colleague, or a stranger who saw them
talking about it. The referral is the vouch; our survey is still the filter.

- Every admitted user who reaches **first win** earns **3 invites**. (Earned, not granted at admission —
  Monzo gated Golden Tickets on engagement; ours gates on the activation moment.)
- An invitee skips the queue into the next-admitting wave, top of the order. They still do the survey — the
  two-door model means referral gets you *to* the gate faster, not around the filter.
- **The CELLO-native double-sided reward — this is the loop that matters:** when your invitee onboards, the
  system offers both of you an immediate connection to each other. Your invite *is* a network edge. Inviter
  gets a live counterparty (the thing that makes CELLO exponential), invitee starts with a contact instead of
  an empty network. No cash, no swag — the reward is the product working better, which is the only incentive
  the developer-audience research says actually works (access and status, never gift cards).
- Invite counts can be raised for users whose invitees activate (an invitee reaching first win earns the
  inviter +1 invite). Fraud handling: normalize emails, rate-limit, silently deny credit on junk — never
  block the signup itself.

## 6 — Email sequence

All sent from our own infrastructure (SES). Every email under 300 words, build-log tone — honest
"here's what works, here's what's still broken" consistently outperforms polish with developers.

| # | Trigger | Content |
|---|---|---|
| E1 | Signup (within 60s) | Confirm. One line on what CELLO is. Wave + position. One link: "how waves work." |
| E2 | +1 day | The bump offer: survey link, share link, readiness checklist. This email does the qualification work. |
| E3… | Every 2 weeks | Build-log update: what shipped, what broke, one real agent-to-agent exchange excerpt. Wave movement note if any ("Wave 3 opened — you moved up"). |
| E-inv | Wave admission | The install command, the 14-day window, call scheduling (Wave 1) or quickstart link (later waves). Nothing else. |
| E-win | First win detected | Congratulations + your 3 invites + testimonial/feedback ask. |
| E-re | 60–90 days cold | One re-engagement: what's changed since they signed up, explicit "no hard feelings" unsubscribe. |

## 7 — What we build (self-hosted, no paid SaaS)

Phases ordered by dependency. Everything on our existing AWS account and IaC discipline
(`infra/` conventions apply; STATE.md updated per action).

**P0 — capture (blocks everything):**
- Landing page (static, S3 + CloudFront behind the existing corp-site patterns) with the one-field signup.
- Signup API (API Gateway + Lambda) writing to a `waitlist` table (Postgres on the existing dev directory DB
  or a small dedicated instance — keyed on a generated `waitlist_id`, email unique; **join on the stable key,
  never email** if any table grows around it).
- SES domain verification + production-access request (submit early — it has AWS review lag).
- E1 confirmation email. Personal share code generated at signup.

**P1 — priority engine (needs P0):**
- Survey page (self-hosted form, posts to the same API).
- Scoring: survey +30, readiness +20, share conversions +10×3 cap, public-post submissions +15×2 cap.
  Wave/position computed, exposed on a status page (the link in every email). Post-URL submission is a text
  field on the status page; credit applied after manual spot-check (a queue of submitted URLs in the ops
  dashboard).
- E2 and the biweekly update sender (a Lambda on a schedule reading a markdown build-log we commit).

**P2 — admission & invites (needs P1; Wave 1 can run manually before this is done):**
- Admission tooling: mark a wave open, generate E-inv sends, 14-day claim tracking.
- Invite codes for admitted users, earned at first-win event (the daemon/portal already knows when a first
  session seals — that event is the trigger).
- The mutual-connection offer on invitee onboarding (this is a portal/client feature, not waitlist
  plumbing — coordinate with portal work).
- Minimal ops dashboard: signups, scores, wave states, funnel numbers. SQL + a simple page is fine.

**Wave 1 does not wait for P2.** Ten to twenty hand-picked people can be admitted with P0 + a spreadsheet.
Build P1/P2 while Wave 1 calls are running.

## 8 — What we measure

| Metric | Target / alarm |
|---|---|
| Landing page → signup | 20–40% healthy; below 10% = page problem |
| Signup → survey completion | This is our activation-intent number; watch it, no target yet |
| **Time to first win** (install → first sealed own-agent exchange) | <15 min guided (Wave 1), <30 min self-serve; this is THE launch metric |
| Admitted → first win before next wave | >70% or the next wave doesn't open |
| Email opens | 30–50% good; list-cold below 25% |
| Invitee activation (RIAR — invitees reaching first win and still active at week 2) | The real virality number; ignore raw invites-sent |
| Waitlist → active conversion after admission | Benchmark ~50% within 30 days; sunset at 60–90 days |

## 9 — Explicitly not doing

- **Position inflation / fabricated counts** — the wave number and position are real. (Decision, not
  squeamishness: the mechanic exists and works elsewhere; our gate has a true story that's better.)
- **Cash/swag referral rewards** — the reward is invites, status, and a live counterparty.
- **Long signup forms** — qualification is staged, never at the door.
- **Paid waitlist/survey/email SaaS** — everything above is a weekend's worth of Lambda and a Postgres table.
- **Unbounded 1:1 calls** — mandatory for Wave 1 only, offer-only after.

## Open items

1. The mutual-connection offer (§5) needs a small design pass on the portal/client side — what exactly the
   invitee sees at onboarding.
2. First-win event detection for invite earning (§7 P2) — confirm the daemon/portal event we hook.
3. Landing-page copy and the real agent-exchange excerpt to feature — pick from actual sealed sessions.
4. Whether Wave-2+ admissions want a lighter "office hours" group call instead of 1:1s.
