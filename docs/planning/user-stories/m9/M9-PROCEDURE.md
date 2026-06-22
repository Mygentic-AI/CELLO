---
name: M9 Procedure — How to Build It
type: procedure
date: 2026-06-22
milestone: M9
status: open
description: >
  The runbook for building M9, the security and governance layer. Read this first, then
  M9-DEFINITION-OF-DONE.md. Updated 2026-06-22 to match the two-phase plan (the earlier
  version referenced the old six-journey structure). The method mirrors M7 on purpose:
  build against a live test, red-first, review every unit, because vitest-green is not done
  — only a live run is.
---

# M9 Procedure — How to Build It

## 0. Read order (every session)

1. **This document** — the method.
2. **M9-DEFINITION-OF-DONE.md** — the plan. Two phases, two gates, the story list with a
   done-condition each. Find the next unbuilt story in phase order; that is your unit.
3. **M9-BUILD-JOURNAL.md** — the append-only log. Read the last few entries to see what was
   done and what's left.
4. **M9-CAPABILITY-HARVEST.md** — the decisions behind the plan (what's in/out, the governance
   feedback channel, the config design, the two-phase split). Read the section for your unit.
5. **The gateway internals** — `discussion_logs/2026-05-28_1000_security-layer-v3-extensibility-and-split-gateway.md`.
6. **The daemon seam** — `discussion_logs/2026-06-21_1600_m9-content-channel-seam-and-entry-plan.md`.

Note: the old story YAMLs (SCAN-001 … MONITOR-001) are superseded. Do not build from them.
The plan is the DoD; the overview maps the old files to the new stories.

## 1. The three artifacts

| Artifact | Role |
|---|---|
| **M9-DEFINITION-OF-DONE.md** | The **plan**: the stories, in phase order, each with a done-condition. During build, flip a story's status in place as its gate proves it. |
| **The live test** | The **proof**: it spawns the real `cello-gateway` + `cello-daemon` + directory + relay and runs a real message through. A story is done only when its piece works and the phase gate is green. |
| **M9-BUILD-JOURNAL.md** | The **log**: append one entry per unit. Never edit a prior entry. Each entry: which story, what was red, what was found, commit hashes, reviewer outcome, blockers. |

## 2. The core loop (one unit = one story, or a tight cluster)

1. **Find the red.** Run the live test. Take the next unbuilt story in phase order.
2. **State the target.** From the story's done-condition in the DoD. One sentence: what
   observable behavior must become true.
3. **Falsify first (CLAUDE.md Debugging Discipline).** Does the call site have the method
   (check the interface, not the class)? Does responsibility live here? What else breaks?
   Only then write code.
4. **Red-first (SPARC, absolute).** Add the assertion to the live test (plus a focused
   in-process test for the inner loop). Confirm it's red for the right reason. No
   implementation before a red test. **No mocks for crypto.**
5. **Implement** until it's green — minimum change, nothing speculative.
6. **Confirm the floor holds:** all existing tests green; `typecheck` clean; `lint` clean.
   Vitest: one worker, foreground, with a timeout. Never background a test process.
7. **Commit.** (See §3 — commit before tests too.)
8. **Review.** Dispatch `feature-dev:code-reviewer` with `model:'opus'` on the unit's diff.
   Fix every finding at every severity. Dispute only a provably-wrong finding or a recorded
   scope decision — write the why in the journal. Commit the fixes.
9. **Update the docs.** Flip the story's status in the DoD. Append a journal entry.
10. **Back to step 1.**

## 3. Cadence

- **Commit constantly.** Before tests, after each green unit, after each review fix. Never go
  ~15 minutes without a commit.
- **Review every unit**, on its diff, right after it goes green. Do not batch.
- **Live test at the start and end of every unit.** Fast in-process tests are the inner loop.
- **Checkpoint at each story boundary and at each gate** (Gate 1, Gate 2), or when context
  gets long. Journal summary, DoD status update, commit, then surface to Andre — merge and
  any deploy are his call.

## 4. The live test

It spawns the **real programs** on localhost (no AWS deploy): the new `cello-gateway`, the
`cello-daemon` (cello-client), the directory, and the relay. Real IPC, real crypto, real
DeBERTa inference in-process. In Phase 2, real mTLS too.

- **Anchor to the program, not the library.** Spawn the gateway as a child process and drive
  it through the daemon's content path — a real `cello_send` / `cello_receive` round-trip that
  the daemon screens via the gateway. Not by calling pipeline functions in-process. This is the
  discipline whose absence caused M7's dead-stack blindness.
- **Reuse the M7 harness cluster** (directory + relay + daemons) and add a gateway sidecar. Do
  not write a from-scratch fixture; extend the existing one.
- **Build toward the gates.** Phase 1 stories build toward **Gate 1** (the whole loop on one
  machine). Phase 2 stories build toward **Gate 2** (remote gateway over mTLS + tamper-proof
  records). Add a gate's assertions as you build its stories.

## 5. Hard rules (non-negotiable)

- **The gateway is a SEPARATE program.** The detection pipeline does not live in the
  cello-client `client` or `daemon` package. The daemon holds only the thin
  `SecurityGatewayClient` interface (the two call sites). Pipeline code in the daemon breaks
  the company (split) deployment.
- **The gateway owns its config and records; the daemon never does** (INV-4). In Phase 2 the
  gateway — not the client — writes the tamper-proof records to the directory (INV-8). Any path
  where the client writes those is a security violation, even if tests pass.
- **No-LLM base** (INV-1). The detection pipeline is deterministic; the only model is the
  DeBERTa injection scanner, in gateway memory, no network call. Judgment work (moderation,
  fuzzy policy) is Day 2, done by a hook or the agent upstream — never in the base.
- **Not a moderation tool** (INV-2). No toxicity / sentiment / topic policing.
- **Unified daemon seam** (INV-5). All inbound passes `ingestReceivedContent`; all outbound
  passes `cello_send`. No content path bypasses the gateway, including recovered park content
  (the M7 dependency).
- **The feedback channel never hangs** (INV-6). Every `cello_send` returns a terminal verdict
  within a deadline. A timeout is a verdict, not a hang.
- **One thread. One coder. Andre watching.** Only read-only subagents (reviewer, explorers).
- **Never merge to main or push without Andre.** The Phase-2 directory migration triggers the
  ~25-30 min directory deploy — batch all directory changes before any push.
- **DeBERTa is pre-downloaded INT8 only** — no training pipeline.
- **Deferrals get a home** in the DoD's Day-2 list — never a silent drop.

## 6. Design-significant units (write a journal design note FIRST)

Not mechanical; write a short design note before code:
- **M9-CORE-001** — the gateway program skeleton + the `SecurityGatewayClient` interface + the
  two daemon call sites (`cello_send` → `screenOutbound`, `ingestReceivedContent` →
  `screenInbound`). The local sidecar first; the interface is what makes the Phase-2 remote
  version an add, not a rewrite.
- **M9-FEED-001** — the governance feedback channel (the four dispositions, blocking +
  never-hang, the re-send flow with `governance_decisions`). Get the LLM contract right.
- **M9-ATTEST-001 (Phase 2)** — the directory `security_attestations` table. The first new
  Flyway migration since M5: design the schema complete up front (hash-chained, RLS,
  sovereign-faithful), reserve the version, bump `OpsAgentExpectedMigrationVersion`, update
  `cello-ssm-parameters.yaml`. A real DB/migration + cross-repo deploy.

## 7. Invariants are gate assertions, not a separate pass

The invariants (INV-1 … INV-8 in the DoD) are proven by assertions woven into the gates, not
checked once at the end. When a gate goes green, confirm its relevant invariants are actually
asserted by a test — e.g. Gate 1 must assert the recovered-park-content path is screened the
same as direct (INV-5); Gate 2 must assert the client cannot forge a record (INV-8). An
invariant nothing asserts is assumed, not satisfied.

## 8. Dependency gates

- **Phase 1 inbound screening is blocked on MSG-001-3b increment 3** (M7) — the unified inbound
  funnel, so recovered/parked content passes the same point as direct content. Until it lands,
  Gate 1 cannot be honestly green. The AC is LOCKED and owned by the M7 thread (commit `bc047c7`).
- **Unblocked now (no M7 dependency):** the gateway skeleton (M9-CORE-001), the feedback channel
  (M9-FEED-001), the outbound checks (M9-OUT-*), and config storage (M9-CFG-001). Start here if
  building early — but this splits focus from M7, which is the launch blocker.
- **Hooks and moderation are Day 2**, not Phase 1. Do not build the hook engine for launch.

## 9. What a checkpoint entry contains

At each gate, each story boundary, or before compaction: which stories are proven (with the
test-run output, not a claim); the next unbuilt story + one-sentence target; the HEAD commit;
whether the reviewer has run on everything up to HEAD; any blocker needing Andre; anything found
that changes the DoD — and reflect it in the DoD.

Verified-green (unit + in-process + live gate) is the only "done." A claim without a test run is
not done. Report failures with their output; never round up.
