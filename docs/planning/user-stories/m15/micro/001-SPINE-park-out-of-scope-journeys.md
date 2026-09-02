---
name: 001-SPINE — Park the out-of-scope cross-machine journeys
type: micro-work-order
date: 2026-08-24
status: complete
description: >
  Skip the four spine journey files whose failures Andre ruled out of the launch gate on
  2026-08-24 (shared documents, and the kill switch), so the remaining red in the lane is
  only work that is still inside the gate. Skip with a named reason. Do not fix them.
---

# **<ins>MICRO</ins>** WORK ORDER 001-SPINE — Park the out-of-scope journeys

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
>    finding → commit. Commit per fix, push after every commit. **Closing a unit means flipping
>    this file's `status:` frontmatter to `complete` in the SAME commit as the verdict** — the
>    two are one fact, and eight orders in a row have shipped with them disagreeing.
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

**✅ CLOSED 2026-09-02.** One pass, `cello-unit-reviewer` on Opus. **SPEC: FAITHFUL, no blocking
findings, two LOWs — one fixed, one was this file.**

> *"Am I rubber-stamping? I don't think so — I attacked clause 3 with my own transform rather than
> the coder's filter, ran the `j-multiplayer` guard's assertion by hand to establish it was green,
> read `j-stale-session` end to end instead of trusting the commit message, and measured vitest's
> hook behaviour rather than assuming it. This diff is 11 tokens wide and touches no runtime code;
> a clean result is what that shape earns."* — `cello-unit-reviewer`

**Clause 3 was proven, not accepted.** The reviewer refused my filter and built its own: it took the
zero-context diff, mechanically transformed every REMOVED line `describe(` → `describe.skip(`, and
diffed that against the 11 added non-comment lines. **Byte-identical, zero differences** — `.skip`
was inserted and nothing else on any line was touched.

**Two things it measured that I had assumed:**

- **A skipped journey reports as `↓ skipped`, never folded into a pass count.** So the lane cannot
  report these as green. Verified by running vitest rather than reading its docs.
- **A file whose every describe is skipped does not run its `beforeAll`.** `j-stale-session` and
  `j-suspend-tofn` start a 3-directory cluster there, so the parked files now cost no ports, no
  Postgres and no minutes, and cannot go red on a cluster-start failure.

**FINDING 1 — FIXED. I switched off a guard that was green and free.** `j-multiplayer`'s
`the built artifact keeps its layer boundary` reads four built `.js` files and asserts the document
layer speaks no relay vocabulary. The reviewer ran its assertion by hand: **green today**, so it
contributed zero red — and 001's mission was to remove out-of-scope RED, not to switch off working
guards. Reinstated, with the reasoning in the code.

> ⚠️ **AND THE FIX COSTS MORE THAN THE REVIEW THOUGHT — measured after applying it.** The guard is
> process-free; **the file's `beforeAll` is not**, and un-skipping one describe re-arms it. The file
> now takes **56 seconds and starts a full cluster** for one assertion that reads four files off
> disk. Kept anyway — a tripwire on vocabulary leaking into shipped code is worth 56s once per lane
> run — but the reviewer's "cheapest correct outcome" was costed on the guard alone, not on the
> hook it wakes. The genuinely cheapest outcome is a separate file with no cluster hook; that is
> scope growth, so it is recorded below rather than taken.

**FINDING 2 — this file.** `status:` was `open` and this section was empty. Fixed in the same commit
as the verdict, which is now rule 5.

**Verdicts:** SPEC: FAITHFUL · NO SILENT FALLBACKS · ERRORS NAME THEIR CAUSE (lens does not fire —
no error handling in the diff) · TESTS HAVE TEETH (no new tests; no assertion weakened; reverting
restores exactly the 11 describes and nothing more) · REMOVALS PROVEN · NO COMPATIBILITY DEBT.

---

## Newly discovered

*(One or two lines each. Do not act on them.)*

- **The layer-boundary guard is in the wrong file.** It reads four built `.js` files and needs
  no cluster, but it lives in a journey file whose `beforeAll` starts three directories — so
  running it costs 56s and a full cluster for a disk read. Its own file, with no hook, makes it
  a second-long check. Not taken here: moving a test out of a journey file is scope growth.
- **`packages/e2e-tests/src/transport-path.test.ts:159` carries a bare `it.skip`** (circuit-relay
  reservation) that predates this unit and carries no reason comment — the silent-skip shape
  this order exists to prevent, sitting outside the four files it was scoped to.
