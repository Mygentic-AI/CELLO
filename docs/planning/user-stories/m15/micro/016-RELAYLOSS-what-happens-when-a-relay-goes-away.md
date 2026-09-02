---
name: 016-RELAYLOSS — What actually happens when a relay goes away, and then fix it
type: micro-work-order
date: 2026-09-02
status: open
description: >
  Two open lines ask the same question from different ends: can an agent still be REACHED when a
  relay dies, and does a live CONVERSATION survive it. Both are written "measure first", and it is
  the same measurement — kill a relay with two real daemons running and watch both. Do the
  experiment, then fix what it shows. Sources: DOD-M15-SESSION-RELAY-PINNED-1 and DOD-M15-MULTIRELAY-1.
---

# **<ins>MICRO</ins>** WORK ORDER 016-RELAYLOSS — Kill a relay and watch

> ## THE RULES OF A MICRO WORK ORDER
>
> 1. **Read [[M15-PROCEDURE]] IN FULL before you start.** It is the working discipline for this
>    milestone and it binds you — the gate, the review dispatch, the invariants, how tests are run.
>    **Do not read `M15-DEFINITION-OF-DONE.md` or `M15-BUILD-JOURNAL.md`**; this order carries
>    everything you need from them.
> 2. **MICRO means small.** One mission. Follow it to its end. **Never grow the mission.**
> 3. **Found something else?** Write it under *Newly discovered* at the foot of this file and
>    **keep going**. Do not fix it. Do not investigate it.
> 4. **500 lines, hard cap.** Minimal without omitting anything.
> 5. **Standard procedure still applies:** implement → review (`cello-unit-reviewer`) → fix every
>    finding → commit. Commit per fix, push after every commit. **Closing a unit means flipping
>    this file's `status:` frontmatter to `complete` in the SAME commit as the verdict.**
> 6. **Done is done.** When the Definition of Done below is met, stop.

> ## 🔬 MEASURE FIRST. THE EXPERIMENT IS THE DELIVERABLE, THE FIX IS WHAT IT EARNS.
>
> Both source lines were written "measure first" independently, and neither has been measured. **Do
> not open by writing a fix.** A fix designed against a guess about what breaks is how this area
> produces outages — every incident here came from a change that looked obviously right.

---

## The two questions, and why they are one experiment

Two relays are involved in a conversation, and they fail differently.

**Question A — can you still be REACHED?** Behind NAT, other agents reach you through a circuit
reservation held on some relay. If that relay goes away, are you reachable, and how long does the
gap last?

**What is known:** there is a recovery path. A watchdog polls, and on a lost reservation it logs
`session.standing_receiver.reservation.lost`, quarantines that relay and rebuilds the receiver
against another. **What is not known is the window** — how long you are unreachable while looking
perfectly healthy — and whether the rebuild reliably succeeds.

**Question B — does the CONVERSATION survive?** A session is bound to ONE witness relay, named by
the directory when the session is brokered. `SessionRelayClient` is per `(agent, relayPeerId)`, and
on a dead reader it clears the stream and re-dials — **the same relay**
(`#reconnectFromAnySession` → `#ensureConnected`, both scoped to `this.#relayPeerId`). A blip
recovers. A relay that is genuinely gone is re-dialled indefinitely. **There is no path that moves a
live session to another relay.**

**Nobody has established what that costs the operator.** The reader-ended path settles in-flight
submits `relay_stream_closed`, and its own comment says *"in-flight submits just failed."* The
plausible outcomes run from "messages park harmlessly and the session still seals" to "the
conversation can no longer be witnessed and therefore cannot seal." Those are very different
products, and the difference is one experiment.

**One relay death answers both.** That is why these are one unit.

---

## Part 1 — THE EXPERIMENT (this is the mission)

Two real daemons, a real relay, a conversation in progress. **Kill the relay.** Record, from the
operator's side, not the log's:

1. **Does the send succeed, park, stall, or fail?** If it parks, is it collected later?
2. **Is the message witnessed?** If not, what does the operator see — and does anything say so?
3. **Can the session still be closed and sealed?** This is the one that decides the severity: the
   receipt is the product.
4. **How long is the reachability gap?** From relay death to a working circuit again. A number, not
   an adjective.
5. **Does the standing-receiver rebuild actually succeed**, and against a different relay?
6. **What is the operator told at each step**, if anything?

**Write the answers in the Review section with the evidence.** State plainly what you could not
establish.

---

## Part 2 — EXPLAIN THE CHURN (do not skip this and go straight to adding relays)

Measured from one daemon's log, and it is the reason `MULTIRELAY-1` says *"first, explain the
churn"*:

```
reservation.lost   2,675      reason: relay_connection_gone
reservation.none     664
retries               88
gave_up                9
```

And: **one relay carried 2,648 of 2,675 reservations — 99%** — even though the client already
requests a reservation with every relay it knows (`reservationsRequested: 2`). So "reserves with
exactly one relay" was the OUTCOME, not the request.

**Explain both numbers before proposing anything.** Two and a half thousand lost reservations is not
a fleet-size problem, and adding relays underneath a churn nobody understands buys nothing. An agent
whose reservation is gone is **unreachable by any NAT'd peer while still looking perfectly healthy**
— which is the silent-loss-of-inbound failure the whole reachability design exists to prevent.

---

## Part 3 — FIX WHAT THE MEASUREMENT SHOWS

Scope this from Parts 1 and 2, not from this file. Two things are ruled in advance:

- **`MULTIRELAY-1` is AVAILABILITY ONLY.** It is not a linkability mitigation — that claim was
  withdrawn and is disclosed as bounded elsewhere. Do not reintroduce it as a benefit.
- **The witness relay is named in a directory-signed assignment. A client must NOT pick its own.**
  Widening the re-dial to other relays would let a client choose who witnesses it, which is exactly
  the property `LEAFPARTIES-1` and `CORROBORATE-1` just spent themselves closing. If a live session
  needs a new witness, that is a directory-brokered change — do not assume the shape before Part 1.

> ### ⛔ STOP RULE
>
> **If the fix Part 1 points at is a protocol change, STOP AND REPORT rather than building it.**
> Re-brokering a live session's witness relay touches the directory, the relay and the client, and
> that is a milestone-sized change wearing a micro order's clothes.
>
> **Parts 1 and 2 alone are a complete and successful unit.** They convert two lines that are
> currently guesses into two lines with numbers, and `SESSION-RELAY-PINNED-1` says in as many words
> that it should be **reclassified to post-launch if the measurement shows a conversation parks
> cleanly and still seals.** Recommending that reclassification, with evidence, is a real outcome —
> the call itself is Andre's.

---

## Definition of Done

1. The experiment ran against **two real daemons and a real relay, as separate OS processes**, with
   the relay killed mid-conversation. Not simulated, not a unit test with a stubbed transport.
2. All six questions in Part 1 are answered in the Review section, with evidence, and what could not
   be established is stated rather than glossed.
3. **The severity question is answered explicitly: can the conversation still seal?**
4. The churn numbers are explained — why 2,675 lost, and why one relay held 99% when two were asked.
5. A recommendation on `SESSION-RELAY-PINNED-1`'s classification (stays in the gate / moves to
   post-launch), with the evidence it rests on. **The decision is Andre's; the recommendation is
   yours.**
6. **If a bounded fix is indicated:** it is built, and each new test has been made to fail on purpose
   — revert the fix, confirm it reddens for the reason you expect.
7. **If the stop rule was taken:** that is stated plainly, with what the fix would involve and why it
   is not a micro unit.
8. Gate passes (test / lint / typecheck) in every repo touched.
9. Reviewed by `cello-unit-reviewer`, every finding fixed, verdict quoted below.

**Not in scope:** fanning the hash sequence to several relays for cross-checking (a separate line,
and a different problem — that is about witnessing, not reachability); the seal's own verification;
anything in the screener.

---

## Traps recorded before you start

- **Do not add relays to fix a churn you have not explained.** The fleet is two relays; a third under
  an unexplained failure rate is three unexplained failure rates.
- **"It recovered" is not an answer without a number.** The recovery path exists. The question is how
  long the hole is, and whether anything tells the operator it is there.
- **Do not weaken an existing assertion to make a new test pass.**
- **Killing a relay in a test must kill it convincingly.** A clean shutdown that lets the client
  observe a close is not the case that matters — the incident shape is a relay that stops answering.
  Say which you tested; if you only tested the clean one, say that too.
- **No compatibility branch.** No users. If a fix makes an older shape invalid, delete the older
  shape.

---

## Review

*(Reviewer verdict goes here. One quote. Not a transcript. The Part 1 ANSWERS go here too.)*

---

## Newly discovered

*(One or two lines each. Do not act on them.)*
