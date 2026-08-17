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

> ### 🔄 PIVOT (2026-08-14) — the spec of record is now [[M14B-RECONCILE-SPEC]] (v2)
> The delivery half of this milestone is being **replaced, not repaired**. Active work lives in
> **Tier SYNC** below (the spec's phases P0–P6); the pre-pivot tiers are history plus the seven
> lines the spec's §15 strikes once its deletions land. Do not pull a unit from the old tiers
> without checking §15 first.

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
> ⚠️ **SHIP-1's fleet clause is BLOCKED BY A DEFECT OUTSIDE THIS MILESTONE (Entry 33).** The
> daemon restarted mid-upgrade and missed the one-shot `session_sealed` frame, so it holds sessions
> the relay has ended. Conversations refuse correctly and tell the operator; the DOCUMENT delivery
> worker retries into a dead session forever with nobody to open a replacement. Everything M14B
> built is proven on the fleet — including the close addressing both holders; only the steps that
> need a frame to ARRIVE are unproven. Needs its own line and Andre's call.

- ~~**DOD-MP-SESSION-RETIRE-1**~~ — **STRUCK by SYNC-P4** (spec §15): its subject is deleted with the delivery/control machinery; the reconcile exchange carries the guarantee now.
<!-- struck: **DOD-MP-SESSION-RETIRE-1** [cello-client] — a session the relay has TERMINALLY ended must be
  retired locally, so the next document delivery opens a fresh one instead of resubmitting into a
  grave. The relay pushes `session_sealed` once; a daemon down or restarting at that instant never
  records it, and then `activeSessionsWith` — which filters on THIS daemon's own `status` — keeps
  handing every document frame to a session that can never accept one. Observed live 2026-08-13:
  the delivery worker retried the same sealed session every 60s indefinitely, and the stale row
  survived `cello logout && cello login`. The terminal branch already KNOWS (it logs "nothing sent
  now can ever be part of its record" and tells a conversation operator to start a new session);
  it must also act, because document delivery has no human in the loop to act for it. Availability
  and fallback are first-class — a route with no fallback is the defect. — ✅ (Entries 36, 37, 42)
  > **The observed case is now PROVEN LIVE across two machines (Entry 37).** Reproduced unprompted on
  > shipped 0.0.165 four minutes into ordinary use, then fixed as a before/after on the SAME stuck
  > envelope with only the daemon version changed — and reproduced again in the opposite direction
  > and cured the same way. Three confirmations, two machines, both directions.
  > **The cause stated above is TOO NARROW.** No restart is needed: the laptop's own seal-after-
  > delivery timed out on its acknowledgement (`relay_submit_timeout`), the seal had in fact landed,
  > and the peer went on believing the session was alive. One lost ack is enough, and every proposal
  > creates the opportunity.
  > Built and reviewed twice (approach + unit); 4 findings fixed, incl. the HIGH that my first cut
  > retired on `session_not_found` — documented as TRANSIENT with 23 logged cases — which would
  > have destroyed live sessions seconds old. Now `session_sealed` only, status-flip-then-teardown,
  > with a real-DB test for the promise. **REMAINING:** the FULLY-sealed case answers
  > `relay_session_gone`, which is not terminal. The reviewer's fix (add it to the terminal set) is
  > REFUSED on evidence: the relay stores sessions in memory, so that string also fires on a relay
  > restart, and treating it as terminal would retire every live session on every client whenever
  > the relay bounces — the sovereign-node invariant inverted. **The review independently verified
  > this premise and could not falsify it** (`InMemoryRelayStore` is the only implementation and the
  > deployed entrypoint passes no store).
  > **NOW BUILT (Entry 42).** The document worker stops REUSING a session after repeated terminal-ish
  > answers and opens a fresh one, destroying nothing. The first cut was INERT: `relay_session_gone`
  > never reached it — the send falls through to a direct delivery and returns success for a leaf the
  > relay never witnessed, so the counter never saw it and every such send CLEARED it. The relay's
  > answer now survives to the caller on the success path. Two forks parked as their own lines below. -->
- ~~**DOD-MP-INVITE-FANOUT-1**~~ — **STRUCK by SYNC-P4** (spec §15): its subject is deleted with the delivery/control machinery; the reconcile exchange carries the guarantee now.
<!-- struck: **DOD-MP-INVITE-FANOUT-1** [cello-client] — **an invite must tell the EXISTING holders, not only
  the invitee.** Found live 2026-08-13 (Entry 37) and it is the most serious open defect on this
  board, because it is silent on every surface. Inviting a third agent into a two-party document
  records the amendment locally and offers it to the invitee — and delivers the amendment to the
  existing holders **BEST-EFFORT, ONE SHOT, WITH NO DURABILITY AND NO RETRY.**
  **Mechanism corrected 2026-08-13 (Entry 38) — the first reading was wrong.** `cello_doc_invite`
  DOES fan out: it loops the derived participants and calls `sendBytes` per holder, recording
  `holdersNotified[holder] = sent.ok`. But that is direct transport, **not** the durable delivery
  queue — no pending row, no ack, no backoff, no restart survival. **One failed send loses the
  membership change permanently.** That is exactly what happened live: at the moment of the invite
  this daemon's session with the peer was stuck in the `session_sealed` state (the SESSION-RETIRE-1
  defect), the send failed, and nothing ever retried — and SESSION-RETIRE-1's fix cannot rescue it,
  because this path has no retry to rescue. The three sweeps spanning the invite each report
  `attempted: 1` precisely because the amendment was never in the queue at all. Content envelopes do
  not carry it either — the peer applied a later write while remaining at epoch 0. End state: two
  holders at epoch 1 with 3 participants, the third at epoch 0 with 2, **nothing pending and no
  error on either side**. The joiner's edits are then dropped by the
  stale holder — correctly, since at its epoch the sender is not a member — so the membership gate
  reads as the culprit when it is the only thing behaving. This is the CONTROL-N-1 family (a
  governance frame reaching one party and not the others), and worse than the close bug it mirrors,
  because nothing surfaces it to anyone. Same derived-holder-set fan-out as CONTROL-N-1 is the
  shape; an absent holder must also be able to reconcile a missed amendment rather than diverge
  forever. — ✅ (Entries 40, 43) durable per-holder amendment queue, head-of-line by chain epoch,
  settled by PROOF BY EPOCH; all four fan-out sites wired; 9 review findings + 4 spec deviations all
  fixed. **PROVEN LIVE across two machines on daemon 0.0.167:** a third holder invited while the peer
  daemon was STOPPED (`relay_parked`, `holdersNotified: false`) — the peer returned and reached epoch
  1 with 3 participants unaided, amendment hash matching. Reconciliation split out as
  DOD-MP-AMEND-CONFIRM-1, which now has a live specimen: the document that diverged before the fix
  cannot be healed by any verb. -->
- **DOD-MP-SWEEP-ALIVE-1** [cello-client] — **the document delivery sweep must not stop.** Observed
  live 2026-08-13 (Entry 37): the laptop's sweep ran every ~60s and then stopped dead, and eleven
  minutes later had still not run, while the daemon was demonstrably alive and a published envelope
  sat `pendingUnsent: 1` with nothing attempting it. Control: the peer daemon on the IDENTICAL build
  swept on schedule throughout the same window — so this is state-dependent, not a general code
  break; the stalled side had three agents, heavy current-agent switching, and IPC churn. A restart
  cleared it (first sweep after: `attempted: 3`). **Not diagnosed — no root cause is claimed here,
  and no error precedes the stall.** What is established: it stops, it does not recover on its own, a
  restart clears it, and while stalled every edit is silently undelivered while the document reports
  healthy. Needs a producer/consumer trace of the timer's lifecycle before any fix. — ✅ (Entries
  39, 41) traced first, then bounded: the overlap guard releases in a `finally` that only runs when
  the pass SETTLES, so one hung await disabled delivery for the life of the process in total
  silence. The wedged worker is now evicted too — the review proved by execution that bounding alone
  left the agent permanently dead AND doubled the sweep interval for every healthy agent. Root cause
  of the hang itself is still unclaimed; a late-failure log was added as the cheapest route to it.
- ~~**DOD-MP-RELAY-GONE-DISAMBIG-1**~~ — **STRUCK by SYNC-P4** (spec §15): its subject is deleted with the delivery/control machinery; the reconcile exchange carries the guarantee now.
<!-- struck: **DOD-MP-RELAY-GONE-DISAMBIG-1** [cello-client] — **a send whose leaf was never witnessed must
  not report success.** Found by review 2026-08-13 (Entry 42), pre-existing, and a genuine fork
  rather than a defect in that diff. On `relay_session_gone` the daemon warns, delivers directly, and
  returns `ok: true, delivered: true` — the content reaches the peer and the session's hash chain
  stops growing, with the operator's surface showing a clean send. This is the shape of the measured
  68-minute unwitnessed-chain defect. The ambiguity is resolvable AT THE RELAY CLIENT, which already
  names the three sub-cases in its own guidance ("sealed, idle-swept, or restarted"): re-present the
  assignment ONCE — if it succeeds the relay merely bounced and the session is alive; if it fails the
  session is over. Today the code explicitly declines to run that test, to avoid recreating a session
  with an empty leaf log. **Andre's call: it changes the send path, which conversations share.**
  Mitigated meanwhile — the refusal is carried to the document worker, which routes around it. — ❌ NOT BUILT -->
- ~~**DOD-MP-ZOMBIE-SESSION-1**~~ — **STRUCK by SYNC-P4** (spec §15): its subject is deleted with the delivery/control machinery; the reconcile exchange carries the guarantee now.
<!-- struck: **DOD-MP-ZOMBIE-SESSION-1** [cello-client] — **nothing ever reaps a bypassed session.** Because
  DOD-MP-SESSION-RETIRE-1's remaining half deliberately destroys nothing, a session it routes around
  stays `active` in the database forever, and the suspicion that hides it is in memory by design.
  After every daemon restart delivery must re-learn each zombie — 2 failed attempts apiece, against a
  backoff that caps at 600s — which the review costs at **~60 minutes with three zombies to one
  peer**, presenting to the operator as exactly the original symptom: a pending count that never
  falls. Persisting the suspicion is NOT the answer (that is the destructive fix wearing a smaller
  hat). Either the reap belongs upstream — once RELAY-GONE-DISAMBIG-1 lands, a proven-dead session is
  genuinely retirable — or the count is bounded: when a peer accumulates N active sessions and the
  newest works, seal the older ones. Not a silent choice either way. — ❌ NOT BUILT -->
- ~~**DOD-MP-CONTROL-DURABLE-1**~~ — **STRUCK by SYNC-P4** (spec §15): its subject is deleted with the delivery/control machinery; the reconcile exchange carries the guarantee now.
<!-- struck: **DOD-MP-CONTROL-DURABLE-1** [cello-client] — **close and kill are still one-shot.** Found by
  audit while fixing INVITE-FANOUT-1 (Entry 40), same family, deliberately NOT folded into it:
  `document-control-notifier.ts` signs once, sends to each derived holder, and persists nothing —
  no pending row, no retry, no restart survival, exactly the shape the amendment fan-out just shed.
  A holder unreachable at that moment never learns the document ended.
  **Ranked below the membership work on purpose.** A missed control frame diverges visibly: the
  stale holder keeps editing and their edits start refusing, so something surfaces. A missed
  MEMBERSHIP change diverges silently and permanently, which is why that one was fixed first. The
  per-holder reporting (`holdersNotified` + `holderFailures` with causes) already exists here, so
  an operator can see it happened — what is missing is the daemon acting on it without them.
  The machinery now exists and is generic: seed rows, drain them, settle on evidence. — ✅
  (Entries 44, 45) durable per-holder control queue; endings drain AFTER that document's content
  (the reverse of amendments, because the inbound path refuses envelopes on an ended document
  TERMINALLY and a rejection counts as an ack — control-first would settle queued content unsent);
  settled by real evidence where it exists, retired-not-acked where it does not. 11 review findings
  fixed, incl. legacy documents getting no durability at all and a proven double-send.
  **DEVIATION FROM THIS LINE, taken deliberately:** it said "drain them ahead of content"; endings
  drain after, for the reason above. -->
- ~~**DOD-MP-ENDED-BACKLOG-1**~~ — **STRUCK by SYNC-P4** (spec §15): its subject is deleted with the delivery/control machinery; the reconcile exchange carries the guarantee now.
<!-- struck: **DOD-MP-ENDED-BACKLOG-1** [cello-client] — **does ending a document flush its queued content, or
  abandon it?** Two queries disagree today, and one of them is silent about it. Found by review
  2026-08-13 and PROVEN there: `pendingDeliveries` (the bilateral query) carries an ended-document
  guard whose comment states the rule — *"An ENDED document does not deliver. A killed or closed
  document that kept shipping would contradict the verb the operator just used."* Its per-holder
  twin `pendingHolderDeliveries`, and `backfillBilateralDeliveries`, carry no such guard. So a
  KILLED document goes on shipping its backlog, **and because `cello_doc_list` reads the filtered
  query, the operator's surface reports zero pending while the worker ships.**
  The two readings are both defensible and they point opposite ways: *close* plausibly means "send
  what I already wrote, then end it" (which is also why endings drain after content), while *kill*
  means "stop now" and shipping more contradicts the verb. Splitting them by verb is likely right
  and is exactly the kind of choice that should not be made silently at 3am. **Andre's call.**
  `[pre-existing]` — not introduced by CONTROL-DURABLE-1, but directly under it. — ❌ NOT BUILT -->
- ~~**DOD-MP-AMEND-CONFIRM-1**~~ — **STRUCK by SYNC-P4** (spec §15): its subject is deleted with the delivery/control machinery; the reconcile exchange carries the guarantee now.
<!-- struck: **DOD-MP-AMEND-CONFIRM-1** [cello-client] — **a holder that fell behind must converge, and get
  the edits it missed.** Split out of INVITE-FANOUT-1's clause 7 (Entry 40) once the durability half
  landed. Two halves, and the second is the one that is easy to miss:
  (a) **The sender never learns a holder is behind.** A non-terminal refusal deliberately sends NO
  ack — `document-frame-router.ts` answers only when `terminal === true`, because "there the retry
  IS the recovery path" — so `document_epoch_ahead` never reaches the sender and there is no hook to
  react to. The amendment branch has no ack path at all, so a receiver that REFUSES an amendment
  (`recordAmendment` throws on a chain gap or a failed derivation) reports nothing either.
  (b) **A holder who is behind loses edits that will never be resent.** Quoted from the review: a
  holder unreachable beyond the unacked-send window (5 sends × the 600s ack timeout, ~50 minutes) is
  ABANDONED for that envelope permanently. Membership converges when the amendment retry lands; the
  content does not. So reconciliation is not only "re-send the amendment" — it must re-drive the
  abandoned envelopes too.
  Today's partial cover: amendment rows settle by PROOF BY EPOCH (a holder acking an envelope at
  epoch E demonstrably holds every amendment up to E) and otherwise re-send on the ack timeout. That
  closes the common case without a wire change; it does not close (b). — ❌ NOT BUILT -->
- **DOD-MP-DELIVERY-QUIET-1** [cello-client] — **a document delivery must not ring the operator's
  doorbell like a person asking to talk.** Observed live 2026-08-13 (Entry 37): a delivery session is
  one-shot — it is sealed after handing the frame over — so every subsequent fan-out opens a fresh
  session, and each one surfaces `"<agent>" wants to connect … Run cello_await_session to accept`.
  Three fired during one short test, including between two of the operator's OWN agents. Nothing is
  waiting and there is nothing to accept; the standing receiver has already handled it. LOWEST
  SEVERITY ON THIS BOARD — no data is lost and no edit is delayed. It earns a line only because the
  cost is asymmetric: an operator who learns these are noise will also swipe past the one that is a
  real person opening a real conversation. The fix is to distinguish a delivery-opened session from a
  conversation request at the notice surface, not to suppress notices.
  **TRACED 2026-08-13, and it is NOT a one-liner — parked for Andre.** At the moment the notice
  fires, the receiver cannot tell the two apart: `daemon.ts` dispatches `session_state_changed`
  `created` straight off the inbound assignment, and that assignment carries NO purpose — the
  distinguishing signal (a document frame versus a message) arrives only with the FIRST FRAME,
  afterwards. So the two available fixes are both design decisions on the path real conversations
  share: (a) carry a purpose hint on the session assignment — a wire change, and both sides must
  agree; or (b) hold the notice until the first frame names the purpose — which risks delaying, or
  losing, the notice for a real person. Guessing here trades cosmetic noise for a suppressed
  connect request, which is strictly worse than the noise. — ❌ NOT BUILT (parked)
- **DOD-MP-REMOVE-FEEDBACK-1** [cello-client] — the FEEDBACK half of D9: a holder whose edit is
  refused after removal learns, in a sentence they can act on, that they were removed, at which
  epoch, that their copy and its history remain theirs, and that new edits no longer publish. The
  refusal reason exists; what is owed is that every surface carrying it says the whole thing —
  the write refusal, the list row, and the skill prose — and that none of them imply the copy was
  taken away (FORWARD-ONLY-REMOVAL). Documented, not merely logged. — ✅ (Entry 46) the row's
  existing `removed: true` COMPLETED — epoch carried from the same walk, sentence added,
  `yourStanding` always present (`unknown` on an unreadable chain, because an absent key reads as
  "you are fine"); skill covers the removed holder's own view and the field table names the keys.
  **My premise was refuted by review:** the flag already shipped, and my first cut added a second
  name for it computed by a second walk — the thing `walkMembership`'s header forbids. Named
  `yourStanding`, not `yourAccess`: access to the copy never changed.
- **DOD-MP-GOVERN-WIRE-1** [cello-client] — **ADMIN PROMOTION AND DEMOTION NEED A WIRE THAT DOES
  NOT EXIST.** Ruled by Andre 2026-08-13: no longer "parked as out of scope" — it is owed work on
  THIS milestone's board and it enters launch triage. The replay engine already implements
  `promote_admin` and `remove_admin`; what is missing is the transport for a HALF-SIGNED action.
  `remove_admin` requires every other admin's signature, gathered across different machines, and no
  frame carries a partially-signed amendment between daemons. Needs designing, not just coding: a
  pending-governance inbox, a co-sign verb, expiry for a proposal nobody finishes signing, and —
  once fan-out exists — delivering a half-signed amendment to a specific admin is just another
  per-holder delivery. **Launch-triage question to answer first:** at launch, is an operator who
  cannot demote a co-admin *ruined* or *inconvenienced*? Until it ships, `cello_doc_remove`'s
  guidance says "demote first" about a verb that does not exist — the one operator-visible edge,
  and it must be reworded even if the feature waits. — ❌ NOT BUILT
- **DOD-MP-SHIP-1** [cello-client, trustless-cello] — the publish cascade via `/cello-publish`
  (skill loaded, per publish), trustless-cello re-pinned, plugin skills updated for the
  multiplayer verbs and audited as SHIPPING content (tarball/clone, not source), and a **live
  smoke on the real fleet**: three real daemons, create → join → edit → fan out → converge →
  remove → seal. Andre runs the `latest` promotion — never this session. — 🟠 PARTIAL, 2026-08-16.
  **BETA IS PUBLISHED AND VERIFIED AGAINST THE BINARY** (tag `v0.0.243`, run 31936756187: Build,
  Publish, and the published-artifact smoke test all green). All seven bumped so the cross-pins
  point at one tree: crypto 0.0.51 · protocol-types 0.0.55 · transport 0.0.57 · gateway 0.0.35 ·
  daemon 0.0.169 · cli 0.0.176 · connect 0.0.149. Verified by unpacking the tarballs, not by
  reading CI: the daemon's `dist/` carries `ReconcileScheduler`, the R32 refusal reason,
  `dropLegacyColumns` and `document_party_view`, and carries NO `document_control_deliveries` and
  no `markAcked`; the only surviving `delivered_at`/`next_attempt_at` strings are inside the DROP
  list that removes them. Cross-pins are real versions on both installed-by-name packages
  (cli→daemon 0.0.169, connect→crypto 0.0.51/transport 0.0.57) — no `workspace:*`. The shipped
  plugin skills carry no retired surface name (`pendingContent`, `pendingAmendments`, `epochId`,
  `removedAtEpoch`, `cello_doc_withdraw`) and no "demote first" prose.
  **OWED, IN ORDER:** (1) Andre promotes all seven to `latest` — operator-run, never this session;
  (2) `pnpm install` in trustless-cello to refresh the lockfile onto the promoted versions;
  (3) the live fleet smoke on the real agents.

---

## Tier SYNC — the reconcile pivot ([[M14B-RECONCILE-SPEC]] v2 §14; supersedes further work in the tiers above)

- **DOD-SYNC-P0** [docs] — answer `SYNC-G2`: concurrent authors converge identically and every
  conflicting governance act has a stated rule. — ✅ PASSES with four specifications P1 must carry
  (linearization; fold rules incl. removal-dominance; property LWW; `(seq, headHash)` positions
  for equivocation detection) → Entry 48
- **DOD-SYNC-P1** [cello-client] — entries gain causal parents; position becomes a per-author
  watermark; derivation by causality with the R6 tie-break + Entry 48's fold rules; governance
  moves onto it. Endings and consent ride the existing amendment carrier until P4 — no third
  interim carrier. — ✅ merged `4ac91a9`; reviewed (4 blocking findings fixed, incl. the
  re-admission-breaking concurrency rule); linear replay deleted → Entry 51
- **DOD-SYNC-P2** [cello-client] — one consent handshake (`R21`–`R25`); delete `D5`. — ✅ merged
  `3780817`; consent/refusal are the subject's own signed entries, participation = admitted ∧
  consented, every seat delivered to and consulted by endings; reviewed, 6 findings fixed (the
  invited-window class). D5's PHYSICAL deletion rides P3 (Entry 51 Decision Carried) → Entry 54
- **DOD-SYNC-P3** [cello-client] — the exchange (`R10`–`R16`), entitlement (`R17`–`R20`),
  refusals (`R35`–`R38`), forwarding (`R1`–`R2`). — ✅ merged `e616b0f`; one frame/three
  steps/terminated-by-silence, forwarding + join-via-exchange + invitation lifecycle proven in
  process; reviewed, blocking findings fixed (removed-holder closure delivery, verified
  bootstrap, byte budget, per-block refusals). D5 physical deletion + refusal-as-entry ride
  P4's sweep → Entry 57
- **DOD-SYNC-P4** [cello-client] — answer `SYNC-G1` (does causal ancestry replace every use of
  the per-envelope `epoch_id`?), then delete `D1`–`D4`, `D6`–`D10`, proven by removal (`R49`);
  strike the seven §15 lines above. — ✅ merged `b332225`; SYNC-G1 answered (Entry 58:
  replace-then-delete — `governance_parents` in the signed TBS, then the stamp out of both
  preimages, domains → v3, frozen vectors reissued); endings + refusals are signed entries;
  publish nudges via the exchange; one derivation each for membership and endings; ~11,500
  lines deleted with absence proven on rebuilt artifacts; the seven §15 lines struck; reviewed
  (cello-unit-reviewer), all blocking findings fixed and pinned (R30 status-gate fall-through,
  two-way ended projection + fold-ruled canPublish, frontier reason logging, governance_parents
  decoder refusal tests). CARRIED CAVEAT (reviewer, R49): trustless-cello's spine test
  `j-multiplayer.spine.test.ts` still speaks the old surface via the PUBLISHED client — green
  vacuously today, red the day this client publishes; its re-point is P6's named job and P6
  must land before or with the publish.
- **DOD-SYNC-P5** [cello-client] — scheduling (`R39`–`R43`) and the surface (`R45`–`R48`). — ✅
  built `17e6a85`, review fixes `6ce2f02` (both on main): reachable trigger BOTH sides
  (inbound state-dispatch + a new onSessionOpened seam on the initiator), bounded periodic
  sweep (volatile state, believed-current suppression, 30s→15min backoff, 60s in-flight bound
  released loudly, 32-doc batching, time-stamped force-released pass guard), quiescence pinned
  (ended/underivable docs contribute no targets); cello_doc_list is the R45/R46 shape from a
  per-party display cache (in_sync|behind|unseen + blockedBy), R47 fields gone, R48 named
  `underivable`; a refused origination surfaces as state "refused" WITH the peer's reason
  (review F1 — the record was written and read by nothing). CAVEAT carried to P6: the live
  cross-process sweep liveness proof is the three-daemon enforcers' job.
- **DOD-SYNC-P6** [trustless-cello] — enforcers re-pointed at `SYNC-AC1`–`AC20`, three daemons as
  separate OS processes. — ✅ `e1d04b7b` + cello-client `7032ff3`. Seven journeys, three real
  daemons in three OS processes against a three-node consortium and a real relay, 14–18s each.
  Reviewed (cello-unit-reviewer); every blocking finding fixed, and the two that mattered changed
  what the milestone CLAIMS, not just how it is tested — see the coverage split below, which is
  part of this tag and not a footnote to it.

  **What the live gate proves** (`j-multiplayer.spine.test.ts`): AC1 (three-way convergence, one
  author at a time), AC4's settlement rule (a close settles only when every current seat has
  spoken — sequential, not partitioned), AC5 (an entry commits and reaches a reachable holder
  before any sweep could have fired — the elapsed time is now asserted against the interval, so
  the premise cannot evaporate on a slow machine), AC6, AC10 (join with existing history through
  the ordinary exchange), AC13 (both directions: a holder removed while offline, and one removed
  while present), AC17 (the built artifact speaks no relay vocabulary), AC20 (behind WITH a
  last-seen time, and no pending count offered — R47).

  **What only in-process tests prove** (cello-client; each named here so the claim is checkable by
  grep, not by trust): AC2 forwarding — the responder serves any AUTHOR's chain with no notion of
  who sent it (`document-reconcile-engine.test.ts`); AC3 no sender ledger — the document schema is
  enumerated and every table and column checked against a delivery-debt denylist
  (`document-store.test.ts`); AC9 idempotence — a peer at our exact position gets nothing back;
  AC12 refusal does not wedge; AC14 removed-author history; AC15 stranger refused; AC16
  post-ending forgery refused; AC18 quiescence — an ended document contributes no sweep targets;
  AC19 version refusal — added during this review, the gate had no test at all. AC15/AC16 are
  in-process BY NATURE: both require a rewritten daemon, and stock binaries cannot stage one.

  **Named gaps — not claimed, owed if they matter** (each is a live-coverage gap only; all have
  in-process proof):
  - **R32's terminal-refusal delivery is not exercised BY THE ENFORCERS** (it IS reached in
    production — amended 2026-08-16, Entry 60: the fleet log carries `document_reconcile_removed`
    four times, and the removed holder's own daemon logging `refused_by_peer` with that reason).
    The enforcer's returning holder takes delivery of the removal as an ordinary parked frame
    recovered from the relay before its first exchange, so it never reaches the refusal; a holder
    that stays UP and keeps exchanging does. The gap is the enforcer's, not the protocol's.
  - **AC2's permanent kill** (A killed for good, B and C carry the history between them) is not
    staged live; only the per-author mechanism is proven in process.
  - **AC8 relay-loss mid-exchange** and **AC11's stranded joiner** (the admitting admin goes
    offline before the third party learns) have no enforcer on either side.
  - **AC1's concurrent-divergence half** (all three editing while mutually unreachable) and
    **AC4's partition half** (two closes authored on opposite sides of a partition) are proven by
    the fold in process, not live; the live journeys move one author at a time.
  - **AC7's mid-exchange restart** — the live restarts are between exchanges, not during one.
  - **The receiver-side `document_sender_removed` gate** is unreachable end to end with honest
    binaries: a removed holder always learns before it can publish, so its own daemon refuses
    first. It defends against a rewritten client; unit coverage is `document-inbound.test.ts`.

- **~~DOD-SYNC-LAST-EDIT-2PARTY-1~~ — WITHDRAWN 2026-08-16, disproven by probe.** It claimed a
  removed holder's last edit is lost forever when only two parties remain. Four isolated probes
  (cello-client `removed-holder-last-edit.probe.test.ts`) say otherwise: the edit reaches the
  remover on the REMOVED HOLDER'S OWN initiative, and still reaches it when that holder already
  knows it was removed. The mechanism was in the arriving-frame handler all along, under the
  comment `APPLY FIRST`: a receiver applies what a frame CARRIES before ruling on whether to
  answer its sender. The terminal refusal stops the remover SERVING a removed party; it never
  stopped that party's work landing. The three-party forward credited with rescuing the live run
  was not load-bearing either — the remover already holds the edit before any forwarding happens.
  Left on the board struck through rather than deleted: the claim was published, and a reader who
  saw it deserves to find the retraction in the same place.
- **DOD-SYNC-EXCHANGE-NO-FANOUT-1** [cello-client] — **a holder that takes content from an
  exchange does not pass it on.** — ❌ CONFIRMED by probe (probe 3), 2026-08-16. Publishing nudges
  the other seats; TAKING content through the exchange nudges nobody and sends not one frame, so a
  third holder waits for a sweep to happen by. Measured directly: after admitting a peer's
  envelope the holder made zero nudge calls and sent zero frames to the seat that now lags. It is
  invisible in normal use because the sweep covers it eventually, and it is the most plausible
  cause of the five-and-a-half-minute wait on the fleet — **not proven to be, and not claimed.**
  Proposed fix: at the admit site in the arriving-frame handler, nudge the seats OTHER than the
  sender, reusing the publish path's own nudge. Cheap, and the exchange already terminates by
  silence, so a nudge that finds no difference costs one frame. The probe asserts today's
  behaviour and says in the test that it flips when this lands, so the fix cannot arrive quietly.
- **DOD-SYNC-FILE-REWRITE-NOISE-1** [cello-client] — the exchange's file rewrite logs
  `ENOENT … rename '<doc>.md.tmp'`, 14 times in one live run. — ❌ **Mechanism confirmed by
  reading both ends, 2026-08-16.** The temp path is a FIXED name per document
  (`document-write-path.ts`: ``const tmp = `${path}.tmp` ``) and the apply loop fires rewrites
  **without awaiting** (`void rewriteFileImpl(...)` per admitted envelope), so two rewrites of one
  document race: the first renames the shared temp away and the second's rename finds nothing.
  **No user-visible harm** — each rewrite renders the WHOLE document, so the winner's file is
  correct, and all three holders' files were verified correct and matching. It is a real error
  line for a non-error, which is how a genuine failure gets ignored later. Proposed fix: a unique
  temp suffix per write (last writer wins, which is already the intent), rather than serializing —
  the work is idempotent and cheap.
- **DOD-SYNC-LEGACY-DOCS-1** [cello-client] — **documents created before this release are
  permanently unverifiable, and they loop.** — ❌ Entry 60. The pivot moved the epoch stamp out of
  both signed preimages and bumped the domains to v3, so entries signed under the old preimage
  fail verification on this build: `document.inbound.signature_invalid` fires on every exchange
  (39 times in one live run across two documents), the affected documents surface as
  `yourStanding: "unknown"` or — worse — as `invited` for a holder who actually accepted long ago,
  because the consent entry that seated them cannot be verified. Nothing quarantines them, so each
  legacy document is a permanent error loop. With no users this is test data on one machine; the
  decision owed is whether old documents are migrated, quarantined with a named reason, or dropped
  at upgrade. Silently looping is the one option that is not acceptable.
- **DOD-SYNC-FIRSTFRAME-1** [cello-client] — **after a restart, an edit made across the old
  session never arrives, and the sender is told it published.** — ❌ **REPRODUCED ON DEMAND
  2026-08-16** in a controlled rig: `packages/e2e-tests/src/spine/j-stale-session.spine.test.ts`,
  two real daemons, real consortium, real relay. Sequence: A and B share a document and it works;
  B's daemon restarts (asserted properly back — `agent.online` and `session.node.created` both
  waited for, so "the daemon never came up" is excluded); A then writes.

  **Measured, with the sides attributed:** A's write returns `published: true`. A puts 4 frames on
  the wire and **2 of them park**. A initiates 3 reconciles and **1 sweep attempt fails**. B, after
  its restart, receives **1 frame** and performs **0** inbound document operations. B never
  converges — five minutes, past two production sweep ticks.

  So the failure is not one lost frame. The sender believes it published, the frames park, the
  returning peer pulls almost nothing and processes none of it, and the sweep that exists to
  repair exactly this also fails. The live-fleet symptom (an invitation that took about four
  minutes, recovering only when a fresh session was built) is the same shape.

  This is the ONLY open defect from the 2026-08-16 investigation. Everything else raised that day
  was withdrawn: the removal path works (probes), the nudge asymmetry is spec-conformant (R39/R40),
  the file-rename error is harmless noise, and legacy documents are ruled out of scope — alpha, no
  users, only legacy tests.
- **~~DOD-SYNC-LAST-EDIT-2PARTY-1~~ — WITHDRAWN 2026-08-16, disproven by probe.** It claimed a
  removed holder's last edit is lost forever when only two parties remain. Four isolated probes
  (cello-client `removed-holder-last-edit.probe.test.ts`) say otherwise: the edit reaches the
  remover on the REMOVED HOLDER'S OWN initiative, and still reaches it when that holder already
  knows it was removed. The mechanism was in the arriving-frame handler all along, under the
  comment `APPLY FIRST`: a receiver applies what a frame CARRIES before ruling on whether to
  answer its sender. The terminal refusal stops the remover SERVING a removed party; it never
  stopped that party's work landing. The three-party forward credited with rescuing the live run
  was not load-bearing either — the remover already holds the edit before any forwarding happens.
  Left on the board struck through rather than deleted: the claim was published, and a reader who
  saw it deserves to find the retraction in the same place.
- **DOD-SYNC-EXCHANGE-NO-FANOUT-1** [cello-client] — **a holder that takes content from an
  exchange does not pass it on.** — ❌ CONFIRMED by probe (probe 3), 2026-08-16. Publishing nudges
  the other seats; TAKING content through the exchange nudges nobody and sends not one frame, so a
  third holder waits for a sweep to happen by. Measured directly: after admitting a peer's
  envelope the holder made zero nudge calls and sent zero frames to the seat that now lags. It is
  invisible in normal use because the sweep covers it eventually, and it is the most plausible
  cause of the five-and-a-half-minute wait on the fleet — **not proven to be, and not claimed.**
  Proposed fix: at the admit site in the arriving-frame handler, nudge the seats OTHER than the
  sender, reusing the publish path's own nudge. Cheap, and the exchange already terminates by
  silence, so a nudge that finds no difference costs one frame. The probe asserts today's
  behaviour and says in the test that it flips when this lands, so the fix cannot arrive quietly.
- **DOD-SYNC-FILE-REWRITE-NOISE-1** [cello-client] — the exchange's file rewrite logs
  `ENOENT … rename '<doc>.md.tmp'`, 14 times in one live run. — ❌ **Mechanism confirmed by
  reading both ends, 2026-08-16.** The temp path is a FIXED name per document
  (`document-write-path.ts`: ``const tmp = `${path}.tmp` ``) and the apply loop fires rewrites
  **without awaiting** (`void rewriteFileImpl(...)` per admitted envelope), so two rewrites of one
  document race: the first renames the shared temp away and the second's rename finds nothing.
  **No user-visible harm** — each rewrite renders the WHOLE document, so the winner's file is
  correct, and all three holders' files were verified correct and matching. It is a real error
  line for a non-error, which is how a genuine failure gets ignored later. Proposed fix: a unique
  temp suffix per write (last writer wins, which is already the intent), rather than serializing —
  the work is idempotent and cheap.
- **DOD-SYNC-LEGACY-DOCS-1** [cello-client] — **documents created before this release are
  permanently unverifiable, and they loop.** — ❌ Entry 60. The pivot moved the epoch stamp out of
  both signed preimages and bumped the domains to v3, so entries signed under the old preimage
  fail verification on this build: `document.inbound.signature_invalid` fires on every exchange
  (39 times in one live run across two documents), the affected documents surface as
  `yourStanding: "unknown"` or — worse — as `invited` for a holder who actually accepted long ago,
  because the consent entry that seated them cannot be verified. Nothing quarantines them, so each
  legacy document is a permanent error loop. With no users this is test data on one machine; the
  decision owed is whether old documents are migrated, quarantined with a named reason, or dropped
  at upgrade. Silently looping is the one option that is not acceptable.
- **DOD-SYNC-FIRSTFRAME-1** [cello-client] — **the first frame after a session opens can be lost
  with NOBODY told.** — ❌ Promoted to a board line here because it has now cost three separate
  debugging sessions and it lives on a production path, not a test one. The shape: a frame sent
  immediately after `cello_initiate_session` returns is sometimes discarded by the receiving side;
  the sender's send reports success, no error is raised anywhere, and the frame is simply gone.
  Every enforcer that carries an ordinary message first has been reliable, which is why the
  workaround is written into the live harness — but a workaround in a test fixture is not a fix,
  and outside the tests nothing sends a warm-up message. For documents the pivot's own model
  repairs it (the next exchange recomputes the difference, so the cost is one sweep interval of
  latency), which is exactly why it keeps getting waved past. For an ordinary first message
  between two agents there is no such repair: the counterparty never sees it and neither side is
  told. Same shape as the two "send reports success, peer discards" defects this milestone already
  paid for. Needs a producer/consumer trace across session establishment — which side discards,
  and what precondition is not yet true when it does — not another retry.

- **DOD-SYNC-REFUSAL-BACKOFF-1** [cello-client] — **the sweep asks forever, and it took basic
  messaging down with it.** — ✅ FIXED 2026-08-17, cello-client branch `m12b/reconcile-removed-holder`
  (`0650181`, `b1322c2`); full gate green; verified live (0 refusals after the fix, against 321
  before).

  **Two defects, both in this tier's code.**
  1. `sweepTargets` derived its targets from the OTHER seats on a document and never asked whether
     the OWNER still held one. A holder whose standing is `removed` kept sweeping the document it
     was removed from — measured **105 refusals against one document in 85 minutes**, every one
     flagged `terminal: true` with the words *"there is nothing further to reconcile"*, every one
     asked again.
  2. The scheduler could only observe whether the FRAME WAS SENT. A refusal arrives later on its own
     inbound frame, where it was logged and dropped, so `allOk` stayed true, `failures` reset to 0,
     `nextAttemptMs` was set to now, and the next sweep asked immediately. A second document,
     refused as a non-party (deliberately non-terminal), was retried **79 times** at a fixed
     interval with no ceiling. The layer's own comment already said the refusal was *"a fact to
     surface, never to retry blindly"* — nothing downstream could act on it.

  **Why a document defect is on the messaging critical path.** Document frames take a position in
  the CONVERSATION's sequence space — correctly, and deliberately (`f75ea09`, 2026-08-05: a
  document sender that skipped its leaf starved its own inbound). So a sweep that never stops
  spends the conversation's numbers. Measured in one session: **3 real messages, 41 document ack
  frames, 43 canonical positions consumed** — ~14 positions burned per message actually sent. The
  receiving tree cannot keep pace, the strict-in-order gate holds everything past the gap, and
  **367 pieces of verified content were held against 8 released and 24 destroyed** on one daemon
  in one morning. Full chain: [[M12B-BUILD-JOURNAL]] Entry 5.

  **Second-order damage, same root.** Every sweep attempt opens a session; every accepted session
  consumes the pre-warmed standing receiver and mints a replacement. **53 sessions and 63 receiver
  builds in 2.5 hours** — the factory working exactly as designed, driven far past its intended
  rate. And every session the worker opened failed to seal: **25 opened, 25
  `session.seal.blocked_incomplete`**, because a chain with held content cannot be co-signed. Those
  sessions never close and accumulate.

  **R41 is preserved.** A terminal refusal is NOT retired — it goes to the 15-minute cap. "Terminal"
  is one holder's current derivation and a later entry can make the same exchange admissible again,
  so scheduling state still only ever DELAYS an exchange. `onReachable` clears it outright.

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
- **D9 — a refused post-removal edit stays a LOG LINE PLUS A REFUSAL ACK; no durable rejection
  row.** Ruled by Andre 2026-08-13 (option A). Provable-refusal is a Tier 2 attestation concern,
  not a launch one. **But it must be DOCUMENTED and it must have affordances** — the removed
  holder's own agent has to be told, in words, what happened and what is still theirs. Silence
  here reads as a bug on their screen. See `DOD-MP-REMOVE-FEEDBACK-1`.
- **Guards carried from the multiplayer log §11 — do not re-litigate:** floor control is not
  needed (a CRDT op is a spreadsheet cell, not an utterance); ~~relaying is not the answer to
  delivery (every holder authors and delivers its own updates — no relay tier)~~ **SUPERSEDED
  2026-08-14 by Andre's forwarding ruling** (`SYNC-R1`/`R2`: holders forward each other's signed
  entries; forwarding confers no trust — the receiver verifies signature and entitlement itself);
  arrays stay
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
- **ADMIN PROMOTION AND ADMIN REMOVAL — NO LONGER PARKED (reversed by Andre 2026-08-13).** It was
  parked as out-of-scope earlier the same day; Andre ruled instead that it is **owed work with a
  line on this board and a place in launch triage** — see `DOD-MP-GOVERN-WIRE-1`. The reason it
  cannot simply be coded stands: `remove_admin` needs signatures gathered from every other admin
  across different machines, and no frame carries a half-signed amendment between daemons. That
  is a design job, not a coding job.
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
