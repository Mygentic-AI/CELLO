---
name: MICRO-005 — The checked-then-ignored sweep, RELAY PACKAGE ONLY
type: micro-work-order
date: 2026-08-24
status: open
description: >
  Six times this milestone found a security check that runs, gets the right answer, and is then
  ignored. This sweeps every frame handler and every verification call IN THE RELAY PACKAGE for the
  next one. Scoped to the relay deliberately. Source: DOD-M15-SWEEP-1.
---

# **<ins>MICRO</ins>** WORK ORDER 005 — Checked-then-ignored sweep (relay only)

> ## THE RULES OF A MICRO WORK ORDER
>
> 1. **This file is the whole world.** Do not read or write `M15-DEFINITION-OF-DONE.md`,
>    `M15-BUILD-JOURNAL.md`, or any other milestone document. Everything you need is here.
> 2. **MICRO means small.** One mission. Follow it to its end. **Never grow the mission.**
> 3. **Found something else?** Write it under *Newly discovered* at the foot of this file and
>    **keep going**. Do not fix it. Do not open a line for it. Do not investigate it.
> 4. **500 lines, hard cap.** If this file is growing, you are writing detail nobody needs.
>    Minimal without omitting anything. No scratchpad. No narration of what you tried.
> 5. **Standard procedure still applies:** implement → review (`cello-unit-reviewer`) → fix every
>    finding → commit. Commit per fix, push after every commit.
> 6. **Done is done.** When the Definition of Done below is met, stop. Do not look for more.

---

## ⚠️ THE SCOPE FENCE — read this first

The original line covers **daemon, directory and relay**. That is an unbounded audit and it is not a
micro order.

**This order is the RELAY PACKAGE ONLY.** The daemon and directory halves are separate orders that do
not exist yet. If you find a hit outside the relay package, **write it under *Newly discovered* and
do not touch it.** Crossing that fence is the failure this order is shaped to prevent.

---

## The problem, plainly

The same bug keeps showing up: the code checks something, gets the right answer, and then does
nothing with it.

Two flavours, and **the second one is the sneaky half**:

1. **The check fails and the code carries on.** It logs an error and processes the message anyway.
2. **The proof is missing entirely, so the check never runs** — and missing is treated as fine.

Flavour 2 is how an attacker walks past flavour 1: don't supply a bad signature, supply no signature.

**In three of the six known cases, a comment right next to the code claimed the safety property the
code did not enforce.** That comment is why the gap survived review.

---

## The work

For **every frame handler** and **every verification call** in the relay package, answer two
questions:

1. **Does a failed check take a hard-fail path?** Not a log line. Not a `return null` the caller
   ignores. An actual refusal.
2. **Does a missing or malformed proof take the SAME path as a mismatched one?**

Fix every hit inside the relay package.

**Where a nearby comment asserts a property the code does not enforce: REWRITE it, never delete it.**
The comment is evidence somebody believed it. Rewrite it to say what the code actually does and what
it deliberately does not.

---

## Definition of Done

1. Every frame handler and verification call in the relay package has been walked, and the walk is
   listed here — **one line per handler**, with a verdict of `hard-fails` or `FIXED` or
   `not a check`.
2. Every hit is fixed.
3. Every rewritten comment is listed.
4. Each fix has a test that has been **made to fail on purpose** — revert it, confirm it reddens,
   confirm it reddens for the reason you expect.
5. `pnpm run test`, `pnpm run lint`, `pnpm run typecheck` pass.
6. Reviewed by `cello-unit-reviewer`, every finding fixed, verdict quoted below.

**Not in scope:** the daemon, the directory, the client, and every hit you find in them.

---

## Traps recorded before you start

- **`return null` on a failed check is the classic.** It looks like a refusal and the caller treats it
  as "no data", which is not the same thing.
- **A fire-and-forget `void something.catch(() => {})` swallows the answer entirely.** Ten of these
  were found in one file earlier in this milestone.
- **Do not delete a wrong comment.** Rewrite it.
- **Do not weaken an existing assertion to make a new test pass.**

---

## The walk

*(One line per handler. Fill in as you go. This is the deliverable.)*

| Handler / call | Verdict |
|---|---|
| | |

---

## Review

*(Reviewer verdict. One quote. Not a transcript.)*

---

## Newly discovered

*(One or two lines each. Do not act on them.)*
