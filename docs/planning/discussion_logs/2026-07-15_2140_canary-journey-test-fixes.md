---
name: canary-journey-test-fixes
type: discussion
date: 2026-07-15
topics: [m10, DOD-ZEROBUMP-CANARY-1, DOD-T2-JOURNEY-1, spine-tests, consortium-manifest]
status: in-progress
description: Fixing the j-canary and j-trust-journey spine tests — daemon ordering + manifest routing
---

# Canary & Journey Test Fixes — 2026-07-15

## What is done

Two commits on main:

1. **f817fae3** — `fix(e2e): start daemon before create-agent in spine journey tests`
   - Root cause: `cello create-agent` requires daemon IPC. Tests called it before `startDaemon`.
   - Fix: reorder both j-canary and j-trust-journey to start daemons first.

2. **9a3261e7** — `fix(e2e): add consortium manifest to journey tests for same-node routing`
   - Root cause: without a manifest, `signaling.currentDirectoryNodeId` is null. `classifyOnlineResult` then
     routes ALL sessions through the cross-node path, where `resolveConsortiumRoster()` returns null →
     `discovery_node_unresolvable`.
   - Fix: start cluster with `directoryNodeKeyHex: AUTH_DIRECTORY_NODE_KEY_HEX`, write a manifest, pass
     `manifestEnv` to every `startDaemon` call.

## What is next — the remaining failure

After both fixes, the canary test gets past:
- `gitClean` proof anchor (PASS)
- `create-agent` (PASS — daemons running)
- `waitConnected` (PASS — daemons connect to directory with step-6)

But **`register-agent` exits 1** (line 154: `expect(...status).toBe(0)`). This is the DKG registration step.

### Hypothesis for next session

With step-6 enabled, the daemon verifies the directory's challenge signature during the DKG signaling
handshake. If the directory's step-5 signature doesn't match the manifest's pubkey for node "local", the
daemon rejects the connection and registration fails. The `directoryNodeKeyHex` is set on the cluster
(so the directory DOES sign), and the manifest uses `trustedDirectoryNode()` (which references
`AUTH_DIRECTORY_NODE_PUBKEY` — the corresponding public key). So in theory they should match.

Possible causes to investigate:
- The daemon's challengeVerifier may need the manifest loaded BEFORE it connects (it loads on startup
  from the file path in `CELLO_CONSORTIUM_MANIFEST`). The daemon starts, connects, then the manifest
  path is available — but if the daemon reads it lazily vs eagerly, timing matters.
- The DKG may go through a different code path than a normal session (different signaling manager
  or a pre-auth flow) where the manifest isn't consulted.
- `register-agent` (the CLI command) may spawn its own short-lived process that doesn't inherit the
  manifest env. Check how `cello register-agent` communicates with the daemon — if it's IPC, the
  daemon already has the manifest. If it spawns a child, the child may not.

### Alternative: don't enable step-6 for the canary

The canary test proves ZERO-BUMP (no code changes for a new signal type). It doesn't need to prove
step-6 auth. The ONLY reason we added the manifest was for same-node routing in `cello_initiate_session`.

A lighter fix: configure the daemon to know its home node WITHOUT full step-6. Check if there's a way to
set `currentDirectoryNodeId` without manifest verification (e.g. a `CELLO_HOME_NODE_ID` env var or
similar). If not, the correct fix is making the manifest + DKG co-operate.

## DOD-T2-JOURNEY-1 status

Marked ✅ at b48254aa based on a prior run. That run likely succeeded because vitest ran all spine tests
in batch (the j-auth test sets up manifests) or the local daemon was accessible. The j-trust-journey test
now has the same manifest fix and needs re-verification. Re-running it is part of the next session's work.

## Files

- `packages/e2e-tests/src/spine/j-canary.spine.test.ts` — committed, needs the registration fix
- `packages/e2e-tests/src/spine/j-trust-journey.spine.test.ts` — committed, needs re-verification
- `packages/e2e-tests/src/spine/live-harness.ts` — unmodified (harness already had all needed exports)
