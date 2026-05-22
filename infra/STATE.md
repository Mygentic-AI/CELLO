# CELLO Infrastructure State

This file is the authoritative record of what actually exists in AWS.
It is updated automatically by `infra/deploy.sh` after every successful deployment.

**Do not edit manually unless correcting an error.** Run `./infra/deploy.sh` to deploy and update.

Any agent or human that deploys, modifies, or tears down infrastructure **must update this file** before closing the session. If you ran `deploy.sh`, it updated this automatically. If you made manual AWS changes, update the relevant section by hand and commit.

---

## Environments

### dev — us-east-1
*Last deployed: 2026-05-22

| Stack | Status | Last Deployed |
|---|---|---|
| cello-ecr-dev | UPDATE_COMPLETE | 2026-05-22 |
| cello-iam-dev | CREATE_COMPLETE | 2026-05-22 |
| cello-secrets-dev | CREATE_COMPLETE | 2026-05-22 |
| cello-vpc-dev | CREATE_COMPLETE | 2026-05-22 |
| cello-kms-dev | CREATE_COMPLETE | 2026-05-22 |
| cello-s3-dev | CREATE_COMPLETE | 2026-05-22 |
| cello-rds-dev | CREATE_COMPLETE | 2026-05-22 |
| cello-rotation-dev | CREATE_COMPLETE | 2026-05-22 |
| cello-ecs-directory-dev | UPDATE_COMPLETE | 2026-05-22 | RDS_ENDPOINT/PORT/DB_NAME added |
| cello-ecs-relay-dev | UPDATE_COMPLETE | 2026-05-22 |
| cello-route53-dev | CREATE_COMPLETE | 2026-05-22 |
| cello-cicd-dev | UPDATE_COMPLETE | 2026-05-22 |
| Lambda: cello-github-webhook-receiver-dev | DEPLOYED (real code) | 2026-05-22 |
| Lambda: cello-pipeline-filter-dev | DEPLOYED (real code) | 2026-05-22 |

#### Key Resources — dev us-east-1

| Resource | Value |
|---|---|
| VPC ID | vpc-042c7b8ac97f6a38b |
| VPC CIDR | 10.0.0.0/16 |
| Private Subnet A | subnet-05552d24bb15a7782 |
| Private Subnet B | subnet-0dba876a5a923404b |
| Public Subnet A | subnet-00780580ba49e6eb0 |
| Public Subnet B | subnet-03f5ad4cd18fca4c7 |
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

### staging — not deployed

### production — not deployed

---

## Global Resources

| Resource | Value | Notes |
|---|---|---|
| AWS Account ID | 257394457473 | |
| ECR repo — directory | 257394457473.dkr.ecr.us-east-1.amazonaws.com/cello-directory | us-east-1 only until per-region repos added |
| ECR repo — relay | 257394457473.dkr.ecr.us-east-1.amazonaws.com/cello-relay | us-east-1 only until per-region repos added |
| Current image tag | stub (pending DEPLOY-003 pipeline success) | Pipeline building real images — relay and directory pipelines triggered 2026-05-22 |
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
| Ed25519 key pairs — us-east-1 | Done | 2026-05-22 | Run `./infra/scripts/generate-node-keys.sh dev us-east-1` — eu-central-1 and ap-northeast-1 pending (staging/prod only) |
| GitHub webhook HMAC secret | Pending | — | Run step 2-4 in infra/runbooks/github-webhook-setup.md |

---

## Pending Manual Steps (post-deploy)

After `cello-ecs-directory-dev` and `cello-ecs-relay-dev` deploy:
1. Generate 3 directory Ed25519 key pairs and populate `cello/dev/directory/node-private-key` in each region's Secrets Manager
2. Generate 3 relay Ed25519 key pairs and populate `cello/dev/relay/node-private-key` in each region's Secrets Manager
3. Register GitHub webhook HMAC secret in `cello/dev/pipeline/github-hmac-secret`

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
