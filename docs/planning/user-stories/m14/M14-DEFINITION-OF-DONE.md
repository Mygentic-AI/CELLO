---
name: M14 Federated Collaborative State V1 Definition of Done
type: definition-of-done
date: 2026-08-04
milestone: M14
status: open
topics: [m14, collaborative-state, crdt, yjs, documents, leaf-types, delivery, validation, cello-client]
description: >
  The yardstick for M14 — federated collaborative documents, V1 (Tier 1, authenticated): the
  0x04/0x05 leaves, the SQLCipher document store, the write path, the validation gate and
  supersession, the consent handshake, daemon-autonomous delivery, lifecycle verbs, and the five
  enforcers. Sole status authority. Spec-of-record is §16 of the 2026-07-31 federated
  collaborative state architecture log. V2 lives in M14B-DEFINITION-OF-DONE (parked).
---

# M14 — Definition of Done

## How to use this
- Find the lowest-numbered line not ✅ in the active tier — that is the next unit.
- **Evidence discipline:** a flipped tag carries ONE line of evidence plus `→ Journal Entry N`.
  Full run output lives in the journal. This document stays a scoreboard.
- **Five enforcers** (defined in [[M14-PROCEDURE]] §1c): convergence · offline-delivery ·
  rejection · append-only · write-path. A line naming an enforcer is ✅ only when that enforcer
  RAN as separate OS processes.
- Tier order is a dependency order, not a calendar. P0 before P1; P1 lines can interleave;
  P2 needs P1; P3 needs P2. **P4 needs P3's TOOLS-1 built LOCALLY in cello-client — not
  published**: the spine harness spawns the sibling checkout's `dist/` binaries, so the five
  enforcers can start the moment TOOLS-1 is code-complete, in parallel with SHIP-1's publish
  cascade (which serves operators and the live-fleet smoke, nothing else).
- **A 🅿️ line is not the next unit** — when the scan reaches one, move to the next ❌ line or
  tier (the park-and-move-on authorization is [[M14-PROCEDURE]] §3a; this sentence is here so a
  reader of this document alone doesn't stall on it).
- **P1 units consume STORE-1's data shapes, not P2's flows.** P1 is local-provable: its proofs
  seed and read the P0 store tables directly; the wire types and cross-daemon flows that
  populate them in production arrive in P2 and are proven end-to-end in P4.
- **The V2 boundary:** anything Tier-2-shaped (canonicalization, epochs beyond `epoch_id: 0`,
  quiescence agreement, purge, schema enforcement) belongs in [[M14B-DEFINITION-OF-DONE]], not
  here. If a unit is tempted to build it early, park it there instead.

## Repo Legend
| Tag | Local path | Notes |
|-----|-----------|-------|
| `cello-client` | `/Users/andrep/Documents/code/cello-client` | PRIMARY repo. Ships via `/cello-publish` (LOAD THE SKILL, every publish) — never `workspace:*`, never local `npm publish` |
| `trustless-cello` | `/Users/andrep/Documents/code/trustless-cello` | Relay/directory leaf handling, the five spine enforcers, these docs. Re-pins published cello-client semvers |

## Status legend
✅ PROVEN (enforcer-green where one is named) · 🟡 BUILT/UNVERIFIED-LIVE · 🟠 PARTIAL · ❌ NOT BUILT · 🅿️ PARKED

---

## Tier I — Invariants (properties, NOT deliverables — no status tags)

> Enforced per-unit as reviewer lenses — [[M14-PROCEDURE]] §2b, where every one has a lens that
> fires on every diff. Stated once here, untagged, because they are the yardstick's fine print.

- **NO-SILENT-DROP** [cello-client] — every path that declines an incoming update quarantines it
  and emits the rejection (`0x05` leaf + reason + policy record). No update is ever discarded,
  skipped, or "logged and ignored" — including on error paths. A silent drop diverges the two
  copies permanently and invisibly (§3.2).
- **INJECTION-BOUNDARY** [cello-client] — peer-controlled document content never enters the
  LLM's context by arriving; only by an explicit agent-initiated fetch. Notifications and diff
  stats are content-free.
- **LOG-INTEGRITY** [cello-client] — the envelope log is append-only (withdrawals and rejections
  are new records, never edits); per-sender `doc_prev_hash` chains verify; publish writes the
  envelope BEFORE any delivery attempt, and delivery state survives a daemon restart because it
  is derived from the log, never from memory (§14).
- **MECHANICAL-ADMISSION** [cello-client] — admission, merge, file rewrite, and delivery involve
  no LLM on either side. Convergence never depends on the receiving agent acting.
- **CONTENT-FREE-NOTIFICATION** [cello-client] — the pending notification carries `document_id`
  and nothing else; diff stats carry counts, ranges, and the overlap flag — no content.
- **SEAM** [cello-client, trustless-cello] — the V2 seam ships in V1: `assurance_tier` declared
  (only `authenticated` accepted), `schema_enforcement` declared (only `false` accepted),
  `epoch_id` (constant 0) + `doc_prev_hash` on every envelope, nullable payload column, unknown
  leaf types hashed as opaque bytes wherever verification walks a tree. Dropping a seam field
  "because V1 doesn't use it" is a blocking finding (§16.1).

---

## Tier P0 — Foundations (leaf types, hostile-input measurement, the store)

- **DOD-DOC-LEAF-1** [cello-client, trustless-cello] — the leaf-kind registry is centralized and
  gains `0x04` (document operation) and `0x05` (rejection). cello-client:
  `core/crypto/src/hashing.ts` adds the two constants + domain-separated hash fns beside
  `MSG_LEAF`/`CTRL_LEAF`; the `LeafInput` union in `core/crypto/src/merkle.ts` gains the kinds;
  `core/daemon/src/session-relay-client.ts` (`LEAF_KIND_*`) and `session-tree.ts`
  (`SessionTreeLeafKind`) extended; the `session_seal_leaves` / `session_tree_leaves` stores
  round-trip the new kinds (note: one stores INTEGER, the other TEXT — both covered).
  trustless-cello: the relay allow-list `relay-node.ts:1135` admits 0x04/0x05 and its guard test
  (`relay-node.test.ts` `it.each([0x01, 0x03, …])`) is AMENDED, not just extended;
  `seal-unilateral-verify.ts:75`'s unknown-byte→`"msg"` coercion becomes an explicit map that
  REJECTS unknown bytes (`unilateral_leaf_kind_unknown`); `directory-frames.ts:746` gains the
  range check; `verifySealLeaves` + `seal-legibility.ts` discriminate ceremony ctrl (`0x02`)
  from document leaves so a trailing 0x04/0x05 neither fails nor fakes a seal (the invariant
  comment at `seal-legibility.ts:110` names this exact future). Verifier tolerance (§16.7-10):
  tree rebuilds hash unrecognized kinds as opaque bytes rather than erroring. **Wire-batching
  AC:** relay/directory changes deploy BEFORE or WITH the first published client that submits a
  0x04 leaf ([[M14-PROCEDURE]] §2c). Version-bump ACs: crypto/protocol-types/daemon published
  via `/cello-publish`; trustless-cello re-pinned. — ✅
  > Both repos green; two review passes (the cap), 4 blocking findings fixed. Published +
  > promoted: crypto 0.0.39 · protocol-types 0.0.41 · transport 0.0.43 · daemon 0.0.120 ·
  > cli 0.0.123 · connect 0.0.117. → Journal Entries 1–6.
- **DOD-DOC-FUZZ-1** [cello-client] — the Yjs hostile-input fuzz pass (§16.7-7 precondition):
  garbage bytes, truncated updates, and pathological-structure updates against `Y.applyUpdate`
  under the planned pre-parse size cap; failure modes recorded in the journal (crash? throw?
  hang? memory?); any guard the findings motivate becomes an AC on DOD-DOC-GATE-1. Also records
  the Yjs dependency facts once: pure-JS confirmed, install cost stated (heavy-local-node
  doctrine). — ✅
  > Measured, not assumed: the ACCEPT class (not the throw class) is what defeats §16.7-7 —
  > six accept-class shapes found, all now ACs (a)–(i) on GATE-1. Two review passes.
  > → Journal Entries 7–9.
- **DOD-DOC-STORE-1** [cello-client] — the SQLCipher document store (§16.7-12), its own store
  module following the existing idempotent-DDL pattern (no `node:sqlite`, ever): `documents`
  (document_id, peer `agent_id`, properties, status), `document_envelopes` (append-only:
  hash, signature, `doc_prev_hash`, `epoch_id`, state vector, payload NULLABLE; withdrawal and
  rejection records live here as rows, never edits), `document_snapshots` (Yjs binary + state
  vector + last-applied envelope index). Keyed on `agent_id`/`document_id` only — `agent_name`
  appears nowhere. **The snapshot is rebuildable from the log**, proven by a test that deletes
  the snapshot, rebuilds, and gets byte-identical Yjs state + state vector. Per-sender chain
  verification on read. — ✅
  > Three tables, append-only log, reachability-verified chain on the read path. Two review
  > passes; 5 blocking findings fixed. **Scope limit:** proves the log is SUFFICIENT INPUT to
  > rebuild, not that the fold is correct — see ENGINE-1's added ACs. → Journal Entries 10–11.

## Tier P1 — The document engine (local-provable, no network)

- **DOD-DOC-ENGINE-1** [cello-client] — **carries three ACs from DOD-DOC-STORE-1's reviews:**
  (i) **byte-identical rebuild against a REAL `Y.Doc`** — STORE-1 proved the log is sufficient
  input using a concatenation stand-in, which is associative and order-only; Yjs merge is
  neither, so the property that can actually fail (that replaying in log order reconstructs the
  same CRDT state) is unproven until here.
  (ii) **CORRECTED 2026-08-04 — this AC was wrong as first written.** It said the engine must
  *exclude* a withdrawn update from the fold. §16.4 says the opposite: withdrawing "rolls the
  change back locally (Yjs undo) and writes a withdrawal record into the log beside the original
  envelope — marked withdrawn, never deleted, so the log stays intact", and rejection resolves by
  supersession, "inverses, not erasure" (§3.2). **A withdrawal record excludes NOTHING** — the
  undo is an ordinary update in the log and replay applies every payload in order. Exclusion is
  unsound in a CRDT log (measured: Yjs operations are causally chained, so dropping any but the
  last envelope makes the document permanently unrebuildable) and it hands any sender an erasure
  vector against any other's content, since nothing upstream validates authorship of a reference.
  (iii) it must call `verifyChainLinkage` (or `rebuildSnapshot`, which does) before trusting any
  materialized state; linkage verification checks no signature and no content hash.
  Plus the daemon's Y.Doc lifecycle: create from starting
  content, apply an update, compute an update against a peer state vector, snapshot/restore.
  The clientID rule (§14) pinned by a test: Yjs mints its own random clientID per live `Y.Doc`;
  nothing derives it from agent identity, nothing persists and restores one. Malformed-update
  handling per the fuzz findings: pre-parse size cap, wrapped apply, a bad update becomes a
  typed error, never a crash. — ✅
  > Two review passes. AC (ii) corrected mid-unit (a withdrawal excludes nothing); the trial
  > document is fresh per call, measured. → Journal Entries 12–13, 15.
- **DOD-DOC-WRITE-1** [cello-client] — **carries from ENGINE-1's reviews:** the engine exposes no
  delete/undo accessor, so §16.4's withdraw ("a Yjs undo") has nothing that PRODUCES an inverse
  update — the engine only proves replay applies whatever payload it is handed. Whichever unit
  ships `withdraw` must produce the inverse. Also: `applyUpdate` REFUSES an out-of-order update
  rather than buffering it (correct for replay, where a gap means corruption), so a live-receive
  path wanting buffer-and-re-request semantics needs its own entry point — do not route live
  receives through it without deciding that. — the write path (§16.2): each document materialized as a
  real file in a per-agent workspace directory; on publish the daemon diffs the file against the
  last-known projection and converts to Yjs operations (text diff for text types, key diff for
  JSON); on admission the daemon folds unpublished local file edits into the doc as local
  operations, merges the incoming update, rewrites the file, and computes the overlap flag
  (§4.1) from whether the merge touched regions holding unpublished local edits. Round-trip
  proven at unit level: edit → publish → apply on a second doc → materialize → identical
  content; concurrent edits on both docs → both converge → overlap flag true exactly when
  regions overlap. — ✅
  > Two review passes. Pass one: three measured routes to destroying the agent's unpublished
  > work. Pass two: my replacement diff CORRUPTED CONTENT on 4 of 6 ordinary edits — replaced
  > with a real line LCS. → Journal Entries 14, 16–18.
- **DOD-DOC-GATE-1** [cello-client] — the validation gate (§3.2, V1 rules): arrive →
  shadow-apply (the shadow document rebuilt from accepted state, never long-lived) → validate
  the PROJECTED DIFF → admit or quarantine. V1 rules at the hook: `append_only` (an update whose
  projected diff deletes or edits existing content is rejected — §16.7-1), receiver-local limits
  (max document/update size, nesting depth, update rate — defaults published, violations carry
  machine-readable reasons naming the limit and value, §16.7-6), and malformed-update rejection
  (per DOD-DOC-FUZZ-1's guards). A quarantined update is held, never admitted, never discarded.
  **Every error path in the gate quarantines + emits** — the no-silent-drop invariant is proven
  by tests that inject failures at each stage. The screening rule plugs into this same hook
  later (DOD-DOC-SCREEN-1) — the hook is built now, the rules are pluggable.
  **ACs measured by DOD-DOC-FUZZ-1 (§16.7-7's residual risk, now quantified) — the ACCEPT class,
  which "cap, catch, contain" does NOT catch because Yjs returns success:**
  (a) **unresolved dependencies** — phrase the rule against OBSERVABLE STATE, not the mechanism:
  a shadow apply must advance the document's state vector by exactly the structs the update
  declares, and any shortfall is a REJECTION (`document_update_unresolved_dependencies`);
  `doc.store.pendingStructs` is the mechanism to read it from, not the definition. Measured: 49
  well-formed sub-cap updates all accepted, zero content, retention GROWING with each — a peer
  streams these until the daemon dies and every leg of the posture passes them.
  **This AC does NOT cover clientID collision** (see (h)) — that shape leaves the pending set
  EMPTY, so a pending-set check alone would imply a completeness it does not have.
  (b) **document binding** — an update carries no document identity, so a valid update for a
  DIFFERENT document merges silently. Binding is out-of-band and the gate must enforce it.
  (c) **encoding version** — V2-format bytes are accepted by the v1 decoder and silently drop all
  content. Pin the version (§16.7-8) and refuse a mismatch.
  (d) **trailing bytes** — ignored by the decoder, so the encoding is MALLEABLE: unlimited byte
  strings map to identical state. Reject bytes after the decoder's cursor, and hash the
  re-encoded shadow state rather than the received bytes (this is why a 0x04 leaf over raw
  received bytes is not a canonical commitment).
  (e) **a size FLOOR, not just a cap** — an empty or 1-byte update throws a lib0 decoder string;
  the minimum valid update is 2 bytes.
  (f) **an explicit nesting-depth limit** — Yjs does not bound depth at all, and the size cap
  bounds it poorly: **~16 bytes/level, so ~65,000 levels fit in 1 MiB.** (Corrected 2026-08-04:
  the earlier "~12 B/level, ~87k" came from a document with a pinned 1-byte clientID. Update
  size depends on the clientID's varint width, and Yjs mints a random uint32, so the 5-byte case
  is what production always sees. Choose the default against 16 B/level.)
  (g) **one typed reason for every Yjs throw**, carrying the decoder string as detail — never
  surfacing `Unexpected end of array` / `Integer out of Range` as the reason.
  (h) **clientID binding** — Yjs identifies authorship by clientID alone, so a colliding clientID
  silently wins and the honest client's real update is then accepted-and-dropped, leaving the
  document a SPLICE of two authors who never collaborated, with an EMPTY pending set and no
  error on any path. The clientID observed in an update must be bound to the peer's identity
  out of band; no property of the update itself can establish it.
  (i) **`append_only` needs a measurement behind it** — a 10-byte well-formed update deletes a
  document's entire content. Structural limits are upper bounds, so a shrinking update passes
  every one of them and the shadow is merely smaller. — ✅
  > Two review passes, nine ACs enforced. Pass one built a WORKING FORGERY against (h); pass two
  > found (f) INVERTED — deeper meant safer. → Journal Entries 19–20.
- **DOD-DOC-REJECT-1** [cello-client] — **carries from GATE-1's reviews:** (1) the gate returns the
  quarantined BYTES on every refusal (`GateQuarantine.quarantined`, copied not aliased) — this unit
  is what persists them and references them from the `0x05` leaf; (2) rule (h) binds INSERTIONS
  only, because a Yjs delete set carries no clientID and advances no clock, so a BOUND peer can
  delete the owner's content and the gate sees nothing. That is legitimate CRDT behaviour for an
  authorized writer, not a forgery — but it means `append_only` is the only thing between a bound
  peer and erasure, and it DEFAULTS OFF. Decide explicitly whether erasure by a bound peer is a
  rejectable event, and journal it. — rejection and supersession (§3.2, §16.7-2): a rejection
  is a protocol message AND a `0x05` leaf referencing the rejected envelope's hash; the sender's
  daemon rolls back (Yjs undo — inverses, not erasure) and publishes the superseding update
  computed against the receiver's state vector; the receiver validates the now-clean projected
  diff, admits, clears quarantine. **One retry, then stalled:** a rejected supersession gets one
  more round; after that the document flips to `stalled`, the receiver stops accepting updates
  on it, and both sides surface the reason. Rejections land in the policy log with reasons on
  BOTH sides — the routing (gateway record store's `source` discriminator vs a daemon-side
  write) is resolved in-unit and journaled. Mutual concurrent rejections covered by test (each
  direction independent; state vectors prevent deadlock). **Scope note (ordering):** this P1
  unit builds and proves the protocol against STORE-1's local envelope-log representation —
  seed rows, roll back, re-publish against the store; the CBOR wire encoding is ENVELOPE-1's
  job (P2) and the cross-daemon proof is E2E-REJECT-1's (P4). Do not build ENVELOPE-1's
  machinery here. — ✅ (two review passes; §9's effectiveness rule found unsound as written and
  superseded by measurement — a refusal is realized by never writing the refused payload, not by
  subtracting it at replay; both open decisions journaled in Entry 21)
- **DOD-DOC-PROFILE-1** [cello-client] — **the content profile: an allowlist, agreed at the
  handshake** (§16.7-15). Named and closed — `ascii-text`, `ascii-markdown`, `json`,
  `unicode-markdown`, `unicode-text` — each defined as an explicit **codepoint set, not an
  adjective**, because a profile enforced by a heuristic is a promise we do not keep. Rides in the
  signed proposal `properties`, so it is bound into `document_id` and immutable after accept; the
  create flow must make the choice legible rather than defaulting silently, since an upgrade is a
  new document. Enforced in BOTH places for different reasons (§16.7-14): at authoring, so a stray
  character is caught where it was written and never becomes a rejection round — ergonomics; and at
  receipt, because the sender's enforcement is unverifiable — security. Distinct from
  `schema_enforcement` (structure); this is the character space. Also makes the `json` diff correct
  by declaration instead of by inference. — ⏳ **THE WIRE SLOT SHIPPED 2026-08-06** (`834079f`),
  inert; the named codepoint sets and enforcement are not built.

  `content_profile` now occupies a slot in the SIGNED proposal preimage, so it is bound into
  `document_id` and immutable after accept — which is what makes "agreed at the handshake" mean
  anything. Landed now because the only moment that rebinding is free is before anyone holds a
  document they care about: M14 shipped today, to one operator, with no documents in existence.

  **The split was deliberate and the ordering argued:** enforcing a profile the wire cannot carry is
  unimplementable, while a slot with no enforcement is inert and clearly marked. The failure mode
  being steered around is a profile field that sits unenforced and reads as done in every review —
  the same shape as the three frames this milestone shipped with no producer.

  The frozen-vector test fired on the id change, which was the correct outcome. Reissued with a note
  that a third failure, after real documents exist, is a MIGRATION rather than a reissue.
- **DOD-DOC-SCREEN-1** [cello-client] — **screening REFUSES, never mutates** (§16.7-13). Inbound
  document updates converge byte-identically or are refused; the receiver never rewrites. The audit
  that settled this ran on 2026-08-05: six of eighteen realistic document samples had their text
  silently rewritten, which for a CRDT is permanent divergence rather than a false positive — and
  the projection-screening alternative breaks on write-back, propagating the receiver's local policy
  into the sender's document as a real edit that deletes their content.
  A refusal carries a **machine-readable reason** (rule id, codepoints, count, offsets) and the
  default resolution is that the **sender adopts the receiver's rule for this document** (§16.7-16)
  — rules compose toward strict, nobody is asked to accept less protection, and the character stops
  being emitted at the source. The ambiguous band defaults to **refuse, not ask** (§16.7-18).
  The sender-side ADVISORY scan (§16.6) runs the sender's own policy against the outbound diff at
  publish — friction reduction among good actors, never a boundary; the receiver's gate stays
  authoritative. — ⏳ **THE RECEIVER-SIDE GATE SHIPPED 2026-08-06** (`834079f`); the sender-side
  advisory scan and sender-adopts-rule are not built.

  `document-screen.ts`, registered on `DocumentGate` at construction. Refuses bidi overrides and
  isolates (what an operator READS differs from what the document SAYS — a signature on content the
  signer did not see), chat-template control markers (they address the reader's MODEL, not the
  reader), and zero-width space (it joins nothing; it can only hide a boundary).

  **What it does NOT refuse is as much the claim:** zero-width joiners, full-width forms, ligatures,
  typographic punctuation, combining marks. Every one is legitimate text in some language, and the
  audit is what happens when that goes unasked. The e2e test asserts the samples that were silently
  rewritten now converge BYTE-IDENTICALLY between two real daemons.

  Refusals carry rule id, every distinct codepoint, a count and code-point offsets — every offender,
  not just the first, because one round trip per character would be a rejection round each and the
  protocol stalls at three.

  Registered at construction rather than left to a caller, for the reason this milestone learned
  four times: a unit with no caller reads exactly like a working one. Proven end to end by a real
  peer's override being refused with the operator's copy untouched.

  **Still owed:** the sender-side advisory scan at publish (§16.6 — friction reduction among good
  actors, never a boundary), and sender-adopts-the-receiver's-rule (§16.7-16).
- **DOD-DOC-REBUTTAL-1** [cello-client] — **the tail: a rebuttal is DATA, never argument**
  (§16.7-17). For the residual case where a character is load-bearing for meaning. Structured
  evidence only (rule id, codepoints, positions, the marked diff); any free text is presented to the
  agent as quoted untrusted content, never as instruction — this is counterparty content arguing
  that the receiver should lower its defences, the most attacker-favourable surface in the protocol.
  Adjudicated mainly by **script coherence**, which is computable from the document rather than
  assertable by the sender. Exceptions scoped to `(document, rule, codepoint set)`, never widening a
  rule; signed, logged, listed in status, revocable; **granting is not admitting** — the sender
  republishes through the gate. A rebuttal must NOT count against REJECT-1's stall ceiling.
  **CAN SLIP PAST V1** (Andre, 2026-08-05): without it a genuinely multilingual document fails
  closed and the operator resolves it by hand — worse ergonomics, identical security. PROFILE-1 and
  SCREEN-1 cannot slip; without them there is no screening. — ❌
- **DOD-DOC-ENVELOPE-1** [cello-client] — **carries BLOCKING ACs from DOD-DOC-GATE-1's reviews.**
  The gate enforces three bindings that no property of an update's bytes can establish, so each is
  only as trustworthy as the signature covering it. **All three MUST be inside the signed TBS:**
  (1) `document_id` — an update carries no document identity, so a well-formed update built on
  another document merges silently;
  (2) the **update encoding** — v2 bytes are accepted by the v1 decoder and silently drop all
  content, and it cannot be sniffed (a v2 update begins `[0,0,…]`, a legitimate pure-delete v1
  delta begins `[0,1,…]`, so a first-byte heuristic refuses real deletions);
  (3) the **sender's clientID** — authorship in Yjs IS the clientID, and the gate refuses any
  client whose clock advances without being bound to the sender. **Without (3) in the envelope the
  binding cannot survive an honest peer restart**, because §14 requires that nothing persists a
  clientID — a restarted peer mints a fresh one and would be refused forever. The gate's rule is
  correct only if the binding is LEARNABLE, and the envelope is where it is learned.
  — the document UPDATE envelope (§14) — a distinct wire
  type from HANDSHAKE-1's PROPOSAL envelope (whose hash mints `document_id`); the two share the
  word, not the shape: beyond the standard
  message envelope — `document_id`, `epoch_id` (constant 0, NOT omitted), `doc_prev_hash` (the
  per-sender chain link), the sender's Yjs state vector, the update payload. Types in
  `core/protocol-types`, CBOR round-trip tests, chain verification on receive (a broken or
  missing `doc_prev_hash` refuses loudly, naming the gap). **The Yjs update-encoding version is
  pinned** in the protocol types (§16.7-8) so two supporting clients can never disagree
  silently. Seam fields get serialization tests in lieu of a consumer ([[M14-PROCEDURE]] §5
  no-consumer exception). Replay defined set-based per §16.7-5. — ✅ (two review passes; all three
  inherited blocking ACs verified inside the signed TBS by revert, with a frozen conformance vector
  pinning field order and the receive-time chain check taken set-based so a redelivery is not a
  fork alarm and a BRANCH is distinguishable from a GAP)
- **DOD-DOC-DELIVERY-1** [cello-client] — daemon-autonomous delivery (§16.4): publish writes the
  envelope to the log and returns; the delivery worker derives pending = unacknowledged
  envelopes FROM THE LOG (survives restart — enforcer-pinned), checks the peer via
  `discovery_lookup` before dialing (there is no presence subscription today — the worker
  schedules retries on a slow capped backoff; a directory-side subscription is parked, M14-P4),
  and delivers over a session it opens or reuses itself — **the first non-handler consumer of
  `SessionNegotiator`** — with zero agent attention on either end, sealing normally.
  `publish` accepts an optional session hint (§16.4); omitted, the daemon uses the most recent
  active session or opens one. Every attempt and every autonomous session is logged
  (`document.delivery.*`). Ack = the peer's daemon confirms admission (or rejection — a `0x05`
  is also an ack for delivery purposes; supersession is DOD-DOC-REJECT-1's job).

  **SPLIT, 2026-08-05 (review pass one).** The line as written bundles two risks: the scheduling and
  bookkeeping, and the first non-handler consumer of `SessionNegotiator`. They were built behind an
  injected transport seam, which is the right SHAPE but leaves the second risk entirely undone —
  nothing implements the interface, so the worker is a class the daemon never instantiates. Flipping
  this line ✅ would claim a `SessionNegotiator` consumer that does not exist, and
  [[M14-PROCEDURE]] §5's no-consumer exception does not cover it (that exception is scoped to the
  five seam fields whose consumer is M14B by design, not to a whole unit).
  - **DOD-DOC-DELIVERY-1** — the worker: pending derived from the log, restart-survival, the
    reachability check, the capped backoff, ack-including-rejection, the re-entry guard, correlation
    IDs, and `document.delivery.*`. — ✅ (one review pass; the no-peer branch was a hot loop that
    could starve every other document, and a rejection was not treated as an ack)
  - **DOD-DOC-DELIVERY-2** — the transport adapter and the wiring: a `DocumentDeliveryTransport`
    backed by `SessionNegotiator` (opening or reusing a session, and SEALING normally), the
    `discovery_lookup` binding for `isPeerReachable`, the composition-root instantiation, the tick
    scheduler, and `publish`'s own optional session hint.
    — ⏳ **the adapter and the discovery binding are built and tested** (session reuse-before-open,
    hint honoured-or-refused, and the `discovery_lookup` mapping where only a RESULT is an answer
    about the peer — every other outcome throws rather than being called "offline"). Remaining: the
    composition-root instantiation and the tick scheduler.
    **UNBLOCKED AND WIRED, 2026-08-05.** `openSessionAs` was extracted from the
    `cello_initiate_session` handler — the split is at the connection boundary, so one
    implementation serves both callers rather than a second copy drifting on the transport mode,
    the signed assignment and the counterparty binding. The transport is built PER AGENT (every
    capability underneath is: the signaling stream, the sessions, the signing), reuses
    `runDiscoveryLookup` rather than reimplementing the 3-state answer, and seals only sessions it
    opened. The sweep is a slow 60s interval — the event actually being waited for, the peer coming
    back, is not one this daemon observes — with no-overlap and whole-sweep containment guards, an
    unref'd timer, and teardown before the rest of `stop`.
    **Reviewed 2026-08-05 (`f7c1577`), and the wiring did not work.** Three blocking findings, two
    of which made the sweep a guaranteed no-op: the inbound router was scoped by the daemon's agent
    NAME while the sweep queried by pubkey hex, so nothing either wrote was visible to the other and
    every query returned empty with no error on any path; and the sweep called the session opener
    with `{ pubkey }` when the negotiator reads only `target_pubkey`, so the REUSE path worked and
    the OPEN path never did — delivery appearing to work in exactly the case a developer tests by
    hand. The third finding is why the first two were silent: a sweep delivering nothing was
    byte-for-byte identical to a healthy idle one. All three fixed; there is now ONE owner-key
    resolver used by both halves, an `openSessionFor` that makes the wrong field name
    unrepresentable, and one log line per tick with the counts.
    **Remaining: nothing on this line but a live smoke.** What follows was the blocker, kept for the
    record:
    ~~BLOCKED, 2026-08-05, on one missing capability: AUTONOMOUS SESSION OPENING.~~ §16.4's whole
    premise is that the daemon opens a session with no agent attention on either end — but the
    initiate path exists only as an IPC handler (`initiate-session-handler.ts`), driven by
    `cello_initiate_session`. There is no function a worker can call. `runDiscoveryLookup` is now
    exported for the reachability half, and `sendContent` and the session lookup are already
    reachable, so what is missing is precisely the open.
    I wired the transport with `openSession` stubbed to a refusal and a worker that was constructed
    and never ticked, looked at it, and reverted it: a delivery layer that cannot open a session and
    is never run is theater. Extracting the initiate path into a callable — separate from its
    handler, the way `runDiscoveryLookup` now is — is the next piece of work on this line.
    **ORDERING CONSTRAINT — read this before wiring.** Do not wire the delivery worker into the
    composition root before DOD-DOC-INBOUND-1 is wired on BOTH sides. Until a peer can ack, every
    published envelope is sent, never answered, re-sent on the ack timeout, and stalls its document
    at the unacked ceiling — so wiring delivery alone ships a feature that fails by construction,
    and each resend appends a leaf to the peer's sealed conversation record. The two go in
    together.
    **Discovered dependency — DOD-DOC-INBOUND-1 (new, below):** this line's ack is "the peer's
    daemon confirms admission (or rejection)", and no inbound document handler exists, so no send
    can honestly produce one. Rather than synthesise an ack (marking an envelope acknowledged while
    the peer may never have applied it) or report a successful send as a failure (re-sending content
    already in flight), the transport outcome is three-valued: `admitted: null` means SENT, not
    acked, and the worker records it delivered, leaves it unacked, and asks again on the backoff.
  - **DOD-DOC-INBOUND-1** — the receiving half: a document frame handler on the session channel that
    decodes the envelope (ENVELOPE-1), verifies the signature and the chain link, runs the §3.2 gate
    (GATE-1), admits or rejects (REJECT-1), and returns the ACK that closes DELIVERY-2's loop. Every
    P2 unit has been building the pieces this assembles, and no line owned assembling them. Named
    rather than folded into DELIVERY-2, because that is the same mistake the original DELIVERY line
    made — bundling a second risk into a line whose name describes the first.
    **SPLIT, 2026-08-05 (review pass one), for the same reason DELIVERY was split.**
    - **DOD-DOC-INBOUND-1** — the assembly: decode, document-known, sender-is-peer, verify, chain,
      gate, admit-or-reject, with the ordering as the security property. — ✅ (one review pass;
      three of the seven steps were wired to inputs nobody produced — `append_only` came from a
      caller option defaulting OFF over the agreed property, the clientID binding was a seam with no
      implementation, and a redelivered REJECTION advanced the retry round, so a peer whose acks
      were being lost stalled the shared document in three attempts)
    - **DOD-DOC-INBOUND-2** — the frame handler on the session channel, the ACK wire type that
      closes DELIVERY-2's loop, and the composition-root wiring. `DocumentInbound.receive` returns a
      JS object to a caller that does not exist yet, so DELIVERY-2's `admitted: null` stays null
      forever until this lands.
      **Built so far:** the ACK wire type and its consumer (both reviewed), the frame router (two
      passes — a 2-byte frame could stall or OOM the daemon; bound at the decoder plus an input-length
      cap), and the interception point in the session content path. **Remaining: the
      composition-root wiring**, which goes in with DELIVERY-2's.
      **The interception's three-way contract — `doc` leaf yes, transcript no, doorbell no — is
      deliberately NOT unit-tested.** It is about what lands in the tree, the transcript and the
      doorbell for a real frame on a real session, and [[DOD-DOC-E2E-CONV-1]] already specifies it:
      "session seals with mixed `0x00`/`0x02`/`0x04` leaves and BOTH sides independently recompute
      the same root". Proven there, stated here so it is a dependency rather than a gap.
      **BLOCKED ON A DESIGN SEAM, found while wiring (2026-08-05) — this is the next thing to
      decide.** `DocumentInbound.receive` is SYNCHRONOUS, and a gate refusal calls
      `DocumentRejections.reject`, which requires a real signature (REJECT-1 refuses to fabricate
      one — an all-zero placeholder in an immutable log is indistinguishable from a real signature
      that fails to verify). But signing goes through `KeyProvider.sign`, which is **async**.
      I wrote the composition-root call with a `crypto()` that throws, saw that it makes a gate
      refusal fail to record and leaves the peer with no answer, and REVERTED it rather than ship
      it — that is exactly the half-wiring `document-layer.ts` says it forbids, arriving through the
      error path.
      Three ways out, none obviously right, and picking one is a design decision rather than
      plumbing: (a) make the inbound path async — everything calling it already is, but it changes
      the router, both inbound units and their tests; (b) pre-sign the rejection before entering the
      sync path, which means knowing the refusal before the gate has run; (c) give the layer a
      SYNCHRONOUS signer — Ed25519 signing is sync underneath and only `KeyProvider` wraps it in a
      Promise — which means the layer holds or reaches key material.
      **RESOLVED, 2026-08-05 (§3a).** The router now splits SYNCHRONOUS classification — which is
      all the session path needs inline, to pick a leaf kind — from ASYNCHRONOUS handling, dispatched
      on a per-owner promise queue. Serialized because the chain check is order-dependent even though
      Yjs is not: an envelope's `doc_prev_hash` must find its predecessor already stored, so two
      frames handled concurrently can have the second refuse with `document_chain_broken` purely
      because the first has not finished writing — a self-inflicted fork that reads as a peer fault.
      `DocumentInbound.receive` and the rejection `crypto()` seam are async now.

      **STILL BLOCKED, on a deeper gap found immediately after — DOD-DOC-REJECT-2 (new, below).**
      With the async seam open I wrote the composition-root signer and it was FABRICATED CRYPTO
      wearing a real signature: it signed an empty buffer with whichever key provider happened to be
      first in a map, because `crypto()` takes no arguments (so it cannot know the OWNER agent) and
      **nothing anywhere defines what a rejection signature is over**. `RejectionInput.signature` is
      required — REJECT-1 rightly refuses a placeholder — but there is no rejection TBS. Reverted
      rather than shipped. — ❌
  - **DOD-DOC-REJECT-2** — the rejection's signed preimage. A `0x05` leaf carries a signature and
    no canonical to-be-signed structure exists for it, so the field can only be filled dishonestly.
    Needs: a `CELLO-DOCUMENT-REJECTION-v1` TBS binding the document, the rejected envelope hash, the
    reason and the rejecting agent (the same shape the update, proposal and ack envelopes already
    use, with a frozen vector); `crypto()` taking the owner agent so it signs with the right key;
    and the wire type so a rejection reaches the peer at all rather than only the local log. Until
    this lands, the composition root cannot honestly supply a signer and INBOUND-2 cannot be
    wired. — ❌
- **DOD-DOC-LIFECYCLE-1** [cello-client] — the verbs (§3.5 + §16.4): **list** (documents with
  peer, type, tier, epoch, status, pending-delivery state — tier and epoch are constants in V1
  but they are seam surface and cheap to show — "1 update pending, peer offline since …");
  **close** (bilateral: mutual close acks over the session, document marked complete —
  the V1 shape; the Tier-2 quiescence agreement at close is M14B's addition); **kill**
  (unilateral: stop accepting and publishing, notify the peer, retain local copy and log —
  stated plainly: the peer keeps what it holds); **withdraw** (an UNDELIVERED update only:
  local rollback + a withdrawal record beside the original envelope — marked, never deleted;
  the sender's file reverts). Kill-switch interplay (§16.7-11): a platform-paused agent refuses
  outbound publishes loudly, still admits incoming mechanically, suppresses notifications;
  unpause resumes — pinned by test. — ✅ (one review pass; withdraw performed NO local rollback and
  its record broke the peer's chain — the record now lives in its own table and the rollback is a
  required injected callback that refuses rather than reporting success. Carried to a later unit:
  `list` shows a pending COUNT but no "peer offline since" surface, and that count is capped by
  `pendingDeliveries`' row limit across all documents — it needs a dedicated GROUP BY.)
- **DOD-DOC-NOTIFY-1** [cello-client] — passive notification (§16.5): a new derived section in
  the inbox aggregation backed by its own table + getter (the `contact_rename_notices`
  precedent — there is no inbox store, the inbox is computed per call), carrying `document_id`
  and pending-count only; cleared by the agent's explicit fetch. **No doorbell fires on a
  document update** (§11.3 — doorbell-on-update is parked, M14-P3). The two read calls (§4.1):
  **diff stats** (structural counts + line/key ranges + the overlap flag — no content) and
  **diff** (the git-like diff itself, an ordinary screened read). Supported document types for
  the diff call decided and recorded in-unit (Markdown, plain text, JSON at minimum). — ✅ (one
  review pass; both diff surfaces moved onto ONE shared line LCS after the positional walk was
  measured wrong for every insertion and deletion. Carried to DOD-DOC-TOOLS-1: the notice section
  is not yet wired into the inbox aggregation — the table and getter exist and nothing calls them,
  the same shape as the DELIVERY split.)

## The stubbed round trip — what is proven without a live transport

`core/daemon/src/__tests__/document-roundtrip.test.ts` (2026-08-05). Two parties, two databases, two
real Ed25519 keys, nothing shared but the wire. Not the live enforcer — no transport, no session, no
seal ([[DOD-DOC-E2E-CONV-1]] owns those with two real daemons) — but everything between a proposal
and a materialized edit, through the composed layer and the real delivery worker:

- **handshake** — A signs a proposal, B accepts, both mint the same `document_id` computed
  independently and never transmitted; a proposal signed by someone other than its named proposer is
  refused;
- **publish → deliver → admit** — through `DocumentDelivery` and the real transport adapter, with the
  peer's actual inbound verdict coming back as the ack;
- **convergence** — concurrent edits from both sides end as the SAME text on both;
- **refusals** — a tampered payload and a perfectly-signed envelope from a third party;
- **an unreachable peer** costs a lookup and not a dial, and the envelope is still there when they
  return;
- **a lost ack** re-sends on the ack timeout and the peer holds the envelope once;
- **restart** — the receiving side survives losing its live document.

It found three bugs no per-unit test could, because each of those stubs whatever it does not own:
`pendingDeliveries` scoped by the owner key while envelopes are authored under the wire sender id
(so every published update sat in the log undelivered); publish diffing against our own snapshot
rather than the peer's state vector; and the working document having to BE the live document.

## Tier P3 — Tool surface, templates, ship

- **DOD-DOC-TOOLS-1** [cello-client] — the `cello_doc_*` tool surface, registered in ALL FOUR
  lockstep places (`core/adapter-claude-code/src/bin/cello-mcp.ts`, the daemon IPC handler map,
  `core/daemon/src/vocabulary.ts`, the CLI registry/parity surface): create, list, status,
  publish (with optional session hint), diff-stats, diff, read, withdraw, close, kill, and the
  consent accept/refuse pair. Tool descriptions carry the injection-boundary guidance (fetch is
  deliberate; notification is content-free). CLI parity proven the way the existing parity
  tests prove it.
  — ⏳ **SEVEN VERBS SHIPPED, 2026-08-05** (`567a6c6`), unreviewed as of writing:
  `propose`, `inbox`, `accept`, `refuse`, `list`, `read`, `write` — across all four surfaces, with
  `document-handlers.test.ts` as the reachability proof.

  **This line was the reason nothing worked.** Nothing in production called `store.createDocument`,
  so no document existed, so the delivery sweep swept nothing and the inbound path never had
  anything addressed to it. Every unit under this was built, tested, and unreachable — which reads
  exactly like a working layer. Found by grep, not by a failing test, because there is no test that
  can fail for "the only caller is a fixture".

  **Three decisions taken while building it, all of which change the spec:**

  - **`propose`/`accept` are separate verbs, and consent is never inferred.** A document is a
    STANDING agreement to apply a counterparty's signed operations to local state — a larger grant
    than receiving a message. Accepting creates the document row in the same act, because the
    alternative leaves the operator having consented to something that does not exist and the
    peer's first update refused as `document_unknown`.
  - **`write` takes the COMPLETE text, never a patch.** An agent emitting a patch must be right
    about offsets in a document its peer is concurrently editing, and a wrong offset in a CRDT is
    not a rejected patch — it is a permanent corruption both sides converge on. A non-string is
    refused rather than coerced (`content: 42` would otherwise replace the document with `"42"` and
    publish that as a legitimate signed edit).
  - **A failed proposal is recoverable.** The proposer kept no copy of the envelope it sent, so an
    offline peer left a real local document with no way to reach them: re-proposing mints a new
    nonce, hence a new `document_id`, hence a SECOND document, orphaning the first. The proposer now
    stores its own proposal (`DocumentHandshake.recordOutgoing`) and `cello_doc_propose` with a
    `document_id` re-sends those exact bytes.

  **The vocabulary guard earned its keep twice** and is worth keeping in mind for every future
  surface: it refused the names until handlers existed behind them on all four surfaces, and it
  caught guidance naming `cello_doc_propose_retry` and `cello_doc_kill`, neither of which existed.
  That second catch was not a wording slip — it was the dead end above, surfaced by a test that only
  reads strings.

  **Reviewed 2026-08-05. TWO BLOCKING FINDINGS, both confirmed by measurement, both fixed.**

  - **The seven verbs were not dispatchable.** `renderedHandlers` was a SNAPSHOT copy of the handler
    map; the document registration landed 245 lines below it and after `ipcServer.start()`. Every
    `cello_doc_*` verb answered `method_not_found`, whose guidance blames version skew between the
    shim and the daemon — so an operator would re-pin, reinstall, restart, and find both sides
    matching. The same class as the defect this line exists to fix, arriving one layer lower.
    Nothing could catch it: the handler test builds its own `Map`, and the capability guard scans
    source text for `handlers.set(...)` without knowing which map. Fixed structurally — dispatch
    resolves from `handlers` when a request arrives, so registration order stops being expressible
    as a bug. New `document-dispatch-reachability.test.ts` goes through the SOCKET, driven from the
    vocabulary table, and is the only assertion in the suite that can tell *registered* from
    *dispatchable*.
  - **`write` concatenated the two documents.** `delete(0,len); insert(0,content)` deletes only the
    items THIS side has seen, so a peer's concurrently-inserted items survive and splice into the
    new text. Measured: both sides replacing `"original"` with `"AAA"`/`"BBB"` converge on
    **`"AAABBB"` on both sides** — the ordinary case for an API whose contract is "send back the
    complete text", signed and published by both parties. That is the exact permanent corruption the
    whole-text contract was chosen to avoid; the mechanism moved and the failure did not. The
    correct fold already existed in `DocumentWritePath.#foldText`, whose header records the same
    hazard for the file path. Both now use `lineHunks`.

  Also fixed: `deliver` walked away from a session it had just opened when the send failed (a live
  node the operator never started, no sealed record — what the seal exists to prevent), and
  `cello_doc_list` could not tell "they refused" from "they are asleep".

  **CLOSED 2026-08-05 — the proposal ACK shipped.** A protocol that asks for consent and never
  reports the answer is not asking, it is announcing. `document_proposal_ack` is its own signed
  frame (not an overload of `document_ack`, which settles an ENVELOPE by its hash in the log — a
  proposal is not in the log, so that frame would carry a hash of nothing and its consumer looks the
  envelope up). Verified against the agent it names before anything is written; settle-once, so a
  contradicting second answer is an error with both signatures retained. Sending is best-effort and
  the surface says so: consent is local and final the moment the operator makes it, and an
  unreachable counterparty must not get a veto over their choice. `cello_doc_list` now reports
  `peerAccepted` — a fact — alongside `peerHasPublished`, which answers the different question of
  whether anything has come back yet.

  **`cello_doc_diff` shipped 2026-08-05** (`6a1f6df`) — what changed since THIS agent last read it,
  which is also §16.7's review-before-you-build-on-it. Compares against a read mark stored as TEXT
  (a state vector answers a question about the CRDT; an agent about to build is asking one about the
  words), moved by `read` and never by an arriving update — marking on arrival would erase the very
  change the diff exists to show, at the moment it arrived. Never-read REFUSES rather than diffing
  against `""`, which would render a first look at a long document as an enormous change an agent
  then treats as what-just-arrived.

  **`close` / `kill` and the control frame shipped 2026-08-05** (`421c86e`). `notifyPeer` had
  nothing to send — no close/kill envelope existed, so `withdraw`/`close`/`kill` refused with
  `document_peer_notify_not_wired` and a peer never told kept publishing into a document that would
  never answer. `document_control` is one frame with a signed VERB rather than two types (identical
  routing, verification and settle-once rules on the receiving side; two decoders for one shape is
  how rules drift), refused by value on decode, and the receiving half checks the sender against the
  document's peer — there is a test where a third party signs a real kill for a document she is not
  part of and delivers it straight to the victim's inbound path.

  **CORRECTION to the note this line carried overnight.** It said three tests were failing because
  the bilateral CLOSE path did not settle. That was wrong, and the way it was wrong is the finding:
  the two-party fixture wired the injected `notifyPeer` seam to `async () => ({ ok: true })` — which
  reports success, sends nothing, and agrees with whatever the near side does. Kill "worked" on both
  sides of the assertion and on neither side of the wire, and I recorded a defect in a path that had
  none. Same shape as both DELIVERY-2 review findings: **a stub on the far side cannot disagree with
  you.** The construction moved into `document-control-notifier.ts`, built from one function by the
  daemon and the test alike; the test substitutes only the TRANSPORT. Reverted to
  report-success-send-nothing, all three go red.

  **`withdraw` is DELIBERATELY NOT SHIPPED in V1 — a triage call, not an oversight.**

  `withdraw` only ever applied to an UNDELIVERED envelope; a delivered one already refuses with
  "your peer holds it, publish a superseding update instead". For an undelivered one,
  `cello_doc_write` with the corrected full text produces the identical net effect in the identical
  number of calls — the operator's next publish carries the correction and the peer never saw
  either version.

  What it would cost to do properly is not small. A correct rollback cannot drop the withdrawn
  payload from the log — REJECT-1 measured that: everything causally after it stays pending forever
  and the document silently loses legitimate work. Nor can it rebuild-without-it, for the same
  reason one envelope down. It needs the write path to transact under a per-write ORIGIN, recorded
  on the envelope row, so a `Y.UndoManager` can invert exactly that transaction — a real change to
  how every write is applied, in service of a verb whose whole use case `write` already covers.

  The stub stays and stays refusing. `document_rollback_not_wired` is truthful, nothing in the four
  surfaces reaches it (there is no `cello_doc_withdraw` verb anywhere), and `DocumentLifecycle`
  refuses the whole withdrawal rather than recording one it did not perform — which was the point of
  making rollback a required callback in the first place.

  **`status` is subsumed** by `cello_doc_list`'s fields — `proposedByUs`, `peerAccepted`,
  `peerHasPublished`, `pendingSent`/`pendingUnsent`, `status`, `closePending`. A second verb
  returning the same row for one document is a second place for those fields to drift.
- **DOD-DOC-SKILL-1** [cello-client] — the plugin skill/template layer (§4.1's owed
  deliverable + §16.7-9): publish-on-intent guidance (batch like a commit, not a keystroke),
  the overlap-flag review behavior (review the merged projection before building on it), and
  the returning-collaborator rule (on returning to a document, re-read its conventions before
  writing). Ships in the plugin the way existing skills ship; audited as SHIPPING content
  (tarball, not source). — ✅ **2026-08-05** (`e29f498`), one review pass not yet run.

  `plugins/cello/skills/documents/SKILL.md`. All three owed behaviours are in it, plus the parts an
  agent actually gets wrong: accepting is a standing agreement and not an acknowledgement; the
  document is untrusted input exactly like a message, so instructions inside it are content to quote
  and never commands to obey; write the COMPLETE text, because a stale offset in a CRDT is a silent
  corruption both sides converge on. `cello_doc_diff` is framed as the injection-review tool as well
  as the merge-review one — it shows what was ADDED rather than a wall of text to skim.

  **The audit was the missing half, and it found a live defect.** `core/adapter-claude-code/SKILL.md`
  was checked (it rides in the connect tarball); `plugins/cello/skills/*` ship by CLONE — committing
  them is publishing them — and nothing looked at them at all. First run of the new guard:
  `skills/setup/SKILL.md` handed the operator `cello contact set-away <pubkey> "…"`, and the real
  shape is `cello contact <pubkey> set-away`. A command in a shipped skill that does not dispatch.

  Coverage is driven off the vocabulary, so an eleventh `cello_doc_*` verb fails the test until it
  is documented. The tool check is a DENYLIST — `vocabulary.ts` already explains that outside the
  daemon an allowlist drowns in false positives (`cello_session_id` is a parameter), and it did.
- **DOD-DOC-SHIP-1** [cello-client, trustless-cello] — the publish cascade: all changed packages
  published via `/cello-publish` (skill loaded, per publish), trustless-cello re-pinned, the
  plugin carrying tools + skills verified in the TARBALL, and a **live smoke on the real GCP
  fleet**: two real daemons on two machines (or two CELLO_DIRs), create → consent → edit →
  publish → deliver → converge → seal, with document leaves in the sealed tree and the seal
  verifying. **The publish gate — milestone close is P4 all-green, not this line.** Vitest
  green ≠ done. Andre runs the `latest` promotion. Close condition per M14-D2. — ❌

  **PUBLISHED 2026-08-06.** Branch merged to main, full cascade published on tag `v0.0.197`,
  `smoke-tag` green. Verified against the TARBALLS, not CI status: `daemon@0.0.133`'s dist carries
  `document-handlers.js` and `wire-content-hash.js`, `protocol-types@0.0.45` carries all three new
  frames, and the cross-pins are real versions (`cli` → `daemon@0.0.133`), never `workspace:*`.

  **Live on the operator's own daemon**: installed via `@latest`, `cello login` brought up both
  agents, and `cello doc list` / `cello doc inbox` return real answers — dispatch proven on the
  shipped binary, which is the one thing no test in either repo can prove.

  **`latest` promotion is PARTIAL and needs Andre's OTP.** connect 0.0.130, cli 0.0.136 and daemon
  0.0.133 — the three an operator installs by name — are on `latest`. crypto 0.0.41, transport
  0.0.47, protocol-types 0.0.45 and gateway 0.0.25 returned `EOTP`. They are transitive and `cli`
  pins `daemon` at an exact version which pins these exactly, so the operator install is correct
  today; promoting them keeps the `latest` graph consistent.

  **Two CI failures on the way, both mine, and the second is the lesson.** A bare
  `await documentDeliveryInFlight` in `stop()` blocked shutdown on the network; "fixing" it with
  `Promise.race([..., setTimeout(...).unref()])` was WORSE — an unref'd timer does not hold the event
  loop open, so during shutdown it may never fire and `stop()` hangs forever. The daemon's log ended
  at `daemon.started` with no shutdown events at all, and I read past that twice: **the diagnostic
  that mattered was the ABSENCE of a log line, not any line that was present.** Shutdown may not
  await anything that can block on I/O, and a timeout that can outlive the event loop is not a bound.

  Also found by the same builds: `classify` tried six decoders in sequence, so hostile bytes paid for
  all of them — 292ms → 60-81ms by decoding once and dispatching on the discriminator. That growth
  was invisible per-change and only surfaced when the DoS budget failed on a slower machine.

  **Remaining on this line:** the four OTP promotions, and the two-machine live smoke on the real
  fleet (the enforcers prove two real daemons, but on one host).

  **State surveyed 2026-08-05 (superseded by the above, kept for the version-cascade reasoning):**

  All M14 work is on branch `m14/reject-1` — **50 commits ahead of `origin/main`, 10 behind**. The
  merge comes first; the cascade is computed from MAIN's numbers, not this branch's.

  Local versions trail published for that reason, and this is expected on a branch, not a defect —
  recorded so nobody reads it as one and "fixes" it by bumping from the wrong base:

  | package | branch | published (beta = latest) |
  |---|---|---|
  | crypto | 0.0.40 | 0.0.40 |
  | protocol-types | 0.0.43 | 0.0.44 |
  | transport | 0.0.45 | 0.0.46 |
  | daemon | 0.0.122 | 0.0.124 |
  | cli | 0.0.125 | 0.0.127 |
  | connect | 0.0.119 | 0.0.121 |

  Highest existing tag is `v0.0.184`, so the next trigger tag is `v0.0.185` — and per the skill the
  tag counter is NOT the connect version; they have drifted before.

  **Changed on this branch and therefore in the cascade:** `protocol-types` (three new wire types —
  proposal ack, control, rejection envelope) and `daemon` (everything else). `cli` and `connect` are
  pulled in by the dependency rule whether or not their own source moved.

  **`@cello-protocol/client@0.0.50` is published and the package no longer exists in the tree** — it
  was deleted by the M6-era dead-code purge (`567b856`). It is not in the cascade and must not be
  resurrected into one; flagged because `/cello-publish` still lists seven packages including it.

## Merge with main — and the defect it created (2026-08-06)

`m14/reject-1` merged `origin/main` (33 commits). Five conflicts, all package.json VERSIONS — the
branch trails published because main moved ahead, exactly as the SHIP-1 survey predicted. Resolved
to MAIN's numbers, which is what the cascade must be computed from. Gate green, 3157 tests.

**Then the live enforcers found a defect neither branch had alone.** Two of the eight went red, and
they were precisely the two that assert a SEAL.

`#appendVerifiedContent` drops a content hash from `#witnessedSeq` once its leaf is appended. That
cleanup lives in the CONVERSATION branch; the document branch appends its `doc` leaf and returns
early, so every inbound document frame left a permanent entry behind. Harmless — until main's
`sealReadiness` (M12-P14) began deriving `missingLeaves` from the size of that map. From then on any
session that had carried document traffic refused to close with `session_incomplete`, whose only
escape is a force-abandon with no notarized receipt. Exactly the false positive that check's own
comment names as worse than the bug it guards.

Neither side was wrong alone: the document branch legitimately diverges from the conversation path,
and the readiness gate legitimately counts outstanding witnesses. The divergence carried one line
too far. Fixed in `d562b94`.

**All 3157 unit tests passed on the broken tree**, because none of them seals a session that carried
a document. The rule this hands forward: run the live enforcers immediately after any merge that
touches the session layer — a green unit suite says nothing about two features meeting.

## Open findings from the send-path analysis (2026-08-06)

A dedicated analysis of the session send path, run while chasing the sanitization bug, found several
defects that were NOT that bug. They are recorded here rather than folded into a story they do not
belong to. One is fixed; the rest are open and none is document-specific — they are on the ordinary
`cello_send` path.

- **FIXED (`f3387fc`)** — `delivered: true` was reported for a frame whose flush failed.
  `stream.close()` waits for the write buffer to drain, so a reset mid-flush throws there, and the
  error was swallowed. The park/relay backstop in the catch below exists for exactly a failed direct
  send, and swallowing routed around it.

- **OPEN — the content handler is registered only at `acceptSession`.** The standing receiver is
  created with no content protocol and an open gater, so an initiator's dial succeeds at the
  connection level before the responder can carry content. `cello_initiate_session` returning
  `ok: true` guarantees nothing about the responder; the directory pushes the assignment to the
  initiator FIRST and the responder's accept chain then runs asynchronously. A first frame sent in
  that window gets `protocol_not_supported` from multistream-select. `cello_await_session` returning
  IS a real guarantee, but only the responder has it. **Fix candidates:** a bounded retry on that
  distinct reason (which `sendContent` currently collapses into `session_stream_unavailable`,
  losing the actionable part), or registering the handler on the standing receiver at creation and
  dispatching by frame `session_id`.

- **OPEN — `#handleContentStream` never validates the frame's `session_id`** against the session the
  handler is bound to. Both a misdelivery gap and a diagnostic one: a frame reaching the wrong
  handler ingests under the wrong session id, and every log line about it names a session nobody is
  looking at. Note the per-session closure binding is doing less than it appears to.

- **OPEN — silent returns worth a line each:** `#parkContent`'s missing-relay guard (a park that
  cannot happen, reported as a boolean nobody logs), and `#handleContentStream`'s
  stream-opened-no-frame / wrong-type / malformed-field returns.

- **OPEN — no end-to-end confirmation is exposed.** `sendContent` already arms a persisted-ack
  tracker and the receiver sends the ack only after durable ingest, but `sendContent` resolves
  before it and no caller can await it. That tracker is the only honest "the peer has it" signal
  that exists without a protocol change, and the document delivery worker is exactly the caller that
  wants it.

## Open findings from the live document surface (2026-08-07)

Entry 31 in [[M14-BUILD-JOURNAL]] carries the full trace for each.

- **DOD-DOC-INBOUND-TERMINAL-1** ✅ [cello-client] — **a refusal the sender can never fix SETTLES
  their delivery.** The router acked only `ok: true` results, so a refusal left the envelope in
  `pendingDeliveries` and the worker re-sent on every tick. Terminal = redelivery cannot change the
  answer AND the sender was authenticated; that second condition moved signature verification ahead
  of the document lookup. Terminal: `document_unknown`, `document_killed`, `document_closed`,
  `document_chain_forked`. Not terminal: `document_stalled`, `document_chain_broken`,
  `document_sender_not_peer` (silence — an ack would hand back the existence answer the refusal
  withholds). Unit tests + `J-DOCUMENTS-TERMINAL` live enforcer, both revert-verified.

- **FIXED — the unacked ceiling stopped nothing.** `DELIVERY_MAX_UNACKED_SENDS` is 5; the operator's
  daemon sent one envelope **74 times**. The branch set the document `stalled` and logged "the
  document has stopped publishing", while `pendingDeliveries` filters on `acked_at IS NULL` and
  reads no status at all. Its test asserted the status and the log line, never that delivery
  stopped.

- **FIXED — the ack-round key did not dedup.** `ackRecordHash` mixed in `acked_at_ms`, but acks are
  re-minted on every send rather than stored and redelivered, so two acks for one envelope advanced
  the round twice. Ordinary in-flight overlap on a 1s backoff could stall a document at
  `MAX_REJECTED_ROUNDS` with no hostility involved.

- **🔴 OPEN, ROOT CAUSE ESTABLISHED — a delivery-opened session seals before the ack can return, so
  document acks are lost by construction.** This is the upstream cause of the 74 sends, and it means
  **deliveries settle only when an independent conversation session happens to be open**.

  The measurement: 4 ack frames sent across the whole daemon log, **2 admitted**. Successful acks
  arrive 4ms after send; lost ones never arrive, and `document.frame.sent` reports success for both.

  Two explanations fit the first four data points — session origin versus direction (every
  delivery-opened case was also Miss_Chelly → CELLO_Coder_1, so they were confounded). **The
  experiment named here resolved it**: session `347ecda6` on 2026-08-07 06:29 was opened by
  Miss_Chelly's delivery worker in the *opposite* ack direction (A→B), and the ack was lost too.
  Direction is falsified; session origin is confirmed.

  The mechanism is visible in the timing of that session. `session.seal.leaf.submitted` fires at
  `.102`, **90ms before the ack is sent at `.192`**, `autoacknowledged` at `.533`, sealed by
  `:14.203`. The delivery path's own contract is "open-or-reuse-**then-seal**"
  (`document-delivery.ts` `sendBytes`), and the ack rides that same path — so it is written into a
  session already sealing. Nothing is dropped noisily; the write reports ok.

  **Not fixed, deliberately** — it is a change to the delivery/seal contract, not a patch. The seal
  is intentional (`document-delivery.ts:135`: "a never-acked envelope would pollute the peer's
  sealed conversation record forever"), so the fix has to keep that property while giving the ack a
  path home. Recommended direction, already identified in the send-path findings above: use
  `sendContent`'s persisted-ack tracker — the receiver sends it only after durable ingest, it is the
  only honest "the peer has it" signal that exists without a protocol change, and the delivery
  worker is precisely the caller that wants it. That would let delivery settle without needing the
  document-layer ack to survive the seal at all.

- **🔴 OPEN, ROOT CAUSE ESTABLISHED — a document frame permanently breaks `since_seq` catch-up for
  the session it rides.** Cross-milestone: M8C owns `since_seq`, M14 owns document frames, and the
  defect exists only where they meet — which is why neither milestone's tests see it.

  A document frame **consumes a sequence number and writes no transcript row** — deliberately, per
  `document-frame-router.ts`: "A document frame is NOT a transcript message." But
  `cello_receive { since_seq }` advances its watermark by walking a CONTIGUOUS run of present
  sequence numbers, and an absent index stops the walk. `session-content-handlers.ts` states this
  as intended ("a genuinely absent index … ARE unread") without noticing that a document frame
  produces exactly that shape. So the walk stops at the document frame **forever**, and every later
  message stays unread no matter how many times the caller reads it.

  Both send-gate authorities then refuse: `connectionCursor` never advances past the gap, and
  `unreadReceived` never reaches 0. The operator sees `session_not_current`, and the guidance points
  at `cello_receive` — which they have already run. A plain `cello_receive` DOES clear it, so the
  fix is reachable but not the one the error names. That is the "rule satisfiable only through a
  door the caller is not pointed at" shape CATCHUP §3b forbids, reintroduced through a third
  milestone's frame type.

  **Observed live**, not reasoned about. Session `66e2215a…` on 2026-08-07: transcript holds
  sequences 0, 1, 2, 5, 6 with `undecryptable: 0`; the daemon log shows two
  `session.document.received {kind: update}` at 07:17:23 that took 3 and 4. `cello_send` was blocked
  twice, `since_seq: 2` returned the message in full and advanced nothing
  (`last_read_seq: 2, unread_received: 1`), and a plain `cello_receive` cleared it immediately.

  **Not a rare interaction.** The delivery worker REUSES an open session, so document traffic lands
  in whatever conversation session already exists between the two agents. Any pair that both talks
  and co-edits hits this — which is the entire M14 use case.

  **Fix direction, not yet decided:** the walk needs to distinguish "no row because it was never
  readable" from "no row because it was never a transcript message". The leaf kind already carries
  that (`0x04`/`0x05` are document leaves), so the contiguous walk could treat a document leaf as
  present-and-not-unread rather than as a hole. Wants its own unit loop; do not patch it inside a
  cascade.

## Tier P4 — The five enforcers (each names its procedure definition, [[M14-PROCEDURE]] §1c)

- **DOD-DOC-E2E-CONV-1** [trustless-cello] — **convergence enforcer GREEN** (`aa6dea04`, re-confirmed
  2026-08-06 across three consecutive full runs). Both cases, 7.3s and 4.1s. Two real daemons, a real three-node consortium, a real
  registration DKG: propose → consent → concurrent edits on the SAME line from both sides → both
  converge → an ordinary message → bilateral close → and both daemons, each rebuilding from its own
  leaves, arrive at the same `sealed_root` over a tree carrying document frames alongside messages.
  Plus the kill case: the control frame reaches the peer over the real session and their copy goes
  terminal.

  **It took four defects, and not one was visible to a unit test:**

  1. **Undomained content hash.** Both document senders wrote `sha256(content)` where every peer
     recomputes `sha256(0x00 || content)`. The send reported success with `parked: false`; the peer
     discarded it at the authenticity check, before screening and before the router, so the
     receiving daemon logged nothing about documents at all. Now one module, `wire-content-hash.ts`.
  2. **The sender never took its own leaf.** `cello_send` appends one after every successful send;
     the document path did not. The receive path HOLDS any frame whose sequence is ahead of its own
     tree size — so a sender that skips its leaf falls one behind per frame, the gap is its own, and
     every later inbound frame is held forever. Hidden by an ordering accident: with no prior
     traffic every tree is at zero, so the FIRST frame in a fresh session lands and everything after
     does not.
  3. **`merkleRoot` vs `sealed_root`** — my own test bug, which masqueraded as "A has no sealed
     root" for two runs while the receipt plainly contained the value.
  4. **The 60s production delivery tick**, which made the convergence window so tight that adding a
     SECOND test to the file made the first one fail. That read as flakiness in the product and was
     a timer. The daemon now takes `CELLO_DOCUMENT_DELIVERY_TICK_MS` (floored at 250ms); the
     enforcer turns it down to 2s, which is why the run went from 121 seconds to 7.

  **The lesson, stated once for the remaining enforcers:** every one of these was a disagreement
  between two processes about what the other would do, and a single-process test cannot have that
  disagreement — both halves compute with the same function, so they agree with each other whether
  or not either agrees with the wire.

  Diagnostics are permanent, not scaffolding: the failure message prints BOTH daemons' account (I
  printed only the sender's for a whole round and concluded the frame had never arrived when it
  had); a B→A precondition settles session-vs-document before any document exists; `cello_doc_write`'s
  result is asserted, because a legitimate `published: false` otherwise surfaced two minutes later
  as "never converged"; and the router now warns on a frame that passes the header guard and decodes
  as nothing, which was deliberately silent and is exactly the anomaly the guard exists to notice.

- **DOD-DOC-E2E-OFFLINE-1** [trustless-cello] — **offline-delivery enforcer** ran green: publish
  while the peer daemon is down; kill and restart the SENDER's daemon; start the peer; the
  update arrives and materializes with zero agent-level action; pending flag set. The
  in-memory-queue killer. — ✅ **GREEN, 2026-08-06** (`7a8c9e1f`), three consecutive full runs.

  **It found two defects the convergence enforcer could not:**

  1. **Nothing ever sent an ack.** `encodeDocumentAck` had no production caller at all — the frame
     type, its signed preimage and the whole receiving half existed, and no path produced one. The
     sender therefore redelivers until the document stalls at the unacked ceiling, re-triggering the
     peer's gate every time. Now produced on every admitted OR refused envelope (a rejection is an
     ack) and on duplicates, which is the case that matters most: a redelivery is usually evidence
     the first ack was lost.
     **Not awaited**, and that is load-bearing — the per-owner queue serializes the CHAIN CHECK, not
     network I/O, so awaiting a dial there stalls every subsequent inbound frame for that agent.
     Measured: it turned a 7-second live run into a 124-second timeout, and the symptom was
     "documents fail to converge", nothing about acks.
  2. **A restarted document came back EMPTY.** Epoch zero is agreed in the PROPOSAL — both sides
     apply the same bytes, so neither authors it and no envelope carries it. Correct on the wire,
     and it left the content living only in whichever `Y.Doc` the handler happened to hold. After a
     restart an operator would open a document they had been working in, find nothing, write into
     it, and publish the deletion of everything the peer still held. Rebuilt from the stored
     proposal, which is deterministic on both sides because `document_id` is its hash.

  **RESOLVED — it was never interference, and it was never flakiness. It was a rule firing.**

  `ingestReceivedContent` passed the SANITIZED bytes into the path that classifies document traffic.
  A `redact` verdict rewrites content for the agent's benefit — right for conversation, where the
  operator sees the sanitized form while the leaf still binds the original. Wrong for a document
  frame, and not marginally: rewriting bytes inside a signed CBOR envelope does not sanitize it, it
  destroys it. The frame stops decoding, stops being recognised as document traffic at all, and
  falls through to the CONVERSATION path — recorded as something a person said and handed to the
  agent by `cello_receive`. Roughly half of all document frames, because a proposal carries a random
  16-byte nonce, so whether its bytes tripped a rule varied per run.

  **Both enforcers are GREEN across three consecutive full runs.** Before the fix, no two runs
  agreed.

  **How it was found, because the method is the transferable part.** Counting, not reading: 12
  frames sent, 12 relay hash submissions, 12 ordering records — every frame ARRIVED — but only 4 of
  8 document frames were classified as documents, and the other 4 were sitting in the ordinary
  content tally. Nothing was lost on the wire; the bytes changed under it. That single comparison
  killed two hypotheses at once, including my own "the session is not ready yet" — which the warm-up
  round trip disproves outright, since it succeeds immediately before the frame that is then lost.

  I had stopped on this once, saying I was flipping outcomes faster than I could get a stable read.
  That was the wrong call: an unstable read is the reason to start measuring, not to stop. Three
  runs and one table of counts settled what three rounds of plausible reasoning could not.

  **Documents are not unscreened as a result.** They are screened by `DocumentGate`, which is built
  for them and REFUSES rather than mutates (§16.7) — mutating one party's replica of a CRDT is not a
  false positive, it is permanent divergence both sides converge on and neither can see. That is the
  whole reason the document path has its own gate, and this is the first live proof of why the
  message sanitizer must never touch it.
- **DOD-DOC-E2E-REJECT-1** [trustless-cello] — **rejection enforcer** ran green: gate rejects
  (limit or append rule), quarantine + `0x05` + policy record on both sides, supersession nets
  to zero, convergence; **the session containing the `0x05` leaf seals and the seal VERIFIES on
  both sides** (the directory-side leaf changes in DOD-DOC-LEAF-1 are exercised by exactly this
  case); then the stall path: supersession rejected → one retry → `stalled` visible on both
  sides. — ⏳ **CORE CASE GREEN** (`d4a1ccde`); the stall sub-case is SKIPPED and open.

  Green: a deletion into an append-only document is quarantined, the refusal puts a `0x05` leaf in
  the refuser's tree, an ordinary message rides the same session so the tree is genuinely mixed, and
  the session SEALS to one root both parties compute independently. That is the case the
  directory-side leaf work exists for and it had never been exercised — a rejection that quietly
  broke the seal would be worse than no rejection, because the refusal is a security decision and
  the record of it is what an operator would later need to prove.

  **Two findings from the stall sub-case:**

  - **FIXED (`62edeed`) — the signed rejection was never transmitted.** `reject()` built it, signed
    it over the canonical preimage, derived its leaf hash from those bytes, appended the leaf, and
    returned `{stalled, round}` — dropping the envelope. Nothing in production called
    `encodeDocumentRejection`. The SENDER's retry round is advanced by receiving that frame, so the
    counter never left zero and the whole supersede-then-stall protocol in `document-rejection.ts`,
    ceiling and duplicate-check included, was unreachable code guarding an unreachable state.
  - **FIXED (`50f5bdb`) — one gate refusal permanently broke the document.** A refused envelope is
    never written to `document_envelopes`, but the sender's chain does not rewind: their next
    envelope links to the one we refused, and the inbound check built its known-hash set from the
    log alone, so that link resolved to nothing. The supersede-then-converge protocol could never
    run, because its first move is exactly the link that was impossible. The bridge was already
    designed — the quarantine records the refused envelope's author and prev-hash for this purpose —
    and had only ever been wired to `verifyChainLinkage`, the LOCAL replay check, never to inbound
    admission, which is the path a peer's supersession actually arrives on.
  - **OPEN — there is no stall for a peer that refuses.** The only `stalled` transition fires on
    UNACKED sends: a peer that never answers. A peer that answers "refused" every time is not
    covered, and that is the case an operator is most likely to hit, because a rule mismatch
    produces exactly it.

    **Narrowed 2026-08-06.** With the rejection transmitted and the chain bridged, the remaining
    question is sharp: **A's gate never fires at all in the stall scenario — zero
    `document.update.quarantined` — while it fires reliably in the append-only DELETE case, which is
    the same rule, the same deletion shape and the same two-party setup.** Every envelope comes back
    `document_chain_refused` from the first attempt onward. So the question is not "why no stall"
    but "why is the chain refused before the gate is ever consulted, HERE and not THERE" — one
    comparison between two tests that differ in very little. That is where to start.

    Two of my attempts on this went wrong the same way, worth recording: I theorised about the
    protocol instead of comparing the two tests. The first fired four writes without waiting for a
    ruling, producing chain refusals that were purely an artefact of the test's own pacing — a
    transport-ordering artefact wearing the name of a protocol state.

  **Pattern worth naming: three protocol frames in this milestone existed as types, preimages and
  receivers with no producer** — the document ack, the proposal ack, and now the rejection. A wire
  type with no caller looks finished in every review and does nothing. Worth a guard.

- **DOD-DOC-E2E-APPEND-1** [trustless-cello] — **append-only enforcer** ran green: on
  `append_only: true`, a deleting update is rejected and superseded; an appending update
  converges. Use Case B's V1 claim, proven. — ✅ **GREEN, 2026-08-06** (`21053112`).

  Enforced on the RECEIVER, which is the only place the claim is worth anything: a peer running a
  patched client that does not enforce it locally still cannot make the deletion land. The test
  asserts the GATE FIRED — waiting on the receiver's own `document.update.quarantined` — not merely
  that the deletion is absent, because "the rule refused it" and "it never arrived" look identical
  from outside and only one is the claim. The first version had exactly that hole. It also asserts
  the inbox DISCLOSES `append_only` before consent: a rule the operator discovers by having a
  deletion refused is not a rule they agreed to.
- **DOD-DOC-E2E-WRITE-1** [trustless-cello] — **write-path enforcer** ran green: the full file
  round-trip at the tool surface (edit file → publish → peer file rewritten → pending → diff
  stats → diff → content identical), then withdraw on an undelivered update reverts the
  sender's file and records the withdrawal. — ⏳ **FILE ROUND TRIP GREEN** (`6a1223fa`); the
  withdraw half is out of V1 by decision.

  **The file surface did not exist in production.** `DocumentWritePath` — materialize,
  diff-the-file, admit-and-rewrite, 500 lines with its own test file — had no production caller.
  Same defect as the tool surface before TOOLS-1, same disguise: a complete unit with no caller
  reads exactly like a working feature. Wired at three points (`c531379`), and the third is what
  makes it a surface rather than an export:

  - materialized at propose AND accept, with the path returned — lazily would leave the first
    publish with no projection to diff against, and a path nobody is told is a file nobody can edit;
  - `cello_doc_publish` diffs the FILE against what the daemon last wrote there, refusing on a stale
    baseline rather than reading the peer's admitted content as a deliberate deletion;
  - **rewritten on every admitted inbound update** — without it the surface is write-only, and a
    stale file that reads as the document and gets published back over the peer's work is worse than
    no file at all.

  The enforcer asserts on DISK, both directions, both files identical at the end. The two documents
  agreeing while the files differ is exactly the failure that would make this useless to the person
  editing one.

  **Withdraw is not covered, by the earlier decision to cut it from V1** (see DOD-DOC-TOOLS-1): it
  only ever applied to an undelivered envelope, and `cello_doc_write` with corrected text gives the
  identical net effect in the identical number of calls. Recorded here rather than quietly scoped
  away.

---

## Observability reference — the `document.*` taxonomy (ACs on each unit; lens-enforced)

`document.proposal.sent/received/accepted/refused` · `document.publish.recorded` (envelope
written) · `document.delivery.attempt/delivered/acked/deferred` (deferred names its cause:
peer_offline, dial_failed…) · `document.update.received/admitted/quarantined` (quarantined
carries the machine-readable reason) · `document.rejection.sent/received` ·
`document.supersession.published/admitted` · `document.stalled` · `document.withdrawn` ·
`document.closed` / `document.killed` · `document.file.materialized/overlap_detected`.
CorrelationId minted at proposal or publish and threaded through the flow it starts
(delivery chain; rejection→supersession chain). No `console.log`, injected logger only.

## Decisions

Decisions 1–22 and the four flows are recorded in the spec-of-record
([[2026-07-31_federated-collaborative-state-architecture]] §16) and are restated there, not
here — this section holds only decisions made DURING the milestone.

- **M14-D5** (2026-08-05, §3a — REDO > BLOCK): a document envelope's `sender_agent_id` /
  `peer_agent_id` is the peer's **K_local Ed25519 public key, hex-encoded**, not an opaque id.
  Forced by the composition: signature verification needs an id → key mapping, and `agent_id` in
  this daemon is a LOCAL primary key on the `agents` table — it identifies rows in *our* database
  and cannot name a remote peer at all. Of the identifiers that can, the pubkey is the only
  SELF-VERIFYING one: the signature checks against it directly, with no lookup that could be stale,
  missing, or poisoned sitting on the critical path of every authentication. It is also what CELLO
  already keys counterparties by everywhere else (`contacts` PK, `sessions.counterparty_pubkey`),
  and it is stable where a name is not — the join-on-the-stable-key rule.
  The field NAME is unchanged: for a remote agent, its identifier *is* its public key. Renaming
  would churn two frozen conformance vectors for no gain. What changed is that the decoders now say
  what the field holds and validate it, so an opaque string cannot silently arrive where a key is
  required and fail later as a signature error.
- **M14-D1** (2026-08-04, Andre): V2 is **M14B** — same milestone family, second wave. Its DoD
  is written now, parked, in this directory.
- **M14-D2** (2026-08-04, review finding B2 — default, Andre may overturn): **DOD-DOC-SCREEN-1
  must be ✅ before DOD-DOC-SHIP-1 flips.** §3.2 calls the screening-driven gate "not optional
  for V1", so the conservative reading holds: the audit and the screening wiring happen inside
  the milestone, before the publish cascade ships document support to operators. The
  alternative (close with SCREEN-1 parked, screening as a pre-launch fast-follow) is Andre's to
  choose; until he does, this line is the close condition.
- **M14-D3** (2026-08-04, review finding S3): **the V1 close shape is mutual close acks** —
  a forced derivation from §16.1 (the quiescence agreement that §3.5 puts at close is Tier-2
  machinery). M14B's DOD-DOC2-AGREE-1 adds the agreement as close's final step on activation.
- **M14-D4** (2026-08-04, review finding S5): **V1 "watching presence" (§16.4) = per-attempt
  `discovery_lookup` + scheduled capped retry.** The spec's body describes presence-driven
  push; no presence subscription exists in the client today (verified 2026-08-04), so the
  push mechanism is the parked upgrade (M14-P4), and §16.4's backstop is V1's mechanism.

## Parked

- **M14-P1** — **The screening audit** (§3.1, §16.8). Andre calls the timing; DOD-DOC-SCREEN-1
  is blocked on it and only that line waits — the gate hook (DOD-DOC-GATE-1) builds now with
  append-only/limits/malformed rules, and screening plugs in.
- **M14-P2** — **Shared screening-profile hint** in the document template (§16.6). Advisory
  both ways; deferred until real rejection friction justifies it.
- **M14-P3** — **Doorbell-on-update as per-document opt-in** (§16.5). V1 is passive-only.
- **M14-P4** — **Directory-side presence subscription/push.** V1 delivery uses per-attempt
  `discovery_lookup` + scheduled retry; if that proves too slow in practice, a subscription is
  the upgrade. New directory state — design deliberately, not casually.
- **M14-P5** — **Two-daemons-same-agent guard.** §16.7-4: an identity-layer concern, not a
  document one; solve once at the identity layer, not per-feature.
- **M14-P6** — **Capability negotiation** beyond the versioned proposal (§16.7-8). Alpha:
  "both sides upgrade" is the contract.
- **M14-P7** — **Hub-and-spoke cross-document diff tooling** (§11.1 — "changed in doc_AC, not
  yet ported to doc_AB"). Hub-and-spoke WORKS in V1 by construction (two separate documents,
  re-authoring is just editing); the daemon-provided porting aid is the deferred part.
- **M14-P8** — **Pass-through mode** (§11.1's single-`Y.Doc` opt-in for a transparent
  coordinator). The V1 handshake REFUSES the declaration (DOD-DOC-HANDSHAKE-1); two-document
  form only. Un-parks when a real coordinator case demands it — with §11.1's stated properties
  (transitive all-or-nothing propagation, visible third-party clientIDs) as the spec.

---

## Related Documents
- [[M14-PROCEDURE]] — how to work this milestone (read first)

- [[2026-08-05_1230_document-screening-convergence-and-content-profiles|Document Screening, Convergence and Content Profiles]] — the design behind `DOD-DOC-PROFILE-1`, `DOD-DOC-SCREEN-1` and
  `DOD-DOC-REBUTTAL-1`, including the measurement that settled them
- [[M14B-DEFINITION-OF-DONE]] — V2's parked yardstick
- [[2026-07-31_federated-collaborative-state-architecture]] — spec-of-record (§16 = decisions)
- [[M12-DEFINITION-OF-DONE]] — the DoD this one is modeled on
- [[2026-05-08_1400_presence-notification-subscription|Presence Notification Subscription]] —
  the May stub that M14-P4 parks (directory-side presence subscription as the delivery-latency
  upgrade)
