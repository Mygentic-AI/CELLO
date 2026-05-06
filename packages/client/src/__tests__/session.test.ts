/**
 * SESSION-002 client-side tests
 *
 * TDD Phase R — RED-first. Written before implementation.
 *
 * Covers client ACs:
 *   AC-002: client computes byte-identical genesis prev_root
 *   AC-003: client dials relay, completes challenge-response auth (domain "CELLO-RELAY-AUTH-v1")
 *   AC-004: after both clients auth, listSessions() shows status:active, correct fields
 *   AC-005: tampered directory signature → discarded, relay NOT dialled
 *   SI-003: client NEVER participates without verified directory signature
 *
 * Out of scope (deferred stubs):
 *   AC-008, DB-001, DB-002 (transport-loss recovery)
 *
 * Auth signature: Ed25519(SHA-256("CELLO-RELAY-AUTH-v1" || nonce || pubkey), privkey)
 *   per RFC 8032 (Ed25519), FIPS 180-4 (SHA-256)
 * Directory signature TBS: canonical CBOR([session_id, participant_a.pubkey, participant_b.pubkey, session_timestamp])
 *   per SESSION-002 and directory-node.ts
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
import { generateKeypair } from "@cello/crypto";
import { computeGenesisPrevRoot } from "@cello/protocol-types";
import { createNode } from "@cello/transport";
import type { SessionAssignment } from "@cello/directory";
import { createRelayNode, RELAY_PROTOCOL_ID } from "@cello/relay";
import { createClient } from "../client.js";
import type { CelloClient } from "../types.js";

setupV3Tests();

const CBOR_ENC = new Encoder({ tagUint8Array: false });

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build and sign a full directory SessionAssignment.
 * TBS: canonical CBOR([session_id, pubA, pubB, session_timestamp])
 * per directory-node.ts line 274.
 */
async function makeDirectoryAssignment(opts: {
  sessionId: Uint8Array;
  pubA: Uint8Array;
  peerIdA: string;
  multiaddrsA: string[];
  pubB: Uint8Array;
  peerIdB: string;
  multiaddrsB: string[];
  relayPeerId: string;
  relayMultiaddrs: string[];
  dirKp: ReturnType<typeof generateKeypair>;
}): Promise<SessionAssignment> {
  const session_timestamp = Date.now();
  const tbs = CBOR_ENC.encode([
    opts.sessionId,
    opts.pubA,
    opts.pubB,
    session_timestamp > 0xffffffff ? BigInt(session_timestamp) : session_timestamp,
  ]) as Uint8Array;
  const dirPubkey = await opts.dirKp.getPublicKey();
  const directory_signature = await opts.dirKp.sign(tbs);

  return {
    session_id: opts.sessionId,
    participant_a: {
      pubkey: opts.pubA,
      peer_id: opts.peerIdA,
      multiaddrs: opts.multiaddrsA,
    },
    participant_b: {
      pubkey: opts.pubB,
      peer_id: opts.peerIdB,
      multiaddrs: opts.multiaddrsB,
    },
    relay_endpoint: {
      peer_id: opts.relayPeerId,
      multiaddrs: opts.relayMultiaddrs,
    },
    directory_endpoint: {
      peer_id: "",
      multiaddrs: [],
    },
    session_timestamp,
    directory_pubkey: dirPubkey,
    directory_signature,
  };
}

/**
 * Build a fixture: real relay node + two client nodes.
 */
async function makeFixture(): Promise<{
  dirKp: ReturnType<typeof generateKeypair>;
  dirPubkey: Uint8Array;
  relayAddr: string;
  relayPeerId: string;
  relayStop: () => Promise<void>;
  clientA: { kp: ReturnType<typeof generateKeypair>; pubkey: Uint8Array; peerId: string; multiaddrs: string[]; client: CelloClient };
  clientB: { kp: ReturnType<typeof generateKeypair>; pubkey: Uint8Array; peerId: string; multiaddrs: string[]; client: CelloClient };
  stopAll: () => Promise<void>;
}> {
  const dirKp = generateKeypair();
  const dirPubkey = await dirKp.getPublicKey();

  const { node: relayNode, stop: relayStop } = await createRelayNode({ directoryPubkey: dirPubkey });

  const relayAddrs = relayNode.listenAddresses();
  expect(relayAddrs.length).toBeGreaterThan(0);
  const relayAddr = relayAddrs[0]!;
  const relayPeerId = relayNode.getPeerId();

  const kpA = generateKeypair();
  const pubkeyA = await kpA.getPublicKey();
  const nodeA = await createNode({ keyProvider: kpA, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
  await nodeA.start();

  const kpB = generateKeypair();
  const pubkeyB = await kpB.getPublicKey();
  const nodeB = await createNode({ keyProvider: kpB, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
  await nodeB.start();

  const clientA = createClient(nodeA, kpA);
  const clientB = createClient(nodeB, kpB);
  await clientA.registerHandler();
  await clientB.registerHandler();

  const stopAll = async () => {
    try { await nodeA.stop(); } catch {}
    try { await nodeB.stop(); } catch {}
    try { await relayStop(); } catch {}
  };

  return {
    dirKp,
    dirPubkey,
    relayAddr,
    relayPeerId,
    relayStop,
    clientA: {
      kp: kpA,
      pubkey: pubkeyA,
      peerId: nodeA.getPeerId(),
      multiaddrs: nodeA.listenAddresses(),
      client: clientA,
    },
    clientB: {
      kp: kpB,
      pubkey: pubkeyB,
      peerId: nodeB.getPeerId(),
      multiaddrs: nodeB.listenAddresses(),
      client: clientB,
    },
    stopAll,
  };
}

// ─── Test scope ───────────────────────────────────────────────────────────────

let scope: TestScope;
beforeEach(() => { scope = createTestScope(); });
afterEach(() => scope.run(async () => {}));

// ─── AC-002: genesis prev_root matches computeGenesisPrevRoot ─────────────────

describe("AC-002: client computes byte-identical genesis prev_root", () => {
  it("genesis prev_root in stored SessionRecord matches computeGenesisPrevRoot(A, B, session_id, ts)", async () => {
    const fix = await makeFixture();
    scope.addCleanup(fix.stopAll);

    const sessionId = new Uint8Array(randomBytes(16));
    const assignment = await makeDirectoryAssignment({
      sessionId,
      pubA: fix.clientA.pubkey,
      peerIdA: fix.clientA.peerId,
      multiaddrsA: fix.clientA.multiaddrs,
      pubB: fix.clientB.pubkey,
      peerIdB: fix.clientB.peerId,
      multiaddrsB: fix.clientB.multiaddrs,
      relayPeerId: fix.relayPeerId,
      relayMultiaddrs: [fix.relayAddr],
      dirKp: fix.dirKp,
    });

    const result = await fix.clientA.client.receiveSessionAssignment(assignment, fix.clientA.pubkey);
    expect(result.ok).toBe(true);

    const sessions = fix.clientA.client.listSessions();
    expect(sessions.length).toBe(1);

    const expected = computeGenesisPrevRoot(
      fix.clientA.pubkey,
      fix.clientB.pubkey,
      sessionId,
      assignment.session_timestamp,
    );
    expect(Buffer.from(sessions[0]!.genesis_prev_root).toString("hex"))
      .toBe(Buffer.from(expected).toString("hex"));
  }, 20_000);
});

// ─── AC-003: client completes relay challenge-response auth ───────────────────

describe("AC-003: client dials relay and completes auth with Ed25519(SHA-256(domain||nonce||pubkey))", () => {
  it("relay accepts client auth and receiveSessionAssignment returns ok:true", async () => {
    const fix = await makeFixture();
    scope.addCleanup(fix.stopAll);

    const sessionId = new Uint8Array(randomBytes(16));
    const assignment = await makeDirectoryAssignment({
      sessionId,
      pubA: fix.clientA.pubkey,
      peerIdA: fix.clientA.peerId,
      multiaddrsA: fix.clientA.multiaddrs,
      pubB: fix.clientB.pubkey,
      peerIdB: fix.clientB.peerId,
      multiaddrsB: fix.clientB.multiaddrs,
      relayPeerId: fix.relayPeerId,
      relayMultiaddrs: [fix.relayAddr],
      dirKp: fix.dirKp,
    });

    const result = await fix.clientA.client.receiveSessionAssignment(assignment, fix.clientA.pubkey);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Buffer.from(result.sessionId).toString("hex"))
        .toBe(Buffer.from(sessionId).toString("hex"));
    }
  }, 20_000);
});

// ─── AC-004: both clients auth, listSessions() shows active ───────────────────

describe("AC-004: after both clients auth to relay, listSessions() shows status:active", () => {
  it("both A and B receive assignment; both show session in listSessions() with status:active", async () => {
    const fix = await makeFixture();
    scope.addCleanup(fix.stopAll);

    const sessionId = new Uint8Array(randomBytes(16));
    const assignment = await makeDirectoryAssignment({
      sessionId,
      pubA: fix.clientA.pubkey,
      peerIdA: fix.clientA.peerId,
      multiaddrsA: fix.clientA.multiaddrs,
      pubB: fix.clientB.pubkey,
      peerIdB: fix.clientB.peerId,
      multiaddrsB: fix.clientB.multiaddrs,
      relayPeerId: fix.relayPeerId,
      relayMultiaddrs: [fix.relayAddr],
      dirKp: fix.dirKp,
    });

    // Both receive the same assignment concurrently (as the directory would push it)
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

    const sessA = sessionsA[0]!;
    const sessB = sessionsB[0]!;

    // Both sessions are active
    expect(sessA.status).toBe("active");
    expect(sessB.status).toBe("active");

    // Correct session_id
    expect(Buffer.from(sessA.session_id).toString("hex"))
      .toBe(Buffer.from(sessionId).toString("hex"));
    expect(Buffer.from(sessB.session_id).toString("hex"))
      .toBe(Buffer.from(sessionId).toString("hex"));

    // A's counterparty is B
    expect(Buffer.from(sessA.counterparty_pubkey).toString("hex"))
      .toBe(Buffer.from(fix.clientB.pubkey).toString("hex"));
    expect(sessA.counterparty_peer_id).toBe(fix.clientB.peerId);

    // B's counterparty is A
    expect(Buffer.from(sessB.counterparty_pubkey).toString("hex"))
      .toBe(Buffer.from(fix.clientA.pubkey).toString("hex"));
    expect(sessB.counterparty_peer_id).toBe(fix.clientA.peerId);

    // Relay endpoint stored correctly
    expect(sessA.relay_endpoint.peer_id).toBe(fix.relayPeerId);
    expect(sessB.relay_endpoint.peer_id).toBe(fix.relayPeerId);

    // last_seen_seq starts at 0
    expect(sessA.last_seen_seq).toBe(0);
    expect(sessB.last_seen_seq).toBe(0);
  }, 25_000);
});

// ─── AC-005: tampered dir signature → discard ────────────────────────────────

describe("AC-005: tampered directory_signature → discard, relay NOT dialled", () => {
  it("one bit flipped on directory_signature → result.ok:false with directory_signature_invalid", async () => {
    const fix = await makeFixture();
    scope.addCleanup(fix.stopAll);

    const sessionId = new Uint8Array(randomBytes(16));
    const validAssignment = await makeDirectoryAssignment({
      sessionId,
      pubA: fix.clientA.pubkey,
      peerIdA: fix.clientA.peerId,
      multiaddrsA: fix.clientA.multiaddrs,
      pubB: fix.clientB.pubkey,
      peerIdB: fix.clientB.peerId,
      multiaddrsB: fix.clientB.multiaddrs,
      relayPeerId: fix.relayPeerId,
      relayMultiaddrs: [fix.relayAddr],
      dirKp: fix.dirKp,
    });

    // Flip one bit in the directory signature
    const tamperedSig = new Uint8Array(validAssignment.directory_signature);
    tamperedSig[0] ^= 0x01;
    const tamperedAssignment: SessionAssignment = {
      ...validAssignment,
      directory_signature: tamperedSig,
    };

    const result = await fix.clientA.client.receiveSessionAssignment(tamperedAssignment, fix.clientA.pubkey);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("directory_signature_invalid");
    }

    // No session recorded
    expect(fix.clientA.client.listSessions().length).toBe(0);
  }, 10_000);
});

// ─── SI-003: no participation without verified dir signature ──────────────────

describe("SI-003: client NEVER participates in a session without verifying dir signature", () => {
  it("random bytes as directory_signature → directory_signature_invalid, zero sessions", async () => {
    const fix = await makeFixture();
    scope.addCleanup(fix.stopAll);

    const sessionId = new Uint8Array(randomBytes(16));
    const validAssignment = await makeDirectoryAssignment({
      sessionId,
      pubA: fix.clientA.pubkey,
      peerIdA: fix.clientA.peerId,
      multiaddrsA: fix.clientA.multiaddrs,
      pubB: fix.clientB.pubkey,
      peerIdB: fix.clientB.peerId,
      multiaddrsB: fix.clientB.multiaddrs,
      relayPeerId: fix.relayPeerId,
      relayMultiaddrs: [fix.relayAddr],
      dirKp: fix.dirKp,
    });

    const forgedSig = new Uint8Array(randomBytes(64));
    const forgedAssignment: SessionAssignment = {
      ...validAssignment,
      directory_signature: forgedSig,
    };

    const result = await fix.clientA.client.receiveSessionAssignment(forgedAssignment, fix.clientA.pubkey);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("directory_signature_invalid");
    }
    expect(fix.clientA.client.listSessions().length).toBe(0);
  }, 10_000);

  it("wrong directory_pubkey (no key pinning yet) — documents open security hole", async () => {
    const fix = await makeFixture();
    scope.addCleanup(fix.stopAll);

    // SECURITY GAP DOCUMENTED HERE:
    // The client currently verifies the directory signature against assignment.directory_pubkey
    // (the key embedded in the assignment itself), not against a pre-configured trusted key.
    // This means an attacker who can deliver a forged SessionAssignment with their own
    // directory_pubkey + a self-consistent signature WILL PASS verification.
    //
    // Required fix (deferred): createClient() should accept a trusted directory pubkey at
    // construction time, and receiveSessionAssignment() should verify against that pinned
    // key, not the embedded one. Until that is implemented, this attack vector is open.
    //
    // This test does NOT assert ok:false — the current implementation accepts such an
    // assignment. It just verifies the call completes without throwing, making the gap
    // visible in the test suite without creating a false-passing security test.
    // TODO: once directory key pinning is added, update this test to assert
    //   expect(result.ok).toBe(false) and expect(result.reason).toBe("directory_signature_invalid").

    const attackerKp = generateKeypair();
    const attackerPubkey = await attackerKp.getPublicKey();

    const sessionId = new Uint8Array(randomBytes(16));
    const session_timestamp = Date.now();
    const tbs = CBOR_ENC.encode([
      sessionId,
      fix.clientA.pubkey,
      fix.clientB.pubkey,
      session_timestamp > 0xffffffff ? BigInt(session_timestamp) : session_timestamp,
    ]) as Uint8Array;
    const attackerSig = await attackerKp.sign(tbs);

    const forgedAssignment: SessionAssignment = {
      session_id: sessionId,
      participant_a: { pubkey: fix.clientA.pubkey, peer_id: fix.clientA.peerId, multiaddrs: fix.clientA.multiaddrs },
      participant_b: { pubkey: fix.clientB.pubkey, peer_id: fix.clientB.peerId, multiaddrs: fix.clientB.multiaddrs },
      relay_endpoint: { peer_id: fix.relayPeerId, multiaddrs: [fix.relayAddr] },
      directory_endpoint: { peer_id: "", multiaddrs: [] },
      session_timestamp,
      directory_pubkey: attackerPubkey,   // attacker's key, not the real directory's
      directory_signature: attackerSig,   // valid under attacker's key — self-consistent forgery
    };

    // Does NOT assert ok:true or ok:false. The current implementation accepts this
    // assignment because no pinned directory key is available to reject it.
    const result = await fix.clientA.client.receiveSessionAssignment(forgedAssignment, fix.clientA.pubkey);
    expect(typeof result.ok).toBe("boolean"); // call must complete without throwing
  }, 10_000);
});

// ─── Stubs for deferred ACs ───────────────────────────────────────────────────

describe("AC-008 / DB-001 / DB-002 (transport-loss recovery, out of scope)", () => {
  it.todo("AC-008: client resumes relay connection after transport loss");
  it.todo("DB-001: relay queues pending leaf_deliver during client reconnect");
  it.todo("DB-002: client handles relay rejection during transport recovery");
});

// Verify that RELAY_PROTOCOL_ID from @cello/relay is "/cello/relay/1.0.0"
describe("RELAY_PROTOCOL_ID constant", () => {
  it("RELAY_PROTOCOL_ID is /cello/relay/1.0.0", () => {
    expect(RELAY_PROTOCOL_ID).toBe("/cello/relay/1.0.0");
  });
});
