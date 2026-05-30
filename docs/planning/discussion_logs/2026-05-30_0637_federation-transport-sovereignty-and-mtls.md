---
name: Federation Transport, Node Sovereignty, and Mutual TLS
type: discussion
date: 2026-05-30 06:37
topics: [federation, sovereignty, replication, mutual-tls, certificates, node-architecture, multi-cloud, security, transport, internal-api]
status: decided
description: Identifies the gap between the intended sovereign multi-cloud node architecture and the VPC Peering implementation of federation replication. Establishes mutual TLS over public endpoints as the fix, extends the mutual TLS principle to internal API security, and flags certificate lifecycle management as a paramount operational concern.
---

# Federation Transport, Node Sovereignty, and Mutual TLS

## The Problem

CELLO directory nodes are designed to be sovereign. Each node must be able to operate independently — serving any client, participating in any FROST ceremony, running any part of the protocol — without requiring any other node to be alive. This is the foundational resilience property: an AWS regional outage (or a GCP outage, or a physical attack on a region's infrastructure as occurred in UAE from March 2026) must not be able to take down more than one node.

The current implementation contradicts this. Federation replication between the three directory nodes runs over PostgreSQL logical replication transported via AWS VPC Peering. This means:

- All three nodes are AWS-only — a GCP node cannot join the replication ring without a permanent VPN tunnel back into AWS, creating a hard dependency on AWS networking
- If AWS networking has a bad enough failure, VPC Peering breaks, the replication stream dies, and nodes diverge
- The implementation is correct in mechanism (Postgres logical replication is the right tool) but wrong in transport (VPC Peering is AWS-specific)

## How This Happened — The Design Chain

This is a cross-document consistency failure, not a missing specification.

**April 8 discussion log** (`2026-04-08_1700_node-architecture-and-replication`) correctly specifies the multi-cloud intent: alpha ~6 nodes all AWS, beta ~20 nodes across AWS + GCP + Azure, public phase 50+ nodes permissionless. The constraint is explicit.

**April 11 discussion log** (`2026-04-11_1700_persistence-layer-design`) was written with full awareness of April 8 — that session read and built on it. It correctly specified PostgreSQL logical replication as the federation mechanism. What it did not specify was the transport — how the TCP connection between two Postgres instances gets established across clouds. That gap was invisible in the April 11 session because the multi-cloud constraint from April 8 was alive in that conversation.

**FEDERATION-001 implementation** read the April 11 document, saw "PostgreSQL logical replication," looked at the current state (three AWS regions), and reached for the most obvious available tool: VPC Peering. It never re-read April 8. The April 11 document was self-contained enough to implement from, and the agent treated it as such. The multi-cloud constraint from April 8 was not restated in April 11 as a load-bearing requirement — it was inherited implicitly through the conversation that produced it, but that inheritance did not survive into the implementation context.

**The lesson for future discussion logs:** when a document specifies a mechanism that was shaped by a constraint from an earlier document, restate the constraint inline. Not just a link — an explicit statement. "This transport must work equally on AWS, GCP, and Azure" in the April 11 document would have closed the gap entirely.

## What Postgres Logical Replication Actually Is

Postgres logical replication is a native Postgres feature, completely independent of AWS. Two Postgres instances anywhere in the world can replicate to each other over a standard TCP connection. There is nothing AWS-specific about the protocol. The coupling crept in via the network path — the three RDS instances sit in private subnets (correct security posture), and VPC Peering was used to connect those private subnets. The replication is right. The transport is wrong.

## The Fix — Mutual TLS Over Public Endpoints

Replace VPC Peering as the replication transport with mutual TLS over public endpoints. This is Option 1 of three considered:

- **Option 1 (chosen):** Public endpoints with mutual TLS and certificate pinning. Each node exposes its Postgres replication port on a public IP, locked to known node certificates only. Standard Postgres SSL. Works identically on AWS, GCP, Azure, bare metal. Zero application code changes — infrastructure configuration only.
- **Option 2:** Tunnel replication through the existing libp2p connections between nodes. Cloud-agnostic, more complex to implement.
- **Option 3:** Replace Postgres replication with protocol-level gossip over libp2p. Nodes announce new registrations directly; peers verify and write locally. Cleanest long-term architecture, most implementation work.

Option 1 unblocks GCP nodes immediately with the least risk. Options 2 and 3 remain valid future paths and Option 1 does not prevent migration to either.

### What Mutual TLS Provides

Both sides present certificates. Neither will talk to anything that does not present a known, pinned certificate. An attacker on the public internet hitting that port gets a TLS handshake failure before a single byte of Postgres protocol is exchanged — no login prompt, no password to brute force, no protocol to exploit.

Layers of defence:
1. **Certificate pinning** — each node has a hardcoded list of exactly which certificates it will accept. Not "any valid certificate" but "these specific certificates." Adding a new node requires explicitly provisioning a certificate and distributing it to all existing nodes.
2. **IP allowlist** — the replication port is only open to known node IP ranges. Independent second layer.
3. **Dedicated replication role** — a Postgres role with no privileges except replication. Cannot read arbitrary tables, cannot write, cannot do anything except stream the replication log.

This is more locked down than VPC Peering in one important respect: VPC Peering trusts everything inside the VPC implicitly. Mutual TLS trusts nothing — every connection is explicitly authenticated regardless of network origin.

## Extending Mutual TLS to Internal APIs

The same principle applies to other internal communication currently using API keys. The primary candidate:

**Directory internal API (`POST /internal/pre-authorize`)** — currently protected by an API key in a request header. The Operations Agent calls this to issue pre-authorization tokens. API keys can leak in logs, in environment variable dumps, in crash reports. Mutual TLS means only a client presenting a known certificate can establish the connection at all — the API key never needs to travel over the wire.

This is the one place where adding mutual TLS before launch meaningfully reduces attack surface. The rest of the system is either already correctly secured (libp2p Noise handles node-to-node authentication, HTTPS handles agent-to-directory) or uses certificate-equivalent cryptographic identity (agent K_local signing).

Agent-to-directory connections are intentionally not mutual TLS — agents are end-user software on unknown hardware and certificate management at that scale is not feasible. HTTPS with cryptographic identity at the protocol layer is the correct model there.

## Certificate Lifecycle — A Paramount Concern

If the security model depends on certificates, the strategy for storing, securing, rotating, and revoking those certificates becomes critical infrastructure. This is not an afterthought — it is load-bearing.

Key questions that must be answered before implementing mutual TLS in production:

**Storage:** Private keys must never exist on disk in plaintext. They must live in a secrets manager (AWS Secrets Manager, GCP Secret Manager) with access restricted to the process that needs them at startup. The same standard already applied to K_server_X shares and Telegram tokens.

**Rotation:** Certificates expire. The rotation process must be automated, tested, and non-disruptive — certificate rotation must not require downtime. A rotation that silently fails and leaves an expired certificate in place is a future outage.

**Revocation:** If a node is compromised, its certificate must be revocable and all other nodes must stop accepting it within a defined window. The distribution mechanism for revocation (how does Node A learn that Node B's certificate is no longer trusted?) must be specified before the system depends on it.

**Bootstrap:** When a new node joins the network for the first time, how does it receive its certificate and how do existing nodes learn to trust it? This must be a deliberate ceremony, not an ad-hoc process.

**Audit:** Certificate issuance, rotation, and revocation events must be logged and auditable. A certificate that was issued outside the normal process is an indicator of compromise.

A certificate management strategy document should be written before any mutual TLS implementation work begins. The implementation is straightforward. The operational model around it is what determines whether it remains secure over time.

---

## Decisions Made

1. VPC Peering as the federation replication transport is a mistake, not an architectural decision. It will be replaced.
2. Mutual TLS over public endpoints is the chosen replacement transport for Postgres federation replication.
3. Mutual TLS will also replace the API key on the directory internal pre-authorization endpoint.
4. Certificate lifecycle management (storage, rotation, revocation, bootstrap, audit) must be fully specified before implementation begins.
5. Protocol-level gossip over libp2p (Option 3) remains the long-term target architecture and is not foreclosed by choosing Option 1 now.

---

## Related Documents

- [[2026-04-08_1700_node-architecture-and-replication]] — multi-cloud node pool specification; the constraint that makes VPC Peering wrong
- [[2026-04-11_1700_persistence-layer-design]] — federation replication specification; the document that left transport unspecified
- [[2026-05-21_0900_m5-schema-before-federation-sequencing]] — sequencing decision for the federation implementation that built the replication ring
- [[2026-05-16_0753_development-pipeline-and-local-iteration]] — adapter pattern; certificate providers will follow the same interface/stub pattern
- [[server-infrastructure]] — node architecture and internal API specifications; both sections affected by this decision
