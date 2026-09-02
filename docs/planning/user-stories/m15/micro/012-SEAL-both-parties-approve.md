---
name: 012-SEAL — Both real participants approve before any signature exists
type: micro-work-order
date: 2026-09-02
status: open
description: >
  Today only the closing party checks the receipt before signing. The counterparty checks after
  `session_sealed`, when the artifact is already durable and there is nothing to invalidate it. And
  the co-signing directories sign whatever bytes they are handed. Move the trust anchor from "the
  verifying directory is honest" to "at least one of the two real participants is honest".
  Source: DOD-M15-SEALPARTIES-1. **Ships with 013-ABSENCE — read the pairing note.** Carries a
  PART 0: the seal journeys currently die at relay auth and never reach a seal, so this unit's
  own enforcer clause is unsatisfiable until that is fixed.
---

# **<ins>MICRO</ins>** WORK ORDER 012-SEAL — Both parties approve before anything is signed

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

> ## 🔗 THIS SHIPS NEAR `013-ABSENCE`. DO NOT SHIP IT ALONE AND LEAVE 013 UNBUILT.
>
> This order tightens the **bilateral** seal. `013-ABSENCE` tightens the **solo** seal, which today
> fires on a stopwatch with no check that the counterparty is actually gone.
>
> **Tighten one and not the other and you have not closed the hole — you have signposted it.** A
> party who cannot get a bad bilateral seal past the new gate simply waits out the timer, or
> engineers the appearance of unreachability, and takes the solo path instead. Sequence them
> together; if only one can land, say so loudly in the journal rather than letting the gap sit
> unremarked.

---

## 🔴 PART 0 — FIRST: the seal journeys must reach the seal. They do not.

**Do this before the seal work, because without it this unit cannot honestly close.** DoD clause 8
requires the enforcer to run as separate OS processes. Today it cannot: **the seal journeys never get
as far as a seal.**

Measured by `014-LEAVES` against the real binaries, not inferred. `j-spine` and `j-unilateral` both
die at relay authentication, long before any leaf is submitted:

```
relay.auth.online_token.missing   ×14–18
session.relay.auth.failed         ×8
relay.reservation.denied          ×6
→ then a standing receiver holding no reservation
```

**The suspect is the online-token path** — the directory issues a short-lived token when it marks an
agent online, and the relay refuses a reservation without it (`DOD-M15-RELAYSLOTS-1` /
`DOD-M15-RELAYAUTH-1`, shipped 2026-09-01, both repos). Something in the spine harness does not carry
it. **Verify that rather than assuming it** — the error string is where the failure surfaced, not
proof of the cause.

**What "fixed" means here:** the seal journeys reach the seal and exercise it. Whether they then pass
is a separate question; getting them to the seal is the deliverable.

> ### ⛔ THE STOP RULE — this is a precondition, not a second mission
>
> **If this is not fixable in a bounded effort, STOP AND REPORT.** Do not rebuild relay
> authentication inside a seal unit. Do not "fix" it by weakening a check that 002 or 008 added, and
> do not fix it by skipping the journeys.
>
> If you stop, say so plainly, write what you established under *Newly discovered*, and **do the seal
> work anyway** — closing this unit with clause 8 explicitly unmet and named is a far better outcome
> than a green tag over an unrun enforcer, or a seal unit that spent itself on transport.
>
> Two of this milestone's units have already lost their evening to exactly this shape.

---

## The problem, plainly

A sealed conversation is CELLO's product. Two people's agents talk, the conversation closes, and a
directory notarizes a receipt that says "this is what was said."

**Today only one of those two people checks the receipt before it becomes permanent.**

- The party who **closes** re-derives the root from their own transcript and refuses to co-sign if
  it does not match. That is a real gate, and it happens before any signature exists.
- The **other** party runs the same comparison — but only **after** receiving `session_sealed`. By
  then the receipt is a durable, notarized artifact, and there is no mechanism to invalidate it.
  They can discover they were misrepresented. They cannot prevent it.

**What that costs a user:** you can end a conversation, be handed a notarized record of it, and have
no say in whether it was accurate until it is already signed and stored. Your objection arrives
after the thing you object to is permanent.

**And the co-signers are not a second opinion.** The other directories in the ceremony verify that
they hold a share and that no conflicting ceremony is running — then sign whatever bytes they are
handed. That is cryptographic weight without judgement: three signatures that all rest on one node's
reading.

**The point of the change, stated once so the shape is clear:** move the trust anchor from *"the
verifying directory node is honest"* to *"at least one of the two real participants is honest."* For
a communication protocol that is a far more natural assumption, and it does not depend on directory
behaviour at all.

---

## The work

1. **Affirmative pre-signature approval from BOTH participants.** The non-closing party must
   re-derive the root from its own transcript and affirmatively approve — **before** any signature
   exists, not after `session_sealed` lands. An absent or refusing party must not produce a
   bilateral seal.
2. **Forward the raw signed leaf data to co-signing directories**, not a claimed root. A co-signer
   should be able to reach its own verdict from what it is given. Today it cannot, because it is
   handed a conclusion.
3. **A refusal is legible on both sides.** If a participant refuses to approve, both operators learn
   that the seal did not happen and why — in the response and the session record, not only in a log.
   Refer to the procedure's *"this guard fires, who hears it?"* rule; it applies directly here.

---

## ⚠️ THE TRAP THAT WILL EAT THIS UNIT: waiting for approval must not become a new way to lose a receipt

Requiring the second party's approval hands the absent party a veto they did not previously have.
**A counterparty who is offline, slow, or hostile must not be able to destroy a receipt by simply
never approving.**

That is exactly what `013-ABSENCE` exists to handle — the solo path. So:

- **Define what happens when approval does not arrive**, and make it the solo path rather than a
  hang or a silent failure.
- **Do not invent a second timeout here.** If you find yourself writing a grace period, stop: that
  is 013's, and two clocks that disagree is worse than either.
- **This is the counterbalance:** the change makes the seal harder to forge and must not make it
  harder to *obtain* for honest parties. Name that tension in the journal before building, per the
  procedure's Invariant 1.

---

## Definition of Done

1. A bilateral seal requires affirmative approval from **both** participants before any signature
   exists.
2. A participant whose transcript disagrees with the proposed root **refuses, and no signature is
   produced** — asserted from the non-closing side, which is the side that could not refuse before.
3. Co-signing directories receive the raw signed leaf data and can reach their own verdict.
4. A co-signer handed leaves that do not support the claimed root refuses.
5. **An honest party does not lose a receipt because the other side is absent** — the no-approval
   case takes the solo path rather than hanging or failing silently.
6. A refusal reaches BOTH operators with a cause, in the response and the session record.
7. Each of 1–6 has a test, and **each has been made to fail on purpose** — revert the fix, confirm
   it reddens, confirm it reddens for the reason you expect.
8. **Part 0 is done: the seal journeys reach the seal** — or the stop rule was taken, and clause 8
   is recorded as UNMET by name rather than glossed.
9. **The enforcer runs as separate OS processes**, per the procedure — a passing unit test is
   necessary and never sufficient for a line like this. This is the clause Part 0 exists to make
   possible.
10. Gate passes (test / lint / typecheck) in every repo touched.
11. Reviewed by `cello-unit-reviewer`, every finding fixed, verdict quoted below.

**Not in scope:** the solo/unilateral trigger (that is `013-ABSENCE`); which leaves are constrained
to which participants (`014-LEAVES`); the relay's live checking (`015-WITNESS`); changing FROST or
the threshold.

---

## Traps recorded before you start

- **Do not weaken an existing assertion to make a new test pass.**
- **The closing party's existing gate is correct — do not remove it** while adding the other side's.
  Two gates is the point.
- **A second opinion that cannot see the evidence is not a second opinion.** If a co-signer still
  ends up signing a conclusion rather than judging leaves, work item 2 is not done however the code
  reads.
- **No compatibility branch.** There are no users and no old sessions; if the new approval step
  makes an older shape unsealable, delete the older shape rather than supporting both.

---

## Review

*(Reviewer verdict goes here. One quote. Not a transcript.)*

---

## Newly discovered

*(One or two lines each. Do not act on them.)*

- **A seal refusal is still broadcast to every agent authenticated on the node**, on the refusal
  paths that fire BEFORE the roster is resolved (the per-leaf signature loop, the chain checks). The
  approval refusal added here delivers to the pair; the earlier ones cannot, because moving the
  roster lookup ahead of the signature loop reorders a precondition several comments depend on. A
  stranger learns a session id and that its seal failed.
- **A message that lands BETWEEN the two SEAL leaves makes the two participants' approvals disagree**
  — the first closer's `final_root` covers a shorter transcript than the second's, so
  `verifySealFinalRoots` returns `seal_final_root_parties_disagree` and the seal is refused. This is
  pre-existing whenever both parties carry their payload (it is not created by requiring both), and
  `directory-node.test.ts` calls the shape *"reachable in production"*. The fix on record for the
  retry version of this is *last carried leaf per sender wins*; nothing re-submits a SEAL leaf when a
  late message lands.
