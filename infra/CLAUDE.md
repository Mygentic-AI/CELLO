# Infrastructure Code — Agent Instructions

These instructions are mandatory for any agent working on files under `infra/`.

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
