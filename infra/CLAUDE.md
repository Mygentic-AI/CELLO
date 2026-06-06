# Infrastructure Code — Agent Instructions

These instructions are mandatory for any agent working on files under `infra/`.

---

## CloudFormation Resource Management

**Never create AWS resources manually that should be managed by CloudFormation.** If a resource is defined in a CFN template, it must only be created through `deploy.sh`. Manual creation (via CLI or console) causes `ResourceAlreadyExists` failures when CFN later attempts to create it.

**If you must create a resource manually as an emergency fix:** Document it in `infra/STATE.md` immediately, and either import it into the CFN stack via resource import OR delete it before the next `deploy.sh` run. Never leave manually-created resources undocumented — they will block all future deploys.

**Resource import requires both `DeletionPolicy: Retain` AND `UpdateReplacePolicy: Retain`** on the resource in the template before the import changeset can be accepted. If either is missing, add it and commit before attempting import.

---

## deploy.sh Is the Only Deployment Mechanism

**All CFN stack changes go through `deploy.sh`.** The CI/CD pipelines only swap Docker images — they do NOT deploy CloudFormation templates. Any change to task definitions (env vars, secrets, ports, IAM), ALBs, security groups, or any other CFN-managed resource requires running `deploy.sh`.

**After modifying any `infra/cloudformation/*.yaml` template:** You must either run `deploy.sh` or explicitly document in the commit message that deploy.sh must be run before the changes take effect.

---

## SSM Parameters and Migrations

**Every migration story that adds a new `V{N}` Flyway migration must also update `infra/cloudformation/cello-ssm-parameters.yaml` default value to `{N}`.** The ops-agent reads `EXPECTED_MIGRATION_VERSION` from SSM at startup and fails its health check if the value doesn't match the database. On fresh deployments (or parameter recreation), CFN uses the template default — if it's stale, the ops-agent crash-loops.

**The `deploy.sh` Step 2b guard preserves the current SSM value across CFN updates** (reads before, restores after). This handles the normal case. The template default only matters on first CREATE or after parameter deletion.

---

## ECS Task Definition External References

ECS task definitions reference external resources via `ValueFrom` (Secrets Manager, SSM) and `{{resolve:ssm:...}}`. These are resolved at task start time. **If any referenced resource doesn't exist, the ECS task will not start.**

Before running `deploy.sh` after any template change, verify ALL of the following exist in the target region:

### SSM Parameters (resolved at task start)
- `/cello/{env}/directory/hostname` — per-region directory hostname
- `/cello/{env}/directory/manifest-signer-pubkey` — directory node pubkey
- `/cello/{env}/ops-agent/expected-migration-version` — current migration version

### Secrets Manager (resolved at task start)
All secrets in `cello-secrets.yaml` must exist and be populated (not PLACEHOLDER) for services to function. The critical ones that cause immediate crash if missing:
- `cello/{env}/relay/transport-key` — relay won't start without this
- `cello/{env}/directory/transport-key` — directory won't start without this
- `cello/{env}/directory/node-private-key` — directory won't start without this

---

## Transport Keys Are Unique Per Region

**Each region MUST have its own unique transport key.** Transport keys derive the libp2p Peer ID deterministically. Sharing a transport key across regions means two nodes present the same Peer ID — a security violation that breaks the Noise XX handshake authentication and violates the sovereign node invariant.

**Never copy a transport key from one region to another.** Generate fresh values with `openssl rand -hex 32` per region.

---

## ECS Deployment Circuit Breaker

**Enable the deployment circuit breaker on all ECS services.** Without it, a crash-looping task causes ECS to retry indefinitely and CloudFormation waits forever (or until the CodeBuild timeout). With the circuit breaker, ECS detects repeated failures and marks the deployment as FAILED within minutes.

If a service is stuck in `CREATE_IN_PROGRESS` or `UPDATE_IN_PROGRESS` for more than 15 minutes with failed tasks, check if the circuit breaker is enabled:
```
aws ecs describe-services --cluster cello-dev --services <service-name> --region <region> \
  --query 'services[0].deploymentConfiguration.deploymentCircuitBreaker'
```

---

## ALB Deregistration Delay

**Set `deregistration_delay.timeout_seconds` to 30 on all ECS target groups.** The AWS default of 300 seconds causes CloudFormation stack updates and ECS rollbacks to take 5+ minutes per target, often exceeding CodeBuild timeouts. 30 seconds is sufficient for graceful connection draining in a dev environment.

---

## Docker Images in deploy.sh

**deploy.sh reads image URIs from SSM parameters** (set by CI/CD pipelines). It does NOT use a hardcoded image tag. If the SSM parameters don't exist (fresh environment), deploy.sh falls back to building stub images. Stubs pass CFN deployment but do NOT run the application — they exist only to satisfy ECS task definition requirements during initial stack creation.

**After initial stack creation with stubs:** Run the CI/CD pipeline to build and deploy real images. Or set `CELLO_IMAGE_TAG=<commit-sha>` to use a specific image.

---

## STATE.md Is Mandatory

**Update `infra/STATE.md` immediately after any infrastructure change.** Do not defer to end of session. If context is compacted and STATE.md wasn't updated, the information is lost permanently.

---

## deploy.sh Must Not Block on Non-Critical Services

**Make non-critical service deployments non-fatal in deploy.sh.** If a service like ops-agent fails to stabilize, deploy.sh should log the failure and continue to the next stack. Critical services (directory, relay) should remain fatal. The ops-agent is not required for CELLO protocol operation — it's a Telegram registration bot. Blocking relay and WAF deployment because of an ops-agent health check failure is unacceptable.

---

## Verify All Prerequisites Before Running deploy.sh

**Before every deploy.sh run, verify that ALL external references in ECS task definitions actually exist in the target region.** This includes:
- Every SSM parameter referenced via `{{resolve:ssm:...}}` or `ValueFrom`
- Every Secrets Manager secret referenced via `ValueFrom`
- Every CloudFormation export referenced via `!ImportValue`
- Every ECR image referenced by the deploy

A single missing reference causes the ECS task to crash-loop, which blocks the entire deployment pipeline. Do not assume prerequisites exist — check them.

---

## Ops-Agent Is Single-Region

The operations agent (`cello-ecs-operations-agent`) runs in **us-east-1 only** (single Telegram long-polling instance). The `deploy.sh` script deploys it to all regions for IaC consistency, but eu-central-1 and ap-northeast-1 instances will have PLACEHOLDER values for `telegram-bot-token` and `ses-credentials`. This is acceptable — they exist for IaC parity, not for operation.
