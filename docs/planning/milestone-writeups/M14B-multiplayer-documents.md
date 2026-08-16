---
name: M14B — Multiplayer Documents
type: milestone-writeup
date: 2026-08-16
milestone: M14B
status: complete pending promotion — the delivery half was REPLACED by reconciliation (2026-08-14 pivot, phases P0–P6, all ✅); SHIP-1 remains, downstream of the operator-run `latest` promotion
topics: [documents, multiplayer, amendments, epochs, governance, join, fan-out, mesh, crdt, removal, close, milestone]
description: >
  M14B made a shared document hold more than two people. An amendment chain, replayed independently
  by every holder, became the single source of who is in a document, who administers it, and what
  its rules are — and every path that had quietly assumed "the other party" was migrated onto it.
  Three of the four worst defects were found by running the thing, not by testing it, and the last
  one was found by unpacking what shipped. Then the delivery half was thrown away and rebuilt: after
  five rounds of patching a per-recipient delivery ledger, the milestone pivoted to comparing what
  two holders hold and sending the difference — around 11,500 lines deleted, and the class of bug
  that had been eating the milestone deleted with them.
---

# M14B — Multiplayer Documents

**Started:** 2026-08-11 · **Closed:** 2026-08-13 · **Repos:** `cello-client` (protocol), `trustless-cello` (enforcers, docs)

## What M14B is

A CELLO document was a thing between **two** agents. M14B made it a thing among **up to twenty**,
without adding a server, a coordinator, or a master copy.

The mechanism is one idea: a document's **arrangement** — who holds it, who administers it, what
properties it has — is not stored anywhere. It is **derived**, by replaying the signed genesis
proposal plus an ordered chain of signed amendments, independently, on every holder's machine. Nobody
is told who is in the document. Everybody works it out, from evidence, and gets the same answer.

That choice is what makes the rest possible. A third party can join a document that is already
running and converge to its full current state by replay. An admin can remove someone, and every
remaining holder stops delivering to them *because their own replay says so*, not because they were
instructed to. There is no state to disagree about, because there is no state — only a chain and a
function.

## What an operator can now do that they could not before

- **Bring a third person into a document already in flight.** They see the current text — content
  never sent to them directly, rebuilt from the log — and they see the rules they are agreeing to
  *before* they agree: who is in it, who administers it, whether it is append-only.
- **Have their edits reach everyone**, including holders they have never had a session with. The
  delivery worker opens one.
- **Remove someone, forward-only.** Delivery to them stops and their later edits are refused with a
  reason naming the removal. Their copy stays theirs, untouched, forever — and no surface anywhere
  claims otherwise, because claiming otherwise would be a lie about a file on someone else's disk.
- **End a document and have everyone actually learn about it**, with a per-holder report of who was
  told, because with several people a partial delivery is the ordinary outcome.

## The defects, and how each was found

This is the part worth keeping. **Three of the four most serious defects were found by RUNNING the
system, not by testing it** — and the fourth was found by unpacking a published tarball.

### 1. The fan-out had never worked (found by a reviewer demanding a revert-visible test)

Amendment frames carried no type discriminator, so the router classified every fanned-out amendment
as an ordinary conversation frame. Existing holders had never received one. It passed every test
because the tests exercised the paths either side of the router.

### 2. Ending a document told the wrong person (found by the live fleet)

Found on the real GCP fleet with three real agents, at the last step of the smoke run. `close` and
`kill` addressed `doc.peerAgentId` — the counterparty frozen in at creation — and returned after one
send. With three holders, one was told. And because the genesis peer had just been *removed*, the
ending went **to the one party with no rights left**, while the actual remaining co-author was never
told at all. The operator saw `peerNotified: true`.

Every unit test agreed with it, because with two parties `peerAgentId` is right.

### 3. The fix was half a fix (found by the unit reviewer)

Reported as done, it was not. The **send** side was fixed; the **receive** side still authorised an
ending by `sender === doc.peerAgentId`. Two consequences, both reachable with ordinary commands and
no tampering:

- a **removed** holder could still end the creator's document, leaving two operators in different
  states;
- a **joiner** could never end a document they held — every holder refused their close while telling
  them everyone had heard it.

This produced the rule that outlasts the milestone: **a guard on the sender's side is not a guard.**
Andre's standing constraint was written for adversaries who rewrite their own daemon; this needed no
rewriting at all.

### 4. The close rule was taught wrongly (found by auditing the tarball)

The published `connect` package's tool description still said a document settles "once the other side
has said it too" — after the code had begun requiring every holder. A tool description **is** the
instruction the agent acts on, so an agent following it would report a document finished while
someone was still editing: the very defect the code now prevents, restated in prose and shipped to
the operator's disk. **When a behaviour rule changes, the prose that teaches it is part of the
change** — and it must be audited on the artifact, not the source tree.

## Two rulings taken rather than parked

Both were made under the procedure's stall rule, logged as overturnable, and neither blocked work.

- **A close completes only when EVERY current holder has said it.** It had settled on the creator
  plus the genesis peer, so a three-person document went "finished" once two agreed while the third
  was mid-edit — precisely what the lifecycle unit's own header forbids. Requiring all is the
  conservative direction: loosening later strands nothing, whereas shipping the loose rule leaves
  documents marked closed that never were, and no migration can un-say that.
- **A removal completes the agreement for those who remain.** Otherwise removing the one holder who
  never answered left the document open forever, reporting it waited on nobody, unsettleable —
  control frames are sent once and never swept.

## A fix that broke something, and the test that caught it

Refusing to settle on a chain that would not replay also refused documents with **no chain at all** —
every bilateral document created before amendments existed, which could then never be closed by
anyone. The existing suite caught it in under a minute.

The repair is worth recording as a shape: "cannot answer" was two different facts wearing one `null`.
A document with no chain is **legacy** and settles on its pair; a chain that exists and will not
replay is **unknown** and refuses. Collapsing them cost correctness in one direction and working
documents in the other. There was no single null that was right.

## What proved it

Four spine enforcers plus a fifth journey, all running **three real daemons as three separate OS
processes** against a local directory consortium and relay. That topology is not ceremony: every
serious defect in this milestone was two processes disagreeing about what a third would do, and a
joiner exists in no `peerAgentId` column anywhere, so any single-process test agrees with whatever
the near side already believes.

The live fleet run on the three real agents proved the cooperative path end to end — create, join
mid-life, converge by replay, fan out to a holder with no prior session, remove forward-only — and
then found the ending defect that no test had.

## What this unblocks

Tier 2 (canonicalization, per-batch attestation, the quiescence agreement, divergence records,
purge, schema enforcement) plugs into sockets M14B deliberately left: a final-shape epoch record with
a defined-absent canonical-hash slot, a generic N-signature primitive whose second consumer is Tier
2's agreement check, and a participant list keyed on pubkey that schema write-authority resolves
against as a lookup. **M14B's exit criterion was that Tier 2 rewrites nothing it shipped and migrates
no wire format**, and that criterion held.

## Open, and deliberately so

- **Admin promotion and removal are parked.** The replay engine implements both kinds fully, but no
  verb authors either: `remove_admin` needs signatures gathered from every other admin across
  different machines, and no wire carries a half-signed action between daemons. Either the gathering
  flow gets its own line, or promotion/demotion is declared out of scope in writing — Andre's call.
- **"On the record" for a refused edit from a removed holder** is a product question. Today the
  receiver logs the refusal and acks it, but writes no durable rejection row.
- **SHIP-1's last two clauses** — the live fleet re-run and the trustless-cello lockfile refresh —
  are downstream of the `latest` promotion, which is operator-run by standing rule.
- **Admin promotion/removal is no longer parked** (reversed 2026-08-13): it is owed work with a
  board line. Meanwhile the operator-facing sentences stopped telling people to "demote first" —
  there is no demote command, and an operator who goes looking for one concludes the tool is broken
  rather than that the capability is absent. Today an admin leaves only by removing themselves.

---

## Part two: the delivery half was replaced, not repaired (2026-08-14 → 2026-08-16)

### Why

Five units in a row were the same bug wearing different clothes: something recorded that a
recipient still owed an entry, something else decided whether to retry, and the two disagreed. A
holder would sit with a document that looked converged while another holder waited on an entry the
first believed it had sent. Every fix closed one path and opened another, because the design had a
second source of truth — the delivery record — sitting beside the only real one, the entries
themselves.

Andre's ruling, after the fifth: *"we've painted ourselves into a corner… instead of taking a step
back and thinking through from first principles."* So the delivery machinery was deleted rather
than repaired.

### What replaced it

**Two holders compare what they hold, and send the difference.** Every signed entry names its
causal parents, so what a holder has is a graph, and what they have seen of another author is a
watermark. When two daemons meet, each says where it stands, and each sends exactly what the other
lacks. Nothing records what anyone owes anyone. There is no retry queue, because a difference
recomputed at the next meeting IS the retry. Idempotence stops being bookkeeping and becomes the
absence of a difference: run the exchange three times against a converged peer and nothing moves.

Membership, administration, endings and refusals all became entries in that same graph, so there
is one derivation instead of four: replay the entries, get the state. A close is an entry, and a
document is closed when every current participant has authored one — derived, never stored as a
verdict somebody has to keep true. A removal is an entry too, and removal SPENDS the removed
holder's seat, which is what lets the survivors finish an agreement the departed will never join.

**What travels is unchanged in kind — signed entries over the ordinary session carrier.** What
changed is that nothing decides *whether* to send. Three triggers decide *when*: you committed
something, a party just became reachable, or a periodic sweep came round. All three are pure
latency: every piece of scheduling state is volatile, lose all of it and you lose at most one
sweep interval.

### What it cost, and what it deleted

Around 11,500 lines, with absence asserted on the BUILT artifacts rather than the source — a
deleted source file leaves its compiled output behind, and a warm build re-ships it. Gone: the
content and amendment delivery ledgers, the delivery worker and its sweep, the acknowledgement
frame and its entire receiving half, the control-frame path for endings, the offer/answer join
handshake, the epoch counter that stamped every signed payload, two duplicate membership
derivations, withdrawal, and session hints. Both signing domains were bumped and their frozen
vectors reissued.

The epoch stamp is the one worth naming. It was a per-document counter inside every signed
preimage, and it existed to answer "is this edit still current?" — which causal ancestry answers
better and without a counter two daemons can disagree about. Removing it from a signed payload
meant re-issuing the test vectors that pin the signature format, so it was done as
replace-then-delete: the causal frontier went into the signed bytes first, the stamp came out
after.

### The defects this half produced, and what each taught

**A closed-column document silently ate the last edits before the close.** The inbound gate judged
arriving content by this holder's stored status. An author who edited, went offline, and returned
after everyone agreed to close had that edit terminally refused — the exact edits the exchange
still owed every holder. Rule: a stored status is a projection; when the chain can be derived, the
chain rules.

**Two holders could agree on the fold and still disagree forever about the status column.** The
projection ran one way only, so a document that reopened in the derivation stayed closed in the
column. Rule: a derived projection recomputes in BOTH directions on every applied entry, or it is
not a projection.

**A peer who refused an invitation before ever holding the document showed as "pending" forever**
while the publish gate already knew they had said no. Two surfaces, two answers, and the operator
saw the wrong one. Rule: the surface reads the same record the gate reads.

**A removed holder's own display belief suppressed the exchange that would have told it it was
removed** — for the full ten-minute production window. This one was only visible live: the design
working exactly as written, at a pace no test can watch. It is why the suppression window and the
failure backoff became overridable for tests, and why the override is now clamped so it can only
ever shorten.

**The live gate was claiming a mechanism it never exercised.** The removal journeys asserted the
removed holder's SURFACE and nothing about how the removal got there, so they would have passed
with the mechanism they existed to prove removed. Asserting it turned the journey red and revealed
the truth: a returning holder takes delivery of its own removal as an ordinary parked frame
recovered from the relay, long before its first exchange. Rule: a surface check plus a mechanism
check, never a surface check alone — and when the mechanism check disagrees with the story, the
story loses.

**Dead schema is not harmless.** The criterion "no daemon holds per-recipient delivery rows" was
argued rather than asserted until the very last review pass. Asserting it — by enumerating the
schema against a denylist of delivery-debt column names — immediately found five bookkeeping
columns still standing on the envelope log with no writer and no reader. Nothing was broken by
them. What they would have broken is the next author, who reads `next_attempt_at` off a table and
reasonably concludes retry state belongs on the row.

### What proved it

Seven journeys, three real daemons in three separate OS processes, a three-node directory
consortium and a real relay; 14–18 seconds each. They prove three-way convergence, joining a
document with existing history through the ordinary exchange, a commit reaching a reachable holder
before any sweep could have fired (with the elapsed time asserted against the sweep interval, so
the premise cannot quietly evaporate on a slow machine), removal in both directions, the
behind-with-a-last-seen-time surface, settlement only when every seat has spoken, and a removed
holder being refused when they try to end the document.

**And the write-up owes the other half of that sentence.** Eight criteria are proven only by
in-process tests, and the definition-of-done now lists each with the test that carries it, so the
claim can be checked rather than trusted. Two of those are in-process by nature — they need a
rewritten daemon, and stock binaries cannot stage one. Seven more have no enforcer at all and are
named as gaps: the terminal refusal's live path, an author permanently killed with their history
surviving between the two who remain, relay loss mid-exchange, a joiner stranded when the admitting
admin drops, three-way concurrent editing, closes authored across a partition, and a restart during
an exchange rather than between two.

### One defect promoted out of the test comments

A frame sent immediately after a session opens is sometimes discarded: the sender is told it
succeeded, and nobody learns otherwise. Every enforcer that sends an ordinary message first has
been reliable, which is why the workaround sits in the test harness — but outside the tests nothing
sends a warm-up message. For documents the reconcile model repairs it within a sweep interval,
which is exactly why it kept getting waved past. For an ordinary first message between two agents
there is no such repair. It now has its own board line.

## References

- [[M14B-DEFINITION-OF-DONE]] — the yardstick and the status of record
- [[M14B-BUILD-JOURNAL]] — Entries 1–30, the evidence trail
- [[2026-08-10_2116_multiplayer-artifacts-joining-an-existing-document]] — spec of record, §13 rulings
- [[COLLAB-TIER2-DEFINITION-OF-DONE]] — the parked Tier 2 wave
