---
name: cello-sprint
description: "Load implementation context for a specific milestone. Pass the milestone as argument: /cello-sprint M3"
---

# /cello-sprint

Implementation briefing for a CELLO milestone. Use this at the start of a session where the goal is to write code — not design.

**Argument:** The target milestone (e.g. `M3`). Defaults to the highest milestone directory in `docs/planning/user-stories/` if omitted.

## Step 1 — Determine target milestone

The target milestone is: `$ARGUMENTS` (if blank, list directories in `docs/planning/user-stories/` and use the highest).

Set `$MILESTONE` to the lowercase form (e.g. `m3`).

## Step 2 — Read the glossary

Read `CONTEXT.md` at the repo root. This is the canonical glossary — terms, packages, interfaces. Do not contradict it.

## Step 2b — For M4+ milestones: load adapter and observability context

If the target milestone is M4 or later, read these before touching any story:

1. **`docs/planning/discussion_logs/2026-05-16_0753_development-pipeline-and-local-iteration.md`** — the adapter inventory, Logger interface, event taxonomy seed, environment wiring decisions, and composition root pattern. Every external dependency in M4+ stories is behind an interface defined here. An implementer who hasn't read this will reinvent interfaces that already exist or wire adapters incorrectly.

2. **`packages/interfaces/`** — the canonical location for all shared interfaces. Read the files that correspond to the story being implemented. Do not define interfaces inline in implementation packages — they belong here.

Key facts every M4+ implementer must know before starting:

- **All external dependencies are behind interfaces.** `DirectoryStore`, `ClientStore`, `RelayWal`, `EnvelopeKeyProvider`, `Logger`, `JobScheduler`, `MessagingChannel`, `OtpDeliveryProvider`, `AuditLogShipper` — all have local stubs in `packages/interfaces/stubs/` and production implementations separately. Never hardcode a real AWS call in application code.
- **Composition root is `server.ts`.** Adapter selection is driven by `CELLO_ENV`. No magic injection, no framework. The app fails at startup with a clear error if any required adapter configuration is missing.
- **`EnvelopeKeyProvider` ≠ `SigningKeyProvider`.** `EnvelopeKeyProvider` is the KMS interface for encrypting K_server_X shares at rest (introduced M4). `SigningKeyProvider` is the client-side Ed25519 interface (introduced M0). These must not be confused or merged.
- **Logger is injected, never imported directly.** No `console.log` in implementation code. Events use the `domain.noun.verb` taxonomy. The correlation ID is minted once per flow and threaded through every async call.
- **Local Postgres via Docker Compose, not mocked.** RLS, pgaudit, and hash chain constraints are database-level constructs. A mock database cannot catch a broken RLS policy.
- **`CELLO_ENV=local`** uses Docker Compose + all local stubs. **`CELLO_ENV=cloud`** uses real AWS services with dev KMS key, isolated from production data.

## Step 3 — Read prior milestone writeups

Read every file in `docs/planning/milestone-writeups/` **except** files for the target milestone or later. These tell you what is already built and proven in production.

For each writeup, note:
- What infrastructure exists (relay, directory, client capabilities)
- What protocols are implemented and tested end-to-end
- What bugs were found during live smoke testing (so you don't reintroduce them)

## Step 4 — Read all stories for the target milestone

Read every `.yaml` file in `docs/planning/user-stories/$MILESTONE/`.

For each story, note:
- Its dependencies (which stories must be done first)
- Its `test_type: e2e` ACs (these define what the live smoke test must prove)
- Its `notes` field (contains process constraints like "separate OS processes")

**Pay special attention to the E2E story** (e.g. `CELLO-E2E-004.yaml`). This is the milestone close gate — the thing that must pass for the milestone to ship. Every other story exists to make it possible.

## Step 5 — Recent commits

Run: `git log --oneline -20`

This tells you what's been implemented recently. Map commits to stories where possible.

## Step 6 — Synthesize and report

Provide a briefing structured as:

### What's already built (prior milestones)
One paragraph per milestone. What was proved. What infrastructure exists.

### Target milestone: $MILESTONE
- **Close gate:** What the E2E story requires (the finish line)
- **Stories and dependencies:** A dependency-ordered list showing which stories can be worked in parallel and which are blocked
- **What's done vs. what's remaining:** Based on git history, which stories appear implemented and which are still TODO

### Implementation constraints
- SPARC methodology: Spec → Pseudocode → Architecture → Refinement (red-first TDD) → Completion (gate sequence)
- Every AC maps 1:1 to a test. Every SI maps to a negative test.
- `test_type: e2e` means separate OS processes over real networks — not in-process instances
- No milestone closes without the live multi-process smoke test passing
- Phase C gate sequence: tests → lint → typecheck → build → code review → commit
- **Test fixture discipline:** never write a new `makeFixture()` from scratch. Import `createSessionFixture` from `packages/e2e-tests/src/session-fixture.ts`. If the story needs a new capability, add an `opts` parameter to the shared fixture. This is enforced by `cello-review` — a from-scratch fixture is a blocking finding.

**M4+ additional constraints:**
- **Adapter pattern is mandatory.** Every external dependency goes through the interface in `packages/interfaces/`. Never call AWS directly from application code. The interface boundary must be narrow — add to an interface only in response to a specific failing test or production behavior being implemented right now.
- **Observability ACs are first-class.** Every story has named log events, required context fields, and correlationId threading for async flows. `/cello-review` Step 4c will verify implementation matches ACs exactly. `console.log` in implementation code is a blocking finding.
- **Interface names are precise.** `EnvelopeKeyProvider` encrypts K_server_X shares (KMS, M4). `SigningKeyProvider` signs with Ed25519 (client-side, M0). Using the wrong one is a type error and a security error.
- **Smoke test definition grows with each milestone.** The M4 smoke test minimum: migrations applied cleanly, app starts, basic authenticated request succeeds, `EnvelopeKeyProvider` encrypt/decrypt roundtrip works. Add to the milestone close gate, do not replace it.

### Using the shared fixture

**Canonical import** (from `packages/e2e-tests/src/__tests__/`):
```typescript
import { createSessionFixture } from "../session-fixture.js";
```

**Opts — pick the combination that matches the story:**

| Scenario | Opts |
|---|---|
| Basic session initiation (M1) | `createSessionFixture()` |
| Session + MCP tool surface | `{ withMcp: true }` |
| B also initiates sessions | `{ bootstrapB: true }` |
| Network-wire relay protocol (NODE-004) | `{ networkRelay: true }` |
| Connection request flow (M3) | `{ register: true, policyA?, policyB? }` |
| Connection gate (SESSION-006) | `{ register: true, requireConnectionGate: true }` |
| Require registration on directory | `{ requireRegistration: true }` |
| Round-2 disclosure timeout | `{ register: true, round2TimeoutMs: N }` |
| Track B's evaluate call count | `{ register: true, trackEvaluateCount: true }` |
| B accepts a pubkey without policy | `{ register: true, whitelist: [pubkeyHex] }` |

**Result shape:**
```typescript
fix.directory          // CelloDirectoryNode — call registerThresholdSigner, registerPeerInfo, etc.
fix.dirStore           // InMemoryDirectoryStore — inspect hasConnection, getConnection
fix.dirPeerId / fix.dirMultiaddrs
fix.relay              // CelloRelayNode — call recordAssignment directly if needed
fix.relayPeerId / fix.relayMultiaddrs
fix.agentA.client      // CelloClient
fix.agentA.kp          // keypair
fix.agentA.pubkey      // Uint8Array
fix.agentA.pubkeyHex   // hex string
fix.agentA.primaryPubkey  // set when opts.register: true
fix.agentA.mcp         // MCP Client — set when opts.withMcp: true
fix.agentA.notifications  // Notification[] — set when opts.withMcp: true
fix.agentB             // same shape as agentA
fix.signerA            // FrostThresholdSigner (always present)
fix.signerB            // set when opts.bootstrapB: true
fix.stopAll()          // call in scope.addCleanup
```

**Standard test scaffold:**
```typescript
afterEach(() => {
  clearTestShares();          // always — FROST shares are process-global
  return scope.run(async () => {});
});

it("...", async () => {
  const fix = await createSessionFixture({ withMcp: true });
  fix.directory.registerThresholdSigner(fix.agentA.pubkeyHex, fix.signerA);
  scope.addCleanup(fix.stopAll);
  // ... test body
});
```

**Extending the fixture:** if a story needs something the fixture doesn't cover, add an `opts` field with a default that doesn't break existing tests. Do not copy-paste the fixture code into the test file.

### Ready to pick up
Which story (or stories, if parallelizable) should be implemented next, based on dependency order and what's already done.

---

Keep the briefing to 2 screens. The goal is to orient an implementer, not to reproduce the stories verbatim.
