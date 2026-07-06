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

Every fork is recorded: the fork, the choice, why, how to reverse. Rule (D10, revised
2026-07-06): **pick what you believe is the common best practice — the choice a competent
engineer would recommend if asked, and least likely to need reversing — not the choice that is
merely cheapest to undo.** Log it, keep going — never block. Genuine undecidable forks are
PARKED (journal + DoD "Parked decisions" + here).

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
- **M9 is excluded as a feature** — it is the deferred merge/wire integration (post-channel, D11 —
  NOT Tier 0, NOT a prerequisite), never re-invented.
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

### D9 — Two watchdog crons specified, PROCEDURE §3b (2026-07-06, Andre)
- **Fork:** PROCEDURE §3a referenced "a session cron" being armed but never specified setting
  one up, its cadence, or what it checks — and had no second mechanism at all for the
  observed failure mode where the autonomous coder stops for a frivolous reason (an obvious
  decision, an unneeded confirmation) despite being told not to, and then can't self-resume.
- **Choice (Andre):** two distinct crons, both specified in new PROCEDURE §3b:
  1. **Deploy/pipeline watchdog** — armed only while a deploy is in flight (directory/relay
     deploys, ~25–30 min); every 4 min; checks REAL health (CodePipeline per-stage status, ECS
     `rolloutState` + task stop/restart counts) — not just top-level "InProgress," because a
     crash loop can read as in-progress indefinitely. Genuine failure/crash-loop → stop and
     surface immediately; terminal state → self-deletes via `CronDelete`.
  2. **30-min heartbeat / anti-stall nudge** — armed for the whole milestone; re-reads
     PROCEDURE/DoD if compaction dropped them from context, reaffirms commit-often and
     review-every-unit, and re-enters a stalled session (a fired cron prompt is enqueued like
     any instruction, which is exactly what un-sticks an idle session per this environment's
     cron semantics — jobs fire only while idle, never mid-query).
- **Why this shape:** cron jobs here are session-only (gone on restart/compaction) and
  auto-expire after 7 days — both facts are stated explicitly in §3b as the single point of
  failure to guard against (re-arm both after every restart/compaction; check both at every
  tier-boundary checkpoint). The 4-min/30-min cadences and the crash-loop-vs-in-progress
  distinction are Andre's own operational experience, not derived.
- **Reverse:** §3b is self-contained; strike it and revert §3a's cron sentence.

### D10 — Decision rubric corrected + publish/deploy sequencing specified (2026-07-06, Andre)
- **Fork 1 — the autonomous decision rubric was wrong.** Every prior "never block" instruction
  (this doc's intro, PROCEDURE §3a/§3b) told the loop to pick the REVERSIBLE option on a fork.
  Andre's correction: reversibility is the wrong criterion — in most cases, if asked directly for
  a recommendation he'd pick the objectively right answer, not the cheapest-to-undo one. **New
  rubric: pick what you believe is common best practice — the choice a competent engineer would
  recommend if asked, and least likely to need reversing.** Applied everywhere "reversible
  choice/option/fork" appeared as the selection criterion (this doc's intro rule, PROCEDURE
  §3a, §3b heartbeat item 2, M8C-KICKOFF). The per-decision "Reverse:" audit field (how to undo
  a choice if it turns out wrong) is UNCHANGED — that's documentation discipline, not the
  selection rubric, and stays on every entry.
- **Fork 2 — publish/deploy sequencing was underspecified.** New PROCEDURE §2c: `/cello-publish`
  loaded fresh every time; only `latest`-tag promotion and (likely) `/mcp` reconnect are
  human-only, everything else in the publish/deploy path (beta publish, `deploy.sh`, tagging,
  AWS/SSM) runs via bash, no permission-asking. When both a directory/relay deploy and a
  cello-client publish are needed, start the (slower) deploy first, publish while it runs — pairs
  with arming the §3b Cron 1 deploy watchdog right after. Live-test dependencies (demo agent
  update, `/mcp` reconnect) get pushed to the end — do everything else in the unit first, touch
  them only when the enforcer actually needs them. Hitting a human-only step is a CORRECT stop:
  state it in one line, move to the next unit; §3b's heartbeat must not treat this as a stall.
- **Reverse:** rubric — revert the four "reversible" sentences. Sequencing — §2c is
  self-contained; strike it.

### D11 — M9 is done AFTER the channel work, NOT merged first (2026-07-06, Andre — SUPERSEDES the Tier-0 "M9 first" instruction)

- **Fork:** the original M8C apparatus put **DOD-M9INT-1** (merge `m9-build` + wire the
  `screenInbound`/`screenOutbound` seam + semantic gate) as **Tier 0, before any channel code**,
  with PROCEDURE §4/§5 and SPEC §3/§4 all repeating "no channel code before the seam is live." When
  the implementer reached that line it tried to start the merge.
- **Choice (Andre, explicit):** **STOP — do not merge M9 now. M9 is done AFTER the M8C channel
  tiers.** The "merge M9 first" instruction is stale leftover and is **superseded**. Nobody —
  including a fresh context after compaction — should read the apparatus and conclude M9 must be
  merged before the channel work. It must not.
- **What changed in the docs (all applied 2026-07-06):**
  - **DoD:** DOD-M9INT-1 moved OUT of Tier 0 into a new **"Post-channel — deferred (do AFTER the
    M8C tiers)"** section; Tier 0 is now SPIKE-1 only (✅). `DOD-INV-GATEWAY` re-tagged
    **"(activation: when M9INT lands, after the channel tiers)"** — same pattern as
    INV-HONEST-STATES (Tier 3) and INV-ONE-PRIMARY (Tier 5); it is not satisfiable until the
    gateway exists on main, so the done-auditor must not fail it before then.
  - **PROCEDURE §4:** first action after SPIKE-1 is now **DOD-WAKE-1**, not M9INT.
  - **PROCEDURE §5:** the "M9 seam is untouchable" hard rule is reworded to a **seam-readiness**
    rule — new content paths are built so the later M9 merge wires cleanly; the seam is NOT claimed
    live yet.
  - **SPEC §3/§4, KICKOFF first-actions:** "M9 merged first / Tier 0" language superseded.
- **The one real caveat (recorded, not a blocker):** among the M8C channel tiers, most new pushes
  are **content-free doorbells** (WAKE/MSGWAKE/TGDOOR) or reuse the **existing** inbound/outbound
  points (INBOX/SINCESEQ via `cello_receive`), so they create little-to-no merge debt. The **one
  genuinely new inbound content path is DOD-LEAVEMSG-1 (Tier 4)** — a relay pull that deposits
  content into the recipient's DB. When M9 lands afterward it must route that path through
  `ingestReceivedContent`/`screenInbound`. So: **build LEAVEMSG seam-ready** (funnel its pull
  through `ingestReceivedContent`, the single inbound funnel), and the later M9 merge screens it
  for free. This is a design constraint on LEAVEMSG, not a reason to pull M9 forward.
- **Launch-pillar note (surfaced, Andre's call):** deferring M9 means the **Tier 1 launch gate
  ships without content screening / injection defense** (the "relatively safe" launch pillar). At
  alpha (one trusted operator) that is a legitimate triage call; recorded here so it is a conscious
  decision, not a silent drop. Recommend M9 land soon after launch and **before LEAVEMSG** at the
  latest.
- **Reverse:** if M9 must precede channels again, move DOD-M9INT-1 back to Tier 0, re-tag
  INV-GATEWAY as a live invariant, and restore the §4/§5/SPEC "seam first" wording. Pure reorder.

### D12 — AUTOSTART failure path: fast auto-start + registration precondition, no signaling block (2026-07-06, autonomous D10)

- **Fork:** `cello_use_agent`'s new auto-start — how much does it verify/block to produce the
  structured `agent_start_failed` reasons the DoD lists (`directory_unreachable` / `not_registered`
  / …)? (a) fire-and-forget like `cello_start_agent`, only `agent_not_found`; (b) fast auto-start +
  synchronous registration precondition, surface `directory_unreachable` via `cello status`
  guidance; (c) block up to 15s on `waitForSignalingConnected` to detect `directory_unreachable` at
  `use_agent` time (the `cello_refresh_shares` pattern).
- **Choice (D10 best-practice): (b).** `cello_use_agent` on a loaded-but-offline agent calls the
  extracted `startAgentInternal(name)` (same path as `cello_start_agent`, returns fast). Synchronous
  failure = `not_registered` — detected from the identity store (`reg_status !== 'active'` /
  no `reg_primary_pubkey`; `DbIdentityStore` is already wired in `daemon.ts`) — returned as
  `agent_start_failed { reason: "not_registered", guidance: <register next-step> }` with the
  current-agent selection UNCHANGED (no half-selected state). `directory_unreachable` is NOT blocked
  on: signaling connects asynchronously and self-heals, so it is surfaced via `cello status`'
  `directory_signaling` + ONBOARD-NEXTSTEP guidance ("`connecting` is normal…"), not a scary 15s
  hang on an interactive command.
- **Why:** `use_agent` is an interactive command-surface call driven by a human OR an AI operator;
  a 15s block per call is bad UX and worse for an agent loop. `not_registered` is the high-value
  PERMANENT failure that guidance can actually resolve; `directory_unreachable` is transient. This
  keeps the launch-critical `login → use_agent` collapse snappy.
- **Reverse:** add a bounded `waitForSignalingConnected` in `startAgentInternal` (option c) if
  `directory_unreachable` must surface at `use_agent` time.
- **REVISION (same session, after falsify-first blast-radius check):** `not_registered` is
  **NON-BLOCKING**, not a blocking `agent_start_failed`. Falsify-first found **19 daemon/adapter
  test files start/use agents, only 6 seed registration** — "online without registration" is an
  established capability, and `cello_start_agent` gates on registration nowhere. Making auto-start
  REQUIRE registration would break ~13 test files and change a real contract (the migration trap
  CLAUDE.md warns about). **Final design:** auto-start is PERMISSIVE (mirrors `cello_start_agent`,
  preserves behavior + tests); `agent_start_failed` is the structured wrapper returned iff
  `startAgentInternal` returns `!ok` (with selection left unchanged — the load-bearing "no
  half-selected state" guarantee, tested via the `agent_not_found` path); `not_registered` is
  surfaced as a NON-BLOCKING `warning` on the `use_agent` OK response (agent selected + "run
  `cello register` to enable sessions" guidance) via a one-row `DbRegistrationPersistence`
  `loadRegistrationState()` read. This honors the DoD's onboarding intent without stranding the
  online-without-registration contract. Reverse: to block, gate `startAgentInternal` on
  `reg_status==='active'` and update the ~13 fixtures.

### D13 — Client validates only the token's brand prefix; the directory is the format authority (2026-07-06, ONBOARD reviewer F2)

- **Fork:** ONBOARD-ERRORS-1's client-side malformed-token check — validate the FULL format
  (`CELLO-` + 33 base58, hard-coded regex) for the nicest error, or only the stable `CELLO-`
  brand prefix?
- **Choice (D10):** **prefix only.** The full-format regex is a cross-repo coupling with no shared
  constant — if the directory ever bumps the token version/length/alphabet, valid tokens would hit
  a client-side "malformed" and the user could NEVER register, with nothing pinning the directory to
  today's shape. The `CELLO-` prefix is a stable brand marker (extremely unlikely to change), catches
  the actual R4 friction (pasting the literal words `CELLO_PREAUTH_TOKEN`), and leaves the daemon /
  directory as the authority on the exact format (a wrong-length `CELLO-` token reaches the daemon
  and gets a structured reason). Also fixes the Telegram-vs-portal copy (Andre: the token comes from
  the CELLO Operations Agent on Telegram, not a portal).
- **Reverse:** re-add a stricter client check, ideally importing a SHARED format constant from
  protocol-types rather than duplicating the regex.

### D14 — Config-store-dependent Tier-2 work is gated on M9-CFG-001 (deferred with M9); build the M9-independent units, park the rest (2026-07-06, autonomous D10 — follows from D11)

- **Fork (surfaced during Tier 2):** `DOD-CONFIG-1` is spec'd "on M9-CFG-001's versioned store
  (extend, never a parallel subsystem)", and `DOD-LOGINSTART-1`'s per-agent `autoStart: false`
  opt-out needs that same config store. But the store is `core/gateway/src/config/config-store.ts`
  — it lives INSIDE the deferred M9 gateway package (D11). So those units can't be built cleanly
  without either merging M9 early (contradicts D11) or building a parallel store (the DoD forbids
  it).
- **Choice (D10):** **do NOT build a parallel config store; do NOT pull M9 forward.** Split the
  Tier-2 units by M9-CFG-001 dependency:
  - **M9-independent — build now:** `DOD-MSGWAKE-1` (done), `DOD-SINCESEQ-1` (done),
    **`DOD-LOGINSTART-1` CORE** (login auto-starts all registered agents + enumerate failures — no
    config store needed), **`DOD-CURSOR-1`** (per-connection read cursor + `session_not_current`
    gate — no config).
  - **PARKED until M9-CFG-001 lands (with the M9 merge, post-channel-tiers):** `DOD-CONFIG-1`
    (entirely — it IS the config CLI surface on that store) + its F6/F12 riders, AND
    `DOD-LOGINSTART-1`'s per-agent `autoStart: false` opt-out clause (core ships without it; the
    opt-out is added when the store exists). Recorded in the DoD "Parked decisions" section.
- **Why:** preserves LOGINSTART's launch value (login → all agents online) without a forbidden
  parallel subsystem or contradicting D11. When M9 merges (bringing `core/gateway` + the config
  store to main), CONFIG-1 + the opt-out are built on the real store as intended.
- **Reverse:** if the config store is wanted before M9, extract `core/gateway/src/config/
  config-store.ts` into a standalone package on main (a deliberate forward-port from m9-build) —
  then CONFIG-1/opt-out unblock without the full gateway. That is a real decision (a partial M9
  forward-port), not a silent parallel build.

### D15 — DOD-AWAY-1 ships transparent-only; opaque privacy mode is parked on M9-CFG-001, same as D14 (2026-07-06, autonomous D10)

- **Fork:** `DOD-AWAY-1`'s text specifies THREE things: (a) the away response mechanism +
  per-type templates, (b) "the **configured** (or default transparent) away text" — implying an
  operator-settable override, (c) "**opaque privacy mode** = full silence, indistinguishable from
  unreachable." (b) and (c) are both genuine per-agent OPERATOR PREFERENCES with no sensible
  hardcoded default of their own — they need a persisted, per-agent settings surface to exist at
  all, which is exactly what `M9-CFG-001`'s versioned config store (inside the deferred M9 gateway,
  D11) is for. Building a parallel one-off store for just these two knobs is the same forbidden
  move D14 already ruled out for `DOD-CONFIG-1`.
- **Choice (D10):** ship AWAY-1's CORE now — the auto-response mechanism, per-type templates,
  attended/unattended detection, coalescing — using ONLY the DoD's own explicitly-stated default
  (transparent). This is a real, complete, non-fake behavior on its own (the DoD text itself names
  transparent as the default, not a placeholder). PARK the custom-text override and the
  opaque-privacy-mode switch on `M9-CFG-001`, identically to D14's treatment of `DOD-CONFIG-1` and
  `DOD-LOGINSTART-1`'s opt-out. Recorded in the DoD's "Parked decisions" section.
- **Why:** an unattended CELLO agent must not go silent by default at launch (that's the core
  reachability promise AWAY-1 exists for) — waiting for M9 to ship ANY away behavior would be
  strictly worse than shipping the correct default now and adding the configurability layer when
  the store exists. Mirrors D14's reasoning exactly, just for a different Tier-3 unit.
- **Reverse:** same escape hatch as D14 — if opaque mode / custom text is wanted before M9 merges,
  extract `core/gateway/src/config/config-store.ts` as a standalone package (a deliberate partial
  M9 forward-port), then wire AWAY-1's two parked clauses onto the real store.
- **D15 addendum (cello-unit-reviewer a619ca33, 2026-07-06):** this fork's text names only
  `DOD-AWAY-1`; `DOD-CONTACT-1`'s own "silence in privacy mode" sub-clause (for unknown senders)
  rides the SAME opaque-mode gap and is covered by this same D15 entry — not a separate decision,
  just noted here for hygiene so a future reader doesn't conclude it was missed.

### D16 — DOD-CONTACT-1's presence-visibility clause is deferred — requires a NEW cross-repo protocol, contacts don't sync to the directory today (2026-07-06, autonomous D10)

- **Fork (reviewer a619ca33 finding, HIGH/blocking):** the DoD line's "presence visible to
  whitelisted contacts only" clause was unimplemented with no decision trail — confirmed a silent,
  unjournaled scope gap the reviewer correctly flagged (the same class of issue AWAY-1's opaque-mode
  claim had, except here there wasn't even a false "journaled" claim — just silence).
- **Why this can't be a quick fix:** verified directly (`grep -rn "contact" packages/directory/src/`
  in trustless-cello) — the directory has ZERO awareness of contacts. `DOD-CONTACT-1`'s whitelist is
  stored ONLY in the client daemon's local SQLite (`contacts` table, cello-client). Presence — who is
  shown as online for a given agent — is served entirely by the DIRECTORY today, unconditionally, to
  any querier. Gating presence by contact status would require: (1) a NEW sync mechanism so the
  directory learns (some representation of) each agent's whitelist — itself a privacy-sensitive
  design question (do we sync raw pubkeys? a hash? per-node or federated?); (2) directory-side query
  logic that checks the REQUESTER's identity against the TARGET's synced whitelist before returning
  presence. This is a genuine new protocol surface spanning both repos, not an extension of existing
  code — the kind of work `M8C-PROCEDURE` §6 calls "design-significant" and gates on a design note
  BEFORE code, same as `DOD-PRIMARY-DESIGN-1`.
- **Choice (D10):** ship `DOD-CONTACT-1` CORE (whitelist mechanism, auto-add, minimal-response
  gating, CLI surface — all client-local, real, complete) now. DEFER the presence-visibility clause
  as its own tracked cross-repo item — NOT silently, and NOT folded into an M9-CFG-001 park (this
  isn't a config-store dependency; it's a protocol-surface gap). Board marker: `🟡CORE`, matching
  AWAY-1/LOGINSTART's convention for "core shipped, a named clause intentionally deferred."
- **Why now vs. block:** the core CONTACT-1 value (agents connect coherently; strangers get minimal
  info; known contacts are trusted) does not depend on presence-gating — an agent's mere
  online/offline status leaking to a non-contact is a privacy hardening gap, not a break in the
  core connect-and-communicate promise M8C exists to prove (repo CLAUDE.md Launch Triage: a
  "forgivable" papercut, not "ruins" the experience). Blocking the whole unit on a cross-repo
  protocol design would cost far more than it protects at this stage.
- **Follow-on:** tracked as its own future story (directory-side presence ACL) — needs a design note
  (sync mechanism, privacy model for what the directory learns about an agent's contact list) before
  any code, per §6. Do NOT fold into CONFIG-1/M9-CFG-001 — this is directory-repo work, independent
  of the client-side config store.

### D17 — DOD-TTL-1 ships the 24h default TTL; per-agent configurability is parked on M9-CFG-001 (2026-07-06, autonomous D10)

- **Fork:** `DOD-TTL-1`'s text specifies a "24h default, **configurable**" session-request TTL —
  the configurability is the same shape of gap as D14/D15: a genuine per-agent operator preference
  with no home until `M9-CFG-001`'s store exists.
- **Choice (D10):** ship the CORE mechanism now — `INBOUND_SESSION_TTL_MS` (24h, hardcoded, the
  DoD's own stated default), lazy reap-on-read (no background timer needed), expired requests
  surface via `cello_check_notifications`'s new `expired_session_requests` array rather than
  vanishing silently. PARK the per-agent override on `M9-CFG-001`, board marker `🟡CORE`.
- **Why:** identical reasoning to D14/D15 — the correct default behavior (requests DO expire
  after 24h, and expiry is visible, not silent) is real and complete without configurability;
  waiting for M9 to ship ANY TTL would be strictly worse.
- **Reverse:** same escape hatch as D14/D15/D16.

---

## Related Documents

- [[M8C-SPEC]] — the design these decisions are baked into
- [[M8C-DEFINITION-OF-DONE]] — the yardstick (incl. the Parked decisions section)
- [[M8C-PROCEDURE]] — the runbook
- [[M8C-BUILD-JOURNAL]] — the audit trail
- [[M8C-MILESTONE-NOTES]] — the triage worksheet + verification evidence behind D1–D4
