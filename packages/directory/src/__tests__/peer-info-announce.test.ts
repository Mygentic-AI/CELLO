/**
 * CELLO-NODE-001: peer_info_announce signaling step (AC-005 updated, AC-014, AC-015)
 *
 * TDD Phase R — written BEFORE implementation (RED first).
 *
 * Tests cover:
 *   AC-014: authenticated client without peer_info_announce → session_request returns peer_not_registered
 *   AC-005 (updated): full handshake including peer_info_announce → both participant entries
 *           have non-empty peer_id and at least one multiaddr
 *   AC-015: real libp2p nodes complete full handshake via peer_info_announce wire protocol;
 *           SessionAssignment participant peer_ids match actual node PeerIds
 *
 * Auth domain: "CELLO-DIR-AUTH-v1"
 * Signature: Ed25519(SHA-256(domain || nonce || pubkey), privkey) — per RFC 8032, FIPS 180-4
 * peer_info_announce: CBOR { type: "peer_info_announce", peer_id: string, multiaddrs: string[] }
 *   LP-framed on the signaling stream.
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
  MockThresholdSigner,
} from "@cello-protocol/crypto";
import { createNode } from "@cello-protocol/transport";
import type { Stream } from "@libp2p/interface";
import {
  createDirectoryNode,
  SIGNALING_PROTOCOL_ID,
} from "../directory-node.js";
import type { RelayAdapter } from "../directory-node.js";
import type {
  RelaySessionAssignment,
} from "../directory-types.js";
import {
  decodeOutboundSignalingFrame,
} from "../directory-frames.js";

setupV3Tests();

const CBOR_ENC = new Encoder({ tagUint8Array: false });
const AUTH_DOMAIN = "CELLO-DIR-AUTH-v1";

// ─── StreamReader ──────────────────────────────────────────────────────────────

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

// ─── Auth helpers ──────────────────────────────────────────────────────────────

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

// ─── Shared helper: open stream and authenticate (without peer_info_announce) ──

async function connectAndAuthOnly(
  clientKey: ReturnType<typeof generateKeypair>,
  dirNode: Awaited<ReturnType<typeof createDirectoryNode>>,
  scope: ReturnType<typeof createTestScope>,
): Promise<{
  stream: Stream;
  reader: StreamReader;
  pubkeyBytes: Uint8Array;
  clientNode: Awaited<ReturnType<typeof createNode>>;
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

  // Read auth challenge
  const challengeBytes = await reader.readDecoded();
  const challenge = decodeOutboundSignalingFrame(challengeBytes);
  if (!challenge || challenge.type !== "signaling_auth_challenge") throw new Error("expected auth challenge");

  // Sign and respond
  const { pubkey, signature } = await signAuth(challenge.nonce, AUTH_DOMAIN, clientKey);
  sendFrame(stream, CBOR_ENC.encode({ type: "signaling_auth_response", pubkey, signature }));

  // Consume signaling_auth_ok
  const ackBytes = await reader.readDecoded();
  const ack = decodeOutboundSignalingFrame(ackBytes);
  if (!ack || ack.type !== "signaling_auth_ok") throw new Error(`expected signaling_auth_ok, got ${ack?.type}`);

  return { stream, reader, pubkeyBytes: pubkey, clientNode };
}

// ─── Shared helper: full handshake including peer_info_announce via wire protocol ──

async function connectAuthAndAnnounce(
  clientKey: ReturnType<typeof generateKeypair>,
  dirNode: Awaited<ReturnType<typeof createDirectoryNode>>,
  scope: ReturnType<typeof createTestScope>,
): Promise<{
  stream: Stream;
  reader: StreamReader;
  pubkeyBytes: Uint8Array;
  pubkeyHex: string;
  clientNode: Awaited<ReturnType<typeof createNode>>;
}> {
  const { stream, reader, pubkeyBytes, clientNode } = await connectAndAuthOnly(clientKey, dirNode, scope);

  // Send peer_info_announce via wire protocol
  const peerIdStr = clientNode.getPeerId();
  const multiaddrs = clientNode.listenAddresses();

  sendFrame(stream, CBOR_ENC.encode({
    type: "peer_info_announce",
    peer_id: peerIdStr,
    multiaddrs,
  }));

  // Register MockThresholdSigner for session_request to work
  const pubkeyHex = Buffer.from(pubkeyBytes).toString("hex");
  dirNode.directory.registerThresholdSigner(pubkeyHex, new MockThresholdSigner());

  return { stream, reader, pubkeyBytes, pubkeyHex, clientNode };
}

// ─── Test suite ──────────────────────────────────────────────────────────────

describe("CELLO-NODE-001: peer_info_announce signaling step", () => {
  let scope = createTestScope();
  let relay: ReturnType<typeof makeRelay>;
  let dirNode: Awaited<ReturnType<typeof createDirectoryNode>>;

  beforeEach(async () => {
    scope = createTestScope();
    relay = makeRelay();

    const dirKey = generateKeypair();
    dirNode = await createDirectoryNode({
      keyProvider: dirKey,
      relay,
      relayEndpoint: { peer_id: "12D3KooWRelayTest", multiaddrs: ["/ip4/127.0.0.1/tcp/9999"] },
    });
    scope.addCleanup(dirNode.stop);
  });

  afterEach(() => scope.run(async () => {}));

  // ─── AC-014: session_request before peer_info_announce → peer_not_registered ─

  it("AC-014: authenticated client without peer_info_announce gets peer_not_registered on session_request", async () => {
    const keyA = generateKeypair();
    const keyB = generateKeypair();

    // Both clients authenticate but do NOT send peer_info_announce
    const { stream: streamA, reader: readerA, pubkeyBytes: pubkeyA } =
      await connectAndAuthOnly(keyA, dirNode, scope);
    const { pubkeyBytes: pubkeyB } =
      await connectAndAuthOnly(keyB, dirNode, scope);

    // Register MockThresholdSigner for A so the request isn't blocked by frost_signer_not_configured
    const pubkeyHexA = Buffer.from(pubkeyA).toString("hex");
    dirNode.directory.registerThresholdSigner(pubkeyHexA, new MockThresholdSigner());

    // A sends session_request without having sent peer_info_announce
    sendFrame(streamA, CBOR_ENC.encode({
      type: "session_request",
      target_pubkey: pubkeyB,
    }));

    const responseBytes = await readerA.readDecoded();
    const response = decodeOutboundSignalingFrame(responseBytes);

    expect(response?.type).toBe("session_request_error");
    if (response?.type === "session_request_error") {
      expect(response.reason).toBe("peer_not_registered");
    }

    // Relay must NOT have received an assignment
    expect(relay.recorded.length).toBe(0);
  });

  // ─── AC-005 (updated): peer_info_announce → participant entries have real peer info ──

  it("AC-005 (updated): after peer_info_announce, session_assignment has non-empty peer_id and multiaddrs for both participants", async () => {
    const keyA = generateKeypair();
    const keyB = generateKeypair();

    const { stream: streamA, reader: readerA, pubkeyHex: hexA, clientNode: nodeA } =
      await connectAuthAndAnnounce(keyA, dirNode, scope);
    const { reader: readerB, pubkeyHex: hexB, clientNode: nodeB } =
      await connectAuthAndAnnounce(keyB, dirNode, scope);

    // A requests session with B
    sendFrame(streamA, CBOR_ENC.encode({
      type: "session_request",
      target_pubkey: Buffer.from(hexB, "hex"),
    }));

    // Both should receive session_assignment
    const frameA = decodeOutboundSignalingFrame(await readerA.readDecoded());
    const frameB = decodeOutboundSignalingFrame(await readerB.readDecoded());

    expect(frameA?.type).toBe("session_assignment");
    expect(frameB?.type).toBe("session_assignment");

    if (frameA?.type !== "session_assignment") return;
    const asg = frameA.assignment;

    // AC-005 updated: both participant entries have non-empty peer_id strings
    expect(asg.participant_a.peer_id).toBeTruthy();
    expect(asg.participant_b.peer_id).toBeTruthy();
    expect(typeof asg.participant_a.peer_id).toBe("string");
    expect(asg.participant_a.peer_id.length).toBeGreaterThan(0);
    expect(asg.participant_b.peer_id.length).toBeGreaterThan(0);

    // AC-005 updated: both participants have at least one multiaddr
    expect(asg.participant_a.multiaddrs.length).toBeGreaterThan(0);
    expect(asg.participant_b.multiaddrs.length).toBeGreaterThan(0);

    // Verify the peer_ids correspond to the actual client nodes
    const expectedPeerIdA = nodeA.getPeerId();
    const expectedPeerIdB = nodeB.getPeerId();

    // participant_a is the initiator (A) and participant_b is the target (B),
    // but pubkeys may be sorted differently — find by pubkey hex
    const participantForA = Buffer.from(asg.participant_a.pubkey).toString("hex") === hexA
      ? asg.participant_a
      : asg.participant_b;
    const participantForB = Buffer.from(asg.participant_a.pubkey).toString("hex") === hexB
      ? asg.participant_a
      : asg.participant_b;

    expect(participantForA.peer_id).toBe(expectedPeerIdA);
    expect(participantForB.peer_id).toBe(expectedPeerIdB);

    // Suppress unused variable warnings
    void hexA;
  });

  // ─── AC-015: real libp2p nodes, wire-level peer_info_announce, parseParticipantInfo succeeds ──

  it("AC-015 (e2e): full wire handshake with real libp2p nodes — parseParticipantInfo succeeds on both participants", async () => {
    const keyA = generateKeypair();
    const keyB = generateKeypair();

    const { stream: streamA, reader: readerA, clientNode: nodeA } =
      await connectAuthAndAnnounce(keyA, dirNode, scope);
    const { pubkeyHex: hexB, clientNode: nodeB } =
      await connectAuthAndAnnounce(keyB, dirNode, scope);

    // A sends session_request
    sendFrame(streamA, CBOR_ENC.encode({
      type: "session_request",
      target_pubkey: Buffer.from(hexB, "hex"),
    }));

    const frameA = decodeOutboundSignalingFrame(await readerA.readDecoded());
    expect(frameA?.type).toBe("session_assignment");
    if (frameA?.type !== "session_assignment") return;

    const asg = frameA.assignment;

    // parseParticipantInfo is the function from client.ts that rejects empty peer_id.
    // We simulate it here directly: the function returns null if peer_id is falsy.
    function parseParticipantInfo(p: { pubkey: Uint8Array; peer_id: string; multiaddrs: string[] }) {
      if (!p.peer_id) return null;
      if (!p.multiaddrs || p.multiaddrs.length === 0) return null;
      return p;
    }

    const parsedA = parseParticipantInfo(asg.participant_a);
    const parsedB = parseParticipantInfo(asg.participant_b);

    // AC-015: parseParticipantInfo must return non-null for both entries
    expect(parsedA).not.toBeNull();
    expect(parsedB).not.toBeNull();

    // AC-015: peer_ids match actual node PeerIds
    const actualPeerIds = new Set([nodeA.getPeerId(), nodeB.getPeerId()]);
    expect(actualPeerIds.has(asg.participant_a.peer_id)).toBe(true);
    expect(actualPeerIds.has(asg.participant_b.peer_id)).toBe(true);

    // AC-015: multiaddrs are non-empty for both
    expect(asg.participant_a.multiaddrs.length).toBeGreaterThan(0);
    expect(asg.participant_b.multiaddrs.length).toBeGreaterThan(0);
  });
});
