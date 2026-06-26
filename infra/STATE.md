# CELLO Infrastructure State

This file is the authoritative record of what actually exists in AWS.
It is updated automatically by `infra/deploy.sh` after every successful deployment.

**Do not edit manually unless correcting an error.** Run `./infra/deploy.sh` to deploy and update.

Any agent or human that deploys, modifies, or tears down infrastructure **must update this file** before closing the session. If you ran `deploy.sh`, it updated this automatically. If you made manual AWS changes, update the relevant section by hand and commit.

---

## Environments

### dev — us-east-1
*Last deployed: 2026-06-10

| Stack | Status | Last Deployed | Notes |
|---|---|---|---|
| cello-ecr-dev | UPDATE_COMPLETE | 2026-06-05 | OperationsAgentRepo imported via CFN resource import |
| cello-iam-dev | UPDATE_COMPLETE | 2026-06-05 | Fresh deploy from current IaC |
| cello-secrets-dev | UPDATE_COMPLETE | 2026-06-05 | DirectoryTransportKey + RelayTransportKey imported; all secrets CFN-managed |
| cello-ssm-parameters-dev | UPDATE_COMPLETE | 2026-06-07 | SSM migration version = V30 (updated manually 2026-06-07 after M6B-016 pipeline; ops-agent healthy) |
| cello-vpc-dev | UPDATE_COMPLETE | 2026-06-07 | M6B-014: NatGateway + NatEip + PrivateNatRoute added; interface endpoints retained for stage-2 removal |
| cello-kms-dev | CREATE_COMPLETE | 2026-05-27 | No changes |
| cello-s3-dev | UPDATE_COMPLETE | 2026-06-05 | Fresh deploy from current IaC |
| cello-rds-dev | UPDATE_COMPLETE | 2026-06-05 | Fresh deploy from current IaC |
| cello-rotation-dev | UPDATE_COMPLETE | 2026-06-05 | Fresh deploy from current IaC |
| cello-ecs-directory-dev | UPDATE_COMPLETE | 2026-06-10 | M6B-019 SSM node registry; image cello-directory:934d130; task def :170 |
| cello-ecs-operations-agent-dev | UPDATE_COMPLETE | 2026-06-07 | M6B-016 registration engine; image cello-operations-agent:f4c3e72; task def :43; migrationVersion=30 confirmed healthy |
| cello-waf-dev | UPDATE_COMPLETE | 2026-06-06 | Deployed r12 |
| cello-ecs-relay-dev | UPDATE_COMPLETE | 2026-06-07 | Running task def :55 (pipeline-deployed 2026-06-07) |
| cello-cloudwatch-dev | UPDATE_COMPLETE | 2026-06-06 | Deployed r12 |
| cello-route53-dev | UPDATE_COMPLETE (CFN DRIFT) | 2026-06-07 | A record deleted by purge_stale_dns_record() bug during M6B-014 deploy. Recreated manually 2026-06-07. deploy.sh fixed (commit 6d17b30) — drift resolves on next deploy.sh run. |
| cello-route53-relay-dev | UPDATE_COMPLETE (CFN DRIFT) | 2026-06-07 | A record deleted by purge_stale_dns_record() bug. Recreated manually 2026-06-07. Drift resolves on next deploy.sh run. |
| cello-cicd-dev | UPDATE_COMPLETE | 2026-06-06 | Deployed r12 |
| Lambda: cello-github-webhook-receiver-dev | DEPLOYED (real code) | 2026-05-22 | |
| Lambda: cello-pipeline-filter-dev | DEPLOYED (real code) | 2026-06-06 | REPOSPLIT-002: removed 4 dead pipelines (crypto/protocol-types/transport/client); now 5 pipelines only |
| ECR Replication (account-level) | CONFIGURED | 2026-05-24 | us-east-1 → eu-central-1 + ap-northeast-1; filter: prefix "cello-" |
| SSM: /cello/dev/directory/manifest-signer-pubkey (us-east-1) | UPDATED | 2026-06-07 | 167ca6...27b5 — correct, matches node-private-key |
| SSM: /cello/dev/directory/manifest-signer-pubkey (eu-central-1) | UPDATED | 2026-06-07 | 8105b1...1b45 — corrected manually; was stale 167ca6...27b5 from nuclear reset |
| SSM: /cello/dev/directory/manifest-signer-pubkey (ap-northeast-1) | UPDATED | 2026-06-07 | 9b4b67...b984 — corrected manually; was stale 167ca6...27b5 from nuclear reset |
| SSM: /cello/dev/directory/peer-id (us-east-1) | CREATED | 2026-06-06 | 12D3KooWS46wUj6NYvoAsocxZnxth5EgYD2ZXCm7coMkXUWgS1j3 — relay reads this for auto-registration |
| Secret: cello/dev/directory/rds-replication-credentials | CREATED | 2026-05-25 | Replication user password (alphanumeric, 32-char) |

**SSM Node Registry (CELLO-M6B-019) — written by deploy.sh step 6.7:**

Each region stores the full node set so services read locally without cross-region calls.
Path: `/cello/{env}/nodes/{role}/aws-{region}` — Value: JSON `{ hostname, peerId, port, transport, status }`
Written by deploy.sh at deploy time. Directory reads at startup via `ssm:GetParametersByPath`.

| Parameter Path | Purpose | Written By |
|---|---|---|
| /cello/dev/nodes/relay/aws-us-east-1 | Relay node registry entry (us-east-1) | deploy.sh step 6.7 |
| /cello/dev/nodes/relay/aws-eu-central-1 | Relay node registry entry (eu-central-1) | deploy.sh step 6.7 |
| /cello/dev/nodes/relay/aws-ap-northeast-1 | Relay node registry entry (ap-northeast-1) | deploy.sh step 6.7 |
| /cello/dev/nodes/directory/aws-us-east-1 | Directory node registry entry (us-east-1) | deploy.sh step 6.7 |
| /cello/dev/nodes/directory/aws-eu-central-1 | Directory node registry entry (eu-central-1) | deploy.sh step 6.7 |
| /cello/dev/nodes/directory/aws-ap-northeast-1 | Directory node registry entry (ap-northeast-1) | deploy.sh step 6.7 |

Status: DEPLOYED 2026-06-10 — deploy.sh wrote all 6 parameters across all 3 regions; directory reading from SSM at startup as of image 934d130

**Transport key secrets (all regions) — IMPORTED into cello-secrets-dev stack 2026-06-05:**
| Secret | Logical ID | ARN | CFN Status |
|---|---|---|---|
| Directory transport key (us-east-1) | `DirectoryTransportKey` | `arn:aws:secretsmanager:us-east-1:257394457473:secret:cello/dev/directory/transport-key-m146A8` | `UPDATE_COMPLETE` |
| Directory transport key (eu-central-1) | `DirectoryTransportKey` | `arn:aws:secretsmanager:eu-central-1:257394457473:secret:cello/dev/directory/transport-key-s5OinO` | `UPDATE_COMPLETE` |
| Directory transport key (ap-northeast-1) | `DirectoryTransportKey` | `arn:aws:secretsmanager:ap-northeast-1:257394457473:secret:cello/dev/directory/transport-key-usvz8z` | `UPDATE_COMPLETE` |
| Relay transport key (us-east-1) | `RelayTransportKey` | `arn:aws:secretsmanager:us-east-1:257394457473:secret:cello/dev/relay/transport-key-Xs6yZY` | `UPDATE_COMPLETE` |
| Relay transport key (eu-central-1) | `RelayTransportKey` | `arn:aws:secretsmanager:eu-central-1:257394457473:secret:cello/dev/relay/transport-key-ARIlzc` | `UPDATE_COMPLETE` |
| Relay transport key (ap-northeast-1) | `RelayTransportKey` | `arn:aws:secretsmanager:ap-northeast-1:257394457473:secret:cello/dev/relay/transport-key-9fQh1D` | `UPDATE_COMPLETE` |
All six secrets imported via CFN resource import changeset `import-transport-keys` (2026-06-05). Stack reached `IMPORT_COMPLETE` in all three regions. Both resources carry `DeletionPolicy: Retain` and `UpdateReplacePolicy: Retain`. Secret values (real transport keys) were pre-populated manually — the PLACEHOLDER_POPULATE_VIA_CLI in cello-secrets.yaml only applies on first CREATE; import left existing values untouched.

**Ops-agent secrets (us-east-1):**
| Secret | Path | Status | Notes |
|---|---|---|---|
| Telegram bot token (staging) | `cello/dev/ops-agent/telegram-bot-token` | POPULATED | @CelloConnectStagingBot token; swapped from prod→staging 2026-05-29 (dev env should use staging bot) |
| directory-api-key / INTERNAL_API_KEY | `cello/dev/ops-agent/directory-api-key` | POPULATED | 256-bit random hex; shared by directory (INTERNAL_API_KEY) and ops-agent (DIRECTORY_API_KEY) |
| Ops-agent RDS credentials | `cello/dev/ops-agent/rds-credentials` | POPULATED (rotated) | Rotation Lambda set real password for `cello_ops_agent` PostgreSQL role; re-rotated 2026-05-29 |
| SES credentials | `cello/dev/ops-agent/ses-credentials` | POPULATED | IAM user `cello-ses-smtp-dev` access key; populated 2026-05-29 |

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
| Directory ALB | cello-dir-dev-85618485.us-east-1.elb.amazonaws.com |
| Relay ALB | cello-relay-dev-913894764.us-east-1.elb.amazonaws.com |
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
| IAM User (SES SMTP) | cello-ses-smtp-dev | Created 2026-05-29; access key stored in ses-credentials secret |

**Nuclear reset (2026-06-05/06):**
All ECS service stacks (directory, relay, ops-agent), WAF, CloudWatch, and Route53 stacks were deleted across all three regions to eliminate accumulated CFN drift. The directory stack was recreated fresh from current IaC on 2026-06-05 (CREATE_COMPLETE in all 3 regions). Remaining stacks (ops-agent, relay, WAF, CloudWatch, Route53) await the next deploy.sh run.

Root cause of drift: manual AWS changes were made over May 23–June 4 (ALB listener rules, security group rules, task definitions) without subsequent deploy.sh runs. The IaC was updated to match but deploy.sh was never executed in any region after 2026-05-28. This caused CFN resource conflicts (AlreadyExists errors) when deploy.sh was finally run on 2026-06-05.

All prior "Manual changes" entries are now resolved — the nuclear reset eliminated all drift. The fresh directory stacks are created from the current IaC (commit 44dc27c+) which includes all M6B stories: port-8081 internal API target group (M6B-004), relay auto-registration (M6B-006), relay WebSocket ALB (M6B-007), poll loop (M6B-008), pg pool max + idle sweep (M6B-009), SSM migration version (M6B-011).

Demo-agent IAM role `cello-agent-ssm-role` with inline policy `cello-demo-secrets-manager` remains live (not in IaC — predates CloudFormation, shared with openclaw-agent).

**M6B-011: SSM parameter for ops-agent expected migration version (CELLO-M6B-011):**
Stack `cello-ssm-parameters-dev` (new, us-east-1 only — ops-agent is us-east-1 only) manages `/cello/dev/ops-agent/expected-migration-version`. The `deploy.sh` script automatically preserves the operator-set value via a read-before/restore-after guard (deploy.sh Step 2b, lines ~347-358): it reads the current parameter value before deploying the stack, then restores it immediately after if CloudFormation reset it. Manual re-set is only needed if the parameter is set outside of `deploy.sh`. To update the expected migration version after a new migration is applied, simply set the SSM parameter directly and restart the ECS task — no code deploy required:
```
aws ssm put-parameter \
  --name /cello/dev/ops-agent/expected-migration-version \
  --value "<current_version>" --overwrite --region us-east-1
aws ecs stop-task \
  --cluster cello-dev \
  --task $(aws ecs list-tasks --cluster cello-dev --service-name cello-operations-agent-dev --query 'taskArns[0]' --output text --region us-east-1) \
  --region us-east-1
```
ECS will start a replacement task that reads the updated SSM value. The current migration version as of M6B-011 is 28. Whenever a new migration is applied, update this parameter immediately (no code deploy required — that is the point of using SSM).

**M6B-014: NAT Gateway — DEPLOYED 2026-06-07:**
Deployed to all 3 regions. NAT Gateway active in each VPC, relay→directory registration working via public hostname. 6 interface endpoints retained for stage-2 removal (non-blocking). Manual SG rule (relay→directory port 4000) removed. Manual task def :55 superseded by CFN-managed :54.

Route53 drift note: purge_stale_dns_record() bug (fixed in commit 6d17b30) deleted all 6 A records (3 directory + 3 relay) during the M6B-014 deploy. All 6 recreated manually 2026-06-07. Drift resolves on next deploy.sh run.

**SSM Parameter required for new regions (M6B-004):** CELLO_DIRECTORY_HOSTNAME now fetched from SSM Parameter Store path `/cello/{Environment}/directory/hostname` instead of hardcoded Mappings block. For region expansion, create this parameter before deploying cello-ecs-directory stack. Existing regions (us-east-1, eu-central-1, ap-northeast-1) must have this parameter created manually before next deploy:
- us-east-1: `aws ssm put-parameter --name /cello/dev/directory/hostname --value directory-us1.cello.mygentic.ai --type String --region us-east-1`
- eu-central-1: `aws ssm put-parameter --name /cello/dev/directory/hostname --value directory-eu1.cello.mygentic.ai --type String --region eu-central-1`
- ap-northeast-1: `aws ssm put-parameter --name /cello/dev/directory/hostname --value directory-ap1.cello.mygentic.ai --type String --region ap-northeast-1`

### dev — eu-central-1
*Last deployed: 2026-06-10

| Stack | Status | Last Deployed | Notes |
|---|---|---|---|
| cello-ecr-dev | UPDATE_COMPLETE | 2026-06-05 | |
| cello-iam-dev | UPDATE_COMPLETE | 2026-06-05 | |
| cello-secrets-dev | UPDATE_COMPLETE | 2026-06-05 | DirectoryTransportKey + RelayTransportKey imported |
| cello-ssm-parameters-dev | UPDATE_COMPLETE | 2026-06-06 | |
| cello-vpc-dev | UPDATE_COMPLETE | 2026-06-05 | |
| cello-kms-dev | CREATE_COMPLETE | 2026-05-23 | |
| cello-s3-dev | UPDATE_COMPLETE | 2026-06-05 | |
| cello-rds-dev | UPDATE_COMPLETE | 2026-06-05 | |
| cello-rotation-dev | UPDATE_COMPLETE | 2026-06-05 | |
| cello-ecs-directory-dev | UPDATE_COMPLETE | 2026-06-10 | M6B-019 SSM node registry; image cello-directory:934d130; task def :59 |
| cello-ecs-operations-agent-dev | NOT DEPLOYED | — | eu-central-1 only has PLACEHOLDER secrets; single instance runs in us-east-1 |
| cello-waf-dev | CREATE_COMPLETE | 2026-06-06 | |
| cello-ecs-relay-dev | CREATE_COMPLETE | 2026-06-06 | |
| cello-cloudwatch-dev | CREATE_COMPLETE | 2026-06-06 | |
| cello-route53-dev | CREATE_COMPLETE | 2026-06-06 | directory-eu1.cello.mygentic.ai |
| cello-route53-relay-dev | CREATE_COMPLETE (CFN DRIFT) | 2026-06-07 | A record deleted by purge_stale_dns_record() bug. Recreated manually 2026-06-07. Drift resolves on next deploy.sh run. |
| cello-cicd-dev | NOT DEPLOYED | — | CICD pipeline is us-east-1 only |
| Lambda: cello-dev-rds-rotation | DEPLOYED (real code) | 2026-05-25 | |
| SSM: /cello/dev/directory/manifest-signer-pubkey | CREATED | 2026-05-25 | 167ca6...27b5 |
| SSM: /cello/dev/directory/peer-id (eu-central-1) | CREATED | 2026-06-06 | 12D3KooWEdsKDMBpbQioyAweoMF7s5HKvUhBY7kxHYTwoTuAbdv7 |
| Secret: cello/dev/directory/rds-replication-credentials | CREATED | 2026-05-25 | |

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
| Relay ALB | cello-relay-dev-1538955378.eu-central-1.elb.amazonaws.com |
| Route 53 Record | directory-eu1.cello.mygentic.ai |
| ECS Cluster | arn:aws:ecs:eu-central-1:257394457473:cluster/cello-dev |
| Directory Node Public Key | 8105b180b753d97b50039a7e94433fd2b419f43d61f9ad7caf2ac15ad5cd1b45 |
| Relay Node Public Key | 015ffd3a10c58019128806dc94c7c737146f448cdd0a97c6fa05be9cc04471e8 |
| SNS Topic — ops-critical | arn:aws:sns:eu-central-1:257394457473:cello-ops-critical-dev |
| SNS Topic — ops-warning | arn:aws:sns:eu-central-1:257394457473:cello-ops-warning-dev |

### dev — ap-northeast-1
*Last deployed: 2026-06-10

| Stack | Status | Last Deployed | Notes |
|---|---|---|---|
| cello-ecr-dev | UPDATE_COMPLETE | 2026-06-05 | |
| cello-iam-dev | UPDATE_COMPLETE | 2026-06-05 | |
| cello-secrets-dev | UPDATE_COMPLETE | 2026-06-05 | DirectoryTransportKey + RelayTransportKey imported |
| cello-ssm-parameters-dev | UPDATE_COMPLETE | 2026-06-06 | |
| cello-vpc-dev | UPDATE_COMPLETE | 2026-06-05 | |
| cello-kms-dev | CREATE_COMPLETE | 2026-05-23 | |
| cello-s3-dev | UPDATE_COMPLETE | 2026-06-05 | |
| cello-rds-dev | UPDATE_COMPLETE | 2026-06-05 | |
| cello-rotation-dev | UPDATE_COMPLETE | 2026-06-05 | |
| cello-ecs-directory-dev | UPDATE_COMPLETE | 2026-06-10 | M6B-019 SSM node registry; image cello-directory:934d130; task def :50 |
| cello-ecs-operations-agent-dev | NOT DEPLOYED | — | ap-northeast-1 only has PLACEHOLDER secrets; single instance runs in us-east-1 |
| cello-waf-dev | CREATE_COMPLETE | 2026-06-06 | |
| cello-ecs-relay-dev | CREATE_COMPLETE | 2026-06-06 | |
| cello-cloudwatch-dev | CREATE_COMPLETE | 2026-06-06 | |
| cello-route53-dev | CREATE_COMPLETE | 2026-06-06 | directory-ap1.cello.mygentic.ai |
| cello-route53-relay-dev | CREATE_COMPLETE (CFN DRIFT) | 2026-06-07 | A record deleted by purge_stale_dns_record() bug. Recreated manually 2026-06-07. Drift resolves on next deploy.sh run. |
| cello-cicd-dev | NOT DEPLOYED | — | CICD pipeline is us-east-1 only |
| Lambda: cello-dev-rds-rotation | DEPLOYED (real code) | 2026-05-25 | |
| SSM: /cello/dev/directory/manifest-signer-pubkey | CREATED | 2026-05-25 | 167ca6...27b5 |
| SSM: /cello/dev/directory/peer-id (ap-northeast-1) | CREATED | 2026-06-06 | 12D3KooWRXUbSRCmKBYvk3eAAyEEi7DihCTL4YVebe91ZA4ZzaxA |
| Secret: cello/dev/directory/rds-replication-credentials | CREATED | 2026-05-25 | |

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
| Relay ALB | cello-relay-dev-1984262345.ap-northeast-1.elb.amazonaws.com |
| Route 53 Record | directory-ap1.cello.mygentic.ai |
| ECS Cluster | arn:aws:ecs:ap-northeast-1:257394457473:cluster/cello-dev |
| Directory Node Public Key | 9b4b673a16487ba47363e3eaff844bf68f19736d82967918fb896b813e39b984 |
| Relay Node Public Key | 2b69812f22e11877f9bb72f855ab332bdb625997aa92bf582ce052f1c6167ca2 |
| SNS Topic — ops-critical | arn:aws:sns:ap-northeast-1:257394457473:cello-ops-critical-dev |
| SNS Topic — ops-warning | arn:aws:sns:ap-northeast-1:257394457473:cello-ops-warning-dev |

### demo-agent — us-east-1
*Provisioned: 2026-05-29*

| Resource | Value |
|---|---|
| Instance ID | i-0ad3e7c22470f266e |
| Instance Name | cello-demo-agent |
| Instance Type | t3.micro |
| AMI | ami-08e6829e013be2292 (Amazon Linux 2023, 2026-05-21) |
| VPC | vpc-09a0338d25550f292 (default VPC, 172.31.0.0/16) |
| Subnet | subnet-00b93e4a3f6ce8c07 (us-east-1a) |
| EIP Allocation ID | eipalloc-01a2b0686e3bf04cc |
| Elastic IP | 32.196.100.165 |
| Security Group ID | sg-0b8400fa0cedb95da |
| Security Group Name | cello-demo-sg |
| IAM Instance Profile | cello-agent-ssm-role |
| IAM Role | cello-agent-ssm-role |
| Secrets Manager Key Path | cello/dev/demo-agent/identity-key |
| Agent ID | c94dfa2e5df1b5b4f00a3e174f4c71e4 |
| Agent pubkey (K_local) | 12ccbfd5fa4049177e4c4a81f7462641c1ab4490bfd640ea7e6407a69d06a2f8 |
| SQLCipher DB path | /opt/cello-demo/data/client.db |
| @cello-protocol/connect version | 0.0.30 (beta) |
| Service status | active — REGISTERED 2026-06-07 — re-registered after DB wipe; demo.started confirmed in journalctl |
| Previous Agent IDs | a2c55e2721f45cfa86cb3417a76e3f7b, c684a3d274ad4ecc716d1d6fd420545c, ba493e6eca98924f02378ac1a5de81d3 (all invalidated — directory DB wiped 2026-06-06) |
| Access | SSM Session Manager only - no key pair, no inbound SG rules |
| Inbound rules | None |
| Outbound rules | TCP 443 to 0.0.0.0/0 only |

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
| Publication | `cello_pub` (11 tables — includes registrations, pre_authorization_tokens; **AC-007b complete 2026-05-28**: setup-replication.sh re-run, subscriptions refreshed, cross-region replication verified ≤5s) | `cello_pub` (11 tables — same, AC-007b complete) | `cello_pub` (11 tables — same, AC-007b complete) |
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

**2026-06-25 — INCIDENT + MANUAL REPAIR (all 6 links rebuilt, streaming).** A directory data wipe done with piecemeal single-table `TRUNCATE`s wedged all 6 subscriptions: `pubtruncate=true` replicated the truncates, and subscribers could not apply a single-table truncate of an FK-referenced parent (`cannot truncate a table referenced in a foreign key constraint`). Apply workers crash-looped (apply_error_count → thousands), `received_lsn` froze, and publisher slots retained ~2.7 GB WAL (`wal_status: extended`). **Repaired manually** (NOT via setup-replication.sh, which is idempotent-skip and never drops a sub/slot): per link, dropped the wedged subscription, dropped the orphaned slot (released WAL), created a fresh slot, and re-created the subscription `WITH (create_slot=false, copy_data=false, origin=none, enabled=true)`. All 6 subscriptions enabled + receiving, all 6 slots active, WAL backlog cleared. **Caveat:** `copy_data=false` means rows written during the outage did NOT back-fill — `agent_profiles`/`user_accounts`/`registrations`/`pre_authorization_tokens` (1 each, Ms_Chelly) exist on us-east-1 only; eu/ap have 0. New writes replicate normally. **Lesson (do not repeat):** never run piecemeal TRUNCATEs on published tables under live replication — disable subscriptions first, or `TRUNCATE … CASCADE` all FK-related tables in one statement.

**2026-06-26 — V32 agent_revocations DEPLOYED (CELLO-M7-REMOVE-001 DOD-REMOVE-2/3/4).** The directory
pipeline (triggered by the main push) deployed the new directory image to all 3 regions; Flyway applied
**V32 `agent_revocations`** on startup. Verified directly in all 3 RDS: `flyway_schema_history` has version
32 and `to_regclass('agent_revocations')` is non-null in us-east-1, eu-central-1, AND ap-northeast-1. All
directory tasks healthy (running 1/1, failedTasks 0, zero crashed/stopped tasks — no migration churn).
`agent_revocations` is an append-only, INSERT-only-RLS table (cello_service: INSERT/SELECT, no
UPDATE/DELETE) holding self-signed agent revocations. **TWO follow-ups still pending (NOT done by the
pipeline):**
1. ~~ops-agent expected-migration-version SSM stale at 30~~ **DONE 2026-06-26** — bumped to **32** via
   `aws ssm put-parameter … --value 32 --overwrite --region us-east-1` (verified Value=32). The running
   ops-agent was unaffected (healthy 1/1; gates at startup); its next restart reads 32 = DB. IaC template
   `cello-ssm-parameters.yaml` already at 32.
2. ~~agent_revocations not in cello_pub~~ **DONE 2026-06-26** — ran `./infra/setup-replication.sh dev
   us-east-1 eu-central-1 ap-northeast-1`: all 6 subscriptions already existed (skipped, none dropped),
   refreshed to pick up the new table, all 6 slots confirmed STREAMING. Verified `agent_revocations` IS in
   `cello_pub` (pg_publication_tables, us-east-1). Cross-node revocation replication is live.

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
| Current directory image | 257394457473.dkr.ecr.us-east-1.amazonaws.com/cello-directory:934d130 | M6B-019 SSM node registry; deployed 2026-06-10 via pipeline; all 3 regions; task defs us-east-1:170, eu-central-1:59, ap-northeast-1:50 |
| Current relay image | 257394457473.dkr.ecr.us-east-1.amazonaws.com/cello-relay:791f9ce | Deployed 2026-06-07 via pipeline; task defs us-east-1:55, eu-central-1:20, ap-northeast-1:15 |
| Current operations-agent image | 257394457473.dkr.ecr.us-east-1.amazonaws.com/cello-operations-agent:f4c3e72 | M6B-016 registration engine; Dockerfile stale COPY lines fixed; deployed 2026-06-07 via pipeline; task def :43; migrationVersion=30 |
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
