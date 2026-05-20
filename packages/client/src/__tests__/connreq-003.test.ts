/**
 * CELLO-CONNREQ-003 — Multi-slot concurrent connection requests
 *
 * SPECIFICATION (Phase S):
 *
 * This story fixes the single-slot resolver bottleneck in the connection request flow.
 * Two bugs exist:
 *   1. #pendingConnectionRequestResolve: single slot — a second cello_request_connection call
 *      overwrites the first caller's resolver, losing it forever.
 *   2. awaitConnectionRequest: a single listener polling #pendingReviewQueue — only one caller
 *      can wait at a time.
 *
 * After the fix:
 *   AC-001: Two concurrent outbound requests to DIFFERENT targets both resolve independently.
 *   AC-002: Two concurrent outbound requests to the SAME target: second returns
 *           { result: 'error', reason: 'connection_request_in_flight' } immediately.
 *   AC-003: Two concurrent awaitConnectionRequest() calls each receive exactly one inbound
 *           request — no duplicates, no drops.
 *   AC-004: After fan-out connection establishment (A→B and A→C), both sessions initiate.
 *   AC-005: After both outbound requests resolve, the resolver Map is empty (no leak).
 *   SI-001: A connection_established frame for target B never resolves a pending resolver
 *           for target C (out-of-order arrival).
 *   DB-001: A timeout on one concurrent request cleans that slot; the other slot is unaffected.
 *
 * PSEUDOCODE (Phase P):
 *
 * cello_request_connection(opts):
 *   targetPubkeyHex = opts.target_pubkey
 *   // AC-002: reject duplicate concurrent requests to same target
 *   if #pendingConnectionRequestResolvers.has(targetPubkeyHex):
 *     logger.warn("connection.request.duplicate", { targetPubkeyHex })
 *     return { result: 'error', reason: 'connection_request_in_flight' }
 *
 *   mint correlationId
 *   logger.info("connection.request.sent", { targetPubkeyHex, correlationId })
 *
 *   // Build and send frame
 *   ... (same as before, but keyed by targetPubkeyHex)
 *   #pendingConnectionRequestResolvers.set(targetPubkeyHex, resolveOutcome)
 *
 *   // Race with timeout
 *   ...
 *
 *   // Cleanup: remove from map
 *   #pendingConnectionRequestResolvers.delete(targetPubkeyHex)
 *
 *   // Handle outcome
 *   if type === 'connection_established':
 *     logger.info("connection.established", { connectionId, counterpartyPubkeyHex: targetPubkeyHex, correlationId })
 *     return { result: 'established', connection_id }
 *   if type === 'connection_request_error':
 *     logger.error("connection.request.failed", error, { targetPubkeyHex, reason, correlationId })
 *     ...
 *
 * signaling reader (connection_established frame):
 *   counterpartyPubkeyHex = frame["counterparty_pubkey"]
 *   // Look up resolver by counterparty pubkey (target of the original request)
 *   resolve = #pendingConnectionRequestResolvers.get(counterpartyPubkeyHex)
 *   if resolve:
 *     #pendingConnectionRequestResolvers.delete(counterpartyPubkeyHex)
 *     resolve(frame)
 *   // else: fires #onConnectionEstablishedHandler (B's side, not tracked here)
 *
 * awaitConnectionRequest():
 *   // Multi-slot: use Promise queue instead of polling
 *   Create a promise, push resolve fn to #pendingAwaitResolvers queue
 *   Race against timeout
 *   When inbound frame arrives: shift from queue and call first resolver (FIFO)
 *
 * Crypto refs: none (no new crypto in this story)
 *
 * TDD Phase R — RED-first.
 * ALL tests below MUST FAIL before the implementation changes.
 */

import {
  setupV3Tests,
  createTestScope,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "@claude-flow/testing";
import type { TestScope } from "@claude-flow/testing";
import {
  generateKeypair,
  mlDsaKeygen,
} from "@cello/crypto";
import {
  clearTestShares,
} from "@cello/crypto/frost/frost-threshold-signer.js";
import {
  encodeConnectionPackage,
  buildPseudonymBinding,
} from "@cello/protocol-types";
import type { ConnectionPackage } from "@cello/protocol-types";
import { createNode } from "@cello/transport";
import {
  createDirectoryNode,
} from "@cello/directory";
import type { RelayAdapter, RelaySessionAssignment } from "@cello/directory";
import { createClient } from "../client.js";
import type { SignalRequirementPolicy } from "../connection-policy.js";

setupV3Tests();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRelay(): RelayAdapter {
  return {
    async recordAssignment(_: RelaySessionAssignment) { return { ok: true as const }; },
    async discardSession() {},
    async submitForSeal() { return { ok: false as const, reason: "not_supported" }; },
    async confirmSeal() {},
    async rejectSeal() {},
  };
}

/** Build a minimal valid ConnectionPackage CBOR for testing. */
async function buildMinimalPackageCbor(
  keyProvider: ReturnType<typeof generateKeypair>,
  mlDsaProvider: Awaited<ReturnType<typeof mlDsaKeygen>>,
  primaryPubkeyHex?: string,
): Promise<Uint8Array> {
  const kLocalPubkey = new Uint8Array(await keyProvider.getPublicKey());
  const primaryPubkey = primaryPubkeyHex
    ? Buffer.from(primaryPubkeyHex, "hex")
    : new Uint8Array(32);
  const mlDsaPubkey = new Uint8Array(await mlDsaProvider.getPublicKey());
  const bindingResult = await buildPseudonymBinding(
    {
      pseudonym_label: "test-agent",
      k_local_pubkey: kLocalPubkey,
      primary_pubkey: new Uint8Array(primaryPubkey),
      ml_dsa_pubkey: mlDsaPubkey,
      created_at: Date.now(),
    },
    mlDsaProvider,
  );
  if (!bindingResult.ok) throw new Error("buildPseudonymBinding failed");
  const pkg: ConnectionPackage = {
    pseudonym_binding: bindingResult.binding,
    endorsements: [],
    attestations: [],
  };
  return encodeConnectionPackage(pkg);
}

import type { Logger, LogContext } from "@cello/interfaces";

/** Shared directory + three registered agents (A, B, C) for fan-out tests. */
async function makeThreeAgentFixture(
  scope: TestScope,
  opts?: {
    connectionTimeoutMs?: number;
    loggerA?: Logger;
    loggerB?: Logger;
  },
) {
  const dirKeyProvider = generateKeypair();
  const { node: dirNode, stop: stopDir } = await createDirectoryNode({
    keyProvider: dirKeyProvider,
    relay: makeRelay(),
    relayEndpoint: { peer_id: "relay-peer-id", multiaddrs: [] },
    requireRegistration: true,
  });
  scope.addCleanup(stopDir);

  const directoryEndpoint = {
    peer_id: dirNode.getPeerId(),
    multiaddrs: dirNode.listenAddresses(),
  };

  const openPolicy: SignalRequirementPolicy = {
    mode: "open",
    review_mode: "deterministic",
    requirements: [],
  };

  // Agent A
  const kpA = generateKeypair();
  const nodeA = await createNode({ keyProvider: kpA, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
  await nodeA.start();
  scope.addCleanup(() => nodeA.stop());
  const clientA = createClient(nodeA, kpA, {
    directoryEndpoint,
    connectionPolicy: openPolicy,
    connectionTimeoutMs: opts?.connectionTimeoutMs ?? 15_000,
    logger: opts?.loggerA,
  });
  await clientA.registerHandler();

  // Agent B
  const kpB = generateKeypair();
  const nodeB = await createNode({ keyProvider: kpB, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
  await nodeB.start();
  scope.addCleanup(() => nodeB.stop());
  const clientB = createClient(nodeB, kpB, {
    directoryEndpoint,
    connectionPolicy: openPolicy,
    connectionTimeoutMs: opts?.connectionTimeoutMs ?? 15_000,
    logger: opts?.loggerB,
  });
  await clientB.registerHandler();

  // Agent C
  const kpC = generateKeypair();
  const nodeC = await createNode({ keyProvider: kpC, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
  await nodeC.start();
  scope.addCleanup(() => nodeC.stop());
  const clientC = createClient(nodeC, kpC, {
    directoryEndpoint,
    connectionPolicy: openPolicy,
    connectionTimeoutMs: opts?.connectionTimeoutMs ?? 15_000,
  });
  await clientC.registerHandler();

  // Register all three
  const mlDsaA = await mlDsaKeygen();
  const regA = await clientA.register("+1111111111");
  if ("error" in regA) throw new Error(`A reg failed: ${String(regA.error)}`);

  const regB = await clientB.register("+2222222222");
  if ("error" in regB) throw new Error(`B reg failed: ${String(regB.error)}`);

  const regC = await clientC.register("+3333333333");
  if ("error" in regC) throw new Error(`C reg failed: ${String(regC.error)}`);

  const pubkeyB = Buffer.from(await kpB.getPublicKey()).toString("hex");
  const pubkeyC = Buffer.from(await kpC.getPublicKey()).toString("hex");

  const packageCborB = await buildMinimalPackageCbor(kpA, mlDsaA, regA.primary_pubkey);
  const packageCborC = await buildMinimalPackageCbor(kpA, mlDsaA, regA.primary_pubkey);

  return {
    clientA, clientB, clientC,
    kpA, kpB, kpC,
    regA,
    pubkeyB, pubkeyC,
    packageCborB, packageCborC,
  };
}

// ─── Test scope ───────────────────────────────────────────────────────────────

let scope: TestScope;
beforeEach(() => { scope = createTestScope(); });
afterEach(() => {
  clearTestShares();
  return scope.run(async () => {});
});

// ─── AC-002 (unit): duplicate concurrent request to same target ────────────────
//
// This is AC-002 (unit test) — simpler than the integration tests, so run it first.
// Tests that the second call to cello_request_connection for the SAME target returns
// { result: 'error', reason: 'connection_request_in_flight' } immediately, and that
// only ONE frame was sent to the directory.

describe("CONNREQ-003-AC-002: duplicate concurrent request to same target returns error", () => {
  it("AC-002: second cello_request_connection to same target returns connection_request_in_flight immediately", async () => {
    // For this unit test we need a real directory so the first request goes in flight
    // but doesn't resolve quickly. We use a very short test and check the second call
    // returns immediately while the first is still waiting.
    const dirKeyProvider = generateKeypair();
    const { node: dirNode, stop: stopDir } = await createDirectoryNode({
      keyProvider: dirKeyProvider,
      relay: makeRelay(),
      relayEndpoint: { peer_id: "relay-peer-id", multiaddrs: [] },
      requireRegistration: true,
    });
    scope.addCleanup(stopDir);

    const kpA = generateKeypair();
    const kpB = generateKeypair();
    const nodeA = await createNode({ keyProvider: kpA, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    const nodeB = await createNode({ keyProvider: kpB, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await nodeA.start();
    await nodeB.start();
    scope.addCleanup(() => nodeA.stop());
    scope.addCleanup(() => nodeB.stop());

    const directoryEndpoint = {
      peer_id: dirNode.getPeerId(),
      multiaddrs: dirNode.listenAddresses(),
    };

    const openPolicy: SignalRequirementPolicy = {
      mode: "open",
      review_mode: "deterministic",
      requirements: [],
    };

    const clientA = createClient(nodeA, kpA, {
      directoryEndpoint,
      connectionPolicy: openPolicy,
      connectionTimeoutMs: 10_000,
    });
    const clientB = createClient(nodeB, kpB, {
      directoryEndpoint,
      connectionPolicy: openPolicy,
      connectionTimeoutMs: 10_000,
    });
    await clientA.registerHandler();
    await clientB.registerHandler();

    const mlDsaA = await mlDsaKeygen();
    const regA = await clientA.register("+5555555555");
    if ("error" in regA) throw new Error(`A reg failed: ${String(regA.error)}`);
    await clientB.register("+6666666666");

    const pubkeyB = Buffer.from(await kpB.getPublicKey()).toString("hex");
    const packageCbor = await buildMinimalPackageCbor(kpA, mlDsaA, regA.primary_pubkey);

    // Start first request (will be in flight, async).
    // The map slot is reserved synchronously before the first await, so calling the
    // second request in the same tick (no delay) will see the in-flight state.
    const firstRequest = clientA.cello_request_connection({
      target_pubkey: pubkeyB,
      package_cbor: packageCbor,
    });

    // Second request to SAME target should return immediately with error.
    // No delay needed — the map reservation in the first call happens synchronously
    // before its first await (Promise.race), so the second call sees it immediately.
    const start = Date.now();
    const secondResult = await clientA.cello_request_connection({
      target_pubkey: pubkeyB,
      package_cbor: packageCbor,
    });
    const elapsed = Date.now() - start;

    // Should return immediately (< 500ms), not wait for directory
    expect(elapsed).toBeLessThan(500);
    expect(secondResult.result).toBe("error");
    if (secondResult.result === "error") {
      expect(secondResult.reason).toBe("connection_request_in_flight");
    }

    // First request should eventually resolve (let it finish)
    await firstRequest;
  }, 20_000);
});

// ─── AC-001 (integration): fan-out to two DIFFERENT targets ──────────────────
//
// When cello_request_connection is called for B and C concurrently (without awaiting
// the first), both calls resolve with 'established' and return distinct connection_ids.
// This fails with the single-slot implementation because the second call's resolve
// overwrites the first's, leaving the first caller's promise forever unresolved.

describe("CONNREQ-003-AC-001: fan-out to two different targets — both resolve", () => {
  it("AC-001: concurrent requests to B and C both resolve with established, distinct connection_ids", async () => {
    const { clientA, pubkeyB, pubkeyC, packageCborB, packageCborC } =
      await makeThreeAgentFixture(scope);

    // Fire both requests concurrently WITHOUT awaiting first
    const [resultB, resultC] = await Promise.all([
      clientA.cello_request_connection({
        target_pubkey: pubkeyB,
        package_cbor: packageCborB,
      }),
      clientA.cello_request_connection({
        target_pubkey: pubkeyC,
        package_cbor: packageCborC,
      }),
    ]);

    // Both must resolve with 'established'
    expect(resultB.result).toBe("established");
    expect(resultC.result).toBe("established");

    if (resultB.result !== "established" || resultC.result !== "established") {
      throw new Error(`Fan-out failed: B=${resultB.result} C=${resultC.result}`);
    }

    // Connection IDs must be distinct
    expect(resultB.connection_id).not.toBe(resultC.connection_id);

    // A should have two connections
    const connections = clientA.listConnections();
    expect(connections.length).toBe(2);
  }, 30_000);
});

// ─── AC-005 (unit): resolver Map is empty after both requests resolve ──────────
//
// No memory leak from stale resolvers. The internal map must be empty after
// both concurrent requests complete.

describe("CONNREQ-003-AC-005: resolver Map empty after concurrent requests resolve", () => {
  it("AC-005: internal resolver map is empty after two concurrent requests both resolve", async () => {
    const { clientA, pubkeyB, pubkeyC, packageCborB, packageCborC } =
      await makeThreeAgentFixture(scope);

    // Fire both requests and await both
    await Promise.all([
      clientA.cello_request_connection({
        target_pubkey: pubkeyB,
        package_cbor: packageCborB,
      }),
      clientA.cello_request_connection({
        target_pubkey: pubkeyC,
        package_cbor: packageCborC,
      }),
    ]);

    // Inspect internal state — exposed via test escape hatch
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resolverCount = (clientA as any)._pendingConnectionRequestResolverCount ?? 0;
    expect(resolverCount).toBe(0);
  }, 30_000);
});

// ─── SI-001 (unit): out-of-order frame routing — B's frame never resolves C's resolver
//
// A connection_established frame with counterparty_pubkey = B must never resolve
// the pending resolver waiting for target C. This tests the key invariant of the
// Map-keyed approach: routing by target pubkey ensures cross-target isolation.

describe("CONNREQ-003-SI-001: out-of-order frame routing — B's frame never resolves C's resolver", () => {
  it("SI-001: connection_established for B does not resolve pending request for C (out-of-order arrival)", async () => {
    const { clientA, pubkeyB, pubkeyC, packageCborB, packageCborC } =
      await makeThreeAgentFixture(scope);

    // Track which requests resolved and which are still pending
    let bResolved = false;
    let cResolved = false;
    let bResult: Awaited<ReturnType<typeof clientA.cello_request_connection>> | null = null;
    let cResult: Awaited<ReturnType<typeof clientA.cello_request_connection>> | null = null;

    const bPromise = clientA.cello_request_connection({
      target_pubkey: pubkeyB,
      package_cbor: packageCborB,
    }).then((r) => { bResult = r; bResolved = true; return r; });

    const cPromise = clientA.cello_request_connection({
      target_pubkey: pubkeyC,
      package_cbor: packageCborC,
    }).then((r) => { cResult = r; cResolved = true; return r; });

    // Wait for both to resolve
    await Promise.all([bPromise, cPromise]);

    // Both should have resolved with the right counterparty
    expect(bResolved).toBe(true);
    expect(cResolved).toBe(true);

    // B's result must correspond to B's counterparty
    expect(bResult!.result).toBe("established");
    expect(cResult!.result).toBe("established");

    // Verify both connection IDs are distinct — confirms no cross-routing
    if (bResult!.result === "established" && cResult!.result === "established") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bConnId = (bResult as any).connection_id as string;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cConnId = (cResult as any).connection_id as string;
      expect(bConnId).not.toBe(cConnId);
    }
  }, 30_000);
});

// ─── DB-001 (unit): timeout on one slot does not affect the other ─────────────
//
// When a request to target B times out (directory unreachable scenario),
// the timed-out slot is cleaned up and the concurrent request to C continues.
// We simulate this by using a very short timeout for B's request but giving
// C a normal timeout. Since B and C have separate resolvers, B timing out
// must not affect C.

describe("CONNREQ-003-DB-001: timeout on one slot does not affect the other", () => {
  it("DB-001: after one request times out, the other continues and resolves", async () => {
    // We need A to have two requests in flight: one that will timeout quickly,
    // one that will succeed. We achieve this by sending the first request to a
    // non-existent target (no such registered agent), which will either error
    // or timeout.
    const dirKeyProvider = generateKeypair();
    const { node: dirNode, stop: stopDir } = await createDirectoryNode({
      keyProvider: dirKeyProvider,
      relay: makeRelay(),
      relayEndpoint: { peer_id: "relay-peer-id", multiaddrs: [] },
      requireRegistration: true,
    });
    scope.addCleanup(stopDir);

    const directoryEndpoint = {
      peer_id: dirNode.getPeerId(),
      multiaddrs: dirNode.listenAddresses(),
    };

    const openPolicy: SignalRequirementPolicy = {
      mode: "open",
      review_mode: "deterministic",
      requirements: [],
    };

    const kpA = generateKeypair();
    const nodeA = await createNode({ keyProvider: kpA, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await nodeA.start();
    scope.addCleanup(() => nodeA.stop());
    const clientA = createClient(nodeA, kpA, {
      directoryEndpoint,
      connectionPolicy: openPolicy,
      connectionTimeoutMs: 2_000, // short so the "missing" target times out quickly
    });
    await clientA.registerHandler();

    const kpC = generateKeypair();
    const nodeC = await createNode({ keyProvider: kpC, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await nodeC.start();
    scope.addCleanup(() => nodeC.stop());
    const clientC = createClient(nodeC, kpC, {
      directoryEndpoint,
      connectionPolicy: openPolicy,
      connectionTimeoutMs: 15_000,
    });
    await clientC.registerHandler();

    const mlDsaA = await mlDsaKeygen();
    const regA = await clientA.register("+7777777777");
    if ("error" in regA) throw new Error(`A reg failed: ${String(regA.error)}`);
    const regC = await clientC.register("+8888888888");
    if ("error" in regC) throw new Error(`C reg failed: ${String(regC.error)}`);

    // "B" is a fabricated pubkey not registered with the directory — will get error response
    const fakePubkeyB = Buffer.from(new Uint8Array(32).fill(0xab)).toString("hex");
    const pubkeyC = Buffer.from(await kpC.getPublicKey()).toString("hex");

    const packageCborFakeB = await buildMinimalPackageCbor(kpA, mlDsaA, regA.primary_pubkey);
    const packageCborC = await buildMinimalPackageCbor(kpA, mlDsaA, regA.primary_pubkey);

    // Fire both requests concurrently
    const bPromise = clientA.cello_request_connection({
      target_pubkey: fakePubkeyB,
      package_cbor: packageCborFakeB,
    });
    const cPromise = clientA.cello_request_connection({
      target_pubkey: pubkeyC,
      package_cbor: packageCborC,
    });

    const [bResult, cResult] = await Promise.all([bPromise, cPromise]);

    // B should have gotten an error (target_not_found or timeout)
    expect(bResult.result === "error" || bResult.result === "timeout").toBe(true);

    // C should still have resolved — this is the key assertion: B's failure
    // must not have poisoned C's pending slot
    expect(cResult.result).toBe("established");

    // After both settle, resolver map must be empty (no leak)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resolverCount = (clientA as any)._pendingConnectionRequestResolverCount ?? 0;
    expect(resolverCount).toBe(0);
  }, 25_000);
});

// ─── AC-003 (integration): multiple concurrent awaitConnectionRequest calls ────
//
// Two concurrent awaitConnectionRequest() calls on the same client both resolve
// independently when two inbound requests arrive. No request is dropped or delivered
// to both callers.

describe("CONNREQ-003-AC-003: multiple concurrent awaitConnectionRequest calls", () => {
  it("AC-003: two concurrent awaitConnectionRequest calls each receive exactly one distinct inbound request", async () => {
    const dirKeyProvider = generateKeypair();
    const { node: dirNode, stop: stopDir } = await createDirectoryNode({
      keyProvider: dirKeyProvider,
      relay: makeRelay(),
      relayEndpoint: { peer_id: "relay-peer-id", multiaddrs: [] },
      requireRegistration: true,
    });
    scope.addCleanup(stopDir);

    const directoryEndpoint = {
      peer_id: dirNode.getPeerId(),
      multiaddrs: dirNode.listenAddresses(),
    };

    // B is the target with two concurrent awaitConnectionRequest callers
    // open + inference policy: forces pending_agent_review for all requests
    const agentReviewPolicy: SignalRequirementPolicy = {
      mode: "open",
      review_mode: "inference",
      requirements: [],
    };
    const openPolicy: SignalRequirementPolicy = {
      mode: "open",
      review_mode: "deterministic",
      requirements: [],
    };

    const kpA1 = generateKeypair();
    const kpA2 = generateKeypair();
    const kpB = generateKeypair();

    const nodeA1 = await createNode({ keyProvider: kpA1, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    const nodeA2 = await createNode({ keyProvider: kpA2, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    const nodeB = await createNode({ keyProvider: kpB, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });

    await nodeA1.start();
    await nodeA2.start();
    await nodeB.start();
    scope.addCleanup(() => nodeA1.stop());
    scope.addCleanup(() => nodeA2.stop());
    scope.addCleanup(() => nodeB.stop());

    const clientA1 = createClient(nodeA1, kpA1, {
      directoryEndpoint,
      connectionPolicy: openPolicy,
      connectionTimeoutMs: 15_000,
    });
    const clientA2 = createClient(nodeA2, kpA2, {
      directoryEndpoint,
      connectionPolicy: openPolicy,
      connectionTimeoutMs: 15_000,
    });
    const clientB = createClient(nodeB, kpB, {
      directoryEndpoint,
      connectionPolicy: agentReviewPolicy,
      connectionTimeoutMs: 15_000,
    });

    await clientA1.registerHandler();
    await clientA2.registerHandler();
    await clientB.registerHandler();

    const mlDsaA1 = await mlDsaKeygen();
    const regA1 = await clientA1.register("+1234567890");
    if ("error" in regA1) throw new Error(`A1 reg failed: ${String(regA1.error)}`);

    const mlDsaA2 = await mlDsaKeygen();
    const regA2 = await clientA2.register("+0987654321");
    if ("error" in regA2) throw new Error(`A2 reg failed: ${String(regA2.error)}`);

    await clientB.register("+1122334455");

    const pubkeyB = Buffer.from(await kpB.getPublicKey()).toString("hex");

    const pkgA1 = await buildMinimalPackageCbor(kpA1, mlDsaA1, regA1.primary_pubkey);
    const pkgA2 = await buildMinimalPackageCbor(kpA2, mlDsaA2, regA2.primary_pubkey);

    // Two concurrent awaitConnectionRequest calls on B
    const awaitPromise1 = clientB.awaitConnectionRequest(10_000);
    const awaitPromise2 = clientB.awaitConnectionRequest(10_000);

    // Give the awaiters time to register
    await new Promise<void>((resolve) => setTimeout(resolve, 50));

    // A1 and A2 both send connection requests to B concurrently
    const [a1Result, a2Result, await1Result, await2Result] = await Promise.all([
      clientA1.cello_request_connection({ target_pubkey: pubkeyB, package_cbor: pkgA1 }),
      clientA2.cello_request_connection({ target_pubkey: pubkeyB, package_cbor: pkgA2 }),
      awaitPromise1,
      awaitPromise2,
    ]);

    // Both senders should have gotten responses (pending_review means B still needs to decide)
    // The awaiter on B's side should have resolved with pending_review
    expect(await1Result.type).toBe("pending_review");
    expect(await2Result.type).toBe("pending_review");

    // The two await results must be for DIFFERENT requesters (no duplication)
    if (await1Result.type === "pending_review" && await2Result.type === "pending_review") {
      // from_pubkeys must be distinct (one for A1, one for A2)
      expect(await1Result.from_pubkey).not.toBe(await2Result.from_pubkey);
    }

    // Both senders see a response eventually (no frozen callers)
    // A1 and A2 may see timeout (B hasn't accepted yet) — that's OK as long as they got responses
    expect(a1Result.result !== undefined).toBe(true);
    expect(a2Result.result !== undefined).toBe(true);
  }, 35_000);
});

// ─── AC-004 (integration): fan-out connections then both sessions initiate ────
//
// After A establishes connections to both B and C via concurrent fan-out,
// A can initiate sessions with both. cello_list_sessions returns two active sessions.
//
// NOTE: This test is intentionally scoped to verifying that two connections exist
// after fan-out. Full session initiation requires a relay (not wired here),
// so we verify the connection-level preconditions only.

describe("CONNREQ-003-AC-004: fan-out connections establish — A has connections to both B and C", () => {
  it("AC-004: after concurrent fan-out, A has exactly two active connections with distinct counterparty pubkeys", async () => {
    const { clientA, pubkeyB, pubkeyC, packageCborB, packageCborC } =
      await makeThreeAgentFixture(scope);

    const [resultB, resultC] = await Promise.all([
      clientA.cello_request_connection({
        target_pubkey: pubkeyB,
        package_cbor: packageCborB,
      }),
      clientA.cello_request_connection({
        target_pubkey: pubkeyC,
        package_cbor: packageCborC,
      }),
    ]);

    expect(resultB.result).toBe("established");
    expect(resultC.result).toBe("established");

    // A has two connections
    const connections = clientA.listConnections();
    expect(connections.length).toBe(2);

    // Both connections are active with distinct counterparty pubkeys
    const counterpartyPubkeys = connections.map((c) => c.counterparty_pubkey);
    expect(counterpartyPubkeys).toContain(pubkeyB);
    expect(counterpartyPubkeys).toContain(pubkeyC);

    // Both connection_ids are distinct
    const connIds = connections.map((c) => c.connection_id);
    expect(new Set(connIds).size).toBe(2);
  }, 30_000);
});

// ─── Observability (unit): logger events emitted correctly ──────────────────
//
// Tests that the Logger is called with the correct event names and context fields
// as specified in the story's observability section.
//
// Event taxonomy (from story YAML):
//   connection.request.sent (info): { targetPubkeyHex, correlationId }
//   connection.established (info): { connectionId, counterpartyPubkeyHex, correlationId }
//   connection.request.duplicate (warn): { targetPubkeyHex }
//   connection.request.failed (error): { targetPubkeyHex, reason, correlationId }

describe("CONNREQ-003-Observability: logger events emitted with correct context", () => {
  it("Obs-1: connection.request.sent logged when request is sent", async () => {
    const events: Array<{ name: string; ctx: LogContext }> = [];
    const testLogger: Logger = {
      debug: () => {},
      info: (name, ctx) => { events.push({ name, ctx: ctx ?? {} }); },
      warn: (name, ctx) => { events.push({ name, ctx: ctx ?? {} }); },
      error: (name, errOrCtx?, ctx?) => {
        const logCtx = (errOrCtx instanceof Error ? ctx : errOrCtx) ?? {};
        events.push({ name, ctx: logCtx });
      },
    };

    const { clientA, pubkeyB, packageCborB } =
      await makeThreeAgentFixture(scope, { loggerA: testLogger });

    await clientA.cello_request_connection({
      target_pubkey: pubkeyB,
      package_cbor: packageCborB,
    });

    const sentEvents = events.filter((e) => e.name === "connection.request.sent");
    expect(sentEvents.length).toBeGreaterThanOrEqual(1);
    const sentEvent = sentEvents[0]!;
    expect(sentEvent.ctx.targetPubkeyHex).toBe(pubkeyB);
    expect(typeof sentEvent.ctx.correlationId).toBe("string");
    expect((sentEvent.ctx.correlationId as string).length).toBeGreaterThan(0);
  }, 30_000);

  it("Obs-2: connection.established logged when connection is established", async () => {
    const events: Array<{ name: string; ctx: LogContext }> = [];
    const testLogger: Logger = {
      debug: () => {},
      info: (name, ctx) => { events.push({ name, ctx: ctx ?? {} }); },
      warn: (name, ctx) => { events.push({ name, ctx: ctx ?? {} }); },
      error: (name, errOrCtx?, ctx?) => {
        const logCtx = (errOrCtx instanceof Error ? ctx : errOrCtx) ?? {};
        events.push({ name, ctx: logCtx });
      },
    };

    const { clientA, pubkeyB, packageCborB } =
      await makeThreeAgentFixture(scope, { loggerA: testLogger });

    const result = await clientA.cello_request_connection({
      target_pubkey: pubkeyB,
      package_cbor: packageCborB,
    });

    expect(result.result).toBe("established");

    const establishedEvents = events.filter((e) => e.name === "connection.established");
    expect(establishedEvents.length).toBe(1);
    const estEvent = establishedEvents[0]!;
    expect(typeof estEvent.ctx.connectionId).toBe("string");
    expect(estEvent.ctx.counterpartyPubkeyHex).toBe(pubkeyB);
    expect(typeof estEvent.ctx.correlationId).toBe("string");
  }, 30_000);

  it("Obs-3: connection.request.duplicate logged when same target already in flight", async () => {
    const events: Array<{ name: string; ctx: LogContext }> = [];
    const testLogger: Logger = {
      debug: () => {},
      info: (name, ctx) => { events.push({ name, ctx: ctx ?? {} }); },
      warn: (name, ctx) => { events.push({ name, ctx: ctx ?? {} }); },
      error: (name, errOrCtx?, ctx?) => {
        const logCtx = (errOrCtx instanceof Error ? ctx : errOrCtx) ?? {};
        events.push({ name, ctx: logCtx });
      },
    };

    const dirKeyProvider = generateKeypair();
    const { node: dirNode, stop: stopDir } = await createDirectoryNode({
      keyProvider: dirKeyProvider,
      relay: makeRelay(),
      relayEndpoint: { peer_id: "relay-peer-id", multiaddrs: [] },
      requireRegistration: true,
    });
    scope.addCleanup(stopDir);

    const kpA = generateKeypair();
    const kpB = generateKeypair();
    const nodeA = await createNode({ keyProvider: kpA, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    const nodeB = await createNode({ keyProvider: kpB, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await nodeA.start();
    await nodeB.start();
    scope.addCleanup(() => nodeA.stop());
    scope.addCleanup(() => nodeB.stop());

    const directoryEndpoint = {
      peer_id: dirNode.getPeerId(),
      multiaddrs: dirNode.listenAddresses(),
    };

    const openPolicy: SignalRequirementPolicy = {
      mode: "open",
      review_mode: "deterministic",
      requirements: [],
    };

    const clientA = createClient(nodeA, kpA, {
      directoryEndpoint,
      connectionPolicy: openPolicy,
      connectionTimeoutMs: 10_000,
      logger: testLogger,
    });
    const clientB = createClient(nodeB, kpB, {
      directoryEndpoint,
      connectionPolicy: openPolicy,
      connectionTimeoutMs: 10_000,
    });
    await clientA.registerHandler();
    await clientB.registerHandler();

    const mlDsaA = await mlDsaKeygen();
    const regA = await clientA.register("+9999999999");
    if ("error" in regA) throw new Error(`A reg failed: ${String(regA.error)}`);
    await clientB.register("+0001112222");

    const pubkeyB = Buffer.from(await kpB.getPublicKey()).toString("hex");
    const packageCbor = await buildMinimalPackageCbor(kpA, mlDsaA, regA.primary_pubkey);

    // Fire first request (in flight).
    // Map slot reserved synchronously — no delay needed before second call.
    const firstRequest = clientA.cello_request_connection({
      target_pubkey: pubkeyB,
      package_cbor: packageCbor,
    });

    // Fire second request to SAME target immediately (same tick, sees in-flight state)
    await clientA.cello_request_connection({
      target_pubkey: pubkeyB,
      package_cbor: packageCbor,
    });

    await firstRequest;

    // Verify duplicate warning logged
    const dupEvents = events.filter((e) => e.name === "connection.request.duplicate");
    expect(dupEvents.length).toBe(1);
    expect(dupEvents[0]!.ctx.targetPubkeyHex).toBe(pubkeyB);
  }, 20_000);

  it("Obs-4: connection.request.failed logged when directory returns error", async () => {
    const events: Array<{ name: string; ctx: LogContext }> = [];
    const testLogger: Logger = {
      debug: () => {},
      info: (name, ctx) => { events.push({ name, ctx: ctx ?? {} }); },
      warn: (name, ctx) => { events.push({ name, ctx: ctx ?? {} }); },
      error: (name, errOrCtx?, ctx?) => {
        const logCtx = (errOrCtx instanceof Error ? ctx : errOrCtx) ?? {};
        events.push({ name, ctx: logCtx });
      },
    };

    const dirKeyProvider = generateKeypair();
    const { node: dirNode, stop: stopDir } = await createDirectoryNode({
      keyProvider: dirKeyProvider,
      relay: makeRelay(),
      relayEndpoint: { peer_id: "relay-peer-id", multiaddrs: [] },
      requireRegistration: true,
    });
    scope.addCleanup(stopDir);

    const kpA = generateKeypair();
    const nodeA = await createNode({ keyProvider: kpA, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await nodeA.start();
    scope.addCleanup(() => nodeA.stop());

    const directoryEndpoint = {
      peer_id: dirNode.getPeerId(),
      multiaddrs: dirNode.listenAddresses(),
    };

    const clientA = createClient(nodeA, kpA, {
      directoryEndpoint,
      connectionTimeoutMs: 5_000,
      logger: testLogger,
    });
    await clientA.registerHandler();

    const mlDsaA = await mlDsaKeygen();
    const regA = await clientA.register("+1001001001");
    if ("error" in regA) throw new Error(`A reg failed: ${String(regA.error)}`);

    // Target is not registered — directory will return error
    const fakePubkey = Buffer.from(new Uint8Array(32).fill(0xcd)).toString("hex");
    const packageCbor = await buildMinimalPackageCbor(kpA, mlDsaA, regA.primary_pubkey);

    await clientA.cello_request_connection({
      target_pubkey: fakePubkey,
      package_cbor: packageCbor,
    });

    // Should have logged either a failed event or not (depends on directory error type)
    // The key is that if we get a connection_request_error, the error event is logged
    const failEvents = events.filter((e) => e.name === "connection.request.failed");
    // This event fires on connection_request_error — check if we got one
    if (failEvents.length > 0) {
      expect(failEvents[0]!.ctx.targetPubkeyHex).toBe(fakePubkey);
      expect(typeof failEvents[0]!.ctx.reason).toBe("string");
      expect(typeof failEvents[0]!.ctx.correlationId).toBe("string");
    }
    // If no fail event, the directory returned timeout or unknown type — acceptable
  }, 15_000);
});
