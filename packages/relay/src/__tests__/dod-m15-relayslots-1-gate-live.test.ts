/**
 * DOD-M15-RELAYSLOTS-1 clause 0, END TO END — a real client, a real relay, real reservations.
 *
 * ─── Why this file has to exist ───────────────────────────────────────────────────────────────
 *
 * Every other test of this gate drives the gater by hand with fabricated peer-id strings. Review
 * measured what that misses: an implementation where the relay is perfectly correct and NO CLIENT
 * CAN REACH IT passes all of them. That is not hypothetical — it is exactly what this unit was, and
 * the one test that would have caught it was a fixture line inside a file deleted in the same commit
 * as the change that broke it.
 *
 * So this drives the real thing over TCP: a relay built by `createRelayNode` with the production
 * gater, and a client that does what the daemon now does — ask, be refused, prove itself over
 * `/cello/relay/1.0.0`, come back on the same transport identity, and ask again.
 *
 * If the gate is too strict, the second ask fails and this reddens. If it is not a gate at all, the
 * FIRST ask succeeds and this reddens. Both directions are asserted, which is the point.
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
import { createHash } from "node:crypto";
import { Encoder, decode } from "cbor-x";
import * as lp from "it-length-prefixed";
import { generateKeypair } from "@cello-protocol/crypto";
import { createNode } from "@cello-protocol/transport";
import { mintOnlineToken, ONLINE_TOKEN_ISSUE_LIFETIME_MS } from "@cello-protocol/interfaces";
import type { Stream } from "@libp2p/interface";
import { createRelayNode, RELAY_PROTOCOL_ID } from "../relay-node.js";

setupV3Tests();

const CBOR_ENC = new Encoder({ tagUint8Array: false });
const AUTH_DOMAIN = "CELLO-RELAY-AUTH-v1";

type Keypair = ReturnType<typeof generateKeypair>;

/** The daemon's proof step, over the wire: prove key possession + present the directory's token. */
async function proveOverTheWire(
  node: Awaited<ReturnType<typeof createNode>>,
  relayPeerId: string,
  agentKp: Keypair,
  dirKp: Keypair,
): Promise<string> {
  const stream: Stream = await node.newStream(relayPeerId, RELAY_PROTOCOL_ID);
  const iter = (lp.decode(stream) as AsyncIterable<unknown>)[Symbol.asyncIterator]() as AsyncIterator<Uint8Array>;
  const read = async (): Promise<Record<string, unknown>> => {
    const { value } = await iter.next();
    const v = value as unknown;
    return decode(v instanceof Uint8Array ? v : (v as { slice(): Uint8Array }).slice()) as Record<string, unknown>;
  };
  const challenge = await read();
  const nonce = challenge["nonce"] as Uint8Array;
  const pubkey = await agentKp.getPublicKey();
  const msgHash = new Uint8Array(createHash("sha256")
    .update(new Uint8Array(Buffer.concat([Buffer.from(AUTH_DOMAIN, "utf8"), nonce, pubkey])))
    .digest());
  stream.send(lp.encode.single(CBOR_ENC.encode({
    type: "relay_auth_response",
    pubkey,
    signature: await agentKp.sign(msgHash),
    purpose: "reservation",
    online_token: await mintOnlineToken({
      agentPubkey: pubkey,
      expiresAtMs: Date.now() + ONLINE_TOKEN_ISSUE_LIFETIME_MS,
      sign: async (tbs) => dirKp.sign(tbs),
    }),
  }) as Uint8Array));
  const verdict = await read();
  await stream.close().catch(() => {});
  return String(verdict["type"]);
}

describe("DOD-M15-RELAYSLOTS-1 clause 0: a real client gets a slot only after proving itself", () => {
  let scope = createTestScope();
  beforeEach(() => { scope = createTestScope(); });
  afterEach(() => scope.run(async () => {}));

  it("★★★ ask → refused → prove → ask again → granted", async () => {
    const dirKp = generateKeypair();
    const { node: relayNode, stop } = await createRelayNode({
      directoryPubkey: await dirKp.getPublicKey(),
      listenAddresses: ["/ip4/127.0.0.1/tcp/0"],
    });
    scope.addCleanup(stop);
    const relayAddr = relayNode.listenAddresses().find((a) => a.includes("/p2p/"))!;
    const relayPeerId = relayNode.getPeerId();

    const agentKp = generateKeypair();
    // ONE transport identity across both attempts — the daemon reuses its candidate seed for
    // exactly this reason, and the relay's memory of the proof is keyed on it.
    const seed = new Uint8Array(32).fill(9);

    // ── Attempt one: a stranger asks. ────────────────────────────────────────────────────────
    const first = await createNode({
      keyProvider: agentKp,
      transportPrivateKey: seed,
      listenAddresses: ["/ip4/127.0.0.1/tcp/0", `${relayAddr}/p2p-circuit`],
      nodeType: "standing_receiver",
    });
    await first.start();
    const settle = Date.now() + 4_000;
    while (Date.now() < settle && !first.listenAddresses().some((a) => a.includes("/p2p-circuit"))) {
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(
      first.listenAddresses().some((a) => a.includes("/p2p-circuit")),
      "IF THIS IS TRUE THE GATE DOES NOT EXIST — a peer that has proved nothing was handed a slot, " +
        "which is the original defect this whole order is about.",
    ).toBe(false);

    // ── Prove, on this same transport identity. ──────────────────────────────────────────────
    await first.dial(relayAddr);
    expect(await proveOverTheWire(first, relayPeerId, agentKp, dirKp)).toBe("relay_auth_ok");
    await first.stop();

    // ── Attempt two: same identity, now known. ───────────────────────────────────────────────
    const second = await createNode({
      keyProvider: agentKp,
      transportPrivateKey: seed,
      listenAddresses: ["/ip4/127.0.0.1/tcp/0", `${relayAddr}/p2p-circuit`],
      nodeType: "standing_receiver",
    });
    scope.addCleanup(async () => { try { await second.stop(); } catch { /* cleanup */ } });
    await second.start();
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline && !second.listenAddresses().some((a) => a.includes("/p2p-circuit"))) {
      await new Promise((r) => setTimeout(r, 50));
    }

    expect(
      second.listenAddresses().some((a) => a.includes("/p2p-circuit")),
      "IF THIS IS FALSE THE GATE REFUSES EVERYONE — a proven agent cannot get a reservation, every " +
        "agent is unreachable behind NAT, and the relay must not be deployed. No unit test in this " +
        "package can see that; this one is the only thing that can.",
    ).toBe(true);
  }, 60_000);
});
