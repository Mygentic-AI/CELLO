---
name: M12B Relay–Client Ordering Definition of Done
type: definition-of-done
date: 2026-08-17
milestone: M12B
status: open
topics: [m12b, relay, ordering, idempotency, sequence, retry, content-held, messaging, topology, cello-client, trustless-cello]
description: >
  The yardstick for M12B — the relay↔client communication topology defect that strands basic
  messaging. A retry is re-witnessed as a NEW submission, so the relay mints a fresh canonical
  position for content the receiver deduplicates and never appends; the receiver's tree then falls
  permanently behind the canonical counter and every later message is held behind a gap nothing can
  ever fill. Held content is memory-only and destroyed at teardown. Scope: make a submission
  idempotent end to end, and make the relay-assigned position the ONLY position anyone uses. Sole
  status authority. Spec-of-record is
  2026-08-16_1930_one-way-content-loss-the-ordering-counter-both-sides-disagree-on.
---

# M12B — Definition of Done

> ### Why this is M12B and not a new milestone
> Ruled by Andre, 2026-08-17: this is a defect in the **relay↔client communication topology**,
> which is M12's subject. It is not a documents problem (M14B's Tier SYNC shipped and its spec
> never mentions messages) and not an infrastructure problem (M12's own open lines are AWS
> teardown and CI).

## How to use this
- Find the lowest-numbered line not ✅ in the active tier — that is the next unit.
- **Evidence discipline:** a flipped tag carries ONE line of evidence plus `→ Journal Entry N`.
  Full run output lives in [[M12B-BUILD-JOURNAL]]. This document stays a scoreboard.

## Repo Legend
| Tag | Local path | Notes |
|-----|-----------|-------|
| `cello-client` | `/Users/andrep/Documents/code/cello-client` | The daemon: submit, retry queue, park, the session tree and the hold gate. Ships via `/cello-publish` (LOAD THE SKILL, every publish) |
| `trustless-cello` | `/Users/andrep/Documents/code/trustless-cello` | The relay (`packages/relay`), the spine enforcers (`packages/e2e-tests`), these docs |

## Status legend
✅ PROVEN (enforcer-green where one is named) · 🟡 BUILT/UNVERIFIED-LIVE · 🟠 PARTIAL · ❌ NOT BUILT · 🅿️ PARKED

---

## Tier I — Invariants (properties, NOT deliverables — no status tags)

- **ONE-POSITION-PER-EVENT** — a logical message occupies exactly ONE canonical position, for its
  whole life, no matter how many times it is transmitted. A retransmission is the same event and
  must never consume a second position anywhere: not in the relay's counter, not in the relay's
  leaf log, not in either party's tree.
- **THE RELAY DECIDES, EVERYONE OBEYS** — the canonical position is assigned by the relay and by
  nothing else. A client never derives, infers, or substitutes a position of its own. Making a
  submission idempotent does NOT move that authority; it removes the client's ability to
  accidentally ask for a second answer to a question already answered.
- **INDEX IS THE POSITION** — a party's leaf index for a piece of content IS its relay-assigned
  canonical position. Any code path that appends at "the next local slot" without checking that
  the slot equals the assigned position violates this. The whole ordering design already assumes
  it (`session-node-manager.ts` names it "the leaf-index === sequence invariant") and nothing
  enforces it.
- **NO SILENT STRANDING** — content that has been received and verified is never destroyed to
  tidy up an ordering problem. If it cannot be delivered it is durable and reported, never
  memory-only and discarded.
- **THE RELAY MAY DISAGREE** — a client bug must not be able to silently corrupt ordering. Where
  the relay holds the facts to contradict a client, it says so rather than accepting whatever it
  is told. (Adversarial framing deliberately NOT claimed — see Decisions Carried.)

---

## Tier T — Trace (confirm-first; no code ships from this tier)

- **DOD-M12B-TRACE-1** [cello-client] — name the resubmitter, with file/line evidence. Production
  shows one content hash consuming 49 canonical positions in session `f54e0d07` (49 receipts, ONE
  distinct message, max sequence 98) and another 69 times. Establish exactly which component
  re-submits: the document delivery worker's periodic frame, the retry queue's direct resend, the
  TTF park path, or more than one. For each: does it call `submitMessageHash` again, and does it
  have the original ordering record (`structure1_cbor`/`structure2_cbor`) in hand when it does?
  The retry queue already persists those columns and its own comment says they exist to stop "the
  divergent-leaf-index failure" — establish whether they are read on the resend path at all.
  Every divergence from the spec-of-record's assumptions becomes an AC on the unit it affects. — ❌

- **DOD-M12B-TRACE-2** [cello-client + trustless-cello] — map every producer and consumer of a
  "position" in the messaging spine, and state which counter each one is. Known so far and to be
  confirmed exhaustively: the relay's `seq_counter`, the local `SessionTree` leaf index, and the
  retry queue's own `position` column (a local monotonic counter, NOT the relay's). Any place two
  of them are compared, assigned across, or assumed equal is a finding. — ❌

---

## Tier A — Idempotent submission (the fix)

- **DOD-M12B-SUBMIT-ID-1** [cello-client + trustless-cello] — a submission carries a
  **submission id** minted by the sender, one per logical message, stable across every
  retransmission of that message. It lives **inside Structure 1** — the signed frame the relay
  already validates — so the relay can verify the sender authored it and it cannot be altered in
  flight. Keyed `(session_id, sender_pubkey, submission_id)`; never global, never keyed on the
  content hash. A genuinely new message that happens to be byte-identical to an earlier one gets a
  NEW submission id, which is precisely what makes it distinguishable from a retransmission — the
  discrimination the content hash cannot provide. Wire-type change → publish cascade +
  trustless-cello re-pin are blocking ACs. — ❌

- **DOD-M12B-RELAY-IDEM-1** [trustless-cello] — `hash_submit` becomes idempotent. On a repeat of a
  `(session, sender, submission_id)` already witnessed, the relay returns **the position and the
  Structure 2 it committed the first time** — the same bytes, not a freshly built record, so both
  parties hold one signed ordering record per leaf. A repeat is a pure lookup: `seq_counter` does
  NOT advance, `leaf_log` does NOT grow, `tree_stack`/`running_root` do NOT change. Today all four
  happen on every submission (`relay-node.ts`, `const seq = state.seq_counter + 1`), so the
  relay's own tree counts a retry as a distinct leaf and diverges from both clients. Observable:
  `relay.hash.submitted` must distinguish a first witness from a replayed one. — ❌

- **DOD-M12B-RELAY-IDEM-2** [trustless-cello] — the idempotency record survives a relay restart,
  or the milestone states in writing why it does not have to. **The relay stores session state in
  memory** — the client comment on `relay_session_gone` says it "fires for perfectly live sessions
  whenever the relay restarts, because the relay stores sessions in memory" — so without this the
  defect returns after every restart, rarer and harder to see. Decide and implement: persist, or
  rely on DOD-M12B-CLIENT-REUSE-1 as the primary guard with this as defence in depth. Either way
  the answer is recorded in Decisions Carried, not left implicit. — ❌

- **DOD-M12B-CLIENT-REUSE-1** [cello-client] — a retransmission does not ask again. The sender
  reuses the ordering record it already holds from the first submission rather than calling
  `submitMessageHash`, on **every** resend path named by TRACE-1 (document worker, retry queue
  drain, TTF park). This is the half that works even against an old relay and after a relay
  restart. — ❌

---

## Tier B — Position discipline (make the invariant enforced, not assumed)

- **DOD-M12B-INDEX-1** [cello-client] — the sender places its own leaf at the relay-assigned
  position, applying the same ordering discipline it already applies to received content. Today
  the send path has the position in hand (`session.relay.hash.submitted` fires ~4 ms before
  `session.tree.appended`) and appends at the tail regardless. `SessionTree.appendLeafHash` is
  push-only and there is no representation for a hole, so the unit must either append strictly in
  position order (holding its own out-of-position content, symmetric with the receiver) or state
  why a hole-tolerant tree is required — **and if it is, what the Merkle root of a hole is**, since
  the root is what the seal signs over. — ❌

- **DOD-M12B-STRAND-1** [cello-client] — held content is never destroyed. Today
  `#heldContent` is memory-only and teardown logs `session.content.held.discarded`, which the code
  itself calls "a LOSS REPORT, not a fix — the content is unrecoverable by the time we are here."
  It fired **20 times on one daemon on 2026-08-16**. After this unit, verified content that cannot
  yet be delivered is durable and recoverable, and its loss report becomes an alarm rather than an
  epitaph. — ❌

- **DOD-M12B-ACK-1** [cello-client] — establish and fix why the FIRST acknowledgement fails. The
  spiral needs exactly one unacknowledged send to start: held content is deliberately never
  acknowledged ("Held content is NOT yet a durable leaf, so it is deliberately NOT acknowledged"),
  and every send carries a 20-second TTF timer that fires on every message in production logs.
  Establish whether the first ack is never sent, never arrives, or arrives late — this was NOT
  determined during the 2026-08-16 investigation and is the one unknown left in the chain. — ❌

---

## Tier E — Proof (three real daemons, separate OS processes)

- **DOD-M12B-ENFORCE-1** [trustless-cello] — the pinned regression flips. `it.fails(...)` in
  `core/daemon/src/__tests__/msg-001-strict-in-order.test.ts` ("a redelivery witnessed at a NEW
  canonical sequence must not strand every later message") becomes `it(...)` and passes. That test
  was committed red-on-purpose (cello-client `7384489`) precisely so this line has an unambiguous
  trigger. — ❌

- **DOD-M12B-ENFORCE-2** [trustless-cello] — a live spine test, three real daemons as separate OS
  processes: A sends, the acknowledgement is suppressed so A retransmits N times, and B still
  receives every subsequent message with no hold, no gap, and no `session.content.held.discarded`.
  Assert on the relay's counter too: N retransmissions of one message advance it by exactly ONE. — ❌

- **DOD-M12B-ENFORCE-3** [trustless-cello] — the discrimination case, which hash-dedup cannot pass:
  an agent sends "ok", then genuinely sends "ok" again. Two messages, two positions, both
  delivered, both in the transcript. A fix that collapses them is wrong, and this is the line that
  catches it. — ❌

---

## Decisions Carried

- **M12B, not a new milestone** (Andre, 2026-08-17) — relay↔client topology is M12's subject.
- **Idempotency is correctness hardening, NOT adversary defence** — a client that wants to burn
  positions can mint fresh submission ids and the relay cannot stop it. What this buys is that an
  honest daemon with a bug can no longer silently corrupt ordering, and the invariant becomes
  enforceable rather than merely intended. Do not write security claims this cannot support.
- **The relay stays the ordering authority.** Any proposal where the client picks or asserts its
  own position is refused — a client that can decide ordering is a client that can lie about it.
- **The relay's role is to be able to disagree** (Andre, 2026-08-17) — the deeper gap is that the
  relay today has no way to contradict a client about anything. Worth asking, per unit, where else
  it is silently accepting whatever it is told.

## Explicitly beyond M12B (so absence reads as intent, not omission)

- The **document** delivery ledger. M14B Tier SYNC replaced it with reconcile; this milestone
  fixes the messaging spine underneath and does not re-open that.
- A **resend-request / negative-acknowledgement** protocol ("I am missing position N, send it
  again"). None exists today — grep across the daemon and protocol-types returns only database
  migration code — and adding one is a larger protocol change. M12B's approach is to stop creating
  gaps rather than to build machinery for repairing them.
- The **second relay** returning `count=0` on every park pull from both daemons while never
  receiving a deposit. Observed 2026-08-16, wasted round trip, not a loss. Not in scope; do not
  re-chase it as part of this defect.

## Related Documents
- [[M12B-PROCEDURE]] — the runbook; read FIRST
- [[M12B-BUILD-JOURNAL]] — audit trail + evidence home
- [[2026-08-16_1930_one-way-content-loss-the-ordering-counter-both-sides-disagree-on]] — spec-of-record
- [[M12-DEFINITION-OF-DONE]] — the parent milestone
- [[launch-triage]] — item 19 and its siblings point here
