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
  ever fill. Held content is memory-only and destroyed at teardown. TWO PHASES, one subject.
  Phase 1: make a submission idempotent end to end, and make the relay-assigned position the ONLY
  position anyone uses. Phase 2: relay loss and client-driven failover — the same topology, and too
  intertwined with Phase 1 to live anywhere else, since a session is bound to one relay for life and
  that relay's state is memory-only. Phase 2 is worked after Phase 1 and constrains it throughout.
  Sole status authority. Spec-of-record is
  2026-08-16_1930_one-way-content-loss-the-ordering-counter-both-sides-disagree-on.
---

# M12B — Definition of Done

> ### Why this is M12B and not a new milestone
> Ruled by Andre, 2026-08-17: this is a defect in the **relay↔client communication topology**,
> which is M12's subject. It is not a documents problem (M14B's Tier SYNC shipped and its spec
> never mentions messages) and not an infrastructure problem (M12's own open lines are AWS
> teardown and CI).

## How to use this
- **Two phases. Phase 1 is active: Tiers T → A → B → E. Phase 2 is Tier R**, worked after Phase 1
  closes — but its standing constraint applies to Phase 1 work from now (see Tier R).
- Find the lowest-numbered line not ✅ in the active phase — that is the next unit, **except within
  Tier A, where the work order is governed by [[M12B-PROCEDURE]] §4 and deliberately deviates from
  line order.** §4 puts `CLIENT-REUSE-1` before the wire change because the client-side half works
  against an unchanged relay and survives a relay restart, so it ships risk-free first. Line order
  here is the DEPENDENCY order; §4 is the BUILD order, and §4 wins.
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
- **POSITION-SURVIVES-ITS-RELAY** — a canonical position must remain provable by the parties that
  survive the relay that issued it. A relay can stop at any moment, so nothing load-bearing may be
  meaningful ONLY relative to one relay's live in-memory state: every position a client relies on
  must be backed by something the client HOLDS and another relay can INDEPENDENTLY VERIFY — today
  the relay's signed ACK, verifiable against the predecessor's public key in the directory
  (`FEDERATION-003`). It follows that **failover is client-driven, permanently**: a relay that has
  stopped cannot hand anything over, so the surviving parties must be able to carry the session
  themselves. This is an invariant, not a Phase 2 deliverable — Phase 2 BUILDS the failover, but
  every unit in every phase is reviewed against this property from the first line of code.
- **THE RELAY MAY DISAGREE** — a client bug must not be able to silently corrupt ordering. Where
  the relay holds the facts to contradict a client, it says so rather than accepting whatever it
  is told. (Adversarial framing deliberately NOT claimed — see Decisions Carried.)

---

## Tier T — Trace (confirm-first; no code ships from this tier)

> ### 🔴 THE DIAGNOSIS BELOW WAS INCOMPLETE — CORRECTED 2026-08-17 (→ Entry 6)
> This milestone was written believing the positions were burned by **retransmissions**, and its
> headline fix (a submission id so a retry is recognisable) follows from that belief. **Measurement
> found a second and far larger producer: document sync frames.** They are NOT retries — each is a
> genuinely distinct send, legitimately entitled to its own position — so **no idempotency key
> deduplicates them**. Tier A could have shipped in full, including the relay fleet roll, and two
> agents still could not have held a conversation.
>
> The document-side cause is FIXED (`DOD-SYNC-REFUSAL-BACKOFF-1` in [[M14B-DEFINITION-OF-DONE]])
> and a live send then delivered directly with zero holds — **though re-measuring the same session
> 20 minutes later found 2 holds and 20 direct-send failures. The flood fix removed the ENGINE, not
> the DEFECT; the milestone is NOT closed by it (Entry 6).** Tier A remains correct work — a
> retransmission can still burn a position — but it is no longer what stands between an operator
> and a working conversation. **Priority order is restated under "Work order" below.**

- **DOD-M12B-TRACE-1** [cello-client] — name the resubmitter, with file/line evidence. Production
  shows one content hash consuming 49 canonical positions in session `f54e0d07` (49 receipts, ONE
  distinct message, max sequence 98) and another 69 times. Establish exactly which component
  re-submits: the document delivery worker's periodic frame, the retry queue's direct resend, the
  TTF park path, or more than one. For each: does it call `submitMessageHash` again, and does it
  have the original ordering record (`structure1_cbor`/`structure2_cbor`) in hand when it does?
  The retry queue already persists those columns and its own comment says they exist to stop "the
  divergent-leaf-index failure" — establish whether they are read on the resend path at all.
  Every divergence from the spec-of-record's assumptions becomes an AC on the unit it affects.
  — ✅ **ANSWERED 2026-08-17: it is the document sync worker, not the retry queue** → Entry 6.
  Measured on one live daemon: **321 reconcile attempts against 2 documents in 85 minutes, refused
  321 times, 0 successes**; one session carried **3 real messages, 41 document ack frames, 43
  canonical positions**. The frames are not resubmissions — each is a distinct send taking its own
  position, correctly (`document-delivery-transport.ts` `sendBytes` → `sendContent` → `appendLeaf`,
  deliberate since `f75ea09`). The retry queue was NOT the burner. Cause fixed in M14B
  (`DOD-SYNC-REFUSAL-BACKOFF-1`); live re-test after the fix delivered directly with 0 holds — but
  **that was a first-minute snapshot, NOT the steady state**: the same session took 2 holds and 20
  `session.content.direct.send.failed` over the next 20 minutes. The flood fix removed the ENGINE,
  not the DEFECT. See Entry 6's follow-up table before trusting any ✅ here.

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
  the answer is recorded in Decisions Carried, not left implicit. **Constrained by Entry 3:** a
  session is bound to ONE relay for life (directory-signed assignment, no handoff), and its state
  is memory-only. So if the answer here is "do not persist", CLIENT-REUSE-1 is not defence in
  depth — it is the ONLY guard that survives a relay restart, and this DoD must say so plainly
  rather than implying two independent protections. — ❌

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
  epitaph. — ✅ **PROVEN 2026-08-17** — held frames are rows in `held_content`, keyed on
  `(agent_id, session_id, canonical_seq)` so a restored frame lands at its OWN relay-assigned index;
  restored lazily on first use and released immediately if already in order; moved to
  `sealed_session_annex` when a session goes terminal, since ingest refuses a terminal session and
  nothing could ever release them again. Reviewer found **4 blocking**, all fixed (`72f5057`) —
  two of which would each have re-created the loss: the supersede test compared the relay's counter
  against the local leaf count (*"destroys verified content while reporting it as tidy-up"*), and a
  frame restored exactly AT the frontier was never drained (*"Undeliverable **and** unsealable"*).
  The same review found a **pre-existing upgrade-path defect** — the agent-id re-key dropped
  `sessions.read_at` on the one boot a legacy DB migrates, hidden by a parity test that replayed the
  ALTERs in the wrong order. Fixed here. → Entry 13

- **DOD-M12B-ACK-1** [cello-client] — establish and fix why the FIRST acknowledgement fails. The
  spiral needs exactly one unacknowledged send to start: held content is deliberately never
  acknowledged ("Held content is NOT yet a durable leaf, so it is deliberately NOT acknowledged"),
  and every send carries a 20-second TTF timer that fires on every message in production logs.
  **Diagnosed 2026-08-17 → Entry 2: the ack is SENT and fails to write.**
  `content.delivery.ack.send.failed` fired **36 times, with one single error every time —
  `"Cannot write to a stream that is closed"`.** The receiver appends and verifies, opens a fresh
  stream back to the sender, and the write fails; the sender never learns the content landed, its
  TTF expires, and the retry takes a new position. That is the ignition step, and it needs no hold
  to start. **Remaining work: prove WHY the stream is closed** — three untested candidates in
  Entry 2 (connection already gone; the unawaited `stream.send(...)` racing the close; the peer
  closing the inbound direction after sending content) — then fix it red-first.
  **PROMOTED 2026-08-17 to the milestone's most valuable open line (Entry 6).** The SAME error,
  verbatim, is what makes an ordinary message PARK instead of deliver. `session.content.direct.send.failed`
  (added cello-client `7d36cfb`, because this catch discarded its error and 212 parks recorded no
  reason at all) fired on a live session with `"Cannot write to a stream that is closed"`. So
  *"the ack never arrives"* and *"the message goes to the relay instead of to the peer"* are **ONE
  defect in two places**, not two — and fixing it repairs both.
  **Ruled OUT by measurement, so nobody re-runs them:** not a lost connection
  (`session.transport.connected` fired 26 times for ~25 sessions, and the test session reported
  `liveness: alive, path: direct` **9.5 seconds before** its send parked); not a stale counterparty
  peer id (`newStream` SUCCEEDED — the failure is on the WRITE); not standing-receiver churn
  (**6** genuine teardowns in 2.5 h, **0** from the endpoint path — the ~57 other builds were the
  by-design factory replacement after handoff); **not** the unawaited `stream.send(...)` racing
  `stream.close()` — only synchronous work sits between them.
  — ✅ **PROVEN 2026-08-17. It is libp2p's per-protocol inbound-stream cap of 32, and the receiving
  handler never released a slot.** `#handleContentStream` read one frame and returned without
  closing, so every frame and every ACK left a half-open stream in the connection for its whole
  life. The cap is enforced AFTER protocol negotiation answers, which is why `newStream` succeeded
  and the write did not. **Measured: exactly 32 successful opens preceded the first failure on BOTH
  affected sessions**, and the regression reproduces it at frame 33. Fixed at three levels — the
  receiver closes (and after a linger, resets unilaterally, since a peer owns its own daemon), both
  sender sites retire the stream they opened, and the failure logs now carry the live counts and
  the cap. The **liveness lie is fixed in the same line**: a fourth daemon-local state `impaired`,
  set and cleared from both send paths, carrying WHY and what became of the content so the receive
  surface stops guessing. Reviewers: *"Diagnosis confirmed"* / *"the new test survives THE REVERT
  TEST"*; 9 findings on the first pass and 7 on the second, **all fixed** (`cf345b3`). → Entry 12

- **DOD-M12B-DELIVERY-QUIET-1** [cello-client] — **a session that DOCUMENT DELIVERY opened must not
  fire the party-became-reachable trigger, must not ring the conversation doorbell, and must not
  push a phone notification.** Ruled by Andre 2026-08-17: exempting delivery-opened sessions from
  the reachability trigger is the chosen direction of the three that were on the table. —
  ✅ **PROVEN 2026-08-17** — doorbell, phone push and backoff reset all suppressed for a
  delivery-opened session and all still fire for a peer-opened one. **The first build did not work**:
  keyed on agent NAME + peer pubkey, it could never match on the inbound half, which is the only
  production emitter of `created` — reviewer: *"a guard that reads as protection and is unreachable."*
  Re-keyed on pubkeys at both ends; a SECOND Telegram push was found unguarded. → Entry 9

  **The circularity, which is the whole defect.** `dispatchSessionStateChangedWithTelegram`
  (`daemon.ts`) fires on every `state === "created"` and calls
  `reconcileScheduler.onReachable(ownerAgentId, counterpartyPubkey)`. That call is not a nudge — it
  **sets `failures = 0` and `nextAttemptMs = 0`** (`document-reconcile-scheduler.ts` `onReachable`)
  and attempts immediately, for every shared document, in `RECONCILE_BATCH_CAP` batches. The
  rationale is sound and stated in the code: *"an explicit reachability signal RESETS backoff: the
  backoff modeled 'they do not answer', and here they demonstrably just did."* (SYNC-P5 R39
  trigger 2.)
  **It is only sound when the PEER caused the session.** When DOCUMENT DELIVERY opened it, the
  "signal" is our own outbound act reflected back at us. We learn nothing about the peer, and we
  wipe the backoff that a refusal — possibly that same peer's refusal, seconds earlier — just set.

  **The loop, in order:**
  1. The sweep has a frame to deliver and finds no reusable session, so `acquireSession` opens one.
  2. Session creation dispatches `state: "created"`.
  3. That calls `onReachable`, which **zeroes the backoff** and immediately sweeps every shared
     document with that peer.
  4. The sweep produces more frames, which may open more sessions. Back to 1.

  **Measured.** BEFORE the M14B fix: 321 reconcile attempts / 85 min, 53 sessions driving 63
  standing-receiver builds. AFTER `DOD-SYNC-REFUSAL-BACKOFF-1` shipped: **55 reconcile attempts in
  20 minutes with the backoff in place, and 0 refusals.** The refusal storm is genuinely gone; the
  VOLUME is not, and this trigger is why. **This line is the reason that fix only got us part of
  the way, and it must not be read as that fix having failed.**

  **The two other consequences on the same code path**, both raised by Andre and both in scope here:
  - **The doorbell.** `session_state_changed / created` is dispatched identically whether a human
    opened the session or the delivery worker did. The operator sees "someone wants to connect" for
    machine traffic. The correct surface already exists and is unused by delivery: `document_notices`
    in `cello_inbox`, whose own guidance reads *"Nothing is waiting on a reply."*
  - **The phone.** The same path calls `sendTelegramDoorbell(...)`, so a background document sync
    can push a notification to the operator's phone.

  **What must NOT break — the falsification to run before merging.** A session opened by the PEER
  must still reset the backoff and sweep, or documents stop syncing promptly when someone comes back
  online, which is exactly what R39 trigger 2 exists to deliver. The exemption must therefore key on
  *who opened this session*, not on *what kind of frame is being sent*. The delivery transport
  already knows — `acquireSession` returns `sessionOpened: true` for a session it opened — so the
  signal exists and needs threading, not inventing.
  Assert BOTH directions in tests: a delivery-opened session does NOT reset backoff and does NOT
  dispatch a doorbell; a peer-opened inbound session STILL does both.

  **How to know it worked.** Re-run the 20-minute measurement on a live daemon and compare against
  the 55 attempts / 0 refusals baseline above, with no reduction in how quickly a document syncs
  after a peer comes back online. A drop in attempts with a matching rise in sync latency is the
  failure mode to watch for, not a success.

---

## Tier S — Session lifecycle and surface truth (all found 2026-08-17, Entry 8)

> These seven were hit while chasing the ordering defect. None is the ordering defect. Each one
> either **lies to the operator** or **leaves a session in a state nothing can clear**, and every one
> of them cost real debugging time today. They are on this board because they are messaging-spine
> defects; the customer-facing framing of each is in [[launch-triage]] items 26–32.

- **DOD-M12B-INBOX-TRUTH-1** [cello-client] — **`pending_session_requests` reports sessions that
  were already accepted.** The field is produced from the in-memory notification queue and means
  "no `cello_await_session` has claimed this notice". It is READ, by every agent and by its own
  name, as "this session has not been accepted". The session was accepted by the standing receiver
  before the notice was ever queued — the project's own skill file says so: *"Inbound sessions are
  auto-accepted by the standing receiver — there is no separate accept step."* Cost today: hours,
  and a confidently wrong diagnosis reported to Andre that the two sides disagreed about a session's
  existence. They never did. Minimum fix: carry per-entry truth (`accepted: true`) plus guidance
  saying the session is already readable and `cello_await_session` only drains the notice. Additive;
  breaks no existing test. — ✅ **PROVEN 2026-08-17** — both lists carry per-entry `accepted: true`
  plus guidance naming what "pending" actually describes; the reaper now reaps TERMINAL before
  `tooOld`, so the expired list only ever holds live sessions. Reviewer confirmed the central claim
  (*"`accepted: true` really does hold on every production path"*); 1 blocking finding (the overlap
  case), fixed at the source. → Entry 9

- **DOD-M12B-AWAY-MARK-1** [cello-client] — **the away auto-responder answers on a session no window
  is attending, and nothing marks the reply as machine-generated.** It fires from
  `inbound-sessions.ts` on accept and from `daemon.ts` on every inbound message, gated only on
  "nobody is attending" plus "session is active". The reply is an ordinary `msg` leaf at a real
  sequence, so to the initiator it is positive evidence that someone is there. `isOwnAwayAutoReply`
  exists but runs only on the SENDING side and cannot recognise a configured away message by design.
  Consequence measured today: two agents spent the morning exchanging each other's away responders
  while both operators believed a conversation was happening. Fix is a marker the receiving side can
  read, NOT the removal of the away path. — ✅ **PROVEN 2026-08-17** — `[[AUTO-REPLY]]` prefixed at
  the single send choke point (so a CONFIGURED away message is recognisable too) and after gateway
  screening (so a redact verdict cannot strip it); both `cello_receive` exits carry `auto_reply` and
  guidance stating the mark is a ONE-WAY signal. Seal-impact lens clean: *"no case where a marked and
  an unmarked party disagree about a root."* 3 blocking findings, all fixed. → Entry 9

- **DOD-M12B-REDIAL-1** [cello-client] — **nothing re-dials, ever.** Only the initiator dials, once,
  at establishment (`connectToCounterparty`). `newStream` never dials — it requires an already-open
  connection filed under the recorded peer id. There is no re-dial on `session.liveness.changed →
  gone`, none on signaling reconnect, none on agent offline→online, none in the drain hook. So once
  a session's direct connection is lost for any reason, that session parks **every** message for the
  rest of its life, on both sides, permanently, and no surface says so. Note this is NOT the cause of
  today's parking (see `DOD-M12B-ACK-1`) — it is a separate standing fragility found while ruling
  that out. — ❌

- **DOD-M12B-ABANDON-NOTIFY-1** [cello-client] — **force-abandon is local-only, and the counterparty
  is never told.** `cello_close_session {force:true}` marks the session terminal on this side with no
  bilateral seal. The other side keeps its half live, keeps retrying delivery into it, and keeps
  re-dialling to re-establish. **This is what produced the 2026-08-17 "notification storm"**: after
  several force-abandons, the surviving halves dialled continuously and the operator saw connection
  requests from agents nobody was driving. The guidance already warns the receipt is forfeited; it
  does not say the far side will keep calling. Either the abandon is signalled, or the surviving half
  must be able to detect and retire itself. — ✅ **PROVEN 2026-08-17** — the abandon is signalled on
  the session's own authenticated stream, **pinned to the Noise-authenticated counterparty**, and the
  receiving half retires its TRANSPORT: durable marker, dial addresses dropped, node torn down —
  **not** its status. Reviewer found **4 blocking**, all fixed (`5a2b984`), and two were decisive. It
  proved by RUNNING the code that the retire was undone ~300 ms later (the teardown wrote the status
  back to `interrupted`) and that all four tests read inside that window: *"shipping this changes
  nothing about the storm it was written for."* And flipping the receiver terminal **denied it the
  unilateral seal** — a receipt the counterparty could destroy for free by hanging up, when going
  silent is exactly what that seal was built to survive. → Entry 15

- **DOD-M12B-SEAL-STUCK-1** [cello-client] — **a session holding content can never seal, so it never
  closes, and they accumulate.** `session.seal.blocked_incomplete` fires with `missingLeaves` /
  `heldCount` — correctly, since a chain with a gap cannot be co-signed. Measured 2026-08-17:
  **25 sessions opened by the document worker, 25 seals blocked, 0 closed.** Each one holds a slot
  against the per-sender cap (launch-triage item 21), so a spine defect converts directly into "this
  agent stops accepting sessions". The seal refusal is right; what is missing is any path OUT — the
  session is stuck between "cannot seal" and "must not be destroyed". Depends on
  `DOD-M12B-STRAND-1`. — ✅ **PROVEN 2026-08-17** — both status surfaces carry a three-state
  `sealReadiness` (`ready` / `blocked` / `unknown`) with the two numbers separated into what each
  actually is, plus how long the oldest message has waited. The path OUT is force-abandon, which
  rank 6 made non-destructive (holds move to the annex) and rank 10 made bilateral. Reviewer found
  **4 blocking** in the first build, all fixed (`9e6ad50`): it reported transient as permanent, so a
  healthy mid-conversation window looked identical to a stranded session (*"a warning on everything
  is a warning on nothing"*); it counted one message twice, labelling the copy on our own disk
  "never received"; it reported `null` — safe to close — for a session whose witness state predates
  this daemon, where a close is terminal; and one unreadable session row took the whole status
  response down, surfacing as `daemon: "broken_shutdown"` on a healthy daemon. Also: reading status
  was DELIVERING messages (the probe's hydration was wired to release), so a diagnostic advanced the
  chain. → Entry 14

- **DOD-M12B-SHUTDOWN-1** [cello-client] — **the daemon can refuse to exit.** `cello logout`
  reported *"Daemon shutdown did not complete within 5s … it may be stuck closing sessions or its
  database"*, and the process was still alive **30+ seconds** later. The log shows it was still
  running `document.reconcile.sweep` **during shutdown**. The socket was already removed, so from the
  operator's side the daemon was down while the process ran on; it took a signal to exit. A shutdown
  that keeps starting new outbound work is not draining. — ✅ **PROVEN 2026-08-17** — the sweeper
  refuses at every entry that starts work, inside its own party loop and between batches, and the
  refusal is at the DOCUMENT LAYER's choke point so all four callers are covered (the scheduler was
  only one). **And the actual hang is fixed:** the reviewer established that a detached, unref'd
  sweep cannot hold the process by itself — it can only block an awaited teardown step, and those
  had no deadline. Stopping the session nodes and closing the gateway socket are now bounded and say
  so when they expire. Reviewer found **3 blocking**, all fixed (`963a853`), including that nothing
  proved `daemon.stop()` called the sweeper's stop at all — *"one deleted line silently reverts the
  whole unit"*. → Entry 14

- **DOD-M12B-RESTART-SEAL-1** [cello-client] — **a session our own stop interrupted resolves itself,
  with a receipt.** Measured 2026-08-17 over 17 days of one operator's log: **114 of 118 interrupted
  sessions were flipped by the graceful-shutdown sweep** immediately after `daemon.stopped`, 2 by the
  operator's own offline switch, and **0 by any transport event** — not one relay frame, relay stream
  close, or boot sweep. 95 restarts, and the boot sweep found nothing to sweep because shutdown had
  already done it. Those sessions are unresumable (their keypairs died with the process) and their
  only exit today is force-abandon, which forfeits the receipt: **137 sessions carrying 3,576
  messages produced nothing.** After this unit the daemon walks them on startup and SEALS them —
  bilateral if the counterparty answers, unilateral once the directory's delivery grace allows — and
  when the directory refuses `seal_unilateral_too_early` it **reschedules at the `remainingSeconds`
  the refusal already carries** instead of telling a human to come back in eleven minutes.
  **Keyed on `interrupted_by = 'local'`, and only that**: a counterparty or relay-stream-close
  interruption is left alone, so `SI-001` ("no auto-seal on a session_interrupted receipt — a daemon
  that sealed on its own would notarize a conversation nobody chose to end") keeps holding for the
  live case it was written about. Andre's 2026-08-17 ruling governs the restart case: *"do not
  resume. Resolve… make it a seal, not a force-close."* Bounded attempts, staggered so N sessions do
  not fire N simultaneous directory ceremonies, and refusing to start new work during shutdown.
  **Out of scope:** the 26 `seal_interrupted_pending` sessions — `cello_close_session` refuses them
  outright and what they wait for is unestablished. — ❌

- **DOD-M12B-SESSION-SEED-1** [cello-client] — **a session node that is torn down can come back at
  the SAME peer id, and its session can return to `active`.** Traced 2026-08-17: the peer id a
  counterparty holds belongs to the **session node**, not the standing receiver (the receiver is
  *promoted* into the session node at establishment and a fresh receiver is built behind it), so it
  does not churn under them. **The damage is that a torn-down session node is never rebuilt by
  anything** — `markInterruptedWithDetails` and `destroySessionNode` stop the node and delete it from
  `#activeNodes`, and no path anywhere recreates one. That is why a session cannot come back even
  when both parties are healthy and reachable. A rebuilt node today would get a fresh keypair, so we
  could dial them and **they could never dial us**, which is exactly why Andre ruled the seed must be
  **per-SESSION, never per-agent**: a per-agent seed would be one permanent correlatable identifier
  for everything that agent does. Ship: a 32-byte seed minted with each standing receiver, carried
  over to the session at handoff, held in memory for the session's life and passed as
  `transportPrivateKey` (`createNode` already accepts it and nothing has ever supplied one); a
  rebuild path when a non-terminal session needs a node and has none; and **the reverse edge
  `interrupted → active`**, which no code path has ever performed. **No persistence** — a daemon
  restart still mints fresh identities, which keeps ADR-0001's "fresh per session" true at the only
  boundary where it can still mean anything, and the restart case is `DOD-M12B-RESTART-SEAL-1`'s.
  Andre's other two invariants are ACs here: **idle is not interrupted** (any inactivity timeout is a
  configurable security setting, never a transport side effect), and **a session the receiver has
  closed must not accept new messages, whatever the sender does.** Also correct the **four drifted
  comments** claiming the receiver is rebuilt on every signaling reconnect — it is not; the ensure
  no-ops on a healthy receiver, and only a lost relay reservation rebuilds it. — ❌

- **DOD-M12B-SIGNAL-GUIDANCE-1** [cello-client] — **the `missing_signal` error instructs the caller
  to do the wrong thing.** `cello_send` requires a `signal` PARAMETER (`over` / `standby` / `wrap`).
  Its refusal guidance says *"Every cello_send message must end with one of: [[OVER]] …"* — which
  reads as "put this token at the end of your message body". Following the guidance exactly produces
  the same refusal, forever. Cost 2026-08-17: **six consecutive failed sends across two agents and
  three sessions**, initially misdiagnosed as a protocol defect and reported to Andre as such. The
  guidance must name the parameter. This is the milestone's own "errors name their cause" rule
  applied to a success path. — ✅ **PROVEN 2026-08-17** — the refusal names the parameter, shows the
  call, and shows no `[[…]]` token to paste; a repo-wide test fails on any documented `cello_send({…})`
  that omits `signal`, which is what closed the two doc surfaces the review found (one ships inside
  the connect tarball). Reviewer: *"SPEC: FAITHFUL … REMOVALS PROVEN"*, 2 blocking findings, both
  fixed. → Entry 9

---

## Tier E — Proof (three real daemons, separate OS processes)

- **DOD-M12B-ENFORCE-1** [cello-client] — the pinned regression flips. `it.fails(...)` in
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

## Tier R — PHASE 2: relay loss and client-driven failover (after Phase 1 — Andre, 2026-08-17)

> **A phase of this milestone, not an appendix to it** (Andre, 2026-08-17: *"it should be part of
> this milestone in this work, given that it's so closely intertwined with the problem — it just
> needs to be a later phase"*). Same subject, same code, same invariants: a session is bound to one
> relay for life and that relay's state is memory-only, so failover and ordering are the same
> topology question asked twice. Sequenced after Phase 1 so it cannot delay the fix that stops
> messages being lost today — and **constraining Phase 1 from now**, because the ordering rewrite
> must not foreclose it. Every Tier A and Tier B unit is reviewed against the constraint below
> before it merges.

> ### 🔒 THIS TIER BUILDS THE **POSITION-SURVIVES-ITS-RELAY** INVARIANT (Tier I)
> The property is owed from the first line of Phase 1 code, not from the day this tier starts.
> **Failover cannot be relay-initiated, because a relay can simply stop** (Andre, 2026-08-17) — the
> handover must be driven by the parties that survive. Anything built in ANY phase that makes a
> position meaningful ONLY relative to one relay's live in-memory counter, with no client-holdable
> independently verifiable proof of what that position was, is a blocking finding even if it fixes
> the ordering defect perfectly. Enforced per-unit by the lens of the same name (procedure §2b).
>
> **The primitive already exists and has the right shape.** `FEDERATION-003`
> (`relay-types.ts` / `relay-node.ts`): a submission may carry `predecessor_relay_id`,
> `predecessor_relay_signature`, `predecessor_relay_sequence`, `predecessor_relay_timestamp`. The
> CLIENT presents the dead relay's signed ACK; the new relay fetches the predecessor's public key
> **from the directory** and verifies the Ed25519 signature (`buildRelayAckTbs`) before accepting.
> No relay-to-relay contact. Design Tier A's submission id to sit alongside this, not across it.

- **DOD-M12B-RELAY-LOSS-1** [trustless-cello] — establish what a new relay does with a verified
  predecessor ACK. After verification the code comments "proceed to process the re-submission" and
  the path falls through to `seq_counter + 1` on the NEW relay's own state. Does the successor
  CONTINUE numbering from `predecessor_relay_sequence`, or restart from its own counter? If it
  restarts, positions collide across a handover and the primitive verifies a handover it cannot
  actually complete. Trace it; no code ships from this line. — ❌

- **DOD-M12B-RELAY-LOSS-2** [cello-client] — a session whose relay is gone stops claiming success.
  Today `relay_session_gone` is non-terminal: the client warns and keeps sending directly and
  unwitnessed, so delivery continues while the record silently stops growing and there is no
  re-recording path. Measured in-tree 2026-08-09: **68 minutes and 8 more messages against a chain
  frozen at six leaves, every send reporting success.** Either the session retires loudly or it is
  re-recordable — "delivered" must never be reported for content that entered no chain. — ❌

- **DOD-M12B-RELAY-LOSS-3** [cello-client + trustless-cello] — the client-driven handover, end to
  end: on losing its relay, a client presents its held predecessor ACKs to another relay from the
  directory's roster and the session resumes WITH ITS NUMBERING INTACT. Proven with three real
  daemons and a relay killed mid-session. Blocked on RELAY-LOSS-1's answer. — ❌

  > **Good news established 2026-08-17 and worth not re-deriving:** the relay REFUSES
  > (`session_not_found`) when its state is gone rather than restarting its counter and issuing
  > colliding positions. Colliding positions are NOT a failure mode. The damage is silence, not
  > corruption.

## Work order — RESTATED 2026-08-17 (supersedes "lowest non-✅ line" within Phase 1)

The tier order below is the priority the evidence supports, not the order the lines are written in.
Ruled after the document flood was found and fixed and a live send then delivered directly.

1. **`DOD-M12B-ACK-1`** — one error string breaks both the acknowledgement and ordinary delivery.
   Highest value in the milestone; it is the reason messages reach the relay instead of the peer.
2. **`DOD-M12B-STRAND-1`** — durable held content. This is what makes a gap RECOVERABLE instead of
   fatal: 367 held / 8 released / **24 destroyed** on one daemon in one morning, and each
   destruction is a gap nothing can ever fill.
3. **`DOD-M12B-INDEX-1`** — position discipline. The invariant everything else assumes and nothing
   enforces.
4. **`DOD-M12B-SUBMIT-ID-1` + `RELAY-IDEM-1/2` + `CLIENT-REUSE-1`** — still correct work; a
   retransmission can still burn a position. But it is no longer what stands between an operator
   and a working conversation, and it is the only part that costs a **relay fleet roll**.
5. Tier E proofs, then Phase 2 (Tier R).

> **Do not read this as "Tier A is wrong."** It is right, and unchanged. It was mis-ranked because
> the milestone believed retransmissions were the only position burner.

## Owed follow-ups — do not lose these (ruled by Andre 2026-08-17)

- **RE-MEASURE AFTER `DOD-M12B-STRAND-1` SHIPS, before building any resend-request protocol.**
  Andre ruled that a resend/negative-acknowledgement protocol ("I am missing position N, send it
  again") stays out of scope *for now* — but the reason gaps are FATAL rather than slow is that
  held content dies at teardown. Once holds are durable, the missing frame may still be parked at
  the relay and the gap may fill by itself on the next pull.
  **What to re-measure, exactly:** on a daemon running durable holds, over a session that has taken
  a gap — (a) the count of `session.content.held` versus `session.content.released`, which was
  **367 vs 8**; (b) whether `session.content.held.discarded` ever fires, which was **24**; (c)
  whether a gap present at teardown is still present after a restart + park drain. If holds survive
  and gaps close on their own, the resend protocol is not needed. If gaps persist with durable
  holds, the scope decision must be re-opened — that is the trigger, and it belongs to Andre.

- **AFTER THE FIXES ARE OUT, INVESTIGATE WHETHER SHARED NUMBERING IS STILL A PROBLEM.** Document
  sync frames take a position in the CONVERSATION's sequence space. That is deliberate (`f75ea09`,
  2026-08-05 — a document sender that skipped its leaf starved its own inbound), and Andre ruled
  2026-08-17 to **leave it alone for now**: separating the two lines changes what the tree contains,
  and the tree root is what the seal signs over, so it risks existing receipts. But it is the
  condition that turned a background sync failure into stranded foreground conversation.
  Carried as a launch-triage investigation, not a build line. Trigger to re-open: any gap observed
  on a session after the flood fix is live.

## Decisions Carried

- **M12B, not a new milestone** (Andre, 2026-08-17) — relay↔client topology is M12's subject.
- **Idempotency is correctness hardening, NOT adversary defence** — a client that wants to burn
  positions can mint fresh submission ids and the relay cannot stop it. What this buys is that an
  honest daemon with a bug can no longer silently corrupt ordering, and the invariant becomes
  enforceable rather than merely intended. Do not write security claims this cannot support.
- **The relay stays the ordering authority.** Any proposal where the client picks or asserts its
  own position is refused — a client that can decide ordering is a client that can lie about it.
- **Relay failover is CLIENT-DRIVEN, permanently** (Andre, 2026-08-17) — "given that the relay
  could just stop functioning at any point, it can't be the relay handing it over." Any future
  proposal for relay-to-relay handover is refused on this ground alone. `FEDERATION-003`'s
  predecessor-ACK carry is the sanctioned seam.
- **Tier R is sequenced after Tier E, but constrains Tiers A and B from now** — the ordering fix
  ships first; it does not get to make failover harder on its way past.
- **The relay's role is to be able to disagree** (Andre, 2026-08-17) — the deeper gap is that the
  relay today has no way to contradict a client about anything. Worth asking, per unit, where else
  it is silently accepting whatever it is told.

## Explicitly beyond M12B (so absence reads as intent, not omission)

> Relay loss and failover are NOT here — they are **Phase 2 (Tier R)**, inside this milestone.

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
