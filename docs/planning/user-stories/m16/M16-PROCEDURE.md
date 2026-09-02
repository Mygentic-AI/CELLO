---
name: M16 Procedure — How to Work the Milestone
type: procedure
date: 2026-09-02
milestone: M16
status: open
topics: [m16, broadcast, channels, procedure, runbook, work-orders, weak-executor, planner-coder-split]
description: >
  The operating runbook for M16 (broadcast channels). SELF-CONTAINED — no other milestone's
  procedure needs to be read. Read FIRST, then M16-DEFINITION-OF-DONE. The structural difference
  from M15: the coding agents on this milestone are LESS CAPABLE models, so all interpretation
  happens at planning time — a strong planning session expands every DoD line into a mechanical
  WORK ORDER before it is pulled, and the coder executes the work order without ever reading the
  design log. §3 is the work-order template; §4 is the coder rulebook.
---

# M16 Procedure — How to Work the Milestone

## §0. REALITY CHECK — read before anything

One user: Andre, also the only developer. CELLO is **alpha — no production users, nothing to
migrate.** Wire-format and schema decisions in Tier 0 are free today and never get cheaper; that is
why Tier 0 is first and why its work orders get the most planning attention.

**BACKWARD COMPATIBILITY IS FORBIDDEN, not optional.** There is no one using the old code, no data
to preserve, no sessions in danger. A compat shim, a legacy-format reader, a migration for pre-M16
rows, a deprecated-but-kept code path, a version-negotiation branch — every one of these is **dead
code on the day it is written**, and dead code is where defects hide from review. The right move is
always: change the format, change the schema, upgrade every daemon, delete the old path in the same
diff. If a change breaks something existing, the fix is to update the existing thing, never to
support both. (This is the standing "would I build this on an empty database?" rule — the answer is
always build it as if yes, because the database IS empty.) Weak coders add legacy support
reflexively because it looks diligent; planners name it in every work order's FORBIDDEN section
where the temptation exists, and reviewers treat any compat path as a blocking finding.

M16 sits **outside the M15 launch gate** — launch does not wait for it. Work lands in **both
repos**: `cello-client` (crypto, protocol-types, transport, client, connect) and `trustless-cello`
(relay, directory, daemon-side infra). The npm boundary (`/cello-publish`) and any GCP roll are the
two external reaches, and both are Andre-gated or planner-gated — never coder-initiated.

## §1. THE ONE STRUCTURAL RULE — planner interprets, coder executes

**The agents writing this code are less capable models than the one that planned it.** Every
process choice below follows from that single fact.

- **A PLANNING SESSION (strong model, with Andre available) expands each DoD line into a WORK
  ORDER before the line is pulled.** The work order is complete: interfaces, file paths, enumerated
  tests, exact event names, forbidden shortcuts, verbatim verification commands. Expansion at
  planning time replaces M15's expansion at pull time — that expansion is a judgment step, and it
  does not belong to the coder on this milestone.
- **The CODER executes exactly one work order at a time.** It never reads the design log, never
  reads another milestone's procedure, never re-derives a decision. Everything it needs is inside
  the work order — if it is not, that is a planner defect, and the coder stops (§5).
- **Why the design log is off-limits to coders:** it is an exploratory record that contains retired
  designs presented with their full original reasoning — a session-based broadcast, a three-layer
  reply-enforcement scheme, an anonymous pull mode. A strong reader knows they are retired; a weak
  reader will faithfully implement one. The DoD and the work orders contain every settled decision
  already inlined.
- **The REVIEWER is `cello-unit-reviewer`, one pass per unit, two is the hard cap.** The reviewer
  receives the work order itself as the spec — per-clause verdicts are against the work order's
  numbered clauses, so "spec fidelity" is checkable line by line rather than a judgment call.

## §2. WHERE THINGS LIVE

| Artifact | Location |
|---|---|
| Scoreboard (status authority) | `M16-DEFINITION-OF-DONE.md` — tags flipped in place, one line of evidence + journal pointer |
| Micro work orders | `docs/planning/user-stories/m16/micro/NNN-SLUG-<short-name>.md` — the proven M15 format (see `m15/micro/` for fifteen worked examples). Numbered in issue order; frontmatter carries `Source: DOD-M16-<LINE>`; one DoD line may produce several orders. |
| Build journal | `M16-BUILD-JOURNAL.md` — evidence, run output, reviewer verdicts, finding dispositions. Append-only. |
| Design source | The 2026-08-23 broadcast-channels discussion log — **planner-only reading** |

## §3. THE MICRO WORK ORDER — inherit the M15 format, tightened for weaker coders

**The M16 work order IS the M15 micro work order** — the format proven fifteen times in
`m15/micro/` (015-WITNESS is a good exemplar). Everything that format already mandates carries
over unchanged:

- **The rules header**, updated to name M16: read M16-PROCEDURE in full first; do NOT read the DoD
  or the journal — the order carries everything needed from them; MICRO means small, one mission,
  never grown; **500 lines, hard cap**; commit per fix, push after every commit; **closing a unit
  means flipping the order's own `status:` frontmatter to `complete` in the SAME commit as the
  reviewer's verdict.**
- **The section shape:** *The problem, plainly* → *The work* → *⚠️ WHAT MUST NOT CHANGE* →
  *Definition of Done* (numbered clauses) → *Not in scope* → *Traps recorded before you start* →
  *Newly discovered* (foot of file).
- **The revert test:** every DoD clause has a test, and each test is made to fail on purpose —
  revert the fix, confirm it reddens, confirm it reddens for the expected reason.
- **The enforcer clause:** separate OS processes, output quoted; vitest green necessary, never
  sufficient.
- **"Found something else? Write it under *Newly discovered* and KEEP GOING."** Do not fix, do not
  investigate. (M16 delta: the planner triages that section at unit close through §5a — same-day
  disposition, severity screen, frozen line count.)

**What M16 tightens, because the coders are weaker models than M15's:**

1. **No open decisions inside an order.** An M15 order could say *"consider — and decide in
   writing — whether the relay should also refuse to relay"*; that was correct for a strong coder
   and is banned here. Every such fork is decided by the planner before issue. If the coder meets
   an undecided question, that is a §5 stop, not an invitation.
2. ***The work* section carries the design, not just the mission.** Exact TypeScript interfaces,
   exact file paths for new files, packages touched, any new table's schema written out (keyed on
   `agent_id` or channel pubkey, never `agent_name`). The coder designs nothing and adds no
   dependencies.
3. **Tests are enumerated, not implied.** Test file path, test name, setup, action, exact
   assertion — written by the planner. Fixtures extend
   `packages/e2e-tests/src/session-fixture.ts` via `opts` with non-breaking defaults; a
   from-scratch fixture is a blocking review finding. Failure-path tests are listed explicitly:
   for every FORBIDDEN fallback, a test proving the code fails loudly with the named error.
4. ***WHAT MUST NOT CHANGE* names the temptations, unit by unit.** Generic "no silent fallbacks"
   does not land on a weak model. Each entry names the specific missing input and the specific
   wrong recovery, with the required behavior and the test that proves it — e.g. *"if the group
   key is absent, do NOT fall back to plaintext; throw `channel_key_missing`; test 7 proves it."*
   Backward-compat shims (§0) are restated here wherever the unit makes them tempting.
5. **Observability is verbatim.** Every log event name (`domain.noun.verb`), its required context
   fields, and where the correlationId is minted and threaded. A missing or renamed event is a
   blocking finding.
6. **Verification commands are copy-pasteable.** The gate sequence and the enforcer as exact
   commands, with the shape of passing output described — including, for multi-process enforcers,
   the processes to start, in order, and which output line proves the property.

**Planner obligations before issuing an order:**

- **Split until it is genuinely micro** — executable in one sitting. A weak coder holding a long
  context loses the early constraints.
- **Run the falsification step yourself** (does the call site hold the right interface; does
  responsibility live where the change goes) — the coder cannot be relied on to.
- **Cross-repo orders carry the cascade explicitly:** which package bumps where, and that
  `/cello-publish` and any publish step are planner/Andre work — a coder's order ends at
  "committed, pushed, journal updated," never at "published."

## §4. THE CODER RULEBOOK — mechanical, no judgment required

1. **ONE SESSION, ONE MICRO WORK ORDER.** The order file is the complete handoff: a session is
   opened, given one order, and told *get this done and just this done*; when the order's status
   flips to `complete`, the session's work is over. The next order gets a FRESH session — never a
   continuation — so nothing from the last unit (assumptions, leftover context, half-remembered
   constraints) bleeds into the next. This is the WIP limit and the encapsulation boundary in one
   rule, and it is what keeps a tightly-scoped order from becoming a launching pad for "everything
   nearby."
2. **Tests first, all red, then implement, all green.** In that order, no exceptions. If a test
   cannot be made to go red (it passes before you implement), the test is wrong — fix the test,
   do not delete the assertion.
3. **The gate, in order, before every commit:** `pnpm run test` → `pnpm run lint` →
   `pnpm run typecheck`. In trustless-cello, typecheck IS the build — do not go looking for a
   missing build script.
4. **Vitest: one file at a time, smallest scope.** Never the full suite in a loop. Read a finished
   run's log instead of re-running it.
5. **Commit after every unit of change, push after every commit.** Message says defect +
   consequence + fix, never a one-line pointer. Commit by explicit path — never `git add -A`.
6. **Edit/Write tools for code changes** — never bash heredocs or `sed` into source files.
7. **Never:** `node:sqlite` (SQLCipher only); `console.log` in implementation (injected logger
   only); mocks for crypto operations; `workspace:*` for cello-client packages in trustless-cello;
   pinned versions; joining or keying on `agent_name`; a new relay path without its per-peer rate
   limiter in the same diff; touching npm publish, git tags, or dist-tags; **any backward
   compatibility** — no legacy-format readers, no migrations for pre-M16 data, no dual code paths,
   no deprecated-but-kept functions, no version-negotiation branches (§0: alpha, one user, nothing
   to preserve — change the thing and delete the old path in the same diff).
8. **A failing test is fixed, never attributed.** "Flaky" is not a finding; map producer → consumer
   to the failing line, per the debugging discipline in the repo CLAUDE.md.
9. **If Docker is needed and not running, start it.** Do not report the gate as blocked.
10. **Journal after: tests red, gate green, enforcer run, review verdict.** Four entries per unit,
    each a few lines plus pasted output. The journal is append-only.

## §5. STOP CONDITIONS FOR THE CODER — the complete list

A weak model either never stops or stops constantly; this list is exhaustive in both directions.
**Stop and hand back to the planner ONLY when:**

1. **The work order is ambiguous or contradicts the code you can see.** Quote the sentence and the
   contradicting code. Do not resolve it yourself — an interpretation chosen silently is how a
   retired design gets rebuilt.
2. **You cannot satisfy a test without doing something §5-FORBIDDEN.** That means the order's
   design is wrong somewhere; say which test and which forbidden item collide.
3. **A step requires an external reach** — npm publish, GCP, a counterparty, anything credentialed
   beyond the dev consortium.

**Everything else: keep working.** No check-ins, no recaps, no "should I continue," no stopping at
"natural stopping points," no token-budget stops.

**Found a defect outside your work order?** Do NOT fix it and do NOT follow it. Write it under
***Newly discovered* at the foot of your order file** — symptom, file, one-line consequence,
**five lines maximum, no investigation** — and continue your unit. Capture is cheap; admission is
not (§5a: the planner triages that section at unit close).

## §5a. THE SCOPE FREEZE — how a finding gets in, and why the default is OUT

**M15 more than doubled between open and close because finding-classification was left to judgment,
and judgment expands.** M16 inverts the default. Capturing a finding costs five journal lines;
admitting one into the milestone is deliberately hard, and the test is mechanical so that neither a
weak coder nor an eager planner can widen scope by interpretation:

> **A finding enters M16 only if an existing DoD line is FALSE without it** — it is a defect in
> something a line already claims, discovered before that line's ✅. Then it is not new scope; it
> is the existing line not yet being true, and it becomes a clause on that line's work order.

Everything else leaves the milestone immediately, by route:

- **Security finding with launch relevance** → routed to the launch-gate intake (M15
  classification, Andre's rules there apply). M16 does not adjudicate launch questions.
- **Everything else** → `POST-M16 BACKLOG` at the foot of the DoD: the five journal lines copied
  over, plus the planner's one line of reasoning, written at triage time. No further investigation
  — an unbounded "quick look" at a backlog item is the expansion vector with a different name.

**When it is genuinely unclear, it goes OUT.** This is the deliberate opposite of M15's rule, and
the reason is the gate's position: M15 guards launch, where a blocker wrongly released is found by
a customer — so unclear blocked. M16 guards nothing downstream; a finding wrongly backlogged is
found by the planner at the next triage, which is cheap. Unclear items expanding a feature
milestone is how a milestone stops ending.

**The escalation lane — because "default OUT" must not bury the one that matters.** The danger in
a hard gate is the genuinely important catch dying quietly in a backlog. So before anything is
backlogged, the planner runs a severity screen — four questions, any YES escalates:

1. Does it touch **key material, signing, or a ceremony** (a way to forge, leak, or misuse a key)?
2. Can it cause **data loss or corruption** (a log, a seal, a local DB) rather than a wrong answer?
3. Does it let **content reach an agent's context unscreened**, or attribute content to the wrong
   identity?
4. Does it make **a claim that is already public false** (README, SKILL.md, shipped docs, site)?

All NO → backlog, one line, done. Any YES → it goes **to Andre as a one-line ask with the
planner's recommended disposition**, batched with any other open asks rather than one message per
finding. Andre rules it in (he writes the new line or names the existing line it attaches to), out
(backlog, his ruling recorded), or over to the launch gate. **The judgment call still gets made —
it is just made once, by the only person entitled to expand the milestone, instead of continuously
by whoever happens to be holding a finding.** An escalation is not a stop: the coder's unit and the
planner's other work continue while the ask is open.

**Two hard caps, both greppable:**

1. **The DoD line count is FROZEN at the 22 lines it opened with.** Only Andre adds a line, in
   writing, in the DoD itself. The planner may split a line into work orders; the planner may not
   create a line. If the count in the DoD ever disagrees with 22 without an Andre-signed ruling
   next to it, that is a process violation regardless of how good the reason was.
2. **Triage happens at unit close, in one pass, and every NEW-FINDING gets its disposition written
   the same day it is triaged.** An undisposed finding carried across units is a soft scope
   expansion — the M15 "waiting on classification" shape — and is itself a process violation.

## §6. REVIEW AND STATUS

- **One `cello-unit-reviewer` pass per unit; two is the hard cap.** The reviewer gets: the work
  order, the diff (commit range), and the journal entries. Verdicts are per numbered clause of the
  work order. Leftover low findings become clauses on later work orders, never a third pass.
- **🟡 → ✅ requires the reviewer's verdict quoted in the journal.** A killed reviewer is NO
  verdict. Status is per-line, never a blanket "all done."
- **Enforcer evidence is separate-OS-process output, quoted.** Vitest green is necessary, never
  sufficient — several M16 lines exist precisely because a single-process test cannot prove the
  property (relay kill, eject/re-key, equivocation).
- **The milestone close gate** is the five-step live smoke in the DoD, run across two machines,
  planner-driven, output in the journal.

## §7. ORDER OF WORK

Tiers are dependency order — Tier 0 fully reviewed before Tier 1 starts, because Tier 0 is the
migration-trap layer (wire format, identity shape, seal type) and everything above builds on it.
Within a tier, work orders may proceed in any order unless `Depends on` says otherwise. The planner
issues work orders at most one tier ahead of what is closed, so late learning can still shape them.

---

## Related Documents

- [[M16-DEFINITION-OF-DONE]] — the scoreboard this procedure works
- [[2026-08-23_1933_broadcast-channels-conclaves-and-encrypted-discovery]] — design source,
  planner-only
- [[M15-PROCEDURE]] — the parent shape this adapts; not required reading for M16
