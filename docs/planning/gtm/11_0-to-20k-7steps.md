---
founder: Florian Darroman (@asyncr0ne)
company: Distrib
stage: $12K MRR at time of recording; grew to $20K MRR in ~30 days
date: unknown
---

Florian Darroman is a serial SaaS founder who previously built a website to $500K/month before selling it, then systematically interviewed SaaS founders doing $100K–$10M/year to extract their distribution playbooks. He applied those learnings to his own product, Distrib (a content distribution SaaS), taking it from $12K to $20K MRR in approximately 30 days. This episode distills that synthesis into a 7-step sequenced framework — covering the three marketing buckets (viral, boring, scary), GEO (AI search optimization) as the fastest-returning boring tactic, and the exact order in which to pursue each channel. It is worth reading because the sequencing logic — validate first, build long-term compounders in parallel with short-term spikes, defer paid spend until a channel is proven — is a complete, opinionated anti-confusion guide for a pre-revenue founder deciding where to spend the next 90 days.

# GTM Tactics: "How I Grew a SaaS From $0 to $20K MRR (7-Step Plan)"
Source: https://youtu.be/4eVEbbzVtTk
Channel: Florian Darroman (@asyncr0ne)

---

## Overview: The Three Marketing Buckets

Florian opens with a taxonomy that frames everything that follows. He calls them "viral," "boring," and "scary" — and the entire 7-step plan is built around sequencing them correctly.

- **Viral marketing**: Social media, Reddit, YouTube algorithm. Produces spiky, unpredictable traffic. The casino — you might win big fast, you might get nothing.
- **Boring marketing**: SEO, GEO (AI search optimization), YouTube SEO, brand-building. Slow to start (nothing at day 30, results at day 90), but compounds exponentially and produces stable, predictable traffic.
- **Scary marketing**: Meta ads, Google ads, UGC, influencer marketing. Requires spending money AND having skills. Do this only after you've found a channel that converts.

The core insight: **you need both viral and boring, running simultaneously**. Viral brings first customers and confirms the product. Boring compounds in the background so that months later you have a durable baseline.

---

## Step 1: Validate the Product

**[Get Your First Paid User Before Anything Else]**
- **What they did**: Florian's co-founder ran paid ads from zero to ~$8K MRR before doing any content marketing. The explicit threshold was getting a first *paid* user — not a free user, not waitlist signups.
- **Why it worked**: A free user proves nothing about willingness to pay. A paid user proves the product solves a real, dollar-valued problem. Everything downstream — boring marketing, viral content — compounds on top of something real. Compounding on zero customer validation wastes every future hour.
- **CELLO application**: The first paid validation signal is someone installing `@cello-protocol/connect`, connecting two of their own agents, and paying for CELLO's portal tier (or paying for a managed seat). Free waitlist entries don't count. The goal before launching any content campaign is: at least one person paying, even if Andre manually onboards them. The solo-agent use case (connecting Claude Code ↔ Hermes) is the wedge — aim that validation scenario first, because Andre can run it himself and prove it works to the next 10 prospects.
- **Category**: `prerequisite`

---

**[Build a Waitlist Before Building the Product]**
- **What they did**: Referenced Rob Offman's playbook — Cleo went from $0 to $60K MRR in 53 days by creating a waitlist before writing a line of product code. Build demand, then build supply.
- **Why it worked**: A waitlist lets you talk to interested people before you've committed to a feature set. Those conversations sharpen the product definition and produce early evangelists who feel ownership because they were consulted.
- **CELLO application**: CELLO has a waitlist plan already. The tactic here is to treat waitlist sign-ups as research interviews, not just email collection. Message every sign-up within 48 hours with two questions: "What made you sign up?" and "What's the scenario where you'd use this daily?" Those answers drive the first content pieces AND the product priority list.
- **Category**: `prerequisite`

---

**[Cold Outreach as Validation Mechanism]**
- **What they did**: Sending emails or DMs to target users and offering free access in exchange for feedback. The goal is not revenue — it's product intelligence and proof that the problem is real.
- **Why it worked**: Outbound lets you talk to your ideal customer before you have inbound at all. Free access removes the purchase friction so you can focus on whether the product actually changes behavior. The conversion you're measuring is "did they use it and come back?" not "did they pay?"
- **CELLO application**: The ideal target for cold outreach is developers or AI engineers who are already running multiple AI agents — Claude Code users who also run a server agent, or teams using Codex + a local assistant. Andre can find them on X by searching for people posting about Claude Code setups, multi-agent architectures, or MCP servers. DM 20-30 people offering a free CELLO install session and a 20-minute call. The goal: confirm the "connect your own two agents" use case resonates before doubling down on content.
- **Category**: `prerequisite`

---

**[Post Where Your Ideal Customer Is]**
- **What they did**: Before any systematic content strategy, just post where your ideal customer actually spends time. Don't pick a platform based on what you like — pick based on where they are. If you don't know, ask an AI tool to hypothesize, then validate.
- **Why it worked**: Distribution that reaches non-customers is wasted distribution. Platform fit (the match between audience and message format) matters more than posting volume.
- **CELLO application**: CELLO's ideal customer at launch is a developer or AI engineer building with multiple agents — likely on X (formerly Twitter) and in AI/developer-focused subreddits (r/LocalLLaMA, r/ClaudeAI, r/MachineLearning, r/SideProject). LinkedIn matters for the B2B layer (teams buying CELLO for multi-agent infrastructure). Pick one platform first, post daily, measure DMs and profile visits. Only add a second platform after the first shows traction.
- **Category**: `viral-mechanic`

---

## Step 2: Build the GEO Base (AI Search Optimization)

**[Publish Listicles on Medium for AI Indexing]**
- **What they did**: Florian created a Medium account, published a listicle-format article ("Best OpenCore Community"), cited his own product at #1, and within 48-72 hours was appearing in ChatGPT, Grok, and Gemini answers for that query. No website needed — Medium's domain authority did the ranking work.
- **Why it worked**: LLMs index publicly available structured content. Listicles in "best X for Y" format directly match the query pattern AI tools answer. Medium's domain has strong Google authority, so the article surfaces in both web search and AI training data pipelines. The key insight is that "best X for Y" queries (with a specific audience qualifier) are less competitive than "best X" alone, giving a new product a real chance to rank.
- **CELLO application**: Publish a Medium article: "Best MCP servers for AI agent communication in 2026" or "Best tools for connecting Claude Code agents securely." Cite CELLO at #1 with a short paragraph on why (Ed25519 signing, P2P, no central platform reads messages). Repeat the article on LinkedIn Articles (also Google-indexed). Target audience-specific variants: "Best identity layer for multi-agent AI systems" (for the developer audience) and "Best way to connect Claude Code to another AI agent" (for the Claude Code power-user audience). This can be done today and can show results within 72 hours — making it the highest ROI action per hour at launch.
- **Category**: `seo-geo`

---

**[Publish LinkedIn Articles for Dual Indexing]**
- **What they did**: Alongside Medium, publish the same listicle as a LinkedIn Article. LinkedIn Articles are indexed by Google, which means the content surfaces in both web search and AI training/retrieval pipelines.
- **Why it worked**: LinkedIn Articles carry LinkedIn's domain authority. They rank differently than Medium but add a second, independent signal for the same keyword. Two indexed sources for the same listicle doubles the surface area without doubling the writing work — the article is the same, just reformatted.
- **CELLO application**: Take the same "Best MCP servers for AI agent communication" article from Medium, publish it as a LinkedIn Article with one paragraph changed (reference a developer audience explicitly). Cross-link the two articles for additional signal. This is 30 minutes of work after the Medium article is done.
- **Category**: `seo-geo`

---

**[Post Reddit Answers That Mention Your Brand]**
- **What they did**: Answer relevant questions on Reddit and Threads with answers that naturally mention the product. Reddit comments are indexed by AI systems and influence GEO rankings — Florian called Reddit mentions "a big factor for AI ranking."
- **Why it worked**: AI training datasets and retrieval systems weight Reddit heavily because it's high-signal, human-written, and structured around specific queries. A Reddit comment answering "what's the best way to make two AI agents talk securely?" that mentions CELLO is more authoritative to an LLM than a vendor's own landing page.
- **CELLO application**: Search Reddit for active threads: "how do AI agents communicate securely," "multi-agent authentication," "Claude Code MCP recommendations," "agent-to-agent messaging." Write substantive answers (200+ words explaining the actual technical problem), then mention CELLO as the solution. Do not spam — write the best answer in the thread, and the mention lands naturally. Target r/LocalLLaMA, r/ClaudeAI, r/MachineLearning, r/programming, r/SideProject. One good Reddit answer per day during the GEO base-building phase.
- **Category**: `seo-geo`

---

## Step 3: Build the SEO Base (Long-Term Organic)

**[Structure Your Website for Google Ranking Before Posting Content]**
- **What they did**: Before publishing articles, spend time on website structure — the architecture, URL patterns, internal linking, and keyword targeting. Florian referenced a dedicated video explaining this. Ranking failure often comes from structural problems (duplicate content, wrong URL hierarchy, thin pages) rather than content quality.
- **Why it worked**: Google's crawler builds a model of your site's authority and topic relevance from its structure. A poorly structured site can publish 100 articles and rank for none of them. Investing in structure first means every subsequent article compounds correctly.
- **CELLO application**: The CELLO website (corp-cello-site) needs a `/blog` or `/resources` section with a clear URL pattern (`/blog/[slug]`), proper canonical tags, and a sitemap. The homepage needs to target the primary keyword explicitly ("AI agent identity layer" or "secure agent-to-agent communication"). Before publishing any SEO articles, audit the current site structure. This is infrastructure work — do it once, get it right.
- **Category**: `seo-geo`

---

**[Find and Target Keywords Before Writing Anything]**
- **What they did**: Research keywords specific to your SaaS before writing a single article. The example given: instead of targeting "post scheduling tool" (high competition), target "best post scheduling tool for agencies" (lower competition, specific audience). The audience qualifier is what makes ranking possible for a new site.
- **Why it worked**: Long-tail keywords with an audience qualifier have lower competition from established players, higher intent from searchers, and better conversion because the searcher has self-identified as your target user. You're not competing with Hootsuite for "social media scheduler" — you're competing with nobody for "social media scheduler for solo consultants."
- **CELLO application**: The primary CELLO keyword candidates (low competition, high intent): "secure AI agent communication," "MCP server for agent identity," "agent-to-agent authentication without central server," "Claude Code multi-agent setup," "FROST threshold signing for AI agents." Pick 5-10 with realistic ranking potential. One blog article per keyword. The articles don't need to be long — they need to be the best answer to that specific query.
- **Category**: `seo-geo`

---

**[Publish Content Regularly (Daily Cadence)]**
- **What they did**: Consistent daily publication — 30 articles per month for SEO clients via Distribute. The volume matters because each article is a new potential ranking surface and Google rewards consistent publication signals.
- **Why it worked**: A single article might rank, might not. Thirty articles means you're fishing with 30 lines instead of one. Even at a 10% ranking rate, you end up with 3 ranking articles per month, compounding. The consistent publication signal also improves the site's overall authority scoring.
- **CELLO application**: One blog post per week is a realistic cadence for a solo founder. Topics drawn from: questions asked in Discord/Slack/Reddit about multi-agent AI, problems CELLO solves that aren't well-documented anywhere, protocol design decisions that show technical credibility (FROST vs other threshold schemes, why Ed25519, why a hash chain). Each post serves dual purpose: SEO ranking AND technical credibility signal for developer adopters evaluating the project.
- **Category**: `seo-geo`

---

**[Get Backlinks From Real Websites]**
- **What they did**: Build backlinks by getting other real websites to link to yours. Florian's Distribute product automates this via a network of real business websites — not link farms. He frames this as the slow, hard, necessary part of SEO.
- **Why it worked**: Google's ranking algorithm still weights backlinks heavily as a proxy for real-world authority. A link from a real website that covers adjacent topics carries meaningful authority transfer. The network effect compounds: once you have some authority, future articles start from a higher baseline.
- **CELLO application**: The open-source angle gives CELLO a legitimate backlink path: GitHub stars and forks create implicit authority signals; developer blog posts covering CELLO create organic backlinks; integration guides on partner sites (e.g., "How to use CELLO with Claude Code" published on a Claude Code tutorial site) generate referral traffic and backlinks simultaneously. Ask early adopters to write about their CELLO setup on their own blogs. Each such post is a backlink AND a word-of-mouth signal.
- **Category**: `seo-geo`

---

## Step 4: Execute Viral Marketing (Social Posting)

**[Post Daily on the Platform Where Your Ideal Customer Is]**
- **What they did**: Identify the single platform where the ideal customer hangs out, then post every single day. Not weekly, not when inspiration strikes — daily. The goal is to be consistently present, not occasionally brilliant.
- **Why it worked**: Algorithmic platforms (X, LinkedIn, TikTok, Reddit) reward consistency. An account that posts daily trains the algorithm to distribute its content broadly. Consistency also means you're testing hooks, formats, and framings at high velocity — the winning post formats emerge from volume, not intuition.
- **CELLO application**: X is the highest-signal platform for CELLO's audience right now (developers, AI builders, protocol designers). Post one thing per day: either a builder update (shipped X today), a protocol insight (why threshold signing matters), a demo clip (two agents connecting), or an opinion (why central platforms reading agent messages is a problem). The goal is not to go viral — the goal is to be consistently present so that when someone searches for "AI agent communication" on X, CELLO shows up.
- **Category**: `viral-mechanic`

---

**[Combine Platform Posts to Find Your Viral Format]**
- **What they did**: Florian referenced multiple specialized experts for each platform: Rob Adam for X, Roman for Reddit and LinkedIn, Julia (PlayKit) for short-form video, Nevo for cross-platform viral mechanics. The meta-lesson is that virality on each platform is a distinct craft with learnable patterns — not a generic "create good content" skill.
- **Why it worked**: Each platform has different content formats, algorithmic signals, and community norms. A post that performs well on X (short, opinionated, hooks in the first line) fails on Reddit (long, substantive, no self-promotion). Learning the format norms for your chosen platform before investing time in content creation multiplies the return.
- **CELLO application**: For X specifically: hook in the first line (not "I built CELLO" but "Two AI agents just shook hands cryptographically — here's what that looks like"), use threads for technical depth, post at peak developer hours. For Reddit: write substantive posts in r/SideProject or r/LocalLLaMA, lead with the problem not the product, mention CELLO only after establishing credibility. The format is the channel — getting the format wrong kills reach regardless of content quality.
- **Category**: `viral-mechanic`

---

**[Identify One Distribution Channel That Converts and Double Down]**
- **What they did**: Once you find a channel that produces leads that convert and stay, that's when you invest more. Before that, you're testing. The signal is not "I got traffic" — it's "I got customers who stay."
- **Why it worked**: Distribution channels have wildly different conversion quality. A Reddit thread might produce 500 visitors and 2 sign-ups. A single well-placed X thread might produce 50 visitors and 10 sign-ups. The conversion rate and retention rate together identify which channel is worth investing in — not raw traffic volume.
- **CELLO application**: Track every CELLO sign-up source manually in the first month — ask every sign-up how they found CELLO. After 20-30 sign-ups, the pattern will be visible. The channel with the highest quality sign-ups (developers who actually installed the client and connected two agents) gets more investment. The others get maintained at minimum viable effort.
- **Category**: `ongoing-distribution`

---

## Step 5: Build Long-Form Video / YouTube

**[Start a YouTube Channel With Both SEO and Viral Videos]**
- **What they did**: Florian started publishing daily YouTube videos combining two types: viral content (aiming for algorithmic spread, "782 views already") and SEO content (targeting specific keyword searches, e.g., "[competitor name] review," or "[tool category] tutorial"). Both types run in parallel on the same channel.
- **Why it worked**: YouTube is two products: a discovery engine (viral algorithm) and a search engine (YouTube SEO). A channel that only makes one type misses the other. SEO videos rank for months or years and drive consistent traffic. Viral videos spike and prove the channel can grow. Together they build a channel that has both reach and depth.
- **CELLO application**: A CELLO YouTube channel would work well for technical founders and developers. Video ideas: "Setting up CELLO: connect two Claude agents in 10 minutes" (SEO — targets "Claude agent communication tutorial"), "Why AI agents need cryptographic identity (and why platforms won't give it to them)" (viral — opinion/thesis format), "FROST threshold signatures explained without math" (SEO — targets developers evaluating CELLO's cryptography). Long-form video converts better than any other format — an 8-minute technical walkthrough of CELLO would convert more seriously interested developers than 50 X posts.
- **Category**: `content-format`

---

**[Use Long-Form Video as Your Moat]**
- **What they did**: Florian explicitly framed consistent video publishing as a competitive moat — "if you're the only SaaS doing SEO content for [your category], because a lot of people will never turn on the camera, then it becomes your moat." The barrier to entry is human discomfort with being on camera, not technical difficulty.
- **Why it worked**: Most SaaS founders refuse to do video because it feels uncomfortable and slow. That discomfort creates a durable gap. A competitor can copy your landing page overnight. They cannot copy a library of 50 technical videos you built over 6 months. The moat is time and discomfort, not IP.
- **CELLO application**: CELLO's technical complexity makes long-form video especially powerful. The audience (developers evaluating cryptographic infrastructure) wants to see evidence of deep understanding before trusting their agent's identity to a tool. A video where Andre explains FROST signing, why T < N matters, or how sealed receipts work signals competence in a way that a landing page cannot. Being the only serious explainer of AI agent identity on YouTube is a real and defensible position.
- **Category**: `content-format`

---

**[Podcast as a Long-Term Distribution Channel]**
- **What they did**: Florian runs a podcast channel (distinct from the tutorial channel) where he interviews successful SaaS founders. He explicitly cites it as a "longer time" investment but notes "YouTube pays a lot." The podcast serves brand-building and authority-building functions more than direct conversion.
- **Why it worked**: Podcast listeners are high-attention consumers. A 45-minute interview where a guest explains how they use multi-agent AI, and the host ties it back to CELLO's protocol, reaches people who are genuinely interested in the domain — not casual scrollers. The interview format also generates backlinks and co-promotion when the guest shares the episode.
- **CELLO application**: A CELLO podcast format: interview developers who've built multi-agent systems about the trust, identity, and communication problems they hit. Each episode is both content marketing and product research. A 30-minute recorded conversation with someone who built a Claude Code + Hermes agent pipeline demonstrates the problem CELLO solves without Andre having to pitch it directly. Guest's own audience is secondary distribution.
- **Category**: `content-format`

---

## Step 6: Listen to Customers and Build a Better Product

**[Add a Persistent Book-a-Call CTA on the Dashboard]**
- **What they did**: Florian describes having "a big call to action on our dashboard and people can book a call whenever they want." It's persistent — not a one-time onboarding modal, but a standing invitation to talk. The goal is a continuous stream of product feedback from active users.
- **Why it worked**: Most SaaS founders front-load customer conversations (during onboarding) and then lose contact. A persistent CTA means feedback is collected at the moment a user encounters a problem or has a reaction, not weeks later when the memory has faded. The user who books a call because they hit a friction point is giving you the most valuable feedback in your product.
- **CELLO application**: Add a "Talk to Andre" link in the CELLO portal — a Calendly or Cal.com link that's visible on every page, not buried in settings. Frame it as "30-min CELLO setup help" rather than "give feedback" — people book help calls, not feedback calls. Every call is simultaneously product support AND a research interview. Ask at the end: "What would make this indispensable to you?"
- **Category**: `product-led-growth`

---

**[Build Features Based on What Customers Actually Ask For]**
- **What they did**: The explicit purpose of listening is to build a better product. Florian: "you listen to everything they say, the features they want, the problem they are facing, and you try to build a better product." This is not a separate activity from GTM — it IS GTM, because a better product is the best distribution channel.
- **Why it worked**: A SaaS product that solves the right problems creates word-of-mouth. Retention is a function of product quality. Organic growth (referrals, endorsements) comes from users who got genuine value, not users who were impressed by a landing page. The product feedback loop is the flywheel.
- **CELLO application**: Every developer who tries CELLO and hits friction is a signal. The first 10 installs will surface: setup complexity (MCP install friction), terminology confusion (what is a "session"? what is a "moniker"?), missing flows (what happens when the counterparty is offline?). Each friction point is a product improvement AND a content opportunity (blog post: "Why we made CELLO setup a one-line command").
- **Category**: `product-led-growth`

---

## Step 7: Add Scary Marketing Once You Have a Winner

**[Scale a Winning Viral Format With UGC]**
- **What they did**: Once you've found a content format that goes viral — a specific hook, format, or topic that produces outsized shares — hire UGC creators to replicate it at scale. The key sequence: prove the format organically first, then pay to scale it. Never pay to prove a format.
- **Why it worked**: UGC works only when the creative format is already validated. A UGC creator executing an untested concept burns budget with no signal. A UGC creator replicating a format that already produced 100K organic views is executing a known winner — the risk is operational, not creative.
- **CELLO application**: If a demo video showing two Claude agents connecting via CELLO goes viral on X, that's the format to replicate. Commission developer advocates to record their own CELLO setup walkthrough using the same hook and format. The audience is developers — so the UGC "creators" are respected developers in the community, not influencers. Developer advocates who already use CELLO and have an audience are the target.
- **Category**: `launch-tactic`

---

**[Run YouTube Ads Against a Converting Video]**
- **What they did**: If YouTube is producing conversions organically, run YouTube ads targeting the same audience the organic video already proved converts. The organic video is the creative; ads are the distribution amplifier.
- **Why it worked**: YouTube ads targeting is highly specific — you can target by interest, channel subscription, and search query. A video that already converts organically has a proven hook and message. Putting ad budget behind it removes the guesswork from creative and focuses budget decisions on targeting and bidding.
- **CELLO application**: A CELLO YouTube video demonstrating the solo-agent use case (connecting Claude Code to Hermes, 5 minutes) that converts developers organically would be the candidate for paid amplification. The target audience: developers who watch Claude Code tutorials, AI agent building content, and MCP server setup guides. Budget this only after organic distribution proves the video converts — not before.
- **Category**: `launch-tactic`

---

**[Only Launch Paid Ads When You Can Fund Them From Cash Flow]**
- **What they did**: Florian's explicit rule: "You should do that when you can actually pay yourself and you have the cash flow to spend on it." Paid ads require skills AND money. Running ads without skills on either ads management or ad creative wastes both.
- **Why it worked**: This is a risk management principle. Paid ads have a learning curve with real money at stake. Without skills, the spend-to-learn cost can exceed the budget available. Organic channels have the same learning curve but cost time, not cash. For a pre-revenue or early-revenue founder, time is less scarce than cash.
- **CELLO application**: CELLO has no paid ads budget. This step is explicitly deferred until CELLO has MRR that can fund a test campaign. When that point arrives, the channel and format will already be validated by organic distribution — so the ads will amplify a known winner, not test an unknown.
- **Category**: `prerequisite`

---

**[Launch an Affiliate Program After the Product Is Solid]**
- **What they did**: Florian places affiliate marketing last in the sequence deliberately — "I like to put affiliate marketing at the end because for me it's always good to have the best product ever to actually get your affiliate marketer to get result." Key metrics to publish on the affiliate page: conversion rate, average customer lifespan (so affiliates can calculate expected recurring commission).
- **Why it worked**: Affiliate programs only work when the product has high retention and high conversion. An affiliate sending traffic to a product with a 2-month average customer lifespan and a 1% conversion rate makes almost nothing — they stop promoting. A product with a 5-month average lifespan and a 5% conversion rate makes affiliates real money — they promote more. The quality of the affiliate program is downstream of the quality of the product.
- **CELLO application**: An affiliate program makes sense for CELLO once retention data is available. The natural affiliates are: developer advocates who already use CELLO, AI tool reviewers, MCP server directories/aggregators, and developer-focused newsletter authors. The pitch to affiliates: "Here's our 90-day retention rate. Here's our conversion rate from developer click to paid subscriber. Here's your expected monthly commission per referral." Build the affiliate page only after having 3 months of real retention data to show.
- **Category**: `ongoing-distribution`

---

## Foundations / Prerequisites

These are the structural conditions Florian treats as non-negotiable before any distribution work makes sense.

**1. First Paid User Is the Real Gate**
Do not invest in boring marketing, viral content, or any distribution infrastructure until you have at least one paid user. A free user proves interest; a paid user proves value. Compounding on zero confirmation wastes every subsequent hour.

**2. GEO Takes 72 Hours; Start It Immediately**
GEO (AI search optimization) is the only boring marketing tactic that shows results within days, not months. Medium listicles + LinkedIn Articles + Reddit answers can produce AI search mentions within 72 hours. This should be done in the first week of any launch, not deferred.

**3. SEO Takes 90 Days; Plant the Seed Before You Need the Harvest**
Start building the SEO base (website structure, keyword targeting, first articles, first backlinks) while you're focused on viral marketing. You won't see results for 90 days, but if you wait until you need results, you've lost 90 days.

**4. Scary Marketing Requires Both Skills AND Cash Flow**
Paid ads are for when you've found a winning channel, you have skills (or can hire them), and you have cash flow. Running paid ads without all three of these conditions burns money without producing customers.

**5. The Sequence Is Non-Negotiable**
Validate → Build GEO/SEO base → Viral marketing → Listen to customers → Refine product → Scary marketing → Affiliates. Skipping steps wastes the spend at each subsequent step. An affiliate program with a bad product produces no affiliates. Paid ads for an unvalidated product produce no customers.

**6. Viral and Boring Must Run Simultaneously**
Viral marketing alone produces unstable, spiky traffic. Boring marketing alone is too slow for early survival. Running both at once means: when boring starts compounding (month 3-4), you have customers and feedback from the viral work, so the boring content is smarter and better-targeted.

**7. Platform Fit Precedes Volume**
Posting volume only matters after you've identified the platform where your ideal customer actually spends time. Posting 10 pieces of content per day on the wrong platform produces nothing. Posting one thing per day on the right platform compounds.
