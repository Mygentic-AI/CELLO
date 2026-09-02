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

### How the experiment was run

Two real daemons in separate OS processes, one real relay, one real directory, a session with
messages flowing. The relay was **black-holed** mid-conversation: it kept every socket open and
stopped moving bytes, and new dials hung. That shape was chosen deliberately — killing the process
closes its sockets, and a client that sees a close takes the fast path, which is the recoverable
blip rather than the incident. The killed-process shape was measured too, separately, so both are on
the record.

**Two bounds, stated up front because they change how the answers read.**

- **The outage is client-facing only.** The relay tells the directory its own address, so the
  directory→relay control path did not run through the hole and stayed up. Every outcome below is
  therefore the *optimistic* one: what the client could not do here, it certainly cannot do when the
  relay is gone for everyone.
- **The reachability half could not be measured on this harness.** On loopback the receiver never
  takes a circuit reservation — every node is directly dialable, so there is no NAT for a circuit to
  cross — and the watchdog only watches receivers that had one. This was read from the daemon before
  the outage rather than assumed. Those questions are answered from 32 days of the production daemon
  log instead, which is better evidence for them anyway: real NAT, real relays, real distance.

### The six answers

**1 — Does the send succeed, park, stall, or fail?** It **stalls for ten seconds and then reports
success.** Not a park, not a failure. Ten seconds is the hash-submit timeout expiring, and the
counterparty receives the message normally, because content travels the direct path and only the
*witness* goes through the relay.

**2 — Is the message witnessed? Was anything said?** **No, and nothing the operator could read.**
The response was byte-identical to the healthy send that preceded it, down to a `sequence_number`
that looks like a receipt and is a local index. The daemon knew: it logged the loss at ERROR with an
accurate consequence and an accurate remedy, into a file the agent cannot open. **This is the unit's
fix, and it is done** — the response now carries `witnessed` on every send, plus guidance on the
false case saying what happened and not to resend. Both values are pinned by tests against a real
relay.

**3 — Can the session still be closed and sealed? THE SEVERITY ANSWER.** **No — and the two sides are
told different things, which is what makes it bad.** Closing during the outage took ten seconds and
then:

| Party | What the operator sees |
|---|---|
| One side | success, seal pending, with a root hex |
| Other side | refused: the seal leaf could not reach the witness, retry when the relay is back |

Neither seal leaf reached the witness. One party was told so; the other was told it worked.

The receipt did not appear during the outage and **did not appear on its own after the relay came
back** — nothing retries a refused close. The refused side was then made to perform exactly the
remedy its own message named, and **that did not recover it either**: its leaf is recorded now, and
the answer becomes *the counterparty has not closed* — pointing at the party who did close, was told
it succeeded, and has no reason to look.

**So the receipt is not destroyed, but nothing gets it back on its own.** It needs the side that saw
a success to close again, or the directory's grace window to expire into a unilateral seal. An
operator following the guidance from the side that failed is walked into a dead end.

**4 — How long is the gap?** With a killed relay process and a receiver confirmed to be holding a
reservation at the moment of the kill, **17.0 seconds** from death to the daemon noticing. From
production, across the three agents, a gap without a working circuit runs **3.6 to 4.8 seconds at
the median and 322 to 371 seconds at the 90th percentile**; the windows longer than an hour are all
three agents beginning and ending within milliseconds of each other overnight, which is the laptop
asleep, not a fault.

**5 — Does the rebuild succeed, against a different relay?** **Not answerable here** — this harness
runs one relay. From production: **the second relay was asked 686 times and granted once.**

**6 — What is the operator told?** Before the fix, on the message path: nothing. On the close path:
one side gets a correct, actionable refusal and the other gets a success. And the receipt command,
asked about the stuck session, tells the operator to close it — which they have already done, and
which returned success — and attributes the state to a named daemon defect that is not what
happened.

### Part 2 — the churn, explained

**Why so many lost reservations?** They are not that many failures. Over 32 days there were 3,022
lost-reservation lines, and they group into **746 episodes**. Inside an episode the client rebuilds
on a thirty-second grid and each failed rebuild writes another line, so a twenty-minute blip writes
about forty of them. The count measures watchdog ticks during blips, not relay deaths.

**And more than half of the episodes are the client's own network, not the relay.** In 52% of them
the daemon also lost its directory connection within a minute of the episode starting. Against a
time-shuffled control that figure is 4%, so the association is real and not an artifact of a signal
that is always on. The outcome is bimodal: 1,589 reservations died within one watchdog tick, and
1,516 lasted more than fifteen minutes.

**Why did one relay hold 99% when two were asked?** The premise is wrong twice, and both are
checkable.

1. **The client never asks two.** It walks its relays in order and returns at the first one that
   grants. The field in the log that reads `reservationsRequested: 2` is the size of the candidate
   *list*, not a count of requests — that one mis-named field is the whole reason "the client
   already requests a reservation with every relay it knows" looked true.
2. **The fallback did not help when it ran.** The second relay is only reached when the first has
   already failed. That happened 686 times and it granted a reservation once. This does **not**
   establish that the second relay is broken: those 686 moments are exactly the moments when the
   client was already failing at everything, so the two explanations are not separated by this data.

**What that means for adding relays:** the dominant failure is on the client's side of the wire, and
the one fallback that exists rescued 1 of 686 opportunities. A third relay does not address either
finding.

### Part 3 — what was fixed, and what was deliberately not

**Fixed:** a send that the relay did not witness now says so in the response the agent reads, with
guidance. The relay-dispatch guidance also stops asserting "witnessed" unconditionally — it was
claiming the exact property that had just been lost, as the reason not to worry.

**Not fixed, deliberately:** the close asymmetry and the receipt's misleading remedy are the seal
path, not this one. Fixing them here would grow a micro unit into a different unit's work.

**Not published.** The fix is in the tree and reaches operators only through an npm publish, which is
outside this system and is Andre's step.

**The stop rule was NOT taken, and here is why that is the right call.** It fires when the indicated
fix is a protocol change. What the measurement indicated was that the daemon already knows the fact
and does not pass it to the agent — one field and one guidance string on a local response the daemon
already builds. No wire format, no relay, no directory, nothing bilateral, nothing that a peer on an
older build could misread. Moving a live session to a different witness relay *would* be the
protocol change the rule is about, and nothing here does that or needs to.

### Recommendation on `SESSION-RELAY-PINNED-1`

**It stays in the gate.** The line said to reclassify it to post-launch *if a conversation parks
cleanly and still seals*. Measured, it does neither. It does not park cleanly: every message costs a
ten-second stall and leaves the record, and until this unit's fix it did so without saying anything.
And it does not still seal: the session seals neither during the outage nor after the relay returns,
the two parties are told contradictory things about their own close, and the remedy the failing side
is given leads to a dead end that blames the other party.

The fix this unit shipped closes the *silence* — an operator now sees a message go unwitnessed at
the moment it happens, which is the earliest point anything could tell them. It does not close the
seal half, and the seal half is the receipt, which is the product.

**The decision is Andre's; the evidence is above.**

### Gates

| Repo | Result |
|---|---|
| cello-client | 299 files / 3087 tests pass; lint clean; typecheck clean; build clean, and the fix verified present in the BUILT artifact, not only in source |
| trustless-cello | 189 files / 1932 tests pass; lint clean; typecheck clean |
| the journey itself | passes against the rebuilt binary, with both `witnessed` values asserted |

Two failures appeared in an earlier trustless-cello run and **neither was this unit's**. Both
belonged to the `013-ABSENCE` lane working in the same checkout — a migration number and a spine-file
count that my new journey happened to change. Both were re-run individually and pass. Attributed by
re-running them, not by assuming.

The new unit test was mutated out, typechecked clean so the mutant genuinely compiled, and re-run
alone: it reddens with *expected undefined to be false* on the exact response shape the live run
recorded. Not a compile error and not a lint error.

*(Reviewer verdict goes here.)*

---

## Newly discovered

> ### ⚠️ THE SPAWN TRIP-WIRE FIRED — four items, and none of them was started.
>
> **What I was doing:** `016-RELAYLOSS`, the two open relay lines, converting them from guesses into
> numbers and fixing what the numbers showed. That is finished and reviewed.
>
> **Is the vein still producing PRODUCTION DEFECTS, or has it turned into test hygiene?** Production
> defects. All four are things an operator meets: two are what they are told during an outage, one is
> a log that names the wrong agent, one is a relay that will not grant. None is a test-only artifact.
>
> **The decision to continue is Andre's, not mine.** Nothing below has been started.

1. **Closing during a relay outage tells the two sides opposite things.** One party's close returns
   success with a pending seal and a root; the other's is refused because the seal leaf could not
   reach the witness. Neither leaf reached it. One of them believes the conversation is finished.
   **Post-launch or blocking is Andre's call under the frozen gate.**
2. **A close refused for an unreachable relay is never retried, and re-closing does not recover it.**
   The refused side, doing exactly what its own guidance says once the relay is back, is then told the
   *counterparty* has not closed — pointing at the party who did close and was told it worked. Only
   that second party re-closing, or the grace window expiring, gets the receipt.
3. **The receipt command's remedy does not work in this state.** Asked about the stuck session it says
   to close it — already done, and it returned success — and blames a named daemon defect that is not
   what happened here. A remedy that reads actionable and is not spends the reader's trust as well as
   their time.
4. **The parked-content drain logs the wrong agent.** It dials the relay from whichever agent's
   standing receiver comes to hand while reporting the failure under the agent it was draining for. On
   a one-agent daemon they coincide; on a three-agent daemon they need not, and the log then attributes
   a failure to an agent that was not involved.
5. *(Not an item — a question the data raises and does not settle.)* The second relay granted 1 of 686
   fallback requests. Whether that is the relay or the client's already-failing state cannot be
   separated from this log, because the fallback only ever runs when the client is already failing.
