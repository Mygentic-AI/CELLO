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
  sender-rollback rejection, and schema enforcement as an opt-in document flag.
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
Primitive]] in §12.

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

### 3.2 The validation stage and the rejection protocol — V1

Screening implies a staging step: apply an incoming update to a **shadow
document**, run the controls, then admit it to the accepted document. The trap is
that rejection appears to create permanent divergence — the sender holds the
change, the receiver doesn't, and a CRDT offers no un-apply.

**Rejection is resolved by the sender, not the receiver.** The mechanism already
exists in CELLO in another form: endorsement refusal. Applied here:

1. The receiver validates against the shadow document and **rejects with a
   reason** — a protocol message, not a silent drop.
2. The receiver never admits the update to its accepted document and discards the
   shadow.
3. The sender receives the rejection and **rolls back locally**. Both parties are
   now back at the pre-update state. Convergence is restored.

**This is not optional for V1.** Without it the screening gate in §3.1 is broken by
construction: a screened-out update that is silently dropped diverges the two
copies permanently and invisibly. The shadow document, the validation hook, the
reject-with-reason message and sender rollback are therefore V1 machinery, driven
by screening rather than by schemas — and the schema layer in §3.3 later plugs into
a hook that already exists.

Four mechanics:

- **Rollback must not send inverse operations.** The receiver rejected, so it never
  admitted the update; the sender rolls back locally and both are at the pre-update
  state. Sending compensating operations would subtract something the receiver
  never had. Note that a local rollback in Yjs emits inverse operations into the
  *sender's own* log rather than erasing history — which is correct, and leaves an
  auditable "wrote X, was rejected, undid X" trail.
- **A non-compliant sender is a trust-signal event, not a protocol failure.** If the
  sender refuses to roll back, the receiver stalls holding later updates whose
  dependencies never arrive. Surface that rather than letting it stall silently; the
  signed record shows the sender was told and didn't act.
- **The shadow document must be rebuildable from the accepted state**, not a
  long-lived parallel copy. Cost is roughly 2× memory per artifact.
- **Validators must be deterministic** — the same input yields the same verdict on
  both sides, or rejection becomes asymmetric.

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
- The document merges automatically on arrival. That's what a CRDT is for. No
  accept/reject on the data itself.
- What is gated is the **LLM's awareness**, not the merge. The client notifies the
  agent that *something arrived* — **the notification carries no document
  content**. To see what changed, the agent makes an explicit `get_diff` call,
  which is an ordinary read subject to ordinary screening.
- This closes the prompt-injection concern the "Drafting Buffer" was reaching for,
  without accept/reject semantics: peer-controlled content never enters the LLM's
  context by arriving. It enters only when the LLM deliberately fetches it.

**Why the notification must be content-free.** If the notification quoted changed
lines, it would itself become the injection channel the design exists to close.
Notification says *that* something changed (and optionally how much, structurally);
`get_diff` says *what*.

**Diff generation is real work.** Yjs updates are binary structural operations, not
text patches. Producing "these lines changed" requires materializing before/after
projections and diffing them. Practical scope: support the common text-based types
— Markdown, plain text, JSON, XML, common text-based source files — rather than
attempting arbitrary types. Line diffs for text, key-path diffs for structured
documents. This shares machinery with §8: the canonical projection needed for
hashing is the same projection needed for diffing, so the marginal cost of one
given the other is small.

---

## 5. Publishing: Accumulate Locally, Publish on Intent

**Default mode is batched, not live-sync.** An agent accumulates local edits and
publishes them as one merged Yjs update when it decides it is ready. Yjs supports
merging N local updates into a single encoded update natively — this is a
first-class operation, not something we build.

What is being borrowed from git is the *gesture* — an explicit "I'm ready to
share" — not the machinery. What is being rejected is the live-sync default that
Yjs's usual providers (y-websocket) assume, which is a Google-Docs assumption that
was never right here: agents aren't typing, and the LLM already reads on its own
schedule.

**The argument is stronger than bandwidth.** Every update is a signed, chained,
sealed message. Per-keystroke sync would produce a Merkle chain of thousands of
leaves recording comma insertions — that makes the audit record *worse*, not just
bigger. Batching keeps each leaf an **intentional act**: "I made these changes and
I'm sharing them" is a semantic event worth signing; a whitespace fix isn't.
Screening also evaluates one coherent change rather than hundreds of fragments.

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

**Open (§13.1):** whether live-sync exists at all as an opt-in mode, or whether
accumulate-and-publish is the only model.

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

The epoch primitive turns out to be load-bearing in four places, which is why it
warrants proper design rather than treatment as a compaction detail:

1. **Compaction** — bounding tombstone growth (§10.1).
2. **Tier upgrade** — Tier 1 → Tier 2 baseline (§6).
3. **Epoch zero** — the agreed starting state. Both parties agree the document
   begins from canonical template T at hash H0, established in the handshake.
4. **Participant-set changes** — the delivery list is epoch state (§11).

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

---

## 11. Multi-Party: Hub-and-Spoke (M14) and Mesh (Deferred)

M14 ships **pairwise sessions**. Multi-party collaboration is reachable two ways,
and they are not variants of one mechanism — they are different topologies with
different meanings and different costs.

### 11.1 Hub-and-spoke — the M14 answer

**The model.** A holds a bilateral artifact with B and a separate one with C. When
C contributes, A merges that work into the document it holds and then publishes
**its own batch, signed by A**, to B. B receives an A-authored update. A decides
what crosses.

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
- **It costs nothing.** An agent participating in two pairwise collaborations is
  the existing pairwise model. No delivery lists, no participant-set epochs, no
  N-way quiescence detection, no forced connections. Multi-party in effect,
  pairwise in mechanism.
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

**Opacity is partial, not total, in the single-document form.** Yjs operations carry
`(clientID, clock)`, so a merged update A sends to B contains operations under C's
random clientID. B learns *a third client contributed* — not who, since clientID is
a random number with no identity binding. For most commercial cases this is fine:
"I use subcontractors" is rarely the secret; "which subcontractor" is. **Total
opacity** requires A to hold two genuinely separate documents and port content
across as its own edits — no automatic convergence, real work for A, but nothing
leaks. Offer it as a mode; do not make it the default.

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
creates permanent divergence. The sender-rollback protocol in §3.2 is what makes
receiver-side rejection viable at all.

Note also that the May log's motivating example is inherently N-party (8 roles
writing different fields concurrently), so its schema machinery lands naturally
with N-party work regardless.

---

## 13. Open Items

1. **Live-sync as an opt-in mode** (§5). One-line decision; affects API shape.

2. **Notification granularity by type** (§4). Type-aware (line ranges for text,
   key paths for structured) is preferred and cheaper than it looks given shared
   canonicalization machinery, but the supported type list needs fixing.

3. **Goal spawning semantics** (§15C). "Spawn a new goal" is two different
   mechanisms — a child node inside the same artifact (shares the delivery list,
   the seal, the epoch) versus a genuinely new artifact (own handshake, own
   participants, own attestation chain). Both are legitimate; the goal template
   must be explicit about which it means.

---

## 14. Implementation Notes

**Persistence — two layers, not one.** Storing only a merged Yjs binary in
SQLCipher discards the signed envelope chain that makes the seal verifiable. Keep
both: the **immutable CELLO envelope log** (signatures, provenance, replay
protection, seal verification) and a **materialized Yjs snapshot** (fast startup
and access), with the snapshot rebuildable from the log. Both live in SQLCipher
alongside other CELLO client state. State need not survive a daemon restart —
CELLO's invariant is daemon-up-is-CELLO-on — but the envelope log makes rebuilding
straightforward regardless.

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
appears if someone gets clever.

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

**Design principle, reaffirmed:** don't over-specify. Any document type can be
collaborated on; the one property worth making first-class is **append-only**,
because that is what the auditable-log case depends on — and per §15B it is a
validated invariant, not a boolean.

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
