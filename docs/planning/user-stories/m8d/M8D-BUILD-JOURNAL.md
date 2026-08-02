---
name: M8D Build Journal
type: build-journal
date: 2026-08-01
milestone: M8D
status: active
topics: [m8d, co-attendance, multi-session, agent-identity, message-delivery, build-journal]
description: >
  Evidence, forensics, and decisions-in-flight for M8D (co-attendance — several sessions on one agent
  identity). The DoD is the scoreboard; this is where proofs, run output, and anything a run got wrong
  actually live. One entry per unit.
---

# M8D — Build Journal

> Convention (carried from M10B): a DoD tag flip carries ONE line of evidence plus `→ Entry N`.
> The full proof lives here.

## RESUME STATE (overwritten in place — the ONLY thing in this file that is)

**Updated:** 2026-08-01, autonomous run (Entry 16).

- **Everything MERGED to `main` and pushed**, both repos. Gate verified **by exit code**: 2437
  passed / 11 skipped, lint + typecheck + build clean.
- **PUBLISHED to beta, binary-verified:** **daemon `0.0.114`**, **cli `0.0.117`**, connect `0.0.115`.
  `latest` **NOT promoted — operator-only.** Commands below.

### ✅ The Tier-1 fence has LIFTED

- `DOD-FIRSTMSG-WITNESS-1` **ACs 7 + 8 asserted LIVE** (j-loopback, real Postgres/directory/relay).
- `DOD-FRONTIER-STRAND-1` **ACs 1, 2, 3 done and reviewed**; AC4(c) superseded (M8D-D2).

### M8D itself

| Line | State |
|---|---|
| `DOD-COATTEND-VISIBLE-1` | 🟡 — ACs 1–5, 7 green. **AC 6 = the live two-session `claude --channels` journey. Needs Andre.** |
| `DOD-RECEPTIONIST-AGENT-1` | ✅ |
| `DOD-INBOX-AGENT-1` *(debt)* | ✅ |
| **`DOD-COATTEND-1`** | 🟡 **GREEN on the fixture** (ACs 1–6, revert-verified). AC 7 = live journey. **Review not yet run.** |
| `DOD-COATTEND-CATCHUP-1` / `-SENDWINDOW-1` | ❌ land together, after COATTEND-1 |

### The next unit, concretely

`DOD-COATTEND-1` — delivery reads a **durable record against a per-connection bookmark** instead of
draining the shared `#receivedContent` (`buf.shift()`, keyed by `(agentName, sessionId)` — NOT by
connection, which is the defect). The machinery already exists and should be reused rather than
rebuilt: `readTranscript` is the durable record, the per-connection cursor and `safeCursorAdvance`
already exist, and the `since_seq` branch already reads the transcript non-destructively. The
doorbell **stays multicast** — it is correct; the queue is what changes.

### 🚨 Three rules this run learned the hard way — read before writing code

1. **Verify the gate by EXIT CODE, never by reading the tail.** I committed on a red gate once
   tonight after reading past `ELIFECYCLE`.
2. **Drive the REAL entry point, then revert the fix and watch the test go red.** Three separate
   units this milestone shipped with the fix fully deletable and the suite green. Testing the callee
   is not testing the fix.
3. **Never `as never` a deps object.** It defeats the type contract wholesale — tsc stayed clean
   while three tests threw.

### Owed to Andre

1. **The `latest` promotion** (below). 2. **AC 6's live two-session journey.**

```
npm dist-tag add @cello-protocol/daemon@0.0.114 latest
npm dist-tag add @cello-protocol/cli@0.0.117 latest
npm dist-tag add @cello-protocol/connect@0.0.115 latest
npm i -g --prefer-online @cello-protocol/cli@latest @cello-protocol/connect@latest
cello logout && cello login      # then /mcp
```

### Spine suite — runnable, NOT green

`j-conn` 2/2, `j-presence` 1/1, `j-loopback` 1/1. **Docker must be running.** Known remaining:
`j-persist` and other session-establishing files need the 3-node consortium + manifest setup already
applied to `j-content` (`discovery_node_unresolvable`); `j-sign` fails undiagnosed; nine of twenty
files have never been run.

---

## Entry 0 — Milestone opened (2026-08-01)

**Why M8D exists as its own milestone.** The design was decided on 2026-07-31 and written up in
[[2026-07-31_1043_two-sessions-one-agent-co-attendance]], but that document proposes **no milestone**
— it settles a decision, fixes a build order, and lists eight operator-facing changes. Its only
tracking hook is a sequencing note recorded against `DOD-FRONTIER-STRAND-1`. Two of the three strands
it uncovered already have M8C lines (`DOD-FIRSTMSG-WITNESS-1`, shipped in daemon `0.0.106` with ACs
7–8 owed; `DOD-FRONTIER-STRAND-1`, open). Co-attendance itself had **nothing** — it was named as a
destination in two places (M8C DoD's out-of-scope list, [[launch-triage]] §6) and nowhere else. This
milestone is that destination.

**Why not append it to M8C.** M8C is command surface, notifications and reactive messaging. Its
delivery model assumes one reader. M8D changes delivery semantics across several surfaces — the
queue, the cursor, the send gate, catch-up — and its enforcer is different in kind: **two attached
connections on one agent**, which no M8C line ever needed. A milestone whose every assertion is about
what the *second* session sees does not belong appended to one whose fixture only ever built the
first.

**The split that shapes the milestone** ([[launch-triage]] §6). Only the **detection** half belongs at
launch: making "nothing arrived" and "another session took it" different answers, carrying the
attendance count, and logging the receive on both outcomes. That converts a silent, trust-destroying
failure into a visible one with an obvious workaround — the difference between ruin and forgive. It
is `DOD-COATTEND-VISIBLE-1`, Tier 0, and it does not wait behind the receipt work. The redesign is
Tier 1 and opens behind `DOD-FIRSTMSG-WITNESS-1` and `DOD-FRONTIER-STRAND-1`, per the spec's build
order.

**What is already settled and must not be re-litigated in any unit:**

1. **Co-attendance, not exclusivity** (spec §3). Four reasons, in order of weight: exclusivity only
   sounds simple (connections die constantly, so the hard part is relocated to a takeover protocol,
   not skipped); it buys no cryptographic property (the seal attests the identity, not the seat); it
   fixes the wrong half (the CLI path has no live connection to key it on); and it forecloses listener
   mode, which co-attendance gets free. If exclusivity is ever wanted it is a **flag on top**.
2. **The relay is a true sequencer** (spec §5). It assigns `seq` from its own counter, ignores the
   sender's claimed position, and rejects a `last_seen_seq` ahead of it; all of an agent's sessions
   share one strictly-serialized stream. **Co-attendance cannot fork the chain.** The residual risk is
   semantic — a message perfectly signed and conversationally stale — which is the right kind of
   failure to have. Re-verified against post-M12 code on 2026-07-31.
3. **The certificate is outside this milestone** (spec §7c/§7d). It is rebuilt from the
   relay-witnessed leaf sequence and cross-checked against the relay's running root; neither party's
   local tree is an input. Adding a party-vs-party comparison would be a protocol change, not a fix.
4. **The receptionist gets a two-line fix and no vote on the architecture** (spec §6). It is a
   last-resort workaround for harnesses with no event injection; Andre wants as few users as possible
   depending on it.

**Verification state carried in.** All four of the spec's §9 open items were closed by third-party
validation on 2026-07-31, and the code anchors were re-verified against post-M12 code. Two of those
closures change what M8D must build rather than merely confirming it:

- **`cello_get_transcript` is already a both-directions catch-up door** — it advances the connection
  cursor *and* the persisted watermark, and its comment names the sibling-send case as its purpose.
  So `DOD-COATTEND-CATCHUP-1` is a *choose-and-point-at-one-door* problem, not a build-from-nothing
  one, and the original "second session is stuck forever" framing is overstated. Implement against the
  corrected framing in the DoD, not against §3b's first paragraph.
- **`--agent` with `--scope current` works as §6's receptionist fix assumes**, without writing the
  shared file. `DOD-RECEPTIONIST-AGENT-1` is therefore a doc/subagent edit, not a CLI change.

**The sizing rule this milestone opens with (Andre, 2026-08-01).** Handed a DoD line inside an existing
milestone, a session executes it. Handed a *milestone*, the same session burns large token budget on
investigation, re-derivation, refinement and repeated review of specs and plans before writing any
code — **and the output is no better.** The ceremony is triggered by the word "milestone," not by the
work. M8D is **four lines in one repo** with the design already decided and validated: no crypto, no
schema, no protocol change, no second repo, no cloud. It is tiny next to M10B or M12, and the only
reason it is a milestone at all is that its enforcer (two attached connections) is different in kind
from anything M8C built. [[M8D-PROCEDURE]] carries this as its 🪶 rule: no determination unit, no
review pass on a planning document, design notes capped at half a page with no reviewer dispatch,
targeted reads against the spec's §10 anchors rather than a subsystem survey, and the first red test
inside the first working turn or two. The check, whenever a run feels like it is preparing rather than
building: *would I be doing this if this line had been handed to me inside M8C?*

**Owed on open.** Two documents make claims this milestone contradicts and both need correcting as
work lands, not after: [[launch-triage]]'s *"reply guard — already solid, confirmed working"* line
(it rests on `DOD-CURSOR-1`, whose own DoD text says the two-window scenario was never run — carried
as AC 7 of `DOD-COATTEND-VISIBLE-1`), and M8C's out-of-scope reference to co-attendance, now pointed
at this milestone.

---

## Entry 1 — DOD-COATTEND-VISIBLE-1: clause checklist + event set (written before any code, 2026-08-01)

**Target, one sentence.** Two sessions attend one agent, one message arrives: the session that gets
nothing is told *"a sibling session took it"* in a machine-readable field — not the quiet-counterparty
string — both sessions know they are not alone, and both outcomes leave a line in the daemon log.

**Worktrees.** `cello-client-m8d` (branch `m8d/co-attendance`, off `origin/main` @ `2349236`) and
`trustless-cello-m8d` (branch `m8d/co-attendance`, off `main` @ `ec96852d`).

**Scope-fence check (procedure §5d).** Every clause below fails observably with two connections on
one agent and cannot be observed with one. In scope.

### Clause checklist (the yardstick the reviewer gets)

| # | Clause (DoD verbatim, compressed) | How it is satisfied |
|---|---|---|
| 1 | "Nothing arrived" ≠ "a sibling took it" — distinct `guidance` **and a machine-readable discriminator**, not a rewording | the timeout return gains `reason: "taken_by_sibling_session"` + `taken_by_sibling: {count, last_sequence, connections}`. The quiet-counterparty return keeps `reason` absent. `reason` is already the discriminator field on this return's sibling branch (`counterparty_gone`), so this is the existing shape, not a new one. |
| 2 | attendance count on `cello_use_agent`, `cello_status`, and the arrival alert; `isAttended()` untouched | new `countAttendance(perConnectionState, agentName)` in `co-attendance.ts`. `isAttended` is NOT modified and keeps its first-match early return — the away-response decision it drives is byte-identical. |
| 3 | the blocking receive logs on **both** outcomes | see event set below |
| 4 | a second session attaching to an attended agent is told so **at attach time**, and attach is **not refused** | `cello_use_agent` returns `attendance` always + `co_attendance` guidance when >1. No refusal path added; `agent_already_current` is unchanged. |
| 5 | test: two connections, one message, loser distinguishable + both outcomes in the log | `m8d-coattend-visible-1.test.ts` on the two-connection fixture |
| 6 | live two-session `claude --channels` journey | enforcer #2 — needs Andre to drive the second window (procedure's stop-reason 1). Line stays 🟡 until run. |
| 7 | doc correction: `launch-triage` §"reply guard — confirmed working" | same commit as the code |

### The event set (AC 3 — named before code)

| event | level | when | context fields |
|---|---|---|---|
| `session.receive.delivered` | info | buffered content handed to a caller | `sessionId`, `agentName`, `connectionId`, `sequenceNumber`, `attendance`, `correlationId` |
| `session.receive.empty` | info | timeout with nothing, no sibling take observed | `sessionId`, `agentName`, `connectionId`, `timeoutMs`, `attendance`, `liveness` |
| `session.receive.taken_by_sibling` | **warn** | timeout, and another connection consumed content on this session inside this caller's wait window | `sessionId`, `agentName`, `connectionId`, `timeoutMs`, `attendance`, `takenCount`, `lastTakenSeq`, `takenBy` (connection ids) |
| `agent.attend.coattended` | info | `cello_use_agent` succeeds and attendance > 1 | `connectionId`, `agentName`, `attendance` |

`correlationId` threads the receive call; the theft warn carries the *taking* connection ids so the
log alone reconstructs the race. **No content and no content-derived text on any of them** — sequence
numbers and connection ids are routing metadata (`DOD-INV-CONTENTFREE` holds).

### Where the code goes, and why not elsewhere

The ledger records **which connection** consumed a message. Connection identity is an IPC-layer
concept; `SessionNodeManager` is deliberately connection-agnostic — `#receivedContent` being keyed
`(agentName, sessionId)` **and not by connection** is the Tier-1 defect itself. Teaching it about
connections here would start the redesign inside the launch-gate slice. So the ledger lives beside the
per-connection cursor, in the daemon/IPC layer: new module `core/daemon/src/co-attendance.ts`, wired
through `SessionContentDeps` exactly as `getConnectionCursor`/`advanceConnectionCursor` already are.

**Tier 0 changes nothing about delivery.** `takeReceivedContent` stays `buf.shift()`; the doorbell
stays multicast; no attach is refused. The only new behavior is observation.

**Ledger bound.** In-memory, per `(agentName, sessionId)`: last 64 takes, and at most 512 tracked
sessions with least-recently-written eviction. An unbounded map on a daemon that runs for days is a
leak, and an eviction that is not stated is a silent cap.

### Falsification pass (procedure §2 step 3, run before writing code)

- **Does the call site have the method on the INTERFACE?** `SessionContentDeps.sessionNodeManager` is
  typed as the `SessionNodeManager` *class*, so a new method would have been reachable — the reason it
  does not go there is responsibility, not access. `perConnectionState` is already a declared field of
  `AgentHandlerDeps` (`agent-handlers.ts:38`), so the attendance count needs no new plumbing there.
  `NotificationDispatcher` already holds `#currentAgentMap`, so the arrival alert can count without a
  new dependency at all.
- **Does the fix location match where responsibility lives?** Yes — see above. The cursor precedent is
  the one being copied.
- **Would it create redundancy?** Attendance is computed in three places from **one** helper over the
  same `currentAgent` map the doorbell already routes on, so the count can never disagree with who
  actually gets woken. A second private counter would be able to.
- **What else breaks?** `isAttended` drives M8C-AWAY-1's auto-ack suppression. It is not touched, so
  the away path cannot move. The `since_seq` branch returns before the blocking loop and is not
  touched, so `session.receive.since_seq` keeps its meaning.

### Decision recorded

- **M8D-D1 — the two-connection fixture.** `packages/e2e-tests/src/session-fixture.ts`, named by
  CLAUDE.md and by this procedure, **does not exist in either repo** — grep finds it only in M5/M6/M7
  archaeology and in `cello-client/docs/dead-code-report.md`. The live equivalent, and the only
  existing two-connection-on-one-agent harness, is the in-file pattern in
  `core/daemon/src/__tests__/m8c-cursor-1.test.ts` (real `startDaemon`, real IPC socket, `connectAs()`
  twice on one agent). M8D **extracts that pattern** into
  `core/daemon/src/__tests__/helpers/two-connection-fixture.ts` and both repoints `m8c-cursor-1` at it
  and builds on it. This is extending the established fixture, not writing one from scratch — the rule
  the CLAUDE.md line exists to enforce.

## Entry 2 — DOD-COATTEND-VISIBLE-1 built, reviewed, and one real defect caught (2026-08-01)

**Commits.** `51ab230` (the unit) → `0f37607` (every review finding fixed). Branch
`m8d/co-attendance` in both worktrees. Gate at `0f37607`: **2386 passed / 11 skipped**, lint, typecheck
and build clean.

**Enforcer output — `m8d-coattend-visible-1.test.ts`, 9 clauses, real daemon + real IPC socket:**

```
✓ src/__tests__/m8d-coattend-visible-1.test.ts (9 tests) 1685ms
✓ src/__tests__/m8c-cursor-1.test.ts (13 tests) 226ms
  Tests  22 passed (22)
```

### The review found a defect that inverted the point of the line

`cello-unit-reviewer`, one pass on `51ab230`, verified by execution rather than by reading. The HIGH:

> **`ContentTakeLedger` was never pruned when a connection died.** A fresh connection presents cursor
> `-1`, so every take a now-dead connection had ever recorded sat above that bar and came back as
> `reason: "taken_by_sibling_session"`.

The `cello` CLI opens a fresh connection **per command** — `m8c-cursor-1`'s own C6/D1 clauses document
that as the normal path — so this fired on ordinary single-operator use, on every MCP reconnect, and
on every Claude Code restart. On the CLI it never cleared: the remedy named in its own guidance
advances the *connection* cursor, which dies with the next command's connection. The message
contradicted itself mid-sentence: *"Another session attending 'alice' … — 1 sessions are attending."*

**Worse than the silence it replaced.** An operator told a phantom sibling stole their mail learns to
disbelieve the signal, and the real theft then arrives wearing words they have been trained to ignore.
`session.receive.taken_by_sibling` would have been a signal that fires on the normal case.

**Fix:** `contentTakes.forget(connectionId)` in `onDisconnect`, beside the
`connectionCursors.delete(connectionId)` that was already there — the same lifetime for the same
reason. Once a connection is gone its takes are history, and history is not "another session took it".

**Why the tests missed it, stated plainly:** every clause C1–C7 considered two connections
*simultaneously alive*. None asked what a connection sees when its **predecessor** is gone — which is
the CLI's only mode. C8 is that clause. Verified by revert: remove `forget()` and **C8 alone** goes
red (`1 failed | 8 passed`).

### Everything else the review raised, and what was done

| Sev | Finding | Resolution |
|---|---|---|
| HIGH | discriminator fired with no sibling | `forget()` on disconnect; **C8** |
| MED | `counterparty_gone` displaced by the theft branch — `reason` is the field callers switch on, and "read then reply" points a reply at a dead connection | terminal condition wins `reason`; theft rides as a field + the first half of the guidance; **C9** |
| MED | `attendance` snapshotted before a 30 s poll, stale at every exit it was reported on | recomputed at each exit |
| MED | prose claimed the taker was *attending* — a connection can consume via `resolveCurrentAgent` **without** attending, so a real thief need not be counted | reworded to "another session on this daemon"; `attendance` stays its own field |
| LOW | the per-session cap under-counted silently | `truncated` on the answer |
| LOW | doorbell body rendered `NaN` on an older daemon; "the other one" is wrong at N>2 | explicit absent-guard + N-correct prose; **five new `channel-params` cases** |
| LOW | `co_attendance: true` had no consumer | deleted — `attendance > 1` already is that boolean |
| LOW | fixture re-derived `msgLeafHash` | imported from `@cello-protocol/crypto` |

The reviewer confirmed independently: the **exclusivity**, **content-free**, **await-window** and
**refactor** lenses are clean; the `m8c-cursor-1` repoint preserved **38/38 assertions and 13/13
clauses** (verified mechanically, not by eye); and the coder's red/green claim was exact (5 red / 2
declared-control-green at base `2349236`).

### Two corrections to Entry 1

The journal is append-only, so these are recorded here rather than edited above.

1. **Entry 1's event table defines `session.receive.taken_by_sibling` as a take *"inside this caller's
   wait window."*** The code has no wait window and never had one — it reports any take above the
   caller's cursor. The cursor is the right bar (a window would have to guess how long a theft counts
   for, and would miss the ordinary case where the sibling's take lands microseconds before this
   caller's handler starts), but the note was never updated to match, and **that gap is exactly what
   produced the HIGH**: with no window and no pruning, "above the cursor" reached back through all of
   daemon history. The correct definition is: *a take recorded by another LIVE connection, above this
   caller's read cursor.*
2. **AC 7 was already satisfied before this milestone opened.** Verified independently by the
   reviewer: `launch-triage.md:39-40` names the read-before-reply guard as one of two wrong claims;
   `:319` says the guarantee *"holds for a single session, but two sessions on one agent do not gate
   each other, and the scenario had never been run. Still open (item 6)"*; and §6 (`:179-196`) is this
   DoD line. The "already solid" list survives **only as a retraction**. **No residual false claim, so
   no edit was made** — the AC is closed by verification, not by a change.

### Status

`DOD-COATTEND-VISIBLE-1` → **🟡 BUILT/UNVERIFIED-LIVE.** ACs 1–5 and 7 are enforcer-green; **AC 6 is
owed** — a live two-session `claude --channels` journey on one agent, which needs Andre to drive the
second window (procedure stop-reason 1). Vitest green is not done, and the line does not go ✅ on it.

AC 6 also needs the shim published: the doorbell body lives in `@cello-protocol/connect`
(`channel-params.ts`), so the in-context half of AC 2 is only observable after a beta publish.

## Entry 3 — DOD-RECEPTIONIST-AGENT-1: a two-line fix, and three ways it could still go silent (2026-08-01)

**Commits.** `78a6ba7` (the fix) → `a02dee9` (review findings) → `bd37ede` (AC 4 executed, not
asserted). Gate at `bd37ede`: **2396 passed / 11 skipped**, lint, typecheck, build clean.

**The fix itself is two lines**, exactly as the DoD says: drop `cello use-agent` (the only writer of
the machine-wide `~/.cello/current-agent`) and poll `cello inbox --agent "$AGENT_NAME" --scope
current`. `--agent` replays the selection on the CLI's own fresh connection and touches no shared
state, so any number of receptionists now run side by side.

### The review did not treat "two-line fix" as "small review"

`cello-unit-reviewer`, one pass on `78a6ba7`. Its framing is the lesson: *the file is a shell script
running unattended on an operator's machine*, and three separate paths through it ended in a
**permanently silent answering service** — one that reports it is monitoring, announces nobody, and
prints nothing on any stream. Two were pre-existing; one I introduced.

| Sev | Path | Why it goes silent |
|---|---|---|
| HIGH | **I traded an exit-code check for a proxy.** The deleted guard branched on `$?`; my replacement branched on empty stdout. That holds for daemon refusals — but `bin/cello.ts` prints help/USAGE to **stdout** and exits 1 on an unknown flag or command. | `RESULT` non-empty → error branch skipped → `jq` fails on help text → swallowed → sleep 10 s → forever |
| HIGH | **`jq` failures swallowed twice** (`jq … 2>/dev/null` and `[ "$PENDING" -gt 0 ] 2>/dev/null`). `SKILL.md` names `jq` a hard requirement; nothing checked for it. | no `jq` → empty `PENDING` → "integer expression expected" → swallowed → false → forever |
| HIGH | **The poll could not see a sealed message.** `total_unread` comes from `getUnreadSummary`, which excludes terminal sessions; sealed ones live in a separate `sealed_unread`. | a caller who leaves a message and seals — `DOD-SEALED-INBOX-1`'s own case — counts zero on both tested fields |

All three fixed, plus a guarded `mktemp`, a blank-stderr fallback, and the lost `use-agent`
auto-start written into the comment so the refusal does not read as a regression.

**The third one splits the two shipped files** and is worth remembering: `SKILL.md` step 4 handles
`sealed_unread` explicitly, so the subagent that replaces the skill's polling could not see what the
skill could.

### The test-honesty finding, and why it was fixed rather than re-labelled

R2 was labelled *"the defect itself"* and *"the assertion that fails on the old script's mechanism."*
**It was neither.** It only ever ran the NEW shape, never the old one, and was green before the fix —
an implementation that never had the bug passed it identically.

Fixed by actually reproducing the defect. **R2a** stages the collision deterministically (no race): A
staffs alice, B staffs bob and overwrites the shared file, and A's very next `--scope current` poll
answers as **bob**. **R2b** shows `--agent` is immune to the same overwrite.

The file header now states, **measured rather than asserted**, which clauses go red on revert
(`R1d`–`R1h`) and which are mechanism pins that were always green (`R2a`–`R2c`, `R3`, `R4a`) — and
that no single clause spans defect → remedy → shipped script, so none of them may claim to.

### AC 4 was asserted, never executed — so now it runs

Every clause matched a regex or called a TypeScript function. **Nothing executed the thing that
ships**, and all three HIGH findings were execution semantics. `R5` now runs the real bash out of the
shipped markdown, through the real **built** `cello` binary on `PATH`, against a real daemon, with
both receptionists sharing **one** `CELLO_DIR`. `R5b` does the offline case end to end.

**Teeth, measured.** Staging the ORIGINAL mechanism back into the script:

```
× R5  — JSON parse failure: both loops answered for the SAME desk
× R5b — TIMED OUT at 60s
```

`R5b`'s timeout is the finding executed rather than argued: the old script silently auto-started the
offline desk, found nothing pending, and slept forever.

### Parked — not this line

**`SKILL.md` step 3 still polls `cello_inbox({ scope: "current" })` with no agent**, one MCP layer up,
while its own step 1 tells the operator to pass the agent explicitly "which another session or an MCP
reconnect can change underneath you". Two skills in one Claude Code session share one MCP socket, so
the second `cello_use_agent` re-points the first. **The subagent is now the stricter of the two
shipped files.** Closing it needs an `agent` parameter on the `cello_inbox` MCP tool — a shim change,
not a two-line edit — so it is out of scope for this line and recorded here rather than lost.

### Status

`DOD-RECEPTIONIST-AGENT-1` → **✅ PROVEN.** All four ACs enforcer-green, including AC 4 at execution
level, with revert-measured teeth. This line has **no in-context hop** — its behavior ends in a bash
loop on the operator's machine, not inside Claude's context — so unlike `DOD-COATTEND-VISIBLE-1` it
needs no live `claude --channels` journey to close.

## Entry 4 — Tier 0 published to beta; a debt line raised and fixed; the fence measured (2026-08-01)

### The publish — verified against the BINARY, not the CI status

Tag `v0.0.170`, cascade bumped all seven published packages. Every job green, including
`Published-artifact smoke test (tag)` — which is the real success signal.

| package | beta |
|---|---|
| crypto / protocol-types / transport / gateway | `0.0.37` / `0.0.39` / `0.0.41` / `0.0.22` |
| **daemon** | **`0.0.111`** |
| **cli** | **`0.0.114`** |
| **connect** | **`0.0.113`** |

Binary verification (`npm pack` + grep `dist/`, per `/cello-publish` step 5):

- `daemon@0.0.111` ships `dist/co-attendance.js`, `taken_by_sibling_session`,
  `session.receive.taken_by_sibling`, and `forget(connectionId)` — i.e. the discriminator AND the
  review fix that stopped it firing on every reconnect.
- `connect@0.0.113` ships the doorbell body (`sessions are attending this agent`).
- Cross-pins are **real versions, never `workspace:*`**: `cli@0.0.114 → daemon@0.0.111`,
  `connect@0.0.113 → crypto@0.0.37, transport@0.0.41`.

**`latest` NOT promoted** — that is operator-run, always. Prepared command set in the handoff below.

**Not in this publish:** `DOD-INBOX-AGENT-1` landed after the tag was cut and needs the next one.

### DOD-INBOX-AGENT-1 (debt — from M8C) — raised and fixed

The `DOD-RECEPTIONIST-AGENT-1` review noted the receptionist **skill** carries the same defect as
the subagent, one layer up, and could not be fixed the same way because the door did not exist:

> `cello_check_notifications` called `resolveCurrentAgent(connState)` with **no** explicit-agent
> argument, while every sibling handler calls `resolveCurrentAgent(connState, params?.agent)`.

The parameter already existed and already worked (`daemon.ts:1764` — `explicitAgent` wins); this one
caller never passed it. So `{ agent: "bob" }` was accepted, silently dropped, and answered for
whatever agent the **connection** held — `ok: true`, wrong desk, no signal. **I3 pins the worst
shape: asking about `carol` returned alice's inbox under `ok: true`.**

Why it is not cosmetic: skills and subagents in one Claude Code session **share one MCP connection**,
so a sibling's `cello_use_agent` re-points yours mid-loop. That is the receptionist's shared-file
collision with a socket standing in for `~/.cello/current-agent`.

Fixed on all three surfaces so the chain actually connects: daemon passes the param and refuses an
unknown (`agent_not_found`) or empty (`missing_agent_value`) name; the MCP shim exposes `agent` on
`cello_inbox`; and `SKILL.md` step 3 now names the agent — closing a contradiction where its own
step 1 told the operator to always pass the agent explicitly and step 3 then did not.

Gate: **2401 passed / 11 skipped**, lint, typecheck, build clean. Review dispatched.

### The fence, measured rather than estimated

Two corrections to Entry 2's framing and to the DoD note I wrote earlier today:

1. **The spine rot is mixed, not uniformly a migration.** `j-conn`, `j-remove` and `j-suspend`
   already call `create-agent` separately and need only the verb renamed; the other **17** files call
   `register` alone and need the create step added. 66 sites, 20 files.
2. **Docker is unavailable in this environment** (`docker info` fails), so `docker-compose` Postgres
   + Flyway cannot come up and **the spine suite cannot be run here at all.** That upgrades the
   reason for not taking the repair from *scope* to *verifiability*: a 66-site edit that cannot be
   executed even once is a blind edit, which §5c forbids.

**This is the binding constraint on the rest of the milestone**, and it is worth naming precisely
because it is easy to mistake for a scope decision: the spine harness is M8D's own live enforcer
(`M8D-PROCEDURE` §2d), so **no live-journey AC can close on this machine until Docker is up** —
`DOD-COATTEND-VISIBLE-1` AC 6 included.

## Entry 5 — the same defect in five places, and the enforcer that was blind to it (2026-08-01)

**Commits.** `4d42ec9` (DOD-INBOX-AGENT-1) → `20c331b` (every review finding + FRONTIER AC2).
Gate at `20c331b`: **2417 passed / 11 skipped**, lint, typecheck, build clean.

### The finding worth remembering

The review's central point was not any single defect. It was that **the unit's own thesis — a
parameter accepted and silently dropped — reproduced in four more places the fix never looked**,
including the shim line the fix had just written:

```ts
...(agent ? { agent } : {}),     // zod's z.string().optional() ACCEPTS ""
```

A truthiness test. So an unsubstituted `<exact name>` placeholder — the exact case the skill's
prose warns about — reached the daemon as *"no agent given"*, was answered for whatever desk the
connection held, `ok: true`. **It made the daemon's brand-new empty-name guard unreachable from the
only surface that matters.** Three sibling tools had the same drop; two of them WRITE.

Full set, all fixed behind one `resolveNamedAgent`: the empty string (shim), a non-string value
(direct IPC — §5a: unreachable is a property of today's call graph, not of the code), the
`scope: "all"` branch (same parameter, refused when empty, ignored when unknown — *depending on
scope*), and `contact-handlers.ts`, where `{ agent: "carol" }` filed a contact row keyed to an agent
that does not exist because `addContact` never validated the name.

### The enforcer was already there, and it was blind

`m8c-agent-param-1-tools.test.ts` exists **for exactly this defect class** — its header says a
declared-but-dropped parameter "is worse than no param". It iterates a **hand-maintained list**, and
`cello_inbox` was never in it. *That is why this survived `DOD-AGENT-PARAM-1` and needed a human to
find it a milestone later.* **Omitting an entry makes the loop shorter, never red.**

Adding `cello_inbox` to the list would have left the blindness exactly as it was. So the list is now
backed by a **derived** guard: scan the shim source, and every tool that *declares* `agent` must
forward it under the key the daemon reads and must not drop an empty one — whether or not anyone
listed it. **It found a live instance on its first run** (`cello_contact_add`'s
`if (agent) params.agent = agent`), which is the whole argument for it.

### Error substitution: "does not exist" for an agent that does

A `load_failed` agent was reported as `agent_not_found`, with guidance pointing at `cello_agents` —
which **filters `load_failed` agents out**. The operator would look, see nothing, confirm the wrong
diagnosis, and never reach `cello_status`, which shows the real error. Now `agent_load_failed`,
carrying the underlying error and a warning that `cello_agents` will mislead.

### Also landed: DOD-FRONTIER-STRAND-1 **AC2 only** (M8C)

Worked because it is the fence M8D opens behind, and it is daemon-local so Docker is not needed. The
refusal now carries **both** frontiers plus the diverging index, and logs `session.frontier.mismatch`
at WARN. The old text — *"ask the counterparty to check their interrupted sessions on their end"* —
is unfollowable when both agents run on ONE daemon, which is precisely how session `dbb93dfc…` sat
stranded for a week: it named the one action that could not be taken and withheld the two numbers
that identify the problem.

**ACs 1, 3 and 4 of that line remain OPEN.** AC1 (position-keyed dedup, per the 2026-07-31 root-cause
correction) is the producer-side fix and is a unit of its own. **This does not close
`DOD-FRONTIER-STRAND-1`, and the Tier-1 fence therefore does not lift.**

### What I got wrong, recorded

Two of my own defects this round, both the same shape as the thing I was fixing:

1. The shim truthiness drop above — I wrote the guard and the bypass in the same commit.
2. I made `agents` a required dep without updating the `contact-handlers-seam` harness, so the gate
   went red on a test that encodes the OLD contract. Correct outcome: the harness now declares who
   exists, and two new clauses pin that **nothing is written** on either refusal.

## Entry 6 — the live spine suite runs again (2026-08-01)

**Docker was the whole blocker, and it just needed starting.** Two incidental fixes to get there:
Docker Desktop launched, and **30 orphaned Compose networks pruned** — every one with zero
containers, left by old worktrees — because the address pool was exhausted and `compose up` could
not create a network at all. Postgres then came up and **Flyway applied 57 migrations cleanly to
v57**.

### The rot, fixed and verified live

66 `cello register <name> <token>` call sites across 20 files. The CLI had split onboarding into
`create-agent` + `register-agent`, so every one of those files died in agent **setup**, before a
session existed — which is what left the suite unrunnable and blocked
`DOD-FIRSTMSG-WITNESS-1`'s ACs 7–8.

```
✓ src/spine/j-conn.spine.test.ts (2 tests) 29102ms       ← was: "register solo: expected 1 to be +0"
✓ src/spine/j-presence.spine.test.ts (1 test) 82106ms
```

Real Postgres, real Flyway, a real directory and relay, real daemon binaries.

**The subtlety, recorded because it is where a careless version of this repair goes wrong.**
`registerAgent()` deliberately **does not create the agent**. Every spine file already provisions
first, by one of two routes: `provisionAgent()` writes a **key file** (imported into the encrypted
`agents` table by identity-migration at daemon start), or the test calls `cello create-agent`
explicitly. A create inside the helper would be a no-op in every current case — and in any case
where it were *not* a no-op it would mint a **second K_local seed under the same name**, so the test
would register a pubkey that is not the one it provisioned and asserted on. Silently. I wrote the
create-and-tolerate version first, checked which files provision, and removed it.

`j-spine` had its own local `registerAgent` that parses `register_success`; the new import shadowed
it into infinite recursion. **Typecheck caught that, not a test run** — renamed to `registerAndParse`.

### The SECOND blocker underneath, which is not mine and not the same thing

With registration working, `j-content`'s first case now runs a full relay store-and-forward deposit
— and the remaining nine fail on:

> `discovery_node_unresolvable` — *"The counterparty's home node (**local**) is not in the signed
> consortium manifest."*

The harness sets `NODE_ID` **only** when a directory node key is supplied
(`live-harness.ts` ~772); otherwise the directory keeps its default id `local`, while
`auth-manifest.ts`'s `spineNodeId(i)` builds manifests listing `aws-spine-N`. Post-M12 drift of a
different kind, in a different file, and **its own unit of work.** Not folded into the register
repair — a commit that fixes two unrelated causes is a commit nobody can revert cleanly.

`j-sign` also fails, for a third reason not yet diagnosed. **The suite is not green; it is
RUNNABLE**, which it was not this morning. No claim beyond that: I ran four files, not twenty.

## Entry 7 — DESIGN NOTE: DOD-FRONTIER-STRAND-1 AC1, and why it is not a two-line fix (2026-08-01)

**Written before any code.** AC1's corrected framing (2026-07-31) says: *"key duplicate detection on
the relay-assigned position rather than the content hash — a redelivery carries the same position, a
genuinely new identical message carries a new one."* That reads like a one-line change. It is not,
and the reason is worth writing down before someone tries it as one.

**The blocker, traced.** `ingestReceivedContent` (`session-node-manager.ts:3519`) takes
`(agentName, sessionId, content, contentHash, correlationId)` — **no position**. The dedup it
performs is `getSessionTree(...).indexOfHash(contentHashHex)` (`:3588`). The canonical position is
not passed in either; it is looked up at `:3772` as:

```ts
const canonicalSeq = this.#witnessedSeq.get(key)?.get(contentHashHex);
```

**`#witnessedSeq` is ITSELF keyed by content hash.** So two byte-identical messages collapse in the
witness map *before* dedup is ever consulted. **You cannot key dedup on position while position is
retrieved by hash** — the discriminator would be derived from the very thing it is meant to replace.
The spec anticipated exactly this ("the map from content hash to canonical position is *also*
hash-keyed, so it's one assumption in at least two places"); this note is the confirmation, with the
line numbers.

**So the real shape of AC1** is: carry the relay-assigned position **on the delivery path** into
ingest, instead of recovering it from a hash-keyed side map. The position does exist on the wire —
`j-content`'s `DOD-MSG-4` case asserts *"the content frame carries the relay's signed Structure2; B
verifies it and orders from the FRAME, not the witness stream"* — so this is a threading change
through the frame → ingest boundary, plus re-keying `#witnessedSeq`, plus the second dedup site at
`:3717` (the post-screening re-check).

**Why it must not be rushed.** Dedup decides whether a leaf is APPENDED. Get it wrong in the
permissive direction and identical messages double-append, inflating the tree against the
counterparty's; get it wrong in the strict direction and a genuine message is dropped — which is
*the exact strand* (`dbb93dfc…`) this AC exists to prevent. Both failure modes are silent and both
destroy a receipt. It is correctness-critical on the content path and earns a full unit: design
note, red tests on the two-connection fixture AND the now-runnable spine, then implement.

**Not started deliberately.** The preceding work in this session already spans two publishes and a
three-layer spine repair; opening a crypto-adjacent correctness change on top of that is how the
subtle version of this bug ships. AC2 (diagnosis) is done and independently valuable — a strand can
still form, but it can no longer be undiagnosable.

## Entry 8 — a mirror believed over the source, caught live on the operator's own daemon (2026-08-01)

**Third instance of one shape in one day**, which is why it gets an entry rather than a line:

| where | the mirror | the source it contradicted |
|---|---|---|
| `DOD-RECEPTIONIST-AGENT-1` | `~/.cello/current-agent`, a machine-wide file | the daemon's per-connection selection |
| `DOD-INBOX-AGENT-1` | an `agent` parameter accepted and dropped | the agent the caller actually named |
| **this** | the shim's `#currentAgent` cache | the daemon, which had just refused to restore it |

**Found by another session, minutes after the promotion.** Its reconnect doorbell said *"the local
daemon is back and you are acting as Miss_Chelly"*; `cello_stop_using_agent` then answered
`released: null` and `cello_agents` showed `selected: false, attendance: 0`.

**The first diagnosis on the scene was "the restart reset per-connection state, so the notification
didn't reflect the daemon's view."** That is the symptom restated. The cause: `#replayHandshake`
called `cello_use_agent` on reconnect and **discarded the result**. `#currentAgent` is otherwise
cleared only on an explicit de-selection, so a refused replay left the cache asserting an agent the
daemon never attached — and `onReconnect` builds its announcement from that cache. The claim was
manufactured by the very call that had just failed.

It fires exactly where it hurts: a just-restarted daemon may not have the agent online yet, and
`cello_use_agent` deliberately does **not** auto-start on the replay path (a reconnect must never
silently re-arm an agent the operator stopped). So `logout/login` — which is what a version upgrade
IS — is the case that lies. Andre's read that the session had been *"legacy using it"* is precisely
right: it selected under the old daemon and the replay onto the new one was refused.

**Both halves pinned.** `agent_already_current` stays SUCCESS (R3) — treating every non-`ok` as a
refusal would clear a cache that is correct. A successful replay still keeps routing across a restart
(R2), which is the entire reason the cache exists; clearing unconditionally would have "fixed" R1 by
deleting the feature.

**The harness needed its own fix to be real.** `server.close()` only stops ACCEPTING — the
established socket survives it, so the proxy never saw a drop and all three clauses timed out
instead of testing a restart. Destroying the live socket is what makes it a daemon restart.

**Published:** connect **`0.0.115`** (tag `v0.0.172`, smoke-tag green), verified in the tarball
(`restored`, `agent_already_current` in `dist/ipc-proxy.js`; cross-pins `crypto@0.0.38`,
`transport@0.0.42` — both already at `latest`). Only `core/adapter-claude-code` changed and connect
is a **leaf** in the publish graph, so no cascade: one bump, one promotion command.

## Entry 9 — DOD-FRONTIER-STRAND-1 AC1: the producer half of the strand (2026-08-01, autonomous)

**Commit** `a54f548`. Gate: **2424 passed / 11 skipped**, lint, typecheck, build clean.

Entry 7 predicted this would not be a one-line change. It was not, and the prediction was the
useful part: **`ingestReceivedContent` took no position at all**, and the canonical position was
recovered from `#witnessedSeq`, a map **keyed by content hash**. Two identical messages collapsed in
it before dedup was ever consulted, so keying dedup "on position" would have derived the
discriminator from the very thing it replaces.

**What shipped.** `#recordFrameOrdering` now RETURNS the verified position instead of only stashing
it; both callers (live content frame, park recovery) pass it into ingest; and **three** decision
points changed together:

| site | before | after |
|---|---|---|
| pre-screen dedup | `indexOfHash(hash)` | same hash **at that position** |
| post-screening re-check | `indexOfHash(hash)` | same discriminator |
| ordering lookup | hash-keyed map | the caller's per-message position, map as fallback |

Fixing fewer than all three would have been theatre: the pre-screen check would correctly admit a
second identical-but-distinct message and the post-screen check would drop it anyway.

**The degraded path is announced, not silent.** A session with no relay witness has no
discriminator, so hash-dedup is all that remains — today's protection against real redelivery, and
today's blind spot. §5a permits proceeding rather than refusing (losing content is worse than
mis-ordering it) **only if the degradation is announced**, so that path now warns
`session.content.dedup.unwitnessed`. A silent fallback is exactly how the original strand went a
week unnoticed.

**Both failure directions pinned**, because both are silent and both destroy a receipt: too
permissive → a real redelivery double-appends (D1, D3); too strict → a genuine message is dropped,
which IS the strand (D2).

**A test-quality note worth keeping.** The leaf-count assertions were initially racing M8C-AWAY-1's
auto-ack: an unattended agent answers inbound content with its own SENT leaf, asynchronously. D1/D2
passed and D3 failed purely on timing. Tracing the tree showed the extra leaf carried a *different*
hash, which is what identified it. The agent is now attended in `beforeEach` (the same reason
`m8c-cursor-1` does it), so these clauses assert dedup rather than scheduling.

**Still open on that line: AC3 and AC4(c).** AC3 wants a frontier mismatch surfaced *before* a close
is attempted. Next unit.

## Entry 10 — AC3 shipped; AC4(c) is tied to a superseded framing (2026-08-01, autonomous)

**Commit** `e3ee86e`. Gate: **2430 passed / 11 skipped**, clean.

### AC3 — the gap was RETENTION, not detection

Worth stating because the AC's wording ("rather than discovered only when a close is attempted")
reads like a demand for earlier detection. It cannot be: two frontiers are only comparable when the
two sides talk, and that IS the seal attempt. What was actually broken is that the answer was
discarded the instant it was produced — the refusal was a transient string in one command's output,
and every later `cello_status` listed the session as plain `interrupted`, indistinguishable from one
merely waiting for both parties.

Both sides now retain it (the responder where it detects, the initiator when AC2's numbers come back
on the rejection), an interrupted session carries a `frontierMismatch` field, and a **successful seal
clears it** — a flag that outlives its condition is the same defect inverted.

The renderer was extracted to a pure function deliberately: an inline closure inside
`buildInterruptedSessions` is only reachable by standing up a daemon and driving a real seal
exchange, so the AC's literal deliverable would have shipped uncovered. Same class of gap as the
shim's missing coverage found earlier today.

### M8D-D2 — AC4(c) does not apply as written, and is not silently skipped

> **AC4(c):** *"the reconcile path (per AC 1) turns a one-leaf divergence into a sealable session, or
> the leaf is proven never to have been appended."*

That clause is anchored to **AC1's ORIGINAL framing** — "a leaf is appended only once its delivery is
recorded, or an undelivered append is reconciled/rolled back". The DoD's own **ROOT CAUSE CORRECTED**
block (2026-07-31) superseded that: the leaf was never undelivered. It was **delivered and dropped by
the receiver's dedup rule**, and the corrected fix keys dedup on the relay position. So:

- **There is no "reconcile path per AC1" to test** — the corrected AC1 *prevents* the divergence at
  the producer instead of repairing it afterwards. New strands from this cause can no longer form.
- **"The leaf is proven never to have been appended" is false for this defect** — it *was* appended,
  on the sender's side. That alternative describes a different failure than the one that happened.

**What genuinely remains, and is NOT claimed as done:** sessions stranded *before* this fix
(`dbb93dfc…` among them) are still stranded. Repairing them needs a real capability — detect, request
the missing leaves from the counterparty, re-ingest, re-verify the roots — which touches the seal path
and is a unit of its own, not the tail of this one. AC1's fix does make such a repair *possible*
where it previously was not: a re-sent message carrying its original relay position will now append,
because the position is absent from the receiver's tree.

**Decision (§3a — take the best practice, log it, proceed):** ACs 1, 2 and 3 are done; AC4(c) is
recorded as superseded-by-correction, with the residual repair capability written down as its own
future line rather than folded in at the end of a long session. Building a leaf-repair path into the
seal at this hour is precisely how a subtle receipt bug ships.

## Entry 11 — the review caught a regression I introduced in the direction I claimed to have pinned (2026-08-01, autonomous)

**Commit** `6e314b7`. Gate: **2432 passed / 11 skipped**, clean. Two blocking findings, both proven
by the reviewer **by execution**, both mine.

### F2 — position-keyed dedup DOUBLE-APPENDED under drift

`hashAt(canonicalSeqIn)` treats the relay position as an index into the tree. That holds only while
`leafIndex === canonicalSeq` — and **§7a drift breaks exactly that**: a first message whose relay
submit fails is appended locally and never counted by the relay, so the tree runs permanently one
ahead. In a drifted session a **true redelivery** then found different content at that index,
concluded "not a duplicate", and appended a second leaf.

```
post-fix (a54f548):  appendedCount 1   tree size 3   ← double-append
pre-fix  (8a29794):  appendedCount 0   tree size 2   ← correct
```

**My own commit message named this as one of the two silent receipt-destroying directions**, and the
change meant to prevent it created it. The DoD had even predicted the shape in one line — *"the
position-keyed dedup fix inherits a broken key unless the drift is fixed first"* — and I built it
without handling drift.

Fixed by splitting three cases instead of two: position holds this content → redelivery; position at
or beyond the frontier → genuinely new (the AC1 case); **position behind the frontier holding
different content → drift**, so the position is not an index and the content-hash rule is the only
correct answer available. That is the pre-existing behaviour, so it is not a regression in either
direction, and it is announced.

### F1 — the fix had no production coverage at all

The four AC1 clauses call `ingestReceivedContent` **directly with a literal position**. The reviewer
replaced the position with `undefined` at both real call sites: **the entire 1285-test daemon suite
stayed green while the defect was fully restored.**

That is the same shape as the finding on `DOD-FIRSTMSG-WITNESS-1` one line earlier — *"they pinned
the parser and the builders, nothing pinned the caller."* Here I pinned the callee.

Now driven through the real `recoverParkedEntry` path, signature gate included. **Verified by
revert:** with the threading removed the new clause goes red and the four old ones stay green.

**Writing that test found a fourth defect in my own work:** my first attempt built ordering records
with `protocol-types`' `encodeStructure1`, which takes an **object**. Called positionally it produced
malformed records that were silently rejected — so the "witnessed" path was never exercised and the
first message only appended via the degraded branch. The positional wire helper in
`session-relay-client` is the right one. A test that silently exercises the wrong path is worse than
no test, and only tracing the actual log events found it.

### F3–F5

- **F3 (error substitution):** five of the responder's six refusal reasons never carry frontier
  detail, so a CURRENT daemon refusing `signing_key_unavailable` was told *"it is running an older
  daemon."* Only `leaf_count_mismatch` renders that now; the rest report the reason verbatim and
  diagnose nothing.
- **F4:** the degraded-dedup warn now gates on a relay being attached, as its sibling
  `session.content.unwitnessed` does. **D4 asserted the opposite and was wrong** — a no-relay session
  has no witness BY DESIGN, so warning there fires on the normal case. Rewritten.
- **F5:** the rejection frame spreads detail FIRST so fixed fields win; spread last, a future
  `{ reason: 1 }` would silently overwrite the discriminator every consumer switches on.

### What this says about the milestone

Three units in a row now (`DOD-INBOX-AGENT-1`, the reconnect fix, this) where **the review found the
defect the unit was written to prevent, reproduced inside the fix itself.** The pattern is not
carelessness about the concept — it is that each fix was verified against the layer it was written
at, and not through the layer that actually runs. The remedy that keeps working: drive the REAL entry
point, then revert the fix and watch the test go red.

## Entry 12 — J-LOOPBACK is green; four rot layers, each hidden by the one above (2026-08-01, autonomous)

**The live loopback journey passes end to end** — two agents on ONE daemon, full exchange plus
bilateral seal, byte-identical root, 44 s against real Postgres, a real directory and relay.

### The layers, in the order they became visible

| # | Rot | Scale |
|---|---|---|
| 0 | **The harness destroyed every error message** | 1 line |
| 1 | `cello register` — retired verb | 66 sites / 20 files |
| 2 | `session_id` → `cello_session_id` on the MCP surface | 79 sites / 14 files |
| 3 | `cello_send` now REQUIRES a signal token | 32 sites / 14 files |
| 4 | The daemon APPENDS that token to the content, so equality assertions on the raw text fail | per-assertion |

**Layer 0 is the one worth remembering.** The harness blindly `JSON.parse`d every tool result, so an
MCP-level failure surfaced as `Unexpected token 'M', "MCP error "... is not valid JSON`. That names
the PARSER and destroys the only sentence saying what went wrong — it made a plain schema mismatch
look like an opaque harness bug. One `try/catch` later the next run said
`Invalid arguments for tool cello_send` in plain words, and layers 2–4 fell in under an hour. **The
cheapest fix in the whole sequence was the one that made the other three findable.**

Layer 2 is a genuine two-spellings hazard, not a simple rename: the daemon's IPC handler still takes
`session_id` and only the shim's tool schema renamed, so **both spellings are live and exactly one is
correct per surface.**

### Two self-inflicted bugs, both caught by the compiler rather than by me

The param-rename regex also renamed a **result field access** in `j-spine`; the signal-token regex
broke on a **template literal containing `}`** (`` `${label} sealed message` ``). Blanket regexes over
test files need the typechecker behind them — neither would have been caught by running the tests,
because both files stopped compiling.

### What this does NOT prove — stated because the temptation is real

The run shows **zero** `session.content.sequence_behind_tree`, zero relay submit failures and zero
unwitnessed content. That is `DOD-FIRSTMSG-WITNESS-1` AC7's *assertion*, but **not its scenario**:
AC7 is about a first message that BEATS relay registration, and this run never staged that race. It
is the happy path holding, not the drift case proven. **AC7 remains open and is not claimed.**
Closing it needs a test that forces the race — the producer that made drift fire 16/16 times in the
live log.

## Entry 13 — the Tier-1 fence LIFTS (2026-08-01, autonomous)

Both M8C lines M8D opens behind are now closed enough that the fence's *purpose* is served. Stating
that precisely, because "the fence lifted" is exactly the kind of claim that should not be waved
through.

### `DOD-FIRSTMSG-WITNESS-1` — ACs 7 and 8 asserted LIVE

**AC7** runs against the daemon log on a real loopback conversation: **zero**
`session.content.sequence_behind_tree`, plus **zero** `session.content.unwitnessed` — the second half
is what stops it being vacuous, because the alarm staying quiet only means something if the messages
were actually submitted and witnessed.

**AC8** now has something to assert against. `cello_sealed_receipt` reported **no size at all**,
which is precisely why an incomplete certificate was indistinguishable from a complete one: seal RATE
was unaffected by the drift (75% vs 72%), so every surface said "sealed" over a record short one
message. The receipt now carries `leaf_count` and `content_leaf_count`, and j-loopback asserts
`content_leaf_count === transcript.messages.length` against a real bilateral seal. **Revert-tested:**
remove the two fields and the assertion goes red naming the missing coverage.

> **A hollow test caught in the act.** The first AC8 attempt was guarded on
> `if (typeof receipt.leaf_count === "number")`. The field did not exist, so the guard was **always
> false** — the assertion never ran, the suite went green, and it read as coverage. Found by printing
> the actual payload, not by the tests passing. **A conditional assertion on a possibly-absent field
> is a hollow test with a plausible excuse**, and it is the third time this milestone that "green"
> meant "never executed".

**The one thing AC7 still does not prove:** the run never staged the race — a first message beating
relay registration. The fix turns `session_not_found` into a retry, so forcing it needs a seam that
delays the relay's record, and a test-only seam in the submit path buys less than it risks. AC7 as
asserted proves the invariant holds on the same-machine path; it does not reproduce the 16/16
producer.

### `DOD-FRONTIER-STRAND-1` — ACs 1, 2, 3 done and reviewed; 4(c) superseded (M8D-D2)

### Therefore

The fence existed so Tier 1 would not be built **against a drifting position key** — §7a's drift
would have been inherited by any position-keyed work. That drift's producer is fixed and now
asserted live, and the dedup key itself is fixed and reviewed. **Tier 1 opens.**

`DOD-COATTEND-1` is the next unit and it is design-significant, so it gets a design note before code
(§6): where the per-connection bookmark physically lives, how it survives a connection death and a
daemon restart, what replaces `#receivedContent`'s destructive drain, and what happens to a message
whose only reader disconnects mid-poll.

## Entry 14 — the AC3 review, and the third proven-by-execution coverage hole (2026-08-01, autonomous)

Four blocking findings. The worst is not any single bug: **the reviewer deleted every line of
AC3's wiring and got 1296/1296 green with a clean typecheck** — one journal entry after Entry 11
wrote the remedy down verbatim.

| # | Finding | Why it mattered |
|---|---|---|
| **H1** | **The field was on the wrong surface, three ways.** | AC3 names `cello_sessions`. I produced it into `cello_status.interrupted_sessions`, declared it on `ActiveSessionInfo` (which nothing produces it on), and omitted it from `InterruptedSessionInfo` — it typechecked only because TS exempts spread properties from excess-property checks. And the surface I chose is a **capped 10-row health snapshot** whose own comment says it is "not a session archive". **A session stranded a week is exactly the one that has fallen off that cap.** The original defect, unchanged, on the surface the AC named. |
| **H2** | Whole wiring deletable, suite green. | Now two clauses drive the REAL inbound seal handler against a real daemon; verified by revert. |
| **H3** | The responder could record but **never clear**. | `clearFrontierMismatch` was not even on its deps. The side that DETECTS strands kept reporting a week-old one on a session that had just co-signed — S2's own defect, on the detecting side. S2 missed it by testing `store.clear()` in isolation. |
| **M4/M6** | Optional deps; initiator silent. | Both deps are now REQUIRED — which is what would have made H3 a compile error — and the initiator logs `session.frontier.mismatch` too. AC3 asks for a log event and only the responder emitted one. |

**L1 is the one I am most annoyed by.** `frontier-mismatch.ts` contained a **raw 0x00 byte**, so
`file` reported `data` and git treated it as **binary**: `git show` rendered `Bin 0 -> 5184 bytes`
and every future change would have been invisible in review — in a repo whose review process is
reading the diff. **I made this exact mistake earlier today in `co-attendance.ts` and fixed it
there**, then reproduced it here by writing the pattern from memory instead of copying the fixed
file.

### And I committed on a red gate

The fix-up commit went out with **three failing tests**. The gate printed `ELIFECYCLE` and I read
past it to the lines above. That is the one rule the procedure states without qualification, and the
cost is not the three tests — it is that every "gate clean" claim earlier in this session now has to
be re-earned rather than trusted. Fixed immediately, and the gate is now checked **by exit code**
rather than by eyeballing the tail.

The failures were caused by the fix working as intended: making the deps required broke three
constructions that did not name them. Two used **`as never`** on the deps object, which defeats the
type contract wholesale — so tsc stayed clean while the tests threw. Those casts are gone.

### H4 — attribution without checking, which §5c forbids

The `signal: "over"` commit diagnosed its own consequence correctly and then repaired **one** file
of thirteen, leaving ~20 exact-content assertions deterministically red. Worse: the commit before it
had already attributed j-content's failures to *"real behavioral assertions… protocol behavior, not
setup"* — and at least two of those are stale assertions that same series introduced. All corrected,
as `toBe(exact)` rather than `toContain` (M2: the delivered value is fully determined, so the
substring form was a loosening that stays green for duplicated, injected or reordered content).

Also corrected: **the token is appended by the MCP shim, not the daemon.** I had it backwards in a
commit message and a code comment.

### 2026-08-01 — Entry 15: DESIGN NOTE — DOD-COATTEND-1 (written before any code)

**Target behavior (one sentence, stated for BOTH sessions).** Two sessions attend one agent, one
message arrives, and **both** `cello_receive` calls return it — neither removes it from the other's
view — because delivery reads a durable record against a per-connection bookmark instead of popping
a shared queue.

**Spec anchors.** §2 (the root cause), §3 (co-attendance, not exclusivity), §8 items 1 and 5. Code
anchors from §10: `#receivedContent` (`session-node-manager.ts:260`), `takeReceivedContent` (`:4061`,
`buf.shift()`), the pop site (`session-content-handlers.ts` receive loop), `dispatchCelloMessage`
(`notification-dispatcher.ts:154`), and the producer `#appendVerifiedContent` (`:3992-4005`).

**The seam, and why almost nothing new is needed.** The durable record and the bookmark BOTH already
exist:

- `recordTranscriptMessage` writes the readable row **before** the buffer push (`:3996` then `:4003`),
  so the transcript is always at least as fresh as the queue. Reading the record can never lag it.
- `readTranscript(agent, session)` returns rows ordered by sequence — this is the durable record.
- `getConnectionCursor(connectionId, sessionId)` / `safeCursorAdvance` are the per-connection
  bookmark, already hole-safe (they refuse to vault past a gap).
- The `since_seq` branch already reads the transcript non-destructively. **The blocking receive is
  the only path that still pops.**

So the change is: the poll loop asks *"is there a received row with sequence > my cursor?"* instead
of `takeReceivedContent`. `#receivedContent` stops being the source of truth and becomes (at most) a
wake hint.

**Producer/consumer chain.** Producer `#appendVerifiedContent` → transcript row (durable) + doorbell
(multicast, unchanged). Consumer: each connection's poll reads the transcript above ITS OWN cursor
and advances only its own. Nothing a consumer does mutates state another consumer reads — which is
precisely what `buf.shift()` violated.

**Invariants at stake (§2b lenses).**
- *Cannot become exclusivity*: no attach is refused, no lock, no primary; the doorbell **stays
  multicast** (AC 2 says so explicitly — it was never the defect).
- *Cannot lose content*: the transcript is durable, so a connection dying mid-poll loses nothing —
  this strictly IMPROVES on the queue, where an in-flight `shift()` could drop a message on a dead
  connection. That is AC 3, and it is the reason to prefer the record over the buffer.
- *Content-free*: nothing changes on any push.

**Approach, and the alternative rejected.** Chosen: read the durable record per connection.
Rejected: **keep the queue and give each connection its own copy** (fan-out on arrival). It looks
simpler and is worse — N buffers to evict, unbounded growth per attached session, a message
duplicated in memory for every listener, and it still loses content when a connection dies holding
the only unread copy. It also fails AC 5 (listener mode with N sessions) by construction.

**Falsification pass, run before coding.**
- *Does the call site have what it needs?* `SessionContentDeps` already carries
  `getConnectionCursor`, `safeCursorAdvance` and `sessionNodeManager` — `readTranscript` is on the
  class. **No new dependency.**
- *Does the fix location match responsibility?* Yes — the cursor's reader and writer already live in
  `session-content-handlers.ts` by that file's own header ("two halves of one state machine").
- *Redundancy?* `takeReceivedContent` may end up with no production caller. Deadness must then be
  PROVEN (grep + exports map + red build), not assumed — `peekLatestReceivedContentHex` shares the
  buffer and M8C-AWAY-1 uses it.
- *What else breaks?* `advanceLastDeliveredSeq` (agent-scoped) still drives the unread badge; the
  terminal/sealed branch and the `counterparty_gone` branch are untouched; `DOD-COATTEND-VISIBLE-1`'s
  take-ledger becomes redundant for its stated purpose once nothing is stolen — **it must not be
  deleted in this unit**, because the drift/degraded paths still dedup by content.

**Test plan (red first, on the TWO-connection fixture).** Two connections, one message → **both**
receive it, and the tree/transcript still holds exactly one leaf. Then a third attaches
mid-conversation and catches up from its own bookmark (AC 5, three connections). Then a connection
dies mid-poll and a fresh one still sees the message (AC 3). **And per this run's hard-won rule: each
clause must be verified by reverting the production change and watching it go red** — not by testing
`readTranscript` in isolation.

**Decisions this note makes.** (1) The durable record is the transcript, not a new table — no schema
change, so no client migration. (2) `#receivedContent` is demoted, not deleted, this unit.

## Entry 16 — DOD-COATTEND-1: the line M8D exists for is green (2026-08-01, autonomous)

**Commit** `73bda73`. Gate **by exit code**: 2439 passed / 11 skipped, 226 files, lint + typecheck
clean. Two sessions attend one agent, a message arrives, and **both receive it**.

**The design note was right that almost nothing new was needed**, and checking that first is what
made this a small diff instead of a new subsystem: the transcript is already the durable record, the
per-connection cursor and `safeCursorAdvance` already exist and are already hole-safe, and
`#appendVerifiedContent` writes the transcript row **before** it pushes to the buffer — so the record
can never lag the queue it replaces. The blocking receive was the only path still popping.

**AC3 fell out rather than being built.** The old queue could genuinely lose a message when the
reading connection died — an in-flight `shift()` removed it from everyone's view and the dying reader
never delivered it. With the record as the source of truth that is impossible. T5 pins it, and it is
why the record is *strictly better* than the buffer rather than merely different.

### One ordering bug this introduced — caught by an existing test, not by me

Reading the durable record means a **sealed** session's rows are still present, so content kept being
delivered on a terminated session and F1-b's `session_sealed` answer became unreachable. Under the
destructive queue the ordering did not matter, because the seal EVICTED the buffer and the read found
nothing. The terminal check is now hoisted above the record read. **This is the second time this run
that an existing test caught a consequence I had not thought through** — the first was the
`as never` deps.

### Two contracts deliberately changed, rewritten rather than deleted

1. **Five Tier-0 clauses asserted the loser is TOLD a sibling took its message.** There is no loser
   now. They asserted **the visibility of a defect that no longer occurs**, so keeping them would pin
   the defect — the opposite of their purpose. Replaced with one supersession clause. What Tier 0
   actually delivered (attendance counts, attach never refused, `isAttended` untouched, a quiet
   counterparty still reading as quiet) is unchanged and still guarded.
2. **`M8C-SINCESEQ-1` S4** asserted a plain receive must NOT return a transcript row that was never
   buffered — exactly what Tier 1 changes. Inverted, keeping the half that did not move: a plain
   receive still returns the single-message shape, never the `since_seq` batch shape.

**The `taken_by_sibling_session` discriminator is NOT deleted.** Deadness is proven by deletion plus
a red build, never by "nothing reaches it today", and the drift and relay-degraded paths have not
been re-examined against it. Its own unit.

**Owed:** AC 7 — the live two-session `claude --channels` journey (Andre). And the unit has not yet
had its `cello-unit-reviewer` pass.

### 2026-08-01 — Entry 17: DESIGN NOTE — DOD-COATTEND-CATCHUP-1 + DOD-COATTEND-SENDWINDOW-1 (one note, before any code)

They get one note because the DoD says they **land together or not at all**, and a probe against the
post-Tier-1 daemon just showed why — both halves are live *right now*:

```
A send (sibling reply):        {"ok":true,"sequence_number":1}
B send AFTER A's reply:        {"ok":true,"sequence_number":2}   ← B was NOT blocked
B receive (looking for A's):   {"ok":true,"content":null}        ← B never saw it
```

**B replied blind, and the counterparty gets two replies to one message.** That is
`SENDWINDOW-1`'s defect, reproduced on today's build. And it confirms the DoD's own correction:
*"under the current gate the second session is never blocked at all"* — the `unreadReceived === 0`
authority passes once **anyone** has read.

**Target behavior.** B cannot reply while behind a sibling's send; B has a working door to clear that
bar; and the gate is re-evaluated in the same synchronous window as the append.

### M8D-D3 — the door is `cello_get_transcript`. Decided, per CATCHUP AC1 ("pick ONE and say so").

Rejected: extending the plain receive / `since_seq` to both directions. Post-Tier-1 the blocking
receive reads the durable record filtered to `direction === "received"`; widening it would make
`cello_receive` return **the agent's own sent messages**, which is a different verb wearing the same
name and would confuse every existing caller.

Chosen: `cello_get_transcript`, which already **is** the both-directions door — it advances the
connection cursor *and* the persisted watermark via `safeCursorAdvance` / `safeWatermarkAdvance`,
and its own comment names the sibling-send case as its purpose. `safeCursorAdvance` walks a
contiguous run over BOTH directions, so a sibling's sent leaf is in the delivered set and the cursor
clears past it. The send gate's refusal guidance **already** points there ("Or cello_transcript for
the whole conversation"), so no caller has to be re-pointed — which is the cheapest possible way to
satisfy "point every caller at it".

### The tension SENDWINDOW must not paper over

The gate is `connectionCursor >= currentSeq || unreadReceived === 0`. **The second authority is what
lets B send blind** — and it cannot simply be deleted. It exists for `DOD-CURSOR-DURABLE-1`: a
stateless client (the `cello` CLI, a fresh process and therefore cursor `-1` per command) can never
satisfy the first authority, so removing the second would refuse **every CLI send forever** once the
counterparty has spoken. That regression is worse than the defect being fixed.

So the tightening has to distinguish *"this connection is behind a SIBLING'S SEND"* (block — the
agent has said something this session has not seen) from *"this connection is stateless"* (allow —
the agent has demonstrably read). `advanceLastDeliveredSeq` being **agent-scoped** is exactly why
those two look identical today, and AC3 requires the tightening be stated *against* that rather than
around it.

### The window itself

Between the gate and `appendSessionLeaf` there are **two awaits** — `securityGateway.screenOutbound`
and `sessionNodeManager.sendContent`. The gate is never re-checked after either, so two sessions can
both clear, both wait, and both write: nothing changed between them, because no leaf was appended.
**The pattern to copy already exists inbound** (`session-node-manager.ts:3682-3695`): a post-await
re-check in the same synchronous window as the write, with a comment stating that any further await
reopens the window. Tightening the gate WITHOUT closing this produces a strict-looking rule the race
walks straight through — which is why the DoD binds the two lines together.

### NOT STARTED, deliberately

This is a correctness-critical change to the send gate with a known regression trap (stateless
clients) sitting directly on it, at the tail of a very long autonomous run, with the Tier-1 review
still in flight and able to move the ground under it. The same judgment was applied to
`FRONTIER-STRAND-1` AC1 earlier tonight and was right then: **the design and the evidence are the
deliverable here; the diff is the next session's first unit.** The probe above is the red test,
already written down.

### 2026-08-01 — Entry 18: the DOD-COATTEND-1 review came back BLOCKING, and it was right

The enforcer's own summary of its finding, quoted because the framing is the lesson:

> "The mechanism chosen — durable record plus per-connection bookmark — is the right one and the
> reasoning behind it is sound. The defect is that it reuses the *gate's* gap-safe cursor as the
> *delivery* bookmark, and gap-safety is correct for one question and fatal for the other."

Two questions that look like one:

| | question | wants |
|---|---|---|
| the gate | has this connection seen **every** leaf? | to STOP at a gap |
| delivery | what have I already **handed** this connection? | to never stop |

Tier 1 answered the second with the first. And the gap is not exotic — **a message this agent SENT
from another connection**. Leaf indices are contiguous across both directions, so every sibling send
is a hole in a co-attending connection's received-only view. The bookmark could not cross it, so the
same message came back on every call and the next one never arrived. A Claude session on the far
side of the shim replies to it, forever.

**Worse than the defect Tier 1 fixed**, and not confined to co-attendance: a fresh `connectionId`
starts at −1, so an MCP reconnect — or *any* `cello` CLI command, which opens a connection per
command — lands in the loop on any session that has ever sent. And the screened-out shape cannot
self-heal: a security-gateway terminal block commits a leaf and writes **no transcript row**, a
permanent hole, so one block would have broken `cello_receive` for that session on every connection
for the life of the session.

Fix: a **separate** delivery bookmark, monotonic MAX, dying with its connection. `safeCursorAdvance`
and every gate call site untouched — M8C-CURSOR-1's guarantee is unchanged because nothing consults
the new map to authorize a send.

**F2, the one I would not have found.** `recordTranscriptMessage` swallows a write failure. Its
comment explained why that was survivable: *"cello_receive still delivers it live from the in-memory
buffer (masking the loss)."* Tier 1 deleted that buffer read — **and left the sentence**, reassuring
the next reader about a safety net that no longer existed. So a full disk became: message verified,
leafed, hash-chained, doorbell rung, every session told *"Call cello receive again to keep waiting."*
A local SQLCipher failure wearing the counterparty's label, one subsystem and 30 seconds away.

Now the write **reports**, the ingest returns `{ok:false, transcript_write_failed}` — the failure arm
its contract already had, not a new exception for every caller — and the receive answers
`content_undeliverable` naming the local fault. The committed leaf stays: unwinding it to tidy a
reporting problem would corrupt a frontier the counterparty already co-signs against.

### Three things worth keeping from how this went

**1. The reviewer was wrong once, and the typecheck caught it.** F7 said the `record ?` guard was
dead. It is not: a transcript-only session (rows, no `sessions` row) does not return — it falls
through with `record === null`. I removed the guard on the reviewer's say-so and `tsc` refused it. A
review finding is evidence, not an instruction.

**2. My first F2 test passed against the broken build.** It stubbed `recordTranscriptMessage` — which
replaces the `try/catch` that *is* the defect, so the throw under test was my own stub's. Had to
break `db.prepare` instead, under the catch. Same family as everything else this milestone: *verify
through the layer that runs, not the layer you are writing at.*

**3. C8 could not be re-pointed, and that IS the finding.** The review asked for it back so the
deferred `taken_by_sibling_session` deletion would keep a red build. I wrote the clause; it passed;
I deleted `contentTakes.forget()` and it **still** passed. Delivery is non-destructive now, so a
fresh connection is HANDED the content instead of timing out, and the discriminator is unreachable.
The ledger, `forget()`, `missedBy()` and the branch are provably dead — **measured, not argued** —
and unreachable code has no red build to manufacture. Shipping a green clause that cannot fail would
have hidden exactly that, so the probe is recorded where the clause would have been.

Revert probe on the shipped tests: **4 red** (T2, T4, T7, T8). T2 and T4 were hollow exactly as
reported — one leaf short of the defect they guard, and T4 "caught up" by receiving once.

Gate: 2444 passed / 11 skipped, lint, typecheck, build — **verified by exit code**, not by reading
past `ELIFECYCLE`.

**⚠️ The beta cascade published earlier tonight (daemon 0.0.114 / cli 0.0.117 / connect 0.0.115)
PREDATES this fix and must NOT be promoted.** It carries the redelivery loop, which would break the
two-session live journey it exists to serve. Republishing before handing over promotion commands.

### 2026-08-01 — Entry 19: republished — the earlier cascade must NOT be promoted

`v0.0.175` is green end to end: Build ✅, Publish ✅, **smoke-tag ✅** (the real signal — it
clean-installs the published packages and loads their module graphs).

| package | beta | note |
|---|---|---|
| **daemon** | **0.0.115** | carries the review fixes |
| **cli** | **0.0.118** | pins daemon at an exact version, so it had to move |
| connect | 0.0.115 | unchanged — depends on crypto + transport, **not** daemon |
| crypto / protocol-types / transport / gateway | 0.0.38 / 0.0.40 / 0.0.42 / 0.0.23 | untouched |

Verified against the **binary**, not the CI status — `npm pack @cello-protocol/daemon@0.0.115`,
`grep dist/`:

- `getDeliveryBookmark` → `dist/daemon.js`, `dist/session-content-handlers.js` ✅ (F1)
- `content_undeliverable` → `dist/session-content-handlers.js`, `dist/session-node-manager.js` ✅ (F2)
- `findNextReceivedAfter` → both ✅ (F5)
- cross-pin `cli@0.0.118 → daemon@0.0.115`, a real version, never `workspace:*` ✅

**The cascade published earlier tonight (daemon 0.0.114 / cli 0.0.117) is superseded and must not be
promoted** — it carries the redelivery loop, which would break the very two-session journey the
promotion exists to enable.

### ⏳ OWED TO ANDRE — the promotion (operator-run, always)

```bash
npm dist-tag add @cello-protocol/cli@0.0.118 latest
npm dist-tag add @cello-protocol/daemon@0.0.115 latest
npm dist-tag add @cello-protocol/connect@0.0.115 latest
npm dist-tag add @cello-protocol/gateway@0.0.23 latest
npm dist-tag add @cello-protocol/crypto@0.0.38 latest
npm dist-tag add @cello-protocol/protocol-types@0.0.40 latest
npm dist-tag add @cello-protocol/transport@0.0.42 latest
```

The last four are already on `latest` and will print a harmless *"latest is already set"* — they are
listed so the whole graph is promoted as one consistent set rather than from memory. The `+latest:
@cello-protocol/<pkg>@<ver>` line is the authoritative confirmation, not the verify loop (the npm CDN
lags 1–2 min).

Then, to pick it up locally — **`--prefer-online` is not optional**, because `@latest` resolves from
the packument cached on *this* machine and a fresh promotion is invisible to it:

```bash
npm i -g --prefer-online @cello-protocol/cli@latest @cello-protocol/connect@latest
cello logout && cello login          # CLI lifecycle — never pkill, that kills the live agents
node -p "require('$(npm prefix -g)/lib/node_modules/@cello-protocol/cli/package.json').version"   # must print 0.0.118
```

Then `/mcp` (or restart Claude Code) to reconnect the shim. That unblocks **AC7 / VISIBLE-1 AC6** —
the live two-session `claude --channels` journey, the last thing standing between Tier 0 + Tier 1 and
a ✅ instead of a 🟡.

### 2026-08-02 — Entry 20: SENDWINDOW + CATCHUP, landed together — and Entry 17's framing was wrong

Entry 17 deferred these and framed SENDWINDOW as *"tighten the gate so B cannot send while behind a
sibling's send."* **Reading the actual DoD line showed that is not what it asks for**, and the gate's
own comment says the opposite in as many words:

> "a message this agent SENT from a different local connection does not block. Two attended windows
> on one agent do not gate each other… **This is deliberate; do not 'fix' it.**"

The real defect is a **TOCTOU race**, not a steady-state bar (AC5 says it plainly: *"two connections
both pass the gate, both proceed through a stalled screening await; exactly one append occurs"*).
Both callers are **legitimately** caught up when checked — that is the whole point. Then both wait,
and nothing changes between them *precisely because* no leaf has been appended yet.

Reproduced deterministically by holding the first send inside `screenOutbound` (the passthrough
resolves in the same microtask, so under it the race is unobservable and a test built on it would
pass against the broken build). Before: **two replies committed, two leaves**. After: one.

### The AC1 deviation, taken deliberately

AC1 asks for the re-check *"in the same synchronous window as `appendSessionLeaf`"*. Inbound that is
exactly right — the append **is** the commit point. **Outbound it is not:** `sendContent` puts the
message on the wire and runs *before* the append. Refusing at the append would leave the counterparty
holding content this side never leafed — frontiers disagree, neither will co-sign, unsealable except
by forfeiting the receipt. That is `DOD-FRONTIER-STRAND-1`, *the defect that stranded `dbb93dfc…` for
a week*, manufactured on purpose to satisfy the letter of an AC. So the re-check sits immediately
before the wire, and the no-await comment lives there.

**AC3 honored rather than sidestepped.** The re-check is a *frontier comparison*, not a re-run of the
gate — because the gate's second authority is the **agent-scoped** watermark, so the instant any
connection reads, `unreadReceived === 0` for all of them and a re-run would wave the racing sibling
through exactly as it waved the first. It asks what that authority cannot: *did the session move
under me while I was gone?*

### CATCHUP needed no production code, and that is the finding

`cello_get_transcript` already **is** the both-directions door, and both refusals — the existing gate
and the new `session_moved_under_send` — already point at it, which is the strongest argument for
this door over widening `cello_receive` (post-Tier-1 that would make *receive* return **the agent's
own sent messages**: a different verb wearing the same name). **K2 is what keeps the line honest** —
it proves `cello_receive` delivers the counterparty's message and *still* cannot move the cursor past
the sibling's sent leaf. Without it, K1 would pass on a build where both doors worked and prove
nothing about the choice.

### Two measurement corrections

**K1 expected cursor 1 and got 2.** Rather than theorise I dumped the transcript, and there was a
third leaf: `{sequence: 2, direction: "sent", text: "Dispatched."}` — the **M8C-AWAY-1 auto-reply**,
fired because the test ingested into an *unattended* agent. Not a bug; my setup summoned a subsystem
the clause is not about. The clauses now attach before seeding.

**S2 asserted `/cello_transcript/` and failed against guidance reading `cello transcript`.** Guidance
is rewritten per surface at the IPC boundary, so the assertion was pinning the *tool surface* instead
of the *advice*. Matching both forms is the correct assertion — and it incidentally confirms the
CATCHUP door renders correctly on the CLI surface too.

Revert probe: disable the frontier comparison → **S1 and S2 go red**. Gate: **2450 passed / 11
skipped**, lint, typecheck, build — by exit code.

**Not yet published.** These are on `main` but not on npm; the next cascade picks them up. The
promotion commands in Entry 19 are for daemon 0.0.115 / cli 0.0.118 and remain correct for what is
published now.

### 2026-08-02 — Entry 21: second cascade published — THIS is the promotion set (supersedes Entry 19)

`v0.0.176` green end to end, **smoke-tag ✅**. Verified against the tarball, not the CI status:
`frontier_moved_during_send` and `session_moved_under_send` both present in
`package/dist/session-content-handlers.js`; cross-pin `cli@0.0.119 → daemon@0.0.116`, a real version.

| package | promote to | carries |
|---|---|---|
| **cli** | **0.0.119** | pins the daemon below |
| **daemon** | **0.0.116** | Tier 1 + all COATTEND-1 review fixes + SENDWINDOW + CATCHUP |
| connect | 0.0.115 | unchanged (depends on crypto + transport, not daemon) |
| gateway / crypto / protocol-types / transport | 0.0.23 / 0.0.38 / 0.0.40 / 0.0.42 | unchanged |

**Entry 19's command block is now stale — use THIS one.** Two cascades went out overnight; only the
newest matters, and promoting the older would reintroduce the redelivery loop.

```bash
npm dist-tag add @cello-protocol/cli@0.0.119 latest
npm dist-tag add @cello-protocol/daemon@0.0.116 latest
npm dist-tag add @cello-protocol/connect@0.0.115 latest
npm dist-tag add @cello-protocol/gateway@0.0.23 latest
npm dist-tag add @cello-protocol/crypto@0.0.38 latest
npm dist-tag add @cello-protocol/protocol-types@0.0.40 latest
npm dist-tag add @cello-protocol/transport@0.0.42 latest
```

The last five are already on `latest` and will print a harmless *"latest is already set"* — listed so
the whole graph is promoted as one consistent set. The `+latest: …` line is the authoritative
confirmation; the verify loop lags the CDN by a minute or two.

Then, locally — **`--prefer-online` is not optional**, `@latest` resolves from this machine's cached
packument and a fresh promotion is invisible to it:

```bash
npm i -g --prefer-online @cello-protocol/cli@latest @cello-protocol/connect@latest
cello logout && cello login          # CLI lifecycle — never pkill, that kills the live agents
node -p "require('$(npm prefix -g)/lib/node_modules/@cello-protocol/cli/package.json').version"   # 0.0.119
```

Then `/mcp` (or restart Claude Code).

### What that unblocks — the only thing left on Tier 0 + Tier 1

The live **two-session `claude --channels` journey**: `DOD-COATTEND-1` AC7 and
`DOD-COATTEND-VISIBLE-1` AC6, plus the first live exercise of SENDWINDOW/CATCHUP. Four lines are
🟡 BUILT/UNVERIFIED-LIVE purely for want of it — every one is green on a real daemon over real IPC
with a revert probe behind it, but **vitest green ≠ done** is this project's rule and it holds here.

### 2026-08-02 — Entry 22: the live journey, written out — so it is a copy-paste, not a design exercise

Four lines are 🟡 for one reason: nobody has run two sessions on one agent for real. That is an
operator-only step, so the least useful thing I can do is describe it again — this is the actual
script, with **what counts as a pass stated in advance** so the result cannot be rationalised
afterwards.

**Prerequisite:** the promotion in Entry 21, then `cello logout && cello login`, then `/mcp`.
`cello -v` must read **0.0.119** *on disk* before starting — a promotion that did not propagate looks
exactly like one that did.

#### Setup — two windows, ONE agent

```bash
# Terminal 1
claude --channels
# Terminal 2 (same machine, same agent)
claude --channels
```

In **both**: `cello_use_agent <your-agent>`. Selecting is not optional — an unselected connection
routes no doorbells, and an empty inbox then looks like a protocol bug.

Have a counterparty agent ready to send (a second identity, or the demo agent).

#### J1 — `DOD-COATTEND-1` AC7 · both sessions see the counterparty's message

Counterparty sends **one** message. In **each** window: `cello_receive`.

- ✅ **PASS** — both windows return the **same** message with the **same** `sequence_number`.
- ❌ **FAIL** — one window returns it and the other reports nothing arrived. That is the original
  defect, and it means the published daemon is not the one running.

#### J2 — `DOD-COATTEND-VISIBLE-1` AC6 · the second session reports being un-alone *in its own words*

The AC is deliberately about the model's own account, not a field: read what Claude says in window 2
after `cello_status` / on delivery.

- ✅ **PASS** — it mentions another session is attending (attendance ≥ 2) without being asked to.
- ❌ **FAIL** — it describes the session as if it were alone. The count is being carried but not
  surfaced legibly, which is the Tier-0 defect one layer up.

#### J3 — `DOD-COATTEND-SENDWINDOW-1` · two sessions cannot both answer

Counterparty sends **one** question. Both windows read it. Then reply from **both windows as close to
simultaneously as you can** — this is the one step that needs a little hurry.

- ✅ **PASS** — one reply is sent; the other is refused with `session_moved_under_send`, naming
  `cello_transcript` and saying not to simply resend. **The counterparty receives ONE reply.**
- ⚠️ **INCONCLUSIVE** — both succeed *and the counterparty got two replies*. The race window is
  small; the unit test stages it deterministically by holding the gateway open, which no human can do
  by hand. Record it as inconclusive, **not** as a failure — and note the unit test is the stronger
  evidence here.
- ❌ **FAIL** — a reply vanishes with no refusal and no error. That is the defect wearing a different
  coat.

#### J4 — `DOD-COATTEND-CATCHUP-1` · a session behind a sibling's send can get back

From window 1 only, reply to the counterparty. Then in **window 2**, without receiving: `cello_send`.

- If refused: run `cello_transcript <session>` in window 2, then send again → ✅ **PASS** if it now
  goes through.
- If **not** refused: that is **expected and correct**, not a failure — two windows of one agent do
  not gate each other at gate time, deliberately (the principal is the agent, not the socket). Then
  confirm the door directly: `cello_transcript` in window 2 shows **window 1's sent message**, which
  `cello_receive` never will.

#### Recording the result

Whatever happens, paste the raw output into a journal entry and flip the four lines on the strength
of **that**, not on this plan. If a step fails, the failure is worth more than the tag — it is the
first live evidence any of this has had.

### 2026-08-02 — Entry 23: the reviewer caught the half of the race I closed and wrote up as whole

**F1, blocking, reproduced on a real daemon with two real IPC connections:** two `ok:true`, two
frames on the wire, two leaves.

My reasoning in Entry 20 had a hole, and it is worth naming precisely because the first half was
right:

> ✅ A send **cannot** be refused after `sendContent` — the counterparty already holds it, and
> refusing would strand the session with disagreeing frontiers.
> ❌ *"…therefore checking only before it is sufficient."*

**`sendContent` IS the last await, and the wider one** — relay submit, stream open, stream close, a
network round trip in production, against the gateway round trip my check covered. I closed the
narrower half of the window and wrote Entry 20 as though the race were closed. The DoD names *two*
awaits; I guarded one and said so as if it were both.

**The fix is a CLAIM, not another check.** A per-(agent, session) in-flight marker, taken in the same
synchronous window as the frontier comparison and released when the wire call settles. A sibling that
finds it held is refused **before its own wire call** — nothing is on the wire, nothing is stranded,
and the very argument that ruled out a post-wire refusal never applies. Releasing on settle is safe
because the continuation from `await` through `appendSessionLeaf` never yields; `finally`, so a throw
cannot wedge a session into permanent refusal.

### The test that agreed with me instead of checking

`StallingGateway` held only the **first** entrant, so S1/S2 exercised the *sequential* race while
their own docstring and AC5 both say *"both stall in screening"*. It passed, and it was measuring the
half the frontier comparison already handled. Now it holds N, and the two shapes are **separate
clauses pinning separate authorities** — concurrent → the claim, completed-sibling → the frontier
comparison — plus S4, the reviewer's wire-parked reproduction, which was red before this fix.

### F8 — and my first fix for it was too blunt

The `since_seq` path raw-vaulted the watermark to the highest received sequence, jumping anything
between. The jumped leaf can be a row that failed to decrypt: `readTranscript` drops it,
`getUnreadReceivedCount` counts it — so **a message nobody could read was marked read**, clearing the
gate's second authority.

I replaced it with the standard gap-safe walk and **M8C-SINCESEQ-1 S1/S2/S3 went red** — correctly.
`since_seq: N` is the caller **asserting it already holds through N**, so rows at or below N are its
claim, and seeding the walk at the stored watermark makes ordinary catch-up stop dead at the first
row the caller skipped. Seeded at `sinceSeq` instead: advances through the delivered run, stops at a
hole **inside** the batch, which is where the undecryptable row lives and is the whole of F8. The
suite corrected me; I did not talk it out of the failure.

### And a green run that was not green

`2454 passed | 0 failed` with **exit 1** — an unhandled rejection from my own S4, where a
deliberately abandoned send rejects at teardown. *Every test passing is not the same as a green run*,
which is the same lesson as reading past `ELIFECYCLE`, arriving from the other direction.

Also fixed: F3 (the refusal is **advisory** — a loser that retries without reading gets through,
deliberately, now stated in S5 rather than left for someone to discover in production), F4 (K1
asserted a number scraped off a refusal instead of the send succeeding), F5 (the CATCHUP clauses are
**characterization** — the line shipped no production code, so they cannot survive a revert; renamed
so they stop reading as proof of a change), F6, F7.

**⚠️ daemon `0.0.116` / cli `0.0.119` PREDATE this fix** and carry the open wire window. Entry 21's
promotion block is stale; the next cascade supersedes it.

### 2026-08-02 — Entry 24: 🟢 THE PROMOTION SET — daemon 0.0.117 / cli 0.0.120 (supersedes Entries 19 and 21)

`v0.0.177` green end to end, **smoke-tag ✅**. Verified in the tarball: `sendInFlight` and
`sibling_send_in_flight` both in `package/dist/session-content-handlers.js`; cross-pin
`cli@0.0.120 → daemon@0.0.117`.

**Three cascades went out overnight. Only this one is correct.** `0.0.114` carried the redelivery
loop; `0.0.116` carried the open `sendContent` window. Promoting either would ship a known defect
into the journey it exists to prove.

```bash
npm dist-tag add @cello-protocol/cli@0.0.120 latest
npm dist-tag add @cello-protocol/daemon@0.0.117 latest
npm dist-tag add @cello-protocol/connect@0.0.115 latest
npm dist-tag add @cello-protocol/gateway@0.0.23 latest
npm dist-tag add @cello-protocol/crypto@0.0.38 latest
npm dist-tag add @cello-protocol/protocol-types@0.0.40 latest
npm dist-tag add @cello-protocol/transport@0.0.42 latest
```

The last five are already on `latest` (harmless *"already set"* warning) — listed so the graph is
promoted as one consistent set. The `+latest: …` line is the confirmation, not the verify loop.

```bash
npm i -g --prefer-online @cello-protocol/cli@latest @cello-protocol/connect@latest
cello logout && cello login          # CLI lifecycle — never pkill
node -p "require('$(npm prefix -g)/lib/node_modules/@cello-protocol/cli/package.json').version"   # 0.0.120
```

Then `/mcp`, then the runbook in **Entry 22**.

### State of the milestone

| line | status |
|---|---|
| `DOD-RECEPTIONIST-AGENT-1` | ✅ PROVEN |
| `DOD-INBOX-AGENT-1` | ✅ PROVEN |
| `DOD-COATTEND-VISIBLE-1` | 🟡 built + reviewed · AC6 live owed |
| `DOD-COATTEND-1` | 🟡 built + **reviewed twice** (blocking findings fixed) · AC7 live owed |
| `DOD-COATTEND-CATCHUP-1` | 🟡 built + reviewed · live owed |
| `DOD-COATTEND-SENDWINDOW-1` | 🟡 built + reviewed (blocking F1 fixed) · live owed |

All six built, gated (**2454 passed / 11 skipped, exit 0**), reviewed, published, verified in the
binary. Every 🟡 is waiting on the same two operator-only steps and nothing else.

**Both blocking review findings this milestone were the same mistake in different clothes:** a fix
verified against the layer it was written at rather than the layer that runs. Tier 1 reused the
gate's cursor because both are "a per-connection sequence number"; the send window guarded the
gateway await because that is the one the test could stall. Neither was caught by a green suite —
both were caught by an adversarial reader who reproduced them by execution.

### 2026-08-02 — Entry 25: review pass 2 — I made the SAME mistake a third time, one file over

The claim itself came back sound (all five questions answered by reading every line and by
execution: same synchronous window ✅, release-before-append genuinely safe ✅ — *"not theatre"* —
factory scope correct ✅, no leak ✅, no wrong refusals ✅).

**H1 was in the other half of the commit, and it is the same mistake as F1, made a third time.**

My `since_seq` watermark walk was contiguous over the **received-only** batch, and the comment I
wrote reasoned about undecryptable rows. But leaf indices are contiguous across **both** directions,
so a **SENT** leaf — this agent's own reply, or a sibling's — is a hole in any received-only set. The
walk therefore stopped on the most ordinary event in the protocol:

| shape | after reading everything |
|---|---|
| sent, received | still **1 unread** |
| received, sibling-sent, received *(the M8D shape)* | still **1 unread** |

So **reading everything stopped clearing unread**: the badge could not be cleared, and a stateless
CLI caller — fresh connection per command, so the cursor authority can never help it — was **refused
forever through the very door the guidance points at**. That is CATCHUP §3b's own defect (*a rule
satisfiable only through a door the caller is not pointed at*) rebuilt on the watermark.

`daemon.ts` says *"every sibling send is a hole"* **in as many words**, one file over — in the comment
**I wrote** for the delivery bookmark. I fixed it for delivery and reintroduced it for the watermark
inside the same milestone. Third occurrence, so it goes in the write-up as its own rule.

Also: **H2 — my F7 fix was a dead ternary.** Reaching that branch means BOTH authorities said no (the
gate passes if *either* is satisfied), so `connectionCursor < currentSeq` is always true there and the
label could only print `unread_watermark`. Filtering for `connection_cursor` would return zero hits
forever — *the exact defect F7 was raised to fix*. **H3 — the claim had no expiry**; `finally` covers
throw and reject, not a promise that never settles, so one hung stream would have refused every
sibling send on that conversation until daemon restart. A duplicate reply traded for a dead
conversation is the wrong way round. **L5 — F6 and F7 had no assertions**; both now pinned, and the
F6 revert probe goes red.

Gate: **2456 passed / 11 skipped, exit 0**.

### Spine: j-content is 3/10, and it is NOT ours — established by controlled comparison

Ran `j-content` against the daemon build **before** the M8D review fixes and **after** them: the
**identical 7 failures**, same set, both times. So they are pre-existing spine rot, not M8D
regressions — worth stating because the first failure I read looked exactly like our defect
(*"B reads the exact parked plaintext it had missed: expected `msg1-online` to be `msg2-…`"*, which is
the redelivery-loop shape) and attributing it without the second run would have been wrong twice
over.

Two causes are already identifiable from the output:
- **`Tool cello_get_sealed_receipt not found`** — the MCP tool is `cello_sealed_receipt`. Rename rot;
  the spine still calls the old name.
- **`expected 'first [[OVER]]' to be 'first'`** — assertions written before turn-signals were
  appended to content.

The rest (parked-message auto-recover reporting `recovered:0`, the ACK-ladder timeout, the dedup
timeout) need real diagnosis and are **M8C `DOD-MSG-*` territory, not M8D**. Parked as its own line
rather than pulled into this milestone — but flagged clearly, because parked-message delivery *is*
core launch value and 7/10 red on it is not a documentation problem.

### 2026-08-02 — Entry 26: 🟢 THE PROMOTION SET — daemon 0.0.118 / cli 0.0.121

`v0.0.178` green, **smoke-tag ✅**. Verified in the tarball: `presentSeqs` (H1's both-directions
walk), `cursor_and_watermark` (H2), `SEND_CLAIM_TTL_MS` + `claimHeldMs` (H3). Cross-pin
`cli@0.0.121 → daemon@0.0.118`.

**This supersedes Entries 19, 21 and 24. Four cascades went out; promote only this one.**

| version | why NOT to promote it |
|---|---|
| daemon 0.0.114 | the redelivery loop (COATTEND-1 F1) |
| daemon 0.0.115 | the `sendContent` wire window was still open |
| daemon 0.0.116 | same |
| daemon 0.0.117 | H1 — reading everything stopped clearing unread |
| **daemon 0.0.118** | ✅ **this one** |

That the set has been rewritten four times in one night is the point, not an embarrassment: each
rewrite is a defect an adversarial reader found *after* the suite was green, and every one of them
would have shipped into the live journey the promotion exists to enable. **The final one is the only
one worth your `npm dist-tag` keystrokes.**

```bash
npm dist-tag add @cello-protocol/cli@0.0.121 latest
npm dist-tag add @cello-protocol/daemon@0.0.118 latest
npm dist-tag add @cello-protocol/connect@0.0.115 latest
npm dist-tag add @cello-protocol/gateway@0.0.23 latest
npm dist-tag add @cello-protocol/crypto@0.0.38 latest
npm dist-tag add @cello-protocol/protocol-types@0.0.40 latest
npm dist-tag add @cello-protocol/transport@0.0.42 latest
```

```bash
npm i -g --prefer-online @cello-protocol/cli@latest @cello-protocol/connect@latest
cello logout && cello login          # CLI lifecycle — never pkill
node -p "require('$(npm prefix -g)/lib/node_modules/@cello-protocol/cli/package.json').version"   # 0.0.121
```

Then `/mcp`, then the runbook in **Entry 22**.

### Milestone state

All six lines built, gated (**2456 passed / 11 skipped, exit 0**), published and verified in the
binary. `DOD-COATTEND-1` reviewed once, `SENDWINDOW`/`CATCHUP` reviewed **twice** (the two-pass cap).
Four lines sit at 🟡 awaiting only the promotion and the live journey — both operator-only.

**Every blocking finding this milestone came from an adversarial reader, never from a green suite.**
Three of them were literally the same mistake — a walk over a received-only view, which has holes
wherever the agent sent something — and the third was introduced one file away from the comment
warning about it.

### 2026-08-02 — Entry 27: the spine had a clause pinning the bug M8D exists to fix — and Entry 25 was wrong

**Correcting myself first.** Entry 25 said j-content's failures were "not ours", on a controlled
comparison of the daemon build *before* and *after* the M8D **review fixes**. That comparison was
real but could not answer the question: **Tier 1 was present in both builds.** The experiment that
could was building at the commit *before* `73bda73` — and it changed the answer.

### The finding

`DOD-MSG-3/4 (recover)` expected B, after a daemon restart, to read the **parked** message first.
Pre-Tier-1, that is exactly what happened — and `msg1`, which B had received live but never read
through a client, was **never readable at all**. Delivery was a destructive in-memory queue: the
restart emptied it, and the row sat in the transcript unreachable through `cello_receive` forever.

**The spine was asserting the content loss `DOD-COATTEND-1` AC3 exists to end.**

Post-Tier-1 B reads the unread `msg1`, then the parked `msg2`. Nothing skipped, nothing lost. The
clause now asserts both, in order, with the archaeology attached.

That makes it **the first live multi-process evidence for AC3** — real Postgres, real directory, real
relay, two real daemon binaries, a real restart. No unit test can produce that, and the milestone had
none of it. It does not close AC7 (that is the in-context `claude --channels` journey and still needs
Andre), but it is a strictly stronger class of proof than the fixture for the property it covers.

### The other two causes, separated by measurement

- **Rename rot, two-part.** The MCP tool is `cello_sealed_receipt` taking `cello_session_id`; the IPC
  method behind it is still `cello_get_sealed_receipt` taking `session_id`. Four spine files called
  the IPC name, with the IPC param, over the MCP surface. The **audit-what-ships** class again: the
  daemon-side name never changed, so nothing daemon-side could have caught it.
- **In-band signals.** The shim appends the turn token to the content (`${content} ${token}`), so a
  receiver reads `"first [[OVER]]"`. Assertions predating that compared the bare payload and failed
  on a correct build.

**j-content: 3/10 → 5/10.** The five that remain (MSG-7, MSG-5 dedup, MSG-1 ACK ladder, MSG-4
auto-recover, MSG-8 straggler) also fail pre-Tier-1, so they are genuine M8C `DOD-MSG-*` debt and
stay parked under `DOD-SPINE-JCONTENT-1`.

### The lesson worth keeping

**A controlled comparison is only as good as what it holds constant.** Mine held Tier 1 constant
while asking whether Tier 1 was responsible, and produced a confident, wrong answer that I wrote into
the journal. The tell was available: the failure I dismissed (*"B reads the exact parked plaintext it
had missed"*) is the co-attendance shape, and I noted that it *looked* like our defect — then
explained the resemblance away instead of testing it.

### 2026-08-02 — Entry 28: the "nine files never run" debt was one setup gap and three renames

Four spine files recovered tonight, none of which needed a product change:

| file | before | after | what it proves live |
|---|---|---|---|
| `j-unilateral` | 0/3 | **3/3** | unilateral seal → real FROST notarization with the counterparty ABSENT, + both halves of the ABSENT gate |
| `j-leg-frontier` | 0/1 | **1/1** | a directory-inflated `content_frontier_seq` is re-derived, detected and rejected (SI-002) |
| `j-persist` | 0/1 | **1/1** | the durable encrypted transcript survives a daemon restart (DOD-LOG-1) |
| `j-content` | 3/10 | **5/10** | relay store-and-forward + the recover journey |
| `j-legibility` | 0/1 | 0/1 *(reaches its real subject — left red on purpose)* | — |

**`j-persist` is the one that matters for M8D.** Since Tier 1 the durable transcript **is** the
delivery path, so *"B reads the full transcript back after a restart"* stopped being a logging
nicety and became the co-attendance guarantee. It is now proven live, cross-process, with a real
kill and restart.

### What the debt actually was

Not nine investigations. **One setup gap and three renames**, layered so each hid the next:

1. **No consortium.** Two halves: a signed **directory-side** manifest (without it the daemon never
   learns its own node id → two local agents route cross-node → `discovery_node_unresolvable`
   before any clause runs) **and** a **client-side** `CELLO_CONSORTIUM_MANIFEST` per daemon (without
   it registration's FROST DKG has no consortium → `register-agent` exits 1). `directoryCount: 3`,
   because one node cannot satisfy the threshold.
2. **MCP/IPC rename drift.** `cello_sealed_receipt` and `cello_transcript` are the MCP tools, taking
   `cello_session_id`; `cello_get_sealed_receipt` / `cello_get_transcript` taking `session_id` are
   the IPC methods behind them. The spine called the IPC names over the MCP surface. **The
   daemon-side name never changed, so nothing daemon-side could have caught it** — the
   audit-what-ships class, twice.
3. **In-band turn signals.** The shim appends `[[OVER]]` to the content itself, so durable rows hold
   it and *must* — the transcript has to round-trip what went on the wire or the certificate and the
   readable history disagree. Assertions predating that compared bare payloads.
4. **`agent_name` → `agent_id`.** A direct-SQL check queried `session_tree_leaves WHERE agent_name`,
   a column that no longer exists there (`REMOVE-001`). Now resolves the id through `agents` — the
   project rule: **join on the stable key, never the mutable label.**

### Two things I got wrong, both caught by the tests rather than by me

- I wrote the client manifest into `CELLO_DIR`, and `j-persist` asserts **DOD-STORE-1** — no
  flat-file state there, because everything belongs in the encrypted store. The invariant is right,
  so the scaffolding moved rather than the assertion being relaxed.
- `j-legibility` is **left red on purpose.** Its `"…"` (U+2026) tail arrives as `"..."`. NFKC in the
  gateway sanitizer folds it — but neither the outbound nor the inbound path substitutes text on an
  `allow` verdict, so the delivered text changed **because the gateway returned a `redact` verdict**
  for a money-demand tail. That is a product decision, and it changes the test's premise (the point
  is that B receives the malicious tail verbatim). Patching the assertion would bake in whichever
  reading is wrong.

**Ten files still carry the same setup gap** (`j-spine`, `j-suspend`, `j-int`, `j-sig`, `j-remove`,
`j-track-record`, `j-trust-journey`, `j-upgrade`, `j-upgrade-bilateral`, `j-canary`). The pattern is
now proven on four; applying it is mechanical, and **should be done before anyone budgets diagnosis
time for them.**

### 2026-08-02 — Entry 29: the spine tally, and the one question left underneath it

Nine files touched. **Six are fully green that were fully red**, and every one is a live
multi-process journey against real binaries, real Postgres, three real directory nodes and a real
relay:

| file | before | after | what it proves live |
|---|---|---|---|
| `j-unilateral` | 0/3 | **3/3** | unilateral seal → FROST notarization with the counterparty ABSENT |
| `j-int` | 0/3 | **3/3** | mid-session daemon kill → interrupted + surfaced at login; both parties interrupted → bilateral seal-interrupted agreement; retry queue FIFO + nonce dedup survive restart |
| `j-sig` | 0/2 | **2/2** | directory gone → bounded degradation with guidance; returns → re-auth with no resume token |
| `j-persist` | 0/1 | **1/1** | the durable encrypted transcript survives a daemon restart |
| `j-leg-frontier` | 0/1 | **1/1** | a directory-inflated frontier is re-derived, detected, rejected |
| `j-upgrade` | 0/1 | **1/1** | B's agent never closes → B's daemon auto-co-signs → BILATERAL seal |
| `j-spine` | 0/7 | 3/7 | SessionAssignment, send/receive, bilateral seal → byte-identical `sealed_root` |
| `j-content` | 3/10 | 5/10 | relay store-and-forward + recover |
| `j-remove` | 0/3 | 1/3 | secondary-agent removal drops its signaling |

**None of it needed a product change.** It was one setup gap (the two-part consortium), three
MCP/IPC renames, in-band turn signals, and `agent_name` → `agent_id`.

### The one question left, which is FOUR failures with ONE shape

`j-spine` SPINE-4, `j-remove`, `j-suspend` AC-001 and `j-upgrade-bilateral` all register
**successfully** and then find the directory-side row missing or uncounted:

> *"X must have a directory-assigned agent_id"* → `""` · *"agent_profiles never settled to 2 rows"* ·
> *"directory must hold exactly one unilateral notarization for R1"*

Every one queries `cluster.directory` — **node 0 of three**. The obvious reading is that the row
lands on whichever node served the registration while the query looks at node 0, with anti-entropy
either not yet converged or not replicating that table. **That is a real question about consortium
behaviour and it is a unit of its own** — guessing at it from a test file is the rabbit hole
`.claude/CLAUDE.md` names. Grouped here so it gets investigated once rather than four times.

### Two traps in this work worth keeping

**Converting a single-directory test to a consortium can silently destroy its premise.** `j-sig`
kills the directory and asserts degradation — with three nodes, `cluster.directory.stop()` stops
node 0 and leaves two serving, so the daemon never degrades and the clause **asserts nothing while
looking green**. Worse than a red test. It now stops all of `cluster.directories`. The same
reasoning is why `j-track-record` and `j-trust-journey` were deliberately **not** converted: they
use the single-node AUTH path on purpose.

**A batch rewrite that misses a call shape produces failures that look like product defects.**
`j-upgrade*` pass `startDaemon(dir, url, label, { extraEnv })`; the rewrite only matched calls that
closed after the label, so those daemons silently kept no manifest and registration died with exit
1 — indistinguishable, from the test output, from a DKG bug. The helper now merges `extraEnv` so
options travel *through* the wiring rather than bypassing it.

### 2026-08-02 — Entry 30: ✅ PROMOTED — Andre ran it; verified against the running binary

`+latest:` confirmed for **cli 0.0.121** and **daemon 0.0.118**; the other five printed the harmless
*"latest is already set"*, exactly as Entry 26 predicted. Reinstalled with `--prefer-online`,
`cello logout && cello login`, daemon back up with 2 agents (`CELLO_Coder_1`, `Miss_Chelly`).

Verified where it counts — **on disk and in the running daemon**, not from the install's output:

| check | result |
|---|---|
| `cello -v` | **0.0.121** |
| daemon under the cli | **0.0.118** |
| `getDeliveryBookmark` | ✅ the redelivery loop is fixed in the binary that is running |
| `sendInFlight` | ✅ the `sendContent` wire window is closed |
| `presentSeqs` | ✅ the watermark walk covers both directions |
| `cursor_and_watermark` | ✅ the gate names its authority |

**One human-only step remains: `/mcp` (or restart Claude Code), then the live journey.** The script,
with pass/fail fixed in advance, is **Entry 22** — J1 (both sessions receive), J2 (the second session
reports being un-alone in its own words), J3 (two sessions cannot both answer), J4 (a session behind
a sibling's send has a door).

Four lines — `DOD-COATTEND-1` AC7, `DOD-COATTEND-VISIBLE-1` AC6, `SENDWINDOW`, `CATCHUP` — are 🟡
purely for want of that run, and every one of them is now backed by the promoted binary.

### 2026-08-02 — Entry 31: ✅ J1 PASSED LIVE — one message, two sessions, both received it

Three real `claude --channels` windows on the promoted binary (cli 0.0.121 / daemon 0.0.118): two
attending **`CELLO_Coder_1`**, one driving **`Miss_Chelly`** as the counterparty. `cello_status`
reported **`attendance: 2`** on the attended agent before anything was sent.

`Miss_Chelly` sent **one** message. Both attending sessions called `cello_receive`:

| | session 1 (this one) | session 2 (separate window) |
|---|---|---|
| `ok` | true | true |
| `content` | `"J1 — one question, two sessions should both see this [[OVER]]"` | **identical** |
| `sequence_number` | **0** | **0** |
| `senderPubkey` | `6988436e…` | identical |

**Same message, same leaf, to both — and neither read removed it.** On the pre-M8D build the first
read drained the queue and the second returned `content: null` with the quiet-counterparty guidance,
which is the defect the whole milestone exists to end. Session 2 also confirmed it had called
`cello_send` **zero** times, so nothing but genuine delivery could have produced that output.

Also observed live, unprompted:

- **The doorbell is multicast and CONTENT-FREE.** It carried `attendance="2"`, the sender and the
  session id — and not one word of the message body. `DOD-INV-CONTENTFREE` holding on the real wire,
  not in a fixture.
- **The attendance count reached the session surface**, both on `cello_status` and on the push.

### What this closes, and what it does not

`DOD-COATTEND-1` **AC7 is met**: the live two-session journey on one agent, both sessions seeing the
counterparty's message. Tier 1's central claim is now proven live, cross-process, on the shipped
binary — not merely on the two-connection fixture.

**Stated precisely, because the difference matters:** `DOD-COATTEND-VISIBLE-1` AC6 asks that the
second session *"reports being un-alone in its own words."* The attendance count was **delivered** to
it (`attendance="2"` on the doorbell, and the guidance text names it), but session 2 was running to a
scripted instruction and did not volunteer it. So the **plumbing** is proven and the **legibility**
clause is not yet witnessed. AC6 stays open rather than being claimed on adjacent evidence.

### A defect this run surfaced in the guidance itself

The doorbell says:

> *"2 sessions are attending this agent, so another one may read it first — if cello_receive returns
> nothing, run cello_transcript."*

That warning is **obsolete on this build.** Delivery is non-destructive now: a sibling reading first
takes nothing away, and `cello_receive` returning nothing for that reason can no longer happen. The
text describes the Tier-0 world and would teach an operator to expect theft that has been fixed —
mild, but it is exactly the kind of stale instruction that outlives its cause. Raised as its own line.

### 2026-08-02 — Entry 32: the live journey is COMPLETE — three lines to ✅, one honestly left open

Three real `claude --channels` windows, promoted binary (cli 0.0.121 / daemon 0.0.118).

**J1 — both sessions receive the same message.** ✅ Identical `content`, identical
`sequence_number: 0`, on two separate windows attending one agent, and session 2 confirmed it had
called `cello_send` **zero** times. Neither read removed it. `DOD-COATTEND-1` **AC7 met**.

**J4 — the catch-up door.** ✅ Session 2's `cello_transcript`:

```
seq 0  received  "J1 — one question, two sessions should both see this [[OVER]]"
seq 1  sent      "J1 confirmed from session 1 of 2 …"      ← the OTHER session's reply
seq 2  sent      "second session replying too [[OVER]]"
```

Session 2 never received `seq 1` through `cello_receive` — it **cannot**, that path returns only the
counterparty's messages — and the transcript shows it anyway. That is `DOD-COATTEND-CATCHUP-1`'s
entire claim (M8D-D3: the door is `cello_get_transcript`), witnessed on real binaries rather than a
fixture.

**Two sequential replies to one question: DELIBERATE, not the defect.** The counterparty session
reported *"Two distinct replies to one question — that's the defect J3 exists to catch."* **It is
not**, and the mis-framing came from my own session-3 prompt. Session 2 had read the question and
was entitled to answer; two windows of one agent do not gate each other because the principal is the
agent, not the socket — a decision written into the gate in as many words. What `SENDWINDOW`
prevents is the **race**: both passing the check concurrently, each before either had written. That
is unhittable by hand, which is why the unit test stages it by freezing the security gateway
mid-send. **The correction matters more than the observation** — left alone it would have entered
the record as a live-confirmed defect that does not exist.

### Tags

| line | now | on what |
|---|---|---|
| `DOD-COATTEND-1` | **✅ PROVEN LIVE** | J1 above — AC7 met |
| `DOD-COATTEND-CATCHUP-1` | **✅ PROVEN LIVE** | J4 above |
| `DOD-COATTEND-SENDWINDOW-1` | **✅ PROVEN** | ACs met + reviewed twice; the race is unit-proven by construction (see below) |
| `DOD-COATTEND-VISIBLE-1` | **🟡 stays open** | AC6 not witnessed — see below |

**`SENDWINDOW` is ✅ on its own ACs, not on the journey.** AC5 is a *test* clause ("two connections
both pass the gate, both proceed through a stalled screening await"), and it is met, reviewed twice,
and revert-proven. The live run cannot add to it: no human can hit that window. Saying so plainly is
better than implying the journey confirmed it.

**`VISIBLE-1` AC6 stays 🟡, deliberately.** It asks that the second session *"reports being un-alone
in its own words."* The attendance count **reached** it — the doorbell carried `attendance="2"` and
named it in the guidance — but session 2 was following a scripted instruction and never volunteered
it. The plumbing is proven; the legibility clause is not. Claiming it on adjacent evidence is exactly
the "DONE means reviewed, not written" failure, so it stays open.

### 2026-08-02 — Entry 33: AC6 FAILED, and the failure is the useful result

Session 2 was asked an open question — *"in your own words, what is the state of this session, and
is there anything I should know before replying?"* — with no mention of co-attendance. Its answer,
quoted because it is the evidence:

> *"Co-attendance did not come up on its own. It only surfaced because I manually described it in
> the message content. Structurally, the transcript and the wire protocol are silent on it."*

And on what the counterparty sees:

> *"Chelly got two replies to one question, and nothing in the protocol marked that as unusual…
> `cello_send`, `cello_receive`, and `cello_transcript` carry no co-attendance marker — no session
> ordinal, no 'another window also has this open' flag, nothing."*

**`DOD-COATTEND-VISIBLE-1` AC6 does not pass.** Logged as a defect, not closed.

### The precise shape, because "it's not visible" is too coarse

Co-attendance **is** carried on the **push** — the doorbell says *"N sessions are attending this
agent"* and the tag carries `attendance="2"`, and `cello_status` reports it. What is silent is every
**read** surface: `cello_receive`'s response and `cello_transcript`'s rows carry no attendance field
at all. So a session that reads without having seen a doorbell — a fresh MCP connection, a `cello`
CLI invocation, any session that attached after the last arrival — has **no way to learn it is not
alone**. That is the gap, and it explains why session 2 answered as it did: it was reading, not
being pushed to.

Fixing it is a read-surface change (attendance on the receive/transcript responses), not a new
mechanism — the daemon already computes the number for the push.

### The counterparty-side observation is NOT the same thing, and is probably correct as-is

Session 2 also noted the counterparty sees two `over` replies from one identity with nothing marking
them as separate windows. That is **by design and should stay that way**: the counterparty deals with
**one agent**, and leaking session ordinals across the wire would expose the operator's internal
window structure to a third party for no protocol benefit. The confusion is real but the remedy is
turn discipline on the sending side, not a wire field. Recorded so nobody "fixes" it later by adding
a session ordinal to the protocol.

### On the run itself

Andre's criticism of how I orchestrated this is correct and worth keeping: I front-loaded three
prompts of instructions and then made the operator work out which step we were on, flipping between
tabs. **The right shape is one paste at a time, told to the orchestrator at the moment it is
needed**, with the sessions briefed on context but never given the sequence. The final AC6 probe was
run that way and it is the step that produced the only new information of the whole journey.

### 2026-08-02 — Entry 34: AC6's gap closed — attendance now rides the READ surfaces

The live finding (Entry 33) was that co-attendance reached the **push** and nothing else. Fixed at
the surfaces that were silent: `attendance` now rides **every** `cello_receive` exit — delivered
content *and* the quiet timeout — plus `cello_get_transcript`.

**The quiet exit is the one that mattered and the one easiest to skip.** It is the answer a session
with no doorbell to learn from is most likely to reach: it attached, found nothing waiting, and
would otherwise have no way to know another window holds the same agent. A fix that only tagged
delivered content would have left the defect alive in precisely its most common shape.

Two clauses exist to stop the field being decorative:

- **V4** — a **sole** session must read `1`, not absent and not `2`. Without it the suite passes on
  an implementation that hardcodes a number or reports the agent's total sessions.
- **V5** — the count must **fall** when a sibling detaches. A number that only rises tells a session
  it is co-attended long after it is alone — the same defect inverted, and the operator stops
  believing it.

**Deliberately NOT changed: the counterparty still sees one agent, with no session ordinal.** The
live session observed that Chelly cannot tell two replies came from two windows. That stays: the
counterparty deals with **one agent**, and putting a session ordinal on the wire would leak the
operator's window structure to a third party for no protocol benefit.

Also shipped alongside: the doorbell text, which was still warning of the theft this milestone
fixed (*"another one may read it first — if cello_receive returns nothing, run cello_transcript"*).
It now states delivery is non-destructive and points at `cello_transcript` for the reason the
journey actually demonstrated — a sibling's **replies** never appear in `cello_receive`.

### A probe that lied, and nearly got reported

The first revert probe turned **2 of 5** red and I was a sentence away from writing "mostly
load-bearing". It was the probe's `sed` missing three insertion sites, not the clauses being weak.
Redone with an exact removal: **5 of 5 red**. *A revert test that under-reports is worse than none —
it launders a weak clause as a checked one.* The tell was that the number was odd: a coherent fix
either covers a surface or does not, so "some clauses survive" should have prompted a second look
before a conclusion.

Gate: **2461 passed / 11 skipped**, lint, typecheck, build — by exit code.

**Not yet reviewed** (dispatched) and **not yet published** — `connect` and `daemon` have both moved
and neither is on npm, so a further promotion is owed once the review lands. Deliberately batching
those so the promotion happens once rather than twice.

### 2026-08-02 — Entry 35: CORRECTION — Entry 34 overclaimed, and the review proved it

**Entry 34 said "`attendance` now rides EVERY `cello_receive` exit". That was false.** It covered 4
of 12, and I wrote the same false claim in three places: the code comment, the commit body, and the
journal. That is the part worth keeping — *a reader trusting any of the three would never have gone
looking for the gap.* The claim was more damaging than the omission.

Three blocking findings, all correct, all fixed:

**F1 — five exits omitted it, and the worst was `since_seq`.** That branch **is** the
stateless-client door this unit's own rationale invokes: `cello receive <id> --since-seq -1` is a
fresh connection every time, so it never saw a doorbell — and the `session_not_live` refusal points
callers there **by name**. The guidance was sending sessions to the one read exit still silent. Also
covered now: `session_not_live`, the sealed/terminal answer, and `content_undeliverable`. The last
two already **logged** attendance while not returning it — the asymmetry sat on the surface the
operator actually reads.

**F2 — `attendance: 0`, which is affirmatively wrong rather than merely missing.**
`countAttendance` walks connections that explicitly called `cello_use_agent`, but a connection
reaches these handlers without that, through `resolveCurrentAgent`'s sole-online fallback — **every**
`cello` CLI invocation with no persisted selection. Such a reader was not counted *including
itself*, and was told **zero** sessions attend the agent it is reading. The caller is holding the
response, so at least one session is on that agent by construction: **a response can never honestly
say 0.** One helper floors it at 1 for every response; log contexts keep the raw count.

Reproduced before fixing rather than argued: V7 stands an agent up, drops the connection that
started it (the daemon keeps agents running — the CLI's ordinary state), then reads from a fresh
connection. Pre-fix it returns `+0`.

**F3 — all five original clauses were HOLLOW on the field's actual meaning.** Replace the predicate
with "count every connection regardless of agent" and V1–V5 stayed green **and so did the entire
daemon package**. Nothing in the repo pinned agent-scoping. On the first-wedge setup — one window
per agent, which is how this product is used daily — that implementation tells **both** windows they
are co-attended by a session attending something else. V8 goes red on exactly that bypass.

### The pattern, now three units deep

Every blocking finding this milestone has been the same failure with different clothes: **a fix
verified against the layer it was written at, and then described as broader than it was.** Tier 1
reused the gate's cursor; the send window guarded the narrower await; this one covered a third of
the exits and said "every". The tests were real each time — the *claim* was not.

Gate: **2464 passed / 11 skipped**, lint, typecheck, build.

**AC6 does NOT flip on this.** Its text asks for a live journey in which the second session reports
being un-alone **in its own words**. Five vitest clauses are not that. This is the enabling fix; the
live re-run closes it, and that needs a publish first.

### 2026-08-02 — Entry 36: 🟢 PUBLISHED — daemon 0.0.119 / cli 0.0.122 / connect 0.0.116

`v0.0.179` green, **smoke-tag ✅**. Verified in the tarballs:

| package | check | result |
|---|---|---|
| **daemon 0.0.119** | `attendingNow` (the never-zero floor) | 8 sites ✅ |
| | the `since_seq` catch-up exit carries attendance | ✅ |
| **connect 0.0.116** | new doorbell wording present | ✅ |
| **cli 0.0.122** | cross-pin → `daemon@0.0.119` | ✅ real version |

**A grep that nearly lied.** `grep -c "may read it first"` on the shipped `connect` returned **1**,
which reads as *"the retired phrase is still live"*. It is line **69 — my own archaeology comment
quoting the old text** — while the live template on line **81** carries the new wording. `tsc`
preserves comments, so a bare count over a built artifact cannot tell a shipped string from a
comment about a shipped string. Checked with line context rather than a count, which is the same
lesson as the tool-registration guard two entries back: **assert the SHAPE, not the substring.**

### ⏳ OWED — the promotion (operator-run). Supersedes Entry 26.

```bash
npm dist-tag add @cello-protocol/cli@0.0.122 latest
npm dist-tag add @cello-protocol/daemon@0.0.119 latest
npm dist-tag add @cello-protocol/connect@0.0.116 latest
npm dist-tag add @cello-protocol/gateway@0.0.23 latest
npm dist-tag add @cello-protocol/crypto@0.0.38 latest
npm dist-tag add @cello-protocol/protocol-types@0.0.40 latest
npm dist-tag add @cello-protocol/transport@0.0.42 latest
```

```bash
npm i -g --prefer-online @cello-protocol/cli@latest @cello-protocol/connect@latest
cello logout && cello login
node -p "require('$(npm prefix -g)/lib/node_modules/@cello-protocol/cli/package.json').version"   # 0.0.122
```

Then `/mcp`.

### The AC6 re-run — ONE question, and it must not be scripted

AC6 asks that the second session reports being un-alone **in its own words**. The way to get that
wrong is to tell the session what to say; the way to get it right is to ask something open and see
whether co-attendance surfaces on its own. So: two windows on one agent, then into the second one —

> *"In your own words: what is the current state of this CELLO session, and is there anything I
> should know about it before I reply?"*

**Pass** = it mentions another session is attending, unprompted. **Fail** = it does not, and that is
a finding about legibility rather than plumbing, because the number is now demonstrably on every
read surface it could look at.

*(Orchestration note, from Andre's correction: one paste at a time, handed over at the moment it is
needed. The step run that way is the one that produced every piece of new information in this
milestone's live testing.)*

### 2026-08-02 — Entry 37: promoted, and the AC6 fix VERIFIED LIVE on the running binary

Andre ran the promotion. On disk: **cli 0.0.122 · daemon 0.0.119 · connect 0.0.116**, and
`attendingNow` is present in the daemon the CLI actually spawns — checked in
`node_modules/@cello-protocol/cli/node_modules/@cello-protocol/daemon/dist`, not from the install's
output.

Then the fix itself, live:

```json
{"ok":true,"content":"J1 — one question, two sessions should both see this [[OVER]]",
 "attendance":2, "sequence_number":0, ...}
```

**`attendance: 2` on a read surface.** Before this fix that response had no such field, which is
exactly why the live session reported the transcript and wire *"silent on it"*.

Two properties fall out of that one call, neither of them arranged:

- **It is a FRESH connection.** The daemon restarted for the promotion and this session re-attached,
  so it never saw a doorbell for that message — and still learned two sessions hold the agent. That
  is precisely the population AC6 is about, tested by accident of the restart rather than by setup.
- **`sequence_number: 0` re-served across a daemon restart** — the durable transcript surviving a
  restart, which `j-persist` pins in the spine and which Tier 1 made load-bearing when delivery
  stopped draining a buffer.

**What remains cannot be self-certified.** AC6 asks that a session *volunteers* co-attendance in its
own words. I can read the field, but I built it — my mentioning it proves nothing about legibility.
It needs the one unscripted question into a second window. The difference from the first attempt is
that the number is now demonstrably sitting in every read response the session could consult, so a
failure this time would be a genuine legibility finding rather than an absent field.

### 2026-08-02 — Entry 38: ✅ AC6 PASSED LIVE — M8D CLOSES

Same open question as the failing run, on the promoted binary (cli 0.0.122 / daemon 0.0.119 /
connect 0.0.116). Nothing about co-attendance in the prompt. The second session's answer, quoted
because it *is* the evidence:

> *"cello_agents reports CELLO_Coder_1 at attendance: 2 — so another session is attending this same
> agent alongside me, not just me alone. That's the first thing worth flagging before I reply to
> anyone: whatever I send, a second window on this identity could also be reading and replying
> independently."*

**It led with it, unprompted, and drew the operational consequence** — not "the field says 2" but
*another window may also be replying*. That is what "reports being un-alone **in its own words**"
asks for, and it is the difference between a value being present and a value being legible.

It then volunteered something nobody asked about: three interrupted sessions with `Miss_Chelly`,
none implicitly "the" session, so a reply requires choosing. A session reciting a field does not do
that.

### Before → after, same question, same wording

| | first run (Entry 33) | now |
|---|---|---|
| answer | *"Co-attendance did not come up on its own… the transcript and the wire protocol are silent on it"* | leads with attendance: 2 and its consequence |
| cause | attendance rode the **push** only; every read surface silent | attendance on every `cello_receive` exit + `cello_get_transcript` |

**`DOD-COATTEND-VISIBLE-1` → ✅ PROVEN LIVE. M8D is CLOSED — all six lines.**

### What closed the loop, and it was not the code

The first run failed because I front-loaded three prompts of instructions and scripted the sessions.
Andre's correction — *brief the sessions, never give them the sequence; hand the orchestrator one
paste at the moment it is needed* — is what produced **every** piece of new information in this
milestone's live testing: the AC6 failure, its precise shape, and now its pass. The scripted steps
only re-confirmed what the unit tests already knew.
