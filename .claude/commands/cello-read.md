---
name: cello-read
description: Load current CELLO project context — recent activity, decisions, open questions.
---

Quickly load context about the current state of the CELLO project — what's been decided, what's open, what was worked on recently. Use this at the start of any session.

## Step 1 — Recent activity

Run: `git log --oneline -15 -- docs/`

Note: which files changed, when, what the commit messages say. This tells you what topics are hot right now.

## Step 2 — Frontmatter index scan

Read the first 15 lines of every `.md` file under `docs/planning/` (recursively).

Use the Glob tool: `docs/planning/**/*.md`

Build a mental map grouped by `type`:
- `design` — the stable architecture documents
- `discussion` — what's been explored and decided, in chronological order
- `decision` — resolved questions (open-decisions.md)
- `review` — adversarial findings (design-problems.md, 00-synthesis.md)
- `plan` — implementation approach

Note the `topics` on recent discussion logs — these show where thinking is active.

## Step 3 — Read recently modified files in full

For any file modified in the last 3 commits (identified in Step 1), read the full content.

Also always read `docs/planning/protocol-review/design-problems.md` — it lists the 7 open problems that don't yet have solutions.

## Step 4 — Synthesize and report

Provide a concise briefing covering:

1. **What we've been working on** — the 2–3 most recent topics, based on recent commits and discussion log dates
2. **What was decided** — key conclusions from recent discussion logs (1–2 sentences each)
3. **What's open** — unresolved questions from recent sessions, plus any of the 7 design problems that are actively relevant
4. **Graph gaps** — any documents added recently that have no `## Related Documents` section (flag these for `/cello-link`)

Keep it to one screen. This is a briefing, not a full reading. If the user wants to go deeper on a specific topic, they'll ask.
