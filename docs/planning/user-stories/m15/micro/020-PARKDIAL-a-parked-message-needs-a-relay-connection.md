---
name: 020-PARKDIAL — A park deposit dials the relay from a node that may have no relay connection
type: micro-work-order
date: 2026-09-03
status: open
description: >
  Sending to an offline counterparty intermittently fails: the message is never parked. The deposit
  dials the relay from the standing receiver, and the standing receiver is DESIGNED to come up
  without a relay connection when the relay is slow — so the deposit fails with "no open connection"
  for a node that was never going to have one. Diagnosis complete; the fix is a design decision.
  Source: found and deferred by 019-PARKERROR, investigated 2026-09-03.
---

# **<ins>MICRO</ins>** WORK ORDER 020-PARKDIAL — Park needs a relay; the node it borrows may not have one

> **This order is written from a COMPLETED investigation.** The cause is established and the
> evidence is quoted below. What remains is a design choice about where park gets its connection,
> and that choice is Andre's — see *The decision*.

---

## What the operator lives through

1. They send a message to a counterparty whose agent is offline.
2. CELLO is supposed to park it at the relay so the counterparty collects it when they return.
3. The send fails instead. **The message is never parked, so it is never delivered.**
4. Before `019` the error read `[object Object]`. After `019` it reads *"No open connection to peer
   12D3Koo…"*, which is true and names nothing they can act on.

**Reproduced on the first attempt** on 2026-09-03 (`DOD-MSG-5`, spine harness). `019` recorded it
as one failure in three runs; three runs supports "not deterministic", not a rate, and the real
frequency is still unmeasured. First-try reproduction on a different machine suggests it is not rare.

---

## The trace — done, do not re-derive it

**1. The exit point.** `content_park_deposit` → `ContentParkClient.deposit` → `#open` →
`node.newStream(relayPeerId, …)`. `newStream` does **not** dial; it looks for an already-open
connection and throws `{ reason: "no_connection", peerId, message }` when there is none
(`core/transport/src/node.ts`).

**2. The dial that should have prevented it.** `#open` dials first, but every failure was swallowed
by an empty `catch`, so the reason was destroyed one line before the error that replaced it. **This
half is FIXED** (`cello-client` `fa86e02`, branch `m15/parkdial`): the dial error is now kept and
logged as `content.park.dial.failed` / `content.park.stream.failed`, mirroring what
`session-relay-client.ts` has always done. That fix is what made everything below readable.

**3. What the dial error actually says**, from the reproduced run:

```
content.park.dial.failed   error: "Encryption failed"
content.park.stream.failed error: "No open connection to peer 12D3KooWEXEz…"
                           dialAttempted: true, dialSucceeded: false
content.park.dial.failed   error: "connection error 127.0.0.1:55645: connect ECONNRESET"
```

The relay drops the connection during the noise handshake. It is not refusing the deposit — it is
refusing the conversation.

**4. Which node is dialling.** `content_park_deposit` uses
`sessionNodeManager.getStandingReceiverNode()` — the daemon's always-on inbound listener.

**5. Why that node has no relay connection, and this is the root cause.** The standing receiver is
**deliberately never gated on a relay.** Its own comment, `session-node-manager.ts`:

> *"**standing-receiver creation must NEVER be gated on a relay.** libp2p's circuit listener awaits
> a live connection to its relay before start() resolves, and it does not time out. A relay that
> does not answer parks start() forever: no created event, no failure, no retry, no alarm — the
> agent simply has no receiver and is deaf to ALL inbound… So every attempt is raced against a
> deadline, and failure ALWAYS falls through to a plain TCP receiver."*

That rule is **correct** and must not be weakened — it exists because a slow relay used to make an
agent deaf to everything. Its consequence is that a standing receiver may legitimately exist with
no relay connection at all.

**6. The measured sequence**, agent A, one run, all timestamps from the same log:

```
20.941  agent.online, standing receiver arm initiated
20.971  session.node.created   standing_receiver_35bf8171…
20.977  standing_receiver.relay_auth.result          ← receiver #1, relay reachable
21.723  session.node.created   e639badc…              ← the session node
21.746  standing_receiver.prove.result                ← a SECOND receiver is built
21.747  [relay] Peer disconnected
21.750  content.park.dial.failed  "Encryption failed"
21.754  standing_receiver.relay.rejected  relay_unreachable   ← the deadline fallback fires
21.757  session.node.created   standing_receiver_989562ba…
21.757  standing_receiver.reservation.none            ← receiver #2 has NO relay
21.761  content.park.dial.failed  ECONNRESET
```

**So: the deposit dials the relay from a node that fell back to a plain TCP receiver precisely
because the relay was unreachable.** Park requires a relay; it borrowed a node chosen for a
different purpose, whose design contract explicitly permits it to have no relay.

---

## Two hypotheses KILLED with evidence — do not revisit them

- **The session gate's peer eviction.** `#evictUngatedPeers` hangs up non-allowlisted peers when a
  session promotes, which would explain the disconnect neatly. **It never fired**: zero
  `session.gate.evict*` events in the failing run.
- **A teardown between the two receivers.** There is none — no `session.node.destroyed` for
  `standing_receiver_35bf8171` anywhere. Receiver #2 was built alongside #1, not to replace it.

**And do not diagnose a race.** The condition is a stated design contract — "creation is raced
against a deadline and falls through to a plain TCP receiver" — not an interleaving.

---

## What is NOT established

**Why a second standing receiver is built at 21.746 when `#ensureStandingReceiver` returns early if
one already exists** (`if (this.#standingReceivers.has(agentName) || …) return;`). Receiver #1 was
created and authenticated; no removal is logged; yet a second creation runs. Either #1 was never
installed in `#standingReceivers`, or a second path builds one. **This is the first thing to
establish**, because it decides whether the no-relay receiver is a transient during startup or a
lasting second node the deposit will keep finding.

It does not change the root cause, and the fix below stands either way.

---

## The decision — Andre's, because all three options trade something real

Park **requires** a relay. The standing receiver **may** have one. The fix is choosing how park
gets a connection it can rely on:

**A. Park dials its own connection.** `#open` already dials; make it establish the connection rather
than hoping the borrowed node has one, and retry on the transport error rather than surfacing it.
Smallest change, keeps park working when the receiver has no relay. Cost: a second connection to the
relay from the same daemon.

**B. Park waits for a relay-capable node.** Ask the manager for a node with a live relay connection,
and if none exists, fail with a reason that says so and a retry, rather than `no_connection`. Cost:
a deposit can now be refused for a reason the operator must understand, and it needs somewhere to
queue.

**C. Route the deposit through the agent's existing relay client.** The daemon already holds an
authenticated relay client per agent (`#relayClients`), which is the thing that genuinely has a
working relay connection. Cost: the largest change, and it couples park to session machinery.

**Recommendation: A**, then measure. It is the smallest change that makes the advertised behaviour
work, it does not weaken the never-gate-on-a-relay rule, and it leaves B and C open.

---

## Definition of Done

1. A park deposit succeeds when the standing receiver has **no** relay connection — the case that
   fails today — proven by a test that puts the receiver in that state deliberately.
2. A deposit that genuinely cannot reach the relay fails with a reason naming the relay and a next
   step, never `internal_error` / `no_connection`.
3. `DOD-MSG-5` passes **ten consecutive runs**. One green run proves nothing here; the failure was
   already intermittent and a single pass is what let it survive `019`.
4. The dial-error instrumentation from `fa86e02` is kept and its events are asserted by a test.
5. The unexplained second standing receiver (above) is either explained or written up as its own
   finding.
6. Gate passes in both repos. Reviewed by `cello-unit-reviewer`, every finding fixed.

**Not in scope:** changing the standing receiver's never-gate-on-a-relay rule. It is load-bearing
and correct.

---

## Traps

**Do not "fix" this by making standing-receiver creation wait for the relay.** That reintroduces the
deaf-agent defect the comment in §5 exists to prevent, and it is strictly worse than a failed
deposit.

**One green run means nothing.** This failed 1-in-3 in one place and 1-in-1 in another. DoD 3 is ten
runs for that reason.

**The instrumentation is the reason this was solvable.** Do not tidy it away as debug logging.

## Review

*(the coder fills this in)*

## Newly discovered

*(anything found and NOT acted on)*
