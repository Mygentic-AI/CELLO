---
name: two-sessions-one-agent-co-attendance
type: discussion
date: 2026-07-31
topics: [co-attendance, multi-session, agent-identity, read-before-write, message-delivery, relay-ordering, seal-integrity, content-dedup, daemon]
description: >
  Two sessions on one agent silently steal each other's messages, because a multicast doorbell feeds a
  destructive single-consumer queue. Decision: co-attendance, not exclusivity. Also settles that the relay
  is a true sequencer, and traces two receipt-integrity defects found on the way — one fixed, one open.
---

# Two sessions, one agent

**Status: design decided (co-attendance). Two implementation defects proven and unfixed. One
receipt-integrity question OPEN and gating a conclusion below — see §7.**

## 1. The symptom

Two Claude sessions drive the same agent on the same daemon. A message arrives. One session gets it;
the other is told nothing arrived. Neither is told the other exists.

This was logged once before, incidentally, and left open:
[[2026-07-29_1730_coworker-session-scoped-mcp-calls-fail]] closes with *"Two sessions silently shared
one agent identity and neither side was warned."* No work item was ever raised from it. This is that
work item.

## 2. Root cause — a multicast wake-up feeding a single-consumer queue

Three mechanisms, individually reasonable:

1. **Attachment is unrestricted and uncounted.** `cello_use_agent` checks the agent exists and that
   *this* connection doesn't already hold it. It never looks at any other connection. `isAttended()`
   returns a boolean on first match — the daemon deliberately never counts.
2. **The doorbell is multicast.** `dispatchCelloMessage` loops every connection and pushes to each one
   where that agent is current. One message, N wake-ups.
3. **The content queue is destructive and single-consumer.** `#receivedContent` is keyed
   `(agentName, sessionId)` — not by connection. `takeReceivedContent` is `buf.shift()`.

Both sessions are woken. Both enter the poll loop (20 ms tick). Whichever hits the next tick first
gets the message and **removes** it.

**The loser's answer is indistinguishable from silence:**
`{ ok: true, content: null, guidance: "No content arrived within timeout_ms…" }` — identical to a
quiet counterparty. **The plain blocking receive logs nothing at all**, on either outcome, so the
theft leaves no trace anywhere.

### 2b. And then it replies blind

The send gate is `connectionCursor >= currentSeq || unreadReceived === 0`. The winner's read calls
`advanceLastDeliveredSeq`, which is **agent-scoped** — so `unreadReceived` drops to zero for *both*
sessions and the loser's reply is permitted although it never saw the message.

That is `DOD-CURSOR-DURABLE-1` behaving exactly as its own §6 predicted: *"Window 2 can reply
context-blind to something it never saw."* The trade was made deliberately, to unblock stateless
clients. It is the right call for that problem and the wrong shape for this one.

Note `launch-triage.md` lists the reply guard under **"Already solid — confirmed working"**. That
rests on `DOD-CURSOR-1`, whose own DoD text says the two-window scenario was never run. **That line
needs correcting.**

## 3. The decision — co-attendance, not exclusivity

**Rejected: one session per agent.** Reasons, in order of weight:

- **It is not the simple option, it only sounds like one.** Connections die constantly — daemon
  restart, MCP reconnect, laptop sleep (the daemon bounced twice during this very discussion). Every
  one either strands the agent behind a dead claim or needs a takeover protocol. The hard part isn't
  skipped, it's relocated.
- **It buys no cryptographic property.** The seal attests the *identity*, not the seat —
  `attestation_mode: "live"` says a live counterparty authored the messages, not which client did.
  Exclusivity is local hygiene, not a trust guarantee.
- **It fixes the wrong half.** The command-line path has no live connection to key exclusivity on;
  its identity is a file (§6). Daemon-side exclusivity leaves that untouched.
- **It forecloses listener mode** — several sessions watching one agent's conversation live. Free
  under co-attendance, needs a second mechanism invented under exclusivity.

**Chosen: co-attendance.** Its mechanism subsumes exclusivity (which becomes a flag on top), and the
turn-taking that looks hairy is the existing guard working properly rather than a new state machine:
`currentSeq` counts every leaf including sends, so A's reply raises the bar, B is refused, B reads,
B sees A already answered, B decides. No global barrier — a stale session blocks only itself.

### 3b. What co-attendance requires that we did not have

**Catch-up must include your own side's messages.** Receiving only ever returns the *counterparty's*
messages. A sibling session's reply is in the record but never delivered through that path. So the
second session reads the counterparty's message, is still one short of the bar, asks again, gets
nothing, and is stuck — it can never clear the bar that way.

That is the same shape as the bug that stopped command-line sessions replying: a rule satisfiable
only through a door the caller isn't pointed at. It would hit the second session **every time a
sibling replies first**, which is the common case. Catching up has to mean *"everything since my
bookmark, whoever wrote it"* — which the second session needs anyway, to decide whether it still has
anything to add.

*(Asserted from reading the code, not tested — see §7.)*

## 4. The send window — a race that makes a strict gate theatre

Between the gate passing and the message being recorded there are **two awaits** — the security
screening (a round trip to the gateway process) and the send itself (relay submission plus
delivery). **The gate is never re-checked after either.**

Two sessions can both be cleared, both wait, and both write. Nothing changes between them: no leaf
has been appended, so the second's check sees exactly what the first saw. The counterparty gets two
replies to one message — both correctly signed and ordered, the record coherent, the conversation
not.

The **inbound** path was hardened against precisely this and says so: *"Adding any further await
between here and the append reopens the window."* The outbound path never got the same treatment.
Fix: re-check in the same synchronous window as the append — the pattern already used twice inbound.

**Tightening the gate without closing this window produces a strict-looking rule the race walks
straight through.** They land together or not at all.

## 5. Settled: the relay IS a true sequencer

Concurrent writes were the main worry about co-attendance. They are covered, by a stronger mechanism
than expected.

On `hash_submit` the relay **ignores the sender's claimed position entirely**: `seq = seq_counter + 1`
from its own counter, `prevRoot = state.running_root` from its own tree, then signs. The sender may
only declare `last_seen_seq`, and claiming to have seen more than exists is rejected outright.

- **Two parties writing at once cannot fork the record.** The relay serializes them.
- **Two sessions on one identity cannot collide at all.** All of an agent's sessions share ONE relay
  stream and submissions on it are strictly one-at-a-time — serialized before reaching the counter.
- **The local record is written after the relay assigns**, deliberately, so a message occupies the
  same position whether it went straight through or sat parked.

So the chain cannot fork from co-attendance. What co-attendance risks is **semantic**: a message
perfectly signed, correctly chained, non-repudiable — and conversationally stale. That is the right
kind of failure to have.

## 6. The command-line selection is one machine-wide file

`~/.cello/current-agent` — present, in use, written by `use-agent`, cleared only by `stop-agent`
naming that agent. Every `cello` process in every terminal shares it.

Not a security problem (an agent name, and the ENOENT-only catch is deliberately careful). It is a
**shared-state** problem, and it carries no liveness: nothing ever writes "I'm finished," so a crash
leaves it stale. That is fine for a *preference* — "the last agent you chose" is still a good default
after a crash — and it is why exclusivity must never live in a file. **A file cannot carry a liveness
claim, because no process is alive to retract it.** Only the daemon has that signal.

**The receptionist writes it.** `cello-receptionist.md` runs `cello use-agent "$AGENT_NAME"` then
polls `cello inbox --scope current` every 10 s, each poll a fresh process re-reading the global file.
**Two receptionists for two agents will fight over it** — whichever ran `use-agent` last owns it, and
both then report on that agent. Their own guard comment names the symptom (*"announcing another
agent's callers as if they were this one's"*) and guards the wrong cause: it catches an empty name at
startup, never a concurrent overwrite mid-loop.

Fix: `cello inbox --agent "$NAME" --scope current`, and stop writing the shared file. The receptionist
*skill* already tells its operator to pass the agent explicitly "which another session or an MCP
reconnect can change underneath you." The subagent doesn't follow its own advice.

**Weighting, recorded deliberately:** the receptionist is a last-resort workaround for harnesses with
no event injection and no long-polling (Cowork can schedule at most hourly, and has no hooks). Andre
wants **as few users as possible** depending on it. It gets the two-line fix and nothing is built on
top of it. It does not get a vote on the architecture.

## 7. Found on the way — receipt integrity

Investigating ordering turned up two defects that are **independent of the co-attendance decision**
and outrank it on the "would this ruin a customer" test.

### 7a. Position drift — loopback only, deterministic, benign so far

The branch that fires when the relay says a message belongs at a position the local record has passed
— its own comment says the invariant "is at risk" — **has fired 32 times in the live log**, always off
by exactly one, sometimes on every message of a conversation.

**Cause, proven.** The session's **first** message is sent before the relay has registered the
session; the submission is rejected `session_not_found`; the daemon records the message anyway
(deliberate — losing content is worse than a mis-order); the relay's counter therefore never counts
it, and the local record stays exactly one ahead **for the life of the conversation**.

| group | sessions | drifted |
|---|---|---|
| Same-machine, no failed submission | 91 | **0** |
| Same-machine, failed submission, conversation continued | 16 | **16** |
| Same-machine, failed submission, ended after one message | 10 | 0 |
| Remote counterparty | 24 | **0** |

Not a rate — 100% of "first message beat the relay and the conversation carried on." The ten that
stopped after one message never drifted because nothing came after to be misplaced. Same-machine only
because local delivery is instant while relay registration is a round trip to another region; a
remote counterparty cannot win that race.

Seal rate is unaffected: 75% with the drift, 72% without.

### 7b. The lost receipts — identical content, deduplicated on one side only

Two conversations were **force-abandoned with no receipt**, rejected repeatedly with the two sides
disagreeing on how many messages exist. Operator text: *"The two sides have divergent session
histories and cannot form a bilateral commitment."*

**Cause, proven.** The away autoresponder fired twice with **identical text**. The sender appended it;
the receiver hashed it, found that hash already at position 0, concluded redelivery, and **did not
append**. One side three leaves, the other two — diverged permanently, every later message at a
different position on each side.

The rule it breaks is stated as design intent: **"a content_hash satisfies AT MOST ONE Merkle leaf,
exactly once."** That is false whenever two genuinely distinct messages match.

**Believed fixed.** Last occurrence 23 July; `DOD-INBOX-ONESHOT-1` (23–24 July) makes the second reply
a *different* rejection text and closes the session, so the greeting can't repeat. Evidence is
consistent, not conclusive: two clean conversations since, and the pre-fix population also contains
clean cases.

**What was closed is a producer, not the check.** Duplicate detection still matches on content alone,
and the check **spans both parties' messages** — so any two identical messages by either side collide.
Andre's point: two instances of the same model, same incoming message, similar context, make an
identical reply far likelier than the human baseline, and the wrap/over convention encourages exactly
the terse turns most likely to match byte-for-byte. Zero observed instances; the failure is silent,
destroys a receipt, and gets likelier precisely as same-model agent-to-agent grows — which is the
wedge.

**The discriminator already exists.** The relay assigns every submission a unique position.
Redelivery carries the *same* position; a genuinely new identical message carries a *new* one. Key
the rule on position, not content. Every legitimate case in the log (all park-recovery after a
liveness drop) carries the original position and would still be caught. Scope note: the map from
content hash to canonical position is *also* hash-keyed, so it's one assumption in at least two
places.

### 7c. 🔴 OPEN — and it gates a conclusion above

**Nine conversations had divergent records. Only two failed to seal.** The other seven were notarized.
Both failures came through the interrupted-close path, which explicitly compares leaf counts; the
seven closed with both parties live.

I stated that the receipt survives when both parties are present. **That claim rests on not knowing
why those seven passed.** Either the divergence model is wrong for them, or the both-parties-present
path does not catch what the interrupted path does. Both possibilities matter, and the second is
worse.

What is established: the bilateral check compares **the two parties' roots to each other**, never
against the relay's record; the unilateral rebuild uses **only relay-witnessed leaves**, so an
unwitnessed message makes it short. What is not established is why divergent records passed the
bilateral comparison.

**Do not act on the "receipts are safe when both parties are present" conclusion until this is
closed.**

## 8. What changes for the operator

1. A message can no longer be taken by the wrong session — delivery reads a durable record against a
   per-session bookmark instead of popping a shared queue.
2. Silence stops being ambiguous — "nothing arrived" and "another session took it" become different
   answers.
3. You find out when you're not alone — attach, status, and the arrival alert all carry the count.
4. Receiving leaves a trace in the log; today it writes nothing on either outcome.
5. Catching up shows everything since your bookmark, whoever wrote it (§3b).
6. Before any session may reply it must have caught up on everything since it last looked, including
   a sibling's reply — and the re-check happens in the same step as the write (§4).
7. The receptionist stops re-pointing other terminals (§6).
8. `launch-triage.md`'s "reply guard confirmed working" line is corrected (§2b).

## 9. Open items

| # | Item | Status |
|---|---|---|
| 1 | Why seven divergent conversations sealed anyway (§7c) | 🔴 **OPEN — gates §7's conclusion** |
| 2 | Catch-up deadlock across a sibling's reply (§3b) | Read from code, **not tested** |
| 3 | Whether `--scope current` honours an explicit `--agent` | Unchecked, five minutes |
| 4 | `--agent` declared `consumesValue: false` on most commands, `true` on one | Noticed, not chased; likely nothing |

## Related

- [[2026-07-29_1730_coworker-session-scoped-mcp-calls-fail]] — where this was first seen and left open
- [[2026-07-01_1030_command-surface-and-notifications-design]] — Gap 1, the group-chat model, and the
  decision to use read-before-write rather than attendance locking
- [[2026-07-11_cursor-durable-read-before-write-design]] — the per-connection → per-agent relaxation,
  whose §6 predicted §2b exactly
- [[2026-07-10_daemon-singleton-defects]] — the multi-daemon version of one identity in two places
  (fixed 2026-07-13)
- [[M8C-PHANTOM-SESSION-FIX-PLAN]] — the first-connect race; §7a is the same family under another name
