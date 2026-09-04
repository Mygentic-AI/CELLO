---
name: M10C Procedure — How to Work the Milestone
type: procedure
date: 2026-09-04
milestone: M10C
status: open
topics: [m10c, procedure, trust-signals, x, portal, zero-bump, cost-discipline, review]
description: >
  The complete working discipline for M10C (new trust signal types, starting with X). Self-contained
  and authoritative: the gate, the stop rules, the core loop, reviewer dispatch, the blocking
  invariants, cost discipline for a paid third-party API, and the parallel-order contract rule.
  This document is the whole procedure — nothing here defers to another milestone.
---

# M10C Procedure — How to Work the Milestone

**This document is the working discipline for M10C and it binds you.** It is complete on its own.
Everything you need to work a unit is here or in your work order.

**Do not take rules, tags, lines, or journal entries from any other milestone.** Other milestones
have their own gates, their own scope, and their own scoreboards. M10C's scoreboard is
[[M10C-DEFINITION-OF-DONE]] and its evidence record is [[M10C-BUILD-JOURNAL]]. Nothing you do here
touches another milestone's documents.

---

## What this milestone is

**M10C adds new trust signal types, starting with X.**

The trust-signal machinery already exists and was proven once with GitHub: an envelope with a
canonical hash, a directory that notarizes hashes and answers whether one is live, a wallet on the
operator's device that holds signals and presents them, and a portal that composes and mints. Adding
a type is supposed to cost a portal change and nothing else. **M10C is the test of that claim, and
the first type where the operator composes their own signal** rather than receiving whatever the
portal decided to say.

Three work orders, written to run in parallel: the X side (`001-XPROFILE`), the composition
(`002-XCOMPOSE`), and the compose screen (`003-XSCREEN`). Then a live journey, then a debt paid to
the type playbook.

## Position relative to launch

**M10C is outside the launch gate. Nothing here blocks launch.** By the standing test — a
prospective customer cannot get the core value, or loses trust — the launch intent is two agents
connecting and communicating safely, and a second social signal type is new capability.

That does **not** relax the quality bar. It changes only what happens when something turns out
bigger than expected: it can be parked with a trigger and a line in the journal, rather than
lengthening a gate.

---

## 🛑 THERE ARE EXACTLY TWO REASONS TO STOP AND HAND BACK TO ANDRE

**Everything else is a NOPE — do not stop for it. Keep working.**

1. **A manual operation only Andre can do, that blocks you.** For M10C that is a short list and you
   should know it up front: buying X API credits, and anything requiring his X account. Neither
   blocks any of the three orders — see §Cost.
2. **A critical design decision that could cause harm, where you need his guidance.** A genuine fork
   where guessing wrong does damage. The design was settled with him on 2026-09-04 and the
   settled parts are recorded as pinned contracts in the DoD — **check there before deciding
   something is undecided.**

**That is the whole list.** Check-ins, recaps, "should I keep going?", "natural stopping point" —
all NOPE. The durable record is the journal and the commits, not messages to Andre.

- **Never gate, hedge, or ask permission on a CODE change.** Correctness and security fixes ship
  immediately.
- **Outward-facing claim wording is Andre's.** The claim text an operator's counterparty reads is
  fixed in the DoD and in `002-XCOMPOSE`. Propose variants; do not change published wording.

## 🎭 DECISION THEATRE — the failure mode inside the stop rule

Carrying an item for cycles as "waiting on Andre" is a soft stop that reads as diligence. Three
questions — **all three must be NO** for the decision to be yours:

1. **Does it reach OUTSIDE this system?** A bill, a counterparty, a public claim, a published
   package. Local repos and the dev consortium are not outside.
2. **Is it genuinely irreversible?** Not "destructive-sounding" — irreversible.
3. **Is it already authorized in writing?** The pinned contracts and the settled design in the DoD
   are decided; re-asking one is the purest form of theatre.

Any YES → a real gate: **ask once, in one line, park it, never re-list it.** All NO → it is yours.
Do it, journal it, move on. REDO BEATS ASK. Never bundle a real gate with fake ones.

## 🔢 THE SPAWN TRIP-WIRE: three new items from one unit and you STOP

**A COUNT, NOT A JUDGEMENT CALL. Two is fine. THREE TRIPS IT.**

If a single unit produces **more than two** new items — new work orders, backlog entries, findings
needing their own unit, in any combination — **stop before starting any of them** and report to
Andre. Do not begin the third. Do not begin the first two either, if the third has appeared: the
count is of what the unit *produced*, not what is left.

The report is three things:

1. **What you were doing** — the order, and what it was to close.
2. **What the new items are** — each with its user-visible consequence.
3. **Whether the vein is still producing PRODUCTION DEFECTS or has turned into TEST-HYGIENE
   findings.** That question decides it, so answer it straight.

**Andre decides whether you continue.** This is one of the few places where stopping is correct and
continuing is the failure. It exists because the person deepest in a productive vein is the
worst-placed to notice the moment it stopped paying for itself.

---

## 💸 COST — a rule class that does not exist on other milestones

**X has no free tier.** Reads bill a prepaid balance Andre tops up, at roughly one US cent per
profile read. Four rules follow, and all four are hard:

1. **No test, at any level, may contact `api.x.com` or `x.com`.** Not once, not "just to check". The
   OAuth and profile code takes an injected `fetchImpl`; tests pass a double. A test that reaches
   the real API spends real money and fails in CI where no credentials exist.
2. **Signing in must never trigger an X read.** The portal re-mints phone, email and track record on
   every login (`src/server/trust/login-mint.ts`). That is the natural place to wire this up and it
   would bill a penny per login of every operator, forever, with nothing reporting it. **Do not
   touch that file.**
3. **One read per connect, carrying every field.** X bills per RESOURCE RETURNED, not per field, so
   one user object costs the same whether you ask for a handle or for everything. A flow that
   fetches identity and comes back later for the rest pays twice and gains nothing.
4. **A re-mint is free and must stay free.** Recomposing from the stored snapshot touches no
   network. If you find yourself re-reading the profile in order to mint, you have built the
   expensive path by accident.

**No order is blocked by credits.** The live run is `DOD-M10C-XLIVE-1`, a separate line. Everything
else is built and proven against doubles. If you think you need credits to finish a unit, re-read
the unit — you do not.

---

## 🧭 THE REPO IS THE PORTAL. ONLY THE PORTAL.

Work lands in `cello-portal`. Nothing else.

**This is the zero-bump contract and it is a STOP condition, not a preference.** The machinery was
built so a new signal type costs a portal change and nothing else. If you find yourself needing to
edit `cello-client` or `trustless-cello` to land a type, **stop and hand back** — that is not a task
to complete, it is evidence the generic machinery is not generic, which is worth more than the type
is.

`git status --porcelain` stays clean in both other repos for the whole run, except for your own
edits to your work order and the journal in `trustless-cello`. `DOD-M10C-XLIVE-1` asserts it.

## 🔗 THE ORDERS ARE PARALLEL AND THE CONTRACTS ARE PINNED

`001-XPROFILE`, `002-XCOMPOSE` and `003-XSCREEN` may be worked simultaneously by three sessions.
That is only true because the seams between them are decided in [[M10C-DEFINITION-OF-DONE]] as
literal data and signatures, and each order carries its own copy inline.

**If a contract looks wrong to you, STOP AND SAY SO. Do not adapt to it, and do not change it.**
Changing a pinned contract silently breaks the orders you cannot see.

**One compile dependency, and it is not a contract problem:** `003-XSCREEN` imports from
`002-XCOMPOSE`. In separate checkouts it cannot typecheck until 002 has merged. That is expected,
not a defect, and **the wrong fix is to create the missing module yourself** — that produces the
duplicate catalogue `002` explicitly forbids. Write against the signature and integrate when 002
lands.

**WIP limit is ONE per session.** Finish and review your order before taking another.

---

## The core loop (one session = one order)

1. Read this procedure and your work order in full.
2. Expand the order's Definition of Done into a clause checklist, written into
   [[M10C-BUILD-JOURNAL]] before you implement. That checklist is what the reviewer receives.
3. **Tests first. Red before implementation.** Confirm they fail, and confirm they fail for the
   reason you expect.
4. Implement until green.
5. **Make each clause fail on purpose** — see §Made to fail.
6. Gate: `pnpm run lint`, `pnpm run typecheck`, tests at the smallest scope covering what you
   touched.
7. Review with the `cello-unit-reviewer` agent — one pass, on Opus. See §Reviewer dispatch.
8. Fix every finding, **one commit per fix**, pushing after every commit.
9. Quote the verdict in your order's Review section, and **flip the order's `status:` frontmatter to
   `complete` in the SAME commit as the verdict** — the two are one fact.
10. Stop. Done is done. Do not look for more.

### 🔒 WIP LIMIT: ONE. Never start a unit while another is unreviewed.

At most one implemented-but-unreviewed order at a time. If one exists, the only permitted work is
reviewing it, fixing its findings, and closing it. This is a count, not a judgement call.

An unreviewed unit is not "done pending paperwork" — its defects are live and they compound, because
the next unit gets built on a foundation nobody has attacked yet. The only exception is a review
that cannot run (agent unavailable, tooling broken): record that in the journal in one line, and
**still start nothing new.**

### 🎯 MADE TO FAIL — a checker is not finished until it has been made to fail

> **Make it fail on purpose — AND confirm it failed for the reason you think.**

Both halves are load-bearing and the second is the one that gets missed. A mutation harness once
read a non-zero exit code as "a test caught the mutant", when a non-zero exit also means the mutant
did not compile. It did go red. It went red for the wrong reason, and a syntax error was recorded as
a clean catch.

**THE EXEMPLAR CHECK — when a clause names its cases, the test uses THOSE values.** The failure is
choosing the exemplar from your *intent* instead of from the *predicate*: you know what you mean,
you reach for a value that means it, and you never read the condition back to ask which branch that
value lands in. Name the branch your value takes before you run it, then confirm it took that
branch. If the clause enumerates cases, use its values verbatim.

For M10C the sharpest instance is `identity_verified`. The clause is about an **absent** field
normalizing to `false`. A test that passes `false` explicitly exercises a different branch than a
test that omits the key, and only the second is the case the clause is about.

### 🕳️ THE HOLLOW TEST — four questions before a unit is done

The shape: *I write the test for the case I had in mind while fixing — which is the same blind spot
that produced the bug.* The test passes, the gate is green, the property is unheld. The revert test
does not catch this; deleting a guard only proves the test covers code that exists.

1. **What did I stub, and does the property live in the stub?** If you replaced the whole fetch
   layer, ask what asserts the code that *assigns* the value rather than the code that branches on
   it.
2. **Is the fixture the shape that BREAKS, or a neighbouring shape that works?**
3. **Would this assertion pass if the code did NOTHING?** Start recorders `undefined` and assert
   they were set, rather than pre-seeding a plausible default.
4. **Did I assert the OUTCOME or the mechanism's shadow?** *"It did not fail"* is a shadow. Name the
   value.

**And one structural rule: a property asserted only by a COMMENT is not asserted.**

---

## Reviewer dispatch — what the unit reviewer is TOLD

Supply: the DoD line verbatim with all clauses, your clause checklist, the diff, the repo.

**The invariants below are LENSES. Every one fires on every diff, whether or not the order mentions
it.**

> ### 🔁 ASK THIS ON EVERY DIFF THAT REFUSES ANYTHING
> **"This guard fires. Who hears it?"**
>
> Grep the diff for `logger.error(` / `logger.warn(` followed by a bare `return`, or a `throw` no
> caller answers. For each, demand a NAMED surface — the route response, the operator-facing screen,
> a field in the payload. **"The log" is not an answer.** Then ask what the reader does next, and
> whether that remedy actually works.

### Invariant 1 — COUNTERBALANCE (BLOCKING). The client is the adversary's code.

The client is open source and runs on the operator's machine; they can rewrite it. **A guard that
executes only on the party it constrains is not a guard, it is a request.**

For M10C the sharp instance is the compose screen. The tick table, the disabled state, the absent
checkbox — all of it is browser convenience. The mint route must independently refuse a selection
naming a field the catalogue marks `never`, and must read values from the stored snapshot rather
than from the request. **A request that can carry `followers: 99000` is a request to notarize a
lie.**

**Flag as BLOCKING:** any rule whose only enforcement point is code the operator controls.

### Invariant 2 — FAIL LOUDLY, AND LOUD IS NOT THE SAME AS BLOCKING (BLOCKING)

A failure must reach someone who can act. Loud does not mean the operation must stop — a best-effort
step that fails should say so on a named surface and continue, and a step whose failure invalidates
the result must stop.

**Flag as BLOCKING:** a swallowed error; a silent fallback that substitutes something plausible when
what it needed was missing; a failure whose only trace is a log line nobody reads.

### Invariant 3 — THE UPSTREAM CAUSE SURVIVES DOWNSTREAM (BLOCKING)

Errors name their cause, not their exit point. A downstream handler must not overwrite an upstream
descriptive error with a generic one. Wrapping is fine, adding context is fine, *replacing* is not.

For M10C: a failed token exchange, a failed profile read, a malformed profile, a state mismatch, and
a rate-limited refresh are five different things. Collapsing them into "something went wrong" is a
blocking finding — the operator's next action is different in each case.

**Flag as BLOCKING:** a `catch` that discards the caught error's message; a generic reason code
where a specific one was available one frame up.

### Invariant 4 — RESPONSES CARRY AFFORDANCES (BLOCKING on operator-facing responses)

Every status, result or error that reaches an operator or an LM is read by something that must
decide what to do next. **Name the one or two obvious paths in the payload**, not in prose the
caller may not surface. A refusal especially needs one: a rate-limited refresh must say *when it
unlocks*, not merely that it was refused. Do not invent an affordance that does not exist.

### Standing M10C lenses

- **Claim-truth lens (BLOCKING).** No code, comment, tool description, status output, or document
  may assert a property the tree does not enforce. This milestone mints claims that get notarized
  and shown to strangers; a payload asserting something the code did not verify is the worst version
  of this defect available here.
- **Two-dates lens (BLOCKING).** The account age is computed live at mint; the profile figures carry
  the time they were read from X. Any diff that collapses those into one date, or that freezes the
  age into the snapshot, is asserting that stale numbers were measured today.
- **Anonymity lens (BLOCKING).** The `x_anon` payload must contain no handle, no display name, no
  numeric id, no profile URL, and no exact creation timestamp — for every selection the type system
  permits, not merely for the example in the test.
- **Green-test-that-proves-less lens (BLOCKING).** On any new or changed test, ask what it would
  still pass under. Revert test on every new test: drop the clause, watch it fail.
- **Removal integrity (BLOCKING on any deletion).** Proven deadness; absence asserted on the BUILT
  artifact, not the source, because a deleted source file leaves its `dist/` orphan behind.
- **Alpha-cost lens (BLOCKING when it changes a recommendation).** A recommendation that survives
  only on backward-compatibility grounds is not a recommendation. Re-derive against an empty
  database.
- Plus the standing project lenses: **spec fidelity** with per-clause verdicts (silent simplification
  is BLOCKING), **stable-key joins** (`agent_id`, never `agent_name`), **no `node:sqlite`**
  (SQLCipher only), **no mocks for crypto**, **injected logger** with the `domain.noun.verb` taxonomy
  and correlationId threading, **no `console.log` in implementation code**.

**Reviewer:** `cello-unit-reviewer`, one pass, on Opus. Findings fixed one commit each, verdict
quoted in the journal and in the order's Review section.

---

## Journal discipline

[[M10C-BUILD-JOURNAL]] is the evidence record. **Append at EOF, then verify the append landed.**
Never rewrite an earlier entry — correct it with a later one that names what it corrects.

Each entry carries: the DoD line, what was built, the reviewer's verdict quoted verbatim, the
mutation record (what was made to fail and whether it reddened), the gate output, and anything
discovered that was deliberately not acted on.

Status tags live in [[M10C-DEFINITION-OF-DONE]] and nowhere else. The journal carries the reason a
tag was earned; the DoD carries the tag.

## Hard rules

- **Commit per fix, push after every commit.** The gate validates; it does not preserve.
- **Commit by EXPLICIT PATH.** Never `git add -A` or `git add .` — it sweeps another session's
  half-finished work into a commit claiming your green gate.
- **Use file edits, not shell heredocs or `sed`, for code changes.** Andre reviews rendered diffs; a
  Bash-written mutation is invisible to him.
- **One vitest at a time, smallest scope.** Other sessions share this machine.
- **If Docker is not running, start it.** The portal's tests need Postgres. It is not a blocker.
- **A failing test is fixed, never attributed.** Never "flaky" — map producer to consumer to the
  failing line.
- **Never diagnose a race condition.** Find and quote the actual condition instead.
- **No mocks in production code.** No fake responses, no placeholder implementations, no hardcoded
  test values. Connect to the real thing, throw a clear error, or return empty.

## Gate discipline — run it so it can FAIL

`pnpm run lint` and `pnpm run typecheck` must exit 0, and the tests you run must be the ones that
cover what you touched. A gate that cannot fail proves nothing: if every test you ran would stay
green with your change reverted, you have not tested your change.

**Vitest green is necessary and never sufficient.** `DOD-M10C-XLIVE-1` is the enforcer for this
milestone and it is a live journey with a real X account, real notarization, real delivery, and real
presentation. No amount of unit-test green substitutes for it.

---

## Related Documents

- [[M10C-DEFINITION-OF-DONE]] — the scoreboard and the pinned contracts
- [[M10C-BUILD-JOURNAL]] — evidence, verdicts, run output
- [[M10-TYPE-PLAYBOOK]] — the runbook for adding a type, which `DOD-M10C-PLAYBOOK-1` repays
- [[M10-TRUST-SIGNAL-STORAGE-AND-CREATION]] — spec-of-record for the envelope and the mint
- [[M10-TRUST-SIGNAL-TAXONOMY]] — the type catalogue and class definitions
