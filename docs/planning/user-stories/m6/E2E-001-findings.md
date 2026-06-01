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
