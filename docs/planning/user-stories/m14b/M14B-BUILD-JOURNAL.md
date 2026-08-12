---
name: M14B Build Journal
type: build-journal
date: 2026-08-11
milestone: M14B
status: open
topics: [m14b, multiplayer, collaborative-state, build-journal]
description: >
  Append-only audit trail for M14B (multiplayer documents). Entries at END OF FILE only; the
  RESUME STATE block at the top is the only thing overwritten in place. Full proofs, reviewer
  verdicts, and run output live here — the DoD stays a scoreboard.
---

# M14B Build Journal

## RESUME STATE (overwrite in place — the ONLY mutable block)

- **Next red:** `DOD-MP-INBOUND-N-1` (P2's second unit) — receive against N senders: per-sender
  `doc_prev_hash` chains validated per sender; an envelope from a non-holder (per the receiver's
  DERIVED participant set) refused by name; amendment-lag handling DEFINED (held/refused with a
  named reason, resolved when the amendment lands) — plus the two boundaries carried from
  FANOUT-1's review (Entry 16): late-joiner envelope service via JOIN-1 transfer (note, not
  build), and the one-holder-rejects-what-another-admitted supersession semantics. Much of the
  receive side already exists (sender-not-peer upgrade, epoch gates, membership refusals) —
  this unit's core is the PER-SENDER chain validation + the sender-is-a-holder gate replacing
  sender-is-the-genesis-peer, mirroring the ack-gate fix. Branch `m14b/inbound-n-1` from
  cello-client main (`a2ce49b`). FANOUT-1 is ✅ (Entry 16).
- **Superseded:** IN PROGRESS notes — the per-(envelope,
  holder) delivery-state store (`5f6f686`, 7 tests — per-holder attempts/backoff/ceiling/
  abandon, settle-once acks, PER-HOLDER bounded window via partitioned row numbering). REMAINING:
  (i) the WORKER rewrite — tick takes `holdersFor(documentId): string[]` (derived: genesis
  participants + amendment replay via the layer), pending from `pendingHolderDeliveries`,
  per-holder reachability probe + removed-target gate (generalize Entry 13's), per-holder
  unacked ceiling → holder exhausted (announced) → document stalled only when ALL exhausted;
  (ii) publish SEEDS deliveries for every current holder (document-publish.ts) + legacy
  bilateral rows backfill-on-first-pass; (iii) ack routing — the ACKING sender settles THEIR
  row (`ackHolderDelivery`), document-ack-inbound + layer awaitAck semantics; (iv) daemon.ts
  wiring (peerFor → holdersFor). Then Entry 14's checklist review + ONE unit review. Design:
  Entry 14.
- **Superseded:** WIRE HALF BUILT on `m14b/join-1`
  (`cello-client 2eb4160`, 18 tests, full gate): document-join.ts — the offer as a courier
  (received bytes of genesis + chain + log snapshot, signature binding every byte through
  hashes), and `validateDocumentJoinOffer`, the first production-facing consumer of
  deriveArrangement + the governance policy (invitee replays, never trusts). Remaining:
  DONE SO FAR on the branch: join-answer frame (`b717c54`, settle-once on the amendment hash)
  and the daemon join store (`dc66125`, both roles, refusals recorded never dropped). REMAINING:
  (i) DONE (`fe29225`): router kinds `join_offer`/`join_answer`/`amendment` + layer receive
  wiring — offers validated by replay before recording, answers settle-once, amendments to
  existing holders validate-the-whole-chain-then-append (the FIRST production append site,
  AMEND-1's condition upheld); `arrangementGenesisFromProposal` extracted to ONE export.
  Amendment delivery to existing holders is BEST-EFFORT at P1 (durable per-holder delivery is
  FANOUT-1); the inbound epoch gate makes a missed amendment loud, not silent.
  (ii) DONE (`dbe76e4`): the accept flow — layer.acceptJoin/refuseJoin, validate-everything-
  then-mutate (whole snapshot verified before one row lands; a bad envelope refuses the accept
  by name), mutations in dependency order (recordJoined genesis → chain → row(peer=inviter) →
  log → rebuild → file), consent settles once, signed answer returned for best-effort send.
  (iii) NEXT — the HANDLER surfaces: cello_doc_inbox lists pending joins; cello_doc_accept/
  refuse route by pending kind (proposal vs join, matched by document_id → amendmentHash) and
  send the answer via a tellInviter twin of tellProposer (document-handlers.ts:~438);
  (iv) the invite verb + (v) REMOVE-1 + layer-path tests, then ONE review. SUPERSEDED plan text
  below kept for the record — the accept flow: re-validate stored bytes → append chain to DocumentAmendmentStore
  (VALIDATE-BEFORE-APPEND BINDS) → record genesis into document_proposals (LiveDocuments reads
  starting_content from there) → create documents row (peerAgentId = the inviter pre-P2, a
  journaled nuance) → materialize envelope_log (verify per-envelope sig + set-based chain,
  appendEnvelope, rebuild) → send signed answer via transport.sendBytes;
  (iii) inviter verb `cello_doc_invite` (four lockstep surfaces + vocabulary) — author amendment,
  validate-then-append, assemble offer, sendBytes to invitee + amendment frame to other holders;
  (iv) DOD-MP-REMOVE-1. Then ONE review on the whole diff.
- **Superseded context (kept for the record):** the wire half was built first on `m14b/amend-1`
  (`cello-client 57e06e6`, 30 tests green, full gate): document-amendment.ts — final-shape frame,
  strict codec, `deriveArrangement` replay with injected GOVERN-1 policy seam, last-admin +
  cap-20 invariants, frozen vector. Remaining on the unit: (i) the `document_amendments`
  append-only store (received bytes, keyed owner/document/epoch) + an arrangement accessor;
  (ii) epoch producers stamp from replay (publish `document-publish.ts:137`, rejection
  `document-rejection.ts:246`), `list` reads real value, quarantine stubs; (iii) decoder
  relaxation (`document-envelope.ts:203–207` → integer-shape only) with epoch correctness moving
  to inbound; (iv) the proposal admin-slot preimage change (feature_version 2, vector reissue).
  Then ONE review on the whole unit's diff.
- **Tiers:** P0 ✅✅✅✅ · P1 ✅✅ · P2 ✅❌ (FANOUT-1 ✅; INBOUND-N-1 next) · P3 ❌ · P4 ❌❌❌❌❌
- **Branches in flight:** none.
- **Publishes this milestone:** none. (M14 defect-fix commits `6a26e21` + `59c1814` and SIG-1
  ride the next ordinary publish — SIG-1 has no wire consumer until AMEND-1, so nothing skews.)
- **Parked:** nothing yet.

---

## Entry 0 — Milestone setup (2026-08-11)

M14B stood up on Andre's D6 ruling ([[2026-08-10_2116_multiplayer-artifacts-joining-an-existing-document]] §13).

**What exists as of this entry:**
- [[M14B-DEFINITION-OF-DONE]] — 14 status-tagged lines across P0–P4, all ❌; Tier I carries the
  invariants (amendment validity, governance on the record, forward-only removal, the four
  Tier-2-readiness constraints, the inherited M14 six, and the exit criterion: Tier 2 must be
  able to activate rewriting nothing M14B shipped).
- [[M14B-PROCEDURE]] — self-contained runbook; §1c defines the four three-daemon enforcers
  (governance · join · fan-out · removal).
- This journal.

**The name handoff, for the record:** M14B previously named the Tier 2 wave (canonicalization,
attestation, epochs-beyond-zero, purge, schema enforcement). That DoD was renamed to
[[COLLAB-TIER2-DEFINITION-OF-DONE]] (unnumbered, still parked, scope unchanged) and every
reference in the living docs re-pointed — M14 DoD/procedure, the architecture log (§16.1 carries
a dated correction), launch-triage item on the rebuttal deferral. Historical prose in
[[M14-BUILD-JOURNAL]] left untouched per append-only discipline. The epoch frame shape comes
forward to M14B per §14 constraint 1; everything else attestation-shaped stays parked.

**Spec-of-record:** the multiplayer log — §6 (amendment mechanism), §9 (phases), §13 (the six
rulings, 2026-08-11), §14 (Tier-2-readiness constraints, binding as reviewer lenses). §11/§16 of
[[2026-07-31_federated-collaborative-state-architecture]] still bind wherever M14B touches V1
machinery.

**First action:** `DOD-MP-TRACE-1` — confirm before building; the multiplayer log itself flags
the fan-out shape as "the first thing to confirm, not to assume."

---

## Entry 1 — DOD-MP-TRACE-1: the confirm-first trace (2026-08-11)

**Target:** file/line map of the five seams multiplayer builds on; divergences from the
multiplayer log's assumptions become ACs on downstream units. All paths `cello-client` at
`6a26e21` unless noted.

### (a) The delivery worker — single-peer by signature, ack state on the envelope row

- `DocumentDelivery.tick(ownerAgentId, peerFor, …)` — `core/daemon/src/document-delivery.ts:228`;
  `peerFor(documentId): string | null` returns ONE peer. Grouping is by document (`:283`), one
  reachability lookup per document per pass.
- Ack state lives ON the envelope row: `delivered_at`, `acked_at`, `abandoned_at`, `attempts`,
  `next_attempt_at` — `core/daemon/src/document-store.ts:203–224`. `pendingDeliveries`
  (`:905–926`) filters `acked_at IS NULL AND abandoned_at IS NULL` over a bounded, ordered
  window.
- **Stall is document-global on ONE peer's silence:** at `DELIVERY_MAX_UNACKED_SENDS` (5) the
  worker sets the whole document `stalled` and abandons the envelope
  (`document-delivery.ts:440–441`).
- The transport seam (`isPeerReachable`, `deliver`, `sendBytes`) is single-peer per call —
  reusable per holder unchanged. The pass-level ack-grace budget (30s) carries over as-is.

**→ ACs on DOD-MP-FANOUT-1:** (1) delivery state moves to a per-`(envelope, holder)` table —
one row's columns cannot carry N acks; (2) `peerFor` becomes `holdersFor(documentId)` derived
from amendment replay; (3) stall/abandon become PER HOLDER — document-level stall only when
every current holder is exhausted, else one dead holder stalls the document for everyone;
(4) reachability, backoff, and the unacked ceiling are per holder; (5) the pending window is
bounded per holder — the `no_peer` starvation note at `document-delivery.ts:294–299` shows the
shared ordered window already starves under one stuck document, and N holders multiply it.

### (b) Topology refusal — three call sites, one function

`seamViolation` (`core/protocol-types/src/document-proposal.ts:182`; topology clause `:211`
against `TOPOLOGY_V1 = "hub-and-spoke"`, `:50`). Called at: propose
(`core/daemon/src/document-handlers.ts:309`), arrival
(`core/daemon/src/document-handshake.ts:189`), accept (`document-handshake.ts:424`). The
DECODER deliberately does not check the seam (`document-proposal.ts:296–300`) so an
incompatible proposal stays answerable — keep that.

**→ AC on DOD-MP-TOPOLOGY-1:** the accepted-value set changes in ONE place (the constant/set in
`document-proposal.ts`); all three sites follow. Mesh-as-default is set where the propose
handler builds properties (`document-handlers.ts` propose path).

### (c) `epoch_id` — one producer, one hard gate

- Producer: `document-publish.ts:137` stamps `DOCUMENT_EPOCH_V1` (0) on every envelope.
- **The hard gate: the envelope DECODER refuses `epoch_id !== 0`** —
  `core/protocol-types/src/document-envelope.ts:203–207`. This is the single line that would
  refuse every post-amendment envelope.
- Otherwise threaded inert: store `:455/:1331`, inbound `:431`.

**→ ACs on DOD-MP-AMEND-1:** the decoder relaxes to integer-shape validation only — epoch
CORRECTNESS moves to the inbound path, the only place that knows the document's current epoch
from replay (a decoder cannot); publish stamps the current epoch from replay, not the constant.

### (d) Properties — immutability is enforced by absence + id-binding, and readers are enumerable

- Properties ride the SIGNED genesis preimage (`buildDocumentProposalTbs`,
  `document-proposal.ts:119–156`) and are thereby bound into `document_id`. Immutability after
  accept is enforced by (i) no mutate API existing (`:55–58` states this is deliberate) and
  (ii) the id-binding — there is no runtime "reject a property change" check to remove.
- Readers of the stored `documents.properties`: `document-inbound.ts:103` (`append_only`),
  `:387` (`content_profile`); `document-handlers.ts:482`, `:523`, `:914`.
- The proposal record stores RE-ENCODED bytes, not the received wire
  (`document-handshake.ts:204`, `:267`).

**→ ACs on DOD-MP-AMEND-1/GOVERN-1:** genesis properties stay as-signed (id-bound, never
edited); CURRENT properties become a derived view (genesis + `change_property` amendments) and
every reader above consumes the derived view; any frame whose hash or signature matters (join
offers, amendments) is stored as RECEIVED BYTES, not re-encoded — the class of defect fixed
below. **The admin set at creation needs a slot in the SIGNED proposal preimage**, which changes
`document_id` for every proposal → one batched preimage change + frozen-vector reissue +
`feature_version` bump to 2, free now for the same reason `content_profile`'s slot was
(no documents exist), and never free again.

### (e) The consent handshake — the join frame's template, with one check it lacks

`recordProposal` (`document-handshake.ts:142`): signature verified against the NAMED proposer
(`:157`, fatal — poisoned-id race documented at `:150–156`); addressed-to-us (`:173`); version
answer + seam recorded as refusal, never dropped (`:188–189`); first-arrival-wins primary key.
Settle-once peer decisions exist (`recordPeerDecision`, `:286`; `document-proposal-ack.ts`).

**→ Shape for DOD-MP-JOIN-1:** a join offer is a NEW frame reusing this template — proposer =
the inviting ADMIN (verified against the inviter's key AND their admin status per replay at that
epoch — a check `recordProposal` has no analog for), peer = invitee, carrying the genesis + the
amendment chain so the invitee derives the arrangement independently, plus
`assurance_tier`/`feature_version`. It must NOT mint a `document_id` (no nonce — the document
exists; the amendment hash is the settle key). The proposal-ack settle-once pattern carries
over.

### Defects found while tracing

1. **`content_profile` was signed but not sendable — FIXED** (`cello-client 6a26e21`, red-first,
   full gate green). `buildDocumentProposalTbs` signs the profile slot, but
   `encodeDocumentProposal` omitted the field and `decodeDocumentProposal` never read it — the
   first profiled proposal would fail signature verification at the receiver (preimage rebuilt
   with `null`). Latent (nothing sets a profile at propose yet — sole producer path absent,
   verified by grep); would have gone live with launch-triage item 20. Absent-stays-absent
   preserved, so existing encodings are byte-identical.
2. **Stored proposals are re-encoded, not received bytes** (`document-handshake.ts:204/:267`) —
   harmless now the codec is total, but the pattern is the hazard class of (1). Join/amendment
   frames store received bytes (AC above).

**No code shipped from this line** beyond the defect fix, which is M14's, not scope pulled
forward.

---

## Entry 2 — TRACE-1 review verdict + the corrected epoch map (2026-08-11)

**Reviewer verdict (`cello-unit-reviewer`, one pass, quoted):** "SPEC: DEVIATIONS FOUND — clause
(c) is an incomplete map ('one producer' is factually wrong; three hardcoded-0 sites and the
delivery re-encode uncited). Blocking until a journal addendum amends the map and widens the
AMEND-1 AC; clauses (a), (b), (d), (e) are faithful with citations verified. NO SILENT FALLBACKS.
ERRORS NAME THEIR CAUSE. TESTS HAVE TEETH — test 1 survives THE REVERT TEST; one untested
validation branch noted (LOW)." Findings: 1 blocking, 3 low. All fixed; disposition below.

### The corrected clause (c) — every producer and consumer of `epoch_id` (supersedes Entry 1's)

**Producers (locally authored values):**
- `document-publish.ts:137` — publish stamps `DOCUMENT_EPOCH_V1` (0) on every update envelope.
- **`document-rejection.ts:246` — rejection envelopes are locally-authored chain entries with a
  hardcoded `epochId: 0`.** The second producer Entry 1 missed: a document at epoch N would
  append rejections still claiming epoch 0.
- `document-store.ts:553` — the quarantine bridge stubs carry hardcoded `epochId: 0`
  (verification-only today; named so it is cleared, not discovered).
- `document-lifecycle.ts:177` — the `list` surface hardcodes `epochId: 0` per document: after
  any amendment it would report epoch 0 forever, no error anywhere.

**Consumers / threading:**
- `document-envelope.ts:203–207` — the decoder's hard refusal of `epoch_id !== 0` (the gate).
- **`document-envelope.ts:100` — `epoch_id` is INSIDE the signed TBS** (omitted from Entry 1 and
  material: post-verification, the inbound path can trust the decoded value — the relocation AC
  rests on this).
- `daemon.ts:3801` — the delivery-path wire re-encode reads `envelope.epochId` from the stored
  row: the actual wire producer for delivered frames.
- Threading: store `:455/:1331`, inbound `:431`.

**AMEND-1's AC, widened accordingly (DoD updated in place):** every locally-authored envelope —
publish AND rejection — stamps the current epoch from replay; `list` reads the real value; the
quarantine stubs read the real value or are explicitly exempted with a journaled reason; the
decoder relaxes to integer-shape only and epoch correctness moves to inbound, which may trust
the decoded value because it sits in the signed TBS.

### Disposition of the other findings

- **LOW, citations:** `pendingDeliveries` begins at `document-store.ts:885` (Entry 1 cited its
  WHERE clauses); the seam-blind-decoder comment is `document-proposal.ts:303–308`. Corrected
  here rather than editing Entry 1 (append-only).
- **LOW, test gap:** the malformed-`content_profile` refusal branch was revert-invisible — a
  test now pins the named throw for non-string/empty/null (`cello-client 59c1814`).
- **LOW, canonical form:** absent is the only wire encoding of "no profile"; explicit null is
  refused though the TBS folds both to one slot — now stated in the codec comment
  (`cello-client 59c1814`) so a second implementation learns it from the source, not from a
  refused proposal.
- Reviewer confirmed the Tier-2-readiness lenses hold on every AC Entry 1 wrote; one word
  added to the DoD's admin-slot AC: admins are keyed by pubkey/`agent_id` (constraint 3).

**DOD-MP-TRACE-1 flips ✅ on this entry.**

---

## Entry 3 — DOD-MP-AMEND-1: clause checklist + design (pre-implementation, 2026-08-11)

**Target in one sentence:** an amendment is a signed epoch event in its final frame shape, and
replaying genesis + the chain independently derives {participants, admins, properties} on every
holder — or refuses loudly naming the gap.

### Clause checklist (what the reviewer will receive)

1. Amendment record IS an epoch event in FINAL frame shape (TIER2-READY 1): signed via SIG-1
   collections, chained to the previous epoch, `epoch_id` increments past 0, canonical-hash slot
   defined-absent.
2. Kinds: `add_holder` | `remove_holder` | `promote_admin` | `remove_admin` | `change_property`.
3. Replay derives {participant set, admin set, properties} from genesis + chain.
4. Gap / unknown predecessor / invalid amendment → loud refusal naming the gap.
5. Store keyed `document_id`/`agent_id`; amendments are append-only log records, never edits.
6. [TRACE-1, Entry 2] publish AND rejection stamp epoch from replay; `list` reads the real
   value; quarantine stubs read real or exempted with reason; decoder relaxes to integer-shape;
   epoch correctness moves to inbound (trustable — `epoch_id` is in the signed TBS).
7. [TRACE-1, Entry 2] admin set at creation = new slot in the SIGNED proposal preimage, keyed by
   pubkey/`agent_id`, one batched preimage change, frozen-vector reissue, `feature_version` 2.

### Design (pseudocode level — RFC 8032 for signatures via SIG-1, RFC 6962 not implicated)

- **Wire (`core/protocol-types/document-amendment.ts`):** `CELLO-DOCUMENT-AMENDMENT-v1` TBS —
  fixed-order CBOR array: domain, `document_id`, `epoch_id` (the epoch this amendment MINTS =
  prev + 1), `prev_amendment_hash` (null for the first — the chain anchors to genesis through
  `document_id`), `kind`, `subject_agent_id` (pubkey hex; null for `change_property`),
  `property_change` {key, value} | null, `state_hash` (null — the defined-absent Tier 2 slot),
  `authored_at_ms`. `amendmentHash` = sha256 over the TBS preimage. The SIG-1 collection rides
  beside the body with `subject_kind: "document_amendment"`, `subject_hash: amendmentHash` — the
  preimage each admin/holder actually signs commits to the exact amendment AND the exact
  co-signer set.
- **Policy seam:** replay takes `requiredSignersFor(kind, subjectAgentId, currentAdmins,
  currentParticipants): string[]` INJECTED — GOVERN-1 implements it. AMEND-1's replay owns
  mechanics (chain, completeness via `collectionStatus`, application order); GOVERN-1 owns who
  must sign what. Keeps both units reviewable against their own DoD lines.
- **Replay (`deriveArrangement`, pure):** start from genesis {proposer, peer, adminSet,
  properties}; per amendment in epoch order: verify chain link (epoch = prev+1,
  `prev_amendment_hash` matches), compute required set per policy AGAINST THE STATE BEFORE THIS
  AMENDMENT, verify collection completeness (SIG-1), apply. Any failure → typed refusal naming
  epoch + cause; never a partial arrangement.
- **Daemon store:** `document_amendments` table, append-only, keyed
  (`owner_agent_id`, `document_id`, `epoch_id`); received amendment frames stored as RECEIVED
  BYTES (Entry 1 (d) AC).
- **Epoch producers:** publish + rejection stamp from the derived current epoch; decoder
  relaxation per checklist 6.

**Sequencing note:** implementation starts when SIG-1's review lands and `m14b/sig-1` merges —
both units export through `core/protocol-types/src/index.ts`, and two branches never touch one
file. Checklist and design recorded now so the next session (or wake) starts at red tests, not
at design.

---

## Entry 4 — SIG-1 review verdict, findings fixed, merged (2026-08-11)

**Reviewer verdict (`cello-unit-reviewer`, one pass, quoted):** "SPEC: DEVIATIONS FOUND — the
domain tag, un-journaled (one journal line + DoD text amendment clears it, no code change). NO
SILENT FALLBACKS. ERRORS NAME THEIR CAUSE. TESTS HAVE TEETH — all 16 survive the revert test;
the decode-strictness gap is a coverage hole to close, not a hollow test. REMOVALS PROVEN — n/a."
Findings: 1 blocking (process), 1 medium, 1 low. All fixed (`cello-client 32d7dec`); merged to
main (`f575a97`), branch deleted.

**DECISION — the multisig domain tag is `CELLO-DOCUMENT-MULTISIG-v1`,** superseding the DoD
line's abbreviated `CELLO-DOC-MULTISIG-v1`. Every sibling document domain is `CELLO-DOCUMENT-*`
(PROPOSAL, UPDATE, ACK, CONTROL, REJECTION); the abbreviation would be the odd one out, and the
frozen vector now pins the full spelling — flipping it later voids every signature. DoD line
amended to match.

**Findings disposition:**
- **Medium (decode strictness):** every decode refusal is now pinned per field with its named
  code (11-case parameterized test + non-map root), so a future coercing edit cannot return
  silently through an unwatched field.
- **Low (dead branch):** the missing-computation's redundant second filter removed — missing is
  strictly "no row present".
- **Recommended and taken:** the compensation attack (invalid signature + a second valid one
  from the same signer) tested directly; `duplicates` asserted in the all-signed baseline.

Final: 29 tests, full gate green, real Ed25519 throughout.

**DOD-MP-SIG-1 flips ✅ on this entry.**

---

## Entry 5 — AMEND-1 code-complete; decisions taken in-unit (2026-08-11)

Branch `m14b/amend-1`, four commits (`57e06e6` wire+replay, `058957e` admin slot, `2129738`
store, `e7b427b` epoch wiring). Full gate green after each. Review dispatched on the whole diff.

**Checklist verdicts (Entry 3's list):** 1–5 built as specified; 6 built with one exemption
(quarantine stubs stay at epoch 0 — synthetic verification nodes, chain walk checks hash linkage
only, documented in place); 7 built (admin slot, feature_version 2, both frozen vectors
reissued deliberately — documents still do not exist).

**Decisions taken in-unit (§3a authority, all reversible pre-launch):**
- **Admin slot enters the TBS as a canonical SCALAR** (sorted pubkeys joined by ","), not an
  array — the proposal preimage carries a pinned flatness invariant (no nested containers) whose
  reason is container-encoding independence of `document_id`. The wire carries the real array,
  canonicalized sorted on decode.
- **Absent admin_set = every genesis participant is an admin.** The bilateral default: either
  party can invite. The creation flow making the choice legible is GOVERN-1's AC.
- **The amendable-property set starts at {append_only}.** Tier and schema changes are Tier 2
  epoch events; topology and content_profile are identity-shaped — a new agreement, not an
  amendment. Widening is a one-line journaled decision; shrinking after documents exist is a
  migration.
- **Store contiguity at append:** an out-of-order amendment refuses by name and the sender
  retries — lag BUFFERING is INBOUND-N-1's design, not silently absorbed here.
- **Epoch stamping reads `DocumentStore.currentDocumentEpoch`** (max recorded epoch) rather
  than running full replay per publish — sound under the **validate-before-append invariant**:
  every path that appends to `document_amendments` must run `deriveArrangement` first, so the
  recorded head IS the replay's answer. Named here as a standing invariant; INBOUND-N-1/JOIN-1
  reviews must enforce it on every new append site.
- **Epoch mismatch directions differ:** behind = TERMINAL (`document_epoch_stale` — the TBS
  binds the old epoch forever; republish under current); ahead = non-terminal
  (`document_epoch_ahead` — our amendment is in flight; their retry resolves).

**Stated plainly for the reviewer and the DoD evidence line:** `DocumentAmendmentStore.append`
and `.chain` have NO production caller yet — their callers are JOIN-1/INBOUND-N-1 (receive
side) and GOVERN-1 (authoring side). The consumed surface today is `currentDocumentEpoch`
(publish, rejection, list, inbound ruling). This is the ENVELOPE-1 shape (types one unit ahead
of their consumer), not the DELIVERY-2 defect (a worker constructed and never ticked) — but it
is the same genus, so it is named, not hidden.

**Red-first slippage, recorded:** the store's tests were written before the module but run only
after — the explicit red run was skipped once. The amendment/proposal/envelope suites all had
their red runs.

---

## Entry 6 — AMEND-1 review verdict, findings fixed, merged (2026-08-11)

**Reviewer verdict (`cello-unit-reviewer`, one pass, quoted):** "SPEC: FAITHFUL — the one
deviation (stamp from store head, not live replay) is journaled in Entry 5 and therefore legal.
SILENT FALLBACKS FOUND — F2 (MEDIUM). ERRORS NAME THEIR CAUSE. HOLLOW TESTS FOUND — T1
[blocking]: publish, rejection, and list epoch stamping are all revert-invisible; T2: fork/gap
order unpinned. REMOVALS PROVEN — the decoder relaxation is the DoD's own instruction, relocated
with coverage on both sides." No-consumer ruling: "ACCEPTABLE — ENVELOPE-1 shape, not
DELIVERY-2," conditioned on JOIN-1/INBOUND-N-1/GOVERN-1 reviews enforcing the
validate-before-append invariant on every new append site — carried forward as a standing
condition on those units.

**Findings disposition — all four fixed (`cello-client 06029da`, merged `5108e12`):**
- **F1 (HIGH):** admin entries enforced 64-hex at `canonicalAdminSet` — the comma-joined TBS
  scalar was collision-free only by assumption; `["aa,bb"]` vs `["aa","bb"]` could have shared
  one `document_id` and one valid signature. The charset is now the boundary, test-pinned with
  the exact collision probe.
- **F2 (MEDIUM):** the state-hash tier gate inverted to a whitelist (only `"attested"` defines
  the slot) — a genesis missing the tier property now refuses loudly instead of degraded-accept.
- **T1 (blocking):** epoch stamping made revert-visible in all three producers — each test
  plants a non-empty amendment chain and asserts the stamped value; the stale
  "constants in V1" comment rewritten.
- **T2:** skipped-epoch-with-unknown-predecessor pinned as GAP, so the fork/gap diagnosis order
  cannot silently swap.

Also carried, non-blocking, from the report: unsorted admin_set wire accepted-and-canonicalized
(journaled decision, softer canon than the file's null-rule — acceptable while sole
implementation); `DOCUMENT_EPOCH_V1` is export-only now (delete when its documentary value
expires).

Final: full gate green; the cross-repo check confirmed no trustless-cello consumer of the
changed exports, so the feature_version bump is client-contained.

**DOD-MP-AMEND-1 flips ✅ on this entry.**

---

## Entry 7 — GOVERN-1 code-complete; the policy is a verdict, not a minted set (2026-08-11)

Branch `m14b/govern-1`, one commit (`2fba725`). Full gate green. Review dispatched.

**Design shift discovered at the unit's front door:** AMEND-1's policy seam returned a single
required set — but D2's "any single admin may act" has no single answer ({a} and {b} are both
acceptable claims). The seam reshaped to a VERDICT on the collection's claimed set:
`SignerPolicy(kind, subject, state, claimedRequiredSet) → ok | {reason}`. AMEND-1's replay calls
it in place of set-equality; its stand-in policy and tests updated in the same commit.

**One hole found and closed while writing the red tests:** without a guard, one admin's
signature could `remove_holder` a FELLOW ADMIN — holder removal drops admin status too, so the
single-admin rule would evade `remove_admin`'s all-others requirement and the two-admin
deadlock in one move. `governance_remove_admin_first` refuses it; voluntary self-leave stays
open (checked first, so a leaving admin is not told to demote themselves).

**The rules as shipped:** single-admin kinds claim exactly ONE current admin (a wider claim is
refused — every claimed signer must sign, so an inflated claim hands an absent co-signer a veto
the rule does not grant); `remove_admin` claims ALL OTHER admins exactly, subject neither
required nor counted; two admins = deadlock by design, recourse named in the refusal;
self-signed leave always acceptable.

**Creation legibility:** `cello_doc_propose` (tool + CLI `--admins` + daemon) writes the admin
choice into the SIGNED proposal on every propose — the everyone default is recorded explicitly,
never implied by absence; an admin who is not a party refuses with nothing created.

**Carried:** the documents plugin skill's guidance on choosing admins rides the ship line's
skill audit, not this unit. **Red-first slippage, recorded:** the governance suites ran first
only after the module existed; the handler tests were written after the surface change.

---

## Entry 8 — GOVERN-1 review verdict, findings fixed, merged — P0 ALL GREEN (2026-08-11)

**Reviewer verdict (`cello-unit-reviewer`, one pass, quoted):** "SPEC: DEVIATIONS FOUND —
[blocking]: the bilateral change_property proof clause is unmet (F1), and the invitee-consent
clause is un-journaled (F2, disposition line suffices). NO SILENT FALLBACKS. ERRORS NAME THEIR
CAUSE. HOLLOW TESTS FOUND — one: the change_property policy row asserts on an impossible input
shape; every other new test survives THE REVERT TEST (verified individually). REMOVALS PROVEN."
The adversarial pass confirmed the voluntary-leave door is enforced by signature possession
(the claim completes only with the subject's own Ed25519 signature over a TBS committing to the
claimed set), and the deadlock guard cannot fire on states the replay's earlier checks exclude.

**Findings disposition — all fixed (`cello-client 92b7d56`, merged `4523716`):**
- **F1 (HIGH):** the DoD's proof clause now RUNS: two parties, one admin's signature flips
  `append_only` under the real policy; the identical amendment with the signature absent is
  rejected naming the missing signer. The hollow row asserts on `subject: null`.
- **F2 (MEDIUM) — DISPOSITION:** the "plus the invitee's own consent" clause of `add_holder` is
  **carried by DOD-MP-JOIN-1**, whose line already states it: "a join is not effective until
  both the amendment is valid AND the invitee has consented — neither alone admits anyone." The
  policy deliberately refuses expressing consent inside the collection (an inflated claim is a
  veto smuggled through the claim); consent rides the offer/accept handshake JOIN-1 builds.
- **F3 (LOW):** stale mint-model comment rewritten. **F4 (LOW):** a duplicated claim refuses at
  the policy gate rather than being deduped into a collection the multisig layer throws on.
- **Also taken:** AMEND-1's DoD evidence line gains a pointer to Entry 7's seam reshape so the
  record does not describe a seam that no longer exists.

**Said out loud, per the report:** no production code consults `documentGovernancePolicy` or
`deriveArrangement` yet — today the admin set is signed bytes plus a policy nobody in
production runs. The apply/receive units (JOIN-1, INBOUND-N-1) wire them, under AMEND-1's
standing validate-before-append condition.

**DOD-MP-GOVERN-1 flips ✅ on this entry. Tier P0 is ALL GREEN.**

---

## Entry 9 — DOD-MP-JOIN-1: clause checklist + design (pre-implementation, 2026-08-11)

**Target in one sentence:** a third party enters an existing document through an admin's
`add_holder` amendment PLUS their own signed consent — neither alone admits anyone — and
materializes the full current document from the log.

### Clause checklist
1. Join offer = a NEW frame carrying: the genesis proposal (RECEIVED bytes — Entry 1(d) rule),
   the FULL amendment chain including the pending `add_holder`, the envelope-log snapshot (D1's
   cheap path — the joiner materializes the whole document), `assurance_tier`,
   `feature_version`. No `document_id` minting; the amendment hash is the settle key.
2. Invitee side: decode → verify genesis id + signature → **replay the chain including the
   pending amendment via `deriveArrangement` + `documentGovernancePolicy`** — the FIRST
   production callers of both (AMEND-1's validate-before-append condition BINDS here) → surface
   in the doc inbox with the rules visible (arrangement, admins, properties) → operator
   accepts/refuses; the answer is a signed settle-once ack (the proposal-ack pattern).
3. Join EFFECTIVE only when amendment valid AND invitee consented (GOVERN-1's dispositioned
   consent clause, Entry 8).
4. Unsupported build refused with a sentence at BOTH ends (`feature_version`), and
   `assurance_tier` visible to the invitee before consent (TIER2-READY 4).
5. Removal (`DOD-MP-REMOVE-1`) rides the same machinery: forward-only, surfaced to the removed
   operator, their next publish refused by name (proven per-unit; the enforcer is P4's).

### Design decisions to take in-unit (both derivable from settled rulings — not Andre-gates)
- **The documents-table shape for N parties:** `documents.peer_agent_id` stays as the GENESIS
  counterparty (a display/legacy fact); every consumer that matters derives participants from
  the replay (TRACE-1's derived-view AC). No schema rebuild in JOIN-1; FANOUT-1's per-holder
  delivery table is where N-party delivery state lands.
- **Content sync at join:** the offer carries the envelope-log snapshot (received bytes,
  per-sender chains intact) — bounded by document size, fine at V1 scale, and honest before P2
  exists: arrangement-level admission works end to end while LIVE flow to the third party lands
  with FANOUT-1. Alternative (back-fill via ordinary delivery) requires per-holder ack state =
  P2 machinery; rejected for ordering.

### Sequencing note
Implementation on `m14b/join-1` from cello-client `4523716`: wire frame first (red tests), then
the invitee receive path, then the inviter authoring path + tool surface (`cello_doc_invite` or
an extension of existing verbs — decide against the vocabulary guard in-unit), then REMOVE-1.

---

## Entry 10 — JOIN-1 code-complete; decisions taken in-unit (2026-08-12)

Branch `m14b/join-1`, eight commits (`2eb4160` offer wire + validation, `b717c54` answer frame,
`dc66125` join store, `fe29225` router + receive wiring, `dbe76e4` accept flow, `fe92f45`
handler surfaces, `48be16a` invite verb ×4 surfaces, `81b7120` roundtrip proof). Full gate green
after each. Review dispatched on the whole diff.

**The proof that matters:** the in-process roundtrip — invite → offer crosses → inbox →
accept-BY-DERIVATION → content materialized from the snapshot → both daemons derive epoch 1 →
the signed answer settles on the inviter. Plus the negative: a non-admin cannot even mint an
offer. (Three real OS processes is the P4 join enforcer's job; this is the strongest
single-process evidence.)

**Decisions taken in-unit (§3a authority):**
- **The offer is a courier:** the invitee replays the carried bytes and consents to what it
  COMPUTED; the offer's signature binds every carried byte so a misleading bundle of
  individually-valid pieces is attributable.
- **Consent decided with the EXISTING verbs:** joins list in `cello_doc_inbox` beside proposals
  and are decided by `cello_doc_accept`/`refuse` (routed by exact pending match) — no new consent
  vocabulary; ONE new verb total (`cello_doc_invite`), all four lockstep surfaces + the three
  guards that fired on it.
- **Snapshot re-encode is lossless and used:** update rows carry every TBS field (client id is a
  column, encoding a pinned constant) — the same re-encode the delivery path ships. Rejection
  records stay local (quarantine bridging is receiver-side state, not shared history).
- **Re-invite re-sends the stored offer** (the proposal `--retry` precedent) — authoring afresh
  would try to admit an already-admitted holder, which the replay refuses.
- **Amendment delivery to existing holders is BEST-EFFORT at P1**, reported per holder, never
  assumed; durable per-holder delivery is FANOUT-1, and the inbound epoch gate makes a missed
  amendment loud (stale/ahead refusals name the mismatch), not silent.
- **Historical snapshot envelopes are accepted at the epoch their SIGNED bytes claim** — the
  inbound epoch gate is for live arrivals; a snapshot legitimately spans epochs.
- **`recordJoined`** is the handshake store's third write path (the joiner is neither addressee
  nor author) — forced through the immutability allowlist test with its justification.
- **Consent clause closed:** GOVERN-1's dispositioned invitee-consent clause (Entry 8) is
  implemented here — a join is effective only when the amendment is valid AND the invitee's
  signed accept ran; `acceptJoin` re-validates at the moment of consequence.

**Validate-before-append upheld at both new production append sites** (receive-side
`recordAmendment` replays the whole chain including the arrival; authoring-side invite validates
the chain including the new amendment) — the AMEND-1 standing condition, for the reviewer to
verify.

**REMOVE-1 is NOT in this diff** — it is its own DoD line and follows as its own unit. One open
design note for it, parked with a name: authoring `remove_admin` needs an N-signature GATHERING
flow across daemons (partial collections are storable; no line owns the gathering wire). Single-
signer removals (non-admin holders, voluntary leave) need no gathering and are REMOVE-1's scope.

---

## Entry 11 — JOIN-1 review verdict, all findings fixed, merged (2026-08-12)

**Reviewer verdict (`cello-unit-reviewer`, one pass, quoted):** "SPEC: DEVIATIONS FOUND —
see-the-rules at the surface, assurance_tier visibility, and both-ends refusal are unmet
[blocking]. SILENT FALLBACKS FOUND — F1 (poisoned settle key silently suppresses a real offer)
and F3 (auto-refusals invisible from every chair) are HIGH and must fail loud before this unit
closes. ERRORS NAME THEIR CAUSE. HOLLOW TESTS FOUND — untested recordAmendment
(revert-invisible), unpinned consent-required half, untested refuse branch. REMOVALS PROVEN."
Ten findings; the review also confirmed the roundtrip fixtures do genuine cross-key
verification, the accept mutate order is idempotent-and-recoverable up to the decide, and the
check order trusts nothing before its signature.

**All ten fixed (`cello-client 66253b6`, merged `d0e079b`) — the two that mattered most:**
- **F1 settle-key poisoning (HIGH):** any party holding the amendment bytes could deliver a
  garbage offer FIRST, occupy the real settle key with a refused row, and the genuine offer met
  DO-NOTHING — a silent veto over an admin's admission. Now: unauthenticated failures THROW
  (nothing recorded, the forged-proposal treatment); authenticated refusals record under the
  hash of their OWN bytes and can never occupy a real join's key.
- **F4 planted content (HIGH):** snapshot envelopes were verified for signature but not
  membership — an inviter could plant envelopes by never-holders and the joiner materialized
  content no legitimate holder saw. Now refused unless the sender held the document at some
  epoch of the carried chain.
- Also: the rules the invitee consents to are SHOWN in the inbox (derived by replay); refusals
  reach both ends (refused-joins listing + signed auto-answer for authenticated offers);
  redelivery of a decided offer re-sends the standing answer (the lost-answer recovery);
  re-invite re-fans the amendment to stale holders (the epoch-stale guidance now names a
  recovery that works); rival pending joins settle refused instead of wedging.

**And the bug the demanded test exposed:** the amendment wire frame had NO type discriminator —
the router classified every fan-out amendment as conversation, so the existing-holder delivery
path had never actually worked. Found the moment the review's revert-visible receive-side test
ran. A frame field, not a TBS field: no hash or signature moved.

Final: 34 handler tests including the three-daemon amendment-receive proof with a forged
amendment refused; full gate green.

**DOD-MP-JOIN-1 flips ✅ on this entry.**

---

## Entry 12 — REMOVE-1 code-complete; removal is DERIVED, never stored (2026-08-12)

Branch `m14b/remove-1`, one commit (`186d39f`). Full gate green. Review dispatched.

**The design decision the unit forced:** the first cut stored removal as a document status —
and hit the documents table's CHECK constraint, whose widening means a table-rebuild migration
on every operator DB. The second cut is the doctrine the milestone has been following all
along: **removal is a chain fact, derived at every consumer** — the publish gate, the inbound
refusal, and the list overlay all read ONE shared membership walk (`walkMembership`), because
two walks disagreeing about a removal is two daemons disagreeing about the arrangement. No
schema change, no migration, no flag to drift.

**What ships:** `cello_doc_remove` (four surfaces + guards) — admin-removes-non-admin and
voluntary self-leave, both single-signer; validate-before-append at the third production append
site; the amendment travels to every holder INCLUDING the removed one (being told is how their
daemon surfaces it — `document.removed_from`); the removed holder's publish refuses naming the
removal and its epoch, their arriving envelopes refuse TERMINALLY on every remaining holder
(`document_sender_removed`, inbound step 4c), their copy/file/history remain and every surface
says so; a fellow admin cannot be expelled through the holder door (the policy sentence
surfaces verbatim). Handler proofs: remove-after-join and voluntary-leave roundtrips + the
holder-door refusal; inbound proof: removed sender refused terminally naming the epoch.

**Fixture rule discovered:** planted amendment rows must be DECODABLE — the membership walk
decodes every stored row, and garbage is a state no real daemon can hold
(validate-before-append). Two suites corrected.

---

## Entry 13 — REMOVE-1 review verdict, findings fixed, merged — P1 ALL GREEN (2026-08-12)

**Reviewer verdict (`cello-unit-reviewer`, one pass, quoted):** "SPEC: DEVIATIONS FOUND — the
delivery-stop clause is missing and un-journaled (F1) [blocking]; the named-refusal clause holds
only in an adversarial corner (F2/F4); three surfaces overclaim 'either way'. ERROR SUBSTITUTION
FOUND — document_epoch_stale stands in for document_sender_removed in every honest
removed-publisher flow [blocking]. HOLLOW TESTS FOUND — list overlay and removed_from warn
revert-invisible; walkMembership re-add unpinned. REMOVALS PROVEN."

**All findings fixed (`cello-client 8bf302a`, merged `cc06b3f`):** the delivery worker retires
pending envelopes to a removed target (abandoned, announced); a daemon that knows itself removed
refuses arrivals terminally; the missed-amendment removed publisher gets the removal answer in
the epoch-behind branch (where our chain is definitive — the AHEAD case deliberately does not,
because there OUR chain may be stale); a removed former holder is upgraded from the silent
stranger-refusal to the terminal named one; a repeat remove re-sends the removal amendment (the
invite-retry precedent — the offline-at-removal holder is no longer permanently unreachable);
the CLI help mis-annotation fixed. Seven new revert-visible tests. F6 (list decodes chains per
row) accepted at alpha scale, revisit when FANOUT-1 touches the table.

**ANDRE'S STANDING PRINCIPLE, delivered mid-unit and now a procedure lens (§2b):** *a guard is
not a guard if it only lives in the daemon the adversary controls — clients can rewrite their
own daemons. Daemon-side enforcement counts only when it runs on the OTHER parties' daemons;
otherwise it belongs in the directory or relay (or both).* Audit of this unit against it:
- The load-bearing removal gates run on the HONEST side: every remaining holder's inbound
  refuses a removed sender by ITS OWN chain, and every remaining holder's worker stops dialing
  the removed target. A removed party who rewrites their client can neither push edits in nor
  keep receiving them.
- The removed daemon's self-checks (publish gate, recipient refusal, list overlay) are
  ERGONOMICS for an honest client, not the boundary — correctly so.
- Same shape across the milestone: amendments/joins validate by replay on EVERY receiving
  daemon; consent protects the invitee on the invitee's own machine (self-protection, the one
  place trusting your own daemon is the point).
- Directory/relay-level enforcement (e.g. witnessing refusals for removed members) is
  defense-in-depth for the Tier 2 wave — the relay today has no membership knowledge, and adding
  it is a deliberate future decision, not a P2 slip-in.

**DOD-MP-REMOVE-1 flips ✅ on this entry. Tier P1 is ALL GREEN.**

---

## Entry 14 — DOD-MP-FANOUT-1: clause checklist + design (pre-implementation, 2026-08-12)

**Target in one sentence:** the delivery target set becomes the DERIVED participant list, with
acknowledgement, retry, and stall tracked per (envelope, holder) — one dead holder never blocks
or stalls anyone else.

### Clause checklist (from the DoD line + Entry 1(a)'s traced ACs)
1. Targets derive from amendment replay (`holdersFor`), never per-sender config — §7-1's
   silent-divergence hazard is the reason.
2. Per-(envelope, holder) delivery state: its own table (`document_deliveries`), log-derived,
   restart-survivable; the envelope-row columns stay as the BILATERAL legacy read path until
   this table owns delivery state (migration note in-unit).
3. Reachability, backoff, attempts, and the unacked ceiling are PER HOLDER.
4. Stall is PER HOLDER; the document stalls only when EVERY current holder is exhausted.
5. The pending window is bounded PER HOLDER (the no_peer starvation shape, multiplied by N).
6. One unreachable holder never delays the others (the availability clause — sovereign-node
   doctrine applied to documents).
7. The removed-target gate (Entry 13) generalizes: a holder removed from the arrangement is
   retired from delivery state, announced.
8. Cap 20 already enforced at amendment validation (AMEND-1) — nothing new here, referenced.

### Design
- **`document_deliveries` table:** (owner, document_id, envelope_hash, holder_agent_id) PK;
  delivered_at, acked_at, abandoned_at, attempts, next_attempt_at — the envelope-row columns'
  shape, per holder. Seeded on publish for every CURRENT holder at publish time (derived), and
  for the LEGACY bilateral rows by the worker's first pass (backfill-on-read, journaled).
- **Worker:** pending = per-holder unacked rows JOINed to envelopes; grouped (document, holder);
  one reachability probe per (document, holder) pass; per-holder backoff via the existing
  schedule; per-holder ceiling → holder marked exhausted (announced), document stalled only when
  all are.
- **Ack routing:** the existing ack frame names (envelope, sender) — the ACKING HOLDER is the
  authenticated sender of the ack; `markAcked` moves to (envelope, holder).
- **Trust lens (Entry 13):** fan-out is the HONEST sender's availability machinery — no security
  claim rides on it; the receive side (INBOUND-N-1) is where counterparty enforcement lives.

---

## Entry 15 — FANOUT-1 code-complete; two counters, one worker, N holders (2026-08-12)

Branch `m14b/fanout-1`, four commits (`782e43d` per-holder state, `5f6f686` type fix, `503d05d`
the worker + wiring + test migration, + the availability proof). Full gate green. Review
dispatched.

**Checklist verdicts (Entry 14):** all eight built. Targets derive from replay (`holdersFor`,
layer-exported; the daemon sweep and publish both consume it); publish REFUSES when the chain
does not derive (an appended-but-unseeded envelope is invisible work) and seeds per-holder rows
in the same act as the append; per-holder probe/backoff/ceiling/retirement; document stalls only
when EVERY holder is exhausted; per-holder bounded window (partitioned row numbering); the
removed-target gate generalized; ack gate widened to any current derived holder, the acking
holder settles their own row; envelope-level ack now MEANS all-confirmed (zero-row legacy
byte-identical).

**Defect found mid-unit, in my own first cut:** "waiting is not sending" purism dropped attempt
counting on deferrals — an offline holder would have been redialed at the FLOOR rate forever.
The fix separates the two facts the old worker conflated: ATTEMPTS drives the escalating
schedule (deferrals count), SENDS drives the unacked ceiling (only content that left counts) —
the old conflation meant five quiet deferrals plus one real send abandoned the envelope.

**Test migration, named:** eleven delivery tests moved from the envelope-row view to the
per-holder view with the FANOUT-1 change annotated in place; the four full-suite stragglers
were load flakes (green in isolation and on the re-run). The lifecycle sent-count reads the
per-holder fact through `envelopeEverSent`.

**Fixture slippage, recorded:** the store piece was committed once before its typecheck ran
(caught and fixed one commit later).

---

## Entry 16 — FANOUT-1 review verdict, findings fixed, merged (2026-08-12)

**Reviewer verdict (`cello-unit-reviewer`, one pass, quoted):** "SPEC: FAITHFUL (the per-holder
stall deviation is journaled). SILENT FALLBACKS FOUND — H1/H2 are a silent-drop pair: a
wrong-holder or removed-holder ack permanently settles a row for content that never arrived,
with no signal on any path; M5 is the crash-window variant [blocking]. ERRORS NAME THEIR CAUSE
— with M6 as the one broken pointer. HOLLOW TESTS FOUND — publish seeding, the attempts/sends
split, and the ack-gate widening are all revert-invisible [blocking]. REMOVALS PROVEN." The
reviewer also confirmed: the ceiling cannot be evaded by ack-cycling; backfill does not
un-retire abandoned envelopes; TIER2-READY 4 accommodated (per-batch attestation keys a sibling
table on the same per-holder PK, no migration); no amendment append site added.

**All findings fixed (`cello-client 1e4556f`, merged `a2ce49b`):**
- **H1:** ack waiters keyed by the DIALED holder — the acker threads through onSettled,
  awaitAck, and the transport; another holder's (or a redelivered) ack can no longer settle a
  row for content that never arrived. §7-1's divergence through the sender's own bookkeeping,
  closed.
- **H2:** when the chain derives, derived membership is the WHOLE ack gate — a removed genesis
  peer refuses like any outsider (the genesis column is not a permanent credential); retired
  rows are not reopenable. The adversary-owns-their-daemon lens applied to acks.
- **M3:** one deterministic envelope-level terminal rule (`reconcileEnvelopeSettlement`) from
  every site. **M4:** settle-once/contradiction per ACKER — an admitted-then-rejecting holder
  is refused mid-fan-out; the one-holder-rejects-what-another-admitted supersession semantics
  are an explicit INBOUND-N-1 boundary. **M5:** append+seed transactional. **M6:** the
  missing-genesis branch logs the event the refusal points at. **M7:** parked counts as
  left-the-machine (journaled here as the deliberate reinterpretation the reviewer asked for).
  **L8:** backfill scoped to zero-row envelopes. **L9:** dead envelope-level writers deleted,
  proven by the gate.
- **The three revert-invisible gaps closed:** publish seeding through the production path (the
  one write that makes fan-out happen), the deferrals-never-spend-the-ceiling scenario (the
  unit's own headline fix, now pinned), and the ack gate's positive/negative/per-acker cases.

**Boundary notes carried to INBOUND-N-1:** a holder who joins after an envelope was published is
served by JOIN-1's state transfer, not retro-seeding; supersession semantics when one holder
rejects what another admitted.

**DOD-MP-FANOUT-1 flips ✅ on this entry.**

---

## Entry 17 — INBOUND-N-1 code-complete (2026-08-12)

Branch `m14b/inbound-n-1`, one commit (`27fe7a1`). Full gate green. Review dispatched.

**A small unit by design — most of its clauses were built by earlier units and needed only the
gate:** per-sender `doc_prev_hash` chains have been keyed by `lastEnvelopeHashBySender` since
ENVELOPE-1 (the new N-senders test pins that N first-envelopes anchor N independent chains
rather than forking a global one); the epoch gates, removed-sender refusals, and recipient
self-check landed with AMEND-1/REMOVE-1; amendment-lag behavior stands AS DEFINED (epoch-ahead
refuses non-terminally, resolving when the amendment lands; out-of-order amendments refuse by
name and the sender retries — the loud-until-FANOUT-heals design from Entry 10, now the
documented contract).

**What this unit changed:** the sender gate. When the chain derives, derived membership is the
WHOLE gate — a joined third holder's envelope admits at a receiver whose row names someone else
as peer; a removed genesis peer's envelope refuses by name; a stranger stays silently refused
(membership discloses nothing to non-parties). The row's peer column survives only as the
bilateral-legacy fallback — the identical rule FANOUT-1's review forced onto the ack gate,
applied to the twin seam the moment it was identified rather than waiting for a reviewer to
find it twice.

**Boundaries journaled, not built (Entry 16 carries):** late-joiner envelope service rides
JOIN-1's transfer; one-holder-rejects-what-another-admitted supersession semantics are still an
open design point for the Tier 2 wave's rejection work.
