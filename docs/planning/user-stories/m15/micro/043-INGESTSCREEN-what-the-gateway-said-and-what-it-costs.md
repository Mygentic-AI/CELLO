---
name: 043-INGESTSCREEN — What the gateway said, and what it costs
type: micro-work-order
date: 2026-09-06
status: open
dod_line: DOD-M15-GODFILE-1
dod_effect: unit-of
description: >
  The third phase — document-frame classification, inbound screening, the terminal block and the
  redact path. ~185 lines. Unit 4 of 5. Requires 040-042.
---

# **<ins>MICRO</ins>** WORK ORDER 043-INGESTSCREEN

> 1. **Read [[M15-PROCEDURE]] IN FULL.** 2. **ONE MISSION.** 3. Record and keep going.
> 4. Implement → `cello-unit-reviewer` → fix every finding → commit. 5. Flip `status:` with the verdict.

## The phase

`isDocFrame` → `inboundVerdict` → `terminalBlock` → `noteTerminalBlock` → `deliverContent`.

## ⚠️ A REDACT VERDICT MUST NOT REWRITE A DOCUMENT FRAME, and the reason is not obvious

Rewriting bytes inside a signed CBOR envelope does not sanitize it — **it destroys it.** The frame
stops decoding, stops being recognised as document traffic at all, and falls through to the
conversation path. For a conversation message a redact is right: the operator sees the sanitized
form while the leaf still binds the original. **The classification therefore has to happen BEFORE
the verdict is applied, and `originalContent` has to survive.** That comment is on the code today;
it moves verbatim and it is the thing to check first if anything here goes wrong.

## Definition of Done

- [ ] `screenedOut` still means LEAFED AND PERMANENTLY NEVER SHOWN, distinct from `held`.
- [ ] The terminal-block path still retains the bytes and still tells the operator, with the same
      reason and the same guidance.
- [ ] Full suite green, **zero test files modified**, `build:clean` from scratch. `J-SPINE` 7/7.
- [ ] `status:` → `complete` in the same commit as the verdict.

## Traps

1. **`noteTerminalBlock` is a CALLBACK declared here and invoked much later**, after the leaf index
   exists. It is the one local that is a deferred side effect rather than a value. Moving the
   declaration without the invocation, or vice versa, silently drops the operator's notice.
2. The screened-out branch is documented as **unreachable today** — the shipping gateway returns only
   `allow` and a fail-closed non-terminal `block`. Keep it. Its comment says it is unreachable, which
   is what stops the next reader deleting it as dead.

## Newly discovered
