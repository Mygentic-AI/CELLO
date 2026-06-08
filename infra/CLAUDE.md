# Infrastructure Code — Agent Instructions

These instructions are mandatory for any agent working on files under `infra/`.

---

## Value Resolution Lifecycle — Know Which Stage You Are Fixing

**Every configuration value passes through a resolution pipeline. Updating the source does NOT fix downstream consumers unless you trigger re-resolution at every stage.**

| Stage | Mechanism in template | Resolves when | How to propagate a change |
|---|---|---|---|
| **1. CFN deploy-time** | `{{resolve:ssm:/path}}` | When `deploy.sh` runs and CFN creates/updates the stack | Run `deploy.sh` |
| **2. Task launch-time** | `ValueFrom: arn:aws:ssm:...` or `ValueFrom: arn:aws:secretsmanager:...` | When ECS launches a new task | Update source + force-new-deployment or task restart |
| **3. Application runtime** | App code calls `GetSecretValue()` / `GetParameter()` | When the application executes that call | Update source — app picks it up on next call |

**`RELAY_MANIFEST_SIGNER_PUBKEY` is stage 1** — `{{resolve:ssm:...}}` in `cello-ecs-directory.yaml`. Updating the SSM parameter alone has zero effect until `deploy.sh` runs.

**`CELLO_DIRECTORY_HOSTNAME` is stage 1** — same template, same caveat.

**Secrets Manager refs (`node-private-key`, `transport-key`, etc.) are stage 2** — `ValueFrom` with an ARN. Updating the secret + restarting the task is sufficient; no `deploy.sh` run needed.

**The verification rule:** After any fix, read the running task definition to confirm. The task definition is the ground truth — not SSM, not STATE.md:

```bash
TASK_DEF=$(aws ecs describe-services --cluster cello-dev --services cello-directory-dev \
  --region <region> --query 'services[0].taskDefinition' --output text)
aws ecs describe-task-definition --task-definition "$TASK_DEF" --region <region> \
  --query 'taskDefinition.containerDefinitions[0].environment[?name==`RELAY_MANIFEST_SIGNER_PUBKEY`].value'
```

`audit-state.sh` now checks this automatically (section 4: Task definition baked values vs. SSM).

*Root cause: 2026-06-07 — SSM parameters updated for eu-central-1 and ap-northeast-1 but deploy.sh not run; task definitions retained stale baked values; directory tasks continued crashing.*

---

## ECS Health Check — Liveness Only, Never Readiness

**`/health` must return 200 as soon as the process is up. Never make it conditional on a dependency, registration, or connection.**

ECS uses `/health` to decide whether to keep the task alive. If `/health` returns non-200 during startup — waiting for a registration, a downstream service, a connection to complete — ECS will kill the task before it can finish that step. The task restarts, hits the same gate, fails again. Deadlock, indefinitely.

If you need to distinguish "process is alive" from "service is fully ready", use ECS `startPeriod` (grace period before health checks count) or ALB unhealthy threshold counts — not a 503 from the endpoint. The application-level health check and the ECS liveness probe must not be the same concept.

*Root cause: 2026-06-06 — relay `/health` returned 503 until registration with directory completed. ECS killed 29 tasks in a loop across all 3 regions.*

---

## Required Config Anti-Pattern — Non-Negotiable

**Never use `Default: ""` for an environment variable that enables a critical service behavior.** An empty string default silently disables the feature — the service starts, passes health checks, and appears healthy while being operationally broken.

**The pattern that caused this rule (2026-06-06):** `DirectoryMultiaddr` in `cello-ecs-relay.yaml` had `Default: ""`. deploy.sh never passed the parameter. The relay deployed successfully, ECS marked it healthy, but `CELLO_DIRECTORY_MULTIADDR=""` meant the relay never dialed the directory and never registered. The S3 manifest stayed stale. No agents could get a relay assignment. The system was silently broken for the entire post-nuclear-reset period.

**Rules:**

1. **Required parameters have no `Default`.** If a feature cannot work without a parameter, remove `Default` entirely from the CloudFormation parameter. CloudFormation will then error at deploy time if the value is not passed — which is the correct failure mode.

2. **deploy.sh must assert non-empty before deploying.** For every parameter that is required for a service to function, deploy.sh must validate it is non-empty before calling `deploy_stack`. If the value cannot be derived (e.g. SSM parameter missing), deploy.sh must print a diagnostic and exit 1 rather than deploying a broken service.

3. **Application layer: health check must reflect real readiness.** A service that requires registration or connection to a dependency before it can serve traffic must return 503 from `/health` until that dependency is established. `status: 'ok'` means the service can do its job — not just that the process started. See `createRelayHealthServer({ requiresRegistration: true })` as the canonical implementation.

4. **When you add a new required env var to an ECS service:** immediately add it to `deploy.sh` with a non-empty assertion, and store any dynamic value (peer IDs, addresses) in SSM so deploy.sh can read it at deploy time.

*Root cause commit: deploy.sh passed `DirectoryNodePubkey` but never `DirectoryMultiaddr`. Fixed in the same commit that introduced this rule.*

---

## ECS Debugging — Mandatory Diagnostic Sources

**When an ECS task or service is failing, check ALL of the following before forming any hypothesis. Do not speculate until you have read each source.**

### 1. ECS Service Events (always first)
```bash
aws ecs describe-services --cluster cello-dev --services <service-name> --region <region> \
  --query 'services[0].events[0:10]' --output json
```
This is the authoritative record of why ECS stopped a task. It will say explicitly: "failed container health checks", "unable to pull image", "ResourceInitializationError", etc. **Read this before anything else.**

### 2. Stopped Task Details
```bash
# List stopped tasks
aws ecs list-tasks --cluster cello-dev --service-name <service-name> \
  --region <region> --desired-status STOPPED --output json

# Get stop reason and exit code
aws ecs describe-tasks --cluster cello-dev --tasks <task-arn> --region <region> \
  --query 'tasks[0].{stopCode:stopCode,stoppedReason:stoppedReason,containers:containers[*].{name:name,exitCode:exitCode,reason:reason}}' \
  --output json
```

### 3. Application Logs (CloudWatch)
```bash
aws logs describe-log-streams --log-group-name "/ecs/<service>-<env>" \
  --region <region> --order-by LastEventTime --descending \
  --query 'logStreams[0].logStreamName' --output text

aws logs get-log-events --log-group-name "/ecs/<service>-<env>" \
  --log-stream-name <stream> --region <region> \
  --query 'events[*].message' --output text | tr '\t' '\n'
```

### 4. CloudFormation Stack Events (for deploy failures)
```bash
aws cloudformation describe-stack-events --stack-name <stack-name> --region <region> \
  --query 'StackEvents[0:10].{Resource:LogicalResourceId,Status:ResourceStatus,Reason:ResourceStatusReason,Time:Timestamp}' \
  --output json
```

### 5. Deployment Circuit Breaker State
```bash
aws ecs describe-services --cluster cello-dev --services <service-name> --region <region> \
  --query 'services[0].{rollout:deployments[0].rolloutState,failed:deployments[0].failedTasks,circuit:deploymentConfiguration.deploymentCircuitBreaker}' \
  --output json
```

**The ECS service events (source 1) will tell you why SIGTERM was sent.** Application logs alone cannot tell you this — they only show that shutdown happened, not why ECS triggered it. Never diagnose a task stop without reading the service events first.

### 6. CloudTrail (for silent pre-start failures)
If a task fails before writing any log line, the cause is almost always IAM: the execution role was denied `secretsmanager:GetSecretValue` or `ssm:GetParameters`. Application logs will be empty. CloudTrail will have the denial:
```bash
aws cloudtrail lookup-events --region <region> \
  --lookup-attributes AttributeKey=EventName,AttributeValue=GetSecretValue \
  --query 'Events[0:5].{time:EventTime,user:Username,resource:Resources[0].ResourceName,result:ErrorCode}' \
  --output json
```

### 7. VPC Flow Logs (for network failures)
If the task starts but can't reach Telegram API, SES, or RDS, the application will hang or error. VPC Flow Logs show whether packets are leaving the subnet and whether responses are returning. Check in CloudWatch Logs under the VPC flow log group.

---

## Manual Step: Re-sign Manifest After Relay Re-registration (Not Yet Automated)

**When a relay restarts and re-registers with a new private IP, the directory updates its in-memory healthCheckUrl but does NOT re-sign and upload a new manifest to S3.** The directory only writes a new manifest on health state transitions (unavailable → available). An `already_registered` call with a changed IP skips manifest re-signing entirely.

**Symptom:** clients fetch the S3 manifest, get a stale `healthCheckUrl` pointing to a dead task IP, and cannot reach the relay.

**Manual fix — run after any relay restart:**
```bash
# 1. Get the new task private IP
TASK_ARN=$(aws ecs list-tasks --cluster cello-dev --service-name cello-relay-dev \
  --region <region> --query 'taskArns[0]' --output text)
aws ecs describe-tasks --cluster cello-dev --tasks "${TASK_ARN}" \
  --region <region> \
  --query 'tasks[0].containers[0].networkInterfaces[0].privateIpv4Address' \
  --output text

# 2. Update relay-defs file with new IP, then re-sign
./infra/sign-manifest.sh dev <region> /path/to/relay-defs.json
```

Run for all 3 regions. The directory picks up the new manifest on its next 2-minute poll — no restart needed.

**Future automation:** directory should detect that a re-registering relay's `healthCheckUrl` differs from the current manifest and re-sign automatically. Tracked in COORDINATION.md.

---

## Manifest Signer Pubkey SSM — Must Match node-private-key Secret

**`/cello/{env}/directory/manifest-signer-pubkey` in SSM must equal the Ed25519 public key derived from `cello/{env}/directory/node-private-key` in Secrets Manager.** The directory reads the SSM value at startup as the expected verification key for relay pool manifests. If they diverge, every directory task in that region crashes at startup with `relay.manifest.invalid: signature_verification_failed`.

**When this can get out of sync:**
- After a nuclear reset (new key pairs generated, SSM not updated)
- After manually rotating the `node-private-key` secret without updating the SSM parameter
- After running `sign-manifest.sh` which signs with the current key but does not update SSM

**How to check all 3 regions:**
```bash
for region in us-east-1 eu-central-1 ap-northeast-1; do
  SSM=$(aws ssm get-parameter --name "/cello/dev/directory/manifest-signer-pubkey" \
    --region "$region" --query 'Parameter.Value' --output text)
  PRIV=$(aws secretsmanager get-secret-value \
    --secret-id "cello/dev/directory/node-private-key" \
    --region "$region" --query 'SecretString' --output text)
  DERIVED=$(printf '%s' "$PRIV" | node infra/scripts/derive-pubkey.js 2>/dev/null)
  [[ "$SSM" == "$DERIVED" ]] && echo "$region: OK" || echo "$region: MISMATCH — SSM=$SSM DERIVED=$DERIVED"
done
```

**How to fix a mismatch:**
```bash
# Derive the correct pubkey and update SSM
PRIV=$(aws secretsmanager get-secret-value \
  --secret-id "cello/{env}/directory/node-private-key" \
  --region <region> --query 'SecretString' --output text)
DERIVED=$(printf '%s' "$PRIV" | node infra/scripts/derive-pubkey.js 2>/dev/null)
aws ssm put-parameter \
  --name "/cello/{env}/directory/manifest-signer-pubkey" \
  --value "$DERIVED" --type String --overwrite --region <region>
```

**`audit-state.sh` now checks this automatically** — a mismatch appears as a FAIL with the fix command printed inline.

*Root cause: 2026-06-07 — eu-central-1 and ap-northeast-1 SSM parameters were stale after key rotation; directory tasks crashed on startup; cello-directory-pipeline failed in ProductionDeploy after passing StagingDeploy (us-east-1 was correct, eu-central-1 was first to fail).*

---

## Route53 A Records — CFN Owns Them, Never Purge Manually

**Never delete a Route53 A record that a healthy CFN stack owns.** If you delete it outside CFN, CFN sees no diff on the next deploy and never recreates it — the record stays gone.

`purge_stale_dns_record()` in deploy.sh handles this correctly: it checks the CFN stack status before deleting. It only purges when the stack is missing or in a failed state (fresh region, post-nuclear-reset). If the stack is `CREATE_COMPLETE` or `UPDATE_COMPLETE`, it skips — CFN owns the record.

*Root cause: 2026-06-07 — purge ran unconditionally, deleting all 3 directory A records on every deploy. Fixed in commit `6d17b30`.*

---

## ALB DNS Names — Always Query AWS, Never Use STATE.md

**Never use STATE.md as the source for ALB DNS names.** ALB DNS names change any time a load balancer is recreated (stack delete+create, name conflict, etc.). STATE.md is updated manually and will be stale.

**Always query AWS directly:**
```bash
aws elbv2 describe-load-balancers --region <region> \
  --query 'LoadBalancers[?contains(LoadBalancerName,`cello-dir`)].{dns:DNSName,zone:CanonicalHostedZoneId}' \
  --output json
```

*Root cause: 2026-06-07 — manually recreating Route53 A records used a stale ALB DNS name from deploy logs instead of querying AWS. us-east-1 relay registration failed for ~30 minutes.*

---

## CloudFormation Template Limits

**CloudFormation `Description` field limit is 1024 characters.** This applies to the top-level template `Description` AND to each `AWS::CloudWatch::Alarm` `AlarmDescription` field. Both fields accept `!Sub` — the limit applies to the expanded string. Keep descriptions short or they will fail `CreateChangeSet` with `Template format error: 'Description' length is greater than 1024`.

**`AWS::Logs::MetricFilter` `DefaultValue` and `Dimensions` are mutually exclusive.** A `MetricTransformations` entry cannot have both `DefaultValue` and `Dimensions` set — CloudWatchLogs rejects it with `Invalid metric transformation: dimensions and default value are mutually exclusive properties`. Remove `DefaultValue` when using `Dimensions`.

---

## CloudFormation Resource Management

**Never create AWS resources manually that should be managed by CloudFormation.** If a resource is defined in a CFN template, it must only be created through `deploy.sh`. Manual creation (via CLI or console) causes `ResourceAlreadyExists` failures when CFN later attempts to create it.

**If you must create a resource manually as an emergency fix:** Document it in `infra/STATE.md` immediately, and either import it into the CFN stack via resource import OR delete it before the next `deploy.sh` run. Never leave manually-created resources undocumented — they will block all future deploys.

**Resource import requires both `DeletionPolicy: Retain` AND `UpdateReplacePolicy: Retain`** on the resource in the template before the import changeset can be accepted. If either is missing, add it and commit before attempting import.

---

## Pipeline Mappings Must Stay in Sync with the Live Lambda

**`infra/pipeline-mappings.json` is bundled into the `cello-pipeline-filter` Lambda at deploy time — it is NOT read from the repo at runtime.** The Lambda reads `/var/task/pipeline-mappings.json`, which is whatever was in the zip when `deploy-lambdas.sh` last ran. A git change to the file has zero effect until the Lambda is redeployed.

**Any time you modify `infra/pipeline-mappings.json` — adding a pipeline, renaming one, or changing prefix mappings — you MUST also redeploy the Lambda:**
```bash
./infra/deploy-lambdas.sh dev filter
```

**If you add a new CodePipeline to `cello-cicd.yaml`, you must do all three:**
1. Add the pipeline ARN to `PipelineFilterLambdaRole` → `StartPipelines` resource list in `cello-cicd.yaml`
2. Add the package prefix → pipeline mapping to `infra/pipeline-mappings.json`
3. Run `./infra/deploy-lambdas.sh dev filter` to bundle the updated mappings into the live Lambda

Skipping step 3 means the new pipeline will never be triggered by GitHub pushes. The filter Lambda will silently log `pipeline.filter.no_match` and do nothing.

---

## deploy.sh Is the Only Deployment Mechanism

**All CFN stack changes go through `deploy.sh`.** The CI/CD pipelines only swap Docker images — they do NOT deploy CloudFormation templates. Any change to task definitions (env vars, secrets, ports, IAM), ALBs, security groups, or any other CFN-managed resource requires running `deploy.sh`.

**After modifying any `infra/cloudformation/*.yaml` template:** You must either run `deploy.sh` or explicitly document in the commit message that deploy.sh must be run before the changes take effect.

---

## SSM Parameters and Migrations

**Every migration story that adds a new `V{N}` Flyway migration must also update `infra/cloudformation/cello-ssm-parameters.yaml` default value to `{N}`.** The ops-agent reads `EXPECTED_MIGRATION_VERSION` from SSM at startup and fails its health check if the value doesn't match the database. On fresh deployments (or parameter recreation), CFN uses the template default — if it's stale, the ops-agent crash-loops.

**The `deploy.sh` Step 2b guard preserves the current SSM value across CFN updates** (reads before, restores after). This handles the normal case. The template default only matters on first CREATE or after parameter deletion.

**CI/CD pipeline ordering hazard — Flyway applies new migration before ops-agent SSM is updated (observed 2026-06-07):**

The directory pipeline and the ops-agent pipeline run independently. Flyway runs inside the directory ECS task at startup and bumps the database version automatically. The ops-agent pipeline only swaps the Docker image — it does not update SSM. This creates a timing window:

1. Directory pipeline runs → new directory task starts → Flyway applies V{N} → database is now at V{N}
2. Ops-agent pipeline runs → new ops-agent task starts → reads SSM → SSM still says V{N-1} → health check fails → crash loop → ECS circuit breaker fires → pipeline fails

The pipeline failure is a false alarm — the service recovers once SSM is updated. But it fires on every migration deploy.

**Required manual step after any migration deploy:** Update SSM immediately after the directory pipeline completes:
```bash
aws ssm put-parameter \
  --name /cello/dev/ops-agent/expected-migration-version \
  --value "<N>" --overwrite --region us-east-1
```
ECS will restart the ops-agent task and pick up the new value. No code deploy needed.

**Root cause:** `deploy.sh` sets this SSM value automatically from migration files, but the CI/CD pipeline never calls `deploy.sh` — it only swaps images. This is the same class of problem as `RELAY_MANIFEST_SIGNER_PUBKEY` (stage-1 baked values) — both are consequences of the conscious decision that pipelines do not run `deploy.sh`.

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
