---
name: 037-SESSIONCORE — The part of the god file that cannot be moved
type: micro-work-order
date: 2026-09-06
status: complete
dod_line: DOD-M15-GODFILE-1
dod_effect: unit-of
description: >
  THE FOLLOW-ON TO 036, not to any later order. 036 took session-node-manager.ts from 20,368 to
  16,934 by moving every seam with a short dependency list; this order does the redesign 036 refused
  to disguise as a refactor. DELIVERED 16,934 → 10,945 across eleven collaborators, each reviewed.
  ⚠️ Unit 1 as written (a SessionRegistry owning session state) was NEVER BUILT — eleven extractions
  landed without it and it was not the blocker. The blocker is one method: ingestReceivedContent,
  998 lines and 38 guards, which orders 040-044 take apart.
---

# **<ins>MICRO</ins>** WORK ORDER 037-SESSIONCORE — The part of the god file that cannot be moved

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

## Progress — 16,934 → 12,254 (as at 2026-09-06)

| Unit | What | Lines after |
|---|---|---|
| — | `session-salts.ts` — the per-session content salt and its 11 maps | 15,546 |
| — | `session-schema.ts` — every CREATE TABLE / ALTER TABLE (785 lines of DDL) | 14,759 |
| — | `session-queries.ts` — 45 methods that are only SQL | 13,849 |
| — | `refusal-notices.ts` — refusals an operator can actually see | 13,407 |
| — | `session-ephemerals.ts` — the throwaway keypair and the content key | 12,923 |
| — | `session-liveness.ts` — liveness and impairment | 12,627 |
| — | `witness-alerts.ts` — what a relay said it saw | 12,553 |
| — | `held-content.ts` — content held behind an ordering gap | 12,254 |

**Every unit gated on `build:clean` from scratch, lint, typecheck, 434 files / 4,963 tests, and the
LIVE `J-SPINE` journey 7/7 including the bilateral seal. No test assertion changed anywhere.**

**The acceptance test is moving as predicted.** `#evictSessionCaches` cleared **24** per-session
containers by hand; it clears **11** now, with the rest behind `evictSession` calls on the
collaborators that own them.

---

## ⚠️ THE WALL, MEASURED — what stands between 12,254 and 4,000

**Unit 1 was not needed as written.** The order proposed a `SessionRegistry` first, on the hypothesis
that every large context was large because everything reaches for `#activeNodes`. That hypothesis was
only partly right, and eight extractions went in ahead of it without one — so the registry is still
available, but it is not the blocker.

**The blocker is the content path, and it is one method deep.** Measured with the TypeScript parser:

| cluster | lines | context |
|---|---|---|
| `ingestReceivedContent` + `sendContent` + `#handleContentStream` (+ their held/append helpers) | **3,190** | **43** |

A context of 43 is the manager with an extra hop. These three cannot move as a unit, and they are
where the remaining mass is.

### What decomposing `ingestReceivedContent` actually means

It is **998 lines and 38 top-level statements**, and the shape is a LINEAR REFUSAL CHAIN: compute
something, and if it fails, quarantine the bytes, notice the operator, and return a named refusal.
In order — no session record, unreadable hash algorithm, hash recompute, hash mismatch, no sender
pubkey, dedup against the tree, document-frame classification, inbound screening, terminal block,
post-screen dedup, ordering gap ahead, ordering gap behind, undeliverable position, relay witness.

**So it decomposes into guard functions — but not by moving them.** Each guard reads and writes
locals threaded through the whole chain (`record`, `computed`, `senderPubkey`, `tree`, `entry`,
`isDocFrame`, `inboundVerdict`, `canonicalSeq`, `leafIndex`). Splitting it means defining the state
those guards share and passing it down a pipeline: a redesign of the control flow, on the path that
decides **whether a message is accepted and who it is attributed to**.

**That is a genuinely different risk class from the eight units above**, all of which were
restructures whose correctness the existing suite could confirm. This one changes the shape of the
decision itself. It wants its own order, red-first tests per guard, and the stranger enforcer — not
another extraction pass.

**The recommendation:** stop 037 where the seams stop, and make the ingest chain its own unit with
its own risk budget. The ratchet holds whatever number 037 ends on, so nothing regrows in the
meantime.

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

### ❗ THE SHORT-CONTEXT HYPOTHESIS IS FALSIFIED — this is the finding this order asked for

The Definition of Done says: *"Each of Units 2–5 lands as a collaborator with a context that is a
SHORT LIST. If a unit's context is still long after Unit 1, that is a finding to report, not a thing
to force."* Reporting it.

Eleven collaborators have now been extracted. Their context sizes, measured with the TypeScript
parser rather than estimated:

| collaborator | context members |
|---|---|
| `session-queries` | 5 |
| `session-salts` | 20 |
| `session-lifecycle` | 33 |
| `standing-receivers` | 33 |
| `session-seal` | 41 |
| `session-relay` | 47 |
| `session-content-*` (shared) | 56 |

**A short context was not achievable for any of the four big paths, and forcing one would have cost
more than it bought.** The reason is not that the extraction was done carelessly — it is what this
class actually is. Inbound ingest reads session state, held content, salts, ephemeral keys, the
relay client, the ordering record, the screening gateway and the transcript, and it does so inside
ONE method whose forty guards each read locals the guards above them declared. Buying a narrow seam
there means rewriting that method, and rewriting the ingest path is a correctness risk on the most
load-bearing code in the product.

**What was traded instead:** the contexts are WIDE but every member is named and typed, so what a
file can reach is a list a reader can check rather than a `this`. That is a real improvement over
555 members on one class, and it is the improvement that was available.

**Two things this predicts for anyone planning further extractions.** First, do not budget for a
20-member interface; budget for 30–50 and spend the effort on getting each member's TYPE right
instead. Five signatures in the relay unit alone were wrong on the first pass, and each compiled as
a plausible wrapper while silently losing something load-bearing — an attribution, an enum, an
object flattened to a string. Second, `SessionRegistry` as this order imagined it was never built
and the split landed anyway; it should not be revived on the assumption that it would have shrunk
these numbers.

### The salt and freeze paths are still half-out

Not this order's job, recorded so the next reader does not assume the four paths accounted for
everything. `SessionSalts` exists and owns eleven maps, but `#sendSaltFrame`,
`getSessionContentSalt`, `getSessionContentSaltState` and `handleSaltFrameForTest` — roughly 200
lines — are still on the manager. And the freeze path (`#freezeSession`, `#freezeOnIdentityFailure`,
`#freezeSessionForKeyRefusal`) is session lifecycle by any reading, while its consumer now lives in
`session-lifecycle.ts` — so that file holds a reader of the frozen map without its writer.

### The lazily-opened stores are created in eleven places

`relayReceiptStore` and `sealLeafStore` are each opened on first use, and the same
`if (!store && db) store = new Store(db, logger)` is repeated across the manager, the seal path and
the relay path. Three files can now open them. Every repetition is a chance for a second store over
the same rows; one accessor would collapse the lot. A redesign, not a move.
