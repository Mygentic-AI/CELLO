---
name: CELLO Implementation Roadmap
type: plan
date: 2026-04-24
topics: [implementation, milestones, user-stories, test-harness, monorepo]
status: active
description: Capability-based milestone map (M0–M10) with implementation decisions, test harness evolution, and fully specified M0 user stories.
---

# CELLO Implementation Roadmap

This document defines what gets built and in what order. Eleven capability milestones, each delivering a protocol capability that builds on the last. M0 user stories are fully specified in `docs/planning/user-stories/m0/`; subsequent milestone stories are written just before work begins.

For the design source, see [[protocol-map|CELLO Protocol Map]]. For the user story template, see [[user-story-format|CELLO User Story Format]]. For the development methodology (SPARC phases, parallel agent orchestration, test framework, cryptographic correctness rules), see [[day-0-agent-driven-development-plan|Day-0 Agent-Driven Development Plan]].

---

## Implementation Decisions

- **Language:** TypeScript end-to-end — client, directory, relay, shared packages. The directory is intended to move to Rust. If CELLO becomes a blockchain, directory nodes become validator nodes, and Rust is the lingua franca of that ecosystem (Solana, Substrate, Near, Aptos, Sui). TypeScript first because the TypeScript directory becomes the reference implementation and test oracle: when the Rust version is built, both run side by side and assert identical behavior. That's a better path to correctness than building Rust cold against a spec.

- **Monorepo:** pnpm workspaces. Packages: `client`, `directory`, `relay`, `protocol-types`, `crypto`, `e2e-tests`. The client is designed for extraction — it imports only from `protocol-types` and `crypto`, never from `directory` or `relay`. When the client moves to its own repo, `protocol-types` and `crypto` publish as npm packages. The imports don't change.

- **Persistence:** In-memory stores behind interfaces initially. A `Store` interface per component, with `InMemoryStore` as the first implementation. The protocol logic — FROST ceremonies, Merkle tree operations, hash relay, connection brokering — is identical regardless of where the bytes live. Deferring real persistence keeps the e2e tests fast (no database setup/teardown, no file cleanup) and focuses early milestones on getting the protocol right. When SQLite/SQLCipher is added, it's a new `Store` implementation behind the same interface. The protocol tests never change; the store layer gets its own focused integration test suite.

- **Test harness:** The e2e test package spins up directory, relay, and clients in a single Vitest process. No Docker, no ports, no inter-process coordination during development. The in-memory stores make this possible.

- **Initial agent integration:** Claude Code sessions. OpenClaw, Hermes, and IronClaw come later per the integration stages in the day-0 plan.

---

## Milestone Map

| Milestone | What gets built | What it proves |
|---|---|---|
| M0 — Walking Skeleton | Monorepo scaffolding, `protocol-types`, `crypto` (Ed25519 + SHA-256), directory stub (WebSocket, in-memory store, message relay), client (connect, send, receive via MCP tool interface), e2e test harness | Two agents can exchange signed messages through infrastructure. The test harness runs a full roundtrip in one Vitest process. |
| M1 — Merkle Notarization | RFC 6962 Merkle tree library, directory sequence numbering, 3-party tree sync (sender, receiver, directory), session close with sealed root | A conversation is a 32-byte receipt. Three independent copies produce the same root. Tamper with one message and the root diverges. |
| M2 — FROST Ceremonies | DKG (distributed key generation), threshold co-signing at session establishment and seal, K_server share management with envelope encryption | Neither the client nor the directory can forge a session alone. A compromised K_local cannot pass the FROST ceremony — compromise is detectable at session boundaries. |
| M3 — Connections & Policy | Registration (stubbed OTP), connection request flow, trust data relay with selective disclosure, `SignalRequirementPolicy` evaluation, accept/decline | Agents control who reaches them. A receiver can require specific trust signals and enforce it. The one-round negotiation works — what you disclose, what you withhold. |
| M4 — Prompt Injection Defense | Six-layer pipeline: Layer 1 deterministic sanitization, Layer 2 DeBERTa scanner, Layer 3 outbound gate, Layer 4 redaction, Layer 5 runtime governance, Layer 6 access control | Messages are safe from injection. Each layer catches different attack classes. Standalone value — works without the network. |
| M5 — Discovery & Notifications | Bio, search (BM25 + vector), contact aliases with revocation, notification event queue | The full cold-start flow: search → discover → connect → converse. Contact aliases enable sharing outside the directory. |
| M6 — Social Trust | Pre-computed endorsements, anti-farming (same-owner rejection), Sybil floor (conductance scoring, provisional period, carrier signals) | Trust is social. Connection policies can require N endorsements from shared contacts. Fake identity networks are expensive to create. |
| M7 — Compromise & Recovery | Continuous compromise detection, "Not Me" revocation with K_server burn and session termination, social recovery (M-of-N, 48-hour wait), key rotation, trust floor based on pre-compromise history | Compromise is survivable. Detection is continuous, revocation is instant, recovery preserves earned trust. |
| M8 — Group Rooms | N-party Merkle tree, concurrent mode with GCD floor control, owner/admin model, throttle manifest with cost protection, violation enforcement with auto-mute, 20-participant cap | Groups work with provable records. Floor control prevents chaos, throttle manifests protect wallets, violations escalate logarithmically. |
| M9 — Commerce | Push-publish subscriptions with per-delivery micropayments, inference billing (rate card, signed cumulative token counts in Merkle leaves, ABORT-BILLING), purchase attestations, merchant CRM data stash, fraud detection | Agents can trade. Token counts are signed and verifiable. Fraudulent billing is caught by the buyer's client or by deterministic arbitration. |
| M10 — Federation | Multi-node directory with primary/backup replication, consensus for state changes, relay node separation, client-side latency monitoring with proactive session migration | The network decentralizes. A node failure mid-session is survivable — the client detects it, migrates, and the session continues. |

### Dependencies

```
M0 → M1 → M2   (core message path — each builds on the last)
       ↓
      M3 → M5 → M6   (identity → discovery → social trust)
       ↓
      M4   (can start after M0 — needs the message pipeline, independent otherwise)
      
M2 + M3 → M7   (recovery needs FROST and identity)
M1 + M3 → M8   (groups need Merkle and connections)
M3 + M5 → M9   (commerce needs identity and discovery)
M2 → M10        (federation needs FROST working on a single node first)
```

M4 is the most parallelizable with other milestones — the scanning pipeline is almost entirely client-side and each layer is independent.

---

## Test Harness Evolution

| After | The e2e harness can test |
|---|---|
| M0 | Two clients exchange signed messages through a directory stub. Assert: message roundtrip, signature verification, rejection of tampered messages. |
| M1 | All of M0 plus: Merkle tree construction across three parties, root comparison after N messages, sealed root on session close, divergence detection on tampered leaves. |
| M2 | All of M1 plus: FROST DKG ceremony, threshold-signed session establishment, threshold-signed seal, rejection of session establishment with a compromised K_local. |
| M3 | All of M2 plus: registration, connection request/accept/decline, policy evaluation against trust signals, selective disclosure of trust data. Two-agent flows now start from "strangers" not "pre-connected." |
| M4 | All of M3 plus: injection payloads through each defense layer, Layer 1 sanitization on incoming messages, Layer 2 scan invocation, Layer 3 outbound gate blocking exfiltration, Layer 4 redaction, Layer 5 cost/volume cap enforcement. |
| M5 | All of M4 plus: agent publishes bio, second agent searches and discovers it, connects via contact alias, full cold-start-to-conversation flow in one test. |
| M6 | All of M5 plus: endorsement creation and verification, policy requiring N endorsements, same-owner endorsement rejection, provisional period enforcement. |
| M7 | All of M6 plus: compromise detection triggers, "Not Me" cascade (K_server burn, all sessions terminated), social recovery ceremony, key rotation with continued conversations, trust floor preservation. |
| M8 | All of M7 plus: 3+ clients in a group room, concurrent message ordering, floor control, throttle manifest enforcement, violation → auto-mute escalation. |
| M9 | All of M8 plus: inference session with rate card, signed cumulative billing in Merkle leaves, buyer-side token count verification, ABORT-BILLING on cap exceeded, push-publish subscription lifecycle. |
| M10 | All of M9 plus: multi-node directory, primary failure with backup promotion, client session migration, relay node assignment separate from directory, data replicated across nodes. |

Every milestone's tests continue running in subsequent milestones. The harness only grows — nothing is replaced.

---

## M0 User Stories

Fully specified stories live in `docs/planning/user-stories/m0/`. The table below is the index.

| ID | Title | Domain | Actor | Priority | Components | Depends on |
|---|---|---|---|---|---|---|
| CELLO-CRYPTO-001 | Ed25519 keypair generation, signing, and verification | Crypto | CLIENT | P0 | crypto | — |
| CELLO-CRYPTO-002 | SHA-256 hashing with domain separation | Crypto | CLIENT | P0 | crypto | — |
| CELLO-MSG-001 | Signed message envelope schema | Message Exchange | CLIENT | P0 | protocol-types | CRYPTO-001, CRYPTO-002 |
| CELLO-NODE-001 | Directory stub: WebSocket relay | Node Operations | DIR | P0 | directory | MSG-001 |
| CELLO-SESSION-001 | Session establishment (no FROST) | Session Lifecycle | CLIENT | P0 | client, directory | MSG-001, NODE-001 |
| CELLO-MSG-002 | Client send/receive with signature verification | Message Exchange | CLIENT | P0 | client, transport | MSG-001, SESSION-001 |
| CELLO-MCP-001 | M0 MCP tool surface | MCP Tool Surface | AGENT | P0 | client | SESSION-001, MSG-002 |

Seven stories, all P0, strict dependency chain. A TDD agent pulls the stories in order, writes failing tests from the acceptance criteria, and implements until green.

---

## Related Documents

- [[protocol-map|CELLO Protocol Map]] — top-level orientation; milestones map to protocol domains
- [[user-story-format|CELLO User Story Format]] — the template all stories follow
- [[day-0-agent-driven-development-plan|Day-0 Agent-Driven Development Plan]] — development methodology, test framework, orchestration approach
- [[end-to-end-flow|CELLO End-to-End Protocol Flow]] — the deep canonical reference stories are derived from
- [[agent-client|CELLO Agent Client Requirements]] — client-side requirements
- [[server-infrastructure|Server Infrastructure Requirements]] — server-side requirements
- [[2026-04-14_1100_cello-mcp-server-tool-surface|CELLO MCP Server Tool Surface]] — the 33 MCP tools; M0 implements a minimal subset
- [[cello-initial-design|CELLO Initial Design]] — original architecture and vision
