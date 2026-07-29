---
name: M12 Procedure — How to Work the Milestone
type: procedure
date: 2026-07-28
milestone: M12
status: open
topics: [m12, gcp, migration, multi-cloud, anti-entropy, role-split, infrastructure, procedure, runbook]
description: >
  The operating runbook for M12 (multi-cloud rebuild — GCP nodes, anti-entropy sync,
  full-node/validator role split, CI on Cloud Build, AWS teardown). SELF-CONTAINED — no other
  milestone's procedure needs to be read. Read FIRST, then M12-DEFINITION-OF-DONE. Spec-of-record
  is the 2026-07-28 GCP rebuild decision record; derivations live in the superseded 2026-07-25 log.
---

# M12 Procedure — How to Work the Milestone

## REALITY CHECK — read before anything
One user: Andre, also the only developer. CELLO is **alpha — no production, no real users.**
Total data loss is not merely acceptable, it is **the plan** — this milestone is a rebuild from zero.

## 🛑 THERE ARE EXACTLY TWO REASONS TO STOP AND HAND BACK TO ANDRE

**Everything else is a NOPE — do not stop for it. Keep working.**

1. **A manual operation only Andre can do, that blocks you.** You cannot proceed in some area until he does it. (Examples: the npm `latest` promotion, a browser OAuth flow, `/mcp` reconnect, an AWS-teardown per-stack go.)
2. **A critical design decision that could cause harm, where you need his guidance.** A genuine fork where guessing wrong does damage.

**That is the whole list.** If what you're about to write is not one of these two, it is a NOPE — do not send it, keep working:
- Check-ins ("here's where I am") → **NOPE.**
- Recaps / session tallies ("this session delivered…") → **NOPE.**
- Telling him about the future / what you *may* need later → **NOPE.**
- "Should I keep going?" / "want me to start X?" → **NOPE** (the answer is always yes — start it).
- "This is a natural stopping point" / "I've done a lot" → **NOPE.** Length is never a reason to stop.
- "This deserves a deliberate/fresh start" → **NOPE.** Be careful, don't stop. Careful ≠ handing back.

The durable record is the journal + commits, not messages to Andre. Report progress by committing, not by writing him. When you finish a unit, pull the next one and keep going. Only surface when you hit reason 1 or reason 2 — and then say ONLY that, in one or two lines.

- **Never gate/hedge/ask permission on a CODE change.** Correctness + security fixes ship immediately.
- **Do not invent decisions for Andre.** "Should I do this code work?" is always yes.
- **DO pause for a GENUINE design fork** (materially different architectures) — in autonomous mode
  you PARK it (DoD "Parked" section + journal), never block.
- **GCP actions are AUTHORIZED inside the `cello-infra` project** (create, deploy, tear down —
  it exists for this milestone). **AWS actions require two checks first:** (1) infra is AWAKE —
  never touch hibernated infra, missing resources during hibernate are intentional; (2) the action
  is in IaC or STATE.md gets updated immediately after. AWS teardown (P4) additionally requires
  Andre's explicit go per stack — it is irreversible and the old system is the fallback until Wave 2 proves out.

## THE MILESTONE IN ONE PARAGRAPH
Rebuild CELLO at the launch topology across two clouds: **N=3 directories — one AWS (us-east-1)
+ two GCP — with T = majority(validators) = 2**, relays on both clouds, and the Postgres
replication mesh **retired** in favour of **libp2p anti-entropy** (no VPN, no PSA, ever). Build
the **full-node/validator role split** (manifest `role` field; replicas hold no shares and never
enter threshold arithmetic). Nodes run as **MIG(size 1) + Container-Optimized OS with Cloud SQL
per node**; CI moves to **Cloud Build + Artifact Registry**; ops-agent and portal move to GCP
(email via the SES HTTPS API). Sequence: GCP standalone first (testable with AWS off), then the
AWS node joins over anti-entropy, then the outage claim is proven ("GCP down → existing agents
still seal"), then old AWS infra is torn down. Spec-of-record:
[[2026-07-28_0700_gcp-rebuild-decision-record]].

## 0a. Severity triage (spend effort top-down, never invert)
1. **CONSORTIUM CORRECTNESS.** Threshold arithmetic over validators only; kill-switch convergence
   (suspended wins); shares never leave a node; no two manifest entries with one FROST identifier.
   Any silent violation is critical — this is the trust product itself.
2. **THE CORE JOURNEY.** Fresh register → DKG → seal → live two-agent session → kill a directory →
   sealing continues → client failover. If this breaks on the rebuilt system, nothing else matters.
3. **THE OUTAGE CLAIM.** GCP directories unreachable → existing agent seals via the AWS node;
   registration correctly refuses (needs |Q| ≥ T). This is a product claim at launch.
4. **Real non-core gaps.** Workload moves (ops-agent, portal), CI polish, teardown completeness.
5. **Hardening / polish.**

## 0. Read order (every session)
1. This procedure.
2. [[M12-DEFINITION-OF-DONE]] — lowest non-✅ line = next unit; Decisions + Parked sections.
3. [[M12-BUILD-JOURNAL]] — last entries.
4. **Spec-of-record**: [[2026-07-28_0700_gcp-rebuild-decision-record]]. Derivations and rejected
   alternatives: [[2026-07-25_1034_gcp-relay-and-directory-deployment-plan]] (superseded — use for
   *why*, never for *what*). Anti-entropy/role-split units also read the M8B plan
   (quorum registration, enrollment deferral) before touching consortium code.
5. `infra/STATE.md` before ANY AWS-touching unit. `infra/GCP-STATE.md` (created in P0) before any
   GCP-touching unit.
Then start the loop (§2).

## 1. The artifacts
| Artifact | Role |
|---|---|
| **M12-DEFINITION-OF-DONE** | The **yardstick + sole status authority** — ordered, status-tagged, carries Decisions + Parked. Flip tags in place; one line of evidence + `→ Entry N`, never an essay. |
| **M12-BUILD-JOURNAL** | The **audit trail + evidence home** — append-only. Full proofs, bug forensics, run output live HERE. Never edit a prior entry. New file per tier (`M12-BUILD-JOURNAL-T{n}.md`) seeded with a 10-line resume block. |
| **Local convergence enforcer** | Three directory processes on loopback, divergent state → anti-entropy converges them; kill/restart/catch-up proven; suspended-wins proven under partition. No cloud needed. |
| **GCP standalone enforcer** | The live journey (§0a.2) run entirely on GCP with AWS unreachable. Wave 1 lines are ✅ only after this passes. |
| **Outage-claim enforcer** | GCP directories blocked → existing agent still seals via AWS; new registration refuses loudly. Wave 2 lines are ✅ only after this passes. |
| **IaC enforcer** | The region-expansion test: would this node come up in a brand-new region with zero manual steps? Every manual `gcloud`/console fix must land in IaC and the STATE file before its unit closes. |

## 2. The core loop (one unit = one DoD line)
1. **Find the red** — lowest non-✅ DoD line in the active tier. Don't skip ahead.
2. **State the target** — one sentence of observable behavior, PLUS expand the full DoD line
   (every clause) into a clause checklist in the journal. That checklist is what the reviewer receives.
3. **Falsify first** (CLAUDE.md Debugging Discipline) — interface exposes the method? Responsibility
   lives here? What breaks elsewhere? Only then code.
4. **Red-first** — write the test, confirm it fails for the right reason, then implement. SPARC
   applies to every code unit (pseudocode citing the RFC for anything cryptographic).
5. **Implement** — minimum change to green; nothing speculative.
6. **Floor holds** — `pnpm run test` → `lint` → `typecheck` → `build` in every touched repo.
7. **Commit** (constantly — §3), push after every commit.
8. **Review — ONE read-only `cello-unit-reviewer` on the unit's diff, no model override.**
   Dispatch per §2b. Fix EVERY finding; commit fixes. At tier boundaries, `cello-done-auditor`
   audits every ✅ flipped since the last checkpoint.
9. **Update docs** — flip the DoD tag (+ one-line evidence + journal pointer), journal entry,
   STATE file if any cloud resource changed.
10. Back to 1.

## 2a. Repos — where work lands
- **trustless-cello** (this repo) — directory + relay code, ALL IaC (`infra/`), ops-agent,
  e2e-tests, CI config, these docs. Primary repo for nearly every unit.
- **cello-client** (`/Users/andrep/Documents/code/cello-client`) — manifest `role` parsing,
  validator selection, bundled consortium manifest, registration persistence. **Any cello-client
  change ships via `/cello-publish` (LOAD THE SKILL, every publish) with explicit version-bump
  ACs, and trustless-cello re-pins the published semver — `workspace:*` for cello-client packages
  is a bug.** Never run the `latest` promotion — Andre runs it.
- **cello-portal** (`/Users/andrep/Documents/code/cello-portal`) — only for the portal-move unit (P2).
- **corp-cello-site / waitlist** — **NOT in M12.** The waitlist stays on AWS (Decision 11).
  Its only appearance is the portal-DB coupling clause in DOD-MOVE-PORTAL-1.

A unit that touches two repos states so in its journal checklist up front, and worktrees are
created in both.

## 2b. Reviewer dispatch — what the unit reviewer is TOLD
Supply: the DoD line VERBATIM (all clauses), the coder's clause checklist, the diff, the repo(s).
Standing M12-specific lenses:
- **Sovereignty lens (BLOCKING):** flag any path where one node can complete a ceremony alone,
  any provider-specific networking in protocol code, any hardcoded endpoint, anything that
  assumes all nodes are up rather than routing around a down node.
- **Threshold lens (BLOCKING):** `consortiumNodeCount` and every threshold derivation must count
  **validator-role nodes only**. A replica entering DKG participant selection, seal arithmetic, or
  kill-switch honoring counts is a critical finding. T = majority(validators) — never all-N.
- **Kill-switch lens (BLOCKING):** suspension state must fail CLOSED and converge suspended-wins;
  an un-suspension requires verifiably newer authenticated state. Any path where a paused agent
  seals because a node missed the memo without being down is critical.
- **Shares-local lens (BLOCKING):** `agent_key_shares` (or successor) must never appear in any
  sync set, any anti-entropy exchange, any backup shipped off-node unencrypted.
- **Relay-extractability lens:** the relay gains no consortium state, no shared internal config
  package, no directory import. It must remain a standalone shippable artifact (enterprise
  private-relay deliverable).
- **Spec fidelity** against the decision record's numbered decisions (per-clause verdicts;
  silent simplification is BLOCKING). **Error fidelity** — causes, not exit-point labels.
  **Revert test** on every new test. **Removal integrity** on any diff that deletes/moves code —
  this milestone retires the mesh, so deletion discipline (grep both repos, built-artifact
  absence, `rm -rf dist` before asserting) will be exercised heavily.

## 2c. Deploy sequencing
- **Images build ONLY in CI** (Cloud Build once P0 lands; CodePipeline for the AWS node until
  teardown). NEVER `docker push` from local, either cloud.
- **AWS directory deploys still cost 25–30 min** — batch ALL pending AWS directory changes into
  one push. GCP MIG rolling replace is per-node; deploy nodes **sequentially, never simultaneously**
  (a deploy restarts the node; T−1=1 tolerates it, simultaneity doesn't).
- **Org-policy traps (verified live 2026-07-28):** no service-account keys exist or can be created
  (org-enforced) — cross-cloud auth is Workload Identity Federation or nothing; default SAs have
  ZERO grants — every permission is explicit, and the failure mode is a silent 403.
- **Cloud SQL:** each node's DB accepts connections from its own node only. Nothing cross-cloud
  ever connects to a node's Postgres — that is the anti-entropy dividend; protect it.

## 3. Cadence
- **Commit constantly** — never >~15 min without one; push after every commit. Docs commit to main.
- **Review every unit** on its diff, right after green. Never batch reviews.
- **STATE files update immediately after each cloud action** — never batched, never at story close.
- **Checkpoint at every tier boundary:** `cello-done-auditor` on every ✅ since the last checkpoint;
  only EARNED stays ✅. Journal summary, commit, new journal file for the next tier.

## 3a. Autonomous-mode rules (if running unattended)
NEVER `AskUserQuestion`, never end a turn waiting. Decision rubric: pick the common best practice —
the choice least likely to need reversing — log it in the DoD Decisions section, proceed
(redo > block, always). Genuine undecidable fork → PARK and pull the next unit, saying so.
**Exceptions that DO block (park the unit, work another):** AWS teardown per-stack go (§Reality
Check), the npm `latest` promotion, `/mcp` reconnect.

## 3b. Watchdog crons — arm both (self-contained)
Session-only; re-arm BOTH after every compaction/restart. **Cron 1 — deploy watchdog** (armed only
while a deploy/pipeline is in flight, `*/4 * * * *`): check REAL health — Cloud Build build status,
MIG instance health + serial console for crash loops, `aws codepipeline get-pipeline-state` for the
AWS side; genuine failure → stop waiting, diagnose; terminal → CronDelete itself. **Cron 2 —
30-min heartbeat** (whole milestone, off-minute e.g. `17,47 * * * *`): the defibrillator, not a
metronome — if working, keep working. Fired prompt: (1) procedure/DoD/journal in context? re-read +
re-arm if dropped; (2) stalled on a decision? apply §3a; (3) blocked on a human-only step? work a
different line; (4) >15 min since commit? commit; (5) last unit unreviewed? dispatch now;
(6) one status line. Self-terminate when all DoD tiers are ✅.

## 4. First actions (P0 order — strictly)
1. **DOD-GCP-PROJECT-1** — create `cello-infra`, link billing, enable APIs deliberately, create
   `infra/GCP-STATE.md`.
2. **DOD-GCP-IAM-1** — per-workload service accounts with explicit minimal grants.
3. **DOD-CI-REGISTRY-1** — Artifact Registry + Cloud Build building both images from GitHub.
4. **DOD-IAC-BASE-1** — the IaC skeleton (tool per M12-D2) proving one disposable VM up/down.
Then P1 (protocol code — all local-provable, no cloud dependency, can interleave with P0 waits).

## 5. Hard rules (non-negotiable)
- **ABSENT IS NOT FINE.** A guard with missing input REFUSES — unless refusing would violate the
  redundancy invariant (a down node must not make CELLO unusable), then proceed loudly + journal.
- **ERRORS NAME THEIR CAUSE, NOT THEIR EXIT POINT.**
- **NO CONSUMER, NO SHIP.** New fields/flags/events need a named consumer in the same unit.
- **NO ARCHAEOLOGY COMMENTS.** Present tense, imperative; constraints the code can't show.
- **DEADNESS IS PROVEN BY DELETION** + both repos' gates. Mesh retirement units triage deleted
  tests by subject-under-test, never by file. Assert absence on BUILT artifacts (`rm -rf dist` first).
- **DO NOT ESCALATE WHAT YOU CAN VERIFY.** Check gcloud/aws/code first.
- **MEASURE BEFORE QUOTING A NUMBER.**
- **One thread. One coder (the main loop).** Read-only subagents only (unit-reviewer, done-auditor,
  explorer). Deployment and code work stay in foreground.
- **`node:sqlite` VERBOTEN** (SQLCipher only, client side). **No mocks for crypto.** **No
  `console.log`** in implementation — injected logger, `domain.noun.verb` events, correlationId
  threading; observability ACs are first-class on every unit.
- **Join on stable keys** — `agent_id`, `node_id`, UUIDs. Never a mutable attribute.
- **No paid SaaS. All URLs `*.cello.mygentic.ai`. NODE_IDs are `<cloud>-<region>`, chosen once,
  never renamed** (renaming = FROST identifier destruction).
- **Vitest: one worker, foreground, timeout, filtered.** Never background a test process.
- **Deferrals get a home** — DoD Parked + journal. No silent deferral.

## 6. What a checkpoint/handoff entry contains
Which DoD lines are ✅ WITH enforcer-run output (not a claim); the exact next red + one-sentence
target; HEAD commits (all active repos); cloud-state deltas (both STATE files current?); anything
parked; anything that changes the DoD. Keep the RESUME STATE block at the top of the current
journal file up to date.

---

## Related Documents
- [[M12-DEFINITION-OF-DONE]] — yardstick + sole status authority
- [[M12-BUILD-JOURNAL]] — audit trail + evidence home
- [[2026-07-28_0700_gcp-rebuild-decision-record]] — spec-of-record (the decisions)
- [[2026-07-25_1034_gcp-relay-and-directory-deployment-plan]] — superseded derivations (the why)
- [[2026-07-04_0556_tofn-registration-availability-quorum-enrollment-plan]] — M8B quorum/enrollment context
