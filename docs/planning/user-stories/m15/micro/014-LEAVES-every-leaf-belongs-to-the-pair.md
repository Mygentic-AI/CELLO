---
name: 014-LEAVES — Is every message in a sealed conversation tied to the two participants?
type: micro-work-order
date: 2026-09-02
status: open
description: >
  The seal checks that the final two control entries came from two distinct participants. Nobody has
  ever confirmed the same constraint applies to the CONTENT leaves — the actual messages. This is a
  VERIFY-FIRST unit: answer the question with evidence, and only then decide whether there is
  anything to fix. Source: DOD-M15-LEAFPARTIES-1.
---

# **<ins>MICRO</ins>** WORK ORDER 014-LEAVES — Answer the question, then fix only if the answer is bad

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

> ## 🔬 THIS IS A VERIFY-FIRST UNIT, AND THAT IS THE WHOLE POINT
>
> **Do not start by writing a fix.** The question has never been answered, and the honest outcomes
> are three: it is already constrained (close it, with the proof); it is not (fix it); or it is
> constrained by something incidental that would not survive a refactor (pin it with a test).
>
> **A clean "already covered, here is why" is a complete and successful outcome for this unit.** It
> is not a wasted night — it retires a security question that has been open since the T-of-N review
> and is currently carried as unknown.

---

## The question, plainly

A sealed conversation is a list of leaves: the messages, then two control entries that close the
ceremony.

**What is checked today** (read it yourself in `verifySealLeaves`, `packages/directory/src/directory-node.ts`):
the last two control leaves are a ceremony pair from two **distinct participants**, and the ceremony
**closes the log** — nothing may be appended after the second one.

**What has never been confirmed:** whether every **earlier content leaf** — the actual messages — is
independently constrained to that same pair of people, or whether it is merely internally
self-consistent.

**Why it matters, in user terms.** If it is not constrained, a sealed conversation could contain a
message from someone who was not in the conversation, and the receipt would still verify. The
document says "here is what these two people said to each other," and a third voice is inside it.

**Scope discipline, carried from the original finding:** this does not change the bound of the
already-known MITM scenario — in that case the two participants the record shows are simply A and M
throughout. It is a **distinct unresolved question**, not a restatement of a known one. Do not
inflate it into the MITM finding, and do not dismiss it because that finding exists.

---

## The work

**Part 1 — ANSWER IT. This part is not optional and comes first.**

1. Trace what constrains the sender of a **content** leaf, from the leaf's own signed bytes through
   every check that runs before a seal is certified. Both repos.
2. Answer, with evidence rather than inference: **can a leaf signed by a key that is neither
   participant end up under a certified root?**
3. Answer the near-miss version too: **can a leaf signed by ONE of the participants but belonging to
   a DIFFERENT session end up there?** A cross-session graft is the same class of defect and is
   easier to reach.
4. **Write the answer down in the Review section either way**, with the call sites. State plainly
   what you could not establish from code alone.

**Part 2 — only if Part 1 says it is not constrained.**

5. Constrain it, at the point the seal is certified, using the participant pair the session
   assignment already names. Reuse the existing check rather than writing a second one.
6. A leaf outside the pair means the seal is **refused**, with a named reason that reaches the
   operator — not a warning beside a certified receipt.

**Part 3 — regardless of the answer.**

7. **Pin it with a test.** If it is already constrained, the test asserts that a foreign-signed leaf
   is refused, so a later refactor cannot quietly remove the constraint. **A property nothing
   asserts is a property you will lose.** If the constraint turns out to be incidental — a side
   effect of some other check rather than a deliberate one — say so explicitly, because incidental
   protections are the ones refactors delete.

---

## Definition of Done

1. The question is **answered with evidence**, and the answer is written in the Review section with
   its call sites: is every content leaf constrained to the session's two participants?
2. The cross-session variant is answered too.
3. What could not be established from code alone is stated, not glossed.
4. **If unconstrained:** a leaf outside the participant pair causes the seal to be refused, with a
   named reason that reaches the operator.
5. **A test pins the property either way**, and it has been made to fail on purpose — revert the
   constraint (or, if it was already there, remove it) and confirm the test reddens for the expected
   reason.
6. If the protection turns out to be incidental rather than deliberate, that is stated in the Review
   section in those words.
7. Gate passes (test / lint / typecheck) in every repo touched.
8. Reviewed by `cello-unit-reviewer`, every finding fixed, verdict quoted below.

**Not in scope:** the bilateral approval path (`012-SEAL`); the solo-seal trigger (`013-ABSENCE`);
the relay's live checking (`015-WITNESS`); the MITM finding, which is already bounded and recorded.

---

## Traps recorded before you start

- **Do not report a grep as an answer.** "I searched and found no check" is a hypothesis. Trace the
  call path, or construct the leaf and watch what happens.
- **Do not weaken an existing assertion to make a new test pass.**
- **`verifySealLeaves` is narrower than its name suggests.** It validates the ceremony pair and that
  the ceremony closes the log. Do not read it as a general leaf validator; that assumption is
  probably how this question stayed open.
- **If the answer is "already safe", resist adding a fix anyway.** Adding a redundant check to feel
  productive gives two places to keep correct. The test is the deliverable in that case.

---

## Review

*(Reviewer verdict goes here. One quote. Not a transcript. The ANSWER to Part 1 goes here too.)*

---

## Newly discovered

*(One or two lines each. Do not act on them.)*
