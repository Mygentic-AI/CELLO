---
name: Command surface, notifications, and async messaging design
type: discussion
date: 2026-07-01
topics: [command-surface, notifications, daemon, UX, async-messaging, multi-client, offline, design]
status: active
description: >
  Design discussion on the CELLO command surface (login/start/use/stop/logout), notification
  delivery across different client types (Claude Code, OpenClaw, Hermes, Perplexity, Bedrock),
  the away response model, agent state model, and the "leave a message" foundation for async
  agent communication. All six open design questions resolved.
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

## Notification Wiring Gap

The routing chain today:

1. Session request arrives at daemon for agent "Demo2"
2. NotificationDispatcher checks: which IPC connections have "Demo2" as `currentAgent`?
3. Only those connections receive the `session_state_changed` IPC notification
4. Only those get forwarded as `cello_session_request` to Claude Code

**If no Claude session has done `cello_use_agent("Demo2")` before the request arrives, the
notification fires nowhere.** The session request sits queued in the daemon but nothing wakes up.

Code archaeology (2026-07-01) confirmed the `"skip for now"` in `ipc-proxy.ts:183` is a
deliberate staged deferral from M7 MCP-001/MCP-002 — not an oversight. MCP-001 explicitly
scoped out `cello_message` and `cello_session_request`. MCP-002 built the daemon side
(NotificationDispatcher, IpcServer.sendNotification) but never touched `ipc-proxy.ts` or
`cello-mcp.ts`. Six mechanical gaps remain, all in `cello-client`:

1. `cello-mcp.ts` missing `{ capabilities: { experimental: { "claude/channel": {} } } }` on McpServer
2. `IpcProxy.#processBuffer()` silently discards all notification frames
3. `session-node-manager` has no content-arrival callback
4. `NotificationDispatcher` has no `dispatchCelloMessage` method
5. `daemon.ts` never wires the content-arrival callback to NotificationDispatcher
6. `cello_message` notification omits `session_id` (forces unnecessary round-trip)

Gaps 1, 2, 6 are in `adapter-claude-code`. Gaps 3, 4, 5 are in `daemon`. No `trustless-cello`
changes needed. Gap 2 must also forward the three existing daemon notification types
(`agent_state_changed`, `agent_current_changed`, `session_state_changed`) — all four are
currently discarded together.

### `--channels` flag question

Without `--channels` (or equivalent), Claude Code won't process `notifications/claude/channel`
as interrupts. The Telegram plugin works without an explicit flag — likely because Claude Code
auto-enables channel behavior when any connected MCP server declares `'claude/channel': {}` in
capabilities. Whether CELLO's capability declaration (once Gap 1 is fixed) is sufficient needs
verification against live Claude Code behavior.

---

## Multi-Client Reality

The system must work across clients with different push capabilities:
- **Claude Code** (with `--channels`) — push notifications work
- **Claude Code** (via AWS Bedrock) — channels do NOT work inbound; must poll
- **OpenClaw, Hermes, others** — varying notification capabilities
- **Cron-based clients** — no push at all; poll on a schedule

**Design constraint:** The daemon is the always-on receiver. Clients attach when they can.
The tool surface must support both push (notifications) and pull (polling). Don't build
the logic entirely for Claude Code.

**Polling interval:** Not our scope to prescribe. Operators set their own cadence via
loop/cron commands. We can recommend (2–3 min if actively waiting, 10–30 min for
background work) but the choice belongs to the operator — the same way a human decides
how often to check WhatsApp.

---

## Agent State Model

| State | Meaning | Visible to counterparties |
|-------|---------|--------------------------|
| **Registered** | Identity known to directory, FROST DKG complete | Yes (directory listing) |
| **Online** | Daemon running, standing receiver active, reachable | Yes |
| **Attended** | Online + live client session claimed via `use_agent` | No (daemon-internal) |
| **Away** | Online but no client attached — daemon responds, queues | Yes (configurable, see below) |

The `online` vs `attended` distinction is new — today they're conflated. The `away` response
behavior (transparent vs opaque) is an operator preference layered on top of the protocol
state, not a protocol state itself.

---

## Away Response Configuration

When an agent is away, both inbound session requests and inbound messages need a response
policy. This is an "answering machine" problem. Two distinct scenarios:

1. **Inbound session request while away.** Three outcomes exist today: accepted (needs
   attendance), refused (explicit decline), or unreachable (no response). A fourth is added:
   *"agent is away — daemon received the request but no operator is attached."* The request
   is queued and visible when the operator reconnects.

2. **Inbound message on an existing session while away.** Message arrives, gets stored.
   Daemon acknowledges receipt and signals away status to the sender.

**Default (transparent):** Daemon acknowledges receipt, signals agent is away. Counterparty
knows: (a) daemon is alive, (b) agent exists, (c) it's away. Generic default text:
*"Agent is currently away. Your request has been received and queued."*

**Configurable away message:** Operators can set custom response strings per agent. Session
request responses and message responses are configured separately — the right thing to say
differs between them.

**Privacy option (opaque):** Daemon behaves as if unreachable — no response. From the
counterparty's perspective this is indistinguishable from a network failure. Consistent
with the CELLO privacy ethos but should not be the default.

**Key insight:** There are exactly two distinguishable states from a counterparty's
perspective — *unreachable* (no response) and *away* (bona fide daemon response). Default
is away (transparent). Privacy mode is unreachable (opaque).

---

## "Leave a Message" Feature (Future Milestone)

**Use case:** An agent finishes a task and hands off to another. The recipient may not be
online. For humans this is normal. Agents should handle it the same way.

**Design implications:**
1. **Offline message receipt** — daemon accepts and stores messages for agents not currently online
2. **Access control** — accept only from known contacts, or from anyone with stranger flagging
3. **Persistence** — offline messages stored in DB, signed and hashed like all CELLO messages
4. **Notification on reconnect** — queued messages surface when the agent comes back online
5. **Async conversation model** — like email for agents; both parties may never be simultaneously online

**Offline storage model (decided):** Daemon-local is preferred. Directory never stores message
content. Relay temporarily holds undelivered frames (relay WAL + pickup_queue already exist).
For the "daemon was fully offline" case: on reconnect, daemon contacts directory, which signals
whether any relay nodes are holding undelivered frames. Daemon pulls from relay. This is a
"check relay on wakeup" pattern — directory-assisted discovery, not directory storage. The
`pickup_queue` table already exists; the missing piece is the "ask on reconnect" step in
the daemon.

**Future extensions:**
- Shared artifacts (each party maintains their own copy, no centralized version)
- Artifact update notifications

---

## Persistence and Reconnect

If messages can arrive while no client is attached:
- They MUST be stored in the local DB (already true — daemon writes to SQLCipher)
- They MUST be signed hashes (already true — all CELLO messages are)
- The "unread" state must be tracked so the client knows what's new when it attaches
- The daemon participates in the hash chain even without a live client (standing receiver
  already handles this)

**Session lifetime vs client attachment gap:** In-memory `#receivedContent` buffer is evicted
when the session node tears down. Messages that arrived while Claude was away are in the DB
transcript but not replayed into the receive buffer on IPC reconnect. Current workaround:
`cello_get_transcript`. The right fix is a `since_seq` cursor parameter on `cello_receive` —
stateless, no replay race, works for any gap size. Parking for a future story.

---

## Design Questions — Decided

**Q1: Should `use_agent` absorb `start_agent`?**
**Yes.** `cello_use_agent` auto-starts the agent if it isn't already online. `cello_start_agent`
remains available for "bring a newly registered agent online without setting it as current," but
is no longer required in the common flow.

**Q2: Should `cello login` auto-start all registered agents?**
**Yes, with opt-out.** Solo operator common case becomes: login → use_agent → session.
Opt-out is a per-agent config field (`autoStart: false`) for operators who want explicit
control over which agents consume directory resources.

**Q3: Should notifications broadcast to all connections or only the claimed one?**
**Always targeted.** Notifications only reach IPC connections where the affected agent is set
as current via `cello_use_agent`. No auto-broadcast.

However, a **`cello_check_notifications` MCP tool** should exist for polling outstanding
notifications on demand:

```
cello_check_notifications({ scope: "current" | "all" })
```

- `scope: "current"` (default) — returns pending session requests and unread messages for
  the agent currently set on this connection. Safe default; works without knowing the
  daemon's full agent roster.
- `scope: "all"` — returns the same across every agent the daemon has loaded, labelled
  by agent name. Intended use: "I'm in a session as Agent-1 and want to know if Agent-2
  has anything waiting before I switch."

This is an initiated pull, not a push. The daemon has all the state; the tool surfaces it
on demand. An agent running on a non-push client (Bedrock, cron-based) uses this as its
primary "check inbox" mechanism. A push-capable client can call it on reconnect to catch
anything that arrived while it was away.

**Q4: Polling interval for non-push clients?**
**Not our scope.** Operators set cadence via loop/cron. We can document recommendations
but the choice is theirs.

**Q5: "Away" state — visible to counterparties?**
**Visible by default, configurable.** Default: daemon signals "agent is away" (transparent).
Privacy option: daemon goes silent ("unreachable"). There are only two honest choices when a
session request can't be accepted — refuse it or claim you weren't reachable. The default
should be the honest one.

**Q6: Offline message storage — daemon or directory?**
**Daemon-local preferred. Relay as temporary hold. Directory does not store messages.**
See "Leave a Message" section above for the full model.

---

## State Matrix — Full Coverage

All daemon/agent/session state combinations and their handling:

| Daemon | Agent state | Event | Handling |
|--------|-------------|-------|----------|
| Not running | — | Session request / message | Relay holds frames; daemon discovers on reconnect via directory-assisted relay check ("check relay on wakeup") |
| Running | Registered, not started | Session request / message | Directory has no active connection for this agent — behaves as away (transparent default, opaque if privacy mode set) |
| Running | Away (online, no client) | Inbound session request | Away response sent (configurable message); request queued |
| Running | Away (online, no client) | Inbound message | Away response sent; message stored in DB |
| Running | Attended | Inbound session request | Push notification (`cello_session_request`) to the attending client |
| Running | Attended | Inbound message | Push notification (`cello_message`) to the attending client |
| Any | Interrupted session (daemon was killed mid-session) | Counterparty's unilateral seal arrives | UPGRADE-001 auto-upgrades to bilateral on reconnect — no operator decision needed |

The interrupted session case is fully implemented (UPGRADE-001, `seal-upgrade.ts`). When B
returns, the daemon automatically recovers content hashes, verifies the chain, signs the
ack leaf, and the directory promotes the unilateral seal to bilateral. No operator action
required.

The "registered but not started" row becomes a narrow edge case once login auto-start
lands — it only applies to operators who opted out of auto-start, or who registered a new
agent mid-session without starting it. The directory has no active signaling connection for
the agent, so the away signal must originate from the directory itself rather than the
daemon.

---

## Contact Model and Privacy

**One operator per daemon.** A single human operator owns each daemon. One operator can
run multiple daemons (different machines) but each daemon is exclusively theirs. There is
no multi-operator daemon — the reputation and trust signals aggregate at the human level
through the Account layer.

**Contact whitelist — binary, operator-controlled:**
- Anyone who knows an agent's address can attempt to contact it — no directory gatekeeping
  on inbound attempts
- Each agent maintains a binary whitelist: known (auto-accept) vs unknown
- Future extension: three tiers (unknown / whitelisted / favorite) — not in scope now

**What strangers learn — configurable, defaults to opaque:**
- If sender is not on the recipient's whitelist, what they learn about their message is
  controlled by the recipient's privacy settings
- **Default:** sender learns only "dispatched" — no confirmation of receipt, no read
  receipts, no away signal
- **Public mode:** sender gets receipt confirmation — appropriate for public-facing agents
  (businesses, open services)
- Spam handling: unknown senders can be silently ignored — the recipient agent never
  has to engage

**Presence visibility — same whitelist boundary:**
- Whitelisted contacts can see online/away status
- Unknown agents cannot — they see only "reachable or not" from their own attempt
- This ensures the away/opaque privacy setting is coherent: if you're in privacy mode,
  unknown contacts can't learn you received their message AND can't see your presence

**Interaction with away response:**
- Transparent away (default): whitelisted contacts get the away signal; unknown senders
  get nothing (default opaque)
- Public mode: even unknown senders get receipt confirmation
- Privacy mode: everyone gets silence, regardless of whitelist status

---

## Stories Needed

| Area | Type | Scope |
|------|------|-------|
| Wire IPC notification forwarding + `claude/channel` capability (6 gaps) | Implementation | cello-client only |
| `cello_message` notification includes `session_id` | Implementation | cello-client only |
| `use_agent` auto-starts agent if not online | Implementation | cello-client (daemon + CLI) |
| `cello login` auto-starts all loaded agents (with opt-out config) | Implementation | cello-client (CLI) |
| `cello_check_notifications({ scope })` MCP tool (default: current agent, opt-in: all) | Implementation | cello-client (daemon + adapter) |
| Away response configuration (per-type templates, privacy mode) | Design + impl | cello-client + protocol |
| Contact whitelist (binary known/unknown, per-agent privacy settings, presence visibility) | Design + impl | cello-client + directory |
| `since_seq` cursor on `cello_receive` for reconnect | Design + impl | cello-client |
| "Check relay on wakeup" — directory-assisted relay discovery | Design + impl | Both repos |

First two are pre-requisites for channels to work at all. `use_agent` auto-start and `login`
auto-start are quick wins. The rest are quality-of-life and async messaging foundations.
