/**
 * CELLO-NODE-004: /cello/directory-relay/1.0.0 protocol tests
 *
 * TDD Phase R — RED FIRST.
 * These tests cover the relay-side handler for inbound directory admin frames.
 *
 * Protocol: /cello/directory-relay/1.0.0
 * Direction: directory → relay (discard_session)
 *            relay → directory (seal_submission)
 *
 * Auth: relay verifies each frame is signed by the known directory Ed25519 pubkey.
 *       Signature domain: "CELLO-DIR-RELAY-v1"
 *       TBS: canonical CBOR of the frame body (excluding directory_signature field)
 *
 * DOD-M15-RELAYADMIN-DEAD-FRAMES-1 (2026-08-24): record_assignment, confirm_seal and reject_seal
 * were REMOVED from this wire protocol (no deployed directory has sent them since Option B and
 * the seal-broker cutover shipped). Their AC-001/AC-004/AC-005/SI-NEW wire tests are removed with
 * them. AC-006/SI-001 (generic auth failure) now use discard_session as the vehicle instead of
 * record_assignment, since the assertion is about the auth check, not about the retired frame.
 *
 * AC-002: discard_session → discard_ok; subsequent hash_submit returns session_not_found
 * AC-006: frame with invalid signature → auth_invalid; no state mutation
 * SI-001: frame signed by unknown key → auth_invalid; no state mutation
 * SI-002: hash_submit to an unregistered session → session_not_found (same as post-seal)
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
import { testOnlineToken } from "./helpers/online-token.js";

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

async function makeDiscardSessionFrame(
  sessionId: Uint8Array,
  dirKp: ReturnType<typeof generateKeypair>
): Promise<Uint8Array> {
  const body: Record<string, unknown> = { type: "discard_session", session_id: sessionId };
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

// DOD-M15-RELAYSLOTS-1: `dirKp` is the directory keypair the relay under test was built with — the
// relay now refuses any auth that does not carry a token it signed.
async function performRelayAuth(
  reader: StreamReader,
  stream: Stream,
  kp: ReturnType<typeof generateKeypair>,
  dirKp: ReturnType<typeof generateKeypair>
): Promise<void> {
  const challenge = await reader.readDecoded();
  expect(challenge["type"]).toBe("relay_auth_challenge");
  const nonce = toU8(challenge["nonce"]);

  const pubkey = await kp.getPublicKey();
  const domain = Buffer.from("CELLO-RELAY-AUTH-v1", "utf8");
  const authMsg = new Uint8Array(Buffer.concat([domain, nonce, pubkey]));
  const msgHash = new Uint8Array(createHash("sha256").update(authMsg).digest());
  const signature = await kp.sign(msgHash);

  sendFrame(stream, CBOR_ENC.encode({
    type: "relay_auth_response",
    pubkey,
    signature,
    online_token: await testOnlineToken(dirKp, kp),
  }));

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

// AC-001 (record_assignment over the directory-relay wire) removed with the frame it tested —
// DOD-M15-RELAYADMIN-DEAD-FRAMES-1. record_assignment now arrives only via the client-presented
// path (client_record_assignment, covered by FED-OPTIONB-SETUP-001 below).

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
    await performRelayAuth(readerA, streamA, clientKpA, fix.dirKp);

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

// AC-004 (confirm_seal) and AC-005 (reject_seal) removed with the frame types they tested —
// DOD-M15-RELAYADMIN-DEAD-FRAMES-1. The in-process confirmSeal()/rejectSeal() methods remain
// load-bearing for the relay's own bilateral seal-broker flow and are exercised by the seal-flow
// suites (m12-seal-broker-selection.test.ts and friends), not by this wire protocol anymore.

// ─── AC-006 / SI-001: frame with invalid/wrong signature → auth_invalid ──────

describe("AC-006 / SI-001: invalid directory signature → auth_invalid, no state mutation", () => {
  let scope = createTestScope();
  beforeEach(() => { scope = createTestScope(); });
  afterEach(() => scope.run(async () => {}));

  // DOD-M15-RELAYADMIN-DEAD-FRAMES-1: these two tests exercise the GENERIC directory_signature
  // check, which runs before any frameType dispatch — so any live frame type proves it. They used
  // record_assignment as the vehicle before that frame type was retired; discard_session (the one
  // remaining live directory-dialed frame) replaces it here without weakening the assertion.

  it("frame signed by unknown key → auth_invalid", async () => {
    const fix = await makeFixture();
    scope.addCleanup(fix.relayStop);

    const unknownKp = generateKeypair(); // not the configured directory key
    const sessionId = new Uint8Array(randomBytes(16));
    const clientKpA = generateKeypair();
    const clientKpB = generateKeypair();
    const pubA = await clientKpA.getPublicKey();
    const pubB = await clientKpB.getPublicKey();

    // Register the session in-process so a successful (non-auth_invalid) discard would be observable.
    const assignment = await makeAssignment(sessionId, pubA, pubB, fix.dirKp);
    fix.relay.recordAssignment(assignment);

    const dirNode = await createNode({ keyProvider: generateKeypair(), listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await dirNode.start();
    scope.addCleanup(async () => { await dirNode.stop(); });

    const { stream: dirStream, reader: dirReader } = await openDirRelayStream(
      dirNode, fix.relayPeerId, fix.relayAddrs
    );
    scope.addCleanup(async () => { dirStream.close().catch(() => {}); });

    // Sign with the wrong key (unknown key, not the configured directory pubkey)
    const frame = await makeDiscardSessionFrame(sessionId, unknownKp);
    sendFrame(dirStream, frame);

    const response = await dirReader.readDecoded();
    expect(response["type"]).toBe("auth_invalid");

    // Verify: the session was NOT discarded (hash_submit should still succeed)
    const clientNodeA = await createNode({ keyProvider: clientKpA, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await clientNodeA.start();
    scope.addCleanup(async () => { await clientNodeA.stop(); });
    await clientNodeA.dial(fix.relayAddr);

    const streamA = await clientNodeA.newStream(fix.relayPeerId, RELAY_PROTOCOL_ID);
    const readerA = new StreamReader(streamA);
    await performRelayAuth(readerA, streamA, clientKpA, fix.dirKp);

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

    streamA.close().catch(() => {});
  }, 20_000);

  it("frame with corrupted signature bytes → auth_invalid", async () => {
    const fix = await makeFixture();
    scope.addCleanup(fix.relayStop);

    const sessionId = new Uint8Array(randomBytes(16));

    const dirNode = await createNode({ keyProvider: generateKeypair(), listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await dirNode.start();
    scope.addCleanup(async () => { await dirNode.stop(); });

    const { stream: dirStream, reader: dirReader } = await openDirRelayStream(
      dirNode, fix.relayPeerId, fix.relayAddrs
    );
    scope.addCleanup(async () => { dirStream.close().catch(() => {}); });

    // Build valid frame then corrupt signature
    const body: Record<string, unknown> = { type: "discard_session", session_id: sessionId };
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

// SI-NEW (record_assignment missing assignment_signature) removed with record_assignment itself —
// DOD-M15-RELAYADMIN-DEAD-FRAMES-1. That sub-check lived entirely inside the deleted handler.

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
    await performRelayAuth(readerA, streamA, clientKpA, fix.dirKp);

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

  async function authedClientStream(
    relayPeerId: string,
    relayAddr: string,
    kp: ReturnType<typeof generateKeypair>,
    dirKp: ReturnType<typeof generateKeypair>,
  ) {
    const cn = await createNode({ keyProvider: kp, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await cn.start();
    scope.addCleanup(async () => { await cn.stop(); });
    await cn.dial(relayAddr);
    const stream = await cn.newStream(relayPeerId, RELAY_PROTOCOL_ID);
    const reader = new StreamReader(stream);
    await performRelayAuth(reader, stream, kp, dirKp);
    return { stream, reader };
  }

  it("a NON-primary consortium node's (node1) client-presented assignment is ACCEPTED → assignment_ok (any-directory)", async () => {
    const fix = await makeConsortiumRelay();
    const clientKp = generateKeypair();
    const pubA = await clientKp.getPublicKey();
    const pubB = await generateKeypair().getPublicKey();
    const { stream, reader } = await authedClientStream(fix.relayPeerId, fix.relayAddr, clientKp, fix.node0Kp);

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
    const { stream, reader } = await authedClientStream(fix.relayPeerId, fix.relayAddr, clientKp, fix.node0Kp);

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

  it("DOD-M15-RELAYAUTH-1: a VALID assignment that does not NAME the caller is refused → not_a_participant", async () => {
    /**
     * The DoD's second refusal. Distinct from the forged-signature case above: this assignment is
     * genuinely consortium-signed and would record fine — it simply names two OTHER agents. Without
     * this check an authenticated stranger could pre-record (and so become a relay-recognised
     * participant of) sessions it has no part in, purely by replaying an assignment it observed.
     */
    const fix = await makeConsortiumRelay();
    const strangerKp = generateKeypair(); // authenticates as itself, is named by nothing
    const pubA = await generateKeypair().getPublicKey();
    const pubB = await generateKeypair().getPublicKey();
    const { stream, reader } = await authedClientStream(fix.relayPeerId, fix.relayAddr, strangerKp, fix.node0Kp);

    const sessionId = new Uint8Array(randomBytes(16));
    // Signed by a REAL consortium directory — the signature is not the problem here.
    const frame = await makeClientRecordAssignmentFrame(sessionId, pubA, pubB, Date.now(), fix.node1Kp);
    sendFrame(stream, frame);

    const resp = await reader.readDecoded();
    expect(resp["type"]).toBe("assignment_invalid");
    expect(resp["reason"]).toBe("not_a_participant");
    stream.close().catch(() => {});
  }, 15_000);

  it("after a client_record_assignment, the relay accepts the session's hash_submit (the session was recorded)", async () => {
    const fix = await makeConsortiumRelay();
    const clientKp = generateKeypair();
    const pubA = await clientKp.getPublicKey();
    const pubB = await generateKeypair().getPublicKey();
    const { stream, reader } = await authedClientStream(fix.relayPeerId, fix.relayAddr, clientKp, fix.node0Kp);

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


// ─── Re-review finding 4: the retired frames are actually REFUSED, and the relay says so ────────

describe("DOD-M15-RELAYADMIN-DEAD-FRAMES-1 re-review: a retired frame is refused AND logged", () => {
  let scope = createTestScope();
  beforeEach(() => { scope = createTestScope(); });
  afterEach(() => scope.run(async () => {}));

  it("★★★ an AUTHENTICATED confirm_seal gets no response, does not mutate state, and is logged", async () => {
    /**
     * Finding 4: nothing in the deletion diff tested the behaviour the deletion introduced. Every
     * surviving test in this file passes identically if all three deleted handlers are restored — so
     * the deletion was not self-defending, and re-adding the branches tomorrow would go unnoticed.
     *
     * This is the missing test. It also covers finding 3: the relay used to abort here writing
     * NOTHING down — `stream.abort()` does not throw locally, so even the catch below it never ran —
     * while the directory reported `relay_unavailable` about a relay that was up and authenticating
     * fine. A retired frame is now a named, logged, diagnosable event rather than a silent reset.
     *
     * The signature is CORRECT and the relay accepts the directory key, deliberately. If the frame
     * were rejected at the auth check this would prove nothing about frame-type dispatch.
     */
    const logged: Array<{ event: string; ctx: Record<string, unknown> }> = [];
    const dirKp = generateKeypair();
    const dirPubkey = await dirKp.getPublicKey();
    const { relay, node: relayNode, stop } = await createRelayNode({
      directoryPubkey: dirPubkey,
      logger: {
        debug: () => {},
        info: () => {},
        warn: (event: string, ctx?: Record<string, unknown>) => { logged.push({ event, ctx: ctx ?? {} }); },
        error: () => {},
      },
    });
    scope.addCleanup(stop);

    // A live session, so "no state mutation" is a claim with something to be false about.
    const clientKpA = generateKeypair();
    const clientKpB = generateKeypair();
    const pubA = await clientKpA.getPublicKey();
    const pubB = await clientKpB.getPublicKey();
    const sessionId = new Uint8Array(randomBytes(16));
    relay.recordAssignment(await makeAssignment(sessionId, pubA, pubB, dirKp));

    const dirNode = await createNode({ keyProvider: dirKp, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await dirNode.start();
    scope.addCleanup(async () => { await dirNode.stop(); });
    await dirNode.dial(relayNode.listenAddresses()[0]!);

    const body: Record<string, unknown> = { type: "confirm_seal", session_id: sessionId };
    const directory_signature = await signFrameBody(dirKp, body);
    const stream = await dirNode.newStream(relayNode.getPeerId(), DIRECTORY_RELAY_PROTOCOL_ID);
    sendFrame(stream, CBOR_ENC.encode({ ...body, directory_signature }) as Uint8Array);

    // No response frame — the relay resets the stream rather than answering a type it retired.
    const reader = new StreamReader(stream);
    await expect(
      reader.readDecoded(),
      "a retired frame must NOT be answered — an answer would mean the handler is back",
    ).rejects.toThrow();

    // The session is untouched: a retired frame must never mutate state on its way to being refused.
    expect(
      relay.getSealLeaves(sessionId).ok,
      "confirm_seal used to DESTROY the session. Refusing it must leave the session exactly as it was.",
    ).toBe(true);

    // Finding 3: and it is diagnosable. Without this the whole event left no trace on either machine.
    const unknown = logged.find((e) => e.event === "relay.directory.frame.unknown");
    expect(
      unknown,
      "the relay must record that it refused an AUTHENTICATED directory frame. Silently resetting " +
        "makes the directory report `relay_unavailable` about a relay that is up and answering.",
    ).toBeDefined();
    expect(unknown?.ctx["frameType"], "and it must name the frame it refused").toBe("confirm_seal");
  }, 15_000);
});
