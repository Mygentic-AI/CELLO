---
name: 025-REFUSALTERMINAL — A refusal that can never succeed stops, and the count is true
type: micro-work-order
date: 2026-09-04
status: complete
description: >
  A message refused because the conversation is CLOSED is retried forever — measured at 232,056
  refusal events over 62 hours, ~2 per second, on one message, growing daemon.log to 484 MB. The
  receiver holds a leaf it can never resolve, because resolving it means ingesting content that is
  refused every time, and nothing marks the refusal permanent. The operator's own inbox reported
  that as "58". Make a provably-permanent refusal stop the work, and make the number honest.
  CLOSES DOD-M15-REFUSALTERMINAL-1.
---

# **<ins>MICRO</ins>** WORK ORDER 025-REFUSALTERMINAL — A refusal that can never succeed stops

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

---

## The rule this exists to enforce

**Andre, 2026-09-04**, on being shown the loop:

> *"Yes, a message refused should stop being retried."*

**One sentence for the whole unit: a refusal that CANNOT succeed must stop the work, not repeat it.**

---

## What is true today — MEASURED IN PRODUCTION, do not re-derive

Found on Andre's own laptop on 2026-09-04, in live traffic, not by review.

`CELLO_Coder_1` had a canary message aimed at a conversation `CELLO_Support` had already closed.
Every copy is refused `session_committed`. A committed session is signed and cannot be added to, so
**no retry of any kind can ever succeed.** It retried anyway:

| | |
|---|---|
| first occurrence | `2026-09-01T20:43:21Z` |
| still running at | `2026-09-04T10:33` — **62 hours** |
| refusal log events for that one session | **232,056** (~6 per cycle, so ~38,600 cycles) |
| rate, measured over three 30-second windows | **~2 per second**, flat |
| `daemon.log` | **484 MB** |
| what `cello_inbox` told the operator | `times: 58` |
| evidence rows retained | **1** — `023`'s dedup held perfectly under this |

**IT SURVIVED DAEMON RESTARTS.** The 62 hours span several. **This is the single most important fact
in this order**: an in-memory marker does not fix it. Whatever marks the refusal permanent must be
durable, or the loop resumes on the next `cello login`.

### The cycle, exactly

Every ~3 seconds, all of it on the **RECEIVER**:

```
session.content.leaf_unresolved.fetch        ← the backstop fires
content.recover.verified                     ← the bytes arrive and verify
session.content.cross_check.failed           ← reason: session_committed
session.content.quarantine.duplicate         ← 023's dedup, working
content.recover.annex.salt_unavailable       ← ERROR, every cycle
```

### The producer/consumer, mapped

- **Consumer:** `#scheduleLeafFetchIfUnresolved(agentName, sessionId, contentHashHex)` in
  `core/daemon/src/session-node-manager.ts`. It returns early if
  `this.#resolvedContent.get(key)?.has(contentHashHex)`. Otherwise it sets a timer that calls
  `#fireParkedDrain(agentName, "witnessed_leaf_unresolved")`.
- **Producer of the stop condition:** `#markContentResolved(...)`, whose own docstring says it is
  *"Called wherever content actually lands."*
- **The gap:** refused content never *lands*, so `#markContentResolved` is never called, so
  `#resolvedContent` never gains the hash, so the next redelivery schedules another fetch. Forever.

**`cello_dismiss` does NOT stop it** — measured before and after, 60 events per 30 s either side. The
only thing that stopped it was `cello_set_agent_offline`.

> ⚠️ **`CELLO_Support` IS OFFLINE RIGHT NOW** as the only available mitigation. Bringing it back
> online before this unit ships restarts the loop. **Bring it back online as the last step of this
> unit and confirm the loop does not return** — that is DoD 7.

---

## Part 1 — A terminal refusal is a NEW concept, and it is not "resolved"

**Do not reuse `#markContentResolved` for this.** "Resolved" means *we have the content*. A refused
message is the opposite: we have it and are never accepting it. Overloading the name makes a later
reader believe refused content was delivered.

Add a sibling — `#markContentTerminallyRefused(agentName, sessionId, contentHashHex)` — that:

- cancels any pending leaf-fetch timer for that `(agent, session, contentHash)`, exactly as
  `#markContentResolved` does;
- records the fact **durably**, not in a `Set` on the instance;
- causes `#scheduleLeafFetchIfUnresolved` to return early for that content hash, forever.

### The terminal set is EXACTLY ONE reason, and widening it is out of scope

```
TERMINAL_REFUSAL_REASONS = { "session_committed" }
```

**Justification, which must survive review:** a committed session carries a signature over its
contents. Nothing can be appended to it by anyone, including the counterparty, including us. There is
no future state in which this content is accepted. That is the bar for "terminal".

**DO NOT ADD ANY OTHER REASON**, however obviously permanent it looks. Each of the tempting ones
fails the bar for a reason worth writing down:

| Reason | Why it is NOT in the set |
|---|---|
| `content_hash_mismatch` | The fetch is *by content hash*. A later fetch may retrieve a correct copy from a different relay. Retrying can succeed. |
| `sender_unresolved` | The sender may become resolvable — a profile arrives, a directory syncs. Retrying can succeed. |
| `session_orphaned` | `024-ORPHANTRIAGE` owns this path and decides its disposition. Not yours. |
| `session_size_limit_exceeded` | Looks monotonic, and the cap *is*. But the bound is a setting, and an operator raising it must un-stick the conversation. |
| the screener's transient block | Transient is in its name. |

If you believe another reason belongs, write it under *Newly discovered* and **do not add it**.

### Durability — pick the store, and say which in the journal

The marker must survive a daemon restart. `023-REFUSEDEVIDENCE` already writes a durable quarantine
row per `(session, reason, bytes)` and already dedups on it — that row is the natural source of
truth, and consulting it costs no new schema. **Take that if it works.** If it does not, add the
smallest durable record that does, and say in the journal which you took and why.

**Key on `agent_id`, never `agent_name`.**

---

## Part 2 — The count the operator sees must not be a lie

`cello_inbox` returned `times: 58` while the true figure was four orders of magnitude larger. The
code is not "wrong" — `times: r.count` in `core/daemon/src/notification-handlers.ts` reports a
counter that is **drained when the inbox is read** (`session-content-handlers.ts`: *"the operator is
told once per reason per session"*). So 58 was refusals *since the last read*.

**The defect is the prose, and the prose is load-bearing.** The guidance ships this sentence:

> *"`times` is how many messages that reason has refused on that session — a large number means the
> cause is still live, not that it happened once."*

That claims a lifetime figure. It is a since-you-last-looked figure. An operator — or an agent
deciding whether to escalate — reads 58 and concludes "minor". The real answer was "this has been
running for two and a half days and has written half a gigabyte".

**The fix, pre-decided:**

1. Report **both** numbers. `times` keeps its drain semantics and gains a companion lifetime total
   from the durable record. Name them so neither can be mistaken for the other.
2. **Rewrite the guidance sentence to say what each number is.** It must be impossible to read the
   smaller number as a lifetime count.
3. `repeat: true` currently means *"you have been told about this and it has grown by an order of
   magnitude"* — check that claim still holds against whichever number it compares, and correct it
   if it does not.

> ⚠️ **This is operator-facing COPY.** Draft the new guidance sentence, put it in the Review section
> below, and **do not consider the unit closed on wording alone** — Andre owns copy. Ship the
> mechanism; flag the words for him.

---

## Definition of Done

1. A refusal whose reason is in `TERMINAL_REFUSAL_REASONS` cancels the pending leaf fetch and
   prevents any future one for that content hash.
2. **The marker is durable.** Prove it: mark, restart the daemon (or reconstruct the manager from the
   store), and show no fetch is scheduled. **A test that only exercises an in-memory `Set` does not
   close this line** — the production loop crossed several restarts.
3. `session_committed` is the only member of the set, and the code says why in a comment a reviewer
   can check.
4. **A non-terminal refusal still retries.** Prove the fix did not silence the healthy case: a
   transient refusal must still schedule its fetch.
5. `cello_inbox` reports both the since-last-read count and a lifetime total, and the guidance names
   which is which.
6. Nothing interpolates refused content into a log line, an error, a path or a prompt.
7. **The live loop is gone.** Bring `CELLO_Support` back online, wait 3 minutes, and show **zero**
   events for session `dcec3c3fb9856065d2f27b4673f0f40a` — against the ~120/minute baseline recorded
   above. Quote the before and after.
8. **Each new assertion has been made to fail on purpose**, and confirmed to fail for the reason
   expected. **Commit before the mutation loop exists.**
9. Gate passes in cello-client. State whether anything publishes.
10. Reviewed by `cello-unit-reviewer`, every finding fixed, verdict quoted below.
11. `DOD-M15-REFUSALTERMINAL-1` flipped to ✅ in `M15-DEFINITION-OF-DONE.md`, in the same commit as
    the verdict, and the row for items **1 and 2** in that file's *FOUND LIVE 2026-09-04* table
    updated.

**Not in scope:** the per-peer knock ledger (its own design, see the 2026-09-04 walling-off log);
widening the terminal set; `024-ORPHANTRIAGE`'s unknown-session disposition; the heartbeat fork alarm
(`026`).

---

## Traps recorded before you start

**An in-memory marker looks like it works and does not.** The whole defect crossed daemon restarts.
If your test restarts nothing, it proves nothing.

**"Resolved" and "terminally refused" are different facts.** Collapsing them tells a future reader
that refused content was delivered.

**Do not widen the terminal set to be helpful.** A reason wrongly marked terminal silently drops a
message that would have arrived on the next try — the failure this unit creates if it overreaches,
and it is worse than the loop.

**The count fix is not a code fix.** The number was accurate for what it measured; the sentence
describing it was false. Changing the number without changing the sentence moves the lie.

**`agent_name` is a display label.** Key on `agent_id`.

**ANOTHER LANE MAY BE RUNNING.** If you bring up Postgres, export a `COMPOSE_PROJECT_NAME` unique to
your worktree AND a unique `CELLO_PG_HOST_PORT`.

**Work in a PAIRED worktree** — `<lane>/cello-client` and `<lane>/trustless-cello` as siblings, and
load `/worktree-permissions` before creating one.

---

## Review

### Where this work lives

Paired worktree, siblings as required:

- `/Users/andrep/Documents/code/m15-025/cello-client` — branch `m15/025-refusalterminal` (all the code)
- `/Users/andrep/Documents/code/m15-025/trustless-cello` — branch `m15/025-refusalterminal` (these docs)

`/Users/andrep/Documents/code/m15-025` was added to `permissions.additionalDirectories` in
`.claude/settings.local.json` before the worktrees were created.

**No `COMPOSE_PROJECT_NAME` / `CELLO_PG_HOST_PORT`** — the whole unit is client-side and never
brought up Postgres, so there was nothing for another lane to collide with.

### ⚠️ Proposed guidance copy for Andre — SHIPPED AS VARIANT A, and the wording is yours

The mechanism is not in question: the inbox now carries two numbers instead of one. What follows is
only what they are CALLED and how the sentence explains them. I shipped variant A so the unit is
testable; say the word and any of these is a one-line change.

**The field names, which are the load-bearing half.** `times` is gone entirely, because the whole
defect was that `times` reads as a lifetime figure. Shipped: `times_since_dismissed` and
`times_total`.

**Variant A — SHIPPED. Names the drain, leads with the real number.**

> These are grouped by session_id, and they carry TWO counts. `times_total` is how many messages
> that reason has refused on that session since the first one — the real scale, and the number to
> judge severity by. `times_since_dismissed` counts only the refusals since the operator last ran
> cello_dismiss on that conversation, so it can be small while `times_total` is enormous; dismissing
> clears the notice, never the cause. If `times_total` is missing, this notice could not be written
> to disk (see session.refusal.persist.failed) and its true scale is unknown — do not read the
> smaller number as the total.

**Variant B — shorter, drops the missing-field clause.** Costs the one case where an agent would
otherwise read the smaller number as the total on a daemon whose disk is failing.

> Two counts, and they mean different things. `times_total` is every refusal of that reason on that
> conversation, ever — judge severity by this one. `times_since_dismissed` restarts at 1 whenever
> the operator dismisses the conversation, so a small number here says nothing about the scale.

**Variant C — leads with the trap rather than the definition.**

> `times_since_dismissed` is NOT how bad this is. It restarts every time the operator dismisses the
> conversation, so a refusal that has fired forty thousand times can show up here as 58 —
> that happened, on this machine, for two and a half days. `times_total` is the real figure.

**The one thing I would not change in any of them:** never call either number `times`. That single
word is what let an operator read 58 and conclude "minor" while half a gigabyte of log was being
written.

### DoD 7 — the live loop, measured on the real daemon

`CELLO_Support` had been parked offline as the only known mitigation, so the fast loop was already
quiet before the fix; re-measuring the 120/minute baseline would have meant restarting it unfixed.
**The baseline is Andre's, measured 2026-09-04 over three 30-second windows.**

The 484 MB log was rotated to `~/.cello/daemon.log.pre025`, the three changed compiled files were
dropped into the installed `@cello-protocol/daemon@0.0.188` (`diff -rq` confirmed the installed and
built trees then differed in nothing else), and the daemon was restarted with `cello logout` /
`cello login` — never `pkill`. Replaced files are backed up at `/tmp/025-dist-backup`.

| | before | after |
|---|---|---|
| `session.content.leaf_unresolved.fetch` for `dcec3c3f…` | **5,954** in the last 20 MB of log | **0** |
| refusal cycles | ~20/minute, indefinitely, across restarts | 5 in 7 minutes, each traceable to a lifecycle event |
| **clean 3-minute window, agent online** | ~360 events | **0 events** |
| `daemon.log` | 484 MB | 11.6 KB written in that 3 minutes, nearly all of it other agents |

The terminal refusal fired against the real stuck message on the first drain after the restart:

```
{"event":"session.content.terminal_refusal","agentName":"CELLO_Support",
 "sessionId":"dcec3c3fb9856065d2f27b4673f0f40a","reason":"session_committed",
 "contentHash":"713ab9307e1151549f3092cbcfd545ea2ce99eee9790f5e5cc68953fc028b174"}
```

**Stated plainly, because "zero" needs its bound — and review F2 was right to demand it.** The
3-minute window is SHORTER than the 300-second periodic park sweep, so a clean zero in it cannot
speak for the sweep arm. Re-measured over **12 minutes**, which spans two sweeps:

```
12:02:01Z  12:02:07Z   ← daemon start + standing receiver ready
12:04:28Z  12:04:31Z   ← my manual start-agent
12:06:56Z              ← first periodic sweep
12:12:27Z              ← +5m01s
12:17:30Z              ← +5m03s
12:22:28Z              ← +4m58s
```

Six log lines per sweep, one sweep per five minutes: **72 lines an hour, against ~7,200 an hour
before.** The engine this unit closed is at zero; the second engine is a different mechanism,
recorded under *Newly discovered* with a recommendation, and not in this order's scope.

### DoD 8 — nine mutants, each re-run alone, each typechecked, each red for the expected reason

| # | Mutation | Result |
|---|---|---|
| 1 | remove the terminal check in the scheduler | RED — redelivery + restart tests. The cancel test correctly stayed GREEN: that is mutant 3's writer, so the two are covered independently |
| 2 | marker in memory only, no durable row | RED — **only** the restart test. This is the mutation that separates the real fix from one that ships nothing |
| 3 | leave the armed timer to fire | RED — "the armed fetch must be cancelled, not merely never re-armed" |
| 4 | widen the set with `content_hash_mismatch` | RED — the set pin, and the mismatch-still-retries test |
| 5 | drop the `TERMINAL_REFUSAL_REASONS` gate | **SURVIVED** — see below. RED after the fix |
| 6 | never write the lifetime total | RED — `times_total` absent where 3 was owed |
| 7 | report the dismissable count as the lifetime one | RED — 1 where 4 was owed after a dismissal |
| 8 | restore the false guidance sentence | RED — the guidance test |
| 9 | announce the terminal refusal on every re-refusal | RED — 3 events where 1 is owed |

**Mutant 5 is the finding worth carrying out of this unit.** Deleting the set check survived the
entire suite, because the only caller passed `session_committed` anyway — the set was documentation
with a pin test on it, and nothing in the running system consulted it. A reviewer reading the diff
could not have told. Fixed by making `#quarantineRefusedContent` the funnel: it retains, then offers
the refusal for termination, and the SET decides. Six non-terminal reasons flow through it, so the
gate is now observable, and the new `content_hash_mismatch`-still-retries test is what observes it.

### DoD 9 — gate, and what publishes

`pnpm run test` **4866 passed / 11 skipped** · `lint` clean · `typecheck` clean, all in
`cello-client`.

**Nothing HAS been published, and this unit DOES publish — review F5 corrected my first answer,
which said only the first half.** `core/daemon` is a published package (`"private": false`,
`0.0.188`), and both `@cello-protocol/connect` and `@cello-protocol/cli` depend on it via
`workspace:*`. So the whole daemon → connect/cli cascade is owed, through `/cello-publish`, and
**until it runs every installed operator still has the 62-hour loop.** The live proof above ran
against a locally-patched copy of the same version on Andre's machine, not against anything on npm.

### Reviewer verdict

Two read-only passes: `cello-unit-reviewer` on the diff, and `cello-fallback-finder` on the refusal
path (§2d's one permitted exception, dispatched because this unit changes what happens after a
verification fails).

**`cello-fallback-finder`, verbatim:**

> **Blocking:** finding 1. Findings 2–4 are Andre's call; 2 and 4 are one-sentence copy changes and
> 3 is a `retained` field plus a conditional on the funnel.

**`cello-unit-reviewer`, verbatim:**

> - **SPEC: DEVIATIONS FOUND** — clause 5 (guidance misattributes an absent total; second door
>   ungoverned), clause 7 (observation window shorter than the remaining trigger interval), clause 9
>   (this unit does publish). None journaled.
> - **NO SILENT FALLBACKS** — the read-failure `false` is the safe direction and is announced; the
>   notice fallback is announced and preserves the surface. F3 is a noise defect in that path, not a
>   silent one.
> - **ERROR SUBSTITUTION FOUND** — `[blocking]` — an absent `times_total` is explained to the
>   operator as a disk write failure when the actual cause is a tally that did not exist yet.
> - **TESTS HAVE TEETH** — the two load-bearing tests survive the revert test and carry positive
>   controls. Three tests do **not** survive it … they are correct guards, not coverage, and should
>   be labelled so. No hollow test found.
> - **REMOVALS PROVEN** — the split preserves behaviour at all seven sites …
> - **NO COMPATIBILITY DEBT**.
>
> **Blocking before this unit closes:** F1b (daemon will not start on the DoD-7 machine), F1 (the
> guidance sentence), F1c (`seeded` has no reader), F6 (the atomicity the comment claims). F2 and F5
> are the two that decide whether the fix actually reaches anyone.

**Every finding fixed.** One commit each:

| Finding | What it was | Fix |
|---|---|---|
| F1 | the lifetime total was EMPTY on every existing daemon, and the guidance blamed a disk fault | backfill from the existing notices |
| F1b | **BLOCKING** — `CREATE TABLE IF NOT EXISTS` is a no-op, so the new column was missing and schema init threw: the daemon would not start on the very machine that produced the evidence | the repo's `ALTER TABLE` + duplicate-column-catch idiom |
| F1c | `seeded` had no reader and its comment claimed one | seeded rows surface as `times_total_at_least`, a different field from `times_total` |
| F2 | the 3-minute window was shorter than the 5-minute sweep | re-measured over 12 minutes, two sweeps, numbers above |
| F3 | a failing read re-logged an ERROR on every witnessed leaf — the fix reproducing its own defect | backed off to one attempt per session per minute |
| F4 | the receive door got the new field names but no sentence explaining them | mapped explicitly; the explanation is now ONE shared constant used by both doors |
| F5 | "nothing published" was true of the action, false of the surface | corrected above |
| F6 | the two writes were claimed atomic and were not | `BEGIN`/`COMMIT` with best-effort `ROLLBACK` |
| F7 | a durable, counterparty-fed table with no cap | 512 per session, oldest-dropped, eviction announced at WARN |
| F8 | write-only columns | left; forensic, and matches the sibling table |
| F9 | two unrelated "terminal refusal" concepts in one daemon | cross-reference comment |
| tests | three guards read as coverage | each labelled as a guard that passes on a revert |

**And one the reviews did not find — the live daemon did.** After the reviewed build was installed,
the inbox read `times_since_dismissed: 78, times_total: 12`: an *exact* lifetime figure smaller than
the number beside it, because that row began counting when the earlier build created the table and
`seeded` defaults to 0. `INSERT OR IGNORE` only fills rows that are ABSENT, so the backfill never
touched it. `count` resets on dismissal and `total` does not, so `total >= count` always holds in
healthy operation — `count > total` means the row did not start at the beginning. Repaired at every
boot to a floor. The live reading is now `times_since_dismissed: 80, times_total_at_least: 80`.

**Fifteen mutants in total**, each re-run alone, each typechecked first, each red for the expected
reason — including one (mutant 10) that reproduces the literal startup error F1b predicted, and one
that was discarded because it failed to compile and therefore proved nothing.

## Newly discovered

### A SECOND, slower engine keeps the same message in a refusal loop — 6 log lines every 5 minutes

**Found while measuring DoD 7, not by review. Recorded and NOT fixed, per rule 3.**

Stopping the leaf-fetch backstop killed the fast loop (5,954 `leaf_unresolved.fetch` events in the
last 20 MB of the pre-fix log → **0** after). What remains is the **periodic park-drain backstop**,
which runs every 300 s regardless of any signal and re-pulls everything the relay is still holding.
The relay is still holding this message, so it is re-verified and re-refused once per sweep:

```
12:02:01Z  cycle 1   (agent start)
12:04:31Z  cycle 4   (my manual start-agent)
12:06:56Z  cycle 5   ← the 300 s periodic sweep, ~5 min after cycle 1
```

Six log lines per cycle. Measured across a clean 3-minute window between sweeps: **0 events**.

**Why the relay copy is never deleted, and this is the part worth acting on.** The park drain's
`session_committed` branch annexes the message and only then confirm-deletes the relay copy —
correct ordering, and the annex is what makes deletion safe. On this message the annex fails with
`content.recover.annex.salt_unavailable`: the sender used the salted hash algorithm and this side
holds no salt for a session that is already closed. **That salt is never coming back.** So the annex
can never succeed, the copy is never deleted, and the sweep re-refuses it forever at 1/5min.

**And that branch's operator guidance is FALSE for this exact case.** It says:

> *"This message will keep being re-pulled and re-refused until the session is closed, so close it
> and start a new one."*

The session **is** closed — that is why the message is being refused. An operator following that
advice has nothing to do and no way to stop it.

**Recommendation, so this is not a bare open question.** Two candidate fixes, and I would take the
first:

1. **Confirm-delete the relay copy when the refusal is TERMINAL and the bytes are already retained
   locally.** `023-REFUSEDEVIDENCE` quarantines these bytes durably before the annex is attempted —
   `session.content.quarantine.duplicate` fires on every one of these cycles, so a local copy
   provably exists. Deleting a relay copy whose content this machine already holds is not the
   permanent-silent-loss case the ordering rule protects against; it is the same argument the
   terminal-screen-block branch two hundred lines above already makes ("nothing to keep and nothing
   to store — delete so it stops being re-pulled"). The retention must be **proven** at the call
   site, not assumed.
2. Failing that, rewrite the guidance so it stops naming a remedy the operator has already
   performed.

**Classification: POST-LAUNCH** (§0z.4 — the gate is frozen and this is not a security hole a
customer reaches). One message stuck at 6 log lines per 5 minutes is a papercut; the same message at
120 lines per minute filling a 484 MB log was not, and that half is fixed. It needs its own micro
order because the fix is in the relay-deletion path, where getting it wrong loses a message
permanently — the one thing worse than the loop.

### The `relay_witness_unreadable` inbox section also reports a bare `times`

`notification-handlers.ts` maps `times: u.count` for `relay_witness_unreadable` from a different,
in-memory store. **NOT MEASURED and NOT touched** — I did not establish what drains that counter, so
I am recording the shape, not asserting a defect. Worth one look by whoever owns that surface, on the
grounds that this unit just proved the name `times` is read as a lifetime figure.
