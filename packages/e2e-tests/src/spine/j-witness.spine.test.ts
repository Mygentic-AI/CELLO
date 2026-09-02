/**
 * J-WITNESS — DOD-M15-CORROBORATE-1, against the REAL relay binary in its own OS process.
 *
 * ─── Why this journey exists and the unit suite is not enough ──────────────────────────────────
 *
 * The relay package's own tests build a relay node inside the test process. That proves the code
 * path; it cannot prove that the relay a person actually runs — the shipped `relay.js`, started from
 * env, wired to real directories — reaches it. Every part of this file talks to that process over a
 * real libp2p stream and reads its real stdout.
 *
 * ─── The clause this file is for ───────────────────────────────────────────────────────────────
 *
 * B, the party who would normally be the one to notice a forged message, does NOTHING here. It
 * authenticates and then sends the relay not one further frame — no accusation, no report, no
 * check. It stands in for a client that cannot or will not report, including one that would lie.
 * The alert arrives anyway, because the witness saw it for itself.
 *
 * Both clients are written here rather than driven through daemons on purpose: the forgery has to be
 * SENT, and a correct daemon will not send one.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { join } from "node:path";
import { Encoder, decode } from "cbor-x";
import * as lp from "it-length-prefixed";
import { FileKeyProvider, generateKeypair } from "@cello-protocol/crypto";
import { createNode, type CelloNode } from "@cello-protocol/transport";
import { mintOnlineToken, ONLINE_TOKEN_ISSUE_LIFETIME_MS } from "@cello-protocol/interfaces";
import { RELAY_PROTOCOL_ID } from "@cello-protocol/relay";
import { startSpineCluster, type SpineCluster } from "./live-harness.js";

const CBOR = new Encoder({ tagUint8Array: false });
type Keypair = ReturnType<typeof generateKeypair>;
/** The transport's own stream type — taken from the node rather than pulling in a libp2p dep. */
type Stream = Awaited<ReturnType<CelloNode["newStream"]>>;

let cluster: SpineCluster;
/** The SAME signing key the running directory process uses — read from its own key file. */
let dirKp: FileKeyProvider;
const stopNodes: Array<() => Promise<void>> = [];

beforeAll(async () => {
  cluster = await startSpineCluster();
  dirKp = await FileKeyProvider.load(join(cluster.tmpDir, "directory-key-0"));
}, 300_000);

afterAll(async () => {
  for (const stop of stopNodes.reverse()) { try { await stop(); } catch { /* teardown */ } }
  if (cluster) await cluster.stop();
}, 120_000);

class Reader {
  readonly #iter: AsyncIterator<unknown>;
  constructor(stream: Stream) {
    this.#iter = (lp.decode(stream) as AsyncIterable<unknown>)[Symbol.asyncIterator]() as AsyncIterator<unknown>;
  }
  async next(timeoutMs = 15_000): Promise<Record<string, unknown>> {
    const res = await Promise.race([
      this.#iter.next(),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("frame_timeout")), timeoutMs)),
    ]);
    const v = (res as IteratorResult<unknown>).value as { subarray(): Uint8Array };
    return decode(v.subarray()) as Record<string, unknown>;
  }
}

function send(stream: Stream, bytes: Uint8Array): void {
  stream.send(lp.encode.single(bytes));
}

/** A real libp2p client, authenticated to the running relay with a real directory-issued token. */
async function authedClient(kp: Keypair): Promise<{ stream: Stream; reader: Reader }> {
  const node = await createNode({ keyProvider: kp, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
  await node.start();
  stopNodes.push(async () => { await node.stop(); });
  await node.dial(cluster.relayMultiaddr);
  const relayPeerId = cluster.relayMultiaddr.split("/p2p/")[1]!;
  const stream = await node.newStream(relayPeerId, RELAY_PROTOCOL_ID);
  const reader = new Reader(stream);
  const nonce = (await reader.next())["nonce"] as Uint8Array;
  const pubkey = await kp.getPublicKey();
  const authMsg = new Uint8Array(Buffer.concat([Buffer.from("CELLO-RELAY-AUTH-v1", "utf8"), nonce, pubkey]));
  send(stream, CBOR.encode({
    type: "relay_auth_response",
    pubkey,
    signature: await kp.sign(new Uint8Array(createHash("sha256").update(authMsg).digest())),
    online_token: await mintOnlineToken({
      agentPubkey: pubkey,
      expiresAtMs: Date.now() + ONLINE_TOKEN_ISSUE_LIFETIME_MS,
      sign: async (tbs) => dirKp.sign(tbs),
    }),
  }));
  const ok = await reader.next();
  expect(ok["type"], "precondition: authenticated against the LIVE relay, or this tests nothing").toBe("relay_auth_ok");
  return { stream, reader };
}

describe("J-WITNESS: the live relay flags a leaf nobody in the session signed, without the receiver's help", () => {
  it("★★★ B reports NOTHING and is still told — by the relay process, over its own stream", async () => {
    const kpA = generateKeypair();
    const kpB = generateKeypair();
    const pubA = await kpA.getPublicKey();
    const pubB = await kpB.getPublicKey();

    const a = await authedClient(kpA);
    const b = await authedClient(kpB);

    // A directory-signed assignment, presented by the client exactly as production does (Option B).
    // These two keys are what the relay verifies every subsequent leaf against.
    const sessionId = new Uint8Array(randomBytes(16));
    const ts = Date.now();
    const tsEncoded = ts > 0xffffffff ? BigInt(ts) : ts;
    send(a.stream, CBOR.encode({
      type: "client_record_assignment",
      session_id: sessionId,
      participant_a: pubA,
      participant_b: pubB,
      session_timestamp: tsEncoded,
      assignment_signature: await dirKp.sign(CBOR.encode([sessionId, pubA, pubB, tsEncoded]) as Uint8Array),
    }));
    expect((await a.reader.next())["type"], "precondition: the live relay must record the session").toBe("assignment_ok");

    // A submits a leaf CLAIMING A as its author and signed by a key belonging to neither party.
    const forger = generateKeypair();
    const structure1_cbor = CBOR.encode([
      1, new Uint8Array(randomBytes(32)), pubA, sessionId, 0, Date.now(),
    ]) as Uint8Array;
    send(a.stream, CBOR.encode({
      type: "hash_submit",
      session_id: sessionId,
      leaf_kind: 0x00,
      structure1_cbor,
      sender_signature: await forger.sign(structure1_cbor),
    }));

    const err = await a.reader.next();
    expect(err["type"]).toBe("hash_submit_error");
    expect(
      err["reason"],
      "refused at SUBMISSION by the deployed relay, not left for the directory to find at seal time",
    ).toBe("leaf_signed_by_neither_participant");

    // ── The clause. B has sent this relay nothing since authenticating. ──
    const alert = await b.reader.next();
    expect(alert["type"], "the witness must reach B without B having reported anything").toBe("session_witness_alert");
    expect(alert["reason"]).toBe("leaf_signed_by_neither_participant");
    expect(Buffer.from(alert["session_id"] as Uint8Array)).toEqual(Buffer.from(sessionId));
    expect(alert["submitter_is_counterparty"]).toBe(true);

    // ── And the relay operator's own process wrote the durable half. ──
    expect(
      cluster.relay.output,
      "the relay's log is the forensic record and must name the observation",
    ).toMatch(/relay\.witness\.leaf_unwitnessed/);

    // ── The session is NOT torn down: A's next honest leaf is sequenced at position 1. ──
    const honest = CBOR.encode([1, new Uint8Array(randomBytes(32)), pubA, sessionId, 0, Date.now()]) as Uint8Array;
    send(a.stream, CBOR.encode({
      type: "hash_submit", session_id: sessionId, leaf_kind: 0x00,
      structure1_cbor: honest, sender_signature: await kpA.sign(honest),
    }));
    const ack = await a.reader.next();
    expect(ack["type"], "a flagged session keeps being relayed — see #flagUnwitnessedLeaf").toBe("hash_submit_ack");
    expect(ack["sequence_number"], "and the refused leaf took no position in the tree").toBe(1);

    await a.stream.close().catch(() => {});
    await b.stream.close().catch(() => {});
  }, 180_000);
});
