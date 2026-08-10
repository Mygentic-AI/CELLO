---
name: 2026-08-10 Goal Spine — Breakdown Pipeline Assessment & Redesign
type: discussion
date: 2026-08-10
updated: 2026-08-10
topics: [goal-spine, workflow-decomposition, shared-documents, m14, agent-pipeline, cello-agent, provenance, doc-watch]
status: active
description: >
  Assessment of the four-agent workflow-decomposition pipeline in cello-agent that
  turns a real business workflow into a shared "goal spine", measured against the
  output it produced for the NICO retail equity purchase workflow. Covers what the
  pipeline gets wrong and why, whether CELLO's shared JSON document can carry a
  spine at all (including what shipped on 2026-08-09), and a three-change redesign
  that replaces four agents and eight output files with one agent, one artifact and
  a lint script.
---

# Goal Spine — Breakdown Pipeline Assessment & Redesign

Two questions were asked, and only the second is the subject here. The first — *can the
shared JSON document carry a multi-actor goal?* — was answered in the course of the same
session and is summarised below as context, because the pipeline's output has to run on
whatever the document layer can actually do.

The second question: **the pipeline that breaks a workflow into a spine was built months
ago against a weaker model. Can we do better, and can we simplify it?**

Short answer: yes, substantially, and the evidence is in the output it produced for the
one workflow that started all of this.

---

## 1. What a spine is

A **spine** is one shared record that a whole workflow advances against — the goal's data,
where it currently is, what is blocking it, what each handoff must carry, and who may see
or set what.

The reference case is not synthetic. It is a real, in-production process at a Malawian
asset manager: retail equity purchase, eight phases, **eight internal people plus three
external brokers**. Request capture → funds verification → order entry → batching and PDF
preparation → approval → broker submission → a four-way settlement split (cash, securities,
verification, packaging) → broker payment.

The spine that pipeline generates for it has this shape:

| Block | What it holds |
|---|---|
| `trade_record` | account, beneficiary, ticker, quantity, price, order type |
| `status.stage` | where the goal is, plus a client-facing status line |
| `blocking_flags` | `insufficient_funds`, `settlement_failed`, `awaiting_client_response` |
| `handoffs` | what each phase transition must carry to the next |
| `escalations` | target and urgency — e.g. no client response on funds → manager, 3 business days |
| `actors` | per role, what it `sees` and what it `sets` |

Two properties of that shape matter downstream and are easy to miss:

- **The nesting is not stylistic.** `blocking_flags`, `handoffs` and `escalations` nest
  precisely because several people write into them. That is where concurrent writes collide.
- **The `actors` block is a permissions model written as documentation.** It states that the
  approver sets the approval and the CRM does not. Nothing enforces it.

---

## 2. The current pipeline

Four agent definitions in `cello-agent`, plus a fixture corpus of **36 workflows across 10
domains**, each with a generated `analysis/` directory — 739 files in total, including **315
per-actor setup files**.

| Agent | Model | Produces |
|---|---|---|
| `workflow-validator` | haiku | A pass/fail report against a two-tier checklist |
| `goal-pattern-detector` | sonnet | `goal-patterns.md` — 9 yes/no questions with quoted evidence, then a pattern classification |
| `workflow-schema-generator` | sonnet | `goals/*.md` + `goals/*.json`, `shared-context.md` + `.json`, `actor-setup/*.md` |
| `workflow-analyzer` | sonnet | **Deprecated.** Superseded by the two above |

The design is a pipeline with a file as a barrier: the schema generator refuses to run
unless `goal-patterns.md` already exists.

---

## 3. What it actually produced for the reference workflow

This is the measured output, not an impression of it.

**It named three actors out of eight.** The generated schema's `actors` block contains
`crm`, `equity_ops` and `client`. Every settlement and payment role — cash settlement,
securities settlement, the settlement approver, documentation packaging, finance, and the
portfolio manager who signs the approval — is absent from the permissions model entirely.

**It made the client an actor.** The client has a `sees` list, though no client in this
workflow has an agent, logs in, or touches the system. They are contacted by email and
WhatsApp.

**It wrote 18 setup files for 8 roles.** Every role was emitted twice under two spellings —
`equity_ops_lead.md` and `equity-ops-lead.md` — with *different content*: 318 lines against
265, roughly 570 lines of difference. Two answers to the same question, both in the tree,
neither marked as wrong.

**It collapsed eight phases into three handoffs** — `phase1_to_phase2`, `phase2_to_phase3`,
`phase3_to_complete` — losing batching, approval, broker submission, and the entire four-way
settlement split.

**It invented a regulator.** The schema contains an `awaiting_compliance` stage, an
`awaiting_compliance_clearance` flag documented as *"Required if position value >$1M"*, and a
`client_on_restricted_list` flag. The workflow has no compliance clearance step, no
restricted list, and no dollar threshold — it prices in Malawi Kwacha. That is a US-brokerage
mental model imported wholesale and presented as the customer's process.

**Verdict:** the idea is right and the artifact is real. But it dropped three quarters of the
organisation and hallucinated a regulator, and nothing in the pipeline could tell.

---

## 4. Why it is built the way it is

The deprecated `workflow-analyzer` says so in its own words. It was split into two agents
because:

> "Long instructions got skipped when simpler patterns were available… Pattern detection was
> buried after actor analysis… The agent defaulted to familiar behavior (flat schemas)."

That is a diagnosis of a January-2026 Sonnet, and every structural choice in the current
pipeline is a workaround for it:

- nine yes/no questions with mandatory quoted evidence, to stop the model skimming;
- a two-phase split with a file as a hard barrier, to stop it jumping to schema generation;
- `"You are DONE when goal-patterns.md exists. Do not create any other files."`

None of that is wrong. It is scaffolding, and it is scaffolding for a problem that structured
output solves directly.

---

## 5. Can the document layer carry a spine? — state as of 2026-08-10

Context for the redesign, because the pipeline's output has to run on this.

### Shipped, and verified in source rather than taken on report

- **Per-key merge now recurses.** Nested objects become nested maps, key operations recurse at
  every depth, and an existing nested map is *reused* rather than replaced. Two people editing
  two fields inside `blocking_flags` both survive. Shipped in daemon `0.0.154`.
  **Consequence for this document: the earlier recommendation that the generator flatten its
  schema to match a top-level-only merge is withdrawn. The spine can nest as deeply as the
  workflow reads.**
- **The stale-write guard.** A write that would remove a peer's edit the author never saw is
  refused, with the changed lines and current text travelling with the refusal. Previously it
  deleted their work silently — measured at a 226ms window on live two-machine traffic.
- **`cello_doc_watch`.** Receiver-local key-path subscriptions: name the paths you are waiting
  on, get woken once when one moves. A parent path catches everything beneath it. Entirely
  local — a counterparty cannot make you wake by claiming a field is urgent, and cannot stop
  you watching one.

### Still missing

- **Multi-sharing.** Documents are pairwise. N bilateral agreements mint N *different*
  documents, so a coordinating party becomes a manual reconciliation point — which reinstates
  the trusted middleman the protocol exists to remove. The work is in the delivery schema, not
  the inbound check: acks settle per envelope, and N recipients turn "delivered" into an
  (envelope × recipient) matrix plus a semantics decision.
- **Field authorization.** `actors.sees` / `actors.sets` is declared and unenforced. Either
  party writes any key at any time.
- **Tamper-evidence for the audit trail.** `append_only` is whole-document, and a spine needs
  a mutable status and mutable flags — so a spine cannot be append-only. The audit guarantee
  arrives with field authorization or with a separate linked append-only journal document.
- **Document linking.** The reference workflow spawns a child goal by name on insufficient
  funds. Nothing relates one document to another.

---

## 6. The redesign

Three changes, in order of payoff.

### 6.1 Structured output with required provenance

One agent, forced to fill a JSON Schema. That alone removes the flat-schema default the
two-phase split was built to prevent — pattern classification becomes a *field* in the output,
not a stage with a file barrier behind it.

But the schema should demand something the current pipeline never asks for: **every emitted
field cites the line of the workflow it came from — a quote, not a paraphrase — and a script
checks that the quote appears in the source.**

This is the change that fixes the worst failure. Lint catches the missing five actors.
Code-derivation catches the duplicate files. *Neither catches an invented $1M compliance gate.*
Nothing catches that except requiring the model to show where it got it, and a citation is
mechanically checkable in a way a claim is not.

It also gives the artifact something it currently lacks: when someone later asks why the spine
has a compliance stage, the answer is in the file.

### 6.2 Derive the per-actor views in code — they are now executable

An actor's watch-fors are mechanically *"paths this actor reads that another actor sets"*.
Their handoff obligations are *"paths this actor sets that another reads"*. That is a
projection over the spine, not a judgment call, and it should be a loop rather than a model.

What is new since `cello_doc_watch` shipped is where the derived list goes:

> The derived path list **is the `paths` argument to `cello_doc_watch`.** Not a checklist for a
> human to implement — the actual call.

The equity ops lead's setup stops being 318 lines of prose about monitoring an inbox and
becomes a watch on the approval handoff that wakes him when the portfolio manager signs. The
generated artifact becomes configuration rather than documentation.

And because the role list is the loop variable, a role cannot be emitted twice under two
spellings. The 18-files-for-8-roles failure stops being a thing that can happen.

### 6.3 Deterministic lint

Every Type-1 check in the current validator is a fact about the emitted JSON, not a judgment:

- every party in the Parties table appears in `actors` — *catches the three-of-eight omission*
- every phase has an owner who is a real actor
- every blocking flag has at least one actor who can clear it
- every escalation target resolves to an actor
- every path in a `sees`/`sets` list exists in the record — *catches `client_on_restricted_list`*
- every `role_id` is canonical, so no role appears under two spellings
- every citation resolves to a line in the source workflow — *catches the invented regulator*

Lint does not hallucinate. Keep a model only for the genuinely subjective Type-2 warnings —
"this approval documents no rejection path", "this async step has no timeout".

**Net: four agents and roughly eight output files per workflow become one agent, one artifact
and a script.**

---

## 7. Open decisions

**Is this worth runway now?** The pipeline is not on the launch path, and the default answer
would be no. There is one argument for doing at least the lint: these generated spines are the
only realistic test inputs for the document work, and they currently contain a fictional
approval step. A test that asserts behaviour against an invented compliance gate is worse than
no test at all.

**Do the human-readable per-actor pages survive?** If the watch configuration is generated and
executable, 300 lines of markdown per role may be dead weight. Preference, not a finding — one
short page per role for a person onboarding seems right, and the rest goes.

**Where does the pipeline live?** The agent definitions are in `cello-agent`; the spine is
consumed by `cello-client`. Worth deciding before it is split across both by accident.

**Does the spine schema get a journal?** Decided during the M14 exchange that a journal must be
a *map* keyed `<iso-timestamp>-<author>-<hash8>`, never an array — eight actors append to it,
and atomic arrays drop one of two concurrent appends. Timestamp-first because canonical
rendering sorts keys at every depth, so the log renders chronologically for free on both
machines. Not yet reflected in the generator.

---

## References

- Pipeline agents: `cello-agent/.claude/agents/{workflow-validator,goal-pattern-detector,workflow-schema-generator,workflow-analyzer}.md`
- Reference workflow: `cello-agent/.claude/agents/test-fixtures/finance/retail-equity-purchase/workflow.md`
- Its generated output: same directory, `analysis/`
- Merge, serialisation and key operations: `cello-client/core/daemon/src/document-json.ts`
- Type registry and merge roots: `cello-client/core/daemon/src/document-types.ts`
- Single-peer refusal (`document_sender_not_peer`): `cello-client/core/daemon/src/document-inbound.ts`
- M14 findings record co-authored with CELLO_Coder_1: shared document `9801638f…`, sealed session
  `507c3c13…`

---

## Related Documents

- [[2026-05-08_1612_shared-state-as-protocol-primitive|Shared State as Protocol Primitive]] —
  the origin of the goal/spine vision, and where `field-level-authority` was first named. This
  log is the measurement of what the pipeline built from that vision actually produces, and
  finds field authority still declared-but-unenforced
- [[2026-07-31_federated-collaborative-state-architecture|Federated Collaborative State
  Architecture]] — the design this assesses the output against; its pairwise scope (§11.1) is
  what makes an eight-actor spine unrepresentable today, and its multi-party deferral is the
  "multi-sharing" gap recorded here
- [[M14-DEFINITION-OF-DONE|M14 Definition of Done]] — carries the "two agents setting different
  fields produce disjoint operations" claim that was true only at depth 1 until the recursive
  merge shipped in daemon 0.0.154
- [[2026-08-05_1230_document-screening-convergence-and-content-profiles|Document Screening,
  Convergence and Content Profiles]] — the screening design whose outbound guard produced two
  false positives during this session, including redacting a CELLO pubkey as a generic API key
- [[2026-08-10_2116_multiplayer-artifacts-joining-an-existing-document|Multiplayer Artifacts —
  Letting a Third Party Join an Existing Document]] — the "multi-sharing" gap recorded here,
  taken up as a design decision the same day: an eight-actor spine needs eight seats, and this
  log's finding that pairwise scope makes it unrepresentable is cited there as evidence
