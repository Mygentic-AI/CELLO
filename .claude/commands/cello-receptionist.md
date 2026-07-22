---
name: cello-receptionist
description: Monitor a CELLO agent's inbox and report the first inbound event — a new session request or unread message. Invoke with the agent name: /cello-receptionist <agent-name>
---

# CELLO Receptionist

You are a receptionist for CELLO agent **$ARGUMENTS**. Your job is to sit at the front desk, wait for the first inbound event, announce it, and stop. The operator decides what to do next.

---

## Steps

### 1 — Select the agent (brings it online and makes it reachable)

```
cello_use_agent({ name: "$ARGUMENTS" })
```

### 2 — Confirm it's ready

```
cello_status()
```

Verify `state: "online"`, `directory_signaling: "connected"`, and `standing_receiver_ready: true`. If not ready, wait 3s and re-check.

### 3 — Check the inbox first

```
cello_inbox()
```

If there are already pending session requests or unread messages, report them immediately (see *Reporting* below) and stop — do not wait for more.

### 4 — Block on the doorbell

If the inbox is empty, dispatch the `cello-receptionist` subagent to block until the first event arrives:

```
Agent({ subagent_type: "cello-receptionist", prompt: "$ARGUMENTS" })
```

This blocks until the first new session request or unread message arrives, then returns the agent name, event type, and full inbox JSON.

---

## Reporting

When an event arrives, report it in this format:

```
Incoming event for <AGENT_NAME>:
  Type:     <new_session | unread_message>
  From:     <sender pubkey or known agent name>
  Session:  <session ID if applicable>
  Preview:  <first ~100 chars of content, if available>

Awaiting your instructions.
```

Then stop. Do not read, reply to, or handle the session.

---

## What you do NOT do

- Do not call `cello_receive` on the inbound session.
- Do not respond to messages.
- Do not close sessions.
- Do not make decisions about the content.

Your only job is to announce the arrival. The operator decides what happens next.

---

## Re-entrancy

This command exits after one event. To keep watching, the operator runs `/cello-receptionist $ARGUMENTS` again after handling the event.

---

## What comes next

After the receptionist reports an arrival, the operator typically:

- Runs `/cello-walkie-talkie` with the **responder** role and the session ID surfaced here to conduct a full conversation.
- Delegates to another agent.
- Ignores the call.

| | Receptionist | Walkie-Talkie |
|---|---|---|
| **Role** | Waits for inbound, announces arrival | Conducts a full two-way conversation |
| **Signal tokens** | N/A | `[[OVER]]` / `[[STANDBY EST:Xm]]` / `[[WRAP]]` required on every send |
| **When to use** | Staffing an agent's front desk | Active conversation between two agents |
