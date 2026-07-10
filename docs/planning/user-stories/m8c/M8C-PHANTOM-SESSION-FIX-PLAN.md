---
name: phantom-session-fix-plan
type: design
date: 2026-07-10
topics: [session-offer, standing-receiver, directory, fail-closed, unread, transcript, race, first-connect, silent-fallback]
status: active
description: >
  Four linked defects behind the "2 unread messages you can never read" symptom. An initiator that
  connects to an agent whose standing receiver has not come up yet gets counterparty_unavailable,
  while the receiver builds a session anyway and auto-replies into a void. Root cause: the responder
  aborts silently, the directory FROST-signs an assignment with an empty counterparty endpoint and
  distributes it to both parties, and the receiver never checks the field that would tell it nobody
  accepted. Written to be executed by an agent that has not seen the investigation.
---

# Phantom Session — Fix Plan (D1–D4)

> **You can run this cold.** Every claim below is evidence-backed, every anchor is a real
> `file:line`, and every fix has a red-first test and an explicit acceptance test. Where something is
> a hypothesis rather than proven, it says so. **Read §1 and §2 before touching code.**

## 0. TL;DR

| ID | Defect | Repo | Cheap? | Needs deploy? |
| :-- | :-- | :-- | :-- | :-- |
| **D3** `DOD-INBOUND-GUARD-1` | The receiver accepts an assignment it can see is broken | cello-client | ✅ daemon-only | no |
| **D1** `DOD-OFFER-REJECT-1` | The responder aborts **silently** on `standing_receiver_unavailable` | cello-client | ✅ daemon-only | no |
| **D2** `DOD-DIR-FAILCLOSED-1` | The directory signs + distributes an **incomplete** assignment | trustless-cello | ⚠️ | yes, 3 regions, ~25–30 min |
| **D4** `DOD-UNREAD-1` | A received transcript row with no session row = permanently unread + unreadable | cello-client | ✅ **decided 2026-07-10: producer-first** | no |

**Do them in the order D3 → D1 → D4 → D2.** D3 alone stops the phantom session and the orphaned
reply at the receiving daemon, with no directory deploy. D2 is the *correct* root fix but is the
expensive one and is not required to stop the bleeding.

**The invariant underneath all four (§4b) — hold it in review:** `getUnreadSummary` and `cello_receive`
must agree on what a session is.

**🚫 DO NOT "fix" this by adding a `JOIN sessions` to `getUnreadSummary`.** That makes the badge
disappear by hiding a message that was really delivered. It is a cosmetic fix over a real defect —
see §6.

---

## 1. The symptom, and the evidence

`cello_check_notifications` reports 2 unread for `Ms_Chelly`. Both sessions return
`session_not_found` from `cello_receive`. `cello_list_sessions` shows zero open sessions. The badge
can never be cleared, because clearing requires reading and reading is impossible.

The messages are **real** — `cello_get_transcript` returns them:

```
5749859a8380d55f98fdd4436ca7ee1d  seq 0  received  "Dispatched."
3d3311c867e96ff88803dce3deaf27b7  seq 0  received  "Agent is currently away. Your session request has been received and queued."
```

Those are `CONTACT-1`'s unknown-sender reply and `AWAY-1`'s away text.

**The correlation that identifies the cause.** In the whole of `~/.cello/daemon.log`:

```
session.offer.accepted   57
session.offer.abort       2      ← both reason=standing_receiver_unavailable
session.offer.accept.failed 0
```

**Two aborts. Two stuck sessions.** They line up exactly:

| abort | receiver | stuck session | initiator's failure |
| :-- | :-- | :-- | :-- |
| `2026-07-07T14:55:15` | `CELLO_Support` | `5749859a…` | `14:55:21` |
| `2026-07-08T16:32:50` | `CELLO_Feedback` | `3d3311c8…` | `16:32:55` |

---

## 2. The flow (proven from the log, not inferred)

Session `5749859a…`, initiator `Ms_Chelly`, receiver `CELLO_Support`. **Both are local agents on one
daemon** — the loopback case, same configuration that hid the `DOD-MONIKER-6` bug.

1. `14:55:15` — `Ms_Chelly` initiates. The directory sends `CELLO_Support` a `session_offer`.
2. `CELLO_Support`'s standing receiver **does not exist yet** (its
   `session.node.created agent=__standing_receiver__:CELLO_Support` fires at `14:55:21`, **six
   seconds later**). `wireSessionOfferHandler` takes the `if (!sr)` branch, logs
   `session.offer.abort`, and **returns without sending anything**. ← **D1**
3. The directory waits 2 000 ms for a `session_offer_accept` that will never arrive, times out, and
   "proceeds with empty defaults": `counterpartySessionPeerId = ""`. It **FROST-signs that
   assignment** and pushes it to **both** parties. ← **D2**
4. `14:55:21` — `Ms_Chelly`'s daemon applies the M8B F13 guard, sees the empty
   `counterparty_session_peer_id`, refuses, logs `session.initiate.counterparty_unavailable`.
   **No session row on her side.** *This behaviour is correct — do not change it.*
5. `14:55:21`–`:24` — `CELLO_Support` receives the **same incomplete assignment**, brings up its
   standing receiver, creates a session node, logs `session.inbound.accepted`. It now holds a session
   the initiator never created. ← **D3**
6. Unattended, it auto-replies (`session.away.response.sent`).
7. The reply reaches `Ms_Chelly`, is parked, and later `content.recovered` →
   `transcript.message.recorded agent=Ms_Chelly` — a **received** row for a session she has no row
   for. ← **D4**
8. `getUnreadSummary` counts transcript rows. `cello_receive` requires a live session. Permanent.

**The trigger is a first-connect race:** initiating to an agent whose standing receiver has not
finished coming up. The initiator is told "the counterparty may be offline" when it is online.

> **Already documented, half-fixed.** The comment above the F13 guard (`daemon.ts:3183-3188`) states
> D2 outright: *"the directory folds an EMPTY counterparty endpoint into the FROST-signed
> assignment."* Whoever wrote F13 fixed the initiator and left the directory and the receiver alone.

---

## 3. Anchors

**cello-client**
| what | anchor |
| :-- | :-- |
| Responder's silent abort | `core/daemon/src/session-ceremony.ts:63-67` (`if (!sr) { warn; return; }`) |
| Initiator's F13 guard (correct — the model to mirror) | `core/daemon/src/daemon.ts:3189-3199` |
| Receiver's parse — **never reads `counterparty_session_peer_id` (0 occurrences)** | `core/daemon/src/daemon.ts:4426-4505` (`extractInboundSessionAssignment`) |
| Receiver's accept | `core/daemon/src/daemon.ts:4601` (`session.inbound.accepted`) |
| Inbound frame entry | `core/daemon/src/daemon.ts:4658` (`const parsed = extractInboundSessionAssignment(frame)`) |
| Unread producer | `core/daemon/src/session-node-manager.ts:837` (`getUnreadSummary`) |
| Unread consumer | `core/daemon/src/daemon.ts:5800` (`sessionNodeManager.getUnreadSummary(agent)`) |

**trustless-cello**
| what | anchor |
| :-- | :-- |
| The 2 s wait + "proceed with empty defaults" | `packages/directory/src/directory-node.ts:3355-3400` |
| Field omitted when empty (5-field TBS) | `packages/directory/src/directory-frames.ts:152-153` |
| `transport_mode` omitted unless BOTH endpoints present | `packages/directory/src/directory-frames.ts:161-163` |

**Why D3 is possible at all:** the directory *omits* `counterparty_session_peer_id` when it is empty,
and omits `transport_mode` unless both endpoints exist. So the receiver's copy of the assignment is
missing both fields. **It already has everything it needs to know that nobody accepted.** It simply
never looks.

**Why refusing is safe (not a compat break):** an assignment with no counterparty endpoint describes a
session that is unusable *by construction* — the initiator has no address to dial. Nothing legitimate
is lost by refusing it. The directory comment mentions "a pre-M7 client", but a pre-M7 client cannot
receive `session_assignment` over this path at all.

---

## 4. The fixes

### D3 — `DOD-INBOUND-GUARD-1` (do this first)
*Mirror the initiator's F13 guard on the receive side.*

- **AC1** `extractInboundSessionAssignment` surfaces `counterpartySessionPeerId: string | null` (read
  it from the frame; absent → `null`).
- **AC2** The inbound handler refuses an assignment whose `counterpartySessionPeerId` is null/empty:
  **no session node, no DB row, no accept, no away response.** It logs
  `session.inbound.assignment.incomplete` at **warn**, with `{ agentName, sessionId, correlationId }`.
- **AC3** No `session.inbound.accepted` is emitted for such an assignment, and
  `cello_await_session` never surfaces it.
- **AC4** A **complete** assignment is unaffected — every existing inbound test stays green.
- **SI** The refusal is loud, never silent. An operator reading the log can tell a refused assignment
  from a dropped frame.

**Test (red first).** Extend the existing harness in
`core/daemon/src/__tests__/moniker-2-inbound-offer.test.ts` (or `seam-2-inbound-session.test.ts` — both
inject `session_assignment` frames). **Never write a new fixture from scratch.**
Its `assignmentFrame()` builder already omits `counterparty_session_peer_id` — that is exactly the
broken frame. Assert: no `session.inbound.accepted`, a `session.inbound.assignment.incomplete` warn,
and `cello_await_session` times out.
⚠️ **Existing tests inject frames WITHOUT `counterparty_session_peer_id` and expect acceptance.** They
encode the buggy behaviour. Add the field to those frames so they keep testing what they mean to test;
that change *is* part of this unit and must be called out in the commit message.

### D1 — `DOD-OFFER-REJECT-1`
*The responder must answer, not vanish.*

- **AC1** On `standing_receiver_unavailable` (and on `no_session_id`), `wireSessionOfferHandler` sends
  a `session_offer_reject` frame `{ type, session_id, reason }` instead of returning silently.
- **AC2** The directory resolves its waiter on `session_offer_reject` and stops waiting immediately —
  no 2 s stall.
- **AC3** `session.offer.abort` is still logged, with the same reason.
- **Note** This is the `Generic Reject` from [[2026-07-08_inbound-state-matrix]] §"Response Type",
  arriving as a protocol necessity rather than a UX nicety. Wire it as that frame if the shapes agree.
- **Cross-repo:** the frame must be accepted by the directory (`directory-node.ts` dispatch loop) —
  the daemon half can ship first and is inert until the directory understands it.

### D2 — `DOD-DIR-FAILCLOSED-1` (correct root fix; expensive)
*The directory must never sign an assignment it knows is incomplete.*

- **AC1** When the offer-accept wait times out (or a `session_offer_reject` arrives), the directory
  **does not build, sign, or distribute an assignment**. It returns a `session_request` failure to the
  initiator with a distinguishable reason (`counterparty_did_not_accept`), and **sends nothing to the
  target**.
- **AC2** No FROST signature is ever produced over a 5-field (endpoint-less) TBS on this path.
- **AC3** Observability: `session.request.counterparty_no_accept` at warn with
  `{ sessionId, initiatorPubkey, targetPubkey, waitedMs, correlationId }`.
- **AC4** The 2 000 ms constant becomes a named constant with a comment; **do not simply raise it** —
  a longer window narrows the race without closing it.
- **Deploy:** `infra/` — directory deploys take ~25–30 min across us-east-1 / eu-central-1 /
  ap-northeast-1. **Batch this with any other pending directory change.** Update `infra/STATE.md`.

### D4 — `DOD-UNREAD-1` — **DECIDED 2026-07-10 (Andre): option (a), producer-first**
*A received transcript row with no session row is unattributable, unreadable, and permanently unread.*

**Option (b) — materialise the session on recovery — is REJECTED.** Evidence
(`session-node-manager.ts:2739-2747`):

```js
let senderPubkey = entry?.counterpartyPubkey
  ?? this.getSessionRecord(agentName, sessionId)?.counterparty_pubkey;
if (!senderPubkey) {
  this.#logger.warn("session.content.sender_unresolved", { sessionId, agentName, correlationId });
  senderPubkey = "unknown";                       // ← papers it in, right below a comment saying it won't
}
```

and `transcript` has **no counterparty column** — `(agent_name, session_id, sequence, direction, blob,
created_at)`. The daemon recorded a received message **it could not attribute to anyone**, and the
attribution is gone for good. `session.content.sender_unresolved` fired on BOTH stuck sessions.

So (b) would invent a session the initiator explicitly refused via the F13 guard, **with no
counterparty** — the same disease as the directory's "proceed with empty defaults", one layer down.

#### D4a — producer (primary)
- **AC1** Refuse to write a `transcript` row for a session with **no `sessions` row for that agent**.
- **AC2** Log `session.content.orphaned` at **warn** with `{ agentName, sessionId, correlationId }`.
- **AC3** Either drop, or quarantine visibly (as `expiredSessionRequests` surfaces missed requests via
  `cello_check_notifications`). Implementer's call — but a quarantine MUST be visible, never silent.
- **AC4** `senderPubkey = "unknown"` is never written to a transcript row. **Never record content you
  cannot attribute.**
- **SI** After D3 this path should be unreachable. That makes it a fail-loud assertion exactly where one
  belongs.

#### D4b — reader (for installs that already carry these rows)
- **AC1** `cello_receive` **with `since_seq`** works without a `sessions` row: it already reads the
  durable transcript, advances `advanceLastDeliveredSeq`, and clears the Telegram ring — it never touches
  a session node. It needs `record` for exactly one field (`counterparty_pubkey`), and only the early
  `if (!record) return session_not_found` blocks it.
- **AC2** `from` is reported as `null`, **never the string `"unknown"`**.
- **AC3** The plain (no `since_seq`) live-receive path is unchanged: a transcript-only session has no
  live node to wait on. It returns a distinct reason (e.g. `session_not_live`) with guidance pointing at
  the catch-up read — **never `session_not_found`, which is a lie.**

#### Acceptance (D4)
`cello_check_notifications` for `Ms_Chelly` returns `total_unread: 0` **only after the two messages have
actually been delivered to a reader** — never by hiding them. The two real ids are
`5749859a8380d55f98fdd4436ca7ee1d` and `3d3311c867e96ff88803dce3deaf27b7`; they live on Andre's machine.
**Prove it in a test — do not poke the live daemon.**

> **⚠️ D4a's DROP is safe BECAUSE of the relay TTL — do not "optimize" the re-pull away (2026-07-10,
> D4 verification).** A refused (orphaned) parked entry is never confirm-deleted, so it is re-pulled
> and loudly refused on every reconnect. That retry is **bounded**: `relay-node.ts:1374` TTL-sweeps
> parked entries (`CONTENT_STORE_TTL_MS`) whether or not the recipient reconnects — an orphan re-pulls
> until TTL, then is reclaimed. Anyone tempted to stop the repeated warn by **confirm-deleting on
> refusal** would turn a bounded retry into **silent data loss** (the parked copy is the only
> redelivery source). Dedupe the log if the spam ever matters — never the retention.

---

## 4b. THE INVARIANT (hold this in review)

> **`getUnreadSummary` and `cello_receive` must agree on what a session is.**
> One counts `transcript` rows; the other requires a `sessions` row. **Any fix that leaves those two
> authorities disagreeing recreates this bug in a new shape.**

This is the defect underneath all four. It is also exactly why `JOIN sessions` is forbidden: it makes the
two authorities agree by **deleting the evidence**, rather than by fixing the producer that created the
disagreement.

---

## 5. Ordering, gates, and verification

1. **D3** — daemon-only, no deploy. Ship and verify live.
2. **D1** (daemon half) — inert until D2 lands. Safe to ship together with D3.
3. **D4** — after Andre picks (a) or (b).
4. **D2** — directory; batch with other pending directory work; redeploy 3 regions; update `infra/STATE.md`.

**Gate (in order, every unit):**
```bash
pnpm run test && pnpm run lint && pnpm run typecheck && pnpm run build
```
then the `cello-unit-reviewer` agent, then commit with the DOD id.

## ✅ CLOSED 2026-07-10 — all four live-proven (journal Entry 86)

**THE STANDING REPRO — use this, do not wait for the race.** `cello_stop_agent` tears down an agent's
standing receiver and **leaves its directory signaling stream connected**. That is exactly D2's
precondition, on demand, in one tool call:

```
cello_stop_agent { name: "CELLO_Feedback" }        # receiver down, signaling up
cello_initiate_session { target_pubkey: <feedback> }
  → { ok: false, reason: "counterparty_did_not_accept" }     # NOT directory_unreachable
cello_start_agent { name: "CELLO_Feedback" }       # positive control
cello_initiate_session { target_pubkey: <feedback> }
  → { ok: true, ... }   # a fix that refused EVERYTHING would pass the negative test
```

Daemon log, same second — no 2 s stall, because the directory resolves its waiter on D1's frame:
```
session.offer.abort        agent=CELLO_Feedback  reason=standing_receiver_unavailable
session.offer.reject.sent  agent=CELLO_Feedback  reason=standing_receiver_unavailable
```

**The absence is the evidence.** No `session.initiate.counterparty_unavailable` (F13 never had to fire —
there was no endpoint-less assignment to refuse), no `session.inbound.accepted` (no phantom session), no
away-reply, no orphan row, no permanent unread.

> **D3 contains the damage; D2 prevents it.** The guards downstream did not save us — **the directory
> stopped minting the thing.** Both belong here; only one is the root fix. (CELLO_Support, 2026-07-10)

> **Both of us wrote this race off as unforceable, twice.** It was one tool call away. "We could not
> reproduce it" is what let the bug live for three days.

---

**Live acceptance test — reproduce the race deliberately.** The trigger is a `session_offer` arriving
before the target's standing receiver exists.

- *Deterministic:* drive the daemon's inbound path with an assignment frame that has **no**
  `counterparty_session_peer_id` (exactly what `assignmentFrame()` already builds) and assert the
  receiver refuses it.
- *Live:* stop an agent, initiate to it, and start it during the window — or watch for
  `session.offer.abort reason=standing_receiver_unavailable` in `~/.cello/daemon.log`.

**Post-fix, the invariant to check in the log:**
```
count(session.offer.abort) > 0  AND  count(session.inbound.accepted for those session ids) == 0
```
Before the fix that count was `2 and 2`. After, it must be `N and 0`.

⚠️ **Filter the log on daemon start time.** `~/.cello/daemon.log` still contains the *pre-fix* events
for these two sessions. Reading it unfiltered will make a passing fix look like a failure. (This
exact mistake was made twice during the `DOD-MONIKER-6` live run — journal Entry 76.)

---

## 6. What NOT to do

- **Do not add `JOIN sessions` to `getUnreadSummary`.** It would hide a message that was genuinely
  delivered. Cosmetic fix over a real defect.
- **Do not change the initiator's F13 guard** (`daemon.ts:3189`). It is correct: refusing an
  endpoint-less assignment is the right call. It is the *only* part of this chain that behaves.
- **Do not just raise the directory's 2 s timeout.** It narrows the race; it does not close it. The
  bug is that a timeout produces a *signed artifact* rather than a *failure*.
- **Do not make the receiver's refusal silent.** A silent refusal trades one invisible failure for
  another.

---

## 7. Triage

The trigger is *connecting to an agent that just started* — a first-connect race, and the launch
pitch is "two agents connect." The initiator is told the counterparty may be offline **when it is
online**, and the counterparty answers into a void. It is not a papercut, but nor is it a data-loss
bug: the reply survives in the transcript and D4(a) recovers it.

**D3 is small, local, and removes the phantom session.** Do that regardless of when D2 is scheduled.

## Related Documents
- [[M8C-DEFINITION-OF-DONE]] — where `DOD-INBOUND-GUARD-1` / `DOD-OFFER-REJECT-1` / `DOD-UNREAD-1` / `DOD-DIR-FAILCLOSED-1` are tracked
- [[2026-07-08_inbound-state-matrix]] — D1's `Generic Reject` is that document's response type
- [[M8C-BUILD-JOURNAL]] — Entry 76 records the log-filtering trap referenced in §5
- [[M8C-PROCEDURE]] — the per-unit loop and gate sequence
