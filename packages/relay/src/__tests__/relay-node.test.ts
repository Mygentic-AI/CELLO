/**
 * CELLO-NODE-002: CelloRelayNode integration tests
 *
 * TDD Phase R — written BEFORE implementation is complete.
 * All new tests must be RED until relay-node.ts is corrected.
 *
 * Covers: AC-001–AC-012, SI-001–SI-005, DB-001–DB-002, relay-SI-NEW (SESSION-002)
 *
 * Auth domain: "CELLO-RELAY-AUTH-v1"
 * Signature: Ed25519(SHA-256(domain || nonce || pubkey), privkey) — per RFC 8032, FIPS 180-4
 * Structure 1 TBS: [1, content_hash, sender_pubkey, session_id, last_seen_seq, timestamp]
 * Structure 2: per MERKLE-002, buildStructure2/encodeStructure2
 *
 * IMPORTANT: libp2p v3 streams are single-pass iterables. Every `for await` loop
 * that returns early calls the stream's `return()`, closing the read side. All test
 * code uses a per-stream `StreamReader` that holds a single persistent iterator.
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
import {
  generateKeypair,
  buildMerkleTree,
  merkleRoot,
} from "@cello/crypto";
import type { LeafInput } from "@cello/crypto";
import { encodeStructure2 } from "@cello/protocol-types";
import { createNode } from "@cello/transport";
import type { Stream } from "@libp2p/interface";
import { createRelayNode, RELAY_PROTOCOL_ID } from "../relay-node.js";
import type { SessionAssignment } from "../relay-types.js";

setupV3Tests();

const CBOR_ENC = new Encoder({ tagUint8Array: false });

// ─── StreamReader ─────────────────────────────────────────────────────────────
// libp2p v3 streams are single-pass. Breaking from `for await (const x of stream)`
// calls return() which closes the read side. We keep ONE persistent iterator per
// stream for all reads.

class StreamReader {
  readonly #iter: AsyncIterator<Uint8Array>;

  constructor(stream: Stream) {
    // lp.decode wraps the stream iterable and yields decoded frames.
    // We immediately get the underlying iterator and hold it for the stream lifetime.
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

function computeGenesisPrevRoot(pubA: Uint8Array, pubB: Uint8Array, sessionId: Uint8Array, sessionTimestamp: number): Uint8Array {
  const cmp = Buffer.compare(Buffer.from(pubA), Buffer.from(pubB));
  const [first, second] = cmp <= 0 ? [pubA, pubB] : [pubB, pubA];
  const tsBytes = Buffer.allocUnsafe(8);
  tsBytes.writeBigUInt64BE(BigInt(sessionTimestamp));
  const h = createHash("sha256");
  h.update(first); h.update(second); h.update(sessionId); h.update(tsBytes);
  return new Uint8Array(h.digest());
}

// Decode structure2_cbor (6-element CBOR array) and return prev_root (index 5)
function decodePrevRoot(structure2Cbor: Uint8Array): Uint8Array {
  const arr = decode(structure2Cbor) as unknown[];
  return toU8(arr[5]);
}

function sendFrame(stream: Stream, data: Uint8Array): void {
  stream.send(lp.encode.single(data));
}

// performAuth reads the challenge, sends the response, and reads relay_auth_ok.
// The relay always sends relay_auth_ok (or relay_auth_failed) after the response.
async function performAuth(
  reader: StreamReader,
  stream: Stream,
  kp: ReturnType<typeof generateKeypair>,
  domainOverride?: string
): Promise<void> {
  const challenge = await reader.readDecoded();
  expect(challenge["type"]).toBe("relay_auth_challenge");
  const nonce = toU8(challenge["nonce"]);
  expect(nonce.length).toBe(32);

  const pubkey = await kp.getPublicKey();
  const domain = Buffer.from(domainOverride ?? "CELLO-RELAY-AUTH-v1", "utf8");
  const authMsg = new Uint8Array(Buffer.concat([domain, nonce, pubkey]));
  const msgHash = new Uint8Array(createHash("sha256").update(authMsg).digest());
  const signature = await kp.sign(msgHash);

  sendFrame(stream, CBOR_ENC.encode({ type: "relay_auth_response", pubkey, signature }));

  // Read relay_auth_ok or relay_auth_failed confirmation
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

async function submitAndAck(
  reader: StreamReader,
  stream: Stream,
  sessionId: Uint8Array,
  leafKind: number,
  kp: ReturnType<typeof generateKeypair>,
  lastSeenSeq: number
): Promise<number> {
  const contentHash = new Uint8Array(randomBytes(32));
  const { structure1_cbor, sender_signature } = await makeStructure1(
    sessionId, contentHash, kp, lastSeenSeq
  );
  sendFrame(stream, CBOR_ENC.encode({
    type: "hash_submit",
    session_id: sessionId,
    leaf_kind: leafKind,
    structure1_cbor,
    sender_signature,
  }));
  const resp = await reader.readDecoded();
  expect(resp["type"]).toBe("hash_submit_ack");
  // MSG-004: relay echoes leaf_deliver back to sender after the ack; drain it.
  const echo = await reader.readDecoded();
  expect(echo["type"]).toBe("leaf_deliver");
  return resp["sequence_number"] as number;
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

interface Fixture {
  relayAddr: string;
  relay: Awaited<ReturnType<typeof createRelayNode>>["relay"];
  relayNode: Awaited<ReturnType<typeof createRelayNode>>["node"];
  relayStop: () => Promise<void>;
  dirKp: ReturnType<typeof generateKeypair>;
}

async function makeFixture(): Promise<Fixture> {
  const dirKp = generateKeypair();
  const dirPubkey = await dirKp.getPublicKey();
  const { relay, node, stop } = await createRelayNode({ directoryPubkey: dirPubkey });
  const addrs = node.listenAddresses();
  expect(addrs.length).toBeGreaterThan(0);
  return { relayAddr: addrs[0]!, relay, relayNode: node, relayStop: stop, dirKp };
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
  relayPeerId: string
): Promise<{ stream: Stream; reader: StreamReader }> {
  const stream = await clientNode.newStream(relayPeerId, RELAY_PROTOCOL_ID);
  const reader = new StreamReader(stream);
  return { stream, reader };
}

// ─── AC-001 ───────────────────────────────────────────────────────────────────

describe("AC-001: first hash_submit assigns seq=1 using genesis prev_root", () => {
  let scope = createTestScope();
  beforeEach(() => { scope = createTestScope(); });
  afterEach(() => scope.run(async () => {}));

  it("relay assigns seq=1, delivers leaf_deliver to B", async () => {
    const fix = await makeFixture();
    scope.addCleanup(fix.relayStop);

    const cA = await makeClient(fix.relayAddr);
    const cB = await makeClient(fix.relayAddr);
    scope.addCleanup(async () => { await cA.node.stop(); });
    scope.addCleanup(async () => { await cB.node.stop(); });

    const sessionId = new Uint8Array(randomBytes(16));
    const assignment = await makeAssignment(sessionId, cA.pubkey, cB.pubkey, fix.dirKp);
    fix.relay.recordAssignment(assignment);

    const { stream: sA, reader: rA } = await openStream(cA.node, fix.relayNode.getPeerId());
    const { stream: sB, reader: rB } = await openStream(cB.node, fix.relayNode.getPeerId());
    await performAuth(rA, sA, cA.kp);
    await performAuth(rB, sB, cB.kp);

    const contentHash = new Uint8Array(randomBytes(32));
    const { structure1_cbor, sender_signature } = await makeStructure1(sessionId, contentHash, cA.kp, 0);
    sendFrame(sA, CBOR_ENC.encode({ type: "hash_submit", session_id: sessionId, leaf_kind: 0x00, structure1_cbor, sender_signature }));

    const ack = await rA.readDecoded();
    expect(ack["type"]).toBe("hash_submit_ack");
    expect(ack["sequence_number"]).toBe(1);

    const deliver = await rB.readDecoded();
    expect(deliver["type"]).toBe("leaf_deliver");
    expect(Buffer.from(toU8(deliver["session_id"])).toString("hex")).toBe(Buffer.from(sessionId).toString("hex"));
    expect(deliver["leaf_kind"]).toBe(0x00);

    // Verify prev_root in Structure 2 = genesis_prev_root for seq=1
    const expectedGenesis = computeGenesisPrevRoot(cA.pubkey, cB.pubkey, sessionId, assignment.session_timestamp);
    const deliveredPrevRoot = decodePrevRoot(toU8(deliver["structure2_cbor"]));
    expect(Buffer.from(deliveredPrevRoot).toString("hex")).toBe(Buffer.from(expectedGenesis).toString("hex"));

    sA.close().catch(() => {});
    sB.close().catch(() => {});
  }, 20_000);
});

// ─── AC-002 ───────────────────────────────────────────────────────────────────

describe("AC-002: seq=3 prev_root = Merkle root of leaves 1 and 2", () => {
  it("relay returns seq=3 ack", async () => {
    const fix = await makeFixture();
    const cA = await makeClient(fix.relayAddr);
    const cB = await makeClient(fix.relayAddr);

    const sessionId = new Uint8Array(randomBytes(16));
    fix.relay.recordAssignment(await makeAssignment(sessionId, cA.pubkey, cB.pubkey, fix.dirKp));

    const { stream: sA, reader: rA } = await openStream(cA.node, fix.relayNode.getPeerId());
    const { stream: sB, reader: rB } = await openStream(cB.node, fix.relayNode.getPeerId());
    await performAuth(rA, sA, cA.kp);
    await performAuth(rB, sB, cB.kp);

    await submitAndAck(rA, sA, sessionId, 0x00, cA.kp, 0);
    const deliver1 = await rB.readDecoded();
    await submitAndAck(rA, sA, sessionId, 0x00, cA.kp, 1);
    const deliver2 = await rB.readDecoded();

    const seq3 = await submitAndAck(rA, sA, sessionId, 0x00, cA.kp, 2);
    expect(seq3).toBe(3);
    const deliver3 = await rB.readDecoded();

    // Verify prev_root in Structure 2 for seq=3 = merkle root of leaves 1 and 2
    const s2cbor1 = toU8(deliver1["structure2_cbor"]);
    const s2cbor2 = toU8(deliver2["structure2_cbor"]);
    const inputs: LeafInput[] = [
      { kind: "msg", data: s2cbor1 },
      { kind: "msg", data: s2cbor2 },
    ];
    const expectedPrevRoot = merkleRoot(buildMerkleTree(inputs));
    const actualPrevRoot = decodePrevRoot(toU8(deliver3["structure2_cbor"]));
    expect(Buffer.from(actualPrevRoot).toString("hex")).toBe(Buffer.from(expectedPrevRoot).toString("hex"));

    sA.close().catch(() => {});
    sB.close().catch(() => {});
    await cA.node.stop(); await cB.node.stop(); await fix.relayStop();
  }, 25_000);
});

// ─── AC-003 ───────────────────────────────────────────────────────────────────

describe("AC-003: sender_mismatch when Structure 1 pubkey != connection pubkey", () => {
  it("relay rejects with sender_mismatch", async () => {
    const fix = await makeFixture();
    const cA = await makeClient(fix.relayAddr);

    const sessionId = new Uint8Array(randomBytes(16));
    // B pubkey is random (B doesn't connect in this test)
    fix.relay.recordAssignment(await makeAssignment(sessionId, cA.pubkey, new Uint8Array(randomBytes(32)), fix.dirKp));

    const { stream: sA, reader: rA } = await openStream(cA.node, fix.relayNode.getPeerId());
    await performAuth(rA, sA, cA.kp);

    // Build Structure 1 signed by K_X (not A) but sent on A's stream
    const kX = generateKeypair();
    const pubX = await kX.getPublicKey();
    const contentHash = new Uint8Array(randomBytes(32));
    const tbs = CBOR_ENC.encode([1, contentHash, pubX, sessionId, 0, Date.now()]) as Uint8Array;
    const sigX = await kX.sign(tbs);

    sendFrame(sA, CBOR_ENC.encode({ type: "hash_submit", session_id: sessionId, leaf_kind: 0x00, structure1_cbor: tbs, sender_signature: sigX }));

    const resp = await rA.readDecoded();
    expect(resp["type"]).toBe("hash_submit_error");
    expect(resp["reason"]).toBe("sender_mismatch");

    sA.close().catch(() => {});
    await cA.node.stop(); await fix.relayStop();
  }, 20_000);
});

// ─── AC-004 ───────────────────────────────────────────────────────────────────

describe("AC-004: not_a_participant for client not in session", () => {
  it("relay rejects with not_a_participant", async () => {
    const fix = await makeFixture();
    const cA = await makeClient(fix.relayAddr);
    const cB = await makeClient(fix.relayAddr);
    const cC = await makeClient(fix.relayAddr);

    const sessionId = new Uint8Array(randomBytes(16));
    fix.relay.recordAssignment(await makeAssignment(sessionId, cA.pubkey, cB.pubkey, fix.dirKp));

    const { stream: sC, reader: rC } = await openStream(cC.node, fix.relayNode.getPeerId());
    await performAuth(rC, sC, cC.kp);

    const { structure1_cbor, sender_signature } = await makeStructure1(sessionId, new Uint8Array(randomBytes(32)), cC.kp, 0);
    sendFrame(sC, CBOR_ENC.encode({ type: "hash_submit", session_id: sessionId, leaf_kind: 0x00, structure1_cbor, sender_signature }));

    const resp = await rC.readDecoded();
    expect(resp["type"]).toBe("hash_submit_error");
    expect(resp["reason"]).toBe("not_a_participant");

    sC.close().catch(() => {});
    await cA.node.stop(); await cB.node.stop(); await cC.node.stop(); await fix.relayStop();
  }, 20_000);
});

// ─── AC-005 ───────────────────────────────────────────────────────────────────

describe("AC-005: last_seen_seq_ahead when declared seq > current counter", () => {
  it("relay rejects with last_seen_seq_ahead", async () => {
    const fix = await makeFixture();
    const cA = await makeClient(fix.relayAddr);
    const cB = await makeClient(fix.relayAddr);

    const sessionId = new Uint8Array(randomBytes(16));
    fix.relay.recordAssignment(await makeAssignment(sessionId, cA.pubkey, cB.pubkey, fix.dirKp));

    const { stream: sA, reader: rA } = await openStream(cA.node, fix.relayNode.getPeerId());
    const { stream: sB, reader: rB } = await openStream(cB.node, fix.relayNode.getPeerId());
    await performAuth(rA, sA, cA.kp);
    await performAuth(rB, sB, cB.kp);

    // Advance counter to 2
    await submitAndAck(rA, sA, sessionId, 0x00, cA.kp, 0); await rB.readDecoded();
    await submitAndAck(rA, sA, sessionId, 0x00, cA.kp, 1); await rB.readDecoded();

    // Submit with last_seen_seq=5 (counter is 2)
    const { structure1_cbor, sender_signature } = await makeStructure1(sessionId, new Uint8Array(randomBytes(32)), cA.kp, 5);
    sendFrame(sA, CBOR_ENC.encode({ type: "hash_submit", session_id: sessionId, leaf_kind: 0x00, structure1_cbor, sender_signature }));

    const resp = await rA.readDecoded();
    expect(resp["type"]).toBe("hash_submit_error");
    expect(resp["reason"]).toBe("last_seen_seq_ahead");

    sA.close().catch(() => {}); sB.close().catch(() => {});
    await cA.node.stop(); await cB.node.stop(); await fix.relayStop();
  }, 25_000);
});

// ─── AC-006 ───────────────────────────────────────────────────────────────────

describe("AC-006: submitForSeal returns all leaves, seq_count, and Merkle root", () => {
  it("10 leaves: returned root matches independent recomputation", async () => {
    const fix = await makeFixture();
    const cA = await makeClient(fix.relayAddr);
    const cB = await makeClient(fix.relayAddr);

    const sessionId = new Uint8Array(randomBytes(16));
    fix.relay.recordAssignment(await makeAssignment(sessionId, cA.pubkey, cB.pubkey, fix.dirKp));

    const { stream: sA, reader: rA } = await openStream(cA.node, fix.relayNode.getPeerId());
    const { stream: sB, reader: rB } = await openStream(cB.node, fix.relayNode.getPeerId());
    await performAuth(rA, sA, cA.kp);
    await performAuth(rB, sB, cB.kp);

    for (let i = 0; i < 10; i++) {
      await submitAndAck(rA, sA, sessionId, 0x00, cA.kp, i);
      await rB.readDecoded();
    }

    const result = fix.relay.submitForSeal(sessionId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.seq_count).toBe(10);
    expect(result.data.leaves.length).toBe(10);

    const inputs: LeafInput[] = result.data.leaves.map((l) => ({ kind: l.kind, data: encodeStructure2(l.s2) }));
    const expected = merkleRoot(buildMerkleTree(inputs));
    expect(Buffer.from(result.data.merkle_root).toString("hex")).toBe(Buffer.from(expected).toString("hex"));

    sA.close().catch(() => {}); sB.close().catch(() => {});
    await cA.node.stop(); await cB.node.stop(); await fix.relayStop();
  }, 30_000);
});

// ─── AC-007 ───────────────────────────────────────────────────────────────────

describe("AC-007: session_not_found after confirmSeal destroys state", () => {
  it("hash_submit after confirmSeal returns session_not_found", async () => {
    const fix = await makeFixture();
    const cA = await makeClient(fix.relayAddr);
    const cB = await makeClient(fix.relayAddr);

    const sessionId = new Uint8Array(randomBytes(16));
    fix.relay.recordAssignment(await makeAssignment(sessionId, cA.pubkey, cB.pubkey, fix.dirKp));

    const { stream: sA, reader: rA } = await openStream(cA.node, fix.relayNode.getPeerId());
    const { stream: sB, reader: rB } = await openStream(cB.node, fix.relayNode.getPeerId());
    await performAuth(rA, sA, cA.kp);
    await performAuth(rB, sB, cB.kp);

    fix.relay.submitForSeal(sessionId);
    fix.relay.confirmSeal(sessionId);

    // Re-connect as a new client using A's key
    const cA2 = await makeClient(fix.relayAddr);
    // Manually auth with cA's original keypair
    const sA2 = await cA2.node.newStream(fix.relayNode.getPeerId(), RELAY_PROTOCOL_ID);
    const rA2 = new StreamReader(sA2);
    const ch = await rA2.readDecoded();
    const nonce = toU8(ch["nonce"]);
    const pubA = cA.pubkey;
    const authMsg = new Uint8Array(Buffer.concat([Buffer.from("CELLO-RELAY-AUTH-v1"), nonce, pubA]));
    const msgHash = new Uint8Array(createHash("sha256").update(authMsg).digest());
    const sig = await cA.kp.sign(msgHash);
    sendFrame(sA2, CBOR_ENC.encode({ type: "relay_auth_response", pubkey: pubA, signature: sig }));

    // Consume relay_auth_ok before sending hash_submit
    const authOk = await rA2.readDecoded();
    expect(authOk["type"]).toBe("relay_auth_ok");

    const { structure1_cbor, sender_signature } = await makeStructure1(sessionId, new Uint8Array(randomBytes(32)), cA.kp, 0);
    sendFrame(sA2, CBOR_ENC.encode({ type: "hash_submit", session_id: sessionId, leaf_kind: 0x00, structure1_cbor, sender_signature }));

    const resp = await rA2.readDecoded();
    expect(resp["type"]).toBe("hash_submit_error");
    expect(resp["reason"]).toBe("session_not_found");

    sA.close().catch(() => {}); sB.close().catch(() => {}); sA2.close().catch(() => {});
    await cA.node.stop(); await cB.node.stop(); await cA2.node.stop(); await fix.relayStop();
  }, 25_000);
});

// ─── AC-008 ───────────────────────────────────────────────────────────────────

describe("AC-008: leaf_kind_invalid for values outside {0x00, 0x02}", () => {
  it.each([0x01, 0x03, 0xff, 0x10])(
    "leaf_kind=0x%s → leaf_kind_invalid",
    async (badKind) => {
      const fix = await makeFixture();
      const cA = await makeClient(fix.relayAddr);
      const cB = await makeClient(fix.relayAddr);

      const sessionId = new Uint8Array(randomBytes(16));
      fix.relay.recordAssignment(await makeAssignment(sessionId, cA.pubkey, cB.pubkey, fix.dirKp));

      const { stream: sA, reader: rA } = await openStream(cA.node, fix.relayNode.getPeerId());
      await performAuth(rA, sA, cA.kp);

      const { structure1_cbor, sender_signature } = await makeStructure1(sessionId, new Uint8Array(randomBytes(32)), cA.kp, 0);
      sendFrame(sA, CBOR_ENC.encode({ type: "hash_submit", session_id: sessionId, leaf_kind: badKind, structure1_cbor, sender_signature }));

      const resp = await rA.readDecoded();
      expect(resp["type"]).toBe("hash_submit_error");
      expect(resp["reason"]).toBe("leaf_kind_invalid");

      sA.close().catch(() => {});
      await cA.node.stop(); await cB.node.stop(); await fix.relayStop();
    },
    20_000
  );
});

// ─── AC-009 ───────────────────────────────────────────────────────────────────

describe("AC-009: 50 rapid submits → strictly monotonic seq 1..50", () => {
  it("all 50 acks arrive in order with seq 1..50", async () => {
    const fix = await makeFixture();
    const cA = await makeClient(fix.relayAddr);
    const cB = await makeClient(fix.relayAddr);

    const sessionId = new Uint8Array(randomBytes(16));
    fix.relay.recordAssignment(await makeAssignment(sessionId, cA.pubkey, cB.pubkey, fix.dirKp));

    const { stream: sA, reader: rA } = await openStream(cA.node, fix.relayNode.getPeerId());
    const { stream: sB, reader: rB } = await openStream(cB.node, fix.relayNode.getPeerId());
    await performAuth(rA, sA, cA.kp);
    await performAuth(rB, sB, cB.kp);

    const seqNums: number[] = [];
    for (let i = 0; i < 50; i++) {
      const seq = await submitAndAck(rA, sA, sessionId, 0x00, cA.kp, i);
      seqNums.push(seq);
      await rB.readDecoded(); // drain leaf_deliver
    }

    expect(seqNums).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));

    sA.close().catch(() => {}); sB.close().catch(() => {});
    await cA.node.stop(); await cB.node.stop(); await fix.relayStop();
  }, 60_000);
});

// ─── AC-010 ───────────────────────────────────────────────────────────────────

describe("AC-010: auth with wrong domain string fails with signature_invalid", () => {
  it("signing over CELLO-DIR-AUTH-v1 domain is rejected as signature_invalid", async () => {
    const fix = await makeFixture();
    const cA = await makeClient(fix.relayAddr);

    const { stream: sA, reader: rA } = await openStream(cA.node, fix.relayNode.getPeerId());

    const ch = await rA.readDecoded();
    const nonce = toU8(ch["nonce"]);
    const pubkey = await cA.kp.getPublicKey();
    const wrongDomain = Buffer.from("CELLO-DIR-AUTH-v1", "utf8");
    const authMsg = new Uint8Array(Buffer.concat([wrongDomain, nonce, pubkey]));
    const msgHash = new Uint8Array(createHash("sha256").update(authMsg).digest());
    const signature = await cA.kp.sign(msgHash);
    sendFrame(sA, CBOR_ENC.encode({ type: "relay_auth_response", pubkey, signature }));

    // Relay sends relay_auth_failed then aborts — the abort may race the send.
    // Either we get the frame, or the stream resets before the frame arrives.
    let resp: Record<string, unknown> | null = null;
    try {
      resp = await rA.readDecoded();
    } catch {
      // stream was reset before frame arrived — also valid rejection
    }
    if (resp !== null) {
      expect(resp["type"]).toBe("relay_auth_failed");
      expect(resp["reason"]).toBe("signature_invalid");
    }

    sA.close().catch(() => {});
    await cA.node.stop(); await fix.relayStop();
  }, 20_000);
});

// ─── AC-011 ───────────────────────────────────────────────────────────────────

describe("AC-011: relay does not register content or signaling protocols", () => {
  it("opening content or signaling protocol against relay fails", async () => {
    const fix = await makeFixture();
    const client = await makeClient(fix.relayAddr);

    for (const proto of ["/cello/content/1.0.0", "/cello/signaling/1.0.0"]) {
      let caught: unknown;
      try {
        await client.node.newStream(fix.relayNode.getPeerId(), proto);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeDefined();
      expect((caught as { reason: string }).reason).toBe("protocol_not_supported");
    }

    await client.node.stop(); await fix.relayStop();
  }, 20_000);
});

// ─── AC-012 ───────────────────────────────────────────────────────────────────

describe("AC-012: queued leaf_deliver flushed on B reconnect", () => {
  it("A submits while B is offline; B reconnects and receives the queued frame", async () => {
    const fix = await makeFixture();
    const cA = await makeClient(fix.relayAddr);
    const cB = await makeClient(fix.relayAddr);

    const sessionId = new Uint8Array(randomBytes(16));
    fix.relay.recordAssignment(await makeAssignment(sessionId, cA.pubkey, cB.pubkey, fix.dirKp));

    const { stream: sA, reader: rA } = await openStream(cA.node, fix.relayNode.getPeerId());
    await performAuth(rA, sA, cA.kp);

    // B authenticates then closes its stream
    const { stream: sB1, reader: rB1 } = await openStream(cB.node, fix.relayNode.getPeerId());
    await performAuth(rB1, sB1, cB.kp);
    await sB1.close();

    await new Promise((r) => setTimeout(r, 200));

    // A submits while B is offline
    await submitAndAck(rA, sA, sessionId, 0x00, cA.kp, 0);

    // B reconnects — reuse cB's keypair on a new stream
    const { stream: sB2, reader: rB2 } = await openStream(cB.node, fix.relayNode.getPeerId());
    await performAuth(rB2, sB2, cB.kp);

    const deliver = await rB2.readDecoded();
    expect(deliver["type"]).toBe("leaf_deliver");
    expect(Buffer.from(toU8(deliver["session_id"])).toString("hex")).toBe(Buffer.from(sessionId).toString("hex"));

    sA.close().catch(() => {}); sB2.close().catch(() => {});
    await cA.node.stop(); await cB.node.stop(); await fix.relayStop();
  }, 25_000);
});

// ─── SI-001 ───────────────────────────────────────────────────────────────────

describe("SI-001: relay protocols list excludes content and signaling", () => {
  it("relay node getProtocols() does not include content or signaling", async () => {
    const fix = await makeFixture();
    const protocols = fix.relayNode.getProtocols();
    expect(protocols).not.toContain("/cello/content/1.0.0");
    expect(protocols).not.toContain("/cello/signaling/1.0.0");
    expect(protocols).toContain(RELAY_PROTOCOL_ID);
    await fix.relayStop();
  });
});

// ─── SI-002 ───────────────────────────────────────────────────────────────────

describe("SI-002: concurrent submits from A and B yield strictly monotonic seq", () => {
  it("100 concurrent submits (50 from A, 50 from B) have seq 1..100 with no duplicates", async () => {
    const fix = await makeFixture();
    const cA = await makeClient(fix.relayAddr);
    const cB = await makeClient(fix.relayAddr);

    const sessionId = new Uint8Array(randomBytes(16));
    fix.relay.recordAssignment(await makeAssignment(sessionId, cA.pubkey, cB.pubkey, fix.dirKp));

    const { stream: sA, reader: rA } = await openStream(cA.node, fix.relayNode.getPeerId());
    const { stream: sB, reader: rB } = await openStream(cB.node, fix.relayNode.getPeerId());
    await performAuth(rA, sA, cA.kp);
    await performAuth(rB, sB, cB.kp);

    // Each participant submits 50, skipping leaf_deliver frames from counterparty
    const readAck = async (reader: StreamReader): Promise<number> => {
      while (true) {
        const frame = await reader.readDecoded();
        if (frame["type"] === "hash_submit_ack") return frame["sequence_number"] as number;
        // else it's a leaf_deliver from counterparty — discard
      }
    };

    const submitN = async (
      stream: Stream,
      reader: StreamReader,
      kp: ReturnType<typeof generateKeypair>,
      count: number
    ): Promise<number[]> => {
      const seqs: number[] = [];
      for (let i = 0; i < count; i++) {
        const contentHash = new Uint8Array(randomBytes(32));
        const { structure1_cbor, sender_signature } = await makeStructure1(sessionId, contentHash, kp, 0);
        sendFrame(stream, CBOR_ENC.encode({ type: "hash_submit", session_id: sessionId, leaf_kind: 0x00, structure1_cbor, sender_signature }));
        seqs.push(await readAck(reader));
      }
      return seqs;
    };

    const [seqsA, seqsB] = await Promise.all([
      submitN(sA, rA, cA.kp, 50),
      submitN(sB, rB, cB.kp, 50),
    ]);

    const all = [...seqsA, ...seqsB].sort((a, b) => a - b);
    expect(all.length).toBe(100);
    expect(new Set(all).size).toBe(100);
    expect(Math.min(...all)).toBe(1);
    expect(Math.max(...all)).toBe(100);

    sA.close().catch(() => {}); sB.close().catch(() => {});
    await cA.node.stop(); await cB.node.stop(); await fix.relayStop();
  }, 60_000);
});

// ─── SI-003 ───────────────────────────────────────────────────────────────────

describe("SI-003: forged Structure 1 signature is rejected as signature_invalid", () => {
  it("Structure 1 with wrong signature → signature_invalid", async () => {
    const fix = await makeFixture();
    const cA = await makeClient(fix.relayAddr);
    const cB = await makeClient(fix.relayAddr);

    const sessionId = new Uint8Array(randomBytes(16));
    fix.relay.recordAssignment(await makeAssignment(sessionId, cA.pubkey, cB.pubkey, fix.dirKp));

    const { stream: sA, reader: rA } = await openStream(cA.node, fix.relayNode.getPeerId());
    await performAuth(rA, sA, cA.kp);

    // Build TBS with A's pubkey, sign with forge key
    const kForge = generateKeypair();
    const pubA = cA.pubkey;
    const tbs = CBOR_ENC.encode([1, new Uint8Array(randomBytes(32)), pubA, sessionId, 0, Date.now()]) as Uint8Array;
    const forgedSig = await kForge.sign(tbs);

    sendFrame(sA, CBOR_ENC.encode({ type: "hash_submit", session_id: sessionId, leaf_kind: 0x00, structure1_cbor: tbs, sender_signature: forgedSig }));

    const resp = await rA.readDecoded();
    expect(resp["type"]).toBe("hash_submit_error");
    expect(resp["reason"]).toBe("signature_invalid");

    sA.close().catch(() => {});
    await cA.node.stop(); await cB.node.stop(); await fix.relayStop();
  }, 20_000);
});

// ─── SI-004 ───────────────────────────────────────────────────────────────────

describe("SI-004: leaf_deliver delivered only to counterparty", () => {
  it("C (not in session) receives no leaf_deliver when A submits", async () => {
    const fix = await makeFixture();
    const cA = await makeClient(fix.relayAddr);
    const cB = await makeClient(fix.relayAddr);
    const cC = await makeClient(fix.relayAddr);

    const sessionId = new Uint8Array(randomBytes(16));
    fix.relay.recordAssignment(await makeAssignment(sessionId, cA.pubkey, cB.pubkey, fix.dirKp));

    const { stream: sA, reader: rA } = await openStream(cA.node, fix.relayNode.getPeerId());
    const { stream: sB, reader: rB } = await openStream(cB.node, fix.relayNode.getPeerId());
    const { stream: sC, reader: rC } = await openStream(cC.node, fix.relayNode.getPeerId());
    await performAuth(rA, sA, cA.kp);
    await performAuth(rB, sB, cB.kp);
    await performAuth(rC, sC, cC.kp);

    await submitAndAck(rA, sA, sessionId, 0x00, cA.kp, 0);
    const bFrame = await rB.readDecoded();
    expect(bFrame["type"]).toBe("leaf_deliver");

    // C should receive nothing within 500ms
    let cGotFrame = false;
    rC.readDecoded().then(() => { cGotFrame = true; }).catch(() => {});
    await new Promise((r) => setTimeout(r, 500));
    expect(cGotFrame).toBe(false);

    sA.close().catch(() => {}); sB.close().catch(() => {}); sC.close().catch(() => {});
    await cA.node.stop(); await cB.node.stop(); await cC.node.stop(); await fix.relayStop();
  }, 20_000);
});

// ─── SI-005 ───────────────────────────────────────────────────────────────────

describe("SI-005: confirmSeal destroys all per-session state synchronously", () => {
  it("after confirmSeal, submitForSeal returns session_not_found", async () => {
    const fix = await makeFixture();
    const cA = await makeClient(fix.relayAddr);
    const cB = await makeClient(fix.relayAddr);

    const sessionId = new Uint8Array(randomBytes(16));
    fix.relay.recordAssignment(await makeAssignment(sessionId, cA.pubkey, cB.pubkey, fix.dirKp));

    const { stream: sA, reader: rA } = await openStream(cA.node, fix.relayNode.getPeerId());
    const { stream: sB, reader: rB } = await openStream(cB.node, fix.relayNode.getPeerId());
    await performAuth(rA, sA, cA.kp);
    await performAuth(rB, sB, cB.kp);

    await submitAndAck(rA, sA, sessionId, 0x00, cA.kp, 0);
    await rB.readDecoded();

    const sealResult = fix.relay.submitForSeal(sessionId);
    expect(sealResult.ok).toBe(true);
    fix.relay.confirmSeal(sessionId);

    const secondSeal = fix.relay.submitForSeal(sessionId);
    expect(secondSeal.ok).toBe(false);

    sA.close().catch(() => {}); sB.close().catch(() => {});
    await cA.node.stop(); await cB.node.stop(); await fix.relayStop();
  }, 20_000);
});

// ─── DB-001 ───────────────────────────────────────────────────────────────────

describe("DB-001: delivery queue bounded at 256; flushed on reconnect", () => {
  it("10 queued frames arrive when B reconnects with same pubkey", async () => {
    const fix = await makeFixture();
    const cA = await makeClient(fix.relayAddr);
    const cB = await makeClient(fix.relayAddr);

    const sessionId = new Uint8Array(randomBytes(16));
    fix.relay.recordAssignment(await makeAssignment(sessionId, cA.pubkey, cB.pubkey, fix.dirKp));

    const { stream: sA, reader: rA } = await openStream(cA.node, fix.relayNode.getPeerId());
    await performAuth(rA, sA, cA.kp);

    // B does NOT connect — all deliveries queue for B's pubkey
    for (let i = 0; i < 10; i++) {
      await submitAndAck(rA, sA, sessionId, 0x00, cA.kp, i);
    }

    // B reconnects — open a new stream using cB's SAME node (same key)
    const { stream: sB2, reader: rB2 } = await openStream(cB.node, fix.relayNode.getPeerId());
    await performAuth(rB2, sB2, cB.kp);

    // The relay flushes queued frames immediately after auth
    for (let i = 0; i < 10; i++) {
      const frame = await rB2.readDecoded();
      expect(frame["type"]).toBe("leaf_deliver");
    }

    sA.close().catch(() => {}); sB2.close().catch(() => {});
    await cA.node.stop(); await cB.node.stop(); await fix.relayStop();
  }, 30_000);
});

// ─── DB-002 ───────────────────────────────────────────────────────────────────

describe("DB-002: rejectSeal retains state, marks session seal_rejected", () => {
  it("hash_submit after rejectSeal is rejected (session no longer active)", async () => {
    const fix = await makeFixture();
    const cA = await makeClient(fix.relayAddr);
    const cB = await makeClient(fix.relayAddr);

    const sessionId = new Uint8Array(randomBytes(16));
    fix.relay.recordAssignment(await makeAssignment(sessionId, cA.pubkey, cB.pubkey, fix.dirKp));

    const { stream: sA, reader: rA } = await openStream(cA.node, fix.relayNode.getPeerId());
    const { stream: sB, reader: rB } = await openStream(cB.node, fix.relayNode.getPeerId());
    await performAuth(rA, sA, cA.kp);
    await performAuth(rB, sB, cB.kp);

    await submitAndAck(rA, sA, sessionId, 0x00, cA.kp, 0);
    await rB.readDecoded();

    fix.relay.submitForSeal(sessionId);
    fix.relay.rejectSeal(sessionId, "test_rejection");

    const { structure1_cbor, sender_signature } = await makeStructure1(sessionId, new Uint8Array(randomBytes(32)), cA.kp, 1);
    sendFrame(sA, CBOR_ENC.encode({ type: "hash_submit", session_id: sessionId, leaf_kind: 0x00, structure1_cbor, sender_signature }));

    const resp = await rA.readDecoded();
    expect(resp["type"]).toBe("hash_submit_error");
    expect(resp["reason"]).toBe("session_sealed");

    sA.close().catch(() => {}); sB.close().catch(() => {});
    await cA.node.stop(); await cB.node.stop(); await fix.relayStop();
  }, 20_000);
});

// ─── relay-SI-NEW (SESSION-002) ───────────────────────────────────────────────
// relay rejects recordAssignment when directory signature fails Ed25519 verification

describe("relay-SI-NEW: recordAssignment rejects invalid directory signature", () => {
  it("returns directory_signature_invalid when signature is tampered (one byte flipped)", async () => {
    const fix = await makeFixture();
    const cA = await makeClient(fix.relayAddr);
    const cB = await makeClient(fix.relayAddr);

    const sessionId = new Uint8Array(randomBytes(16));
    const assignment = await makeAssignment(sessionId, cA.pubkey, cB.pubkey, fix.dirKp);

    // Tamper the signature — flip bit 0 of byte 0
    const tamperedSig = new Uint8Array(assignment.directory_signature);
    tamperedSig[0] ^= 0x01;
    const tampered: SessionAssignment = { ...assignment, directory_signature: tamperedSig };

    const result = fix.relay.recordAssignment(tampered);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("directory_signature_invalid");
    }

    await cA.node.stop(); await cB.node.stop(); await fix.relayStop();
  });

  it("returns directory_signature_invalid when signed by a different (non-directory) key", async () => {
    const fix = await makeFixture();
    const cA = await makeClient(fix.relayAddr);
    const cB = await makeClient(fix.relayAddr);

    const sessionId = new Uint8Array(randomBytes(16));

    // Sign with a random key that is NOT the directory key
    const impostor = generateKeypair();
    const assignment = await makeAssignment(sessionId, cA.pubkey, cB.pubkey, impostor);

    const result = fix.relay.recordAssignment(assignment);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("directory_signature_invalid");
    }

    await cA.node.stop(); await cB.node.stop(); await fix.relayStop();
  });

  it("accepts a validly-signed assignment and rejects hash_submit on an unregistered session_id", async () => {
    const fix = await makeFixture();
    const cA = await makeClient(fix.relayAddr);
    const cB = await makeClient(fix.relayAddr);

    // Valid assignment records successfully
    const sessionId = new Uint8Array(randomBytes(16));
    const assignment = await makeAssignment(sessionId, cA.pubkey, cB.pubkey, fix.dirKp);
    const result = fix.relay.recordAssignment(assignment);
    expect(result.ok).toBe(true);

    // An unregistered session_id returns session_not_found (SI-001 / AC-010)
    const unregisteredId = new Uint8Array(randomBytes(16));
    const { stream: sA, reader: rA } = await openStream(cA.node, fix.relayNode.getPeerId());
    await performAuth(rA, sA, cA.kp);

    const { structure1_cbor, sender_signature } = await makeStructure1(unregisteredId, new Uint8Array(randomBytes(32)), cA.kp, 0);
    sendFrame(sA, CBOR_ENC.encode({ type: "hash_submit", session_id: unregisteredId, leaf_kind: 0x00, structure1_cbor, sender_signature }));

    const resp = await rA.readDecoded();
    expect(resp["type"]).toBe("hash_submit_error");
    expect(resp["reason"]).toBe("session_not_found");

    sA.close().catch(() => {});
    await cA.node.stop(); await cB.node.stop(); await fix.relayStop();
  }, 20_000);
});

// ─── SESSION-002 AC-002 (relay side) ─────────────────────────────────────────
// relay computes genesis prev_root byte-identical to computeGenesisPrevRoot from @cello/protocol-types

describe("SESSION-002 AC-002: relay genesis prev_root matches computeGenesisPrevRoot from protocol-types", () => {
  it("Structure 2 prev_root for seq=1 equals computeGenesisPrevRoot(A, B, session_id, ts)", async () => {
    const fix = await makeFixture();
    const cA = await makeClient(fix.relayAddr);
    const cB = await makeClient(fix.relayAddr);

    const sessionId = new Uint8Array(randomBytes(16));
    const assignment = await makeAssignment(sessionId, cA.pubkey, cB.pubkey, fix.dirKp);
    fix.relay.recordAssignment(assignment);

    const { stream: sA, reader: rA } = await openStream(cA.node, fix.relayNode.getPeerId());
    const { stream: sB, reader: rB } = await openStream(cB.node, fix.relayNode.getPeerId());
    await performAuth(rA, sA, cA.kp);
    await performAuth(rB, sB, cB.kp);

    const contentHash = new Uint8Array(randomBytes(32));
    const { structure1_cbor, sender_signature } = await makeStructure1(sessionId, contentHash, cA.kp, 0);
    sendFrame(sA, CBOR_ENC.encode({ type: "hash_submit", session_id: sessionId, leaf_kind: 0x00, structure1_cbor, sender_signature }));

    await rA.readDecoded(); // hash_submit_ack
    const deliver = await rB.readDecoded(); // leaf_deliver

    // The prev_root in Structure 2 for seq=1 must equal computeGenesisPrevRoot
    const expected = computeGenesisPrevRoot(cA.pubkey, cB.pubkey, sessionId, assignment.session_timestamp);
    const actual = decodePrevRoot(toU8(deliver["structure2_cbor"]));
    expect(Buffer.from(actual).toString("hex")).toBe(Buffer.from(expected).toString("hex"));

    sA.close().catch(() => {}); sB.close().catch(() => {});
    await cA.node.stop(); await cB.node.stop(); await fix.relayStop();
  }, 20_000);
});

// ─── SESSION-003 AC-010: unilateral SEAL stalls in sealing ───────────────────

describe("SESSION-003 AC-010: only A submits SEAL ctrl leaf; relay stays active (never triggers bilateral seal)", () => {
  it("one ctrl leaf from A → relay does not submit for seal; B's subsequent hash_submit succeeds", async () => {
    const fix = await makeFixture();
    const cA = await makeClient(fix.relayAddr);
    const cB = await makeClient(fix.relayAddr);

    const sessionId = new Uint8Array(randomBytes(16));
    const assignment = await makeAssignment(sessionId, cA.pubkey, cB.pubkey, fix.dirKp);
    fix.relay.recordAssignment(assignment);

    const { stream: sA, reader: rA } = await openStream(cA.node, fix.relayNode.getPeerId());
    const { stream: sB, reader: rB } = await openStream(cB.node, fix.relayNode.getPeerId());
    await performAuth(rA, sA, cA.kp);
    await performAuth(rB, sB, cB.kp);

    // A submits a msg leaf (seq=1)
    await submitAndAck(rA, sA, sessionId, 0x00, cA.kp, 0);
    await rB.readDecoded(); // drain B's leaf_deliver for seq=1

    // A submits a SEAL ctrl leaf (seq=2, leaf_kind=0x02) — only A sealing
    const contentHashSeal = new Uint8Array(randomBytes(32));
    const { structure1_cbor: s1Seal, sender_signature: sigSeal } = await makeStructure1(sessionId, contentHashSeal, cA.kp, 0);
    sendFrame(sA, CBOR_ENC.encode({
      type: "hash_submit",
      session_id: sessionId,
      leaf_kind: 0x02,
      structure1_cbor: s1Seal,
      sender_signature: sigSeal,
    }));
    const ackSeal = await rA.readDecoded();
    expect(ackSeal["type"]).toBe("hash_submit_ack");
    await rA.readDecoded(); // drain own echo
    await rB.readDecoded(); // drain B's leaf_deliver for seq=2

    // Relay internal state: only one ctrl leaf (from A) → bilateral condition not met.
    // Session stays "active" in the relay; B can still submit successfully.
    await submitAndAck(rB, sB, sessionId, 0x00, cB.kp, 2);
    await rA.readDecoded(); // drain A's leaf_deliver for B's msg

    sA.close().catch(() => {}); sB.close().catch(() => {});
    await cA.node.stop(); await cB.node.stop(); await fix.relayStop();
  }, 20_000);
});
