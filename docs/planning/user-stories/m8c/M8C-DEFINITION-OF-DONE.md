---
name: M8C Definition of Done
type: definition-of-done
date: 2026-07-05
milestone: M8C
status: open
description: >
  The yardstick for M8C (command surface, notifications, reactive messaging). Every requirement,
  ordered by tier, with a status tag. The ENFORCERS are (a) the e2e fixture/spine harness for
  daemon-level behavior and (b) a LIVE `claude --channels` session for the in-context hop — a
  line is ✅ only when its journey is green against real binaries, never on a unit test alone.
  Launch gate = Tier 1 complete + live smoke. Pairs with M8C-SPEC, M8C-PROCEDURE,
  M8C-BUILD-JOURNAL, M8C-DECISIONS.
---

# M8C — Definition of Done

## How to use this
- This is the **target**. Find the lowest-numbered line not ✅; that's the next unit.
- **Two enforcers, by layer:**
  - **Daemon/IPC layer** — the e2e harness (extend `packages/e2e-tests/src/session-fixture.ts` /
    the spine harness with non-breaking `opts`; from-scratch fixtures are a blocking review
    finding). Real daemon binary, real IPC socket; assert the actual notification frames, queue
    states, cursors.
  - **In-context hop** — a **live `claude --channels` session** with the real shim. This cannot
    be vitest-proven; a line whose behavior ends inside Claude's context is ✅ only after the live
    journey. Vitest green ≠ done (CLAUDE.md milestone-close rule).
- Tier 4/5 directory-touching lines additionally prove on the 3-directory spine, then live dev.
- Every story implementing a line carries **observability ACs**: named `domain.noun.verb` events,
  required context fields, correlationId threading, error-path coverage. Missing events are
  blocking (/cello-review Step 4c).
- Publish cascade: any shim/daemon change ships via the version-bump procedure (/cello-publish);
  a line that needs a published `connect` is not ✅ until the published artifact works.

## Status legend
- ✅ PROVEN — journey green against real binaries (fixture/spine harness, live channels session,
  or live dev as the line requires).
- 🟡 BUILT / UNVERIFIED-LIVE — code exists + unit-green, not yet proven at the enforcer layer.
- 🟠 PARTIAL — one half built.
- ❌ NOT BUILT — greenfield.

---

## Tier I — Invariants (must hold in every journey, every tier)

- **DOD-INV-CONTENTFREE** — Every notification/wake is a content-free doorbell: `type` +
  counterparty pubkey + `session_id` only. No message content ever rides a push (SI-001), through
  every tier including Telegram doorbell. — ❌
- **DOD-INV-GATEWAY** — Every inbound content path passes `screenInbound` and every outbound
  passes `screenOutbound` — including paths added by M8B after m9-build diverged, and every new
  path M8C adds. No channel/relay feature bypasses the gateway. — ❌
- **DOD-INV-PUSHPULL** — Every push capability has a pull equivalent. A poll-only client
  (Bedrock, cron) can reach every M8C feature; nothing hard-requires Claude Code push. Push loss
  is always recoverable via `cello_check_notifications` / `since_seq`. — ❌
- **DOD-INV-HONEST-STATES** — A counterparty sees exactly two distinguishable non-answer states:
  *away* (bona fide daemon response) or *unreachable* (silence). Transparent is default; opaque is
  the configured privacy mode; nothing fakes a third state. — ❌
- **DOD-INV-ONE-PRIMARY** — (Tier 5 activation) At most one Primary daemon per agent at any
  moment, directory-arbitrated; no double-accept, no FROST double-sign, no live session
  migration. — ❌

## Tier 0 — Prerequisites

- **DOD-SPIKE-1** — The ~30-min de-risking spike: launch `claude --channels` with the live shim,
  trigger a real inbound session, and confirm the daemon's `session_state_changed` frame surfaces
  as an in-context `notifications/claude/channel` event (with a locally-patched shim; no publish
  needed). Outcome journaled: exact flag behavior, event shape, any surprises. **This is the very
  first action of the milestone.** — ❌
- **DOD-M9INT-1** — `m9-build` merged to cello-client main (dry-run verified conflict-free
  2026-07-05); gateway wired at the live seam (`screenInbound` at `ingestReceivedContent`,
  `screenOutbound` at `cello_send`); the **semantic gate** passes: m9 gate re-run green against
  the merged daemon AND an explicit audit that all M8B-era content paths route through the
  gateway (the m9-core-001-seam assertions extended to the current daemon). — ❌

## Tier 1 — LAUNCH GATE: reactive doorbell

- **DOD-WAKE-1** — Channel stage 1: the shim declares `claude/channel` and forwards daemon
  notification frames (all four types — `agent_state_changed`, `agent_current_changed`,
  `session_state_changed`, and later `cello_message`) instead of dropping them; a live
  `--channels` session receives an in-context event the instant a peer opens a session. Zero
  daemon change; `connect` bump published. Edge ACs: no-attached-client (daemon queues, nothing
  pushes, INBOX reveals on attach); doorbell for a session that seals/aborts before the operator
  reacts is handled gracefully. — ❌
- **DOD-AUTOSTART-1** — `cello_use_agent` auto-starts the agent if not online (Q1 decided);
  `cello_start_agent` remains for bring-online-without-claiming. The 3-step incantation collapses
  to `login → use_agent`. — ❌
  - **Friction riders (F5, F18 — first-run legibility, verified open 2026-07-06):**
    - **F18** — when exactly one agent is online and none is selected, tools that need a current
      agent USE it instead of returning `no_current_agent` (today `daemon.ts:2566` and siblings
      hard-error). Removes the "why did it forget my agent" moment after a `/mcp` reconnect.
    - **F5** — `cello status` stops overloading `state` with the value `"current"`: report
      `state: online` plus a distinct `selected: true` so two healthy agents don't read as
      different readiness (today `daemon.ts:1440-1442`).
- **DOD-INBOX-1** — `cello_check_notifications({ scope: "current" | "all" })` returns pending
  session requests + unread messages for the current agent (default) or all loaded agents
  (labelled). This is the **push-loss reconciliation mechanism** (notifications are
  fire-and-forget) and the primary inbox for poll-only clients. AC: a doorbell missed while the
  shim was down/busy is discoverable via INBOX on reattach. — ❌
  - **Friction rider (F4 — rides free on this surface, verified open 2026-07-06):** split the
    single `sealed_receipt_not_found` into distinct reasons — `session_id_too_short` /
    `unknown_session` / `wrong_agent` / `not_sealed_yet` — and show FULL session IDs on the copy
    surfaces (`cello_list_sessions`, `cello status`) so a pasted ID matches. Decided 2026-07-04,
    still unshipped (`daemon.ts:3141` returns the one conflated reason and still advises
    `cello_close_session`). Not launch-blocking on its own; folded here because INBOX/list is
    where full IDs surface.
- **DOD-LIVE-1 (Tier 1 close / launch gate)** — The live doorbell journey: real daemon, real
  published shim, live `claude --channels` session; a real peer (second daemon) opens a session;
  the operator's Claude wakes in-context, `use_agent` auto-started the agent beforehand, and the
  full receive→reply flow completes. One attended session per agent is the documented launch
  shape (double-wake with two attended sessions is CURSOR's, Tier 2). — ❌
  - **Onboarding legibility bar (see the ONBOARD-* riders below):** the Tier 1 launch smoke
    includes a COLD onboarding run — a fresh operator does `create-agent → register → status`
    with no prior CELLO knowledge and can complete it from the tool output alone (help, errors,
    next-step guidance), without reading source. This is part of the launch gate, not Tier 2.

### Tier 1 riders — onboarding & command-surface legibility (LAUNCH-CRITICAL first impression)

> Onboarding is the one moment you don't get twice — the first-connect path is where a prospective
> user decides whether to stay. Through the launch-triage lens a confusing first run is
> **unforgivable** (no core value / trust lost), not a papercut. These riders are cheap — better
> help, clearer errors, next-step guidance, less ceremony; not a rebuild — and gate the launch
> smoke alongside the doorbell. **Serves BOTH human and AI operators**: the AI driving the CLI
> reads next-step guidance and self-corrects without a human, so this is load-bearing for the
> agent-operated path, not a nicety. Source: [[2026-07-02_1130_m8b-e2e-ux-friction-log]] (F-items)
> + the 2026-07-06 registration-onboarding walkthrough (R-items), verified in code 2026-07-06.

- **DOD-ONBOARD-HELP-1** — `cello --help` and `cello <command> --help` give REAL help, not a bare
  command list: what the command does, a worked example, every parameter, and its constraints.
  Concretely: `create-agent` states the name rule (letters/digits/`-`/`_`, 1–64 chars, no spaces —
  the actual `^[a-zA-Z0-9_-]{1,64}$`, today invisible); `register` shows a worked example, says
  quoting is only needed for spaces/metacharacters, explains the create-agent (local) → register
  (directory, needs token) two-step, and documents the `CELLO_PREAUTH_TOKEN` env-var form with a
  real one-liner (it works today via `cello.ts:82` but is invisible in help). (F24, R1, R2, R5) — ❌
- **DOD-ONBOARD-ERRORS-1** — register-path errors are specific and actionable, never a generic
  Usage dump or silence: missing token → "you're missing the pre-auth token" (not the Usage line);
  malformed token → "that isn't a pre-auth token — they start with `CELLO-`"; unknown agent →
  "no agent named X; create it first". **REPRODUCE R4 first** — a bogus token
  (`cello register agent CELLO_PREAUTH_TOKEN`) today returns NO output at all, a silent failure on
  the core onboarding path; repro before the fix. (R3, R4) — ❌
- **DOD-ONBOARD-NEXTSTEP-1** — every command output carries succinct next-step guidance + state
  legibility. After `register`: "run `cello status` to confirm your agent is there." State words
  explained: "`connecting` is normal — registration takes a minute or two; `connected` = ready;
  stuck disconnected → `cello logout` then `cello login`; never logged in → `cello login`." Covers
  register / login / status / use_agent at minimum. This is the connective principle under every
  R-item and is what lets an AI operator self-correct. (R7) — ❌
- **DOD-ONBOARD-WARN-1** — the pre-auth exposure warning is right-sized to what the token IS: a
  single-use, 24h, consumed-on-success token (verified: directory `consumed_at` + "single-use is
  enforced" + `preauth.token.reuse.rejected`). Drop the durable-secret klaxon — at most one calm
  line naming the real, narrow risk: the seconds-long pre-redemption window. Stop pushing the
  env-var form as a *security* fix (shell history + process environ still expose it); if reducing
  exposure actually matters, read from a file/stdin. (R6) — ❌
- **DOD-ONBOARD-LOGNOISE-1** — routine directory-signaling reconnect churn
  (`directory.signaling.reader.error` at `warn`, ~every 40–70 min, always recovers —
  `signaling-connect.ts:323`) is logged quietly and marked expected, so a healthy daemon doesn't
  look like it's failing; a genuine sustained outage still stands out. (F11) — ❌

## Tier 2 — Full reactivity + command surface

- **DOD-MSGWAKE-1** — Channel stage 2: content-arrival callback on `session-node-manager` +
  `dispatchCelloMessage` on the dispatcher + wired in `daemon.ts` + `session_id` in the payload
  (Gaps 3–6). A live session gets an in-context event per inbound message — a real-time chat
  relay. Daemon + adapter bump, publish cascade. — ❌
- **DOD-SINCESEQ-1** — `cello_receive({ since_seq })`: stateless catch-up from any gap size, no
  replay race; replaces the `cello_get_transcript` workaround for away-then-return. — ❌
- **DOD-LOGINSTART-1** — `cello login` auto-starts all registered agents; per-agent
  `autoStart: false` opt-out; login always completes with failed agents enumerated by reason
  (design-review #8). — ❌
- **DOD-CONFIG-1** — `cello config list/get/set [--agent <name>]` on M9-CFG-001's versioned
  store (extend, never a parallel subsystem); tighten-free/loosen-needs-confirmation enforced;
  every M8C-introduced setting (away message, privacy mode, auto-start, TTL, queue caps,
  per-session size limit, Telegram settings, primary-transfer policy) readable + writable. — ❌
  - **Friction riders (F6, F12 — verified open 2026-07-06):**
    - **F6** — directory-node selection becomes a first-class, documented setting/flag, not the
      env-var-only `CELLO_DIRECTORY_URL` (defaults silently to US — `directory-bootstrap.ts:32`).
      This is *deliberate choice* (convenience), NOT redundancy: automatic failover already
      covers node death, including the FINDING-4 random-backup shuffle. Lowest-priority of the
      riders — keep or cut per launch appetite for "I run in Europe, start me on EU".
    - **F12** — `cello status` shows the bound directory (URL + region + peerId + manifest
      version) so you can tell which sovereign node you're on without grepping the daemon log
      (today status carries none of it).
- **DOD-CURSOR-1** — Per-connection, per-session read cursor; `cello_send` refused with
  `session_not_current` + `current_seq`/`last_read_seq` + guidance when the caller hasn't caught
  up; two attended sessions on one agent collaborate coherently (read-before-write, the
  WhatsApp-group-chat model). — ❌

## Tier 3 — Reachability + protection

- **DOD-AWAY-1** — Away response: unattended Primary answers session requests + messages with the
  configured (or default transparent) away text and queues them; opaque privacy mode = full
  silence, indistinguishable from unreachable; per-type (request vs message) templates. — ❌
- **DOD-CONTACT-1** — Binary per-agent contact whitelist: known = auto-accept; unknown senders
  learn only "dispatched" by default, receipt confirmation in public mode, silence in privacy
  mode; presence visible to whitelisted contacts only. — ❌
- **DOD-ABUSE-1** — Persistence bounds (the non-M9 remainder): per-session total-size limit
  (anti-drip-feed), bounded unknown-sender queue per sender, global daemon-wide unknown-sender
  cap (anti-swarm). Whitelisted senders bounded only by disk. Per-message cap + outbound rate are
  M9's — not rebuilt here. — ❌
- **DOD-TTL-1** — Receiver-side session-request TTL (24h default, configurable); expired requests
  leave the queue and are visible as expired in INBOX. — ❌
- **DOD-TGDOOR-1** — Telegram Mode 1, doorbell level: daemon-owned bot (token = daemon setting,
  single long-lived `getUpdates` poller), allowlisted operator chat ID, discrete events only
  (session requests, messages-waiting, state changes) pushed to the operator's phone — including
  **cold** (no live agent session). `[agent · session]` header prepended by the daemon. Content
  never rides the doorbell (DOD-INV-CONTENTFREE). Full-monitoring + Mode 2 are OUT (follow-on
  milestone). **Telegram is the ONLY stage-3 platform in M8C** — Slack / Discord / Webhook are
  OUT (follow-on; the daemon-owned-bot pattern extends to each as another adapter, no new
  architecture). See M8C-SPEC §5. — ❌

## Tier 4 — Async foundation

- **DOD-RELAYWAKE-1** — Check relay on wakeup: on reconnect the daemon asks the directory whether
  any relay holds undelivered frames for its agents (pickup_queue exists; this adds the
  ask-on-reconnect + pull). Messages that arrived while the daemon was fully offline reach the
  operator. Both repos; spine-proven then live. — ❌
- **DOD-LEAVEMSG-1** — Leave a message: daemon accepts + stores (signed, hashed) messages for
  known-contact agents that are offline, surfaces them on reconnect via INBOX; access control per
  CONTACT; persistence per ABUSE bounds. — ❌

## Tier 5 — Multi-daemon (Primary/Standby)

- **DOD-PRIMARY-DESIGN-1** — The device-linking design log exists BEFORE any Tier 5 code: how
  daemon B proves to daemon A it belongs to the same operator (the ECDH handshake's
  authentication story), threat model, and the DB-sync conflict model for two hash-chained
  SQLCipher databases. This is a gate — no PRIMARY code until it's written and journaled. — ❌
- **DOD-PRIMARY-1** — Same K_local on two daemons via the designed handshake; exactly one Primary
  (directory-arbitrated record); primary-transfer offer (one-time, 2-min TTL) in both directions
  (Standby requests baton; directory offers on unreachable-Primary); user-initiated DB sync;
  DOD-INV-ONE-PRIMARY holds under kill-the-Primary tests. — ❌
- **DOD-POLICY-1** — Per-daemon policies: same agent, different persona by which daemon is
  Primary (falls out of policies being daemon-local; prove, document, test the transfer
  boundary). — ❌
- **DOD-PORTAB-1** — Session portability: close on A → sync → new session on B with full
  transcript context; interrupted-session seal auto-upgrade (UPGRADE-001) re-proven under the
  multi-daemon setup. — ❌

## Tracked, not M8C-fruit (bigger friction — own items, NOT folded in as riders)

These surfaced in the same friction sweep but are NOT cheap ride-alongs — each is real work with
its own design surface. Recorded so they don't fall through the cracks; pull into a tier (or their
own story) deliberately, never smuggled in as a rider. Source:
[[2026-07-02_1130_m8b-e2e-ux-friction-log]].

- **F7** — `cello daemon restart/reload`, and changing directory without bouncing the daemon
  (today a restart drops every MCP connection). Lifecycle work.
- **F9** — connected-client visibility + reap: `cello status` shows who's attached; a cleanup path
  for stale connections (orphan processes contend for the SQLite write lock). Needs a daemon
  connection registry — the visibility half is cheap, the reap half is not.
- **F21** — terminal failure state + surfaced reason for a stuck unilateral seal (today
  `seal_pending_bilateral` returns forever with no reason). Directory-side.
- **F22** — standing receiver on its own port so a ready receiver coexists with an active session
  (fixed port 4001 caps the demo at one concurrent onboarding). Concurrency redesign.
- **R4 repro** — the bad-token silent-output bug feeding DOD-ONBOARD-ERRORS-1 needs a live
  reproduction before its fix; tracked on that line, noted here.

## Parked decisions
*(None yet. Genuine undecidable forks get parked here + journal + DECISIONS — never silently dropped.)*

- OQ-2 (operator-input cadence: daemon-mediated real-time gates vs agent-loop poll), OQ-3 (reply
  @-addressing) — parked WITH Mode 2 (out of M8C, follow-on milestone).
- OQ-4 (full Telegram settings knob list) — resolves inside DOD-CONFIG-1 + DOD-TGDOOR-1 scoping.

---

## Related Documents

- [[M8C-SPEC]] — the design: reactive core, daemon-owned bot, tiers
- [[M8C-PROCEDURE]] — the runbook: per-unit loop, enforcers, publish cascade
- [[M8C-BUILD-JOURNAL]] — audit trail and status board
- [[M8C-DECISIONS]] — the scope/tier decisions and OQ resolutions
- [[M8C-MILESTONE-NOTES]] — inventory + verification pass (evidence for every "already built" claim)
- [[M9-DEFINITION-OF-DONE|M9 Definition of Done]] — Tier 0 merges this; its gate re-run is DOD-M9INT-1's semantic gate
