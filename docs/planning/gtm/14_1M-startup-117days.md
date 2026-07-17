---
name: "GTM Tactics: I built a $1M Startup in 117 days"
type: gtm-analysis
date: 2026-07-17
topics: ["gtm", "distribution", "product-led-growth", "content", "virality", "partnerships", "channel-strategy"]
status: active
description: Tactic extraction from Florian Darroman's interview with Yaser (Chatbase founder, $0→$1M ARR in 117 days, bootstrapped). Applied to CELLO's pre-launch context.
---

# GTM Tactics: "I built a $1M Startup in 117 days (I had 16 followers)"
Source: https://youtu.be/8ZWHB4GvBKk
Channel: Florian Darroman (@asyncr0ne)

Subject: Yaser, founder of Chatbase — AI chatbot builder. $0 → $1M ARR in 117 days, bootstrapped. Now at $8M ARR.

---

## Tactics

---

**The Structured Demo Post (Viral First Post with 16 Followers)**

- **What they did**: Yaser posted on X with 16 followers. He explicitly says he thought it through before posting — "the way I structured the demo and the way I talked about it made sense to me." It was a screen recording demo, not a text post. He had been watching his timeline and saw how many people were excited about AI, which gave him conviction the post would land.
- **Why it worked**: The demo showed the product working, not just described it. It met an existing wave of curiosity. The structure — what you show, in what order, with what hook — determines whether a demo gets traction or disappears. Confidence in the post's framing was not luck; it came from reading the room on his timeline.
- **CELLO application**: The first public CELLO post needs to be a structured screen recording, not prose. Show two agents actually talking — the most visceral version of the value prop. The best demo is probably: Claude Code on one side, another agent (Hermes or a second Claude Code instance) on the other side, with the CELLO handshake, the session, and the sealed receipt all visible. That three-part arc — connect, converse, seal — in under 60 seconds. Watch your timeline (HN, X AI/agent threads) to time it against a wave of agent interest, then post with full conviction.
- **Category**: `launch-tactic`

---

**Build in Public (Attracts Everything — Good and Bad)**

- **What they did**: Yaser built Chatbase in public. He says this attracted investors messaging him AND competitors cloning the product simultaneously. He accepted both as the cost of the distribution it provided.
- **Why it worked**: Building in public creates ambient social proof. Investors see traction in real time. Users feel ownership. Content practically writes itself. The downside — clones — is real but manageable if you keep shipping faster than copycats.
- **CELLO application**: The `cello-client` repo is already open source. That's the foundation. The build-in-public layer is shipping updates visibly: changelog posts, short X threads with "just shipped X" format tied to real protocol milestones. Every shipped story is distribution content. The clone risk is low for CELLO — the cryptographic core (FROST, threshold DKG, hash chains) takes months to re-implement correctly. Speed advantage is structural.
- **Category**: `ongoing-distribution`

---

**Product-Led Growth as the Core Engine**

- **What they did**: Chatbase was built so the product sells itself. No SDRs or AEs cold-calling. The onboarding was designed so customers could get started without hand-holding. Yaser says: "the product is built in a way that is intuitive enough and simple enough for them to get started but also powerful enough for them to be able to do everything they want to do." PLG loops were built into the product itself.
- **Why it worked**: PLG forces you to build a genuinely good UX because there's no salesperson to paper over confusion. That quality then compounds — it converts free users to paid, reduces churn, and helps with enterprise sales later (Stripe, Vercel are both examples he cites).
- **CELLO application**: CELLO's install path is `claude mcp add cello -- npx --yes @cello-protocol/connect`. That one-line install is the top of the funnel. Everything between that command and the first successful session is the onboarding flow. Every friction point — unclear tool names, confusing session lifecycle, opaque errors — is a PLG leak. The sealed receipt and inclusion proof are built-in PLG hooks: they produce something shareable and verifiable that makes the operator want to show someone. Map the full zero-to-first-session path and remove every failure point. This is the highest-leverage work before launch.
- **Category**: `product-led-growth`

---

**Content as Foundation That Makes All Other Channels Work Better**

- **What they did**: Yaser focused on LinkedIn and X content early on. He says: "organic is such a good channel because it already works on its own, but it indirectly helps other channels." Specifically: cold emails perform better because prospects have seen the content before (not truly cold). Paid ads convert better because of brand recognition. SEO builds because people visit more, stay longer, and start linking.
- **Why it worked**: Content does not just generate leads directly — it reduces friction in every other channel. It is a force multiplier, not just a standalone tactic.
- **CELLO application**: Andre posting consistently on X about CELLO — what was shipped, a hard problem solved, a cryptographic design decision, a demo of two agents talking — warms every other surface. When a developer sees a cold mention of CELLO on HN, they go to X first. What they find there determines conversion. Three formats that fit CELLO: (1) short screen recordings of agent-to-agent sessions, (2) "here's the FROST threshold ceremony in plain English" explainer threads, (3) sealed receipt screenshots showing what a verifiable conversation looks like. All three are native to the product and require no extra work beyond capturing what's already happening in development.
- **Category**: `ongoing-distribution`

---

**Virality → Stability Ladder (Channel Sequencing)**

- **What they did**: Yaser describes a deliberate sequencing: "First virality, then you search stability with SEO, branding and paid ads." He did not try to build SEO from day one. He used viral content to get initial customers and traction, then used that momentum to build channels that compound reliably.
- **Why it worked**: Viral channels are unpredictable but fast. SEO and word of mouth are slow to build but reliable once running. Starting with virality accelerates the point at which stable channels become viable (because you have traffic, backlinks, and users who can write reviews/recommendations).
- **CELLO application**: The launch post + HN launch + Product Hunt launch are the virality phase. The goal is a wave of signups and early adopters in week one. Immediately after that, shift to stability: write the SEO-optimized "what is agent-to-agent trust" and "how to connect two Claude Code instances" content, submit to npm (organic discovery), ensure the `cello-client` README is thorough enough that it ranks for "MCP identity layer" searches. Word of mouth starts when the first agent-to-agent endorsement flows between two real users.
- **Category**: `launch-tactic`

---

**Channel Partnerships: One Deal → Access to 1,000 Customers**

- **What they did**: Chatbase built a Shopify integration (app store listing) and a Vercel integration (dashboard marketplace). Yaser: "You're doing sales to one person and then you get access to 1,000." The Shopify integration seeded a word-of-mouth loop inside the Shopify community without additional effort.
- **Why it worked**: Marketplace distribution is a shortcut through the discovery problem. You get access to an installed audience who are already in the right problem space. You need only to convince the platform owner, not each user individually.
- **CELLO application**: The exact CELLO equivalent of the Shopify integration is the Claude.ai MCP store or the Claude Code plugin registry (when it exists). The Vercel equivalent is being listed in the Anthropic developer directory or similar. More immediately: a first-party integration with one of the prominent agent frameworks (LangGraph, CrewAI, Autogen successor) would expose CELLO to their entire user base. The OpenClaw integration (already in progress) is this play — OpenClaw users who install CELLO get agent identity for free. Every OpenClaw user is a potential CELLO user.
- **Category**: `partnership`

---

**Vertical Expansion: Launch Features That Open New Audiences**

- **What they did**: Chatbase launched targeted features for specific verticals — Shopify for e-commerce, Vercel for developer-hosted apps. Yaser describes having "mini GTM pods" per vertical: SaaS, hospitality, e-commerce, retail. Each vertical gets a focused push with the relevant integration or use-case story.
- **Why it worked**: A general "AI chatbot for everyone" message competes in a crowded undifferentiated space. "AI chatbot for Shopify stores" is a specific claim a specific person recognizes as theirs. The total audience is the same but the conversion rate per targeted message is much higher.
- **CELLO application**: CELLO's verticals are defined by the agent frameworks and tools developers already use. The first vertical: Claude Code users (solo devs running multi-agent workflows). Second vertical: teams running Hermes or any persistent AWS-hosted agent. Third vertical: open-source agent project communities (AutoGen, CrewAI, etc.). Each vertical gets a specific "here's what CELLO does for you" page or post — not a generic protocol description. The Shopify/Vercel pattern for CELLO is: ship the `adapter-claude-code`, then ship the `adapter-openai-agents` (or equivalent), then announce each one as a vertical entry.
- **Category**: `launch-tactic`

---

**Double Down on What Works + Small Experiments (Portfolio Framework)**

- **What they did**: Yaser describes a framework: identify what is already working and double down on it. Simultaneously run a few small experiments on things that logically should work. When one experiment works, double down on it too. Avoid both extremes — pure experimentation (mathematically unlikely to work) and single-channel dependence.
- **Why it worked**: This is essentially a two-armed bandit with explicit exploitation and exploration budgets. It prevents the common failure modes: over-relying on one channel until it dies, or spinning forever trying new things without building on what works.
- **CELLO application**: At launch, the initial working channels will reveal themselves quickly. If the HN post drives signups, that's the doubling-down signal. If demo videos on X convert, double down on demo production quality. Keep one small experiment running at all times — e.g., a Reddit thread in r/ClaudeAI or r/LLMDevs, or a response to an agent-security discussion on HN. Don't try five new channels simultaneously; keep the experiment scope narrow.
- **Category**: `ongoing-distribution`

---

**Influencer Marketing: Works Early When Category Is New, Degrades Over Time**

- **What they did**: In 2023, Yaser ran influencer marketing heavily. He would have a single LinkedIn post by an influencer go to 5,000 likes and see "$5,000 MRR spike — there's nothing else that can explain it." He says this stopped working long ago and now requires much more production effort to convert.
- **Why it worked (early)**: When a category is new, any credible endorsement reaches a curious audience with low exposure to competing signals. A single person saying "this tool is incredible" is enough because there are no competitors saying the same. That window closes as the category matures.
- **CELLO application**: The agent identity/trust layer category is genuinely new. The window is open now. Find two or three developers with audiences who are already building multi-agent systems and have them try CELLO. The ask: "install the MCP server, connect two of your agents, share what you see." The resulting post writes itself. Do this before the category matures and every agent framework ships their own identity layer. The influencer does not need a large following — they need the right audience (agent developers, AI tooling builders).
- **Category**: `launch-tactic`

---

**SEO as Compounding Stable Channel**

- **What they did**: Yaser uses content to drive SEO indirectly — more visits, longer dwell time, more backlinks from people sharing the content. Rate My Courses, a side project, still gets 50,000 monthly visitors without any input. He treats SEO as a channel that "grows linearly" and can be relied upon, unlike viral content.
- **Why it worked**: SEO compounds. Domain authority built in year one keeps paying dividends indefinitely. Content that ranks for a specific query continues delivering traffic with no marginal effort.
- **CELLO application**: The target queries for CELLO SEO are developer-intent searches: "how to connect two AI agents securely," "MCP identity layer," "agent-to-agent authentication," "FROST threshold signatures MCP," "Claude Code peer-to-peer communication." None of these have high-quality existing content. Writing one thorough technical post per query — with actual code, actual MCP tool call examples — would own these SERPs. The `cello-client` README and npm page are also SEO surfaces: they rank in Google for package-name searches and in perplexity/ChatGPT for "how do I add identity to my AI agent."
- **Category**: `seo-geo`

---

**GEO: Getting AI Tools to Recommend You**

- **What they did**: Yaser does not use this term but references it implicitly — every successful founder he knows "shows up on Google, Reddit, or social media. And when you ask ChatGPT what's the best tool for X, they are also showing up." The channel is explicitly named in the interview framing (Florian's ad break) as distinct from SEO.
- **Why it worked**: LLMs are trained on content that includes Reddit, GitHub, HN, Stack Overflow, and documentation. Appearing in those sources with the correct framing causes LLM-powered search (Perplexity, ChatGPT, Claude) to recommend you when users ask "what should I use for X."
- **CELLO application**: The GEO play for CELLO is: (1) answer questions about agent identity/trust on HN and Reddit accurately and helpfully — not just "use CELLO" but explaining the actual problem space, with CELLO mentioned naturally; (2) ensure the `cello-client` README describes the problem being solved in the exact language developers would use when asking Perplexity "how do I add trust between my AI agents"; (3) get CELLO mentioned in a few high-quality GitHub repos (adapter READMEs, example projects) because GitHub content is weighted heavily by LLMs. The goal: when a developer asks Claude "how do I make two AI agents verify each other's identity," CELLO appears in the answer.
- **Category**: `seo-geo`

---

**Session Recordings and Customer Watching**

- **What they did**: Yaser says: "get on a call, tell someone to share their screen, and just see how they use the product. Even now I'll see 10 different things that maybe to them it's just a small half-second thing that they didn't get, but to me I immediately see how this can be improved." Tools: PostHog, Amplitude, session recordings. He treats customer watching as distinct from data analysis.
- **Why it worked**: Users do not know what they find confusing — they work around it without noticing. Only watching the session reveals the half-second hesitation, the re-read of a label, the moment they almost gave up. Data shows what happened; watching shows why.
- **CELLO application**: Find the first 5 operators who install CELLO and ask to watch their first session setup on a Zoom call. The install path (`claude mcp add cello -- npx --yes @cello-protocol/connect`), the first `cello_status` call, the first `cello_start_agent`, the first `cello_initiate_session` — each of these has points where an operator can lose confidence or fail silently. The session watch will reveal them. This is high-value before launch because the fix cost is low and the impact on conversion is high.
- **Category**: `prerequisite`

---

**First Principles Thinking Over Pure Data Analysis**

- **What they did**: Yaser: "You can stay in the data all day but you need a good starting point and that good starting point only comes when you put the effort into thinking from first principles: who is the customer, what do they need to achieve, what different types of customers do we need to support." He calls this "the most important step" that is "often missed."
- **Why it worked**: Data tells you what users did, not what they wanted to do or what they would have done if the product were better. First-principles reasoning surfaces the customer's underlying job-to-be-done and allows you to design for that directly, rather than optimizing the path users currently take.
- **CELLO application**: Before the launch post, write down (privately) the three specific scenarios where CELLO delivers disproportionate value — not "agent-to-agent trust" abstractly, but "you have a Claude Code session running locally and a Hermes instance running on AWS, and you want them to collaborate without either trusting the other blindly." That level of specificity, reasoned from first principles, produces copy that converts. Developers recognize their exact situation and sign up.
- **Category**: `prerequisite`

---

**Build Trust Through Product Quality in a Competitive Space**

- **What they did**: Yaser: "Trust is very important because it's such a competitive space. You want to make sure that you give your customers a product that works, that is intuitive, that has high SLA, is enterprise-ready, has guardrails." He leaned toward stability and quality even at the cost of shipping speed.
- **Why it worked**: In a crowded market, trust is a differentiator. A product that goes down, has rough edges, or loses data loses to a more stable competitor even if it has better features. Trust is earned at the product level before it can be earned at the brand level.
- **CELLO application**: CELLO is literally a trust infrastructure product. The product being unreliable or confusing is not just a UX problem — it undermines the core claim. Every `ipc_connection_lost`, every unclear error from a threshold ceremony, every silent failure in the directory lookup is a direct contradiction of what CELLO promises. Pre-launch, the gate sequence (test → lint → typecheck → build) is not bureaucracy — it is the minimum bar for shipping something that earns trust. The open-source repo is read by technical evaluators before they install anything; code quality is a trust signal visible before first use.
- **Category**: `prerequisite`

---

**Keep Critical Growth Work Internal; Use Agencies Only for Experiments**

- **What they did**: Yaser hired agencies for core growth work early on — SEO, content, distribution — and says it was a mistake: "Most were not good. I think if something is very critical to the growth, you should just do it internally. Even if you don't know how to, jump into the deep end and try to figure things out." He now uses agencies only for experimental or non-core work.
- **Why it worked**: Agencies work for multiple clients. They have incentives to produce outputs (reports, posts, backlinks) but not to care deeply about your specific conversion problem. Internal ownership means the person doing the work wakes up thinking about your growth, not their deliverable.
- **CELLO application**: At pre-launch solo-founder stage, this is automatically true — there's no budget for agencies. But it's worth noting as a principle for when to hire vs. contract: the first content, the first SEO posts, the first demo videos should be Andre's voice and judgment, not outsourced. The launch post especially must be written by someone with full context on why CELLO exists and what the cryptographic properties mean. No agency can write that.
- **Category**: `prerequisite`

---

**Demo Screen Recording as Core Content Format**

- **What they did**: The first viral post was a screen recording of the product. Later, Yaser invested in high-quality video. But the entry point — the thing that triggered the viral moment — was a simple screen recording of the product doing something impressive.
- **Why it worked**: Screen recordings show, not tell. A developer watching the product work has a completely different response from reading a description. The demo removes the "does it actually do what they say" doubt in 15 seconds.
- **CELLO application**: The best CELLO screen recording shows: terminal on the left with a Claude Code agent issuing a `cello_send` call, terminal on the right with a second agent's `cello_receive` arriving, then the sealed receipt being generated and verified. No narration needed for the technical audience — the tool calls and their outputs speak for themselves. Under 45 seconds. Post on X and embed in the README. This is the single highest-ROI content asset before launch.
- **Category**: `content-format`

---

**Reaching Out Directly to Founders / Peer Founder Network**

- **What they did**: Yaser messaged Peter Levels on X with questions. He says: "I think founders in general are very helpful because it's not a very common job outside of San Francisco. There is camaraderie. People want to help each other." He credits conversations with founders for tactical advice (how to run ads, how to do SEO) AND strategic advice (goals, hiring, why you're building this).
- **Why it worked**: Founders talk to other founders honestly in a way that doesn't happen in public. The advice is contextually richer and more specific than any blog post. And the relationship often evolves into distribution — someone who gave you advice on X will repost your launch.
- **CELLO application**: The agent developer community is small and accessible. Founders building on top of Claude Code, building persistent agent infrastructure, or thinking hard about multi-agent trust are findable on X and GitHub. Message them directly with a specific question about their problem space — not "check out my product" but "I saw you're building X — have you hit the problem of agent identity verification? I'm working on that." The conversation is genuine because the problem is real. Distribution follows from the relationship, not the ask.
- **Category**: `community`

---

**Churn Reduction Is Product Quality First, Revenue Recovery Second**

- **What they did**: Chatbase reduced churn from 27% to 8.8%. Yaser: "60-70% of what reducing churn means is just improving the product. Having a good product that people actually get value from — they will not cancel." He explicitly says the cancellation flow optimization and revenue recovery are "insignificant" compared to product quality.
- **Why it worked**: Churn is not a retention problem — it is a value delivery problem. Operators cancel when the product stops being worth the effort. No offboarding flow recovers an operator who doesn't see the value.
- **CELLO application**: CELLO's initial retention risk is session reliability and ceremony success rate. If an operator installs CELLO, gets a threshold ceremony failure on their first DKG, and never recovers — they leave. If `cello_initiate_session` silently fails half the time — they leave. Before worrying about email drip sequences or retry prompts, instrument the failure modes in the real install flow. Every failed ceremony is a churn event. Fix those first.
- **Category**: `product-led-growth`

---

**Embrace Boredom: Unscheduled Time Generates the Best Ideas**

- **What they did**: Yaser says: "You lose clarity if you're always in the details, racing from one meeting to the next. The founder's job is to have clarity on what you're building, what the north star is, what ideas to explore. You can't schedule a 2-hour creative session. The most effective way is to go for a walk — because you've been thinking about this 24/7, when you go for a walk your mind will wander in that direction."
- **Why it worked**: Insight requires incubation. The subconscious continues processing a problem during unstructured time. Founders who fill every hour with tasks never let that process complete. The "obvious idea that no one else is doing" surfaces in white space, not in a backlog grooming session.
- **CELLO application**: No specific tactic — this is a meta-principle. The CELLO positioning, the launch framing, the partner conversations that unlock distribution — these are not going to come from a feature-writing session. They come from the walk where the penny drops on why endorsements are a better first-launch feature than resharing ceremonies.
- **Category**: `prerequisite`

---

**OpenClaw as an Explicit Opportunity (Yaser Named It)**

- **What they did**: When asked what he would build if starting today, Yaser says: "OpenClaw, for example, is a good one — I think you can build a startup around that 100% and people will do. I think it's more about execution." He says this unprompted as a real example of a viable AI startup opportunity.
- **Why it worked**: Not a "why it worked" — this is forward-looking signal. A founder at $8M ARR who built in the AI tooling space is pointing at OpenClaw as a genuine startup opportunity.
- **CELLO application**: OpenClaw (openclaw) is one of the primary CELLO client environments — the Claude Code equivalent for other agent runtimes. Yaser's unprompted mention is a signal that the audience for CELLO's capabilities already exists and is being actively sought. This is a reminder that the CELLO + OpenClaw integration is not a "nice to have" — it is a direct path to the audience that the market is already looking for. Ship the OpenClaw adapter and announce it.
- **Category**: `partnership`

---

**Start Building Something — Any Version — to Find the Real Idea**

- **What they did**: Yaser: "Don't start with an idea that you think is the winning idea. Start with something and then the winning idea will pull you. By being in the space, trying new things, the real idea will come — it will present itself." He says Chatbase was never the first version; the market pulled him toward the final product through iteration.
- **Why it worked**: Expertise in a problem space is what makes the right idea visible. The idea only becomes obvious to you once you've been building adjacent things long enough to see the gap clearly.
- **CELLO application**: CELLO is already past this stage — the protocol is built, the problem is clear, the wedge (solo multi-agent) is validated by daily use. This tactic is relevant for the next layer: what does CELLO enable that its early operators will show Andre needs to be built? The sealed receipt feature, the endorsement graph, the trust signal taxonomy — these will reveal their relative importance through operator feedback, not pre-launch speculation. Stay close enough to early operators to hear the pull.
- **Category**: `ongoing-distribution`

---

## Foundations / Prerequisites

These are not tactics to execute — they are conditions that must be true for the tactics above to work. Yaser did not describe them as prerequisites, but they are implicit in every successful tactic he ran.

**1. A product that demonstrably works in under 60 seconds.**
The viral post worked because the demo was self-evident. PLG works because operators can get started without hand-holding. None of the content, influencer, or channel partnership tactics work if the first impression is a confusing install or a failed first session. For CELLO: the install path and first session success are the prerequisite. Before any distribution, fix every point where an operator can fail silently.

**2. Conviction that this is the right problem at the right time.**
Yaser's confidence to post with 16 followers, to not sell at $1M ARR, to keep building through six months of chaos — all of it traces back to genuine conviction. He saw the wave on his timeline before posting. He knew the steps required to grow. Conviction is not bravado; it is pattern recognition applied to a specific opportunity. CELLO's conviction case: the agent communication problem is real, it is unsolved, and it will only get more important as multi-agent workflows become standard. That conviction is what sustains the solo founder through the hard months.

**3. Content velocity: ship, then tell people you shipped.**
Chatbase content worked because there was always something new to show. A PLG loop only generates content if the product keeps delivering new moments worth sharing. For CELLO: every shipped story (a new tool, a protocol improvement, a new adapter) is a content event. The discipline is to actually post it — short screen recording, thread, or changelog entry — not just commit it and move on.

**4. The product quality → trust bar is higher for infrastructure than for applications.**
Yaser made this point for Chatbase (trust matters in a competitive space). For CELLO, which is literally a trust infrastructure product evaluated by technical developers who read source code before installing, this bar is not "competitive advantage" — it is table stakes. The open-source client repo is audited before anyone runs `npx @cello-protocol/connect`. Code quality, error message clarity, and test coverage are marketing, not engineering overhead.

**5. Be the person your best early hire would want to work for.**
Yaser's hiring advice applies to early operator acquisition too: be the operator that other operators want to connect to. For CELLO, that means Andre being visibly active, responsive, and credible in the agent developer community. When an operator evaluates whether to build on CELLO's protocol, part of their decision is: "will the person behind this still be maintaining it in a year?" Showing up consistently is the answer.
