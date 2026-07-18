---
founder: Florian Darroman
company: Distribute (formerly Rebel Growth)
stage: $12,700 MRR (Distribute); ~$24,000/month total revenue across all sources
date: June 2026 (internal: "2nd of June"; prior video uploaded "in 2025")
---

Florian Darroman is a French entrepreneur living in Bali who co-founded Distribute, an SEO and GEO SaaS that helps website owners schedule content, manage backlink exchanges, and get recommended by AI assistants like ChatGPT and Claude. He joined as a co-founder when the product was at $7,400 MRR under its old name Rebel Growth, ran a complete product audit with Open Floor, stripped the feature set down to a focused core (removing social media scheduling entirely), and rebranded — reaching $12,700 MRR two months later. Alongside Distribute he runs the Profitable Founder Club, a paid bi-weekly mastermind community, and earns from YouTube content and partnerships, totalling roughly $24K/month after starting the year at near-zero. The story is worth reading as a tight case study in sequencing: audit and cut the product, nail the ICP through customer calls, establish a personal content voice, then run organic distribution — X, YouTube Loom screencasts, Reddit, SEO, and GEO — in that order. The GEO finding is particularly relevant: by the time of recording, AI assistants had surpassed traditional SEO as Distribute's top lead source, and they were already building features to compound that channel.

# GTM Tactics: "Building a $100K/month SaaS in Bali"
Source: https://youtu.be/MU9WWJK-4WQ
Channel: Florian Darroman (@asyncr0ne)

---

## Extracted Tactics

---

**Ship the Rebranded, Cut-Down Product Before Scaling Distribution**

- **What they did**: Before ramping any distribution channel, Florian and his co-founder Bora did a complete audit ("we used Open Floor to do a full audit of the tool"), rebranded from Rebel Growth to Distribute, and cut entire feature categories — including social media scheduling — to produce a "minimalist product." Only after that did they accelerate marketing.
- **Why it worked**: Distribution spend against a confused or bloated product generates churn that erases the revenue. They found a focused ICP and a clean value prop first, then pointed the traffic funnel at it. The product could finally "work" in the sense that customers stayed and didn't complain about missing features.
- **CELLO application**: CELLO is pre-launch and already has its wedge nailed (solo multi-agent: your own agents connect). Resist the temptation to surface every capability (sealed receipts, FROST ceremony internals, full endorsement graph) in the onboarding flow. Show one thing: "your Claude Code agent and your Hermes agent can find and talk to each other in 5 minutes." Everything else exists but stays in the docs. Cut the surface before starting the content engine.
- **Category**: `prerequisite`

---

**Extensive Customer Calls Before Claiming Product-Market Fit**

- **What they did**: "We spent, as you saw, a lot of time calling our customer, trying to get a lot of feedback to understand really what they need and what they don't need." The calls continued even after crossing $12K MRR — Florian noted that recent calls were no longer about bugs but about optimization conversations, which he used as a signal of PMF proximity.
- **Why it worked**: Customer calls surface the gap between what you think customers value and what they actually use. The social-media-scheduling cut was validated this way: no one complained when it disappeared because no one was using it for that.
- **CELLO application**: Before any content push, run 10 live calls with developers who have used Claude Code or run agents on AWS. Don't ask "would you pay for trust infrastructure?" — ask them to walk through their current multi-agent setup and narrate every place where they felt uncertain who was on the other end, whether a message was tampered with, or how they would shut something down if it misbehaved. The answers define the CELLO pitch in the customer's own language, which feeds every content piece.
- **Category**: `prerequisite`

---

**Feature Cutting as a Growth Lever**

- **What they did**: Explicitly removed social media scheduling. "All our customer, none of them complain about the fact that we removed it." They used absence-of-complaint as a positive signal, not a neutral one.
- **Why it worked**: A narrower product is easier to describe, easier to position, and reduces the cognitive load that blocks a trial. Cutting reduces support surface and lets the team build depth in the features that matter.
- **CELLO application**: CELLO's full protocol surface (FROST DKG, WAL, endorsements, inclusion proofs) is technically impressive and launch-irrelevant for most users. Launch with one visible surface: `cello_send` / `cello_receive` between two agents you own. Put everything else behind "advanced" docs. Don't remove the features — but don't advertise them in the onboarding flow. The narrower pitch ("your agents can find each other and talk securely") is what you run distribution against.
- **Category**: `prerequisite`

---

**Know Your ICP Before Running Distribution**

- **What they did**: Florian named "how did you find your ICP?" as a distinct phase that preceded the distribution strategy discussion. The ICP work involved the customer calls described above — it was not a spreadsheet exercise but an emergent output of listening.
- **Why it worked**: Distribution without ICP targeting produces noise and burns goodwill. The channels that worked (X, Starter Story, Reddit, YouTube) each reached a specific profile — not "everyone who builds SaaS."
- **CELLO application**: CELLO's ICP is probably one of three profiles: (1) solo developers who run Claude Code and have at least one other agent/service; (2) small AI teams who want their agents to interoperate without sharing API keys or central credentials; (3) security-conscious builders who run agents on behalf of clients and need accountability receipts. Before running any distribution, pick ONE of these and write every piece of content for that person. The three profiles need different pitches: solo devs need "zero setup, connects in 5 minutes"; teams need "no central trust broker"; security-conscious builders need "sealed receipts, your client can verify."
- **Category**: `prerequisite`

---

**Full Organic Distribution, Zero Paid Ads Until Product Works**

- **What they did**: "Right now we are still full organic. We are mainly pushing on X with my co-founder account and mine. We are now pushing on YouTube... we go also on Reddit. Of course, we have a lot of leads coming from SEO... We didn't start the ads yet, but we are going to do that now that we have a product that works, the churn gets lower."
- **Why it worked**: Organic distribution generates compounding assets (content, backlinks, community relationships). Paid ads are a tax on attention that stops the moment you stop paying. For an early-stage product where the message is still being refined, organic provides faster feedback loops because audiences respond with questions and objections that sharpen the pitch.
- **CELLO application**: Andre has no paid ads budget anyway, which makes this directly applicable. The entire CELLO distribution playbook must be organic: GitHub presence, developer X/Twitter content from Andre's account, YouTube screencasts, and writing that gets linked by other developers. This is not a constraint — it is the correct strategy for a developer-trust product. Trust infrastructure sold through ads would be ironic.
- **Category**: `ongoing-distribution`

---

**X (Twitter) as Primary Distribution Channel — Founder Account First**

- **What they did**: Distribution was "mainly pushing on X with my co-founder account and mine." Co-founder Bora also had a growing account. They did not create a company account and push from there — they pushed from their personal followings.
- **Why it worked**: Developer Twitter responds to people, not logos. A company account for a zero-name product gets zero organic reach. A founder account with genuine technical posts builds trust and earns retweets from other builders.
- **CELLO application**: Andre's account should be the primary distribution surface. Post about what you're building and why: the specific technical problems CELLO solves (prompt injection over agent-to-agent channels, forged agent identities, no accountability receipts for AI actions), the design decisions (why FROST instead of a single signing key, why P2P instead of a relay), and the working reality (connecting Hermes to Claude Code, what a sealed receipt looks like in practice). Do not hide behind "CELLO Protocol" branding early. The audience needs to trust Andre before trusting the protocol.
- **Category**: `ongoing-distribution`

---

**Daily Loom-Style YouTube Videos — Publish Near-Unedited**

- **What they did**: "We did daily video on YouTube. Super simple video. A Loom. We record our screen. We just publish almost without editing." This is a deliberate decision to favor volume and authenticity over production quality.
- **Why it worked**: For a developer audience, a polished video signals marketing budget; a raw screen recording signals someone who actually uses the tool. Loom-style videos with a real problem being solved — showing the working product — build credibility faster than product demo reels. Volume ensures the content appears in more search queries over time.
- **CELLO application**: Record a 5-8 minute screen capture once a week (not daily — you're one person shipping a protocol): "here's how I connected my Claude Code agent to my Hermes agent on AWS using CELLO — from zero to first sealed session." No editing beyond a trim at the start and end. Publish to YouTube. Titles are search-native: "Claude Code agent to agent communication," "how to verify an AI agent's identity," "sealed receipts for AI sessions." Each one is a long-tail SEO and GEO asset that compounds.
- **Category**: `content-format`

---

**Instagram Reels from the Co-Founder — Viral Reach**

- **What they did**: "Bora started to do reels on Instagram, and he's so good at it that he's getting viral already. And we get customer from that." The co-founder's personality fit the format, so they assigned it to him rather than forcing the format on the less-suited founder.
- **Why it worked**: Short-form video on Instagram reaches audiences that do not read developer Twitter or watch YouTube tutorials. For a SaaS product, these can be aspirational ("here's what I built this week") rather than technical. The viral mechanic is native to Reels' algorithm — quality engagement on one video pushes it beyond the follower base.
- **CELLO application**: Short-form video is harder to justify for a developer tool, but there is a specific angle that could work: "agent-to-agent communication looks like this" — a 30-second screen capture of two agents having a verified session, sealed with a receipt, with a voiceover explaining why this matters. The target is not Instagram's core audience but the spillover into developer TikTok and LinkedIn short video. Format: problem (AI agents can't verify each other) → solution (CELLO sealed session) → call to action (link in bio, waitlist). One per week, repurposed from YouTube recordings.
- **Category**: `content-format`

---

**Reddit as a Distribution Channel — Organic Lead Source**

- **What they did**: "We go also on Reddit." Not elaborated, but listed as one of the active organic channels alongside X, YouTube, and SEO.
- **Why it worked**: Reddit communities (subreddits focused on SaaS, indie hacking, specific developer tools) contain highly specific audiences who distrust marketing content but respond to genuine posts about technical problems. A post that answers a real question with a real tool gets voted up and stays discoverable for years.
- **CELLO application**: Target r/ClaudeAI, r/LocalLLaMA, r/SideProject, r/MachineLearning (for agent identity discussions), and r/devops (for the sealed receipt/audit trail angle). Do not post "check out my product." Post: "I connected my Claude Code agent to my production Hermes agent with cryptographic receipts — here's what the session log looks like and why I built the tool." Include the GitHub link and waitlist as footnotes, not the headline. The post must be the answer to a real question the reader already has.
- **Category**: `ongoing-distribution`

---

**GEO (Generative Engine Optimization) as a Distinct Channel**

- **What they did**: "The last few calls I had with my client were mainly people who come from AI. Which means that they are looking for a tool AI software to optimize their SEO or to automate their SEO, and they find us on AI. So, ChatGPT, Claude, Grok, etc. And that's something that we've been working on. And that's also what we do automatically on Distri, which is make sure that your product rank or get recommended by ChatGPT, Claude, Gemini, etc." Florian explicitly names this as a lead source that became dominant over SEO for their recent cohort.
- **Why it worked**: AI assistants are now a first-stop research tool for developers evaluating SaaS options. When a developer asks Claude "what tools exist for AI agent identity verification?" or "how do I make my agents trust each other?", the answer comes from the model's training data and from live browsing of authoritative sources. Being present in those sources — GitHub READMEs, well-written documentation, developer blog posts, and discussions that get indexed — determines whether the product surfaces at all.
- **CELLO application**: GEO is not just important for CELLO — it is ironic that a product used by AI agents would not be recommended by AI agents. Specific actions: (1) Write a clear, dense README that answers the question "what is agent-to-agent trust and why does it matter?" in plain language — models scrape READMEs. (2) Publish a technical overview page on the corporate site that defines terms (sealed receipt, FROST threshold signing, peer identity, session transcript) in one canonical place so models can cite definitions rather than hallucinating them. (3) Get mentioned in developer discussions on HN, Reddit, and X so those threads are indexed and used as training/retrieval sources. (4) When writing documentation, structure it as Q&A where the questions are exactly what a developer would type into Claude or ChatGPT: "how do I verify which AI agent sent this message?" "can AI agents forge each other's identities?" "what is a sealed session transcript?"
- **Category**: `seo-geo`

---

**Starter Story / Build In Public Platform Distribution**

- **What they did**: Florian listed "Starter Story Build" as part of the distribution mix when describing the 0 to 10K MRR growth path. Starter Story is a platform where founders document their journey and tools, and it drives significant SEO traffic to the featured products.
- **Why it worked**: Starter Story has domain authority and an audience that specifically searches for "how did you build X" and "what tools do you use." A feature there places you in front of people who are actively evaluating tools to use in their own projects.
- **CELLO application**: Submit a Starter Story case study: "How I built cryptographic identity for AI agents from scratch." Include the technical details (why FROST, what a hash chain gives you, the MCP interface design), the business context (what problem real developers face), and the current state. Starter Story's audience skews toward founders who build their own tooling and will evaluate CELLO on technical merit. The story also becomes an evergreen SEO asset that compounds.
- **Category**: `seo-geo`

---

**Podcast as a Distribution and Credibility Channel**

- **What they did**: "I push it on my podcast." The podcast is listed alongside X and YouTube as an active distribution channel. It also serves as a credibility venue — Florian gets interviewed on other people's podcasts too ("we got invited in one of the biggest channel about SaaS Founder").
- **Why it worked**: Podcasts compound because episodes stay discoverable. A guest appearance on a well-trafficked show delivers access to an established audience that the guest's own channels cannot reach. As host, a podcast builds a network of guests who become distribution partners.
- **CELLO application**: Andre should be a podcast guest, not (yet) a podcast host. Target developer-focused shows: The Changelog, developer X/Twitter space conversations, AI agent–focused podcasts. Pitch angle: "I built the trust layer for AI-to-AI communication — here's why identity and receipts matter more than model capabilities." The host audience is technical, the conversation will be honest about what CELLO does and does not do, and the episode becomes a GEO asset (shows get transcribed and indexed). A guest slot on one well-matched show beats five mediocre blog posts.
- **Category**: `ongoing-distribution`

---

**Big-Channel Interview as a Validation Event**

- **What they did**: "We got invited in one of the biggest channel about SaaS Founder, so it will be released pretty soon." They built this up as a major milestone — a third-party validation that would drive awareness and lend credibility.
- **Why it worked**: Earned media from a respected channel does what paid ads cannot: it transfers trust. A viewer who already trusts the host extends that trust to the featured founder and product. The interview also becomes an evergreen asset.
- **CELLO application**: Identify 3-5 YouTube channels and podcasts in the AI/developer space where an honest conversation about agent identity would resonate: channels covering Claude Code specifically, AI engineering broadly, or security in AI systems. Pitch not as "my product is great" but as "there's a genuine unsolved problem in AI agent communication and I want to talk through it." The interview format lets you explain FROST and sealed receipts without a paid ad feeling. One placement in a trusted show delivers qualified leads for months.
- **Category**: `partnership`

---

**Community Mastermind (Profitable Founder Club) as a Revenue and Learning Layer**

- **What they did**: Florian launched a "Profitable Founder Club" — a bi-weekly group call mastermind. It generates revenue ($24K monthly total included community as a component), provides a captive audience for guest speakers like Neville (20K → 113K MRR in 3 months), and gives Florian live access to founder problems he can use to improve his product and content.
- **Why it worked**: A paid community creates a self-selecting audience of serious buyers, not tire-kickers. The social proof compounds: when members help each other ("sometimes during the call I almost don't say anything and they are just helping each other"), the value exceeds what the founder provides unilaterally.
- **CELLO application**: A community is premature before launch, but the mechanic it enables is not: a small, private group of early adopters who are technically deep and willing to give feedback. A Discord or Slack with 10-15 developers who actually connect their agents creates the equivalent of the mastermind call — a high-quality feedback loop, early testimonials, and the social proof that early adopters talking to each other generates. Frame it as an "early access cohort," not a paid community. Invite by hand, not by funnel.
- **Category**: `community`

---

**Guest Speakers Delivering Value to Community (Network as Asymmetric Distribution)**

- **What they did**: Florian brought in Neville — a founder who went from 20K to 113K MRR in three months — to do a Q&A for the Profitable Founder Club. The speaker benefits (access to a curated audience), the community benefits (direct access to someone who did something rare), and Florian benefits (his community becomes more valuable without requiring his time to deliver all the value).
- **Why it worked**: Leveraging other people's expertise and stories makes a small community punch above its weight. The guest's social proof transfers to the community host. Members tell others about the call ("Neville is doing a Q&A tomorrow") which is organic word-of-mouth.
- **CELLO application**: For an early CELLO cohort, bring in a developer who has built something interesting with multi-agent Claude Code as a guest: "here's how I connected 3 Claude Code sessions to work on the same codebase." CELLO serves as the infrastructure those developers could use. The format creates an audience for CELLO without CELLO needing to be the only value proposition in the room. It also gives Andre intel on what builders are actually doing with agents.
- **Category**: `community`

---

**Physical Co-Location / Serendipitous In-Person Encounters**

- **What they did**: In Bali, by accident: "we used this affiliate platform called [PartnerStack/similar] and you may have heard about it. We were at a Bwork and we see this guy with a dog sticker on the laptop and we were like wait are you do you work at [that platform]? Yes I'm the founder." Another encounter: "One morning I was telling to Nico look at this website this is so cool... in the night he went to [Time left], he met the founder." Florian treated these as a value of being in a co-working/nomad context — co-located with other founders, running into real people behind the products he was already admiring.
- **Why it worked**: Random in-person meetings with relevant people happen at a much higher rate in founder-dense environments (Bali co-working spaces, SF coffee shops, specific conferences). These encounters become partnerships, referral sources, or content collaborators.
- **CELLO application**: AI developer conferences are now dense with exactly the right people: Claude Code builders, agent infrastructure engineers, security-oriented AI developers. AI Engineer World's Fair, Claude-focused meetups, local LLM/AI meetups. Show up, bring a working demo on a laptop, and let the product speak in person. A 5-minute live demo where two agents exchange a sealed session is more memorable than any content piece. One in-person conversation with a developer who immediately "gets it" is worth 20 cold DMs.
- **Category**: `community`

---

**Moat from Non-Software Elements (Physical, Community, Social Layer)**

- **What they did**: Florian's interviewees discussed this explicitly: "we feel like it's very nice today to have something that has like the mode outside of software. Whether it's hardware or whether it's community, whether it's social or like some physical element whatever it is is good cuz like we still we like in our market and like everything changes so fast and adapt so fast and like if you have no mode it's hard." Time left was cited as an example of a product with a social/interactive mode.
- **Why it worked**: Pure software products are commoditized faster in the AI era. A community moat, a network effect, or a social layer means competitors cannot simply copy the codebase and replicate the value.
- **CELLO application**: CELLO has a cryptographic moat (FROST threshold signing is legitimately hard to replicate fast), but that is invisible to most users. The visible moat is the trust network: your agent's contact list, your endorsements, your sealed receipts. These accumulate over time and cannot be ported away. A developer who has 50 agents in their CELLO contact list and 200 sealed sessions has something that has no value outside the protocol. This is the moat to communicate in GTM: "the longer you use CELLO, the more valuable your trust graph becomes." Frame adoption as building an asset, not buying a subscription.
- **Category**: `product-led-growth`

---

**Monthly Progress Vlogs (Build-in-Public Revenue Transparency)**

- **What they did**: The video itself is a detailed monthly update: "I generated $24,000 [in May]. This is not my income. This is not profit. This is what I generated." He breaks down sources (Distribute, Profitable Founder Club, partnerships, YouTube ads), gives the Distribute MRR figure ($7,400 → $12,700 over 2 months), and contextualizes all of it against where he was 6 months ago (zero).
- **Why it worked**: Raw numbers build trust in a way that vague success narratives do not. Developers, in particular, have a finely tuned filter for marketing language and respond to specificity. A monthly update with real MRR and named sources signals that this is a real product, not a ghost, and that the founder is accountable.
- **CELLO application**: Post a monthly build-in-public thread on X: waitlist signups, GitHub stars, beta users connected, protocol transactions processed. Do not inflate or sanitize. "We went from 0 to 11 beta users this month. 3 of them connected two of their own agents. Here's what broke and what we fixed." This builds the kind of credibility that developer audiences require before trusting cryptographic infrastructure. It also creates a searchable record that AI assistants will surface when someone asks about CELLO.
- **Category**: `content-format`

---

**Rebranding as a Reset + Positioning Weapon**

- **What they did**: "We rebranded everything at the beginning, so it was called Rebel Growth and we called it Distribute." The rebrand coincided with the feature cut and the ICP focus. They treated the rebrand not as a cosmetic change but as a complete repositioning.
- **Why it worked**: "Rebel Growth" does not tell you what the product does. "Distribute" at least points at the distribution category. A name change, when accompanied by a product focus change, lets you approach your existing audience with a fresh framing without the baggage of old positioning.
- **CELLO application**: Not directly applicable — CELLO's name and positioning are already set and technically meaningful. But the lesson applies to landing page copy and first-contact messaging. If the current "agent identity and trust" framing is not landing with developers, be willing to reframe around the outcome: "sealed conversations between AI agents" or "your AI agents know who they're talking to." Test the framing the same way the Distribute team tested features: by talking to users and watching which description makes them say "oh, I need that."
- **Category**: `prerequisite`

---

**Consistency Over Optimization — Volume Before Perfection**

- **What they did**: The entire opening of the video is a meditation on overthinking as the primary obstacle. "When they have an idea, they just do the thing... They don't even wake up the next day, they start to do the thing right now." And for content: "When I have something to share with you, I will just take the camera like I'm doing now, and just share the thing because yeah, you don't want I'm sure you want me to share everything actually, and not wait for the perfect moment, the perfect cinematic shot, the perfect setup."
- **Why it worked**: Distribution is a reps game. The tenth YouTube video teaches you what no amount of pre-planning could. The "perfect" content piece that takes a week to produce is usually outperformed by ten raw, honest pieces produced in the same week.
- **CELLO application**: The tendency for a technical founder is to wait until the protocol is perfect, the onboarding is smooth, and the documentation is complete before talking publicly about it. This is the same overthinking described in the video. CELLO has a working product now. Start publishing now. The imperfect demo where a session handshake takes 3 seconds too long is fine — it shows the product is real. The raw explanation of why FROST matters is fine — it shows you understand the problem. Ship the content the same way you ship code: frequently, with feedback loops.
- **Category**: `ongoing-distribution`

---

**Authentic Lifestyle Context as Audience-Building**

- **What they did**: The vlog interweaves product updates with personal life — the Bali setting, old broke-in-Bali memories, conversations with DJ friends about overthinking. The lifestyle content is not separate from the business content; it is the container for it.
- **Why it worked**: Viewers follow the person before they follow the product. The lifestyle content makes Florian relatable (he was broke, he overthinks, his successful friends also overthink) which builds the emotional trust that makes people want to support his business.
- **CELLO application**: Andre is building CELLO from a genuine conviction that agent-to-agent trust is a real, unsolved problem. That conviction, and the story of why he's working on it, is content. Not every post needs to be a technical breakdown. "Here's why I think AI agents without identity verification are a security liability" is a real point of view that builds an audience who will eventually try the product. The authentic context — building cryptographic infrastructure as a solo founder, the tradeoffs, the decisions that were rejected — is valuable content that a corporate player cannot replicate.
- **Category**: `content-format`

---

**Relatability as a Distribution Mechanism**

- **What they did**: "If anyone who started to share on YouTube or Instagram or whatever were always sharing this beautiful Lamborghini and Rolex and beautiful penthouse whatever, like you will feel like this is not achievable. These people are too far from me." Florian explicitly argues that showing your current real level — even if it looks modest — reaches the audience just below that level who need to see someone slightly ahead of them succeed.
- **Why it worked**: People follow aspiration that feels reachable. A founder with 5 paying customers and a working product is more credible to a developer who has zero paying customers than a founder with $100M ARR. The "slightly ahead" positioning builds a more loyal audience than pure authority positioning.
- **CELLO application**: CELLO's GTM should not lead with "cryptographic trust infrastructure for the agentic future" (too aspirational, too abstract). It should lead with: "I connected my two agents and here's what I learned about how untrustworthy the communication was before." Developer audiences do not want to feel behind — they want to see a real problem they recognize, solved in a way they could have built. The relatability is not about being modest; it is about being specific enough that the reader thinks "that's exactly my situation."
- **Category**: `content-format`

---

**SEO as a Compounding Organic Channel**

- **What they did**: "Of course, we have a lot of leads coming from SEO because that's what we do." SEO is listed as a distinct lead source alongside AI/GEO. For Distribute (an SEO tool), SEO is both their product and their distribution channel — they eat their own cooking.
- **Why it worked**: SEO compounds over time. Content published today accretes backlinks, search impressions, and domain authority. For a tool with a long buying cycle (developers evaluate, experiment, integrate), SEO delivers leads at the exact moment of need — when someone is actively searching.
- **CELLO application**: Target long-tail developer search queries: "how to authenticate AI agent messages," "agent-to-agent communication security," "MCP server identity verification," "cryptographic receipts for AI sessions," "how to prove what my AI agent said." Write one detailed technical post per query, hosted on the CELLO domain or the cello-client GitHub. These pages will rank slowly but durably, and they are exactly the pages that AI assistants will surface when a developer asks those questions via Claude or ChatGPT. SEO and GEO share the same content — a well-structured technical explainer serves both.
- **Category**: `seo-geo`

---

**Validating Channel Fit by Tracking Lead Source**

- **What they did**: Florian knew exactly where his customers came from: "the last few calls I had with my client were mainly people who come from AI" — and could track the shift from SEO to AI/GEO over time. He tracked Distribute, Profitable Founder Club, partnerships, YouTube ads separately in his revenue breakdown.
- **Why it worked**: Attribution clarity lets you invest in what works and stop investing in what does not. The insight that "AI is now our top lead source" would have been invisible without asking every customer how they found the product.
- **CELLO application**: From day one of beta, ask every user: "How did you find CELLO?" Keep a simple spreadsheet. The answer will determine where to concentrate content investment. If it is GitHub stars → write more in repo docs. If it is X DMs → double down on build-in-public posts. If it is ChatGPT recommendations → the GEO work is paying off and should get prioritized. Attribution tracking is free and irreplaceable.
- **Category**: `prerequisite`

---

**Partnerships and Sponsorships as Revenue Diversification**

- **What they did**: Florian's $24K monthly total includes "different partnerships or sponsorship that I got." These are listed alongside product revenue and community revenue as co-equal contributors to the total. He does not describe them as secondary or as a distraction from product work.
- **Why it worked**: Partnerships with aligned tools (for a distribution/SEO tool, partnerships with adjacent marketing tools or developer platforms make sense) provide revenue that does not require growing the core product and also provide distribution reach into the partner's audience.
- **CELLO application**: For CELLO pre-launch, partnerships are not monetization opportunities — they are distribution opportunities. Partnership with a developer tool that serves the same ICP (Claude Code extensions, agent frameworks, MCP server registries) means CELLO gets mentioned to developers who are already building the right thing. The form is not revenue-sharing but technical integration: "if you build with [adjacent tool], add CELLO for identity." Find one such tool, build a clean integration, and let both communities know about it.
- **Category**: `partnership`

---

## Foundations / Prerequisites

Before running any distribution channel, Florian's journey reveals the following must be in place first:

1. **Product audit completed.** Use an outside perspective (they used "Open Floor" for a full audit) to see the product as a user, not a builder. Remove features that no one defends. This is not optional — distribution against an audited product produces completely different results than distribution against a kitchen-sink product.

2. **ICP precisely identified.** Not "developers" but "developers who are currently doing X and experiencing Y." The ICP must come from actual conversations, not from an assumed profile. For CELLO: which developer is currently doing multi-agent work, has at least two agents that need to communicate, and has felt the absence of identity verification in a concrete way?

3. **Feature set cut to minimum viable pitch.** What single thing can a new user do in 5 minutes that proves CELLO's core value? Everything else is secondary documentation. The landing page, the README, the first tutorial, and all distribution content should be about that one thing.

4. **Name / brand coherent with the cut ICP.** "Rebel Growth" → "Distribute" because the name needed to match what the minimized product actually did. CELLO's name is strong — but make sure the tagline and first sentence of the README match the narrowed focus, not the full protocol surface.

5. **Lead source tracking in place from day zero.** Ask every user how they found the product. A spreadsheet is sufficient. Instruments before the first customer, not after.

6. **Churn baseline measured.** Florian tied the decision to start ads explicitly to reaching a point where "the churn gets lower." Distribution spend against high churn is net negative. Know the retention number before spending time on top-of-funnel.

7. **Founder content voice established.** Florian's distribution is inseparable from his personal voice and ongoing narrative. The content engine does not start on day one of distribution — it starts with the founder having a point of view and being willing to share it. For CELLO: Andre needs a clear, personal, honest point of view on why agent identity is unsolved and why he is the person to solve it, expressed in his own voice, before the content volume matters.
