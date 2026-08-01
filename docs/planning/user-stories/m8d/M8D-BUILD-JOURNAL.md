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

**Updated:** 2026-08-01, after Entry 5.

- **Everything is MERGED TO `main`** in both repos (the `m8d/co-attendance` worktrees still exist and
  track it). Client `main` @ `20c331b`; docs `main` @ the Entry 5 commit.
- **Done.** `DOD-RECEPTIONIST-AGENT-1` **✅** (all four ACs, AC 4 at execution level).
  `DOD-COATTEND-VISIBLE-1` **🟡** (ACs 1–5, 7 enforcer-green; AC 6 is a live journey).
  `DOD-INBOX-AGENT-1` *(debt — from M8C)* **✅** — reviewed, and the review found the same
  accept-and-drop shape in four more places, including the shim line the fix itself wrote.
  `DOD-FRONTIER-STRAND-1` **AC2 only** landed (M8C line; ACs 1/3/4 still open, so the fence holds).
- **PUBLISHED to beta, binary-verified (two rounds):** `v0.0.170` → daemon `0.0.111` / cli `0.0.114`
  / connect `0.0.113`, then `v0.0.171` → **daemon `0.0.112`, cli `0.0.115`, connect `0.0.114`**,
  which is HEAD. Verified by `npm pack` + grep: `dist/co-attendance.js`, `dist/resolve-named-agent.js`
  (all four refusal reasons), `session.frontier.mismatch`, the doorbell body, and connect's six
  `agent !== undefined` sites. Cross-pins are real versions (`cli@0.0.115 → daemon@0.0.112`).
- **`latest` NOT promoted — operator-run, always.** Prepared, for when Andre wants the reinstall:
  ```
  npm dist-tag add @cello-protocol/connect@0.0.114 latest
  npm dist-tag add @cello-protocol/cli@0.0.115 latest
  npm dist-tag add @cello-protocol/daemon@0.0.112 latest
  npm dist-tag add @cello-protocol/gateway@0.0.23 latest
  npm dist-tag add @cello-protocol/crypto@0.0.38 latest
  npm dist-tag add @cello-protocol/transport@0.0.42 latest
  npm dist-tag add @cello-protocol/protocol-types@0.0.40 latest
  ```
  then `npm i -g --prefer-online @cello-protocol/cli@latest @cello-protocol/connect@latest`,
  `cello logout && cello login`, and `/mcp`. (`--prefer-online` is not optional right after a
  promotion — `@latest` resolves from the operator's cached packument.)
- **🚫 THE BINDING CONSTRAINT: Docker is unavailable here** (`docker info` fails), so the spine
  harness cannot run — and it is M8D's own live enforcer (`M8D-PROCEDURE` §2d). **No live-journey AC
  can close on this machine until Docker is up**, `DOD-COATTEND-VISIBLE-1` AC 6 included.
- **Tier 1 stays FENCED** behind M8C's `DOD-FIRSTMSG-WITNESS-1` (ACs 7–8 owed — blocked on the same
  spine rot) and `DOD-FRONTIER-STRAND-1` (❌ open, an unbuilt M8C line). Note `FIRSTMSG`'s *code* is
  shipped, so §7a's drift no longer persists; what is owed there is live proof.
- **Owed to Andre.** (1) Docker up, or a decision to close live ACs elsewhere. (2) The live
  two-session `claude --channels` journey for AC 6. (3) The `latest` promotion, when he wants the
  reinstall. (4) A call on whether M8D should absorb `DOD-FRONTIER-STRAND-1` to lift its own fence.
- **Gate at HEAD.** 2417 passed / 11 skipped, lint + typecheck + build clean.

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
