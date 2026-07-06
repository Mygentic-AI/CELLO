---
name: M8C Procedure — How to Work the Milestone
type: procedure
date: 2026-07-05
milestone: M8C
status: open
description: >
  The operating runbook for M8C (command surface / notifications / reactive messaging), adapted
  from M8B-PROCEDURE. Read FIRST, then M8C-DEFINITION-OF-DONE. Defines the artifacts, the
  red-driven per-unit loop, the two-enforcer model (fixture harness + live channels session),
  the publish-cascade discipline that dominates this cello-client-heavy milestone, and the hard
  rules. Deploys + npm publish (beta) remain authorized as in M8B — close gate, not discovery.
---

# M8C Procedure — How to Work the Milestone

## REALITY CHECK — read before anything
One user: Andre, also the only developer. CELLO is **alpha — no production, no real users.**
- **Never gate/hedge/ask permission on a CODE change.** Correctness + security fixes ship immediately.
- **Do not invent decisions for Andre.** "Should I do this code work?" is always yes.
- **DO pause for a GENUINE design fork** (materially different architectures) — but in autonomous
  mode you PARK it (DoD "Parked decisions" + journal + DECISIONS), never block.
- **AWS + publish actions are AUTHORIZED** (beta npm publish via the cascade, dev deploys, ECS,
  SSM, migrations). Discipline is SEQUENCING + BATCHING only: prove locally first; batch
  directory/relay pushes (~25-30 min deploy each); publish via /cello-publish, never from memory.

## 0a. Severity triage (spend effort top-down, never invert)
1. **CORE JOB.** The doorbell works end-to-end in a live `--channels` session; the command surface
   collapses to login → talk; nothing bypasses the M9 gateway. If broken/missing → top priority.
2. **SILENTLY-BROKEN CORE / SECURITY HOLE.** Looks done but the kernel is missing — e.g. a content
   path that skips `screenInbound` post-merge; message content leaking into a wake or the Telegram
   doorbell; a push with no pull equivalent (poll-only clients silently cut off); a dropped
   notification with no INBOX reconciliation. **Most dangerous category. Treat as critical.**
3. **Real non-core gaps.** 4. **Hardening / polish.**
Informed-skeptic test before calling anything done: would someone who deeply understands this say
it works — or that the kernel is missing?

## 0. Read order (every session)
1. This procedure. 2. M8C-DEFINITION-OF-DONE — lowest non-✅ line = next unit. 3. M8C-BUILD-JOURNAL
— last entries + status board. 4. M8C-DECISIONS — what's resolved/parked. 5. M8C-SPEC for
architecture (verified 2026-07-05; don't re-derive). Then start the loop (§2).

## 1. The artifacts
| Artifact | Role |
|---|---|
| **M8C-DEFINITION-OF-DONE** | The **yardstick** — ordered, status-tagged. Flip tags in place. |
| **The e2e fixture harness** | **Enforcer, daemon layer** — real daemon binary + real IPC socket. Extend `packages/e2e-tests/src/session-fixture.ts` / the spine harness with non-breaking `opts`; a from-scratch fixture is a BLOCKING review finding. |
| **The live `claude --channels` session** | **Enforcer, in-context layer** — the hop into Claude's context is only ever proven live. Lines ending in-context are ✅ only after the live journey. |
| **M8C-BUILD-JOURNAL** | The **audit trail** — append-only + status board. Never edit a prior entry. |

## 2. The core loop (one unit = one DoD line)
1. **Find the red** — lowest non-✅ DoD line. Don't skip ahead.
2. **State the target** — one sentence of observable behavior, PLUS expand the full DoD line
   (every clause, including D6 clauses) into a clause checklist in the journal. That checklist is
   the yardstick every reviewer receives (§2b) — it is what makes "silently built something
   simpler" visible instead of silent.
3. **Falsify first** (CLAUDE.md Debugging Discipline) — call site has the method on the INTERFACE?
   Responsibility lives here? Redundancy? What else breaks? Only then code.
4. **Red-first** — assertion in the fixture harness (+ a focused in-process test). Red for the
   right reason. For in-context lines, script the live journey steps in the journal before building.
5. **Implement** — minimum change to green; nothing speculative. SPARC order for
   design-significant units (§6).
6. **Floor holds** — all tests green; `pnpm run test` → `lint` → `typecheck` → build; Vitest ONE
   worker, foreground, timeout, filtered. Reachability gate unchanged.
7. **Commit** (constantly — §3).
8. **Review — ONE read-only reviewer on the unit's diff: `cello-unit-reviewer` (D8).** One pass,
   four lenses in a single report: code review, spec fidelity (per-clause verdicts), failure
   integrity (buried/generic errors + the silent-fallback hunt — the full fallback-finder
   pattern set is baked into its prompt), and test teeth (hollow-test bypasses). Dispatch per
   §2b. Fix EVERY finding; commit fixes. At tier boundaries, `cello-done-auditor` audits every
   ✅ flip (unchanged — different cadence, different job).
9. **Update docs** — flip the DoD tag, journal entry, status board.
10. Back to 1.

## 2a. The publish cascade (this milestone's special discipline)
M8C is cello-client-heavy; most units touch daemon or shim, and **a line needing a published
`connect` is not ✅ until the published artifact works** (source tests don't catch publish breakage).
- **Batch publishes per tier**, not per unit: work units locally (link/local install), publish the
  cascade once per tier close (or when a live-enforcer line needs a real artifact).
- Always via **/cello-publish** (load the skill; never from memory). Version cascade: bump changed
  packages + every dependent's pinned dep; `pnpm install`; tag; CI publishes. NEVER `npm publish`.
- After publish: verify the BINARY (`npm view ... dependencies` — real versions, never
  `workspace:*`); pin the local install to the exact version.
- trustless-cello references to cello-client packages stay **pinned semver** — a `workspace:*`
  there is a bug.

## 2b. Reviewer dispatch — what the unit reviewer is TOLD (D7, consolidated per D8)
One `cello-unit-reviewer` dispatch per unit. Its prompt already carries the lenses; the DISPATCH
must supply the unit-specific inputs: the DoD line text VERBATIM (with D6 clauses), the coder's
clause checklist from step 2, and the diff (commit range or files). The defect classes it
enforces (recurring across milestones — instructions, not vibes):
- **Spec fidelity (the worst recurring failure).** The reviewer returns a per-clause verdict:
  implemented / deviated / missing. A silent simplification — the code does something simpler
  than a clause says — is a BLOCKING finding even if every test passes. Deviations are legal
  only when they point at a journaled/DECISIONS entry.
- **Error fidelity.** Inspect every new or modified `catch` in the diff. A bare `catch {}`, a
  swallowed error, or a rethrow that collapses the upstream reason into a generic message
  ("something failed") is BLOCKING. An error crossing a boundary carries the upstream code +
  message + context all the way to the surface the operator/agent sees.
- **Trace one error path end-to-end.** The reviewer picks one failure path through the diff and
  QUOTES the exact message the operator/agent would see. If the real cause is buried in a debug
  log while the surface says something generic, that is the finding.
- **Done-auditor angle.** The auditor judges against the DoD line TEXT, never against what the
  tests assert (hollow tests are cello-test-attacker's angle; the auditor's is the text).

## 2c. Publish + deploy sequencing, and the manual-step exceptions (D10)
**Load `/cello-publish` and follow it — never publish a daemon/shim update from memory or
prose.** This applies every time, not just at tier close.

**Only two steps in this whole area are human-only; everything else is bash-executable and the
autonomous loop does it directly, no permission-asking:**
- **Promoting a published version to the `latest` dist-tag** — always waits for Andre's explicit
  go (root CLAUDE.md publishing rules). Beta publishes (the normal cascade — bump, tag, push,
  CI publishes to `beta`) are NOT this exception; do those yourself.
- **`/mcp` reconnect** — reloading a live Claude Code session's MCP tool list to pick up a newly
  published shim likely needs a human at that keyboard; treat as manual unless you find a
  scriptable equivalent. Everything else — `deploy.sh`, `git tag`+push, `npm view` checks,
  pinning the local install (`claude mcp remove`/`add`), AWS/SSM commands — is yours to run.

**Sequencing when a unit needs BOTH a directory/relay deploy AND a cello-client publish:**
start the deploy first (`deploy.sh` / the CodePipeline-triggering push) — it's the slower path
(~25–30 min) — THEN run the `/cello-publish` cascade while the deploy is in flight. Arm the
Cron 1 deploy watchdog (§3b) right after kicking off the deploy so its health is monitored while
you work the publish.

**Live-test dependencies (demo agent, `/mcp` reconnect) — push as far as possible without them,
then batch.** If a live smoke needs the demo agent (EC2 `i-0ad3e7c22470f266e`), it must be
updated first (`git pull` + the documented daemon/demo restart sequence, repo CLAUDE.md) — but
default to doing every non-live-test part of the unit first, and only reach for a live/manual
step at the point the DoD line's enforcer actually requires it (matches "batch publishes per
tier," §2a). When you do hit one of the two human-only steps above, STOP CLEANLY and say so in
one line — e.g. "Blocked on `latest` promotion for vX.Y.Z — needs Andre's go" — then continue
with the next available unit rather than idling on it. This is a genuine, correct stop, distinct
from the frivolous stalls §3b's heartbeat exists to catch.

## 3. Cadence
- **Commit constantly** — never >~15 min without one. CELLO docs commit straight to main.
- **Review every unit** on its diff, right after green. Never batch reviews.
- **Fixture harness at start + end of every unit.**
- **Checkpoint at every tier boundary:** `cello-done-auditor` on every ✅ flipped since the last
  checkpoint; only EARNED stays ✅. Journal summary, commit. Tier 1's checkpoint IS the launch gate.

## 3a. Autonomous-mode rules (if running overnight — same as M8B)
NEVER `AskUserQuestion`, never end a turn waiting overnight. **Decision rubric (D10): pick what
you believe is common best practice — the choice a competent engineer would recommend if asked,
and least likely to need reversing — not merely the choice that's cheapest to undo.** Decide, log
in M8C-DECISIONS, proceed (redo > block, always). Genuine undecidable fork → PARK (journal + DoD
"Parked decisions" + DECISIONS) and pull the next unit, saying so. **Two crons enforce this —
see §3b; arm both at kickoff, re-arm both after every restart/compaction.**

## 3b. Watchdog crons — arm both, D9 (2026-07-06)
Cron jobs in this environment are **session-only**: gone on restart or compaction, fire ONLY
while the session is idle (not mid-query) — which is exactly what makes the heartbeat cron able
to un-stick a stalled session: a fired cron prompt is enqueued like any new instruction, so it
resumes a session that stopped. **Re-arm BOTH crons immediately after every compaction and every
session restart** — this is the single point of failure for the whole mechanism; if you forget,
the session goes silent again with nothing to wake it. Recurring jobs also auto-expire after 7
days — at every tier-boundary checkpoint (§3), `CronList` and recreate anything missing.

**Cron 1 — Deploy/pipeline watchdog (armed ONLY while a deploy is in flight).** Arm the moment
you run `infra/deploy.sh` or push something that triggers a CodePipeline run (directory/relay
deploys: ~25–30 min, all 3 regions in parallel). Cadence `*/4 * * * *` (every 4 min — an active
wait, not idle sleep). The fired prompt must check REAL health, not top-level status alone:
- **CodePipeline:** `aws codepipeline get-pipeline-state` — check per-STAGE status. A stage can
  read `InProgress` while its ECS deployment is crash-looping underneath (task starts, fails
  health check, stops, restarts, forever) — "in progress" is not evidence of health.
- **ECS:** `aws ecs describe-services` → `deployments[].rolloutState`, plus task stop
  reasons/restart counts (`describe-tasks` / CloudWatch) for the crash-loop signature (same task
  definition revision repeatedly stopping and restarting).
- Genuine failure or crash-loop found → STOP waiting, surface it now, diagnose per CLAUDE.md
  Debugging Discipline (producer/consumer, not the error string). Healthy and progressing → log
  one line, keep polling. Terminal (success or confirmed failure) → the prompt calls `CronDelete`
  on itself. (This is separate from the existing tight 30s-interval foreground poll loop for a
  single already-triggered ECS rollout, per repo CLAUDE.md M5 rule 9 — that stays unchanged; this
  cron is for the outer 25–30 min wait so the session isn't burning a turn sleeping through it.)

**Cron 2 — 30-min heartbeat / anti-stall nudge (armed for the WHOLE milestone).** Cadence
roughly every 30 min at an off-minute, e.g. `12,42 * * * *` (never `0,30` — see CronCreate's own
guidance). Recurring. The fired prompt is the self-audit:
1. Is M8C-PROCEDURE / M8C-DEFINITION-OF-DONE actually in context right now? If compaction
   dropped them, re-read both before doing anything else.
2. Stalled on a decision? Pick the best-practice choice (D10 — not merely the reversible one),
   log it in M8C-DECISIONS, proceed.
3. Waiting for confirmation on something already authorized (code changes, AWS/publish actions
   per the REALITY CHECK)? Unwanted — continue now, do not wait further. EXCEPTION: genuinely
   waiting on a named manual-only step (§2c) — state it plainly and that is a real stop, not a
   frivolous one; this cron firing is not a signal to fake progress past it.
4. >15 min since the last commit? Commit now.
5. Did the last unit go green without a `cello-unit-reviewer` dispatch? Dispatch it now.
6. State one line of current status (DoD line, red/green) so a human skimming later can see the
   session was alive and unstuck at this timestamp.

## 4. First actions (order matters)
1. **DOD-SPIKE-1** — the ~30-min live spike, before anything else. If the in-context event does
   NOT land, the reactive track needs redesign — know that on day 0, not after Tier 0. **(DONE ✅
   2026-07-06 — PASS; see BUILD-JOURNAL Entry 3.)**
2. **DOD-WAKE-1** — then straight into the Tier 1 loop.

> **⛔ M9 is NOT merged first (D11, 2026-07-06 — supersedes the old step 2).** DOD-M9INT-1 (the
> M9 merge + semantic gate) was moved OUT of Tier 0 and **deferred to AFTER the channel tiers**.
> Do NOT merge `m9-build` before the channel work — a fresh/post-compaction context must not
> conclude otherwise. The channel tiers owe only **seam-readiness** (§5), not a live gateway.

## 5. Hard rules (non-negotiable)
- **One thread. One coder (the main loop). NO parallel implementation agents.** Read-only
  subagents only (unit-reviewer / done-auditor / explorer).
- **Work directly on `main` in both repos** (Andre 2026-06-29, carried forward). Commit often;
  batch directory/relay pushes; cello-client + e2e pushes are free (but respect §2a batching for
  publishes).
- **No mocks for crypto; no from-scratch fixtures; no `console.log`** in implementation (injected
  logger, `domain.noun.verb` events).
- **Every push needs its pull twin in the same unit** (DOD-INV-PUSHPULL) — a Claude-Code-only
  capability is a design bug, not a stage.
- **New behavior lands in the DAEMON; the shim only forwards** (D7). The shim is one of several
  daemon clients (CLI, future adapters share the socket). A feature implemented shim-side —
  e.g. use_agent auto-start as catch-error-then-retry in `cello-mcp.ts` — works in Claude Code,
  passes tests, and is invisible to every other client. Design bug, not a shortcut. Applies to
  AUTOSTART, INBOX, CONFIG, and everything after.
- **Seam-readiness, NOT seam-live (D11, 2026-07-06).** M9 is merged AFTER the channel tiers, so
  the `screenInbound`/`screenOutbound` gateway does not exist on main during M8C. The rule is
  therefore: **build every new content path so the later M9 merge wires cleanly** — route new
  inbound content through the single `ingestReceivedContent` funnel and new outbound through
  `cello_send`, so DOD-M9INT-1 attaches the gateway at exactly two points and screens everything.
  The one channel unit that adds a genuinely new inbound content path is **DOD-LEAVEMSG-1** (relay
  pull) — it MUST funnel through `ingestReceivedContent`. Most other pushes are content-free
  doorbells and add no content path. (Do NOT claim the seam is live or merge M9 to satisfy this.)
- **Vitest: one worker, foreground, timeout, filtered.** Never background a test process.
- **Deferrals get a home** — DoD "Parked decisions" + journal + DECISIONS. No silent deferral.

## 6. Design-significant units
MSGWAKE (dispatcher + callback seam), CURSOR (read-before-write semantics), TGDOOR (bot lifecycle
in the daemon, egress surface), RELAYWAKE (directory-assisted discovery protocol), and ALL of
Tier 5 are NOT mechanical. For each: a short **design note in the journal FIRST** (approach,
producer/consumer chain, the seam, SIs it must satisfy), then the loop. DOD-PRIMARY-DESIGN-1 is a
full design log, and a hard gate for Tier 5 code.

## 7. What a checkpoint/handoff entry contains
Which DoD lines are green WITH the enforcer-run output (not a claim); the exact next red + its
one-sentence target; HEAD commits (both repos) + whether reviewers ran to HEAD; published package
versions if a cascade shipped; anything parked; anything that changes the DoD.

---

## Related Documents

- [[M8C-SPEC]] — the design: reactive core, tiers, decisions baked
- [[M8C-DEFINITION-OF-DONE]] — the yardstick
- [[M8C-BUILD-JOURNAL]] — the audit trail
- [[M8C-DECISIONS]] — every fork and choice
- [[M8B-PROCEDURE]] — the parent runbook this adapts (severity triage, drift check, never-block)
