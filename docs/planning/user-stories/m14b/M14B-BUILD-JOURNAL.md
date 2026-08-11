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

- **Next red:** `DOD-MP-AMEND-1` — the amendment record. Design + clause checklist are Entry 3;
  SIG-1 is merged (`cello-client f575a97`), so implementation starts at red tests on a fresh
  `m14b/amend-1` branch from main.
- **Tiers:** P0 ✅✅❌❌ (TRACE-1, SIG-1) · P1 ❌❌ · P2 ❌❌ · P3 ❌ · P4 ❌❌❌❌❌
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
