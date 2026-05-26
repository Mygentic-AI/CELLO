/**
 * CELLO-NODE-004: NetworkRelayAdapter tests
 *
 * TDD Phase R — RED FIRST.
 * These tests cover the directory-side NetworkRelayAdapter that communicates
 * with the relay over /cello/directory-relay/1.0.0.
 *
 * AC-001: NetworkRelayAdapter.recordAssignment sends record_assignment → relay stores session
 * AC-002: NetworkRelayAdapter.discardSession sends discard_session → relay removes session
 * AC-004: NetworkRelayAdapter.confirmSeal sends confirm_seal → relay destroys session
 * AC-005: NetworkRelayAdapter.rejectSeal sends reject_seal → relay marks seal_rejected
 *
 * AC-007 (full end-to-end session flow) is in e2e-tests/src/__tests__/node-004-e2e.test.ts
 * because it requires the full client stack.
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
import { randomBytes } from "node:crypto";
import { Encoder } from "cbor-x";
import { generateKeypair } from "@cello-protocol/crypto";
import { createRelayNode } from "@cello-protocol/relay";
import type { DirectoryAdapter } from "@cello-protocol/relay";
import { createDirectoryNode } from "@cello-protocol/directory";
import type { RelaySessionAssignment } from "@cello-protocol/directory";
import { NetworkRelayAdapter } from "../network-relay-adapter.js";

setupV3Tests();

const CBOR_ENC = new Encoder({ tagUint8Array: false });

// ─── AC-001/002/004/005: NetworkRelayAdapter unit tests ───────────────────────
//
// These tests create a real relay node, a real directory node with NetworkRelayAdapter,
// and verify the adapter sends correct frames over the network protocol.

describe("AC-001: NetworkRelayAdapter.recordAssignment → assignment_ok from relay", () => {
  let scope = createTestScope();
  beforeEach(() => { scope = createTestScope(); });
  afterEach(() => scope.run(async () => {}));

  it("relay stores session and accepts hash_submit after network record_assignment", async () => {
    const dirKp = generateKeypair();
    const dirPubkey = await dirKp.getPublicKey();

    // Start relay with a directory adapter that will be wired via network
    let dirNodeRef: Awaited<ReturnType<typeof createDirectoryNode>> | null = null;
    const directoryAdapter: DirectoryAdapter = {
      async processSeal(sessionId, sealData) {
        if (!dirNodeRef) return { ok: false, reason: "directory_not_ready" };
        return dirNodeRef.directory.processSeal(sessionId, sealData);
      },
    };

    const { relay: relayNode, node: relayLibp2p, stop: stopRelay } = await createRelayNode({
      directoryPubkey: dirPubkey,
      directory: directoryAdapter,
    });
    scope.addCleanup(stopRelay);

    const relayPeerId = relayLibp2p.getPeerId();
    const relayMultiaddrs = relayLibp2p.listenAddresses();

    // Create NetworkRelayAdapter
    const networkAdapter = new NetworkRelayAdapter({
      keyProvider: dirKp,
      relayPeerId,
      relayMultiaddrs,
    });

    // Start directory with NetworkRelayAdapter
    const dirResult = await createDirectoryNode({
      keyProvider: dirKp,
      relay: networkAdapter,
      relayEndpoint: { peer_id: relayPeerId, multiaddrs: relayMultiaddrs },
    });
    dirNodeRef = dirResult;
    scope.addCleanup(dirResult.stop);

    // Connect adapter to relay
    await networkAdapter.connect(dirResult.node);

    // Create a session assignment
    const clientKpA = generateKeypair();
    const clientKpB = generateKeypair();
    const pubA = await clientKpA.getPublicKey();
    const pubB = await clientKpB.getPublicKey();

    const sessionId = new Uint8Array(randomBytes(16));
    const sessionTimestamp = Date.now();

    // Sign as directory would sign (standard relay assignment TBS)
    const tbs = CBOR_ENC.encode([
      sessionId,
      pubA,
      pubB,
      sessionTimestamp > 0xffffffff ? BigInt(sessionTimestamp) : sessionTimestamp,
    ]) as Uint8Array;
    const directory_signature = await dirKp.sign(tbs);

    const assignment: RelaySessionAssignment = {
      session_id: sessionId,
      participant_a: pubA,
      participant_b: pubB,
      session_timestamp: sessionTimestamp,
      directory_signature,
    };

    // Call recordAssignment over the network
    const result = await networkAdapter.recordAssignment(assignment);
    expect(result.ok).toBe(true);

    // Verify relay accepted the session by checking we can submit a hash
    // (session_not_found would mean relay didn't register it)
    const sealCheckResult = relayNode.submitForSeal(sessionId);
    // Session exists but has no leaves yet — returns ok: false with session_not_active is not right
    // Actually submitForSeal returns ok: false with session_not_active only if status != active
    // A fresh session has status "active", so submitForSeal should work (return leaves=[])
    // But session IS active — so this confirms it was registered
    expect(sealCheckResult.ok).toBe(true);
    if (sealCheckResult.ok) {
      expect(sealCheckResult.data.leaves.length).toBe(0);
    }
  }, 20_000);
});

describe("AC-002: NetworkRelayAdapter.discardSession → relay removes session", () => {
  let scope = createTestScope();
  beforeEach(() => { scope = createTestScope(); });
  afterEach(() => scope.run(async () => {}));

  it("relay removes session after network discard_session", async () => {
    const dirKp = generateKeypair();
    const dirPubkey = await dirKp.getPublicKey();

    const { relay: relayNode, node: relayLibp2p, stop: stopRelay } = await createRelayNode({
      directoryPubkey: dirPubkey,
    });
    scope.addCleanup(stopRelay);

    const relayPeerId = relayLibp2p.getPeerId();
    const relayMultiaddrs = relayLibp2p.listenAddresses();

    const networkAdapter = new NetworkRelayAdapter({
      keyProvider: dirKp,
      relayPeerId,
      relayMultiaddrs,
    });

    const dirResult = await createDirectoryNode({
      keyProvider: dirKp,
      relay: networkAdapter,
      relayEndpoint: { peer_id: relayPeerId, multiaddrs: relayMultiaddrs },
    });
    scope.addCleanup(dirResult.stop);
    await networkAdapter.connect(dirResult.node);

    // Register a session in-process first
    const clientKpA = generateKeypair();
    const clientKpB = generateKeypair();
    const pubA = await clientKpA.getPublicKey();
    const pubB = await clientKpB.getPublicKey();
    const sessionId = new Uint8Array(randomBytes(16));
    const sessionTimestamp = Date.now();

    const tbs = CBOR_ENC.encode([
      sessionId, pubA, pubB,
      sessionTimestamp > 0xffffffff ? BigInt(sessionTimestamp) : sessionTimestamp,
    ]) as Uint8Array;
    const directory_signature = await dirKp.sign(tbs);
    relayNode.recordAssignment({ session_id: sessionId, participant_a: pubA, participant_b: pubB, session_timestamp: sessionTimestamp, directory_signature });

    // Verify session exists
    const beforeDiscard = relayNode.submitForSeal(sessionId);
    expect(beforeDiscard.ok).toBe(true);

    // Discard over network
    await networkAdapter.discardSession(sessionId);

    // Session should be gone
    const afterDiscard = relayNode.submitForSeal(sessionId);
    expect(afterDiscard.ok).toBe(false);
    if (!afterDiscard.ok) {
      expect(afterDiscard.reason).toBe("session_not_found");
    }
  }, 20_000);
});

describe("AC-004: NetworkRelayAdapter.confirmSeal → relay destroys session", () => {
  let scope = createTestScope();
  beforeEach(() => { scope = createTestScope(); });
  afterEach(() => scope.run(async () => {}));

  it("relay destroys session after network confirm_seal", async () => {
    const dirKp = generateKeypair();
    const dirPubkey = await dirKp.getPublicKey();

    const { relay: relayNode, node: relayLibp2p, stop: stopRelay } = await createRelayNode({
      directoryPubkey: dirPubkey,
    });
    scope.addCleanup(stopRelay);

    const relayPeerId = relayLibp2p.getPeerId();
    const relayMultiaddrs = relayLibp2p.listenAddresses();

    const networkAdapter = new NetworkRelayAdapter({
      keyProvider: dirKp,
      relayPeerId,
      relayMultiaddrs,
    });

    const dirResult = await createDirectoryNode({
      keyProvider: dirKp,
      relay: networkAdapter,
      relayEndpoint: { peer_id: relayPeerId, multiaddrs: relayMultiaddrs },
    });
    scope.addCleanup(dirResult.stop);
    await networkAdapter.connect(dirResult.node);

    // Register session, then put in sealing state
    const clientKpA = generateKeypair();
    const clientKpB = generateKeypair();
    const pubA = await clientKpA.getPublicKey();
    const pubB = await clientKpB.getPublicKey();
    const sessionId = new Uint8Array(randomBytes(16));
    const sessionTimestamp = Date.now();

    const tbs = CBOR_ENC.encode([
      sessionId, pubA, pubB,
      sessionTimestamp > 0xffffffff ? BigInt(sessionTimestamp) : sessionTimestamp,
    ]) as Uint8Array;
    const directory_signature = await dirKp.sign(tbs);
    relayNode.recordAssignment({ session_id: sessionId, participant_a: pubA, participant_b: pubB, session_timestamp: sessionTimestamp, directory_signature });
    relayNode.submitForSeal(sessionId); // move to sealing state

    // Confirm over network
    await networkAdapter.confirmSeal(sessionId);

    // Session should be destroyed
    const result = relayNode.submitForSeal(sessionId);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("session_not_found");
    }
  }, 20_000);
});

describe("AC-005: NetworkRelayAdapter.rejectSeal → relay marks seal_rejected", () => {
  let scope = createTestScope();
  beforeEach(() => { scope = createTestScope(); });
  afterEach(() => scope.run(async () => {}));

  it("relay marks seal_rejected after network reject_seal", async () => {
    const dirKp = generateKeypair();
    const dirPubkey = await dirKp.getPublicKey();

    const { relay: relayNode, node: relayLibp2p, stop: stopRelay } = await createRelayNode({
      directoryPubkey: dirPubkey,
    });
    scope.addCleanup(stopRelay);

    const relayPeerId = relayLibp2p.getPeerId();
    const relayMultiaddrs = relayLibp2p.listenAddresses();

    const networkAdapter = new NetworkRelayAdapter({
      keyProvider: dirKp,
      relayPeerId,
      relayMultiaddrs,
    });

    const dirResult = await createDirectoryNode({
      keyProvider: dirKp,
      relay: networkAdapter,
      relayEndpoint: { peer_id: relayPeerId, multiaddrs: relayMultiaddrs },
    });
    scope.addCleanup(dirResult.stop);
    await networkAdapter.connect(dirResult.node);

    // Register session
    const clientKpA = generateKeypair();
    const clientKpB = generateKeypair();
    const pubA = await clientKpA.getPublicKey();
    const pubB = await clientKpB.getPublicKey();
    const sessionId = new Uint8Array(randomBytes(16));
    const sessionTimestamp = Date.now();

    const tbs = CBOR_ENC.encode([
      sessionId, pubA, pubB,
      sessionTimestamp > 0xffffffff ? BigInt(sessionTimestamp) : sessionTimestamp,
    ]) as Uint8Array;
    const directory_signature = await dirKp.sign(tbs);
    relayNode.recordAssignment({ session_id: sessionId, participant_a: pubA, participant_b: pubB, session_timestamp: sessionTimestamp, directory_signature });

    // Reject over network
    await networkAdapter.rejectSeal(sessionId, "merkle_root_mismatch");

    // Session should be seal_rejected: submitForSeal returns session_not_active
    const result = relayNode.submitForSeal(sessionId);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // seal_rejected sessions return session_not_active (status !== 'active')
      expect(result.reason).toBe("session_not_active");
    }
  }, 20_000);
});

// AC-007 (full end-to-end session flow) lives in:
// packages/e2e-tests/src/__tests__/node-004-e2e.test.ts
