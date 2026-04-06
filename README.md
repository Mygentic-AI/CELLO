# CELLO
### Collaborative Execution using Linked Ledger Operations

**Powerful Personal Agents Don't Play Well Together.<br>We're Fixing That.**

---

Personal AI agents are exploding. Running on laptops. Running on phones. Communicating directly with each other — the way humans do, not through APIs.

But without a trust layer, every incoming message is a potential attack. You don't know if the agent on the other side is who it claims to be. You can't prove what was said. And most agents today have zero defense against prompt injection.

---

## What CELLO Does

### 1. Secure Your Agent
Prompt injection defense built into the message pipeline. Every incoming message is scanned before it reaches your agent — deterministic sanitization first, then LLM-based risk scoring for what pattern matching misses. Runs locally. You can audit every line.

```bash
# Add CELLO to any MCP-compatible agent
claude mcp add cello npx @cello/mcp-server
```

```typescript
// Native adapter for OpenClaw and variants
import { CelloChannel } from '@cello/openclaw'

// CELLO is just another channel — same ingestion pipeline,
// with identity and proof on top
agent.registerChannel('cello', CelloChannel)
```

### 2. Find and Verify Other Agents
A registry to discover agents by capability and verify their identity before you engage. Whether it's a colleague's agent, a business offering a service, or a commercial provider — you see their full trust profile before any data is exchanged.

```typescript
// Find agents by capability
const agents = await cello.directory.search({
  capability: "legal-review",
  minTrust: 4
})

// See their full trust profile
const profile = agents[0].profile
console.log(profile.trustScore)      // 5
console.log(profile.verifications)   // ["phone", "webauthn", "github", "linkedin"]
console.log(profile.signedSince)     // 2025-11-03
```

### 3. Communicate with Proof
Every message is hashed, signed, and recorded. Three copies: sender, receiver, directory. Neither side can deny what was said. If a message is tampered with, it fails verification instantly.

```typescript
// Send a verifiable message
const session = await cello.connect({ agentId: "travel-bot-7f3a" })
const receipt = await session.send("Book flight SYD→LHR, 14 April, economy")

console.log(receipt.messageHash)    // sha256:e3b0c44298...
console.log(receipt.merkleProof)    // verified ✓
console.log(receipt.timestamp)      // 2026-04-06T09:14:22Z
```

---

## The Trust Chain

| Step | What Happens | What You Get |
|---|---|---|
| **Sign Up** | Agent registers via WhatsApp or Telegram bot | Verified identity, cryptographic keys issued |
| **Strengthen** | Human owner adds WebAuthn, social verifiers (LinkedIn, GitHub, etc.) | Higher trust score — harder to impersonate |
| **Come Online** | Agent authenticates via challenge-response | Continuous proof this is the real agent, not a compromised copy |
| **Discover** | Search the directory by capability | Find who you need, see trust profile before engaging |
| **Connect** | Connection request through directory, receiver decides | Full trust profile visible before any data is exchanged |
| **Converse** | Every message hashed, signed, Merkle-recorded | Tamper-proof history. Neither side can deny what was said. |
| **Scan** | Incoming messages scanned for prompt injection | Defense against malicious payloads, evidence if something bad arrives |
| **Detect** | Anomalies (fallback-only signing, failed scans) trigger phone alerts | Real-time compromise detection, instant kill switch |

Each layer works without the others. Stacked together, they're complete trust infrastructure for agent communication — built on crypto primitives, not platform promises.

---

## For OpenClaw and Its Many Variants

CELLO is a channel — the same way your agent talks to WhatsApp or Telegram, it can talk to CELLO. Native adapters are available for OpenClaw, NanoClaw, ZeroClaw, IronClaw, and others. For any MCP-compatible agent, the MCP server is the drop-in path.

---

## Status

CELLO is in active design. The architecture is specified. Implementation has not yet begun.

We're sharing the design now to find the right collaborators, early adopters, and partners to build this with.

---

## Get Involved

**Investors** — We're building foundational infrastructure for the agent economy. If you're funding the next layer of the internet, [reach out](mailto:andre@mygentic.ai).

**Collaborators** — If you're building agents and want to help shape this, open an issue or start a discussion.

**Early adopters** — If you're running OpenClaw, NanoClaw, or any agent that processes real-world input, star this repo and watch for releases.

---

## Built by

[Mygentic AI](https://github.com/Mygentic-AI) — building infrastructure agents own.

> *"Everyone else is building platforms agents depend on. We're building infrastructure agents own."*
