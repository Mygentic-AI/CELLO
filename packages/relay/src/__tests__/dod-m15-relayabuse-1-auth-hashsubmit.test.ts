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
import { seedChain, chainLinks, chainAdvance } from "./helpers/relay-submit-harness.js";
import { testOnlineToken } from "./helpers/online-token.js";

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
  // DOD-M15-RELAYSLOTS-1: the relay refuses an auth with no directory-issued token, so these tests
  // mint a real one — otherwise every assertion below would pass for the wrong reason (a token
  // refusal, not the rate limit they are written about).
  dirKp: ReturnType<typeof generateKeypair>,
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
  sendFrame(stream, CBOR_ENC.encode({
    type: "relay_auth_response",
    pubkey,
    signature,
    online_token: await testOnlineToken(dirKp, kp),
  }));
  const verdict = await reader.readDecoded();
  stream.close().catch(() => {});
  return verdict;
}

async function authedStream(
  node: Awaited<ReturnType<typeof createNode>>,
  relayPeerId: string,
  kp: ReturnType<typeof generateKeypair>,
  dirKp: ReturnType<typeof generateKeypair>,
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
  sendFrame(stream, CBOR_ENC.encode({
    type: "relay_auth_response",
    pubkey,
    signature,
    online_token: await testOnlineToken(dirKp, kp),
  }));
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
  const { lastSeenHash, prevOwnHash } = chainLinks(sessionId, pubkey, lastSeenSeq);
  const tbs = CBOR_ENC.encode([3, contentHash, pubkey, sessionId, lastSeenSeq, ts, lastSeenHash, prevOwnHash]) as Uint8Array;
  chainAdvance(sessionId, pubkey, contentHash);
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
    const v1 = await attemptAuth(clientNode, relayPeerId, generateKeypair(), dirKp);
    expect(v1["type"]).toBe("relay_auth_ok");
    const v2 = await attemptAuth(clientNode, relayPeerId, generateKeypair(), dirKp);
    expect(v2["type"]).toBe("relay_auth_ok");

    const v3 = await attemptAuth(clientNode, relayPeerId, generateKeypair(), dirKp);
    expect(v3["type"]).toBe("relay_auth_failed");
    expect(v3["reason"]).toBe("rate_limited");
    expect(v3["retry_after_ms"], "the relay must say WHEN, not just no").toBeGreaterThan(0);
  }, 20_000);

  it("★★★ review F4: opening streams and NEVER replying is limited — the cost is in the open", async () => {
    /**
     * The limit used to be consulted inside the branch that handles the auth RESPONSE, so everything
     * before that ran unmetered: each new stream swept the nonce map, minted a nonce, stored it for
     * thirty seconds and sent a challenge. A caller who opened streams and simply never answered
     * paid nothing, was never limited, and made every subsequent open more expensive — superlinear
     * work chosen entirely by the attacker.
     *
     * The three tests above cannot see this: all of them complete the handshake, so they exercise a
     * path where both the old and new placements behave identically. This one never sends a response
     * at all, which is the whole point.
     */
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

    /** Open a stream, read the relay's FIRST frame, and walk away without answering. */
    async function openAndAbandon(): Promise<Record<string, unknown>> {
      const stream = await clientNode.newStream(relayPeerId, RELAY_PROTOCOL_ID);
      const first = await new StreamReader(stream).readDecoded();
      stream.close().catch(() => {});
      return first;
    }

    expect((await openAndAbandon())["type"], "the first open is under the limit").toBe("relay_auth_challenge");
    expect((await openAndAbandon())["type"], "the second open is under the limit").toBe("relay_auth_challenge");

    const third = await openAndAbandon();
    expect(
      third["type"],
      "the third open must be REFUSED, not challenged. If a challenge comes back here, the limit is " +
        "still sitting behind the nonce mint and a caller can make the relay do unbounded — and " +
        "increasingly expensive — work without ever proving anything.",
    ).toBe("relay_auth_failed");
    expect(third["reason"]).toBe("rate_limited");
    expect(third["retry_after_ms"], "a refusal must say when, not just no").toBeGreaterThan(0);
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

    const v1 = await attemptAuth(nodeA, relayPeerId, targetKp, dirKp);
    expect(v1["type"]).toBe("relay_auth_ok");

    // Different TRANSPORT PEER (nodeB), same CLAIMED identity (targetKp) — the pubkey-keyed limit
    // must catch this even though the peer-keyed one would not (nodeB has never authed before).
    const v2 = await attemptAuth(nodeB, relayPeerId, targetKp, dirKp);
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
    await attemptAuth(floodNode, relayPeerId, generateKeypair(), dirKp);
    const floodedOut = await attemptAuth(floodNode, relayPeerId, generateKeypair(), dirKp);
    expect(floodedOut["type"]).toBe("relay_auth_failed");

    const honestNode = await createNode({ keyProvider: generateKeypair(), listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await honestNode.start();
    scope.addCleanup(async () => { await honestNode.stop(); });
    await honestNode.dial(relayAddr);
    const honestResult = await attemptAuth(honestNode, relayPeerId, generateKeypair(), dirKp);
    expect(honestResult["type"], "one peer's flood must never lock out another").toBe("relay_auth_ok");
  }, 20_000);

  it("REGRESSION: a forged attempt CLAIMING a victim's real pubkey (wrong signature) does NOT spend the victim's bucket", async () => {
    /**
     * The exact shape a review pass caught: the pubkey-keyed limiter must key on a VERIFIED pubkey,
     * never a merely-claimed one. Anyone who knows an agent's public key (which CELLO agents hand
     * out freely so others can connect) could otherwise open many streams, claim that pubkey with a
     * garbage signature, exhaust the victim's bucket, and lock the real key-holder out with
     * `rate_limited` — at zero cost and with no proof of key possession required.
     */
    const dirKp = generateKeypair();
    const { node: relayNode, stop } = await createRelayNode({
      directoryPubkey: await dirKp.getPublicKey(),
      authRateLimit: { maxPerWindow: 1, windowMs: 60_000 },
    });
    scope.addCleanup(stop);
    const relayPeerId = relayNode.getPeerId();
    const relayAddr = relayNode.listenAddresses()[0]!;
    const victimKp = generateKeypair();
    const victimPubkey = await victimKp.getPublicKey();

    // The forger opens many DIFFERENT connections (so the PEER-keyed limit never trips) and claims
    // the victim's real pubkey with a signature that does not verify against it.
    for (let i = 0; i < 3; i++) {
      const forgerNode = await createNode({ keyProvider: generateKeypair(), listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
      await forgerNode.start();
      scope.addCleanup(async () => { await forgerNode.stop(); });
      await forgerNode.dial(relayAddr);
      const stream = await forgerNode.newStream(relayPeerId, RELAY_PROTOCOL_ID);
      const reader = new StreamReader(stream);
      await reader.readDecoded(); // relay_auth_challenge
      sendFrame(stream, CBOR_ENC.encode({
        type: "relay_auth_response",
        pubkey: victimPubkey, // claims the VICTIM's real key
        signature: new Uint8Array(randomBytes(64)), // but never proves it — garbage signature
      }));
      const verdict = await reader.readDecoded();
      expect(verdict["type"], "a forged claim must fail on signature, never on rate — it never got that far legitimately").toBe("relay_auth_failed");
      expect(verdict["reason"]).toBe("signature_invalid");
      stream.close().catch(() => {});
    }

    // The REAL key-holder must still be able to authenticate — the forger's attempts must not have
    // spent a bucket keyed on the victim's pubkey, because none of them ever verified.
    const victimNode = await createNode({ keyProvider: victimKp, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await victimNode.start();
    scope.addCleanup(async () => { await victimNode.stop(); });
    await victimNode.dial(relayAddr);
    const victimResult = await attemptAuth(victimNode, relayPeerId, victimKp, dirKp);
    expect(victimResult["type"], "the real key-holder must not be locked out by a forger who never proved anything").toBe("relay_auth_ok");
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
    seedChain(sessionId, pubkey, otherPubkey, sessionTimestamp);
    relay.recordAssignment({ session_id: sessionId, participant_a: pubkey, participant_b: otherPubkey, session_timestamp: sessionTimestamp, directory_signature });

    const clientNode = await createNode({ keyProvider: clientKp, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await clientNode.start();
    scope.addCleanup(async () => { await clientNode.stop(); });
    await clientNode.dial(relayAddr);
    const { stream, reader } = await authedStream(clientNode, relayPeerId, clientKp, dirKp);

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
    seedChain(sessionId1, pubA, pubB, ts1);
    relay.recordAssignment({ session_id: sessionId1, participant_a: pubA, participant_b: pubB, session_timestamp: ts1, directory_signature: await dirKp.sign(tbs1) });

    const nodeA = await createNode({ keyProvider: kpA, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await nodeA.start();
    scope.addCleanup(async () => { await nodeA.stop(); });
    await nodeA.dial(relayAddr);
    const { stream: streamA, reader: readerA } = await authedStream(nodeA, relayPeerId, kpA, dirKp);

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
    seedChain(sessionId2, pubC, pubD, ts2);
    relay.recordAssignment({ session_id: sessionId2, participant_a: pubC, participant_b: pubD, session_timestamp: ts2, directory_signature: await dirKp.sign(tbs2) });

    const nodeC = await createNode({ keyProvider: kpC, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await nodeC.start();
    scope.addCleanup(async () => { await nodeC.stop(); });
    await nodeC.dial(relayAddr);
    const { stream: streamC, reader: readerC } = await authedStream(nodeC, relayPeerId, kpC, dirKp);
    const { structure1_cbor: s1c, sender_signature: sig1c } = await makeStructure1(sessionId2, new Uint8Array(randomBytes(32)), kpC, 0);
    sendFrame(streamC, CBOR_ENC.encode({ type: "hash_submit", session_id: sessionId2, leaf_kind: 0x00, structure1_cbor: s1c, sender_signature: sig1c }));
    expect((await readerC.readDecoded())["type"], "one sender's flood must never refuse another's submit").toBe("hash_submit_ack");
  }, 20_000);

  /**
   * ★★★ Review: THE TWO TESTS ABOVE ARE HOLLOW, and these two exist to close that.
   *
   * The DoD clause says hash_submit is limited per peer AND per authenticated pubkey. Both tests
   * above use one client, which is one transport peer holding one pubkey — so both limiters trip
   * together on the same submit, and **deleting EITHER limiter leaves both of them green.** A
   * single-axis implementation passes a clause that asks for two.
   *
   * Separating them needs the axes pulled apart: two pubkeys sharing one transport peer isolates the
   * peer limiter, and one pubkey spread across two transport peers isolates the pubkey limiter.
   */
  it("★★★ TWO pubkeys over ONE transport peer: the PEER limit refuses the second — isolates the peer axis", async () => {
    const dirKp = generateKeypair();
    const { relay, node: relayNode, stop } = await createRelayNode({
      directoryPubkey: await dirKp.getPublicKey(),
      hashSubmitRateLimit: { maxPerWindow: 1, windowMs: 60_000 },
    });
    scope.addCleanup(stop);
    const relayPeerId = relayNode.getPeerId();
    const relayAddr = relayNode.listenAddresses()[0]!;

    // Two SEPARATE sessions, two SEPARATE identities — so the pubkey-keyed bucket for the second
    // sender is completely untouched when it submits. Only the shared transport peer can refuse it.
    const kp1 = generateKeypair();
    const kp2 = generateKeypair();
    const pub1 = await kp1.getPublicKey();
    const pub2 = await kp2.getPublicKey();
    const sessions: Uint8Array[] = [];
    for (const pub of [pub1, pub2]) {
      const sid = new Uint8Array(randomBytes(16));
      const other = await generateKeypair().getPublicKey();
      const ts = Date.now();
      const tbs = CBOR_ENC.encode([sid, pub, other, ts > 0xffffffff ? BigInt(ts) : ts]) as Uint8Array;
      seedChain(sid, pub, other, ts);
      relay.recordAssignment({ session_id: sid, participant_a: pub, participant_b: other, session_timestamp: ts, directory_signature: await dirKp.sign(tbs) });
      sessions.push(sid);
    }

    // ONE transport node — so both authenticated streams share a single remotePeerId.
    const node = await createNode({ keyProvider: generateKeypair(), listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await node.start();
    scope.addCleanup(async () => { await node.stop(); });
    await node.dial(relayAddr);

    const a = await authedStream(node, relayPeerId, kp1, dirKp);
    const { structure1_cbor: s1, sender_signature: sig1 } = await makeStructure1(sessions[0]!, new Uint8Array(randomBytes(32)), kp1, 0);
    sendFrame(a.stream, CBOR_ENC.encode({ type: "hash_submit", session_id: sessions[0]!, leaf_kind: 0x00, structure1_cbor: s1, sender_signature: sig1 }));
    expect((await a.reader.readDecoded())["type"], "the first submit is under the limit").toBe("hash_submit_ack");

    const b = await authedStream(node, relayPeerId, kp2, dirKp);
    const { structure1_cbor: s2, sender_signature: sig2 } = await makeStructure1(sessions[1]!, new Uint8Array(randomBytes(32)), kp2, 0);
    sendFrame(b.stream, CBOR_ENC.encode({ type: "hash_submit", session_id: sessions[1]!, leaf_kind: 0x00, structure1_cbor: s2, sender_signature: sig2 }));
    const verdict = await b.reader.readDecoded();
    expect(
      verdict["reason"],
      "a DIFFERENT pubkey on the SAME transport peer must still be refused. Its own pubkey bucket is " +
        "untouched, so only the per-peer limit can refuse it — if this passes, that limiter is gone " +
        "and one machine can flood the relay simply by rotating keys.",
    ).toBe("rate_limited");
  }, 20_000);

  it("★★★ ONE pubkey over TWO transport peers: the PUBKEY limit refuses the second — isolates the pubkey axis", async () => {
    const dirKp = generateKeypair();
    const { relay, node: relayNode, stop } = await createRelayNode({
      directoryPubkey: await dirKp.getPublicKey(),
      hashSubmitRateLimit: { maxPerWindow: 1, windowMs: 60_000 },
    });
    scope.addCleanup(stop);
    const relayPeerId = relayNode.getPeerId();
    const relayAddr = relayNode.listenAddresses()[0]!;

    const senderKp = generateKeypair();
    const senderPub = await senderKp.getPublicKey();
    const otherPub = await generateKeypair().getPublicKey();
    const sessionId = new Uint8Array(randomBytes(16));
    const ts = Date.now();
    const tbs = CBOR_ENC.encode([sessionId, senderPub, otherPub, ts > 0xffffffff ? BigInt(ts) : ts]) as Uint8Array;
    seedChain(sessionId, senderPub, otherPub, ts);
    relay.recordAssignment({ session_id: sessionId, participant_a: senderPub, participant_b: otherPub, session_timestamp: ts, directory_signature: await dirKp.sign(tbs) });

    // TWO transport nodes with distinct transport keys, both authenticating as the SAME agent —
    // so the second submit meets a fresh per-peer bucket and only the pubkey limit can refuse it.
    const nodeA = await createNode({ keyProvider: generateKeypair(), listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await nodeA.start();
    scope.addCleanup(async () => { await nodeA.stop(); });
    await nodeA.dial(relayAddr);
    const nodeB = await createNode({ keyProvider: generateKeypair(), listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await nodeB.start();
    scope.addCleanup(async () => { await nodeB.stop(); });
    await nodeB.dial(relayAddr);
    expect(nodeA.getPeerId(), "precondition: these must be DIFFERENT transport peers").not.toBe(nodeB.getPeerId());

    const a = await authedStream(nodeA, relayPeerId, senderKp, dirKp);
    const { structure1_cbor: s1, sender_signature: sig1 } = await makeStructure1(sessionId, new Uint8Array(randomBytes(32)), senderKp, 0);
    sendFrame(a.stream, CBOR_ENC.encode({ type: "hash_submit", session_id: sessionId, leaf_kind: 0x00, structure1_cbor: s1, sender_signature: sig1 }));
    expect((await a.reader.readDecoded())["type"], "the first submit is under the limit").toBe("hash_submit_ack");

    const b = await authedStream(nodeB, relayPeerId, senderKp, dirKp);
    const { structure1_cbor: s2, sender_signature: sig2 } = await makeStructure1(sessionId, new Uint8Array(randomBytes(32)), senderKp, 1);
    sendFrame(b.stream, CBOR_ENC.encode({ type: "hash_submit", session_id: sessionId, leaf_kind: 0x00, structure1_cbor: s2, sender_signature: sig2 }));
    const verdict = await b.reader.readDecoded();
    expect(
      verdict["reason"],
      "the SAME pubkey from a NEW transport peer must still be refused. Its per-peer bucket is fresh, " +
        "so only the per-pubkey limit can refuse it — if this passes, that limiter is gone and one " +
        "agent can flood the relay simply by opening connections from more machines.",
    ).toBe("rate_limited");
  }, 20_000);
});
