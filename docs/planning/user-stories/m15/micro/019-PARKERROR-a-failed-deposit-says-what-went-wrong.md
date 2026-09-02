---
name: 019-PARKERROR — A failed park deposit says what went wrong
type: micro-work-order
date: 2026-09-02
status: open
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
*(worktree path, branch, and the `CELLO_PG_HOST_PORT` you used — so a second reader can reproduce
the run rather than guess which Postgres it hit)*

### The rest
*(the mutation proof from DoD 4, the verbatim error text from Part 3, the reviewer's verdict)*

## Newly discovered

*(the real cause behind DOD-MSG-5 / MSG-7 goes here, with evidence, unfixed — plus anything else
found and not acted on, per rule 3)*
