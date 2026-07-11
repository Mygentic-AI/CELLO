---
name: cursor-durable-read-before-write-design
type: user-story
date: 2026-07-11
topics: [cursor, read-before-write, session-not-current, watermark, cli, stateless-client, daemon, security-gate, dod-cursor-durable-1]
status: designed-awaiting-go
description: >
  DOD-CURSOR-DURABLE-1 — the read-before-write gate consults an in-memory PER-CONNECTION cursor that
  dies with the socket, so any stateless client (the `cello` CLI, one process per command) is
  permanently blocked from replying once the counterparty speaks. Design for consulting the PERSISTED
  per-(agent, session) read watermark instead. Includes the two traps a naive fix falls into, and the
  security trade the change makes explicit. DESIGN ONLY — awaiting Andre's go before landing.
---

# DOD-CURSOR-DURABLE-1 — read-before-write must survive the connection

> **Status: DESIGNED, NOT BUILT. Do not land without Andre's explicit go** — this changes a
> security-adjacent access-control gate, and it makes a real (small) relaxation of an existing
> guarantee. That trade is stated in §5 and must be accepted on purpose, not absorbed silently.

## 1. The defect, in one line

**A bash agent can open a session and speak once. The moment the counterparty replies, every
subsequent `cello send` is permanently rejected — even though the agent has demonstrably read the
message.**

Reproduced live on 2026-07-11 by the DOD-CLI-PARITY-1 bash-only smoke (step 4). B receives A's
message successfully via `cello receive`, then B's `cello send` returns:

```json
{"ok":false,"reason":"session_not_current","current_seq":0,"last_read_seq":-1,
 "guidance":"This connection hasn't caught up … Call cello_get_transcript … then retry the send."}
```

Following the guidance does not help: `cello transcript` is *also* a new process.

## 2. Producer / consumer (the actual mechanism — not the error string)

| | |
|---|---|
| **Consumer** | `daemon.ts:5528` — the gate: `if (lastReadSeq < currentSeq) → session_not_current` |
| **`lastReadSeq` producer** | `getConnectionCursor(connectionId, sessionId)` (`daemon.ts:5527`) reading `connectionCursors`, an **in-memory `Map` keyed by connectionId** (`daemon.ts:919`). Deleted on disconnect — `daemon.ts:6252` states it outright: *"M8C-CURSOR-1: cursor is connection-scoped, dies with it."* Unknown connection → **`-1`**. |
| **`currentSeq` producer** | `record.message_count - 1` (`daemon.ts:5526`) — the session tree's highest leaf index, counting **every** message in the session, sent *and* received, by any connection. |

The MCP shim holds **one long-lived socket**, so its cursor accumulates and read-then-send works.
The CLI is the opposite: **a new process and a new connection per command**, so `lastReadSeq` is
**always `-1`** at send time.

Why A's *first* send works: a virgin session has `message_count = 0` → `currentSeq = -1`, and
`-1 < -1` is false. The gate only bites once a message exists. Hence: speak once, then blocked forever.

**Blast radius is wider than the CLI.** Any stateless or reconnecting client hits this. A *reconnecting*
MCP client gets a fresh `connectionId` and therefore a `-1` cursor too — its first post-reconnect send
on a live session is blocked for the same reason.

## 3. The state to fix it ALREADY EXISTS

`message_watermarks` — `session-node-manager.ts:621` — is a **persisted, per-(agent_id, session_id)**
read watermark. `daemon.ts:914` explicitly calls it *"Distinct from"* the connection cursor.

- `getLastDeliveredSeq(agent, session) → number` (`-1` when nothing delivered)
- `advanceLastDeliveredSeq(agent, session, seq)` — **monotonic** (`MAX(...)`, never lowers)
- Keyed on **`agent_id`**, the stable key — already correct per the join-on-the-stable-key rule.
- `cello_receive` **already advances it** (`daemon.ts:5827`, "delivery marks read").

**The gate is consulting the wrong authority.** It asks the socket what it has seen, when the daemon
already durably knows what the *agent* has seen.

## 4. The two traps a naive fix falls into

A one-line swap of `getConnectionCursor` for `getLastDeliveredSeq` is **wrong**, twice over. Both were
found by reading the producers, and both would have shipped a broken gate that passes a shallow test:

**Trap 1 — the two counters do not measure the same thing.**
`currentSeq` counts **every** message (your own sends included). `last_delivered_seq` counts only
**RECEIVED** messages delivered via `cello_receive`. The connection cursor is advanced by *both*
receiving and your own sending (which is why `daemon.ts:5679` notes a sender is not blocked by its own
just-sent message). So comparing `last_delivered_seq < currentSeq` would block **your own second send
in a row** — you sent seq 0, `currentSeq` = 0, your received-watermark is still `-1`. This would break
the MCP path too, not just the CLI.

**Trap 2 — the documented remedy would stop working.**
The gate's own guidance says *"Call `cello_get_transcript` … then retry."* But `cello_get_transcript`
**does not advance the persisted watermark** — only the connection cursor (confirmed at
`daemon.ts:1128`). Under a watermark-only gate, the one remedy we tell operators to use would leave
them exactly as blocked.

## 5. Proposed design

### AC1 — the gate asks the right question
The gate's real intent is: **"has this agent seen everything the counterparty said?"** Your own sends
are irrelevant — you know what you wrote. So the gate becomes:

> **Block iff there exists a RECEIVED message in this session with `sequence > last_delivered_seq`
> for this (agent_id, session_id).**

That is the *unread-received* count, which INBOX-1 already computes with a `LEFT JOIN
message_watermarks` (`session-node-manager.ts:917`) — reuse it, do not write a second query.
This sidesteps Trap 1 by construction: own sends never enter the comparison.

### AC2 — belt and braces, so no existing client changes behavior
Accept the send if **either** authority says caught-up:

```
caughtUp = (getConnectionCursor(connId, sid) >= currentSeq)      // today's rule, unchanged
        || (unreadReceivedCount(agentId, sid) === 0)             // the durable rule (new)
```

A long-lived MCP connection satisfies the first clause exactly as it does today — **zero behavior
change on the shipped path**, which is what makes this safe to land on a security gate. The stateless
CLI satisfies the second. Nothing that works today stops working.

### AC3 — reading the transcript counts as reading (fixes Trap 2)
`cello_get_transcript` advances the persisted watermark to the highest RECEIVED sequence it returned.
This is a correctness fix in its own right: **reading the full history is reading.** It also makes the
gate's existing guidance true for every client, and it correctly clears the `inbox` unread count for
messages the operator has now actually seen.

*Caveat to verify when building:* `daemon.ts:1126-1133` notes that a session read ONLY via
`cello_get_transcript` never advanced the watermark, which left a stale `telegramRungUnread` entry.
Advancing the watermark here **helps** that case; confirm it does not double-clear anything.

### AC4 — observability
`session.send.blocked` keeps logging, and gains both authorities so the next person can tell *which*
one refused: `{ sessionId, currentSeq, connectionCursor, unreadReceived, agentId, connectionId }`.

### AC5 — proof
A **bash-only, two-agent, BIDIRECTIONAL** conversation (A→B→A→B, several turns, one process per
command) completes and seals, with matching `sealed_root` on both sides. This is the DOD-CLI-PARITY-1
smoke extended past the one-way limit it currently hits. Plus a unit test that a *reconnecting* client
(fresh connectionId, live session) can send after reading — the latent MCP bug this also fixes.

## 6. 🔻 The security trade — state it, accept it on purpose

**This relaxes an existing guarantee, and the relaxation is real.**

Today the gate is **per-connection**: *"this socket must independently have read."* The comment at
`daemon.ts:5521-5523` names the case it is protecting — *"a second attended session on the same agent
that hasn't polled since the other connection's last send"* — the WhatsApp-group-chat model, where two
Claude Code windows are both attending one agent.

After this change the durable clause is **per-agent**: *"this AGENT must have read."* So if window 1
reads the counterparty's message and window 2 (which never read it) sends, window 2's send is now
**allowed** where today it is refused. Window 2 can reply context-blind to something *it* never saw.

**Why this is the right trade:**
- The principal in CELLO is the **agent**, not the socket. Both windows are the same operator's own
  processes, holding the same keys, speaking under the same identity to the same counterparty. A socket
  is an implementation detail of how the operator attached; it is not a trust boundary.
- The gate's purpose is to stop an agent replying to a message **nobody on its side has seen** — the
  ordering/injection hazard. It is not, and cannot be, a coordination mechanism between an operator's
  own concurrent windows: the daemon has no way to know which window a human is looking at.
- The daemon already concedes the cross-connection reality in its own guidance string: *"this may
  include messages authored by another connection on this same agent."*
- Against that, the status quo makes **an entire class of client (every stateless one) unable to hold a
  conversation at all** — it fails the protocol's central promise, from bash and from any reconnecting
  client. A guarantee that only holds for one long-lived-socket client, at the cost of breaking every
  other, is not a guarantee worth keeping in that form.

**If we decide the per-connection guarantee must be preserved,** the alternative is to keep the
strict clause for connections that have *already interacted with this session* and apply the durable
clause only to fresh connections. That is more faithful and more complex, and it is a real option —
it just needs to be chosen deliberately. **Andre's call.**

## 7. Non-goals

- **No auto-read-before-send in the CLI.** The CLI could silently read the transcript on the same
  connection and then send. That was rejected: it is the auto-fix the parity brief forbids, and it
  hollows the guarantee out completely — the gate exists so a sender has genuinely seen what it is
  replying to, and a client that reads on the sender's behalf satisfies the letter while destroying the
  point.
- **No change to what the client is trusted to assert.** The client never tells the daemon "I have
  read up to N" — the daemon keeps deciding, from state it owns.

## 8. Related

- [[2026-07-11_cli-mcp-parity-plan]] — DOD-CLI-PARITY-1, which found this (its bash-only smoke is
  blocked one-way by it).
- [[M8C-DEFINITION-OF-DONE]] — `DOD-CURSOR-DURABLE-1` (this), `DOD-CUSTODY-DAEMON-1`.
