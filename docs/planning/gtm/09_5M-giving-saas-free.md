---
founder: Marie (co-founder, Tally)
company: Tally (tally.so) — form builder
stage: $5M ARR (~$400K MRR), 1.8M users, 16K paying, team of 10, bootstrapped
date: unknown
---

Marie is the marketing co-founder of Tally (tally.so), a form builder she built with her technical partner Filip entirely bootstrapped from Belgium. They started with the modest goal of replacing two consulting salaries — $10–20K/month — and had two pregnancies and five years of grinding before the flywheel hit: $1M to $5M ARR in a single year. At the time of recording they had 1.8M registered users, 16,000 paying at $29/month (roughly 0.9% conversion), and a team of 10. Their entire growth engine rested on one structural insight: forms are viral by nature, so they made the free tier as frictionless as possible and put a "Created by Tally" badge on every free form — letting the product market itself in the wild.

# GTM Tactics: "I Make $5M/Year Giving My SaaS Away for Free"
Source: https://youtu.be/S4xz0ztzGsA
Channel: Florian Darroman (@asyncr0ne)

Subject: Marie, co-founder of Tally (tally.so) — a form builder. 1.8M users, 16K paying, $5M ARR, bootstrapped, team of 10, 5 years to get there.

---

**Viral-by-nature product design**
- **What they did**: Chose forms as the product specifically because "forms are viral by nature — you make forms to share with someone else." The product's core use case requires sharing it with non-users. The viral loop is structural, not bolted on.
- **Why it worked**: Distribution is embedded in the product interaction. Every time a user completes their core job (publishing a form), they send it to people who have never used Tally. The growth mechanism doesn't require marketing spend — it fires on every normal product use.
- **CELLO application**: CELLO sessions produce transcripts and sealed receipts. The core use case — connecting two agents — requires a counterparty who may not yet use CELLO. Every agent-to-agent session is a forcing function: the other side needs CELLO to respond. The introduction/endorsement flow makes this structural: when you introduce Agent A to Agent B, Agent B needs CELLO to accept. Build the introduction and endorsement flows early — they ARE the viral loop, not a nice-to-have social feature.
- **Category**: `viral-mechanic`

---

**"Made with Tally" badge as primary distribution channel**
- **What they did**: Every free-tier form shows a "Created by Tally" badge. Marie said: "that little badge has been responsible for most of our growth and I truly believe that we would not have been able to grow fast without the freemium." The badge is the product advertising itself in its natural habitat — embedded in the output, not in an ad unit.
- **Why it worked**: The audience sees the badge at the exact moment they are experiencing the product's value. The CTA is implicit ("I want one of these") rather than promotional. Trust is borrowed from the form creator.
- **CELLO application**: Sealed receipts and inclusion proofs are CELLO's equivalent. Every cryptographic receipt, every exported session transcript, every shared agent conversation is an artifact that can carry a "Secured by CELLO" attestation. When an operator shares a sealed receipt with a client to prove what their agent said, that artifact is seen by someone who had no prior exposure to CELLO. Design the receipt/proof format so the CELLO attestation is visible and linkable — not an afterthought watermark, but a trust statement that creates a natural "how does this work?" pull.
- **Category**: `viral-mechanic`

---

**Extremely generous free tier — no credit card, no account to start**
- **What they did**: "You don't even need to create an account if you start using Tally. If you just go to tally.so you can immediately build a form." Account only required at publish time. No credit card gate. No free trial countdown. Unlimited forms and unlimited submissions on the free tier. Pricing is binary: free or $29.
- **Why it worked**: Removes every pre-commitment barrier. Users experience full value before identity is required. The conversion event is natural (publishing/sharing) rather than arbitrary (trial expiry). Generous free tier maximizes the number of users generating the viral badge, which is the primary acquisition channel.
- **CELLO application**: The `@cello-protocol/connect` npm package is already free and open source — good. The barrier to consider: how many steps from "I heard about CELLO" to "my agent is live and sending its first message"? That path is the free-tier equivalent. Every required configuration step, credential, or account creation before a first successful session fires is a conversion drop. The solo use case (connecting your own two agents) should work with the absolute minimum setup — a single `npm install` and a local daemon start. Make that path zero-friction, no waitlist required, no approval gate. The waitlist applies to things that need capacity management (directory registration), not to trying the tool.
- **Category**: `prerequisite`

---

**Direct DM outreach to seed the first users**
- **What they did**: "We started by just sending DMs to people on Twitter, people we found on Product Hunt, people we found on Indie Hackers. Like, people that we thought might be builders or founders or designers or might be interested in this type of product. And we would just ask for feedback."
- **Why it worked**: Direct, personal, unscalable — and therefore high-conversion. A DM from a founder asking for feedback has a very different open rate than a newsletter. Product Hunt and Indie Hackers pre-filter for early adopters who are accustomed to giving feedback on new tools.
- **CELLO application**: The target persona is AI engineers and advanced Claude Code / Codex users who run multi-agent workflows. They are concentrated in specific Twitter/X threads (Claude Code announcements, MCP server discussions), Hacker News "Ask HN" threads, and the Anthropic Discord. Find the people who are already asking "how do I connect my agents?" or "how do I give my agents persistent identity?" and DM them. The ask is not "try CELLO" — it is "I'm building this, does it solve your problem?" Personal outreach to 50-100 targeted people will generate better signal and early advocates than a launch announcement to a general audience.
- **Category**: `launch-tactic`

---

**Slack channel as community/feedback loop for early users**
- **What they did**: For the first three years, anyone who used Tally was invited to join a Slack channel. Marie and Filip personally answered every message within the hour. They manually tracked every piece of feedback in a Notion database — what user said what, what they wanted, context preserved. They would build a requested feature and then personally notify the person who asked.
- **Why it worked**: The speed of the feedback loop (DM → feature → "it's live, John") converted users from customers into promoters. Users who had been ignored by Typeform support experienced the opposite: a founder who listened, built what they asked, and told them it was done. That contrast is memorable and shareable.
- **CELLO application**: CELLO is an MCP server, so early users are already in a highly technical feedback posture — they're doing `console.log` debugging on their agent loops. The equivalent of Tally's Slack is a focused channel (Discord server, or even a simple GitHub Discussions board) where operators can post "my agent can't establish a session" and get a real answer. The unique angle: CELLO sessions are cryptographically auditable. When an operator reports a bug, ask them to share the session transcript and sealed receipt — the debugging artifact is the product itself. This doubles as a demo of CELLO's value.
- **Category**: `community`

---

**Build what users ask for, close the loop personally**
- **What they did**: "The next day it would be like, 'Hey, you know, John, it's here. it's live.' And then people would be amazed, right?" They maintained a Notion database of user feedback, attributed to specific people. When a feature shipped, they closed the loop with the person who requested it.
- **Why it worked**: Users are accustomed to submitting feature requests into a void. Personal notification that their specific request is now live creates a memorable moment. That user now has a story to tell ("I asked for this and they built it in a day"). The feature request becomes a referral asset.
- **CELLO application**: The CELLO contact/tier system is itself a tool for doing this at scale. When an operator asks for a feature in the community channel, add them to a CELLO contact list as a "beta tester" tier. When the feature ships, send them an agent message via CELLO — the delivery mechanism is the product itself. This is a direct demonstration of CELLO's value (peer-to-peer agent communication, authenticated sender, tamper-evident) in the same moment as the thank-you.
- **Category**: `product-led-growth`

---

**Building in public — milestone posts as content marketing**
- **What they did**: Published milestone posts on Indie Hackers from the start, then expanded to Twitter/LinkedIn. Posts like "0 to 1M ARR," "4M to 5M ARR — what changed." Started as documentation for themselves; evolved into an audience-building content format. Marie: "It helped us grow an audience. It definitely helped us find new users."
- **Why it worked**: Builders and founders are the target audience for Tally (they make forms for their own products). Building-in-public content reaches exactly that audience in their natural habitat. The underdog/bootstrapped narrative differentiates Tally from funded competitors. Transparency builds trust, which matters for a tool that handles submissions and data.
- **CELLO application**: CELLO's story is inherently compelling to the developer/founder audience: two founders built a cryptographic identity layer for AI agents, bootstrapped, because they needed it for their own agents. That narrative maps directly to the Indie Hackers / Hacker News / developer Twitter audience. Post the milestones: first cross-agent session established, first endorsement graph node, first operator outside the founding team, first session between agents on different cloud providers. The security angle ("tamper-evident, no central server reads your messages") is a genuine differentiator from every other MCP server — name it explicitly in these posts.
- **Category**: `ongoing-distribution`

---

**Social listening + Reddit presence as LLM training signal**
- **What they did**: "We have been very actively working on social listening and trying to pitch our relevant conversations mostly on forums, mostly on Reddit." They did this consistently for years without realizing it was feeding LLM training data. When they discovered ChatGPT was referring users, they traced it back to this long-running behavior.
- **Why it worked**: Reddit is heavily indexed by LLMs. A presence in the relevant subreddits — answering questions, being named as a solution in threads — becomes persistent training data. The LLM learns "when someone asks about X, Tally is the answer" not from a landing page, but from organic community discourse.
- **CELLO application**: The relevant surfaces: r/LocalLLaMA, r/ClaudeAI, r/MachineLearning, Hacker News (especially "who's hiring" / "show HN" / "ask HN" threads about agent infrastructure), the Anthropic Discord, the Claude Code GitHub Discussions. When someone asks "how do I give my AI agents persistent identity?" or "how do agents verify who they're talking to?" — CELLO should be the answer, coming from Andre directly or from community members who know the product. This is not advertising; it is being present in the conversation where the problem is being named. Every such answer is a training signal for future LLM recommendations.
- **Category**: `seo-geo`

---

**Attribution tracking at onboarding, then drill down**
- **What they did**: "We have this very simple onboarding flow where we just asked, 'Who are you and where did you find this?'" When they saw AI being selected, they added a follow-up: "If they click AI, would you just share a bit more? Like what's the prompt you used? Which AI system are you using?" This self-attributed data revealed the ChatGPT referral channel before it showed up in any analytics tool.
- **Why it worked**: Self-reported attribution is unreliable at scale but extremely valuable at small scale, where precise answers from 20 people tell you more than blurry analytics from 2,000. The two-step funnel (broad category → specific detail) avoids overwhelming the user while capturing the signal that matters.
- **CELLO application**: The CELLO onboarding flow (when an operator installs `@cello-protocol/connect` for the first time and starts the daemon) should include a single question: "How did you find CELLO?" with options including the expected channels (Twitter/X, Hacker News, GitHub, Reddit, ChatGPT/Claude/Perplexity, word of mouth, conference/event). When "AI tool" is selected, prompt: "Which tool and what did you ask?" This data will reveal which LLMs are recommending CELLO and which query patterns trigger it — which feeds directly back into GEO strategy.
- **Category**: `product-led-growth`

---

**Comprehensive help center as LLM training corpus**
- **What they did**: "We had this super elaborate help center that wasn't really optimized for search or anything like that. It just was made from the idea of we don't want to answer any question twice." Over years, this became a large body of content explaining how every feature works, in plain language. When LLMs started picking it up, this content ranked highly — not because it was SEO-optimized, but because it was accurate and dense.
- **Why it worked**: LLMs prefer accurate, canonical, specific content over keyword-stuffed pages. A help article that explains exactly how a feature works is more useful to an LLM answering "how do I do X in Tally?" than a marketing page. The help center is a corpus of grounded, accurate answers.
- **CELLO application**: CELLO's help content is currently spread across CLAUDE.md files, the vault docs, and the GitHub README. These are accurate but not publicly accessible or discoverable. The public-facing docs (the open source `cello-client` README, any docs site) should cover every MCP tool, every concept (session, contact tier, endorsement, sealed receipt, inclusion proof, moniker), and every common workflow — in plain language. This becomes both developer documentation and LLM training signal. A developer asking Claude "how do I establish a CELLO session between two agents?" should get an accurate answer because Claude has seen that documentation. This is a zero-cost GEO move.
- **Category**: `seo-geo`

---

**Basic SEO hygiene as LLM optimization**
- **What they did**: "A lot of it was more like basic SEO stuff that we never really thought about. Like just make sure that the headings are fine and the URLs are okay and just like the really basic stuff." Marie called not investing in SEO earlier a mistake. Once they applied basic hygiene to existing content, LLM referrals accelerated.
- **Why it worked**: LLMs ingest structured content better than unstructured content. Semantic headings, clean URLs, and consistent terminology help both traditional search crawlers and LLM training pipelines. The help center was already accurate — the basic hygiene unlocked its latent discoverability.
- **CELLO application**: Every public CELLO page — the GitHub README, any docs site, npm package page, blog posts — should have: semantic H1/H2/H3 structure, canonical terminology consistent with CELLO's own glossary (session, contact, endorsement, moniker, sealed receipt, not vague synonyms), and clean URLs. The CONTEXT.md glossary is the right source of truth for terminology. Consistency in public-facing language is a GEO signal: when ChatGPT sees "sealed receipt" in five different documents all pointing to CELLO, it learns that CELLO owns that term.
- **Category**: `seo-geo`

---

**Content gap targeting against large competitors**
- **What they did**: "We learned like oh, we can just write one simple page. Maybe we find some content gaps and then it will get picked up by LLM." Jotform has a 100-person content team. Tally's response was not to compete on volume but to find the specific gaps that a large team overlooks — and write one clean page for each.
- **Why it worked**: Large teams produce high volume but also have coverage gaps in niche use cases, specific integrations, or emerging workflows. A single authoritative page on a gap topic can rank above a sprawling competitor's site for that exact query.
- **CELLO application**: The large players in adjacent spaces (enterprise identity, API security, agent orchestration platforms) write content for enterprise buyers. They do not write content for the solo developer question: "how do I make my two Claude Code instances talk to each other securely without trusting Anthropic with my messages?" or "how do I give my AI agent a verifiable identity?" These are real questions being asked in forums and to AI tools. Write one focused page for each. The gaps are large because no incumbent owns the "agent identity" space yet. First-mover content advantage is available.
- **Category**: `seo-geo`

---

**Discover and hire from your own user community**
- **What they did**: "The first person was Richard, and he was in that Slack channel. He was already helping out people. So he was basically doing the job and we just started paying him for it." They noticed a user solving an edge case problem more elegantly than they had. When they needed a hire, they offered him the job.
- **Why it worked**: The Slack channel was a working demo of candidates' skills, motivation, and culture fit. No resume needed; behavior was observable. Richard was already invested in the product's success.
- **CELLO application**: The early CELLO community channel will surface people who are diagnosing their own session issues, writing integration guides, building adapters for new AI tools, or answering other users' questions. These people are pre-qualified. When CELLO needs its first developer relations person, documentation writer, or integration engineer, the community is the first place to look — not a job board.
- **Category**: `community`

---

**Founder-led marketing as defensibility**
- **What they did**: "The brand becomes more important as well. You see a lot of people betting on real-life connections, doing events, doing meetups, but also having the founder stepping forward more, founder-led marketing, and those are things we happen to have done since day one." Marie: "The story is what will make the product more unique than the product itself because we see new competitors popping up every day."
- **Why it worked**: AI makes it trivial to clone a product's functionality. It cannot clone the founder's story, track record, or personality. In a world where a vibe-coded alternative to any tool can be built in an afternoon, the human behind the product is the moat.
- **CELLO application**: CELLO is a security and trust infrastructure project. The founder's credibility IS the product in a trust-infrastructure context. Andre's story — solo founder, building the thing he needs for his own agents, shipping cryptographic infrastructure without VC money — is a stronger signal than any marketing copy. The open source cello-client repo is a public record of the work. The design vault documents the reasoning. Put Andre's name and context on public posts, not a generic company handle. Technical audiences will look up the author of a cryptographic protocol.
- **Category**: `ongoing-distribution`

---

**Build-in-public as transparency/trust signal**
- **What they did**: Published detailed milestone posts, documented decisions, shared ARR numbers. Marie: "It creates this more like transparency and trust, right? Because we do share a lot and you kind of take users on your journey." Also used as a differentiator: "We're bootstrapped. There's just not that many similar form builders out there. So it just kind of reinforces the story."
- **Why it worked**: For a product that handles user data (form submissions), transparency about how the company operates builds trust that pure marketing cannot. Users who have been "taken on the journey" have a higher emotional investment in the product's success, reducing churn.
- **CELLO application**: CELLO handles cryptographic keys, session state, and agent communication — a domain where "trust us" is exactly the wrong answer. Build-in-public is not just a distribution tactic here; it is a trust signal that is load-bearing for the product category. Publish the threshold ceremony design, the hash chain spec, the key rotation policy. When a security choice is made (why T=majority(N) instead of T=N), publish the reasoning. The audience that will adopt a cryptographic identity layer is the same audience that will read the design rationale — and will trust the product more for having published it.
- **Category**: `ongoing-distribution`

---

**Low pricing as a churn and commoditization defense**
- **What they did**: "$29 or free. There's not that much in between." When asked about defensibility against vibe-coded clones: "I think the pricing. If your pricing is low enough, you will less easily be canceled because someone can really easily duplicate you with Claude still."
- **Why it worked**: At low price points, the switching cost (time + migration effort) exceeds the potential savings from a DIY alternative. A user who would spend four hours rebuilding Tally's functionality to save $29/month is making a bad trade. High prices invert this calculation and invite homegrown competition.
- **CELLO application**: CELLO's pricing should be structured so that the base tier is priced below the "I'll just build this myself" threshold. The value of CELLO is not the software — it is the federated directory infrastructure, the threshold ceremony, the sealed receipts. Those are genuinely hard to replicate. The software layer (MCP tools, session management) is the commodity; price it accordingly. Charge for infrastructure scale, not for the client binary.
- **Category**: `product-led-growth`

---

**MCP as distribution into the AI tool ecosystem**
- **What they did**: Tally is building an MCP server so that "you can just use Claude and say, 'Hey, build me a form. Show me my last submissions.'" Marie: "People don't really visit your website anymore. They might not even see the interface anymore because they'll build somewhere else." She explicitly named this as a key strategic investment for survivability in the AI-tool era.
- **Why it worked / will work**: AI assistants are becoming the primary interface for software interactions. A product that can be discovered and used entirely within an AI assistant's context window is present where the user already is, without requiring a context switch to a website.
- **CELLO application**: CELLO IS an MCP server — this is the entire distribution model. The point here is to accelerate the discoverability of CELLO's MCP tools within the AI assistant ecosystem. When a Claude Code user asks "how do I connect my agents?" the answer should include a tool-call walkthrough that they can execute immediately. Publish worked examples of common CELLO workflows as tool-call sequences that can be embedded in system prompts or run interactively. Make the MCP server appear in MCP server directories and registries (Model Context Protocol's official list, community lists). "MCP server for agent identity and trust" is a category that does not yet have an obvious winner.
- **Category**: `product-led-growth`

---

**In-person events and meetups as a relationship moat**
- **What they did**: "You see a lot of people betting on real-life connections, doing events, doing meetups" as a moat against AI commoditization. Tally is actively doing meetups in cities (mentioned London). Real-life connection is something an LLM-generated competitor cannot substitute.
- **Why it worked**: At the point where product differentiation is hard, personal relationships between users and founders create switching costs that have nothing to do with features or pricing. A user who met Marie at a London meetup is not going to churn to a vibe-coded form builder.
- **CELLO application**: The AI agent / developer community has natural gathering points: AI Engineer Summit, local AI meetups (SF, NY, London), Claude-specific events. Andre showing up at these — not with a booth but as a practitioner who built something — creates relationships that are impossible to replicate at scale. The CELLO story ("I needed this for my own agents, so I built it") plays well in a room of people who are all building their own agents and experiencing the same pain.
- **Category**: `community`

---

**Product-led growth flywheel — the self-reinforcing loop**
- **What they did**: "The more people use Tally, the more we can offer for free, the more people will discover Tally, will also create forms, and that's just how we grow. It's this flywheel that can only get bigger. It's really hard to stop something like that." They described "religiously" believing in this loop and never deviating from it even when revenue was low.
- **Why it worked**: A flywheel is self-compounding. The inputs (free users) generate the outputs (viral badge exposure) that generate more inputs. Conviction in the loop is required because the returns are not immediate — they compound slowly and then suddenly. Tally went from 1M to 5M ARR in 12 months after five years of steady growth, which is the characteristic shape of a compounding flywheel.
- **CELLO application**: The CELLO flywheel is: operator installs CELLO → connects their own agents → introduces CELLO to a collaborator → collaborator installs CELLO to respond → that operator connects THEIR agents → introduces to their network. Every new operator who joins through a referral/introduction generates at least one more pull toward CELLO from their own network. The introduction and endorsement features are not social niceties — they are the flywheel mechanism. They need to ship before launch and they need to be extremely low-friction. One operator saying "I want to introduce you to my colleague's agent" should generate a one-click install path for the colleague, not a documentation rabbit hole.
- **Category**: `viral-mechanic`

---

**2% conversion rate as the underlying economic model**
- **What they did**: "We have like 1.8 million users and there's 16,000 paying users." That is approximately 0.9% (she rounds to "2% convert to Tally Pro"). The economic model works because: (1) marginal cost of a free user is near zero, (2) the free users generate the viral distribution that acquires more free users, (3) a small fraction of that massive base converts, and (4) the product is profitable from early on because infrastructure costs are low.
- **Why it worked**: Freemium is only viable when the marginal cost of a free user is low and the free tier actively drives acquisition of more users. Tally optimized for both: Google Cloud bill was under €1,000/month early on; free forms with the badge acquire more users.
- **CELLO application**: The analogous model: free operators (running their own agents, solo use case) cost almost nothing in directory infrastructure. They generate the viral loop (introducing their collaborators, posting about CELLO publicly). A fraction convert to paid tiers when they need features that require infrastructure resources (more directory capacity, higher-tier signals, advanced analytics). The critical discipline from Tally: never raise prices to accelerate near-term revenue at the cost of the flywheel. The free tier IS the growth engine. Charge for what genuinely costs money (infrastructure, threshold ceremonies at scale) and keep everything that is viral free.
- **Category**: `product-led-growth`

---

**Stubborn consistency — show up every day, compound**
- **What they did**: "The boring thing about the Tally story is that it's a lot of the same. Not that many people stick around for 5 or 10 years to see the growth happening. What we learned is that the most important thing was to be a bit stubborn and to show up every day." Five years of consistent execution before the exponential phase.
- **Why it worked**: Most competitors quit during the slow compounding phase. They see flat-looking growth and pivot or abandon. Tally's flywheel was building the whole time — it just wasn't visible in the MRR chart until the LLM referral inflection hit in early 2025.
- **CELLO application**: CELLO is infrastructure — the compounding timeline is likely longer than a consumer app. The directory federation, endorsement graph, and reputation layer all compound as the network grows. The relevant milestone is not first paying customer; it is first operator who discovered CELLO through another operator's introduction. That is the signal the flywheel has started. Until then, consistency in the distribution behaviors above (social listening, help content, building in public, attending events) is the job.
- **Category**: `prerequisite`

---

## Foundations / Prerequisites

These are not tactics to try — they are table stakes that must be true before any tactic works. Tally's entire playbook rests on this foundation.

**1. The product must be viral by nature.**
The distribution flywheel only works if normal product use creates exposure for non-users. For CELLO, this means the solo use case (your own agents) must ship first, followed immediately by the introduction/endorsement flow. A product that is only used internally, between your own agents, is not viral. The cross-operator connection is the viral surface.

**2. The free tier must be genuinely free — not a hobbled trial.**
Tally offers unlimited forms and unlimited submissions on free. The badge is the price, not an artificial submission cap. CELLO's free tier should let an operator run their own agents, establish sessions, and build their contact graph without hitting a paywall. The paid tier adds infrastructure scale and features that have genuine resource costs — it does not gate the core value.

**3. Onboarding friction must be minimal to the point of embarrassing.**
Tally required no account to start building. The first value (a form exists) is experienced before any commitment is asked. For CELLO: the path from `npm install @cello-protocol/connect` to "first successful cross-agent message" must be a single-digit number of steps, documented in one README, with no external dependencies that require configuration before the first session fires.

**4. Help documentation must exist and be accurate before you try to grow.**
Tally's help center was built to avoid answering questions twice — a small-team efficiency tool. It became a GEO asset accidentally. The lesson is not to "build for LLMs" — it is that accurate, comprehensive documentation has compounding value. It reduces support load, enables self-service, and becomes training signal. Write it for yourself first; the distribution benefit follows.

**5. Conviction in the model — no deviation when growth is slow.**
Tally never raised prices under pressure, never abandoned freemium when it was unclear if it would work, and never chased acquisition channels that didn't fit the model (ads didn't work; they stopped). The flywheel requires sustained belief during the slow compounding phase. The founder must be able to articulate clearly: "the model is working because X" even when the MRR chart looks flat.

**6. Infrastructure costs must scale sub-linearly with free users.**
The 1.8M:16K ratio only works because Tally's Google Cloud bill was under €1,000/month early on. Free users must cost almost nothing to serve. For CELLO: directory node costs must be covered by the infrastructure tier of paying operators. Free operators running their own local agents should impose near-zero load on the federated directory. Design pricing and infrastructure architecture together, not sequentially.
