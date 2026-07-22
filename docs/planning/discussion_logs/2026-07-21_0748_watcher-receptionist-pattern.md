---
name: 2026-07-21 Watcher and Receptionist Pattern
type: discussion
date: 2026-07-21
topics: [ux, signaling, polling, receptionist-pattern, sub-agents]
status: active
description: >
  A pattern for enabling "inbound notifications" in agentic harnesses (like Co-worker/Codex) 
  that lack native event channels. Uses a local background watcher to poll the Cello 
  daemon/relay, then delegates to the harness only upon meaningful events.
---

# 2026-07-21 — Watcher and Receptionist Pattern

## The actual problem
Many agentic harnesses (OpenAI Codex, Anthropic Co-worker) operate in a closed-loop or high-latency polling environment. They lack native inbound event channels, meaning they are "deaf" to incoming Cello sessions or messages unless actively querying. Relying on the harness's internal polling (e.g., 1-hour intervals) is insufficient for collaboration.

## The proposed solution: Watcher/Receptionist Architecture
Instead of forcing the main agent to poll, we decouple **Signaling** from **Reasoning** by using a lightweight background watcher (the Receptionist) that monitors the local Cello daemon/relay.

### Architecture
- **Receptionist (Watcher):** A persistent, low-overhead process (bash script or lightweight daemon) that polls the local Cello relay. 
- **Transport:** The Cello relay (file-based or socket).
- **Harness Interface:** The Receptionist pushes meaningful events (summaries, session invites, urgent messages) directly into the harness's workspace (via file injection, tool input, or stdin).
- **Harness (The Boss):** The main agent maintains the active high-context session and reasoning state. It remains dormant until the Receptionist "wakes it up" via workspace manipulation.

## First-Class "Listening" Support
We will formalize this pattern as a first-class feature in the Cello protocol, supporting "listening" via:
- **Event Filtering:** The watcher shouldn't wake the agent for every heartbeat. It needs to filter for specific events (e.g., "Inbound session from X", "Urgent message from VIP").
- **Implementation Hooks:** 
    - **Bash Call:** Standardized bash command for the watcher to execute in the background.
    - **MCP Tool Call:** A dedicated Cello MCP tool that harnesses can invoke to *programmatically* register their interest in certain events (e.g., `cello_listen(filter_criteria)`).

## Operational Principles
- **Resource Efficiency:** The watcher should consume minimal tokens. It only invokes the main model when the filter criteria are met.
- **Independence:** The main agent is not responsible for polling; it is responsible for reasoning.
- **Signaling vs. Messaging:** Treat "Inbound Call" (Session Invitation) as a Control Plane signal (Ring) separate from the Data Plane (The Message Body).

## Implementation Roadmap
1. Define the `cello_listen` MCP tool signature.
2. Develop the standardized background bash script pattern for receptionists.
3. Add a "Signaling" section to the Messaging Framework doc to define how agents announce their availability to "answer" (The Virtual Waiting Room pattern).

## The Re-entrancy Contract
Since the agent (Codex/Co-worker) is disposable, any response resulting from an event must include a "Standardized Footer" so the host knows the state and the path to resume.

**Standard Response Footer:**
```
---
[CELLO MONITORING STATUS]
Status: Inactive
Action: To resume listening for Cello events, run: `npx @cello/receptionist --filter=VIP_ONLY`
```

## Watcher Logic Pattern

The Receptionist runs as a **subagent**. The main agent spawns it with instructions to run this script. When an event arrives, the subagent exits the loop and returns the result directly — no file, no workspace injection. The main agent handles the event and immediately spawns a fresh subagent to resume monitoring.

`cello inbox --scope all` JSON shape (empty inbox):
```json
{"ok":true,"scope":"all","agents":[{"agent":"AgentName","pending_session_requests":[],"unread":[],"total_unread":0,...}]}
```

An event is pending when any agent has `total_unread > 0` or a non-empty `pending_session_requests` array.

**Receptionist script:**
```bash
#!/bin/bash
while true; do
  RESULT=$(cello inbox --scope all 2>/dev/null)
  PENDING=$(echo "$RESULT" | jq '[.agents[] | select(.total_unread > 0 or (.pending_session_requests | length) > 0)] | length')
  if [ "$PENDING" -gt 0 ] 2>/dev/null; then
    echo "$RESULT"
    exit 0
  fi
  sleep 30
done
```

**Main agent loop (conceptual):**
1. Spawn subagent: "Run the receptionist script. When it exits, return its stdout."
2. Subagent blocks until an event arrives, then returns.
3. Main agent handles the event.
4. Go to step 1 — spawn a fresh subagent to resume monitoring.
