# CELLO — Claude Code Guide

## What This Project Is

CELLO is a peer-to-peer identity and trust layer for agent-to-agent communication. The core idea: agents need to verify who they're talking to, sign messages with tamper-proof guarantees, and defend against prompt injection — without trusting a centralized platform.

The **`docs/planning/`** folder is an **Obsidian vault**. It is the primary design record for the project. All architectural decisions, open problems, and discussion logs live here.

---

## Vault Structure

```
docs/planning/
├── cello-design.md                  # Master architecture document (start here)
├── prompt-injection-defense-layers-v2.md
├── day-0-agent-driven-development-plan.md
├── protocol-review/
│   ├── open-decisions.md            # 12 resolved design decisions
│   ├── design-problems.md           # 7 unsolved problems
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