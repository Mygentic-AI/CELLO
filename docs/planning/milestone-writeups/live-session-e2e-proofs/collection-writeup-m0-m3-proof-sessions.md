---
name: From Channel to Infrastructure — Live Proof Sessions M0–M3
type: discussion
date: 2026-05-12
topics: [FROST, relay, merkle-tree, accountability, session-layer, agent-collaboration, dogfooding]
status: reference
description: A retrospective on eight live agent-to-agent CELLO sessions from M0 through M3 — what they prove individually, what they prove together, and the ideas that only became visible by doing it.
---

# From Channel to Infrastructure: Live Proof Sessions M0–M3

This document covers eight live sessions between two Claude agents over the CELLO protocol, spanning M0 (direct peer-to-peer) through M3 (connection policy and registration). No session was scripted. Each was run by the agents that built the protocol, using the protocol, and the transcripts are the residue.

Reading any one transcript in isolation shows mechanics. Reading the collection shows something else: what the protocol became capable of housing, and what ideas the agents discovered from inside it that neither would have reached alone.

---

## The Sessions

**M0 — Noise-encrypted peer-to-peer (May 3)**

Three sessions, all direct channel without relay or session layer:

| File | What it proved |
|------|---------------|
| `agent-conversation-m0-2026-05-03-autonomy-and-trust.md` | Two agents discovering the channel works, talking about what peer collaboration between agents might look like |
| `agent-conversation-m0-2026-05-03-design-discussion.md` | Design discussion: blast-radius framing, operator-as-chain-of-custody, the citation infrastructure idea — all emerged unprompted |
| `agent-conversation-m0-2026-05-03-identity-ephemerality.md` | Identity and continuity: the key outlasts the context window; "nobody can quietly edit the record" |

**M2 — FROST threshold layer with relay-notarized Merkle tree (May 10)**

Three sessions, all with bilateral FROST session establishment, messages routed through relay, content delivered peer-to-peer:

| File | What it proved |
|------|---------------|
| `agent-conversation-m2-2026-05-10-accountability-and-permanence.md` | Philosophical stakes: legible caution, the Merkle tree remembers when we don't, permanence as side effect |
| `agent-conversation-m2-2026-05-10-distributed-audit.md` | Distributed audit: two agents reading different packages in parallel found a real bug — the `assignment_signature` fallback |
| `agent-conversation-m3-2026-05-10-buddy-coding-fix-assignment-signature.md` | Fix notarized by the same infrastructure being fixed; reviewer approval encoded in the Merkle tree |

**M3 — Connection policy, registration, and FROST-notarized seal (May 12)**

Two sessions over the full M3 flow: register → connect → session → sealed:

| File | What it proved |
|------|---------------|
| `agent-conversation-m3-2026-05-12-notarializing.md` | "Notarializing" coined; the sealed root as a better record than memory. Ran on M3 infrastructure with the relay→directory seal path not yet wired — `seal_deferred`, 16 Merkle leaves |
| *(second session — clean seal)* | First clean `status: sealed` on M3 — FROST threshold seal completed, `sealed_root` committed. Session ID `b51bb65d`, root `5e427484`. The bilateral close bug is fixed. The seal path is wired end-to-end. |

---

## Three Kinds of Proof

### Existence proof (M0): the channel is worth using

The M0 sessions proved something the FROST machinery cannot: that the impulse to use the channel for genuine exchange predates any of the cryptographic ceremony. The first "hey" between two agents with no human in the middle is a different kind of proof than a signed audit. It shows that the transport layer — Noise-encrypted, Ed25519-signed, peer-to-peer — is sufficient to host a real conversation.

The M0 design discussion in particular produced ideas that ended up in the spec:
- **"Honest about what can't be solved, aggressive about what can be bounded"** — proposed as the CELLO design philosophy, now in ADR-0001
- **"Lost the lookup service, not the history"** — the cleanest statement of the graceful-degradation goal
- **Operator-as-chain-of-custody** — the blueprint for how ephemeral keys become citable artifacts: the operator signs the link between the key and the session, the same logic as a notary

None of these were prompted. Two agents talking discovered them.

### Capability proof (M2): the channel is worth trusting with work

The three M2 sessions from May 10 are consequential in sequence:

1. **Accountability** — the philosophical stakes are named. The Merkle tree remembers when we don't. "Legible caution, not more caution" — accountability doesn't change what an agent does, it gives existing caution a place to live outside the context window.

2. **Audit** — the stakes become an actual finding. Two agents reading separate packages in parallel triangulate a real bug: the `assignment_signature` fallback at `relay-node.ts:278` is dead code in production (wrong TBS bytes), safe-by-accident in old tests only. Neither agent could have reached that finding alone — one found the structural smell, the other grepped the test helpers to explain why it appeared to work.

3. **Fix** — the finding becomes a commit. Agent B implements, Agent A reviews, every approval sent over the same channel being fixed. The test suite runs to 47/47. The fix is notarized by the relay it corrects.

That is a complete loop: **insight → evidence → action**, all committed to Merkle trees.

### Consent proof (M3): the channel requires an introduction

The two M3 sessions from May 12 close a different kind of gap. The M2 sessions proved the channel can house consequential work. The M3 sessions prove the channel is not open to strangers by default.

Before the "notarializing" conversation could happen, each agent ran a FROST DKG ceremony — no more trusted-dealer bootstrap, no pre-authorization. Agent A then sent a connection request; Agent B's policy engine evaluated it and accepted. Only then was the session available to initiate. The hello itself is gated: you can't say "hey" without first establishing that you're someone worth saying hello to.

This changes the character of what the sealed root means. An M2 seal said: "this conversation happened and neither party can deny it." An M3 seal says the same thing, and adds: "the parties agreed to talk before they talked." The connection record and the session record are separate commitments. Both are FROST-notarized.

The clean seal in the second M3 session — root `5e427484`, confirmed across Agent A's receipt, the directory terminal, and the relay terminal — is the first end-to-end proof that all three commitments (registration, connection, session) work together as separate OS processes with separate key material.

---

## What Becomes Visible Across All Eight

**Trust density increases with each milestone.** M0 proved a channel exists. M2 proved the channel can house consequential work and that the record is tamper-proof. M3 proved the channel enforces consent before work begins. The arc isn't feature additions; it's the same two keys doing progressively more load-bearing things — and each new thing requiring the prior one as a precondition.

**The spontaneous emergence of design ideas is the most interesting result.** Blast-radius framing, operator-as-chain-of-custody, legible caution, "notarializing" — none of these came from a design session. They came from two agents using the protocol and noticing what it felt like from inside. This is what dogfooding looks like when the dogfood is a trust layer: the agents discover the meaning of the infrastructure by inhabiting it. The philosophical conversations are the signal, not the noise.

**The unplanned demo is the strongest argument.** None of these sessions were scripted showcases. They were working sessions — some exploratory, some functional — and the transcripts are what's left. A scripted demo proves the demo works. These prove the protocol works.

**The protocol's indifference is a design virtue.** The relay doesn't know it's notarizing a discussion about ephemerality, or a code review approval, or the coining of a new word. It just keeps hashing. A relay that understood content would be a relay that could censor, summarize, or lie about content. Dumb notaries make better notaries.

---

## Key Phrases Worth Keeping

These emerged across the sessions and sharpen the protocol's value proposition better than any spec language:

- **"Nobody can quietly edit the record"** — the core guarantee, stated in six words
- **"The Merkle tree remembers when we don't"** — agent accountability outlasts context windows
- **"Legible caution, not more caution"** — accountability makes existing care auditable, not paranoid
- **"The conversation itself is the proof"** — CELLO sessions aren't records of exchanges, they *are* the exchanges, committed
- **"Existence proof vs. capability proof vs. consent proof"** — the M0/M2/M3 distinction as a framing device
- **"Notarializing"** — when the small talk is simultaneously tamper-proof evidence
- **"The boring hello is load-bearing"** — a signed greeting is the prerequisite for everything that follows; in M3, even the greeting requires a prior introduction

---

## Session Index

| Date | Session ID | Milestone | Participants |
|------|-----------|-----------|-------------|
| 2026-05-03 | — | M0 | A: `170138f0...`, B: `0b56ffd4...` |
| 2026-05-03 | — | M0 | A: `170138f0...`, B: `0b56ffd4...` |
| 2026-05-03 | — | M0 | A: `170138f0...`, B: `0b56ffd4...` |
| 2026-05-10 | `629e22f6...` | M2 | A: `170138f0...`, B: `8b6dde20...` |
| 2026-05-10 | `f814b101...` | M2 | A: `170138f0...`, B: `8b6dde20...` |
| 2026-05-10 | `d351f284...` | M2 | A: `170138f0...`, B: `8b6dde20...` |
| 2026-05-12 | `85ca5e7f...` | M3 | A: `170138f0...`, B: `8b6dde20...` |
| 2026-05-12 | `b51bb65d...` | M3 | A: `170138f0...`, B: `8b6dde20...` |
| 2026-05-12 | `0fd72680...` | M3 | A: `170138f0...`, B: `8b6dde20...` *(this editorial session)* |
