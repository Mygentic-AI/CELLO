---
name: 2026-07-31 Federated Collaborative State Architecture
type: discussion
date: 2026-07-31
topics: [crdt, yjs, collaborative-state, architecture, m14, goals, security, federation, buzz, multi-party, canonicalization, attestation, epochs]
status: active
description: >
  Strategic architectural design for CELLO's Federated Collaborative State (M14).
  Establishes federated (separate-context) collaboration over Yjs CRDT artifacts,
  replacing shared-context/merged-brain approaches. Covers the Yjs-over-Automerge
  decision on revised grounds, the notify-then-read update flow, publish-on-intent
  batching and offline collaboration, the two assurance tiers (authenticated vs.
  attested) with canonicalization as the boundary, canonical artifact hashing and
  bilateral quiescence agreement, document epochs, the 0x04 operation leaf, and
  multi-party collaboration via hub-and-spoke re-authoring over pairwise sessions
  (mesh delivery lists deferred), the shadow-document validation stage with
  sender-rollback rejection, schema enforcement as an opt-in document flag, and the
  protocol boundary against goal-template and agent-tooling concerns. Second
  review pass 2026-08-03: quarantine-and-supersede rejection with a purge level,
  the document log as a cross-session verifiable container, the 0x05 rejection
  leaf, the quiescence agreement flow with divergence records, the two-document
  hub-and-spoke default with pass-through as opt-in, text-only canonicalization
  for non-JSON types, and document lifecycle verbs. Third pass 2026-08-04 (§16):
  the V1/V2 cut (V1 = Tier 1 only; V2 = M14B), the write path (file
  materialization + diff-on-publish), the document handshake (attestation-consent
  mirror), daemon-autonomous delivery sessions with presence-driven retry and the
  withdraw verb, passive notification, sender-side advisory screening, and the
  full decision register feeding the M14/M14B Definitions of Done.
---

# 2026-07-31 — Federated Collaborative State Architecture

**Revision history.** Original draft 2026-07-31 (different model). Rewritten
2026-08-01 to correct the strategy framing and work the mechanics from first
principles. Substantially extended 2026-08-03 after an external technical review
of the design against Yjs's actual limitations, which surfaced the assurance-tier
model, canonicalization, epochs, and the multi-party topology decision
(hub-and-spoke for M14, mesh deferred). The same session settled the validation
stage and rejection protocol (§3.2) and reshaped field-level write authority into
the opt-in `schema_enforcement` flag (§3.3), which closes the reconciliation with
[[2026-05-08_1612_shared-state-as-protocol-primitive|Shared State as Protocol
Primitive]] in §12. A second review pass on 2026-08-03 re-derived the rejection
protocol against Yjs's sync mechanics (quarantine and supersede, with a purge
level — §3.2), gave the document its own verifiable chain across sessions
(§9.1), specified the quiescence agreement flow and the divergence record
(§7.1), flipped hub-and-spoke's default to the two-document form with
pass-through as the declared opt-in (§11.1), scoped the determinism requirement
to document-carried validation, and added the document lifecycle verbs (§3.5).
A third pass on 2026-08-04 worked the document backward from a Definition of
Done: it settled the V1/V2 cut and every previously open decision, and designed
the four layers the first two passes never touched — the write path, the
document handshake, delivery, and notification (§16). §16 is the decision
register the M14 and M14B DoDs cite.

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

## 2. Design Principle: Use Mature Open-Source CRDT Software

We adopt **Yjs** as the CRDT engine rather than building one.

CRDT is the technique; Yjs is the implementation. It is mature, TypeScript-native,
optimized for binary throughput and low memory footprint — appropriate for a
background daemon.

**On Automerge.** The earlier design log
([[2026-05-08_1612_shared-state-as-protocol-primitive|Shared State as Protocol
Primitive]]) reached the opposite conclusion and recommended Automerge. That
recommendation does not survive today's decisions. Its four grounds, revisited:

1. *JSON-native, no translation layer.* Real but bounded — a Y.Map ↔ JSON
   projection is well-trodden work, not a blocker.
2. *`getConflicts()` conflict inspection.* The one genuine capability gap; Yjs
   resolves internally and does not surface contested writes. But it serves a
   scenario that same log calls a design smell — under field-level authority each
   field has exactly one authorized writer, so contested writes shouldn't occur.
3. *Full history by default.* Now irrelevant. CELLO's sealed oplog is strictly
   better history than either library provides: signed, chained, non-repudiable.
4. *Performance.* Favoured Yjs to begin with.

Two reasons were added by this session that did not exist in May:
`encodeStateVector` / `encodeStateAsUpdate` map directly onto the batching and
state-vector attestation model in §5 and §7, and Yjs's binary-first model fits the
canonicalization work in §8.

**Correction to an earlier justification.** Yjs was previously justified here on
the grounds that Automerge "has issues around preset schemas." That is not
accurate — neither library enforces a schema. The difference is the data model
only (JSON-like objects vs. Y-types with a `toJSON()` projection). The decision
stands on the grounds above, not on that one.

---

## 3. Security, Governance and Validation

### 3.1 Screening policy

CELLO's existing screening (gitleaks-style dictionaries, invisible-character
scrubbers) will false-positive heavily against real document content — code
blocks, formatting, structural characters that look like injection attempts but
aren't.

The answer is not a new governance system. It's extending the existing
customizable security layer with **user-settable policy, scoped by document
and/or by counterparty** — the same customization mechanism the security layer
already offers elsewhere.

Sensible defaults should key off relationship distance, not document type alone:

- Same-team colleague, same company: default close to fully open.
- Arm's-length collaborator, different company, cross-border, or a client:
  tighter defaults.

**Pre-implementation investigation owed, one level above this spec.** Everything
above assumes the existing screening layer will behave reasonably once
extended with document/counterparty-scoped policy — that assumption hasn't been
tested. Before the detailed design, the existing layer needs a real audit: what
it currently checks, what customization already exists versus what §3.1
presumes needs building, and where this use case is likely to have been
misjudged in both directions — some things probably harder than assumed here,
others probably easier. A cheap way to find out fast: generate real updates for
a handful of high-priority formats using the actual libraries (Yjs producing
genuine text/JSON diffs, not synthetic examples) and run them through the
current screening as it exists today, unmodified, to see what actually trips
it. This is the layer likeliest to make or break the feature in practice — too
aggressive and false positives make it unusable; too permissive and the one
thing that should have been caught slips through. Get it right and an operator
barely notices it; get it wrong in either direction and they will.

### 3.2 The validation stage and the rejection protocol — V1

Screening implies a staging step: apply an incoming update to a **shadow
document**, run the controls, then admit it to the accepted document. The trap is
that rejection appears to create permanent divergence — the sender holds the
change, the receiver doesn't, and a CRDT offers no un-apply.

**The receive pipeline: arrive → shadow-apply → validate the projected diff →
admit or quarantine.** Validation judges what the document *comes to say* — the
projected diff between the accepted state and the shadow state — not which
operations transit. A quarantined update is held, never admitted, and never
discarded: the causal repair below re-integrates its operations.

**Rejection is resolved by supersession.** The naive protocol — receiver
discards, sender undoes locally, both "return to the pre-update state" — leaves
a permanent causal gap: the rejected operations remain in the sender's doc (Yjs
undo adds *inverses*; it does not erase), so every subsequent update the sender
computes against the receiver's state vector re-transmits them, and the
receiver can never integrate the legitimate operations stacked causally on top
of ops it refuses to hold. Yjs will not apply operations whose predecessors are
missing. The protocol is therefore:

1. The receiver validates against the shadow document and **rejects with a
   reason** — a protocol message and its own leaf (§9), never a silent drop.
   The update goes to quarantine.
2. The sender **rolls back locally** — Yjs undo, which emits inverse operations
   into the sender's own log rather than erasing history. Correct, and it
   leaves an auditable "wrote X, was rejected, undid X" trail.
3. The sender publishes a **superseding update**: the ordinary Yjs update
   computed against the receiver's state vector, which necessarily carries the
   rejected operations *plus their inverses* plus any new work.
4. The receiver validates the superseding update's projected diff — now clean,
   because the rejected content nets to zero — admits it, and clears the
   quarantine entry. Causality is intact, both parties genuinely converge, and
   the rejected content survives in the receiver's history only as inert
   tombstones.

**The purge level.** Supersession leaves rejected bytes as tombstones in both
CRDTs — unacceptable when the content itself is the harm (a leaked credential,
PII). For that class the rejection carries severity `purge`, resolved by the
epoch machinery (§10): both parties mint an epoch from the last agreed
canonical state, the sender re-creates its document from that snapshot with a
fresh clientID and re-applies its legitimate work, and no copy of the purged
content survives in either party's live document. Purge is the fifth
load-bearing use of the epoch primitive.

**Purge's blast radius is one envelope, never the log.** Purged content was, by
construction, caught and rejected before admission — it never touched the live
document and could not itself be the cause of downstream harm, so there is no
forensic reason to preserve the flagged payload. But an epoch boundary that
*deletes every pre-epoch envelope* is a much bigger operation than purge needs,
and it hands an attacker a lever: deliberately sacrifice something screening
will obviously catch, purely to trigger a purge whose side effect erases
genuine evidence of an earlier, unrelated, already-admitted attack. Purge must
not have that reach. The live-document reconstruction from snapshot is still
required — Yjs tombstones retain deleted bytes internally, so supersession
alone cannot remove them from the working copy — but the immutable envelope
log is redacted, not truncated: **strip the flagged envelope's payload,
retain its hash and signature so `doc_prev_hash` chaining stays intact, and
leave every other envelope untouched.** The evidentiary trail for anything
unrelated survives exactly because purge cannot reach beyond the one entry it
was scoped to.

**This is not optional for V1.** Without it the screening gate in §3.1 is broken by
construction: a screened-out update that is silently dropped diverges the two
copies permanently and invisibly. The shadow document, the validation hook, the
reject-with-reason message and the supersession repair are therefore V1
machinery, driven by screening rather than by schemas — and the schema layer in
§3.3 later plugs into a hook that already exists.

Four mechanics:

- **A non-compliant sender is a trust-signal event, not a protocol failure.** If
  the sender never supersedes, the receiver stalls holding a quarantined update
  and later updates whose dependencies never arrive. Surface that rather than
  letting it stall silently; the signed record shows the sender was told and
  didn't act.
- **The shadow document must be rebuildable from the accepted state**, not a
  long-lived parallel copy. Cost is roughly 2× memory per artifact.
- **Determinism is required only of document-carried validation.** The
  `append_only` and `schema_enforcement` rules ride in the document, so both
  sides hold identical rules and the same input yields the same verdict —
  symmetric by construction. **Screening is asymmetric by design**: it is
  receiver-local and receiver-private (§3.1), so the sender cannot predict the
  verdict and does not need to, because rejection is sender-resolved.
- **Rejections are operator-visible.** Rejections sent and received land in the
  policy log with their reasons, so the operator sees "counterparty policy
  blocked this edit: <reason>" rather than experiencing silently vanished work.

### 3.3 Schema enforcement as a document flag — deferred

Field-level write authority — the May log's schema-as-contract — becomes a
**per-document feature flag**, `schema_enforcement`, sitting alongside
`append_only` rather than being a mandatory protocol layer.

**When enabled**, the first update on the document *is* the schema: a JSON blob
declaring fields, types, who may write what, and the logical rules for updating.
The parties may negotiate it back and forth as ordinary updates until they agree.
From then on every incoming update is validated against it at the §3.2 hook, and a
rejection may optionally carry a **suggested modification** — "your type was wrong,
here is the corrected form" — which the sender's daemon can roll back to and
re-publish as its own update.

Why this shape rather than the May log's:

- **It is opt-in, so the unopinionated principle survives.** Documents that don't
  want enforcement never pay for it.
- **It reuses the §3.2 hook.** `append_only` is already a validated invariant
  checked there; the flags simply select which rules are active. Not a new
  architectural seam.
- **It carries the schema in the document**, so both parties hold the identical
  schema by construction — which is what makes deterministic two-sided validation
  tractable at all.
- **Schema changes mint an epoch** (§10), bilateral and signed, so "which version
  validated this update" never becomes its own causality problem.

**Why it is not in V1:**

Identity and authorization are different threat models, and CELLO already covers
the one that matters. "Am I sure this is the sales trader" is verified identity —
solved. The ACL answers a different question: the *real* settlement agent wrote a
field it shouldn't have. That is largely a guard rail against agent error, and
guard rails belong in the harness — the agent's own template and instructions —
rather than in the protocol. Pairwise scope shrinks it further (field authority is
a multi-writer control), and under hub-and-spoke (§11.1) the re-authoring party
owns everything it signs anyway.

CELLO's model is **accountability, not prevention**. If a party writes out of lane,
the signed oplog shows exactly who did it and when — detectable and attributable,
permanently, with no divergence cost. For Use Case C the schema therefore ships as
**shared convention** in V1: both agents load the same goal-template skill and
agree on the shape, with no protocol enforcement.

**Declare the flag in V1 and support only `false`.** Documents created now
explicitly declare themselves unenforced rather than having no opinion, so enabling
`true` later is a new capability rather than a retrofit. Epoch adoption (§10)
remains available for flipping an existing document, but is not needed to avoid
stranding anything.

### 3.4 Properties established at the document handshake

| Property | Meaning | V1 |
|---|---|---|
| `document_type` | Markdown, plain text, JSON, XML, common text-based source | Yes |
| `append_only` | Validated invariant, not a flag the CRDT honours (§15B) | Yes |
| `assurance_tier` | Authenticated (Tier 1) or attested (Tier 2) (§6) | Yes |
| `topology` | Hub-and-spoke or mesh (§11) | Hub-and-spoke only |
| `schema_enforcement` | Schema-as-first-update validation (§3.3) | Declared; `false` only |

### 3.5 Document lifecycle

Three verbs, all V1:

- **List** — the documents an agent holds: peer, type, tier, epoch, pending
  status.
- **Close** — bilateral: a final quiescence agreement (§7.1), then the document
  log (§9.1) is sealed. The document is complete and verifiable end-to-end.
- **Kill** — unilateral: stop accepting and publishing updates on the document,
  notify the peer, retain the local copy and log. Stated plainly: you cannot
  unpublish what was already delivered — the peer keeps what it holds. Kill is
  the kill-switch requirement applied to collaborative artifacts, and it ships
  in V1.

---

## 4. Update Flow: Notify, Don't Inject

The original draft proposed a "Drafting Buffer" — incoming updates staged for the
agent to explicitly accept or reject as a batch. That doesn't hold up against
Yjs: updates converge automatically, and there is no clean way to reject one after
application.

**The resolved model:**

- A CRDT update is a payload carried inside an ordinary CELLO message — signed,
  chained, relayed and sealed exactly as any message is. It is not a new protocol
  pathway. (It does get its own leaf type; see §9.)
- The document merges on admission: arrival, shadow validation (§3.2), then
  merge. Admission is mechanical — there is no agent-level accept/reject on the
  data itself.
- What is gated is the **LLM's awareness**, not the merge. The client notifies the
  agent that the document has a pending update — nothing more.
- This closes the prompt-injection concern the "Drafting Buffer" was reaching for,
  without accept/reject semantics: peer-controlled content never enters the LLM's
  context by arriving. It enters only when the LLM deliberately fetches it.

### 4.1 Three calls, one notification

The notification is always the same thing and carries no document content:
**this document has a pending update.** *Pending* refers to the agent's attention,
not to application state — the update has already merged and been validated (§3.2);
the agent simply hasn't looked at it.

Everything beyond that is a separate, agent-initiated call:

| Call | Returns |
|---|---|
| *(notification)* | This document has a pending update |
| Diff stats | How much changed, structurally — no content |
| Diff | The git-like diff itself: line ranges for text, key paths for structured |

Both calls are ordinary reads subject to ordinary screening. If the notification
itself quoted changed lines it would become the injection channel this design
exists to close, which is why the split is not cosmetic.

**Diff generation is real work.** Yjs updates are binary structural operations, not
text patches, so producing a diff requires materializing before/after projections
and diffing them. It shares machinery with §8 — the canonical projection needed for
hashing is the same projection needed for diffing — so the marginal cost of one
given the other is small. Which document types the diff call supports (Markdown,
plain text, JSON, XML, common text-based source) is tool-surface scoping for
implementation, not a protocol decision.

**Diff stats carries an overlap flag.** Yjs converges concurrent edits
*syntactically*; two agents rewriting the same paragraph converge to
interleaved text that reads as neither intended. The flag answers one question
— did this update touch regions where the local side holds unpublished edits? —
and is the signal to review the merged projection before building on top of it.
The review behavior itself is template/skill work (§13), named here as an owed
deliverable alongside the goal-template skill so it does not silently fall off.

---

## 5. Publishing: Cadence, Not Mode

**There is no batched-vs-live-sync mode, and framing it as one is a mistake.** Yjs
tracks local changes in the `Y.Doc` continuously. When an agent publishes, the
client computes the update relative to the peer's last-known state vector, and that
single update contains everything accumulated since — whether that is one edit or
fifty. Same call, same protocol behaviour, different cadence.

The mode framing is imported from Yjs's stock providers (y-websocket), which
auto-sync on every transaction. CELLO has no such provider: nothing syncs until the
agent calls publish. **Cadence is therefore the caller's business, not a protocol
setting** — there is no flag, and nothing to configure.

**Batching is guidance to the agent, and the argument is stronger than bandwidth.**
Every published update is a signed, chained, sealed message. Publishing after every
keystroke would produce a Merkle chain of thousands of leaves recording comma
insertions — which makes the audit record *worse*, not just bigger. Publishing on
intent keeps each leaf an **intentional act**: "I made these changes and I'm sharing
them" is a semantic event worth signing; a whitespace fix isn't. Screening also
evaluates one coherent change rather than hundreds of fragments. What is borrowed
from git is the *gesture*, not the machinery.

The publish act is a sender-side quiescence point, which makes it the natural place
to hang the artifact hash (§7) and the counterparty notification (§4).

### 5.1 Offline and asynchronous collaboration

The motivating case is two parties in near-opposite timezones (e.g. Dubai and US
West Coast) whose working days barely overlap. A does updates A–G while B is
offline; B comes online and does H–L.

**Convergence is free.** Yjs exchanges state vectors on reconnect and converges. B
working on stale state is fine — order-independence is the point. Nothing to
design.

**What the scenario actually stresses is the session as a container.** CELLO's
model is two connected parties exchanging and then sealing; async collaboration has
no reliable window where both are live. The relay will not buffer — it is a dumb
ordering witness with no store, and offline catch-up is an unresolved item in the
vault (AC-8).

**Deferred publishing resolves it without new infrastructure.** The agent says
"publish"; the *daemon* holds the batch as queued outbound and delivers it when the
peer's daemon appears. The daemon doesn't sleep when the human does. This requires
a queued-outbound mechanism — small, but real machinery to be named in
implementation. The residual case (the machine is off entirely) is the same "you
can't send to a peer that isn't there" problem CELLO already has everywhere.

---

## 6. Two Assurance Tiers

Not every document needs the same guarantee, and the cost difference is large.

### Tier 1 — Authenticated collaboration

Updates ride as ordinary CELLO messages, so this tier is nearly free — it is what
CELLO already does, plus the Yjs plumbing:

- Every update is signed by the sending agent's key, non-repudiable, chained and
  sealed.
- It carries that agent's trust signals: you trust an update exactly as much as you
  trust any message from that identity.
- The exchange is provable — a verifier holding the sealed log can prove which
  updates were exchanged, by whom, in what order, and can replay them to derive
  what the document should be.

**What Tier 1 lacks is narrower than "no attestation":** it is the *binding between
the history and the artifact on disk*. You cannot cheaply prove your copy is the
faithful materialization, and you cannot rule out an out-of-band edit. The
defensible claim is **"we prove the collaboration, not the copy."**

### Tier 2 — Attested collaboration

Adds canonicalization (§8), per-batch artifact hash attestations and bilateral
agreement at quiescence (§7), and epochs (§10). Proves that the artifact you hold
is the product of the collaboration.

### The boundary is canonicalization, and it is binary

An intermediate tier — per-batch pre/post artifact hashes without bilateral
agreement — was considered and rejected. The expensive component of Tier 2 is
**canonicalization**: deterministic per-type serialization. Everything else is
cheap once it exists — computing a hash is trivial, exchanging it at quiescence is
one message, quiescence is definitional at seal, and epochs are needed for
compaction regardless.

So a "cheap attestation" still pays the full canonicalization cost while delivering
less. The real decision is **build canonicalization or not**: if not, Tier 1; if
so, take Tier 2 whole, because the delta is a countersigned message. The per-batch
pre/post hash then becomes a *component* of Tier 2, not a lesser alternative.

**The tier must be established at the document handshake and be mutually visible.**
If one party believes the artifact is attested while the other isn't computing
hashes, they're relying on a guarantee that doesn't exist. Same logic as the room
manifest being a binding contract rather than a preference. Tier belongs in the
handshake alongside document type and append-only.

**Upgrade happens at an epoch boundary** (§10) — both parties converge, both sign
the canonical hash, and that becomes the attested baseline. Attested from that
point forward, never retroactively.

### Consequence for Use Case B

The auditable-log use case (§11B) claims "the copy you hold can be proven to be the
authentic, undeniable log of what occurred." That is precisely the artifact-binding
claim Tier 1 cannot make. **Use Case B is the flagship Tier 2 case** — the claim
stands, but only at Tier 2. At Tier 1 it must be restated as "the exchange is
provable; the log you hold is derived from it."

---

## 7. Attestation vs. Agreement: What the Hashes Mean

A hash of the resulting artifact is **not** redundant with the Merkle chain. The
chain proves what bytes were *sent*; it says nothing about what those bytes
*materialize to*. (A hash of the update *payload*, by contrast, is fully redundant
with the signed chain — do not add one.)

### Why a pre-hash precondition cannot work

The intuitive design — sender declares "the document was H0 before my batch and
will be H1 after; receiver verifies its state is H0 before applying" — fails on the
ordinary async case:

Both parties are at H0. A works offline producing batch X; B works offline
producing batch Y.

- A publishes: pre=H0, post=H1.
- B publishes: pre=H0, post=H2.

A receives B's batch while at H1; the pre-hash check fails. B receives A's batch
while at H2; same. **Nothing is wrong** — both apply and converge to H3 = H0+X+Y,
which neither predicted and neither post-hash matches.

A pre-hash *gate* would therefore reject legitimate concurrent work — reimposing
linear history, which is exactly what a CRDT exists to avoid. The post-hash is a
prediction that is correct only when there is no concurrent work, i.e. only in the
case where a CRDT wasn't needed.

### The working model — attestation per batch, agreement at quiescence

**Per published batch (attestation, never a gate):**

- The sender's **Yjs state vector** (`{clientID → clock}`) — the native,
  partial-order-aware statement of exactly what the sender had seen. This is the
  correct causal mechanism, not a hash.
- The sender's **post-apply canonical hash** — "having applied my batch to what I
  had seen, I now hold H2."

Both are claims about the sender's own observation. A mismatch on the receiving
side is not an error; it is *information* — there was concurrent work. This is
structurally what `last_seen_seq` already does for messages: causal attestation,
not a lock.

These attestations are **unilateral with deferred verification** — a wrong
post-hash, whether from a bug or a lie, goes undetected until quiescence. They are
attestations, not proofs. They are still worth carrying: with publish-on-intent
batching, much async collaboration is genuinely turn-taking, and in that sequential
case the pre-hashes chain and yield a verifiable incremental history of document
states.

**At quiescence (agreement):** once both sides have applied everything and
converged, both independently compute the canonical hash and **both sign it**. That
bilateral signature is what proves the artifact is the product of the
collaboration. It is also the only point where a mismatch is meaningful: the same
update set producing different hashes means divergent canonicalization, an
out-of-band edit, or a bug — a genuine and valuable alarm, precisely because the
states *should* be identical there.

Sealing is quiescence by definition, so the seal is the natural agreement point;
long-running collaborations can add the same agreement at intermediate quiescence
checkpoints.

### 7.1 The agreement flow and the divergence record

1. **Propose** — either party sends `(state_vector, canonical_hash, signature)`.
2. **Confirm** — the responder checks the state vectors match; unequal vectors
   mean this is not quiescence — sync, then retry. On matching vectors it
   computes its own canonical hash. Match → countersign; both store the
   bilateral attestation.
3. **Diverge** — different hashes at matching state vectors: both parties sign
   a **divergence record** carrying both hashes and both state vectors. This is
   first-class protocol output, not an error path — it is precisely the
   evidence a dispute needs.

**Seal policy:** a Tier 2 session seals with either a bilateral attestation or
a divergence record. The seal proves the exchange either way; the
artifact-binding claim is present or recorded-absent, never silently missing.

**Recovery is where the per-batch attestations earn their keep: they bisect.**
Walk back to the last published batch whose post-apply hash both parties derive
identically; the fork lies after it; epoch-reset (§10) from the last agreed
state. Without the per-batch hashes, localizing a divergence is a replay from
genesis.

---

## 8. Canonicalization

"Canonical artifact hash" bundles two requirements, and the second does the work.

**Artifact = the materialized document** — the state after all in-scope updates are
applied. What the document *reads as*, not the CRDT that produced it.

**Canonical = a serialization both parties are guaranteed to produce byte-for-byte
identically.** Two peers can be fully converged and still hold different bytes: the
Yjs encoding depends on insertion history, tombstones, GC state, clientIDs, and
local application order. So the Yjs binary cannot be hashed, and for structured
documents a naive `JSON.stringify` cannot either — key iteration order can differ.

Per type:

- **Text / Markdown** — the string itself, UTF-8, fixed newline convention. Hash
  the bytes. Nearly free.
- **JSON** — sorted keys, defined number formatting, no insignificant whitespace,
  defined escaping. Solved problem with a spec: **RFC 8785 (JSON Canonicalization
  Scheme)**.
- **Everything else — XML, HTML, source code** — is never parsed: any non-JSON
  type is a Y.Text of source bytes and canonicalizes under the text rule above.
  Structural canonicalization exists for exactly one type, JSON, because Use
  Case C needs a Y.Map. Two canonicalization rules total; XML C14N is
  deliberately never entered.

**The governing rule — agreed and non-negotiable:**

> Canonicalization must depend only on the visible converged state, never on the
> path that produced it.

Anything history-dependent is excluded, or two peers holding an identical document
compute different hashes and the mechanism becomes a false-alarm generator.

---

## 9. The Operation Leaf (`0x04`)

CRDT operations get their own domain-separated leaf type, `0x04`, distinct from
`0x00` message leaves, sharing one Merkle tree and one sealed root — as proposed in
the May design log.

Reasons, beyond low cost:

- A verifier replaying a sealed tree must distinguish document operations (apply to
  the doc) from conversation (render) without introspecting payloads — otherwise
  the payload format becomes load-bearing for verification.
- Domain separation is standard hash hygiene, preventing cross-type substitution.
  RFC 6962 already does this for leaf vs. internal nodes (`0x00`/`0x01`).
- It enables selective disclosure in a dispute: reveal document operations without
  revealing conversation content, or vice versa.

**But field-level metadata stays out of the relay-visible structure.** The May
design put `operation_type` — literal field paths like `"journal.append"`,
`"status.stage.advance"` — in the relay-constructed outer leaf, which would let the
relay learn which field of a document changed. `operation_type` and `document_id`
belong inside the encrypted payload where the client demuxes them; for pairwise
collaboration the session is already the routing unit, so the relay needs neither.
Residual leak: "this was a document operation rather than a chat message," which is
small and arguably belongs in the audit record.

**The rejection message (§3.2) is its own leaf, `0x05`**, referencing the
rejected update's envelope hash — the same domain-separation grounds as above.
This makes the record self-describing for replay: **an update leaf is effective
iff no rejection leaf references it; replay applies effective leaves in
document-log order.** The superseding update is an ordinary effective leaf, so
a verifier derives exactly what both parties hold.

### 9.1 The document log — continuity across sessions

Sessions seal; collaboration doesn't. §5.1's premise is that a document
outlives any session window, so the document — not the session — must be the
verifiable container:

- Every `0x04` envelope carries a **per-document chain link**, `doc_prev_hash`
  — the hash of the sender's previous update envelope for this document (§14).
- The **document log** is the set of `0x04`/`0x05` envelopes for a
  `document_id`, extracted from however many sealed sessions they transited,
  ordered and integrity-checked by the per-document chain.
- **Replay and verification are defined over the document log**, not over any
  one session tree. Session seals prove transit, counterparty and time; the
  document chain proves completeness and order of the document's own history.
- **Epochs checkpoint the document log** — each epoch attestation names the
  canonical hash and the chain position it covers. §10's segmentation has a
  container to segment.

---

## 10. Epochs

Compaction mints a **new epoch**. Keeping the old log independently verifiable
would mean keeping the old log, which defeats compaction.

**Epoch transitions must be bilateral and signed, not a local optimization.** If
one party compacts and the other doesn't, they disagree about the verification
baseline. Done properly, the boundary carries the canonical artifact hash (§7),
both parties attest it, and it chains to the previous epoch — the audit chain is
segmented, not lost, and verification of epoch N+1 starts from an attested state
instead of from genesis.

The epoch primitive turns out to be load-bearing in five places, which is why it
warrants proper design rather than treatment as a compaction detail:

1. **Compaction** — bounding tombstone growth (§10.1).
2. **Tier upgrade** — Tier 1 → Tier 2 baseline (§6).
3. **Epoch zero** — the agreed starting state. Both parties agree the document
   begins from canonical template T at hash H0, established in the handshake.
4. **Participant-set changes** — the delivery list is epoch state (§11).
5. **Purge rejection** — removing secret-class content from both live documents
   (§3.2).

### 10.1 Resource limits and growth

Yjs retains structure required for CRDT correctness; a long-lived, heavily edited
document can accumulate tombstones and exceed its visible content. Use Case B
(auditable log) is by definition long-lived and append-only, so this is not
hypothetical.

Configurable limits are required — and they are also the hostile-input surface, so
they are security controls, not just capacity planning:

- Maximum document size
- Maximum update size
- Maximum nesting depth
- Maximum update rate

Plus a compaction policy, which per the above mints an epoch.

**Limits are triggers, not licenses.** Hitting a limit *proposes* an epoch,
queued through the same durable outbound as any update (§5.1, §14); while the
proposal is unacknowledged, limits are advisory and the full log is retained.
The backstop at the hard cap is **refusing new local publishes** on the
document — backpressure, surfaced loudly to the agent — never unilateral
compaction, which would break the bilateral verification baseline. A peer
absent past a threshold is a lifecycle event (the document goes dormant,
surfaced as status), not a license to compact.

---

## 11. Multi-Party: Hub-and-Spoke (M14) and Mesh (Deferred)

M14 ships **pairwise sessions**. Multi-party collaboration is reachable two ways,
and they are not variants of one mechanism — they are different topologies with
different meanings and different costs.

### 11.1 Hub-and-spoke — the M14 answer

**The model.** A holds `doc_AB` with B and a genuinely separate `doc_AC` with C
— two documents, two logs, two `Y.Doc`s. When C contributes something that
should reach B, A **ports the content across as its own edits** to `doc_AB` and
publishes a batch signed by A. B receives an A-authored update on a document
that C's operations have never touched. A decides what crosses — and in the
two-document form that phrase is literally true.

**This is re-authoring, not relaying, and the distinction is the whole design.**

- *Relaying* — A forwards C's update with C's signature intact. B learns C exists,
  cannot evaluate C's trust signals, and cannot verify A forwarded faithfully.
  Worst of both worlds.
- *Re-authoring* — A takes responsibility. From B's side it is an A-sanctioned
  update, full stop; the original author is not part of B's trust decision.

**Why this is the right default, not a compromise:**

- **The accountability chain mirrors contractual liability.** B holds an A-signed,
  non-repudiable update; if it is wrong, B's recourse is against A. A holds the
  sealed A↔C session; if C supplied bad content, A's recourse is against C. Each
  link is independently provable and each party is accountable to the counterparty
  it actually chose. You do not audit your supplier's supplier — you hold your
  counterparty. Full mesh does not add rigour here; it flattens a relationship
  structure that exists for good reasons.
- **It serves real commercial structures.** A knows B and C; B and C do not know
  each other, and frequently A does not *want* them to. The canonical case: C
  supplies work to A, and A sells the finished product to B. Forcing a B–C
  connection is not merely inconvenient there — it is a disintermediation risk that
  makes the feature unusable for the party who most needs it.
- **Its cost falls on the right party.** A does real merge work — porting
  content between two documents is A's labor, softened by a daemon-provided
  cross-document diff ("changed in `doc_AC`, not yet ported to `doc_AB`" — the
  same projection machinery as §4.1 and §8). That labor is the price of the
  intermediary position, and A is the party being paid to hold it.
  Protocol-side it costs nothing: two pairwise collaborations, no delivery
  lists, no participant-set epochs, no N-way quiescence detection, no forced
  connections. Multi-party in effect, pairwise in mechanism.
- **It is the more federated answer.** A single artifact with one shared state that
  every holder sees is a quieter version of the shared-context model §1 argues
  against. Hub-and-spoke is sovereign bilateral relationships, each party sharing
  exactly what it chooses with each counterparty. The strategy section and the
  topology agree.

**Two consequences to state plainly rather than discover later:**

*There is no global attested document state.* Tier 2 agreement is **per link** — A
and B agree on `H_AB`, A and C agree on `H_AC`, and these legitimately differ. "The
document" stops meaning one globally-agreed artifact. That is not a gap;
controlling what B sees is the entire point of the intermediary position.

*A can present different states to B and C, or misrepresent C's contribution.* This
is what an intermediary **is**, not a flaw to mitigate. B's protection is that A
signed what it sent.

**Pass-through mode — the single-document form — is the opt-in, not the
default.** The alternative is A backing both links with one `Y.Doc`. Its true
properties, stated plainly: propagation is transitive and all-or-nothing in
both directions — B's operations reach C and C's reach B automatically, because
every published update is computed against the peer's state vector, and
selectively withholding a third party's operations creates exactly the causal
gap §3.2 exists to repair. Third-party clientIDs are visible (random numbers
with no identity binding — the peer learns *a third client contributed*, not
who). Pass-through suits a coordinator who wants transparency among parties who
already know about each other; it is not an intermediary position, and "A
decides what crosses" is false inside it. It is a declared mode at the document
handshake; the two-document form is the default, and in it nothing leaks.

### 11.2 Mesh via delivery lists — deferred

The peer case is real: three colleagues co-authoring genuinely want one artifact,
one attested state, everyone seeing everyone. That model is a per-artifact
**delivery list** of holders, with each update published over the sender's pairwise
sessions to every holder — structurally an email with multiple recipients,
including the same social semantics. Yjs converges regardless of delivery order or
duplication, and no N-way session establishment is needed, which sidesteps the
FROST-scaling question the May log left open.

It requires real machinery that hub-and-spoke does not:

1. **The participant list becomes document state, not per-sender config.** If A
   believes the holders are {A,B,C} and B believes {A,B}, B never delivers to C and
   C diverges silently. It would belong in the epoch attestation (§10).
2. **Retry becomes mandatory** — best-effort delivery over links that may be down,
   using the queued-outbound mechanism from §5.1.
3. **Tier 2 agreement becomes N-way** — every holder signs the same canonical hash
   at quiescence, and detecting "everyone has converged" is materially harder than
   in the two-party case.
4. **It requires full mesh among holders.** If B edits, B must deliver to C, so B
   needs a B–C session. Adding C to a document A shares with B *forces a connection
   between B and C*. Where that is wanted it is fine; where it is not, §11.1 is the
   answer.

**Deferred, not rejected.** The artifact declares its topology at handshake so no
participant is confused about which guarantees apply.

### 11.3 Why floor control is not needed — resolved

The May log settles the question this design left open. A chat message is an
*utterance* that demands a response, which is why group chat needs batching and
floor control to prevent an inference cascade. A CRDT operation is *writing to a
shared spreadsheet cell* — it propagates silently and demands nothing. Agents pull
state when ready; the "knock on the door" is a separate ordinary chat message.

CRDT operations therefore do not trigger inference by default and carry no cascade
risk. **Transport tiers apply to multi-party artifacts; floor control does not.**

---

## 12. Reconciliation with `shared-state-as-protocol-primitive`

The May log designs the same feature from a financial-services workflow (retail
equity purchase, 8 roles, 8 phases). Status of each divergence:

| Topic | May log | Resolution |
|---|---|---|
| CRDT library | Automerge | **Yjs** — §2, on revised grounds |
| Notification | The notification *is* the diff | **Superseded** — content-free notification + explicit `get_diff` (§4), on injection grounds |
| Leaf identity | `0x04` operation leaf, one tree | **Adopted** (§9) — but `operation_type` moves out of the relay-visible outer structure |
| Inference cascade | CRDT ops are silent, no floor control | **Adopted** (§11.1) — closes an open item |
| Seal | FROST-sealed checkpoint of document state at close | **Refined** (§7–8) — same instinct; it never confronts canonicalization |
| Directory role | Directory tracks which agents hold which documents, for rendezvous | **Rejected for M14** — new directory state, cuts against minimal-directory-state and against artifacts riding existing sessions (§11) |
| Scope | N-party throughout (8 concurrent roles) | **Pairwise sessions** (§11); multi-party via hub-and-spoke re-authoring, mesh deferred |
| Field-level write authority | Mandatory schema-as-contract, YAML ACL, validated on receipt | **Reshaped and deferred** (§3.3) — becomes the opt-in `schema_enforcement` flag with the schema carried as the document's first update; declared in V1, `false` only |
| Milestone | M9 | M14 |

**The philosophical divergence is now resolved rather than parked.** The May log is
*schema-first and prescriptive* — "the schema is the contract," mandatory for every
document. This document is unopinionated by default. The flag reconciles them: the
prescriptive model is available where it earns its place, and absent everywhere
else. Its enforcement mechanism is also corrected — the May log rejects invalid
operations at the receiver and never confronts the fact that rejection in a CRDT
creates permanent divergence. The quarantine-and-supersede protocol in §3.2 is
what makes receiver-side rejection viable at all.

Note also that the May log's motivating example is inherently N-party (8 roles
writing different fields concurrently), so its schema machinery lands naturally
with N-party work regardless.

---

## 13. The Protocol Boundary

Three questions that looked like open design items turned out to sit outside the
protocol. Recording why, because each is the same discipline as §1 — CELLO carries
documents; it does not model what they mean.

**Publish cadence is the caller's business** (§5). There is no mode to configure.
The client sends whatever has accumulated since the peer's last-known state vector.
How often an agent chooses to do that is a decision for the agent and its template,
informed by the audit-quality argument, not by a protocol flag.

**Notification granularity is a tool-surface question** (§4.1). The notification is
always "this document has a pending update." Everything beyond that is a separate
call the agent makes deliberately. Which document types the diff call supports is
implementation scoping, not protocol design.

**Goal decomposition belongs to the agent and template layer, not to CELLO.**
Whether a workflow spawns a child node, a sibling goal, or an entirely separate
process between different counterparties is analysis done by the goal-template
tooling in the `cello-agent` repo. From the protocol's side a goal is a JSON or CBOR
blob being co-edited by multiple agents, and "create another document" is already
supported. The **only** primitive the protocol owes this layer is **the ability to
propose a schema change** (§3.3). CELLO no more models goals, phases and spawning
than it models what a conversation is about.

Remaining work is implementation scoping: the supported document-type list for
the diff call, the durable queued-outbound mechanism, the two canonicalization
rules and their test vector suites (§14), and the tool surface for the
lifecycle verbs (§3.5).

---

## 14. Implementation Notes

**Persistence — two layers, not one.** Storing only a merged Yjs binary in
SQLCipher discards the signed envelope chain that makes the seal verifiable. Keep
both: the **immutable CELLO envelope log** (signatures, provenance, replay
protection, seal verification) and a **materialized Yjs snapshot** (fast startup
and access), with the snapshot rebuildable from the log. Both live in SQLCipher
alongside other CELLO client state. Live Yjs state need not survive a daemon
restart — CELLO's invariant is daemon-up-is-CELLO-on — because the envelope log
makes rebuilding straightforward.

**Store the state vector and last-applied envelope index with the snapshot.**
Without them, rebuilding or verifying requires working out from scratch where the
snapshot sits relative to the log. With them it is a lookup.

**Publish writes to the envelope log immediately; delivery reads from it.** The
naive implementation of §5.1's queued outbound is an in-memory queue — and that
contradicts the restart invariant above. An agent publishes, the daemon restarts
overnight, and the batch silently never arrives while the agent believes the work
was shared. Writing the envelope at publish time closes this without new
machinery: "queued outbound" becomes *envelopes in the log not yet acknowledged by
the peer*, which is also how the queue is reconstructed after a restart. Durability
falls out of the two-layer model rather than being bolted on.

**Envelope fields.** Beyond the standard CELLO message envelope, a document
operation carries: `document_id`, `epoch_id`, `doc_prev_hash` (the per-document
chain link, §9.1), the sender's Yjs state vector (§7), and the update payload.
`epoch_id` is not optional — after a compaction, an update that does not state
its epoch cannot be verified unambiguously. `doc_prev_hash` is not optional
either — it is what lets the document log be extracted and verified across
sealed sessions.

**Mixed tiers are coherent by construction, not a hazard.** Epoch transitions are
bilateral and signed, so both parties compact together and neither is left unable
to verify an earlier epoch. Hub-and-spoke does produce different tiers on different
links — A↔B attested while A↔C is only authenticated — but those are separate
documents with separate handshakes (§11.1), so there is no mixed-tier document to
reconcile.

**Test vectors are required for two paths**, because both are cheap to get subtly
wrong and expensive to detect in production:

- **Canonicalization conformance.** Both parties must produce byte-identical output
  from converged state, so a shared vector suite is the only practical guard
  against two implementations drifting — and drift surfaces as a false divergence
  alarm at quiescence, which is the worst possible failure mode for trust in the
  mechanism.
- **Concurrent update plus rejection.** The interaction of a rejection (§3.2)
  with an in-flight concurrent update from the other party needs explicit
  vectors rather than reasoning — covering both the supersession path (the
  superseding update must net to zero against the quarantined original) and the
  purge path (epoch reset with concurrent work in flight).

**Yjs clientID — let Yjs mint it.** Yjs identifies every operation by
`(clientID, clock)`, and that pair is assumed globally unique. Two live `Y.Doc`
instances sharing a clientID mint colliding IDs for different operations; state
vector sync then silently skips them, and the documents diverge permanently with no
error and no recovery path.

Co-attendance is **not** exposed to this: the daemon owns the document and
serializes application exactly as it serializes `send`, so there is one clientID
and one monotonic clock across both attending sessions. The only way to get two
live instances is two processes — the same agent restored onto a second device with
both daemons live, or an orphan daemon alongside a fresh one.

The rule is therefore a one-line "don't optimize this": **let Yjs generate its own
random clientID per live `Y.Doc`; never derive it from agent identity, never
persist and restore one.** That is Yjs's default behaviour — the hazard only
appears if someone gets clever. One residual accepted risk: clientIDs are
random 32-bit values, so across a long-lived document's many fresh `Y.Doc`
instances the birthday collision probability is small but not cryptographic —
accepted, and recorded here so it is not rediscovered as a surprise.

---

## 15. The Three Use Cases

### A. Collaborate on a Shared Document (Unstructured)
Co-authoring Markdown, HTML, or raw JSON. `append_only: false` — any part of the
document can be updated fluidly by any authorized party. Tier 1 is sufficient.

### B. Auditable Log of Activities
A running, cryptographically signed ledger of actions, events, or decisions.
`append_only: true`, strictly enforced — and note that append-only **cannot be a
document flag**: Yjs is mutable by construction, and a peer can emit a valid
deletion that converges correctly into a state that is no longer an append-only
log. Enforcement must happen in CELLO *before* application (reject updates
containing deletions), or the log must be signed append events with the Yjs
document as a projection of them. **This is the flagship Tier 2 case** (§6) — its
headline claim requires artifact binding.

### C. Track a Shared Goal (Micro-Project Management)
Structured, multi-actor workflows — technically identical to Use Case A (a JSON
blob) but structured around phases, current state, parent/child relationships,
spawned subgoals, and an appended goal journal. CELLO provides skills and agent
templates for constructing and orchestrating this, not a prescribed schema.

The value at launch is being able to hold and track a shared goal at all — not
strict control over who writes which field. Verified identity already answers the
question that matters ("is this really the sales trader?"), and the signed oplog
makes any out-of-lane write attributable after the fact. So V1 ships the schema as
**shared convention** — both agents load the same template skill — with
`schema_enforcement: false`. Enforcement is available later via §3.3 without a
retrofit.

How a goal is decomposed — child nodes, sibling goals, or a separate process
between different counterparties — is template and agent-tooling work in the
`cello-agent` repo, not protocol work (§13).

**Design principle, reaffirmed:** don't over-specify. Any document type can be
collaborated on; the one property worth making first-class is **append-only**,
because that is what the auditable-log case depends on — and per §15B it is a
validated invariant, not a boolean.

---

## 16. Decisions Addendum — the V1/V2 Cut and the Missing Layers (2026-08-04)

This section is the product of working the document backward from a Definition
of Done: for every gap that surfaced, a decision was made with Andre on
2026-08-04. It is the decision register the [[M14-DEFINITION-OF-DONE]] and
[[M14B-DEFINITION-OF-DONE]] cite as spec-of-record. Where this section and an
earlier section disagree, this section wins — it is later and it was decided
explicitly.

### 16.1 The V1/V2 cut — V1 is Tier 1 only; V2 is M14B

**V1 (M14) ships Tier 1 — authenticated collaboration — only.** The handshake
declares `assurance_tier` but accepts only `authenticated`, exactly the
pattern §3.3 chose for `schema_enforcement` ("declare the flag, support only
false"). This removes canonicalization, the quiescence agreement flow,
divergence records, epochs, and purge from V1 in one decision — the largest
de-scoping available anywhere in this design. Tier-2 upgrade at an epoch
boundary (§6) means nothing is stranded.

**Purge defers with the epochs it rides on.** The V1 answer to "something
toxic got into the document" is the Kill verb plus starting a fresh document —
a manual epoch reset in effect. Toxic bytes lingering as invisible tombstones
inside the encrypted local stores of the two parties who already saw the
content is a forgivable papercut at launch; the visible content is gone and
the rejection is on record.

**The seam is protected by explicit V1 requirements**, each cheap now and each
a retrofit if skipped:

- Handshake declares `assurance_tier` (only `authenticated` accepted) and
  `schema_enforcement` (only `false` accepted).
- Every document envelope carries `epoch_id` (constant `0` in V1) and
  `doc_prev_hash`.
- Envelope storage keeps the payload column nullable (purge-ready) and
  supports withdrawal records (§16.4).
- Verifiers hash unknown leaf types as opaque bytes and skip them for
  rendering (§16.7 item 10).
- Replay is defined set-based per epoch (§16.7 item 5), so epochs slot in
  without redefining verification.

**V2 is milestone M14B** — same feature deepened, not a new domain. Its DoD is
written now with `status: parked` so the decisions in this section that
concern V2 (purge is cooperative, tier upgrade never retroactive,
receiver-local limits) have a durable home rather than living only here.
**V2's four owed design items**, to be closed in one design session before any
M14B line goes active:

1. **Quiescence triggering** — §7.1 defines the agreement flow but not when or
   who initiates outside a seal; intermediate checkpoints have no trigger.
2. **The epoch wire protocol** — §10 gives principles (bilateral, signed,
   chained) but not the exchange: proposal/ack shapes, refusal semantics,
   updates in flight across the boundary.
3. **The schema language** — §3.3's "the first update is the schema" names a
   JSON blob declaring fields, types, write authority and update rules; that
   language has zero specification and is V2's largest single work item.
4. **Divergence recovery** — detection and bisection are designed (§7.1); the
   recovery flow (who proposes the epoch reset; what happens to legitimate
   work stacked after the fork point) is a sentence, not a protocol.

### 16.2 The write path — the document is a file; the daemon diffs at publish

The largest silence in the first two passes: how the agent's own edits become
CRDT operations. Decided:

**The daemon materializes each document as a real file in a workspace
directory. The agent edits it with its ordinary tools; the human can open the
same file.** On publish, the daemon diffs the file against the last-known
projection and converts the diff into Yjs operations — a text diff for text
types, a key diff for JSON. No new editing surface exists.

The coarseness of a diff is acceptable *because* of publish-on-intent (§5):
updates are already coarse, intentional batches, so diff-granularity
operations are the granularity the design wants anyway.

**Incoming direction:** when a peer's update is admitted (§3.2), the daemon
first folds the agent's unpublished file edits into the `Y.Doc` as local
operations, then merges the incoming update, then rewrites the file. If the
merge touched regions the agent had unpublished edits in, that is precisely
the overlap flag of §4.1 — the two mechanisms are one mechanism.

### 16.3 The document handshake — mirror the attestation-consent pattern

The handshake that establishes §3.4's properties works exactly like
attestation consent, which operators already understand:

1. A calls the create tool naming the peer, the document type, and the
   properties, optionally with starting content (the epoch-zero template).
2. B's agent receives a proposal in its inbox, reviews the properties, and
   accepts or refuses.
3. On accept, both sides mint the document from the agreed starting content.

**`document_id` is the hash of the proposal envelope** — globally unique with
no minting authority and no coordination. Property changes after acceptance
are an epoch event and therefore V2.

### 16.4 Delivery — daemon-autonomous sessions, presence-driven, with withdraw

Publish is fire-and-forget; the daemon delivers like email. Four decisions:

**Delivery sessions are daemon-autonomous.** When a pending update needs
delivering, the daemon opens (or reuses) a session with the peer's daemon,
delivers, collects the ack, and seals — with no agent attention on either end.
The session still happens because it carries signing, encryption, and the
seal; the *ceremony* goes to zero. The receiving side admits mechanically and
sets the pending flag. Two agents in opposite timezones sync overnight without
either agent doing anything. The daemon logs every delivery attempt and every
autonomous session.

**Session choice: daemon-chooses by default, optional hint.** `publish`
accepts an optional session reference for the one case with audit value — the
agent is mid-conversation *about* the document and wants the discussion and
the change in the same sealed record. Omitted, the daemon uses the most recent
active session with that peer or opens one.

**Rendezvous is presence-driven push — the directory learns nothing new.**
When a daemon reconnects to the directory, its presence flips; every peer
holding pending outbound for it is watching that presence and delivers into
the first window both daemons are up. A pending-update registry at the
directory was considered and rejected: it hands the directory a mutable table
of who-collaborates-with-whom and when they work (a metadata leak), needs
anti-entropy, TTLs and cleanup, and buys nothing presence push does not — and
§12 already rejected directory document-tracking once. Presence *is* the
directory-level operation, using state the directory already has. Backstop: a
slow periodic retry (minutes, capped) for stale-presence windows, and **every
undelivered update retries on daemon restart** — which falls out of §14's rule
that queued outbound is "envelopes in the log not yet acknowledged", and is
pinned by the offline-delivery enforcer.

**The `withdraw` verb.** An update pending toward a peer who never appears can
be withdrawn: the daemon rolls the change back locally (Yjs undo) and writes a
withdrawal record into the log beside the original envelope — marked
withdrawn, never deleted, so the log stays intact. The peer never saw the
update, so no supersession is needed. For "this collaborator is never coming
back," Kill (§3.5) already covers the whole document.

**Accepted limit, stated so nobody rediscovers it as a bug:** if two daemons
are literally never online in the same window, peer-to-peer delivery is
impossible — the relay does not buffer, by design. Daemon-up-is-CELLO-on makes
overlap the norm.

### 16.5 Notification — passive pending flag; no doorbell

§11.3 settles this: a CRDT update is writing to a shared cell, not an
utterance, and must not trigger inference. An admitted update sets pending
state visible in the inbox and in List; the agent finds it next time it looks.
When the peer wants attention they send an ordinary chat message, which uses
the existing doorbell. Doorbell-on-update may become a per-document opt-in
later; V1 ships zero new notification machinery.

### 16.6 Sender-side screening — advisory, never a boundary

The sender's daemon runs its own screening policy against the outbound diff at
publish — the same code path the receive side uses, nearly free. Framing rule:
**this is a courtesy, never a security boundary.** The local daemon is
editable by any coding agent, so the receiver's gate (§3.2) remains the only
authoritative check. What the sender-side scan buys is UX: it catches the
sender's own accidental credential leak before it transits, and saves a
rejection round-trip for the well-intentioned majority.

The asymmetry problem (my let-throughs are not yours) was considered: a shared
**screening-profile hint** carried in the document template would let the
sender predict the receiver's verdict. Deferred — advisory in both directions,
it cannot be load-bearing (an untrusted daemon's declaration never is), and
§3.2 already prices misprediction at one supersession round-trip. Revisit when
real rejection friction justifies it.

### 16.7 Resolved decisions register

1. **Append-only enforcement (Use Case B): reject at the §3.2 gate.** A
   deletion shows up in the projected diff like any change; `append_only:
   true` is one more rule the existing gate checks, and the rejection resolves
   by ordinary supersession. The alternative — signed append events with the
   Yjs doc as a projection — is a parallel storage and replay model built for
   one use case; dropped. §15B's either/or is closed.
2. **Rejection edge cases: one retry, then freeze.** If a superseding update
   is itself rejected, one more round is allowed; after that the document
   flips to **stalled** — the receiver stops accepting updates on it and both
   operators see the reason in their policy logs. Mutual concurrent
   rejections need nothing special (each direction has its own quarantine and
   supersession; state vectors prevent deadlock). The §3.2 "trust-signal
   event" for a non-compliant sender is, in V1, a policy-log entry plus the
   stalled status — no new trust-signal type.
3. **Purge is cooperative (V2).** The sender authored the content and
   possessed it before the protocol saw it; no protocol reaches into their
   disk. The claim is scoped: purge removes the content from the receiver's
   side and the shared live document; a compliant sender's daemon also
   redacts its own log; a non-compliant one is a policy-log fact.
4. **Two daemons from a restored backup: accepted risk, and not a document
   problem.** With Yjs minting random clientIDs (§14's rule), two live
   instances behave like two ordinary peers and merge fine. The real hazard —
   two daemons both claiming to *be* the same agent — is an identity-layer
   concern CELLO has independent of documents; solve it there once.
5. **Replay is set-based, not sequence-based.** `doc_prev_hash` gives one
   chain per sender; no total order across senders is defined or needed.
   Verification per epoch: collect the effective `0x04` leaves (effective =
   no `0x05` references it — a set property), check each sender's chain is
   complete, apply in any order (Yjs converges regardless), compare the
   result. The "document-log order" phrase in §9 is superseded by this.
6. **Limits are receiver-local (§10.1), violations are ordinary rejections.**
   The protocol spec publishes generous defaults; any receiver may tighten
   locally; a violation flows through §3.2 with a machine-readable reason
   ("exceeds their 5 MB update limit"). No bilateral limit negotiation.
7. **Hostile Yjs input: cap, catch, contain.** Pre-parse size cap before Yjs
   sees the bytes; shadow-apply wrapped so a malformed update becomes an
   ordinary rejection ("malformed update") rather than a crash; structural
   limits checked on the shadow before admission. No sandbox process in V1.
   Precondition: a short fuzz pass against `applyUpdate` (garbage, truncated,
   pathological updates) so the residual risk is measured, not assumed.
8. **Peer compatibility: version the proposal, fail with a human answer.**
   Alpha — no backward compatibility owed. The create proposal carries a
   feature version; a peer whose client predates documents gets surfaced as
   "your peer's client doesn't support shared documents yet — ask them to
   upgrade." The Yjs update encoding version is pinned in the protocol spec.
   Full capability negotiation: deferred.
9. **The returning collaborator (template changed while away).** V1
   (enforcement off): the template is document content, so its change is a
   pending update like any other — the goal-template skill instructs "on
   returning to a document, re-read its conventions before writing"; the
   overlap flag catches direct collisions. V2 (enforcement on): the epoch
   machinery answers it with no addition — a publish against a stale epoch is
   rejected with the current epoch, the daemon syncs, the agent re-applies.
10. **Verifier tolerance rule (forward compatibility).** Verification is hash
    recomputation (needs no understanding of a leaf) plus rendering (does).
    Rule: **unknown leaf types are hashed as opaque bytes and skipped for
    rendering** — a verifier shows "1 entry of an unrecognized type" instead
    of calling a valid seal invalid. Folded into the `0x04` work rather than
    shipped ahead (alpha); stated as a permanent property because it decouples
    verifier releases from every future leaf-type addition, not just this one.
11. **Platform kill switch vs. open documents: pause freezes the agent's
    actions, not the record.** A paused agent: outbound publishes refused
    loudly; incoming updates still validated and admitted (that path is
    mechanical — no LLM involved); notifications suppressed. Unpause resumes.
    Matches what pause means everywhere else in CELLO.
12. **Storage sketch (client-side SQLCipher), keyed on stable IDs only:**
    `documents` (document_id, peer `agent_id`, properties, status),
    `document_envelopes` (the append-only log: hash, signature, payload —
    payload nullable for V2 purge; withdrawal records live here),
    `document_snapshots` (Yjs binary + state vector + last-applied envelope
    index). A payload-stripped envelope proves *an envelope with this hash
    existed and was rejected* — the `0x05` leaf referencing it is the
    explanation; recorded now though it only matters when purge ships.

13. **Screening NEVER mutates an inbound document update; it refuses.** The
    screening audit (§16.8, previously owed) was run on 2026-08-05 by putting
    18 realistic document samples through `sanitizeInbound`. Nine triggered
    something and **six had their text silently rewritten** — Hindi ZWJ
    stripped into a different word, a family emoji split into three people,
    full-width CJK input normalised to ASCII, ligatures and fractions
    rewritten, a document *about* model prompt formats losing its subject.
    For a CRDT that is not a false positive, it is permanent divergence: the
    receiver applies different bytes than the sender signed, both believe they
    converged, and nothing reports it. Tuning does not help — invisible-strip
    and NFKC are wrong for a replica at any threshold.

    A rejected middle: screening the *projection* (file, agent-facing diff)
    while converging the replica raw. It breaks on WRITE-BACK. B's file is a
    screened rendering; B's agent edits it; the write path diffs the file
    against the replica and produces "delete A's text, insert the redaction,
    plus the real edit". B publishes a valid, signed operation that
    **propagates B's local screening policy into A's document and deletes A's
    content**. Any lossy projection breaks bidirectional sync, because
    write-back cannot distinguish "the user changed this" from "the projection
    changed this". Also rejected on grounds of promise: an enterprise told
    "we screen inbound content" cannot also be handed the raw version on disk
    where any agent's own file tools read it.

14. **The receiver is the trust boundary; sender-side enforcement is
    ergonomics.** A sender's client can be compromised while the sender is
    honest, so pre-send screening exists to reduce friction among good actors
    and nothing more. The receiver validates every update as though none of it
    happened, and **nothing in the sender-side path may ever be a reason to
    skip a receiver-side check.**

15. **A CONTENT PROFILE, agreed at the handshake — an allowlist, not a
    denylist.** Named and closed (`ascii-text`, `ascii-markdown`, `json`,
    `unicode-markdown`, `unicode-text`), each defined as an explicit
    **codepoint set, not an adjective**, so enforcement is total and cheap —
    a profile enforced by a heuristic is a promise not kept. It rides in the
    signed proposal `properties`, so it is bound into `document_id` (neither
    side can drift) and is immutable after accept (an upgrade is a new
    document, or a V2 epoch event — so the create flow must make the choice
    legible rather than defaulting silently).

    This converts an open-ended denylist argument into a closed check, and
    moves the decision to CONSENT time, where a human is already engaged and
    the question is "do I want a Devanagari document with this person" rather
    than "what is U+200D doing at offset 412". Distinct from
    `schema_enforcement`, which is about structure; a profile is about the
    character space. Enforced at authoring (friction) AND at receipt
    (security), per item 14.

16. **A refusal carries a machine-readable reason, and the default resolution
    is that the SENDER ADOPTS the receiver's rule.** Rule id, codepoints,
    count, offsets — enough to act on without a human reading prose. Rules
    compose toward STRICT: nobody is ever asked to accept less protection, and
    the document ends up governed by the union of both parties' rules, which
    is the only composition that cannot be exploited. Adopting also fixes the
    model-keeps-emitting-it problem, because the character is stripped at
    authoring rather than argued about at the boundary.

17. **The rebuttal is DATA, never argument — and it is the tail, not the
    default.** For the residual case where a character is load-bearing for
    meaning (Devanagari joiners, kanji), the sender may rebut. A rebuttal is
    counterparty-authored content arriving at the receiver's agent arguing it
    should lower its defences — the most attacker-favourable surface in the
    protocol — so it carries structured evidence (rule id, codepoints,
    positions, the marked diff) and any free text is presented as quoted
    untrusted content, never as instruction. Adjudicated mainly by SCRIPT
    COHERENCE, which is computable from the document rather than assertable by
    the sender: U+200D in an otherwise-Devanagari document is orthography, in
    an ASCII English one it is smuggling. Escalation ladder: coherent and
    low-volume → auto-allow; incoherent → auto-refuse with no rebuttal
    entertained; genuinely ambiguous → the agent under the operator's standing
    policy → the human.

    Exceptions are scoped to `(document, rule, codepoint set)` and NEVER widen
    a rule; are signed, logged, listed in document status, and revocable; and
    **granting is not admitting** — the sender republishes through the gate,
    which kills the bait-and-switch where a benign document earns an exception
    and then uses it. A rebuttal must NOT count against REJECT-1's
    three-round stall ceiling, or a document freezes for engaging with the
    process correctly.

18. **The ambiguous band defaults to REFUSE, not ASK.** Interrupting the
    receiving operator lets the peer choose when you are disturbed — an
    attention denial-of-service an adversary drives. Auto-refuse is tolerable
    only because item 16 makes the refusal non-silent to the SENDER; the
    receiving operator learns of it from document status when they wonder why
    the document stopped.

### 16.8 Preconditions and sequencing

- **The screening audit (§3.1) — RUN, 2026-08-05.** Result and consequences in
  §16.7 items 13–18. It was deferred as a reading exercise and turned out not
  to be one: what answered it was running real document content through the
  screener and measuring what changed.
- **The Yjs fuzz pass** (item 7 above) — small, do before the receive-pipeline
  unit.
- **The verifier tolerance rule** — folded into the `0x04` unit (item 10).
- **Milestone identities:** V1 = **M14**, V2 = **M14B** (same milestone
  family, second wave — decided 2026-08-04). The M14B DoD is written at the
  same time as the M14 DoD, `status: parked`, activating only when M14 closes
  and §16.1's four owed design items are resolved.

---

## Related Documents

- [[2026-05-08_1612_shared-state-as-protocol-primitive|Shared State as Protocol
  Primitive]] — the May design of this same feature; reconciled in §12
- [[2026-04-13_1500_multi-party-conversation-design|Multi-Party Conversation
  Design]] — transport topology and mesh scaling relevant to §11
- [[2026-04-19_2045_group-room-design|Group Room Design]] — floor control, resolved
  as not applicable in §11.1
- [[2026-04-13_1400_meta-merkle-tree-design|Meta-Merkle Tree Design]] — relevant to
  cross-session artifact provenance (§7, §11)
- [[2026-05-08_1400_presence-notification-subscription|Presence Notification
  Subscription]] — May stub for the directory-side presence subscription that §16.4's
  delivery design defers (parked as M14-P4)
- [[M14-PROCEDURE|M14 Procedure]] — the operating runbook built from this design
- [[M14-DEFINITION-OF-DONE|M14 Definition of Done]] — V1's yardstick; cites §16 as its
  decision register
- [[M14B-DEFINITION-OF-DONE|M14B Definition of Done]] — V2's parked yardstick (Tier 2,
  epochs, purge, schema enforcement)
