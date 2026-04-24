---
name: Day-0 Agent-Driven Development Plan
type: plan
date: 2026-04-24
topics: [SPARC, TDD, development-plan, testing, MCP, integration-testing, cryptography, claude-code, ruflo]
status: active
description: How CELLO is built — SPARC methodology, parallel agent orchestration via Claude Code, Ruflo testing framework and memory, cryptographic correctness rules, and integration testing strategy from unit tests through real agent integration.
---

# Day-0 Agent-Driven Development Plan

**Project:** CELLO — Collaborative Execution: Local, Linked Operations
**Date:** 2026-04-24

---

## Overview

CELLO is built using AI agent orchestration as the primary development instrument. The execution environment is Claude Code with parallel agents dispatched via the Agent tool and isolated in git worktrees. The development methodology is SPARC (Specification → Pseudocode → Architecture → Refinement → Completion). The test framework is `@claude-flow/testing` from [Ruflo](https://github.com/ruvnet/ruflo), providing London School TDD patterns, Vitest integration, and performance assertions. Persistent decision memory is available via Ruflo's MCP server as a sidecar.

This is not incidental. CELLO is trust infrastructure for agent-to-agent communication, built by agents. The development methodology and the product are the same idea.

---

## Development Methodology: SPARC

Every milestone goes through five phases. The phases are a discipline, not a tool — they structure how work is approached regardless of what executes it.

### S — Specification

Define requirements as user stories in the [[user-story-format|CELLO User Story Format]]: EARS behaviors, acceptance criteria with Given/When/Then, security invariants with adversarial conditions, and degraded behaviors with fallback specifications. Every criterion maps 1:1 to a test case. The specification is complete when a TDD agent can read it and write failing tests directly.

### P — Pseudocode

Before coding, each major component gets high-level pseudocode reviewed against the spec. This catches structural problems before they become debugging sessions. For cryptographic components, the pseudocode must reference the specific RFC or NIST publication that defines the algorithm.

### A — Architecture

Interface definitions, package boundaries, type signatures. This is where the monorepo package structure solidifies for the milestone's components. Key decisions are stored in persistent memory (Ruflo MCP or vault) so subsequent milestones don't relitigate them.

### R — Refinement

Implementation via TDD. This is where Claude Code's parallelism kicks in — independent work streams dispatch as parallel agents with worktree isolation. Each agent works red/green/refactor against the acceptance criteria from the Specification phase. Crypto-touching code gets strict coverage: every acceptance criterion and security invariant has a passing test, no exceptions.

### C — Completion

Integration pass. The e2e test harness runs the full flow for the milestone. Performance assertions verify targets. Any decisions made during refinement are persisted. The Definition of Done from the user story format is enforced: every AC has a test, every SI has a negative test, every DB has a failure-condition test.

---

## Parallel Agent Orchestration

Claude Code's Agent tool dispatches parallel work streams within a milestone. Each agent runs in a git worktree — full isolation, no merge conflicts during development, clean integration at the end.

### Domain-Specific Agents

Work streams are organized by domain, not by layer. A milestone that touches crypto, directory, and client code dispatches three parallel agents — one per domain — rather than doing all crypto first, then all directory, then all client.

| Domain | Capabilities | Typical scope |
|---|---|---|
| Crypto | Ed25519, SHA-256, FROST, Merkle trees, key management | `packages/crypto` |
| Protocol | Message envelopes, session lifecycle, connection flow | `packages/protocol-types`, `packages/client` |
| Directory | WebSocket server, hash relay, sequence numbering, stores | `packages/directory` |
| Relay | Session-level Merkle engine, NAT traversal, circuit relay | `packages/relay` |
| Security | Sanitization pipeline, DeBERTa scanner, redaction, governance | `packages/client` (scanning layers) |
| E2E | Test harness, integration tests, multi-component flows | `packages/e2e-tests` |

### Orchestration Rules

- Independent work streams run in parallel. Dependent work runs sequentially.
- Each agent's scope must be completable and testable in isolation before integration.
- The E2E agent runs last — it wires together what the domain agents built and runs the harness.
- If two agents need the same package, one owns it and the other waits or works against the existing interface.

---

## Test Framework

The test foundation is `@claude-flow/testing` from Ruflo, adapted for CELLO's domain. What we adopt:

| From `@claude-flow/testing` | How CELLO uses it |
|---|---|
| `setupV3Tests()` | Global Vitest configuration |
| `createTestScope()` | Isolated test contexts with automatic cleanup |
| `waitFor()`, `retry()`, `withTimeout()` | Async utilities for e2e tests involving WebSocket, P2P |
| `measureTime()`, `assertV3PerformanceTargets()` | Performance assertions on crypto operations |
| `createMockEventBus()`, `createTestEmitter()` | Event-driven testing for notifications, session events |
| London School TDD patterns | Behavior verification, not implementation testing |

What we write ourselves — CELLO-specific fixtures:

| Fixture | What it provides |
|---|---|
| Merkle leaf fixtures | Valid/tampered/missing-field leaves for tree tests |
| Session envelope fixtures | FROST ceremony messages, session establishment/seal payloads |
| Connection request fixtures | Trust profiles, policy configurations, endorsement sets |
| Injection payload fixtures | Known attack patterns for each defense layer |
| Agent identity fixtures | Keypairs, trust signal sets, registration records |

### Test Tiers

| Tier | What it tests | Speed | When it runs |
|---|---|---|---|
| Unit | Crypto primitives, Merkle math, sanitization, individual components | < 1s | Every save |
| Integration | Multi-component flows within a package, store interface compliance | < 10s | Pre-commit |
| E2E | Full protocol flows: directory + relay + two clients in-process | < 60s | Pre-push, CI |

---

## Persistent Decision Memory

Architectural decisions accumulate across sessions. Two complementary systems:

**The vault** (human-readable): Design documents, discussion logs, the protocol map. This is the authoritative record. Decisions are captured in discussion logs with full context and rationale.

**Ruflo MCP memory** (machine-queryable, optional): Key-value store with vector search via HNSW indexing. Useful for quick lookups during coding sessions — "what did we decide about Merkle leaf format?" — without reading entire documents. Complements the vault; does not replace it. The vault remains authoritative.

The binary installed by the `claude-flow` npm package is `claude-flow` (Ruflo is the project name; `claude-flow` is the CLI). Memory operations are exposed both as CLI commands and as MCP tools (`memory_store`, `memory_search`) callable from within an agent session.

```bash
# Store a decision
claude-flow memory store -k "merkle-leaf-format" \
  -v "RFC 6962, domain separation 0x00/0x01, SHA-256" \
  -n cello-architecture

# Semantic search during a session
claude-flow memory search -q "leaf format" -n cello-architecture
```

---

## Cryptographic Correctness

This codebase is security infrastructure. A subtle mistake in a Merkle tree or key derivation routine isn't a bug — it's a vulnerability.

### Library Choices (TypeScript)

- **Ed25519 signing**: `@noble/ed25519` — audited, pure JS, no native deps, constant-time
- **Hashing (SHA-256)**: `@noble/hashes` — same family, same audit guarantees
- **FROST threshold signatures**: production path is the Rust `frost` reference implementation (Zcash Foundation) exposed via a thin TypeScript binding. Pure-JS options (`@frosts/ed25519`, `@frosts/ristretto255`) exist and cite RFC 9591, but are explicitly experimental and not independently audited — acceptable for prototyping only. All FROST code must reference RFC 9591, not the superseded `draft-irtf-cfrg-frost` draft.
- **Symmetric operations (AES-GCM, ChaCha20-Poly1305)**: Node.js `crypto` module — FIPS-compliant, battle-tested
- **Avoid**: Crypto-JS (known vulnerabilities), any unaudited npm packages for core crypto

### Library Choices (Rust — future)

When the directory migrates to Rust:
- RustCrypto (`aes-gcm`, `chacha20poly1305`, `sha2`, `ed25519-dalek`) — pure Rust, modular, constant-time, actively audited
- `ring` for performance-critical paths (HKDF, ECDSA, Ed25519 where throughput matters)
- `zeroize` for secret wiping, `secrecy` for type-safe secret handling

### Canonical Sources for Verification

Agents must not resolve cryptographic implementation questions from training data. The authoritative sources are:

| What to verify | Source |
|---|---|
| Algorithm correctness | NIST test vectors via NIST/CMVP sites |
| Library usage | Official library docs — `@noble` GitHub, Node.js crypto docs |
| CVEs and known weaknesses | GitHub Advisories, NVD API |
| Protocol flow correctness | [Verifpal](https://verifpal.com) — symbolic protocol analysis |
| FROST threshold signatures | RFC 9591 — *Two-Round Threshold Schnorr Signatures with FROST* |

Any implementation touching Ed25519 signing, Merkle tree construction, threshold key splitting, or hash chaining must reference a named RFC, NIST publication, or library documentation URL in the code or PR. "Works" is not the bar — cryptographically correct is the bar.

### Agent Rules

- Never simplify or shortcut cryptographic code for brevity
- If unsure about a cryptographic detail, stop and flag — do not guess
- No cryptographic operation tested with mocks — real keys, real signing, real verification
- Any code in `packages/crypto/` or touching Merkle trees requires a second agent review for spec compliance, not just functional correctness
- Every crypto function must have test vectors from an authoritative source, not hand-constructed examples

---

## Integration Testing Strategy

Unit tests handle more than people expect. This section covers integration testing — the smallest realistic harness at each stage, and what each stage is actually capable of testing.

### Stage 1 — Unit Tests (no network, no agents)

Crypto primitives, Merkle tree math, Layer 1 deterministic sanitization. All standalone and fast. Attack patterns also belong here — replay attacks, tampered leaves, hash collision attempts, injection payloads — because you can construct all of it synthetically without needing a real session.

### Stage 2 — In-Process E2E (monorepo advantage)

Two CELLO client instances and a directory stub, all running in a single Vitest process. No Docker, no ports, no inter-process coordination. The e2e test package imports client and directory as local packages and wires them together in-memory.

What this tests:
- Full signing and verification pipeline
- Hash relay through the directory
- Merkle tree sync across three parties (sender, receiver, directory)
- Connection request flow with policy evaluation
- Session establishment and close with sealed root comparison

What it can't test: FROST with real K_server distribution (needs multi-node), libp2p NAT traversal (needs real network), WebSocket behavior under real latency.

### Stage 3 — Multi-Process E2E

Directory and relay as separate processes. Clients connect over real WebSockets. This is where you test:

- FROST session establishment and seal with K_server in the loop
- Challenge-response authentication over a real WebSocket
- Compromise detection: failed FROST at session start as a canary for key theft
- Divergent root detection across real network boundaries
- MITM detection via hash relay divergence
- Replay attacks with sequence number enforcement across a live session

### Stage 4 — Real Agent Integration

Agent order is deliberate:

**1. Claude Code (MCP)**
Zero setup — already in the dev environment and MCP-compatible. Proves the MCP path works end-to-end before standing up any separate agent runtime.

**2. OpenClaw**
The market. This is where CELLO needs to work. Testing against OpenClaw means building the TypeScript adapter against the real `defineBundledChannelEntry` plugin interface from day one. If CELLO doesn't work cleanly on OpenClaw, nothing else matters.

**3. Hermes**
Self-learning agent. Hermes can evolve its behavior during a test session and probe in ways you wouldn't think to script manually. For a security protocol, an agent that learns and adapts is a more realistic stress test than scripted tests.

**4. IronClaw**
The security reference implementation. The WASM sandbox means the CELLO channel component is cryptographically isolated from the host — testing here validates the security boundary, not just the protocol. Comes after the protocol is stable.

### What to Avoid

Don't test on all agents simultaneously early on. The combinatorial surface is too large when the protocol is still changing. Lock down the protocol with in-process tests first, prove it on Claude Code MCP second, expand to OpenClaw third.

---

## Related Documents

- [[protocol-map|CELLO Protocol Map]] — top-level orientation for all protocol domains
- [[user-story-format|CELLO User Story Format]] — the specification format used in the SPARC Specification phase
- [[agent-client|CELLO Agent Client Requirements]] — client requirements the test harness must exercise
- [[server-infrastructure|Server Infrastructure Requirements]] — server requirements the directory stub must satisfy
- [[prompt-injection-defense-layers-v2|Prompt Injection Defense Architecture]] — the DeBERTa Layer 2 scanner
- [[00-synthesis|Protocol Review — Synthesis]] — adversarial review findings, all addressed
- [[open-decisions|Open Decisions]] — 12 resolved cryptographic and protocol decisions
