/**
 * CELLO-M6B-010 — Directory startup state restoration tests
 *
 * Specification (per story YAML):
 *
 * AC-001 (integration): A pending connection request in state "awaiting acceptance"
 *   (delivered to target, not yet accepted) survives directory restart.
 *   - Insert connection request into active_connection_requests table
 *   - Create a new directory process (simulate restart by creating a new
 *     PgDirectoryStore instance and calling loadActiveConnectionRequests)
 *   - The request is present in the loaded results
 *   - An expired request (expires_at in the past) is NOT loaded (SI-001)
 *
 * SI-001 (integration): Expired connection requests (expires_at <= NOW()) are
 *   not loaded by loadActiveConnectionRequests.
 *
 * AC-002 (integration): After restart, #sessionLastActivity is initialized to the
 *   session genesis timestamp from the sessions table (not 0 or undefined).
 *   - Create a session via writeSessionWithParticipants
 *   - Create a new PgDirectoryStore and call loadActiveSessionParticipants
 *   - Loaded sessions include the genesis timestamp (created_at from sessions table)
 *
 * AC-003 (integration): After restart, #sessionParticipants is populated from
 *   the sessions table for active (unsealed) sessions.
 *   - Create a session with participant pubkeys via writeSessionWithParticipants
 *   - loadActiveSessionParticipants returns the correct initiator/target pubkeys
 *   - Sessions that have been sealed (in seal_notarizations) are NOT returned
 *
 * AC-004 (unit): restorePendingConnectionRequests, restoreSessionParticipants,
 *   restoreSessionLastActivity methods exist on CelloDirectoryNode and log
 *   adapter.state.loaded with { stateType, count }.
 *
 * Interpretation notes:
 *   - These are integration tests requiring CELLO_ENV=local with Docker Compose Postgres.
 *   - AC-001 and SI-001 test the PgDirectoryStore.loadActiveConnectionRequests() method.
 *   - AC-002 and AC-003 test PgDirectoryStore.loadActiveSessionParticipants().
 *   - AC-004 tests CelloDirectoryNode restore methods (unit — uses InMemoryDirectoryStore).
 *
 * Run with:
 *   docker compose up -d && docker compose run --rm flyway
 *   CELLO_ENV=local DATABASE_URL=postgresql://postgres:dev@localhost:5433/cello_dev \
 *     DEV_ENVELOPE_KEY=86e903357804be102cf6f55e1b86ed342e01a6f50835272200ac970d0d094ac7 \
 *     AUDIT_LOG_PATH=/tmp/cello-audit.jsonl \
 *     pnpm --filter @cello-protocol/directory run test -- \
 *       --pool-options.threads.maxThreads=1 --pool-options.threads.minThreads=1
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import pg from "pg";
import { randomUUID, randomBytes } from "node:crypto";
import type { Logger } from "@cello-protocol/interfaces";
import { PgDirectoryStore } from "../adapters/pg-directory-store.js";
import { createDirectoryNode } from "../directory-node.js";
import { generateKeypair } from "@cello-protocol/crypto";

// ─── Integration helpers ───────────────────────────────────────────────────────
const isLocal = process.env["CELLO_ENV"] === "local";
const describeIntegration = isLocal ? describe : describe.skip;
const DATABASE_URL =
  process.env["DATABASE_URL"] ?? "postgresql://postgres:dev@localhost:5433/cello_dev";

// ─── Mock logger ──────────────────────────────────────────────────────────────

function makeMockLogger(): Logger & {
  infoEvents: Array<{ event: string; context: Record<string, unknown> }>;
  warnEvents: Array<{ event: string; context: Record<string, unknown> }>;
} {
  const infoEvents: Array<{ event: string; context: Record<string, unknown> }> = [];
  const warnEvents: Array<{ event: string; context: Record<string, unknown> }> = [];
  return {
    infoEvents,
    warnEvents,
    debug: vi.fn(),
    info: vi.fn((event: string, context?: Record<string, unknown>) => {
      infoEvents.push({ event, context: context ?? {} });
    }),
    warn: vi.fn((event: string, context?: Record<string, unknown>) => {
      warnEvents.push({ event, context: context ?? {} });
    }),
    error: vi.fn(),
  };
}

// ─── Integration tests: AC-001 + SI-001 + AC-002 + AC-003 ────────────────────

describeIntegration("M6B-010: PgDirectoryStore startup state load", () => {
  let pool: pg.Pool;

  beforeAll(() => {
    pool = new pg.Pool({ connectionString: DATABASE_URL, max: 5 });
  });

  afterAll(async () => {
    await pool.end();
  });

  it("AC-001: loadActiveConnectionRequests returns unexpired requests", async () => {
    // Spec: A pending connection request written to active_connection_requests
    // is returned by loadActiveConnectionRequests() when expires_at > NOW().
    const logger = makeMockLogger();
    const store = new PgDirectoryStore(pool, logger, "test", "local");
    await store.loadProfiles();

    const connReqId = randomUUID();
    const senderHex = randomBytes(32).toString("hex");
    const targetHex = randomBytes(32).toString("hex");
    const packageCbor = randomBytes(64);
    // expires_at: 24 hours from now
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await store.saveActiveConnectionRequest({
      connectionRequestId: connReqId,
      senderPubkeyHex: senderHex,
      targetPubkeyHex: targetHex,
      packageCbor,
      disclosureRound: 1,
      expiresAt,
    });

    const requests = await store.loadActiveConnectionRequests();
    const found = requests.find((r) => r.connectionRequestId === connReqId);
    expect(found).toBeDefined();
    expect(found!.senderPubkeyHex).toBe(senderHex);
    expect(found!.targetPubkeyHex).toBe(targetHex);
    expect(found!.disclosureRound).toBe(1);
    // Cleanup
    await store.deleteActiveConnectionRequest(connReqId);
  });

  it("SI-001: loadActiveConnectionRequests excludes expired requests", async () => {
    // Spec: A connection request with expires_at <= NOW() must NOT be returned.
    const logger = makeMockLogger();
    const store = new PgDirectoryStore(pool, logger, "test", "local");
    await store.loadProfiles();

    const connReqId = randomUUID();
    const senderHex = randomBytes(32).toString("hex");
    const targetHex = randomBytes(32).toString("hex");
    const packageCbor = randomBytes(64);
    // expires_at: 1 second in the past
    const expiresAt = new Date(Date.now() - 1000);

    await store.saveActiveConnectionRequest({
      connectionRequestId: connReqId,
      senderPubkeyHex: senderHex,
      targetPubkeyHex: targetHex,
      packageCbor,
      disclosureRound: 1,
      expiresAt,
    });

    const requests = await store.loadActiveConnectionRequests();
    const found = requests.find((r) => r.connectionRequestId === connReqId);
    expect(found).toBeUndefined();

    // Cleanup: expired requests are not loaded but still in DB; clean up directly
    await pool.query(
      "DELETE FROM active_connection_requests WHERE connection_request_id = $1",
      [connReqId],
    );
  });

  it("AC-003: loadActiveSessionParticipants returns active sessions with participant pubkeys", async () => {
    // Spec: writeSessionWithParticipants stores initiator + target pubkeys.
    // loadActiveSessionParticipants returns them for sessions not yet in seal_notarizations.
    //
    // IMP-001: Use a 32-char dashless hex session ID to match the runtime format produced by
    // Buffer.from(session_id).toString("hex") in directory-node.ts. This catches the CRIT-001
    // key format mismatch: Postgres stores UUIDs with dashes but all map lookups use dashless hex.
    const logger = makeMockLogger();
    const store = new PgDirectoryStore(pool, logger, "test", "local");
    await store.loadProfiles();

    // Use dashless hex (32 chars) — the format directory-node.ts uses for map keys.
    const sessionId = randomBytes(16).toString("hex"); // 32 hex chars, no dashes
    const initiatorHex = randomBytes(32).toString("hex");
    const targetHex = randomBytes(32).toString("hex");

    await store.writeSessionWithParticipants(sessionId, "test-node", initiatorHex, targetHex);

    const sessions = await store.loadActiveSessionParticipants();
    const found = sessions.find((s) => s.sessionId === sessionId);
    expect(found).toBeDefined();
    expect(found!.initiatorHex).toBe(initiatorHex);
    expect(found!.targetHex).toBe(targetHex);
    expect(found!.genesisTimestampMs).toBeGreaterThan(0);
    // IMP-001: Verify the key format round-trip — loaded sessionId must not contain dashes.
    // If it did, map lookups in directory-node.ts would silently miss the restored state.
    expect(found!.sessionId).not.toContain("-");

    // Cleanup
    await pool.query("DELETE FROM sessions WHERE session_id = $1", [sessionId]);
  });

  it("AC-002: loadActiveSessionParticipants returns genesis timestamp as genesisTimestampMs", async () => {
    // Spec: genesisTimestampMs is derived from sessions.created_at (genesis time),
    // not 0 or undefined. This allows #sessionLastActivity to be initialized correctly.
    const logger = makeMockLogger();
    const store = new PgDirectoryStore(pool, logger, "test", "local");
    await store.loadProfiles();

    // Use dashless hex (32 chars) — the format directory-node.ts uses for map keys.
    const sessionId = randomBytes(16).toString("hex");
    const initiatorHex = randomBytes(32).toString("hex");
    const targetHex = randomBytes(32).toString("hex");
    const beforeWrite = Date.now();

    await store.writeSessionWithParticipants(sessionId, "test-node", initiatorHex, targetHex);

    const afterWrite = Date.now();
    const sessions = await store.loadActiveSessionParticipants();
    const found = sessions.find((s) => s.sessionId === sessionId);
    expect(found).toBeDefined();
    // genesisTimestampMs should be within the window of before/after write
    expect(found!.genesisTimestampMs).toBeGreaterThanOrEqual(beforeWrite);
    expect(found!.genesisTimestampMs).toBeLessThanOrEqual(afterWrite + 1000); // +1s tolerance
    // IMP-001: Verify the key format round-trip — loaded sessionId must not contain dashes.
    expect(found!.sessionId).not.toContain("-");

    // Cleanup
    await pool.query("DELETE FROM sessions WHERE session_id = $1", [sessionId]);
  });

  it("AC-003b: loadActiveSessionParticipants excludes sessions with seal_notarizations", async () => {
    // Spec: Sessions that have been sealed (have a row in seal_notarizations) must NOT
    // be returned by loadActiveSessionParticipants — they are no longer active.
    const logger = makeMockLogger();
    const store = new PgDirectoryStore(pool, logger, "test", "local");
    await store.loadProfiles();

    // Use dashless hex (32 chars) — the format directory-node.ts uses for map keys.
    const sessionId = randomBytes(16).toString("hex");
    const sessionIdBytes = Buffer.from(sessionId, "hex");
    const initiatorHex = randomBytes(32).toString("hex");
    const targetHex = randomBytes(32).toString("hex");

    await store.writeSessionWithParticipants(sessionId, "test-node", initiatorHex, targetHex);

    // Verify it's loadable before sealing
    const before = await store.loadActiveSessionParticipants();
    const foundBefore = before.find((s) => s.sessionId === sessionId);
    expect(foundBefore).toBeDefined();

    // Write a seal_notarization for this session
    await store.recordNotarization({
      session_id: new Uint8Array(sessionIdBytes),
      sealed_root: new Uint8Array(randomBytes(32)),
      participant_a_pubkey: new Uint8Array(Buffer.from(initiatorHex, "hex")),
      participant_b_pubkey: new Uint8Array(Buffer.from(targetHex, "hex")),
      close_timestamp: Date.now(),
      frost_signature: new Uint8Array(randomBytes(64)),
    });

    // After sealing, should NOT appear in loadActiveSessionParticipants
    const after = await store.loadActiveSessionParticipants();
    const foundAfter = after.find((s) => s.sessionId === sessionId);
    expect(foundAfter).toBeUndefined();

    // Cleanup
    await pool.query("DELETE FROM sessions WHERE session_id = $1", [sessionId]);
  });

  it("AC-001: deleteActiveConnectionRequest removes it from loadActiveConnectionRequests", async () => {
    // Spec: When a connection request is accepted (or rejected), deleteActiveConnectionRequest
    // removes it so it's not reloaded on the next restart.
    const logger = makeMockLogger();
    const store = new PgDirectoryStore(pool, logger, "test", "local");
    await store.loadProfiles();

    const connReqId = randomUUID();
    const senderHex = randomBytes(32).toString("hex");
    const targetHex = randomBytes(32).toString("hex");
    const packageCbor = randomBytes(64);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await store.saveActiveConnectionRequest({
      connectionRequestId: connReqId,
      senderPubkeyHex: senderHex,
      targetPubkeyHex: targetHex,
      packageCbor,
      disclosureRound: 1,
      expiresAt,
    });

    // Verify it's there
    const before = await store.loadActiveConnectionRequests();
    expect(before.find((r) => r.connectionRequestId === connReqId)).toBeDefined();

    // Delete it
    await store.deleteActiveConnectionRequest(connReqId);

    // Verify it's gone
    const after = await store.loadActiveConnectionRequests();
    expect(after.find((r) => r.connectionRequestId === connReqId)).toBeUndefined();
  });
});

// ─── Unit tests: AC-004 ───────────────────────────────────────────────────────

describe("M6B-010: CelloDirectoryNode restore methods (AC-004)", () => {
  it("restorePendingConnectionRequests populates #pendingConnectionRequests and logs adapter.state.loaded", async () => {
    // Spec: restorePendingConnectionRequests accepts an array of ActiveConnectionRequest
    // records and populates #pendingConnectionRequests. Logs adapter.state.loaded with
    // { stateType: 'pending_connection_requests', count }.
    const logger = makeMockLogger();
    const dirKp = generateKeypair();

    const mockRelay = {
      recordAssignment: () => ({ ok: true as const }),
      discardSession: () => {},
      submitForSeal: () => ({ ok: false as const, reason: "not_implemented" }),
      confirmSeal: () => {},
      rejectSeal: () => {},
    };

    const { directory, stop } = await createDirectoryNode({
      keyProvider: dirKp,
      listenAddresses: ["/ip4/127.0.0.1/tcp/0"],
      relay: mockRelay,
      relayEndpoint: { peer_id: "test-relay", multiaddrs: ["/ip4/127.0.0.1/tcp/0"] },
      logger,
    });

    const connReqId = randomUUID();
    const senderHex = randomBytes(32).toString("hex");
    const targetHex = randomBytes(32).toString("hex");
    const packageCbor = randomBytes(64);

    directory.restorePendingConnectionRequests([
      {
        connectionRequestId: connReqId,
        senderPubkeyHex: senderHex,
        targetPubkeyHex: targetHex,
        packageCbor: new Uint8Array(packageCbor),
        disclosureRound: 1,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    ]);

    // Verify adapter.state.loaded was emitted
    const loadedEvent = logger.infoEvents.find(
      (e) => e.event === "adapter.state.loaded" && e.context["stateType"] === "pending_connection_requests",
    );
    expect(loadedEvent).toBeDefined();
    expect(loadedEvent!.context["count"]).toBe(1);

    await stop();
  });

  it("restoreSessionParticipants populates participants and logs adapter.state.loaded", async () => {
    // Spec: restoreSessionParticipants accepts session participant records and populates
    // #sessionParticipants. Logs adapter.state.loaded with { stateType: 'session_participants', count }.
    const logger = makeMockLogger();
    const dirKp = generateKeypair();

    const mockRelay = {
      recordAssignment: () => ({ ok: true as const }),
      discardSession: () => {},
      submitForSeal: () => ({ ok: false as const, reason: "not_implemented" }),
      confirmSeal: () => {},
      rejectSeal: () => {},
    };

    const { directory, stop } = await createDirectoryNode({
      keyProvider: dirKp,
      listenAddresses: ["/ip4/127.0.0.1/tcp/0"],
      relay: mockRelay,
      relayEndpoint: { peer_id: "test-relay", multiaddrs: ["/ip4/127.0.0.1/tcp/0"] },
      logger,
    });

    const sessionId = randomBytes(16).toString("hex");
    const initiatorHex = randomBytes(32).toString("hex");
    const targetHex = randomBytes(32).toString("hex");
    const genesisTimestampMs = Date.now() - 30_000;

    directory.restoreSessionParticipants([
      { sessionId, initiatorHex, targetHex, genesisTimestampMs },
    ]);

    const loadedEvent = logger.infoEvents.find(
      (e) => e.event === "adapter.state.loaded" && e.context["stateType"] === "session_participants",
    );
    expect(loadedEvent).toBeDefined();
    expect(loadedEvent!.context["count"]).toBe(1);

    await stop();
  });

  it("restoreSessionLastActivity populates lastActivity from genesis timestamp and logs adapter.state.loaded", async () => {
    // Spec: restoreSessionLastActivity initializes #sessionLastActivity to the genesis
    // timestamp (not 0 or undefined). Logs adapter.state.loaded with
    // { stateType: 'session_last_activity', count }.
    const logger = makeMockLogger();
    const dirKp = generateKeypair();

    const mockRelay = {
      recordAssignment: () => ({ ok: true as const }),
      discardSession: () => {},
      submitForSeal: () => ({ ok: false as const, reason: "not_implemented" }),
      confirmSeal: () => {},
      rejectSeal: () => {},
    };

    const { directory, stop } = await createDirectoryNode({
      keyProvider: dirKp,
      listenAddresses: ["/ip4/127.0.0.1/tcp/0"],
      relay: mockRelay,
      relayEndpoint: { peer_id: "test-relay", multiaddrs: ["/ip4/127.0.0.1/tcp/0"] },
      logger,
    });

    const sessionId = randomBytes(16).toString("hex");
    const genesisTimestampMs = Date.now() - 30_000;

    directory.restoreSessionLastActivity([
      { sessionId, initiatorHex: randomBytes(32).toString("hex"), targetHex: randomBytes(32).toString("hex"), genesisTimestampMs },
    ]);

    const loadedEvent = logger.infoEvents.find(
      (e) => e.event === "adapter.state.loaded" && e.context["stateType"] === "session_last_activity",
    );
    expect(loadedEvent).toBeDefined();
    expect(loadedEvent!.context["count"]).toBe(1);

    await stop();
  });

  it("AC-002: restoreSessionLastActivity uses genesis timestamp — grace period check is correct after restart", async () => {
    // Spec: After restart with genesisTimestampMs = T (60s ago), a unilateral seal attempt
    // with deliveryGraceSeconds=600 is correctly REJECTED as premature (60s < 600s).
    // This verifies that lastActivity=genesis (not 0) prevents immediate unilateral seal
    // eligibility after a restart. If lastActivity were 0, the seal would incorrectly pass.
    const logger = makeMockLogger();
    const dirKp = generateKeypair();

    const mockRelay = {
      recordAssignment: () => ({ ok: true as const }),
      discardSession: () => {},
      submitForSeal: () => ({ ok: false as const, reason: "not_implemented" }),
      confirmSeal: () => {},
      rejectSeal: () => {},
    };

    // Simulated genesis: 60 seconds ago — within the 600s grace period
    const genesisTimestampMs = Date.now() - 60_000;

    const { directory, stop } = await createDirectoryNode({
      keyProvider: dirKp,
      listenAddresses: ["/ip4/127.0.0.1/tcp/0"],
      relay: mockRelay,
      relayEndpoint: { peer_id: "test-relay", multiaddrs: ["/ip4/127.0.0.1/tcp/0"] },
      logger,
      deliveryGraceSeconds: 600,
    });

    const sessionId = randomBytes(16);
    const sessionIdHex = Buffer.from(sessionId).toString("hex");
    const initiatorHex = randomBytes(32).toString("hex");
    const targetHex = randomBytes(32).toString("hex");

    // Restore with genesis timestamp (simulating post-restart startup)
    directory.restoreSessionLastActivity([
      { sessionId: sessionIdHex, initiatorHex, targetHex, genesisTimestampMs },
    ]);
    directory.restoreSessionParticipants([
      { sessionId: sessionIdHex, initiatorHex, targetHex, genesisTimestampMs },
    ]);

    // Verify that getRestoredLastActivity returns the genesis time (not 0 or undefined)
    const lastActivity = directory.getRestoredLastActivityForTest(sessionIdHex);
    expect(lastActivity).toBe(genesisTimestampMs);

    // AC-002 core: invoke #processSealUnilateral using the RESTORED state (without pre-seeding
    // the timestamp to pass the grace period). With genesisTimestampMs = 60s ago and
    // deliveryGraceSeconds = 600, the grace period check must REJECT the seal attempt.
    // If lastActivity were 0 (epoch), elapsedMs = ~current_time >> 600s → seal would pass
    // incorrectly. With the correct genesis timestamp, only 60s have elapsed → rejection.
    const mockStream = { send: vi.fn() } as unknown as import("@libp2p/interface").Stream;
    const reportedRoot = randomBytes(32);

    directory.triggerSealUnilateralWithCurrentStateForTest(
      initiatorHex,
      sessionId,
      reportedRoot,
      mockStream,
    );

    // The mock stream must have received exactly one frame (the seal_unilateral_too_early response)
    expect(mockStream.send).toHaveBeenCalledTimes(1);

    // Verify relay.seal.unilateral.rejected was logged (AC-002 observability)
    const rejectedEvent = logger.infoEvents.find(
      (e) => e.event === "relay.seal.unilateral.rejected",
    );
    expect(rejectedEvent).toBeDefined();
    expect(rejectedEvent!.context["sessionId"]).toBe(sessionIdHex);
    expect(typeof rejectedEvent!.context["elapsedMs"]).toBe("number");
    expect(typeof rejectedEvent!.context["remainingSeconds"]).toBe("number");

    await stop();
  });
});
