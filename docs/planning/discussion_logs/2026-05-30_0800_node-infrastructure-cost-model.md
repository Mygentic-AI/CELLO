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

Each new node adds one new region. AWS average ~$156/node/month. GCP average ~$169/node/month (see GCP section below). Mixed column assumes 50% AWS, 50% GCP — the target production mix.

| Nodes | All AWS | All GCP | 50/50 Mixed | Shared | **Total (mixed)** |
|---|---:|---:|---:|---:|---:|
| 3 (current, all AWS) | $468 | — | — | $33 | **$501** |
| 6 | $936 | $1,014 | $975 | $33 | **$1,008** |
| 10 | $1,560 | $1,690 | $1,625 | $33 | **$1,658** |
| 20 | $3,120 | $3,380 | $3,250 | $33 | **$3,283** |

**Cost per node stays roughly flat as the network scales.** No amortisation — every new node is a new region with its own full infrastructure stack.

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

## GCP Cost Model — Per Node (Monthly)

GCP equivalent services with corrected compute choice. Rates verified mid-2026; check cloud.google.com/pricing for current rates.

**Critical note on compute:** ECS Fargate's correct GCP equivalent is **GKE Autopilot**, not Cloud Run. CELLO's directory node maintains persistent WebSocket connections with agents that can last hours. Cloud Run has a 60-minute maximum request timeout and is designed for stateless request-response workloads — it would drop agent connections. GKE Autopilot supports persistent connections and charges per vCPU-hour and GB-hour like Fargate.

**Critical note on WAF:** Cloud Armor has two tiers. Standard ($5/policy + $1/rule/month) allows custom rule configuration — equivalent to AWS WAF if you manually configure the OWASP Top 10 rules once. Managed Protection Plus ($3,000/month minimum) provides pre-configured managed rules equivalent to AWS Managed Rules — enterprise tier, not relevant at CELLO's current scale. The figures below use Standard with manually configured rules.

| Component | GCP Service | us-central1 | eu-west3 (Paris) | asia-northeast1 (Tokyo) |
|---|---|---:|---:|---:|
| Private Service Connect (7 endpoints) | PSC Interface Endpoints | $50.40 | $50.40 | $50.40 |
| PostgreSQL (db-g1-small + 20GB SSD) | Cloud SQL | $28.60 | $32.00 | $37.00 |
| Directory + Relay tasks (persistent WebSocket) | GKE Autopilot | $40.00 | $44.00 | $49.00 |
| Load balancer (TLS termination) | Cloud Load Balancing | $18.00 | $18.00 | $18.00 |
| Monitoring (~20 custom metrics) | Cloud Monitoring | $12.00 | $12.00 | $12.00 |
| External IP addresses (4) | External IPs | $11.52 | $11.52 | $11.52 |
| WAF (Standard + manual OWASP rules) | Cloud Armor Standard | $8.00 | $8.00 | $8.00 |
| Secrets (~10) | Secret Manager | $0.60 | $0.60 | $0.60 |
| Envelope key encryption | Cloud KMS (software) | $0.06 | $0.06 | $0.06 |
| Container image storage | Artifact Registry | $0.10 | $0.10 | $0.10 |
| **Total per node** | | **$169.28** | **$176.68** | **$186.68** |

**Average across three GCP regions: ~$177/node/month**

### AWS vs GCP Per-Node Comparison

| Region type | AWS | GCP | Difference |
|---|---:|---:|---:|
| US (Virginia / Iowa) | $138 | $169 | GCP +$31 (+22%) |
| Europe (Frankfurt / Paris) | $155 | $177 | GCP +$22 (+14%) |
| Asia Pacific (Tokyo) | $176 | $187 | GCP +$11 (+6%) |
| **Average** | **$156** | **$177** | **GCP +$21 (+13%)** |

GCP is 13% more expensive on average, driven primarily by GKE Autopilot costing more than ECS Fargate. The gap narrows in Asia Pacific where AWS regional premiums are highest.

**Notable GCP savings vs AWS:**
- Secret Manager: $0.60 vs $4.00 — 85% cheaper (saves $3.40/node/month)
- KMS: $0.06 vs $1.00 — 94% cheaper (saves $0.94/node/month)
- These savings are real but small relative to the overall per-node cost

---

## Regional Pricing — All Candidate AWS Regions

Per-node monthly cost across all regions CELLO might deploy to. Calculated from AWS published rates. Three current nodes marked ◄.

Assumptions: db.t3.small RDS single-AZ + 20GB gp3, 2 Fargate tasks (directory + relay) at current allocation, 1 ALB, 4 public IPs, 7 VPC endpoints, standard fixed costs ($26.25: Secrets Manager + KMS + ECR + WAF + CloudWatch).

| Region | Endpoints | RDS | Fargate | ALB | IPv4 | Fixed | **Total/mo** |
|---|---:|---:|---:|---:|---:|---:|---:|
| us-east-1 N. Virginia ◄ | $50.40 | $28.22 | $42.62 | $16.20 | $14.40 | $26.25 | **$178** |
| us-east-2 Ohio | $50.40 | $28.22 | $42.62 | $16.20 | $14.40 | $26.25 | **$178** |
| us-west-2 Oregon | $50.40 | $28.22 | $42.62 | $16.20 | $14.40 | $26.25 | **$178** |
| ca-central-1 Canada | $55.44 | $31.34 | $47.04 | $18.14 | $14.40 | $26.25 | **$193** |
| eu-west-1 Ireland | $55.44 | $29.90 | $42.72 | $18.14 | $14.40 | $26.25 | **$187** |
| eu-west-2 London | $50.40 | $34.38 | $47.17 | $18.14 | $14.40 | $26.25 | **$191** |
| eu-north-1 Stockholm | $50.40 | $29.86 | $39.97 | $16.34 | $14.40 | $26.25 | **$177** |
| eu-central-1 Frankfurt ◄ | $60.48 | $32.98 | $49.26 | $19.44 | $14.40 | $26.25 | **$203** |
| ap-northeast-1 Tokyo ◄ | $70.56 | $43.08 | $52.79 | $17.50 | $14.40 | $26.25 | **$225** |
| ap-south-1 Mumbai | $60.48 | $35.02 | $50.59 | $16.42 | $14.40 | $26.25 | **$203** |
| ap-northeast-2 Seoul | $65.52 | $37.18 | $47.45 | $17.50 | $14.40 | $26.25 | **$208** |
| ap-southeast-1 Singapore | $65.52 | $41.64 | $50.59 | $17.50 | $14.40 | $26.25 | **$216** |
| ap-southeast-2 Sydney | $65.52 | $42.36 | $51.26 | $17.50 | $14.40 | $26.25 | **$217** |
| sa-east-1 São Paulo | $55.44 | $55.64 | $70.36 | $21.60 | $14.40 | $26.25 | **$244** |

**Key observations from this table:**

- All US regions (Virginia, Ohio, Oregon) cost identically — $178/month. Adding a second NA node means choosing on geography and latency, not cost.
- Ireland ($187) is cheaper than Frankfurt ($203) and roughly comparable to London ($191). It is the most cost-effective EU option after Stockholm ($177).
- Stockholm is the cheapest EU region at $177/month — worth considering if Scandinavia coverage is useful.
- Frankfurt is more expensive than Ireland and London despite being the current EU node — worth reconsidering on cost grounds when adding more EU nodes.
- São Paulo is the most expensive region ($244/month) due to Brazil's high RDS and Fargate rates (~2× US rates). Add last.
- Mumbai ($203) is excellent value for South Asia coverage — same cost bracket as Frankfurt, high quality region, covers India and the broader South Asian market.
- Asia Pacific ranges $203–$225. Tokyo is the most expensive in APAC; Mumbai and Seoul offer the best value for coverage.

---

## Key Cost Observations

1. **Private subnet endpoints are unavoidable for this architecture** on both AWS and GCP. They are the security mechanism keeping all cloud API traffic off the public internet — appropriate for a privacy-first trust infrastructure product. They represent ~30–39% of per-node cost on both platforms.

2. **The cost is dominated by standing infrastructure, not traffic.** At current usage (near-zero production traffic), virtually all cost is fixed: endpoints, database instance hours, load balancer hours, monitoring metric slots, WAF policy fees. The network could serve 10,000 sessions/day with almost no cost increase.

3. **AWS is ~13% cheaper than GCP on average** for this workload, primarily because ECS Fargate is cheaper than GKE Autopilot. The gap narrows in Asia Pacific where AWS regional premiums are highest.

4. **The per-node cost stays roughly flat as the network scales.** Every new node is a new region with its own full infrastructure stack. AWS ~$156/node/month and GCP ~$177/node/month are steady-state figures at any scale.

5. **Asia Pacific regions are the most expensive** on both platforms. Tokyo costs ~27% more per node than Virginia on AWS, ~10% more than Iowa on GCP. Factor this into region selection as the network grows.

6. **At 50/50 AWS/GCP mix, blended cost is ~$166/node/month** — between the two platform averages. This is the realistic production target figure for planning purposes.

---

## Related Documents

- [[2026-05-30_0637_federation-transport-sovereignty-and-mtls]] — federation transport decision; VPC Peering replacement
- [[2026-04-08_1700_node-architecture-and-replication]] — multi-cloud sovereign node architecture specification
- [[2026-05-16_0753_development-pipeline-and-local-iteration]] — adapter pattern; same pattern applies to cloud-provider-specific services
