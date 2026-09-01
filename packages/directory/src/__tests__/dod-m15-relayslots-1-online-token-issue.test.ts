/**
 * DOD-M15-RELAYSLOTS-1 (directory half) — the directory issues the token that says "registered".
 *
 * A relay grants circuit reservation slots, and until this milestone the only thing it could check
 * was that the caller held *a* keypair. Keypairs are free, so an attacker minted one per slot and
 * took the whole table. The fact that separates a real agent from a minted key — REGISTRATION — is
 * held by the directory and never reached the relay.
 *
 * The directory learns an agent is starting one step before any relay is contacted: the daemon opens
 * its signaling stream, the directory authenticates it, and only then does the standing receiver ask
 * for a slot. So the token rides the acknowledgement of that authentication.
 *
 * ⚠️ THE PART THAT IS EASY TO GET WRONG, AND IS WHAT THIS FILE IS REALLY FOR. Authenticating on the
 * signaling stream does NOT mean registered — that handshake only proves key possession too, exactly
 * like the relay's. If the directory issued a token to whoever completed it, the token would carry
 * precisely as much information as the check it was meant to replace, the flood would still work,
 * and everything would look correct. So the profile is looked up explicitly, and an unregistered key
 * gets no token.
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
import { InMemoryDirectoryStore } from "@cello-protocol/interfaces/stubs";
import {
  verifyOnlineToken,
  ONLINE_TOKEN_BYTES,
  ONLINE_TOKEN_ISSUE_LIFETIME_MS,
} from "@cello-protocol/interfaces";
import type { AgentProfile } from "@cello-protocol/protocol-types";
import type { Stream } from "@libp2p/interface";
import { createDirectoryNode, SIGNALING_PROTOCOL_ID } from "../directory-node.js";
import type { RelayAdapter } from "../directory-node.js";
import type { RelaySessionAssignment } from "../directory-types.js";

setupV3Tests();

const CBOR_ENC = new Encoder({ tagUint8Array: false });
const AUTH_DOMAIN = "CELLO-DIR-AUTH-v1";

function sendFrame(stream: Stream, bytes: Uint8Array): void {
  stream.send(lp.encode.single(bytes));
}

async function readFrame(iter: AsyncIterator<unknown>): Promise<Record<string, unknown>> {
  const result = await iter.next();
  if (result.done) throw new Error("stream closed");
  const v = result.value as Uint8Array | { slice(): Uint8Array };
  const bytes = v instanceof Uint8Array ? v : v.slice();
  return decode(bytes) as Record<string, unknown>;
}

function makeRelayStub(): RelayAdapter {
  return {
    recordAssignment(_a: RelaySessionAssignment) { return { ok: true as const }; },
    discardSession(_s: Uint8Array) {},
    submitForSeal(_s: Uint8Array) { return { ok: false as const, reason: "session_not_found" }; },
    confirmSeal(_s: Uint8Array) {},
    rejectSeal(_s: Uint8Array, _r: string) {},
  };
}

/** A registered agent, as the store would hold it after a completed registration ceremony. */
function profileFor(kLocalPubkeyHex: string): AgentProfile {
  return {
    k_local_pubkey: kLocalPubkeyHex,
    primary_pubkey: "aa".repeat(32),
    ml_dsa_pubkey: "bb".repeat(1312),
    phone_stub_hash: Buffer.from(randomBytes(32)).toString("hex"),
    profile: {},
    registered_at: Date.now(),
    status: "active",
    agent_id: Buffer.from(randomBytes(16)).toString("hex"),
  };
}

describe("DOD-M15-RELAYSLOTS-1: the directory issues an online token to REGISTERED agents only", () => {
  let scope = createTestScope();
  beforeEach(() => { scope = createTestScope(); });
  afterEach(() => scope.run(async () => {}));

  /** Authenticate an agent over the signaling stream and return the raw auth_ok frame. */
  async function authAndGetAck(opts: { registered: boolean }): Promise<{
    ack: Record<string, unknown>;
    agentPubkey: Uint8Array;
    dirPubkey: Uint8Array;
  }> {
    const dirKey = generateKeypair();
    const store = new InMemoryDirectoryStore();
    const agentKey = generateKeypair();
    const agentPubkey = await agentKey.getPublicKey();
    const agentPubkeyHex = Buffer.from(agentPubkey).toString("hex");
    if (opts.registered) store.setProfile(profileFor(agentPubkeyHex));

    const dirNode = await createDirectoryNode({
      relay: makeRelayStub(),
      keyProvider: dirKey,
      store,
      relayEndpoint: { peer_id: "12D3KooWUnused", multiaddrs: ["/ip4/127.0.0.1/tcp/1"] },
    });
    scope.addCleanup(dirNode.stop);

    const clientNode = await createNode({ keyProvider: agentKey, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await clientNode.start();
    scope.addCleanup(() => clientNode.stop());
    await clientNode.dial(dirNode.node.listenAddresses()[0]);

    const stream = await clientNode.newStream(dirNode.node.getPeerId(), SIGNALING_PROTOCOL_ID);
    const iter = (lp.decode(stream) as AsyncIterable<unknown>)[Symbol.asyncIterator]();
    const challenge = await readFrame(iter);
    expect(challenge["type"]).toBe("signaling_auth_challenge");
    const nonce = challenge["nonce"] as Uint8Array;
    const authMsg = new Uint8Array(Buffer.concat([Buffer.from(AUTH_DOMAIN, "utf8"), nonce, agentPubkey]));
    const msgHash = new Uint8Array(createHash("sha256").update(authMsg).digest());
    const signature = await agentKey.sign(msgHash);
    sendFrame(stream, CBOR_ENC.encode({
      type: "signaling_auth_response",
      pubkey: new Uint8Array(agentPubkey),
      signature: new Uint8Array(signature),
    }) as Uint8Array);

    const ack = await readFrame(iter);
    expect(ack["type"]).toBe("signaling_auth_ok");
    return { ack, agentPubkey, dirPubkey: await dirKey.getPublicKey() };
  }

  it("★★★ a registered agent's auth_ok carries a token bound to its own key", async () => {
    const { ack, agentPubkey, dirPubkey } = await authAndGetAck({ registered: true });

    const token = ack["online_token"] as Uint8Array | undefined;
    expect(token, "without this the agent cannot hold a reservation slot on any relay").toBeDefined();
    expect(token!.length).toBe(ONLINE_TOKEN_BYTES);

    const verified = verifyOnlineToken(new Uint8Array(token!), [dirPubkey], Date.now());
    expect(
      verified.ok,
      "the relay verifies this against the SAME key set it checks session assignments with, so it " +
        "must be signed by the node's own key provider — not some other directory key.",
    ).toBe(true);
    if (!verified.ok) return;
    expect(Buffer.from(verified.agentPubkey).toString("hex")).toBe(Buffer.from(agentPubkey).toString("hex"));
  }, 30_000);

  it("★★★ an UNREGISTERED key authenticates but gets NO token", async () => {
    const { ack } = await authAndGetAck({ registered: false });

    expect(
      ack["online_token"],
      "completing the signaling handshake proves key possession and nothing more — the same thing " +
        "the relay could already check for itself. Issuing a token here would make the token " +
        "worthless while making the system look protected.",
    ).toBeUndefined();
  }, 30_000);

  it("issues a bounded lifetime, so revocation is a matter of waiting rather than of plumbing", async () => {
    const before = Date.now();
    const { ack, dirPubkey } = await authAndGetAck({ registered: true });
    const after = Date.now();

    const verified = verifyOnlineToken(new Uint8Array(ack["online_token"] as Uint8Array), [dirPubkey], Date.now());
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    expect(verified.expiresAtMs).toBeGreaterThanOrEqual(before + ONLINE_TOKEN_ISSUE_LIFETIME_MS);
    expect(verified.expiresAtMs).toBeLessThanOrEqual(after + ONLINE_TOKEN_ISSUE_LIFETIME_MS);
  }, 30_000);

  it("a token from one agent does not verify as another's — the binding is per-key, not per-directory", async () => {
    const a = await authAndGetAck({ registered: true });
    const b = await authAndGetAck({ registered: true });

    const verifiedA = verifyOnlineToken(new Uint8Array(a.ack["online_token"] as Uint8Array), [a.dirPubkey], Date.now());
    expect(verifiedA.ok).toBe(true);
    if (!verifiedA.ok) return;
    expect(Buffer.from(verifiedA.agentPubkey).toString("hex")).not.toBe(
      Buffer.from(b.agentPubkey).toString("hex"),
    );
  }, 30_000);
});
