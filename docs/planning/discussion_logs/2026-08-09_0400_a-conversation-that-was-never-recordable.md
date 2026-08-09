---
name: a-conversation-that-was-never-recordable
type: discussion
date: 2026-08-09
topics: [seal, relay, witnessing, away-responder, notarization, launch-triage, investigation]
description: >
  A session sealed itself three seconds after it opened, while both operators were away, and neither
  daemon knew. They came back and worked in it for 68 minutes with every message reporting delivered
  and nothing being recorded. Two hypotheses were killed by measurement before the relay's own log
  gave the answer, and a broad fix was written and reverted because five existing tests were right.
---

# A conversation that was never recordable

## The failure, from the operator's chair

You hold a long working conversation. Every message sends. Every message arrives. Nothing warns.
Then you close it — and there is no receipt, and there can never be one, because the record stopped
growing hours earlier. The work is already done by the time it announces itself.

**Measured:** 12 messages held against 6 witnessed, frozen for 68 minutes across 8 further messages,
every one reporting `delivered: true` — including the messages the two agents were using to
investigate the problem.

## Why it is worse than the outage the day before

The 2026-08-08 relay outage ([[relay-stops-notarizing-fleet-wide]]) failed **loudly**: closes hung,
nothing sealed anywhere, two people knew within minutes, nothing was lost. This one succeeds at
everything an operator can observe and fails only at the thing they cannot. The longer and more
valuable the conversation, the more there is to lose — and it is precisely the long, substantial ones
you would want a receipt for.

## The answer, which was in a log nobody had queried

The relay's own record of that session's first three seconds:

```
01:13:34  seq 1  doc      01:13:35  seq 5  CTRL
01:13:34  seq 2  msg      01:13:35  seq 6  msg
01:13:35  seq 3  doc      01:13:36  seq 7  CTRL
01:13:35  seq 4  msg      01:13:36  relay.seal.broker.resolved
                          01:13:36  certificate built and delivered
```

**Two distinct-sender CTRL leaves are exactly what triggers notarization.** The session was sealed at
01:13:36 and witnessed nothing afterwards. It froze at six because that is where the count stood when
it died — six is not a limit.

**The trigger was the away auto-responders.** Both agents were unattended, so each answered the
other. The second arrival looks exactly like *"a caller who ignored the leave-a-message
instruction"*, which is what `DOD-INBOX-ONESHOT-1` exists for — so both sides sent a `[[WRAP]]`
rejection and initiated a seal. The entire content of the resulting certificate is two machines
telling each other nobody is home.

**Neither daemon learned**, because the seal completion is pushed with no pull twin
(`DOD-TERMINAL-STATE-DIVERGENCE-1`). Both kept showing `active`. The operators returned and talked
into a closed room.

## Two hypotheses killed before the answer, both by measurement

**A ceiling at six.** Plausible: two independent samples both read 6. Killed by a control run on the
same relay build, sampled after every exchange rather than only at the end — held/witnessed of 1/1,
2/2, 4/4, **6/6**, 8/8, 10/10, 12/12, then sealed first time with `leaf_count: 13`. The control
crossed six without pausing, minutes after the other session froze there.

The design of that control is the reusable part: **sample every step, not just the end.** A ceiling
and an event look identical from a single end-state reading, and they need different fixes.

**A daemon restart.** Also plausible — the broken session had survived one and the control had not.
Killed from the other side: a restart INTERRUPTS sessions loudly and the client then refuses to send,
so it can never be the silent path. Established by the counterparty session while this side was
reading relay logs.

Both were reasonable, both were wrong, and neither cost more than the measurement that killed it.

## The fixes

**The cause** (`DOD-AWAY-MUTUAL-SEAL-1`, daemon 0.0.150) — an away responder no longer answers
another away responder, nor counts one toward the one-shot rule. The one-shot is right about a human
who keeps typing and wrong about a machine answering a machine.

**The symptom** (`DOD-WITNESS-STALL-1`, daemon 0.0.149) — a terminal relay refusal now fails the
send. The daemon knew all along: it submitted each leaf, got `session_sealed` back, logged it, and
continued, because that branch treated every relay miss as a transient degradation. Correct for a
relay briefly unreachable, where the sequence is recovered later; wrong for a seal, where there is no
later. **"Not witnessed yet" and "will never be witnessed" were the same code path.**

Both are needed. Without the cause fix sessions keep dying quietly; without the safety net the
operator still finds out at close.

## A fix that was written and reverted, which is the most useful part of this log

The first attempt at the cause was broader: *never notarize a session on which this agent has only
ever sent away traffic.* It reads well and it is wrong. **Five existing tests failed immediately**,
and they were right: `DOD-INBOX-ONESHOT-1` deliberately closes an inbox on a REAL caller who ignores
the leave-one-message instruction, and the broad rule disabled that.

The narrow rule is **not a weaker version** of the broad one. The thing to suppress is a machine
answering a machine — not an away agent sealing.

Recorded because the broad version is exactly what a future reader would propose as an improvement.

## A limit that is documented rather than papered over

An operator can set a **custom** away message, and the incident had one on the far side — so text
matching cannot recognise that peer's reply, and their one-shot still fires.

It does not defeat the fix, because **notarization needs two ctrl leaves from distinct senders**:
declining on one side is enough. Their one-shot posts one leaf, ours does not post the second, no
certificate is minted, and the session stays unsealed — the correct end for an exchange nobody had.

A wire marker would be cleaner and is the right long-term answer. It was rejected for now because it
is a wire change, and this defect fires precisely when talking to a peer whose version we do not
control.

## What is still owed

**The pull twin.** A daemon still cannot ASK whether its session was sealed. These fixes close this
route and catch the symptom promptly whatever the route, but any other path to the same divergence
stays quiet until the next send.

## Two things this changed about how the milestone reads

**Every seal that had ever proven "sealing works" was short.** Leaf counts across the entire history
of this daemon: 7 was the largest before this investigation, then 5, 5, 5, 5, 4, 4… The control run's
13 is now the biggest thing ever notarized here. "Witnessing has always worked" was never
established — it was inferred from a population of conversations that all ended before they got
interesting.

**The health check written the previous day is the wrong shape for this.** It asks *"can this relay
reach a directory"*. This failure asks *"is the chain still growing"*, and they are independent —
witnessing stopped while the directory link was fine and delivery stayed green. A check that cannot
go red for the failure being suffered is not a check for that failure.

## Related

- [[launch-triage]] item 1 (`DOD-WITNESS-STALL-1`), item 12 (`DOD-TERMINAL-STATE-DIVERGENCE-1`)
- [[relay-stops-notarizing-fleet-wide]] — the previous day's outage, and the louder failure mode
