---
name: 044-INGESTORDER — Where it goes in the order, and whether it lands
type: micro-work-order
date: 2026-09-06
status: open
dod_line: DOD-M15-GODFILE-1
dod_effect: closes
description: >
  The last phase — canonical position, the ordering gaps either side, the append, the undeliverable
  check and the held release. ~260 lines. Unit 5 of 5. Requires 040-043. CLOSES DOD-M15-GODFILE-1
  if session-node-manager.ts is under 4,000 lines when it lands.
---

# **<ins>MICRO</ins>** WORK ORDER 044-INGESTORDER

> 1. **Read [[M15-PROCEDURE]] IN FULL.** 2. **ONE MISSION.** 3. Record and keep going.
> 4. Implement → `cello-unit-reviewer` → fix every finding → commit. 5. Flip `status:` with the verdict.

## The phase

`key` → `canonicalSeq` → `nextExpected` → the gap-ahead branch (HOLD) → the gap-behind branch →
`leafIndex` (the append) → the undeliverable check → the relay witness → `releaseHeld` → the return.

Refuses with `leaf_index_is_not_relay_position_fell_back_to_content_hash`,
`no_ordering_record_deduped_on_content_hash` and `transcript_write_failed`.

## ⚠️ THIS IS THE PHASE THAT WRITES. Everything before it can refuse cheaply; this one appends a leaf
and a transcript row, and a mistake here is a wrong permanent record rather than a rejected message.

- **A gap AHEAD holds; a gap BEHIND does not.** Holding content that arrived early is how the
  conversation keeps its order; refusing it would lose a message the sender believes landed.
- **`transcript_write_failed` means the content was ACCEPTED and then lost.** Its operator message
  must not promise redelivery — unlike the earlier refusals, there is no second route for it.
- **The released content re-enters ingest.** `releaseHeld` is what makes a held message finally
  arrive, and delivery is claimed THERE, not at the point it was held.

## Definition of Done

- [ ] All three refusals fire on the same inputs with the same reasons and the same guidance.
- [ ] The three `ok` shapes (`{ok}`, `{ok, held}`, `{ok, screenedOut}`) are unchanged at every return.
- [ ] `session-node-manager.ts` is **under 4,000 lines**; if it is not, say so and do not force it.
- [ ] The ratchet is lowered to the final size.
- [ ] Full suite green, **zero test files modified**, `build:clean` from scratch.
- [ ] `J-SPINE` 7/7 **and** the stranger enforcer — this phase decides what enters the record.
- [ ] `status:` → `complete`, and `DOD-M15-GODFILE-1` → ✅ in the SAME commit.

## Traps

1. **`leafIndex` is computed by a ternary on `terminalBlock`** and read by three later branches. It
   is the single most load-bearing local in the method.
2. The relay-witness call at the end is conditional on `canonicalSeq === undefined` AND a live relay
   client. Both halves matter; either alone changes when a leaf is witnessed.

## Newly discovered
