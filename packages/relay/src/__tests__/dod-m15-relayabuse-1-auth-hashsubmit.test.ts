/**
 * DOD-M15-RELAYABUSE-1 — rate limiting on authentication and hash_submit.
 *
 * The audit's first finding, "no rate limiting of any kind — not on authentication attempts, not on
 * hash submission", had two of five paths already closed this milestone (content-park deposit,
 * liveness query — see `dod-m15-deposit-rate-limit.test.ts` and the liveness handler itself). This
 * closes the two live remaining paths: authentication and hash_submit. (Gap-fill, the fifth, has no
 * wire handler left to limit — its frame type was deleted in `DOD-M15-SEALWIRE-1` bullet 7.)
 *
 * `DepositRateLimiter`'s own correctness (window reset, per-key isolation, memory bound, absent-key
 * leniency) is already covered by `dod-m15-deposit-rate-limit.test.ts` — reused here, not retested.
 * These tests prove the WIRING: the relay's real auth and hash_submit handlers actually consult a
 * limiter over the wire, refuse with a named cause, and tell the caller when to retry.
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
import { randomBytes, createHash } from "node:crypto";
import { Encoder, decode } from "cbor-x";
import * as lp from "it-length-prefixed";
import { generateKeypair } from "@cello-protocol/crypto";
import { createNode } from "@cello-protocol/transport";
import type { Stream } from "@libp2p/interface";
import { createRelayNode, RELAY_PROTOCOL_ID } from "../relay-node.js";

setupV3Tests();

const CBOR_ENC = new Encoder({ tagUint8Array: false });
const AUTH_DOMAIN = "CELLO-RELAY-AUTH-v1";

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
    return decode(await this.readFrame()) as Record<string, unknown>;
  }
}

function sendFrame(stream: Stream, data: Uint8Array): void {
  stream.send(lp.encode.single(data));
}

/** One raw auth attempt: open a stream, respond to the challenge, return the relay's verdict frame. */
async function attemptAuth(
  node: Awaited<ReturnType<typeof createNode>>,
  relayPeerId: string,
  kp: ReturnType<typeof generateKeypair>,
): Promise<Record<string, unknown>> {
  const stream = await node.newStream(relayPeerId, RELAY_PROTOCOL_ID);
  const reader = new StreamReader(stream);
  const challenge = await reader.readDecoded();
  if (challenge["type"] !== "relay_auth_challenge") return challenge; // rate_limited can also land here in theory
  const nonce = challenge["nonce"] as Uint8Array;
  const pubkey = await kp.getPublicKey();
  const domain = Buffer.from(AUTH_DOMAIN, "utf8");
  const authMsg = new Uint8Array(Buffer.concat([domain, nonce, pubkey]));
  const msgHash = new Uint8Array(createHash("sha256").update(authMsg).digest());
  const signature = await kp.sign(msgHash);
  sendFrame(stream, CBOR_ENC.encode({ type: "relay_auth_response", pubkey, signature }));
  const verdict = await reader.readDecoded();
  stream.close().catch(() => {});
  return verdict;
}

async function authedStream(
  node: Awaited<ReturnType<typeof createNode>>,
  relayPeerId: string,
  kp: ReturnType<typeof generateKeypair>,
): Promise<{ stream: Stream; reader: StreamReader }> {
  const stream = await node.newStream(relayPeerId, RELAY_PROTOCOL_ID);
  const reader = new StreamReader(stream);
  const challenge = await reader.readDecoded();
  expect(challenge["type"]).toBe("relay_auth_challenge");
  const nonce = challenge["nonce"] as Uint8Array;
  const pubkey = await kp.getPublicKey();
  const domain = Buffer.from(AUTH_DOMAIN, "utf8");
  const authMsg = new Uint8Array(Buffer.concat([domain, nonce, pubkey]));
  const msgHash = new Uint8Array(createHash("sha256").update(authMsg).digest());
  const signature = await kp.sign(msgHash);
  sendFrame(stream, CBOR_ENC.encode({ type: "relay_auth_response", pubkey, signature }));
  const ack = await reader.readDecoded();
  expect(ack["type"]).toBe("relay_auth_ok");
  return { stream, reader };
}

async function makeStructure1(
  sessionId: Uint8Array,
  contentHash: Uint8Array,
  kp: ReturnType<typeof generateKeypair>,
  lastSeenSeq: number,
): Promise<{ structure1_cbor: Uint8Array; sender_signature: Uint8Array }> {
  const pubkey = await kp.getPublicKey();
  const ts = Date.now();
  const tbs = CBOR_ENC.encode([1, contentHash, pubkey, sessionId, lastSeenSeq, ts]) as Uint8Array;
  const sender_signature = await kp.sign(tbs);
  return { structure1_cbor: tbs, sender_signature };
}

describe("DOD-M15-RELAYABUSE-1 — relay authentication is rate limited, per peer AND per claimed pubkey", () => {
  let scope = createTestScope();
  beforeEach(() => { scope = createTestScope(); });
  afterEach(() => scope.run(async () => {}));

  it("the (N+1)th auth attempt from ONE peer is refused with a NAMED cause and a retry time", async () => {
    const dirKp = generateKeypair();
    const { node: relayNode, stop } = await createRelayNode({
      directoryPubkey: await dirKp.getPublicKey(),
      authRateLimit: { maxPerWindow: 2, windowMs: 60_000 },
    });
    scope.addCleanup(stop);
    const relayPeerId = relayNode.getPeerId();
    const relayAddr = relayNode.listenAddresses()[0]!;

    const clientNode = await createNode({ keyProvider: generateKeypair(), listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await clientNode.start();
    scope.addCleanup(async () => { await clientNode.stop(); });
    await clientNode.dial(relayAddr);

    // Three attempts, three DIFFERENT claimed keys — so this exercises the PEER-keyed limit, not
    // the pubkey-keyed one (each key is authentic, so each attempt succeeds cryptographically).
    const v1 = await attemptAuth(clientNode, relayPeerId, generateKeypair());
    expect(v1["type"]).toBe("relay_auth_ok");
    const v2 = await attemptAuth(clientNode, relayPeerId, generateKeypair());
    expect(v2["type"]).toBe("relay_auth_ok");

    const v3 = await attemptAuth(clientNode, relayPeerId, generateKeypair());
    expect(v3["type"]).toBe("relay_auth_failed");
    expect(v3["reason"]).toBe("rate_limited");
    expect(v3["retry_after_ms"], "the relay must say WHEN, not just no").toBeGreaterThan(0);
  }, 20_000);

  it("repeated attempts CLAIMING the same pubkey (from different peers) are ALSO refused", async () => {
    const dirKp = generateKeypair();
    const { node: relayNode, stop } = await createRelayNode({
      directoryPubkey: await dirKp.getPublicKey(),
      authRateLimit: { maxPerWindow: 1, windowMs: 60_000 },
    });
    scope.addCleanup(stop);
    const relayPeerId = relayNode.getPeerId();
    const relayAddr = relayNode.listenAddresses()[0]!;
    const targetKp = generateKeypair();

    const nodeA = await createNode({ keyProvider: generateKeypair(), listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await nodeA.start();
    scope.addCleanup(async () => { await nodeA.stop(); });
    await nodeA.dial(relayAddr);
    const nodeB = await createNode({ keyProvider: generateKeypair(), listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await nodeB.start();
    scope.addCleanup(async () => { await nodeB.stop(); });
    await nodeB.dial(relayAddr);

    const v1 = await attemptAuth(nodeA, relayPeerId, targetKp);
    expect(v1["type"]).toBe("relay_auth_ok");

    // Different TRANSPORT PEER (nodeB), same CLAIMED identity (targetKp) — the pubkey-keyed limit
    // must catch this even though the peer-keyed one would not (nodeB has never authed before).
    const v2 = await attemptAuth(nodeB, relayPeerId, targetKp);
    expect(v2["type"]).toBe("relay_auth_failed");
    expect(v2["reason"]).toBe("rate_limited");
  }, 20_000);

  it("a DIFFERENT peer AND pubkey is unaffected by another's flood", async () => {
    const dirKp = generateKeypair();
    const { node: relayNode, stop } = await createRelayNode({
      directoryPubkey: await dirKp.getPublicKey(),
      authRateLimit: { maxPerWindow: 1, windowMs: 60_000 },
    });
    scope.addCleanup(stop);
    const relayPeerId = relayNode.getPeerId();
    const relayAddr = relayNode.listenAddresses()[0]!;

    const floodNode = await createNode({ keyProvider: generateKeypair(), listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await floodNode.start();
    scope.addCleanup(async () => { await floodNode.stop(); });
    await floodNode.dial(relayAddr);
    await attemptAuth(floodNode, relayPeerId, generateKeypair());
    const floodedOut = await attemptAuth(floodNode, relayPeerId, generateKeypair());
    expect(floodedOut["type"]).toBe("relay_auth_failed");

    const honestNode = await createNode({ keyProvider: generateKeypair(), listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await honestNode.start();
    scope.addCleanup(async () => { await honestNode.stop(); });
    await honestNode.dial(relayAddr);
    const honestResult = await attemptAuth(honestNode, relayPeerId, generateKeypair());
    expect(honestResult["type"], "one peer's flood must never lock out another").toBe("relay_auth_ok");
  }, 20_000);
});

describe("DOD-M15-RELAYABUSE-1 — hash_submit is rate limited, per peer AND per authenticated pubkey", () => {
  let scope = createTestScope();
  beforeEach(() => { scope = createTestScope(); });
  afterEach(() => scope.run(async () => {}));

  it("the (N+1)th hash_submit from one authenticated sender is refused with a NAMED cause and a retry time", async () => {
    const dirKp = generateKeypair();
    const { relay, node: relayNode, stop } = await createRelayNode({
      directoryPubkey: await dirKp.getPublicKey(),
      hashSubmitRateLimit: { maxPerWindow: 2, windowMs: 60_000 },
    });
    scope.addCleanup(stop);
    const relayPeerId = relayNode.getPeerId();
    const relayAddr = relayNode.listenAddresses()[0]!;

    const clientKp = generateKeypair();
    const otherKp = generateKeypair();
    const pubkey = await clientKp.getPublicKey();
    const otherPubkey = await otherKp.getPublicKey();
    const sessionId = new Uint8Array(randomBytes(16));
    const sessionTimestamp = Date.now();
    const tbs = CBOR_ENC.encode([
      sessionId, pubkey, otherPubkey,
      sessionTimestamp > 0xffffffff ? BigInt(sessionTimestamp) : sessionTimestamp,
    ]) as Uint8Array;
    const directory_signature = await dirKp.sign(tbs);
    relay.recordAssignment({ session_id: sessionId, participant_a: pubkey, participant_b: otherPubkey, session_timestamp: sessionTimestamp, directory_signature });

    const clientNode = await createNode({ keyProvider: clientKp, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await clientNode.start();
    scope.addCleanup(async () => { await clientNode.stop(); });
    await clientNode.dial(relayAddr);
    const { stream, reader } = await authedStream(clientNode, relayPeerId, clientKp);

    for (let i = 0; i < 2; i++) {
      const contentHash = new Uint8Array(randomBytes(32));
      const { structure1_cbor, sender_signature } = await makeStructure1(sessionId, contentHash, clientKp, i);
      sendFrame(stream, CBOR_ENC.encode({ type: "hash_submit", session_id: sessionId, leaf_kind: 0x00, structure1_cbor, sender_signature }));
      const ack = await reader.readDecoded();
      expect(ack["type"], `submit ${String(i)} must succeed — under the limit`).toBe("hash_submit_ack");
      // MSG-004: the relay echoes leaf_deliver back to the sender on the same stream — drain it
      // before the next submit or it is mistaken for that submit's ack.
      expect((await reader.readDecoded())["type"]).toBe("leaf_deliver");
    }

    const contentHash = new Uint8Array(randomBytes(32));
    const { structure1_cbor, sender_signature } = await makeStructure1(sessionId, contentHash, clientKp, 2);
    sendFrame(stream, CBOR_ENC.encode({ type: "hash_submit", session_id: sessionId, leaf_kind: 0x00, structure1_cbor, sender_signature }));
    const refused = await reader.readDecoded();
    expect(refused["type"]).toBe("hash_submit_error");
    expect(refused["reason"]).toBe("rate_limited");
    expect(refused["retry_after_ms"], "the relay must say WHEN, not just no").toBeGreaterThan(0);
  }, 20_000);

  it("one session's flood does not refuse a DIFFERENT authenticated sender's submit", async () => {
    const dirKp = generateKeypair();
    const { relay, node: relayNode, stop } = await createRelayNode({
      directoryPubkey: await dirKp.getPublicKey(),
      hashSubmitRateLimit: { maxPerWindow: 1, windowMs: 60_000 },
    });
    scope.addCleanup(stop);
    const relayPeerId = relayNode.getPeerId();
    const relayAddr = relayNode.listenAddresses()[0]!;

    // Session 1: A <-> B, A floods.
    const kpA = generateKeypair();
    const kpB = generateKeypair();
    const pubA = await kpA.getPublicKey();
    const pubB = await kpB.getPublicKey();
    const sessionId1 = new Uint8Array(randomBytes(16));
    const ts1 = Date.now();
    // Date.now() in ms always exceeds 0xffffffff today — recordAssignment's own TBS encodes it as a
    // BigInt in that case (relay-node.ts), so the signature TBS here must match or verification
    // fails and the session is never recorded (the exemplar-value trap this milestone names).
    const tbs1 = CBOR_ENC.encode([sessionId1, pubA, pubB, ts1 > 0xffffffff ? BigInt(ts1) : ts1]) as Uint8Array;
    relay.recordAssignment({ session_id: sessionId1, participant_a: pubA, participant_b: pubB, session_timestamp: ts1, directory_signature: await dirKp.sign(tbs1) });

    const nodeA = await createNode({ keyProvider: kpA, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await nodeA.start();
    scope.addCleanup(async () => { await nodeA.stop(); });
    await nodeA.dial(relayAddr);
    const { stream: streamA, reader: readerA } = await authedStream(nodeA, relayPeerId, kpA);

    const { structure1_cbor: s1a, sender_signature: sig1a } = await makeStructure1(sessionId1, new Uint8Array(randomBytes(32)), kpA, 0);
    sendFrame(streamA, CBOR_ENC.encode({ type: "hash_submit", session_id: sessionId1, leaf_kind: 0x00, structure1_cbor: s1a, sender_signature: sig1a }));
    expect((await readerA.readDecoded())["type"]).toBe("hash_submit_ack");
    expect((await readerA.readDecoded())["type"], "MSG-004 echo").toBe("leaf_deliver"); // drain the sender-echo before the next submit
    const { structure1_cbor: s2a, sender_signature: sig2a } = await makeStructure1(sessionId1, new Uint8Array(randomBytes(32)), kpA, 1);
    sendFrame(streamA, CBOR_ENC.encode({ type: "hash_submit", session_id: sessionId1, leaf_kind: 0x00, structure1_cbor: s2a, sender_signature: sig2a }));
    expect((await readerA.readDecoded())["reason"]).toBe("rate_limited");

    // Session 2: C <-> D — entirely different peer AND pubkey, must be unaffected.
    const kpC = generateKeypair();
    const kpD = generateKeypair();
    const pubC = await kpC.getPublicKey();
    const pubD = await kpD.getPublicKey();
    const sessionId2 = new Uint8Array(randomBytes(16));
    const ts2 = Date.now();
    const tbs2 = CBOR_ENC.encode([sessionId2, pubC, pubD, ts2 > 0xffffffff ? BigInt(ts2) : ts2]) as Uint8Array;
    relay.recordAssignment({ session_id: sessionId2, participant_a: pubC, participant_b: pubD, session_timestamp: ts2, directory_signature: await dirKp.sign(tbs2) });

    const nodeC = await createNode({ keyProvider: kpC, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await nodeC.start();
    scope.addCleanup(async () => { await nodeC.stop(); });
    await nodeC.dial(relayAddr);
    const { stream: streamC, reader: readerC } = await authedStream(nodeC, relayPeerId, kpC);
    const { structure1_cbor: s1c, sender_signature: sig1c } = await makeStructure1(sessionId2, new Uint8Array(randomBytes(32)), kpC, 0);
    sendFrame(streamC, CBOR_ENC.encode({ type: "hash_submit", session_id: sessionId2, leaf_kind: 0x00, structure1_cbor: s1c, sender_signature: sig1c }));
    expect((await readerC.readDecoded())["type"], "one sender's flood must never refuse another's submit").toBe("hash_submit_ack");
  }, 20_000);
});
