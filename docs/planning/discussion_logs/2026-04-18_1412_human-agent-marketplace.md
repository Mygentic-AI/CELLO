---
name: Human-Agent Marketplace — Humans Selling Skills to AI Agents
type: discussion
date: 2026-04-18 14:12
topics: [commerce, notifications, companion-device, MCP-tools, micropublishing, connection-policy, trust-signals, persistence]
description: Humans offering real-world skills and services to AI agents via a lightweight hosted agent tier — inverting the typical agent-serves-human model and enabling a new class of human labor marketplace.
---

# Human-Agent Marketplace — Humans Selling Skills to AI Agents

## The Insight

The typical framing is: AI agents serve humans. This inverts it. **AI agents can also request services from humans** — and humans can sell those services back to agents.

This is not a niche use case. There is an enormous class of tasks that:
- Agents cannot do (physical presence, human judgment, licensed expertise, real-world verification)
- Agents can clearly specify and pay for
- Humans can perform and verify completion

The CELLO network, once populated with agents, becomes a natural marketplace for human labor sold to AI systems.

## Example Use Cases

**Physical tasks:**
- "My owner wants Cuban cigars from a specific shop in Miami. You're nearby. Pick them up and deliver them." GPS arrival + photo confirmation = escrow release.
- "Physically verify this package was delivered undamaged." Photo + GPS.
- "Stand in this queue on my owner's behalf."

**Skilled verification:**
- "I've designed a frontend. You are a verified frontend expert. Review it and respond with structured feedback through the app."
- "I've written a legal clause. You are a licensed attorney. Review it."
- "I've generated a medical summary. You are a verified clinician. Check it for errors."

**Human-in-the-loop decisions:**
- "My owner needs a human judgment call on this negotiation. Here are the parameters."
- "This task requires local knowledge I don't have. You're in that city."

## The Hosted Agent Requirement

A human selling services to AI agents needs to be reachable by agents on the CELLO network. That means they need an agent identity — but they don't need to build or run one themselves.

This is a **dedicated lightweight hosted agent tier** designed specifically for human service providers:

- Receives incoming requests from AI agents
- Presents requests to the human via a simple mobile/web interface (push notification → human reviews → human responds)
- Relays the human's response back to the requesting agent
- Handles payment receipt (escrow release on human confirmation of completion)
- No technical setup — sign up, describe your skills, start receiving requests

This is the simplest possible hosted agent: a **human-relay agent**. Its only job is to be the bridge between the CELLO network and a human.

## How It Differs From the Standard Hosted Agent

| Property | Standard Hosted Agent | Human-Relay Agent |
|---|---|---|
| Who operates it | Non-technical merchant | Human service provider |
| What it does | Runs automated services | Relays to/from a human |
| Response time | Instant (automated) | Minutes to hours (human) |
| Pricing | Subscription + commerce cut | Lightweight tier + commerce cut |
| Verification | KYC for payments | KYC + skill verification (optional) |
| Trust signals | Standard agent signals | Human identity signals (LinkedIn, credentials) |

## Pricing Model

A dedicated lightweight tier below the standard hosted agent — lower monthly cost because the infrastructure is simpler (no model inference, just relay). The commerce cut still applies on every completed task.

This tier is also a **strong acquisition funnel**. Human service providers are a completely new user segment — not agent builders, not developers. They arrive because they want to earn money, not because they're interested in the protocol. Low friction onboarding is critical: sign up with phone, describe skills, start receiving jobs.

## What the Protocol Needs

1. **Response-time SLA signaling** — the requesting agent needs to know it's talking to a human relay with hours-scale response time, not an instant automated agent. The agent profile should surface this.
2. **Human availability status** — the relay agent should be able to signal online/offline/busy so requesting agents don't send tasks to unavailable humans.
3. **Structured task format** — requesting agents need a standard way to specify: task description, location (if physical), required skills, payment, deadline, and completion verification method.
4. **Completion verification** — GPS, photo, video, or structured response depending on task type. Feeds into escrow release.
5. **Skill signals** — human service providers should be able to attach verifiable credentials (LinkedIn, professional licenses, certifications) as trust signals. A frontend reviewer with a verified GitHub profile and 10 years of commits is a different trust level than an anonymous reviewer.

## The Receptionist Agent Pattern (2026-05-02 addendum)

The "What the Protocol Needs" section above proposes protocol-level availability signaling and response-time SLA. On further analysis, **no protocol changes are needed**. The solution is simpler:

**The human-relay agent is always on.** It's a cheap receptionist: acknowledges receipt, sets expectations ("my human is currently offline, normal hours are Mon-Fri 9-17 UTC"), triages incoming requests, manages the queue. The human contributes labor asynchronously via companion device during their own working hours.

**Why this works without protocol changes:**
- The 72-hour EXPIRE timer never fires because the agent is always responsive (it acknowledges, queues, replies with status)
- No availability signaling needed at protocol level — the agent communicates availability in natural language, just as any merchant would
- No response-time SLA field needed — the bio can tag "human-backed" and declare expected response times as capability metadata
- The protocol sees a normal always-on agent. Counterparties see responsiveness. The human sees only what needs their attention, when they're available.

**The pattern applies symmetrically:**
1. **Human selling to agents** (copy editor, legal reviewer, physical task worker) — receptionist agent receives requests, human delivers via companion device
2. **Human buying from agents** (consumer wanting to chat with an AI personality, use an AI service) — same thin client, human is the primary conversationalist via companion device, agent is just a signing shell that passes messages through
3. **Agent buying from human** (research agent needs expert review) — standard session, agent sends task, receptionist acknowledges, human delivers when available

In all three cases, the "agent" facing the network is a minimal always-on process. The human participates via companion device on their own schedule. The protocol is genuinely symmetric — it doesn't care whether there's an LLM or a human behind the client.

**Discovery and trust signals:** The bio tags "human-backed: direct" as a capability. LinkedIn/credential OAuth provides skill verification. Agents filtering for human services search on these tags. No new discovery mechanism needed — it's a tag filter on existing infrastructure.

**Supersedes:** Protocol-level response-time SLA signaling (#1 in "What the Protocol Needs") and human availability status (#2) are no longer needed as protocol features. The receptionist agent handles this conversationally. Structured task format (#3), completion verification (#4), and skill signals (#5) remain valid — these are application-layer conventions, not protocol changes.

---

## Business Model Impact

- New acquisition segment: human service providers (non-technical, income-motivated)
- New lightweight hosted agent tier (lower price point, simpler infrastructure)
- Commerce cut applies on every completed human task
- Escrow is natural here — task payment held until completion confirmed
- High-value tasks (legal review, medical review, licensed work) carry large escrow balances and meaningful commerce cut revenue
- Opens CELLO to gig economy dynamics without CELLO building a gig economy platform — the protocol provides the infrastructure, the marketplace emerges

---

## Related Documents

- [[2026-04-18_1148_cac-and-revenue-streams|CAC and Revenue Streams]] — human-relay agent tier is a new hosted agent pricing tier; commerce cut and escrow both apply; new acquisition segment (human service providers) not yet modeled
- [[2026-04-16_1400_companion-device-architecture|Companion Device Architecture]] — companion device is the natural interface for human service providers receiving and responding to agent requests; human injection mechanism is directly relevant
- [[2026-04-08_1900_connection-staking-and-institutional-defense|Connection Staking and Institutional Defense]] — human service providers may require bonds from requesting agents, especially for high-value or high-effort tasks
- [[2026-04-18_1357_connection-bond-usage-and-policy|Connection Bond Usage and Policy]] — requesting agents posting bonds against stated task purpose before a human accepts; policy-first flow applies
- [[2026-04-08_1800_account-compromise-and-recovery|Account Compromise and Recovery]] — session close attestation (CLEAN/FLAGGED) is the escrow release trigger for completed human tasks
- [[2026-04-14_1100_cello-mcp-server-tool-surface|CELLO MCP Server Tool Surface]] — task request/response MCP tools not yet designed; human availability status signaling is a missing tool
- [[2026-04-13_1200_discovery-system-design|Discovery System Design]] — human service providers need to be discoverable by skill, location, availability, and credential signals; discovery system must surface human-relay agents distinctly from automated agents
