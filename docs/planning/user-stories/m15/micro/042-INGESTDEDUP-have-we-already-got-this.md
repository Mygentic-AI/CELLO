---
name: 042-INGESTDEDUP — Have we already got this, and is there room for it
type: micro-work-order
date: 2026-09-06
status: open
dod_line: DOD-M15-GODFILE-1
dod_effect: unit-of
description: >
  The second phase — the tree lookup, the two dedup paths, and the per-session byte cap. ~140 lines.
  Unit 3 of 5. Requires 040 and 041.
---

# **<ins>MICRO</ins>** WORK ORDER 042-INGESTDEDUP

> 1. **Read [[M15-PROCEDURE]] IN FULL.** 2. **ONE MISSION.** 3. Record and keep going.
> 4. Implement → `cello-unit-reviewer` → fix every finding → commit. 5. Flip `status:` with the verdict.
>
> ⛔ **BLOCKED ON 041.** It consumes `senderPubkey` and `contentHashHex`.

## The phase

`tree` → `existingIdx` → the two dedup branches → the byte-cap block. It refuses with
`session_size_limit_exceeded`, and it RETURNS EARLY AND SUCCESSFULLY on a duplicate — which is the
part to be careful with.

## ⚠️ A DUPLICATE RETURNS `ok`, AND THAT IS NOT THE SAME AS DELIVERED

`ingestReceivedContent` returns `ok` in three shapes and only one is a delivery: `{ok}` plain,
`{ok, held: true}` (buffered behind a gap, not shown yet) and `{ok, screenedOut: true}` (leafed and
permanently never shown). A caller that reads `ok` as "delivered" tells the operator a message
arrived when it did not — that defect has already shipped once, on the park-recovery reconciliation
path. **Any refactor here must keep the three shapes distinguishable at every return.**

## Definition of Done

- [ ] Both dedup paths return the SAME shape they do today, including which of the three `ok` forms.
- [ ] The byte cap refuses at the same threshold, with the same tier lookup, and the operator message
      still names the limit in MEGABYTES with the raw byte figure beside it.
- [ ] Full suite green, **zero test files modified**, `build:clean` from scratch. `J-SPINE` 7/7.
- [ ] `status:` → `complete` in the same commit as the verdict.

## Traps

1. **The cap block appears TWICE** — once before screening and once after. They are not redundant:
   screening can rewrite content, so the second measures what will actually be stored. Moving one and
   not the other, or merging them, changes what an operator is charged for.
2. `existingIdx` is `let` and assigned in two branches. See 040 trap 1.

## Newly discovered
