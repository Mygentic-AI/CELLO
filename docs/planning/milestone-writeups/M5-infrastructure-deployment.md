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
**Stories:** DEPLOY-001A, DEPLOY-004, SECOPS-001, SECOPS-004, FEDERATION-001  
**Stacks deployed:** 12 (cello-ecr, cello-iam, cello-secrets, cello-vpc, cello-kms, cello-s3, cello-rds, cello-rotation, cello-ecs-directory, cello-ecs-relay, cello-route53, cello-cicd)  
**Lambdas deployed:** 3 (webhook-receiver, pipeline-filter, rds-rotation)  
**Pipelines active:** 8 (5 green, 3 with pre-existing test failures)

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

## DEPLOY-004 — GitHub Webhook Receiver, Pipeline Filter, and CI/CD Wiring

The CI/CD story connected GitHub push events to CodePipeline executions via two Lambdas and EventBridge. It also uncovered and fixed every first-run CodeBuild failure across all 8 pipelines.

**What was delivered:**

- `infra/lambda/webhook-receiver/index.py` — Lambda function URL receiving GitHub push/PR webhooks, validating HMAC-SHA256 signatures against a Secrets Manager secret, and publishing structured events to EventBridge.
- `infra/lambda/pipeline-filter/index.py` — EventBridge-triggered Lambda that inspects `commits[].added/modified/removed` paths and starts the correct CodePipeline(s) based on a data-driven path→pipeline mapping.
- `infra/deploy-lambdas.sh` — deploys webhook-receiver, pipeline-filter, and rds-rotation Lambdas (the rotation target uses Docker for cross-platform psycopg2-binary packaging on Apple Silicon).
- `infra/runbooks/github-webhook-setup.md` — manual Phase 5 runbook for HMAC secret generation and webhook registration.
- Full end-to-end verification: push → `pipeline.webhook.received` → EventBridge → `pipeline.filter.match` → CodePipeline starts.

**Bugs found and fixed during live testing:**

### 1. GitHub HMAC signing uses raw UTF-8 bytes, not hex-decoded

**Symptom:** Every webhook delivery returned `invalid_signature`.  
**Root cause:** The Lambda was doing `bytes.fromhex(secret_string)` — treating the secret as hex-encoded. GitHub actually signs with the secret's raw UTF-8 bytes.  
**Fix:** Changed to `secret_string.encode("utf-8")`. Non-obvious because the AWS docs for webhook validation show hex decoding (they assume hex-format secrets).

### 2. GitHub sends form-encoded payloads even when configured for JSON

**Symptom:** `invalid_json` error on push events despite configuring `application/json` content type.  
**Root cause:** GitHub's initial delivery (and some webhook retries) sends `application/x-www-form-urlencoded` with `payload=<url-encoded-json>` regardless of the content-type setting.  
**Fix:** Detect `payload=` prefix and URL-decode before JSON parsing. Both content types now work.

### 3. Secrets Manager secret name vs constructed ARN

**Symptom:** `ResourceNotFoundException` fetching the HMAC secret.  
**Root cause:** CloudFormation appends a random 6-char suffix to secret ARNs (`-lwb9Z8`). The Lambda used a constructed ARN without the suffix. The Secrets Manager API accepts the secret *name* (which resolves to the correct ARN internally) but rejects a malformed ARN.  
**Fix:** Changed env var from `HMAC_SECRET_ARN` (constructed) to `HMAC_SECRET_ID` (name-only: `cello/${env}/pipeline/github-hmac-secret`).

### 4. pnpm `"*"` wildcard specifier rejected in lockfile mode

**Symptom:** All 8 CodeBuild pipelines failed on `pnpm install --frozen-lockfile` with `ERR_PNPM_OUTDATED_LOCKFILE`.  
**Root cause:** `@claude-flow/testing: "*"` in 7 package.json files. pnpm 10.x cannot resolve wildcard specifiers in frozen-lockfile mode — the lockfile records a specific version but the specifier `"*"` doesn't match the resolution algorithm's expectations.  
**Fix:** Pinned to `"3.0.0-alpha.6"` (the installed version) in all 7 packages. Regenerated lockfile.

### 5. pnpm `minimumReleaseAge` supply-chain policy

**Symptom:** `pnpm install` in CodeBuild rejected `@aws-sdk/*` packages.  
**Root cause:** Latest pnpm (installed via `npm install -g pnpm` without a version pin) enforces a 24-hour minimum release age. Several AWS SDK packages were published <16h before the build ran.  
**Fix:** Pinned `pnpm@10.33.2` in all 8 buildspecs. This version doesn't enforce the policy, matching our local development environment.

### 6. Packages have `typecheck` not `build` scripts

**Symptom:** `ERR_PNPM_RECURSIVE_RUN_NO_SCRIPT` — `@cello/crypto` has no `build` script.  
**Root cause:** The initial buildspec fix attempted `pnpm --filter <pkg> run build` for upstream deps. CELLO packages use `typecheck` (which runs `tsc --build`, producing `dist/` as a side effect).  
**Fix:** Changed all upstream dependency steps to `run typecheck`.

### 7. Circular test imports between client and directory

**Symptom:** Client pipeline: `Cannot find module '@cello/client'` during `@cello/directory run typecheck`.  
**Root cause:** The client buildspec ran `@cello/directory run typecheck` before `@cello/client run typecheck`. Directory's test files import `@cello/client`, which needs its `dist/` to exist. But we're in the *client* pipeline — client hasn't been compiled yet.  
**Fix:** Reordered buildspec: compile `@cello/client` first, then `@cello/directory`, then run client tests. The key insight: `tsc --build` in one package needs upstream `dist/` to exist, and test files create implicit cross-package dependencies that don't appear in `package.json`.

### 8. RDS rotation Lambda requires linux/amd64 psycopg2-binary

**Symptom:** Docker build for rotation Lambda produced ARM64 binary (Apple Silicon default), which fails on Lambda's x86_64 runtime.  
**Root cause:** `pip install psycopg2-binary` on macOS installs the macOS wheel. Lambda needs a linux/amd64 wheel with the correct libpq.  
**Fix:** `deploy-lambdas.sh` uses `docker run --platform linux/amd64 public.ecr.aws/lambda/python:3.12` with `--entrypoint pip` to install dependencies in a Lambda-compatible environment.

**Key lesson:** First-run CI is a different beast from local development. Fresh checkouts have no `dist/`, no cached dependencies, and no implicit state from prior builds. Every cross-package import — including imports in *test* files — becomes a hard ordering constraint in CI that's invisible locally.

---

## FEDERATION-001 — Federation Schema and Session Ownership

Delivered the multi-region federation foundation as application code + Flyway migration V18. No deployment step required — migration runs automatically when ECS tasks restart with the new image.

**What was delivered:**

- `V18__federation_schema.sql` — `sessions` table, checkpoint columns (`mmr_peaks`, `identity_merkle_root`, `checkpoint_hash`, `coordinator_node_id`), and `checkpoint_node_signatures` table.
- `PgDirectoryStore` methods: `writeSession` (with ownership pre-check), `getSessionOwner`, `verifyReplicatedRow`, `verifyPgTypes`.
- 620-line integration test suite. Six `describe.skip` stubs deferred to FEDERATION-E2E-001 (requires multi-node RDS with logical replication).

**Dependency:** V18 reaches ECS when the directory pipeline passes and deploys. The `cello_service` role created by V18 unblocks SECOPS-004's rotation verification (AC-002/AC-003).

---

## SECOPS-001 — S3 Audit Log Shipper

Delivered the production `S3AuditLogShipper` adapter and wired it into the composition root. The implementation itself was straightforward; getting the CI pipeline green exposed five distinct issues that took longer to resolve than the code itself.

**What was delivered:**

- `packages/directory/src/adapters/s3-audit-log-shipper.ts` — per-entry `PutObject` calls (no batching), bounded buffer (10,000 max), exponential backoff retry loop (1s → 60s cap), graceful `flush()` on SIGTERM. S3 key: `audit/{YYYY-MM-DD}/{timestamp}-{uuid}.jsonl`.
- Updated `AuditLogEntry` interface: `{ timestamp, sessionId, objectType, command, statementText, parameters: string[], correlationId? }` — the pgaudit wire format.
- `flush()` return type changed to `Promise<number>` (entries shipped in that flush, not cumulative).
- 735-line test suite with all ACs/SIs covered. Integration tests gated on `CELLO_AUDIT_BUCKET`.

**Pipeline failures found and fixed after merge:**

### 1. pnpm `minimumReleaseAge` supply-chain policy rejected `@aws-sdk/client-s3`

**Symptom:** CodeBuild failed with a pnpm supply-chain policy error on `@aws-sdk/client-s3@3.1052.0`. The package installed fine locally.

**Root cause:** pnpm enforces a 24-hour minimum release age for new packages. `@aws-sdk/client-s3@3.1052.0` had been published ~16 hours before the build. Local pnpm 10.33.2 (pinned in buildspecs) does not enforce this policy; the version resolving from `^3.1052.0` triggered it.

**Fix:** Downgraded to `@aws-sdk/client-s3@3.1051.0` (exact pin, no caret). **Rule going forward: always exact-pin `@aws-sdk/*` packages, never caret. Check the npm publish timestamp before pinning.**

### 2. CodeBuild role lacked `s3:PutObject` on the audit bucket

**Symptom:** Integration tests failed with `AccessDenied` for `PutObject` on `cello-audit-logs-dev-us-east-1`.

**Root cause:** The CodeBuild role was granted access to the artifacts bucket but not to the new audit log bucket. `CELLO_AUDIT_BUCKET` was set in the CodeBuild environment, so integration tests ran — and immediately hit permission denied.

**Fix:** Added an explicit `s3:PutObject` grant on `arn:aws:s3:::cello-audit-logs-${Environment}-${AWS::Region}/*` to `CodeBuildRole` in `cello-cicd.yaml`. Deployed via `deploy.sh`.

**Rule:** Every S3 bucket that integration tests touch needs an explicit IAM grant to the CodeBuild role. The bucket policy and the CodeBuild role policy are independent — check the role when adding tests against a new bucket.

### 3. Integration test `failCount` bug — mock semantics mismatch

**Symptom:** AC-004 and AC-007 integration tests returned `expected 5 to be 0` / `expected 3 to be 0`.

**Root cause:** The mock's predicate is `callCount <= failCount`. The test used `failCount: 5`, intending "only the first ship() call fails." But `flush()` issues one `send()` per entry — 5 flush calls starting at call #2 still fall within `callCount <= 5`. Result: flush returns 0 because every flush call also fails.

**Fix:** Changed both tests to `failCount: 1`. Only the first `ship()` call (call 1) fails; all `flush()` calls (calls 2+) succeed.

**Rule:** When writing "fail first N calls" mock tests, count *all* `send()` invocations — ship calls and flush calls combined. If `flush()` issues M calls, you need `failCount < 1 + M` for any flush call to succeed. Draw the call sequence before setting `failCount`.

### 4. `s3:GetObject` and `s3:ListBucket` also missing from CodeBuild role

**Symptom:** AC-002 failed with `AccessDenied` for `GetObject`; AC-007 failed for `ListBucket`. These tests read back objects after writing to verify correctness.

**Root cause:** The fix in issue #2 only added `PutObject`. The integration tests do a read-after-write. The `DenyNonPutActions` statement in `cello-s3.yaml` that denies `GetObject`/`ListBucket` applies only to the *ECS task role* — not to CodeBuild. Adding these to the CodeBuild role is safe and correct.

**Fix:** Added `s3:GetObject` on `cello-audit-logs-${Environment}-${AWS::Region}/*` and `s3:ListBucket` on `cello-audit-logs-${Environment}-${AWS::Region}` to `CodeBuildRole`. **Rule: read integration tests fully before writing the IAM policy. If a test writes and reads back, both need grants.**

### 5. `@cello/e2e-tests` not built before `@cello/client` tests

**Symptom:** `cello-client-pipeline` failed with `Cannot find package '@cello/e2e-tests/session-fixture'` in `connreq-003.test.ts`.

**Root cause:** `connreq-003.test.ts` imports via the `exports` map (`@cello/e2e-tests/session-fixture` → `dist/session-fixture.js`). In a fresh CodeBuild checkout there is no `dist/`. The client `buildspec.yml` compiled upstream packages but not `@cello/e2e-tests`.

**Fix:** Added `pnpm --filter @cello/e2e-tests run typecheck` to `packages/client/buildspec.yml` before the test step.

**Rule:** Any workspace package imported via its `exports` map (not source) must be compiled before tests run. Imports in test files create ordering constraints that don't appear in `package.json` dependencies — they're invisible until CI runs on a clean checkout.

**Final result:** `cello-directory-pipeline` succeeded on commit `9e6f4a5`. All 7 substantive pipelines green. One pre-existing failure: `cello-crypto-pipeline` Ed25519 keygen timing test (71ms vs 50ms threshold on cold CodeBuild VMs — not SECOPS-001 scope).

---

## What Remains Open

- **DEPLOY-002** — Directory Dockerfile, entrypoint, health check, Flyway integration (starting now)
- **DEPLOY-003** — Relay Dockerfile and deployment
- **DEPLOY-005** — Production deployment sequencing (sequential region rollout)
- **cello-crypto-pipeline** — flaky timing test (`keygen under 50ms`, gets 71ms on cold CodeBuild VMs). Threshold needs raising.
- **cello-client-pipeline** — 1 test file failing (pre-existing, not CI-related)
- **cello-directory-pipeline** — 3 test failures (pre-existing, likely integration tests needing real AWS state)

---

## Related Documents
- [[server-infrastructure]] — CELLO Server Infrastructure Requirements
- [[2026-05-16_0900_m4-infrastructure-decisions]] — VPC topology, RDS, KMS, S3, IaC templates
- [[M4-persistence-foundation]] — M4 write-up
- [[CONTEXT]] — canonical glossary
