/**
 * DOD-M15-RELAYAUTH-1 review T1 — **a reservation proof must not claim the delivery stream.**
 *
 * Review HIGH-1: a standing receiver has to prove key possession to keep its circuit reservation,
 * but an agent's REPLACEMENT receiver shares the agent's pubkey with the receiver that is currently
 * carrying a live session — and the relay keys leaf delivery by pubkey. So the obvious fix, "make
 * the replacement authenticate normally", was itself a bug: it would have silently stolen the live
 * session's delivery stream and delivered its counterparty's leaves to a node that is not in the
 * conversation. The fix was to mark such an auth `purpose: "reservation"`, which proves possession,
 * refreshes the reservation, and then closes without touching the delivery stream.
 *
 * That fix shipped with **no relay-side test at all**. The grace test's auth helper never sends
 * `purpose`, and the client-side test asserts against a fake relay defined inside its own test file
 * — so it proves the client SENDS the flag and nothing whatsoever about what the relay does with it.
 * Deleting the entire dispatch left the relay suite green. This is that missing test: it asserts the
 * property itself, on the real relay, over the wire.
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
  async readDecoded(): Promise<Record<string, unknown>> {
    const { value, done } = await this.#iter.next();
    if (done || value === undefined) throw new Error("stream ended");
    const v = value as unknown;
    const bytes = v instanceof Uint8Array ? v : (v as { slice(): Uint8Array }).slice();
    return decode(bytes) as Record<string, unknown>;
  }
  /**
   * Bounded read. The failure this test guards against is a frame that never arrives, so an
   * unbounded read would hang the suite instead of failing it.
   */
  async readDecodedWithin(ms: number): Promise<Record<string, unknown> | "timeout"> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<"timeout">((resolve) => { timer = setTimeout(() => resolve("timeout"), ms); });
    try {
      return await Promise.race([this.readDecoded().catch(() => "timeout" as const), timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

function sendFrame(stream: Stream, data: Uint8Array): void {
  stream.send(lp.encode.single(data));
}

/**
 * Authenticate over a fresh stream. `purpose` is passed through verbatim so a test can send the
 * ordinary auth (undefined) or a reservation proof, which is the whole distinction under test.
 */
async function authenticate(
  node: Awaited<ReturnType<typeof createNode>>,
  relayPeerId: string,
  kp: ReturnType<typeof generateKeypair>,
  // DOD-M15-RELAYSLOTS-1: both the live receiver and the replacement now need the directory's token.
  dirKp: ReturnType<typeof generateKeypair>,
  purpose?: string,
): Promise<{ stream: Stream; reader: StreamReader; verdict: Record<string, unknown> }> {
  const stream = await node.newStream(relayPeerId, RELAY_PROTOCOL_ID);
  const reader = new StreamReader(stream);
  const challenge = await reader.readDecoded();
  expect(challenge["type"]).toBe("relay_auth_challenge");
  const nonce = challenge["nonce"] as Uint8Array;
  const pubkey = await kp.getPublicKey();
  const authMsg = new Uint8Array(Buffer.concat([Buffer.from(AUTH_DOMAIN, "utf8"), nonce, pubkey]));
  const msgHash = new Uint8Array(createHash("sha256").update(authMsg).digest());
  const signature = await kp.sign(msgHash);
  sendFrame(stream, CBOR_ENC.encode({
    type: "relay_auth_response",
    pubkey,
    signature,
    online_token: await testOnlineToken(dirKp, kp),
    ...(purpose === undefined ? {} : { purpose }),
  }));
  const verdict = await reader.readDecoded();
  return { stream, reader, verdict };
}

async function makeStructure1(
  sessionId: Uint8Array,
  contentHash: Uint8Array,
  kp: ReturnType<typeof generateKeypair>,
  lastSeenSeq: number,
): Promise<{ structure1_cbor: Uint8Array; sender_signature: Uint8Array }> {
  const pubkey = await kp.getPublicKey();
  const { lastSeenHash, prevOwnHash } = chainLinks(sessionId, pubkey, lastSeenSeq);
  const tbs = CBOR_ENC.encode([3, contentHash, pubkey, sessionId, lastSeenSeq, Date.now(), lastSeenHash, prevOwnHash]) as Uint8Array;
  chainAdvance(sessionId, pubkey, contentHash);
  return { structure1_cbor: tbs, sender_signature: await kp.sign(tbs) };
}

describe("DOD-M15-RELAYAUTH-1: a reservation proof refreshes the reservation without claiming the delivery stream", () => {
  let scope = createTestScope();
  beforeEach(() => { scope = createTestScope(); });
  afterEach(() => scope.run(async () => {}));

  it("★★★ a second auth for the SAME pubkey marked purpose:reservation does NOT steal the live session's leaves", async () => {
    const dirKp = generateKeypair();
    const { relay, node: relayNode, stop } = await createRelayNode({ directoryPubkey: await dirKp.getPublicKey() });
    scope.addCleanup(stop);
    const relayPeerId = relayNode.getPeerId();
    const relayAddr = relayNode.listenAddresses()[0]!;

    // One agent (kpAgent) in a live session with a counterparty (kpOther).
    const kpAgent = generateKeypair();
    const kpOther = generateKeypair();
    const pubAgent = await kpAgent.getPublicKey();
    const pubOther = await kpOther.getPublicKey();
    const sessionId = new Uint8Array(randomBytes(16));
    const sessionTimestamp = Date.now();
    // Date.now() exceeds 0xffffffff, and recordAssignment's own TBS encodes it as a BigInt in that
    // case — the signature here must match or the assignment is silently never recorded.
    const tbs = CBOR_ENC.encode([
      sessionId, pubAgent, pubOther,
      sessionTimestamp > 0xffffffff ? BigInt(sessionTimestamp) : sessionTimestamp,
    ]) as Uint8Array;
    seedChain(sessionId, pubAgent, pubOther, sessionTimestamp);
    relay.recordAssignment({
      session_id: sessionId,
      participant_a: pubAgent,
      participant_b: pubOther,
      session_timestamp: sessionTimestamp,
      directory_signature: await dirKp.sign(tbs),
    });

    // The LIVE receiver: the node actually carrying the agent's session. It authenticates the
    // ordinary way and thereby owns the delivery stream for this agent's pubkey.
    const liveNode = await createNode({ keyProvider: kpAgent, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await liveNode.start();
    scope.addCleanup(async () => { await liveNode.stop(); });
    await liveNode.dial(relayAddr);
    const live = await authenticate(liveNode, relayPeerId, kpAgent, dirKp);
    expect(live.verdict["type"], "the live receiver authenticates normally").toBe("relay_auth_ok");

    // The REPLACEMENT standing receiver: a DIFFERENT transport node holding the SAME agent key.
    // It only needs to prove possession to keep its reservation — it must not become the delivery
    // target, because the agent is mid-conversation on the node above.
    const replacementNode = await createNode({ keyProvider: kpAgent, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await replacementNode.start();
    scope.addCleanup(async () => { await replacementNode.stop(); });
    await replacementNode.dial(relayAddr);
    const replacement = await authenticate(replacementNode, relayPeerId, kpAgent, dirKp, "reservation");
    expect(
      replacement.verdict["type"],
      "a reservation proof is still an authentication — it must be accepted, not refused",
    ).toBe("relay_auth_ok");

    // The counterparty submits a leaf. The relay delivers it to the agent — the question is which
    // of the agent's two connections receives it.
    const otherNode = await createNode({ keyProvider: kpOther, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await otherNode.start();
    scope.addCleanup(async () => { await otherNode.stop(); });
    await otherNode.dial(relayAddr);
    const other = await authenticate(otherNode, relayPeerId, kpOther, dirKp);
    expect(other.verdict["type"]).toBe("relay_auth_ok");

    const { structure1_cbor, sender_signature } = await makeStructure1(sessionId, new Uint8Array(randomBytes(32)), kpOther, 0);
    sendFrame(other.stream, CBOR_ENC.encode({
      type: "hash_submit", session_id: sessionId, leaf_kind: 0x00, structure1_cbor, sender_signature,
    }));
    expect((await other.reader.readDecoded())["type"], "precondition: the submit is accepted").toBe("hash_submit_ack");

    // THE ASSERTION: the leaf reaches the receiver that is actually in the conversation.
    const delivered = await live.reader.readDecodedWithin(8_000);
    expect(
      delivered === "timeout" ? "timeout" : delivered["type"],
      "the live receiver must get the counterparty's leaf. If this times out, the reservation proof " +
        "took over the delivery stream keyed on this agent's pubkey — the counterparty's messages are " +
        "then delivered to a node that is not in the conversation, and the agent in the conversation " +
        "is told nothing at all.",
    ).toBe("leaf_deliver");
  }, 30_000);
});
