---
name: M10B Procedure — How to Work the Milestone
type: procedure
date: 2026-07-28
milestone: M10B
status: open
topics: [m10b, endorsements, attestations, trust-signals, agent-issued, consent, procedure, runbook, three-repo]
description: >
  The operating runbook for M10B (endorsements and attestations — the client-supplied source).
  SELF-CONTAINED — no other milestone's procedure needs to be read. Read FIRST, then
  M10B-DEFINITION-OF-DONE. Three repos with the center of gravity in cello-portal. Inherits M10's
  trust-signal machinery (three-repo discipline, publish cascade, design-note template) and M11's
  corrections (reviewer dispatch carries NO model override). No separate SPEC or DECISIONS doc: the
  two M10 design docs remain the spec-of-record and decisions live in the DoD's Decisions section.
---

# M10B Procedure — How to Work the Milestone

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
a proposal. Andre answered every open fork on 2026-07-28 (DoD `M10B-D2`..`D10`) precisely so that
nothing needs asking. If something genuinely new appears: verifiable → verify it; has a best practice →
take it and log an `M10B-D*`; genuinely undecidable → PARK it and pull the next unit. All three end with
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
M10 built the universal **mint → notarize → deliver → present → verify → consume** pipe and proved it
generic with the zero-bump canary. That pipe has **three raw-plaintext sources**: the portal researches
the fact (GitHub, phone, email, portal security), the directory supplies it over a read path (usage /
track record), and — this milestone — **the client supplies it** (endorsements). *In all three the
portal mints, and the directory stores the hash and passes it on.* M10B adds the third inbound arm, plus
the two new **mechanisms** that client-supplied content forces — **subject consent** (an object authored
by a third party can land in your wallet unbidden, so presentability requires acceptance) and
**issuer-side withdrawal** (the creator can retract it, reaching people who already hold a copy). After
that, `endorsement` itself is an ordinary [[M10-TYPE-PLAYBOOK]] run, and so is every attestation type
after it.

**How the client hands its plaintext over — settled, `M10B-D2`, do not re-litigate it.** A
**directory-mediated sealed submission queue**: Bob's daemon signs the submission with his agent key,
seals it to the portal's intake key, and writes it to any directory node; the portal drains, verifies
the signature (deriving `issuer_pubkey` from it), scans, mints. The mirror image of the M10-D22 sealed
pickup transport — the directory carries a blob it cannot read, in the other direction. The daemon never
calls the portal directly. If a plan starts with a daemon→portal HTTP call or a libp2p agent inside the
Next.js app, it has ignored a decision.

**What this milestone is NOT.** It does not add an issuer, a signing key, a chokepoint, or a new
**notarization** path (the queue is transport; nothing new writes `signal_records`). Spec §6's
2026-07-11 amendment settles the rest: all three flows route through the portal backend, and the
directory's authorized-issuer key set collapses to portal keys. Any plan that starts by enrolling agent
keys as authorized issuers has mis-scoped the milestone.

## 0a. Severity triage (spend effort top-down, never invert)
1. **CORE JOB.** Bob's agent supplies an endorsement for Alice → the portal authenticates Bob, scans,
   mints, notarizes → Alice receives it PENDING → Alice accepts → Alice presents to Charlie → Charlie
   verifies and consumes it as quoted-untrusted "Bob says:". Live, across real processes. If broken or
   missing → top priority.
2. **SILENTLY-BROKEN CORE / SECURITY HOLE.** Looks done but the kernel is missing. **Most dangerous
   category; treat as critical.** For M10B specifically:
   - **Attribution forgery** — `issuer_pubkey` taken from a request field rather than the authenticated
     identity, so anyone can mint an endorsement attributed to anyone.
   - **Consent bypass** — a pending or refused endorsement that is presentable, countable, or
     discoverable by any path.
   - **Portal-voice restatement** — the endorser's words re-emitted inside the portal's attested
     `claim`, laundering untrusted text into portal-grade authority.
   - **Self-standing** — `same_operator` endorsements clearing a `min_count` floor, so ten agents under
     one operator manufacture standing. Includes a quota enforced per AGENT rather than per ACCOUNT
     (`M10B-D6`) — same hole, different door.
   - **Unsealed submission** — a daemon that falls back to sending the submission unsealed, or a
     directory queue row that turns out to hold readable plaintext. The queue's whole claim is that the
     directory cannot read it.
   - **Revoke authority** — one `submitter` key tombstoning another party's endorsement.
   - Plus the standing M10 set: a hash entering outside the signed chokepoint; payload to an LLM without
     `issuer_kind` framing; per-type code creeping into client or directory; cross-agent signal bleed.
3. **Real non-core gaps.** 4. **Hardening / polish.**

Informed-skeptic test before calling anything done: would someone who deeply understands this say it
works — or that the kernel is missing?

## 0. Read order (every session)
1. This procedure.
2. [[M10B-DEFINITION-OF-DONE]] — the **Orientation** section first (it is what prevents mis-scoping),
   then the lowest non-✅ line = next unit; Decisions + Open questions + Parked.
3. [[M10B-BUILD-JOURNAL]] — Entry 0 (the milestone thesis) + the last entries.
4. **Spec-of-record** (verified design — do NOT re-derive): [[M10-TRUST-SIGNAL-STORAGE-AND-CREATION]]
   — §6 the three issuer flows + the 2026-07-11 all-through-the-portal amendment, §7 Endorsement Mother,
   §11 endorsements + PSI, §14.1/§14.2 federation + revocation, §15 zero-bump — and
   [[M10-TRUST-SIGNAL-TAXONOMY]] (Class 2).
5. **Decisions-of-record**: [[2026-07-27_2049_policy-surface-audit-touchpoints-and-open-decisions]] §12
   (D-19, D-22 through D-27, D-29). The DoD restates them; that log is where the reasoning lives.
Then start the loop (§2).

## 1. The artifacts
| Artifact | Role |
|---|---|
| **M10B-DEFINITION-OF-DONE** | The **yardstick + sole status authority** — ordered, status-tagged, carries Decisions + Open questions + Parked. Flip tags in place; one line of evidence + `→ Entry N`, never an essay. |
| **M10B-BUILD-JOURNAL** | The **audit trail + evidence home** — append-only. Full proofs, bug forensics, run output live HERE, pointed to from the DoD. Never edit a prior entry. New file per tier (`M10B-BUILD-JOURNAL-T{n}.md`) seeded with a 10-line resume block. |
| **M10-TYPE-PLAYBOOK** | The **per-type runbook**, unchanged and still authoritative. `DOD-END-PLAYBOOK-1` is a run of it. If a step in it turns out to be wrong for a client-sourced type, fix the playbook in the same commit. |
| **The e2e fixture harness** | **Enforcer, daemon/directory layer** — extend `packages/e2e-tests/src/session-fixture.ts` / the spine harness with non-breaking `opts`; a from-scratch fixture is a BLOCKING review finding. |
| **The live journey** | **Enforcer, end-to-end layer** — real processes, three parties (endorser, subject, recipient). Lines whose behavior ends in an LLM's context or spans endorser→portal→directory→subject→recipient are ✅ only after the live journey. Vitest green ≠ done. |
| **The playbook-run proof** | **Enforcer, architectural layer** — `DOD-END-PLAYBOOK-1`. A second client-sourced type goes end-to-end with empty diffs in both repos, or the generalisation failed. |

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

## 2a. Three repos — where work lands
**Center of gravity: cello-portal.** The third source is a portal ingress; the scanner, the payload
composition, and the mint arm are all portal code.

- **cello-portal** (`/Users/andrep/Documents/code/cello-portal`) — Next.js 16 (**read
  `node_modules/next/dist/docs/` before writing Next code** — its AGENTS.md warns the APIs drift from
  training data). Postgres via `pnpm db:up`, numbered SQL migrations via `pnpm migrate`. **Build on
  what M10 shipped, do not reinvent it:** `mint.ts` and `submission-signer.ts` (the KMS signer, prod
  fails closed), the `DirectoryClient` + `FailoverDirectoryClient`, and the two existing source arms —
  portal verification code, and the directory read path (`queryAccountFacts`,
  `GET /internal/track-record/:agentPubkeyHex`). The new ingress is a **third arm alongside those**,
  and everything downstream of "we have clean plaintext" is a call into existing code. LIVE on ECS
  Fargate, us-east-1, https://portal.cello.mygentic.ai — portal deploys join the batching discipline.
- **cello-client** (holder + recipient) — the consent state on `wallet_trust_signals`, accept/refuse,
  the operator surface (MCP + CLI at parity), tier-signed `same_operator` rendering, the count
  predicate. Publish cascade applies (§2c). All new columns/tables key on `agent_id` (never
  `agent_name`), SQLCipher only (`node:sqlite` VERBOTEN), payload stays opaque — hoisting a payload
  field into a column is BLOCKING (spec §3 guardrail).
- **trustless-cello** (directory) — bigger than it looks, because `M10B-D2` puts the submission queue
  here: `DOD-END-QUEUE-1` (the sealed mailbox + its migration) and `DOD-END-REVOKE-2` (the REVOKE-1 F6
  authority fix). The **notarization** path may still need nothing — `DOD-DIR-WRITE-1` was built
  deliberately seam-ready for `issuer_kind: agent` ("the set is DATA, not a hardcoded 'portal only'") —
  **verify that before planning any work on it.** Batch ALL directory changes into ONE deploy
  (~25–30 min × 3 regions): the queue migration and the revoke fix ship together, so sequence the work
  to have both ready before pushing.
  Any new Flyway migration updates `OpsAgentExpectedMigrationVersion` (infra/CLAUDE.md). Read
  `infra/STATE.md` before, update after, any AWS-touching session.

A unit that touches two repos states so in its journal checklist up front; never assume a change is
confined to one repo until you have read both sides.

## 2b. Reviewer dispatch — what the unit reviewer is TOLD
One `cello-unit-reviewer` dispatch per unit, **no model override**. The DISPATCH supplies: the DoD line
text VERBATIM (all clauses), the coder's clause checklist, the diff (commit range or files), and the
repo(s). Standing M10B-specific instructions to include:

- **Zero-bump lens, sharpened for this milestone.** Flag ANY per-type construct in cello-client or
  trustless-cello — type enums used for gating, `switch(type)`, per-type columns, per-type validation
  or rendering, a `CHECK` on `type`. **And specifically: any branch on the literal string
  `"endorsement"`.** The legal axes are `issuer_kind`, the consent state, and the issuer's identity —
  all already data. BLOCKING even if tests pass.
- **Attribution lens.** Flag any path where `issuer_kind`/`issuer_pubkey` is taken from caller-supplied
  input rather than derived from the authenticated identity. Precedent to cite: `accepting_node` in
  DOD-DIR-WRITE-1 — "written by the node itself, never accepted from the request." BLOCKING.
- **Consent lens.** Flag any path that lets a PENDING or REFUSED endorsement be presented, counted,
  enumerated, or inferred — including through an error message, a count that leaks by differing, or a
  timing difference. A refused endorsement must be indistinguishable from one that never existed.
  BLOCKING. **Scope it correctly: the ISSUER is not a third party.** Bob knows what he issued, and
  `M10B-D4` lets Alice send him a refusal message at her option — that path is the feature, not a leak.
  Flag it only if the issuer learns MORE than the subject chose to tell him (e.g. a refusal that
  notifies him when Alice sent no message, or a status field that differs between pending and refused).
- **Untrusted-content lens.** The endorser's words must reach a consuming LLM quoted and attributed,
  never restated inside the portal's attested `claim`. Flag any composition that merges the two voices.
  BLOCKING — this is how `INV-FRAMING` dies quietly.
- **Self-standing lens.** Flag any count/threshold predicate that does not exclude or separately bucket
  `same_operator` endorsements. Quality capping without quantity capping is not sufficient.
- **Spec fidelity** against the spec-of-record section the DoD line cites (per-clause verdicts; silent
  simplification is BLOCKING; deviations legal only when pointing at a DoD Decisions entry).
- **Error fidelity** — every new/modified `catch`; trace one error path end-to-end and QUOTE the
  operator-visible message. An intake rejection must name WHICH check refused it.
- **Error substitution (Lens 3a2).** Not just swallowed errors — RENAMED ones. An exit-point label
  standing in for the real cause sends the operator to the wrong subsystem for days. The upstream
  reason must survive in the payload.
- **Removal & refactor integrity (Lens 5) — dispatch EXPLICITLY on any diff that DELETES or MOVES
  code.** Lenses 1–4 assume a diff that ADDS something and give a removal nothing to bite on. Deadness
  PROVEN (both repos + the `exports` map + a red build, never a grep); every DELETED test triaged by
  SUBJECT; absence asserted on the BUILT artifact; for a refactor, behavior preservation IS the spec.
- **The revert test (Lens 4).** For every new test: would it still pass if the fix were reverted?

## 2c. Publish + deploy sequencing
**Load `/cello-publish` for THIS publish — every publish, never from memory.** Loading it earlier in the
session does not count. Batch publishes per tier, not per unit; a line needing a published artifact is
not ✅ until the published artifact works. After publish: verify the BINARY (`npm view … dependencies` —
real versions, never `workspace:*`); pin the local install and VERIFY the pin (`claude mcp get cello`).
trustless-cello references to cello-client packages stay pinned semver.

**Two human-only steps** (everything else is yours to run, no permission-asking): the `latest` dist-tag
promotion (always Andre's go — prepare + `--dry-run` + hand over) and the `/mcp` reconnect.

**In autonomous/overnight mode, BOTH are DEFERRED, not blockers — and deferring them must not stop the
run.** Publishing a new client to **beta** is authorized and expected; **promoting it to `latest` is
not yours ever**, and overnight there is nobody to run it. So: publish to beta, verify the published
binary, pin the local install and verify the pin, then **write the prepared promotion into the journal
and the handoff** — the exact command, `--dry-run` output, and the versions involved — and **carry on
with the next DoD line immediately.** Do not end a turn on it, do not ask for it, do not treat it as
gating. The consequence is bounded and acceptable: nothing on `latest` moves until Andre runs it, which
is exactly the intent. A DoD line whose proof needs the *published beta* artifact can still go ✅; a line
that would need `latest` is the only thing that waits, and it says so in its evidence.

When a unit needs BOTH a directory deploy AND a client publish: start the deploy first (slower), run the
cascade while it is in flight, arm the Cron 1 watchdog (§3b).

## 2d. Infrastructure state — `infra/STATE.md` is not optional
**`infra/STATE.md` is the authoritative record of what exists in AWS. READ it before any session that
touches infrastructure, and UPDATE it IMMEDIATELY after each discrete infra action — never batch, never
"at the end of the story."** `./infra/deploy.sh` updates it automatically; **anything else — console,
CLI, a manual stack operation, an SSM parameter, a migration — you update by hand and commit right
then.** The reason is specific and has already cost real work: a compaction between the action and the
write-up loses the identifiers permanently, and there is no way to reconstruct them.

M10B touches this through `DOD-END-QUEUE-1` + `DOD-END-REVOKE-2` — one batched directory deploy across
3 regions, with a new Flyway migration that must also bump `OpsAgentExpectedMigrationVersion`
(`infra/CLAUDE.md`; skipping it crash-loops the ops-agent on fresh deployments). A session that changes
AWS without updating STATE.md is incomplete, no matter what else went green.

## 2e. IS THE INFRASTRUCTURE HIBERNATED? — check FIRST, before believing §2c/§2d

The dev environment is hibernated between working sessions to cut cost, and **it may well be hibernated
for this run.** §2c and the REALITY CHECK say AWS actions are authorized; that authorization assumes
the environment is UP. **Run this check at the start of the run and do not skip it** — the failure mode
otherwise is either an hour lost debugging a dead endpoint as if it were a code bug, or something far
worse (below).

```bash
dig +short directory-us1.cello.mygentic.ai      # real ALB IPs = LIVE · 198.51.100.x = HIBERNATED
dig +short portal.cello.mygentic.ai
```

**Do NOT use `infra/hibernation-state.json` as the signal.** `wake.sh` does not clear it, so its
`hibernated_at` timestamp survives a wake and reads as hibernated when the environment is live.
DNS is the truth: `hibernate.sh` UPSERTs every dir/relay/portal name to a TEST-NET-2 (`198.51.100.x`)
blackhole address, deliberately, so the names still resolve instead of poisoning negative DNS caches.

**If hibernated, this is the ONE case where "AWS actions are authorized" does not apply.**

> **NEVER run `infra/deploy.sh`, a CloudFormation operation, or any AWS mutation while hibernated.**
> `wake.sh` reconstructs the deleted resources (ALBs, NAT gateways, the ssmmessages endpoint) from
> `hibernation-state.json`. A deploy against a hibernated stack writes state that file does not know
> about and **corrupts the inventory the wake depends on** (global CLAUDE.md). Missing resources during
> hibernate are INTENTIONAL — they are not failures to diagnose or repair. Waking the environment is
> **Andre's call, never yours**: it costs real money and it is an outward infrastructure action.

**What is blocked while hibernated — treat each as a KNOWN condition, not a bug to investigate:**

1. **The batched directory deploy** (`DOD-END-QUEUE-1` migration + `DOD-END-REVOKE-2` +
   `OpsAgentExpectedMigrationVersion`). Write it, prove it locally, commit it, **do not push the
   deploy.**
2. **The portal deploy.** The portal ALB is deleted and `portal.cello.mygentic.ai` is blackholed.
3. **`cello-db-query` and `cello-portal-db-query`.** Hibernate deletes the ssmmessages VPC interface
   endpoint, so **ECS Exec does not work.** These skills will fail in a way that looks like a broken
   skill. It is not broken. Use the local docker-compose Postgres instead.
4. **The demo agent** — the directory is at `desiredCount 0`, so it has nothing to register with.

**What is NOT blocked — which is most of M10B, so there is no excuse to stall:**

- All code, tests, lint, typecheck, build in all three repos.
- The **portal** on local Postgres (`pnpm db:up`, `pnpm migrate`). KMS keys are KEPT through
  hibernation, so the real signer still works from local credentials.
- **The live journey and the playbook run.** `DOD-END-JOURNEY-1` and `DOD-END-PLAYBOOK-1` are enforced
  by the spine harness, which is **already local**: `packages/e2e-tests/src/spine/live-harness.ts`
  brings up docker-compose Postgres + Flyway and runs real directory/relay/daemon binaries on
  localhost. This is how M10's T2 and T3 journeys actually went green (M10 journal Entries 46–47) —
  not against AWS. "Live, across real processes" means real OS processes, **not deployed AWS.**
- **The beta npm publish** (§2c) — no AWS involved.

**So the run continues; it just ends with a deploy owed.** When a DoD line's only remaining gap is the
deploy, mark it 🟡 BUILT/UNVERIFIED-LIVE with the evidence it *does* have, write the exact pending
deploy command into the journal and the handoff — alongside the deferred `latest` promotion (§2c) —
and **pull the next DoD line in the same turn.** A hibernated environment is not a stopping condition
any more than a cron tick is (§0 rule 1).

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
ingress shape and anonymous variants. See DoD Decisions `M10B-D2` through `M10B-D8`. Do not re-open, do
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
1. Are M10B-PROCEDURE / M10B-DEFINITION-OF-DONE (+ the latest journal entry) actually in context right
   now? If compaction dropped them, re-read before doing anything else — **and RE-ARM BOTH CRONS if they
   are gone.**
2. Stalled on a decision? Resolve per §3a: verifiable from a source → verify, never escalate what you can
   check; has a best practice → take it, log an `M10B-D*` entry, proceed (redo > block); genuinely
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

**SELF-TERMINATE (mandatory).** When M10B closes (`DOD-END-PLAYBOOK-1` ✅), or the work is otherwise
finished, abandoned, or handed back, the fired prompt calls `CronDelete` on its own job ID. A heartbeat
left armed after the work is done wakes the session forever. This clause belongs IN the cron prompt, not
only here.

## 4. First actions (order matters)
1. **`DOD-END-ARCH-1`** — the determination. It gates every build line. It no longer carries the four
   forks (all closed — `M10B-D2`..`D10`); what it carries is the detail those decisions opened.
   Its output is the architecture section the whole milestone builds against.
2. **Verify the trustless-cello NOTARIZATION surface before planning work on it.** `DOD-DIR-WRITE-1`
   claims the authorized-issuer model is data-driven and seam-ready for `issuer_kind: agent`. Read it and
   prove it, in the journal, before assuming either that it works or that it needs changing. Note this is
   now a narrower question than it was: `M10B-D2` already puts the submission queue in the directory, so
   the milestone has directory work regardless — `DOD-END-QUEUE-1` + `DOD-END-REVOKE-2`, batched into
   ONE deploy. What you are verifying is whether the *write/notarization* path needs anything on top.
3. **Design notes owed before their units** (§6): the queue (before Tier 1); the scanner suite +
   versioning (before Tier 1); the consent state model (before Tier 2); the revocation authority model
   (before Tier 3).
4. Then the loop, tier order strict.

## 5. Hard rules (non-negotiable)

### 5a. The recurring defect classes

- **ABSENT IS NOT FINE.** When a guard's input is missing, unreadable, or an unrecognized shape, the
  answer is **REFUSE**. A default that lets the caller proceed is a security defect even when it is
  currently unreachable — unreachable is a property of today's SQL, not of the code. **Specific to
  M10B:** a missing or unrecognized consent state must make an endorsement UNPRESENTABLE, never
  presentable-by-default; a missing operator-linkage lookup must refuse the mint, never mint unflagged;
  an unrecognized scanner verdict must reject, never pass. An attacker never has to DEFEAT these — they
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
- **`DOD-END-ARCH-1`** — the determination. The ingress SHAPE is settled (`M10B-D2`) and so are
  `same_operator` placement (`M10B-D3`), the pending surface (`M10B-D5`) and vocabulary (`M10B-D7`) —
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
that prevents each. For M10B, name explicitly how it cannot violate INV-ATTRIBUTION, INV-CONSENT,
INV-UNTRUSTED, INV-NO-SELF-STANDING, and INV-ZEROBUMP.

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

- [[M10B-DEFINITION-OF-DONE]] — the yardstick + sole status authority (Decisions, Open questions, Parked)
- [[M10B-BUILD-JOURNAL]] — audit trail + evidence home; Entry 0 is the milestone thesis
- [[M10-TYPE-PLAYBOOK]] — the per-type runbook, unchanged; `DOD-END-PLAYBOOK-1` is a run of it
- [[M10-TRUST-SIGNAL-STORAGE-AND-CREATION]] — spec-of-record (HOW): §6 three issuer flows, §7 intake,
  §14.1/§14.2, §15 zero-bump
- [[M10-TRUST-SIGNAL-TAXONOMY]] — spec-of-record (WHAT): Class 2
- [[2026-07-27_2049_policy-surface-audit-touchpoints-and-open-decisions]] — decisions-of-record (§12)
- [[M10-DEFINITION-OF-DONE]] — v1: the pipe this milestone extends; its post-v1 section is where
  endorsement intake and the REVOKE-1 F6 fix were parked
- [[M10-PROCEDURE]] / [[M11-PROCEDURE]] — provenance only (this document is self-contained). M10 supplied
  the trust-signal machinery; M11 supplied the reviewer-dispatch correction (no model override).
