---
name: MICRO-001 — Park the out-of-scope cross-machine journeys
type: micro-work-order
date: 2026-08-24
status: open
description: >
  Skip the four spine journey files whose failures Andre ruled out of the launch gate on
  2026-08-24 (shared documents, and the kill switch), so the remaining red in the lane is
  only work that is still inside the gate. Skip with a named reason. Do not fix them.
---

# **<ins>MICRO</ins>** WORK ORDER 001 — Park the out-of-scope journeys

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

## The mission

Four cross-machine test files fail for reasons Andre ruled **out of the launch gate** on
2026-08-24. Skip them so the lane's remaining red is only in-scope work.

**Skip. Do not fix. Do not delete.**

| File | Why it is out of scope |
|---|---|
| `packages/e2e-tests/src/spine/j-documents.spine.test.ts` | Shared documents are out of the gate. |
| `packages/e2e-tests/src/spine/j-multiplayer.spine.test.ts` | Shared documents are out of the gate. |
| `packages/e2e-tests/src/spine/j-stale-session.spine.test.ts` | Its failure is the document ingest path. **See the caveat below.** |
| `packages/e2e-tests/src/spine/j-suspend-tofn.spine.test.ts` | The kill switch is out of the gate. |

### The caveat on `j-stale-session` — read this before you skip it

That file has **one** failing test, and its failure is document frames not being ingested after a
daemon restart. **If the file contains tests that are not about documents, skip only the failing
test, not the file.** Check first. A whole-file skip that hides passing non-document coverage is
the wrong outcome.

---

## How to skip

- Use vitest's `describe.skip` / `it.skip`, or `.todo` — whichever the file's existing style uses.
- **Every skip carries a one-line reason in the code**, in this shape:

  ```ts
  // SKIPPED 2026-08-24: shared documents are out of the launch gate (Andre). Not a product
  // regression — this test was passing on its own terms before the feature was descoped.
  ```

- **Do not use a `.skip` with no comment.** A silent skip is exactly how this lane rotted in the
  first place — it was switched off everywhere and nobody knew.
- **Do not touch any assertion inside a skipped test.** Weakening an assertion on the way past is
  the failure mode this milestone exists to catch.

---

## Definition of Done

Tightly scoped. All five, no more:

1. The four files above are skipped (or, for `j-stale-session`, the correct subset is skipped).
2. Every skip carries the reason comment.
3. **No assertion anywhere in the repo was changed, weakened, or deleted.** Prove it: paste the
   diff stat and confirm the diff contains only `.skip`/`.todo` markers and comments.
4. `pnpm run lint` and `pnpm run typecheck` pass.
5. Reviewed by `cello-unit-reviewer`, every finding fixed, verdict quoted in the *Review* section
   below.

**Not in scope, explicitly:** fixing any skipped test, running the full spine lane, wiring the lane
into CI, touching any journey not named above.

---

## Review

*(Reviewer verdict goes here. One quote. Not a transcript.)*

---

## Newly discovered

*(Anything you find that is not this mission. One or two lines each. Do not act on them.)*
