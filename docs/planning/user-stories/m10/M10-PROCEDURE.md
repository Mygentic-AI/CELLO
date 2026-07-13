---
name: M10 Procedure — How to Work the Milestone
type: procedure
date: 2026-07-11
milestone: M10
status: open
topics: [m10, trust-signals, procedure, runbook, zero-bump, portal, three-repo]
description: >
  The operating runbook for M10 (trust signals — pipes for all, signals for few). SELF-CONTAINED
  — no other milestone's procedure needs to be read. Read FIRST, then M10-DEFINITION-OF-DONE.
  Three-repo milestone with the center of gravity in cello-portal. No separate SPEC or DECISIONS
  docs: the two M10 design docs are the spec-of-record, and decisions live in the DoD's
  Decisions section. Includes the design-note template (§6); the worked example is
  BUILD-JOURNAL Entry 1.
---

# M10 Procedure — How to Work the Milestone

## REALITY CHECK — read before anything
One user: Andre, also the only developer. CELLO is **alpha — no production, no real users.**
- **Never gate/hedge/ask permission on a CODE change.** Correctness + security fixes ship immediately.
- **Do not invent decisions for Andre.** "Should I do this code work?" is always yes.
- **DO pause for a GENUINE design fork** (materially different architectures) — but in autonomous
  mode you PARK it (DoD "Parked" section + journal), never block.
- **AWS + publish actions are AUTHORIZED** (beta npm publish via the cascade, dev deploys, ECS,
  SSM, migrations). Discipline is SEQUENCING + BATCHING only: prove locally first; batch
  directory pushes (~25-30 min deploy each); publish via /cello-publish, never from memory.

## THE MILESTONE IN ONE PARAGRAPH
Build the **generic trust-signal machinery end-to-end** (envelope, dumb directory, registry,
presentation, LLM consumption, policy floor) and prove it with a **deliberately small set of
signals** — the two internal ones everyone already has (phone, email), one or two
directory-computed track-record signals, and ONE external-validator signal (GitHub first) —
then prove the machinery is generic with the **zero-bump canary** (a new type added with empty
diffs in cello-client and trustless-cello). We are NOT doing every signal; we are building the
pipes so every future signal is a portal-only playbook run ([[M10-TYPE-PLAYBOOK]]).

## 0a. Severity triage (spend effort top-down, never invert)
1. **CORE JOB.** A signal is minted at the portal, notarized by the directory, held by the
   subject, presented at introduction, verified by the recipient, and consumed by its LLM with
   `issuer_kind` framing — live, across real processes. If broken/missing → top priority.
2. **SILENTLY-BROKEN CORE / SECURITY HOLE.** Looks done but the kernel is missing — a hash that
   enters the directory outside the signed chokepoint (INV-CHOKEPOINT collapse); a payload
   delivered to the LLM without issuer_kind framing; per-type code creeping into client or
   directory (a type enum, a `switch(type)` — the zero-bump goal dying silently); an agent-issued
   blob framed with portal authority; a signal readable across co-resident agents
   (INV-AGENT-SCOPED bleed). **Most dangerous category. Treat as critical.**
3. **Real non-core gaps.** 4. **Hardening / polish.**
Informed-skeptic test before calling anything done: would someone who deeply understands this
say it works — or that the kernel is missing?

## 0. Read order (every session)
1. This procedure. 2. [[M10-DEFINITION-OF-DONE]] — lowest non-✅ line = next unit; Decisions +
Parked sections. 3. [[M10-BUILD-JOURNAL]] — last entries. 4. **Spec-of-record** (verified design —
do NOT re-derive): [[M10-TRUST-SIGNAL-STORAGE-AND-CREATION]] (HOW: envelope, dumb directory,
scan-before-hash, supersession, §15 zero-bump) and [[M10-TRUST-SIGNAL-TAXONOMY]] (WHAT: the four
classes, the type list). Then start the loop (§2).

## 1. The artifacts
| Artifact | Role |
|---|---|
| **M10-DEFINITION-OF-DONE** | The **yardstick + sole status authority** — ordered, status-tagged, carries Decisions + Parked. Flip tags in place; one line of evidence + `→ Entry N`, never an essay. |
| **M10-BUILD-JOURNAL** | The **audit trail + evidence home** — append-only. Full proofs, bug forensics, run output live HERE, pointed to from the DoD. Never edit a prior entry. New file per tier (`M10-BUILD-JOURNAL-T{n}.md`) seeded with a 10-line resume block. |
| **M10-TYPE-PLAYBOOK** | The **per-type runbook** — the repeating unit after the pipes exist. A new signal type = one playbook run = one journal entry, not a story. |
| **The e2e fixture harness** | **Enforcer, daemon/directory layer** — extend `packages/e2e-tests/src/session-fixture.ts` / the spine harness with non-breaking `opts`; a from-scratch fixture is a BLOCKING review finding. |
| **The live signal journey** | **Enforcer, end-to-end layer** — portal mints → directory notarizes → holder stores → presents at introduction → recipient verifies → LLM consumes, real processes. Lines ending in an LLM's context are ✅ only after the live journey. |

## 2. The core loop (one unit = one DoD line)
1. **Find the red** — lowest non-✅ DoD line. Don't skip ahead.
2. **State the target** — one sentence of observable behavior, PLUS expand the full DoD line
   (every clause) into a clause checklist in the journal. That checklist is the yardstick every
   reviewer receives (§2b).
3. **Falsify first** (CLAUDE.md Debugging Discipline) — call site has the method on the
   INTERFACE? Responsibility lives here? Redundancy? What else breaks? Only then code.
4. **Red-first** — assertion in the fixture harness (+ a focused in-process test). Red for the
   right reason. For live-journey lines, script the journey steps in the journal before building.
5. **Implement** — minimum change to green; nothing speculative. SPARC order for
   design-significant units (§6).
6. **Floor holds** — per repo: `pnpm run test` → `lint` → `typecheck` → `build` (portal: `pnpm
   test` → `pnpm lint` → `pnpm typecheck` → `pnpm build`; its Postgres tests need `pnpm db:up` +
   `pnpm migrate`). Vitest ONE worker, foreground, timeout, filtered.
7. **Commit** (constantly — §3).
8. **Review — ONE read-only reviewer on the unit's diff: `cello-unit-reviewer`, model
   `fable`.** One pass, four lenses: code review, spec fidelity (per-clause verdicts), failure
   integrity (buried errors, silent fallbacks), test teeth. Dispatch per §2b. Fix EVERY finding;
   commit fixes. At tier boundaries, `cello-done-auditor` audits every ✅ flip.
9. **Update docs** — flip the DoD tag (+ one-line evidence + journal pointer), journal entry.
10. Back to 1.

## 2a. Three repos — where work lands (the M10-specific discipline)
**Center of gravity: cello-portal.** Under INV-ZERO-BUMP, all per-type work is portal code;
client and directory get one-time GENERIC infrastructure only.

- **cello-portal** (`/Users/andrep/Documents/code/cello-portal`) — Next.js 16 (**read
  `node_modules/next/dist/docs/` before writing Next code** — its AGENTS.md warns the APIs drift
  from training data). Postgres via `pnpm db:up`, numbered SQL migrations via `pnpm migrate`
  (next: 0006). Existing surfaces to build on: `src/app/(app)/trust-signals/page.tsx` (the M8
  scaffold UI), `src/server/directory/` (the directory HTTP client), `src/server/trust/`.
  Already depends on `@cello-protocol/crypto`. E2E vs a real directory:
  `pnpm test:e2e:real-dir`. **The portal IS deployed — LIVE on ECS Fargate, single-region us-east-1,
  at https://portal.cello.mygentic.ai** (`infra/deploy-portal.sh`, image built in AWS by CodeBuild;
  `infra/STATE.md` §"M8 operator portal"). Corrected 2026-07-11 — the earlier "no deploy pipeline,
  local/dev only" claim was false; see [[M10-PORTAL-ARCH-INVESTIGATION]] §4.1. Portal deploys join
  the batching discipline. Signing keys for submissions/registry are new surfaces: where the portal
  key lives is a design-note decision (§6), never an env-var default — and the deployment shape it
  must be answered for is **Fargate + IAM task role + Secrets Manager + KMS** (KMS supports Ed25519
  natively: `ECC_NIST_EDWARDS25519`), not a laptop.
- **trustless-cello** (directory) — the generic write API, revocation re-auth, registry serving,
  signal-record replication, the Class-3 read path. **Batch into as few deploys as possible —
  target ONE deploy for the Tier 0/1 surface, ONE for Tier 3** (each is ~25-30 min × 3 regions).
  Any new Flyway migration updates `OpsAgentExpectedMigrationVersion` (infra/CLAUDE.md).
  Read `infra/STATE.md` before, update after, any AWS-touching session.
- **cello-client** (holder + recipient) — generic envelope store, presentation, verification,
  LLM projection/framing, policy floor. Publish cascade applies (§2c). All new tables key on
  `agent_id` (never `agent_name`), SQLCipher only (`node:sqlite` VERBOTEN), opaque payload —
  hoisting a payload field into a column is BLOCKING (spec §3 guardrail).

A unit that touches two repos states so in its journal checklist up front; never assume a change
is confined to one repo until you have read both sides.

## 2b. Reviewer dispatch — what the unit reviewer is TOLD
One `cello-unit-reviewer` dispatch per unit (model `fable`). The DISPATCH supplies: the DoD line
text VERBATIM (all clauses), the coder's clause checklist, the diff (commit range or files), and
the repo(s). Standing M10-specific instructions to include:
- **Zero-bump lens:** flag ANY per-type construct in cello-client or trustless-cello diffs —
  type enums/unions used for gating, `switch(type)`, per-type columns, per-type validation or
  rendering, a `CHECK` on `type`. BLOCKING even if tests pass.
- **Spec fidelity** against the spec-of-record section the DoD line cites (per-clause verdicts;
  silent simplification is BLOCKING; deviations legal only when pointing at a DoD Decisions entry).
- **Error fidelity** — every new/modified `catch`; trace one error path end-to-end and QUOTE the
  operator-visible message.
- **Framing integrity** — any path that hands signal content to an LLM must carry `issuer_kind`
  framing; agent-issued content is always quoted-untrusted.

- **Removal & refactor integrity (Lens 5) — DISPATCH IT EXPLICITLY on any diff that DELETES or
  MOVES code.** Lenses 1-4 all assume a diff that ADDS something (a DoD clause to check, a new
  `catch` to inspect, a new test to bypass). A diff that removes 24,000 lines, or moves 6,000
  between files, gives them nothing to bite on and sails through. Tell the reviewer the diff is a
  removal/refactor so it applies: deadness PROVEN (both repos + `exports` map + red build, never a
  grep); every DELETED test triaged by SUBJECT (a live subject behind a dead driver must be
  re-pointed, not deleted); absence asserted on the BUILT artifact; and — for a refactor —
  behavior preservation as the spec (anything that moved is a finding unless journaled).
- **Error substitution (Lens 3a2).** Not just swallowed errors — RENAMED ones. An exit-point label
  (`relay_unavailable`, `directory_unreachable`, `threshold_not_met`) standing in for the real cause
  sends the operator to the wrong subsystem for days. The upstream reason must survive in the payload.
- **The revert test (Lens 4).** For every new test: would it still pass if the fix were reverted?

## 2c. Publish + deploy sequencing
**Load `/cello-publish` for THIS publish — every publish, never from memory.** Batch publishes
per tier, not per unit; a line needing a published artifact is not ✅ until the published
artifact works. After publish: verify the BINARY (`npm view ... dependencies` — real versions,
never `workspace:*`); pin the local install and VERIFY the pin (`claude mcp get cello`).
trustless-cello references to cello-client packages stay pinned semver.
**Two human-only steps** (everything else is yours to run, no permission-asking):
`latest` promotion (always Andre's go — prepare + `--dry-run` + hand over) and `/mcp` reconnect.
When a unit needs BOTH a directory deploy AND a client publish: start the deploy first (slower),
run the cascade while it's in flight, arm the Cron 1 watchdog (§3b).

## 3. Cadence
- **Commit constantly** — never >~15 min without one. CELLO docs commit straight to main.
- **Review every unit** on its diff, right after green. Never batch reviews.
- **Fixture harness at start + end of every unit.**
- **Checkpoint at every tier boundary:** `cello-done-auditor` on every ✅ flipped since the last
  checkpoint; only EARNED stays ✅. Journal summary, commit, START A NEW JOURNAL FILE for the next
  tier (10-line resume block at top). Keep the RESUME STATE block at the top of the current
  journal file up to date — it is an obligation, not a habit.

## 3a. Autonomous-mode rules (if running overnight)
NEVER `AskUserQuestion`, never end a turn waiting. **Decision rubric: pick the common best
practice — the choice a competent engineer would recommend if asked, and least likely to need
reversing.** Log it in the DoD Decisions section, proceed (redo > block, always). Genuine
undecidable fork → PARK (DoD Parked + journal) and pull the next unit, saying so. Arm both
crons at kickoff; re-arm after every restart/compaction.

## 3b. Watchdog crons — arm both (self-contained; no other doc needed)
Cron jobs in this environment are **session-only**: gone on restart or compaction, and they fire
ONLY while the session is idle (not mid-query) — which is exactly what makes the heartbeat able
to un-stick a stalled session: a fired cron prompt is enqueued like any new instruction, so it
resumes a session that stopped. **Re-arm BOTH crons immediately after every compaction and every
session restart** — this is the single point of failure for the whole mechanism; forget it and
the session goes silent with nothing to wake it. Recurring jobs auto-expire after 7 days — at
every tier-boundary checkpoint (§3), `CronList` and recreate anything missing.

**Cron 1 — Deploy/pipeline watchdog (armed ONLY while a deploy is in flight).** Arm the moment
you run `infra/deploy.sh` or push something that triggers a CodePipeline run (directory deploys:
~25–30 min, all 3 regions in parallel). Cadence `*/4 * * * *` (an active wait, not idle sleep).
The fired prompt must check REAL health, not top-level status alone:
- **CodePipeline:** `aws codepipeline get-pipeline-state` — per-STAGE status. A stage can read
  `InProgress` while its ECS deployment is crash-looping underneath (task starts, fails health
  check, stops, restarts, forever) — "in progress" is not evidence of health.
- **ECS:** `aws ecs describe-services` → `deployments[].rolloutState`, plus task stop reasons /
  restart counts (`describe-tasks` / CloudWatch) for the crash-loop signature (same task
  definition revision repeatedly stopping and restarting).
- Genuine failure or crash-loop → STOP waiting, surface it now, diagnose per CLAUDE.md Debugging
  Discipline (producer/consumer, not the error string). Healthy and progressing → log one line,
  keep polling. Terminal (success or confirmed failure) → the prompt calls `CronDelete` on
  itself. (Separate from the tight 30s foreground poll for a single already-triggered ECS
  rollout, per repo CLAUDE.md M5 rule 9 — that stays; this cron covers the outer 25–30 min wait.)

**Cron 2 — 30-min heartbeat / anti-stall nudge (armed for the WHOLE milestone).** Cadence every
~30 min at an off-minute, e.g. `12,42 * * * *` (never `0,30`). Recurring. The fired prompt is
the self-audit:
1. Are M10-PROCEDURE / M10-DEFINITION-OF-DONE actually in context right now? If compaction
   dropped them, re-read both before doing anything else.
2. Stalled on a decision? Pick the best-practice choice (§3a rubric), log it in the DoD
   Decisions section, proceed.
3. Waiting for confirmation on something already authorized (code changes, AWS/publish actions
   per the REALITY CHECK)? Unwanted — continue now. EXCEPTION: genuinely waiting on a named
   human-only step (§2c) — state it plainly; that is a real stop, not a frivolous one; a cron
   firing is not a signal to fake progress past it.
4. >15 min since the last commit? Commit now.
5. Did the last unit go green without a `cello-unit-reviewer` dispatch? Dispatch it now.
6. State one line of current status (DoD line, red/green) so a human skimming later can see the
   session was alive and unstuck at this timestamp.

## 4. First actions (order matters)
1. **DOD-PORTAL-ARCH-1** — investigate the current portal as it actually is, then determine and
   record the M10 portal architecture (where per-type verification modules live, the background-
   job runner, key custody, the submission client, the registry publisher). It gates all portal
   code and shapes DOD-CBOR-1's where-does-the-component-live decision.
2. **DOD-CBOR-1** — the canonical-envelope component + cross-party hash agreement is the
   load-bearing foundation (spec §5: retrofitting a canonical form breaks every existing hash).
   Its design note is already written as the worked example — journal Entry 1.
3. **Design notes owed before their tiers** (§6): registry document format + portal key custody
   (before Tier 1); browser-extraction infrastructure (before Tier 4).
4. Then the loop, tier order strict.

## 5. Hard rules (non-negotiable)

### 5a. The recurring defect classes (M8C reduction work, 2026-07-13 — earned, not theoretical)

- **ABSENT IS NOT FINE.** When a guard's input is missing, unreadable, or an unrecognized shape,
  the answer is **REFUSE**. A default that lets the caller proceed is a security defect even when
  it is currently unreachable — unreachable is a property of today's SQL, not of the code. Five
  instances of ONE bug were found in a single pass: a `SELECT` with no row returning 0 (unblocking
  a send), a missing verifier skipping directory auth entirely, a missing relay witness falling
  back to arrival order, an unrecognized response shape returning `[]` through a `length > 1`
  guard, and a missing selection guessing an agent (the write landed on the wrong one). An attacker
  never has to DEFEAT these — they omit the thing that triggers the check.
  **Exception, and it is real:** if refusing would break the redundancy invariant (a node being
  unreachable must not make CELLO unusable — refusing to read mail because the relay is down makes
  the relay a precondition for the inbox), you may proceed — but the degraded path is **ANNOUNCED**
  (distinct log event / flag on the response) and the trade is journaled. **Never silent.**
  Corollary: **a signal that fires on the normal case is not a signal** — a warning that fires on a
  designed benign state buries the one occurrence that matters.

- **ERRORS NAME THEIR CAUSE, NOT THEIR EXIT POINT.** Do not SWALLOW an error (that is obvious) and
  do not **SUBSTITUTE** one (that is the expensive one). `relay_unavailable`,
  `directory_unreachable`, `transport_unavailable`, `threshold_not_met`, `ceremony_exhausted` are
  **labels on the exit point**, not causes. Real case: the surfaced error was
  `directory_unreachable`; the actual cause was `session_request_missing_peer_id` — a version-pinned
  client that never sent a required field. The name pointed at the network; the bug was in the
  payload. Days lost. Whenever a mapper collapses many upstream conditions into one terminal string,
  the upstream reason **must survive in the payload** (`cause` / `detail` / `upstream_reason`). Test:
  *would this message send a competent operator to the RIGHT subsystem?*

- **NO CONSUMER, NO SHIP.** A new return field, response flag, log event, or config knob needs a
  NAMED CONSUMER in the same unit. A field nobody reads is dead weight born dead, and it lies — a
  reader assumes something acts on it.

- **NO ARCHAEOLOGY COMMENTS.** A comment states a constraint the CURRENT code cannot show. It never
  narrates what the code used to do, who caught what in review, or which story renamed a thing — git
  holds that. But **rewrite, do not delete**: the constraint under a "previously…" comment is usually
  load-bearing, and deleting it invites the bug back. Present tense, imperative.

### 5b. Deletion & refactor discipline (a refactor IS a code review)

> **A refactor is a code review.** The finds come from having to read code closely enough to move it.
> Every anomaly surfaced during a refactor is a FINDING to log — never noise to normalise away.
> Corollary: for a refactor, **behavior preservation IS the spec**. There is no DoD clause, but there
> is an implicit one: *nothing changes.* Anything that moved is a finding unless journaled.

- **DEADNESS IS PROVEN BY DELETION, NOT BY GREP.** A grep is a hypothesis; a red build is proof.
  Before deleting or moving ANY file or export, all three:
  1. **Grep BOTH repos.** Separate workspaces — "unused" in one is routinely consumed by the other.
  2. **Read the `exports` map.** `package.json`'s `exports`/`main` **IS a consumer**. A file with no
     in-repo importer can still be a published entry point. (`crypto/frost/stubs.ts` had no
     in-package caller, was moved to `__tests__/`, and broke the directory — which imported
     `@cello-protocol/crypto/frost/stubs.js` by subpath, in five files.)
  3. **Remove it and run BOTH repos' gates.** An empty grep is suspect, not conclusive: a re-export
     with no in-package caller looks exactly like dead code (`ed25519_FROST` had zero callers in
     `core/crypto` and drove the entire client-side DKG from the daemon).
  **Never inherit a deadness claim** from a report, an analyst, a prior session, or a comment. The
  regression above came from trusting the sentence "only used by frost.test.ts."

- **TRIAGE TESTS BY SUBJECT-UNDER-TEST, NEVER BY FILE.** A test may use dead code as a *driver* while
  its subject is alive. Delete by file and live coverage vanishes with no gate noticing. 12,538 lines
  of green tests were one bad decision from deletion. If the subject is live, RE-POINT the test.

- **`dist/` ORPHANS — and the ORDER matters.** `tsc --build` never removes orphaned outputs, and
  `tsc --build --clean` does not either (the source is gone, so it is not tracked). A warm tree keeps
  compiling and PACKING files whose source you deleted. Assert absence on the **BUILT ARTIFACT**,
  never on source. **The order is: `rm -rf core/*/dist core/*/*.tsbuildinfo` → BUILD → TEST.** NOT
  clear-then-test: several tests spawn the REAL BUILT DAEMON BINARY out of `dist/`, so clearing it
  before the test run fails ~1,000 tests for a reason that has nothing to do with your change (this
  was gotten wrong while merging the very unit that introduced the rule). This trap has bitten four
  times now.

- **ENCODER / WIRE-FORMAT CHANGES: is any signature or hash over these bytes?** Mechanical, not a
  judgment call. Classify what the change alters and whether any of it is signed, hashed, or kept
  byte-identical by another implementation. (Changing the CBOR encoder altered OBJECT encoding but
  not ARRAY encoding — and every signed TBS encodes an array, so no signature was affected. Three
  commands answered what was being hedged for an hour.)

### 5c. Verification, not assertion

- **DO NOT ESCALATE WHAT YOU CAN VERIFY.** Before putting a question to Andre, check the authoritative
  source: the type definition, the RFC, the other repo's code, the actual bytes. Escalation spends his
  scarcest resource. *"The code cannot tell you"* is a claim that must ITSELF be checked. (A "one of
  these two is wrong — a human must decide" was escalated; the libp2p type definition answered it in
  one line: `close()` is a half-close, both patterns were correct.)

- **RED FOR THE RIGHT REASON — APPLY THE REVERT TEST.** *"Would this test still pass if the fix were
  reverted?"* If yes, it is not coverage, whatever its name says. Two ways it fails: the test lands on
  a NEIGHBOURING branch (exercising the already-correct guard beside the one you changed), or it passes
  for the WRONG REASON (an error fires before the code under test runs — a test with its arguments in
  the wrong ORDER still "passed" because a pre-check refused before either was read). If the changed
  line is genuinely unreachable, say so **in the test name and the commit**, not in a comment.

- **MEASURE BEFORE QUOTING A NUMBER.** A figure in a journal or DoD is measured, or it is labelled an
  estimate and the miss is recorded when it lands. (An archaeology estimate of "1,500–3,000 lines"
  came in at 354 — extrapolated from keyword counts. Coverage had never been measured at all: it is
  75%, and `daemon.ts` is 66% with 1,434 uncovered lines.) `--coverage` runs in the gate.

### 5d. Process
- **One thread. One coder (the main loop). NO parallel implementation agents.** Read-only
  subagents only (unit-reviewer / done-auditor / explorer).
- **Work directly on `main` in all three repos.** Commit often; batch directory pushes;
  portal + client + e2e pushes are free (respect §2c publish batching).
- **Zero-bump is enforced per-unit, not just at the canary.** Every client/directory diff is
  read through the "is anything here per-type?" lens (§2b). The canary (DOD-ZEROBUMP-CANARY-1)
  is the final proof, not the first check.
- **The scope is the pipes, not the catalog.** Signals beyond phone/email/track-record/GitHub
  are OUT of v1 — adding one because it looks cheap is scope creep; it becomes a playbook run
  after the canary proves the pipes. (LinkedIn/X/etc. are post-v1 playbook runs by design.)
- **No mocks for crypto; no from-scratch fixtures; no `console.log`** in implementation
  (injected logger, `domain.noun.verb` events, correlationId threading; observability ACs are
  first-class on every line).
- **Join on `agent_id`, never `agent_name`.** Opaque payload — never a payload field as a
  column, a floor predicate, or SQL. Type strings are data everywhere outside the portal.
- **Endorsements / PSI / bonds are OUT of v1** — the write path stays seam-ready for
  `issuer_kind: agent` but the intake role (Endorsement Mother) is post-v1. Do not build it
  early; do not let its absence rot the seam (the write API's authorized-issuer model must not
  hardcode "portal is the only issuer_kind that will ever submit").
- **Vitest: one worker, foreground, timeout, filtered.** Never background a test process.
- **Deferrals get a home** — DoD Parked + journal. No silent deferral.

## 6. Design-significant units — design note in the journal FIRST, then the loop

These units are NOT mechanical; each gets a **design note in the journal before any code**:
- **PORTAL-ARCH-1** — the portal investigation + architecture determination (its OUTPUT is the
  architecture section the whole milestone builds against — see the DoD line).
- **REGISTRY-1** — the registry document format, its signing key, its serve/cache/TTL path
  (spec §15.2.5; the manifest-over-HTTP precedent).
- **DIR-WRITE-1** — the authorized-issuer key set + submission signature format (spec §14.5:
  the capability format is the open piece), and portal key custody.
- **EXTRACT-1** — the browser-extraction infrastructure: a SEPARATE, security-hardened instance
  running browser-harness; credential isolation; what it may and may not touch. This is new
  infrastructure, not a code unit — it gets a full design log, and infra/STATE.md discipline.
- **FLOOR-1** — the `SignalRequirementPolicy` v1 field set (spec §14.4 defers it to here).
- **TRACK-1** — the Class-3 read path (what directory data the portal job may read, and how).

### The design-note template (use this structure; the worked example is journal Entry 1 — CBOR-1)

```markdown
### YYYY-MM-DD — Entry N: DESIGN NOTE — DOD-<UNIT> (written before any code)

**Target behavior (one sentence).** What an observer sees when this unit works.

**Spec anchors.** The exact spec-of-record sections this unit implements (cite §), plus any
RFC for crypto (Ed25519 → RFC 8032, CBOR → RFC 8949, SHA-256 → FIPS 180-4). A clause the spec
does NOT pin gets called out as a decision this note is making.

**Producer/consumer chain.** For each thing this unit creates or checks: who produces it,
who consumes it, what breaks at each hop if it's wrong. This is the map reviewers verify
against.

**The seam.** Exactly where this unit's code meets existing code (files/interfaces), and which
repo(s). What the interface must expose; what it must NOT know about (e.g. payload contents,
signal types).

**Invariants at stake.** Which DoD Tier-I invariants this unit can violate, and the specific
design property that prevents each.

**Approach + rejected alternative.** The chosen shape in 3–6 sentences, then at least ONE
alternative considered and WHY it lost. (A design note with no rejected alternative hasn't
looked hard enough.)

**Falsification pass.** Before writing code: does the call site have the method on the
INTERFACE? Does the fix location match where responsibility lives? What redundancy would this
create? What else breaks? State what you checked.

**Decisions this note makes.** Numbered; anything material graduates to the DoD Decisions
section. Anything undecidable → PARK.

**Test plan sketch.** The red-first assertions (fixture harness + focused), and which enforcer
proves the unit (harness / live journey / CBOR cross-party / canary).
```

## 7. What a checkpoint/handoff entry contains
Which DoD lines are green WITH the enforcer-run output (not a claim); the exact next red + its
one-sentence target; HEAD commits (all three repos) + whether reviewers ran to HEAD; published
package versions if a cascade shipped; anything parked; anything that changes the DoD.

---

## Related Documents

- [[M10-DEFINITION-OF-DONE]] — the yardstick + sole status authority (Decisions + Parked live there)
- [[M10-BUILD-JOURNAL]] — audit trail + evidence home
- [[M10-TYPE-PLAYBOOK]] — the per-type runbook (the repeating unit after v1)
- [[M10-TRUST-SIGNAL-STORAGE-AND-CREATION]] — spec-of-record: HOW signals are stored/created/verified
- [[M10-TRUST-SIGNAL-TAXONOMY]] — spec-of-record: WHAT the signals are
- [[M8C-PROCEDURE]] — provenance only (this document is self-contained; nothing requires reading it)
- [[2026-05-16_0800_trust-signal-verification-architecture|Trust Signal Verification Architecture]] — the OAuth/extraction design Tier 4 implements
