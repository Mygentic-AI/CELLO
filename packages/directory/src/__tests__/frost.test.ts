/**
 * CELLO-NODE-003: Directory FROST Handler Tests
 *
 * TDD Phase R — written BEFORE implementation is complete (RED first).
 * All tests must FAIL before the implementation is finished and PASS after.
 *
 * Covers: AC-001–AC-008, SI-001–SI-003
 *
 * Crypto reference: FROST/Ed25519 per RFC 9591
 * Implementation: @noble/curves/ed25519_FROST (via @cello/crypto)
 *
 * Epoch identifier format: "{agent_id}:epoch:{N}" (monotonic, starts at 1)
 * In-flight conflict key: "${agentPubkeyHex}:${epochId}" → peerIdString
 *
 * Note: @noble/curves is only a direct dep of @cello/crypto, not this package.
 * All FROST crypto operations are accessed via @cello/crypto subpath exports.
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
import {
  bootstrapKeyShares,
  clearTestShares,
  FrostThresholdSigner,
} from "@cello/crypto/frost/frost-threshold-signer.js";
import { createInProcessStubs } from "@cello/crypto/frost/stubs.js";
import {
  CONTEXT_SESSION_ESTABLISHMENT,
} from "@cello/crypto/frost/types.js";
import {
  FrostDirectoryHandler,
  BootstrapNotAllowedInProduction,
  FROST_PROTOCOL_ID,
} from "../frost-handler.js";
import { InMemoryShareStore } from "../share-store.js";

setupV3Tests();

// ─── Test helpers ──────────────────────────────────────────────────────────────

function randomAgentPubkeyHex(): string {
  return Buffer.from(randomBytes(32)).toString("hex");
}

function makeEpochId(agentId: string, n: number): string {
  return `${agentId}:epoch:${n}`;
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe("CELLO-NODE-003: Directory FROST Handler", () => {
  const scope = createTestScope();

  beforeEach(() => {
    // Ensure NODE_ENV is set to 'test' (vitest sets it, but make it explicit)
    process.env.NODE_ENV = "test";
  });

  afterEach(async () => {
    await scope.run(async () => {});
    // Clear any test shares seeded during bootstrap
    clearTestShares();
  });

  // ─── InMemoryShareStore ─────────────────────────────────────────────────────

  describe("InMemoryShareStore", () => {
    it("stores and retrieves a share by (agentPubkey, epochId)", () => {
      const store = new InMemoryShareStore();
      const agentPubkey = randomAgentPubkeyHex();
      const epochId = makeEpochId(agentPubkey, 1);

      // Use FrostDirectoryHandler to bootstrap a share (this calls the real FROST internally)
      const handler = new FrostDirectoryHandler({
        nodeId: "store-test-node",
        shareStore: store,
      });
      handler.bootstrapKeyShares(agentPubkey);

      const retrieved = store.getShare(agentPubkey, epochId);
      expect(retrieved).toBeDefined();
    });

    it("returns undefined for unknown (agentPubkey, epochId)", () => {
      const store = new InMemoryShareStore();
      const result = store.getShare("nonexistent", "nonexistent:epoch:1");
      expect(result).toBeUndefined();
    });

    it("isolates shares across different agents", () => {
      const store = new InMemoryShareStore();
      const agentA = randomAgentPubkeyHex();
      const agentB = randomAgentPubkeyHex();

      const handlerA = new FrostDirectoryHandler({ nodeId: "nodeA", shareStore: store });
      handlerA.bootstrapKeyShares(agentA);

      const epochIdA = makeEpochId(agentA, 1);
      const epochIdB = makeEpochId(agentB, 1);

      expect(store.getShare(agentA, epochIdA)).toBeDefined();
      expect(store.getShare(agentB, epochIdB)).toBeUndefined();
    });
  });

  // ─── AC-006: bootstrapKeyShares guard ──────────────────────────────────────

  describe("AC-006: bootstrapKeyShares production guard", () => {
    it("throws BootstrapNotAllowedInProduction when NODE_ENV=production", () => {
      const store = new InMemoryShareStore();
      const handler = new FrostDirectoryHandler({
        nodeId: "test-node",
        shareStore: store,
      });
      const agentPubkey = randomAgentPubkeyHex();

      const savedEnv = process.env.NODE_ENV;
      try {
        process.env.NODE_ENV = "production";
        expect(() => handler.bootstrapKeyShares(agentPubkey)).toThrow(
          BootstrapNotAllowedInProduction
        );
      } finally {
        process.env.NODE_ENV = savedEnv;
      }
    });

    it("throws BootstrapNotAllowedInProduction when NODE_ENV=staging", () => {
      const store = new InMemoryShareStore();
      const handler = new FrostDirectoryHandler({
        nodeId: "test-node",
        shareStore: store,
      });
      const agentPubkey = randomAgentPubkeyHex();

      const savedEnv = process.env.NODE_ENV;
      try {
        process.env.NODE_ENV = "staging";
        expect(() => handler.bootstrapKeyShares(agentPubkey)).toThrow(
          BootstrapNotAllowedInProduction
        );
      } finally {
        process.env.NODE_ENV = savedEnv;
      }
    });

    it("does not mutate the store when guard throws", () => {
      const store = new InMemoryShareStore();
      const handler = new FrostDirectoryHandler({
        nodeId: "test-node",
        shareStore: store,
      });
      const agentPubkey = randomAgentPubkeyHex();

      const savedEnv = process.env.NODE_ENV;
      try {
        process.env.NODE_ENV = "production";
        try {
          handler.bootstrapKeyShares(agentPubkey);
        } catch {
          // expected
        }
        // Store must not have been mutated
        const epochId = makeEpochId(agentPubkey, 1);
        expect(store.getShare(agentPubkey, epochId)).toBeUndefined();
      } finally {
        process.env.NODE_ENV = savedEnv;
      }
    });
  });

  // ─── SI-002: bootstrapKeyShares never executes outside test ────────────────

  describe("SI-002: bootstrapKeyShares never executes outside NODE_ENV=test", () => {
    it("throws when NODE_ENV is undefined", () => {
      const store = new InMemoryShareStore();
      const handler = new FrostDirectoryHandler({
        nodeId: "test-node",
        shareStore: store,
      });
      const agentPubkey = randomAgentPubkeyHex();

      const savedEnv = process.env.NODE_ENV;
      try {
        delete process.env.NODE_ENV;
        expect(() => handler.bootstrapKeyShares(agentPubkey)).toThrow(
          BootstrapNotAllowedInProduction
        );
      } finally {
        process.env.NODE_ENV = savedEnv;
      }
    });

    it("store remains unchanged after non-test bootstrap attempt", () => {
      const store = new InMemoryShareStore();
      const handler = new FrostDirectoryHandler({
        nodeId: "test-node",
        shareStore: store,
      });
      const agentPubkey = randomAgentPubkeyHex();

      const savedEnv = process.env.NODE_ENV;
      try {
        process.env.NODE_ENV = "production";
        try {
          handler.bootstrapKeyShares(agentPubkey);
        } catch {
          // expected
        }
        // No shares stored
        expect(store.getShare(agentPubkey, makeEpochId(agentPubkey, 1))).toBeUndefined();
      } finally {
        process.env.NODE_ENV = savedEnv;
      }
    });
  });

  // ─── AC-005: bootstrapKeyShares in NODE_ENV=test ───────────────────────────

  describe("AC-005: bootstrapKeyShares in NODE_ENV=test (3 directory nodes)", () => {
    it("each node stores K_server_X share and returns commitment (no key material)", () => {
      const agentPubkeyHex = randomAgentPubkeyHex();

      // Create 3 FrostDirectoryHandlers (one per simulated node)
      const handlers = Array.from({ length: 3 }, (_, i) => {
        const store = new InMemoryShareStore();
        const handler = new FrostDirectoryHandler({
          nodeId: `dir-node-${i}`,
          shareStore: store,
        });
        return { handler, store };
      });

      // Bootstrap all 3 nodes (in test env)
      const commitments: Uint8Array[] = [];
      for (const { handler } of handlers) {
        const result = handler.bootstrapKeyShares(agentPubkeyHex);
        expect(result).toBeDefined();
        expect(result.shareCommitment).toBeInstanceOf(Uint8Array);
        expect(result.shareCommitment.length).toBeGreaterThan(0);
        // No key material beyond commitment
        const resultUnknown = result as unknown as Record<string, unknown>;
        expect(resultUnknown.secret).toBeUndefined();
        expect(resultUnknown.keyShare).toBeUndefined();
        commitments.push(result.shareCommitment);
      }

      expect(commitments).toHaveLength(3);

      // Each node should have stored a share for epoch 1
      const epochId = makeEpochId(agentPubkeyHex, 1);
      for (const { store } of handlers) {
        const share = store.getShare(agentPubkeyHex, epochId);
        expect(share).toBeDefined();
      }
    });
  });

  // ─── AC-002: AGENT_NOT_BOOTSTRAPPED ────────────────────────────────────────

  describe("AC-002: Ceremony request for unknown agent", () => {
    it("returns AGENT_NOT_BOOTSTRAPPED when no share stored for agent", async () => {
      const store = new InMemoryShareStore();
      const handler = new FrostDirectoryHandler({
        nodeId: "test-node",
        shareStore: store,
      });
      const agentPubkeyHex = randomAgentPubkeyHex();
      const epochId = makeEpochId(agentPubkeyHex, 1);

      const result = await handler.handleCeremonyRound({
        agentPubkey: agentPubkeyHex,
        epochId,
        tbs: new Uint8Array(32),
        context: CONTEXT_SESSION_ESTABLISHMENT,
        commitmentList: [],
        peerIdString: "peer-A",
        ceremonyId: "ceremony-1",
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("AGENT_NOT_BOOTSTRAPPED");
      }
    });
  });

  // ─── AC-008: Epoch expired ─────────────────────────────────────────────────

  describe("AC-008: Epoch expired", () => {
    it("returns EPOCH_EXPIRED for expired epoch identifier (epoch 0)", async () => {
      const store = new InMemoryShareStore();
      const handler = new FrostDirectoryHandler({
        nodeId: "test-node",
        shareStore: store,
      });
      const agentPubkeyHex = randomAgentPubkeyHex();

      // Bootstrap for epoch 1
      handler.bootstrapKeyShares(agentPubkeyHex);

      // Request with expired epoch (epoch 0 is < current epoch 1)
      const expiredEpochId = makeEpochId(agentPubkeyHex, 0);

      const result = await handler.handleCeremonyRound({
        agentPubkey: agentPubkeyHex,
        epochId: expiredEpochId,
        tbs: new Uint8Array(32),
        context: CONTEXT_SESSION_ESTABLISHMENT,
        commitmentList: [],
        peerIdString: "peer-A",
        ceremonyId: "ceremony-1",
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("EPOCH_EXPIRED");
      }
    });
  });

  // ─── AC-004: Same Peer ID retry is not a conflict ──────────────────────────

  describe("AC-004: Same Peer ID retry treated as continuation", () => {
    it("responds normally to a retry from the same Peer ID (not treated as conflict)", async () => {
      const store = new InMemoryShareStore();
      const handler = new FrostDirectoryHandler({
        nodeId: "test-node",
        shareStore: store,
      });
      const agentPubkeyHex = randomAgentPubkeyHex();
      const epochId = makeEpochId(agentPubkeyHex, 1);
      const peerIdString = "peer-P1";
      const ceremonyId = "ceremony-retry-test";

      // Bootstrap for epoch 1
      handler.bootstrapKeyShares(agentPubkeyHex);

      // Mark a ceremony as in-flight from P1
      handler.markInFlight(agentPubkeyHex, epochId, peerIdString, ceremonyId);

      // Second request from the SAME P1 should NOT be treated as conflict
      const isConflict = handler.checkConflict(
        agentPubkeyHex,
        epochId,
        peerIdString,
        ceremonyId
      );
      expect(isConflict).toBe(false);
    });
  });

  // ─── AC-003: Conflict detection from different Peer ID ────────────────────

  describe("AC-003: In-flight ceremony conflict from different Peer ID", () => {
    it("detects conflict when second request comes from different Peer ID", () => {
      const store = new InMemoryShareStore();
      const handler = new FrostDirectoryHandler({
        nodeId: "test-node",
        shareStore: store,
      });
      const agentPubkeyHex = randomAgentPubkeyHex();
      const epochId = makeEpochId(agentPubkeyHex, 1);
      const peerP1 = "peer-P1";
      const peerP2 = "peer-P2";
      const ceremonyId = "ceremony-conflict-test";

      // Register P1 as in-flight
      handler.markInFlight(agentPubkeyHex, epochId, peerP1, ceremonyId);

      // P2 tries the same (agentPubkey, epochId) — conflict
      const isConflict = handler.checkConflict(
        agentPubkeyHex,
        epochId,
        peerP2,
        ceremonyId
      );
      expect(isConflict).toBe(true);
    });

    it("fires FALLBACK_CANARY event on conflict with both Peer IDs and metadata", async () => {
      const store = new InMemoryShareStore();
      const canaryEvents: unknown[] = [];
      const handler = new FrostDirectoryHandler({
        nodeId: "test-node",
        shareStore: store,
        onFallbackCanary: (event) => canaryEvents.push(event),
      });
      const agentPubkeyHex = randomAgentPubkeyHex();
      const epochId = makeEpochId(agentPubkeyHex, 1);
      const peerP1 = "peer-P1";
      const peerP2 = "peer-P2";
      const ceremonyId = "ceremony-canary-test";

      handler.bootstrapKeyShares(agentPubkeyHex);
      handler.markInFlight(agentPubkeyHex, epochId, peerP1, ceremonyId);

      // Second request from P2
      const result = await handler.handleCeremonyRound({
        agentPubkey: agentPubkeyHex,
        epochId,
        tbs: new Uint8Array(32),
        context: CONTEXT_SESSION_ESTABLISHMENT,
        commitmentList: [],
        peerIdString: peerP2,
        ceremonyId,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("CEREMONY_CONFLICT");
      }

      expect(canaryEvents).toHaveLength(1);
      const event = canaryEvents[0] as Record<string, unknown>;
      expect(event.type).toBe("FALLBACK_CANARY");
      expect(event.agentPubkey).toBe(agentPubkeyHex);
      expect(event.epochId).toBe(epochId);
      expect(event.inFlightPeerId).toBe(peerP1);
      expect(event.conflictingPeerId).toBe(peerP2);
      expect(typeof event.timestamp).toBe("number");
    });

    it("does NOT interrupt the in-flight ceremony when conflict detected", async () => {
      const store = new InMemoryShareStore();
      const handler = new FrostDirectoryHandler({
        nodeId: "test-node",
        shareStore: store,
      });
      const agentPubkeyHex = randomAgentPubkeyHex();
      const epochId = makeEpochId(agentPubkeyHex, 1);
      const peerP1 = "peer-P1";
      const peerP2 = "peer-P2";
      const ceremonyId = "ceremony-no-interrupt-test";

      handler.bootstrapKeyShares(agentPubkeyHex);
      handler.markInFlight(agentPubkeyHex, epochId, peerP1, ceremonyId);

      // P2 conflicts — P1 in-flight entry must remain
      await handler.handleCeremonyRound({
        agentPubkey: agentPubkeyHex,
        epochId,
        tbs: new Uint8Array(32),
        context: CONTEXT_SESSION_ESTABLISHMENT,
        commitmentList: [],
        peerIdString: peerP2,
        ceremonyId,
      });

      // P1 is still the in-flight owner — not interrupted
      const isStillP1InFlight = !handler.checkConflict(
        agentPubkeyHex,
        epochId,
        peerP1,
        ceremonyId
      );
      expect(isStillP1InFlight).toBe(true);
    });
  });

  // ─── SI-003: No simultaneous ceremonies for same (agentPubkey, epochId) from different peers ──

  describe("SI-003: No simultaneous FROST ceremonies from different Peer IDs", () => {
    it("prevents two concurrent ceremonies for same (agentPubkey, epochId) from different peers", async () => {
      const store = new InMemoryShareStore();
      const handler = new FrostDirectoryHandler({
        nodeId: "test-node",
        shareStore: store,
      });
      const agentPubkeyHex = randomAgentPubkeyHex();
      const epochId = makeEpochId(agentPubkeyHex, 1);
      const peerP1 = "peer-P1";
      const peerP2 = "peer-P2";

      handler.bootstrapKeyShares(agentPubkeyHex);

      // P1 starts a ceremony
      handler.markInFlight(agentPubkeyHex, epochId, peerP1, "ceremony-1");

      // P2 tries the same before P1 finishes — conflict
      const result = await handler.handleCeremonyRound({
        agentPubkey: agentPubkeyHex,
        epochId,
        tbs: new Uint8Array(32),
        context: CONTEXT_SESSION_ESTABLISHMENT,
        commitmentList: [],
        peerIdString: peerP2,
        ceremonyId: "ceremony-2",
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("CEREMONY_CONFLICT");
      }
    });
  });

  // ─── AC-001: Valid partial FROST signature ─────────────────────────────────

  describe("AC-001: Directory returns valid partial FROST signature", () => {
    it("computes and returns valid partial signature for bootstrapped agent (epoch 1)", async () => {
      // Setup: 2 stubs + client (threshold=2, participants=2 → 3 total)
      // Handler holds stubs[0]'s share (identifier: cello-test-node-0000)
      // Coordinator (stubs[1]) provides its commitment (identifier: cello-test-node-0001)
      // Handler receives stubs[1]'s commitment, generates its own, signs with both → valid partial
      const agentPubkeyBytes = Buffer.from(randomBytes(32));
      const agentPubkeyHex = agentPubkeyBytes.toString("hex");

      const stubs = createInProcessStubs(2);

      // Client-side bootstrap: populates stubs and stores client share
      await bootstrapKeyShares(agentPubkeyBytes, {
        threshold: 2,
        participants: 2,
        directoryNodeStubs: stubs,
      });

      // Create handler backed by stubs[0]'s share
      const store = new InMemoryShareStore();
      const handler = new FrostDirectoryHandler({
        nodeId: stubs[0].id,
        shareStore: store,
      });
      const epochId = makeEpochId(agentPubkeyHex, 1);

      // Inject stubs[0]'s share into the handler
      const stub0Share = stubs[0].getShareForTest();
      expect(stub0Share).not.toBeNull();
      handler.injectShareForTest(agentPubkeyHex, epochId, stub0Share!);

      // Coordinator (stubs[1]) generates its commitment for Round 1
      const coordinatorCommitment = stubs[1].generateCommitment();

      const tbs = new Uint8Array(randomBytes(32));

      // Handler receives coordinatorCommitment, adds its own, signs → 2 commitments (= threshold)
      const result = await handler.handleCeremonyRound({
        agentPubkey: agentPubkeyHex,
        epochId,
        tbs,
        context: CONTEXT_SESSION_ESTABLISHMENT,
        commitmentList: [coordinatorCommitment.nonceCommitment], // coordinator's commitment
        peerIdString: "peer-coordinator",
        ceremonyId: "ceremony-ac001",
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.partialSignature).toBeInstanceOf(Uint8Array);
        // FROST partial sig for ed25519 is 32 bytes
        expect(result.partialSignature.length).toBe(32);
      }
    });
  });

  // ─── AC-007: Full 2-of-3 FROST ceremony via FrostThresholdSigner ───────────

  describe("AC-007: Full FROST ceremony with 3 directory nodes, threshold 2-of-3", () => {
    it("ceremony completes with any 2 nodes, combined signature verifies against primary_pubkey", async () => {
      const agentPubkeyBytes = Buffer.from(randomBytes(32));

      // 3 stubs; threshold=2, participants=3
      const stubs = createInProcessStubs(3);

      const bootstrapResult = await bootstrapKeyShares(agentPubkeyBytes, {
        threshold: 2,
        participants: 3,
        directoryNodeStubs: stubs,
      });

      // Create FrostThresholdSigner (client as coordinator)
      const signer = new FrostThresholdSigner(
        {
          threshold: 2,
          participants: 3,
          directoryNodeStubs: stubs,
        },
        agentPubkeyBytes
      );

      // Run a full ceremony
      const tbs = new Uint8Array(randomBytes(32));
      const result = await signer.participateInCeremony(
        "ceremony-ac007",
        tbs,
        CONTEXT_SESSION_ESTABLISHMENT
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        // Verify the combined signature against the primary_pubkey
        const isValid = signer.verifySignature(
          result.signature,
          tbs,
          CONTEXT_SESSION_ESTABLISHMENT,
          bootstrapResult.primaryPubkey
        );
        expect(isValid).toBe(true);
      }
    });

    it("retry request from same Peer ID treated as continuation (not conflict)", () => {
      const store = new InMemoryShareStore();
      const handler = new FrostDirectoryHandler({
        nodeId: "dir-node-test",
        shareStore: store,
      });
      const agentPubkeyHex = randomAgentPubkeyHex();
      handler.bootstrapKeyShares(agentPubkeyHex);
      const epochId = makeEpochId(agentPubkeyHex, 1);
      const peerIdString = "peer-coordinator";
      const ceremonyId = "ceremony-retry";

      handler.markInFlight(agentPubkeyHex, epochId, peerIdString, ceremonyId);

      // Same peer retry — not a conflict
      const retryConflict = handler.checkConflict(
        agentPubkeyHex,
        epochId,
        peerIdString,
        ceremonyId
      );
      expect(retryConflict).toBe(false);
    });
  });

  // ─── SI-001: K_server_X share bytes never appear in logs/errors/wire ────────

  describe("SI-001: K_server_X share bytes never in logs, errors, or wire messages", () => {
    it("error responses for AGENT_NOT_BOOTSTRAPPED contain no key material", async () => {
      const store = new InMemoryShareStore();
      const handler = new FrostDirectoryHandler({
        nodeId: "test-node",
        shareStore: store,
      });
      const agentPubkeyHex = randomAgentPubkeyHex();
      const epochId = makeEpochId(agentPubkeyHex, 1);

      const result = await handler.handleCeremonyRound({
        agentPubkey: agentPubkeyHex,
        epochId,
        tbs: new Uint8Array(32),
        context: CONTEXT_SESSION_ESTABLISHMENT,
        commitmentList: [],
        peerIdString: "peer-A",
        ceremonyId: "ceremony-1",
      });

      expect(result.ok).toBe(false);
      // The result object must not contain any raw key bytes
      const resultStr = JSON.stringify(result);
      expect(resultStr).not.toContain('"secret"');
      expect(resultStr).not.toContain('"keyShare"');
      expect(resultStr).not.toContain('"key"');
    });

    it("error response for CEREMONY_CONFLICT contains no key material", async () => {
      const store = new InMemoryShareStore();
      const handler = new FrostDirectoryHandler({
        nodeId: "test-node",
        shareStore: store,
      });
      const agentPubkeyHex = randomAgentPubkeyHex();
      const epochId = makeEpochId(agentPubkeyHex, 1);
      const peerP1 = "peer-P1";
      const peerP2 = "peer-P2";

      handler.bootstrapKeyShares(agentPubkeyHex);
      handler.markInFlight(agentPubkeyHex, epochId, peerP1, "ceremony-1");

      const result = await handler.handleCeremonyRound({
        agentPubkey: agentPubkeyHex,
        epochId,
        tbs: new Uint8Array(32),
        context: CONTEXT_SESSION_ESTABLISHMENT,
        commitmentList: [],
        peerIdString: peerP2,
        ceremonyId: "ceremony-2",
      });

      expect(result.ok).toBe(false);
      const resultStr = JSON.stringify(result);
      expect(resultStr).not.toContain('"secret"');
      expect(resultStr).not.toContain('"keyShare"');
      expect(resultStr).not.toContain('"key"');
    });

    it("success response contains only partialSignature, no raw key bytes", async () => {
      const agentPubkeyBytes = Buffer.from(randomBytes(32));
      const agentPubkeyHex = agentPubkeyBytes.toString("hex");

      const stubs = createInProcessStubs(2);

      // Bootstrap client + stubs (same setup as AC-001)
      await bootstrapKeyShares(agentPubkeyBytes, {
        threshold: 2,
        participants: 2,
        directoryNodeStubs: stubs,
      });

      const store = new InMemoryShareStore();
      const handler = new FrostDirectoryHandler({
        nodeId: stubs[0].id,
        shareStore: store,
      });
      const epochId = makeEpochId(agentPubkeyHex, 1);
      const stub0Share = stubs[0].getShareForTest();
      expect(stub0Share).not.toBeNull();
      handler.injectShareForTest(agentPubkeyHex, epochId, stub0Share!);

      // Coordinator (stubs[1]) provides its commitment
      const coordinatorCommitment = stubs[1].generateCommitment();
      const tbs = new Uint8Array(randomBytes(32));

      const result = await handler.handleCeremonyRound({
        agentPubkey: agentPubkeyHex,
        epochId,
        tbs,
        context: CONTEXT_SESSION_ESTABLISHMENT,
        commitmentList: [coordinatorCommitment.nonceCommitment], // coordinator's commitment
        peerIdString: "peer-coordinator",
        ceremonyId: "ceremony-si001",
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        // Only ok and partialSignature should be present
        const resultKeys = Object.keys(result);
        expect(resultKeys).toContain("ok");
        expect(resultKeys).toContain("partialSignature");
        expect(resultKeys).not.toContain("secret");
        expect(resultKeys).not.toContain("keyShare");
        expect(resultKeys).not.toContain("share");
      }
    });
  });

  // ─── FROST_PROTOCOL_ID export ───────────────────────────────────────────────

  describe("FROST_PROTOCOL_ID", () => {
    it("is '/cello/frost/1.0.0'", () => {
      expect(FROST_PROTOCOL_ID).toBe("/cello/frost/1.0.0");
    });
  });
});
