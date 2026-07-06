---
name: M8C Kickoff Prompt
type: kickoff
date: 2026-07-06
milestone: M8C
status: open
description: >
  The kickoff prompt for the M8C implementer (Opus 4.8). Paste into a fresh session, or tell it
  "read docs/planning/user-stories/m8c/M8C-KICKOFF.md and begin." Orders the reading, primes the
  code-verified traps, and sets the first actions. The docs it points at carry the substance —
  this primes and sequences, it does not duplicate.
---

# M8C Kickoff — Implementer Prompt

You are implementing **M8C** (command surface, notifications, reactive messaging) for CELLO.
You are the ONE coder — everything in the main loop, no parallel implementation agents.
Read-only subagents only: `cello-unit-reviewer` per unit, `cello-done-auditor` at tier
boundaries, explorers as needed.

## Read in this order before writing any code

1. `docs/planning/user-stories/m8c/M8C-PROCEDURE.md` — the runbook. The per-unit loop (§2),
   the single-reviewer dispatch (§2b), the publish cascade (§2a), the hard rules (§5), the
   severity triage (§0a). This document governs how you work; read it completely.
2. `docs/planning/user-stories/m8c/M8C-DEFINITION-OF-DONE.md` — the yardstick. Lowest non-✅
   line = your next unit. Never skip ahead.
3. `docs/planning/user-stories/m8c/M8C-BUILD-JOURNAL.md` — last entries + status board.
4. `docs/planning/user-stories/m8c/M8C-DECISIONS.md` — D1–D8 are SETTLED. Never re-open a
   settled fork; never re-raise the T-of-N threshold (see repo CLAUDE.md — that question is
   closed permanently).
5. `docs/planning/user-stories/m8c/M8C-SPEC.md` — §2 "Current reality" and §3 architecture.
   §2's terrain notes are code-verified traps recorded specifically for you; when your instinct
   disagrees with a terrain note, the note wins until you have contrary evidence in code.
6. `CONTEXT.md` at the trustless-cello repo root — canonical glossary. Terms not defined there
   are bugs. Repo `CLAUDE.md` rules (debugging discipline, launch triage, SPARC) apply throughout.

## Repos

- **cello-client** (`/Users/andrep/Documents/code/cello-client`) — center of gravity: daemon,
  shim, MCP tools, CLI. Most units live here.
- **trustless-cello** (`/Users/andrep/Documents/code/trustless-cello`) — directory-touching
  units only (CONTACT's presence edge, RELAYWAKE, PRIMARY) + all milestone docs.
- Work directly on `main` in both. Commit at least every ~15 minutes — docs and code. Push
  cello-client freely; batch directory/relay pushes (each deploy is ~25–30 min).

## Non-negotiables to internalize before the first unit

- **The channels mental model (SPEC §2 — everyone gets this wrong; do not).** `--channels` is a
  Claude Code STARTUP FLAG. Exactly ONE channel is being built: daemon → shim → Claude session.
  Telegram is the daemon speaking the Telegram Bot API directly — NOT a channel.
- **Two MCP surfaces.** The live shim is `core/adapter-claude-code/src/bin/cello-mcp.ts` — that
  is the file WAKE edits. `src/server.ts` + `notifications.ts` in the same package are the
  LEGACY in-process adapter: your pattern SOURCE to port, never your edit target. Finding
  `notifications.ts` does NOT mean stage 1 is already built.
- **New behavior lands in the DAEMON; the shim only forwards** (PROCEDURE §5). A shim-side
  feature is invisible to the CLI and every future adapter while passing all your tests.
- **Clause checklist before code** (loop step 2): expand the unit's full DoD line — every
  clause, including the D6 clauses — into a checklist in the journal. The reviewer judges the
  diff against that checklist, per clause.
- **Review = one `cello-unit-reviewer` dispatch per unit** (§2b): give it the DoD line verbatim,
  your clause checklist, and the diff. Fix EVERY finding, commit fixes. Never batch reviews.
- **Error fidelity everywhere.** An error crossing a boundary carries the upstream code +
  message + context to the surface the operator sees. No bare `catch {}`, no generic
  "something failed" wrappers, no papering over a failure to keep going. When a required thing
  is missing, fail loud with a reason — never silently substitute something simpler.
- **The M9 seam is untouchable.** No content path bypasses `screenInbound`/`screenOutbound`.
- **Every push needs its pull twin in the same unit** (DOD-INV-PUSHPULL).
- **No `console.log`** (injected logger, `domain.noun.verb` events); **no mocks for crypto**;
  **no from-scratch fixtures** (extend `packages/e2e-tests/src/session-fixture.ts` with
  non-breaking `opts`); **vitest one worker, foreground, timeout, filtered**.
- **Publish only via `/cello-publish`** (load the skill, never from memory), batched per tier
  (§2a). NEVER `npm publish`. NEVER push Docker images from local.
- **Autonomous mode:** never `AskUserQuestion`, never end a turn waiting. Reversible fork →
  decide, log in DECISIONS, proceed. Genuine undecidable fork → PARK (DoD Parked decisions +
  journal + DECISIONS) and pull the next unit.

## First actions (order matters)

1. **Verify state.** `git pull` both repos. Confirm trustless-cello HEAD includes M8C-DECISIONS
   through D9. Read the journal's status board — the next unit should be DOD-SPIKE-1; if the
   board says otherwise, trust the board.
2. **Arm the heartbeat cron now (PROCEDURE §3b, Cron 2)** — before any code work. It runs for
   the whole milestone; re-arm it after every compaction/restart, and arm the deploy-watchdog
   cron (Cron 1) additionally whenever a deploy/pipeline run starts.
3. **DOD-SPIKE-1** — the ~30-minute de-risking spike, before anything else: launch
   `claude --channels` with a locally-patched shim, trigger a real inbound session, confirm the
   daemon's `session_state_changed` frame surfaces in-context as a
   `notifications/claude/channel` event. Journal the outcome — exact flag behavior, event
   shape, surprises — BEFORE building anything. If the event does NOT land, STOP and journal:
   the reactive track needs redesign, and that must be known on day 0. Do not build on an
   unproven hop.
4. **DOD-M9INT-1** — merge `m9-build`, wire the gateway seam, run the full semantic gate
   (m9 gate green against the merged daemon + explicit audit that every M8B-era content path
   routes through the gateway).
5. Then the loop from **DOD-WAKE-1**, one DoD line at a time.

## What ✅ means (do not soften this)

A line is ✅ only at its enforcer layer: the e2e fixture harness for daemon/IPC behavior; a
LIVE `claude --channels` session for any line ending inside Claude's context; the 3-directory
spine then live dev for Tier 4/5 directory lines; the published artifact working, for lines
that need a published `connect`. Vitest green ≠ done. The launch gate is ALL of Tier 1 —
including the ONBOARD riders and the cold-onboarding bar inside the DOD-LIVE-1 smoke.
