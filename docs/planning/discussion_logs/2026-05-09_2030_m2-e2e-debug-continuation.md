---
name: M2 E2E Debug — Continuation Context (superseded)
type: discussion
date: 2026-05-09 20:30
topics: [M2, e2e, debug, cello-mcp, directory-unreachable, peer-info-announce, stable-peer-id]
description: Initial debug context document for M2 E2E failures. The stale-stream hypothesis below was wrong — actual root causes were missing peer_info_announce, unstable Peer IDs, and relay pubkey not configured. See M2-frost-threshold-layer.md for the real resolution.
---

# M2 E2E Debug — Continuation Context

## What we are trying to do

Run two real Claude Code agents having a CELLO M2 conversation:
- Relay node (separate process)
- Directory node (separate process)  
- Agent A MCP server (separate process, `~/.cello/key`)
- Agent B MCP server (separate process, `~/.cello/key-agent-b`)

## Current state of infrastructure

All three infrastructure processes are running correctly:

**Relay** (started by user from Terminal 1):
```
/ip4/127.0.0.1/tcp/4001/p2p/12D3KooWPxBgrpmRpL2MF89FdZqGz5CPefJEe9yUKYEyFWTcjVYE
```

**Directory** (started by user from Terminal 2):
```
/ip4/127.0.0.1/tcp/4002/p2p/12D3KooWLvmPRJqyP82SmmW6iWQKKqTXEKtuF4Qg9tKY2FvVWEtp
```
Directory pubkey: `2357394bbe85dd03adfdc8232ae5b8c8bfa8785d36914982ec26357107793ff1`

**Agent MCP servers** (started with correct env vars):
- PID 86068: `key-agent-b`, dir=`12D3KooWLvm...` ✓
- PID 86281: `key`, dir=`12D3KooWLvm...` ✓

Both MCP servers have the correct directory multiaddr. Both bootstrapped FROST successfully at startup (verified via stderr logs showing "FROST bootstrap OK").

## The actual bug

`cello_initiate_session` returns `directory_unreachable`.

**Root cause (identified by Agent A's own diagnosis):** The `#persistentSignalingStream` in the client holds a stale stream reference. The guard at the top of `#openPersistentSignalingStream` (`if (this.#persistentSignalingStream) return Promise.resolve(true)`) returns true without checking whether the stream is still alive. The stream was opened at MCP startup, but died sometime after (possibly due to the directory being restarted during earlier debugging sessions). Now `initiateSession` calls `#openPersistentSignalingStream`, gets `true` back (stale stream looks open), tries to send on the dead stream, throws, returns `directory_unreachable`.

**Evidence:**
- FROST bootstrap succeeded at startup (log shows "FROST bootstrap OK")
- `cello_status()` works fine (doesn't use the signaling stream)
- Fresh connections to the directory work (a test node can dial and auth successfully)
- The signaling stream check `if (this.#persistentSignalingStream) return true` short-circuits without verifying liveness

## The fix needed

In `packages/client/src/client.ts`, in `#doOpenPersistentSignalingStream`:

```typescript
// Current (wrong):
if (this.#persistentSignalingStream) return Promise.resolve(true);

// Fix: also check stream is still open
if (this.#persistentSignalingStream && 
    this.#persistentSignalingStream.status === "open") {
  return Promise.resolve(true);
}
// If stream exists but is closed/reset, clear it and re-open
this.#persistentSignalingStream = null;
this.#persistentSignalingIter = null;
```

The `Stream` interface from `@libp2p/interface` has a `status` property: `"open" | "closing" | "closed" | "reset" | "abort"`. Check it before returning true.

## What to do in the new session

1. Apply the fix above to `packages/client/src/client.ts`
2. Run `pnpm run typecheck` and `pnpm run test` — must stay green
3. Rebuild: `pnpm --filter @cello/adapter-claude-code run typecheck`
4. **Do not restart relay or directory** — they are running correctly
5. Kill the current agent MCP processes (PIDs 86068 and 86281)
6. Relaunch agents with the correct env:
   ```bash
   # Agent B:
   export NODE_ENV=test CELLO_KEY_FILE=/Users/andrep/.cello/key-agent-b CELLO_DIRECTORY_MULTIADDR=/ip4/127.0.0.1/tcp/4002/p2p/12D3KooWLvmPRJqyP82SmmW6iWQKKqTXEKtuF4Qg9tKY2FvVWEtp && claude
   
   # Agent A:
   export NODE_ENV=test CELLO_KEY_FILE=/Users/andrep/.cello/key CELLO_DIRECTORY_MULTIADDR=/ip4/127.0.0.1/tcp/4002/p2p/12D3KooWLvmPRJqyP82SmmW6iWQKKqTXEKtuF4Qg9tKY2FvVWEtp && claude
   ```
7. Run `/cello-chat` in each session

## What has been built (commits on main since this session started)

- `CELLO-NODE-004`: `/cello/directory-relay/1.0.0` network protocol — directory talks to relay over the network (no more in-process stub)
- `CELLO-E2E-003`: backfill story + tests for the wire protocol
- Single-identity MCP server reverted from dual-identity (commit `334e0af`)
- `ceremony_request`/`ceremony_result` protocol for FROST ceremony delegation
- Error pass-through fixes in `initiateSession`

## Key file locations

- Client signaling stream logic: `packages/client/src/client.ts` around line 2500 (`#doOpenPersistentSignalingStream`)
- MCP server binary: `packages/adapter-claude-code/src/bin/cello-mcp.ts`
- `/cello-chat` skill: `.claude/commands/cello-chat.md`
- CELLO-NODE-004 story: `docs/planning/user-stories/m1/CELLO-NODE-004.yaml`

## Important note on process management

The **relay and directory must not be restarted** — they are running correctly. The directory's peer ID (`12D3KooWLvm...`) is stable across restarts only if `~/.cello/directory-key` exists. If the directory is restarted, the agent sessions must also be restarted with the new peer ID.

The bug is purely in the client code — fixing it and relaunching the agent processes is all that's needed.
