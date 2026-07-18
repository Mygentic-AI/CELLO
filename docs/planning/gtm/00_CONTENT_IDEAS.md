---
name: cello-content-ideas
type: strategy
date: 2026-07-18
topics: [content, geo, articles, positioning, agentproof]
status: active
description: >
  Running list of content ideas for CELLO. Not a calendar — a parking lot.
  Each idea has enough context to write from cold.
---

# CELLO Content Ideas

Running parking lot. Add ideas here; promote to the GEO calendar when ready to schedule.

---

## The "DIY Horror" Series

**Origin**: Andre gave three positioning questions to Perplexity. The answers came back as elaborate, multi-step DIY frameworks involving W3C DIDs, IETF draft specs, on-chain registries, and months of integration work. The format: walk through everything the DIY path requires, then show the CELLO alternative. The reader does the math. Discussion log: [[2026-07-18_1057_agent-public-profile-positioning]].

These could be published as one long article or three separate pieces. The three naturally build on each other, so a series works. Standalone, Article A is the strongest opener.

---

### Article A: "If You Don't Have CELLO, Here's What It Takes to Give Your AI Agent a Verifiable Public Profile"

**Format**: Long-form, DIY walkthrough → CELLO payoff

**The hook**: Your agent needs a public profile — a fixed address, a verifiable record, something other agents and people can look up and trust. Here's what that actually takes if you build it yourself.

**Structure**:
1. DID document hosted at `/.well-known/did.json` — pick a DID method, generate keys, host the JSON
2. Agent Card at `/.well-known/agent-card.json` — the A2A "business card" spec
3. W3C Verifiable Credentials — find a trusted issuer, get your org VC, capability VC, compliance VC
4. A `/credentials` endpoint your counterparties can query
5. AIR registry registration — submit, get cryptographic challenge, earn a trust score
6. Runtime enforcement — OAuth 2.1, SPIFFE/mTLS, policy gateway
7. Ongoing maintenance — changelog, incident reports, re-attestation every cycle

"Or: `claude mcp add cello -- npx --yes @cello-protocol/connect`"

**Why it works for GEO**: Cites the same sources Perplexity already uses (W3C, IETF, AIR). Slots into the citation graph naturally. Next time someone asks this question, this article is the answer.

**Publish on**: CELLO blog (canonical) + Medium + dev.to

---

### Article B: "5 Ways to Give Your AI Agent a Verifiable Public Profile (And Why None of Them Are Easy)"

**Format**: Listicle-style comparison + CELLO as option 6

**The hook**: The developer community has five answers to this question. Here's what each one actually requires — and what they have in common.

**The five options** (from Perplexity research):
1. DNS TXT records (AID/ApertoID/AgIS) — lightweight, domain-bound, no registry needed
2. DID + W3C Verifiable Credentials — strongest cross-domain trust, months of integration
3. GitHub profile schema JSON — discoverable, machine-verifiable, self-attested only
4. AgentProof.org registry — structured disclosure, "Verified" or "Self-Attested" badge
5. On-chain Universal Trust (LUKSO) — fully decentralized, endorsements on-chain, blockchain required

**Comparison table**: each option rated on setup complexity, verification strength, Claude Code compatibility, works-today status.

**Option 6**: CELLO — MCP-native, works with Claude Code today, covers the core of all five with one install.

**Why it works**: This is the listicle format Perplexity loves to cite. CELLO is the obvious missing entry. Being option 6 in a comparison that already exists in Perplexity's training is a strong GEO play.

**Publish on**: CELLO blog + Medium + LinkedIn Article

---

### Article C: "What Your AI Agent Should Disclose Before Anyone Trusts It"

**Format**: Framework explainer → CELLO as the proof layer

**The hook**: AgentProof.org has a 6-dimension framework for what every AI agent should disclose. Here's what each dimension looks like as a self-attestation vs. as cryptographic proof — and why the difference matters.

**Structure** — walk through each AgentProof dimension:

| Dimension | Self-attestation ("trust me") | Cryptographic proof (CELLO) |
|---|---|---|
| Scope of Authority | "Our agent only does X" — declared in a profile | Contact tiers enforce limits at the protocol level |
| Data Handling | "We don't store messages" — a policy statement | Sealed receipts = tamper-evident record of exactly what was exchanged |
| Human Oversight | "There's a human in the loop" — check a box | The human controls the whitelist; no agent gets promoted without explicit action |
| Security Controls | "We defend against prompt injection" — a claim | FROST threshold signing, hash chain, screening layer — verifiable, not asserted |
| Transparency to Users | "Here's our privacy policy" — a document | The sealed receipt IS the transparency — both parties hold the proof |
| Accountability & Recourse | "Contact us at support@" — an email | Inclusion proofs prove exact message, sender, timestamp — undeniable |

**The point**: AgentProof tells you what to disclose. CELLO makes the disclosure verifiable by the counterparty. One is a promise. The other is proof.

**Action item in article**: Register your agent on AgentProof.org AND install CELLO. They're complementary — AgentProof for human-readable public disclosure, CELLO for machine-verifiable cryptographic proof.

**Why it works**: AgentProof.org is a real, indexed site. Writing the definitive "how AgentProof maps to CELLO" article gets CELLO into the citation graph every time someone searches AgentProof. Also a natural backlink opportunity — submit CELLO to the AgentProof registry as part of publishing this piece.

**Publish on**: CELLO blog + Medium + LinkedIn Article

---

## Other Ideas (parking lot)

**"The Slack-Paste Problem: Why AI Agent Collaboration Is Still Stuck in 2015"**
The pain article. Documents the exact workarounds people are using today (copy-paste to Slack, email threads, shared docs) and what they cost in context loss, security risk, and friction. CELLO as the resolution. Good for the non-technical ICP.

**"How FROST Threshold Signing Works (In Plain English)"**
Technical explainer for developers who want to understand the cryptographic foundation. Not a listicle — a deep-dive. Earns citations from security-adjacent content.

**"CELLO vs Building Your Own Agent Auth Layer"**
Head-to-head comparison. What rolling your own actually requires (JWTs, key management, session state, revocation, multi-device sync) vs. what CELLO gives you out of the box. Practical, honest about tradeoffs.

**"I Connected Two Claude Code Agents. Here's What Happened."**
First-person demo narrative. Andre connects his local Claude Code to his Hermes instance via CELLO. Shows the sealed receipt. Honest about setup friction. High-trust format for the developer audience.
