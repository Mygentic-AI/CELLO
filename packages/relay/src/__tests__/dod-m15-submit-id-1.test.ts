/**
 * DOD-M15-SUBMIT-ID-1 (relay half) — a retransmitted message does not consume a second position.
 *
 * ─── The defect, from the operator's chair ─────────────────────────────────────────────────────
 *
 * You send one message. The ack does not arrive — the stream stalls, the relay restarts, a circuit
 * drops. Your client re-sends the same message, as it should.
 *
 * The relay treats the retransmission as a NEW submission: it advances the sequence counter, adds
 * another leaf to its Merkle tree, and returns a different position. Your one message now occupies
 * two canonical positions. Retry again and it occupies three. **Measured in the field: one message
 * consumed 49 positions, and verified content was destroyed at teardown 20 times on one daemon in
 * one day.**
 *
 * Nothing is corrupt in a way anyone can see until the seal, where the two sides' trees disagree
 * about how many leaves the conversation had — and by then the conversation is over.
 *
 * ─── Why a retry is invisible today ────────────────────────────────────────────────────────────
 *
 * Structure 1 is `[1, content_hash, sender_pubkey, session_id, last_seen_seq, timestamp]`. It
 * carries a TIMESTAMP, so re-sending the same message a moment later produces different bytes and a
 * different signature. The relay has no way to tell "this is that message again" from "this is
 * another message".
 *
 * `content_hash` is not enough on its own, and this is the trap worth naming: a sender may
 * legitimately send identical content twice in one conversation — two "ok"s are two messages, not a
 * duplicate. Deduplicating on content would silently swallow the second one, which is a worse
 * defect than the one being fixed.
 *
 * So the id has to be MINTED BY THE SENDER: stable across retries of one send, fresh for a new send.
 *
 * ─── Why this is the relay half only ───────────────────────────────────────────────────────────
 *
 * `decodeStructure1` rejects anything whose array length is not exactly 6. A client that appended a
 * submission id would have every frame refused as `signature_invalid` by any relay that has not
 * been updated — including the one deployed today. The DoD line says it plainly: *"the relay
 * tolerates the new shape before any client depends on it."*
 *
 * So this commit makes the relay accept BOTH shapes and act on the id when it is there. No client
 * emits one yet. The client half ships only after this is deployed, and until then the relay's
 * behaviour is byte-for-byte what it is today for every existing sender.
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
import type { SessionAssignment } from "../relay-types.js";

setupV3Tests();

const CBOR_ENC = new Encoder({ tagUint8Array: false });
const MSG_LEAF = 0x00;

function sendFrame(stream: Stream, bytes: Uint8Array): void {
  stream.send(lp.encode.single(bytes));
}

function toU8(v: unknown): Uint8Array {
  if (v instanceof Uint8Array) return v;
  if (Buffer.isBuffer(v)) return new Uint8Array(v as Buffer);
  throw new Error(`expected bytes, got ${typeof v}`);
}

class StreamReader {
  #it: AsyncIterator<Uint8Array>;
  constructor(stream: Stream) {
    this.#it = (lp.decode(stream) as AsyncIterable<Uint8Array>)[Symbol.asyncIterator]();
  }
  async readDecoded(): Promise<Record<string, unknown>> {
    const { value, done } = await this.#it.next();
    if (done || !value) throw new Error("stream ended");
    const raw = value instanceof Uint8Array ? value : (value as { slice(): Uint8Array }).slice();
    return decode(raw) as Record<string, unknown>;
  }
}

async function performRelayAuth(
  reader: StreamReader,
  stream: Stream,
  kp: ReturnType<typeof generateKeypair>,
): Promise<void> {
  const challenge = await reader.readDecoded();
  expect(challenge["type"]).toBe("relay_auth_challenge");
  const nonce = toU8(challenge["nonce"]);
  const pubkey = await kp.getPublicKey();
  const authMsg = new Uint8Array(Buffer.concat([Buffer.from("CELLO-RELAY-AUTH-v1", "utf8"), nonce, pubkey]));
  const signature = await kp.sign(new Uint8Array(createHash("sha256").update(authMsg).digest()));
  sendFrame(stream, CBOR_ENC.encode({ type: "relay_auth_response", pubkey, signature }) as Uint8Array);
  const ack = await reader.readDecoded();
  if (ack["type"] === "relay_auth_failed") throw new Error(`relay_auth_failed: ${String(ack["reason"])}`);
  expect(ack["type"]).toBe("relay_auth_ok");
}

/**
 * Build a Structure 1, optionally with the NEW seventh element.
 *
 * `contentHash` is a parameter so a test can re-send the SAME content — which is the whole subject —
 * and `timestamp` is too, so a retry can carry a different one exactly as a real retry would.
 */
async function makeS1(opts: {
  sessionId: Uint8Array;
  kp: ReturnType<typeof generateKeypair>;
  lastSeenSeq: number;
  contentHash: Uint8Array;
  timestamp: number;
  submissionId?: Uint8Array;
}): Promise<{ structure1_cbor: Uint8Array; sender_signature: Uint8Array }> {
  const fields: unknown[] = [
    1, opts.contentHash, await opts.kp.getPublicKey(), opts.sessionId, opts.lastSeenSeq, opts.timestamp,
  ];
  if (opts.submissionId) fields.push(opts.submissionId);
  const tbs = CBOR_ENC.encode(fields) as Uint8Array;
  return { structure1_cbor: tbs, sender_signature: await opts.kp.sign(tbs) };
}

async function makeAssignment(
  sessionId: Uint8Array,
  pubA: Uint8Array,
  pubB: Uint8Array,
  signingDir: ReturnType<typeof generateKeypair>,
): Promise<SessionAssignment> {
  const session_timestamp = Date.now();
  const tbs = CBOR_ENC.encode([
    sessionId, pubA, pubB,
    session_timestamp > 0xffffffff ? BigInt(session_timestamp) : session_timestamp,
  ]) as Uint8Array;
  return {
    session_id: sessionId,
    participant_a: pubA,
    participant_b: pubB,
    session_timestamp,
    directory_signature: await signingDir.sign(tbs),
  };
}

/** A relay plus one authenticated sender on a recorded session. */
async function harness(scope: ReturnType<typeof createTestScope>) {
  const dirKp = generateKeypair();
  const dirPub = await dirKp.getPublicKey();
  const { relay, node, stop } = await createRelayNode({
    directoryPubkey: dirPub,
    directoryPubkeys: [dirPub],
  });
  scope.addCleanup(async () => { await stop(); });

  const clientA = generateKeypair();
  const clientB = generateKeypair();
  const sessionId = new Uint8Array(randomBytes(16));
  expect(relay.recordAssignment(
    await makeAssignment(sessionId, await clientA.getPublicKey(), await clientB.getPublicKey(), dirKp),
  )).toEqual({ ok: true });

  const cn = await createNode({ keyProvider: clientA, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
  await cn.start();
  scope.addCleanup(async () => { await cn.stop(); });
  await cn.dial(node.listenAddresses()[0]!);
  const stream = await cn.newStream(node.getPeerId(), RELAY_PROTOCOL_ID);
  const reader = new StreamReader(stream);
  await performRelayAuth(reader, stream, clientA);

  /** Submit one leaf and return the relay's answer. */
  const submit = async (o: {
    contentHash: Uint8Array;
    lastSeenSeq: number;
    timestamp: number;
    submissionId?: Uint8Array;
  }): Promise<Record<string, unknown>> => {
    const { structure1_cbor, sender_signature } = await makeS1({ sessionId, kp: clientA, ...o });
    sendFrame(stream, CBOR_ENC.encode({
      type: "hash_submit", session_id: sessionId, leaf_kind: MSG_LEAF, structure1_cbor, sender_signature,
    }) as Uint8Array);
    let resp = await reader.readDecoded();
    for (let i = 0; i < 5 && resp["type"] !== "hash_submit_ack" && resp["type"] !== "hash_submit_error"; i++) {
      resp = await reader.readDecoded();
    }
    return resp;
  };

  return { submit };
}

describe("DOD-M15-SUBMIT-ID-1: the relay tolerates a submission id and is idempotent on it", () => {
  let scope = createTestScope();
  beforeEach(() => { scope = createTestScope(); });
  afterEach(() => scope.run(async () => {}));

  it("ACCEPTS the new seven-element shape — the tolerate-first half of the contract", async () => {
    /**
     * `decodeStructure1` required `arr.length === 6`, so this frame was refused outright as
     * `signature_invalid`. That is why the client cannot go first: every message it sent would be
     * rejected by the relay running today.
     */
    const h = await harness(scope);
    const resp = await h.submit({
      contentHash: new Uint8Array(randomBytes(32)),
      lastSeenSeq: 0,
      timestamp: Date.now(),
      submissionId: new Uint8Array(randomBytes(16)),
    });
    expect(
      resp["type"],
      `A frame carrying a submission id was refused (${String(resp["reason"])}). The relay must ` +
        `accept the new shape BEFORE any client emits it, or shipping the client half breaks every ` +
        `message against the deployed relay.`,
    ).toBe("hash_submit_ack");
  }, 30_000);

  it("STILL accepts the old six-element shape — nothing existing may break", async () => {
    // The compatibility control. Every client in the field sends six elements today.
    const h = await harness(scope);
    const resp = await h.submit({
      contentHash: new Uint8Array(randomBytes(32)),
      lastSeenSeq: 0,
      timestamp: Date.now(),
    });
    expect(resp["type"]).toBe("hash_submit_ack");
  }, 30_000);

  it("★ A RETRY RETURNS THE ORIGINAL POSITION and does not advance the counter", async () => {
    /**
     * The defect itself. Same content, same submission id, a later timestamp — exactly what a
     * client re-sending an unacknowledged message produces.
     *
     * Before: two positions for one message, and the two parties' trees disagree at the seal.
     */
    const h = await harness(scope);
    const contentHash = new Uint8Array(randomBytes(32));
    const submissionId = new Uint8Array(randomBytes(16));

    const first = await h.submit({ contentHash, lastSeenSeq: 0, timestamp: Date.now(), submissionId });
    expect(first["type"]).toBe("hash_submit_ack");

    const retry = await h.submit({ contentHash, lastSeenSeq: 0, timestamp: Date.now() + 5, submissionId });

    expect(retry["type"], `the retry was refused: ${String(retry["reason"])}`).toBe("hash_submit_ack");
    expect(
      retry["sequence_number"],
      `The retry was given a NEW canonical position. One message now occupies two, the relay's tree ` +
        `has two leaves for it, and at the seal the two sides disagree about how long the ` +
        `conversation was. In the field one message reached 49 positions this way.`,
    ).toBe(first["sequence_number"]);
  }, 30_000);

  it("a DIFFERENT submission id is a different message, even with identical content", async () => {
    /**
     * The counterexample that stops the fix from becoming content deduplication.
     *
     * Sending "ok" twice in one conversation is two messages. If the relay collapsed them, the
     * second would silently never exist — a worse defect than the one being fixed, and invisible
     * until someone read the transcript and found a reply missing.
     */
    const h = await harness(scope);
    const contentHash = new Uint8Array(randomBytes(32));

    const one = await h.submit({
      contentHash, lastSeenSeq: 0, timestamp: Date.now(), submissionId: new Uint8Array(randomBytes(16)),
    });
    const two = await h.submit({
      contentHash, lastSeenSeq: 0, timestamp: Date.now() + 5, submissionId: new Uint8Array(randomBytes(16)),
    });

    expect(one["type"]).toBe("hash_submit_ack");
    expect(two["type"]).toBe("hash_submit_ack");
    expect(
      two["sequence_number"],
      "identical content with a fresh submission id is a SECOND message and must get its own position",
    ).not.toBe(one["sequence_number"]);
  }, 30_000);

  it("a submission with NO id is never treated as a retry of anything", async () => {
    // Today's clients send no id. They must keep getting a fresh position every time, or an agent
    // that legitimately repeats itself would lose the repeat.
    const h = await harness(scope);
    const contentHash = new Uint8Array(randomBytes(32));
    const one = await h.submit({ contentHash, lastSeenSeq: 0, timestamp: Date.now() });
    const two = await h.submit({ contentHash, lastSeenSeq: 0, timestamp: Date.now() + 5 });
    expect(one["type"]).toBe("hash_submit_ack");
    expect(two["type"]).toBe("hash_submit_ack");
    expect(two["sequence_number"]).not.toBe(one["sequence_number"]);
  }, 30_000);
});
