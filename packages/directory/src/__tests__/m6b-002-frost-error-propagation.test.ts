/**
 * CELLO-M6B-002: FROST ceremony error propagation — directory tests
 *
 * TDD Phase R — RED-first. All tests must fail until implementation is complete.
 *
 * Covers:
 *   AC-001: CEREMONY_TIMEOUT → ceremony_timeout wire reason + frost.ceremony.failed log
 *   AC-002: CEREMONY_EXHAUSTED → ceremony_exhausted wire reason + frost.ceremony.failed log
 *   AC-003: DIRECTORY_BELOW_THRESHOLD → directory_below_threshold (unchanged) + log
 *   AC-004: TypeScript exhaustiveness check on mapCeremonyFailure
 *   AC-008: Integration test with stub IThresholdSigner
 *
 * Crypto refs: FROST / RFC 9591, Ed25519 / RFC 8032, SHA-256 / FIPS 180-4, CBOR / RFC 8949
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
import { decode, Encoder } from "cbor-x";
import * as lp from "it-length-prefixed";
import { createHash } from "node:crypto";
import { generateKeypair } from "@cello-protocol/crypto";
import { createNode } from "@cello-protocol/transport";
import type { Stream } from "@libp2p/interface";
import { createDirectoryNode, SIGNALING_PROTOCOL_ID } from "../directory-node.js";
import type { RelayAdapter } from "../directory-node.js";
import type { RelaySessionAssignment, SessionRequestErrorReason } from "../directory-types.js";
import type { IThresholdSigner, ThresholdSignature } from "@cello-protocol/crypto";

setupV3Tests();

const CBOR_ENC = new Encoder({ tagUint8Array: false });
const AUTH_DOMAIN = "CELLO-DIR-AUTH-v1";

// ─── Helpers ──────────────────────────────────────────────────────────────────

class StreamReader {
  readonly #iter: AsyncIterator<Uint8Array>;
  constructor(stream: Stream) {
    const gen = lp.decode(stream);
    this.#iter = (gen as AsyncIterable<unknown>)[Symbol.asyncIterator]() as AsyncIterator<Uint8Array>;
  }
  async readFrame(): Promise<Uint8Array> {
    const { value, done } = await this.#iter.next();
    if (done || value === undefined) throw new Error("stream ended");
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
}

function sendFrame(stream: Stream, data: Uint8Array): void {
  stream.send(lp.encode.single(data));
}

async function authenticateClient(
  stream: Stream,
  reader: StreamReader,
  kp: ReturnType<typeof generateKeypair>
): Promise<void> {
  const challenge = await reader.readDecoded();
  expect(challenge["type"]).toBe("signaling_auth_challenge");
  const nonce = challenge["nonce"];
  if (!(nonce instanceof Uint8Array) && !Buffer.isBuffer(nonce)) throw new Error("no nonce");
  const nonceBytes = Buffer.isBuffer(nonce) ? new Uint8Array(nonce) : nonce as Uint8Array;

  const pubkey = await kp.getPublicKey();
  const domain = Buffer.from(AUTH_DOMAIN, "utf8");
  const authMsg = new Uint8Array(Buffer.concat([domain, nonceBytes, pubkey]));
  const msgHash = new Uint8Array(createHash("sha256").update(authMsg).digest());
  const signature = await kp.sign(msgHash);
  sendFrame(stream, CBOR_ENC.encode({ type: "signaling_auth_response", pubkey, signature }));
  const ack = await reader.readDecoded();
  if (ack["type"] !== "signaling_auth_ok") throw new Error(`expected signaling_auth_ok, got ${ack["type"]}`);
}

// ─── Stub IThresholdSigner ───────────────────────────────────────────────────

class StubThresholdSigner implements IThresholdSigner {
  readonly #primaryPubkey: Uint8Array;
  readonly #failureReason: "DIRECTORY_BELOW_THRESHOLD" | "CEREMONY_TIMEOUT" | "CEREMONY_EXHAUSTED" | null;

  constructor(primaryPubkey: Uint8Array, failureReason: "DIRECTORY_BELOW_THRESHOLD" | "CEREMONY_TIMEOUT" | "CEREMONY_EXHAUSTED" | null) {
    this.#primaryPubkey = primaryPubkey;
    this.#failureReason = failureReason;
  }

  async participateInCeremony(
    _ceremonyId: string,
    _tbs: Uint8Array,
    _context: string,
    _onProgress?: (event: { type: "commit_collected" | "partial_sig_collected"; index: number; total: number }) => void
  ): Promise<ThresholdSignature> {
    if (this.#failureReason !== null) {
      return { ok: false, error: { reason: this.#failureReason } };
    }
    // Success path not exercised in this story
    throw new Error("StubThresholdSigner success path not implemented");
  }

  getPrimaryPubkey(): Uint8Array {
    return this.#primaryPubkey;
  }

  verifySignature(_signature: Uint8Array, _tbs: Uint8Array, _context: string, _publicKey: Uint8Array): boolean {
    return true;
  }
}

function makeNoopRelayAdapter(): RelayAdapter {
  return {
    recordAssignment(_a: RelaySessionAssignment): { ok: true } | { ok: false; reason: string } {
      return { ok: true };
    },
    discardSession(_id: Uint8Array): void {},
    submitForSeal(_id: Uint8Array): { ok: true; data: import("../directory-types.js").RelaySealData } | { ok: false; reason: string } {
      return { ok: false, reason: "not_implemented" };
    },
    confirmSeal(_id: Uint8Array): void {},
    rejectSeal(_id: Uint8Array, _reason: string): void {},
  };
}

// ─── Test suite ───────────────────────────────────────────────────────────────

const scope = createTestScope();
let logEvents: Array<{ level: string; event: string; context: Record<string, unknown> }>;

beforeEach(() => {
  logEvents = [];
  process.env.NODE_ENV = "test";
});

afterEach(async () => {
  await scope.run(async () => {});
});

describe("CELLO-M6B-002: FROST ceremony error propagation", () => {

  // ─── AC-001: CEREMONY_TIMEOUT → ceremony_timeout + log ───────────────────────

  it("AC-001: directory sends ceremony_timeout reason when FROST times out", async () => {
    const dirKp = generateKeypair();
    const logger = {
      debug(_event: string, _context: Record<string, unknown>) { /* no-op */ },
      info(_event: string, _context: Record<string, unknown>) { /* no-op */ },
      warn(event: string, context: Record<string, unknown>) {
        logEvents.push({ level: "warn", event, context });
      },
      error(_event: string, _context: Record<string, unknown>) { /* no-op */ },
    };

    const { directory, node: dirNode, stop: dirStop } = await createDirectoryNode({
      keyProvider: dirKp,
      relay: makeNoopRelayAdapter(),
      relayEndpoint: { peer_id: "relay-peer", multiaddrs: [] },
      logger,
    });
    scope.addCleanup(dirStop);

    const initiatorKp = generateKeypair();
    const initiatorPubkey = await initiatorKp.getPublicKey();
    const initiatorPubkeyHex = Buffer.from(initiatorPubkey).toString("hex");

    const targetKp = generateKeypair();
    const targetPubkey = await targetKp.getPublicKey();
    const targetPubkeyHex = Buffer.from(targetPubkey).toString("hex");

    // Create nodes
    const nodeA = await createNode({ keyProvider: initiatorKp, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await nodeA.start();
    scope.addCleanup(() => nodeA.stop());

    const nodeB = await createNode({ keyProvider: targetKp, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await nodeB.start();
    scope.addCleanup(() => nodeB.stop());

    // Register peer info
    const dirAddr = dirNode.listenAddresses()[0]!;
    await nodeA.dial(dirAddr);
    await nodeB.dial(dirAddr);
    directory.registerPeerInfo(initiatorPubkeyHex, nodeA.getPeerId(), nodeA.listenAddresses());
    directory.registerPeerInfo(targetPubkeyHex, nodeB.getPeerId(), nodeB.listenAddresses());

    // Stub signer that returns CEREMONY_TIMEOUT
    const stubSigner = new StubThresholdSigner(initiatorPubkey, "CEREMONY_TIMEOUT");
    directory.registerThresholdSigner(Buffer.from(initiatorPubkey).toString("hex"), stubSigner);

    // Target authenticates (must be online)
    const streamB = await nodeB.newStream(dirNode.getPeerId(), SIGNALING_PROTOCOL_ID);
    const readerB = new StreamReader(streamB);
    await authenticateClient(streamB, readerB, targetKp);

    // Initiator authenticates and sends session_request
    const streamA = await nodeA.newStream(dirNode.getPeerId(), SIGNALING_PROTOCOL_ID);
    const reader = new StreamReader(streamA);
    await authenticateClient(streamA, reader, initiatorKp);

    sendFrame(streamA, CBOR_ENC.encode({
      type: "session_request",
      target_pubkey: targetPubkey,
    }));

    // Read response
    const response = await reader.readDecoded();

    // Assert wire reason
    expect(response["type"]).toBe("session_request_error");
    expect(response["reason"]).toBe("ceremony_timeout");

    // Assert log event
    expect(logEvents.length).toBeGreaterThanOrEqual(1);
    const ceremonyFailedEvent = logEvents.find((e) => e.event === "frost.ceremony.failed");
    expect(ceremonyFailedEvent).toBeDefined();
    expect(ceremonyFailedEvent!.level).toBe("warn");
    expect(ceremonyFailedEvent!.context["reason"]).toBe("ceremony_timeout");
    expect(ceremonyFailedEvent!.context["agentId"]).toBeDefined();
    expect(ceremonyFailedEvent!.context["ceremonyId"]).toBeDefined();
  });

  // ─── AC-002: CEREMONY_EXHAUSTED → ceremony_exhausted + log ───────────────────

  it("AC-002: directory sends ceremony_exhausted reason when FROST returns null", async () => {
    const dirKp = generateKeypair();
    const logger = {
      debug(_event: string, _context: Record<string, unknown>) { /* no-op */ },
      info(_event: string, _context: Record<string, unknown>) { /* no-op */ },
      warn(event: string, context: Record<string, unknown>) {
        logEvents.push({ level: "warn", event, context });
      },
      error(_event: string, _context: Record<string, unknown>) { /* no-op */ },
    };

    const { directory, node: dirNode, stop: dirStop } = await createDirectoryNode({
      keyProvider: dirKp,
      relay: makeNoopRelayAdapter(),
      relayEndpoint: { peer_id: "relay-peer", multiaddrs: [] },
      logger,
    });
    scope.addCleanup(dirStop);

    const initiatorKp = generateKeypair();
    const initiatorPubkey = await initiatorKp.getPublicKey();
    const initiatorPubkeyHex = Buffer.from(initiatorPubkey).toString("hex");

    const targetKp = generateKeypair();
    const targetPubkey = await targetKp.getPublicKey();
    const targetPubkeyHex = Buffer.from(targetPubkey).toString("hex");

    const nodeA = await createNode({ keyProvider: initiatorKp, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await nodeA.start();
    scope.addCleanup(() => nodeA.stop());

    const nodeB = await createNode({ keyProvider: targetKp, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await nodeB.start();
    scope.addCleanup(() => nodeB.stop());

    const dirAddr = dirNode.listenAddresses()[0]!;
    await nodeA.dial(dirAddr);
    await nodeB.dial(dirAddr);
    directory.registerPeerInfo(initiatorPubkeyHex, nodeA.getPeerId(), nodeA.listenAddresses());
    directory.registerPeerInfo(targetPubkeyHex, nodeB.getPeerId(), nodeB.listenAddresses());

    // Stub signer that returns CEREMONY_EXHAUSTED
    const stubSigner = new StubThresholdSigner(initiatorPubkey, "CEREMONY_EXHAUSTED");
    directory.registerThresholdSigner(Buffer.from(initiatorPubkey).toString("hex"), stubSigner);

    const streamB = await nodeB.newStream(dirNode.getPeerId(), SIGNALING_PROTOCOL_ID);
    const readerB = new StreamReader(streamB);
    await authenticateClient(streamB, readerB, targetKp);

    const streamA = await nodeA.newStream(dirNode.getPeerId(), SIGNALING_PROTOCOL_ID);
    const reader = new StreamReader(streamA);
    await authenticateClient(streamA, reader, initiatorKp);

    sendFrame(streamA, CBOR_ENC.encode({
      type: "session_request",
      target_pubkey: targetPubkey,
    }));

    const response = await reader.readDecoded();

    expect(response["type"]).toBe("session_request_error");
    expect(response["reason"]).toBe("ceremony_exhausted");

    const ceremonyFailedEvent = logEvents.find((e) => e.event === "frost.ceremony.failed");
    expect(ceremonyFailedEvent).toBeDefined();
    expect(ceremonyFailedEvent!.level).toBe("warn");
    expect(ceremonyFailedEvent!.context["reason"]).toBe("ceremony_exhausted");
  });

  // ─── AC-003: DIRECTORY_BELOW_THRESHOLD → directory_below_threshold (unchanged) ───

  it("AC-003: directory sends directory_below_threshold for DIRECTORY_BELOW_THRESHOLD (backward-compatible)", async () => {
    const dirKp = generateKeypair();
    const logger = {
      debug(_event: string, _context: Record<string, unknown>) { /* no-op */ },
      info(_event: string, _context: Record<string, unknown>) { /* no-op */ },
      warn(event: string, context: Record<string, unknown>) {
        logEvents.push({ level: "warn", event, context });
      },
      error(_event: string, _context: Record<string, unknown>) { /* no-op */ },
    };

    const { directory, node: dirNode, stop: dirStop } = await createDirectoryNode({
      keyProvider: dirKp,
      relay: makeNoopRelayAdapter(),
      relayEndpoint: { peer_id: "relay-peer", multiaddrs: [] },
      logger,
    });
    scope.addCleanup(dirStop);

    const initiatorKp = generateKeypair();
    const initiatorPubkey = await initiatorKp.getPublicKey();
    const initiatorPubkeyHex = Buffer.from(initiatorPubkey).toString("hex");

    const targetKp = generateKeypair();
    const targetPubkey = await targetKp.getPublicKey();
    const targetPubkeyHex = Buffer.from(targetPubkey).toString("hex");

    const nodeA = await createNode({ keyProvider: initiatorKp, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await nodeA.start();
    scope.addCleanup(() => nodeA.stop());

    const nodeB = await createNode({ keyProvider: targetKp, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await nodeB.start();
    scope.addCleanup(() => nodeB.stop());

    const dirAddr = dirNode.listenAddresses()[0]!;
    await nodeA.dial(dirAddr);
    await nodeB.dial(dirAddr);
    directory.registerPeerInfo(initiatorPubkeyHex, nodeA.getPeerId(), nodeA.listenAddresses());
    directory.registerPeerInfo(targetPubkeyHex, nodeB.getPeerId(), nodeB.listenAddresses());

    const stubSigner = new StubThresholdSigner(initiatorPubkey, "DIRECTORY_BELOW_THRESHOLD");
    directory.registerThresholdSigner(Buffer.from(initiatorPubkey).toString("hex"), stubSigner);

    const streamB = await nodeB.newStream(dirNode.getPeerId(), SIGNALING_PROTOCOL_ID);
    const readerB = new StreamReader(streamB);
    await authenticateClient(streamB, readerB, targetKp);

    const streamA = await nodeA.newStream(dirNode.getPeerId(), SIGNALING_PROTOCOL_ID);
    const reader = new StreamReader(streamA);
    await authenticateClient(streamA, reader, initiatorKp);

    sendFrame(streamA, CBOR_ENC.encode({
      type: "session_request",
      target_pubkey: targetPubkey,
    }));

    const response = await reader.readDecoded();

    expect(response["type"]).toBe("session_request_error");
    expect(response["reason"]).toBe("directory_below_threshold");

    const ceremonyFailedEvent = logEvents.find((e) => e.event === "frost.ceremony.failed");
    expect(ceremonyFailedEvent).toBeDefined();
    expect(ceremonyFailedEvent!.context["reason"]).toBe("directory_below_threshold");
  });

  // ─── AC-004: TypeScript exhaustiveness check ─────────────────────────────────

  it("AC-004: SessionRequestErrorReason type includes ceremony_timeout and ceremony_exhausted", () => {
    // This test verifies that the two new union members are present in the type.
    // If the type is incorrect, this assignment will fail at compile time.
    const timeout: SessionRequestErrorReason = "ceremony_timeout";
    const exhausted: SessionRequestErrorReason = "ceremony_exhausted";
    const belowThreshold: SessionRequestErrorReason = "directory_below_threshold";

    expect(timeout).toBe("ceremony_timeout");
    expect(exhausted).toBe("ceremony_exhausted");
    expect(belowThreshold).toBe("directory_below_threshold");
  });

  // ─── SI-001: frost.ceremony.failed must not leak key material ────────────────

  it("SI-001: frost.ceremony.failed log event contains only agentId, reason, and ceremonyId", async () => {
    const dirKp = generateKeypair();
    const logger = {
      debug(_event: string, _context: Record<string, unknown>) { /* no-op */ },
      info(_event: string, _context: Record<string, unknown>) { /* no-op */ },
      warn(event: string, context: Record<string, unknown>) {
        logEvents.push({ level: "warn", event, context });
      },
      error(_event: string, _context: Record<string, unknown>) { /* no-op */ },
    };

    const { directory, node: dirNode, stop: dirStop } = await createDirectoryNode({
      keyProvider: dirKp,
      relay: makeNoopRelayAdapter(),
      relayEndpoint: { peer_id: "relay-peer", multiaddrs: [] },
      logger,
    });
    scope.addCleanup(dirStop);

    const initiatorKp = generateKeypair();
    const initiatorPubkey = await initiatorKp.getPublicKey();
    const initiatorPubkeyHex = Buffer.from(initiatorPubkey).toString("hex");

    const targetKp = generateKeypair();
    const targetPubkey = await targetKp.getPublicKey();
    const targetPubkeyHex = Buffer.from(targetPubkey).toString("hex");

    const nodeA = await createNode({ keyProvider: initiatorKp, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await nodeA.start();
    scope.addCleanup(() => nodeA.stop());

    const nodeB = await createNode({ keyProvider: targetKp, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await nodeB.start();
    scope.addCleanup(() => nodeB.stop());

    const dirAddr = dirNode.listenAddresses()[0]!;
    await nodeA.dial(dirAddr);
    await nodeB.dial(dirAddr);
    directory.registerPeerInfo(initiatorPubkeyHex, nodeA.getPeerId(), nodeA.listenAddresses());
    directory.registerPeerInfo(targetPubkeyHex, nodeB.getPeerId(), nodeB.listenAddresses());

    // Trigger ceremony failure
    const stubSigner = new StubThresholdSigner(initiatorPubkey, "CEREMONY_TIMEOUT");
    directory.registerThresholdSigner(Buffer.from(initiatorPubkey).toString("hex"), stubSigner);

    const streamB = await nodeB.newStream(dirNode.getPeerId(), SIGNALING_PROTOCOL_ID);
    const readerB = new StreamReader(streamB);
    await authenticateClient(streamB, readerB, targetKp);

    const streamA = await nodeA.newStream(dirNode.getPeerId(), SIGNALING_PROTOCOL_ID);
    const reader = new StreamReader(streamA);
    await authenticateClient(streamA, reader, initiatorKp);

    sendFrame(streamA, CBOR_ENC.encode({
      type: "session_request",
      target_pubkey: targetPubkey,
    }));

    await reader.readDecoded(); // consume the error response

    // Verify the log event context
    const ceremonyFailedEvent = logEvents.find((e) => e.event === "frost.ceremony.failed");
    expect(ceremonyFailedEvent).toBeDefined();

    // SI-001: Assert exact context shape — only agentId, reason, and ceremonyId
    const context = ceremonyFailedEvent!.context;
    const contextKeys = Object.keys(context).sort();
    expect(contextKeys).toEqual(["agentId", "ceremonyId", "reason"]);

    // SI-001: Assert no key material fields are present
    expect(context).not.toHaveProperty("share");
    expect(context).not.toHaveProperty("shares");
    expect(context).not.toHaveProperty("signature");
    expect(context).not.toHaveProperty("partial");
    expect(context).not.toHaveProperty("partial_sig");
    expect(context).not.toHaveProperty("partial_signature");
    expect(context).not.toHaveProperty("commitment");
    expect(context).not.toHaveProperty("nonce");
    expect(context).not.toHaveProperty("secret");
    expect(context).not.toHaveProperty("key");
    expect(context).not.toHaveProperty("privateKey");
    expect(context).not.toHaveProperty("keyShare");

    // Verify the values are correct
    expect(typeof context["agentId"]).toBe("string");
    expect(context["agentId"]).toHaveLength(16); // truncated hex
    expect(context["reason"]).toBe("ceremony_timeout");
    expect(typeof context["ceremonyId"]).toBe("string");
    expect(context["ceremonyId"]).toHaveLength(16); // truncated hex
  });
});
