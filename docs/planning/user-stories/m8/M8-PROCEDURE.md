---
name: M8 Procedure — How to Work the Definition of Done
type: procedure
date: 2026-06-27
milestone: M8
status: open
description: >
  The operating runbook for building + closing M8 (the operator portal). Read this FIRST,
  then M8-DEFINITION-OF-DONE.md. Mirrors the M7 procedure (DoD = yardstick, live test =
  enforcer, build journal = audit trail; the red-driven per-unit loop; commit/review/test
  cadence; one-thread hard rules; never merge/push). The portal-specific details: the live
  test drives a real served portal through a browser, and the work spans three repos
  (cello-portal new, trustless-cello directory, cello-client daemon).
---

# M8 Procedure — How to Work the Definition of Done

## REALITY CHECK — read this before anything else

There is **one user: Andre.** He is also the only developer. CELLO is **alpha. Nothing is
in production. There are no operators and no real users to protect.** The production-grade
voice in the stories ("operator," "the account") describes the future product — it is NOT
the current world.

Non-negotiable consequences:

- **Never gate, hedge, defer, or ask permission on a code change** because it is "risky" or
  "load-bearing." There is no operator. Make the change. Correctness/security fixes ship
  immediately.
- **Do not invent decisions for Andre.** "Should I do this code work?" is always yes.
- **DO pause for a genuine design fork** — when something can truly be built several
  materially different ways and which Andre wants is unclear. State options + a recommendation,
  ask. Do NOT dress up "should I proceed?" as a design question.
- **Pause for an actual live AWS deploy** (the directory pipeline) — a deploy *operation*,
  never a code edit.

## 0a. Severity triage — what to work, what to skip, what to NEVER skip

Rank every piece of work; spend effort top-down, never invert it:

1. **CORE JOB-TO-BE-DONE.** An operator magic-links into the portal, sees their agents appear
   with truthful presence, the four-class trust scaffold, and the emergency suspend lever
   actually stops the agent signing. If any of this is broken/missing, it is top priority.
2. **SILENTLY-BROKEN CORE / SECURITY HOLE.** Looks done but an informed person says "you
   missed the kernel" — e.g. a green "online" dot that isn't backed by real presence; a
   session token reachable from JS / localStorage; the write API accepting plaintext or
   another account's writes; a "suspend" that doesn't actually block the federation from
   signing; the directory holding trust-signal plaintext. **This category looks like
   minutiae and is the most dangerous thing in the codebase.** Treat as critical.
3. **REAL non-core gaps.** Degrade but don't break the core job.
4. **Hardening / edge cases / polish.** True minutiae.

**The informed-skeptic test, before calling anything done:** *would someone who deeply
understands this feature say it works, or that I missed the kernel?* If the kernel isn't
there it is category 2, not "done." Police the two failure modes: inflating #4 into a block,
and demoting #2 to "not important."

## 0. Read order (every session, in order)

1. **This document** — the procedure.
2. **M8-DEFINITION-OF-DONE.md** — the target. Find the lowest-numbered line not yet ✅; that
   is your next unit.
3. **M8-BUILD-JOURNAL.md** — the append-only log. Read the last few entries to see what was
   just done/found/left.
4. The source story YAML for that DoD line (CELLO-M8-SCAFFOLD-001 / AUTH-001 / … / E2E-001)
   for the precise AC.

Then start the loop (§2). Do NOT re-derive scope or re-investigate what the journal records.
If the journal says it's done, verify by running the test, not by re-reading code.

## 1. The three artifacts

| Artifact | Role | Maintained |
|---|---|---|
| **M8-DEFINITION-OF-DONE.md** | The **yardstick** — every requirement, ordered, status-tagged. | Tags flipped IN PLACE (❌→🟡→✅) as the live test proves a line. One line per DoD-ID; never rewritten wholesale. |
| **The live test** | The **enforcer** — serves the real portal (frontend + backend) + a directory (+ daemon where needed) and drives the portal **through a browser**; asserts each DoD line. | A tracked code artifact in `cello-portal` (Playwright). Grows one journey at a time. React to it; never bypass. |
| **M8-BUILD-JOURNAL.md** | The **audit trail** — append-only. | One entry per unit. NEVER edit a prior entry. Each: DoD-ID, what was red, what was found (producer/consumer if a bug), commit hashes, reviewer outcome, blockers, decisions. |

The DoD says WHAT done means; the test PROVES it; the journal records HOW it went.

## 2. The core loop (one unit = one DoD line, or a tight cluster within one journey)

1. **Find the red.** Run the live test. Take the lowest-numbered non-green DoD line. Do not
   skip ahead — the test orders the work.
2. **State the target.** DoD line + source AC → one sentence: what observable behavior must
   become true.
3. **Falsify first (MANDATORY — CLAUDE.md Debugging Discipline).** Before writing: does the
   call site have the method (check the interface)? Does responsibility live here? Would the
   fix create redundancy? What else breaks? Only after failing to falsify, write code.
4. **Red-first.** Add/confirm the assertion in the live test (and a focused inner-loop test).
   Confirm red for the right reason.
5. **Implement** until green — minimum change, nothing speculative.
6. **Confirm the floor:** all existing tests green; `typecheck` clean; `lint` clean. Vitest:
   ONE worker, foreground, with timeout. (Browser E2E: headless, one run.)
7. **Commit.** (See §3 — commit before tests too.)
8. **Review.** Dispatch `feature-dev:code-reviewer` (`model:'opus'`) AND `cello-test-attacker`
   on the unit, in parallel. When the unit touches **persistence, crypto, auth, sessions, the
   write API, or the revocation/seal path**, add `cello-fallback-finder` on the failure paths
   (skip for pure-UI/mechanical diffs). Fix EVERY finding at EVERY severity; treat HOLLOW-TEST
   findings as blocking (fix → re-run red→green); treat HIGH silent-fallback findings as
   blocking (fail loud before close). Dispute only a provably-wrong finding or a recorded
   scope decision — write the why in the journal. Commit the fixes.
9. **Update the two docs.** Flip the DoD tag. Append a journal entry.
10. **Back to step 1.**

## 3. Cadence

- **Commit: constantly.** Before tests, after each green unit, after each review fix. Never
  ~15 min without a commit. A commit is free history; the message says what was tried and why.
- **Review: every unit**, on that unit's diff, right after green. Never batch one review for
  many units at the end.
- **Live test: start and end of every unit.** Start → find the red. End → confirm green +
  nothing regressed. Fast component tests are the inner loop between.
- **Checkpoint: at every journey boundary** (J-AUTH green, J-AGENTS green, …) or when context
  gets long. Before flipping any line to ✅, dispatch `cello-done-auditor` on every line
  marked ✅ since the last checkpoint; only EARNED stays ✅. Write a journal summary, update
  the scorecard, commit. STOP and surface to Andre — merge/push is his call.

## 4. Building the live test itself (it doesn't exist yet)

The first code unit is **J-SPINE** for the portal: a Playwright test that serves the real
portal frontend + backend + a directory and drives the browser through the core path.

- Serve the real apps on localhost (NO AWS, NO deploy). Real directory (Docker Postgres +
  Flyway), real portal backend (its own Postgres), real portal frontend build.
- Drive only the public surface an operator uses: open the portal → magic-link sign-in → land
  on the Agents home → see an agent appear with presence → the four-class trust scaffold →
  trigger the suspend lever. The apps handle auth/crypto/wire internally.
- It will be almost entirely red at first. That is the map.
- Grow it one journey at a time (J-SPINE → J-AUTH → J-AGENTS → J-PRESENCE → J-LEVER →
  J-TRUST, per the DoD harness section). Add a journey's assertions when you start it.
- **Anchor to the running app, not the component.** The test loads the served portal and
  drives the browser; it never imports a React component or a backend handler in-process.
  (Same discipline whose absence caused M7's dead-stack blindness.)

## 5. Hard rules (non-negotiable)

- **One thread. One coder. Andre watching.** No parallel implementation agents. Only
  read-only subagents (reviewer, test-attacker, fallback-finder, done-auditor, explorers).
- **One branch per repo. No sprawl.** `cello-portal` work on its assembly branch;
  `trustless-cello` (directory: PRESENCE/WRITEAPI/LEVER/TRUST tables) and `cello-client`
  (daemon: trust-signal pickup) each on one branch. Do not spin up per-unit branches.
- **Never merge to main. Never push.** Both are Andre's call. (Pushing trustless-cello
  triggers the live deploy.) Commit locally, constantly.
- **No deploys as a discovery tool.** Live AWS infra is the FINAL close gate, run once at the
  end with Andre. Journey work is local against the served apps.
- **No-plaintext invariant is a test, not a comment.** Every journey that writes to the
  directory or the portal DB asserts no plaintext/PII/token landed (the gate's SI-001).
- **Vitest: one worker, foreground, timeout, filtered.** Never background a test process.
- **No new stories for contained work.** The 15 story YAMLs ARE the stories; sub-work is the
  loop. Reserve a story only for a new Flyway/DB migration set or a cross-repo
  `@cello-protocol/*` publish + coordination.
- **Deferrals get a home.** Anything pushed out goes into the DoD with a status + named target
  — never only a journal sentence. M8 may not close carrying a silent deferral.

## 6. Cross-repo & migrations

- **Three repos.** `cello-portal` (new, the bulk), `trustless-cello/packages/directory`
  (agent_presence, the write API, the trust identity-tree + pickup queue, the revocation
  honor-check — `agent_revocations` V32 already exists), `cello-client/core/daemon` (the
  trust-signal sealed-box pickup flow).
- **DB migrations** (portal Postgres + directory Postgres): each new table is enumerated in
  the journal Architecture-first, applied against prior migrations (zero checksum errors),
  RLS/uniqueness/indexes named. Directory migrations follow `infra/CLAUDE.md`.
- **cello-client change → version bump** (TRUST-001's daemon flow): the two cross-repo ACs
  (version-bump + trustless-cello dep-update) apply; the tag-push + publish + promotion are
  Andre's.

## 7. Invariants are journey assertions, not a separate pass

The cross-cutting invariants (no-plaintext, account-scoping, T-of-N server-side enforcement,
no-composite-trust-score, in-memory-only client cache, ceremony-gated entry) are proven by
SI/adversarial assertions woven into each journey — not checked once at the end. An invariant
that nothing asserts is assumed, not satisfied.

## 8. What a checkpoint / handoff entry contains

At every journey boundary or before compaction, append a journal entry with: which journeys
are green against the live test (DoD-IDs, with the run output, not a claim); the exact next
red + one-sentence target; the repo + branch + HEAD commit, and whether the reviewer ran on
everything up to HEAD; any blocker needing Andre (a decision, a deploy, a merge) stated
explicitly; anything found that changes the DoD, reflected in the DoD itself.

Verified-green (component + live journey) is the only "done." A claim without a test run is
not done. Report failures with their output; never round up.
