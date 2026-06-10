---
name: M6B-018-investigation-report
type: investigation
date: 2026-06-08
topics: [signaling, keepalive, reconnect, reliability, cross-repo, yamux, ping-pong, cello_status]
status: complete
description: >
  Deep investigation of the signaling stream keepalive and reconnect problem across
  cello-client and trustless-cello. Covers current lifecycle, ping/pong design,
  reconnect loop, Yamux config, directory-side changes, cello_status divergence,
  test infrastructure, observability, cross-repo deps, and risks. Based on code
  reading of the partially-landed M6B-017 state (SignalingManager extracted but
  client.ts call sites not yet wired).
---

# CELLO-M6B-018 Investigation Report: Signaling Stream Keepalive + Reconnect

## Update — 2026-06-10: Scope Revision After Fault Injection Investigation

**Read this before implementing from this document.**

A structured fault injection investigation (Scenarios 1–5, see
`discussion_logs/2026-06-10_1856_reconnect-cluster-findings.md`) and a
review of the libp2p primitives available in `createNode` (see
`discussion_logs/2026-06-10_2000_peer-reconnect-libp2p-primitives.md`)
have revised the understanding of this problem.

**What changed:**

1. **The root cause of the sleep/wake failure (Scenario 5) is not a dropped
   TCP connection — it is the bootstrap endpoint returning null at process
   startup.** When the laptop closes and Claude Code spawns a new cello-mcp
   process, the bootstrap fetch sometimes returns null in 9ms (reachable but
   empty). The process starts with `directory_reachable: false` and has no
   retry loop. `/mcp reconnect` always fixes it. The fix is a startup bootstrap
   retry loop (~10 lines), not a keepalive mechanism.

2. **The relay reconnect problem is separate and simpler than this document
   covers.** `onPeerDisconnect` already fires in `relay-node.ts` — it is
   wired only to a log line. Wiring it to call `registerWithDirectory()` with
   exponential backoff is ~15 lines using existing code. This eliminates the
   "restart relay after directory redeploy" operational rule without any
   changes to this story's scope.

3. **The ping/pong keepalive design below is still correct and still worth
   doing**, but it is the lowest priority of the four items. The 11-second
   Yamux detection lag is a production concern, not the cause of any observed
   failure.

**Revised priority order for M6B-018 implementation:**

1. Bootstrap retry on startup failure (new — not in this document below)
2. Unconditional reconnect on signaling stream close (Section C below — change
   the conditional seal-only 200ms one-shot to `#runReconnectLoop()`)
3. Relay `onPeerDisconnect` → re-register (new — add as AC to this story or
   as a companion story)
4. Ping/pong keepalive (Sections B–E below — still correct, lowest urgency)

The sections below remain valid as the design for items 2 and 4. Read the
linked discussion log for the full scope picture before writing the story YAML.

---

## Preamble: M6B-017 Status

**M6B-017 is partially implemented but not yet closed.** The commit `000a016` extracted `RegistrationManager` and `ConnectionManager`. The `SignalingManager` class exists in `signaling-manager.ts` and is instantiated in the constructor, but **`client.ts` never calls any of its methods**. All signaling call sites still invoke `this.#openPersistentSignalingStream()` and `this.#doOpenPersistentSignalingStream()` — private methods that remain in `client.ts`. There is a dual-implementation situation: `signaling-manager.ts` has a full `#doOpen` and `runPersistentSignalingReader` implementation, but the live code paths still go through the `client.ts` private methods.

**Implication for M6B-018:** The story must declare M6B-017 as a hard dependency, and the implementer must complete M6B-017's wiring before implementing M6B-018. The reconnect machinery lives in `SignalingManager.#doOpen` and the reader loop lives in `SignalingManager.#doRunPersistentSignalingReader`. These are the right homes. The `client.ts` duplicates must be deleted when M6B-017 closes.

---

## A. Current Signaling Stream Lifecycle

### Auth Sequence (confirmed exact)

1. Directory sends `signaling_auth_challenge` with 32-byte nonce
2. Client computes `SHA-256("CELLO-DIR-AUTH-v1" || nonce || pubkey)` and sends `signaling_auth_response { pubkey, signature }`
3. Directory verifies Ed25519 signature, sends `signaling_auth_ok`
4. Client sends `peer_info_announce { peer_id, multiaddrs }` — **this is the last step before the reader loop begins**

This is correct and complete as stated in the brief.

### What happens when `iter.next()` returns done today

The `#runPersistentSignalingReader` loop in `client.ts` (line 4383) breaks, clears `#persistentSignalingStream = null`, and runs cleanup that unblocks any pending resolvers with synthetic errors. It then checks for `sealing` or `seal_deferred` sessions and schedules a **200ms one-shot reconnect** via `setTimeout(() => void this.#openPersistentSignalingStream(), 200)` — but **only if there are pending seal sessions**. There is no reconnect for the general case (directory restarted with no active seal). After cleanup, the stream stays closed permanently unless another operation triggers `openPersistentSignalingStream`.

### What happens when the directory restarts

The directory closing its TCP socket causes `iter.next()` to throw (Yamux stream abort). The reader loop catches this in the outer `catch` block, exits, and clears `#persistentSignalingStream`. No reconnect fires unless there are pending seal sessions. The client is now silently disconnected — subsequent `cello_initiate_session` and `cello_request_connection` calls will call `#openPersistentSignalingStream()` inline (since those tool handlers check for a live stream), but **idle clients — those waiting for inbound connection requests or session assignments — have no mechanism to reconnect**.

### What happens when a laptop closes (SIGTERM vs abrupt)

**SIGTERM:** `cello-mcp` receives SIGTERM. The Node.js process receives it, libp2p connection closes cleanly, the directory's `#handleSignalingStream` `finally` block fires, removes the stream from `#streams`. On laptop wake, the PID lock file (M6B-001) kills the stale process and starts fresh — so a new clean connection is established on startup. No reconnect needed in this path.

**Abrupt close (lid shut, network loss, kill -9):** The TCP connection drops without a FIN. The directory's `for await ... lp.decode()` loop may not detect this immediately — it depends on Yamux keepalive. With `enableKeepAlive: true` at 30s, the Yamux ping eventually fails and the loop exits. On the client side: the Node.js process is dead. On resume, new process opens fresh stream. No reconnect needed here either from the **client** side (it's a new process). The problem is on the **directory side** — the old stream stays in `#streams` for up to 30s before Yamux detects the dead connection. The `#lastSeen` sweep solves the directory-side stale entry.

**The real reconnect problem** is the scenario where the client is alive but:
1. The network drops transiently (mobile network change, WiFi handoff)
2. The directory ECS task is replaced (happens during every deploy)
3. Yamux detects the dead connection, exits the loop, but the client process is still running and needs to reconnect

### `#openingSignalingStream` dedup guard

Located at `client.ts:4266-4279`. It is a promise-coalescing guard:
- If stream already open → return `Promise.resolve(true)`
- If open already in-flight → return the same in-flight promise
- Otherwise → start new open, store promise in `#openingSignalingStream`, clear it in `finally`

**Race condition analysis:** The guard is correct for the coalesce case, but there is a subtle race on reconnect: if caller A clears `#persistentSignalingStream = null` and calls `#openPersistentSignalingStream()`, while concurrently caller B also calls it, both will share the same in-flight promise. This is safe. **However:** after reconnect succeeds, if the stream immediately dies again, a second reconnect attempt can begin before the first reader loop has even registered the stream's closure — because `#runPersistentSignalingReader` is launched with `void`, and the `finally` clearing `#openingSignalingStream` has already run. This is **not a bug in the reconnect loop** but means the dedup guard only covers concurrent open attempts, not the reconnect loop itself. The reconnect loop (described below) needs its own dedup guard (`#reconnectSignalingInProgress: boolean`).

---

## B. Ping/Pong Frame Design

### CBOR frame format

The signaling protocol uses CBOR-encoded objects sent as length-prefixed frames via `it-length-prefixed`. The auth frames are the model:
- `{ type: "signaling_auth_challenge", nonce: Uint8Array }` — server→client
- `{ type: "signaling_auth_response", pubkey: Uint8Array, signature: Uint8Array }` — client→server
- `{ type: "signaling_auth_ok" }` — server→client

A ping/pong fits this pattern exactly:
- **Client → directory:** `{ type: "signaling_ping", seq: number }` — seq for correlation
- **Directory → client:** `{ type: "signaling_pong", seq: number }` — echoes client's seq

The `seq` field allows the pong resolver to verify it's answering the right ping (guards against a delayed pong from a previous cycle racing with a new ping). A monotonic counter incremented per-ping is sufficient.

### Where CBOR dispatch happens

In `signaling-manager.ts`, the reader loop calls `this.#ctx.dispatchSignalingFrame(stream, frame)` for every decoded frame. This dispatches to `CelloClientImpl.#dispatchSignalingFrame`, which routes by `frame["type"]`. The `pong` frame handler needs to be added to this dispatch table.

### Pong resolver pattern

The existing `#pendingSessionRequestResolve` pattern (a single nullable callback field, set before the await, cleared on receipt) is the model. For pong:

```typescript
// In CelloClientImpl (client.ts):
#pendingPingResolve: ((seq: number) => void) | null = null;
```

The `SignalingContext` interface needs to expose:
```typescript
getPendingPingResolve(): ((seq: number) => void) | null;
setPendingPingResolve(resolve: ((seq: number) => void) | null): void;
```

The dispatch case in `#dispatchSignalingFrame`:
```typescript
} else if (frame["type"] === "signaling_pong") {
  const seq = typeof frame["seq"] === "number" ? frame["seq"] : null;
  const resolve = this.#pendingPingResolve;
  if (resolve && seq !== null) {
    this.#pendingPingResolve = null;
    resolve(seq);
  }
}
```

### How the ping timer works in the reader loop

The ping timer is an interval that fires every 20s. It must run **alongside** the reader's `iter.next()` await using `Promise.race()`. The cleanest approach:

```typescript
// In SignalingManager.#doRunPersistentSignalingReader:
while (true) {
  const pingDeadline = Date.now() + PING_INTERVAL_MS;
  const timeUntilPing = pingDeadline - Date.now();
  
  let result: IteratorResult<Uint8Array>;
  try {
    result = await Promise.race([
      iter.next(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("ping_due")), timeUntilPing),
      ),
    ]);
  } catch (e) {
    if (e instanceof Error && e.message === "ping_due") {
      // Time to send a ping
      const pongArrived = await sendPingAndAwaitPong(stream, ctx);
      if (!pongArrived) {
        // Pong timeout — abort stream, let reconnect fire
        stream.abort(new Error("pong_timeout"));
        break;
      }
      continue; // resume reader loop
    }
    break; // real error — exit loop
  }
  // ... rest of frame dispatch
}
```

**Alternative (cleaner for testing):** Use a separate `AbortSignal` or a `#pingTimer` that calls a method on the manager. This keeps the reader loop cleaner. The chosen approach doesn't matter much — what matters is that the ping does not block the reader loop for the full 20s.

**Simpler approach:** Use `nextWithTimeout` at the 20s interval, catching the timeout specifically as a ping trigger. The `iter.next()` timeout fires → send ping → await pong with 5s timeout → if no pong, abort and break. This is effectively `Promise.race([iter.next(), pingTimer])` with clean error discrimination.

---

## C. Reconnect Loop Design

### Relay reconnect vs signaling reconnect

The relay reconnect (`#reconnectRelayStream`, `client.ts:2973`) uses:
- `deadline = Date.now() + 60_000` — hard 60s deadline
- `backoff = 200ms, ceil = 5_000ms`
- Dedup via `#reconnectInProgress: Set<string>` (keyed by sessionIdHex)
- Stops when session status != `transport_lost`

The signaling reconnect must differ on **deadline**: no deadline, indefinite retry. Everything else is the same pattern.

### Signaling reconnect loop structure

```typescript
// In SignalingManager (or a new method on it):
async #runReconnectLoop(): Promise<void> {
  if (this.#reconnectInProgress) return; // dedup guard
  this.#reconnectInProgress = true;
  let backoff = RECONNECT_INITIAL_BACKOFF_MS; // 2_000ms per brief

  try {
    while (true) {
      const opened = await this.openPersistentSignalingStream();
      if (opened) return; // success

      this.#ctx.logger.warn("signaling.reconnect.attempt.failed", { backoffMs: backoff });
      await new Promise<void>((r) => setTimeout(r, backoff));
      backoff = Math.min(backoff * 2, RECONNECT_MAX_BACKOFF_MS); // 5min ceiling
    }
  } finally {
    this.#reconnectInProgress = false;
  }
}
```

The brief specifies 2s floor and 5min ceiling — these are different from the relay reconnect's 200ms/5s. Use new constants: `SIGNALING_RECONNECT_INITIAL_BACKOFF_MS = 2_000`, `SIGNALING_RECONNECT_MAX_BACKOFF_MS = 300_000`.

**Where `#runReconnectLoop` is called:** From `onSignalingStreamClosed`, after the existing cleanup (unblock pending resolvers, check for seal sessions). Replace the current 200ms seal-only reconnect with an unconditional call to `void this.#runReconnectLoop()`.

### `#openingSignalingStream` interaction with reconnect loop

The `openPersistentSignalingStream()` method already handles the case where an open is in-flight (returns the existing promise). The reconnect loop calls this method, so if two reconnect attempts race, they naturally coalesce. The `#reconnectInProgress: boolean` guard on `#runReconnectLoop` prevents two independent reconnect loops from running concurrently. This is sufficient.

### After reconnect: `peer_info_announce` replay

`peer_info_announce` is sent as the last step in `#doOpen` (in `signaling-manager.ts`), which is called by `openPersistentSignalingStream()`, which is called by the reconnect loop. The full auth sequence replays on every reconnect attempt. This is automatic and correct — no extra work needed.

### After reconnect: pending `cello_request_connection` calls

When the stream dies, `ConnectionManager.unblockAllOnStreamClose()` is called from `#onSignalingStreamClosed`. All in-flight `cello_request_connection` calls receive a synthetic `connection_request_error` with `reason: "directory_unreachable"` and return to the LLM. After reconnect, the directory sends queued connection requests via the drain-on-reconnect path (PERSIST-019). New `cello_request_connection` calls can be made immediately after the stream is re-established — nothing needs to be reset.

**Out of scope for M6B-018:** automatic retry of tool calls that were in-flight at stream close. The user's LLM agent must re-issue the call. This is consistent with the current behavior and should be explicitly marked out-of-scope in the story.

### `#pendingConnectionRequestResolvers` cleanup

The cleanup happens in `unblockAllOnStreamClose()` (called from `onSignalingStreamClosed`). After reconnect, these resolver slots are empty. New `cello_request_connection` calls populate new resolver slots. No reset needed.

---

## D. Yamux Keepalive

### Current config

Both `createNode` in `cello-client/core/transport/src/node.ts` and the same function imported by `directory` use `yamux()` with **no arguments**. The `@chainsafe/libp2p-yamux@8.0.1` default config is:
```typescript
enableKeepAlive: true,   // ENABLED by default
keepAliveInterval: 30_000,  // 30 seconds
```

Both client and directory use the same `createNode` function from `@cello-protocol/transport`. The directory's `createDirectoryNode` calls `createNode` directly at line 3295.

### How to disable

Pass explicit config to `yamux()`:
```typescript
streamMuxers: [yamux({ enableKeepAlive: false })],
```

The `Config` interface accepts `enableKeepAlive?: boolean`. Setting it to `false` disables the built-in ping mechanism.

### Version mismatch risk

Both sides use `@chainsafe/libp2p-yamux@8.0.1` (pinned). Since the change is made in `createNode` in `@cello-protocol/transport` (which both sides import), the same code ships to both sides. **However:** the directory imports `@cello-protocol/transport` as a published npm package (`"^0.0.4"`), not as a workspace. After the transport change, a new version must be published and `directory/package.json` must be updated. If there is a window where the client has `enableKeepAlive: false` and the directory still has `enableKeepAlive: true` (old published version), the mismatch is **not a correctness issue** — Yamux keepalive is symmetric: if one side sends a ping and the other doesn't respond (because Yamux keepalive is off on that side), the pinging side may close the connection. But since **we are replacing Yamux keepalive with application-level ping** rather than disabling one side's keepalive before the other, the safe ordering is: deploy both sides together in one release, disabling Yamux keepalive in `transport@0.0.5` and handling application-level ping in the same story.

### Relay

The relay also uses `yamux()` with no args (`packages/relay/src/index.ts:77`). The relay's signaling streams are relay-admin streams (`/cello/directory-relay/1.0.0`), not the client-facing signaling stream. The `enableKeepAlive: false` change in `createNode` will affect relay libp2p connections too. This is safe — application-level keepalive replaces it for all long-lived streams in the CELLO protocol.

---

## E. Directory Side Changes

### Where `#handleSignalingStream` processes auth

`directory-node.ts:1029-1413`. The auth handshake is lines 1041-1121. After `signaling_auth_ok` is sent, the authenticated main loop begins at the `continue` on line 1241.

### The `#streams` map

`readonly #streams = new Map<string, Stream>()` at line 347. Keyed by `authedPubkeyHex`. Added on successful auth (line 1090), removed in the `finally` block (line 1363).

### Adding `#lastSeen` tracking

```typescript
readonly #lastSeen = new Map<string, number>(); // pubkeyHex → timestamp
```

Updated in `#handleSignalingStream` whenever a frame arrives from an authenticated client:
- After auth completes (line 1121): `this.#lastSeen.set(authedPubkeyHex, this.#clock.now())`
- After each frame in the authenticated loop: `this.#lastSeen.set(authedPubkeyHex!, this.#clock.now())`
- When responding to `signaling_ping`: update `#lastSeen` then send `signaling_pong`

On stream close (finally block): `this.#lastSeen.delete(authedPubkeyHex)`.

### 60s sweep timer

Uses `setInterval` in `start()`:
```typescript
const sweepInterval = setInterval(() => {
  const now = this.#clock.now();
  for (const [pubkeyHex, lastSeen] of this.#lastSeen) {
    if (now - lastSeen > SIGNALING_IDLE_SWEEP_MS) { // 60_000
      const stream = this.#streams.get(pubkeyHex);
      if (stream) {
        this.#logger?.info("signaling.client.swept", { pubkeyHex: pubkeyHex.slice(0, 16), idleMs: now - lastSeen });
        stream.abort(new Error("idle_sweep"));
        this.#streams.delete(pubkeyHex);
        this.#lastSeen.delete(pubkeyHex);
      }
    }
  }
}, SIGNALING_SWEEP_INTERVAL_MS); // 10_000 (check every 10s)
```

The sweep interval fires stored in the `start()` method alongside the signaling protocol handler registration. The interval ref must be cleared in a `stop()` method.

**Does `stop()` exist?** Checking the directory node — the `createDirectoryNode` function returns `{ stop: async () => { await node.stop(); } }`. The directory node itself doesn't have a `stop()` method that cleans up internal timers. This is a gap: the sweep timer must be cleared when the directory stops. The story must include an AC verifying the sweep timer is cleared on stop (or document that the test fixture calls `stop()` and verify no timer leaks).

### `#clock` / `TimeSource` pattern

`TimeSource` is imported at line 118, `#clock: TimeSource` is a field, set in the constructor at line 428: `this.#clock = opts.clock ?? WALL_CLOCK`. The `#lastSeen` timestamps must use `this.#clock.now()` — confirmed correct pattern. Tests can pass a deterministic clock.

### State cleanup when directory sweeps a client

When the sweep closes a stream via `stream.abort(new Error("idle_sweep"))`:
1. The `for await ... lp.decode(stream)` loop in `#handleSignalingStream` throws (stream aborted)
2. The `catch` block fires, logs `signaling.stream.error`
3. The `finally` block fires, removes from `#streams` (already removed by sweep), runs pending session cleanup

There is a race: the sweep deletes from `#streams` and `#lastSeen` before the `finally` block fires. The `finally` block checks `if (authedPubkeyHex && this.#streams.get(authedPubkeyHex) === stream)` before deleting — since the sweep already deleted it, this check fails and the `finally` block skips the delete. The pending session cleanup still fires. **This is safe** but the story should include a test verifying the double-delete-protection works.

---

## F. cello_status Divergence

### `mcp-server.ts` implementation (line 879-899)

```typescript
directoryReachable: directoryReachable()  // → node.getConnections().some(c => c.peerId === dirPeerId)
```
This checks libp2p **connection** existence, not stream liveness. A libp2p connection can exist while the signaling stream is dead (e.g. between stream close and reconnect). **Misleadingly optimistic.**

### `adapter-claude-code/src/server.ts` implementation (line 522-527)

```typescript
const directoryReachable = sessions.some(
  (s) => s.directory_endpoint && s.directory_endpoint.peer_id !== ""
);
```
This checks whether any session has a `directory_endpoint` — it is **always true after the first successful session** and is completely unrelated to current connectivity. **Wrong.**

### Divergence summary

Both are incorrect, in different ways. `mcp-server.ts` is closer to correct (at least checks live connection state) but still misleads during the reconnect window. Neither reflects actual signaling stream liveness.

### `signalingStream` field design

The new field should be:
```typescript
signalingStream: "connected" | "disconnected" | "reconnecting"
```

The three states map to:
- `"connected"` — `getPersistentSignalingStream() !== null && stream.status === "open"` AND auth completed (post-`peer_info_announce`)
- `"reconnecting"` — reconnect loop is running (`#reconnectInProgress === true`)
- `"disconnected"` — stream is null AND no reconnect in progress

**Is `#persistentSignalingStream !== null` sufficient for "connected"?** No. During `#doOpen`, there is a window between `this.#ctx.setPersistentSignalingStream(sigStream)` and `this.runPersistentSignalingReader(...)` where the stream ref is set but the reader hasn't started. More importantly, there is a window between stream close and `#onSignalingStreamClosed` clearing the ref. The safest approach: add a separate `#signalingStreamReady: boolean` flag set to `true` after `peer_info_announce` is sent, set to `false` in `onSignalingStreamClosed`. The `SignalingManager` exposes `getSignalingStatus(): "connected" | "reconnecting" | "disconnected"` that combines this flag with `#reconnectInProgress`.

### What `SignalingManager` should expose

```typescript
// In SignalingContext (and via signalingManager):
getSignalingStatus(): "connected" | "reconnecting" | "disconnected";
```

Both `mcp-server.ts` and `server.ts` call `client.getSignalingStatus()`, which is added to the `CelloClient` interface. Both `cello_status` implementations update to include `signalingStream: client.getSignalingStatus()` and remove the old `directoryReachable` logic (or keep it as a separate field — discussed in open questions).

**Shared interface completeness:** Both `mcp-server.ts` (package: `core/client`) and `server.ts` (package: `core/adapter-claude-code`) consume `signalingStream` status. The story must have ACs for both consumers explicitly. The `CelloClient` interface in `types.ts` must add `getSignalingStatus()`.

---

## G. Test Infrastructure

### No existing `injectSignalingDisconnect`

Confirmed by search: no such method exists anywhere. It must be added.

### What `injectSignalingDisconnect` must do

1. Call `stream.abort(new Error("test_inject_disconnect"))` on `#persistentSignalingStream`
2. Clear `#persistentSignalingStream = null` (or let the reader loop clear it — but the abort causes the reader to exit, which calls `onSignalingStreamClosed`, which does the cleanup)
3. The existing `#onSignalingStreamClosed` cleanup runs automatically

The simplest implementation:
```typescript
injectSignalingDisconnect(): void {
  const stream = this.#persistentSignalingStream;
  if (stream) {
    try { stream.abort(new Error("test_inject_disconnect")); } catch {}
    // Reader loop will exit and call onSignalingStreamClosed, which clears the ref
  }
}
```

This mirrors `injectRelayDisconnect`. It must be on the `CelloClient` interface and the `CelloClientImpl` class. It is also needed in `signaling-manager.ts` exposed via `SignalingContext`.

### Existing reconnect tests

`seal-reconnect.test.ts` and `seal-reconnect-responder.test.ts` are **unit tests** that exercise reconnect logic extracted from the client. They do not use real libp2p nodes. They test the `initiateSessionSeal` reconnect path and the responder seal reconnect path respectively. They use mock streams and mock `openSignalingStream` functions. This pattern is useful for the ping/pong unit tests.

### Test scenarios and coverage

| Scenario | Test approach | Guard needed |
|---|---|---|
| 1. Clean directory restart (stream closed by dir) | In-process: call `injectSignalingDisconnect()`, verify reconnect loop fires, verify `peer_info_announce` re-sent after reconnect | No `liveOnly` |
| 2. Pong timeout (directory too slow) | Unit test: mock `iter.next()` to block indefinitely, verify ping fires after 20s (use fake timers), verify stream aborted and reconnect scheduled | No `liveOnly` |
| 3. Directory 60s sweep closes idle client | In-process: create directory with injectable clock, advance clock past 60s, verify stream closed and `signaling.client.swept` logged | No `liveOnly` |
| 4. `cello_status` signalingStream field transitions | Unit test on status method directly | No `liveOnly` |
| 5. Network interruption / laptop sleep-wake | Not testable in-process; would require real OS-level network manipulation | `liveOnly` |

Scenarios 1-4 can all be tested in-process using `createSessionFixture()` extended with:
- `opts.injectSignalingDisconnect: boolean` — adds a helper method to the fixture
- The existing injectable clock in `DirectoryNodeOptions` handles scenario 3

**Scenario 5 (sleep/wake) is explicitly out-of-scope for this story.** The reconnect loop will handle it in production, but the E2E test cannot simulate it without OS-level primitives. Mark out-of-scope with a note.

### `liveOnly` guard

The existing `liveOnly = describe.skipIf(!process.env.CELLO_E2E_LIVE)` pattern in `mcp-002.test.ts` and `mcp-003-e2e.test.ts` is the model. The keepalive/reconnect tests **do not need `liveOnly`** because they use in-process nodes — no pre-registered agent identity or external directory required.

### E2E story question

Per the `/cello-story` rule: **Is there an existing E2E story that exercises the signaling stream keepalive?** No. The nearest is the general M6B close gate which verifies end-to-end session flow, but it doesn't explicitly test reconnect behavior. Given this story is entirely about infrastructure reliability (keepalive + reconnect), and the in-process tests with `injectSignalingDisconnect` can adequately verify the behavior, **a separate E2E story is not required**. The scenario "client reconnects after directory restart and successfully receives a session assignment" can be verified in-process using `createSessionFixture()` with controlled disconnect injection. The `/cello-story` rule about needing an E2E story applies to user-visible protocol flows (two agents exchanging messages) — reconnect infrastructure is an internal reliability mechanism testable in-process.

---

## H. Observability Requirements

### New events for the taxonomy

These events do not currently exist in the taxonomy:

**Client-side events (`package: client`):**
- `signaling.stream.opened` — level: info; trigger: persistent signaling stream authenticated and ready (after `peer_info_announce` sent); context_fields: `[directoryPeerId, myPubkeyHex (first 16 chars)]`; correlationId: false
- `signaling.ping.sent` — level: debug; trigger: client sends `signaling_ping` frame; context_fields: `[seq, directoryPeerId]`; correlationId: false
- `signaling.pong.timeout` — level: warn; trigger: no `signaling_pong` received within 5s; context_fields: `[seq, directoryPeerId, timeoutMs]`; correlationId: false — **this is the actionable event for detecting dead streams**
- `signaling.reconnect.started` — level: info; trigger: reconnect loop starts; context_fields: `[directoryPeerId, reason]` (reason: `"pong_timeout"` | `"stream_closed"` | `"idle_sweep"`); correlationId: false
- `signaling.reconnect.attempt.failed` — level: warn; trigger: single reconnect attempt fails; context_fields: `[directoryPeerId, attempt, backoffMs]`; correlationId: false
- `signaling.reconnect.succeeded` — level: info; trigger: stream successfully re-authenticated after a reconnect; context_fields: `[directoryPeerId, attemptCount, totalDurationMs]`; correlationId: false

**Directory-side events (`package: directory`):**
- `signaling.ping.received` — level: debug; trigger: directory receives `signaling_ping` from authenticated client; context_fields: `[pubkeyHex (first 16 chars), seq]`; correlationId: false
- `signaling.client.swept` — level: info; trigger: 60s idle sweep closes a client stream; context_fields: `[pubkeyHex (first 16 chars), idleMs]`; correlationId: false

### Events already in the codebase (not in taxonomy)

`signaling.stream.closed` and `signaling.stream.error` are logged in the directory but not in the taxonomy. The story should add them.

### CloudWatch alarms

- `signaling.pong.timeout` rate > 10% of clients over 5 minutes → `signaling-health` alarm. This catches systematic network issues vs transient disconnects.
- No alarm for `signaling.reconnect.attempt.failed` (transient failures are expected during directory deploys).
- `signaling.client.swept` rate > 50/minute over 5 minutes → `signaling-sweep` alarm (indicates clients are not sending pings — possible client bug or widespread network issue).

---

## I. Cross-Repo Dependency Chain

### Packages modified in `cello-client`

1. **`core/transport`** — `yamux({ enableKeepAlive: false })` in `node.ts`
2. **`core/client`** — `SignalingManager` gains ping timer, reconnect loop, `injectSignalingDisconnect`, `getSignalingStatus()`; `CelloClient` interface gains `getSignalingStatus()` and `injectSignalingDisconnect()`; `SignalingContext` gains `getPendingPingResolve` / `setPendingPingResolve` and `getSignalingStatus()` / `setSignalingStatus()`; `mcp-server.ts` updates `cello_status`
3. **`core/adapter-claude-code`** — `server.ts` updates `cello_status`

### Version bump chain

Since `core/transport` changes, `core/client` must bump `@cello-protocol/transport` dependency. Since `core/client` changes, `core/adapter-claude-code` must bump `@cello-protocol/client` dependency. `@cello-protocol/connect` (adapter-claude-code) is the top of the chain.

Current published beta versions:
- `@cello-protocol/transport@beta` = `0.0.4` → must become `0.0.5`
- `@cello-protocol/client@beta` = `0.0.21` → must become `0.0.22`
- `@cello-protocol/connect@beta` = `0.0.31` → must become `0.0.32`

### `trustless-cello` updates needed

`packages/directory/package.json` currently has `"@cello-protocol/transport": "^0.0.4"` and `"@cello-protocol/client": "^0.0.20"`. After this story:
- Must update to `"@cello-protocol/transport": "^0.0.5"`
- Must update to `"@cello-protocol/client": "^0.0.22"`
- Run `pnpm install` to update lockfile
- **The Yamux keepalive disable in `transport` will take effect on the directory too** — which is what we want

Both the cross-repo ACs from `/cello-story` apply: AC-version-bump and AC-trustless-cello-dependency-update.

---

## J. Risk Assessment

### Risk 1: Ping fires during active FROST ceremony — **Medium risk, but math confirms safe**

The math:
- Ping fires every 20s (client → directory)
- Pong timeout is 5s
- FROST ceremony: `ceremony_request` → client runs ceremony → `ceremony_result` (typically 1-3s in practice)
- Even in pathological cases (slow client device), FROST ceremonies complete in well under 20s

**Scenario:** client sends ping at T=0. At T=2, FROST ceremony starts (directory sends `ceremony_request`). Client reader loop handles `ceremony_request` as a frame dispatch. At T=20, ping fires. The `Promise.race([iter.next(), pingTimer])` races between the next frame (which might be a ceremony-related frame from the directory) and the ping timer. If the ceremony is already complete, the pong arrives cleanly. If the ceremony is still running (rare for a 20s ceremony), the ping fires, the client sends `signaling_ping`, and the directory must handle it while also running the FROST ceremony.

**Directory handling:** The directory's `#handleSignalingStream` loop processes frames sequentially in the `for await` loop. The `signaling_ping` frame arrives and the directory must handle it. Since the ping handler (`signaling_ping` → `signaling_pong`) is synchronous (no awaits needed — just send the pong frame), it will not deadlock or delay the ceremony. The ceremony runs via a separate `void this.#handleCeremonyRequest(stream, frame)` that was dispatched earlier. The pong will be sent even while a ceremony is pending.

**Conclusion:** No risk of spurious reconnect mid-ceremony, provided the pong handler is non-blocking.

### Risk 2: Reconnect loop and `#openingSignalingStream` guard interaction — **Low risk**

The reconnect loop calls `openPersistentSignalingStream()` which checks `#openingSignalingStream`. If two reconnect loops somehow fire concurrently (the `#reconnectInProgress: boolean` guard prevents this), the second call coalesces onto the first's promise. The dedup is correct. The `#reconnectInProgress` flag is the outer guard; `#openingSignalingStream` is the inner guard for the open itself. No interaction risk.

### Risk 3: 60s directory sweep safety — **Safe, confirmed by math**

Client sends ping every 20s. Worst case: ping fires at T=0, pong arrives, next ping fires at T=20s. Directory must see activity within 60s. Since the client sends at least one frame every 25s (20s interval + 5s worst-case delay), the 60s sweep threshold gives >2x headroom. The math holds even under moderate congestion.

**Edge case:** What if the client is connected and only receives frames (never sends)? A client that is purely reactive (no outbound tool calls, no connection requests, just waiting for inbound assignments) will send a ping every 20s. This is the primary case the keepalive solves. No risk.

### Risk 4: `stop()` timer leak — **Medium risk, needs AC**

The directory does not have an explicit `stop()` method that cleans up internal timers. The sweep interval must be stored and cleared. The story must add `this.#sweepInterval = setInterval(...)` in `start()` and `clearInterval(this.#sweepInterval)` in a new `stop()` method or in `createDirectoryNode`'s returned `stop` lambda. **This is a gap that the story must address explicitly.**

### Risk 5: M6B-017 completion dependency — **High impact, explicit dependency**

M6B-017's `SignalingManager` extraction is partially done: the class exists and is instantiated, but call sites in `client.ts` still use the private methods. M6B-018 **depends on M6B-017 being fully wired** before implementation begins. The ping timer, reconnect loop, and `getSignalingStatus()` all belong in `SignalingManager`. If M6B-017 is not fully closed, the implementer will have to choose: (a) add the new functionality to the dead `client.ts` private methods, or (b) complete M6B-017's wiring as the first step of M6B-018. Option (b) is correct. The story should state this explicitly.

---

## Open Questions for Human Decision

**1. `directoryReachable` backward compatibility**

`cello_status` currently returns `directory_reachable: boolean`. Should the story: (a) replace it with `signaling_stream: "connected" | "disconnected" | "reconnecting"`, or (b) keep `directory_reachable` for backward compatibility and add `signaling_stream` as an additional field? Option (b) is safer for any operator tooling that parses `cello_status` output. **Decision needed before writing the story.**

**2. Ping seq counter placement**

The ping seq counter is a monotonic counter per-stream (or per-SignalingManager lifetime). It should reset to 0 on each reconnect, or be a lifetime counter. Which? Lifetime counter is simpler. **No semantic consequence — either is fine. Default to lifetime counter unless instructed otherwise.**

**3. Sweep interval frequency**

The sweep checks every 10s for the 60s threshold (giving at most 10s of extra grace on top of the 60s threshold). Is 10s acceptable, or should it be more frequent (e.g. 5s)? At 10s the actual max idle before sweep is 70s. **Probably fine — not a hard requirement. Default to 10s.**

**4. `stop()` pattern for directory**

The directory doesn't currently have a `stop()` method. The sweep timer needs to be cleared. Should it be added to `CelloDirectoryNode` as a `stop()` method, or added to the `createDirectoryNode` returned `stop` lambda? The latter is simpler and consistent with the existing pattern. **Default: add to `createDirectoryNode`'s returned `stop` lambda.**

---

## Scope Items Explicitly Out-of-Scope

1. **Automatic retry of in-flight tool calls on reconnect.** `cello_request_connection` that was in-flight when the stream died returns `directory_unreachable`. The user's LLM must re-issue. Not in scope.
2. **Sleep/wake E2E test.** OS-level network simulation not testable in-process. Mark out-of-scope in the story with `liveOnly` note.
3. **Dead per-session directory streams.** `signaling-manager.ts` has a `connectDirectorySignalingStream` method for per-session streams. This is called by M0 flows. These streams also have no keepalive. Out-of-scope for this story — they will be evaluated in a separate cleanup story.
4. **Relay Yamux keepalive.** The relay's signaling streams to directory are relay-admin (`/cello/directory-relay/1.0.0`). These are short-lived per-seal streams, not persistent. The `enableKeepAlive: false` change in `createNode` affects the relay's libp2p connections but the relay doesn't maintain a long-lived persistent stream. No action needed for the relay beyond the `createNode` change.

---

## Ordering Dependencies

1. **M6B-017 must be fully closed (all call sites wired to `SignalingManager`)** before M6B-018 begins. If M6B-017 is not closed, the implementer should treat completing M6B-017's wiring as the first step of M6B-018.
2. **No other M6B stories are prerequisites.** M6B-018 is independent of M6B-004 (ECS LoadBalancers), M6B-006 (relay transport key), etc.
3. The story touches `core/transport` (Yamux config), which also affects relay behavior. Coordinate with any story that is simultaneously modifying `createNode`. None are in the current M6B pipeline.

---

## Session Fixture Extension Needed

The existing `session-fixture.ts` in `trustless-cello/packages/e2e-tests/src/` does not expose any mechanism to simulate signaling stream disconnect. The story must extend the fixture with:

```typescript
opts.injectSignalingDisconnect?: { agentIndex: 0 | 1 }
// Returns a helper method on the fixture that calls injectSignalingDisconnect()
// on the specified agent's CelloClient
```

This is an `opts` field addition with a non-breaking default (undefined = no inject method returned). The fixture extension is not a separate story — it is part of M6B-018's acceptance criteria, as the `/cello-story` rule requires.

---

## Summary

What an implementer needs:

1. Complete M6B-017 wiring (all `client.ts` signaling call sites delegated to `SignalingManager`)
2. Add `signaling_ping` / `signaling_pong` frame handling in `SignalingManager` and `directory-frames.ts` + `directory-node.ts`
3. Add ping timer to reader loop using `Promise.race`
4. Add 5s pong timeout
5. Add `#runReconnectLoop` method in `SignalingManager`
6. Wire it from `onSignalingStreamClosed` (replace the conditional 200ms seal-only reconnect with unconditional `#runReconnectLoop`)
7. Add `#lastSeen` map to directory with 60s sweep interval (using `#clock.now()`)
8. Add `getSignalingStatus()` to `CelloClient` interface and both `cello_status` implementations
9. Extend session fixture with `injectSignalingDisconnect` helper
10. Write tests for all in-process scenarios
11. Bump `transport@0.0.5`, `client@0.0.22`, `connect@0.0.32`
12. Update `trustless-cello` `packages/directory/package.json` and `packages/relay/package.json` dependencies
