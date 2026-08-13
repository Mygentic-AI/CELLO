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

- **Next: SHIP-1's remaining halves.** DONE: version cascade (all seven bumped, `34f3d2a`),
  tag `v0.0.235` pushed, CI green through `smoke-tag`, all seven on BETA, verified against the
  TARBALL (daemon 0.0.162 dist carries document-join-store, document-amendment-store,
  holdersFor, seedDeliveries, document_sender_removed, cello_doc_invite, cello_doc_remove) and
  cross-pins are real versions (cli→daemon 0.0.162, connect→crypto 0.0.50/transport 0.0.56).
  REMAINING: (a) **ANDRE RUNS THE `latest` PROMOTION** — the seven commands are prepared and
  handed over, never run by me; (b) the trustless-cello lockfile refresh, which must follow the
  promotion (both repos float `latest`, so `pnpm install` before it would lock the OLD version);
  (c) the live fleet smoke on GCP — three real daemons doing create → join → edit → converge →
  remove → seal (the local spine proof is green, this is the fleet one).
- **BETA VERSIONS:** crypto 0.0.50 · protocol-types 0.0.54 · transport 0.0.56 · gateway 0.0.34 ·
  daemon 0.0.162 · cli 0.0.169 · connect 0.0.146.
- **Tiers:** P0 ✅✅✅✅ · P1 ✅✅ · P2 ✅✅ · P3 ✅ · P4 🟠🟠✅🟠❌ (enforcer audit, Entry 22 — FANOUT earned; GOVERN/JOIN/REMOVE partial with named gaps + 2 decisions owed) · SHIP-1 beta done, promotion is Andre's
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

---

## Entry 18 — INBOUND-N-1 review verdict, findings fixed, merged — P2 ALL GREEN (2026-08-12)

**Reviewer verdict (`cello-unit-reviewer`, one pass, quoted):** "SPEC: DEVIATIONS FOUND — the
amendment-lag clause's unknown-sender scenario ships as stranger-silence with the epoch
discriminator discarded, and Entry 17's 'stands AS DEFINED via epoch-ahead' does not describe
that path [blocking]. NO SILENT FALLBACKS — the null-derivation fallback narrows and announces.
ERRORS NAME THEIR CAUSE — with F3 as the one label sending the operator to the wrong subsystem.
TESTS HAVE TEETH — joined-holder and N-chains fail on revert. REMOVALS PROVEN." The reviewer
confirmed the N-chains test genuinely distinguishes per-sender from global chains (a global
head throws document_chain_forked on the second prev-null root), and all three
derived-membership seams wire to ONE producer.

**Findings fixed (`cello-client d9dfd02`, merged `5748894`):** F1 — the lag signature is
NAMED: an unknown sender whose envelope claims an epoch ahead of ours logs
`document.inbound.sender_unknown_epoch_ahead` (an honest new holder can ONLY arrive
epoch-ahead; a receiver holding their epoch would hold their amendment). The wire stays silent
— the disclosure decision stands — but the operator no longer reads a stranger probe. F3 — the
retirement checklist points at that receiver-side event. F4 — headers merged, archaeology
dropped.

**THE SETTLED LAG SHAPE (correcting Entry 17, as the reviewer demanded):** an unknown-holder's
envelope resolves via the SENDER'S ORDINARY RETRY through the (logged) silent path once the
amendment lands — NOT via the epoch-ahead refusal, which the sender gate precedes.
**F2, journaled as the accepted boundary:** resolution holds within the retry ceiling's window
(5 sends × the 600s ack timeout ≈ 40 minutes of receiver lag); past it, delivery to that
receiver is retired and never reopened by the amendment's arrival. Re-seeding retired
deliveries on a membership amendment is the named Tier 2 candidate reconcile; at alpha scale a
receiver lagging behind an invite by 40+ minutes is the re-invite verb's territory (it re-fans
the amendment and re-sends the offer).

**DOD-MP-INBOUND-N-1 flips ✅ on this entry. Tier P2 is ALL GREEN.**

---

## Entry 19 — TOPOLOGY-1 code-complete (2026-08-13)

Branch `m14b/topology-1`, one commit (`0a8ada8`). Full gate green. Review dispatched.

**The smallest unit of the milestone, exactly as TRACE-1's map promised:** the accepted-value
set changed in ONE place (`SUPPORTED_TOPOLOGIES` = {mesh, hub-and-spoke}), all three seam call
sites follow; the propose handler writes `TOPOLOGY_DEFAULT` ("mesh"); `TOPOLOGY_V1` is deleted
from the surface entirely (compiler-enforced sweep of every consumer). An unknown topology
refuses at both ends naming the supported set and the asked-for value.

**Decision, one line (D4 applied):** hub-and-spoke survives as an accepted VALUE only — the
field is signed into `document_id`, a document so labeled behaves identically (fan-out serves
the derived holders regardless of the label), and refusing it would break every existing
fixture for zero behavioral gain. Nothing is built for it; nothing writes it.

---

## Entry 20 — TOPOLOGY-1 review verdict, findings fixed, merged — P3 GREEN, ALL BUILD TIERS DONE (2026-08-13)

**Reviewer verdict (`cello-unit-reviewer`, one pass, quoted):** "SPEC: FAITHFUL. NO SILENT
FALLBACKS (F1 is a pre-existing notification gap on the refusing peer's side). ERRORS NAME THEIR
CAUSE. HOLLOW TESTS FOUND — the mesh-default clause fails THE REVERT TEST. REMOVALS PROVEN." The
reviewer proved `TOPOLOGY_V1`'s deletion three ways (both repos, the package's export map, and
the built `dist/`), confirmed no behavior anywhere branches on the topology value, and **ruled
no feature_version bump was owed** — the wire shape is unchanged and pre-M14B builds already
refuse at the version gate with a truthful sentence.

**Findings fixed (`cello-client 01740b5`, merged `252767a`):**
- **F1 (MEDIUM, made real by this unit):** an arrival auto-refusal — seam violation or version
  mismatch — wrote its sentence to OUR database and answered the proposer with SILENCE, a hang
  they diagnose as a network fault. The join path had fixed exactly this shape; the proposal
  path never got it. The signed refusal ack now travels best-effort to the authenticated
  proposer. **The fixture gained the layer's own send seam** — its absence is why no test could
  ever have caught this.
- **F2/F3:** the gate's refusal prose stops citing the retired hub-and-spoke concept and names
  what is actually parked (pass-through, M14-P8); the two stale seam comments corrected.
- **The hollow test:** the mesh default's VALUE is pinned and the SENT proposal is asserted to
  carry it literally — reverting the default was green before.

**DOD-MP-TOPOLOGY-1 flips ✅. Tier P3 is GREEN — EVERY BUILD TIER (P0–P3) IS COMPLETE.**
What remains is P4: proof, not construction.

---

## Entry 21 — P4 ENFORCERS GREEN: three real daemons, three OS processes (2026-08-13)

`packages/e2e-tests/src/spine/j-multiplayer.spine.test.ts` — two journeys covering all four
enforcer lines, **2/2 green in 191s** against a real 3-node consortium (signed manifest, real
FROST DKG registration) and a real relay. Commits `22d07dd2` (the file) + `7d329eb3` (green run).

**Journey 1 — GOVERN + JOIN (E2E-GOVERN-1, E2E-JOIN-1):** A proposes, B accepts, A writes real
history; a NON-HOLDER's invite is refused; A invites C; C's inbox shows the DERIVED rules; C
accepts and holds the WHOLE prior history; C's first edit reaches BOTH A and B; all three
daemons independently derive epoch 1 and the same arrangement.

**Journey 2 — FANOUT + REMOVE (E2E-FANOUT-1, E2E-REMOVE-1):** with C's daemon KILLED, A
publishes and B converges — one absent holder blocks nobody, the availability claim under real
process separation. Then A removes B: B keeps the full content, B's own surface reports
`removed: true` (not a vanished row), B's next publish refuses naming the removal, and A's copy
is untouched.

**Both first-run failures were the TEST, not the product** — and both are worth recording:
1. The join offer shows the invitee the arrangement they would BE IN: the pending admission
   replays too, so C sees themselves among the participants. That is the point of consenting to
   a COMPUTED arrangement rather than a claim; the assertion was wrong, the behavior right.
2. Removing a fellow ADMIN through the holder door was correctly refused (D3's all-other-admins
   rule, surfacing verbatim from the policy). The journey now makes A the sole admin at creation
   and removes a non-admin holder — which is the DoD clause's actual shape.

**Harness note:** Docker must be running (the directory binary needs local Postgres); started
locally, not a product dependency. The enforcers spawn cello-client's LOCAL `dist/` — built
from the merged branch, not published.

**DOD-MP-E2E-GOVERN-1, -JOIN-1, -FANOUT-1, -REMOVE-1 all flip ✅ on this entry.**
Only `DOD-MP-SHIP-1` remains.

---

## Entry 22 — THE ENFORCER REVIEW: four tags downgraded, gaps closed, two decisions owed (2026-08-13)

**Reviewer verdict (`cello-unit-reviewer`, quoted):** "The evidence is real, and it is narrower
than the four lines it was used to close. The tell is in the DoD file itself: every note written
under a ✅ is accurate and every one of them describes LESS than the line above it. The tag was
set against the note, not against the line." Coverage audit: GOVERN-1 2/9, JOIN-1 5/6,
FANOUT-1 3/5, REMOVE-1 4/7.

**I downgraded all four immediately (`077fc577`) before fixing anything** — an unearned ✅ is the
one thing that must not sit in the record while work continues.

**The finding that mattered (H1, error substitution):** the file's ONLY governance assertion had
C — a NON-holder — attempt an invite and asserted `ok === false`. That call dies at the store
lookup with `document_unknown`, six checks before the governance gate. **It was green with every
line of governance deleted.** Now C invites AFTER joining (a holder who is not an admin) and the
assertion is the reason code, `document_not_admin`.

**Gaps closed (`5ad6f473`, 2/2 green in 314s):**
- **FANOUT-1 → ✅ EARNED (5/5):** A queues work for the absent holder (per-holder pending on A's
  own surface), A's daemon is KILLED AND RESTARTED and the backlog survives, then C returns and
  converges with nobody acting on any side. The bolded clause now runs.
- **REMOVE-1 → 5/7:** both survivors stay alive and keep converging after the removal, and the
  removed holder receives none of it. The fixed sleep became a poll; the vacuous "A's copy is
  untouched" assertion (B's write never left B's machine — it could not fail) is gone; B's
  refusal is now stated in place as the LOCAL pre-check it is rather than overclaimed as the
  receiver-side one.

**TWO DECISIONS OWED — ANDRE'S, not mine:**
1. **GOVERN-1 names three clauses with NO authoring verb** — `promote_admin` and both
   `remove_admin` cases. The replay engine implements them fully; nothing can author one,
   because the cross-daemon N-signature GATHERING wire is parked (Entry 10). Either that wire
   gets its own DoD line, or those three clauses are cut from GOVERN-1 in writing. They cannot
   be tested and must not be tagged.
2. **JOIN-1's sealing clause is ill-posed for a mesh:** "the session seals and the document
   leaves verify on all three sides" assumes a shared session. Three holders means three
   PAIRWISE sessions with three roots. The clause needs defining before it can be tested.

**Also carried:** REMOVE-1's "on the record" is today a warn log + an ack carrying the refusal —
no quarantine row, no `0x05` leaf on the receiver's disk. Whether that satisfies the clause is a
product decision. And the removal guidance still tells an operator to "demote first" via a verb
that does not exist (the same gap as decision 1).

---

## Entry 23 — G0 built, GOVERN-1's buildable clauses closed (2026-08-13)

**The review's blocking prerequisite (G0) is shipped:** `cello_doc_list` surfaces each
document's DERIVED arrangement — participants, admins, properties — computed from that daemon's
own chain, never stored. Until now nothing exposed who holds a document or who governs it: an
operator could not answer "who is in this?", and the governance line's headline claim was
unassertable from outside the process. A chain that cannot derive says so by name rather than
rendering an empty list. (`cello-client 99f06e1`.)

**GOVERN-1's remaining buildable clauses now run** (`trustless-cello 67236512`, 2/2 green,
316s): creation declares A the sole admin and BOTH holders derive that; **B — a HOLDER who is
not an admin — is refused `document_not_admin`** (the first cut asked a NON-holder, which dies
six checks earlier at `document_unknown` and was green with every line of governance deleted);
and after the join all three daemons agree on participants, admins, and epoch, compared
value-for-value rather than proxied by epoch height.

**Two test-side corrections found by the new assertions, both mine:** journey 1 was still
proposing with the default admin set (the edit had been lost in an aborted batch), and the
join-offer assertion still expected the old two-admin default. The product was right both times.

**Still not covered, and why:** "B joins by amendment" — B is a genesis party by construction,
so this reads as the line describing a shape the journey does not use rather than a gap;
"independent refusal at the OTHER holders" needs the rejected amendment put on the wire anyway
and asserted on both receiving daemons' logs. Both are honest gaps on the line.

**The three UNBUILDABLE clauses stand unchanged** — `promote_admin` and both `remove_admin`
cases have no authoring verb. Decision still owed (Entry 22).

---

## Entry 24 — §3a parks, the mesh sealing definition, and the G0 review (2026-08-13)

**Two decisions I had been CARRYING are now parked/defined, per §3a — the procedure says park,
never block:**
1. **Admin promotion and admin removal are PARKED OUT of GOVERN-1** (DoD "Explicitly beyond").
   The replay engine implements both; no verb authors either, because `remove_admin` needs
   signatures gathered from every other admin across machines and no wire carries a half-signed
   action. The line can now close on what it can prove; the capability is named as owed work
   with its shape sketched (a pending-governance inbox, a co-sign verb, expiry — and once
   fan-out exists, delivering a half-signed amendment is just another per-holder delivery).
   **Andre's call stands, nothing is blocked meanwhile.**
2. **JOIN-1's sealing clause is DEFINED for a mesh:** each PAIRWISE session seals and both of
   its parties independently recompute the same root over that pair's `0x04` leaves — the
   bilateral proof, run per pair. Multiplayer does not change what a seal is, only how many
   there are. **Then PROVEN** (A↔B and A↔C, mixed trees, roots compared side to side), so
   **DOD-MP-E2E-JOIN-1 flips ✅ (6/6).**

**The G0 review (`cello-unit-reviewer`, quoted):** "SPEC: DEVIATIONS FOUND — the cross-daemon
agreement assertion covers `participants` and `admins` but not `properties`, which G0 named as
part of the arrangement. NO SILENT FALLBACKS in the new read path. ERRORS NAME THEIR CAUSE.
HOLLOW TESTS FOUND — the `arrangementUnavailable` branch and the `properties` field are asserted
by nothing." Seven findings on a 40-line diff. All fixed (`cello-client 606d33b`,
`trustless-cello` this entry):
- **F1 (the one that mattered):** chain decoding THROWS on bytes this build cannot read (a
  client downgrade past an amendment kind is reachable), and the throw escaped the row, escaped
  the map, and left `cello_doc_list` returning NOTHING — one unreadable document taking down the
  operator's whole list. Contained in BOTH chain readers; **the second one my own new test
  caught after the first was fixed.**
- **F2:** membership keys are always present, `null` on failure — an absent key is coerced to
  `[]` and reads as "nobody holds this", which this unit's own enforcer helper did.
- **F3/F5:** the genesis proposal is passed in rather than decoded twice per row; the
  missing-genesis fault reuses the invite path's name and sentence rather than inventing a
  second name for one condition.
- **F6:** the row says whether the admin set was DECLARED or defaulted, so a default the code
  chose is never rendered as agreed fact. (Chose the flag over refusing an absent `admin_set`:
  refusing would strand documents created before the slot existed — Andre has some.)
- **The deviation + both hollow gaps closed:** `properties` is in the agreement at every step;
  the unavailable branch is pinned by a test that plants undecodable bytes and asserts the list
  survives with one degraded row.

**A harness lesson worth recording:** a scripted edit truncated this spine file to zero bytes —
`open(p,'w')` truncates before the write, and the write raised. Restored from HEAD and re-applied
via a temp file with a size assertion before the move. Any scripted edit to a file not yet
committed should write-then-verify, never write-in-place.

---

## Entry 25 — the receiver-side removal clause rested on a false premise (2026-08-13)

Built a third enforcer journey to stage REMOVE-1's remaining clause — the refusal AT THE
RECEIVERS — by removing a holder while their daemon was down, so they would publish without
knowing. **The premise was wrong, and the product is better than the clause assumed.**

**What actually happens:** the removal amendment is sent while C is down, the relay PARKS it,
and `holdersNotified[C]` reports true — the send was accepted. C returns, receives the parked
amendment with NOBODY acting on any side, and their own daemon then self-censors: their next
write is refused locally, naming the removal. C keeps their copy unchanged throughout.

**The consequence, stated plainly:** with honest binaries the receiver-side refusal
(`document_sender_removed`) is **unreachable end to end** — being offline only DELAYS the news,
it does not withhold it. That gate is a defence against a **rewritten client**, which is exactly
Andre's adversary-owns-their-daemon lens: the check runs on the honest holders' daemons because
the removed party's own cannot be trusted to self-censor. Stock binaries cannot stage that, so
its coverage is the inbound unit suite (three tests), and what the enforcer proves live is the
cooperative path entire.

**DOD-MP-E2E-REMOVE-1 flips ✅** on that reading — the clause is met by what the system actually
does, with the adversarial half correctly located in unit coverage and named here. **"On the
record" stays a PRODUCT question for Andre:** the receiver logs the refusal and acks it, but
writes no durable rejection row or `0x05` leaf. Whether that satisfies "on the record" is a
design call, not a test gap.

**Tier P4 is now ✅✅✅✅ on the four enforcers** (3 journeys, 3/3 green, 329s, three daemons as
three OS processes). SHIP-1's beta + promotion are done; the live GCP fleet smoke is the only
open item, plus the two product questions above and the parked gathering flow (Entry 24).

---

## Entry 26 — the live fleet smoke, and the defect only it could find (2026-08-13)

Ran SHIP-1's live smoke on the real GCP fleet with Andre's three production agents — CELLO_Coder_1,
CELLO_Support, Miss_Chelly — three separate machines' daemons, the real directory consortium and
relay. Document `d858092773092bed60c24089ff5e7c7f3a638acd05be043f966f7f12810b6932`.

**The cooperative journey passed end to end, exactly as designed:**

1. Coder_1 proposed with `admins: [Coder_1]`; Support saw it in their inbox and accepted.
2. Coder_1 invited Miss_Chelly → `epochId: 1`, and the existing holder was notified.
3. **Miss_Chelly saw the derived rules BEFORE consenting** — all three participants, the admin
   set, and the properties including `topology: "mesh"`, confirming mesh is live as the default
   on the fleet and not just in tests.
4. Miss_Chelly accepted and read the document: **content she was never sent directly**, arrived
   by log replay (D1's cheap path, live).
5. Miss_Chelly wrote line two. It reached BOTH other holders — including Support, with whom she
   had **no prior session**; the fan-out worker opened one. That is the mesh doing the thing the
   whole tier was built for, on real infrastructure.
6. Coder_1 removed Support → `epochId: 2`, both holders notified including the removed one.
   Support's next write was refused naming the removal; their copy stayed exactly as it was at
   line two, while Coder_1 and Miss_Chelly went on to line three and converged. Forward-only
   removal, proven on the fleet.

**Then the close, and the defect.** `cello_doc_close` reported `peerNotified: true`. It was not
true in any useful sense:

- `createDocumentControlNotifier` addressed `doc.peerAgentId` — the GENESIS counterparty, frozen
  at creation — and `return`ed after one send.
- Coder_1's `peerAgentId` was Support. **Who had just been removed.** So the close went to the one
  party it must not reach, and Miss_Chelly — the actual remaining co-author — was never told.
- Live confirmation: Miss_Chelly's row still read `closePending: false, status: active`.

This is **TIER2-READY lens 4** ("no frame assumes a single counterparty"), which this milestone's
own DoD makes a blocking invariant. Control frames were the one surface never migrated to the
derived participant set that FANOUT-1 established for update envelopes. No test caught it because
the only coverage was a two-party surface test, and with two parties `peerAgentId` is right.

**Fixed as DOD-MP-CONTROL-N-1.** The target is now the derived set (same `deriveArrangement` path
`invite`/`remove`/`list` use, injected as a `holders()` seam rather than widening the notifier into
the replay engine). Signed ONCE and sent byte-identical to each holder — the TBS commits to the
document and verb, never to a recipient. Reported per holder: `holdersNotified`, because with N
holders a partial fan-out is the ORDINARY failure and one boolean cannot describe it. One
unreachable holder neither blocks nor aborts the others. **A chain that will not derive REFUSES by
name and falls back to nothing** — the tempting fallback is the old behaviour, and after a removal
it aims the frame at precisely the wrong party.

Two traps caught while building it, both worth recording:
- **`[].every()` is `true`.** Folding the per-holder map with `every` alone reports that everybody
  was notified exactly when nobody was. Split out as `everyHolderNotified`, which requires at least
  one entry.
- **The bilateral fixtures had to take the REAL derivation, not a hardcoded peer** — a fixture
  handing back `[peerAgentId]` would restore the very assumption under test. All 30 surface tests
  pass against the real path, which also confirms an empty chain derives to the two genesis parties.

New guidance branch: a partial fan-out now NAMES the holders who did not hear it, instead of a
message about "the peer" that names nobody when there are several.

8 new tests; full gate green (3728 tests, eslint, tsc). Reviewed under DOD-MP-CONTROL-N-1.

**A DESIGN QUESTION FOR ANDRE that the smoke surfaced and this fix does NOT answer:** `close` is a
bilateral handshake — `#settleClose` settles against `doc.peerAgentId`. With three holders, does a
document close when ONE co-author closes, or when ALL of them have? The frame now reaches everyone;
what their agreement MEANS for settlement is a product call, not a bug. Today the bilateral settle
logic stands unchanged.

---

## Entry 27 — the review found the fix was half a fix (2026-08-13)

`cello-unit-reviewer` on DOD-MP-CONTROL-N-1. Verdict: **SPEC: DEVIATIONS FOUND · ERROR
SUBSTITUTION FOUND · HOLLOW TESTS FOUND**, all blocking. Eight findings, all fixed
(`cello-client 9d8d4bc`). The reviewer ran the revert test itself and restored the tree
byte-identically (sha256 verified) — worth recording, because a reviewer that edits and does not
restore is indistinguishable from one that breaks the build.

**F1 — HIGH, and the one that mattered.** I fixed the SEND side and declared the invariant met.
The RECEIVE side still authorized an ending by `sender === doc.peerAgentId` — the same frozen
column the DoD line condemns. Two consequences, both reachable with **ordinary commands, no
rewritten daemon**:

- **A removed holder could still end the creator's document.** A created with B, invited C,
  removed B. A's `peerAgentId` is still B. B kills; B's own daemon now correctly fans out to A and
  C; A ACCEPTS it and marks the document killed, while C refuses (C's peer is A). Two operators,
  two different states, driven by a party holding no rights at all.
- **A joiner could never end a document they hold.** With {A,B,C}, C's close is correctly
  addressed to both — and BOTH refuse it, because C is neither one's `peerAgentId`. C is told
  `holdersNotified: {A: true, B: true}`. Everyone heard them; nobody recorded anything.

Both now gate on derived membership, mirroring `document-inbound.ts` verbatim — the peer column
stands in ONLY when the chain cannot answer. A close is also now recorded against the actual
sender rather than the peer column, which had been crediting a joiner's close to the genesis peer.

**The lens this proves out.** Andre's adversary-owns-their-daemon rule was written for rewritten
clients; F1's first case needed no rewriting at all. The general form is stronger than the
original statement: **a guard on the sender's side is not a guard.** Every ending is now decided by
the receiver, from the signed chain.

**F2/F3 — error substitution, both the shape this codebase keeps re-learning.** `document_chain_
invalid` collapsed every derivation failure (fork, bad signature, unknown signer, policy
violation) into one label that existed nowhere else. And four NEW refusal reasons fell through to
the generic "did not reach the peer … the document cannot settle until they hear it" — telling the
operator to wait for a counterparty for four faults that are entirely about their own machine.
That is verbatim the defect `notifyGuidance`'s own header says it was written to remove. The
reviewer captured the live string rather than inferring it. All four now branch, and the chain
faults point at `document.holders.underivable` in the log.

**F4 — the duplicated derivation, and the better fix.** I had hand-written the arrangement replay
into the composition root. The reviewer noted it had ALREADY drifted from `holdersFor` — it never
emitted `document.holders.underivable`, so the control path was invisible to exactly the log
search meant to find it. Rather than call `holdersFor` from the closure, the derivation moved onto
the layer as `controlHolders`: **one implementation, shared by the daemon and every fixture.** A
closure in `daemon.ts` is untested by construction, so fixtures hand-copy it and a hand-copy
cannot disagree with the original — which is precisely the lesson
`document-control-notifier.ts`'s own header records about why IT is a module.

**The hollow-test finding, which was correct and uncomfortable.** All 8 of my new tests stubbed
the holder list. They proved the notifier fans out over whatever it is handed; they did not prove
the LIST. The reviewer named the one-line bypass: hand back `[peerAgentId]` from the composition
root and the whole repo stays green — the shipped defect restored, with 8 passing tests named
after it. Four new tests now build the holder set through a **real invite and accept** on two
in-process daemons, and one delivers a removed holder's signed frame straight into the honest
daemon's inbound path. Verified they bite: reverting the inbound gate turns the joiner-close test
red.

It also caught that the existing "a THIRD party cannot end this pair's document" test now passes
for the wrong reason — the sender's own daemon refuses first, so the honest-holder guard it used
to cover is reached by nothing. That is what the new inbound test replaces.

**Gate:** 3732 tests, eslint, tsc, build. One review pass, all findings fixed, committed — no
second pass, per the hard cap.

**Still not live.** The line stays 🟡 until the publish cascade lands and the fleet close is
re-run. Andre's installed daemon (0.0.162) predates all of this.

---

## Entry 28 — the close-settlement review, and the fix that broke the legacy documents (2026-08-13)

`cello-unit-reviewer` on DOD-MP-CLOSE-N-1. **THREE HIGH, two of them REPRODUCED rather than
argued** — the reviewer corrupted a stored amendment and ran a removal on the existing fixture.
All fixed (`cello-client 6f9cd15`).

**F1 — one unreadable document took down the whole document list.** `holdersFor` decodes every
stored amendment and THROWS on bytes this build cannot read; I put that throwing call outside the
containment. The operator asking "what documents do I have" got `Data read, but end of buffer not
reached` — a CBOR decoder string naming no document, no verb, no subsystem, and the whole list
gone, not just the broken row. **This is the regression fixed TWO COMMITS EARLIER in
`arrangementFor`, re-opened through a different call site.** The lesson is not "contain throws" —
that was already written down, in a comment, forty lines away. It is that a fix recorded at ONE
call site does not protect the next caller of the same function, and the guard belongs where the
throw is, not where it was last felt.

**F2 — the fallback re-created the defect the unit exists to remove.** When the chain would not
derive, settlement stood in `[owner, peerAgentId]`. Both of those have typically closed, so a
three-holder document COMPLETED ON TWO, silently, surface reading `closed`, log reading ordinary
success. The comparison I had written in the docstring — "the same standing-in rule the inbound
gate uses" — was wrong in the one way that mattered: the gate's null branch NARROWS who may act,
`controlHolders`' refuses by name, and mine WIDENED what settles. Same syntax, opposite safety
direction. Worth stating as a rule: **when a fallback changes who is authorised, check whether it
adds or removes authority. Adding is almost never the safe default.**

**F3 — a removal could leave a document permanently unsettleable.** Two holders close, the third
never answers, the admin removes them — now everyone who REMAINS has agreed, and nothing
re-evaluated. The document stayed `active` forever with `closePending` reading **false**: open,
waiting on nobody, and unfixable, because control frames are fire-once and never swept. The
`false` is the worse half; it told the operator there was nothing to wait for. `#settleClose` now
runs on any membership change.

**THE FIX FOR F2 BROKE EVERY PRE-AMENDMENT DOCUMENT, and the existing tests caught it inside a
minute.** Refusing to settle on an underivable chain also refuses a document that has NO chain —
which is every bilateral document created before amendments existed. Andre has some. The reviewer
had predicted this exactly ("gate it on the absence of any amendment chain rather than on
'derivation failed' — those are different facts, and only the first one is legacy"). The
derivation now answers **derived / legacy / unknown** instead of one null. Collapsing them cost
correctness in one direction and working documents in the other; there was no single null that
was right.

**Three smaller findings, all fixed:** a removed holder's close row is dropped, so a re-admission
cannot carry their old agreement into a new tenure (`document_closes` has no epoch, so the stale
row would have counted); `document.closed` carries the epoch, because two daemons derive from an
eventually-consistent chain and can legitimately settle on different-sized sets — without it their
logs cannot be reconciled; and the `[].some()` mirror of the vacuous-truth guard is closed
alongside the `[].every()` one.

**Every new test revert-tested individually** — each fix broken in turn, only its own test failing.
Gate: 3739 tests, eslint, tsc, build. One review pass, all findings fixed, no second pass per the
hard cap; the live fleet re-run is the stronger verification and it is next.

**A decision taken rather than parked (§3a).** The reviewer flagged F3's fix as a design call:
does a removed holder's silence still count? Ruled NO — they are not a holder, the people who
remain have all agreed, it is consistent with forward-only removal, and it is the reversible
direction. Recorded here and surfaced to Andre as overturnable, not as a question blocking work.

---

## Entry 29 — the END journey: both ending fixes proven on three OS processes (2026-08-13)

`DOD-MP-CONTROL-N-1` and `DOD-MP-CLOSE-N-1` flip **✅**.

The fleet re-run is blocked on Andre's `latest` promotion, so rather than wait (§3b-3) the proof
came from the spine — and it turns out to be the BETTER proof anyway. The spine harness starts the
daemon from the **local build** (`core/daemon/dist/bin/cello-daemon.js`), not from npm, so it can
exercise an unpublished fix across three real OS processes today.

**Why this had to be three processes.** Both defects are about a THIRD PARTY THE CODE COULD NOT
SEE. A joiner exists in no `peerAgentId` column anywhere — not the creator's, not the genesis
peer's — so every single-process test that stubs a holder list agrees with whatever the near side
believes. The whole class is "two processes disagreeing about what a third would do", which is the
reason the four enforcers exist at all.

**The END journey** (`j-multiplayer.spine.test.ts`, 18.5s of a 349s suite):
1. A creates with B (A sole admin), invites C, C consents — a real chain, three daemons.
2. **A closes → `holdersNotified` names BOTH B and C.** This is the live-fleet defect exactly: it
   named the genesis peer alone, and the joiner — converging and publishing for the life of the
   document — was never told it had ended.
3. **One of three closed: nothing settles.**
4. **B closes → two of three.** Under the old rule this is precisely where A flipped to `closed`
   while C was still editing. It stays `active`, asserted after an 8s settle window so the
   assertion is not just winning a race.
5. **C's close completes it, on all three daemons.** Twice load-bearing: before the inbound half
   was fixed, a joiner's close was REFUSED by every holder while the joiner was told everyone had
   heard it.

**All four journeys green, 4/4, 349s** — the three existing enforcers unaffected.

One operational note: the spine needs local Postgres and Docker was down. Started it rather than
parking the line; `docker info` polls ready in ~10s.

**Tier P2 is now ✅✅✅✅** (FANOUT-1, INBOUND-N-1, CONTROL-N-1, CLOSE-N-1). The only line left in
the milestone is **SHIP-1**, whose remaining half is the live fleet run — genuinely blocked on the
`latest` promotion, which is Andre's to run and nobody else's.

---

## Entry 30 — the shipping audit, and SHIP-1's blocked half (2026-08-13)

Three publish cascades this session, each verified against the TARBALL rather than against CI
status: `v0.0.236` (daemon 0.0.163, cli 0.0.170, connect 0.0.147), `v0.0.237` (daemon 0.0.164,
cli 0.0.171), `v0.0.238` (connect 0.0.148). All green through `smoke-tag`, cross-pins real
versions, no `workspace:*`. The `/cello-publish` skill was re-loaded for each — the guard hook
blocked the second cascade for exactly the right reason, and it was right to.

**The audit found a defect nothing else would have.** SHIP-1 requires the plugin skills be checked
as SHIPPING content — tarball and clone, not source. Unpacking `connect@0.0.147` and reading the
built `dist` showed the close description still promising *"the document settles only once the
other side has said it too"*. That stopped being true the moment CLOSE-N-1 landed.

It matters more than a stale doc line usually would: **a tool description is the instruction the
agent acts on.** An agent reading that would report a document finished while a third holder was
still editing — the very defect the code now prevents, restated in prose and shipped to the
operator's disk. Three surfaces carried it (the MCP tool description, connect's own SKILL.md, the
plugin skill reached by clone); all three corrected and re-shipped. **Rule that generalises: when
a behaviour rule changes, the prose that TEACHES that rule is part of the change, and it must be
audited on the artifact, not the source tree.**

**SHIP-1 remains ❌, and correctly so.** Two clauses left, both downstream of the `latest`
promotion, which is Andre's alone (it reaches outside — it is what every operator installs):
- the live fleet run on the three real agents;
- trustless-cello's lockfile refresh. Its refs were audited and are all `latest` with no pins and
  no stale `workspace:*` pointing at the dead local copies — so nothing moves until `latest` does.

**Everything else in M14B is ✅.** Tiers P0–P4 complete; the four enforcers plus the new END
journey are green on three OS processes.

**Promotion set handed over** (all published and tarball-verified): connect 0.0.148, cli 0.0.171,
daemon 0.0.164, gateway 0.0.34, crypto 0.0.50, transport 0.0.56, protocol-types 0.0.54.

---

## Entry 31 — the enforcer review: both tags down, then earned back (2026-08-13)

I flipped `DOD-MP-CONTROL-N-1` and `DOD-MP-CLOSE-N-1` to ✅ on the strength of a spine journey I
wrote myself and never had reviewed. Dispatched the reviewer on it specifically because of that.
**Both tags came down. Both are now back, on better evidence.** The reviewer ran the journey five
times against deliberately broken builds and restored both repos byte-clean.

**THE FINDING THAT MATTERS — the journey stayed green with the membership gate DELETED.** Set
`#senderMayEnd` to `return true` for every sender — a removed holder, a stranger, anyone who can
put a signed frame on the wire — and all four assertions passed. The reason is a shape worth
naming: **the journey asserted only acceptances.** A test made of things succeeding can tell you a
gate is permissive enough; it can never tell you the gate restricts anything. And refusal is
precisely what the line LEADS with — "a removed holder could end the creator's document with two
ordinary commands".

The new journey stages it: B is removed, B tries to end the document, A's copy must stay `active`.
With the gate admitting everyone it fails on **`expected 'killed' to be 'active'`** — a removed
party ending someone else's document, live, on three processes. That is the assertion the ✅ was
claiming all along.

**A real production bug behind the legacy clause.** CLOSE-N-1 promises "a document with no chain
settles on the pair". Settlement honoured it; the SEND path did not. `controlHolders` mapped
`holdersFor`'s null — the identical condition the verdict function calls `legacy` — to a refusal,
so no close frame ever left, neither side recorded the other's close, and a pre-amendment document
could **never be ended by agreement at all**. Reachable for documents proposed before
`recordOutgoing` shipped, and for a crash between `createDocument` and `recordOutgoing`, which run
in that order. Fixed: legacy addresses the peer; only a chain that EXISTS and will not replay keeps
the refusal.

**And the test that pinned the clause could not have caught it** — it injected
`withVerdict({kind:"legacy"})` and called `recordPeerClose` directly, so the notifier, the half
that refused, was never in the picture. The replacement drives a real close through the real
notifier and goes red when the branch is removed.

**Two smaller repairs.** The two-of-three rule was proven on the OWNER's daemon only — B and C were
inspected only once all three had closed, which is green under the old two-party rule too; it is
now asserted on the genesis peer's daemon, where the old rule would already read `closed`. And the
blind `sleep(8000)` is replaced by waiting for A's `document.close.peer_requested` line: a sleep
proves "it had not settled YET" and passes vacuously if the frame never arrived, while the receipt
turns it into "both closes are in, and it still did not settle". (Measured margin was 2ms against
an 8000ms window — over-provisioned by three orders of magnitude and still the wrong kind of
evidence.)

**THE RULE THIS PRODUCES, and it generalises past this milestone:** *a test built only from
successful outcomes cannot prove a restriction.* Every security property needs at least one
assertion that something was REFUSED, and that assertion has to fail when the guard is removed —
otherwise the guard is untested no matter how green the suite is.

5/5 journeys green, 356s. Gate: 3740 tests, eslint, tsc.

---

## Entry 32 — RESUME STATE (2026-08-13)

**M14B is complete except SHIP-1, which is blocked on one operator-run step.**

**Every DoD line ✅** — Tier P0 ✅✅✅✅ · P1 ✅✅ · P2 ✅✅✅✅ (FANOUT-1, INBOUND-N-1, CONTROL-N-1,
CLOSE-N-1) · P3 ✅ · P4 four enforcers ✅ — **except `DOD-MP-SHIP-1` ❌.**

**Published and TARBALL-VERIFIED on `beta`** (five cascades this session, `/cello-publish`
re-loaded for each; the guard hook blocked one and was right to):

| package | version |
|---|---|
| connect | 0.0.148 |
| cli | 0.0.172 |
| daemon | 0.0.165 |
| gateway | 0.0.34 |
| crypto | 0.0.50 |
| transport | 0.0.56 |
| protocol-types | 0.0.54 |

All CI green through `smoke-tag`; cross-pins are real versions; the legacy branch, the three-way
verdict, the membership hook and the fan-out loop were each grepped out of the BUILT dist, not
assumed from the commit.

**SHIP-1's two remaining clauses, both downstream of the `latest` promotion (Andre's alone — it is
what every operator installs):**
1. the live fleet run on the three real agents — create → join → edit → converge → remove → seal;
2. trustless-cello's lockfile refresh. Refs audited: all `latest`, no pins, no stale `workspace:*`
   pointing at the dead local copies — so nothing moves until `latest` does.

**Enforcers:** 5/5 green, 356s, three real daemons as three OS processes.
**Gate:** 3740 tests, eslint, tsc, build.

**Open by intent, not omission** — admin promotion/removal (parked, no authoring verb exists);
what "on the record" should mean for a refused edit from a removed holder; both are Andre's calls
and neither blocks the milestone.

**Rulings taken autonomously this session, all logged as overturnable:** D7 (a close settles on all
current holders), D8 (a removal completes the agreement for those who remain).

---

## Entry 33 — the fleet re-run, and the neighbouring defect it flushed out (2026-08-13)

Andre ran the promotion; all three agents came up on cli 0.0.172 / daemon 0.0.165. The re-run
**proved the M14B work and was then blocked by a defect in the session seam.**

**PROVEN LIVE on the new build:**
- creation with a single named admin (`adminSetDefaulted: false`), `topology: mesh`;
- the invitee saw participants, admin set and properties **before consenting**;
- the joiner opened the document holding content nobody sent them, rebuilt from the log;
- **`cello_doc_close` addressed BOTH other holders** — the defect that started this whole line. The
  old build named only the genesis counterparty; the joiner would never have been told;
- the all-failed guidance named exactly which holders missed it;
- **and on the PREVIOUS document, `closePending` now reads `true`** where the old build read
  `false` while a co-author had never closed. The settlement fix, visible on data that already
  existed.

**NOT PROVEN — convergence, the close landing, removal, seal.** All blocked by the same cause.

### The cause, from the daemon's own words

`session.relay.hash.submit.terminal` — *"the relay has ended this session — nothing sent now can
ever be part of its record."* Meanwhile `cello_sessions` lists that same session as **active**.

The daemon restarted mid-flight during the upgrade. **`session_sealed` is pushed exactly once**;
miss it and this side holds a non-terminal row while the relay has finished. The code says this in
a comment at `close-session-handler.ts:207` and carries a measured incident from 2026-08-09.

### The gap, stated precisely

For CONVERSATIONS this is handled correctly: the send is refused, and the operator is told to check
`cello_sessions` and start a new session. A human reads it and acts.

**DOCUMENTS have no human in that loop.** The delivery worker retries on its schedule against a
session that can never carry anything again — observed retrying across ~15 minutes with a
permanently unsent envelope — and nothing opens a replacement. The document becomes silently
undeliverable to that peer; the only symptom is a pending count that never falls.

**This is not in the M14B diff** — it is the session↔document seam, which is why all five spine
journeys pass against three healthy daemons. But it defeats `DOD-MP-SHIP-1`'s fleet clause, and it
violates the standing rule that *availability and fallback are first-class protocol concerns*.

**Proposed shape (NOT built — needs Andre's call and its own line):** a terminal sealed-session
refusal should RETIRE the local session row so the next document frame opens a fresh one, instead
of retrying into a grave. Symptom-level workaround: `cello logout && cello login` clears the stale
rows.

### One defect of mine, found by the run and fixed

The all-failed guidance said *"They are most likely offline."* It was a guess, and wrong — the
holders were online and the real reason (`session_sealed`) was in the daemon's hand. The per-holder
boolean discarded the cause, so the sentence had to invent one, and it told the operator to wait
for something waiting cannot fix. **That is the third time this session I committed the
error-substitution shape** — twice caught by the reviewer, once by the fleet — and this one landed
in a branch I wrote *while fixing the other two*. The reason now travels per holder and the
sentence names it. `cello-client 2c66e5f`, 2 tests, gate green.

---

## Entry 34 — the sealed session SURVIVES a restart, and the delivery worker retries it forever

Correction to Entry 33's workaround: **`cello logout && cello login` does NOT clear it.** Hard
evidence from the daemon log after the restart —

```
session.relay.hash.submit.terminal  sessionId 7bf49355…  reason session_sealed
correlationId dlv-6988436e-1786559198727   18:26:39
correlationId dlv-6988436e-1786559258727   18:27:39
correlationId dlv-6988436e-1786559378730   18:29:39
impact: "the relay has ended this session — nothing sent now can ever be part of its record"
```

The `dlv-` prefix is the DOCUMENT DELIVERY WORKER. It re-picks the same sealed session **every 60
seconds**, is told **terminally** that nothing can ever enter that record, and tries again on the
next tick. The session row is persisted, so a restart reloads it and the loop resumes.

**This is a permanent stuck state, not a transient one.** A document that was in flight when a
session sealed can never again be delivered to that peer, by any means available to the operator.
Restarting does not help. The only visible symptom is a pending count that never falls.

**Against the standing rule** — *availability and fallback are first-class protocol concerns, not
operational nice-to-haves* — this is a fallback that does not exist: the worker has one route, that
route is permanently dead, and there is no second one.

**The shape of the fix** (not built; needs its own line): the terminal branch already KNOWS the
session is over — it says so in the log and in its own guidance for conversations. It must also
RETIRE the local session row, so the next delivery attempt opens a fresh session instead of
resubmitting into a grave. The conversation path solves this by telling a human; the document path
has no human and needs it done for it.

### Fleet smoke — final state

**PROVEN LIVE:** create with a sole admin · mesh · the invitee seeing the rules before consenting ·
the joiner holding content never sent to them · **`cello_doc_close` addressing BOTH holders** ·
**CONVERGENCE — Miss_Chelly's edit reached CELLO_Coder_1** · `closePending` correct on the older
document.

**BLOCKED, and only by the above:** delivery to CELLO_Support, whose sessions are sealed and
un-healable. Everything the mechanism does is proven between the two holders whose sessions are
alive; the third is unreachable for reasons that have nothing to do with multiplayer.

`DOD-MP-SHIP-1` stays ❌ — honestly, and pointing at a defect outside this milestone rather than
at anything M14B built.

---

## Entry 35 — three rulings, and a correction to my own severity claim (2026-08-13)

**I OVERSTATED THE SEALED-SESSION DEFECT and Andre caught it.** I described it in a way that read
as "sealing a session destroys document delivery to that person", which would indeed blow the
feature out of the water. It does not, and the code says why.

`documentTransportFor`'s `activeSessionsWith` filters on **`row.status === "active"` in this
daemon's own store**, and falls through to `openSession` when nothing matches. So the normal path
is safe: seal a conversation → the local row goes non-active → the document sender skips it and
opens a FRESH session → documents keep flowing. **Sealing is not the trigger.**

The trigger is a **DISAGREEMENT**: the local row says active while the relay says sealed. The relay
pushes `session_sealed` exactly once, and a daemon that is down or restarting at that instant never
records it. Then the sender keeps choosing a session the relay will never accept, permanently, and
the stale row survives restarts.

**Correct severity: narrow trigger, permanent and silent consequence.** Worth fixing as a recovery
gap — not as a rescue of the feature. The distinction matters for triage, and stating it the first
way was the kind of catastrophising that makes a launch call harder rather than easier.

**Andre's rulings:**

- **D1 → fix it (A)**, on the corrected reading.
- **D2 → admin promote/demote is UN-PARKED.** Not "out of scope in writing" — it gets a line on
  this board (`DOD-MP-GOVERN-WIRE-1`) and enters launch triage, with the launch question stated on
  the line: is an operator who cannot demote a co-admin *ruined* or *inconvenienced*? The blocker
  is a wire that does not exist for a half-signed action, so it needs designing, not just coding.
  The `cello_doc_remove` guidance that says "demote first" about a non-existent verb must be
  reworded regardless.
- **D3 → option A, WITH DOCUMENTATION AND AFFORDANCES** (`DOD-MP-REMOVE-FEEDBACK-1`, D9). No
  durable rejection row — that is Tier 2. But the removed holder's own agent must be told in a
  sentence it can act on: that they were removed, at which epoch, that their copy and history
  remain theirs, and that new edits no longer publish. Today the write refusal says it, the list
  row shows a bare `removed: true`, and the skills never cover the removed holder's own view.
  Silence there reads as a bug on their screen.

---

## Entry 36 — D1 built, and the reviewer's completion REFUSED for the reason my own first cut was wrong

`DOD-MP-SESSION-RETIRE-1` shipped (`cello-client 4a1f0f4`). Two reviews: an approach validation on
Fable and the unit reviewer. **Between them, my fix was the more dangerous bug.**

**Approach — VALIDATED.** Repair-at-the-bump is the established pattern here, not a hack:
`DOD-TERMINAL-STATE-DIVERGENCE-1` already repairs this same divergence lazily at two other bump
points (a failed close, and a receipt read that misses). The send path was the third with no repair.
Also ruled OUT, and I agree: a background reconciliation sweep (heals only cosmetic cases —
forgivable), and separating documents from conversation sessions (a dedicated per-document session
hits the identical stale row; the coupling is not the root cause).

**What I got wrong, worst first:**
1. **I retired on `session_not_found`, which is documented THREE FUNCTIONS AWAY as TRANSIENT** —
   DOD-FIRSTMSG-WITNESS-1, with live evidence: in all 23 logged first-message failures the relay
   caught up 5ms–2.1s after the rejected submit. That would have destroyed live sessions seconds
   old. **Trading a stuck document for a killed conversation is strictly worse than the bug.**
2. **DB-only retirement.** Every other terminal path tears the node down, and that is not
   bookkeeping: teardown records the terminal answer for a BLOCKED `cello_receive`, detaches the
   relay stream, stops the node and frees its port — the port the replacement session may need.
   Status flip first and synchronous, then teardown, because `destroySessionNode` returns early at
   `if (!entry) return` and its status write sits after that guard.
3. **A test pinned the UNSAFE order.** It asserted log-then-retire while its own comment claimed
   retire-first was the guarantee — so it locked in the wrong behaviour and would have gone red for
   anyone who fixed it.
4. **All six tests drove a recorder.** Wire the retirement to a no-op and every one stays green.
   Added a real-database test for the DoD's literal promise: a retired session stops being
   selectable, per session not per peer, and it survives a restart — because the stale row did.

### THE REVIEWER'S COMPLETION IS REFUSED, and the reason is instructive

The unit reviewer's HIGH-1: the retirement never fires on the FULLY-sealed case, because the relay
destroys its state on `confirmSeal` and the client rewrites the resulting `session_not_found` into
**`relay_session_gone`**, which is not in `TERMINAL_RELAY_REFUSALS`. The finding is correct. The
proposed fix — add `relay_session_gone` to the terminal set — **is not, and it fails for exactly the
reason finding 1 above failed.**

`relay-node.ts` defaults to **`InMemoryRelayStore`**. A relay restart or MIG roll wipes every
session, and every client then gets `relay_session_gone` for sessions that are perfectly alive. Made
terminal, that would **retire every live session on every client whenever the relay bounces** —
which is precisely the sovereign-node invariant inverted: an unreachable node making the system
unusable, rather than routed around.

`relay_session_gone` conflates two facts — *"this session is over"* and *"the relay lost its
memory"* — and destroying durable local state on the ambiguous one is the same mistake twice.

**The safe shape for the remaining case (NOT built, needs Andre):** the document worker should open
a FRESH session after repeated terminal-ish refusals on one session, rather than retiring the old
one. That is availability-preserving and destroys nothing, so it is correct under both readings of
the ambiguous string. It is a delivery-worker change, not a session-status change.

**Recorded as owed work.** D1 is done for the case that was observed live (`session_sealed`); the
fully-sealed variant remains, with the cheap fix rejected on evidence and the safe fix named.

---

## Entry 37 — the live cross-machine test: D1 proven, and two NEW defects it surfaced

**Date:** 2026-08-13
**Topology:** CELLO_Coder_1 + CELLO_Support (Andre's laptop, one daemon) and Miss_Chelly_H (Hermes
EC2, us-east-1, a second daemon on a second machine). Both sides upgraded to identical binaries
before anything was measured — Hermes had been running daemon 0.0.155 since Aug 9 and would have
tested version skew rather than the feature.

### D1 reproduced on the SHIPPED build, unprompted, four minutes into ordinary use

Nobody staged this. The very first document proposal produced it:

1. `16:37:49` — the laptop opens session `cb380145` to carry the proposal to Hermes.
2. `16:37:58` — proposal delivered; Hermes has it.
3. `16:38:12` — the laptop seals that session (document delivery seals after handing off). The seal
   submit fails: **`relay_submit_timeout`**.
4. `16:38:35` — the laptop retries; the relay answers `session_sealed`. The seal HAD landed; only the
   acknowledgement was lost. The laptop gives up (`session.seal.autoack.skipped`).
5. **Hermes never learned the session was sealed.** Its local row still said `active`.
6. `16:39:50` onward — Hermes' delivery worker selected that session, was refused `session_sealed`,
   logged it, **left the row active**, and retried every 60s. Attempts 1, 2, 3, …

**This corrects the DoD's stated cause.** DOD-MP-SESSION-RETIRE-1 blamed a daemon that "restarted
mid-upgrade and missed the one-shot frame." No restart was involved here. A single lost seal
acknowledgement is enough, and the document layer's own seal-after-delivery manufactures the
opportunity on every proposal. The trigger is routine, not exotic — which is the part I understated
when Andre pushed back on the severity and I conceded the case was narrow. He was right to push;
I was right to be worried, for the wrong reason.

### The fix, proven as a before/after on the SAME envelope

The stuck envelope was deliberately left in place. Only the daemon version changed (0.0.165 →
0.0.166, installed from `@beta`):

- `16:57:41` — Hermes opens a **new** session `a9dcd54b`; `cb380145` is now `abandoned`/`failed`.
- `16:57:50` — `document.delivery.sent`, `sessionOpened: true`, `parked: false`.
- `pendingUnsent` 1 → **0**. An envelope stuck for eighteen minutes went through on the first
  attempt after the upgrade, and the peer's text appeared on the laptop.

Then the **same defect reproduced in the opposite direction** — the laptop, still on 0.0.165, stuck
on the fresh session `a9dcd54b` (`attempts: 3`) — and was cured by the same upgrade at `17:05:47`:
new session `8b2fa7c0` opened, delivered at `17:05:49`. **Three independent confirmations, two
machines, both directions.** DOD-MP-SESSION-RETIRE-1's observed case is closed.

### NEW DEFECT 1 — an invite never tells the EXISTING holders (silent split-brain)

Inviting CELLO_Support into the two-party document produced this, and it is not a consequence of any
restart:

- `17:00:45` `document.amendment.recorded` (locally), `17:00:51` `document.join.offer_recorded`
  (to the invitee). **No delivery is ever queued for the existing holder.**
- Proof it was never queued: the sweeps at `17:01:24`, `17:02:10` and `17:03:10` each report
  `attempted: 1` — the text write. Never 2. An amendment delivery row would have made it 2.
- The subsequent content envelope DID reach Hermes and was applied — Hermes has the laptop's text —
  and Hermes **stayed at epoch 0**. So content envelopes do not carry the amendment either.

End state, with **nothing pending on either side and no error on either side**:

| holder | epoch | participants | content |
|---|---|---|---|
| CELLO_Coder_1 | 1 | 3 | sha `54e32fb5`, 2214 chars |
| CELLO_Support | 1 | 3 | sha `54e32fb5`, 2214 chars |
| Miss_Chelly_H | **0** | **2** | sha `f2e9fc18`, 1961 chars |

The joiner's edit WAS delivered to Hermes (`document.delivery.sent`, holder `698bf453`, `17:19:44`)
and Hermes dropped it — correctly, because at epoch 0 the sender is not a participant. The membership
gate is doing its job; it is being fed a stale membership. This is the CONTROL-N-1 family again — a
governance frame that reaches one party and not the others — except here the omission is silent on
both sides, which is worse than the close bug, because nothing surfaces it.

### NEW DEFECT 2 — the document delivery sweep STOPS

The laptop's delivery sweep ran every ~60s and then stopped dead at `17:06:28`. Eleven minutes later
it had still not run, while the daemon was demonstrably alive (`registry.poll` at `17:17:21`) and a
published envelope sat `pendingUnsent: 1` with nothing attempting it.

**Control:** Hermes, on the identical daemon build, swept on schedule throughout the same window
(`17:14:35`, `17:15:35`, `17:16:35`, `17:17:35`). So this is state-dependent, not a general code
break. The laptop differs in having three agents, heavy `agent.current.switched` churn from
per-agent CLI calls, and IPC connect/disconnect churn.

A `cello logout && cello login` restored it: the first sweep after restart reported `attempted: 3`,
draining everything that had been idle, and fan-out to BOTH holders then worked exactly as designed
(`17:19:44` → Hermes, `17:19:55` → CELLO_Coder_1).

**Not diagnosed — no root cause claimed.** No error precedes the stall. What is established: it
stops, it does not recover on its own, a restart clears it, and while stalled every edit is silently
undelivered with the UI reporting a healthy document.

### What this run PROVED works

- Cross-machine convergence, two daemons, two machines, both directions.
- The on-disk file route (`cello doc publish`) carries an edit across machines.
- A joiner replays the full prior chain before consenting — CELLO_Support's copy contained text
  Miss_Chelly_H wrote before the joiner existed in the document.
- Per-holder fan-out reaches every current holder (`17:19:44` and `17:19:55`, two distinct
  `holderAgentId`s from one envelope).
- The membership gate refuses a non-participant's edit — the very mechanism that made defect 1
  visible.

---

## Entry 38 — DOD-MP-INVITE-FANOUT-1: the diagnosis was wrong, and the right one is worse

**Unit:** DOD-MP-INVITE-FANOUT-1 · **Branch:** `m14b/invite-fanout` · **Repo:** cello-client
**State:** trace complete, clause checklist below, implementation next. NOT reviewed.

### The correction, first

Entry 37 concluded the invite "queues nothing for the holders already in the document" and inferred
the code never notifies them. **That inference was wrong.** `cello_doc_invite` fans out — it loops
`derived.arrangement.participants`, skips itself and the invitee, calls `sendBytes` per holder, and
reports `holdersNotified[holder] = sent.ok`.

The evidence I read as "never queued" was right about the queue and wrong about the cause: the
amendment is sent over **direct transport**, which is not the durable delivery queue, so it never
appears in a sweep's `attempted` count no matter what happens to it.

**The real defect is worse than the one I reported.** The membership amendment — the single most
trust-critical frame in this milestone, the thing that decides who is a party to the document — is
delivered **best-effort, one shot, no pending row, no ack, no backoff, no restart survival**. A
content edit gets all five of those. The governance act that admits a person gets none.

**One failed send loses a membership change permanently, and every surface reports success.**

### Why it failed on the night, and why the OTHER fix cannot save it

At `17:00:45` the invite's `sendBytes` to the peer ran while this daemon's session with that peer was
in the stuck `session_sealed` state — the SESSION-RETIRE-1 defect, still unfixed on that build. The
send failed, `holdersNotified` recorded `false`, and nothing retried, ever.

SESSION-RETIRE-1's fix retires the dead session so the NEXT delivery opens a fresh one. There is no
next delivery here. **A retry-based cure cannot help a path with no retry** — which is the argument
for fixing this at the durability layer rather than hoping the transport underneath gets healthier.

### The design decision, and the one fact that settles it

The amendment must ride the SAME per-holder queue as content, not a second queue beside it.

**Ordering is the reason, and it is not a preference.** A holder must apply the admitting amendment
BEFORE any edit authored at the new epoch — otherwise they reject that edit as coming from a
non-participant, which is precisely the symptom observed. `document_deliveries` orders per holder by
`created_at ASC, envelope_hash ASC`. One queue therefore guarantees amendment-then-edit; two
independent queues cannot, and would reproduce the live symptom intermittently instead of always.

Logged as a Decisions Carried entry rather than re-raised: **ONE queue, ordering is the reason.**

The obstacle is that `document_deliveries JOIN document_envelopes`, and the amendment lives in
`document_amendments` (PK `owner, document, epoch`; carries `amendment_hash` + `received_bytes`).
`document_envelopes.kind` has a CHECK constraint (`update`/`withdrawal`/`rejection`), so an amendment
cannot simply be stored as an envelope row without rebuilding that constraint.

Shape: a `payload_kind` column on `document_deliveries` defaulting to `'envelope'` (existing rows
keep their meaning), the amendment seeded with `payload_kind='amendment'` and
`envelope_hash=<amendment_hash>`, and the pending query resolving its payload from whichever table
the kind names. The migration window is open BY DESIGN right now (§REALITY CHECK: essentially no
documents exist) and closes the day a real workflow depends on one.

### Clause checklist (what the reviewer receives)

1. An invite seeds a DURABLE per-holder delivery of the admitting amendment to every current holder
   except the inviter and the invitee.
2. A holder unreachable at invite time still receives the amendment — on a later sweep, after a
   daemon restart, with no operator action.
3. The amendment is delivered to a holder BEFORE any envelope authored at the new epoch.
4. One unreachable holder never blocks, delays, or fails the amendment reaching the others
   (fan-out-availability lens).
5. Failure to reach a holder is reported as a fact per holder, never collapsed into one boolean and
   never reported as success.
6. Existing content deliveries are unaffected by the schema change; the upgrade path is tested
   against a POPULATED pre-migration database, not a fresh one (§2e).
7. A holder that missed an amendment can still converge rather than diverge forever — reconciliation,
   the clause that makes this a trust fix and not just a retry fix.

---

## Entry 39 — DOD-MP-SWEEP-ALIVE-1: the trace, before any fix

**Unit:** DOD-MP-SWEEP-ALIVE-1 · **Repo:** cello-client · **State:** traced, not yet implemented.

The DoD line demands a producer/consumer trace of the timer's lifecycle before anything is changed,
because no error precedes the stall and a guessed fix here would be a guessed fix in the delivery
path every document depends on.

### The consume path — what stops, and why silently

`daemon.ts` ~3943:

```
let documentDeliveryRunning = false;
const timer = setInterval(() => {
  if (documentDeliveryRunning) return;      // <-- CONSUMER
  documentDeliveryRunning = true;
  (async () => {
    try { ...sweep every agent... logger.debug("document.delivery.sweep", ...) }
    catch (err) { logger.warn("document.delivery.tick.failed", ...) }
    finally { documentDeliveryRunning = false; }   // <-- PRODUCER
  })();
}, 60_000);
```

The no-overlap guard is correct in intent — a tick that outlasts its interval must not run twice.
Its failure mode is what matters: **the guard's release is the `finally` of an async body, so it runs
only when that body SETTLES.** An exception is contained (the `catch` is there and the `finally`
still runs). What is not covered is an await that never settles at all.

**A single hung tick therefore disables document delivery permanently, and in total silence:** the
timer keeps firing every 60s, hits `if (documentDeliveryRunning) return`, and emits nothing. No log
line, no error, no counter. Which is precisely the observed signature — including the fact that the
daemon was otherwise healthy and logging other subsystems throughout.

### The gap in the produce path — an unbounded await

Inside the pass, `document-delivery-transport.ts` `acquireSession` ends with:

```
const opened = await deps.openSession(deps.agentName, peerAgentId, correlationId);
```

That await carries no timeout of its own. The ack wait IS bounded (`awaitAck(..., graceMs)`, and
`ack_grace_expired` fires in the live log, so that bound demonstrably works). The dial is the
unbounded one.

### What the evidence supports, and what it does NOT

SUPPORTED — the last sweep line was `17:06:28`, and yet delivery work carrying a `dlv-` correlation
id happened at `17:07:38` and `17:07:39`. **A tick was running after the last completion line and
never logged one.** That is a started-but-never-finished pass, which is exactly the wedge shape
above. The control also fits: the peer daemon had ONE agent and swept on schedule all night; the
stalled daemon had three agents, so its pass had three times the opportunity to hit a bad dial.

NOT SUPPORTED — I cannot prove from the logs WHICH await hung. `openSession` is the candidate
because it is the unbounded one, not because anything recorded it. **No root cause is claimed for
the specific instance.**

### The fix this argues for

Fix the CLASS, not the guessed instance: a sweep must not be able to wedge forever, whichever await
hangs. Bound the per-agent tick; on exceeding the bound, log LOUDLY (a stuck sweep is the one thing
this subsystem must never do quietly) and release the guard so the next tick proceeds. That converts
a permanent silent outage into a logged, self-healing delay — and it holds even if the hang is
somewhere I have not found.

Bounding the dial itself is worth doing as well, but on its own it would only close the instance I
happened to guess.

---

## Entry 40 — DOD-MP-INVITE-FANOUT-1: built, reviewed, every finding fixed

**Unit:** DOD-MP-INVITE-FANOUT-1 · **Branch:** `m14b/invite-fanout` · **Repo:** cello-client
**Gate:** `pnpm test` 3764 passed / 11 skipped, lint, typecheck, build — all exit 0, run with
`set -o pipefail` and the exit code read, not the tail.

### The reviewer's verdict, quoted

> - **SPEC: DEVIATIONS FOUND** — clauses 1, 3, 5, 6 deviate, none journaled. [blocking]
> - **SILENT FALLBACKS FOUND** — HIGH-1 (parked read as delivered) and HIGH-2 (bytes-arrived read
>   as applied) are both [blocking]; MEDIUM-1 is a permanent failure with no signal at all.
> - **ERROR SUBSTITUTION FOUND** — [blocking] … `detail` is dropped at two sites so `session_sealed`
>   surfaces as an exit-point label with its cause discarded, and the MCP surface collapses every
>   per-holder failure into `false` under `ok: true`.
> - **HOLLOW TESTS FOUND** — [blocking] for the clause-6 migration test (proven not pre-migration)
>   and the underivable-chain test (survives a no-op drain).
> - **REMOVALS PROVEN** — n/a, no deletions.

Nine findings (3 HIGH, 6 MEDIUM, 3 LOW) plus four spec deviations. **All fixed.** Two were proven
by the reviewer with its own probes, not merely argued.

### What it caught that I did not

**The durable queue could still lose a membership change, three ways.** That is the humbling part:
the unit's entire purpose is not losing one.

1. **PARKED READ AS DELIVERED.** `sendBytes` returns `ok` when the RELAY took the frame because the
   holder had no live counterparty. The transport computed that bit, logged it, and threw it away.
   I cleared the debt on `ok`, so a holder who never drains the relay loses the change with both
   surfaces reporting success. Fixed by returning `parked` and treating it as a retry.
2. **BYTES ARRIVING READ AS GOVERNANCE APPLIED.** I asked the reviewer to check this and it came
   back worse than theoretical: `recordAmendment` THROWS on the receiver for a chain gap or a failed
   derivation, the router logs `document.frame.handler_threw`, and **answers nothing** — the
   amendment branch has no ack path at all. So `ok` meant "their daemon saw bytes", the row was
   acked, and a holder who refused the amendment stayed at the old epoch with the sender's queue
   empty. **The original defect, reproduced through the new machinery.**
3. **EPOCH INVERSION — proven with a probe.** `ORDER BY created_at` among only the rows that are DUE
   inverts the chain: epoch N fails once and takes a backoff, N+1 is seeded due immediately, so the
   pass sends N+1 alone. The receiver refuses it with `document_amendment_chain_gap`, whose message
   says *"an out-of-order arrival is retried by its sender, never buffered silently"* — and under
   ack-on-send nothing retried. The one message that would have explained the loss asserted the
   opposite of what happened.

**And the fix was wired into one of four sites.** The re-invite path — whose own comment calls it
*"the healing verb"* for a holder that missed a fan-out, and which the tool's guidance tells the
operator to run — still had the one-shot loop. So did both removal paths. A holder who misses a
REMOVAL keeps accepting edits from someone the chain has removed. One helper now serves all four.

### The one place I did better than the proposed fix

The reviewer's remedy for HIGH-2 was to keep the row pending on an ack timeout and settle it "on a
positive signal … clause 7's missing wire hook". That would leave every amendment ever re-sent every
ten minutes forever, because no such signal exists.

There already is one. **A holder that acks an envelope authored at epoch E demonstrably holds every
amendment up to E** — the inbound epoch gate refuses any envelope whose epoch does not match the
receiver's own derived arrangement, so their ack of the CONTENT is an ack of the GOVERNANCE that made
the content admissible. `ackAmendmentsThroughEpoch` settles the rows on that. No new frame, no wire
change, and it is proof rather than inference.

It is not complete on its own — a document with no further edits never produces the proof — so the
row also re-sends on the ack timeout. Belt and braces, with the braces being real evidence.

### Deferred, with a home (no silent deferral)

Clause 7 is NOT built and is now its own line, **DOD-MP-AMEND-CONFIRM-1**. The reviewer sharpened
what it has to cover, and this is worth quoting because it changes the shape of the work:

> If B is unreachable for longer than that ~50-minute window, C abandons B for that envelope
> permanently. Membership converges when A's retry finally lands; **the content does not**. Clause 7
> is not only "the sender never learns a holder is behind" — it is also "a holder who is behind loses
> edits that will never be resent."

Also deferred to the merge: splitting the amendment counters out of the aggregate
`document.delivery.sweep` line, because that line lives in `daemon.ts`, which belongs to the
SWEEP-ALIVE-1 branch — two branches must never touch one file.

---

## Entry 41 — DOD-MP-SWEEP-ALIVE-1: bounding the sweep was not enough

**Unit:** DOD-MP-SWEEP-ALIVE-1 · **Branch:** `m14b/sweep-alive` · **Repo:** cello-client
**Gate:** test 3761 passed / 11 skipped, lint, typecheck, build — all exit 0.

### The reviewer's verdict, quoted

> - **SPEC: DEVIATIONS FOUND** — [blocking] the un-journaled deviation is that delivery for the
>   wedged agent does not recover … It is fixed for the sweep and for other agents; it is not fixed
>   for the agent that hung.
> - **SILENT FALLBACKS FOUND** — [blocking] H1: the bound papers over the wedge for the sweep while
>   the affected agent reports through a log line that asserts a recovery that cannot happen.
> - **HOLLOW TESTS FOUND** — [blocking] T6 does not detect removal of the thing it names; T3 asserts
>   the recovery clause against a stub that structurally cannot exhibit the production failure;
>   T4/T5/T6 all survive a full revert of the fix; the daemon.ts integration point is uncovered.

### What it caught, proven by running the code rather than reading it

**The bound fixed the sweep and left the agent dead.** `DocumentDelivery.tick` has the IDENTICAL
defect one layer down — it caches its pass in `#inFlight` and clears it in a `finally`. So after a
hang, every later tick hands back the same hung promise: `#run` is never entered again, the agent
never delivers again, and **each pass re-races that promise for the full bound**. On the live
three-agent daemon that is a 2× sweep-interval regression for the healthy agents, presenting as
"documents are slow" with nothing saying why.

My own log line then told the operator to wait: *"its documents are not being delivered until it
clears."* It never cleared.

Fixed by evicting the wedged worker so the next tick constructs a fresh one. Verified safe: the pass
claims each row (`recordHolderAttempt`) BEFORE it dials, so anything the hung pass was holding is
already scheduled forward and is not due — eviction cannot double-send.

**Three more, all correct:** a stuck agent was counted as swept, making the sweep line byte-identical
to a healthy idle one on the one occasion it matters; the 120s bound is reachable by a legitimately
slow pass (10s lookup × fan-out + 30s ack budget), so it would have warned on the normal case —
raised past the arithmetic; and a pass that rejects AFTER being abandoned had its error absorbed by
the settled race and logged nowhere, discarding the best evidence about which await hangs, on a
defect whose root cause is still open.

**On the tests it was blunt and right.** Reverting only the daemon wiring left all six green — every
test was a unit test of the helper, and the defect lives in the guard release. The timer test could
not detect removal of the `clearTimeout` it was named after (it measured elapsed wall-clock; the
race resolves regardless). The recovery test's "second pass" was a fresh closure with no re-entry
guard, so it could not exhibit the production failure at all. Replaced with a runner carrying
`tick`'s exact cached-promise shape, plus the first coverage the call site has ever had.

### One correction I made to my own fix mid-flight

Adding the late-failure log made a pass that throws BEFORE the bound fires log twice — once here,
once in the caller's `catch`. Narrowed to genuinely-late by tracking whether the bound had won.

---

## Entry 42 — DOD-MP-SESSION-RETIRE-1 (remaining half): the fix could not see its own signal

**Unit:** DOD-MP-SESSION-RETIRE-1 · **Branch:** `m14b/delivery-fresh-session` · **Repo:** cello-client
**Gate:** test 3764 passed / 11 skipped, lint, typecheck, build — all exit 0.

### The reviewer's verdict, quoted

> - **SPEC: DEVIATIONS FOUND** — the trigger clause is unmet; the fix cannot observe
>   `relay_session_gone` [blocking]
> - **SILENT FALLBACKS FOUND** — `session-node-manager.ts:3822` continues past a relay refusal and
>   reports `ok: true, delivered: true` for an unwitnessed leaf, and this unit's `noteSuccess` then
>   clears suspicion on it [blocking, HIGH]
> - **HOLLOW TESTS FOUND** — 6 of 10 new tests survive full feature removal; 2 of the 3 transport
>   tests survive; the reason-set test pins a string the producer cannot emit [blocking]

And on the premise the whole unit rests on:

> **First: your premise is TRUE. The refusal was right.** … Nothing repopulates sessions on restart.
> So: relay restart → store wiped → client … gets `session_not_found` → relabels it
> `relay_session_gone`. Making that terminal would retire live sessions on every relay bounce.

### The unit was INERT, and worse than inert

`relay_session_gone` is produced by the relay client, is deliberately not in
`TERMINAL_RELAY_REFUSALS`, and therefore falls through to a warn — after which execution continues
into the direct peer-to-peer send. On success `sendContent` returns `ok: true, delivered: true` **for
a leaf the relay never witnessed**. The content arrives; the record stops growing, silently.

So my counter could never see the one string the unit is named after — and every such send called
`noteSuccess`, actively clearing the count. A session whose relay record was permanently gone stayed
in rotation forever. This is the 68-minute unwitnessed-chain defect that `TERMINAL_RELAY_REFUSALS`
was written to kill, re-entering through the door left open for the relay-bounce case.

Fixed by carrying the relay's answer to the caller on the SUCCESS path. It changes success or failure
for nobody; it lets the document worker — which has no human in the loop — see that a session's
record is dead and route around it.

**The measured eviction bug.** A session that CROSSED the threshold is filtered out of the candidate
list, so it never fails again, ages to the front of the insertion order, and is evicted FIRST. My
comment claimed the opposite. Reads now count as use.

**The harshest finding was the fairest:** the tests stubbed `sendContent` returning
`{ ok: false, reason: "relay_session_gone" }` — a shape the real dependency **cannot** return. The
suite defined a contract the producer does not honour, which is exactly how a green suite sits on
top of a fix that can never fire. Rewritten against the shape production actually returns.

### Parked, with homes (no silent deferral)

Two are genuine design forks, not defects in this diff, and both are now DoD lines:
**DOD-MP-RELAY-GONE-DISAMBIG-1** (a send whose leaf was never witnessed should not report success)
and **DOD-MP-ZOMBIE-SESSION-1** (bypassed sessions stay `active` forever, so every restart re-learns
them at up to 600s of backoff each).

Also found, in the OTHER repo and outside this milestone: `packages/relay/src/bin/relay.ts`
constructs a file-backed WAL and never passes it to the relay node, so every gap-fill answers
`wal_unavailable`. Recorded here so it is not lost.

---

## Entry 43 — the live proof, two machines: an invite survives an offline holder

**Published:** daemon `0.0.167`, cli `0.0.174` (beta; the `latest` promotion is Andre's).
**Verified against the tarball**, not the CI status: `delivery-sweep-bound.js` and
`delivery-session-suspects.js` present, `document_amendment_deliveries` in the built store,
`ackAmendmentsThroughEpoch` in store + worker, `relayRefusal` threaded through
`session-node-manager.js` and `document-delivery-transport.js`. `cli@0.0.174` cross-pins
`daemon@0.0.167` — a real version, never `workspace:*`.

### The scenario, with the failure injected deliberately

Andre's laptop and the Hermes EC2 agent, both on `0.0.167`. A two-party document, proposed and
accepted across the two machines. Then **the Hermes daemon was stopped**, and a third holder invited
— which is exactly the shape that diverged silently earlier tonight, except that tonight it happened
by accident and here it is on purpose.

| time | what happened |
|---|---|
| `20:40:40` | invite runs with the holder DOWN → `holdersNotified: { 698bf453…: false }` |
| `20:40:40` | `document.amendment.holder_unnotified { verb: "invite", reason: "relay_parked", detail: "the relay is holding it — the holder had no live counterparty" }` |
| — | Hermes brought back up. **No operator action of any kind after this point.** |
| `20:42:27` | `session.document.received { kind: "amendment" }` |
| `20:42:27` | `document.amendment.recorded { epochId: 1, kind: "add_holder", amendmentHash: d1252732… }` |

**Hermes: epoch 0, 2 participants → epoch 1, 3 participants.** The hash matches the one the invite
minted. Before tonight this was one `sendBytes` that failed and was forgotten.

### `relay_parked` fired on the FIRST live run, which is the review's HIGH-1 in the wild

The refusal reason was not a transport error — it was `relay_parked`. The relay accepted the frame
because the holder had no live counterparty. **Under the code as I first wrote it that returns `ok`,
and the debt would have been cleared right there**, losing the membership change with every surface
reporting success. The reviewer found that by reading; the very first live run produced it.

### What this does NOT fix, demonstrated on the way

The document that diverged earlier tonight (`b6d58753…`) is **still diverged and cannot be healed.**
Re-running the invite refuses with `document_already_holder`: the healing verb only re-fans while a
join is still pending, and this joiner already accepted. There are no owed rows for it either,
because its invite predates the fix.

So: laptop at epoch 1 with 3 participants, Hermes at epoch 0 with 2, permanently, with nothing
pending and no error on either side. **That is DOD-MP-AMEND-CONFIRM-1 with a live specimen attached**
— reconciliation is not a nicety, and there is a real document proving it.

---

## Entry 44 — DOD-MP-CONTROL-DURABLE-1 and DOD-MP-REMOVE-FEEDBACK-1 — BUILT, REVIEW OUTSTANDING

Both units are written and green; **neither tag flips until a reviewer's verdict is quoted here.**
CONTROL-DURABLE-1 is with the unit reviewer now; REMOVE-FEEDBACK-1 is queued behind it.

### CONTROL-DURABLE-1 — the ending is now owed, not merely attempted

The notifier signed once, sent to each derived holder, and persisted nothing. One failed send and
the frame was gone, so a holder offline at that instant never learned the document had ended and
their copy stayed open for good — while the operator's own surface reported the close as done.

The frame is now recorded before it is attempted, retried by the worker, and settled honestly.

**Two design points worth their own sentences:**

**Control frames drain LAST, which is the opposite of amendments and deliberate.** An amendment must
reach a holder BEFORE the content that depends on it, or they refuse that content as coming from a
non-participant. A close must reach them AFTER the content it terminates, or they end the document
holding less of it than the sender does. Same queue discipline, opposite ends, for the same reason:
what the frame means relative to the content around it. *(This deviates from the DoD line's own
words — "drain them ahead of content" — and the deviation is flagged to the reviewer rather than
quietly taken.)*

**A control frame has no ack, so it is never called acked.** It is marked SENT, re-offered every
600s, and after five sends settled as RETIRED with an ERROR naming the holder — because the
consequence is that somebody still believes this document is open. Giving up is a real choice: the
alternative is chattering at every holder for the life of every document. Retired and acked are
separate columns so the record cannot claim they were told.

### REMOVE-FEEDBACK-1 — the view nobody writes down

`cello_doc_list` said nothing about removal. A document you have been removed from simply stopped
listing you among the participants — which renders identically to one you are still part of and have
not looked at closely. The single fact that changes what you can do with it was the one fact missing.

The row now carries `yourAccess`, the epoch it changed at, and a sentence constrained by
FORWARD-ONLY-REMOVAL: it says what REMAINS yours and never uses the language of something taken,
because nothing was and nothing could be. The skill gains the same view in prose — your copy is
yours forever, what stops is the flow of edits in both directions, your write refuses with a reason,
and getting back in needs an admin plus your own accept.

**And it caught a third instance of an old regression.** `membershipOf` walks the chain and throws on
one that will not decode; my new call ran inside the listing loop, so an unreadable chain on ONE
document would have taken down the whole list. That exact defect has been fixed here twice before,
each time through a different call site — **a new caller inherits the hazard, not the fix.** The
existing regression tests went red immediately, which is what they are for.
