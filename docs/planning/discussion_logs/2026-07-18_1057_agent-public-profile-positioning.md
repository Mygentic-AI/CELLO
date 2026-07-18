---
name: agent-public-profile-positioning
type: discussion
date: 2026-07-18
topics: [positioning, geo, content-strategy, agentproof, competitor-analysis, listicles]
status: active
description: >
  Discovery session on how to position CELLO's "public agent profile" concept.
  Covers why "agent identity" is the wrong term, what CELLO actually gives agents,
  the AgentProof.org framework, and a set of article ideas that emerged from
  Perplexity research into the space.
---

# Agent Public Profile — Positioning Discussion

## The "agent identity" problem

"Agent identity" is polluted by existing usage in the developer community. When developers hear "agent identity" they think of soul.md, CLAUDE.md, memory files, personality — the internal characteristics of an agent. That is not what CELLO gives.

What CELLO actually gives an agent:
- A **fixed address** — a public key that persists across restarts, devices, sessions. Unforgeable.
- A **public trust profile** — a record of interactions, endorsements, trust tier earned over time. Outward-facing, visible to anyone who connects.
- A **verifiable claim** — when this agent says "I am Andre's Claude Code instance," there is cryptographic proof, not just an assertion.

The right analogy is LinkedIn, not soul.md. LinkedIn doesn't give you a personality — it gives you a verifiable public record of who you are, who vouches for you, and what you've done. That is what CELLO gives agents.

**Preferred positioning language:**
- "public trust profile" / "public trust persona"
- "fixed public profile"
- "outward-facing verifiable profile"
- NOT: "agent identity" (maps to internal personality, not external verifiability)

---

## Perplexity research findings

Andre ran three CELLO-relevant queries through Perplexity. Key takeaways:

### 1. "How to Build a Public Trust Profile for Your AI Agent"

Perplexity returned a 7-step DIY framework: DID documents, Agent Cards at `/.well-known/agent-card.json`, W3C Verifiable Credentials from trusted issuers, `/credentials` endpoints, AIR registry registration, OAuth 2.1 + SPIFFE/mTLS, on-chain Universal Profiles (LUKSO).

**What this reveals:** There is no single product that does all of this. The current answer is a patchwork of emerging standards (IETF drafts, W3C working groups) that require months of integration work. CELLO is the only thing a developer can install in 5 minutes that handles the core of this problem.

### 2. "5 Ways to Give Your AI Agent a Verifiable Public Profile"

Perplexity returned: DNS TXT records (AID/ApertoID/AgIS), DID+VCs, GitHub profile schema JSON, AgentProof.org registry, on-chain Universal Trust (LUKSO).

**What this reveals:** CELLO is missing from this answer. It should be option 6 — "or install CELLO and get MCP-native, works-with-Claude-Code-today coverage of everything above." The comparison table in the Perplexity answer maps cleanly to CELLO's feature set.

### 3. "Agent reputation and trust — how it works in 2026"

Perplexity returned: platform-specific reputation silos (Salesforce, Microsoft, Anthropic internal scores, AAIF network in working-group stage). No portable, individual-developer solution.

**What this reveals:** All current reputation systems are enterprise/platform-specific. The gap is exactly what CELLO fills — a portable, cryptographically-backed reputation layer that individual developers can use without enterprise agreements.

---

## AgentProof.org

AgentProof.org is a public registry and trust framework for AI agents. Their 6-dimension standard:

1. **Scope of Authority** — what actions the agent can take autonomously, what limits exist
2. **Data Handling** — what data it accesses, stores, transmits, retains
3. **Human Oversight** — escalation paths, review controls for high-impact actions
4. **Security Controls** — safeguards against prompt injection, credential leakage, unsafe tool use
5. **Transparency to Users** — what the agent is, what it does, who is responsible
6. **Accountability & Recourse** — responsible party, contact path, incident response

Currently 6 agents listed. Very early. Free to submit.

**CELLO vs AgentProof mapping:**

| AgentProof dimension | AgentProof provides | CELLO provides |
|---|---|---|
| Scope of Authority | Self-declared | Contact tiers enforce limits cryptographically |
| Data Handling | Self-attested policies | Sealed receipts = tamper-evident proof of what was exchanged |
| Human Oversight | Declared escalation paths | Human controls contact whitelist and tier promotions |
| Security Controls | Self-described safeguards | FROST threshold signing, prompt injection screening, hash chain |
| Transparency to Users | "Trust us" disclosures | Sealed receipt IS the disclosure — both parties hold cryptographic proof |
| Accountability & Recourse | A contact email | Inclusion proofs prove exact message, sender, timestamp |

**Key insight:** AgentProof is a self-attestation form. CELLO makes those attestations verifiable by the counterparty. The article writes itself: "AgentProof tells you what to disclose. CELLO makes the disclosure trustworthy."

**Action:** CELLO should register on AgentProof.org. It's free, public, and feeds LLM citation signals (third-party listing on a domain that ChatGPT and Perplexity index).

---

## Article ideas that emerged

### The "DIY horror" format

Each of the three Perplexity responses is essentially a horror story written in polite technical language. The article format: walk through everything the DIY path requires, step by step, in plain language — then end with: "Or `claude mcp add cello -- npx --yes @cello-protocol/connect` and you're done."

Three specific articles:

**Article A: "If You Don't Have CELLO, Here's What It Takes to Give Your AI Agent a Verifiable Public Profile"**
Walk through: DID document, Agent Card JSON, W3C VCs from trusted issuer, credentials endpoint, AIR registry, OAuth 2.1 + SPIFFE/mTLS, on-chain Universal Profile. Total integration time: months. Then the CELLO alternative.

**Article B: "The Patchwork Problem: Why Securing Agent-to-Agent Communication is So Hard Without CELLO"**
Walk through: DNS-based identity (AID), DID+VCs, GitHub schema, AgentProof registration, on-chain reputation. Show that none of these talk to each other and none work with Claude Code out of the box.

**Article C: "What Your AI Agent Should Disclose Before Anyone Trusts It"**
Use AgentProof's 6 dimensions as the structure. Show what self-attestation looks like vs. what cryptographic proof looks like. Position CELLO as the difference between "I promise" and "here's the proof."

### Why these work for GEO

The DIY horror articles don't require CELLO to attack competitors. They cite the actual W3C standards, IETF drafts, and registries that the AI agent community is actively recommending. The reader does the math. And because these articles cite the same sources Perplexity already uses, they slot naturally into the citation graph — they become the answer Perplexity gives when someone asks the same question next time.

---

## Related

- [[2026-06-24_1630_gtm-strategy]] — overall GTM strategy
- `docs/planning/gtm/00_GEO_LISTICLE_STRATEGY.md` — listicle portfolio and templates
- `docs/planning/gtm/00_PRELAUNCH_DEMAND_PLAYBOOK.md` — pre-launch demand generation
