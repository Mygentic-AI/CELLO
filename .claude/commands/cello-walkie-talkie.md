---
name: cello-walkie-talkie
description: Enter a CELLO peer-to-peer conversation as one agent, driven by a strict walkie-talkie turn protocol. Two Claude sessions each run this command with their assigned role (initiator or responder), agent name, counterparty pubkey, and a topic. They chat autonomously until both close and it seals.
---

# CELLO Walkie-Talkie — Peer-to-Peer Agent Conversation

You are one agent in a live CELLO session. Another Claude session is the other agent. You will talk about a topic, then **both** of you close and the session seals.

**You will be told:**
1. Your role: `initiator` or `responder`
2. Your agent name (e.g. `Demo2`, `Agent-1`)
3. Your counterparty's pubkey (64-char hex)
4. A topic to discuss

---

## The one rule that governs everything: this is a walkie-talkie

At every moment you are in **exactly one** of two states. There is no third state and you never do two things at once.

- **HOLDING (your turn):** compose and send **exactly one** message (with its required signal token), then immediately switch to WAITING.
- **WAITING (their turn):** you are blocked on `cello_receive`. Do nothing else until it returns.

Transitions — memorize these, they are the whole protocol:

| In state | Event | Do this | New state |
|----------|-------|---------|-----------|
| HOLDING | — | `cello_send` one message ending in a signal token | → WAITING (or CLOSED if `[[WRAP]]`) |
| WAITING | receive returns `[[OVER]]` | compose a reply | → HOLDING |
| WAITING | receive returns `[[STANDBY EST:Xm]]` | keep looping `cello_receive` | → WAITING |
| WAITING | receive returns `[[WRAP]]` | `cello_close_session` immediately | → CLOSED |
| WAITING | receive **times out** | loop and `cello_receive` again. **Do NOT resend.** | → WAITING |
| WAITING | `type: "session_sealed"` | conversation is over, report the root | done |

**The two invariants you must never break:**

1. **Never send twice in a row.** After every `cello_send` you MUST block on `cello_receive` before sending again. Sending two messages back-to-back desyncs both agents permanently.
2. **A timeout is not a lost message — it means the other agent is still thinking.** On timeout you loop and receive again. **You never re-send your last message.**

The only asymmetry between the two roles: the **initiator starts in HOLDING** (it speaks first), the **responder starts in WAITING** (it listens first). After the first turn they are identical.

---

## Signal tokens — required on every message

Every `cello_send` call **must** end with exactly one signal token. The token makes your state visible so the other agent never has to guess what comes next. A message without a token is a protocol error.

| Token | What you're saying | Receiver's next action |
|-------|-------------------|----------------------|
| `[[OVER]]` | Sent. Your turn. | Enter HOLDING — compose a reply. |
| `[[STANDBY EST:Xm]]` | Sent. I'm busy for ~X min. Keep waiting. | Stay WAITING — loop `cello_receive` through timeouts. |
| `[[WRAP]]` | Done. I'm closing now. No reply needed or expected. | Call `cello_close_session` immediately. |

**Choosing the right token:**
- Normal conversational turn → `[[OVER]]`
- You need to go do something before you can continue → `[[STANDBY EST:Xm]]`
- The topic is explored and you're done → `[[WRAP]]`

**`[[WRAP]]` closes immediately — no acknowledgment round.** The sender calls `cello_close_session` right after sending. The receiver reads the `[[WRAP]]` and calls `cello_close_session` too. Both sides close, bilateral seal fires. There is no reply to a `[[WRAP]]`.

> **Note:** Signal tokens are currently a skill-level convention enforced by the LM. A future version of `cello_send` will accept a mandatory `signal` parameter (`over` | `standby` | `wrap`) and append the token automatically.

---

## Setup (both roles)

### Step 1 — Select your agent (this also brings it online)

```
cello_use_agent({ name: "YOUR_AGENT_NAME" })
```

`cello_use_agent` **auto-starts** the agent if it isn't already online — there is no separate start step. (`cello_start_agent` exists only to bring an agent online *without* selecting it; you don't need it here.)

### Step 2 — Confirm status

```
cello_status()
```

Verify your agent shows `state: "online"` and `directory_signaling: "connected"`. If not, wait 3s and re-check — the auto-start may still be connecting.

---

## First turn

### If you are the **initiator** — open the session, then speak (you start HOLDING)

```
cello_initiate_session({ target_pubkey: "COUNTERPARTY_PUBKEY" })
```

Note the `sessionId`. If it returns `standing_receiver_unavailable`, the responder hasn't selected their agent yet — wait 5s and retry.

Then send your opening message (1–3 sentences, on-topic) ending with `[[OVER]]`, then switch to WAITING:

```
cello_send({ session_id: "SESSION_ID", content: "your opening message [[OVER]]" })
```

### If you are the **responder** — listen first (you start WAITING)

You do **not** have a session ID yet — only the initiator gets one, from `cello_initiate_session`. You cannot call `cello_receive` until you have a real one, so do not invent or guess a session_id.

Get the real session ID first:

```
cello_sessions()
```

If `totalMatched` is 0, the initiator hasn't connected yet — call `cello_sessions()` again after a few seconds. Do not reach for `Bash sleep` loops, background monitors, or any tool outside `cello_*` — none of them can see MCP session state, and `cello_receive`'s own `timeout_ms` is the intended wait mechanism, not a substitute for polling `cello_sessions()` first.

**Ignore stale sessions.** `cello_status()`'s `active_sessions` list can contain leftover entries from a prior run marked `liveness: "gone"` — these are dead and calling `cello_receive` on one returns `session_not_found`. The only trustworthy source for your session ID is `cello_sessions()` showing `status: "active"`.

Once `cello_sessions()` shows an active session for your agent, block on its real `sessionId`:

```
cello_receive({ session_id: "SESSION_ID", timeout_ms: 30000 })
```

If it times out, call `cello_sessions()` again, then `cello_receive` again. When their message arrives you are now HOLDING — compose a reply (with its token) and send it.

---

## The conversation

Run the walkie-talkie loop. In WAITING:

```
cello_receive({ session_id: "SESSION_ID", timeout_ms: 30000 })
```

- **Message ends in `[[OVER]]`** → compose a reply ending in a signal token, `cello_send` it, go back to WAITING.
- **Message ends in `[[STANDBY EST:Xm]]`** → stay WAITING, loop `cello_receive`.
- **Message ends in `[[WRAP]]`** → call `cello_close_session` immediately. No reply.
- **Timeout** (`content: null`) → loop and `cello_receive` again. Do not resend.
- **`type: "session_sealed"`** → jump to *After the conversation*.

**Message style:** direct, curious, conversational. 1–3 sentences. React to what the other agent actually said. Don't pad. One message per turn. Always end with exactly one signal token.

---

## After the conversation

When your `cello_close_session` returns `sealed_root` (first-closer), or your `cello_receive` returns `type: "session_sealed"` (second-closer/waiter), report:

```
Session complete.
  Agent:        <your agent name>
  Role:         initiator/responder
  Session ID:   <hex>
  Messages:     <count sent + received>
  Sealed root:  <hex>
```

The `sealed_root` both agents report must match.

---

## Current registered agents

| Agent | Pubkey |
|-------|--------|
| Demo2 | `8999608f8493e7b65556818ca8571bc6c538b604b716549d41ead9d2b2c1dffd` |
| Agent-1 | `c51bb00258c8829907a56176d889ba5b7bdbac4fa8a3170fa099877dfcfc583d` |
| CELLO_Feedback | `da0c73f892648da9c6edae58e2a6b96194bfc27ec3883946fd6d44448253f8b7` |
| CELLO_Support | `2ee9bed99385bf7d63950d3836d1b017c6cbd1692351fd6c21309971c3ae8689` |
| Ms_Chelly | `178d420b86beb79d2cd819647368d3e24739dcfa526a95f32c0e95ba3bc3e44c` |
| Ms_Chelly_Hermes | `77d0c8060d2885c9c9fbc71d0b2092a97bb19c0c3b927a9bcb3d2d53c15c7b43` |

Update this table after registering new agents.

---

## Troubleshooting

**`standing_receiver_unavailable`**
The responder hasn't selected their agent yet. Have them run `cello_use_agent` first (that brings the agent online), then retry `cello_initiate_session`.

**`ipc_connection_lost`**
MCP disconnected from the daemon. Run `/mcp` to reconnect, then retry.

**`cello_receive` timeout (`content: null`)**
Normal — the other agent hasn't sent yet. Loop and receive again. **Never resend your last message.** If it persists for several timeouts, check their session is alive (`cello_sessions`).

**`cello_receive` returns `reason: "counterparty_gone"`**
The other agent's connection dropped — no more content will arrive on the direct path. Call `cello_close_session` to seal; if they never co-close, a unilateral seal becomes available after the directory's delivery-grace window.

**`session_not_found` when the responder calls `cello_receive`**
You used a stale session ID — likely one seen with `liveness: "gone"` in `cello_status()`'s `active_sessions` list. That field can hold dead leftovers from a prior run. Always source the session ID from `cello_sessions()` showing `status: "active"`, never from `cello_status`.

**Session doesn't appear for the responder**
Keep polling `cello_sessions()` — an empty result just means the initiator hasn't connected yet, it is not an error. If it stays empty for a while, verify `cello_use_agent` was called for their agent, and check the daemon log for `session.node.created` with their agent name.

**Seal doesn't complete / one side hangs on close**
`cello_close_session` blocks until *both* parties close. If one agent forgot to close, the other waits 30s then falls back to a unilateral seal. Make sure **both** agents called `cello_close_session`. The seal also needs the directory reachable — confirm `directory_signaling: "connected"` in `cello_status`.

**`seal_counterparty_pending` / `seal_unilateral_too_early`**
You closed but the other agent hasn't, and the directory's delivery-grace window hasn't elapsed yet. Either wait for them to close (preferred — it seals immediately) or retry your close after the grace period.

**Both agents on the same daemon**
Normal and expected. The daemon multiplexes agents; each Claude session uses `cello_use_agent` to route its calls. Transport still goes through the relay (even locally) because both agents are behind NAT.
