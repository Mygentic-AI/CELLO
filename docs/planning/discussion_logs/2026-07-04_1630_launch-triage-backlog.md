---
name: launch-triage-backlog
type: discussion
date: 2026-07-04
topics: [launch, triage, backlog, friction, prioritization]
status: active
description: Launch triage decisions on the M8B friction/findings backlog — ruin-vs-forgive calls per item, made with Andre 2026-07-04. What's fix-now, what's soon, what defers.
---

# Launch triage backlog

Decisions made with Andre 2026-07-04, applying the launch-triage principle (CLAUDE.md): does this ruin a
prospective customer, or can they forgive it? Numbering follows the priority list discussed.

## Fix now / near-term (pulls toward launch)

- **7 (partial) — hide the dead `cello_get_inclusion_proof` tool** (F3). Trivial; a listed tool that always
  returns `not_implemented` is a dead-end on a trust product. → do it as part of the tool review below.
- **9 — verify SUSPENSION actually blocks a compromised agent** (#14) — the KILL SWITCH, part of the safe-
  launch bar. Portal must be brought back up first (changed a lot since it last worked), so this is its own
  **discrete coding session**: portal suspend → directories refuse to sign → unsuspend → signing resumes.
  Spine test `j-suspend-tofn` exists as the harness anchor.

## Soon (built but unverified — top of the not-yet-but-soon list)

- **8 — relay failover** (#4). We believe it's built (directory failover carries you onto the fallback
  region's relay); it needs a dedicated relay-down-but-directory-up test. **Top of the soon list.**

## Its own exercise

- **7 (full) — review the entire MCP tool surface** (~16 tools). Obvious keepers: initiate_session, send,
  receive, close_session, start/stop/use_agent, list_agents, status, list_sessions, get_transcript,
  get_sealed_receipt. **Confusion cluster to disambiguate:** `await_session` vs `receive_session` vs
  `receive` (three receive-ish tools). **Confirm still work:** backup / restore. **Hide:** get_inclusion_proof.
  Goal: confirm each tool works, disambiguate the receive family, hide the dead one.
- **Node selection** — see [[2026-07-04_1600_directory-node-selection-strategy]] (random uniform at launch,
  P2C + signed load after). Kills the us1 steady-state concentration.

## Do-if-cheap quick wins (AI coder; small, self-contained)

- **5a — F11:** downgrade the ~hourly directory reconnect churn from warn→debug (it reads as an unstable
  connection while tailing logs).
- **5a — F18:** persist / auto-restore the current-agent selection across a reconnect (today it silently
  resets and the next command fails with `no_current_agent`).

## Defer (forgivable at launch)

- **5b — F17** (redefine `interrupted_sessions` semantics) and **F5-CORR** (split the overloaded `state`
  field). Schema/design changes, not quick fixes.
- **6 — F9/F10 cleanup UX.** No corruption risk (verified 2026-07-04: single-instance lock file
  `~/.cello/daemon.lock` + connect-or-start reuses the running daemon; WAL mode; orphan MCP *clients* proxy
  to the one daemon and never open the DB). What remains is cosmetic accumulation in `cello status`.
- **10 — build `cello_get_inclusion_proof`** for real (crypto exists, tool doesn't). Advanced tamper-evidence
  verification; customers don't need to call it day-1. (Hide it now — item 7 — build later.)
- **11 — F19** (document the app-vs-daemon signing split so operators don't mis-reason "I stopped it so it's
  offline") and **F21** (give a stuck one-sided seal a clear terminal reason; core bug already fixed).

## Already decided earlier (context)

- **2** (demo one-concurrent-onboarding, F22) — understood, nothing to do now.
- **3** (seal with a node down) — T-of-N seal proven in harness; FINDING-9 (session/seal AFTER a directory
  failover) is the real open gap, not the earlier "just rerun live."
- **4** (see/pick your directory, F6/F7/F12) — automatic failover works; the manual see/choose layer is
  unbuilt and **forgivable at launch**.
