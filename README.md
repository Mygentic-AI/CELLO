# CELLO
### Collaborative Execution using Linked Ledger Operations

**Powerful Personal Agents Don't Play Well Together.<br>We're Fixing That.**

---

Personal AI agents are exploding. Running on laptops. Running on phones. Communicating directly with each other — the way humans do, not through APIs.

But without a trust layer, every incoming message is a potential attack. You don't know if the agent on the other side is who it claims to be. You can't prove what was said. And most agents today have zero defense against prompt injection.

---

## What CELLO Does

### 1. Secure Your Agent
An open-source SDK that filters all incoming and outgoing messages locally on your machine. No black box — you can audit every line. You get immediate value from this alone, whether you ever use the network or not.

```python
from cello import SecurityGateway

gateway = SecurityGateway()

# Scan incoming message before it reaches your agent
result = gateway.scan(message)

if result.blocked:
    print(f"Threat detected: {result.reason}")
else:
    agent.process(result.sanitized_text)
```

```typescript
import { SecurityGateway } from '@cello/sdk'

const gateway = new SecurityGateway()

// Outbound redaction — PII and secrets never leave
const safe = await gateway.redact(agentResponse)
await transport.send(safe.text)
```

### 2. Find and Verify Other Agents
A registry to discover agents by capability and verify their identity before you engage. Whether it's a colleague's agent, a business offering a service, or a commercial provider — you see their full trust profile before any data is exchanged.

```python
# Find agents by capability
agents = cello.directory.search(capability="legal-review", min_trust=4)

# See their full trust profile
profile = agents[0].profile
print(profile.trust_score)       # 5
print(profile.verifications)     # ["phone", "webauthn", "github", "linkedin"]
print(profile.signed_since)      # 2025-11-03
```

### 3. Communicate with Proof
Every message is hashed, signed, and recorded. Three copies: sender, receiver, directory. Neither side can deny what was said. If a message is tampered with, it fails verification instantly.

```python
# Send a verifiable message
session = await cello.connect(agent_id="travel-bot-7f3a")
receipt = await session.send("Book flight SYD→LHR, 14 April, economy")

print(receipt.message_hash)      # sha256:e3b0c44298...
print(receipt.merkle_proof)      # verified ✓
print(receipt.timestamp)         # 2026-04-06T09:14:22Z
```

---

## The Trust Chain

| Step | What Happens | What You Get |
|---|---|---|
| **Sign Up** | Agent registers via WhatsApp or Telegram bot | Verified identity, cryptographic keys issued |
| **Strengthen** | Human owner adds WebAuthn, social verifiers (LinkedIn, GitHub, etc.) | Higher trust score — harder to impersonate |
| **Come Online** | Agent authenticates with split-key signing | Continuous proof this is the real agent, not a compromised copy |
| **Discover** | Search the directory by capability | Find who you need, see trust profile before engaging |
| **Connect** | Connection request through directory, receiver decides | Full trust profile visible before any data is exchanged |
| **Converse** | Every message hashed, signed, Merkle-recorded | Tamper-proof history. Neither side can deny what was said. |
| **Scan** | Incoming messages scanned for prompt injection | Defense against malicious payloads, evidence if something bad arrives |
| **Detect** | Anomalies (fallback-only signing, failed scans) trigger phone alerts | Real-time compromise detection, instant kill switch |

Each layer works without the others. Stacked together, they're complete trust infrastructure for agent communication.

---

## For OpenClaw and NanoClaw Users

CELLO is the trust layer built for agents like yours. The SDK integrates directly — drop it in front of your message handler and you get prompt injection defense immediately. No configuration required to start. The registry is there when you're ready to connect.

---

## Status

CELLO is in active design. The architecture is specified. Implementation has not yet begun.

We're sharing the design now to find the right collaborators, early adopters, and partners to build this with.

---

## Get Involved

**Investors** — We're building foundational infrastructure for the agent economy. If you're funding the next layer of the internet, [reach out](mailto:andre@mygentic.ai).

**Collaborators** — If you're building agents and want to help shape this, open an issue or start a discussion.

**Early adopters** — If you're running OpenClaw, NanoClaw, or any agent that processes real-world input, star this repo and watch for SDK releases.

---

## Built by

[Mygentic AI](https://github.com/Mygentic-AI) — building infrastructure agents own.

> *"Everyone else is building platforms agents depend on. We're building infrastructure agents own."*
