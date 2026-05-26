/**
 * CELLO-REG-001: Agent Registration and FROST DKG — directory-side tests
 *
 * TDD Phase R — RED-first. Written BEFORE implementation.
 * All new tests MUST FAIL until implementation is complete.
 *
 * Covers (directory side):
 *   AC-001: Full registration flow — auth + register_request + DKG + dkg_complete → register_success
 *   AC-002: Same pubkey registers again → already_registered; DKG not initiated
 *   AC-003: Same phone stub from different agent → phone_already_claimed; no DKG for B
 *   AC-004: Empty phone_stub → invalid_verification; no DKG
 *   AC-005: AgentProfile shape — phone_stub_hash is 32-byte SHA-256; ml_dsa_pubkey is 1312 bytes
 *   AC-007: Below-threshold DKG (< threshold directory nodes) → dkg_failed; no profile
 *   AC-009: Unregistered client auth'd → connection_request/session_request → not_registered
 *   SI-001: Directory never stores raw phone_stub; only SHA-256(phone_stub) persisted
 *   SI-002: No profile without successful FROST DKG
 *   SI-003: FROST DKG shares never appear in wire messages or profiles
 *   SI-004: register_request before auth → not_authenticated
 *
 * NOTE: AC-006 (DKG over real libp2p streams, separate libp2p instances) is in:
 *   packages/client/src/__tests__/e2e-reg-001-dkg-network.test.ts
 * NOTE: AC-008, AC-010 are in the client-side registration tests.
 *
 * In NODE_ENV=test, createInProcessStubs is used for DKG (bootstrapKeyShares path).
 * Crypto refs: RFC 9591 (FROST), NIST FIPS 204 (ML-DSA), FIPS 180-4 (SHA-256)
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
import { Encoder } from "cbor-x";
import * as lp from "it-length-prefixed";
import {
  generateKeypair,
  mlDsaKeygen,
} from "@cello-protocol/crypto";
import { createNode } from "@cello-protocol/transport";
import type { Stream } from "@libp2p/interface";
import {
  createDirectoryNode,
  SIGNALING_PROTOCOL_ID,
} from "../directory-node.js";
import type { RelayAdapter } from "../directory-node.js";
import type { RelaySessionAssignment } from "../directory-types.js";
import { NetworkDirectoryNode, runNetworkDkg } from "@cello-protocol/client";

setupV3Tests();

const CBOR_ENC = new Encoder({ tagUint8Array: false });
const AUTH_DOMAIN = "CELLO-DIR-AUTH-v1";

// ─── StreamReader ─────────────────────────────────────────────────────────────

class StreamReader {
  readonly #iter: AsyncIterator<Uint8Array>;

  constructor(stream: Stream) {
    const gen = lp.decode(stream);
    this.#iter = (gen as AsyncIterable<unknown>)[Symbol.asyncIterator]() as AsyncIterator<Uint8Array>;
  }

  async readDecoded(): Promise<Uint8Array> {
    const result = await this.#iter.next();
    if (result.done) throw new Error("stream closed");
    const value = result.value;
    return value instanceof Uint8Array ? value : (value as unknown as { slice(): Uint8Array }).slice();
  }

  async readFrame(): Promise<Record<string, unknown>> {
    const bytes = await this.readDecoded();
    const { decode } = await import("cbor-x");
    return decode(bytes) as Record<string, unknown>;
  }

  async readFrameWithTimeout(ms = 5000): Promise<Record<string, unknown>> {
    return Promise.race([
      this.readFrame(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms),
      ),
    ]);
  }
}

// ─── Auth helpers ─────────────────────────────────────────────────────────────

async function signAuth(nonce: Uint8Array, keyProvider: ReturnType<typeof generateKeypair>): Promise<{ pubkey: Uint8Array; signature: Uint8Array }> {
  const pubkey = await keyProvider.getPublicKey();
  const domainBytes = Buffer.from(AUTH_DOMAIN, "utf8");
  const authMsg = new Uint8Array(Buffer.concat([domainBytes, nonce, pubkey]));
  const msgHash = new Uint8Array(createHash("sha256").update(authMsg).digest());
  const signature = await keyProvider.sign(msgHash);
  return { pubkey: new Uint8Array(pubkey), signature: new Uint8Array(signature) };
}

function sendFrame(stream: Stream, bytes: Uint8Array): void {
  stream.send(lp.encode.single(bytes));
}

// ─── Relay stub ───────────────────────────────────────────────────────────────

function makeRelay(): RelayAdapter {
  return {
    async recordAssignment(_: RelaySessionAssignment) { return { ok: true as const }; },
    async discardSession() {},
    async submitForSeal() { return { ok: false as const, reason: "not_supported" }; },
    async confirmSeal() {},
    async rejectSeal() {},
  };
}

// ─── Full auth helper: authenticates a signaling stream and returns the reader ─

async function doAuth(
  clientNode: Awaited<ReturnType<typeof createNode>>,
  dirPeerId: string,
  keyProvider: ReturnType<typeof generateKeypair>,
): Promise<{ stream: Stream; reader: StreamReader }> {
  const stream = await clientNode.newStream(dirPeerId, SIGNALING_PROTOCOL_ID);
  const reader = new StreamReader(stream);

  // 1. Read auth challenge
  const challengeFrame = await reader.readFrame();
  expect(challengeFrame["type"]).toBe("signaling_auth_challenge");
  const nonce = challengeFrame["nonce"] as Uint8Array;

  // 2. Send auth response
  const { pubkey, signature } = await signAuth(nonce, keyProvider);
  sendFrame(stream, CBOR_ENC.encode({ type: "signaling_auth_response", pubkey, signature }));

  // 3. Expect signaling_auth_ok
  const authOk = await reader.readFrame();
  expect(authOk["type"]).toBe("signaling_auth_ok");

  return { stream, reader };
}

// ─── Registration helper: handles DKG flow ────────────────────────────────────

/**
 * Complete the full registration flow:
 *   1. Send register_request on an already-auth'd stream
 *   2. Read dkg_ready from the directory
 *   3. Run the real FROST DKG (3 rounds) over /cello/frost/1.0.0 streams
 *   4. Send dkg_complete with the agreed primary_pubkey
 *   5. Return the register_success or register_error frame
 */
async function doRegister(
  stream: Stream,
  reader: StreamReader,
  clientNode: Awaited<ReturnType<typeof createNode>>,
  dirPeerId: string,
  dirMultiaddrs: string[],
  clientPubkeyHex: string,
  mlDsaPubkeyHex: string,
  phoneStub: string,
): Promise<Record<string, unknown>> {
  sendFrame(stream, CBOR_ENC.encode({
    type: "register_request",
    phone_stub: phoneStub,
    k_local_pubkey: clientPubkeyHex,
    ml_dsa_pubkey: mlDsaPubkeyHex,
  }));

  // Read dkg_ready from directory
  const dkgReadyFrame = await reader.readFrameWithTimeout(10000);
  if (dkgReadyFrame["type"] !== "dkg_ready") {
    return dkgReadyFrame; // register_error or unexpected frame
  }

  // Run FROST DKG over /cello/frost/1.0.0 streams
  const dirNode = new NetworkDirectoryNode({
    id: dirPeerId,
    node: clientNode,
    directoryPeerId: dirPeerId,
    directoryMultiaddrs: dirMultiaddrs,
  });
  const clientPubkeyBytes = Buffer.from(clientPubkeyHex, "hex");
  const dkgResult = await runNetworkDkg(clientPubkeyBytes, {
    threshold: dkgReadyFrame["threshold"] as number,
    participants: dkgReadyFrame["participants"] as number,
    directoryNodes: [dirNode],
    preAuthToken: "DEV-test-token",
  });
  const primaryPubkeyHex = Buffer.from(dkgResult.primaryPubkey).toString("hex");

  // Send dkg_complete
  sendFrame(stream, CBOR_ENC.encode({
    type: "dkg_complete",
    primary_pubkey: primaryPubkeyHex,
  }));

  // Return register_success or register_error
  return reader.readFrameWithTimeout(10000);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("REG-001: Directory registration", () => {
  let scope: ReturnType<typeof createTestScope>;

  beforeEach(() => {
    scope = createTestScope();
  });

  afterEach(() => scope.run(async () => {}));

  it("AC-001: full registration flow — auth + register_request + DKG → register_success", async () => {
    // Setup: directory node and client node
    const dirKey = generateKeypair();
    const { directory, node: dirNode, stop: stopDir } = await createDirectoryNode({
      keyProvider: dirKey,
      relay: makeRelay(),
      relayEndpoint: { peer_id: "12D3KooWFakeRelay", multiaddrs: ["/ip4/127.0.0.1/tcp/19999"] },
    });
    scope.addCleanup(stopDir);

    const clientKey = generateKeypair();
    const clientNode = await createNode({ keyProvider: clientKey, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await clientNode.start();
    scope.addCleanup(() => clientNode.stop());

    // Dial the directory
    await clientNode.dial(dirNode.listenAddresses()[0]!);

    // Authenticate
    const { stream, reader } = await doAuth(clientNode, dirNode.getPeerId(), clientKey);

    // Generate ML-DSA keypair
    const mlDsaProvider = await mlDsaKeygen();
    const mlDsaPubkey = await mlDsaProvider.getPublicKey();
    const clientPubkey = await clientKey.getPublicKey();

    const clientPubkeyHex = Buffer.from(clientPubkey).toString("hex");
    const mlDsaPubkeyHex = Buffer.from(mlDsaPubkey).toString("hex");

    // Full registration flow: register_request → dkg_ready → DKG rounds → dkg_complete → register_success
    const successFrame = await doRegister(
      stream, reader, clientNode, dirNode.getPeerId(), dirNode.listenAddresses(),
      clientPubkeyHex, mlDsaPubkeyHex, "+1234567890",
    );
    expect(successFrame["type"]).toBe("register_success");
    expect(typeof successFrame["agent_id"]).toBe("string");
    expect((successFrame["agent_id"] as string).length).toBe(32); // 16 bytes hex
    expect(typeof successFrame["primary_pubkey"]).toBe("string");
    expect((successFrame["primary_pubkey"] as string).length).toBe(64); // 32 bytes hex

    // Verify profile was stored
    const profileKey = clientPubkeyHex;
    expect(directory.hasProfile(profileKey)).toBe(true);
    const profile = directory.getProfile(profileKey);
    expect(profile).toBeDefined();
    expect(profile!.status).toBe("active");
    expect(profile!.ml_dsa_pubkey).toBe(mlDsaPubkeyHex);
  });

  it("AC-002: same pubkey registers again → already_registered; DKG not initiated; existing profile unchanged", async () => {
    const dirKey = generateKeypair();
    const { directory, node: dirNode, stop: stopDir } = await createDirectoryNode({
      keyProvider: dirKey,
      relay: makeRelay(),
      relayEndpoint: { peer_id: "12D3KooWFakeRelay", multiaddrs: ["/ip4/127.0.0.1/tcp/19999"] },
    });
    scope.addCleanup(stopDir);

    const clientKey = generateKeypair();
    const clientNode = await createNode({ keyProvider: clientKey, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await clientNode.start();
    scope.addCleanup(() => clientNode.stop());

    await clientNode.dial(dirNode.listenAddresses()[0]!);

    // First registration — should succeed
    const { stream: stream1, reader: reader1 } = await doAuth(clientNode, dirNode.getPeerId(), clientKey);
    const mlDsaProvider = await mlDsaKeygen();
    const mlDsaPubkey = await mlDsaProvider.getPublicKey();
    const clientPubkey = await clientKey.getPublicKey();
    const clientPubkeyHex = Buffer.from(clientPubkey).toString("hex");
    const mlDsaPubkeyHex = Buffer.from(mlDsaPubkey).toString("hex");

    const successFrame = await doRegister(
      stream1, reader1, clientNode, dirNode.getPeerId(), dirNode.listenAddresses(),
      clientPubkeyHex, mlDsaPubkeyHex, "+1111111111",
    );
    expect(successFrame["type"]).toBe("register_success");
    const originalAgentId = successFrame["agent_id"];

    // Second registration attempt on a new stream (same key)
    await clientNode.dial(dirNode.listenAddresses()[0]!);
    const { stream: stream2, reader: reader2 } = await doAuth(clientNode, dirNode.getPeerId(), clientKey);

    sendFrame(stream2, CBOR_ENC.encode({
      type: "register_request",
      phone_stub: "+9999999999",
      k_local_pubkey: Buffer.from(clientPubkey).toString("hex"),
      ml_dsa_pubkey: Buffer.from(mlDsaPubkey).toString("hex"),
    }));

    const errorFrame = await reader2.readFrameWithTimeout(5000);
    expect(errorFrame["type"]).toBe("register_error");
    expect(errorFrame["reason"]).toBe("already_registered");

    // Original profile unchanged
    const profile = directory.getProfile(clientPubkeyHex);
    expect(profile!.agent_id).toBe(originalAgentId);
  });

  it("AC-003: different agent, same phone stub → phone_already_claimed; no DKG for B", async () => {
    const dirKey = generateKeypair();
    const { node: dirNode, stop: stopDir } = await createDirectoryNode({
      keyProvider: dirKey,
      relay: makeRelay(),
      relayEndpoint: { peer_id: "12D3KooWFakeRelay", multiaddrs: ["/ip4/127.0.0.1/tcp/19999"] },
    });
    scope.addCleanup(stopDir);

    const clientNodeA = await createNode({ keyProvider: generateKeypair(), listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await clientNodeA.start();
    scope.addCleanup(() => clientNodeA.stop());

    const clientNodeB = await createNode({ keyProvider: generateKeypair(), listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await clientNodeB.start();
    scope.addCleanup(() => clientNodeB.stop());

    const keyA = generateKeypair();
    const keyB = generateKeypair();

    await clientNodeA.dial(dirNode.listenAddresses()[0]!);
    await clientNodeB.dial(dirNode.listenAddresses()[0]!);

    // Agent A registers with phone +5555555555
    const { stream: streamA, reader: readerA } = await doAuth(clientNodeA, dirNode.getPeerId(), keyA);
    const mlDsaA = await mlDsaKeygen();
    const pubA = await keyA.getPublicKey();
    const pubAHex = Buffer.from(pubA).toString("hex");
    const mlDsaAHex = Buffer.from(await mlDsaA.getPublicKey()).toString("hex");

    const frameA = await doRegister(
      streamA, readerA, clientNodeA, dirNode.getPeerId(), dirNode.listenAddresses(),
      pubAHex, mlDsaAHex, "+5555555555",
    );
    expect(frameA["type"]).toBe("register_success");

    // Agent B tries same phone stub
    const { stream: streamB, reader: readerB } = await doAuth(clientNodeB, dirNode.getPeerId(), keyB);
    const mlDsaB = await mlDsaKeygen();
    const pubB = await keyB.getPublicKey();

    sendFrame(streamB, CBOR_ENC.encode({
      type: "register_request",
      phone_stub: "+5555555555",
      k_local_pubkey: Buffer.from(pubB).toString("hex"),
      ml_dsa_pubkey: Buffer.from(await mlDsaB.getPublicKey()).toString("hex"),
    }));

    const frameB = await readerB.readFrameWithTimeout(5000);
    expect(frameB["type"]).toBe("register_error");
    expect(frameB["reason"]).toBe("phone_already_claimed");
  });

  it("AC-004: empty phone_stub → invalid_verification; no DKG", async () => {
    const dirKey = generateKeypair();
    const { node: dirNode, stop: stopDir } = await createDirectoryNode({
      keyProvider: dirKey,
      relay: makeRelay(),
      relayEndpoint: { peer_id: "12D3KooWFakeRelay", multiaddrs: ["/ip4/127.0.0.1/tcp/19999"] },
    });
    scope.addCleanup(stopDir);

    const clientKey = generateKeypair();
    const clientNode = await createNode({ keyProvider: clientKey, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await clientNode.start();
    scope.addCleanup(() => clientNode.stop());

    await clientNode.dial(dirNode.listenAddresses()[0]!);

    const { stream, reader } = await doAuth(clientNode, dirNode.getPeerId(), clientKey);
    const mlDsa = await mlDsaKeygen();
    const pub = await clientKey.getPublicKey();

    sendFrame(stream, CBOR_ENC.encode({
      type: "register_request",
      phone_stub: "",
      k_local_pubkey: Buffer.from(pub).toString("hex"),
      ml_dsa_pubkey: Buffer.from(await mlDsa.getPublicKey()).toString("hex"),
    }));

    const frame = await reader.readFrameWithTimeout(5000);
    expect(frame["type"]).toBe("register_error");
    expect(frame["reason"]).toBe("invalid_verification");
  });

  it("AC-005: profile shape — phone_stub_hash is 32-byte SHA-256; ml_dsa_pubkey is 1312 bytes", async () => {
    const dirKey = generateKeypair();
    const { directory, node: dirNode, stop: stopDir } = await createDirectoryNode({
      keyProvider: dirKey,
      relay: makeRelay(),
      relayEndpoint: { peer_id: "12D3KooWFakeRelay", multiaddrs: ["/ip4/127.0.0.1/tcp/19999"] },
    });
    scope.addCleanup(stopDir);

    const clientKey = generateKeypair();
    const clientNode = await createNode({ keyProvider: clientKey, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await clientNode.start();
    scope.addCleanup(() => clientNode.stop());

    await clientNode.dial(dirNode.listenAddresses()[0]!);

    const { stream, reader } = await doAuth(clientNode, dirNode.getPeerId(), clientKey);
    const mlDsaProvider = await mlDsaKeygen();
    const mlDsaPubkey = await mlDsaProvider.getPublicKey();
    const clientPubkey = await clientKey.getPublicKey();
    const clientPubkeyHex = Buffer.from(clientPubkey).toString("hex");
    const mlDsaPubkeyHex = Buffer.from(mlDsaPubkey).toString("hex");
    const PHONE = "+1234567890";

    const successFrame = await doRegister(
      stream, reader, clientNode, dirNode.getPeerId(), dirNode.listenAddresses(),
      clientPubkeyHex, mlDsaPubkeyHex, PHONE,
    );
    expect(successFrame["type"]).toBe("register_success");

    const profileKey = clientPubkeyHex;
    const profile = directory.getProfile(profileKey)!;

    // phone_stub_hash must be hex-encoded 32-byte SHA-256 (SI-001: raw phone never stored)
    expect(profile.phone_stub_hash).toBe(
      createHash("sha256").update(PHONE, "utf8").digest("hex"),
    );
    expect(Buffer.from(profile.phone_stub_hash, "hex").length).toBe(32);

    // ml_dsa_pubkey must be 1312 bytes (FIPS 204, ML-DSA-44)
    expect(Buffer.from(profile.ml_dsa_pubkey, "hex").length).toBe(1312);

    // Other required fields
    expect(profile.k_local_pubkey).toBe(clientPubkeyHex);
    expect(typeof profile.primary_pubkey).toBe("string");
    expect(Buffer.from(profile.primary_pubkey, "hex").length).toBe(32);
    expect(profile.status).toBe("active");
    expect(typeof profile.registered_at).toBe("number");
    expect(profile.profile).toEqual({});
    expect(typeof profile.agent_id).toBe("string");
    expect(Buffer.from(profile.agent_id, "hex").length).toBe(16);

    // SI-001: Ensure phone_stub raw value is NOT in the profile object
    const profileStr = JSON.stringify(profile);
    expect(profileStr).not.toContain(PHONE);
  });

  it("AC-007: below-threshold DKG → dkg_failed; no profile created", async () => {
    const dirKey = generateKeypair();
    const { directory, node: dirNode, stop: stopDir } = await createDirectoryNode({
      keyProvider: dirKey,
      relay: makeRelay(),
      relayEndpoint: { peer_id: "12D3KooWFakeRelay", multiaddrs: ["/ip4/127.0.0.1/tcp/19999"] },
      // Force DKG failure by injecting a below-threshold test flag
      forceDkgFailure: true,
    });
    scope.addCleanup(stopDir);

    const clientKey = generateKeypair();
    const clientNode = await createNode({ keyProvider: clientKey, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await clientNode.start();
    scope.addCleanup(() => clientNode.stop());

    await clientNode.dial(dirNode.listenAddresses()[0]!);

    const { stream, reader } = await doAuth(clientNode, dirNode.getPeerId(), clientKey);
    const mlDsa = await mlDsaKeygen();
    const pub = await clientKey.getPublicKey();

    sendFrame(stream, CBOR_ENC.encode({
      type: "register_request",
      phone_stub: "+7777777777",
      k_local_pubkey: Buffer.from(pub).toString("hex"),
      ml_dsa_pubkey: Buffer.from(await mlDsa.getPublicKey()).toString("hex"),
    }));

    const frame = await reader.readFrameWithTimeout(10000);
    expect(frame["type"]).toBe("register_error");
    expect(frame["reason"]).toBe("dkg_failed");

    // No profile created
    expect(directory.hasProfile(Buffer.from(pub).toString("hex"))).toBe(false);
  });

  it("AC-009: unregistered authenticated client → session_request → not_registered", async () => {
    const dirKey = generateKeypair();
    const { node: dirNode, stop: stopDir } = await createDirectoryNode({
      keyProvider: dirKey,
      relay: makeRelay(),
      relayEndpoint: { peer_id: "12D3KooWFakeRelay", multiaddrs: ["/ip4/127.0.0.1/tcp/19999"] },
      requireRegistration: true,
    });
    scope.addCleanup(stopDir);

    // Two client nodes — A is registered, B is not
    const keyA = generateKeypair();
    const keyB = generateKeypair();

    const nodeA = await createNode({ keyProvider: keyA, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    const nodeB = await createNode({ keyProvider: keyB, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await nodeA.start();
    await nodeB.start();
    scope.addCleanup(() => nodeA.stop());
    scope.addCleanup(() => nodeB.stop());

    await nodeA.dial(dirNode.listenAddresses()[0]!);
    await nodeB.dial(dirNode.listenAddresses()[0]!);

    // B connects but does NOT register — just authenticates
    const { stream: streamB, reader: readerB } = await doAuth(nodeB, dirNode.getPeerId(), keyB);

    // B tries to send session_request (not registered)
    const pubA = await keyA.getPublicKey();
    sendFrame(streamB, CBOR_ENC.encode({
      type: "session_request",
      target_pubkey: pubA,
    }));

    const frame = await readerB.readFrameWithTimeout(5000);
    expect(frame["type"]).toBe("session_request_error");
    expect(frame["reason"]).toBe("not_registered");
  });

  it("SI-001: directory never stores raw phone_stub — only SHA-256 hash persisted", async () => {
    const dirKey = generateKeypair();
    const { directory, node: dirNode, stop: stopDir } = await createDirectoryNode({
      keyProvider: dirKey,
      relay: makeRelay(),
      relayEndpoint: { peer_id: "12D3KooWFakeRelay", multiaddrs: ["/ip4/127.0.0.1/tcp/19999"] },
    });
    scope.addCleanup(stopDir);

    const clientKey = generateKeypair();
    const clientNode = await createNode({ keyProvider: clientKey, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await clientNode.start();
    scope.addCleanup(() => clientNode.stop());

    await clientNode.dial(dirNode.listenAddresses()[0]!);

    const { stream, reader } = await doAuth(clientNode, dirNode.getPeerId(), clientKey);
    const mlDsa = await mlDsaKeygen();
    const pub = await clientKey.getPublicKey();
    const pubHex = Buffer.from(pub).toString("hex");
    const mlDsaHex = Buffer.from(await mlDsa.getPublicKey()).toString("hex");
    const PHONE = "+8001234567";

    const frame = await doRegister(
      stream, reader, clientNode, dirNode.getPeerId(), dirNode.listenAddresses(),
      pubHex, mlDsaHex, PHONE,
    );
    expect(frame["type"]).toBe("register_success");

    // Dump all profiles and ensure raw phone is not present anywhere
    const profile = directory.getProfile(pubHex)!;

    // Direct check: phone_stub_hash must be a hex SHA-256, not the raw phone
    expect(profile.phone_stub_hash).not.toBe(PHONE);
    const expectedHash = createHash("sha256").update(PHONE, "utf8").digest("hex");
    expect(profile.phone_stub_hash).toBe(expectedHash);

    // Serialized form check
    const serialized = JSON.stringify(profile);
    expect(serialized).not.toContain(PHONE);
  });

  it("SI-002: no profile created without successful FROST DKG", async () => {
    // This test verifies that even if register_request is processed, profile is only
    // created after DKG succeeds. We test this by checking AC-007 behavior: when DKG
    // fails, no profile exists.
    const dirKey = generateKeypair();
    const { directory, node: dirNode, stop: stopDir } = await createDirectoryNode({
      keyProvider: dirKey,
      relay: makeRelay(),
      relayEndpoint: { peer_id: "12D3KooWFakeRelay", multiaddrs: ["/ip4/127.0.0.1/tcp/19999"] },
      forceDkgFailure: true,
    });
    scope.addCleanup(stopDir);

    const clientKey = generateKeypair();
    const clientNode = await createNode({ keyProvider: clientKey, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await clientNode.start();
    scope.addCleanup(() => clientNode.stop());

    await clientNode.dial(dirNode.listenAddresses()[0]!);

    const { stream, reader } = await doAuth(clientNode, dirNode.getPeerId(), clientKey);
    const mlDsa = await mlDsaKeygen();
    const pub = await clientKey.getPublicKey();

    sendFrame(stream, CBOR_ENC.encode({
      type: "register_request",
      phone_stub: "+2223334444",
      k_local_pubkey: Buffer.from(pub).toString("hex"),
      ml_dsa_pubkey: Buffer.from(await mlDsa.getPublicKey()).toString("hex"),
    }));

    const frame = await reader.readFrameWithTimeout(10000);
    expect(frame["type"]).toBe("register_error");
    expect(frame["reason"]).toBe("dkg_failed");

    // No profile should exist — SI-002
    const pubHex = Buffer.from(pub).toString("hex");
    expect(directory.hasProfile(pubHex)).toBe(false);
    expect(directory.getProfile(pubHex)).toBeUndefined();
  });

  it("SI-003: FROST DKG shares never appear in wire messages or profile records", async () => {
    // Verify that the register_success frame and stored profile do not contain any
    // FROST share material (which would be internal to the DKG ceremony).
    const dirKey = generateKeypair();
    const { directory, node: dirNode, stop: stopDir } = await createDirectoryNode({
      keyProvider: dirKey,
      relay: makeRelay(),
      relayEndpoint: { peer_id: "12D3KooWFakeRelay", multiaddrs: ["/ip4/127.0.0.1/tcp/19999"] },
    });
    scope.addCleanup(stopDir);

    const clientKey = generateKeypair();
    const clientNode = await createNode({ keyProvider: clientKey, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await clientNode.start();
    scope.addCleanup(() => clientNode.stop());

    await clientNode.dial(dirNode.listenAddresses()[0]!);

    const { stream, reader } = await doAuth(clientNode, dirNode.getPeerId(), clientKey);
    const mlDsa = await mlDsaKeygen();
    const pub = await clientKey.getPublicKey();
    const pubHex = Buffer.from(pub).toString("hex");
    const mlDsaHex = Buffer.from(await mlDsa.getPublicKey()).toString("hex");

    const successFrame = await doRegister(
      stream, reader, clientNode, dirNode.getPeerId(), dirNode.listenAddresses(),
      pubHex, mlDsaHex, "+9001001001",
    );
    expect(successFrame["type"]).toBe("register_success");

    // The register_success frame must only contain agent_id and primary_pubkey
    const frameKeys = Object.keys(successFrame);
    expect(frameKeys).toEqual(expect.arrayContaining(["type", "agent_id", "primary_pubkey"]));
    // Must NOT contain any FROST secret share fields
    expect(frameKeys).not.toContain("secret");
    expect(frameKeys).not.toContain("signingShare");
    expect(frameKeys).not.toContain("share");
    expect(frameKeys).not.toContain("k_server");

    // Profile must not contain FROST share material
    const profile = directory.getProfile(pubHex)!;
    const profileStr = JSON.stringify(profile);
    expect(profileStr).not.toContain("signingShare");
    expect(profileStr).not.toContain('"secret"');
    expect(profileStr).not.toContain("k_server");
  });

  it("SI-004: register_request before auth → not_authenticated", async () => {
    const dirKey = generateKeypair();
    const { node: dirNode, stop: stopDir } = await createDirectoryNode({
      keyProvider: dirKey,
      relay: makeRelay(),
      relayEndpoint: { peer_id: "12D3KooWFakeRelay", multiaddrs: ["/ip4/127.0.0.1/tcp/19999"] },
    });
    scope.addCleanup(stopDir);

    const clientNode = await createNode({ keyProvider: generateKeypair(), listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await clientNode.start();
    scope.addCleanup(() => clientNode.stop());

    await clientNode.dial(dirNode.listenAddresses()[0]!);

    const stream = await clientNode.newStream(dirNode.getPeerId(), SIGNALING_PROTOCOL_ID);
    const reader = new StreamReader(stream);

    // Read but don't respond to the auth challenge — then send register_request
    await reader.readFrame(); // consume challenge

    const mlDsa = await mlDsaKeygen();
    const fakeKey = generateKeypair();
    const pub = await fakeKey.getPublicKey();

    // Send register_request WITHOUT completing auth
    sendFrame(stream, CBOR_ENC.encode({
      type: "register_request",
      phone_stub: "+3335556666",
      k_local_pubkey: Buffer.from(pub).toString("hex"),
      ml_dsa_pubkey: Buffer.from(await mlDsa.getPublicKey()).toString("hex"),
    }));

    // Directory sends not_authenticated then aborts stream — per protocol spec
    const frame = await reader.readFrameWithTimeout(5000);
    expect(frame["type"]).toBe("not_authenticated");
  });
});
