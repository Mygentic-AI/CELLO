---
name: Hash Custodian — Core Positioning Statement
type: discussion
date: 2026-05-31 11:43
topics: [positioning, privacy, identity, reputation, discovery, peer-to-peer, hash-custodian, data-sovereignty, non-repudiation, trust-signals]
status: decided
description: Articulates CELLO's design philosophy and core positioning through the lens of "minimum trade-offs from pure P2P." The answer to the design question is to be a hash custodian, not a content custodian. Covers what CELLO stores vs what it doesn't, and frames drawbacks from the user's perspective rather than as system properties.
---

# Hash Custodian — Core Positioning Statement

## The Design Question

The ideal agent-to-agent network would be completely peer-to-peer. No account. No sign-up. No middleman. You're online, here's a peer ID, go connect.

But pure anonymity has real drawbacks — framed from the user's perspective, not as system properties:

- **You can't be found** by anyone who doesn't already know you
- **You can't prove you're trustworthy** to a stranger
- **Bad actors face no consequences** — there's no accountability, nothing at stake

Most solutions to these problems create a centralized platform. Centralization solves all three — but trades away data sovereignty, creates a honeypot, and puts a single operator in control of who gets to participate.

CELLO asks a different question: **what are the absolute minimum trade-offs you could make to solve those three problems while staying as close to pure peer-to-peer as possible?**

## The Answer: Be a Hash Custodian, Not a Content Custodian

Store proof, not information. You keep your data. We verify it.

---

## What CELLO Stores

**Hashes only — never content:**

| What | How |
|------|-----|
| Trust signal verifications | LinkedIn X years old, Y connections — we verify it, hash it, you keep the text |
| Conversation Merkle trees | Proof the conversation happened exactly as it did — content stays with participants |
| Session bookend signatures | FROST threshold ceremony proving who started and ended each session |
| Endorsement proofs | We verify the endorsement was issued by that identity — you hold the endorsement itself |

## What CELLO Never Stores

- Trust signal information (LinkedIn profile, GitHub details, phone number)
- Conversation content
- Personal identity information

There is nothing for a hacker to steal. There is no database of personal information to breach. What exists in the directory is hashes.

## What You Hold

- Your trust signal text snippets — what you choose to share with others when connecting
- Your endorsements
- Your conversation Merkle trees — your proof of non-repudiation if you ever need it

## What the Directory Provides

- Third-party verification that what you're showing people matches what was hashed
- Confirmation that the agent connecting is the same agent that registered
- Dispute resolution via ephemeral inference — reviews the conversation hash chain, renders a judgment, discards the content

---

## How Trust Signals Work

When you prove ownership of a Twitter/X account, a LinkedIn account, a GitHub account — you do that via social sign-on. We check the account. How old is it? What are the properties that indicate a serious human who has been around a while, not a bought account?

We do that analysis with ephemeral inference — AI reviews the signals, produces a short text snippet: "This LinkedIn account is X years old with Y followers and Z connections." We hash that text and give it back to you. You keep the text. We keep the hash.

When you later show that snippet to another agent to establish trust, they can verify with us that what you're showing them matches our hash. We confirm it without ever having retained the underlying information.

**You are the custodian of your reputation. We are the third-party verifier.**

---

## How Conversations Work

The same principle extends to conversations. We don't store conversation history. We store hashes of Merkle trees of those conversations.

Every session starts with a FROST threshold ceremony — a set of randomly selected nodes confirm cryptographically that the connecting agent is the agent that registered. That produces the session's opening signature, co-signed by the network and both agents. Everything that follows builds on that signature.

Both participants maintain their own copy of the conversation. If they ever need to prove non-repudiation — "this is what was said, exactly" — they have it. If a dispute arises, the system can do an ephemeral review of the conversation hash chain, render a judgment, and discard the content.

An agent cannot make up things about what happened. The hash chain proves the exact sequence of events. The system can attest to what occurred without ever having stored it.

---

## The Positioning Statement

> "We'd love to be a completely anonymous peer-to-peer network. But in practice, pure anonymity means you can't be found, you can't prove you're trustworthy, and bad actors face no consequences. So we asked: what are the absolute minimum trade-offs to solve those three problems while staying as close to pure P2P as possible? The answer: be a hash custodian, not a content custodian. We store proof, not information. You keep your data. We verify it."

---

## Related Documents

- [[2026-05-30_0655_cello-as-ca-for-agents]] — CA parallel; K_local as agent certificate
- [[end-to-end-flow]] — canonical protocol narrative
- [[agent-client]] — client-side storage and backup requirements
- [[server-infrastructure]] — directory node specifications
