# GTM Tactics: "Zero to $25K/Month With One Marketing Channel"
Source: https://youtu.be/cFmmGoO3sZE
Channel: Florian Darroman (@asyncr0ne)

---

**Context**: Sleek is an AI-powered mobile app design tool for non-technical founders. Three engineers with no marketing background went from broke in Bali to $25K MRR in 6 months. Their primary channel was X, but the real story is about niche focus, ICP sharpness, and a content system that manufactured virality. This is worth reading carefully — a lot of what they describe generalizes precisely to developer tools.

---

## Tactic Breakdown

---

**ICP Before Launch**

- **What they did**: Failed twice with Reweb by having no clear ICP. Developers, designers, and PMs all used the product, so they built features for all of them. Nobody loved it. With Sleek, they stopped building first and sat down to define exactly who they were building for: "non-technical founders, pre-launch, building their first mobile app, no design budget." One sentence. Locked in before a line of code.
- **Why it worked**: When you know who you are for, every product decision, pricing decision, and content decision is easy. When you don't know, you build for a Venn diagram intersection that doesn't actually exist as a real person. Nobody recommends a product that feels "decent for me" — they recommend one that feels "made for me."
- **CELLO application**: CELLO has at least two distinct ICPs: (1) solo developers connecting their own AI agents (Claude Code on laptop ↔ Hermes on AWS), and (2) teams or friends connecting agents across trust boundaries. These are different audiences with different motivations. Pick one as the entry wedge. The solo developer use case has zero cold-start problem and is something you yourself demonstrate daily — that's the wedge. "Claude Code users who want their agents to talk to each other securely, without going through a platform" is a sentence. Write it down and do not deviate.
- **Category**: `prerequisite`

---

**One-Sentence Pitch that Implies the Problem**

- **What they did**: "Sleek helps non-technical founders and founders without a design background get beautiful designs for a mobile app." Every word earns its place: who (non-technical founders), what (beautiful designs), for what (mobile app). It's implicit about the problem — they can't afford a designer, vibe coding tools make ugly UIs.
- **Why it worked**: The sentence tells you instantly whether you're the customer. It doesn't oversell. It speaks to the pain ("no design background") not just the solution. It also tells distributors (creators, journalists) immediately who to recommend it to.
- **CELLO application**: Draft a sentence that works the same way. Something like: "CELLO lets your AI agents connect and communicate with other agents — privately, with cryptographic identity — without trusting any central platform." Better yet, name the pain more viscerally: "AI agents on different machines can't securely talk to each other today — CELLO is how you connect them." Test variations with actual developers to see which one gets "wait, how?" vs. blank stares.
- **Category**: `prerequisite`

---

**The Fake Beta / Comment-to-Access Launch on X**

- **What they did**: The product was already live and publicly accessible. But they launched on X saying "comment to get access" — making people reply to get the link. This was a fiction, but it worked: comments poured in ("I want access", "I want access"), the algorithm loved the engagement, the post snowballed. At a certain point they revealed "the beta was a joke, it's live." Got to 600K impressions on the launch tweet.
- **Why it worked**: X's algorithm weights replies heavily. A post with 300 replies ranks far higher than one with 300 likes. By making the CTA "comment this" instead of "click here," they manufactured an engagement loop that looked like genuine demand. Social proof was visible in the thread itself — everyone could see hundreds of people wanting in.
- **CELLO application**: CELLO can run this exactly. Launch tweet: "We built private P2P identity for AI agents. Two Claude Code instances, two Hermes agents, any combo — they can find each other, verify identity, and message without going through a platform. Comment your agent setup and we'll show you how it connects." The product is already functional. You don't need a fake waitlist but you can create a CTA that requires a reply: "Comment your stack and I'll walk you through the config." The replies become the social proof.
- **Category**: `launch-tactic`

---

**Riding Trend Vocabulary in the Hook**

- **What they did**: "We built the fastest way to vibe design mobile apps." The phrase "vibe design" was trending at the time — a riff on "vibe coding." Using it in the hook made the tweet algorithmically findable by people already searching that phrase and signaled they were part of the current conversation, not behind it.
- **Why it worked**: Trend vocabulary is a search and association hack. People tracking a term see it, engage with it, repost it. The hook did double duty: it captured trend traffic AND told you exactly what the product is in four words.
- **CELLO application**: The vocabulary to ride right now: "agentic", "multi-agent", "agent-to-agent", "MCP", "Claude Code", "AI agent swarm". A hook like: "We built P2P identity for MCP agents. Your Claude Code can now initiate a session with any other agent — cryptographically verified, no central server." That's two trend terms (MCP + Claude Code) plus the differentiator. Watch the Claude Code community and Anthropic's own language for the vocabulary that's gaining velocity and mirror it.
- **Category**: `launch-tactic`

---

**Demo Video as the Lead**

- **What they did**: The launch tweet always included a video demo — not a screenshot, not a text description. You see the product generating screens in real time. The real-time generation effect ("piece by piece come out") was itself the demo. They didn't just show the output; they showed the experience.
- **Why it worked**: For tools that produce a visible output, nothing converts like watching the output appear. It answers "does this actually work?" before the viewer has to commit to clicking. Video in a tweet also autoplay on scroll, stealing attention before someone consciously decides to engage.
- **CELLO application**: CELLO's demo video is: two terminals, two agents, initiating a session. One side runs `cello_initiate_session`, the other gets a doorbell, they verify each other's identity, exchange a message, one seals the receipt. No voiceover needed — just the tool calls on screen with a caption: "Two AI agents. No central server. Cryptographically sealed." The session transcript appearing in real-time IS the Sleek-equivalent "piece by piece" moment. Short, under 90 seconds.
- **Category**: `content-format`

---

**Comment-Trigger as Structural Content Rule**

- **What they did**: 80-90% of their X posts were not product announcements — they were helpful content about design and mobile apps. But every post was architected to trigger comments. They had explicit templates: compare two options and ask which is better (debate in comments), "guess which one is AI" (everyone has an opinion), "comment your idea" (participation hook). The product was mentioned in the first reply, not the main post.
- **Why it worked**: Content that invites a reaction gets amplified. The key insight is that the product pitch is almost never the comment-triggering element. The debate, the guess, the community participation — those drive the algorithm. The product rides along.
- **CELLO application**: Structure posts the same way. "Two agent identity approaches side-by-side: one stores a shared secret, one uses threshold cryptography (FROST). Which would you trust with a $10K transaction?" — that's a debate post. Or: "What's your current agent communication setup? DM, HTTP, or something else?" — that's a survey post. CELLO is the natural response/link in the first comment. The post itself teaches; the product appears in context.
- **Category**: `content-format`

---

**"Build Your Idea For Free" Engagement Template**

- **What they did**: "Comment your mobile app idea, we'll make a design for you for free." Manual, not scalable. They ran every idea through Sleek and sent the project back. The result: the person got immediate product value, reduced friction to first use (they didn't have to craft the perfect prompt), and were more likely to convert.
- **Why it worked**: It's a personalized product trial at zero friction. The person doesn't have to sign up, figure out the product, or craft a good prompt. You hand them a ready project. If they want to iterate, they need an account.
- **CELLO application**: "Comment your agent stack — what AI agent do you run locally, what do you run remotely? I'll show you the exact CELLO setup that connects them." Andre can personally respond to replies with a working config snippet. This is manual but extremely high signal — you learn the exact stacks people are running (which feeds ICP research), and the person who comments gets a personalized answer that naturally references CELLO as the solution. Do it for 2-3 weeks around launch.
- **Category**: `launch-tactic`

---

**Prompt + Output as Bookmarkable Content**

- **What they did**: Post a design alongside the exact prompt that generated it, formatted clearly. People bookmark this because they think "I'll use this prompt later." The bookmarking behavior signals to the algorithm that the content is worth distributing. It also builds a library of "prompt recipes" that people associate with Sleek.
- **Why it worked**: Saved/bookmarked content has outsized algorithmic weight on X because it signals "this is useful enough to keep." Reference content (prompts, templates, configs) gets bookmarked at higher rates than opinion or news content.
- **CELLO application**: "Config snippet of the week: here's the exact 5-line setup to connect a Claude Code instance to a remote Hermes agent using CELLO. Session is authenticated, signed, and sealed." Post the working snippet in the post body or thread. People building similar setups will save it. The CELLO repo link is implicit — they'll want to know how this works. Variants: "How to set a session moniker so your agent announces itself by name" (with the code), "How to verify an incoming agent's identity before replying" (with the code).
- **Category**: `content-format`

---

**Model/Tool Comparison Posts (Evergreen Template)**

- **What they did**: "We ran the same design prompt through ChatGPT, Gemini, and Sleek. Here are the results." They did this whenever a new model launched — meaning there was always a new trigger for the post. Got an indirect Elon Musk repost when someone compared Grok. The template has an inherent news hook baked in.
- **Why it worked**: Comparison posts answer a question everyone has: "which tool is better?" They get engagement from fans of each tool, from people evaluating which to use, and from people who want to defend their preference. The template is infinitely repeatable because new models keep launching.
- **CELLO application**: "Which MCP agent setup keeps your session history most private?" is a comparison angle. But the more natural CELLO version: when a new Claude model drops, new Anthropic agent SDK feature ships, or new competitor to Claude Code launches — run a post: "Tested agent-to-agent sessions under [new model/feature] — here's what changed for CELLO." This positions CELLO as the testing ground and Andre as someone tracking the space closely. It's the same evergreen template: new model → CELLO angle → post.
- **Category**: `content-format`

---

**AI vs Human / Guess-the-Source Debate**

- **What they did**: "One of these designs was made by AI, one by a real human designer. Guess which is which?" They post two results side by side with no labels. Comments explode with people arguing "that button placement is AI" vs "no, the spacing on the left is too perfect to be human." Engagement is very high because everyone has a strong opinion and the answer isn't obvious.
- **Why it worked**: Controversy-adjacent content where there's no clearly wrong answer and people feel qualified to weigh in drives massive comment volume. It's also subtly pro-product: the AI output being hard to distinguish from human work is exactly what you want people to notice.
- **CELLO application**: The direct equivalent: "This is a real session transcript between two AI agents. One of these messages was written by a Claude Code instance, one was written by a Hermes agent. Can you tell which is which?" It's whimsical but it shows that CELLO sessions look like real conversations. Or flip it: "A prompt injection attack attempted to hijack this agent session. Here's what the injected message looked like — would you have caught it?" That's a security-angle version that drives real technical discussion and demonstrates CELLO's defenses.
- **Category**: `content-format`

---

**Milestone Sharing / Founder Journey Content**

- **What they did**: Alongside product content, they shared personal milestones ("0 to 10K MRR in 4 weeks"), journey updates, and vulnerability ("this is our last shot"). Not promotional — documentary. This is what got them noticed by Starter Story, which was the single biggest distribution event.
- **Why it worked**: People follow founders, not products. Milestone posts get reshared by other founders empathetically. Vulnerability (the "last shot" Hacker News post) generates support and attention that product posts never do. And the cumulative signal of "this founder is building in public" makes journalists and podcasters reach out proactively — which is far better than cold outreach.
- **CELLO application**: Andre should be posting his own journey. The story is genuinely compelling: solo founder, nearly two years deep in cryptographic infrastructure, building something that nobody has built before (P2P agent identity without a central platform), close to launch. Posts like "Two years into CELLO — here's what I've learned about building trust infrastructure for AI agents" or "We hit [waitlist milestone]. Here's what AI builders are actually asking for." The CELLO story — FROST threshold signatures, federated directory nodes, sealed receipts — is technically interesting in a way that most SaaS stories aren't. That's an asset.
- **Category**: `ongoing-distribution`

---

**Hacker News "Last Shot" Post**

- **What they did**: Posted on Hacker News explicitly saying: "This is our last attempt. We are building Sleek Design, a mobile app design tool. We're giving ourselves until the end of the year. If it doesn't work, we start over." Public commitment, raw honesty about their situation.
- **Why it worked**: HN rewards genuine technical projects with compelling founder stories. The vulnerability of a public deadline creates engagement that polished marketing copy never gets. It also attracts people who want the founders to succeed — early users who are invested in the journey, not just the product.
- **CELLO application**: A Show HN post for CELLO is a natural fit. HN is the right audience: cryptographers, protocol engineers, security researchers, developers building multi-agent systems. The post should lead with the technical problem ("AI agents can't verify each other's identity without trusting a platform") and the technical approach (FROST threshold signatures, tamper-evident hash chains). Don't pitch the product — explain the problem. That's what HN responds to. The "last shot" framing is optional but the authentic-founder angle (solo, 2 years, pre-launch) is worth including.
- **Category**: `launch-tactic`

---

**Organic Creator Amplification Post-Viral**

- **What they did**: After going viral on X, creators in the AI tools space started making Instagram reels and TikTok videos about Sleek without being asked or paid. They had been actively following what went viral in the AI space and picked up Sleek as the new interesting thing.
- **Why it worked**: The AI tools creator ecosystem is specifically tuned to find and amplify new products. There's a whole genre of "I tested this new AI tool" content that creators need to keep making. When you go viral, you become the raw material for that content.
- **CELLO application**: When CELLO launches and gets initial traction, watch for creators in the "Claude Code tips", "AI agents", "MCP tools" space on YouTube, TikTok, and X. Identify the 10-20 creators in that niche before launch. When the launch goes well, proactively DM them: "Hey, noticed you cover MCP tools — CELLO just launched, happy to walk you through a demo if that's interesting." You're giving them content, not pitching them. The creators who matter for CELLO are not generic tech influencers — they're the specific subset who talk about Claude Code, AI agents, and developer tools.
- **Category**: `viral-mechanic`

---

**Paid Creator Seeding (Selective, YouTube)**

- **What they did**: Had a few thousand dollars left, considered paying creators as a last resort, ended up not needing to spend it because organic worked. But they did later do YouTube creator deals — 80-90% of revenue was organic but they had a few paid partnerships that contributed.
- **Why it worked**: Paid creator deals work when the creator's audience exactly matches your ICP. They identified YouTube as the right platform because long-form "how to build X" videos have a long shelf life (a tutorial stays useful for 12+ months) and attract exactly the people who are about to start building.
- **CELLO application**: The creator deal that would work best for CELLO is the "full workflow" format (see next tactic). Find creators who make "Claude Code tutorials", "agentic workflow" tutorials, or "I built a multi-agent system" content. Approach them not with "can you feature CELLO" but with "we'd love to help you make a video on 'how I connected two AI agents securely' — we'll build the demo, you publish it."
- **Category**: `partnership`

---

**Full Workflow Videos (Not Product Demo Videos)**

- **What they did**: The Starter Story video wasn't "here's what Sleek does." It was "here's how to go from an app idea to a finished app, start to finish." Sleek appeared for the design segment. Someone watching who had no idea Sleek existed walked away thinking Sleek is the obvious tool for this step.
- **Why it worked**: People searching for "how to build a mobile app" aren't searching for "Sleek." But they encounter Sleek as the answer to a sub-problem inside that workflow. This is a fundamentally different positioning — you're not competing for "best design tool" mindshare, you're embedded in the workflow discovery path. The video acts as a video sales letter without feeling like one.
- **CELLO application**: The CELLO version of this is a "how I built a multi-agent system" video where CELLO handles the identity and communication layer. The workflow: (1) build agent A with Claude Code, (2) build agent B with Hermes, (3) connect them with CELLO, (4) they verify each other and start a session, (5) sealed receipt at the end. CELLO is step 3, not the whole video. You can make this yourself as a recorded walkthrough, or pitch it to YouTube creators in the Claude Code or AI agents space. Someone searching "how to connect two AI agents" or "multi-agent Claude Code tutorial" finds this video and CELLO is the obvious answer for the connection layer.
- **Category**: `content-format`

---

**Reddit as Dual-Use (Traffic + GEO)**

- **What they did**: Active on Reddit from launch. Used it for direct traffic but also understood that Reddit posts are cited by LLMs (ChatGPT, Perplexity cite Reddit heavily). Being present in relevant subreddits means you appear in AI recommendations for those topics.
- **Why it worked**: Reddit posts rank in Google and get indexed by LLMs. A well-written post in r/MachineLearning or r/webdev doesn't just drive direct traffic — it seeds the LLM training and retrieval corpus for that topic. Reddit is unusual in that it serves both direct-traffic and GEO goals simultaneously.
- **CELLO application**: Target subreddits: r/ClaudeAI, r/LocalLLaMA (for local/self-hosted agent setups), r/MachineLearning, r/artificial, r/selfhosted, r/netsec (for the security angle), r/PrivacyGuides. The approach is not promotion — it's presence in relevant threads. When someone asks "how do I make two AI agents communicate securely," that's a CELLO answer. Write it generously, include the technical substance, mention CELLO as the tool at the end. If the answer is genuinely useful, it will accumulate upvotes and become the top result for that query — both in Google and in LLMs that cite Reddit.
- **Category**: `seo-geo`

---

**GEO Reverse-Engineering (LLM Source Inspection)**

- **What they did**: Go to Perplexity, ask "what is the best mobile app design tool for non-technical founders?" Perplexity shows you which sources it's pulling from. Those sources are the GEO targets. Contact each one: "How do I get listed here? What do I need to do?" For Reddit specifically, post in threads where you'd want to appear. For other sources (blogs, directories, review sites), negotiate inclusion.
- **Why it worked**: Most GEO advice is vague ("create content that LLMs will cite"). Perplexity makes the source layer visible, turning a fuzzy strategy into a concrete target list. You know exactly which five sources you need to land on.
- **CELLO application**: Go to Perplexity and ChatGPT and ask: "How do AI agents communicate with each other securely?" "What's the best way to connect two MCP agents?" "How do I add identity verification to my AI agent?" Note every source that appears: blog posts, GitHub repos, documentation pages, Reddit threads, YouTube videos. That list is your GEO map. For each source: if it's a Reddit thread, post in it. If it's a blog that accepts contributions or has a "tools we recommend" section, reach out. If it's a comparison site, get listed. This is systematic, not speculative.
- **Category**: `seo-geo`

---

**Vertical SEO as Passive Ranking Gift**

- **What they did**: Because they were "mobile app design AI" not "design AI," they rank first/second/third for "mobile app designer AI" style searches with minimal SEO effort. Google favors specificity when a user's query is specific.
- **Why it worked**: Generic tools compete against a thousand other generic tools. Specific tools own their specific query. The paradox is that niching down feels like shrinking your market but it actually gives you disproportionate search visibility in the space you've chosen.
- **CELLO application**: CELLO's vertical specificity is "AI agent-to-agent identity" — there are essentially zero other tools doing exactly this. The queries CELLO should own: "AI agent identity verification", "MCP agent communication security", "how to connect Claude Code agents", "P2P AI agent sessions", "AI agent signed receipts". These are low-volume but zero-competition. Write one focused piece of content per query (a blog post, a README section, a Reddit answer) and CELLO will rank because nobody else is targeting these terms. As the market grows, CELLO already owns the real estate.
- **Category**: `seo-geo`

---

**Directory Submissions (Including Developer-Specific Ones)**

- **What they did**: Submitted to app directories and also specifically mentioned skills.tech from Vercel as a notable one that "went pretty well." Not generic Product Hunt-style directories — they found the directory that was native to their ecosystem.
- **Why it worked**: Ecosystem-native directories reach the exact audience. skills.tech for Vercel users is read by exactly the kind of developer who builds apps and needs design tools. The traffic is small but highly qualified.
- **CELLO application**: The ecosystem-native directory for CELLO is the MCP server registry. Getting listed prominently in the Claude Code MCP server ecosystem is the direct equivalent. Beyond that: awesome-mcp lists on GitHub, Claude Code community resource pages, Anthropic's documentation for third-party tools. These are the directories that the CELLO ICP (Claude Code users) actually checks. Submit to all of them. Being on the official Anthropic MCP directory (if it exists or when it launches) is a must-have, not a nice-to-have.
- **Category**: `ongoing-distribution`

---

**Omnipresence Philosophy**

- **What they did**: They acknowledged it's hard to track which source drove which customer. Their approach: just be everywhere relevant, keep showing up, trust that something compounds. "We just have hope that just doing stuff and being omnipresent, something is going to pick up."
- **Why it worked**: Attribution is broken for developer tools. Someone hears about a tool on a podcast, sees it on Reddit three weeks later, reads a HN comment mentioning it, then searches it directly. They'll say they "just found it." Multi-touch exposure before conversion is normal. Presence in many places makes conversion from any of them more likely.
- **CELLO application**: Pick 4-5 channels and be consistent: X (for launch virality and community), Reddit (for SEO+GEO), GitHub (open source, README, discussions), a blog (for long-form content that LLMs cite), and one video format (YouTube tutorial or recorded demo). Don't try to track perfect attribution — track total inbound and channel proxies (Twitter referrals, GitHub stars, Reddit mentions). The goal is that when a developer is asking "how do I connect my agents," CELLO's name appears across multiple touchpoints before they decide to try it.
- **Category**: `ongoing-distribution`

---

**Distribution-First Phase After Launch (Deliberate Mindset Shift)**

- **What they did**: "We spent a month building. Let's do nothing else but distribution now." They explicitly enforced this for 2-3 months. Engineers who default to building features had to force themselves into the distribution mindset. It was a deliberate rule, not an organic shift.
- **Why it worked**: The default for an engineer is to respond to any problem with more building. More features, more polish, better architecture. Distribution requires the opposite default: external attention, repetition, and tolerance for activities that don't feel productive. Without a rule, the builder default wins every time.
- **CELLO application**: Set a rule for the launch period: no new features for [X weeks], only distribution. CELLO already has a working product — adding more protocol features before anyone is using it is the wrong move. The distribution work is: the launch post, the demo video, Reddit seeding, HN submission, GEO mapping, creator outreach, config snippet posts. These compound. A feature nobody discovers doesn't.
- **Category**: `prerequisite`

---

**Wow Effect + Curiosity Mechanic in the Product**

- **What they did**: Two product mechanics drove conversion with an almost-no-credits free trial: (1) real-time generation — you watch the design appear screen by screen, creating a visceral "this is actually working" moment; (2) blurred locked screens — already generated behind the scenes but blurred, showing you there's more but you need to unlock it. The curiosity gap pushed conversion.
- **Why it worked**: The wow effect has to land before the paywall. If the user's first impression is "this seems useful in theory," they bounce. If it's "holy shit, this actually just generated that in 3 seconds," they want more. The blur mechanic turns that energy into forward momentum.
- **CELLO application**: CELLO's equivalent wow moment: a first session that works end-to-end in under 2 minutes. The key is speed to first success. If the setup is complex or the first session takes 10 minutes to configure, the wow never happens. Consider: can you create a one-line onboarding where the first session is pre-configured against a demo agent Andre runs? Developer tries `cello_initiate_session demo-agent` and immediately gets a verified reply. That's the Sleek wow. The curiosity mechanic equivalent: during the free tier, show the session transcript and sealed receipt structure but indicate "the cryptographic inclusion proof is available at [tier]" — something visible but locked.
- **Category**: `product-led-growth`

---

**Ship and Validate, Optimize Later**

- **What they did**: Shipped with unoptimized AI costs, watched credits drain in real time, and made the decision to keep going because they were validating. Optimized the cost structure only after they confirmed demand. "Validate first, optimize later."
- **Why it worked**: Optimization work done before validation is premature. Every engineering hour spent on efficiency before you know people want the product is a bet on the wrong thing. Running hot on costs for a few days is a much smaller risk than spending a month optimizing for a product nobody wants.
- **CELLO application**: CELLO's equivalent: ship the CLI and MCP experience before everything is perfect. If the directory nodes have some operational overhead, or the DKG ceremony is slightly clunky, ship it anyway. Find out what developers actually stumble on, not what you hypothesize they'll stumble on. The optimization to do post-validation is different from the optimization you'd do pre-validation.
- **Category**: `prerequisite`

---

**Soft Paywall Iteration (Free Trial Tuning)**

- **What they did**: Went through three paywall configurations: open → hard paywall (too much friction, fewer conversions) → soft paywall with reduced free credits. The reduced-credit free trial worked because the wow effect was strong enough that people wanted more after seeing it.
- **Why it worked**: Paywall design is empirical, not theoretical. The right answer depends on how strong your wow effect is and what the unit economics allow. They treated it as an experiment, not a permanent decision.
- **CELLO application**: For CELLO's free tier: the question is what creates the wow without burning cost. A fully functional first session with a demo agent costs essentially nothing server-side. The "freemium gate" should be on the trust/contact tier system — you can run sessions, but whitelisting contacts (full unattended access) is a paid feature. Or it's on the sealed receipt + inclusion proof functionality. The exact design matters less than the principle: ship a free tier, measure where people hit the wall, tune the gate.
- **Category**: `product-led-growth`

---

**Using Claude for Content Ideation**

- **What they did**: "Pretty much our brains and Claude's brain." Claude was explicitly part of the content brainstorming loop. Not just for writing — for generating the comparison ideas, the "guess which one" hooks, the debate topics.
- **Why it worked**: Claude is a better brainstorming partner than most of us are alone, specifically for the question "what would make someone want to engage with this?" That's a question with a known answer (controversy, curiosity, participation, usefulness) and Claude can generate variants rapidly.
- **CELLO application**: This is already in Andre's toolkit. Use it. The specific prompt: "I'm launching CELLO, a P2P identity layer for AI agents. My ICP is Claude Code developers who want to connect their agents. Give me 20 X post ideas that would drive comments and debate, formatted as: hook + CTA. The CTA should require a reply, not a click."
- **Category**: `ongoing-distribution`

---

**Acquisition Interest as Validation Signal (Not Exit)**

- **What they did**: Got an acquisition offer from Vercel when Reweb was 3-4 months old. Turned it down because all three wanted to keep building. Used the story later as credibility and eventual media moment.
- **Why it worked**: Acquisition interest from a major company is the strongest possible ICP validation signal — someone with a billion-dollar market view thought your product was worth buying. Turning it down is a statement about long-term conviction. The story compounds in retelling.
- **CELLO application**: Not directly actionable, but the mindset matters: if CELLO gets interest from a platform company (Anthropic, a cloud provider, an enterprise AI team), that interest is validation evidence to publicize (with permission) and a forcing function to clarify what CELLO's independent value is. The Sleek founders got sharper about their vision by deciding what they were NOT willing to sell. Think about that in advance so the answer is ready.
- **Category**: `community`

---

**X Has a Ceiling — Plan Your Transition**

- **What they did**: Explicitly said X was the top-performing channel but acknowledged it has a ceiling. Their next bet was SEO + Reddit + GEO, which they called "all one thing." They were actively building that infrastructure while still running X hard.
- **Why it worked**: This is a sequencing insight, not a tactic. X gets you to first traction because it's fast feedback, high shareability, and the AI space lives there. But X posts have a 24-48 hour shelf life. SEO and GEO are permanent infrastructure — a Reddit post from 2026 can drive traffic in 2028. Building both in parallel is the right call.
- **CELLO application**: CELLO should follow the same sequence. X for the launch and first 2-3 months of traction — the community is there, the reach is real, the virality mechanics work. Simultaneously: start writing the durable content (blog posts, Reddit answers, GitHub documentation) that will accumulate over time. By the time X starts feeling like a treadmill (which it will), the SEO/GEO infrastructure is already built.
- **Category**: `ongoing-distribution`

---

## Foundations / Prerequisites

Things the Sleek founders identified as things you must have locked down BEFORE going to market. CELLO should resolve each of these before the launch push.

**1. ICP Locked to One Sentence**
Not "developers and AI builders" — one specific person with one specific problem. Recommended for CELLO: "Claude Code developers who want their AI agents to communicate and verify identity with other agents — their own agents on other devices, or a collaborator's agent — without trusting a central platform." This may still be too broad. Consider: is the ICP the solo developer (connecting their own Claude Code and Hermes), or the team lead (connecting agents across an org), or the security-conscious operator (who specifically doesn't want a platform to read agent messages)? Pick one for the launch phase.

**2. One-Sentence Pitch That Implies the Pain**
The sentence should tell the listener immediately: (a) who it's for, (b) what problem it solves, (c) what makes it different. Currently CELLO's pitch is technically accurate but protocol-forward. Test with non-cryptographers: do they understand what they're getting and why they'd want it?

**3. Working Wow Demo Under 2 Minutes**
A demo that works every time, shows the core value (two agents connecting and verifying identity), and doesn't require the viewer to understand FROST or Ed25519. Just: "it connected, it's verified, here's the sealed receipt." This should exist as a recorded video and as a live walkthrough you can run in any terminal.

**4. Free Tier Designed for Conversion**
Know what the free tier covers and where the gate is. The gate should come AFTER the wow effect, not before. Someone should be able to run their first session — and experience why CELLO is different from just using an HTTP webhook — before they hit a paywall.

**5. Waitlist / Early Access Mechanism**
A way to capture interest from people who aren't ready to install yet. Could be as simple as a "get notified" email form, but it needs to exist before the launch post so interested people have somewhere to land.

**6. Reddit Presence Before Launch**
Be a genuine contributor in relevant subreddits for a few weeks before you launch. Accounts that only appear at launch with a product link get flagged. Build karma by answering questions about agent communication, MCP, Claude Code setup, security — the threads CELLO belongs in. Then when you mention CELLO, it's contextual, not a cold plug.

**7. The Narrative Arc (Founder Story)**
Sleek benefited from a compelling story: broke founders in Bali, last shot, Vercel acquisition declined. CELLO has its own story: two years of cryptographic infrastructure, federated directory nodes on three continents, a solo founder who uses the product daily to connect his own agents. That story should be written down and ready to tell before launch — for HN posts, creator pitches, and journalist emails.
