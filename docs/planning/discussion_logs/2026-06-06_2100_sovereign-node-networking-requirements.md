---
name: sovereign-node-networking-requirements
type: discussion
date: 2026-06-06
topics: [infrastructure, networking, relay, directory, sovereign-nodes, multi-cloud, nat-gateway, vpc]
status: active
description: >
  Discussion that emerged from a day of relay registration failures. Establishes
  the fundamental networking requirements for sovereign nodes in a multi-cloud
  peer-to-peer system. Identifies the NAT gateway as a required primitive, not
  an optional cost saving. Analyzes VPC endpoint cost implications.
---

# Sovereign Node Networking Requirements

## Context

This discussion emerged after a full day attempting to get relay auto-registration (M6B-006) working after the nuclear reset. Every approach failed with a generic `directory_unavailable` error. After analysis by two independent agents, the root cause was identified — and it revealed a more fundamental architectural gap.

---

## What We Were Trying to Do

When a relay starts up, it registers with its co-located directory node. The relay dials the directory and sends a `relay_register` frame containing its identity, Ed25519 signature, and health check URL. The directory writes this to the database, re-signs the S3 manifest, and clients can now discover the relay.

This is M6B-006: relay auto-registration on startup. The code is complete and correct. What failed was the physical network path.

---

## The Root Cause

The relay runs in a **private subnet with no NAT gateway**. The VPC was deliberately built without a NAT gateway (`cello-vpc.yaml` line 4: "No NAT Gateway — VPC Interface Endpoints provide AWS service access"). VPC interface endpoints provide access to AWS APIs (ECR, Secrets Manager, KMS, SSM, S3) but do not provide a route to the public internet.

The directory's public DNS hostname (`directory-us1.cello.mygentic.ai`) resolves to the internet-facing ALB's **public IP**. A task in a private subnet with no NAT gateway has no route to public IPs. TCP SYN packets are silently dropped at the subnet boundary — they never reach the directory.

Everything else — the libp2p protocol, the registration frame, the database write, the manifest re-signing, the cross-region replication — works correctly. The single missing piece is a network route from the relay's private subnet to the public internet.

---

## Why the Directory Does Not Need a NAT Gateway (Today)

The directory only **receives** connections — it never initiates them to the public internet. Clients dial the directory through the internet-facing ALB. The directory responds on those same connections. All AWS service calls (S3, Secrets Manager, KMS, SSM) go through VPC interface endpoints.

**However**, this is because of a hack: the directory uses the relay's **private VPC IP** (`CELLO_RELAY_MULTIADDR=/ip4/10.0.x.x/tcp/4001/p2p/...`) for directory-to-relay connections. That private IP is in the same VPC, so no internet access is needed. This IP is hardcoded in the directory's ECS task definition and breaks every time the relay task restarts and gets a new IP.

The correct design — directory dials the relay's public ALB hostname (`relay-us1.cello.mygentic.ai`) — would require the directory to also have outbound internet access, which requires a NAT gateway.

---

## The Fundamental Requirement for Sovereign Nodes

A sovereign node in CELLO's peer-to-peer network must be able to:
1. **Receive connections** from any other node or client on the internet
2. **Initiate connections** to any other node on the internet

Both require stable public addresses and outbound internet access. These are not optional — they are definitional requirements for participation in a peer-to-peer network. Bitcoin nodes, Ethereum nodes, IPFS nodes all require the same thing. You cannot deploy a peer-to-peer node in a private subnet with no outbound route and expect it to join the network.

This means every sovereign CELLO node — directory and relay — requires:

| Component | AWS | GCP | Azure | Purpose |
|---|---|---|---|---|
| Stable inbound address | Application Load Balancer | Cloud Load Balancing | Application Gateway | Stable DNS name for other nodes and clients to dial |
| Outbound internet access | NAT Gateway | Cloud NAT | NAT Gateway | Ability to initiate connections to other sovereign nodes |

The cloud provider names differ but the concepts are identical. This is a property of the network topology, not of any specific cloud provider.

---

## Current State Is Hacky and AWS-Specific

The current setup avoids NAT gateways by using private VPC IPs for relay-directory communication. This:

- **Breaks on every task restart** — ECS assigns a new private IP, the hardcoded multiaddr becomes stale
- **Cannot work cross-cloud** — a directory in GCP cannot reach a relay in AWS via private VPC IP
- **Violates the sovereign node invariant** — nodes are coupled by VPC membership, not by their protocol identity
- **Requires manual intervention** after every deployment — the private IP must be discovered and propagated

The correct design uses only public addresses. Both relay and directory dial each other via public DNS hostnames. The libp2p peer ID in the multiaddr provides cryptographic authentication — the Noise XX handshake ensures you're talking to the right node regardless of what IP address answered the DNS query. This is exactly what libp2p was designed for.

---

## The Fix: NAT Gateways Are Required Infrastructure

NAT gateways are not a cost optimization to defer. They are a fundamental requirement for sovereign nodes. Without them, the system can only work within a single cloud provider's VPC — which defeats the entire purpose.

Cost: ~$30/month per NAT gateway. With 3 regions: ~$90/month. With both relay and directory needing them (when private IPs are eliminated): same gateways serve both, so still ~$90/month total. This is not optional — it is the price of a sovereign multi-cloud node.

With NAT gateways:
- Relay dials `directory-us1.cello.mygentic.ai` → works identically on AWS, GCP, Azure
- Directory dials `relay-us1.cello.mygentic.ai` → works identically on AWS, GCP, Azure
- No private IPs anywhere in the configuration
- No VPC coupling between nodes
- Works correctly on task restart — DNS always resolves to the current healthy task behind the ALB

---

## Can NAT Gateways Replace Some VPC Interface Endpoints?

Currently the VPC has 7 interface endpoints (plus 1 gateway endpoint for S3):

| Endpoint | Service | Cost | Still needed with NAT? |
|---|---|---|---|
| `ecr.api` | ECR image pull auth | ~$7/month | No — NAT provides internet route to ECR |
| `ecr.dkr` | ECR image pull data | ~$7/month | No — NAT provides internet route to ECR |
| `secretsmanager` | Secrets Manager | ~$7/month | No — NAT provides internet route |
| `kms` | KMS | ~$7/month | No — NAT provides internet route |
| `logs` | CloudWatch Logs | ~$7/month | No — NAT provides internet route |
| `ssm` | SSM Parameter Store | ~$7/month | No — NAT provides internet route |
| `ssmmessages` | SSM Session Manager | ~$7/month | Yes — SSM Session Manager (ECS Exec) requires this endpoint specifically; NAT alone is insufficient |
| `s3` (Gateway) | S3 | Free | Keep — Gateway endpoints are free and route S3 traffic within AWS backbone (better latency, no NAT bandwidth cost) |

**Net analysis:** Adding NAT gateways (~$90/month for 3 regions) would allow removing 6 of the 7 interface endpoints (~$42/month per region × 3 = ~$126/month saved). The `ssmmessages` endpoint must be kept for ECS Exec / SSM Session Manager access. The S3 gateway endpoint should be kept (free, better performance).

**Rough cost comparison per region:**
- Current (no NAT, 7 interface endpoints): ~$49/month (7 × $7)
- With NAT (1 NAT + ssmmessages endpoint + S3 gateway): ~$37/month ($32 NAT + $7 ssmmessages + $0 S3)

Adding NAT gateways is cheaper than the current interface endpoint setup — and it correctly enables sovereign node participation in a multi-cloud network.

---

## Summary of Required Changes

1. **Add NAT gateways** to `cello-vpc.yaml` — one per region, attached to the public subnets, with a `0.0.0.0/0` route in the private route table
2. **Remove interface endpoints** for ECR API, ECR DKR, Secrets Manager, KMS, CloudWatch Logs, SSM — they become unnecessary with NAT
3. **Keep** `ssmmessages` endpoint (SSM Session Manager / ECS Exec) and `s3` gateway endpoint
4. **Remove `CELLO_RELAY_MULTIADDR` private IP hack** from the directory task definition — replace with the relay's public ALB hostname
5. **Remove `CELLO_DIRECTORY_MULTIADDR` SSM lookup** complexity from deploy.sh — the relay just dials the well-known public DNS hostname at startup

The result is a system where every node, on every cloud, in every region, uses only public DNS addresses to communicate — exactly as a sovereign peer-to-peer network should work.

---

## Current Temporary Fix (2026-06-06)

While the proper NAT gateway solution is implemented, the relay was manually patched:
- ECS task definition revision `:55` registered directly with `CELLO_DIRECTORY_MULTIADDR=/ip4/10.0.10.179/tcp/4000/p2p/12D3Koo...` (directory's current private IP, TCP port 4000)
- A manual SG rule was added allowing relay SG → directory SG on port 4000
- **This will break** when the directory task restarts and gets a new IP
- **This is not in IaC** — a deploy.sh run will overwrite it

The temporary fix buys time to implement the NAT gateway solution properly as a story.

---

## Related Documents

- [[2026-04-08_1700_node-architecture-and-replication|Node Architecture, Replication, and Client Routing]] — foundational sovereign multi-cloud node design; the constraint that peer-to-peer communication must cross cloud boundaries is established here
- [[2026-05-30_0637_federation-transport-sovereignty-and-mtls|Federation Transport, Node Sovereignty, and Mutual TLS]] — companion decision replacing VPC Peering with mutual TLS; both documents together define the full sovereign node networking model
- [[2026-05-30_0800_node-infrastructure-cost-model|Node Infrastructure Cost Model]] — cost analysis that established NAT gateways are cheaper than the current interface endpoint setup; this document provides the engineering rationale the cost model assumed
- [[2026-06-03_1146_beta-launch-brittleness-analysis|Beta Launch Brittleness Analysis]] — root cause analysis for relay registration failures; the location-based addressing problem diagnosed there is the direct trigger for this discussion
- [[user-stories/m6b/outline|M6B — Beta Hardening]] — CELLO-M6B-014 implements the NAT gateway story derived from this discussion
