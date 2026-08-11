---
name: Product Landing Page Video Script (3-Minute Version)
type: discussion
date: 2026-08-11 13:30
topics: [video, marketing, product-video, landing-page, script, promotion, cello, 3min]
description: Shorter 3-minute compressed version of the product landing page video script for CELLO. Verified spoken voiceover time is approximately 2 minutes 38 seconds (2:38 - 2:40).
status: approved
---

# 2026-08-11 - Product Landing Page Video Script (3-Minute Version)

**Format:** Presenter on camera (headshot) for intro, cutting to voiceover with dynamic visual animations, code demonstrations, and terminal UI overlays.
**Target Duration:** 3:00 total (Spoken voiceover timing verified at ~2:38 - 2:40).

---

## Segment 1: The Hook & Introduction (0:00 - 0:25)

**Visual:** Live Headshot Video (Andre Pemmelaar on camera).

> "AI agents are some of the most powerful tools a team has, but we're still working in isolation. Cello turns any single-player AI agent, including Claude Code, Hermes, Codex, and Cursor, into true multiplayer mode AI. I'm Andre Pemmelaar, creator of Cello, and today I'm gonna show you how."

---

## Segment 2: Discovery & Reachability (0:25 - 0:50)

**Visual:** Terminal showing identity co-creation and directory check-in.

> "Step one of multiplayer AI is reachability. To be reachable, Cello and your device co-create an anonymous public identity: the equivalent of a new phone number. When you log on, directory nodes verify your identity, allowing the network to route incoming connection requests directly to you."

---

## Segment 3: Brokered Connections & Trust Signals (0:50 - 1:20)

**Visual:** Incoming connection prompt with stacked trust signals card.

> "When another agent wants to collaborate, directory nodes broker the request. The directory forwards the caller's trust signals: verifiable credentials and peer attestations that prove their reputation. Your agent evaluates these signals against your local policies before deciding whether to accept."

---

## Segment 4: Ephemeral Peer-to-Peer Connections (1:20 - 1:45)

**Visual:** On-demand encrypted P2P tunnel establishing between two floating agent terminals.

> "Only after you accept does the directory share the routing information needed to stand up a direct peer-to-peer link. Cello never leaves open ports waiting on the internet. Instead, it creates an ephemeral, encrypted channel specifically for that session, connecting your agent directly to theirs."

---

## Segment 5: Privacy & The Blind Witness (1:45 - 2:15)

**Visual:** Relay receiving message hashes and applying the final sealed receipt.

> "Privacy is built in by default. Neither directories nor relays ever see your chat content. To guarantee accountability, Cello uses relays as blind witnesses. Relays record signed mathematical fingerprints of your messages and seal the final session. You keep the full private transcript on your device, giving both parties an immutable, cryptographically provable record for compliance or audits."

---

## Segment 6: Security Gateway & Governance (2:15 - 2:45)

**Visual:** Local security gateway intercepting an injection attempt and redacting a secret.

> "Accepting outside connections shouldn't mean risking your machine. Cello runs a local security gateway that screens every message in real time. Inbound text is sanitized to stop prompt injections and rate-limited pre-computation to prevent token-drain attacks. Outbound text is filtered for secret leaks before leaving your device. For enterprise teams, governance policies can run on dedicated infrastructure and be set to require human approval for sensitive actions."

---

## Segment 7: Frictionless Adoption & Close (2:45 - 3:00)

**Visual:** Terminal running `cello` with MCP tools, closing on `cello.dev` logo reveal.

> "Best of all, Cello requires zero integration work. Any agent using MCP or bash tools works right away. The Cello client runs as an open-source TypeScript daemon that you can fully audit yourself. Turn your isolated agents into a multiplayer network today at cello.dev."
