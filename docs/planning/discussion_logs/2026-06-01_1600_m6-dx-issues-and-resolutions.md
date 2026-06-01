---
name: M6 DX Issues and Resolutions — E2E-001 Verification Session
type: discussion
date: 2026-06-01
topics: [DX, UX, registration, onboarding, MCP, FROST, cello-client, m6, E2E]
description: >
  Running discussion log from the M6-E2E-001 stranger flow verification session.
  Documents every DX issue discovered when actually running the stranger flow
  against production infrastructure, and the agreed resolution for each.
  This log is the authoritative context for CELLO-M6-DX-001.
---

# M6 DX Issues and Resolutions

## Context

This log covers the M6-E2E-001 stranger flow verification session (2026-06-01).
Andre Pemmelaar (operator) ran the stranger flow against production infrastructure
while Claude Code (AI) monitored and diagnosed. Every friction point, failure, and
DX gap was documented. Resolutions were agreed interactively before being written
into [[CELLO-M6-DX-001]].

The full findings list is at [[E2E-001-findings]].

---

## Issue 1: cello_register requires phone_stub — a parameter strangers don't have

**Discovered:** AC-003 — `cello_register` required `phone_stub` as a required parameter.

**Problem:** A stranger receiving a token from the Telegram bot has no idea what
`phone_stub` means. It's an internal implementation detail. The directory doesn't
even validate it against the token — it accepts whatever the client sends.

**Agreement:** Remove `phone_stub` from the MCP tool schema entirely. The client
sends an empty string internally. The directory already ignores the value for
authorization purposes (it just checks non-empty). The parameter formerly named
`pre_auth_token` is renamed to `token` — simpler, more natural, matches what the
bot says ("here is your token").

**Resolution in story:** AC-006.

---

## Issue 2: npx install exceeds Claude Code's 30s MCP connection timeout

**Discovered:** AC-001 — first `npx @cello-protocol/connect@0.0.8` failed because
SQLCipher native compilation took 42 seconds. Claude Code's MCP timeout is 30s.

**Problem:** Claude Code gives 30 seconds for MCP server startup. SQLCipher requires
compilation from source on first install because @journeyapps/sqlcipher@^6.0.0
doesn't ship pre-built binaries (v6 dropped them). This is a hard deadline miss on
first install for any new user.

**Agreement:** Fix via lazy startup (F-015): the MCP server must start and register
tools immediately without waiting for the directory connection. SQLCipher compilation
(which happens during the first npm install, not at runtime) is a separate issue —
address by noting the requirement in README and platform-specific error messages.
The MCP server itself must not block tool registration on network or compilation.

**Resolution in story:** AC-009 (lazy startup).

---

## Issue 3: bootstrap endpoint unreachable — port 9090 not exposed via ALB

**Discovered:** AC-003 — `GET /bootstrap` returned "Only WebSocket connections are
supported." The health server on port 9090 was not routed through the ALB.

**Problem:** Port 9090 (health server, where /bootstrap lives) was not exposed via
the ALB. Port 8080 is the libp2p WebSocket listener and only accepts WebSocket
upgrades. Plain HTTP GET /bootstrap never reached the health server.

**Fix applied (infrastructure, not client):** Added BootstrapTargetGroup (port 9090)
and BootstrapPathRule (priority 4, path /bootstrap) to the ALB. The ECS service
was recreated as DirectoryService (LogicalId rename) to add a second LoadBalancers
entry since ECS doesn't allow updating LoadBalancers on an existing service.

**Resolution in story:** Not a client story item — infrastructure was fixed directly.
AC-003 in CELLO-M6-DX-001 covers the client-side fix (directoryNodes wired).

---

## Issue 4: Every unregistered tool call fails silently with no guidance

**Discovered:** General observation throughout AC-003 to AC-004.

**Problem:** Calling any cello_* tool before registering returns a raw error with
no guidance. A stranger calling `cello_send` before registering gets `not_registered`
with no explanation of what to do next.

**Agreement:** Every tool that requires registration checks registered state first.
If unregistered, returns a human-readable message: "Not registered. Call
cello_setup_guidance() for the full setup guide." No tool that requires registration
should silently fail or return a cryptic error.

**Resolution in story:** AC-004.

---

## Issue 5: No setup guidance tool — LLM doesn't know what to do

**Discovered:** General observation — when Claude Code first encounters the CELLO
MCP tools, there's no entry point that explains the full flow.

**Problem:** The LLM sees 22 tools with no onboarding context. It doesn't know
where to start, what order to call them, or what the demo agent ID is.

**Agreement:** Add `cello_setup_guidance` tool. Always returns the full 6-step guide
(never collapsed), followed by current status and a pointer to the next step.
The guide covers: get token from Telegram, register, request connection, initiate
session, send/receive, close and get receipt. Includes the demo agent ID.

Key design decision: the FULL GUIDE is always shown. Never collapse steps based on
current state. Show everything, then at the bottom say where the user currently is.
Transparency over brevity.

**Resolution in story:** AC-005, AC-004 (unregistered guidance references this tool).

---

## Issue 6: Registration token exposed in chat history

**Discovered:** AC-003 — the token was pasted directly into Claude Code chat.

**Problem:** Tokens in Claude Code chat history are visible to anyone with access
to the conversation log. For a security protocol this is a bad look — the token
is a single-use credential.

**Agreement:** F-005 — documented as a finding but deferred from DX-001 as it
requires a new file-based config mechanism (~/.cello/config.json) that is a
larger UX design decision. SI-001 in the story covers: the token must never appear
in logs, error messages, or MCP tool responses.

**Resolution in story:** SI-001.

---

## Issue 7: cello_request_connection requires raw 64-char pubkey — strangers know agent_id

**Discovered:** AC-004 — the tool required `target_pubkey` (64 hex chars) but the
README publishes the demo agent's `agent_id` (32 hex chars).

**Problem:** A stranger reads the README, copies `a2c55e2721f45cfa86cb3417a76e3f7b`,
passes it to `cello_request_connection` — and it fails because the tool only accepts
the raw Ed25519 pubkey.

**Agreement:** Both `cello_request_connection` and `cello_initiate_session` accept
either format. Detection is by length: 32 chars = agent_id (requires directory lookup
to resolve to pubkey), 64 chars = raw pubkey (used directly). The agent_id is the
primary user-facing identifier. Raw pubkey is kept for backward compatibility.

**Resolution in story:** AC-007.

---

## Issue 8: connection_request_in_flight with no cancel or retry

**Discovered:** AC-004 — after a failed connection attempt, subsequent calls returned
`connection_request_in_flight` indefinitely (300s timeout).

**Problem:** 300-second monolithic timeout. No feedback during the wait. User has
no idea what stage it's at. No way to cancel or retry. If the first attempt fails
for any reason, the user is locked out for 5 minutes.

**Agreement:** Per-stage timeouts instead of one monolithic wait:
- Dial directory: 10s → "Could not reach directory."
- Send connection request: 10s → "Connection request not delivered."
- Wait for target to respond: 90s → "Target agent did not respond. May be offline."

Each stage emits what it's doing before it starts waiting. Total worst case ~110s.
Agreed values: 10s/10s/90s. These are network-dependent — if too tight in practice,
adjust. The problem was silence, not duration.

**Resolution in story:** AC-008.

---

## Issue 9: MCP server startup blocks Claude Code — silent hang on first install

**Discovered:** AC-001 — MCP server connection timed out (30s) because of network
operations on startup.

**Problem:** `cello-mcp` currently does on startup, sequentially, before any tools
are registered:
1. Fetch /bootstrap from directory
2. Dial directory over libp2p
3. Attempt FROST bootstrap
All blocking. If any step is slow, Claude Code gives up.

Every other MCP tool (GitHub, filesystem, databases) registers tools in <1s.

**Agreement:** Lazy startup. MCP server starts, registers all tools immediately.
Directory connection happens in background. Tools that need the directory wait up
to 10s for the background connection to complete. `cello_status` reports connection
state: connecting/connected/failed.

**Resolution in story:** AC-009.

---

## Issue 10: FROST signer not wired with directoryNodes after restart

**Discovered:** AC-005 — `cello_initiate_session` returned `directory_below_threshold`
after MCP server reconnect, even though registration was successful.

**Root cause confirmed by code inspection:**

In `client.ts`, `loadPersistedState()` reconstructs the FrostThresholdSigner at line 664:
```typescript
this.#thresholdSigner = new FrostThresholdSigner(
  {
    threshold: row.threshold,
    participants: row.participants,
    directoryNodes: undefined,  // ← BUG
  },
  Buffer.from(myPubkeyHex, "hex"),
);
```

`directoryNodes: undefined` means the signer can verify signatures (verification
doesn't need directory nodes) but cannot PARTICIPATE IN CEREMONIES (which requires
routing round-trip frames to the directory over libp2p). When the directory sends a
`ceremony_request` frame to the client, the client has no directory nodes to send
the `ceremony_result` back through. Hence `directory_below_threshold`.

The fix: pass `directoryNodes` populated from the current `directoryEndpoint` when
reconstructing the signer in `loadPersistedState()`. The `directoryEndpoint` is
available at startup (fetched from /bootstrap or configured via env var).

**Agreement:** Fix `loadPersistedState()` to pass directoryNodes. Test requires two
processes: process A registers (DKG runs), process A exits, process B starts fresh
from same key+DB, process B calls `cello_initiate_session` and succeeds. No in-memory
state transfer. This proves the persistence contract end-to-end.

**Resolution in story:** AC-003.

---

## Issue 11: TTY detection — running binary directly causes silent hang

**Discovered:** Pre-AC-001 — running `npx @cello-protocol/connect` in a terminal
hangs silently (waiting for MCP JSON-RPC on stdin).

**Agreement:** Detect `process.stdin.isTTY`. If true, print install instructions and
exit cleanly:
"This is a CELLO MCP server. Install with:
  claude mcp add cello npx @cello-protocol/connect
Then restart Claude Code."

**Resolution in story:** AC-002.

---

## Issue 12: No startup progress visible

**Discovered:** Throughout — the MCP server starts silently. No indication of what's
happening. On slow networks or first install, the user sees nothing for many seconds.

**Agreement:** Emit progress to stderr at each startup step before the step begins,
and emit outcome on completion. Steps: database open, bootstrap fetch, directory dial,
state load, final ready/registered status. This is visible in Claude Code's MCP
server output panel and in /tmp/cello-mcp-stderr.log.

Example:
```
cello: starting...
cello: opening database... ok (V2, 18 tables)
cello: fetching directory address... ok (12D3KooW...)
cello: connecting to directory... ok
cello: loading agent state... ok
cello: ready (registered as 00a71840...)
```

**Resolution in story:** AC-001.
