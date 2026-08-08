---
name: M14-INVESTIGATION-cross-node-interrupted-seal
type: investigation
date: 2026-08-08
topics: [seal, cross-node, signaling, frost, interrupted-session, m14]
status: root-caused
description: >
  Two agents on different directory nodes could not complete a seal-interrupted close. Three
  defects were found and fixed, and the exchange now works. The seal still does not complete —
  and the reason is that the interrupted close has never asked anyone to notarize it, on any
  topology. This records the three fixes, the root cause, and what the remaining decision is.
---

# Cross-node interrupted seal — still open after three fixes

## The symptom, from the operator's chair

You had a conversation with someone whose agent runs on another machine. It was interrupted before
it sealed. You ask to close it. You wait, and you are told the other side is unreachable. They ask
to close it, wait, and are told the same about you. Both of you are online the whole time.

The conversation is stranded: not closed, not sealed, no receipt. The only escape was force-closing,
which destroys your half of a receipt that may exist on theirs.

**Two of those three symptoms are now fixed.** The exchange happens. The seal still does not.

## Current state — where it stops

Closing a stranded cross-node session now returns:

```
{"ok":true,"sessionId":"8885c86721...","status":"seal_interrupted_pending"}
```

Both daemons reach bilateral commitment and stop:

| side | event | leafCount |
|---|---|---|
| Miss_Chelly_H (responder, `gcp-usc1`) | `session.interrupted.responder.acked` | 2 |
| CELLO_Coder_1 (initiator, `gcp-euw1`) | `session.interrupted.pending` | 2 |

**Both agree on the leaf count. Neither logs an error. Nothing follows.**

And critically:

```sql
SELECT * FROM seal_notarizations WHERE encode(session_id,'hex') = '8885c867…';
-- 0 rows, on all three nodes
```

**No notarization exists.** The ceremony is not producing a seal, and the failure is SILENT — not a
refusal, not a timeout with a reason, just nothing after the ack.

## What this rules out, and why that matters

**It is NOT `DOD-TERMINAL-STATE-DIVERGENCE-1` / V58.** That defect is "the notarization IS durable
and the closing side is never told" — it would leave a `seal_notarizations` row behind. There is no
row. V58 is deployed (schema 62 on all three nodes as of 2026-08-08) and does not change this.

That distinction is the single most useful thing in this document. Anyone arriving at
`seal_interrupted_pending` will reasonably assume it is the terminal-state defect. Check for the
notarization row first; if it is absent, this is a different problem.

## Fixed on the way — three defects, none of which was sufficient

All three were real, all three are shipped, and none of them made the seal complete. Recorded
because each one *looked* like the answer at the time.

### 1. The interrupted branch never dialled the broker (daemon 0.0.140)

A directory routes a signaling frame by looking up a stream **it** holds. A daemon holds its stream
to its own home node, so a frame for a counterparty homed elsewhere finds nothing — the node logs
`target_offline` at INFO and **returns nothing at all**, and the sender times out.

Cross-node reach is achieved by the CLIENT dialling the far node; directories never forward to each
other (`M12-BUILD-JOURNAL`: "directory→directory forwarding — new cross-node channel, does not
exist"). `close-session-handler.ts` already did this for ACTIVE sessions, with a comment naming this
exact failure — gated on `record.status === "active"`. The interrupted branch sent the same frames
with no dial.

**Not a regression.** That code is dated 2026-06-15 and untouched since. What changed is agents
actually landing on different nodes; every earlier test put both agents on one machine.

### 2. The broker map does not survive the restart that creates the condition (0.0.141)

`crossNodeBrokerBySession` is an in-memory Map populated while a session is brokered. A daemon
restart empties it — and a daemon restart is what flips a live session to `interrupted`. So on the
interrupted path the map is essentially always empty and the dial from fix 1 never fired.

Replaced with a discovery lookup for the counterparty's CURRENT home node (presence is replicated,
so any directory can answer), classified by the same `classifyOnlineResult` the outbound path uses.

**Persisting the broker would have been the wrong fix** — the node that brokered the session hours
ago need not be where the counterparty lives now.

**A first attempt at this made things worse and was reverted:** running the lookup BEFORE the seal
attempt delayed registration of the seal waiter by up to the lookup timeout, so a bilateral seal
arriving promptly was missed entirely. Caught by the unilateral-escalation suite, whose close
registers a waiter within ~100ms. Discovery is now a REPAIR — the close goes out on the home stream
first, and only `seal_interrupted_counterparty_unavailable` triggers a lookup and one retry.

### 3. Dialling their node is only half of it — the request must be SENT there (0.0.142/0.0.143)

0.0.141 found the counterparty's node and dialled it, then sent the request on the HOME stream
anyway. A visiting connection makes us REACHABLE FROM a node; it does not change where we SEND. The
active seal needs the former (the broker pushes to us); this flow needs the latter.

`handleSealInterruptedFlow` now takes an optional stream to send and await on, and the close handler
passes the visiting connection it opened.

**This one worked.** Proven on both daemons: discovery returned `gcp-usc1`, the dial succeeded, and
their daemon logged `session.interrupted.responder.acked` where previously it logged nothing at all.

## Tried and did NOT help

- **Deploying V58.** Reasonable hypothesis, ruled out by the absent notarization row (above).
- **Restarting both daemons / re-homing.** The state is reproducible across restarts.
- **The two-node e2e (`j-gcp-live`).** Cannot yet reach the interrupted phase — see below. It is not
  a source of signal on this defect today.
- **Waiting.** Both sides sit at `seal_interrupted_pending` indefinitely; nothing retries.

## Test-harness defects found while trying to reproduce this

Worth knowing before trusting a green run — all three are fixed, but they explain why this was
invisible for so long.

1. **The interrupted phase could not execute.** `j-gcp-live` asserts the ACTIVE seal inline, and
   that assertion is a known-red guard for a different defect. The run aborted there, so the
   interrupted phase added for this investigation never ran. One red guard silently prevented an
   unrelated guard from reporting.
2. **The send assertion hid its own reason.** `expected false to be true`, while the daemon had
   already filled in `reason` and `guidance`. Cost a full 14-minute re-run.
3. **The send is refused while unread messages exist.** `session_not_current` — "you are blocked
   from replying to something you haven't read". A retry of the SEND ALONE could never clear it; the
   loop now drains first. This looked exactly like a flake (two of three runs died there) and was a
   rule working correctly.

**Every test in both repos puts both agents on ONE machine**, hence one directory — the single
arrangement in which this whole class of defect cannot occur. That is why a green suite meant
nothing here.

## Root cause — nothing was ever going to fire

**Nothing fires the ceremony after the ack, because the interrupted close never asks for one.**

There is exactly one thing in the system that causes a notarization: a daemon posts a SEAL control
leaf to the **relay**; when both sides have posted, the relay hands the chain to a directory, which
verifies it and runs the FROST round. Three places do that — the close of an ACTIVE session, the
auto-close that fires when an away agent answers a one-shot, and one repair branch that kicks in
when the counterparty says it is already mid-relay-seal.

The interrupted close is not one of them. It exchanges signed leaves directly with the counterparty
over the directory's signaling channel, writes both halves down, sets both sides to
`seal_interrupted_pending`, and returns. The directory only relays those frames between the two
daemons — it reads nothing out of them and starts nothing on the back of them. No relay leaf is
posted, so no ceremony is ever requested.

So the silence is not a stall or a dropped frame. **There is no producer**, and the code says so
about itself: the flow carries a scope note stating that it deliberately stops at the bilateral
commitment because the daemon cannot notarize alone, and that finishing it means wiring in a seal
adapter that was never wired.

### Taking the four "where to look next" questions in order

1. **What fires the ceremony?** Nothing does. Answered above.
2. **Does it need the counterparty to close too?** No, and it would not help. Both sides are already
   at `seal_interrupted_pending`, and a close on that status is refused outright — the handler only
   seals from `active` or `interrupted`.
3. **The "not in 'interrupted' state at commit time" message.** That is the persist step, and it
   succeeded — it is what moved both rows to pending. It is not a separate missing commit.
4. **The directory logs.** Nothing is being refused or dropped there. The directory's only role in
   this flow is to forward three frame types, which it did.

### This is not a cross-node defect

The three fixes above are real and cross-node, and they are what made the exchange work. The missing
notarization is not: put both agents on one machine and one node and the outcome is identical.

The same-node end-to-end test drives this exact flow today and **passes** — it accepts
`seal_interrupted_pending` as a valid ending and checks only that the responder acked. Its own
comment describes the result as "the commitment that the directory FROST-notarizes", which the test
never checks and the code never does. That is why this looked like a cross-node problem: the only
suite covering it was written around the same missing step.

The vault already records the same fact from the other direction — the launch-triage note lists
`seal_interrupted_pending` among the statuses that are **not** notarized, against an inbox that
labels them sealed.

## What this means for the operator

An interrupted conversation closes to a real, mutually signed record: both sides sign the same
message count, each verifies the other's signature, and both store it. What it does not produce is
the notarized receipt — the third-party proof. Two of the three symptoms in this note are fixed; the
third was never implemented.

Two things currently tell the operator otherwise, and both should change whichever way the decision
below goes: closing an already-pending session says it is "awaiting FROST notarization", and the
inbox files these sessions under sealed.

## The decision — yours

**Option A — leave it as the ending.** Treat the mutually signed commitment as what an interrupted
session gets, and fix the two places that promise a notarization. No protocol work. The cost is that
a conversation interrupted by a restart yields a weaker receipt than one closed cleanly, forever.

**Option B — finish the ceremony.** Post the seal leaf to the relay from the interrupted path too.
The groundwork exists: the relay submit already tolerates a session with no live node in memory,
rebuilding a connection from the stored relay endpoint, and the repair branch mentioned above
already drives it this way. What is unproven is whether the relay still holds the session hours
later, or whether it has been swept — if it has, this needs a new directory-side route that
notarizes from the two stored signed leaves, which is new protocol surface.

### Checked 2026-08-08 07:30Z — the relay still holds all three

Expected to be gone; they are not.

- **The relay never saw this flow at all.** Every log line these three sessions produced in the last
  two days is the directory forwarding frames between the two daemons. Not one relay event. That is
  the root cause above, confirmed from the running system rather than from the source.
- **All three still have a live relay session.** The relay holding them has not restarted since
  2026-08-05 (its session store is in memory, so a restart would have emptied it), it currently
  holds 14 sessions, and none of our three appear in its swept list. It was still sending frames
  about two of them at 06:57Z today.
- **Each one still has its relay address stored locally**, pointing at the same relay that sealed
  three other cross-node sessions with the same counterparty that morning without trouble.

So the cheap version of Option B is available — the machinery is all still connected — but not for
long. The relay drops a session after 24 hours idle, checked on the hour. Best estimate: the
4-message session goes at about **09:01Z**, the other two at about **12:01Z**. That is inferred from
when each was interrupted; the one session available to calibrate against was dropped three minutes
after its own 24-hour mark, so the estimate is close but not exact.

### The control that makes this unambiguous

Three cross-node sessions with the SAME counterparty over the SAME relay **sealed normally** that
same morning — 06:43Z, 06:44Z and 06:57Z — with notarized roots stored. Cross-node sealing works.
The variable is not which node each agent is on; it is whether the session was interrupted.

## Reproduction

Two agents on different directory nodes, a session interrupted by a daemon restart, then
`cello close-session <id>` from either side. Three sessions are currently in this state and
deliberately untouched:

| session | messages |
|---|---|
| `9bc456f67fc506e03ae01500902a16af` | 4 |
| `faafbd01254a75f76272595606195163` | 5 |
| `8885c8672192cbf2e124c306e4f9a23b` | 2 (already attempted, now `seal_interrupted_pending`) |

**Do not force-close them.** Force is terminal and destroys this side's half of a receipt that may
exist on the counterparty's. They are the only live reproduction available.

## References for the root cause

All in `cello-client` unless noted.

- Scope note stating the flow does not notarize: `core/daemon/src/seal-flows.ts:135–145`.
- The interrupted close branch that returns after the exchange: `core/daemon/src/close-session-handler.ts:418–465`.
- The responder acking and stopping: `core/daemon/src/inbound-seal-request.ts:213–247`.
- The only notarizing call, and its three callers: `submitSealLeaf` in
  `core/daemon/src/session-node-manager.ts:3935`, called from `close-session-handler.ts:498`
  (active), `daemon.ts:1081` (away one-shot), `seal-flows.ts:399` (relay-bilateral realignment).
- The detached relay path that already tolerates an interrupted session:
  `core/daemon/src/session-node-manager.ts:296–341`.
- Close on a pending session refused: `core/daemon/src/close-session-handler.ts:354` and the
  final fall-through claiming "awaiting FROST notarization".
- Directory as pure pass-through: `packages/directory/src/directory-node.ts:2509–2560` in
  `trustless-cello`.
- Same-node e2e accepting the pending state as a pass:
  `packages/e2e-tests/src/spine/j-int.spine.test.ts:246–253` in `trustless-cello`.
- Prior record of the same fact: `docs/planning/launch-triage.md:81–83`.

## Environment at time of writing

- Daemon **0.0.143** on both machines (laptop and Hermes EC2), carrying all three fixes above.
- The root cause above was read against a **newer** tree than that — daemon 0.0.145 (unpublished;
  published latest is 0.0.144), CLI 0.0.152. The last three commits touching any file on this path
  are the three fixes themselves, so the finding holds identically on 0.0.143, 0.0.144 and 0.0.145.
  Nothing shipped since changes it.
- Directories at **schema 62** (V58–V62 deployed 2026-08-08), all three `status: ok`.
- Agents: `CELLO_Coder_1` homed `gcp-euw1`; `Miss_Chelly_H` homed `gcp-usc1`.
