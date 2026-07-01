---
name: Command surface, notifications, and async messaging design
type: discussion
date: 2026-07-01
topics: [command-surface, notifications, daemon, UX, async-messaging, multi-client, offline, design]
status: active
description: >
  Design discussion on the CELLO command surface (login/start/use/stop/logout), notification
  delivery across different client types (Claude Code, OpenClaw, Hermes, Perplexity, Bedrock),
  and the "leave a message" feature as a foundation for async agent communication.
---

# Command Surface, Notifications, and Async Messaging Design

## The Problem

The current command surface accumulated through architectural transitions (M6→M7→M8B) rather than
being designed from the operator's perspective. The commands work, but an operator looking at them
fresh wouldn't understand why they're separate or what each one does beyond the other.

Current operator ceremony to be reachable:
1. `cello login` — starts daemon
2. `cello_start_agent({ name })` — brings agent online (network presence)
3. `cello_use_agent({ name })` — routes this session's tool calls to that agent

For a solo operator with one agent, this is three steps that could be zero.

---

## What Each Command Actually Does

| Command | Scope | What it does | Who sees the effect |
|---------|-------|-------------|-------------------|
| `cello login` | Machine-level | Starts daemon process, opens DB, connects to directory for all loaded agents | The daemon |
| `cello_start_agent` | Network-level | Tells directory "this agent is online", creates standing receiver | The entire network (counterparties can now reach you) |
| `cello_use_agent` | Connection-level | Routes THIS Claude session's tool calls to that agent | Only this Claude session |
| `cello_stop_agent` | Network-level | Destroys standing receiver, tells directory "offline" | The entire network |
| `cello logout` | Machine-level | Stops daemon, closes all connections | Everything |

**Why they're separate (the valid reason):**
- `start_agent` = network presence (shared, global, daemon-level)
- `use_agent` = tool routing (per-connection, per-Claude-session)

You might have 3 agents online but each Claude session speaks as one. The daemon holds all of them;
the MCP connection picks which one it impersonates.

**Why the separation feels wrong (the UX problem):**
- Solo operator never needs the distinction
- Multi-agent operator still needs to manually pair sessions to agents before being reachable
- There's no "always-on" at the Claude Code level — notifications only reach connections that
  have explicitly called `use_agent`

---

## Notification Routing Gap

The routing chain today:

1. Session request arrives at daemon for agent "Demo2"
2. NotificationDispatcher checks: which IPC connections have "Demo2" as `currentAgent`?
3. Only those connections receive the `session_state_changed` IPC notification
4. Only those get forwarded as `cello_session_request` to Claude Code

**If no Claude session has done `cello_use_agent("Demo2")` before the request arrives, the
notification fires nowhere.** The session request sits queued in the daemon but nothing wakes up.

Two practical problems:
- **Pre-setup requirement** — operator must have already run `start_agent` + `use_agent` in
  the right Claude session before an inbound request can reach them
- **Multi-agent ambiguity** — if operator has two agents and two Claude sessions, they need
  to manually ensure each session has the right agent set

---

## Multi-Client Reality

The system must work for:
- **Claude Code** (with `--channels` flag) — can receive MCP notifications (push)
- **Claude Code** (via AWS Bedrock) — channels do NOT work inbound; must poll
- **OpenClaw** — different notification capabilities
- **Hermes Agent** — different notification capabilities
- **Perplexity's computer** — no push at all; must poll via cron

This means:
- The daemon cannot assume push delivery works
- The MCP adapter must support BOTH push (notifications) and pull (polling)
- Some clients will only discover inbound sessions by periodically calling
  `cello_list_sessions` or a dedicated `cello_check_inbox` tool
- The "always-on receiver" is the DAEMON, not the client — the client attaches when it can

**Design constraint:** Don't build the logic entirely for Claude Code. Each client will have
different ability to be awoken by an outside event. The commonality is the daemon + the
tool surface. The difference is how/when the client calls those tools.

---

## "Leave a Message" Feature (Future Milestone)

**Use case:** I finish a task and want to hand it off. I reach out to you and say "B is done,
it's now in your hands, you need to do C and D, then return it to me." You might not be online.

For human beings this is perfectly normal. Agents should handle it the same way.

**Design implications:**

1. **Offline message receipt** — the daemon (or directory pickup queue) must accept and store
   messages for agents that aren't currently online
2. **Access control** — operators can choose:
   - Accept messages only from known contacts (existing connections)
   - Accept messages from anyone (public directory listing) with stranger flagging (WhatsApp model)
3. **Persistence** — offline messages must be stored in the DB, signed and hashed like all
   CELLO communication (no second-class messages)
4. **Notification on reconnect** — when the agent comes online, queued messages surface
5. **Async conversation model** — like email for agents. Both parties may never be online
   simultaneously. Each message is still signed, hashed, and part of a verifiable chain.

**Future extensions:**
- Shared artifacts (like Google Docs but with each party maintaining their own copy, no
  centralized version)
- Notifications for artifact updates ("I updated my side" — syncing may happen automatically
  but the notification is the human-readable signal)

---

## Agent State Model (Refined)

| State | Meaning | Who knows |
|-------|---------|-----------|
| **Registered** | Identity exists, FROST DKG complete, directory knows the agent | Directory |
| **Online** | Daemon is running, standing receiver active, reachable on the network | Directory + counterparties |
| **Attended** | A live client session (Claude/OpenClaw/etc) has claimed this agent | Daemon only (internal) |
| **Away** | Online but no client is attached — messages queue, auto-accept works, but nobody's reading | Could be visible to counterparties |

The `online` vs `attended` distinction is new. Today they're conflated. The question is whether
counterparties should know the difference (affects UX — "your message was delivered but not read"
vs "your counterparty is away, message queued").

---

## Open Design Questions

1. **Should `use_agent` absorb `start_agent`?** If you call `use_agent`, the agent should
   come online if it isn't already. The "start without using" case is rare.

2. **Should `cello login` auto-start all registered agents?** Solo operator wants zero ceremony.
   Multi-agent operator might not want all agents online simultaneously. Default: start all,
   with a config to opt specific agents out.

3. **Should notifications broadcast to all connections or only the claimed one?** If broadcast:
   every Claude session hears everything (noisy but never miss). If targeted: you must
   pre-configure which session handles which agent (current model, fragile).

4. **Polling interval for non-push clients?** Cron-based clients (Perplexity, Bedrock) need
   a recommended interval. Too frequent = wasted tokens. Too rare = poor responsiveness.
   Probably configurable, default 30-60 seconds.

5. **"Away" state — visible to counterparties?** If yes: they know their message is queued
   but not being read. If no: they just see "online" and wonder why there's no response.

6. **Offline message storage — daemon or directory?** If daemon: only works when YOUR daemon
   is running (your machine is on). If directory (pickup queue): works even when you're
   fully offline. Directory pickup queue already exists as a table (`pickup_queue`).

---

## Ramifications for Persistence

If messages can arrive while no client is attached:
- They MUST be stored in the local DB (already true — daemon writes to SQLCipher)
- They MUST be signed hashes (already true — all CELLO messages are)
- The "unread" state must be tracked so the client knows what's new when it attaches
- The daemon must be able to participate in the hash chain even without a live client
  (it already does — standing receiver handles this)

The architecture already supports this at the daemon level. The gap is surfacing it to clients.

---

## Next Steps

This is a design session, not an implementation session. The outcomes should be:
1. A decision on the command surface simplification (probably a future milestone)
2. A design for notification delivery that works across client types
3. A story for "leave a message" / async messaging (probably its own milestone)
4. The agent state model (registered/online/attended/away) formalized

None of this blocks the current E2E testing phase. It informs the NEXT milestone after M8B.

---

## Follow-up: Notification Wiring Gap (2026-07-01)

Code archaeology against the M7 MCP-001 and MCP-002 story YAML files and commit
history confirmed the following.

### Why `ipc-proxy.ts` discards notifications

The `"skip for now"` comment (ipc-proxy.ts:183) is a deliberate staged deferral,
not an AI decision or an oversight. MCP-001 explicitly scoped out `cello_message`
and `cello_session_request` in its context block:

> MCP notification channels (not tools, no IPC proxy needed):
>   cello_message, cello_session_request

MCP-002's implementation notes specified that `cello-mcp.ts` must subscribe to
daemon notifications and forward them to Claude Code — but the commit (fc4bc86)
only built the daemon side (NotificationDispatcher, IpcServer.sendNotification)
and never touched `ipc-proxy.ts` or `cello-mcp.ts`. The story boundary was
never closed on the proxy side.

### Notification wiring gaps (mechanical, bounded — cello-client only)

1. `cello-mcp.ts` missing `{ capabilities: { experimental: { "claude/channel": {} } } }` on McpServer
2. `IpcProxy.#processBuffer()` silently discards all notification frames
3. `session-node-manager` has no content-arrival callback
4. `NotificationDispatcher` has no `dispatchCelloMessage` method
5. `daemon.ts` never wires the content-arrival callback to NotificationDispatcher
6. `cello_message` notification omits `session_id` (forces unnecessary round-trip)

Gaps 1, 2, 6 are in `adapter-claude-code`. Gaps 3, 4, 5 are in `daemon`.
No `trustless-cello` changes needed.

**Gap 2 nuance:** The IpcProxy needs to forward ALL four daemon notification
types: `agent_state_changed`, `agent_current_changed`, `session_state_changed`,
and the new `cello_message`. Today all four are discarded. The existing three
also never had a forwarding path to Claude Code — they belong in the same story.

### `cello_message` vs `cello_session_request`

Both are `claude/channel` wake-ups — no content in the notification, content
pulled via `cello_receive` / `cello_await_session`. The two-step design is
intentional (security model: plaintext off the signal channel).

**`cello_message` gaps:** Daemon has no content-arrival callback at all (Gaps
3–5). This is the larger of the two gaps.

**`cello_session_request` gaps:** Daemon already emits `session_state_changed`
IPC notifications when sessions are created. Primarily a forwarding problem
(Gaps 1–2). Closer to done.

### The `--channels` flag question

Without the `--channels` flag (or equivalent), Claude Code won't process
`notifications/claude/channel` as interrupts. The Telegram plugin appears to
work without an explicit flag — likely because Claude Code auto-enables channel
interrupt behavior when any connected MCP server declares `'claude/channel': {}`
in its capabilities. Whether CELLO's capability declaration (once Gap 1 is
fixed) is sufficient, or whether `--channels` is still required, needs
verification against live Claude Code behavior.

### Standing receiver: auto-accept vs attended state (open)

Today the SR auto-accepts all inbound sessions regardless of whether any Claude
session is attached. Messages queue. Counterparty gets no signal the agent is
unattended. Options:

- **Pure async (current):** Keep it. Consistent with email/Telegram semantics.
- **Attended-aware SR:** Return "away" signal to initiator when no client is
  attached. Requires protocol change.
- **Session request hold:** SR accepts transport but holds session in
  `pending_acceptance` until a live client calls `cello_await_session`. TTL
  triggers decline if nobody accepts.

No decision. Parking for a future story. Option A requires no protocol change.

### Session lifetime vs client attachment (open)

In-memory `#receivedContent` buffer is evicted when session node tears down.
Messages that arrived while Claude was away are in the DB transcript but not
replayed into the receive buffer on IPC reconnect. Current workaround:
`cello_get_transcript`. Options for a proper fix:

- **Replay-on-attach:** When `cello_use_agent` runs and active sessions exist,
  replay unread transcript entries into receive buffer.
- **`since_seq` cursor on `cello_receive`:** Stateless, no replay race, cleanest.
- **Explicit `cello_replay_session` tool:** Operator-initiated, more burden.

Lean toward `since_seq` cursor. No decision. Parking for a future story.

### `cello login` auto-start (open)

`cello login` could auto-start all loaded agents (Registered → Online) so the
common solo-operator case becomes: login → use → session. `cello_start_agent`
retains value only for "bring a newly registered agent online without daemon
restart." Lean toward auto-start as default with opt-out config. No decision.
CLI story, no protocol change.

### Stories needed

| Area | Type | Scope |
|------|------|-------|
| Wire IPC notification forwarding + `claude/channel` capability | Implementation | cello-client only |
| `cello_message` notification includes `session_id` | Implementation | cello-client only |
| `since_seq` cursor or replay-on-attach for reconnect | Design + impl | cello-client |
| `cello login` auto-start loaded agents | Design + impl | cello-client (CLI) |
| Attended-aware standing receiver | Design + protocol | Both repos |

First two are pre-requisites for channels to work at all. Rest are quality-of-life.

---

## Design Decisions and Refined Model (2026-07-01 continued)

### Away response configuration

When an agent is away (online but no live client attached), both inbound session
requests and inbound messages need a response policy. This is an "answering
machine" problem — the operator should be able to configure what happens.

**Two distinct scenarios needing separate response templates:**

1. **Inbound session request while away.** A counterparty tries to open a
   session. Three possible outcomes exist: accepted (needs attendance), refused
   (explicit decline), or unreachable (no response at all). A fourth outcome
   is now added: "agent is away — daemon received the request but no operator
   is currently attached."

2. **Inbound message on an existing session while away.** Message arrives,
   gets stored. Counterparty may be waiting for a reply.

**Default behavior:**
- Session requests: daemon acknowledges receipt, signals agent is away. The
  counterparty knows: (a) the daemon is alive, (b) the agent exists, (c) it's
  away right now. The request is queued and will be visible when the operator
  reconnects.
- Messages: same — acknowledge receipt, signal away status.

**Configurable away message:** Operators should be able to set a custom away
response string. Generic default: "Agent is currently away. Your request has
been received and queued." Custom example: "Thank you for contacting Agent X.
This session is currently unattended. Your message has been recorded."

**Privacy option:** High-privacy mode — daemon behaves as if unreachable (no
response). From the counterparty's perspective this is indistinguishable from
a network failure. This hides the fact that the daemon received the request.
Consistent with the CELLO privacy ethos but the default should be transparent
(acknowledge + away signal), not silent.

**Key insight:** There are exactly two distinguishable states from a
counterparty's perspective:
- *Unreachable*: no response from the daemon (network failure or privacy mode)
- *Away*: bona fide daemon response saying the agent is not currently attended

These map to two different operator trust levels. Default is "away" (transparent).
Privacy mode is "unreachable" (opaque).

---

### Decisions on open design questions

**Q1: Should `use_agent` absorb `start_agent`?**
**Decision: Yes.** `cello_use_agent` auto-starts the agent if it isn't already
online. The explicit `cello_start_agent` call remains available for the
"bring a newly registered agent online without setting it as current" case, but
it is no longer required in the common flow.

**Q2: Should `cello login` auto-start all registered agents?**
**Decision: Yes, with opt-out.** Solo operator common case becomes: login →
use_agent → session. Opt-out is a per-agent config field (`autoStart: false`)
for operators who want explicit control over which agents consume directory
resources.

**Q3: Notification broadcast vs targeted.**
**Decision: Always targeted.** Notifications only reach IPC connections where
the affected agent is set as current via `cello_use_agent`. No auto-broadcast.

However: a **CLI query command** should exist for checking outstanding
notifications across all agents without needing to use_agent each one. Intent:
"I'm in a session working as Agent-1 and I want to know if Agent-2 has any
pending session requests or messages." This is an initiated pull, not a push.
The daemon has all the state; the CLI surfaces it on demand.

**Q4: Polling interval for non-push clients.**
**Decision: Not our scope.** Clients use loop/cron commands at their own
cadence. We can document recommendations (2-3 min if anxious, 10-30 min for
background work) but this is an operator choice, like checking WhatsApp. As
long as the tool surface makes it easy to check, the interval is up to the
operator.

**Q5: Away state — visible to counterparties?**
**Decision: Visible by default, configurable.** Default: daemon signals "agent
is away" (transparent). Privacy option: daemon goes silent ("unreachable").
Rationale: there are only two honest choices when a session request can't be
accepted — refuse it or claim you weren't reachable. The default should be
the honest one. The privacy mode exists for operators who want it, and is
consistent with the CELLO ethos, but it shouldn't be the default.

**Q6: Offline message storage — daemon or directory?**
**Decision: Daemon-local is preferred. Relay as temporary hold. Directory
does not store messages.**

Preferred delivery model:
- Message delivered to daemon → done. Stored in local SQLCipher DB.
- Directory never stores message content.
- Relay may temporarily hold undelivered frames (already exists — relay WAL
  and pickup queue).

For the "agent was fully offline (daemon not running)" case: on reconnect, the
daemon contacts the directory, and the directory signals whether any relay nodes
are holding undelivered frames for this agent. The daemon then pulls from the
relay. This is a "check relay on wakeup" pattern — not directory storage, but
directory-assisted discovery of what the relay is holding.

This maps cleanly to existing infrastructure: `pickup_queue` table in the
directory already handles the relay-side queuing. The missing piece is the
"on reconnect, ask directory if relay has anything for me" step.

---

### Refined agent state model

| State | Meaning | Visible to counterparties |
|-------|---------|--------------------------|
| **Registered** | Identity known to directory, FROST DKG complete | Yes (directory listing) |
| **Online** | Daemon running, standing receiver active, reachable | Yes |
| **Attended** | Online + live client session has claimed via `use_agent` | No (daemon-internal) |
| **Away** | Online but no client attached — daemon responds, queues | Yes (configurable) |

The `away` response behavior (transparent vs opaque) is an operator preference,
not a protocol state. The protocol state is always one of the four above. The
response policy is configuration layered on top of the `away` state.

---

### Stories needed (updated)

| Area | Type | Scope |
|------|------|-------|
| Wire IPC notification forwarding + `claude/channel` capability | Implementation | cello-client only |
| `cello_message` notification includes `session_id` | Implementation | cello-client only |
| `use_agent` auto-starts agent if not online | Implementation | cello-client (CLI + daemon) |
| `cello login` auto-starts all loaded agents (with opt-out config) | Implementation | cello-client (CLI) |
| CLI query for pending notifications across all agents | Implementation | cello-client (CLI) |
| Away response configuration (session request + message templates, privacy mode) | Design + impl | cello-client + protocol |
| `since_seq` cursor on `cello_receive` for reconnect | Design + impl | cello-client |
| "Check relay on wakeup" — directory-assisted relay discovery | Design + impl | Both repos |

First two are pre-requisites for channels to work at all. `use_agent` auto-start
and `login` auto-start are quick wins that reduce operator friction. The rest
are quality-of-life and async messaging foundations.
