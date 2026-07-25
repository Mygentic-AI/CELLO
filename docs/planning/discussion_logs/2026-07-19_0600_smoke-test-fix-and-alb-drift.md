---
name: 2026-07-19 Smoke test fix and ALB drift incident
type: discussion
date: 2026-07-19
topics: [infra, smoke-test, alb-drift, rogue-agent, incident]
description: >
  The directory pipeline smoke test had been failing since 2026-07-15. Root cause was a stale
  CodeBuild env var pointing to a deleted ALB. Multiple incorrect CFN template changes were
  attempted before the simple fix was found. This log documents every action taken and its
  reversal status.
---

# 2026-07-19 — Smoke Test Fix and ALB Drift Incident

## The actual problem

The `cello-smoke-test-build` CodeBuild project had `STAGING_DIRECTORY_URL` set to
`cello-dir-dev-85618485.us-east-1.elb.amazonaws.com` — an ALB that no longer exists.
The live directory ALB is `cello-dir-dev-1341968405.us-east-1.elb.amazonaws.com`.

## The actual fix

```bash
aws codebuild update-project --name cello-smoke-test-build --region us-east-1 \
  --environment '{"type":"LINUX_CONTAINER","image":"aws/codebuild/standard:7.0","computeType":"BUILD_GENERAL1_SMALL","environmentVariables":[{"name":"STAGING_DIRECTORY_URL","value":"cello-dir-dev-1341968405.us-east-1.elb.amazonaws.com","type":"PLAINTEXT"}]}'
```

One command. That's it.

## What caused the stale value

The rogue agent incident (2026-07-17) led to cleanup that recreated the directory ALB with a
new DNS name. The CodeBuild project's env var was never updated to match.

## Incorrect actions taken (and their reversal status)

### 1. Added DeletionPolicy: Retain to HttpListener
- **Commit:** `a8a1529e`
- **Reverted:** YES — user reverted manually, then `f77b6a68` restored template to original
- **Residual damage:** None

### 2. Removed RegistryPathRule from template
- **Commit:** `64f49a76`
- **Reverted:** YES — `f77b6a68` restored template to original
- **Residual damage:** None

### 3. Hardcoded ALB output values in template
- **Commit:** `6efbd1d7`
- **Reverted:** YES — `f77b6a68` restored template to original
- **Residual damage:** None

### 4. Ran deploy.sh dev us-east-1 THREE TIMES (all failed)
- **Run 1:** Failed on `RegistryPathRule` listener not found. Stack rolled back.
- **Run 2:** Failed on `!GetAtt Alb.DNSName` — can't read attribute of deleted ALB. Stack rolled back. **THIS ROLLBACK CHANGED THE ECS SERVICE** from task def :267 (image `:50c7748`, working) to :225 (image `:642bb7a`, old M8B era — no active-signals endpoint).
- **Run 3:** Network error during changeset wait. No CFN change.
- **Residual damage:** **YES — the ECS service was on the wrong image.** Fixed by:
  ```bash
  aws ecs update-service --cluster cello-dev --service cello-directory-dev --region us-east-1 \
    --task-definition cello-directory-dev:267 --force-new-deployment
  ```

### 5. Template reverted to original state
- **Commit:** `f77b6a68`
- **What it does:** Restores `cello-ecs-directory.yaml` to exactly what it was at `cf38cb41` (the state before any of today's work).
- **Residual damage:** None

## Current state after all fixes

| Item | Status |
|------|--------|
| CFN template | Original state (matches `cf38cb41`) |
| CFN stack `cello-ecs-directory-dev` | `UPDATE_ROLLBACK_COMPLETE` — same status as before we started |
| Directory ECS service | Task def :267, image `:50c7748` (forced back) |
| CodeBuild `STAGING_DIRECTORY_URL` | Updated to live ALB DNS |
| Portal trust-signals page | Will work once new task is healthy (~2-3 min from force deploy) |
| Smoke test | Should pass on next pipeline run |

## Known remaining issue (NOT fixed today)

The `cello-ecs-directory-dev` CFN stack has **ALB drift**: its physical resources for `Alb`,
`HttpListener`, and all listener rules point to deleted ALB `9f3cee2f6df31fc9`. The live ALB
is `61ee3093c761981a`. This means:

- `deploy.sh` CANNOT update this stack (any template change triggers output resolution → fails)
- The CI/CD pipeline still works (it only swaps Docker images via ECS, not CFN)
- The `/registry` listener rule exists live but is unmanaged by CFN

This drift needs a proper resource import or stack rebuild — but it does NOT block normal
pipeline deploys or the running service. It only blocks `deploy.sh` for this specific stack
in us-east-1.

## Lessons

1. The fix was one AWS CLI call. Everything else was wasted effort.
2. Before touching CFN templates, check if the value can be updated directly on the consumer.
3. `deploy.sh` failing does not mean the template needs changing — it might mean the stack is
   drifted and the right answer is to bypass it entirely.
4. CFN stack rollbacks can change the running ECS service's task definition. A failed deploy.sh
   is not consequence-free even when it "rolls back."

---

## 2026-07-25 — it recurred, I repeated the mistake, and the root cause is now known

**It came back.** Same symptom, same stale env var. This log said "one command. That's it." I did not
find it until Andre told me to look, and by then I had already changed the CFN template and deployed
`cello-cicd-dev` — which **failed and rolled back on a CodePipeline variable that rejects an empty
default**, and the rollback restored `STAGING_DIRECTORY_URL` from the stack's stored parameter,
**overwriting the manual repair recorded above**. The value went from `cello-dir-dev-1341968405`
back to `cello-dir-dev-85618485`. Blast radius was CI only — no ECS service was touched — but the
shape is identical to the damage in section 4 above.

**The root cause this log did not identify.** It attributed the stale value to the 2026-07-17
rogue-agent cleanup. That was the first instance, not the mechanism. `hibernate.sh` **deletes** the
dir and relay ALBs (its own header: *"ALBs (dir + relay per region) ~$150/mo"*) and `wake.sh`
recreates them — and AWS assigns a **new DNS name every time**, because an ALB name cannot survive
delete/create. So the baked value goes stale on **every hibernate/wake cycle**. That is why one
command fixed it in July and why it needed fixing again six days later.

**The permanent fix: stop using the ALB's own name.** `wake.sh` already re-points Route53, so
`directory-us1.cello.mygentic.ai` follows the new ALB automatically — verified, it resolved to
exactly the live ALB's addresses. Pointing the smoke test there removes the staleness instead of
refreshing it, and satisfies `DOD-INV-DOMAIN`, which bans raw AWS hostnames. All 8 scenarios pass
against the hostname; `http://…/health` returns the same 400 the runner accepts as proof of life
(the scheme matters — the ALB forwards :80 to the libp2p listener, so https does not answer).

Committed: `run-smoke-tests.ts` defaults to the per-region hostname, `deploy.sh` builds it from
`get_directory_subdomain`, and the template parameter documents why it must never hold an ALB name.

**So the repair command is now also the permanent fix**, and needs no stack deploy:

```bash
aws codebuild update-project --name cello-smoke-test-build --region us-east-1 \
  --environment '{"type":"LINUX_CONTAINER","image":"aws/codebuild/standard:7.0","computeType":"BUILD_GENERAL1_SMALL","environmentVariables":[{"name":"STAGING_DIRECTORY_URL","value":"directory-us1.cello.mygentic.ai","type":"PLAINTEXT"}]}'
```

**The lesson, since this log exists to teach one:** it did teach it, and I did not read it. Before
changing infrastructure in response to a symptom, search `discussion_logs/` for the symptom. The
second lesson is narrower and worth stating: a CFN rollback restores live configuration from the
stack's stored parameters, so any value repaired by hand outside the stack is destroyed by the next
failed deploy. That is why the hand-repair had to become a template change to be safe — and why the
template change has to be correct before it is deployed.
