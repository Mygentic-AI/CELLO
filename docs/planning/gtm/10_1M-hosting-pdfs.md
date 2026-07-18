---
founder: Elston
company: Tiny Host
stage: $1M ARR
date: unknown
---

Elston is a software engineer who built Tiny Host — a drag-and-drop file hosting tool for non-technical people — as a deliberate marketing exercise, not a technical challenge. He launched it in 2019 as a side project while working full-time at a bank, picked the two-"i" domain ("Tiiiny") because it was $30 versus $300 for the one-"i" version, and spent 2.5 years building it evenings and weekends before quitting at ~$8K MRR. By the time of this interview he had crossed $1M ARR with a team of under five people, zero external funding, and 2M+ registered users — driven almost entirely by SEO and YouTube tutorials that compounded for years before the vibe-coding wave (people hosting Claude-generated HTML) became his biggest growth driver. His story is worth reading because it is a precise case study in boring, compounding distribution: slow steady growth, user-driven product decisions, and a simple product held deliberately simple while a new non-technical market formed around it.

# GTM Tactics: "I Make $1M/Year Hosting PDFs on the Internet"
Source: https://youtu.be/CQkspNWlJDM
Channel: Florian Darroman (@asyncr0ne)

---

**[Intentional simplicity as a market position]**
- **What they did**: Elston built Tiny Host as the simplest way to share files online — drag, drop, get a link. He explicitly said no to deep technical features that Vercel/Netlify offer. "To be simple means you say no to a lot more than you say yes."
- **Why it worked**: There was a large non-technical audience underserved by existing tools that assumed engineering knowledge. Simplicity is its own moat because every feature you add erodes it.
- **CELLO application**: CELLO's MCP interface is already simple for the first use case (your own two agents). Lean into "the simplest way to connect two AI agents" as a positioning line. Resist the temptation to expose threshold policy, DKG details, or FROST internals in the onboarding path. The complexity is a feature under the hood, not in the UX.
- **Category**: `prerequisite`

---

**[Build for a validated, existing market — don't invent the problem]**
- **What they did**: "I took an existing validated industry and problem space, which is web hosting. It's been around 20, 30 years. And modernized it, simplified it, made it more accessible for another market."
- **Why it worked**: Removes the need to educate the market on whether the problem exists. Energy goes to distribution, not validation.
- **CELLO application**: Agent-to-agent communication is the problem. It already exists — people are doing it today with ad-hoc API calls, shared secrets, and zero verification. CELLO is the modernized, cryptographically sound version of something people are already hacking together badly. Frame it that way: "you're already connecting agents — CELLO makes it trustworthy."
- **Category**: `prerequisite`

---

**[User-driven development — observe usage, don't just ask]**
- **What they did**: Elston watched what users were actually doing on the platform. "I saw a lot of people uploading PDFs that have been converted to HTML and then using us. So I said: what if you just upload a PDF and then it worked? And I built that in a weekend. But then the SEO kicked in and about three four months later, that became one of the top use cases."
- **Why it worked**: Observation beats surveys. Users' actual behavior reveals latent demand more reliably than stated preferences. One observed behavior unlocked an entire new traffic segment via SEO.
- **CELLO application**: Watch how early operators are actually using the MCP tools. Which tools do they call first? What session patterns show up in transcripts? The first unexpected use case someone builds on CELLO (not the one Andre expected) is likely the wedge. Instrument from day one — log tool call frequency, session initiation patterns, endorsement/introduction usage. Build toward what's actually happening.
- **Category**: `product-led-growth`

---

**[Reddit launch for early feedback — honest, not spammy]**
- **What they did**: "My first users literally came from Reddit. I wasn't spamming Reddit. I was just basically saying, hey look, I created this app. I think it's useful. What do you guys think? We'd love your feedback on it."
- **Why it worked**: Reddit readers are skeptical but engaged. An honest "I built this, here's what it does, what do you think?" post — with no hype — reads as authentic. Early feedback was high-signal and led directly to the paywall feature set.
- **CELLO application**: Post in r/ClaudeAI, r/LocalLLaMA, r/MachineLearning, r/selfhosted, and MCP-adjacent communities with: "I built a P2P identity layer for AI agents — it lets your Claude Code instance talk directly to another agent without trusting a central platform. Early, rough, want to know if this solves a real problem for anyone." Be specific about the solo use case (your own agents across devices) and the cryptographic receipt mechanic. Those are concrete, not abstract.
- **Category**: `launch-tactic`

---

**[Product Hunt for first paying customers]**
- **What they did**: Six to seven months after launch, Tiny Host went on Product Hunt. "I still remember that. You never forget your first money on the internet." First customers came directly from that launch. The initial price was high, Elston dropped it until someone converted, then stopped there.
- **Why it worked**: Product Hunt concentrates early adopters and indie hackers who are actively looking for new tools to try. It's a forcing function for a polished-enough product, and the social proof of upvotes gives legitimacy.
- **CELLO application**: Time a Product Hunt launch once cello-client is polished enough for a non-developer to install and run. The demo should be: install one command, connect two agents, see a sealed receipt. The hook for PH: "P2P cryptographic identity for AI agents — like Signal for agent-to-agent communication." Run it after at least one external user has successfully onboarded independently (so the process is proven). Have a short video ready.
- **Category**: `launch-tactic`

---

**[Keyword research before SEO investment — validate the channel first]**
- **What they did**: Before going deep on SEO, Elston used Ahrefs/Semrush to check whether keyword opportunities actually existed. "The first prerequisite is understanding whether SEO is good or not for your business. It's not good for every business." He analyzed keyword difficulty (close to zero = good) and search volume.
- **Why it worked**: Prevents wasted months on a channel that won't produce. Knowing the landscape before writing a word of content means effort is targeted.
- **CELLO application**: Before writing any SEO content, run keyword analysis on: "agent-to-agent communication," "MCP identity," "AI agent trust," "connect AI agents," "FROST threshold signatures MCP," "secure agent messaging," "AI agent protocol." If search volume is near zero, SEO is not the channel yet — the market hasn't formed the habit of searching for this. That's fine; focus on community and GEO instead (below). Re-check every 3 months as the AI agent space grows.
- **Category**: `seo-geo`

---

**[Jobs-to-be-done SEO — optimize for what people actually search, not your product name]**
- **What they did**: "People don't search for web hosting, they search for like, how do I upload a HTML file, or how do I upload my CV, or how do I upload a restaurant menu." Tiny built landing pages and blog posts for each of those use cases, not for "web hosting."
- **Why it worked**: Search queries are intent-driven. People search for their problem, not your solution category. Meeting them at the problem captures traffic that "web hosting tool" never would.
- **CELLO application**: People will not search "FROST threshold identity for agents." They will search: "how to connect two Claude Code instances," "how to let my AI agent talk to another AI agent," "MCP server for agent communication," "how to verify AI agent identity," "prompt injection defense MCP," "agent endorsement system." Build one landing page per concrete use case. The sealed receipt use case ("prove what was said in an AI agent conversation") is particularly concrete and searchable in legal/compliance contexts.
- **Category**: `seo-geo`

---

**[Content pyramid: landing pages + blog posts + YouTube for the same keyword]**
- **What they did**: For a topic like "PDF hosting," Tiny built: (1) bottom-of-funnel landing pages for action queries like "upload PDF" or "share PDF as a link," (2) educational blog posts like "how do you share a PDF as a link? Why would you want to?" and (3) YouTube tutorials on the same topic. Three forms of content targeting the same keyword.
- **Why it worked**: Multiple surfaces compound. A YouTube video can rank in both Google video results and regular search results. Blog posts build domain authority. Landing pages convert. Together they reinforce each other's ranking and cover different user intent states.
- **CELLO application**: For the "connect two AI agents" keyword cluster: (1) landing page: "Connect your agents in 60 seconds — install @cello-protocol/connect and try it." (2) Blog post: "Why AI agents need their own identity layer (and why your API key isn't enough)." (3) YouTube/Loom walkthrough: showing the exact commands to install cello-mcp, start an agent, and establish a verified session from scratch.
- **Category**: `content-format`

---

**[YouTube faceless tutorials — underrated, high-trust, evergreen]**
- **What they did**: "The first video is like faceless. It was like how to upload a PDF online or how to upload a React app. Just tutorials and guides." Some videos took a year to rank, then hit 100K views. "It's one of the best trust-building channels ever. And because it's difficult to do, people there's less content out there."
- **Why it worked**: YouTube content is evergreen — it doesn't decay like Twitter. Tutorial intent is high-conversion (someone watching "how to do X" is about to try to do X). The barrier to entry (decent camera/mic, polished delivery) keeps competition thin.
- **CELLO application**: Record a faceless screen-capture walkthrough: "How to connect two AI agents with end-to-end cryptographic verification." Title it for the search, not for CELLO — "Connect Claude Code to a remote AI agent (no shared secrets, no central server)." One honest demo video with real terminal output, real sealed receipt, real multi-machine test. Post it, let it compound. The technical credibility of showing actual crypto primitives working differentiates from competitor "we use AI to secure AI" marketing copy.
- **Category**: `content-format`

---

**[Monetize requested features immediately behind a paywall]**
- **What they did**: "When people ask for features you can just monetize with that. So people wanted custom domains, so I just added that behind the paywall." He used early Reddit feedback to identify what features to paywall from the start.
- **Why it worked**: Feature requests signal willingness to pay. If someone bothers to ask for something, they value it. Asking them to pay for it is a natural conversion path.
- **CELLO application**: Track which capabilities early users ask for beyond the free tier. Candidates: higher contact tier limits (number of whitelisted agents), sealed receipt export/archiving, team/org-level endorsement graphs, priority directory replication, dedicated relay relay slot. Build the free tier to make the pain point of the limit visible — then remove the cap at paid.
- **Category**: `product-led-growth`

---

**[Find one customer, then find ten — don't quit after three]**
- **What they did**: "If you can find one, you can find 10. Find 10, you can find 100 and so on." After Product Hunt, Elston focused on understanding exactly who that first buyer was — their job, their workflows, where they hung out — and used that to direct all marketing effort.
- **Why it worked**: The first real buyer proves demand exists. They are a template for finding more like them. The failure mode is treating the first customer as a fluke and moving on.
- **CELLO application**: The first person who pays for CELLO (or deeply integrates it unprompted) is the most important data point. Do a live call. Map: what were they building? What did they use before? Where did they find CELLO? What made them trust it enough to use it in a real workflow? Their answers define the ICP (ideal customer profile) and every subsequent distribution decision.
- **Category**: `prerequisite`

---

**[Understand your ICP at depth before directing marketing spend]**
- **What they did**: "Once you get your first customer, it's really about finding out who they are and what they stand for... I wanted to understand more about who they are and where they hang out, what they read, what workflows they do, what's their background, what's their job. And building these personas."
- **Why it worked**: Marketing to everyone is marketing to no one. A precise ICP means channel selection, content angle, and messaging are all coherent.
- **CELLO application**: CELLO's likely early ICP is: solo developer or small team, already building multi-agent workflows using Claude Code or similar, has already hit the "how do I trust a message from my own other agent?" problem, cares about security and doesn't want to route everything through a central server. Secondary ICP: security-conscious enterprise teams adopting AI agents who need audit trails (sealed receipts). These two ICPs need different landing pages, different content, and possibly different pricing.
- **Category**: `prerequisite`

---

**[Slow steady compounding beats viral spikes — build deep roots]**
- **What they did**: "We've had slow steady growth. We've not had the growth in the first five or six years as you would like expect that you see on Twitter with the crazy hockey stick growth. But we've had consistent slow deep roots being built." Year-over-year doubling after leaving the job. SEO and YouTube compounded for years before the vibe-coding wave hit.
- **Why it worked**: Compounding distribution channels (SEO, YouTube) have a J-curve: nothing for months, then exponential. Founders who quit before the curve turns never see the return.
- **CELLO application**: Andre is pre-launch, solo, and low on runway — but the mechanism still applies. Any piece of content (blog post, YouTube video, open-source example, documentation page) that earns a search ranking or a GitHub star is a compounding asset. Prioritize content that will still be discoverable in 18 months over content that will spike for a day. A well-titled technical blog post explaining FROST threshold signatures in plain English is still findable two years from now.
- **Category**: `ongoing-distribution`

---

**[Bootstrap advantage: infinite runway lets you wait for market timing]**
- **What they did**: "The bootstrap advantage: if we were VC-backed, we might have shut shop. But when you're bootstrapping and you have this technically infinite runway for the better or the worse, you can just hang around until eventually things align, right? And then you blow up."
- **Why it worked**: The vibe-coding wave — an entirely unexpected trend — became Tiny's biggest growth driver. If they'd had a VC on a 24-month clock demanding pivot decisions, they would have shut down before the wave arrived.
- **CELLO application**: CELLO is pre-launch and has a hard launch constraint, but the principle is about staying alive until a triggering trend. The AI agent collaboration wave is already happening. CELLO is positioned exactly where it needs to be — cryptographic identity for agents — and the timing is right now, not hypothetically. The lesson: do not compromise the core protocol for a short-term acquisition spike that pulls CELLO away from what it's built to do. The trend is arriving.
- **Category**: `prerequisite`

---

**[Ride a trend by staying close to your original users — not by chasing the trend]**
- **What they did**: When vibe coders started uploading HTML, Elston didn't pivot. He noticed that his existing users (non-technical people) now included a new cohort (vibe coders) and started speaking to them — same core product, new positioning. "We're positioning ourselves as this DIY platform."
- **Why it worked**: The trend found them because the product was already there and SEO had already done the work. Repositioning was copy and messaging, not a rebuild.
- **CELLO application**: When agentic frameworks (LangGraph, OpenAI Agents, Anthropic Claude, Codex) start needing inter-agent trust, CELLO is already built. Don't rebuild — reposition. Write a blog post: "CELLO for LangGraph: verified inter-agent communication." Write one for OpenAI Agents. Write one for Codex. Same product, new entry points. The agentic trend is CELLO's "vibe coding moment."
- **Category**: `ongoing-distribution`

---

**[Design overhaul as a conversion lever — indie credibility kills trust]**
- **What they did**: "I hired a designer. I think now you really want to look good. I can tell when something's an indie project. When you open a landing page, you can tell when it's designed by Claude and you just don't have that level of trust in the product anymore. There was a massive design overhaul we had that kind of built more confidence in the product."
- **Why it worked**: First impressions determine whether a visitor continues reading. For a trust-infrastructure product especially, the landing page's visual credibility directly proxies the product's credibility.
- **CELLO application**: CELLO is a trust-infrastructure product. A landing page that reads as "one dev's side project" actively undermines the pitch. The irony of "trust your agent communication to this rough-looking thing" is not a joke anyone will laugh at. Before launch, the landing page needs one pass from a designer (or a careful no-design-system-artifacts Claude pass) to look like a product that takes security seriously. The open-source code quality memo in MEMORY.md applies here too — technical evaluators will read the repo directly.
- **Category**: `prerequisite`

---

**[100 small improvements beat one big feature launch]**
- **What they did**: "It's really a good strategy to just make minor improvements all over your platform. But if you make like a hundred minor improvements, it actually accumulates to a way bigger change... When you look back, you've made all of these changes in like six months or a year and your product is in a whole different place."
- **Why it worked**: Compounding micro-improvements compound into a product that feels cohesive and complete without any single "big release." Users who arrive six months after launch experience a noticeably better product without the team ever having announced a big feature drop.
- **CELLO application**: After launch, the improvement velocity matters more than any single feature. Ship small: better error messages when a node is unreachable, a cleaner moniker display, clearer sealed receipt output, a one-line install-and-go experience. Each improvement reduces friction for the next user. Track them. Release notes that list twenty small improvements in a week communicate activity and maintenance commitment — both signals that matter for a trust infrastructure product.
- **Category**: `product-led-growth`

---

**[Viral mechanic: embed attribution in the shared artifact]**
- **What they did**: "Is it viral features, right? Or like social features. Like when someone shares it there's some benefit to link back to Tiny or whatever like that." The link shared by a Tiny user contains Tiny's branding and routes viewers to Tiny's interface.
- **Why it worked**: Every share is a distribution event. The artifact being shared carries the product's brand to a new audience who may have the same problem.
- **CELLO application**: Sealed receipts are the shareable artifact. A sealed receipt from a CELLO session should include a human-readable header and a footer: "Verified by CELLO — cello.dev/verify" linking to a receipt verifier page. When someone shares a receipt as proof (in a contract dispute, an audit, a compliance check), every viewer of that receipt is a CELLO distribution event. The verifier page is a landing page: "This is what a CELLO receipt looks like. Here's how it works." Make the receipt beautiful enough to screenshot and share.
- **Category**: `viral-mechanic`

---

**[Distribution-first mindset — more people need to know CELLO exists]**
- **What they did**: "I'm very very clear on the fact that people there's so many people in the world that still haven't found Tiny, right? And that's not a product problem. That's a marketing problem. That's a distribution problem... Not like building 10 100 different features. Really I should just be focusing on how do we get more people to understand we exist."
- **Why it worked**: The failure mode for technical founders is always building more features when growth is slow. The actual problem is almost always that not enough people know the product exists.
- **CELLO application**: CELLO has protocol depth that could absorb years of feature work. The question for launch is not "what feature do we add?" — the question is "how does someone who has never heard of CELLO discover it?" Every week, answer this question with one concrete action: one blog post, one community thread, one cold DM to a relevant developer, one talk submission. The protocol is ready enough. Distribution is the constraint.
- **Category**: `ongoing-distribution`

---

**[GEO — getting AI tools to recommend your product]**
- **What they did**: "I found Tiny through Claude," a customer told him. His SEO and web presence were strong enough that Claude surfaced Tiny when asked about uploading files online. This is the GEO (Generative Engine Optimization) mechanism — appearing in AI-generated answers.
- **Why it worked**: AI tools (ChatGPT, Claude, Perplexity, Gemini) answer questions by synthesizing web sources. A product that has clear, structured, crawlable documentation and landing pages for its use cases gets recommended when the question matches.
- **CELLO application**: Andre already flagged GEO as a key channel. Concretely: (1) Make sure every CELLO landing page and doc is clearly machine-readable — no JavaScript-only content. (2) Write a factual "What is CELLO?" page that reads like a Wikipedia summary: one paragraph, crisp, covering protocol, use cases, and how it works. (3) Seed the open-source repo README with clear problem/solution framing — GitHub READMEs are indexed and summarized by AI tools. (4) When someone asks ChatGPT or Claude "how do AI agents verify each other's identity?" CELLO should appear in the answer. That requires those words to appear, structured, on pages AI tools can read.
- **Category**: `seo-geo`

---

**[Find a mentor 1-2x ahead, not a titan — through community]**
- **What they did**: "Find a mentor who's just ahead of you. You need to find a mentor and idol who's just figured out marketing, just figured out distribution, just figured out virality, rather than trying to see what would Mark Zuckerberg do." Found this in Indie London — a peer community, not a formal program. "Communities are probably one of the most undervalued things in building a company."
- **Why it worked**: A mentor who solved your current problem last year has the exact relevant experience. A titan's playbook is from a different era, different scale, different competitive landscape.
- **CELLO application**: The Indie Hackers community, AI builders communities, and the MCP ecosystem developer group are the right peer layers for CELLO. Look for developers who have recently gotten developer tools to $5K-20K MRR — specifically in protocol infrastructure or security tooling, not SaaS. Their distribution playbook is the most directly applicable. Engage, share progress, ask specific questions.
- **Category**: `community`

---

**[Founder market fit — build what you're uniquely suited to distribute]**
- **What they did**: "There's PMF, product market fit, but there's also founder market fit. What is unique about you that you can translate to a company or product? For me what I really love doing is taking complex products and simplifying it. That's my unique kind of advantage."
- **Why it worked**: Elston's natural tendency toward simplification gave Tiny its core positioning and constrained product decisions in a coherent direction. Without it, Tiny might have added features and lost its identity.
- **CELLO application**: Andre's founder market fit for CELLO is: deep cryptography expertise (FROST, Ed25519, hash chains) applied to a practical developer problem (agent trust). The distribution expression of this is technical credibility content — the kind that can only be written by someone who actually built the protocol. Blog posts explaining FROST threshold signing in plain English, showing the exact security properties CELLO provides and why simpler approaches fail — this content is Andre's natural competitive moat. No one else can write it with the same depth.
- **Category**: `content-format`

---

**[Price iteratively — drop until someone converts, then hold]**
- **What they did**: "I remember the price I originally was ambitious and the price was like $18 or whatever. And I reduced it, reduced it, reduced it till eventually someone bought it."
- **Why it worked**: The first transaction reveals price sensitivity. An unpurchased product is just a hypothesis about value. A purchased product is evidence.
- **CELLO application**: Launch with a clear free tier and a single paid tier. Don't over-engineer pricing before anyone has paid. Watch what the first paying user pays for and why. The hypothesis: free tier covers solo use (your own agents, limited contacts), paid tier covers team/org use (multiple operators, higher whitelisted contact counts, endorsed network access, receipt archiving). Test the number, not the tier structure.
- **Category**: `product-led-growth`

---

**[Avoid analysis paralysis — launch imperfect, learn from real users]**
- **What they did**: "There's analysis paralysis. They kind of like spend so much time researching it." Elston shipped Tiny with no login, no payment, no backend for features he'd teased — and learned what to build from real usage. "Once we implemented that once that happened I was like, okay, let's build that password protection."
- **Why it worked**: Real user behavior always contradicts what you expect. No amount of pre-launch analysis substitutes for a real person running into the product's edge.
- **CELLO application**: CELLO's protocol is complete enough. The risk at this stage is not shipping too early — it's delaying launch to achieve theoretical completeness. The deferred items (enrollment for absent nodes, FROST-stream identity binding) are documented and do not break the core use case. Launch with what works, instrument it, and build the next layer on real data.
- **Category**: `prerequisite`

---

**[Indie Hacker community as early distribution and feedback loop]**
- **What they did**: "I found Indie London, a good community in London. Super supportive and I found all these people around me who are making 10, 20k MRR. I was like, this is more than my salary. This is basically freedom." The community was where he found his first distribution strategies and his first peer mentors.
- **Why it worked**: Communities of builders-at-similar-stage share tactical knowledge that's too granular for blog posts and too fresh for books. They also provide accountability and social proof that builds confidence.
- **CELLO application**: Post CELLO's story on Indie Hackers as a milestone post when it hits its first $1K MRR. Before that: post a "Show IH" thread now. The security/cryptography angle is differentiated — most IH products are CRUD apps. A "I built a FROST threshold signature identity layer for AI agents" story is genuinely novel and will attract the technical subset of the community. The IH thread also seeds long-tail search results.
- **Category**: `community`

---

**[Waitlist strategy — validate demand before full launch]**
- **What they did**: Elston went from zero to launch without a formal waitlist phase — but the pattern of "post on Reddit, get feedback, add features people request behind a paywall" is the functional equivalent. He learned from each user interaction what to build next.
- **Why it worked**: Real intent signal (signing up for a waitlist, paying $12) beats survey data every time. Even a tiny waitlist provides ICPs to interview.
- **CELLO application**: Andre already has a waitlist plan. Activate it with a specific angle: "Early access to CELLO — the first P2P identity layer for AI agents. Be first to connect your agents with cryptographic verification and sealed receipts." Invite waitlisted users to install and run the demo use case (connecting their own two agents) before opening to the public. Their friction points and confusion are the roadmap for launch-day polish.
- **Category**: `launch-tactic`

---

**[Emotional stability as operational prerequisite]**
- **What they did**: "You've also got to maintain this like normalized mentality. So you're not really down when stuff is not going well, but you're also not like super happy when something goes amazingly well... once you develop this thick skin and you just move forward with stuff, that's where you start to really get in the flow of things."
- **Why it worked**: Variance in a founder's emotional state creates variance in decision quality. Normalized affect means better decisions under both adversity and success.
- **CELLO application**: Pre-launch stress is real — low runway, low users, infinite work. The practical application: don't make pricing, positioning, or architecture decisions in the 48 hours after a discouraging day. Don't make promises or pivots in the 48 hours after an exciting win. The compounding distribution work (SEO, YouTube, community) is emotionally neutral by design — it runs regardless of whether today felt good.
- **Category**: `prerequisite`

---

## Foundations / Prerequisites

The following prerequisites must be in place before any distribution tactic will work. Elston's path shows each of them clearly:

**1. A real, working product for one specific use case.**
Tiny launched with drag-drop → link. CELLO's equivalent: `npx @cello-protocol/connect` → two agents connected, sealed receipt in hand. Nothing else needs to work on day one.

**2. Deliberate simplicity — one primary user flow.**
The main flow must be under five steps with no cryptographic vocabulary in the UX. The protocol complexity lives underneath. Users see: "install, connect, verify."

**3. A landing page that doesn't look like an indie side project.**
For a trust infrastructure product, visual credibility is not optional. The landing page must look like something you would trust your agent communication to.

**4. Instrumentation from day one.**
Log which MCP tools are called, how many sessions complete, whether endorsements and introductions are used, and where first-time users drop off. Elston's user-driven development model only worked because he could observe what was actually happening on the platform.

**5. Clear free/paid boundary that makes the value of upgrading obvious.**
Not a confusing tier matrix — one clear line: free for solo use, paid for anything that requires the network (endorsed introductions, team contacts, sealed receipt archiving).

**6. Founder-written technical content ready at launch.**
At least one long-form piece that only Andre can write: the "why CELLO exists" post, explaining the threat model for AI agent communication and why every simpler solution (shared API keys, centralized servers, trust-on-first-use) fails. This is the piece that makes technical evaluators trust the protocol before they install it.

**7. A clear answer to "where does the first user come from?"**
Not a channel strategy — a single concrete path. For Tiny it was Reddit. For CELLO: identify two or three developer communities where the "I need to connect my AI agents securely" problem is already being discussed. Be present there, posting value, before the launch post.
