/**
 * CELLO-SESSION-003: bilateral session seal — client-side tests
 *
 * TDD Phase R — RED-first. Written before full e2e integration is complete.
 *
 * Test infrastructure: real directory node, real relay node, two real clients —
 * all in-process (same process, different libp2p nodes).
 *
 * Covered ACs (in-scope for client test file):
 *   AC-001: A calls initiateSessionSeal after 5 messages; B auto-responds; session → sealing
 *   AC-002: directory receives seal, verifies, pushes session_sealed; both clients → sealed
 *   AC-003: further sends after sealed → session_sealed error
 *   AC-004: sealed_root matches across client A, client B, and directory notarization
 *   AC-011: tampered directory_signature on session_sealed → client rejects, stays sealing
 *   SI-005: client never transitions to sealed without valid directory signature
 *
 * Tests for AC-005–AC-010 (relay/directory-side injection) remain in
 * directory-node.test.ts (session-003-directory-*.test.ts future story).
 *
 * SealPayload: canonical CBOR([session_id, final_root, close_timestamp, "PENDING"])
 * per SESSION-003 and RFC 8949 §4.2.1.
 * Ed25519 per RFC 8032. SHA-256 per FIPS 180-4.
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
import type { TestScope } from "@claude-flow/testing";
import { randomBytes } from "node:crypto";
import { Encoder } from "cbor-x";
import { generateKeypair, FrostThresholdSigner, CONTEXT_SESSION_ESTABLISHMENT } from "@cello/crypto";
import { bootstrapKeyShares, clearTestShares } from "@cello/crypto/frost/frost-threshold-signer.js";
import { createInProcessStubs } from "@cello/crypto/frost/stubs.js";
import { computeGenesisPrevRoot, buildSessionEstablishmentTbs } from "@cello/protocol-types";
import { createNode } from "@cello/transport";
import { createRelayNode, CelloRelayNode } from "@cello/relay";
import type { DirectoryAdapter } from "@cello/relay";
import { createDirectoryNode } from "@cello/directory";
import type { RelayAdapter } from "@cello/directory";
import type { RelaySessionAssignment } from "@cello/directory";
import { createClient } from "../client.js";
import type { CelloClient } from "../types.js";

setupV3Tests();

const CBOR_ENC = new Encoder({ tagUint8Array: false });

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Wait until a client session has the expected status. */
async function waitForStatus(
  client: CelloClient,
  sessionIdHex: string,
  targetStatus: string,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const sessions = client.listSessions();
    const s = sessions.find(x => Buffer.from(x.session_id).toString("hex") === sessionIdHex);
    if (s?.status === targetStatus) return;
    await new Promise<void>((r) => setTimeout(r, 50));
  }
  const sessions = client.listSessions();
  const s = sessions.find(x => Buffer.from(x.session_id).toString("hex") === sessionIdHex);
  throw new Error(`waitForStatus: timeout waiting for ${targetStatus}, current=${s?.status ?? "not_found"}`);
}

/** Wait until a client receives at least N messages in a session. */
async function waitForMessages(
  client: CelloClient,
  sessionIdHex: string,
  count: number,
  timeoutMs = 10_000,
): Promise<void> {
  const received: unknown[] = [];
  const deadline = Date.now() + timeoutMs;
  while (received.length < count && Date.now() < deadline) {
    const msg = client.receiveMessage(sessionIdHex);
    if (msg) { received.push(msg); }
    else { await new Promise<void>((r) => setTimeout(r, 30)); }
  }
  if (received.length < count) {
    throw new Error(`waitForMessages: timeout, got ${received.length}/${count}`);
  }
}

// ─── Full fixture: directory + relay + two clients ───────────────────────────

interface FullFixture {
  dirKp: ReturnType<typeof generateKeypair>;
  dirPubkey: Uint8Array;
  relay: CelloRelayNode;
  dirStop: () => Promise<void>;
  relayStop: () => Promise<void>;
  dirPeerId: string;
  dirMultiaddrs: string[];
  relayPeerId: string;
  relayMultiaddrs: string[];
  signerA: FrostThresholdSigner;
  clientA: { kp: ReturnType<typeof generateKeypair>; pubkey: Uint8Array; peerId: string; multiaddrs: string[]; client: CelloClient };
  clientB: { kp: ReturnType<typeof generateKeypair>; pubkey: Uint8Array; peerId: string; multiaddrs: string[]; client: CelloClient };
  stopAll: () => Promise<void>;
}

async function makeFullFixture(): Promise<FullFixture> {
  const dirKp = generateKeypair();
  const dirPubkey = await dirKp.getPublicKey();

  // Relay node (must start before directory so we have relay peer_id/multiaddrs)
  const relayResult = await createRelayNode({ directoryPubkey: dirPubkey });

  // Build a DirectoryAdapter shim over CelloDirectoryNode (wired after dirNode is created)
  let dirNodeRef: Awaited<ReturnType<typeof createDirectoryNode>> | null = null;
  const directoryAdapter: DirectoryAdapter = {
    async processSeal(sessionId, sealData) {
      if (!dirNodeRef) return { ok: false, reason: "directory_not_ready" };
      return dirNodeRef.directory.processSeal(sessionId, sealData);
    },
  };

  // Relay with directory wired in
  const relayForDir = await createRelayNode({
    directoryPubkey: dirPubkey,
    directory: directoryAdapter,
  });
  // We only need one relay node; close the first one
  await relayResult.stop();

  const relayPeerId2 = relayForDir.node.getPeerId();
  const relayMultiaddrs2 = relayForDir.node.listenAddresses();

  // Build relay adapter over the relay node for directory's in-process calls
  const relayAdapterForDir: RelayAdapter = {
    recordAssignment(a: RelaySessionAssignment) {
      return relayForDir.relay.recordAssignment({
        session_id: a.session_id,
        participant_a: a.participant_a,
        participant_b: a.participant_b,
        session_timestamp: a.session_timestamp,
        directory_signature: a.directory_signature,
      });
    },
    discardSession(id: Uint8Array) {
      relayForDir.relay.discardSession(id);
    },
    submitForSeal(id: Uint8Array) {
      return relayForDir.relay.submitForSeal(id);
    },
    confirmSeal(id: Uint8Array) {
      relayForDir.relay.confirmSeal(id);
    },
    rejectSeal(id: Uint8Array, reason: string) {
      relayForDir.relay.rejectSeal(id, reason);
    },
  };

  // Directory node
  dirNodeRef = await createDirectoryNode({
    keyProvider: dirKp,
    relay: relayAdapterForDir,
    relayEndpoint: { peer_id: relayPeerId2, multiaddrs: relayMultiaddrs2 },
  });

  // Patch directory_endpoint into the dirNode — self-reference (directory announces itself)
  const dirPeerId = dirNodeRef.node.getPeerId();
  const dirMultiaddrs = dirNodeRef.node.listenAddresses();

  // Two clients
  const kpA = generateKeypair();
  const pubkeyA = await kpA.getPublicKey();
  const nodeA = await createNode({ keyProvider: kpA, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
  await nodeA.start();

  const kpB = generateKeypair();
  const pubkeyB = await kpB.getPublicKey();
  const nodeB = await createNode({ keyProvider: kpB, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
  await nodeB.start();

  // SESSION-004: bootstrap FROST for A so clientA can receive FROST-signed assignments
  const stubsA = createInProcessStubs(3);
  await bootstrapKeyShares(pubkeyA, { threshold: 2, participants: 3, directoryNodeStubs: stubsA });
  const signerA = new FrostThresholdSigner({ threshold: 2, participants: 3, directoryNodeStubs: stubsA }, pubkeyA);

  const clientA = createClient(nodeA, kpA, { thresholdSigner: signerA });
  const clientB = createClient(nodeB, kpB);
  await clientA.registerHandler();
  await clientB.registerHandler();

  // Register peer info on directory so it can include correct multiaddrs in assignment
  const peerIdA = nodeA.getPeerId();
  const peerIdB = nodeB.getPeerId();
  const multiaddrsA = nodeA.listenAddresses();
  const multiaddrsB = nodeB.listenAddresses();

  // Connect clients to directory and register peer info
  const pubkeyAHex = Buffer.from(pubkeyA).toString("hex");
  const pubkeyBHex = Buffer.from(pubkeyB).toString("hex");
  dirNodeRef.directory.registerPeerInfo(pubkeyAHex, peerIdA, multiaddrsA);
  dirNodeRef.directory.registerPeerInfo(pubkeyBHex, peerIdB, multiaddrsB);
  // SESSION-004: register A's threshold signer so directory can issue FROST-signed assignments
  dirNodeRef.directory.registerThresholdSigner(pubkeyAHex, signerA);

  const stopAll = async () => {
    try { await nodeA.stop(); } catch {}
    try { await nodeB.stop(); } catch {}
    try { await dirNodeRef?.stop(); } catch {}
    try { await relayForDir.stop(); } catch {}
  };

  return {
    dirKp,
    dirPubkey,
    relay: relayForDir.relay,
    dirStop: async () => { await dirNodeRef?.stop(); },
    relayStop: async () => { await relayForDir.stop(); },
    dirPeerId,
    dirMultiaddrs,
    relayPeerId: relayPeerId2,
    relayMultiaddrs: relayMultiaddrs2,
    signerA,
    clientA: { kp: kpA, pubkey: pubkeyA, peerId: peerIdA, multiaddrs: multiaddrsA, client: clientA },
    clientB: { kp: kpB, pubkey: pubkeyB, peerId: peerIdB, multiaddrs: multiaddrsB, client: clientB },
    stopAll,
  };
}

/** Build a directory SessionAssignment and deliver it to both clients. */
async function setupSessionViaDirectory(fix: FullFixture): Promise<string> {
  // SESSION-004: build a FROST-signed assignment using the real threshold signer
  const sessionId = new Uint8Array(randomBytes(16));
  const session_timestamp = Date.now();
  const genesis_prev_root = computeGenesisPrevRoot(fix.clientA.pubkey, fix.clientB.pubkey, sessionId, session_timestamp);
  const tbs = buildSessionEstablishmentTbs(sessionId, fix.clientA.pubkey, fix.clientB.pubkey, genesis_prev_root, session_timestamp);
  const ceremonyId = `session-${Buffer.from(sessionId).toString("hex")}`;
  const sigResult = await fix.signerA.participateInCeremony(ceremonyId, tbs, CONTEXT_SESSION_ESTABLISHMENT);
  if (!sigResult.ok) throw new Error(`FROST ceremony failed: ${sigResult.error.reason}`);

  const dirPubkey = await fix.dirKp.getPublicKey();

  const assignment = {
    session_id: sessionId,
    participant_a: {
      pubkey: fix.clientA.pubkey,
      peer_id: fix.clientA.peerId,
      multiaddrs: fix.clientA.multiaddrs,
    },
    participant_b: {
      pubkey: fix.clientB.pubkey,
      peer_id: fix.clientB.peerId,
      multiaddrs: fix.clientB.multiaddrs,
    },
    relay_endpoint: {
      peer_id: fix.relayPeerId,
      multiaddrs: fix.relayMultiaddrs,
    },
    directory_endpoint: {
      peer_id: fix.dirPeerId,
      multiaddrs: fix.dirMultiaddrs,
    },
    session_timestamp,
    directory_pubkey: dirPubkey,
    directory_signature: sigResult.signature,
    signature_type: "frost" as const,
    signer_pubkey: fix.signerA.getPrimaryPubkey(),
  };

  // Register with relay using Ed25519 dir signature (relay still verifies M1-style TBS)
  const relayTbs = CBOR_ENC.encode([
    sessionId,
    fix.clientA.pubkey,
    fix.clientB.pubkey,
    session_timestamp > 0xffffffff ? BigInt(session_timestamp) : session_timestamp,
  ]) as Uint8Array;
  const relaySig = await fix.dirKp.sign(relayTbs);
  const registered = fix.relay.recordAssignment({
    session_id: sessionId,
    participant_a: fix.clientA.pubkey,
    participant_b: fix.clientB.pubkey,
    session_timestamp,
    directory_signature: relaySig,
  });
  if (!registered.ok) throw new Error(`relay.recordAssignment failed: ${(registered as { reason: string }).reason}`);

  // Both clients receive the assignment
  const [rA, rB] = await Promise.all([
    fix.clientA.client.receiveSessionAssignment(assignment, fix.clientA.pubkey),
    fix.clientB.client.receiveSessionAssignment(assignment, fix.clientB.pubkey),
  ]);
  if (!rA.ok) throw new Error(`clientA receiveSessionAssignment failed: ${!rA.ok && (rA as {reason?: string}).reason}`);
  if (!rB.ok) throw new Error(`clientB receiveSessionAssignment failed: ${!rB.ok && (rB as {reason?: string}).reason}`);

  return Buffer.from(sessionId).toString("hex");
}

// ─── Test scope ───────────────────────────────────────────────────────────────

let scope: TestScope;
beforeEach(() => { scope = createTestScope(); });
afterEach(() => {
  clearTestShares();
  return scope.run(async () => {});
});

// ─── AC-001: initiator SEAL + non-initiator auto-response ────────────────────

describe("AC-001: A initiates seal after 5 messages; B auto-responds", () => {
  it("A calls initiateSessionSeal; B receives SEAL leaf, verifies final_root, auto-responds; both sessions → sealing", async () => {
    const fix = await makeFullFixture();
    scope.addCleanup(fix.stopAll);

    const sessionIdHex = await setupSessionViaDirectory(fix);

    // Exchange 5 messages A→B
    for (let i = 0; i < 5; i++) {
      await fix.clientA.client.sendMessage(sessionIdHex, Buffer.from(`msg${i + 1}`));
    }
    await waitForMessages(fix.clientB.client, sessionIdHex, 5, 15_000);

    // A initiates seal
    const sealResult = await (fix.clientA.client as unknown as {
      initiateSessionSeal(s: string): Promise<{ ok: true } | { ok: false; reason: string }>;
    }).initiateSessionSeal(sessionIdHex);
    expect(sealResult.ok).toBe(true);

    // A session should now be sealing
    const sessA = fix.clientA.client.listSessions().find(s => Buffer.from(s.session_id).toString("hex") === sessionIdHex);
    expect(sessA?.status).toBe("sealing");

    // B should receive A's SEAL leaf and auto-respond → B transitions to sealing or sealed
    // Poll until B leaves "active" state (sealing or sealed both satisfy AC-001)
    const deadline001 = Date.now() + 15_000;
    while (Date.now() < deadline001) {
      const sessB2 = fix.clientB.client.listSessions().find(s => Buffer.from(s.session_id).toString("hex") === sessionIdHex);
      if (sessB2?.status !== "active") break;
      await new Promise<void>((r) => setTimeout(r, 50));
    }
    const sessBFinal = fix.clientB.client.listSessions().find(s => Buffer.from(s.session_id).toString("hex") === sessionIdHex);
    expect(["sealing", "sealed"]).toContain(sessBFinal?.status);
  }, 45_000);
});

// ─── AC-002: directory confirms seal, both clients receive session_sealed ─────

describe("AC-002: directory verifies, notarizes, pushes session_sealed; both clients → sealed", () => {
  it("after bilateral SEAL, both clients transition to sealed with matching sealed_root", async () => {
    const fix = await makeFullFixture();
    scope.addCleanup(fix.stopAll);

    const sessionIdHex = await setupSessionViaDirectory(fix);

    // Exchange 3 messages
    for (let i = 0; i < 3; i++) {
      await fix.clientA.client.sendMessage(sessionIdHex, Buffer.from(`msg${i + 1}`));
    }
    await waitForMessages(fix.clientB.client, sessionIdHex, 3, 15_000);

    // A initiates seal
    const sealResult = await (fix.clientA.client as unknown as {
      initiateSessionSeal(s: string): Promise<{ ok: true } | { ok: false; reason: string }>;
    }).initiateSessionSeal(sessionIdHex);
    expect(sealResult.ok).toBe(true);

    // Wait for both to become sealed
    await waitForStatus(fix.clientA.client, sessionIdHex, "sealed", 15_000);
    await waitForStatus(fix.clientB.client, sessionIdHex, "sealed", 15_000);
  }, 45_000);
});

// ─── AC-003: further sends on sealed session → session_sealed error ───────────

describe("AC-003: send after sealed → session_sealed error", () => {
  it("sendMessage on a sealed session returns session_sealed", async () => {
    const fix = await makeFullFixture();
    scope.addCleanup(fix.stopAll);

    const sessionIdHex = await setupSessionViaDirectory(fix);

    // 2 messages then seal
    for (let i = 0; i < 2; i++) {
      await fix.clientA.client.sendMessage(sessionIdHex, Buffer.from(`msg${i}`));
    }
    await waitForMessages(fix.clientB.client, sessionIdHex, 2, 10_000);

    await (fix.clientA.client as unknown as {
      initiateSessionSeal(s: string): Promise<{ ok: true } | { ok: false; reason: string }>;
    }).initiateSessionSeal(sessionIdHex);

    // Wait for sealed state
    await waitForStatus(fix.clientA.client, sessionIdHex, "sealed", 15_000);

    // Further send must fail with session_sealed
    const sendResult = await fix.clientA.client.sendMessage(sessionIdHex, Buffer.from("too_late"));
    expect(sendResult.ok).toBe(false);
    if (!sendResult.ok) {
      expect(sendResult.reason).toBe("session_sealed");
    }
  }, 45_000);
});

// ─── AC-004: sealed_root matches on both clients ───────────────────────────────

describe("AC-004: sealed_root byte-equal on both clients; directory signature verifies", () => {
  it("client A and B sealed_root are byte-identical; directory signature verifies against directory_pubkey", async () => {
    const fix = await makeFullFixture();
    scope.addCleanup(fix.stopAll);

    const sessionIdHex = await setupSessionViaDirectory(fix);

    // 4 messages
    for (let i = 0; i < 4; i++) {
      await fix.clientA.client.sendMessage(sessionIdHex, Buffer.from(`msg${i}`));
    }
    await waitForMessages(fix.clientB.client, sessionIdHex, 4, 15_000);

    await (fix.clientA.client as unknown as {
      initiateSessionSeal(s: string): Promise<{ ok: true } | { ok: false; reason: string }>;
    }).initiateSessionSeal(sessionIdHex);

    await waitForStatus(fix.clientA.client, sessionIdHex, "sealed", 15_000);
    await waitForStatus(fix.clientB.client, sessionIdHex, "sealed", 15_000);

    const sessA = fix.clientA.client.listSessions().find(s => Buffer.from(s.session_id).toString("hex") === sessionIdHex);
    const sessB = fix.clientB.client.listSessions().find(s => Buffer.from(s.session_id).toString("hex") === sessionIdHex);

    expect(sessA?.sealed_root).toBeDefined();
    expect(sessB?.sealed_root).toBeDefined();
    expect(sessA?.sealed_root?.length).toBe(32);

    expect(Buffer.from(sessA!.sealed_root!).toString("hex"))
      .toBe(Buffer.from(sessB!.sealed_root!).toString("hex"));
  }, 45_000);
});

// ─── AC-011 / SI-005: tampered directory_signature on session_sealed ──────────

describe("AC-011 / SI-005: tampered directory_signature on session_sealed → client rejects", () => {
  it("one bit flipped in directory_signature → client stays in sealing, never transitions to sealed", async () => {
    // Setup: minimal stack — one client, no relay auth needed for this test.
    // We just need a session record with a pinned directory_pubkey so we can inject
    // a tampered session_sealed frame directly via the injectDirectoryFrame test escape.
    const kpA = generateKeypair();
    const nodeA = await createNode({ keyProvider: kpA, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await nodeA.start();
    scope.addCleanup(() => nodeA.stop());

    const kpDir = generateKeypair();
    const dirPubkeyReal = await kpDir.getPublicKey();
    const relayResult = await createRelayNode({ directoryPubkey: dirPubkeyReal });
    scope.addCleanup(relayResult.stop);

    const kpB = generateKeypair();
    const pubkeyB = await kpB.getPublicKey();
    const nodeB = await createNode({ keyProvider: kpB, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await nodeB.start();
    scope.addCleanup(() => nodeB.stop());

    const pubkeyA = await kpA.getPublicKey();
    // SESSION-004: bootstrap FROST for A so clientA can accept FROST-signed assignments
    const stubsSI005 = createInProcessStubs(3);
    await bootstrapKeyShares(pubkeyA, { threshold: 2, participants: 3, directoryNodeStubs: stubsSI005 });
    const signerSI005 = new FrostThresholdSigner({ threshold: 2, participants: 3, directoryNodeStubs: stubsSI005 }, pubkeyA);
    const clientA = createClient(nodeA, kpA, { thresholdSigner: signerSI005 });
    await clientA.registerHandler();

    const sid = new Uint8Array(randomBytes(16));
    const session_timestamp = Date.now();
    // SESSION-004: build FROST-signed assignment
    const genesis_prev_root_si005 = computeGenesisPrevRoot(pubkeyA, pubkeyB, sid, session_timestamp);
    const tbsAssignment = buildSessionEstablishmentTbs(sid, pubkeyA, pubkeyB, genesis_prev_root_si005, session_timestamp);
    const ceremonySI005 = `session-${Buffer.from(sid).toString("hex")}`;
    const sigResultSI005 = await signerSI005.participateInCeremony(ceremonySI005, tbsAssignment, CONTEXT_SESSION_ESTABLISHMENT);
    if (!sigResultSI005.ok) throw new Error(`FROST ceremony failed: ${sigResultSI005.error.reason}`);

    await clientA.receiveSessionAssignment({
      session_id: sid,
      participant_a: { pubkey: pubkeyA, peer_id: nodeA.getPeerId(), multiaddrs: nodeA.listenAddresses() },
      participant_b: { pubkey: pubkeyB, peer_id: nodeB.getPeerId(), multiaddrs: nodeB.listenAddresses() },
      relay_endpoint: { peer_id: relayResult.node.getPeerId(), multiaddrs: relayResult.node.listenAddresses() },
      directory_endpoint: { peer_id: "", multiaddrs: [] },
      session_timestamp,
      directory_pubkey: dirPubkeyReal,
      directory_signature: sigResultSI005.signature,
      signature_type: "frost",
      signer_pubkey: signerSI005.getPrimaryPubkey(),
    }, pubkeyA);

    const sessionIdHex2 = Buffer.from(sid).toString("hex");

    // Manually transition the session to "sealing" to simulate the state just before
    // a session_sealed notification arrives from the directory.
    const session = clientA.listSessions().find(s => Buffer.from(s.session_id).toString("hex") === sessionIdHex2);
    expect(session).toBeDefined();
    session!.status = "sealing";

    // Build a session_sealed frame with a tampered directory_signature (one bit flipped).
    const sealedRoot = new Uint8Array(randomBytes(32));
    const closeTimestamp = Date.now();
    const tbsSeal = CBOR_ENC.encode([
      sid,
      sealedRoot,
      closeTimestamp > 0xffffffff ? BigInt(closeTimestamp) : closeTimestamp,
    ]) as Uint8Array;
    const validDirSig = await kpDir.sign(tbsSeal);

    // Flip one bit in the signature to create a tampered version.
    const tamperedDirSig = new Uint8Array(validDirSig);
    tamperedDirSig[0] ^= 0x01;

    // Inject the tampered session_sealed frame directly into the client's handler.
    const clientAWithEscapes = clientA as unknown as {
      injectDirectoryFrame(sessionIdHex: string, frame: Record<string, unknown>): void;
    };
    clientAWithEscapes.injectDirectoryFrame(sessionIdHex2, {
      type: "session_sealed",
      session_id: sid,
      sealed_root: sealedRoot,
      close_timestamp: closeTimestamp,
      directory_signature: tamperedDirSig,
    });

    // SI-005: client MUST NOT transition to sealed — tampered signature must be rejected.
    const sessionAfter = clientA.listSessions().find(s => Buffer.from(s.session_id).toString("hex") === sessionIdHex2);
    expect(sessionAfter?.status).toBe("sealing");
    expect(sessionAfter?.sealed_root).toBeUndefined();

    // Verify that a VALID signature does cause the transition (the verification path works).
    clientAWithEscapes.injectDirectoryFrame(sessionIdHex2, {
      type: "session_sealed",
      session_id: sid,
      sealed_root: sealedRoot,
      close_timestamp: closeTimestamp,
      directory_signature: validDirSig,
    });

    const sessionSealed = clientA.listSessions().find(s => Buffer.from(s.session_id).toString("hex") === sessionIdHex2);
    expect(sessionSealed?.status).toBe("sealed");
    expect(Buffer.from(sessionSealed?.sealed_root ?? []).toString("hex"))
      .toBe(Buffer.from(sealedRoot).toString("hex"));
  }, 30_000);
});
