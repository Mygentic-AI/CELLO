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

### D6 — Doc-review gap sweep: nine missing decisions pinned (2026-07-06, Andre approved all)
- **Fork:** a review of the M8C apparatus found nine places where a story would stall on an
  unmade decision or an auditor would trip on inconsistent wording. Andre's rule: propose the
  sensible default per precedent/"usual way it works," no decision fatigue. All nine applied to
  the DoD lines they live on (each tagged "D6" in place):
  1. **Unread mechanism (INBOX-1):** unread = transcript seq > per-agent, per-session
     `last_delivered_seq` watermark in the daemon DB; `cello_receive` advances it (delivery marks
     read; no ack verb, no notification store). The email/IMAP model; daemon-side so poll-only
     clients get it free; the primitive SINCESEQ/CURSOR later refine.
  2. **Contact management (CONTACT-1):** auto-add on operator action (initiate or accept a
     session) + manual `cello contact add/remove/list`; identity pins to pubkey at add time,
     directory name is the handle. Matches the messenger mental model and the whitelist's own
     known=auto-accept semantics.
  3. **LEAVEMSG topology:** reworded to the design log's decided model — sender's daemon deposits
     at a relay (pickup_queue), recipient pulls via RELAYWAKE; LEAVEMSG is the recipient-side
     verify/gate/store/surface half + "dispatched to relay" sender UX. No daemon stores for
     foreign agents (the old wording invited exactly that misbuild).
  4. **TGDOOR inbound + coalescing:** Mode 1 inbound = canned notify-only reply to the allowlisted
     operator, silent drop + log for everyone else, nothing enters content paths; doorbell rings
     once-until-read per session (keyed on the unread watermark), requests/state changes always ring.
  5. **Telegram poller is Primary-only (PRIMARY-1):** Standby holds the token but polls cold;
     baton transfer moves the poller. Anything else re-creates the single-`getUpdates`-consumer
     contention that decided OQ-1 (D4).
  6. **INV-HONEST-STATES tagged "(Tier 3 activation)"** — mirrors ONE-PRIMARY's tag so the
     done-auditor doesn't fail an invariant that isn't yet satisfiable.
  7. **INV-CONTENTFREE reworded** to allow routing metadata (agent name, session label) — makes
     TGDOOR's `[agent · session]` header legal without weakening "never content."
  8. **AUTOSTART failure path:** structured `agent_start_failed` + reason + next-step guidance;
     current-agent selection unchanged on failure.
  9. **WAKE-1 publish clause:** the `connect` bump rides the Tier 1 close cascade (LIVE-1) per
     PROCEDURE §2a — removes the mid-tier-publish contradiction.
- **Also resolved, no doc change:** the Telegram plugin license concern is dead — MIT, and it is
  reference-only for our own code, not a copy (Andre, 2026-07-06).
- **Reverse:** each is a sentence or two on its host DoD line; strike the D6 clause to revert any
  single one independently.

### D7 — Handoff hardening for the Opus 4.8 implementer (2026-07-06, Andre ruled per item)
- **Fork:** M8C will be implemented by Opus 4.8; a Fable 5 review proposed six doc changes to
  set it up. Andre's rulings:
  - **APPLIED — DoD ordering fix:** the ONBOARD-* riders moved ABOVE DOD-LIVE-1 (the launch smoke
    includes the cold-onboarding bar, so "lowest non-✅ line" must reach them first).
  - **APPLIED — code-verified terrain notes in SPEC §2:** the two-MCP-server-surfaces trap (live
    shim = `bin/cello-mcp.ts`; legacy `server.ts` already holds the stage-1 pattern to port —
    don't edit it, don't conclude "already built"), the `notifications.ts` bare-`catch{}` and
    `IpcProxy` no-reconnect/oldest-pending porting traps, and the **channels mental model**
    (Andre, verbatim intent: `--channels` is a Claude Code startup flag; ONE channel exists —
    daemon → shim → Claude session; Telegram is NOT a channel, it's the daemon speaking the
    Telegram Bot API directly; the Anthropic plugin is reference for both patterns
    independently). Echoed on DOD-TGDOOR-1.
  - **APPLIED — PROCEDURE §2b reviewer-dispatch block:** every review dispatch carries the DoD
    line verbatim + the coder's clause checklist; per-clause verdicts; error-fidelity (buried /
    generic-wrapped errors = blocking); trace-one-error-path-and-quote-it; done-auditor judges
    the DoD text, never the tests.
  - **APPLIED — loop step 2 extension:** the coder expands the DoD line into a clause checklist
    in the journal before coding (the anti-"silently build something simpler" measure).
  - **REJECTED — schema-reservation block:** alpha, one user, nothing valuable in any local
    daemon DB, and implementation is serial — wipe-and-recreate is acceptable. Do not re-propose
    client-DB migration ceremony until there are real operators.
  - **APPLIED (after flow walkthrough, Andre agreed 2026-07-06) — "behavior lands in the daemon,
    never the shim" hard rule (PROCEDURE §5):** the shim is one of several daemon clients; logic
    implemented shim-side (e.g. auto-start as catch-then-retry in `cello-mcp.ts`) is invisible to
    the CLI and every future adapter while passing all Claude-Code-path tests. Note: unrelated to
    channels — this is the request/response direction.
- **Reverse:** each applied item is a self-contained block/clause; strike independently.

### D8 — ONE per-unit reviewer instead of three (2026-07-06, Andre)
- **Fork:** step 8 dispatched three parallel read-only reviewers per unit
  (`feature-dev:code-reviewer` + `cello-test-attacker` + conditional `cello-fallback-finder`),
  each re-reading the same diff, tests, and intent — triple context cost per unit.
- **Choice (Andre):** consolidate into a single **`cello-unit-reviewer`**
  (`.claude/agents/sparc/cello-unit-reviewer.md`) — one pass, four lenses, one report: code
  review, spec fidelity (per-clause verdicts, D7), failure integrity (D7 error-fidelity + the
  fallback-finder's four patterns and high-danger shapes carried over near-VERBATIM — Andre's
  explicit condition), and test teeth (the test-attacker's bypass question + hollow shapes).
  Fallback checks now run on EVERY unit (no longer conditional on seam-adjacency) — free once
  it's one pass.
- **Unchanged:** `cello-done-auditor` at tier boundaries (different cadence, different job).
  The three original agent files stay on disk for other milestones/skills; M8C's procedure
  simply stops dispatching them.
- **Why:** token cost — the diff + tests + DoD line get read once instead of three times.
  Accepted trade-off: one context juggling four lenses loses some independent-perspective
  redundancy; the lens prompts are kept verbatim to minimize dilution.
- **Reverse:** revert PROCEDURE step 8/§2b/§5 to the three-agent dispatch; the original agents
  are untouched.
- **Addendum (same day):** Andre asked whether `feature-dev:code-reviewer`'s actual prompt had
  been read before merging — it hadn't (Lens 1 was written from its one-line description). Read
  in full; folded in what was missing: the 0–100 confidence rubric with report-only-≥80 (scoped
  to Lens 1 — lenses 2–4 are exhaustive by design) and a concrete fix suggestion per finding.
  One deliberate deviation from its rubric: pre-existing defects are NOT suppressed as false
  positives — reported `[pre-existing]`, per Andre's standing fix-errors-when-found rule.

---

## Related Documents

- [[M8C-SPEC]] — the design these decisions are baked into
- [[M8C-DEFINITION-OF-DONE]] — the yardstick (incl. the Parked decisions section)
- [[M8C-PROCEDURE]] — the runbook
- [[M8C-BUILD-JOURNAL]] — the audit trail
- [[M8C-MILESTONE-NOTES]] — the triage worksheet + verification evidence behind D1–D4
