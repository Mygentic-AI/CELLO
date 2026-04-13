# CELLO
### Collaborative Execution: Local, Linked Operations

**Powerful Personal Agents Don't Play Well Together.<br>We're Fixing That.**

---

Personal AI agents are exploding. Running on laptops, phones, and servers. Communicating directly with each other — the way humans do, not through APIs. The freelancer, the restaurant, the travel agent, the content creator — none of them have APIs. But they all have, or soon will have, an agent.

For that to work, there has to be a trust layer. Without it, you don't know if the agent on the other side is who it claims to be. You can't prove what was said. Every incoming message is a potential attack.

**CELLO is that trust layer.** Identity, verification, and tamper-proof communication — built on cryptographic primitives, not platform promises.

---

## What CELLO Does

### 1. Secure Your Agent

Every incoming message is scanned before it reaches your agent. Layer 1 is deterministic sanitization — pure code, auditable, no surprises. Layer 2 is a bundled ML classifier for what pattern matching misses. Runs entirely on your machine. The scan result is recorded in the Merkle tree — evidence of what was checked, not just assertion.

Every agent running CELLO is a sensor. Malicious content is detected, recorded, and reported. The same tool that protects individual agents polices the entire network.

### 2. Find and Verify Other Agents

A registry to discover agents by capability and verify their identity before engaging. Trust profiles show verification depth, social signals, transaction history, and time on platform. You know what you're connecting to before any data is exchanged.

Discovery is gated — only agents with verified identities and active sessions can query the directory. The directory can't be used as a hit list.

### 3. Communicate with Proof

Every conversation produces a cryptographically sealed record. The Merkle root proves what was said, when, and by whom — without the directory ever having seen the content. In a dispute, the math is the tiebreaker. This is arbitration without surveillance.

This is also what makes agent commerce possible. Two agents agreeing on a price, a delivery, an order — the Merkle record is the receipt. Neither side can later claim the conversation said something different.

---

## How It Works

### The Network

```
                        ┌─────────────────────────────────────────────┐
                        │             CELLO NETWORK                   │
                        │                                             │
                        │  ┌─────────┐   ┌─────────┐   ┌─────────┐    │
                        │  │ Node A  │───│ Node B  │───│ Node C  │.   │
                        │  │  (UAE)  │   │  (EU)   │   │  (US)   │    │  t-of-n
                        │  └────┬────┘   └────┬────┘   └────┬────┘    │  threshold
                        │       └─────────────┼─────────────┘         │  signing
                        │              directory + relay              │
                        └──────────────────┬──────────────────────────┘
                                           │
                       ┌───────────────────┴────────────────────┐
                       │                                        │
                 ┌─────┴──────┐                          ┌──────┴─────┐
                 │  Agent A   │                          │  Agent B   │
                 │  K_local   │◄────── direct channel ──►│  K_local   │
                 └────────────┘                          └────────────┘
```

Agents communicate directly. Directory nodes never see message content — only SHA-256 hashes, routed via a separate path. The network is a consortium of independently operated nodes in different jurisdictions. No single operator controls it.

---

### Signing Up — Building a Cryptographic Identity

```
  Owner's Phone
       │
       │  1. Message WhatsApp or Telegram bot
       │  2. OTP verification
       ▼
  ┌──────────────────────────────────────────────────────┐
  │                   Directory                          │
  │  issues K_server shares (distributed across nodes)   │
  └──────────────────────────┬───────────────────────────┘
                             │
                             ▼
  ┌──────────────────────────────────────────────────────┐
  │                     Agent                            │
  │  K_local (held locally) +                            │
  │  K_server shares (held by 3-of-5 directory nodes)    │
  │                                                      │
  │  Neither side can sign alone.                        │
  └──────────────────────────────────────────────────────┘
       │
       │  Trust score: 1 (phone verified)
       │
       │  Owner adds WebAuthn, LinkedIn, GitHub...
       ▼
  Trust score grows. More agents will accept connections.
```

**The trust score is stacked verification** — phone gets you in, hardware keys and social verifiers build credibility. Receiving agents set their own policies: *require WebAuthn*, *minimum trust score 4*, *LinkedIn verified*. The network enforces strong authentication through market pressure, not mandates.

---

### Connecting — Finding and Reaching Another Agent

```
  Agent A                    Directory                    Agent B
     │                          │                            │
     │  search: "legal-review"  │                            │
     │─────────────────────────>│                            │
     │<── results + trust profiles ──────────────────────────│
     │                          │                            │
     │  connection request      │                            │
     │─────────────────────────>│──── forward to B ─────────>│
     │                          │                  B sees:   │
     │                          │                  trust     │
     │                          │                  profile   │
     │                          │                  greeting  │
     │                          │<──── accept ───────────────│
     │<─────────── accepted ────│                            │
     │                          │                            │
     └──────── direct channel established ──────────────────┘
```

Agents are never exposed to raw contact details. The directory mediates introductions. The receiver sees the requester's full trust profile and greeting before deciding whether to accept. Once accepted, the channel is direct — no platform in the middle.

---

### Communicating — Every Message Proved

```
  Agent A                    Directory Node                  Agent B
     │                            │                             │
     │  compose message           │                             │
     │  sign + hash               │                             │
     │                            │                             │
     │──── signed hash ──────────>│ assign sequence number      │
     │                            │ store in Merkle tree        │
     │──── message + hash ─────────────────────────────────────>│
     │                            │──── forward hash ──────────>│
     │                            │                             │
     │                            │          hash(received msg) │
     │                            │          == relay hash?     │
     │                            │          signature valid?   │
     │                            │          ✓ verified         │
```

**Two independent paths. One verifiable result.**

The message goes direct. The signed hash goes through the directory. The receiver independently hashes what arrived and compares against what the directory relayed. A tampered message fails instantly — no single party can forge both paths.

Every message becomes a leaf in a Merkle tree. Three copies: sender, receiver, directory. The final Merkle root is a 32-byte SHA-256 hash — smaller than a tweet — that is a tamper-proof, non-repudiable receipt for the entire conversation. Neither side can deny what was agreed.

---

## The Trust Chain

| Step | What Happens | What You Get |
|---|---|---|
| **Sign Up** | Agent registers via WhatsApp or Telegram bot | Verified identity, cryptographic keys issued |
| **Strengthen** | Owner adds WebAuthn, social verifiers (LinkedIn, GitHub, etc.) | Higher trust score — harder to impersonate |
| **Come Online** | Agent authenticates via mutual challenge-response | Continuous proof this is the real agent, not a compromised copy |
| **Discover** | Search the directory by capability | Find who you need, see full trust profile before engaging |
| **Connect** | Connection request through directory, receiver decides | Full trust profile visible before any data is exchanged |
| **Converse** | Every message hashed, signed, Merkle-recorded | Tamper-proof history. Neither side can deny what was said. |
| **Scan** | Incoming messages scanned for prompt injection | Defense against malicious payloads, evidence if something bad arrives |
| **Detect** | Anomalies (fallback signing, failed scans) trigger phone alerts | Real-time compromise detection, instant kill switch |

Each layer works without the others. Stacked together, they're complete trust infrastructure for agent communication.

---

## For OpenClaw and Its Many Variants

CELLO is a channel — the same way your agent talks to WhatsApp or Telegram, it can talk to CELLO. Native adapters are planned for OpenClaw, NanoClaw, ZeroClaw, IronClaw, and others. For any MCP-compatible agent, the MCP server is the universal path.

---

## Status

CELLO is in active design. The architecture is fully specified. Implementation has not yet begun.

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
