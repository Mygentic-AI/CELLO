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
  counterparty pubkey + `session_id`, plus routing metadata (agent name, session label — D6).
  No message content or content-derived text ever rides a push (SI-001), through every tier
  including Telegram doorbell. — ✅ (2026-07-08, Round-2 R10 — PROVEN LIVE: a canary payload
  (`CANARY_9f3c_secret_body`) sent through an open session appeared in NEITHER the daemon log
  (only its SHA-256 hash, on both A and B's independent greps) NOR the live `<channel source="cello">`
  push frames captured verbatim on both `session_state_changed` and `cello_message` — both carry only
  `type`/`agentName`/`sessionId`/`counterpartyPubkey`/`from` and a fixed label. Telegram doorbell tier
  not separately re-verified this round — see [[M8C-AB-TEST-ROUND-2]] R10.)
- **DOD-INV-GATEWAY** — **(activation: when M9INT lands, AFTER the channel tiers — see D11.)**
  Every inbound content path passes `screenInbound` and every outbound passes `screenOutbound`.
  The gateway does NOT exist on main until DOD-M9INT-1 is done (deferred — see the Post-channel
  section), so this invariant is not yet satisfiable and the done-auditor must not fail it before
  then. The M8C obligation meanwhile is **seam-readiness**: build every new content path so the
  later M9 merge wires it cleanly (in particular DOD-LEAVEMSG-1 funnels its relay pull through
  `ingestReceivedContent`). — ❌ (not yet activatable)
- **DOD-INV-PUSHPULL** — Every push capability has a pull equivalent. A poll-only client
  (Bedrock, cron) can reach every M8C feature; nothing hard-requires Claude Code push. Push loss
  is always recoverable via `cello_check_notifications` / `since_seq`. — ✅ (2026-07-08, Round-2
  R11 — PROVEN LIVE: 3 messages sent while B deliberately ignored every doorbell push; full
  reconciliation via `cello_check_notifications` (correct pending + unread count) then
  `cello_receive({since_seq})` (all 3, in order, no dupes/gaps) with zero channel pushes consumed.
  Surfaced and fixed a test-script sentinel error along the way (`since_seq:-1` for full history,
  not `0` — `since_seq` means strictly-greater-than) — logged as a residual product note that the
  parameter description should state this. See [[M8C-AB-TEST-ROUND-2]] R11.)
- **DOD-INV-HONEST-STATES** — (Tier 3 activation) A counterparty sees exactly two distinguishable non-answer states:
  *away* (bona fide daemon response) or *unreachable* (silence). Transparent is default; opaque is
  the configured privacy mode; nothing fakes a third state. — ✅CORE (2026-07-08, Round-2 R9 —
  PROVEN LIVE (transparent path): an unattended known contact produced the real request-kind and
  message-kind away texts verbatim, queued and confirmed present in the agent's own inbox; a fully
  offline agent produced a clean `counterparty_unavailable` rejection with no away text and no
  session created — no third, fabricated state observed either way. Opaque privacy mode remains
  untestable — M9-CFG-001-gated, D15. See [[M8C-AB-TEST-ROUND-2]] R9.)
- **DOD-INV-ONE-PRIMARY** — (Tier 5 activation) At most one Primary daemon per agent at any
  moment, directory-arbitrated; no double-accept, no FROST double-sign, no live session
  migration. — ❌

## Tier 0 — Prerequisites

> **⛔ M9 IS NOT A PREREQUISITE. Do NOT merge `m9-build` before the channel work.** The M9 seam
> merge (DOD-M9INT-1) was moved OUT of Tier 0 on 2026-07-06 (Andre — D11). It is now **deferred to
> AFTER the M8C channel tiers** (see the "Post-channel — deferred" section at the bottom). A fresh
> or post-compaction context must not read this milestone and conclude M9 must be merged first — it
> must not. After DOD-SPIKE-1, the next unit is **DOD-WAKE-1**.

- **DOD-SPIKE-1** — The ~30-min de-risking spike: launch `claude --channels` with the live shim,
  trigger a real inbound session, and confirm the daemon's `session_state_changed` frame surfaces
  as an in-context `notifications/claude/channel` event (with a locally-patched shim; no publish
  needed). Outcome journaled: exact flag behavior, event shape, any surprises. **This is the very
  first action of the milestone.** — ✅ (2026-07-06, Entry 3 — PASS. Real daemon + real shim
  binary over raw MCP stdio: all 3 notification types, incl. the target `session_state_changed`,
  surfaced as `notifications/claude/channel` on the shim's stdout; `claude/channel` capability
  negotiated in `initialize`; exact event shape recorded for WAKE. Residual human step: visual
  confirmation inside a live `--channels` chat — flagged, non-blocking, per SPEC §2.)

## Tier 1 — LAUNCH GATE: reactive doorbell

- **DOD-WAKE-1** — Channel stage 1: the shim declares `claude/channel` and forwards daemon
  notification frames (all four types — `agent_state_changed`, `agent_current_changed`,
  `session_state_changed`, and later `cello_message`) instead of dropping them; a live
  `--channels` session receives an in-context event the instant a peer opens a session. Zero
  daemon change; the `connect` bump ships with the Tier 1 close cascade (LIVE-1, per PROCEDURE
  §2a) — WAKE proves against a locally-linked shim until then (D6). Edge ACs: no-attached-client (daemon queues, nothing
  pushes, INBOX reveals on attach); doorbell for a session that seals/aborts before the operator
  reacts is handled gracefully. — ✅ (2026-07-07, Entries 45/46 — LIVE PROVEN on connect 0.0.60: in
  a real two-agent `--channels` session, the receiver's Claude Code turn auto-woke from an unprompted
  `<channel source="cello" type="session_state_changed">` the instant the peer opened the session,
  zero polling, both directions, receive→reply→bilateral seal (matching `sealed_root d80d0ede…`).
  Reverses Entry 43's hard fail; the fix was connect 0.0.60's `buildChannelParams` — the shim had
  omitted Claude Code's required `content` field, Entry 44. Built Entry 6 `d5fd5ec`; unit+integration
  green throughout.)
- **DOD-AUTOSTART-1** — `cello_use_agent` auto-starts the agent if not online (Q1 decided);
  `cello_start_agent` remains for bring-online-without-claiming. The 3-step incantation collapses
  to `login → use_agent`. Failure path (D6): a failed auto-start returns a structured
  `agent_start_failed` with the reason (`directory_unreachable` / `not_registered` / …) plus
  next-step guidance (ONBOARD-NEXTSTEP style) and leaves the current-agent selection unchanged —
  no half-selected state. — ✅ (2026-07-06, Entry 8 — built `245c7b2`/`08b9dae`, daemon-side;
  auto-start via extracted startAgentInternal (CONN-001 preserved byte-for-byte), F18 sole-online,
  F5 state/selected split; reviewer NO SILENT FALLBACKS, 3 findings fixed incl. negative not_registered
  test with teeth. D12 deviations (not_registered non-blocking, directory_unreachable async) journaled.
  **2026-07-07 — AUTO-START PROVEN LIVE:** `cello_use_agent CELLO_Support` on an OFFLINE agent (Agent B
  session) brought it online by itself — status → `state:"online"` + `standing_receiver_ready:true`,
  `agent_state_changed→online/started` push fired, no separate start call. Success path proven; the
  failure-path edge (`agent_start_failed` on a failed auto-start) was NOT exercised. See
  [[M8C-LIVE-TEST-CHECKLIST]] 2a.)
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
  shim was down/busy is discoverable via INBOX on reattach. Unread mechanism (D6): unread =
  transcript seq > a per-agent, per-session `last_delivered_seq` watermark persisted in the daemon
  DB; a `cello_receive` that returns messages advances it (delivery marks read — no ack verb, no
  separate notification store; INBOX derives from this watermark + the already-stateful pending
  session requests). Distinct from CURSOR's per-connection cursor (Tier 2, read-before-write
  gating). — ✅ (PROVEN LIVE 2026-07-07 — `check_notifications` returned a pending request + the unread
  message, discovered on reattach; see [[M8C-LIVE-TEST-CHECKLIST]] 2b. Built 2026-07-06, Entry 11 — `dfc02e8`/`22de42c`, daemon-side; message_watermarks
  table + getUnreadSummary + handleReceive advance + F4 4-way split; reviewer SPEC FAITHFUL 7/7, no
  silent fallbacks, F1 N3-coupling test w/ teeth + F2 received-write error-fidelity fixed, F3
  over-report tracked LOW. Flips ✅ at DOD-LIVE-1.)
  - **Friction rider (F4 — rides free on this surface, verified open 2026-07-06):** split the
    single `sealed_receipt_not_found` into distinct reasons — `session_id_too_short` /
    `unknown_session` / `wrong_agent` / `not_sealed_yet` — and show FULL session IDs on the copy
    surfaces (`cello_list_sessions`, `cello status`) so a pasted ID matches. Decided 2026-07-04,
    still unshipped (`daemon.ts:3141` returns the one conflated reason and still advises
    `cello_close_session`). Not launch-blocking on its own; folded here because INBOX/list is
    where full IDs surface.
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
  real one-liner (it works today via `cello.ts:82` but is invisible in help). (F24, R1, R2, R5) — 🟡 (2026-07-06, Entry 12 — built `448c362`/`af6d9b7`, reviewed SPEC-FAITHFUL.
  **2026-07-07 partially exercised live:** per-command help (`cello create-agent --help`) is REAL + good
  (name rule + next step); but top-level `cello --help` is STILL a bare command list — HELP-1 requires
  BOTH to give real help, so it's half-met. Remaining gap = P2-5 in [[M8C-ONBOARDING-IMPROVEMENTS]]. Stays 🟡.)
- **DOD-ONBOARD-ERRORS-1** — register-path errors are specific and actionable, never a generic
  Usage dump or silence: missing token → "you're missing the pre-auth token" (not the Usage line);
  malformed token → "that isn't a pre-auth token — they start with `CELLO-`"; unknown agent →
  "no agent named X; create it first". **REPRODUCE R4 first** — a bogus token
  (`cello register agent CELLO_PREAUTH_TOKEN`) today returns NO output at all, a silent failure on
  the core onboarding path; repro before the fix. (R3, R4) — ✅ (2026-07-06, Entry 12 — built `448c362`/`af6d9b7`, reviewed SPEC-FAITHFUL. **2026-07-08, Round-2 R12 — PROVEN LIVE:** all 3 bad paths speak clearly and actionably — bogus token literal now explains the `CELLO-` format (was silent, the R4 repro), unknown agent names itself + says create-first, missing token gives a worked example + env-var alternative. See [[M8C-AB-TEST-ROUND-2]] R12.)
- **DOD-ONBOARD-NEXTSTEP-1** — every command output carries succinct next-step guidance + state
  legibility. After `register`: "run `cello status` to confirm your agent is there." State words
  explained: "`connecting` is normal — registration takes a minute or two; `connected` = ready;
  stuck disconnected → `cello logout` then `cello login`; never logged in → `cello login`." Covers
  register / login / status / use_agent at minimum. This is the connective principle under every
  R-item and is what lets an AI operator self-correct. (R7) — ✅ (2026-07-07 — PROVEN LIVE during the cold-onboarding walk: the `register`
  output (agent `CELLO_Feedback`) carried the `cello status` pointer + the `connecting`/`connected`/
  stuck-disconnected legibility, verbatim to this spec, and it successfully guided the operator through
  registration. Built Entry 12 `448c362`/`af6d9b7`, reviewed SPEC-FAITHFUL. Non-blocking follow-ups:
  P2-1 makes the run-on line multi-line; the `login`/`use_agent` guidance clauses were not separately
  re-observed in this walk. See [[M8C-ONBOARDING-IMPROVEMENTS]].)
- **DOD-ONBOARD-WARN-1** — the pre-auth exposure warning is right-sized to what the token IS: a
  single-use, 24h, consumed-on-success token (verified: directory `consumed_at` + "single-use is
  enforced" + `preauth.token.reuse.rejected`). Drop the durable-secret klaxon — at most one calm
  line naming the real, narrow risk: the seconds-long pre-redemption window. Stop pushing the
  env-var form as a *security* fix (shell history + process environ still expose it); if reducing
  exposure actually matters, read from a file/stdin. (R6) **REVISED 2026-07-06 (Andre): the warning is REMOVED ENTIRELY, not right-sized — a single-use/24h/consumed token has no meaningful exposure risk, so the note only drew attention to a non-issue (pure onboarding noise). No warning is correct.** — ✅ (2026-07-06, Entry 12 — built `448c362`/`af6d9b7`, reviewed SPEC-FAITHFUL. **2026-07-08, Round-2 R12 — PROVEN LIVE:** the already-captured Round-1 Phase 4 `register` output (`Ms_Chelly_Hermes`) carries no durable-secret klaxon — just `{"ok":true,...}` and the multi-line next-step guidance. See [[M8C-AB-TEST-ROUND-2]] R12.)
- **DOD-ONBOARD-LOGNOISE-1** — routine directory-signaling reconnect churn
  (`directory.signaling.reader.error` at `warn`, ~every 40–70 min, always recovers —
  `signaling-connect.ts:323`) is logged quietly and marked expected, so a healthy daemon doesn't
  look like it's failing; a genuine sustained outage still stands out. (F11) — ✅ (2026-07-06, Entry 12 — built `448c362`/`af6d9b7`, reviewed SPEC-FAITHFUL. **2026-07-08, Round-2 R12 — PROVEN LIVE:** every `directory.signaling.reader.error` entry in the live daemon log is `"level":"debug"` (not `warn`) and carries `"expected":true` explicitly. See [[M8C-AB-TEST-ROUND-2]] R12.)

- **DOD-LIVE-1 (Tier 1 close / launch gate)** — The live doorbell journey: real daemon, real
  published shim, live `claude --channels` session; a real peer (second daemon) opens a session;
  the operator's Claude wakes in-context, `use_agent` auto-started the agent beforehand, and the
  full receive→reply flow completes. One attended session per agent is the documented launch
  shape (double-wake with two attended sessions is CURSOR's, Tier 2). — 🟠 PARTIAL (2026-07-07,
  Entries 45/46 — the **core doorbell journey is LIVE PROVEN** on published connect 0.0.60: real
  daemon + real published shim + live `--channels` session + real peer opens session + in-context
  wake + full receive→reply→bilateral seal, both directions, zero polling. `latest` promotion DONE
  (2026-07-07 — `npm dist-tag add @cello-protocol/connect@0.0.60 latest`; default unpinned install
  now = the proven combo connect 0.0.60 + cli 0.0.30 → daemon 0.0.32). **Cold-onboarding half —
  2026-07-07 WALKED LIVE:** create-agent→register→status succeeded from the command guidance alone
  (agent `CELLO_Feedback`), so the CLI mechanics are PROVEN. But the gate is NOT clean yet — the walk
  surfaced blockers: the Telegram handoff still names the wrong env var (`CELLO_REGISTRATION_TOKEN`,
  which the CLI does not read) so a literal follower is stuck, plus the register-doesn't-arm-the-
  standing-receiver bug (P2-2). Gate flips ✅ when the onboarding mini-sprint ships. See
  [[M8C-ONBOARDING-IMPROVEMENTS]].)
  - **Onboarding legibility bar (see the ONBOARD-* riders above — ordered before this line because the launch smoke includes them):** the Tier 1 launch smoke
    includes a COLD onboarding run — a fresh operator does `create-agent → register → status`
    with no prior CELLO knowledge and can complete it from the tool output alone (help, errors,
    next-step guidance), without reading source. This is part of the launch gate, not Tier 2.

## Tier 1½ — Cross-runtime interop: a second, non-Claude-Code agent (LAUNCH USE CASE)

> The launch intent's #1 core value (CLAUDE.md launch triage) is "two agents **connect and
> communicate** — including when you control only *one* of them," and "your own two agents connect
> across different devices." Both require proving CELLO works with an agent runtime **other than
> Claude Code**, ideally on **another machine**. Hermes Agent is that second runtime. This is not a
> new protocol capability — it rides entirely on the already-proven channel (WAKE/MSGWAKE) and MCP
> command surfaces — but it is the first proof that those surfaces work for a non-CC operator, and
> it is the vehicle for the off-device test that Round-2 R1 was skipped for (no second device).

- **DOD-HERMES-1 (second runtime — same machine)** — CELLO installs into and drives a Hermes Agent
  instance with **zero changes to hermes-agent**: `cello install hermes --agent <name>` scaffolds a
  CELLO platform adapter (wake, speaking the daemon's Unix-socket IPC directly), registers
  `cello-mcp` as a Hermes MCP server (the 18 `cello_*` commands), drops the `cello-bridge-setup`
  skill, and binds the agent via `CELLO_AGENT_NAME`. A Hermes agent receives a **content-free** wake,
  reads via `cello_receive`, and replies via `cello_send` in a live cross-runtime session;
  read-before-send (CURSOR-1) and Hermes silence tokens (`[SILENT]`) are honored. — ✅ (2026-07-08 —
  LIVE PROVEN: `cello install hermes --agent Ms_Chelly_Hermes` → `hermes gateway` restart → adapter
  bound (`[cello] Connected to the CELLO daemon; bound to agent 'Ms_Chelly_Hermes'`) → `Ms_Chelly`
  (Claude Code) `cello_initiate_session` + `cello_send` → `session_state_changed` wake injected into
  the Hermes gateway pipeline → the Hermes agent read via its cello MCP tools and replied via
  `cello_send` **on the first attempt** → doorbell + content received back on Ms_Chelly's side. A
  follow-up "no reply needed" ack proved the `[SILENT]` suppression path (gateway logged "Suppressing
  intentional silence marker", no spurious send). cello-client `30506b6` + review fixes `b4a1c12`,
  11 tests, gates green on the CLI package. **Scope honesty:** both agents were on ONE local daemon —
  this proves the **second-runtime** leg (a non-CC agent fully operates CELLO), NOT yet the
  second-machine leg. See [[2026-07-09_1915_hermes-agent-integration-plan]] §6.)
- **DOD-HERMES-2 (off-device — THE major use case)** — the same bridge installed on the separate
  Hermes Agent instance **already running on AWS**, giving a genuinely independent second daemon on a
  different machine. Two different identities, two machines, real relay/off-device transport (not
  loopback): a full connect → talk loop across devices, with only one side (the CC agent) under the
  operator's direct control. This is the real launch proof — and installing it there is what
  **unblocks the cross-machine tests below**. — ❌ (bridge not yet installed on AWS Hermes; gated on
  the publish cascade so `cello install hermes` is available on that box. NOT blocked on any missing
  protocol work — the mechanism is proven; only the deployment + a live off-device run remain.)

> **Newly unblocked once DOD-HERMES-2 lands** (these previously had no runnable path for lack of a
> second, independent, non-loopback peer — now they have one):
> - **Round-2 R1** (two *different* identities on two machines) — skipped in Round 2 for lack of a
>   second device; the AWS Hermes daemon is that device.
> - **DOD-RELAYWAKE-1** and **DOD-LEAVEMSG-1** (Tier 4, ledger bucket B — both need a real second
>   daemon + relay + a peer you can take offline/online) — the AWS Hermes instance is exactly that
>   independent peer, making the Round-3 infra-staged runs (S1/S2) genuinely runnable against a live
>   remote daemon rather than a co-located stub.
> - **DOD-LIVE-1's** cross-machine leg — the launch smoke's "real peer on another machine" half.

## Tier 2 — Full reactivity + command surface

- **DOD-MSGWAKE-1** — Channel stage 2: content-arrival callback on `session-node-manager` +
  `dispatchCelloMessage` on the dispatcher + wired in `daemon.ts` + `session_id` in the payload
  (Gaps 3–6). A live session gets an in-context event per inbound message — a real-time chat
  relay. Daemon + adapter bump, publish cascade. **(WAKE-1 reviewer flag F2, 2026-07-06:** the shim
  bridge forwards the daemon `data` blob verbatim — INV-CONTENTFREE is enforced UPSTREAM. When
  `cello_message` routes through that generic hop, re-prove content-freeness against the REAL
  `cello_message` producer, not the bridge; the doorbell must carry type + `session_id` + pubkey
  only, never message content.) — ✅ (2026-07-07, Entries 45/46 — LIVE PROVEN on connect 0.0.60: a
  second, independent `<channel source="cello" type="cello_message">` push arrived unprompted per
  inbound message (distinct from the session-open wake), in BOTH directions, zero polling —
  the real-time chat-relay claim holds end-to-end. Content-freeness re-proven at the real producer:
  the push carries type + session_id + pubkey only (Entry 44's `buildChannelParams` puts routing in
  `meta` + a fixed content-free announcement in `content`; message text never rides). Built Entry 16
  `e4af837`/`5c4071e`; reviewer SPEC-FAITHFUL 6/6.)
- **DOD-SINCESEQ-1** — `cello_receive({ since_seq })`: stateless catch-up from any gap size, no
  replay race; replaces the `cello_get_transcript` workaround for away-then-return. — ✅
  (PROVEN LIVE 2026-07-07 — `cello_receive({since_seq:2})` returned a BATCH of exactly the 3 messages that
  piled up (seq 3/4/5, in order, received-only, no dupes/gaps, one call); see [[M8C-LIVE-TEST-CHECKLIST]] 3a.
  Built 2026-07-06, Entry 17 — `a404d3a`, daemon-side + 1 optional shim param; distinct early
  since_seq branch, durable-transcript batch, watermark-advance, no-regression; reviewer
  SPEC-FAITHFUL, no silent fallbacks, teeth + since_seq:0 boundary locked. Flips ✅ when exercised live.)
- **DOD-LOGINSTART-1** — `cello login` auto-starts all registered agents; per-agent
  `autoStart: false` opt-out; login always completes with failed agents enumerated by reason
  (design-review #8). — ✅CORE (2026-07-06, Entry 19 — built `69fe1ea`/`b7f5f16`, login-command orchestration, ZERO daemon change; auto-start-all + always-complete + failure-enumeration; reviewer SPEC-FAITHFUL, hollow-test fix w/ teeth. The per-agent `autoStart:false` opt-out is PARKED on M9-CFG-001, D14. **2026-07-08, Round-2 R7 — PROVEN LIVE (incidental):** captured from a real `cello logout`/`cello login` cycle done for R2's setup — "Started 4 agent(s): CELLO_Feedback, CELLO_Support, Ms_Chelly, Ms_Chelly_Hermes.", all 4 confirmed online via `cello_status` immediately after, no manual `cello_start_agent`. No failure occurred so the failure-enumeration branch is still unexercised. See [[M8C-AB-TEST-ROUND-2]] R7.)
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
  WhatsApp-group-chat model). — ✅ (2026-07-07 — read-before-write gate PROVEN LIVE: a `cello_send` was
  refused `session_not_current` + `current_seq:0`/`last_read_seq:-1` + catch-up guidance until the caller
  `receive`d. The prior ❌ was STALE — the gate is built and now live-verified. Two-attended-windows
  collaboration scenario not separately run. See [[M8C-LIVE-TEST-CHECKLIST]].)

## Tier 3 — Reachability + protection

- **DOD-AWAY-1** — Away response: unattended Primary answers session requests + messages with the
  configured (or default transparent) away text and queues them; opaque privacy mode = full
  silence, indistinguishable from unreachable; per-type (request vs message) templates. — ✅CORE (PROVEN LIVE 2026-07-07 — an unattended agent
  auto-replied the AWAY text to a known contact's message and queued it (surfaced as unread in the inbox);
  see [[M8C-LIVE-TEST-CHECKLIST]] 3d. Opaque-mode + custom-text still PARKED, D15. Built 2026-07-06, Entry 22/23 — built `10d2d01`/`6bed679`, isAttended + per-type templates + coalescing (cleared on use_agent) + queueing via existing inboundSessionQueues; reviewer (aa5928e2/a9099571) SPEC-FAITHFUL on the core clauses, 3 findings fixed (get_transcript safeCursorAdvance, dedup-clear-on-failure, D15 properly journaled). Opaque-mode + custom-text PARKED on M9-CFG-001, D15. Flips ✅ live.)
- **DOD-CONTACT-1** — Binary per-agent contact whitelist: known = auto-accept; unknown senders
  learn only "dispatched" by default, receipt confirmation in public mode, silence in privacy
  mode; presence visible to whitelisted contacts only. Management (D6): contacts are added by
  operator action — initiating a session to X adds X, accepting X's request adds X — plus
  `cello contact add/remove/list [--agent <name>]`; identity pins to the pubkey at add time
  (directory name = the human handle, resolved then pinned); known stays known until removed. — 🟡CORE (2026-07-06, Entry 23 — built `6bed679`, real `contacts` table + auto-add (K2/K3) + minimal-response gating (K4/K5) + CLI/IPC surface (K1/K6); reviewer (a619ca33) SPEC-FAITHFUL on the client-local clauses, added_at test-teeth fixed. "Silence in privacy mode" PARKED on M9-CFG-001 (D15); "presence visible to whitelisted contacts only" PARKED as a cross-repo directory protocol gap (D16, own future story). Flips ✅ live (client-local clauses only).)
- **DOD-ABUSE-1** — Persistence bounds (the non-M9 remainder): per-session total-size limit
  (anti-drip-feed), bounded unknown-sender queue per sender, global daemon-wide unknown-sender
  cap (anti-swarm). Whitelisted senders bounded only by disk. Per-message cap + outbound rate are
  M9's — not rebuilt here. — ✅ (2026-07-06, Entry 24 — built `b28e6d3`, daemon-side: per-session cumulative-received-byte cap in ingestReceivedContent + per-sender/global active-session acceptance bounds in acceptInboundAssignment, both exempting known CONTACT-1 contacts entirely; reviewer (aeffb82f) found 2 HIGH attacker-controlled bypasses (held-content skipped the cap; 'interrupted' status evaded both acceptance bounds), both fixed `014a8bc` w/ regression tests. **2026-07-08, Round-2 R4 (+ R2's CC-10 interaction) — PROVEN LIVE:** exactly 3 concurrent unknown-sender sessions admitted, a 4th refused server-side (`session.inbound.accept.failed`/`abuse_bound_sessions_per_sender`) despite the initiator seeing `ok:true` — the known initiator-signal gap directly evidenced. See [[M8C-AB-TEST-ROUND-2]] R4.)
- **DOD-TTL-1** — Receiver-side session-request TTL (24h default, configurable); expired requests
  leave the queue and are visible as expired in INBOX. — 🟡CORE (2026-07-06, Entry 24 — built `e1ddb18`, daemon-side: INBOUND_SESSION_TTL_MS (24h) + lazy reap-on-read + expired_session_requests in cello_check_notifications; reviewer (aed2d71f) SPEC-FAITHFUL, found 1 HIGH (unbounded expired-log growth via contact-exempt senders), fixed `af8a701` (capped 20/agent) w/ regression test. Per-agent override PARKED on M9-CFG-001, D17. Flips ✅ live.)
- **DOD-TGDOOR-1** — Telegram Mode 1, doorbell level: daemon-owned bot (token = daemon setting,
  single long-lived `getUpdates` poller), allowlisted operator chat ID, discrete events only
  (session requests, messages-waiting, state changes) pushed to the operator's phone — including
  **cold** (no live agent session). `[agent · session]` header prepended by the daemon. Content
  never rides the doorbell (DOD-INV-CONTENTFREE). Full-monitoring + Mode 2 are OUT (follow-on
  milestone). **Telegram is the ONLY stage-3 platform in M8C** — Slack / Discord / Webhook are
  OUT (follow-on; the daemon-owned-bot pattern extends to each as another adapter, no new
  architecture). See M8C-SPEC §5. Inbound in M8C (D6): allowlisted operator chat → canned
  notify-only one-liner (logged `telegram.inbound.acknowledged`); any other chat → silent drop
  (`telegram.inbound.rejected`); nothing enters CELLO content paths. Doorbell coalescing (D6):
  ring-once-until-read per session (keyed on INBOX's unread watermark); session requests and
  state changes always ring. Tier 5 note: the poller is Primary-only — see DOD-PRIMARY-1. NO
  channel machinery anywhere in this unit — the daemon talks to the Telegram Bot API directly;
  "stage 3" is historical numbering (see SPEC §2, channels mental model). — 🟡 (2026-07-06, Entry 25/26 — built `99d6a53`, design note first (§6); TelegramBotClient interface + HttpTelegramBotClient (M4+ adapter pattern) + injectable test override; new dedicated telegram_settings table; generation-counter-guarded single poller (cold-capable); session-request/state-change always ring, message-waiting coalesced (ring-once-until-read, cleared on cello_receive/since_seq); inbound allowlist-ack vs silent-drop; content-free fixed-label text. Reviewer (a60d68ed) found 2 HIGH silent fallbacks (getUpdates ok:false→[] collapse; unbounded telegramRungUnread) + 2 hollow tests (G1/G7 unexercised), all fixed `446fb74`. Needs a REAL Telegram bot token for the live proof — the ONLY Tier-3 unit that can't be smoke-tested even locally beyond the FakeTelegramBotClient tests. Flips ✅ live.)

## Tier 4 — Async foundation

- **DOD-RELAYWAKE-1** — Check relay on wakeup: on reconnect the daemon asks the directory whether
  any relay holds undelivered frames for its agents (pickup_queue exists; this adds the
  ask-on-reconnect + pull). Messages that arrived while the daemon was fully offline reach the
  operator. Both repos; spine-proven then live. — 🟡CORE (2026-07-06, Entry 27 — built `446fb74`, transport+daemon: SignalingManager.onConnected (fires on every connect/reconnect, best-effort) wired to autoRecoverForAgent on every per-agent signaling reconnect, not just agent-start. Proven at the transport level with a REAL forced reconnect (heartbeat timeout, not simulated) — 3 tests. Covers known-relay reconnects only; the brand-new-counterparty case needs a NEW directory API that doesn't exist in either repo today — PARKED, D19. Flips ✅ live (known-relay case).)
- **DOD-LEAVEMSG-1** — Leave a message (topology per D6 — no daemon ever stores messages for
  someone else's agents): the SENDER's daemon deposits the signed, hashed message at a relay
  (pickup_queue, encrypted to the recipient) when the directory reports the recipient
  unreachable; the RECIPIENT's daemon pulls it via RELAYWAKE on reconnect, then this unit's
  recipient half runs — verify signature/hash, apply CONTACT access control + ABUSE bounds,
  store in own DB, surface via INBOX. Sender half: `cello_send` to an offline known contact
  returns "dispatched to relay," not an error. — 🟡CORE (2026-07-07, Entry 29/30 — design note
  first (§6-spirit): terrain audit found the deposit mechanism (seal+witness+park via CELLO-M7-
  MSG-001 3b) and the recipient-half gates (verify/CONTACT/ABUSE/INBOX, all via RELAYWAKE-1's
  existing `recoverParkedFromRelay` → `ingestReceivedContent` funnel) already existed — genuine
  new scope was ONLY the sender-facing response shaping. Built: `#parkContent` made observable
  (was fire-and-forget `void`, now `async` returning whether the deposit succeeded);
  `sendContent` returns a new `{ok:true, delivered:false, parked:true}` outcome distinct from
  direct delivery, preserving the exact prior `{ok:false}` shape when no relay is configured or
  the park itself fails (regression-locked); `cello_send` surfaces `dispatched_to_relay` with
  guidance, committing the same leaf/transcript position a direct delivery would (the relay
  witness already assigned the sequence via R1 before direct delivery was even attempted). 4 new
  tests (park-succeeds, no-relay regression lock, park-hook-rejects honesty check, full IPC-level
  `cello_send` end-to-end). **Reviewer (2026-07-07) found 1 BLOCKING HIGH: the park hook's
  success/failure contract was throw-vs-resolve, but the production hook never throws on its two
  main failure branches — it logged and resolved normally, so `parked:true`/"dispatched_to_relay"
  could be reported for a message that was never deposited (silent, unrecoverable loss dressed as
  success — worse than pre-LEAVEMSG-1 behavior, since the retry_queue backstop only fires on an
  honest `{ok:false}`). Fixed (`f887dd7`): the hook now returns a typed `{ok:true}|{ok:false,
  reason}` mirroring RetryQueue's ParkFn; a new test drives the exact untested resolved-`{ok:false}`
  shape, confirmed to fail without the fix. Reviewer also flagged a PRE-EXISTING (not introduced
  here, M7-era) HIGH: bare-content parked envelopes skip Ed25519 signature verification, combined
  with relay deposit being intentionally unauthenticated by design — see "Tracked, not M8C-fruit"
  below, PARKED as its own security finding, not silently dropped.** Also in this pass: a
  cello-unit-reviewer HIGH finding from the DOD-M9INT-1 merge review — `ingestReceivedContent`
  becoming async opened a race where two concurrent ingests could jointly exceed ABUSE-1's
  per-session size cap using stale totals — fixed with a post-screen re-check symmetric to the
  existing dedup re-check, verified with a regression test proven to fail without the fix.

## Tier 5 — Multi-daemon (Primary/Standby)

- **DOD-PRIMARY-DESIGN-1** — The device-linking design log exists BEFORE any Tier 5 code: how
  daemon B proves to daemon A it belongs to the same operator (the ECDH handshake's
  authentication story), threat model, and the DB-sync conflict model for two hash-chained
  SQLCipher databases. This is a gate — no PRIMARY code until it's written and journaled. — ✅
  (2026-07-07, Entry 32 — full design log: [[M8C-PRIMARY-DESIGN]]. Grounded in a dedicated research
  pass over existing K_local/FROST storage, directory schema, hash-chain structure, and existing
  crypto primitives. Four decisions: operator-mediated pairing reusing the existing pre-auth-
  capability pattern; one-directional DB-sync snapshot at transfer time (no CRDT); the FROST share
  is MOVED never copied (the load-bearing decision for DOD-INV-ONE-PRIMARY); a new directory table
  `primary_holder` mirroring the existing `agent_presence` pattern for network-enforced ceremony
  gating. Full 5-threat model + explicit INV-ONE-PRIMARY traceability in the linked doc.)
- **DOD-PRIMARY-1** — Same K_local on two daemons via the designed handshake; exactly one Primary
  (directory-arbitrated record); primary-transfer offer (one-time, 2-min TTL) in both directions
  (Standby requests baton; directory offers on unreachable-Primary); user-initiated DB sync;
  DOD-INV-ONE-PRIMARY holds under kill-the-Primary tests. Telegram poller is Primary-only (D6):
  Standby holds the token (settings sync) but polls cold; baton transfer stops the old poller and
  starts the new (handoff overlap absorbed by the 409-retry) — preserves the
  single-`getUpdates`-consumer constraint that decided OQ-1. — 🟠 PARTIAL (2026-07-07, Entry 36/37 —
  the **directory-side arbitration is BUILT + real-FROST tested** (the security core): `primary_holder`
  record (V44) + `primary_transfer_nonce_bindings` (V45) + `#processPrimaryTransferRequest`
  verifying a genuine CONTEXT_PRIMARY_RELEASE ceremony signature, 16 tests green vs. real Postgres,
  reviewer running. Uses the resolved release-attestation design (Entry 35 — reuses the FROST
  ceremony, no new crypto). **STILL OWED**: the **ceremony-gate** (directory consults primary_holder
  before co-signing a normal ceremony — the actual INV-ONE-PRIMARY enforcement, next target);
  daemon-side pairing handshake; user-initiated DB sync; Telegram Primary-only gating; and the
  kill-the-Primary integration proof (needs the live multi-daemon spine — a "needs Andre" item
  alongside DOD-LIVE-1). The Standby-requests-baton transfer direction is built; directory-offers-
  on-unreachable-Primary remains its own deferred sub-design (M8C-PRIMARY-DESIGN "Open items" — a
  live ceremony structurally requires the old Primary reachable, so that path needs a distinct
  non-cooperative design).)
- **DOD-POLICY-1** — Per-daemon policies: same agent, different persona by which daemon is
  Primary (falls out of policies being daemon-local; prove, document, test the transfer
  boundary). — ❌
- **DOD-PORTAB-1** — Session portability: close on A → sync → new session on B with full
  transcript context; interrupted-session seal auto-upgrade (UPGRADE-001) re-proven under the
  multi-daemon setup. — ❌

## Post-channel — deferred (do AFTER the M8C channel tiers; NOT a prerequisite — D11)

> Moved here from Tier 0 on 2026-07-06 (Andre — D11). M9 is done **after** the channel work, not
> before it. The channel tiers do NOT depend on the gateway existing; they only owe **seam-
> readiness** (build content paths so this merge wires cleanly). Recommended landing: soon after
> the Tier 1 launch, and **before DOD-LEAVEMSG-1** at the latest (the one channel unit that adds a
> genuinely new inbound content path).

- **DOD-M9INT-1** — `m9-build` merged to cello-client main; gateway wired at the live seam
  (`screenInbound` at `ingestReceivedContent`, `screenOutbound` at `cello_send`); the **semantic
  gate** passes: m9 gate (`m9-gate-1.test.ts`) re-run green against the merged daemon AND an
  explicit audit that all content paths (M8B-era + every path M8C added) route through the gateway.
  Activates DOD-INV-GATEWAY. — 🟡 (2026-07-07, Entry 28 — merged, commit pending in this session;
  pre-merge baseline confirmed (`m9-gate-1.test.ts` 2/2 green on `m9-build` before merge). Real
  conflicts (not the stale 4 predicted — main had drifted further): `daemon.ts` (3),
  `session-node-manager.ts` (5), `types.ts` (1), `tsconfig.json`, `vitest.workspace.ts` — all
  resolved preserving BOTH main's M8C additions and m9-build's seam wiring (CURSOR-1's gate ordered
  before governance_decisions parsing in `cello_send`; ABUSE-1's size cap ordered before the M9
  screening seam in `ingestReceivedContent`; sessionNodeManager construction de-duplicated —
  m9-build's copy was stale/pre-dated a main refactor that moved construction earlier). One real
  merge bug found+fixed: the sent-transcript record used pre-redaction `contentBytes` instead of
  the actually-sent `sendBytes` on a `redact` verdict — fixed before commit. `ingestReceivedContent`
  became async (M9's screening await) — ~25 call sites across CURSOR/AWAY/CONTACT/ABUSE/TTL/TGDOOR
  test files needed `await` added; all fixed. One stale pre-M8C test assertion
  (`mcp-001-proxy.test.ts`'s static source-string check) updated for both SINCESEQ-1's and M9-FEED-
  001's `cello_send`/`cello_receive` shape changes. One genuine test bug found in m9-build's OWN
  `m9-core-001-seam.test.ts` (not a merge artifact): 16 `cello_receive` polling calls omitted
  `timeout_ms`, silently relying on m9-build's OLD non-blocking receive semantics (pre-dates main's
  DAEMON-004 F1-a blocking-receive fix) — fixed to `timeout_ms: 0` matching the test's own
  poll-for-absence intent. Full gate green: 1733 tests/164 files, lint, typecheck, build. Content-
  path audit: `#handleContentStream` and `recoverParkedFromRelay` (RELAYWAKE-1) both funnel through
  `ingestReceivedContent`; `cello_send`'s IPC handler is the sole outbound funnel. AWAY-1/CONTACT-1's
  canned auto-responses (`sendAwayResponse`) call `sessionNodeManager.sendContent` directly,
  bypassing `screenOutbound` — audited as CORRECT: these send only fixed, hardcoded system literals
  ("Agent is currently away...", "Dispatched."), never user-authored content, so there is nothing
  for PII/secrets/injection screening to check. `cello-unit-reviewer` dispatch pending post-commit.)

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
- **SEC-1 (2026-07-07, flagged by cello-unit-reviewer during DOD-LEAVEMSG-1) — relay-parked
  content authentication gap.** Bare-content parked envelopes (those without the DOD-MSG-4 ordering
  Structure1/2 — the fallback shape `decodeParkEnvelope` accepts) skip Ed25519 signature
  verification entirely; combined with the relay deposit protocol being intentionally
  unauthenticated by design (anyone can seal-and-deposit to a known public identity key —
  `content-park-client.ts`'s own documented design), this means a party who knows a target
  agent's public Ed25519 identity key could in principle inject content into that agent's relay
  mailbox that gets attributed to a real counterparty on recovery. Pre-existing since CELLO-M7-
  MSG-001 (3b) — NOT introduced by M8C or the M9 merge, and not something M8C's channel/reachability
  work touches. Needs its own design pass: either reject bare-content envelopes on recovery
  (requiring every parked entry to carry the ordering record) or add a genuine per-message sender
  signature to the park protocol. Flagging prominently — this is real production crypto-protocol
  attack surface, not a nice-to-have.

- **SEC-2 (2026-07-07, found while scoping DOD-PRIMARY-1's ceremony-gate) — ✅ FIXED, DEPLOYED &
  LIVE-PROVEN (2026-07-08). Was a 🚨 pre-existing CRITICAL forgery hole in the FROST signing path.**
  > **✅ RESOLVED 2026-07-08.** Both halves shipped and live: the **client** now signs every FROST
  > commit/sign request with a K_local Ed25519 `authSig` bound to `(agentPubkey, epochId, framedMsg)`
  > (cello-client `d744778`/`9971769`, daemon 0.0.37 / cli 0.0.34, published + promoted to `latest`);
  > the **directory** verifies that `authSig` before touching its share — missing → `AUTH_REQUIRED`,
  > invalid → `AUTH_INVALID` (trustless-cello `1d730260`/`d9202913`, deployed to all 3 regions via
  > `cello-directory-pipeline`, revision `0e1ed768`). Reviewer verdict: forgery closed, SPEC FAITHFUL /
  > TESTS HAVE TEETH (2 findings fixed: DoS coercion on non-bytes authSig + commit/sign domain
  > separation `0x00` vs `0x01||msg`). **Live-proven end to end 2026-07-08** against the enforcing
  > directory: two real CELLO_Support↔Ms_Chelly sessions established AND sealed bilaterally
  > (`sealed_root 812c6e39…`, both parties `attestation_mode: live`) — session-establishment and seal
  > ceremonies both pass enforcement; legitimate agents work, public-key-only forgery is rejected. The
  > forensic description of the original hole is retained below for the record. See BUILD-JOURNAL Entry 63.
  **NOT introduced by M8C or the Tier-5 work — pre-exists in the M2/M6B/federation FROST signing
  path and affects EVERY agent.** Confirmed by three independent code-reads (a ceremony-gate
  feasibility pass, a FROST-threshold-model check, and an adversarial confirm-or-refute that
  specifically hunted for a saving gate and found none); file:line at every decision point; no live
  proof-of-concept executed.
  - **The hole:** the `/cello/frost/1.0.0` *signing* frames (`frost_commit_request`,
    `frost_sign_request`) are UNAUTHENTICATED — the only gate is an `#isAgentPaused` honor-check
    (`directory-node.ts:1249, 1289`). No K_local challenge (the signaling stream HAS one,
    `CELLO-DIR-AUTH-v1`), no `remotePeer` check, no capability. The directory then signs the
    **arbitrary client-supplied `framedMsg` bytes verbatim** (`frost-handler.ts:592-598`) with no
    binding to a session it brokered or a message it authorized (`peerIdString` is a self-declared
    frame field, never checked against the connection).
  - **Why the client's share doesn't save it:** the FROST group is `(T, N+1)` — N directory nodes +
    1 client — with `T = majority(N) ≤ N`, and the directory enforces quorum `|Q| ≥ T`
    (`directory-node.ts:2676`). So **T directory partials alone reach threshold** without the
    client's share. The honest coordinator always includes its own partial, but that's
    honest-path behavior, not a cryptographic requirement.
  - **The forgery:** a party knowing only an agent's **public** `k_local_pubkey` + epoch (any
    enrolled agent's is discoverable) opens `/cello/frost/1.0.0` to T directories, runs commit then
    sign over an ARBITRARY `framedMsg`, and aggregates a valid signature against the agent's
    `primary_pubkey` — forging session-establishment, seals, any group signature. The sole
    exception is the degenerate single-directory (N=1) 2-of-2 back-compat config, where the client
    share IS required.
  - **Severity-determining question — NOW RESOLVED (2026-07-07), and it RAISES severity: the frost
    protocol IS reachable by arbitrary internet parties.** The directory ALB is `internet-facing`
    (`cello-ecs-directory.yaml:223`) with the libp2p listener on the public endpoint
    (`/ip4/0.0.0.0/tcp/8080/ws`), and libp2p multiplexes ALL protocols over one connection. Any
    internet party completes the Noise handshake (which authenticates peers but does not AUTHORIZE —
    no allowlist) and can then open `/cello/frost/1.0.0`; there is no ALB per-libp2p-protocol filter
    and no in-code gate (SEC-2 confirmed). So the exploit is open to anyone who can reach the
    directory = the internet. No network-level mitigation stands between an attacker and the blind
    signing oracle.
  - **Fix SHIPPED + DEPLOYED + LIVE-PROVEN (2026-07-08 — was "Proposed, PARKED"):** the frost signing
    stream is now K_local-authenticated — the client attaches an Ed25519 `authSig` over
    `(agentPubkey, epochId, framedMsg)` on every commit/sign request, and the directory verifies it
    against the agent's public key before touching its share (a public-key-only attacker cannot
    produce it; the legitimate daemon can). The predicted migration hazard was handled by the correct
    rollout order: client published + promoted to `latest` FIRST, agents reinstalled onto daemon
    0.0.37, THEN the directory enforcement deployed — so no deployed client was broken. (The EC2 demo
    agent is a known laggard, accepted.)
  - This fix was ALSO the prerequisite for DOD-PRIMARY-1's ceremony-gate — see D20, now unblocked at
    the auth-foundation level. Related: SEC-1 (the relay-park bare-content auth gap) is a different,
    narrower pre-existing gap, still open; SEC-2 (the signing path itself) is CLOSED.

## Parked decisions
*(Genuine undecidable forks get parked here + journal + DECISIONS — never silently dropped.)*

- **D20 parks (2026-07-07) — SEC-2 prerequisite now MET (2026-07-08):** the frost-stream K_local auth
  that D20 was waiting on has LANDED (SEC-2 fixed/deployed above), so the ceremony-gate is no longer
  blocked at the authentication foundation. Its remaining pieces (mint/persist/send a `daemon_id`,
  seed `primary_holder` at registration, then the gate itself) can now proceed — they are Tier-5,
  after-launch work, not launch-blocking. Original park text follows for the record.
  DOD-PRIMARY-1's **ceremony-gate** (directory refuses to co-sign for a
  non-current `daemon_id`, enforcing DOD-INV-ONE-PRIMARY) — gated on **SEC-2**'s fix. You cannot
  meaningfully gate ceremony participation on `daemon_id` when the ceremony stream is not
  authenticated as the agent at all; frost-stream K_local auth (SEC-2's fix) is the prerequisite,
  and its downstream prerequisites (mint/persist/send a `daemon_id`, seed `primary_holder` at
  registration) are themselves downstream of that auth decision (an unauthenticated `daemon_id` is
  self-reported and forgeable). The directory-side transfer arbitration (record + verified transfer
  handler) is BUILT + tested independently of the gate; the gate is what remains, blocked. Terrain
  fully mapped in BUILD-JOURNAL Entry 39. See [[M8C-DECISIONS]] D20.

- **D14 parks (2026-07-06):** DOD-CONFIG-1 (entirely) + its F6/F12 riders, AND DOD-LOGINSTART-1's
  per-agent `autoStart: false` opt-out clause — all gated on M9-CFG-001's config store, which lives
  inside the deferred M9 gateway package (D11). LOGINSTART CORE (auto-start all at login) is
  M9-independent and ships now; the opt-out is added when M9 lands. No parallel config store (DoD
  forbids). See [[M8C-DECISIONS]] D14.
- **D15 parks (2026-07-06):** DOD-AWAY-1's operator-configurable away-text override AND its
  opaque-privacy-mode switch (full silence) — both gated on M9-CFG-001's config store, same reason
  as D14. AWAY-1 CORE (transparent-default auto-response + per-type templates + coalescing) is
  M9-independent and ships now. Also covers DOD-CONTACT-1's "silence in privacy mode" sub-clause
  (same opaque-mode gap). See [[M8C-DECISIONS]] D15.
- **D16 parks (2026-07-06):** DOD-CONTACT-1's "presence visible to whitelisted contacts only"
  clause — requires a NEW cross-repo protocol (the directory has zero contact-awareness today;
  contacts live only in the client daemon's local SQLite). Not an M9-CFG-001 dependency — a
  directory-side design surface of its own, tracked as a future story (needs its own §6 design
  note before code). CONTACT-1 CORE (whitelist, auto-add, minimal-response gating, CLI) is
  client-local and ships now. See [[M8C-DECISIONS]] D16.
- **D17 parks (2026-07-06):** DOD-TTL-1's per-agent configurable TTL override — gated on
  M9-CFG-001, same reason as D14/D15/D16. TTL-1 CORE (24h default, lazy reap, expired-visible-in-
  INBOX) is M9-independent and ships now. See [[M8C-DECISIONS]] D17.
- **D19 parks (2026-07-06):** DOD-RELAYWAKE-1's brand-new-counterparty case (a message from a
  sender this agent has NO prior session with) — needs a NEW directory API for relay discovery
  independent of session history, which does not exist in either repo today; a real cross-repo
  protocol design, own future story. RELAYWAKE-1 CORE (re-check known relays on EVERY signaling
  reconnect, not just agent-start) ships now. See [[M8C-DECISIONS]] D19.
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
- [[M9-DEFINITION-OF-DONE|M9 Definition of Done]] — DOD-M9INT-1 (deferred, post-channel — D11, NOT a prerequisite) merges this; its gate re-run is DOD-M9INT-1's semantic gate
