# GTM Tactics: "Day 67 building a $100K/month SaaS in Bali"
Source: https://youtu.be/rJd-4dYmkuU
Channel: Florian Darroman (@asyncr0ne)

---

**[Build-in-public vlog: document the journey to a revenue goal]**
- **What they did**: Florian started a weekly vlog explicitly framed as "documenting the path from 10k MRR to 100k MRR." He commits to sharing everything — co-founder calls, decisions, lessons, mistakes — not as polished content but as a live record of what's actually happening.
- **Why it worked**: The goal is concrete and time-bounded, which gives the audience a reason to follow serially. It's not generic "founder content" — it's a specific bet with skin in the game. Viewers can root for (or against) it. It also creates accountability: stating the goal publicly makes pivoting or quitting more costly.
- **CELLO application**: Frame content around a concrete launch milestone — "building the trust layer for AI agents, targeting 100 operators by [month]." Weekly posts (even short ones) tracking: what shipped, what broke, what a real session looked like. The technical audience that CELLO needs (agent builders, MCP operators) is exactly the audience that follows build-in-public threads carefully. Don't position it as marketing — position it as the technical record of building something hard.
- **Category**: `ongoing-distribution`

---

**[GEO: land in "best X" comparison articles so AI tools cite you]**
- **What they did**: Florian describes a specific GEO mechanic (though he doesn't name it): "AI right now when they are looking for best affordable [X], they go on Google, find this kind of article, and if you [product] is on the top, then it will think that it is the best one, so you will be number one on AI." The play is to get named in listicle/comparison articles — not for the Google SEO traffic, but because AI tools (ChatGPT, Perplexity, Claude) crawl those pages and surface the results.
- **Why it worked**: AI assistants answer "what's the best X" by reading the same listicles humans read. If a product appears consistently across multiple comparison articles, the AI treats it as a signal of authority and includes it in its answer. The mechanism is the same as traditional SEO except the end consumer is an LLM, not a human.
- **CELLO application**: The target queries are things like "best MCP server for agent communication," "agent-to-agent authentication tools," "how to connect AI agents securely," "alternatives to [centralized agent platforms]." The play is: (1) write or contribute to comparison articles that name CELLO alongside known alternatives; (2) reach out to indie devs and AI newsletter writers who publish "top MCP tools" roundups and make sure CELLO is included; (3) make the GitHub README and npm page optimized for the exact phrases these articles pick up. This is the highest-leverage distribution channel for a technical product where the buyers themselves use AI tools to do research.
- **Category**: `seo-geo`

---

**[Big CTA in onboarding to book a call with the founder]**
- **What they did**: "We have actually a big call to action button on the onboarding of this stream. And the goal for that is to talk to the maximum customer we can." Florian does 5 customer calls in 2 days. It's not optional — it's the primary feedback loop.
- **Why it worked**: Early customers who click through onboarding are the most motivated and most opinionated. Catching them at that moment — before they churn or go quiet — maximizes the signal quality. A button in the product UI removes friction from the ask.
- **CELLO application**: After `npm install @cello-protocol/connect` succeeds, the README and setup output should include a prominent "book 15 minutes with Andre" link. Not buried at the bottom — first or second thing after the install confirmation. The target is every operator who gets through install in the first 90 days. These are exactly the people whose feedback shapes whether CELLO is useful to anyone else.
- **Category**: `prerequisite`

---

**[Daily customer calls as the primary learning loop]**
- **What they did**: "I've been doing so, in the past 2 days, I got five calls with my customers. That's what we do every single day." He cites Paul Graham explicitly: "In probably 70% of these essays, he talks about the fact that you should talk to your customers." The calls aren't a one-time research phase — they're a daily practice, especially at the 10k–100k MRR stage.
- **Why it worked**: The mechanism is direct: your customers know what they want; your job is to solve their problems. What you build in isolation is almost always wrong at some level. Each call collapses the feedback loop from weeks to hours. Florian's framing is also useful: "It's not the funniest thing to do, but it's something that you have to do mainly at the beginning." He's acknowledging the activation energy honestly and doing it anyway.
- **CELLO application**: For the waitlist, contact every signup before launch. Not an email sequence — a calendar link or a direct ask. 20 minutes. The questions that matter: What agent setup are you running today? What breaks when agents talk to each other? What would make you pay for a trust layer immediately? What would make you never pay for one? The answers directly dictate what to ship first and what to cut.
- **Category**: `prerequisite`

---

**[Mastermind community: peer group with a shared concrete goal]**
- **What they did**: Florian launched a paid mastermind ("Profitable Founder Mastermind") for SaaS founders at 5k–50k MRR who want to reach 100k MRR before end of year. The entry criterion is the goal, not the stage. "I know for a fact that if you build with other founders that are as hungry as you to reach one goal, you will reach that goal way faster than if you were doing it alone."
- **Why it worked**: A shared, concrete, time-bounded goal is the organizing principle — not just "SaaS founders." That specificity attracts the right people and creates cohesion. The accountability effect is real: you're less likely to coast when 10 other founders know your numbers.
- **CELLO application**: Build a community around a specific goal: "building production multi-agent systems." Not "AI fans" — operators who are actually deploying agent architectures and need them to be reliable and secure. CELLO becomes the natural product these operators reach for. The community is the distribution — members introduce CELLO to their networks, and the problems they surface feed directly into the roadmap.
- **Category**: `community`

---

**[Structured group calls: 2-3 founder problems per session, 20-30 min each]**
- **What they did**: Each weekly mastermind call tackles 2–3 specific problems submitted by members. Each problem gets 20–30 minutes of structured group problem-solving. The problems can be churn, distribution, product, customer acquisition — whatever is live and urgent.
- **Why it worked**: The format is tactical and high-signal. There's no filler — the agenda is driven by real problems, not a prepared curriculum. The 20–30 minute constraint forces crisp problem statements and actionable responses. Members feel heard and get concrete help, not theory.
- **CELLO application**: Run early-operator calls in exactly this format. 2 operators per call, 20 minutes each on their specific integration problem. "I'm trying to connect Claude Code to my agent on Railway, here's what's broken." Fix it live. Record and publish (with permission). This format generates content, drives product fixes, and creates loyalty — operators who felt heard become advocates.
- **Category**: `community`

---

**[Monthly Q&A with a founder who's already hit the target goal]**
- **What they did**: Each month, a founder who has already crossed 100k MRR answers live questions from mastermind members. "The goal, of course, is to get insight from someone who already made it... It's kind of a shortcut for all the members." The first guest is Nevo.
- **Why it worked**: The mechanism is social proof plus practical knowledge compression. Someone who walked the path recently has highly specific, contextual knowledge — the kind you can't get from a generic "growth" article. And the live format makes it feel exclusive and high-value.
- **CELLO application**: For the CELLO operator community, bring in a founder who's already deployed a serious multi-agent system in production — not as an influencer, but to answer real implementation questions. What surprised them. What broke. What they'd do differently. This generates credibility by association and gives early operators a glimpse of what's achievable.
- **Category**: `community`

---

**[Middleman positioning: insert yourself between large platforms and small buyers]**
- **What they did**: From the Mickey Palat podcast interview: Mickey built a SaaS that aggregates social media APIs (X, TikTok, WhatsApp, Meta) and sells access to smaller companies who don't want to navigate each API themselves. He positioned himself "between the big big big company like Meta, WhatsApp, TikTok, etc. and the small company who either don't have the money to spend on API." He doesn't own the underlying asset — he owns the integration layer.
- **Why it worked**: He identified a structural inefficiency (large platforms have complex, expensive APIs; small companies need the data but can't justify the overhead) and occupied the gap. The middleman doesn't need to outcompete the platforms — they benefit from the platforms growing. Mickey was also his own ideal customer: he built what he himself needed.
- **CELLO application**: CELLO is structurally a middleman. The large platforms (Anthropic, OpenAI, Google) don't provide agent identity federation, trust signals, or cross-platform communication. Individual agent builders need it but can't build it themselves — it requires threshold cryptography, tamper-evident hash chains, and federated directory infrastructure. CELLO owns that gap. The positioning follows: "The AI platforms gave you the intelligence. We give your agents identity and trust." This middleman framing is more compelling than "security layer" because it's about enabling something new, not just hardening something existing.
- **Category**: `launch-tactic`

---

**[Be your own ICP — build what you urgently need yourself]**
- **What they did**: Mickey Palat was his own ideal customer. "He knew the problem. He knew exactly the need. He was his own ICP... he wanted this product. So, he built that product." Florian surfaces this as the key insight from the episode.
- **Why it worked**: Being your own ICP eliminates the customer discovery phase because you have direct access to the problem. You feel every friction point. You know what would make you pay. You don't have to guess at pain level — you're living it.
- **CELLO application**: Andre is his own first user — he connects Hermes to Claude Code daily, and CELLO is the layer that makes that work. This is a founding story that should be told explicitly in the launch narrative: "I needed my agents to talk to each other securely. No tool existed. I built it. Here's what I learned." This is more credible than "we saw a market opportunity." The solo multi-agent use case (your own agents, across your own infrastructure) is the wedge because it's the one where the founder IS the customer.
- **Category**: `launch-tactic`

---

**[Podcast as selfish learning — talk to people you want to learn from]**
- **What they did**: "It's pretty selfish. I'm just talking to people that I want to talk to because these guys are really inspiring and they have a lot of knowledge and experience and I basically get that for free because this is my podcast." The content is a byproduct of conversations Florian would want to have anyway.
- **Why it worked**: The motivation is genuine, which makes the preparation and follow-through natural rather than forced. Guests feel the genuine curiosity and give more. And the format scales — each conversation yields not just published content but relationships and referrals.
- **CELLO application**: Start an interview series with people building interesting multi-agent systems: Claude Code power users, people deploying Codex in production pipelines, builders of custom MCP servers, AI engineers at companies with autonomous agent infrastructure. The goal is to learn what they're actually doing and what's actually breaking — not to produce content. The content is what you publish after. These conversations also generate warm leads: the people building complex agent systems are exactly the early operators CELLO needs.
- **Category**: `content-format`

---

**[Content filter: share your personal angle on each episode as a TLDR]**
- **What they did**: After each podcast recording, Florian films a short vlog segment — what he personally learned, what stuck with him, the one thing that changed his thinking. "I think it's always nice to have this kind of filter in between the content and you because we all watch a podcast from a different angle."
- **Why it worked**: The TLDR creates a second piece of content from one conversation. It's also more personal and shareable than the full episode — it's a point of view, not just a recording. It sets the frame for how the audience should think about the full episode.
- **CELLO application**: After each technical conversation or operator session, publish a short "what I learned" post. "Talked to [operator] about connecting Claude Code agents. The thing that surprised me: [insight]. Here's what that changes about how I'm building the contact tier system." This format is extremely low-friction to produce, high-signal to the target audience, and compounds because each one points back to the source conversation.
- **Category**: `content-format`

---

**[Google Ads + SEO as the primary acquisition channel at early stage]**
- **What they did**: Mickey Palat (interview guest) grew from zero to $1M ARR in 10 months using Google Ads and SEO. Florian presents this as the central playbook insight from that episode.
- **Why it worked**: Google Ads provides immediate, measurable signal on which messages convert — before you've committed to a positioning. SEO compounds that learning into organic traffic over time. Together they create a feedback loop: ads tell you what works, SEO scales what works.
- **CELLO application**: The challenge is that "agent-to-agent communication" and "MCP trust layer" aren't yet search terms with volume — the category is too new. The ads play for CELLO is therefore more exploratory: test 5–6 positioning angles ("AI agent security," "connect Claude Code agents," "MCP identity layer," "agent-to-agent messaging") as small ad campaigns, measure which drives installs, double down. The SEO play is longer-term: own the content for searches that will have volume in 12–18 months as agent architectures become mainstream.
- **Category**: `seo-geo`

---

**[Iterating publicly through failed experiments without losing the thread]**
- **What they did**: Florian's friend Quinton told him it looked like he'd "lost himself" — uploading daily short-form videos, doing lots of different projects, most of which didn't work. Florian's reflection: "It's the price that you have to pay when you do weird things, when you do different things, you don't follow the path of everyone else... I sold my business in July 2025 and since then I was just iterating a lot, trying a lot of different things... you have to push and push and push and you're often going into a wall until it actually breaks through."
- **Why it worked**: The public iteration builds an audience of people who respect the honesty. When things do click, the audience has already watched the journey and trusts the outcome is real. The failure narrative also makes the "I finally found it" moment more credible.
- **CELLO application**: CELLO has already gone through significant iteration — multiple pivots on what the protocol does, what the first use case is, how the business model works. Publishing that history honestly (not as navel-gazing but as "here's what we learned at each stage") creates trust with the technical audience that CELLO is targeting. Engineers are skeptical of products that claim to have gotten everything right the first time.
- **Category**: `ongoing-distribution`

---

## Foundations / Prerequisites

Before any distribution tactic can compound, these foundational conditions must be true:

**1. You must be talking to real users daily.** The Florian/Paul Graham point is load-bearing: every other tactic amplifies a product that works. A product that doesn't work just reaches more people faster. Five calls in two days is the right intensity at 10k MRR; for CELLO pre-launch, the equivalent is calling every waitlist signup.

**2. You must be your own first customer and say so.** The "built this because I needed it" founding story is more credible than market-opportunity framing for a technical infrastructure product. The solo multi-agent use case (Andre connecting his own agents) is the wedge that eliminates the cold-start problem and validates the product without needing external users.

**3. The product must exist where the buyers look.** For CELLO, the buyers are agent builders who search GitHub, npm, Perplexity, and ChatGPT for answers. That means the GitHub README, npm page, and any published comparison articles must answer "what is this, who needs it, and how do I install it" clearly and immediately. GEO (getting named in "best X" lists that AI tools cite) is the highest-leverage channel for this audience — but it requires a product that's already easy to describe and compare.

**4. The community forms around a problem, not the product.** The mastermind succeeds because it's organized around a shared goal (reach 100k MRR), not around love of a specific tool. For CELLO, the community organizing principle is "building reliable multi-agent systems in production" — not "CELLO users." Products emerge from communities; communities don't emerge from products.

**5. Content must be a byproduct of genuine learning, not a production task.** The podcast-as-selfish-learning model works because Florian would want the conversations regardless of the content. For Andre, the equivalent is documenting real discoveries from building — what broke in the FROST ceremony, what operators actually asked for on calls, what the middleman positioning unlocked. That kind of content can't be faked and can't be outsourced.
