---
name: M14B Reconcile Spec
type: spec
date: 2026-08-14
milestone: M14B
status: open
version: 2
topics: [documents, collaborative-state, reconcile, sync, causality, crdt, spec, m14b]
description: >
  Executable specification for the document protocol. One primitive — signed entries naming their
  causal parents, reconciled by comparing per-author watermarks — serves both governance and
  content. Replaces four delivery mechanisms, two consent handshakes, and the epoch-slot ordering.
  v2 supersedes v1 after adversarial review: v1 made the chain multi-writer with no ordering rule,
  assumed a content representation that does not exist, and omitted the refusal protocol.
  Rationale in the 2026-08-14 discussion log; this is what gets built.
---

# M14B — Reconcile Spec (v2)

**No rationale here.** See [[2026-08-14_1155_document-protocol-reconcile-not-deliver]].

`MUST` / `MUST NOT` / `MAY` are normative. Requirements `SYNC-R#`, acceptance criteria `SYNC-AC#`,
gates `SYNC-G#`.

**v2 supersedes v1.** v1's fatal errors, kept here so they are not re-introduced: it made the chain
multi-writer while identifying position by a single integer (concurrent honest acts diverged
permanently and invisibly); it assumed content was a Yjs document on the wire when it is per-author
signed envelopes; and it omitted refused content entirely, whose failure mode is already documented
in `document-rejection.ts`.

---

## 0. Standing ruling that this spec depends on

**Holders forward each other's signed entries.** Ruled by Andre, 2026-08-14. This **supersedes** the
prior guard that every holder delivers only its own updates.

**SYNC-R1.** Any holder MAY forward any entry it holds to any other party entitled to receive it.

**SYNC-R2.** Forwarding MUST confer no trust. The receiver verifies the author's signature and the
author's entitlement itself, from its own state. A forwarder cannot forge, alter, re-attribute, or
vouch for anything.

The superseded guard's *intent* — that no middleman may be trusted to speak for content — is
preserved by R2. Only the delivery monopoly is dropped, and it is dropped because without it three
holders cannot converge when an author goes offline.

---

## 1. The primitive

**SYNC-R3.** A document is a set of **entries**. Every entry is signed by its author and names the
hashes of the entries its author had already applied when authoring it (its **parents**).

**SYNC-R4.** There are two kinds of entry, and they differ only in what they mean:
- **governance** — creation, admission, consent, refusal-to-join, removal, property change, ending.
- **content** — a Yjs update, a withdrawal, or a refusal of another author's content.

**SYNC-R5.** Entries are never ordered by a shared counter. Order is **causal**: an entry is after
those it names as parents. Entries that name neither the other are **concurrent** and both stand.

**SYNC-R6.** Where a derivation requires a total order over concurrent entries, it MUST use a
deterministic tie-break on entry hash, so that every holder computes the identical result.

**SYNC-R7.** Each author's own entries form a chain. A holder's **position** is a watermark per
author: the highest contiguous entry it holds from each. This is the only position primitive, and it
serves governance and content alike.

**SYNC-R8.** The daemon MUST NOT store per-recipient delivery state. No queue, no attempt counter,
no send counter, no acknowledgement row, no abandonment marker.

**SYNC-R9.** Whether another holder has a given entry MUST be answered by comparison when asked,
never from a stored record.

---

## 2. The exchange

**SYNC-R10.** Reconciling is one exchange between two parties over one or more documents:

| # | Direction | Carries |
|---|---|---|
| 1 | A → B | protocol version; per document: `documentId`, A's watermark vector, A's refusal set |
| 2 | B → A | entries A lacks (governance first), B's watermark vector, B's refusal set |
| 3 | A → B | entries B lacks — **sent only if B is behind** |

**SYNC-R11.** A version mismatch MUST be refused by name, at both ends, with a sentence naming the
two versions. No dual-speak mode.

**SYNC-R12.** Governance entries MUST be applied before content entries in the same exchange.

**SYNC-R13.** Entries from one author MUST be applied in that author's order and contiguously. A
holder with a gap MUST report its highest **contiguous** entry, never its highest received.

**SYNC-R14.** An entry whose parents are not all held MUST be held, not applied and not discarded,
until they arrive. It MUST NOT be counted as held in a watermark.

**SYNC-R15.** Reconciling MUST be idempotent, in any order, any number of times.

**SYNC-R16.** Multiple documents MAY be batched into one exchange.

---

## 3. Entitlement

**SYNC-R17.** Four classes, derived from the receiver's own state — never from a stored flag:

| Class | May receive | May author |
|---|---|---|
| **participant** — admitted and consented, not removed | yes | yes |
| **invited** — named in an admission entry, has not answered | yes | no |
| **removed** — a removal entry names them | their own removal and its ancestors, nothing beyond | no |
| **stranger** — none of the above | no | no |

**SYNC-R18.** A responder MUST derive the class from its own state and MUST refuse a stranger by
name.

**SYNC-R19.** A refusal caused by the responder not yet knowing of an admission MUST be
non-terminal and MUST say so, or a legitimate joiner is stranded whenever their inviter goes
offline before the news spreads.

**SYNC-R20.** Content authored by an author MUST be admitted only if that author was a participant
**at that entry's position in the causal history** — determined from the entry's ancestors, not from
the receiver's current state. A holder removed today MUST NOT have their earlier work rejected, or
holders who were behind at removal never converge.

---

## 4. Consent — one handshake

**SYNC-R21.** Creating a document and admitting a holder are the same act: an entry naming the
subject, plus that subject's own signed consent entry.

**SYNC-R22.** An admission entry alone MUST NOT make anyone a participant. Consent is the subject's
own entry, and carries the `assurance_tier` and `feature_version` they are agreeing to.

**SYNC-R23.** A subject decides by reading what they received through the ordinary exchange — their
entitlement is **invited** (R17). There is no bespoke offer frame carrying history.

**SYNC-R24.** A subject MAY refuse; the refusal is an entry. They are not a participant and are not
reconciled with thereafter.

**SYNC-R25.** An invitee learns an invitation exists by a **notice** carrying only `documentId` and
the inviter. It is a pointer, not content, and losing it MUST NOT strand the invitation — the next
exchange with any holder that has the admission entry delivers it.

---

## 5. Ending

**SYNC-R26.** `close` and `kill` are governance entries.

**SYNC-R27.** A document is **closed** when every current participant has a `close` entry among the
applied set. Derived, never tracked. Concurrent closes are not a conflict — they are the normal case.

**SYNC-R28.** A document is **killed** when any admin has a `kill` entry. Immediate, one-sided.

**SYNC-R29.** A holder MUST NOT author content once it has applied an ending.

**SYNC-R30.** Content whose ancestors do not include an ending was authored before it and MUST be
admitted. Content naming an ending among its ancestors MUST be refused. This is checkable by every
holder independently and settles the flush-or-abandon question: work written before the ending
reaches everyone; work written after it is refused everywhere, including from a modified daemon.

**SYNC-R31.** Reconciling MUST continue after an ending until holders converge, then MAY stop.

---

## 6. Removal

**SYNC-R32.** A removed holder MUST be sent their own removal entry and its ancestors, and nothing
authored after it. They learn they were removed, from their own state, and can derive it without
being told twice.

**SYNC-R33.** Removal MUST NOT reach a removed holder's copy. Their entries and content remain
theirs.

**SYNC-R34.** Removal MUST take effect by derivation alone. No code may exist whose purpose is to
stop in-flight delivery to a removed holder, because there is none.

---

## 7. Refused content

The failure this section exists to prevent is already on the record in `document-rejection.ts`: a
naive comparison re-offers refused work forever, the refuser re-refuses forever, and everything
causally stacked on it is stuck behind it.

**SYNC-R35.** A refusal is an entry authored by the refuser, naming the refused entry and the reason.
It travels by the ordinary exchange like anything else.

**SYNC-R36.** A holder's **refusal set** MUST be included in its position (R10 step 1). Any party
computing a difference MUST exclude entries the other has refused. Nothing refused is ever
re-offered.

**SYNC-R37.** Receiver-side records of what was refused and what is held pending its parents are
REQUIRED and are not delivery state. **R8 forbids a sender's ledger of recipients; it does not
forbid a receiver's record of its own decisions.**

**SYNC-R38.** Work causally stacked on a refused entry cannot apply for that holder. The author —
reachable by ordinary reconciling, because the refusal reaches them — MAY publish a superseding
entry. If the author never does, that holder remains behind, and the surface MUST say so, naming the
refused entry.

---

## 8. Scheduling — separated from safety

**SYNC-R39.** Reconciling MUST be attempted on: committing an entry (to reachable parties), a party
becoming reachable, and a periodic sweep.

**SYNC-R40.** No trigger may be required for correctness. Any lost nudge MUST be recovered by the
next exchange.

**SYNC-R41.** Volatile scheduling state — backoff, in-flight marks, per-party suppression, skipping
a sweep because the cache says nothing changed — is PERMITTED and expected. It MAY delay an
exchange. It MUST NOT forbid one, gate admissibility, or survive a restart as authority.

**SYNC-R42.** An in-flight mark MUST be time-bounded and released loudly on expiry. An unbounded
in-flight mark is the stall this milestone already paid for twice.

**SYNC-R43.** Sweep cost MUST be bounded: exchanges batched per party (R16), suppressed for parties
believed current, and backed off for parties that do not answer. A document that has converged and
ended MUST reach a quiescent state with no periodic traffic.

---

## 9. Stored, derived, displayed

**Authoritative:** the entry set; the replayed content; the local file mirror; the receiver's own
refusal and pending-parent records (R37).

**Display cache, non-authoritative:** per party — last successful exchange, their last known
watermark.

**SYNC-R44.** No decision affecting correctness may read the display cache.

**Derived, never stored:** participants; admins; properties; ended state; every party's entitlement
class; own standing; whether a party is in sync.

---

## 10. Surface

**SYNC-R45.** `cello_doc_list` returns per document: `documentId`, `documentType`, `participants`,
`admins`, `properties`, `ended` (`null|closed|killed`), `yourStanding`
(`participant|invited|removed|unknown`), `parties[]`.

**SYNC-R46.** Each party: `{ agentId, class, sync, lastSyncedAtMs, blockedBy? }` where `sync` ∈
`in_sync | behind | unseen`, and `blockedBy` names a refused entry when R38 applies.

**SYNC-R47.** REMOVED: `pendingDeliveries`, `pendingSent`, `pendingUnsent`, `abandonedDeliveries`,
`closePending`, `peerAccepted`, `peerHasPublished`, `proposalSent`, `holdersNotified`,
`holderFailures`.

**SYNC-R48.** A derived field the daemon cannot compute MUST be reported as such by name. An absent
key MUST NOT be how failure is expressed.

---

## 11. Deletions

**SYNC-D1.** The content delivery ledger and its worker pass.
**SYNC-D2.** The amendment delivery queue and its worker pass.
**SYNC-D3.** The control-frame delivery queue and its worker pass.
**SYNC-D4.** Content acknowledgement frames, and every substitute built for the paths lacking one:
proof-by-epoch, retired-versus-acknowledged, send ceilings, unconfirmed reporting.
**SYNC-D5.** The second consent handshake: join offers carrying history, and the separate
proposal/accept/refuse/answer path.
**SYNC-D6.** Control-frame signing and fan-out, and close-settlement bookkeeping.
**SYNC-D7.** The per-envelope `epoch_id` stamp and the epoch-mismatch refusals built on it —
**only if SYNC-G1 confirms causal ancestry replaces every use.**
**SYNC-D8.** Duplicate derivations of participant set and own-standing. Exactly one of each.
**SYNC-D9.** Withdrawal of an undelivered update. Verified local-only today; deleting it touches
replay and the store's kind constraint. A product loss, accepted.
**SYNC-D10.** Delivery session hints.

**NOT deleted, contrary to v1:** session liveness and route selection stay in the session layer,
which continues to own relay vocabulary. The document layer MUST NOT reference it (AC15). Version
negotiation is not deleted — it moves to R11 and R22.

**SYNC-R49.** Each deletion MUST be proven by removal: deleted, both repos' gates green, absence
asserted on the **built artifact**.

---

## 12. Gates — settle before the phase named

**SYNC-G1 (before P4).** Confirm causal ancestry replaces every use of the per-envelope `epoch_id`.
Deliverable: a written finding citing every producer and consumer, and showing R20 and R30 cover
each. If any use survives, D7 is struck and the stamp stays.

**SYNC-G2 (before P1).** Confirm the entry set tolerates concurrent authors: that the deterministic
tie-break (R6) yields identical derivations everywhere, and that genuinely conflicting governance
acts — two incompatible property changes, a removal concurrent with a promotion — have a stated
rule. **This is the assumption v1 got wrong; it gates the first phase that makes writes concurrent.**

---

## 13. Acceptance criteria

Three daemons (A, B, C), separate OS processes.

**SYNC-AC1 — convergence.** Each edits while the others are unreachable; all reachable; all three
converge to identical content, unaided.

**SYNC-AC2 — forwarding is load-bearing.** A edits, then A is permanently killed. B and C reconcile.
**C holds A's edit, forwarded by B**, and verifies A's signature itself.

**SYNC-AC3 — no sender ledger.** After AC1, no daemon holds per-recipient delivery rows, on disk or
in memory. Receiver-side refusal/pending records are expected and MUST be present.

**SYNC-AC4 — concurrent governance.** A and C both `close` while partitioned from each other. All
three converge on a closed document containing both entries, with identical derivations. *(The case
v1 diverged on.)*

**SYNC-AC5 — latency.** With B reachable, an entry A commits is held by B within N seconds without a
sweep. *(Proves the nudge exists.)*

**SYNC-AC6 — step 3 is live.** B is behind and only A ever initiates. B converges.

**SYNC-AC7 — restart.** Kill B mid-exchange, restart. B converges with nothing remembered.

**SYNC-AC8 — relay loss.** Destroy relay session state mid-exchange. The next exchange converges. No
session retired, none marked dead.

**SYNC-AC9 — idempotence.** Three consecutive exchanges, no changes: byte-identical state, nothing
re-applied, no traffic beyond the position compare.

**SYNC-AC10 — join.** C joins with existing history via the ordinary exchange plus its own consent.
No bespoke offer frame exists.

**SYNC-AC11 — stranded joiner.** A admits C then goes offline before B learns. C reconciles with B;
B's refusal is non-terminal and names why; once B learns of the admission, C converges.

**SYNC-AC12 — refusal does not wedge.** B refuses one of A's entries on injection grounds. The
refusal reaches A. **It is never re-offered to B**, by A or by C. A publishes a superseder; B
converges. B's surface names the refused entry meanwhile.

**SYNC-AC13 — removal is immediate and derived.** A removes C. No code acts on in-flight work; A and
B stop reconciling with C. **C receives its own removal, and C's own surface says removed with the
reason.** C's copy is intact.

**SYNC-AC14 — removed-author history still converges.** C authored an edit before removal that D
lacks. After C's removal, D still converges on it. *(R20; the case that would silently strand D.)*

**SYNC-AC15 — a stranger is refused.** C, running a modified daemon, requests an exchange from B
after refusing to join. B refuses from its own state.

**SYNC-AC16 — post-ending forgery is refused.** A modified daemon authors content naming an ending
among its ancestors. Every honest holder refuses it. Content authored before the ending still
converges.

**SYNC-AC17 — no relay vocabulary.** The built document-layer artifact contains none of
`session_sealed`, `relay_session_gone`, `parked`, `witnessed`.

**SYNC-AC18 — quiescence.** A converged, ended document generates no periodic exchanges. A party
that never returns does not generate unbounded traffic.

**SYNC-AC19 — version refusal.** A daemon speaking an older exchange version is refused by name at
both ends, with both versions in the sentence.

**SYNC-AC20 — honest surface.** With B unreachable, A shows B `behind` with a last-seen time,
sourced from the display cache. No count of pending items. Never `in_sync`.

---

## 14. Phases

Each ends green on both repos' gates and is reviewed before the next.

**P0.** Answer SYNC-G2. No code.
**P1.** Entries gain parents; position becomes a per-author watermark; derivation by causality with
the R6 tie-break. Governance moves onto it. *(Endings and consent ride the existing amendment
carrier until P4 deletes it — this is intended; do not build a third interim carrier.)*
**P2.** One consent handshake (R21–R25); delete D5.
**P3.** The exchange (R10–R16), entitlement (R17–R20), refusals (R35–R38), forwarding (R1–R2).
**P4.** Answer SYNC-G1, then delete D1–D4, D6–D10. Prove by removal (R49).
**P5.** Scheduling (R39–R43) and the surface (R45–R48).
**P6.** Enforcers re-pointed at AC1–AC20.

**Compatibility:** none owed — all holders upgrade together and essentially no documents exist. That
window closes the day a real workflow depends on one.

---

## 15. Board impact

Struck once P4 lands: `DOD-MP-AMEND-CONFIRM-1`, `DOD-MP-RELAY-GONE-DISAMBIG-1`,
`DOD-MP-ZOMBIE-SESSION-1`, `DOD-MP-ENDED-BACKLOG-1`, `DOD-MP-CONTROL-DURABLE-1`,
`DOD-MP-INVITE-FANOUT-1`, `DOD-MP-SESSION-RETIRE-1`.

Retained: `DOD-MP-GOVERN-WIRE-1` — a partially-signed governance entry still needs a way to be
gathered across machines; note it becomes simpler, since a half-signed entry can reconcile like any
other and complete when the last signature arrives. `DOD-MP-E2E-GOVERN-1`,
`DOD-MP-REMOVE-FEEDBACK-1` (R32/AC13 now carry it), `DOD-MP-DELIVERY-QUIET-1` — **not** trivial;
the board's own trace stands, and it needs the notice of R25 to carry a purpose.
