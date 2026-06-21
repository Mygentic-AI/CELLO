---
name: M9 Procedure — How to Work the Definition of Done
type: procedure
date: 2026-06-21
milestone: M9
status: open
description: >
  The operating runbook for building M9 (the security gateway). Read this FIRST,
  then M9-DEFINITION-OF-DONE.md. It defines the three artifacts (DoD = yardstick,
  live binary test = enforcer, build journal = audit trail), the red-driven
  per-unit loop, the commit/review/test cadence, the M9-specific hard rules
  (separate gateway repo, no-LLM invariant, gateway-writes-attestations, the M7
  content-channel dependency gate), and what a handoff contains. Mirrors the M7
  method deliberately — M7 proved that vitest-green ≠ done; only a live
  multi-process run is. M9 is NOT a salvage/repair effort (M7 was, post-collapse),
  so the dead-stack rules do not apply; everything else carries over.
---

# M9 Procedure — How to Work the Definition of Done

## 0. Read order (every session, in order)

1. **This document** — the procedure.
2. **M9-DEFINITION-OF-DONE.md** — the target. Find the lowest-numbered line not yet
   ✅; that is your next unit.
3. **M9-BUILD-JOURNAL.md** — the append-only log. Read the last few entries to see
   what was just done, found, and left.
4. **The V3 canonical design** — `discussion_logs/2026-05-28_1000_security-layer-v3-extensibility-and-split-gateway.md`. Everything inside the gateway is specified there.
5. **The entry plan** — `discussion_logs/2026-06-21_1600_m9-content-channel-seam-and-entry-plan.md`. Where the gateway attaches to the daemon, and the dependency gate.
6. The source story YAML for the DoD line you're working (SCAN-001 / SCAN-002 / SCAN-003 / REDACT-001..004 / MONITOR-001).

Then start the loop (§2). Do NOT re-derive scope or re-read the whole corpus. If the
journal says it's done, it's done — verify by running the test, not by re-reading code.

## 1. The three artifacts

| Artifact | Role | How it's maintained |
|---|---|---|
| **M9-DEFINITION-OF-DONE.md** | The **yardstick** — every requirement, ordered, status-tagged. | Status tags flipped IN PLACE (❌→🟡→✅) as the live test proves a line. One line per DoD-ID. Never rewritten wholesale. |
| **The live binary test** | The **enforcer** — spawns the real `cello-gateway` + `cello-daemon` + directory + relay binaries on localhost, real IPC/mTLS/crypto, and asserts each DoD line. Defines "done." | A tracked code artifact. Grows one journey at a time (§4). React to it; never bypass it. |
| **M9-BUILD-JOURNAL.md** | The **audit trail** — append-only. Prevents re-asking/re-doing. | Append one entry per unit. NEVER edit a prior entry. Each entry: DoD-ID, what was red, what was found (producer/consumer if a bug), commit hashes, reviewer outcome, blockers, decisions. |

The DoD says WHAT done means. The test PROVES it. The journal records HOW it went.

## 2. The core loop (one unit = one DoD line, or a tight cluster within one journey)

1. **Find the red.** Run the live test. Take the lowest-numbered DoD line not green.
2. **State the target.** From the DoD line + the source story AC. One sentence: what
   observable behavior must become true.
3. **Falsify first (MANDATORY — CLAUDE.md Debugging Discipline).** Does the call site
   have the method (check the interface, not the class)? Does responsibility live here?
   Would the fix create redundancy? What else breaks? Only then write code.
4. **Red-first (SPARC Refinement — absolute).** Add/confirm the assertion in the live
   test (and a focused in-process test for the inner loop). Confirm it's red for the
   right reason. No implementation before a red test exists. **No mocks for crypto.**
5. **Implement** until that line is green — minimum change, nothing speculative.
6. **Confirm the floor holds:** all existing tests green; `typecheck` clean; `lint`
   clean. Vitest: ONE worker, foreground, with timeout. Never background a test process.
7. **Commit.** (See §3 — commit before tests too.)
8. **Review.** Dispatch `feature-dev:code-reviewer` with `model:'opus'` on the unit's
   diff. Fix EVERY finding at EVERY severity. Dispute only a provably-wrong finding or a
   recorded scope decision — write the why in the journal. Commit the fixes.
9. **Update the two docs.** Flip the DoD line's status. Append a journal entry.
10. **Back to step 1.**

## 3. Cadence

- **Commit: constantly.** Before tests, after each green unit, after each review fix.
  Never go ~15 minutes without a commit. A commit is free history.
- **Review: every unit**, on that unit's diff, right after it goes green. Do NOT batch
  one review for many units at the end.
- **Live test: start and end of every unit.** Start → find the red. End → confirm green
  and nothing regressed. Fast in-process tests are the inner loop between.
- **Checkpoint / handoff: at every journey boundary** (J-SCREEN green, J-SCAN green, …)
  or whenever context is getting long. Journal summary, DoD scorecard, commit, then
  surface to Andre — merge and any deploy are his call.

## 4. Building the live test itself

The live test spawns the **real binaries** on localhost (no AWS deploy): the new
`cello-gateway`, the `cello-daemon` (cello-client), the directory, and the relay. Real
IPC, real mTLS (enterprise mode), real crypto, real DeBERTa INT8 inference in-process.

- Anchor to the BINARY, not the library. Spawn the gateway as a child process; drive it
  through the daemon's content path (a real `cello_send` / `cello_receive` round-trip
  that the daemon screens via the gateway), not by calling pipeline functions in-process.
  This is the single discipline whose absence caused M7's dead-stack blindness.
- Reuse the M7 J-SPINE harness cluster (directory + relay + two daemons) — M9's journeys
  add a gateway sidecar to it. Do NOT write a from-scratch fixture; extend the spine
  harness (the M7 fixture-discipline rule applies).
- Grow ONE journey at a time (J-SCREEN → J-SCAN → J-GATE/REDACT → J-HOOK → J-ATTEST).
  Add a journey's assertions only when you start that journey.

## 5. Hard rules (M9-specific; non-negotiable)

- **The gateway is a SEPARATE repository and process.** The six-layer pipeline does NOT
  live in the cello-client `client` or `daemon` package. The daemon holds only a thin
  `SecurityGatewayClient` adapter (the two call sites). Putting pipeline code in the
  daemon is a layering violation and breaks enterprise split-deployment.
- **The gateway writes attestations to the directory directly. The client NEVER does.**
  (M9-INV-2.) Any code path where the client writes a `SecurityAttestation` is a security
  violation, regardless of whether tests pass.
- **No-LLM invariant in the base layers.** The six base layers are deterministic; the
  only inference is DeBERTa-v3-small INT8 loaded into gateway memory at startup. No
  network calls in the base pipeline. Hooks are the only exempt extension point.
- **Unified daemon seam.** All inbound content passes `ingestReceivedContent`; all
  outbound passes `sendContent`. M9 hooks exactly these two. No content path may bypass
  the gateway — including recovered park content (the M7 MSG-001-3b dependency).
- **One thread. One coder. Andre watching.** Only read-only subagents (reviewer,
  explorers) may be dispatched.
- **Never merge to main. Never push without Andre.** The directory migration triggers
  the ~25-30 min directory deploy — batch ALL directory changes before any push.
- **DeBERTa scope is pre-downloaded INT8 only** — no MLOps, no training pipeline.
- **Deferrals get a home.** Anything pushed out goes into the DoD with a status and a
  named target (Day 2 / a future milestone) — never only a journal sentence (RC-1).

## 6. Design-significant units (write a journal design note FIRST)

These are not mechanical; write a short design note in the journal before any code:

- **The gateway package/repo skeleton + `SecurityGatewayClient` adapter** (the daemon
  seam). Greenfield. The two call sites (`cello_send` → `screenOutbound`,
  `ingestReceivedContent` → `screenInbound`) and the local-sidecar vs mTLS modes.
- **The directory `SecurityAttestation` migration** — M9 owns the FIRST new Flyway
  migration since M5. Design the schema complete up front (hash-chained, RLS,
  sovereign-faithful); reserve the version; bump `OpsAgentExpectedMigrationVersion`;
  update `cello-ssm-parameters.yaml`. This is a real story (DB/migration + cross-repo
  deploy), not a hotfix.
- **The hook engine** — positions, sync/async, observe/gate/redact, HMAC/bearer auth,
  redact no-inject enforcement.

## 7. Tier-0 invariants are journey assertions, not a separate pass

The cross-cutting invariants (M9-INV-1..8) are proven by assertions woven into each
journey, not checked once at the end. When a journey goes green, confirm its relevant
invariants are actually asserted by a test in that journey (e.g. J-SCREEN must assert
recovered-park-content-is-screened (INV-3); J-ATTEST must assert client-cannot-forge-
attestation (INV-2) and clean-passes-are-recorded (INV-6)). An invariant nothing asserts
is assumed, not satisfied.

## 8. Dependency gates (read before claiming a journey is startable)

- **J-SCREEN (inbound Layer 1 + the unified-funnel seam) is blocked on MSG-001-3b
  increment 3** landing with its single-inbound-funnel AC (`m7-rehome`). Until then the
  recovered-park-content path can bypass the gateway; J-SCREEN's seam assertion cannot be
  honestly green. The AC is LOCKED and owned by the MSG-001-3b thread (commit `bc047c7`).
- **Hook governance (portal notification + WebAuthn on hook add/modify) is blocked on
  M8** (the portal). Build the hook engine and audit trail in M9; the portal-surfaced
  governance UX lands when M8 exists. Note this in the DoD line, do not silently defer.
- **Unblocked now (no dependency):** the gateway repo/package skeleton, the
  `SecurityGatewayClient` interface + local stub, and the `SecurityAttestation` schema
  *design*. Start here.

## 9. What a handoff / checkpoint entry contains

At every journey boundary, or before compaction, append a journal entry with: which
journeys are green against the live test (with test-run output, not a claim); the exact
next red + one-sentence target; branch + HEAD commit (which repos); whether the reviewer
has run on everything up to HEAD; any blocker needing Andre (a decision, a deploy, a
merge); anything found that changes the DoD — and reflect it in the DoD itself.

Verified-green (unit + in-process + live journey) is the only "done." A claim without a
test run is not done. Report failures with their output; never round up.
