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

- **Next red:** `DOD-MP-JOIN-1` (P1) — the join flow: an admin's `add_holder` amendment + the
  invitee's OWN consent handshake (offer carries genesis + amendment chain +
  assurance_tier/feature_version; invitee derives the arrangement independently; full document
  via log replay per D1; join effective only when amendment valid AND invitee consented — this
  carries GOVERN-1's dispositioned consent clause, Entry 8). Branch `m14b/join-1` from
  cello-client main (`4523716`). This unit wires the first production callers of
  deriveArrangement/policy/store-append — AMEND-1's validate-before-append condition BINDS its
  review.
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
- **Tiers:** P0 ✅✅✅✅ ALL GREEN · P1 ❌❌ · P2 ❌❌ · P3 ❌ · P4 ❌❌❌❌❌
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
