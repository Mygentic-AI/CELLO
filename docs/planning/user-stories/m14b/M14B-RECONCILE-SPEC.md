---
name: M14B Reconcile Spec
type: spec
date: 2026-08-14
milestone: M14B
status: open
topics: [documents, collaborative-state, reconcile, sync, amendment-chain, crdt, spec, m14b]
description: >
  Executable specification for the document protocol's delivery half: replace push-and-track
  delivery with comparison-based reconciling. Normative requirements, wire shapes, derivations,
  surface contract, explicit deletion list, acceptance criteria, and phases in dependency order.
  Rationale lives in the 2026-08-14 discussion log; this document is what gets built.
---

# M14B — Reconcile Spec

**Rationale is NOT in this document.** See
[[2026-08-14_1155_document-protocol-reconcile-not-deliver]]. This is the build.

`MUST` / `MUST NOT` / `MAY` are normative. Requirements are `SYNC-R#`, acceptance criteria
`SYNC-AC#`. Both are citable from DoD lines.

---

## 0. GATE — settle before any code

**SYNC-G1.** Determine whether the per-envelope `epoch_id` stamp performs any security function.
Deliverable: a written finding citing every producer and consumer of that field, answering:
- Can a removed holder replay content authored while they were a member, and is refusing it correct?
- Does any trust claim read that field as evidence?

**No phase below starts until SYNC-G1 is answered.** If the stamp IS load-bearing, §3's ordering
rule stands but §6's deletion list shrinks, and this spec is revised before use.

---

## 1. Scope

**In scope:** how a document's state reaches the other holders; the consent handshake; how a
document ends; the delivery surface.

**Out of scope, unchanged:** Yjs merge semantics; signature and multi-signature verification;
governance policy (who may invite/remove/administer); injection screening; sessions, relay, and
sealed receipts.

---

## 2. Model

**SYNC-R1.** A document is exactly two things: a **chain** (ordered, signed, append-only) and
**content** (a Yjs document).

**SYNC-R2.** Every governance fact is a chain entry. There are no governance frames outside the
chain. Specifically: creation, admission of a holder, removal of a holder, property changes, and
endings are all entries.

**SYNC-R3.** The daemon MUST NOT store per-recipient delivery state for content or for chain
entries. No queue, no attempt counter, no send counter, no acknowledgement row, no abandonment
marker.

**SYNC-R4.** Whether another holder has a given change MUST be answered by comparison at the moment
the question is asked, never by a stored record.

---

## 3. The exchange

**SYNC-R5.** Reconciling is a single exchange between two holders of one document:

| # | Direction | Carries |
|---|---|---|
| 1 | A → B | `documentId`, A's highest **contiguous** chain epoch, A's content state vector |
| 2 | B → A | chain entries A lacks, content diff A lacks, B's chain epoch, B's content state vector |
| 3 | A → B | chain entries B lacks, content diff B lacks — **sent only if B is behind** |

**SYNC-R6.** Within one exchange the receiver MUST apply chain entries **before** content. This is
the only ordering rule in the protocol.

**SYNC-R7.** Chain entries MUST be applied in epoch order and contiguously. A receiver holding a gap
MUST request from its highest contiguous epoch, never from its highest received.

**SYNC-R8.** Reconciling MUST be idempotent. Running it twice MUST produce the same state as running
it once, and MUST NOT error.

**SYNC-R9.** A responder MUST derive the participant set from **its own** chain and MUST refuse to
answer a requester that is not a current participant. Refusal names the reason.

**SYNC-R10.** Content received MUST be admitted only if its author is a participant per the chain
the receiver holds **after** step SYNC-R6.

### Triggers

**SYNC-R11.** Reconciling MUST be attempted: on committing a local change (to reachable holders);
when a holder becomes reachable; and on a periodic sweep.

**SYNC-R12.** No trigger may be required for correctness. Losing any nudge MUST NOT leave holders
permanently divergent — the next successful exchange MUST close the gap.

**SYNC-R13.** At most one exchange per (document, holder) MAY be in flight. A second MUST be
skipped, not queued.

---

## 4. Consent — one handshake

**SYNC-R14.** Creating a document and admitting a holder are the same act: an entry in the chain
naming the subject, plus that subject's own consent.

**SYNC-R15.** Consent MUST be the subject's own signed answer, recorded as a chain entry. An
admitting entry alone MUST NOT make anyone a participant.

**SYNC-R16.** A subject deciding whether to consent MUST receive the chain and content by the
exchange in §3 — not by a bespoke offer carrying history.

**SYNC-R17.** A subject MAY refuse. A refusal is a chain entry; the subject is not a participant and
MUST NOT be reconciled with.

---

## 5. Ending

**SYNC-R18.** `close` and `kill` are chain entries authored like any other.

**SYNC-R19.** A document is **closed** when every current participant has a `close` entry in the
chain. This is derived, never tracked.

**SYNC-R20.** A document is **killed** when any admin has a `kill` entry in the chain. Immediate,
one-sided.

**SYNC-R21.** Once a document is ended, a holder MUST NOT author new content.

**SYNC-R22.** Reconciling MUST continue after a document has ended, until all holders converge. This
settles the flush-or-abandon question: content authored **before** the ending reaches everyone;
content **after** it cannot exist.

---

## 6. Removal

**SYNC-R23.** A removed holder MUST NOT be reconciled with, in either direction, from the epoch of
their removal.

**SYNC-R24.** Removal MUST NOT reach a removed holder's copy. Their chain and content remain theirs.

**SYNC-R25.** Removal MUST take effect by derivation only. No code may exist whose job is to stop
in-flight delivery to a removed holder, because there is none.

---

## 7. What is stored, what is derived

**Stored (authoritative):** the chain; the content; the local file mirror.

**Stored (display cache, non-authoritative, MAY be wrong or absent):** per holder — last successful
exchange time, their last known chain epoch.

**SYNC-R26.** No decision affecting correctness may read the display cache.

**Derived, never stored:** participants; admins; properties; ended state; whether a holder is in
sync; a holder's own standing.

---

## 8. Surface contract

**SYNC-R27.** `cello_doc_list` returns, per document: `documentId`, `documentType`, `participants`,
`admins`, `properties`, `epoch`, `ended` (`null` | `"closed"` | `"killed"`), `yourStanding`
(`"holder"` | `"removed"` | `"unknown"`), and `holders[]`.

**SYNC-R28.** Each `holders[]` entry is `{ agentId, consent, sync, lastSyncedAtMs, theirEpoch }`
where `consent` ∈ `pending | accepted | refused` and `sync` ∈ `in_sync | behind | unseen`.

**SYNC-R29.** These fields are REMOVED: `pendingDeliveries`, `pendingSent`, `pendingUnsent`,
`abandonedDeliveries`, `closePending`, `peerAccepted`, `peerHasPublished`, `proposalSent`,
`holdersNotified`, `holderFailures`.

**SYNC-R30.** Where the daemon cannot compute a derived field it MUST say so explicitly. An absent
key MUST NOT be the way a failure is expressed.

---

## 9. Deletions

To be removed, not deprecated:

**SYNC-D1.** The per-recipient delivery ledger for content, and its worker pass.
**SYNC-D2.** The amendment delivery queue and its worker pass.
**SYNC-D3.** The control-frame delivery queue and its worker pass.
**SYNC-D4.** The session-suspicion mechanism, and the document layer's handling of `session_sealed`,
`relay_session_gone`, `parked` and `witnessed`. The document layer MUST NOT reference relay
vocabulary.
**SYNC-D5.** Content acknowledgement frames and every substitute built for the paths lacking one:
proof-by-epoch settlement, retired-versus-acknowledged, send ceilings, unconfirmed reporting.
**SYNC-D6.** The second consent handshake: join offers carrying history, and the proposal/accept/
refuse/answer path distinct from it.
**SYNC-D7.** The control-frame signing and fan-out path, and close-settlement bookkeeping.
**SYNC-D8.** Duplicate derivations of participant set and of own-standing. Exactly one of each.
**SYNC-D9.** Withdrawal of an undelivered update (there is no queue to withdraw from).
**SYNC-D10.** Delivery session hints.

**SYNC-R31.** Each deletion MUST be proven by removal — deleted, then both repos' gates run green,
and absence asserted on the **built artifact**, not on source.

---

## 10. Acceptance criteria

Verified by the three-daemon spine enforcers (A, B, C as separate OS processes).

**SYNC-AC1 — convergence.** A, B, C hold a document; each edits while the others are unreachable;
after all become reachable, all three converge to identical content with no operator action.

**SYNC-AC2 — no ledger.** After AC1, no table in any daemon holds per-recipient delivery rows.
Asserted by schema inspection.

**SYNC-AC3 — restart.** Kill B mid-exchange and restart it. B converges without any prior state
being remembered.

**SYNC-AC4 — relay loss.** Destroy the relay's session state mid-exchange. The next exchange
converges. No session is retired and none is marked dead.

**SYNC-AC5 — idempotence.** Run the exchange three times consecutively with no changes. Content and
chain are byte-identical after each, and nothing is re-applied.

**SYNC-AC6 — join.** C joins a document with existing history via the §3 exchange plus its own
consent. C converges to full content and chain. No bespoke offer frame exists.

**SYNC-AC7 — refusal.** C refuses. C is not a participant on any daemon, and no daemon reconciles
with C.

**SYNC-AC8 — removal is immediate.** A removes C. Without any code acting on in-flight work, A and B
stop reconciling with C at the next exchange, and C's subsequent edits reach nobody. C's own copy is
intact and readable.

**SYNC-AC9 — removal cannot be faked by the removed party.** C, running a modified daemon, requests
an exchange from B. B refuses, deriving from B's own chain.

**SYNC-AC10 — ending converges.** A closes with C unreachable. C returns and learns the document
ended, by the ordinary exchange. No control frame, no retry counter.

**SYNC-AC11 — ended flush.** Content authored before an ending reaches every holder after it. New
content authored after the ending is refused locally at authoring time.

**SYNC-AC12 — chain before content.** An edit authored after an admitting entry is applied by a
receiver that had neither, in one exchange, with no refusal and no retry.

**SYNC-AC13 — honest surface.** With B unreachable, A's list shows B `behind` with a last-seen time.
It MUST NOT show a count of pending items, and MUST NOT claim B is in sync.

**SYNC-AC14 — undecodable chain.** A document whose chain will not decode reports `unknown` standing
and a named reason on every surface, degrades only that document's row, and never throws to the
operator.

**SYNC-AC15 — no relay vocabulary.** Grep of the built document-layer artifact contains none of
`session_sealed`, `relay_session_gone`, `parked`, `witnessed`.

---

## 11. Phases

Dependency order. Each phase ends green on both repos' gates and is reviewed before the next starts.

**P0.** Answer SYNC-G1. No code.
**P1.** Chain absorbs endings (SYNC-R18–R22). Close settlement becomes a derivation.
**P2.** One consent handshake (SYNC-R14–R17). Delete SYNC-D6.
**P3.** The exchange (SYNC-R5–R13). Both directions, chain first, idempotent.
**P4.** Delete SYNC-D1–D5, D7–D10. Prove by removal (SYNC-R31).
**P5.** Surface contract (SYNC-R27–R30).
**P6.** Enforcers re-pointed at SYNC-AC1–AC15.

**Compatibility:** none owed. All holders upgrade together; essentially no documents exist. This
window closes the day a real workflow depends on a document.

---

## 12. Board impact

Superseded and to be struck once P4 lands: `DOD-MP-AMEND-CONFIRM-1`,
`DOD-MP-RELAY-GONE-DISAMBIG-1`, `DOD-MP-ZOMBIE-SESSION-1`, `DOD-MP-ENDED-BACKLOG-1`,
`DOD-MP-CONTROL-DURABLE-1`, `DOD-MP-INVITE-FANOUT-1`, `DOD-MP-SESSION-RETIRE-1`.

Retained: `DOD-MP-GOVERN-WIRE-1` (admin promotion/demotion still needs a way to carry a
partially-signed entry), `DOD-MP-E2E-GOVERN-1`, `DOD-MP-REMOVE-FEEDBACK-1`,
`DOD-MP-DELIVERY-QUIET-1` (an exchange has a purpose the opener knows — becomes trivial).
