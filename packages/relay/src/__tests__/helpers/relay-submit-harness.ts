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
import { computeGenesisPrevRoot } from "@cello-protocol/protocol-types";
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
 * ⚠️ BOTH CHAIN LINKS ARE REQUIRED — `DOD-M15-SELFCHAIN-1`. There is one Structure 1 layout and it
 * carries both: `lastSeenHash` (the last message received from the counterparty) and `prevOwnHash`
 * (this sender's own previous message). A claim with one link does not exist on the wire, so this
 * rig cannot build one — a rig that could would be testing a shape nothing can emit.
 *
 * The submission-id layout this helper used to build is gone with the rest of the tolerances: no
 * client ever emitted one, and the retry dedup it served now keys on the SIGNED pair
 * `(prev_own_hash, content_hash)` instead. A test exercising a retransmission re-sends the same
 * content with the same `prevOwnHash` and a fresh timestamp, exactly as a real retry does.
 */
export async function makeS1(opts: {
  sessionId: Uint8Array;
  kp: ReturnType<typeof generateKeypair>;
  lastSeenSeq: number;
  contentHash: Uint8Array;
  timestamp: number;
  lastSeenHash: Uint8Array;
  prevOwnHash: Uint8Array;
}): Promise<{ structure1_cbor: Uint8Array; sender_signature: Uint8Array }> {
  const tbs = CBOR_ENC.encode([
    3,
    opts.contentHash,
    await opts.kp.getPublicKey(),
    opts.sessionId,
    opts.lastSeenSeq,
    opts.timestamp,
    opts.lastSeenHash,
    opts.prevOwnHash,
  ]) as Uint8Array;
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
  lastSeenHash: Uint8Array;
  /**
   * `DOD-M15-SELFCHAIN-1` — this sender's own previous message. Required, because the layout is.
   *
   * A test sending its FIRST message on the session passes the session genesis, which `genesis()`
   * below derives the way both parties do. A test sending a SECOND passes the content hash of its
   * first, which is what makes the relay's chain check pass — and what a test of a BROKEN chain
   * deliberately gets wrong.
   */
  prevOwnHash: Uint8Array;
}

export type Submit = (o: SubmitOpts) => Promise<Record<string, unknown>>;

export interface SubmitHarness {
  submit: Submit;
  submitAsB: Submit;
  /**
   * Everything a test needs to derive the session's genesis prev_root for itself — the value a
   * `last_seen_seq` of 0 acknowledges. Exposed rather than pre-computed so a test derives it the
   * way both parties do, instead of trusting a number this rig handed it.
   */
  sessionId: Uint8Array;
  pubA: Uint8Array;
  pubB: Uint8Array;
  sessionTimestamp: number;
  /**
   * The session's agreed starting point — what BOTH chain links carry before anything has been
   * said. Derived here the way the relay derives it, so a test never hard-codes a value the relay
   * would disagree with.
   */
  genesis: Uint8Array;
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
   * BOTH participants get a stream. The second one is not decoration: every chain check is
   * PER SENDER, so a conversation with one voice in it cannot exercise any of them.
   */
  const connect = async (kp: ReturnType<typeof generateKeypair>): Promise<Submit> => {
    const cn = await createNode({ keyProvider: kp, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await cn.start();
    scope.addCleanup(async () => { await cn.stop(); });
    await cn.dial(node.listenAddresses()[0]!);
    const stream = await cn.newStream(node.getPeerId(), RELAY_PROTOCOL_ID);
    const reader = new StreamReader(stream);
    await performRelayAuth(reader, stream, kp, dirKp);

    return async (o: SubmitOpts): Promise<Record<string, unknown>> => {
      const { structure1_cbor, sender_signature } = await makeS1({ sessionId, kp, ...o });
      sendFrame(stream, CBOR_ENC.encode({
        type: "hash_submit", session_id: sessionId, leaf_kind: MSG_LEAF, structure1_cbor, sender_signature,
      }) as Uint8Array);
      let resp = await reader.readDecoded();
      for (let i = 0; i < 6 && resp["type"] !== "hash_submit_ack" && resp["type"] !== "hash_submit_error"; i++) {
        resp = await reader.readDecoded();
      }
      return resp;
    };
  };

  return {
    submit: await connect(clientA),
    submitAsB: await connect(clientB),
    sessionId, pubA, pubB, sessionTimestamp,
    genesis: computeGenesisPrevRoot(pubA, pubB, sessionId, sessionTimestamp),
  };
}

/**
 * ─── THE TEST-SIDE CHAIN — `DOD-M15-SELFCHAIN-1` ───────────────────────────────────────────────
 *
 * Every message carries two links and the relay checks both, so a rig that hands a fixed value to
 * either can build first messages and nothing else. These keep what a real client keeps.
 *
 * ⚠️ THE TWO LINKS ARE READ DIFFERENTLY, and a first pass here got it wrong in a way that passes
 * most of the time:
 *
 *   - `last_seen_hash` is **POSITIONAL**. The relay compares it against the leaf at
 *     `last_seen_seq`, so the rig must name the content at THAT position.
 *   - `prev_own_hash` is **per sender** — the last message this sender wrote, wherever it landed.
 *
 * Reading both as "the last thing the other party sent" is the same value only while the two
 * parties strictly alternate, which is most tests and not all of them.
 *
 * Both fall back to the session GENESIS, which is what a first message legitimately carries.
 *
 * ⚠️ ADVANCE ONLY FOR MESSAGES THAT WERE ACTUALLY BUILT AND WITNESSED. A rig that advances over a
 * submit the relay refused builds a chain the relay never saw, and every later assertion in that
 * test is about a conversation that does not exist.
 *
 * Module-level and shared across test files, which is safe because every session id is random.
 */
const CHAIN_GENESIS = new Map<string, Uint8Array>();
const CHAIN_LOG = new Map<string, Array<{ sender: string; hash: Uint8Array }>>();

export function seedChain(sessionId: Uint8Array, pubA: Uint8Array, pubB: Uint8Array, ts: number): void {
  const sidHex = Buffer.from(sessionId).toString("hex");
  CHAIN_GENESIS.set(sidHex, computeGenesisPrevRoot(pubA, pubB, sessionId, ts));
  CHAIN_LOG.set(sidHex, []);
}

export function chainLinks(
  sessionId: Uint8Array,
  pubkey: Uint8Array,
  lastSeenSeq: number,
): { lastSeenHash: Uint8Array; prevOwnHash: Uint8Array } {
  const sidHex = Buffer.from(sessionId).toString("hex");
  const me = Buffer.from(pubkey).toString("hex");
  const genesis = CHAIN_GENESIS.get(sidHex) ?? new Uint8Array(32);
  const log = CHAIN_LOG.get(sidHex) ?? [];
  // The relay numbers from 1 and `log` is in append order, so position N is `log[N - 1]`.
  const seen = lastSeenSeq >= 1 ? (log[lastSeenSeq - 1]?.hash ?? genesis) : genesis;
  let own = genesis;
  for (const e of log) if (e.sender === me) own = e.hash;
  return { lastSeenHash: seen, prevOwnHash: own };
}

export function chainAdvance(sessionId: Uint8Array, pubkey: Uint8Array, contentHash: Uint8Array): void {
  const log = CHAIN_LOG.get(Buffer.from(sessionId).toString("hex"));
  if (log) log.push({ sender: Buffer.from(pubkey).toString("hex"), hash: contentHash });
}

/**
 * Build the one Structure 1 layout with both links filled from the chain, and advance it.
 *
 * The single place a relay test should build a claim: a local copy in each file is how the layout
 * and the rig drift apart, which is the same argument the production code makes for having one
 * encoder.
 */
export async function chainedS1(opts: {
  sessionId: Uint8Array;
  kp: ReturnType<typeof generateKeypair>;
  contentHash: Uint8Array;
  lastSeenSeq: number;
  timestamp?: number;
}): Promise<{ structure1_cbor: Uint8Array; sender_signature: Uint8Array }> {
  const pubkey = await opts.kp.getPublicKey();
  const { lastSeenHash, prevOwnHash } = chainLinks(opts.sessionId, pubkey, opts.lastSeenSeq);
  const tbs = CBOR_ENC.encode([
    3, opts.contentHash, pubkey, opts.sessionId, opts.lastSeenSeq,
    opts.timestamp ?? Date.now(), lastSeenHash, prevOwnHash,
  ]) as Uint8Array;
  chainAdvance(opts.sessionId, pubkey, opts.contentHash);
  return { structure1_cbor: tbs, sender_signature: await opts.kp.sign(tbs) };
}
