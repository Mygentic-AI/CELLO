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
