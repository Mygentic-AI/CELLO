---
name: M8D Procedure — How to Work the Milestone
type: procedure
date: 2026-08-01
milestone: M8D
status: active
topics: [m8d, co-attendance, multi-session, message-delivery, daemon, procedure, runbook, single-repo]
description: >
  The operating runbook for M8D (co-attendance — several sessions on one agent identity). SELF-CONTAINED
  — no other milestone's procedure needs to be read. Read FIRST, then M8D-DEFINITION-OF-DONE. ONE repo
  (cello-client); no AWS, no directory, no portal. Based on M10B-PROCEDURE (the fullest), with M12's
  later corrections folded in: the two-reasons-to-stop rule, Decision Theatre, journal append-at-EOF,
  and branch hygiene. Adapted throughout for this milestone's one distinguishing fact — every assertion
  is about what the SECOND session sees, so a single-connection test proves nothing.
---

# M8D Procedure — How to Work the Milestone

## REALITY CHECK — read before anything
One user: Andre, also the only developer. CELLO is **alpha — no production, no real users.**
- **Never gate/hedge/ask permission on a CODE change.** Correctness + security fixes ship immediately.
- **Do not invent decisions for Andre.** "Should I do this code work?" is always yes.
- **DO pause for a GENUINE design fork** (materially different architectures) — but in autonomous mode
  you PARK it (DoD "Parked" section + journal), never block.
- **This milestone touches NO cloud infrastructure.** One repo, `cello-client`. No CloudFormation, no
  ECS, no directory deploy, no portal, no migration to a hosted database. **So the usual hibernation
  check does not gate anything here** — see §2d, which is three lines long for that reason.
- **The npm beta publish is AUTHORIZED**; the `latest` promotion never is (§2c).

## 🛑 THERE ARE EXACTLY TWO REASONS TO STOP AND HAND BACK TO ANDRE

**Everything else is a NOPE — do not stop for it. Keep working.**

1. **A manual operation only Andre can do, that blocks you.** (The npm `latest` promotion; the `/mcp`
   reconnect; a live two-session journey that needs him to drive a second Claude window.)
2. **A critical design decision that could cause harm, where you need his guidance.** A genuine fork
   where guessing wrong does damage.

**That is the whole list.** If what you are about to write is not one of these two, it is a NOPE:
- Check-ins ("here's where I am") → **NOPE.**
- Recaps / session tallies → **NOPE.**
- "Should I keep going?" / "want me to start X?" → **NOPE** — the answer is always yes, start it.
- "This is a natural stopping point" / "I've done a lot" → **NOPE.** Length is never a reason to stop.
- "This deserves a fresh start" → **NOPE.** Careful ≠ handing back.

The durable record is the journal + commits, not messages to Andre. **Report progress by committing.**
When you finish a unit, pull the next one and keep going.

### THE FOUR WAYS A RUN DIES — hard rules, not advice

**1. FINISHING SOMETHING IS NOT A STOPPING CONDITION.** The observed failure: a session finishes a
unit, then *stops and sits there* — sometimes literally printing **"waiting for the next cron tick"** —
as though a completed section were a place to rest. **Nothing releases you. There is no gate.** The
instant a unit goes green, reviewed, committed, and the DoD tag is flipped, **pull the next red line
and start it in the same turn.**

**2. NEVER ASK A QUESTION.** `AskUserQuestion` is a **hard blocker that stops the session dead** — in
autonomous mode nobody is there, so it does not wait for an answer, it ends the run. This includes the
softer shapes: "Want me to…?", "Shall I proceed?", ending a turn on a proposal. If something genuinely
new appears: verifiable → verify it; has a best practice → take it and log an `M8D-D*`; genuinely
undecidable → PARK it and pull the next unit. All three end with you still working.

**3. THE CRON IS A DEFIBRILLATOR, NOT A METRONOME.** It exists ONLY to restart a session that already
stalled. Never a checkpoint, never permission to continue, never something to wait for. Full rule §3b.

**4. COMMIT AND PUSH CONSTANTLY — never >~15 min.** Every fix, every doc update, every green unit.
Push after every commit; never batch pushes (Andre reviews by push, not by commit). Detailed messages —
the why, the forensics, the decision.

## 🪶 THIS IS A SMALL MILESTONE. THE DoD IS THE PLAN. START CODING.

**Read this before you "get oriented."** It is the rule most likely to be violated in the first hour,
and violating it costs more than any defect in this document.

**The measured failure (Andre, 2026-08-01).** Handed a DoD line inside an existing milestone, a session
just goes and executes it. Handed a *milestone*, the same session burns enormous token budget on
investigations, re-derivations, refinements, and repeated reviews of specs and plans **before writing
any code — and the result is not better.** The ceremony is triggered by the word "milestone," not by
the work. M8D is where that stops.

**Size it correctly.** M8D is **four DoD lines in ONE repo**. No crypto change, no schema change, no
protocol change, no migration, no cloud infrastructure, no second repo. Next to M10B (three repos,
endorsement pipeline) or M12 (two clouds, a rebuild) it is **tiny**. The only reason it is a milestone
at all is that its enforcer — two attached connections — is different in kind from anything M8C built.
Treat it as a short run of units that happens to have its own folder.

**The design is DONE.** [[2026-07-31_1043_two-sessions-one-agent-co-attendance]] decided it, a
third-party validation closed all four of its open items on 2026-07-31, and its code anchors were
re-verified against post-M12 code. So:

1. **Do NOT re-derive the spec.** Read it once, at §0. It is not a starting point to improve on.
2. **Do NOT review the spec, the DoD, or this procedure.** They have had their pass. A review pass on a
   planning document at milestone open is the exact waste this rule exists to stop.
3. **There is NO determination unit.** M8D deliberately has no `DOD-*-ARCH-1`. M10B's cost one entire
   overnight session across five review passes and shipped zero lines of code.
4. **Investigation is allowed, but it is TARGETED.** You will need to read code — the spec's §10 tells
   you exactly which file and which symbol. **Read the anchor you are about to change, not the
   subsystem around it.** "Let me first map the delivery layer" is the ceremony wearing a useful hat.
5. **No survey, no inventory, no options memo, no comparison of approaches you will not take.** If you
   are writing prose, name the DoD line it turns green. If you cannot, stop writing it.
6. **The first code change should land in the first working turn or two** — the two-connection fixture
   plus a red test for `DOD-COATTEND-VISIBLE-1`. Not after a reading phase.

**The check, whenever a run feels like it is preparing rather than building:** *would I be doing this
if Andre had handed me this line inside M8C?* If no, do not do it here.

## 🎭 DECISION THEATRE — the failure mode INSIDE the two-stop rule

The rule above says do not STOP. The way it actually gets violated is subtler: you keep working, and
every few cycles you re-surface the same items as "waiting on Andre." That is a soft stop. It costs a
whole heartbeat cycle, produces nothing, and reads as diligence — which is why it survives.

### The three questions. All three must be NO for it to be yours.

1. **Does it reach OUTSIDE this system?** npm, a counterparty, a customer, a bill, a public claim,
   someone else's machine. Local daemon + local tests + this repo is not outside.
2. **Is it genuinely irreversible?** Not "destructive-sounding" — irreversible. Deleting a test agent's
   local SQLCipher DB that you created is not.
3. **Is it already authorized in writing?** The REALITY CHECK authorizes code changes and the beta
   publish. Re-asking a settled authorization is the purest form of this.

Any YES → real gate. **All NO → it is yours. Do it, journal it, move on.**

- **ASK ONCE, IN ONE LINE, THEN PARK IT.** Re-listing is the theatre.
- **A DECLINED command is not a standing block.** Do not re-run it; ask once, plainly, then park.
- **REDO > ASK.** On internal alpha work with a green gate, doing it wrong costs one redo.
- **Check which mental model you imported.** "Breaking change", "published package", "migration cost"
  are real brakes in a production system with customers. This has one user and no customers.

## THE MILESTONE IN ONE PARAGRAPH
Two Claude sessions drive the same agent on the same daemon. A message arrives. **One session gets it;
the other is told nothing arrived, in words identical to a quiet counterparty; neither is told the
other exists; and the plain receive path logs nothing on either outcome, so the theft leaves no trace.**
The cause is three individually-reasonable mechanisms colliding: attachment is unrestricted and
uncounted, the doorbell is **multicast**, and the content queue is **destructive and single-consumer**
(keyed by `(agentName, sessionId)`, drained with `buf.shift()`). The decision — made 2026-07-31, in
[[2026-07-31_1043_two-sessions-one-agent-co-attendance]] — is **co-attendance, not exclusivity**:
delivery reads a durable record against a per-session bookmark, catch-up returns everything since your
bookmark whoever wrote it, and the send gate is re-checked in the same synchronous window as the
append. M8D builds that. The launch-gate slice (`DOD-COATTEND-VISIBLE-1`) ships first and only makes
the failure **visible**; the redesign follows.

**What this milestone is NOT.** It is not a crypto change, a schema change, or a protocol change. §5 of
the spec settled that the relay is a **true sequencer** — it assigns `seq` from its own counter, ignores
the sender's claimed position, and all of an agent's sessions share one strictly-serialized stream — so
**co-attendance cannot fork the chain.** The residual risk is purely semantic: a message perfectly
signed, correctly chained, non-repudiable, and conversationally stale. That is the right kind of failure
to have. If a plan starts by touching the relay, the directory, the certificate path, or the Merkle
tree, it has mis-scoped the milestone.

**And it is not exclusivity — that is rejected permanently (spec §3). Do not re-raise it, do not
"simplify" toward it, do not accept a fix that is exclusivity wearing another name** (an attach that
refuses, a lock, a lease, a "primary session"). Four reasons, in order of weight: connections die
constantly, so exclusivity relocates the hard part into a takeover protocol rather than skipping it; it
buys **no cryptographic property** (the seal attests the identity, not the seat); it fixes the wrong
half (the CLI path has no live connection to key it on); and it forecloses **listener mode**, which
co-attendance gets free. If it is ever wanted it is a **flag on top of** co-attendance.

## 0a. Severity triage (spend effort top-down, never invert)
1. **CORE JOB.** Two sessions attached to one agent; a message arrives; **both see it**, neither
   consumes it out from under the other, and either may reply once — the second having caught up on the
   first's reply. Live, across real processes. If broken or missing → top priority.
2. **SILENTLY-BROKEN CORE.** Looks done but the kernel is missing. **Most dangerous category.** For
   M8D specifically:
   - **Still-silent theft.** A reworded `guidance` string with no machine-readable discriminator — the
     second session still cannot tell "nothing arrived" from "your sibling took it." This is the
     defect; a prettier version of it is not a fix.
   - **Exclusivity by the back door.** Attach refuses, or a second session is silently degraded to
     read-only, or the doorbell stops being multicast. BLOCKING regardless of tests.
   - **A dropped message.** The move from a destructive queue to a durable record must not lose content
     when a connection dies mid-read, nor when the daemon restarts. Losing content is the one thing
     worse than mis-ordering it — the spec says so, and `#appendVerifiedContent` already chose that way.
   - **A gate that is theatre.** A tightened send gate with the two awaits still uncovered: both
     sessions clear, both wait, both write, and the counterparty gets two replies to one message.
     Tightening without closing the window is worse than leaving it, because it *looks* enforced.
   - **A catch-up dead end.** A rule satisfiable only through a door the caller is not pointed at —
     the exact shape of the bug that stopped command-line sessions replying.
   - **Content on a doorbell.** `DOD-INV-CONTENTFREE` (M8C Tier I) still binds: no content or
     content-derived text on any push, ever, including an attendance count that leaks who or what.
3. **Real non-core gaps.** 4. **Hardening / polish.**

Informed-skeptic test before calling anything done: would someone who deeply understands this say it
works — or that the kernel is missing?

## 0. Read order (every session)
1. This procedure.
2. [[M8D-DEFINITION-OF-DONE]] — the **Scope fence** first (it is what prevents mis-scoping and
   re-raising exclusivity), then the lowest non-✅ line = next unit; Decisions + Parked.
3. [[M8D-BUILD-JOURNAL]] — Entry 0 (the milestone thesis + what is already settled) + the last entries.
4. **Spec-of-record** (verified design — do NOT re-derive):
   [[2026-07-31_1043_two-sessions-one-agent-co-attendance]] — §2 the root cause, §3 the decision,
   §3b catch-up (**read its 2026-07-31 correction, not just the first paragraph**), §4 the send window,
   §5 the sequencer, §6 the CLI file, §8 the operator-visible changes, and **§10 the code anchors**.
5. **§10 is the map — do not go searching.** Every claim in the spec is anchored to a file and symbol
   there, grouped by section, with the log events to grep. Line numbers are hints; **symbol names are
   the anchor**. The client was untouched by M12, so `core/daemon` and `core/cli` anchors are current.
Then start the loop (§2).

## 1. The artifacts
| Artifact | Role |
|---|---|
| **M8D-DEFINITION-OF-DONE** | The **yardstick + sole status authority** — ordered, status-tagged, carries Decisions + Parked. Flip tags in place; **one line of evidence + `→ Entry N`, never an essay** (§1b). |
| **M8D-BUILD-JOURNAL** | The **audit trail + evidence home** — append-only, appended at EOF (§1a). Full proofs, bug forensics, run output live HERE, pointed to from the DoD. Never edit a prior entry. |
| **The two-connection fixture** | **Enforcer, daemon/IPC layer.** Extend `packages/e2e-tests/src/session-fixture.ts` with non-breaking `opts` for a second connection on the same agent; a from-scratch fixture is a BLOCKING review finding (CLAUDE.md). Real daemon binary, real IPC socket; assert the actual frames, queue states and cursors **on both connections**. |
| **The live two-session journey** | **Enforcer, in-context layer.** Two live `claude --channels` sessions on ONE agent. Lines whose behavior ends inside Claude's context — the arrival alert, the attendance count, the refusal text — are ✅ only after this. Vitest green ≠ done. |

## 1a. Journal writing — APPEND AT EOF, THEN VERIFY
M12 lost 10 of its first 25 entries this way: entries written by *prepending* near the top with
scripted string replacement, anchors shifted as the file grew, and the edits **silently no-op'd** —
no error, exit 0, content never landed.

1. **A new entry is appended at END OF FILE.** Never prepended, never inserted between entries. The
   RESUME STATE block at the top is the ONLY thing overwritten in place.
2. **Verify the write landed** — `grep -c "^## Entry N"` or read the tail, immediately after.
3. **Chronological order is not worth a lost entry.**
4. **The commit message is a backup, not the home.**

## 1b. Document discipline
M10B's DoD reached 1,629 lines while its own header said it stays a scoreboard, and every later review
paid to re-read the archaeology. M8D starts small — keep it that way deliberately.

1. **A DoD line is a status tag, one line of evidence, and `→ Entry N`.** Cap any status blockquote at
   ~5 lines. Longer belongs in the journal with a pointer.
2. **Supersession history lives ONLY in the journal.** A DoD line names the CURRENT shape of a
   decision, never the corpse of the previous one.
3. **A decision on its THIRD rewrite gets MEASURED, not rewritten.** Two prose revisions is the cap;
   the third attempt runs it — against the real fixture, the real daemon log, the real bytes. This
   milestone is unusually well served by that rule: nearly every M8D question has a two-connection
   fixture run that answers it.
4. **One authoritative home per fact.** Journal = forensics and proof. DoD = status. Commit message =
   the why. Do not restate a correction in all three; cross-reference.

## 2. The core loop (one unit = one DoD line)
1. **Find the red** — lowest non-✅ DoD line. Don't skip ahead. **Tier 0 before Tier 1**, and Tier 1
   opens behind M8C's two receipt lines (DoD scope fence).
2. **State the target** — one sentence of observable behavior, PLUS expand the full DoD line (every
   clause) into a clause checklist in the journal. That checklist is the yardstick the reviewer gets.
3. **Falsify first** (CLAUDE.md Debugging Discipline) — does the call site have the method on the
   **INTERFACE**, not just the class? Does the fix location match where responsibility lives? Would it
   create redundancy? What else breaks? **This milestone's specific trap: the inbound path was already
   hardened against the exact race the outbound path still has** (`session-node-manager.ts:3682-3695`).
   Where the two paths diverge, ask why before "fixing" the divergence — it may be deliberate. Only
   then code.
4. **Red-first** — the assertion goes in the **two-connection** fixture (+ a focused in-process test).
   Red for the right reason. For live-journey lines, script the two-session steps in the journal
   before building.
5. **Implement** — minimum change to green; nothing speculative. Design note first for the units in §6.
6. **Floor holds** — `pnpm run test` → `lint` → `typecheck` → `build`, in `cello-client`. Vitest ONE
   worker, foreground, timeout, filtered. Never background a test process.
7. **Commit** (constantly — §3), by explicit path.
8. **Review — ONE read-only `cello-unit-reviewer` on the unit's diff, NO model override.** One pass,
   five lenses. Dispatch per §2b. Fix EVERY finding; commit fixes.
9. **Update docs** — flip the DoD tag (+ one-line evidence + journal pointer), journal entry at EOF.
10. Back to 1.

## 2a. One repo — where work lands
**`cello-client`** (`/Users/andrep/Documents/code/cello-client`) is the whole milestone.

- `core/daemon` — the delivery model (`session-node-manager.ts`, `session-content-handlers.ts`,
  `notification-dispatcher.ts`, `session-read-handlers.ts`, `agent-handlers.ts`, `daemon.ts`).
- `core/cli` — `DOD-RECEPTIONIST-AGENT-1` only (`parity-commands.ts`, `registry.ts`).
- `plugins/cello/agents/cello-receptionist.md` — the subagent that writes the shared file today.
  **A non-code file that instructs an agent is shipped behavior**: it lands on the operator's disk
  through the plugin, so a change there needs the same review as code.
- `packages/e2e-tests` — the two-connection fixture.

**No `trustless-cello` change is expected.** If a unit believes it needs one, that is a scope-fence
event: journal it and check the spec's §5/§7d before writing a line of relay or directory code.

**Local-state rules that bind every unit:** SQLCipher only (`node:sqlite` is VERBOTEN); any new table
or join keys on `agent_id`, never `agent_name`; injected logger, no `console.log`; `domain.noun.verb`
events with correlationId threading.

## 2a-1. 🚨 NEVER `pkill -f cello-daemon`
Andre runs a **production daemon with live agents on this machine.** `CELLO_DIR` isolates a test
daemon's socket and database but **not its process name**, so a name-based kill takes his down with
yours — it has already killed all five live agents once, during M12 testing.

- Stop test daemons by **captured PID**, or through `cello logout` / `cello login`.
- This milestone spawns more daemons than most (two connections, sometimes two daemons). Capture the
  PID at spawn, in the journal, and kill by it.
- **MCP tools go stale after a local daemon restart** (`ipc_connection_lost` needs a Claude Code
  restart). Drive IPC directly via `connectToDaemon` from `@cello-protocol/daemon` instead of
  restarting the harness.
- In a live journey, call `cello_use_agent` **first** — an unselected connection routes no doorbells,
  and the resulting empty inbox looks exactly like the bug under investigation.

## 2b. Reviewer dispatch — what the unit reviewer is TOLD
One `cello-unit-reviewer` dispatch per unit, **no model override**. It is the **only** review agent —
`cello-done-auditor` is retired for code milestones and must not be dispatched here (it re-litigates
work the unit reviewer already passed, at high token cost; M12 keeps it only because its claims are
about live cloud state, which M8D has none of).

The DISPATCH supplies: the DoD line text VERBATIM (all clauses), the coder's clause checklist, the diff
(commit range or files), and the repo. Standing M8D-specific lenses to include:

> ### 🚨 THE MILESTONE LENSES — they are LENSES, not DoD lines
> An invariant is a property every unit must not violate. **You do not build it, so it cannot be a
> deliverable and must never carry a status tag.** Each fires on EVERY unit's diff, whether or not the
> DoD line mentions it.

- **Second-session lens — the one that defines this milestone.** For every changed path, ask: *what
  does the SECOND attached session see?* Flag any assertion, test, or code path that only ever
  considers one connection. A test with one connection is not coverage in M8D, whatever its name says.
  BLOCKING.
- **Exclusivity lens.** Flag any change that refuses an attach, takes a lock or lease, elects a primary
  session, or makes the doorbell single-cast. Exclusivity is rejected permanently (spec §3); it may
  exist only as a flag on top of working co-attendance. BLOCKING even if tests pass.
- **Indistinguishability lens.** Flag any "improvement" to the loser's answer that is only a reworded
  string. The requirement is a **machine-readable discriminator**; prose is the presentation of it,
  not the fix.
- **Content-loss lens.** Flag any path where a message can be dropped: a connection dying mid-read, a
  daemon restart, a bookmark advancing past an unread leaf (`safeCursorAdvance` deliberately refuses to
  advance past a gap — flag anything that relaxes it).
- **Await-window lens.** Flag any await introduced between a gate check and its append, on any path.
  The inbound sibling states the rule in a comment: *"adding any further await between here and the
  append reopens the window."* BLOCKING on the outbound path this milestone is fixing.
- **Content-free lens.** `DOD-INV-CONTENTFREE`: no content or content-derived text on any push. An
  attendance count is routing metadata; anything that identifies *what* arrived is not.
- **Silent fallbacks (dispatch `cello-fallback-finder` when a unit adds a default).** When something a
  guard needs is missing, the answer is REFUSE, not substitute-and-continue. A default that lets the
  caller proceed makes a half-built system look healthy.
- **Error fidelity + ERROR SUBSTITUTION.** Every new/modified `catch`; trace one error path end-to-end
  and QUOTE the operator-visible message. Not just swallowed errors — **renamed** ones: an exit-point
  label standing in for the real cause sends the operator to the wrong subsystem for days. Test: would
  this message send a competent operator to the RIGHT subsystem?
- **Spec fidelity** against the spec section the DoD line cites (per-clause verdicts; silent
  simplification is BLOCKING; deviations legal only when pointing at a DoD Decisions entry).
- **Test teeth + the revert test.** For every new test: would it still pass if the fix were reverted?
  Consider dispatching `cello-test-attacker` on the delivery-model unit — a hollow test there is
  exactly the failure this milestone is about.
- **Removal & refactor integrity — dispatch EXPLICITLY on any diff that DELETES or MOVES code.**
  Lenses 1–4 assume a diff that ADDS something. Deadness PROVEN (grep + the `exports` map + a red
  build, never a grep alone); every DELETED test triaged by SUBJECT; **absence asserted on the BUILT
  artifact, never on source** — `tsc --build --clean` does not remove orphaned `dist/` outputs, only
  `rm -rf core/*/dist` does, and a warm-tree publish re-ships a deleted file's artifact.

## 2c. Publish sequencing
**Load `/cello-publish` for THIS publish — every publish, never from memory.** Loading it earlier in
the session does not count; that is the known failure mode and it has burned npm versions and shipped
`workspace:*` cross-pins. Hook-enforced.

- Batch publishes **per tier, not per unit**. A line needing a published artifact is not ✅ until the
  published artifact works.
- After publish: verify the **BINARY** (`npm pack` + grep `dist`, `npm view … dependencies` — real
  versions, never `workspace:*`). Verify the local install with `claude mcp get cello`, not memory.
- **Never pin a version** — always `latest`. A pin is invisible and a later session burns hours on a
  fix that is published but not running. (`^0.0.x` IS a pin.)
- **Two human-only steps:** the `latest` dist-tag promotion (always Andre's — prepare + `--dry-run` +
  hand over, never run it) and the `/mcp` reconnect.
- **In autonomous mode BOTH are DEFERRED, not blockers.** Publish to beta, verify the binary, write the
  prepared promotion into the journal and the handoff — exact command, `--dry-run` output, versions —
  and **pull the next DoD line immediately.** Do not end a turn on it.

## 2d. Infrastructure — not this milestone
M8D touches no AWS and no GCP. `infra/STATE.md` needs no update, hibernation gates nothing, and the
`cello-db-query` skills are irrelevant. **The live journey's enforcer is local**: the spine harness
(`packages/e2e-tests/src/spine/live-harness.ts`) brings up docker-compose Postgres + Flyway and runs
real directory/relay/daemon binaries on localhost. "Live, across real processes" means real OS
processes — **not deployed AWS.** If a unit finds itself reaching for an AWS credential, stop: it has
left the milestone.

## 3. Cadence
- **Commit constantly** — never >~15 min without one. CELLO docs commit straight to main. Work that
  exists only in a working tree is work a compaction, a crash, or a branch switch can delete.
- **Push after every commit** — each push is one focused change; do not batch. Andre reviews by push.
- **Commit at every boundary** — after each fix, each doc update, each green unit, each tag flip.
- **🚨 COMMIT BY EXPLICIT PATH. NEVER `git add -A`.** Non-negotiable with a shared checkout: an `-A`
  has already swept another session's half-finished work into a commit that then claimed a gate it did
  not have. Stage the files you wrote, by name.
- **A reviewed-green unit MERGES — it does not sit.** If working on a branch (`m8d/<unit>`), merge is
  step 10. Five unmerged branches while `main` moves under all of them is a measured M12 failure.
- **Review every unit** on its diff, right after green. Never batch reviews.
- **Two-connection fixture at start AND end of every unit.**

> ### 🚨 ONE REVIEW PASS PER ARTIFACT. TWO IS THE ABSOLUTE MAXIMUM. THIS IS A HARD CAP.
> **"Review every unit" is NOT "review until the report comes back empty."** It never will.
> **Reviewers always find something — every single time.** That is what they are for, and it means an
> unbounded review loop has **no termination condition.**
>
> 1. **One pass.** Read the findings. Fix what is real.
> 2. **A second pass ONLY if the first found a defect that changed the artifact's shape** — not to
>    confirm the fixes landed. You can read your own diff.
> 3. **There is no third pass. Ever.**
> 4. **Remaining findings become ACs on the units they affect.**
>
> **What this cost, so it is never repeated:** `DOD-END-ARCH-1` took four completed review passes plus
> a fifth, consumed an ENTIRE overnight session, and shipped **zero lines of code.** Each pass found
> real defects — that is precisely the trap. **A milestone is delivered in code, not in
> determinations.** Applies to design notes and diffs alike. A killed reviewer is not a pass; it
> produces no verdict in either direction.

- **Checkpoint at the Tier 0 → Tier 1 boundary:** journal summary, commit, keep the RESUME STATE block
  at the top of the journal current. No `cello-done-auditor` (§2b).

## 3a. Autonomous-mode rules (if running unattended)
**NEVER `AskUserQuestion`.** Never end a turn waiting, on anything. **Decision rubric: pick the common
best practice** — the choice a competent engineer would recommend and least likely to need reversing.
Log it as an `M8D-D*` in the DoD Decisions section and proceed (**redo > block, always**). Genuine
undecidable fork → PARK (DoD Parked + journal) and pull the next unit, saying so. Arm both crons at
kickoff; re-arm after every restart and compaction.

**The forks this milestone might tempt you to open are CLOSED** — exclusivity (spec §3), the relay's
role (§5), the certificate's inputs (§7c/§7d), the receptionist's weighting (§6), and the catch-up
door's existence (§9 item 2). Do not re-open, do not park, do not treat any of them as a fork.

## 3b. Watchdog crons — arm both (self-contained)
Cron jobs here are **session-only**: gone on restart or compaction, and they fire ONLY while the
session is idle. **Re-arm BOTH immediately after every compaction and every session restart** — this is
the single point of failure for the whole mechanism. Recurring jobs auto-expire after 7 days.

**Cron 1 — publish watchdog (armed ONLY while a beta publish is in flight).** Cadence `*/4 * * * *`.
Check the published artifact, not the command's exit code: `npm view` the version, then verify the
BINARY. Terminal → `CronDelete` on itself. (M8D has no deploy, so this is the only in-flight thing.)

**Cron 2 — 30-min heartbeat / anti-stall nudge (armed for the WHOLE milestone).** Cadence at an
off-minute, e.g. `12,42 * * * *` (never `0,30`). Recurring.

> **The cron is a DEFIBRILLATOR, not a metronome.** Its ONLY job is to restart a session that stalled.
> Output of the shape *"waiting for the next cron tick"* is itself the bug it exists to prevent. If you
> are working, a fired cron changes nothing: keep working. **Completing a unit releases nothing,
> because nothing was holding you.** If you have just finished something, that is the moment with the
> LEAST reason to stop: the context is hot and the next red line is one lookup away.

The fired prompt is the self-audit (this list IS the cron script — re-arm from it verbatim):
1. Are M8D-PROCEDURE / M8D-DEFINITION-OF-DONE (+ the latest journal entry) actually in context? If
   compaction dropped them, re-read before anything else — **and RE-ARM BOTH CRONS if they are gone.**
2. Stalled on a decision? Resolve per §3a: verifiable → verify, never escalate what you can check;
   has a best practice → take it, log an `M8D-D*`, proceed; genuinely undecidable → PARK and pull the
   next unit.
3. Waiting for confirmation on something already authorized (code, pushes to main, beta publishes)?
   Unwanted — continue now. **Only TWO human-only steps exist** (§2c). Blocked on one → say so plainly
   in ONE line and work a DIFFERENT DoD line meanwhile. Never idle.
4. **Publishing? Load `/cello-publish` for THIS publish — every publish, no exceptions.** Verify the
   published BINARY. **Never run the `latest` promotion** — prepare + `--dry-run` + hand to Andre.
5. About to re-surface something as "waiting on Andre"? Run the three questions (🎭 Decision Theatre).
   All NO → it is yours; do it. Never bundle a real gate with fake ones.
6. >15 min since the last commit? Commit now — **detailed message**, by explicit path. Push it.
7. Did the last unit go green without a `cello-unit-reviewer` dispatch? Dispatch it now.
8. **Did you FINISH something and stop?** Then the stall this cron exists to fix has already happened —
   you are the patient, not the doctor. Flip the tag, commit, push, **pull the next red line and start
   it before this turn ends.**
9. State one line of current status (DoD line, red/green) so a human skimming later can see the session
   was alive at this timestamp — then **keep working in the same turn.**

**SELF-TERMINATE (mandatory).** When M8D closes, or the work is abandoned or handed back, the fired
prompt calls `CronDelete` on its own job ID. This clause belongs IN the cron prompt, not only here.

## 4. First actions (order matters)

> **🪶 The first action is CODE, not a reading phase.** §0's read order is one pass over four
> documents, not a study period; the spec's §10 means you should not have to search for anything. If
> the first hour produced no red test, the ceremony rule (🪶, above) has already been violated.

1. **Build the two-connection fixture capability FIRST**, as part of `DOD-COATTEND-VISIBLE-1` — not as
   its own DoD line. Every subsequent unit's red test depends on it, and a milestone whose enforcer
   arrives late proves its early lines against the wrong thing.
2. **`DOD-COATTEND-VISIBLE-1`** — the launch-gate slice. It does not wait behind M8C's receipt lines.
   Its AC 7 (correcting [[launch-triage]]'s "reply guard confirmed working") is a doc edit: do it in
   the same commit, not "later."
3. **Confirm M8C's `DOD-FIRSTMSG-WITNESS-1` and `DOD-FRONTIER-STRAND-1` state before opening Tier 1.**
   Tier 1 opens behind them (DoD scope fence). If they are still red, work Tier 0 and say so — do not
   start the redesign against a drifting position key.
4. **`DOD-RECEPTIONIST-AGENT-1`** is independent of both tiers and small. It is a good filler unit when
   Tier 1 is fenced off — but it gets **no vote on the architecture** (spec §6).
5. Then the loop, tier order strict.

## 5. Hard rules (non-negotiable)

### 5a. The recurring defect classes
- **ABSENT IS NOT FINE.** When a guard's input is missing, unreadable, or an unrecognized shape, the
  answer is **REFUSE**. A default that lets the caller proceed is a defect even when currently
  unreachable — unreachable is a property of today's call graph, not of the code. **Specific to M8D:**
  a missing bookmark must not be read as "caught up"; an unknown connection must not inherit another
  connection's cursor; an unreadable attendance count must not render as "1". **Exception, and it is
  real:** if refusing would break the redundancy invariant, you may proceed — but the degraded path is
  **ANNOUNCED** (distinct log event / flag on the response) and the trade is journaled. Never silent.
  Corollary: a signal that fires on the normal case is not a signal.
- **ERRORS NAME THEIR CAUSE, NOT THEIR EXIT POINT.** Do not SWALLOW an error and do not **SUBSTITUTE**
  one. Where a mapper collapses many upstream conditions into one terminal string, the upstream reason
  **must survive in the payload**.
- **NO CONSUMER, NO SHIP.** A new return field, response flag, log event or config knob needs a NAMED
  CONSUMER in the same unit. A field nobody reads is dead weight born dead, and it lies.
- **NO ARCHAEOLOGY COMMENTS.** A comment states a constraint the CURRENT code cannot show. But
  **rewrite, do not delete** — the constraint under a "previously…" comment is usually load-bearing.

### 5b. Deletion & refactor discipline (a refactor IS a code review)
> **Behavior preservation IS the spec for a refactor.** Anything that moved is a finding unless
> journaled. Every anomaly surfaced during one is a FINDING, never noise to normalise away.

- **DEADNESS IS PROVEN BY DELETION, NOT BY GREP.** Grep the repo; read the `exports` map (a published
  entry point is a consumer even with no in-repo importer); remove it and run the gate. **Never inherit
  a deadness claim** from a report, a prior session, or a comment.
- **TRIAGE TESTS BY SUBJECT-UNDER-TEST, NEVER BY FILE.** A test may use dead code as a *driver* while
  its subject is alive. If the subject is live, RE-POINT the test.
- **`dist/` ORPHANS — and the ORDER matters.** `tsc --build --clean` does NOT remove orphaned outputs;
  only `rm -rf core/*/dist core/*/*.tsbuildinfo` does. Order: clean → BUILD → TEST (several tests spawn
  the real built daemon binary out of `dist/`). Assert absence on the **BUILT ARTIFACT**.
- **Audit what SHIPS, not what compiles.** `plugins/cello/agents/cello-receptionist.md` is not code and
  it instructs an agent on the operator's machine. It ships. Review it like code.

### 5c. Verification, not assertion
- **DO NOT ESCALATE WHAT YOU CAN VERIFY.** Check the type definition, the other file, the actual
  bytes, the daemon log. *"The code cannot tell you"* is a claim that must ITSELF be checked.
- **A failing test is fixed, not attributed.** Never "probably flaky", never "predates my change".
  Trace producer → consumer to the exact failing line.
- **RED FOR THE RIGHT REASON — APPLY THE REVERT TEST.** Would this test still pass if the fix were
  reverted? If yes it is not coverage, whatever its name says.
- **MEASURE BEFORE QUOTING A NUMBER.** The spec's §7 numbers came from parsing `~/.cello/daemon.log`
  (JSON lines, group by `sessionId`); its "Reproducing the evidence" table names the events. Use that
  method for any new claim — a figure is measured, or labelled an estimate with the miss recorded.
- **DEBUGGING DISCIPLINE (CLAUDE.md).** Error messages are not root causes; the first suspicious log
  line is rarely the cause; narrating a hypothesis as fact is the default failure mode. Analyze in
  **producers and consumers** — who sets this, who reads it, which precondition was violated. Do not
  propose a fix until the chain is mapped and the falsification pass has been attempted.

### 5d. Process
- **One thread. One coder (the main loop). NO parallel implementation agents.** Read-only subagents
  only (`cello-unit-reviewer`, `cello-fallback-finder`, `cello-test-attacker`, explorers).
- **Work directly on `main`**, or on `m8d/<unit>` branches that merge as step 10. Never leave a
  reviewed-green unit sitting.
- **The scope fence is the two-connection test.** *If a two-connection fixture run cannot OBSERVE the
  line failing, that line is not M8D scope.* Apply it when the line is written, not after it is built.
- **PRE-EXISTING DEFECTS: fix them (standing rule), but LABEL them as debt, not as this milestone.**
  A defect this work surfaces gets its own DoD line marked `(debt — from M{N})`, so M8D's true cost
  stays legible and an overstated ✅ in an earlier milestone is charged where it was earned. The
  `launch-triage` reply-guard line is exactly that shape.
- **No mocks for crypto; no from-scratch fixtures; no `console.log`** in implementation. Observability
  ACs are first-class on every line.
- **Vitest: one worker, foreground, timeout, filtered.** Never background a test process.
- **Deferrals get a home** — DoD Parked + journal. No silent deferral.

## 6. Design-significant units — a SHORT design note in the journal, then the loop

> **🪶 Cap, and it is hard: a design note is ~half a page and gets ONE writing pass and NO reviewer
> dispatch.** It exists to name the seam and the event set before code, not to be a determination.
> Two of the four units get one; the other two get none. If a note is growing past half a page, the
> excess is design work that belongs in the diff — write the code and let the unit reviewer read it.
> A design note is never reviewed, never revised twice, and never a DoD line (§3's review cap covers
> documents, and M10B proved what ignoring that costs).

**Every design note names its unit's FULL observability event set** (`domain.noun.verb`, context
fields, correlationId threading, error paths) before any code. The DoD lines name only headline events,
and the reviewer verifies the implementation against the design note. "The DoD line didn't list an
event" is never a reason one is missing.

Two design notes are owed:
- **`DOD-COATTEND-1`** — the delivery model: where the per-connection bookmark physically lives, how it
  survives a connection death and a daemon restart, what replaces `#receivedContent`'s destructive
  drain, and what happens to a message whose only reader disconnects mid-poll.
- **`DOD-COATTEND-CATCHUP-1` + `DOD-COATTEND-SENDWINDOW-1` — ONE note covering both.** They land
  together or not at all (the gate cannot tighten without a working catch-up door), so they get one
  design and one decision about which door catch-up uses.

`DOD-COATTEND-VISIBLE-1` and `DOD-RECEPTIONIST-AGENT-1` are mechanical; no note.

### The design-note template (use this structure)

```markdown
### YYYY-MM-DD — Entry N: DESIGN NOTE — DOD-<UNIT> (written before any code)

**Target behavior (one sentence).** What an observer sees when this unit works — stated for BOTH
attached sessions, not one.

**Spec anchors.** The exact sections of the spec-of-record this unit implements (cite §), plus the
§10 code anchors it will touch. A clause the spec does NOT pin gets called out as a decision this
note is making.

**Producer/consumer chain.** For each thing this unit creates or checks: who produces it, who
consumes it, what breaks at each hop if it's wrong. This is the map reviewers verify against.

**The seam.** Exactly where this unit's code meets existing code (files/interfaces). What the
interface must expose; what it must NOT know about.

**Invariants at stake.** Which lenses (§2b) this unit could violate, and the specific design property
that prevents each. Name explicitly how it cannot become exclusivity, cannot lose content, and cannot
put content on a doorbell.

**Approach + rejected alternative.** The chosen shape in 3–6 sentences, then at least ONE alternative
considered and WHY it lost. (A design note with no rejected alternative hasn't looked hard enough.)

**Falsification pass.** Before writing code: does the call site have the method on the INTERFACE?
Does the fix location match where responsibility lives — and if the inbound path already solves this,
why does the outbound one differ? What redundancy would this create? What else breaks? State what you
checked.

**Decisions this note makes.** Numbered; anything material graduates to the DoD Decisions section.
Anything undecidable → PARK.

**Test plan sketch.** The red-first assertions on the TWO-connection fixture, and which enforcer
proves the unit (fixture / live two-session journey).
```

## 7. What a checkpoint/handoff entry contains
Which DoD lines are ✅ WITH the enforcer-run output (not a claim); the exact next red + its
one-sentence target; HEAD commit; whether the reviewer ran to HEAD; published package versions if a
cascade shipped; anything parked; anything that changes the DoD. Keep the RESUME STATE block at the top
of the journal current — it is an obligation, not a habit.

---

## Related Documents

- [[M8D-DEFINITION-OF-DONE]] — the yardstick + sole status authority
- [[M8D-BUILD-JOURNAL]] — audit trail + evidence home; Entry 0 is the milestone thesis
- [[2026-07-31_1043_two-sessions-one-agent-co-attendance]] — **spec-of-record**; §10 is the code map
- [[M8C-DEFINITION-OF-DONE]] — `DOD-FIRSTMSG-WITNESS-1` and `DOD-FRONTIER-STRAND-1`, which Tier 1 opens
  behind; also `DOD-INV-CONTENTFREE`, which still binds
- [[launch-triage]] §6 — the launch/redesign split this milestone implements
- [[2026-07-11_cursor-durable-read-before-write-design]] — the per-connection → per-agent relaxation,
  whose §6 predicted the blind reply
- [[M10B-PROCEDURE]] / [[M12-PROCEDURE]] — provenance only (this document is self-contained). M10B
  supplied the loop, the review cap and the document discipline; M12 supplied the two-stop rule,
  Decision Theatre, journal append-at-EOF and the commit-by-explicit-path rule.
