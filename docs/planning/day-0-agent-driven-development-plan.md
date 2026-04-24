---
name: Day-0 Agent-Driven Development Plan
type: plan
date: 2026-04-07
topics: [claude-flow, development-plan, testing, MCP, SDK, integration-testing, cryptography, SPARC, TDD]
status: active
description: How to build CELLO using Claude-Flow multi-agent orchestration — CLAUDE.md templates, hive-mind architecture, SPARC TDD phases, cryptographic correctness rules, integration testing strategy.
---

# Day-0 Agent-Driven Development Plan

**Project:** CELLO — Collaborative Execution: Local, Linked Operations
**Date:** 2026-04-07
**Status:** Pre-implementation / Kick-off

---

## Overview

CELLO is being built using AI agent orchestration as the primary development instrument. We're using [Claude-Flow v2.0.0 Alpha](https://github.com/ruvnet/ruflo) — a multi-agent orchestration platform with 64 specialized agents, hive-mind coordination, persistent memory, and a truth verification system that runs real tests.

This is not incidental. CELLO is trust infrastructure for agent-to-agent communication, built by agents. The development methodology and the product are the same idea.

---

## Step 1: CLAUDE.md Template Stack

Claude-Flow templates are `CLAUDE.md` configuration files that tell the agents how to behave inside the project context. CELLO spans security infrastructure, protocol design, distributed systems, and an open-source SDK — no single template covers it. The right approach is to apply a base template and layer in sections from others.

| Template | Why it applies |
|---|---|
| **API Development** | Directory API, WebSocket server, agent registration endpoints |
| **Microservices** | Federated directory nodes, core library + per-adapter repo architecture |
| **TDD** | Truth verification gates on real tests; agents should write tests first |
| **CI/CD** | Supply chain integrity (npm provenance, Sigstore signing) is a product requirement |
| **AI/ML Projects** | DeBERTa prompt injection classifier, agent reliability scoring pipeline |
| **Enterprise** | Federated consortium, private node licenses, multi-org trust boundaries |

```bash
claude-flow templates apply api-development --output CLAUDE.md
# Then manually layer in sections from microservices, TDD, and CI/CD templates
```

---

## Step 2: Hive Mind Architecture Kick-Off

CELLO has a clear layered architecture: SDK → transport → crypto → directory → federation. That's not a peer problem — it's a hierarchy. Use **hierarchical topology** with 8 agents: one queen coordinator plus one agent per major architectural domain.

### Initialize

```bash
# Initialize the project context
claude-flow init --sparc

# Stand up the hive
claude-flow hive init --topology hierarchical --agents 8 --memory-size 1GB
```

### Spawn Domain-Specific Agents

```bash
claude-flow agent spawn architect --capabilities "distributed-systems,merkle-trees,p2p-networking"
claude-flow agent spawn architect --capabilities "cryptography,threshold-signatures,key-management"
claude-flow agent spawn researcher --capabilities "libp2p,noise-protocol,NAT-traversal"
claude-flow agent spawn researcher --capabilities "prompt-injection,ml-classifiers,DeBERTa"
claude-flow agent spawn coder --capabilities "typescript,mcp-protocol,sdk-design"
claude-flow agent spawn coder --capabilities "rust,wasm,wit-interfaces"
claude-flow agent spawn analyst --capabilities "security-analysis,threat-modeling,trust-scoring"
```

### Fire the Architecture Problem

The open questions in `cello-initial-design.md` are the first mandate for the hive — specific, technically hard, multiple independent domains:

```bash
claude-flow orchestrate "Analyze the CELLO trust infrastructure design in docs/planning/cello-initial-design.md and resolve the open questions: (1) threshold cryptography scheme selection — Shamir's secret sharing vs ECDSA threshold signatures, latency impact of multi-node signing; (2) libp2p NAT traversal reliability and fallback strategy when hole punching fails; (3) K_server caching policy — session key lifetime vs security tradeoff; (4) Byzantine fault tolerance minimum consortium size; (5) deterministic ordering of identity Merkle tree operations across nodes — logical clock vs consensus on ordering; (6) checkpoint frequency tradeoff. Each agent attacks their domain independently, then the hive reaches consensus." --agents 8 --parallel
```

### Enable Truth Verification

```bash
# Use moderate threshold for architecture discussions — this isn't code yet
claude-flow verify init moderate
```

---

## Step 3: Persist Decisions to Memory

CELLO's design doc has 12+ open questions. The SQLite memory system accumulates decisions across sessions — agents don't relitigate what's already been resolved.

After each hive run, explicitly store architectural decisions:

```bash
# Example — fill in after hive produces output
claude-flow memory store "threshold-crypto-decision" "<decision and rationale>" --namespace cello-architecture
claude-flow memory store "libp2p-fallback-strategy" "<decision and rationale>" --namespace cello-architecture
claude-flow memory store "consortium-minimum-size" "<decision and rationale>" --namespace cello-architecture

# Recall across sessions
claude-flow memory recall --namespace cello-architecture
```

---

## Step 4: Run the Training Pipeline

After the architecture session, push the system by running the training pipeline on hard complexity. This is where you find out whether agent reliability scores actually improve or whether the self-improvement loop is theater.

```bash
claude-flow train-pipeline run --complexity hard --iterations 5
claude-flow train-pipeline validate
claude-flow train-pipeline status
```

---

## Step 5: SPARC TDD Mode for Implementation

Once architecture is resolved, shift to SPARC TDD mode per CELLO phase. Truth verification moves to strict (0.95) for any code touching crypto primitives or Merkle tree operations.

```bash
# Enable strict verification for implementation
claude-flow verify init strict

# Phase 1: SDK core
claude-flow sparc run tdd "implement CELLO MCP server core: cello_scan_message, cello_register, cello_find_agents, cello_send_message with DeBERTa Layer 2 scanner"

# Phase 1: Directory API
claude-flow sparc run api "implement CELLO directory WebSocket server with challenge-response authentication, hash relay, and append-only log"
```

---

## Order of Operations

| Session | What happens |
|---|---|
| **Session 1** | Apply layered CLAUDE.md (API + microservices + TDD base) |
| **Session 2** | Full hierarchical hive init, 8 agents, fire open questions list |
| **Session 3** | Store all decisions to persistent memory, run training pipeline |
| **Session 4+** | SPARC TDD per phase, truth verification strict on crypto code |

---

## What to Watch For

The truth verification system claims to run actual `npm test`, `npm run typecheck`, and `npm run lint` — not LLM-hallucinated feedback. That's the thing worth stress-testing. Set verification to strict on any code touching the crypto primitives and see whether it catches real failures or passes everything through.

The training pipeline's self-improvement loop is the other claim to pressure-test. Five hard-complexity iterations should produce measurably better agent reliability scores. If the numbers don't move, the loop isn't working.

---

## Cryptographic Correctness in CLAUDE.md

When applying templates, add an explicit cryptographic correctness section. Standard templates don't know this codebase is security infrastructure — a subtle mistake in a Merkle tree or key derivation routine isn't a bug, it's a vulnerability.

### Library Choices

**TypeScript:**
- Use Node.js `crypto` module for symmetric operations (AES-GCM, ChaCha20-Poly1305) and hashing — FIPS-compliant, battle-tested
- Avoid Crypto-JS — known vulnerabilities
- For WASM interop with Rust, compile RustCrypto or `ring` via `wasm-bindgen` to share primitives across the stack

**Rust:**
- RustCrypto (`aes-gcm`, `chacha20poly1305`, `sha2`, `ed25519-dalek`) — pure Rust, modular, constant-time, actively audited. Gold standard.
- `ring` for performance-critical paths (HKDF, ECDSA, Ed25519 where throughput matters) — depends on BoringSSL
- `zeroize` for secret wiping, `secrecy` for type-safe secret handling in multi-tenant contexts

### Canonical Sources for Verification

Agents must not resolve cryptographic implementation questions from training data. The authoritative sources are:

| What to verify | Source |
|---|---|
| Algorithm correctness | NIST test vectors via NIST/CMVP sites |
| Library usage | Official library docs — RustCrypto GitHub examples, Node.js crypto docs |
| CVEs and known weaknesses | GitHub Advisories, NVD API |
| Protocol flow correctness | [Verifpal](https://verifpal.com) — symbolic protocol analysis |

Any implementation touching Ed25519 signing, Merkle tree construction, threshold key splitting, or hash chaining must reference a named RFC, NIST publication, or library documentation URL in the code or PR. "Works" is not the bar — cryptographically correct is the bar.

### Agent Rules for CLAUDE.md

- Never simplify or shortcut cryptographic code for brevity
- If unsure about a cryptographic detail, stop and flag — do not guess
- No cryptographic operation tested with mocks — real keys, real signing, real verification
- Truth verification threshold for any file in `crypto/`, `merkle/`, or `keys/` must be strict (0.95)
- Any code touching cryptographic primitives requires a second agent pass for spec compliance, not just functional correctness

---

## Integration Testing Strategy

Unit tests are straightforward and handle more than people expect. This section is about integration testing — the smallest realistic harness at each stage, and what each stage is actually capable of testing.

### Stage 1 — Unit Tests (no network, no agents)

Crypto primitives, Merkle tree math, Layer 1 deterministic sanitization. All of this is standalone and fast. Attack patterns also belong here — replay attacks, tampered leaves, hash collision attempts, injection payloads — because you can construct all of it synthetically without needing a real session. This stage covers more than it looks like it should.

### Stage 2 — Two MCP Servers

Two CELLO MCP server instances, one as sender, one as receiver. No real directory, no real agents. One server stands in for the directory relay.

What this tests:
- Full signing and verification pipeline
- Hash relay (simulated)
- Merkle tree sync across two parties
- Layer 2 DeBERTa scanner with real message content
- Connection handshake
- The complete SDK behavior in isolation

What it can't test: the 3-party Merkle tree (need a real directory), FROST session establishment and seal (K_server lives on the directory), WebSocket challenge-response auth, libp2p NAT traversal.

### Stage 3 — MCP Servers + Local Directory Stub

Add a lightweight local directory service — WebSocket server, hash relay, append-only log. Phone verification is mocked. Now you have the full 3-party Merkle tree and can test:

- FROST session establishment and seal (K_server in the loop)
- 3-party root comparison — sender, receiver, directory all independently compute and compare
- Compromise detection: failed FROST at session start as a canary for key theft
- Divergent root detection
- Challenge-response authentication over a real WebSocket

Some attack scenarios also need this stage to be meaningful. MITM detection requires a real hash relay to diverge from. Replay attacks need sequence number enforcement across a live session. Injection that passes Layer 1 but trips Layer 2 needs real message context flowing through a real pipeline, not a synthetic stub.

### Stage 4 — Real Agent Integration

Agent order is deliberate:

**1. Claude Code (MCP)**
Zero setup — already in the dev environment and MCP-compatible. Proves the MCP path works end-to-end before standing up any separate agent runtime. Fast feedback loop.

**2. OpenClaw**
The market. This is where CELLO needs to work. Testing against OpenClaw early means building the TypeScript adapter against the real `defineBundledChannelEntry` plugin interface from day one — not retrofitting it later when you discover constraints in the plugin manifest you didn't anticipate. If CELLO doesn't work cleanly on OpenClaw, nothing else matters.

**3. Hermes**
Self-learning agent. The interest here isn't Python — it's adaptivity. Hermes can evolve its behavior during a test session and probe in ways you wouldn't think to script manually. For a security protocol, an agent that learns and adapts is a more realistic stress test than anything written by hand. Use it to discover edge cases OpenClaw won't surface.

**4. IronClaw**
The security reference implementation. The WASM sandbox means the CELLO channel component is cryptographically isolated from the host — testing here validates the security boundary, not just the protocol. Comes after the protocol is stable enough to build the WASM component properly. Iteration cycles are slower here; don't start here.

### What to Avoid

Don't test on all agents simultaneously early on. The combinatorial surface is too large when the protocol is still changing. Lock down the protocol with MCP servers first, prove it on OpenClaw second, then expand.

NanoClaw and ZeroClaw are available but there's no strong reason to prioritize them. They follow naturally once OpenClaw and IronClaw work — the adapters are thin and the hard work is already done.

---

## Related Documents

- [[cello-initial-design|CELLO Design Document]] — architecture, trust chain, open questions this plan addresses
- [[prompt-injection-defense-layers-v2|Prompt Injection Defense Architecture]] — the DeBERTa Layer 2 scanner referenced in Phase 1
- [[00-synthesis|Protocol Review — Synthesis]] — critical findings the hive should resolve first
- [[open-decisions|Open Decisions]] — 12 decisions the hive already resolved
- Claude-Flow wiki: https://github.com/ruvnet/ruflo/wiki
