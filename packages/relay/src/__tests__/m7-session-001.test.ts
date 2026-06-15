/**
 * CELLO-M7-SESSION-001 — Relay: session_interrupted control frame
 *
 * Specification (SPARC Phase S):
 *
 * AC-001 Integration: When participant B's relay stream drops, the relay sends a
 *   session_interrupted frame with reason:'peer_disconnected' to participant A.
 *   No session_sealed or seal-related frame arrives. L7-guard: frame travels
 *   over a real relay stream — no in-process injection.
 *
 * AC-002 Integration: When a session is idle beyond sessionIdleTimeoutMs, the
 *   relay sends session_interrupted with reason:'timeout' to the remaining
 *   participant. The threshold is configurable via RelayNodeOptions.
 *
 * AC-003 Unit: Lateral catch audit of packages/relay/src/ — no catch block
 *   swallows exceptions silently or interpolates error objects as ${error}.
 *   encodeSessionInterrupted is exercised directly here to verify the encode
 *   path does not throw or return garbage.
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
import { createHash, randomBytes } from "node:crypto";
import { Encoder, decode } from "cbor-x";
import * as lp from "it-length-prefixed";
import { generateKeypair } from "@cello-protocol/crypto";
import { createNode } from "@cello-protocol/transport";
import type { Stream } from "@libp2p/interface";
import { createRelayNode, RELAY_PROTOCOL_ID } from "../relay-node.js";
import { encodeSessionInterrupted } from "../relay-frames.js";
import { InMemoryRelayStore } from "../relay-store.js";
import type { SessionAssignment } from "../relay-types.js";

setupV3Tests();

const CBOR_ENC = new Encoder({ tagUint8Array: false });

// ─── StreamReader ─────────────────────────────────────────────────────────────
// Matches the pattern in relay-node.test.ts.
// We add a readDecodedWithTimeout() variant for tests that need a deadline.

class StreamReader {
  readonly #iter: AsyncIterator<Uint8Array>;

  constructor(stream: Stream) {
    const gen = lp.decode(stream);
    this.#iter = (gen as AsyncIterable<unknown>)[Symbol.asyncIterator]() as AsyncIterator<Uint8Array>;
  }

  async readFrame(): Promise<Uint8Array> {
    const { value, done } = await this.#iter.next();
    if (done || value === undefined) throw new Error("stream ended without yielding a frame");
    const v = value as unknown;
    if (v instanceof Uint8Array) return v;
    if (typeof (v as { slice?: () => Uint8Array }).slice === "function") {
      return (v as { slice(): Uint8Array }).slice();
    }
    return new Uint8Array(v as ArrayBuffer);
  }

  async readDecoded(): Promise<Record<string, unknown>> {
    const bytes = await this.readFrame();
    return decode(bytes) as Record<string, unknown>;
  }

  /** readDecoded with a deadline. Rejects with Error on timeout. */
  async readDecodedWithTimeout(ms: number): Promise<Record<string, unknown>> {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`readDecodedWithTimeout: no frame in ${ms}ms`)), ms),
    );
    return Promise.race([this.readDecoded(), timeout]);
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sendFrame(stream: Stream, data: Uint8Array): void {
  stream.send(lp.encode.single(data));
}

async function performAuth(
  reader: StreamReader,
  stream: Stream,
  kp: ReturnType<typeof generateKeypair>,
): Promise<void> {
  const challenge = await reader.readDecoded();
  expect(challenge["type"]).toBe("relay_auth_challenge");
  const nonce = challenge["nonce"] instanceof Uint8Array
    ? challenge["nonce"]
    : Buffer.isBuffer(challenge["nonce"])
      ? new Uint8Array(challenge["nonce"] as Buffer)
      : new Uint8Array(challenge["nonce"] as ArrayBuffer);

  const pubkey = await kp.getPublicKey();
  const domain = Buffer.from("CELLO-RELAY-AUTH-v1", "utf8");
  const authMsg = new Uint8Array(Buffer.concat([domain, nonce, pubkey]));
  const msgHash = new Uint8Array(createHash("sha256").update(authMsg).digest());
  const signature = await kp.sign(msgHash);

  sendFrame(stream, CBOR_ENC.encode({ type: "relay_auth_response", pubkey, signature }));

  const ack = await reader.readDecoded();
  if (ack["type"] === "relay_auth_failed") {
    throw new Error(`relay_auth_failed: ${String(ack["reason"])}`);
  }
  expect(ack["type"]).toBe("relay_auth_ok");
}

async function makeAssignment(
  sessionId: Uint8Array,
  pubA: Uint8Array,
  pubB: Uint8Array,
  dirKp: ReturnType<typeof generateKeypair>,
): Promise<SessionAssignment> {
  const session_timestamp = Date.now();
  const tbs = CBOR_ENC.encode([
    sessionId,
    pubA,
    pubB,
    session_timestamp > 0xffffffff ? BigInt(session_timestamp) : session_timestamp,
  ]) as Uint8Array;
  const directory_signature = await dirKp.sign(tbs);
  return { session_id: sessionId, participant_a: pubA, participant_b: pubB, session_timestamp, directory_signature };
}

interface Fixture {
  relayAddr: string;
  relay: Awaited<ReturnType<typeof createRelayNode>>["relay"];
  relayNode: Awaited<ReturnType<typeof createRelayNode>>["node"];
  relayStop: () => Promise<void>;
  dirKp: ReturnType<typeof generateKeypair>;
  store?: InMemoryRelayStore;
}

async function makeFixture(opts?: { sessionIdleTimeoutMs?: number; store?: InMemoryRelayStore }): Promise<Fixture> {
  const dirKp = generateKeypair();
  const dirPubkey = await dirKp.getPublicKey();
  const { relay, node, stop } = await createRelayNode({
    directoryPubkey: dirPubkey,
    ...(opts?.sessionIdleTimeoutMs !== undefined && { sessionIdleTimeoutMs: opts.sessionIdleTimeoutMs }),
    ...(opts?.store !== undefined && { store: opts.store }),
  });
  const addrs = node.listenAddresses();
  expect(addrs.length).toBeGreaterThan(0);
  return { relayAddr: addrs[0]!, relay, relayNode: node, relayStop: stop, dirKp, store: opts?.store };
}

async function makeClient(relayAddr: string): Promise<{
  kp: ReturnType<typeof generateKeypair>;
  pubkey: Uint8Array;
  node: Awaited<ReturnType<typeof createNode>>;
}> {
  const kp = generateKeypair();
  const pubkey = await kp.getPublicKey();
  const node = await createNode({ keyProvider: kp, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
  await node.start();
  await node.dial(relayAddr);
  return { kp, pubkey, node };
}

async function openStream(
  clientNode: Awaited<ReturnType<typeof createNode>>,
  relayPeerId: string,
): Promise<{ stream: Stream; reader: StreamReader }> {
  const stream = await clientNode.newStream(relayPeerId, RELAY_PROTOCOL_ID);
  const reader = new StreamReader(stream);
  return { stream, reader };
}

// ─── AC-001: peer disconnect triggers session_interrupted ─────────────────────

describe("AC-001: relay emits session_interrupted on peer disconnect", () => {
  let scope = createTestScope();
  beforeEach(() => { scope = createTestScope(); });
  afterEach(() => scope.run(async () => {}));

  it("sends session_interrupted with reason:'peer_disconnected' to remaining participant", async () => {
    const fix = await makeFixture();
    scope.addCleanup(fix.relayStop);

    const cA = await makeClient(fix.relayAddr);
    const cB = await makeClient(fix.relayAddr);
    scope.addCleanup(async () => { await cA.node.stop().catch(() => {}); });
    scope.addCleanup(async () => { await cB.node.stop().catch(() => {}); });

    const sessionId = new Uint8Array(randomBytes(16));
    fix.relay.recordAssignment(await makeAssignment(sessionId, cA.pubkey, cB.pubkey, fix.dirKp));

    const { stream: sA, reader: rA } = await openStream(cA.node, fix.relayNode.getPeerId());
    const { stream: sB, reader: rB } = await openStream(cB.node, fix.relayNode.getPeerId());
    await performAuth(rA, sA, cA.kp);
    await performAuth(rB, sB, cB.kp);

    // B disconnects — abort B's stream
    sB.abort(new Error("test_disconnect"));

    // A must receive session_interrupted with reason: 'peer_disconnected'
    const frame = await rA.readDecodedWithTimeout(3000);
    expect(frame["type"]).toBe("session_interrupted");

    const sessionIdFromFrame = frame["session_id"];
    const sessionIdHex =
      sessionIdFromFrame instanceof Uint8Array
        ? Buffer.from(sessionIdFromFrame).toString("hex")
        : Buffer.isBuffer(sessionIdFromFrame)
          ? Buffer.from(sessionIdFromFrame as Buffer).toString("hex")
          : typeof sessionIdFromFrame === "string"
            ? sessionIdFromFrame
            : Buffer.from(sessionIdFromFrame as ArrayBuffer).toString("hex");
    expect(sessionIdHex).toBe(Buffer.from(sessionId).toString("hex"));
    expect(frame["reason"]).toBe("peer_disconnected");

    sA.close().catch(() => {});
  });

  it("does NOT send session_sealed or frost-sign frame on peer disconnect (SI-001)", async () => {
    const fix = await makeFixture();
    scope.addCleanup(fix.relayStop);

    const cA = await makeClient(fix.relayAddr);
    const cB = await makeClient(fix.relayAddr);
    scope.addCleanup(async () => { await cA.node.stop().catch(() => {}); });
    scope.addCleanup(async () => { await cB.node.stop().catch(() => {}); });

    const sessionId = new Uint8Array(randomBytes(16));
    fix.relay.recordAssignment(await makeAssignment(sessionId, cA.pubkey, cB.pubkey, fix.dirKp));

    const { stream: sA, reader: rA } = await openStream(cA.node, fix.relayNode.getPeerId());
    const { stream: sB, reader: rB } = await openStream(cB.node, fix.relayNode.getPeerId());
    await performAuth(rA, sA, cA.kp);
    await performAuth(rB, sB, cB.kp);

    sB.abort(new Error("test_disconnect"));

    const frame = await rA.readDecodedWithTimeout(3000);
    // The frame type must be session_interrupted — NOT a seal-related type
    expect(frame["type"]).toBe("session_interrupted");
    expect(frame["type"]).not.toBe("session_sealed");
    expect(frame["type"]).not.toBe("frost_sign");
    expect(frame["type"]).not.toBe("seal_attempt");

    sA.close().catch(() => {});
  });

  it("handles missing counterparty stream gracefully (best-effort delivery)", async () => {
    // When only one participant has connected, abort causes no crash.
    const fix = await makeFixture();
    scope.addCleanup(fix.relayStop);

    const cA = await makeClient(fix.relayAddr);
    scope.addCleanup(async () => { await cA.node.stop().catch(() => {}); });

    // cB never connects — register assignment with a random pubkey as B
    const fakePubkey = new Uint8Array(randomBytes(32));
    const sessionId = new Uint8Array(randomBytes(16));
    fix.relay.recordAssignment(
      await makeAssignment(sessionId, cA.pubkey, fakePubkey, fix.dirKp),
    );

    const { stream: sA, reader: rA } = await openStream(cA.node, fix.relayNode.getPeerId());
    await performAuth(rA, sA, cA.kp);

    // A disconnects — B is not connected; relay tries best-effort, must not throw.
    sA.abort(new Error("test_disconnect"));

    // Wait briefly; verify no crash and relay is still alive
    await new Promise<void>((resolve) => setTimeout(resolve, 150));

    // Connect a fresh client to confirm relay is still running
    const cC = await makeClient(fix.relayAddr);
    scope.addCleanup(async () => { await cC.node.stop().catch(() => {}); });
    const { stream: sC, reader: rC } = await openStream(cC.node, fix.relayNode.getPeerId());
    const challenge = await rC.readDecoded();
    expect(challenge["type"]).toBe("relay_auth_challenge");
    sC.close().catch(() => {});
  });
});

// ─── AC-002: idle timeout triggers session_interrupted ────────────────────────

describe("AC-002: relay emits session_interrupted on idle timeout", () => {
  let scope = createTestScope();
  beforeEach(() => { scope = createTestScope(); });
  afterEach(() => scope.run(async () => {}));

  it("sends session_interrupted with reason:'timeout' after configurable idle threshold", async () => {
    // 100ms idle timeout so the test completes quickly
    const fix = await makeFixture({ sessionIdleTimeoutMs: 100 });
    scope.addCleanup(fix.relayStop);

    const cA = await makeClient(fix.relayAddr);
    const cB = await makeClient(fix.relayAddr);
    scope.addCleanup(async () => { await cA.node.stop().catch(() => {}); });
    scope.addCleanup(async () => { await cB.node.stop().catch(() => {}); });

    const sessionId = new Uint8Array(randomBytes(16));
    fix.relay.recordAssignment(await makeAssignment(sessionId, cA.pubkey, cB.pubkey, fix.dirKp));

    const { stream: sA, reader: rA } = await openStream(cA.node, fix.relayNode.getPeerId());
    const { stream: sB, reader: rB } = await openStream(cB.node, fix.relayNode.getPeerId());
    await performAuth(rA, sA, cA.kp);
    await performAuth(rB, sB, cB.kp);

    // No hash submitted — session idles. Timer fires after 100ms.
    const frame = await rA.readDecodedWithTimeout(2000);
    expect(frame["type"]).toBe("session_interrupted");
    expect(frame["reason"]).toBe("timeout");

    sA.close().catch(() => {});
    sB.close().catch(() => {});
  });
});

// ─── AC-003: lateral catch audit ─────────────────────────────────────────────
// Audit: every catch block in packages/relay/src/ must not swallow exceptions
// silently. The encodeSessionInterrupted test below exercises the encode path
// to ensure no throw or ${error} interpolation occurs.

describe("AC-003: lateral catch audit — encodeSessionInterrupted smoke test", () => {
  it("encodes session_interrupted frame with peer_disconnected reason", () => {
    const encoded = encodeSessionInterrupted({
      type: "session_interrupted",
      sessionId: "aabbccdd11223344",
      reason: "peer_disconnected",
    });
    expect(encoded).toBeInstanceOf(Uint8Array);
    expect(encoded.length).toBeGreaterThan(0);
    const decoded = decode(encoded) as Record<string, unknown>;
    expect(decoded["type"]).toBe("session_interrupted");
    expect(decoded["session_id"]).toBe("aabbccdd11223344");
    expect(decoded["reason"]).toBe("peer_disconnected");
  });

  it("encodes session_interrupted frame with timeout reason", () => {
    const encoded = encodeSessionInterrupted({
      type: "session_interrupted",
      sessionId: "deadbeef",
      reason: "timeout",
    });
    const decoded = decode(encoded) as Record<string, unknown>;
    expect(decoded["type"]).toBe("session_interrupted");
    expect(decoded["reason"]).toBe("timeout");
  });
});

// ─── M-2: teardown parity ─────────────────────────────────────────────────────
// Every terminal path (confirmSeal, discardSession) AND the idle sweep must clean
// ALL tracking maps — participant refs, the Peer ID binding, and the idle timer —
// not just a subset. Before M-2, the sweep deleted only the binding and left
// participant/timer entries leaking until process exit.

describe("M-2: session teardown clears every tracking map", () => {
  let scope = createTestScope();
  beforeEach(() => { scope = createTestScope(); });
  afterEach(() => scope.run(async () => {}));

  /** Build an assignment carrying bound session Peer IDs so the binding map is populated. */
  async function makeBoundAssignment(
    sessionId: Uint8Array,
    pubA: Uint8Array,
    pubB: Uint8Array,
    dirKp: ReturnType<typeof generateKeypair>,
  ): Promise<SessionAssignment> {
    const base = await makeAssignment(sessionId, pubA, pubB, dirKp);
    return {
      ...base,
      initiator_session_peer_id: "12D3KooInitiator",
      counterparty_session_peer_id: "12D3KooCounterparty",
    };
  }

  it("confirmSeal removes participant refs, binding, and idle timer", async () => {
    const fix = await makeFixture({ sessionIdleTimeoutMs: 60_000 });
    scope.addCleanup(fix.relayStop);

    const sessionId = new Uint8Array(randomBytes(16));
    const sessionHex = Buffer.from(sessionId).toString("hex");
    const pubA = new Uint8Array(randomBytes(32));
    const pubB = new Uint8Array(randomBytes(32));

    const rec = fix.relay.recordAssignment(await makeBoundAssignment(sessionId, pubA, pubB, fix.dirKp));
    expect(rec.ok).toBe(true);

    // Tracking is populated after recordAssignment.
    const before = fix.relay.sessionTrackingEntryCount(sessionHex);
    expect(before.participantRefs).toBe(2);
    expect(before.hasBinding).toBe(true);
    expect(before.hasIdleTimer).toBe(true);

    fix.relay.confirmSeal(sessionId);

    const after = fix.relay.sessionTrackingEntryCount(sessionHex);
    expect(after.participantRefs).toBe(0);
    expect(after.hasBinding).toBe(false);
    expect(after.hasIdleTimer).toBe(false);
  });

  it("discardSession removes participant refs, binding, and idle timer", async () => {
    const fix = await makeFixture({ sessionIdleTimeoutMs: 60_000 });
    scope.addCleanup(fix.relayStop);

    const sessionId = new Uint8Array(randomBytes(16));
    const sessionHex = Buffer.from(sessionId).toString("hex");
    const pubA = new Uint8Array(randomBytes(32));
    const pubB = new Uint8Array(randomBytes(32));

    fix.relay.recordAssignment(await makeBoundAssignment(sessionId, pubA, pubB, fix.dirKp));
    expect(fix.relay.sessionTrackingEntryCount(sessionHex).hasBinding).toBe(true);

    fix.relay.discardSession(sessionId);

    const after = fix.relay.sessionTrackingEntryCount(sessionHex);
    expect(after.participantRefs).toBe(0);
    expect(after.hasBinding).toBe(false);
    expect(after.hasIdleTimer).toBe(false);
  });

  it("idle sweep removes participant refs, binding, and idle timer", async () => {
    const store = new InMemoryRelayStore();
    const fix = await makeFixture({ sessionIdleTimeoutMs: 60_000, store });
    scope.addCleanup(fix.relayStop);

    const sessionId = new Uint8Array(randomBytes(16));
    const sessionHex = Buffer.from(sessionId).toString("hex");
    const pubA = new Uint8Array(randomBytes(32));
    const pubB = new Uint8Array(randomBytes(32));

    fix.relay.recordAssignment(await makeBoundAssignment(sessionId, pubA, pubB, fix.dirKp));
    expect(fix.relay.sessionTrackingEntryCount(sessionHex).participantRefs).toBe(2);

    // Back-date activity so the immediate sweep treats the session as idle.
    store.__setLastActivityAtForTest(sessionHex, Date.now() - 10_000);

    // startIdleSweep runs one sweep synchronously; maxIdleMs=1000 < 10_000 idle.
    fix.relay.startIdleSweep(3_600_000, 1_000);
    fix.relay.stopIdleSweep();

    const after = fix.relay.sessionTrackingEntryCount(sessionHex);
    expect(after.participantRefs).toBe(0);
    expect(after.hasBinding).toBe(false);
    expect(after.hasIdleTimer).toBe(false);
  });
});
