# CELLO Infrastructure State

This file is the authoritative record of what actually exists in AWS.
It is updated automatically by `infra/deploy.sh` after every successful deployment.

**Do not edit manually unless correcting an error.** Run `./infra/deploy.sh` to deploy and update.

Any agent or human that deploys, modifies, or tears down infrastructure **must update this file** before closing the session. If you ran `deploy.sh`, it updated this automatically. If you made manual AWS changes, update the relevant section by hand and commit.

---

## Environments

### dev — us-east-1
*Last deployed: 2026-05-22*

| Stack | Status | Last Deployed |
|---|---|---|
| cello-iam-dev | CREATE_COMPLETE | 2026-05-22 |
| cello-secrets-dev | CREATE_COMPLETE | 2026-05-22 |
| cello-vpc-dev | CREATE_COMPLETE | 2026-05-22 |
| cello-kms-dev | CREATE_COMPLETE | 2026-05-22 |
| cello-s3-dev | CREATE_COMPLETE | 2026-05-22 |
| cello-rds-dev | IN PROGRESS | 2026-05-22 |
| cello-ecs-directory-dev | NOT DEPLOYED | — |
| cello-ecs-relay-dev | NOT DEPLOYED | — |
| cello-route53-dev | NOT DEPLOYED | — |
| cello-cicd-dev | NOT DEPLOYED | — |

#### Key Resources — dev us-east-1

| Resource | Value |
|---|---|
| VPC ID | vpc-0ac8a7ab49079c524 |
| VPC CIDR | 10.0.0.0/16 |
| Private Subnet A | subnet-0c16031f3e75888bf |
| Private Subnet B | subnet-04bd06a7192397267 |
| KMS Key ARN | arn:aws:kms:us-east-1:257394457473:key/d8b50480-656e-46b4-908f-15ea76bbb636 |
| KMS Key ID | d8b50480-656e-46b4-908f-15ea76bbb636 |
| Audit Log Bucket | cello-audit-logs-dev-us-east-1 |
| Relay Manifest Bucket | cello-relay-manifest-dev-us-east-1 |
| RDS Endpoint | pending |
| Directory ALB | pending |
| Relay ALB | pending |
| Route 53 Record | pending |

### staging — not deployed

### production — not deployed

---

## Global Resources

| Resource | Value | Notes |
|---|---|---|
| AWS Account ID | 257394457473 | |
| ECR repo — directory | 257394457473.dkr.ecr.us-east-1.amazonaws.com/cello-directory | us-east-1 only until per-region repos added |
| ECR repo — relay | 257394457473.dkr.ecr.us-east-1.amazonaws.com/cello-relay | us-east-1 only until per-region repos added |
| Current image tag | stub | Replace with real image tag when DEPLOY-002/003 complete |
| Route 53 Hosted Zone | cello.mygentic.ai | Zone ID read at deploy time via aws route53 list-hosted-zones |
| CodeStar Connection (us-east-1) | arn:aws:codeconnections:us-east-1:257394457473:connection/1a7fba2b-dd1d-4ebe-8372-7122b89f56b5 | AVAILABLE — override via CELLO_GITHUB_CONNECTION_ID |

---

## Bootstrap Operations

| Item | Status | Date | Notes |
|---|---|---|---|
| Route 53 hosted zone `cello.mygentic.ai` | Done | 2026-05-21 | NS delegated from GoDaddy |
| ECR repo `cello-directory` | Done | 2026-05-21 | us-east-1 |
| ECR repo `cello-relay` | Done | 2026-05-21 | us-east-1 |
| Stub images pushed | Done | 2026-05-22 | 1.8MB Go/scratch, tagged `stub` |
| CodeStar Connection `github-cello-main` | Done | 2026-05-22 | us-east-1, AVAILABLE |
| Ed25519 key pairs (3 directory + 3 relay) | Pending | — | Populate Secrets Manager after RDS + ECS deploy |
| GitHub webhook HMAC secret | Pending | — | After cello-cicd-dev deploys |

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
