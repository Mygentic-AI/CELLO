---
name: 028-PARKCONN — A message to an offline counterparty does not coin-flip
type: micro-work-order
date: 2026-09-04
status: complete
dod_line: DOD-M15-PARKCONN-1
dod_effect: unit-of
dod_effect_note: >
  Part 1 of the line — the failure is now legible and named, on the deposit, pull and recover paths.
  Part 2 handed back under this order's own stop rule, so the line stays ❌. STILL OWED: the sender's
  rebuilt standing receiver cannot hold a relay reservation, and every dial to that relay is then
  refused. Evidence in Newly discovered #1.
description: >
  Messaging someone whose agent is offline sometimes parks and sometimes fails with
  `No open connection to peer <relay>`. The deposit path DOES dial the relay first — and throws away
  every dial failure with an empty catch, so the one fact that explains the outcome is deliberately
  discarded. Make the dial failure legible, make the deposit refuse like its siblings instead of
  throwing, then fix what the legible failure names. PART 1 SHIPPED; Part 2's stop rule FIRED — the
  cause is a rebuilt standing receiver that cannot hold a relay reservation, so DOD-M15-PARKCONN-1
  stays ❌ and the evidence is handed back under Newly discovered.
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

### Outcome — Part 1 SHIPPED, Part 2's STOP RULE FIRED

**Part 1 is done and is worth having on its own:** an unexplained coin flip is now a named refusal
that says why, and the reason each relay address failed is in both the response and the log.

**Part 2 stopped.** What the legible failure names is the sender's standing receiver failing to hold
a relay reservation after a rebuild — *"a reservation/reconnect lifecycle change … anything touching
how the standing receiver holds its relay connection"*, which the stop rule names verbatim. It is
written up under *Newly discovered* and handed back.

**Therefore `DOD-M15-PARKCONN-1` stays ❌.** DoD 6 (three consecutive green runs) is NOT met — the
three tests are still red, for the cause below. This order's `dod_effect` is changed from `closes`
to `unit-of` to say so honestly.

### Where this work lives

| | |
|---|---|
| branch (both repos) | `m15/028-parkconn` |
| daemon | `/Users/andrep/Documents/code/m15-028/cello-client` |
| spine | `/Users/andrep/Documents/code/m15-028/trustless-cello` |
| Postgres isolation | `COMPOSE_PROJECT_NAME=m15028`, `CELLO_PG_HOST_PORT=5436`, `DATABASE_URL=postgresql://postgres:dev@localhost:5436/cello_dev` |

Nothing publishes. The change is daemon-internal plus one spine test; no wire behaviour, no crypto
type, no schema, so no `/cello-publish` cascade and no `trustless-cello` re-pin.

### The cause, verbatim (DoD 4)

**The empty `catch` was hiding TWO different failures, and both are now readable.**

**Face 1 — the deposit lands in the standing-receiver rebuild window.** Read on three separate runs:

```
{"ok":false,"reason":"standing_receiver_unavailable","cause":"standing_receiver_creating",
 "guidance":"The standing receiver is still being built; retry this deposit in a few seconds."}
```

This branch already refused before this order; the spine test was **discarding the result**, so it
surfaced four steps downstream as `expected +0 to be 1`. It returned the bare exit-point label — the
one `standingReceiverAbsenceReason()` exists to replace — so nothing said which of its four causes it
was. Fixed: the handler now carries `cause`, and the spine helper waits this one cause out.

**Face 2 — the dial itself is reset, and this is the one that stops the unit.** Verbatim, three
different error strings for the same event depending on how far the handshake got:

```
"dialFailures":[{"addr":"/ip4/127.0.0.1/tcp/62913/p2p/12D3KooWRpMthPmFX8LVFvjpgH6sgaSeHYXKjPh9f8bSoTJMrXxQ",
                 "error":"connect ECONNRESET 127.0.0.1:62913"}]
"dialFailures":[{... same address ..., "error":"Encryption failed"}]
"dialFailures":[{... same address ..., "error":"Unexpected EOF - stream closed while reading 0/1 bytes"}]
```

`Encryption failed` is a Noise handshake that the far end closed part-way; `Unexpected EOF … 0/1
bytes` is the same event one layer out. **The last of the three is what `019-PARKERROR` measured as
`No open connection to peer 12D3Koo…`** — the transport's report of the consequence, one frame after
the cause was thrown away.

**The sender daemon's own account, same millisecond, on every failing run:**

```
{"event":"transport.autonat.unavailable","nodeType":"standing_receiver","directorySignalingStatus":"reconnecting"}
{"event":"session.node.created","agentName":"__standing_receiver__:agentA","sessionPeerId":"12D3KooWDwqbw1cjXAT7LpGqEBvGNSB4R7mjLHCjEv4AoMF1VZTv"}
{"event":"session.standing_receiver.reachability","agentName":"agentA","circuitAddrs":0,"reservationsRequested":1}
{"event":"session.standing_receiver.reservation.none","agentName":"agentA","relayPeerIds":["12D3KooWRpMthPmFX8LVFvjpgH6sgaSeHYXKjPh9f8bSoTJMrXxQ"]}
{"event":"content.park.open.failed","reason":"no_connection","dialOutcome":"all_addresses_failed","addrsTried":1, ...}
```

**The relay's account of the same millisecond:**

```
[RELAY] Peer connected: 12D3KooW
{"event":"relay.reservation.denied","peerId":"12D3KooW","reason":"not_authenticated","asksWithoutProving":1}
{"event":"relay.auth.reservation_proof","remotePeerId":"12D3KooWM18neUFmTBNqHjy9oubLKA6r8FvuLDhtR9CwMcP8s3Jn","pubkey":"ecdd7c89"}
[RELAY] Peer disconnected: 12D3KooW
```

**Read as a flow, which is what makes it a stop-rule case:**

1. Something rebuilds agentA's standing receiver — a new session, or a seal. A **new peer identity**
   is minted (`session.node.created`, `12D3KooWDwqb…`).
2. The new receiver asks the relay for a circuit reservation and gets none:
   `reservation.none`, `circuitAddrs: 0`.
3. The relay saw a reservation proof in that window — but from `12D3KooWM18n…`, a **different peer id
   from the receiver that was just created** — and then disconnected the peer.
4. From that point every dial from this daemon to that relay is reset (`ECONNRESET`), fails the
   Noise handshake (`Encryption failed`), or dies mid-multistream (`Unexpected EOF`).
5. `newStream` then reports `no_connection`, which is where `019` picked the story up.

**What I cannot prove from code alone:** whether the relay is refusing the new peer (a reservation
cap or an authentication binding) or the receiver is presenting the wrong identity for its
reservation. Either answer is a change to how the standing receiver holds its relay connection, so
either answer is over the stop rule.

**And it is NOT test-only.** The daemon's PRODUCTION auto-recover drain fires in the same instant and
fails for the same reason — this is not confined to the raw IPC surface:

```
{"event":"content.recover.auto.failed","agentName":"agentA","trigger":"standing_receiver_ready","stage":"relay",
 "error":"content park relay 12D3KooWRpM… is unreachable (no_connection): No open connection to peer 12D3KooWRpM…
          Dials tried: /ip4/127.0.0.1/tcp/62913/p2p/12D3KooWRpM… → connect ECONNRESET 127.0.0.1:62913"}
{"event":"content.recover.auto.completed","recovered":0,"relayCount":1,"failedRelays":1}
```

### The runs

Seven live runs, all as separate OS processes against the real three-node consortium and the real
relay binary. **The enforcer is NOT met** — no green run of the three tests, let alone three
consecutive.

| # | test | result | what the deposit said |
|---|---|---|---|
| 1 | DOD-MSG-7 | ❌ | `ok:false` (reason not yet printed — fixed after this run) |
| 2 | DOD-MSG-7 | ❌ | `standing_receiver_unavailable` |
| 3 | DOD-MSG-7 | ❌ | `standing_receiver_unavailable` / `standing_receiver_creating` |
| 4 | DOD-MSG-8 | ❌ | `ok:false` at the straggler deposit |
| 5 | DOD-MSG-7 | ❌ | `relay_unreachable:no_connection` — `Unexpected EOF … 0/1 bytes` |
| 6 | DOD-MSG-7 | ❌ | same, with the full sender + relay tails quoted above |
| 7 | DOD-MSG-5 | ❌ | `relay_unreachable:no_connection` — `ECONNRESET`, then `Encryption failed` |
| 8 | DOD-MSG-7 | ❌ | re-run after the review fixes — same cause, and the transport's `no_connection` is still labelled as reachability, correctly |

**One control run is recorded because it nearly produced a false conclusion, and the correction is
the useful part.** With the relay ingress proxy taken out of the path (`relayIngressProxy: false`,
diagnostic only, never committed), DOD-MSG-7 went green — and I was one step from reporting that
024-ORPHANTRIAGE's proxy was the cause. Running DOD-MSG-5 under the same condition refused that:
it still failed, with `ECONNRESET` and `Encryption failed` instead of `Unexpected EOF`. **The proxy
changes the error TEXT, not the outcome.** A single green run of one test is exactly the evidence
this order says proves nothing, and it was about to.

### DoD, line by line

| # | | |
|---|---|---|
| 1 | ✅ | dial failures are in the response (`dialFailures`) and the log (`content.park.open.failed`) |
| 2 | ✅ | `content_park_deposit` returns `{ok:false, reason, guidance}`; no throw, no "unexpected error" |
| 3 | ✅ | one `content.park.deposit.ipc.result` per call, carrying `ok` and `reason` |
| 4 | ✅ | the cause is quoted verbatim above |
| 5 | ❌ | **handed back under the stop rule**, with the evidence |
| 6 | ❌ | **not met** — no green run; the line stays ❌ |
| 7 | ✅ | all five discarded deposits now assert `ok`, through `parkDeposit` |
| 8 | ✅ | see the mutation proof below |
| 9 | ✅ | `pnpm run test` (4872 passed), `lint`, `typecheck` all green in cello-client; `typecheck` + `lint` green in trustless-cello. Nothing publishes. |
| 10 | see below | |
| 11 | ❌ left in place; `dod_effect` changed to `unit-of` | |

### Mutation proof (DoD 8)

Seven mutants, baseline printed first (9 passed), each re-run ALONE and seen red, tree confirmed
clean before and after. All compile — none was caught by lint or typecheck instead of a test.

| | mutation | red | for the right reason |
|---|---|---|---|
| M1 | `#open` discards the dial error again (the original empty `catch`) | A1 | `dialFailures` is empty; the message no longer names the address |
| M2 | `dialOutcome` collapsed to a constant `all_addresses_failed` | A2 | the dialed-then-lost case is misreported as a dial failure |
| M3 | report the dial failures even when `newStream` SUCCEEDS | A1, A3 | A3: *"a dial that did not matter must stay quiet: expected { level: 'warn', …(2) } to be undefined"* |
| M4 | deposit handler drops its `catch` and lets the throw escape | B1 | the refusal never happens |
| M5 | deposit handler logs nothing (the shape before this unit) | B1, B2, B3 | no `content.park.deposit.ipc.result` on any path |
| M6 | return the bare `standing_receiver_unavailable` with no `cause` | C1, C2, C3 | the four causes collapse back into one label |
| M7 | guess `agents[0]` instead of refusing when several agents exist | C3 | a confident cause about the wrong agent |
| M8 | label every transport reason `relay_unreachable` (the pre-review shape) | D×5 | a payload / local / version fault wearing a network fault's name |
| M9 | drop the `/p2p/` shape check | D8 | a truncated address is dialled instead of refused |
| M10 | log only the `ok` path (the pre-review coverage) | B1, B3, B4, B5, C1 | every refusal returns in silence again |
| M11 | rethrow the transport wrap from `content_park_pull` | E1, E2 | **SURVIVED the first time — the MEDIUM-2 fix was real and unguarded.** E1–E3 were written for it. |
| M12 | rethrow it from `recoverParkedFromRelay` | E3 | `internal_error` on the handler this order was written from |

**M11 is the one worth reading.** It SURVIVED on its first run, which is the whole argument for the
loop: the MEDIUM-2 fix was real, correct, and had no test — exactly the shape *"a checker whose
negative path has never been exercised"* takes when it is a fix rather than a checker. Three tests
were written for it before it would redden.

**M3 needed the second half of the rule.** It reddened TWO tests, and A1 is the one it was not aimed
at — so the red could have come from a path already covered. Re-run alone, A3's own message is quoted
above and names exactly the property the mutation removed.

**The spine-side assertion is not mutated, and does not need to be.** `parkDeposit`'s `ok` check has
been observed FAILING seven times with the response quoted verbatim, and observed PASSING on the
proxy-off control run — so it is neither stuck green nor stuck red, which is what a mutation would
have been asked to establish.

### Reviewer verdict (DoD 10)

`cello-unit-reviewer`, one pass, on the two-repo diff. **Three blocking verdicts, every finding
fixed, each fix committed on its own.** In its own words:

> **SPEC: DEVIATIONS FOUND** — clause P1.3/DoD 3 ("the handler logs its result") is implemented for
> 2 of 13 exits (MEDIUM-3). Un-journaled, therefore [blocking].
>
> **ERROR SUBSTITUTION FOUND** — [blocking]. `relay_unreachable:invalid_peer_id` /
> `:node_stopped` / `:protocol_not_supported` with retry-the-relay guidance sends the operator to
> the network for a payload, local-transport, or version fault (HIGH-1). MEDIUM-2 is the same class
> by omission: two sibling handlers still surface it as `internal_error` / "An unexpected error
> occurred".
>
> **HOLLOW TESTS FOUND** — [blocking], one item. **A3 fails THE REVERT TEST**: every one of its
> assertions passes on unmodified `main`.
>
> **NO SILENT FALLBACKS** · **REMOVALS PROVEN** · **NO COMPATIBILITY DEBT.**
>
> I am not rubber-stamping this: the diff touches the park/persistence path and I found a
> substitution defect in the very mapping site the unit added, plus a partial log implementation and
> a half-applied refusal.

**The finding that matters most, and it is the milestone's own defect turned on this unit.** `#open`
wraps every `newStream` rejection, and the handler was labelling all six of them "the relay could not
be reached — retry once it is up". Three of the six are not reachability at all: `invalid_peer_id` is
a **malformed argument**, `node_stopped` is **this daemon's own transport**, and
`protocol_not_supported` means the connection **worked** and the relay does not speak content-park.
An operator with a truncated multiaddr was told to wait for a healthy relay and then broker a new
session — neither of which fixes a typo. That is `counterparty_offline` all over again, minted at the
mapping site this unit had just added, in a unit whose entire subject is errors that name their exit
point instead of their cause.

**Also fixed:** the pull and recover handlers, which inherited the shared `#open` and rethrew (so an
unreachable relay still reached the operator as *"An unexpected error occurred"* one handler over —
on `content_park_recover`, one of the three failures this order was written from); the result log,
which now WRAPS the handler instead of sitting beside two of its thirteen exits; the sole-agent guess,
which counted `load_failed` agents its own neighbour filters out; a zero-agent daemon being told it
had "more than one"; a `senderAgentName` typo being reported as an offline agent; a prescriptive
`impact` string generalised from one sample; the relay's `retryAfterMs` missing from the log; and the
pull handler still constructing its client outside the test seam.

**And a standing guard caught one of my fixes.** The new guidance named `cello_list_agents` — a tool
that does not exist. `DOD-ONBOARD-HELP-1`'s source audit refused the build: *"An error message handing
the operator a dead command is worse than no message."* It is `cello_agents`.

### The reviewer's caveat, recorded because the next unit needs it

> The retry blunts the enforcer on face 1. When face 2 is eventually fixed, MSG-5/7/8 will go green
> partly because the test waits out `standing_receiver_creating`, not because that window closed. The
> test cannot distinguish "the rebuild is instant" from "the rebuild takes 19 seconds". Given
> production re-drives park on four triggers, that is defensible — but DoD 6's future green is now
> weaker than it reads, and someone should know that before quoting it.

**And two claims in the cause above are correlation, not proof**, which the reviewer was right to
make me mark: that "reservation denied" *causes* the subsequent resets is a temporal correlation; and
`relay.auth.reservation_proof` naming a different peer id is as consistent with the new receiver
never sending a proof at all as with the relay dropping it. **Cause not yet established** — that
distinction is where the next unit starts.

## Newly discovered

*(found and NOT acted on, per rule 3)*

### 1. 🛑 THE STOP-RULE ITEM — a rebuilt standing receiver cannot get a relay reservation, and every dial to that relay is then refused

**BLOCKS — but it is Andre's to grant (§0z.4), so it is written here rather than added to the gate.**

**What the operator lives through.** Their agent finishes a conversation, or starts a new one. Behind
that, the daemon quietly rebuilds the standing receiver — the node that holds the agent's slot on the
relay. The new one asks the relay for its slot and does not get it. From that moment the agent cannot
reach that relay at all: parked mail it is holding for the counterparty cannot be deposited, and mail
waiting for it cannot be drained. Nothing announces this; the conversation simply stops moving.

**The evidence is quoted verbatim in "The cause" above** — the four sender events and the four relay
events, from the same millisecond, reproduced on every failing run.

**Why it is not this order's:** the fix is in how the standing receiver obtains and holds its
reservation, or in what the relay will accept from a peer it has just seen replaced. The order's stop
rule names both. It also touches `008-slots` (the relay's unproven reservation cap) and
`SESSION-RELAY-PINNED-1`.

**Where to start**, because the evidence narrows it: the reservation proof the relay logged in that
window (`relay.auth.reservation_proof`, `remotePeerId 12D3KooWM18n…`) came from a **different peer id
than the receiver that had just been created** (`12D3KooWDwqb…`). Establish which peer is supposed to
be proving, and the rest follows.

### 2. `content_park_pull` still returns the bare `standing_receiver_unavailable` label

`core/daemon/src/content-park.ts` — the pull handler has the identical exit the deposit handler had
before this unit: the label with no `cause`, and a guidance string that assumes "retry after startup"
is the answer for all four causes. Same one-expression fix. **POST-LAUNCH** — it is a diagnostic
surface with no production caller (`recoverParkedFromRelay`, which production uses, already names its
cause), so an operator does not reach it.

### 3. The deposit hook on the PRODUCTION send path still throws on an unreachable relay

`daemon.ts` ~2387 and ~2517 `await client.deposit(node, …)` with no `try`. Both now receive a typed
`ContentParkUnreachableError` instead of a bare transport literal, so the message is readable rather
than `[object Object]` — but the throw still escapes rather than becoming the typed failure those
call sites already shape for `standing_receiver_unavailable`. **POST-LAUNCH**, and it is `daemon.ts`,
outside this order's files. Not urgent because the caller's four re-drive triggers still fire; it is
the reporting that is asymmetric, not the delivery.

### 4. The comment on `relayIngressProxy: true` in `j-content.spine.test.ts` is measurably false

It reads *"Inert while nothing black-holes it, so every other test in this file sees the relay exactly
as before."* Measured: with the proxy in path the dial failure reads `Unexpected EOF - stream closed
while reading 0/1 bytes`; with it removed the identical failure reads `connect ECONNRESET` and
`Encryption failed`. The proxy is not transparent — it rewrites how a failure presents, which is
precisely what cost a run here. **POST-LAUNCH / test hygiene.** Left in place and not rewritten
because rewriting it means first establishing what the proxy actually does to a libp2p connection,
which is the investigation the stop rule declines.

### 5. This order's own correction about `content.park.deposit.result` is half wrong

The order says *"There is no such event."* There is: `ContentParkClient.deposit` emits
`content.park.deposit.result` at `content-park-client.ts:167`. The useful half of the correction
stands and is the reason it looked absent — that line runs only **after** the stream opened and an
ack came back, so it can never fire on the path that was failing. `019` was right that the event was
missing from the log and right that chasing it was a dead end; the reason is that it is on the
success path, not that it does not exist.

Recorded rather than edited into the order body, because the instruction to a later reader is the
same either way: **do not go looking for it on a failed deposit.** The new
`content.park.deposit.ipc.result` is deliberately named differently so the two layers never collide
in one aggregated log.
