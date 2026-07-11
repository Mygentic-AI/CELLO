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

## Tier 1½ addendum — moniker defects found live (2026-07-09, after the tier closed)

- **DOD-MONIKER-6** — The offered-name box is scoped to the agent it was written for. Today
  `offeredMonikers` (`daemon.ts:4260`) is ONE daemon-wide map keyed by `sessionIdHex` alone, so on a
  shared daemon the **initiator reads the receiver's box and is shown her own name** as the sender
  (confirmed live: `moniker.resolved … agentName:"Ms_Chelly" source:"offered"`). Same cause makes the
  two delete sites cross-agent. Key by `(agentName, sessionIdHex)` at all four sites (`:4597` write,
  `:1070` read, `:1099` + `:4327` deletes). Two-machine setups are unaffected — which is why the tier
  tested green. Full flow + ACs: [[M8C-MONIKER-SPEC]] §10. — ✅ **BUILT + REVIEWED**
  (cello-client `0729ca5`; AC1/AC2/AC3 all covered, red-first, in `moniker-2-inbound-offer.test.ts`.
  Reviewer confirmed no sibling map shares the defect class — `telegramRungUnread` was already
  agent-scoped, `inboundSessionQueues`/`expiredSessionRequests` are keyed by agent at the top level.
  **SHIPPED**: `daemon@0.0.39`, promoted to `latest` 2026-07-09; verified in the binary —
  `dist/daemon.js` has all four `offerKey(agentName, …)` sites and zero bare session-id accesses.
  🏁 **LIVE-PROVEN 2026-07-09 (T6)** — `Ms_Chelly` → `Ms_Chelly_Hermes` on ONE daemon (pid 44970,
  daemon 0.0.39, Node 24.15.0). Her doorbell read `who="agent 77d0c806…" whoKnown=false` — the
  counterparty's fingerprint, NOT her own name. Daemon log, positive proof both directions:
  `moniker.resolved agentName=Ms_Chelly_Hermes source=offered` (receiver reads its own box) and
  `moniker.resolved agentName=Ms_Chelly source=fingerprint` (initiator degrades).
  **Proven SYMMETRICALLY:** Hermes then called back (session `3c6d6c06…`), reversing the roles — and
  `agentName=Ms_Chelly_Hermes source=fingerprint` (initiator degrades), `agentName=Ms_Chelly
  source=offered` (receiver reads her own box). Both initiators degrade; both receivers read their own
  box; same two agents, same daemon, opposite roles.
  ⚠️ **The bug's signature is role-dependent, NOT a grep string.** `source=offered` is CORRECT for a
  receiver and WRONG only for an initiator. `moniker.resolved` carries no sessionId, so it cannot be
  classified without knowing who opened that session. A naive grep for `agentName=Ms_Chelly
  source=offered` flags three correct lines as bugs.
  Sealed root `d317339e53ab60d1e51382e730e2562a42e1ca2c173835ee904bf67edd7e4448`.)
- **DOD-HERMES-3** — The Hermes wake sentence surfaces the resolved name. The adapter's `_wake_prompt`
  (cello-client `core/cli/src/hermes/assets.ts`) predates monikers and never reads `who`/`whoKnown`, so a
  Hermes agent sees raw hex forever and every name an operator sets is invisible to it. The pubkey must
  stay in the sentence beside the name — Hermes has no metadata layer. [[M8C-MONIKER-SPEC]] §12. —
  ✅ **BUILT + REVIEWED** (cello-client `519dc68`, review fixes `7612970`; `_render_who` mirrors the
  Claude Code shim's `renderWho`. Tests execute the real Python against a stubbed `gateway`.
  **SHIPPED**: `cli@0.0.36`, promoted to `latest` 2026-07-09; verified in the binary —
  `dist/hermes/assets.js` has `_render_who` and both regex sites on `.fullmatch`.
  🏁 **LIVE-PROVEN 2026-07-09 (T7)** — after `cello install hermes` re-scaffolded the plugin copy,
  Hermes pasted its wake sentence verbatim:
  `CELLO wake: a new message arrived on session 2a8647ca… from "Ms_Chelly" (self-declared) (counterparty
  pubkey 178d420b86beb79d2cd819647368d3e24739dcfa526a95f32c0e95ba3bc3e44c).`
  Name LEADS (AC1), pubkey rides beside it (AC2 / §11), unverified name marked as a claim (AC3).
  **Per-host step, not a one-time fix:** the plugin is a COPY in `~/.hermes`, never a live import, so
  every Hermes host needs `cello install hermes --agent <name>` + `hermes gateway restart`.)

> **Future direction "C" (agreed, NOT scheduled):** the offered name should move into the receiver's
> contacts **on accept**, and the box should retire — see [[M8C-MONIKER-SPEC]] §13. It delivers the
> feature's actual purpose (you learn who you're talking to, persistently) and makes DOD-MONIKER-6's bug
> structurally impossible. Two conditions: provenance must survive the save (a stranger's self-chosen name
> must not silently become a trusted one), and auto-accept paths must decide deliberately whether they
> save. Injection and name-collision were examined and dismissed — do not re-litigate. Also
> [[M8C-MONIKER-SPEC]] §11: **the pubkey must always ride on the notification**; every simplification in
> the moniker design depends on it.

## 🔴 Phantom session — the first-connect race (D1–D4)

**Found 2026-07-10 by chasing "2 unread messages I can never read."** Full evidence, anchors, ACs,
red-first tests and ordering: [[M8C-PHANTOM-SESSION-FIX-PLAN]]. Do not re-derive — it is written to be
executed cold.

Initiating to an agent whose **standing receiver has not come up yet** produces an asymmetric session:
the initiator refuses (correctly) and gets `counterparty_unavailable`; the receiver builds a session
anyway and auto-replies into a void; the reply lands in the initiator's `transcript` with no `sessions`
row and becomes permanently unread AND unreadable. Proven: the daemon log holds exactly **2**
`session.offer.abort reason=standing_receiver_unavailable` events and exactly **2** stuck sessions,
and they correlate one-to-one.

- **DOD-INBOUND-GUARD-1** (D3, do first) — the receiver refuses an assignment whose
  `counterparty_session_peer_id` is absent: no session node, no DB row, no accept, no away response;
  logs `session.inbound.assignment.incomplete` at warn. The directory already OMITS that field (and
  `transport_mode`) when nobody accepted, so the receiver has everything it needs — it just never reads
  it (`extractInboundSessionAssignment`, 0 occurrences). Mirrors the initiator's M8B F13 guard.
  ⚠️ Three existing test files inject frames without that field and expect acceptance — they encode the
  bug (eleven, it turned out — Entry 77). cello-client, daemon-only, no deploy. — 🟡 built + reviewed +
  merged to cello-client main (`e8c4891` + `8bf8486`, 2026-07-10; unit-reviewer verdict SPEC FAITHFUL,
  one test-gap finding fixed). ✅ at the live invariant check (`count(session.offer.abort) > 0 AND
  count(session.inbound.accepted for those ids) == 0`, log filtered on daemon start — Entry 76 trap)
  once a published daemon carries it. 📦 **NOW CARRIED — daemon 0.0.46 / v0.0.94 (2026-07-11): commit
  `e8c4891` verified an ancestor of the tag; `session.inbound.assignment.incomplete` +
  `extractInboundSessionAssignment` verified present in `dist/`. Flip pending only the live invariant grep
  on the running 0.0.46 daemon log.**
- **DOD-OFFER-REJECT-1** (D1) — the responder sends a `session_offer_reject` instead of returning
  silently on `standing_receiver_unavailable`, so the directory fails fast instead of stalling 2 s and
  fabricating. This is the `Generic Reject` of [[2026-07-08_inbound-state-matrix]], arriving as a
  protocol necessity. Daemon half is inert until the directory understands the frame. — 🟡 daemon half
  built + reviewed + merged to cello-client main (`8becaa7` + `94d08f0`, 2026-07-10; review found F1
  blocking — the production seam's `sendRaw` resolves `{ok:false}` instead of throwing, so a failed
  reject logged `reject.sent`; fixed on BOTH the reject and the pre-existing accept path). ✅ when the
  directory half (D2) understands the frame. 📦 **Daemon half NOW SHIPPED — 0.0.46 / v0.0.94 (2026-07-11):
  commit `8becaa7` verified an ancestor; `session_offer_reject` present in `dist/`. Flip still gated on the
  3-region directory deploy (D2, Andre's deploy.sh call) — the frame is inert until the directory decodes it.**
- **DOD-DIR-FAILCLOSED-1** (D2, the correct root fix) — the directory must **never FROST-sign or
  distribute an assignment with an empty counterparty endpoint**. On offer-accept timeout it returns a
  `session_request` failure to the initiator and sends **nothing** to the target. Today it "proceeds
  with empty defaults" (`directory-node.ts:3355-3400`) — a silent fallback that mints a validly-signed,
  structurally invalid artifact. **Do not merely raise the 2 s timeout**; that narrows the race without
  closing it. trustless-cello; 3-region deploy ~25-30 min; batch it. ⚠️ **D1-review F2 (2026-07-10):**
  `session_offer_reject` never reaches the directory's dispatch chain — `decodeInboundSignalingFrame`
  (`directory-frames.ts:409`) is a typed allowlist returning null on unknown types (today the directory
  replies `not_authenticated`, which the daemon harmlessly drops). D2 must add the frame to the
  **decoder allowlist**, not just the dispatch chain — a dispatch branch alone would never fire. —
  🟡 built + reviewed + merged, BOTH halves (trustless-cello `1ccd08a5`; cello-client `aa34b81`),
  2026-07-10. Guard returns before the TBS build and the only `participateInCeremony`, so **no FROST
  signature over a 5-field TBS can be produced on the offer-attempted path** (reviewer-verified).
  `session_offer_reject` is in the decoder allowlist with target-only sender validation; the waiter
  resolves on it (no 2 s stall); the 2 s literal is a named constant carrying "raising this is NOT
  the fix". Unit-reviewer found one HIGH cross-repo gap, fixed: **three** separate reason allowlists
  collapsed `counterparty_did_not_accept` to `directory_unreachable` — blaming a healthy directory
  for a counterparty that declined. The live one is the daemon's `sessionRequestErrorReason`; the
  client's `mapSessionRequestErrorFrame` was also swallowing `agent_revoked`/`agent_suspended` since
  M7/M8. ✅ **awaiting the 3-region deploy — Andre's call, Ms_Chelly runs it. Do not run deploy.sh.**
  📦 **Daemon-side half (decoder allowlist, reject-waiter, `counterparty_did_not_accept` reason fix) NOW
  SHIPPED in 0.0.46 / v0.0.94 (2026-07-11); the root fix is directory-side (`1ccd08a5`, trustless-cello)
  and remains UNDEPLOYED — this line does not move until the 3-region deploy runs.**
  — Entry 85
- **DOD-UNREAD-1** (D4, **DECIDED 2026-07-10 — producer-first**) — a received `transcript` row with no
  `sessions` row is counted unread (`getUnreadSummary` never joins `sessions`) but `cello_receive` returns
  `session_not_found`, so it can never be cleared. **Materialising the session (option b) is REJECTED**:
  the daemon wrote that row with `senderPubkey = "unknown"` (`session-node-manager.ts:2745`) and
  `transcript` has no counterparty column, so (b) would invent a session the initiator refused, *with no
  counterparty*. **D4a (primary):** never write a transcript row for a session with no `sessions` row —
  log `session.content.orphaned` at warn and drop, or quarantine visibly. Never record content you cannot
  attribute. **D4b:** `cello_receive` with `since_seq` reads the durable transcript without a `sessions`
  row (it already does; only an early return blocks it), reports `from: null`, advances the watermark.
  **🚫 Do NOT join `sessions` in `getUnreadSummary`** — that hides a really-delivered message.
  **INVARIANT:** `getUnreadSummary` and `cello_receive` must agree on what a session is; any fix that
  leaves those two authorities disagreeing recreates this bug in a new shape. — 🟡 built + reviewed +
  merged to cello-client main (`2e9eb5d` + `40d0a33` review fixes, 2026-07-10; unit-reviewer: SPEC
  FAITHFUL incl. the INVARIANT — "no state found where the summary counts what since_seq can't read";
  D4a = drop, loudly; review F1 fixed: a failed session-row write now fails creation ONCE with
  `session_persist_failed` instead of leaving a live-but-rowless session that refuses everything).
  ✅ when the two live stuck messages on Andre's machine (`5749859a…`, `3d3311c8…`) are actually read
  and `total_unread` hits 0 by delivery, on a published daemon. 📦 **NOW SHIPPED — 0.0.46 / v0.0.94
  (2026-07-11): commit `2e9eb5d` verified an ancestor; `session.content.orphaned` + `session_persist_failed`
  present in `dist/`. LIVE EVIDENCE 2026-07-11: `cello_check_notifications` on the running 0.0.46 daemon
  shows BOTH originally-stuck ids (`5749859a…`, `3d3311c8…`) GONE from the unread set — under the old bug
  they were permanent, so this is direct evidence D4 cleared them; remaining unread is the healthy readable
  kind (real session rows). Full ✅ = one targeted `cello_receive` confirming a counted-unread is now
  readable (the getUnreadSummary↔receive invariant).** — Entry 81

- **DOD-SENDRAW-1** (found 2026-07-10 while verifying D1; **do AFTER D4**) — `SignalingManager.sendRaw`
  (`core/transport/src/signaling-manager.ts:325`) has **zero `throw` statements**: it catches internally
  and resolves `{ok:false, reason}`. Every `try { await sendRaw(...); log("…sent") } catch { log("…failed") }`
  therefore **lies in both directions** — the success line always fires, the failure line never can.
  Three sites remain: `session-ceremony.ts:502` (`seal_frost_signature` — logs `.sent` unconditionally,
  **inside the seal/non-repudiation ceremony**), `session-ceremony.ts:676` (`ceremony_result` —
  `session.ceremony.reply.failed` can never be emitted), `daemon.ts:4844` (`trust_signal_ack` — result
  discarded entirely). Already correct: `daemon.ts:1258/1332/2092`; confirm `seal-upgrade.ts:129` branches.
  **Fix the class, not the sites:** a lint rule banning a bare `await sendRaw(` whose result is unused, or
  a `sendRawOrThrow` for callers that want the exception. Red-first, and **drive the fake from the
  resolve-`{ok:false}` contract, never a throw** — a fake that threw is exactly what let this hide.
  Not launch-blocking (an observability lie, no data loss), but it has already misled a debugger once. —
  ✅ SHIPPED (was 🟡) — built + reviewed + merged to cello-client main (`5156189` + `2e701c3` review fixes, 2026-07-10;
  unit-reviewer: SPEC FAITHFUL. All three sites branch on `res.ok`; the LINT rule flagged exactly the
  three known sites pre-fix and now also bans the void-wrapped/bare-floating shapes and covers
  `sendSignalingFrame`; `guidance` (the specific cause) threads into every failure log — review F2).
  Declared gap: the `trust_signal_ack` branch has no in-process test (needs the full trust-signal
  path); the lint rule + the two tested sites pin the shape. ✅ **PUBLISHED 2026-07-11 in daemon 0.0.46
  (tag v0.0.94): commit `5156189` verified an ancestor of the tag AND `session.ceremony.reply.failed` (the
  log that could never fire pre-fix) verified present in the published `dist/`. This observability-fix
  line's enforcer is shipping + unit tests — both met; rides the running daemon.**
  Follow-up noted, not owed here: `dispatchManifestPoll`'s best-effort poll logs nothing per failed
  attempt (designed retry; the reconnect path is the loud signal). — Entry 82

- **DOD-LOGOUT-WAIT-1** (found live by Andre 2026-07-10; done BEFORE D2) — **`cello logout && cello
  login` leaves the operator logged OUT while printing "Daemon already running."** `logout`
  (`core/cli/src/commands.ts`) returned the instant the shutdown request was *written*; `connectOrStart`
  (the consumer — correct) then saw a still-alive pid + connectable socket and reported
  `alreadyRunning`, spawning nothing; the daemon finished dying a moment later. **"Daemon stopped." for
  a daemon that is still running is `DOD-SENDRAW-1`'s lie at the CLI surface.** ⚠️ The separate-lines
  "workaround" is not a fix — it only works because human typing outlasts the shutdown; `logout; login`
  in a script races identically. Fix belongs in the PRODUCER (`logout`), never the consumer. —
  ✅ SHIPPED (was 🟡) — built + reviewed + merged to cello-client main (`167bb49` + `57e6151` review fixes, 2026-07-10;
  unit-reviewer: SPEC FAITHFUL, both declared deviations verified sound against `connectOrStart`'s
  actual branches). logout now prints "Shutting down the daemon…" immediately, polls (50 ms, 5 s bound)
  until the daemon is genuinely gone, prints "Daemon stopped." only then, and on timeout **fails loud**
  (exit 1, names pid + socket + guidance, never the success line); a stale lock is reported and removed.
  Review F1 was blocking: the fail-loud branch had zero coverage — a timeout printing the success line
  passed the suite. ✅ **PUBLISHED 2026-07-11 in cli 0.0.44 (tag v0.0.94): commit `167bb49` verified an
  ancestor of the tag AND `"Shutting down the daemon"` verified present in the published `dist/`;
  additionally exercised live this session (`cello logout && cello login` during the migration recovery,
  which completed cleanly). — Entry 83

> **Triage:** the trigger is connecting to an agent that just started — a first-connect race, and the
> launch pitch is "two agents connect." The initiator is told the counterparty may be offline when it
> IS online. D3 is small, local, needs no deploy, and removes the phantom session; do it regardless of
> when D2 is scheduled.

## 🔴 DOD-AGENT-ID-JOINKEY-1 — the six session tables join on a MUTABLE key (2026-07-10)

**Found while asking whether an agent can be renamed.** `agent_name` was the original PK; `REMOVE-001`
added the stable `agent_id` **to make names reusable** and migrated only the parent `agents` table — the
six children (`sessions`, `seal_interrupted_artifacts`, `session_tree_leaves`, `transcript`,
`message_watermarks`, `contacts`) still join on the now-mutable, reuse-freed name. The same commit's
comment declares the name "a mutable ATTRIBUTE" while six FKs point at it. Full story, ACs, and hazards:
[[2026-07-10_agent-id-joinkey]].

**Confirmed hazard:** retire an agent (rows KEPT, name FREED), create a new one with that name (fresh
pubkey) → the new identity's `WHERE agent_name=…` queries return the DEAD identity's transcript, contacts,
and interrupted sessions; resuming one would seal with a different keypair. Also blocks agent rename.
No remote actor — `agent_name` never crosses the wire (AC1 proves it).

**Safe, unlike June-26:** purely client-side and purely ADDITIVE — `ADD COLUMN agent_id` + backfill from
the local `agents` table + re-point joins. **No DELETE/TRUNCATE/purge**, no value the directory replicates
changes (it keys on `k_local_pubkey`, has no `agent_name` — consistent with the PII-free directory
policy). The retire-reuse orphans need no purge: on an `agent_id` join a new same-named agent simply never
matches them.

- **DOD-AGENT-ID-JOINKEY-1** — carry `agent_id` into the tables as the join key; `agent_name` becomes
  display-only. AC1 wire-proof gates it. Client-side, no deploy. **Blocks the address-book tables** — they
  must be born on `agent_id`. — ✅ **BUILT + REVIEWED + SHIPPED** (cello-client `173d34f`, published
  `daemon@0.0.45` / `cli@0.0.43`, tag `v0.0.93`). AC5 found the **SEVENTH** table (`retry_queue`) — all
  seven re-keyed in one transactional rebuild; `retry_queue`'s cross-agent collision→loss fixed; agent
  rename unblocked. Reviewer caught a real regression (a retired agent's kept session row made the
  half-open reaper throw `agent_id_unresolved` for the whole daemon) — fixed with an INNER JOIN excluding
  retired agents, red-first. Full suite 1946 green, verified independently. **LIVE-PROVEN 2026-07-11** on
  Andre's real DB: a genuine retire-reuse (`Ms_Chelly` retired 06-26, name reused 07-06) tripped the
  ambiguity guard on the first `cello login` onto 0.0.45+ (correct fail-closed abort, DB untouched); after a
  one-row hand-fix (below) the backfill re-keyed **11 agents / 133 sessions** clean and the tier migration
  grandfathered 6 contacts. The abort's only documented recovery is "resolve by hand or wipe" — hardening in
  `DOD-MIGRATION-AMBIGUITY-RESOLVE-1`.

- **DOD-MIGRATION-AMBIGUITY-RESOLVE-1** (found live 2026-07-11) — the `agent_id` backfill's abort on a
  reused name has **no automated recovery**: it tells the operator to "resolve by hand or start from a fresh
  database." Fine on a developer's machine with DB access; **unforgivable for a real operator** who ever
  retired-and-reused an agent name — their daemon won't start on upgrade and "wipe your DB" loses their
  identity + history. Needs an automated path before broad launch: **timestamp auto-attribution** (a retired
  agent cannot write, so rows postdating the reusing agent's creation provably belong to it — the strategy
  `agent-id-migration.ts` explicitly parks) and/or a `cello repair --disambiguate <name>` subcommand doing
  the safe rename/attribution. Not a fresh-user blocker; blocking for any reuse operator. Incident + the
  hand-fix that unblocked Andre: [[2026-07-11_retire-reuse-migration-incident]]. — ⏳ **BACKLOG.**

## 🔴 Daemon singleton — multiple daemons, one database (2026-07-10)

**Observed live, not theorised:** three `cello-daemon` processes at once; `lsof` showed **two holding
`sessions.db` open together**. Killing the orphan left the healthy daemon with **no lock file and no
socket** — unreachable and invisible. Full evidence, ACs and red-first tests:
[[2026-07-10_daemon-singleton-defects]].

The cascade is self-propagating: an exiting daemon unlinks `daemon.lock` and `daemon.sock` **without
checking it still owns them** → `cello logout` truthfully reports "No daemon running" → `cello login`
spawns a second daemon beside the live one → killing either disarms the survivor. **The obvious recovery
action makes it worse.** `DOD-LOGOUT-WAIT-1` cannot help: there is nothing left to wait for.

`sessions.db` IS SQLCipher-encrypted (verified: header `c52522ee…`, not `SQLite format 3`), and SQLCipher's
WAL locking is multi-process safe — so the **file** does not corrupt. Everything above it assumes a single
writer: hash-chain leaf indices allocated read-compute-write (a duplicated index is a broken transcript
**that the seal then attests to**), two daemons running the same agents with two directory signaling
streams for one pubkey, two processes holding the same FROST share, double-accept. No damage observed.

- **DOD-DAEMON-CLEANUP-1** (do first) — an exiting daemon unlinks `daemon.lock` only if the lock's pid is
  its OWN, and removes `daemon.sock` only if it created it. Otherwise it leaves them and logs
  `daemon.lock.not_ours`. Two conditions, near-zero risk. **This is the propagation mechanism.** Test with
  a REAL spawned binary — an in-process daemon shares the test's pid and cannot reproduce it (the same
  trap that made `DOD-LOGOUT-WAIT-1`'s first AC2 hollow). — ❌
- **DOD-SINGLE-DAEMON-1** — the daemon takes an **exclusive OS lock** (`flock`/`O_EXLOCK`) at startup and
  holds it for its lifetime; the OS releases it on death, so a `kill -9` leaves nothing stale. A second
  instance exits non-zero naming the holder's pid, and never opens the DB, registers agents, or connects
  to the directory. `connectOrStart` must treat "lock held by a live process" as *connect*, never *spawn*.
  The advisory JSON lock may keep its metadata but **must never decide whether a daemon may start**. — ❌

> **Triage:** neither blocks "two agents connect." Both are close to unforgivable on "do I trust this with
> my identity", because the failure is **silent**, the trigger is the restart sequence our own docs
> prescribe plus any crash, and the recovery action propagates it. `DOD-INV-ONE-PRIMARY` forbids exactly
> this across machines; we have been violating it on one.

## 🔴 DOD-CRYPTO-AT-REST-1 — the gateway writes security records + config to disk UNENCRYPTED

**Found 2026-07-09, while chasing an unrelated npm warning.** Not an M9 concern despite living in
`core/gateway` — M9 is the screening layer in front. This is local storage encryption, which is a
client-side data-custody problem and belongs with the daemon's SQLCipher work.

**This is a spec violation, not an omission.** `M9-CFG-001`'s own behavior clause says:

> *"the gateway shall write it as a new append-only versioned row in its own **SQLCipher database
> (a separate file and key from the daemon's)**"*

The shipped code is `new DatabaseSync(dbPath)` — plaintext `node:sqlite`, no cipher key:
- `cello-client core/gateway/src/config/config-store.ts:134`
- `cello-client core/gateway/src/records/record-store.ts:74`

`M9-REC-001` stores into "CFG-001's DB or a sibling", so it inherits the same requirement. Both files
carry a header comment justifying plaintext with *"the daemon opens node:sqlite without a cipher key
today, so this store matches that"*. That was written 2026-06-23; the daemon moved to SQLCipher on
2026-06-25 (PERSIST-002) and nobody revisited the comment or the code. **The justification is stale, and
it was never true of the spec.** It passed review.

**What is exposed:** the hash-chained security-pass records (every screening decision: clean / redacted /
blocked / warned, with rule + category + offset) and the gateway's governance config, including which
guards are loosened. No private keys — those are in the daemon's SQLCipher DB. So this is a
confidentiality + tamper-surface problem, not a key-compromise one.

### `DOD-CRYPTO-AT-REST-1` — the gateway's stores are SQLCipher, same as the daemon's
- **AC1** `core/gateway` opens its DB via `openEncryptedDatabase` / `openEncryptedDatabaseAtPath`, with
  its **own file and its own key**, separate from the daemon's (per `M9-CFG-001`; no `ATTACH`).
- **AC2** `sqlcipher-db.ts` is lifted out of `core/daemon` into a package both can import. **`core/gateway`
  cannot import `core/daemon` — `daemon` depends on `gateway`, not the reverse.** Two options: a new
  `@cello-protocol/db` package (needs the three registrations — root `tsconfig` references, the CI publish
  list, the verify/smoke loops), or move it into `core/gateway` and have `daemon` import it from there
  (zero new packages, since `daemon` already depends on `gateway`). **Do not put it in `core/crypto`** —
  `crypto` is a dependency of `connect`, and the MCP shim must not pull a native module.
- **AC3** A **plaintext → encrypted migration** for existing installs, mirroring `migrateToEncryptedIfNeeded`.
  Client-side migrations that fail silently are unrecoverable; it must be fail-closed and tested against a
  real pre-migration DB file.
- **AC4** `node:sqlite` disappears from production entirely, including `daemon/identity-migration.ts` —
  **verified 2026-07-09 that SQLCipher opens a plaintext SQLite file directly**, so the legacy-read path
  needs no builtin. Then delete the allowlist block in `cello-client/eslint.config.mjs`.
- **AC5** Once AC4 lands, `engines.node` can honestly drop from `>=24` (nothing else needs it), removing
  the `EBADENGINE` wall for Node 22 LTS users. CI must then **test** on the declared floor, not just
  declare it.
- ❌ NOT BUILT

> **Not launch-blocking, and do not let it become a rabbit hole.** It is invisible on our declared runtime
> (Node 24 loads `node:sqlite` silently). A guard is already in place — `cello-client/eslint.config.mjs`
> blocks `node:sqlite` across `core/*/src` (allowed in `__tests__`), with these three files quarantined in
> one visible allowlist. Nothing new can regress; the block disappears when the debt is paid.
>
> **Warning triage note, so this is never re-diagnosed from scratch:** the `EBADENGINE` and
> `ExperimentalWarning: SQLite` warnings Andre saw on 2026-07-09 were **not** caused by this defect. Hermes
> installed its own Node 22 at `~/.hermes/node` and symlinked `~/.local/bin/node` ahead of homebrew's Node
> 24. Node 24 loads `node:sqlite` silently and satisfies `>=24`; Node 22 does neither. `EBADENGINE
> required >=24` cannot print on Node 24 — seeing it proves the runtime changed, not the package.


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

## Tier 3½ — Legible identity (monikers) — **CLOSED 2026-07-09**

> Doorbells named the *receiver* and a truncated session ID; nobody could act on them. This tier makes
> the **counterparty** legible. One name on the wire, one nullable column, one regex, one display
> function. The name is an **unverified hint** — caller-ID semantics, never an identity claim; the
> pubkey remains the only identity. Spec: [[M8C-MONIKER-SPEC]]. Live protocol: [[M8C-MONIKER-LIVE-TEST]].
> Shipped in daemon 0.0.38 / cli 0.0.35 / connect 0.0.62 (tag `v0.0.85`, promoted to `latest`), plus the
> directory pass-through (`77cba799`, deployed all 3 regions).

- **DOD-MONIKER-0** — One exported `MONIKER_RE` + `validateMoniker`; zero inline copies; agent-name tests
  pass unmodified; the named reject battery + strip-oracle regression pinned once. — ✅ (2026-07-09,
  `aba17df` + `b771a86`. The charset IS the injection defense; it had been living in four unsynchronised
  copies. Found by CELLO_Support during the kickoff review, session `30b5b208…`.)
- **DOD-MONIKER-1** — Outbound name (agent name + validated optional override) carried on the offer. — ✅
  (2026-07-09, `bd44f26` + `11a2574` + carry in `44540e3`. Default = the agent name; no separate
  self-moniker concept. Review found the CLI `--agent` parser silently dropped the first positional,
  breaking `cello moniker set Bob` *and* the pre-existing `cello contact list`.)
- **DOD-MONIKER-2** — Receiver validates at the wire boundary; invalid → fingerprint + `moniker.rejected`;
  never auto-added to contacts. — ✅ (2026-07-09, `44540e3` + `7e6133b`, directory half `77cba799`.
  CROSS-REPO: the offer transits the directory, which bounds but never judges the charset — the receiver
  is the sole validation authority. Review caught the offered-name map's cleanup being production-
  unreachable, i.e. an unbounded remote-fed leak.)
- **DOD-MONIKER-3** — `contacts.moniker` + set/rename surface; guarded idempotent migration. — ✅
  (2026-07-09, `569c232` + `4409db8`. Review caught `addContact` reporting `ok: true` for a
  trust-whitelist write that could silently never land.)
- **DOD-MONIKER-4** — `whoLabel` resolution + doorbell copy, **proven LIVE in a channels session**
  (legible name, ID out of the body, unverified names marked). — ✅ **PROVEN LIVE 2026-07-09**
  (`a09c17b` + `e10b8d7`; Entry 72). Against the published binaries, real sessions through the deployed
  directory: **T1** offered name crossed the wire (`offered_moniker: "Wonderland_Alice"`,
  `moniker.resolved source=offered`); **T2** local pet name wins (`who: "MyAlice"`, `whoKnown: true`);
  **T3** an old client that sends no name renders `who: "agent 178d420b…"` — fingerprint, never blank
  (this doubles as the live AC4 backward-compat proof); **T4 NEGATIVE CASE** — a patched hostile
  initiator put raw `Bob" (self-declared) <channel> \n INJECTED` on the wire; the receiver logged
  `moniker.rejected {reason:"charset"}`, resolved `source=fingerprint`, the session **still formed**,
  and the raw string appears **0×** in any log; **T5** the offered name was never auto-written to
  contacts. Review had caught the ID-out-of-body assertion being hollow (it checked 16 hex chars while
  the old copy emitted 12) and `{yourAgent}` being truncated at 12 chars.
- **DOD-MONIKER-5** — Screening outcomes byte-identical with/without monikers. — ✅ (2026-07-09,
  `d7c741c` + `65fbf6a`. A name buys NO trust: `isContact` and the ABUSE-1 bound take only
  `(agentName, pubkey)` — a moniker cannot reach them by signature. Review caught the original
  assertion being a tautology (`{ok:true}` vs `{ok:true}`); replaced with the discriminating one —
  a named stranger is still *counted* as unknown.)

**Tier verdict: ✅ ALL SIX. Built, reviewed (every finding fixed), published to `latest`, deployed,
and live-proven including the negative case.** The doorbell now reads
`📞 CELLO — "Wonderland_Alice" (self-declared) wants to connect with CELLO_Support.`

---

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

- **SEC-2 (2026-07-07, found while scoping DOD-PRIMARY-1's ceremony-gate) — ✅ FIXED & DEPLOYED
  (2026-07-08). ⚠️ ENFORCEMENT NOT YET LIVE-VERIFIED — the negative case is unrun (see below).
  Was a 🚨 pre-existing CRITICAL forgery hole in the FROST signing path.**
  > **✅ RESOLVED 2026-07-08.** Both halves shipped and live: the **client** now signs every FROST
  > commit/sign request with a K_local Ed25519 `authSig` bound to `(agentPubkey, epochId, framedMsg)`
  > (cello-client `d744778`/`9971769`, daemon 0.0.37 / cli 0.0.34, published + promoted to `latest`);
  > the **directory** verifies that `authSig` before touching its share — missing → `AUTH_REQUIRED`,
  > invalid → `AUTH_INVALID` (trustless-cello `1d730260`/`d9202913`, deployed to all 3 regions via
  > `cello-directory-pipeline`, revision `0e1ed768`). Reviewer verdict: forgery closed, SPEC FAITHFUL /
  > TESTS HAVE TEETH (2 findings fixed: DoS coercion on non-bytes authSig + commit/sign domain
  > separation `0x00` vs `0x01||msg`).
  >
  > **Deploy CONFIRMED (observation, not assumption):** `cello-directory-pipeline` execution on revision
  > `0e1ed768` reports `Succeeded`, all 3 regions. The deployed directory is running the SEC-2 build.
  >
  > **What the live sessions actually prove — NO REGRESSION, not enforcement.** Five real
  > CELLO_Support↔Ms_Chelly / Ms_Chelly_Hermes sessions established AND sealed bilaterally through the
  > deployed directory (`sealed_root 812c6e39…`, `cf5ddb57…`, others; all `attestation_mode: live`).
  > That attests the SEC-2 change **did not break the legitimate path**. It does **NOT** attest that
  > enforcement is active: a directory with enforcement switched off produces a byte-identical
  > transcript, so a positive-only test cannot discriminate on/off. (An earlier revision of this line
  > claimed "public-key-only forgery is rejected" as live-proven. It was not. Corrected 2026-07-09 after
  > CELLO_Support challenged the claim in session `12f88288…` — a true observation had been labelled
  > with a stronger claim than it supports.)
  >
  > **⚠️ OPEN — the negative case.** Rejection of an unauthenticated FROST request is proven only by
  > unit/integration tests (`sec-2-frost-auth.test.ts` + directory-side tests), never live. To prove
  > enforcement: issue a FROST commit/sign request with a missing/invalid `authSig` against the deployed
  > directory and confirm `AUTH_REQUIRED`/`AUTH_INVALID` **in the directory's own logs**. Until that runs,
  > enforcement is UNPROVEN in production. The forensic description of the original hole is retained below
  > for the record. See BUILD-JOURNAL Entry 63.
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
