---
name: 022-REFUSALVISIBLE — Nothing is refused silently
type: micro-work-order
date: 2026-09-03
status: complete
dod_line: DOD-M15-NO-SILENT-REFUSAL-1
dod_effect: closes
description: >
  Three refusal reasons reach the operator; NINE do not, including the screener block — the moment
  the product catches the attack it exists to catch. The three that ARE wired live in an in-memory
  map and surface only on the receive path, so an agent nobody is attending loses them and a daemon
  restart drops them. Make the notice durable and put it in the inbox, then wire the other nine.
  CLOSES DOD-M15-NO-SILENT-REFUSAL-1.
---

# **<ins>MICRO</ins>** WORK ORDER 022-REFUSALVISIBLE — Nothing is refused silently

> ## THE RULES OF A MICRO WORK ORDER
>
> 1. **Read [[M15-PROCEDURE]] IN FULL before you start.** It binds you — the gate, the review
>    dispatch, the invariants, how tests are run. **Do not read `M15-DEFINITION-OF-DONE.md` or
>    `M15-BUILD-JOURNAL.md`**; this order carries everything you need from them.
> 2. **MICRO means small.** One mission. Follow it to its end. **Never grow the mission.**
> 3. **Found something else?** Write it under *Newly discovered* at the foot of this file and
>    **keep going**. Do not fix it. Do not investigate it.
> 4. **500 lines, hard cap.**
> 5. **Standard procedure still applies:** implement → review (`cello-unit-reviewer`) → fix every
>    finding → commit. Commit per fix, push after every commit. **Closing a unit means flipping
>    this file's `status:` frontmatter to `complete` in the SAME commit as the verdict.**
> 6. **Done is done.** When the Definition of Done below is met, stop.

> ## 🎯 THIS ORDER CLOSES A DoD LINE — `DOD-M15-NO-SILENT-REFUSAL-1`
>
> **Part 1 alone flips NOTHING.** It builds the mechanism; no new refusal reaches an operator until
> Part 2 wires them. An order that stops after Part 1 has done the invisible half. **Both parts, or
> the line stays open.**

---

## The rule this exists to enforce

**Andre, 2026-09-03:**
> *"Things shouldn't be silently refused. If you're refusing someone for something, your human
> operator should know about it."*

---

## Where this work lives — ONE REPO

- **`cello-client`** → `/Users/andrep/Documents/code/cello-client`. Paths beginning `core/…` are
  here, and **everything you edit is here.** Gate: `pnpm run test` / `lint` / `typecheck`, plus
  `pnpm run build` (this repo HAS a separate build).
- **`trustless-cello`** → `/Users/andrep/Documents/code/trustless-cello`. You edit only this order
  file, at the end. The journey in Part 3 runs from this root.

**This publishes NOTHING.** `core/daemon` is not one of the five published packages and no wire
format changes. **Do not bump a version, do not tag, do not publish.**

---

## What happens to you today

Somebody sends you a message. We refuse it — the screener catches an injection aimed at your agent,
or they crossed their size budget, or we could not establish who sent it. **You are told nothing.**
It is a line in a log file you have no reason to open.

**And even the three refusals that ARE wired are wired weakly:**

- They live in an **in-memory `Map`** (`#contentRefusals`), not a table. **A daemon restart drops
  them.**
- They surface only via `refusalsField` on the **receive path for that session**. So if you have
  switched to another agent, or nobody is attending that agent at all, **nothing surfaces** — and
  `cello_inbox` does not show them either.

That second half is the case Andre raised: *a connection is live, the daemon is up, but nobody is
attending that agent.* A notice that only arrives if someone happens to call receive on that exact
session is a log line with extra steps.

---

## The trace — done, do not re-derive it

**Wired today (3), all in `core/daemon/src/session-node-manager.ts`:**
`noteContentRefusal` at **8435**; call sites at **8650** (`content_hash_alg_unknown`), **8706**
(`content_hash_salt_unavailable`), **8730** (`content_hash_mismatch`). Drained by `refusalsField`
in `core/daemon/src/session-content-handlers.ts` at **~62–79**.

**The precedent to copy is already in the tree and does it properly:** `contact_rename_notices`
(`session-node-manager.ts` **~2766**) — a durable SQLCipher table, **keyed on `agent_id`** (the
stable key), surfaced as its own inbox category in `core/daemon/src/notification-handlers.ts`
(**267**, **305**, **348**). Refusals are the ones doing it the weaker way.

**Two properties the current code paid for and you MUST NOT lose** — both are documented in
`takeContentRefusals` at **8488**:

1. **Per-CONSUMER surfacing.** Two MCP windows attending one agent is ordinary. Under a single
   `surfaced` flag the first reader consumed the notice and the second was told nothing,
   permanently. Reading must stay non-destructive to other readers.
2. **Order-of-magnitude re-announce.** A reason re-announces when its count grows 1 → 10 → 100,
   marked `repeat: true`. The first refusal is the signal, the ninetieth is noise, but a skew that
   swallowed hundreds must still be visible.

---

## Part 1 — Make the notice durable, and put it in the inbox

**Follow `contact_rename_notices` exactly.** A new SQLCipher table, created the same inline way
(`CREATE TABLE IF NOT EXISTS`), **keyed on `agent_id` — never `agent_name`.** The existing map is
keyed on `agentName`, which is a mutable display label; moving to a table fixes that too.

The table must carry, per (agent_id, session_id, reason): the reason, impact, guidance, the count,
and **per-consumer read state** so property 1 above survives. Rename notices do not need that (they
clear on operator action), so this table is slightly richer than its template — that is expected.

**Add a `refusals` section to the inbox** alongside `rename_notices`, in `notification-handlers.ts`,
spread into BOTH inbox shapes (**305** and **348**) the way `documentSection` and `witnessSection`
are. **Keep `refusalsField` on the receive path working** — this adds a door, it does not move one.

**Carry `REFUSAL_GUIDANCE` across verbatim** (`session-content-handlers.ts` **~81**). It is well
written, it is the sentence that makes the notice actionable, and a previous unit's own note records
that a catch-up door destroyed exactly this guidance once already.

---

## Part 2 — Wire the nine (this is the half that flips the line)

Each of these is a refusal a counterparty's message can hit today with the operator told nothing.
**Call `noteContentRefusal` at each, with an `impact` and a `guidance` that say what the operator
should do.** All are in `session-node-manager.ts` between **8528** and **9200** unless noted.

| Reason | What the operator must be told |
|---|---|
| `inbound_screen_blocked` | **The one the product is about.** We caught something aimed at your agent and blocked it. Terminal block is at **~8919–8967** — it leafs, it acks, it never notes. |
| `governance_timeout` / `gateway_unavailable` | A TRANSIENT block: nothing recorded, nothing acked, so the sender will redeliver. Say that, so silence is not read as delivery. |
| `session_size_limit_exceeded` | **Every later message from that person is refused for the rest of this session.** From your chair they simply stop replying. |
| `session_committed` | The session is sealed; their message can never land here. |
| `session_orphaned` | Same shape. |
| `sender_unresolved` | We could not establish who sent it. |
| `transcript_write_failed` | Our own storage failed and the message is gone. |
| `delivery_impaired` / `content_undeliverable` | Carried on an earlier unit's pass-2 list and never surfaced. |

**⚠️ `counterparty_gone` is NOT in that table, deliberately — it needs a FIX, not a notice.** It
currently tells the operator their peer *"may have crashed or gone offline — call
`cello_close_session` to seal"* while the daemon holds the real reason in memory. **It hands them a
network story for a verification fault and steers them toward sealing**, which is a nudge into
exactly the truncated close `DOD-M15-WITHHOLD-SEAL-1` describes. **Rewrite that string to say what
was actually observed** (`DOD-M15-ERRSTRING-1`'s rule: name what was observed, never an inferred
conclusion), and surface it like the rest. **Fixing the silence and leaving this string is shipping
the worse half.**

**The cap SIZE is not in scope.** 25 MB is the lowest tier and known contacts get more. Andre's
point is the silence. **Do not raise the cap.**

---

## Part 3 — Prove it end to end

Extend an existing spine journey — **do not write a new harness** (`session-fixture.ts` /
`live-harness.ts`; a from-scratch fixture is a blocking review finding).

The journey must show, with two real daemons as separate OS processes:

1. A message that trips the screener produces an **operator-visible** refusal naming the cause.
2. **The notice survives the operator not being there:** the receiving agent is switched away from
   (or its daemon restarted) and the refusal is still visible afterwards through `cello_inbox`.
   That second half is the whole point of Part 1 and it is what the current in-memory map fails.

---

## Definition of Done

1. Refusal notices are durable in a SQLCipher table keyed on `agent_id`, survive a daemon restart,
   and appear in `cello_inbox` as their own category.
2. Per-consumer surfacing and the order-of-magnitude re-announce both still hold. **Prove it:** two
   consumer ids, both told; and a count crossing 10 re-announces with `repeat: true`.
3. All nine reasons in Part 2 call `noteContentRefusal` with an impact and a guidance.
4. `counterparty_gone` no longer asserts a crash it has not established, and no longer steers the
   operator to seal on a verification fault.
5. The journey in Part 3 is green, run as separate OS processes, output quoted.
6. **Each new assertion has been made to fail on purpose.** Remove one `noteContentRefusal` call,
   confirm the journey reddens for the reason you expect, restore it.
7. Gate passes in cello-client. **Nothing published.**
8. Reviewed by `cello-unit-reviewer`, every finding fixed, verdict quoted below.
9. `DOD-M15-NO-SILENT-REFUSAL-1` flipped to ✅ in `M15-DEFINITION-OF-DONE.md`, in the same commit as
   the verdict.

**Not in scope:** whether the SENDER is told their message was refused (a real question, and
Andre's — telling a legitimate sender is right, telling someone probing the screener helps them tune
it); `DOD-M15-SEALREJECT-MUTE-1`, the same principle at the seal door, which keeps its own line.

---

## Traps recorded before you start

**A push is not a fix.** If you find yourself sending a real-time notification to whoever is
attending, stop. The case this order exists for is *nobody is attending that agent*. Durable first,
and the inbox is the door.

**Do not put refusals in `unread`.** A refusal is not a message from your counterparty — it is the
daemon reporting something that did NOT arrive. Its own category, like `rename_notices`.

**Storage does not guarantee the human hears it.** The notice lands in an AGENT's inbox and an agent
can see it and say nothing. That is why `REFUSAL_GUIDANCE` must survive the move intact and the new
inbox section needs guidance of its own.

**`agent_name` is a display label.** Key on `agent_id`. Never put `agent_name` in a PRIMARY KEY,
JOIN or WHERE — the existing map keying on it is the bug, not the pattern.

**ANOTHER LANE IS RUNNING.** `021-HEARTBEAT` is in `trustless-cello`, so it cannot touch your files
— but if you run anything that brings up Postgres, **export a `COMPOSE_PROJECT_NAME` unique to your
worktree AND a unique `CELLO_PG_HOST_PORT`.** The port alone does NOT isolate you: both worktrees
derive the same compose project name, the second lane silently reuses the first's container, and the
failure reads as a killed container rather than a collision. Measured 2026-09-03.

---

## Review

### Where this work lives

- **cello-client:** `/Users/andrep/Documents/code/m15-022/cello-client`, branch `m15/022-refusalvisible`
- **trustless-cello:** `/Users/andrep/Documents/code/m15-022/trustless-cello`, same branch name (a
  PAIRED worktree, because the spine harness resolves `../cello-client` — without it the journey
  runs the main checkout's `dist` and measures the wrong tree)
- `COMPOSE_PROJECT_NAME=m15022`, `CELLO_PG_HOST_PORT=5437`

### What shipped

**Part 1.** `content_refusal_notices` + `content_refusal_reads`, two SQLCipher tables created inline
beside `contact_rename_notices` and keyed the same way, on `agent_id` — the map was keyed on
`agent_name`, a mutable display label, which was its second defect. The reads table carries
per-consumer state so two windows attending one agent are both told, and the order-of-magnitude
re-announce survives. `refusalSection` is spread into both inbox shapes. Notices are NOT torn down at
session teardown: `session_committed` refusals exist only because the session was already sealed.

**Part 2.** All twelve reasons file, each with an impact and a guidance — and `kind`, `impact` and
`guidance` are all REQUIRED parameters now, so "every reason calls this with both" is a compile error
rather than something a reviewer checks by reading thirteen call sites. `content_undeliverable` and
`delivery_impaired` are noted at their PRODUCERS, not at the `cello_receive` exits that report them:
those exits read in-memory state and only run if somebody is attending.

`counterparty_gone` names one dropped libp2p connection, denies establishing a crash, points at the
refusals first (unconditionally — both doors share a read position, so a sibling window may have
taken the notice), and names the unilateral seal last as irreversible.

### The journey (DoD 5) — two daemons, separate OS processes, 3-node consortium + real relay

```
 ✓ 022-REFUSALVISIBLE — a screener block reaches an UNATTENDED operator, and survives a daemon restart  5109ms
 ✓ 022-REFUSALVISIBLE — the byte cap reaches the operator too, and says every LATER message is refused  2202ms
 Test Files  1 passed (1)
      Tests  2 passed | 10 skipped (12)
```

### The mutation proof (DoD 6)

Baseline printed green before each set; every mutant re-run alone, typechecked (a mutant that fails
compilation is not a catch), and the restore verified after each.

**On the journey.** Screener notice disabled + `dist` rebuilt → RED, with daemonB's own log showing
`security.gateway.inbound.terminal_block reason:inbound_language_blocked` and the inbox holding zero
refusals: the block fired and nobody was told. Both `#noteSizeCapRefusal` calls disabled → the cap
leg RED (`incoming:417 cap:200 tier:1`, inbox `[]`) while the screener leg stayed GREEN, so the red
came from the path the mutation was aimed at.

**On the unit tests, 21 mutants, all RED in the test named for them:** each `noteContentRefusal` call
site individually; the inbox section returning empty; `CREATE TEMP TABLE` (durability); per-consumer
replaced by a shared bucket on BOTH doors; the re-announce condition; the `counterparty_gone`
wording; the fallback write and the fallback read; the retraction; `ORDER BY`/`LIMIT`; the `rowid`
tiebreak; the N4 SQL filter; the header composition and its kind prefix; the combined cap; the
fallback reverse; the inbox read guard.

**Two failures of the loop itself, recorded because they are the point of the rule.** A one-line
`grep` for `if (false)` reported the mutant absent from `dist` when `tsc` had merely split it across
two lines — a false negative that would have made the next run prove nothing. And one loop ran
against a DIRTY tree and its `git checkout` destroyed six uncommitted fixes; they were reconstructed
and committed *before* the loop was run again. Commit first, then mutate.

### Gate (DoD 7)

`pnpm run test` 4790 passed / 11 skipped, `lint`, `typecheck`, `build` — all exit 0 in cello-client.
`lint` + `typecheck` clean in trustless-cello. **Nothing published:** no `package.json` touched, no
version bumped, no tag.

### Reviewer verdict (DoD 8) — `cello-unit-reviewer`, two passes

**Pass 1 — eight findings, three blocking.** Verbatim:

> **SPEC: FAITHFUL** … **SILENT FALLBACKS FOUND** — F6 (MEDIUM) … **ERROR SUBSTITUTION FOUND** — F4
> (blocking): the shared header asserts "received and refused, not verified, not ingested" over
> notices for which each clause is false, most sharply `delivery_impaired`, where it names the wrong
> direction of travel and sends the operator to the counterparty for a fault on their own outbound
> path. **HOLLOW TESTS FOUND** — F2 (blocking): four of the nine wired reasons have no assertion;
> deleting their `noteContentRefusal` calls leaves the gate green. **REMOVALS PROVEN** **NO
> COMPATIBILITY DEBT**
>
> Blocking before close: **F1**, **F2**, **F4**.

**Pass 2 (the hard cap) — six of eight closed cleanly, seven new findings.** Verbatim:

> **SPEC: FAITHFUL** — all seven clauses hold; clause 3 is now compiler-enforced rather than
> reviewer-enforced, which is a real improvement over what the DoD asked for. **NO SILENT
> FALLBACKS** — F6's fallback is announced and preserves the surface. N2 is a bounding defect, not a
> masking one. **ERRORS NAME THEIR CAUSE** — F4 closed. **HOLLOW TESTS FOUND** — N1: the F3, F4 and
> F6 fixes each fail the revert test. F2's four producers are genuinely closed, with the retraction
> test asking as a different consumer, which is the detail that makes it real. **REMOVALS PROVEN**
> **NO COMPATIBILITY DEBT**
>
> Blocking before close, in order: **N1**, **N2**, **N3**.

**Every finding from both passes is fixed** — F1–F8 and N1–N7 — each with a test and a mutant, except
N5, which is carried below as a design change rather than taken here.

## Newly discovered

*(found and NOT acted on, per rule 3)*

1. **A retraction resets the count, so a flapping session never re-announces (N5).**
   `#clearContentRefusal` deletes the row, count included. A counterparty on an intermittent
   connection impairs and heals repeatedly, and each heal resets to zero — so a direct path that has
   failed fifty times is indistinguishable from one that failed once. The count is now LOGGED on the
   way out (`session.refusal.retracted`, `timesBeforeRetraction`), so the flapping is greppable, but
   the operator-facing notice cannot show it. **The fix is a design change** — keep the row and
   rewrite its impact into the past tense ("this session's direct path has failed and recovered N
   times") — and it is out of this order's mission. *Classification: POST-LAUNCH. An operator on a
   flaky link is told each time it breaks; what they lose is the pattern, which is a diagnosis
   nicety, not the core value.*

2. **There is no way for an operator to DISMISS a refusal notice.** `contact_rename_notices`, the
   template, clears on operator action; these clear only for `delivery_impaired`, which self-heals.
   With the cap and newest-first ordering the acute problem is gone, but the list only grows. This is
   a unit, not a fix: a dismissal verb is a new MCP tool AND a consent question — who may dismiss a
   security notice, and does an agent dismissing on the operator's behalf recreate the silence this
   line exists to end? *Classification: POST-LAUNCH.*

3. **`http-manifest-poll.test.ts > AC-004` failed once and could not be reproduced.** Under a full
   423-file suite it returned `ok:false` where it polls a loopback HTTP server behind a 10s
   `AbortController`; it passes alone and passed on the runs either side, and none of the four
   production files this order touched is in that module's import graph. **Stated as the observation,
   not as "load-induced"** — that is a hypothesis, and the kind of attribution that gets copied
   forward and stops anyone looking. **The line worth acting on is about the TEST, not the flake:**
   its assertion captures only `ok:false`, so a timed-out abort and a refused connection are
   indistinguishable from its output, and every future occurrence will be attributed the same way for
   the same reason. A poll test that cannot say which of the two happened is the defect.
   *Classification: POST-LAUNCH.*

4. **Five pre-existing lint warnings in `packages/e2e-tests/src/spine/j-stale-session.spine.test.ts`**
   (unused `eslint-disable` directives for `no-console`). Zero errors, a file this order does not
   touch. Noted only so the next reader knows the trustless-cello lint output is not clean and that
   it is not this unit's doing.

> **⚠️ FOUR ITEMS TRIPS THE §0z.2 SPAWN TRIP-WIRE (more than two).** Reported rather than started, per
> the rule. **The vein has turned:** items 1 and 2 are design questions about a surface that now
> works, item 3 is test hygiene, and item 4 is lint in a file nobody touched. **None is a production
> defect** — the production defects this unit found (a header that was false for nine of twelve
> reasons, a notice that outlived its own truth, four producers with no coverage) were all fixed
> inside it. Andre decides whether any of these becomes a unit.
