---
name: cello-read
description: Load current CELLO project context — active milestone, recent story activity, open work. Start every session with this.
---

Orient to the current state of the CELLO project. This is a fast briefing — not a full protocol review. The protocol design is stable and complete. The work now is implementation.

## Step 1 — Read the canonical glossary (always required)

Read `CONTEXT.md` at the repo root. It is the authoritative source for all CELLO terms, package structure, interface contracts, and architectural decisions. Do not use terms that are not defined there.

Keep it in mind for the rest of the session. If the task involves writing code, the SPARC/TDD methodology in `.claude/CLAUDE.md` is equally required — read it before touching implementation.

## Step 2 — Identify the active milestone and recent story activity

Run these in parallel:

```bash
git log --oneline -20
git log --oneline -10 -- packages/
```

The first shows overall project activity (docs, infra, stories, fixes). The second shows implementation commits — these tell you which stories have shipped recently and what code is moving.

From the commit history, identify:
- What milestone is currently active (look for story ID prefixes like DEPLOY-, PERSIST-, SECOPS-, SESSION-, etc.)
- Which stories merged in the last ~5 commits
- Any open fix loops (commits with `fix(STORY-ID):` patterns mean a reviewer returned findings)

## Step 3 — Read the active milestone outline

Find the active milestone's outline file at `docs/planning/user-stories/<milestone>/outline.md` and read it in full.

This tells you: what the milestone delivers, what stories are in scope, what's been completed, and what's still pending. It is the single best document for understanding where things stand.

If the milestone outline has a "Gap" or "Post-" section (like the DEPLOY-001A section in M5), those are reactive additions — read them carefully as they often explain why recent commits look different from the original plan.

## Step 4 — Read infrastructure state (if the task touches AWS)

If the session involves deployment, AWS, IaC, ECS, RDS, or CI/CD — read `infra/STATE.md`. It is the authoritative record of what exists in AWS: deployed stacks, current status, and all key resource identifiers. Do not guess at infrastructure state from code alone.

## Step 5 — Synthesize and report (keep it to one screen)

Provide a concise briefing with these sections:

**Active milestone** — one sentence: what milestone, what it delivers, how far along it looks based on recent commits.

**Recently shipped** — bullet list of story IDs that merged in the last ~5 commits. If there were reviewer fix loops, note that too (e.g. "DEPLOY-001 — merged after 3 review rounds").

**What's open** — any stories in the milestone outline that haven't appeared in git log yet; any pending manual steps from infra/STATE.md; any open items flagged in the outline.

**If the task is coding** — add one line: "Task involves implementation — SPARC/TDD methodology in `.claude/CLAUDE.md` applies."

**Graph gaps** — any documents added recently (check `git log --oneline -10 -- docs/`) that are likely missing wikilinks. Flag for `/cello-link`.

Do not reproduce the protocol readiness table. Do not enumerate all 9 protocol domains. Do not describe what each milestone from M0–M14 does. The protocol design is done — the briefing is about implementation state.
