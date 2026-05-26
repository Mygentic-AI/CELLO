---
name: REPOSPLIT Timing — Scaffold Early, Extract Late
type: discussion
date: 2026-05-25
status: active
topics: [reposplit, cello-client, timing, m6, npm-publish, decision]
description: Analysis and confirmed decision on when to split client packages into cello-client. Covers full CELLO context for a new reader, both timing approaches with tradeoffs, and the confirmed hybrid approach — scaffold cello-client immediately, extract packages after M6 client development is complete.
---

# REPOSPLIT Timing — Scaffold Early, Extract Late

## Background: What CELLO Is

CELLO is a trust and identity layer for AI agent communication. When two AI agents want to talk to each other — say, a Claude Code agent owned by one person and a Claude Code agent owned by another — there is currently no way for them to verify who they are talking to, prove that messages were not tampered with, or seal a conversation so that neither party can later deny what was said.

CELLO solves this by giving each agent a cryptographic identity, routing messages through a tamper-evident log (a Merkle tree), and using a threshold signing scheme (FROST) that splits the agent's signing key between the agent's own machine and a cluster of directory servers. No single party holds the full key. Messages are signed by the agent. The conversation record is cryptographically sealed.

The system has three kinds of participants:

- **The agent operator** — a person running an AI agent (e.g. Claude Code). They install a small client on their machine. The client handles all the cryptography.
- **The directory** — a cluster of servers that handle identity registration, session establishment, and cryptographic ceremonies. Operated by Mygentic.
- **The relay** — a server that routes messages and maintains the Merkle tree for each active conversation. Operated by Mygentic.

The agent operator never needs to run the directory or relay. They only install the client.

---

## The Codebase Today

Everything lives in a single monorepo called `trustless-cello`. The relevant packages are:

**Client packages — what the agent operator needs:**
- `protocol-types` — wire format type definitions
- `crypto` — Ed25519 signing, SHA-256, FROST threshold signing
- `transport` — libp2p peer-to-peer networking
- `client` — the protocol core: all MCP tools, the session state machine, the Merkle engine
- `adapter-claude-code` — the Claude Code adapter: wires the client to Claude Code via the MCP protocol, exposes tools like `cello_send`, `cello_receive`, `cello_register`

**Server packages — what Mygentic operates:**
- `directory` — the directory node implementation
- `relay` — the relay node implementation
- `e2e-tests` — the integration test harness (requires both directory and relay running in-process)

All nine packages live in one pnpm workspace. Developers can run the full system — client, directory, relay — from a single repository checkout. Integration tests spin up real directory and relay nodes in the same process as the tests.

---

## What the Split Is

The plan is to extract the five client packages into a separate public repository called `cello-client` (`github.com/Mygentic-AI/cello-client`). The client packages publish to npm as `@cello-protocol/connect`. An agent operator installs the client with:

```
claude mcp add cello npx @cello-protocol/connect
```

The server packages (`directory`, `relay`, `e2e-tests`) remain in `trustless-cello`, which stays private.

After the split, `trustless-cello`'s server packages resolve the client packages from npm rather than the local workspace. The two repos are separate codebases with a versioned dependency between them.

---

## Why the Split Has to Happen At All

The goal for M6 is that a stranger — someone who read about CELLO online — can install the client, register their agent, and start communicating. That requires publishing to npm. The entire client package chain must be publishable.

The client packages cannot remain in `trustless-cello` and be published from there, because `trustless-cello` contains the server code, IaC templates, and deployment infrastructure. Publishing from the monorepo would mean anyone who installed `@cello-protocol/connect` could inspect the server implementation, the CloudFormation templates, and the deployment scripts. This would hand attackers a detailed map of the infrastructure and a sandbox to test attacks against.

The security rationale for the split is simple: open-source the client (the agent operator's code, which they should be able to audit), keep the server private (the network infrastructure, which attackers should not be able to clone and study).

The split is therefore not optional. The only question is when.

---

## The Timing Decision

The `cello-client` repository already exists as a blank slate — a placeholder with README files and no code. The question is: at what point during M6 development do we copy the client packages over and begin working from `cello-client` as the home for client code?

There are two approaches.

### Approach A: Split Early

Do the extraction now, at the start of M6, before any new M6 client features are written. All M6 client development happens in `cello-client`. The monorepo's server packages update to consume `@cello-protocol/connect` from npm.

**Arguments for:**

- Forces all M6 design and development to happen against the real install experience. If `cello_register` is built in `cello-client` from day one, the developer is always working in the context a real operator would use.
- The split never gets harder than it is right now. There is no accumulated technical debt to untangle later.
- The published package is real from day one of M6, not a last-minute step.

**Arguments against:**

- M6 adds significant new behavior to the client packages: `cello_register`, the pre-authorization token flow, the FROST DKG registration ceremony. These features need to be tested end-to-end against real directory and relay nodes — which live in `trustless-cello`. Once the client lives in `cello-client`, every end-to-end test requires either a cross-repo `pnpm link` setup or a publish-and-install cycle. Neither is frictionless.
- You are extracting a moving target. The client API will change during M6 as registration is implemented. Managing those changes across two repos adds overhead at the moment the development velocity needs to be highest.
- If an integration test fails in `trustless-cello`, the developer must trace the failure back through a version boundary to code in `cello-client`. Context continuity breaks.

### Approach B: Split Late

Do the `cello-client` scaffolding now (repo setup, CI pipeline, GitHub Actions), but leave the actual package extraction until after M6 client development is complete. All M6 client code is written and tested in `trustless-cello`. The extraction happens as a final step once the code is stable.

**Arguments for:**

- All M6 development stays in one repo. Integration tests, directory, relay, and client are all local. No cross-repo friction during the period of most active development.
- The extraction is a one-time operation on a stable snapshot rather than an ongoing sync problem.
- Scaffolding work (CI design, AUDIT-ME.md, README) is genuinely parallelizable and produces real value early without creating a development friction problem.

**Arguments against:**

- The published package arrives later. If anything about the extraction turns out to be harder than expected, it compresses the end of the M6 timeline.
- M6 development happens in the monorepo, which means it is designed against a monorepo experience rather than the real operator install experience. There is a risk of subtle assumptions that only surface when the real install is tested.

---

## The Conclusion: Scaffold Early, Extract Late

The recommended approach is a hybrid:

**Do immediately:**
- Set up `cello-client` repo structure (`pnpm-workspace.yaml`, root `tsconfig`, `vitest.workspace.ts`)
- Wire GitHub Actions CI (build → typecheck → test → tarball check → publish on tag)
- Write `AUDIT-ME.md` and `README.md`
- Fix the one prerequisite in `trustless-cello` (remove stale tsconfig references in `adapter-claude-code`)

This work is genuinely independent. It proves the CI pipeline works, clears the npm publish path, and produces the operator-facing documentation — none of which requires any client code to have moved yet.

**Do after M6 client development is complete:**
- Extract the five packages from `trustless-cello` into `cello-client/core/`
- Move the 14 clean tests; leave the 12 integration tests in `trustless-cello`
- Apply the structural changes (package rename, files allowlist, SKILL.md)
- Verify `tsc --build`, `pnpm test`, and tarball checks all pass
- Publish `@cello-protocol/connect@beta`
- Update `trustless-cello` to resolve client packages from npm

The dependency graph position of REPOSPLIT-001 in the M6 story sequence does not change. DEMO-001 and M6-E2E-001 still wait on the publish. What changes is the internal execution order within REPOSPLIT-001: scaffolding runs in parallel with OPS-AGENT-000 from day one; extraction runs after the M6 client changes (`cello_register` and the registration flow) are merged.

---

## Decision — Confirmed (2026-05-25)

**Scaffold early, extract late. Confirmed.**

**Do now:**
- Set up `cello-client` repo structure and GitHub Actions CI pipeline
- Write `AUDIT-ME.md` and SKILL.md
- Fix the stale tsconfig references in `adapter-claude-code` in `trustless-cello`

**Do after M6 client development is complete:**
- Extract the five client packages from `trustless-cello` into `cello-client`
- Publish `@cello-protocol/connect@beta`
- Update `trustless-cello` to resolve client packages from npm

**Rationale:**

Early extraction introduces cross-repo dependency complexity — version boundaries, pnpm link friction, cross-repo integration test debugging — on top of an already high-density milestone. M5 demonstrated that even well-understood infrastructure work generates significantly more friction than anticipated. M6 is more complex. Adding a new structural problem class during active development is the wrong call.

The scaffolding work is genuinely valuable independent of extraction timing for two reasons: it clears the npm publish path early so extraction isn't a surprise when it lands on the critical path, and — critically — `AUDIT-ME.md` and SKILL.md become living artifacts refined by M6 development as it happens. Developers can read them, notice where assumptions don't match actual decisions, and update accordingly. By the time extraction occurs, the documentation reflects the real implementation rather than needing to be reconstructed after the fact.
