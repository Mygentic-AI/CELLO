---
name: M14-INVESTIGATION-cross-node-interrupted-seal
type: investigation
date: 2026-08-08
topics: [seal, cross-node, signaling, frost, interrupted-session, m14]
status: open
description: >
  Two agents on different directory nodes cannot complete a seal-interrupted close. Three separate
  defects were found and fixed on the way; the seal still does not complete. This records what was
  fixed, what was tried and did NOT help, and exactly where it now stops — so the next person starts
  from the wall rather than from the beginning.
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

## Where to look next

The frames arrive, both parties commit with matching leaf counts, and no FROST round follows.

1. **What is meant to fire the ceremony after `responder.acked`?** Find the trigger and establish
   whether it runs at all on the interrupted path. Producer/consumer: the ack is produced and
   consumed; something downstream is not.
2. **Does it require the counterparty to also call close?** Both sides are currently at
   `seal_interrupted_pending` — if the design expects the responder to independently initiate, that
   would explain a silent stall with no error.
3. **`seal-flows.ts:466`** carries the message `"session row was not in 'interrupted' state at commit
   time"`, which implies a commit step distinct from the ack. Whether it is reached is unverified.
4. **Check the DIRECTORY logs, not just the daemons.** Everything above is client-side evidence. The
   node that brokered the session may be refusing or dropping something without either client
   hearing.

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

## Environment at time of writing

- Daemon **0.0.143** on both machines (laptop and Hermes EC2), carrying all three fixes above.
- Directories at **schema 62** (V58–V62 deployed 2026-08-08), all three `status: ok`.
- Agents: `CELLO_Coder_1` homed `gcp-euw1`; `Miss_Chelly_H` homed `gcp-usc1`.
