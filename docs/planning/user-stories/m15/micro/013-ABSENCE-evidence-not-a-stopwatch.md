---
name: 013-ABSENCE — Sealing alone needs evidence the other side is gone, not just a clock
type: micro-work-order
date: 2026-09-02
status: complete
dod_line: DOD-M15-UNILATERAL-1
dod_effect: closes
description: >
  A party can seal without their counterparty once 600 seconds have passed. There is NO presence
  check of any kind — a fully reachable person who takes eleven minutes to reply can be sealed out
  from under them mid-conversation. Add evidenced absence, two tiers, and an artifact that says
  which part of it is weaker. Source: DOD-M15-UNILATERAL-1. **Ships with 012-SEAL.**
---

# **<ins>MICRO</ins>** WORK ORDER 013-ABSENCE — "They've gone" needs evidence

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

> ## 🔗 THIS SHIPS NEAR `012-SEAL`. IT IS THE OTHER HALF OF ONE FIX.
>
> `012-SEAL` makes a two-party seal require both parties' approval. **This order is the door that
> bypasses it.** Ship 012 alone and a party who cannot get a bad bilateral seal past the new gate
> just waits out this timer — or engineers the appearance of unreachability — and seals alone
> instead. Sequence them together.

---

## 📌 TWO THINGS THAT CHANGED AFTER THIS ORDER WAS WRITTEN — read before starting

**1. `j-unilateral` is failing 2 of 3, on the counterparty-absent gate. That is this unit.** So you
have a live target rather than only tests to write: the journey exists, it runs against the real
binaries, and it is red on exactly the behaviour this order is about. `012-SEAL` fixed the
registration defect that used to stop these journeys reaching the seal at all, so the seal path is
now reachable — the remaining red is real.

**2. Part of the solo path is already closed — do not rebuild it.** `014-LEAVES`'s review found and
fixed a separate hole in the same handler: **a stranger could unilaterally seal a session they were
not in**, because `#processSealUnilateral` never checked that the SUBMITTER is a participant. That
now refuses with `unilateral_not_a_participant`.

That is *who is asking*. **This order is about *whether the other party is actually gone*** — a
different question in the same function. Read the existing check, build beside it, and do not
duplicate it.

---

## The problem, plainly

If your counterparty disappears mid-conversation, you must still be able to close and get a receipt
— otherwise anyone can hold your record hostage by walking away. That is why sealing alone exists,
and it is correct that it exists.

**But the only test for "they have gone" is a stopwatch.**

`#processSealUnilateral` compares elapsed time against a 600-second grace period and **performs no
presence check whatsoever.** Confirmed by reading it: the gate is `elapsedMs < graceMs`, and if that
is false, the seal proceeds.

**What that costs a user:** you are in a conversation. You take twelve minutes over a reply — you are
thinking, or in a meeting, or your agent is busy. **The other side can seal the conversation without
you**, and the receipt records you as absent. You were never absent. Nothing checked.

**And the clock itself measures the wrong thing.** The value it counts from is written when the
session is created and is not refreshed by ongoing traffic. So it is not "silent for ten minutes" —
it is **"this session is ten minutes old."** A counterparty who has been actively replying for an
hour is exactly as sealable as one who never answered at all. **Verify this yourself before you
build; if it has changed, say so in the journal rather than inheriting my reading.**

---

## The work

1. **Hybrid trigger — time is a floor, never the whole test.** Pair the time floor with an actual
   delivery-attempt or timeout record. **Elapsed time alone is never sufficient on its own.**
2. **Two tiers.**
   - **Standard (default, unchanged behaviour):** today's flat 600s, no evidence required, no
     dependency on the relay fan-out. Do not regress the ordinary case.
   - **High-stakes (explicit opt-in):** a **3600s** starting point, and the hybrid evidence check is
     **mandatory**, not best-effort.
   - **Opt-in is the only way in.** Nothing in the infrastructure can safely infer that a
     conversation is high-stakes — the relay is deliberately blind to content and the directory never
     sees it. Do not try to detect it.
3. **Split the artifact by strength.** Everything up to the absent party's last signed message is
   exactly as strong as a bilateral seal. Only the uncountersigned tail is weaker. The artifact must
   say which is which, and **a consumer must not be able to mistake one for the other.**
4. **If the clock's source measures session age rather than last activity, fix it here** — refreshing
   on real session traffic is the natural site. A gate that is honestly named but still wrong is not
   the outcome.

---

## Definition of Done

1. A reachable counterparty **cannot** be sealed out by elapsed time alone — asserted with a peer
   that is demonstrably present and past the time floor.
2. An absent counterparty **can** still be sealed around, so an honest party never loses a receipt
   to someone walking away. This clause protects the feature's whole reason for existing.
3. Standard tier behaviour is unchanged for the ordinary case.
4. High-stakes tier is reachable only by explicit opt-in, uses the longer floor, and **refuses to
   seal without the evidence** rather than degrading to time-only.
5. The artifact distinguishes the mutually-signed prefix from the uncountersigned tail, and a
   consumer reading it cannot conflate them.
6. The elapsed-time source measures what its name claims. If it did not before, a test pins it.
7. Each of 1–6 has a test, and **each has been made to fail on purpose** — revert the fix, confirm
   it reddens, confirm it reddens for the reason you expect.
8. **The enforcer runs as separate OS processes.** Vitest green is necessary, never sufficient.
9. Gate passes (test / lint / typecheck) in every repo touched.
10. Reviewed by `cello-unit-reviewer`, every finding fixed, verdict quoted below.

**Not in scope:** the bilateral approval path (`012-SEAL`); which leaves are constrained
(`014-LEAVES`); the relay's live checking (`015-WITNESS`); changing FROST or the threshold.

---

## Traps recorded before you start

- **Refusing too eagerly is the failure mode here.** If the evidence check is unavailable, a
  legitimate party must not be stranded unable to close. Decide what the standard tier does when
  evidence cannot be gathered, and make it the safe direction — that is what the two tiers are for.
- **Do not weaken an existing assertion to make a new test pass.**
- **Absence is a claim, and the claimant benefits from it.** Every piece of evidence should come from
  somewhere the sealing party does not control. Evidence the initiator supplies about the
  counterparty's absence is not evidence.
- **No compatibility branch.** No users, no old receipts. If the split artifact makes an older shape
  unreadable, delete the older shape.

---

## Review

`cello-unit-reviewer`, one full pass, both repos. Nine findings plus three hollow-test findings. Its
own summary of what had to change before close:

> *"the gate itself is sound (A holds no switch over B's standing stream), the two-tier split is
> correct, and the `verifyCertifiedRoot` fix is safe. What needs to change before close is what the
> operator is told (F1), what the receipt's new number actually rests on (F2), and the chain claim
> in V64 (F3)."*

And on the number this order asked for, which is the finding worth reading twice:

> *"`countersigned_through_seq` is documented as un-steerable and is directory-attested on the very
> path this unit is about."*

Every finding is fixed or accepted in writing — the table and the reasoning are in journal entry
013c. F4 (a present counterparty who will never co-sign now has no solo exit) and F5 (a relay
restart erases the evidence a high-stakes seal needs) are accepted costs, stated in the guidance
rather than papered over. F6 is pre-existing and goes to the backlog.

---

## Newly discovered

*(One or two lines each. Do not act on them.)*

- **A park refusal no longer quotes the relay's own retry window.** `016-RELAYLOSS` commit `032f5a5`
  made the send guidance conditional on `wasWitnessed(placed)` (`session-content-handlers.ts:645`),
  and a rate-limited park is unwitnessed by construction — so the upstream relay's "about 45 seconds"
  is discarded and replaced by the unwitnessed-ordering text. Invariant 3 pointing the other way: a
  downstream handler overwriting an upstream descriptive value. It reddens
  `dod-m15-park-envelope-coded-error.test.ts`. **That lane's file and that lane's in-flight review —
  not touched here.**
- **The empty-agent guard has a hole its own comment does not cover.** `m8c-agent-param-1-tools`
  forbids dropping an empty `agent`, but matches only `\(agent \? \{ agent \}` — an object of exactly
  `{ agent }`. The shape `agent ? { target_pubkey, agent } : { target_pubkey }` drops an empty name
  identically and sails through. `cello_initiate_session` carried that shape until this unit
  rewrote it; whether other tools still do was not surveyed.
- **A present counterparty who will never co-sign now has no solo exit.** Auto-acknowledge is
  disabled for a session after an unverifiable message, so such a peer is `alive` forever and the
  gate refuses forever — where before this unit they yielded a solo receipt at 600s. Refusing is
  right (they are not absent) and it is still a real cost. The fix, if it bites, is a
  counterparty-refusal signal, not a weaker gate.
- **The high-stakes tier's evidence lives only in relay process memory.** A relay redeploy erases
  every `gone`, so an honest high-stakes party whose counterparty left before the restart cannot get
  a solo receipt until that counterparty connects and leaves again. The refusal guidance names the
  condition; persisting liveness transitions would remove it.
- **`unknown` liveness is recorded as `DELIVERED`.** Asserting a delivery nobody observed, in the
  same family as the absence claim this order is about. Pre-existing (`DOD-LIVE-2`), and this unit
  made the value load-bearing for the standard tier.
- **The target is never told the session is high-stakes** and is held to its longer floor and
  evidence bar anyway. Forwarding it means a field on the signed assignment.
- **Two lanes are committing into one checkout and the commits interleave.** `016-RELAYLOSS`'s
  commits sit on `m15/013-absence` in both repos (trustless-cello `901bd9c7`, `72901b99`, `5f87081e`;
  cello-client `194296a`, `032f5a5`). Nothing lost, nothing rewritten, but a reviewer reading either
  branch cannot tell the units apart without being told. Journal entry 013b lists which are whose.
