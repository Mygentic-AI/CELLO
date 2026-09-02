/**
 * DOD-M15-CORROBORATE-1 — the relay checks every hash as it passes, and tells the other side.
 *
 * ─── What the operator lives through without this ──────────────────────────────────────────────
 *
 * 1. Their counterparty's client says a message failed to verify and freezes the conversation.
 * 2. That claim is the ONLY record of the event, and it was produced by the one party with a
 *    motive to produce a false one.
 * 3. There is nowhere to check it. The operator cannot tell an impersonation attempt from a
 *    counterparty inventing one, and neither can anyone they show it to later.
 *
 * The relay was already holding the answer: it receives every signed hash and it holds both
 * participants' real keys, from a directory-signed assignment neither of them can rewrite. It just
 * never looked until seal time.
 *
 * Everything below runs against a REAL relay node over a real libp2p stream. `witnessLeafSignature`
 * called directly would prove the predicate and nothing about whether the relay reaches it, which is
 * where the previous generation of this defect lived.
 */

import {
  setupV3Tests, createTestScope, describe, it, expect, beforeEach, afterEach,
} from "@claude-flow/testing";
import { createHash, randomBytes } from "node:crypto";
import { Encoder, decode } from "cbor-x";
import * as lp from "it-length-prefixed";
import type { Stream } from "@libp2p/interface";
import { generateKeypair } from "@cello-protocol/crypto";
import { createNode } from "@cello-protocol/transport";
import type { Logger } from "@cello-protocol/interfaces";
import { createRelayNode, RELAY_PROTOCOL_ID } from "../relay-node.js";
import { testOnlineToken } from "./helpers/online-token.js";

setupV3Tests();

const CBOR = new Encoder({ tagUint8Array: false });
const RELAY_ID = "relay-witness-under-test";

type Keypair = ReturnType<typeof generateKeypair>;
interface Captured { level: string; event: string; ctx: Record<string, unknown> }

function capturingLogger(sink: Captured[]): Logger {
  const at = (level: string) => (event: string, ctx?: Record<string, unknown>) => {
    sink.push({ level, event, ctx: ctx ?? {} });
  };
  return { debug: at("debug"), info: at("info"), warn: at("warn"), error: at("error") } as unknown as Logger;
}

class Reader {
  readonly #iter: AsyncIterator<unknown>;
  constructor(stream: Stream) {
    this.#iter = (lp.decode(stream) as AsyncIterable<unknown>)[Symbol.asyncIterator]() as AsyncIterator<unknown>;
  }
  async next(timeoutMs = 5_000): Promise<Record<string, unknown>> {
    const res = await Promise.race([
      this.#iter.next(),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("frame_timeout")), timeoutMs)),
    ]);
    const v = (res as IteratorResult<unknown>).value as { subarray(): Uint8Array };
    return decode(v.subarray()) as Record<string, unknown>;
  }
  /** Resolves undefined if nothing arrives — for asserting that a healthy session is left alone. */
  async nextOrSilence(timeoutMs: number): Promise<Record<string, unknown> | undefined> {
    try { return await this.next(timeoutMs); } catch { return undefined; }
  }
}

function send(stream: Stream, bytes: Uint8Array): void {
  stream.send(lp.encode.single(bytes));
}

/** Structure 1 as the client builds it: [1, content_hash, sender_pubkey, session_id, last_seen, ts]. */
async function makeLeaf(
  sessionId: Uint8Array,
  claimedSender: Keypair,
  signer: Keypair,
): Promise<{ structure1_cbor: Uint8Array; sender_signature: Uint8Array }> {
  const structure1_cbor = CBOR.encode([
    1, new Uint8Array(randomBytes(32)), await claimedSender.getPublicKey(), sessionId, 0, Date.now(),
  ]) as Uint8Array;
  return { structure1_cbor, sender_signature: await signer.sign(structure1_cbor) };
}

describe("DOD-M15-CORROBORATE-1: the relay verifies each hash at arrival and alerts the other side", () => {
  let scope = createTestScope();
  beforeEach(() => { scope = createTestScope(); });
  afterEach(() => scope.run(async () => {}));

  /** A relay with a real directory key, a real assignment, and A + B authenticated to it. */
  async function fixture(opts: { connectB?: boolean } = {}) {
    const events: Captured[] = [];
    const dirKp = generateKeypair();
    const { node: relayNode, relay, stop } = await createRelayNode({
      directoryPubkey: await dirKp.getPublicKey(),
      logger: capturingLogger(events),
      relayId: RELAY_ID,
    });
    scope.addCleanup(stop);

    const kpA = generateKeypair();
    const kpB = generateKeypair();
    const sessionId = new Uint8Array(randomBytes(16));
    const pubA = await kpA.getPublicKey();
    const pubB = await kpB.getPublicKey();
    // Recorded exactly as a directory-signed assignment lands: these two keys are what the witness
    // check verifies against, and neither participant can change them. The timestamp is encoded as
    // a BigInt above 0xffffffff to match recordAssignment's own TBS — every Date.now() is.
    const ts = Date.now();
    const assignmentTbs = CBOR.encode([sessionId, pubA, pubB, ts > 0xffffffff ? BigInt(ts) : ts]) as Uint8Array;
    expect(relay.recordAssignment({
      session_id: sessionId, participant_a: pubA, participant_b: pubB, session_timestamp: ts,
      directory_signature: await dirKp.sign(assignmentTbs),
    }).ok, "precondition: the session must be recorded, or every submit answers session_not_found").toBe(true);

    const connect = async (kp: Keypair) => {
      const cn = await createNode({ keyProvider: kp, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
      await cn.start();
      scope.addCleanup(async () => { await cn.stop(); });
      await cn.dial(relayNode.listenAddresses()[0]!);
      const stream = await cn.newStream(relayNode.getPeerId(), RELAY_PROTOCOL_ID);
      const reader = new Reader(stream);
      const nonce = (await reader.next())["nonce"] as Uint8Array;
      const pubkey = await kp.getPublicKey();
      const authMsg = new Uint8Array(Buffer.concat([Buffer.from("CELLO-RELAY-AUTH-v1", "utf8"), nonce, pubkey]));
      send(stream, CBOR.encode({
        type: "relay_auth_response",
        pubkey,
        signature: await kp.sign(new Uint8Array(createHash("sha256").update(authMsg).digest())),
        online_token: await testOnlineToken(dirKp, kp),
      }));
      expect((await reader.next())["type"], "precondition: genuinely authenticated").toBe("relay_auth_ok");
      return { stream, reader };
    };

    const a = await connect(kpA);
    const b = opts.connectB === false ? undefined : await connect(kpB);
    return { events, dirKp, relay, relayNode, kpA, kpB, sessionId, a, b, connect };
  }

  it("★★★ a participant's leaf signed by a THIRD key is refused AT SUBMISSION, and B — who reports nothing — is told by the relay", async () => {
    const fx = await fixture();
    const stranger = generateKeypair();

    // A submits a leaf that CLAIMS A as sender and is signed by a key belonging to neither party.
    const forged = await makeLeaf(fx.sessionId, fx.kpA, stranger);
    send(fx.a.stream, CBOR.encode({
      type: "hash_submit", session_id: fx.sessionId, leaf_kind: 0x00, ...forged,
    }));

    const err = await fx.a.reader.next();
    expect(err["type"], "the submitter must be answered, not left to time out").toBe("hash_submit_error");
    expect(
      err["reason"],
      "and named for what actually happened: nobody in this conversation signed those bytes",
    ).toBe("leaf_signed_by_neither_participant");

    /**
     * ⚠️ THE CLAUSE THIS UNIT EXISTS FOR. B has sent the relay nothing since authenticating — it has
     * made no accusation, run no check, and could be a client that deliberately reports nothing.
     * The alert arrives anyway, because the relay saw it itself.
     */
    const alert = await fx.b!.reader.next();
    expect(alert["type"]).toBe("session_witness_alert");
    expect(alert["reason"]).toBe("leaf_signed_by_neither_participant");
    expect(Buffer.from(alert["session_id"] as Uint8Array)).toEqual(Buffer.from(fx.sessionId));
    expect(alert["submitter_is_counterparty"], "it was A's authenticated connection that submitted it").toBe(true);
    expect(alert["relay_id"], "one witness, and it must be nameable — 'a relay said so' is not a record").toBe(RELAY_ID);
    expect(typeof alert["observed_at"]).toBe("number");

    // DETECTED AT SUBMISSION, NOT AT SEAL: the forged leaf took no position in the tree, so A's
    // next honest submit is still sequence 1.
    const honest = await makeLeaf(fx.sessionId, fx.kpA, fx.kpA);
    send(fx.a.stream, CBOR.encode({ type: "hash_submit", session_id: fx.sessionId, leaf_kind: 0x00, ...honest }));
    const ack = await fx.a.reader.next();
    expect(ack["type"]).toBe("hash_submit_ack");
    expect(ack["sequence_number"], "the refused leaf must not have consumed a position").toBe(1);

    // And the relay's own operator has the durable half — the log line stays, alongside the frame.
    const flagged = fx.events.filter((e) => e.event === "relay.witness.leaf_unwitnessed");
    expect(flagged.length).toBe(1);
    expect(flagged[0]!.level, "a leaf nobody in the session signed is not routine").toBe("error");
    expect(flagged[0]!.ctx["submitterIsParticipant"]).toBe(true);
  }, 60_000);

  it("★★ THE RELAY KEEPS RELAYING — a flagged session still carries traffic in both directions", async () => {
    /**
     * The decision recorded in `#flagUnwitnessedLeaf`, asserted rather than left to the reader.
     * If a flag tore the session down, anyone who can authenticate and name a session id could kill
     * any conversation with one frame — a false accusation with teeth.
     */
    const fx = await fixture();
    const forged = await makeLeaf(fx.sessionId, fx.kpA, generateKeypair());
    send(fx.a.stream, CBOR.encode({ type: "hash_submit", session_id: fx.sessionId, leaf_kind: 0x00, ...forged }));
    expect((await fx.a.reader.next())["reason"]).toBe("leaf_signed_by_neither_participant");
    expect((await fx.b!.reader.next())["type"]).toBe("session_witness_alert");

    // B sends an ordinary message afterwards. It is sequenced, and it is delivered to A.
    const fromB = await makeLeaf(fx.sessionId, fx.kpB, fx.kpB);
    send(fx.b!.stream, CBOR.encode({ type: "hash_submit", session_id: fx.sessionId, leaf_kind: 0x00, ...fromB }));
    expect((await fx.b!.reader.next())["type"], "the session is still active for B").toBe("hash_submit_ack");
    // B's own echo, then A's delivery of it — the session is still wired end to end.
    expect((await fx.b!.reader.next())["type"]).toBe("leaf_deliver");
    expect((await fx.a.reader.next())["type"], "A must still receive B's traffic on a flagged session").toBe("leaf_deliver");
  }, 60_000);

  it("★★ a STRANGER submitting into the session alerts BOTH participants, and neither is named as the sender", async () => {
    /**
     * The check runs ABOVE the participant gate on purpose. Running it only for participants would
     * make it optional for exactly the party it exists to catch, and `not_a_participant` alone tells
     * the two people whose conversation it is nothing at all.
     */
    const fx = await fixture();
    const strangerKp = generateKeypair();
    const stranger = await fx.connect(strangerKp);
    const forged = await makeLeaf(fx.sessionId, strangerKp, strangerKp);
    send(stranger.stream, CBOR.encode({ type: "hash_submit", session_id: fx.sessionId, leaf_kind: 0x00, ...forged }));

    expect((await stranger.reader.next())["reason"]).toBe("leaf_signed_by_neither_participant");
    for (const side of [fx.a, fx.b!]) {
      const alert = await side.reader.next();
      expect(alert["type"]).toBe("session_witness_alert");
      expect(
        alert["submitter_is_counterparty"],
        "it was NOT the counterparty, and saying otherwise accuses a party who did nothing",
      ).toBe(false);
    }
  }, 60_000);

  it("★★ an alert for an OFFLINE participant is HELD and delivered when they next authenticate", async () => {
    /**
     * Whoever submits a forged leaf also chooses WHEN. An alert that evaporated because the victim
     * happened to be away would be a guard the attacker can time away.
     */
    const fx = await fixture({ connectB: false });
    const forged = await makeLeaf(fx.sessionId, fx.kpA, generateKeypair());
    send(fx.a.stream, CBOR.encode({ type: "hash_submit", session_id: fx.sessionId, leaf_kind: 0x00, ...forged }));
    expect((await fx.a.reader.next())["reason"]).toBe("leaf_signed_by_neither_participant");

    const b = await fx.connect(fx.kpB);
    const alert = await b.reader.next();
    expect(alert["type"], "B was offline when it happened and must still be told").toBe("session_witness_alert");
    expect(alert["submitter_is_counterparty"]).toBe(true);
  }, 60_000);

  it("★★ A HEALTHY SESSION IS LEFT ALONE — no alert, no error event, on an ordinary exchange", async () => {
    /**
     * A check that can fire on a healthy session is a weapon rather than a safeguard. This is the
     * assertion that costs the most if it is ever wrong.
     */
    const fx = await fixture();
    const honest = await makeLeaf(fx.sessionId, fx.kpA, fx.kpA);
    send(fx.a.stream, CBOR.encode({ type: "hash_submit", session_id: fx.sessionId, leaf_kind: 0x00, ...honest }));
    expect((await fx.a.reader.next())["type"]).toBe("hash_submit_ack");

    const delivered = await fx.b!.reader.next();
    expect(delivered["type"], "B receives the leaf, not an alert about it").toBe("leaf_deliver");
    expect(
      await fx.b!.reader.nextOrSilence(1_000),
      "nothing else may follow an honest leaf",
    ).toBeUndefined();
    expect(
      fx.events.filter((e) => e.event === "relay.witness.leaf_unwitnessed"),
      "the witness must be silent on a session where both parties behaved",
    ).toEqual([]);
  }, 60_000);

  it("★★ THE ALERT CARRIES NO CONTENT — its fields are exactly the six declared, and none of them is a payload", async () => {
    /**
     * INV-3: the relay must not read content, and a new relay→client frame is where that guarantee
     * would leak out. A signature verifies against a hash and a pubkey; nothing on this path needs
     * plaintext and nothing on it may carry any.
     */
    const fx = await fixture();
    const forged = await makeLeaf(fx.sessionId, fx.kpA, generateKeypair());
    send(fx.a.stream, CBOR.encode({ type: "hash_submit", session_id: fx.sessionId, leaf_kind: 0x00, ...forged }));
    await fx.a.reader.next();

    const alert = await fx.b!.reader.next();
    expect(Object.keys(alert).sort()).toEqual(
      ["observed_at", "reason", "relay_id", "session_id", "submitter_is_counterparty", "type"],
    );
    const flagged = fx.events.find((e) => e.event === "relay.witness.leaf_unwitnessed")!;
    expect(
      Object.keys(flagged.ctx).sort(),
      "and the log line the same — a forensic record is still a place content can escape to",
    ).toEqual(["impact", "observation", "relayId", "sessionId", "submitterIsParticipant", "submitterPubkey"]);
  }, 60_000);

  it("★★ a leaf CLAIMING the counterparty as sender is refused even though its signature is a real participant's", async () => {
    /**
     * The check that replaced the old `verify(s1.sender_pubkey, …)` must be STRICTLY stronger, and
     * this is the case that separates them: bytes that verify under participant A while the leaf
     * names B as its author. Verifying against the two assignment keys alone would pass it; the
     * signer must also be the party the leaf claims and the party on the connection.
     */
    const fx = await fixture();
    const misattributed = await makeLeaf(fx.sessionId, fx.kpB, fx.kpA); // claims B, signed by A
    send(fx.a.stream, CBOR.encode({ type: "hash_submit", session_id: fx.sessionId, leaf_kind: 0x00, ...misattributed }));
    const err = await fx.a.reader.next();
    expect(err["type"]).toBe("hash_submit_error");
    expect(err["reason"]).toBe("sender_mismatch");
  }, 60_000);
});
