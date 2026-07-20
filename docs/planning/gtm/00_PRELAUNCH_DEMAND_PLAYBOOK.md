# CELLO Pre-Launch Demand Generation Playbook
How to drive people to the waitlist before launch — extracted from 25 founder interviews

---

## What This Is and What It Is Not

This document covers the upstream question: how do you generate enough awareness and desire that people actually show up to the landing page and sign up? The waitlist mechanics — wave admission, referral programs, email sequences, invite flows — are handled in a separate document. This document stops at the moment someone is motivated to join.

Every tactic here is drawn from a real founder who did it. The CELLO application section answers: "What would Andre actually do this week?"

---

## Prerequisites Before Any Tactic Works

These are not optional. Run distribution against an unready product and you waste every impression.

**1. Problem-aware one-sentence pitch (not solution-aware)**
"Your AI agents can't talk to each other securely. CELLO connects them — verified identity, no central platform reads your messages, sealed receipt of every session." Not: "Federated threshold identity layer for AI agents." The pitch must work on someone who doesn't know what FROST is.

**2. A demo that works in under 60 seconds, every time**
Two terminals. One Claude Code agent initiates a session. The second agent gets a doorbell. They exchange a message. The sealed receipt appears. End. No voiceover needed for the technical audience. Record it once and it becomes the hero content for everything downstream.

**3. A landing page that doesn't look like an indie side project**
CELLO is a trust infrastructure product. A landing page that reads as "one dev's weekend project" is a direct contradiction of what CELLO promises. Visual credibility is not optional here — it is load-bearing.

**4. GEO infrastructure: a pre-rendered, crawlable blog**
Ghost at `blog.cello.so` or equivalent. Connected to Google Search Console. Google Analytics with waitlist-signup conversion tracking. These take one afternoon to set up and must exist before publishing any content.

**5. MCP registry listings**
`@cello-protocol/connect` listed in: mcp.so, Smithery, awesome-mcp-servers GitHub lists, Glama, and any other MCP registries active at launch time. These are permanent, zero-marginal-cost discovery surfaces. Do this before the first public post.

---

## Tactic 1: The 72-Hour GEO Fast Path (Medium + LinkedIn Articles)

**Who**: Florian Darroman, video 11 (0-to-20k-7steps)

**What they did**: Florian created a Medium account, wrote a listicle ("Best OpenCore Community"), cited his own product at #1. Within 48-72 hours he was appearing in ChatGPT, Grok, and Gemini answers for that query. Simultaneously published the same article as a LinkedIn Article (not a post — LinkedIn Articles have customizable meta title and description). Both ranked fast because of Medium's and LinkedIn's domain authority. "I did a listicle on Medium and a listicle on LinkedIn. Both ranked really fast on Google and I got quoted in AI overview in about 72 hours."

**Why it worked**: LLMs index publicly available structured content from high-authority domains. Medium and LinkedIn have domain authority that makes their content appear in both Google results and AI training/retrieval pipelines immediately, even for brand-new accounts. The query "best X for Y" (with an audience qualifier) is less competitive than "best X" alone.

**CELLO application**: This is the highest ROI action per hour at launch. Do it in Week 1, Day 1.

Publish on Medium: "Best MCP Servers for AI Agent Communication (2026 Guide)" — 800 words, feature CELLO at #1 with a substantive paragraph on why (P2P, Ed25519 signing, sealed receipts, no central server reads messages). List 3-4 adjacent non-competing tools as alternatives.

Simultaneously publish as a LinkedIn Article (NOT a LinkedIn post — go to linkedin.com → create article): same content, customize the meta title and description with target keywords. Include a product screenshot of a sealed receipt output.

Target variants to also publish over the following two weeks:
- "Best Tools for AI Agent Identity Verification"
- "Claude Code Multi-Agent Setup: What You're Missing"
- "How to Connect Two AI Agents Securely (Without Trusting a Platform)"

These 72-hour GEO hits are the fastest way to appear in ChatGPT and Claude responses when developers ask about agent communication tools.

---

## Tactic 2: The Structured 60-Second Demo Post

**Who**: Yaser (Chatbase), video 14 (1M-startup-117days)

**What they did**: Yaser posted on X with 16 followers. He explicitly says: "The way I structured the demo and the way I talked about it made sense to me." It was a screen recording demo, not a text post. He had been watching his timeline and saw how many people were excited about AI. The post reached a viral coefficient immediately despite almost no following.

**Why it worked**: The demo showed the product working in real time — not described, not announced, but demonstrated. It met an existing wave of curiosity. Structure (what you show, in what order, how you hook) determines whether a demo gets traction. Confidence in the framing came from reading the timeline before posting.

**CELLO application**: The first launch post must be a structured screen recording, not prose. The format:

- **Second 0-5**: Problem frame (on-screen text or voiceover): "Two AI agents on different machines. Neither trusts the other."
- **Second 5-30**: The connection — Claude Code issues `cello_start_agent`, Hermes agent's doorbell fires, they verify each other's identity
- **Second 30-50**: A real message exchange — both sides visible
- **Second 50-60**: The sealed receipt appearing — the cryptographic proof the session happened

Caption: "Two AI agents just shook hands without trusting a platform to broker it. Here's what that looks like."

Post this when a wave of agent interest is peaking on the timeline — after an Anthropic announcement, after a new Claude Code feature drops, or after a visible wave of "I wish my agents could talk to each other" frustrations in the X timeline.

---

## Tactic 3: Comment-to-Access Launch Mechanic

**Who**: Sleek founders (designers), video 2 (zero-to-25k-one-channel)

**What they did**: The product was already live and publicly accessible. They launched on X saying "comment to get access" — making people reply to get the link. This was a partial fiction (the product was already public), but it worked: "comments poured in, the algorithm loved the engagement, the post snowballed. At a certain point they revealed 'the beta was a joke, it's live.'" Got to 600K impressions on the launch tweet.

**Why it worked**: X's algorithm weights replies heavily. A post with 300 replies ranks far higher than one with 300 likes. By making the CTA "comment this" instead of "click here," they manufactured an engagement loop that looked like genuine demand. Social proof was visible in the thread — everyone could see hundreds of people wanting in.

**CELLO application**: Combine with the structured demo video above. Launch tweet format:

"I built P2P identity for AI agents. Two Claude Code instances, two Hermes agents, any combo — they can find each other, verify identity, and message without going through a platform.

Comment your agent stack (what do you run locally? what remotely?) and I'll show you the exact CELLO setup that connects them."

Product is already functional. The comment CTA generates replies that the algorithm amplifies. Andre personally replies to each comment with a working config snippet for their specific stack — high signal for onboarding research AND the replies compound the algorithm boost.

---

## Tactic 4: The X Article (Works from Zero Followers)

**Who**: Nevo (Post This), video 13 (46k-35days-openclaw)

**What they did**: Nevo published an X Article starting with roughly 200 followers. He got 500K views. X changed their algorithm to push articles to interest-matched users, not just followers. Oliver, a user with 200 followers, published an article about Post This that got 7 million views — which triggered 700 trials in a week. "X is changing and they want people to read long-form content... they're trying to show what you posted to the audience that are looking for this kind of specific content."

**Why it worked**: X's article algorithm distributes by topic interest, not by follower count. A compelling article in a trending topic space reaches everyone tracking that topic, regardless of whether they follow the author.

**CELLO application**: Write an X Article: "How I Connected My Claude Code Agent to My AWS Agent (And Why Copy-Pasting Into Slack Was the Alternative)"

Structure:
- The problem (specific — "I had Claude Code on my laptop and Hermes on EC2, and every handoff was a manual copy-paste into a chat window")
- The insight (agents need identity, not just connectivity)
- The demo (the 60-second connection walkthrough)
- The cryptographic property that changes the game (sealed receipts — both sides can prove what was said)
- The install line

Publish this when Claude Code or OpenClaw releases a new version, riding the traffic spike from that announcement. Post immediately — trend timing matters more than polish.

---

## Tactic 5: Micro-Influencer X Article Seeding (200-Follower Tier)

**Who**: Nevo (Post This), video 13

**What they did**: After Oliver's organic article (200 followers → 7M views) proved the format, Nevo scaled it. "I contacted so many people, people with 200 followers, 300 followers. And started to say, 'Would you write an article about Post This?' Many of them were like, 'I was already using the tool, so great. Let's do it.'" He paid them to write articles; he didn't require large followings. X's algorithm surfaced articles by topic, not follower count.

**Why it worked**: The cost per reach is radically lower than established influencers. Targeting people already using the product means authentic content. A 200-follower developer in the Claude Code ecosystem who writes "I connected two agents using CELLO and here's the sealed receipt" is more credible to the technical audience than a paid tech influencer with 100K followers.

**CELLO application**: Find developers in the OpenClaw, Claude Code, and AI agent ecosystem who:
- Have 100-500 followers on X
- Are actively posting about multi-agent workflows
- Have hit the "how do I connect this to that?" frustration in public

Reach out with: "I saw you're building [X setup]. I built CELLO — a trust layer that connects AI agents P2P. Would you try it and write an X Article about connecting your setup? I'll give you a free account + a working config for your stack."

Flat fee ($50-100) or free account is sufficient. The article should show their specific setup, not CELLO generically. Target 3-5 such articles in the week before and week of launch.

---

## Tactic 6: The HN "Show HN" Technical Post

**Who**: Sleek founders, video 2

**What they did**: Posted on Hacker News explicitly stating their situation: "This is our last attempt. We are building Sleek Design, a mobile app design tool. We're giving ourselves until the end of the year." The vulnerability of a public deadline created engagement that polished marketing never gets. It attracted people who wanted the founders to succeed — early users who are invested in the journey.

**Why it worked (The Core Lesson)**: The takeaway isn't that you must be vulnerable or desperate — it's that Hacker News demands a radically authentic, BS-free hook. The Sleek founders used vulnerability to achieve that authenticity, but the underlying tactic is simply finding an angle that bypasses marketing filters. 

**CELLO application**: Find CELLO's authentic HN angle without oversharing or creating fake desperation. Use "tactical vulnerability" — sharing a truthful, contained slice of the story (like the East African discovery pivot where you realized your first assumption was wrong) that builds credibility without exposing unnecessary downside risk to investors.

A "Show HN" post will perform well with HN's audience (cryptographers, protocol engineers, security researchers) IF it is entirely honest.

The post should NOT be a pitch. It should be:
- The technical problem: AI agents can't verify each other's identity without trusting a platform
- The technical approach: FROST threshold signing across federated directory nodes, P2P sessions, tamper-evident hash chains
- An honest assessment: what works, what doesn't yet, what the intended first use is
- A link to the demo and the open-source client

Write it as someone explaining a hard technical problem they solved, not as a product announcement. The solo founder / nearly 2 years / bootstrapped context should be in the post — HN responds to conviction and authenticity, not press release language.

Timing: post Tuesday or Wednesday morning US time, when HN engagement peaks.

---

## Tactic 7: The Early User Flywheel (Feedback → Content → Growth)

**Priority**: Post-launch only. Runs after Wave 1 users have had their first win.

**What this replaces**: The original tactics 7 and 8 in this playbook described trend-riding off specific ecosystem events (the OpenClaw-to-Claude migration, "Florian-tier" founder pivots). Those were time-sensitive moments that have passed, and the underlying pattern — reacting to someone else's news — is high-effort and unpredictable. This tactic is the sustainable, product-driven replacement: instead of borrowing energy from external events, generate it from real user stories.

**The flywheel:**

1. **Identify high-activity users** — users who hit ≥5 sealed sessions or ≥1 cross-operator session within 14 days. This is observable from session telemetry without reading message content.

2. **Reach out via CELLO_FEEDBACK agent + email** — the outreach itself dogfoods the product. Message: "We noticed you've been using CELLO actively. We'd love 20 minutes to hear what's working and what isn't. Your feedback directly shapes what we build next."

3. **Grant premium invites as reward:**
   - No response after 5 days → auto-grant 2 premium invites (acknowledges their activity)
   - Completed feedback call → grant 4 premium invites (replaces the 2 if already issued)

4. **Feedback calls produce raw material** — real use cases, real workflows, real friction points. Each call yields: candidate testimonials, candidate case studies, and identification of users who might write their own X Article (feeding Tactic 5).

5. **Raw material becomes public content** — staff-written articles, user-written articles (via Tactic 5 mechanics), X posts, landing page social proof.

6. **Content attracts new users** → they join the waitlist → become active users → generate new raw material.

**Why this beats trend-riding**: Ecosystem events are unpredictable and time-limited. A library of real user stories is permanent and self-replenishing. When relevant ecosystem news does happen — a new Claude model ships, a security incident in the agent space gets attention — you have specific, attributable stories to surface in response rather than manufacturing content from scratch.

**The feedback call format (20-30 minutes):**
- What were you trying to do when you used CELLO?
- What worked as expected?
- What was harder than it should have been?
- Is there a workflow you'd be willing to let us write about?

**Note on trend-riding**: Being responsive to ecosystem news (new model releases, framework launches, security incidents) is worth doing as an ongoing background practice — it just doesn't need a dedicated tactic. When CELLO has a library of user stories, surfacing the relevant one in response to a trend takes minutes, not days.

Full mechanics in the waitlist plan: §5c.

---

## Tactic 8: Security Fear as Pre-Existing Tailwind

**Who**: Oliver, video 19 (make-money-openclaw); Kit, video 20 (39-openclaw-use-cases)

**What they did**: Both Oliver and Florian extensively discuss security risks in the AI agent community — malicious skills stealing API keys, unsecured VPS machines getting hacked, connecting agents to everything creating attack surfaces. Oliver says: "Don't install any skills that you're not sure what they do... people were installing skills willy-nilly... getting malware, losing their keys." Kit built a 5-LLM jury for every incoming email to defend against prompt injection.

**Why it worked**: Security fear is already present in this audience. The OpenClaw community was scared of malicious skills, stolen API keys, and unverified agent communication. They don't need to be educated about the problem. They need a solution that names their exact fear.

**CELLO application**: Don't educate the audience about why agent identity matters. They already know. They've lived it. The move is to show up in security-fear conversations already happening:

- In r/LocalLLaMA, r/ClaudeAI threads where people discuss agent security concerns
- In replies to X posts where developers describe being burned by malicious tools
- In the OpenClaw community after security incidents are reported

The message: "Oliver told you to be careful installing skills. CELLO is how you give your agents cryptographic identity so you know exactly who's talking to your agents and have a sealed record of what was said. It's the thing that makes the 'careful installation' advice unnecessary."

Write one specific post: "My agent just got a session request from an unknown agent. Here's how I knew it was safe (or not) — the CELLO trust tier system in practice."

---

## Tactic 9: OpenClaw Skill File as Distribution Vector

**Who**: Nevo (Post This), video 13; Oliver, video 19

**What they did**: Nevo created a single Markdown skill file for Post This in the OpenClaw skill directory before any viral moment. Oliver created the Larry skill and gave it away free — 1,600 installs in the first week, no promotion other than the skill being available. "Somebody can just install this skill and you need to use Post This to have it work."

**Why it worked**: OpenClaw users search the skill directory to extend their agents. A skill file is the minimal atomic unit of distribution in the agentic ecosystem — zero friction, no installation step beyond downloading the MD file, and it surfaces your product at the exact moment the user needs it.

**CELLO application**: Publish an official OpenClaw skill for CELLO. The skill file covers:
- `cello_start_agent` — start the daemon and register the agent
- `cello_contacts` — list your contacts and their trust tiers
- `cello_initiate_session` — connect to a contact's agent
- `cello_send` / `cello_receive` — message exchange
- `cello_sealed_receipt` — generate and verify a sealed receipt

Include worked examples: "connect to a teammate's agent," "send a verified update to your AWS Hermes agent," "check who's currently online."

This is 2-4 hours of work. Every OpenClaw user who installs the skill becomes a potential connection endpoint. Every skill tutorial that includes CELLO as a required dependency is passive distribution.

---

## Tactic 10: GEO Reverse-Engineering via Perplexity

**Who**: Sleek founders, video 2

**What they did**: "Go to Perplexity, ask 'what is the best mobile app design tool for non-technical founders?' Perplexity shows you which sources it's pulling from. Those sources are the GEO targets. Contact each one: 'How do I get listed here? What do I need to do?'"

**Why it worked**: Most GEO advice is vague. Perplexity makes the source layer visible, turning a fuzzy strategy into a concrete target list. You know exactly which sites you need to land on to get cited by LLMs.

**CELLO application**: Go to Perplexity, ChatGPT, and Claude and ask:
- "How do AI agents communicate with each other securely?"
- "What's the best way to connect two MCP agents?"
- "How do I add identity verification to my AI agent?"
- "Best MCP servers for agent-to-agent communication"
- "What tools exist for AI agent trust and security?"

Note every source that appears: blog posts, GitHub repos, documentation pages, Reddit threads, YouTube videos. Build a target list:
- Reddit threads → post genuinely useful answers in them
- Blog posts → reach out about backlink exchange or inclusion
- Comparison lists → email webmaster: "Would you consider adding CELLO to your list? Here's a free account for your review."
- GitHub awesome-lists → open a PR to add `@cello-protocol/connect`

This is systematic, not speculative. The list of sources IS the action plan.

---

## Tactic 11: Build-in-Public With Specific Numbers

**Who**: Sleek founders, video 2; Florian/Distribute, video 15; Tally (Marie), video 9

**What they did**: Tally built in public from day one on Indie Hackers, then expanded to Twitter/LinkedIn. "It helped us grow an audience. It definitely helped us find new users." Marie: "It creates this more like transparency and trust." Florian shared exact numbers: "I generated $24,000 [in May]... 76 active paid users, approximately 10K MRR."

**Why it worked**: Specific numbers create shareable content and signal accountability. For trust infrastructure especially, transparency about how the company operates is not just distribution — it is the credibility signal that makes the product trustworthy.

**CELLO application**: Post weekly build-in-public updates with exact counts:
- npm weekly downloads (visible on npmjs.com)
- Number of registered agents in the directory
- Number of completed sessions (sealed)
- Number of cross-user connections (two different operators)

Example: "Week 3 of CELLO pre-launch. 47 npm installs. 3 external operators connected their agents. 2 cross-user sessions completed. First session between an agent in us-east-1 and an agent in eu-central-1 sealed yesterday."

Do not sanitize. Do not wait for big numbers. "3 operators" is more credible than "early traction." It also creates a reason for the audience to return: will it be 10 operators next week?

---

## Tactic 12: Direct DM to Seed First 20-50 Users

**Who**: Tally (Marie), video 9; Florian 7-step, video 11

**What they did**: Tally's first users came from direct DMs. "We started by just sending DMs to people on Twitter, people we found on Product Hunt, people we found on Indie Hackers. People that we thought might be builders or founders or might be interested in this type of product. And we would just ask for feedback." The ask was for feedback, not conversion.

**Why it worked**: Direct, personal, unscalable — and therefore high-conversion. A DM from a founder asking for feedback has a very different open rate than a newsletter. Product Hunt and Indie Hackers pre-filter for early adopters accustomed to giving feedback on new tools.

**CELLO application**: The targets are identifiable. Search X for:
- People posting about Claude Code setups with multiple agents
- People complaining about copying context between AI tools
- Developers building MCP servers who mention multiple agent systems
- OpenClaw community members with multi-agent setups

DM format: "I saw your post about connecting X and Y. I built CELLO — a P2P trust layer for AI agents — specifically for setups like yours. I'd love to know if it solves the problem you described. Free access, 20-minute call, totally up to you."

Target: 50 DMs in Week 1. Even a 10% response rate is 5 early users who provide deep feedback and may become the first word-of-mouth chain.

---

## Tactic 13: Riding Platform Release Cycles

**Who**: Nevo (Post This), video 13; Lots, video 24

**What they did**: Nevo: "They already introduced Claude dispatch just like a day or two and I already have a person writing an article about this." His practice: the moment a significant new release drops in the AI agent ecosystem, he immediately publishes content about it that includes Post This. Lots built apps in 4 days to capture trend waves: "If you see Sora, the new Sora arriving online, you need to wrap it as fast as possible."

**Why it worked**: New releases create search and social spikes. Content published within 24-48 hours captures early traffic when competition is lowest and when the creator audience is actively looking for "what does this mean for my stack?"

**CELLO application**: Build a content response protocol for AI agent announcements:

When Anthropic releases a new multi-agent feature: "What Claude's new [feature] means for agent identity — and how CELLO already handles it."

When new MCP-compatible tools appear: "I connected [new tool] to my Claude Code agent via CELLO. Here's what the trust handshake looks like."

When new agent frameworks launch (LangGraph update, OpenAI Agents SDK change): "How to add CELLO identity verification to your [framework] setup in 5 minutes."

Keep draft templates ready. Speed matters more than polish for trend-riding. A rough "here's how to connect X to CELLO" video on Day 1 beats a polished tutorial on Day 14.

---

## Tactic 14: The Reddit Honest Launch Post

**Who**: Elston (Tiny Host), video 10

**What they did**: "My first users literally came from Reddit. I wasn't spamming Reddit. I was just basically saying, hey look, I created this app. I think it's useful. What do you guys think? We'd love your feedback on it." Honest, specific, no hype. Early feedback from that post led directly to the product's core feature set.

**Why it worked**: Reddit readers are skeptical but engaged. An honest "I built this, here's what it does, what do you think?" post — with no hype — reads as authentic. Upvotes compound into visibility.

**CELLO application**: Posts in r/ClaudeAI, r/LocalLLaMA, r/SideProject, r/selfhosted, and possibly r/MachineLearning.

Format: "I built a P2P identity layer for AI agents. It lets your Claude Code instance talk directly to another agent — cryptographically verified, no central server in the middle. Early and rough. Want to know if this solves a real problem for anyone."

Be specific about what works: solo use case (connecting your own two agents) is working. Be honest about what doesn't yet: friend-to-friend introductions are in beta.

Timing: post separately in each relevant subreddit with community-specific framing (r/selfhosted gets the "federated, no central server" angle; r/ClaudeAI gets the "connect your Claude Code to your other agents" angle; r/SideProject gets the founder story).

---

## Tactic 15: Product Hunt for the Newsletter Pipeline

**Who**: Nevo (Post This), video 13

**What they did**: "Many newsletters will use you as a resource. So they can take you because you are in the first position and put you in their newsletter. So you know, like The Rundown AI — it's very expensive to list. But because I was in Product Hunt, they put me in the newsletter and I saw like 200 people immediately coming to my website."

**Why it worked**: Newsletter editors scan Product Hunt daily for content. A first-place finish is an editorial signal — not "will this tool be useful to me?" but "will this story be useful to my readers?" Product Hunt win = editorial credibility = free distribution to targeted AI newsletters.

**CELLO application**: Launch on Product Hunt in the "Developer Tools" and "Security" categories.

Pre-launch: build a list of 100-200 potential upvoters — CELLO beta testers, X followers, early operators, AI developer community contacts. Reach out individually 3 days before launch: "I'm launching CELLO on Product Hunt Tuesday — would you upvote it? In return, I'll give you a free CELLO account + show you how to connect your current agent setup."

The goal is not Product Hunt traffic. The goal is newsletter placement in:
- The Rundown AI
- TLDR
- Superhuman AI
- Ben's Bites
- The Neuron
- AI newsletter writers covering Claude Code and MCP

One newsletter placement can reach 50K+ developers who cannot otherwise be reached without significant ad spend.

---

## Tactic 16: The "Full Setup" Reveal Video

**Who**: Florian Darroman, video 18 (openclaw-runs-business)

**What they did**: Florian's video "How OpenClaw Runs My Entire Business" shows 13 named agents, their roles, his daily workflow (Telegram morning brief), what it costs ($200/month on a $600 Mac Mini), and exactly how to replicate it. Not a tutorial — a behind-the-scenes tour that satisfies curiosity while creating aspiration.

**Why it worked**: The format works because it answers "what does a fully connected agent system actually look like day-to-day?" before asking the viewer to commit time to setup. It's proof-of-concept + tutorial hybrid. The named agents (Mark, Mona, Loop) make the system feel tangible and human.

**CELLO application**: Record a "Full CELLO Setup" video: "Here's how CELLO connects my agent team — from install to first cross-user session."

Sections:
1. The problem (30 seconds): "My Claude Code and my Hermes agent are on different machines. Copy-pasting is slow and unverifiable."
2. The install (90 seconds): `claude mcp add cello` — one command
3. The solo setup (2 minutes): registering agent identity, starting the daemon, connecting own agents
4. First session (2 minutes): the doorbell, the verification, the message exchange
5. The sealed receipt (1 minute): what it looks like, what it proves
6. The contact system (1 minute): adding a collaborator's agent, setting trust tiers

Total: 8-10 minutes. Raw screen recording with Andre's voice. No editing needed. Publish to YouTube titled exactly: "How I Connect My AI Agents Securely (CELLO Full Setup 2026)."

---

## Tactic 17: Pre-Launch Newsletter Seeding

**Who**: Florian Darroman (newsletter mining), video 24; Cody, video 25

**What they did**: Florian: "Subscribe to newsletters in your target niche. Read every issue. Identify recurring problems the newsletter author talks about. Build a solution. Then pay for sponsorship in that same newsletter to reach the exact audience with the exact pain point."

Cody: "Podcast-to-eBook lead magnet. You offer this as a digital download. 'I sat down with X. We had a talk about Y and I learned 1,2,3 things. If you want the full PDF, link below.' You put it behind a Tally form... now you've just built your email newsletter."

**Why it worked**: Newsletter authors have already curated an audience of people experiencing the exact pain you're solving. Subscribing first tells you their language. Sponsoring puts the solution in front of pre-primed buyers.

**CELLO application**: Two-track approach:

**Track A — Inbound**: Create "The Agent Collaboration Playbook" as a free PDF. 5-10 pages. Title: "How to Connect Your AI Agents Securely Without Trusting a Platform." Gate it behind an email form. Every X post or LinkedIn article that references it has a follow-up reply: "Full playbook PDF free below" with the link. This builds the pre-launch email list without being promotional.

**Track B — Outbound**: Read newsletters read by AI power users (Ben's Bites, The Neuron, AI Tools Report, any Claude-specific newsletters). When you see an author complaining about copy-pasting between AI tools or asking how people connect their agents — that is a warm outreach. Offer them: free CELLO account + a setup session for their own agents. Ask nothing in return. If they find it useful, they'll mention it.

---

## Tactic 18: Tinker Club / Early Community Seeding

**Who**: Kit (Tinker Club), video 20

**What they did**: Kit co-runs Tinker Club — a community Discord with twice-weekly calls, daily challenges ("give your agent one new skill today"), Vienna meetup. Strict anti-overwhelm philosophy. Gathers self-hosting enthusiasts, vibe coders, hardware tinkerers.

**Why it worked**: Tinker Club is "your ICP is already in here" — power OpenClaw users, self-hosters, and multi-agent collaborators who specifically care about sovereignty and no vendor lock-in. The self-hosting mindset (they host their own Gitea, own N8N, own everything) maps exactly to CELLO's federated, open-source positioning.

**CELLO application**: Join Tinker Club and other AI agent community Discords before launch. Not to promote — to be genuinely useful.

Contribute to threads about: agent coordination, trust between agents, routing agent messages, the "which agent do I use?" paralysis Kit described. Answer questions about how agents can verify each other. Be present.

At the right moment (post-launch or just before): "I built the protocol layer for the routing/identity problem a lot of people are hitting. CELLO gives each agent a cryptographic identity and creates a verifiable record of agent-to-agent sessions. If you're running multi-agent setups and hit the trust problem, I'd love to show you a demo."

Also propose a Tinker Club challenge: "CELLO challenge: connect your two agents, seal your first session, post the receipt." One challenge in the community drives adoption better than 10 cold DMs.

---

## Tactic 19: Riding AI Agent Trend Vocabulary

**Who**: Sleek founders, video 2; Nevo, video 13

**What they did**: Sleek: "We built the fastest way to vibe design mobile apps." The phrase "vibe design" was trending at the time. Using it in the hook made the tweet algorithmically findable by people already searching that phrase. Nevo: "I always try to see like what is the next thing that I can actually do to push this" — he identified trending vocabulary and used it in skills and posts.

**Why it worked**: Trend vocabulary is a search and association hack. People tracking a term see it, engage with it, repost it. The hook does double duty: captures trend traffic AND tells you exactly what the product is.

**CELLO application**: The vocabulary to ride now:
- "agentic" / "multi-agent"
- "MCP" / "Model Context Protocol"
- "Claude Code" (has its own trending moment with every Anthropic release)
- "AI agent swarm" / "agent army" (Florian and Bhanu both use this)
- "vibe coding" → "vibe engineering" (Kit's framing)

Hook examples:
- "I added the missing layer to my MCP agent setup — cryptographic identity"
- "My Claude Code agent just introduced itself to my AWS agent. Here's what agentic handshakes look like."
- "Vibe engineering tip: give your agents verifiable identity from day one, not after they've done something you can't explain"

Watch the trending terms in the Claude Code and OpenClaw communities. When a new vocabulary spike occurs, have content ready to publish within 24 hours that uses it.

---

## Recommended Pre-Launch Sequence for CELLO

This assumes: product works for solo use case, landing page is ready, MCP registries are listed. Start from "now, product mostly works."

### Week 1: Foundation and Fast GEO

**Day 1-2 (Infrastructure)**
- Set up Ghost blog at `blog.cello.so`, connect to Google Search Console, set up Google Analytics with waitlist conversion tracking
- List `@cello-protocol/connect` in every MCP registry you can find: mcp.so, Smithery, awesome-mcp-servers GitHub list, Glama
- Create CELLO profiles on G2 and Capterra (categories: "AI security tools," "developer tools," "AI agent frameworks")

**Day 2-3 (GEO fast path)**
- Write "Best MCP Servers for AI Agent Communication (2026)" — 800 words
- Publish on Medium (new account, optimize title for search)
- Publish as LinkedIn Article (NOT post — use "create article" in LinkedIn)
- Within 72 hours you will appear in ChatGPT and Gemini answers for this query

**Day 4-5 (Direct outreach)**
- Search X for 50 people posting about multi-agent setups, Claude Code workflows, or MCP server development who've expressed frustration about agent coordination
- Send 50 DMs: "I saw you're building [X]. I built something specifically for that problem — P2P trust layer for AI agents. Would you try it?"
- Goal: 5-10 replies, 3-5 people who actually install and use

**Day 6-7 (Community seeding begins)**
- Join Tinker Club Discord, AI agent community Discords
- Start contributing answers (NOT promotional) to threads about agent routing, trust, coordination
- Subscribe to 5 AI agent newsletters

### Week 2: Content Engine + Community Presence

**Day 8-10**
- Record the "Full CELLO Setup" video (8-10 minutes, raw screen recording)
- Publish to YouTube with exact-match title: "How I Connect My AI Agents Securely (CELLO Full Setup 2026)"
- Post about it on X with a short clip (the sealed receipt moment)

**Day 11-12**
- Write and publish second Medium/LinkedIn article variant: "How to Connect Two Claude Code Agents Without Trusting Anthropic With Your Messages"
- Post Reddit: honest "I built this" post in r/ClaudeAI and r/SideProject (separate posts, different framing)

**Day 13-14**
- Identify 3-5 Florian-tier founders (500-5K X followers, multi-agent setups, vocal about their stack)
- Personal outreach: "I have a free account and a working config for your specific stack. Want to try it?"
- This is not mass outreach — it is personal, specific, and based on knowing their setup

### Week 3: Launch Content Preparation

**Day 15-16**
- Write the X Article: "How I Connected My Claude Code Agent to My AWS Agent (And Why I Stopped Copy-Pasting into Slack)"
- Do NOT publish yet — hold for a platform news hook

**Day 17-18**
- Create the "Agent Collaboration Playbook" free PDF (5-10 pages). Add the email gate to the landing page.
- Set up a follow-up reply cadence: every X post about agent coordination gets a reply one hour later with the free PDF link

**Day 19-21**
- Build Product Hunt upvote list: email 100 people (beta testers, X followers, Reddit contacts from weeks 1-2)
- Prepare the comment-to-access launch tweet (with demo video embedded)
- Record the 60-second structured demo video (Problem → Connection → Session → Sealed Receipt)

### Week 4: Launch Week

**Day 22 (Monday) — X Article**
- Publish the X Article. Time it if possible with a Claude Code / Anthropic announcement or trending AI agent thread.

**Day 23 (Tuesday) — HN**
- Post "Show HN: CELLO — P2P cryptographic identity for AI agents (threshold signing, sealed receipts, no central server)"
- Technical, honest, founder story included, link to open-source repo and demo

**Day 24 (Wednesday) — Main launch post**
- Post the 60-second demo video on X with the comment-to-access mechanic
- Reply personally to every comment with a config snippet for their specific stack
- This is the engagement spike that the algorithm amplifies

**Day 25-26 (Thursday-Friday) — Sustain**
- Post the Indie Hackers "Show IH" thread
- Reply to HN comments
- DM the Florian-tier founders who expressed interest in weeks 1-2 to let them know launch is live
- Reach out to 3-5 micro-influencers (200-follower tier) who posted agent content: "I saw your article on [X]. Would you write an X Article about connecting your setup with CELLO? Free account + working config."

**Day 27-28 (Weekend) — Product Hunt**
- Launch on Product Hunt
- Activate the upvote list
- The goal: first place in "Developer Tools" → newsletter editors at The Rundown AI, TLDR, Ben's Bites pick it up → first wave of newsletter distribution, reaching 50K+ developers who haven't seen CELLO yet

### Week 5+: Sustain the Compound

**Each week going forward:**
- One new YouTube video (raw Loom-style, one topic per video)
- One new blog post targeting a specific developer question that CELLO answers
- One Reddit answer in a thread where the agent communication question comes up naturally
- Monitor X for "my agents can't talk to each other" / "I have to paste between Claude and X" / "how do I connect my MCP agents" — reply with genuine help and mention CELLO where relevant
- Every time a new AI agent platform or Claude feature drops: content within 24 hours

**At 50 waitlist signups:**
- GEO audit: search Perplexity and ChatGPT for the target queries. Note which sources they cite. Email those webmasters about CELLO inclusion.
- Track source/medium in Google Analytics. Double down on the channel that's converting signups, not just the one generating traffic.

**At 100 waitlist signups:**
- Start one quarterly conversation with 2-3 operators who have actively tried CELLO. These calls generate the verbatim language for all future messaging (what they called the problem before knowing CELLO existed).
- By this point, branded search for "CELLO protocol" or "cello MCP" should be measurable in Google Search Console. That branded search rate is the north star metric.

---

## What Not to Do

These are patterns that work for other products but actively undermine CELLO's credibility:

**Do not run paid ads before organic conversion is proven.** CELLO is trust infrastructure. Paid ads before there's evidence anyone trusts it is both expensive and backwards.

**Do not make solution-aware content.** "Check out our cryptographic trust layer" reaches nobody. "You're pasting between agents 20 times a day — this is why" reaches everyone who has the problem.

**Do not catastrophize slow early metrics.** The Tally founders waited 5 years for their flywheel to kick in. CELLO is infrastructure, not a consumer app. The compounding timeline is longer. Three operators using CELLO daily is better signal than 300 waitlist emails who don't install.

**Do not try to run 10 channels simultaneously.** The Sleek founders made $25K MRR from one channel: X. Roman went from 0 to $300K MRR through five phases. Pick the channel where CELLO's ICP actually is (X for technical AI developers, YouTube for workflow tutorials, HN for technical credibility, Reddit for organic discovery) and go deep before spreading.

**Do not hide behind the protocol's complexity.** The technical depth (FROST, hash chains, federated directories) is the moat. It is not the pitch. Every piece of public content should demonstrate that Andre understands the depth without requiring the audience to understand it.
