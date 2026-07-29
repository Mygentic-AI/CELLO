---
name: M9B Procedure — How to Work the Milestone
type: procedure
date: 2026-07-29
milestone: M9B
status: open
topics: [m9b, security-governance-layer, gateway, connect-unit, procedure, runbook, sqlcipher, config-surface]
description: >
  The operating runbook for M9B — connecting the security and governance layer that M9 built and
  never ran. DERIVED FROM M10B-PROCEDURE, which is the current standard; M9's own procedure is
  considerably outdated and must not be copied. SELF-CONTAINED — read FIRST, then
  M9B-DEFINITION-OF-DONE. One repo (cello-client) plus these docs; no AWS, no directory, no portal.
---

# M9B Procedure — How to Work the Milestone

## REALITY CHECK — read before anything
One user: Andre, also the only developer. CELLO is **alpha — no production, no real users.**
- **Never gate/hedge/ask permission on a CODE change.** Correctness + security fixes ship immediately.
- **Do not invent decisions for Andre.** "Should I do this code work?" is always yes.
- **DO pause for a GENUINE design fork** (materially different architectures) — but in autonomous
  mode you PARK it (DoD "Parked" section + journal), never block.
- **AWS + publish actions are AUTHORIZED** (beta npm publish via the cascade, dev deploys, ECS, SSM,
  migrations). Discipline is SEQUENCING + BATCHING only: prove locally first; batch directory pushes
  (~25–30 min each); publish via /cello-publish, never from memory.
  **⚠️ ONE EXCEPTION, CHECK IT FIRST: if the dev environment is HIBERNATED, every AWS mutation is
  FORBIDDEN — a deploy corrupts the inventory `wake.sh` restores from, and waking is Andre's call, not
  yours. `dig +short directory-us1.cello.mygentic.ai` → `198.51.100.x` means hibernated. See §2e, which
  also lists what stays runnable (almost everything, including the live journey).**

### THE FOUR WAYS A RUN DIES — read these as hard rules, not advice

**1. FINISHING SOMETHING IS NOT A STOPPING CONDITION.** The observed failure (Andre, seen repeatedly):
a session finishes a unit, then *stops and sits there* — sometimes literally printing **"waiting for the
next cron tick"** — as though a completed section were a place to rest and the cron were a gate that
releases the next one. **It is not. Nothing releases you. There is no gate.** The instant a unit goes
green, reviewed, committed, and the DoD tag is flipped, **pull the next red DoD line and start it in the
same turn.** The correct end of a unit is the beginning of the next one. The ONLY legitimate stopping
points in the entire milestone are: the milestone is closed, or you are hard-blocked on one of the two
human-only steps (§2c) *and* every other DoD line is also blocked — which has never once been true.

**2. NEVER ASK A QUESTION.** `AskUserQuestion` is a **hard blocker that stops the session dead** — in
autonomous mode nobody is there, so it does not "wait for an answer," it ends the run. Never call it.
This includes the softer shapes: "Want me to…?", "Shall I proceed?", "Let me know if…", ending a turn on
a proposal. Andre answered every open fork on 2026-07-28 (DoD `the design note`..`D10`) precisely so that
nothing needs asking. If something genuinely new appears: verifiable → verify it; has a best practice →
take it and log an `M9B-D*`; genuinely undecidable → PARK it and pull the next unit. All three end with
you still working.

**3. THE CRON IS A DEFIBRILLATOR, NOT A METRONOME.** It exists ONLY to restart a session that already
stalled. It is never a checkpoint, never a permission to continue, never something to wait for or work
toward. If you are working when it fires, it changes nothing — keep going. Full rule in §3b, and it is
the same failure as (1) wearing a different hat.

**4. COMMIT AND PUSH CONSTANTLY — never >~15 min.** Every fix, every doc update, every green unit.
Push after every commit; never batch pushes (Andre reviews by push, not by commit). An uncommitted hour
is an hour that a compaction, a crash, or a branch switch can delete. Detailed messages — the why, the
forensics, the decision — because Andre relies heavily on them.

## THE MILESTONE IN ONE PARAGRAPH
M9 built the whole security and governance layer in June 2026 and proved it end-to-end — inbound
sanitization, the injection matcher, the language allowlist, outbound secret redaction (222-rule
gitleaks), PII whitelist + bulk-dump warn, rate limiting, the four governance dispositions, the
versioned tighten-free/loosen-confirmed config store, hash-chained security-pass records. **None of
it ran.** The daemon's composition root never set `config.securityGateway`, so every shipped daemon
fell back to `PassthroughGatewayClient` — an always-allow stub — and announced `mode:"passthrough"`
on every boot for seven weeks. The June gate injected the client itself, so it proved the layer
works *when connected* and hid that only the test connected it. **M9B is wiring, custody, surface
and gate integrity — not construction.** Everything it switches on already exists.

**The five decisions of record** (2026-07-27 policy audit §10, Andre 2026-07-28 — do not
re-litigate): **D-2** reconnect ENFORCING, everything except the deferred DeBERTa model, shipping
the operator escape hatch in the same unit · **D-3** local policy lives in the client's encrypted
database, one key, covered by backup; the separate-key `SI-001` guarantee relocates to the remote
scanner where it is physically enforceable · **D-4** a loosening needs a human confirmation, CLI
prompt now and portal passkey later · **D-5** the `CELLO_GATEWAY_*` policy overrides leave shipped
builds · **D-11** one small "what did my policy do" command, shipping WITH the flip because it is
the answer to "is this new error the flip or my own work?".

## 0a. Severity triage (spend effort top-down, never invert)
1. **CORE JOB.** A stock-install daemon — the shipped bin, no test injection — boots with the
   screening sidecar running, screens every outbound send and every inbound ingest, redacts a real
   secret, sanitizes a crafted inbound, RECORDS both where the operator can read them, and
   announces its mode truthfully. Broken or missing → top priority.
2. **SILENTLY-BROKEN CORE / SECURITY HOLE.** Looks done, kernel missing. **The most dangerous
   category — it is the exact failure that created this milestone.** Specifically:
   - **Injection-seam theatre** — a gate that constructs the gateway client itself proves nothing
     about the product. The enforcer anchors to the SHIPPED composition root, spawning the real bin.
   - **Silent passthrough downgrade** — any path where spawn/connect failure quietly lets content
     flow unscreened. Fail-closed and ANNOUNCED, or it is the old defect with extra steps.
   - **Screened but unrecorded** — the layer acting on a message while the audit trail stays empty.
     Proven live 2026-07-29: outbound redaction fired and `security_records` had zero rows.
   - **Agent self-loosening** — any machine-drivable path that produces the loosen-confirmation.
   - **Plaintext resurrection** — gateway state readable on disk, or a new `node:sqlite` import.
     The ESLint allowlist only ever SHRINKS.
   - **Env bypass resurrection** — a removed `CELLO_GATEWAY_*` override quietly resurfacing.
3. **Real non-core gaps.** 4. **Hardening / polish.**

Informed-skeptic test: would someone who deeply understands this say it works, or that the kernel is
missing? **For M9B the informed skeptic runs the daemon, greps `~/.cello/daemon.log` for the `mode`
field, sends one message, and reads `cello policy log`.** That is the bar.

## 0. Read order (every session)
1. This procedure.
2. [[M9B-DEFINITION-OF-DONE]] — Orientation first, then the lowest non-✅ line = next unit;
   Decisions + Parked.
3. [[M9B-BUILD-JOURNAL]] — the RESUME STATE block + the last entries.
4. **Decisions-of-record:** [[2026-07-27_2049_policy-surface-audit-touchpoints-and-open-decisions]]
   — §0 the finding, §10 D-2/D-3/D-4/D-5/D-11 with Andre's reasoning, §14 the settings register,
   §15 the work list.
5. **Background only when a unit needs it:** [[M9-DEFINITION-OF-DONE]] and [[M9-BUILD-JOURNAL]] are
   the JUNE record of what was built. **[[M9-PROCEDURE]] is considerably outdated — do not copy
   from it.** This document derives from [[M10B-PROCEDURE]], which is the current standard.
Then start the loop (§2).

## 1. The artifacts
| Artifact | Role |
|---|---|
| **M9B-DEFINITION-OF-DONE** | The **yardstick + sole status authority**. Flip tags in place; one line of evidence + `→ Entry N`, never an essay. |
| **M9B-BUILD-JOURNAL** | The **audit trail + evidence home** — append-only. Full proofs, forensics, run output live HERE. Keep the RESUME STATE block current. |
| **The composition-root live gate** | **Enforcer.** Spawns the real `cello-daemon` binary (shipped bin, zero injection) plus its real sidecar and drives real traffic. THE lesson of this milestone: a test that does its own wiring certifies nothing. No line is ✅ on an injection-seam test. |
| **The operator's own daemon** | **Final enforcer.** `~/.cello/daemon.log` reads `mode:"enforcing"`, one real message produces a record in `cello policy log`. Vitest green ≠ done; the June gate was green for seven weeks. |

## 2. The core loop (one unit = one DoD line)
1. **Find the red** — lowest non-✅ DoD line. Don't skip ahead.
2. **State the target** — one sentence of observable behavior, PLUS expand the full DoD line (every
   clause) into a clause checklist in the journal. That checklist is the yardstick every reviewer
   receives (§2b).
3. **Falsify first** (CLAUDE.md Debugging Discipline) — call site has the method on the INTERFACE?
   Responsibility lives here? Redundancy? What else breaks? Only then code.
4. **Red-first** — assertion in the fixture harness (+ a focused in-process test). Red for the right
   reason. For live-journey lines, script the journey steps in the journal before building.
5. **Implement** — minimum change to green; nothing speculative. SPARC order for design-significant
   units (§6).
6. **Floor holds** — per repo: `pnpm run test` → `lint` → `typecheck` → `build` (portal: its Postgres
   tests need `pnpm db:up` + `pnpm migrate`). Vitest ONE worker, foreground, timeout, filtered.
7. **Commit** (constantly — §3).
8. **Review — ONE read-only reviewer on the unit's diff: `cello-unit-reviewer`, NO model override.**
   (This corrects M10-PROCEDURE, which still says model `fable`; that override was revoked 2026-07-11.)
   One pass, five lenses: code review, spec fidelity (per-clause verdicts), failure integrity (buried
   errors, error substitution, silent fallbacks), test teeth, removal/refactor integrity. Dispatch per
   §2b. Fix EVERY finding; commit fixes. At tier boundaries, `cello-done-auditor` audits every ✅ flip.
9. **Update docs** — flip the DoD tag (+ one-line evidence + journal pointer), journal entry.
10. Back to 1.

## 2a. One repo — where work lands
**Everything is `cello-client`.** `core/gateway` (the stores, the bin, spawn plumbing), `core/daemon`
(composition root, seam, config IPC, policy log), `core/cli` (`cello config`, `cello policy log`,
the TTY confirm), `core/adapter-claude-code` (the MCP surface + SKILL.md, which SHIPS in the connect
tarball and instructs agents on the operator's machine).

**`trustless-cello` is docs only** — this folder. **No AWS, no directory, no portal.** A session
reaching for `infra/` has drifted.

Standing client rules: new tables/columns key on `agent_id`, never `agent_name`; SQLCipher only
(`node:sqlite` VERBOTEN, and the eslint allowlist only shrinks); the client is a heavy local node,
so install size, process lifecycle and client-side migration all matter; extend the existing
fixtures, never write a from-scratch `makeFixture()`.

**If another session is live in the checkout, branch and worktree FIRST — before the first build.**
Run `git status -sb` and `git worktree list` at kickoff. Sharing a tree means sharing `node_modules`,
`dist/` and the lockfile: a `pnpm install` or a repo-wide `vitest` sweep lands underneath the other
agent's gate run and fails it for reasons unrelated to their code. Learned the hard way against the
M10B session, 2026-07-29. **Filtered test runs only** — never a repo-wide sweep, even in your own
worktree.

## 2b. Reviewer dispatch — what the unit reviewer is TOLD
One `cello-unit-reviewer` dispatch per unit, **NO model override**. **It is the ONLY review agent
this project uses — `cello-done-auditor` is RETIRED, never dispatch it** (§3). The dispatch supplies
the DoD line VERBATIM, the coder's clause checklist, the diff, and the repo. Standing M9B lenses:

- **Composition-root lens.** Flag any test presented as proof of PRODUCT behavior that injects
  `config.securityGateway` or constructs a gateway client itself. Fine as a unit test; BLOCKING as
  an enforcer.
- **Fail-closed lens.** Any path where the gateway being absent/unspawnable/timed-out lets content
  flow unscreened or reports success. A timeout is a verdict, never a hang, never a pass (INV-6).
  Degradation is ANNOUNCED via a named event.
- **Screened-but-unrecorded lens.** A verdict acted on with no durable record is the audit trail
  lying by omission — a clean pass is recorded too, because an absent record for a delivered
  message is itself evidence of suppression. Verify the record is READABLE by the operator surface,
  not merely written.
- **Self-loosening lens.** Any machine-drivable path (MCP, IPC, env, file import) that can produce
  or bypass the loosen confirmation. State the residual honestly rather than overclaiming.
- **Custody lens.** Gateway state outside SQLCipher; any `node:sqlite`. Assert absence on the BUILT
  artifact, never on source.
- **Error substitution.** An exit-point label standing in for the real cause. The upstream reason
  must survive into the payload.
- **The revert test.** For every new test: would it still pass if the fix were reverted?

## 2c. Publish sequencing
**Load `/cello-publish` for THIS publish — every publish, never from memory** (hook-enforced;
loading it earlier in the session does not count). Batch the unit into ONE cascade.

**The trap that nearly shipped a no-op, 2026-07-29:** local versions EQUALLED published beta because
another milestone's cascade shipped those numbers before this work merged. **Same version, different
content — npm keeps the old build forever.** Compare CONTENT, never the version string: if any
`core/*` source changed since that package was last published, it bumps.

**Verify against the TARBALL, not the CI badge:** `npm pack` the package that changed and grep
`dist/`; confirm cross-pins are real versions, never `workspace:*`.

**Two human-only steps, DEFERRED and never awaited:** the `latest` promotion (prepare + `--dry-run`
+ hand to Andre — **never run it**) and the `/mcp` reconnect.

## 2d. No infrastructure
M9B touches **no AWS**. There is no deploy, no migration, no `infra/STATE.md` obligation, and no
hibernation check — those sections exist in [[M10B-PROCEDURE]] because that milestone deploys a
directory. If this unit finds itself reading `infra/`, it has drifted; re-read the scope fence.

## 3. Cadence
- **Commit constantly** — never >~15 min without one. CELLO docs commit straight to main. This is
  cheap insurance against exactly one thing: work that exists only in a working tree is work a
  compaction, a crash, or a branch switch can delete.
- **Push after every commit** — each push is one focused change; do not batch pushes. Andre reviews by
  push, not by commit.
- **Commit at every boundary, not just on the clock** — after each fix, each doc update, each green
  unit, each DoD tag flip, each STATE.md change. "I'll commit once the section is done" is how a
  section's worth of work gets lost.
- **Review every unit** on its diff, right after green. Never batch reviews.

> ### 🚨 ONE REVIEW PASS PER ARTIFACT. TWO IS THE ABSOLUTE MAXIMUM. THIS IS A HARD CAP.
> **"Review every unit" is NOT "review until the report comes back empty."** It never will. **Reviewers
> always find something — every single time.** That is what they are for, and it means an unbounded
> review loop has **no termination condition**. A human asked to review a document reviews it *once*,
> hands over the findings, and moves on; nobody re-reviews the same artifact until it comes back clean.
>
> **The rule:**
> 1. **One pass.** Read the findings. Fix what is real.
> 2. **A second pass ONLY if the first found a defect that changed the artifact's shape** — not to
>    confirm the fixes landed. You can read your own diff.
> 3. **There is no third pass. Ever.** If a third feels necessary, the artifact is not the problem —
>    the work has become the reviewing.
> 4. **Remaining findings become ACs on the units they affect**, and the per-unit review catches them
>    there. That is what per-unit review is *for*. A determination does not have to be perfect; it has
>    to be good enough that a competent coder builds the right thing with the unknowns named.
>
> **What this cost, so it is never repeated (2026-07-28/29, Andre: *"0%? WTF?"*):** `DOD-END-ARCH-1`
> took **four completed review passes plus a fifth**, consumed an ENTIRE overnight session, and shipped
> **zero lines of code**. Each pass found real defects — that is precisely the trap, because it always
> feels justified in the moment. The findings were genuine and the process was still a failure. **A
> milestone is delivered in code, not in determinations.**
>
> Applies to design notes, determinations, and diffs alike. It is a rabbit hole with a review-shaped
> disguise (CLAUDE.md: *"am I burning tokens and time… so that two hours later we ask why are we even
> fixing this?"*).
- **Fixture harness at start + end of every unit.**
- **Checkpoint at every tier boundary:** `cello-done-auditor` on every ✅ flipped since the last
  checkpoint; only EARNED stays ✅. Journal summary, commit, START A NEW JOURNAL FILE for the next tier
  (10-line resume block at top). Keep the RESUME STATE block at the top of the current journal file up
  to date — it is an obligation, not a habit.

## 3a. Autonomous-mode rules (if running overnight)
**NEVER `AskUserQuestion` — it hard-blocks and ends the run.** Never end a turn waiting, on anything.
**Decision rubric: pick the common best practice —** the choice a competent engineer would recommend if
asked, and least likely to need reversing. Log it in the DoD Decisions section, proceed (redo > block,
always). Genuine undecidable fork → PARK (DoD Parked + journal) and pull the next unit, saying so. Arm
both crons at kickoff; re-arm after every restart/compaction.

**The two human-only steps are DEFERRED, never awaited** (§2c): prepare the `latest` promotion, journal
it, keep working. Same for the `/mcp` reconnect. **And a finished unit is not a stopping point** — flip
the tag, commit, push, then start the next red line in the same turn (REALITY CHECK §1).

**The four forks this milestone opened are CLOSED** — Andre answered all of them on 2026-07-28, plus the
ingress shape and anonymous variants. See DoD Decisions `the design note` through `the design note`. Do not re-open, do
not park, do not treat any of them as a fork: refusal messaging, `same_operator` placement, vocabulary,
rate limiting, ingress shape, anonymous endorsements. What is still open is scoped INTO
`DOD-END-ARCH-1` (intake-key distribution and rotation; queue ack/poison + retention; naming an account
subject) and is the determination's job, not a blocker.

## 3b. Watchdog crons — arm both (self-contained; no other doc needed)
Cron jobs in this environment are **session-only**: gone on restart or compaction, and they fire ONLY
while the session is idle (not mid-query) — which is exactly what lets the heartbeat un-stick a stalled
session. **Re-arm BOTH crons immediately after every compaction and every session restart** — this is
the single point of failure for the whole mechanism. Recurring jobs auto-expire after 7 days; at every
tier-boundary checkpoint, `CronList` and recreate anything missing.

**Cron 1 — Deploy/pipeline watchdog (armed ONLY while a deploy is in flight).** Arm the moment you run
`infra/deploy.sh` or push something that triggers a CodePipeline run. Cadence `*/4 * * * *`. The fired
prompt must check REAL health, not top-level status alone:
- **CodePipeline:** `aws codepipeline get-pipeline-state` — per-STAGE status. A stage can read
  `InProgress` while its ECS deployment crash-loops underneath; "in progress" is not evidence of health.
- **ECS:** `aws ecs describe-services` → `deployments[].rolloutState`, plus task stop reasons / restart
  counts for the crash-loop signature.
- Genuine failure → STOP waiting, surface it, diagnose per CLAUDE.md Debugging Discipline (producer/
  consumer, not the error string). Healthy → log one line, keep polling. Terminal → `CronDelete` on
  itself.

**Cron 2 — 30-min heartbeat / anti-stall nudge (armed for the WHOLE milestone).** Cadence every ~30 min
at an off-minute, e.g. `12,42 * * * *` (never `0,30`). Recurring.

> **The cron is a DEFIBRILLATOR, not a metronome (Andre, 2026-07-14 — a colossal-violation-level rule).**
> Its ONLY job is to restart a session that somehow stalled. It is never a checkpoint, never a reason to
> pause, and never something to wait for. Output of the shape *"waiting for the next cron tick"* is
> itself the bug it exists to prevent. If you are working, a fired cron changes nothing: keep working.
> **And never call `AskUserQuestion` — it is a hard blocker that stops the session dead.**
>
> **The specific observed failure, restated because it keeps happening (Andre, 2026-07-28):** a session
> finishes a section, then *stops and sits there*, sometimes literally printing "waiting for the next
> cron tick" — as if completing a unit created a condition to wait on, and the tick were what releases
> the next one. **Completing a unit releases nothing, because nothing was holding you.** The tick is not
> a turn boundary, not a permission, not a checkpoint, and not a scheduler you hand work back to. If you
> have just finished something, that is the moment with the LEAST reason to stop: the context is hot and
> the next red line is one lookup away. Flip the tag, commit, push, pull the next line, keep going.

The fired prompt is the self-audit (this list IS the cron script — re-arm from it verbatim):
1. Are M9B-PROCEDURE / M9B-DEFINITION-OF-DONE (+ the latest journal entry) actually in context right
   now? If compaction dropped them, re-read before doing anything else — **and RE-ARM BOTH CRONS if they
   are gone.**
2. Stalled on a decision? Resolve per §3a: verifiable from a source → verify, never escalate what you can
   check; has a best practice → take it, log an `M9B-D*` entry, proceed (redo > block); genuinely
   undecidable → PARK it and pull the next unit.
3. Waiting for confirmation on something already authorized (code, AWS/dev deploys, pushes to main, beta
   publishes per the REALITY CHECK)? Unwanted — continue now. **Only TWO human-only steps exist** (§2c):
   the `latest` dist-tag promotion and the `/mcp` reconnect. Blocked on one → say so plainly and work a
   DIFFERENT DoD line meanwhile. Never idle.
4. **Publishing? Load `/cello-publish` for THIS publish — every publish, no exceptions.** Loading it
   earlier in the session does NOT count; that is the known failure mode and it has burned npm versions
   and shipped `workspace:*` cross-pins. Hook-enforced. Publish to **beta**; pin the local install to the
   exact version and VERIFY the pin (`claude mcp get cello`); verify the published BINARY.
   **Never run the `latest` promotion** — prepare + `--dry-run` + hand to Andre.
5. **Deploying? Start the slow thing FIRST and keep coding while it is in flight.** Never idle on a
   deploy. Arm Cron 1 while one is in flight; batch directory pushes (§2a). **Touched AWS since the last
   tick? `infra/STATE.md` updated and committed — right now, not at story close** (§2d).
6. >15 min since the last commit? Commit now — **detailed message** (the why, the forensics, the
   decision; Andre relies heavily on commit messages, so never scrimp on them). Push it.
7. Did the last unit go green without a `cello-unit-reviewer` dispatch? Dispatch it now.
8. **Did you FINISH something and stop?** Then the stall this cron exists to fix has already happened —
   you are the patient, not the doctor. Flip the DoD tag, commit, push, **pull the next red line and
   start it before this turn ends.** A completed unit is never a resting point (REALITY CHECK §1).
9. State one line of current status (DoD line, red/green) so a human skimming later can see the session
   was alive and unstuck at this timestamp — then **keep working in the same turn.** The status line is
   a note to a later reader, not a sign-off, and never the last thing a turn does.

**SELF-TERMINATE (mandatory).** When M9B closes (the milestone closes), or the work is otherwise
finished, abandoned, or handed back, the fired prompt calls `CronDelete` on its own job ID. A heartbeat
left armed after the work is done wakes the session forever. This clause belongs IN the cron prompt, not
only here.

## 4. First actions (order matters)
1. **Check for another session in the checkout** (§2a) — branch + worktree BEFORE the first build.
2. Lowest non-✅ DoD line. Design-significant units get their journal design note FIRST (§6).
3. Then the loop, line order strict.

## 5. Hard rules (non-negotiable)

### 5a. The recurring defect classes

- **ABSENT IS NOT FINE.** When a guard's input is missing, unreadable, or an unrecognized shape, the
  answer is **REFUSE**. A default that lets the caller proceed is a security defect even when it is
  currently unreachable — unreachable is a property of today's SQL, not of the code. **Specific to
  M9B:** a gateway that cannot be reached must FAIL CLOSED with the real cause, never pass content;
  an unconfigured guard applies its TIGHTEST default, never a permissive one; a missing store must
  refuse to open, never fall back to plaintext; and a verdict acted on must leave a record. An attacker never has to DEFEAT these — they
  omit the thing that triggers the check. **Exception, and it is real:** if refusing would break the
  redundancy invariant (a node being unreachable must not make CELLO unusable), you may proceed — but
  the degraded path is **ANNOUNCED** (distinct log event / flag on the response) and the trade is
  journaled. **Never silent.** Corollary: a signal that fires on the normal case is not a signal.

- **ERRORS NAME THEIR CAUSE, NOT THEIR EXIT POINT.** Do not SWALLOW an error and do not **SUBSTITUTE**
  one. `intake_rejected` is an exit-point label; `scanner_injection_pattern`, `same_operator_account_subject`,
  `issuer_not_authenticated` are causes. Whenever a mapper collapses many upstream conditions into one
  terminal string, the upstream reason **must survive in the payload**. Test: *would this message send a
  competent operator to the RIGHT subsystem?*

- **NO CONSUMER, NO SHIP.** A new return field, response flag, log event, or config knob needs a NAMED
  CONSUMER in the same unit. A field nobody reads is dead weight born dead, and it lies.

- **NO ARCHAEOLOGY COMMENTS.** A comment states a constraint the CURRENT code cannot show. It never
  narrates what the code used to do or which story renamed a thing. But **rewrite, do not delete**: the
  constraint under a "previously…" comment is usually load-bearing. Present tense, imperative.

### 5b. Deletion & refactor discipline (a refactor IS a code review)

> **A refactor is a code review.** Every anomaly surfaced during one is a FINDING to log — never noise
> to normalise away. For a refactor, **behavior preservation IS the spec**: anything that moved is a
> finding unless journaled.

- **DEADNESS IS PROVEN BY DELETION, NOT BY GREP.** Before deleting or moving ANY file or export, all
  three: grep BOTH repos; read the `exports` map (a published entry point is a consumer even with no
  in-repo importer); remove it and run BOTH repos' gates. **Never inherit a deadness claim** from a
  report, a prior session, or a comment.
- **TRIAGE TESTS BY SUBJECT-UNDER-TEST, NEVER BY FILE.** A test may use dead code as a *driver* while
  its subject is alive. If the subject is live, RE-POINT the test.
- **`dist/` ORPHANS — and the ORDER matters.** `tsc --build --clean` does NOT remove orphaned outputs.
  Assert absence on the **BUILT ARTIFACT**, never on source. Order: `rm -rf core/*/dist
  core/*/*.tsbuildinfo` → BUILD → TEST. Not clear-then-test — several tests spawn the real built daemon
  binary out of `dist/`.
- **ENCODER / WIRE-FORMAT CHANGES: is any signature or hash over these bytes?** Mechanical, not a
  judgment call. **Acutely relevant here:** the payload shape for a client-sourced signal is new, and
  everything in the envelope is inside the hash. A payload field added after the first endorsement is
  minted does not retroactively exist.

### 5c. Verification, not assertion
- **DO NOT ESCALATE WHAT YOU CAN VERIFY.** Before putting a question to Andre, check the authoritative
  source: the type definition, the RFC, the other repo's code, the actual bytes. *"The code cannot tell
  you"* is a claim that must ITSELF be checked.
- **RED FOR THE RIGHT REASON — APPLY THE REVERT TEST.** Would this test still pass if the fix were
  reverted? If yes, it is not coverage, whatever its name says.
- **MEASURE BEFORE QUOTING A NUMBER.** A figure in a journal or DoD is measured, or it is labelled an
  estimate and the miss is recorded when it lands.

### 5d. Process
- **One thread. One coder (the main loop). NO parallel implementation agents.** Read-only subagents only
  (unit-reviewer / done-auditor / explorer).
- **Work directly on `main` in all three repos.** Commit often; batch directory pushes; portal + client
  pushes are free (respect §2c publish batching).
- **Zero-bump is enforced per-unit, not just at the playbook run.** Every client/directory diff is read
  through the "is anything here per-type?" lens (§2b). `DOD-END-PLAYBOOK-1` is the final proof, not the
  first check.
- **The scope is the SOURCE and the two MECHANISMS, not the catalog.** Attestation types beyond
  `endorsement` are OUT — they become playbook runs once the source exists. Adding one because it looks
  cheap is scope creep.
- **Nothing that is gated on policy D-12 (tabled).** Any rule of the form "an endorsement SUBSTITUTES
  for requirement X" is out of scope until D-12 is answered. Endorsements ship, are held, presented, and
  withdrawn without it.
- **No mocks for crypto; no from-scratch fixtures; no `console.log`** in implementation (injected
  logger, `domain.noun.verb` events, correlationId threading; observability ACs are first-class on every
  line).
- **Join on `agent_id`, never `agent_name`.** Opaque payload — never a payload field as a column, a
  floor predicate, or SQL. Type strings are data everywhere outside the portal.
- **Vitest: one worker, foreground, timeout, filtered.** Never background a test process.
- **Deferrals get a home** — DoD Parked + journal. No silent deferral.

## 6. Design-significant units — design note in the journal FIRST, then the loop

**Every design note names its unit's FULL observability event set** (`domain.noun.verb`, context fields,
correlationId threading, error paths) before any code — the DoD lines name only headline events, and the
reviewer verifies the implementation against the design note.

These units are NOT mechanical; each gets a **design note in the journal before any code**:
- **`DOD-END-ARCH-1`** — the determination. The ingress SHAPE is settled (`the design note`) and so are
  `same_operator` placement (`the design note`), the pending surface (`the design note`) and vocabulary (`the design note`) —
  what remains is the detail those decisions opened: the intake-key distribution + rotation question,
  the queue's ack/poison and retention semantics, how an account subject is named at intake, the payload
  split, where the consent state physically lives, and expiry. Its OUTPUT is the architecture the
  milestone builds against.
- **`DOD-END-QUEUE-1`** — the sealed submission queue: schema (and the test asserting no plaintext, no
  payload, no PII), exactly-once drain, poison handling, retention. It carries the milestone's directory
  migration, so it is designed BEFORE the deploy is batched, not during.
- **`DOD-END-SCAN-1`** — the deterministic scanner suite, its versioning, and what "byte-identical
  across nodes" obliges when intake is a portal singleton at launch.
- **`DOD-END-ACCEPT-1`** — the consent state model: where it lives, what transitions exist, and how a
  refused endorsement is made indistinguishable from a nonexistent one.
- **`DOD-END-REVOKE-2`** — the revocation authority model: exact-pubkey for agent-issued alongside
  role-based for portal-issued, and what the tombstone carries.

### The design-note template (use this structure)

```markdown
### YYYY-MM-DD — Entry N: DESIGN NOTE — DOD-<UNIT> (written before any code)

**Target behavior (one sentence).** What an observer sees when this unit works.

**Spec anchors.** The exact spec-of-record sections this unit implements (cite §), plus any RFC for
crypto (Ed25519 → RFC 8032, CBOR → RFC 8949, SHA-256 → FIPS 180-4) and any policy D-number it
implements. A clause the spec does NOT pin gets called out as a decision this note is making.

**Producer/consumer chain.** For each thing this unit creates or checks: who produces it, who consumes
it, what breaks at each hop if it's wrong. This is the map reviewers verify against.

**The seam.** Exactly where this unit's code meets existing code (files/interfaces), and which repo(s).
What the interface must expose; what it must NOT know about (payload contents, signal types).

**Invariants at stake.** Which Tier-I invariants this unit can violate, and the specific design property
that prevents each. For M9B, name explicitly how it cannot violate INV-9 (connected by default,
passthrough test-only) and INV-10 (no side door on the loosen gate).

**Approach + rejected alternative.** The chosen shape in 3–6 sentences, then at least ONE alternative
considered and WHY it lost. (A design note with no rejected alternative hasn't looked hard enough.)

**Falsification pass.** Before writing code: does the call site have the method on the INTERFACE? Does
the fix location match where responsibility lives? What redundancy would this create? What else breaks?
State what you checked.

**Decisions this note makes.** Numbered; anything material graduates to the DoD Decisions section.
Anything undecidable → PARK.

**Test plan sketch.** The red-first assertions (fixture harness + focused), and which enforcer proves
the unit (harness / live journey / playbook run).
```

## 7. What a checkpoint/handoff entry contains
Which DoD lines are ✅ WITH the enforcer-run output (not a claim); the exact next red + its one-sentence
target; HEAD commits (all three repos) + whether reviewers ran to HEAD; published package versions if a
cascade shipped; anything parked; anything that changes the DoD. Keep the RESUME STATE block at the top
of the current journal file up to date.

---

## Related Documents

- [[M9B-DEFINITION-OF-DONE]] — the yardstick + sole status authority (Decisions, Parked)
- [[M9B-BUILD-JOURNAL]] — audit trail + evidence home
- [[2026-07-27_2049_policy-surface-audit-touchpoints-and-open-decisions]] — decisions-of-record:
  §0 the finding, §10 D-2/D-3/D-4/D-5/D-11, §14 the settings register, §15 the work list
- [[M9-DEFINITION-OF-DONE]] / [[M9-BUILD-JOURNAL]] — the JUNE record of what M9 built and proved
- [[M9-PROCEDURE]] — **outdated. Do not copy from it.** Copying its tier-boundary step is how the
  retired `cello-done-auditor` got dispatched twice in one session.
- [[M10B-PROCEDURE]] — the current standard this document derives from
- [[M8C-DEFINITION-OF-DONE]] — `DOD-CRYPTO-AT-REST-1` (custody, closed here) and `DOD-CONFIG-1`
  (the parked surface this milestone builds)
