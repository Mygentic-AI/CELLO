---
name: M14B Multiplayer Documents Definition of Done
type: definition-of-done
date: 2026-08-11
milestone: M14B
status: open
topics: [m14b, multiplayer, collaborative-state, mesh, amendments, epochs, participant-set, admins, fan-out, consent, crdt, cello-client]
description: >
  The yardstick for M14B — multiplayer documents: the amendment chain that makes a document's
  arrangement changeable by signed consent, admin governance, third-party join, fan-out delivery
  to N holders, and the mesh topology. Sole status authority. Spec-of-record is
  2026-08-10_2116_multiplayer-artifacts-joining-an-existing-document (§6 mechanism, §9 phases,
  §13 rulings, §14 Tier-2-readiness constraints) plus §11 of the 2026-07-31 architecture log for
  the topology derivations. Tier 2 (canonicalization, attestation, purge, schema) stays parked in
  COLLAB-TIER2-DEFINITION-OF-DONE — M14B builds the sockets it will plug into.
---

# M14B — Definition of Done

## How to use this
- Find the lowest-numbered line not ✅ in the active tier — that is the next unit.
- **Evidence discipline:** a flipped tag carries ONE line of evidence plus `→ Journal Entry N`.
  Full run output lives in [[M14B-BUILD-JOURNAL]]. This document stays a scoreboard.
- **Four enforcers** (defined in [[M14B-PROCEDURE]] §1c): governance · join · fan-out · removal.
  All four run **THREE real daemons as separate OS processes** — every serious M14 defect was two
  processes disagreeing about what a third would do, and no single-process test can have that
  disagreement. A line naming an enforcer is ✅ only when that enforcer RAN.
- Tier order is a dependency order, not a calendar. P0 before P1; P1 before P2; P3 can interleave
  with P2; P4 needs everything.
- **The Tier-2-readiness invariants are reviewer lenses on every unit** — they carry no status
  tags and cannot be "completed"; they can only be violated, and a violation is blocking.
- **The Tier 2 boundary:** anything attestation-shaped (canonicalization, the agreement
  handshake, divergence records, purge, schema enforcement) belongs in
  [[COLLAB-TIER2-DEFINITION-OF-DONE]], not here. M14B leaves the sockets; it does not fill them.

## Repo Legend
| Tag | Local path | Notes |
|-----|-----------|-------|
| `cello-client` | `/Users/andrep/Documents/code/cello-client` | PRIMARY repo. Ships via `/cello-publish` (LOAD THE SKILL, every publish) — never `workspace:*`, never local `npm publish` |
| `trustless-cello` | `/Users/andrep/Documents/code/trustless-cello` | The four spine enforcers in `packages/e2e-tests`, any relay/directory touch, these docs. Re-pins published cello-client semvers |

## Status legend
✅ PROVEN (enforcer-green where one is named) · 🟡 BUILT/UNVERIFIED-LIVE · 🟠 PARTIAL · ❌ NOT BUILT · 🅿️ PARKED

---

## Tier I — Invariants (properties, NOT deliverables — no status tags)

> Enforced per-unit as reviewer lenses — [[M14B-PROCEDURE]] §2b. Stated once here, untagged.

- **AMENDMENT-VALIDITY** [cello-client] — a document's arrangement (participant set, admin set,
  properties) is derived ONLY from the genesis proposal plus the ordered amendment chain,
  replayed independently by every holder. An amendment whose signer set does not meet its kind's
  requirement is INVALID — computed independently everywhere, never "detected and disputed". The
  genesis proposal is never edited and still hashes to `document_id`.
- **GOVERNANCE-ON-THE-RECORD** [cello-client] — every governance act is a signed amendment
  attributable to its author(s). The consented claim is: *you agreed at join time to a document
  governed by its admin set, and every governance act is signed and permanently on the record.*
  (This deliberately replaces "nothing changes without everyone's signature" — ruled §13-D2.)
- **FORWARD-ONLY-REMOVAL** [cello-client] — removal NEVER claims to reach a holder's local copy.
  Removal = delivery to them stops + their new edits are refused with a named reason. Their copy
  is theirs forever. No surface — docs, tool descriptions, error text, skills — may claim more
  (§13-D3: "revoking it would be meaningless").
- **TIER2-READY** [cello-client] — the four §14 constraints, each a blocking lens:
  1. **Final-shape epoch record** — signed, chained to its predecessor, carrying the
     canonical-state-hash slot as defined-absent at Tier 1. No "temporary" epoch format ever
     ships; Tier 2 fills a field, it does not migrate a frame.
  2. **The multi-signature primitive is generic** — collect-N-signatures-over-one-preimage is
     amendment-agnostic; Tier 2's N-way agreement is its named second consumer. Amendment-specific
     tentacles growing into it are a blocking finding.
  3. **Stable identity spine** — participant records key on pubkey/`agent_id`; display names
     appear nowhere structural. Tier 2 schema write-authority later resolves against this list as
     a lookup, not a migration.
  4. **No frame assumes a single counterparty** — every new frame answers "what does this mean
     with N other parties?" at design time; the joiner's consent handshake carries
     `assurance_tier` + `feature_version` so an old build is refused with a sentence, both ends.
- **INHERITED-M14** [cello-client] — M14's six invariants persist unweakened on every M14B diff:
  NO-SILENT-DROP, INJECTION-BOUNDARY, LOG-INTEGRITY, MECHANICAL-ADMISSION,
  CONTENT-FREE-NOTIFICATION, SEAM (see [[M14-DEFINITION-OF-DONE]] Tier I for their definitions).
  N holders multiply the surface of each; they change none of them.
- **EXIT CRITERION (the milestone's own bar)** — when Tier 2 activates, it fills the hash slot,
  plugs its agreement check into the existing signing primitive, and resolves write authority
  against the existing participant list. It **rewrites nothing M14B shipped and migrates no wire
  format**. M14B cannot close while any shipped shape would force that.

---

## Tier P0 — Trace + primitives (Phase 1: make the arrangement amendable — still two parties)

- **DOD-MP-TRACE-1** [cello-client] — the confirm-first unit (the multiplayer log names the
  fan-out shape "the first thing to confirm, not to assume"): trace and journal, with file/line
  evidence, (a) the delivery worker's actual shape and what per-holder fan-out changes in it;
  (b) the topology refusal sites at BOTH ends (proposer and accepter); (c) every producer and
  consumer of `epoch_id` today; (d) the handshake property flow and where the immutability-after-
  accept rule is enforced; (e) how the M14 consent handshake would carry a join. Every divergence
  from the multiplayer log's assumptions becomes an AC on the unit it affects. No code ships from
  this line. — ✅
  > Five-seam map with verified citations; 2 defects found, 1 fixed (`content_profile` signed but
  > not sendable, cello-client `59c1814`); reviewer's blocking finding (epoch map incomplete)
  > corrected in the addendum. → Journal Entries 1–2.
- **DOD-MP-SIG-1** [cello-client] — the multi-signature primitive: collect N Ed25519 signatures
  over ONE domain-separated preimage (`CELLO-DOCUMENT-MULTISIG-v1` TBS naming the document, the
  subject kind + hash, and the required-signer set — tag follows the sibling `CELLO-DOCUMENT-*`
  convention, Entry 4 DECISION); a collection missing any required signature is
  INVALID, verified independently by any holder; partial collections are storable-in-progress but
  never valid. Generic by construction (TIER2-READY lens 2) — the amendment is its first
  consumer, Tier 2's N-way agreement its named second. Frozen conformance vector pinning field
  order. No mocks for crypto. — ✅
  > 29 tests, real Ed25519, all 16 original tests survive the reviewer's revert test; 3 findings
  > fixed; merged `cello-client f575a97`. → Journal Entry 4.
- **DOD-MP-AMEND-1** [cello-client] — the amendment record, which IS an epoch event in its FINAL
  frame shape (TIER2-READY lens 1): signed via SIG-1's collections, chained to the previous
  epoch, `epoch_id` increments past constant-0 (the V1 seam pays off — no envelope migration),
  canonical-hash slot defined-absent. Kinds: `add_holder`, `remove_holder`, `promote_admin`,
  `remove_admin`, `change_property`. Replay derives {participant set, admin set, properties} from
  genesis + the chain; a gap, an unknown predecessor, or an invalid amendment REFUSES loudly
  naming the gap. Store keyed on `document_id`/`agent_id` only. Amendments are envelopes in the
  append-only log — new records, never edits.
  **ACs from TRACE-1 (Journal Entry 2):** every locally-authored envelope — publish
  (`document-publish.ts:137`) AND rejection (`document-rejection.ts:246`) — stamps the current
  epoch from replay, never the constant; `list` (`document-lifecycle.ts:177`) reads the real
  value; the quarantine stubs (`document-store.ts:553`) read the real value or are exempted with
  a journaled reason; the envelope decoder (`document-envelope.ts:203–207`) relaxes to
  integer-shape only, and epoch CORRECTNESS moves to inbound — which may trust the decoded value
  because `epoch_id` sits in the signed TBS (`document-envelope.ts:100`). The admin set at
  creation rides a new slot in the SIGNED proposal preimage, **keyed by pubkey/`agent_id`**, as
  one batched preimage change with frozen-vector reissue and `feature_version` 2. — ✅
  > Reviewed SPEC: FAITHFUL; 4 findings (1 HIGH: the admin-scalar hex boundary) all fixed;
  > merged `cello-client 5108e12`. Store append/chain are consumer-less by design (ENVELOPE-1
  > shape, reviewer-ruled) — the validate-before-append invariant binds JOIN-1/INBOUND-N-1/
  > GOVERN-1 reviews. → Journal Entries 5–6.
- **DOD-MP-GOVERN-1** [cello-client] — the signature-requirement policy, per §13-D2/D3: the
  admin set is fixed at creation by the initiator (everyone-is-admin, or a listed subset —
  the create flow makes the choice legible, never defaulting silently); a SINGLE admin's
  signature suffices for `add_holder` (plus the invitee's own consent), `promote_admin`,
  `remove_holder` (non-admin), and `change_property`; `remove_admin` requires ALL OTHER admins
  (the removed admin's signature neither required nor counted); a self-signed voluntary leave is
  always valid. Validation is per-kind and refuses a collection that does not meet its kind's
  requirement. The two-admin deadlock (neither can remove the other) is BY DESIGN — pinned by a
  test, and the refusal says the recourse (duplicate + start fresh). Proven entirely bilateral:
  two parties amend a property; an amendment missing a required signature is rejected. — ✅
  > Reviewed; 4 findings + 1 hollow row fixed, incl. the proof clause now running under the real
  > policy; invitee-consent clause dispositioned to JOIN-1 (Entry 8); the holder-door bypass
  > refused by name. Merged `cello-client 4523716`. → Journal Entries 7–8.
  > NOTE: the policy seam consumed here reshaped AMEND-1's `SignerPolicy` to a claimed-set
  > verdict — rationale in Entry 7.

## Tier P1 — Join (Phase 2)

- **DOD-MP-JOIN-1** [cello-client] — the join flow: an admin's `add_holder` amendment + the
  invitee's OWN consent handshake (the same propose → see-the-rules → accept/refuse signed shape
  the document handshake already has; the invitee sees the current properties, participant set,
  and admin set before agreeing). The joiner receives the FULL current document via the cheap
  path — log replay, converging like everyone else (§13-D1: no snapshot machinery, no history
  viewer, no history hiding). The join handshake carries `assurance_tier` + `feature_version`;
  an unsupported build is refused with a sentence at both ends (TIER2-READY lens 4). A join is
  not effective until both the amendment is valid AND the invitee has consented — neither alone
  admits anyone. — ✅
  > Reviewed; 10 findings fixed incl. 2 HIGH (settle-key poisoning, planted snapshot content) +
  > the demanded revert-visible test that exposed the amendment frame's missing discriminator
  > (the fan-out path had never worked). In-process 3-daemon proof green; merged
  > `cello-client d0e079b`. → Journal Entries 9–11.
- **DOD-MP-REMOVE-1** [cello-client] — removal, forward-only: the amendment per GOVERN-1; on
  admission every remaining holder stops delivering to the removed holder and refuses their
  post-removal envelopes with a reason naming the removal (never a silent drop — the refusal is
  the NO-SILENT-DROP-compatible answer to a removed peer still publishing); the removed holder's
  daemon surfaces the removal to its operator; their local copy is untouched and no surface
  claims otherwise (FORWARD-ONLY-REMOVAL). — ✅
  > Reviewed; blocking findings fixed — the delivery-stop half now runs on the HONEST holders'
  > daemons (the adversary-owns-their-daemon lens, Entry 13), the missed-amendment case gets the
  > removal answer, removal is DERIVED from the chain (no stored flag, no migration). Merged
  > `cello-client cc06b3f`. → Journal Entries 12–13.

## Tier P2 — Fan-out delivery (Phase 3)

- **DOD-MP-FANOUT-1** [cello-client] — the delivery target set is the DERIVED participant list
  (never per-sender config — §7-1 of the multiplayer log: if A believes {A,B,C} and B believes
  {A,B}, C diverges silently; the amendment chain is the answer and delivery must consume it).
  Acknowledgement is tracked per `(envelope, holder)`, derived from the log, restart-survivable;
  retry per holder on the capped backoff; **one unreachable holder never blocks or delays
  delivery to the others** — availability is a first-class protocol concern. The 20-holder cap
  (§13-D5) is enforced at amendment validation. — ✅
  > Reviewed; 2 HIGH fixed (envelope-keyed ack waiters let any holder settle the dialed
  > holder's row; a removed genesis peer kept ack rights) + 7 more + 3 revert-invisible test
  > gaps closed. Attempts schedule, sends gate. Merged `cello-client a2ce49b`.
  > → Journal Entries 14–16.
- **DOD-MP-CONTROL-N-1** [cello-client] — control frames (`close`, `kill`) address the DERIVED
  participant set, never the genesis `peerAgentId`. Found by the SHIP-1 live fleet smoke, not by
  any test: the notifier sent to `doc.peerAgentId` and returned after one send, so with three
  holders only one was told — and after a removal the genesis counterparty can BE the removed
  holder, so the frame reached the one party it must not while the remaining co-author heard
  nothing, under a reported `peerNotified: true`. This is TIER2-READY lens 4, a blocking
  invariant. Signed once, byte-identical to each holder; reported per holder; one unreachable
  holder never blocks the others; a chain that will not derive REFUSES by name rather than falling
  back to the genesis peer. **BOTH HALVES** — the review found the fix was outbound-only and the
  RECEIVING side still authorized an ending by `sender === doc.peerAgentId`, so a removed holder
  could end the creator's document with two ordinary commands and a joiner's own close was refused
  by every holder while the sender was told all had heard them. Inbound now gates on derived
  membership, mirroring `document-inbound.ts`; the peer column stands in only when the chain
  cannot answer. — ✅ (downgraded, then EARNED — Entry 31)
  > All three halves now live and revert-sensitive across three OS processes: the close reaches
  > BOTH the genesis peer and the joiner; the joiner's own close IS accepted (revert of the
  > inbound gate → red); and the gate REFUSES a removed holder — with `#senderMayEnd` admitting
  > everyone, the removed party's kill KILLS the creator's document and the new journey goes red
  > on it. The refusal is the half no journey of acceptances could see.
  > → Journal Entries 26–27, 31.
- **DOD-MP-CLOSE-N-1** [cello-client] — a close settles only when EVERY current holder has said
  it, derived from the chain. It settled on the owner plus the genesis peer, so with three holders
  the document flipped to `closed` once two agreed while the third was still editing — the exact
  thing `document-lifecycle.ts`'s own header forbids ("one side's close is a REQUEST"). The list
  row's `closePending` asks the same question of all holders. Ruled under §3a; see Decisions
  Carried. **Derivation answers THREE ways — derived / legacy / unknown** (review, Entry 28): a
  document with no chain is the pre-amendment bilateral case and settles on the pair; a chain that
  exists and will not replay REFUSES, because standing in the pair there completes a three-holder
  document on two. Collapsing the two cost correctness one way and every legacy document the
  other. A membership change re-evaluates settlement, so removing the one holder who never closed
  completes it. — ✅ (downgraded, then EARNED — Entry 31)
  > Two-of-three-does-not-settle now asserted on the genesis peer's daemon as well as the owner's,
  > and the blind sleep replaced by waiting for the peer-close record — "both closes are in and it
  > still did not settle", not "not yet". The legacy clause was FALSE IN PRODUCTION and is now
  > true: `controlHolders` refused the very condition the settle path calls legacy, so a
  > pre-amendment document could never be ended by agreement. Fixed and driven through the real
  > notifier. → Journal Entries 28, 31.
- **DOD-MP-INBOUND-N-1** [cello-client] — the receive side against N senders: per-sender
  `doc_prev_hash` chains validated per sender (the chain is per-author, N of them); an envelope
  from a non-holder — per the receiver's derived participant set — is refused with a named
  reason; **amendment lag is defined, not discovered**: an envelope from a holder the receiver
  has not yet learned of (the amendment is in flight) is held or refused with a reason naming
  the unknown sender, never silently dropped, and resolves when the amendment arrives — exact
  shape settled against TRACE-1's findings and journaled. — ✅
  > Reviewed; the lag signature (unknown sender + epoch-ahead) is logged by name, wire silence
  > stands; the settled shape + its retry-ceiling window journaled (Entry 18); per-sender chains
  > pinned N-independent. Merged `cello-client 5748894`. → Journal Entries 17–18.

## Tier P3 — Topology declaration becomes meaningful (Phase 4)

- **DOD-MP-TOPOLOGY-1** [cello-client] — `topology: mesh` accepted at the handshake at BOTH ends
  (the two-sided refusal discipline stands: one-sided validation lets whichever side is newer
  decide for both); mesh becomes the default for new documents; `hub-and-spoke` is retired as a
  concept per §13-D4 — the wire field survives, nothing is built for it, and the broker case is
  served by construction (two documents). Pass-through (M14-P8) stays parked. An unsupported
  topology is refused with a sentence naming the mismatch, both ends. — ✅
  > Reviewed SPEC: FAITHFUL; the accepted-value set changed in ONE place as TRACE-1 promised;
  > `TOPOLOGY_V1` deletion proven three ways. F1 fixed: an arrival auto-refusal now ANSWERS the
  > proposer (the join path's rule, applied where it was missing). Merged
  > `cello-client 252767a`. → Journal Entries 19–20.

## Tier P4 — Enforcers + ship (THREE real daemons, separate OS processes)

- **DOD-MP-E2E-GOVERN-1** [trustless-cello] — governance enforcer: three daemons A/B/C. A creates
  with admin set {A}; B joins (amendment + consent); B (non-admin) attempts an `add_holder` →
  refused by every holder independently; A invites C properly → C consents → in; A promotes B;
  a `remove_admin` missing one other-admin signature → invalid everywhere; with the full set →
  admitted. All three daemons derive the identical {participants, admins, properties} at every
  step. — 🟠 PARTIAL (6 of 6 clauses that remain; 3 PARKED out, Entry 24)
  > Downgraded from ✅ on the enforcer review (Entry 22) — the tag was set against the run's
  > note, not against this line. PROVEN: three daemons; A invites C properly → C consents → in.
  > NOW PROVEN (Entry 23): creation declares A sole admin and both holders derive it; a HOLDER
  > who is not an admin is refused `document_not_admin` (the first cut used a NON-holder, which
  > dies six checks earlier at `document_unknown` — green with all governance deleted); the
  > arrangement is agreed value-for-value by all three at every step, enabled by
  > `cello_doc_list` now surfacing it. The three promotion/demotion clauses are PARKED OUT of
  > this line (Explicitly beyond, Entry 24) — no verb authors them. NOT COVERED: B joining by
  > amendment (B is a genesis party by construction — the line's own wording, not a gap);
  > independent refusal at the OTHER holders (needs the rejected amendment put on the wire
  > anyway); identical
  > {participants, admins, properties} at every step (proxied by epoch height only — no surface
  > exposes the triple). **THREE CLAUSES ARE UNBUILDABLE:** `promote_admin` and both
  > `remove_admin` cases have NO authoring verb — the N-signature gathering wire is parked
  > (Entry 10). They cannot be tested and must not be tagged; see Entry 22 for the decision
  > owed.
- **DOD-MP-E2E-JOIN-1** [trustless-cello] — join enforcer: a bilateral A↔B document accumulates
  real edit history; C joins mid-life; C converges to the full current document by replay; C's
  first edit reaches BOTH A and B; `epoch_id` incremented across the join; the session seals and
  the document leaves verify on all three sides. — ✅ (6 of 6, Entry 24)
  > Downgraded then EARNED. The sealing clause was ill-posed for a mesh and is now DEFINED
  > (Explicitly beyond, Entry 24): each PAIRWISE session seals and both of its parties
  > independently recompute the same root over that pair's document leaves. Proven for A↔B and
  > A↔C, mixed trees, roots compared side to side. Plus: real history before the join, C joins
  > mid-life and converges by replay, C's first edit reaches BOTH, epoch incremented.
- **DOD-MP-E2E-FANOUT-1** [trustless-cello] — offline fan-out enforcer: three holders; B
  publishes while C's daemon is DOWN; **B's daemon is then killed and restarted** (pending
  derived from the log, not memory); A receives immediately — never blocked by C's absence; C's
  daemon returns; C converges with zero agent attention on any side. — ✅ (5 of 5, Entry 22)
  > Downgraded then EARNED: the bolded half now runs — A queues work for the absent holder,
  > A's daemon is killed and RESTARTED and the backlog survives (derived from the log, not
  > memory), then C returns and converges with nobody acting on any side. 3 real daemons.
- **DOD-MP-E2E-REMOVE-1** [trustless-cello] — removal enforcer: three holders; C is removed;
  C's local copy is intact and C's daemon surfaced the removal; C's next publish is refused by
  A and B with the removal-named reason (and the refusal is on the record — no silent drop);
  A and B continue editing and converging normally. — ✅ (Entry 25 — one clause REDEFINED by
  what the live run proved)
  > Downgraded (Entry 22). PROVEN: three holders; a holder removed; their copy intact; their
  > daemon SURFACED the removal (genuine cross-process evidence — derived from the amendment
  > that really travelled). NOT COVERED: the refusal AT THE RECEIVERS (the test proves the
  > removed party's own local pre-check, a different code path — the receiver-side refusal
  > **The receiver-side clause was written on a false premise** (Entry 25): a journey built to
  > stage it — remove a holder while their daemon is down so they never learn — proved the
  > relay PARKS the amendment, so an offline holder is not an uninformed one. On return they
  > learn with nobody acting, then self-censor. With HONEST binaries that refusal is
  > UNREACHABLE end to end; it defends against a REWRITTEN client (the
  > adversary-owns-their-daemon lens), which stock binaries cannot stage — its coverage is the
  > inbound unit suite. What runs live is the cooperative path entire: survivors keep
  > converging, the removed holder keeps their copy unchanged and receives nothing further.
  > **"On the record" remains a PRODUCT question** (today a log line + a refusal ack, no
  > durable rejection row on the receiver) — Andre's call, not a test gap.
- **DOD-MP-SHIP-1** [cello-client, trustless-cello] — the publish cascade via `/cello-publish`
  (skill loaded, per publish), trustless-cello re-pinned, plugin skills updated for the
  multiplayer verbs and audited as SHIPPING content (tarball/clone, not source), and a **live
  smoke on the real fleet**: three real daemons, create → join → edit → fan out → converge →
  remove → seal. Andre runs the `latest` promotion — never this session. — ❌

---

## Decisions Carried (ruled 2026-08-11 — [[2026-08-10_2116_multiplayer-artifacts-joining-an-existing-document]] §13, binding)

- **D1 — full document on join, cheap path on history.** The joiner sees the whole current
  document; we build neither a history viewer nor history hiding; log replay is fine.
- **D2 — admin governance, not unanimity.** Admin set fixed at creation; single-admin powers per
  GOVERN-1; every act signed and on the record. The invariant-sentence trade was named and
  accepted deliberately.
- **D3 — removal is forward-only; admin removal takes all other admins.** Two admins = deadlock
  by design. No claim of reaching a local copy, ever. Voluntary-exit-only is the recorded V1
  fallback if the machinery proves heavy.
- **D4 — hub-and-spoke retired as a concept.** It was never a feature — two documents by hand
  remain possible by construction; the wire field survives; M14-P7 tooling stays parked.
- **D5 — cap 20**, inherited from group rooms. Andre: already a bit big; start there.
- **D6 — this milestone is M14B.** The former M14B (Tier 2) is
  [[COLLAB-TIER2-DEFINITION-OF-DONE]], unnumbered until scheduled; the epoch frame shape comes
  forward with THIS milestone.
- **D7 — a close settles on ALL current holders, not a pair.** Ruled 2026-08-13 under §3a (the
  live fleet smoke raised it; §13 had not covered it). The conservative direction is required, not
  preferred: settling early CLAIMS AN AGREEMENT THAT DOES NOT EXIST, and the lifecycle unit already
  forbids that in writing. Identical to the old behaviour for two parties. Reversal risk is
  asymmetric — loosening later (an admin closing for everyone) only widens what settles and
  strands nothing, whereas shipping the loose rule first leaves documents marked closed that never
  were, and no migration can un-say that. `DOD-MP-CLOSE-N-1`.
- **D8 — a removal COMPLETES the agreement on behalf of those who remain.** Ruled 2026-08-13 under
  §3a (raised by the CLOSE-N-1 review as a design call). A removed holder's silence no longer
  counts: they are not a holder, everyone who remains has agreed, and it is consistent with
  forward-only removal (D3). Without it the document sat `active` forever reporting it waited on
  nobody — control frames are fire-once, so nothing could ever settle it. This is the loosening
  and therefore reversible direction. **Overturnable by Andre; not a blocking question.**
- **Guards carried from the multiplayer log §11 — do not re-litigate:** floor control is not
  needed (a CRDT op is a spreadsheet cell, not an utterance); relaying is not the answer to
  delivery (every holder authors and delivers its own updates — no relay tier); arrays stay
  atomic (a journal is a keyed map, never an array); `append_only` buys ordering, not
  tamper-evidence for a mutable workflow record — no surface claims a multi-actor "tamper-evident
  audit trail" until field-level authority or a linked append-only journal ships (Tier 2+).

## Explicitly beyond M14B (so absence reads as intent, not omission)

- **Everything Tier 2** — canonicalization, per-batch attestation, the quiescence agreement,
  divergence records and recovery, purge, schema enforcement:
  [[COLLAB-TIER2-DEFINITION-OF-DONE]]. M14B ships the sockets (hash slot, signing primitive,
  identity spine); Tier 2 fills them.
- **History-from-here join** (snapshot at an epoch boundary) — the D1 fast-follow, taken up only
  if real use asks for it.
- **Pass-through / coordinator topology** (M14-P8) — parked; un-parks only on a product call.
- **`DOD-DOC-REBUTTAL-1`** — slipped "to M14B" on 2026-08-07 when M14B meant Tier 2; it stays
  with the Tier 2 wave, not here.
- **Voting/majority governance** beyond the admin model; **per-field write authority** (Tier 2
  schema work); **directory-side presence subscription** (M14-P4).
- **ADMIN PROMOTION AND ADMIN REMOVAL — PARKED HERE 2026-08-13 (§3a park, Entry 24).** The
  replay engine implements `promote_admin` and `remove_admin` fully, and GOVERN-1's enforcer
  line named three clauses about them — but NO VERB AUTHORS EITHER ONE, because
  `remove_admin` needs signatures gathered from every other admin across different machines and
  no wire carries a half-signed action between daemons. Those three clauses are parked OUT of
  DOD-MP-E2E-GOVERN-1 so the line can close on what it can actually prove; the capability is
  named below as owed work rather than left as an untestable clause.
  **Andre's call, unchanged:** either the gathering flow gets its own DoD line (a pending-
  governance inbox, a co-sign verb, expiry for a proposal nobody finishes signing — and, once
  fan-out exists, delivering a half-signed amendment to a specific admin is just another
  per-holder delivery), or promotion/demotion is declared out of scope in writing. Until then
  `cello_doc_remove`'s guidance says "demote first" about a verb that does not exist — the one
  operator-visible edge of this gap.
- **THE SEALING CLAUSE'S MESH DEFINITION (DOD-MP-E2E-JOIN-1) — DEFINED 2026-08-13 (§3a,
  Entry 24).** The line says "the session seals and the document leaves verify on all three
  sides", which assumes ONE shared session; three holders means three PAIRWISE sessions with
  three roots. Settled reading, least-reversal-risk: **each pairwise session seals, and BOTH of
  its two parties independently recompute the same root over a tree containing that pair's
  `0x04` document leaves** — exactly j-documents' bilateral proof, run per pair. Nothing about
  multiplayer changes what a seal is; it changes how many there are. Testing it is a
  straightforward extension of the existing bilateral pattern and is the JOIN-1 gap that
  remains.

---

## Related Documents
- [[M14B-PROCEDURE]] — the operating runbook; read FIRST
- [[M14B-BUILD-JOURNAL]] — audit trail + evidence home
- [[2026-08-10_2116_multiplayer-artifacts-joining-an-existing-document]] — spec-of-record:
  §6 mechanism, §9 phases, §13 rulings, §14 Tier-2-readiness constraints
- [[2026-07-31_federated-collaborative-state-architecture]] — §11 topology derivations, §16
  decision register (still binding wherever multiplayer touches V1 machinery)
- [[M14-DEFINITION-OF-DONE]] — V1's yardstick; its Tier I invariants are inherited here
- [[COLLAB-TIER2-DEFINITION-OF-DONE]] — the parked Tier 2 wave (formerly M14B); owns everything
  attestation-shaped
- [[2026-04-19_2045_group-room-design]] — the 20-participant cap's origin
