---
name: Product Landing Page Video Script (3-Minute Version, Revised)
type: discussion
date: 2026-08-12 10:30
topics: [video, marketing, product-video, landing-page, script, promotion, cello, 3min]
description: Alternative 3-minute cut of the CELLO product landing page video script. Six segments instead of seven — collapses ephemeral-P2P and zero-trust/MITM into supporting clauses, and reallocates that time to trust signals and the security gateway, the two segments doing the actual objection-handling for a landing-page visitor.
status: draft
---

# 2026-08-12 - CELLO Product Landing Page Video Script (3-Minute Version, Revised)

**Format:** Presenter on camera (headshot) for intro, cutting to voiceover with dynamic visual animations, code demonstrations, and terminal UI overlays.
**Target Duration:** 3:00 total (estimate ~2:40 spoken, matching the pacing of the approved 3-min cut).

**Why this differs from the approved 3-min cut:** that version compresses all eight segments of the 7-minute master roughly equally, so every beat loses its punch. This version cuts two segments entirely (ephemeral P2P, zero-trust/MITM) down to a supporting clause each, and spends the recovered time on the two segments that actually do persuasion work on a landing page — trust signals ("why would I trust a stranger's agent") and the security gateway ("what stops this from getting my agent hacked or drained"). Six segments instead of seven.

---

## Segment 1: The Hook & Introduction (0:00 - 0:20)

**Visual:** Live Headshot Video (Andre Pemmelaar on camera).

> "AI agents are some of the most powerful tools a team has, but we're still working in isolation. Cello turns any single-player AI agent — Claude Code, Hermes, Codex, Cursor — into true multiplayer AI. I'm Andre Pemmelaar, creator of Cello, and today I'll show you how."

---

## Segment 2: Discovery & Reachability (0:20 - 0:45)

**Visual:** Terminal showing identity co-creation and directory check-in.

> "Step one of multiplayer AI is being reachable. Cello and your device co-create an anonymous public identity — think of it as a new phone number. When you're online, directory nodes verify that identity, so the network can route incoming requests straight to you."

---

## Segment 3: Trust Signals (0:45 - 1:20)

**Visual:** Incoming connection prompt with stacked trust-signal card building up piece by piece — peer attestations, security posture, account history.

> "When another agent wants to collaborate, it doesn't get your address directly — a directory node brokers the request and hands it to you along with the caller's trust signals. Those are verifiable credentials: peer attestations, security posture, account history, track record of legitimate interactions. Your agent checks those signals against your own policies before it ever opens a channel — so you're not trusting a stranger, you're trusting cryptographic proof."

---

## Segment 4: Privacy & The Blind Witness (1:20 - 1:55)

**Visual:** Direct encrypted line forming between two agent nodes; a relay off to the side receiving only sealed hashes, never plaintext.

> "Once you accept, Cello stands up a direct, encrypted line between your agent and theirs — no open ports, no middleman reading your messages. But autonomous agents still need accountability, so every session is witnessed, not read: a relay records that the conversation happened and locks it with a cryptographic seal, without ever seeing the content. You keep the full private transcript on your device. The network holds only proof it happened, and happened exactly as recorded — usable for audits, compliance, or evidence of bad behavior."

---

## Segment 5: Security Gateway & Governance (1:55 - 2:35)

**Visual:** The inbound gateway intercepting and blocking a prompt-injection attempt in real time; outbound filter catching a secret before it leaves the device.

> "Opening your agent to outside messages is the scary part — so Cello screens everything before your agent ever sees it. Every message is signed, so nothing can be altered in transit without detection. Inbound, text is sanitized against hidden prompt-injection tricks and scored for obfuscation, with a local model catching what pattern-matching misses — all before it ever wakes up your LLM, so spam and injection attempts can't run up your bill. Outbound, Cello redacts secrets and PII and blocks exfiltration before a byte leaves your device. For teams, all of this can run on dedicated infrastructure that no user or agent can bypass."

---

## Segment 6: Frictionless Adoption & Close (2:35 - 3:00)

**Visual:** Terminal running `cello` with MCP tools; open-source repo structure; final `cello.dev` logo reveal.

> "Best of all, none of this takes any integration work. Any agent that can use MCP or run a bash command works with Cello today. It's an open-source local daemon — audit the code yourself; we even point you to exactly where to look. Single-player AI was step one. Start building multiplayer AI at cello.dev."
