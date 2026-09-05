/**
 * A relay plus authenticated senders on one recorded session — the shared `hash_submit` rig.
 *
 * Extracted from `dod-m15-submit-id-1.test.ts` when 033-ACKEMIT needed the same one. Moved rather
 * than copied, for the reason `relay-client-fake.ts` was moved on the client side: a second
 * hand-written relay rig drifts from the first silently, and the day a field is appended only one of
 * them learns about it — which is precisely the class of defect these tests exist to catch.
 *
 * What it gives a test: a running relay, a recorded assignment, and a `submit(...)` per participant
 * that builds a Structure 1, signs it, sends it and returns the relay's answer. Every knob a test
 * needs — the content hash, the timestamp, `last_seen_seq`, the seventh element in either of its two
 * meanings — is a parameter, so a test says only what it changes.
 */
import { expect } from "@claude-flow/testing";
import { createHash, randomBytes } from "node:crypto";
import { Encoder, decode } from "cbor-x";
import * as lp from "it-length-prefixed";
import { generateKeypair } from "@cello-protocol/crypto";
import { createNode } from "@cello-protocol/transport";
import type { Stream } from "@libp2p/interface";
import { createRelayNode, RELAY_PROTOCOL_ID } from "../../relay-node.js";
import type { SessionAssignment } from "../../relay-types.js";
import { testOnlineToken } from "./online-token.js";

const CBOR_ENC = new Encoder({ tagUint8Array: false });
export const MSG_LEAF = 0x00;

export function sendFrame(stream: Stream, bytes: Uint8Array): void {
  stream.send(lp.encode.single(bytes));
}

export function toU8(v: unknown): Uint8Array {
  if (v instanceof Uint8Array) return v;
  if (Buffer.isBuffer(v)) return new Uint8Array(v as Buffer);
  throw new Error(`expected bytes, got ${typeof v}`);
}

export class StreamReader {
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

// DOD-M15-RELAYSLOTS-1: the relay refuses an auth carrying no directory-issued online token.
export async function performRelayAuth(
  reader: StreamReader,
  stream: Stream,
  kp: ReturnType<typeof generateKeypair>,
  dirKp: ReturnType<typeof generateKeypair>,
): Promise<void> {
  const challenge = await reader.readDecoded();
  expect(challenge["type"]).toBe("relay_auth_challenge");
  const nonce = toU8(challenge["nonce"]);
  const pubkey = await kp.getPublicKey();
  const authMsg = new Uint8Array(Buffer.concat([Buffer.from("CELLO-RELAY-AUTH-v1", "utf8"), nonce, pubkey]));
  const signature = await kp.sign(new Uint8Array(createHash("sha256").update(authMsg).digest()));
  sendFrame(stream, CBOR_ENC.encode({
    type: "relay_auth_response",
    pubkey,
    signature,
    online_token: await testOnlineToken(dirKp, kp),
  }) as Uint8Array);
  const ack = await reader.readDecoded();
  if (ack["type"] === "relay_auth_failed") throw new Error(`relay_auth_failed: ${String(ack["reason"])}`);
  expect(ack["type"]).toBe("relay_auth_ok");
}

/**
 * Build a Structure 1 in EITHER layout.
 *
 * `contentHash` is a parameter so a test can re-send the SAME content — the submission-id subject —
 * and `timestamp` is too, so a retry carries a different one exactly as a real retry would.
 *
 * ⚠️ INDEX 6 HAS TWO MEANINGS AND THE VERSION IS WHAT SEPARATES THEM (033-ACKEMIT). `submissionId`
 * writes a v1 seven-array; `lastSeenHash` writes a v2 one. Passing both is a caller error, because
 * it is a frame that cannot exist on the wire — the two are mutually exclusive by construction and
 * a rig that let a test build one would be testing a shape nothing can emit.
 */
export async function makeS1(opts: {
  sessionId: Uint8Array;
  kp: ReturnType<typeof generateKeypair>;
  lastSeenSeq: number;
  contentHash: Uint8Array;
  timestamp: number;
  submissionId?: Uint8Array;
  lastSeenHash?: Uint8Array;
  claimedSenderPubkey?: Uint8Array;
}): Promise<{ structure1_cbor: Uint8Array; sender_signature: Uint8Array }> {
  if (opts.submissionId && opts.lastSeenHash) {
    throw new Error("makeS1: index 6 is a submission id (v1) OR an ack hash (v2), never both");
  }
  const version = opts.lastSeenHash ? 2 : 1;
  const fields: unknown[] = [
    version,
    opts.contentHash,
    // Normally the signer's own key. `claimedSenderPubkey` names a different one, which is the only
    // way to build a leaf whose claimed sender is not its signer.
    opts.claimedSenderPubkey ?? (await opts.kp.getPublicKey()),
    opts.sessionId,
    opts.lastSeenSeq,
    opts.timestamp,
  ];
  if (opts.submissionId) fields.push(opts.submissionId);
  if (opts.lastSeenHash) fields.push(opts.lastSeenHash);
  const tbs = CBOR_ENC.encode(fields) as Uint8Array;
  return { structure1_cbor: tbs, sender_signature: await opts.kp.sign(tbs) };
}

export async function makeAssignment(
  sessionId: Uint8Array,
  pubA: Uint8Array,
  pubB: Uint8Array,
  signingDir: ReturnType<typeof generateKeypair>,
  sessionTimestamp: number = Date.now(),
): Promise<SessionAssignment> {
  const tbs = CBOR_ENC.encode([
    sessionId, pubA, pubB,
    sessionTimestamp > 0xffffffff ? BigInt(sessionTimestamp) : sessionTimestamp,
  ]) as Uint8Array;
  return {
    session_id: sessionId,
    participant_a: pubA,
    participant_b: pubB,
    session_timestamp: sessionTimestamp,
    directory_signature: await signingDir.sign(tbs),
  };
}

export interface SubmitOpts {
  contentHash: Uint8Array;
  lastSeenSeq: number;
  timestamp: number;
  submissionId?: Uint8Array;
  lastSeenHash?: Uint8Array;
  /**
   * 034-CARRYLEAF — sign the leaf with THIS key instead of the submitting connection's.
   *
   * A counter-submit: one participant hands the relay a leaf their COUNTERPARTY authored and did
   * not witness. The leaf is signed by the author; the connection belongs to the other party. A rig
   * that could not express that could not test the case at all.
   */
  authorKp?: ReturnType<typeof generateKeypair>;
  /**
   * Name a DIFFERENT key as the leaf's sender than the one that signs it — 034-CARRYLEAF review.
   *
   * The only way to reach the `s1PubkeyHex !== signerHex` guard, which is now the sole remaining
   * binding between a leaf and its author. Without this the rig could only build leaves whose named
   * sender IS their signer, so a test aimed at that guard was refused earlier by
   * `witnessLeafSignature` and passed for the wrong reason.
   */
  claimedSenderPubkey?: Uint8Array;
}

export type Submit = (o: SubmitOpts) => Promise<Record<string, unknown>>;

/** One `session_witness_alert` the relay pushed, with the participant it was pushed to. */
export interface CapturedWitnessAlert {
  recipient: string;
  reason: string;
  submitterIsCounterparty: boolean;
}

export interface SubmitHarness {
  submit: Submit;
  submitAsB: Submit;
  /**
   * Every witness alert the relay pushed to either participant — 034-CARRYLEAF.
   *
   * The relay sends these unsolicited on the participants' own streams, so a rig that only reads
   * replies to its own submits cannot see them, and a guard whose only consumer is the relay's log
   * would look tested when nothing had checked it reached anyone.
   */
  witnessAlerts: CapturedWitnessAlert[];
  /** The two participants' keypairs, so a test can sign a leaf as one and submit it as the other. */
  clientA: ReturnType<typeof generateKeypair>;
  clientB: ReturnType<typeof generateKeypair>;
  /**
   * Everything a test needs to derive the session's genesis prev_root for itself — the value a
   * `last_seen_seq` of 0 acknowledges. Exposed rather than pre-computed so a test derives it the
   * way both parties do, instead of trusting a number this rig handed it.
   */
  sessionId: Uint8Array;
  pubA: Uint8Array;
  pubB: Uint8Array;
  sessionTimestamp: number;
}

/** A relay plus BOTH authenticated participants on one recorded session. */
export async function submitHarness(scope: { addCleanup(fn: () => Promise<void>): void }): Promise<SubmitHarness> {
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
  const pubA = await clientA.getPublicKey();
  const pubB = await clientB.getPublicKey();
  const sessionTimestamp = Date.now();
  expect(relay.recordAssignment(
    await makeAssignment(sessionId, pubA, pubB, dirKp, sessionTimestamp),
  )).toEqual({ ok: true });

  /**
   * BOTH participants get a stream. The second one is not decoration: the submission-id key is
   * SENDER-SCOPED, and the only way to test that is to have the other party try to use an id.
   */
  const witnessAlerts: CapturedWitnessAlert[] = [];
  const connect = async (kp: ReturnType<typeof generateKeypair>): Promise<Submit> => {
    const cn = await createNode({ keyProvider: kp, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await cn.start();
    scope.addCleanup(async () => { await cn.stop(); });
    await cn.dial(node.listenAddresses()[0]!);
    const stream = await cn.newStream(node.getPeerId(), RELAY_PROTOCOL_ID);
    const reader = new StreamReader(stream);
    await performRelayAuth(reader, stream, kp, dirKp);

    return async (o: SubmitOpts): Promise<Record<string, unknown>> => {
      // The leaf is signed by its AUTHOR; the stream belongs to whoever is submitting it.
      const { structure1_cbor, sender_signature } = await makeS1({ sessionId, kp: o.authorKp ?? kp, ...o });
      sendFrame(stream, CBOR_ENC.encode({
        type: "hash_submit", session_id: sessionId, leaf_kind: MSG_LEAF, structure1_cbor, sender_signature,
      }) as Uint8Array);
      let resp = await reader.readDecoded();
      for (let i = 0; i < 8 && resp["type"] !== "hash_submit_ack" && resp["type"] !== "hash_submit_error"; i++) {
        // Unsolicited frames arrive on the same stream. Witness alerts are captured rather than
        // skipped — they are the only evidence that a guard reached a person.
        if (resp["type"] === "session_witness_alert") {
          witnessAlerts.push({
            recipient: Buffer.from(await kp.getPublicKey()).toString("hex"),
            reason: String(resp["reason"]),
            submitterIsCounterparty: resp["submitter_is_counterparty"] === true,
          });
        }
        resp = await reader.readDecoded();
      }
      return resp;
    };
  };

  return {
    submit: await connect(clientA),
    submitAsB: await connect(clientB),
    clientA, clientB,
    witnessAlerts,
    sessionId, pubA, pubB, sessionTimestamp,
  };
}
