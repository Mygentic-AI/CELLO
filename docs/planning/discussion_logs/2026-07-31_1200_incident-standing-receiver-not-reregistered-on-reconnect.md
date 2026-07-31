---
name: 2026-07-31_1200_incident-standing-receiver-not-reregistered-on-reconnect
type: discussion
date: 2026-07-31
topics: [incident, standing-receiver, signaling, reconnect, reachability, dns, diagnosis]
description: An agent reported online, its daemon reported connected, and the directory's own database reported online — while nothing could reach it. Root cause: the standing receiver's registration lives on a signaling stream that dies roughly hourly, and nothing re-registers it on reconnect.
---

# Incident — an agent that is "online" everywhere and reachable nowhere

## One line

The standing receiver's **lifetime** is tied to the daemon; its **registration** is tied to a
signaling stream that dies repeatedly. Nothing re-registers on reconnect, so an agent silently
stops being reachable while every indicator continues to say it is fine.

## Impact

`CELLO_Support` could not open a session with `CELLO_Feedback` for roughly 25 minutes. Both agents
were online, both on the same directory node, in the same daemon, on the same machine. Every
diagnostic surface — `cello status`, the agent's own `online` field, and `agent_presence` in the
directory's database — reported healthy throughout.

This is a launch-blocking class of failure: the product's core promise is that two agents connect
and communicate, and here the failure is both **silent** and **not self-healing**. Only a daemon
restart recovered it.

## Timeline (UTC, 2026-07-31)

| Time | Event |
|---|---|
| 09:43:28 | Daemon starts (cli 0.0.103 / daemon 0.0.100). Environment still hibernated. |
| 10:36–10:54 | Infrastructure woken, all three regions verified serving. |
| 10:47:47 | eu-central-1 directory task starts. |
| 10:48:28 | All five agents' presence written at eu-central-1. |
| 10:56:02 | Ms_Chelly → CELLO_Feedback. Directory logs `targetStreamFound: true`. **Works.** |
| 10:57:30 | Ms_Chelly → CELLO_Support. `targetStreamFound: true`. **Works.** |
| ~10:57–11:19 | Feedback's stream is lost. Presence heartbeat stops (last_seen frozen at 10:48:28). |
| 11:19:30 | CELLO_Support → CELLO_Feedback. `targetStreamFound: false` → `target_offline`. Retry, same. |
| 11:42:13 | Client logs `directory.signaling.disconnected` ("Cannot write to a stream that is closed") ×3. Reconnects. |
| 11:45:54 | Operator restarts the daemon. All five agents emit `agent.online`. |
| 11:47–11:48 | 104 × `dns_error` — the **fresh process** re-resolving into a stale negative DNS cache. |
| 11:48:43 | Negative cache expires. Resolution healthy; zero `dns_error` since. |
| 11:49:18 | Presence refreshed for all five. Recovered. |

## Root cause

**Produce path.** `startAgentInternal` (`core/daemon/src/daemon.ts:1661–1710`) adds the agent to
`onlineAgents`, creates its directory signaling, and calls
`sessionNodeManager.ensureStandingReceiverForAgent(name)` (line 1689), then logs `agent.online`.
This runs **only** at daemon boot or an explicit `cello_start_agent`. Every `agent.online` in the
log lands exactly on a daemon start — 06:08, 06:09, 06:25, 06:55, 07:43, 10:35, 11:45, 11:53 —
and never in between.

**Consume path.** The directory answers a session request by checking for a live registered stream
for the target. Absent, it returns `targetStreamFound: false` → `target_offline`.

**The gap.** The signaling manager's reconnect hook is:

```ts
onConnected: () => { void autoRecoverForAgent(agentName); },   // daemon.ts:600
```

That is `contentPark.autoRecoverForAgent` — the parked-mailbox drain from `M8C-RELAYWAKE-1`. It
re-drains messages. It does **not** call `ensureStandingReceiverForAgent`. `ensureStandingReceiverForAgent`
has exactly two call sites (`daemon.ts:1689`, `inbound-sessions.ts:524`); neither is on the
reconnect path.

So every reconnect re-authenticates the stream and re-drains the mailbox, and leaves the agent
unregistered as a receiver.

**Rate.** Between 11:00 and 12:00 the daemon logged **48 × `directory.signaling.connected`** and
**10 × `agent.online`** — and those 10 are two daemon starts × five agents. 46 of 48 reconnects
re-registered nothing. The stream turns over roughly every 70 seconds.

## Why it looked like three separate bugs

It is one bug:

1. *"A stream vanishes with no client-side disconnect."* The client does see disconnects — 12 in the
   11:19–11:50 window. It simply does not re-register afterwards.
2. *"Reconnect abandons a subset of agents."* It abandons **every** agent on **every** reconnect. It
   looked like a subset because only agents somebody tried to reach showed a symptom. Feedback and
   Ms_Chelly were not singled out — they were the ones being contacted.
3. *"Status lies."* Each field is accurate for what it measures. `directory_signaling: connected` is
   true; `agent.online` reflects the last start. Neither tracks whether the **directory** still holds
   a standing receiver — which is the thing that determines reachability.

## Wrong turns, and what caused them

Recorded because each cost real time and each has a reusable lesson.

- **"Presence is stale, the node restarted."** Disproved: eu-central-1 started 10:47:47 and presence
  was written 10:48:28, into that same task's lifetime.
- **"It is cross-node brokering."** Disproved: `agent_presence` shows all four agents on
  `eu-central-1`. There was no broker step.
- **"Fewer than T=2 nodes hold shares."** Disproved: the FROST handler passes `agentPubkey` to both
  `storeShare` and `getShare`, so store and load agree.
- **"A stale DNS cache caused the outage."** *Disproved by timestamps* — and this one was believed by
  two agents at once. Every `dns_error` today falls in three blocks: 03:22–03:53 (hibernation),
  09:04, and **11:47–11:48**. There were **zero** between 09:04 and 11:47 — so none during the wake,
  none during the successful 10:56/10:57 sessions, and none during the 11:19 failure. The DNS errors
  were **caused by the 11:45 restart** performed to fix the outage, and postdate the failure they
  were blamed for. The error was counting `dns_error` "since daemon start" without checking the
  timestamps against the failure window.

**Lesson:** when correlating a log signal with a failure, scope the signal to the failure's window
before concluding causation. A count "since start" spans every earlier state of the system.

**Second lesson:** `dig` is the wrong tool for verifying what the daemon sees — it queries DNS
directly and bypasses the OS resolver cache that Node's `getaddrinfo` uses. During the 11:47 window
`dig` reported success while the daemon got `ENOTFOUND`. Verify with
`node -e 'require("dns").lookup(host, console.log)'`.

## The fix

Re-register the standing receiver on reconnect:

```ts
onConnected: () => {
  void autoRecoverForAgent(agentName);
  if (onlineAgents.has(agentName)) void sessionNodeManager.ensureStandingReceiverForAgent(agentName);
},
```

Falsification performed before proposing it:

1. **Idempotent?** Yes — `#ensureStandingReceiver` returns immediately if the receiver exists or is
   being created (`session-node-manager.ts:4555`).
2. **Does `onConnected` also fire on the first connect?** Yes (`signaling-manager.ts:731`, in
   `runConnectedPhase`). Hence the `onlineAgents` guard, so a reconnect never creates a receiver for
   an agent that was never started.
3. **Redundant with `startAgentInternal`?** Only at start, and the idempotency guard absorbs it.
4. **Throwing callback?** The manager already wraps `_onConnected` in try/catch
   (`signaling-manager.ts:729–735`), so a failure cannot break the signaling connection.

## Open questions — must be answered before calling this closed

1. **Does the directory drop the registration on stream close, on a timeout, or on something else?**
   The `targetStreamFound: false` at 11:19 is the directory's own report, but the server-side
   expiry code has not been read. This determines whether re-registering on reconnect is
   *sufficient* or whether a keepalive is also required.
2. **Why does the stream die roughly every 70 seconds?** 48 reconnects an hour is not normal. If an
   idle reaper (ALB or NAT idle timeout) is closing quiet signaling streams, that is a second defect
   worth fixing on its own — the fix above would then be masking a churn problem rather than solving
   it.

   Measurements taken, for whoever picks this up (whole log, 2026-07-31):

   | Signal | Count |
   |---|---|
   | `directory.signaling.disconnected` — `Cannot write to a stream that is closed` | 3514 |
   | `directory.signaling.disconnected` — `heartbeat_timeout` | 42 |
   | `reader.error` — `The operation was aborted due to timeout` | 2061 |
   | `reader.error` — `The stream has been reset` | 623 |
   | `reader.error` — `signaling_closed` | 533 |

   Two observations. First, the dominant disconnect is the client discovering the stream is
   **already** closed when it tries to write — i.e. it learns at write time, not from a close event,
   which is why nothing reacts promptly. Second, `heartbeat_timeout` is rare (42) relative to the
   3514, so the heartbeat is NOT what detects this: the manager's defaults are a 15 s interval and a
   15 s timeout (`signaling-manager.ts:278–279`), which at a ~70 s stream lifetime means roughly four
   successful pings before the stream dies anyway. So the churn is not slow-heartbeat-vs-idle-reaper
   in the simple form.

   Not investigated: the origin of `The operation was aborted due to timeout` (2061). It reads like
   an `AbortSignal`, i.e. something on our side giving up on a read, but it is not raised in
   `signaling-manager.ts` and the source was not traced. That is the thread to pull first.
3. **Should `cello status` report reachability rather than socket state?** As written, an operator
   has no way to discover they are unreachable. See the companion work surfacing unresolved
   directory endpoints in `cello_status`.

## Related

- `M8C-RELAYWAKE-1` — added the `onConnected` hook that drains the parked mailbox. The same hook is
  the correct home for the receiver re-registration; it was simply never extended.
- The results fan-out defect found the same day (`openVisitingConnection` used before its dial
  completes) is a *different* bug with a similar shape: an asynchronous connection consumed as if it
  were ready.
