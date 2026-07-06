---
name: M8C Milestone — Spec
type: spec
date: 2026-07-05
milestone: M8C
status: active
topics: [command-surface, notifications, channels, reactive-messaging, telegram-relay, async-messaging, multi-daemon, contact-privacy, abuse-controls, config-surface]
description: >
  The design reference for M8C — command surface, notifications, and reactive messaging.
  Goal: CELLO stops being poll-only. A running Claude session is woken by inbound events,
  the command surface collapses to "login → talk", the operator is reachable on their phone,
  and the async/multi-daemon foundations land in ordered tiers. Scope settled with Andre
  2026-07-05 (see M8C-DECISIONS). Pairs with M8C-DEFINITION-OF-DONE (yardstick),
  M8C-PROCEDURE (runbook), M8C-BUILD-JOURNAL (audit trail), M8C-DECISIONS (forks + choices).
---

# M8C Milestone — Spec

## 1. The goal

Make CELLO **reactive**. Today every inbound event — a peer opening a session, a message arriving —
sits silently until the operator polls. M8C inverts that: the daemon pushes, a live `--channels`
Claude session wakes in-context, the operator's phone rings via a daemon-owned Telegram bot, and
non-push clients get a first-class pull surface (`cello_check_notifications`, `since_seq`). On top
of the reactive core: the command surface collapses to "login → talk", away/contact/abuse policies
make an unattended daemon a good citizen, and the async-messaging + multi-daemon foundations land
as the final tiers.

**The launch gate is end of Tier 1** (reactive doorbell + usable command surface). M8C continues
past launch through Tier 5 — the milestone is bigger than the launch slice, deliberately
(Andre, 2026-07-05: keep it all in one milestone with strict tier ordering).

## 2. Current reality (verified in code 2026-07-05 — build on this, do not re-derive)

Full verdict table + evidence: [[M8C-MILESTONE-NOTES]] §Verification pass. The load-bearing facts:

- **The daemon already pushes; the shim drops it.** `NotificationDispatcher` dispatches
  `session_state_changed`/`created` on real inbound sessions (`daemon.ts:3183` — line numbers
  drift; cite symbols in stories); frames cross the IPC socket; the shim discards every
  notification frame at `ipc-proxy.ts:183-185` (`// skip for now`, a deliberate M7 deferral).
  Stage 1 = two shim edits + `connect` bump, **zero daemon change**. `ipc-client.ts:68` is the
  `onNotification` template.
- **Stage 2 (per-message wake) is a real daemon build.** No `dispatchCelloMessage`, no
  content-arrival callback on `session-node-manager`. Gaps 3–6 of the 2026-07-01 log.
- **`--channels` is a hard requirement** for the in-context wake; a dormant Claude cannot be
  roused (the shim is a stdio subprocess of a running session). Settled — the Tier 1 spike
  confirms CELLO's specific end-to-end wiring, not the flag.
- **M9 merge** (deferred — post-channel, D11; NOT a prerequisite). As of 2026-07-06 it is **no
  longer conflict-free**: main drifted since the 2026-07-05 dry-run and there are now 4 conflicts
  (`daemon.ts`, `session-node-manager.ts` — the seam files — plus `tsconfig.json`,
  `vitest.workspace.ts`). m9-build = +6,438 lines, mostly the self-contained `core/gateway`
  package. When it eventually lands it needs a **semantic gate**: prove every content path routes
  through `screenInbound`/`screenOutbound` post-merge, and re-run `m9-gate-1.test.ts` (also confirm
  it is green on `m9-build` first — the M9 journal never recorded it).
- **The Telegram half is already written.** Anthropic's vetted plugin (1,038 lines, grammy/bun,
  on disk) transfers near-verbatim; the single-`getUpdates`-consumer-per-token constraint (stated
  verbatim in its code) is the evidence that decided OQ-1 for daemon-owned.
- **`since_seq` has zero hits** in cello-client; **`ipc.connect` carries only `clientType`**
  (no capability negotiation); **relay `pickup_queue` exists** (V34/V35) with the
  ask-on-reconnect step confirmed missing.
- **Notifications are fire-and-forget** — no ack, no redelivery. `cello_check_notifications` is
  the loss-reconciliation mechanism, which is why it is Tier 1, not a convenience.
- **TWO MCP server surfaces exist — do not confuse them (verified in code 2026-07-06, D7).** The
  LIVE daemon shim is `core/adapter-claude-code/src/bin/cello-mcp.ts` (bare `McpServer`, no
  channel capability, every tool a thin `proxy.call()` over the IPC socket) — WAKE edits THIS
  file. `src/server.ts` in the same package (647 lines, exported as `createMcpServer`) is the
  LEGACY pre-daemon in-process adapter — NOT on the daemon path — but it already contains the
  complete stage-1 pattern to port: the `claude/channel` capability declaration and
  `notifications.ts` (`pushSessionRequestNotification` / `pushChannelNotification`). Do not edit
  `server.ts` thinking it's live, and do not grep-find `notifications.ts` and conclude stage 1 is
  already built — it is built for the wrong (legacy) server.
- **Two porting traps in that reference code (D7):** `notifications.ts` swallows push failures
  with a bare `catch {}` — the port must log the failure (`notification.push.failed`, debug);
  fire-and-forget is the design, invisible is not. And `IpcProxy` has NO reconnect (socket close
  = `ipc_connection_lost` forever; recovery is a fresh shim process + INBOX on attach, never an
  in-place reconnect), and its malformed-frame handler resolves the OLDEST pending request — the
  notification-forwarding branch must run BEFORE response correlation and never touch `#pending`.
- **The channels mental model (Andre, 2026-07-06 — everyone who looks at this gets it wrong;
  don't).** `--channels` is a Claude Code STARTUP FLAG; a channel's one power is injecting events
  into a live Claude Code session. M8C builds exactly ONE channel: daemon → shim → Claude
  session. Telegram is NOT a channel — the daemon implements the Telegram Bot API directly (its
  own long-poll egress to api.telegram.org), entirely outside channel machinery. The Anthropic
  plugin is REFERENCE for both patterns independently (how to use channels; how to use the bot
  API) — nothing is "ported as a Telegram channel," and "stage 3" in the inventory is historical
  numbering, not channel plumbing.

## 3. Target architecture (decisions baked — see M8C-DECISIONS)

**Channels as the reactive core (CONFIRMED).** The daemon is the always-on receiver and the
common substrate; each adapter differs only in how its runtime is woken. The channel push is a
**content-free doorbell** (type + counterparty pubkey + `session_id`); `cello_receive` fetches the
letter — SI-001 content-minimization holds through every wake. Every push has a pull equivalent;
nothing assumes Claude Code (Bedrock/cron clients poll the same state).

**Daemon-owned Telegram bot (DECIDED — OQ-1 closed 2026-07-05).** The daemon holds the bot
connection; the token is a daemon setting. One long-lived poller uniquely owns the token (kills
~100 lines of per-session contention handling), works **cold** (no live agent session needed), and
is runtime-agnostic — Claude Code's edge is push latency, not capability. M8C ships **Mode 1
doorbell level only**; full-monitoring + Mode 2 (operator as communicator, approvals gate) are the
follow-on milestone's opening track. Inbound operator messages are daemon-tagged operator-origin.

**M9 is the security floor — merged AFTER the channel work, NOT first (D11, 2026-07-06 — supersedes
the earlier "Tier 0 / merged first" framing).** All content screening (injection defense,
redaction, size caps, rate limits) is M9's, attached at `screenInbound`/`ingestReceivedContent`
and `screenOutbound`/`cello_send`. **Do NOT merge `m9-build` before the channel tiers** — DOD-M9INT-1
is deferred to after them (see M8C-DEFINITION-OF-DONE "Post-channel — deferred" and [[M8C-DECISIONS]]
D11). The channel tiers owe only **seam-readiness**: build every new content path (notably
LEAVEMSG's relay pull) through the single `ingestReceivedContent` inbound funnel / `cello_send`
outbound point, so the later merge attaches the gateway at exactly two places and screens
everything. M8C never re-invents an M9 piece.

**Multi-daemon = Primary/Standby (Tier 5).** Same K_local on both daemons; exactly one Primary
(standing receiver + FROST); directory arbitrates via a one-time primary-transfer offer (2-min
TTL). The ECDH device-linking handshake ("how does daemon A authenticate that daemon B belongs to
the same operator?") gets its **own design log before any code** — it is a crypto attack surface.
DB sync is user-initiated. Sessions never migrate live: close → sync → new session.

## 4. Tiers & dependency order (units → DoD lines in M8C-DEFINITION-OF-DONE)

- **Tier 0 — Prerequisites:** SPIKE (the ~30-min `claude --channels` end-to-end confirmation —
  the very first action; DONE ✅ 2026-07-06). **M9INT is NO LONGER here** — moved to
  post-channel/deferred (D11, 2026-07-06). After SPIKE, go straight to Tier 1 WAKE.
- **Tier 1 — LAUNCH GATE (reactive doorbell):** WAKE (channel stage 1, session-request wake) →
  AUTOSTART (`use_agent` auto-starts) → INBOX (`cello_check_notifications`, the push-loss
  reconciler). Live smoke closes the tier. **+ onboarding/command-surface friction riders**
  (ONBOARD-HELP/ERRORS/NEXTSTEP/WARN/LOGNOISE + F5/F18 on AUTOSTART, F4 on INBOX): the
  first-connect path is launch-critical first-impression — folded in per D5 (2026-07-06). The
  launch smoke includes a cold `create-agent → register → status` run completable from tool
  output alone. See M8C-DEFINITION-OF-DONE and [[M8C-DECISIONS]] D5.
- **Tier 2 — Full reactivity + command surface:** MSGWAKE (stage 2 per-message wake, daemon build)
  + SINCESEQ (`since_seq` on `cello_receive`) → LOGINSTART (`cello login` auto-start, opt-out) →
  CONFIG (CLI config surface on M9-CFG-001's store) → CURSOR (per-connection read cursor +
  `session_not_current` gate).
- **Tier 3 — Reachability + protection:** AWAY (answering machine, transparent/opaque) →
  CONTACT (whitelist + privacy) → ABUSE (persistence bounds: per-session total size,
  unknown-sender queue caps per-sender + global) → TTL (session-request TTL) → TGDOOR (Telegram
  Mode 1 doorbell, daemon-owned bot).
- **Tier 4 — Async foundation:** RELAYWAKE (check relay on wakeup — directory-assisted discovery,
  both repos) → LEAVEMSG (offline message receipt + surfacing).
- **Tier 5 — Multi-daemon:** PRIMARY-DESIGN (the device-linking design log — gate for the rest) →
  PRIMARY (Primary/Standby + transfer offer) → POLICY (per-daemon policies) → PORTAB (session
  portability: close → sync → re-open).

Dependencies: MSGWAKE rides WAKE's forwarding hop; TGDOOR's doorbell is decoupled from channel
stages (daemon-owned bot) but its full-monitoring level (excluded) would need MSGWAKE; CURSOR's
refusal guidance is SINCESEQ; LEAVEMSG builds on RELAYWAKE; POLICY/PORTAB sit on PRIMARY.

**Repo center of gravity: cello-client** (daemon, shim, MCP tools, CLI — publish cascade applies
to every daemon-touching unit). Exceptions: CONTACT's presence-visibility edge, RELAYWAKE, and
PRIMARY touch trustless-cello (directory).

## 5. Out of scope (M8C)

- **Telegram full-monitoring level + Mode 2** (operator as communicator, approvals gate,
  reply addressing — OQ-2/OQ-3 park with it) → follow-on milestone's opening track.
- **Non-Telegram platform relays — Slack / Discord / Webhook** (the rest of channel stage 3's
  "platform relay" from the notes; M8C ships Telegram as the one stage-3 platform, doorbell only)
  → follow-on. The daemon-owned-bot pattern (token = daemon setting, single long-lived poller,
  works cold, runtime-agnostic) extends to each; no new architecture, just another adapter.
- **Channel stage 4 — multi-peer message routing** (sender tagging on inbound, reply addressing
  back to the right peer, platform-side sender allowlists beyond the single operator allowlist
  TGDOOR needs) → follows Mode 2. Renamed 2026-07-05 from "relay hardening" — it's message
  identification and routing, not a security-hardening pass.
- **Non-Claude-Code adapters** (Hermes/OpenClaw/IronClaw) + `ipc.connect` capability negotiation
  → separate design track. Do not bake Claude-Code assumptions into the daemon meanwhile.
- **Kill switch** — launch-critical but **portal's job, tracked outside M8C.** Recorded here so it
  cannot fall between milestones (see M8C-DECISIONS).
- Three-tier contacts (favorite), shared artifacts, media caps beyond M9-IN-001's extension.

## 6. Definition of done

The journeys are GREEN in ordered tiers — daemon-level proofs on the e2e fixtures (extend
`packages/e2e-tests/src/session-fixture.ts` / the spine harness; never a from-scratch fixture),
the in-context hop proven in a **live `claude --channels` session** (the milestone-close smoke —
Vitest green ≠ done), Tier 4/5 directory pieces proven on the spine then live dev. Every story
carries observability ACs (named `domain.noun.verb` events, correlationId threading, error paths).
See [[M8C-DEFINITION-OF-DONE]].

---

## Related Documents

- [[M8C-DEFINITION-OF-DONE]] — the yardstick: every requirement, ordered, status-tagged
- [[M8C-PROCEDURE]] — the runbook: per-unit loop, severity triage, publish cascade, commit discipline
- [[M8C-BUILD-JOURNAL]] — audit trail and status board
- [[M8C-DECISIONS]] — the 2026-07-05 scope/tier decisions, OQ-1 resolution, parked OQs
- [[M8C-MILESTONE-NOTES]] — the triage worksheet this spec commits: inventory, Telegram vision, verification pass
- [[2026-07-01_1030_command-surface-and-notifications-design|Command Surface, Notifications, and Async Messaging Design]] — the planning-authoritative design substance
- [[2026-06-27_0753_claude-code-channels-cello-integration|Claude Code Channels × CELLO]] — code-level channel reference (cite symbols, not line numbers)
- [[M9-DEFINITION-OF-DONE|M9 Definition of Done]] — the security gateway DOD-M9INT-1 merges and wires (deferred to post-channel — D11, NOT a prerequisite)
