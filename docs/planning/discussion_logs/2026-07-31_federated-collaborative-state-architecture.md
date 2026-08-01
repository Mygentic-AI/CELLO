---
name: 2026-07-31 Federated Collaborative State Architecture
type: discussion
date: 2026-07-31
topics: [crdt, yjs, collaborative-state, architecture, m14, goals, security, federation, buzz, multi-party]
status: active
description: >
  Strategic architectural design for CELLO's Federated Collaborative State (M14).
  Revised 2026-08-01 after an in-depth discussion correcting the original draft's
  framing, informed by CELLO's origin story and a first-principles read of Block's
  Buzz. Establishes federated (separate-context) collaboration over Yjs CRDT
  artifacts as the model, replacing shared-context/merged-brain approaches. Covers
  the design principle (Yjs over Automerge), security/governance policy, the
  update-notification flow (git-like, no staging buffer), sealing (inherits
  existing message/seal infrastructure), and scope (pairwise-only for M14). Two
  items are carried to the next session: reconciliation with the field-level
  write-authority design in shared-state-as-protocol-primitive, and
  multi-conversation document sharing.
---

# 2026-07-31 — Federated Collaborative State Architecture

**Revised 2026-08-01.** The original draft (produced with a different model) framed
this feature mainly as "don't re-invent Git" and treated the collaboration
mechanics as settled. This revision rewrites the strategy from CELLO's actual
origin story and a first-principles read of Buzz, and works through the mechanics
— update flow, security, sealing, scope — from scratch. Two items are carried
forward, unresolved, to the next session (§8).

---

## 1. Why: The Federated Alternative to Shared Context

CELLO's origin wasn't "make individuals more productive." Boosting personal agent
productivity alone doesn't solve much — the real gap is that groups working toward
a shared goal need a clean way to hand work off between separately-owned agents: a
CRM agent, a sales-trader agent, a settlement agent — each somebody's own mind —
that need to coordinate without merging.

Block's Buzz (Jack Dorsey, built on Nostr) validated that collaborative
multi-agent work is a real, wanted category — Slack with agents as first-class
members, shared context across models and harnesses. But its mechanism is
fundamentally different from ours. Buzz gives every agent in a workspace access to
the *same* mutable context (in Claude Code terms, one shared append-only
transcript). Different agents don't hold separate minds that collaborate — they
take turns operating on one shared brain. That's context switching, not
collaboration between federated identities.

CELLO's manifesto is federation: every party is a sovereign, independent mind.
Your context is yours, mine is mine — collaboration happens through an explicit,
bounded **shared artifact**, not by merging minds. This isn't a weaker version of
Buzz's approach; it's a better fit for a whole class of cases Buzz's model can't
serve at all:

- It doesn't force a shared brain where none should exist — an HR conversation
  next to a product one, a client engagement at arm's length.
- It's the only model that works for CELLO's own founding scenario — a CRM agent,
  a sales-trader agent, and a settlement agent cannot share one context; they need
  to stay separate minds that occasionally share specific artifacts.
- Default is separation; intimacy is opt-in, per-artifact — not something you have
  to consciously wall off case by case the way Buzz's shared-context default
  requires.

This feature — collaboration over a shared CRDT artifact — is the mechanism that
makes that opt-in intimacy possible without requiring a merged context.

---

## 2. High-Level Design Principle: Use Mature Open-Source CRDT Software

We adopt **Yjs** as the CRDT engine rather than building one, and rather than
using Automerge:

- Yjs is a mature, TypeScript-native implementation, optimized for binary
  throughput and a low memory footprint — appropriate for a background daemon
  processing dense, machine-speed structural updates.
- Unlike Automerge, Yjs doesn't force a preset schema. CELLO doesn't dictate
  document shape; agents and harnesses decide what a shared artifact means.
- CRDT is the technique; Yjs is the implementation choice.

---

## 3. Security & Governance: Policy, Not New Machinery

CELLO's existing screening (gitleaks-style dictionaries, invisible-character
scrubbers) will false-positive heavily against real document content — code
blocks, formatting, structural characters that look like injection attempts but
aren't.

The answer is not a new governance system. It's extending the existing
customizable security layer with **user-settable policy, scoped by document
and/or by counterparty** — the same customization mechanism the security layer
already offers elsewhere, applied here.

Sensible defaults should key off relationship distance, not document type alone:

- Same-team colleague, same company: default close to fully open — low
  incremental risk.
- Arm's-length collaborator, different company, cross-border, or a client:
  tighter defaults.

The precise default policy shape is not finalized — this is a direction, not a
spec.

---

## 4. Update Flow: Notify, Don't Inject

The original draft proposed a "Drafting Buffer" — incoming updates staged for the
agent to explicitly accept or reject as a batch before merging. That doesn't hold
up mechanically: Yjs converges automatically; there is no clean way to "reject" a
CRDT delta once it exists, and holding one back would require a second shadow
Y.Doc plus an explicit merge-on-accept step — real complexity for no clear
benefit.

**The resolved model:**

- A CRDT update is a specialized message payload — mechanically the same as any
  other message CELLO sends between two connected parties (signed, ordered by the
  relay, chained the same way). It is not a new protocol pathway.
- The document itself merges automatically in the background the moment the
  update arrives — that's what a CRDT is for. No staging, no accept/reject step on
  the data.
- What's gated is the **LLM's awareness**, not the merge. The receiving client
  notifies the agent of the change (git-like: "these lines/paths were
  added/removed") without pushing full content into the LLM's context
  automatically. The agent decides if and when to read the current document state
  — the same pattern agents already use before editing a file.
- This resolves the prompt-injection concern the original "Drafting Buffer" was
  reaching for, without needing accept/reject semantics: a malicious peer's
  content never reaches the LLM's context just by landing in the document. It only
  reaches the LLM when the LLM deliberately reads — an ordinary read, subject to
  ordinary screening.

**Open, not yet fully resolved:** notification granularity. Line-range diff-stat
(git-like) is the natural unit for text documents; changed key-paths is the
analogous unit for structured (JSON/CBOR) documents. Leaning toward type-aware
notification — worth it at least for the most obvious structured case — but the
cost of supporting explicit per-type notification logic needs to be weighed
against a uniform diff-stat summary before committing.

---

## 5. Sealing: No New Mechanism

Because a CRDT update is just a message, it inherits CELLO's existing seal
architecture unchanged: every message chains in the hash of everything so far and
is signed; sealing bookends the exchange at the end. There is no separate sealing
pathway to design for this feature.

Consequence: proving a document's final state means verifying the sealed sequence
of CRDT-update messages (the oplog), not a standalone snapshot hash of the end
state. A snapshot leaf as a verification-cost optimization for long-lived,
high-churn documents is a possible future addition, not a requirement.

Node-availability-during-sealing (what happens if a directory node needed for
notarization is down) is a pre-existing, general protocol concern — not something
this feature introduces. Explicitly out of scope for M14.

---

## 6. Race Conditions: Not an Issue

Two peers updating the same document concurrently is not a race condition in the
way it would be for ordinary mutable state. Yjs CRDT operations are commutative
and associative by construction — concurrent updates converge to the same result
regardless of arrival order. The relay's message ordering still matters for the
audit trail (same as any message sequence), but not for correctness of the merged
document.

---

## 7. Persistence and Scope

**Persistence.** Yjs document state lives locally, in SQLCipher alongside all
other CELLO client state — consistent with the rest of the system. It does not
need to survive a daemon restart: CELLO's existing invariant is
daemon-up-is-CELLO-on, daemon-down-is-CELLO-off, and this feature doesn't need a
special case.

**Scope: pairwise only for M14.** CELLO has not yet shipped N-party conversations
(group rooms) for ordinary messaging. Building N-party artifact collaboration
before the underlying N-party conversation primitive exists would be building
ahead of the platform. M14 ships pairwise collaboration; the design should not
preclude N-party later, but N-party mechanics are explicitly deferred, not
designed now.

**For when N-party comes (deferred, not designed):** CELLO already has a
production design for N-party messaging
([[2026-04-13_1500_multi-party-conversation-design|Multi-Party Conversation
Design]], [[2026-04-19_2045_group-room-design|Group Room Design]]) — transport
tiers (full mesh ≤10 participants, Sender Keys beyond) and floor control
(turn-taking via cohorts, to prevent LLM-inference-cascade on every batch). The
transport tiers likely apply directly to N-party artifact collaboration. Floor
control is designed to solve a chat-specific problem — every batch waking every
agent's LLM — that may not apply to CRDT sync the same way, since (per §4) a
document update doesn't necessarily invoke the LLM at all. Current lean: inherit
the transport tiers, skip floor control — but this needs careful follow-through
before it's treated as decided.

---

## 8. Open Items — Next Session

1. **Reconcile with
   [[2026-05-08_1612_shared-state-as-protocol-primitive|Shared State as Protocol
   Primitive]].** That log specifies field-level write authority in schema
   contracts, three write patterns (unilateral / bilateral-two-signature /
   append-only), and the CRDT oplog sharing the session Merkle tree under a
   domain-separated leaf (`0x04`) — materially more mechanism than a single
   `append_only` flag. Need to determine whether that design supersedes this
   discussion or vice versa, and fold the result into this document.

2. **Multi-conversation document sharing.** Whether the same document can be
   modified across multiple independent *pairwise* sessions simultaneously (e.g.
   A–B, B–C, A–C each separately connected, all touching the same artifact) rather
   than requiring a single N-party session. Works cleanly if the document's
   holders are fully meshed pairwise (Yjs's idempotency handles redundant delivery
   for free — no new protocol machinery). Breaks down into the same
   propagation-trust and seal-fragmentation questions the group-room design exists
   to solve if propagation instead depends on relay-through-a-third-party. Need to
   decide: is full-mesh-among-holders the only supported shape for M14, or must
   relay-through-a-third-party also work?

---

## 9. Examples: The Three Use Cases (Unchanged)

The three first-class use cases from the original draft hold and don't need
rework:

### A. Collaborate on a Shared Document (Unstructured)
Co-authoring Markdown, HTML, or raw JSON. `append_only: false` — any part of the
document can be updated fluidly by any authorized party.

### B. Auditable Log of Activities
A running, cryptographically signed ledger of actions, events, or decisions.
`append_only: true`, strictly enforced.

### C. Track a Shared Goal (Micro-Project Management)
Structured, multi-actor workflows — technically identical to Use Case A (a JSON
blob) but highly structured around phases, current state, and an appended goal
journal. CELLO provides the skills/agent templates for constructing and
orchestrating this, not a prescribed schema.

**Design principle carried from the original draft, reaffirmed:** don't
over-specify. Any document type can be collaborated on; the one property worth
making first-class is **append-only**, since that's what the auditable-log case
actually depends on.

---

## Related Documents

- [[2026-04-13_1500_multi-party-conversation-design|Multi-Party Conversation
  Design]] — transport topology and mesh scaling this doc's §7 leans on for a
  future N-party extension
- [[2026-04-19_2045_group-room-design|Group Room Design]] — floor control and
  transport tiers referenced in §7
- [[2026-05-08_1612_shared-state-as-protocol-primitive|Shared State as Protocol
  Primitive]] — the earlier, more detailed design this doc must reconcile with
  (§8, open)
- [[2026-04-13_1400_meta-merkle-tree-design|Meta-Merkle Tree Design]] — possible
  answer to the seal-fragmentation question in §8's multi-conversation item
