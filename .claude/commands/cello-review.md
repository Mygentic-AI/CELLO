---
name: cello-review
description: "Review a completed CELLO story implementation. Pass the story ID: /cello-review CONNPOL-001"
---

# /cello-review

Story implementation reviewer for CELLO. Use this after an implementation agent has finished a story and before committing. This role does NOT write code — it reads, reasons, and reports.

**Argument:** The story ID to review (e.g. `CONNPOL-001`). Required.

---

## Step 1 — Load context

Read in parallel:
- `CONTEXT.md` at the repo root — canonical glossary; any term used differently is a bug
- `docs/planning/user-stories/{milestone}/CELLO-{STORY-ID}.yaml` — the story being reviewed
- The implementation files named in the story's `components` field

If the story depends on other stories (`depends_on`), note which interfaces/types those stories define — the implementation must use them, not reinvent them.

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

- Does the test file define its own `makeFixture()`, `makeE2EFixture()`, `makeFullFixture()`, or any equivalent from-scratch fixture function? If yes: **blocking**. The story must use `SessionFixture` from `packages/test-fixtures/src/session-fixture.ts`.
- Exception: if `packages/test-fixtures/src/session-fixture.ts` does not yet exist (pre-extraction), flag it as [high] and note that the fixture extraction story must be completed before this pattern recurs.
- Exception: lightweight helpers local to the test file (e.g. `waitForStatus`, `buildMinimalPackageCbor`) that are genuinely test-specific are acceptable. The rule targets infrastructure duplication (directory, relay, libp2p node setup), not local assertion helpers.

---

## Step 5 — YAGNI and scope check

- Does the implementation contain code beyond what the story's ACs require?
- Are there abstractions, config options, or error paths that no AC exercises?
- Are there TODO/FIXME comments that indicate deferred implementation in a shipped story?

Flag these as [low] unless they introduce a security surface, in which case [high].

---

## Step 6 — Gate sequence verification

Confirm the implementation agent ran the full Phase C gate sequence:

- [ ] All tests green (`pnpm run test`)
- [ ] Lint clean (`pnpm run lint`) — zero errors in the changed packages
- [ ] Typecheck clean (`pnpm run typecheck`) — zero errors
- [ ] Story ID present in commit message

If any gate was skipped or failed, that is blocking regardless of test results.

---

## Reporting format

Report findings using severity levels:

- **[blocking]** — must be fixed before this story is considered done. AC not covered, SI negative test missing, transport-path assertion missing for integration/e2e protocol ACs, package boundary violation, gate sequence failure.
- **[high]** — security surface, key material leak path, or correctness bug. Must be fixed before the next story begins.
- **[medium]** — code quality, naming, style inconsistency with the rest of the codebase. Fix before milestone close.
- **[low]** — informational. Report to user; does not block.

End your report with one of:
- **APPROVED** — no blocking or high issues; story is done
- **BLOCKED** — list each blocking issue with the file and line number; implementation agent must fix before this story closes
