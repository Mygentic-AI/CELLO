# CELLO GTM Master Playbook
Synthesized from 15 videos — Florian Darroman (@asyncr0ne) channel

---

## Part 1: Foundations — Resolve These Before Distributing

These are non-negotiable preconditions. Every distribution dollar and hour you spend before resolving them is wasted or counterproductive. Collapsed and de-duplicated from all 15 files.

---

### 1. ICP Locked to One Sentence

**What it is**: A single sentence naming one specific person, one specific problem, and one specific outcome. Not "AI developers."

**Why it matters**: Without ICP precision, every feature decision, content angle, and distribution choice is contested. When you know exactly who you're for, the product, the pitch, and the channel selection all follow. Products that serve a Venn diagram intersection that doesn't exist as a real person get no word-of-mouth.

**How to resolve for CELLO**: The working ICP is: "A developer who already runs two or more AI agents (Claude Code on their laptop, Hermes or similar on a cloud server), has felt the friction of 'how do these things know they're talking to each other and not an impersonator,' and wants to fix it without routing everything through a central platform they don't trust."

This is not "AI developers broadly." It is the developer who has already *hit the problem* — not the one who hasn't started yet. The secondary ICP (teams, security-conscious enterprise users) comes in Phase 3.

---

### 2. One-Sentence Pitch That Implies the Pain Without Protocol Vocabulary

**What it is**: A sentence that tells a developer immediately whether they are the customer, what problem it solves, and what makes CELLO different.

**Why it matters**: If your pitch requires the reader to know what FROST signatures or threshold cryptography are, you have already lost 99% of your ICP. The pitch must work at the problem layer, not the mechanism layer.

**How to resolve for CELLO**: Test these with 10 developers who haven't heard of CELLO. The winner is the one that gets "wait, how?" rather than a blank stare:
- "CELLO lets your AI agents find each other and verify identity — without trusting any central platform."
- "You're already connecting agents with ad-hoc hacks. CELLO makes it cryptographically trustworthy."
- "Your AI co-founder deserves a verifiable identity — CELLO gives your agents a permanent address and a sealed record of everything they agreed to."

The test: does the developer recognize their own situation in the first 5 words?

---

### 3. Working Demo Under 2 Minutes — No Protocol Vocabulary in the UX

**What it is**: A live demo that works every time, shows the core value (two agents connecting, verifying identity, exchanging a message, sealing the receipt), and requires zero knowledge of FROST or Ed25519 to understand.

**Why it matters**: The wow effect must land before the paywall and before any sales conversation. If the developer's first impression is "this seems interesting in theory," they bounce. If it's "this just worked in 90 seconds," they want more.

**How to resolve for CELLO**: The demo is: (1) `claude mcp add cello -- npx --yes @cello-protocol/connect` — one line, (2) `cello_start_agent` — agent is live, (3) one `cello_initiate_session` call to a demo agent Andre runs — session forms, (4) an exchange, (5) `cello_sealed_receipt` — the receipt appears on screen. Under 90 seconds. Record this as a screen capture before any public post goes out. The sealed receipt appearing is the CELLO equivalent of Sleek's "piece by piece" UI generation moment — it proves the thing is real.

---

### 4. First Paid User as the Real Validation Gate

**What it is**: At least one developer who pays for CELLO and uses it in a real workflow — not a free signup, not a waitlist entry.

**Why it matters**: A free user proves interest. A paid user proves the product solves a dollar-valued problem. Every content campaign, SEO investment, and distribution effort you build before this proof is compounding on an unverified assumption.

**How to resolve for CELLO**: The validation scenario is: one developer installs `@cello-protocol/connect`, connects two of their own agents, completes a real task between them, gets a sealed receipt, and pays for the portal tier. Andre can manually onboard this first user. The solo multi-agent use case (Claude Code ↔ Hermes) is the wedge — run it with the first 3-5 waitlist members before opening to the public.

---

### 5. Free Tier Designed for Conversion — Wow Before the Gate

**What it is**: A free experience that delivers the core value fully before hitting a paywall, so the developer understands *why* they'd pay before being asked to.

**Why it matters**: If the paywall comes before the wow effect, nobody converts. The gate should come after the first sealed session — when the developer has already experienced CELLO doing something that nothing else does.

**How to resolve for CELLO**: Free tier covers: install, start an agent, connect to any number of agents including your own, establish sessions, build your contact list. The gate sits on features that have genuine infrastructure cost: signed inclusion proofs at scale, advanced trust signal analytics, team/org-level features, more than N whitelisted contacts. The specific threshold is an empirical question — ship the free tier, watch where developers stop and ask "can I have more?" That is where the gate goes.

---

### 6. Install-to-First-Session Under 10 Minutes, No Failures

**What it is**: The path from `npm install @cello-protocol/connect` to first successful cross-agent message must complete in under 10 minutes on a fresh machine, with no silent failures.

**Why it matters**: Every step that breaks silently is a churn event before any retention mechanism has kicked in. The developer who hits `ipc_connection_lost` on their first session and gets no actionable error message does not file a bug — they uninstall and move on.

**How to resolve for CELLO**: Watch 5 external developers install CELLO on their machines without Andre present. Record what breaks. Fix everything that produces confusion, a silent failure, or a "what do I do next?" moment. Every MCP tool error message should answer: what happened, why, and what to do. This is the highest-leverage pre-launch work — more valuable than any new feature.

---

### 7. Landing Page With Visual Credibility of a Trust Infrastructure Product

**What it is**: A landing page that looks like something you would trust with your agent's cryptographic identity — not a side-project template or a "designed by Claude" skeleton.

**Why it matters**: CELLO is a trust infrastructure product. A landing page that reads as "indie side project" directly undermines the pitch. Technical evaluators form a first impression in 3 seconds that either earns or kills the evaluation. The irony of "trust your agent communication to this rough-looking thing" is not survivable.

**How to resolve for CELLO**: One design pass from a designer, or a careful structured redesign pass, before the first launch post. The page must lead with the problem (agents communicating without trust is a liability), show the solution concisely (cryptographic identity, P2P, sealed receipts), and make the install one-liner visible above the fold. Use the AI Eyes Chrome extension to verify it renders correctly to LLM crawlers.

---

### 8. Attribution Tracking From Day Zero

**What it is**: UTM tracking on every public link, plus a self-reported "how did you find CELLO?" question in the onboarding flow.

**Why it matters**: Without attribution, you cannot identify which channel is driving quality installs (developers who actually connect agents) versus noise (people who click and leave). You will misallocate every subsequent hour without this data.

**How to resolve for CELLO**: Set up Google Analytics + Google Tag Manager before the first post. Track: waitlist signup, install completion, first session establishment as conversion events. Track source/medium to see `chat.openai.com`, `claude.ai`, `perplexity.ai` as referrers. In the first-run daemon experience or portal onboarding, add: "How did you find CELLO?" with options including YouTube, X, HN, Reddit, GitHub, AI tool (ChatGPT/Claude/Perplexity), word of mouth. When AI tool is selected, ask: "Which tool and what did you search?" This self-reported data is more valuable than analytics at early scale.

---

### 9. Crawlability and CMS Infrastructure

**What it is**: A blog at `blog.cello.so` or `docs.cello.so/blog` using Ghost or Payload CMS, pre-rendered (not client-side SPA), connected to Google Search Console.

**Why it matters**: Any LLM crawler that hits a blank JavaScript page cannot cite CELLO regardless of content quality. The blog is not primarily for humans — it is the content infrastructure that LLMs and search engines read. Without it, every GEO tactic is blocked.

**How to resolve for CELLO**: (1) Set up Ghost at `blog.cello.so` — starts free, $15/month once it grows. (2) Connect to Google Search Console immediately. Submit every post for indexing after publish. (3) Install AI Eyes Chrome extension and verify the CELLO site renders visible content to a crawler. (4) Set up Andre as the named author with bio and photo — this is Google/LLM E-E-A-T (expertise, experience, authority, trustworthiness).

---

### 10. BOFU Keyword List as the Editorial Calendar

**What it is**: A list of 15-25 specific search queries that a developer would use when they're already primed to buy a solution like CELLO — comparison, "how to," and listicle queries, not informational "what is" queries.

**Why it matters**: 63% of ChatGPT citation sources overlap with Google's first-page results. BOFU content ranks in both simultaneously. Informational queries are answered inline by LLMs — they don't drive clicks. BOFU queries still drive conversions.

**How to resolve for CELLO**: Paste the CELLO landing page into Claude and say: "Give me 20 bottom-of-funnel keywords that a developer would search when ready to buy something like this. Include listicle, comparison, and how-to formats." Seed queries to check: "best MCP servers for agent communication," "how to connect two Claude Code agents," "agent-to-agent authentication tools," "AI agent identity verification," "best tools for multi-agent trust," "CELLO vs building your own agent auth." That list is the 12-month editorial calendar.

---

### 11. The Viral Loop Is Built Into the Product, Not Bolted On

**What it is**: The core CELLO use case — connecting agents — structurally requires the counterparty to also use CELLO. The introduction and endorsement flows make this explicit: when you introduce your agent to a collaborator's agent, the counterparty must install CELLO to respond.

**Why it matters**: Distribution embedded in the product (like Tally's "Created by Tally" badge or CELLO's sealed receipt with "Verified by CELLO — cello.dev/verify") fires on every normal product use without requiring marketing spend. The viral loop is the primary long-term growth engine.

**How to resolve for CELLO**: (1) The sealed receipt format must visibly carry the CELLO brand with a verification link. (2) The introduction/endorsement flow must have a one-click install path for the counterparty. (3) The connection request that arrives at a non-CELLO agent should include a human-readable "This agent is trying to connect via CELLO — install here" message. These flows must ship before launch — they are not nice-to-have social features, they are the flywheel mechanism.

---

### 12. Model-Agnostic Positioning, Locked Before First Post

**What it is**: CELLO explicitly positioned as working with Claude Code, OpenClaw, Hermes, Codex, and any future agent framework — not "the Claude Code plugin."

**Why it matters**: Model and framework loyalty is shallow. Florian migrated his entire agent stack away from OpenClaw when Anthropic changed their plan. Any positioning that implies CELLO is Claude-only will cap the addressable audience and create migration risk. The identity layer should outlive any one framework.

**How to resolve for CELLO**: Every public-facing sentence that describes CELLO should name at least two frameworks: "works with Claude Code, OpenClaw, Hermes, Codex." The positioning line is: "CELLO is the identity and trust layer for AI agents — wherever your best model runs today." Write this into the README, the landing page, and the launch post before anything is published.

---

### 13. Open Source Credibility Foundation Is Maintained

**What it is**: The `cello-client` repo (`@cello-protocol/connect`) is open source and evaluated by technical buyers before they install anything.

**Why it matters**: Technical developers evaluating cryptographic infrastructure read the source code before running it. A repo with dead code, unclear tests, or thin documentation reads as "AI slop" for a trust-infrastructure project — a direct contradiction of the product's claim. This is marketing, not just engineering hygiene.

**How to resolve for CELLO**: Keep `cello-client` code quality high: no dead-code-backed tests, clear error messages, accurate README, sharp CONTEXT.md. When a new version ships, the release notes should be a trust signal in themselves — showing that the project is actively maintained by someone who understands the protocol deeply. Per existing memory: "open-source code quality IS a trust signal — technical evaluators read the repo directly."

---

### 14. The Founder Narrative, Written Down Before Launch

**What it is**: The CELLO story as a human narrative: solo founder, two years building cryptographic infrastructure, uses the product daily to connect his own agents, built it because it didn't exist.

**Why it matters**: Products can be cloned. The founder's story cannot. For a trust infrastructure product, the human behind it is a load-bearing credibility signal. Journalists, podcast hosts, and HN commenters respond to authentic narrative, not press releases.

**How to resolve for CELLO**: Write 3 paragraphs before launch: (1) the problem Andre personally hit, (2) why every simpler solution (shared API key, OAuth, HTTPS, trust-on-first-use) fails against the actual threat model, (3) what CELLO gives you and why it required two years of cryptographic work. This is the HN post, the Starter Story submission, the podcast pitch, and the "about" page — all from one artifact.

---

### 15. Pricing Below the $200/Month Psychological Ceiling

**What it is**: The reference price point for "reasonable AI infrastructure spend" in the solo developer / small team segment is $200/month. CELLO must be a supplement, not a competing line item.

**Why it matters**: Florian's OpenClaw → Claude migration was triggered by a 10x cost jump to $2,000/month. The developers who are CELLO's ICP have already committed to LLM API costs. CELLO must feel like a $20-50/month add-on to an existing stack, not a new infrastructure budget line.

**How to resolve for CELLO**: Price the entry paid tier at $29-49/month for solo developers. Infrastructure scale tier (teams, high-volume ceremonies, advanced analytics) can be higher. Launch with one clear binary: free (solo, limited whitelisted contacts) vs. paid (team, full network, receipt archiving).

---

## Part 2: Tactics by Phase

---

### Phase 1 — Pre-Launch (Do Before First Public Post)

---

**1. Confirm the Keyword Gap on YouTube and Google**
- **What to do**: Run YouTube autocomplete and VidIQ on 10-15 candidate queries: "how to connect two Claude Code agents," "AI agent identity layer," "MCP server agent communication," "agent-to-agent authentication," "connect Claude Code to remote agent," "AI agent trust protocol." If near-zero videos exist for these exact queries, CELLO has a first-mover YouTube opportunity. Document the gap before committing to video cadence.
- **Why**: Content budget and time is finite. Confirm the channel can work for CELLO's queries before investing in it. A keyword with zero search volume requires community-building, not SEO. One with growing volume (post-launch AI agent wave) justifies immediate investment.
- **Source**: 04, 10
- **Effort**: Low

**2. Set Up CMS, Analytics, Search Console, and Author Profile**
- **What to do**: (a) Ghost blog at `blog.cello.so`. (b) Google Analytics + Tag Manager with conversion events (waitlist signup, free install, first session). (c) Google Search Console connected to blog and main site. (d) Author profile: Andre's name, bio ("founder of CELLO — cryptographic identity for AI agents"), photo. (e) Install AI Eyes Chrome extension, verify site renders to crawlers. (f) Create G2 and Capterra profiles in "AI security tools" / "developer tools" categories.
- **Why**: These are infrastructure. Without them, GEO tactics produce zero measurable signal, BOFU content doesn't compound, and you can't track which channel is driving quality installs. G2/Capterra are explicit LLM citation sources.
- **Source**: 06, 11
- **Effort**: Medium (one-time setup, ~1 day)

**3. Generate BOFU Keyword List and Build Editorial Calendar**
- **What to do**: Paste the CELLO landing page into Claude with the prompt: "Give me 20 bottom-of-funnel keywords — listicles, comparisons, how-to queries — that a developer would search when ready to buy a solution like this. Include audience-qualified variants." Also ask: "Convert these into AI visibility prompts and create a content brief for each." This list IS the 12-month blog editorial calendar.
- **Why**: Writing content before knowing what developers search for produces content that compiles but doesn't compound. BOFU content specifically targets the queries LLMs answer when someone asks "what should I use for agent identity?"
- **Source**: 06, 11
- **Effort**: Low (2-3 hours)

**4. Publish the Foundational "Why CELLO Exists" Technical Post**
- **What to do**: Write one long-form post (1,500-3,000 words) that only Andre can write: what breaks when AI agents communicate without identity verification, why shared API keys fail (one compromise = everything compromised), why OAuth is wrong for agent identity (it's for delegating human auth, not agent identity), why FROST threshold signing matters (no single node can forge), what a sealed receipt gives you (tamper-evident, portable proof of what was said). Publish on the CELLO blog. This is the credibility artifact that makes technical evaluators trust the protocol before installing it.
- **Why**: Technical buyers read primary sources before trying a security product. This post is the primary source. It also becomes the top internal link target for all future articles and the citation source for LLMs answering "why does agent identity matter?"
- **Source**: 10, 14
- **Effort**: High (founder's time, not delegatable)

**5. Get Listed in Every MCP Directory**
- **What to do**: Submit `@cello-protocol/connect` to: Smithery, mcp.so, Glama, awesome-mcp-servers GitHub list, Claude's MCP directory (if/when available), any "awesome-claude" or "awesome-anthropic" lists. Title: "CELLO — Identity and Trust Layer for AI Agents." Description must include target keywords: agent identity, agent-to-agent communication, MCP security, FROST threshold signing, sealed receipts.
- **Why**: The MCP server registry is where CELLO's ICP (Claude Code users, OpenClaw users) browses for new tools. Being listed here is the direct equivalent of being in the Shopify App Store — access to an installed audience actively looking for tooling. Every listing is also a GEO signal for LLMs that index registry content.
- **Source**: 04, 08, 13
- **Effort**: Low (2-3 hours per directory)

**6. Write and Publish the OpenClaw Skill File**
- **What to do**: Create a single Markdown skill file covering CELLO's core MCP tools with worked examples: `cello_initiate_session`, `cello_send`, `cello_receive`, `cello_contacts`, `cello_status`, `cello_sealed_receipt`. Include 3-4 worked example scenarios: "connect to your remote Hermes agent," "send a message to a teammate's Claude Code instance," "check which agents you've whitelisted." Submit to the OpenClaw skill directory.
- **Why**: OpenClaw users browse the skill directory to extend their agents. A skill file is the minimum atomic unit of distribution in the agentic ecosystem — zero friction, and it surfaces CELLO inside the user's agent at the moment they need it. OpenClaw-to-Claude migration is happening now; OpenClaw Lab community members are rebuilding their stacks and are maximally receptive.
- **Source**: 12, 13
- **Effort**: Low (2-3 hours)

**7. Build a Beta Cohort of 5-10 Developers and Watch Them Install**
- **What to do**: Find 5-10 developers in Andre's network or via DM who run multi-agent setups (Claude Code users, Hermes operators, people posting about MCP). Give them CELLO access and a Calendly link. Watch their first install session on a screen-share Zoom call without guidance — don't help, just observe. Every moment of hesitation, every re-read of a label, every silent failure is a launch blocker to fix before the public post.
- **Why**: Users don't report what confuses them — they work around it or leave. Watching a session reveals the half-second hesitations, the "what does this mean?" re-reads, and the points where an operator almost quits. Fixing these before the public launch is worth 10x any post-launch support effort.
- **Source**: 14, 15
- **Effort**: Medium (scheduling + watching + fixing ~1-2 weeks)

**8. Build Reddit Karma and Presence in Target Subreddits**
- **What to do**: 2-3 weeks before any launch post, become a genuine contributor in: r/ClaudeAI, r/LocalLLaMA, r/MachineLearning, r/SideProject, r/selfhosted, r/devops. Answer questions about multi-agent AI, MCP configuration, agent security, Claude Code setup. DO NOT mention CELLO yet. Accounts that appear only at launch get flagged. Build credibility first.
- **Why**: Reddit answers that help people rank in both Google and LLMs for months. An account with no karma posting "check out my product" is ignored. An account with a history of helpful answers gets upvoted and cited. The karma is the credibility that makes the launch post land.
- **Source**: 02, 03, 11
- **Effort**: Low-Medium (30 min/day for 2-3 weeks)

**9. Produce the Core Demo Screen Recording**
- **What to do**: Record one screen capture under 60 seconds: left terminal — Claude Code agent issuing `cello_send`, right terminal — second agent's `cello_receive` arriving, then `cello_sealed_receipt` appearing. No narration needed for the technical audience. Caption: "Two AI agents. No central server. Cryptographically sealed." Use Tella (tella.tv) for clean recording. This is the media asset used in the launch post, the README embed, and every future piece of content.
- **Why**: Screen recordings show, not tell. A developer watching the product work has a completely different response from reading a description. Chatbase's first viral post was a screen recording with 16 followers. The demo removes the "does it actually do what they claim" doubt in 15 seconds.
- **Source**: 02, 13, 14
- **Effort**: Low (1-2 hours)

**10. Write the Sealed Receipt to Be Shareable and Branded**
- **What to do**: Ensure every sealed receipt output includes a human-readable header and a footer: "Verified by CELLO — cello.dev/verify" linking to a public receipt verifier page. The verifier page should be a landing page: "This is what a CELLO sealed receipt looks like — here's how the cryptographic verification works." Make the receipt visually clean enough to screenshot and share.
- **Why**: The sealed receipt is the shareable artifact. When an operator shares it (in a contract dispute, a compliance audit, a demo to a client), every viewer of that receipt is a CELLO distribution event. The verifier link is a viral loop — every shared receipt generates organic discovery. Tally's "Created by Tally" badge drove most of their 1.8M users. The sealed receipt is CELLO's equivalent.
- **Source**: 09, 10
- **Effort**: Medium

---

### Phase 2 — Launch Week

---

**1. Comment-to-Unlock Post on X**
- **What to do**: Post on X: "We built private P2P identity for AI agents. Two Claude Code instances, two Hermes agents, any combo — they find each other, verify identity, and message without going through a platform. Comment your agent stack and I'll show you how to connect it." The product is already live. This post requires a reply, not a click — generating comment volume that the X algorithm amplifies. Reply to every comment with a personalized config snippet. 
- **Why**: X's algorithm weights replies over likes. 300 replies rank far higher than 300 likes. Social proof is visible in the thread — everyone can see the demand. The "comment your stack" CTA is also product research and ICP mapping.
- **Source**: 02, 11
- **Effort**: Medium (posting + manual replies for 24-48 hours)

**2. Structured Demo Screen Recording as the Lead Asset**
- **What to do**: The launch post leads with the demo video (see Phase 1, item 9). Hook in the first line: "Two AI agents just shook hands cryptographically — here's what that looks like." The post is not a product announcement — it is a demo with a reaction. End with: "Link in bio to install in one command."
- **Why**: Yaser's first viral post with 16 followers was a structured screen recording. The structure — what you show, in what order, with what hook — determines virality, not follower count. The demo does the selling. The post just delivers the audience.
- **Source**: 14, 02
- **Effort**: Low (the recording is done in Phase 1)

**3. HN Show HN Post**
- **What to do**: Post "Show HN: CELLO — open-source P2P identity and trust layer for AI agents." Body: lead with the technical problem (AI agents communicating without identity verification are vulnerable to impersonation and prompt injection), explain the approach (FROST threshold signing, tamper-evident hash chains, sealed receipts), show one code example, link to the cello-client repo. Do NOT pitch the business. Let the technical substance speak. Include the authentic-founder angle: "built this because I needed it for my own agents — here's the problem it solves in practice."
- **Why**: HN is the single highest-quality technical audience for CELLO. Cryptographers, protocol engineers, security researchers, and agent developers all read HN. A genuine "Show HN" that explains the problem well earns upvotes and stays on the front page for hours. The thread becomes a GEO asset cited by LLMs for months.
- **Source**: 02, 05
- **Effort**: Medium (writing the HN post, then responding to comments all day)

**4. Reddit Honest Launch Post**
- **What to do**: Post in r/ClaudeAI and r/selfhosted (separately, not cross-posted spam): "I built a P2P identity layer for AI agents — open source, install as an MCP server. It lets your Claude Code instance talk directly to another agent without trusting a central platform. Early, want feedback." Be specific: show the solo use case (Claude Code ↔ your own Hermes agent), show the sealed receipt, ask "does this solve a real problem for anyone?" Include GitHub link.
- **Why**: Reddit rewards honest "here's what I built" posts over polished product launches. r/selfhosted and r/ClaudeAI explicitly welcome tool announcements from builders. The open-source angle makes self-promotion valid on r/selfhosted. Early Reddit posts rank in both Google and LLMs for months.
- **Source**: 10, 13
- **Effort**: Low (one post per subreddit, respond to every comment)

**5. Product Hunt Launch in "Developer Tools" and "Security" Categories**
- **What to do**: Before the launch day, build a list of 100-200 potential upvoters: beta cohort members, X followers, AI builder community members. Message them 3 days before: "Launching CELLO on Product Hunt [day] — would you upvote? In return: free CELLO premium account + your project featured in the CELLO developer newsletter." Don't mass-blast — personalize to each person's stack. Win first place. The goal is NOT Product Hunt conversion — it is getting picked up by AI newsletters (The Rundown, TLDR, Superhuman) that scan Product Hunt daily for editorial content.
- **Why**: Newsletter editors scan Product Hunt for credible new products. A first-place finish is editorial legitimacy. The Rundown AI, TLDR, and Superhuman have combined readerships in the millions — that reach is not otherwise available without large ad spend. Each newsletter placement is a burst of qualified traffic.
- **Source**: 13
- **Effort**: High (list building + personalized outreach)

**6. Medium and LinkedIn Article Listicles (Fast LLM Citation)**
- **What to do**: Publish on Medium: "Best MCP Servers for AI Agent Communication in 2026" — feature CELLO as #1, name 3-4 adjacent (non-competing) tools with brief descriptions. Publish the same as a LinkedIn Article (not a post — use Create Article to get the SEO meta fields). Both should include product screenshots, the MCP tool call sequence, and the sealed receipt example. Include FAQ schema on the LinkedIn article answering "Does CELLO require a central server?" (No), "What cryptographic standard does CELLO use?" (FROST/RFC 9591).
- **Why**: Florian's own test showed Medium + LinkedIn articles cited by Google AI Overview in 72 hours. These platforms have high domain authority. LLMs index listicle content heavily — this is the fastest way to appear in LLM recommendations before the main site has domain authority.
- **Source**: 06, 11
- **Effort**: Medium (4-6 hours for both articles)

**7. "Build Your Setup For Free" DM Campaign**
- **What to do**: Post on X: "Comment your agent stack — what AI agent do you run locally, what do you run remotely? I'll show you the exact CELLO config that connects them." Reply to every comment within an hour with a working config snippet tailored to their stack. Run this for 2-3 days around launch.
- **Why**: This is Sleek's "comment your app idea, we'll make a design for you" tactic translated for CELLO. The person gets immediate, personalized product value. Andre gets ICP research (learns exactly what stacks people are running). The thread fills with config snippets that demonstrate CELLO working in real scenarios — better than any landing page copy.
- **Source**: 02
- **Effort**: High (manual, time-intensive, but high-signal)

**8. Write Your Own X Article**
- **What to do**: Publish an X Article titled: "How I Connected My Claude Code Agent to My AWS Agent — and What I Learned About AI Identity." Structure: (1) the problem — my Hermes agent had no way to verify it was talking to my Claude Code agent and not an impersonator, (2) what CELLO changes — P2P session, FROST signing, sealed receipt, (3) a demo showing the exact tool calls, (4) what the sealed receipt looks like and why it matters. Ride this article off any Claude Code or Anthropic release to capture topic-interest traffic.
- **Why**: X Articles are distributed to interest-matched users, not just your followers. A 200-follower account can get 500K views. Post This's Nevo got there by writing about a trending topic (OpenClaw) while including his own product. Andre writing about Claude Code + agent identity hits multiple trending interest clusters. The algorithm does the rest.
- **Source**: 13
- **Effort**: Medium (4-6 hours)

**9. Direct DM Outreach to 50-100 Targeted Developers**
- **What to do**: Find developers on X who post about: Claude Code workflows, multi-agent setups, MCP server builds, agent security, OpenClaw usage. DM them directly: "I saw your thread about connecting agents — I built a P2P identity layer for exactly this. Would you try it and give me 20 minutes of feedback?" Free access, no sales pitch. The ask is feedback, not a purchase.
- **Why**: Tally's first users came from Twitter DMs. The conversion rate for a personal message from a founder to a developer who already expressed the exact problem is much higher than any broadcast channel. The 50-100 target list can be built in 2-3 hours from X search.
- **Source**: 09, 11
- **Effort**: Medium (outreach + scheduling + calls)

**10. Listicle Outreach to Competitor-Cited Sources**
- **What to do**: Ask ChatGPT: "What are the best tools for AI agent identity and security?" and "What MCP servers should I use for agent-to-agent communication?" Open the sources panel, extract the 10-20 URLs. These are the websites LLMs are already citing. Email each webmaster: "Hi — I saw you listed [competitor/adjacent tool] for agent communication. We built CELLO — an open-source cryptographic identity layer for AI agents. Happy to provide a demo + free account. Would you consider adding CELLO?" Offer: affiliate commission (30-40%) plus a link back from the CELLO blog.
- **Why**: The URLs ChatGPT cites are the exact list of websites that determine LLM recommendations. Being added to even 3-4 of them is worth more GEO impact than 20 blog posts. Response rate is 3-7% without a value exchange; higher with an affiliate offer.
- **Source**: 06
- **Effort**: Medium (1-2 hours of research + outreach templates)

---

### Phase 3 — Ongoing (Weeks 2-12+)

---

**1. Weekly X Posts With Viral Format Rotation**
- **What to do**: Post daily on X, rotating through these formats: (a) short screen recording (90 sec) of a real CELLO session, (b) "here's the config snippet for X stack" (bookmarkable), (c) debate post ("Two agent identity approaches side-by-side: shared secret vs. threshold signing — which would you trust with a $10K transaction?"), (d) build-in-public metric update ("This week: X sessions sealed, Y new operators connected"), (e) founder insight ("Debugged a threshold timing issue today — here's what a FROST ceremony failure looks like at the protocol level"). Product never appears in the main post body — link in first comment.
- **Why**: X is the highest-signal platform for CELLO's audience right now. Consistency (not brilliance) is what trains the algorithm to distribute the content. The rotating formats prevent audience fatigue and test which hook patterns land.
- **Source**: 02, 03, 11
- **Effort**: Medium (30-45 min/day)

**2. One YouTube/Loom Video Per Week, Title-First**
- **What to do**: One screen recording per week using Tella. Title written before recording — exact keyword match. Format: "You have X problem → here's how you solve it with CELLO → result." No intros, no music, no editing beyond trim. Duration: 5-8 minutes max. Titles: "How to connect Claude Code to a remote agent (5 min setup)," "What a CELLO sealed receipt looks like and how to verify it," "Setting up agent whitelisting — who can reach your agent unattended," "FROST threshold signing explained without math." Descriptions include keyword-optimized text and the install one-liner.
- **Why**: YouTube is both a search engine and a discovery engine. Tutorial-intent queries (how to do X) have the highest conversion rate of any content format. YouTube video transcripts are indexed by Google and by LLMs — one recording becomes an SEO asset, a GEO asset, and an onboarding resource simultaneously. The Scalelist founder's 10K-view video had the worst microphone he owned.
- **Source**: 03, 04, 05
- **Effort**: Medium (2-3 hours/week including recording + upload)

**3. One BOFU Blog Post Per Week**
- **What to do**: Write one post per week targeting a specific keyword from the BOFU editorial calendar. Format: detailed technical post (800-1,500 words), semantic H2/H3 structure, author bio, FAQ schema with 3-5 questions, cross-links to 2-3 other CELLO articles. Priorities: comparison posts first ("CELLO vs building your own auth layer"), then how-to posts ("how to verify an AI agent's identity"), then listicle posts ("best MCP servers for agent security 2026"). Repurpose each post as: X thread, LinkedIn Article, Reddit answer where relevant.
- **Why**: BOFU content is what developers read when they've already decided to solve the problem and are choosing a tool. Each post ranks for a specific query and compounds — an article published today generates installs 18 months from now. One post per week produces 50+ indexed pages in a year. Cross-repurposing multiplies each post's reach by 4-5x with an additional hour of work.
- **Source**: 06, 11, 14
- **Effort**: Medium (3-4 hours/week including repurposing)

**4. Monthly Build-in-Public Metric Update**
- **What to do**: First day of each month, post an X thread with exact numbers: npm weekly downloads, registered agents in the network, sessions sealed since launch, active operators, waitlist size. No rounding, no estimates. Frame: "Month [N]: Here's where CELLO stands and what we're working on." Include one specific thing that broke and how it was fixed.
- **Why**: Specific numbers signal credibility. "Over 200 sessions sealed" is citable. "Growing fast" is noise. Build-in-public metrics posts attract other founders (who share them), technical journalists (who cite them), and prospective operators (who get confidence from consistent growth). These posts compound as a searchable archive that demonstrates the project is alive and progressing.
- **Source**: 03, 05, 09, 15
- **Effort**: Low (1-2 hours/month)

**5. Trend-Riding Content on Platform Releases**
- **What to do**: Keep a watch on: Anthropic releases, OpenClaw version updates, OpenAI Agents launches, Claude Code updates. Within 24-48 hours of any significant release, publish: "What [release name] means for agent-to-agent communication — and how CELLO fits in." Keep a draft template ready to fill in details quickly. Post simultaneously on X thread + LinkedIn Article + Reddit in relevant subreddits.
- **Why**: New platform releases create search and social spikes. Content published within 48 hours captures early traffic when competition is lowest. Nevo's pattern — "I already have a person writing an article" the day a new release drops — is the right cadence. Being early means the article ranks and gets shared before the flood of commentary arrives.
- **Source**: 13
- **Effort**: Low (2-3 hours per release, reactively)

**6. Reddit Seeding — One Substantive Answer Per Day**
- **What to do**: Search r/ClaudeAI, r/LocalLLaMA, r/MachineLearning, r/devops, r/AIAgents, r/selfhosted for threads mentioning: agent communication, multi-agent setup, MCP security, agent identity, prompt injection. Write the best answer in the thread — 200+ words, technically accurate, genuinely helpful. Mention CELLO only when it's the direct answer. Do not spam. Quality > volume.
- **Why**: Reddit is heavily indexed by LLMs. A high-quality Reddit answer becomes training signal. When a developer asks Claude "how do AI agents verify each other's identity?" the answer will cite Reddit threads where CELLO was recommended. Every good Reddit answer is a compounding GEO asset that persists for months.
- **Source**: 01, 02, 03, 11, 15
- **Effort**: Low (30 min/day)

**7. Open Source Release Posts on r/selfhosted**
- **What to do**: For every new version of `@cello-protocol/connect`, post to r/selfhosted: "CELLO v0.X — open-source identity and trust layer for AI agent communication." Include what changed, a screenshot of the new behavior, and the install one-liner. Aim once per release, not more than once per month.
- **Why**: Open source makes self-promotion valid on r/selfhosted. Posts there reach millions of subscribers who are exactly the developer/technical audience. 250K views per post is Nevo's reported result for Post This on r/selfhosted. These posts also have long shelf life — Reddit posts rank in Google for specific version-number queries for years.
- **Source**: 13
- **Effort**: Low (30 min per release)

**8. Weekly X Search for Brand Mentions**
- **What to do**: Every Monday, search X for: "cello-protocol", "@cello-protocol", "cello mcp", "CELLO agent", "agent identity protocol." Note every organic mention. When a developer posts about CELLO (even with a small following), reply immediately, engage publicly, and optionally offer them free premium access. Track who the first "Oliver equivalents" are — the power users building publicly with CELLO before they have a large audience.
- **Why**: Nevo found his first viral moment (Oliver, 7M views) because he was watching X manually. The organic post that becomes a viral moment is findable before it tips. The developer with 200 followers writing about their CELLO setup is the most important person in CELLO's distribution right now — not the 50K follower influencer.
- **Source**: 13
- **Effort**: Low (15 min/week)

**9. Podcast Guest Outreach**
- **What to do**: Identify 5-10 podcasts and YouTube channels where agent identity would resonate: The Changelog, AI Engineering podcast, Claude Code-specific content channels, AI security/privacy podcasts, indie hacker content. Pitch angle: "There's a genuine unsolved problem in AI agent communication — I want to talk through why identity verification matters and what the cryptographic approach looks like." NOT "come hear about my product." The conversation earns the audience; the product appears naturally.
- **Why**: A podcast guest slot on one well-matched show delivers qualified leads for months (episodes are evergreen). Guest appearances also get the transcript indexed by LLMs. A 45-minute technical conversation about agent identity produces the kind of substantive content that AI tools surface when someone asks about CELLO.
- **Source**: 03, 04
- **Effort**: Medium (pitch writing + scheduling + recording)

**10. Affiliate Program After 3 Months of Retention Data**
- **What to do**: Once CELLO has 90 days of retention data, build an affiliate page with: conversion rate from developer click to paid subscriber, average subscriber lifespan, expected monthly commission at 30%. Natural affiliates: AI tool reviewers, MCP directory authors, developer newsletter authors covering Claude Code / agentic AI. Offer 30-40% lifetime commission. Pitch: "When developers search for 'AI agent identity tools,' our conversion rate is X%. At 30% commission, that's $Y per 100 visitors."
- **Why**: Affiliates only promote products where they can calculate expected earnings. Sharing conversion rate data turns the conversation from "cost to list" to "revenue opportunity." Lifetime commission is the mechanic that creates motivated long-term promoters — they keep earning as long as the referred operator stays subscribed.
- **Source**: 01, 11
- **Effort**: Medium (page build + outreach — do after 3 months, not before)

**11. Starter Story Submission**
- **What to do**: At first paying customers, submit to Starter Story: "How I built cryptographic identity for AI agents from scratch — as a solo founder." Include: the technical details (why FROST, what a hash chain gives you, the MCP interface design), the business context, the timeline, and the current state. Request an interview.
- **Why**: Starter Story has domain authority and an audience that specifically searches for "how did you build X." A feature earns a permanent SEO asset + distribution to an audience of builders who are exactly CELLO's ICP. Florian, Nevo, and the Sleek founders all credited Starter Story with meaningful MRR bumps.
- **Source**: 03, 13
- **Effort**: Low (once you have the founding narrative from Phase 1)

**12. Wikipedia Contributions (3-6 Month Goal)**
- **What to do**: After launch with traction: add CELLO to the Wikipedia articles for "Multi-agent system," "Threshold cryptography," and "Federated identity" in the context of AI agents. Or create a "AI agent identity protocols" Wikipedia stub that cites CELLO as an implementation.
- **Why**: Wikipedia is one of the highest-authority sources for LLM training and citation. Being mentioned on a relevant Wikipedia page dramatically increases LLM recommendation likelihood. This is not realistic pre-launch but should be on the 3-6 month roadmap.
- **Source**: 06
- **Effort**: Low (a few hours, post-traction)

---

## Part 3: Content Templates

---

### Template 1: Comment-to-Unlock Launch Post

**Format**: X post (with video)
**Platform**: X (Twitter)
**Template**:
```
[Hook — state a surprising capability]

Comment your [specific descriptor] and I'll [specific thing you'll do manually].

The product is live. [One sentence on what it does differently.]

↓ [Short demo video auto-plays here]
```
**Example post**:
> Two AI agents just shook hands cryptographically — Claude Code on my laptop, Hermes on my AWS server.
>
> No central server. No shared API key. The receipt of what they said is tamper-evident.
>
> Comment your agent stack (what runs locally, what runs remotely) and I'll show you the exact CELLO config that connects them.
>
> Already live: npx @cello-protocol/connect
>
> [demo video]

**Why it works**: X's algorithm weights replies 3-4x higher than likes. 300 replies on the first hour spikes the post into wider distribution. The demo video autoplays on scroll. Every "comment your stack" reply is simultaneously product research and social proof (other developers see the demand).

---

### Template 2: Model/Platform Comparison Post

**Format**: X thread with side-by-side comparison
**Platform**: X
**Template**:
```
[New platform/model] just dropped [feature].

Tested what this means for [your domain].

[Comparison result — be specific, show actual output or behavior]

Here's what changed for [your product]: [specific consequence]

Thread ↓
```
**Example post**:
> Anthropic just shipped multi-agent API support in [release].
>
> Tested agent-to-agent sessions with and without CELLO on the new API.
>
> Without CELLO: agent B has no way to verify it's actually talking to agent A — could be an injected impersonator.
>
> With CELLO: agent B gets a FROST-signed handshake proving agent A's identity before the first message lands.
>
> Here's what the difference looks like in the protocol trace:
>
> [screenshots or screen recording]

**Why it works**: Comparison posts answer a question everyone has. Fans of each approach engage. The template is infinitely repeatable because new releases keep coming. If a well-known developer in the AI space shares it, the reach multiplies.

---

### Template 3: "Guess Which Agent" Engagement Post

**Format**: X post with two side-by-side screenshots
**Platform**: X
**Template**:
```
One of these messages was written by [Agent A]. One by [Agent B]. Can you tell which?

[Screenshot showing two similar-looking messages, source unlabeled]

[Optional: security angle variant — "A prompt injection attack tried to hijack this session. Would you have caught it?"]
```
**Example post**:
> This is a real session transcript between two AI agents.
>
> One message was written by a Claude Code instance. One was written by a Hermes agent.
>
> Can you tell which is which?
>
> [Side-by-side screenshot of two agent messages]
>
> Answer in the comments. We'll reveal in 24h.

**Why it works**: Controversy-adjacent content where there's no clearly wrong answer drives maximum comment volume. Everyone feels qualified to guess. The product's underlying message is that without CELLO, neither agent could verify the other — the "guess" format makes this visceral without being didactic.

---

### Template 4: X Article Format

**Format**: Long-form X Article (not a post)
**Platform**: X (distributed to interest-matched audience, not just followers)
**Template**:
```
[Concrete founding story headline — real numbers, real situation]

## The problem I kept hitting

[First-person narrative: the specific friction point in your own workflow]

## Why simple solutions fail

[Technical explanation: why shared API keys / OAuth / HTTPS alone don't solve it]
[Each failure mode in a short paragraph]

## What CELLO changes

[Show the solution concretely — tool calls, sealed receipt screenshot, what the developer sees]

## What I learned building this

[One unexpected insight from the implementation — protocol decision, trade-off, design choice]

[Install one-liner]
[Link to GitHub]
```
**Example post**:
> **I spent 18 months building an identity layer for AI agents because shared API keys are not enough**
>
> My Claude Code agent and my Hermes agent talk to each other dozens of times a day. For the first year, that communication was authenticated with an API key. One day I realized: if that key was compromised, an attacker could impersonate my Hermes agent, inject a task, and my Claude Code would execute it. Zero detection. No receipt. No way to prove afterward what actually happened.
>
> That was the day I started building CELLO...

**Why it works**: X Articles get distributed to interest-matched users regardless of follower count. A compelling first-person technical story hits multiple interest clusters simultaneously (AI agents, security, indie hacking, Claude Code). The practical sections (why simple solutions fail) establish technical credibility before the product is mentioned.

---

### Template 5: YouTube Tutorial Format

**Format**: Screen recording, faceless, keyword-titled
**Platform**: YouTube
**Template**:
```
Title: [Exact keyword query — how to / what is / best X for Y]
Duration: 5-8 minutes max

[No intro sequence. Start immediately with the viewer's problem.]

00:00 — "You have [specific problem]. Here's how to solve it in [N] steps."
00:30 — Show the terminal / context — the viewer recognizes their situation
01:00 — Step 1 (with on-screen captions of the command)
03:00 — Step 2 (showing what changes, what the output looks like)
05:00 — The result — the thing they were trying to achieve, visible on screen
06:30 — "If you got stuck on [specific step], here's why and how to fix it."
07:00 — [No outro. End.]

Description:
[Install one-liner]
[GitHub link]
[What this video covers — keyword-rich]
[3-5 relevant hashtags]
```
**Example post**:
> Title: "Connect Claude Code to a Remote AI Agent in 5 Minutes (CELLO Setup)"
>
> 00:00 — "You're running Claude Code locally and a second agent on a server. They can't verify each other's identity. Here's how to fix that."
> [screen recording begins — terminal, real commands, real output, sealed receipt appears at the end]

**Why it works**: YouTube tutorial-intent queries convert at higher rates than any other content format. The developer watching "how to connect two AI agents" is actively trying to do that right now. Loom-style, no editing required — the Scalelist founder's best-performing video used the worst microphone he owned.

---

### Template 6: Medium / LinkedIn Listicle Format

**Format**: Long-form article (Medium or LinkedIn Article — not LinkedIn post)
**Platform**: Medium + LinkedIn (cross-publish same content)
**Template**:
```
Headline: Best [Category] Tools in [Year] — [Specific Audience Qualifier]
(e.g. "Best MCP Servers for AI Agent Communication in 2026 — Developer Guide")

[Opening paragraph: why this list matters, what problem the reader has]

## 1. CELLO — [One-sentence description]
[2-3 paragraphs: what it does, the key differentiator, install command]
[Screenshot: the thing it produces — sealed receipt, session view, etc.]

## 2. [Adjacent tool — non-competing]
[Brief description]

## 3. [Adjacent tool]
[Brief description]

## Comparison table
[Feature comparison — include at least 3 columns that favor CELLO's unique properties]

## Bottom line
[Recommended use case for each tool, CELLO recommended for the case CELLO wins]

[FAQ section with FAQ schema markup: 3-5 questions an evaluating developer would ask]
```
**Why it works**: Listicle/comparison articles are the exact format LLMs cite when answering "what should I use for X." Medium and LinkedIn have high domain authority — they rank fast, even for new accounts. 72-hour LLM citation is feasible for niche queries with low competition.

---

### Template 7: "Build Your Setup For Free" DM Campaign

**Format**: X reply campaign (2-3 days around launch)
**Platform**: X
**Template post**:
```
Comment your agent stack:
→ What AI agent do you run locally?
→ What do you run on a remote server / cloud?

I'll post the exact CELLO config that connects them.
```
**Example personalized reply**:
> Claude Code locally + Hermes on EC2? Here's your exact 3-line CELLO config:
> [paste working config snippet]
> This gives you: signed sessions, tamper-evident transcript, and a sealed receipt when you're done. Takes ~5 minutes to set up from scratch.
> DM if you hit any friction.

**Why it works**: This is 1-1 product trial at zero friction. The person who comments gets immediate, specific value without signing up, creating an account, or reading docs. If they want to iterate on what you showed them, they need to install CELLO. The thread fills with real agent stacks that also serve as product research.

---

### Template 8: HN Show HN Post

**Format**: Text post
**Platform**: Hacker News
**Template**:
```
Show HN: [Product name] — [one-sentence technical description]

[Paragraph 1: the technical problem, stated precisely. No pitch language.]

[Paragraph 2: why the obvious solutions (shared API keys, OAuth, centralized auth) fail against this specific threat model.]

[Paragraph 3: the approach you took and why — cite the cryptographic primitives, RFCs, design decisions.]

[Code example or terminal output — the one thing that makes it concrete]

[Link to GitHub repo]

[One sentence on the founding context: built this because I needed it for my own agents.]
```
**Example post**:
> Show HN: CELLO — open-source P2P identity and trust layer for AI agents
>
> AI agents communicating via HTTP or API calls have no native way to verify each other's identity. If your Claude Code agent calls your Hermes agent's endpoint, Hermes has no cryptographic proof that the request came from your Claude Code agent and not an impersonator or prompt-injected request.
>
> Shared API keys fail because one compromise exposes everything. OAuth is designed for delegating human auth, not for agent-to-agent identity. Trust-on-first-use (TOFU) provides no protection after the first compromise.
>
> CELLO uses FROST threshold signatures (RFC 9591) distributed across a federated directory — no single node can forge an agent identity. Sessions are sealed with a tamper-evident hash chain that both parties get as a cryptographic receipt...
>
> [github link]

**Why it works**: HN rewards technical substance over marketing language. The audience (cryptographers, protocol designers, security researchers, agent developers) is exactly the CELLO ICP. The comments become a peer-review session and a GEO asset that persists for months.

---

### Template 9: "I Added X to My Stack — Here's What Changed" Post

**Format**: X thread or YouTube video
**Platform**: X or YouTube
**Template**:
```
[Title/hook: specific before → after, with real numbers or observable outcomes]

I [had problem X] for [time period].

Added [CELLO] [N] weeks ago.

Here's what changed:
→ [Observable outcome 1 — specific, concrete]
→ [Observable outcome 2]
→ [Unexpected benefit]

Here's what I would have done differently:
→ [Honest reflection]

[Screenshot or screen recording of the key moment]

[Install link in reply]
```
**Example post**:
> I ran my multi-agent Claude Code ↔ Hermes setup for 8 months with zero identity verification.
>
> Added CELLO 3 weeks ago. Here's what changed:
>
> → Every session now has a cryptographic handshake. I know it's my Hermes agent on the other end.
> → I caught one case where a test script was responding to my Claude Code agent — would have been invisible before.
> → Got a sealed receipt after every session. For the first time I have a tamper-evident log of what my agents agreed to.
>
> What I'd do differently: install it on day one. The DKG setup takes 10 minutes and I kept deferring it.
>
> [sealed receipt screenshot]
>
> [install one-liner in first reply]

**Why it works**: Migration/addition stories perform because they're decision-content. Developers at the same decision point search for exactly this. Specific outcomes ("caught one case where a test script was responding") are more credible than feature lists.

---

## Part 4: GEO Master Checklist

Ordered by impact. Do these in sequence — each builds on the previous.

---

**Step 1: Confirm the site is crawlable to AI tools**
- Install AI Eyes Chrome extension, test `cello.so` and `blog.cello.so`
- If blank: ensure all content is server-side rendered (SSR/SSG) — no JavaScript-only content
- Verify: homepage, blog index, and every article render full text content to the crawler
- **Target**: ChatGPT, Claude, Perplexity can read the CELLO site

**Step 2: Set up attribution tracking for AI referrals**
- Google Analytics with source/medium enabled
- Watch for `chat.openai.com`, `claude.ai`, `perplexity.ai`, `grok.x.com` as traffic sources
- Rule: multiply any AI referral traffic number by 100 to estimate actual LLM mention volume (1% click-through rate from LLM recommendations)
- **Target**: Know within 30 days whether CELLO is appearing in any LLM recommendations

**Step 3: Publish two Medium listicles and two LinkedIn Articles targeting BOFU keywords**
- Medium: "Best MCP Servers for AI Agent Communication (2026)" + "Best Tools for Multi-Agent AI Security"
- LinkedIn Articles (Create Article, not Create Post): same titles reformatted
- Include: product screenshots, CELLO at #1, real competitors for credibility, FAQ schema
- Expected result: citation in Google AI Overview within 72 hours for niche queries
- **Keywords to target**: "best MCP agent identity tool," "best AI agent communication tools," "secure agent-to-agent messaging," "multi-agent trust layer"

**Step 4: Build the topical authority cluster on the CELLO blog**
Write one article per keyword in the BOFU list. Stay within one tight cluster — do NOT write about adjacent-but-unrelated topics:
- AI agent identity (the hub article — all others link here)
- CELLO vs. building your own agent auth layer
- How to prevent prompt injection in multi-agent systems
- What is a sealed receipt in AI agent communication?
- FROST threshold signing explained (accessible version)
- Best practices for AI agent-to-agent communication
- How to verify an AI agent's identity before responding
- Claude Code multi-agent setup guide

Internal link every article to the hub and to 2-3 related articles. 20 articles in this cluster make CELLO the authoritative source on "AI agent trust" — the topic LLMs cite when asked anything in this space.

**Step 5: Answer long-tail Reddit questions in target subreddits**
- Target subreddits: r/ClaudeAI, r/LocalLLaMA, r/MachineLearning, r/AIAgents, r/devops, r/selfhosted
- Long-tail queries to answer: "How do I connect my Claude Code agent to another agent securely?", "How do I prevent prompt injection in multi-agent systems?", "What's the best way to give two AI agents shared identity?", "MCP server for agent identity verification"
- Rule: write the best answer in the thread — 200+ words, technically accurate, substantive — then mention CELLO as the tool at the end if it is the genuine answer
- One good Reddit answer per day during launch period. Weekly thereafter.
- **Why**: Reddit is weighted heavily in LLM training data. A well-answered question in r/ClaudeAI becomes the LLM's answer to similar questions for months.

**Step 6: Seed competitor-cited listicles**
- Run ChatGPT query: "What are the best tools for AI agent identity and security?" — export all cited sources
- Run: "What MCP servers should I use for agent-to-agent communication?" — same
- Email each webmaster: introduce CELLO, offer affiliate commission (30-40%), link exchange
- Target: be listed on 3-5 of these sources within 60 days of launch
- **Why**: ChatGPT's sources are the exact list of sites that determine LLM recommendations. Being added to them is the most direct GEO lever.

**Step 7: Optimize GitHub README and npm package page for LLM citation**
- README must answer in crawlable text (not screenshots): "What is CELLO?", "What problem does it solve?", "Who is it for?", "How do I install it?", "What cryptographic standard does it use?"
- Use CELLO's own glossary terminology (session, sealed receipt, moniker, endorsement, contact tier) — consistency across all public pages is a GEO signal
- README opening sentence should contain the exact phrase LLMs will reproduce: "CELLO is the identity and trust infrastructure for AI agent-to-agent communication"
- npm package page description: same keywords
- **Why**: GitHub READMEs and npm package pages are indexed by LLMs. When a developer asks Claude "what does @cello-protocol/connect do?", the answer comes from the README.

**Step 8: YouTube channel for BOFU keywords**
- Create CELLO YouTube channel
- Produce 5-10 videos targeting the highest-priority BOFU keywords (same list as blog)
- Thumbnails: CELLO logo (left, large) + keyword text (right, bold) + CELLO brand color background
- Each description: install one-liner + 3-5 relevant hashtags + link to blog post on same topic
- **Why**: Google and ChatGPT increasingly surface YouTube videos in search and AI overview results. A CELLO video on "how to connect two AI agents securely" surfaces in three places simultaneously: YouTube search, Google video results, ChatGPT AI overview. Even a new channel with an AI-generated voice-over gets picked up for low-competition queries.

**Step 9: G2 and Capterra profile optimization**
- Category: "AI security tools," "AI agent frameworks," "developer tools"
- Description keywords: agent identity, AI agent security, multi-agent trust, MCP server, FROST threshold signing
- Ask early beta users to leave reviews (even 2-3 reviews help)
- **Why**: G2 and Capterra are explicit LLM citation sources — ChatGPT surfaces them when answering "what tools should I use for X?" Reviews there get indexed.

**Step 10: Wikipedia contributions (3-6 month goal)**
- Add CELLO to "Multi-agent system," "Threshold cryptography," "Federated identity" Wikipedia articles
- Or create "AI agent identity protocols" article
- **Why**: Wikipedia has the highest LLM citation weight of any source. Appearing there is worth more than 50 blog posts.

**Queries CELLO should own** (test quarterly by asking ChatGPT, Claude, and Perplexity):
- "How do AI agents verify each other's identity?"
- "What MCP server handles agent-to-agent communication?"
- "How do I prevent prompt injection between AI agents?"
- "What is a sealed receipt in AI agent sessions?"
- "Best tools for multi-agent AI security 2026"
- "How to connect two Claude Code agents"
- "Agent identity verification without central server"

---

## Part 5: Partnership & Distribution Leverage Points

---

### OpenClaw / OpenClaw Lab Community

**What it is**: Florian's renamed community (formerly OpenClaw Lab) of solo founders and developers using AI agents — currently migrating from OpenClaw to Claude Code.

**Why it matters for CELLO**: This community is exactly CELLO's ICP — they rebuild their agent stacks whenever they migrate, are vocal about their tools, and follow trusted-peer recommendations. Florian explicitly named CELLO-adjacent use cases as opportunities he'd build a startup around. The OpenClaw-to-Claude migration is happening now — a time-limited window where developers are maximally receptive to adding tools that should have been in their stack from the start.

**Concrete first action**: (1) Publish the OpenClaw skill file for CELLO (see Phase 1). (2) Post in the OpenClaw Lab community (or its successor) when Florian renames it: "You're rebuilding your agent stack anyway — CELLO takes 5 minutes to add and gives your agents identity and trust from day one." (3) DM Florian directly — as a developer who uses his own agents daily and was publicly using OpenClaw, he is a Tier-1 target for the "Florian-tier founder" distribution pattern (500-5,000 engaged followers, vocal about their stack).

---

### Adjacent MCP Server Developers

**What it is**: Developers who have built other MCP servers for specific workflows — code review agents, research agents, documentation agents, data processing agents.

**Why it matters for CELLO**: These developers have audiences of exactly the right ICP. A CELLO integration into their MCP server (identity verification + sealed receipts for their workflow outputs) adds value to their product while distributing CELLO to their users. They are non-competitive — CELLO doesn't do what they do, and they don't do what CELLO does.

**Concrete first action**: Find the top 10 MCP servers by GitHub stars / Smithery listing popularity. Email the authors: "I'm building CELLO — an identity and trust layer for MCP agents. Would you be interested in adding a CELLO step to your workflow? I can provide a working integration and a newsletter mention from the CELLO developer list." The integration is typically one tool call addition — minimal engineering cost for them.

---

### AI Agent Framework Communities (LangGraph, CrewAI, AutoGen successor)

**What it is**: Communities around multi-agent frameworks. These developers are building pipelines with multiple agents and experiencing the trust and identity problem CELLO solves.

**Why it matters for CELLO**: These are the developers who have a name for the problem ("my orchestrator agent can't verify that the tool-call response came from my intended worker agent") and are actively looking for solutions. Getting CELLO mentioned in LangGraph or CrewAI documentation as "recommended for agent identity and trust" is the Shopify integration equivalent — access to an installed audience.

**Concrete first action**: Ship an adapter (or an integration guide) for one major framework. Publish it as a blog post + GitHub example project. Reach out to the framework maintainers: "I built a CELLO integration for [framework] — here's what it adds. Would you be open to linking to it from your docs under 'agent identity' or 'trust'?" The framework benefits (a solved problem = better user experience); CELLO benefits (distribution to their user base).

---

### MCP Directories (Smithery, mcp.so, Glama, Awesome-MCP)

**What it is**: The emerging set of directories and registries where developers browse for MCP servers to add to their Claude Code or similar environment.

**Why it matters for CELLO**: These are the directories that CELLO's ICP (Claude Code users) actually checks when looking for new tooling. Being listed prominently here is the direct equivalent of the App Store — organic discovery by an already-motivated audience. "MCP server for agent identity and trust" is a category that currently has no clear winner in any of these directories.

**Concrete first action**: Submit to all four this week. Title: "CELLO — Identity and Trust Layer for AI Agents." Description optimized for the queries developers search: agent identity, agent-to-agent communication, MCP security, FROST threshold signing, sealed receipts. This is a one-time 2-hour task.

---

### YouTube Creators in the Claude Code / AI Agent Space

**What it is**: YouTube creators with 5K-50K subscribers who make videos about Claude Code workflows, MCP tools, AI agent setups, and agentic AI development.

**Why it matters for CELLO**: These creators have exactly CELLO's audience. A 10-minute "how I connected two AI agents securely" video from a creator their audience already trusts reaches more qualified prospects than months of Andre's own YouTube output. ZenU grew significantly from YouTube creator partnerships at exactly this stage.

**Concrete first action**: Identify 5-10 YouTube channels covering Claude Code / MCP / agentic AI. Reach out with: "I built CELLO and would love to help you make a video on 'how to connect two AI agents securely.' I'll build the demo, you film and publish it." Offer: free CELLO account, help scripting the demo section, no editorial control. The creator gets content; CELLO gets distribution.

---

### AI Developer Newsletters

**What it is**: Developer-focused AI newsletters that cover new tools, frameworks, and workflows: TLDR AI, The Rundown AI, Superhuman AI, Latent Space, smaller niche newsletters focused on Claude Code and MCP.

**Why it matters for CELLO**: Newsletter subscribers are opted-in and attentive — much higher quality than social media reach. A Product Hunt win in first place gets picked up editorially by these newsletters without a paid sponsorship. A direct pitch to smaller newsletter authors (offering free CELLO access + affiliate commission) gets placements in front of exactly the right audience for a low marginal cost.

**Concrete first action**: After the Product Hunt launch, if CELLO places first: monitor which newsletters pick it up and which don't. DM editors of the ones that didn't: "We placed first in Product Hunt last week — would you include CELLO in your next issue? Happy to provide a demo video and a 2-sentence description." For smaller newsletters: offer 30-40% affiliate commission.

---

### Tiny Seed / Aligned Investor Network

**What it is**: Tiny Seed is a B2B SaaS accelerator (early stage, founder-friendly, Rob Walling) that works with bootstrapped founders building developer tools. Referenced explicitly by Youssef (Scalelist) as having provided substantive support during a crisis.

**Why it matters for CELLO**: If CELLO raises, Tiny Seed's model (patient capital, founder-first, developer-tool expertise) matches CELLO's profile better than VC. The alumni network also provides warm introductions to the developer tool community and potential enterprise customers.

**Concrete first action**: Track CELLO's metrics for 3 months post-launch. When you have retention data and a repeating growth signal, apply to Tiny Seed with the narrative: "bootstrapped developer infrastructure, protocol-level moat, solo technical founder, B2B."

---

## Part 6: The One-Sentence Pitch — Working Drafts

Five candidate pitches, each written for a different framing angle:

---

**1. Security angle**
> CELLO gives your AI agents cryptographic identity — so when agent A talks to agent B, both sides can prove who they're talking to, what was said, and that neither message was tampered with.

---

**2. Productivity / solo multi-agent angle**
> CELLO connects your own AI agents — Claude Code on your laptop, your server agent in the cloud — with a verified identity handshake and a sealed receipt of everything they agreed to, in under 5 minutes.

---

**3. Friend-to-friend / endorsement angle**
> CELLO is how AI agents introduce themselves to each other's networks — verified by endorsement, contacted by permission, with a tamper-evident record of every conversation.

---

**4. Infrastructure angle**
> CELLO is the identity and trust infrastructure AI agents run on — P2P, threshold-signed, no central server reads your messages.

---

**5. Outcome / contrast angle**
> You're already connecting agents with ad-hoc API calls and shared secrets — CELLO replaces that with cryptographic identity, signed sessions, and a sealed receipt neither side can deny.

---

**The strongest pitch**: **Pitch 2 (solo multi-agent)** for the launch phase.

Here's why: Every other pitch requires the reader to know they have a problem. Pitch 2 assumes they already have the setup (two agents, one local, one remote) and names a specific outcome they don't have yet (a verified identity handshake + sealed receipt in 5 minutes). It passes the Sleek test — it says who it's for (you, the developer running Claude Code + a server agent), what they get (verified handshake, sealed receipt), and on what timeline (5 minutes). A developer who reads it either recognizes their setup and thinks "wait, that's me" or doesn't have two agents and knows this isn't for them yet.

Pitch 4 (infrastructure angle) is the right pitch for landing pages, conference talks, and enterprise conversations — it opens doors with platform builders and enterprise buyers. Use it for those contexts.

Pitch 5 (outcome/contrast) is the right pitch for HN and Reddit threads where you're competing for attention from technically sophisticated readers who are skeptical of marketing language. The contrast framing ("you're already doing this badly") is more credible in those communities than a positive-only pitch.

Run Pitches 2, 4, and 5 as A/B variants in the first 4 weeks of distribution and let the click-through and signup rates determine which one earns the homepage headline.
