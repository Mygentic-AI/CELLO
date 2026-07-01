---
name: Command surface, notifications, and async messaging design
type: discussion
date: 2026-07-01
topics: [command-surface, notifications, daemon, UX, async-messaging, multi-client, offline, design]
status: active
description: >
  Design discussion on the CELLO command surface (login/start/use/stop/logout), notification
  delivery across different client types (Claude Code, OpenClaw, Hermes, Perplexity, Bedrock),
  the away response model, agent state model, contact/privacy model, the primary/standby
  multi-daemon model, abuse controls, the configuration surface, and the "leave a message"
  foundation for async agent communication. All six original design questions plus a ten-item
  design-review gap list resolved.
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
| **Registered** | Identity known to directory, FROST DKG complete; not connected from this daemon | Yes (directory listing) |
| **Standby** | Daemon connected, signaling stream active, ready to receive a primary transfer offer — but NOT primary for this agent (no standing receiver, no FROST) | No |
| **Primary** | The one daemon that owns this agent on the network: standing receiver active, FROST-capable, owns inbound sessions | Yes |
| **Attended** | Primary + a live client session has claimed the agent via `use_agent` | No (daemon-internal) |
| **Away** | Primary but no client attached — daemon responds, queues | Yes (configurable, see below) |

Two orthogonal distinctions live in this table:

- **Primary vs Standby** — a *cross-daemon* distinction. When the same agent is loaded on more
  than one daemon (see "Multi-Daemon and the Primary/Standby Model" below), exactly one is
  Primary. On a single-daemon setup — the common case — the agent is simply Primary whenever
  it's started, and Standby never appears.
- **Attended vs Away** — a *within-daemon* distinction on the Primary. Attended means a live
  client is driving it; Away means nobody is. The `away` response behavior (transparent vs
  opaque) is an operator preference layered on top, not a protocol state itself.

"Online" from earlier drafts is now "Primary" — the term was ambiguous once multi-daemon
entered the picture.

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

## Multi-Agent Within a Single Session

In M6, a single Claude session could operate as multiple agents — call `cello_receive` for
agent B, then `cello_receive` for agent C, within the same session. This capability is
preserved in M7 but the mechanism is now explicit.

**M7 constraint:** `cello_use_agent` sets one current agent per IPC connection at a time.
All tool calls route through whichever agent is current. To work as a different agent, you
switch first.

**Pattern:**
1. `cello_check_notifications({ scope: "all" })` — one call, see which agents have pending items
2. `cello_use_agent("B")` → handle B's session
3. `cello_use_agent("C")` → handle C's session

With `use_agent` auto-start, step 2 and 3 also bring the agent online if it isn't already —
no separate `cello_start_agent` call needed.

**What you can't do** that M6 technically allowed: two concurrent blocking `cello_receive`
polls for different agents at the same instant. In practice this was never useful — a Claude
session is single-threaded. The sequential switch model matches how the agent loop actually
works: check what's pending, switch to the right agent, handle it, move on.

### Two client sessions, same agent, same CELLO session (the group-chat model)

A subtler case: two IPC connections both `use_agent("A")`, and a message arrives on one of
A's active CELLO sessions. Connection B is idle, sees it first, and replies. Connection A —
which handled the earlier rounds — was busy and never saw the new message. If both connections
can send blind, the counterparty (who sees a single coherent identity) gets an incoherent,
out-of-order conversation: each connection holds only part of the context.

**The mental model is a WhatsApp group chat where both participants share one identity** — or
more precisely: you on your phone, and a colleague sitting at your laptop typing into your
WhatsApp. Both see the full history; either can type; the thread stays coherent *because both
are looking at the same history before they respond*.

**The fix is read-before-write, enforced by the daemon — not attendance locking.** This is the
same discipline Claude Code's file edit uses: you cannot write unless you've read the current
version. Concretely:

- The daemon holds the authoritative transcript and knows the current sequence number for each
  CELLO session.
- The daemon tracks a **per-connection, per-session read cursor** — how far each IPC connection
  has read into each session.
- `cello_send` is gated on the calling connection being current. If connection B's read cursor
  is behind, the daemon refuses:
  `{ ok: false, reason: "session_not_current", current_seq: 47, last_read_seq: 31, guidance:
  "Call cello_receive to catch up before sending" }`.
- B calls `cello_receive` with `since_seq: 31`, receives 32–47, is now current, and the send
  succeeds.

This is entirely inside the daemon — no protocol change, no relay involvement (the relay
enforces wire-level sequence integrity, but the split-brain problem is purely about different
client sessions holding different views of the daemon's own transcript). It turns a bug into a
feature: two client sessions can genuinely collaborate on one conversation (one researches, one
drafts) as long as whoever sends is current. The `since_seq` cursor (below) is the load-bearing
mechanism.

---

## State Matrix — Full Coverage

All daemon/agent/session state combinations and their handling:

| Daemon | Agent state | Event | Handling |
|--------|-------------|-------|----------|
| Not running | — | Session request / message | Relay holds frames; daemon discovers on reconnect via directory-assisted relay check ("check relay on wakeup") |
| Running | Registered, not started | Session request / message | Directory has no active connection for this agent — returns `agent_unavailable` (Gap 6). Behaves as away (transparent default, opaque if privacy mode set) |
| Running | Away (Primary, no client) | Inbound session request | Away response sent (configurable message); request queued |
| Running | Away (Primary, no client) | Inbound message | Away response sent; message stored in DB |
| Running | Attended | Inbound session request | Push notification (`cello_session_request`) to the attending client |
| Running | Attended | Inbound message | Push notification (`cello_message`) to the attending client |
| Running | Attended, two client sessions | Inbound message | Both connections notified; whichever replies must be current on the sequence (read-before-write, Gap 1) |
| Primary down | Standby exists on another daemon | Inbound session request | Directory can't reach Primary; issues a primary transfer offer to Standby(s) — a one-time offer valid 2 minutes (Gap 7) |
| Any | Local daemon killed mid-session | Session becomes interrupted | Session belongs to one daemon for life — it cannot be taken over, only interrupted. UPGRADE-001 auto-upgrades the counterparty's unilateral seal to bilateral on reconnect (Gap 5) |

Notes on specific rows:

- **Interrupted session (Gap 5)** is fully implemented (UPGRADE-001, `seal-upgrade.ts`). When the
  absent party returns, its daemon recovers content hashes, verifies the chain, signs the ack
  leaf, and the directory promotes the unilateral seal to bilateral. No operator action required.
  A session is never migrated or resumed on another daemon — the ephemeral session node's keys
  exist only in the originating daemon's memory. See "Session portability" below.
- **Registered but not started (Gap 6)** becomes a narrow edge case once login auto-start lands —
  it only applies to operators who opted out of auto-start, or who registered a new agent
  mid-session without starting it. The directory has no active signaling connection for the
  agent, so it (not the daemon) returns the `agent_unavailable` frame, and the away message
  defaults to generic (there's no connected daemon to supply a custom one).
- **Two client sessions on one agent (Gap 1)** — see "Two client sessions, same agent, same
  CELLO session" above for the read-before-write mechanism.

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

### Abuse and storage controls (Gap 4)

Anyone who knows an address can send. That's the design — but it opens two abuse vectors, and
the daemon persists what it receives, so unchecked it's a storage-exhaustion problem:

1. **Single-agent spam** — one agent sends many messages, or very large ones, to exhaust
   storage or processing.
2. **Swarm DDoS** — an attacker registers many identities (buys N phone numbers, spins up N
   agents) and floods one victim. Each identity is individually valid; the volume is the attack.

Controls, layered:

- **Per-message size limit** — configurable cap on payload size. Applies to text today; extends
  to media (images, audio — modeled on the Telegram MCP channel's inbound attachment support)
  when that lands. No video planned. The relay already enforces a wire-level `MAX_CONTENT_BYTES`;
  this is a separate, operator-tunable policy cap at the daemon.
- **Per-session size limit** — total bytes across a session, so nobody sends you a book one
  chunk at a time and crashes your system. Configurable.
- **Per-sender rate limit** — messages per window from a single pubkey. Handles the persistent
  single-agent spammer.
- **Unknown-sender queue cap** — the Telegram "message requests" model. Unknown (non-whitelisted)
  senders land in a bounded queue; once it's full, further unknown-sender messages are silently
  dropped. Your main inbox stays clean.
- **Global unknown-sender queue cap** — a daemon-wide ceiling across all unknown senders
  combined, so 100 agents each filling their per-sender allowance can't multiply into
  100× the storage. This is the primary swarm-DDoS mitigation.

The whitelist boundary is what makes these coherent: whitelisted senders have no artificial
limit (beyond disk); unknown senders are bounded. "Fills a capped requests queue" and "fills
your database" are separated by whether the sender is known.

---

## Multi-Daemon and the Primary/Standby Model (Gap 7)

An agent *is* its public key. Same K_local = same agent, by definition — there is no "same
agent, different key." So an agent cannot exist on two daemons with two keys; that would be two
different agents. Running one agent on two machines means the **same K_local on both daemons** —
the exact analogue of the same WhatsApp/Signal account linked to a laptop and a phone.

This is a supported, first-class setup (laptop + an always-on EC2 instance, for example). Two
constraints make it work.

### One Primary at a time

Exactly one daemon is **Primary** for a given agent: it holds the standing receiver, maintains
the FROST-capable signaling connection, and owns inbound sessions. Every other daemon holding
that agent is **Standby**: connected to the directory (so it can *receive* directory-initiated
messages) but with no standing receiver and no FROST participation. This prevents the two
failure modes of a naive shared identity:

- **Session-request ownership** — a counterparty wants one session; only the Primary's standing
  receiver answers, so there's never a double-accept.
- **FROST double-signing** — only the Primary participates in DKG and seal ceremonies, so two
  daemons never produce competing signatures over the same state.

The directory is the mediator — it's the only party that can see all of an agent's daemons and
arbitrate. It holds the authoritative "who is Primary" record for each agent.

### Establishing the shared identity

K_local is transferred between the operator's own daemons via a key-agreement handshake
(ECDH-style): both sides derive a shared encryption key without the private key ever crossing
the wire in plaintext. Once both daemons hold K_local, they are peers for that agent and can
sync their local SQLCipher databases (transcript, session records, sealed receipts). Sync is
**user-initiated**, not automatic — the WhatsApp "link a device, it downloads the history"
model, on the operator's command.

### Transferring Primary — two directions

The **primary transfer offer** is the core mechanism. The directory issues it; it is a
**one-time offer valid for the next 2 minutes** (the TTL prevents a split-brain window where a
Standby holds an open claim while the old Primary comes back).

**Requesting Primary (Standby → Primary, "asking for the baton").** A Standby asks the directory
for Primary status. The directory asks the current Primary: *do you relinquish?*
- If the Primary agrees (governed by a per-agent policy — e.g. "auto-relinquish whenever asked",
  "only if no live session", "never"), the directory updates the Primary record; the new Primary
  brings up its standing receiver, the old one drops to Standby.
- If the Primary does **not respond within the allowed time** (laptop closed, crashed,
  unreachable), the directory hands Primary to the requester. This cleanly covers the
  "my laptop is closed, let my EC2 instance take over" case.

**Offering Primary (directory → Standby, the smart answering machine).** A session request
arrives for an agent whose Primary is unreachable. Rather than just bouncing the caller, the
directory proactively issues a primary transfer offer to the Standby(s): *an inbound session is
waiting and the Primary isn't answering — take over?* A Standby that accepts becomes Primary and
handles the call. This is the redundancy feature: "I always answer on my laptop, but if I'm away,
my AWS instance picks up."

Because **policies are per-agent markdown files local to each daemon**, the same agent can behave
differently depending on which daemon is Primary — a fully interactive persona on the laptop, a
terser answering-machine persona on the AWS backup. Same identity, same key, different
receptionist. This needs no new mechanism; it falls straight out of policies being daemon-local.

### One protocol addition

For the directory to *offer* Primary to a Standby, the Standby needs a live signaling connection
that can receive a directory-initiated message. Today the signaling stream is client-initiated
and carries client→directory traffic; the primary transfer offer is a new directory→client
message type. Small, but it is a genuine protocol addition, and it's what the Standby state in
the agent-state table depends on.

### Session portability (Gap 5 / Gap 9) — close, sync, re-open

**A session belongs to one daemon for its entire lifetime. Full stop.** The ephemeral session
node, its transport keys, and its in-memory Merkle tree live only on the daemon that created it.
There is no live migration — not paused-and-moved, not taken over mid-flight. When that daemon
goes away, the session is *interrupted* (handled by UPGRADE-001, above).

The primary/standby model transfers ownership of **future** sessions, never an active one. To
continue a conversation on a different device, the operator:

1. **Closes** the session on daemon A (produces a sealed receipt),
2. **Syncs** databases so daemon B has the full transcript,
3. **Starts a new session** on daemon B — `cello_get_transcript` gives full history, so context
   carries over even though the counterparty sees a new session.

This is the CELLO analogue of Claude Code's `--teleport` (which hands a session's *history and
branch* from a cloud session to a local terminal — it moves context, not live compute). CELLO's
version moves context at the transcript level; the cryptographic session itself is always
device-local. "Continuation" is a user-level concept, not a protocol primitive.

---

## Configuration Surface

This document says "configurable" repeatedly — away messages, auto-start opt-out, privacy mode,
session-request TTL, unknown-sender queue caps, message/session size limits, rate limits, primary
transfer policy. **None of these has a setter today.** The CLI has `login`, `logout`, `register`,
`status` — no way to read or write any of this. And several settings from earlier milestones that
were *specified* as configurable (various TTLs) also have no surface.

This is a load-bearing gap: without it, "configurable" is just a word in a design doc. Needed:

```
cello config list                              # all settings + current values
cello config get [key]
cello config set [key] [value]
cello config get --agent <name> [key]          # per-agent scope
cello config set --agent <name> [key] [value]
```

Settings that already exist and lack a setter: away message, privacy mode, auto-start,
primary-transfer policy. Settings introduced by this document that need one: session-request TTL,
unknown-sender queue cap (per-sender and global), per-message size limit, per-session size limit,
per-sender rate limit. Some are global, some per-agent — the `--agent` scope distinguishes them.

---

## Design Review Resolutions (index)

A ten-item design-review pass produced the following. This table is an index only — each
decision's substance lives in the section named, so related material stays together rather than
being restated here.

| # | Issue | Resolution → section |
|---|-------|----------------------|
| 1 | Two client sessions on one agent could split-brain a conversation | Read-before-write via per-connection read cursor; `cello_send` gated on being current → *Multi-Agent Within a Single Session* |
| 2 | Concurrent active sessions per agent | Already works — keyed by `(agentName, sessionId)`; document only → *Multi-Agent Within a Single Session* |
| 3 | Session-request TTL/expiry | Requester already has `timeout_ms`; receiver queue gets a 24h configurable TTL → *Configuration Surface* + login/away story |
| 4 | Storage bounds / spam / DDoS | Per-message + per-session size caps, per-sender rate limit, bounded unknown-sender queue (per-sender + global) → *Abuse and storage controls* |
| 5 | Local daemon crash mid-session | Session is device-local for life; interrupt + UPGRADE-001 auto-upgrade; no migration → *State Matrix* + *Session portability* |
| 6 | Directory's role for registered-not-started agents | Directory returns `agent_unavailable`; generic away message → *State Matrix* |
| 7 | Same agent on two daemons | Primary/Standby, ECDH key sync, primary transfer offer (2-min TTL), per-daemon policies → *Multi-Daemon and the Primary/Standby Model* |
| 8 | Auto-start failure UX | Login always completes; failed agents stay Registered and are enumerated with reason → login story |
| 9 | Client handoff / session portability | No live migration; close → sync → new session; transcript-level continuity → *Session portability* |
| 10 | Ordering guarantees on reconnect | Per-session order via Merkle seq; cross-session = arrival order → `since_seq` story |

---

## Stories Needed

| Area | Type | Scope | Gap |
|------|------|-------|-----|
| Wire IPC notification forwarding + `claude/channel` capability (6 gaps) | Implementation | cello-client only | — |
| `cello_message` notification includes `session_id` | Implementation | cello-client only | — |
| `use_agent` auto-starts agent if not online | Implementation | cello-client (daemon + CLI) | — |
| `cello login` auto-starts all loaded agents (with opt-out config); partial-failure enumeration | Implementation | cello-client (CLI) | 8 |
| `cello_check_notifications({ scope })` MCP tool (default: current agent, opt-in: all) | Implementation | cello-client (daemon + adapter) | — |
| Per-connection read cursor + `session_not_current` gate on `cello_send` | Design + impl | cello-client (daemon) | 1 |
| `since_seq` cursor on `cello_receive` for reconnect + catch-up | Design + impl | cello-client | 1, 10 |
| Away response configuration (per-type templates, privacy mode) | Design + impl | cello-client + protocol | 6 |
| Contact whitelist (binary known/unknown, per-agent privacy, presence visibility) | Design + impl | cello-client + directory | — |
| Abuse controls (message/session size caps, per-sender rate limit, bounded unknown-sender queue) | Design + impl | cello-client + protocol | 4 |
| Primary/Standby: shared K_local via ECDH, DB sync, primary transfer offer (2-min TTL), per-daemon policy | Design + impl | Both repos | 7 |
| Session portability: close → sync → new session; transcript-level continuity | Design + impl | cello-client | 5, 9 |
| CLI configuration surface (`cello config get/set/list`, `--agent` scope) | Implementation | cello-client (CLI) | 3, 4 |
| "Check relay on wakeup" — directory-assisted relay discovery | Design + impl | Both repos | — |

**Sequencing.** The first two are pre-requisites for channels to work at all. `use_agent`
auto-start, `login` auto-start, and the CLI config surface are quick wins that make everything
else usable. The read-cursor gate + `since_seq` cursor are load-bearing for both reconnect and
the two-session group-chat model. Primary/Standby is the largest single body of new work (it
touches key agreement, DB sync, and a new directory→client message type) — treat it as its own
milestone-scale effort, not a story.
