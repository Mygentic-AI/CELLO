---
name: 040-INGESTSTATE — One object instead of thirty-five locals
type: micro-work-order
date: 2026-09-06
status: open
dod_line: DOD-M15-GODFILE-1
dod_effect: unit-of
description: >
  ingestReceivedContent is 998 lines, 40 top-level statements and 35 locals threaded through all of
  them. It cannot be split while every guard reads locals the ones above it declared. This order
  changes NOTHING about behaviour: it introduces the state object the four following orders need,
  and moves the declarations into it. No guard moves. Unit 1 of 5.
---

# **<ins>MICRO</ins>** WORK ORDER 040-INGESTSTATE

> 1. **Read [[M15-PROCEDURE]] IN FULL.** 2. **ONE MISSION**, never grow it. 3. Found something else?
> Record under *Newly discovered* and keep going. 4. Implement → `cello-unit-reviewer` → fix every
> finding → commit. Push after every commit. 5. Flip `status:` in the SAME commit as the verdict.
>
> ⛔ **036 and 037 already split this file 20,368 → 10,945.** Do not re-litigate that. This order is
> the FIRST of five that take apart the one method they could not.

## Why this exists, and why it is first

`ingestReceivedContent` decides **whether a message is accepted and who it is attributed to**. It is
a linear chain: compute something, and if it fails, quarantine the bytes, tell the operator, return
a named refusal. Measured with the TypeScript parser: **40 top-level statements, 35 locals, 10
distinct refusal reasons.**

**It cannot be cut where it stands**, because every guard reads locals declared by the guards above
it — `record`, `contentHashHex`, `algResolved`, `computed`, `entry`, `senderPubkey`, `tree`,
`inboundVerdict`, `terminalBlock`, `canonicalSeq`, `leafIndex`. A "phase" lifted out today needs
eleven arguments and returns nine.

**So this order does not lift anything out.** It gives those locals one home, so the four orders
after it can move a phase by moving a function that takes `state` and returns `state | refusal`.

## The mission

1. Declare `interface IngestState` in `session-node-types.ts`, one field per local, each carrying
   the comment that is on its declaration today (several are load-bearing — the `origin` field's
   note about the sent/received release path, and `attribution`'s about a row that implies proof it
   does not have).
2. Inside `ingestReceivedContent`, replace the 35 `const`/`let` declarations with fields on one
   `state` object. **Nothing else changes**: same order, same guards, same returns.
3. `pnpm run test` must pass **with no test file modified**. That is the whole proof.

## Definition of Done

- [ ] `IngestState` exists, one field per local, comments carried verbatim.
- [ ] `ingestReceivedContent` declares ONE local and reads the rest off it.
- [ ] No guard moved, no condition changed, no refusal reason added or removed. `git diff` shows
      declaration-shape changes and nothing else.
- [ ] Full suite green, **zero test files modified**. `build:clean` from scratch first.
- [ ] `J-SPINE` 7/7 (see 037's order for the command — it needs nothing from Andre).
- [ ] `status:` → `complete` in the same commit as the verdict.

## Traps

1. **`let computed: Uint8Array;` is assigned inside a `try`.** Moving it to a field changes nothing
   at runtime but WILL change what TypeScript can prove about definite assignment. If tsc complains,
   that is a real difference in what the compiler knows — do not silence it with `!`.
2. **Two locals are declared TWICE** (`senderTier`, `cap`, `priorTotal`, `heldTotal` appear in two
   block-scoped `{ … }` sections). They are separate values. Do NOT merge them into one field
   because the names match — that is a behaviour change wearing a refactor's clothes.
3. `pnpm run test` runs vitest from SOURCE; the binary tests run `dist/`. Verify against the built
   artifact or a whole class of breakage is invisible.

## Newly discovered
