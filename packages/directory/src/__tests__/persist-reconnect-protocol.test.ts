/**
 * Session survival — protocol-level reconnect tests (2026-05-19 fixes)
 *
 * Uses real libp2p nodes + in-process directory (InMemoryDirectoryStore).
 * No Postgres required — tests the wire protocol behavior only.
 *
 * TEST-RECONNECT-002: already_registered frame includes agent_id and primary_pubkey
 *   When a fresh client session calls register() for an already-registered agent,
 *   the directory must include agent_id, primary_pubkey, and ml_dsa_pubkey in the
 *   already_registered error frame so the client can reconstruct RegistrationState.
 *
 * TEST-RECONNECT-003: already_connected frame includes connection_id
 *   When a fresh client session calls cello_request_connection() and an active
 *   connection already exists, the directory must include the existing connection_id
 *   in the already_connected error frame so the client can hydrate its in-memory
 *   connection store.
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
import { generateKeypair, mlDsaKeygen } from "@cello-protocol/crypto";
import { createNode } from "@cello-protocol/transport";
import type { Stream } from "@libp2p/interface";
import { createDirectoryNode, SIGNALING_PROTOCOL_ID } from "../directory-node.js";
import type { RelayAdapter } from "../directory-node.js";
import type { RelaySessionAssignment } from "../directory-types.js";
import { InMemoryDirectoryStore } from "@cello-protocol/interfaces/stubs";
import { NetworkDirectoryNode, runNetworkDkg } from "@cello-protocol/client";

setupV3Tests();

const CBOR_ENC = new Encoder({ tagUint8Array: false });
const AUTH_DOMAIN = "CELLO-DIR-AUTH-v1";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeHexId(): string {
  return Buffer.from(randomBytes(16)).toString("hex");
}

class StreamReader {
  readonly #iter: AsyncIterator<Uint8Array>;
  constructor(stream: Stream) {
    const gen = lp.decode(stream);
    this.#iter = (gen as AsyncIterable<unknown>)[Symbol.asyncIterator]() as AsyncIterator<Uint8Array>;
  }
  async readDecoded(): Promise<Uint8Array> {
    const result = await this.#iter.next();
    if (result.done) throw new Error("stream closed");
    const v = result.value;
    return v instanceof Uint8Array ? v : (v as unknown as { slice(): Uint8Array }).slice();
  }
  async readFrame(): Promise<Record<string, unknown>> {
    const bytes = await this.readDecoded();
    return decode(bytes instanceof Uint8Array ? bytes : Buffer.from(bytes)) as Record<string, unknown>;
  }
  async readFrameWithTimeout(ms: number): Promise<Record<string, unknown>> {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`readFrame timeout after ${ms}ms`)), ms),
    );
    return Promise.race([this.readFrame(), timeout]);
  }
}

function sendFrame(stream: Stream, bytes: Uint8Array): void {
  stream.send(lp.encode.single(bytes));
}

function makeRelay(): RelayAdapter {
  return {
    async recordAssignment(_: RelaySessionAssignment) { return { ok: true as const }; },
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
  dirMultiaddrs: string[],
): Promise<{ stream: Stream; reader: StreamReader; pubkeyHex: string }> {
  if (dirMultiaddrs.length > 0) {
    try { await clientNode.dial(dirMultiaddrs[0]!); } catch { /* already connected */ }
  }
  const stream = await clientNode.newStream(dirPeerId, SIGNALING_PROTOCOL_ID);
  const reader = new StreamReader(stream);
  const challengeFrame = await reader.readFrame();
  expect(challengeFrame["type"]).toBe("signaling_auth_challenge");
  const nonce = challengeFrame["nonce"] as Uint8Array;

  // TBS = SHA-256(domain || nonce || pubkey) — matches the directory's verification logic
  const pubkey = await keyProvider.getPublicKey();
  const domainBytes = Buffer.from(AUTH_DOMAIN, "utf8");
  const authMsg = new Uint8Array(Buffer.concat([domainBytes, Buffer.from(nonce), Buffer.from(pubkey)]));
  const msgHash = new Uint8Array(createHash("sha256").update(authMsg).digest());
  const sig = await keyProvider.sign(msgHash);

  const pubkeyHex = Buffer.from(pubkey).toString("hex");
  sendFrame(stream, CBOR_ENC.encode({
    type: "signaling_auth_response",
    pubkey: new Uint8Array(pubkey),
    signature: new Uint8Array(sig),
  }));
  const authOk = await reader.readFrameWithTimeout(5000);
  expect(authOk["type"]).toBe("signaling_auth_ok");
  return { stream, reader, pubkeyHex };
}

async function doRegister(
  stream: Stream,
  reader: StreamReader,
  clientNode: Awaited<ReturnType<typeof createNode>>,
  dirPeerId: string,
  dirMultiaddrs: string[],
  pubkeyHex: string,
  mlDsa: Awaited<ReturnType<typeof mlDsaKeygen>>,
  phoneStub: string,
): Promise<{ primaryPubkeyHex: string }> {
  sendFrame(stream, CBOR_ENC.encode({
    type: "register_request",
    phone_stub: phoneStub,
    k_local_pubkey: pubkeyHex,
    ml_dsa_pubkey: Buffer.from(await mlDsa.getPublicKey()).toString("hex"),
  }));

  const dkgReadyFrame = await reader.readFrameWithTimeout(10000);
  if (dkgReadyFrame["type"] !== "dkg_ready") {
    throw new Error(`Expected dkg_ready, got ${String(dkgReadyFrame["type"])}`);
  }

  const netDirNode = new NetworkDirectoryNode({
    id: dirPeerId,
    node: clientNode,
    directoryPeerId: dirPeerId,
    directoryMultiaddrs: dirMultiaddrs,
  });
  const dkgResult = await runNetworkDkg(Buffer.from(pubkeyHex, "hex"), {
    threshold: dkgReadyFrame["threshold"] as number,
    participants: dkgReadyFrame["participants"] as number,
    directoryNodes: [netDirNode],
  });
  const primaryPubkeyHex = Buffer.from(dkgResult.primaryPubkey).toString("hex");
  sendFrame(stream, CBOR_ENC.encode({ type: "dkg_complete", primary_pubkey: primaryPubkeyHex }));
  const successFrame = await reader.readFrameWithTimeout(10000);
  expect(successFrame["type"]).toBe("register_success");
  return { primaryPubkeyHex };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("TEST-RECONNECT-002: already_registered frame includes profile fields", () => {
  let scope: ReturnType<typeof createTestScope>;
  beforeEach(() => { scope = createTestScope(); });
  afterEach(() => scope.run(async () => {}));

  it("directory includes agent_id, primary_pubkey, and ml_dsa_pubkey in already_registered frame", async () => {
    const dirKeyProvider = generateKeypair();
    const store = new InMemoryDirectoryStore();
    const { node: dirNode, stop } = await createDirectoryNode({
      keyProvider: dirKeyProvider,
      relay: makeRelay(),
      relayEndpoint: { peer_id: "relay-peer-id", multiaddrs: [] },
      store,
      requireRegistration: true,
    });
    scope.addCleanup(async () => { try { await stop(); } catch {} });

    const kp = generateKeypair();

    // Session 1: register agent (simulates the first Claude session)
    const node1 = await createNode({ keyProvider: kp, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await node1.start();
    scope.addCleanup(() => node1.stop());

    const mlDsa1 = await mlDsaKeygen();
    const { stream: s1, reader: r1, pubkeyHex } = await doAuth(
      node1, dirNode.getPeerId(), kp, dirNode.listenAddresses(),
    );
    const { primaryPubkeyHex } = await doRegister(
      s1, r1, node1, dirNode.getPeerId(), dirNode.listenAddresses(),
      pubkeyHex, mlDsa1, "phone-002",
    );
    // Stop node1 — simulates the first Claude session ending
    await node1.stop();
    scope.addCleanup(() => {}); // node1 already stopped

    // Session 2: fresh libp2p node with the same key (simulates new Claude session / fresh MCP start)
    const node2 = await createNode({ keyProvider: kp, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await node2.start();
    scope.addCleanup(() => node2.stop());

    const { stream: s2, reader: r2, pubkeyHex: pubkeyHex2 } = await doAuth(
      node2, dirNode.getPeerId(), kp, dirNode.listenAddresses(),
    );

    // Send register_request — should return already_registered WITH profile data
    const mlDsa2 = await mlDsaKeygen();
    sendFrame(s2, CBOR_ENC.encode({
      type: "register_request",
      phone_stub: "phone-002",
      k_local_pubkey: pubkeyHex2,
      ml_dsa_pubkey: Buffer.from(await mlDsa2.getPublicKey()).toString("hex"),
    }));

    const errorFrame = await r2.readFrameWithTimeout(5000);

    expect(errorFrame["type"]).toBe("register_error");
    expect(errorFrame["reason"]).toBe("already_registered");
    expect(errorFrame["agent_id"], "must include agent_id for client RegistrationState reconstruction").toBeTruthy();
    expect(typeof errorFrame["agent_id"]).toBe("string");
    expect(errorFrame["primary_pubkey"], "must include primary_pubkey").toBe(primaryPubkeyHex);
    expect(errorFrame["ml_dsa_pubkey"], "must include ml_dsa_pubkey").toBeTruthy();

    await s2.close();
  });
});

describe("TEST-RECONNECT-003: already_connected frame includes connection_id", () => {
  let scope: ReturnType<typeof createTestScope>;
  beforeEach(() => { scope = createTestScope(); });
  afterEach(() => scope.run(async () => {}));

  it("directory includes the existing connection_id in already_connected frame", async () => {
    const dirKeyProvider = generateKeypair();
    const store = new InMemoryDirectoryStore();
    const { node: dirNode, stop } = await createDirectoryNode({
      keyProvider: dirKeyProvider,
      relay: makeRelay(),
      relayEndpoint: { peer_id: "relay-peer-id", multiaddrs: [] },
      store,
      requireRegistration: true,
    });
    scope.addCleanup(async () => { try { await stop(); } catch {} });

    const kpA = generateKeypair();
    const kpB = generateKeypair();

    const mlDsaA = await mlDsaKeygen();
    const mlDsaB = await mlDsaKeygen();

    // Register A (session 1 — simulates first Claude session for Agent A)
    const nodeA1 = await createNode({ keyProvider: kpA, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await nodeA1.start();
    const { stream: sA, reader: rA, pubkeyHex: pubkeyA } = await doAuth(
      nodeA1, dirNode.getPeerId(), kpA, dirNode.listenAddresses(),
    );
    await doRegister(sA, rA, nodeA1, dirNode.getPeerId(), dirNode.listenAddresses(), pubkeyA, mlDsaA, "phone-A-003");
    await nodeA1.stop(); // first session ends

    // Register B (any session)
    const nodeB = await createNode({ keyProvider: kpB, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await nodeB.start();
    scope.addCleanup(() => nodeB.stop());
    const { stream: sB, reader: rB, pubkeyHex: pubkeyB } = await doAuth(
      nodeB, dirNode.getPeerId(), kpB, dirNode.listenAddresses(),
    );
    await doRegister(sB, rB, nodeB, dirNode.getPeerId(), dirNode.listenAddresses(), pubkeyB, mlDsaB, "phone-B-003");
    await sB.close();

    // Inject an existing connection (simulating a persisted Postgres row from a prior session)
    const existingConnectionId = makeHexId();
    await store.createConnection(existingConnectionId, pubkeyA, pubkeyB, Date.now(), "test-corr");

    // Agent A reconnects in a new session — fresh libp2p node, same key
    const nodeA2 = await createNode({ keyProvider: kpA, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await nodeA2.start();
    scope.addCleanup(() => nodeA2.stop());
    const { stream: sA2, reader: rA2 } = await doAuth(
      nodeA2, dirNode.getPeerId(), kpA, dirNode.listenAddresses(),
    );

    // Announce peer info
    sendFrame(sA2, CBOR_ENC.encode({
      type: "peer_info_announce",
      peer_id: nodeA2.getPeerId(),
      multiaddrs: nodeA2.listenAddresses(),
    }));

    // connection_request — should trigger already_connected
    sendFrame(sA2, CBOR_ENC.encode({
      type: "connection_request",
      target_pubkey: pubkeyB,
      package_cbor: new Uint8Array(4),
    }));

    const errorFrame = await rA2.readFrameWithTimeout(5000);

    expect(errorFrame["type"]).toBe("connection_request_error");
    expect(errorFrame["reason"]).toBe("already_connected");
    expect(
      errorFrame["connection_id"],
      "already_connected must include the existing connection_id for client hydration",
    ).toBe(existingConnectionId);

    await sA2.close();
  });
});
