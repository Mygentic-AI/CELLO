---
name: cello-review
description: "Review a completed CELLO story implementation. Pass the story ID: /cello-review CONNPOL-001"
---

# /cello-review

Story implementation reviewer for CELLO. Use this after an implementation agent has finished a story and before committing. This role does NOT write code — it reads, reasons, and reports.

**Argument:** The story ID to review (e.g. `CONNPOL-001`). Required.

---

## Step 1 — Load context

Read in this order:
1. `docs/planning/user-stories/{milestone}/outline.md` — **read first**. Every user story folder contains an overview document. It defines the milestone scope, dependency graph, and design decisions that individual stories assume as given. A reviewer who skips it will miss the intent behind individual ACs.
2. `.claude/CLAUDE.md` — the system-wide invariants for this project. These are load-bearing regardless of whether the story mentions them. A story about federation transport is subject to the sovereign node and cloud-agnostic constraints even if neither word appears in the story YAML.
3. `CONTEXT.md` at the repo root — canonical glossary; any term used differently is a bug
4. `docs/planning/user-stories/{milestone}/CELLO-{STORY-ID}.yaml` — the story being reviewed
4. The implementation files named in the story's `components` field
5. **For M5+ parallel milestones:** `docs/planning/user-stories/{milestone}/COORDINATION.md` — check if this story's completion unblocks others or if it references migration version numbers from the registry

If the story depends on other stories (`depends_on`), note which interfaces/types those stories define — the implementation must use them, not reinvent them.

**For M4+ stories also read:**
- `docs/planning/discussion_logs/2026-05-16_0753_development-pipeline-and-local-iteration.md` — the canonical event taxonomy and Logger interface. Every log event in the implementation must be checked against the taxonomy in this document.
- `docs/planning/discussion_logs/2026-05-25_1100_m5-retrospective-lessons-learned.md` — M5 operational discipline rules (migration integrity, IaC parity, deployment methodology)

---

## Step 2 — AC coverage check

For every AC in the story:

1. **Find the named test.** Every AC must have a corresponding named test in the test file. The test name should reference the AC ID (e.g. `AC-001`). If no named test exists for an AC, that is a blocking gap.

2. **Verify the test actually exercises the AC.** Read the test body. A test that only checks the return value of a function while the AC claims multi-party network behavior is insufficient — see the transport-path rule below.

3. **For `test_type: integration` or `test_type: e2e` ACs describing a multi-party protocol** (DKG ceremony, FROST rounds, libp2p stream handshake, signaling frame exchange):
   - Ask: *"Would this test pass if `NODE_ENV=test` routed through `bootstrapKeyShares`, a mock adapter, or any in-process stub instead of the real protocol?"*
   - If yes: **blocking**. The test asserts result, not behavior. It must also assert the transport path was used — stream open count, protocol handler invocation, frame count, or equivalent.
   - This is the M2/M3 failure mode. Tests that pass in a single Vitest process tell you nothing about whether the protocol works between separate OS processes.

4. **Verify the structural contract, not just the outcome.** ACs describe both *what* should be produced and *how* it should be produced — the structure of the protocol, not just its result. A correct result achieved through the wrong structure is a failing AC even when the test is green.

   When an AC specifies structural requirements — participant counts, communication topology, independence constraints, ordering, or connectivity patterns — ask: *"Does the implementation exhibit this structure, or does it produce the same output through a structurally different path?"*

   Common failure patterns to look for:
   - **Reduced participant count** — AC says 3 nodes; implementation hardcodes 1. The output shape is identical; the independence property is gone.
   - **Collapsed topology** — AC says each participant communicates directly with every other; implementation routes everything through a single coordinator. Same output; hub-and-spoke instead of peer-to-peer.
   - **Shared state masquerading as independence** — AC says "separate libp2p instances" or "each node verifies independently"; implementation uses in-process objects or a single verification call. Tests pass; the isolation guarantee does not exist.
   - **Sequential substituted for concurrent** — AC implies parallel exchanges (each node contributes simultaneously); implementation serializes through one node. Result is correct; liveness and fault-tolerance properties differ.
   - **Intermediary substituted for direct exchange** — AC says A sends to B and B sends to C; implementation has A send to a relay that forwards to both. Outcome matches; the trust model does not.

   The diagnostic question for protocol structure: *"If one of the participants described in the AC were compromised or unavailable, would the real implementation behave the way the AC implies?"* If the answer differs from what the AC implies — because the structure was quietly collapsed — that is **blocking**.

   A separate but related diagnostic question applies to implementation technology: *"Does this implementation create a dependency that the story's stated guarantees assume does not exist?"*

   This failure is a cross-document consistency failure, not a missing specification. The constraint typically exists — correctly stated somewhere in CLAUDE.md or an earlier discussion log — but it was not restated in the story the implementer read. The implementer found the story self-contained enough to work from, selected the most obvious tool for the task, and never re-read the earlier document. The mechanism chosen may be entirely correct; the violation lives one layer down, in how that mechanism was instantiated.

   *The canonical example:* Postgres logical replication was the right federation mechanism. VPC Peering as the transport for it was not — it makes all nodes AWS-only. The mechanism was correct. The network transport beneath it violated the cloud-agnostic constraint that existed in an April 8 document but was absent from the April 11 document the implementer read.

   When reviewing any story that involves inter-node communication, synchronization, coordination, state sharing, or infrastructure provisioning, check each layer independently against CLAUDE.md invariants:
   - **The mechanism** — is it the right tool?
   - **The transport** — is the network path cloud-agnostic, or does it rely on provider-specific networking (VPC Peering, AWS PrivateLink, GCP VPC sharing)?
   - **The coordination service** — does it require a shared account, shared control plane, or vendor-managed service that couples nodes together?
   - **The operational model** — can the node be operated by a different organization with no relationship to the others?

   A correct mechanism with a violating transport is **blocking** by the same standard as a wrong mechanism. The test suite cannot see this — it must be found by reading the implementation, not the test results.

   If the deviation was intentional (infrastructure not yet deployed, deferred milestone), it must be recorded in the story's `stubs` section with a `replaced_by` milestone. A silent structural mismatch is never acceptable regardless of test results.

5. **When you find a test that is close but insufficient — decide: modify or add?**

   Use this decision rule:

   - **Modify the existing test** when: the existing test is the named test for this AC (its name references the AC ID) but exercises the wrong path. Leaving it alongside a new test creates two tests for the same AC — the hollow one still signals false confidence. Replace the bypass call with the real protocol call.

   - **Add a new test** when: the existing test correctly covers a *different*, narrower AC (unit scope), and the integration AC genuinely has no coverage. Both tests are needed; they cover distinct things.

   - **The invariant to preserve:** one authoritative test per AC, and it must exercise what the AC actually claims. If a test is named for AC-006 but routes through a stub, it is not a valid AC-006 test — it must be corrected, not supplemented. A suite with both a hollow "AC-006: passes via stub" and a real "AC-006: network ceremony" has conflicting signals about what done means.

   - **Never leave a hollow test in place alongside a real one** — delete the hollow test when you add the real replacement. Two tests for the same AC with different depth is worse than one correct test.

---

## Step 3 — SI coverage check

For every SI (Security Invariant) in the story:

1. **Find the negative test.** Every SI must have an adversarial test that sets up the `adversarial_condition` and asserts the SI holds.

2. **Check the adversarial condition is real.** A test titled "SI-001: guard is present" that only asserts the guard code exists (rather than actually triggering the adversarial condition and verifying rejection) is hollow. Flag it.

3. **Key invariants to always verify regardless of whether they appear as SIs:**
   - No private key material (`#secretKey`, shares, seeds) leaks into wire messages, logs, or returned objects
   - `NODE_ENV !== 'test'` guards on production paths are not bypassable from test code except through the explicitly designed test injection points
   - Invalid inputs are rejected before any side effects occur

---

## Step 4 — Package boundary check

- Does the implementation import from packages it should not? Check `CONTEXT.md` for the allowed dependency graph.
- Does `@cello/test-fixtures` appear in `dependencies` or `peerDependencies` of any production package? That is always blocking.
- Does any production package import from a `__tests__` directory or a test-only file?

## Step 4b — Test fixture discipline check

- Does the test file define its own `makeFixture()`, `makeE2EFixture()`, `makeFullFixture()`, or any equivalent from-scratch fixture function that sets up relay/directory/libp2p nodes? If yes: **blocking**. The test must import `createSessionFixture` from `packages/e2e-tests/src/session-fixture.ts`.
- Exception: lightweight helpers local to the test file (e.g. `waitForStatus`, `buildMinimalPackageCbor`) that are genuinely test-specific are acceptable. The rule targets infrastructure duplication (relay, directory, libp2p node setup), not local assertion utilities.
- Exception: relay-only tests (no directory, no agent nodes) may define a small local relay setup if the story genuinely does not need the full stack.

**What a correct import looks like:**
```typescript
// from packages/e2e-tests/src/__tests__/
import { createSessionFixture } from "../session-fixture.js";

const fix = await createSessionFixture({ withMcp: true });
fix.directory.registerThresholdSigner(fix.agentA.pubkeyHex, fix.signerA);
scope.addCleanup(fix.stopAll);
```

**If the story needs infrastructure the fixture doesn't support:** the implementer must have added a new `opts` field to `session-fixture.ts` with a default that doesn't break existing tests. Verify the fixture file was extended, not copied.

---

## Step 4c — Observability implementation check (M4+)

For every observability AC in the story, verify the implementation:

1. **Event name matches exactly.** If the AC specifies `session.started`, the implementation must call `logger.info("session.started", ...)` — not `logger.info("session_started", ...)` or `logger.info("SessionStarted", ...)`. Name drift is a blocking issue.

2. **Required context fields are present.** If the AC specifies `{ sessionId, agentId, relayId }`, all three must appear in the context object passed to the Logger. Missing fields are blocking.

3. **Logger interface is used, not console.** Any `console.log`, `console.error`, or `console.warn` in implementation code (not tests) is blocking for M4+ stories. All output must go through the injected `Logger` interface.

4. **correlationId is threaded.** For any AC asserting correlationId threading across an async/multi-process flow, verify: the correlationId is minted once at flow initiation, passed through every async call in the flow, and appears on every log event in the flow. A flow that logs a correlationId on entry but drops it mid-flow fails this check.

5. **Error paths are covered.** Every error path that has an observability AC must have a corresponding log call with the correct event name and context fields. An empty `catch` block or a `catch` that only rethrows without logging is blocking.

6. **No ad-hoc event names.** Event names not in the story's observability ACs and not in the canonical event taxonomy are flagged [medium] — they should be added to the taxonomy, not silently used.

**The key verification question for each log call:** *"If this service crashes immediately after this log line, would the on-call engineer have enough information to diagnose the problem without SSH access?"* If no — the context fields are insufficient.

---

## Step 5 — Code discipline check

**Scope (YAGNI):**
- Does the implementation contain code beyond what the story's ACs require? Flag [low] unless it introduces a security surface.
- Are there abstractions, config options, or error paths that no AC exercises? Flag [low].
- TODO/FIXME comments indicating deferred implementation in a shipped story? Flag [medium].

**Simplicity:**
- Could any function or module be materially shorter without losing correctness? Flag [medium].
- Are there abstractions that exist for a single call site? Flag [medium].
- Are there speculative generalisations ("we might need this later")? Flag [low].

**Surgical changes:**
- Do the changed lines trace directly to the story's ACs? Lines that don't — reformatting, unrelated refactors, style fixes — are scope violations. Flag [medium].
- Did the implementation create orphans (unused imports, variables, functions made unused by this change) and leave them in place? Flag [medium].
- Did the implementation remove or rewrite pre-existing code that the story did not require touching? Flag [medium] unless it fixes a security issue.

---

## Step 6 — Gate sequence verification

Confirm the implementation agent ran the full Phase C gate sequence:

- [ ] All tests green (`pnpm run test`)
- [ ] Lint clean (`pnpm run lint`) — zero errors in the changed packages
- [ ] Typecheck clean (`pnpm run typecheck`) — zero errors
- [ ] Story ID present in commit message
- [ ] **(M4+)** Observability implementation check passed (Step 4c)
- [ ] **(M4+ stories touching Postgres)** Integration tests ran with `CELLO_ENV=local` — not skipped
- [ ] **(M5+ migration stories)** Integration gate AC passed — migrations applied to PostgreSQL instance with all prior migrations already applied, zero Flyway checksum errors
- [ ] **(M5+ infrastructure stories)** `infra/STATE.md` updated with any deployed stacks, modified resources, or AWS changes

**Integration test verification (M4+ stories touching any Postgres-backed path):**

If the story touches `PgDirectoryStore`, any Flyway migration, or any `DirectoryStore` method that reads/writes Postgres:

1. Check the test output for `describeIntegration` blocks. If any appear as `skipped`, the gate was run without `CELLO_ENV=local` — this is **blocking**. The implementer must rerun with `CELLO_ENV=local DATABASE_URL=... pnpm --filter <package> run test -- ...`.
2. Verify the integration tests actually passed (not just ran). A `describeIntegration` block that runs but fails is also blocking.
3. **A test suite that reports 0 skipped but contains `describeIntegration` blocks is suspicious** — check that the blocks actually exist and ran; don't assume skipped=0 means integration tests executed.

If any gate was skipped or failed, that is blocking regardless of test results.

**Reactive fix check:**

If any commit in this story's history touches production code outside a story-driven change (a hotfix, live-session fix, or quick patch), verify it has a corresponding test. A production code change with no test is a **blocking** finding. See the canonical examples: CONNREQ-002, REG-001, PERSIST-020 wiring fix, encodeConnectionRequestError field inclusion.

---

## Step 7 — M5+ migration and infrastructure checks

**For stories that add or modify database migrations:**
- [ ] Does the story include a blocking integration gate AC that applies migrations to a PostgreSQL instance with all prior migrations already applied (not fresh)?
- [ ] Does the integration gate AC verify zero Flyway checksum errors?
- [ ] If this is a parallel milestone with database work, is the migration version number listed in the Migration Version Registry in COORDINATION.md?
- [ ] Does the migration file include idempotent guards (CREATE TABLE IF NOT EXISTS, DO $$ BEGIN IF NOT EXISTS)?
- [ ] For stories that add new tables: does the Architecture phase reasoning cover all operations, uniqueness constraints, indexes, foreign keys, and RLS policies — not just this story's immediate needs?

**For stories that deploy infrastructure or modify AWS resources:**
- [ ] Is `infra/STATE.md` updated with deployed stacks, modified resources, or any manual AWS changes?
- [ ] If the story involved a manual AWS fix followed by an IaC update, does the fix pass the region-expansion test: "would this work in a brand-new region with zero manual steps?"
- [ ] If the story deploys ECS services behind an ALB, does it use custom `rolloutState` poll loops instead of `aws ecs wait services-stable` (which has a hard 10-minute timeout)?

---

## Reporting format

Report findings using severity levels:

- **[blocking]** — must be fixed before this story is considered done. AC not covered, SI negative test missing, transport-path assertion missing for integration/e2e protocol ACs, package boundary violation, gate sequence failure. For M4+ stories: observability event name mismatch, missing required context fields, `console.log` in implementation code, dropped correlationId. For M5+ migration stories: integration gate AC missing or Flyway checksum errors present. For M5+ infrastructure stories: STATE.md not updated.
- **[high]** — security surface, key material leak path, or correctness bug. Must be fixed before the next story begins.
- **[medium]** — code quality, naming, style inconsistency with the rest of the codebase. Fix before milestone close.
- **[low]** — informational. Report to user; does not block.

End your report with one of:
- **APPROVED** — no blocking or high issues; story is done
- **BLOCKED** — list each blocking issue with the file and line number; implementation agent must fix before this story closes
