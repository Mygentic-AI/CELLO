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
