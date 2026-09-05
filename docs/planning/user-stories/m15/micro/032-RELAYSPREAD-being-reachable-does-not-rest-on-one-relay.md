---
name: 032-RELAYSPREAD — Being reachable does not rest on whichever relay answered first
type: micro-work-order
date: 2026-09-05
status: complete
dod_line: DOD-M15-MULTIRELAY-1
dod_effect: closes
dod_effect_note: >
  Closes the line as scoped: AVAILABILITY ONLY. The churn explanation the line demanded first was
  delivered by `016-RELAYLOSS` and is quoted here, so no re-measurement is owed. The conversation
  half — a LIVE session moving witness — is a different line (`DOD-M15-SESSION-RELAY-PINNED-1`,
  units 2–4 of the handover story) and is explicitly not this unit.
description: >
  The standing receiver walks its relays in order and stops at the first one that grants, so an
  agent holds exactly one reservation at a time. Lose it and the agent is unreachable by any NAT'd
  peer while still looking perfectly healthy — for a median of 4 seconds, a 90th percentile of five
  minutes, and unboundedly long when the relay goes mute rather than dying. Hold reservations with
  every relay that will grant one, and losing one costs nothing.
---

# **<ins>MICRO</ins>** WORK ORDER 032-RELAYSPREAD — Reserve with all of them, not the first one

> ## THE RULES OF A MICRO WORK ORDER
>
> 1. **Read [[M15-PROCEDURE]] IN FULL before you start.** It binds you — the gate, the review
>    dispatch, the invariants, how tests are run. **Do not read `M15-DEFINITION-OF-DONE.md` or
>    `M15-BUILD-JOURNAL.md`**; this order carries everything you need from them.
> 2. **MICRO means small.** One mission. Follow it to its end. **Never grow the mission.**
> 3. **Found something else?** Write it under *Newly discovered* at the foot of this file and
>    **keep going**. Do not fix it. Do not investigate it.
> 4. **500 lines, hard cap.**
> 5. **Standard procedure still applies:** implement → review (`cello-unit-reviewer`) → fix every
>    finding → commit. Commit per fix, push after every commit. **Closing a unit means flipping
>    this file's `status:` frontmatter to `complete` in the SAME commit as the verdict.**
> 6. **Done is done.** When the Definition of Done below is met, stop.

---

## What the operator lives through

Their agent is online. It says so. Every status command agrees.

**And nobody behind a home router can reach it**, because the one relay holding its slot went away
and the replacement has not been built yet. There is no error, no warning, and nothing the operator
could have looked at. Whoever tried to start a conversation with them simply could not.

From production, across three agents: a gap with no working circuit runs **3.6 to 4.8 seconds at the
median and 322 to 371 seconds at the 90th percentile**. And when the relay goes **mute** rather than
dying — alive, sockets held open, answering nothing — the daemon took **≈44 seconds twice and never
noticed at all inside three minutes once**. Same code, same harness, three runs.

That last one is the failure this whole design exists to prevent: **the agent goes on advertising a
circuit through a relay that answers nothing, and nothing tells it.**

---

## The mission in one sentence

**An agent holds a reservation with every relay that will grant one, so losing a relay costs no
reachability at all — instead of costing however long detection happens to take.**

---

## Where this work lives — ONE REPO

- **`cello-client`** → `/Users/andrep/Documents/code/cello-client`. Paths beginning `core/…`.
  Gate: `pnpm run test` / `lint` / `typecheck` / `build` (**this repo HAS a separate build**, and
  the fix must be verified present in the BUILT artifact, not only in source).

---

## What is established — MEASURED by `016-RELAYLOSS`. Do not re-derive, do not re-measure.

The line says *"first, explain the churn"* — **that debt is paid.** Here is the answer, and every
number below is quoted from the completed unit.

**1. The client never asks two relays.** `#startReceiverNode`
(`core/daemon/src/session-node-manager.ts`) walks its candidate circuit addresses in order,
building one node per candidate with `circuitRelayListenAddrs: [circuitAddr]`, and **breaks at the
first one that grants**. One node, one relay, one reservation.

**2. `reservationsRequested` is a lie, and it is the reason this looked fine.** The field logged at
~**17413** and ~**17419** is `reservations.addrs.length` — **the size of the candidate list, not a
count of requests.** That one mis-named field is the whole reason *"the client already requests a
reservation with every relay it knows"* read as true in an earlier audit. It was the outcome that
was one, and the request that was one too.

**3. The second relay is a thin slice, and the data cannot be read as blaming it.** It is named in
**51 of 3,022** lost-reservation events — so it granted at least 51 reservations, 1.7% — against 690
refusals. But it is only asked once the first has already failed, so those are exactly the moments
the client is failing at everything. **This data cannot separate "that relay refuses" from "the
client's network is down", and it must not be read as either.**

**4. ⚠️ THE DOMINANT FAILURE IS ON THE CLIENT'S SIDE OF THE WIRE, AND THIS IS WHY YOU DO NOT ADD
RELAYS.** In **52%** of loss episodes the daemon lost its directory connection within a minute of
the episode starting; a uniform-random control over the same span lands at 4%. Over 32 days the
3,022 lines decompose to roughly **746 distinct episodes** (three agents share the daemon, one line
each; 14 August alone contributes 1,218 lines).

> **So a third relay does not address the dominant failure.** That is an argument about *where* the
> failure is, not a claim that the second relay is useless — and it is why this unit spreads across
> the relays that exist rather than adding any.

---

## ⚠️ TWO THINGS RULED IN ADVANCE — do not reintroduce either

- **This line is AVAILABILITY ONLY.** It is **not** a linkability mitigation. That claim was
  withdrawn and is disclosed as a bounded property elsewhere. Do not write it into a comment, a
  test name, or your close-out as a benefit.
- **A live conversation moving to a different witness relay is NOT this unit.** Being *reached* and
  the *conversation* are two different mechanisms, and only one of them is here. The conversation
  half is `DOD-M15-SESSION-RELAY-PINNED-1`, units 2–4 of [[M15-STORY-RELAYHANDOVER]]. If you find
  yourself touching `SessionRelayClient`, you have grown the mission.

---

## Part 1 — Rename the field that made this invisible

`reservationsRequested` becomes two honest fields on
`session.standing_receiver.reachability` and `session.standing_receiver.reservation.none`:

- **`relaysOffered`** — how many candidates were in the list.
- **`reservationsHeld`** — how many actually granted.

**Do this first and commit it on its own.** It is the observability that tells you whether the rest
of the unit worked, and a mis-named field is exactly how this defect survived an audit. Per the
milestone's event taxonomy the names are `domain.noun.verb`; the event names do not change, only
their context fields.

---

## Part 2 — Reserve with every relay that will grant

**The shape, decided — do not redesign it.** Keep one standing-receiver node per agent. Give it
**all** granted circuit addresses instead of one:

- Keep the existing walk for the **first** grant, because that is what proves the receiver can come
  up at all and it already handles the two-attempt dance.
- Then **continue the walk** rather than breaking, asking every remaining candidate.
- The node listens on **every** granted circuit address; every one of them is announced.

**⚠️ The two-attempt dance is PER RELAY, and skipping it is the whole reason a relay refuses.**
`DOD-M15-RELAYSLOTS-1` made the relay refuse a reservation from a peer that has not shown it belongs
to a registered agent. So each relay needs: ask (refused, expected), authenticate over
`/cello/relay/1.0.0`, ask again on a **fresh connection carrying the same identity**. That is why
the candidate seed is reused. It has to be two connections — taking the reservation by hand on the
proof's own connection gets a slot that libp2p never announces, leaving the agent holding a slot
nobody can dial.

**One seed for the receiver, reused across relays — NOT one seed per relay.** The agent is one
identity and must be dialable at one peer id through any of its circuits. This is the opposite of
the per-candidate rule inside the walk, which exists because two *rejected* candidates must never
share a peer id; here the reservations all belong to the winner.

**A relay that refuses the AGENT ends the walk, as it does today.** Every relay answers a
registration-level refusal identically, so reproducing it N times buys nothing but latency.

---

## Part 3 — The carve-out becomes a SET, and this is the security-sensitive part

`SessionConnectionGater` (`core/daemon/src/session-connection-gater.ts` ~**108**, ~**161**,
~**277**) holds `#reservedRelayPeerId: string | null` and admits an inbound dial from **the one
relay holding a live reservation**. It becomes a **set**.

**The bound is not "the relays we know". It is "the relays that actually granted."** Today's
comment says it exactly right and the property must survive the change:

> *the ONE relay this receiver actually reserved with earns the inbound AutoNAT carve-out — nothing
> else does. Set only when a reservation genuinely completed, so a directory that merely NAMES a
> relay cannot dial in behind it.*

So: add a peer to the set **only** when that relay's own reservation is confirmed held, and remove
it the moment that reservation is lost. A relay that is offered, named, listed in the pool, or
merely connected is **not** in the set. Widening this to the candidate list would let a directory
that names a relay dial in behind the gate — which is the exact failure the single-relay version was
written to prevent, multiplied.

**Test the negative, not just the positive.** A named-but-never-granted relay must be refused
inbound, and that test must be made to fail on purpose.

---

## Part 4 — The watchdog counts, it does not identify

Today the watchdog evaluates `getConnections().some(c => c.peerId === relayPeerId)` against **one**
peer id, and rebuilds the whole receiver when it is false.

- **Healthy is now "at least one reservation held."** Losing one relay while holding another is
  **not** a reachability event and must not rebuild the receiver.
- **Rebuild only the lost reservation**, against the relay that lost it or the next candidate — not
  the whole standing receiver. A full rebuild on every single loss is the 30-second grid that
  produced the churn in the first place.
- **Zero held is still LOUD**, exactly as `session.standing_receiver.reservation.none` is today.

**⚠️ There is a live bug adjacent to this and you must not reintroduce it.** The code at ~**17346**
carries a long comment about reading the relay id from the address the node *actually holds* rather
than from `reservations.addrs[0]` — because reading candidate 0 when candidate 1 granted records a
relay we are not connected to, and the watchdog then finds it absent on every tick forever and
rebuilds on the grid. Its own comment says it is *"dormant while the pool is size 1; the pool is
designed to be larger."* **This unit is what makes the pool larger, so that dormant case wakes up.**
Derive every held relay id from the addresses the node holds.

---

## Definition of Done

1. `relaysOffered` and `reservationsHeld` replace `reservationsRequested` everywhere it is logged,
   and `reservationsHeld` is the count that actually granted.
2. A receiver offered N relays holds a reservation with **every one that grants**, proven by a test
   asserting `reservationsHeld > 1` — not by asserting the walk ran.
3. **Losing one reservation while another is held does NOT rebuild the standing receiver**, and the
   agent stays dialable throughout. This is the property the unit exists for; assert the agent is
   still reachable, not merely that no rebuild was logged.
4. **Only a relay that actually granted is in the gater's inbound set.** A named-but-never-granted
   relay is refused inbound. Made to fail on purpose.
5. A lost reservation rebuilds **that reservation**, not the whole receiver.
6. Zero reservations held is still WARN-loud, unchanged.
7. **Each new assertion has been made to fail on purpose** (§0z.3): revert the spread and confirm
   the multi-reservation test reddens; revert the set bound and confirm the inbound-refusal test
   reddens; revert the watchdog change and confirm the no-rebuild test reddens. Each must fail
   **for the reason you expect**.
8. **The four hollow-test questions answered in the close-out** (§2, the hollow test). Specifically
   ask #3 — *would this assertion pass if the code did nothing?* A test that counts candidate
   addresses rather than granted reservations passes today and proves nothing.
9. Gate passes (test / lint / typecheck / **build**), and the change is verified present in the
   BUILT artifact, not only in source.
10. Reviewed by `cello-unit-reviewer`, every finding fixed, verdict quoted below.

**Not in scope:** adding relays to the fleet; moving a live conversation to a new witness; mute-relay
detection (a relay that stops answering without closing — a separate bug, and story §9 names it out
of scope); graceful drain; anything about linkability; anything about seals.

---

## Traps recorded before you start

**Do not add relays to fix a churn you have explained.** The measurement says 52% of episodes take
the client's own directory link down with them. A third relay does not address that, and the fleet
size is not this unit's business.

**A reservation held is not a circuit announced.** The one proof that counts is that the node's
listen addresses contain the `/p2p-circuit` address for that relay — `start()` resolving is not
enough, and a relay out of slots completes the handshake and grants nothing, leaving a node that
looks started and is reachable by nobody. That check already exists in the walk; every additional
reservation needs the same one.

**Do not let "more reservations" become "more churn".** Every extra relay is another watchdog
subject and another 30-second retry grid. The rebuild-one-not-all rule in Part 4 is what keeps the
cost linear, and it is a requirement, not an optimisation.

**The mute relay is still not detected, and this unit does not claim it is.** What it does is remove
detection from the reachability path — you stay reachable through the others while the mute one is
still believed healthy. Say exactly that in your close-out and do not overstate it.

---

## Close-out

### What the operator gets

Their agent now holds a circuit reservation with **every relay that will grant one**, not with
whichever answered first. Kill one relay and nothing happens to them: the agent keeps its peer id,
keeps its other circuits, and a caller behind a home router still gets through — proven in the test
by a second node actually dialling the agent through the surviving relay, not by an address string.
Before this, that same relay death made them unreachable while every status command said "online".

### ⚠️ The one-relay limit was NOT a design choice, and this is the finding worth keeping

Handing a node two relay listen addresses did not work at all, and the reason is in
`@libp2p/circuit-relay-v2@4.2.5`:

```js
#checkReservationCount() {
  if (this.pendingReservations.length === 0) {
    this.log.trace('have discovered enough relays');
    this.reserveQueue.clear();          // every QUEUED reservation job, gone
```

`pendingReservations` is filled only by `reserveRelay()`, which fires only for the DISCOVERY listen
address (a bare `/p2p-circuit`). We listen on EXPLICIT relay addresses, so it is always empty — and
that check runs at the end of every successful reservation. With libp2p's default
`reservationConcurrency` of 1, relays 2..N sit queued while relay 1 reserves, and relay 1's success
wipes them. Their `listen()` never settles, so `libp2p.start()` never resolves.

**That is the unexplained 2026-08-18 measurement recorded in `#buildRevivedNode`** — *"handed 2
relay addrs at once, no deadline: `start()` never completes (10,002ms and counting)"*. It was never
a slow relay. The load-bearing precondition (found by review): `libp2p@3.3.2`'s transport manager
creates one listener per address and awaits every `listen()` together, which is what puts relay 2 in
the queue while relay 1 runs. `Queue.clear()` splices only the array and a running job still
settles, so the fix is to leave nothing queued — `reservationConcurrency` is now the number of
circuit addresses the node was handed.

### ❌ DEVIATION — DoD clause 5 is NOT implemented, and it cannot be at this layer

> *"A lost reservation rebuilds **that reservation**, not the whole receiver."*

For an EXPLICIT relay address, circuit-relay-v2's `listen()` is a one-shot: `removeReservation()`
clears the refresh timeout and deletes the entry, and the listener's `_onAddRelayPeer` returns early
for `type === 'configured'`, so even a later reservation would not be announced. A circuit listener
is fixed at node creation, and the only thing that takes a new one is a **new node** — which
clause 3 forbids while another reservation is held. The two clauses cannot both be satisfied without
a transport-level re-listen that does not exist.

A first attempt re-proved to the lost relay to "remove the relay-side reason for revocation". Review
killed it twice over: it cannot restore a reservation (above), and `#authenticateStandingReceiver`
ends with `if (refusal?.tryAnotherRelay) { … rebuildStandingReceiver }` — so a dead relay's refusal
would have rebuilt the whole receiver and thrown the surviving reservation away. The churn engine,
re-entered through the back door.

**What ships instead, stated plainly:** a lost circuit is gone until the receiver is next rebuilt for
another reason. The agent never STOPS BEING REACHABLE meanwhile — the surviving relays carry it, the
loss is named in the log with its cause, and the lost relay's inbound carve-out is revoked in the
same tick. **That is availability, not restoration in place.** Restoration needs its own unit; see
*Newly discovered*.

**And the mute relay is still not detected. This unit does not claim it is.** What it does is take
detection off the reachability path: you stay reachable through the others while the mute one is
still believed healthy.

### The four hollow-test questions (§2)

1. **What did I stub, and does the property live in the stub?** The reachability tests use REAL
   in-process libp2p hop relays, so the reservation, the announcement and the dial are all real —
   which is how the libp2p queue bug was found at all. Where a scripted factory IS used
   (`relayslots`), its assertion is about the CONFIG the walk requests, and I marked it as such: the
   announcement half is asserted against real libp2p in `W1`.
2. **Is the fixture the shape that BREAKS, or a neighbouring shape that works?** `R4` offers one
   relay and holds one, so `reservationsHeld: reservations.addrs.length` — the exact bug being
   renamed away — passes it. `R5b` offers two with one dead, where the two numbers cannot both be
   right. That is why `R5b` exists.
3. **Would this assertion pass if the code did NOTHING?** ⚠️ **This one had a real answer, and it
   was found by review, not by me.** The two new gater tests construct a gater and hand it a list —
   they prove set semantics, which nothing was going to get wrong, and prove nothing about what the
   MANAGER hands it. Substituting `reservations.relayPeerIds` (the directory-supplied candidate
   list) at the wiring kept every test in the unit green **while shipping the exact hole the bound
   exists to close**. Fixed: `holdsInboundCarveOut` is now the carve-out branch itself rather than a
   copy of it, and `R5b` asserts the wiring — one relay that granted, one only ever named.
   Similarly `W1` passed against an implementation that logged the loss and revoked nothing.
4. **Did I assert the OUTCOME or the mechanism's shadow?** `W1` originally asserted an announced
   address and an internal enum — and libp2p keeps a dead relay's circuit address for hours, so
   neither is reachability. It now dials the agent through the surviving relay from a second node
   and asserts the peer id that answers.

### Made to fail on purpose (§0z.3) — six mutations, each typechecked/built first

| Mutation | Red on | Failed because |
|---|---|---|
| break at the first grant (the old walk) | `W1` | "must announce a circuit through BOTH relays" |
| `stillHeld.length >= 0` (rebuild on any loss) | `W1` | "same node, same peer id — nothing was rebuilt" |
| carve-out keyed on `#allowedOutboundPeerIds` | 3 gater tests | "expected false to be true" — a named relay admitted |
| revert `reservationConcurrency` | `W1` | only one circuit ever binds |
| hand the gater the CANDIDATE list | `R5b` | "being named by the directory must not buy a foothold" |
| remove the pruning + revocation | `W1` | "the dead relay lost its inbound carve-out" |

**One of these first reddened for the WRONG reason** and that is the half of the rule that earned its
keep: the rebuild-always mutant threw `Cannot read properties of null (reading 'peerId')`, because a
receiver mid-rebuild is absent from the map. The test caught the mutant and said nothing about the
property. `W1` now reads the identity through a helper that names the state, and the mutation was
re-run.

### Review — `cello-unit-reviewer`, verdict quoted

> - **SPEC: DEVIATIONS FOUND** — clause 5 is not implemented and the deviation is un-journaled *(F2, blocking)*
> - **SILENT FALLBACKS FOUND** — F1 installs a stopped node and discards `listen_failed`; F4's shrink-only list makes a recovered circuit invisible *(both blocking)*
> - **ERROR SUBSTITUTION FOUND** — `listen_failed` surfaces as `session.standing_receiver.spread.slow_start` … sending the operator to the relay fleet for a local bind failure *(F1, blocking)*
> - **HOLLOW TESTS FOUND** — clause 4's wiring is bypassable by substituting the candidate list … and every test still passes; W1 passes against an implementation that logs the loss and revokes nothing; W1b lost the old W1's "the rebuild picks a live survivor" coverage
> - **REMOVALS PROVEN** — every deletion proven against the library, both repos, and the `exports` map
> - **NO COMPATIBILITY DEBT**
>
> **Blocking before this unit closes: F1, F2, F3, F4, and the clause-4 wiring test.** F5–F9 are
> fix-with-the-batch. I am not rubber-stamping this one: the diff touches the reachability path and
> I found a masked start failure in it.

**Nine findings, five blocking. All nine fixed** (commit `b2849c2`); the clause-5 deviation is
journaled above rather than closed. The reviewer separately CONFIRMED the libp2p reading and supplied
the missing transport-manager precondition, and ACCEPTED three of the deliberate behaviour changes
put to it (the shared receiver seed, the removal of the `reservations.addrs[0]` fallback, and
`hadRelayToAsk` over `relaysOffered` on `reservation.gave_up`).

### Commits

`822302d` (part 1, alone) · `e9fa060` (part 3) · `b0d1a53` (parts 2+4) · `008573f` (test hardening)
· `b2849c2` (review findings) — branch `m15/032-relayspread`, repo `cello-client`.

---

## Newly discovered

_(write findings here and keep going — do not fix them)_

1. **A lost circuit is never retaken in place** — the clause-5 deviation above. Restoring one
   without rebuilding the receiver needs a transport-level "re-listen on this relay" that
   `@libp2p/circuit-relay-v2` does not expose for configured addresses. **Classification: POST-LAUNCH.**
   The agent stays reachable through its other relays, so a customer does not hit it; it costs
   redundancy depth until the next rebuild, not reachability.

2. **A NEW relay is never picked up while ANY circuit is held.** `setDirectoryRelayEndpoints`
   (`session-node-manager.ts`) returns early when the node already advertises a `/p2p-circuit`
   address — "already reserved". Correct under the old one-relay design; under the spread it means a
   receiver holding 1 of 3 relays never widens to the other 2 when the directory announces them.
   Pre-existing, and newly load-bearing. **Classification: POST-LAUNCH** — it caps how much
   redundancy an agent accumulates, and the next receiver rebuild picks up the full pool anyway.

3. **`session.revive.node.building` logs `circuitAddrs: reservations.addrs.length`** — the CANDIDATE
   count under a name that reads as held circuits, i.e. the same mis-naming Part 1 removed from the
   standing-receiver events, still live on the revive path. Not touched: the revive path is the
   session half and out of this unit's scope. **Classification: POST-LAUNCH** — a log field, no
   behaviour.
