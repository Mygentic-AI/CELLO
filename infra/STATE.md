# CELLO Infrastructure State

This file is the authoritative record of what actually exists in AWS.
It is updated automatically by `infra/deploy.sh` after every successful deployment.

**Do not edit manually unless correcting an error.** Run `./infra/deploy.sh` to deploy and update.

Any agent or human that deploys, modifies, or tears down infrastructure **must update this file** before closing the session. If you ran `deploy.sh`, it updated this automatically. If you made manual AWS changes, update the relevant section by hand and commit.

---

## Environments

### dev — us-east-1
*Last deployed: 2026-05-27

| Stack | Status | Last Deployed | Notes |
|---|---|---|---|
| cello-ecr-dev | UPDATE_COMPLETE | 2026-05-27 | cello-operations-agent ECR repo added (OPS-AGENT-005A) |
| cello-iam-dev | UPDATE_COMPLETE | 2026-05-27 | ops-agent task/execution roles; directory roles include ops-agent/directory-api-key |
| cello-secrets-dev | UPDATE_COMPLETE | 2026-05-27 | ops-agent secrets: telegram-bot-token, ses-credentials, directory-api-key, rds-credentials |
| cello-vpc-dev | UPDATE_COMPLETE | 2026-05-27 | Port 8080+9090 for directory SG, port 80+443 for ALB SG; SSM+SSMMessages VPC endpoints; ops-agent SG added |
| cello-kms-dev | UPDATE_COMPLETE | 2026-05-27 | |
| cello-s3-dev | UPDATE_COMPLETE | 2026-05-25 | s3:ListBucket added for relay+directory task roles |
| cello-rds-dev | UPDATE_COMPLETE | 2026-05-25 | MasterUserSecret.SecretArn exported |
| cello-rotation-dev | UPDATE_COMPLETE | 2026-05-27 | Rotation Lambda covers ops-agent RDS creds (AC-009e) |
| cello-ecs-directory-dev | UPDATE_COMPLETE | 2026-05-27 | INTERNAL_API_KEY injected; /internal/* ALB rules (AC-009d); real image via pipeline |
| cello-ecs-operations-agent-dev | CREATE_COMPLETE | 2026-05-27 | Stub image running; real image via pipeline (OPS-AGENT-005B) |
| cello-waf-dev | UPDATE_COMPLETE | 2026-05-27 | WAFv2 WebACL: rate-limit 1000/5min, IP reputation (BLOCK), CommonRuleSet (COUNT); logs to aws-waf-logs-cello-dev |
| cello-ecs-relay-dev | UPDATE_COMPLETE | 2026-05-25 | Real image deployed via pipeline (commit 1af5c16) to all 3 regions |
| cello-cloudwatch-dev | UPDATE_COMPLETE | 2026-05-27 | Ops-agent ECS alarms added |
| cello-route53-dev | UPDATE_COMPLETE | 2026-05-27 | |
| cello-cicd-dev | UPDATE_COMPLETE | 2026-05-27 | cello-operations-agent-pipeline added |
| Lambda: cello-github-webhook-receiver-dev | DEPLOYED (real code) | 2026-05-22 | |
| Lambda: cello-pipeline-filter-dev | DEPLOYED (real code) | 2026-05-27 | pipeline-mappings.json includes operations-agent path filter |
| ECR Replication (account-level) | CONFIGURED | 2026-05-24 | us-east-1 → eu-central-1 + ap-northeast-1; filter: prefix "cello-" |
| SSM: /cello/dev/directory/manifest-signer-pubkey | CREATED | 2026-05-24 | 167ca6...27b5 (directory node pubkey) |
| Secret: cello/dev/directory/rds-replication-credentials | CREATED | 2026-05-25 | Replication user password (alphanumeric, 32-char) |

**Ops-agent secrets (us-east-1):**
| Secret | Path | Status | Notes |
|---|---|---|---|
| Telegram bot token (prod) | `cello/dev/ops-agent/telegram-bot-token` | POPULATED | @CelloConnectBot token; copied from legacy path `cello/ops-agent/telegram-bot-token` |
| directory-api-key / INTERNAL_API_KEY | `cello/dev/ops-agent/directory-api-key` | POPULATED | 256-bit random hex; shared by directory (INTERNAL_API_KEY) and ops-agent (DIRECTORY_API_KEY) |
| Ops-agent RDS credentials | `cello/dev/ops-agent/rds-credentials` | POPULATED (rotated) | Rotation Lambda set real password for `cello_ops_agent` PostgreSQL role |
| SES credentials | `cello/dev/ops-agent/ses-credentials` | PLACEHOLDER | Needs manual population with SES SMTP credentials |

#### Key Resources — dev us-east-1

| Resource | Value |
|---|---|
| VPC ID | vpc-042c7b8ac97f6a38b |
| VPC CIDR | 10.0.0.0/16 |
| Private Subnet A | subnet-05552d24bb15a7782 |
| Private Subnet B | subnet-0dba876a5a923404b |
| Public Subnet A | subnet-00780580ba49e6eb0 |
| Public Subnet B | subnet-03f5ad4cd18fca4c7 |
| Private Route Table ID | rtb-0463fe7bcbba06ecb |
| RDS Security Group | sg-07a7414f0f862067b |
| ECS Directory Security Group | sg-0cc7f8493f3aff8d8 |
| ECS Relay Security Group | sg-0cab5bd4ec63f05c7 |
| ALB Security Group | sg-0b694f5a0dcf0fbbb |
| KMS Key ARN | arn:aws:kms:us-east-1:257394457473:key/7eb72942-d9f4-4c9a-9494-05bce889a39f |
| KMS Key ID | 7eb72942-d9f4-4c9a-9494-05bce889a39f |
| Audit Log Bucket | cello-audit-logs-dev-us-east-1 |
| Relay Manifest Bucket | cello-relay-manifest-dev-us-east-1 |
| RDS Endpoint | cello-dev.c9iokw02w3f8.us-east-1.rds.amazonaws.com |
| RDS Port | 5432 |
| Directory ALB | cello-dir-dev-1136016900.us-east-1.elb.amazonaws.com |
| ALB Hosted Zone ID | Z35SXDOTRQ7X7K |
| Route 53 Record | directory-us1.cello.mygentic.ai |
| ACM Certificate | arn:aws:acm:us-east-1:257394457473:certificate/900d9dde-abd9-4d05-931b-507a6fdf55f4 |
| ECS Cluster | arn:aws:ecs:us-east-1:257394457473:cluster/cello-dev |
| RDS Rotation Lambda | arn:aws:lambda:us-east-1:257394457473:function:cello-dev-rds-rotation | DEPLOYED (real code + psycopg2-binary) 2026-05-22 |
| GitHub Webhook Receiver Lambda | arn:aws:lambda:us-east-1:257394457473:function:cello-github-webhook-receiver-dev |
| GitHub Webhook Receiver URL | https://e2cy6e5vuxif5zdqjjhy3aplqu0crnzi.lambda-url.us-east-1.on.aws/ |
| Pipeline Filter Lambda | arn:aws:lambda:us-east-1:257394457473:function:cello-pipeline-filter-dev |
| Directory Node Public Key | 167ca6b145bfdd3696af8f4befd883c3dc610f4a9c8d52a30f6a22f669dc27b5 |
| Relay Node Public Key | 8c3a882b15ad39f42044bac2044c76f00535e3ff345767b9fda7b4e665efc4e6 |
| ECS Ops-Agent Security Group | sg-07cc257e60bed1e49 |
| Ops-Agent Service ARN | arn:aws:ecs:us-east-1:257394457473:service/cello-dev/cello-operations-agent-dev |
| Ops-Agent Log Group | /ecs/cello-operations-agent-dev |
| Ops-Agent Execution Role | arn:aws:iam::257394457473:role/cello-dev-ops-agent-execution-role |
| Ops-Agent Task Role | arn:aws:iam::257394457473:role/cello-dev-ops-agent-task-role |
| Ops-Agent Pipeline | cello-operations-agent-pipeline (us-east-1 only) |
| SNS Topic — ops-critical | arn:aws:sns:us-east-1:257394457473:cello-ops-critical-dev |
| SNS Topic — ops-warning | arn:aws:sns:us-east-1:257394457473:cello-ops-warning-dev |
| CloudWatch Dashboard | cello-operations-dev |
| WAF WebACL ARN | arn:aws:wafv2:us-east-1:257394457473:regional/webacl/cello-waf-dev/6b71004a-5edd-450b-90f3-d529908502c4 |
| WAF Log Group | aws-waf-logs-cello-dev (90-day retention) |

### dev — eu-central-1
*Last deployed: 2026-05-28

| Stack | Status | Last Deployed | Notes |
|---|---|---|---|
| cello-ecr-dev | CREATE_COMPLETE | 2026-05-23 | |
| cello-iam-dev | UPDATE_COMPLETE | 2026-05-27 | ops-agent/directory-api-key permission added to directory execution role |
| cello-secrets-dev | UPDATE_COMPLETE | 2026-05-27 | ops-agent secrets added (telegram-bot-token, ses-credentials, directory-api-key, rds-credentials) |
| cello-vpc-dev | UPDATE_COMPLETE | 2026-05-28 | CIDR 10.1.0.0/16; port 9090 SG rule added for ALB health checks |
| cello-kms-dev | CREATE_COMPLETE | 2026-05-23 | |
| cello-s3-dev | UPDATE_COMPLETE | 2026-05-25 | Directory+relay task roles in manifest bucket policy |
| cello-rds-dev | UPDATE_COMPLETE | 2026-05-25 | MasterUserSecret.SecretArn exported |
| cello-rotation-dev | UPDATE_COMPLETE | 2026-05-25 | Now uses RDS-managed master secret (no manual admin creds) |
| cello-ecs-directory-dev | UPDATE_COMPLETE | 2026-05-28 | INTERNAL_API_KEY injected; port 9090 health check; real image via pipeline |
| cello-waf-dev | CREATE_COMPLETE | 2026-05-23 | WAFv2 WebACL |
| cello-ecs-relay-dev | CREATE_COMPLETE | 2026-05-23 | Real image via pipeline (ECR replication) |
| cello-cloudwatch-dev | CREATE_COMPLETE | 2026-05-23 | Alarms only — dashboard skipped (us-east-1 only) |
| cello-route53-dev | CREATE_COMPLETE | 2026-05-23 | |
| cello-cicd-dev | NOT DEPLOYED | — | CICD pipeline is us-east-1 only |
| Lambda: cello-dev-rds-rotation | DEPLOYED (real code) | 2026-05-25 | Real handler + psycopg2-binary; uses RDS-managed master secret |
| SSM: /cello/dev/directory/manifest-signer-pubkey | CREATED | 2026-05-25 | 167ca6...27b5 |
| Secret: cello/dev/directory/rds-replication-credentials | CREATED | 2026-05-25 | Replication user password (alphanumeric, 32-char) |

#### Key Resources — dev eu-central-1

| Resource | Value |
|---|---|
| VPC ID | vpc-04305bc6b6fe43406 |
| VPC CIDR | 10.1.0.0/16 |
| Private Subnet A | subnet-06e32e9f16fff5a35 |
| Private Subnet B | subnet-069064d143f5913dc |
| Public Subnet A | subnet-019bf77e7151de0ed |
| Public Subnet B | subnet-007407e0ec1beef83 |
| Private Route Table ID | rtb-0ae553aa68ff6b39c |
| RDS Security Group | sg-0f8c3f52c03e71d4e |
| ECS Directory Security Group | sg-03bbc9555ec64bb3b |
| ECS Relay Security Group | sg-059f34c83eda437f0 |
| ALB Security Group | sg-03a26d8b34d60b4f7 |
| KMS Key ARN | arn:aws:kms:eu-central-1:257394457473:key/708cea66-0fa3-4bcb-8120-b98ae5038953 |
| Audit Log Bucket | cello-audit-logs-dev-eu-central-1 |
| Relay Manifest Bucket | cello-relay-manifest-dev-eu-central-1 |
| RDS Endpoint | cello-dev.clu08oy88g6v.eu-central-1.rds.amazonaws.com |
| RDS Port | 5432 |
| Directory ALB | cello-dir-dev-1699677837.eu-central-1.elb.amazonaws.com |
| Route 53 Record | directory-eu1.cello.mygentic.ai |
| ECS Cluster | arn:aws:ecs:eu-central-1:257394457473:cluster/cello-dev |
| Directory Node Public Key | 8105b180b753d97b50039a7e94433fd2b419f43d61f9ad7caf2ac15ad5cd1b45 |
| Relay Node Public Key | 015ffd3a10c58019128806dc94c7c737146f448cdd0a97c6fa05be9cc04471e8 |
| SNS Topic — ops-critical | arn:aws:sns:eu-central-1:257394457473:cello-ops-critical-dev |
| SNS Topic — ops-warning | arn:aws:sns:eu-central-1:257394457473:cello-ops-warning-dev |

### dev — ap-northeast-1
*Last deployed: 2026-05-28

| Stack | Status | Last Deployed | Notes |
|---|---|---|---|
| cello-ecr-dev | CREATE_COMPLETE | 2026-05-23 | |
| cello-iam-dev | UPDATE_COMPLETE | 2026-05-27 | ops-agent/directory-api-key permission added to directory execution role |
| cello-secrets-dev | UPDATE_COMPLETE | 2026-05-27 | ops-agent secrets added (telegram-bot-token, ses-credentials, directory-api-key, rds-credentials) |
| cello-vpc-dev | UPDATE_COMPLETE | 2026-05-28 | CIDR 10.2.0.0/16; port 9090 SG rule added for ALB health checks |
| cello-kms-dev | CREATE_COMPLETE | 2026-05-23 | |
| cello-s3-dev | UPDATE_COMPLETE | 2026-05-25 | Directory+relay task roles in manifest bucket policy |
| cello-rds-dev | UPDATE_COMPLETE | 2026-05-25 | MasterUserSecret.SecretArn exported |
| cello-rotation-dev | UPDATE_COMPLETE | 2026-05-25 | Now uses RDS-managed master secret (no manual admin creds) |
| cello-ecs-directory-dev | UPDATE_COMPLETE | 2026-05-28 | INTERNAL_API_KEY injected; port 9090 health check; real image via pipeline |
| cello-waf-dev | CREATE_COMPLETE | 2026-05-23 | WAFv2 WebACL |
| cello-ecs-relay-dev | CREATE_COMPLETE | 2026-05-23 | Real image via pipeline (ECR replication) |
| cello-cloudwatch-dev | CREATE_COMPLETE | 2026-05-23 | Alarms only — dashboard skipped (us-east-1 only) |
| cello-route53-dev | CREATE_COMPLETE | 2026-05-23 | |
| cello-cicd-dev | NOT DEPLOYED | — | CICD pipeline is us-east-1 only |
| Lambda: cello-dev-rds-rotation | DEPLOYED (real code) | 2026-05-25 | Real handler + psycopg2-binary; uses RDS-managed master secret |
| SSM: /cello/dev/directory/manifest-signer-pubkey | CREATED | 2026-05-25 | 167ca6...27b5 |
| Secret: cello/dev/directory/rds-replication-credentials | CREATED | 2026-05-25 | Replication user password (alphanumeric, 32-char) |

#### Key Resources — dev ap-northeast-1

| Resource | Value |
|---|---|
| VPC ID | vpc-09a2484e197738d18 |
| VPC CIDR | 10.2.0.0/16 |
| Private Subnet A | subnet-044662950bc5caa85 |
| Private Subnet B | subnet-0bf9a32c30489202b |
| Public Subnet A | subnet-0f6aff3a5b4bd84fd |
| Public Subnet B | subnet-058e2b5494b0f94ae |
| Private Route Table ID | rtb-0e890d359a5e7343c |
| RDS Security Group | sg-0c2cde157e5d56b6e |
| ECS Directory Security Group | sg-044abb3a83039a91f |
| ECS Relay Security Group | sg-0086fe960206120e9 |
| ALB Security Group | sg-0923b65ca091960c6 |
| KMS Key ARN | arn:aws:kms:ap-northeast-1:257394457473:key/08735b67-1c27-494c-bb6a-e974c0cc0cff |
| Audit Log Bucket | cello-audit-logs-dev-ap-northeast-1 |
| Relay Manifest Bucket | cello-relay-manifest-dev-ap-northeast-1 |
| RDS Endpoint | cello-dev.cryg2a8say19.ap-northeast-1.rds.amazonaws.com |
| RDS Port | 5432 |
| Directory ALB | cello-dir-dev-1435901052.ap-northeast-1.elb.amazonaws.com |
| Route 53 Record | directory-ap1.cello.mygentic.ai |
| ECS Cluster | arn:aws:ecs:ap-northeast-1:257394457473:cluster/cello-dev |
| Directory Node Public Key | 9b4b673a16487ba47363e3eaff844bf68f19736d82967918fb896b813e39b984 |
| Relay Node Public Key | 2b69812f22e11877f9bb72f855ab332bdb625997aa92bf582ce052f1c6167ca2 |
| SNS Topic — ops-critical | arn:aws:sns:ap-northeast-1:257394457473:cello-ops-critical-dev |
| SNS Topic — ops-warning | arn:aws:sns:ap-northeast-1:257394457473:cello-ops-warning-dev |

### dev — VPC Peering
*Last deployed: 2026-05-23*

| Stack | Region | Peering Connection ID | Status |
|---|---|---|---|
| cello-peering-dev-us-east-1-to-eu-central-1 | us-east-1 | pcx-0b4ae5708cbbdd14f | active |
| cello-peering-dev-eu-central-1-accepts-us-east-1 | eu-central-1 | pcx-0b4ae5708cbbdd14f | active |
| cello-peering-dev-us-east-1-to-ap-northeast-1 | us-east-1 | pcx-0908d974387764c34 | active |
| cello-peering-dev-ap-northeast-1-accepts-us-east-1 | ap-northeast-1 | pcx-0908d974387764c34 | active |
| cello-peering-dev-eu-central-1-to-ap-northeast-1 | eu-central-1 | pcx-05b4806864753695e | active |
| cello-peering-dev-ap-northeast-1-accepts-eu-central-1 | ap-northeast-1 | pcx-05b4806864753695e | active |

Ports open between all VPC pairs: 5432 (RDS replication), 4001 (checkpoint cross-signing).
Deploy with: `./infra/deploy-peering.sh dev`

### dev — Logical Replication
*Last configured: 2026-05-25*

All RDS instances have `wal_level = logical` and `rds.logical_replication = 1` (parameter group, rebooted).

| Component | us-east-1 | eu-central-1 | ap-northeast-1 |
|---|---|---|---|
| Replication user | `cello_replication` (GRANT rds_replication) | `cello_replication` | `cello_replication` |
| Publication | `cello_pub` (11 tables — includes registrations, pre_authorization_tokens added OPS-AGENT-000; **setup-replication.sh must be re-run on live cluster before OPS-AGENT-005B deploys — AC-007b**) | `cello_pub` (11 tables — same, pending re-run) | `cello_pub` (11 tables — same, pending re-run) |
| Subscriptions (inbound) | from eu-central-1, from ap-northeast-1 | from us-east-1, from ap-northeast-1 | from us-east-1, from eu-central-1 |

**Replication Slots (6 total, all streaming):**

| Source Region | Slot Name | Target Region | State |
|---|---|---|---|
| us-east-1 | cello_dev_us_east_1_eu_central_1 | eu-central-1 | streaming |
| us-east-1 | cello_dev_us_east_1_ap_northeast_1 | ap-northeast-1 | streaming |
| eu-central-1 | cello_dev_eu_central_1_us_east_1 | us-east-1 | streaming |
| eu-central-1 | cello_dev_eu_central_1_ap_northeast_1 | ap-northeast-1 | streaming |
| ap-northeast-1 | cello_dev_ap_northeast_1_us_east_1 | us-east-1 | streaming |
| ap-northeast-1 | cello_dev_ap_northeast_1_eu_central_1 | eu-central-1 | streaming |

Setup with: `./infra/setup-replication.sh dev`

### staging — not deployed

### production — not deployed

---

## Global Resources

| Resource | Value | Notes |
|---|---|---|
| AWS Account ID | 257394457473 | |
| ECR repo — directory (us-east-1) | 257394457473.dkr.ecr.us-east-1.amazonaws.com/cello-directory | |
| ECR repo — relay (us-east-1) | 257394457473.dkr.ecr.us-east-1.amazonaws.com/cello-relay | |
| ECR repo — directory (eu-central-1) | 257394457473.dkr.ecr.eu-central-1.amazonaws.com/cello-directory | |
| ECR repo — relay (eu-central-1) | 257394457473.dkr.ecr.eu-central-1.amazonaws.com/cello-relay | |
| ECR repo — directory (ap-northeast-1) | 257394457473.dkr.ecr.ap-northeast-1.amazonaws.com/cello-directory | Added by FEDERATION-E2E-001 |
| ECR repo — relay (ap-northeast-1) | 257394457473.dkr.ecr.ap-northeast-1.amazonaws.com/cello-relay | Added by FEDERATION-E2E-001 |
| ECR repo — operations-agent (us-east-1) | 257394457473.dkr.ecr.us-east-1.amazonaws.com/cello-operations-agent | Added by OPS-AGENT-005A; created by cello-ecr stack |
| ECR repo — operations-agent (eu-central-1) | 257394457473.dkr.ecr.eu-central-1.amazonaws.com/cello-operations-agent | Added by OPS-AGENT-005A; replicated via account-level ECR replication |
| ECR repo — operations-agent (ap-northeast-1) | 257394457473.dkr.ecr.ap-northeast-1.amazonaws.com/cello-operations-agent | Added by OPS-AGENT-005A; replicated via account-level ECR replication |
| Current directory image | 257394457473.dkr.ecr.us-east-1.amazonaws.com/cello-directory:33377b0 | Built from commit 33377b0, deployed 2026-05-28 via pipeline; all 3 regions; includes INTERNAL_API_KEY + /internal/* ALB rules + port 9090 health |
| Current relay image | 257394457473.dkr.ecr.us-east-1.amazonaws.com/cello-relay:6e0c50b | Built from commit 6e0c50b, deployed 2026-05-22 |
| Current operations-agent image | (stub) | OPS-AGENT-005A stub; real image deployed by OPS-AGENT-005B pipeline |
| Route 53 Hosted Zone | cello.mygentic.ai | Zone ID read at deploy time via aws route53 list-hosted-zones |
| CodeStar Connection (us-east-1) | arn:aws:codeconnections:us-east-1:257394457473:connection/1a7fba2b-dd1d-4ebe-8372-7122b89f56b5 | AVAILABLE — override via CELLO_GITHUB_CONNECTION_ID |

---

## Bootstrap Operations

| Item | Status | Date | Notes |
|---|---|---|---|
| Route 53 hosted zone `cello.mygentic.ai` | Done | 2026-05-21 | NS delegated from GoDaddy |
| ECR repo `cello-directory` | Done | 2026-05-21 | us-east-1 |
| ECR repo `cello-relay` | Done | 2026-05-21 | us-east-1 |
| Stub images pushed (linux/amd64) | Done | 2026-05-22 | Run `./infra/build-stubs.sh <region>` — never `docker build` directly (arm64 on Apple Silicon breaks ECS) |
| CodeStar Connection `github-cello-main` | Done | 2026-05-22 | us-east-1, AVAILABLE |
| Ed25519 key pairs — us-east-1 | Done | 2026-05-22 | Run `./infra/scripts/generate-node-keys.sh dev us-east-1` |
| Ed25519 key pairs — eu-central-1 | Done | 2026-05-23 | Run `./infra/scripts/generate-node-keys.sh dev eu-central-1` |
| Ed25519 key pairs — ap-northeast-1 | Done | 2026-05-23 | Run `./infra/scripts/generate-node-keys.sh dev ap-northeast-1` |
| GitHub webhook HMAC secret | Done | 2026-05-22 | Registered per infra/runbooks/github-webhook-setup.md; us-east-1 only |
| SES domain identity `mygentic.ai` | Done | 2026-05-25 | us-east-1; DKIM verified; MAIL FROM `mail.mygentic.ai`; production access granted |
| Secret `cello/ops-agent/telegram-bot-token` | Done | 2026-05-25 | us-east-1; `@CelloConnectBot` production bot |
| Secret `cello/ops-agent/telegram-bot-token-staging` | Done | 2026-05-25 | us-east-1; `@CelloConnectStagingBot` staging bot |
| npm org `@cello-protocol` | Done | 2026-05-26 | npmjs.com; scope for all client packages |
| GitHub Secret `NPM_TOKEN` (cello-client) | Done | 2026-05-26 | Granular token, read-write, `@cello-protocol` scope; **expires 2026-08-24 — rotate before this date** |

---

## How to Deploy

```bash
# Deploy or update an environment
./infra/deploy.sh dev us-east-1
./infra/deploy.sh staging eu-central-1
./infra/deploy.sh production ap-northeast-1   # requires YES confirmation

# Override image tag (default: stub)
CELLO_IMAGE_TAG=v1.2.3 ./infra/deploy.sh dev us-east-1

# Override GitHub connection ID (default: dev connection UUID)
CELLO_GITHUB_CONNECTION_ID=<uuid> ./infra/deploy.sh staging eu-central-1
```
