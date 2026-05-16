---
name: M4 Cloud Infrastructure Decisions
type: discussion
date: 2026-05-16 09:00
topics: [infrastructure, AWS, VPC, RDS, KMS, ECS, Secrets Manager, IAM, M4]
status: active
description: AWS infrastructure decisions for the M4 cloud environment — VPC topology, RDS access, IAM scoping, Secrets Manager structure, and region selection.
---

# M4 Cloud Infrastructure Decisions

The M4 `cloud` environment is the first time CELLO touches real AWS infrastructure. These decisions were made to be minimal but production-shaped — so that M5 federates on top of M4's foundation rather than starting from scratch.

---

## Region

**Decision: us-east-1.**

M5 produces a three-region topology (us-east-1, eu-west-1, me-central-1). M4's `cloud` environment is the us-east-1 node established early. Consistency with M5's primary region avoids a region migration between milestones.

---

## VPC Topology

**Decision: minimal VPC with private subnets, matching M5's shape.**

- One VPC in us-east-1
- Two private subnets (RDS and ECS tasks — multi-AZ for RDS even at M4 for operational familiarity)
- One public subnet (ALB only — required in M5; wired now even if M4 doesn't fully use it)
- Security groups: RDS accepts connections only from the ECS task security group; ECS tasks have no public IP
- No public IP on RDS instances, ever

The rationale for doing this at M4 rather than at M5: a VPC created at M4 is the same VPC M5 federates. Retrofitting private subnets onto an existing RDS instance in M5 requires a replacement, not a config change.

**IaC:** one CloudFormation template, `cello-vpc.yaml`, parameterised by environment (`cloud`, `staging`, `production`). M4 instantiates the `cloud` parameter set.

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
  Resource: arn:aws:secretsmanager:us-east-1:{account}:secret:cello/cloud/*

s3:PutObject
  Resource: arn:aws:s3:::cello-audit-logs-cloud/*
```

No `*` resources. No `kms:Encrypt` on the task role — the KMS master key encrypts K_server_X shares at node startup (unwrap), not per-operation. The `EnvelopeKeyProvider` performs encryption in-process using the unwrapped key; KMS is only called once at startup to decrypt (unwrap) the master key.

**Separate task roles per service.** The relay task role does not have KMS or Secrets Manager access — relay nodes hold no secrets at M4.

---

## Secrets Manager

### What Goes In

| Secret path | Contents | Rotation |
|---|---|---|
| `cello/cloud/directory/rds-credentials` | `{ "username": "cello_service", "password": "..." }` | AWS-managed auto-rotation, 30 days |
| `cello/cloud/directory/node-private-key` | Ed25519 private key bytes (hex) for this directory node's libp2p identity | Manual — requires coordinated node restart |
| `cello/cloud/directory/kms-key-arn` | ARN of the dev KMS master key | Not rotated — ARN is stable |

### What Does NOT Go In

- The KMS master key itself — that lives in KMS, never in Secrets Manager
- The unwrapped K_server_X master key — that is in memory only, never persisted
- Application environment variables that are not secrets (log level, port) — those go in the ECS task definition directly

### Naming Convention

**Pattern:** `cello/{env}/{component}/{name}`

- `{env}`: `cloud` | `staging` | `production`
- `{component}`: `directory` | `relay` | `pipeline`
- `{name}`: kebab-case description

**Why path-based naming matters:** IAM policies use `StringLike` on the resource ARN with `cello/cloud/*` vs `cello/production/*`. The ECS task role for the cloud environment cannot read production secrets by construction — the prefix condition in the IAM policy enforces this without needing separate accounts.

### ECS Task Definition Reference Pattern

Secrets are referenced by ARN in the task definition, never inlined:

```json
"secrets": [
  {
    "name": "DB_PASSWORD",
    "valueFrom": "arn:aws:secretsmanager:us-east-1:{account}:secret:cello/cloud/directory/rds-credentials:password::"
  },
  {
    "name": "NODE_PRIVATE_KEY",
    "valueFrom": "arn:aws:secretsmanager:us-east-1:{account}:secret:cello/cloud/directory/node-private-key::"
  }
]
```

No secrets in environment variables that are not injected via Secrets Manager. No secrets in Docker images.

---

## S3 Buckets

| Bucket | Purpose | Lifecycle |
|---|---|---|
| `cello-audit-logs-cloud` | pgaudit logs from `AuditLogShipper` | 90-day S3 Standard → Glacier archive |
| `cello-migrations-cloud` | (optional) Flyway baseline snapshots | No lifecycle — manual management |

Bucket policy: `cello_service` ECS task role has `PutObject` only. No `GetObject`, no `DeleteObject`, no `ListBucket`. The audit log is append-only by IAM policy, not just by application convention.

---

## KMS

One KMS key in us-east-1 for the `cloud` environment: `cello-dev-master-key`.

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

All templates accept `Environment` as a parameter (`cloud` | `staging` | `production`). Resource names and ARN references are derived from the parameter — no copy-pasted templates per environment.

---

## What M5 Adds

M5 does not replace any of the above. It adds:
- Two more regions (eu-west-1, me-central-1) using the same templates with different parameter sets
- Federation (logical replication between the three RDS instances)
- ALB in the public subnet (already wired at M4, just not fronting anything yet)
- WAF on the ALB

The M4 `cloud` environment becomes the us-east-1 node in the M5 three-node topology without infrastructure replacement.
