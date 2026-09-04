---
name: 019-PARKERROR — A failed park deposit says what went wrong
type: micro-work-order
date: 2026-09-02
status: complete
dod_line: DOD-M15-PARKERROR-1
dod_effect: closes
description: >
  A failing park deposit reports internal_error with the message "[object Object]", so the cause is
  destroyed at the point of reporting and nobody has ever read it. The bug is NOT in the park code —
  it is the daemon's generic IPC error path, which every method inherits. Fix the reporting, then
  READ what it was hiding and write it down. Do not fix what you find. Source: DOD-M15-PARKERROR-1.
---

# **<ins>MICRO</ins>** WORK ORDER 019-PARKERROR — Make the error readable, then read it

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

> ## 🎯 THE MISSION IN ONE SENTENCE
>
> **A daemon call that fails must say what failed.** You are fixing the REPORTING. Then you read the
> failure it was hiding and you WRITE IT DOWN. **You do not fix that failure** — it is a separate
> finding for a separate order, and fixing it here grows the mission.

---

## Where this work lives — ⚠️ YOU EDIT THE OTHER REPO

**Every file this order changes is in `cello-client`, not in the repo this order file sits in.**
That is the single most likely way to lose twenty minutes here.

- **`cello-client`** → `/Users/andrep/Documents/code/cello-client`
  Paths beginning `core/…` are here. **All seven files you touch are here:**
  `core/daemon/src/error-message.ts` (new), `core/daemon/src/ipc-server.ts`,
  `core/daemon/src/session-relay-client.ts`, `core/daemon/src/daemon.ts`,
  `core/daemon/src/session-node-manager.ts`, `core/daemon/src/reconnect-drain.ts`,
  `core/daemon/src/content-park.ts`.
  **The gate runs here:** `pnpm run test` / `pnpm run lint` / `pnpm run typecheck`, plus
  `pnpm run build` (this repo HAS a separate build — unlike trustless-cello).
- **`trustless-cello`** → `/Users/andrep/Documents/code/trustless-cello`
  Paths beginning `packages/…` and `docs/…` are here. **You edit nothing here.** You only
  (a) run the spine test in Part 3 from this root, and (b) update this order file at the end.

If `core/daemon/src/ipc-server.ts` does not resolve, you are in `trustless-cello`. It is not
missing; you are in the wrong repo.

---

## What the operator lives through

1. They send a message to a counterparty whose agent is offline.
2. It fails.
3. They are told: *"An unexpected error occurred. Check daemon logs for details."*
4. They check the logs. The detail is not there either.
5. **There is no path from the error to the cause.** Not for them, and not for whoever they ask.

The cause was destroyed at the moment of reporting. That is this milestone's own named defect class
arriving through a formatting bug rather than a missing check.

---

## The trace — already done, do not re-derive it

**The bug is `core/daemon/src/ipc-server.ts` line ~256:**

```ts
message: err instanceof Error ? err.message : String(err),
```

`String()` on a plain object yields the literal text `"[object Object]"`. This is the catch-all for
**every** IPC method's rejected promise, so it is **not a park bug** — park is just where the spine
lane tripped over it. Two more sites in the same file have the identical pattern: lines ~378 and
~405 (log calls).

**The codebase already solved this, and this file did not get the memo.**
`core/daemon/src/session-relay-client.ts` line ~426 exports `extractErrorMessage`, whose own comment
says it exists so callers never get *"the useless '[object Object]'"*. It handles all three cases:
a real `Error`, an object with a `message` string, and anything else via `JSON.stringify`.
`content-park.ts` already imports and uses it in ten places. **`ipc-server.ts` does not use it.**

**What this means for the park failure specifically:** the deposit handler is *throwing* rather than
returning a structured `{ ok: false, reason }`. Fixing the reporting is what makes that throw
readable for the first time.

---

## Part 1 — Give the helper a proper home

`extractErrorMessage` currently lives in `session-relay-client.ts`. That is a strange home for a
general utility, and having `ipc-server.ts` import from the relay client is the wrong dependency
direction — the IPC server has nothing to do with relays.

- Create `core/daemon/src/error-message.ts` containing **only** `extractErrorMessage`, moved
  verbatim. **Keep its comment** — it explains why the function exists and it is the reason this
  order was needed.
- Remove the definition from `session-relay-client.ts` and import it there instead.
- Update the imports in the other files that use it. The full list, from grep:
  `daemon.ts`, `session-node-manager.ts`, `reconnect-drain.ts`, `content-park.ts`,
  `session-relay-client.ts`.
- **Do not change the function's behaviour.** Move it; do not improve it.

---

## Part 2 — Use it in the IPC server

Replace `err instanceof Error ? err.message : String(err)` with `extractErrorMessage(err)` at all
**three** sites in `core/daemon/src/ipc-server.ts` (~256, ~378, ~405).

**The response AND the log must both carry the cause.** The DoD line is explicit that the detail was
missing from the logs too. Site ~256 builds the operator-facing response; make sure the same
extracted message also reaches a log line at that point, so a failure is diagnosable from the daemon
log alone without the operator having to copy an error back to you. Use the existing event taxonomy
(`domain.noun.verb`) and the logger already in scope — **no `console.log`.**

**Do not touch the `guidance` string** in that response. "Check daemon logs for details" becomes
*true* once the log carries the cause, which is the point.

---

## Part 3 — READ what it was hiding, and write it down

Now the deposit failure is legible for the first time. Go and read it.

    cd /Users/andrep/Documents/code/trustless-cello
    pnpm --filter @cello-protocol/e2e-tests exec vitest run --config vitest.spine.config.ts \
      src/spine/j-content.spine.test.ts -t "DOD-MSG-5"

Docker must be running (the harness brings up its own Postgres). Both repos must be freshly built —
`pnpm run typecheck` in trustless-cello (it emits), `pnpm run build` in cello-client. **One test file
at a time**; two lanes share this laptop.

`DOD-MSG-5` and `DOD-MSG-7` are the two tests that fail on this error. Run one, read the message.

**Write what you find in the Review section, verbatim** — the new error text and the log line. Then:

> ### ⛔ STOP THERE. DO NOT FIX IT.
>
> Whatever the underlying failure turns out to be, it is a **new finding**, not this order's
> mission. Record it under *Newly discovered* with the evidence, and leave `DOD-MSG-5` and
> `DOD-MSG-7` red. Somebody writes the next order from what you wrote down.
>
> This will feel wrong — you will be one small change away from a green test. Resist it. A cause
> nobody has ever read is exactly the thing that should be looked at deliberately rather than
> patched by whoever happened to make it visible.

---

## Definition of Done

1. `extractErrorMessage` lives in `core/daemon/src/error-message.ts`, unchanged in behaviour, with
   its comment intact; all five previous importers updated.
2. All three `String(err)` sites in `ipc-server.ts` use it.
3. A failing IPC call names its cause **in the response and in a log line**.
4. **A test pins this and can fail.** Add a unit test: an IPC handler that rejects with a plain
   object (e.g. `{ reason: "no_connection", message: "..." }`) produces a response message that is
   **not** `"[object Object]"` and **does** contain the object's content. Then revert the
   `extractErrorMessage` call, confirm the test goes red with `"[object Object]"`, and restore it.
   Quote both runs.
5. The real cause behind `DOD-MSG-5` / `DOD-MSG-7` is **read and written down verbatim**, and
   **not fixed**. Those two tests are still red, deliberately, and the Review says so.
6. Gate passes (test / lint / typecheck) in cello-client.
7. Reviewed by `cello-unit-reviewer`, every finding fixed, verdict quoted below.

**Not in scope:**
- Fixing whatever Part 3 reveals.
- `DOD-MSG-3 (transport)`, which fails for a different reason and belongs to `018-PARKCOLLECT`.
- `DOD-MSG-8`, which fails on a stale tool name (`cello_get_transcript` no longer exists; it is
  `cello_transcript`). Not this line.
- The `String(err)` pattern anywhere outside `ipc-server.ts`. It may well exist elsewhere; note it
  under *Newly discovered* if you see it, do not sweep for it.

---

## Traps recorded before you start

**This publishes nothing.** `core/daemon` is not one of the five packages published from
cello-client, and nothing here changes a wire format or a public type. **Do not bump a version, do
not tag, do not publish.** If you find yourself reaching for `/cello-publish`, you have gone off the
path.

**Do not "improve" `extractErrorMessage` while you are moving it.** Adding a stack trace, a code
field, or truncation changes what every one of its existing callers logs. Move it verbatim.

**`JSON.stringify` can throw** — on a circular object. The existing helper already wraps it in
try/catch with a `String(err)` fallback. Keep that. Do not remove the fallback because it looks
like the bug you are fixing; it is the last resort, not the first choice.

**A test that asserts only "not [object Object]" is hollow.** It passes against a helper that
returns the empty string. Assert the message actually contains the thrown object's content.

**Two lanes share this laptop, and ANOTHER ORDER IS RUNNING RIGHT NOW.** `018-PARKCOLLECT` is in a
second worktree, it runs spine tests too, and **it is rewriting the very file you run in Part 3**
(`j-content.spine.test.ts`). Your worktree is a separate checkout so its edits cannot reach you —
but the **database can**. The spine harness drops and re-migrates its databases, so two lanes
against one Postgres re-migrate the same server to two different heads and produce a bogus
`migration.out.of.date` red that is not your bug. **Export a `CELLO_PG_HOST_PORT` unique to your
worktree** (the compose file reads it precisely for this; 5433 is the default, so take another) and
set `DATABASE_URL` to match.

**The other lane owns `DOD-MSG-3 (transport)`.** It fails in the same file you are running, on
`not_a_participant`. It is `018`'s, and its cause is unrelated to yours. Leave it red.

**Part 3 is the whole reason this order exists.** An order that fixes the formatting and stops has
done the easy half. The finding is the deliverable.

---

## Review

### Where this work lives

| | |
|---|---|
| Code edited | `/Users/andrep/Documents/code/m15-019/cello-client`, branch `m15/019-parkerror` |
| Spine run from | `/Users/andrep/Documents/code/m15-019/trustless-cello`, branch `m15/019-parkerror` |
| Postgres | `CELLO_PG_HOST_PORT=5434`, `DATABASE_URL=postgresql://postgres:dev@localhost:5434/cello_dev` |
| **Also required** | `COMPOSE_PROJECT_NAME=m15019` — see *Newly discovered* #1. `CELLO_PG_HOST_PORT` alone is **not** enough to isolate two lanes. |

### What changed

`extractErrorMessage` moved verbatim (comment intact, behaviour untouched, `JSON.stringify`
try/catch and its `String(err)` last resort kept) from `session-relay-client.ts` into
`core/daemon/src/error-message.ts`; all five previous importers repointed. All three `String(err)`
sites in `ipc-server.ts` now use it. The catch-all extracts once and sends the SAME text to the
response **and** to a new `logger.error("daemon.ipc.request.failed", { connectionId, method,
requestId, error })`. `guidance` is unchanged — "Check daemon logs for details" is now true.

### Gate — cello-client, exit codes read, not the tail

`pnpm run test` exit=0 (419 files / 4750 tests passed) · `lint` exit=0 · `typecheck` exit=0 ·
`build` exit=0.

### The mutation proof (DoD 4)

Tree confirmed clean before mutating; the fix was already committed, so the restore could eat
nothing. Mutation: `const message = extractErrorMessage(err)` → `const message = err instanceof
Error ? err.message : String(err)`.

**The mutant COMPILES** — `pnpm run build` exit=0 with it in place — so the red below is a test
catching it, not a compile failure being miscounted as a catch.

Red (exit=1):

```
× carries the message of a rejection that is a plain object with a message 8ms
  → expected '[object Object]' not to be '[object Object]' // Object.is equality
× carries the fields of a rejection that is a plain object with no message 1ms
  → expected '[object Object]' not to be '[object Object]' // Object.is equality
Tests  2 failed | 10 skipped (12)
```

Restored (`git checkout HEAD --`), line 257 confirmed back to `extractErrorMessage(err)`, tree
clean, rebuilt, `core/daemon/dist/ipc-server.js` confirmed to carry it. Green (exit=0):

```
✓ src/__tests__/ipc-server.test.ts (12 tests | 10 skipped) 6ms
Tests  2 passed | 10 skipped (12)
```

Two tests, one per branch of the helper, because a plain object **with** a `message` string and one
**without** take different paths and a single fixture would only ever prove one. Both assert the
object's content, not merely that it isn't `"[object Object]"` — that assertion alone passes against
a helper that returns the empty string.

### Part 3 — what the error was hiding, verbatim

`DOD-MSG-5`, the message that used to read `"[object Object]"`:

```
Error: ipcCall content_park_deposit error: {"code":"internal_error","message":"No open connection
to peer 12D3KooWDQJ8kLzL9CTM2NUrzQS34tECvNPGtSvMAkFn35YwoJtM","guidance":"An unexpected error
occurred. Check daemon logs for details."}
```

**Not fixed. Deliberately left red — see *Newly discovered* #2 for the finding.**

⚠️ **And the order's premise about these two tests is half wrong, which matters more than the
error text.** `DOD-MSG-5` is **not deterministic** — 2 of 3 runs were green (4798 ms and 5112 ms).
Three runs supports "not always red"; it does not support a rate, and the real-world rate is
unmeasured. `DOD-MSG-7` fails on something else entirely and never touches the `[object Object]`
path — *Newly discovered* #3.

`DOD-MSG-3 (transport)` left red: it is `018-PARKCOLLECT`'s.

### Reviewer verdict — `cello-unit-reviewer` on `9a1408a`, quoted

> **8 findings: 1 HIGH (a write-up claim that outruns its evidence and points the next order at the
> wrong subsystem), 3 MEDIUM (1 pre-existing test hole, 1 fixable in three lines inside this diff's
> own new code, 1 correctly deferred), 4 LOW. Nothing blocking in the shipped code path. The one
> change I would make before closing is MEDIUM-3 (add `reason` to `daemon.ipc.request.failed`); the
> one thing I would change in the write-up is HIGH-1 (restate #3 as unresolved rather than as a
> silent-success bug in the relay).**
>
> - **SPEC: FAITHFUL** — no deviation from the DoD text
> - **NO SILENT FALLBACKS** — "the diff removes one (a cause silently destroyed at the point of
>   reporting) and adds none"
> - **ERRORS NAME THEIR CAUSE** — for this diff
> - **TESTS HAVE TEETH** — "both new tests survive THE REVERT TEST, proven by a compiling mutant and
>   re-verified green by me; both take the branch they claim, with branch 1 definitively excluded by
>   the mutant's own output"
> - **REMOVALS PROVEN** — "source, in-repo importers, cross-repo importers, the `exports` map, and
>   both built artifacts (`.js` and `.d.ts`)"
> - **NO COMPATIBILITY DEBT**

**Disposition — every finding actioned:**

| # | Finding | Disposition |
|---|---|---|
| HIGH-1 | The #3 write-up claimed a silent-success bug in the relay on evidence that does not support it — "resolved without throwing" proves nothing, because `ipcCall` resolves on `{ok:false}` too and the test discards the result | **FIXED in the write-up.** Claim withdrawn in place (not deleted), #3 restated as unresolved with what is and is not established, and the next order pointed at `content.park.deposit.result` first. Reading that line is what turned up the harder fact now recorded there: daemon A accepted no IPC connection after the deposits began. |
| MEDIUM-2 | The DOD-MSG-7 test discards all three deposit results | **RECORDED as *Newly discovered* #5** with the one-clause fix, as an AC for the order that takes #2/#3. Out of scope here (Part 3 fixes are excluded). |
| MEDIUM-3 | The new log line drops the structured `reason`, so the log the guidance points at cannot answer "will re-dialling help?" | **FIXED in code** — commit `f69a47d`. `reason` lifted off a non-Error rejection and logged beside the message; the key is omitted entirely when absent, so an Error-shaped throw logs what it did before. Pinned by an added assertion on the test whose fixture mirrors the live transport producer. Mutation: delete the spread → `tsc --noEmit` exit=0 (compiles), test red on `expected undefined to be 'no_connection'`; restored, gate green. |
| MEDIUM-4 | `code: "internal_error"` is still an exit-point label over 9+ reasons, and the response still names no next step | **Confirmed, not fixed** — the order explicitly excludes it. Recorded in *Newly discovered* #2 as the first half of that finding. |
| LOW-5 | "1 of 3" does not support a rate | **FIXED** — restated as "not deterministic, 2 of 3 green". |
| LOW-6 | Test (b) pins a branch with no live producer today | **Accepted, test kept.** Defensive coverage; the report no longer implies it covers a live path. |
| LOW-7 | The helper's last-resort `String(err)` still yields `"[object Object]"` for a circular object | **Deliberately kept** — clause 1 requires a verbatim move, and the order's own trap forbids "improving" it. No current producer reaches it. |
| LOW-8 | The order's "not a published package" reasoning is factually wrong | **RECORDED as *Newly discovered* #6** with the correct reason no bump is needed. |

**Post-fix gate, run so it could fail:** `pnpm run test` exit=0 (419 files / 4750 tests) · `lint`
exit=0 · `typecheck` exit=0 · `build` exit=0.

## Newly discovered

### 1. Two lanes collide on the docker compose PROJECT NAME, not just the port — and it looks like a killed container

`CELLO_PG_HOST_PORT=5434` alone does **not** isolate a second worktree. Both worktrees' directories
are named `trustless-cello`, so `docker compose` derives the same project name for both; the second
lane's `compose up` finds the project already running, reuses the **other lane's** container on
**5433**, and ignores the port it was given. When the first lane then recreates its container, the
second lane's captured container id evaporates mid-run:

```
Error response from daemon: No such container: d1c19391be22b5f79e89669c01d1d537c14dac9e19b6db2a45d7f4cbb23a13a5
Error: Command failed: docker compose exec -T postgres psql ... DROP DATABASE IF EXISTS cello_spine_1 ...
  ❯ ensurePostgres src/spine/live-harness.ts:395:5
```

`docker compose ls` during the failure showed exactly one protocol project running —
`trustless-cello`, config file `/Users/andrep/Documents/code/trustless-cello/docker-compose.yml`,
port `5433` — while this lane believed it was on 5434.

**Consequence:** a lane that follows the order's isolation instruction to the letter still shares
the other lane's Postgres, and the failure reads as infrastructure flakiness rather than as a
collision. Exporting `COMPOSE_PROJECT_NAME=m15019` fixed it outright.

**Classification: POST-LAUNCH (harness/process, not product).** No customer runs two spine
worktrees; the cost is developer time and false reds. But the fix is one line in the harness
(derive the project name from the checkout path the way `PG_HOST_PORT` already derives from
`DATABASE_URL`), and the comment at `live-harness.ts:340` already explains this exact class of bug
for the port half — the project-name half was simply missed.

### 2. `content_park_deposit` throws `No open connection to peer <relay>` — intermittently

The cause the formatting bug was destroying. A deposit to the relay's content park rejects because
the daemon has no open libp2p connection to the relay peer at deposit time. It is a *throw*, not a
structured `{ ok: false, reason }` return, which is why it landed in the IPC catch-all in the first
place — and it is a plain object, not an `Error`, which is why `String(err)` flattened it.

**Evidence:** the verbatim message above, from `DOD-MSG-5`. Reproduced once; 2 of 3 runs green.
The upstream producer is `transport/src/node.ts`, which throws
`{ reason: "no_connection", peerId, message }` from `openStream` — a plain object, not an `Error`,
which is exactly why `String(err)` flattened it.

**Two separate things are wrong here and they want separate orders:**
- **The deposit path throws where its siblings return.** `content-park.ts` already uses
  `extractErrorMessage` in ten places and the recover path returns `{ ok: false }` — the deposit
  handler is the odd one out, and a throw is what routes an ordinary "the relay isn't connected
  right now" into `internal_error` with no reason code and no affordance. An operator whose send
  fails gets "An unexpected error occurred" for a condition the daemon understood perfectly well.
- **Why there is no open connection at deposit time.** Unread. Not investigated, per this order's
  rule 3.

**Classification: BLOCKS is not mine to grant (§0z.4).** Stated for whoever writes the next order:
this is on the advertised journey — a message to an offline counterparty is exactly what park
exists for — but it reproduced 1 in 3 in a harness, not against a live fleet, so the real-world
rate is unmeasured. **Question for Andre**, per §0z.4: does a park deposit that intermittently
reports `internal_error` block launch?

### 3. `DOD-MSG-7` fails on something else entirely, and the failure is UNRESOLVED — not diagnosed

The order predicted `DOD-MSG-5` and `DOD-MSG-7` fail on the same error. **They do not.**
`DOD-MSG-7` never reaches the `[object Object]` path at all:

```
AssertionError: expected false to be true // Object.is equality
 ❯ src/spine/j-content.spine.test.ts:368:20
   const rec = (await ipcCall(dirB, "content_park_recover", {...}));
   expect(rec.ok).toBe(true);
```

> ⚠️ **An earlier draft of this section said a deposit "reports success while the relay has no
> record of it." That claim is withdrawn — it was not established.** The three
> `content_park_deposit` calls resolved without throwing, and I read that as success. It is not:
> `ipcCall` rejects only when the IPC response carries an `error` field, so a handler that
> *returns* `{ ok: false, reason }` resolves **identically** to `{ ok: true }` — and the test
> discards all three return values, so nothing ever looked at `ok`. "Resolved" therefore proves
> nothing. Recorded rather than quietly corrected, because the mistake is this milestone's own
> subject matter — a symptom read as a cause — committed while writing up a defect about exactly
> that. Caught by `cello-unit-reviewer`.

**What IS established, and only this:**

- The three deposits resolved. Their `{ ok, reason }` was neither asserted by the test nor read.
- The relay logged no `content.park.received` and no `content.park.failed` for any of them. Its
  only park lines in the whole run were two `content.park.served count:0` from the earlier
  auto-drain. Debug logging was demonstrably on (`content.park.served` is itself DEBUG and it
  appeared), so this is not a verbosity artifact.
- Daemon A logged **no `content.park.deposit.result`** — the INFO line `deposit()` emits on every
  deposit, carrying `ok` and `reason`. It also accepted **no IPC connection after 19:57:18.397**,
  which is before the deposits ran. The harness dumps the whole unbounded buffer on exit (no cap
  on `this.lines`), and greps for `content.recover` in the same file return 3, so the search had
  reach and the file covers the window.

**That last point does not fit any explanation I have, and I am not going to invent one.** The
deposits resolved, so *something* answered them, yet the daemon they were addressed to recorded
neither the connection nor the deposit.

**The first thing the next order should do**, before touching the relay: read
`content.park.deposit.result` in daemon A on a fresh run, and add `expect(...).toMatchObject({ ok:
true })` to each of the three `dep(...)` calls (see #5). Either alone would have named the cause
without any log archaeology.

**Classification: cannot be classified until it is diagnosed.** Flagged to Andre as unresolved
rather than parked with a guess.

### 5. `[pre-existing]` The `DOD-MSG-7` test discards all three deposit results

`j-content.spine.test.ts:354, 360, 365` — `await dep({...})` with no assertion. This is the hole
that made the withdrawn claim in #3 possible: a deposit can be refused outright and the test walks
on to assert on recovery, then reports `expected false to be true` four steps downstream of the
thing that actually broke.

Fix is one clause per call: `expect(await dep({...})).toMatchObject({ ok: true })`.

**Classification: POST-LAUNCH (test hygiene).** Belongs as an AC on whichever order takes #2/#3 —
it is the cheapest thing that would make those two diagnosable.

### 6. This order's "do not publish" reasoning is wrong, though its conclusion is right

The Traps section says `core/daemon` "is not one of the five packages published from cello-client."
It is: `core/daemon/package.json` is `"private": false` with `publishConfig.access: public`, so
`@cello-protocol/daemon` **is** published.

No bump is needed anyway, for a different reason: `extractErrorMessage` is not re-exported from
`index.ts` or `testing.ts`, and the `exports` map has no wildcard subpath, so no consumer could
ever have imported it by name — moving it cannot break anyone.

Recorded because the next person to lean on "that package isn't published" for a change that
*does* touch the surface will be wrong, and the gate will not catch it.

### 4. The `String(err)` pattern is 330 sites across 79 files, and this unit cleared three of them

Not swept, per the order's explicit "Not in scope" — but **measured** rather than guessed, because
"it may well exist elsewhere" and "it exists 330 times" are different findings. Counted with
`grep -rn "String(err" core/ --include="*.ts"`, excluding `dist/`, `node_modules/`, `__tests__/`
and the helper's own last-resort fallback: **330 occurrences in 79 files**, of which **270 in 58
files are inside `core/daemon/src` alone**.

Most are almost certainly harmless — the value really is an `Error` on most of those paths, and the
ternary's first branch takes it. The point is that nobody knows which ones are not, and each one is
a place where a plain-object rejection becomes `"[object Object]"` in exactly the way this order
was written to fix. `extractErrorMessage` now has a neutral home, so the sweep is mechanical.

**Classification: POST-LAUNCH.** No individual site is known to be reachable by a customer today;
the one that was — the IPC catch-all every method inherits — is what this unit closed.
