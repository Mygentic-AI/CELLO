/**
 * DOD-M15-RELAYSLOTS-1 — the relay will not authenticate a key the directory has not vouched for.
 *
 * A relay holds a bounded number of circuit reservation slots. Until now the only test to get one
 * was signing the relay's challenge, which proves possession of *a* keypair — and keypairs are free.
 * Mint as many as there are slots and every real agent's front door is taken, while the relay looks
 * perfectly healthy because each individual request was well-formed.
 *
 * The fix is a short-lived, directory-signed token bound to the agent's public key, issued when the
 * directory marks the agent online and presented when it authenticates to a relay. These tests are
 * the relay half: they run against the REAL relay over the REAL wire, because the failure they guard
 * against is a check that verifies something other than what arrives.
 *
 * The two requirements without which this has no teeth, both asserted below:
 *  - the token must be BOUND to the key completing the challenge, or it is a bearer pass anyone can
 *    lift and present with a throwaway key;
 *  - a relay with no directory key configured must REFUSE, not wave callers through — that is how a
 *    check ends up installed and decorative.
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
import { createHash, randomBytes } from "node:crypto";
import { Encoder, decode } from "cbor-x";
import * as lp from "it-length-prefixed";
import { generateKeypair } from "@cello-protocol/crypto";
import { createNode } from "@cello-protocol/transport";
import { mintOnlineToken, ONLINE_TOKEN_MAX_LIFETIME_MS } from "@cello-protocol/interfaces";
import type { Stream } from "@libp2p/interface";
import { createRelayNode, RELAY_PROTOCOL_ID } from "../relay-node.js";
import { RelayConnectionGater } from "../relay-connection-gater.js";

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

type Keypair = ReturnType<typeof generateKeypair>;

/** Mint a token for `agentKp`, signed by `dirKp`, expiring `ttlMs` from now. */
async function tokenFor(dirKp: Keypair, agentPubkey: Uint8Array, ttlMs = 60 * 60 * 1000): Promise<Uint8Array> {
  return mintOnlineToken({
    agentPubkey,
    expiresAtMs: Date.now() + ttlMs,
    sign: async (tbs) => dirKp.sign(tbs),
  });
}

/**
 * Authenticate over a fresh stream and return the relay's verdict frame.
 *
 * `online_token` is passed through verbatim — including `undefined`, which is the omission case and
 * is the one an unmodified pre-token client produces.
 */
async function authenticate(
  node: Awaited<ReturnType<typeof createNode>>,
  relayPeerId: string,
  kp: Keypair,
  opts: { online_token?: Uint8Array; purpose?: string } = {},
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
    ...(opts.online_token === undefined ? {} : { online_token: opts.online_token }),
    ...(opts.purpose === undefined ? {} : { purpose: opts.purpose }),
  }));
  return { stream, reader, verdict: await reader.readDecoded() };
}

describe("DOD-M15-RELAYSLOTS-1: only a registered agent may authenticate to a relay", () => {
  let scope = createTestScope();
  beforeEach(() => { scope = createTestScope(); });
  afterEach(() => scope.run(async () => {}));

  async function relayWith(dirPubkeys: { directoryPubkey?: Uint8Array; directoryPubkeys?: Uint8Array[] }) {
    const { relay, node, stop } = await createRelayNode(dirPubkeys);
    scope.addCleanup(stop);
    return { relay, relayPeerId: node.getPeerId(), relayAddr: node.listenAddresses()[0]! };
  }

  async function agentDialing(relayAddr: string, kp: Keypair) {
    const node = await createNode({ keyProvider: kp, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await node.start();
    scope.addCleanup(async () => { await node.stop(); });
    await node.dial(relayAddr);
    return node;
  }

  it("accepts an agent presenting a valid token bound to its own key", async () => {
    const dirKp = generateKeypair();
    const { relayPeerId, relayAddr } = await relayWith({ directoryPubkey: await dirKp.getPublicKey() });

    const agentKp = generateKeypair();
    const node = await agentDialing(relayAddr, agentKp);
    const token = await tokenFor(dirKp, await agentKp.getPublicKey());

    const { verdict } = await authenticate(node, relayPeerId, agentKp, { online_token: token });
    expect(verdict["type"]).toBe("relay_auth_ok");
  }, 30_000);

  it("accepts a reservation-purpose proof carrying a valid token", async () => {
    const dirKp = generateKeypair();
    const { relayPeerId, relayAddr } = await relayWith({ directoryPubkey: await dirKp.getPublicKey() });

    const agentKp = generateKeypair();
    const node = await agentDialing(relayAddr, agentKp);
    const token = await tokenFor(dirKp, await agentKp.getPublicKey());

    const { verdict } = await authenticate(node, relayPeerId, agentKp, {
      online_token: token,
      purpose: "reservation",
    });
    expect(verdict["type"]).toBe("relay_auth_ok");
  }, 30_000);

  it("★★★ refuses a freshly minted keypair that presents NO token — the flood, refused", async () => {
    const dirKp = generateKeypair();
    const { relayPeerId, relayAddr } = await relayWith({ directoryPubkey: await dirKp.getPublicKey() });

    const attackerKp = generateKeypair();
    const node = await agentDialing(relayAddr, attackerKp);

    const { verdict } = await authenticate(node, relayPeerId, attackerKp);
    expect(
      verdict["type"],
      "an unregistered key signed the challenge correctly. Signing the challenge is free — that is " +
        "the whole attack — so the relay must not treat it as enough to be served.",
    ).toBe("relay_auth_failed");
    expect(verdict["reason"]).toBe("online_token_required");
  }, 30_000);

  it("★★★ refuses a token bound to SOMEONE ELSE's key — a lifted token is not a bearer pass", async () => {
    const dirKp = generateKeypair();
    const { relayPeerId, relayAddr } = await relayWith({ directoryPubkey: await dirKp.getPublicKey() });

    // A real, valid, unexpired token — issued to a registered agent, then lifted.
    const victimKp = generateKeypair();
    const liftedToken = await tokenFor(dirKp, await victimKp.getPublicKey());

    // ...and presented by an attacker's own throwaway key, which signs the challenge itself.
    const attackerKp = generateKeypair();
    const node = await agentDialing(relayAddr, attackerKp);

    const { verdict } = await authenticate(node, relayPeerId, attackerKp, { online_token: liftedToken });
    expect(
      verdict["type"],
      "the token verifies against the directory key and has not expired. If the relay does not also " +
        "check WHICH key it names, one leaked token is a reusable pass for every throwaway key an " +
        "attacker can generate.",
    ).toBe("relay_auth_failed");
    expect(verdict["reason"]).toBe("online_token_pubkey_mismatch");
  }, 30_000);

  it("refuses an expired token", async () => {
    const dirKp = generateKeypair();
    const { relayPeerId, relayAddr } = await relayWith({ directoryPubkey: await dirKp.getPublicKey() });

    const agentKp = generateKeypair();
    const node = await agentDialing(relayAddr, agentKp);
    const expired = await tokenFor(dirKp, await agentKp.getPublicKey(), -60_000);

    const { verdict } = await authenticate(node, relayPeerId, agentKp, { online_token: expired });
    expect(verdict["type"]).toBe("relay_auth_failed");
    expect(verdict["reason"]).toBe("online_token_expired");
  }, 30_000);

  it("refuses a token whose lifetime exceeds the relay's ceiling, however well signed", async () => {
    const dirKp = generateKeypair();
    const { relayPeerId, relayAddr } = await relayWith({ directoryPubkey: await dirKp.getPublicKey() });

    const agentKp = generateKeypair();
    const node = await agentDialing(relayAddr, agentKp);
    const forever = await tokenFor(dirKp, await agentKp.getPublicKey(), ONLINE_TOKEN_MAX_LIFETIME_MS + 60_000);

    const { verdict } = await authenticate(node, relayPeerId, agentKp, { online_token: forever });
    expect(verdict["type"]).toBe("relay_auth_failed");
    expect(verdict["reason"]).toBe("online_token_lifetime_too_long");
  }, 30_000);

  it("refuses a token signed by a directory outside this relay's consortium set", async () => {
    const dirKp = generateKeypair();
    const strangerKp = generateKeypair();
    const { relayPeerId, relayAddr } = await relayWith({ directoryPubkey: await dirKp.getPublicKey() });

    const agentKp = generateKeypair();
    const node = await agentDialing(relayAddr, agentKp);
    const forged = await tokenFor(strangerKp, await agentKp.getPublicKey());

    const { verdict } = await authenticate(node, relayPeerId, agentKp, { online_token: forged });
    expect(verdict["type"]).toBe("relay_auth_failed");
    expect(verdict["reason"]).toBe("online_token_signature_invalid");
  }, 30_000);

  it("accepts a token from ANY sovereign directory in the consortium, not just the first", async () => {
    const nodeA = generateKeypair();
    const nodeB = generateKeypair();
    const { relayPeerId, relayAddr } = await relayWith({
      directoryPubkey: await nodeA.getPublicKey(),
      directoryPubkeys: [await nodeB.getPublicKey()],
    });

    const agentKp = generateKeypair();
    const node = await agentDialing(relayAddr, agentKp);
    const token = await tokenFor(nodeB, await agentKp.getPublicKey());

    const { verdict } = await authenticate(node, relayPeerId, agentKp, { online_token: token });
    expect(
      verdict["type"],
      "an agent connects to whichever directory it reached, and the relay accepts assignments from " +
        "any of them already. A relay that honoured only node 0's tokens would strand every agent " +
        "homed elsewhere.",
    ).toBe("relay_auth_ok");
  }, 30_000);

  it("★★★ a relay with NO directory key configured refuses everyone — it never fails open", async () => {
    const { relayPeerId, relayAddr } = await relayWith({});

    const agentKp = generateKeypair();
    const node = await agentDialing(relayAddr, agentKp);
    // A perfectly good token. There is simply nothing here to check it against.
    const token = await tokenFor(generateKeypair(), await agentKp.getPublicKey());

    const { verdict } = await authenticate(node, relayPeerId, agentKp, { online_token: token });
    expect(
      verdict["type"],
      "a misconfigured relay cannot verify anything. The natural default is to allow, and then the " +
        "flood works exactly as if this feature had never shipped.",
    ).toBe("relay_auth_failed");
    expect(verdict["reason"]).toBe("online_token_no_directory_key");
  }, 30_000);

  it("★★★ refuses past the per-agent slot cap OVER THE WIRE, and the refusal carries what to do about it", async () => {
    const dirKp = generateKeypair();
    /**
     * The gater is supplied so the test can put this agent AT its cap with real reservations before
     * the wire call. The cap counts RESERVATIONS at both checkpoints — review M3: it used to count
     * every authenticated peer at the auth step and only reservations at the grant step, so an agent
     * running session nodes that dial in to submit leaves, holding no reservations at all, was
     * refused authentication and told to close sessions it did not have.
     */
    const gater = new RelayConnectionGater({ logger: { debug() {}, info() {}, warn() {}, error() {} }, slotCapPerAgent: 2 });
    const { node, stop } = await createRelayNode({
      directoryPubkey: await dirKp.getPublicKey(),
      connectionGater: gater,
      slotCapPerAgent: 2,
    });
    scope.addCleanup(stop);
    const relayPeerId = node.getPeerId();
    const relayAddr = node.listenAddresses()[0]!;

    const agentKp = generateKeypair();
    const agentHex = Buffer.from(await agentKp.getPublicKey()).toString("hex");

    // Two real reservations for this agent, taken the way a client takes them.
    for (const id of ["held-1", "held-2"]) {
      expect(gater.admitSlot(id, agentHex).ok).toBe(true);
      gater.recordAuthenticated(id);
      expect(gater.denyInboundRelayReservation({ toString: () => id } as never)).toBe(false);
      // Traffic, so the reclaim backstop does not free them: these fake peer ids are not in the
      // relay node's connection list, so without this they read as departed holders.
      gater.recordActivity(id);
    }
    expect(gater.slotCountForAgent(agentHex), "precondition: the agent is AT its cap").toBe(2);

    // Now it authenticates over the wire. The cap is what refuses, and the refusal must carry the
    // numbers — nobody knows what sessions they have open, so "no" alone is a dead end.
    const clientNode = await agentDialing(relayAddr, agentKp);
    const token = await tokenFor(dirKp, await agentKp.getPublicKey());
    const { verdict } = await authenticate(clientNode, relayPeerId, agentKp, { online_token: token });

    expect(verdict["type"]).toBe("relay_auth_failed");
    expect(verdict["reason"]).toBe("slot_cap_exceeded");
    expect(
      verdict["slots_held"],
      "a bare reason code is not an affordance. Sessions fall apart and sit there counted, so " +
        "whoever hits this cap believes they have nothing open — the numbers are what turn 'no' " +
        "into something they can act on.",
    ).toBe(2);
    expect(verdict["slot_cap"]).toBe(2);
  }, 30_000);

  it("refuses a token that is not the right length rather than reading past its end", async () => {
    const dirKp = generateKeypair();
    const { relayPeerId, relayAddr } = await relayWith({ directoryPubkey: await dirKp.getPublicKey() });

    const agentKp = generateKeypair();
    const node = await agentDialing(relayAddr, agentKp);
    const truncated = (await tokenFor(dirKp, await agentKp.getPublicKey())).slice(0, 50);

    const { verdict } = await authenticate(node, relayPeerId, agentKp, { online_token: truncated });
    expect(verdict["type"]).toBe("relay_auth_failed");
    expect(verdict["reason"]).toBe("online_token_malformed");
  }, 30_000);
});
