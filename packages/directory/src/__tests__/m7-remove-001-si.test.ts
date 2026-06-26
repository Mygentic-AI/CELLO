/**
 * CELLO-M7-REMOVE-001 — SI-001: the directory records a revocation ONLY if it is self-signed by the
 * agent's OWN registered K_local. A revocation for X's agent_id submitted by a DIFFERENT agent, or with
 * an invalid signature, is rejected with a distinct reason and NOTHING is written — X stays active.
 *
 * In-process protocol test (mirrors registration.test.ts): a real libp2p client authenticates a
 * /cello/signaling/1.0.0 stream to a real DirectoryNode and sends a revoke_agent frame. We pass our own
 * InMemoryDirectoryStore so we can seed profiles and assert exactly what was (not) written.
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
import { Encoder } from "cbor-x";
import * as lp from "it-length-prefixed";
import { generateKeypair, verify } from "@cello-protocol/crypto";
import { createNode } from "@cello-protocol/transport";
import type { Stream } from "@libp2p/interface";
import { InMemoryDirectoryStore } from "@cello-protocol/interfaces/stubs";
import type { AgentProfile } from "@cello-protocol/protocol-types";
import { createDirectoryNode, SIGNALING_PROTOCOL_ID, buildAgentRevocationTbs } from "../directory-node.js";
import type { RelayAdapter } from "../directory-node.js";

setupV3Tests();

const CBOR_ENC = new Encoder({ tagUint8Array: false });
const AUTH_DOMAIN = "CELLO-DIR-AUTH-v1";

class StreamReader {
  readonly #iter: AsyncIterator<Uint8Array>;
  constructor(stream: Stream) {
    this.#iter = (lp.decode(stream) as AsyncIterable<unknown>)[Symbol.asyncIterator]() as AsyncIterator<Uint8Array>;
  }
  async readFrame(): Promise<Record<string, unknown>> {
    const result = await this.#iter.next();
    if (result.done) throw new Error("stream closed");
    const v = result.value;
    const bytes = v instanceof Uint8Array ? v : (v as unknown as { slice(): Uint8Array }).slice();
    const { decode } = await import("cbor-x");
    return decode(bytes) as Record<string, unknown>;
  }
  async readFrameWithTimeout(ms = 5000): Promise<Record<string, unknown>> {
    return Promise.race([this.readFrame(), new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`timeout ${ms}ms`)), ms))]);
  }
}

function sendFrame(stream: Stream, bytes: Uint8Array): void {
  stream.send(lp.encode.single(bytes));
}

function makeRelay(): RelayAdapter {
  return {
    async recordAssignment() { return { ok: true as const }; },
    async discardSession() {},
    async submitForSeal() { return { ok: false as const, reason: "not_supported" }; },
    async confirmSeal() {},
    async rejectSeal() {},
  };
}

async function doAuth(
  clientNode: Awaited<ReturnType<typeof createNode>>,
  dirPeerId: string,
  keyProvider: ReturnType<typeof generateKeypair>,
): Promise<{ stream: Stream; reader: StreamReader }> {
  const stream = await clientNode.newStream(dirPeerId, SIGNALING_PROTOCOL_ID);
  const reader = new StreamReader(stream);
  const challenge = await reader.readFrame();
  expect(challenge["type"]).toBe("signaling_auth_challenge");
  const nonce = challenge["nonce"] as Uint8Array;
  const pubkey = await keyProvider.getPublicKey();
  const authMsg = new Uint8Array(Buffer.concat([Buffer.from(AUTH_DOMAIN, "utf8"), nonce, pubkey]));
  const msgHash = new Uint8Array(createHash("sha256").update(authMsg).digest());
  const signature = await keyProvider.sign(msgHash);
  sendFrame(stream, CBOR_ENC.encode({ type: "signaling_auth_response", pubkey: new Uint8Array(pubkey), signature: new Uint8Array(signature) }));
  expect((await reader.readFrame())["type"]).toBe("signaling_auth_ok");
  return { stream, reader };
}

function seedProfile(store: InMemoryDirectoryStore, kLocalPubkeyHex: string, agentId: string): void {
  const profile: AgentProfile = {
    k_local_pubkey: kLocalPubkeyHex,
    primary_pubkey: randomBytes(32).toString("hex"),
    ml_dsa_pubkey: "",
    phone_stub_hash: "",
    registered_at: Date.now(),
    status: "active",
    agent_id: agentId,
    profile: {},
  } as AgentProfile;
  store.setProfile(profile);
}

describe("CELLO-M7-REMOVE-001 SI-001: self-authorized revocation only", () => {
  let scope: ReturnType<typeof createTestScope>;
  beforeEach(() => { scope = createTestScope(); });
  afterEach(() => scope.run(async () => {}));

  async function setup(): Promise<{
    store: InMemoryDirectoryStore;
    dirPeerId: string;
    dial: string;
    keyX: ReturnType<typeof generateKeypair>;
    pubXHex: string;
    agentIdX: string;
    keyB: ReturnType<typeof generateKeypair>;
    agentIdB: string;
    clientNode: Awaited<ReturnType<typeof createNode>>;
  }> {
    const store = new InMemoryDirectoryStore();
    const dirKey = generateKeypair();
    const { node: dirNode, stop } = await createDirectoryNode({
      keyProvider: dirKey,
      relay: makeRelay(),
      relayEndpoint: { peer_id: "12D3KooWFakeRelay", multiaddrs: ["/ip4/127.0.0.1/tcp/19999"] },
      store,
    });
    scope.addCleanup(stop);

    const keyX = generateKeypair();
    const pubXHex = Buffer.from(await keyX.getPublicKey()).toString("hex");
    const agentIdX = randomBytes(16).toString("hex");
    seedProfile(store, pubXHex, agentIdX);

    const keyB = generateKeypair();
    const pubBHex = Buffer.from(await keyB.getPublicKey()).toString("hex");
    const agentIdB = randomBytes(16).toString("hex");
    seedProfile(store, pubBHex, agentIdB);

    const clientNode = await createNode({ keyProvider: generateKeypair(), listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await clientNode.start();
    scope.addCleanup(() => clientNode.stop());
    await clientNode.dial(dirNode.listenAddresses()[0]!);

    return { store, dirPeerId: dirNode.getPeerId(), dial: dirNode.listenAddresses()[0]!, keyX, pubXHex, agentIdX, keyB, agentIdB, clientNode };
  }

  it("rejects a revocation of X's agent_id submitted by a DIFFERENT agent (not_self_authorized); nothing written", async () => {
    await scope.run(async () => {
      const s = await setup();
      // B authenticates with ITS OWN key, then tries to revoke X's agent_id (signing the TBS with B's key).
      const { stream, reader } = await doAuth(s.clientNode, s.dirPeerId, s.keyB);
      const revokedAt = Date.now();
      const tbs = buildAgentRevocationTbs(s.agentIdX, s.pubXHex, "", "voluntary", revokedAt);
      const sig = await s.keyB.sign(tbs); // forged: B signs X's revocation
      sendFrame(stream, CBOR_ENC.encode({ type: "revoke_agent", agent_id: s.agentIdX, epoch_id: "", reason: "voluntary", revoked_at: revokedAt, signature: Buffer.from(sig).toString("hex") }));

      const reply = await reader.readFrameWithTimeout();
      expect(reply["type"]).toBe("agent_revocation_error");
      expect(reply["reason"]).toBe("not_self_authorized");
      // SI-001: nothing written; X stays active + reachable.
      expect(s.store.getAgentRevocation(s.agentIdX), "no revocation row may be written").toBeUndefined();
      expect(s.store.isAgentRevoked(s.pubXHex), "X must NOT be revoked").toBe(false);
    });
  });

  it("rejects a revocation of the agent's own id with an INVALID signature (signature_invalid); nothing written", async () => {
    await scope.run(async () => {
      const s = await setup();
      // X authenticates with its own key, but sends a garbage signature over its own revocation.
      const { stream, reader } = await doAuth(s.clientNode, s.dirPeerId, s.keyX);
      const revokedAt = Date.now();
      const garbage = Buffer.from(randomBytes(64)).toString("hex");
      sendFrame(stream, CBOR_ENC.encode({ type: "revoke_agent", agent_id: s.agentIdX, epoch_id: "", reason: "voluntary", revoked_at: revokedAt, signature: garbage }));

      const reply = await reader.readFrameWithTimeout();
      expect(reply["type"]).toBe("agent_revocation_error");
      expect(reply["reason"]).toBe("signature_invalid");
      expect(s.store.getAgentRevocation(s.agentIdX)).toBeUndefined();
      expect(s.store.isAgentRevoked(s.pubXHex)).toBe(false);
    });
  });

  it("positive control: a VALID self-signed revocation of the agent's own id is accepted + recorded", async () => {
    await scope.run(async () => {
      const s = await setup();
      const { stream, reader } = await doAuth(s.clientNode, s.dirPeerId, s.keyX);
      const revokedAt = Date.now();
      const tbs = buildAgentRevocationTbs(s.agentIdX, s.pubXHex, "", "voluntary", revokedAt);
      const sig = await s.keyX.sign(tbs);
      sendFrame(stream, CBOR_ENC.encode({ type: "revoke_agent", agent_id: s.agentIdX, epoch_id: "", reason: "voluntary", revoked_at: revokedAt, signature: Buffer.from(sig).toString("hex") }));

      const reply = await reader.readFrameWithTimeout();
      expect(reply["type"], JSON.stringify(reply)).toBe("agent_revocation_ack");
      expect(reply["agent_id"]).toBe(s.agentIdX);
      const rec = s.store.getAgentRevocation(s.agentIdX);
      expect(rec, "the revocation must be recorded").toBeDefined();
      expect(s.store.isAgentRevoked(s.pubXHex), "X must now be revoked (soft-refuse index)").toBe(true);
      // The stored signature re-verifies against X's registered key (the durable self-signed fact).
      expect(verify(new Uint8Array(Buffer.from(s.pubXHex, "hex")), tbs, rec!.signature)).toBe(true);
    });
  });
});
