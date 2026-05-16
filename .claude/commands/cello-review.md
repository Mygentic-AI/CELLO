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
2. `CONTEXT.md` at the repo root — canonical glossary; any term used differently is a bug
3. `docs/planning/user-stories/{milestone}/CELLO-{STORY-ID}.yaml` — the story being reviewed
4. The implementation files named in the story's `components` field

If the story depends on other stories (`depends_on`), note which interfaces/types those stories define — the implementation must use them, not reinvent them.

**For M4+ stories also read:**
- `docs/planning/discussion_logs/2026-05-16_0753_development-pipeline-and-local-iteration.md` — the canonical event taxonomy and Logger interface. Every log event in the implementation must be checked against the taxonomy in this document.

---

## Step 2 — AC coverage check

For every AC in the story:

1. **Find the named test.** Every AC must have a corresponding named test in the test file. The test name should reference the AC ID (e.g. `AC-001`). If no named test exists for an AC, that is a blocking gap.

2. **Verify the test actually exercises the AC.** Read the test body. A test that only checks the return value of a function while the AC claims multi-party network behavior is insufficient — see the transport-path rule below.

3. **For `test_type: integration` or `test_type: e2e` ACs describing a multi-party protocol** (DKG ceremony, FROST rounds, libp2p stream handshake, signaling frame exchange):
   - Ask: *"Would this test pass if `NODE_ENV=test` routed through `bootstrapKeyShares`, a mock adapter, or any in-process stub instead of the real protocol?"*
   - If yes: **blocking**. The test asserts result, not behavior. It must also assert the transport path was used — stream open count, protocol handler invocation, frame count, or equivalent.
   - This is the M2/M3 failure mode. Tests that pass in a single Vitest process tell you nothing about whether the protocol works between separate OS processes.

4. **When you find a test that is close but insufficient — decide: modify or add?**

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

If any gate was skipped or failed, that is blocking regardless of test results.

---

## Reporting format

Report findings using severity levels:

- **[blocking]** — must be fixed before this story is considered done. AC not covered, SI negative test missing, transport-path assertion missing for integration/e2e protocol ACs, package boundary violation, gate sequence failure. For M4+ stories: observability event name mismatch, missing required context fields, `console.log` in implementation code, dropped correlationId.
- **[high]** — security surface, key material leak path, or correctness bug. Must be fixed before the next story begins.
- **[medium]** — code quality, naming, style inconsistency with the rest of the codebase. Fix before milestone close.
- **[low]** — informational. Report to user; does not block.

End your report with one of:
- **APPROVED** — no blocking or high issues; story is done
- **BLOCKED** — list each blocking issue with the file and line number; implementation agent must fix before this story closes
