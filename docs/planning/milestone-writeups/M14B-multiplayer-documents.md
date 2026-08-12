---
name: M14B — Multiplayer Documents
type: milestone-writeup
date: 2026-08-13
milestone: M14B
status: complete pending promotion — every DoD line ✅ except SHIP-1, whose two remaining clauses are downstream of the operator-run `latest` promotion (connect 0.0.148 / cli 0.0.171 / daemon 0.0.164)
topics: [documents, multiplayer, amendments, epochs, governance, join, fan-out, mesh, crdt, removal, close, milestone]
description: >
  M14B made a shared document hold more than two people. An amendment chain, replayed independently
  by every holder, became the single source of who is in a document, who administers it, and what
  its rules are — and every path that had quietly assumed "the other party" was migrated onto it.
  Three of the four worst defects were found by running the thing, not by testing it, and the last
  one was found by unpacking what shipped.
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

## References

- [[M14B-DEFINITION-OF-DONE]] — the yardstick and the status of record
- [[M14B-BUILD-JOURNAL]] — Entries 1–30, the evidence trail
- [[2026-08-10_2116_multiplayer-artifacts-joining-an-existing-document]] — spec of record, §13 rulings
- [[COLLAB-TIER2-DEFINITION-OF-DONE]] — the parked Tier 2 wave
