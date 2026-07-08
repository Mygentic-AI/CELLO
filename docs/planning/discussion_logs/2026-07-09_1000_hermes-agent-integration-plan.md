---
name: Hermes Agent Native Integration Plan
type: planning
date: 2026-07-09
topics: [hermes, integration, mcp, webhooks, plugin, onboarding]
description: >
  Investigation and implementation plan for integrating CELLO natively with Hermes Agent.
  Outlines why we bypass MCP for conversational routing, the API Server + Plugin Hook architecture,
  and the zero-friction installation UX (CLI command + Skill).
---

# Hermes Agent Native Integration Plan

## 1. Background & Investigation

As part of our soft beta launch testing (M8C/M9), we need to prove CELLO works with an agent runtime other than Claude Code. We investigated integrating with **Hermes Agent**.

**Initial Assumption:** Build an MCP server wrapper so Hermes can use CELLO as a tool.
**Decision:** Reject MCP for the primary conversation path. 

**Why:** MCP is designed for capability discovery and structured tool invocation (e.g., "read this file", "query this database"). It is *not* optimized for bidirectional conversational semantics, session ID preservation, or message ordering. To treat Hermes as a native participant in a CELLO A2A thread, we need to integrate at the conversation router level, not the tool layer.

**Core Constraint:** We must not require any modifications to the Hermes Agent core repository (zero PRs to upstream). We must only use Hermes' publicly exposed extension surfaces (Webhooks, API Server, Plugins, Hooks).

## 2. Recommended Architecture: API Server + Plugin Hooks

To achieve a flawless, native conversation bridge without touching core Hermes code, we will use a **push-push** model using Hermes' API Server for ingress and a custom Plugin for egress.

*   **Ingress (CELLO → Hermes):**
    When the CELLO daemon receives a message addressed to the local Hermes agent, it maps the `cello_conversation_id` to a `hermes_session_id` (e.g., `cello-<id>`). It then POSTs the message to the Hermes built-in API Server: `POST http://localhost:8000/api/sessions/{session_id}/chat`. This natively wakes up Hermes, loads its memory, and triggers an LLM turn.
*   **Egress (Hermes → CELLO):**
    We will drop a tiny Hermes Plugin into the user's `~/.hermes/plugins/cello/` folder. This plugin listens to the Hermes `post_llm_call` lifecycle hook. When Hermes generates a final response in a `cello-*` session, the hook passively intercepts the response and POSTs it back to the local CELLO daemon's internal listener (`http://localhost:3000/internal/hermes-egress`). The daemon sends it out to the network.

## 3. User Experience (Onboarding)

We want onboarding to be frictionless for existing Hermes users. We will support two parallel paths:

### Path A: The CLI Installer
Users who are comfortable in the terminal will use our client CLI:
```bash
cello install hermes [--hermes-home /custom/path]
```
This command will:
1. Locate the Hermes home directory (respecting `HERMES_HOME` env var or falling back to `~/.hermes`).
2. Scaffold the plugin folder: `$HERMES_HOME/plugins/cello/`.
3. Drop the `plugin.yaml` and `__init__.py` (the hook payload) into the folder.
4. Ensure the `api_server` platform is enabled in the user's `config.yaml`.
5. Prompt the user to restart the Hermes gateway.

### Path B: The Hermes Skill (Agent-led Setup)
We will publish a `SKILL.md` (e.g., `cello-bridge-setup`). Users can drop this into their Hermes skills directory.
*   **Trigger:** "Hey Hermes, install the CELLO bridge."
*   **Action:** Hermes reads the skill, verifies the `cello` CLI is installed (or installs it via npm), and automatically runs the `cello install hermes` command on the user's behalf. 

## 4. Implementation Steps

To move from plan to implementation, we need to execute the following tasks:

### Step 1: Add the CLI command to `cello-client`
Add the `install hermes` subcommand to the `cello-client/core/cli`.
*   **Requirement:** It must safely parse `HERMES_HOME` or accept a `--hermes-home` flag to support multi-profile users.
*   **Requirement:** It writes the Python egress hook to disk.

### Step 2: Implement the Egress Hook Payload
The payload written by the CLI installer will be:
```python
import httpx
import logging

logger = logging.getLogger("plugins.cello")
CELLO_DAEMON_URL = "http://localhost:3000/internal/hermes-egress"

async def handle_cello_egress(session_id: str, assistant_response: str, **kwargs):
    if not session_id.startswith("cello-"):
        return
    cello_convo_id = session_id[6:]
    try:
        async with httpx.AsyncClient() as client:
            await client.post(
                CELLO_DAEMON_URL,
                json={"conversation_id": cello_convo_id, "message": assistant_response},
                timeout=10.0
            )
    except Exception as e:
        logger.error(f"[CELLO] Egress failed: {e}")

def register(ctx):
    ctx.register_hook("post_llm_call", handle_cello_egress)
```

### Step 3: Author the `SKILL.md`
Create the `cello-bridge-setup` skill containing the step-by-step shell commands for Hermes to bootstrap the CELLO environment.

### Step 4: Update the CELLO Daemon
1.  **Ingress Router:** Update the daemon's routing logic. If the local agent is designated as "Hermes", route incoming A2A messages to `http://localhost:8000/api/sessions/cello-{conversation_id}/chat`.
2.  **Egress Listener:** Expose `POST /internal/hermes-egress` on the local daemon to accept payloads from the Hermes Python plugin and queue them for trustless network broadcast.

---
*Status: Ready for Implementation.*