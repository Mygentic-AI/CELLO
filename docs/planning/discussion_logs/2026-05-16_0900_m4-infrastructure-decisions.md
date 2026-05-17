---
name: M4 Infrastructure Decisions
type: discussion
date: 2026-05-16 09:00
topics: [infrastructure, AWS, VPC, RDS, KMS, ECS, Secrets Manager, IAM, M4]
status: active
description: AWS infrastructure decisions for the M4 dev environment — VPC topology, RDS access, IAM scoping, Secrets Manager structure, and region selection.
---

# M4 Infrastructure Decisions

The M4 `dev` environment is the first time CELLO touches real AWS infrastructure. These decisions were made to be minimal but production-shaped — so that M5 federates on top of M4's foundation rather than starting from scratch.

---

## Region

**Decision: us-east-1.**

M5 produces a three-region topology (us-east-1, eu-central-1, ap-northeast-1 — Tier 1 regions covering Americas, Europe, and Asia-Pacific). M4's `dev` environment is the us-east-1 node established early. Consistency with M5's primary region avoids a region migration between milestones.

---

## VPC Topology

**Decision: minimal VPC with private subnets, matching M5's shape.**

- One VPC in us-east-1
- Two private subnets (RDS and ECS tasks — multi-AZ for RDS even at M4 for operational familiarity)
- One public subnet (ALB only — required in M5; wired now even if M4 doesn't fully use it)
- Security groups: RDS accepts connections only from the ECS task security group; ECS tasks have no public IP
- No public IP on RDS instances, ever

The rationale for doing this at M4 rather than at M5: a VPC created at M4 is the same VPC M5 federates. Retrofitting private subnets onto an existing RDS instance in M5 requires a replacement, not a config change.

**IaC:** one CloudFormation template, `cello-vpc.yaml`, parameterised by environment (`dev`, `staging`, `production`). M4 instantiates the `dev` parameter set.

---

## RDS Access

**Decision: security group scoping, no public accessibility.**

- RDS parameter: `publicly_accessible = false`
- Security group on RDS: ingress on port 5432 from ECS task security group only
- No bastion host at M4 — direct access via AWS Systems Manager Session Manager tunneling for developer debugging

---

## IAM Task Role Scoping

**Decision: least-privilege task role, no wildcards.**

The ECS task role for the directory service gets exactly:

```
kms:Decrypt, kms:DescribeKey
  Resource: arn:aws:kms:us-east-1:{account}:key/{dev-key-id}

secretsmanager:GetSecretValue
  Resource: arn:aws:secretsmanager:us-east-1:{account}:secret:cello/dev/*

s3:PutObject
  Resource: arn:aws:s3:::cello-audit-logs-dev/*
```

No `*` resources. No `kms:Encrypt` on the task role — the KMS master key encrypts K_server_X shares at node startup (unwrap), not per-operation. The `EnvelopeKeyProvider` performs encryption in-process using the unwrapped key; KMS is only called once at startup to decrypt (unwrap) the master key.

**Separate task roles per service.** The relay task role does not have KMS access at M4. At M5 the relay task role gains `secretsmanager:GetSecretValue` on `cello/{env}/relay/node-private-key` — the relay's Ed25519 signing key for relay ACKs (INFRA-005/INFRA-006).

---

## Secrets Manager

### What Goes In

| Secret path | Contents | Rotation |
|---|---|---|
| `cello/dev/directory/rds-credentials` | `{ "username": "cello_service", "password": "..." }` | AWS-managed auto-rotation, 30 days |
| `cello/dev/directory/node-private-key` | Ed25519 private key bytes (hex) for this directory node's libp2p identity | Manual — requires coordinated node restart |
| `cello/dev/directory/kms-key-arn` | ARN of the dev KMS master key | Not rotated — ARN is stable |

### What Does NOT Go In

- The KMS master key itself — that lives in KMS, never in Secrets Manager
- The unwrapped K_server_X master key — that is in memory only, never persisted
- Application environment variables that are not secrets (log level, port) — those go in the ECS task definition directly

### Naming Convention

**Pattern:** `cello/{env}/{component}/{name}`

- `{env}`: `dev` | `staging` | `production`
- `{component}`: `directory` | `relay` | `pipeline`
- `{name}`: kebab-case description

**Why path-based naming matters:** IAM policies use `StringLike` on the resource ARN with `cello/dev/*` vs `cello/production/*`. The ECS task role for the dev environment cannot read production secrets by construction — the prefix condition in the IAM policy enforces this without needing separate accounts.

### ECS Task Definition Reference Pattern

Secrets are referenced by ARN in the task definition, never inlined:

```json
"secrets": [
  {
    "name": "DB_PASSWORD",
    "valueFrom": "arn:aws:secretsmanager:us-east-1:{account}:secret:cello/dev/directory/rds-credentials:password::"
  },
  {
    "name": "NODE_PRIVATE_KEY",
    "valueFrom": "arn:aws:secretsmanager:us-east-1:{account}:secret:cello/dev/directory/node-private-key::"
  }
]
```

No secrets in environment variables that are not injected via Secrets Manager. No secrets in Docker images.

---

## S3 Buckets

| Bucket | Purpose | Lifecycle |
|---|---|---|
| `cello-audit-logs-dev` | pgaudit logs from `AuditLogShipper` | 90-day S3 Standard → Glacier archive |
| `cello-migrations-dev` | (optional) Flyway baseline snapshots | No lifecycle — manual management |

Bucket policy: `cello_service` ECS task role has `PutObject` only. No `GetObject`, no `DeleteObject`, no `ListBucket`. The audit log is append-only by IAM policy, not just by application convention.

---

## KMS

One KMS key in us-east-1 for the `dev` environment: `cello-dev-master-key`.

- Key policy: allows the directory ECS task role to `kms:Decrypt` and `kms:DescribeKey` only
- Developer IAM users get `kms:Encrypt` for initial key setup only, not as an ongoing permission
- Production KMS key (`cello-production-master-key`) has a separate key policy that never includes dev credentials — environment isolation is enforced at the KMS key policy level, not by convention

---

## IaC Templates

| Template | Scope |
|---|---|
| `cello-vpc.yaml` | VPC, subnets, security groups |
| `cello-rds.yaml` | RDS instance, parameter group (pgaudit), subnet group |
| `cello-ecs-directory.yaml` | ECS cluster, task definition, service, task role |
| `cello-secrets.yaml` | Secrets Manager secrets (values populated separately, not in IaC) |
| `cello-kms.yaml` | KMS key and key policy |
| `cello-s3.yaml` | S3 buckets and bucket policies |

All templates accept `Environment` as a parameter (`dev` | `staging` | `production`). Resource names and ARN references are derived from the parameter — no copy-pasted templates per environment.

---

## What M5 Adds

M5 does not replace any of the above. It adds:
- Two more regions (eu-central-1, ap-northeast-1) using the same IaC templates with different parameter sets
- VPC Peering — 3 connections (us-east-1↔eu-central-1, eu-central-1↔ap-northeast-1, us-east-1↔ap-northeast-1); carries both RDS logical replication and checkpoint cross-signing traffic; no NAT Gateway required
- Federation (logical replication between the three RDS instances over VPC Peering)
- ALB in the public subnet (already wired at M4, just not fronting anything yet)
- WAF on the ALB
- VPC Interface Endpoints for ECR, Secrets Manager, KMS, CloudWatch Logs (private subnet → AWS services without NAT Gateway); S3 Gateway Endpoint for audit logs and relay manifest bucket
- Relay signing key in Secrets Manager (`cello/{env}/relay/node-private-key`) and updated relay task role
- `cello-relay-manifest` S3 bucket per environment for the signed relay pool manifest
- Flyway migrations run at ECS task startup (not in CodeBuild); migration failure = health check failure = ECS keeps previous task running

The M4 `dev` environment becomes the us-east-1 node in the M5 three-node topology without infrastructure replacement.
