---
name: 037-SESSIONCORE — The part of the god file that cannot be moved
type: micro-work-order
date: 2026-09-06
status: open
dod_line: DOD-M15-GODFILE-1
dod_effect: unit-of
description: >
  036 took session-node-manager.ts from 20,368 to 16,935 by moving every seam with a short
  dependency list. What is left — standing receiver, salt, seal, relay — is one connected component
  that pure movement cannot reach: contexts of 23, 35, 36 and 35. This order does the REDESIGN that
  036 deliberately refused to disguise as a refactor: give the session registry an owner, then let
  the four domains become collaborators of it.
---

# **<ins>MICRO</ins>** WORK ORDER 037-SESSIONCORE — Give the session registry an owner

> ## THE RULES OF THIS WORK ORDER
>
> 1. **Read [[M15-PROCEDURE]] IN FULL before you start.** It binds you.
> 2. **036's rules still apply, EXCEPT Rule A.** Comments still move verbatim (Rule C), no private
>    field becomes public (Rule D), back-compat is still deleted (Rule F). **What changes is that
>    this order is ALLOWED to change structure** — that is the whole point of it existing.
> 3. **BEHAVIOUR STILL MAY NOT CHANGE.** Structure changes; what the daemon does does not. The test
>    suite passing unmodified is still the evidence, and a test that HAS to change is still a stop
>    condition.
> 4. **Found something else?** Record under *Newly discovered* and keep going.
> 5. Implement → review (`cello-unit-reviewer`) → fix every finding → commit. Push after every commit.

---

## Why 036 stopped, in one paragraph

036 was a pure-movement order and it obeyed its own rule. It extracted every seam whose dependency
list was short — five modules, 3,433 lines — and then **measured** that the rest could not follow.
The four remaining domains need 23, 35, 36 and 35 things from the manager. A 35-member context is
not an interface; it is the manager with an extra hop, which 036's own TRAP section names as one of
the two outcomes *worse than the god file*. So 036 recorded the finding instead of forcing it.

**The structural fact, measured with the TypeScript compiler's parser:** the class's state is ONE
connected component — 280 methods, 221 fields, all transitively sharing state — and **47% of the
method lines sit in 55 methods that each touch five or more state fields.**

---

## 🎯 THE ONE IDEA THIS ORDER IS ABOUT

**Every large context in 036's scan was large for the SAME reason: everything needs the session
registry.** `#activeNodes`, `#standingReceivers`, `#agentsWantingReceiver` and the per-session maps
hanging off them are what salt, seal, relay and the receiver all reach for. There is no cut line
through the state graph **because the registry sits in the middle of it and has no owner.**

> **So the first unit is not an extraction. It is giving `#activeNodes` and its siblings a class of
> their own — a `SessionRegistry` — and passing THAT to the collaborators instead of passing the
> manager.**

Once the registry is a thing you can hold, a collaborator's context stops being "35 pieces of the
manager" and becomes "the registry, plus three or four services". **That is the hypothesis this
order tests, and it is falsifiable: if the contexts do not shrink after Unit 1, stop and say so.**

---

## The units, in dependency order

### Unit 1 — `SessionRegistry`. Blocking; everything else depends on it.

The live-session registry becomes an object: `#activeNodes` and the per-session state keyed
alongside it. Not a data bag — it owns the operations the manager currently performs on those maps
(look up, insert, evict, enumerate).

**`#evictSessionCaches` is the acceptance test for this unit.** It touches **29 fields** — it is the
single method that proves the state is one blob, because forgetting a session means knowing every
map that might hold a piece of it. When the registry owns the session's state, eviction is the
registry forgetting one key, plus a call to each collaborator that holds its own (036 already did
this twice — `InboundRefusals.evictSession` and the park memo — and those are the shape to copy).

**If `#evictSessionCaches` does not get dramatically smaller, the registry is not carrying its
weight and the design is wrong.** Measure it before and after; put both numbers in the commit.

### Unit 2 — Standing receiver (~1,634 lines, context 23 before Unit 1)

The pre-created open-gater node, its rebuild path, its reservation watchdog. It has 11 fields of its
own — the most owned state of any remaining domain — which is why it goes first of the four.

### Unit 3 — Salt / session content encryption (~1,921 lines, context 35)

The per-session key agreement and the content seal/open path. **Read the UNSALTED_REASONS table and
its guidance strings before touching anything** — they are operator-facing and several distinguish
"your counterparty predates this" from "our own write failed", which is a distinction people have
already been misled by once.

### Unit 4 — Seal (~2,137 lines, context 36)

Seal readiness, leaf submission, the auto-acknowledge path, frontier comparison. **The highest-risk
unit in the order** — it is the receipt, and `M15-PROCEDURE` §1c's receipt enforcer is what proves it
still works. Do not close this unit on unit tests.

### Unit 5 — Relay client lifecycle and reservations (~2,603 lines, context 35)

Reservation retry, respread, quarantine, witness alerts, the detached-client builder.

---

## ⚠️ Traps, carried forward from 036 because they were paid for once already

1. **`dist/` lies after a move.** `tsc --build` never deletes an output whose source is gone. Use
   `pnpm run build:clean` and verify deletions against the BUILT artifact, never `src/`.
2. **VITEST RUNS FROM SOURCE; THE BINARY RUNS `dist/`.** 036 shipped a change that passed lint,
   typecheck and 4,950 tests, and broke every test that spawns the real daemon — a type imported
   without the `type` keyword becomes a runtime import that does not exist. **A source-only gate
   cannot see this class of breakage at all.**
3. **Field initializers run in declaration order.** A collaborator built as a field initializer that
   closes over `#logger` reads it before it is assigned. Build collaborators in the CONSTRUCTOR.
4. **A `static #private` cannot cross a file boundary.** When a shared constant's readers end up in
   two files, export it from one module — do NOT copy the value, which is exactly the drift the
   constant existed to prevent.
5. **Do not hand-roll a TypeScript parser.** 036 lost time to a brace-counting scan that silently
   truncated any method whose return type contained `{}`, which then under-read how much state each
   method touched. Use `ts.createSourceFile` and `getStart(sf, true)` — the `true` is what makes
   leading comments travel with their code.

---

## Definition of Done

- [ ] `SessionRegistry` exists and owns the live-session state; `#evictSessionCaches` is measurably
      smaller, with both numbers in the commit.
- [ ] Each of Units 2–5 lands as a collaborator with a context that is a SHORT LIST. **If a unit's
      context is still long after Unit 1, that is a finding to report, not a thing to force.**
- [ ] `session-node-manager.ts` is **under 4,000 lines** — 036's original target, now reachable.
- [ ] The ratchet in `cello-client/eslint.config.mjs` is lowered after every unit, to the new size.
- [ ] No `#private` field became public, verified per field.
- [ ] The full suite passes with no test file modified except import paths.
- [ ] No comment summarised, shortened or dropped — count comment lines before and after.
- [ ] `pnpm run build:clean` leaves no `dist/` artifact whose source is gone.
- [ ] **The receipt enforcer and the journey enforcer both ran green as separate OS processes**
      (§1c). Unit 4 does not close on vitest.
- [ ] A live two-daemon smoke test: session, messages both ways, seal.
- [ ] `status:` flipped to `complete` in the same commit as the verdict.

---

## Explicitly out of scope

- **`daemon.ts` (6,080) and `directory-node.ts` (~7.4k).** Both are owed the same treatment; both
  are grandfathered in the ratchet and neither is this order.
- **Wiring the retry-drain hook.** 036 found that `setRetryDrainHook` has no caller, so the drain on
  session revival has never run — the operator-visible cost is duplicate transcript entries after a
  reconnect. It is recorded in 036's *Newly discovered* and it is a behaviour fix, not a refactor.

## Newly discovered

_(Anything found while working that is not this mission. Record and keep going.)_
