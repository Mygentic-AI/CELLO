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
import { generateKeypair, verify } from "@cello-protocol/crypto";
import { encodeCbor } from "@cello-protocol/protocol-types";
import { createNode } from "@cello-protocol/transport";
import type { Logger } from "@cello-protocol/interfaces";
import { createRelayNode, RELAY_PROTOCOL_ID } from "../relay-node.js";
import { seedChain, chainLinks, chainAdvance } from "./helpers/relay-submit-harness.js";
import { testOnlineToken } from "./helpers/online-token.js";

setupV3Tests();

const CBOR = new Encoder({ tagUint8Array: false });

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

/**
 * Structure 1 as the client builds it — the one layout, both chain links filled from the rig's
 * chain (`DOD-M15-SELFCHAIN-1`).
 *
 * ⚠️ `claimedSender` AND `signer` ARE DELIBERATELY SEPARATE, and the links follow the CLAIMED
 * sender. That is the whole subject of this file: a leaf that NAMES one participant and is signed
 * by someone else must reach the signature check and be refused there. Filling the links from the
 * signer instead would make the frame refuse earlier, for a different reason, and the test would
 * pass while proving nothing about authorship.
 */
async function makeLeaf(
  sessionId: Uint8Array,
  claimedSender: Keypair,
  signer: Keypair,
): Promise<{ structure1_cbor: Uint8Array; sender_signature: Uint8Array }> {
  const claimedPub = await claimedSender.getPublicKey();
  const contentHash = new Uint8Array(randomBytes(32));
  const { lastSeenHash, prevOwnHash } = chainLinks(sessionId, claimedPub, 0);
  const structure1_cbor = CBOR.encode([
    3, contentHash, claimedPub, sessionId, 0, Date.now(), lastSeenHash, prevOwnHash,
  ]) as Uint8Array;
  chainAdvance(sessionId, claimedPub, contentHash);
  return { structure1_cbor, sender_signature: await signer.sign(structure1_cbor) };
}

describe("DOD-M15-CORROBORATE-1: the relay verifies each hash at arrival and alerts the other side", () => {
  let scope = createTestScope();
  beforeEach(() => { scope = createTestScope(); });
  afterEach(() => scope.run(async () => {}));

  /** A relay with a real directory key, a real assignment, and A + B authenticated to it. */
  async function fixture(opts: { connectB?: boolean; unsignedWitness?: boolean } = {}) {
    const events: Captured[] = [];
    const dirKp = generateKeypair();
    /**
     * A SIGNING IDENTITY, because production has one — the relay signs every `hash_submit_ack` with
     * it and `relayId` is its public half in hex. Without it here the whole suite would exercise the
     * unsigned shape, which is the configuration no deployed relay runs. `unsignedWitness` opts back
     * out for the one test that is about a relay with no identity at all.
     */
    const relayAckKp = generateKeypair();
    const relayIdHex = Buffer.from(await relayAckKp.getPublicKey()).toString("hex");
    const { node: relayNode, relay, stop } = await createRelayNode({
      directoryPubkey: await dirKp.getPublicKey(),
      logger: capturingLogger(events),
      ...(opts.unsignedWitness === true ? {} : { relayId: relayIdHex, ackSigningKeyProvider: relayAckKp }),
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
    expect(seedChain(sessionId, pubA, pubB, ts);
relay.recordAssignment({
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
    return { events, dirKp, relay, relayNode, kpA, kpB, sessionId, a, b, connect, relayAckKp, relayIdHex };
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
    expect(alert["relay_id"], "one witness, and it must be nameable — 'a relay said so' is not a record").toBe(fx.relayIdHex);
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
      ["observed_at", "reason", "relay_id", "session_id", "submitter_is_counterparty", "type", "witness_signature"],
    );
    const flagged = fx.events.find((e) => e.event === "relay.witness.leaf_unwitnessed")!;
    expect(
      Object.keys(flagged.ctx).sort(),
      "and the log line the same — a forensic record is still a place content can escape to",
    ).toEqual(["impact", "observation", "relayId", "sessionId", "submitterIsParticipant", "submitterPubkey"]);
  }, 60_000);

  it("★★ a leaf a participant really signed FOR ANOTHER SESSION is refused — review F6", async () => {
    /**
     * The witness check cannot see this one, because everything it checks is true: a real
     * participant key signed these exact bytes. What is wrong is the scope. Structure 1 carries its
     * own session_id and nothing compared it to the frame's, so a participant in two conversations
     * could lift one of their own leaves out of the other and have it sequenced into this
     * transcript.
     */
    const fx = await fixture();
    const otherSession = new Uint8Array(randomBytes(16));
    const lifted = await makeLeaf(otherSession, fx.kpA, fx.kpA);
    send(fx.a.stream, CBOR.encode({ type: "hash_submit", session_id: fx.sessionId, leaf_kind: 0x00, ...lifted }));
    const err = await fx.a.reader.next();
    expect(err["type"]).toBe("hash_submit_error");
    expect(err["reason"], "the signature is real; the conversation it was made for is not this one").toBe("leaf_session_mismatch");
    expect(
      fx.events.filter((e) => e.event === "relay.witness.leaf_unwitnessed"),
      "and it is NOT a witness event — a participant's own signature is not a forgery",
    ).toEqual([]);

    // Nothing was sequenced: the next honest leaf is position 1.
    const honest = await makeLeaf(fx.sessionId, fx.kpA, fx.kpA);
    send(fx.a.stream, CBOR.encode({ type: "hash_submit", session_id: fx.sessionId, leaf_kind: 0x00, ...honest }));
    const ack = await fx.a.reader.next();
    expect(ack["sequence_number"]).toBe(1);
  }, 60_000);

  it("★★ a STRANGER REPLAYING a leaf a participant really signed is refused as not_a_participant — review F5", async () => {
    /**
     * The case the witness check deliberately lets through to the participant gate, and the one the
     * re-pointed AC-004 stopped covering. The leaf IS signed by A, so `leaf_signed_by_neither_participant`
     * would be a false statement; what is wrong is who is submitting it. Both refusals have to exist
     * and this is the input that separates them.
     */
    const fx = await fixture();
    const replayed = await makeLeaf(fx.sessionId, fx.kpA, fx.kpA); // genuinely A's
    const strangerKp = generateKeypair();
    const stranger = await fx.connect(strangerKp);
    send(stranger.stream, CBOR.encode({ type: "hash_submit", session_id: fx.sessionId, leaf_kind: 0x00, ...replayed }));
    const err = await stranger.reader.next();
    expect(err["reason"], "a real participant signed it — the fault is the connection it arrived on").toBe("not_a_participant");
    expect(
      fx.events.filter((e) => e.event === "relay.witness.leaf_unwitnessed"),
      "and no witness alert: nothing here was forged",
    ).toEqual([]);
    expect(
      await fx.b!.reader.nextOrSilence(1_000),
      "so the participants are not told a forgery happened when none did",
    ).toBeUndefined();
  }, 60_000);

  it("★★ a submit whose Structure 1 does not DECODE is answered submit_malformed, not signature_invalid — review F8", async () => {
    /**
     * Nothing has looked at a signature at this point. `signature_invalid` sent a client author with
     * a CBOR bug to audit a signing key that was fine — and hoisting the decode made that wrong word
     * the only one they would ever see.
     */
    const fx = await fixture();
    const undecodable = CBOR.encode([1, 2, 3]) as Uint8Array; // a 3-element array: not Structure 1
    send(fx.a.stream, CBOR.encode({
      type: "hash_submit", session_id: fx.sessionId, leaf_kind: 0x00,
      structure1_cbor: undecodable, sender_signature: await fx.kpA.sign(undecodable),
    }));
    const err = await fx.a.reader.next();
    expect(err["reason"]).toBe("submit_malformed");
  }, 60_000);

  it("★★★ THE ALERT IS SIGNED by the key `relay_id` names — review F3", async () => {
    /**
     * Without this the recipient can only pass the observation on as "the relay told me", which is
     * exactly as unverifiable as the accusation it is supposed to corroborate. The TBS is rebuilt
     * here from the wire fields rather than imported from the builder under test — an independent
     * reconstruction is what catches a drift; calling the same function would only prove it equals
     * itself.
     */
    const fx = await fixture();
    const forged = await makeLeaf(fx.sessionId, fx.kpA, generateKeypair());
    send(fx.a.stream, CBOR.encode({ type: "hash_submit", session_id: fx.sessionId, leaf_kind: 0x00, ...forged }));
    await fx.a.reader.next();

    const alert = await fx.b!.reader.next();
    const tbs = new Uint8Array(
      createHash("sha256")
        .update(encodeCbor([
          "CELLO-RELAY-WITNESS-v1",
          alert["session_id"] as Uint8Array,
          alert["reason"] as string,
          alert["observed_at"] as number,
          alert["submitter_is_counterparty"] as boolean,
        ]))
        .digest(),
    );
    expect(
      verify(await fx.relayAckKp.getPublicKey(), tbs, alert["witness_signature"] as Uint8Array),
      "the observation must be provable to someone who was not there",
    ).toBe(true);
    expect(
      alert["relay_id"],
      "and `relay_id` must BE that key, so a third party knows what to check it against",
    ).toBe(Buffer.from(await fx.relayAckKp.getPublicKey()).toString("hex"));

    // The signature must cover the CLAIM, not just the session: flipping the one field that says
    // who submitted it must break it.
    const flipped = new Uint8Array(
      createHash("sha256")
        .update(encodeCbor([
          "CELLO-RELAY-WITNESS-v1", alert["session_id"] as Uint8Array, alert["reason"] as string,
          alert["observed_at"] as number, !(alert["submitter_is_counterparty"] as boolean),
        ]))
        .digest(),
    );
    expect(
      verify(await fx.relayAckKp.getPublicKey(), flipped, alert["witness_signature"] as Uint8Array),
      "a signature that did not cover who submitted it would let the claim be rewritten under it",
    ).toBe(false);
  }, 60_000);

  it("★★★ a relay that CANNOT SIGN names no identity — the warning survives, the claim does not", async () => {
    /**
     * ⚠️ THE PAIR IS ALL-OR-NOTHING, AND THIS IS WHY. A client refuses an alert that declares a
     * `relay_id` and does not prove it — correctly. So a relay that names itself and then cannot
     * sign would have every alert it sends thrown away, and the recipient would be told their
     * witness layer was broken instead of what was actually observed. A transient signer failure
     * would silently convert a real observation into a version-skew report.
     *
     * Driven through a signer that throws, which is what a KMS blip looks like from here.
     */
    const events: Captured[] = [];
    const dirKp = generateKeypair();
    const brokenSigner = generateKeypair();
    const relayIdHex = Buffer.from(await brokenSigner.getPublicKey()).toString("hex");
    const { node: relayNode, relay, stop } = await createRelayNode({
      directoryPubkey: await dirKp.getPublicKey(),
      logger: capturingLogger(events),
      relayId: relayIdHex,
      ackSigningKeyProvider: {
        getPublicKey: () => brokenSigner.getPublicKey(),
        sign: async () => { throw new Error("signer unavailable"); },
      } as unknown as typeof brokenSigner,
    });
    scope.addCleanup(stop);

    const kpA = generateKeypair();
    const kpB = generateKeypair();
    const pubA = await kpA.getPublicKey();
    const pubB = await kpB.getPublicKey();
    const sessionId = new Uint8Array(randomBytes(16));
    const ts = Date.now();
    expect(seedChain(sessionId, pubA, pubB, ts);
relay.recordAssignment({
      session_id: sessionId, participant_a: pubA, participant_b: pubB, session_timestamp: ts,
      directory_signature: await dirKp.sign(CBOR.encode([sessionId, pubA, pubB, ts > 0xffffffff ? BigInt(ts) : ts]) as Uint8Array),
    }).ok).toBe(true);

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
        type: "relay_auth_response", pubkey,
        signature: await kp.sign(new Uint8Array(createHash("sha256").update(authMsg).digest())),
        online_token: await testOnlineToken(dirKp, kp),
      }));
      expect((await reader.next())["type"]).toBe("relay_auth_ok");
      return { stream, reader };
    };
    const a = await connect(kpA);
    const b = await connect(kpB);

    const forged = await makeLeaf(sessionId, kpA, generateKeypair());
    send(a.stream, CBOR.encode({ type: "hash_submit", session_id: sessionId, leaf_kind: 0x00, ...forged }));
    await a.reader.next();

    const alert = await b.reader.next();
    expect(alert["type"], "the warning must still arrive — losing it is worse than losing its proof").toBe("session_witness_alert");
    expect(alert["witness_signature"]).toBeUndefined();
    expect(
      alert["relay_id"],
      "and NO identity is claimed, or the client refuses this and the operator hears nothing",
    ).toBeUndefined();
    expect(events.filter((e) => e.event === "relay.witness.sign.failed").length).toBe(1);
  }, 60_000);

  it("★★ a relay with NO signing identity sends the alert anyway, unsigned and unnamed", async () => {
    /**
     * Losing the warning is strictly worse than losing its transferability, so a relay running
     * without an identity still speaks — and says nothing it cannot back, which is why `relay_id`
     * is absent rather than a placeholder.
     */
    const fx = await fixture({ unsignedWitness: true });
    const forged = await makeLeaf(fx.sessionId, fx.kpA, generateKeypair());
    send(fx.a.stream, CBOR.encode({ type: "hash_submit", session_id: fx.sessionId, leaf_kind: 0x00, ...forged }));
    await fx.a.reader.next();
    const alert = await fx.b!.reader.next();
    expect(alert["type"]).toBe("session_witness_alert");
    expect(alert["relay_id"]).toBeUndefined();
    expect(alert["witness_signature"]).toBeUndefined();
  }, 60_000);

  it("★★ a leaf whose CLAIMED sender is not the party who signed it is refused, on that party's own connection", async () => {
    /**
     * ⚠️ THE EXEMPLAR HERE IS CHOSEN FROM THE PREDICATE, NOT FROM INTENT, AND THE FIRST ONE WAS NOT.
     *
     * The obvious case — a leaf naming B, signed by A, sent on A's connection — is refused by the
     * OLD pair of checks too (claimed sender ≠ authenticated connection), so asserting it proves
     * only that something refused, not which. It survived the mutation that chains both claims
     * through the frame's own `sender_pubkey`.
     *
     * The case that separates them is this one: the leaf names B, arrives on B's own authenticated
     * connection, and is signed by A. `claimed === authenticated` holds, so the old pair lets it
     * through and B gets a leaf attributed to B that A signed. Comparing both against the key the
     * signature actually verified under is what refuses it.
     *
     * (Not reachable while A is honest — A never signs bytes naming B — which is exactly why it
     * needs a test rather than an argument.)
     */
    const fx = await fixture();
    const misattributed = await makeLeaf(fx.sessionId, fx.kpB, fx.kpA); // claims B, signed by A
    send(fx.b!.stream, CBOR.encode({ type: "hash_submit", session_id: fx.sessionId, leaf_kind: 0x00, ...misattributed }));
    const err = await fx.b!.reader.next();
    expect(err["type"], "accepting this would sequence a leaf attributed to B that A signed").toBe("hash_submit_error");
    expect(err["reason"]).toBe("sender_mismatch");

    // And it took no position: B's next honest leaf is sequence 1.
    const honest = await makeLeaf(fx.sessionId, fx.kpB, fx.kpB);
    send(fx.b!.stream, CBOR.encode({ type: "hash_submit", session_id: fx.sessionId, leaf_kind: 0x00, ...honest }));
    const ack = await fx.b!.reader.next();
    expect(ack["type"]).toBe("hash_submit_ack");
    expect(ack["sequence_number"]).toBe(1);
  }, 60_000);
});
