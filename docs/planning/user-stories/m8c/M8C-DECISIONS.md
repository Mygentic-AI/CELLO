---
name: M8C Decisions Log
type: decisions
date: 2026-07-05
milestone: M8C
status: open
topics: [command-surface, notifications, channels, telegram-relay, multi-daemon, scope, triage]
description: >
  Every fork in the M8C design and the decision taken, starting with the 2026-07-05 scope/tiering
  session with Andre (launch tier cut, Telegram depth, deferrals-reversed, OQ-1). Run-time forks
  append below with timestamp / fork / choice / why / reverse, per the M8B pattern.
---

# M8C — Decisions Log

Every fork is recorded: the fork, the choice, why, how to reverse. Rule: **pick the reversible
option and keep going** — never block. Genuine undecidable forks are PARKED (journal + DoD
"Parked decisions" + here).

## Pre-resolved with Andre (2026-07-05, scope-settling session)

### D1 — Launch tier = doorbell only
- **Fork:** where Tier 1 (the launch gate) cuts off — doorbell only, vs + stage 2/since_seq, vs
  stage-1-only minimal.
- **Choice (Andre):** doorbell only — spike → channel stage 1 → `use_agent` auto-start →
  `cello_check_notifications`. Stage 2 + `since_seq` lead Tier 2, built immediately after but not
  gating launch.
- **Why:** without a doorbell, a friend's agent reaching yours goes unnoticed — fails the
  launch-lens "core value" test. An attended session polls fine mid-conversation, so per-message
  wake is post-launch. INBOX is in the launch tier because pushes are fire-and-forget — it is the
  loss-reconciliation mechanism, not a convenience (verification finding).
- **Reverse:** pull MSGWAKE/SINCESEQ into Tier 1 — pure ordering, no rework.

### D2 — Telegram relay: Mode 1 doorbell in M8C; full-monitoring + Mode 2 → follow-on milestone
- **Fork:** how far the Telegram operator relay goes inside M8C.
- **Choice (Andre):** Mode 1 doorbell level in M8C (Tier 3): daemon-owned bot, allowlisted
  operator chat, discrete events pushed to the phone, works cold. Full-monitoring level and
  Mode 2 (operator as communicator, approvals gate) open the follow-on milestone.
- **Why:** Andre's own sizing — "fairly big but not huge; probably not launch-blocking; soon
  after launch." Doorbell decouples from the channel stages under the daemon-owned design;
  full-monitoring needs stage 2's daemon hook anyway.
- **Reverse:** the follow-on track is additive on the daemon-owned bot; nothing to undo.

### D3 — Multi-daemon AND async foundation STAY in M8C (late tiers)
- **Fork:** defer Primary/Standby (+ per-daemon policies, session portability) and offline
  delivery (check-relay-on-wakeup, leave-a-message) to their own milestones — the recommended
  option — or keep them in M8C.
- **Choice (Andre):** **keep both in M8C**, as strictly-ordered late tiers (Tier 4 async,
  Tier 5 multi-daemon). One big milestone, single apparatus; launch gates at end of Tier 1, the
  milestone continues past launch.
- **Notes from the exchange:** the first ask referenced items by inventory number and was
  unanswerable — re-asked in plain language (lesson: never present Andre a scope fork by item
  number). Clarified: neither item is a security control; the security layer is M9, which merges
  first regardless (Tier 0).
- **Guardrail carried into the DoD:** DOD-PRIMARY-DESIGN-1 — the ECDH device-linking handshake
  gets its own design log BEFORE any Tier 5 code (it is a crypto attack surface: "how does daemon
  A authenticate that daemon B belongs to the same operator?").
- **Reverse:** split tiers 4/5 out into their own milestone docs later — the tier boundaries are
  designed to make that a file move, not a rework.

### D4 — OQ-1 CLOSED: daemon-owned Telegram bot
- **Fork:** daemon-owned bot vs live-session router model.
- **Choice (Andre, confirming the steer):** daemon-owned. Token = daemon setting; single
  long-lived poller uniquely owns it.
- **Why (verification evidence, 2026-07-05):** Telegram allows exactly one `getUpdates` consumer
  per token — stated verbatim in the vetted plugin's code, which carries ~100 lines of
  PID-file/stale-poller/409-retry contention handling that exists ONLY because Claude Code spawns
  a poller per session. Daemon-owned eliminates it, works cold (no live session), and is
  runtime-agnostic — Claude Code's edge is push latency, not capability.
- **Reverse:** substantial (the router model is a different topology) — but the evidence is
  one-directional; treat as settled.

### Parked with the Mode-2 deferral (not open M8C questions)
- **OQ-2** — real-time vs polled operator input / daemon-mediated gates → decided when Mode 2 is scoped.
- **OQ-3** — reply @-addressing beyond the `[agent · session]` header → same.
- **OQ-4** — full Telegram settings knob list → resolves inside DOD-CONFIG-1 + DOD-TGDOOR-1 scoping.

### Standing scope boundaries (from the notes, not re-litigated)
- **M9 is excluded as a feature** — it is Tier 0's merge/wire integration, never re-invented.
- **`--channels` is required** for the in-context wake (settled 2026-06-27); the spike confirms
  wiring, not the flag.
- **Kill switch is portal's job** — launch-critical, tracked OUTSIDE M8C. Recorded here so it has
  a named home and cannot fall between milestones.
- **Non-Claude-Code adapters (#9)** — separate design track; meanwhile no Claude-Code assumptions
  baked into the daemon (DOD-INV-PUSHPULL).

---

## Decisions made during the run

*(Append below: timestamp / unit / fork / choice / why / reverse.)*

---

## Related Documents

- [[M8C-SPEC]] — the design these decisions are baked into
- [[M8C-DEFINITION-OF-DONE]] — the yardstick (incl. the Parked decisions section)
- [[M8C-PROCEDURE]] — the runbook
- [[M8C-BUILD-JOURNAL]] — the audit trail
- [[M8C-MILESTONE-NOTES]] — the triage worksheet + verification evidence behind D1–D4
