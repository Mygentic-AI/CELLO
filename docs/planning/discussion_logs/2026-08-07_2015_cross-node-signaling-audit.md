---
name: cross-node-signaling-audit
type: discussion
date: 2026-08-07
topics: [signaling, cross-node, directory, seal, visiting-connection, m12, audit]
description: >
  Every place the directory routes a signaling frame by looking up a LOCAL stream, classified three
  ways: works cross-node today, fixable by the visiting-connection pattern that already exists, or
  genuinely needs a channel that does not. Produced because two agents on two nodes could not
  complete a seal, and nobody had enumerated which flows cross node boundaries.
---

# Cross-node signaling — the inventory nobody made

## Why this exists

Two agents on two machines could not complete a seal-interrupted exchange. Both sides timed out,
each concluding the other was unreachable. The cause is that they are served by different directory
nodes, and the directory routes signaling frames by looking up a stream **held by itself**.

This is the same shape as the replication gap written up earlier today
([[replication-gap-what-m12-left-unfinished]]): a set of things that need to cross node boundaries,
no list of which ones do, and each gap found by a user hitting it.

**Not a regression.** The forwarding code is dated 2026-06-15 and untouched since. It never worked
cross-node. What is new is agents actually landing on different nodes — every earlier test put both
agents on one machine, so the local lookup always succeeded.

**It was known.** The M12 build journal, working a different symptom, struck the general fix out:

> 1. ~~directory→directory forwarding~~ — new cross-node channel, does not exist

and routed around it for that one case. There is still no general mechanism.

## The mechanism, stated once

`#streams` maps an agent's pubkey to **a signaling stream this node holds**. An agent's daemon
keeps its stream to its own home node. So `#streams.get(counterparty)` returns nothing whenever the
counterparty is homed elsewhere, and the flow takes its "not present" branch.

**Sessions cross nodes anyway, and this is the key to the whole picture:** the client opens a
transient *visiting* connection to the far node. That is what puts a remote agent into the
brokering node's `#streams` — cross-node reach is achieved by the CLIENT dialling, never by nodes
talking to each other.

So each flow's real question is not "does the directory forward?" — it never does — but **"does the
client establish a visiting connection for this flow?"**

## The three-way classification

| | meaning |
|---|---|
| **WORKS** | the client already dials the far node for this flow |
| **PATTERN** | broken cross-node, but fixable by applying the existing visiting-connection pattern |
| **CHANNEL** | genuinely needs something that does not exist |
| **GUARD** | not a routing target — an identity check or a log field |

30 `#streams.get` sites. All in `directory-node.ts`.

## GUARD — 8 sites, not routing

`L2592` (a comment), `L2613`, `L2627` (stream-identity checks on close: "is the stream that closed
still the registered one?"), `L4125`, `L4126`, `L4147`, `L4169` (log fields named
`initiatorStreamInMap` / `targetStreamInMap`), `L6150` (an agent looking up its own stream).

These need no cross-node behaviour. Worth noting only so a future reader does not recount them as
defects — the raw grep count of 30 overstates the surface by more than a quarter.

## PATTERN — confirmed broken, and the fix already exists one branch away

### The seal ceremony itself — `L4242`, `L4243`, `L4256`, `L4257`

`#processSealAttempt` acks BOTH parties once their roots match:

```js
const streamA = this.#streams.get(attemptA.partyHex);
const streamB = this.#streams.get(attemptB.partyHex);
if (streamA) { try { this.#sendFrame(streamA, ackBytes); } catch { /* */ } }
if (streamB) { try { this.#sendFrame(streamB, ackBytes); } catch { /* */ } }
```

A party without a stream on the brokering node receives **nothing** — no error, no fallback, and an
**empty catch** swallowing any send failure on top. Identical shape in the tree-mismatch branch.

**This is why active-session seals work cross-node and interrupted ones do not.** The client's
close handler already re-opens a visiting connection to the broker for the duration of the seal,
with a comment naming this exact failure:

> if this session was brokered by another node, the seal frames are pushed by that BROKER — but the
> initiator released its visiting connection after setup, so on the home stream they never arrive
> and close times out. Re-open a transient visiting connection to the broker for the duration of
> the seal.

That block is gated on `if (record.status === "active")`. The interrupted path
(`interrupted` / `seal_interrupted_pending`) sends the same frames with no such reconnect.

### The seal-interrupted trio — `L2501`, `L2526`, `L2550`

`seal_interrupted_request` → counterparty; `_ack` and `_rejection` → back to initiator. Each is a
lone local lookup whose else-branch logs `target_offline` at INFO and **returns nothing to the
sender**. The sender cannot distinguish "genuinely offline" from "homed on another node", so it
cannot route around the condition even though the machinery to do so exists.

**Fix:** apply the visiting-connection reconnect to the interrupted branch, i.e. lift the gate off
`status === "active"`. Plus return a distinct reason instead of silence, so the condition is
detectable rather than inferred from a timeout.

## NEEDS ASSESSMENT — 15 sites

Not classified, because classifying each requires reading its client-side counterpart to see
whether a visiting connection is opened for that flow. Listed with the specific question rather
than a guess.

| Sites | Flow | The question |
|---|---|---|
| `L3503`, `L3540` | connection request / response | Does the requester dial the target's home node, or assume a local stream? |
| `L3590`, `L3619` | disclosure request / response | Same. This is contact-detail exchange between two agents. |
| `L3429` | package/CBOR interceptor → target | Which flow feeds it, and is the target ever remote? |
| `L3731`, `L3816`, `L3823` | session offer | Likely WORKS (this is the brokering path that demonstrably crosses nodes) — confirm rather than assume. |
| `L4514`, `L4727`, `L4943` | unilateral notarization / "present party" | The stranded-participant path. Note the M12 journal already fixed a sibling case by having the client learn the result locally from replicated `seal_notarizations`. |
| `L5247`, `L5522`, `L5583` | `#deliverOrEnqueue`, `#deliverFrostSealed` | **Highest priority of this group.** These degrade to a QUEUE when the stream is absent — which is the right shape. But `pickup_queue` is deliberately NOT replicated, and an agent polls its OWN home node. So a frame enqueued on node A for an agent homed on node B may never be collected. Verify: does the enqueue happen on the recipient's home node, or on whichever node was handling the sender? |
| `L2668` | `#recordPresence` counterparty lookup | Presence is Tier-B replicated, so this may be advisory only. Confirm. |

## What this changes about sequencing

The earlier note said the mechanism decision — client-side versus directory-to-directory — was
still open. **It is largely settled and shipped:** the visiting-connection pattern exists, works,
and is commented. For the seal flows the remaining work is applying it one branch over, not
building a channel.

That does not close the question for every flow. `#deliverOrEnqueue` cannot be fixed by a visiting
connection — a queued item is collected later, by which time no transient connection exists. If
that group turns out to strand cross-node, it needs either a replicated queue (which the design
warns invites double-delivery) or delivery routed to the recipient's home node at enqueue time.
That is the one place a CHANNEL-class answer may still be required.

## Recommended order

1. **Lift the visiting-connection reconnect off `status === "active"`** so interrupted closes get
   it. Smallest change, unblocks the measured failure, uses proven machinery.
2. **Return a distinct reason instead of silence** on `target_offline`, and on the seal-attempt
   ack path. Neither the client nor an operator can currently tell "not here" from "not there".
   This is what turned a routing gap into a day of investigation.
3. **Assess the `#deliverOrEnqueue` group.** If queued frames strand cross-node, that is message
   delivery, and it outranks everything above.
4. **Classify the remaining sites** and record the answer next to each, so this file becomes the
   list that did not exist.

## The check that does not exist

Nothing asserts which signaling flows must work cross-node. The same absence produced the
replication gap: no list, no test, and every instance found by a user hitting it.

A test that puts two agents on two different directory nodes and exercises each flow would have
caught this on day one of M12. Every existing test puts both agents on one node, which is precisely
the configuration that cannot detect any of it.
