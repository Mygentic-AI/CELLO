/**
 * DOD-M15-RELAYSLOTS-1 — **DOES THE RELAY ACTUALLY MARK A SLOT AS IN USE?**
 *
 * `lastActivityAt` is the single input to every decision this unit makes about whether a slot may
 * be taken away. The reaper refuses to touch a slot that carried traffic inside the six-hour floor.
 * The reclaim rule frees an agent's own slots only when they have carried none. If the relay's
 * carrying path stopped calling `recordActivity`, every slot on the relay would read as never
 * having carried anything, forever — and the two rules above would invert: the reaper would take
 * live conversations and the reclaim rule would hang up a promoted receiver the moment its
 * replacement authenticated. That is the exact failure an earlier round of this order shipped.
 *
 * ─── Why this file exists ─────────────────────────────────────────────────────────────────────
 *
 * The review found the wiring uncovered. An over-the-wire cap test had been carrying it as a side
 * effect — it drove three real connections and asserted an ack on each, which is what made the
 * relay mark those slots — and when that test was rewritten to build its precondition directly, the
 * coverage went with it and nothing was red. Deleting `recordActivity`'s call site left the whole
 * package green.
 *
 * So the subject gets its own file, asserted the only way that cannot drift: a real client, a real
 * submit over the real wire, and the gater the relay is actually running reporting what it was told.
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
import { RelayConnectionGater } from "../relay-connection-gater.js";
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
}

function sendFrame(stream: Stream, data: Uint8Array): void {
  stream.send(lp.encode.single(data));
}

/**
 * The gater the relay runs, with one question added: which peers has the carrying path reported
 * traffic for?
 *
 * A spy rather than a stub — every rule under test still runs for real, and `super.recordActivity`
 * is called so the ledger ends up in the state production would be in. What is observed is the
 * WIRING: that the relay's `hash_submit` handler reaches this method at all.
 */
class ActivitySpyGater extends RelayConnectionGater {
  readonly marked: string[] = [];
  override recordActivity(peerId: string): void {
    this.marked.push(peerId);
    super.recordActivity(peerId);
  }
}

describe("DOD-M15-RELAYSLOTS-1: a submit marks its slot in use, over the wire", () => {
  let scope = createTestScope();
  beforeEach(() => { scope = createTestScope(); });
  afterEach(() => scope.run(async () => {}));

  it("★★★ the relay's own carrying path reports traffic for the submitting peer", async () => {
    const dirKp = generateKeypair();
    const gater = new ActivitySpyGater({
      logger: { debug() {}, info() {}, warn() {}, error() {} },
    });
    const { node: relayNode, stop } = await createRelayNode({
      directoryPubkey: await dirKp.getPublicKey(),
      connectionGater: gater,
    });
    scope.addCleanup(stop);
    const relayPeerId = relayNode.getPeerId();
    const relayAddr = relayNode.listenAddresses()[0]!;

    const agentKp = generateKeypair();
    const clientNode = await createNode({ keyProvider: agentKp, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await clientNode.start();
    scope.addCleanup(async () => { await clientNode.stop(); });
    await clientNode.dial(relayAddr);
    const clientPeerId = clientNode.getPeerId();

    // Authenticate for real — token and all, because a submit is only reachable after that.
    const stream = await clientNode.newStream(relayPeerId, RELAY_PROTOCOL_ID);
    const reader = new StreamReader(stream);
    const challenge = await reader.readDecoded();
    expect(challenge["type"]).toBe("relay_auth_challenge");
    const nonce = challenge["nonce"] as Uint8Array;
    const pubkey = await agentKp.getPublicKey();
    const authMsg = new Uint8Array(Buffer.concat([Buffer.from(AUTH_DOMAIN, "utf8"), nonce, pubkey]));
    const signature = await agentKp.sign(new Uint8Array(createHash("sha256").update(authMsg).digest()));
    sendFrame(stream, CBOR_ENC.encode({
      type: "relay_auth_response",
      pubkey,
      signature,
      online_token: await testOnlineToken(dirKp, agentKp),
    }));
    expect((await reader.readDecoded())["type"]).toBe("relay_auth_ok");

    expect(
      gater.marked,
      "authenticating is not traffic. A slot that has only ever authenticated is exactly the slot " +
        "the reclaim rule is allowed to take back, so marking it here would disable that rule.",
    ).toEqual([]);

    // Now traffic. The submit itself is refused downstream — no assignment authorizes this session
    // — and that is deliberate: activity is recorded BEFORE the submit is processed, because a
    // refused submit is still a slot plainly in use, and treating an ambiguous slot as idle is the
    // one direction this unit must never be wrong in.
    const sessionId = randomBytes(16);
    const contentHash = new Uint8Array(createHash("sha256").update(randomBytes(32)).digest());
    const tbs = CBOR_ENC.encode([1, contentHash, pubkey, sessionId, 0, Date.now()]) as Uint8Array;
    sendFrame(stream, CBOR_ENC.encode({
      type: "hash_submit",
      session_id: sessionId,
      leaf_kind: 0x00,
      structure1_cbor: tbs,
      sender_signature: await agentKp.sign(tbs),
    }));
    const verdict = await reader.readDecoded();
    expect(
      String(verdict["type"]).startsWith("hash_submit"),
      "precondition: the frame must have reached the submit handler at all",
    ).toBe(true);

    expect(
      gater.marked,
      "if this is empty, every slot on the relay reads as never having carried anything: the " +
        "reaper takes live conversations and the reclaim rule hangs up a promoted receiver the " +
        "moment its replacement authenticates.",
    ).toEqual([clientPeerId]);
  }, 30_000);
});
