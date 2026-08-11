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

- **Next red:** `DOD-MP-TRACE-1` — the confirm-first trace. Target: journal a file/line map of
  the fan-out shape, both topology refusal sites, `epoch_id`'s producers/consumers, the
  property-immutability enforcement point, and the consent handshake's join fit; divergences from
  the multiplayer log's assumptions become ACs on downstream units.
- **Tiers:** P0 ❌❌❌❌ · P1 ❌❌ · P2 ❌❌ · P3 ❌ · P4 ❌❌❌❌❌
- **Branches in flight:** none.
- **Publishes this milestone:** none.
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
