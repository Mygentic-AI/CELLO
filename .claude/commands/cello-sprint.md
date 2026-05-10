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

### Ready to pick up
Which story (or stories, if parallelizable) should be implemented next, based on dependency order and what's already done.

---

Keep the briefing to 2 screens. The goal is to orient an implementer, not to reproduce the stories verbatim.
