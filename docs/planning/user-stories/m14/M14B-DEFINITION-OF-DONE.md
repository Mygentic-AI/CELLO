---
name: M14B Federated Collaborative State V2 Definition of Done
type: definition-of-done
date: 2026-08-04
milestone: M14B
status: parked
topics: [m14b, collaborative-state, tier-2, canonicalization, epochs, purge, schema-enforcement, attestation]
description: >
  The PARKED yardstick for M14B — collaborative state V2 (Tier 2, attested): canonicalization,
  per-batch attestation, quiescence agreement and divergence records, epochs, purge, and schema
  enforcement. Written 2026-08-04 alongside the M14 DoD so V2-shaped decisions have a durable
  home. Carries NO status tags and activates only when M14 closes AND the four preconditions are
  resolved. Spec-of-record is §16 of the 2026-07-31 federated collaborative state architecture
  log plus the Tier-2 sections it points into (§6–§10, §3.3).
---

# M14B — Definition of Done (PARKED)

## How to use this — the parking rules

- **This DoD is parked.** No line carries a status tag; no unit starts from it. It exists so
  that decisions already made about V2, and deliverables already known to belong to V2, live in
  a yardstick rather than scattered across discussion logs someone must re-mine.
- **It activates when BOTH hold:** (1) [[M14-DEFINITION-OF-DONE]] is closed; (2) the four
  preconditions below are resolved in one design session and its log is named here as
  co-spec-of-record.
- **Lines below are real but their exact shape may shift** when the preconditions are answered.
  This document says so instead of pretending they are final. On activation, every line gets
  re-read against the design session's output, given status tags, and split/renumbered as
  needed — that re-read is itself the first unit.
- **While M14 runs:** any V2-shaped decision or discovery made during V1 work lands HERE (in
  Decisions Carried or as a line amendment), not in a journal aside. That is this document's
  job before activation.

## Preconditions — four owed design items (§16.1)

Closed in ONE design session before any line below goes active. Until then they gate the whole
document the way the screening audit gates M14's screening line.

1. **PRE-QUIESCENCE** — Quiescence triggering. §7.1 defines the agreement flow (propose →
   confirm/diverge) but not WHEN it runs or WHO initiates outside a seal. Intermediate
   checkpoints need a trigger design: on close only? every N batches? operator-invoked?
2. **PRE-EPOCH-WIRE** — The epoch wire protocol. §10 gives principles (bilateral, signed,
   chains to previous, carries the canonical hash) but not the exchange: proposal/ack frame
   shapes, refusal semantics, and what happens to updates in flight across the boundary — the
   case §14's test vectors name without a protocol to test.
3. **PRE-SCHEMA-LANG** — The schema language. §3.3's "the first update IS the schema" names a
   JSON blob declaring fields, types, write authority, and update rules; that language has zero
   specification. V2's largest single work item — scope it deliberately (it may deserve its own
   sub-wave).
4. **PRE-DIVERGENCE-RECOVERY** — Divergence recovery. Detection and bisection are designed
   (§7.1: per-batch attestations bisect; the divergence record is first-class output); the
   recovery flow — who proposes the epoch reset, what happens to legitimate work stacked after
   the fork point — is a sentence, not a protocol.

## Repo Legend
| Tag | Local path | Notes |
|-----|-----------|-------|
| `cello-client` | `/Users/andrep/Documents/code/cello-client` | PRIMARY. Ships via `/cello-publish` |
| `trustless-cello` | `/Users/andrep/Documents/code/trustless-cello` | Spine enforcers; any directory/relay touch |

---

## Tier Q0 — Canonicalization (the boundary that defines Tier 2 — §6, §8)

- **DOD-DOC2-CANON-1** [cello-client] — the two canonicalization rules, exactly two (§8):
  text/Markdown/any-non-JSON = the string itself, UTF-8, fixed newline convention, hash the
  bytes; JSON = RFC 8785 (JCS). XML/HTML/source are Y.Text of source bytes under the text rule —
  structural canonicalization exists for JSON only; XML C14N is deliberately never entered. The
  governing rule as a test: canonical output depends only on visible converged state, never the
  path that produced it (same converged content via different edit histories → identical bytes).
- **DOD-DOC2-CANON-VECTORS-1** [cello-client] — the shared conformance vector suite (§14):
  committed vectors both implementations of any future port must produce byte-identically;
  includes path-independence cases (same state, different histories), newline/escaping/number
  edge cases for JCS, and the empty/unicode boundaries. Drift here surfaces as a false
  divergence alarm at quiescence — the worst failure mode for trust in the mechanism — which is
  why the suite is its own line, not a clause.

## Tier Q1 — Attestation and agreement (§7)

- **DOD-DOC2-ATTEST-1** [cello-client] — per-batch attestation, never a gate: each published
  batch carries the sender's Yjs state vector + post-apply canonical hash. A receiving-side
  mismatch is INFORMATION (concurrent work), not an error — pinned by the §7 async test (both
  at H0, A publishes X, B publishes Y, both converge to H3 neither predicted, nothing rejects).
  In the sequential case the hashes chain into a verifiable incremental history.
- **DOD-DOC2-AGREE-1** [cello-client] — the quiescence agreement flow (§7.1, trigger per
  PRE-QUIESCENCE): propose `(state_vector, canonical_hash, signature)` → responder checks
  vectors (unequal = not quiescence: sync, retry) → match → countersign; both store the
  bilateral attestation. **Diverge:** different hashes at matching vectors → both sign the
  divergence record carrying both hashes and both vectors — first-class protocol output, not an
  error path. Seal policy: a Tier 2 session seals with either a bilateral attestation or a
  divergence record — present or recorded-absent, never silently missing. Close (V1's mutual
  acks) gains the agreement as its final step.
- **DOD-DOC2-RECOVER-1** [cello-client] — divergence recovery (per PRE-DIVERGENCE-RECOVERY):
  bisect via per-batch attestations to the last identically-derived state; epoch-reset from it;
  the fate of post-fork legitimate work per the design session.

## Tier Q2 — Epochs (§10, wire protocol per PRE-EPOCH-WIRE)

- **DOD-DOC2-EPOCH-1** [cello-client] — the epoch primitive: bilateral, signed, chains to the
  previous epoch, carries the canonical hash at the boundary; `epoch_id` stops being constant 0
  (the V1 seam pays off here — no envelope migration). Epoch attestations checkpoint the
  document log (§9.1); verification of epoch N+1 starts from the attested state, not genesis.
  **Document-property changes (immutable post-accept in V1, §16.3) become possible here as
  epoch events** — a sixth load-bearing use of the primitive alongside §10's five. In-flight
  updates across the boundary per the design session, with the §14 test vectors.
- **DOD-DOC2-COMPACT-1** [cello-client] — compaction + limits-as-triggers (§10.1): hitting a
  limit PROPOSES an epoch through the durable outbound; while unacknowledged, limits are
  advisory and the full log is retained; the hard-cap backstop is refusing new local publishes
  (loud backpressure), NEVER unilateral compaction; a long-absent peer is a lifecycle event
  (dormant, surfaced), not a license to compact.
- **DOD-DOC2-TIER-UP-1** [cello-client] — Tier 1 → Tier 2 upgrade at an epoch boundary (§6):
  both converge, both sign the canonical hash, attested from that point forward, **never
  retroactively**. The handshake's `assurance_tier` accepts `attested` from this unit on;
  mutual visibility enforced (one party believing attested while the other computes nothing is
  the failure the handshake field exists to prevent).
- **DOD-DOC2-PURGE-1** [cello-client] — purge (§3.2, §16.7-3): rejection severity `purge` for
  content-is-the-harm; both parties mint an epoch from the last agreed state; the sender
  re-creates from snapshot with a fresh clientID and re-applies legitimate work; no copy in
  either live document. **Blast radius is ONE envelope:** the flagged envelope's payload is
  stripped (nullable since V1), hash + signature retained so `doc_prev_hash` chaining stays
  intact, every other envelope untouched — a redacted envelope proves "an envelope with this
  hash existed and was rejected", the referencing `0x05` leaf is the explanation. **Purge is
  cooperative:** a compliant sender's daemon redacts its own log as part of honoring it; a
  non-compliant one is a policy-log fact — the claim is scoped, never overstated (the sender
  always possessed the content).

## Tier Q3 — Schema enforcement (§3.3, language per PRE-SCHEMA-LANG)

- **DOD-DOC2-SCHEMA-1** [cello-client] — `schema_enforcement: true` becomes acceptable at the
  handshake: the first update is the schema; negotiable as ordinary updates until agreed; from
  then on every incoming update validates against it at the SAME gate hook V1 built
  (DOD-DOC-GATE-1 — the rules are pluggable by construction); a schema rejection may carry a
  suggested modification the sender's daemon can roll back to and re-publish. Schema changes
  mint an epoch. Receiver-local limits carry into schema rejections unchanged (§16.7-6). The
  stale-epoch returning-collaborator flow (§16.7-9) works with no new machinery: publish
  against an old epoch → rejected with current epoch → daemon syncs → agent re-applies.
- **DOD-DOC2-PROFILE-HINT-1** [cello-client] — the shared screening-profile hint (M14-P2), if
  V1 operation showed the rejection friction that justifies it — advisory in both directions,
  never load-bearing. Drop this line at activation if the friction never materialized.

## Tier Q4 — Enforcers + ship

- **DOD-DOC2-E2E-ATTEST-1** [trustless-cello] — Tier-2 enforcer: two daemons on an attested
  document — concurrent batches with per-batch attestations, quiescence agreement countersigned,
  then a DELIBERATE out-of-band file corruption on one side → the divergence record is produced
  and both sides hold it. The alarm must be shown to fire, not assumed.
- **DOD-DOC2-E2E-EPOCH-1** [trustless-cello] — epoch enforcer: limit-triggered epoch proposal →
  bilateral transition → old log checkpointed → verification from the attested baseline; then
  the purge path: rejected-with-purge → epoch reset → flagged payload stripped on both sides,
  chain still verifies, unrelated envelopes untouched — with concurrent work in flight (§14's
  named vector).
- **DOD-DOC2-E2E-SCHEMA-1** [trustless-cello] — schema enforcer: enforced document — an
  out-of-schema update rejected with the suggested modification, sender re-publishes corrected,
  converges; schema change mints an epoch; stale-epoch publish from a returning collaborator
  recovers.
- **DOD-DOC2-SHIP-1** [cello-client, trustless-cello] — publish cascade + live fleet smoke of
  the Tier-2 journey; Andre runs the `latest` promotion.

---

## Decisions Carried (made 2026-08-04, before parking — binding on activation)

- **Purge is cooperative** and its claim is scoped (§16.7-3) — see DOD-DOC2-PURGE-1.
- **Purge's blast radius is one envelope, never the log** (§3.2) — redact, don't truncate; the
  anti-forensic-erasure argument is the reason and is not up for re-derivation.
- **Tier upgrade is never retroactive** (§6).
- **The intermediate "cheap attestation" tier stays rejected** (§6) — canonicalization is the
  cost; once paid, take Tier 2 whole.
- **Receiver-local limits, machine-readable reasons** (§16.7-6) — carries into schema
  rejections.
- **Replay stays set-based per epoch** (§16.7-5) — epochs segment it; they do not reintroduce a
  total order.
- **A redacted envelope's meaning** is fixed (§16.7-12): proves existence + rejection via the
  retained hash/signature and the referencing `0x05` leaf.
- **Exactly two canonicalization rules** (§8) — any proposal to parse XML/HTML/source
  structurally is a re-litigation; refuse it.

## Explicitly beyond M14B (so absence reads as intent, not omission)

- **Mesh / delivery lists** (§11.2) — deferred, not rejected; needs participant-list-as-state,
  mandatory retry, N-way agreement, forced full mesh. Its own milestone when the peer case
  demands it.
- **Trust-signal integration for non-compliant senders** beyond the policy log (§16.7-2).
- **Directory-side presence subscription** (M14-P4) — a delivery-latency upgrade, not Tier 2.

---

## Related Documents
- [[M14-DEFINITION-OF-DONE]] — V1's active yardstick (this document activates when it closes)
- [[M14-PROCEDURE]] — the operating runbook (M14B inherits it with a new §1c enforcer set)
- [[2026-07-31_federated-collaborative-state-architecture]] — spec-of-record (§16 + §6–§10, §3.3)
- [[2026-05-08_1612_shared-state-as-protocol-primitive|Shared State as Protocol Primitive]] —
  the schema-as-contract origin that Tier Q3 implements in its reshaped, opt-in form
