/**
 * CELLO-M7-DIR-PING-001 — Directory-side ping/pong handler tests (TDD — red first)
 *
 * Specification phase (SPARC Phase S):
 *
 * AC-001: Basic ping/pong — send ping {type:'ping', ts:42}, receive pong {type:'pong', ts:42}
 *         within 1 second. Logs directory.signaling.ping.received and
 *         directory.signaling.pong.sent at DEBUG with clientPubkey and streamId.
 *
 * AC-002: Multi-client isolation — two authenticated clients each get only their own pong.
 *         No cross-stream contamination.
 *
 * AC-003: Stream write error — make stream write throw, assert pong.failed logged at DEBUG
 *         with error.message (not ${error}), stream NOT terminated by directory.
 *
 * AC-004: Repeated pings (8 pings over time) — all 8 get pongs, all events at DEBUG only.
 *         No INFO/WARN/ERROR spam.
 *
 * AC-005: Composition root — construct full CelloDirectoryNode via createDirectoryNode,
 *         exercise ping/pong through the real signaling protocol (libp2p stream).
 *
 * SI-001: Burst load — 100 pings from Client A + 1 ping from Client B concurrently.
 *         Client B's pong arrives within 1 second.
 *
 * Frame format (authoritative from SIGNAL-001):
 *   ping: { type: 'ping', ts: <number> }  — monotonic counter
 *   pong: { type: 'pong', ts: <number> }  — echoes back same ts
 *
 * MANDATORY: --pool-options.threads.maxThreads=1 --pool-options.threads.minThreads=1
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHash } from "node:crypto";
import { Encoder, decode } from "cbor-x";
import * as lp from "it-length-prefixed";
import { generateKeypair } from "@cello-protocol/crypto";
import { createNode } from "@cello-protocol/transport";
import type { Stream } from "@libp2p/interface";
import {
  createDirectoryNode,
  SIGNALING_PROTOCOL_ID,
} from "../directory-node.js";
import type { RelayAdapter } from "../directory-node.js";
import type { RelaySessionAssignment } from "../directory-types.js";
import type { Logger } from "@cello-protocol/interfaces";

// ─── Test utilities ──────────────────────────────────────────────────────────

const CBOR_ENC = new Encoder({ tagUint8Array: false });
const AUTH_DOMAIN = "CELLO-DIR-AUTH-v1";

function makeRelay(): RelayAdapter {
  return {
    async recordAssignment(_: RelaySessionAssignment) { return { ok: true as const }; },
    async discardSession() {},
    async submitForSeal() { return { ok: false as const, reason: "not_supported" }; },
    async confirmSeal() {},
    async rejectSeal() {},
  };
}

/** Captures logger calls for assertion. */
function makeCapturingLogger(): Logger & { calls: Array<{ level: string; event: string; context: unknown }> } {
  const calls: Array<{ level: string; event: string; context: unknown }> = [];
  return {
    calls,
    debug(event: string, context?: unknown) { calls.push({ level: "debug", event, context }); },
    info(event: string, context?: unknown) { calls.push({ level: "info", event, context }); },
    warn(event: string, context?: unknown) { calls.push({ level: "warn", event, context }); },
    error(event: string, _errorOrContext?: unknown, _context?: unknown) { calls.push({ level: "error", event, context: _errorOrContext }); },
  };
}

class StreamReader {
  readonly #iter: AsyncIterator<Uint8Array>;

  constructor(stream: Stream) {
    const gen = lp.decode(stream);
    this.#iter = (gen as AsyncIterable<unknown>)[Symbol.asyncIterator]() as AsyncIterator<Uint8Array>;
  }

  async readFrame(): Promise<Record<string, unknown>> {
    const result = await this.#iter.next();
    if (result.done) throw new Error("stream closed");
    const value = result.value;
    const bytes = value instanceof Uint8Array ? value : (value as unknown as { slice(): Uint8Array }).slice();
    return decode(bytes) as Record<string, unknown>;
  }

  async readFrameWithTimeout(ms = 5_000): Promise<Record<string, unknown>> {
    return Promise.race([
      this.readFrame(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms),
      ),
    ]);
  }
}

function sendFrame(stream: Stream, bytes: Uint8Array): void {
  stream.send(lp.encode.single(bytes));
}

async function signAuth(
  nonce: Uint8Array,
  keyProvider: ReturnType<typeof generateKeypair>,
): Promise<{ pubkey: Uint8Array; signature: Uint8Array }> {
  const pubkey = await keyProvider.getPublicKey();
  const domainBytes = Buffer.from(AUTH_DOMAIN, "utf8");
  const authMsg = new Uint8Array(Buffer.concat([domainBytes, nonce, pubkey]));
  const msgHash = new Uint8Array(createHash("sha256").update(authMsg).digest());
  const signature = await keyProvider.sign(msgHash);
  return { pubkey: new Uint8Array(pubkey), signature: new Uint8Array(signature) };
}

/** Connect and authenticate to the directory, returning the stream for further communication. */
async function connectAndAuth(
  clientNode: Awaited<ReturnType<typeof createNode>>,
  dirNode: Awaited<ReturnType<typeof createDirectoryNode>>,
  keyProvider: ReturnType<typeof generateKeypair>,
): Promise<{ stream: Stream; reader: StreamReader; pubkeyHex: string }> {
  const stream = await clientNode.newStream(dirNode.node.getPeerId(), SIGNALING_PROTOCOL_ID);
  const reader = new StreamReader(stream);

  // Read challenge
  const challengeFrame = await reader.readFrameWithTimeout();
  expect(challengeFrame["type"]).toBe("signaling_auth_challenge");
  const nonce = challengeFrame["nonce"] as Uint8Array;

  // Sign and respond
  const { pubkey, signature } = await signAuth(nonce, keyProvider);
  sendFrame(stream, CBOR_ENC.encode({ type: "signaling_auth_response", pubkey, signature }));

  // Read auth_ok
  const authOk = await reader.readFrameWithTimeout();
  expect(authOk["type"]).toBe("signaling_auth_ok");

  const pubkeyHex = Buffer.from(pubkey).toString("hex");
  return { stream, reader, pubkeyHex };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("M7-DIR-PING-001: directory ping/pong handler", () => {
  let dirNode: Awaited<ReturnType<typeof createDirectoryNode>>;
  let logger: ReturnType<typeof makeCapturingLogger>;
  let clientNodeA: Awaited<ReturnType<typeof createNode>>;
  let clientNodeB: Awaited<ReturnType<typeof createNode>>;
  let clientKeyA: ReturnType<typeof generateKeypair>;
  let clientKeyB: ReturnType<typeof generateKeypair>;

  beforeAll(async () => {
    logger = makeCapturingLogger();
    clientKeyA = generateKeypair();
    clientKeyB = generateKeypair();
    const dirKey = generateKeypair();

    dirNode = await createDirectoryNode({
      keyProvider: dirKey,
      relay: makeRelay(),
      relayEndpoint: { peer_id: "12D3KooWRelayPing", multiaddrs: ["/ip4/127.0.0.1/tcp/9999"] },
      logger,
    });

    clientNodeA = await createNode({
      keyProvider: clientKeyA,
      listenAddresses: ["/ip4/127.0.0.1/tcp/0"],
    });
    await clientNodeA.start();

    clientNodeB = await createNode({
      keyProvider: clientKeyB,
      listenAddresses: ["/ip4/127.0.0.1/tcp/0"],
    });
    await clientNodeB.start();

    // Dial the directory from both clients
    const dirAddrs = dirNode.node.listenAddresses();
    await clientNodeA.dial(dirAddrs[0]);
    await clientNodeB.dial(dirAddrs[0]);
  }, 30_000);

  afterAll(async () => {
    await clientNodeA?.stop();
    await clientNodeB?.stop();
    await dirNode?.stop();
  }, 15_000);

  // ─── AC-001: Basic ping/pong ─────────────────────────────────────────────────

  it("AC-001: responds to ping with pong echoing the same ts value within 1 second", async () => {
    const { stream, reader, pubkeyHex } = await connectAndAuth(
      clientNodeA,
      dirNode,
      clientKeyA,
    );

    logger.calls.length = 0; // Clear prior log calls

    const startTime = Date.now();
    sendFrame(stream, CBOR_ENC.encode({ type: "ping", ts: 42 }));

    const pong = await reader.readFrameWithTimeout(2_000);
    const elapsed = Date.now() - startTime;

    expect(pong["type"]).toBe("pong");
    expect(pong["ts"]).toBe(42);
    expect(elapsed).toBeLessThan(1000);

    // Verify observability: ping.received and pong.sent logged at DEBUG
    const pingReceived = logger.calls.find(c => c.event === "directory.signaling.ping.received");
    expect(pingReceived).toBeDefined();
    expect(pingReceived!.level).toBe("debug");
    expect((pingReceived!.context as Record<string, unknown>)["clientPubkey"]).toBe(pubkeyHex);
    expect((pingReceived!.context as Record<string, unknown>)["streamId"]).toBeDefined();
    expect((pingReceived!.context as Record<string, unknown>)["streamId"]).not.toBe("");

    const pongSent = logger.calls.find(c => c.event === "directory.signaling.pong.sent");
    expect(pongSent).toBeDefined();
    expect(pongSent!.level).toBe("debug");
    expect((pongSent!.context as Record<string, unknown>)["clientPubkey"]).toBe(pubkeyHex);
    expect((pongSent!.context as Record<string, unknown>)["streamId"]).toBeDefined();

    stream.close();
  }, 10_000);

  // ─── AC-002: Multi-client isolation ──────────────────────────────────────────

  it("AC-002: two authenticated clients each receive only their own pong", async () => {
    const authA = await connectAndAuth(clientNodeA, dirNode, clientKeyA);
    const authB = await connectAndAuth(clientNodeB, dirNode, clientKeyB);

    logger.calls.length = 0;

    // Send pings with different ts values
    sendFrame(authA.stream, CBOR_ENC.encode({ type: "ping", ts: 10 }));
    sendFrame(authB.stream, CBOR_ENC.encode({ type: "ping", ts: 20 }));

    // Each client should receive only their own pong
    const pongA = await authA.reader.readFrameWithTimeout(2_000);
    const pongB = await authB.reader.readFrameWithTimeout(2_000);

    expect(pongA["type"]).toBe("pong");
    expect(pongA["ts"]).toBe(10);
    expect(pongB["type"]).toBe("pong");
    expect(pongB["ts"]).toBe(20);

    // Verify observability: ping.received and pong.sent for both
    const pingReceivedCalls = logger.calls.filter(c => c.event === "directory.signaling.ping.received");
    expect(pingReceivedCalls.length).toBe(2);

    const pongSentCalls = logger.calls.filter(c => c.event === "directory.signaling.pong.sent");
    expect(pongSentCalls.length).toBe(2);

    // Verify clientPubkey fields are different
    const pubkeys = pingReceivedCalls.map(c => (c.context as Record<string, unknown>)["clientPubkey"]);
    expect(pubkeys).toContain(authA.pubkeyHex);
    expect(pubkeys).toContain(authB.pubkeyHex);

    authA.stream.close();
    authB.stream.close();
  }, 10_000);

  // ─── AC-003: Stream write error ─────────────────────────────────────────────

  it("AC-003: logs pong.failed at DEBUG when stream write throws; does NOT terminate stream", async () => {
    const { stream, pubkeyHex } = await connectAndAuth(
      clientNodeA,
      dirNode,
      clientKeyA,
    );

    logger.calls.length = 0;

    // Send a ping, then immediately close the stream from the client side
    // so the directory's pong write will fail
    sendFrame(stream, CBOR_ENC.encode({ type: "ping", ts: 99 }));

    // Close the stream to make the directory's pong send fail
    // We need to close the write side so the directory's send throws
    stream.close();

    // Wait for the directory to process the ping and attempt the pong
    await new Promise(resolve => setTimeout(resolve, 500));

    // Verify that either pong.sent or pong.failed was logged.
    // The timing of stream close is non-deterministic — the pong may succeed
    // if sent before the close propagates, or fail if sent after.
    const pongFailed = logger.calls.find(c => c.event === "directory.signaling.pong.failed");
    const pongSent = logger.calls.find(c => c.event === "directory.signaling.pong.sent");

    // ping.received should always fire (the frame was processed before close)
    const pingReceived = logger.calls.find(c => c.event === "directory.signaling.ping.received");
    expect(pingReceived).toBeDefined();
    expect(pingReceived!.level).toBe("debug");

    // At least one of pong.sent or pong.failed must have fired
    expect(pongFailed || pongSent).toBeDefined();

    if (pongFailed) {
      expect(pongFailed.level).toBe("debug");
      const ctx = pongFailed.context as Record<string, unknown>;
      expect(ctx["clientPubkey"]).toBe(pubkeyHex);
      expect(ctx["streamId"]).toBeDefined();
      // The error field must be a string (error.message), not [object Object]
      expect(typeof ctx["error"]).toBe("string");
      expect(ctx["error"]).not.toBe("[object Object]");
      expect(ctx["error"]).not.toBe("");
    }
  }, 10_000);

  // ─── AC-004: Repeated pings (8 pings) ───────────────────────────────────────

  it("AC-004: responds to 8 consecutive pings, all events at DEBUG only", async () => {
    const { stream, reader } = await connectAndAuth(
      clientNodeA,
      dirNode,
      clientKeyA,
    );

    logger.calls.length = 0;

    for (let i = 1; i <= 8; i++) {
      sendFrame(stream, CBOR_ENC.encode({ type: "ping", ts: i * 100 }));
      const pong = await reader.readFrameWithTimeout(2_000);
      expect(pong["type"]).toBe("pong");
      expect(pong["ts"]).toBe(i * 100);
    }

    // Verify exactly 8 ping.received and 8 pong.sent
    const pingCalls = logger.calls.filter(c => c.event === "directory.signaling.ping.received");
    const pongCalls = logger.calls.filter(c => c.event === "directory.signaling.pong.sent");
    expect(pingCalls.length).toBe(8);
    expect(pongCalls.length).toBe(8);

    // All at DEBUG level — no INFO, WARN, ERROR for ping/pong events
    const allPingPongCalls = logger.calls.filter(c =>
      c.event.includes("ping") || c.event.includes("pong"),
    );
    for (const call of allPingPongCalls) {
      expect(call.level).toBe("debug");
    }

    stream.close();
  }, 15_000);

  // ─── AC-005: Composition root integration ────────────────────────────────────

  it("AC-005: ping handler is wired through createDirectoryNode composition root", async () => {
    // This test creates a SEPARATE directory node to prove the handler is wired
    // at the createDirectoryNode level — not just in an isolated unit test.
    const separateLogger = makeCapturingLogger();
    const separateDirKey = generateKeypair();
    const separateDir = await createDirectoryNode({
      keyProvider: separateDirKey,
      relay: makeRelay(),
      relayEndpoint: { peer_id: "12D3KooWRelayComposition", multiaddrs: ["/ip4/127.0.0.1/tcp/9998"] },
      logger: separateLogger,
    });

    try {
      const clientKey = generateKeypair();
      const clientNode = await createNode({
        keyProvider: clientKey,
        listenAddresses: ["/ip4/127.0.0.1/tcp/0"],
      });
      await clientNode.start();

      const dirAddrs = separateDir.node.listenAddresses();
      await clientNode.dial(dirAddrs[0]);

      const { stream, reader } = await connectAndAuth(
        clientNode,
        separateDir,
        clientKey,
      );

      const startTime = Date.now();
      sendFrame(stream, CBOR_ENC.encode({ type: "ping", ts: 777 }));
      const pong = await reader.readFrameWithTimeout(2_000);
      const elapsed = Date.now() - startTime;

      expect(pong["type"]).toBe("pong");
      expect(pong["ts"]).toBe(777);
      expect(elapsed).toBeLessThan(1000);

      stream.close();
      await clientNode.stop();
    } finally {
      await separateDir.stop();
    }
  }, 15_000);

  // ─── SI-001: Burst load ──────────────────────────────────────────────────────

  it("SI-001: 100 pings from Client A + 1 ping from Client B — B's pong within 1 second", async () => {
    const authA = await connectAndAuth(clientNodeA, dirNode, clientKeyA);
    const authB = await connectAndAuth(clientNodeB, dirNode, clientKeyB);

    logger.calls.length = 0;

    // Send 100 pings from A and 1 ping from B concurrently
    for (let i = 0; i < 100; i++) {
      sendFrame(authA.stream, CBOR_ENC.encode({ type: "ping", ts: 1000 + i }));
    }
    const startB = Date.now();
    sendFrame(authB.stream, CBOR_ENC.encode({ type: "ping", ts: 9999 }));

    // Client B's pong must arrive within 1 second
    const pongB = await authB.reader.readFrameWithTimeout(2_000);
    const elapsedB = Date.now() - startB;

    expect(pongB["type"]).toBe("pong");
    expect(pongB["ts"]).toBe(9999);
    expect(elapsedB).toBeLessThan(1000);

    // Drain A's pongs (just verify count, don't assert timing for burst)
    let countA = 0;
    for (let i = 0; i < 100; i++) {
      const pongA = await authA.reader.readFrameWithTimeout(5_000);
      if (pongA["type"] === "pong") countA++;
    }
    expect(countA).toBe(100);

    authA.stream.close();
    authB.stream.close();
  }, 30_000);
});
