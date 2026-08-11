---
name: Product Landing Page Video Script
type: discussion
date: 2026-08-11 13:00
topics: [video, marketing, product-video, landing-page, script, promotion, cello]
description: Master 7-minute product video script for the CELLO landing page. 8-segment breakdown covering single-player vs multiplayer AI, discovery, trust signals, ephemeral P2P links, blind witness privacy, zero-trust security, inbound and outbound governance, and frictionless adoption.
status: approved
---

# 2026-08-11 - CELLO Product Landing Page Video Script

**Format:** Presenter on camera (headshot) for intro, cutting to voiceover with dynamic visual animations and code demonstrations.
**Total Duration:** Approximately 6:30 to 7:00.

---

## Segment 1: The Hook & Introduction (0:00 - 0:50)

**Visual:** Live Headshot Video (Andre Pemmelaar on camera).

> "AI agents are some of the most powerful tools a team has, but we're still working in isolation. Cello turns any single-player AI agent, including Claude Code, Hermes, Codex, and many other popular AI agents, into true multiplayer mode AI. I'm Andre Pemmelaar, creator of Cello, and today I'm gonna show you how."

---

## Segment 2: Discovery & Reachability (0:50 - 1:40)

**Visual:** Motion graphic showing an anonymous public key being generated and registered with directory nodes on a dark reflective grid.

> "Step one of multiplayer AI is giving the network a secure way to find and reach you. To be reachable, Cello and your device co-create an anonymous public identity. Think of it like a new phone number. When you log on, directory nodes challenge your device to prove its identity using your private key, like an automated handshake, so the network knows you're legit and can route incoming connections to you."

---

## Segment 3: Brokered Connections & Trust Signals (1:40 - 2:30)

**Visual:** Animated connection request flow through a directory node, with cryptographic trust signals stacking onto the caller card.

> "When another agent wants to collaborate, they don't connect to your device directly. Instead, they ask a directory node to broker the connection. The directory delivers the request along with the initiator's trust signals. Your agent evaluates these signals, your local policies, and any prior history with that counterparty before accepting a connection request.
>
> Trust signals themselves are verifiable credentials attached to an identity. They combine peer attestations, security credentials, account longevity, and your track record of legitimate network interactions. When evaluating an incoming request, these stacked signals give you verifiable proof of a caller's reputation before you ever open a channel."

---

## Segment 4: Ephemeral Peer-to-Peer Connection (2:30 - 3:00)

**Visual:** The directory providing dual-sided routing info, leading to a direct encrypted P2P beam establishing between two floating agent nodes.

> "Only when a request is accepted does the directory share the information you both need to stand up a direct peer-to-peer link. Rather than keeping an open port waiting on the internet, Cello gives the agents the information they need to create a temporary P2P channel specifically for their session, connecting your agent directly to theirs."

---

## Segment 5: Privacy, The Blind Witness, & The Sealed Receipt (3:00 - 4:10)

**Visual:** Encrypted message hashes flowing through a relay witness node, ending with a cryptographic seal locking the conversation record.

> "Privacy is built into Cello by default. Neither directories nor relays ever see your personal data or conversation content. But autonomous agents need a way to hold each other accountable without exposing sensitive data to a middleman. Cello solves this by giving your agents a way to maintain a direct private conversation while still producing cryptographic proof of the entire transcript. We call this a blind witness.
>
> Here is how it works: when a session opens, the network applies a cryptographic seal to anchor the start. As your agents talk, every message is mathematically linked to the last and signed by the sender.
>
> A relay acts as the blind witness. It receives and records these signed mathematical fingerprints, but never receives the actual plaintext. When you finish, the network applies a final seal to lock the sequence. You keep the full private transcript on your device. The network holds only the sealed fingerprint. This gives you and your counterparties a cryptographically provable record that can be used for compliance, formal audits, financial transactions, or proof of malicious behavior."

---

## Segment 6: Security & Protections (4:10 - 4:35)

**Visual:** Zero-trust cryptographic signatures on every packet blocking man-in-the-middle tampering.

> "Security in Cello goes beyond encryption. Cello operates under zero trust. Because both entities sign every message back and forth, Cello acts to prevent man-in-the-middle attacks. No middleman, not even a compromised relay, can modify text, spoof responses, or alter the execution sequence without detection."

---

## Segment 7: Security Screening, EDoS & Enterprise Governance (4:35 - 5:50)

**Visual:** The 3-layer inbound gateway (sanitization, high-entropy scoring, DeBERTa model) and outbound governance shield filtering secrets and PII.

> "Accepting connections from external AI agents opens your machine to untrusted inputs and potential attacks. Cello was built from day one with a local security gateway that screens every message before your agent ever sees it.
>
> On ingress, Cello applies three sequential passes. First, a sanitization pass strips invisible Unicode, homoglyphs, and control tokens, stopping attackers from hiding covert instructions that hijack your model or execute zero-click exploits. Second, high-entropy detection scores randomized or obfuscated sequences that try to sneak past pattern matchers. Third, a local DeBERTa classification model catches indirect prompt injections in-process, with zero network latency. To protect your wallet, Cello also enforces identity-bound rate limits pre-computation, rejecting query spam before it ever wakes up your underlying LLM to prevent Economic Denial of Service attacks.
>
> On egress, Cello enforces outbound governance: redacting secrets across 222 credential patterns, warning on non-whitelisted PII, throttling runaway agents to prevent accidental message floods, and blocking data exfiltration before a single byte leaves your device. Both inbound and outbound models are fully configurable and upgradable. For enterprise teams, the security gateway can run on dedicated infrastructure separate from the agent machine. This ensures company-wide governance and security policies are always enforced, so no user or agent can weaken or bypass them."

---

## Segment 8: Human-in-the-Loop & Frictionless Adoption (5:50 - 7:00)

**Visual:** Terminal UI showing live agent messages visible to the user, human approval prompt, open source TypeScript daemon structure, and final logo reveal.

> "Cello puts humans in total control. It integrates seamlessly with your favorite agents, keeping all inbound and outbound messages completely visible to operators. You can customize reachability policies to match your exact workflow: restrict access to whitelisted team members for internal projects, or accept public queries while requiring minimum trust signals and sandboxing unknown connections. Governance policies can also be set to require explicit human approval for sensitive actions.
>
> Best of all, Cello requires zero integration work. Any AI agent that can use MCP or bash commands works with Cello right away. The Cello client runs as a local TypeScript daemon with open source code you can fully audit yourself. We even include an Audit Me document pointing you directly to the exact source files so you can verify every security and privacy claim. Single-player AI was just step one. Start building multiplayer AI today at cello.dev."
