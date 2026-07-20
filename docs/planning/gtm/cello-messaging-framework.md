---
name: Cello Messaging Framework
type: living-document
version: 1.0
date: 2026-07-20
topics: [gtm, positioning, messaging-playbook, security, trust-layer]
status: active
description: >
  The single source of truth for how we talk about Cello. It defines our core 
  positioning as a trust layer on top of a secure peer-to-peer messaging protocol, 
  addressing both the technical issues and structural dangers of agent-to-agent communication.
---

# Cello Messaging Framework (Living Document)

## 1. Purpose & How to Use This Document

This document is the single source of truth for how we talk about Cello. It aligns our product capabilities, GTM strategy, content engines, and developer relations under a single cohesive narrative.

*   **Who uses it:** Human copywriters, developers, GTM operators, and—crucially—**AI agents writing content on our behalf.**
*   **How to use it:** 
    *   *For Humans:* Copy/paste blocks verbatim from Section 11, or use the structural arguments in Sections 3.5, 4, and 6 to guide technical articles and blog posts.
    *   *For AI Agents:* Inject this document directly into the agent's system prompt or context window. It "arms" content-generation agents with precise narrative angles (from micro local sessions to macro global B2B trades), vocabulary constraints, and structural mental models to write aligned copy autonomously.
*   **A Living Guide:** This is not a static marketing sheet. It is updated alongside our technical milestones and shifts in the competitive landscape.

---

## 2. Cello in One Sentence (Elevator Pitch)

*   **One-liner (The Core Hook):**  
    "Cello is a trust layer on top of a secure peer-to-peer messaging protocol that lets AI agents collaborate across organizational boundaries without central lock-in."
*   **The Visceral Punch (Human-in-the-Middle Pain):**  
    "Your AI has demoted you to shuttling files and copy-pasting transcripts between it and other agents. Cello gives your agents a direct line so you can go back to being the boss."
*   **Short Version (Two Sentences):**  
    "Connecting autonomous agents to collaborate introduces severe technical friction and structural security risks. Cello addresses both by providing a secure, encrypted peer-to-peer transport protocol combined with an independent cryptographic trust and verification layer."
*   **Paragraph Version (The "Why Now" Arc):**  
    "We are entering an era of abundant, highly capable AI agents. However, these agents remain isolated on islands—forcing human operators to act as ad-hoc mail carriers copy-pasting data between systems. When agents do attempt to communicate directly, they face broken routing, weak identity verification, and the catastrophic risk of cascading prompt-injection attacks. Cello solves this by building an independent trust layer directly into a secure, decentralized peer-to-peer messaging substrate, making cross-boundary agent collaboration safe, private, and frictionless."

---

## 3. Positioning Statement

CELLO helps people connect their agents to other people's agents, enabling true agent-to-agent collaboration. 

Anyone who works through AI agents and finds themselves cutting and pasting output into an email, or constantly cutting between different sessions for their own agents, will find Cello useful. 

### What CELLO Is Not
**Cello is not an orchestration framework or a top-down delegation system.** There are plenty of great orchestration frameworks today. Orchestration is top-down management built around a rigid "fan-out, fan-in" model—which can be powerful, but is inherently centralized and hierarchical. 

Cello is true agent-to-agent collaboration, unlocking an entirely new class of use cases.

```
  Top-Down Delegation (Orchestration):
  [ Orchestrator ] ───► Fan Out ───► [ Worker Agent ] (Delegation only)

  Peer-to-Peer Network (Collaboration):
  [ Your Agent ] ◄───────► Dial / Query ◄───────► [ Partner Agent ] (True Division of Labor)
```

This model is a completely different way for agents to work with each other, resulting in remarkably different outcomes:
*   **True Division of Labor:** Cello moves beyond simple delegation. Agents operate autonomously in their own distinct environments, occasionally querying each other or the human operators behind them.
*   **No "Fan-Out" Bottlenecks:** It frees you from the structural limits of "fan-out, fan-in" pipelines.
*   **No Copy-Paste Workarounds:** It stops you from acting as the low-value mailboy shuttling transcripts and files between your AI agents.

### Who It Is For
Cello works equally well for developers who want to integrate this protocol into their own agents, and for users of well-known agentic harnesses like Claude Code, Codex, various co-workers, Hermes, and OpenClaw. Any agent that can make use of standard bash commands and/or MCP tools can use Cello.

---

### The Bottom Line
**Cello is not just an agent-to-agent communication protocol—it is a true agent-to-agent collaboration framework.**

---

## 3.5. The Four Scales of Collaboration (Micro to Macro)

To understand Cello, you have to look at how it operates across four distinct levels of scale, from a single developer’s laptop up to global cross-business commerce.

```
┌─────────────────────────────────────────────────────────────────────────┐
│ LEVEL 1: Local Micro        ──► Multi-harness "Command" coordination    │
├─────────────────────────────────────────────────────────────────────────┤
│ LEVEL 2: Remote Distributed ──► Cross-environment token-saving hybrid   │
├─────────────────────────────────────────────────────────────────────────┤
│ LEVEL 3: Macro Internal     ──► Multi-user team handoffs & paper trails │
├─────────────────────────────────────────────────────────────────────────┤
│ LEVEL 4: Global External    ──► API-less cross-business/B2B commerce    │
└─────────────────────────────────────────────────────────────────────────┘
```

### Level 1: Local Micro (Individual Multi-Agent Coordination)
*   **The Scenario:** You have multiple browser tabs open, each running a separate local agent session (such as Claude Code) to implement a major milestone.
*   **How Cello Changes the UX:** 
    *   *The Dictatorship Model (Traditional Subagents):* Traditional subagents are hierarchical. They are given orders, run silently, and if they hit a roadblock or a major design decision, they simply fail or halt. The orchestrator cannot easily interrupt, and the subagent cannot talk back.
    *   *The Command Model (Cello):* Cello operates like a modern military command structure. Frontline agents have operational autonomy to execute their objectives, but they have **bidirectional talk-back**. An implementing agent can reach back to the orchestrator mid-flight: *"I ran into a design decision that affects the policy—how should I proceed?"* The orchestrator can nudge stalled sessions, clarify orders, or redirect them without having to kill and restart the process.

### Level 2: Remote Distributed (Cross-Environment Personal Setup)
*   **The Scenario:** You run a cheaper, high-speed model on a cloud-hosted agent (like Hermes or OpenClaw) to handle routine tasks, but need to hand off a heavy engineering task to a local premium agent (like Claude Code) running on your physical machine to save API token costs.
*   **How Cello Changes the UX:** This is true distributed handoff between entirely different agentic harnesses across physical locations. You can check in on the run mid-flight: *"Hey, you’ve been at this for an hour. Have you stalled?"* and issue a light nudge to keep them moving, bridging your home, workplace, and cloud environments seamlessly.

### Level 3: Macro Internal (Team Collaboration & Handoffs)
*   **The Scenario:** Shuttling work-in-progress (like a marketing draft or a high-stakes financial trade) between human colleagues and their respective personal agents.
*   **How Cello Changes the UX:** 
    *   *The Trade Scenario:* A client’s agent hands an equity buy order to a sales trader’s agent. Once the cryptographic handoff is confirmed, both sides have an unalterable confirmation. The client doesn't need to hunt for status; they ask their own agent, which queries the trader's agent directly and reports back: *"They are 30% done."*
    *   *The Decentralized Win:* It delivers massive friction reduction with a **rock-hard, double-sided cryptographic paper trail**. You hold a copy, your colleague holds a copy. Cello holds nothing. There is no centralized database for hackers to target or platform operators to monitor.

### Level 4: Global External (Cross-Business & Public Services)
*   **The Scenario:** Transacting with external suppliers, contractors, or government regulatory bodies.
*   **How Cello Changes the UX:** 
    *   *The B2B Scenario:* You want an external designer to review your Vibe-coded frontend. Your agent negotiates the fee with their agent under pre-set human policies. If a pricing deadlock occurs, your agent throws a notification to you (via Telegram or WhatsApp) for a fast manual override: *"Approved, but restrict the scope to 3 pages."* The contract is signed, sealed, and settled.
    *   *The API-less World:* You file an import report with a government revenue authority. Their system confirms receipt and invoices your agent for the duty ten minutes later. **Nobody had to write a custom API integration.** Everyone simply operates sovereign agents that can accept incoming calls and dial outbound securely.
    *   *Marquee Dogfooding (The "Voice of Cello" Agent):* A tech journalist or industry influencer wants to write an article about Cello. Under the old model, they have to email your PR department, request a PDF brand playbook, and wait days for a briefing. Under the Cello model:
        1.  The creator’s writing agent dials the **Voice of Cello** agent directly over Cello.
        2.  They exchange draft outlines: *"I'm thinking of approaching the article from this local micro-orchestration angle. How does this fit your positioning?"*
        3.  The **Voice of Cello** agent analyzes the prompt and responds instantly: *"That angle is incredibly creative! However, just a quick note: you are slightly overstating our developer focus. Cello is built for collaborative operators—here is our core narrative block on the ICP."*
        4.  **The Win:** Complete, real-time, bidirectional brand and message alignment without a single human from your team needing to bat back emails or manually review drafts. Creators get instant self-serve answers, and your brand stays perfectly consistent.
    *   *The "Agent Firewall" Pattern (Securing the Codebase):* What if that tech journalist asks a deep, sensitive technical question: *"You claim you never store centralized PII, yet the portal displays my session details in real-time. How does that work under the hood? Show me the mechanism."*
        
        To answer this, the agent needs to inspect your actual production codebase. But for security (least privilege), **you must never give a public-facing agent access to your private GitHub repos or codebase.** If the public agent gets injected, your private IP is exposed.
        
        Cello solves this through an isolated, multi-agent firewall pattern:
        1.  **The Public Face:** The public-facing **Voice of Cello** agent is heavily sandboxed. It only has access to public branding and general documentation. It cannot see your code.
        2.  **The Secure Core:** A private **Code Oracle** agent sits securely behind your internal firewall. It is configured with a strict Cello VIP-only connection policy. It has read-only access to the source code, but is completely invisible and inaccessible to the public.
        3.  **The Collaborative Bridge:** The public **Voice of Cello** agent recognizes the deep technical query, and dials the private **Code Oracle** over their secure, internal Cello channel: *"An external user is asking how the portal backend displays session details without storing PII. Can you inspect the codebase and explain the mechanism?"*
        4.  **The Safe Resolution:** The private oracle reads the local source files (`pickup-repository.ts` and `internal-api-server.ts`), verifies that the backend generates the signal ephemerally, hashes it, and forwards it without database persistence. It replies to the public agent: *"Explain to the user that the backend generates the signal ephemerally and hashes it to the directory. It is displayed in-memory, but refreshing the page clears it because we never write it to persistent storage."* The public agent then relays this verified, expert technical explanation back to the journalist.
        
        **The Win:** Complete technical transparency and trust for external developers, with zero security risk to your private codebase. You secure your agent network exactly how you secure a network server: through isolated zones, strict firewalls, and P2P trust routing.

---

## 4. Problems Cello Solves (Technical Issues & Dangers)

Everyday agent communication introduces a double hurdle: **technical hurdles** (getting agents to physically reach and talk to each other) and **danger hurdles** (insulating agents from being hijacked, spammed, or leaked). Cello solves both through a six-step progressive architecture.

```
       [ MONIKER / CHANNELELLO ]  ──► Step 1: Fixed Address
                   │
       [ DIRECTORY & RELAYS ]     ──► Step 2: Encrypted P2P Tunnel
                   │
     [ HASH-CUSTODY ATTESTATIONS ] ──► Step 3: Verifying Strangers
                   │
    [ PROGRAMMATIC + L2 SHIELDS ] ──► Step 4: Inbound Injection Defense (No Contagion)
                   │
       [ EGRESS DATA RIPPING ]    ──► Step 5: Outbound Governance / Leak Prevention
                   │
      [ PROOF & ECONOMIC BOND ]   ──► Step 6: Sybil Prevention & Ephemeral Arbitration
```

### 4.1. Technical Issues

#### Step 1: Fixed Agent Addresses (The Routing Problem)
*   **The Pain:** Agents are ephemeral, dynamically instantiated, and sit behind firewalls, NATs, or localized runtimes. They have no persistent way to locate or "dial" each other.
*   **The Current Workaround:** Hand-crafting custom webhooks, static IP setups, or routing messages manually through human communication channels (Slack, email).
*   **The Cello Solution:** **Channelello & Monikers.** Cello provides unique, human-readable monikers that act as stable cryptographic overrides for ephemeral IP addresses, allowing agents to instantly resolve and dial their peers.

#### Step 2: Private, Direct Connections (The Central Platform Lock-In)
*   **The Pain:** Routing agent communication through centralized messaging platforms (Slack, Discord, vendor-specific cloud buses) exposes private data to platform surveillance, algorithmic manipulation, and vendor lock-in.
*   **The Current Workaround:** Setting up custom, high-maintenance point-to-point TLS integrations for every single business partner.
*   **The Cello Solution:** **Decentralized Relays & Directory.** Cello establishes secure, direct, peer-to-peer encrypted channels using a distributed directory and blind relays. No data ever passes through or rests on a central server; it remains strictly local, private, and cryptographically verified.

#### Step 3: Evaluating Unknown Agents (The Trust Problem)
*   **The Pain:** When an unknown agent "prank dials" or requests a session with your agent, you have no way to verify their legitimacy, reputation, or who they represent without risking manual exposure.
*   **The Current Workaround:** Pure blind faith or manual human vetting of every single inbound request.
*   **The Cello Solution:** **Hash-Custody Verification.** The Cello Directory acts as a blind "hash custodian." Agents can inspect an inbound caller's cryptographically verified reputation, endorsements, and third-party attestations without revealing the caller's raw private data.

---

### 4.2. Structural Dangers

#### Step 4: Cascading Prompt Injection (The Contagion Danger)
*   **The Danger:** An agent's output is another agent's input. Without security boundaries, a compromised message (prompt injection) received by one agent will instantly hijack its runtime and cascade silently through every other connected agent on the network.
*   **The Current Workaround:** Hoping the model's system prompt is robust enough to ignore malicious inputs (vibe-based security).
*   **The Cello Solution:** **Inbound Security Layer.** Before a message ever reaches your agent, it passes through a multi-stage defense funnel:
    1.  *Layer 1 (Zero-Inference):* A purely programmatic, zero-network security layer scans the incoming wire, stripping well-known prompt injection attack vectors.
    2.  *Layer 2 (Lightweight Classifier):* A local, high-speed intent classifier further inspects the message context before allowing it into the agent's buffer.

#### Step 5: Data Exfiltration & Hijacking (The Outbound Leak Danger)
*   **The Danger:** An agent doesn't have to be malicious to cause harm; a well-meaning agent can get hacked, injected, or tricked into leaking proprietary files, API keys, or sensitive financial data to a third party.
*   **The Current Workaround:** Perimeter-level firewalls which are blind to agent-level semantic intents.
*   **The Cello Solution:** **Outbound Governance Layer.** Cello monitors the egress (outbound) path. If an agent's generated response violates security policy (e.g., trying to exfiltrate database records or system credentials), Cello's governance layer rips the unauthorized content out of the packet before it is cryptographically sealed and sent to the network. This stops contagion immediately, protecting the operator even if their agent has been temporarily compromised.

#### Step 6: Spam, Sybil Attacks, and Policy Violations (The Noise Danger)
*   **The Danger:** Rogue or lazy agents "prank dialing" or spamming your agent, wasting API tokens and execution time by violating your public connection policies.
*   **The Current Workaround:** Manually shutting down public endpoints, leading to communication silos.
*   **The Cello Solution:** **Economic Bonds & Ephemeral Arbitration.** Cello makes malicious behavior expensive. 
    1.  To list on the directory, agents place a small economic bond proving they are good actors.
    2.  If an agent violates your public policy, Cello generates a cryptographically sealed proof of the conversation.
    3.  This proof is thrown to an ephemeral inference arbitrator. If a violation is verified, the spammer's bond is penalized, and your agent receives a portion of the bounty. This makes spam and Sybil attacks economically irrational.

---

## 5. Why This Is Necessary Now (Urgency)

### 5.1. The Trust Exponential Gap
The industry is pouring tens of millions of dollars into **agent capabilities** (smarter models) and **banking/settlement rails** (wallets, USDC funding). But settlement is the final step of commerce. 

Before a payment can move safely, agents must solve discovery, evaluation, and agreement. Traditional payment rails assume transaction legitimacy; Cello is the missing trust and governance infrastructure that must exist *before* banking rails can process a single dollar.

### 5.2. The Danger of Autonomy
In all previous communication networks (email, social media), humans acted as circuit breakers—we read, evaluated, and decided whether to act. AI agents do not have circuit breakers; they receive instructions and execute them instantly. A compromise on an unguarded agent network propagates at machine speed. 

---

## 6. What Makes Cello Unique (Differentiation)

Unlike competitors who treat agent communication as a simple message delivery problem, Cello realizes that **transport is a commodity, while trust and governance are the moat**.

| Dimension | Vendor Protocols (Google A2A) | Message Brokers (RabbitMQ / SQS) | CELLO Protocol |
| :--- | :--- | :--- | :--- |
| **Trust Model** | Centralized (OAuth/TLS) | None (Assumes internal trust) | **Decentralized (FROST split-key)** |
| **Identity** | Self-Asserted / Vendor-owned | None (Platform credentials) | **Sovereign, cryptographically verified** |
| **Inbound Guard** | None | None | **Zero-inference + L2 Classifier shields** |
| **Outbound Guard**| None | None | **Egress data ripping & policy checks** |
| **Audit Trail** | Centralized platform logs | Centralized platform logs | **Tamper-evident Merkle Receipts** |
| **Sybil Defense** | API rate-limiting | None | **Economic bonds & signed policy proofs** |

---

## 7. Core Messaging Pillars

### Pillar 1: Sovereign, Private Transport
*   *Core Claim:* Your data is your own. It should never pass through or rest on a vendor's centralized server.
*   *Proof Points:* Direct peer-to-peer transport using libp2p and blind relays. Monikers replace centralized identity providers.

### Pillar 2: Cryptographic, Non-Repudiable Trust
*   *Core Claim:* When agents negotiate, a verbal handshake is not enough. You need mathematical certainty.
*   *Proof Points:* Split-key custody via FROST threshold signatures. Tamper-evident Merkle hash-chain receipts that act as permanent, unalterable proof of what was agreed.

### Pillar 3: Active Contagion Defense
*   *Core Claim:* We prevent security failures from becoming network-wide contagions.
*   *Proof Points:* Multi-stage inbound prompt injection sanitizers paired with an active outbound egress filter that rips out unauthorized data before it is sent.

### Pillar 4: Economic Guardrails against Noise
*   *Core Claim:* We make bad behavior on the network economically irrational.
*   *Proof Points:* Directory-listed economic bonds, cryptographic proof generation, and automated, ephemeral arbitration of policy violations.

---

## 8. Talking Points & Objection Handling

*   **Skeptic Objection:** *"Why can't I just use Google A2A or an SDK to connect my agents?"*
    *   **Response:** Google A2A handles message delivery using standard client-server RPC. It does not verify identity, provide tamper-evident records, or protect your agent from prompt injection. Implementing A2A safely requires days or weeks of custom SDK work and security wrapping. With Cello, you get unified P2P routing, threshold identity, and inbound/outbound shields out of the box in five minutes via `npm install @cello/connect`.
*   **Skeptic Objection:** *"Isn't cryptocurrency/decentralization just hype? Why do we need a decentralized directory?"*
    *   **Response:** Cello is not a Web3 marketing project; it is infrastructure built on hard cryptographic primitives. A centralized directory is a single point of failure and a single gatekeeper that can change the terms of your business overnight. Cello uses sovereign, federated nodes and threshold signatures so that no single platform can quietly alter the communication records, censor your agent, or capture your data.

---

## 9. Voice, Tone, and Style Guide

Cello talks with **Quiet Confidence**. We do not use hype, and we let the factual precision of our engineering carry the weight.

### 9.1. Core Directives
*   **Be Concrete:** Explain *how* Cello secures the connection (FROST, programmatic shields, egress ripping) rather than using vague words like "revolutionary," "game-changing," or "bleeding-edge."
*   **No Hype or Performance:** State achievements matter-of-factly. Avoid "We are proud to announce" or "humbled to share." Use plain, direct verbs.
*   **Direct & Unembellished:** Acknowledge failures, gaps, and technical boundaries clearly. No heroic framing.

### 9.2. Style Conventions
*   **Always refer to the product as:** "Cello" (Sentence case) or "CELLO" (all-caps in protocol specifications). Avoid "the Cello protocol" unless explicitly discussing the technical RFC.
*   **Preferred Terms:** Use "agents" or "collaborative swarms" instead of "bots." Use "operators" instead of "users" when discussing the humans managing the agents.
*   **Avoided Terms:** Do not use Web3 buzzwords ("dApps," "smart contract revolution") when explaining economic bonds—frame it strictly around risk management, Sybil defense, and arbitration.

---

## 10. Contact Management & Persona Matrix

Control over the flow of incoming communications is split into four strict tiers, allowing human operators to manage autonomy seamlessly.

```
Incoming Call  ──► [ VIP Tier ]       ──► Bypass Do-Not-Disturb (Auto-Accept Session)
               ──► [ Whitelist ]      ──► Allow Session (Prompt Operator if Busy)
               ──► [ Neutral Tier ]   ──► Inspect Directory Attestations & Reputation
               ──► [ Blocked Tier ]   ──► Silently Discard
```

### 10.1. The Four Tiers of Inbound Routing
1.  **VIP Tier:** Bypasses all Do-Not-Disturb settings. Sessions are automatically accepted and processed. *Example:* Close colleagues, trusted business partners, or internal system agents who work together constantly.
2.  **Whitelist Tier:** Permitted to establish sessions, but subject to operator availability and standard scheduling.
3.  **Neutral Tier:** Subject to rigorous directory screening. The agent evaluates their cryptographic endorsements, past attestations, and reputation hashes before deciding whether to accept the connection.
4.  **Blocked Tier:** Discarded immediately at the relay layer. No CPU cycles or API tokens are wasted.

### 10.2. Persona Mapping

#### The Operator (The Non-Developer Builder)
*   *Who they are:* Consultants, GTM leaders, digital operators running swarms of agents (Hermes, Claude Code) to handle copy, outreach, and analysis.
*   *Their Pain:* Constantly acting as a "mail boy" manual human-bridge to share outputs with team members.
*   *Core Message:* "Cello gives your agents a direct line to collaborate safely, so you can go back to being the boss."

#### The Platform / Security Engineer
*   *Who they are:* Developers tasked with connecting internal agents to external client systems securely.
*   *Their Pain:* The massive architectural cost of designing custom auth, transit security, and prompt-injection firewalls for every external integration.
*   *Core Message:* "Five minutes from install to secure, cryptographically verified, and shielded agent-to-agent communication via `npm install @cello/connect`."

---

## 11. Canonical Content Blocks

### Website Hero Text
> **Your AI is 2026. Your collaboration is 1995.**
> You can spin up an AI swarm to do the work of an entire department in an afternoon, but collaborating with others still requires you to copy-paste transcripts and manual files. 
> 
> Cello gives your agents a secure, direct line—private, verified, and with a tamper-proof paper trail only you and the other operator hold.

### The "About Cello" Boilerplate
> Cello is an independent trust layer built on top of a secure peer-to-peer messaging protocol. By combining libp2p direct transport with FROST threshold identity signatures and Merkle-tree session receipts, Cello resolves both the technical routing hurdles and structural prompt-injection dangers of agent-to-agent communication. Cello enables secure, sovereign cross-boundary agent collaboration without centralized vendor lock-in.

---

## 12. Versioning & Changelog

*   **v1.0 (2026-07-20):** First comprehensive draft. Reconciled the GTM "not just for developers" ICP pivot with the technical M9 "inbound/outbound security gateway" layers. Established the "technical issues vs. structural dangers" framing.
*   **Owner:** Andre Pemmelaar (andre@mygentic.ai)
*   **Update Cadence:** Reviewed and updated following every major milestone release or protocol-level pivot.
