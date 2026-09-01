/**
 * DOD-M15-RELAYAUTH-1 — reservation grants are time-boxed, not denied, on unproven identity.
 *
 * See relay-connection-gater.ts's header for why reservation GRANTS cannot be denied outright
 * (it would strand every brand-new agent's first-ever reservation — the exact class of outage
 * DOD-NAT-REACHABILITY-1 already fixed once). Instead: granted immediately, revoked if the holder
 * never completes the relay's own Ed25519 challenge-response within a grace window.
 */
import { setupV3Tests, createTestScope, describe, it, expect, beforeEach, afterEach } from "@claude-flow/testing";
import { createHash } from "node:crypto";
import { Encoder, decode } from "cbor-x";
import * as lp from "it-length-prefixed";
import { generateKeypair } from "@cello-protocol/crypto";
import { createNode } from "@cello-protocol/transport";
import type { Stream } from "@libp2p/interface";
import { createRelayNode, RELAY_PROTOCOL_ID } from "../relay-node.js";
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

// DOD-M15-RELAYSLOTS-1: keeping a reservation now takes more than proving key possession — the auth
// must also carry the directory's token saying this key belongs to a registered agent.
async function completeRelayAuth(node: Awaited<ReturnType<typeof createNode>>, relayPeerId: string, kp: ReturnType<typeof generateKeypair>, dirKp: ReturnType<typeof generateKeypair>): Promise<void> {
  const stream = await node.newStream(relayPeerId, RELAY_PROTOCOL_ID);
  const reader = new StreamReader(stream);
  const challenge = await reader.readDecoded();
  const nonce = challenge["nonce"] as Uint8Array;
  const pubkey = await kp.getPublicKey();
  const authMsg = new Uint8Array(Buffer.concat([Buffer.from(AUTH_DOMAIN, "utf8"), nonce, pubkey]));
  const msgHash = new Uint8Array(createHash("sha256").update(authMsg).digest());
  const signature = await kp.sign(msgHash);
  stream.send(lp.encode.single(CBOR_ENC.encode({
    type: "relay_auth_response",
    pubkey,
    signature,
    online_token: await testOnlineToken(dirKp, kp),
  })));
  const ack = await reader.readDecoded();
  if (ack["type"] !== "relay_auth_ok") throw new Error(`expected relay_auth_ok, got ${String(ack["type"])}`);
}

async function makeReceiver(relayAddr: string, scope: ReturnType<typeof createTestScope>) {
  const node = await createNode({
    keyProvider: generateKeypair(),
    listenAddresses: ["/ip4/127.0.0.1/tcp/0", `${relayAddr}/p2p-circuit`],
    nodeType: "standing_receiver",
  });
  scope.addCleanup(async () => { try { await node.stop(); } catch { /* cleanup */ } });
  await node.start();
  const deadline = Date.now() + 10_000;
  let circuitAddr: string | undefined;
  while (Date.now() < deadline) {
    circuitAddr = node.listenAddresses().find((a: string) => a.includes("/p2p-circuit"));
    if (circuitAddr) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  if (!circuitAddr) throw new Error("receiver never got a circuit reservation");
  return node;
}

function awaitDisconnect(node: Awaited<ReturnType<typeof createNode>>, peerId: string, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    node.onPeerDisconnect((p: string) => {
      if (p === peerId) { clearTimeout(timer); resolve(true); }
    });
  });
}

describe("DOD-M15-RELAYAUTH-1: reservation grants are time-boxed on proving key possession", () => {
  let scope = createTestScope();
  beforeEach(() => { scope = createTestScope(); });
  afterEach(() => scope.run(async () => {}));

  it("a reservation holder who NEVER authenticates is disconnected once the grace window elapses", async () => {
    const dirKp = generateKeypair();
    const { node: relayNode, stop } = await createRelayNode({
      directoryPubkey: await dirKp.getPublicKey(),
      reservationGraceMs: 300,
    });
    scope.addCleanup(stop);
    const relayAddr = relayNode.listenAddresses().find((a) => a.includes("/p2p/"))!;

    const receiver = await makeReceiver(relayAddr, scope);
    const relayPeerId = relayNode.getPeerId();

    // Reservation is live NOW (this is the revert-test's teeth: without the fix — no gater at
    // all — this receiver is never touched and stays connected forever).
    const disconnectedEarly = await awaitDisconnect(receiver, relayPeerId, 100);
    expect(disconnectedEarly, "granted immediately — never denied at grant time").toBe(false);

    // Never sends relay_auth_response. Gone once the grace window passes.
    const disconnected = await awaitDisconnect(receiver, relayPeerId, 3_000);
    expect(disconnected, "an unproven reservation must not be held indefinitely").toBe(true);
  }, 20_000);

  it("a reservation holder who authenticates WITHIN the grace window keeps its reservation", async () => {
    const dirKp = generateKeypair();
    const { node: relayNode, stop } = await createRelayNode({
      directoryPubkey: await dirKp.getPublicKey(),
      reservationGraceMs: 300,
    });
    scope.addCleanup(stop);
    const relayAddr = relayNode.listenAddresses().find((a) => a.includes("/p2p/"))!;

    const receiverKp = generateKeypair();
    const receiver = await createNode({
      keyProvider: receiverKp,
      listenAddresses: ["/ip4/127.0.0.1/tcp/0", `${relayAddr}/p2p-circuit`],
      nodeType: "standing_receiver",
    });
    scope.addCleanup(async () => { try { await receiver.stop(); } catch { /* cleanup */ } });
    await receiver.start();
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline && !receiver.listenAddresses().some((a) => a.includes("/p2p-circuit"))) {
      await new Promise((r) => setTimeout(r, 50));
    }
    const relayPeerId = relayNode.getPeerId();

    // Proactively authenticate — mirrors the client-side fix (session-node-manager.ts now does
    // this immediately after securing a reservation, instead of waiting for a session to exist).
    await completeRelayAuth(receiver, relayPeerId, receiverKp, dirKp);

    const disconnected = await awaitDisconnect(receiver, relayPeerId, 3_000);
    expect(disconnected, "an authenticated holder's reservation must survive the grace window").toBe(false);
  }, 20_000);
});
