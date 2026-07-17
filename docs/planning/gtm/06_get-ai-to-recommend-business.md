# GTM Tactics: "How to Get AI to Recommend Your Business"
Source: https://youtu.be/SeIk6owE5LM
Channel: Florian Darroman (@asyncr0ne)
Guest: Tanya (rankingonai.com) — SEO and AI visibility for SaaS (cal.com, Suno, Asana, YC-backed companies)

---

## Tactic 1: Bottom-of-Funnel (BOFU) Content as the Core Unit

**What they did**: Tanya frames all content strategy around bottom-of-funnel queries — not informational ("what is X?") but comparison, listicle, and buying-guide queries. "Best [category] tools", "[tool A] vs [tool B]", "[category] buying guide". These are the queries where a user already knows they want to buy and is choosing. *"Bottom of funnel content just means that you go and search for something that is a comparison or a listicle. It's basically when you already know that you want to buy as a user, what are you going to search for? And typically, you're going to search for best of."*

**Why it works**: There is a 63% overlap between ChatGPT citation sources and Google's first-page results. Ranking for BOFU queries on Google simultaneously gets you cited by LLMs. You kill two birds with one stone. Informational queries are dead — LLMs answer them inline, users never click through. BOFU queries still drive clicks and conversions.

**CELLO application**:
- Write articles titled: "Best AI agent communication tools", "Best MCP servers for agent identity", "Agent-to-agent messaging: CELLO vs. raw HTTP", "AI agent trust and security tools — 2026 guide", "How to connect two Claude Code agents securely", "Multi-agent orchestration security — a buying guide"
- Target the comparison angle specifically: "CELLO vs. building your own agent auth layer", "Signed agent messages: CELLO vs. no signing"
- These articles should live on the CELLO blog (blog.cello.so or similar) and explicitly recommend CELLO as the solution

**Category**: `seo-geo`

---

## Tactic 2: LLM-Powered Keyword Discovery from Landing Page

**What they did**: *"Go and copy paste your landing page, copy your landing page, just copy all, paste it in Claude and say, 'What are some bottom of funnel or bofu keywords that people may be looking for. Listicles, comparison content.' Put it into Claude, paste in your landing page, see what it says. It's probably going to give you like 100 different keywords or more. Ask it for the five or 10 best that could be relevant."*

Then extend: *"Go and ask Claude, turn these also into AI visibility prompts and also create me a content brief for every single one."*

**Why it works**: Your own landing page copy encodes the product's value proposition and differentiators. Feeding it to an LLM surfaces the BOFU keywords a prospect would use when already primed to buy something like your product — without needing expensive keyword tools.

**CELLO application**:
- Paste the CELLO landing page into Claude, ask for BOFU keywords + AI visibility prompts + content briefs
- Seed queries to look for: agent identity, peer-to-peer agent messaging, FROST threshold signing for agents, MCP security, prompt injection defense, tamper-evident agent transcripts, cryptographic agent receipts
- Generate content briefs for the top 10–15. These become the editorial calendar.

**Category**: `prerequisite`

---

## Tactic 3: Install a CMS (Ghost / Payload) — Non-Negotiable First Step

**What they did**: *"The first thing you want to do is go and set up a CMS. How to set up your CMS? The cheapest one as far as I know is Ghost. Use Ghost. Ghost is super easy to use. Ghost will be able to have your website hosted on like blog.yourdomain.com. Perfect. It starts free and then I think it's like $15 or something per month."* For more mature sites: Payload CMS (has great MCP setup).

**Why it works**: *"Any LLM is going to go and look at your website first. So, if somebody asks something about your company... Do you want to talk about that from your own website or do you want somebody else to talk about that? It's really important for you to control that narrative."* Without a CMS you have no canonical home for BOFU content and no indexed source for LLMs to cite.

**CELLO application**:
- Set up a blog at blog.cello.so (or docs.cello.so/blog) using Ghost or Payload
- This is the content hub — every BOFU article, every comparison, every technical explainer lives here
- The CMS does not need to be customer-facing in a flashy way — its primary audience is LLMs and search crawlers

**Category**: `prerequisite`

---

## Tactic 4: Google Search Console — Index Every Post Immediately

**What they did**: *"Publish it, make sure that that content is indexed. The way that you do that is by going to Google Search Console. Connect it to your website, and start making sure that your blog is entirely indexed."*

**Why it works**: Unindexed content doesn't exist to search engines or LLMs. Indexing is a prerequisite for any organic discovery.

**CELLO application**:
- Connect blog.cello.so to Google Search Console immediately on launch
- After every article publish, submit the URL for indexing via Search Console
- Monitor which CELLO articles are getting impressions — those signal which topics the market is searching

**Category**: `prerequisite`

---

## Tactic 5: E-E-A-T Signals — Author Bio, Name, Image, Authority Arguments

**What they did**: *"Make sure your blog is trustworthy... make sure that your blog has something set up that is your author name, as well as an author bio, and even an image. The reason that that works is because Google and a lot of LLMs even prioritize very heavily that you have trust built in. They call that E-E-A-T."*

And: *"In your blog... add in things like authority arguments, big clients that you've worked with, big numbers, why should someone use your tool and not another one... ChatGPT in particular really cares about authority arguments. So, if you have any name recognizable brands that you've worked with... go and put that in your content as well. Don't add them only as images, because they don't get picked up as well."*

**Why it works**: LLMs and Google both use trust signals to decide which sources to surface. Named authors with credentials, real company associations, and recognizable customer logos signal that content is authoritative — not AI slop. The authority argument matters especially for ChatGPT.

**CELLO application**:
- Andre should be the named author on every article with a short bio: "Andre Pemmelaar, founder of CELLO — a cryptographic identity and trust layer for AI agents. Previously..."
- In articles, explicitly name who uses CELLO. Even early adopters ("built for teams running Claude Code, Hermes, and Codex agents in production")
- Include logos of known MCP-compatible tools in the article body (text form, not just images)
- Add authority claims: "cryptographic protocols from RFC 8032 (Ed25519) and RFC 9591 (FROST)", "federated directory nodes across us-east-1, eu-central-1, ap-northeast-1", "tamper-evident hash chains"

**Category**: `seo-geo`

---

## Tactic 6: Basic On-Page SEO — Meta Title, Description, Schema, FAQ Schema

**What they did**: *"You maybe want to do a little bit of very basic SEO optimization... that's going to be like meta title, meta description, having good images, adding schema markup, adding FAQ, and adding FAQ schema markup."*

**Why it works**: Schema markup (especially FAQ schema) gives LLMs structured signals about what the page answers. Meta titles and descriptions are what appear in search snippets and in LLM citation formatting.

**CELLO application**:
- Every CELLO blog post: custom meta title (include target keyword), meta description (1-2 sentences, include a benefit claim)
- FAQ schema on comparison posts: "Q: Does CELLO require a central server? A: No. Messages go directly peer-to-peer between agents. No central server reads or stores them."
- FAQ schema on every article answering the top 3 questions someone shopping in the category would ask

**Category**: `seo-geo`

---

## Tactic 7: Crawlability Check — AI Eyes Chrome Extension

**What they did**: *"There's a really Chrome tool... it's a Chrome extension that you can basically turn on on your website. I think it's called AI Eyes and it shows you what the AI sees. If that shows up blank, you're not that crawlable and it will be a big issue."*

Key warning: *"It's already shown that all LLMs have really big trouble with websites that are like completely vibe-coded because of how much they have dynamic content."*

**Why it works**: If an LLM's crawler sees a blank page (because the site is SPA/client-side rendered), it cannot cite the site regardless of content quality. Crawlability is a hard prerequisite.

**CELLO application**:
- Install AI Eyes on the browser and test cello.so
- If the site has client-side rendering issues, ensure the blog (Ghost/Payload) is statically rendered
- The docs and landing page should also be pre-rendered (SSR/SSG), not dynamic client-side only

**Category**: `prerequisite`

---

## Tactic 8: Competitor Listicle Research — Find Who's Already Citing Competitors

**What they did**: *"Go and ask ChatGPT about what are the best tools in my industry or what are tools like this and this tool, and then you use a competitor. Scroll down, go to sources, click on sources. In sources you're going to see that it's basically taking all of the recommendations from like 10 to 20 different listicles."*

Then: *"Go and export that. You can literally just like copy-paste it, take a screenshot if you want. Ask Claude or something to put it in a Google Sheet, adding in the URL as well."*

**Why it works**: ChatGPT's sources are the exact list of websites you need to be listed on. They're already curated by the LLM as authoritative sources in your category. Getting added to those specific listicles guarantees LLM citations.

**CELLO application**:
- Ask ChatGPT: "What are the best tools for AI agent identity and security?", "What MCP servers should I use for agent-to-agent communication?", "How do I make my AI agents trust each other?"
- Open sources panel, extract the 10–20 URLs
- These are the target websites for digital PR / backlink outreach
- Also search: "best multi-agent frameworks", "AI agent security tools", "MCP security" — look at the sources for each

**Category**: `seo-geo`

---

## Tactic 9: Listicle Outreach — Email Webmasters to Get Added

**What they did**: *"Literally go and send a little email. Just send an email saying, 'Hey, I saw your listicle. Would you like to include my tool?' What you're going to get is either people who do SEO... who's going to be like, 'Great, I would love to have a backlink exchange with you.'"*

Response rates: 3–7% for free outreach. Paying for backlinks is common ($150 range), but you can negotiate down to free if you have something to offer.

**Why it works**: These listicles are the exact sources LLMs cite. Being added to them is the most direct path to LLM citations. Most webmasters are either SEO-minded (open to exchanges) or monetizing (open to affiliate commission).

**CELLO application**:
- Email webmasters of the 10–20 URLs found in step 8
- Offer: "I'll add you to our 'Best AI agent tools' comparison article (currently ranking on Google) if you add CELLO to yours"
- Or offer an affiliate commission (e.g. 30%) — especially compelling for bloggers who want recurring revenue
- Template: "Hi, I noticed you listed [competitor] as a tool for agent identity. We built CELLO — an open-source cryptographic identity layer for AI agents. Happy to provide a free account + demo. Would you consider adding CELLO to your list?"

**Category**: `launch-tactic`

---

## Tactic 10: Backlink Exchange — Write Your Own Listicle First, Then Trade

**What they did**: *"If your listicle, if your piece of content is ranking on the first page of Google or is cited by ChatGPT, and this competitor is actually interested in being on that listicle, that's great. You can go and say, 'Hey, I'll put you as number two if you put me as number two as well.'"*

And from Florian's side: *"If I have a listicle and someone wants to get higher on my list, then I would just want a bigger commission."*

**Why it works**: When you have a listicle that's ranking, you have leverage. The backlink exchange becomes a peer trade: your visibility in exchange for theirs. Zero cash changes hands.

**CELLO application**:
- Publish "Best AI Agent Identity and Trust Tools (2026)" on the CELLO blog
- Include CELLO as #1, mention 3–4 adjacent tools (not direct competitors — adjacent tools like libp2p transports, MCP frameworks, etc.)
- Reach out to those tools: "We listed you in our best-of article. Would you link back to us from yours?"
- This article becomes the negotiation asset for all future backlink exchanges

**Category**: `launch-tactic`

---

## Tactic 11: Affiliate / Blogger Outreach — Give Free Premium Access

**What they did**: *"Go and give them free access. Give them your premium tier for free, whether that's for a year or longer, but make it more likely and give them the tools to actually write positively about you."*

Also: *"Remember that they're also business owners... sometimes that's doing something like, let me do a tweet about your blog. Let me do a LinkedIn post about your blog. Let me also backlink to your blog for something else. All of these little things, they can be really helpful to negotiate that backlink exchange and get it down to free."*

Florian's experience: offer higher affiliate commission (e.g. 40% vs. standard 30%) to move higher on a listicle.

**Why it works**: Bloggers and affiliate writers who write about AI tools are already targeting the exact audience CELLO needs. They have built-in distribution. Free access + higher commission + social promotion = mutually beneficial deal with no upfront cash.

**CELLO application**:
- Identify 10–15 technical bloggers / newsletter authors covering MCP, Claude Code, AI agent frameworks
- Offer: 1 year free CELLO access (or lifetime for early influencers) + 40% affiliate commission + tweet/LinkedIn promotion from the CELLO account
- Target blogs that already cover: Claude Code workflows, AI agent orchestration, multi-agent systems, MCP tool development
- Specific targets to find: newsletters covering Anthropic's MCP ecosystem, blogs covering Claude Code workflows, dev Twitter accounts doing AI agent tutorials

**Category**: `partnership`

---

## Tactic 12: YouTube Videos for Keyword Targeting — Fast LLM Citation

**What they did**: *"The best thing you can do is take that keyword list... and create a YouTube video. This can be an AI-generated video even. Can be any kind of video. And then create a thumbnail. Create a thumbnail that has your logo in big and then your main keyword that you're ranking for and then your company name."*

*"What's happening now is that Google as well as ChatGPT are surfacing a lot more video and they're sourcing it from YouTube... what you're going to see is 'best tennis SaaS blah blah blah' just text. But then in big is this whole square window, this thumbnail of a YouTube video."*

*"It works really, really well right now to go and create YouTube content on a channel that maybe also is like newly created."*

**Why it works**: YouTube is a major citation source for both Google AI Overviews and ChatGPT. Video thumbnails appear prominently in search results. The bar is low — even a new channel gets picked up. Most people click through the description link rather than watching the video.

**CELLO application**:
- Create a CELLO YouTube channel (can start with AI-generated videos)
- Videos to create: "How to connect two Claude Code agents securely (CELLO demo)", "AI agent identity — what is FROST threshold signing?", "Prompt injection defense for multi-agent systems", "Best MCP servers for agent-to-agent trust (2026)"
- Each thumbnail: CELLO logo prominently + keyword text + "CELLO" name
- Description should link to the CELLO landing page / waitlist
- Target 5–10 videos on the highest-priority BOFU keywords

**Category**: `content-format`

---

## Tactic 13: Medium and LinkedIn Articles — Fast 72-Hour AI Citation

**What they did**: Florian's own test: *"I did a listicle on Medium and a listicle on LinkedIn. Both listicles ranked really fast on Google and I got quoted in AI overview in about 72 hours."*

Tanya confirms: YouTube is the biggest now, but Medium and LinkedIn still work. Key detail: *"For your listicles, make sure that you add a lot of images and people forget that really really easily, but people love to not read anything and basically just skim through and see things like product photos, specifically like what does your UX look like, do you have a dashboard, do a product walk-through, even make GIFs, embed a short video."*

LinkedIn specifics: *"You want to create an article, not a post. An article is basically you need to go to linkedin.com and say create article, not create post, and then you can change your LinkedIn meta title, your LinkedIn meta description."*

**Why it works**: Medium and LinkedIn have high domain authority — they rank fast, especially for non-competitive niches. DR of the publishing platform overrides the DR of your own blog. Getting cited in AI Overview in 72 hours is feasible for niche queries that have low competition.

**CELLO application**:
- Publish on Medium: "The 5 Best Tools for Secure AI Agent Communication (2026)" — feature CELLO as #1
- Publish on LinkedIn as Articles (not posts): "How I connected my Claude Code agent to my AWS agent using CELLO" — include product screenshots, GIFs of the connect flow, a short demo embed
- Include: product screenshots, the MCP tool call sequence, the session transcript view, the sealed receipt example
- Target the niche: "AI agent identity", "MCP security", "multi-agent trust" — these are low-competition enough for fast citation

**Category**: `launch-tactic`

---

## Tactic 14: G2 and Capterra — Review Site Profiles

**What they did**: *"Go and create a G2 and a Capterra account. You'll basically get a lot more picked up, and your reviews are going to get start getting picked up as well by ChatGPT."*

**Why it works**: G2 and Capterra are authority domains that LLMs cite explicitly when answering "what tools should I use for X?" Reviews on these platforms surface in LLM-generated comparisons and recommendations.

**CELLO application**:
- Create a CELLO profile on G2 (free) and Capterra
- Category: "AI security tools", "AI agent frameworks", "developer tools"
- Ask early users/testers to leave reviews even pre-launch
- The profile copy should use the same BOFU keywords: agent identity, AI agent security, multi-agent trust, MCP server

**Category**: `launch-tactic`

---

## Tactic 15: Google Analytics Tracking — Source/Medium + Conversion Attribution

**What they did**: *"Go to analytics.google.com. Connect everything to your domain, to your website. You're now going to have your source medium set up properly... You specifically want to be able to track how many sign-ups are coming in through which blog article, and how many conversions are coming in through which blog article."*

Key insight: *"You can see chat.openai.com as a source. You can see Claude as well as a source, you can see everything as a source. You can go and do and look at that report right now... you probably want to times that times 100 for an actual understanding of how often you are really showing up because on average, the AI click-through rate is 1%."*

Tool recommendation: SEO Jets (seojects.com) — free, makes Google Search Console bearable, tracks clicks and impressions per article.

**Why it works**: Without conversion tracking per article, you're flying blind. An article with 50,000 impressions that doesn't convert is a waste to double down on. Tracking reveals which BOFU articles drive sign-ups, so you can replicate those.

**CELLO application**:
- Connect Google Analytics + Google Tag Manager to the CELLO blog and landing page immediately
- Track: sign-up completions, waitlist additions, demo requests — as conversions
- Track source/medium: `chat.openai.com`, `claude.ai`, `perplexity.ai` show up as traffic sources
- Multiply any AI referral traffic by 100 to estimate actual LLM recommendation volume
- Weekly: check which blog articles drove the most sign-ups, not just clicks

**Category**: `prerequisite`

---

## Tactic 16: Topical Authority — Write Deeply Within One Cluster

**What they did**: *"Topical authority is basically how knowledgeable does Google think your website is about a specific topic... If you have 500 articles that all have the word tennis in it, Google is probably going to think, 'These guys know a lot about tennis.'"*

*"If you're always writing about tennis, and then suddenly you write one article about green tea, it's not related to tennis. Google isn't going to think, 'Oh, you're also an expert on green tea.'"*

**Why it works**: LLMs are adopting the same topical authority model as Google. Deep coverage of one topic signals expertise and authority. It's better to have 20 great articles on AI agent identity than 5 on agent identity and 5 each on unrelated topics.

**CELLO application**:
- CELLO's topical cluster: AI agent identity, agent-to-agent communication, MCP security, multi-agent trust, cryptographic signing for agents, FROST threshold signatures (explained accessibly), prompt injection defense
- Every article should link to others within this cluster
- Do NOT write about adjacent but unrelated topics (general LLM news, unrelated security topics)
- The cluster makes CELLO the authority on "AI agent trust" — so when someone asks ChatGPT about it, CELLO's content is the obvious citation source

**Category**: `seo-geo`

---

## Tactic 17: Internal Linking — Structured Topical Clusters

**What they did**: *"Copy-pasting your entire blog into Claude. You're able to say, 'Hey, can you go and look through this whole CMS, tell me the topical clusters, and tell me your suggestions for internal linking, and take that into a Google Sheet. It needs to be the specific links, the target links, the source links, the target anchor, and the source anchor, and then it's the specific place that that needs to go.'"*

**Why it works**: Internal linking distributes "link juice" from high-authority pages to conversion pages. It also reinforces topical authority by showing search engines and LLMs that the site's articles are interconnected around a coherent subject area.

**CELLO application**:
- Once 5+ articles are live, dump the blog CMS into Claude and ask for internal linking recommendations
- Priority: every article should link to the main CELLO landing page / waitlist
- Every article should link to 2–3 related articles in the cluster
- A "hub" article like "The definitive guide to AI agent identity and trust" becomes the central linking target from all satellite articles

**Category**: `ongoing-distribution`

---

## Tactic 18: Prioritize ChatGPT (70%+ of LLM Traffic) + Target Claude for Developer Audience

**What they did**: *"ChatGPT has the highest volume. ChatGPT is accounting for more than 70% of all the traffic driven by LLMs."*

But: *"If you are someone who is targeting developers, technical people... studies show that the majority of those and more technical people in general, or things like product managers, they tend to be using Claude a lot more these days."*

For Grok: *"If you are targeting people who tend to be on Twitter, I think Grok is an excellent way to go."*

**Why it works**: Different LLMs serve different audience segments. CELLO's audience is developers and technical teams building multi-agent systems — skewing heavily Claude and technical ChatGPT users. Prioritization should reflect that split.

**CELLO application**:
- Primary: ChatGPT (volume) + Claude (developer audience)
- Secondary: Grok (Twitter/X-active technical founders and indie hackers)
- Content optimized for citation by ChatGPT: authoritative, named clients, numbers, definitive comparisons
- Content optimized for Claude: technical depth, accurate protocol descriptions, correct citation of RFCs, code examples
- Google AI Overview is non-negotiable as a baseline (catches all audiences)

**Category**: `seo-geo`

---

## Tactic 19: Reddit for Long-Tail Developer Niche Queries

**What they did**: *"Reddit is really great for long-tail keywords. A long-tail keyword is basically just a long question. Instead of 'best tennis socks', you say 'best tennis socks for people who have an injury like tennis elbow.'"*

Also noted that Reddit's dominance has faded slightly (it was the #1 play a year ago) but is still strong for niche queries.

**Why it works**: Reddit threads rank highly in both Google and LLM citations for specific, niche, long-tail queries. Developer subreddits have high authority. A helpful Reddit post answering a real question gets cited by LLMs for months.

**CELLO application**:
- Target: r/ClaudeAI, r/LocalLLaMA, r/MachineLearning, r/programming, r/devops, r/AIAgents
- Long-tail queries to answer: "How do I connect my Claude Code agent to another agent securely?", "How do I prevent prompt injection in multi-agent systems?", "What's the best way to give two AI agents shared identity?", "MCP server for agent identity verification"
- Post genuine, helpful answers. Mention CELLO as the solution where relevant. Don't spam.
- These posts rank for months and get cited in LLM responses

**Category**: `community`

---

## Tactic 20: Wikipedia Listing

**What they did**: *"Wikipedia is really great for being listed because it's seen as the go-to trustworthy website. And so, if you are able to get your SaaS on Wikipedia, it's highly highly recommended."* Caveat: harder, more appropriate for more established SaaS.

**Why it works**: Wikipedia is one of the highest-authority sources for LLM training and citation. Being listed on a relevant Wikipedia page (even as a "see also" or within a list) dramatically increases LLM recommendation likelihood.

**CELLO application**:
- Near-term: not realistic pre-launch
- Post-launch with traction: add CELLO to the Wikipedia article for "Multi-agent system", "Threshold cryptography", "Federated identity" (in the context of AI agents)
- Or create a Wikipedia article about "AI agent identity protocols" that cites CELLO as an implementation
- Track this as a 3–6 month post-launch goal

**Category**: `ongoing-distribution`

---

## Tactic 21: LinkedIn SEO — Articles Not Posts, With SEO Meta Fields

**What they did**: *"You want to create an article, not a post... go to linkedin.com and say create article, not create post, and then you can change your LinkedIn meta title, your LinkedIn meta description, and you can write much, much longer and have multiple photos."*

Also noted: *"I know people who have like multiple LinkedIn accounts, one that is specifically like a company account, but that they use for SEO."*

**Why it works**: LinkedIn articles are indexed by Google and cited by LLMs. They have customizable SEO meta fields (unlike LinkedIn posts). They support rich media, long-form content, and multiple images. LinkedIn has high domain authority.

**CELLO application**:
- Use the CELLO company LinkedIn page to publish long-form articles (not posts)
- Andre's personal LinkedIn for developer-facing articles: "How I use CELLO to connect my own AI agents", "Building a trust layer for AI agents — the CELLO story"
- Customize LinkedIn meta title and description for each article to include target keywords
- Include screenshots of CELLO in action, the MCP tool call UI, a demo transcript

**Category**: `content-format`

---

## Tactic 22: Track AI Referral Traffic — Multiply by 100 for True Reach

**What they did**: *"In your Google Analytics, you're going to see in your user acquisition reports, you go by source medium, you can see chat.openai.com as a source... you probably want to times that times 100 for an actual understanding of how often you are really showing up because on average, the AI click-through rate is 1%."*

**Why it works**: LLMs rarely add clickable links. Most mentions never generate a click. If ChatGPT recommends CELLO 1,000 times but only 1% result in a click, you see 10 visits in Google Analytics — but you've been recommended 1,000 times. This is valuable reach that is invisible unless you understand the multiplier.

**CELLO application**:
- Every week: check Google Analytics source/medium for `chat.openai.com`, `claude.ai`, `perplexity.ai`, `grok.x.com`
- Multiply visible clicks by 100 to estimate actual LLM mentions
- If analytics shows 0 AI traffic, that's a clear signal — content isn't being cited yet, time to intensify BOFU content and backlink work
- Report on this metric to calibrate the GEO strategy over time

**Category**: `ongoing-distribution`

---

## Tactic 23: The AI-Generated Video Play for Fast YouTube Ranking

**What they did**: *"This can be an AI-generated video even. Can be any kind of video. And then create a thumbnail. You can do this with like Gemini, nano banana, whatever."*

And: *"What is unlikely is that they watch the whole video. I guess that does happen, but it doesn't happen that much."*

**Why it works**: The actual video content quality is secondary — the thumbnail and title carry the SEO/GEO weight. A brand-new YouTube channel with an AI-generated video can still get picked up by ChatGPT as a citation source. The barrier to entry is low.

**CELLO application**:
- Use an AI video tool to generate 5–10 short demo/explainer videos
- Each video: 2–5 minutes, AI voiceover, screen capture of CELLO in action
- Thumbnails (use nano-banana or Gemini image gen): CELLO logo large on the left, bold keyword text on the right (e.g. "SECURE AGENT MESSAGING"), CELLO brand color background
- Description: link to cello.so waitlist + 3–5 relevant hashtags
- Titles: exact BOFU keyword match ("Best AI Agent Identity Tool 2026 | CELLO Demo")

**Category**: `content-format`

---

## Tactic 24: Conversion Rate as Affiliate Negotiation Leverage

**What they did**: Tanya's example from her AI photography SaaS: *"It was a one-time $30 fee. And our conversion rate would be like 17% when people were searching for bottom-of-funnel content, even if the affiliate ranked first... we'd be able to pay them out so well because our conversion rate was really high."*

Specifically: share your conversion rate data with affiliates as part of the pitch to get listed.

**Why it works**: Affiliates care about earnings per click. If your conversion rate is high (because BOFU content pre-qualifies users), a low commission % still generates strong earnings. Sharing conversion rate data turns the conversation from "cost per listing" to "revenue per listing."

**CELLO application**:
- Once CELLO has signup data, calculate: % of BOFU visitors who sign up for the waitlist / free trial
- Share this metric explicitly in affiliate outreach: "When developers search for 'AI agent identity tools', our conversion rate from blog click to sign-up is X%. At 30% commission, that works out to $Y per 100 visitors."
- This framing converts price-resistance from bloggers into a revenue opportunity conversation

**Category**: `partnership`

---

## Tactic 25: Avoid Optimizing for Vanity Metrics — DR Doesn't Matter for AI Visibility

**What they did**: *"For AI visibility, your DR doesn't matter. You can go and post whatever, and still you might get picked up by ChatGPT... We've actually had it happen a couple of times that we search for something on ChatGPT and sources and then we see a blog rank that has absolutely no content almost that has like a DR of like five or three or something super low."*

And: *"An article with 50,000 clicks that doesn't convert — there's no point."*

**Why it works**: LLMs are less biased toward domain authority than traditional Google SEO. A fresh site with exactly the right content for a low-competition query can get cited immediately. Don't wait to build up domain rating before publishing.

**CELLO application**:
- Don't delay publishing BOFU content waiting for the blog to "mature" or build backlinks first
- Start publishing immediately — even brand-new content on a new domain can rank for AI visibility on niche queries
- Measure success by: sign-ups from articles, not by DR, impressions, or raw traffic
- High impressions + zero conversions = wrong content or wrong audience — pivot topic

**Category**: `seo-geo`

---

## Tactic 26: SEO and AI Visibility Are Compounding — Not Paid Ads

**What they did**: *"The main thing with SEO is that it's compounding. You can basically go and start your SEO strategy right now, and you'll be able to get results that compound, that also don't cost you that much. You don't get that same kind of result with something like paid media, where as soon as you stop paying, you actually don't get any of the benefit anymore."*

**Why it works**: For a bootstrap founder with no paid ads budget, SEO/GEO is the highest-ROI acquisition channel. The content compounds: an article published today generates sign-ups for years. The margin profile is fundamentally different from paid acquisition.

**CELLO application**:
- Frame BOFU content as infrastructure, not campaigns — each article is a permanent acquisition asset
- The first 20 articles are the foundation; the next 20 compound on the first
- Track "sign-ups generated since publish date" per article — this is the compounding metric
- No paid ads budget needed; all budget goes into content creation time (Andre's own time + AI writing tools)

**Category**: `prerequisite`

---

## Foundations / Prerequisites

Before any GEO tactics will work, the following must be in place. These are load-bearing — skip them and the tactics above don't compound.

**1. CMS (Ghost or Payload)** at blog.cello.so or similar. Pre-rendered, crawlable, with proper meta fields. Check with AI Eyes Chrome extension.

**2. Google Search Console** connected to the blog and main site. Submit all URLs for indexing after publish.

**3. Google Analytics + Tag Manager** with conversion tracking:
- Waitlist sign-up
- Free trial sign-up
- Contact/demo request
- Source/medium tracking enabled (to see chat.openai.com, claude.ai referrals)

**4. Author profile** on the blog: Andre's name, bio, photo. Establishes E-E-A-T trust signals for both Google and LLMs.

**5. Keyword list** generated from the landing page (Claude + BOFU prompt). The editorial calendar. No article should be written without this list in hand.

**6. G2 / Capterra profiles** created and populated. These are citation sources for LLMs — set-and-forget.

**7. YouTube channel** created (can be empty at first). Namespace reserved, brand identity set.

**8. LinkedIn company page** active, set up to publish long-form articles.

**The earliest possible action**: paste the CELLO landing page into Claude, ask for 20 BOFU keywords + content briefs. That list IS the GTM content plan. Everything else follows.
