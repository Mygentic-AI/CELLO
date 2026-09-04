---
name: 028-PARKCONN — A message to an offline counterparty does not coin-flip
type: micro-work-order
date: 2026-09-04
status: open
dod_line: DOD-M15-PARKCONN-1
dod_effect: closes
description: >
  Messaging someone whose agent is offline sometimes parks and sometimes fails with
  `No open connection to peer <relay>`. The deposit path DOES dial the relay first — and throws away
  every dial failure with an empty catch, so the one fact that explains the outcome is deliberately
  discarded. Make the dial failure legible, make the deposit refuse like its siblings instead of
  throwing, then fix what the legible failure names. CLOSES DOD-M15-PARKCONN-1.
---

# **<ins>MICRO</ins>** WORK ORDER 028-PARKCONN — The offline path stops being a coin flip

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

## What the operator lives through

They message someone whose agent is offline — which is exactly what park exists for. Sometimes the
message parks and waits. Sometimes it fails. **Same action, two outcomes, and nothing tells them
which one they got or why.** Until `019-PARKERROR` fixed the reporting a fortnight of this was
invisible: the cause was being stringified into `"[object Object]"` before anyone could read it.

---

## What is established — MEASURED. Do not re-derive, and do not extend.

**The error, read for the first time by `019-PARKERROR` (2026-09-03), verbatim:**

```
ipcCall content_park_deposit error: {"code":"internal_error","message":"No open connection
to peer 12D3KooWDQJ8kLzL9CTM2NUrzQS34tECvNPGtSvMAkFn35YwoJtM","guidance":"An unexpected error
occurred. Check daemon logs for details."}
```

**It is three tests, not one — re-measured by `024-ORPHANTRIAGE` (2026-09-04).** `DOD-MSG-5`,
`DOD-MSG-7` and `DOD-MSG-8` in `j-content.spine.test.ts` all fail on this message: two on the raw
`content_park_deposit` / `content_park_recover` IPC, one on a `cello_send` returning false. **024 ran
the control** — the same file at `origin/main` with 024's change reverted produced the identical
three failures, so this is pre-existing and belongs to nobody else.

**The rate is NOT ESTABLISHED.** An earlier reading of "~1 run in 3" came from three runs, and
`019` said so itself: three runs supports *"not always red"* and supports no rate at all. **Never
measured against the live fleet.** Do not quote a rate you have not measured.

---

## The producer/consumer chain, read in code 2026-09-04

1. **Consumer.** `content_park_deposit` IPC handler, `core/daemon/src/content-park.ts` ~569–701. It
   ends `return await client.deposit(node, {...})` — no try/catch, no log.
2. `ContentParkClient.deposit` (`content-park-client.ts:95`) opens a stream via `#open(node)`.
3. **`#open` DIALS FIRST** (`content-park-client.ts:293–304`):
   ```ts
   for (const addr of this.#relayAddrs) {
     try { await node.dial(addr); break; }
     catch { /* try the next addr; newStream below may still succeed from the peerstore */ }
   }
   return node.newStream(this.#relayPeerId, CONTENT_PARK_PROTOCOL_ID);
   ```
4. **Producer of the error.** `newStream` (`core/transport/src/node.ts:499–508`) throws
   `{ reason: "no_connection", peerId, message }` — **a plain object, not an `Error`** — when
   `getConnections(peerId)` finds none open.

### The gap, and it is the finding of this order

**The deposit path is not failing to dial. It dials, the dial fails, and the failure is thrown
away.** That empty `catch` is the only place the reason for the missing connection ever existed.
By the time the operator sees `no_connection`, the cause has been deleted by our own code — which is
this milestone's named defect class (a silent fallback that makes a broken thing look like a
different broken thing) sitting in the middle of the path we are trying to diagnose.

**The throw site's own comment says the same thing from the other end:**
> *"`no_connection` is DISTINCT from `connection_lost`, and the difference decides whether re-dialling
> can help. **This is the one condition a dial fixes** — there is no connection at all."*

A dial DID run. So either every address was unusable, or the dial succeeded and the connection was
gone again by the time `newStream` looked. **Both are answerable from the discarded error, and from
nothing else.**

### ⚠️ A correction you need before you go log-hunting

`019` recorded that daemon A logged **no `content.park.deposit.result`**, and could not explain it.
**There is no such event.** `content.park.deposited` and `content.park.deposit.failed` are emitted by
the daemon's own **send-path** deposit (`daemon.ts` ~2233–2400) and by `session-node-manager.ts`.
**The IPC handler the spine test calls logs NOTHING AT ALL** — it returns the client's result
directly. The daemon was not silent about a deposit; it was never asked to say anything. Do not spend
a run chasing that ghost.

---

## Part 1 — Make the failure legible (do this first, it is small and certain)

Three changes, all narrow:

- **`#open` stops discarding dial failures.** Collect each `(addr, reason)` and, when `newStream`
  then throws `no_connection`, attach them so the caller learns WHY there was no connection rather
  than only that there wasn't one. **Keep the best-effort loop** — trying the next address is
  correct, and a dial that fails while `newStream` later succeeds from the peerstore must stay a
  non-event. What must not survive is the *silence*.
- **The deposit handler refuses like its siblings.** `content-park.ts` returns
  `{ ok: false, reason }` everywhere else — the recover path even maps `ContentParkRefusedError`
  explicitly. The deposit handler is the odd one out, and a throw is what routes an ordinary
  "the relay is not connected right now" into `internal_error` with no reason code and no next step.
  Give it a named reason and an affordance (Invariant 4).
- **The handler logs its result**, once, with `ok` and `reason` — the line `019` went looking for and
  did not find.

**`#open` is shared by deposit AND pull.** Both inherit the fix; do not fork it.

---

## Part 2 — Read what Part 1 names, and fix it. WITH A STOP RULE.

Run the three failing tests until you have the dial failures in hand, then fix the cause.

**⚠️ THE STOP RULE, and it is not optional.** If the cause turns out to be bigger than a micro order
— a reservation/reconnect lifecycle change, a relay-side change, anything touching how the standing
receiver holds its relay connection — **STOP. Write it up under *Newly discovered* with the evidence
and hand back.** Part 1 shipped alone is already worth having: it converts a coin flip with no
explanation into a named refusal. Growing this unit into a connection-lifecycle rewrite is the rabbit
hole, and §0z.2's trip-wire applies.

**What you may fix inside this unit:** a missing or mistimed dial, a wrong address, a
connection dropped by something on our side that has an obvious owner, a race between the standing
receiver coming up and the deposit being attempted.

---

## Part 3 — The three ways to get this wrong, ruled out in writing

> ### 🎯 Read before touching code.

**Wrong fix 1 — "wrap the throw and return `{ok:false}`, done."** That is Part 1, and Part 1 alone
does not close this line. `019` already fixed the *reporting*; the line is about the message
**failing**, not about how the failure reads. A named refusal on a send that still fails half the
time is a better-labelled coin flip.

**Wrong fix 2 — "retry the deposit in a loop until it connects."** Two reasons. It hides the cause
permanently, so nobody ever learns why the connection was missing. And a relay that is genuinely
unreachable must reach the operator as a refusal, not as a hang — this milestone has already paid for
one unbounded retry (232,056 knocks over 62 hours, a 484 MB log).

**Wrong fix 3 — "deposit to any relay that IS connected."** The park relay comes from the session
assignment. A client that picks its own relay is a client grading its own homework — the exact
property `LEAFPARTIES-1` and `CORROBORATE-1` spent themselves closing, and the same reasoning that
forbids widening the re-dial in `SESSION-RELAY-PINNED-1`.

---

## Definition of Done

1. **A dial failure inside `#open` is recoverable from the record** — when the deposit fails with no
   connection, the reason each address failed is in the response or the log. The empty catch no
   longer eats it.
2. **`content_park_deposit` returns `{ ok: false, reason, guidance }`** for a relay it cannot reach.
   It does not throw, and the operator is not told *"An unexpected error occurred."*
3. **The handler emits one result log line** carrying `ok` and `reason`.
4. **The cause is READ AND WRITTEN DOWN VERBATIM** in the Review section — the actual dial failures,
   quoted, not summarised. This is a deliverable even if Part 2's stop rule fires.
5. **The failure is fixed, or handed back under the stop rule with the evidence.** State plainly
   which happened. Do not close this line on Part 1 alone.
6. **Enforcer — `j-content` `DOD-MSG-5`, `DOD-MSG-7` and `DOD-MSG-8` green across THREE CONSECUTIVE
   runs**, as separate OS processes, with the run output quoted. Three runs because the failure is
   intermittent and one green run proves nothing here. *(If the stop rule fires, this is not met and
   the line stays ❌ — say so.)*
7. **Test hygiene, carried from `019` *Newly discovered* #5:** `j-content.spine.test.ts` ~354/360/365
   `await dep({...})` with the result **discarded**. Assert `toMatchObject({ ok: true })` on each. It
   is the hole that let a refused deposit surface as `expected false to be true` four steps
   downstream, and it produced a claim that had to be publicly withdrawn.
8. **Each new assertion has been made to fail on purpose** and confirmed to fail for the reason
   expected. **Commit before the mutation loop exists.**
9. Gate passes in cello-client. State whether anything publishes.
10. Reviewed by `cello-unit-reviewer`, every finding fixed, verdict quoted below.
11. `DOD-M15-PARKCONN-1` flipped in `M15-DEFINITION-OF-DONE.md` **in the same commit as the
    verdict** — ✅ if DoD 6 is met, left ❌ with the stop-rule write-up if not. Then
    `python3 docs/planning/user-stories/m15/tools/dod-order-sync.py` exits 0.

**Not in scope:**
- **The 330 other `String(err)` sites** (`019` *Newly discovered* #4). Measured, post-launch, not
  yours.
- **`DOD-MSG-8`'s renamed tool call.** It was previously filed as a test calling
  `cello_get_transcript` (now `cello_transcript`). If that is still wrong it is a one-line test fix —
  take it if it blocks DoD 6, and record it. Do not go further into that test.
- **Relay-side park behaviour.** `PARKCOLLECT-1` and `PARKERROR-1` are closed; this is the daemon
  side of the same journey.
- **Why a live conversation cannot move relays** — `SESSION-RELAY-PINNED-1`, a whole story.

---

## Traps recorded before you start

**The path DIALS. Do not "fix" it by adding a dial.** Read `#open` first — the dial is there, and its
failures are discarded. Adding a second dial in front of it changes nothing and hides the same fact
one layer further out.

**"Resolved" is not "ok".** `ipcCall` rejects only when the IPC response carries an `error` field, so
a handler returning `{ ok: false, reason }` resolves **identically** to `{ ok: true }`. `019` read
three resolved deposits as three successes and had to withdraw the claim in writing. Read `ok`.

**Do not chase `content.park.deposit.result`.** It does not exist on this path — see the correction
above.

**A plain object is not an `Error`.** The transport throws `{ reason, peerId, message }` object
literals. `instanceof Error` is false, `String(err)` gives `"[object Object]"`, and `err.message`
works only because the literal happens to carry one. `extractErrorMessage` (added by `019`) is the
tool.

**Three runs, not one.** The failure is intermittent and the rate is unmeasured. A single green run
is not evidence, and reporting one as if it were is the exact failure this milestone keeps naming.

**ANOTHER LANE MAY BE RUNNING.** If you bring up Postgres, export a `COMPOSE_PROJECT_NAME` unique to
your worktree **as well as** a unique `CELLO_PG_HOST_PORT`. The port alone does NOT isolate you —
both worktree directories are named `trustless-cello`, so compose derives the same project name,
silently reuses the other lane's container on the other lane's port, and the failure reads as
infrastructure flakiness (`019` *Newly discovered* #1, measured).

**Work in a PAIRED worktree** — `<lane>/cello-client` and `<lane>/trustless-cello` as siblings, and
load `/worktree-permissions` before creating one.

---

## Review

### Where this work lives
*(worktree paths, branch, and the `COMPOSE_PROJECT_NAME` / `CELLO_PG_HOST_PORT` you used)*

### The cause, verbatim
*(DoD 4 — the actual dial failures, quoted. Required whether or not Part 2's stop rule fired.)*

### The rest
*(the three consecutive runs from DoD 6, the mutation proof, the reviewer's verdict)*

## Newly discovered

*(anything found and NOT acted on, per rule 3)*
