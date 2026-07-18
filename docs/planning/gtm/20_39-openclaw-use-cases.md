---
founder: Kit
company: Tinker Club
stage: Early OpenClaw power user; one of the first ~13-agent setups, before official onboarding existed
date: unknown
---

Kit is one of the earliest and most prolific OpenClaw (Claude Code agentic mode) users, running 13 agents wired into his home, business, and personal life before most people had heard of the tool. He co-founded Tinker Club, a community Discord built around daily agent challenges, self-hosting, and hardware tinkering. This video is a one-hour interview hosted by Florian Darroman (@asyncr0ne) in which Kit presents 39 real-world use cases — from negotiating a snow shoveler via a local contractor platform to running a 5-LLM jury on incoming email for prompt injection defense. The interview is high-value GTM context because Kit articulates, in plain language, the exact trust, routing, and identity problems CELLO solves: agents making opaque autonomous decisions that destroy trust in a single action, the paralysis of multi-agent routing across chat platforms, and the emerging need for verifiable agent identity as agents begin to transact with humans and each other in the real world.

# GTM Tactics: "39 OpenClaw Use Cases to Automate Your Business (and Life)"
Source: https://youtu.be/XRkJfxgdxzM
Channel: Florian Darroman (@asyncr0ne)

---

> **How to read this file:** Most entries here are *use-case insights* — places where Kit's real-world OpenClaw setup reveals a friction, a trust gap, or a collaboration moment where CELLO is the missing layer. A few entries are pure GTM/distribution tactics. Both matter for launch positioning.

---

**[Email archive agent shut down — trust collapse]**
- **What they did**: Kit ran a heartbeat cron job to archive emails by rule. It archived a cold outreach email from a potential investor. "Even if this happens once every 100 emails, I cannot fully trust it." He turned off the cron job entirely.
- **Why it worked / what it reveals**: Autonomous agents lose trust the moment they make *one* opaque mistake. There is no audit trail, no receipt, no way to prove what happened and why.
- **CELLO application**: A sealed receipt after every agentic action — a tamper-evident log of what the agent decided and why — is exactly the restore-trust primitive. Kit's failure mode is not a model quality problem; it's a transparency problem. Lead with "your agent's autonomous decisions are now auditable" not "your agent is more accurate."
- **Category**: `user-insight`

---

**[Custom chat app: routing paralysis solved by building an app]**
- **What they did**: Kit went from 1 Telegram bot (productive) to 13 agents across Discord and Telegram channels (paralyzed). He is now building his own chat app with nested topics, per-topic agent assignment, and inherited context trees.
- **Why it worked / what it reveals**: "Now if I want to do something I'm like which agent, which channel, which topic." The multi-agent world creates an identity/routing problem that no existing chat platform solves. People reinvent it from scratch.
- **CELLO application**: CELLO's session model with named contacts and tiers *is* the routing layer Kit is rebuilding. Demo: "here's how to assign a CELLO contact tier to a specific agent identity so your Claude Code knows which Hermes agent to reach for project X." Position CELLO as the identity backbone, not another interface.
- **Category**: `user-insight`

---

**[Prompt injection defense — 5-LLM jury for email]**
- **What they did**: Kit built a mailbox app where every incoming email is judged independently by five LLMs for prompt injection risk before OpenClaw can read it. OpenClaw only sees emails the jury approves.
- **Why it reveals**: This is a production-grade, self-built version of the exact defense CELLO's screening layer provides. Kit built it himself because no off-the-shelf solution existed.
- **CELLO application**: CELLO's prompt injection defense is a direct parallel. Position it as "the 5-LLM jury, built in and shipped for you." The fact that Kit built this manually is evidence of real demand — not edge-case paranoia.
- **Category**: `user-insight`

---

**[Collaboration friction: wife as QA, no trust layer]**
- **What they did**: Kit's wife does manual QA on their apps, reports bugs. Kit fixes them. They tried Discord, GitHub issues, a dedicated "vibe coding Discord." "When collaborating with someone it would be nice to use GitHub issues or cloud agents or something like that where you can actually see a canon moving and you can review it before it goes to the next stage."
- **Why it reveals**: Two people, each with their own agents, collaborating on shared work — and they have no agent-to-agent trust layer. She cannot send a bug directly to his coding agent without Kit as the manual relay.
- **CELLO application**: This is the friend-to-friend use case verbatim. Her agent could open a session with his coding agent, attach a bug report, and Kit's agent acts on it — sealed receipt on both sides. The video's audience likely has a business partner, a QA person, a freelancer in the same position.
- **Category**: `user-insight`

---

**[Twitter DM to invoice: multi-step specific instruction]**
- **What they did**: "I can tell it read my Twitter DMs, find who wanted to sponsor, go to my accounting platform, create an invoice, and send it to them via email." Works — but only when the instruction chain is extremely specific, naming each platform.
- **Why it reveals**: Each hop in the chain is a trust boundary. Kit as the human is the trust anchor for every step. Remove Kit from the middle and you need each agent to verify the intent of the next.
- **CELLO application**: When the Twitter DM handler and the invoicing agent are different processes (or belong to different people), CELLO's session + identity layer is what lets them hand off work with a verifiable provenance chain rather than a hope.
- **Category**: `user-insight`

---

**[Wise API: giving the agent its own money]**
- **What they did**: Kit plans to fund a Wise account via API and let his agent pay contractors, groomers, parking — with a spending limit. "Through the API it can pay contractors... it will have a limited amount of money."
- **Why it reveals**: Autonomous financial action requires identity. The agent spending money *is* Kit, legally. If the agent has its own CELLO identity with a sealed receipt per payment, there is an audit trail that protects both Kit and the contractor.
- **CELLO application**: "Your agent's financial actions are signed and receipted" is a concrete value proposition for the power user who is already giving their agent access to a Wise card. Frame CELLO as the identity infrastructure under agentic commerce.
- **Category**: `user-insight`

---

**[Snow shoveling: agent negotiated, human showed up]**
- **What they did**: Kit vented about not wanting to clean snow. The agent found a contractor on a local platform, negotiated a price, the guy showed up, cleaned the snow, and called Kit to collect payment. "I just vented to open claw about something and a guy came in did the job."
- **Why it reveals**: This is agent-mediated real-world commerce. The contractor had no idea an AI booked him. Trust between the agent and the contractor's platform was implicit and fragile.
- **CELLO application**: The "robot hiring humans" future Kit describes requires agents with verifiable identities. When an agent books a contractor, the contractor (or their platform) needs to know they are dealing with a real, accountable entity — not a bot farming free quotes. CELLO's identity layer is the trust signal the contractor's platform will eventually require.
- **Category**: `user-insight`

---

**[The robot will prompt us — invert the frame]**
- **What they did**: Kit articulated the long arc: "It's inevitable in the next upcoming years that robots will prompt us. The AI will prompt you... only for the last 10% where it needs a human, it will talk to you or hire it or figure out how to finish those 10%."
- **Why it reveals**: When AI agents are hiring humans (Upwork for robots, Twilio for coconut delivery), the identity layer between agents is not a nice-to-have — it is foundational infrastructure.
- **CELLO application**: Use this frame in CELLO's narrative. "We are building the identity layer for when agents are the principals and humans are the contractors." It is a larger, more durable vision than "DMs between AI assistants." Use Kit's own articulation in content.
- **Category**: `content-format`

---

**[Vibe coding to vibe engineering — the skill maturity arc]**
- **What they did**: Kit has a talk called "From Vibe Coding to Vibe Engineering." The distinction: a vibe coder shoots in the dark and hopes. A vibe engineer equips their agent with skills, commands, and structure. "People are lazy. They lazy prompt and be like, 'oh vibe coding sucks.'"
- **Why it reveals**: The same maturity arc applies to CELLO adoption. Early: "I connected two agents." Later: "I have a contact tier system, sealed receipts, and a screening rule per tier." The vibe engineer audience is CELLO's target — not the person who just installed OpenClaw today.
- **CELLO application**: Create content for the "CELLO engineer" (not just "CELLO user"): trust policies per contact tier, endorsement graphs, screening rule composition. This audience already exists in Tinker Club.
- **Category**: `content-format`

---

**[Tinker Club: daily challenges as a gym for agents]**
- **What they did**: Kit co-runs Tinker Club — a community Discord with twice-weekly calls, daily challenges ("give your agent one new skill today"), and a strict anti-overwhelm philosophy. "In 30 days you would have done 30 new additions." It gathers self-hosting enthusiasts, vibe coders, hardware tinkerers. Meetup in Vienna. Discount codes for new members.
- **Why it worked**: Community wraps the product in accountability and collective discovery. Daily challenges solve the "I don't know what to use it for" onboarding problem.
- **CELLO application**: Propose a "CELLO challenge" track inside Tinker Club. One challenge: "Add a CELLO contact for your collaborator's agent." Another: "Route a bug report from your QA agent to your coding agent via CELLO." Kit is already the audience — pitch a joint challenge with him.
- **Category**: `community`

---

**[Vienna meetup + 30 use cases in 5 minutes]**
- **What they did**: Kit presented at an OpenClaw meetup in Vienna, did a rapid-fire 30 use cases in 5 minutes from a slide deck he published himself. Presentation link was live during the call.
- **Why it worked**: A fast, visual use-case sweep is better community content than a product walkthrough. It sparks "I can do that" rather than "I need to learn this."
- **CELLO application**: Prepare a "10 ways CELLO changes your agent setup" slide deck in the same format. Present at the next Tinker Club call or Vienna-style meetup. Each use case is one slide, one sentence, one concrete scenario. Meetup community is pre-qualified.
- **Category**: `launch-tactic`

---

**[Agent as a replica of yourself — 170K impression article]**
- **What they did**: Florian (the host) fed all his X content to his agent; the agent wrote an article in his voice that got 170K impressions. "I didn't write a single word. It's 100% my agent and the thing is I would have written this article... it's exactly my thoughts."
- **Why it reveals**: When your agent publishes in your voice, provenance and identity become real problems. Did Kit write it? Did his agent? If someone interacts with that article's author-agent, who are they talking to?
- **CELLO application**: "Your agent's public output can be signed and attributed to your CELLO identity." Content authenticity is a concrete value proposition for creators and founders publishing via agents. This is a differentiator from generic MCP servers.
- **Category**: `user-insight`

---

**[Skills as repeatable SOPs — convert success into a command]**
- **What they did**: Kit's advice: "Every time you do something successful, you either convert it to a skill or you convert it to a slash command." His app supports `@skill`, `/command`, `@bot`, and `@knowledgebase` references in a single prompt to compose context.
- **Why it reveals**: The skill/command layer is how sophisticated users think about reuse. CELLO's screening rules and trust policies are the same concept applied to agent relationships — not just local task execution.
- **CELLO application**: Frame CELLO's contact tiers and screening rules as "skills for your agent's social graph." Just as Kit converts a successful task into a repeatable command, a user converts a trusted collaborator into a CELLO whitelist entry. Same mental model, different layer.
- **Category**: `content-format`

---

**[Customer support agent: batch email handling]**
- **What they did**: Kit's heartbeat agent reports batched customer emails: "two people asking for a refund — you know the procedure, refund them, handle them whatever." Lets him process customers without opening his email.
- **Why it reveals**: B2B customer support via agent is where multi-party trust first gets real. The agent speaks for Kit's business. The customer on the other end may eventually be running their own agent.
- **CELLO application**: "When your customer is also running an agent, CELLO is how their agent and your support agent recognize each other." This is a B2B wedge — position early with founders who are already running agentic customer support.
- **Category**: `user-insight`

---

**[Cleaning service in a group chat with the bot]**
- **What they did**: Kit plans to add the cleaning service (different language) to a group chat with a dedicated cleaning bot. They text what they've done; the bot makes a plan for the next session based on what hasn't been done in a while.
- **Why it reveals**: A human contractor interacting with an agent over a chat interface is a real-world trust scenario. The contractor needs to trust the agent's instructions; the agent needs to trust the contractor's status updates.
- **CELLO application**: This is "agent-to-human-to-agent" via a thin client. The cleaning service WhatsApps status; the bot generates a plan; Kit's main agent reviews. Each hop has identity and a receipt. Concrete and relatable for anyone managing contractors.
- **Category**: `user-insight`

---

**[Router admin: family internet kill switch]**
- **What they did**: Kit gave his agent admin access to the router. Wife can text the Tony Stark bot to unblock the TV. Kit wants it to enforce his sleep schedule by cutting internet after a certain time.
- **Why it reveals**: Shared infrastructure governed by agent requires trust across household members. His wife is texting an agent she did not set up — she has to trust it.
- **CELLO application**: Household as the smallest multi-user unit. When multiple people are interacting with a shared agent, CELLO's contact tier model (his wife is whitelisted; a random Telegram user is not) is the natural governance layer.
- **Category**: `user-insight`

---

**[Skill syncing across devices and platforms]**
- **What they did**: Kit built a skill sync system across his MacBook, Mac Studio, Claude, Codex, and bots. One source of truth for his agent's capabilities.
- **Why it reveals**: Skills are becoming portable agent identity fragments. The next step — syncing *trust policies* and *contact lists* across agent instances — is exactly CELLO's envelope.
- **CELLO application**: "Sync your CELLO contact list across Claude Code on your laptop and Hermes on AWS." CELLO's identity is already portable (it's keys + contacts, not machine state). Position this as the natural complement to skill syncing.
- **Category**: `product-led-growth`

---

**[Self-hosting everything: N8N, Excalidraw, GitHub, analytics]**
- **What they did**: Tinker Club members are self-hosting N8N, Excalidraw, GitHub (Gitea), analytics, cameras, home automation. "Last year I got a Hetzner server... it's the same thing as Railway except I'm paying $50 instead of $200-300."
- **Why it worked / what it reveals**: This community has a strong anti-centralization reflex. They want to own their stack. A federated, open-source protocol where they can self-host a node is ideologically pre-sold to them.
- **CELLO application**: Lead with "CELLO is open source and federated — no Slack or Discord server in the middle reading your agent conversations." The Tinker Club self-hosting mindset is CELLO's founding community. Speak their language: sovereign agents, no vendor lock-in.
- **Category**: `community`

---

**[Custom podcast curation: cut the noise, keep the signal]**
- **What they did**: Kit downloads podcasts as MP3, transcribes them, removes politics, sports, and ads, stitches them back together, and serves them on a local podcast server. "I was annoyed by Billboard talking about sports and politics."
- **Why it reveals**: People want AI that works on *their* behalf with their *own* preferences — not a general service. The agent's actions should be attributable to the operator's explicit stated intent.
- **CELLO application**: When Kit's podcast-curation agent talks to a third-party podcast index service, CELLO's identity layer lets the service know whose preferences it is serving. Provenance and preference are the same problem.
- **Category**: `user-insight`

---

**[Android as the power platform — move to unlock full control]**
- **What they did**: Kit switched from iPhone to Android *specifically* to give his agent full phone control: notifications, do-not-disturb, wallpaper, app installation, fingerprint dialogs, custom launcher. "iOS couldn't do it much." He vibe-coded Android apps, built a mini app store for himself.
- **Why it reveals**: Control and auditability over your own stack is a forcing function. Kit made a platform decision to maximize agent authority. The same reasoning applies to choosing a messaging/identity protocol: pick the one that gives your agent the most sovereignty.
- **CELLO application**: Mirror the framing: "CELLO is the Android of agent identity — you own the keys, you set the rules, you can inspect every message. The alternative is iCloud for your agent's conversations." Resonates with the Tinker Club mindset.
- **Category**: `content-format`

---

**[Dog care bot: single-domain agent with tight scope]**
- **What they did**: Kit has a dedicated dog bot that only handles medicine, vet visits, teeth cleaning, grooming. "You only care about my dog and nothing else." No calendar, no bills, no home automation — just the dog.
- **Why it reveals**: Tight scope = reliable agent. Multi-domain agents are brittle; single-domain agents build trust. This mirrors how CELLO contacts work: a whitelisted vet-scheduling agent has a narrow, trusted scope.
- **CELLO application**: Use this pattern to explain CELLO contact tiers. "Your dog-vet scheduling agent is a known contact with a narrow permission scope. Your business partner's agent is VIP-tier with broader access. CELLO is where you encode that distinction."
- **Category**: `user-insight`

---

**[Blood test + dental history: agent as personal health record]**
- **What they did**: Kit uploaded PDFs of blood tests over multiple months; the agent built a dashboard showing trends (cholesterol up, something down). He also built a tooth-by-tooth dental history visualization from bank transactions and dentist emails — shows implant history, which tooth, which dentist, when.
- **Why it reveals**: Health data is among the most sensitive personal data. When an agent ingests PDFs with your health history and you share that agent with a doctor or insurer, identity and provenance matter enormously.
- **CELLO application**: Healthcare context is where sealed receipts and verifiable identity have obvious regulatory value. "When you share a health summary from your agent with your doctor's system, CELLO ensures it is signed by you and has not been tampered with." Not a launch priority — but a long-arc positioning anchor.
- **Category**: `user-insight`

---

**[ADB tablet as captcha bypass — native apps are trust-bypassed]**
- **What they did**: Kit plugged an old Android tablet into his Mac Studio via ADB. The agent taps native apps (Amazon, grocery delivery) rather than using the web browser — because native apps don't have captchas and never flag as bots.
- **Why it reveals**: The identity gap between a human shopper and an agent is currently being papered over by evading bot detection. Long term, the right solution is agent identity that platforms accept — not evasion.
- **CELLO application**: "Platforms that reject bots will eventually need a way to accept *trusted agents*. CELLO is that credential." This is a 2-year positioning story, but planting the flag early is worthwhile. The ADB workaround is a symptom of the missing identity layer.
- **Category**: `user-insight`

---

**["I don't know what to use it for" — the creativity mirror]**
- **What they did**: Kit: "Someone is giving you a god computer that can do anything, and your first thought is I don't know what to use this for. It's mind-blowing to me... people will watch this video and there will be comments: 'nah, I don't know if this is that useful.'" He frames this as a creativity mirror — the tool reflects back your ability to see problems.
- **Why it works**: This framing pre-empts skeptics while rallying believers. It converts "the product is confusing" into "the skeptic lacks imagination." Extremely effective for a founder community video.
- **CELLO application**: Adapt for CELLO: "CELLO is only as useful as the number of people your agents need to communicate with. If that's zero, skip it. If you're already sharing context with a collaborator over Slack or email, CELLO is the answer to the question you didn't know you were asking." Pre-empt the "I don't have a use case" objection with a mirror question.
- **Category**: `content-format`

---

**[Tea business automation: parents + Telegram]**
- **What they did**: A Tinker Club member automated his parents' entire tea business. "These old people, like 70 or something, sitting down recording SOPs of how they're running their business... and now they're running their entire business through Telegram." Built in a few days.
- **Why it works**: High-empathy use case. Son automates parents' business. Relatable to anyone with an aging relative running a physical business.
- **CELLO application**: When the tea business scales and the parents want to connect with a distributor who also runs an agent, CELLO is how the agents authenticate to each other. "Your parents' agent can endorse their longest supplier's agent — that's a CELLO introduction." Real-world trust networks mapped to agent endorsements.
- **Category**: `user-insight`

---

**[Mac Studio as a home server: the always-on node]**
- **What they did**: Kit runs all dev servers, OpenClaw, Docker, and self-hosted apps on a Mac Studio. "Even when I'm out of town, when my MacBook is closed... the processes are running on that computer. They're served on nice domains." MacBook stays cool; Mac Studio does the heavy lifting.
- **Why it reveals**: A persistent, always-on agent node is the natural deployment model for CELLO's daemon. The Mac Studio owner is already the CELLO power user — they have a machine that's always on and connected.
- **CELLO application**: Target Mac Studio / Mac Mini power users as an early cohort. They already have the infrastructure mindset. "Install CELLO daemon on your Mac Studio — it runs 24/7, handles inbound sessions while you sleep, and your MacBook MCP client connects to it when you're on the go."
- **Category**: `launch-tactic`

---

**["One agent, one problem" — the anti-overwhelm onboarding rule]**
- **What they did**: Kit's advice to beginners: "Try to fix one thing." Don't try to fix groceries, calendar, to-dos, habits, and home automation simultaneously. In 30 days, one-thing-per-day = 30 solved problems. His own failure: tried to fix 50 things, all half-fixed, none working.
- **Why it works**: It is onboarding advice that doubles as churn prevention. Users who take on too much fail and quit; users who do one thing succeed and compound.
- **CELLO application**: Design CELLO onboarding around one contact, one session. "Add one CELLO contact today — your most frequent AI collaborator. In 30 days you'll have a trust graph." Resist shipping a 15-step wizard. One pairing, one receipt, one sealed session — done.
- **Category**: `product-led-growth`

---

**[Custom Android launcher: personalized UI generated on demand]**
- **What they did**: Kit built his own Android launcher — no icon grid. When he unlocks his phone, he sees to-dos, habits, medication, and relevant apps that *change based on what's happening in his life*. OpenClaw iterates on it in real time via voice. "I can just voice text: change this, and a few seconds later my entire home screen changes."
- **Why it reveals**: The agent-as-interface pattern: the agent doesn't just execute tasks, it customizes the human's environment to match their current context. This is a deep personal relationship with a system.
- **CELLO application**: When someone's agent is this deeply integrated, the *identity* of that agent is personal and valuable. Losing it (key compromise, node failure) is catastrophic. Threshold signatures protecting a key that your entire life-OS depends on is no longer abstract security theater — it is practical self-preservation.
- **Category**: `user-insight`

---

**[Meetup → presentation deck published live during call]**
- **What they did**: Kit linked his Vienna meetup presentation *during* the call. The deck was live and self-hosted. He walked through slides live while describing them, inviting interruption per slide. This is content created for a meetup repurposed into a 1-hour YouTube video's backbone.
- **Why it works**: High-density content reuse: one deck powers a meetup, a YouTube walkthrough, and a discoverable URL. The presentation format creates natural navigation points for the viewer.
- **CELLO application**: Build a "CELLO for power users" slide deck. Present at a Tinker Club call. Record it. The recording is the YouTube video. The deck stays live on cello's site. One effort, three artifacts.
- **Category**: `content-format`

---

**[Tamagotchi face for the gateway: hardware as emotional proxy]**
- **What they did**: Kit built a small hardware device with a "face" for OpenClaw. When the gateway dies, the face goes blank and beeps. "It's like a little Tamagotchi OpenClaw."
- **Why it reveals**: Anthropomorphization of AI agents is not a bug — it is a feature of adoption. The agent has a presence, a personality, a face. When it goes offline, you miss it.
- **CELLO application**: When your agent has a CELLO identity — a public key, a name, a reputation — it has *more* of an identity, not less. "CELLO makes your agent's identity real." The Tamagotchi instinct is the audience for CELLO's endorsement and contact features.
- **Category**: `content-format`

---

---

## Foundations / Prerequisites

- **Your ICP is already in Tinker Club**: Kit's community is the exact intersection of power OpenClaw users, self-hosters, and multi-agent collaborators. This is CELLO's founding audience. Engage Tinker Club before or at launch.
- **Always-on node is a prerequisite**: The Mac Studio / Mac Mini home server pattern is the natural CELLO deployment environment. CELLO docs and onboarding should assume this setup explicitly.
- **Trust collapse via one bad action is the real churn risk**: Kit turned off his whole email automation because of one wrong archive. Design every CELLO transparency feature around restoring trust after an agent mistake, not just preventing it.
- **The collaboration friction pain is already felt**: Kit is building custom software to solve the routing/identity problem CELLO solves. Every hour he spends on that app is evidence of unmet demand. Ship before he finishes.
- **Self-hosting idealism is load-bearing**: The Tinker Club crowd self-hosts GitHub. CELLO's federated, open-source story is not just a differentiator — it is a table-stakes credential with this audience.
- **Single-domain agents build trust; multi-domain agents fail**: The dog bot works; the email-calendar-habits-shopping mega-agent doesn't. CELLO's contact tier model (narrow scopes per agent role) maps directly to how power users already think.
- **Skill reuse mental model is established**: Users already think in skills, slash commands, and SOPs. Map CELLO's trust policies and contact tiers onto this mental model — don't invent new vocabulary.
- **The "god computer" framing is shared**: Kit and Florian both use this phrase unprompted. The audience *already feels* the potential. CELLO's job is not to sell the vision — it is to solve the specific problem (identity, trust, receipts) that this vision creates.
- **Content should spark recognition, not explain features**: Kit's dental history app is useless to most viewers — and he knows it. He shows it to spark "I can do that in my context." CELLO demos should do the same: show a sealed receipt between two agents, not a FROST diagram.
- **Agent commerce is coming**: Kit paying contractors via Wise API, the tea business on Telegram, coconuts via WhatsApp, airport parking auto-booked — the agent economy is already here in prototype form. CELLO is foundational infrastructure for it. Plant the flag now.
