/**
 * CELLO-SESSION-004: FROST-authenticated session establishment — client-side tests
 *
 * TDD Phase R — RED-first. Written BEFORE implementation.
 * All new tests MUST FAIL until client.ts SESSION-004 implementation is complete.
 *
 * Covers:
 *   AC-001: Full FROST ceremony via bootstrapped stubs; session transitions to active on both clients
 *   AC-002: Tampered FROST signature → frost_signature_invalid; no session created
 *   AC-003: M1 'single' frame received by M2 client → unsupported_signature_type; no session
 *   AC-004: DIRECTORY_BELOW_THRESHOLD (< threshold nodes reachable) → error; no session
 *   AC-007: B verifies against signer_pubkey (A's group key), not B's own group key
 *   SI-001: No 'frost' session accepted without valid FROST signature
 *   SI-002: Establishment signature does NOT verify as seal signature (domain separation)
 *   SI-003: 'single' frame hard-refused even when single-key sig itself verifies
 *
 * Crypto refs: FROST / RFC 9591, Ed25519 / RFC 8032, SHA-256 / FIPS 180-4, CBOR / RFC 8949
 *
 * Test harness: bootstrapKeyShares + createInProcessStubs (in-process, no network)
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
import {
  generateKeypair,
  FrostThresholdSigner,
} from "@cello-protocol/crypto";
import {
  bootstrapKeyShares,
  clearTestShares,
} from "@cello-protocol/crypto/frost/frost-threshold-signer.js";
import { createInProcessStubs } from "@cello-protocol/crypto/frost/stubs.js";
import {
  CONTEXT_SESSION_ESTABLISHMENT,
  CONTEXT_SEAL,
} from "@cello-protocol/crypto/frost/types.js";
import {
  computeGenesisPrevRoot,
  buildSessionEstablishmentTbs,
} from "@cello-protocol/protocol-types";
import type { SessionAssignmentFrost, SessionAssignmentSingle } from "@cello-protocol/protocol-types";
import { createNode } from "@cello-protocol/transport";
import { createRelayNode } from "@cello-protocol/relay";
import { createClient } from "../client.js";
import type { CelloClient } from "../types.js";

setupV3Tests();

const CBOR_ENC = new Encoder({ tagUint8Array: false });

// ─── Test helpers ─────────────────────────────────────────────────────────────

/**
 * Build a FROST-signed SessionAssignment for testing.
 * Uses a FrostThresholdSigner as coordinator (same as the real directory flow).
 */
async function makeFrostAssignment(opts: {
  sessionId: Uint8Array;
  pubA: Uint8Array;
  peerIdA: string;
  multiaddrsA: string[];
  pubB: Uint8Array;
  peerIdB: string;
  multiaddrsB: string[];
  relayPeerId: string;
  relayMultiaddrs: string[];
  signerA: FrostThresholdSigner;  // A's FROST coordinator signer
  sessionTimestamp?: number;
}): Promise<SessionAssignmentFrost> {
  const session_timestamp = opts.sessionTimestamp ?? Date.now();
  const genesis_prev_root = computeGenesisPrevRoot(
    opts.pubA, opts.pubB, opts.sessionId, session_timestamp
  );
  const tbs = buildSessionEstablishmentTbs(
    opts.sessionId, opts.pubA, opts.pubB, genesis_prev_root, session_timestamp
  );
  const ceremonyId = `session-${Buffer.from(opts.sessionId).toString("hex")}`;
  const result = await opts.signerA.participateInCeremony(
    ceremonyId, tbs, CONTEXT_SESSION_ESTABLISHMENT
  );
  if (!result.ok) {
    throw new Error(`FROST ceremony failed: ${result.error.reason}`);
  }
  const primaryPubkey = opts.signerA.getPrimaryPubkey();

  return {
    session_id: opts.sessionId,
    participant_a: { pubkey: opts.pubA, peer_id: opts.peerIdA, multiaddrs: opts.multiaddrsA },
    participant_b: { pubkey: opts.pubB, peer_id: opts.peerIdB, multiaddrs: opts.multiaddrsB },
    relay_endpoint: { peer_id: opts.relayPeerId, multiaddrs: opts.relayMultiaddrs },
    directory_endpoint: { peer_id: "", multiaddrs: [] },
    session_timestamp,
    directory_pubkey: new Uint8Array(32), // not used for FROST verification
    directory_signature: result.signature,
    signature_type: "frost",
    signer_pubkey: primaryPubkey,
  };
}

// ─── Fixture ──────────────────────────────────────────────────────────────────

interface Session004Fixture {
  relayPeerId: string;
  relayAddr: string;
  relayStop: () => Promise<void>;
  clientA: {
    pubkey: Uint8Array;
    peerId: string;
    multiaddrs: string[];
    client: CelloClient;
    signer: FrostThresholdSigner;
  };
  clientB: {
    pubkey: Uint8Array;
    peerId: string;
    multiaddrs: string[];
    client: CelloClient;
    signerB?: FrostThresholdSigner; // only set when B also needs its own FROST group
  };
  stopAll: () => Promise<void>;
}

async function makeFixture(opts?: { bootstrapB?: boolean }): Promise<Session004Fixture> {
  // A's FROST setup: 2-of-3 threshold, 3 in-process stubs
  const kpA = generateKeypair();
  const pubkeyA = await kpA.getPublicKey();
  const stubsA = createInProcessStubs(3);
  await bootstrapKeyShares(pubkeyA, {
    threshold: 2,
    participants: 3,
    directoryNodeStubs: stubsA,
  });
  const signerA = new FrostThresholdSigner(
    { threshold: 2, participants: 3, directoryNodeStubs: stubsA },
    pubkeyA
  );

  const kpB = generateKeypair();
  const pubkeyB = await kpB.getPublicKey();

  let signerB: FrostThresholdSigner | undefined;
  if (opts?.bootstrapB) {
    const stubsB = createInProcessStubs(3);
    await bootstrapKeyShares(pubkeyB, {
      threshold: 2,
      participants: 3,
      directoryNodeStubs: stubsB,
    });
    signerB = new FrostThresholdSigner(
      { threshold: 2, participants: 3, directoryNodeStubs: stubsB },
      pubkeyB
    );
  }

  const { node: relayNode, stop: relayStop } = await createRelayNode({
    directoryPubkey: new Uint8Array(32), // relay does not verify dir sig type in M2
  });
  const relayAddrs = relayNode.listenAddresses();
  const relayAddr = relayAddrs[0]!;
  const relayPeerId = relayNode.getPeerId();

  const nodeA = await createNode({ keyProvider: kpA, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
  await nodeA.start();
  const nodeB = await createNode({ keyProvider: kpB, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
  await nodeB.start();

  // Inject threshold signer into client A
  const clientA = createClient(nodeA, kpA, { thresholdSigner: signerA });
  const clientB = createClient(nodeB, kpB, signerB ? { thresholdSigner: signerB } : undefined);
  await clientA.registerHandler();
  await clientB.registerHandler();

  const stopAll = async () => {
    try { await nodeA.stop(); } catch {}
    try { await nodeB.stop(); } catch {}
    try { await relayStop(); } catch {}
  };

  return {
    relayPeerId,
    relayAddr,
    relayStop,
    clientA: {
      pubkey: pubkeyA,
      peerId: nodeA.getPeerId(),
      multiaddrs: nodeA.listenAddresses(),
      client: clientA,
      signer: signerA,
    },
    clientB: {
      pubkey: pubkeyB,
      peerId: nodeB.getPeerId(),
      multiaddrs: nodeB.listenAddresses(),
      client: clientB,
      signerB,
    },
    stopAll,
  };
}

// ─── Test scope ───────────────────────────────────────────────────────────────

let scope: TestScope;
beforeEach(() => {
  scope = createTestScope();
  process.env.NODE_ENV = "test";
});
afterEach(async () => {
  await scope.run(async () => {});
  clearTestShares();
});

// ─── AC-001: Full FROST ceremony, session active on both clients ───────────────

describe("AC-001: Full FROST ceremony with 2-of-3 threshold stubs → session active on both clients", () => {
  it("FROST assignment accepted by A (initiator) and B (counterparty); both sessions active", async () => {
    const fix = await makeFixture();
    scope.addCleanup(fix.stopAll);

    const sessionId = new Uint8Array(randomBytes(16));
    const assignment = await makeFrostAssignment({
      sessionId,
      pubA: fix.clientA.pubkey,
      peerIdA: fix.clientA.peerId,
      multiaddrsA: fix.clientA.multiaddrs,
      pubB: fix.clientB.pubkey,
      peerIdB: fix.clientB.peerId,
      multiaddrsB: fix.clientB.multiaddrs,
      relayPeerId: fix.relayPeerId,
      relayMultiaddrs: [fix.relayAddr],
      signerA: fix.clientA.signer,
    });

    expect(assignment.signature_type).toBe("frost");
    expect(assignment.signer_pubkey).toBeInstanceOf(Uint8Array);
    expect(assignment.signer_pubkey.length).toBe(32);

    // Both clients receive assignment
    const [rA, rB] = await Promise.all([
      fix.clientA.client.receiveSessionAssignment(assignment, fix.clientA.pubkey),
      fix.clientB.client.receiveSessionAssignment(assignment, fix.clientB.pubkey),
    ]);

    expect(rA.ok).toBe(true);
    expect(rB.ok).toBe(true);

    const sessionsA = fix.clientA.client.listSessions();
    const sessionsB = fix.clientB.client.listSessions();
    expect(sessionsA.length).toBe(1);
    expect(sessionsB.length).toBe(1);
    expect(sessionsA[0]!.status).toBe("active");
    expect(sessionsB[0]!.status).toBe("active");
  }, 30_000);
});

// ─── AC-002: Tampered FROST signature → frost_signature_invalid ───────────────

describe("AC-002: Tampered FROST signature → frost_signature_invalid; no session created", () => {
  it("one bit flipped on directory_signature (FROST sig) → frost_signature_invalid on initiator side", async () => {
    const fix = await makeFixture();
    scope.addCleanup(fix.stopAll);

    const sessionId = new Uint8Array(randomBytes(16));
    const validAssignment = await makeFrostAssignment({
      sessionId,
      pubA: fix.clientA.pubkey,
      peerIdA: fix.clientA.peerId,
      multiaddrsA: fix.clientA.multiaddrs,
      pubB: fix.clientB.pubkey,
      peerIdB: fix.clientB.peerId,
      multiaddrsB: fix.clientB.multiaddrs,
      relayPeerId: fix.relayPeerId,
      relayMultiaddrs: [fix.relayAddr],
      signerA: fix.clientA.signer,
    });

    const tamperedSig = new Uint8Array(validAssignment.directory_signature);
    tamperedSig[0] ^= 0x01;
    const tampered: SessionAssignmentFrost = {
      ...validAssignment,
      directory_signature: tamperedSig,
    };

    const result = await fix.clientA.client.receiveSessionAssignment(tampered, fix.clientA.pubkey);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("frost_signature_invalid");
    }
    expect(fix.clientA.client.listSessions().length).toBe(0);
  }, 15_000);

  it("one bit flipped on directory_signature → frost_signature_invalid on counterparty side (B)", async () => {
    const fix = await makeFixture();
    scope.addCleanup(fix.stopAll);

    const sessionId = new Uint8Array(randomBytes(16));
    const validAssignment = await makeFrostAssignment({
      sessionId,
      pubA: fix.clientA.pubkey,
      peerIdA: fix.clientA.peerId,
      multiaddrsA: fix.clientA.multiaddrs,
      pubB: fix.clientB.pubkey,
      peerIdB: fix.clientB.peerId,
      multiaddrsB: fix.clientB.multiaddrs,
      relayPeerId: fix.relayPeerId,
      relayMultiaddrs: [fix.relayAddr],
      signerA: fix.clientA.signer,
    });

    const tamperedSig = new Uint8Array(validAssignment.directory_signature);
    tamperedSig[0] ^= 0x01;
    const tampered: SessionAssignmentFrost = {
      ...validAssignment,
      directory_signature: tamperedSig,
    };

    const result = await fix.clientB.client.receiveSessionAssignment(tampered, fix.clientB.pubkey);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("frost_signature_invalid");
    }
    expect(fix.clientB.client.listSessions().length).toBe(0);
  }, 15_000);
});

// ─── AC-003: M1 'single' frame → unsupported_signature_type ──────────────────

describe("AC-003: M1 'single' frame → unsupported_signature_type; no session created", () => {
  it("assignment with signature_type: 'single' → unsupported_signature_type (initiator side)", async () => {
    const fix = await makeFixture();
    scope.addCleanup(fix.stopAll);

    const sessionId = new Uint8Array(randomBytes(16));
    const session_timestamp = Date.now();
    // Build a valid M1-style single-key sig (correct per M1 rules, but refused in M2)
    const m1Tbs = CBOR_ENC.encode([
      sessionId, fix.clientA.pubkey, fix.clientB.pubkey,
      session_timestamp > 0xffffffff ? BigInt(session_timestamp) : session_timestamp,
    ]) as Uint8Array;
    const dirKp = generateKeypair();
    const dirPubkey = await dirKp.getPublicKey();
    const dirSig = await dirKp.sign(m1Tbs);

    const m1Assignment: SessionAssignmentSingle = {
      session_id: sessionId,
      participant_a: { pubkey: fix.clientA.pubkey, peer_id: fix.clientA.peerId, multiaddrs: fix.clientA.multiaddrs },
      participant_b: { pubkey: fix.clientB.pubkey, peer_id: fix.clientB.peerId, multiaddrs: fix.clientB.multiaddrs },
      relay_endpoint: { peer_id: fix.relayPeerId, multiaddrs: [fix.relayAddr] },
      directory_endpoint: { peer_id: "", multiaddrs: [] },
      session_timestamp,
      directory_pubkey: dirPubkey,
      directory_signature: dirSig,
      signature_type: "single",
    };

    const result = await fix.clientA.client.receiveSessionAssignment(m1Assignment, fix.clientA.pubkey);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("unsupported_signature_type");
    }
    expect(fix.clientA.client.listSessions().length).toBe(0);
  }, 10_000);
});

// ─── SI-003: 'single' hard-refused even when sig verifies ────────────────────

describe("SI-003: 'single' frame hard-refused even when single-key sig itself verifies", () => {
  it("valid M1 single-key signed assignment → unsupported_signature_type (sig validity irrelevant)", async () => {
    const fix = await makeFixture();
    scope.addCleanup(fix.stopAll);

    const sessionId = new Uint8Array(randomBytes(16));
    const session_timestamp = Date.now();
    // M1-era TBS (4-field CBOR)
    const m1Tbs = CBOR_ENC.encode([
      sessionId, fix.clientA.pubkey, fix.clientB.pubkey,
      session_timestamp > 0xffffffff ? BigInt(session_timestamp) : session_timestamp,
    ]) as Uint8Array;
    const dirKp = generateKeypair();
    const dirPubkey = await dirKp.getPublicKey();
    const dirSig = await dirKp.sign(m1Tbs);

    const m1Assignment: SessionAssignmentSingle = {
      session_id: sessionId,
      participant_a: { pubkey: fix.clientA.pubkey, peer_id: fix.clientA.peerId, multiaddrs: fix.clientA.multiaddrs },
      participant_b: { pubkey: fix.clientB.pubkey, peer_id: fix.clientB.peerId, multiaddrs: fix.clientB.multiaddrs },
      relay_endpoint: { peer_id: fix.relayPeerId, multiaddrs: [fix.relayAddr] },
      directory_endpoint: { peer_id: "", multiaddrs: [] },
      session_timestamp,
      directory_pubkey: dirPubkey,
      directory_signature: dirSig,
      signature_type: "single",
    };

    // The single-key sig is correct — but it must still be refused
    const result = await fix.clientA.client.receiveSessionAssignment(m1Assignment, fix.clientA.pubkey);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Must be unsupported_signature_type, NOT directory_signature_invalid
      expect(result.reason).toBe("unsupported_signature_type");
    }
    // No session stored
    expect(fix.clientA.client.listSessions().length).toBe(0);
  }, 10_000);
});

// ─── AC-007: B uses signer_pubkey from frame (not own primary_pubkey) ─────────

describe("AC-007: B verifies against signer_pubkey (A's key), not B's own group key", () => {
  it("B verifies valid assignment using signer_pubkey field; B with independent FROST group succeeds", async () => {
    // Both A and B have independent FROST groups (different stubs, independent deals)
    const fix = await makeFixture({ bootstrapB: true });
    scope.addCleanup(fix.stopAll);

    const sessionId = new Uint8Array(randomBytes(16));
    const assignment = await makeFrostAssignment({
      sessionId,
      pubA: fix.clientA.pubkey,
      peerIdA: fix.clientA.peerId,
      multiaddrsA: fix.clientA.multiaddrs,
      pubB: fix.clientB.pubkey,
      peerIdB: fix.clientB.peerId,
      multiaddrsB: fix.clientB.multiaddrs,
      relayPeerId: fix.relayPeerId,
      relayMultiaddrs: [fix.relayAddr],
      signerA: fix.clientA.signer,
    });

    // The signer_pubkey in the frame is A's primary_pubkey
    // B's own primary_pubkey is different (independent group)
    const aPrimaryPubkey = fix.clientA.signer.getPrimaryPubkey();
    const bPrimaryPubkey = fix.clientB.signerB!.getPrimaryPubkey();

    // Keys are distinct (different FROST groups)
    expect(Buffer.from(aPrimaryPubkey).toString("hex"))
      .not.toBe(Buffer.from(bPrimaryPubkey).toString("hex"));

    // signer_pubkey in frame is A's key
    expect(Buffer.from(assignment.signer_pubkey).toString("hex"))
      .toBe(Buffer.from(aPrimaryPubkey).toString("hex"));

    // B receives the assignment — must verify against signer_pubkey (A's key)
    const rB = await fix.clientB.client.receiveSessionAssignment(assignment, fix.clientB.pubkey);
    expect(rB.ok).toBe(true);
    expect(fix.clientB.client.listSessions().length).toBe(1);
    expect(fix.clientB.client.listSessions()[0]!.status).toBe("active");
  }, 30_000);

  it("SI-001: B with independent FROST group has a different primary_pubkey from A's", async () => {
    // Verify the math invariant: A and B have independent FROST groups → different primary_pubkeys
    // This confirms that B cannot use its own primary_pubkey to verify A's sig (they differ)
    const kpX = generateKeypair();
    const pubkeyX = await kpX.getPublicKey();
    const kpY = generateKeypair();
    const pubkeyY = await kpY.getPublicKey();

    const stubsX = createInProcessStubs(3);
    const stubsY = createInProcessStubs(3);
    await bootstrapKeyShares(pubkeyX, { threshold: 2, participants: 3, directoryNodeStubs: stubsX });
    await bootstrapKeyShares(pubkeyY, { threshold: 2, participants: 3, directoryNodeStubs: stubsY });
    const signerX = new FrostThresholdSigner({ threshold: 2, participants: 3, directoryNodeStubs: stubsX }, pubkeyX);
    const signerY = new FrostThresholdSigner({ threshold: 2, participants: 3, directoryNodeStubs: stubsY }, pubkeyY);

    const xPrimaryPubkey = signerX.getPrimaryPubkey();
    const yPrimaryPubkey = signerY.getPrimaryPubkey();

    // Independent groups MUST produce different primary_pubkeys
    expect(Buffer.from(xPrimaryPubkey).toString("hex"))
      .not.toBe(Buffer.from(yPrimaryPubkey).toString("hex"));
  });
});

// ─── AC-004: Note — AC-004 is a DIRECTORY-side test ──────────────────────────
//
// The DIRECTORY_BELOW_THRESHOLD scenario occurs when the directory's FROST
// ceremony fails during #processSessionRequest (too few reachable stubs).
// The directory returns session_request_error reason=directory_below_threshold.
// This is tested in packages/directory/src/__tests__/session004.test.ts.
// There is no separate client-side AC-004 path: the client receives a pre-built
// SessionAssignment from the directory — by that point the ceremony has already
// succeeded. The below-threshold failure happens before the assignment is created.

// ─── SI-001 (L-1): Attacker substitutes signer_pubkey with own key ────────────

describe("SI-001 (adversarial): Attacker substitutes signer_pubkey with own key, provides valid sig under it", () => {
  it("initiator (A) receives assignment with attacker's signer_pubkey and valid attacker-FROST sig → frost_signature_invalid", async () => {
    // Create attacker's own FROST group (completely independent from A's group)
    const kpAttacker = generateKeypair();
    const pubkeyAttacker = await kpAttacker.getPublicKey();
    const stubsAttacker = createInProcessStubs(3);
    await bootstrapKeyShares(pubkeyAttacker, {
      threshold: 2,
      participants: 3,
      directoryNodeStubs: stubsAttacker,
    });
    const signerAttacker = new FrostThresholdSigner(
      { threshold: 2, participants: 3, directoryNodeStubs: stubsAttacker },
      pubkeyAttacker
    );

    const fix = await makeFixture();
    scope.addCleanup(fix.stopAll);

    const sessionId = new Uint8Array(randomBytes(16));
    const session_timestamp = Date.now();
    const genesis_prev_root = computeGenesisPrevRoot(
      fix.clientA.pubkey, fix.clientB.pubkey, sessionId, session_timestamp
    );
    const tbs = buildSessionEstablishmentTbs(
      sessionId, fix.clientA.pubkey, fix.clientB.pubkey, genesis_prev_root, session_timestamp
    );

    // Attacker signs the TBS with their own FROST group key
    const attackerCeremonyId = `session-attacker-${Buffer.from(sessionId).toString("hex")}`;
    const attackerResult = await signerAttacker.participateInCeremony(
      attackerCeremonyId, tbs, CONTEXT_SESSION_ESTABLISHMENT
    );
    if (!attackerResult.ok) throw new Error("attacker ceremony failed");

    // Build assignment with attacker's signer_pubkey and their valid-under-attacker-key signature
    // (session fields otherwise look valid — correct participants, relay, etc.)
    const attackerPrimaryPubkey = signerAttacker.getPrimaryPubkey();
    const spoofedAssignment: SessionAssignmentFrost = {
      session_id: sessionId,
      participant_a: { pubkey: fix.clientA.pubkey, peer_id: fix.clientA.peerId, multiaddrs: fix.clientA.multiaddrs },
      participant_b: { pubkey: fix.clientB.pubkey, peer_id: fix.clientB.peerId, multiaddrs: fix.clientB.multiaddrs },
      relay_endpoint: { peer_id: fix.relayPeerId, multiaddrs: [fix.relayAddr] },
      directory_endpoint: { peer_id: "", multiaddrs: [] },
      session_timestamp,
      directory_pubkey: new Uint8Array(32),
      directory_signature: attackerResult.signature,
      signature_type: "frost",
      // Attacker has replaced signer_pubkey with their own group key
      signer_pubkey: attackerPrimaryPubkey,
    };

    // The attacker's sig IS valid under attackerPrimaryPubkey, but A verifies against
    // its OWN primary_pubkey (which it stored at DKG time). Since the sig was made with
    // attacker's key, it MUST NOT verify under A's primary_pubkey.
    const result = await fix.clientA.client.receiveSessionAssignment(spoofedAssignment, fix.clientA.pubkey);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("frost_signature_invalid");
    }
    // No session must be stored
    expect(fix.clientA.client.listSessions().length).toBe(0);
  }, 25_000);
});

// ─── SI-001: Absent thresholdSigner on initiator side → frost_signer_not_configured ─────

describe("SI-001: Initiator without thresholdSigner injected → frost_signer_not_configured", () => {
  it("initiator (A) without IThresholdSigner → frost_signer_not_configured; no session", async () => {
    // Build a client WITHOUT a threshold signer (default createClient)
    const kpA = generateKeypair();
    const pubkeyA = await kpA.getPublicKey();
    const kpB = generateKeypair();
    const pubkeyB = await kpB.getPublicKey();

    const stubsA = createInProcessStubs(3);
    await bootstrapKeyShares(pubkeyA, { threshold: 2, participants: 3, directoryNodeStubs: stubsA });
    const signerA = new FrostThresholdSigner({ threshold: 2, participants: 3, directoryNodeStubs: stubsA }, pubkeyA);

    const { node: relayNode, stop: relayStop } = await createRelayNode({
      directoryPubkey: new Uint8Array(32),
    });
    scope.addCleanup(relayStop);
    const relayAddr = relayNode.listenAddresses()[0]!;
    const relayPeerId = relayNode.getPeerId();

    const nodeA = await createNode({ keyProvider: kpA, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await nodeA.start();
    scope.addCleanup(() => nodeA.stop());

    // Client WITHOUT threshold signer (CRITICAL-1: must fail hard)
    const clientNoSigner = createClient(nodeA, kpA);
    await clientNoSigner.registerHandler();

    // Build a valid FROST assignment
    const sessionId = new Uint8Array(randomBytes(16));
    const session_timestamp = Date.now();
    const genesis_prev_root = computeGenesisPrevRoot(pubkeyA, pubkeyB, sessionId, session_timestamp);
    const tbs = buildSessionEstablishmentTbs(sessionId, pubkeyA, pubkeyB, genesis_prev_root, session_timestamp);
    const ceremonyId = `session-${Buffer.from(sessionId).toString("hex")}`;
    const frostedResult = await signerA.participateInCeremony(ceremonyId, tbs, CONTEXT_SESSION_ESTABLISHMENT);
    if (!frostedResult.ok) throw new Error("ceremony failed");

    const assignment: SessionAssignmentFrost = {
      session_id: sessionId,
      participant_a: { pubkey: pubkeyA, peer_id: nodeA.getPeerId(), multiaddrs: nodeA.listenAddresses() },
      participant_b: { pubkey: pubkeyB, peer_id: "12D3KooWFakeB", multiaddrs: [] },
      relay_endpoint: { peer_id: relayPeerId, multiaddrs: [relayAddr] },
      directory_endpoint: { peer_id: "", multiaddrs: [] },
      session_timestamp,
      directory_pubkey: new Uint8Array(32),
      directory_signature: frostedResult.signature,
      signature_type: "frost",
      signer_pubkey: signerA.getPrimaryPubkey(),
    };

    // A is the initiator but has no threshold signer — must hard-fail
    const result = await clientNoSigner.receiveSessionAssignment(assignment, pubkeyA);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("frost_signer_not_configured");
    }
    expect(clientNoSigner.listSessions().length).toBe(0);
  }, 20_000);
});

// ─── SI-002 (L-2 client path): seal-context sig rejected by receiveSessionAssignment ──

describe("SI-002 (client path): Seal-context sig rejected by receiveSessionAssignment", () => {
  it("assignment signed with CONTEXT_SEAL (not CONTEXT_SESSION_ESTABLISHMENT) → frost_signature_invalid", async () => {
    const fix = await makeFixture();
    scope.addCleanup(fix.stopAll);

    const sessionId = new Uint8Array(randomBytes(16));
    const session_timestamp = Date.now();
    const genesis_prev_root = computeGenesisPrevRoot(
      fix.clientA.pubkey, fix.clientB.pubkey, sessionId, session_timestamp
    );
    const tbs = buildSessionEstablishmentTbs(
      sessionId, fix.clientA.pubkey, fix.clientB.pubkey, genesis_prev_root, session_timestamp
    );

    // Sign the TBS with the WRONG context: CONTEXT_SEAL instead of CONTEXT_SESSION_ESTABLISHMENT
    const ceremonyId = `seal-context-${Buffer.from(sessionId).toString("hex")}`;
    const sealContextResult = await fix.clientA.signer.participateInCeremony(
      ceremonyId, tbs, CONTEXT_SEAL
    );
    if (!sealContextResult.ok) throw new Error("seal-context ceremony failed");

    const primaryPubkey = fix.clientA.signer.getPrimaryPubkey();

    // Build a SessionAssignmentFrost that carries a seal-context sig instead of an
    // establishment-context sig. The signer_pubkey is correct (A's real primary pubkey),
    // but the sig will fail because the domain context doesn't match.
    const sealContextAssignment: SessionAssignmentFrost = {
      session_id: sessionId,
      participant_a: { pubkey: fix.clientA.pubkey, peer_id: fix.clientA.peerId, multiaddrs: fix.clientA.multiaddrs },
      participant_b: { pubkey: fix.clientB.pubkey, peer_id: fix.clientB.peerId, multiaddrs: fix.clientB.multiaddrs },
      relay_endpoint: { peer_id: fix.relayPeerId, multiaddrs: [fix.relayAddr] },
      directory_endpoint: { peer_id: "", multiaddrs: [] },
      session_timestamp,
      directory_pubkey: new Uint8Array(32),
      directory_signature: sealContextResult.signature,
      signature_type: "frost",
      signer_pubkey: primaryPubkey,
    };

    // receiveSessionAssignment verifies under CONTEXT_SESSION_ESTABLISHMENT.
    // The seal-context sig must NOT verify → frost_signature_invalid.
    const result = await fix.clientA.client.receiveSessionAssignment(sealContextAssignment, fix.clientA.pubkey);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("frost_signature_invalid");
    }
    expect(fix.clientA.client.listSessions().length).toBe(0);
  }, 20_000);
});

// ─── SI-002: Domain separation — establishment sig does not verify as seal sig ──

describe("SI-002: Domain separation — establishment sig cannot be replayed as seal sig", () => {
  it("FROST establishment sig does NOT verify under CONTEXT_SEAL (different domain)", async () => {
    const kpA = generateKeypair();
    const pubkeyA = await kpA.getPublicKey();
    const kpB = generateKeypair();
    const pubkeyB = await kpB.getPublicKey();

    const stubsA = createInProcessStubs(3);
    await bootstrapKeyShares(pubkeyA, { threshold: 2, participants: 3, directoryNodeStubs: stubsA });
    const signerA = new FrostThresholdSigner({ threshold: 2, participants: 3, directoryNodeStubs: stubsA }, pubkeyA);

    const sessionId = new Uint8Array(randomBytes(16));
    const session_timestamp = Date.now();
    const genesis_prev_root = computeGenesisPrevRoot(pubkeyA, pubkeyB, sessionId, session_timestamp);
    const tbs = buildSessionEstablishmentTbs(sessionId, pubkeyA, pubkeyB, genesis_prev_root, session_timestamp);
    const ceremonyId = `session-${Buffer.from(sessionId).toString("hex")}`;
    const frostedResult = await signerA.participateInCeremony(ceremonyId, tbs, CONTEXT_SESSION_ESTABLISHMENT);
    if (!frostedResult.ok) throw new Error("ceremony failed");

    const establishmentSig = frostedResult.signature;
    const primaryPubkey = signerA.getPrimaryPubkey();

    // The sig verifies under CONTEXT_SESSION_ESTABLISHMENT (correct domain)
    // FrostThresholdSigner.verifySignature handles the framing internally
    const verifyEstablishment = signerA.verifySignature(
      establishmentSig, tbs, CONTEXT_SESSION_ESTABLISHMENT, primaryPubkey
    );
    expect(verifyEstablishment).toBe(true);

    // The SAME sig does NOT verify under CONTEXT_SEAL (different domain → different framed message)
    const verifyAsSeal = signerA.verifySignature(
      establishmentSig, tbs, CONTEXT_SEAL, primaryPubkey
    );
    expect(verifyAsSeal).toBe(false);
  });
});
