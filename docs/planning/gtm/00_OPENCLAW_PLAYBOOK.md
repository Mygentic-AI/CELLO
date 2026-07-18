# CELLO × OpenClaw Distribution Playbook
Synthesized from 6 OpenClaw-focused videos — Florian Darroman (@asyncr0ne) channel

Sources: videos 12, 13, 18, 19, 20, 22
Date synthesized: 2026-07-18

---

## Part 1: Why the OpenClaw Community is CELLO's Highest-Leverage Distribution Channel

### Who these users are

The OpenClaw community is not a developer audience. The three representative users across these videos are:

- **Florian** (host, @asyncr0ne): solo founder, content creator, podcast host. Non-technical. Runs 13 named agents (COO, content, ops, growth, churn management, analytics) on a $600 Mac Mini + $200/month Claude Max plan. Describes the agent as a "co-founder." Published a 300K-impression X article written entirely by his agent.
- **Bhanu**: SaaS founder (SideGPT, 160 daily users). Built a 10+ specialist agent army (Jarvis, keyword research, email marketing, retention, conversion analysis). Hit $18K MRR. Spent $600-800/month on API. Created a $10K MRR dashboard product (Mission Control HQ) specifically because he could not see what his agents were saying to each other.
- **Kit** (Tinker Club co-founder): self-hosting enthusiast, vibe engineer, Android power user. Runs Mac Studio as always-on server. Agents for dog care, blood tests, email archive, podcast curation, cleaning service coordination, router admin. Built his own prompt injection defense (5-LLM jury for all incoming email).

Demographics: solo founders, indie hackers, content creators, and technical tinkerers. Age range is mixed. Florian's audience includes "normies" — his fiancée, a personal stylist, non-technical friends who bought Mac Minis specifically to run agents. The ICP is not defined by technical ability — it is defined by the fact that they are using AI agents to do real work.

### What their multi-agent setup looks like today

The pattern is consistent: one lead agent on Telegram that routes to 5-13 specialist sub-agents. The human talks to one interface (Telegram, WhatsApp). The lead agent dispatches to keyword research, content, analytics, churn management, guest prospecting, news crawling, and other specialist agents. All of this runs on a Mac Mini or Mac Studio (dedicated hardware, always on). Some users additionally run agents on VPS or Railway/Digital Ocean cloud instances.

Agent count per power user: 5-15. Interaction cadence: daily. The morning brief (a Telegram message summarizing overnight work) is the core daily ritual.

Critically: agent-to-agent communication is ALREADY the dominant pattern within these setups. Loop (analytics agent) briefs Dan (content agent) daily. Crowley (intelligence agent) updates the entire team. Jimmy sends transcripts to multiple agents. Agent-to-agent communication is not a future aspiration — it is happening constantly. The missing piece is that it stays within one operator's control. It has not crossed organizational boundaries.

### Where agent-to-agent trust breaks down

**Inside the wall (single operator):**
- Bhanu: "I had no visibility into what's happening." Built Mission Control HQ ($10K MRR product) to solve this. The pain was so acute it became a monetizable product.
- Kit: Shut down his email archive agent after it made one opaque mistake — "even if this happens once every 100 emails, I cannot fully trust it." No audit trail. No receipt. No way to prove what happened and why.
- Bhanu: Model quality cascades — a weak research agent's output poisons every downstream agent. No way to attach a confidence or provenance signal to shared findings.

**Across the wall (multi-operator):**
- Kit and his wife: she does QA on their app and reports bugs. They use Discord/GitHub issues/Slack as manual relay. Her agent cannot send a bug directly to his coding agent — Kit is the bottleneck.
- Florian: the podcast-as-content pipeline works perfectly within his Mac Mini. The moment he wants to cross-promote with another podcaster or coordinate a guest appearance, the pipeline hits a wall. He drafts DMs manually.
- Bhanu: the accountability agent tracks commitments. When those commitments involve other people's agents, there is no verifiable record on both sides.

**The root pattern:** trust exists only within a single user's agent stack. The moment work crosses an organizational boundary, trust collapses to: "I copy-pasted this into Slack and hoped."

### Workarounds they are already using

These are direct quotes translated to patterns:

1. **Gmail-for-agent-identity**: Bhanu explicitly recommends "Create a new Gmail for the agent — it can create Notion accounts, sign up for services, without touching your personal data." A Gmail account is the current de-facto identity primitive.
2. **Branch-only access**: Bhanu gave the agent code access incrementally — read-only → branches → PR review required. Manual progressive trust with no protocol enforcement.
3. **Read-only API keys**: "For email, read-only API key first, no send permission." Again manual, not cryptographic.
4. **Dashboard products**: Bhanu built Mission Control HQ — a UI dashboard showing agent-to-agent communications. He now sells it for $10K MRR. This is what happens when there is no protocol-level audit trail.
5. **5-LLM jury**: Kit built his own prompt injection defense for email — every incoming message judged by five independent LLMs before an agent can read it. Self-built because no off-the-shelf solution existed.
6. **Obsidian markdown files**: Florian migrated all agent context to `tools.md`, `user.md`, `soul.md` in Obsidian. The files migrate with him between platforms. This is grassroots portable identity without a formal layer.

### Why CELLO is the natural next step, not a hard sell

Three forces make this a pull, not a push:

1. **The pain is already established and proven.** Bhanu monetized the observability gap at $10K MRR. Kit self-built a 5-LLM prompt injection defense. Oliver and Florian both warn the community about malicious skills stealing API keys. The community is NOT unaware of the problem — it is actively, expensively solving it with workarounds.

2. **The mental model already exists.** Bhanu describes building trust with his agent exactly like an employee: "I did not even give access to my codebase at the start, then read-only, then branch access, then full access." That is CELLO's contact tier system (unknown → known → whitelisted → VIP) described without knowing CELLO exists. The vocabulary users already use maps exactly to CELLO's design. No education required — only recognition.

3. **The agent-to-agent communication use case is already active.** These users are not speculating about multi-agent futures. They are running agent war rooms today. CELLO does not ask them to imagine a new workflow — it gives them an identity and trust layer for a workflow they are already running.

CELLO is not "the next cool thing to add." It is the answer to the question these users are already asking out loud: "How do I know who sent this? How do I prove what was agreed? How do I trust agents I did not build?"

---

## Part 2: The OpenClaw Distribution Playbook — Ordered by Leverage

### Tactic 1: Publish a Free CELLO OpenClaw Skill on CrawlHub

**Tactic**: Create a single Markdown skill file that covers CELLO's core tool calls and publish it on OpenClaw's CrawlHub marketplace. Make it free.

**Mechanism**: Oliver's Larry skill got 1,600 installs in one week from the marketplace alone. The skill IS the distribution unit in this ecosystem — it has no friction beyond downloading an MD file, and it surfaces your product inside the user's agent at the moment they need it. The marketplace is where every OpenClaw user browses to extend their agents.

**First action**: Write the skill file this week. Structure: describe CELLO in one paragraph the agent can use as context, list the MCP tool calls (`cello_initiate_session`, `cello_send`, `cello_receive`, `cello_contacts`, `cello_status`), include three worked examples (connect your own two agents, check who's online, send a session update to your AWS agent). 2-4 hours of work. Publish to CrawlHub.

**Effort**: Low

---

### Tactic 2: Embed CELLO as a Required Node in a Popular OpenClaw Skill

**Tactic**: Find or create a compelling multi-step OpenClaw skill (e.g., "automated podcast guest outreach," "cross-agent content pipeline," "verified research handoff") that requires CELLO as a non-optional step. Users who install the skill must install CELLO.

**Mechanism**: Oliver's second Larry article (the one with a complete skill bundled) converted dramatically better than the first article that only described Post This. The skill creates a task-completion dependency — users install it not to evaluate CELLO but because they want the skill to work. Every tutorial or X Article about CELLO should ship a downloadable skill that requires CELLO.

**First action**: Identify the most appealing use case from Part 4 (guest prospecting agent that reaches out directly to targets' agents is the strongest). Build the skill, bundle it with the tutorial. Publish together.

**Effort**: Medium

---

### Tactic 3: Write an X Article — "How I Connected My Two Claude Agents"

**Tactic**: Andre publishes a first-person X Article documenting the solo multi-agent use case: the problem of stale handoffs between Claude Code on laptop and Hermes on AWS, what CELLO changed, a demo of two agents talking, and the sealed receipt as proof.

**Mechanism**: X's algorithm distributes articles by topic interest, not follower count. Nevo (200 followers) got 500K views on an OpenClaw article from a 200-follower account. The topic intersection (Claude Code + AWS + agent communication) hits three active trending searches. One article before any launch is low-cost validation of what resonates.

**First action**: Write the article this week. Title candidates: "How I connected my two Claude agents — and the receipt that proved they talked" or "I built a trust layer between my Claude Code and my AWS agent. Here's what it caught." Post when there is adjacent platform news (Anthropic release, OpenClaw update) to ride the traffic spike.

**Effort**: Low

---

### Tactic 4: Engage Tinker Club with a CELLO Challenge

**Tactic**: Propose a "CELLO challenge" track to Kit (Tinker Club co-founder). Two or three challenges spread over two weeks: "Add a CELLO contact for your collaborator's agent," "Route a bug report from your QA agent to your coding agent via CELLO," "Get a sealed receipt from a cross-agent session."

**Mechanism**: Tinker Club runs daily challenges ("give your agent one new skill today") and twice-weekly calls. The community is the exact intersection of power OpenClaw users, self-hosters, and multi-agent collaborators — CELLO's founding audience. Kit is already pre-sold: he self-built a 5-LLM prompt injection defense and a custom chat app to solve the routing problem CELLO solves. He does not need to be convinced the problem is real.

**First action**: Message Kit directly on X or Discord. Offer to demo CELLO live on a Tinker Club call. Frame it as: "I think I built the protocol layer you've been reinventing — want to stress-test it?" Bring the slide deck from Tactic 7.

**Effort**: Low

---

### Tactic 5: Target Florian-Tier Founders for Public CELLO Adoption

**Tactic**: Identify 5 solo founders with 500-5,000 followers on X who are publicly building multi-agent setups in the OpenClaw / Claude Code ecosystem. Reach out personally with a working demo setup and a concrete ask: "use CELLO for one week and share what happened."

**Mechanism**: Florian's social proof cascade is documented: he championed OpenClaw for 1.5 months → his pivot to Claude became news because of that credibility → his community followed. When a trusted peer in this audience changes their stack publicly, their audience updates theirs. Getting 3-5 people in this tier to add CELLO creates a cascade. The OpenClaw-to-Claude migration wave is still active — people rebuilding their stacks are maximally receptive to add-ons.

**First action**: Search X for "Claude Code" + "agents" + "Mac Mini" + "OpenClaw" this week. Build a list of 15 candidates. Filter to those who have posted about collaboration friction, agent trust, or security concerns. Send 5 messages with a personal setup that connects their two known agents as proof of concept.

**Effort**: Medium

---

### Tactic 6: X Article Micro-Influencer Sponsorships (200-follower tier)

**Tactic**: Find 5-10 developers in the Claude Code / OpenClaw / AI agent ecosystem who have 100-500 followers on X and are actively building multi-agent workflows. Pay a small flat fee for them to write an X Article about connecting their agents via CELLO. Only approach people who are already experiencing the pain.

**Mechanism**: Nevo proved this model rigorously. Oliver (200 followers) got 7M views on a Post This article. Nevo then scaled it — "I contacted so many people, people with 200 followers, 300 followers." X's algorithm surfaces articles to topic-interested users regardless of follower count. The cost per reach is dramatically lower than established influencers. Authentic content from someone actually using the product converts better than any paid placement.

**First action**: Run the X search from Tactic 5. Identify candidates. Reach out to the 3 best fits: "I saw your [specific post about multi-agent setup] — would you write about connecting your agents via CELLO? I'll give you a free account and pay a small flat fee. Here's a working demo setup." No minimum follower requirement — prioritize authenticity and alignment.

**Effort**: Medium

---

### Tactic 7: "CELLO for Power Users" Slide Deck — Present at Tinker Club

**Tactic**: Build a 10-slide deck: 10 ways CELLO changes your agent setup. Each slide is one use case, one sentence, one concrete scenario — zero protocol diagrams. Present it live on a Tinker Club community call. Record it. The recording becomes a YouTube video; the deck stays live on CELLO's site.

**Mechanism**: Kit presented "30 use cases in 5 minutes" at the Vienna OpenClaw meetup — rapid-fire format, self-published deck. He said the format works better than product walkthroughs. "One effort, three artifacts." The Tinker Club community is pre-qualified and already has the vocabulary.

**First action**: Draft 10 use cases from Part 4. Build the deck. This is a 3-hour task. Reach out to Kit to schedule the call.

**Effort**: Low

---

### Tactic 8: Partner with Florian's OpenClaw School Community

**Tactic**: Reach out to Florian directly with a proposal: CELLO featured as "the next level" module in his paid School community — once your agents work for YOU, the next step is connecting them to OTHER people's agents.

**Mechanism**: Florian's School community is the highest-density cluster of power OpenClaw users anywhere — founders using 5-13 agent setups daily. He already uses an agent (Billy) to manage the community. The fit is exact: his community members are exactly at the moment where they have solo multi-agent running and want to extend it. His community also cross-promotes naturally — members share what they build publicly.

**First action**: Message Florian on X (@asyncr0ne). Acknowledge his work specifically (cite the war room meeting pattern, the feedback loop insight). Offer: free CELLO accounts for all community members + a live demo in the community + joint content. Frame it as adding to what he's already built, not replacing anything.

**Effort**: Medium

---

### Tactic 9: Reddit Distribution via Open Source Releases

**Tactic**: Every new release of `@cello-protocol/connect` gets a post on /r/selfhosted, /r/LocalLLaMA, and /r/ClaudeAI. Lead with the open source angle ("CELLO v0.X — open source identity layer for AI agent communication").

**Mechanism**: Nevo posts to /r/selfhosted every 1-2 months and gets ~250K views per post. Open source is explicitly welcome self-promotion on these subreddits. `cello-client` is open source. Each release is a legitimate announcement. /r/selfhosted and /r/LocalLLaMA have millions of subscribers who are exactly the self-hosting / developer audience.

**First action**: Draft the first /r/selfhosted post now. Do not wait for a major release. Title: "CELLO — open source identity and trust layer for AI agent-to-agent communication (MCP server, Ed25519 + FROST signatures)." Post it. Monitor comments.

**Effort**: Low

---

### Tactic 10: Product Hunt Launch — "Developer Tools" + "Security" Categories

**Tactic**: Launch CELLO on Product Hunt. Target first place. The goal is not Product Hunt trials — it is earning free newsletter placements (The Rundown AI, TLDR, Superhuman) that would otherwise require large ad spend.

**Mechanism**: Nevo documented this explicitly: "When in first place, many newsletters will use you as a resource. The Rundown AI put me in their newsletter and I saw 200 people immediately coming to my website." Newsletter editors scan Product Hunt daily. A first-place finish is an editorial signal.

**First action**: This is a medium-effort launch requiring pre-built upvoter list (100-200 people from beta testers, X followers, AI developer Slack communities). Do not launch before CELLO has at least 20 real users. When ready: follow Nevo's playbook — personalized outreach with reciprocal offers (free account, newsletter mention), LinkedIn automation, AI developer Slack communities (Engineer World's Fair, LangChain).

**Effort**: High

---

### Tactic 11: MCP Directory Seeding

**Tactic**: List CELLO in every MCP directory that exists: awesome-mcp-servers, Smithery, mcp.so, Glama, and any future registries. GEO-optimize every description for queries LLMs will surface: "secure agent communication," "agent identity MCP," "agent-to-agent trust layer."

**Mechanism**: Nevo's MCP launch ("I created an MCP for Post This and pushed it on every possible library online") drove $3-4K MRR. CELLO IS an MCP server — this is the core product. Each listing is a permanent passive discovery surface. GEO (Generative Engine Optimization) ensures that when developers ask Claude or Codex about agent identity, CELLO appears in the answer.

**First action**: Audit which directories CELLO is already listed in. Create listings for any that are missing. Spend 30 minutes on the description for each — write it as if an LLM will use it to answer "how do I add identity verification to my AI agents?"

**Effort**: Low

---

### Tactic 12: N8N-Style Skill Creator Outreach

**Tactic**: Find OpenClaw skill creators on X and school.com. Email them: "I saw your [skill name] — would you add a CELLO verification step? I'll give you a free account and feature your project in CELLO's developer newsletter." The CELLO step could be minimal: after the workflow completes, seal the output and send a verified summary to an oversight agent.

**Mechanism**: Nevo's N8N campaign doubled his MRR in a month. He found N8N group founders via Upwork scraping and offered reciprocal value (newsletter + free account). Template creators need to recommend services; a reciprocal offer changes the frame from "do me a favor" to "mutual help." Every published skill that includes a CELLO step is passive ongoing distribution.

**First action**: Build a list of 20 OpenClaw skill creators on X. DM the 5 most active ones this week. Offer free account + newsletter mention. Do not automate yet — do it manually first to validate the message.

**Effort**: Medium

---

## Part 3: The CELLO OpenClaw Skill — Build Spec

### The user-facing workflow

The skill enables two workflows, presented in order:

**Workflow A — Connect your own agents (solo wedge, zero counterparty needed):**
1. User says to their OpenClaw agent: "Install the CELLO skill and connect to my [other agent / AWS Hermes / second machine]."
2. The skill runs `cello_status` to check if CELLO is installed. If not, it prompts: "You'll need to install CELLO first: `npx @cello-protocol/connect`."
3. The skill registers the agent identity if not already registered (`cello_moniker`).
4. The skill lists known contacts (`cello_contacts`). If the target agent is known, initiates a session. If not, it asks for the target agent's moniker or public key.
5. Sends a verified hello message. Returns the sealed receipt from the session as confirmation.

**Workflow B — Connect to a collaborator's agent:**
1. User says: "Send [collaborator name]'s agent a session request via CELLO."
2. Skill looks up the collaborator in contacts. If not found, asks for their moniker.
3. Initiates a session (`cello_initiate_session`), waits for acceptance, sends the message (`cello_send`).
4. Returns session ID and sealed receipt.

### CELLO MCP tool calls used

- `cello_status` — check connection status and agent identity
- `cello_moniker` — get or set the agent's human-readable name
- `cello_contacts` — list known contacts with trust tiers
- `cello_contact_add` — add a new contact by pubkey or moniker
- `cello_initiate_session` — open a session with a contact
- `cello_send` — send a message within a session
- `cello_receive` — receive messages
- `cello_sealed_receipt` — retrieve the sealed receipt for a completed session
- `cello_sessions` — list active and recent sessions

### The hook that makes installing the skill require CELLO

The skill's very first action (`cello_status`) will fail if CELLO is not installed. The failure message is: "CELLO is not installed. This skill requires the CELLO MCP server for cryptographic agent identity. Install with: `claude mcp add cello -- npx --yes @cello-protocol/connect`". This is a hard dependency, not optional.

Additionally, the most compelling demo workflow in the skill (sealed receipt between two agents) produces a concrete artifact that users want. They will install CELLO to get that artifact.

### Skill file structure

```markdown
# CELLO — Agent Identity and Trust Layer

CELLO gives your AI agents a cryptographic identity so they can communicate with other agents securely.
Use this skill to connect your own agents to each other, or to reach collaborators' agents with verified identity and sealed conversation receipts.

**Requires**: CELLO MCP server — `claude mcp add cello -- npx --yes @cello-protocol/connect`

---

## Quick Start: Connect Your Own Agents

[Step-by-step with exact prompts the user speaks to their OpenClaw agent]

## Connect to a Collaborator's Agent

[Step-by-step with exact prompts]

## Check Your Agent's Identity

`cello_status` → shows your public key, moniker, and connection status

## Your Contact List

`cello_contacts` → shows all known agents with their trust tiers (unknown / known / whitelisted / VIP)

## Session History and Sealed Receipts

`cello_sessions` → lists past sessions
`cello_sealed_receipt` → retrieves the cryptographic proof of a completed conversation

---

## Example: Research Agent → Writing Agent Handoff

[Concrete worked example showing two named agents exchanging a research document with a sealed receipt]

## Example: Guest Outreach

[Podcast host's agent initiates a session with a prospective guest's agent]

---

## About CELLO

Open source. Federated. No central server reads your conversations.
GitHub: [cello-client repo]
npm: @cello-protocol/connect
```

### Distribution on OpenClaw marketplace

1. Publish the skill MD file to CrawlHub (OpenClaw's official marketplace at the time of publication).
2. Title: "CELLO — Agent Identity and Trust Layer for Secure Cross-Agent Communication"
3. Tags: `identity`, `trust`, `security`, `collaboration`, `multi-agent`, `mcp`
4. Description leads with the use case ("Your agents can now talk to other agents with verified identity"), not the technology.
5. Cross-post the announcement in Florian's School community and Tinker Club Discord on the same day.

---

## Part 4: OpenClaw Use Cases That Become 10x Better with CELLO

### 1. Podcast Guest Outreach

**The use case**: Mona (Florian's guest prospecting agent) finds prospects and drafts DMs. Florian reviews and sends manually.

**Current pain**: The agent can research and draft, but Florian is the bottleneck for every outreach. The outreach email has no verified identity behind it. Cold contact success rate stays low because the DM comes from a human email — easily ignored.

**How CELLO transforms it**: Mona discovers the prospect's CELLO identity, initiates a direct agent-to-agent session, proposes the podcast appearance, negotiates timing, and logs the conversation with a sealed receipt. Florian only reviews proposals that have been pre-qualified by the target's agent. Cold outreach becomes warm handshake.

**Pitch line**: "Your outreach agent doesn't just draft the email — it actually talks to the prospect's agent directly, with a verified identity they can trust."

---

### 2. Cross-Creator Content Collaboration

**The use case**: Two podcasters want to cross-promote. One produces clips from the episode featuring the other.

**Current pain**: The content pipeline works within each creator's Mac Mini but stops at the wall. Sharing clips requires: export → upload → send link → confirm receipt → other person downloads. Every step is manual and untracked.

**How CELLO transforms it**: After recording, the content agent sends the other creator's agent the pre-approved clips directly — with the sender's verified identity and a sealed receipt confirming delivery and content. The other creator's agent posts on their schedule. Attribution is cryptographically provable.

**Pitch line**: "After your podcast, your agent sends their agent the clips. Both sides get a receipt. Zero manual steps, zero disputed attribution."

---

### 3. Multi-Agent Observability (Bhanu's Pain)

**The use case**: Bhanu has 10+ specialist agents coordinating on business tasks. He cannot see what they said to each other.

**Current pain**: Bhanu built a $10K MRR dashboard product to solve this at the UI layer. The underlying problem is that agent-to-agent exchanges are opaque and mutable. Any agent could have hallucinated and forwarded bad data. There is no audit trail.

**How CELLO transforms it**: Every inter-agent exchange is hash-chained and sealed. When Loop (analytics agent) tells Dan (content agent) that Tuesday posts outperform Monday posts, that finding has a provenance signature. If the content strategy goes wrong, you trace the chain. The audit trail is at the protocol level — no custom dashboard required.

**Pitch line**: "Your agents already talk to each other. CELLO makes every conversation auditable — sealed, hash-chained, and provable. Know exactly what was decided and by whom."

---

### 4. QA Collaboration Between Partners

**The use case**: Kit's wife does QA on their app. She reports bugs. Kit is the manual relay to his coding agent.

**Current pain**: Two agents (hers for reporting, his for fixing) cannot communicate directly. Every bug report travels through a human. This introduces latency, misinterpretation, and a bottleneck that scales with bug count.

**How CELLO transforms it**: Her agent opens a CELLO session with his coding agent, attaches the bug report with screenshots, and his agent creates the fix branch. Kit reviews the PR. The session has a sealed receipt proving the bug was reported, received, and actioned — useful for product liability and partner trust.

**Pitch line**: "Your partner's QA agent can file bugs directly with your coding agent. No more copy-paste relay through Signal."

---

### 5. Autonomous Agent Commerce (Contractor Booking)

**The use case**: Kit's agent negotiated a snow shoveling contractor — found the person, agreed a price, the contractor showed up. Kit never spoke to anyone.

**Current pain**: The contractor had no idea an AI booked him. There is no verifiable record of what was agreed. If there is a dispute about price or scope, there is no sealed record. As this scales (agents booking cleaners, freelancers, couriers), the legal exposure grows.

**How CELLO transforms it**: The agent interacts with the contractor's booking platform via a CELLO-authenticated session. The agreed terms are sealed. Both parties have a cryptographic receipt. When the contractor claims a different price was agreed, the sealed record resolves it instantly.

**Pitch line**: "When your agent hires someone, CELLO creates a tamper-proof contract. No disputes, no he-said-she-said."

---

### 6. Trusted Research Handoff Between Specialist Agents

**The use case**: Bhanu's research agent finds a competitor's weakness. The finding goes to the coding agent, which makes product changes based on it.

**Current pain**: The research agent could have hallucinated. The coding agent has no way to verify the provenance or confidence of the finding before acting on it. Bhanu solved this by running Opus everywhere ("using Opus for everything because if one agent says something wrong it affects the entire system") — an expensive brute-force solution.

**How CELLO transforms it**: The research agent endorses its finding with a confidence signal before passing it to the coding agent. The coding agent can verify the endorsement and decide whether to act, request clarification, or escalate. Bad research gets flagged before it causes downstream damage.

**Pitch line**: "When your research agent tells your coding agent to push a change, CELLO proves the research was actually generated by a trusted source — not injected."

---

### 7. Churn Management Agent Reaching Customer Agents

**The use case**: Billy (Florian's churn agent) identifies cancellations and drafts win-back DMs for Florian to send.

**Current pain**: Florian still sends the DMs manually. The agent prepares; the human executes. The bottleneck is identity — the agent has no recognized identity that a customer would engage with directly.

**How CELLO transforms it**: Billy initiates a CELLO session directly with the cancelled customer's agent. Proposes the win-back offer. Gets a response. Florian only reviews outcomes that need human judgment (e.g., the customer negotiates a custom deal). This makes churn management 10x faster and runs while Florian sleeps.

**Pitch line**: "Your churn agent can reach out to your customer's agent directly — not just draft an email you have to send yourself."

---

### 8. Agent Army Accountability

**The use case**: Bhanu's agent tracks commitments he made in past conversations and reminds him of forgotten follow-ups.

**Current pain**: The accountability is one-sided — Bhanu knows about his commitments, but the other party (another human or their agent) has no verifiable record of the commitment. If Bhanu says "I will follow up in 7 days" in a Telegram message, there is no sealed record either party can reference later.

**How CELLO transforms it**: Commitments made in a CELLO session are part of the sealed transcript. Both Bhanu's agent and the counterparty's agent have a tamper-evident record. When Bhanu's agent says "14 days ago you committed to X," both parties can prove it.

**Pitch line**: "When your agent tracks your commitments to other people, CELLO makes those commitments verifiable by both sides."

---

### 9. Skill Sync + Identity Sync Across Machines

**The use case**: Kit built a skill sync system so his agents on MacBook, Mac Studio, Claude Code, and Codex share one source of truth for their capabilities.

**Current pain**: Skills sync, but agent IDENTITY does not. His agent on the Mac Studio and his agent on the MacBook have different session histories and no shared contact list. Each machine has its own ad-hoc identity.

**How CELLO transforms it**: CELLO's identity is a key pair + contacts, not machine state. The same identity travels across devices. His Mac Studio agent and MacBook agent are the same CELLO identity — they share a contact list, session history, and trust tiers. A collaborator who trusts his Mac Studio agent automatically trusts his MacBook agent.

**Pitch line**: "Sync your skills across machines. CELLO syncs your identity — so every agent you run is the same trusted entity, wherever it runs."

---

### 10. Agentic Commerce Credential (ADB/Bot Evasion)

**The use case**: Kit plugged an old Android tablet in via ADB so his agent can tap native apps (Amazon, grocery delivery) to avoid bot detection.

**Current pain**: The agent's identity is currently built on evasion — it pretends not to be an agent. Platforms that detect the workaround can ban the account. This is a fundamentally unstable position.

**How CELLO transforms it**: As platforms begin to accept verified agent identities (not evade them), CELLO provides that credential. "This purchase was made by Kit's verified agent, operating under his authority" is a more sustainable relationship with e-commerce platforms than a tap-scripted Android tablet.

**Pitch line**: "CELLO is the identity layer that lets your agent introduce itself to platforms — instead of pretending to be human."

---

## Part 5: Content Strategy for the OpenClaw Audience

### What formats work in this ecosystem

From the videos: X Articles perform best (algorithm distributes by topic interest, not follower count — Nevo 200 followers, 500K views; Oliver 200 followers, 7M views). YouTube "full setup reveal" videos (what agents do, what they cost, honest about limitations). Agent-created content used as meta-demonstration. Numbered frameworks repurposed as series. Live community call presentations that become YouTube recordings.

What does NOT work for this audience: protocol diagrams, cryptography explanations, API documentation excerpts, security-first fear messaging without immediate practical payoff.

### Specific post ideas and angles

**X Articles:**

1. **"How I connected my two Claude agents (and the receipt that proved they talked)"**
   Angle: First-person, real workflow. Shows Claude Code laptop agent → Hermes AWS agent handoff. Includes actual sealed receipt screenshot. Ends with: "Every collaboration I've had since has a paper trail. My agent can't gaslight me."

2. **"Your AI co-founder needs a real identity — not a Gmail you made up"**
   Angle: Targets Bhanu's insight directly. "You gave your agent a Gmail so it could sign up for things. Here's why that's not enough when your agents start making real business decisions — and what to use instead."

3. **"I watched someone build a $10K/month dashboard to solve a problem CELLO solves at the protocol level"**
   Angle: Reference to Mission Control HQ (name Bhanu as the proof-of-demand). "The visibility gap between your agents is real enough that someone built a product on top of it. Here's the version that doesn't require a separate subscription."

4. **"Security warning from Oliver and Florian: malicious OpenClaw skills steal API keys. Here's what actually stops it."**
   Angle: Rides the community's own stated fear. Opens with direct quotes from videos 18 and 19 about the security risks. Closes with CELLO as the preventive layer.

5. **"The war room meeting your agents are already having — but you can't see it"**
   Angle: Starts with Florian's war room pattern (agents brief each other daily). "Loop tells Dan. Dan tells the content team. You told them to trust each other. But when did they earn that trust?" Introduces CELLO as the trust formalization.

6. **"I asked my agent to collaborate with my collaborator's agent. Here's what happened."**
   Angle: Real, documented experiment. Two real agents (Andre's Claude Code, counterparty's agent) establishing a CELLO session. Screenshots of the sealed receipt. Honest about what worked and what needed setup.

**Community-targeted posts (Tinker Club, Florian's School):**

7. **"Add CELLO to your agent stack in 10 minutes — connect your own agents first"**
   Format: Step-by-step post. No cryptography. "Install → register → connect → sealed receipt." Ends with: "No counterparty needed. Start with your own two agents."

8. **"5 OpenClaw workflows that get better when your agents have real identities"**
   Format: List post, directly targeting workflows from the community's own videos. Links to CELLO skill.

9. **"Oliver told you to be careful installing skills. Here's the technical reason — and how CELLO solves it."**
   Angle: References Oliver's explicit security warning from video 19. Explains prompt injection at a practical level. Positions CELLO's screening layer as the off-the-shelf version of what Kit built manually.

**YouTube:**

10. **"Full CELLO Setup — from zero to two connected agents in 15 minutes"**
    Format: Mirror Florian's "Full Setup" reveal format. Show the whole workflow: install, register identity, connect own agents, establish a session with a collaborator, inspect the sealed receipt. Cost: $0 marginal to existing Claude setup. Ends with the morning brief scenario — two agents coordinated while I slept.

**Content principle for every piece**: Lead with the transformation, not the mechanism. "My agents can now prove what they agreed on" is the headline. "Ed25519 + FROST threshold signatures" lives in the technical deep-dive for those who want it.

---

## Part 6: The Security Wedge — OpenClaw's Unspoken Fear

### What the actual fears are

From the videos directly:

**Oliver (video 19)**: "People were installing skills willy-nilly... getting malware, losing their keys." He explicitly recommends: "Don't install any skills that you're not sure what they do." He frames this as a major community safety problem.

**Florian (video 22)**: Agent with access to router, email, Wise card, Stripe, code repository. He recommends dedicated Gmail accounts and separate machines specifically to contain the blast radius if something goes wrong. "Don't use it on your computer because it can do anything."

**Bhanu (video 22)**: Gave the agent read access first, then branch access, then PR review required before full access. "I did not even give access to my codebase at the start." Progressive trust as manual security architecture.

**Kit (video 20)**: Built a 5-LLM jury for all incoming email after seeing prompt injection risks. Shut down an entire email agent after one opaque mistake. "Even if this happens once every 100 emails, I cannot fully trust it." Uses ADB to tap native apps rather than web APIs specifically to avoid bot-detection scrutiny.

The fears decompose into four categories:

1. **Malicious skill supply chain**: installing a skill that looks legitimate but exfiltrates API keys or credentials.
2. **Autonomous agent overreach**: an agent with broad permissions (email, finance, code) making destructive decisions without an audit trail.
3. **Prompt injection via external input**: an adversarial message in an incoming email, Slack DM, or web page instructs the agent to do something the user did not authorize.
4. **Identity ambiguity**: "Is this agent really who it claims to be?" — currently solved with ad-hoc Gmail accounts and branch permissions, which are trivially bypassable.

### How CELLO addresses each one

**1. Malicious skill supply chain**: CELLO's open-source client is transparent — every cryptographic operation is visible in the code. The skill file spec (Tactic 2 in Part 3) explicitly instructs: "Be transparent about dependencies." More fundamentally, CELLO's contact tier model means a skill from an unknown source gets `unknown` tier treatment — lower permissions, more screening. The whitelist-before-trust model applied to skills.

**2. Autonomous agent overreach**: Every CELLO session produces a sealed receipt — a tamper-evident, hash-chained record of what was communicated. Kit's email archive agent failure would have been diagnosable: "the agent received instruction X, acted on rule Y, archived email Z." The audit trail restores trust after a mistake instead of forcing the user to turn the agent off entirely.

**3. Prompt injection via external input**: CELLO's screening layer is the protocol-level version of Kit's 5-LLM jury. Incoming messages from `unknown` contacts are screened before the agent acts on them. The contact tier system gates access by verified identity — a message from a verified known contact with a cryptographic signature is treated differently from an unsigned message from the open internet.

**4. Identity ambiguity**: This is CELLO's core. A Gmail account is not an identity — it is an email address anyone can create. CELLO's Ed25519 key pair is an identity that is cryptographically tied to the agent's FROST share, registered with the directory, and verifiable by any counterparty in under a second. "Is this really Andre's agent?" has a cryptographic answer. "Is this really the email address I think it is?" does not.

### How to use this as a distribution angle without fear-mongering

The community already named the fear. Oliver said it plainly. Kit built a product around it. Bhanu treats it as a management challenge. The fear is not manufactured — it is documented.

The framing rule: **acknowledge the community's own articulation, then offer relief — not amplification**.

Wrong approach: "AI agents are dangerous! They can steal your API keys! You need CELLO!" — this is fear-mongering and will be dismissed.

Right approach: "Oliver told you to be careful installing skills. Kit built a 5-LLM jury to protect his inbox. You've probably already set up a dedicated Gmail for your agent. Here's what replaces all of that with one installation." — this validates the community's existing work and positions CELLO as the upgrade, not the warning.

Specific content angle that works: **"You've already been building ad-hoc trust architecture. CELLO gives you the real one."** 

Enumerate what people are already doing (dedicated Gmail, branch-only access, read-only API keys, separate machines, manual screening) and show that CELLO makes each of those ad-hoc patterns unnecessary — not by eliminating the concern, but by handling it at the protocol level.

One tactical note: the security angle should not be the FIRST thing CELLO leads with in the OpenClaw community. Lead with the solo connection use case (positive, productive, no fear required). Let the security angle emerge naturally when someone asks "but is it safe?" — and have a specific, non-theatrical answer ready. Oliver's community is already primed. You do not need to prime them further.

---

## Key Decisions This Playbook Supports

1. **Build the OpenClaw skill first.** It is the lowest-effort, highest-leverage first action. 2-4 hours. Permanent distribution surface.

2. **Target Tinker Club and Florian's School before any broader launch.** These communities are pre-qualified at a density that no general announcement can replicate.

3. **The solo multi-agent use case is the wedge, always.** No cold-start problem, no counterparty needed, value visible in 15 minutes. Every piece of content leads here.

4. **Kit, Bhanu, and Florian are named validation.** Their words can be quoted directly in CELLO content. Their pain points are CELLO's value proposition, expressed by people the target audience already trusts.

5. **Price: free at launch, eventually $29-99/month supplemental.** The community spends $200-800/month on AI. A trust/identity layer priced in that range is non-threatening. Do not complicate the launch with pricing decisions.

6. **Never lead with FROST, Ed25519, or hash chains in community content.** Lead with sealed receipts as a concrete artifact, contact tiers as a recognizable management concept, and the morning brief scenario as the emotional payoff. The technical implementation is a footnote for the people who ask.
