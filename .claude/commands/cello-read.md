---
name: cello-read
description: Load current CELLO project context — protocol map, recent activity, readiness status. Start every session with this.
---

Load context about the current state of the CELLO project. Starts from the whole protocol, then layers in recent activity. This is a briefing, not a full reading.

**The protocol map is the foundation of every session. Do not skip it, skim it, or defer it. Everything else builds on what you learn there.**

## Step 1 — Read the canonical glossary and protocol map (REQUIRED — do not proceed to Step 2 without completing both)

Read `CONTEXT.md` at the repo root **first**. It is the canonical glossary for CELLO — terms, package structure, interface contracts, and architectural decisions. Using terms not defined there, or contradicting definitions in it, is a mistake.

Then read `docs/planning/protocol-map.md` **in full, from top to bottom**.

This is non-negotiable. The protocol map is the only document that gives you a complete, current picture of what is decided across all 9 protocol domains. Without it you will answer questions based on stale context, miss resolved decisions, or treat open items as open when they are not.

Each domain entry tells you: what is decided, where the deep reference lives, which discussion logs matter, and whether the domain is ready for user stories. The Protocol Readiness Summary table at the bottom gives you the one-line status of every domain.

Do not start Step 2 until you have read the full file and can answer: which domains are stable, what is deferred, and what is the current readiness status across all 9 domains.

## Step 2 — Recent activity

Run: `git log --oneline -15 -- docs/`

This tells you what's been active recently. Note which domains from the protocol map are represented in recent commits. This is additive context on top of the map — it tells you what's moving, but it doesn't define the agenda.

## Step 3 — Read files the user is likely working on next

Choose what to read in full based on two signals:

1. **Readiness status from the protocol map**: Domains with deferred items or "needs work" status may have active design questions. Read the relevant discussion logs or end-to-end-flow sections.
2. **Recent git activity**: Files modified in the last 3 commits are likely relevant to the current session. Read them in full.

Do NOT read end-to-end-flow.md in its entirety — it is 1100+ lines. Instead, read the specific sections referenced by whichever domains are active. The protocol map tells you exactly which sections those are.

If nothing stands out as particularly active, default to reading the Protocol Readiness Summary table at the bottom of the protocol map and any deferred items listed there.

## Step 4 — Synthesize and report

Provide a concise briefing covering:

1. **Protocol overview** — one paragraph confirming you've read the map and understand the current state. Mention the overall readiness (how many domains are stable, any that need work).
2. **What's been active** — the 2-3 most recent topics from git log, mapped to their protocol domain.
3. **What's open or deferred** — items from the protocol map's readiness column plus any unresolved questions flagged in recently modified files.
4. **What's ready for the next stage** — which domains are ready for user stories, based on the readiness status.
5. **Graph gaps** — any documents added recently that have no `## Related Documents` section (flag these for `/cello-link`).

Frame the briefing as "here's the protocol, here's what's moving, here's what's ready" — not "here's what changed last." The session starts from the whole, not from whatever was last touched.

Keep it to one screen. If the user wants to go deeper on a specific domain, they'll ask.
