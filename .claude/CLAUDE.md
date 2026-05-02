# CELLO — Claude Code Guide

## What This Project Is

CELLO is a peer-to-peer identity and trust layer for agent-to-agent communication. The core idea: agents need to verify who they're talking to, sign messages with tamper-proof guarantees, and defend against prompt injection — without trusting a centralized platform.

The **`docs/planning/`** folder is an **Obsidian vault**. It is the primary design record for the project. All architectural decisions, open problems, and discussion logs live here.

---

## Vault Structure

```
docs/planning/
├── protocol-map.md                  # Start here — maps all 9 protocol domains, readiness status, and key discussion logs
├── cello-design.md                  # Original vision — 10-step trust chain, revenue model, competitive landscape
├── end-to-end-flow.md               # Deep canonical narrative — every domain in one coherent story (1100+ lines)
├── prompt-injection-defense-layers-v2.md
├── day-0-agent-driven-development-plan.md
├── protocol-review/
│   ├── open-decisions.md            # 12 resolved design decisions
│   ├── design-problems.md           # 12 design problems — all closed
│   └── day-zero-review/
│       ├── 00-synthesis.md          # Adversarial review summary
│       └── 01–08-*.md               # Individual review reports
└── discussion_logs/
    └── YYYY-MM-DD_HHMM_slug.md      # One file per design session
```

Every document has **YAML frontmatter** with:
- `name` — human-readable title
- `type` — `design` | `discussion` | `review` | `plan` | `decision`
- `date` — creation date
- `topics` — array of tags used for cross-linking
- `status` — `active` | `open` | `resolved` | `reference`
- `description` — one-sentence summary

---

## Required Reading

**Read `CONTEXT.md` at the repo root before any implementation work.** It is the canonical glossary for CELLO — terms, package structure, interface contracts, and architectural decisions. Using terms not defined there, or contradicting definitions in it, is a mistake.

---

# ⚠️ IMPORTANT MANDATORY: SPARC Development Process

**This is non-negotiable. Every story, every package, every time. No exceptions.**

CELLO is financial trust infrastructure. Cutting process corners is how vulnerabilities get shipped.
Read the full process: `docs/planning/day-0-agent-driven-development-plan.md`

## The Five Phases — In Order, Always

### Phase S — Specification (already done for M0)
User stories exist in `docs/planning/user-stories/`. Read the full YAML before writing a single line of code or test. Every AC maps 1:1 to a test case.

### Phase P — Pseudocode (MANDATORY before coding)
Before writing any implementation:
1. Write high-level pseudocode for each component in a comment block or discussion log
2. Crypto code MUST reference the RFC or NIST publication: Ed25519 → RFC 8032, SHA-256 → FIPS 180-4, FROST → RFC 9591
3. Review the pseudocode against the spec ACs. Catch structural problems now, not after 200 lines.

### Phase A — Architecture (MANDATORY before coding)
1. Define TypeScript interfaces and type signatures before implementing them
2. Confirm package boundaries: which package owns what, which imports are allowed
3. Verify against `CONTEXT.md` definitions — use the exact terms defined there

### Phase R — Refinement (TDD: RED first, then GREEN)

**The TDD rule is absolute:**

```
1. Write ALL tests for the story first — derived directly from the ACs and SIs
2. Run: pnpm run test — ALL new tests MUST FAIL (red). If a test passes before implementation exists, the test is wrong.
3. Write implementation — minimum code to make tests pass
4. Run: pnpm run test — ALL tests MUST PASS (green)
5. Refactor if needed — tests must stay green
```

**You are not allowed to write implementation code before the tests exist and have been confirmed red.**

Test files must use `@claude-flow/testing`:
```typescript
import { setupV3Tests, createTestScope, measureTime, assertV3PerformanceTargets } from '@claude-flow/testing';
setupV3Tests();
```

Crypto tests: use `measureTime()` + `assertV3PerformanceTargets()` for performance assertions.
Async/P2P tests: use `waitFor()`, `retry()`, `withTimeout()` — not raw `setTimeout`.
Isolation: use `createTestScope()` for cleanup, not manual teardown.

**No mocks for cryptographic operations.** Real keys, real signing, real verification. Always.

### Phase C — Completion: Gate Sequence (ALL MANDATORY, IN ORDER)

After all tests are green, run this exact sequence before committing:

```
Step 1 — Tests green:       pnpm run test         (all pass)
Step 2 — Lint:              pnpm run lint         (zero errors)
Step 3 — Typecheck:         pnpm run typecheck    (zero errors)
Step 4 — Build:             pnpm --filter @cello/<name> run typecheck  (package compiles to dist/)
Step 5 — Code Review:       Agent({ subagent_type: "feature-dev:code-reviewer", ... })
Step 6 — Commit:            Story ID in commit message
```

**Step 5 — Code Review is mandatory.** After each phase (P pseudocode, A architecture, R implementation) dispatch a `feature-dev:code-reviewer` agent against what was just produced. Do not skip this for "simple" changes. The review agent must check:
- Implementation matches the ACs exactly (no extra, no missing)
- Security invariants enforced (no private key leakage paths, no silent failures)
- Package boundaries respected
- No YAGNI violations — no code beyond what the story requires
- `@claude-flow/testing` used correctly

Every AC in the story YAML has a corresponding named test.
Every SI in the story YAML has a negative test (adversarial condition).
Commit only after the reviewer returns no blocking issues.

## What Skipping Any Phase Looks Like

- Skipping P: structural bugs caught at integration, not spec review
- Skipping A: interface mismatches between packages discovered late
- Skipping red-first TDD: tests that never actually caught a bug — untested code shipped as "tested"
- Not using `@claude-flow/testing`: inconsistent async handling, missing performance assertions, manual cleanup that leaks state

## Parallel Agent Dispatch

MSG-001 and TRANSPORT-001 are independent and run in parallel as separate agents.
Each agent owns its package. Neither touches the other's package.
The E2E agent runs only after both complete and pass their ACs.

---

## Slash Commands

### `/cello-read`
**Use at the start of any session.** Loads context about the current state of the project without reading everything.

### `/cello-link`
**Use after adding or modifying documents.** Scans the vault and adds wikilinks between documents that share topics. Run this whenever a new discussion log is created.

---

## Discussion Log Conventions

When creating a new discussion log:

1. **Filename:** `docs/planning/discussion_logs/YYYY-MM-DD_HHMM_short-slug.md`
2. **Frontmatter:** Always include all five fields (`name`, `type`, `date`, `topics`, `description`)
3. **Type:** always `discussion`
4. **Topics:** be specific — use existing topic tags where possible to enable cross-linking
5. **Run `/cello-link`** after committing to wire it into the graph

Example frontmatter:
```yaml
---
name: Example Discussion Topic
type: discussion
date: 2026-04-10 14:00
topics: [connection-policy, trust-data, FROST]
description: One sentence describing what was decided or explored in this session.
---
```

---

## Key Design Principles (for context)

- **Hash relay, not message relay** — the directory sees hashes, never content
- **Split-key signing (FROST)** — neither the agent nor the directory can sign alone
- **Client-side trust data** — directory stores hashes of trust scores, never the data itself
- **Graceful degradation** — directory outage drops to K_local-only, never a full stop
- **Receiver-side scanning is the security boundary** — sender's scan is a signal, not the defense

---

# Behavioral guidelines to reduce common LLM coding mistakes. 

**Tradeoff:** These guidelines bias toward caution over speed. 
For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them. Don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" 
If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it. Don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]

Strong success criteria let you loop independently. 
Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, 
fewer rewrites due to overcomplication, and clarifying questions come 
before implementation rather than after mistakes.