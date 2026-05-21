---
name: M5 Infrastructure Decisions
type: discussion
date: 2026-05-21 14:00
topics: [infrastructure, AWS, VPC, RDS, ECS, PostgreSQL, domain, relay-manifest, M5]
status: active
description: Seven infrastructure decisions required before M5 implementation begins — VPC CIDRs, node IDs, RDS sizing, ECS sizing, PostgreSQL version, domain strategy, and relay manifest schema.
---

# M5 Infrastructure Decisions

These decisions were made before any M5 story implementation began. They are prerequisites for DEPLOY-001 (IaC templates) and inform the parameterization of all M5 CloudFormation resources.

---

## Decision 1: VPC CIDR Allocation

**Decision:** Non-overlapping /16 blocks, sequential.

| Region | VPC CIDR |
|---|---|
| us-east-1 | `10.0.0.0/16` (confirm against M4 dev VPC — cannot change) |
| eu-central-1 | `10.1.0.0/16` |
| ap-northeast-1 | `10.2.0.0/16` |

**Why:** VPC peering requires non-overlapping CIDR ranges. /16 gives 65,536 addresses per region — far more than needed at Alpha but costs nothing extra and avoids CIDR expansion pain later. Sequential blocks are easy to reason about in security group rules and route tables. This is the standard AWS multi-region pattern.

**Prerequisite:** The M4 dev VPC CIDR must be confirmed before deploying the other two regions. If M4 dev was provisioned with something other than `10.0.0.0/16`, eu-central-1 and ap-northeast-1 allocate around whatever it is. The us-east-1 CIDR cannot be changed without replacing the VPC (and therefore the RDS instance).

---

## Decision 2: Node ID Scheme

**Decision:** Region-name strings — `us-east-1`, `eu-central-1`, `ap-northeast-1`.

These values appear in: `owning_node_id` column on `sessions`, `coordinator_node_id` on `directory_checkpoints`, `node_id` on `checkpoint_node_signatures`, and all observability log events (`nodeId` context field).

**Why:**

- Self-documenting in logs and database queries. `owning_node_id = 'eu-central-1'` tells you immediately where the session lives without a lookup table.
- Region names are already unique within an AWS deployment. No allocation mechanism needed.
- Coordinator election via "lowest node_id" uses lexicographic comparison: `ap-northeast-1` < `eu-central-1` < `us-east-1`. This means ap-northeast-1 is the default coordinator. The coordinator role has no special privilege beyond initiating the checkpoint round — it doesn't matter which region goes first.
- The architecture is one-node-per-region by design. If that ever changes, the node ID scheme would need to change regardless of what we pick today.

**Alternative considered:** `node-1`, `node-2`, `node-3` with a mapping table. Cleaner for coordinator election ordering and shorter in log output, but requires an additional lookup to understand which node is which in every log query and database inspection. Self-documentation wins for a 3-node system.

---

## Decision 3: RDS Instance Class

**Decision:**

| Tier | Instance Class | vCPU | RAM | Monthly (per instance) |
|---|---|---|---|---|
| dev | `db.t3.small` | 2 | 2 GB | ~$17 |
| staging | `db.t3.small` | 2 | 2 GB | ~$17 |
| production | `db.t3.medium` | 2 | 4 GB | ~$35 |

**Why:**

- Alpha has near-zero traffic. The 3-node topology is being validated, not load-tested.
- `db.t3.small` is the practical minimum for a node running logical replication — WAL sender/receiver processes and shared_buffers need ~1.5 GB, leaving headroom at 2 GB. Below this (t3.micro at 1 GB) is too tight once replication is active across 3 nodes.
- Production gets `db.t3.medium` (4 GB) for additional headroom during FROST ceremonies and checkpoint cross-signing where multiple concurrent transactions may be active.
- RDS instance class changes are a 0-downtime modification (Multi-AZ failover applies the change on the standby, then fails over). Upgrading later takes 5 minutes with no schema or code changes.
- The CloudFormation template parameterizes this — upgrading is a parameter change, not a redesign.

**When to upgrade:** When checkpoint cross-signing latency exceeds the 30-second round timeout, or when CloudWatch shows RDS CPU > 60% sustained, or when FreeableMemory drops below 256 MB.

---

## Decision 4: ECS Task Sizes (Directory and Relay)

**Decision:**

| Service | Tier | CPU | Memory |
|---|---|---|---|
| Directory | production | 0.5 vCPU | 1 GB |
| Directory | dev/staging | 0.25 vCPU | 0.5 GB |
| Relay | production | 0.25 vCPU | 0.5 GB |
| Relay | dev/staging | 0.25 vCPU | 0.5 GB |

**Why:**

- Directory does more work: pg Pool management, FROST DKG coordination, checkpoint cross-signing, connection request fan-out resolution — give it 2x the relay's resources.
- Relay is a lightweight session proxy: receives hash submissions, signs ACKs with Ed25519, maintains per-session WAL files in memory. Minimal compute.
- Fargate pricing is linear (CPU * hours + Memory * hours). Starting small and watching CloudWatch Container Insights CPU/memory utilization before scaling is the correct approach.
- If directory memory usage climbs above 80% (visible in Container Insights), bump to 1 vCPU / 2 GB. This is a task definition update with rolling deployment — no downtime.

---

## Decision 5: PostgreSQL Version on RDS

**Decision:** PostgreSQL 18.3 (latest available on RDS in all three target regions). Docker Compose pins to `postgres:18` (major version tag, pulls latest 18.x patch).

**Why:**

- PostgreSQL 18.3 is the latest RDS version available in us-east-1, eu-central-1, and ap-northeast-1.
- All features needed are present: logical replication (introduced in PG 10), pgaudit, RLS, JSONB, BIGSERIAL, TIMESTAMPTZ.
- The Docker Compose base image uses `postgres:18` (major-version tag) rather than pinning to `18.3` — this way local dev automatically picks up security patches. The Dockerfile installs `postgresql-18-pgaudit` which tracks the major version.
- RDS minor version upgrades (18.3 → 18.4 when available) happen automatically during the configured maintenance window with no action required.

---

## Decision 6: Domain / TLS Strategy

**Decision:** Custom domain from day one. Register a domain and use subdomains per service and region.

**Proposed structure:**
```
directory-us1.{domain}    → us-east-1 ALB
directory-eu1.{domain}    → eu-central-1 ALB
directory-ap1.{domain}    → ap-northeast-1 ALB
```

The actual domain name (e.g. `cello.network`, `cello-protocol.io`) is a separate choice made at registration time and does not affect the IaC architecture.

**Why:**

- Agent SDKs will hardcode the endpoint. Raw ALB DNS names (`cello-directory-prod-1234567890.us-east-1.elb.amazonaws.com`) are 60+ characters, change if you replace the ALB, and encode implementation details (region, service name, account hash).
- A custom domain is stable across infrastructure replacements — Route 53 ALIAS records point to ALBs, and changing the target is invisible to clients.
- ACM certs for custom domains are free with DNS validation and auto-renew. Same cost as raw ALB certs.
- This is the kind of thing that's painful to retrofit after agents are deployed — every client's configuration would need updating.
- Domain registration is ~$12/year. Route 53 hosted zone is $0.50/month.

**What this adds to DEPLOY-001 scope:**
- One Route 53 hosted zone in the IaC
- Three ALIAS records (one per regional ALB)
- ACM certificates per region, validated against the Route 53 zone (DNS validation, auto-renew)
- Domain registration (manual one-time step, not in IaC)

---

## Decision 7: Relay Manifest Schema

**Decision:** Signed JSON document with the following structure:

```json
{
  "version": 1,
  "signedBy": "ap-northeast-1",
  "signature": "<Ed25519 signature hex over canonical JSON of body>",
  "updatedAt": "2026-05-21T00:00:00Z",
  "relays": [
    {
      "relayId": "<Ed25519 public key hex>",
      "endpoint": "wss://relay-us1.{domain}/relay",
      "region": "us-east-1",
      "status": "active"
    }
  ]
}
```

**Design points:**
- `signedBy` is the node_id (region name) of the signing directory node — always the lowest node_id (ap-northeast-1 per Decision 2).
- `signature` covers canonical JSON serialization of `{ version, updatedAt, relays }` (sorted keys, no whitespace — same canonical JSON rules as checkpoint cross-signing `buildCheckpointTbs`). The `signedBy` and `signature` fields themselves are excluded from the signed payload.
- `status` field allows marking a relay as `"draining"` before removal without deleting it from the manifest. Gives clients time to notice the relay is going away.
- `version` is a monotonically increasing integer. A directory node rejects a manifest with a lower version than its current one (prevents rollback/replay attacks).
- Clients verify the manifest signature against the signing node's registered public key (fetched via the relay registration endpoint). The signing node's Ed25519 key is the same key that signs SessionAssignments — no new trust anchor is introduced.

**Why:**

- A static signed manifest (rather than a dynamic endpoint) means the directory can operate with a stale relay list even if S3 is temporarily unreachable — it just serves what it has until a reload succeeds.
- Monotonic versioning prevents an adversary with S3 write access from rolling back to an old manifest that includes a compromised relay.
- The signing node is already the checkpoint coordinator (lowest node_id), so one key pair has signing authority over both checkpoints and the manifest — no additional key management burden.

**Practical downsides:**

- **Operational overhead for relay changes.** Adding a relay requires: generate key pair → add to manifest → sign manifest → upload to S3 → directory reloads → relay starts and self-registers. It is not self-service — an operator must update the manifest. At Alpha with 3 relays this is acceptable. At Consortium scale (dozens of third-party relay operators) this model breaks and requires a dynamic authorization mechanism. This is explicitly out of scope.
- **Monotonic version means fix-forward only.** If you accidentally remove a relay from the manifest, you cannot roll back to the previous version — you must increment and publish a corrected version. By design (prevents replay), but means no "undo" button.
- **Signing key rotation coupling.** If the lowest-node_id directory node's Ed25519 key rotates (SECOPS-004), previously-cached manifest copies become unverifiable. Clients need to re-fetch the signing node's public key. This means key rotation and manifest re-signing are coupled operations — when you rotate the coordinator's key, you must also re-sign and publish a new manifest version.

---

## Bootstrap Operations

These are not decisions — they are execution steps that happen in the AWS account after DEPLOY-001 IaC templates are written but before they can be validated:

1. **Confirm M4 dev VPC CIDR** — before allocating the other two regions' CIDRs
2. **Service limits raised** in eu-central-1 and ap-northeast-1 (RDS, ECS, ALB, KMS)
3. **Ed25519 key pairs generated** — 3 directory nodes + 3 relay nodes = 6 key pairs, populated into Secrets Manager after IaC creates the empty placeholder secrets
4. **GitHub webhook registered** with HMAC secret in `cello/dev/pipeline/github-hmac-secret`
5. **ECR repositories created** in us-east-1 — `cello-directory` and `cello-relay`
6. **Domain registered** — one-time manual step; Route 53 hosted zone creation is in IaC

---

## Related Documents

- [[2026-05-16_0900_m4-infrastructure-decisions|M4 Infrastructure Decisions]] — VPC, RDS, IAM, Secrets Manager, KMS, S3 decisions that M5 builds on
- [[2026-05-16_0753_development-pipeline-and-local-iteration|Development Pipeline and Local Iteration Strategy]] — CI/CD pipeline design, adapter pattern, environment tiers
- [[M5 — Production Infrastructure|M5 Outline]] — full milestone scope and architecture
