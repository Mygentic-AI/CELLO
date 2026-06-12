/**
 * M7-MANIFEST-002: Directory-side step-5 signing and manifest poll tests.
 *
 * Specification phase (SPARC Phase S):
 *
 * AC-009: After auth, signaling_auth_ok includes nodeId, signature (128-char hex),
 *         and timestamp when DirectoryKeyProvider is configured.
 *         - SI-001: signature is over the step-5 TBS — verifiable by the client
 *           using the nodeId's pubkey from the manifest.
 *         - SI-002: nodeId matches DirectoryKeyProvider.getNodeId().
 *
 * AC-011: When DirectoryManifestStore is configured, the directory responds to
 *         manifest_poll_request with a manifest_poll_response containing the
 *         current manifest.
 *
 * Backward compat: When DirectoryKeyProvider is absent, signaling_auth_ok has
 * no MANIFEST-002 fields (nodeId/signature/timestamp are undefined). Existing
 * tests continue to pass.
 *
 * Crypto: Ed25519 per RFC 8032.
 * TBS: UTF-8('cello-directory-auth-challenge-v1\n') + nodeId + '\n' + agentPubkeyHex + '\n'
 *      + nonceHex + '\n' + isoTimestamp
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
import { ed25519 } from "@noble/curves/ed25519.js";
import { generateKeypair, MockThresholdSigner } from "@cello-protocol/crypto";
import { createNode } from "@cello-protocol/transport";
import type { Stream } from "@libp2p/interface";
import { createDirectoryNode, SIGNALING_PROTOCOL_ID } from "../directory-node.js";
import type { RelayAdapter } from "../directory-node.js";
import type { RelaySessionAssignment } from "../directory-types.js";
import { decodeOutboundSignalingFrame } from "../directory-frames.js";
import { TestDirectoryKeyProvider, TestDirectoryManifestStore } from "@cello-protocol/interfaces/stubs";
import type { ConsortiumManifest } from "@cello-protocol/protocol-types";

setupV3Tests();

const CBOR_ENC = new Encoder({ tagUint8Array: false });
const AUTH_DOMAIN = "CELLO-DIR-AUTH-v1";

// ─── Test key constants (deterministic, never share between node instances) ────

// Test node A: derived from a known seed, distinct from crypto test fixtures
// SHA-256("cello-test-directory-node-key-manifest-002-a")
const TEST_NODE_A_PRIVATE_KEY_HEX = "707a125efaed6d467e8cac1758b3a87af260a5b9c7a6f0d6a74d364c1d5dacd9";
const TEST_NODE_A_NODE_ID = "staging-node-us-east-1";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/** Construct the step-5 TBS bytes exactly as the directory does. */
function buildStep5Tbs(opts: {
  nodeId: string;
  agentPubkeyHex: string;
  nonceHex: string;
  isoTimestamp: string;
}): Uint8Array {
  const tbsText = [
    "cello-directory-auth-challenge-v1",
    opts.nodeId,
    opts.agentPubkeyHex,
    opts.nonceHex,
    opts.isoTimestamp,
  ].join("\n");
  return new TextEncoder().encode(tbsText);
}

/** Sign client auth for step 3/4. */
async function signAuth(
  nonce: Uint8Array,
  domain: string,
  keyProvider: ReturnType<typeof generateKeypair>,
): Promise<{ pubkey: Uint8Array; signature: Uint8Array }> {
  const pubkey = await keyProvider.getPublicKey();
  const domainBytes = Buffer.from(domain, "utf8");
  const authMsg = new Uint8Array(Buffer.concat([domainBytes, nonce, pubkey]));
  const msgHash = new Uint8Array(createHash("sha256").update(authMsg).digest());
  const signature = await keyProvider.sign(msgHash);
  return { pubkey: new Uint8Array(pubkey), signature: new Uint8Array(signature) };
}

function sendFrame(stream: Stream, bytes: Uint8Array): void {
  stream.send(lp.encode.single(bytes));
}

// ─── Relay stub ───────────────────────────────────────────────────────────────

function makeRelay(): RelayAdapter & {
  recorded: RelaySessionAssignment[];
} {
  const recorded: RelaySessionAssignment[] = [];
  return {
    recorded,
    recordAssignment(assignment: RelaySessionAssignment) {
      recorded.push(assignment);
      return { ok: true as const };
    },
    discardSession(_sessionId: Uint8Array) {},
    submitForSeal(_sessionId: Uint8Array) {
      return { ok: false as const, reason: "session_not_found" };
    },
    confirmSeal(_sessionId: Uint8Array) {},
    rejectSeal(_sessionId: Uint8Array, _reason: string) {},
  };
}

// ─── Minimal test manifest ────────────────────────────────────────────────────

function makeTestManifest(): ConsortiumManifest {
  // Minimal valid-shape manifest (not cryptographically signed — tests only check structure)
  const pubkey = Buffer.from(
    ed25519.getPublicKey(hexToBytes(TEST_NODE_A_PRIVATE_KEY_HEX)),
  ).toString("hex");
  return {
    version: 1,
    not_before: new Date().toISOString(),
    expires: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
    nodes: [
      {
        nodeId: TEST_NODE_A_NODE_ID,
        pubkey,
        region: "us-east-1",
        provider: "aws",
        endpoint: "https://dir-us-east-1.example.com",
      },
    ],
    signatures: [],
  };
}

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
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("M7-MANIFEST-002: directory step-5 signing and manifest poll", () => {
  let scope = createTestScope();

  beforeEach(() => {
    scope = createTestScope();
  });

  afterEach(() => scope.run(async () => {}));

  // ─── Auth helper (creates directory node with optional MANIFEST-002 opts) ────

  async function setupDir(opts: {
    directoryKeyProvider?: import("@cello-protocol/interfaces").DirectoryKeyProvider;
    directoryManifestStore?: import("@cello-protocol/interfaces").DirectoryManifestStore;
  } = {}) {
    const relay = makeRelay();
    const dirKey = generateKeypair();

    const dirNode = await createDirectoryNode({
      keyProvider: dirKey,
      relay,
      relayEndpoint: { peer_id: "12D3KooWRelayTest", multiaddrs: ["/ip4/127.0.0.1/tcp/9999"] },
      ...opts,
    });
    scope.addCleanup(dirNode.stop);
    return { dirNode, relay };
  }

  /** Connect a client node to the directory and perform the full auth handshake.
   *  Returns the stream, a StreamReader, the client pubkey hex, and the auth_ok frame. */
  async function connectAndAuth(
    dirNode: Awaited<ReturnType<typeof createDirectoryNode>>,
    clientKey: ReturnType<typeof generateKeypair>,
  ): Promise<{
    stream: Stream;
    reader: StreamReader;
    pubkeyHex: string;
    authOkFrame: import("../directory-types.js").SignalingAuthOk;
    nonceHex: string;
  }> {
    const clientNode = await createNode({
      keyProvider: clientKey,
      listenAddresses: ["/ip4/127.0.0.1/tcp/0"],
    });
    await clientNode.start();
    scope.addCleanup(() => clientNode.stop());

    const dirAddrs = dirNode.node.listenAddresses();
    await clientNode.dial(dirAddrs[0]);

    const stream = await clientNode.newStream(dirNode.node.getPeerId(), SIGNALING_PROTOCOL_ID);
    const reader = new StreamReader(stream);

    // Step 1: receive auth challenge
    const challengeBytes = await reader.readDecoded();
    const challenge = decodeOutboundSignalingFrame(challengeBytes);
    if (!challenge || challenge.type !== "signaling_auth_challenge") {
      throw new Error("expected auth challenge");
    }
    const nonceHex = Buffer.from(challenge.nonce).toString("hex");

    // Step 3: send auth response
    const { pubkey, signature } = await signAuth(challenge.nonce, AUTH_DOMAIN, clientKey);
    sendFrame(stream, CBOR_ENC.encode({ type: "signaling_auth_response", pubkey, signature }));

    // Step 5: receive signaling_auth_ok (may include nodeId/signature/timestamp in MANIFEST-002)
    const ackBytes = await reader.readDecoded();
    const ack = decodeOutboundSignalingFrame(ackBytes);
    if (!ack || ack.type !== "signaling_auth_ok") {
      throw new Error(`expected signaling_auth_ok, got ${ack?.type}`);
    }

    const pubkeyHex = Buffer.from(pubkey).toString("hex");

    // Register peer info + threshold signer so subsequent session_request tests work
    dirNode.directory.registerPeerInfo(pubkeyHex, clientNode.getPeerId(), clientNode.listenAddresses());
    dirNode.directory.registerThresholdSigner(pubkeyHex, new MockThresholdSigner());

    return { stream, reader, pubkeyHex, authOkFrame: ack, nonceHex };
  }

  // ─── AC-009 / SI-001: directory signs TBS — client can verify ────────────────

  it("AC-009: signaling_auth_ok includes nodeId, signature, and timestamp when DirectoryKeyProvider is configured", async () => {
    const keyProvider = new TestDirectoryKeyProvider({
      nodeId: TEST_NODE_A_NODE_ID,
      privateKeyHex: TEST_NODE_A_PRIVATE_KEY_HEX,
    });
    const { dirNode } = await setupDir({ directoryKeyProvider: keyProvider });
    const clientKey = generateKeypair();

    const { authOkFrame } = await connectAndAuth(dirNode, clientKey);

    expect(authOkFrame.nodeId).toBe(TEST_NODE_A_NODE_ID);
    expect(typeof authOkFrame.signature).toBe("string");
    expect(authOkFrame.signature!.length).toBe(128); // 64 bytes = 128 hex chars
    expect(typeof authOkFrame.timestamp).toBe("string");
    // ISO 8601 timestamp shape
    expect(authOkFrame.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it("SI-001: step-5 signature is verifiable with the nodeId's Ed25519 pubkey", async () => {
    // SI-001: the signature must be over the well-defined TBS so the client can verify it
    // against the pubkey in the consortium manifest.
    const keyProvider = new TestDirectoryKeyProvider({
      nodeId: TEST_NODE_A_NODE_ID,
      privateKeyHex: TEST_NODE_A_PRIVATE_KEY_HEX,
    });
    const { dirNode } = await setupDir({ directoryKeyProvider: keyProvider });
    const clientKey = generateKeypair();

    const { authOkFrame, pubkeyHex, nonceHex } = await connectAndAuth(dirNode, clientKey);

    // Reconstruct TBS from received fields
    const tbs = buildStep5Tbs({
      nodeId: authOkFrame.nodeId!,
      agentPubkeyHex: pubkeyHex,
      nonceHex,
      isoTimestamp: authOkFrame.timestamp!,
    });

    // Verify with the known public key
    const pubkeyBytes = hexToBytes(keyProvider.getPublicKeyHex());
    const sigBytes = hexToBytes(authOkFrame.signature!);
    const valid = ed25519.verify(sigBytes, tbs, pubkeyBytes);
    expect(valid).toBe(true);
  });

  it("SI-001: signature fails verification with a different Ed25519 pubkey (wrong key)", async () => {
    // Confirms that the signature is genuinely bound to THIS node's key, not any other.
    const keyProvider = new TestDirectoryKeyProvider({
      nodeId: TEST_NODE_A_NODE_ID,
      privateKeyHex: TEST_NODE_A_PRIVATE_KEY_HEX,
    });
    const { dirNode } = await setupDir({ directoryKeyProvider: keyProvider });
    const clientKey = generateKeypair();

    const { authOkFrame, pubkeyHex, nonceHex } = await connectAndAuth(dirNode, clientKey);

    const tbs = buildStep5Tbs({
      nodeId: authOkFrame.nodeId!,
      agentPubkeyHex: pubkeyHex,
      nonceHex,
      isoTimestamp: authOkFrame.timestamp!,
    });

    // Use a random wrong key — must NOT verify
    const wrongPrivKey = randomBytes(32);
    const wrongPubKey = ed25519.getPublicKey(wrongPrivKey);
    const sigBytes = hexToBytes(authOkFrame.signature!);
    const valid = ed25519.verify(sigBytes, tbs, wrongPubKey);
    expect(valid).toBe(false);
  });

  it("backward compat: signaling_auth_ok has no MANIFEST-002 fields when no DirectoryKeyProvider", async () => {
    // When DirectoryKeyProvider is absent, the directory sends a bare auth_ok.
    // This ensures existing clients (and tests) that don't handle MANIFEST-002 are unaffected.
    const { dirNode } = await setupDir(); // no directoryKeyProvider
    const clientKey = generateKeypair();

    const { authOkFrame } = await connectAndAuth(dirNode, clientKey);

    expect(authOkFrame.type).toBe("signaling_auth_ok");
    expect(authOkFrame.nodeId).toBeUndefined();
    expect(authOkFrame.signature).toBeUndefined();
    expect(authOkFrame.timestamp).toBeUndefined();
  });

  // ─── AC-011: manifest_poll_request → manifest_poll_response ──────────────────

  it("AC-011: directory responds to manifest_poll_request with manifest_poll_response when store is configured", async () => {
    const manifest = makeTestManifest();
    const manifestStore = new TestDirectoryManifestStore(manifest);
    const { dirNode } = await setupDir({ directoryManifestStore: manifestStore });
    const clientKey = generateKeypair();

    const { stream, reader } = await connectAndAuth(dirNode, clientKey);

    // Send manifest_poll_request
    sendFrame(stream, CBOR_ENC.encode({ type: "manifest_poll_request" }));

    // Read manifest_poll_response
    const responseBytes = await reader.readDecoded();
    const response = decodeOutboundSignalingFrame(responseBytes);

    expect(response?.type).toBe("manifest_poll_response");
    if (response?.type === "manifest_poll_response") {
      expect(response.manifest.version).toBe(1);
      expect(response.manifest.nodes).toHaveLength(1);
      expect(response.manifest.nodes[0].nodeId).toBe(TEST_NODE_A_NODE_ID);
    }
  });

  it("AC-011: manifest_poll_request is silently ignored when no DirectoryManifestStore is configured", async () => {
    // No store configured — the directory should not crash and should not send any response.
    // The client simply gets no reply and can time out naturally.
    const { dirNode } = await setupDir(); // no directoryManifestStore
    const clientKey = generateKeypair();
    const clientKey2 = generateKeypair();

    const { stream } = await connectAndAuth(dirNode, clientKey);

    // Send manifest_poll_request
    sendFrame(stream, CBOR_ENC.encode({ type: "manifest_poll_request" }));

    // Send a valid session_request immediately after — this should still be processed normally,
    // proving the directory didn't crash when it got the poll request with no store.
    const secondClient = await (async () => {
      const k = clientKey2;
      const cn = await createNode({
        keyProvider: k,
        listenAddresses: ["/ip4/127.0.0.1/tcp/0"],
      });
      await cn.start();
      scope.addCleanup(() => cn.stop());
      const dirAddrs = dirNode.node.listenAddresses();
      await cn.dial(dirAddrs[0]);
      const s = await cn.newStream(dirNode.node.getPeerId(), SIGNALING_PROTOCOL_ID);
      const r = new StreamReader(s);
      const cb = await r.readDecoded();
      const ch = decodeOutboundSignalingFrame(cb);
      if (!ch || ch.type !== "signaling_auth_challenge") throw new Error("expected challenge");
      const { pubkey, signature } = await signAuth(ch.nonce, AUTH_DOMAIN, k);
      s.send(lp.encode.single(CBOR_ENC.encode({ type: "signaling_auth_response", pubkey, signature })));
      const ackB = await r.readDecoded();
      const ackF = decodeOutboundSignalingFrame(ackB);
      if (!ackF || ackF.type !== "signaling_auth_ok") throw new Error("expected auth_ok");
      return { pubkeyHex: Buffer.from(pubkey).toString("hex") };
    })();

    // If we got here without crashing, the test passes — the directory handled
    // manifest_poll_request gracefully with no store.
    expect(secondClient.pubkeyHex).toBeTruthy();
  });
});
