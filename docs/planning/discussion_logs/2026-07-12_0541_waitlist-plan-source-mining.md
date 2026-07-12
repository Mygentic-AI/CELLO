---
name: waitlist-plan-source-mining
type: discussion
date: 2026-07-12
topics: [waitlist, growth, referral, onboarding, launch, gtm, viral-loops]
status: draft
description: >
  Source-mined tactical enrichment of the existing GTM skeleton. Perplexity's original waitlist research
  ([[2026-07-12_0457_waitlist_planning_with_perplexity]]) barely understood CELLO beyond "AI agent-to-agent
  product," so its advice was generic SaaS/AI-waitlist boilerplate. This doc goes to the ~60 primary sources
  Perplexity cited, mines them directly (not just Perplexity's summary of them), and tags every tactic by
  provenance (vendor vs independent) and CELLO-stage fit. No ethics filtering — tactics are reported neutrally,
  including fake-scarcity/gamification plays, so Andre can weigh them himself.
---

# Waitlist plan — source-mined tactical enrichment

**What this is:** a tactics catalog pulled from primary sources, organized against CELLO's actual mechanics
and the corrected launch-wedge model (below). **What this is NOT:** a rewrite of
[[2026-06-24_1630_gtm-strategy]] (the authoritative 3-stage GTM skeleton) or a decision record — nothing here
is committed to. It's raw material to inform Stage 1 and Stage 3 decisions.

**The corrected wedge model this doc is organized around** (see `project_cello_first_wedge_is_solo_multi_agent`
memory): CELLO's launch wedge is **solo multi-agent connection** — a developer connecting their own agents
across devices/frameworks (Hermes↔Claude Code, local↔AWS demo instance) — which has no cold-start/counterparty
problem. That's **Stage 1**. Friend-to-friend network growth (a second real person, referrals, endorsements)
is **Stage 3**, and only makes sense once Stage 1 has already hooked someone. Most generic waitlist advice
(referral ladders, invite loops, viral coefficients) is Stage-3-shaped and doesn't fit Stage 1 mechanically —
not because it's unethical, but because Stage 1 has no second person to invite yet.

Provenance tags: **[vendor]** = a waitlist/growth/survey tool selling itself (grounded in real customer data,
but self-serving); **[independent]** = blog/agency/consultant/VC with nothing to sell. **The vendor tag is a
credibility marker only, never a recommendation to buy that product.** CELLO has no budget for paid SaaS
right now (no credit card on file) — the waitlist/survey/email system is being built in-house and
self-hosted on AWS or GCP. Every vendor-tagged tactic below describes a *mechanic* (a points system, a
position-display feature, a survey flow) to reimplement ourselves, not a product to procure.

---

## Stage 1 — solo multi-agent onboarding & activation

### Qualification / first-question framing

- **Single email field only at signup.** Each additional form field costs 10–20% conversion. [independent,
  business.daily.dev] Defer richer profiling to a post-signup survey.
- **One question that does double duty** — segments the signer-upper AND gives you an eval set. Waitlister's
  own AI-launch guide uses exactly: *"What would you use this for?"* [vendor, waitlister.me]
- **Developer-specific qualification survey (Russian-locale variant of getaiform.com's tool — Perplexity never
  surfaced this one)**: role (PM/Dev/Designer/Founder), product-testing frequency, motivation (early
  access/roadmap influence/networking/growth), hours/week willing to commit, feedback style, tech-stack
  familiarity, bug-report experience, device coverage, communication-tool preference (Slack/Discord/
  Jira/email/video). [vendor, getaiform.com/ru] This maps far better to CELLO's actual dev audience than any
  English-language generic version.
- **Beta-graduation qualification rubric**: sorts early users into Feedback / Design-Partner / Pilot /
  Paid-Customer paths by scoring pain-is-real, has-target-workflow, will-meet-regularly, has-budget-authority,
  needs-implementation-proof. [independent, dowhatmatter.com] Directly reusable for sorting CELLO's beta
  cohort into "video-testimonial candidate" vs "just testing" vs "graduate to wider access" — which
  [[2026-06-24_1630_gtm-strategy]] already names as a goal.
- **GitHub as a qualification signal**: stars = awareness, forks = hands-on testing (best beta candidates —
  watch fork *velocity* vs star velocity), issues/PRs = highest intent. Reply to a fork within 24h, not 72h —
  doubles reply rate. Personalized outreach citing the specific action gets 15–35% reply vs 1–3% for cold
  email. [vendor (ads platform, but tactically dense), business.daily.dev]
- **10-question quiz-with-tiered-result framing** (English variant): how-heard-about-us, problem type, urgency
  (immediate/1-3mo/3-6mo/exploring), decision role, beta interest, competitor usage, team size, integration
  needs, update-channel preference — ends in a result tier ("Casual Observer" → "Beta Tester VIP Access").
  [vendor, getaiform.com]
- **Milestone-triggered onboarding surveys**: day 1 / day 7 / day 30 triggers, tracking Time-to-First-Value,
  Setup Completion Rate, Feature Discovery Rate. [vendor, cxpulse.in]
- **Friction as a filter, not a bug**: if someone won't spend 30 seconds on a qualification survey, they won't
  tolerate a rough MVP either — survey drop-off is doing its job. [vendor, formbricks.com]

### First-value-moment design

- **"Get developers to their first win in 5 minutes."** Track *time to first win* as the core launch-day
  metric, not signups. [independent, business.daily.dev] This maps almost exactly onto CELLO's own "does your
  agent have any friends" first-connection moment — except for CELLO the first "friend" can be the user's own
  second agent instance, which is the whole point of the corrected wedge.
- **Coming-soon pages that show code/CLI/API up front convert 15–30% vs 2–5% for vague marketing pages.**
  [independent, business.daily.dev] Direct implication for a CELLO landing page: show the actual
  `cello_start_agent` / connect flow, not abstract "AI trust layer" copy.
- **Time-to-First-Value / Setup Completion Rate / Feature Discovery Rate** as the three metrics to instrument
  for activation. [vendor, cxpulse.in]

### Activation email sequencing (Stage 1 portion — the "you're in, get set up" arc)

- **Confirmation email**: send within 60 seconds; 60–80% open rates since people are actively expecting it.
  Confirm + set expectations, nothing more. [vendor, waitlister.me]
- **Sequenzy ships 4 welcome-email archetypes by product type**: Hype-Building (consumer/viral), Educational
  (B2B SaaS), Exclusive-Access (premium/high-ticket), Viral-Referral (consumer apps) — full subject+body copy
  for each. Also 12 named beta-launch templates with a trigger/job/CTA table, including an explicit
  **"first 10 minutes"** onboarding template. [vendor, sequenzy.com] Directly reusable template taxonomy for
  CELLO's Stage 1 sequence.
- **Cadence disagreement across sources — reporting the spectrum, not picking one:**
  - Weekly early, escalating to 2-3x/week final month, daily final week. [vendor/affiliate-leaning,
    marketingemailtools.com]
  - Flat every 3-4 weeks — explicit argument that weekly is "content marketing noise." 6-8 emails over 6
    months, each under 300 words. [vendor, launchsuite.co]
  - Fixed 5-email sequence at day 1/8/22/35/launch (confirmation → problem-deepening → single-feature "peek,"
    highest reply rate → social proof → launch with a real deadline), from a stated 68-app dataset.
    [independent/data-driven, distributionbase.com] Their key metric: **activation rate** (opened 3+ of 5
    emails) predicts paid conversion far better than raw signup count — 40%+ activated is healthy, <20% means
    the list went cold.
- **Honest, unpolished "what's broken" updates outperform polished hype for developer audiences.**
  Reddit/DEV.to/Hacker News "Show HN" posts and RFC-style design docs build pre-launch trust — a direct
  personalized RFC-style outreach gets 15–30% reply vs 1–3% for a cold pitch. [independent, business.daily.dev]
  This sharpens [[2026-06-24_1630_gtm-strategy]]'s existing Reddit/AEO thinking with a concrete why.

### Developer-specific tactics (highest relevance to CELLO's actual ICP)

`business.daily.dev` (vendor, but tactically dense — an ads platform for developer audiences) was the single
best-fit source in the whole mining pass:

- Cohort rollout at **5–10% of waitlist per week**, starting with the most-engaged (opened every update,
  referred others).
- The incentive that works for developers is **access/status, not swag or cash** — explicitly calls out "$10
  credit or a t-shirt" as the wrong move.
- Quote worth keeping verbatim: *"The waitlist is not the finish line. It's the runway."*
- **Deposit-based commitment filter**: a small real cost/action (e.g. a $5 reservation) converts 3-5x better
  than free signup because it filters for real intent. [vendor, blazonagency.com] Not directly portable since
  CELLO isn't charging for access — but the underlying principle (a small real commitment as a filter) maps
  onto "connect a second real agent" as CELLO's natural non-monetary commitment filter.
- **Reddit as "LLM SEO"**: Reddit content gets directly indexed and surfaced by ChatGPT/Claude/Perplexity when
  users ask "best tool for X." Named specific dev subreddits (r/programming, r/MachineLearning,
  r/learnmachinelearning) and recommends 4-6 weeks of genuine non-promotional participation before any launch
  post. [vendor, blazonagency.com]
- AI product copy should lead with the specific capability, not the category: *"Generate compliant legal
  contracts in 90 seconds"* beats *"AI-powered legal tech."* [vendor, blazonagency.com] Direct implication:
  CELLO copy should lead with "connect your Hermes agent to your Claude Code session" not "trustless
  agent-to-agent protocol."

### Metrics to track (Stage 1)

- Signup→customer conversion: 50% within 30 days, drops below 20% past 90 days. [vendor, waitlister.me]
- Landing-page conversion: 20–40% typical, 8–12% for a generic "join waitlist" CTA. [independent/vendor,
  cross-confirmed askusers.org + remery.ai]
- Email open rate: 30–50% "good," below 25% signals a problem (multiple independent sources converge here).
- **WaitlistKit's subscriber pyramid** [vendor, but a genuinely distinct framework]: Early Adopters 10-15%,
  Curious 40-50%, Passive 25-35%, Ghosts (dead/bot) 10-15% — frames the job as moving people up-pyramid, not
  growing raw count.
- **"Perpetual waitlist" failure mode**: Rows.com reportedly saw 0% conversion on 6+ month old signups.
  Sources converge on a 60–90 day max hold before re-engagement/sunset sequences are needed.

---

## Stage 3 — friend-to-friend network growth

### Referral mechanics & scoring

- **Points-based referral system, shipped as a real feature** (Waitlister): signup = 50pts default, referral
  = 30pts, social follow = 5pts, custom points via API for any action. [vendor, waitlister.me]
- **Tiered milestone rewards** — convergent across every source: 1 referral → small reward, 3 → mid, 5 →
  bigger unlock, 10 → guaranteed/lifetime tier.
  - Harry's: 5→shave cream, 10→razor, 25→premium set, 50→free year. 100K signups in a week, 77% from
    referrals, avg 3 referrals/person, 200+ people referred 50+ each. **Verified**: the headline numbers
    (100K in one week, 77% referral) trace to Tim Ferriss's original 2014 write-up of the campaign
    (`tim.blog`), not just vendor case studies repeating each other — this is the actual primary source
    everyone else cites. The avg-3-referrals/200+-people-referred-50+ sub-details weren't independently
    re-verified beyond the headline figures.
  - Dropbox: "give 500MB, get 500MB" double-sided. 3900% growth in 15 months, 100K→4M users. 60% signup
    increase from the referral loop alone. **Verified**: consistently attributed to Drew Houston (Dropbox
    founder) and Sean Ellis (growth advisor)'s own analysis, cited with that attribution across independent
    sources for over a decade — as solid as growth-hacking lore gets.
- **Double-sided beats single-sided**: single-sided referral (only referrer benefits) sees ~3x lower
  participation than double-sided. [independent, unicornplatform, citing Dropbox] The *principle* — both
  sides get something — maps cleanly onto CELLO's actual mechanic: connecting two agents benefits both
  operators, so the "reward" can be real utility, not a manufactured incentive.
- **Position-based movement**: each referral moves the referrer up 10–25 spots (range cited across
  GrowSurf/Sequenzy templates), separate from or combined with points/tiers.
- **Fraud detection as a named, real feature**: device fingerprinting, IP analysis, email normalization
  (catches Gmail dot/plus tricks), velocity scoring, 140+ disposable-domain blocklist. Fraudulent referrals
  are silently denied credit but the signup itself still succeeds. [vendor, waitlister.me]
- **Referral reward economics matters**: *"check reward economics before you publish — a reward that destroys
  margin is a delayed invoice, not a growth strategy."* [independent, kickofflabs.com]
- **Contrarian take, reported as-is**: *"Referral codes don't build durable growth. Remix loops do."*
  [independent, LinkedIn/rishikesh ranjan] One-click "Edit with X" on shared output turns viewers into
  creators (Lovable's pattern); weekly leaderboard, credits to top 5 sharers. Structurally mismatched to CELLO
  (no project/template gallery), but the underlying principle — turn a shared artifact into a one-click
  starting point, not just a display — maps onto CELLO's planned exportable transcript artifact: a viewer
  could get a one-click "connect your agent to see this kind of exchange" CTA.
- **Robinhood — CORRECTED (2026-07-12, verified against primary source):** the "1M signups in 24 hours" figure
  in an earlier draft was wrong — the mining pass transcribed it from vendor case-study pages without
  checking. The real numbers, from Vlad Tenev himself (Business Insider interview, 11 Jul 2017): *"we ended up
  getting 10,000 sign-ups that first day, over 50,000 the first week, and almost 1 million in the first
  year."* The waitlist reached ~1M before public launch over roughly a year, via pure queue-jump referral, no
  other incentive — not in a single day. [independent/primary, Business Insider]
- **Referral virality needs critical mass**: one case study saw 1,200→3,400 signups (2.8x) via referrals over
  6 weeks, 32% of signups referred someone — but virality "needs critical mass (500+ signups) before
  competition takes off." [vendor, remery.ai]
- **Contrast case — passive list, no referral mechanic**: 2,400 signups → 89 paid (3.7%) from a single launch
  email with no referral loop. [independent, distributionbase.com] Cited as what *not* to expect from a
  passive list.

### The closest real precedent to CELLO's endorsement primitive

**Correction (2026-07-12):** an earlier draft of this section said existing users could "see who was on the
waitlist" and choose whom to vouch for — that's wrong and got caught by Andre asking a follow-up question
("how did that vetting actually work — was it anonymous?"). Verified against a primary source (a Superhuman
case-study compilation citing the Acquired.fm podcast episode,
`brandonkboswell.com/sources/Superhuman--History-and-Strategy--Deep-Podcast-Case-Studies`): there was no
waitlist visibility or anonymous review at all. The actual mechanic, quoted from the source: *"The act of
referring (or asking for a referral) was itself a strong indicator of interest, and Superhuman further
qualified these leads by an automated survey process before approving them for 1:1 onboarding."*

So the real shape is three layers, none of which involve one user inspecting another's data: (1) a user
refers someone they **already personally know** — the referral is a relationship-based signal, not a
judgment made by browsing a queue; (2) Superhuman's own automated survey independently screens the referred
lead; (3) a **mandatory live 30-minute onboarding call**, deliberately non-scaling, doubling as both a
qualification filter and a research session (ROI estimated ~60x in one source's framing: $30 cost/call vs
$1,800 LTV). Waitlist size is reported inconsistently across sources (275,000 per
valueaddvc.com/startupsuperschool.com vs 180,000 per askusers.org — flagging the discrepancy, not picking
one).

This maps to CELLO's endorsement primitive *better* than the incorrect version did: it's a real relationship
making a real claim ("I know this person, they're a fit"), independently screened by the platform — not
anonymous crowd-review. CELLO can implement this literally as a signed endorsement from an already-connected
agent operator, no visibility into anyone else's waitlist entry required. It's also the closest real-world
precedent for gating access behind genuine technical/operational readiness rather than arbitrary scarcity —
exactly why CELLO's own queue exists (FROST ceremonies, directory/relay onboarding needing to be proven before
a flood).

### Position display / scarcity / social proof

Reporting neutrally — the sources **disagree with each other**, and that disagreement is preserved rather
than resolved:

- **Position Inflation — a real, shipped product feature** (Waitlister): the operator enters an arbitrary
  offset and every public-facing position/count shifts by it — subscriber #1 sees "#501," a landing page with
  30 real signups shows "530 people joined." Internal dashboard/CSV/analytics/API stay real; only the public
  UI and outbound webhook field are affected. Also supports hiding exact position entirely while keeping a
  point/referral leaderboard visible (shifts competition to something harder to fake). [vendor,
  waitlister.me/features/position-inflation] Vendor's own framing: *"the goal is to reflect actual total
  interest... not fabricate numbers from nowhere"* — but functionally the number is operator-chosen with no
  verification.
- **One Waitlister guide argues against it**: *"Don't fake scarcity — gating theatrically when access is
  actually open reads as manipulation the moment users compare notes. Gate for real reasons and say so
  plainly."*
- **A different Waitlister guide argues for it, same domain**: *"Scarcity also genuinely helps... gated access
  is part of why early Gmail invites and Superhuman felt like something worth talking about."*
- **GrowSurf and Unicorn Platform lean harder into scarcity as pure tactic**: *"communicate that only the top
  N get day-one access... scarcity drives referral activity."* [independent/vendor]
- **Clubhouse**: 2 invites per user even at 10M waitlist size — invites resold for up to $400 on eBay. Cited
  as the extreme case of artificial scarcity working, celebrity/influencer-seeded. Least CELLO-relevant of the
  named case studies — depends on influencer culture, not developer trust. **Verified with a correction**:
  eBay resale is real and confirmed by contemporaneous 2021 press (Tech Times, Newsweek, Business Insider,
  TechNode), but $400 was a notable peak sale, not typical — most press puts the going rate at $20–50, spiking
  past $1000 during celebrity moments (e.g. when Elon Musk joined). The "10M waitlist" and "6M active users by
  early 2021" are two different numbers (waitlist size vs. actual usage) — don't conflate them.
- **Monzo's "Golden Ticket"**: after ~2 weeks of engaged app use, users got exactly 1 invite to give away — by
  2019, 80% of Monzo's acquisition was word-of-mouth. **Partially verified**: the Golden Ticket mechanic and
  the 80% word-of-mouth figure are independently corroborated (an Australian Banking Association report cites
  "according to the company"), but the specific "~2 weeks of engaged use" trigger timing has no findable
  primary source — likely an unverified embellishment from whichever vendor blog first added that detail.
- **UI/conversion-psychology tactics** [independent, scoreapp.com, citing external research]: rounded CTA
  buttons get 17–55% more clicks than sharp-edged ones; personalized/visually distinct CTAs increase
  click-through up to 202% (HubSpot); quantity-option buttons increase purchase likelihood 14% and total sales
  28%; survey question quality peaks at 5–8 questions, degrades past ~30.
- **Structural note (not an ethics exclusion)**: position-inflation and queue-jump mechanics assume a single
  global ordered queue. CELLO's actual gating is readiness-based (infra/ceremony capacity), not an arbitrary
  line — so a literal "you're #847" display would need a decision: fabricate a queue number that doesn't
  structurally exist, or find CELLO's real equivalent (e.g. a cohort/wave label tied to actual infra
  capacity). Reported as a decision to make, not resolved here.

### Artifact/template sharing loop

- **Notion's loop, mechanics** — the strongest real precedent for [[2026-06-24_1630_gtm-strategy]]'s
  "exportable agent-to-agent conversation transcripts as shareable artifact" idea: user creates a
  workspace → shares a page/template publicly → indexed by Google → new user discovers it → signs up to
  remix → creates own workspace → shares publicly → repeats. [independent, greta.agency] The underlying
  condition that makes this work: the artifact is inherently *reusable* by the recipient, not just viewable.
  **Correction (verified 2026-07-12): the specific numbers — "60% of newcomers who duplicate a template
  invite teammates" and "templates source 40% of all new Notion accounts at zero CAC" — have no findable
  primary source.** No Notion blog post, founder statement, or press citation turned up either figure; the
  40% appears to be a mixed-up citation of an unrelated Lenny Rachitsky stat about *other* PLG companies'
  organic-search channel mix (Airtable/Miro/Snyk/Webflow/Zapier), not Notion templates specifically. Treat the
  qualitative mechanic (public template → discovery → remix → new workspace) as directionally real — it's
  widely described — but do not cite either percentage as fact.
- **The gap, stated plainly**: Notion's artifact is publicly indexable by design. CELLO's transcripts are
  presumably private/sealed by default (directory never sees content), so the SEO-indexing half of the loop
  doesn't transfer without a deliberate "publish this transcript publicly" opt-in feature — a real product
  decision, not a copy-paste of Notion's mechanic.
- **Slack's invite loop — UNVERIFIABLE, flagging plainly rather than picking a side.** [flowjam.com, shno.co —
  both independent, but "cross-confirmed" was the wrong word; they're echoing the same unsourced figures, not
  independently corroborating them] Claims: workspace creation triggers an automatic bot email pulling
  teammates in for free; a 10k-message retention ceiling nudges migration before history disappears; "30% of
  all new workspaces are born inside existing ones"; invite loop completes in ~1 day; K-factor peaked ~8.5
  during hyper-growth. Searched for a primary source (Slack blog, founder interview, contemporaneous press,
  First Round Review-style teardown) for every sub-claim and found none — only marketing-glossary blogs
  repeating the same numbers with no citation trail. Treat as widely-repeated growth-marketing lore, not
  confirmed fact. The mechanic itself (workspace creation prompts inviting teammates) is real and observable;
  the specific numbers attached to it are not verifiable. The *retention-threat-as-invite-trigger* structural
  insight could still map to CELLO's sealed-transcript continuity if framed carefully — noted as edging toward
  manufactured urgency, not excluded on that basis, just flagged.
- **Dark social whisper tactic**: private, unbranded share links that still track referrals — *"developers
  hate overt marketing but will share utility links in Slack groups."* [independent, flowjam.com] Strong fit
  for CELLO's actual dev-heavy ICP.
- **Invite-loop launch checklist** [independent-ish, flowjam.com]: invite flow ≤2 clicks, mobile-optimized;
  double-sided incentive aligned to core value, not cash; K-factor/cycle-time/net-virality analytics live from
  day one; abuse limits and admin override built in; 6-week A/B roadmap for subject lines/landing page/reward
  size.

### Metrics/instrumentation for the invite loop

- **K-factor** = invites sent per user × conversion rate of those invites. >1 is true virality and extremely
  rare; realistic B2B SaaS targets sit well under 1. Historical extremes cited (Slack ~8.5, Facebook ~7 early
  on) are unverified — see the Slack correction above; treat these as commonly-repeated figures, not confirmed
  ones. **Loop velocity (cycle time from trigger to new user) matters more than K-factor once K is already above 1**
  — reducing cycle time compounds harder than increasing viral coefficient. [independent, cross-confirmed
  shno.co + flowjam.com]
- **Don't track "invites sent" — track Retained Invitee Activation Rate (RIAR)**: % of invitees reaching
  activation AND retained at week 2/4. Full instrumentation ladder: Invite Sent → Delivered → Opened →
  Clicked → Accepted → Activation Completed → Retained Week 2, with event properties (invite_id,
  inviter_user_id, invitee_identifier, invite_channel, invite_context, campaign_id, is_incentivized). Also an
  **"Invite Signal Score"** weighted model (+1 opened, +2 accepted, +5 activated, +8 retained wk2, +13
  retained wk4) to rank invite quality by channel/context/cohort instead of one vanity virality number.
  [independent, LinkedIn Pulse/Margub Alam] This is directly usable regardless of CELLO's specific mechanics —
  it's a measurement layer for CELLO's own address-sharing → invitation → endorsement loop already named in
  [[2026-06-24_1630_gtm-strategy]].
- **Four SaaS growth-loop patterns to instrument** [vendor, logspot.io]: invite loop, collaboration loop,
  automation loop (configured value drives deeper usage), data-sharing loop (users become distribution).
  Recommends alerting on loop-decay signals before they compound.

### Growth-loop design principles (framework-level)

- **4-part loop framework** [independent, startupik.com]: Input → Core Action → Output → Reinvestment.
  Identify one repeatable action that creates downstream demand, then strip friction until it happens often
  enough to sustain growth. Measure time-to-loop and loop conversion rate, not top-of-funnel traffic.
- **When loops work vs. fail** [independent, startupik.com]: work when the product reaches value quickly, the
  user action naturally creates exposure, the next user understands value with little explanation, and the
  loop attracts qualified users, not random traffic. Fail when teams "confuse activity with distribution," or
  copy another company's loop without the same underlying usage pattern — an explicit warning against
  copying Notion/Slack mechanics wholesale onto CELLO without CELLO's own usage pattern underneath.
- **"Make outputs public by default when trust/privacy allow it."** [independent, startupik.com] Flagged as a
  genuine structural tension, not silently adopted: this directly conflicts with CELLO's privacy design (the
  directory never sees message content). Any "public by default" artifact-sharing tactic needs a deliberate
  opt-in, not a default.
- **4 canonical loop types** [independent, gtm-labs.co, citing Andrew Chen/Lenny Rachitsky]: viral/referral
  (strongest when "collaboration is the core value" — Slack, Dropbox, Calendly, Loom), content/SEO, paid
  acquisition, sales-assisted. Type 1 is the CELLO-relevant one — "collaboration is the core value" is
  literally CELLO's pitch, once reframed away from "orchestrator" language.
- **Loop friction kills velocity**: complicated onboarding, account-creation barriers, unclear collaboration
  flows, and confusing permissions all weaken loop velocity — true for Stage 1 solo-agent setup friction just
  as much as for Stage 3 invites. [independent, founderfaqs.com]

---

## Case studies referenced across sources (cross-cutting reference table)

**Verification status added 2026-07-12** after Andre caught the Superhuman claim being transcribed from a
vendor page without checking — the whole table was then re-checked against primary/independent sources, not
just the vendor case-study pages the mining pass originally pulled from. See narrative sections above for
detail; this table is the summary.

| Case | Mechanic | Result | Verification | CELLO relevance |
|---|---|---|---|---|
| Superhuman | Referral from a personal relationship (not waitlist visibility) → platform survey screen → mandatory 30-min onboarding call | 180K–275K waitlist (sources disagree), $825M valuation | **Verified** — primary source found (Acquired.fm podcast case-study compilation) | **Highest** — closest precedent for readiness-gating + relationship-based endorsement |
| Harry's | Tiered milestone referral rewards | 100K signups in a week, 77% from referral | **Verified** — traces to Tim Ferriss's original 2014 write-up | Medium — tiered-reward shape is generic, portable |
| Dropbox | Double-sided "give/get" referral | 3900% growth in 15 months, 100K→4M users | **Verified** — attributed to Drew Houston/Sean Ellis, consistently cited a decade+ | Medium — the double-sided *principle* fits CELLO's real mutual-benefit mechanic |
| Robinhood | Pure queue-jump referral, no other incentive | ~1M waitlist signups over ~1 year before launch (**corrected** — not 24 hours) | **Corrected** — primary source (Vlad Tenev, Business Insider 2017) contradicted the original claim | High — canonical referral example, but the "instant virality" framing was wrong |
| Clubhouse | Scarce invites, influencer-seeded | 10M waitlist (distinct from 6M active users); invites resold up to $400 (peak, not typical — $20–50 was the norm) | **Verified with correction** — real, but $400 was a peak sale | Low — depends on influencer/celebrity culture, not developer trust |
| Monzo | Single "Golden Ticket" invite after engagement threshold | 80% of acquisition via word-of-mouth by 2019 | **Partially verified** — 80% figure and mechanic confirmed independently; the "~2 weeks" trigger timing is unsourced | Medium — engagement-gated single invite maps to CELLO's readiness framing |
| Notion | 2-year slow-roll beta, public template gallery loop | 1M users pre-broad-launch; specific "60%"/"40%" template-conversion figures | **Unverifiable** — no primary source for either percentage; likely a misattributed stat | High (mechanic) — closest precedent for transcript-sharing artifact, but don't cite the numbers |
| Slack | Auto-invite on workspace creation, retention-ceiling nudge | 30% of workspaces born inside existing ones; K-factor ~8.5 peak | **Unverifiable** — no primary source for any of the attached numbers; mechanic itself is plausible | Medium — structural insight (retention threat as trigger) is CELLO-adaptable but edges toward manufactured urgency |

---

## Structural mismatches (mechanical, not ethics-based exclusions)

Per Andre's explicit instruction: nothing here was excluded because it felt manipulative or unsanitized.
These are excluded/flagged only because the underlying mechanic requires something CELLO doesn't have, or
directly contradicts a design constraint:

- **Template-remix-gallery loops** (Lovable/Framer-style "remix this project") — CELLO has no
  project/template gallery concept. The underlying *principle* (shared output as a one-click starting point)
  is preserved above under the exportable-transcript artifact idea.
- **"Public by default" artifact sharing** — conflicts with CELLO's privacy design (directory never sees
  content). Needs a deliberate opt-in feature, not a default, if pursued.
- **Position-inflation / literal queue-jump display** — assumes a single global ordered queue; CELLO's gating
  is readiness-based (infra/ceremony capacity), not an arbitrary line. Implementing the display verbatim
  requires deciding whether to fabricate a queue number or build CELLO's real equivalent (a cohort/wave label
  tied to actual capacity).
- **Deposit-based ($) commitment filter** — not portable since CELLO doesn't charge for access, but the
  *principle* (small real commitment as intent filter) maps onto "connect a second real agent" as a natural
  non-monetary filter.

## Off-topic false positives (Perplexity keyword-matched these, they have no real tactical content)

- `ingagenow.in` — a B2B outbound-sales AI content-generation tool. Matched on "AI agents" + "growth,"
  nothing about product growth loops or waitlists.
- `stormy.ai` — a personal-brand/influencer growth playbook (100k followers via Perplexity Labs content).
  Same false-positive pattern.
- `yoframer.com`, `allframer.club` — Framer design-template marketplace pages. "Loops" and "Remix Link" are
  literally product names there, pure keyword coincidence.
- A LinkedIn post (Vaibhav Aggarwal, "the rise of AI agents...") — an MCP/A2A/SLIM/ACP protocol explainer, not
  growth or waitlist content.

---

## Open tensions for Andre to decide (not resolved by this doc)

1. **Scarcity messaging**: sources genuinely disagree (see Position display section) between "never fake
   scarcity, gate for real reasons and say so" and "scarcity itself is part of what makes access feel worth
   talking about." Both are reported neutrally above — this is a call to make, not a settled fact.
2. **Email cadence**: three different concrete cadences (weekly-escalating / flat every-3-4-weeks /
   fixed-5-email-at-specific-days) are each backed by a different source with its own reasoning. No consensus.
3. **Position display mechanic**: implement a literal queue-position number (Waitlister's approach, requiring
   either a fabricated number or a real underlying queue CELLO doesn't currently have) vs. a cohort/wave label
   tied to actual infra readiness (closer to CELLO's stated reason for the wait).
4. **Public artifact sharing**: whether to build a deliberate "publish this transcript publicly" opt-in to
   capture the Notion-style SEO/discovery loop, given it conflicts with the default privacy posture.

---

## Sources fetched vs. skipped/failed

**Cluster 1 (waitlist-tool vendors)**: 22/23 fetched. `waitkit.app` — DNS does not resolve, domain appears
dead. One additional linked page not fetched: `waitlister.me/growth-hub/guides/product-validation` (tangential
— product-validation methodology, not waitlist-specific).

**Cluster 2 (growth-loop/GTM articles)**: 17/20 fetched, 3 more excluded as off-topic false positives (see
above). Failures: `medium.com/mr-plan-publication/...` — 403 (Medium bot-blocking), title suggests likely
another false positive but unconfirmed. `gurustartups.com/reports/...` — 404, page no longer exists.
`reforge.com/c/.../building-the-first-growth-loop-template` — paywalled, only the framing (assess
"model-channel fit" and "product-channel fit") was visible.

**Cluster 3 (surveys/email sequences)**: 21/24 fetched. `validea.dev` — NXDOMAIN, genuinely dead.
`easyemailwriter.com/templates` — HTTP 402 Payment Required, real paywall. `preshiplist.co` — soft 404, post
not found. `docs.customer.io` and `paperform.co` fetched but skimmed as low-value (pure tool-implementation
docs / empty template-marketing page).

**Cluster 4 (LinkedIn posts)**: 4/4 fetched successfully, none blocked — a real fetch attempt was made on each
per Andre's explicit correction (an earlier pass had wrongly pre-excluded these by assumption).

**Total: ~64/71 sources yielded usable content.** Nothing was silently dropped — every failure and every
off-topic exclusion is named above with its specific reason.
