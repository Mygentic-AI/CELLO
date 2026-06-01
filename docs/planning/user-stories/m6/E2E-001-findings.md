---
name: M6-E2E-001 DX Findings
type: findings
date: 2026-06-01
topics: [DX, UX, registration, onboarding, security, MCP]
description: Running log of DX issues found during M6-E2E-001 stranger flow verification. Each must be fixed before @latest promotion.
---

# M6-E2E-001 — DX Findings Log

Running log. Each item must be resolved before AC-008 (@latest promotion).

---

## F-001: phone_stub should not be a user-facing parameter

**Found:** AC-003 — `cello_register` requires `phone_stub` (required field in MCP schema).

**Problem:** A stranger has no idea what phone_stub means. The directory doesn't even validate it against the token — it stores whatever the client sends. The token already identifies the account.

**Fix:** Remove `phone_stub` from the client-facing MCP schema. The directory should resolve it from the consumed pre-auth token's `phone_stub_hash` in `#pendingPreAuthData`.

---

## F-002: npx install exceeds Claude Code's 30s MCP connection timeout

**Found:** AC-001 — first `npx @cello-protocol/connect@0.0.8` timed out because SQLCipher native compilation took 42 seconds.

**Problem:** Claude Code gives 30 seconds for MCP server startup. SQLCipher compilation from source takes longer than that on first install.

**Fix options:**
- Switch to `better-sqlite3` (pre-built binaries, no compilation) — eliminates the problem entirely
- Or: pre-install globally before adding the MCP server (workaround, not a real fix)
- Or: investigate lazy-loading SQLCipher so the MCP server starts immediately and compiles in background

---

## F-003: bootstrap endpoint was unreachable (ALB routing gap)

**Found:** AC-003 — `GET /bootstrap` returned "Only WebSocket connections are supported".

**Problem:** Port 9090 (health server) was not exposed via ALB. Required a separate target group + listener rule.

**Status:** FIXED. BootstrapTargetGroup + BootstrapPathRule (priority 4) deployed. ECS service recreated as DirectoryService to add second LoadBalancers entry.

---

## F-004: every cello_* tool should give guidance when not registered

**Found:** General observation during AC-003.

**Problem:** If you try to use any cello tool before registering, it fails with no guidance. Should tell the user: "You haven't registered yet. To register, message @CelloConnectStagingBot on Telegram, complete verification, and you'll receive a CELLO token. Then call cello_register."

**Fix:** Every tool that requires registration should check status first and return actionable guidance on how to register.

---

## F-005: token should not be pasted into chat (security exposure)

**Found:** AC-003 — the token was pasted directly into Claude Code chat.

**Problem:** Tokens in chat history are visible to anyone with access to the conversation log. For a security protocol this is a bad look.

**Fix:** On install or first run, create a config file (e.g. `~/.cello/config.json`) with a placeholder:
```json
{ "registration_token": "PASTE_YOUR_CELLO_TOKEN_HERE" }
```
Open it for the user. They paste the token, save, and `cello_register` reads from the file. Token never appears in chat. Guidance should explicitly say: "Do NOT paste your token into chat."

---

## F-006: add `cello_setup_guidance` tool

**Found:** General observation.

**Problem:** When an LLM first encounters the CELLO MCP tools, it doesn't know what to do. There's no onboarding tool.

**Fix:** Add a `cello_setup_guidance` tool that returns step-by-step instructions:
1. If not registered: go to Telegram, get token, save to config file, call cello_register
2. If registered but no connections: here's how to connect to another agent
3. If registered with connections: you're good, here are the available tools

This gives the LLM a clear entry point when it sees the CELLO tools for the first time.

---

## F-007: Windows not supported in beta

**Found:** Pre-AC-001 — `@journeyapps/sqlcipher@^6.0.0` has `os: ['darwin', 'linux']`.

**Problem:** Windows users are completely blocked. npm install fails.

**Status:** Documented in README. Platform-aware error message added to `cello-mcp.ts`. Real fix deferred (switch to `better-sqlite3` or wait for journeyapps to restore Windows support).

---

## F-008: no startup progress visible to user

**Found:** AC-001 — MCP server starts silently, no indication of what's happening.

**Problem:** Stranger sees nothing during the ~10 second startup. No feedback on: connecting to directory, building database, loading state.

**Fix:** Emit visible progress to stderr:
- "Connecting to directory..."
- "SQLCipher database: creating new / opening existing"
- "Agent status: unregistered / registered as <id>"
- "CELLO ready."

---

## F-009: TTY detection — running binary directly hangs silently

**Found:** Pre-AC-001 — `npx @cello-protocol/connect` in a terminal hangs waiting for MCP JSON-RPC on stdin.

**Problem:** A stranger who runs the binary directly (instead of via `claude mcp add`) gets a silent hang with no explanation.

**Fix:** Detect `process.stdin.isTTY` — if true, print install instructions and exit:
"This is an MCP server. Install with: claude mcp add cello npx @cello-protocol/connect"

---

## F-010: cello_request_connection requires raw pubkey, not agent_id

**Found:** AC-004 — tool schema has `target_pubkey` (64-char hex) but the story says "connect with the demo agent's AgentID".

**Problem:** A stranger knows the demo agent's agent_id (published in README) but not its raw K_local pubkey. No directory lookup tool exists to resolve agent_id → pubkey.

**Fix:** Accept `target_agent_id` as an alternative parameter. When provided, the client calls a directory lookup to resolve it to a pubkey before requesting the connection.

---

## F-011: Directory loses all agent profiles on restart (critical)

**Found:** AC-004 — `target_not_found` for the demo agent after directory service recreation.

**Problem:** `PgDirectoryStore` uses in-memory Maps for profile lookups but never loads existing profiles from PostgreSQL at startup. After any restart, every previously registered agent is invisible until they re-register. This affects ALL agents, not just the demo agent.

**Root cause:** The `setProfile()` method writes to both DB and memory, but the constructor doesn't read from DB. A restart starts with empty Maps.

**Hotfix applied:** Added `loadProfiles()` method to `PgDirectoryStore` that reads all active `agent_profiles` rows at startup. Called from both local and production composition root paths.

**Broader issue (tracked separately):** The directory holds ~15 in-memory Maps/Sets. Many of these (threshold signers, primary pubkeys, delegated signers, session participants) also don't survive restarts. A full audit of directory restart-state persistence is needed as a dedicated story. The question to answer: "what breaks for a connected client that didn't restart when the directory does?"

---

## F-012: agent_id not persisted to agent_profiles table

**Found:** During F-011 hotfix — loadProfiles() crashed with `column "agent_id" does not exist`.

**Problem:** `agent_id` is generated at registration time and stored in the in-memory AgentProfile object, but the `agent_profiles` INSERT never writes it to the DB. It's lost on restart.

**Workaround:** On startup, derive a stable stand-in from SHA-256(k_local_pubkey).

**Fix:** Add `agent_id TEXT NOT NULL` column to `agent_profiles` table and write it during registration.

---

## F-013: connection_request_in_flight with no cancel or retry mechanism

**Found:** AC-004 — after a failed connection attempt, subsequent calls return `connection_request_in_flight` indefinitely.

**Problem:** No way to cancel an in-flight request. No timeout visible to the user. No retry mechanism. User is stuck until the request times out server-side (unknown duration). Dismal UX.

**Fix:** 
- Add `cello_cancel_connection_request({ target_pubkey })` tool
- Show timeout remaining in `cello_status`  
- Auto-expire in-flight requests after a reasonable timeout (e.g. 30s) with a clear error

---

## F-014: directory transport key not persisted — peer ID changes on every restart

**Found:** AC-004 — after pipeline deploy, directory got a new peer ID, breaking all connected clients.

**Problem:** Directory generates a new libp2p transport key on every startup (`"implementation":"generated"`). Every deploy invalidates every client's cached peer ID. Clients need to re-bootstrap on every directory restart.

**Fix:** Persist the transport key in Secrets Manager or SSM Parameter Store so it survives restarts. This is part of the broader F-011 restart-state audit.

---

## F-015: cello-mcp does too much at startup — blocks MCP server registration

**Found:** Throughout AC-001 to AC-004 — MCP server times out on first install (42s compile + network), requires reconnect after directory restarts, feels slow every new Claude session.

**Problem:** `cello-mcp` currently does on startup:
1. Compile SQLCipher (first install)
2. Open SQLCipher DB
3. Fetch `/bootstrap` from directory
4. Dial directory over libp2p
5. Attempt FROST bootstrap

All of this blocks the MCP server from responding to Claude Code's tool registration. Every other MCP tool (GitHub, filesystem, databases) starts in <1s because they don't do network operations at startup.

**Fix:** Lazy startup. `cello-mcp` should:
1. Start immediately, register all tools
2. Connect to directory in background
3. On `cello_status`: return current connection state (connecting/connected/failed)
4. On any tool that requires directory: await background connection with a timeout, return clear status if not ready

Users should never see a timeout or hang when Claude Code starts. The connection happens in the background and tools report their readiness state clearly.
