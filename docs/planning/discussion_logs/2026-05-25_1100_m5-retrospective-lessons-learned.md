---
name: M5 Retrospective — Lessons Learned and Process Improvements
type: discussion
date: 2026-05-25
topics: [m5, retrospective, lessons-learned, migrations, flyway, deployment, coordination, process, m6]
status: active
description: Post-M5 retrospective covering what went well (COORDINATION.md, incremental milestone write-ups), the FEDERATION-002 migration incident as the root cause of the DEPLOY-003 fix-loop pattern, and the concrete story structure changes those lessons produced for M6.
---

# M5 Retrospective — Lessons Learned and Process Improvements

## Context

This retrospective was conducted on May 25, 2026, while FEDERATION-E2E-001 (the M5 close gate) was in its final deploy cycle. The analysis was possible in real time precisely because of the process artifacts M5 produced — COORDINATION.md and the incremental milestone write-up — which gave us a clear record of what happened and when.

---

## What Went Well

### COORDINATION.md

The agent coordination log (`docs/planning/user-stories/m5/COORDINATION.md`) proved its value throughout M5. Because agents cannot see each other's work directly, the file became the fan-in mechanism: each agent appended a structured entry when it had a blocker, a dependency, or completed work that others needed to know about.

The M5 entries document 13 distinct cross-story dependencies that were resolved cleanly through this mechanism — the pnpm lockfile fix propagating to all blocked pipelines, the RDS rotation Lambda deployment sequencing, the Flyway migration version cascade. Without COORDINATION.md, these would have required multiple sessions of re-orientation or silent broken assumptions.

**Rule going forward:** Every milestone that has parallel story execution gets a COORDINATION.md. Format is: date/time, agent/story identity, what is blocked and why, what has already been done, what the other agent needs to do. Read it at the start of every session. Append, never overwrite.

### Incremental Milestone Write-Ups

Writing `M5-infrastructure-deployment.md` incrementally — story by story as they closed — rather than as a single post-hoc summary, produced a qualitatively different document. It captures:

- The exact bug that caused each failure, not a summary of "deployment issues"
- The specific rules extracted from each fix (em dashes in AWS descriptions fail silently, `GetRandomPassword` cannot be scoped to a resource ARN, etc.)
- The sequence of events across stories, so causal chains are traceable

This made the retrospective analysis in this session possible without reading git blame or CloudFormation event logs. The write-up did the archaeology in real time.

**Rule going forward:** Milestone write-ups are written incrementally. Each story appends a section when it closes. The format follows M5's pattern: what was delivered, bugs found and fixed (each with Symptom / Root cause / Fix / Rule), what this unblocks.

---

## The FEDERATION-002 Migration Incident — Root Cause Analysis

### What Happened

FEDERATION-002 appended a `UNIQUE` constraint to `V18__federation_schema.sql` after that migration had already been applied to the dev RDS instance by FEDERATION-001. This caused Flyway to compute a different checksum than the one recorded when V18 was first applied, producing:

```
Flyway checksum mismatch (applied=1232519606, local=-599496115)
```

Every new directory container crashed at startup from that point forward.

### The Real Root Cause — Incomplete Schema Assessment

The immediate cause was modifying V18 after it was applied. But the deeper cause was **FEDERATION-001 shipped V18 incomplete.**

FEDERATION-001 created the `checkpoint_node_signatures` table without the `UNIQUE (checkpoint_id, node_id)` constraint. Only when FEDERATION-002 implemented the actual coordinator logic did the missing constraint surface. By then:
- V18 was already applied to dev RDS
- PERSIST-023 had claimed V20
- ACCOUNT-001 had claimed V21/V22
- All three stories were in parallel worktrees

The fix required extracting the constraint to a new V20 migration, which forced:
- PERSIST-023 renumbering V20→V21
- ACCOUNT-001 renumbering V21/V22→V22/V23
- Three-way rebase conflicts

**The pattern:** FEDERATION-001 didn't fully assess what the federation schema needed before writing V18. The constraint should have been caught during FEDERATION-001's Architecture phase by reasoning through: "if three nodes are cross-signing, what prevents duplicate signatures?" The cost of an incomplete migration isn't local — it's borne by every parallel story that has to renumber.

### Why It Surfaced Inside DEPLOY-002/DEPLOY-003

FEDERATION-002 was already closed and merged when the breakage appeared. It surfaced inside the deployment stories because those were the first stories to run real Flyway migrations against a running database. The originating story was done; the debugging happened in the wrong place.

This is the structural fix-loop pattern: **an upstream story ships a defective artifact, consequences only appear when a downstream deployment story runs, fix loops burn time inside the deployment story instead of at the source.**

### What Made It Worse

The DEPLOY-002/DEPLOY-003 stories were already debugging six other first-deployment issues simultaneously: port conflicts, SSL modes, missing secrets, security group rules, container health checks, competing CloudFormation and pipeline updates. The Flyway cascade arrived in the middle of an already-complex debugging session.

### The Fix and the Cascade

The fix required:
1. Reverting V18 to its FEDERATION-001 state
2. Extracting the constraint to a new `V20__federation_checkpoint_unique_constraint.sql`
3. PERSIST-023 renumbering V20→V21
4. ACCOUNT-001 renumbering V21/V22→V22/V23
5. Three-way rebase conflicts resolved across `hash-chain.ts`, `pg-directory-store.ts`, `schema-completeness.test.ts`, and `COORDINATION.md`

**Rules extracted:**
1. **Thoroughly assess schema requirements before writing the migration.** During the Architecture phase, reason through all use cases that will touch the table. "If three nodes are cross-signing, what prevents duplicate signatures?" should have been asked in FEDERATION-001, not discovered in FEDERATION-002.
2. **Never modify a migration file after it has been applied.** The migration is append-only the moment Flyway records its checksum. But more importantly: get it right the first time, because the cost of incompleteness is borne by every parallel story.

---

## Lessons Carried Into M6 Story Structure

The retrospective produced two concrete story structure changes for M6. These are not process intentions — they are encoded as blocking ACs in the stories themselves.

### Mitigation C — Schema-Complete OPS-AGENT-000

OPS-AGENT-000 is not just interface contracts. It also produces the complete schema design for all tables the registration state machine requires, with migration version numbers V24+ explicitly reserved before any parallel implementation begins.

This eliminates the conditions that produced the M4/M5 cascade:
- No story can add a migration reactively mid-milestone (all tables designed up front)
- No story can claim a version number already reserved (V24+ allocated in OPS-AGENT-000)
- A sprint-reviewer checking OPS-AGENT-000 can confirm schema completeness before any downstream story starts

See [[2026-05-25_0900_m6-beta-launch-planning]] for the full OPS-AGENT-000 story scope.

### Mitigation B — Incremental Integration Gate ACs

Each OPS-AGENT story must include a blocking integration gate AC as its final acceptance criterion. This catches defective artifacts before they reach 005B, not inside it.

**Standard AC language (included verbatim in every OPS-AGENT story):**

```
AC-[N]: Incremental integration gate — Before this branch merges, run the partial
E2E flow specified above against a local environment with all prior M6 migrations
already applied. Flyway must report zero checksum errors on any migration V24 through
V[N-1]. This AC is blocking. No downstream story may begin implementation until this
story's integration gate AC is verified and the story is merged.
```

The Flyway integrity check runs against an environment that already has prior migrations applied — not a fresh database. A fresh database will not catch the FEDERATION-002 pattern where a previously-applied migration gets modified.

**Per-story integration gate checkpoints:**

| Story | Integration gate AC |
|---|---|
| **OPS-AGENT-000** | All interface stubs compile with zero type errors. All new migration SQL files apply cleanly to a fresh local Postgres — schema created, no errors. V24+ version numbers confirmed not claimed by any existing file. |
| **OPS-AGENT-001** | Directory running locally: `POST /internal/pre-authorize` returns a token. Presenting that token once to the consumption endpoint succeeds. Presenting it a second time returns the single-use rejection. Flyway reports zero checksum mismatches on prior migrations. |
| **OPS-AGENT-002** | Using local interface stubs, drive the registration state machine from INIT to COMPLETED against real local Postgres. State persists across a simulated process restart. A pre-auth token consumed at the DKG step cannot be reused in a second run. Flyway clean. |
| **OPS-AGENT-003** | Using Telegram sandbox bot credentials, send a registration trigger message and observe the state machine advancing through phone verification to OTP-pending state. Flyway clean. |
| **OPS-AGENT-004** | OTP delivered to a verified SES sandbox address. Correct OTP advances state machine to DKG step. Expired OTP rejected. 6th send within an hour returns rate-limit error. Flyway clean. |

The last sentence of the standard AC language is load-bearing: *"No downstream story may begin implementation until this story's integration gate AC is verified and the story is merged."* This encodes the sequencing constraint in the story contract, not in a process agreement that gets forgotten.

---

## Why the 005A/B Split Is Still Valuable (But Not the Main Fix)

The OPS-AGENT-005A/B split (Mitigation A) proves the ECS deployment path works before application code touches it: ports, security groups, IAM roles, missing secrets, health checks. All of those would have been caught by a stub container without requiring Flyway to run.

But 005A cannot protect against upstream story contamination of the FEDERATION-002 type. If OPS-AGENT-001 through 004 produce broken migrations, they only manifest when 005B runs Flyway. The 005A/B split reduces the blast radius (infra debugging separated from code debugging) but does not eliminate the root cause.

Mitigations B and C address the root cause. Mitigation A reduces the blast radius if B and C fail.

---

## The Single-Agent Finding

During the retrospective, a related observation emerged: the DEPLOY-003 fix-loop pain was compounded by coordination complexity, not just the technical root cause. A single agent that owns the full deployment story can trace a problem back through its own context. Parallel agents lose that continuity — the context window does not span worktrees.

For M6, OPS-AGENT-005A and 005B are sequential by design. The same agent session that proves the stub deployment (005A) proceeds to wire the application code (005B). No context handoff, no re-orientation from COORDINATION.md for the deployment path.

---

## Additional M5 Patterns — IaC Parity, Deployment Methodology, and ECS Timeouts

### The IaC Parity Rule

M5 surfaced multiple instances where infrastructure was manually fixed but IaC wasn't immediately updated:

1. **Envelope key secret** — manually created in us-east-1, not in IaC. Fixed in FEDERATION-E2E-001: added `DirectoryEnvelopeKey` resource to `cello-secrets.yaml` and step 5 to `bootstrap.sh`.
2. **IAM role names without region suffix** — caused global collision when deploying to eu-central-1 and ap-northeast-1. Fixed by adding `${AWS::Region}` to all role names in `cello-iam.yaml`.
3. **CloudWatch dashboard name collision** — global resource attempted from multiple regions. Fixed with `IsPrimaryRegion` condition; dashboard only deploys from us-east-1.
4. **`bootstrap.sh` treating `PLACEHOLDER_POPULATE_VIA_CLI` as populated** — fixed by adding to exclusion list in `put_secret_if_empty`.
5. **Rotation Lambda handler** — deployed manually via `deploy-lambdas.sh`, overwritten by pipeline on every directory deploy. Fixed by making `deploy-lambdas.sh` deploy to all regions and adding region parameter support.

Each manual fix worked locally but violated the region-expansion goal: deploying to a brand-new region with zero manual steps.

**Rule 7:** After any manual AWS fix, update the IaC template and redeploy through the pipeline. Never leave "works but isn't in IaC" state. The region-expansion goal requires every fix to pass the test: "would this work in a brand-new region with zero manual steps?"

### The Foreground Deployment Rule

Early M5 sessions attempted to use background agents for deployment work. This pattern was abandoned after multiple failures: agents lose the context thread, can't trace errors back through prior decisions, and miss real-time ECS service events that explain stalled deploys.

The working pattern that emerged:
- Deployment work (CloudFormation, ECS, pipeline monitoring) stays in foreground
- Code writing stays in foreground
- Only read-only reviewers (`code-reviewer`, `sprint-reviewer`) may be dispatched as subagents
- Long-running pipeline monitoring uses the loop skill (cron) with 3-minute intervals, not bash sleep loops

**Rule 8:** Deployment and code work stay in foreground. Use cron loop skill to monitor long pipelines. Only read-only reviewers may be subagents.

### The ECS ALB Deployment Timeout Pattern

FEDERATION-E2E-001 hit the same ProductionDeploy timeout failure three times before the fix landed:

**Symptom:** `aws ecs wait services-stable` returns timeout error after exactly 10 minutes, even though ECS tasks are RUNNING and HEALTHY.

**Root cause:** `aws ecs wait` has a hard-coded 10-minute maximum that cannot be extended via flags. ALB target deregistration delay (default 300 seconds per target) causes multi-region deployments to exceed this limit — especially when deploying to 3 regions sequentially.

**Fix:** Replace `aws ecs wait services-stable` with a custom poll loop that checks the ECS deployment `rolloutState` field every 30 seconds for up to 15 minutes:

```bash
for i in {1..30}; do
  STATE=$(aws ecs describe-services --cluster $CLUSTER --services $SERVICE \
    --query 'services[0].deployments[0].rolloutState' --output text)
  if [ "$STATE" = "COMPLETED" ]; then
    echo "Deployment complete"
    exit 0
  fi
  sleep 30
done
echo "Timeout after 15 minutes"
exit 1
```

The built-in wait commands are convenience wrappers, not production deployment tools.

**Rule 9:** ECS ALB deployments exceed `aws ecs wait` 10-min timeout. Use custom `rolloutState` poll loops with 15-minute maximum.

---

## Summary of Rules Extracted

From the M5 retrospective, the following rules apply to all future milestones:

1. **Thoroughly assess schema requirements before writing the migration.** Reason through all use cases during Architecture phase. The cost of an incomplete migration is borne by every parallel story. Never modify an applied migration; more importantly, get it right the first time.
2. **Push to origin immediately after each merge.** Never batch merges before pushing — simultaneous pipeline triggers defeat path-based CI filtering.
3. **Every parallel milestone gets a COORDINATION.md.** Format and read discipline are mandatory.
4. **Milestone write-ups are incremental.** Each story appends a section when it closes.
5. **Integration gate ACs run against an environment with prior migrations already applied.** A fresh database does not catch migration modification.
6. **Schema design is complete before parallel implementation begins.** OPS-AGENT-000 is the M6 enforcement of this rule.
7. **After any manual AWS fix, update IaC and redeploy.** Every fix must pass: "would this work in a brand-new region with zero manual steps?"
8. **Deployment and code work stay in foreground.** Use cron loop skill to monitor long pipelines. Only read-only reviewers may be subagents.
9. **ECS ALB deployments exceed `aws ecs wait` 10-min timeout.** Use custom `rolloutState` poll loops with 15-minute maximum.

---

## Related Documents

- [[2026-05-25_0900_m6-beta-launch-planning]] — M6 roadmap and story structure decisions
- [[M5-infrastructure-deployment]] — incremental M5 write-up with full bug records
- [[2026-05-16_0753_development-pipeline-and-local-iteration]] — M4 development pipeline decisions
