---
name: compaction-protocol
description: Use when Andre says "prepare for compaction" or "compact following the compaction protocol" — produces the three required artifacts (follow-through doc, /compact directive, post-compaction kickoff prompt) before any /compact runs.
---

# Compaction Protocol

Produce three artifacts in this order.

## 1. Follow-through document — MANDATORY, non-negotiable

You CANNOT rely on `/compact` to preserve the details the next context needs. The lossy summary
drops exact state, decisions, IDs, and rationale. Before compacting, you MUST have a committed,
human-readable document that a fresh context can read cold and immediately be productive. This is
not optional — no follow-through doc means no compaction.

For milestone work, the build journal serves this role — but you must verify it is fully current
(latest entry reflects actual live state, nothing is left uncommitted). For non-milestone work,
write a dedicated follow-through doc (e.g. `docs/planning/discussion_logs/YYYY-MM-DD_HHMM_slug.md`)
with: what is done, what is next, decisions made and why, exact IDs/hashes/versions, and any
standing background machinery (crons, watchdogs). Commit it before running `/compact`.

## 2. Compaction directive for `/compact`

Four sections:

- **KEEP VERBATIM** — facts the lossy summary must not paraphrase (branch/commit hashes, exact IDs, live status, standing rules)
- **SUMMARIZE BRIEFLY** — background that can point to docs instead of being re-derived
- **DISCARD** — turn-by-turn dialogue, intermediate tool output, resolved back-and-forth
- **Follow-on instruction** — one paragraph: what the next context should do first

## 3. Post-compaction kickoff prompt

Must always open with the three implementation pillars by full path — the milestone **PROCEDURE**,
**DEFINITION-OF-DONE**, and the **latest BUILD-JOURNAL entry** — then the follow-through doc by
path + section, and a first verification step.

## When to compact

Good moments: a section/part is complete, reviewers have run, about to move to something new.
Never mid-task.
