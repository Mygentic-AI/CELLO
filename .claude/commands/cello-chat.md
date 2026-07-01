---
name: cello-chat
description: Enter a CELLO peer-to-peer conversation as one agent. Two Claude sessions each run this command with their assigned role (initiator or responder), agent name, counterparty pubkey, and a topic. They chat autonomously until one seals.
---

# CELLO Chat — Peer-to-Peer Agent Conversation

You are entering a live CELLO session as one agent. Another Claude session is running the other agent. You will chat about the given topic, then one of you will seal the session.

**You will be told:**
1. Your role: `initiator` or `responder`
2. Your agent name (e.g. `Demo2`, `Agent-1`)
3. Your counterparty's pubkey (64-char hex)
4. A topic to discuss

---

## Setup (both roles)

### Step 1 — Start your agent

```
cello_start_agent({ name: "YOUR_AGENT_NAME" })
```

### Step 2 — Set yourself as current

```
cello_use_agent({ name: "YOUR_AGENT_NAME" })
```

### Step 3 — Confirm status

```
cello_status()
```

Verify your agent shows `state: "online"` (or at minimum appears in the agents list). Verify `directory_signaling: "connected"`.

---

## Path 1: Initiator

### Step 4 — Initiate session

```
cello_initiate_session({ target_pubkey: "COUNTERPARTY_PUBKEY" })
```

Note the `sessionId`. If it returns `standing_receiver_unavailable`, the responder hasn't started yet — wait 5 seconds and retry.

### Step 5 — Send opening message

Compose a message related to the topic. Keep it conversational (1-3 sentences).

```
cello_send({ session_id: "SESSION_ID", content: "your message" })
```

### Step 6 — Conversation loop

Repeat:
1. `cello_receive({ session_id: "SESSION_ID", timeout_ms: 30000 })`
2. On message: read it, compose a reply on-topic, send it
3. On timeout: say "Listening..." and loop again

**Message style:** Be direct, curious, conversational. 1-3 sentences. Don't pad. React to what the other agent actually said.

### Step 7 — Seal (after 4-8 exchanges)

After a natural conversational endpoint (4-8 total messages exchanged, or when the topic feels explored), send a final message like "Good conversation. Sealing now." and then:

```
cello_close_session({ session_id: "SESSION_ID" })
```

This triggers the bilateral FROST seal ceremony. Report the `sealed_root`.

---

## Path 2: Responder

### Step 4 — Wait for the session

The initiator will connect to you. Your standing receiver auto-accepts.

```
cello_receive({ timeout_ms: 60000 })
```

This will return the first message from the initiator (the session was auto-accepted when they initiated). Note the `sessionId` from the response.

If it times out, check `cello_list_sessions()` for an active session.

### Step 5 — Reply

Read the initiator's message. Compose a reply on-topic (1-3 sentences). Send it:

```
cello_send({ session_id: "SESSION_ID", content: "your reply" })
```

### Step 6 — Conversation loop

Same as initiator Step 6:
1. `cello_receive({ session_id: "SESSION_ID", timeout_ms: 30000 })`
2. On message: read it, compose a reply, send it
3. On timeout: loop again

### Step 7 — Detect seal

You do NOT call `cello_close_session`. The initiator will seal when the conversation reaches a natural end. When the FROST ceremony completes, your next `cello_receive` returns:

```json
{ "type": "session_sealed", "sealed_root": "<hex>" }
```

Report the sealed_root. The session is closed.

**If instead you receive a message like "Sealing now" followed by the seal:** that's the normal flow. The initiator sent a courtesy message, then called `cello_close_session`. Your next receive will be the `session_sealed` event.

---

## After the conversation

Report:
```
Session complete.
  Agent:        <your agent name>
  Role:         initiator/responder
  Session ID:   <hex>
  Messages:     <count sent + received>
  Sealed root:  <hex>
```

---

## Current registered agents

| Agent | Pubkey |
|-------|--------|
| Demo2 | `8999608f8493e7b65556818ca8571bc6c538b604b716549d41ead9d2b2c1dffd` |
| Agent-1 | `c51bb00258c8829907a56176d889ba5b7bdbac4fa8a3170fa099877dfcfc583d` |

Update this table after registering new agents.

---

## Troubleshooting

**`standing_receiver_unavailable`**
The responder's agent isn't online yet. Have them run `cello_start_agent` first.

**`ipc_connection_lost`**
MCP disconnected from daemon. Run `/mcp` to reconnect, then retry.

**`cello_receive` timeout**
The other agent hasn't sent yet. Loop and try again. If persistent, check their session is running (`cello_list_sessions`).

**Session doesn't appear for responder**
The responder's standing receiver may not have been created. Verify `cello_start_agent` was called for their agent name. Check daemon log for `session.node.created` with their agent name.

**Seal fails or times out**
FROST ceremony requires the directory to be reachable. Check `directory_signaling: "connected"` in `cello_status`.

**Both agents on the same daemon**
This is normal and expected. The daemon multiplexes agents. Each Claude session uses `cello_use_agent` to route calls to their agent. Transport still goes through the relay (even locally) because both agents are behind NAT.
