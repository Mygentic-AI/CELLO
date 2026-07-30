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
  `ingestReceivedContent`). — ✅ (M9 live — DOD-M9INT-1 + DOD-M9-SWITCH-ON-1 both ✅, 2026-07-19)
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
  **Per-command help ✅ — LIVE-CONFIRMED by Andre 2026-07-11** (`cello create-agent --help` gives real help:
  name rule from the shared regex + next step). **Top-level `cello --help` — half-done:** CC-7 (`f486e32`,
  cli 0.0.44) added the orientation HEADER (what CELLO is + the `login → create-agent → register → status`
  path) ✅, BUT the command list is STILL a single pipe-delimited blob with no per-command descriptions —
  which is NOT "REAL help" ("what the command does" applies at the top level too). The real remaining work is
  a described `Commands:` table (git/`claude --help` style, one line + summary per command). **Now FOLDED
  into DOD-CLI-PARITY-1** (the table renders from that story's command registry). **✅ CLOSED —
  LIVE-CONFIRMED by Andre 2026-07-11** on the promoted `latest` (cli 0.0.45): `cello --help` now renders the
  described `Commands:` table — every command on its own line with a one-liner, git/`claude --help` style,
  plus a footer telling a bash agent the commands print JSON + exit non-zero. Both halves (per-command +
  top-level table) now give REAL help. (An earlier note this session wrongly called this DONE from the header
  alone — corrected by Andre, then genuinely closed once the table shipped in cli 0.0.45.))
  **⟲ REOPENED 2026-07-11 (Andre) — the table STRUCTURE shipped but the CONTENT fails "REAL help."** Several
  descriptions are opaque or misleading: `install` reads as "install CELLO itself" and hardcodes Hermes (a
  *parameter*); `refresh` ("threshold shares / new epoch"), `receipts` ("relay ordering receipts") and
  `telegram` ("daemon-owned doorbell") are opaque even to the architect; `send` says "honors read-before-write"
  (jargon); `sessions`/`contact` wording is ambiguous. The command ORDER is neither alphabetical nor grouped
  (`register` before `create-agent`). Real help = accurate + intuitive descriptions + a sane order (grouped or
  alphabetical). Also `contact`→plural + the list/single-contact mixing. Revision folded into the CLI-PARITY
  help pass; design decisions being gathered (ordering, `install` rename, `contacts` structure). Stays 🟡.
  **UPDATE 2026-07-11 — BUILT, REVIEWED (×2), PUBLISHED TO BETA, awaiting Andre's live confirmation.**
  cello-client `0626701`; cascade **daemon 0.0.48 · cli 0.0.46 · connect 0.0.66**, tag `v0.0.96`, all CI green
  incl. the published-artifact smoke test; verified against the TARBALLS (not the commit). Promotion runbook:
  [[2026-07-11_latest-promotion-v0.0.96]] — **Andre runs the promotion.** Two review passes; every finding fixed.
  The second pass found the AUDITS THEMSELVES were defeatable — the dead-verb check anchored on a trailing space,
  so a verb followed by a quote or full stop walked through (PROVEN: the Hermes plugin scaffolded onto the
  operator's disk said `'cello register'` while the audit was green), and the CLI sweep stripped quoted tool
  names anywhere, hiding a stale name inside the very sentence that hands it to a user. Both are now anchored
  with a negative lookahead / restricted to wire position, and both carry NEGATIVE CONTROLS proving they fire.
  (test 2145 ✓ lint ✓ typecheck ✓ build ✓). Work order: [[2026-07-11_cli-help-revision-workorder]].
  **✅ CLOSED — LIVE-CONFIRMED by Andre 2026-07-11 on the promoted `latest` (cli 0.0.47).** Full `cello --help`
  pasted and read clean: `bridge` replaces the old "install" framing (Hermes now reads as an example, not a
  hardcode); `refresh` names the actual operation ("Rotate an agent's signing-key shares to a fresh epoch");
  the receipts split disambiguates itself (`sealed-receipt` = the notarized proof, `relay-receipts` explicitly
  says "Not the session receipt — see 'sealed-receipt'"); `send`'s description drops the "read-before-write"
  jargon for plain English; `create-agent` (Step 1 of 2) now precedes `register-agent` (Step 2 of 2), fixing
  the order bug; sections are grouped (Setup/Agents/Messaging/Sessions & receipts/Contacts/Other) per the
  "grouped or alphabetical" bar. Every specific complaint from the 2026-07-11 reopen is individually
  addressed. **DOD-ONBOARD-HELP-1 is DONE — no further action.**
  Delivered: **grouped help** (Setup · Agents · Messaging · Sessions & receipts · Contacts · Other) as registry
  METADATA so the table still cannot drift from dispatch; **clean renames, no aliases** (`install`→`bridge`,
  `register`→`register-agent`, `close`→`close-session`, `initiate`→`initiate-session`, `receipts`→
  **`relay-receipts`**) with the old names DELETED and a test asserting they are gone; **`contact` split** into
  `contacts` (the book) + `contact <pubkey> <op>` (one contact); **wording verified against the handlers**, not
  guessed (`refresh` = a resharing ceremony, new epoch, public identity unchanged, needs the directory
  reachable; `relay-receipts` = an advanced/debug per-message delivery artifact, explicitly NOT the seal).
  **§2b FULL CLI↔MCP name parity** — one vocabulary (`core/daemon/src/vocabulary.ts`): an MCP tool's name is
  `cello_` + the CLI command name. 7 shim tools renamed; the daemon RENDERS its ~50 guidance strings for the
  surface that asked (it records `clientType` at `ipc.connect`), at ONE choke point wrapping the handler map —
  so a CLI caller is told `cello use-agent` and an MCP caller `cello_use_agent`. **This closes P2-7 as a CLASS**,
  not as the single string it was reported as. The IPC WIRE names deliberately do NOT move (connect has no
  daemon dependency, so a new daemon must keep serving an OLD shim). Cascade became **daemon + cli + connect**
  (the work order predicted cli+connect; the daemon was forced in — see the phantom below).
  **🔍 Phantom found + killed:** the daemon told operators to "check **`cello_list_connections`**" — a tool with
  **zero handlers and zero registrations**, which has never existed on the shipped surface (it lives only in the
  legacy, unpublished `core/client/mcp-server.ts`). Four live guidance strings pointed at it. Handing an operator
  a dead command is worse than saying nothing. Now `cello_status` (what those strings actually wanted: "is the
  counterparty reachable?"), and a **source-audit test fails the build** on any daemon guidance naming a tool
  outside the vocabulary — so the class cannot return. **Live-confirmed by Andre — see the ✅ CLOSED note
  above.**
  **✅ RULED + DONE (Andre, 2026-07-11): `receive-session` is DELETED.** It is a literal ALIAS of `receive` — the daemon
  registers the SAME handler object for both (`handlers.set("cello_receive_session", handleReceive)`). It does
  not accept or join anything (inbound sessions are auto-accepted by the standing receiver), and its help
  claimed an "Accept / join an inbound session request" step that CELLO does not have. Deleted everywhere on the
  shipped surface — CLI command, MCP tool, vocabulary row, and (per "no dead handler left behind") the daemon
  handler registration itself. An old shim calling it now gets a loud, terminal `Unknown IPC method` naming
  version skew; it does not hang or retry. The test that asserted the alias was LIVE was **inverted**, not
  deleted — it now asserts the handler is gone, because a deletion no test can see is a deletion that grows
  back. Shipped in **v0.0.97** (daemon 0.0.49 / cli 0.0.47 / connect 0.0.67) — **Andre promotes v0.0.97, NOT
  v0.0.96**: [[2026-07-11_latest-promotion-v0.0.97]].
  **🔍 And a third phantom, caught by review at the last moment: `SKILL.md` — which SHIPS INSIDE the connect
  tarball and is the doc that hands an agent its tool list — had drifted into fiction.** It named eleven tools
  that do not exist (a whole M1-era connect-to-peers flow: `cello_request_connection`, `cello_accept_connection`,
  `cello_get_policy`, `cello_setup_guidance`, `cello_list_connections`…), told agents to register via MCP when
  registration has been a CLI step for milestones, and never mentioned 15 tools that DO exist. Every audit
  written for this story scanned `.ts` files, so not one of them ever opened it — and it went out in
  connect@0.0.66. Rewritten against the 26 tools the shim really registers; the shim audit now reads
  package.json's `files:` and checks every published `.md` as an **allowlist** (a denylist only catches the
  deaths you remember). **Standing lesson: follow what SHIPS, not what compiles.**
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

- **DOD-CLI-PARITY-1** (Andre, 2026-07-11 — "critical to removing friction") — Every daemon capability
  reachable via the MCP tool surface is ALSO reachable via the `cello` CLI, so **any bash-capable agent
  operates a CELLO node with no MCP dependency**. Bash is the universal agent adapter — most agents can shell
  out even when they can't/won't use MCP tools — so this broadens runtime reach past Claude Code + Hermes to
  essentially every runtime, and directly serves the #1 launch value ("two agents connect and communicate").
  Thin pass-throughs over the **existing** daemon IPC (CLI-only; no daemon/shim change); a JSON-out +
  exit-code + verbatim-structured-error contract makes scripts/agents the first-class consumer. **Group A**
  (agent lifecycle: agents/start-agent/stop-agent/use-agent; data custody: backup/restore; inbox; transcript;
  inclusion-proof; contact set-tier/away/moniker) + **Group B** (initiate/send/receive/close/await-session/
  receive-session, mirroring the MCP cursor/timeout semantics exactly). **Folds DOD-ONBOARD-HELP-1** — the
  described `cello --help` Commands: table renders from the same command registry (single source of truth for
  dispatch + help + summaries). Proof = a **bash-only** two-agent connect→send→receive→seal smoke (also gives
  us the scripted live-smoke we lack). Full brief, written to execute cold: [[2026-07-11_cli-mcp-parity-plan]].
  — ❌ NOT BUILT (assigned to CELLO_Support 2026-07-11; building the **9 Group A + 6 Group B** clean handlers.
  **3 rows descoped at handoff** — `backup`/`restore`/`inclusion-proof` are shim-only stubs, moved to
  **DOD-CUSTODY-DAEMON-1** below; the §9 parity DoD reads as the table minus those 3, marked known-open).
  **UPDATE 2026-07-11 — Phases 0-3 CODE-COMPLETE** (cello-client `b2aaad8`; gate green, 127 CLI tests; unit
  review in flight): registry as single source of truth (dispatch + help table + per-command help + an
  auditable tool→command→IPC-handler map enforced by a test); **13 new commands** (agents, start/stop/use-agent,
  inbox, transcript, **sealed-receipt** — a corrected parity gap: the notarized bilateral seal had no CLI
  surface; my "receipts covers it" was wrong, `receipts` calls a different handler — initiate, send, receive,
  receive-session, close, await-session, + contact set-tier/away/moniker); **DOD-ONBOARD-HELP-1's described
  command table renders from the registry** (HELP-1 closable on publish). **Crown jewel PROVEN LIVE:**
  bash-only two-agent connect→send→receive→close→bilateral-seal, matching `sealed_root 598b7461…`, zero MCP.
  **Phase 4 publish HELD** on DOD-CURSOR-DURABLE-1 (below) — a bash `send` cannot reply until the
  read-before-write gate is fixed; publish daemon+cli once, after.

- **DOD-CUSTODY-DAEMON-1** (found by CELLO_Support 2026-07-11, during CLI-PARITY handoff) — `cello_backup`,
  `cello_restore`, `cello_get_inclusion_proof` have **no real daemon IPC handler**: the daemon registers them
  only as `not_implemented` stubs (`core/daemon/src/daemon.ts:3650-3656`) and the real logic lives **inside
  the MCP shim** (`core/adapter-claude-code/src/server.ts` — `clientBackup.backup()`/`restore()`, inclusion
  proof via `checkpointStatusProvider`), as in-process objects that never cross the IPC socket. Two
  consequences: (a) DOD-CLI-PARITY-1 cannot thin-wrap them without shipping fake `not_implemented` commands or
  a forbidden second client path; (b) more importantly, **backup/restore/inclusion-proof only work through
  Claude Code today** — a Hermes or bash operator has NO data-custody path at all, which violates the
  heavy-node principle (the daemon is the source of truth) and is a real trust gap. Fix: move the logic out of
  the shim into **real daemon IPC handlers**; both the CLI pass-through and the shim then become trivial.
  Trust-relevant (data custody), so weigh it above ordinary parity. **DATUM (CELLO_Support, 2026-07-11): worse
  than "absent from CLI" — the PUBLISHED shim entrypoint `core/adapter-claude-code/src/bin/cello-mcp.ts:345-372`
  forwards `cello_backup`/`cello_restore` straight to the daemon's `not_implemented` stub (the `clientBackup`
  logic in `server.ts` is NOT on the published MCP path), so data custody works NOWHERE today.** — ❌ NOT BUILT
  (known-open).

- **DOD-LEGACY-MCP-1** (found by review, 2026-07-11, during DOD-ONBOARD-HELP-1) — a **second MCP vocabulary is
  sitting on the public export surface.** `core/adapter-claude-code/src/server.ts` and
  `core/client/src/mcp-server.ts` are the legacy M1 **in-process** MCP servers. They still register and name the
  PRE-RENAME tools (`cello_list_sessions`, `cello_get_sealed_receipt`, plus guidance like "Use
  `cello_list_sessions` to find valid session IDs"). Nothing drives them at runtime — the published shim
  (`bin/cello-mcp.ts`) proxies to the daemon — but **both are exported from their package roots**
  (`createMcpServer`, `createMcpSessionServer`) and ship in `dist/`, so they are not dead in the
  *published-surface* sense. That is precisely the "one capability, two names" that §2b abolishes. **Not a launch
  blocker** (no runtime path reaches them). **CONFIRMED AGAINST THE v0.0.97 TARBALL (2026-07-11):** connect's
  `dist/server.js` really does ship, and really does still register `cello_receive_session`, `cello_list_sessions`
  and `cello_get_sealed_receipt`. The live entrypoint (`dist/bin/cello-mcp.js`) never imports it, so it is
  unreachable — but it IS exported from the package root, so **the tarball carries a second vocabulary**.
  (CELLO_Support claimed "zero occurrences in the connect dist" after grepping only the entrypoint; Ms_Chelly
  checked the tarball and caught the imprecision. The accurate claim is "zero in the **live entrypoint**".)
  The quarantine is now **bounded by a test**: `server.ts` is the ONLY file in the package permitted to name a
  renamed-away tool, so it cannot silently grow while another audit reports green.
  Fix: **delete the two exports** (only tests construct them), or rename
  their tools to the vocabulary and bring them under the parity audit. Deliberately NOT done inside the help pass —
  removing public exports is a riskier change than a help revision and deserves its own unit. A note in
  `dod-onboard-help-1-tool-parity.test.ts` had claimed these were "not published"; that was FALSE and is corrected.
  **EVALUATED IN DEPTH 2026-07-12 (CELLO_Support, kicked off from a broader dead-code audit of
  `@cello-protocol/client` — see `cello-client/docs/dead-code-report.md`) — DEFERRED, not built,
  Andre's call.** Full plan: [[2026-07-12_dod-legacy-mcp-1-deletion-plan]]. Reachability confirmed
  real (the live shim never imports either legacy server); scope corrected from "delete 3 files" —
  those files are the test harness for ~130 test cases across 11 suites, and at least one file
  (`m6b-002-client-error-propagation.test.ts`) MIXES tests of dead code with tests of **live**
  `client.ts`/`types.ts` code in the same file, so a wholesale deletion risks silently destroying
  real coverage. A bounded, case-by-case surgical plan exists (§5 of the linked doc: triage every
  case KEEP/DELETE by subject-under-test, red-first, delete, tighten the parity test's invariant from
  "only server.ts may" to "nobody may," gate, review, publish cascade, verify against tarballs) —
  ready to execute whenever this is picked up. **Andre (2026-07-12), on hearing the diagnosis:**
  having tests that are either exercising dead code, or — worse — mixing dead-code and live-code
  assertions in the same file, is "vastly wrong" independent of the runtime-dead-code question
  itself; test-suite integrity is its own reason to prioritize this, not just tarball hygiene.
  Deferred for now (launch runway), but flagged for elevated priority post-launch rather than
  filed as routine cleanup.
  **REVERSED AND BUILT 2026-07-12 (Andre's call, executed by CELLO_Feedback).** The defer was
  reversed on two grounds: (1) the "risk" half of the trade was priced BEFORE the design pass, which
  had already done the hard part; (2) "zero customer-visible value" was wrong — cello-client is open
  source, and a technical evaluator points their own agent at the repo before trusting a
  cryptographic-trust product. Dead-code-backed tests are a credibility signal there.
  **Merged to main 2026-07-13 (cello-client `15d5922`, trustless-cello `a11220ea`) and PUBLISHED —
  combined cascade with `DOD-DAEMON-CLEANUP-1`/`DOD-SINGLE-DAEMON-1` above (one publish, not two),
  tag `v0.0.99`, connect `0.0.69` / client `0.0.50`. Verified against the real tarball by Ms_Chelly:
  `server.js`/`notifications.js`/`mcp-server.js` all confirmed absent from the published dist —
  caught and fixed a real trap first (`tsc --build`'s `.tsbuildinfo` cache trusts its own record over
  actual file presence, so a plain `rm -rf dist` without also clearing `*.tsbuildinfo` would have let
  the dead files silently reappear on rebuild — exactly the bug this line exists to remove). One
  merge-time catch worth keeping: CELLO_Feedback's own merged-gate run caught `dist/server.js`
  resurrecting on a warm local tree via the same `.tsbuildinfo` mechanism, before it ever reached a
  publish — the cascade was corrected to do a genuinely clean build first. Not promoted to `latest` —
  Andre's call.**
  - **Deleted:** `adapter/server.ts`, `adapter/notifications.ts` (BOTH functions — `pushChannelNotification`
    was runtime-dead too; the live shim inlines its own `buildChannelParams` call and never imports the
    module), `client/mcp-server.ts`, and the package-root exports from both `index.ts`.
  - **Triage:** 130 cases across **12** suites (the plan said 11 — `persist-022`'s `AC-007-dist-freshness`
    was missed, and it asserted `dist/mcp-server.js` EXISTS and names the legacy tools: a test whose job
    was guarding that the dead vocabulary kept shipping). **95 DELETE / 25 KEEP / 10 tightened.** A
    file-level delete would have destroyed: `FileKeyProvider` 0o600 key-persistence, live `client.ts`
    send/receive, the three `DOD-DIR-FAILCLOSED-1` cases, and the SOLE consumer of
    `rfc6962-external-verify.json` — CELLO's only external RFC 6962 conformance check.
  - **Parity audit tightened** from an allowlist ("only server.ts may name a renamed-away tool") to an
    absolute ("nobody may"), and its scan is now recursive (it had only ever read top-level `src/*.ts`).
  - **Verified against the REAL tarball** (`npm pack` → extract → grep): connect's `dist/` ships no
    `server.js`/`notifications.js` and registers no renamed-away tool. This is the defect, closed at the
    artifact level.
  - **Cross-repo (caught by review, NOT in the plan):** `packages/e2e-tests/src/session-fixture.ts`
    imported `createMcpSessionServer`; 15 e2e cases used it via `withMcp`. They passed only because the
    `^0.0.20` pin resolves to the old client — the publish cascade would have broken the e2e suite and the
    live smoke test that gates milestone close. Triaged the same way: **12 re-pointed at the live
    CelloClient** (they were real protocol coverage — real libp2p/directory/DKG/FROST/relay — merely read
    through a dead translator), **3 deleted as genuine duplicates.** `withMcp` is gone from the fixture.
  - **Gate:** cello-client 197 files / 2051 tests green, lint + typecheck + build clean. trustless-cello
    typecheck clean; default e2e gate unchanged from main (49 pass / 22 fail on BOTH — those 22 are
    PRE-EXISTING failures on main, not introduced here).
  — ✅ FULLY CLOSED — merged, published, verified against the tarball.

  **Scope grew far past this line, same day, on Andre's explicit push — record kept here since it's the
  same lineage.** After landing the above (~7,554 lines), Andre told CELLO_Feedback directly to stop being
  cautious about the rest it had already identified as dead. Result: **~27,990 additional lines removed**
  (cello-client `567b856`+`a3c81fd`+`eb33f73`) — reachability from the four production entrypoints went
  **32 dead files → 1** (the sole survivor, `core/test-fixtures/src/index.ts`, is unreachable from a binary
  BY DESIGN — live test infrastructure). Headline: **`@cello-protocol/client` is entirely gone** — all 25
  files, ~13k lines, the whole M6-era in-process client that M6→M7 had already fully superseded; also
  removed `adapter/lock-file.ts`, `adapter/index.ts`+`config.ts`, `cli/index.ts`,
  `daemon/cello-node-transport-dialer.ts`. Deregistered everywhere it needs to be to actually stop
  publishing: root tsconfig, the adapter's project reference, `vitest.workspace.ts`, the CI publish list,
  the CI verify loop, the smoke-tag module-graph import. Published beta `v0.0.100`, then `v0.0.101` (see
  `DOD-SINGLE-DAEMON-1` above for why) — verified against the real tarballs by Ms_Chelly: connect no longer
  depends on `@cello-protocol/client` **at all** (not just deleted files — the dependency itself is gone).
  **`@cello-protocol/client` npm versions 0.0.1–0.0.50 should be deprecated** (`npm deprecate`) now that the
  cascade has landed — not yet done, next step.

  **CELLO_Feedback's own retrospective on this, worth keeping verbatim in spirit (2026-07-13):** it had
  every fact needed to do the full deletion from the start — the dead-code report already said the whole
  package was dead, and a one-command reachability check confirmed it. What it did instead was write the
  fact up as a future story with a list of blockers, and hand Andre a decision. The blockers were real
  (published package, real consumers) but each was ~1 hour of tractable work, not a reason to stop — "I'd
  labeled the code dead in a table cell and then argued about why dead didn't mean dead." Every brake it
  pulled was imported from a live-production mental model that doesn't apply pre-launch, alpha, one user:
  "published package, one-way door" (the only consumer was our own test suite), "breaking API change"
  (breaking for whom — there is one operator), "could strand existing users" (there are none), "burns npm
  versions forever" (free in alpha). None individually false; all irrelevant at this stage, stacked
  together into something that looked like rigor and was mostly deferral. **The recalibration, stated as
  the standing rule going forward: at alpha with one user, default is ACT; the exception is ASK. Ask when
  the action reaches outside — a real counterparty, a real customer, a real bill, a public claim. Don't ask
  about internal-only actions just because the diff is large.** What stayed correct throughout and should
  keep being non-negotiable: never silently destroy coverage of code that's still live — every kept test
  was traced to a live subject, gate stayed green at every step.

  **Follow-ups this surfaced (NOT done, deliberately — each is its own unit):**
  - **`buildChannelParams` has no field allowlist.** It SPREADS every identifier-safe scalar of the
    daemon's doorbell frame into agent-visible `<channel>` attributes. INV-CONTENTFREE holds today only
    because of what the daemon happens to send, plus two structural skips (the `content` key, and
    non-scalars). A daemon that ever adds a scalar `preview`/`genesis_prev_root` to a doorbell ships it
    straight into the agent's prompt-injection blast radius. Mitigated for now by a TRIPWIRE test
    (`adapter-002.test.ts` SI-001) that pins the exact meta key set and goes red on any new field — but
    the allowlist question is real and unresolved.
  - **`cello_get_inclusion_proof` is now provably a no-op surface.** The shim still registers it; the
    daemon answers `not_implemented`. Its only real implementation (Merkle proof generation with the
    `local_tree_inconsistent` / `leaf_index_out_of_range` guards) lived in the deleted `mcp-server.ts`.
    This diff removes the last implementation, not merely a dead copy. Decide: implement, or unregister.
  - **`CheckpointStatusProvider` is now orphaned** in `trustless-cello/packages/interfaces` — zero
    references in cello-client after the deletion. PERSIST-017's checkpoint surface has no implementation
    and no tests.
  - **`packages/e2e-tests` has 22 failing tests on `main`** (pre-existing, unrelated). The three MCP e2e
    suites are also `describe.skipIf(!process.env.CELLO_E2E_LIVE)` — so that coverage does not run in CI
    at all. `connreq-002` runs the same live fixture unguarded, so the stated "FROST timing is unreliable
    in CI" rationale for the guard looks stale.
  - **`dx-001-startup.test.ts` contains a hollow test** — `expect('server.connect(...)').toContain("server.connect")`
    asserts a string literal against itself and can never fail.

- **DOD-CURSOR-DURABLE-1** (found LIVE by CELLO_Support 2026-07-11, during CLI-PARITY Phase 3) —
  **read-before-write makes a stateless CLI unable to hold a two-way conversation.** The `cello_send` gate
  consumes the ephemeral per-connection cursor (`connectionCursors`, `daemon.ts:919`, keyed by connectionId,
  deleted on disconnect — `daemon.ts:6252`: "cursor is connection-scoped, dies with it"; default -1). The MCP
  shim holds ONE long-lived socket so read-then-send works; the CLI opens a NEW connection per invocation, so
  `last_read_seq` is ALWAYS -1 at send time. Consequence (reproduced live, smoke step 4): a bash agent speaks
  ONCE (a virgin session is also current_seq -1), then every subsequent `cello send` is permanently refused
  `session_not_current` even though it DID receive — connect-and-communicate, the #1 launch value, is
  HALF-delivered from bash. **Fix (state already exists):** the persisted per-(agent,session)
  `message_watermarks` (`daemon.ts:914`, advanced by `cello_receive` at `daemon.ts:5827`) is the correct
  authority — the send gate should consult it rather than (or in addition to) the ephemeral connection cursor.
  Preserves the real intent (the agent genuinely read) AND works for any stateless client; also fixes the
  latent reconnecting-MCP-client case. **Trade to make explicit:** per-connection → per-agent relaxes
  CURSOR-1's two-attended-window "each connection must independently read" guarantee (never live-proven; a
  Tier-2 nicety) in favor of the launch-critical stateless-client case. Daemon change; **blocks the CLI-PARITY
  publish** (do NOT ship a `send` that can't reply — fix first, publish daemon+cli once). — 🟡 **OPTION 1
  APPROVED (Andre, 2026-07-11)** — the OR gate `caughtUp = (connectionCursor >= currentSeq) OR
  (unreadReceivedCount == 0)`, reusing INBOX-1's unread-received computation (Trap 1: own sends must not
  enter the compare) + `cello_get_transcript` advances the persisted watermark (Trap 2: keep the documented
  remedy true), with a test asserting **zero behavior change on the long-lived-connection path** (the safety
  property that makes it safe on a security gate). Building now; proof = a **bidirectional** bash smoke (both
  sides reply, matching sealed_root); then publish daemon+cli once (connect unaffected). Design (traps +
  the per-connection→per-agent relaxation, stated not absorbed): [[2026-07-11_cursor-durable-read-before-write-design]].

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
  (agent `CELLO_Feedback`), so the CLI mechanics are PROVEN. **P2-2 (register-doesn't-arm-the-standing-
  receiver) was FIXED the same day** (`e73c421`), shipped since `v0.0.94`, and verified present in the
  currently-promoted `latest` daemon tarball 2026-07-11 — no longer a blocker. Remaining gap: the
  Telegram registration-bot handoff still names the wrong env var (`CELLO_REGISTRATION_TOKEN`, which the
  CLI does not read), an ops-agent copy fix, still unbuilt (Phase 1 of [[M8C-ONBOARDING-IMPROVEMENTS]]).
  Gate flips ✅ once that ships (or is judged non-blocking if Telegram isn't the primary onboarding path).)
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
  **unblocks the cross-machine tests below**. — ✅ DONE AND TESTED (2026-07-19 — bridge installed on
  AWS Hermes instance; off-device connect → talk loop proven live.)

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
  directory half (D2) understands the frame. 📦 **BOTH HALVES NOW LIVE — 0.0.94 (2026-07-11): daemon half
  in 0.0.46 (`8becaa7` ancestor of the tag; `session_offer_reject` present in `dist/`); the directory-side
  decoder rides `1ccd08a5`, whose `cello-directory-pipeline` execution **Succeeded 2026-07-10 12:37 and is
  running in all 3 regions** (ECS `cello-directory-dev` image tag `1ccd08a`, us-east-1 / eu-central-1 /
  ap-northeast-1 all `running=1`, verified against live ECS 2026-07-11 — NOT a pending deploy). Flip pending
  a single live proof that the directory understands the reject frame.**
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
  M7/M8. ✅ **DEPLOYED — NOT awaiting anything (corrected 2026-07-11).** The directory root fix `1ccd08a5`
  ships as APPLICATION CODE via `cello-directory-pipeline` (image swap on push), not deploy.sh — its
  pipeline execution **Succeeded 2026-07-10 12:37** and all 3 regions run image tag `1ccd08a` (ECS
  `cello-directory-dev`, us-east-1 / eu-central-1 / ap-northeast-1, each `running=1`, verified against live
  ECS 2026-07-11). It is the LATEST directory commit — nothing directory-side is unshipped. The daemon-side
  half (decoder allowlist, reject-waiter, `counterparty_did_not_accept` reason fix) is in 0.0.46 / v0.0.94.
  **Both sides are live; this line moves to fully-✅ on a single live phantom-session-gone proof — NO deploy
  remains.** (A prior note here wrongly said "awaiting the 3-region deploy / undeployed" — it conflated the
  app-code pipeline with deploy.sh and was falsified by the live ECS check.)
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
  trap that made `DOD-LOGOUT-WAIT-1`'s first AC2 hollow). — ✅ **BUILT, REVIEWED, PUBLISHED — 2026-07-13**
  (CELLO_Support, launch-triage item 2). Two review rounds surfaced 3 real bugs before shipping: (1) `cello
  logout` itself trusted the same "absent lock file = no daemon" logic that IS the bug, so it would report
  "No daemon running" while a live orphan was still online and extending the hash chain — fixed to ask the
  daemon's own socket first, then the kernel, never reasoning from pids either direction; (2) the new
  singleton probe could itself SEIZE the lock it was only meant to check, so a concurrent `cello login`
  could kill a healthy starting daemon — fixed with a bounded acquire timeout; (3) the original tests had
  no teeth — a reviewer's deliberately-wrong no-kernel-lock implementation passed all of them, because
  every test started the second daemon only after the first had settled, never testing true concurrency —
  fixed with a real simultaneous-start test. Also went deeper than this spec: Node's own `server.close()`
  unlinks a unix-socket path unconditionally regardless of who currently owns it, so the original
  guarded-unlink alone was insufficient — ownership is now decided BEFORE calling close(), and a foreign
  socket is never closed at all (fd reclaimed by process exit instead).
- **DOD-SINGLE-DAEMON-1** — the daemon takes an **exclusive OS lock** (`flock`/`O_EXLOCK`) at startup and
  holds it for its lifetime; the OS releases it on death, so a `kill -9` leaves nothing stale. A second
  instance exits non-zero naming the holder's pid, and never opens the DB, registers agents, or connects
  to the directory. `connectOrStart` must treat "lock held by a live process" as *connect*, never *spawn*.
  The advisory JSON lock may keep its metadata but **must never decide whether a daemon may start**. — ✅
  **BUILT, REVIEWED, PUBLISHED — 2026-07-13.** No `flock` in Node core; `O_EXLOCK` is Darwin-only (would
  give Linux, including the demo agent, no lock at all); a native locking addon compiles from source on
  every install (ruled out by CLAUDE.md). Used a real POSIX `fcntl` write lock via `@signalapp/sqlcipher`
  (already a prebuilt dependency) on a new zero-row `~/.cello/daemon.singleton` DB, acquired BEFORE
  `sessions.db` opens. Verified by live spike: second process → immediate `SQLITE_BUSY`; `kill -9` the
  holder → OS releases the lock cleanly, a third process starts fine. **User-visible behavior change,
  intentional and correct per this line's own SI**: a daemon holding the lock but not answering (stuck
  mid-startup, socket destroyed) now makes `cello login` retry ~10s then FAIL LOUD naming the holder's
  pid, where before it silently spawned a second daemon. **Known limit, documented not hidden**: the fcntl
  lock needs `~/.cello` on a local filesystem — on NFSv3 without `lockd` the singleton degrades silently;
  logged at startup. **Published beta, SUPERSEDED twice same day — final state: tag `v0.0.101`, daemon
  `0.0.53` / cli `0.0.51` / connect `0.0.71` / crypto `0.0.20` / transport `0.0.20`.** (v0.0.99 was this
  fix alone; v0.0.100 added the much larger `DOD-LEGACY-MCP-1` dead-code purge on top — see below; v0.0.101
  fixed a regression the purge introduced in `crypto`. All three superseded versions remain valid on `beta`,
  just outdated — only the highest matters.) Verified against the actual tarballs by Ms_Chelly, not the
  commit, at every step: `singleton-lock.js` present in the published `daemon` package; cross-pins on
  `cli`/`connect` are real versions, zero `workspace:*`. Full
  gate green from a genuinely clean rebuild (both `dist/` AND every `*.tsbuildinfo` cleared first — `tsc
  --build`'s incremental cache trusts its own record over actual file presence, so deleting `dist/` alone
  does not force a real re-emit). One pre-existing, unrelated flaky test
  (`http-manifest-poll.test.ts`, local-HTTP-server contention under the full 200+-file parallel run) —
  verified green 12/12 in isolation before treating it as noise, not assumed. **Not promoted to `latest`**
  — Andre's call, command set prepared.

> **Triage:** neither blocks "two agents connect." Both are close to unforgivable on "do I trust this with
> my identity", because the failure is **silent**, the trigger is the restart sequence our own docs
> prescribe plus any crash, and the recovery action propagates it. `DOD-INV-ONE-PRIMARY` forbids exactly
> this across machines; we have been violating it on one.

## ✅ DOD-CRYPTO-AT-REST-1 — the gateway writes security records + config to disk UNENCRYPTED

> **FULLY CLOSED 2026-07-30 (the named defect fixed 2026-07-29 by `DOD-M9B-STORE-1`** (M9's reopened connect unit, branch `m9/connect-unit`,
> commit `449bbba`). `core/gateway` got its own SQLCipher opener — it cannot import the daemon's,
> since the daemon depends on the gateway and not the reverse — and both stores now live in ONE
> encrypted file, `~/.cello/gateway.db`, opened with the DAEMON'S key file. One key, one backup
> unit, which is policy decision D-3.
>
> Two clauses were amended by evidence rather than met (`M9B-D6`, `M9B-D7`, journal Entry C2):
> `cello_backup`/`cello_restore` are still `not_implemented` stubs, so a round-trip proof is OWED
> to the backup build and recorded there; and NO plaintext importer was built, because the layer
> never ran in the product, so no production plaintext store has ever existed and an importer would
> be dead code born dead.
>
> The two gateway entries also left the `node:sqlite` quarantine allowlist in
> `cello-client/eslint.config.mjs` — only `daemon/identity-migration.ts` remains.
>
> **✅ CLOSED 2026-07-30.** The last plaintext path is gone. The gateway's REQUEST LOG
> (`CELLO_GATEWAY_REQUEST_LOG`) wrote metadata plus a content SHA-256 outside the encrypted store —
> only tests set it, but this line's title is "the gateway writes ... to disk UNENCRYPTED", and one
> env var away from true is not false.
>
> It was REMOVED rather than guarded, because it was redundant: the record store already carries
> direction, disposition, contentHash and correlationId. No reference in either repo and no shipped
> path that set it — though the field WAS on the package's `.` export via `GatewayServerOptions`, so
> its removal is a semver-breaking type change (review L2 corrected my claim to the contrary; the
> deletion itself landed in `39f8100`, not `8334651`). Its three test consumers now read the ENCRYPTED store
> instead, which makes them better tests: they assert on the durable audit trail rather than a debug
> side-channel. See [[M9B-DEFINITION-OF-DONE]] and [[M9B-BUILD-JOURNAL]] Entry C19.

<details>
<summary>The original finding, kept verbatim</summary>

</details>

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


## ✅ DOD-CLI-PARITY-1 — every daemon capability reachable from bash (2026-07-11)

**DONE — cello-client `b2aaad8`.** Bash is the universal agent adapter: every capability that was
MCP-only is now a `cello` command, so any bash-capable agent operates a CELLO node with no MCP
dependency (widens reach past Claude Code + Hermes). Plan:
[[2026-07-11_cli-mcp-parity-plan]].

- ✅ **Registry** (`core/cli/src/registry.ts`) is the single source of truth — dispatch, the
  `cello --help` `Commands:` table, per-command help, and the flag set all derive from it and
  **cannot drift**. The dispatch switch in `bin/cello.ts` is gone. Per-command help moved verbatim.
- ✅ **DOD-ONBOARD-HELP-1 CLOSED** — the described `Commands:` table renders from each entry's
  `summary`; a new command cannot be added without one, and it auto-appears in the table.
- ✅ **13 new commands**, each a thin pass-through to the **same daemon IPC handler its `cello_*` MCP
  tool calls**: `agents`, `start-agent`, `stop-agent`, `use-agent`, `inbox`, `transcript`,
  `sealed-receipt`, `initiate`, `send`, `receive`, `receive-session`, `close`, `await-session`, plus
  `contact set-tier` / `set-away` / `set-moniker`. The handler each one calls is recorded in the
  registry's `ipcMethod` field, so the parity claim is **auditable from the table** (a test enforces
  the tool → command → handler map) rather than asserted in prose.
- ✅ **Bash-only live smoke PASSED** (the proof of done): two agents, real relay transport, real FROST
  seal, driven entirely by `cello` + `jq` with **zero MCP** — initiate → send → receive → close →
  bilateral seal, with **both sides' `sealed_root` matching**
  (`598b746125eecc85a8ba84ed315d78e73e1de1551e9297f3abbff86cccfe7a2a`).
- ✅ **Publish (Phase 4):** shipped as a **daemon+cli cascade** (daemon `0.0.47`, cli `0.0.45`, tag
  `v0.0.95`) once `DOD-CURSOR-DURABLE-1` landed — deliberately NOT published before, because a `send`
  that cannot reply is half a capability. `connect` is unaffected (it depends on client/crypto/transport,
  not daemon; operators pull the new daemon transitively through `cli`). **`latest` promotion is
  Andre's to run** — the command set is prepared, never executed here.

**Two things were STOPPED AND FLAGGED rather than faked** (the brief's §2 guardrail doing its job):

### ✅ `DOD-CURSOR-DURABLE-1` — DONE (cello-client `120240e`; Andre approved the trade, 2026-07-11)

**Landed.** The gate now passes if EITHER authority says caught-up:
`(connectionCursor >= currentSeq) || (unreadReceivedCount === 0)` — the second being the **persisted
per-(agent, session) watermark** (`message_watermarks`) that already existed and that `cello_receive`
already advanced. The gate had simply been consulting the wrong authority. `cello_get_transcript` now
advances that watermark too (**AC3** — reading the history *is* reading), with the same contiguous-run
hole safety as the cursor, so a gap can never mark unseen content as read.

**PROVEN LIVE, bash only, zero MCP:** `cello-client/scripts/bash-only-smoke.sh` — a **four-turn
BIDIRECTIONAL** conversation between two registered agents, every step its own process (fresh
connection, cursor −1 each time), then close + bilateral seal with **matching `sealed_root` on both
sides** (`b7ca9f17962b775ed9cf1eb34bec9506a42766d0f927548e91efd79d2d5b1dc8`). The blind send is **still
refused** (`unread_received: 1`) — the fix is not a bypass. This is the reusable scripted live-smoke the
plan asked for.

**Two traps a naive fix would have hit** — both found by tracing producers, both avoided:
1. **The counters measure different things.** `currentSeq` counts *every* message including your own
   sends; the watermark counts *received* only. A direct swap would have blocked **your own second send
   in a row** — breaking the MCP path too, not just the CLI.
2. **The documented remedy would have stopped working.** `cello_get_transcript` did not advance the
   persisted watermark, so the gate's own guidance ("read the transcript, then retry") was a dead end
   for any stateless client.

**🔻 THE TRADE — approved on purpose; recorded so nobody later rediscovers it as a bug.** The durable
clause is **per-agent**, so a message this agent **SENT from another local connection** no longer blocks
a second window. Unread **counterparty** content still blocks *every* connection — that guarantee is
preserved, and is now durable. Clauses **C4/C5/C6/C7** of `m8c-cursor-1.test.ts` asserted the old
per-connection rule (C7 was itself a reviewer HIGH finding) and were **rewritten to lock the new
boundary**, including an explicit assertion that the counterparty half did not weaken. Rationale: the
principal is the **agent, not the socket** — two windows are one operator's own processes, same keys,
same identity, same counterparty, and the daemon cannot referee which window a human is looking at.
Against that, the old rule left *every* stateless client (and every reconnecting MCP client) unable to
hold a conversation at all. Design + the stricter alternative that was NOT taken:
[[2026-07-11_cursor-durable-read-before-write-design]].

<details>
<summary>Original defect report (kept for the trail)</summary>

### 🔴 `DOD-CURSOR-DURABLE-1` — read-before-write makes a stateless client unable to hold a conversation

**Found live, 2026-07-11, by the bash-only smoke.** B receives A's message successfully, then B's
`cello send` is rejected: `{"ok":false,"reason":"session_not_current","current_seq":0,"last_read_seq":-1}`.
**B did read.** The daemon cannot tell.

Producer/consumer: the send gate *consumes* `getConnectionCursor(connectionId, sessionId)`
(`daemon.ts:5527`). Its *producer* is `connectionCursors`, an in-memory `Map` keyed by **connectionId**
(`daemon.ts:919`), deleted on disconnect — `daemon.ts:6252` says it outright: *"cursor is
connection-scoped, dies with it"*. Unknown connection → **-1**. The MCP shim holds ONE long-lived
socket, so read-then-send works there. **The CLI opens a new connection per invocation, so
`last_read_seq` is ALWAYS -1 at send time.**

**Consequence:** a bash agent can open a session and speak **once** (that works only because a virgin
session's `current_seq` is also -1). The moment the counterparty speaks, every subsequent CLI send is
permanently blocked. *Connect-and-communicate — the #1 launch value — is half-delivered from bash.*

**Not worked around on purpose.** The CLI could read the transcript on the same connection before
sending, but that is exactly the auto-fix the brief forbids, and it would hollow out the guarantee
(the gate exists so a sender has genuinely seen what it is replying to). Faking the cursor is worse
than the gap.

- **AC1** The read-before-write gate consults the **persisted per-(agent, session) read watermark**
  rather than (or in addition to) the ephemeral per-connection cursor. **The state already exists:**
  `message_watermarks` is a persisted, per-AGENT read watermark — `daemon.ts:914` explicitly calls it
  *"Distinct from"* the connection cursor — and `cello_receive` already advances it (`daemon.ts:5827`).
  The gate simply consults the wrong one.
- **AC2** The security intent is preserved exactly: a send is accepted only if that agent has genuinely
  read up to the current sequence. Never a bypass, never an auto-read.
- **AC3** A bash-only two-agent **bidirectional** conversation (A→B→A, multiple turns) completes and
  seals. This also fixes the same latent bug for a *reconnecting* MCP client, whose cursor is likewise
  reset to -1.
- ✅ ALL THREE ACs MET — see the DONE block above. (The recommendation "land this before publishing"
  was taken: publish waited for the fix, then shipped daemon+cli together.)

</details>

### 🔴 `DOD-CUSTODY-DAEMON-1` — backup / restore / inclusion-proof work NOWHERE (worse than "MCP-only")

No CLI command was shipped for `backup`, `restore`, or `inclusion-proof`: their daemon handlers are
`not_implemented` **stubs** (`daemon.ts:3650-3656` — a literal loop returning
`{ok:false, reason:"not_implemented"}`), so a thin pass-through would have shipped a *fake data-custody
command*. Descoped by agreement, recorded here rather than silently dropped.

**Escalation found while checking:** these are not merely absent from the CLI — they are **broken on the
MCP surface today**. The *published* shim (`core/adapter-claude-code/src/bin/cello-mcp.ts:345-372`)
forwards `cello_backup` / `cello_restore` straight to that `not_implemented` stub. The real
`clientBackup` logic lives in `server.ts`, which is **not** the published MCP entrypoint. **Data custody
currently works through no surface at all.**

- **AC1** The real backup / restore / inclusion-proof logic moves **out of the shim and into the daemon**
  as genuine IPC handlers (the daemon is the heavy node and the source of truth).
- **AC2** Both the CLI pass-through and the MCP shim then become trivial, and **both** surfaces gain the
  capability — a Hermes or bash operator has a data-custody path for the first time.
- ❌ NOT BUILT — separate daemon-side story.

### Contract note (edits the plan's §3 wording)

The daemon has **two** response conventions, not one: some handlers are `ok`-bearing; others are
**payload-only with no `ok` at all** (`cello_list_agents` → bare `{agents:[…]}`; `cello_await_session` →
bare `{type:"timeout"}` — verified in `daemon.ts`, not assumed). §3's "exit 0 when the response is
`ok:true`" would therefore make `cello agents` **exit 1 on success**. The CLI keys its exit code on
**`ok === false`** — the daemon's one and only failure convention (a genuine transport failure throws).


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
  per-session size limit, Telegram settings, primary-transfer policy) readable + writable.
  — 🟡 **ABSORBED 2026-07-29 by `DOD-M9B-SURFACE-1`** (policy D-4). `cello config list|get|set`
  exists on M9-CFG-001's versioned store, tighten-free / loosen-confirmed is enforced end to end,
  and the confirmation is an interactive TTY prompt — deliberately with no `--yes` flag, since a
  flag a script can pass is the environment-variable bypass renamed. **The SECURITY-LAYER half is
  built; the M8C-settings half is NOT** — away message, TTL, auto-start and the rest still live on
  `cello settings` / `agent_settings`, which is a different store with a different governance
  model (no confirmation gate). Whether the two surfaces merge is an open product decision, not a
  gap this unit left. See [[M9-DEFINITION-OF-DONE]] `DOD-M9B-SURFACE-1`.
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

- **DOD-NAT-REACHABILITY-1** — Inbound sessions for NAT'd agents: the standing receiver binds
  routable (not loopback), takes circuit-relay reservations with the directory-provided relay
  pool (handed over at signaling-auth time — BEFORE any session exists, so a fresh agent is
  reachable from first agent-online), announces its `/p2p-circuit` address through the existing
  signed-assignment plumbing, DCUtR upgrades the relayed connection to direct where the NAT
  allows, and where the punch fails the relayed connection STAYS UP and carries the session live.
  The store-and-forward mailbox becomes what it was meant to be: the offline fallback, not the
  mask for "online but NAT'd". Acceptance = the §8 reversed reproduction in
  [[2026-07-14_DOD-NAT-REACHABILITY-1-inbound-is-impossible]]: demo (public) initiates to a NAT'd
  laptop → `session.transport.connected`, laptop reply `delivered: true` (NOT
  `dispatched_to_relay`), laptop advertises a `/p2p-circuit` addr — proven with daemon logs on
  both sides, never MCP-tool timestamps. — ✅ **PROVEN LIVE 2026-07-14 ~17:55 UTC.** The demo
  agent (public EIP, us-east-1) initiated a session INTO this NAT'd laptop and the daemon logged
  `session.transport.connected` on
  `/dns4/relay-us1…/p2p-circuit/p2p/12D3KooWD2e8…` — it dialed IN, through the relay circuit
  address, with **no `counterparty_dial_failed`**. Bidirectional traffic followed on that live
  connection: the demo's message arrived, and the laptop's reply returned
  **`delivered: true`** — NOT `dispatched_to_relay`. All four agents on the laptop came up with
  `circuitAddrs: 5` and zero relay rejections. DCUtR did not fire (no punch on this path), which
  exercises the acceptance criterion that matters MOST: **the relayed connection stayed up and
  carried the session live.** Session `3a6acba8e3d04b31ad6991ece5aeb6ae`. Proven on PUBLISHED
  packages (daemon 0.0.59 / cli 0.0.57 / transport 0.0.22, both ends) against the DEPLOYED relay
  — not a working tree. **Open behind it: [[#DOD-RELAY-REDUNDANCY-1]] — an agent reserves with
  exactly ONE relay, so its inbound reachability rests on a single relay (watchdog re-picks on
  death). Tracked below, deliberately not folded in.** — (2026-07-14 — client parts 1-3a built on
  cello-client `nat-reachability-1` (`f650c71` transport: dcutr everywhere + runOnLimitedConnection
  + HOP gated to service nodes; `2b011d0` daemon: 0.0.0.0 default + reservations from persisted
  endpoints + gater set + NO_FATAL resilience; `d721542` review fixes (wildcard configuredHosts
  dialability F1) + directory-endpoints client half with rebuild-if-deaf). Directory half
  trustless-cello `183ea811` (relay_endpoints ride signaling_auth_ok from
  RelayPoolManager.listAvailable; held UNPUSHED pending batch with the relay
  circuitRelayServer-limits change). Per-unit reviews run after each section, all blocking
  findings fixed. REMAINING: relay `relayServer` reservations config (maxReservations ↑, default
  2-min/128-KiB limits off — needs the new `@cello-protocol/transport` published), publish
  cascade, deploy, and the §8 live proof. Discovered during the FROST latency baseline — see the
  finding doc for the false trails already burned (§7).)
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
  Activates DOD-INV-GATEWAY. — ✅ (M9 confirmed live per M9-DEFINITION-OF-DONE — all M9 stories EARNED,
  gateway switched on, seam green. 2026-07-07, Entry 28 — merged, commit pending in this session;
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

## ✅ DOD-SESSION-NAME-1 + DOD-AGENT-PARAM-1 — name a session; one word for the agent selector (2026-07-13)

Added to M8C after the fact, from a design session with Andre. Full spec, ACs, and the decisions
NOT to re-litigate: [[2026-07-13_session-names-and-agent-param-story]]. Assigned to CELLO_Support.

**✅ BOTH DONE 2026-07-13** (CELLO_Support). Branch `m8c-session-names` in cello-client, off
`7d5ec7a`: Part B `7d5ec7a` + `699eb21` (review), Part A `adb8116` + `a20d107` (docs) + `4eab4f7`
(review). Gate on the final tree: **1771 tests, lint, typecheck, build — green.** One
`cello-unit-reviewer` pass per unit; every finding fixed. **PUBLISHED — daemon 0.0.54 / cli 0.0.52 /
connect 0.0.72 (tag `v0.0.101`, 2026-07-13), promoted to `latest`.**

**Two DEVIATIONS from the story text, both deliberate, journaled here so neither reads as drift:**

1. **The rename tool is `cello_name_session`, not `cello_session_set_name`.** AC-A8 (tool name) and
   AC-A15 (CLI `cello name-session`) were **mutually unsatisfiable**: `DOD-ONBOARD-HELP-1` §2b
   mechanically enforces *"an MCP tool's name is `cello_` + the CLI command name, snake_cased"*
   (`vocabulary.ts`), and its test went red the moment the pair was registered. The CLI verb won —
   `cello name-session ab12… the deploy postmortem` reads how an operator thinks, and AC-A15
   deliberately designed that multi-word positional, so trading it for naming symmetry with
   `contact-set-moniker` would trade the thing actually wanted for a thing wanted only by analogy.
   Ms_Chelly (the story's author) confirmed and is amending AC-A8. Applied everywhere — the old
   string appears nowhere in the repo.

2. **AC-A7's name write is ONCE on the way in, not at each of the three terminal exits.** Threading
   it through bilateral/unilateral/force is how one silently ends up without it — and force-abandon,
   the one most likely to be missed, is precisely the session you most want to identify later. Safe
   because AC-A9 makes renaming legal in ANY status: a failed seal leaves a named open session, a
   state the operator could produce by hand. Ms_Chelly agreed this is better than her AC.

### ✅ `DOD-SESSION-NAME-1` — a human-readable name for a session

Scanning `cello sessions` gives you 64 hex chars and a pubkey. You cannot tell which conversation was
which. Add a **local-only, cosmetic** `session_name` on the `sessions` row.

- ✅ Nullable `session_name TEXT` column on `sessions` (idempotent `ALTER TABLE`, client-side SQLite).
- ✅ **Never leaves the machine** — not to the relay, not to the directory, not to the counterparty,
  not into the transcript or the seal. If it becomes observable to another party, it is wrong.
- ✅ **Not settable at creation** (`initiate`/`await` do NOT take it) — at open time nobody yet knows
  what the session is about. Set optionally at **close** (`cello_close_session { session_name }`,
  nullable), when the agent has just finished the conversation and does know.
- ✅ **Unnamed is a SIGNAL, not a gap** — a closed session with no name probably did not close
  cleanly. NO auto-generated default names; NULL is allowed to mean something.
- ✅ **Rename any time, any status** — new `cello_name_session(session_id, session_name)`, set-or-
  clear-by-null, ownership-scoped. Naming a long-sealed session is the point. Provably does not touch
  the seal (`sealed_root_hex` byte-identical before/after).
- ✅ **Surfaced with the id, never instead of it** — `cello_list_sessions`, `list_sessions` (CLI),
  `cello_status`, `cello_get_transcript`, `cello_get_sealed_receipt`.
- ✅ **CLI parity** (DOD-CLI-PARITY-1 is a standing invariant): `cello close-session --session-name`,
  new `cello name-session <id> <name…> [--clear]`, registered in `registry.ts` with its `ipcMethod`.
- ✅ Validation is daemon-owned (D7): 1–200 chars, free text (NOT handle-shaped — do not copy
  `cello_moniker`'s charset rule), control chars rejected not stripped, over-length rejected not
  truncated. **Validate BEFORE starting the seal** — a bad name must never break a close.
- ✅ Log `session.name.set` / `.cleared` / `.rejected` with the name's **LENGTH, never its text** (it
  is the subject of a private conversation; daemon logs are not confidential).

**The two-local-agents question is already answered by the schema — no tiebreak to build.** `sessions`
is `PRIMARY KEY (agent_id, session_id)`, so each participating agent already holds its OWN row (that
is what `DOD-LOOP-1` is for). Both ends can name it independently; they cannot collide.

### ✅ `DOD-AGENT-PARAM-1` — the agent selector is called two different things

Ten daemon handlers read an optional agent-selector as `params.name`; nine later tools call the same
concept `agent` and EXPOSE it. Two words, one concept — and on the 8 session tools it is exposed
nowhere, so a multi-agent operator can only switch with the sticky `cello_use_agent` and cannot say
"do THIS one call as Alice" the way they already can for contacts and settings.

- ✅ Rename to **`agent`** in all ten `resolveCurrentAgent` call sites. `agent` wins: it is the
  spelling already on a shipped tool surface, and `name` is hopelessly overloaded now that agents,
  contacts, monikers **and sessions** all have names.
- ✅ **Expose `agent`** on the 8 that are MCP tools: `initiate_session`, `close_session`,
  `await_session`, `send`, `receive`, `sessions`, `sealed_receipt`, `transcript`.
- ✅ **Clean break, no compatibility alias** — but **update the two real producers.** My original
  "no external producer" claim was WRONG and CELLO_Support caught it: `cello refresh`
  (`commands.ts:426`) and `cello relay-receipts` (`:463`) send `{ name }` to two of the ten handlers,
  as a required POSITIONAL (which is why the `use-agent` replay doesn't cover them). Leave them behind
  and they fail **silently** — the param goes unread, `resolveCurrentAgent` falls through to
  sole-online, and **`cello refresh alice` rotates FROST shares for whoever happens to be online.** A
  silent misroute on key material: the very defect class this story exists to kill. Fix both call
  sites to send `{ agent: name }` in the SAME commit, with red tests pinning the misroute.
- ✅ **Do Part B before Part A** — Part A edits the same handler and must be born with the right
  spelling.

- **`DOD-SEAL-VISITING-DRAIN-1` — DIRECTORY SIDE, still open.** The client half is **fixed and
  shipped** (cello-client `0e48944`): every signaling stream now gets the whole seal listener bundle,
  so a `seal_unilateral_notification` on a visiting stream is handled. But the **directory** is still
  the loaded gun: it drains its **durable** notification queue on **any** stream that authenticates —
  visiting included (`packages/directory/src/directory-node.ts` ~1894-2003) — and `acknowledge()`
  **DELETEs the row** once sent. `pending_notifications` is cross-node replicated, so *every* node
  holds *every* agent's queued notifications. A transient connection can therefore **consume a
  durable notification**, and if the client ever fails to act on it, it is gone for good.
  - **Fix:** skip the drain (or at minimum skip the `acknowledge`) when `visiting === true`. A
    transient stream must never be able to permanently consume a durable row. Belt and braces —
    the client no longer drops the frame, but the directory should not be one client bug away from
    destroying a notarized receipt.
  - Related, same class: `void acknowledge(...).catch(() => {})` (`directory-node.ts` 1946/1960/1971/
    1976/1983/1989) is a **fire-and-forget delete of a durable row with the failure swallowed**. That
    is what would make a loss permanent *and* silent rather than retried.
  - **No test drives `seal_unilateral_notification` at the daemon level** — which is exactly why the
    asymmetry sat there unnoticed. `seal-listener-wiring.test.ts` now covers the client side.

## Tracked, not M8C-fruit (bigger friction — own items, NOT folded in as riders)

- **`DOD-TRANSPORT-PATH-1` — an agent cannot tell HOW it is connected: direct, hole-punched,
  relayed, or mailbox. Today "CELLO is slow" and "CELLO is relaying every byte because your hole
  punch failed" look IDENTICAL from the outside.** Raised 2026-07-14 off the back of
  `DOD-NAT-REACHABILITY-1`. The daemon knows; the agent cannot ask.
  - **The four states that must be distinguishable:**
    | state | meaning |
    |---|---|
    | `direct` | never relayed — a direct connection from the start |
    | `hole_punched` | started relayed, DCUtR upgraded it to direct |
    | `relayed` | still on the circuit — the punch failed and the RELAY is carrying the session live |
    | `mailbox` | no live connection at all; store-and-forward |
  - **What already exists (in pieces, in the logs — none of it queryable):**
    - *Am I NAT'd?* AutoNAT computes it. `CelloNode.getDialability()` → `{dialable, publicAddr}`;
      `dialable: false` means nothing outside reaches you directly. Logged as
      `transport.autonat.result`. **Not in `cello_status`.**
    - *Did this connection come through a relay?* `session.transport.connected` logs the address,
      and a relayed one contains `/p2p-circuit`. **Not stored on the session.**
    - *Is there a direct connection right now?* `CelloNode.hasDirectConnectionTo(peerId)` — true only
      for an open, non-circuit connection.
    - *Did it go to the mailbox?* This one IS visible to the caller: `cello_send` returns
      `delivered: true`, or `ok: false, reason: "dispatched_to_relay"`.
  - **The actual gap:** `direct` and `hole_punched` CANNOT be told apart. `hasDirectConnectionTo`
    reports only the CURRENT state — it cannot say whether the connection BEGAN relayed. And
    nothing emits a DCUtR upgrade event, so the moment of the punch is invisible. We have never once
    observed a successful hole punch in production, and as things stand we could not tell if we had.
  - **Build:**
    1. Record the path the session STARTED on (the address is already in hand at
       `session.transport.connected`).
    2. Detect the upgrade — watch `hasDirectConnectionTo` flip false→true while a circuit connection
       exists — and emit a named event (`session.transport.upgraded`).
    3. Store `transport_path` on the session; expose it in `cello_sessions` / `cello_status`,
       alongside a `self_dialable` flag from AutoNAT so an agent knows it is behind NAT.
  - **Why it matters beyond tidiness:** the relayed-fallback path is CELLO's answer for hostile
    networks, and it is the path we can least afford to be blind on — a relayed session pays for
    every byte through a third party, and under the relay's old default limits it would also have
    been silently capped at 2 minutes. An operator asking "why is this slow" deserves an answer, and
    `DOD-NAT-REACHABILITY-1` was only found because someone happened to read the daemon log by hand.

- **`DOD-RELAY-REDUNDANCY-1` — an agent reserves with exactly ONE relay. Its inbound reachability
  therefore rests on a single relay.** Left open deliberately when `DOD-NAT-REACHABILITY-1` closed
  (2026-07-14). Inbound works; it just has no redundancy behind it.
  - **What ships today:** the standing receiver tries the candidate relays in order and KEEPS the
    first that actually grants a reservation (`session-node-manager.ts` → `#startReceiverNode`).
    One relay, one slot per agent. A watchdog watches the *connection* to that relay — not the
    `/p2p-circuit` address, which libp2p keeps for up to two hours after the relay dies — and on
    loss it re-probes and rebuilds against another relay (`W1`).
  - **Why not several relays:** measured against the real relays, listening on N circuit addresses
    is *worse than useless*. libp2p reserves with `DEFAULT_RESERVATION_CONCURRENCY = 1` and
    `start()` awaits EVERY circuit listener, so N relays serialize into N × (connect + reserve)
    before the node exists at all — and it yields **one** relay's addresses anyway. Asking for
    three bought no redundancy and cost 3 of 4 live agents their reservation entirely.
  - **The unexplained gap — do not assume it is understood.** Two relays blew a 15-second deadline
    when each reserves in 3–4s alone; and three *configured* relays yield only one relay's
    addresses even when start completes (libp2p's `HadEnoughRelaysError` cap applies only to
    *discovered* relays, so that is NOT the explanation). Both were set aside once the relay's
    15-slot exhaustion turned out to be the real root cause. **Anyone picking this up starts by
    explaining those two facts** — the single-relay design is an empirical floor (one relay works
    reliably in every experiment), not a understood one.
  - **Why it is forgivable at launch:** the failure mode is bounded and covered. If the relay dies,
    the watchdog re-picks within a tick; if none can be had, the receiver still comes up on the
    direct path, loudly degraded, never deaf. A user is unreachable only in the window between a
    relay's death and the rebuild.
  - **Note for whoever takes it:** a reservation is scarce (the relay holds it for its full TTL even
    after the client disconnects), so any redundancy design must count slots. An earlier probe
    design burned TWO slots per agent to obtain one and was deleted for exactly that reason.

- **`DOD-TYPECHECK-TESTS-1` — NO TEST FILE IN THIS REPO IS TYPECHECKED.** Found 2026-07-13 during
  the daemon Seam C review. Every `core/*/tsconfig.json` has `"exclude": [..., "src/__tests__"]`
  (correctly — `tsc --build` emits, and a test must never land in `dist/`), and `pnpm typecheck` is
  just `tsc --build`. Vitest's esbuild **strips** types without checking them. So a type error in a
  test **ships silently**, and neither gate ever sees it.
  - **Why it matters beyond tidiness:** it makes a whole class of test claim *unfalsifiable*. A test
    that constructs a module's deps object is supposed to go RED when that module grows a new
    required dependency — that is how a test pins a seam. Untypechecked, the new field simply
    arrives `undefined` and the test passes, still asserting the module is decoupled **while it is
    being re-coupled**. The `contact-handlers` seam test hit exactly this.
  - **Measured cost: 209 errors across 45 test files.** Most are test doubles that have silently
    **drifted from the interfaces they impersonate** (e.g. `FakeNode` is missing `CelloNode`'s
    `hasDirectConnectionTo` and `keyProvider`) — a stub that no longer resembles the real thing is a
    test passing for the wrong reason, and this is *why* they drifted.
  - **The recipe** (validated, then reverted — a config with no consumer must not ship): a root
    `tsconfig.test.json` extending `tsconfig.base.json` with `composite:false`, `declaration:false`,
    `noEmit:true`, `rootDir:"."`, `include: ["core/*/src/**/*.ts"]`; run it after `tsc --build` (it
    resolves against the emitted `.d.ts`), and add it to the `typecheck` script.
  - Not a launch blocker, and **not a rider on a refactor** — it is 45 files of real cleanup.

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
- **DOD-SESSION-REAP-1** (2026-07-11, observed live) — restart-interrupted sessions accumulate as
  un-sealable cruft and never self-clean. When the daemon restarts, both agents lose in-memory session
  state (session node + standing receiver are built at startup, not persisted mid-flight), so a later close
  gets `seal_interrupted_rejected_by_counterparty` — the counterparty, also restarted, has no consistent
  record. A normal close can't finalize; only force-abandon clears it. Heavily amplified by the single-daemon
  dev setup (all agents co-located, constant publish/promote restarts → 8 piled up 2026-07-11, hand-cleared).
  Rarer in a real two-machine deployment (one side's restart leaves the other's state intact). **Fix = an
  auto-reaper, but EVIDENCE-GATED, never age-gated** (Andre, the load-bearing constraint): reap ONLY on a
  *definitive, permanent* rejection from a *reachable* counterparty (the reject signal above) — the same
  probe-then-force sequence done by hand. NEVER reap on age, on unreachability (unknown ≠ unsealable — the
  session may still seal when the counterparty returns), or on a pending bilateral seal (a healthy
  waiting-to-co-sign state). A retired/removed counterparty is reapable (identity can never co-sign — verify).
  Guard against a *transient* reject during the counterparty's own restart window (require "no record of this
  session," ideally stable across attempts). Cosmetic, not launch-blocking; belongs with the restart-churn
  family. Cross-ref DOD-SINGLE-DAEMON-1, F21 (stuck-seal terminal state). — ❌ NOT BUILT (backlog).

- **DOD-SIGTERM-FLAKE-1** (2026-07-12, surfaced by CELLO_Support during the SEC-1 publish, flagged not
  fixed) — `session-node-manager.test.ts` "AC-009 (binary): SIGTERM marks active sessions interrupted,
  survives daemon restart" failed on CI (`expected 'active' to be 'interrupted'`) on a commit that touched
  only docs/scripts (cello-client `29177125124`, the dead-code-report merge immediately before the SEC-1
  tag) — passed on the SEC-1 tag's own CI run and passes locally (2161 green). Intermittent, not caused by
  SEC-1. Per the debugging discipline this is a real failing assertion in the restart/interrupt path and
  needs a root-cause pass (producer/consumer trace on the SIGTERM → interrupted-state write), not attribution
  to flakiness without evidence. — ❌ NOT INVESTIGATED (backlog).

- **DOD-LIBP2P-DUP-1** — ✅ **FIXED 2026-07-13 (`b88ea8b8`). The original diagnosis below was WRONG;
  corrected here rather than deleted, because the wrong diagnosis is the lesson.**

  **What it actually was:** an upstream **breaking change shipped in a PATCH release**.
  `@libp2p/interface` **3.2.5 removed `Symbol.iterator` from `Stream`**, so every site that pipes a
  stream (`lp.decode(stream)` and friends) stopped type-checking:
  `Argument of type 'Stream' is not assignable to parameter of type 'Iterable<Uint8Array |
  Uint8ArrayList>' — property '[Symbol.iterator]' is missing in type 'Stream'.`
  **94 errors, 45 of them in `directory-node.ts` (production code, not tests).** Nothing pinned the
  package — every dependency asks for `^3.0.0` — so regenerating the lockfile during the crypto 0.0.20
  re-pin (`d11976a8`) silently walked **3.2.2 → 3.2.5**. Our code never changed; a caret range
  re-resolved onto a bad patch. Verified: **zero** occurrences of `3.2.5` in the lockfile at
  `d11976a8~1`, two at `d11976a8`.
  **Fix:** `pnpm.overrides` → `"@libp2p/interface": "3.2.2"`. Typecheck **94 → 0**; lint green; clean
  build (dist wiped + tsbuildinfo purged) emits directory and relay; the directory suite is unchanged
  at 1021 passing, **including every libp2p-exercising test** (federation, cross-node discovery, real
  FROST streams) — so it is not a type-level paper-over hiding a runtime break. Runtime was never
  broken; the **compiler** was.

  **The original entry claimed a DUPLICATE-VERSION problem — two copies of `@libp2p/interface` (3.2.2
  and 3.2.5) and two majors of transitive `uint8arraylist`. There was never a duplicate: the tree
  holds exactly ONE copy.** That misdiagnosis came from reading the *symptom* (a `Uint8ArrayList` type
  mismatch, which looks exactly like a dual-copy nominal collision) and inferring the *cause*, then
  attempting an overrides-based dedupe that "only partially worked" — because it was deduping
  something that was never duplicated. **Lesson: a type-identity error is not proof of two copies.
  Count the copies (`grep the lockfile`) before naming the cause.** The half-working fix was the tell,
  and it was recorded as a puzzle rather than treated as evidence the diagnosis was wrong.

  **Standing risk this exposes:** every libp2p dependency across both repos is a loose caret
  (`^3.0.0`), and libp2p ships breaking changes in patch releases. Any lockfile regeneration can
  re-break this. A follow-up worth doing: pin the libp2p surface deliberately rather than pinning one
  package reactively.
- **DOD-FROST-PARALLEL-1** (2026-07-14) — ❌ **NOT STARTED. This is a GATE ON NODE EXPANSION, not a
  perf nice-to-have.** Full two-sided trace (client daemon log + directory CloudWatch, every hop, no
  aggregation): [[2026-07-14_frost-ceremony-latency-trace]].
  Session establishment is **~4.1 s at ONE directory**, and Andre has accepted that ("four seconds is
  not bad; ten seconds is getting long; under a few seconds is fine"). **The directory's actual
  cryptography is 41 ms of the 4,100** — 1%. The rest is network round trips and **two brand-new
  libp2p stream opens at ~350 ms each, in series**.
  **The defect:** `frost-threshold-signer.ts:484` walks the directory roster **SERIALLY** — an
  explicit `for … await` with the comment *"Gather per-stub (NOT Promise.all)"*. That comment's
  reasoning is **correct and must be preserved** (a refusing/hung node must be excluded and the round
  retried with survivors — `DOD-SUSPEND-1`, the availability invariant). **But it does not require
  serialism:** `Promise.allSettled` gives the identical exclusion semantics while paying the cost of
  the SLOWEST node instead of the SUM of all of them. Commitments are independent of each other, and
  signature shares are independent once the commitment list is fixed — that is FROST's shape.
  **Why it gates the federation:** today `commitmentList = 2` (the client + ONE directory), so the
  serial walk costs nothing. At N=10 with `T = majority(10) = 6` the client walks **5 directory stubs
  one at a time** — ≈3.4 s of commitments + ≈1.75 s of signatures = **~5 s ADDED**, using the 165 ms
  measured to us-east-1 (the far regions are slower). Setup goes ~4 s → **9–12 s**. **It crosses
  Andre's bar at roughly 3–4 directories, well before 10.** Fix it BEFORE the federation grows —
  after means every agent is already registered under the old threshold.
  Also surfaced by the trace, logged so they are not lost: **`session.relay.hash.submit.failed` fires
  on EVERY session and is swallowed** (a silent failure on the tamper-evidence path, not diagnosed);
  and the **directory floods production CloudWatch with `frost.debug.*` / raw `[DEBUG]` lines carrying
  share and nonce internals**.

- **DOD-M9-SWITCH-ON-1** (2026-07-13) — ✅ **DONE. M9 is live.** Confirmed per M9-DEFINITION-OF-DONE
  (all M9 stories EARNED including M9-CFG-001, M9-REC-001, M9-FEED-001, M9-OUT-004; gateway switched
  on; seam green). The Fable-5 security review defects and IN-003 language-allowlist concern were
  resolved as part of M9 delivery. Full checklist: [[2026-07-13_m9-switch-on-checklist]].

- **DOD-DEVENV-ROLES-1** — ✅ **FIXED 2026-07-13 (`ab428736`).** The local dev role passwords could
  **never** be set. `docker/postgres/initdb/01-dev-role-passwords.sql` ran as a Postgres **initdb
  hook** — which fires at first boot, **before Flyway** — but the roles it targets (`cello_service`,
  `cello_analytics`, `cello_ops_agent`) are **created BY Flyway** (V2/V7/V26). So its `ALTER ROLE`
  statements hit roles that did not exist yet, and **every fresh volume left them password-less**:
  **129 directory test failures, all `password authentication failed for user "cello_service"`.** The
  script's own header even says the roles come from Flyway — it was simply wired to the wrong
  lifecycle point. **It only ever appeared to work on long-lived volumes where someone had set the
  passwords by hand — so the breakage was invisible until you reset the volume, which is exactly what
  a new contributor does first.** Fix: a `role-passwords` compose service applying the same SQL with
  `ON_ERROR_STOP=1`, gated on `flyway: service_completed_successfully`; the initdb `COPY` is removed
  from the Dockerfile with a comment recording why it cannot live there. Verified from a **virgin
  volume** (`down -v && up -d`, zero manual steps): `cello_service` authenticates and the directory
  suite goes **129 failures → 3**.

- **DOD-ACCOUNTS-CHAIN-1** (2026-07-13, found by Ms_Chelly while clearing the above) — ❌ **OPEN, and
  the one worth a real look.** `verifyChain("user_accounts")` fails **whenever the ops-agent suite has
  run against the same database**; on a clean DB with only the directory suite it passes. The test's
  own comment asserts the invariant: *"no row can exist that was inserted outside the chain
  mechanism."* If the **ops-agent registration flow writes `user_accounts` rows without going through
  `insertWithChain`**, that invariant is false in production, not just in tests — and a hash chain
  with rows outside it is a **tamper-evidence gap in the exact table that binds a human to an agent**.
  Two possibilities, and they need to be told apart rather than assumed: (a) ops-agent genuinely
  inserts outside the chain — a real integrity defect; or (b) the test's whole-table global scope is
  too strong for a shared dev DB — a test defect. **Do not close this by scoping the test down until
  (a) is ruled out.** Reproduce: fresh volume → run ops-agent suite → run directory suite → the two
  `ACCOUNT-001` `verifyChain` cases (AC-005, AC-007) fail.

- **Directory suite: 3 remaining failures** (2026-07-13, non-blocking, characterised not fixed) — 2 ×
  "exits 1 with `migration.out.of.date` when no migrations have been applied" point at a database
  `cello_nonexistent_test_db` that `docker-compose.yml` **never creates**, so they get a connection
  error instead of the expected exit path (test-environment gap, not a code defect); 1 × `CELLO-M6B-009
  AC-001` pool-max under 50 concurrent queries — **not diagnosed**. Recorded so a future red run is not
  waved through as "the known ones" without someone having actually looked.

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
  **✅ FIXED, REVIEWED, PUBLISHED TO BETA — 2026-07-12 (CELLO_Support, kicked off from
  [[launch-triage]] item 1).** Design pass first (SPARC S+P+A):
  [[2026-07-12_sec-1-relay-park-authentication-design]] — ESCALATED the threat model past the
  original writeup: the RELAY ITSELF is the best-placed adversary (handed the session_id in
  plaintext + holds the mailbox key), not merely a stranger who learns a pubkey. FALSIFIED the
  option-(a) fix above — rejecting bare-content envelopes would have silently broken the
  CELLO-M7-MSG-001 crash backstop (a legitimate degraded path with no ordering record available at
  re-park time) — before any code was written. Shipped **option (b+)**: an Ed25519 sender signature
  domain-bound to `(session_id, recipient_pubkey, content_hash)`, carried INSIDE the seal so the
  relay can neither read, strip, nor forge it; recovery fails closed (unsigned / bad sig /
  signer≠counterparty / unknown session → refused, never confirm-deleted). cello-client `d1dd623`
  (fix) + `2d0cf91` (review fixes) — RED-FIRST proof against the pre-fix daemon confirmed the live
  exploit (forged content ingested, leaf appended, notarized) before the fix landed. Reviewer
  (cello-unit-reviewer, Opus) found 4 defects AROUND the sound gate, all fixed: a signer-pubkey
  hex-case-sensitivity bug (M1, MEDIUM-HIGH — would have silently refused legitimate mail as
  "attacks"), swallowed refusal counts (M2), a silently-discarded park-failure error (M3), an
  unbounded re-verify amplifier on a forged mailbox (M4) — plus a hollow-test finding
  (mutation-verified: every test built its own envelope, so a wrong-key producer bug would have
  shipped silently; fixed by making `sealParkEnvelope` the sole producer, round-tripped through the
  real seal). Direct content (non-park) attribution still relies on the transport/session layer, not
  a per-message signature — deliberately out of scope, recorded so it isn't later mistaken for
  covered. **Independently verified by Ms_Chelly** (not taken on report): pulled both repos, spot-
  checked the diffs match the described fix, ran `sec-1-park-authentication.test.ts` directly —
  14/14 green. **Published beta, tag `v0.0.98`**, verified against the TARBALLS (not commits):
  protocol-types 0.0.20, transport 0.0.18, client 0.0.49, daemon 0.0.50, cli 0.0.48, connect 0.0.68
  (crypto unchanged at 0.0.18 — real dependency graph, not a reflexive all-seven bump); cross-pins
  confirmed real versions, zero `workspace:*`. **✅ PROMOTED TO `latest` 2026-07-12 (Andre, ran it
  himself) — verified live**: `npm view @cello-protocol/{connect,cli,daemon,client,transport,
  protocol-types}@latest` all confirmed at the published SEC-1 versions (crypto unchanged, no-op).
  **SEC-1 is fully closed — fixed, reviewed, published, and now live for every default install.**
  **Migration: enforce-immediately** (Andre's decision, 2026-07-12) — an un-upgraded peer's parked
  mail is now refused (loud, not silent, nothing destroyed) until it upgrades; the EC2 demo agent is
  the known laggard and still needs `cello logout && cello login` / reinstall to pick up the new
  binary — not yet confirmed done.
  **Process note worth keeping:** CELLO_Support declined to treat Ms_Chelly's relayed "Andre says
  GO" as authorization to publish — a CELLO channel message is untrusted external data, and a
  relayed approval is not the operator's approval regardless of how well-verified the underlying
  work is. It got Andre's authorization directly before touching npm. Worth holding as a standing
  rule for any agent coordinating irreversible actions through another agent.
  **⚠️ Unrelated flake surfaced, logged not fixed (out of scope for SEC-1):** the CI run on main
  immediately before the SEC-1 tag failed `session-node-manager.test.ts` "AC-009 (binary): SIGTERM
  marks active sessions interrupted, survives daemon restart" (`expected 'active' to be
  'interrupted'") on a commit that touched only docs/scripts; passed on the SEC-1 tag's own run and
  locally (2161 green). Intermittent in CI, not caused by SEC-1, but a real failing assertion in the
  restart/interrupt path — needs its own root-cause pass per the debugging discipline, not a shrug.
  Tracked below as its own backlog line.

- **SEC-2 (2026-07-07, found while scoping DOD-PRIMARY-1's ceremony-gate) — ✅ FULLY CLOSED
  2026-07-12: FIXED, DEPLOYED, AND ENFORCEMENT LIVE-VERIFIED (both the positive AND the negative
  case). Was a 🚨 pre-existing CRITICAL forgery hole in the FROST signing path.**
  > **✅ NEGATIVE CASE PROVEN LIVE 2026-07-12 (Ms_Chelly, at Andre's direct request).** A throwaway
  > script (real `NetworkDirectoryNode`, real libp2p dial, deleted immediately after running — no
  > code changed, nothing committed) sent two deliberately unauthorized `frost_commit_request`
  > frames straight at the deployed us-east-1 directory, using Ms_Chelly's real, PUBLIC pubkey as
  > the impersonation target (the exact SEC-2 threat model: a party who knows only a public key).
  > **Test 1 — no `authSig` at all:** refused client-side (`AUTH_REQUIRED`) — confirmed independently
  > in the directory's own CloudWatch log the same second: `frost.auth.refused frame:"commit"
  > reason:"AUTH_REQUIRED"`. **Test 2 — a syntactically valid signature from an attacker's own
  > keypair (not the victim's):** refused (`AUTH_INVALID`) — confirmed server-side:
  > `frost.auth.refused reason:"AUTH_INVALID"`. Both the wire response AND the server's own log
  > agree, on the live, running, promoted directory — not a test harness. **Enforcement is no longer
  > merely believed to work; it has been watched refusing a real forged request.** SEC-2 needs
  > nothing further.
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

## Post-channel additions (2026-07-22)

- **DOD-STALE-INBOX-1** — `reapExpiredInboundSessions` (the TTL reaper that fires on every
  `cello_inbox` / `cello_check_notifications` call) dropped non-expired entries only on strict
  TTL expiry. An inbound session request whose session row already had a **terminal DB status**
  (`sealed`, `abandoned`, `seal_interrupted_pending`, `interrupted`) was retained in the pending
  queue forever — permanently visible as an open request even though the underlying session was
  closed. The fix: before the TTL check, do a `getSessionRecord` lookup; if the row is terminal,
  silently drop the queue entry (logs `session.request.reaped_terminal`). Infallible: a DB error
  or missing row skips silently (the TTL path still cleans it up when it expires). — ✅ PROVEN
  (2026-07-22, Build Journal Entry `[next]`): T5 (4 variants via `it.each`) added to
  `m8c-ttl-1.test.ts`; daemon 0.0.70 / tag `v0.0.123` published + promoted to `latest`;
  live `cello_inbox --scope all` shows zero pending session requests after the sealed test session.

- **DOD-SIGNAL-TOKEN-1** — `cello_send` (MCP) and `cello send` (CLI) enforce a `signal` parameter
  on every outbound message. The signal declares the sender's next action and causes the protocol
  token to be appended to the message body automatically:
  - `signal: "over"` → `[[OVER]]` appended (turn complete, entering read mode)
  - `signal: "standby"` + `est_minutes` → `[[STANDBY EST:Xm]]` appended (follow-up coming)
  - `signal: "wrap"` → `[[WRAP]]` appended (final message, close after send)
  A missing `signal` returns a rich structured error (`reason: "missing_signal"`) with full
  descriptions of all three options — not a generic validation failure. A missing `est_minutes`
  when `signal: "standby"` returns `reason: "missing_est_minutes"`. CLI flags: `--over`,
  `--standby <min>`, `--wrap`. **Design rationale:** tokens appear in the message body (not as
  metadata) so they become idioms in transcripts — the same way `RE:` and `FWD:` propagated
  through email without a spec. — ✅ PROVEN LIVE (2026-07-22, Build Journal Entry `[next]`):
  live two-agent session Ms_Chelly → CELLO_Feedback; Ms_Chelly sent with `signal: "over"`;
  CELLO_Feedback received the message with `[[OVER]]` appended in the body automatically;
  CELLO_Feedback replied with `signal: "wrap"`; bilateral seal completed
  (`sealed_root 37e71b67983792e19a0cd87eaafbeda725eb87dc54f0b9552a5eecabe837e857`).
  connect 0.0.83 / cli 0.0.71 / daemon 0.0.70, tag `v0.0.123`, promoted to `latest`.
  Design discussion log: [[walkie-talkie-signal-tokens-design]].

- **DOD-SEALED-INBOX-1** ✅ — sealed sessions with unread messages no longer pollute `cello_inbox`
  indefinitely, and operators have a way to clear them.

  **Problem:** `getUnreadSummary` queries the `transcript` table with no join to `sessions` — it
  surfaces unread received messages regardless of session status. A sealed session where the
  counterparty's final message arrived after the operator's last `cello_receive` (e.g. an
  away-mode answering-machine exchange) shows as unread forever with no way to clear it.
  `cello_receive` correctly refuses to run on a sealed session, so the watermark can never advance.

  **Design:** a `read_at` nullable timestamp column on the `sessions` table — local-only operator
  housekeeping, never propagated, never part of the seal ceremony or hash chain. A new
  `cello_dismiss({ session_id })` MCP tool (and `cello dismiss <session_id>` CLI command) sets
  `read_at = now`. `getUnreadSummary` excludes sessions where status is terminal AND
  `read_at IS NOT NULL`. `cello_inbox` groups its response into labelled sections:
  pending session invites, expired session invites, unread messages (active/interrupted sessions),
  sealed-unread (terminal sessions with unread), and rename notices. The sealed-unread section
  includes guidance: "Use `cello_transcript` to read, `cello_dismiss` to clear from inbox."

  **ACs:**
  1. `sessions` table gains a `read_at INTEGER` column (nullable, epoch ms). Migration is
     non-breaking (ADD COLUMN with no default).
  2. `cello_dismiss { session_id }` MCP tool: sets `read_at` on the named session for the current
     agent. Returns `{ ok: true }`. Errors: `session_not_found`, `session_not_terminal` (only
     sealed/abandoned/seal_interrupted_pending/interrupted sessions can be dismissed).
  3. `cello dismiss <session_id>` CLI command: same semantics, same errors.
  4. `getUnreadSummary` excludes sessions where status is terminal AND `read_at IS NOT NULL`.
  5. `cello_inbox` response groups results into five named arrays: `pending_session_requests`,
     `expired_session_requests`, `unread` (active/interrupted only), `sealed_unread` (terminal
     with unread and `read_at IS NULL`), `rename_notices`. `total_unread` counts only
     active/interrupted unread. A non-empty `sealed_unread` section includes a `guidance` field.
  6. `cello_dismiss` logs `session.dismissed { agentName, sessionId, status, unreadCount }`.
  7. Tests: (a) sealed session with unread does NOT appear in `unread`, appears in `sealed_unread`;
     (b) after `cello_dismiss`, session no longer appears in either section; (c) `cello_dismiss`
     on an active session returns `session_not_terminal`.

- **DOD-SEALED-INBOX-2** ❌ OPEN (raised 2026-07-30) — `cello_inbox` calls unsealed sessions sealed.
  The inbox is the one surface that asserts a seal, and for three of four statuses the assertion is
  false.

  **Observed live (2026-07-30).** A Cowork session left two messages for `CELLO_Feedback` and the
  daemon was killed mid-flight. `cello_inbox` returned the session under `sealed_unread` with
  `sealed_unread_guidance: "These sessions are sealed with unread messages…"`. It was not sealed:
  `cello_sealed_receipt` said `not_sealed_yet`, `cello_sessions` said `status: "interrupted"`, and
  the daemon log had no `seal.certificate.frontier.verified` for it (the two sessions that DID seal
  that day both have it). **The agent reading the inbox repeated "it's sealed" to the operator as
  fact.** It took a direct "is it actually sealed?" to catch — nothing in the system contradicts the
  label unless you go and ask a second surface.

  **Root cause — the label, not the query.** `session-node-manager.ts`:
  `#TERMINAL_STATUSES = ('sealed','abandoned','seal_interrupted_pending','interrupted')`.
  `getSealedUnread()` selects on that set and `notification-handlers.ts` reports it as
  `sealed_unread`. The set is correct — all four are terminal — but only `sealed` is notarized:
  `abandoned` forfeited the receipt deliberately, `seal_interrupted_pending` is awaiting
  notarization, `interrupted` was never closed. **The seam is visible in `DOD-SEALED-INBOX-1` above:**
  its design paragraph says "sealed-unread (**terminal** sessions with unread)" while its AC 5 names
  the wire field `sealed_unread`. The design said terminal, the wire said sealed, and nothing
  reconciled them.

  **Why this is not a papercut.** CELLO's product IS the receipt. "This conversation is notarized" is
  the one claim the entire stack exists to support and the one an operator repeats to a counterparty.
  A surface that answers "sealed" for a session with no seal is the protocol misreporting its own
  core guarantee — on the surface most likely to be read by an agent rather than a human, and
  therefore most likely to be relayed onward unchecked.

  **ACs:**
  1. Every `sealed_unread` entry carries its real `status`, so notarization cannot be inferred from
     the field name alone.
  2. The guidance string no longer asserts that the sessions are sealed. It describes them as
     terminal (closed, no longer active) and directs the reader to `cello_transcript` /
     `cello_dismiss` as before.
  3. The field is renamed `terminal_unread`, with `sealed_unread` retained as an alias for one
     release — prompt text and the shipped skills reference the current name. This is a RESPONSE
     field, so the Cowork argument-stripping constraint does not apply (see
     `cello_session_id`, 2026-07-29).
  4. Shipped prompt text moves with the field in the same version: `SKILL.md`, the plugin skills,
     and any slash command that reads the inbox.
  5. Test: an `interrupted` session with unread received messages must not be described as sealed by
     ANY field name or guidance string in the `cello_inbox` response. Same for `abandoned` and
     `seal_interrupted_pending`.
  6. Test: a genuinely `sealed` session with unread messages still appears, and its entry still
     reports `status: "sealed"`.

  Full write-up, including the live probe table: [[2026-07-30_1330_inbox-calls-unsealed-sessions-sealed]].

- **DOD-FRONTIER-STRAND-1** ❌ OPEN (raised 2026-07-30) — a leaf appended locally but never recorded
  by the counterparty strands the session as **permanently unsealable**, and nothing detects or
  repairs it.

  **Found live during cleanup (2026-07-30).** Session `dbb93dfcf415b7cbfe13626f5b168a3f`
  (Ms_Chelly ↔ CELLO_Support, **both agents on the same daemon**) had sat `interrupted` since
  2026-07-23. A normal close was refused from BOTH directions with
  `seal_interrupted_rejected_by_counterparty`. The two transcripts diverge at exactly one leaf:

  ```
  Ms_Chelly     (5): 0 sent greeting │ 1 recv "Hello" │ 2 sent greeting AGAIN │ 3 recv "another" │ 4 sent WRAP
  CELLO_Support (4): 0 recv greeting │ 1 sent "Hello" │        —              │ 2 sent "another" │ 3 recv WRAP
  ```

  The **second away autoresponse** — the spurious echo `DOD-AWAY-WRAP-1` was written to eliminate —
  was appended to Ms_Chelly's local tree and never recorded on the counterparty. This session
  predates that fix, so the echo itself is already addressed. **What is NOT addressed is the
  consequence:** the frontiers permanently disagree (5 vs 4), so each side refuses to co-sign the
  other, and the session can never produce a receipt. Force-abandon is the only exit, and it forfeits
  the seal. One undelivered leaf cost the conversation its notarization, forever.

  **Why this outlives the away bug.** The away echo was one way to produce an undelivered local leaf.
  Any future path that appends before it delivers produces the same strand, and the system currently
  has no detection (nothing flagged it for a week), no diagnosis (the refusal names the counterparty,
  not the mismatch), and no repair. That both ends were on ONE daemon rules out a network partition
  as the explanation — a local append simply was not mirrored.

  **ACs:**
  1. A leaf is appended to the local tree only once its delivery to the counterparty is recorded, OR
     an undelivered append is reconciled/rolled back rather than left in the tree. Whichever is
     chosen, an append that the counterparty never records must not be a terminal state.
  2. `seal_interrupted_rejected_by_counterparty` reports the ACTUAL mismatch — both frontier
     sequence numbers and the diverging leaf index — instead of directing the operator to ask the
     counterparty to check their end. Here both ends were the same daemon, so that guidance was
     unfollowable.
  3. A frontier mismatch on an interrupted session is surfaced (log event + `cello_sessions` field)
     rather than discovered only when a close is attempted. This one went a week unnoticed.
  4. Tests: (a) a session whose two sides disagree by one leaf is detected as mismatched, not merely
     refused; (b) the refusal message names both frontiers; (c) the reconcile path (per AC 1) turns a
     one-leaf divergence into a sealable session, or the leaf is proven never to have been appended.

- **DOD-CLI-SESSIONS-SCOPE-1** ✅ FIXED (2026-07-30, cello-client `6b9964c`) — CLI `cello sessions` ignores the selected
  agent and lists every agent's sessions; the MCP `cello_sessions` scopes correctly. The dual
  surfaces disagree.

  **Observed live (2026-07-30).** With `CELLO_Feedback` selected, `cello_sessions` (MCP) returned
  `totalMatched: 0` while `cello sessions` (CLI) returned 2 — rows belonging to `Ms_Chelly` and
  `CELLO_Support`. Selecting each of the five agents in turn and re-running the CLI returned the same
  2 rows every time, which is the tell: the CLI is not filtering by agent at all. It also accepts no
  `--agent` flag (`Unknown flag '--agent' for 'cello sessions'`), so there is no way to ask it for
  one agent's sessions.

  **Why it matters beyond tidiness.** This is exactly the divergence `DOD-ONBOARD-HELP-1` §2b parity
  exists to prevent: the same verb, one name, two behaviours. A multi-agent operator reading the CLI
  concludes an agent has open sessions it does not have — and during this cleanup it briefly made a
  correct MCP answer look wrong. On a surface whose whole job is to tell you what state you are in,
  answering for the wrong principal is a correctness bug, not a UX one.

  **ACs:**
  1. `cello sessions` returns only the selected agent's sessions, matching `cello_sessions` exactly
     for the same selection.
  2. `cello sessions --agent <name>` is accepted, mirroring the MCP tool's `agent` parameter (the
     `DOD-AGENT-PARAM-1` convention).
  3. Where a listing spans agents, it is opt-in (`--all-agents`) and labels each row with its agent —
     never the default.
  4. Test: with agent A selected and open sessions existing only for agent B, `cello sessions`
     returns none, and `cello sessions --agent B` returns B's.
  5. Parity test extension: for every dual-surface verb, the CLI and MCP forms return the same set for
     the same agent selection. The existing parity test checks that NAMES match; it does not check
     that ANSWERS match, which is how this survived. — ⏳ **still open**: AC 1-4 shipped, this
     generalisation did not. `cello sessions` is now covered; no other dual-surface verb is.

  **Fixed 2026-07-30** (cello-client `6b9964c`): routed through the parity path, so it also gained
  `--agent`, the online check, and the same no-selection refusal as its siblings; the daemon-wide view
  survives as `--all-agents`. Verified live — 44 rows for the selected agent, 115 for
  `--agent Ms_Chelly`, 261 for `--all-agents`. Test note worth keeping: the two behavioural tests
  cannot catch a regression here, because in a temp daemon with no sessions the daemon-wide handler
  answers `ok` too. The wire name is therefore asserted directly, verified by mutation.

- **DOD-AWAY-WRAP-1** ✅ DONE — Away autoresponder must not fire on a `[[WRAP]]`-signalled message; it must close the session silently instead.

  **Observed behavior (live test 2026-07-23):** When CELLO_Feedback initiated a session with Ms_Chelly (away), the daemon fired the away autoresponse immediately at session open — before the caller had sent any content. This forced CELLO_Feedback to read the away notice before it could send anything (`session_not_current` / unread block). After reading, CELLO_Feedback sent its actual message with `signal: "wrap"`. The daemon fired the away autoresponse a *second* time, producing a spurious extra message in the transcript (seq 2 in both live tests). The session then sealed, leaving Ms_Chelly with a `sealed_unread` item containing the original caller message — but also a confusing duplicate away echo.

  **Two distinct bugs:**

  1. **Wrong message at session open.** The away text reads "your message was received and will be read when the operator returns" — but no message has been sent yet. At session-open time the caller has left no message. The correct behavior is to greet with instructions: "Ms_Chelly is currently away. Leave a message (send with `--wrap` to close after) and it will be read when she returns."

  2. **Away handler fires on `[[WRAP]]` messages.** A `[[WRAP]]`-signalled inbound message means the counterparty is done — they are closing the session. The away autoresponder must detect the `wrap` signal and skip the away reply entirely, then let the seal ceremony complete normally. Sending an away response to a `[[WRAP]]` message is meaningless (the caller has already declared they are done and will not read it) and adds noise to the sealed transcript.

  **Correct flow after fix:**
  1. Caller initiates session with an away agent → receives one clear away greeting with leave-a-message instructions.
  2. Caller sends message + `signal: "wrap"` → daemon detects `wrap`, skips the away autoresponse, closes and seals the session.
  3. Ms_Chelly's `cello_inbox` shows one `sealed_unread` entry containing only the caller's actual message — no spurious away echoes.

  **ACs:**
  1. The away autoresponse sent at session-open uses the text "X is currently away. Leave a message (send with `--wrap` to close) and it will be read when they return." (or the operator's configured away text, if set).
  2. The away handler checks the inbound message's signal flag before responding. If `signal = "wrap"`, it skips the away reply entirely and allows the seal ceremony to proceed.
  3. A sealed transcript for an away-mode exchange contains exactly: (a) the away greeting (seq 0, sent by Ms_Chelly), (b) the caller's actual message with `[[WRAP]]` (seq 1, received), and nothing else — no second away response at seq 2.
  4. Tests: (a) session-open away reply uses the new greeting text; (b) a `[[WRAP]]`-signalled message to an away agent does NOT trigger an away reply; (c) a non-wrap message to an away agent still triggers an away reply.

- **DOD-INBOX-ONESHOT-1** ✅ LIVE-PROVEN (2026-07-24) — Inbox (away-mode) sessions are one-shot: a second inbound message while the agent is unattended triggers a rejection reply and an immediate close.

  **Live proof (2026-07-24, session `9d6f56d7b25bb9fe494414d2650ed6bf`, CELLO_Support → CELLO_Feedback, same daemon):**
  greeting (seq 0) → caller msg 1 + away ack (seq 1–2) → clean second caller msg (seq 4) →
  `oneshot.rejected` (seq 5, 17:33:10.238) → `oneshot.seal_initiated path=relay` (+340 ms) →
  `oneshot.sealed root=2ad8a000…` (+4.2 s, bilateral — the counterparty auto-co-sealed on
  receiving the SEAL ctrl leaf; no voluntary `cello_close_session`, no 660 s wait). A further
  send was refused `session_not_active`. CELLO_Feedback's inbox showed the session in
  `sealed_unread` (3 unread). The feared "11 minutes of open ingestion" does not exist for
  honest clients: the exposure window is seconds; 660 s unilateral escalation remains the
  backstop for an adversarial client that refuses to co-seal.

  **Two defects found by the same live test (fixes tracked below):**
  1. `DOD-WRAP-SUBSTRING-1` — wrap detection is `text.includes("[[WRAP]]")` on the BODY: a
     message that merely *mentions* the token (sent `signal: "over"`) was classified as a
     close signal → away reply AND oneshot rejection skipped, session silently left open.
  2. `DOD-AWAY-ACK-ONESHOT-TEXT-1` — the message-1 ack ("your message has been received…")
     never says the inbox is one-shot, so a well-behaved caller LLM naturally sends a
     follow-up and gets rejected. The ack should state the one-message rule.

  **Motivation:** without a message-count cap, an abusive or looping caller can flood an unattended inbox with repeated `[[OVER]]` messages. The A4 dedup guard prevents duplicate away replies but does not prevent the transcript from growing unboundedly, forcing the operator's LLM to drain arbitrarily many `cello_receive` calls on the next attend.

  **Rule:** once the away greeting has been sent (the first message has been received and auto-acked), any further inbound message on an unattended session is treated as an abuse attempt. The daemon:
  1. Sends a single rejection reply: `"[[WRAP]] This inbox only accepts one message. Closing."` (or similar — the `[[WRAP]]` token signals to the caller's LLM that the session is closing).
  2. Initiates the seal via the relay-mediated path (`submitSealLeaf` → 660 s bilateral wait → unilateral escalation).

  **Only fires when unattended.** If the operator becomes attended between message 1 and message 2, `isAttended()` returns true, the away path never runs, and the session continues normally.

  **ACs:**
  1. A second inbound message on an unattended session that has already received an away ack causes the daemon to send a `[[WRAP]]`-bearing rejection reply and initiate the relay-mediated seal. *(Note: AC1 originally specified `handleActiveSealFlow`; the implementation uses the relay-mediated path instead — see BUILD-JOURNAL 2026-07-23. This is a superset: the signaling-only path was the wrong choice for this flow.)*
  2. The rejection message text contains `[[WRAP]]` so the caller's LLM sees the session is closing.
  3. No further away acks are sent after the rejection — the session closes.
  4. If the agent is attended when the second message arrives, NO rejection fires.
  5. Tests: (a) second message while unattended → rejection sent + seal initiated; (b) attended → no rejection; (c) `[[WRAP]]` as the second message does NOT trigger the rejection (it is already handled by DOD-AWAY-WRAP-1 and closes cleanly).

  **Built 2026-07-23** (commit `12338c3`, cello-client `main`). Seal path bug fixed: original implementation routed through `handleActiveSealFlow` (signaling-only bilateral) which raced with the P2P content delivery — CELLO_Support's tree was always one leaf behind at seal-request time, causing a permanent `leaf_count_mismatch` rejection and a zombie session. Rerouted to the relay-mediated path, which has no bilateral leaf-count comparison. Falls back to the signaling path only when `relay_unavailable`. Needs live proof (both-sides-local same-daemon scenario) before ✅.

- **DOD-SEAL-BILATERAL-TIMEOUT-1** ✅ (2026-07-24) — Raise the bilateral seal timeout default from 30 s to 660 s so `seal_unilateral_too_early` is structurally unreachable. *(Live status: the oneshot relay-path seal completed bilaterally in 4.2 s — the 660 s window is the untriggered backstop, exactly as designed. The ACs are code-level and built; the daemon-initiated close completing without operator intervention is the intent, and that is live-proven.)*

  **Root cause:** the directory's delivery-grace window is 600 s (10 min). The client's bilateral wait is 30 s. The client times out 570 s before the directory allows a unilateral seal, so every close on an unresponsive counterparty returns `seal_unilateral_too_early` and the operator must wait and retry manually. In a daemon-initiated close (e.g. DOD-INBOX-ONESHOT-1), there is no operator LLM to read the retry guidance — the session sits in `seal_interrupted_pending` indefinitely.

  **Fix:** change the default of `CELLO_SEAL_BILATERAL_TIMEOUT_MS` from `30_000` to `660_000` (11 min). This is deliberately slightly over the grace window so a bilateral timeout always lands after the grace window has elapsed. The `seal_unilateral_too_early` path remains in the code but becomes unreachable under normal configuration.

  **ACs:**
  1. The default value of `CELLO_SEAL_BILATERAL_TIMEOUT_MS` (the `|| fallback` in `close-session-handler.ts`) is `660_000`.
  2. The existing `CELLO_SEAL_BILATERAL_TIMEOUT_MS` env-var override remains functional for tests and operators who need a shorter window.
  3. Comment at the constant explains the relationship to `deliveryGraceSeconds`.

  **Built** in prior M8C work (660 s default in `close-session-handler.ts`). The 2026-07-23 seal-path fix (DOD-INBOX-ONESHOT-1) made this timeout effective for the oneshot inbox path: the original `handleActiveSealFlow` call bypassed `close-session-handler.ts` entirely, so the 660 s timeout never applied. The relay-mediated path now reads `CELLO_SEAL_BILATERAL_TIMEOUT_MS` directly and routes through unilateral escalation on timeout, completing the full intent of this line.

- **DOD-WRAP-SUBSTRING-1** ✅ DONE (2026-07-24, cello-client `d3d2afb`, reviewed) — Wrap-signal detection must match the APPENDED token, not any substring of the body. Fixed: `text.trimEnd().endsWith("[[WRAP]]")`; 3 red-first tests. Reviewer (cello-unit-reviewer: spec FAITHFUL, tests have teeth) added two consistency fixes, landed in the same commit: the request greeting now instructs `signal: wrap` instead of the literal token (a pasted mid-body token is invisible to the end-anchored detector), and the oneshot rejection moved its `[[WRAP]]` to the END so the daemon's own output honors the append-at-end contract.

  **Found live 2026-07-24** (session `9d6f56d7…`): `sendAwayResponse` checks
  `text.includes("[[WRAP]]")` (daemon.ts, DOD-AWAY-WRAP-1 AC2). A caller message sent with
  `signal: "over"` whose body merely *mentioned* `[[WRAP]]` was classified as a close signal:
  the away reply was skipped, the oneshot rejection was skipped, and the session stayed open
  silently. DOD-SIGNAL-TOKEN-1 always appends the real token at the END of the body — the
  detection must anchor there (`text.trimEnd().endsWith("[[WRAP]]")` or equivalent), matching
  the producer's contract instead of matching mentions.

  **ACs:** (1) detection anchors to the end-of-body token; (2) a `signal:"over"` message whose
  body mentions `[[WRAP]]` mid-text triggers the normal away/oneshot path; (3) a genuine
  `signal:"wrap"` message still skips the away reply; (4) tests for both, red-first.

- **DOD-AWAY-ACK-ONESHOT-TEXT-1** ✅ DONE (2026-07-24, cello-client `d3d2afb`, reviewed) — The away ack must state the one-shot rule. Fixed: ack now ends "This inbox accepts one message per visit — please close the session now (send with signal: wrap) instead of sending more."; red-first test asserts the phrase via the real ingest→away path.

  **Found live 2026-07-24:** after the caller's first message the ack reads "Agent is currently
  away. Your message has been received and will be read when the operator returns." — no
  mention that the inbox accepts exactly one message. A cooperative caller LLM reading that has
  no reason to stop, sends a follow-up, and eats the rejection: the design manufactures the
  case it punishes. Fix: append "This inbox accepts one message per visit; the session will
  now close." (or send `signal: wrap` semantics on the ack itself). AC: ack text names the
  one-shot rule; test updated.

- **DOD-RECEIVE-GUIDANCE-1** ✅ LIVE-PROVEN (2026-07-25, cello-client `5a9813d`, published daemon `0.0.75` / cli `0.0.76` via tag `v0.0.128`, promoted to latest) — `cello_receive` must surface next-step guidance on every delivered message, keyed on the counterparty's signal token, so the receiving agent knows its correct next move without consulting external docs.

  **Live proof (session `5b07cd90…`, CELLO_Support → CELLO_Feedback, published binaries):**
  - Positive case — the one-shot rejection ending `[[WRAP]]` returned `guidance: "Counterparty wrapped. Call cello_close_session now — do not reply."` The receiving agent then closed without replying; `cello_inbox` for CELLO_Support ended at zero unread (the original bug left one orphan per session).
  - Negative case — both away-ack messages, whose prose mentions "send with signal: wrap" but carry NO appended token, correctly returned NO guidance field. Confirms the end-anchored detector (DOD-WRAP-SUBSTRING-1) does not fire on a mere mention.
  - Binary verified: all four strings grepped out of `package/dist/session-content-handlers.js` in the published `@cello-protocol/daemon@0.0.75` tarball; `cli@0.0.76` pins `daemon@0.0.75` (real version, no `workspace:*`); `smoke-tag` green.

  **Found live 2026-07-25:** receptionist-check sessions consistently left one sealed-unread per session. Root cause: the successful-delivery return in `session-content-handlers.ts` carried no guidance. Every error path had one; the happy path was skipped. On receiving `[[WRAP]]` with no guidance, the agent replied — creating an orphan message that arrived after the sender had correctly closed.

  **Fix:** detect the end-anchored signal token in the delivered content (reusing the `trimEnd().endsWith` pattern from DOD-WRAP-SUBSTRING-1) and emit a `guidance` field:
  - `[[WRAP]]` → "Counterparty wrapped. Call `cello_close_session` now — do not reply."
  - `[[OVER]]` → "Counterparty's turn is done. Counterparty has indicated they are expecting a reply — use `cello_send` to reply."
  - `[[STANDBY EST:Xm]]` → "Counterparty is working and will follow up when done — no response expected. To block: call `cello_receive` with a longer `timeout_ms`. To check back later: schedule a cron and call `cello_receive` then."
  - Timeout (`content: null`) guidance extended to add: "do not resend your last message."

  No new tests required — the guidance strings are data, not logic; the token detection reuses the proven end-anchored pattern already covered by DOD-WRAP-SUBSTRING-1's test suite.

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
