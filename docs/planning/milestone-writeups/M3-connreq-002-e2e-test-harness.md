---
name: M3 — CONNREQ-002 E2E Test Harness Rewrite
type: design
date: 2026-05-11
topics: [milestone, M3, connection-request, session-006, e2e, test-harness, relay, round-2]
status: active
description: How the E2E test harness was rebuilt to exercise real protocol paths for CONNREQ-002 and SESSION-006, and the seven failures that exposed gaps between stub-based tests and wire-level reality.
---

# M3 — CONNREQ-002 E2E Test Harness Rewrite

**Completed:** 2026-05-11  
**Stories:** CELLO-CONNREQ-002, CELLO-SESSION-006  
**Final test count:** 164 tests passing (15 test files, `@cello/client` package)

---

## The Problem

The E2E test file (`e2e-connreq-002-session-006.test.ts`) was designed to exercise the full connection request ceremony and session establishment over real libp2p nodes, a real relay, and a real directory. The initial implementation used stubs and shortcuts inherited from M1/M2 test patterns. Seven tests failed — not because the protocol logic was wrong, but because the test harness assumed in-process shortcuts that don't exist on the wire.

This writeup documents what broke, why, and what the harness looks like now.

---

## What Was Fixed

### 1. Real relay instead of stub

**Before:** `makeE2EFixture` used a fake `makeRelay()` — a no-op object satisfying the `RelayAdapter` interface. The directory had no actual relay to route `leaf_deliver` frames through, so `receiveMessage` could never work.

**After:** Replaced with `createRelayNode()` — a real relay process. The relay's peer ID and listen address are passed to `createDirectoryNode` so session assignments include real relay coordinates that clients can dial.

**Why it matters:** Without a real relay, session establishment "succeeds" (the directory creates the assignment) but the data path is dead. Messages sent via `sendMessage` go nowhere because there's no relay stream to write `leaf_deliver` frames to.

---

### 2. Multi-session relay routing

**Before:** The relay stores one stream per pubkey in its `#streams` map. When a client opens two sessions (AC-007), both sessions share the same relay stream. The original `#runRelayStreamReader` assumed all `leaf_deliver` frames on that stream belonged to its own session — it used the reader's `sessionIdHex` to route incoming hashes.

**After:** Extract the `session_id` field from each `leaf_deliver` frame and route to the correct session's pending hash map. The reader no longer assumes ownership of all frames on the stream.

```typescript
} else if (frame["type"] === "leaf_deliver") {
  const deliverSessionId = frame["session_id"];
  // ... coerce to Uint8Array ...
  const targetSessionHex = deliverSessionId
    ? Buffer.from(deliverSessionId).toString("hex")
    : sessionIdHex; // fallback for legacy frames
  this.#handleInboundLeafDeliver(targetSessionHex, frame, myPubkeyHex);
}
```

**Why it matters:** Without this, the second session's messages get routed to the first session's hash map and are never matched to their content frames. Both sessions appear dead.

---

### 3. `receiveMessage` consumption inside `waitFor`

**Before:**
```typescript
await waitFor(() => clientB.receiveMessage(sessionId) !== null, ...);
const msg = clientB.receiveMessage(sessionId); // null — already consumed!
```

`receiveMessage` is destructive (pops from queue). Calling it inside `waitFor`'s predicate consumed the message on the iteration that returned `true`, leaving nothing for the subsequent assertion.

**After:** Capture the result inside the callback:
```typescript
let received = null;
await waitFor(() => {
  received = clientB.receiveMessage(sessionId);
  return received !== null;
}, { timeout: 10_000, interval: 100 });
expect(received).not.toBeNull();
```

**Why it matters:** A classic destructive-read-inside-predicate bug. The test appeared to prove "message never arrives" when in fact the message arrived and was immediately discarded.

---

### 4. Round 2 disclosure resolver routing

**Before:** After `cello_request_connection` returns `{ result: "disclosure_requested" }`, the `#pendingConnectionRequestResolve` slot is consumed (set to null). When A later calls `cello_respond_to_disclosure_request`, it registers a resolver in `#pendingDisclosureResolvers`. But the persistent signaling reader's frame router only checked `#pendingConnectionRequestResolve` for `connection_established` frames — the disclosure resolvers were never consulted.

**After:** Added a fallback in the frame router for both `connection_established` and `connection_rejected`/`connection_insufficient`: if `#pendingConnectionRequestResolve` is null, iterate `#pendingDisclosureResolvers` and resolve the first pending entry.

```typescript
const resolve = this.#pendingConnectionRequestResolve;
if (resolve) {
  this.#pendingConnectionRequestResolve = null;
  resolve(frame);
} else {
  // Round 2: route to disclosure resolver if pending
  for (const [id, disclosureResolve] of this.#pendingDisclosureResolvers) {
    this.#pendingDisclosureResolvers.delete(id);
    disclosureResolve(frame);
    break;
  }
}
```

**Why it matters:** Without this, `cello_respond_to_disclosure_request` hangs forever — it waits for a frame that arrives but is never routed to it.

---

### 5. Round 2 auto-disclosure implementation

**Before:** The test policies used `review_mode: "inference"` which causes `evaluateConnectionPackage` to return `pending_agent_review` (holds for human/agent review, never auto-responds). The test waited for an auto-response that would never come.

**After:** Changed to `review_mode: "deterministic"` which returns `auto_insufficient` when requirements are unmet. Then implemented the actual auto-disclosure path in `#handleInboundConnectionRequest`: when verdict is `auto_insufficient` and `round2TimeoutMs > 0`, B sends a `disclosure_request` frame and starts a timeout timer that auto-rejects if A doesn't respond.

**Why it matters:** `inference` mode is for the MCP tool layer where a human or LLM decides. `deterministic` mode is for automated policy enforcement — which is what the E2E test exercises.

---

### 6. Policy type change: endorsement → pseudonym_age

**Before:** AC-003/AC-004 used `endorsement` requirements (`min_count: 1`). Testing endorsements requires real ML-DSA signed endorsement objects — heavyweight and orthogonal to what these tests prove (Round 2 flow mechanics).

**After:** Switched to `pseudonym_age` requirements (`min_age_days: 1` and `min_age_days: 3`). This only requires a `created_at` timestamp in the pseudonym binding, which `buildMinimalPackageCbor` already supports via a `createdAt` parameter:

- AC-003: Round 1 package has `created_at = now` (0 days old, fails >= 1 day). Round 2 package has `created_at = 2 days ago` (passes).
- AC-004: Round 1 package has `created_at = now` (fails >= 3 days). Round 2 package has `created_at = 1 day ago` (still fails).

**Why it matters:** Tests should exercise the mechanism (Round 2 flow) not the specific signal type. Using `pseudonym_age` isolates the disclosure flow from the complexity of endorsement creation and ML-DSA signing chains.

---

### 7. DB-001 reconnect race

**Before:** The test called `registerHandler()` (which opens the persistent signaling stream, triggering queue delivery from the directory) and then immediately called `reconnectDirectory()` (which aborts that stream and opens a new one). The abort killed the first stream before the queued `connection_request_inbound` could be fully processed — B never received `connection_established` back from the directory.

**After:** Removed the redundant `reconnectDirectory()` call. `registerHandler()` already authenticates with the directory, which triggers dequeue and delivery of the pending connection request. The test just needs to wait for B's `listConnections()` to populate.

**Why it matters:** `reconnectDirectory()` is for the case where a stream dies unexpectedly. Calling it immediately after `registerHandler()` creates a race between "directory delivers queued frame" and "client aborts stream." In production this race doesn't exist because reconnection only happens after a failure, not immediately after successful auth.

---

### 8. B's connection record timing (AC-003)

**Before:** After Round 2 accept, the test asserted B's connections synchronously:
```typescript
const bConns = fix.clientB.listConnections();
expect(bConns.find(...)).toBeDefined(); // fails — frame hasn't arrived yet
```

A gets `connection_established` synchronously (via the disclosure resolver). But B receives it asynchronously — the directory sends it to B's stream, and B's reader processes it on the next event loop iteration.

**After:** Added `waitFor` on B's connection list:
```typescript
await waitFor(
  () => fix.clientB.listConnections().find(c => c.connection_id === id) !== undefined,
  { timeout: 5_000, interval: 50 }
);
```

**Why it matters:** In a real multi-party protocol, "both sides have the connection" doesn't mean "both sides have it at the same instant." The initiator gets confirmation as a direct response; the target gets it as an asynchronous notification.

---

## Lessons Learned

1. **Stubs that satisfy an interface are not stubs that exercise the protocol.** `makeRelay()` had the right shape but no behavior. The test passed typecheck but proved nothing about data delivery.

2. **Destructive reads in predicates are silent bugs.** Any `waitFor(() => queue.pop() !== null)` pattern will consume the value on success. Always capture inside the callback.

3. **One stream per pubkey means multiplexed sessions.** Relay routing must use per-frame session_id, not per-reader session_id. This is the same architectural pattern as HTTP/2 stream multiplexing.

4. **`deterministic` vs `inference` is a critical test design choice.** Inference mode introduces an external decision-maker that tests can't drive without mocking the LLM layer. Deterministic mode is the correct choice for protocol flow tests.

5. **Async notifications require `waitFor`, not synchronous assertions.** Whenever a frame must traverse directory → stream → reader → handler, there is at least one event loop tick of latency. Tests that assert immediately after the trigger will be flaky or broken.

6. **`registerHandler()` already opens the signaling stream.** Calling `reconnectDirectory()` immediately after is a no-op at best and a race condition at worst. The stream is already live.

---

## Test Architecture After Rewrite

```
makeE2EFixture():
  ├── createRelayNode()           ← real relay (libp2p node, /cello/relay/1.0.0)
  ├── createDirectoryNode()       ← real directory (InMemoryDirectoryStore, FROST, relay ref)
  ├── createNode() × 2           ← real libp2p nodes for agents A and B
  ├── bootstrapKeyShares()        ← real FROST key shares (2-of-3)
  ├── FrostThresholdSigner        ← real ceremony coordinator
  ├── createClient() × 2         ← full client with policy, signer, timeout config
  └── register() × 2             ← real directory registration (DKG ceremony)

All connections are real TCP (127.0.0.1:0 ephemeral ports).
All frames are real CBOR over length-prefixed libp2p streams.
No mocks, no stubs, no in-process shortcuts.
```
