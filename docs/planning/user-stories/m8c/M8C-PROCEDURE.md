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
8. **Review — three READ-ONLY subagents on the unit's diff, in parallel:**
   `feature-dev:code-reviewer` (`model:'opus'`) attacks the CODE; `cello-test-attacker` attacks
   the TESTS (hollow = blocking); `cello-fallback-finder` whenever the unit touches the gateway
   seam, notifications/queues, config, persistence, crypto, or the Telegram egress — exactly where
   a dropped frame / skipped screen / silently-full queue hides as "looks healthy." Fix EVERY
   finding; commit fixes. At tier boundaries, `cello-done-auditor` audits every ✅ flip.
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

## 2b. Reviewer dispatch — what every review subagent is TOLD (D7)
These defect classes recur across milestones; every step-8 dispatch prompt includes them as
explicit instructions, not vibes:
- **Spec fidelity (the worst recurring failure).** The dispatch includes the DoD line text
  VERBATIM (with its D6 clauses) plus the coder's clause checklist from step 2. The reviewer
  returns a per-clause verdict: implemented / deviated / missing. A silent simplification — the
  code does something simpler than a clause says — is a BLOCKING finding even if every test
  passes. Deviations are legal only when they point at a journaled/DECISIONS entry.
- **Error fidelity.** Inspect every new or modified `catch` in the diff. A bare `catch {}`, a
  swallowed error, or a rethrow that collapses the upstream reason into a generic message
  ("something failed") is BLOCKING. An error crossing a boundary carries the upstream code +
  message + context all the way to the surface the operator/agent sees.
- **Trace one error path end-to-end.** The reviewer picks one failure path through the diff and
  QUOTES the exact message the operator/agent would see. If the real cause is buried in a debug
  log while the surface says something generic, that is the finding.
- **Done-auditor angle.** The auditor judges against the DoD line TEXT, never against what the
  tests assert (hollow tests are cello-test-attacker's angle; the auditor's is the text).

## 3. Cadence
- **Commit constantly** — never >~15 min without one. CELLO docs commit straight to main.
- **Review every unit** on its diff, right after green. Never batch reviews.
- **Fixture harness at start + end of every unit.**
- **Checkpoint at every tier boundary:** `cello-done-auditor` on every ✅ flipped since the last
  checkpoint; only EARNED stays ✅. Journal summary, commit. Tier 1's checkpoint IS the launch gate.

## 3a. Autonomous-mode rules (if running overnight — same as M8B)
NEVER `AskUserQuestion`, never end a turn waiting overnight. Reversible choice → decide, log in
M8C-DECISIONS, proceed (redo > block, always). Genuine undecidable fork → PARK (journal + DoD
"Parked decisions" + DECISIONS) and pull the next unit, saying so. If a session cron is armed,
re-arm after any restart/compaction; this doc is the durable record, the cron only the trigger.
Kickoff self-audit at every fire: (a) stalled on a decision? pick + log + proceed; (b) awaiting
confirmation? unwanted — continue; (c) committing often? commit now.

## 4. First actions (order matters)
1. **DOD-SPIKE-1** — the ~30-min live spike, before anything else. If the in-context event does
   NOT land, the reactive track needs redesign — know that on day 0, not after Tier 0.
2. **DOD-M9INT-1** — the M9 merge + semantic gate. No channel code before the seam is live.
Then the loop from DOD-WAKE-1.

## 5. Hard rules (non-negotiable)
- **One thread. One coder (the main loop). NO parallel implementation agents.** Read-only
  subagents only (reviewer / test-attacker / fallback-finder / done-auditor / explorer).
- **Work directly on `main` in both repos** (Andre 2026-06-29, carried forward). Commit often;
  batch directory/relay pushes; cello-client + e2e pushes are free (but respect §2a batching for
  publishes).
- **No mocks for crypto; no from-scratch fixtures; no `console.log`** in implementation (injected
  logger, `domain.noun.verb` events).
- **Every push needs its pull twin in the same unit** (DOD-INV-PUSHPULL) — a Claude-Code-only
  capability is a design bug, not a stage.
- **M9 seam is untouchable:** no M8C unit adds a content path that bypasses
  `screenInbound`/`screenOutbound`. cello-fallback-finder checks this on every seam-adjacent unit.
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
