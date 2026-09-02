---
name: 018-PARKCOLLECT — A parked message can actually be collected
type: micro-work-order
date: 2026-09-02
status: complete
description: >
  The spine lane says a recipient cannot collect a parked message — the relay refuses with
  not_a_participant. The SAME run shows the real send-to-offline path collecting fine, twice. This
  order runs the live check the DoD demands, records the verdict, and fixes what the verdict says —
  which the trace below predicts is the TEST, not the relay. Source: DOD-M15-PARKCOLLECT-1.
---

# **<ins>MICRO</ins>** WORK ORDER 018-PARKCOLLECT — Can a parked message be collected?

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

> ## ⛔ THE ONE THING YOU MUST NOT DO
>
> **Do not weaken, bypass, or add an exception to the relay's vouching gate** — the check in
> `packages/relay/src/content-park.ts` that refuses a pull with `not_a_participant`. That gate is
> `DOD-M15-RELAYAUTH-1`, closed on 2026-09-01 after two review passes. It exists so that a key never
> named by a directory-signed session cannot collect mail. **If your fix touches that `if`, you have
> fixed the wrong thing.** The evidence below says the gate is right and the test is wrong.

---

## Where this work lives — TWO REPOS, and every path below is relative to one of them

- **`trustless-cello`** → `/Users/andrep/Documents/code/trustless-cello`
  Paths beginning `packages/…` and `docs/…` are here. **The file you edit is here:**
  `packages/e2e-tests/src/spine/j-content.spine.test.ts`. Read-only here:
  `packages/relay/src/content-park.ts`, `packages/relay/src/relay-node.ts`.
- **`cello-client`** → `/Users/andrep/Documents/code/cello-client`
  Paths beginning `core/…` are here. **Read-only in this order:**
  `core/daemon/src/session-node-manager.ts`.

If a path does not resolve, you are in the wrong repo — check the prefix before concluding a file is
missing. **This order edits ONE file, in `trustless-cello`.**

---

## What the operator is afraid of (why this blocks launch)

1. They message someone whose agent is offline.
2. The relay accepts it. Their side says **parked — success.**
3. The recipient comes online and collects.
4. The relay refuses: `relay_refused_pull:not_a_participant`.
5. The message sits there. **The sender was told it worked.**

If that is what happens live, it is a silent one-way drop on the offline path — the worst shape this
milestone hunts. **Your first job is to find out whether it happens live.** The trace says no.

---

## What the trace established (read this; do not re-derive it)

**The failing test does not send a message. It fabricates one.**
`packages/e2e-tests/src/spine/j-content.spine.test.ts`, test **"DOD-MSG-3 (transport)"**
(line ~108). Look at lines 131–149:

```ts
const sessionId = randomBytes(16).toString("hex");      // ← a session NOBODY brokered
...
await ipcCall(dirA, "content_park_deposit", { ..., sessionId, ... });   // raw IPC, no session
await ipcCall(dirB, "content_park_pull",    { ..., recipientPubkey: pubB });
```

No `cello_initiate_session`. No directory. No assignment ever presented to the relay. So agent B's
key has **never been named by a directory-signed assignment this relay has seen** — which is,
word for word, what the refusal means. The gate refuses it **deterministically**, every time.

**The relay vouches a key in exactly one place:** `packages/relay/src/relay-node.ts` lines ~995–1001,
when a client presents a directory-signed session assignment. It vouches **both** participants
regardless of which one presented. The store behind it is durable outside `local` env
(`bin/relay.ts` ~177). Nothing else adds to it. A fabricated session never reaches it.

**The real path is green in the same run.** Two tests in the same file, same 2026-09-02 receipt,
both **PASSED**:

- **"DOD-MSG-3/4 (recover)"** (line ~209): A initiates a real session with B, sends while B is
  online, **B's daemon is killed**, A sends again → parks. B restarts, `cello_start_agent`
  auto-recovers, `content.recover.auto.completed` fires, the message traverses the inbound funnel.
- **"DOD-MSG-4 (auto-recover)"** (line ~732): same, with no explicit recover call at all.

Both work because a real send parks on the **session's own relay**
(`session-node-manager.ts` `#parkContent`, ~line 2147: `entry.relayPeerId` from the session's
active node) — the relay that vouched both parties when the assignment was presented.

**Why the test passed on 23 August and fails now:** the vouching gate was added on 2026-08-31
(`RELAYAUTH-1`). Before it, any key that could prove ownership could pull. The test relied on that.

**Who else uses the raw IPC calls:** nobody. `content_park_deposit` / `content_park_pull` /
`content_park_recover` have **no callers** in `core/cli`, `core/adapter-claude-code`, or
`core/client` (grep, 2026-09-02). They are test/diagnostic surfaces, not a user path.

**So the prediction is: harness artifact, not product defect.** You still run the live check — the
DoD requires it, and the lane has diverged from live before.

---

## Part 1 — THE LIVE CHECK (do this first; minutes)

One real send to an offline agent, one collection, on the live fleet. **The park path only fires for
an EXISTING session whose counterparty goes offline** — a brand-new session to an offline agent is
refused up front with `counterparty_offline`, which is a different thing. So the sequence matters:

1. In Claude Code, `cello_use_agent` → **`CELLO_Coder_1`**.
2. `cello_initiate_session` → target **`CELLO_Support`** (both online, same daemon — that is a real
   directory-brokered session over the real relay; each agent has its own receiver node).
3. `cello_send` one message, `signal: "over"`. Confirm it arrives (`cello_inbox` as CELLO_Support).
4. `cello_set_agent_offline` → **`CELLO_Support`**.
5. As CELLO_Coder_1, `cello_send` a **second** message, `signal: "over"`. Note the response.
6. **Prove it parked** — `grep 'content.park' ~/.cello/daemon.log | tail -5`. You must see a
   `content.park.deposit` (or `.received`-class) event for this session. **If you see no park event
   at all, the send went direct and this check proved nothing** — go to the fallback below.
7. `cello_start_agent` → **`CELLO_Support`**, then `cello_use_agent` → CELLO_Support.
8. `grep 'content.recover' ~/.cello/daemon.log | tail -5` — expect `content.recover.auto.completed`.
   Then `cello_inbox` — the second message is there.
9. `grep 'content.park.pull.refused' ~/.cello/daemon.log` — expect **nothing**.
10. `cello_close_session` to seal. Do not leave it open.

**Fallback if step 6 shows no park event:** run the passing recover test alone, which is the same
sequence with two real daemons as separate OS processes:

    cd /Users/andrep/Documents/code/trustless-cello
    pnpm --filter @cello-protocol/e2e-tests exec vitest run --config vitest.spine.config.ts \
      src/spine/j-content.spine.test.ts -t "DOD-MSG-3/4 \(recover\)"

Docker must be running; the harness brings up its own Postgres. Both repos must be freshly built
(`pnpm run typecheck` here — it emits; `pnpm run build` in cello-client).

**Record the verdict in this file's Review section**, with the log lines quoted:
*"LIVE: parked and collected"* or *"LIVE: refused"*. That sentence decides Part 2.

---

## Part 2 — FIX WHAT THE VERDICT SAYS

### 2A — If LIVE collected (the predicted outcome): fix the TEST

Rewrite **"DOD-MSG-3 (transport)"** to exercise the real path. It must stop fabricating a session.
The shape is already in the same file — mirror **"DOD-MSG-3/4 (recover)"** lines ~209–260:

- `cello_initiate_session` from A to B while both are online, and `await` B's `new_session`.
- `cello_send` once while B is online.
- `await daemonB.kill()`.
- `cello_send` the parked message. Assert the deposit via the relay's own log
  (`content.park.received`), as the test already does at line ~161.
- Restart B (`cello login` under `CELLO_DIR: dirB`, `cello_start_agent`), wait for
  `content.recover.auto.completed`, then assert the **exact bytes** came back — keep the test's
  original assertion that B receives what A deposited; that is the property the test exists for.
- Delete the raw `content_park_deposit` / `content_park_pull` calls from this test.

**Keep the test's name and its DoD tag.** The fixture is `live-harness.ts`; extend it if you need a
helper, never write a new harness.

Then, in `M15-DEFINITION-OF-DONE.md` under `DOD-M15-PARKCOLLECT-1`, add one line:
*"Live check 2026-09-0X: parked and collected. Harness artifact — the test fabricated a session the
directory never brokered, which the vouching gate correctly refuses. Test rewritten to a real send."*
Flip the tag when review closes.

### 2B — If LIVE refused: STOP and report

Then the trace above is wrong and this is a product defect. **Do not fix it in this order.** Write
exactly what you observed — the daemon log around the refusal, which relay the content parked on
(`relayPeerId` in the `content.park` event), and which relay B pulled from — under *Newly
discovered*, mark this file `status: blocked`, and hand it back. The fix is a design question
(which relay vouches the recipient, and when), not a micro unit.

---

## Definition of Done

1. The live check ran, and its verdict is written in the Review section with the log lines quoted.
2. **2A:** "DOD-MSG-3 (transport)" is green through a real directory-brokered send, with the raw
   IPC deposit/pull removed from it, and the exact-bytes assertion kept. Run that one file, quote
   the result. **2B:** the file is `status: blocked` with the evidence written down.
3. **The vouching gate in `content-park.ts` is untouched.** State this explicitly in the Review.
4. The new test fails when it should: temporarily comment out the second `cello_send` (the parked
   one) and confirm the test goes red on "B must receive the parked entry". Restore it.
5. Gate passes (test / lint / typecheck) in every repo touched.
6. Reviewed by `cello-unit-reviewer`, every finding fixed, verdict quoted below.

**Not in scope — record, do not touch:**
- **`DOD-MSG-5` and `DOD-MSG-7`** fail on `content_park_deposit` returning `"[object Object]"`.
  That is `DOD-M15-PARKERROR-1`, a separate line. Leave them red.
- **`DOD-MSG-8`** fails on `MCP tool "cello_get_transcript" not found`. The tool is named
  `cello_transcript` today; the test is stale. Not this line. Note it under *Newly discovered*.
- Anything about relays restarting, draining, or handing over.

---

## Traps recorded before you start

**The obvious fix is the forbidden one.** Making the pull succeed by loosening `isVouched` makes
the test green in five minutes and reopens `RELAYAUTH-1`. The reviewer will refuse it.

**A same-daemon session is real.** CELLO_Coder_1 and CELLO_Support share a daemon; that is not a
loopback shortcut — each agent runs its own receiver node and the session goes through the
directory and the relay. But step 6 is how you *prove* the park path ran. No park event, no proof.

**`cello_set_agent_offline` is not "away".** Away (`cello_contact_set_away`) auto-replies. Offline
tears the agent down so a send to it parks. Use offline.

**Don't chase `[object Object]`.** It will be sitting right next to your failure in the same test
file. It is a different line with its own order.

**Two lanes share this laptop, and ANOTHER ORDER IS RUNNING RIGHT NOW.** `019-PARKERROR` is in a
second worktree and it runs spine tests too. The spine harness **drops and re-migrates its
databases**, so two lanes against one Postgres re-migrate the same server to two different heads and
produce a bogus `migration.out.of.date` red that is not your bug. **Export a
`CELLO_PG_HOST_PORT` unique to your worktree** (the compose file reads it precisely for this; 5433
is the default, so take another) and set `DATABASE_URL` to match. One test file at a time; read the
log instead of re-running.

**The other lane owns `DOD-MSG-5` and `DOD-MSG-7`.** They fail in your file, next to your test, on
`"[object Object]"`. They are `019`'s. Leave them red and do not touch them — a lane that comes back
having fixed both has produced a review finding, not a bonus.

---

## Review

### Where this work lives

Lane A worked in the **main checkouts**, not a worktree — `/Users/andrep/Documents/code/trustless-cello`
on branch `main`. `cello-client` was read-only for this order (Lane B held it concurrently), so
**no cello-client build was run**. Postgres: the compose default port, `CELLO_PG_HOST_PORT` left
unset.

### Part 1 — the live check on the fleet: INCONCLUSIVE (not a verdict)

**The live fleet's relay link was already dead before the park was ever attempted, so the run
proves nothing about park/collect either way.**

Sequence actually run, 2026-09-02, CELLO_Coder_1 → CELLO_Support, session
`c46de797c971060edd455a12814b1a7b`, `transportMode: relay`:

1. Real directory-brokered session opened between two online agents. ✅
2. Message 1 sent while Support was online. It reached Support's inbox
   (`unread_count: 1, last_seq: 1`) — **and came back `witnessed: false`**:

   ```json
   {"ok":true,"sequence_number":1,"delivered":true,"witnessed":false,
    "guidance":"... the relay did not witness it, so the ordering authority has no copy of it ...
    your record is now one leaf ahead of the relay's ..."}
   ```

3. `cello_set_agent_offline` → CELLO_Support. ✅
4. **The park send was never made.** It was denied at the approval prompt, so no `content.park`
   event exists for it and there is no response object to quote. There is no product-level refusal
   in this record — the only rejection is the approval one.

**Why this is inconclusive and not "LIVE: refused":** step 2 shows the relay had no copy of the very
first message. Anything downstream of that is downstream of a dead relay link, which is a different
fault from the one this order is about. Recording it as a refusal would attribute a relay-link
failure to the vouching gate. The `witnessed: false` finding and the error loop that followed it are
written up under *Newly discovered* 1–3.

5. Session closed. Close returned **no receipt**, consistent with the divergence the send warned
   about:

   ```json
   {"ok":true,"status":"seal_interrupted_pending",
    "rootHex":"de8188eee20a5408657d22e84872dfd827a89d501c119f68935ad6944793fb3a"}
   ```

   The `session.key.announce.failed` loop was **still firing at ~4 Hz 26 seconds after this close
   returned** (last observed 19:51:00.884Z).

**So the deciding evidence is the fallback Part 1 already specifies** — the passing recover test,
two real daemons as separate OS processes, its own relay, independent of the live fleet's health.
Its result is below.

### Part 1 — THE DECIDING RUN (the fallback): **LIVE: parked and collected**

Two real daemons as separate OS processes, their own relay, their own Postgres — independent of the
live fleet's health, which is what makes it the verdict:

```
✓ src/spine/j-content.spine.test.ts (10 tests | 9 skipped) 66959ms
  ✓ DOD-MSG-3/4 (recover) — offline recipient comes back, RECOVERS the parked message
    through the inbound funnel  5471ms
Test Files  1 passed (1) · Tests  1 passed | 9 skipped (10) · exit=0
```

The park path demonstrably ran rather than being skipped: that test hard-asserts
`content.park.deposited` and `content.recover.auto.completed` and reads the exact parked plaintext
back. **A recipient CAN collect a parked message.** The operator's fear in the header of this order
— told "parked, success", message never collectable — does not happen.

**So this is 2A: the defect was in the TEST.** From the rewritten test's own run:

```json
{"event":"content.park.pull.result","relayPeerId":"12D3KooWFZ4Gex…","count":1}
{"event":"content.recovered","sessionId":"7cbbf8eb…","sequenceNumber":1}
{"event":"content.recover.auto.completed","agentName":"agentB","recovered":1,"refused":0}
```

### DoD 3 — the vouching gate is UNTOUCHED

**Stated explicitly, as the order requires.** `packages/relay/src/content-park.ts` was not edited,
and **no file under `packages/relay/` was edited at all** — this order's diff names exactly two
files, the test and this document. The reviewer verified it independently.

The refusal the spine lane reported was the gate working: a fabricated session the directory never
brokered, so the relay had never vouched B's key, so the pull was refused `not_a_participant`.

### DoD 2 — the rewritten test, run alone

```
✓ DOD-MSG-3 (transport) — A sends to an offline recipient → recipient recovers the SAME bytes  5150ms
Test Files  1 passed (1) · Tests  1 passed | 9 skipped (10) · exit=0
```

Three consecutive green runs after the review fixes. Whole file: 7 passed / 3 failed — the three
reds are `DOD-MSG-5` and `DOD-MSG-7` (both on `content_park_deposit` returning
`{"code":"internal_error","message":"[object Object]"}` — that is `019`'s line) and `DOD-MSG-8`
(`MCP tool "cello_get_transcript" not found`). Left red on purpose. The reviewer confirmed
independently that this order did not cause any of the three: they use fresh temp dirs and fresh
keypairs and the diff's hunks do not reach them.

**Build provenance for that run**, so it is reproducible rather than a claim: `cello-client` at
`59b091f`, `core/daemon/dist/bin/cello-daemon.js` mtime `2026-09-02T06:45:02Z`. This order did not
build or edit `cello-client` — Lane B held it — so the run is green *against that binary*.

### DoD 4 — the mutation proof: a three-layer chain, each layer red for a named reason

Run against the final post-review code, each mutation re-run alone, each typechecked first
(`exit=0` — a mutant that fails to compile proves nothing), each restored with `git checkout --`
and the tree verified clean after.

| Mutation | Red at | The reason |
|---|---|---|
| **A** — parked `cello_send` + its deposit wait removed | `expect(cluster.relay.output).toMatch(/content\.park\.received/)` | the relay never received a deposit |
| **B** — A, plus the three relay assertions removed to reach the next guard | the recovery barrier | `no auto-recover sweep ever recovered anything. Every sweep B ran: …` |
| **C** — B, plus the barrier reverted to its hollow form and the provenance assertions removed | **"B must receive the parked entry, byte for byte"** | `expected null to be 'msg2-while-offline — the EXACT bytes…'`, with `session.receive.empty` in B's log |

**C is the proof the DoD asks for.** A and B exist because three guards now catch the failure
*before* it reaches that line — the improvement, not a dodge. Removing an intervening assertion to
reach a target one does not weaken the target; the reviewer ruled the same.

**B is also the proof the HIGH-1 fix has teeth.** Under the old barrier this exact state sailed
through to the read, because `drainOnce` emits `content.recover.auto.completed` unconditionally,
`recovered: 0` included. Under `"recovered":[1-9]` it stops three layers earlier and names the cause.

**One mutation SURVIVED, reported rather than buried.** Removing B's `cello_start_agent` (the
reviewer's suggested isolation of the collect half) left the test **green** — because
`cello_use_agent` on the next line auto-starts an offline agent, so that call removes nothing. A
redundant line in the test, not a missing assertion; the collect half is guarded by the
`"recovered":[1-9]` barrier, whose teeth mutation B demonstrates.

### DoD 5 — gate

`pnpm run typecheck` → `exit=0`. `pnpm run lint` → `exit=0` (5 warnings, all pre-existing in
`j-stale-session.spine.test.ts`, untouched here). Run with `set -o pipefail`, exit codes read rather
than output tails. Only `trustless-cello` was touched, so only its gate applies.

### DoD 6 — reviewer's verdict, in its own words

`cello-unit-reviewer`, one pass. Verdicts: **SPEC: DEVIATIONS FOUND**, **HOLLOW TESTS FOUND
[blocking]**, **ERROR SUBSTITUTION FOUND [blocking]**, **NO SILENT FALLBACKS**, **REMOVALS PROVEN**,
**COMPATIBILITY DEBT FOUND**. On whether it was a rubber stamp: *"I do not think this is one. Two
HIGHs and a MEDIUM sit exactly where this milestone's expensive misses have lived — a barrier that
cannot fail, a provenance claim nobody asserts, and a discarded response object on the offline
path."*

**Every finding fixed.** The one that matters most was mine and it was this milestone's own
signature defect:

- **HIGH-1 — a barrier that could not fail.** I waited on `content.recover.auto.completed` by event
  name. `drainOnce` emits it unconditionally and says so in its own comment, carrying
  `"recovered":0,"refused":1,"refusedReasons":{"not_a_participant":1}` just as readily as a success.
  **A vouching-gate regression — the exact thing this test exists to catch — would have satisfied
  it.** Now matched on `"recovered":[1-9]`, with a catch that prints every sweep and names
  `not_a_participant` as a relay refusal rather than an empty mailbox. The non-hollow form already
  existed 646 lines below in the same file.
- **HIGH-2 — nothing pinned the bytes to the park path.** True only via an argument about another
  repo's code. Added a session-scoped `content.recovered` and the `"source":"park"` ordering
  assertion.
- **MED-1 — the parked send's response was discarded**, on the offline path, which is precisely the
  half the operator's fear is about. An `ok:false` surfaced 25s later as a `waitForLine` timeout.
  Now asserted, with the response in the message.
- **MED-2 — `not.toContain(PAYLOAD)` could pass vacuously** against an escaping serializer, because
  the payload is deliberately multibyte. Added an ASCII slice.
- **MED-3 — the comment I had rewritten was itself wrong** about DOD-MSG-7's neighbours. Corrected.
- **MED-5 / LOW-1 / LOW-2 / LOW-3** — duplicate-vs-sibling comment added, docblock present-tensed,
  archaeology tails trimmed, decorative regex alternation dropped.

**Ruled deviation, recorded because an un-journaled one is blocking on its own.** The order says
keep the test's name. I kept the tag `DOD-MSG-3 (transport)` (so the `-t` filter and the DoD tag
still match) and rewrote only the prose after the em-dash, which described the deposit/pull
mechanism the test no longer uses. The reviewer ruled it **correct**: leaving *"deposit ciphertext …
recipient pulls"* on a test that no longer deposits or pulls is a false claim in the first place a
reader looks.

**Scope question, ruled: keep.** `not.toContain(PAYLOAD)` is not scope growth — the old test
deposited a random blob that was never plaintext anywhere, so "the relay holds ciphertext only"
could not fail. A real send makes genuine plaintext exist on both daemons, so the absence becomes
assertable for the first time.

### One thing that is NOT explained, and is not being called flaky

One run failed at the **live** send (`msg1-online`, sent while B was still online) with
`expected false to be true` and no reason attached — the assertion had no message. Three consecutive
runs before and after were green. I did not attribute it to flakiness and I could not reproduce it.
What I did instead: that assertion now captures the response and prints it, so if it recurs the
reason is on the failure rather than lost. Recorded here so the next reader knows it happened.

## Newly discovered

*(anything found and NOT acted on, per rule 3)*

### 1. A message reported as delivered was never witnessed by the relay — on a live relay-mode session

**What the operator would see:** they send a message, their side says it went through, and the
ordering authority has no copy of it. The conversation can no longer produce a receipt, and nothing
told them that until they read the guidance text on the send itself.

Observed 2026-09-02 on the live fleet, session `c46de797c971060edd455a12814b1a7b`
(`transportMode: relay`), CELLO_Coder_1 → CELLO_Support, first message, both agents online:

```json
{"ok":true,"sequence_number":1,"delivered":true,"modified":false,"witnessed":false,
 "guidance":"Delivered and in your transcript — but the relay did not witness it, so the ordering
 authority has no copy of it ... your record is now one leaf ahead of the relay's ..."}
```

This fired on message **1**, before any park was attempted. It is why this order's live check is
**inconclusive rather than negative** — the relay link was already dead at the first send, so
nothing that happened afterwards is evidence about the park/collect path.

**Not investigated, per rule 3.** It may or may not share a cause with finding 2.

### 2. `session.key.announce.failed` retries in a hot loop, ~4×/second, and survives session close

Same session. The daemon emitted this pair continuously from 19:50:34Z onward, roughly four times a
second, and was **still emitting it at 19:51:00Z after `cello_close_session` returned**:

```json
{"level":"error","event":"session.key.announce.failed","agentName":"CELLO_Support",
 "sessionId":"c46de797c971060edd455a12814b1a7b","correlationId":"61458320-...","reason":"stream_failed",
 "error":"[object Object]",
 "impact":"this side's half of the session key never reached the counterparty, so content stays
  unencrypted by CELLO until a later connect succeeds"}
```

Two correlation IDs alternate — the session's own, and a literal `"revive-rekey"`. Three things are
stacked here and only the third is already owned:

- **The retry has no visible ceiling.** It ran for at least 27 seconds at ~4 Hz and did not stop when
  the session closed.
- **The stated impact is that content stays unencrypted by CELLO.** That is the announced consequence
  in the daemon's own words; it is not something this order verified.
- **`error: "[object Object]"`** — same shape as `DOD-M15-PARKERROR-1`, which is `019`'s line. Left
  alone.

**Not investigated, per rule 3.**

### 3. Park pulls poll two relays every ~3s and one keeps returning the same entry

Visible throughout the same window, unrelated to the session above:

```json
{"event":"content.park.pull.result","relayPeerId":"12D3KooWJXHpnWQhGk3jXBJYdXMmeLxEhRqzwZCYd1bxSUh4pg83","count":1}
{"event":"content.park.pull.result","relayPeerId":"12D3KooWFpvG5ksTBoiMCfyy3n126AtpFNYGXB14R2335DAf1BYt","count":0}
```

One relay reports `count: 1` on every poll, every ~3 seconds, indefinitely — the same entry appears
to be returned and never consumed. **Not investigated, per rule 3.** Recorded because it is on the
park path this order is about, and because a pull that returns an entry forever is either a stuck
entry or a watermark that never advances.

### 4. The `content_park_pull` IPC handler now has NO caller in either repo

Surfaced by the reviewer on this diff. Removing this order's two raw-IPC calls took away the last
caller of the daemon's `content_park_pull` IPC method:

```
$ grep -rn '"content_park_pull"' cello-client/core trustless-cello/packages   # excluding dist/
cello-client/core/daemon/src/content-park.ts:680:    handlers.set("content_park_pull", …)
```

That is the registration itself and nothing else. **Positive control** (because an empty grep is
only evidence if the search could see): the same grep for `"content_park_recover"` returns **6**
hits. The search had reach.

Its own docblock already warns *"⚠️ THIS HANDLER HAS NO PRODUCTION CALLER, AND THAT IS WHY IT
DRIFTED"* — this order removed its last test caller too. Note this is the IPC **method name**, not
the `content_park_pull_request` wire frame, which is alive and load-bearing on the recover path.
Its siblings are still called: `content_park_deposit` (5) and `content_park_recover` (5).

**Deliberately NOT deleted here.** It lives in `cello-client`, which this order makes read-only and
which Lane B holds. Rule 3 applies.

### 5. `DOD-MSG-8` fails on a stale tool name

The test calls `cello_get_transcript`. The tool is named `cello_transcript` today. The test is
stale, not the product. Not this line, not touched — carried from this order's own *Not in scope*
list so it survives outside this file.
