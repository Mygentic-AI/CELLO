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

### D5 — Fold the onboarding/command-surface friction sweep into M8C (2026-07-06, Andre)
- **Fork:** the M8B UX friction backlog ([[2026-07-02_1130_m8b-e2e-ux-friction-log]]) plus a
  2026-07-06 live registration walkthrough surfaced ~a dozen friction points. Leave them for a
  later polish pass, or fold the cheap ones into M8C now (which already rebuilds those exact
  surfaces: `cello status`, per-connection agent selection, CLI/config, the command surface)?
- **Choice (Andre):** fold the cheap ones in now, as **rider ACs on the units already touching
  those surfaces** — not new tiers. Re-verified each against current code first (the log is 4
  days stale): **F3, F10, F17 were already fixed since the log and dropped**; F1/F2/F13–F16/F20/
  F23 shipped earlier. Survivors folded:
  - **Tier 1 (launch-critical — see rationale):** DOD-ONBOARD-HELP/ERRORS/NEXTSTEP/WARN/LOGNOISE-1
    (F24 help; R1 quoting, R2 two-step, R3 missing-token error, R4 silent bad-token failure,
    R5 invisible env-var form, R6 misframed single-use-token warning, R7 next-step guidance;
    F11 log noise) + F5/F18 riders on AUTOSTART + F4 rider on INBOX.
  - **Tier 2:** F6/F12 riders on CONFIG (directory choice + which-node visibility).
- **Why Tier 1 (not a later polish pass):** onboarding is the first-connect path — the one moment
  you don't get twice. Per the CLAUDE.md launch-triage lens, a confusing first run is
  *unforgivable* (no core value / trust lost), so it gates launch. And CELLO's operator is often
  an **AI** driving the CLI: next-step guidance + clear errors are how it self-corrects without a
  human — load-bearing, not polish. Cost is low (better help/errors/guidance, less ceremony), so
  it fits the launch slice without a rebuild.
- **Verified facts baked in:** agent-name rule is `^[a-zA-Z0-9_-]{1,64}$` (no spaces); the env-var
  form works (`cello.ts:82` falls back to `process.env.CELLO_PREAUTH_TOKEN`) — the other AI's
  advice was correct, Andre's "won't work" was the token being single-use/already-consumed;
  pre-auth tokens are single-use + 24h (directory `consumed_at` / `preauth.token.reuse.rejected`),
  which is why the exposure warning is over-framed (R6/DOD-ONBOARD-WARN-1).
- **NOT folded (own items, not fruit):** F7 (daemon restart/reload), F9 (connected-client
  visibility + reap), F21 (terminal unilateral-seal failure), F22 (standing-receiver own port).
  Listed in the DoD "Tracked, not M8C-fruit" section.
- **Reverse:** riders are additive on their host units; drop any (F6 is the explicit
  keep-or-cut) or re-tier the ONBOARD group by moving lines — pure ordering, no rework.

---

## Related Documents

- [[M8C-SPEC]] — the design these decisions are baked into
- [[M8C-DEFINITION-OF-DONE]] — the yardstick (incl. the Parked decisions section)
- [[M8C-PROCEDURE]] — the runbook
- [[M8C-BUILD-JOURNAL]] — the audit trail
- [[M8C-MILESTONE-NOTES]] — the triage worksheet + verification evidence behind D1–D4
