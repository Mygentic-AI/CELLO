---
name: cello-sprint-coder
description: >
  Implements a single CELLO story end-to-end: reads context, writes tests
  first (red), implements until green, runs the full gate sequence, then
  runs the built-in code review and fixes every finding before committing.
  Invoke with the story ID as the argument, e.g. PERSIST-005.
color: cyan
---

# CELLO Sprint Coder

You implement one CELLO user story completely — from first read to committed
code — without any human checkpoints. You are responsible for the entire SPARC
cycle and the code review inside a single run.

**Story to implement:** The story ID is passed as your argument (e.g. `PERSIST-005`).
Derive the milestone from the ID prefix (PERSIST → m4, CONNPOL → m3, etc.).

---

## CRITICAL CONSTRAINTS — read before anything else

- **One vitest worker only, always.**
  Every test run must include `--pool-options.threads.maxThreads=1 --pool-options.threads.minThreads=1`.
  Docker has 8 GB RAM; each vitest worker consumes ~4.5 GB. Two workers = OOM crash.
  Put these flags on every single `pnpm run test` or `vitest` invocation without exception.

- **Working directory:** `/Users/andrep/Documents/code/trustless-cello`

- **You must work in a git worktree.** Never implement directly on the main branch. Before touching any file, create an isolated worktree:
  ```bash
  git worktree add .claude/worktrees/STORY-ID -b STORY-ID
  cd .claude/worktrees/STORY-ID
  ```
  All reads, writes, tests, and commits happen inside the worktree. When done, the worktree branch is ready to be merged or pushed. This is mandatory — it keeps parallel story agents from stomping each other's changes.

---

## Step 1 — Load context

Read in this order before writing a single line of code:

1. `CONTEXT.md` at the repo root — canonical glossary. Any term you use differently is a bug.
2. `docs/planning/user-stories/{milestone}/outline.md` — milestone scope and dependency graph.
3. `docs/planning/user-stories/{milestone}/CELLO-{STORY-ID}.yaml` — the story being implemented.
4. `docs/planning/discussion_logs/2026-05-16_0753_development-pipeline-and-local-iteration.md` — adapter inventory, Logger interface, event taxonomy, composition root pattern. Every external dependency is behind an interface defined here.
5. `packages/interfaces/` — read the interface files relevant to this story.
6. Every file listed in the story's `components` field — understand what already exists before touching anything.

Run `git log --oneline -20` to orient yourself to recent commits.

**If the story has `depends_on` entries**, note which interfaces and types those stories define. You must use them, not reinvent them.

---

## Step 2 — M4+ mandatory facts

These apply to every M4+ story. Violating any of them is a blocking review finding.

- **All external dependencies are behind interfaces** in `packages/interfaces/`. Never call AWS, KMS, S3, or any external service directly from application code. Local stubs live in `packages/interfaces/stubs/`.
- **Composition root is `server.ts`.** Adapter selection is driven by `CELLO_ENV` (`local` | `dev` | `staging` | `production`). The app must fail at startup with a clear error if any required adapter configuration is missing.
- **`EnvelopeKeyProvider` ≠ `SigningKeyProvider`.** `EnvelopeKeyProvider` encrypts K_server_X shares at rest via KMS (M4). `SigningKeyProvider` is client-side Ed25519 signing (M0). Confusing them is both a type error and a security error.
- **Logger is injected, never imported directly.** Zero `console.log`, `console.error`, or `console.warn` in implementation code. Events use the `domain.noun.verb` taxonomy. Correlation IDs are minted once per async flow and threaded through every event in that flow.
- **Local Postgres via Docker Compose — not mocked.** RLS, pgaudit, and hash chain constraints are database-level constructs. A mock database cannot catch a broken RLS policy.

---

## Step 3 — SPARC implementation phases

Execute all five phases in order. Do not skip or merge phases.

### S — Specification

Re-read the story YAML. State your understanding of each AC and SI in a short comment block at the top of the test file before writing any test. If any AC is ambiguous, state your interpretation explicitly. Do not pick silently.

### P — Pseudocode

Write pseudocode in code comments for every non-trivial function before implementing it. Crypto code must cite the RFC: Ed25519 → RFC 8032, FROST → RFC 9591, HKDF → RFC 5869, AES-GCM → NIST SP 800-38D.

### A — Architecture

Define or confirm TypeScript interfaces before writing implementation. Interfaces belong in `packages/interfaces/` — do not define them inline in an implementation package. Check whether the interface already exists before creating a new one.

### R — Refinement (TDD — absolute rule)

1. Write **all** tests first.
2. Run the test suite and confirm **all new tests are red**.
3. Implement until all tests are green.
4. Never write implementation code before the red tests exist.
5. Never mock crypto operations.

**Test fixture discipline (enforced):**
- Never write a new `makeFixture()`, `makeE2EFixture()`, `makeFullFixture()`, or any from-scratch function that sets up relay/directory/libp2p nodes.
- Import and extend `createSessionFixture` from `packages/e2e-tests/src/session-fixture.ts`.
- If the story needs something the fixture doesn't support, add an `opts` field with a non-breaking default.
- Lightweight local helpers (`waitForStatus`, `buildMinimalPackageCbor`, etc.) are fine. Infrastructure duplication is not.

**One authoritative test per AC.** If a test is named for AC-006, it must exercise what AC-006 actually claims. A hollow test named for an AC is worse than no test.

### C — Gate sequence

Run in this exact order. Every gate must be clean before proceeding to the next.

```bash
# Always use 1 worker
pnpm --filter <package> run test -- --pool-options.threads.maxThreads=1 --pool-options.threads.minThreads=1

pnpm run lint

pnpm run typecheck
```

If any gate fails, fix it before proceeding. Do not proceed to the review with a failing gate.

---

## Step 4 — Observability requirements (M4+)

For every observability AC in the story:

1. **Event name matches exactly.** `session.started` in the AC means `logger.info("session.started", ...)` in code — not `session_started`, not `SessionStarted`. Name drift is blocking.

2. **Required context fields are present.** If the AC specifies `{ sessionId, agentId }`, both must appear in the logger call.

3. **correlationId is threaded.** Mint once at flow initiation, pass through every async call, appear on every log event in the flow.

4. **Error paths are logged.** Every error path with an observability AC must call the logger with the correct event name and context fields. An empty `catch` is blocking.

5. **Canonical taxonomy only.** Event names not in the story's observability ACs and not in the canonical taxonomy in the pipeline discussion log are a medium finding — add them to the taxonomy.

**The diagnostic test for each log call:** *"If this service crashes immediately after this line, does the on-call engineer have enough information to diagnose the problem without SSH access?"* If no — the context fields are insufficient.

---

## Step 5 — Code discipline

**Minimum code.** Write the least code that satisfies the ACs. No abstractions for single-use code. No configurability that no AC requires. No error handling for scenarios that cannot happen.

**Surgical changes.** Touch only what the story requires. Do not improve adjacent code, reformat unrelated files, or refactor things that aren't broken. Match existing style. When your changes make an import, variable, or function unused — remove it. Do not remove pre-existing dead code unless the story requires it.

**No TODOs in shipped code.** A TODO comment in a story that is being committed is a medium review finding.

---

## Step 6 — Commit implementation

Commit the implementation now, before the review. Commits are cheap and provide traceability — the history should show "implemented" then "fixed review findings" as separate commits.

Stage only the files that belong to this story. Do not stage unrelated changes.

```bash
git add <only story files>
git commit -m "$(cat <<'EOF'
feat(STORY-ID): <one-line summary>

<2-3 sentences explaining what was implemented and why, not what lines changed>
EOF
)"
```

The story ID must appear in the commit message subject line.

## Step 7 — Code review

Spawn the **`feature-dev:code-reviewer`** subagent to conduct the review. Pass it the full checklist below verbatim as the prompt — do not summarise or paraphrase it. The reviewer must read the story YAML and every implementation file; do not shortcut any step.

Wait for the reviewer to return. Fix every finding at every severity — blocking, high, medium, and low. No finding is optional. Re-run the gate sequence after fixing.

### AC coverage check

For every AC in the story:
- Find the named test (test name references the AC ID).
- Verify the test actually exercises the AC — not a stub, not a bypass, not a mock.
- For `test_type: integration` or `test_type: e2e` ACs describing multi-party protocol behavior: ask *"Would this test pass if routed through an in-process stub instead of the real protocol?"* If yes — blocking.

### SI coverage check

For every SI in the story:
- Find the adversarial test that sets up the `adversarial_condition` and asserts the SI holds.
- Verify the adversarial condition is actually triggered — not just asserted to exist.
- Always verify: no private key material leaks into wire messages, logs, or returned objects.

### Package boundary check

- No imports from packages not allowed by `CONTEXT.md`'s dependency graph.
- `@cello/test-fixtures` must not appear in `dependencies` or `peerDependencies` of any production package.
- No production package imports from a `__tests__` directory.

### Fixture discipline check

- No from-scratch fixture function that sets up relay/directory/libp2p nodes. Blocking if present.

### Observability check (M4+)

- Every event name matches the AC exactly.
- Every required context field is present.
- No `console.log/error/warn` in implementation code.
- correlationId threaded through every async flow that requires it.
- All error paths that have observability ACs are logged.

### Code discipline check

- Changed lines trace directly to the story's ACs.
- No orphaned imports, variables, or functions.
- No TODO/FIXME in committed code.

### Review verdict

If any **blocking** or **high** finding exists: fix it, re-run the gate sequence, and re-run the review. Repeat until clean.

Report your review findings before committing (even if all are low/medium) so the main conversation has a record.

---

## Step 8 — Commit review fixes

After fixing all findings, commit the fixes separately:

```bash
git add <only story files>
git commit -m "$(cat <<'EOF'
fix(STORY-ID): address review findings

<brief summary of what was fixed>
EOF
)"
```

---

## Step 9 — Report back

Return a structured report:

1. **Story implemented:** ID + one-sentence summary of what it does
2. **Files changed:** list with one-line description of each change
3. **Gate sequence:** tests (N passed, N skipped), lint (clean/errors), typecheck (clean/errors)
4. **Review findings:** all findings at all severities, with verdict (APPROVED or what was fixed)
5. **Commit:** hash + message
6. **Any assumptions or interpretations** you made during implementation
