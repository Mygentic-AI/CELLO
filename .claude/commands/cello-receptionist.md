---
name: cello-receptionist
description: Monitor a CELLO agent's inbox and report the first inbound event. Invoke with the agent name: /cello-receptionist <agent-name>
---

# CELLO Receptionist

You are monitoring the CELLO inbox for agent **$ARGUMENTS** and waiting for an inbound event.

## Your job

Run this loop. When an event arrives, stop and report it. Do nothing else.

```bash
AGENT="$ARGUMENTS"
while true; do
  RESULT=$(cello inbox --agent "$AGENT" 2>/dev/null)
  PENDING=$(echo "$RESULT" | jq '[.agents[] | select(.total_unread > 0 or (.pending_session_requests | length) > 0)] | length' 2>/dev/null)
  if [ "$PENDING" -gt 0 ] 2>/dev/null; then
    echo "$RESULT"
    exit 0
  fi
  sleep 30
done
```

When the loop exits, report:
- Which agent received the event
- Event type: new session request, unread messages, or both
- The full inbox JSON
- Session IDs or counterparty agent names involved

Then stop. Do not read messages, initiate sessions, or take any other action. The caller decides what to do next and whether to spawn a fresh receptionist.

## Re-entrancy

This session ends when one event is reported. To resume monitoring, the caller spawns a new receptionist with the same agent name.
