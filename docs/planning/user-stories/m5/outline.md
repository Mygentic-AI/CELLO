---
name: M5 — Production Infrastructure
milestone: M5
type: outline
date: 2026-05-15
status: active
topics: [production, infrastructure, AWS, ECS, RDS, PostgreSQL, federation, replication, CI-CD, CodePipeline, CodeBuild, staging, relay, health-check, checkpoint, operational-security, CloudWatch, WAF]
description: M5 delivers the Alpha production deployment — 3-node RDS federation with logical replication and checkpoint cross-signing, ECS-hosted directory and relay services, CI/CD pipeline gating on staging, and operational security infrastructure. Relay pool managed via static signed manifest.
---

# M5 — Production Infrastructure

## What This Milestone Delivers

M5 takes the single-node persistence foundation from M4 and makes it a real network. Three directory nodes running in production on AWS, federated via PostgreSQL logical replication with checkpoint cross-signing. A CI/CD pipeline that gates every production deployment on a passing staging smoke test. Operational security infrastructure that makes the deployment observable and defensible.

At the end of M5:
- Three directory nodes running on AWS, fully replicated, with federation-signed checkpoints
- Relay nodes running on AWS, managed via static signed manifest with health checks
- Every production deployment gates on a passing staging smoke test
- CloudWatch, WAF, and operational security in place from the first production commit
- The network is real — agents can register and have conversations on persistent infrastructure

## Scope Boundaries

**In scope:**
- RDS PostgreSQL federation — 3-node, logical replication, checkpoint cross-signing
- ECS deployment — directory nodes, relay nodes
- CI/CD pipeline — CodePipeline + CodeBuild, direct ECS deployment
- Staging environment — 3-node, functionally equivalent to production
- Relay pool management — static signed manifest, health checks
- Operational security — CloudWatch, WAF, DDoS mitigation, secrets rotation, certificate management, pgaudit shipping to S3

**Explicitly out of scope:**
- 6-node full Alpha topology → grows organically after M5 proves the 3-node foundation
- Cross-cloud federation (AWS + GCP + Azure) → Consortium concern
- Relay operator onboarding (third-party operators) → Consortium concern
- Operations Agent (bot) → M6
- Portal → M7

---

## AWS Architecture

### Directory Nodes — RDS PostgreSQL Federation

Three RDS PostgreSQL instances, one per region (us-east-1, eu-central-1, ap-northeast-1 — Tier 1 regions providing Americas, Europe, and Asia-Pacific coverage).

**Replication:** PostgreSQL logical replication. Each node is both a publisher and a subscriber to the other two. All append-only core tables replicate to all nodes. The hash chain computed at INSERT on the originating node replicates as-is — receiving nodes verify the chain on sync rather than recomputing it.

**Session ownership:** Each session is assigned to exactly one owning node at session establishment. The `sessions` table carries an `owning_node_id` column populated at session creation. The owning node is the sole writer for that session's hash chain entries — `SELECT FOR UPDATE` on the previous chain row serializes writes on that node only. Session ownership is non-transferable: if the owning node fails mid-session, the session fails and the client must re-establish it. No other node attempts to take over writes for the failed session, eliminating any risk of concurrent hash chain writes from different nodes.

**Instance sizing:** At Alpha with low traffic, `db.t3.medium` or `db.t3.large` is sufficient. Instance class is a deployment parameter, not a protocol constraint.

**KMS:** One AWS KMS master key per node, in the node's region. K_server_X shares are encrypted at rest with the regional KMS key. KMS is invoked at node startup to unwrap the master key into memory — not per-agent-share.

**pgaudit:** Enabled via RDS parameter group. Audit logs shipped to S3 in the same region. A compromised node cannot erase its own access history.

**Connection:** Directory nodes expose their libp2p signaling protocol (`/cello/signaling/1.0.0`) on port 443 via WebSocket transport. TLS termination at the load balancer (ALB). Agents connect to the ALB endpoint; the ALB routes to the ECS service running the directory node process.

**Inter-node networking — VPC Peering:** All traffic between directory nodes (RDS logical replication AND checkpoint cross-signing) travels over VPC Peering, never the public internet. Three peering connections are established: us-east-1↔eu-central-1, eu-central-1↔ap-northeast-1, us-east-1↔ap-northeast-1. RDS instances accept replication connections only from peer VPC CIDR ranges. Directory ECS tasks communicate with peer nodes over the peering connections for checkpoint rounds. Public ALBs carry only agent→directory traffic. **Evaluate Transit Gateway at 6+ nodes** — VPC Peering scales to 3 connections at 3 nodes but grows quadratically; Transit Gateway is the right upgrade path when the node count grows.

### Directory Node ECS Services

Each directory node runs as an ECS Fargate service in its region. The directory service process connects to its regional RDS instance and participates in the libp2p node pool.

**Task definition:** directory service Docker image, environment variables for RDS connection string (from Secrets Manager), KMS key ARN, node private key (from Secrets Manager), node manifest (signed relay and directory node list).

**Auto-scaling:** not required at Alpha — fixed task count per service (1 task per region at launch, expandable).

### Relay Nodes — Static Signed Manifest

Relay nodes run as ECS Fargate services. At Alpha, CELLO operates all relay nodes.

**Relay pool manifest:** a signed JSON document listing relay node public keys and WebSocket endpoints, versioned. The manifest is signed by the directory node with the lowest `node_id` in the current manifest, using that node's existing Ed25519 node signing key (`cello/{env}/directory/node-private-key`). Clients verify against the signing node's registered public key — the same key that signs SessionAssignments, so no new trust anchor is introduced. The directory reads the manifest at startup. The manifest is stored in S3 and referenced by the directory task definition — updating the manifest triggers a directory service reload.

**Health checks:** the directory pings each relay on a 30-second interval. A relay that fails 3 consecutive pings is marked unavailable and excluded from session assignment until it recovers.

**Session assignment:** the directory assigns sessions to the lowest-latency available relay based on the client's reported RTT table. If no relay is available, the directory returns `RELAY_UNAVAILABLE` and the client retries.

**Relay ECS service:** Baileys-style persistent process — not Lambda. Relay nodes maintain long-lived libp2p connections and per-session WAL files; a Lambda cold-start model is incompatible with this. ECS Fargate with a persistent task is the correct deployment model.

### Checkpoint Cross-Signing

**Trigger:** time-based, every 10 minutes.

**Threshold:** 2-of-3 directory nodes must sign a checkpoint for it to be confirmed. Tolerates one node being temporarily unavailable without stalling checkpoints.

**Coordinator:** the node with the lowest `node_id` in the current manifest acts as coordinator. Deterministic — no election needed.

**Coordinator failover:** non-coordinator nodes detect coordinator absence by watching for a new row in `directory_checkpoints` (replicated via logical replication). If no new checkpoint row appears within `checkpoint_interval + 60s`, the node with the next-lowest available `node_id` initiates the round as coordinator. No gossip protocol, no heartbeat — detection is a read on an already-replicated table. If no node successfully completes a round, the round is skipped and retried at the next interval.

**Mechanics:**
1. Coordinator computes the checkpoint hash: `SHA-256(mmr_peaks_serialized || identity_merkle_root || checkpoint_id)`
2. Coordinator broadcasts the checkpoint to the other two nodes
3. Each node independently verifies the hash against its local state and returns a signature
4. Coordinator publishes the confirmed checkpoint once 2 signatures are collected
5. `checkpoint_node_signatures` records each signing node's signature

**Round timeout:** 30 seconds per round. A node that does not respond within 30 seconds is skipped for this checkpoint.

**Failure handling:** if fewer than 2 nodes respond, the checkpoint attempt fails silently and retries at the next 10-minute interval. A CloudWatch alarm fires if no checkpoint has been confirmed in 30 minutes — indicating a persistent federation problem requiring operator attention.

**At Consortium:** threshold rises to 11-of-20, interval tightens to 5 minutes.

---

## CI/CD Pipeline

### Stack

AWS CodePipeline V2 + CodeBuild. GitHub as source via webhook. Path-based selective deployment via Lambda router. Direct ECS deployment (no CodeDeploy). All infrastructure defined in IaC — nothing created via console that does not also exist in IaC. See [[2026-05-16_0753_development-pipeline-and-local-iteration|Development Pipeline and Local Iteration Strategy]] for full pipeline design and rationale.

### Path-Based Trigger Architecture

Native CodePipeline V2 path filtering via CodeConnections was evaluated and rejected — glob behavior is coarse and tooling lagged the API at time of design. The Lambda router pattern is used instead.

```
GitHub push to main
  → github-webhook-receiver Lambda (us-east-1)
      verifies HMAC signature → puts payload on EventBridge github-events bus
  → cello-pipeline-filter Lambda (us-east-1)
      inspects commit.modified/added/removed paths
      triggers matching CodePipeline(s) via start_pipeline_execution
  → per-package CodePipeline (us-east-1)
```

Folder-to-pipeline mappings are data-driven — a JSON config file in the repo, read by `cello-pipeline-filter` at invocation time. Adding a new package updates the config, not the Lambda.

**Shared dependency rule:** a change to `packages/crypto/` or `packages/protocol-types/` triggers all downstream pipelines. Modelled as an `"all"` sentinel in the mappings config.

**IaC discipline:** one CloudFormation template per service, environment passed as a parameter (`dev`, `staging`, `production`). The console is a scratchpad only — any emergency fix applied via console is backported to IaC before closing the session.

### Pipeline Stages (per package)

**Build:** CodeBuild runs:
1. `pnpm install`
2. `pnpm run lint`
3. `pnpm run typecheck`
4. Unit tests: `pnpm run test -- --pool-options.threads.maxThreads=1 --pool-options.threads.minThreads=1`
5. Integration tests (packages with Postgres-backed paths only): `docker compose up -d` then `CELLO_ENV=local DATABASE_URL=postgresql://postgres:dev@localhost:5432/cello_dev DEV_ENVELOPE_KEY={key} AUDIT_LOG_PATH=/tmp/cello-audit.jsonl pnpm run test -- --pool-options.threads.maxThreads=1 --pool-options.threads.minThreads=1`. A build where any `describeIntegration` block is reported as skipped is treated as a build failure — skipped integration tests mean `CELLO_ENV=local` was not set and the real test gate was not exercised.
6. Docker image build and push to ECR

**Database migrations — run at ECS task startup, not in CodeBuild.** The directory ECS task runs `flyway migrate` as its entrypoint before starting the directory service process. If migrations fail, the task fails its health check and ECS keeps the previous task running — clean rollback with no manual intervention. This eliminates the need for VPC-attached CodeBuild (which would require a NAT Gateway for outbound internet access). CodeBuild runs outside the VPC with standard internet access.

**Staging deploy:** pipeline deploys the new image to the staging ECS services. Staging is a 3-node setup functionally equivalent to production at reduced instance sizes. In Phase 1 (through ~M8), the `dev` environment serves as staging — see [[2026-05-16_0753_development-pipeline-and-local-iteration|Development Pipeline and Local Iteration Strategy]] for environment tier decisions.

**Staging smoke test:** CodeBuild runs the live multi-process smoke test suite against the staging environment:
- Two agent sessions established end-to-end
- FROST ceremony completes
- Message exchange with Merkle verification
- Session seal with directory recompute
- Relay failure and reassignment
- Pre-seal reconciliation (simulated one-sided delivery failure)

**Production deploy gate:** staging smoke test must pass. A single failing smoke test blocks the production deployment. No manual approval required at Alpha — the smoke test is the gate.

**Production deploy:** pipeline deploys the same image (already built and tested) to production ECS services across all three regions. Regional deployments are sequential — us-east-1 first, then eu-central-1, then ap-northeast-1 — so a bad deployment is caught after one region rather than all three simultaneously.

### Rollback

Fix forward for a single developer. ECS maintains the previous task definition — manual rollback to the previous revision is available if a CloudWatch alarm fires within 10 minutes of deployment. Automated rollback is a Consortium-phase concern.

### Reactive Fix Rule

M5 is the first milestone with live AWS infrastructure. Live smoke tests will surface bugs that need immediate fixes. Any production code change made outside a story — a hotfix during smoke testing, a live-session fix, a quick patch — **must have a corresponding test before the commit lands on main**. No exceptions.

The test must:
- Be a real integration test if the fix touches a Postgres-backed path (use `describeIntegration` with `CELLO_ENV=local`)
- Actually exercise the failure condition that triggered the fix, not just assert the fixed code exists
- Be named after what it tests, not after the commit that introduced it

A fix with no test is a regression waiting to happen when the next story touches the same path. The four M4 session-survival fixes (CONNREQ-002, REG-001, PERSIST-020 wiring, encodeConnectionRequestError) are the canonical example of what this rule prevents. The cello-sprint-reviewer's Step 6 treats an untested reactive fix as a blocking finding.

---

## Operational Security

### AuditLogShipper Adapter

pgaudit log shipping to S3 is implemented behind an `AuditLogShipper` interface:

```typescript
interface AuditLogShipper {
  ship(logEntry: AuditLogEntry): Promise<void>
  flush(): Promise<void>
}
```

Production implementation ships to S3 in the same region as the RDS instance. Local stub writes to a local file sink. This follows the adapter pattern established for all external dependencies in [[2026-05-16_0753_development-pipeline-and-local-iteration|Development Pipeline and Local Iteration Strategy]].

### CloudWatch

- **Alarms:** error rate per service, P99 latency per endpoint, RDS CPU and storage, ECS task health, checkpoint confirmation gap (> 30 minutes without a confirmed checkpoint)
- **Dashboards:** per-region service health, FROST ceremony success/failure rate, session establishment rate, relay assignment success rate
- **Log groups:** directory service logs, relay service logs, RDS pgaudit logs — all shipped to CloudWatch Logs with 90-day retention, then archived to S3

### WAF

AWS WAF on the ALB in front of each directory node. Rules:
- Rate limiting per IP — prevents connection flood at the infrastructure layer (complements the application-layer rate limiting in the directory service)
- Known bad IP reputation lists (AWS Managed Rules)
- Geo-blocking configurable per deployment

### Secrets Management

All secrets (RDS credentials, node private keys, KMS key ARNs, relay manifest signing key) stored in AWS Secrets Manager. ECS task definitions reference secrets by ARN — no secrets in environment variables or Docker images. Automatic rotation enabled for RDS credentials.

### Certificate Management

ACM (AWS Certificate Manager) manages TLS certificates for ALB endpoints. Auto-renewal. No manual certificate rotation.

### DDoS Mitigation

AWS Shield Standard is enabled by default on ALBs. Shield Advanced is a Consortium-phase upgrade when the network carries commercial traffic.

### Network

- VPC per region with private subnets for RDS and ECS tasks
- ALB in public subnet, all other resources private
- Security groups: RDS accepts connections only from ECS task security group and peer VPC CIDR ranges (for replication); ECS tasks accept inbound only from ALB
- No public IP addresses on ECS tasks or RDS instances
- No NAT Gateway required — VPC Interface Endpoints cover all AWS service access from private subnets (ECR, Secrets Manager, KMS, CloudWatch Logs); S3 Gateway Endpoint (free) covers audit log and manifest bucket access; no outbound internet required from private subnets
- VPC Peering connections (3 total, one per node pair) carry all inter-node traffic; see "Inter-node networking" above

---

## Staging Environment

Three-node setup, same topology as production, smaller instance sizes (`db.t3.small`, Fargate 0.25 vCPU / 0.5 GB). Shares no infrastructure with production — separate VPCs, separate RDS instances, separate ECR images tagged `staging-*`.

The staging environment is the CI/CD gate. It must be always-on and always healthy — a broken staging environment blocks all production deployments. CloudWatch alarms on staging fire to the same on-call channel as production.

---

## Milestone Close Gate

Standard SPARC gate sequence plus live smoke tests:

1. All three directory nodes running, replicating, and cross-signing checkpoints every 10 minutes
2. All relay nodes running and appearing in directory health checks as available
3. CI/CD pipeline: push to `main` → build → staging deploy → staging smoke test passes → production deploy completes across all three regions
4. Relay pool manifest update flow: update manifest → directory reloads → new relay appears in assignment pool
5. Fault tolerance: kill one directory node → checkpoint cross-signing continues with 2-of-3 → node restarts → catches up via logical replication
6. Fault tolerance: kill one relay node → directory marks it unavailable → session assignments route to remaining relays → recovered relay returns to pool

---

## Dependencies

- M4 complete — PostgreSQL schema, RLS enforcement, hash chain, KMS, SQLCipher all correct on a single node before federating
- AWS account with sufficient credits and appropriate service limits raised (RDS, ECS, ECR, ALB, WAF, Secrets Manager, KMS across 3 regions)

---

## Bootstrap Checklist (2026-05-21)

Pre-implementation operations required before DEPLOY-001 can be validated.

| Item | Status | Date | Notes |
|---|---|---|---|
| Route 53 hosted zone for `cello.mygentic.ai` | Done | 2026-05-21 | NS delegated from GoDaddy; 4 NS records added |
| Confirm us-east-1 VPC CIDR | Done | 2026-05-21 | No existing CELLO VPC — `10.0.0.0/16` is clean to use |
| ECR repo `cello-directory` (us-east-1) | Done | 2026-05-21 | `257394457473.dkr.ecr.us-east-1.amazonaws.com/cello-directory` |
| ECR repo `cello-relay` (us-east-1) | Done | 2026-05-21 | `257394457473.dkr.ecr.us-east-1.amazonaws.com/cello-relay` |
| Service limits (eu-central-1, ap-northeast-1) | Done | 2026-05-21 | RDS: 40 instances, ALB: 50 — far above need |
| CodeStar Connection `github-cello-main` (us-east-1) | Done | 2026-05-22 | ARN: `arn:aws:codeconnections:us-east-1:257394457473:connection/1a7fba2b-dd1d-4ebe-8372-7122b89f56b5` — AVAILABLE |
| Stub images pushed to ECR | Pending | — | Needed before ECS services can pass health checks |
| GitHub webhook + HMAC secret | Pending | — | Blocks DEPLOY-004; needs Lambda from DEPLOY-001 first |
| Ed25519 key pairs (3 directory + 3 relay) | Pending | — | Blocks DEPLOY-002/003; needs Secrets Manager resources from DEPLOY-001 first |
| Domain registered | N/A | — | Already owned (`mygentic.ai` on GoDaddy) |

**DEPLOY-001 is unblocked.** Remaining items depend on DEPLOY-001 outputs.

---

## Related Documents

- [[2026-05-21_1400_m5-infrastructure-decisions|M5 Infrastructure Decisions]] — VPC CIDRs, node IDs, RDS/ECS sizing, PostgreSQL version, domain strategy, relay manifest schema
- [[2026-05-16_0753_development-pipeline-and-local-iteration|Development Pipeline and Local Iteration Strategy]] — CI/CD pipeline design, Lambda router pattern, IaC discipline, environment tiers
- [[2026-05-14_1853_milestone-sequence-revision|Milestone Sequence Revision]] — sequencing decisions placing M5 here
- [[2026-05-16_0900_m4-infrastructure-decisions|M4 Infrastructure Decisions]] — VPC, IAM, Secrets Manager naming convention, KMS, S3 audit bucket established at M4; M5 adds two regions and federation on top of this foundation
- [[2026-04-08_1700_node-architecture-and-replication|Node Architecture and Replication]] — three-phase node deployment strategy, threshold parameters, primary/backup replication topology
- [[2026-04-17_1400_directory-relay-architecture-reassessment|Directory/Relay Architecture Reassessment]] — relay as session-level Merkle engine; relay node separation from directory
- [[2026-04-11_1700_persistence-layer-design|Persistence Layer Design]] — schema and federation replication strategy this infrastructure hosts
- [[2026-04-13_1400_meta-merkle-tree-design|Meta-Merkle Tree Design]] — checkpoint schema and distributed MMR construction that checkpoint cross-signing here implements
- [[server-infrastructure|CELLO Server Infrastructure Requirements]] — full server infrastructure requirements; M5 is the first milestone that delivers against them
