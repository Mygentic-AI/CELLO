# GTM Tactics: "I make $1M/year selling access to APIs I don't own"
Source: https://youtu.be/fkdsvPVejh8
Channel: Florian Darroman (@asyncr0ne)

---

**[Run ads from day zero — before the product is polished]**
- **What they did**: Shipped ZenU in a weekend (landing page + beta product + Stripe). Immediately started Google Ads on launch day, before the product was solid or the funnel was optimized. The first campaigns pointed straight to the homepage with no special landing pages.
- **Why it worked**: Ads gave instant traffic data and conversion signal before organic took hold. This allowed rapid iteration against real paying-intent visitors, not guesses. The acquisition cost was double the LTV at first — Mickey explicitly didn't care. The signal he was tracking was relative conversion rate vs. his other projects, not absolute unit economics.
- **CELLO application**: Ship the MCP + a landing page this weekend. Run Google Ads on day one targeting "agent communication", "MCP server trust", "AI agent identity", "AI agent API". You won't have a perfect funnel. That's the point — ads tell you which keywords convert before you write a single piece of content. Don't wait for the portal, the docs site, or the onboarding to be polished. The signal is: are developers clicking through and signing up? If yes, double down.
- **Category**: `launch-tactic`

---

**[Target high-intent, "branded competitor" keywords in paid search]**
- **What they did**: ZenU targeted searches like "Meta API", "TikTok API", "YouTube API" — searches for the very APIs their product wraps. These are high-intent searches from developers who already know they need the thing, are already hitting the friction, and are now looking for the solution. They can't rank organically (Meta outranks them for "Meta API"), but they can buy that spot.
- **Why it worked**: The searcher has already self-qualified. They know what they want. ZenU is showing up at exactly the moment pain is felt. No education required. Cost-per-click is higher, but the lead is already warm.
- **CELLO application**: Target: "MCP server authentication", "AI agent security", "Claude Code agent communication", "agent-to-agent protocol", "AI agent identity verification", "prompt injection defense". These are the searches a developer makes when they have the exact problem CELLO solves. Also consider "Claude Code MCP", "agent trust layer", "Ed25519 signing API". You can't outrank Anthropic for "Claude Code" organically — but you can buy position on the specific pain-point variants.
- **Category**: `launch-tactic`

---

**[Start simple: all ads to the homepage, no special landing pages]**
- **What they did**: At launch, every ad campaign pointed to the main landing page. No segmented landing pages per keyword, no A/B variants, no agency. Mickey ran the campaigns himself on a "set it and leave it" basis while building the product.
- **Why it worked**: Reduces execution overhead to zero so the founder can focus on product and support. Something was better than nothing. The signal from a suboptimal funnel is still a signal. Over-engineering the funnel before knowing what works is a trap.
- **CELLO application**: Don't build separate landing pages per use case before launch. Point all CELLO ads at the main cello.dev landing page. Once you see which keyword clusters actually convert (30-60 days), build targeted pages for those. The agency/optimization phase comes after you have data.
- **Category**: `launch-tactic`

---

**[Use ads data to guide SEO — not the other way around]**
- **What they did**: Early SEO was a scatter approach — AI-generated content, shooting at everything. Over time, they shifted strategy: look at which Google Ads keywords are actually converting, then write targeted, high-quality content for exactly those keywords. SEO became downstream of paid data.
- **Why it worked**: Ads give you conversion truth (not just traffic truth). Organic keywords that convert in paid are worth ranking for. Keywords that get clicks but no sign-ups are not worth the content investment. This inverts the usual "research first, write content, hope it converts" loop.
- **CELLO application**: Run paid for 60-90 days first. Let the ads show you which keyword clusters convert developers into signups or waitlist entries. Then write deep, authoritative content exactly for those terms. Don't burn content budget on "AI agent architecture" if "Claude Code MCP security" is what converts.
- **Category**: `seo-geo`

---

**[Avoid AI-generated content spam; go qualitative]**
- **What they did**: Mickey explicitly said they stopped generating lots of AI content and switched to fewer, higher-quality pieces. He believes Google treats quality (fewer but better pages) as a positive signal.
- **Why it worked**: Google's helpful content and spam updates have increasingly penalized thin AI-generated content. A technical product like ZenU gets credibility from authoritative, specific, deep content — not volume. One well-researched "Meta API vs ZenU: what you're actually dealing with" post outranks 50 shallow AI articles.
- **CELLO application**: Don't produce AI-slop content. CELLO's audience is technical. Write a handful of extremely deep posts: "How FROST threshold signing works in a federated directory", "Why AI agent identity verification is unsolved", "What happens when your AI agent gets prompt-injected". These index well AND position CELLO as serious cryptographic infrastructure (which directly supports trust with prospective adopters reading the code).
- **Category**: `seo-geo`

---

**[Build lock-in through integration depth, not contract lock-in]**
- **What they did**: ZenU's churn is low for enterprise clients because their API is integrated into those clients' apps, meaning their users' accounts are all connected through ZenU. To churn, the enterprise has to disconnect all users, rebuild the integration, and migrate all existing users — not just a developer headache, but a user-facing disruption. This is structural lock-in via integration depth, not contractual.
- **Why it worked**: The switching cost is borne not just by the buyer (the dev/company) but also cascades to end users. Nobody wants to break their users' social media connections. This creates a social switching cost on top of the technical one.
- **CELLO application**: This maps directly. When an operator registers their agents through CELLO — DKG shares distributed across the federated directory, sessions sealed with FROST signatures, contacts built up over weeks — the cost to migrate is enormous. The key shares are tied to the ceremony. The sealed receipts are on-chain. The contacts and trust signals are in the local SQLite. This is lock-in through cryptographic state that cannot be trivially re-created on a competitor. Emphasize this in sales conversations: "your agent's identity lives here; it can't be exported to another protocol without breaking all your existing sealed sessions."
- **Category**: `product-led-growth`

---

**[Double ad spend in lockstep with MRR — treat growth as mathematical]**
- **What they did**: Mickey described the growth as "mathematical." They doubled signups every month by doubling ad spend every month. MRR doubled as a result. He didn't think of it as "we got lucky." He treated it as: funnel health × spend = output. Keep the funnel healthy, keep increasing the input.
- **Why it worked**: De-romanticizes growth. Once you have a funnel that converts (even suboptimally), growth becomes a capital allocation decision. This removes analysis paralysis: if the funnel produces, spend more. The constraint is cash buffer, not strategy.
- **CELLO application**: This applies once CELLO has paying operators. Until then, treat ad spend as signal-buying. After launch, if ads are converting developer signups → paid plans at any reasonable rate, double spend monthly and track whether conversion ratio holds. If it does, the constraint is budget. Set a floor (e.g. you can spend $X/month without risking runway) and run at that ceiling.
- **Category**: `ongoing-distribution`

---

**[Hire for support before hiring for growth]**
- **What they did**: First hire was a developer. Second hire was a developer focused entirely on support and bug fixes (handling 150 Slack/Crisp conversations per day). Third hire was another developer. The first growth hire came after they were already at ~$80K MRR.
- **Why it worked**: At the early stage, support IS product development. Customer requests are the fastest signal loop. An inbound request is better data than any user interview. Having someone dedicated to handling and shipping against requests kept iteration fast and churn low. They didn't hire a marketer or growth person until product-market fit was obvious.
- **CELLO application**: Pre-launch: Andre is handling all support. Post-launch: the first hire should be a developer who handles operator support and quick bug fixes. The 150 conversations/day threshold is ZenU's. CELLO's first hundred operators will each have sharp, specific questions about MCP installation, DKG failures, session errors. Being fast on these prevents early churn and generates deep product feedback. Don't hire a marketer first.
- **Category**: `prerequisite`

---

**[Treat support as a real-time product feedback loop — no formal system needed]**
- **What they did**: They use Crisp for support chat. They get 150 conversations/day. No formal prioritization system — just a shared mental model of "what's been requested most." If it's small, tell Claude to ship it immediately. If it's big, put it on the roadmap. Mickey said: "there's no heat system, just lots of tickets."
- **Why it worked**: Organic prioritization from volume. If three customers in one day ask for the same thing, it's obviously important. No framework required. Speed of response is itself a retention mechanism — if an operator reports a DKG failure on a Friday and gets a fix by Monday, they don't churn.
- **CELLO application**: When CELLO has operators: use Crisp or Linear as a support channel. Don't build a fancy Canny/FeatureBase prioritization board. Watch the support queue for repeat requests. When the same MCP tool error or DKG edge case shows up three times, that's the next sprint item. Especially important for the install experience — MCP add/remove is already fragile; support tickets will surface the worst paths quickly.
- **Category**: `product-led-growth`

---

**[Build to validate, not to perfect — ship in a weekend, add Stripe immediately]**
- **What they did**: ZenU V1 was built in one weekend. Four or five social media API integrations. Added Stripe immediately. Started ads the same week. The product was not comparable to what ZenU is today. The point was to get conversion data.
- **Why it worked**: Time-to-signal is the only metric that matters before PMF. A weekend build with Stripe + ads tells you in two weeks whether anyone will pay. Two months of polish without this data is wasted time. The product improves; the validation question ("will anyone pay?") does not.
- **CELLO application**: CELLO already has a working V1 (cello-client published, directory nodes running). The "weekend ship" equivalent is launching the waitlist with a working demo. Record a 3-minute video of Claude Code on a laptop connecting to Hermes on AWS — two agents, real session, sealed receipt. Post it. That's the signal-getter. Don't wait for the portal to be polished or the endorsements feature to ship.
- **Category**: `launch-tactic`

---

**[Pick a growing category and be the API-first player in it]**
- **What they did**: Mickey noticed lots of people building social media integrations, but nobody building an "API-first tool" for it. The category (social media integrations for SaaS) was growing. The gap was the developer-friendly, infrastructure layer — not another end-user product. He positioned ZenU as picks-and-shovels for the people building picks-and-shovels.
- **Why it worked**: Being API-first in a growing category means your customers are builders. Builders have budget, technical sophistication to evaluate you quickly, and a strong built-in motive to adopt if the DX is good. You grow as their products grow (usage-based pricing upside). The category does your marketing — anyone building in the space eventually hits the same friction you solve.
- **CELLO application**: The growing category is AI agents. Everyone building an agent eventually needs: (a) a way to connect it to another agent, (b) a way to verify identity, (c) a way to defend against prompt injection. CELLO is the API-first trust layer for that category. Position it that way — not "CELLO the product" but "CELLO the infrastructure layer that every serious agent deployment eventually needs." The category tailwind is enormous.
- **Category**: `prerequisite`

---

**[Don't chase viral or Product Hunt — compound the channels that work]**
- **What they did**: ZenU did a Product Hunt launch at ~40K MRR. It didn't generate meaningful revenue. All the revenue came from the same channels (ads + SEO) that were already working. Mickey explicitly said there was "no viral post" that drove growth. It was hard, compounding work on two channels.
- **Why it worked**: Product Hunt launches are social proof for peers, not customer acquisition for developer-tool ICPs searching on Google. The ICP for ZenU (and CELLO) doesn't discover products via Product Hunt — they search Google when they hit the problem. Chasing a viral spike instead of compounding a working channel is a distraction.
- **CELLO application**: Do a Product Hunt launch for the community/credibility signal, not as a growth strategy. Don't reorganize sprints around it. The real CELLO acquisition channel is search (developers googling "MCP security", "AI agent authentication") and technical content. Those compound. A Product Hunt spike does not.
- **Category**: `launch-tactic`

---

**[Run two distribution channels simultaneously but bias toward the one with data]**
- **What they did**: ZenU ran Google Ads and SEO in parallel from early on. Mickey acknowledged they probably could have grown faster by picking one and hammering it. His retrospective advice: pick one, optimize the hell out of it first, then layer the second.
- **Why it worked (and the lesson from the mistake)**: Two channels in parallel means neither gets the full optimization investment. Ads gave faster feedback. SEO compounded but slowly. Retrospectively, dominating ads first (faster data, faster iteration) then layering SEO would have been more efficient.
- **CELLO application**: For launch, pick one channel: technical content + SEO (because it fits CELLO's trust-infrastructure positioning and zero ad budget). Run it hard. Add paid search only after content is generating organic signal and you have capital from initial operators. Don't split attention between YouTube, Twitter, Product Hunt, and SEO simultaneously.
- **Category**: `ongoing-distribution`

---

**[Partner with YouTube creators in the devtool space]**
- **What they did**: At the time of the interview, ZenU was beginning to explore YouTube — specifically partnering with devtool-focused creators, not running their own channel.
- **Why it worked (planned)**: Devtool creators have exactly the audience ZenU needs. A 10-minute "building with the Meta API — or just use ZenU?" video from a creator with 50K developer subscribers reaches more qualified prospects than running ZenU's own channel from scratch.
- **CELLO application**: CELLO's target audience — developers building AI agents, Claude Code power users, MCP server builders — is well-served by YouTube creator partnerships. Target channels covering Claude Code, MCP ecosystem, AI agents, LLM tooling. Offer to demo CELLO live on their channel: "connect two Claude Code agents and watch them verify each other's identity." This is a visual demo that's compelling to watch and immediately shows value. Don't build CELLO's own YouTube channel; piggyback on established audiences first.
- **Category**: `partnership`

---

**[Rebrand early if the name creates SEO or memorability friction]**
- **What they did**: ZenU originally launched as "getlate.dev." They rebranded to ZenU at ~$40-80K MRR. Reasons: hard to spell verbally, "late" is too generic (wouldn't rank for brand searches), potential trademark conflict with Later (social media competitor). The rebrand took ~1-2 weeks of technical work. SEO recovered quickly with proper redirects.
- **Why it worked**: Brand searches are important. If someone hears your product name at a conference and tries to find it on Google, they need to be able to spell it. A generic name means you'll never rank for your own brand. The rebrand cost was low (1-2 weeks) relative to the long-term SEO and memorability damage of keeping a bad name.
- **CELLO application**: "CELLO" is strong — memorable, spellable, unique in the agent space. No rebrand needed. However: ensure cello.dev (or the canonical domain) is clean on brand searches and doesn't surface a competing result. Also watch for collision with "CELO" (the blockchain project) — slightly different spelling but could confuse search.
- **Category**: `prerequisite`

---

**[Keep the team small and costs low so cash buffer grows faster than spend]**
- **What they did**: Mickey explicitly avoided overhiring. At $1M ARR, they were five people. He said "we have not over-hired" and keeping the team small was a deliberate strategy to maintain a cash buffer for ad spend. The VC trap he escaped was: raise money → hire aggressively → need to raise again.
- **Why it worked**: In a bootstrapped ad-driven business, the cash buffer IS the growth lever. If your costs scale with revenue, the buffer never grows and you can never double ad spend. Keeping costs flat while revenue grows gives you the capital to accelerate.
- **CELLO application**: CELLO is solo (Andre) pre-launch. Post-launch: resist pressure to hire before the business justifies it. First operators → first revenue → developer support hire. Don't hire a designer, a marketer, a DevRel person before the MRR supports it. Every dollar of burn is a dollar less to put into distribution.
- **Category**: `prerequisite`

---

**[Use customer conversations as the primary iteration engine, not async surveys]**
- **What they did**: Mickey jumps on calls with customers "sometimes, not every day." All five team members do support. They use Crisp chat. The data that drives roadmap decisions comes from support tickets, not user research sessions. If someone requests something and they can do it immediately, they do it immediately — "tell Claude to ship it."
- **Why it worked**: Async surveys get polite non-answers. Support tickets get real pain. The developer who files a ticket at 11pm is the developer who cares enough to stay engaged. Meeting them fast builds loyalty. Speed of response is a product differentiator in the developer tools space — if you fix bugs in hours rather than weeks, developers tell other developers.
- **CELLO application**: For the first cohort of CELLO operators: be in every support conversation. Watch for the same DX failures appearing repeatedly (MCP add/remove issues, DKG timeout confusion, session sealing errors). Fix them within 24 hours when possible. This is how you get testimonials and referrals from the first 10-20 operators — they experience white-glove support and become advocates.
- **Category**: `product-led-growth`

---

**[Validate relative to existing projects, not against absolute targets]**
- **What they did**: Mickey compared ZenU's early conversion data against his two previous side projects (one at 5K MRR, one at 7-8K MRR). He didn't need ZenU to be profitable on day one. He needed it to look meaningfully better than what he was already running. "The numbers were much better. It felt much easier." That was the go signal to kill the other projects and focus.
- **Why it worked**: Removes the validation moving-goalposts problem. You're not asking "is this a good business?" in the abstract. You're asking "is this better than what I'm already running?" A relative signal is much faster to get and harder to second-guess.
- **CELLO application**: CELLO is the only project. But the principle applies to distribution experiments: don't ask "is this YouTube partnership working?" Ask "is it converting better than the baseline of cold outreach?" Compare channels against each other, not against an ideal target.
- **Category**: `prerequisite`

---

**[Acknowledge the VC-to-bootstrap hybrid: growth mindset without growth-at-all-costs]**
- **What they did**: Mickey brought one thing from his VC-backed company to the bootstrapped world: the willingness to run paid ads aggressively from day one, before profitability. He explicitly said he combined "the VC growth mindset with being bootstrapped." He ran ads even when the LTV/CAC ratio was negative.
- **Why it worked**: Most indie hackers are too conservative with paid acquisition because they never had a VC-funded period where "spending to learn" was normalized. Mickey normalized it. The difference is: he had a capital floor (bootstrapped revenue from other projects) instead of a VC check. The mindset carried over; the dependency didn't.
- **CELLO application**: Andre has a VC background. Apply the same hybrid: be willing to put real money into ads (say $1-2K/month initially) to buy data, before the funnel is profitable. The difference from VC: this is capped by actual runway, not by what the market will give. Treat early ad spend as tuition, not ROI.
- **Category**: `prerequisite`

---

## Foundations / Prerequisites

Before any distribution tactic generates returns, these conditions must be true:

1. **A working, installable product with a payment path.** ZenU had a landing page, a beta API, and Stripe on day one. Without a payment mechanism, ads are burning money for waitlist emails. CELLO equivalent: `@cello-protocol/connect` is installable via npm, a paid plan exists (even a manual "email us for enterprise"), and the landing page explains the value proposition in one sentence.

2. **A memorable, searchable, unique brand name.** "CELLO" already satisfies this. Verify the domain situation and that brand searches return CELLO results, not the blockchain "CELO".

3. **A narrow, high-intent keyword target.** Know the 3-5 keywords you'll buy before you spend dollar one. ZenU knew "Meta API", "TikTok API" before launch. CELLO equivalent: decide before launch whether the primary keyword cluster is "MCP security", "AI agent identity", "agent communication protocol", or something else. Test one cluster before expanding.

4. **A cash buffer that survives negative LTV/CAC in the first 90 days.** Mickey didn't calculate to the cent — he just made sure the bank balance didn't go to zero. Know your monthly burn floor (hosting + maybe 1 part-time dev) and ensure you have 6 months of it before spending on ads.

5. **A support channel ready on day one.** Crisp, Linear, a simple email alias — whatever. The first operators will have questions. The speed of response to the first 10 operators determines whether they become advocates or churners.

6. **The ability to ship fast against inbound requests.** Mickey's team shipped small requests immediately. This requires a codebase that can be modified quickly, not one where every change requires a 30-minute deploy pipeline. CELLO's local binary constraint (operators run a pinned version) means some requests will require a new publish — have the publish pipeline fast enough to ship a fix within a day.

7. **Enough product depth that integration switching cost is real.** This is the churn defense. ZenU's switching cost is real the moment customer accounts are connected. CELLO's switching cost is real the moment an agent's DKG shares are distributed, sealed sessions exist, and the contact list is built. Get operators to that point as fast as possible in onboarding.
