/**
 * CELLO-SESSION-004: FROST-authenticated session establishment — directory-side tests
 *
 * TDD Phase R — RED-first. Written BEFORE implementation.
 * All new tests MUST FAIL until directory-node.ts SESSION-004 implementation is complete.
 *
 * Covers:
 *   AC-002 (directory side): frost_signer_not_configured when no IThresholdSigner registered
 *   AC-004 (directory side): directory_below_threshold when FROST ceremony fails
 *   AC-005: CEREMONY_CONFLICT — second session_request for same initiator when one is in-flight
 *   Integration: Full FROST-signed assignment delivered via real signaling stream
 *
 * Crypto refs: FROST / RFC 9591, Ed25519 / RFC 8032, SHA-256 / FIPS 180-4, CBOR / RFC 8949
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
import { decode, Encoder } from "cbor-x";
import * as lp from "it-length-prefixed";
import { createHash } from "node:crypto";
import {
  FrostThresholdSigner,
  generateKeypair,
} from "@cello/crypto";
import {
  bootstrapKeyShares,
  clearTestShares,
} from "@cello/crypto/frost/frost-threshold-signer.js";
import { createInProcessStubs } from "@cello/crypto/frost/stubs.js";
import { createNode } from "@cello/transport";
import type { Stream } from "@libp2p/interface";
import {
  createDirectoryNode,
  SIGNALING_PROTOCOL_ID,
} from "../directory-node.js";
import type { RelayAdapter } from "../directory-node.js";
import type { RelaySessionAssignment } from "../directory-types.js";

setupV3Tests();

const CBOR_ENC = new Encoder({ tagUint8Array: false });
const AUTH_DOMAIN = "CELLO-DIR-AUTH-v1";

// ─── Helpers ──────────────────────────────────────────────────────────────────

class StreamReader {
  readonly #iter: AsyncIterator<Uint8Array>;
  constructor(stream: Stream) {
    const gen = lp.decode(stream);
    this.#iter = (gen as AsyncIterable<unknown>)[Symbol.asyncIterator]() as AsyncIterator<Uint8Array>;
  }
  async readFrame(): Promise<Uint8Array> {
    const { value, done } = await this.#iter.next();
    if (done || value === undefined) throw new Error("stream ended");
    const v = value as unknown;
    if (v instanceof Uint8Array) return v;
    if (typeof (v as { slice?: () => Uint8Array }).slice === "function") {
      return (v as { slice(): Uint8Array }).slice();
    }
    return new Uint8Array(v as ArrayBuffer);
  }
  async readDecoded(): Promise<Record<string, unknown>> {
    const bytes = await this.readFrame();
    return decode(bytes) as Record<string, unknown>;
  }
}

function sendFrame(stream: Stream, data: Uint8Array): void {
  stream.send(lp.encode.single(data));
}

async function authenticateClient(
  stream: Stream,
  reader: StreamReader,
  kp: ReturnType<typeof generateKeypair>
): Promise<void> {
  const challenge = await reader.readDecoded();
  expect(challenge["type"]).toBe("signaling_auth_challenge");
  const nonce = challenge["nonce"];
  if (!(nonce instanceof Uint8Array) && !Buffer.isBuffer(nonce)) throw new Error("no nonce");
  const nonceBytes = Buffer.isBuffer(nonce) ? new Uint8Array(nonce) : nonce as Uint8Array;

  const pubkey = await kp.getPublicKey();
  const domain = Buffer.from(AUTH_DOMAIN, "utf8");
  const authMsg = new Uint8Array(Buffer.concat([domain, nonceBytes, pubkey]));
  const msgHash = new Uint8Array(createHash("sha256").update(authMsg).digest());
  const signature = await kp.sign(msgHash);
  sendFrame(stream, CBOR_ENC.encode({ type: "signaling_auth_response", pubkey, signature }));
}

function makeNoopRelayAdapter(): RelayAdapter {
  return {
    recordAssignment(_a: RelaySessionAssignment): { ok: true } | { ok: false; reason: string } {
      return { ok: true };
    },
    discardSession(_id: Uint8Array): void {},
    submitForSeal(_id: Uint8Array): { ok: true; data: import("../directory-types.js").RelaySealData } | { ok: false; reason: string } {
      return { ok: false, reason: "not_implemented" };
    },
    confirmSeal(_id: Uint8Array): void {},
    rejectSeal(_id: Uint8Array, _reason: string): void {},
  };
}

// ─── Test scope ───────────────────────────────────────────────────────────────

const scope = createTestScope();
beforeEach(() => { process.env.NODE_ENV = "test"; });
afterEach(async () => {
  await scope.run(async () => {});
  clearTestShares();
});

// ─── AC-002 (dir side): frost_signer_not_configured ───────────────────────────

describe("AC-002 (directory): frost_signer_not_configured when no IThresholdSigner registered", () => {
  it("directory returns session_request_error reason=frost_signer_not_configured when no signer registered for initiator", async () => {
    const dirKp = generateKeypair();

    const { directory, node: dirNode, stop: dirStop } = await createDirectoryNode({
      keyProvider: dirKp,
      relay: makeNoopRelayAdapter(),
      relayEndpoint: { peer_id: "relay-peer", multiaddrs: [] },
    });
    scope.addCleanup(dirStop);

    // Initiator A
    const kpA = generateKeypair();
    const pubkeyA = await kpA.getPublicKey();
    const nodeA = await createNode({ keyProvider: kpA, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await nodeA.start();
    scope.addCleanup(() => nodeA.stop());

    // Target B
    const kpB = generateKeypair();
    const pubkeyB = await kpB.getPublicKey();
    const nodeB = await createNode({ keyProvider: kpB, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await nodeB.start();
    scope.addCleanup(() => nodeB.stop());

    // Connect both to directory and register peer info
    const dirAddr = dirNode.listenAddresses()[0]!;
    await nodeA.dial(dirAddr);
    await nodeB.dial(dirAddr);

    const pubkeyAHex = Buffer.from(pubkeyA).toString("hex");
    const pubkeyBHex = Buffer.from(pubkeyB).toString("hex");
    directory.registerPeerInfo(pubkeyAHex, nodeA.getPeerId(), nodeA.listenAddresses());
    directory.registerPeerInfo(pubkeyBHex, nodeB.getPeerId(), nodeB.listenAddresses());

    // B authenticates (target must be online)
    const streamB = await nodeB.newStream(dirNode.getPeerId(), SIGNALING_PROTOCOL_ID);
    const readerB = new StreamReader(streamB);
    await authenticateClient(streamB, readerB, kpB);

    // A authenticates and sends session_request
    // NOTE: no threshold signer registered for A → directory must return frost_signer_not_configured
    const streamA = await nodeA.newStream(dirNode.getPeerId(), SIGNALING_PROTOCOL_ID);
    const readerA = new StreamReader(streamA);
    await authenticateClient(streamA, readerA, kpA);

    sendFrame(streamA, CBOR_ENC.encode({
      type: "session_request",
      target_pubkey: pubkeyB,
    }));

    const response = await readerA.readDecoded();
    expect(response["type"]).toBe("session_request_error");
    expect(response["reason"]).toBe("frost_signer_not_configured");
  }, 20_000);
});

// ─── AC-004: DIRECTORY_BELOW_THRESHOLD → session_request_error ────────────────

describe("AC-004: DIRECTORY_BELOW_THRESHOLD → session_request_error, no partial session state", () => {
  it("when all stubs are unresponsive → ceremony returns DIRECTORY_BELOW_THRESHOLD → directory returns session_request_error", async () => {
    const dirKp = generateKeypair();

    const kpA = generateKeypair();
    const pubkeyA = await kpA.getPublicKey();
    const pubkeyAHex = Buffer.from(pubkeyA).toString("hex");

    // Bootstrap A's FROST group with 3 stubs (2-of-3 threshold)
    const stubsA = createInProcessStubs(3);
    await bootstrapKeyShares(pubkeyA, { threshold: 2, participants: 3, directoryNodeStubs: stubsA });
    const signerA = new FrostThresholdSigner({ threshold: 2, participants: 3, directoryNodeStubs: stubsA }, pubkeyA);

    // Mark ALL stubs as unreachable so the ceremony fails DIRECTORY_BELOW_THRESHOLD.
    // isReachable() returns false for each, so the coordinator sees 0/3 reachable
    // nodes (threshold=2), triggering the below-threshold failure immediately.
    for (const stub of stubsA) {
      stub.setUnreachable(true);
    }

    const kpB = generateKeypair();
    const pubkeyB = await kpB.getPublicKey();
    const pubkeyBHex = Buffer.from(pubkeyB).toString("hex");

    const { directory, node: dirNode, stop: dirStop } = await createDirectoryNode({
      keyProvider: dirKp,
      relay: makeNoopRelayAdapter(),
      relayEndpoint: { peer_id: "relay-peer", multiaddrs: [] },
    });
    scope.addCleanup(dirStop);

    // Register signer — it IS configured, but all nodes are unresponsive (below-threshold)
    directory.registerThresholdSigner(pubkeyAHex, signerA);

    const nodeA = await createNode({ keyProvider: kpA, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await nodeA.start();
    scope.addCleanup(() => nodeA.stop());

    const nodeB = await createNode({ keyProvider: kpB, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await nodeB.start();
    scope.addCleanup(() => nodeB.stop());

    const dirAddr = dirNode.listenAddresses()[0]!;
    await nodeA.dial(dirAddr);
    await nodeB.dial(dirAddr);

    directory.registerPeerInfo(pubkeyAHex, nodeA.getPeerId(), nodeA.listenAddresses());
    directory.registerPeerInfo(pubkeyBHex, nodeB.getPeerId(), nodeB.listenAddresses());

    // B authenticates (target must be online for directory to attempt the ceremony)
    const streamB = await nodeB.newStream(dirNode.getPeerId(), SIGNALING_PROTOCOL_ID);
    const readerB = new StreamReader(streamB);
    await authenticateClient(streamB, readerB, kpB);

    // A authenticates and sends session_request
    const streamA = await nodeA.newStream(dirNode.getPeerId(), SIGNALING_PROTOCOL_ID);
    const readerA = new StreamReader(streamA);
    await authenticateClient(streamA, readerA, kpA);

    sendFrame(streamA, CBOR_ENC.encode({
      type: "session_request",
      target_pubkey: pubkeyB,
    }));

    // Directory should return session_request_error with reason=directory_below_threshold
    const response = await readerA.readDecoded();
    expect(response["type"]).toBe("session_request_error");
    expect(response["reason"]).toBe("directory_below_threshold");
  }, 20_000);
});

// ─── AC-005: CEREMONY_CONFLICT detection ─────────────────────────────────────

describe("AC-005: CEREMONY_CONFLICT — second session_request while first in-flight is rejected", () => {
  it("directory.frostHandler.markInFlight then second request for same agent → ceremony_conflict", async () => {
    const dirKp = generateKeypair();

    // kpA is both the libp2p identity AND the FROST agent identity.
    // Using the same keypair for both ensures the directory can look up the signer by
    // the authenticated pubkey.
    const kpA = generateKeypair();
    const pubkeyA = await kpA.getPublicKey();
    const pubkeyAHex = Buffer.from(pubkeyA).toString("hex");

    // Bootstrap A's FROST group using kpA's pubkey as the agent identity
    const stubsA = createInProcessStubs(3);
    await bootstrapKeyShares(pubkeyA, { threshold: 2, participants: 3, directoryNodeStubs: stubsA });
    const signerA = new FrostThresholdSigner({ threshold: 2, participants: 3, directoryNodeStubs: stubsA }, pubkeyA);

    const { directory, node: dirNode, stop: dirStop } = await createDirectoryNode({
      keyProvider: dirKp,
      relay: makeNoopRelayAdapter(),
      relayEndpoint: { peer_id: "relay-peer", multiaddrs: [] },
    });
    scope.addCleanup(dirStop);

    const nodeA = await createNode({ keyProvider: kpA, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await nodeA.start();
    scope.addCleanup(() => nodeA.stop());

    const kpB = generateKeypair();
    const pubkeyBKey = await kpB.getPublicKey();
    const pubkeyBHex = Buffer.from(pubkeyBKey).toString("hex");
    const nodeB = await createNode({ keyProvider: kpB, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await nodeB.start();
    scope.addCleanup(() => nodeB.stop());

    // Register A's IThresholdSigner with directory (keyed by kpA's pubkey)
    directory.registerThresholdSigner(pubkeyAHex, signerA);

    const dirAddr = dirNode.listenAddresses()[0]!;
    await nodeA.dial(dirAddr);
    await nodeB.dial(dirAddr);

    directory.registerPeerInfo(pubkeyAHex, nodeA.getPeerId(), nodeA.listenAddresses());
    directory.registerPeerInfo(pubkeyBHex, nodeB.getPeerId(), nodeB.listenAddresses());

    // B authenticates (target must be online)
    const streamB = await nodeB.newStream(dirNode.getPeerId(), SIGNALING_PROTOCOL_ID);
    const readerB = new StreamReader(streamB);
    await authenticateClient(streamB, readerB, kpB);

    // Simulate an in-flight ceremony already running for A (pubkeyAHex = kpA's pubkey)
    // by calling markInFlight directly. This replicates what happens when a first ceremony
    // is in progress. The session_request from A will compute a different ceremonyId
    // (based on a freshly generated session_id), causing a conflict.
    const epochId = `${pubkeyAHex}:epoch:1`;
    const firstCeremonyId = "session-aaaaaaaaaaaaaaaa"; // first in-flight ceremony
    directory.frostHandler.markInFlight(pubkeyAHex, epochId, firstCeremonyId, firstCeremonyId);

    // A authenticates and sends session_request (this is the "second" attempt — conflict)
    const streamA = await nodeA.newStream(dirNode.getPeerId(), SIGNALING_PROTOCOL_ID);
    const readerA = new StreamReader(streamA);
    await authenticateClient(streamA, readerA, kpA);

    sendFrame(streamA, CBOR_ENC.encode({
      type: "session_request",
      target_pubkey: pubkeyBKey,
    }));

    const response = await readerA.readDecoded();
    expect(response["type"]).toBe("session_request_error");
    expect(response["reason"]).toBe("ceremony_conflict");
  }, 20_000);
});

// ─── Integration: FROST-signed assignment from directory ──────────────────────

describe("Integration: Directory issues FROST-signed assignment when signer registered", () => {
  it("directory issues assignment with signature_type=frost and valid signer_pubkey when signer registered for A", async () => {
    const dirKp = generateKeypair();

    const kpA = generateKeypair();
    const pubkeyA = await kpA.getPublicKey();
    const pubkeyAHex = Buffer.from(pubkeyA).toString("hex");

    // Bootstrap A's FROST group
    const stubsA = createInProcessStubs(3);
    await bootstrapKeyShares(pubkeyA, { threshold: 2, participants: 3, directoryNodeStubs: stubsA });
    const signerA = new FrostThresholdSigner({ threshold: 2, participants: 3, directoryNodeStubs: stubsA }, pubkeyA);
    const aPrimaryPubkey = signerA.getPrimaryPubkey();

    const kpB = generateKeypair();
    const pubkeyB = await kpB.getPublicKey();
    const pubkeyBHex = Buffer.from(pubkeyB).toString("hex");

    const relayAdapter = makeNoopRelayAdapter();
    const { directory, node: dirNode, stop: dirStop } = await createDirectoryNode({
      keyProvider: dirKp,
      relay: relayAdapter,
      relayEndpoint: { peer_id: "relay-peer", multiaddrs: ["/ip4/127.0.0.1/tcp/12345"] },
    });
    scope.addCleanup(dirStop);

    // Register A's signer with directory
    directory.registerThresholdSigner(pubkeyAHex, signerA);

    const nodeA = await createNode({ keyProvider: kpA, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await nodeA.start();
    scope.addCleanup(() => nodeA.stop());

    const nodeB = await createNode({ keyProvider: kpB, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await nodeB.start();
    scope.addCleanup(() => nodeB.stop());

    const dirAddr = dirNode.listenAddresses()[0]!;
    await nodeA.dial(dirAddr);
    await nodeB.dial(dirAddr);

    directory.registerPeerInfo(pubkeyAHex, nodeA.getPeerId(), nodeA.listenAddresses());
    directory.registerPeerInfo(pubkeyBHex, nodeB.getPeerId(), nodeB.listenAddresses());

    // B authenticates
    const streamB = await nodeB.newStream(dirNode.getPeerId(), SIGNALING_PROTOCOL_ID);
    const readerB = new StreamReader(streamB);
    await authenticateClient(streamB, readerB, kpB);

    // Drain any queued notifications (none expected)
    // We'll read the assignment frame B receives

    // A authenticates and sends session_request
    const streamA = await nodeA.newStream(dirNode.getPeerId(), SIGNALING_PROTOCOL_ID);
    const readerA = new StreamReader(streamA);
    await authenticateClient(streamA, readerA, kpA);

    sendFrame(streamA, CBOR_ENC.encode({
      type: "session_request",
      target_pubkey: pubkeyB,
    }));

    // A receives session_assignment
    const frameA = await readerA.readDecoded();
    expect(frameA["type"]).toBe("session_assignment");

    const assignmentRaw = frameA["assignment"] as Record<string, unknown>;
    expect(assignmentRaw["signature_type"]).toBe("frost");

    const signerPubkeyRaw = assignmentRaw["signer_pubkey"];
    const signerPubkeyBytes = signerPubkeyRaw instanceof Uint8Array
      ? signerPubkeyRaw
      : Buffer.isBuffer(signerPubkeyRaw)
        ? new Uint8Array(signerPubkeyRaw as Buffer)
        : null;
    expect(signerPubkeyBytes).not.toBeNull();
    expect(signerPubkeyBytes!.length).toBe(32);

    // signer_pubkey in the frame should be A's primary_pubkey
    expect(Buffer.from(signerPubkeyBytes!).toString("hex"))
      .toBe(Buffer.from(aPrimaryPubkey).toString("hex"));

    // B also receives session_assignment
    const frameB = await readerB.readDecoded();
    expect(frameB["type"]).toBe("session_assignment");
    const assignmentRawB = frameB["assignment"] as Record<string, unknown>;
    expect(assignmentRawB["signature_type"]).toBe("frost");
  }, 30_000);
});
