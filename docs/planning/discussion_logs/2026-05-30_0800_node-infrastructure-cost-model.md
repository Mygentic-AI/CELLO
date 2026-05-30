---
name: Node Infrastructure Cost Model
type: discussion
date: 2026-05-30 08:00
topics: [infrastructure, costs, scaling, nodes, aws, gcp, vpc-endpoints, rds, fargate, alb, cloudwatch, waf, secrets-manager, kms, ecr]
status: reference
description: Comprehensive per-node cost breakdown derived from AWS Cost & Usage Reports (May 29, 2026). Shows itemised costs per component, per-region AWS pricing variation, and scaling projections to 6, 10, and 20 nodes. Structured so GCP equivalent costs can be derived by substituting GCP service rates for each line item.
---

# Node Infrastructure Cost Model

## Methodology

Costs derived from AWS Cost & Usage Reports for May 29, 2026 — the first full day with all three node regions running and the demo agent live. Report timestamp: `20260529T174855Z`. All costs are unblended USD. AWS credits are not factored in — these are gross costs before any credit offset.

**Architecture reminder:** CELLO is a federated system with sovereign nodes. One node = one region = one independent deployment. Adding a node means adding a new region. Two nodes never share a region.

---

## What Runs Per Node (Per Region)

Each CELLO node region runs the following infrastructure:

| Component | What It Is |
|---|---|
| **VPC** | Virtual private cloud — the network boundary for the region |
| **7 VPC Interface Endpoints** | Private network paths to AWS control-plane APIs (see below) |
| **RDS PostgreSQL** | db.t3.small — the node's local database |
| **ECS Fargate — Directory task** | The directory node process |
| **ECS Fargate — Relay task** | The relay node process |
| **ALB** | Application Load Balancer — TLS termination, routes agents to directory |
| **CloudWatch Metrics** | Operational monitoring and alarms |
| **Public IPv4** | Elastic IPs for ECS tasks and ALB |
| **WAF WebACL + Rules** | Web Application Firewall on the ALB |
| **Secrets Manager** | ~10–12 secrets: DB credentials, node private key, envelope key, KMS key ARN, etc. |
| **KMS Key** | Customer-managed key for envelope key encryption (K_server_X shares) |
| **ECR Repositories** | Container image storage — directory and relay images |
| **VPC Peering** | Cross-region database replication transport (to be replaced with mutual TLS — see `2026-05-30_0637_federation-transport-sovereignty-and-mtls`) |

**Not per-node (shared, us-east-1 only):**
- CodeBuild / CodePipeline CI/CD pipeline
- Operations Agent ECS deployment (Telegram registration bot)
- Demo agent EC2

---

## The 7 VPC Interface Endpoints — Itemised

Each node region requires exactly these 7 interface endpoints. They are not optional — ECS Fargate in a private subnet cannot function without them.

| Endpoint | Service | Why Required |
|---|---|---|
| `ecr.api` | ECR control plane | ECS Fargate authenticates and fetches image manifests |
| `ecr.dkr` | ECR image layers | ECS Fargate pulls actual container image data |
| `secretsmanager` | Secrets Manager | Task startup injects DB credentials, private keys, tokens |
| `kms` | KMS | Envelope key decryption for K_server_X FROST shares |
| `logs` | CloudWatch Logs | Structured log emission (all domain.noun.verb events) |
| `ssm` | SSM Session Manager | ECS Exec console access; SSM Parameter Store |
| `ssmmessages` | SSM Messages | Required companion to SSM — both must exist together |

**Pricing per endpoint per hour (AWS, varies by region):**

| Region | Rate/hr | Rate/day (×24) | Rate/month (×720) |
|---|---:|---:|---:|
| us-east-1 (N. Virginia) | $0.010 | $0.240 | $7.20 |
| eu-central-1 (Frankfurt) | $0.012 | $0.288 | $8.64 |
| ap-northeast-1 (Tokyo) | $0.014 | $0.336 | $10.08 |

**7 endpoints × monthly rate:**

| Region | Monthly (7 endpoints) |
|---|---:|
| us-east-1 | $50.40 |
| eu-central-1 | $60.48 |
| ap-northeast-1 | $70.56 |

There is also a data processing charge of $0.01/GB through the endpoint. In practice this is near-zero — the actual image layer data is served from S3 via a free Gateway endpoint, not through the interface endpoint. Observed charge in CUR: $0.00.

---

## Per-Node Cost Breakdown — AWS (Monthly)

Using actual CUR rates. Regional variation shown where it differs meaningfully.

### VPC Interface Endpoints

| Region | Monthly |
|---|---:|
| us-east-1 | $50.40 |
| eu-central-1 | $60.48 |
| ap-northeast-1 | $70.56 |
| **Typical range** | **$50–71** |

### RDS PostgreSQL (db.t3.small, Single-AZ, gp3 storage)

| Region | Hourly rate | Monthly (instance) | Storage (20GB gp3) | **Total** |
|---|---:|---:|---:|---:|
| us-east-1 | $0.036 | $25.92 | $2.30 | **$28.22** |
| eu-central-1 | $0.042 | $30.24 | $2.74 | **$32.98** |
| ap-northeast-1 | $0.056 | $40.32 | $2.76 | **$43.08** |

### ECS Fargate Compute (Directory + Relay tasks)

Fargate charges per vCPU-hour and per GB-hour. Observed from CUR:

| Region | Monthly (vCPU + memory, both tasks) |
|---|---:|
| us-east-1 | ~$8.70 |
| eu-central-1 | ~$10.43 |
| ap-northeast-1 | ~$12.93 |

*Note: Fargate vCPU rate is $0.04856/vCPU-hr in us-east-1; memory $0.00532/GB-hr. Rates vary ~15–30% across regions. Actual cost depends on task CPU/memory allocation.*

### Application Load Balancer

One ALB per node region (directory node). Charge is per ALB-hour plus LCU usage (near-zero at current traffic).

| Region | Hourly rate | Monthly |
|---|---:|---:|
| us-east-1 | $0.0225 | $16.20 |
| eu-central-1 | $0.0270 | $19.44 |
| ap-northeast-1 | $0.0243 | $17.50 |

### CloudWatch Metrics

~20 custom metrics per region (ECS task counts, RDS, ALB, WAF, ops-agent). Charged at $0.30/metric/month for first 10,000.

| All regions | ~$12/month per region |
|---|---|
| Observed in CUR | $12.38 (us-east-1), $11.88 (eu-central-1 + ap-northeast-1) |

### Public IPv4 Addresses

$0.005/hr per in-use public IPv4. Each node region uses ~4–5 addresses (ALB, ECS task IPs, EIPs).

| Region | Observed monthly |
|---|---:|
| us-east-1 | $7.92 |
| eu-central-1 | $5.60 |
| ap-northeast-1 | $5.60 |

### WAF WebACL + Rules

One WebACL per region on the directory ALB. WebACL: $5.00/month prorated. Rules: $1.00/rule/month (3 rules).

| Per region | $5.00 + $3.00 = **$8.00/month** |
|---|---|
| Observed in CUR | ~$5.38/region (prorated — full month = $8.00) |

### Secrets Manager

~10–12 secrets per region. $0.40/secret/month.

| Per region | ~10 secrets × $0.40 = **$4.00/month** |
|---|---|
| Observed in CUR | $3.44–$4.40 depending on region |

### KMS Customer-Managed Key

$1.00/key/month. One key per region.

| Per region | **$1.00/month** |
|---|---|

### ECR Image Storage

Two repositories per region (directory + relay images). Storage cost depends on image size. Observed:

| Per region | ~$1.00–$1.50/month |
|---|---|

### VPC Peering (current, to be replaced)

Near-zero at current replication volume. Data transfer between regions: $0.02/GB. Observed: <$0.01/day.

---

## Per-Node Monthly Total — AWS (by region)

| Component | us-east-1 | eu-central-1 | ap-northeast-1 |
|---|---:|---:|---:|
| VPC Endpoints (7) | $50.40 | $60.48 | $70.56 |
| RDS PostgreSQL | $28.22 | $32.98 | $43.08 |
| ECS Fargate | $8.70 | $10.43 | $12.93 |
| ALB | $16.20 | $19.44 | $17.50 |
| CloudWatch Metrics | $12.38 | $11.88 | $11.88 |
| Public IPv4 | $7.92 | $5.60 | $5.60 |
| WAF WebACL + Rules | $8.00 | $8.00 | $8.00 |
| Secrets Manager | $4.00 | $4.00 | $4.00 |
| KMS Key | $1.00 | $1.00 | $1.00 |
| ECR Storage | $1.25 | $1.25 | $1.25 |
| **Total per node** | **$138.07** | **$155.06** | **$175.80** |

**Average across the three current node regions: ~$156/node/month**

---

## Shared Infrastructure (us-east-1 Only, Not Per-Node)

These costs exist once regardless of how many nodes the network has:

| Component | Monthly |
|---|---:|
| CodeBuild / CodePipeline CI/CD | ~$10 |
| Operations Agent ECS (Telegram registration bot) | ~$15 |
| Demo agent EC2 (t3.micro) | ~$8 |
| **Total shared** | **~$33/month** |

---

## Scaling Projections

Each new node adds one new region. Costs below use the average per-node figure of ~$156/month for AWS regions. Real costs will vary based on which regions are chosen — Tokyo and Sydney are more expensive than Virginia; Frankfurt and Paris are mid-range.

| Nodes | Node regions | Per-node avg | Node costs | Shared | **Total/month** |
|---|---|---:|---:|---:|---:|
| 3 (current) | 3 AWS | $156 | $468 | $33 | **$501** |
| 6 | 6 regions (mix) | $156 | $936 | $33 | **$969** |
| 10 | 10 regions (mix) | $156 | $1,560 | $33 | **$1,593** |
| 20 | 20 regions (mix) | $156 | $3,120 | $33 | **$3,153** |

**Cost per node stays roughly flat at ~$156/month as the network scales.** There is no amortisation effect because every new node is a new region with its own full set of infrastructure.

---

## What Drives the Cost — Ranked

| Rank | Component | % of per-node cost | Notes |
|---|---|---:|---|
| 1 | VPC Endpoints | ~39% | Fixed set of 7; unavoidable for Fargate in private subnets |
| 2 | RDS PostgreSQL | ~20% | Could reduce with smaller instance at low volume |
| 3 | ALB | ~11% | One per node; required for TLS termination |
| 4 | CloudWatch Metrics | ~8% | Scales with metric count, not traffic |
| 5 | ECS Fargate | ~7% | Scales with task CPU/memory allocation |
| 6 | Public IPv4 | ~5% | AWS charges $0.005/hr per address since Feb 2024 |
| 7 | WAF | ~5% | Flat fee regardless of traffic |
| 8 | Everything else | ~5% | Secrets Manager, KMS, ECR |

VPC endpoints are the dominant cost driver at low node counts and remain significant at scale. They are not optional — they are the security mechanism that keeps all AWS API traffic off the public internet, which is appropriate for a privacy-first trust infrastructure product.

---

## GCP Equivalent Cost Model

To derive GCP costs for a node region, substitute the following GCP services for each AWS line item. Rates as of mid-2026 — verify current pricing at cloud.google.com/pricing.

| AWS Component | GCP Equivalent | GCP Pricing Basis |
|---|---|---|
| VPC Interface Endpoints (7) | **Private Service Connect endpoints** | Per endpoint per hour + per GB processed. PSC endpoint: ~$0.01/hr in most regions (verify — pricing varies). Data: $0.01/GB |
| RDS PostgreSQL db.t3.small | **Cloud SQL PostgreSQL** (db-g1-small or db-f1-micro) | db-g1-small: ~$0.036/hr us-central1; varies by region. Storage: $0.17/GB/month (SSD) |
| ECS Fargate | **Cloud Run** or **GKE Autopilot** | Cloud Run: $0.00002400/vCPU-sec + $0.00000250/GB-sec. GKE Autopilot: similar Fargate-like per-pod pricing |
| ALB | **Cloud Load Balancing (HTTP(S))** | $0.025/hr for forwarding rule + $0.008/GB processed |
| CloudWatch Metrics | **Cloud Monitoring** | First 150MB metrics/month free; $0.01/MB after. Custom metrics: first 10 free, then $0.10/metric/month |
| Public IPv4 | **External IP addresses** | $0.004/hr for in-use external IP (static) |
| WAF WebACL + Rules | **Cloud Armor** | $5.00/policy/month + $1.00/rule/month + $0.75/million requests |
| Secrets Manager | **Secret Manager** | $0.06/secret/month + $0.03/10K access operations |
| KMS Key | **Cloud KMS** | $0.06/key/month (software); $1.00/key/month (HSM) |
| ECR repositories | **Artifact Registry** | $0.10/GB/month storage; no per-repository fee |
| VPC Peering / replication transport | **VPC Network Peering** or **Cloud Interconnect** | VPC Peering: free to establish; data transfer charged at standard egress rates ($0.01–$0.08/GB depending on regions) |

**GCP-specific notes for Perplexity analysis:**

1. **Private Service Connect** is the GCP equivalent of AWS VPC Interface Endpoints. It keeps traffic to Google APIs (Secret Manager, Artifact Registry, Cloud Logging, etc.) inside the VPC. PSC endpoint pricing should be verified — it is the single largest cost driver and GCP's rates may differ significantly from AWS.

2. **Cloud SQL** single instance pricing is broadly comparable to RDS. The equivalent instance tier to db.t3.small is db-g1-small (1 shared vCPU, 1.7GB RAM). Check current pricing for the target region — Asia Pacific regions are typically 20–40% more expensive than us-central1.

3. **Cloud Run** is likely cheaper than GKE Autopilot for the directory and relay workloads, which run continuously but at low CPU utilisation. The minimum instance count setting (keep 1 instance warm) is relevant — cold starts are not acceptable for a protocol node.

4. **Cloud Armor** (WAF equivalent) has a minimum policy fee of $5/month, similar to AWS WAF.

5. **Secret Manager** at $0.06/secret/month is significantly cheaper than AWS Secrets Manager at $0.40/secret/month — ~6× cheaper for the same number of secrets.

6. **GCP does not charge for VPC Peering establishment** (unlike AWS which charges per peering connection-hour in some configurations), but cross-region data transfer egress rates still apply.

---

## Key Cost Observations

1. **VPC endpoints are unavoidable on AWS for this architecture.** Private subnets require them. The alternative — public subnets — would mean all AWS API traffic crosses the internet, which is wrong for a trust infrastructure product.

2. **The cost is dominated by standing infrastructure, not traffic.** At current usage (near-zero production traffic), virtually all cost is fixed: endpoints, RDS instance hours, ALB hours, CloudWatch metric slots, WAF policy fees. The network could serve 10,000 sessions/day with almost no cost increase.

3. **GCP Secret Manager is ~6× cheaper than AWS Secrets Manager** for the same secret count. With ~10–12 secrets per region, this saves ~$3/node/month — small but worth noting.

4. **The per-node cost stays roughly flat as the network scales.** Unlike a single-region multi-tenant system where fixed costs amortise, CELLO's sovereign node model means each new node is a new region with a full set of infrastructure. $156/node/month is the steady-state figure at any scale.

5. **Asia Pacific regions are the most expensive** on both AWS and GCP due to higher regional rates for most services. Tokyo (ap-northeast-1) costs ~27% more per node than Virginia (us-east-1). This is worth factoring into region selection as the network grows.

---

## Related Documents

- [[2026-05-30_0637_federation-transport-sovereignty-and-mtls]] — federation transport decision; VPC Peering replacement
- [[2026-04-08_1700_node-architecture-and-replication]] — multi-cloud sovereign node architecture specification
- [[2026-05-16_0753_development-pipeline-and-local-iteration]] — adapter pattern; same pattern applies to cloud-provider-specific services
