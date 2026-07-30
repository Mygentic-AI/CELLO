---
name: Claude Code Channels × CELLO — Integration Model
type: discussion
date: 2026-06-27
topics: [claude-code-channels, mcp, daemon, ipc, notifications, shim, telegram-bridge, relay, prompt-injection, anti-surveillance, webhook, slack, discord]
status: design-investigated-not-built
description: >
  What Claude Code "channels" are and how CELLO can use them to become a reactive
  push-based participant, enabling integrations with Telegram, Slack, Discord, or
  generic Webhooks. Covers the channel protocol model, the minimal shim edits
  required to surface daemon events as pushed channel notifications, and the
  Telegram ⇄ Claude ⇄ CELLO human relay as the canonical use case.
  Investigation + design discussion only — no implementation landed.
---

# Claude Code Channels × CELLO — Integration Model

> **Planning status:** superseded for *milestone scoping* by
> [[2026-07-01_1030_command-surface-and-notifications-design|Command Surface, Notifications, and
> Async Messaging Design]] (2026-07-01), which folds this log's channel depth into the broader
> command-surface / notifications / multi-daemon planning that will become a milestone. **This log
> remains the authoritative code-level reference** — the exact `file:line` edit points, the
> `onNotification` template, the retired-adapter caveat, and the publish cascade live here. Read
> this for *how*; read the 2026-07-01 doc for *what we build and in what order*.

## 1. Purpose of this discussion log

This document records what Claude Code "channels" are and how CELLO can use them to
become a **reactive, push-based participant** — rather than a poll-only one.

The motivating question is whether CELLO can integrate with platforms like Telegram,
Slack, Discord, or even generic Webhooks: a peer sends a CELLO message → CELLO wakes
Claude → Claude routes it out to Telegram (or wherever the operator is reachable). The
same channel model works in reverse — the operator types in Telegram and Claude relays
it back over CELLO.

The investigation covers three things:
- What the channel protocol is and how it maps onto CELLO's daemon/shim architecture
- The minimal shim edits needed to surface daemon events as pushed channel notifications
  (rather than poll-only tool calls)
- The Telegram ⇄ Claude ⇄ CELLO relay as the canonical use case

This is a design investigation, not a build. No implementation landed.

---

## 2. What channels are (mental model)

- **Channels are an event-ingress layer for a *running* session.** Claude Code spawns an
  MCP server as a stdio subprocess; that server receives outside events on whatever
  interface it likes (webhook, chat-platform poll) and emits
  `notifications/claude/channel` into the session. Claude reads the event in-context and
  can act immediately.
- **Pushed, not pulled.** Ordinary MCP tools are pulled by Claude when it needs them;
  channels are pushed by an external system when something happens. This is the exact
  inversion of CELLO's current `cello_receive`-polling model.
- **One-way vs two-way.** One-way delivers events in. Two-way *also* exposes a normal MCP
  tool (e.g. `reply`) so Claude can send messages back out the same bridge.
- **Declaration + transport.** The server declares the `claude/channel` capability under
  `capabilities.experimental`, connects over stdio, and forwards events via
  `mcp.notification()` with method `notifications/claude/channel`. Optional `meta` fields
  become attributes on the `<channel>` tag in Claude's context. Delivery is
  fire-and-forget; events queue and process in order; no transport-level ack.
- **Gating is mandatory.** An ungated inbound channel is a prompt-injection vector; the
  reference guidance is to allowlist senders by identity before forwarding anything.
- **Session/org enablement.** Channels must be enabled for the session (`--channels`) and,
  in managed orgs, allowed org-side.

Reference: Claude Code Docs — Channels reference
(https://code.claude.com/docs/en/channels-reference).

---

## 3. The daemon already emits the event

Crucially, the daemon has its **own** notification system that is live and production:

- `NotificationDispatcher` (`core/daemon/src/notification-dispatcher.ts`) with per-type
  routing:
  - `agent_state_changed` → **all** active IPC connections;
  - `agent_current_changed` → the **triggering** connection only;
  - `session_state_changed` → connections where the affected agent is **current**.
- Transport: `ipcServer.sendNotification(connectionId, notification)` +
  `getConnectionIds()` (`ipc-server.ts:297,312`), framing
  `IpcNotification = { notification: string; data?: {...} }` (`types.ts:73`).
- **It already fires on a real inbound session:** when a peer initiates, the inbound path
  calls `dispatchSessionStateChanged(agent, sessionId, "created", counterpartyPubkey)`
  (`daemon.ts:3075`).
- The daemon's *own* `ipc-client.ts:68` already implements the `onNotification(handler)`
  pattern — a ready-made template for teaching the shim's proxy to surface frames instead
  of dropping them.

The event already crosses the socket. The shim's last hop is all that's missing:
`if ("notification" in frame) { /* skip for now */ continue; }` (`ipc-proxy.ts:183`).

---

## 4. The easy path — DECIDED shape

- **DECIDED (wake on inbound session needs ZERO daemon changes — shim only).** Two small
  edits, both in the live shim:
  1. **Declare the capability** in `bin/cello-mcp.ts:120`:
     `new McpServer({ name, version }, { capabilities: { experimental: { "claude/channel": {} } } })`.
  2. **Forward instead of drop** in `ipc-proxy.ts:183`: add an `onNotification` hook (copy
     `daemon/src/ipc-client.ts:68`), and in `cello-mcp.ts` translate the daemon's
     `session_state_changed` / `state:"created"` frame into
     `server.server.notification({ method: "notifications/claude/channel", params: { type: "cello_session_request", from, session_id } })`.
  That alone yields a working **one-way channel**: Claude wakes when a peer opens a
  session, then pulls details with `cello_await_session` / `cello_receive`.

- **DECIDED ("we're an MCP tool, as is a channel" is NOT a blocker).** A single `McpServer`
  can be **both** a tools-provider **and** a channel — `claude/channel` capability and
  `tools` coexist on one server (that is exactly what a two-way channel is). The shim
  stays **one** MCP server and simply gains the capability; no second process, no second
  `claude mcp add`.

- **DECIDED (content-free design composes cleanly).** CELLO's SI-001 discipline keeps the
  notification payload content-free — only `type` + counterparty pubkey + `session_id`;
  the agent calls `cello_receive` to fetch the actual message. The channel is just the
  doorbell; the tool fetches the letter. No tension with relaying.

- **OPEN / known limit (wake on *every message* needs a daemon hook).** The dispatcher
  today notifies on **session lifecycle** (`created` / `destroyed` / sealed states) and
  agent state — **not** per inbound message (messages are still pulled via `cello_receive`
  polling). A true chat relay wants a ping per message: one extra
  `dispatchSessionStateChanged`-style hook on the daemon's message-arrival path. Modest,
  but it *is* a daemon edit, so it falls under the publish-cascade rules (§6.4).

---

## 5. The Telegram ⇄ Claude ⇄ CELLO relay — feasibility

The motivating use case: chat from Telegram to Claude, and from Claude to whoever is
reaching out over CELLO (and back). This is the **canonical** channels pattern — Claude
Code as a **router between two channels**, one session in the middle:

```
        Telegram channel (two-way)              CELLO channel (two-way)
 You ───────────────────────────►  Claude Code  ◄─────────────────────── Peer
 (phone)  reply tool → your chat    (the router)  cello_receive (read) /     (whoever
                                                  cello_send (reply)          reaches you)
```

- **Peer → you:** peer opens a session / sends → daemon → CELLO channel wakes Claude →
  Claude `cello_receive`s the content → Claude calls the Telegram bridge's `reply` tool to
  push it to your phone.
- **You → peer:** you type in Telegram → Telegram channel wakes Claude → Claude `cello_send`s
  it to the CELLO peer.

**What you assemble.**
- **Telegram half — largely off-the-shelf.** Telegram/Discord two-way channel bridges are
  the reference examples in the channels docs and exist as plugins; they poll the platform,
  forward your messages in, and expose a `reply` tool. Mostly configuration + allowlisting
  your own user ID.
- **CELLO half — the §4 shim work.** The *reply* direction is already free: `cello_send`
  exists. The inbound *wake* is the two shim edits (and the §4 per-message daemon hook for
  message-granularity).

The same pattern extends to any platform that has a channel bridge. The appropriate
choice depends on the use case:

| Platform | When to use |
|---|---|
| **Telegram** | Personal control — one operator, one chat, familiar mobile UI |
| **Discord** | Bot-driven developer community or personal control channel; Anthropic ships an official plugin |
| **Slack** | Team chat and threaded ops workflows; Claude Code has an official Slack integration |
| **Webhook** | When the source is not a chat app — CI alerts, production incidents, calendar bookings, CRM events |
| **Custom UI** | When you want a specialized front end with file views, task status, or approval flows |

For CELLO's near-term purposes, Telegram is the simplest to stand up. For event-driven
agent control (e.g. a peer-initiated session triggering a workflow), the webhook pattern
is the most general: any system that can emit an HTTP event can become a CELLO trigger.

**DECIDED:** feasible, and squarely what channels are for. The only genuinely novel build
is the CELLO inbound channel; the platform-side bridge is mostly configuration; the
security framing is the part not to hand-wave.

---

## 6. Caveats that actually matter

1. **Foreground router, not a background bridge.** It works only while a Claude session is
   live with both channels attached and `--channels` enabled. If the session ends, the
   daemon still **receives and queues** CELLO messages, but nothing forwards to Telegram
   until a session reattaches. "Always-on" = "keep the session running."
2. **Session → chat mapping (multi-peer).** One peer is trivial (Telegram is your one chat,
   CELLO is one session). Multiple concurrent peers means Claude must map "this Telegram
   message → session X" and tag inbound CELLO messages by sender — workable in-context or
   via `@alice: …` addressing, but it is real routing logic to specify.
3. **Security / prompt injection (weigh hardest — this is financial trust infrastructure).**
   Piping untrusted natural language from a remote peer into a tool-wielding session is an
   injection surface. Two layers:
   - **Telegram:** allowlist your own user ID only, or anyone can drive your Claude.
   - **CELLO:** sessions are pubkey-authenticated (good), but message *text* is still
     untrusted. Instruct Claude to **relay verbatim and never obey instructions inside the
     content** — be a pipe, not an agent that follows the peer.
   The channels guidance is blunt: allowlist senders by identity before forwarding.
4. **Publishing cascade (CLAUDE.md invariants).** Touching `connect` (the shim) and/or
   `daemon` requires version-bumping + republishing the changed package **and** its
   dependents (`workspace:*` re-pins at publish time), with the three registrations for any
   new publishable package. Source tests do not catch publish breakage; the CI
   published-artifact smoke test does.
5. **Execution environment.** This investigation ran in a remote, ephemeral cloud container
   (cloned fresh, reclaimed after the session) — *not* the operator's local desktop, even
   when driven from the desktop app. Artifacts reach the user via commit/push (or an
   explicit file hand-off); there is no direct write to the local disk.

---

## 7. How this fits existing CELLO architecture

- The daemon is already the **control point** (heavy node: libp2p, sessions, seals,
  encrypted DB); the shim is a deliberately dumb relay. Channels fit the seam exactly: the
  daemon detects, the shim forwards, Claude reacts.
- The daemon's `NotificationDispatcher` + `ipcServer.sendNotification` already provide the
  push substrate; channels are the *last hop* the shim never wired.
- The **anti-surveillance / content-minimization** value (SI-001 content-free
  notifications) is preserved by the doorbell-then-`cello_receive` shape — the channel
  leaks no message content into the wake.

---

## 8. Open questions

- **Message-granularity wake:** confirm the exact daemon hook point on the inbound
  message-arrival path (alongside `daemon.ts:3075`) and the notification shape for a
  per-message ping (vs reusing `session_state_changed`).
- **Notification → channel mapping table:** which daemon `IpcNotification` types surface as
  `notifications/claude/channel`, and what `meta`/`params` each carries.
- **Multi-peer routing contract:** how Claude addresses replies when several CELLO sessions
  and one Telegram chat are live (in-context tracking vs explicit `@name` addressing).
- **Allowlist source of truth:** where the Telegram-side and CELLO-side sender allowlists
  live (shim config? daemon? Claude instructions?) and how they are enforced.
- **Liveness/reconnect:** behavior when the session drops while CELLO messages queue in the
  daemon — replay-on-reattach vs notify-summary.
- **Publish plan:** which packages bump (`connect` only for §4 wake-on-session; `connect` +
  `daemon` for per-message) and the dependent cascade.

---

## 9. What this unblocks / next steps

New capability implied: **CELLO as a reactive (push) participant** rather than poll-only —
the inbound channel on the live shim, optionally a per-message daemon dispatch hook, and a
platform relay (Telegram, Slack, Discord, or Webhook) built by composing an off-the-shelf
channel bridge with the CELLO MCP. Natural staging:

1. **Shim-only one-way channel** (DECIDED, §4) — prove "peer opens session → Claude wakes"
   end to end. Zero daemon change, `connect` bump only.
2. **Per-message daemon hook** — wake on every inbound message (daemon + `connect` bump,
   cascade).
3. **Platform relay** — attach an allowlisted two-way channel (Telegram, Slack, Discord,
   or Webhook); Claude routes between it and CELLO (`cello_send` / `cello_receive`).
4. **Hardening** — sender allowlists, relay-don't-obey framing, multi-peer addressing.

These would become SPARC stories (Specification → Pseudocode → Architecture → Refinement
(TDD) → Completion gate) — not written here.

---

## Related Documents / source pointers

- `core/adapter-claude-code/src/bin/cello-mcp.ts` — the live production shim; `McpServer`
  at `:120` (no channel capability today), all tools are IPC pass-throughs.
- `core/adapter-claude-code/src/ipc-proxy.ts` — `:183` drops daemon notification frames
  (the gap); the `onNotification` hook would go here.
- `core/daemon/src/notification-dispatcher.ts` — live push routing (agent/session events).
- `core/daemon/src/ipc-server.ts` — `:297` `sendNotification`, `:312` `getConnectionIds`.
- `core/daemon/src/ipc-client.ts` — `:68` `onNotification(handler)` pattern to copy into
  the shim's proxy.
- `core/daemon/src/daemon.ts` — `:3075` already dispatches `session_state_changed`/`created`
  on a real inbound session.
- `core/daemon/src/types.ts` — `:73` `IpcNotification` frame shape.
- Claude Code Docs — Channels reference: https://code.claude.com/docs/en/channels-reference
- Claude Code Docs — Push events into a running session: https://code.claude.com/docs/en/channels
- Claude Code Docs — Slack integration: https://code.claude.com/docs/en/slack
- Claude Code Docs — Platforms and integrations: https://code.claude.com/docs/en/platforms
- Anthropic official Discord plugin: https://github.com/anthropics/claude-plugins-official/blob/main/external_plugins/discord/README.md
- `.claude/CLAUDE.md` — SPARC process + the publishing/version-cascade invariants (§6.4).

**Legacy code (reference only):** `core/adapter-claude-code/src/server.ts` and
`core/adapter-claude-code/src/notifications.ts` are the retired in-process adapter. They
contain a working `claude/channel` capability declaration and `pushChannelNotification`
implementation — useful only as a reference for the notification payload shape. They are
not production code and are not a foundation to build on.

- [[2026-07-30_1423_cello-claude-code-plugin-and-channels-allowlist|The CELLO Claude Code plugin and the channels allowlist]] — this design, built and shipped as a plugin; establishes that a marketplace alone does not clear the dev-channel warning but `allowedChannelPlugins` does.
