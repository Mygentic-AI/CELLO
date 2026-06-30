/**
 * CELLO-NODE-004: /cello/directory-relay/1.0.0 protocol tests
 *
 * TDD Phase R — RED FIRST.
 * These tests cover the relay-side handler for inbound directory admin frames.
 *
 * Protocol: /cello/directory-relay/1.0.0
 * Direction: directory → relay (record_assignment, discard_session, confirm_seal, reject_seal)
 *            relay → directory (seal_submission)
 *
 * Auth: relay verifies each frame is signed by the known directory Ed25519 pubkey.
 *       Signature domain: "CELLO-DIR-RELAY-v1"
 *       TBS: canonical CBOR of the frame body (excluding directory_signature field)
 *
 * AC-001: record_assignment → assignment_ok; relay accepts hash_submit from participants
 * AC-002: discard_session → discard_ok; subsequent hash_submit returns session_not_found
 * AC-004: confirm_seal → confirm_ok; session destroyed
 * AC-005: reject_seal → reject_ok; session sealed_rejected
 * AC-006: frame with invalid signature → auth_invalid; no state mutation
 * SI-001: frame signed by unknown key → auth_invalid; no state mutation
 * SI-002: hash_submit before record_assignment → session_not_found (same as post-seal)
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
import { createRelayNode, RELAY_PROTOCOL_ID, DIRECTORY_RELAY_PROTOCOL_ID } from "../relay-node.js";
import type { SessionAssignment } from "../relay-types.js";

setupV3Tests();

const CBOR_ENC = new Encoder({ tagUint8Array: false });

// ─── StreamReader ─────────────────────────────────────────────────────────────

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
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toU8(v: unknown): Uint8Array {
  if (v instanceof Uint8Array) return v;
  if (Buffer.isBuffer(v)) return new Uint8Array(v as Buffer);
  throw new Error(`expected bytes, got ${typeof v}`);
}

function sendFrame(stream: Stream, data: Uint8Array): void {
  stream.send(lp.encode.single(data));
}

/**
 * Sign a directory-relay frame body (CBOR bytes of frame minus directory_signature).
 * Domain: "CELLO-DIR-RELAY-v1"
 * TBS: CBOR-encode the frame object without the directory_signature field, then sign those bytes.
 */
async function signFrameBody(
  dirKp: ReturnType<typeof generateKeypair>,
  frameBody: Record<string, unknown>
): Promise<Uint8Array> {
  const tbs = CBOR_ENC.encode(frameBody) as Uint8Array;
  return dirKp.sign(tbs);
}

async function makeAssignment(
  sessionId: Uint8Array,
  pubA: Uint8Array,
  pubB: Uint8Array,
  dirKp: ReturnType<typeof generateKeypair>
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

/**
 * Build and sign a record_assignment frame for the /cello/directory-relay/1.0.0 protocol.
 *
 * Two signatures:
 *   - assignment_signature: standard relay assignment TBS (CBOR [session_id, pubA, pubB, timestamp])
 *     used by recordAssignment() to verify the relay session assignment
 *   - directory_signature: frame body auth sig (CBOR of all fields except directory_signature)
 *     used by the relay's #handleDirectoryRelayStream to authenticate the directory
 */
async function makeRecordAssignmentFrame(
  sessionId: Uint8Array,
  pubA: Uint8Array,
  pubB: Uint8Array,
  sessionTimestamp: number,
  dirKp: ReturnType<typeof generateKeypair>
): Promise<Uint8Array> {
  const tsEncoded = sessionTimestamp > 0xffffffff ? BigInt(sessionTimestamp) : sessionTimestamp;

  // assignment_signature: CBOR([session_id, pubA, pubB, timestamp]) — same as relay's recordAssignment TBS
  const assignmentTbs = CBOR_ENC.encode([sessionId, pubA, pubB, tsEncoded]) as Uint8Array;
  const assignment_signature = await dirKp.sign(assignmentTbs);

  // Frame body (without directory_signature) for frame auth
  const body: Record<string, unknown> = {
    type: "record_assignment",
    session_id: sessionId,
    participant_a: pubA,
    participant_b: pubB,
    session_timestamp: tsEncoded,
    assignment_signature,
  };
  const directory_signature = await signFrameBody(dirKp, body);
  return CBOR_ENC.encode({ ...body, directory_signature }) as Uint8Array;
}

async function makeDiscardSessionFrame(
  sessionId: Uint8Array,
  dirKp: ReturnType<typeof generateKeypair>
): Promise<Uint8Array> {
  const body: Record<string, unknown> = { type: "discard_session", session_id: sessionId };
  const directory_signature = await signFrameBody(dirKp, body);
  return CBOR_ENC.encode({ ...body, directory_signature }) as Uint8Array;
}

async function makeConfirmSealFrame(
  sessionId: Uint8Array,
  dirKp: ReturnType<typeof generateKeypair>
): Promise<Uint8Array> {
  const body: Record<string, unknown> = { type: "confirm_seal", session_id: sessionId };
  const directory_signature = await signFrameBody(dirKp, body);
  return CBOR_ENC.encode({ ...body, directory_signature }) as Uint8Array;
}

async function makeRejectSealFrame(
  sessionId: Uint8Array,
  reason: string,
  dirKp: ReturnType<typeof generateKeypair>
): Promise<Uint8Array> {
  const body: Record<string, unknown> = { type: "reject_seal", session_id: sessionId, reason };
  const directory_signature = await signFrameBody(dirKp, body);
  return CBOR_ENC.encode({ ...body, directory_signature }) as Uint8Array;
}

/**
 * Open a /cello/directory-relay/1.0.0 stream from a directory-side node to the relay.
 * Returns stream and reader.
 */
async function openDirRelayStream(
  dirNode: Awaited<ReturnType<typeof createNode>>,
  relayPeerId: string,
  relayAddrs: string[]
): Promise<{ stream: Stream; reader: StreamReader }> {
  // Ensure we're connected to the relay
  for (const addr of relayAddrs) {
    try { await dirNode.dial(addr); break; } catch { /* continue */ }
  }
  const stream = await dirNode.newStream(relayPeerId, DIRECTORY_RELAY_PROTOCOL_ID);
  const reader = new StreamReader(stream);
  return { stream, reader };
}

// ─── Relay auth helpers (for /cello/relay/1.0.0 client streams) ───────────────

async function performRelayAuth(
  reader: StreamReader,
  stream: Stream,
  kp: ReturnType<typeof generateKeypair>
): Promise<void> {
  const challenge = await reader.readDecoded();
  expect(challenge["type"]).toBe("relay_auth_challenge");
  const nonce = toU8(challenge["nonce"]);

  const pubkey = await kp.getPublicKey();
  const domain = Buffer.from("CELLO-RELAY-AUTH-v1", "utf8");
  const authMsg = new Uint8Array(Buffer.concat([domain, nonce, pubkey]));
  const msgHash = new Uint8Array(createHash("sha256").update(authMsg).digest());
  const signature = await kp.sign(msgHash);

  sendFrame(stream, CBOR_ENC.encode({ type: "relay_auth_response", pubkey, signature }));

  const ack = await reader.readDecoded();
  if (ack["type"] === "relay_auth_failed") {
    throw new Error(`relay_auth_failed: ${ack["reason"]}`);
  }
  expect(ack["type"]).toBe("relay_auth_ok");
}

async function makeStructure1(
  sessionId: Uint8Array,
  contentHash: Uint8Array,
  kp: ReturnType<typeof generateKeypair>,
  lastSeenSeq: number
): Promise<{ structure1_cbor: Uint8Array; sender_signature: Uint8Array }> {
  const pubkey = await kp.getPublicKey();
  const ts = Date.now();
  const tbs = CBOR_ENC.encode([1, contentHash, pubkey, sessionId, lastSeenSeq, ts]) as Uint8Array;
  const sender_signature = await kp.sign(tbs);
  return { structure1_cbor: tbs, sender_signature };
}

// ─── Fixture ──────────────────────────────────────────────────────────────────

interface Fixture {
  relayAddr: string;
  relayPeerId: string;
  relayAddrs: string[];
  relay: Awaited<ReturnType<typeof createRelayNode>>["relay"];
  relayNode: Awaited<ReturnType<typeof createNode>>;
  relayStop: () => Promise<void>;
  dirKp: ReturnType<typeof generateKeypair>;
  dirPubkey: Uint8Array;
}

async function makeFixture(): Promise<Fixture> {
  const dirKp = generateKeypair();
  const dirPubkey = await dirKp.getPublicKey();
  const { relay, node, stop } = await createRelayNode({ directoryPubkey: dirPubkey });
  const addrs = node.listenAddresses();
  expect(addrs.length).toBeGreaterThan(0);
  return {
    relayAddr: addrs[0]!,
    relayPeerId: node.getPeerId(),
    relayAddrs: addrs,
    relay,
    relayNode: node,
    relayStop: stop,
    dirKp,
    dirPubkey,
  };
}

// ─── AC-001: record_assignment → assignment_ok; relay accepts subsequent hash_submit ─────────────

describe("AC-001: record_assignment over network → assignment_ok, relay accepts hash_submit", () => {
  let scope = createTestScope();
  beforeEach(() => { scope = createTestScope(); });
  afterEach(() => scope.run(async () => {}));

  it("directory sends record_assignment, relay responds assignment_ok, clients can submit hashes", async () => {
    const fix = await makeFixture();
    scope.addCleanup(fix.relayStop);

    // Directory-side node
    const dirKp = generateKeypair();
    const dirNode = await createNode({ keyProvider: dirKp, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await dirNode.start();
    scope.addCleanup(async () => { await dirNode.stop(); });

    // Client nodes
    const clientKpA = generateKeypair();
    const clientKpB = generateKeypair();
    const pubA = await clientKpA.getPublicKey();
    const pubB = await clientKpB.getPublicKey();

    const sessionId = new Uint8Array(randomBytes(16));
    const sessionTimestamp = Date.now();

    // Send record_assignment over /cello/directory-relay/1.0.0
    const { stream: dirStream, reader: dirReader } = await openDirRelayStream(
      dirNode, fix.relayPeerId, fix.relayAddrs
    );
    scope.addCleanup(async () => { dirStream.close().catch(() => {}); });

    const frame = await makeRecordAssignmentFrame(sessionId, pubA, pubB, sessionTimestamp, fix.dirKp);
    sendFrame(dirStream, frame);

    const response = await dirReader.readDecoded();
    expect(response["type"]).toBe("assignment_ok");

    // Now clients should be able to submit hashes
    const clientNodeA = await createNode({ keyProvider: clientKpA, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    const clientNodeB = await createNode({ keyProvider: clientKpB, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await clientNodeA.start();
    await clientNodeB.start();
    scope.addCleanup(async () => { await clientNodeA.stop(); });
    scope.addCleanup(async () => { await clientNodeB.stop(); });

    await clientNodeA.dial(fix.relayAddr);
    await clientNodeB.dial(fix.relayAddr);

    const streamA = await clientNodeA.newStream(fix.relayPeerId, RELAY_PROTOCOL_ID);
    const readerA = new StreamReader(streamA);
    const streamB = await clientNodeB.newStream(fix.relayPeerId, RELAY_PROTOCOL_ID);
    const readerB = new StreamReader(streamB);
    await performRelayAuth(readerA, streamA, clientKpA);
    await performRelayAuth(readerB, streamB, clientKpB);

    // A submits a hash
    const contentHash = new Uint8Array(randomBytes(32));
    const { structure1_cbor, sender_signature } = await makeStructure1(sessionId, contentHash, clientKpA, 0);
    sendFrame(streamA, CBOR_ENC.encode({
      type: "hash_submit",
      session_id: sessionId,
      leaf_kind: 0x00,
      structure1_cbor,
      sender_signature,
    }));

    const ack = await readerA.readDecoded();
    expect(ack["type"]).toBe("hash_submit_ack");
    expect(ack["sequence_number"]).toBe(1);

    streamA.close().catch(() => {});
    streamB.close().catch(() => {});
  }, 20_000);
});

// ─── AC-002: discard_session → discard_ok; subsequent hash_submit → session_not_found ───────────

describe("AC-002: discard_session → discard_ok; hash_submit returns session_not_found", () => {
  let scope = createTestScope();
  beforeEach(() => { scope = createTestScope(); });
  afterEach(() => scope.run(async () => {}));

  it("relay discards session; hash_submit returns session_not_found", async () => {
    const fix = await makeFixture();
    scope.addCleanup(fix.relayStop);

    const clientKpA = generateKeypair();
    const clientKpB = generateKeypair();
    const pubA = await clientKpA.getPublicKey();
    const pubB = await clientKpB.getPublicKey();

    const sessionId = new Uint8Array(randomBytes(16));
    // First register the session in-process (to have something to discard)
    const assignment = await makeAssignment(sessionId, pubA, pubB, fix.dirKp);
    fix.relay.recordAssignment(assignment);

    // Directory-side node sends discard_session
    const dirNode = await createNode({ keyProvider: generateKeypair(), listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await dirNode.start();
    scope.addCleanup(async () => { await dirNode.stop(); });

    const { stream: dirStream, reader: dirReader } = await openDirRelayStream(
      dirNode, fix.relayPeerId, fix.relayAddrs
    );
    scope.addCleanup(async () => { dirStream.close().catch(() => {}); });

    const frame = await makeDiscardSessionFrame(sessionId, fix.dirKp);
    sendFrame(dirStream, frame);

    const response = await dirReader.readDecoded();
    expect(response["type"]).toBe("discard_ok");

    // Now hash_submit should return session_not_found
    const clientNodeA = await createNode({ keyProvider: clientKpA, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await clientNodeA.start();
    scope.addCleanup(async () => { await clientNodeA.stop(); });
    await clientNodeA.dial(fix.relayAddr);

    const streamA = await clientNodeA.newStream(fix.relayPeerId, RELAY_PROTOCOL_ID);
    const readerA = new StreamReader(streamA);
    await performRelayAuth(readerA, streamA, clientKpA);

    const contentHash = new Uint8Array(randomBytes(32));
    const { structure1_cbor, sender_signature } = await makeStructure1(sessionId, contentHash, clientKpA, 0);
    sendFrame(streamA, CBOR_ENC.encode({
      type: "hash_submit",
      session_id: sessionId,
      leaf_kind: 0x00,
      structure1_cbor,
      sender_signature,
    }));

    const err = await readerA.readDecoded();
    expect(err["type"]).toBe("hash_submit_error");
    expect(err["reason"]).toBe("session_not_found");

    streamA.close().catch(() => {});
  }, 20_000);
});

// ─── AC-004: confirm_seal → confirm_ok; session destroyed ────────────────────

describe("AC-004: confirm_seal → confirm_ok; hash_submit returns session_not_found", () => {
  let scope = createTestScope();
  beforeEach(() => { scope = createTestScope(); });
  afterEach(() => scope.run(async () => {}));

  it("relay confirms seal; session destroyed", async () => {
    const fix = await makeFixture();
    scope.addCleanup(fix.relayStop);

    const clientKpA = generateKeypair();
    const clientKpB = generateKeypair();
    const pubA = await clientKpA.getPublicKey();
    const pubB = await clientKpB.getPublicKey();

    const sessionId = new Uint8Array(randomBytes(16));
    const assignment = await makeAssignment(sessionId, pubA, pubB, fix.dirKp);
    fix.relay.recordAssignment(assignment);

    // Manually put session into sealing state
    fix.relay.submitForSeal(sessionId);

    const dirNode = await createNode({ keyProvider: generateKeypair(), listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await dirNode.start();
    scope.addCleanup(async () => { await dirNode.stop(); });

    const { stream: dirStream, reader: dirReader } = await openDirRelayStream(
      dirNode, fix.relayPeerId, fix.relayAddrs
    );
    scope.addCleanup(async () => { dirStream.close().catch(() => {}); });

    const frame = await makeConfirmSealFrame(sessionId, fix.dirKp);
    sendFrame(dirStream, frame);

    const response = await dirReader.readDecoded();
    expect(response["type"]).toBe("confirm_ok");

    // Verify session was destroyed: submitForSeal should now return not_found
    const sealResult = fix.relay.submitForSeal(sessionId);
    expect(sealResult.ok).toBe(false);
    if (!sealResult.ok) {
      expect(sealResult.reason).toBe("session_not_found");
    }
  }, 20_000);
});

// ─── AC-005: reject_seal → reject_ok; session sealed_rejected ────────────────

describe("AC-005: reject_seal → reject_ok; hash_submit returns session_sealed", () => {
  let scope = createTestScope();
  beforeEach(() => { scope = createTestScope(); });
  afterEach(() => scope.run(async () => {}));

  it("relay rejects seal; session marked seal_rejected", async () => {
    const fix = await makeFixture();
    scope.addCleanup(fix.relayStop);

    const clientKpA = generateKeypair();
    const clientKpB = generateKeypair();
    const pubA = await clientKpA.getPublicKey();
    const pubB = await clientKpB.getPublicKey();

    const sessionId = new Uint8Array(randomBytes(16));
    const assignment = await makeAssignment(sessionId, pubA, pubB, fix.dirKp);
    fix.relay.recordAssignment(assignment);

    const dirNode = await createNode({ keyProvider: generateKeypair(), listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await dirNode.start();
    scope.addCleanup(async () => { await dirNode.stop(); });

    const { stream: dirStream, reader: dirReader } = await openDirRelayStream(
      dirNode, fix.relayPeerId, fix.relayAddrs
    );
    scope.addCleanup(async () => { dirStream.close().catch(() => {}); });

    const frame = await makeRejectSealFrame(sessionId, "merkle_root_mismatch", fix.dirKp);
    sendFrame(dirStream, frame);

    const response = await dirReader.readDecoded();
    expect(response["type"]).toBe("reject_ok");

    // Verify session is seal_rejected: hash_submit should return session_sealed
    const clientNodeA = await createNode({ keyProvider: clientKpA, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await clientNodeA.start();
    scope.addCleanup(async () => { await clientNodeA.stop(); });
    await clientNodeA.dial(fix.relayAddr);

    const streamA = await clientNodeA.newStream(fix.relayPeerId, RELAY_PROTOCOL_ID);
    const readerA = new StreamReader(streamA);
    await performRelayAuth(readerA, streamA, clientKpA);

    const contentHash = new Uint8Array(randomBytes(32));
    const { structure1_cbor, sender_signature } = await makeStructure1(sessionId, contentHash, clientKpA, 0);
    sendFrame(streamA, CBOR_ENC.encode({
      type: "hash_submit",
      session_id: sessionId,
      leaf_kind: 0x00,
      structure1_cbor,
      sender_signature,
    }));

    const err = await readerA.readDecoded();
    expect(err["type"]).toBe("hash_submit_error");
    expect(err["reason"]).toBe("session_sealed");

    streamA.close().catch(() => {});
  }, 20_000);
});

// ─── AC-006 / SI-001: frame with invalid/wrong signature → auth_invalid ──────

describe("AC-006 / SI-001: invalid directory signature → auth_invalid, no state mutation", () => {
  let scope = createTestScope();
  beforeEach(() => { scope = createTestScope(); });
  afterEach(() => scope.run(async () => {}));

  it("frame signed by unknown key → auth_invalid", async () => {
    const fix = await makeFixture();
    scope.addCleanup(fix.relayStop);

    const unknownKp = generateKeypair(); // not the configured directory key
    const sessionId = new Uint8Array(randomBytes(16));
    const clientKpA = generateKeypair();
    const clientKpB = generateKeypair();
    const pubA = await clientKpA.getPublicKey();
    const pubB = await clientKpB.getPublicKey();
    const sessionTimestamp = Date.now();

    const dirNode = await createNode({ keyProvider: generateKeypair(), listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await dirNode.start();
    scope.addCleanup(async () => { await dirNode.stop(); });

    const { stream: dirStream, reader: dirReader } = await openDirRelayStream(
      dirNode, fix.relayPeerId, fix.relayAddrs
    );
    scope.addCleanup(async () => { dirStream.close().catch(() => {}); });

    // Sign with the wrong key (unknown key, not the configured directory pubkey)
    const frame = await makeRecordAssignmentFrame(sessionId, pubA, pubB, sessionTimestamp, unknownKp);
    sendFrame(dirStream, frame);

    const response = await dirReader.readDecoded();
    expect(response["type"]).toBe("auth_invalid");

    // Verify: session was NOT registered (hash_submit should fail with session_not_found)
    const clientNodeA = await createNode({ keyProvider: clientKpA, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await clientNodeA.start();
    scope.addCleanup(async () => { await clientNodeA.stop(); });
    await clientNodeA.dial(fix.relayAddr);

    const streamA = await clientNodeA.newStream(fix.relayPeerId, RELAY_PROTOCOL_ID);
    const readerA = new StreamReader(streamA);
    await performRelayAuth(readerA, streamA, clientKpA);

    const contentHash = new Uint8Array(randomBytes(32));
    const { structure1_cbor, sender_signature } = await makeStructure1(sessionId, contentHash, clientKpA, 0);
    sendFrame(streamA, CBOR_ENC.encode({
      type: "hash_submit",
      session_id: sessionId,
      leaf_kind: 0x00,
      structure1_cbor,
      sender_signature,
    }));

    const err = await readerA.readDecoded();
    expect(err["type"]).toBe("hash_submit_error");
    expect(err["reason"]).toBe("session_not_found");

    streamA.close().catch(() => {});
  }, 20_000);

  it("frame with corrupted signature bytes → auth_invalid", async () => {
    const fix = await makeFixture();
    scope.addCleanup(fix.relayStop);

    const sessionId = new Uint8Array(randomBytes(16));
    const clientKpA = generateKeypair();
    const clientKpB = generateKeypair();
    const pubA = await clientKpA.getPublicKey();
    const pubB = await clientKpB.getPublicKey();
    const sessionTimestamp = Date.now();

    const dirNode = await createNode({ keyProvider: generateKeypair(), listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await dirNode.start();
    scope.addCleanup(async () => { await dirNode.stop(); });

    const { stream: dirStream, reader: dirReader } = await openDirRelayStream(
      dirNode, fix.relayPeerId, fix.relayAddrs
    );
    scope.addCleanup(async () => { dirStream.close().catch(() => {}); });

    // Build valid frame then corrupt signature
    const body: Record<string, unknown> = {
      type: "record_assignment",
      session_id: sessionId,
      participant_a: pubA,
      participant_b: pubB,
      session_timestamp: sessionTimestamp > 0xffffffff ? BigInt(sessionTimestamp) : sessionTimestamp,
    };
    const goodSig = await signFrameBody(fix.dirKp, body);
    // Corrupt: flip first byte
    const badSig = new Uint8Array(goodSig);
    badSig[0] = (badSig[0]! ^ 0xff);
    const frame = CBOR_ENC.encode({ ...body, directory_signature: badSig }) as Uint8Array;

    sendFrame(dirStream, frame);

    const response = await dirReader.readDecoded();
    expect(response["type"]).toBe("auth_invalid");
  }, 20_000);
});

// ─── SI-NEW: record_assignment without assignment_signature → auth_invalid ────

describe("SI-NEW: record_assignment missing assignment_signature → auth_invalid, no state mutation", () => {
  let scope = createTestScope();
  beforeEach(() => { scope = createTestScope(); });
  afterEach(() => scope.run(async () => {}));

  it("record_assignment without assignment_signature field → auth_invalid", async () => {
    const fix = await makeFixture();
    scope.addCleanup(fix.relayStop);

    const sessionId = new Uint8Array(randomBytes(16));
    const clientKpA = generateKeypair();
    const clientKpB = generateKeypair();
    const pubA = await clientKpA.getPublicKey();
    const pubB = await clientKpB.getPublicKey();
    const sessionTimestamp = Date.now();
    const tsEncoded = sessionTimestamp > 0xffffffff ? BigInt(sessionTimestamp) : sessionTimestamp;

    const dirNode = await createNode({ keyProvider: generateKeypair(), listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await dirNode.start();
    scope.addCleanup(async () => { await dirNode.stop(); });

    const { stream: dirStream, reader: dirReader } = await openDirRelayStream(
      dirNode, fix.relayPeerId, fix.relayAddrs
    );
    scope.addCleanup(async () => { dirStream.close().catch(() => {}); });

    // Build frame body without assignment_signature, sign only directory_signature
    const body: Record<string, unknown> = {
      type: "record_assignment",
      session_id: sessionId,
      participant_a: pubA,
      participant_b: pubB,
      session_timestamp: tsEncoded,
      // assignment_signature intentionally omitted
    };
    const directory_signature = await signFrameBody(fix.dirKp, body);
    const frame = CBOR_ENC.encode({ ...body, directory_signature }) as Uint8Array;

    sendFrame(dirStream, frame);

    const response = await dirReader.readDecoded();
    expect(response["type"]).toBe("auth_invalid");

    // Verify: session was NOT registered
    const clientNodeA = await createNode({ keyProvider: clientKpA, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await clientNodeA.start();
    scope.addCleanup(async () => { await clientNodeA.stop(); });
    await clientNodeA.dial(fix.relayAddr);

    const streamA = await clientNodeA.newStream(fix.relayPeerId, RELAY_PROTOCOL_ID);
    const readerA = new StreamReader(streamA);
    await performRelayAuth(readerA, streamA, clientKpA);

    const contentHash = new Uint8Array(randomBytes(32));
    const { structure1_cbor, sender_signature } = await makeStructure1(sessionId, contentHash, clientKpA, 0);
    sendFrame(streamA, CBOR_ENC.encode({
      type: "hash_submit",
      session_id: sessionId,
      leaf_kind: 0x00,
      structure1_cbor,
      sender_signature,
    }));

    const err = await readerA.readDecoded();
    expect(err["type"]).toBe("hash_submit_error");
    expect(err["reason"]).toBe("session_not_found");

    streamA.close().catch(() => {});
  }, 20_000);
});

// ─── SI-002: hash_submit before record_assignment → session_not_found ────────

describe("SI-002: hash_submit before record_assignment → session_not_found (no timing side channel)", () => {
  let scope = createTestScope();
  beforeEach(() => { scope = createTestScope(); });
  afterEach(() => scope.run(async () => {}));

  it("hash_submit to unregistered session returns session_not_found", async () => {
    const fix = await makeFixture();
    scope.addCleanup(fix.relayStop);

    const clientKpA = generateKeypair();
    const unregisteredSessionId = new Uint8Array(randomBytes(16));

    const clientNodeA = await createNode({ keyProvider: clientKpA, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await clientNodeA.start();
    scope.addCleanup(async () => { await clientNodeA.stop(); });
    await clientNodeA.dial(fix.relayAddr);

    const streamA = await clientNodeA.newStream(fix.relayPeerId, RELAY_PROTOCOL_ID);
    const readerA = new StreamReader(streamA);
    await performRelayAuth(readerA, streamA, clientKpA);

    const contentHash = new Uint8Array(randomBytes(32));
    const { structure1_cbor, sender_signature } = await makeStructure1(unregisteredSessionId, contentHash, clientKpA, 0);
    sendFrame(streamA, CBOR_ENC.encode({
      type: "hash_submit",
      session_id: unregisteredSessionId,
      leaf_kind: 0x00,
      structure1_cbor,
      sender_signature,
    }));

    const err = await readerA.readDecoded();
    expect(err["type"]).toBe("hash_submit_error");
    // Must be session_not_found — same error as post-seal (no timing side channel)
    expect(err["reason"]).toBe("session_not_found");

    streamA.close().catch(() => {});
  }, 10_000);
});

// ─── FED-OPTIONB-SETUP-001: client_record_assignment (Option B any-relay/any-directory) ──────────
//
// Under Option B the CLIENT (not the directory) presents the directory-signed assignment to its chosen
// relay over its authenticated client stream — a `client_record_assignment` frame with NO directory-admin
// body signature (a client cannot impersonate the directory). Its authority is `assignment_signature`,
// the per-node directory signature over the relay TBS, which the relay verifies against the consortium
// directory pubkey SET. These tests prove the any-directory acceptance (a NON-primary consortium node's
// signature is accepted) AND the security teeth (a non-consortium / forged signature is REJECTED loud).

/** Build a client_record_assignment frame; assignment_signature signs CBOR([session_id, pubA, pubB, ts]). */
async function makeClientRecordAssignmentFrame(
  sessionId: Uint8Array,
  pubA: Uint8Array,
  pubB: Uint8Array,
  sessionTimestamp: number,
  signerKp: ReturnType<typeof generateKeypair>,
): Promise<Uint8Array> {
  const tsEncoded = sessionTimestamp > 0xffffffff ? BigInt(sessionTimestamp) : sessionTimestamp;
  const assignmentTbs = CBOR_ENC.encode([sessionId, pubA, pubB, tsEncoded]) as Uint8Array;
  const assignment_signature = await signerKp.sign(assignmentTbs);
  return CBOR_ENC.encode({
    type: "client_record_assignment",
    session_id: sessionId,
    participant_a: pubA,
    participant_b: pubB,
    session_timestamp: tsEncoded,
    assignment_signature,
  }) as Uint8Array;
}

describe("FED-OPTIONB-SETUP-001: client_record_assignment — any-directory verify against the consortium set", () => {
  let scope = createTestScope();
  beforeEach(() => { scope = createTestScope(); });
  afterEach(() => scope.run(async () => {}));

  /** A relay whose consortium set is [node0, node1]; node0 is the primary (admin) directory pubkey. */
  async function makeConsortiumRelay() {
    const node0Kp = generateKeypair();
    const node1Kp = generateKeypair();
    const node0Pub = await node0Kp.getPublicKey();
    const node1Pub = await node1Kp.getPublicKey();
    const { relay, node, stop } = await createRelayNode({
      directoryPubkey: node0Pub,
      directoryPubkeys: [node0Pub, node1Pub],
    });
    scope.addCleanup(stop);
    return { relay, node, relayPeerId: node.getPeerId(), relayAddr: node.listenAddresses()[0]!, node0Kp, node1Kp };
  }

  async function authedClientStream(relayPeerId: string, relayAddr: string, kp: ReturnType<typeof generateKeypair>) {
    const cn = await createNode({ keyProvider: kp, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await cn.start();
    scope.addCleanup(async () => { await cn.stop(); });
    await cn.dial(relayAddr);
    const stream = await cn.newStream(relayPeerId, RELAY_PROTOCOL_ID);
    const reader = new StreamReader(stream);
    await performRelayAuth(reader, stream, kp);
    return { stream, reader };
  }

  it("a NON-primary consortium node's (node1) client-presented assignment is ACCEPTED → assignment_ok (any-directory)", async () => {
    const fix = await makeConsortiumRelay();
    const clientKp = generateKeypair();
    const pubA = await clientKp.getPublicKey();
    const pubB = await generateKeypair().getPublicKey();
    const { stream, reader } = await authedClientStream(fix.relayPeerId, fix.relayAddr, clientKp);

    const sessionId = new Uint8Array(randomBytes(16));
    // Signed by node1 — NOT the primary directoryPubkey. The old single-pubkey relay would reject this.
    const frame = await makeClientRecordAssignmentFrame(sessionId, pubA, pubB, Date.now(), fix.node1Kp);
    sendFrame(stream, frame);

    const resp = await reader.readDecoded();
    expect(resp["type"]).toBe("assignment_ok");
    stream.close().catch(() => {});
  }, 15_000);

  it("a NON-consortium (forged) signature is REJECTED → assignment_invalid (fail loud, not fail open)", async () => {
    const fix = await makeConsortiumRelay();
    const clientKp = generateKeypair();
    const pubA = await clientKp.getPublicKey();
    const pubB = await generateKeypair().getPublicKey();
    const { stream, reader } = await authedClientStream(fix.relayPeerId, fix.relayAddr, clientKp);

    const sessionId = new Uint8Array(randomBytes(16));
    // Signed by an OUTSIDER key that is in neither directoryPubkey nor directoryPubkeys.
    const outsiderKp = generateKeypair();
    const frame = await makeClientRecordAssignmentFrame(sessionId, pubA, pubB, Date.now(), outsiderKp);
    sendFrame(stream, frame);

    const resp = await reader.readDecoded();
    expect(resp["type"]).toBe("assignment_invalid");
    expect(resp["reason"]).toBe("directory_signature_invalid");
    stream.close().catch(() => {});
  }, 15_000);

  it("after a client_record_assignment, the relay accepts the session's hash_submit (the session was recorded)", async () => {
    const fix = await makeConsortiumRelay();
    const clientKp = generateKeypair();
    const pubA = await clientKp.getPublicKey();
    const pubB = await generateKeypair().getPublicKey();
    const { stream, reader } = await authedClientStream(fix.relayPeerId, fix.relayAddr, clientKp);

    const sessionId = new Uint8Array(randomBytes(16));
    sendFrame(stream, await makeClientRecordAssignmentFrame(sessionId, pubA, pubB, Date.now(), fix.node1Kp));
    expect((await reader.readDecoded())["type"]).toBe("assignment_ok");

    // The session is now recorded (by the CLIENT) — a hash_submit from A is witnessed + sequenced.
    const contentHash = new Uint8Array(randomBytes(32));
    const { structure1_cbor, sender_signature } = await makeStructure1(sessionId, contentHash, clientKp, 0);
    sendFrame(stream, CBOR_ENC.encode({ type: "hash_submit", session_id: sessionId, leaf_kind: 0x00, structure1_cbor, sender_signature }));
    const ack = await reader.readDecoded();
    expect(ack["type"]).toBe("hash_submit_ack");
    expect(ack["sequence_number"]).toBe(1);
    stream.close().catch(() => {});
  }, 15_000);
});
