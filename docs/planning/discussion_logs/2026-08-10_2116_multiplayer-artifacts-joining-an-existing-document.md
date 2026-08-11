---
name: Multiplayer Artifacts — Letting a Third Party Join an Existing Document
type: discussion
date: 2026-08-10
topics: [collaborative-state, shared-documents, multiplayer, mesh, hub-and-spoke, m14, m14b, epochs, participant-set, consent, crdt]
status: active
description: >
  M14 shipped shared documents as strictly bilateral and permanently closed — the two parties
  fixed at creation, with no way for a third to join. Andre ruled on 2026-08-10 that this is the
  number one primitive that must change: a collaboration platform whose artifacts cannot be joined
  is antithetical to what CELLO is for. This log records what actually ships today, which parts of
  "immutable" are load-bearing and which were self-imposed, the amendment-by-consent mechanism that
  replaces them, the hub-and-spoke versus mesh comparison, the phased pathway, and the decisions
  still owed. Updated 2026-08-11: all six open decisions ruled (§13) — admin-governed documents,
  full-document join, forward-only removal, hub-and-spoke retired, cap 20, milestone M14B.
---

# Multiplayer Artifacts — Letting a Third Party Join an Existing Document

## The ruling

M14 shipped shared documents that two agents co-edit. The two parties are fixed when the document
is created and **cannot change for the life of the document**. Nobody can be added. Nothing about
the arrangement can be amended.

Andre's assessment, 2026-08-10:

> The fact that other people cannot join in editing a document, for a platform that bases itself on
> collaboration — it's right there in everything we do — is so antithetical to our overall goals
> that only an AI coder could do it that way. To me, that is the number one primitive that we have
> built into these that must be changed.
>
> I understand the point that they're agreeing to do something a certain way. What I disagree with
> is that no one else can join. Why not? Why isn't it that here's a document, this is how we're
> doing it, we've agreed on that — and either we unanimously agree to change it, or you agree that
> you're going to accept it, and we're done.

That is the design direction. This log records what stands in the way, what does not, and what it
costs to get there.

---

## 1. What actually ships today

Three topologies were designed in
[[2026-07-31_federated-collaborative-state-architecture]] §11. Their current state:

| Topology | What it is | Status today |
|---|---|---|
| **Pairwise (bilateral)** | Two parties, fixed at creation | **Shipped.** The only thing that works. |
| **Hub-and-spoke** | A holds a document with B *and a separate one* with C, and re-authors content across | **Works by construction** — it is just two ordinary documents. The tooling that makes it usable is parked (M14-P7). |
| **Pass-through** | A backs both links with one shared state, so B's and C's edits reach each other | **Designed, parked (M14-P8).** The V1 handshake actively refuses the declaration. |
| **Mesh / delivery lists** | One artifact, N holders, everyone delivers to everyone | **Deferred.** No story, no DoD line. M14B lists it under "explicitly beyond M14B — its own milestone." |

So the product's answer to "can a third person join?" is currently: *no, but you can maintain a
second document by hand and retype things between them.*

---

## 2. Three things were welded into the word "immutable" — only one is load-bearing

The bilateral-forever property is not one decision. It is three, and they have very different
weight.

### (a) The document's identity is the hash of its opening proposal — REAL, KEEP

`document_id` is derived from the signed proposal. That is what makes a document a *thing* rather
than a name two people happen to share, and it is why a document cannot be silently swapped
underneath anyone.

**But it only constrains the genesis.** A chain anchored to a fixed genesis can carry amendments
after it — that is the ordinary shape of every append-only log in this codebase, including the
document envelope log itself. Nothing about hashing the opening proposal requires the participant
set to be frozen forever.

### (b) The agreed rules must not change silently — REAL, KEEP, BUT THE WORD *SILENTLY* WAS DROPPED

The properties agreed at handshake are immutable after accept, and the code says why: *"mutating a
property after acceptance would silently change the rules the other party consented to, which is
the one thing the handshake exists to prevent."*

That reasoning is correct about **silent** change and then over-applies. Immutability is one way to
prevent rules shifting under someone. **Unanimous signed consent is another, and it is strictly
stronger:**

- It prevents the same thing — no rule changes without your signature.
- It additionally prevents *you being written out*, and *a stranger being added*, behind your back.
- And it permits the thing we want, which immutability forbids.

A document whose participant list is derived from a chain of unanimously-signed amendments has a
better integrity story than one that simply cannot change, because "cannot change" is only enforced
by every implementation agreeing to refuse — whereas a missing signature is checkable.

### (c) The participant set determines who delivers to whom — REAL, AND THIS IS THE ACTUAL WORK

Once C is a holder, an edit by B has to reach C. Either B delivers to C directly (which requires a
B↔C session), or someone relays (which reintroduces the relaying-versus-re-authoring problem and
requires the relayer to be online). This is genuine engineering and it is the only part of the
bilateral constraint that was not self-imposed.

**(a) and (b) dissolve under an amendment model. (c) is the milestone.**

---

## 3. The design error, named precisely

§11 is not sloppy. It is a well-argued section that optimises for the wrong case.

Its central argument for hub-and-spoke is the **broker**: you contract with C, you sell the
finished work to B, and forcing a B↔C connection is a disintermediation risk that makes the feature
unusable for the party who most needs it. That argument is sound *for a broker*.

It then became the default for a product whose premise is people collaborating.

**The tell is cost #4 in the mesh section**, which reads:

> It requires full mesh among holders. If B edits, B must deliver to C, so B needs a B–C session.
> Adding C to a document A shares with B *forces a connection between B and C*.

That is filed as a cost to be avoided. For three colleagues editing one document it is not a cost —
**it is what joining a document means.** They know about each other. That is the feature, not a
leak. The sign on that one line is inverted, and the whole topology default follows from it.

---

## 4. N-party was always the target — the evidence was in our own documents

This is worth recording, because it means multiplayer is not new scope arriving late. It is the
original scope, narrowed during implementation and never widened back.

- **The May log's motivating example is inherently N-party.**
  [[2026-05-08_1612_shared-state-as-protocol-primitive]] designs this feature around a retail equity
  purchase workflow at a financial services firm: **8 phases, 8 different roles**, writing different
  fields concurrently. The architecture log's own reconciliation table (§12) records the divergence
  in one line — *"Scope: May log = N-party throughout (8 concurrent roles) → Resolution = pairwise
  sessions; multi-party via hub-and-spoke re-authoring, mesh deferred"* — and notes that the May
  log's schema machinery "lands naturally with N-party work regardless."

- **Use Case C is a multi-actor workflow.** §15C — "Track a Shared Goal (Micro-Project Management):
  structured, multi-actor workflows... phases, current state, parent/child relationships, spawned
  subgoals." Multi-actor is in the definition.

- **The most recent real assessment of the feature was an N-party one.** Miss_Chelly's evaluation
  (M14 build journal Entry 39) asked whether a shared JSON document could carry a real multi-actor
  workflow — 8 phases, 8 people, handoffs — and found the nested-merge defect that way. The workflow
  it was testing cannot be run by two people.

- **The goal-spine work assumes it.** [[2026-08-10_1803_goal-spine-breakdown-pipeline-assessment]]
  turns a real business workflow into a shared spine. A spine with two seats is not a spine.

Every use case we describe to ourselves has more than two participants. The shipped primitive has
exactly two.

---

## 5. Hub-and-spoke versus mesh — the comparison, stated fairly

Both should exist. The question is which is the default and which is the declared exception.

| | Hub-and-spoke (two documents) | Mesh (one document, N holders) |
|---|---|---|
| **Artifact** | Two separate documents, two logs | One document, one log per holder |
| **Who sees what** | A controls exactly what crosses | Everyone sees everything |
| **Do B and C know about each other?** | No — and that is the point | Yes — and that is the point |
| **Accountability** | B's recourse is against A; A's against C. Each link independently provable. | Every holder's update is signed by its author; recourse is direct |
| **Protocol cost** | Zero — two ordinary pairwise documents | Participant-list-as-state, fan-out delivery, mandatory retry |
| **Operator cost** | High and ongoing — A hand-ports content between two documents | Low — you edit, it propagates |
| **"The document" means** | Different things to B and C, legitimately | One artifact |
| **Right for** | Broker / supplier chains, where disintermediation is a real risk | Colleagues, teams, workflows — the collaboration case |

**Neither is wrong. The error was making the first one the only one.** Hub-and-spoke should survive
as a declared topology — the broker case is real, the argument for it is good, and the wire field
already exists. It just stops being the default and stops being the only option.

Pass-through (§11.1's single-`Y.Doc` opt-in) sits between them and is materially smaller than mesh:
one coordinator backs both links with one state, propagation is transitive and all-or-nothing, and
third-party client identifiers are visible as opaque numbers rather than identities. It is the
honest answer for "we are three people on one team" and it is already designed and refused rather
than undesigned.

---

## 6. The proposed mechanism — amendment by unanimous consent

Andre's model, made concrete. It changes nothing about how a document is identified and everything
about whether it can grow.

1. **The genesis proposal stays the anchor.** Never edited. Still hashes to `document_id`. A
   document is still a fixed thing with a verifiable origin.

2. **A new signed record: the amendment.** It adds a holder, removes one, or changes a property.
   It is admitted **only when every current holder has signed it.** Unanimity, not threshold — this
   is not a FROST ceremony, it is N signatures on one preimage.

3. **The current participant set = genesis + the ordered amendment chain**, replayed independently
   by every holder. That is the same append-only-log-with-chain-verification property the document
   envelope log already has, and the same verification walk.

4. **A join is the consent handshake that already exists.** Propose → the invitee sees the rules
   before agreeing → accept or refuse, with signed frames. The document handshake was deliberately
   built to mirror the attestation-consent pattern (§16.3); a join request is the same shape with a
   different subject.

5. **The invariant that replaces immutability:** *no change to the arrangement is valid without the
   signature of every party bound by it.* An amendment missing your signature is not a rule you
   have to detect and dispute — it is invalid, and every holder computes that independently.

That last point is the answer to the concern that motivated the original design. The handshake
exists to stop rules changing under someone. Unanimity does that, and it does not also forbid
collaboration.

---

## 7. What it costs — and one of the four listed costs does not apply

§11.2 lists four costs against mesh. Re-examined against what V1 actually shipped:

1. **The participant list becomes document state, not per-sender config.** *Real, and it is the
   core work.* If A believes the holders are {A,B,C} and B believes {A,B}, B never delivers to C
   and C diverges silently. The amendment chain is also the answer to this: the list is derived
   from signed records every holder possesses, so the two cannot drift without a detectable gap.

2. **Retry becomes mandatory.** *Real, and smaller than it sounds.* The delivery worker already
   derives pending work from the log rather than memory, already survives restart, already backs
   off, and already treats a rejection as an acknowledgement. What changes is that it fans out to
   several peers instead of one. **Not yet traced in code — the fan-out shape is the first thing to
   confirm, not to assume.**

3. **Tier 2 agreement becomes N-way.** **DOES NOT APPLY TO V1.** V1 is Tier 1 (`authenticated`).
   There is no canonical-hash agreement at quiescence in the shipped product, so there is nothing
   to make N-way. This cost lands only when Tier 2 does, which is M14B. A whole category comes off
   the bill.

4. **It requires full mesh among holders.** *Real, and per §3 above it is the feature rather than
   the cost* for the collaboration case. It remains a genuine objection for the broker case, which
   is what hub-and-spoke stays available for.

Yjs itself is indifferent — it converges regardless of delivery order or duplication, which is
stated in §11.2 and is why this is a **delivery** problem, not a merge problem. That distinction is
the reason this is tractable.

---

## 8. Why now — the migration window is open and it closes on first use

Every wire slot this needs is **already signed into the proposal**:

- **`topology`** — a real field, currently fixed at `hub-and-spoke`, with `mesh` explicitly refused
  **at both ends**. The refusal is two-sided deliberately: the proposer and the accepter run
  different builds, and one-sided validation lets whichever side is newer decide for both.
- **`epoch_id`** — carried on every envelope, constant `0`. This field exists precisely to mark
  that the participant set or properties changed.
- **`feature_version`** — so a peer on an older build gets a sentence explaining the mismatch
  rather than a silent hang.

Consequence: **multiplayer is a validation-and-delivery change, not a wire break.** No document
created today is stranded by it.

And there are essentially no documents in existence. The milestone made exactly this argument about
a different field when it shipped `content_profile` early, and the reasoning transfers verbatim:
*the only moment rebinding is free is before anyone holds a document they care about.* That moment
is now. It closes the day the first real workflow depends on a document.

The launch-triage migration-trap rule cuts **in favour** of moving now, not against it: the
expensive version of this change is the one made after operators hold documents whose participant
sets cannot be widened.

---

## 9. Recommended pathway

Phased, each phase independently useful, dependency-ordered and not calendar-ordered.

**Phase 1 — Make the arrangement amendable (no new topology).**
The amendment record, its unanimity rule, the replay that derives current state, and the epoch
increment. Still two parties at the end of it. This is the primitive Andre named, and it is
testable entirely within the bilateral world: two parties amend a property, both signatures
required, an amendment missing one is rejected. Nothing about delivery changes.

**Phase 2 — Join, at the smallest topology that carries it.**
Admit a third holder via a unanimous amendment plus the invitee's own consent. Decide the history
question (§10) before building, because it determines whether a joiner replays the log or starts
from a snapshot at an epoch boundary.

**Phase 3 — Fan-out delivery.**
The participant list becomes the delivery target set; the worker delivers each envelope to every
holder and tracks acknowledgement per holder rather than per document. Retry per holder. The
five-enforcer discipline applies: this must be proven with three real daemons as separate OS
processes, because every serious defect in M14 was two processes disagreeing about what the third
would do, and no single-process test can have that disagreement.

**Phase 4 — Topology declaration becomes meaningful.**
`hub-and-spoke` and `mesh` both accepted, declared at handshake, refused at both ends when
unsupported. Pass-through un-parks here if the coordinator case is wanted.

**A cheaper interim worth considering:** un-park pass-through (M14-P8) ahead of full mesh. It gives
"three people on one document" with one coordinator holding the state, no participant-list-as-state
and no fan-out — at the price of the coordinator having to be reachable. It is designed, refused
rather than unbuilt, and would put a multiplayer story in front of the people asking for one while
the real thing is built. **This is a suggestion, not a recommendation** — it depends on whether the
people asking would accept a coordinator-dependent answer, which is a product question.

---

## 10. Open decisions — Andre's calls

> **All six were ruled on 2026-08-11 — see §13. This section is retained for the framing.**

**D1 — Does a joiner get the full history, or only what happens after they arrive?**
Full history is simpler: replay the log, converge like everyone else, one code path. History-from-
here needs a real epoch boundary and a snapshot the joiner starts from — and it is what people
actually ask for when the earlier discussion was candid. **This changes the shape of the work, not
just the amount**, and it must be settled before Phase 2 is designed.

**D2 — Unanimity, or does the creator keep an owner's power to admit?**
Unanimity is the stronger claim and the one that makes "nobody joins behind your back" literally
true — it is also the version that is about trust, which is what CELLO sells. The cost is that one
unreachable holder blocks a join. An owner-admits model is what every other tool does and is
materially less machinery. Recommendation: **unanimity**, with the blocking consequence accepted
deliberately rather than discovered.

**D3 — Can a holder be removed, and by whom?**
Unanimity among *remaining* holders is not the same rule as unanimity among *current* holders, and
the difference decides whether someone can be voted out. Adding is the requested feature; removal
is the question that arrives immediately after and should be answered in the same design rather
than bolted on.

**D4 — Does hub-and-spoke stay?**
Recommendation: yes, as a declared topology rather than the default. The broker argument is sound,
the field already exists, and deleting it would throw away a real case to fix a wrong default.

**D5 — Is there a cap?**
Group rooms settled on 20 participants ([[2026-04-19_2045_group-room-design]]). Whether documents
inherit that number, or any number, is undecided. Fan-out cost is linear in holders and the
resource-limit section (§10.1) exists but was written for the two-party case.

**D6 — Milestone placement.**
This does not fit M14B, which is Tier 2 (canonicalization, attestation, epochs-beyond-zero, purge,
schema enforcement) and explicitly lists mesh as out of scope. Phase 1's amendment record needs the
epoch machinery that M14B owns, which is a real dependency and should be resolved deliberately —
either multiplayer takes its own milestone that borrows epochs, or M14B's epoch line is pulled
forward.

---

## 11. Guards — things not to re-litigate

- **Floor control is not needed.** §11.3 settled it: a chat message is an utterance that demands a
  response; a CRDT operation is writing to a spreadsheet cell — it propagates silently and triggers
  no inference. Transport tiers apply to multi-party artifacts; floor control does not. Do not
  reintroduce it when participant count rises.

- **Relaying is not the answer to delivery.** §11.1's distinction holds regardless of topology: A
  forwarding C's update with C's signature intact means B learns C exists, cannot evaluate C's
  trust signals, and cannot verify A forwarded faithfully. In mesh, every holder authors its own
  updates and delivers them itself. There is no relay tier to invent.

- **Arrays stay atomic.** Element-level merge interleaves two concurrent edits into an order
  neither party wrote. Settled 2026-08-09. More participants makes this more true, not less — and a
  journal must be a keyed map, never an array, or two simultaneous entries lose one.

- **`append_only` is whole-document and buys ordering, not tamper-evidence for a mutable workflow
  record.** Already recorded as an open claim on the launch list. N-party makes it sharper: eight
  roles writing different fields is exactly where someone will expect field-level authority that
  does not exist. Nobody should be told a multi-actor document "keeps a tamper-evident audit trail"
  until field-level authorization or a separate linked append-only journal ships.

---

## 12. What this does not change

The bilateral document is not wrong — it is incomplete. Everything shipped in M14 stands: the
signed envelopes, the append-only log, the rebuildable snapshot, the receiver-side gate that
refuses rather than mutates, the file-on-disk write path, autonomous delivery, and the document
leaves in the sealed tree. Multiplayer is a widening of who may hold a document, not a rebuild of
what a document is.

---

## 13. Rulings — 2026-08-11

All six decisions from §10, ruled by Andre.

### D1 — Joiner sees the full current document; history is incidental, not a feature

A joiner must see the whole document — you cannot collaborate on something you cannot see. What
they do **not** need is a view of how it evolved. Ruling: build the **cheap path**. If the simple
implementation is replaying the existing log (which inherently carries the evolution), that is
fine — we are not protecting anyone from the history, and we build **neither** a history-viewing
feature **nor** a history-hiding feature. No snapshot-at-epoch machinery for V1.

### D2 — Admins, not unanimity: a governance meta-parameter set at creation

The unanimity-vs-owner framing was replaced. Every document has an **admin set**, fixed at
creation by the initiator and amendable afterward:

- At creation the initiator chooses: *everyone is an admin*, or a limited admin set (which can be
  just the initiator).
- **A single admin, acting alone, can:** invite a participant, promote a participant to admin,
  remove a non-admin, and change document settings. Every such act is a signed record on the
  amendment chain — attributable and independently checkable by every holder.
- The invitee's own consent handshake is still required — nobody is joined to a document without
  agreeing to its rules.

**Consequence, accepted deliberately:** the invariant shifts from "nothing changes without
everyone's signature" to *"you consented at join time to a document governed by its admin set,
and every governance act is signed and permanently on the record."* Weaker as a headline claim,
far more usable; tamper-evidence and attribution are preserved.

### D3 — Removal: admins remove non-admins; removing an admin needs all the OTHER admins

- A non-admin can be removed by an admin.
- Removing an **admin** requires agreement of **all other admins** (the removed admin does not
  vote). With exactly two admins, neither can remove the other — the recourse is to stop working
  in that document, duplicate it, and start fresh without them.
- **Removal is forward-only, by the nature of the system.** The removed holder keeps their local
  copy forever — it is on their disk, "revoking" it would be meaningless theater, and any document
  they cared about could be copied anyway. Removal means: they stop receiving new edits, and their
  new edits are refused. We never claim more than that.
- Fallback if the admin machinery proves complicated for V1: voluntary exit only. (Being kicked
  out is low-stakes anyway — the removed party still holds the document.)

### D4 — Hub-and-spoke retired as a concept; the broker case is served by construction

With real multi-party documents, an operator who wants B and C kept apart simply creates two
documents — which nobody can prevent and nobody has to build. Hub-and-spoke was never a feature;
it was the absence of one. Ruling: it stops being a default, a declared topology, and a concept.
Nothing is built, nothing is deleted; the parked cross-document tooling (M14-P7) stays parked,
likely forever. The `topology` wire field itself survives (it is already signed into the proposal
and will carry the multi-party value).

### D5 — Cap: 20 holders

Documents inherit the group-room cap of 20 ([[2026-04-19_2045_group-room-design]]). Andre's read:
20 is already a bit big — start there.

### D6 — This is M14B

Multiplayer takes the **M14B** slot: its own folder, procedures, definition of done, and build
journal. The previously-sketched M14B scope (Tier 2 — canonicalization, attestation,
epochs-beyond-zero, purge, schema enforcement) moves out of the M14B name; its renumbering is
settled when that work is scheduled, except that the **epoch machinery multiplayer needs comes
with multiplayer** rather than waiting on the old plan.

---

## 14. Build M14B Tier-2-ready — binding constraints (2026-08-11)

Andre, after reviewing what the parked Tier 2 scope contains and confirming the seal proves the
transcript but not the computed result: Tier 2 remains very important, and M14B must be built with
it in mind. Four constraints, to be carried into the M14B DoD as ACs on the units they touch:

1. **The epoch record is built once, to its final Tier 2 shape** (§10 of the architecture log):
   signed, chained to the previous epoch, **with a slot for the canonical state hash at the
   boundary**. At Tier 1 the slot is defined-absent — canonicalization does not exist yet, and
   "tier upgrade is never retroactive" makes that legitimate — but the frame never migrates.
   Tier 2 fills a field; it does not rebuild the record.

2. **Collect-N-signatures-over-one-preimage is a reusable primitive, not amendment-internal.**
   The amendment's unanimity/admin signing is the same shape as Tier 2's N-way quiescence
   agreement (N parties signing "my state hashes to X"). Build it once, generically; Tier 2's
   hardest multiplayer cost then mostly falls out.

3. **The participant set is the identity spine.** Amendment-chain participant records key on
   stable identity (pubkey — never display name, per the standing join-key rule). Tier 2 schema
   write-authority (§3.3 — the 8-role case) later resolves against this list as a lookup, not a
   migration.

4. **No new frame bakes in "the counterparty."** Every frame multiplayer adds is asked at design
   time what it means with N other parties, because Tier 2's agreement, divergence records, and
   purge coordination will run N-way over it. A joiner's consent handshake carries the document's
   `assurance_tier`, so an old build cannot join an attested document and silently compute
   nothing (the same mutual-visibility failure the handshake field exists to prevent).

**Explicitly not pulled forward:** canonicalization, the agreement handshake, purge, and schema
enforcement stay parked with Tier 2. Multiplayer leaves the sockets; it does not fill them.

---

## Related Documents
- [[2026-07-31_federated-collaborative-state-architecture]] — spec-of-record; §11 is the topology
  section this log revises, §12 records the N-party narrowing, §15 the use cases, §16 the V1/V2 cut
- [[2026-05-08_1612_shared-state-as-protocol-primitive]] — the May log; the 8-role, 8-phase
  workflow this feature was originally designed around
- [[M14-DEFINITION-OF-DONE]] — V1's yardstick; M14-P7 (cross-document diff, parked) and M14-P8
  (pass-through, parked) are the two topology parks
- [[M14B-DEFINITION-OF-DONE]] — V2's parked yardstick; owns epochs, and lists mesh as explicitly
  beyond its scope
- [[M14-BUILD-JOURNAL]] — Entry 39 carries the multi-actor workflow assessment that found the
  nested-merge defect
- [[2026-08-10_1803_goal-spine-breakdown-pipeline-assessment]] — the goal-spine work that assumes a
  multi-participant artifact
- [[2026-04-19_2045_group-room-design]] — the 20-participant cap and the prior art on multi-party
  venues
- [[launch-triage]] — item 9 (`DOD-DOC-PROFILE-1`) is the precedent for shipping a wire slot early
  because rebinding is only free before documents exist
