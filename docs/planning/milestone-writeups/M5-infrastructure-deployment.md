---
name: M5 — Infrastructure Deployment
type: design
date: 2026-05-22
topics: [milestone, M5, infrastructure, CloudFormation, ECS, RDS, ALB, ECR, deployment, IaC]
status: active
description: In-progress write-up for M5. Initial deployment issues, IaC gaps found, and repeatability fixes applied.
---

# M5 — Infrastructure Deployment

**Started:** 2026-05-22  
**Stories:** CELLO-DEPLOY-001A and related infrastructure stories  
**Stacks deployed:** 12 (cello-ecr, cello-iam, cello-secrets, cello-vpc, cello-kms, cello-s3, cello-rds, cello-rotation, cello-ecs-directory, cello-ecs-relay, cello-route53, cello-cicd)

---

## Bugs Found During First Deployment to dev/us-east-1

M5 is the first milestone where CELLO touches real AWS infrastructure. The gap between "templates validate" and "stacks deploy successfully" was substantial — six issues required IaC fixes before all 10 stacks (now 11) reached CREATE_COMPLETE.

### 1. Orphaned S3 buckets blocked stack creation

**Symptom:** `cello-s3-dev` failed with `AWS::EarlyValidation::ResourceExistenceCheck`.  
**Root cause:** A previous deployment attempt created the buckets, then rolled back. CloudFormation deletes the stack record on rollback but S3 buckets with `DeletionPolicy: Retain` survive — leaving orphans that block the next CREATE.  
**Fix:** Made DeletionPolicy conditional: `Retain` for production, `Delete` for dev/staging. Dev/staging buckets are now cleaned up on rollback, preventing collision on redeploy.

### 2. Stub container had no `curl` for ECS health checks

**Symptom:** `cello-ecs-directory-dev` stuck in CREATE_IN_PROGRESS for 10+ minutes. ECS task running but UNHEALTHY.  
**Root cause:** The stub image was built `FROM scratch` — a binary-only image with no shell utilities. The ECS health check command (`curl -f http://localhost/health`) requires `curl` to exist in the container.  
**Fix:** Changed stub Dockerfile to `FROM alpine:3.20` with `apk add --no-cache curl`.

### 3. Stub ignored PORT environment variable

**Symptom:** Relay task UNHEALTHY despite having the fixed image with `curl`.  
**Root cause:** The relay task definition sets `PORT=4000` and health-checks port 4000. The stub hard-coded `:8080`. The directory sets `PORT=443`. Neither matched.  
**Fix:** Stub `main.go` now reads `PORT` from environment (defaults to 8080 if unset). Both services pass health checks on first deploy.

### 4. No ALB in the directory template

**Symptom:** deploy.sh printed `WARNING: AlbDnsName output not found` and passed `PLACEHOLDER` to the Route53 stack.  
**Root cause:** `cello-ecs-directory.yaml` defined a pure Fargate service with no load balancer. The Route53 template needs an ALB DNS name for its ALIAS record.  
**Fix:** Added ALB, target group, and HTTP listener to the directory template. Route53 now reads real ALB outputs.

### 5. ECR repos not in IaC

**Symptom:** Not a deploy failure — but the repos were created manually and wouldn't exist in a new region.  
**Root cause:** ECR repos were a bootstrap prerequisite documented only in comments.  
**Fix:** Created `cello-ecr.yaml` template (Step 0 in deploy sequence). Imported existing us-east-1 repos into the stack. New regions get repos created automatically.

### 6. deploy.sh STATE.md updater had a Python syntax error

**Symptom:** Deploy completed but exited 1 at the very end.  
**Root cause:** The Python heredoc in `update_state()` used literal newlines inside f-string regex patterns. Python requires `\n` escape sequences in single-line strings.  
**Fix:** Replaced literal newlines with `\n` in all regex patterns.

---

## Repeatability Fixes Applied

After the initial deployment succeeded, a review identified four gaps that would cause the same failures in a new region. All four were implemented and verified by re-running `deploy.sh` (all stacks returned "No changes" — proving idempotency):

1. **`cello-ecr.yaml`** — ECR repos created per-region as Step 0
2. **Image pre-flight check** — before ECS stacks, deploy.sh verifies images exist in ECR; auto-runs `build-stubs.sh` if missing
3. **S3 DeletionPolicy conditional** — dev/staging use Delete; production uses Retain
4. **`bootstrap.sh`** — one-time secret population script (Ed25519 keys, RDS credentials, KMS ARN, webhook HMAC) with idempotent "skip if already set" logic

---

## SECOPS-004 — Credential Rotation, ACM Auto-Renewal, and Key Generation

With core infrastructure stable, SECOPS-004 added operational security tooling needed before any real workloads run.

**What was delivered:**

- `cello-rotation.yaml` — new stack deploying the Secrets Manager rotation Lambda, its IAM execution role (least-privilege, access to both app and admin credentials), a dedicated Lambda security group (egress to RDS 5432 only), and an `AWS::SecretsManager::RotationSchedule` wiring 30-day automatic rotation to the `rds-credentials` secret. The RotationSchedule lives in this stack (not `cello-secrets.yaml`) to avoid a first-deploy circular dependency: the rotation Lambda can't exist in Step 2 before it's deployed in Step 6a.

- `infra/lambda/rds-rotation/handler.py` — Python 3.12 four-step rotation handler (createSecret → setSecret → testSecret → finishSecret) using the multi-user strategy: connects to RDS as the admin user and runs `ALTER ROLE cello_service PASSWORD '<new>'`. Includes a `_RotationAlreadyDone` sentinel to handle idempotent re-invocation cleanly. Currently deployed as a placeholder that raises `NotImplementedError` — real code is deployed via CI/CD pipeline (AC-002/AC-003 verification pending that step).

- `infra/scripts/generate-node-keys.sh` — generates Ed25519 key pairs using `openssl genpkey -algorithm ed25519` (not random bytes), derives public key via PKCS#8 DER construction, and populates Secrets Manager with idempotency protection. Run for us-east-1 dev during this session; public keys recorded in STATE.md.

- `infra/runbooks/node-key-rotation.md` — documents relay vs. directory rotation procedures and the ordering constraint: distribute the new directory public key to all peers *before* rolling the ECS restart.

**Security fixes found and applied during implementation:**

- *SI-003:* `cello-iam.yaml` used wildcard `directory/*` for task role Secrets Manager access — this implicitly granted `rds-admin-credentials` to ECS tasks. Fixed by enumerating specific secret ARNs.
- *SI-004:* `cello-ecs-directory.yaml` injected `DB_PASSWORD` via `Secrets.ValueFrom` — a task-launch snapshot that goes stale after the first 30-day rotation. Replaced with `RDS_CREDENTIALS_SECRET_ARN` as a plain env var; the application must call `GetSecretValue` at connection-pool refresh time.

**Deployment note:** `cello-rotation-dev` hit ROLLBACK_COMPLETE on the first attempt due to a non-ASCII em dash in the security group description (EC2 only permits `a-zA-Z0-9. _-:/()#,@[]+=&;{}!$*`). deploy.sh auto-detected the ROLLBACK_COMPLETE state, deleted the failed stack, and recreated it cleanly on the second run.

Stack count is now 12.

---

## What Remains Open

*To be updated as M5 progresses.*

---

## Related Documents
- [[server-infrastructure]] — CELLO Server Infrastructure Requirements
- [[2026-05-16_0900_m4-infrastructure-decisions]] — VPC topology, RDS, KMS, S3, IaC templates
- [[M4-persistence-foundation]] — M4 write-up
- [[CONTEXT]] — canonical glossary
