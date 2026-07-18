---
founder: Youssef
company: Scalelist (B2B SaaS) / Scale Lab (agency, sold)
stage: $22.5K MRR at time of LinkedIn cease-and-desist; post-pivot and post-Tiny Seed raise at time of recording
date: unknown
---

Youssef is the CEO and co-founder of Scalelist, a B2B SaaS that provides contact data (emails, phone numbers) and an MCP server for AI-native access to that data. He and his co-founder Arnaud built Scale Lab, a cold outbound lead-generation agency, to roughly $750–800K/year in revenue before productizing the internal tooling they had built to run the agency into Scalelist. Both founders are non-technical — they found a technical co-founder through an Indie Hackers post and later raised from Tiny Seed in January 2025. Four months after raising, LinkedIn issued a cease-and-desist that threatened 100% of their revenue overnight at $22.5K MRR, forcing a full pivot away from LinkedIn data extraction toward being a broader email/phone data API and MCP provider. This interview covers the agency-to-SaaS transition playbook, how YouTube became 50% of their customer acquisition, and how they survived a platform-risk wipeout mid-growth.

# GTM Tactics: "I Sold My $800K/Year Agency to Go All-In on My SaaS"
Source: https://youtu.be/_IXeM651Jj8
Channel: Florian Darroman (@asyncr0ne)

---

**[Agency-to-SaaS problem discovery]**
- **What they did**: Youssef ran a lead-generation agency (Scale Lab) and consistently saw the same operational problem across dozens of client companies — building contact lists manually was slow, error-prone, and had no solution for finding verified emails/phone numbers after extracting a LinkedIn list. He built a tool internally to solve it, then productized it. "As an agency, you see one specific problem throughout several companies, and you solve that."
- **Why it worked**: The founder had lived the pain himself, validated it in production at scale with paying clients, and already had a partially-working internal solution before writing a line of product code. No cold-start validation risk.
- **CELLO application**: Andre has lived the pain of connecting his own agents (Hermes ↔ Claude Code) and hit the absence of a trustworthy P2P identity layer. That direct founder-as-first-user credibility is a distribution asset. In early content and cold outreach, the opener is "I built this because I needed it for my own agents" — not a hypothesis, a fact. Show the actual sessions.
- **Category**: `prerequisite`

---

**[Indie Hackers co-founder recruitment post]**
- **What they did**: Non-technical founder Youssef posted on Indie Hackers explaining their situation — they had the problem, the partial internal solution, and the sales/distribution skill, but not the technical build capability. Framed the post as: "we need someone who can build it; you build, we sell." Got several responses; landed a co-founder that way.
- **Why it worked**: Indie Hackers is populated with technical founders who are looking for exactly this complementary pairing. The framing was honest about what each side brought, which pre-filtered for motivated builders rather than generalist freelancers.
- **CELLO application**: CELLO's open-source client (`cello-client`) is already public. A post on Indie Hackers or Hacker News framed as "open protocol for agent-to-agent trust — already working, looking for operators who want to plug in" could surface early adopters, integration contributors, or even a technical advocate who becomes a long-term evangelist. The code is already on GitHub — the post just has to point there with a concrete use case.
- **Category**: `community`

---

**[Do not evaluate the channel before giving it enough time]**
- **What they did**: Scalelist sat at ~$1,000–$1,500 MRR for about a year and three months with near-zero growth before YouTube cracked. Youssef kept going through that period rather than shutting down or pivoting away from the channel too early.
- **Why it worked**: Content channels have a compounding lag. The first several videos are audience-building, not revenue-generating. Evaluating within a single quarter would have produced a false negative.
- **CELLO application**: CELLO's developer-focused content (tutorials, walkthroughs, "connect two agents in 10 minutes") will have the same lag. The first post that gets zero traction is still building the corpus that gets indexed. Commit to a minimum 3-month window before concluding a distribution channel is not working.
- **Category**: `prerequisite`

---

**[YouTube keyword gap research before recording anything]**
- **What they did**: Before posting a single video, Youssef searched YouTube for the exact keywords his target users would type. "How to export leads from LinkedIn Sales Navigator" — "there was barely any video about it." He confirmed demand (people searching) plus supply gap (almost no competition) before investing time. Used VidIQ for keyword research.
- **Why it worked**: Keyword gap = search demand exists, no content serves it. Every video made on that gap captures a pool of warm, intent-driven viewers who are actively looking for a solution.
- **CELLO application**: Run VidIQ (or YouTube's autocomplete) on terms the CELLO audience would search: "how to connect two AI agents", "agent to agent authentication", "MCP server trust", "Claude Code connect to remote agent", "AI agent identity layer", "how to call my own AI agent from Claude Code". If there are few or no videos for these exact queries, CELLO is in the same position Scalelist was. Confirm gap before committing to a recording cadence.
- **Category**: `seo-geo`

---

**[Worst-mic Loom video outperformed polished production]**
- **What they did**: Youssef's single best-performing video in 2024 — 10,000 views — was a 3-minute Loom recording made with earphone mic at his girlfriend's apartment in Taiwan. No studio setup. No editing. Just the right topic, a decent thumbnail, and a clear walkthrough. "The best-performing video was a simple room with the worst mic I have ever had in my life."
- **Why it worked**: Developer/technical audiences care about signal, not production value. They want to see the product work, not watch a polished advertisement. Low-friction production removes the activation energy barrier to posting consistently.
- **CELLO application**: The first CELLO demos should be screen recordings showing actual agent sessions: open terminal, run `cello_start_agent`, connect to a second agent, exchange a sealed message, pull the inclusion proof. No intro sequence, no background music. Title it exactly the keyword — "Connect two Claude Code agents in under 5 minutes." The rawness signals authenticity, which is critical for a trust-infrastructure product.
- **Category**: `content-format`

---

**[Short format: trim to the minimum steps that deliver value]**
- **What they did**: "I focus often times on shorter is better than longer. Same for like cold emails. People want to say everything. It's too much. Like don't just to simplify, make it easy." Videos show exactly the steps needed to reach the value — not promotional framing, not company backstory.
- **Why it worked**: Technical users have zero patience for preamble. A 3-minute video that shows the exact steps has a higher completion rate, higher share rate, and higher conversion rate than a 12-minute video covering the same ground with filler.
- **CELLO application**: CELLO demos should be minimum-viable walkthroughs. One video = one job to be done. "Install CELLO" = one video. "Add a contact and promote them to whitelisted" = one video. "Get a sealed receipt" = one video. Never combine them into a feature tour. The sealed receipt video is 90 seconds of "here is the session, here is the seal command, here is the receipt object." Nothing else.
- **Category**: `content-format`

---

**[Be the persona you are making the video for]**
- **What they did**: "I'm you basically. I'm the persona that I'm doing the video for. The starting point is: you have made this search on LinkedIn and there's 10,000 people. How do you pull them out?" Every video is framed from the viewer's situation, not the product's features.
- **Why it worked**: Viewer-centric framing reduces cognitive distance. The viewer recognizes their own problem in the first 10 seconds. The solution then feels like discovery, not a sales pitch.
- **CELLO application**: Every CELLO video title and opening line starts with the viewer's situation: "You've got two agents — Claude Code on your laptop and a second agent running on a server — and they can't talk to each other securely." NOT "CELLO is a P2P identity layer for AI agents." The problem first. The product is the answer, not the subject.
- **Category**: `content-format`

---

**[Non-promotional, tutorial-first framing]**
- **What they did**: Youssef explicitly frames the content philosophy as non-promotional. Not "I do this, my business does that" — but a pure how-to that shows the steps. "It's not promotional. It's not saying I do this or my business does that."
- **Why it worked**: Developer audiences actively resist promotional content. Tutorial-first framing builds trust and gets bookmarked/shared by practitioners who found it genuinely useful. Those shares bring qualified viewers, not random traffic.
- **CELLO application**: CELLO's tutorials must never mention "check out CELLO" or "sign up for our waitlist" in the body of the video. The product simply appears as the tool used to accomplish the task. The link in the description does the selling. The video earns trust by being genuinely useful.
- **Category**: `content-format`

---

**[One video per week: consistency as the moat]**
- **What they did**: "One video a week as a rhythm. Like everything you have to have consistency as well, otherwise it doesn't pick up."
- **Why it worked**: YouTube's algorithm rewards channels with regular upload cadence. Consistency also builds a corpus — a viewer who finds one video and finds five more on related topics is far more likely to subscribe and convert than a viewer who finds a single video.
- **CELLO application**: One CELLO video per week is the target cadence. The corpus is pre-mapped (install, connect agents, contacts, sessions, sealed receipts, endorsements, trust signals, GEO positioning, etc.) — that is already 8+ videos before needing new ideas. Shoot several in one session to maintain a queue during busy implementation sprints.
- **Category**: `ongoing-distribution`

---

**[YouTube as durable SEO asset (shelf-life vs. LinkedIn posts)]**
- **What they did**: Youssef compared LinkedIn post shelf life (~1-2 days) to YouTube video longevity. LinkedIn required constant new content to maintain visibility; YouTube videos kept getting found for months or years. "The shelf life is maybe 1 2 days max. So, you constantly get a post and often times you post the same thing."
- **Why it worked**: YouTube videos are indexed by both YouTube search and Google search. A video posted in January still appears in results in November. The compound interest effect on distribution effort is fundamentally different from social media.
- **CELLO application**: CELLO's audience (developers evaluating agent frameworks and security layers) is searching, not scrolling. They type a query when they have a problem. YouTube/Google search is the right distribution channel for that intent-driven audience. LinkedIn or X posting is secondary and only worth doing to amplify the YouTube content.
- **Category**: `seo-geo`

---

**[YouTube helps organic Google ranking]**
- **What they did**: "As you said, like YouTube helps for your SEO as well. A lot of searches I consume personally content on video. Like, whatever I have a problem with, I will most often look at videos. And I find them also in either now the Gemini overview or the Google overview or in suggested content, too."
- **Why it worked**: Google increasingly surfaces YouTube videos in search results (especially for how-to queries), and Gemini's AI overviews also pull from YouTube content. One video gets indexed in multiple surfaces simultaneously.
- **CELLO application**: Directly relevant to CELLO's GEO ambition. A video titled "How to connect two AI agents securely" that ranks on YouTube also increases the probability that ChatGPT, Gemini, and Perplexity surface CELLO when someone asks "how do agents communicate securely?" The transcript of the video is crawlable text. The title and description are indexable keywords. YouTube IS SEO for developer tools.
- **Category**: `seo-geo`

---

**[YouTube video quality: improve incrementally, don't wait for perfection]**
- **What they did**: "Our first every videos were not edited. Literally, it was a Loom video just posted. It worked. Just as we grew we thought, 'Okay, maybe we should invest a bit more in the quality of our video cuz now that it makes sense.' Then we got an editor."
- **Why it worked**: Waiting for production quality to start is a form of procrastination that costs months of compounding distribution. The feedback loop from unedited videos tells you which topics actually resonate before you invest in production.
- **CELLO application**: Start with unedited screen recordings. Use Tella (tella.tv) or Loom. When one video reaches 500+ views, that is the signal to invest in a thumbnail, better audio, and light editing on the next one. Do not invest in production before having evidence of demand.
- **Category**: `launch-tactic`

---

**[Use Tella over Loom for screen-share recordings]**
- **What they did**: "We use Tella, tella.tv. I like the way their app is done. You can split different sections in your video so two different takes, you can move them around as well, which you can't really do on Loom."
- **Why it worked**: Tella allows rough-cut editing within the recording interface — cut out the pauses and restarts without needing a separate editing step. Reduces the time cost of each video, which is the real barrier to consistency.
- **CELLO application**: Use Tella for CELLO demos. The ability to clip sections without opening an editor removes the friction that causes the backlog of "recordings I need to edit before posting."
- **Category**: `content-format`

---

**[Hire a channel operator when volume exceeds solo capacity]**
- **What they did**: Once the channel needed to scale and both founders were occupied with the product pivot, Youssef hired a "full-time head of YouTube" — his wife, who had prior YouTube marketing experience — to manage the channel. "We hired a full-time head of YouTube to manage completely our channel."
- **Why it worked**: The channel had become a proven acquisition asset generating 50% of new customers. Underinvesting in it at that point was the wrong call. A dedicated person maintains cadence and frees the founder to focus on product and sales.
- **CELLO application**: Initially Andre runs the channel solo. When CELLO's channel starts driving meaningful waitlist signups (even a handful per week), consider whether a video editor or a part-time content operator would multiply output. The constraint is not money — it is founder time.
- **Category**: `ongoing-distribution`

---

**[Double down on the channel that works; don't diversify prematurely]**
- **What they did**: "As soon as we found a channel, let's double down on it. So, we found YouTube. We didn't know that we would find a channel. For about a year and a few months, we were doing YouTube only, no SEO at all." Only after YouTube was working did they add SEO as a second channel.
- **Why it worked**: Spreading effort across five channels before any one works means none get enough investment to show compounding returns. A single channel run hard long enough builds momentum that is difficult for competitors to replicate.
- **CELLO application**: Try two channels (YouTube + one written content channel, e.g. dev.to or a personal technical blog). When one shows a clear signal — more waitlist signups, more GitHub stars per post, more organic search traffic — go deep on that one exclusively before adding the next.
- **Category**: `ongoing-distribution`

---

**[Outbound does not work for low-ticket developer tools with many incumbents]**
- **What they did**: Youssef tried cold email and LinkedIn outbound to sell Scalelist and got almost zero results. "We probably had one sale out of all of the outbound we've done." He explains: outbound works at $10K+ deal sizes, where the economics justify a prospect's time. For a product with many known competitors, prospects are already receiving emails from those competitors and have learned to ignore the category.
- **Why it worked (in reverse)**: Understanding why outbound failed saved them from continuing to invest in a zero-ROI channel.
- **CELLO application**: Cold outbound to AI developers is not the right first channel for CELLO. Developers who need agent-to-agent identity either (a) are actively searching for it (YouTube/SEO serves them), or (b) are not aware they need it (content and community builds that awareness). Cold email to "your company might want agent identity" will be ignored. Inbound and community are the correct channels.
- **Category**: `prerequisite`

---

**[Platform risk: never build 100% on a single platform's data/API]**
- **What they did**: Scalelist was 100% dependent on LinkedIn data extraction. LinkedIn issued a cease-and-desist in 2025 and threatened all their marketing, all their positioning, and all their revenue overnight. "100% of our revenue was now all of a sudden threatened overnight."
- **Why it worked (in reverse)**: The lesson is that a business that depends entirely on one platform's continued tolerance is not a durable business.
- **CELLO application**: CELLO's distribution must not depend on any single platform. Specifically: if GitHub were to de-list `cello-client`, or if npm were to remove `@cello-protocol/connect`, or if MCP were to change its protocol in a breaking way, CELLO needs to have alternative install and discovery paths. Federated directories ARE the platform-risk hedge at the protocol level — carry that same logic into distribution. No single source of 50%+ of installs without a fallback.
- **Category**: `prerequisite`

---

**[MRR channel attribution tracking: know your conversion rate per channel]**
- **What they did**: Youssef tracked that every ~250-300 YouTube views converted to roughly one paid customer (against a $750 LTV). "We know that every time we make about 250 or 300 views, approximate this is our conversion rate to one paid customer."
- **Why it worked**: With per-channel conversion data, you can make investment decisions by unit economics rather than vanity metrics. Knowing the YouTube conversion rate made it obvious that investing in YouTube to get more views was directly profitable, even at modest view counts.
- **CELLO application**: Track every waitlist signup with source attribution (UTM parameters). Know whether the June batch came from a YouTube video, an HN post, a product hunt launch, or a blog post. Within 6 months, calculate the conversion rate per channel. That is the number that should drive where to spend the next 10 hours of distribution work.
- **Category**: `prerequisite`

---

**[The pivot as a reset: redesign marketing, positioning, AND onboarding together]**
- **What they did**: When forced to pivot away from LinkedIn extraction, Youssef realized he had to change all three layers simultaneously: marketing (what people see before signup), positioning (what the website says), and onboarding (what new users experience first). Changing only the positioning while old marketing videos were still sending traffic caused chaos — users signed up expecting the old product and hit the new one. "We had to shift first our positioning... and then the onboarding."
- **Why it worked (lesson)**: Marketing → positioning → onboarding is a funnel. A mismatch at any joint breaks conversion and creates support noise.
- **CELLO application**: For CELLO's beta launch, align all three before opening signups: the YouTube/blog content describes the actual product available at launch, the landing page confirms it, and the first-run experience delivers it. If the install flow changes (e.g. new MCP setup command), update the video and landing page the same day. A stale tutorial driving traffic to an install flow that no longer matches is the fastest way to create a bad first impression with developer evaluators.
- **Category**: `launch-tactic`

---

**[Seeking investors who are mentors, not overseers]**
- **What they did**: Youssef chose Tiny Seed (B2B SaaS accelerator, early-stage, founder-friendly) over larger or more controlling investment. When the LinkedIn crisis hit, Tiny Seed's team (Rob Walling, co-founder Einar) took personal calls with both founders, provided actionable advice, and gave long-horizon counsel: "If you're shifting to something else, you're in it for at least another 5 years. Make sure that whatever you choose is something you want to do for the next 5 years." No blame, no directives.
- **Why it worked**: The right investor relationship provides strategic leverage — networks, advice, pattern-matched counsel — without the control overhead that slows down a two-person team moving fast.
- **CELLO application**: If CELLO raises, Tiny Seed is the name-checked model (and a live option given CELLO's profile: bootstrapped, B2B, solo technical founder with a working product). The selection criterion is: "Will this investor's network and counsel be worth the reporting overhead?" Not just "who will give us money."
- **Category**: `partnership`

---

**[MCP server as distribution channel and moat]**
- **What they did**: Scalelist built an MCP server so that AI agents (Claude, ChatGPT) can query their email/phone database directly without the user logging into a UI. "You can just drop your list of 10,000 people if you want on Claude and Claude will find the emails but through our infrastructure." Youssef explicitly frames MCP as a new distribution surface: product-led through AI-native access.
- **Why it worked**: Operators using Claude Code or another LLM-native tool find Scalelist's MCP through the MCP registry/marketplace rather than Google. It is a new discovery channel that most traditional SaaS products have not yet occupied.
- **CELLO application**: CELLO IS an MCP server — this is its native distribution surface. But the lesson is that the MCP server itself should be listed in every MCP registry and discovery surface (mcp.so, Claude's MCP directory, any "awesome-mcp" list). Every GitHub repo doing multi-agent Claude Code work is a potential organic installer. Maintaining a well-maintained MCP README with clear tool descriptions, install one-liners, and a "verified working" badge is the MCP equivalent of YouTube SEO.
- **Category**: `product-led-growth`

---

**[Data compliance as a B2B sales filter and moat]**
- **What they did**: Youssef deliberately invested in GDPR/CCPA compliance while most smaller competitors cut that corner. When larger enterprise customers asked about compliance during sales conversations, they would disqualify competitors who couldn't answer. "We sign deals through that." He called it becoming a "data compliance nerd" — explicitly framing it as a moat.
- **Why it worked**: Compliance is a high fixed-cost investment that small competitors avoid. Once you have it, it becomes a sales accelerator in enterprise deals and a natural filter that routes compliance-sensitive customers to you.
- **CELLO application**: CELLO's cryptographic architecture IS the compliance story. Tamper-evident hash chains, sealed receipts, threshold signing, and the absence of central message storage are the answers to the enterprise security questionnaire. Making this compliance story legible — SOC2-adjacent language, clear data-flow documentation, the "no central server reads your messages" guarantee in writing — converts a security feature into a sales accelerator, particularly for regulated-industry customers (fintech, healthcare, legal) who are deploying AI agents on sensitive workflows.
- **Category**: `product-led-growth`

---

**[YouTube + SEO compound effect: video transcripts are indexable text]**
- **What they did**: Even without a deliberate SEO strategy, Scalelist's YouTube content helped their Google ranking because YouTube video transcripts and titles are crawlable. Their SEO position improved passively while they were only investing in YouTube.
- **Why it worked**: YouTube auto-generates transcripts. Google indexes them. A video titled "How to export leads from LinkedIn Sales Navigator" effectively created an SEO-positioned page without any separate blog post effort.
- **CELLO application**: Add closed captions and accurate transcripts to every CELLO video. Transcripts are the SEO value of the video. Also: repurpose each video's transcript as a written tutorial (with screenshots) on the CELLO docs site or a blog. One recording session becomes both a video and a written article — two indexed assets, one investment.
- **Category**: `seo-geo`

---

**[Run the channel that works before adding paid promotion]**
- **What they did**: Scalelist did YouTube exclusively for over a year with zero paid advertising. Only when the channel had proven organic traction did they start considering using ads to amplify specific videos (not to buy cold traffic, but to extend reach of already-working content).
- **Why it worked**: Ads amplifying organic content that is already converting is very different from ads as the primary acquisition driver. The former has a known conversion rate to optimize against; the latter requires expensive testing.
- **CELLO application**: Do not run ads for CELLO until a piece of content (video, blog post, GitHub README section) has demonstrated organic conversion. The first paid dollar should amplify a specific video that is already converting developers to waitlist signups. Not before.
- **Category**: `launch-tactic`

---

**[Positioning, marketing, and onboarding must match at every pivot]**
- **What they did**: After the LinkedIn cease-and-desist, Scalelist's best-performing video was still titled "how to export leads from LinkedIn Sales Navigator" — so users clicked, watched, signed up for a product that no longer did that thing, and hit the support chat confused. Arno was "in charge of it at the time" and it "was just going crazy." The fix was updating marketing, positioning, and onboarding simultaneously.
- **Why it worked (lesson)**: This is a cautionary tale about the lag between content distribution and product state.
- **CELLO application**: When CELLO's feature set changes (e.g. endorsements ship, or the install command changes), update the demo video, the landing page copy, and the first-run docs within the same week. Never let the oldest video describing the product stay as the #1 ranked result if it describes behavior that no longer exists.
- **Category**: `launch-tactic`

---

**[The "infrastructure as a service" reframe for AI-native products]**
- **What they did**: Youssef explicitly articulated a thesis: "Your UI is not going to matter anymore. If you don't have a SaaS that is an infrastructure, software as a service today — if software is taken by another interface, which is your chat, in the end, you have to build an infrastructure as a service." He used Scalelist's MCP server as the proof point — users access their email data through Claude, not through a UI.
- **Why it worked**: This is not just positioning — it is a product strategy that opens a different buyer category. Instead of selling to individual users (UI-first), they sell to developers and platform operators who integrate the infrastructure into their own agents or tools.
- **CELLO application**: This is CELLO's exact strategic position. CELLO is identity and trust infrastructure for agent communication — not a UI product. The positioning language should explicitly use "infrastructure" rather than "tool" or "app." On the landing page, in conference talks, in content: "CELLO is the identity infrastructure your agents run on." That frame opens doors to platform partnerships (agent framework developers, enterprise IT teams, AI platforms), not just individual developers.
- **Category**: `prerequisite`

---

**[Hike → insight loop: unstructured thinking time as a decision-making tool]**
- **What they did**: Youssef made the decision to hire his wife as head of YouTube "on a walk on my own one day — like on this lot of nature. I love to hike and think. And I thought actually live with the person we need to hire."
- **Why it worked**: This is not a replicable tactic but a meta-observation about solo founder decision-making. The best decisions came from stepping away from the screen, not from more analysis.
- **CELLO application**: Indirect inspiration. The GTM and positioning decisions for CELLO are not going to come from more roadmap documents — they are going to come from live conversations with developers who try the product, and from reflection time when Andre is not in the code. Build in deliberate reflection loops: after each content piece, after each beta user signs up, after each conversation where someone says "I don't get it."
- **Category**: `prerequisite`

---

## Foundations / Prerequisites

Before any distribution activity scales, CELLO must have these figured out:

**1. Single clear wedge use case with a working 5-minute demo.**
The agency-to-SaaS transition worked because the problem was already solved internally. CELLO's solo multi-agent use case ("connect your own Claude Code agent to your Hermes AWS agent") must be completable in under 5 minutes by a developer who has never heard of CELLO. The demo video cannot be recorded until this is true.

**2. Confirmed keyword gap on YouTube and Google.**
Before recording any video, run VidIQ and YouTube autocomplete on 10-15 candidate queries ("connect two AI agents", "agent to agent authentication", "MCP identity layer", "AI agent P2P communication", etc.). If there is near-zero competition on one or more of those queries, start there. If there is heavy competition, find the adjacent under-served query.

**3. Aligned marketing → positioning → onboarding funnel.**
The first video title, the landing page headline, and the install experience must describe the same product at the same fidelity. A developer who clicks a YouTube link titled "connect two Claude Code agents" must see a landing page that says exactly that, and an install flow that achieves exactly that in under 10 minutes.

**4. Source attribution on every signup.**
Before opening the waitlist, add UTM tracking to every link. Know which piece of content is driving signups. Without this, doubling down on the right channel is impossible.

**5. Compliance and trust story documented.**
CELLO's cryptographic guarantees (tamper-evident hash chains, threshold signing, no central read access) are the answer to the enterprise security questionnaire. Write these as a clear one-pager before approaching any enterprise buyer or developer community where compliance questions will arise.

**6. Platform-risk mitigation in distribution.**
No single source should provide more than 50% of installs without a fallback plan. Document alternative install paths (direct npm, GitHub releases, the federated directory's own onboarding flow) before YouTube or any single channel becomes dominant.

**7. Clear answer to "what do I get that I can't build myself in a weekend?"**
The threshold signing, FROST ceremony, tamper-evident hash chains, and multi-region federated directory are the real answers. Every piece of content should make that delta visceral and concrete — not as a feature list, but as a scenario: "Without CELLO, a compromised agent can silently impersonate the real one. With CELLO, that is cryptographically impossible because..." That sentence has to be ready before any distribution begins.
