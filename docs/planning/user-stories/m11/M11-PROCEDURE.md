---
name: M11 Procedure — How to Work the Milestone
type: procedure
date: 2026-07-20
milestone: M11
status: open
topics: [m11, prelaunch, waitlist, gtm, email, gallery, ops-dashboard, procedure, runbook]
description: >
  The operating runbook for M11 (pre-launch infrastructure — waitlist, GTM tracking, email
  automation, Telegram gate, gallery, ops dashboard). SELF-CONTAINED — no other milestone's
  procedure needs to be read. Read FIRST, then M11-DEFINITION-OF-DONE. Two primary repos:
  corp-cello-site (landing, blog, gallery, status site) and a new ops-dashboard repo (portal
  clone). No separate SPEC or DECISIONS docs: M11-PRELAUNCH-REQUIREMENTS is the spec-of-record,
  and decisions live in the DoD's Decisions section.
---

# M11 Procedure — How to Work the Milestone

## REALITY CHECK — read before anything
One user: Andre, also the only developer. CELLO is **alpha — no production, no real users.**
- **Never gate/hedge/ask permission on a CODE change.** Correctness + security fixes ship immediately.
- **Do not invent decisions for Andre.** "Should I do this code work?" is always yes.
- **DO pause for a GENUINE design fork** (materially different architectures) — but in autonomous
  mode you PARK it (DoD "Parked" section + journal), never block.
- **AWS + publish actions are AUTHORIZED** (dev deploys, ECS, SSM, Lambda, SES, migrations, Flyway).
  Discipline is SEQUENCING + BATCHING only.

## THE MILESTONE IN ONE PARAGRAPH
Ship the full **waitlist and pre-launch GTM infrastructure**: a landing page that captures signups
with UTM attribution, a points/referral engine that ranks the queue, an email automation pipeline
(SES + EventBridge + Lambda), a session-gated status site where waitlisted users check their
position and earn points, an ops dashboard where Andre triggers wave admission and manages the
post-review queue, a Telegram gate that burns waitlist tokens at DKG time, a gallery for published
sealed receipts, and a blog platform for GEO content. The deliverable is the full loop: someone
discovers the landing page → signs up → earns points → gets admitted in a wave → burns their
token → reaches first win → gets invite codes to share.

## 0a. Severity triage (spend effort top-down, never invert)
1. **CORE CAPTURE LOOP.** Signup → E1 → email verified → queue position visible → referral link
   working. If broken → top priority. Nothing ships without this.
2. **ADMISSION INTEGRITY.** Wave assembly produces the right set; tokens are single-use and
   expire; the Telegram gate enforces the token gate; first-win fires exactly once per human.
   These are the security-load-bearing lines. Any silent bypass is critical.
3. **Real non-core gaps.** Points engine, OAuth social profiles, drip emails, gallery.
4. **Hardening / polish.**

Informed-skeptic test: would someone trying to game the queue be able to fabricate their position,
re-use a token, or skip the gate? If yes, it's not done.

## 0. Read order (every session)
1. This procedure.
2. [[M11-DEFINITION-OF-DONE]] — lowest non-✅ line = next unit; Decisions + Parked sections.
3. [[M11-BUILD-JOURNAL]] — last entries.
4. **Spec-of-record**: [[M11-PRELAUNCH-REQUIREMENTS]] — the full data schema, business intent,
   and acceptance criteria for every section. Read the relevant section before implementing its
   DoD line.
Then start the loop (§2).

## 1. The artifacts
| Artifact | Role |
|---|---|
| **M11-DEFINITION-OF-DONE** | The **yardstick + sole status authority** — ordered, status-tagged, carries Decisions + Parked. Flip tags in place; one line of evidence + `→ Entry N`, never an essay. |
| **M11-BUILD-JOURNAL** | The **audit trail + evidence home** — append-only. Full proofs, bug forensics, run output live HERE, pointed to from the DoD. Never edit a prior entry. New file per tier (`M11-BUILD-JOURNAL-T{n}.md`) seeded with a 10-line resume block. |
| **The schema enforcer** | Fresh schema == migrated schema (idempotent). A migration that fails on a DB with prior data is not ✅. |
| **The email enforcer** | SES sandbox send to a verified address, open confirmed in AWS console. |
| **The live end-to-end enforcer** | Real signup → points accrual → wave admission → token burn → Telegram gate → DKG proceeds. Telegram/admission lines are ✅ only after this journey passes. |

## 2. The core loop (one unit = one DoD line)
1. **Find the red** — lowest non-✅ DoD line. Don't skip ahead.
2. **State the target** — one sentence of observable behavior, PLUS expand the full DoD line
   (every clause) into a clause checklist in the journal. That checklist is the yardstick every
   reviewer receives (§2b).
3. **Falsify first** (CLAUDE.md Debugging Discipline) — call site has the method on the
   INTERFACE? Responsibility lives here? Redundancy? What else breaks? Only then code.
4. **Red-first** — write the test, confirm it fails for the right reason, then implement.
5. **Implement** — minimum change to green; nothing speculative.
6. **Floor holds** — `pnpm run test` → `lint` → `typecheck` → `build` (or npm equivalents per
   repo). For corp-cello-site: `npm run lint` + `npm run build`. Postgres-dependent tests
   need the DB up.
7. **Commit** (constantly — §3).
8. **Review — ONE read-only reviewer on the unit's diff: `cello-unit-reviewer`, no model
   override.** One pass: code review, spec fidelity (per-clause verdicts), failure integrity
   (buried errors, silent fallbacks), test teeth. Dispatch per §2b. Fix EVERY finding; commit
   fixes. At tier boundaries, `cello-done-auditor` audits every ✅ flip.
9. **Update docs** — flip the DoD tag (+ one-line evidence + journal pointer), journal entry.
10. Back to 1.

## 2a. Repos — where work lands
**Two primary repos for M11:**

- **corp-cello-site** (`/Users/andrep/Documents/code/corp-cello-site`) — Next.js 14, Tailwind,
  Radix UI. This is where the landing page, blog, gallery, `/auth`, and `/status` live. The
  existing `/waitlist` and `/confirm` pages are the starting point for the signup + E1 flows —
  do NOT rebuild them, extend them. Build tool: `npm` (not pnpm). No database in this repo
  itself; all DB calls go through API routes that connect to the waitlist Postgres DB.
  Deployed as a container (Dockerfile present). Read the repo structure before adding routes.

- **ops-dashboard** (new repo, clone of cello-portal) — Next.js, magic-link auth only, connects
  to the same waitlist Postgres DB via a restricted IAM role. Allowed emails from Secrets Manager
  `cello/ops/allowed-emails`. **Borrow from cello-portal verbatim:** `src/server/magic-link.ts`,
  `src/server/session-cookie.ts`, `src/server/session.ts`, `src/server/session-request.ts`,
  `src/server/email.ts`, `src/server/db.ts`, `src/server/config.ts`, `src/server/logger.ts`,
  `src/app/api/auth/magic-link/`, `migrations/0001_init.sql`, `migrations/0002_magic_link_requests.sql`.
  Strip: WebAuthn, TOTP, trust signals, directory client, agents. Auth difference: resolve email
  against Secrets Manager allowlist, not the CELLO directory.

- **trustless-cello** (`/Users/andrep/Documents/code/trustless-cello`) — only two M11 touch
  points: (a) the Telegram gate update (DOD-TELEGRAM-GATE-1) and (b) the first-win detection
  Lambda (DOD-FIRST-WIN-1, DOD-FEEDBACK-DETECTION-1). Any Flyway migration here must update
  `OpsAgentExpectedMigrationVersion` in `cello-ssm-parameters.yaml`. Read `infra/STATE.md`
  before and update after any AWS-touching session.

**Read-only reference** — cello-portal (`/Users/andrep/Documents/code/cello-portal`) for
magic-link, session, and SES patterns. Do not modify it for M11.

A unit that touches two repos states so in its journal checklist up front.

## 2b. Reviewer dispatch — what the unit reviewer is TOLD
One `cello-unit-reviewer` dispatch per unit (no model override). Supply: the DoD line text
VERBATIM (all clauses), the coder's clause checklist, the diff (commit range or files), and
the repo(s). Standing M11-specific instructions to include:

- **Admission integrity lens:** flag any path where a token could be consumed more than once,
  where `used_at IS NULL` is not checked atomically (use `FOR UPDATE SKIP LOCKED` — same pattern
  as portal's `magic-link.ts`), or where wave assembly could be triggered without an
  authenticated ops dashboard action. BLOCKING.
- **No-inflation lens:** flag any hardcoded queue position, wave assignment, or signup count.
  `DOD-INV-NO-INFLATION` — any fabricated number is BLOCKING.
- **Spec fidelity** against the M11-PRELAUNCH-REQUIREMENTS section the DoD line cites
  (per-clause verdicts; silent simplification is BLOCKING).
- **Error fidelity** — every new/modified `catch`; trace one error path end-to-end and QUOTE
  the operator-visible message.
- **Removal & refactor integrity (Lens 5)** — dispatch explicitly on any diff that DELETES or
  MOVES code. Proven deadness (grep both repos + red build), deleted-test triage by subject,
  behavior preservation as the spec.
- **Error substitution (Lens 3a2).** An exit-point label standing in for the real cause sends
  the operator to the wrong subsystem. The upstream reason must survive in the payload.
- **The revert test (Lens 4).** For every new test: would it still pass if the fix were reverted?

## 2c. Deploy sequencing
**No directory deploys for the waitlist schema or email pipeline** — the waitlist Postgres DB is
separate from the CELLO directory. Flyway migrations run against the waitlist DB only.

**corp-cello-site deploys:** container build + push via CI. No local Docker pushes (CLAUDE.md).

**ops-dashboard deploys:** same pattern as corp-cello-site once the repo exists.

**trustless-cello directory deploys** (only for DOD-TELEGRAM-GATE-1 / DOD-FIRST-WIN-1): ~25–30
min × 3 regions. Batch ALL directory changes into one push. Never trigger a directory deploy
for a single small fix — wait and batch.

**Lambda deploys** (email pipeline, first-win, feedback detection): fast, independent of the
directory deploy cycle.

## 3. Cadence
- **Commit constantly** — never >~15 min without one. CELLO docs commit straight to main.
- **Push after every commit** — each push is one focused change; do not batch pushes.
- **Review every unit** on its diff, right after green. Never batch reviews.
- **Schema enforcer on every migration** — `pnpm migrate` clean + fresh schema == migrated schema.
- **Checkpoint at every tier boundary:** `cello-done-auditor` on every ✅ flipped since the last
  checkpoint; only EARNED stays ✅. Journal summary, commit, START A NEW JOURNAL FILE for the next
  tier (10-line resume block at top).

## 3a. Autonomous-mode rules (if running overnight)
NEVER `AskUserQuestion`, never end a turn waiting. **Decision rubric: pick the common best
practice — the choice a competent engineer would recommend if asked, and least likely to need
reversing.** Log it in the DoD Decisions section, proceed (redo > block, always). Genuine
undecidable fork → PARK (DoD Parked + journal) and pull the next unit, saying so. Arm both
crons at kickoff; re-arm after every restart/compaction.

## 3b. Watchdog crons — arm both (self-contained; no other doc needed)
Cron jobs in this environment are **session-only**: gone on restart or compaction, and they fire
ONLY while the session is idle (not mid-query). **Re-arm BOTH crons immediately after every
compaction and every session restart.**

**Cron 1 — Deploy/pipeline watchdog (armed ONLY while a deploy is in flight).** Arm the moment
you push something that triggers a CodePipeline run or a Lambda deploy. Cadence `*/4 * * * *`.
The fired prompt must check REAL health:
- **CodePipeline:** `aws codepipeline get-pipeline-state` — per-STAGE status. "InProgress" is
  not evidence of health — an ECS task can be crash-looping underneath.
- **ECS:** `aws ecs describe-services` → `deployments[].rolloutState` + task stop reasons for
  the crash-loop signature.
- Genuine failure → STOP waiting, surface it, diagnose per CLAUDE.md Debugging Discipline.
  Healthy → log one line, keep polling. Terminal → `CronDelete` on itself.

**Cron 2 — 30-min heartbeat / anti-stall nudge (armed for the WHOLE milestone).** Cadence every
~30 min at an off-minute, e.g. `12,42 * * * *` (never `0,30`). Recurring.

> **The cron is a DEFIBRILLATOR, not a metronome.** Its ONLY job is to restart a session that
> somehow stalled. It is never a checkpoint, never a reason to pause, and never something to wait
> for. If you are working, a fired cron changes nothing: keep working.
> **Never call `AskUserQuestion` — it is a hard blocker that stops the session dead.**

The fired prompt is the self-audit (this list IS the cron script — re-arm from it verbatim):
1. Are M11-PROCEDURE / M11-DEFINITION-OF-DONE (+ the latest journal entry) actually in context
   right now? If compaction dropped them, re-read before doing anything else — **and RE-ARM BOTH
   CRONS if they are gone.**
2. Stalled on a decision? Resolve per §3a: verifiable from a source → verify, never escalate what
   you can check; has a best practice → take it, log an M11-D* entry, proceed; genuinely
   undecidable → PARK it and pull the next unit.
3. Waiting for confirmation on something already authorized? Continue now. **Only TWO human-only
   steps exist:** the `latest` npm dist-tag promotion and the `/mcp` reconnect. Blocked on one →
   work a DIFFERENT DoD line. Never idle.
4. >15 min since the last commit? Commit now — detailed message (the why, not the what).
5. Did the last unit go green without a `cello-unit-reviewer` dispatch? Dispatch it now.
6. State one line of current status (DoD line, red/green) so a human skimming later can see the
   session was alive at this timestamp.

**SELF-TERMINATE.** When M11 closes (all P0/P1/P2/P3 DoD lines ✅), the fired prompt calls
`CronDelete` on its own job ID.

## 4. First actions (P0 order — strictly)
The P0 lines are a dependency chain. Do not skip ahead.

1. **DOD-SCHEMA-P0-1** — the foundation. All P0 tables must exist before any endpoint or UI
   can be wired. Run the Flyway migration, verify idempotency (`pnpm migrate` on a fresh DB
   produces the same schema as migrated-then-migrated-again).
2. **DOD-TRACKING-1** — the localStorage tracking script. Must land before the signup form is
   rewired, so touchpoints are captured from day one.
3. **DOD-LANDING-1** — rewire the existing `/waitlist` form to the new Postgres endpoint + include
   `anon_id` and `touchpoints[]` from localStorage.
4. **DOD-EMAIL-INFRA-1** — confirm SES prod access; wire `email_jobs` → SQS → Lambda → SES.
5. **DOD-SIGNUP-1** — the signup endpoint itself (inserts DB rows, enqueues E1).
6. **DOD-QUEUE-VIEW-1** — the computed `queue_position` SQL view (needed by E1 and /status).
7. **DOD-E1-1** — updated E1 template with queue position + referral link.
8. **DOD-AUTH-1** — E1 link upgrades to issue a session; `/auth` magic-link page.
9. **DOD-STATUS-STUB-1** — P0 stub `/status` page behind the session gate.
10. **DOD-SES-PROD-1** — bounce/complaint handling.

Only after all P0 lines are ✅ does P1 begin.

## 5. Hard rules (non-negotiable)

### 5a. The recurring defect classes

- **ABSENT IS NOT FINE.** When a guard's input is missing or unrecognized, the answer is
  **REFUSE**. A default that lets the caller proceed is a security defect. Specific to M11:
  a missing `used_at` check on a token must hard-reject, not soft-proceed. An unknown `template`
  enum in `email_jobs` must fail loudly, not silently skip. The only exception: if refusing would
  break the redundancy invariant (a node being unreachable must not make CELLO unusable) — then
  proceed, but ANNOUNCE the degraded path and journal the trade-off. **Never silent.**

- **ERRORS NAME THEIR CAUSE, NOT THEIR EXIT POINT.** `token_expired`, `token_already_used`,
  `email_not_found` are causes. `auth_failed` is an exit-point label. The upstream reason must
  survive in the payload. Test: *would this message send a competent operator to the right
  subsystem?*

- **NO CONSUMER, NO SHIP.** A new return field, response flag, log event, or config knob needs
  a NAMED CONSUMER in the same unit.

- **NO ARCHAEOLOGY COMMENTS.** A comment states a constraint the CURRENT code cannot show.
  Never narrate what the code used to do. Present tense, imperative.

### 5b. Deletion & refactor discipline
- **DEADNESS IS PROVEN BY DELETION, NOT BY GREP.** Before deleting any file or export: grep
  both repos, read the `exports` map, remove it and run both repos' gates.
- **TRIAGE TESTS BY SUBJECT-UNDER-TEST, NEVER BY FILE.**
- **`dist/` ORPHANS.** `tsc --build --clean` does not remove orphaned outputs. Assert absence on
  the BUILT ARTIFACT. Order: `rm -rf core/*/dist core/*/*.tsbuildinfo` → BUILD → TEST.

### 5c. Verification, not assertion
- **DO NOT ESCALATE WHAT YOU CAN VERIFY.** Check the authoritative source first.
- **RED FOR THE RIGHT REASON — APPLY THE REVERT TEST.** Would this test still pass if the fix
  were reverted? If yes, it is not coverage.
- **MEASURE BEFORE QUOTING A NUMBER.** A figure in a journal or DoD is measured, or it is
  labelled an estimate.

### 5d. Process
- **One thread. One coder (the main loop). NO parallel implementation agents.** Read-only
  subagents only (unit-reviewer / done-auditor / explorer).
- **Work directly on `main` in all repos.** Commit often; batch directory pushes; corp-cello-site
  and ops-dashboard pushes are free.
- **`node:sqlite` is VERBOTEN.** SQLCipher only, everywhere in the CELLO protocol layer.
  (The waitlist Postgres DB is separate and uses standard pg — that is fine.)
- **No mocks for crypto; no `console.log`** in implementation (injected logger,
  `domain.noun.verb` events, correlationId threading).
- **Join on `agent_id`, never `agent_name`.** New waitlist tables join on `waitlist_id` (UUID).
  Never on `email`.
- **No paid SaaS.** Every service is self-hosted on AWS/GCP/open-source (DOD-INV-NO-SAAS).
- **All URLs are `*.cello.mygentic.ai`.** Never invent other domains (DOD-INV-DOMAIN).
- **Vitest: one worker, foreground, timeout, filtered.** Never background a test process.
- **Deferrals get a home** — DoD Parked + journal. No silent deferral.

## 6. What a checkpoint/handoff entry contains
Which DoD lines are ✅ WITH the enforcer-run output (not a claim); the exact next red + its
one-sentence target; HEAD commits (all active repos); anything parked; anything that changes
the DoD. Keep the RESUME STATE block at the top of the current journal file up to date.

---

## Related Documents

- [[M11-DEFINITION-OF-DONE]] — the yardstick + sole status authority (Decisions + Parked live there)
- [[M11-PRELAUNCH-REQUIREMENTS]] — the spec-of-record: full schema, business intent, ACs per section
- [[M11-BUILD-JOURNAL]] — audit trail + evidence home
- [[2026-07-12_0622_waitlist-launch-plan]] — primary source for waitlist design decisions
- [[00_WAITLIST_ANALYTICS_ARCHITECTURE]] — AWS-native architecture reference (Perplexity-sourced)
