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
- **DOD-DOC-SCREEN-1** [cello-client] — 🅿️ **BLOCKED on the screening audit (Andre calls it —
  [[M14-PROCEDURE]] two-stop reason 1).** When unblocked: incoming projected diffs flow through
  `screenInbound` at the gate hook with document context (`ScreenContext` today carries no
  counterparty and no document scope — the audit decides what scoping §3.1 actually needs vs
  what exists); the sender-side ADVISORY scan runs the sender's own policy against the outbound
  diff at publish (§16.6 — a courtesy, never a boundary; the receiver's gate stays
  authoritative). False-positive posture per the audit's findings. — 🅿️

## Tier P2 — Protocol surface (handshake, envelopes, delivery, lifecycle, notification)

- **DOD-DOC-HANDSHAKE-1** [cello-client] — the document handshake (§16.3), mirroring the
  attestation-consent pattern (consent state machine `pending|accepted|refused`, compare-and-set
  acceptance): A's create call sends a proposal naming type, properties, and optional starting
  content; B's agent sees it as a pending item and accepts or refuses; on accept both sides mint
  the document from the agreed content. `document_id` = hash of the proposal envelope.
  **Seam enforcement:** `assurance_tier` only `authenticated`, `schema_enforcement` only
  `false`, `topology` only `hub-and-spoke` (the pairwise two-document form; §3.4, §11.1 —
  pass-through declaration refused, M14-P8) — any other value refused loudly at proposal AND at
  accept. **The proposal carries a document-feature version** (§16.7-8) — incompatibility is
  DETECTED from it, and a peer that does not speak documents surfaces as a human-readable
  "peer's client doesn't support shared documents — ask them to upgrade", never a timeout or a
  timeout-classifier. **Properties are immutable after accept** — a property change is an epoch
  event and therefore V2 (§16.3); no mutate call exists in V1. — ❌
- **DOD-DOC-SEALAUTH-1** [trustless-cello] — 🅿️ **carried from DOD-DOC-LEAF-1's second review
  pass** (2026-08-04), pre-existing and outside that unit's scope: (a) `seal_submission` on
  `/cello/directory-relay/1.0.0` is accepted from ANY dialer — only `relay_register`
  authenticates that stream — so the frame that drives seal notarization is unauthenticated;
  (b) `leaves[0].s2.prev_root` is taken as the genesis anchor with no validation
  (`directory-node.ts` ~4893), so a dialer who has observed a session's leaf log can submit a
  self-consistent SUFFIX of it as a seal. (a) and (b) compose: together they are the reason a
  trailing-leaf ceremony had to be refused outright rather than tolerated. Not a document
  concern — it is the seal ingress — so it does not gate M14, but it should not be lost. — 🅿️
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
  no-consumer exception). Replay defined set-based per §16.7-5. — ⏳ (pass one's findings applied;
  all three inherited blocking ACs verified inside the signed TBS by revert and a frozen
  conformance vector pins field order — pass two in flight, not yet ✅)
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
  is also an ack for delivery purposes; supersession is DOD-DOC-REJECT-1's job). — ❌
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
  unpause resumes — pinned by test. — ❌
- **DOD-DOC-NOTIFY-1** [cello-client] — passive notification (§16.5): a new derived section in
  the inbox aggregation backed by its own table + getter (the `contact_rename_notices`
  precedent — there is no inbox store, the inbox is computed per call), carrying `document_id`
  and pending-count only; cleared by the agent's explicit fetch. **No doorbell fires on a
  document update** (§11.3 — doorbell-on-update is parked, M14-P3). The two read calls (§4.1):
  **diff stats** (structural counts + line/key ranges + the overlap flag — no content) and
  **diff** (the git-like diff itself, an ordinary screened read). Supported document types for
  the diff call decided and recorded in-unit (Markdown, plain text, JSON at minimum). — ❌

## Tier P3 — Tool surface, templates, ship

- **DOD-DOC-TOOLS-1** [cello-client] — the `cello_doc_*` tool surface, registered in ALL FOUR
  lockstep places (`core/adapter-claude-code/src/bin/cello-mcp.ts`, the daemon IPC handler map,
  `core/daemon/src/vocabulary.ts`, the CLI registry/parity surface): create, list, status,
  publish (with optional session hint), diff-stats, diff, read, withdraw, close, kill, and the
  consent accept/refuse pair. Tool descriptions carry the injection-boundary guidance (fetch is
  deliberate; notification is content-free). CLI parity proven the way the existing parity
  tests prove it. — ❌
- **DOD-DOC-SKILL-1** [cello-client] — the plugin skill/template layer (§4.1's owed
  deliverable + §16.7-9): publish-on-intent guidance (batch like a commit, not a keystroke),
  the overlap-flag review behavior (review the merged projection before building on it), and
  the returning-collaborator rule (on returning to a document, re-read its conventions before
  writing). Ships in the plugin the way existing skills ship; audited as SHIPPING content
  (tarball, not source). — ❌
- **DOD-DOC-SHIP-1** [cello-client, trustless-cello] — the publish cascade: all changed packages
  published via `/cello-publish` (skill loaded, per publish), trustless-cello re-pinned, the
  plugin carrying tools + skills verified in the TARBALL, and a **live smoke on the real GCP
  fleet**: two real daemons on two machines (or two CELLO_DIRs), create → consent → edit →
  publish → deliver → converge → seal, with document leaves in the sealed tree and the seal
  verifying. **The publish gate — milestone close is P4 all-green, not this line.** Vitest
  green ≠ done. Andre runs the `latest` promotion. Close condition per M14-D2. — ❌

## Tier P4 — The five enforcers (each names its procedure definition, [[M14-PROCEDURE]] §1c)

- **DOD-DOC-E2E-CONV-1** [trustless-cello] — **convergence enforcer** ran green: two real
  daemons, create/consent, concurrent file edits including an overlapping region, both publish,
  both files converge, overlap flag fires, session seals with mixed `0x00`/`0x02`/`0x04` leaves
  and BOTH sides independently recompute the same root. New `j-*.spine.test.ts` on
  `live-harness.ts`, modeled on `j-unilateral.spine.test.ts` — never a from-scratch fixture. — ❌
- **DOD-DOC-E2E-OFFLINE-1** [trustless-cello] — **offline-delivery enforcer** ran green: publish
  while the peer daemon is down; kill and restart the SENDER's daemon; start the peer; the
  update arrives and materializes with zero agent-level action; pending flag set. The
  in-memory-queue killer. — ❌
- **DOD-DOC-E2E-REJECT-1** [trustless-cello] — **rejection enforcer** ran green: gate rejects
  (limit or append rule), quarantine + `0x05` + policy record on both sides, supersession nets
  to zero, convergence; **the session containing the `0x05` leaf seals and the seal VERIFIES on
  both sides** (the directory-side leaf changes in DOD-DOC-LEAF-1 are exercised by exactly this
  case); then the stall path: supersession rejected → one retry → `stalled` visible on both
  sides. — ❌
- **DOD-DOC-E2E-APPEND-1** [trustless-cello] — **append-only enforcer** ran green: on
  `append_only: true`, a deleting update is rejected and superseded; an appending update
  converges. Use Case B's V1 claim, proven. — ❌
- **DOD-DOC-E2E-WRITE-1** [trustless-cello] — **write-path enforcer** ran green: the full file
  round-trip at the tool surface (edit file → publish → peer file rewritten → pending → diff
  stats → diff → content identical), then withdraw on an undelivered update reverts the
  sender's file and records the withdrawal. — ❌

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
- [[M14B-DEFINITION-OF-DONE]] — V2's parked yardstick
- [[2026-07-31_federated-collaborative-state-architecture]] — spec-of-record (§16 = decisions)
- [[M12-DEFINITION-OF-DONE]] — the DoD this one is modeled on
- [[2026-05-08_1400_presence-notification-subscription|Presence Notification Subscription]] —
  the May stub that M14-P4 parks (directory-side presence subscription as the delivery-latency
  upgrade)
