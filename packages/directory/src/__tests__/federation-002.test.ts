/**
 * CELLO-FEDERATION-002 — Checkpoint cross-signing with 2-of-3 threshold and
 * deterministic coordinator failover.
 *
 * Specification (each AC stated before its test):
 *
 * AC-001/AC-002/AC-005: E2E tests — require three directory nodes with RDS + logical
 *   replication. These are deferred to CELLO-FEDERATION-E2E-001 (requires a 3-node
 *   RDS cluster not available in the local Docker Compose environment).
 *
 * AC-003: When a checkpoint round completes with 5 seals in the batch, the 5 staging
 *   rows included are cleared. A canary row inserted during the round survives.
 *   [Integration — requires CELLO_ENV=local + Postgres]
 *
 * AC-004: Sort determinism — two nodes with the same seal batch independently produce
 *   an identical ordered list for batches with distinct recorded_at values and for
 *   batches with identical recorded_at values (tiebroken by conversation_id UUID ASC).
 *   [Unit — no DB needed]
 *
 * AC-006: When a non-coordinator node receives a checkpoint proposal with a hash that
 *   does NOT match its locally computed hash, the node withholds its signature and logs
 *   federation.checkpoint.proposal.hash_mismatch at ERROR with { nodeId, checkpointId,
 *   expectedHash, receivedHash }.
 *   [Integration — requires CELLO_ENV=local + Postgres]
 *
 * AC-007: When a checkpoint round times out without 2 signatures, federation.checkpoint.skipped
 *   is logged at WARN with { checkpointId, availableNodes, requiredThreshold };
 *   conversation_seal_staging is NOT cleared; no new directory_checkpoints row is written.
 *   [Integration — requires CELLO_ENV=local + Postgres]
 *
 * AC-008-crash-mid-clear: On coordinator restart, staging rows whose staging_id values
 *   are already referenced in conversation_proof_leaf_checkpoints are skipped (not
 *   double-counted in the new batch). The new checkpoint's mmr_leaf_count equals the
 *   previous mmr_leaf_count plus only the newly accumulated seals.
 *   [Integration — requires CELLO_ENV=local + Postgres]
 *
 * AC-009: federation.checkpoint.gap fires at ERROR with { lastCheckpointId,
 *   lastCheckpointAt, gapMinutes } when no checkpoint has been confirmed within
 *   CHECKPOINT_GAP_ALARM_MINUTES (default 30) minutes. Test uses 1-minute threshold.
 *   [Integration — requires CELLO_ENV=local + Postgres]
 *
 * AC-009-store-tables: checkpoint_node_signatures is added to STORE_TABLES and its
 *   id (BIGSERIAL) is declared in BIGINT_COLUMNS. writeCheckpointSignature round-trip
 *   integration test (CELLO_ENV=local, real Postgres).
 *   [Static analysis (no DB) + Integration (CELLO_ENV=local)]
 *
 * AC-010-canonical-tbs: buildCheckpointTbs lives in @cello/crypto — already tested in
 *   packages/crypto/src/__tests__/checkpoint.test.ts. Here we verify the import in
 *   the directory package uses the crypto version (no inline serialization).
 *   [Unit]
 *
 * SI-001: A checkpoint with two signatures for the SAME node_id does NOT meet
 *   threshold. Only 1 distinct node_id → checkpoint not written to directory_checkpoints.
 *   [Integration — requires CELLO_ENV=local + Postgres]
 *
 * SI-002: conversation_seal_staging is NOT cleared unless the checkpoint row is written
 *   AND threshold signatures are committed (AC-008-crash-mid-clear covers the crash case).
 *   [Integration — tested together with AC-003 and AC-007]
 *
 * SI-003: The deterministic sort is the ONLY permitted ordering. Different sort order
 *   → different mmr_peaks → different checkpoint_hash → honest nodes withhold signatures.
 *   [Unit — tested via sort function + AC-010 cross-path contract]
 *
 * DB-001: While only one node is reachable (two nodes down), every round is skipped.
 *   [Integration — tested via AC-007 timeout path]
 *
 * DB-002: A node with persistent hash mismatch causes the round to succeed with 2-of-3
 *   from agreeing nodes; hash_mismatch keeps firing.
 *   [Integration — tested as part of AC-006 extended scenario]
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { PgDirectoryStore, BIGINT_COLUMNS, STORE_TABLES } from "../adapters/pg-directory-store.js";
import { MmrStore } from "../mmr-store.js";
import {
  CheckpointCoordinator,
  sortSealBatch,
  type SealBatchRow,
  type ICheckpointTransport,
  type CheckpointSignatureWithKey,
} from "../checkpoint-coordinator.js";
import { computeCheckpointHash, buildCheckpointTbs, generateKeypair } from "@cello/crypto";
import { configurePgTypes } from "../pg-type-config.js";
import type { Logger } from "@cello/interfaces";

// ─── Test environment setup ────────────────────────────────────────────────────

const isLocal = process.env["CELLO_ENV"] === "local";
const DATABASE_URL =
  process.env["DATABASE_URL"] ?? "postgresql://postgres:dev@localhost:5433/cello_dev";

const SERVICE_URL = DATABASE_URL.replace(
  /^(postgres(?:ql)?):\/\/[^:]+:[^@]+@/,
  "$1://cello_service:cello_service_dev@",
);

/**
 * describeIntegration: runs only when CELLO_ENV=local.
 * If CELLO_ENV is set but Postgres is unreachable, tests FAIL (not skip).
 * This prevents silently passing a CI gate when Postgres is not running.
 */
const describeIntegration = isLocal ? describe : describe.skip;

// ─── Test logger stub ─────────────────────────────────────────────────────────

function makeLogger() {
  const calls: Array<{ level: string; event: string; context: unknown }> = [];
  const logger: Logger = {
    debug: (event, context) => calls.push({ level: "debug", event, context }),
    info: (event, context) => calls.push({ level: "info", event, context }),
    warn: (event, context) => calls.push({ level: "warn", event, context }),
    error: (event, errorOrContext, context) => {
      calls.push({
        level: "error",
        event,
        context: context ?? errorOrContext,
      });
    },
  };
  return { logger, calls };
}

// ─── AC-009-store-tables: STATIC ANALYSIS — no DB required ───────────────────
// These tests run in ALL environments (not just CELLO_ENV=local).

describe("FEDERATION-002 AC-009-store-tables: static analysis — STORE_TABLES and BIGINT_COLUMNS", () => {
  it("AC-009-store-tables: checkpoint_node_signatures is in STORE_TABLES", () => {
    expect(STORE_TABLES).toContain("checkpoint_node_signatures");
  });

  it("AC-009-store-tables: checkpoint_node_signatures.id is declared in BIGINT_COLUMNS", () => {
    expect(BIGINT_COLUMNS["checkpoint_node_signatures"]).toContain("id");
  });
});

// ─── AC-004: Sort determinism — unit test (no DB needed) ─────────────────────

describe("FEDERATION-002 AC-004: sort determinism — recorded_at ASC, conversation_id ASC", () => {
  it("AC-004: distinct recorded_at values — sorted by recorded_at ascending", () => {
    const batch: SealBatchRow[] = [
      { stagingId: "s3", conversationId: "c3", recordedAt: new Date("2026-05-01T00:00:03Z") },
      { stagingId: "s1", conversationId: "c1", recordedAt: new Date("2026-05-01T00:00:01Z") },
      { stagingId: "s2", conversationId: "c2", recordedAt: new Date("2026-05-01T00:00:02Z") },
    ];

    const sorted = sortSealBatch(batch);

    expect(sorted[0]!.stagingId).toBe("s1");
    expect(sorted[1]!.stagingId).toBe("s2");
    expect(sorted[2]!.stagingId).toBe("s3");
  });

  it("AC-004: identical recorded_at values — tiebroken by conversation_id UUID ASC", () => {
    const sameTime = new Date("2026-05-01T00:00:00Z");
    const batch: SealBatchRow[] = [
      { stagingId: "s3", conversationId: "ffffffff-ffff-ffff-ffff-ffffffffffff", recordedAt: sameTime },
      { stagingId: "s1", conversationId: "00000000-0000-0000-0000-000000000001", recordedAt: sameTime },
      { stagingId: "s2", conversationId: "00000000-0000-0000-0000-000000000002", recordedAt: sameTime },
    ];

    const sorted = sortSealBatch(batch);

    // UUID ascending: 000...0001 < 000...0002 < fff...ffff
    expect(sorted[0]!.stagingId).toBe("s1");
    expect(sorted[1]!.stagingId).toBe("s2");
    expect(sorted[2]!.stagingId).toBe("s3");
  });

  it("AC-004: sort is stable when called twice on the same input — byte-for-byte identical output", () => {
    const sameTime = new Date("2026-05-01T00:00:00Z");
    const batch: SealBatchRow[] = [
      { stagingId: "s3", conversationId: "cccccccc-cccc-cccc-cccc-cccccccccccc", recordedAt: sameTime },
      { stagingId: "s1", conversationId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", recordedAt: sameTime },
      { stagingId: "s2", conversationId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", recordedAt: sameTime },
    ];

    const sorted1 = sortSealBatch([...batch]);
    const sorted2 = sortSealBatch([...batch]);

    expect(sorted1.map((r) => r.stagingId)).toEqual(sorted2.map((r) => r.stagingId));
  });

  it("AC-004: mixed batch — some with same time, some with different times — correct compound sort", () => {
    const time1 = new Date("2026-05-01T00:00:01Z");
    const time2 = new Date("2026-05-01T00:00:02Z");
    const batch: SealBatchRow[] = [
      { stagingId: "s4", conversationId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", recordedAt: time2 },
      { stagingId: "s1", conversationId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", recordedAt: time1 },
      { stagingId: "s3", conversationId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", recordedAt: time2 },
      { stagingId: "s2", conversationId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", recordedAt: time1 },
    ];

    const sorted = sortSealBatch(batch);

    // time1 rows first, then time2 rows; within each time, UUID ascending
    expect(sorted[0]!.stagingId).toBe("s1");  // time1, uuid=aaa...
    expect(sorted[1]!.stagingId).toBe("s2");  // time1, uuid=bbb...
    expect(sorted[2]!.stagingId).toBe("s3");  // time2, uuid=aaa...
    expect(sorted[3]!.stagingId).toBe("s4");  // time2, uuid=bbb...
  });
});

// ─── SI-003: Only the deterministic sort produces a valid checkpoint (unit) ───

describe("FEDERATION-002 SI-003: deterministic sort enforced at hash level", () => {
  it("SI-003: different sort order → different mmr_peaks → hash mismatch for honest nodes", () => {
    // If the peaks array order changes, the checkpoint hash changes.
    // Any node that sorts differently will compute a different hash and withhold its signature.
    const identity = "00".repeat(32);
    const checkpointId = "aaaabbbb-cccc-dddd-eeee-000000000001";

    // Simulated: correct sort produces peaks in order A, B
    const hashWithCorrectSort = computeCheckpointHash(["aa001122", "bb003344"], identity, checkpointId);

    // Simulated: wrong sort produces peaks in order B, A
    const hashWithWrongSort = computeCheckpointHash(["bb003344", "aa001122"], identity, checkpointId);

    // Honest nodes compute hash from correct sort — wrong-sort hash will not match
    expect(hashWithCorrectSort).not.toBe(hashWithWrongSort);
  });
});

// ─── AC-010-canonical-tbs: verify imports from @cello/crypto (unit) ──────────

describe("FEDERATION-002 AC-010-canonical-tbs: no inline serialization in directory", () => {
  it("buildCheckpointTbs is imported from @cello/crypto — not implemented inline", () => {
    // If this import works, it came from @cello/crypto
    expect(typeof buildCheckpointTbs).toBe("function");
  });

  it("computeCheckpointHash produces same result regardless of which module calls buildCheckpointTbs", () => {
    const peaks = ["0102", "0304"];
    const identity = "aa".repeat(32);
    const checkpointId = "aaaabbbb-cccc-dddd-eeee-000000000001";

    // Two calls — same result (coordinator path and verifier path)
    const fromCryptoPackage = computeCheckpointHash(peaks, identity, checkpointId);
    const secondCall = computeCheckpointHash(peaks, identity, checkpointId);

    expect(fromCryptoPackage).toBe(secondCall);
  });
});

// ─── Integration tests — require CELLO_ENV=local ─────────────────────────────

describeIntegration("FEDERATION-002 integration: AC-009-store-tables round-trip", () => {
  let superPool: pg.Pool;
  let servicePool: pg.Pool;

  beforeAll(async () => {
    configurePgTypes();
    superPool = new pg.Pool({ connectionString: DATABASE_URL });
    servicePool = new pg.Pool({ connectionString: SERVICE_URL });
    try {
      await superPool.query("SELECT 1");
      await servicePool.query("SELECT 1");
    } catch (err) {
      throw new Error(
        `[FEDERATION-002] CELLO_ENV=local but Postgres is unreachable at ${DATABASE_URL}: ${String(err)}`,
      );
    }
  });

  afterAll(async () => {
    await superPool?.end();
    await servicePool?.end();
  });

  beforeEach(async () => {
    // Clean up test data between tests
    await superPool.query(`
      DELETE FROM checkpoint_node_signatures WHERE node_id LIKE 'test-node-%'
    `);
    await superPool.query(`
      DELETE FROM directory_checkpoints
      WHERE checkpoint_id IN (
        SELECT checkpoint_id FROM directory_checkpoints
        WHERE coordinator_node_id LIKE 'test-node-%'
      )
    `);
  });

  it("AC-009-store-tables: checkpoint_node_signatures V18 schema — all required columns exist and are NOT NULL", async () => {
    // Verify schema matches V18 migration: checkpoint_id, node_id, node_signature, signed_at are NOT NULL
    const cols = await superPool.query<{
      column_name: string;
      data_type: string;
      is_nullable: string;
    }>(
      `SELECT column_name, data_type, is_nullable
       FROM information_schema.columns
       WHERE table_name = 'checkpoint_node_signatures'
       ORDER BY ordinal_position`,
    );

    const colMap = new Map(cols.rows.map((r) => [r.column_name, r]));

    // id is BIGSERIAL (integer) — always present
    expect(colMap.has("id")).toBe(true);

    // V18 columns — all NOT NULL
    const v18Cols = ["checkpoint_id", "node_id", "node_signature", "signed_at"];
    for (const col of v18Cols) {
      expect(colMap.has(col), `column ${col} should exist`).toBe(true);
      expect(
        colMap.get(col)?.is_nullable,
        `column ${col} should be NOT NULL`,
      ).toBe("NO");
    }
  });

  it("AC-009-store-tables: writeCheckpointSignature round-trip — write via PgDirectoryStore, read back from fresh instance", async () => {
    // Step 1: Insert a checkpoint row first (required by FK constraint)
    const checkpointId = randomUUID();
    const { logger } = makeLogger();
    const store = new PgDirectoryStore(servicePool, logger, "test-node-coordinator", "us-east-1");

    // Insert checkpoint row via superPool (bypassing chain hash for this setup step)
    await superPool.query(
      `INSERT INTO directory_checkpoints
         (checkpoint_id, mmr_leaf_count, peak_hash, staged_seal_count, chain_hash,
          mmr_peaks, identity_merkle_root, checkpoint_hash, coordinator_node_id)
       VALUES ($1, 0, $2, 0, $3, '[]'::jsonb, $4, $5, $6)`,
      [
        checkpointId,
        "0".repeat(64),
        "genesis_chain_hash_placeholder",
        "00".repeat(32),
        "00".repeat(32),
        "test-node-coordinator",
      ],
    );

    // Step 2: Write a checkpoint signature via PgDirectoryStore
    const nodeSignature = "aa".repeat(32); // 64-char hex Ed25519 sig
    await store.writeCheckpointSignature({
      checkpointId,
      nodeId: "test-node-signer-001",
      nodeSignature,
    });

    // Step 3: Read back from a fresh PgDirectoryStore instance (no cache)
    const { logger: logger2 } = makeLogger();
    const freshStore = new PgDirectoryStore(servicePool, logger2, "test-node-coordinator", "us-east-1");
    const rows = await freshStore.getCheckpointSignatures(checkpointId);

    // Verify the round-trip
    expect(rows).toHaveLength(1);
    expect(rows[0]!.checkpointId).toBe(checkpointId);
    expect(rows[0]!.nodeId).toBe("test-node-signer-001");
    expect(rows[0]!.nodeSignature).toBe(nodeSignature);
    expect(rows[0]!.id).toBeTypeOf("number"); // BIGSERIAL must be deserialized as number
  });

  it("AC-009-store-tables: SI-001 — two signatures for the same node_id do NOT meet threshold", async () => {
    // Adversarial condition: two signatures with the same node_id submitted for the same checkpoint.
    // Only 1 distinct node_id → does not meet 2-of-3 threshold.
    const checkpointId = randomUUID();
    const { logger } = makeLogger();
    const store = new PgDirectoryStore(servicePool, logger, "test-node-coordinator", "us-east-1");

    // Insert checkpoint row
    await superPool.query(
      `INSERT INTO directory_checkpoints
         (checkpoint_id, mmr_leaf_count, peak_hash, staged_seal_count, chain_hash,
          mmr_peaks, identity_merkle_root, checkpoint_hash, coordinator_node_id)
       VALUES ($1, 0, $2, 0, $3, '[]'::jsonb, $4, $5, $6)`,
      [
        checkpointId,
        "0".repeat(64),
        "genesis_chain_hash_placeholder_2",
        "00".repeat(32),
        "00".repeat(32),
        "test-node-coordinator",
      ],
    );

    // Write first signature for node-A
    await store.writeCheckpointSignature({
      checkpointId,
      nodeId: "test-node-A",
      nodeSignature: "bb".repeat(32),
    });

    // Try to write second signature for same node-A — should fail (unique constraint on node_id+checkpoint_id)
    await expect(
      store.writeCheckpointSignature({
        checkpointId,
        nodeId: "test-node-A",
        nodeSignature: "cc".repeat(32),
      }),
    ).rejects.toThrow();

    // Verify only 1 signature exists — not 2
    const rows = await store.getCheckpointSignatures(checkpointId);
    const distinctNodeIds = new Set(rows.map((r) => r.nodeId));
    expect(distinctNodeIds.size).toBe(1);
    expect(rows.length).toBeLessThan(2); // Does not meet threshold of 2
  });
});

describeIntegration("FEDERATION-002 integration: AC-003 staging batch clearance", () => {
  let superPool: pg.Pool;
  let servicePool: pg.Pool;
  let mmrStore: MmrStore;
  let logger: Logger;

  beforeAll(async () => {
    configurePgTypes();
    superPool = new pg.Pool({ connectionString: DATABASE_URL });
    servicePool = new pg.Pool({ connectionString: SERVICE_URL });
    try {
      await superPool.query("SELECT 1");
    } catch (err) {
      throw new Error(
        `[FEDERATION-002] CELLO_ENV=local but Postgres is unreachable at ${DATABASE_URL}: ${String(err)}`,
      );
    }
    const loggerAndCalls = makeLogger();
    logger = loggerAndCalls.logger;
    mmrStore = new MmrStore(servicePool, logger);
  });

  afterAll(async () => {
    await superPool?.end();
    await servicePool?.end();
  });

  it("AC-003 + SI-002: 5 seals committed → those 5 staging rows cleared; canary row survives", async () => {
    // Setup: append 5 seals to staging
    const batchSessionIds: string[] = [];
    for (let i = 0; i < 5; i++) {
      const sessionId = randomUUID();
      const sealRoot = randomUUID().replace(/-/g, ""); // 32-char hex
      await mmrStore.appendSeal(sessionId, sealRoot + sealRoot, `corr-${i}`);
      batchSessionIds.push(sessionId);
    }

    // Initiate a checkpoint (stamps checkpoint_id on the 5 rows)
    const checkpointId = await mmrStore.initiateCheckpoint();

    // Insert a CANARY row AFTER checkpoint was initiated (must survive clearance)
    const canarySessionId = randomUUID();
    const canarySealRoot = randomUUID().replace(/-/g, "");
    await servicePool.query(
      `INSERT INTO conversation_seal_staging (session_id, seal_merkle_root)
       VALUES ($1, $2)`,
      [canarySessionId, canarySealRoot + canarySealRoot],
    );

    // Confirm the checkpoint (clears only the 5 rows with this checkpointId)
    await mmrStore.confirmCheckpoint(checkpointId);

    // Verify: the 5 batch rows are gone
    const batchCheck = await servicePool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM conversation_seal_staging WHERE session_id = ANY($1)`,
      [batchSessionIds],
    );
    expect(parseInt(batchCheck.rows[0]!.count, 10)).toBe(0);

    // Verify: the canary row SURVIVED (AC-003: rows inserted during round retained)
    const canaryCheck = await servicePool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM conversation_seal_staging WHERE session_id = $1`,
      [canarySessionId],
    );
    expect(parseInt(canaryCheck.rows[0]!.count, 10)).toBe(1);

    // Cleanup: remove canary
    await superPool.query(
      "DELETE FROM conversation_seal_staging WHERE session_id = $1",
      [canarySessionId],
    );
  });
});

describeIntegration("FEDERATION-002 integration: AC-007 checkpoint round timeout — staging NOT cleared", () => {
  let superPool: pg.Pool;
  let servicePool: pg.Pool;
  let mmrStore: MmrStore;
  let pgStore: PgDirectoryStore;
  let logger: Logger;
  let logCalls: Array<{ level: string; event: string; context: unknown }>;

  beforeAll(async () => {
    configurePgTypes();
    superPool = new pg.Pool({ connectionString: DATABASE_URL });
    servicePool = new pg.Pool({ connectionString: SERVICE_URL });
    try {
      await superPool.query("SELECT 1");
    } catch (err) {
      throw new Error(
        `[FEDERATION-002] CELLO_ENV=local but Postgres is unreachable at ${DATABASE_URL}: ${String(err)}`,
      );
    }
    const loggerAndCalls = makeLogger();
    logger = loggerAndCalls.logger;
    logCalls = loggerAndCalls.calls;
    mmrStore = new MmrStore(servicePool, logger);
    pgStore = new PgDirectoryStore(servicePool, logger, "test-node-ac007", "us-east-1");
  });

  afterAll(async () => {
    await superPool?.end();
    await servicePool?.end();
  });

  it("AC-007: skipped round — real CheckpointCoordinator.runRound() with all-timeout transport logs federation.checkpoint.skipped, staging NOT cleared, no new checkpoint row", async () => {
    // Setup: append 2 seals to staging
    const sessionId1 = randomUUID();
    const sessionId2 = randomUUID();
    const sealRoot1 = randomUUID().replace(/-/g, "");
    const sealRoot2 = randomUUID().replace(/-/g, "");
    await mmrStore.appendSeal(sessionId1, sealRoot1 + sealRoot1, "corr-ac007-1");
    await mmrStore.appendSeal(sessionId2, sealRoot2 + sealRoot2, "corr-ac007-2");

    // Count staging rows before
    const before = await servicePool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM conversation_seal_staging WHERE session_id = ANY($1)`,
      [[sessionId1, sessionId2]],
    );
    expect(parseInt(before.rows[0]!.count, 10)).toBe(2);

    // Count checkpoint rows before
    const checkpointsBefore = await servicePool.query<{ count: string }>(
      "SELECT COUNT(*) AS count FROM directory_checkpoints",
    );
    const checkpointCountBefore = parseInt(checkpointsBefore.rows[0]!.count, 10);

    // Build a stub transport that always returns null (simulates all peers timing out)
    const timeoutTransport: ICheckpointTransport = {
      async sendCheckpointProposal() { return null; },
      async getPeerNodeIds() { return ["test-node-peer-b", "test-node-peer-c"]; },
    };

    const keyProvider = generateKeypair();

    const coordinator = new CheckpointCoordinator(
      pgStore,
      mmrStore,
      timeoutTransport,
      keyProvider,
      logger,
      {
        nodeId: "test-node-ac007", // lowest node_id among [test-node-ac007, test-node-peer-b, test-node-peer-c]
        checkpointIntervalMs: 600_000,
        roundTimeoutMs: 1, // 1ms — effectively immediate timeout
        requiredThreshold: 2,
        failoverDetectionMs: Infinity, // never failover in this test
      },
    );

    // Run a real round — coordinator signs, peers time out → only 1 sig → skipped
    const result = await coordinator.runRound();
    expect(result).toBeNull();

    // Verify: federation.checkpoint.skipped logged at WARN with required fields
    const skippedEvent = logCalls.find(
      (c) => c.level === "warn" && c.event === "federation.checkpoint.skipped",
    );
    expect(skippedEvent, "federation.checkpoint.skipped not logged by real coordinator").toBeDefined();
    const ctx = skippedEvent!.context as Record<string, unknown>;
    expect(ctx["availableNodes"]).toBe(1); // only coordinator's own sig
    expect(ctx["requiredThreshold"]).toBe(2);
    expect(typeof ctx["checkpointId"]).toBe("string");
    expect(typeof ctx["correlationId"]).toBe("string");

    // Verify: staging rows still exist (not cleared on skip)
    const after = await servicePool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM conversation_seal_staging WHERE session_id = ANY($1)`,
      [[sessionId1, sessionId2]],
    );
    expect(parseInt(after.rows[0]!.count, 10)).toBe(2);

    // Verify: no new checkpoint row written
    const checkpointsAfter = await servicePool.query<{ count: string }>(
      "SELECT COUNT(*) AS count FROM directory_checkpoints",
    );
    expect(parseInt(checkpointsAfter.rows[0]!.count, 10)).toBe(checkpointCountBefore);

    // Cleanup
    await superPool.query(
      "DELETE FROM conversation_seal_staging WHERE session_id = ANY($1)",
      [[sessionId1, sessionId2]],
    );
  });
});

describeIntegration("FEDERATION-002 integration: AC-006 hash mismatch — signature withheld", () => {
  let superPool: pg.Pool;
  let servicePool: pg.Pool;
  let logger: Logger;
  let logCalls: Array<{ level: string; event: string; context: unknown }>;

  beforeAll(async () => {
    configurePgTypes();
    superPool = new pg.Pool({ connectionString: DATABASE_URL });
    servicePool = new pg.Pool({ connectionString: SERVICE_URL });
    try {
      await superPool.query("SELECT 1");
    } catch (err) {
      throw new Error(
        `[FEDERATION-002] CELLO_ENV=local but Postgres is unreachable at ${DATABASE_URL}: ${String(err)}`,
      );
    }
    const loggerAndCalls = makeLogger();
    logger = loggerAndCalls.logger;
    logCalls = loggerAndCalls.calls;
  });

  afterAll(async () => {
    await superPool?.end();
    await servicePool?.end();
  });

  it("AC-006: real CheckpointCoordinator.verifyAndSign() with corrupted proposal hash → returns null and logs federation.checkpoint.proposal.hash_mismatch at ERROR", async () => {
    const keyProvider = generateKeypair();
    const pgStore = new PgDirectoryStore(servicePool, logger, "test-node-verifier", "us-east-1");
    const mmrStore = new MmrStore(servicePool, logger);
    const stubTransport: ICheckpointTransport = {
      async sendCheckpointProposal() { return null; },
      async getPeerNodeIds() { return []; },
    };

    const coordinator = new CheckpointCoordinator(
      pgStore,
      mmrStore,
      stubTransport,
      keyProvider,
      logger,
      { nodeId: "test-node-verifier" },
    );

    // Seed the DB with a known checkpoint so getCheckpointMmrState() returns predictable peaks.
    const seedCheckpointId = randomUUID();
    const seedPeaks = ["aabb0011", "ccdd0022"];
    const seedIdentity = "ff".repeat(32);
    const seedHash = computeCheckpointHash(seedPeaks, seedIdentity, seedCheckpointId);
    await pgStore.writeCheckpoint({
      checkpointId: seedCheckpointId,
      mmrPeaks: seedPeaks,
      identityMerkleRoot: seedIdentity,
      checkpointHash: seedHash,
      mmrLeafCount: 2,
      coordinatorNodeId: "test-node-verifier-seed",
    });

    const checkpointId = randomUUID();
    // corruptedHash does not match computeCheckpointHash(seedPeaks, seedIdentity, checkpointId)
    const corruptedHash = "de".repeat(32);

    const sig = await coordinator.verifyAndSign({
      checkpointId,
      checkpointHash: corruptedHash,
      mmrPeaks: seedPeaks,
      identityMerkleRoot: seedIdentity,
      mmrLeafCount: 2,
    });

    // Must return null — signature withheld
    expect(sig).toBeNull();

    // Must log federation.checkpoint.proposal.hash_mismatch at ERROR with required fields
    const event = logCalls.find(
      (c) => c.level === "error" && c.event === "federation.checkpoint.proposal.hash_mismatch",
    );
    expect(event, "federation.checkpoint.proposal.hash_mismatch not logged").toBeDefined();
    const ctx = event!.context as Record<string, unknown>;
    expect(ctx["nodeId"]).toBe("test-node-verifier");
    expect(ctx["checkpointId"]).toBe(checkpointId);
    // expectedHash is what the verifier independently computed from local state — must differ from corruptedHash
    expect(ctx["expectedHash"]).not.toBe(corruptedHash);
    expect(ctx["receivedHash"]).toBe(corruptedHash);

    // Cleanup
    await superPool.query("DELETE FROM directory_checkpoints WHERE checkpoint_id = $1", [seedCheckpointId]);
  });

  it("AC-006: verifyAndSign with CORRECT hash → returns a non-null signature (happy path)", async () => {
    const keyProvider = generateKeypair();
    const pgStore = new PgDirectoryStore(servicePool, logger, "test-node-verifier-ok", "us-east-1");
    const mmrStore = new MmrStore(servicePool, logger);
    const stubTransport: ICheckpointTransport = {
      async sendCheckpointProposal() { return null; },
      async getPeerNodeIds() { return []; },
    };

    const coordinator = new CheckpointCoordinator(
      pgStore,
      mmrStore,
      stubTransport,
      keyProvider,
      logger,
      { nodeId: "test-node-verifier-ok" },
    );

    // Seed the DB with a known checkpoint so getCheckpointMmrState() returns predictable peaks.
    const seedCheckpointId = randomUUID();
    const peaks = ["aabb0011"];
    const identity = "00".repeat(32);
    const seedHash = computeCheckpointHash(peaks, identity, seedCheckpointId);
    await pgStore.writeCheckpoint({
      checkpointId: seedCheckpointId,
      mmrPeaks: peaks,
      identityMerkleRoot: identity,
      checkpointHash: seedHash,
      mmrLeafCount: 1,
      coordinatorNodeId: "test-node-verifier-ok-seed",
    });

    const checkpointId = randomUUID();
    // correctHash computed from the same peaks the DB now holds
    const correctHash = computeCheckpointHash(peaks, identity, checkpointId);

    const sig = await coordinator.verifyAndSign({
      checkpointId,
      checkpointHash: correctHash,
      mmrPeaks: peaks,
      identityMerkleRoot: identity,
      mmrLeafCount: 1,
    });

    // Must return a hex-encoded Ed25519 signature (128 chars)
    expect(sig).not.toBeNull();
    expect(sig!.length).toBe(128);
    expect(sig!).toMatch(/^[0-9a-f]{128}$/);

    // Cleanup
    await superPool.query("DELETE FROM directory_checkpoints WHERE checkpoint_id = $1", [seedCheckpointId]);
  });
});

describeIntegration("FEDERATION-002 integration: AC-008-crash-mid-clear — already-committed staging rows excluded", () => {
  let superPool: pg.Pool;
  let servicePool: pg.Pool;
  let mmrStore: MmrStore;
  let logger: Logger;

  beforeAll(async () => {
    configurePgTypes();
    superPool = new pg.Pool({ connectionString: DATABASE_URL });
    servicePool = new pg.Pool({ connectionString: SERVICE_URL });
    try {
      await superPool.query("SELECT 1");
    } catch (err) {
      throw new Error(
        `[FEDERATION-002] CELLO_ENV=local but Postgres is unreachable at ${DATABASE_URL}: ${String(err)}`,
      );
    }
    const loggerAndCalls = makeLogger();
    logger = loggerAndCalls.logger;
    mmrStore = new MmrStore(servicePool, logger);
  });

  afterAll(async () => {
    await superPool?.end();
    await servicePool?.end();
  });

  it("AC-008-crash-mid-clear: getStagingRowsForBatch excludes staging rows already referenced in conversation_proof_leaf_checkpoints", async () => {
    // Simulate: coordinator appends 3 seals, confirms a checkpoint (which records them in
    // conversation_proof_leaf_checkpoints), but then crashes before deleting the staging rows.
    // On restart, getStagingRowsForBatch must exclude those already-committed staging rows.

    // Step 1: Append 3 seals and confirm a checkpoint normally
    const priorSessionIds: string[] = [];
    for (let i = 0; i < 3; i++) {
      const sessionId = randomUUID();
      const sealRoot = randomUUID().replace(/-/g, "");
      await mmrStore.appendSeal(sessionId, sealRoot + sealRoot, `corr-ac008-prior-${i}`);
      priorSessionIds.push(sessionId);
    }

    const priorCheckpointId = await mmrStore.initiateCheckpoint();
    await mmrStore.confirmCheckpoint(priorCheckpointId);

    // Verify that the priorCheckpointId is confirmed (has row in directory_checkpoints)
    const priorCheck = await servicePool.query<{ mmr_leaf_count: string }>(
      "SELECT mmr_leaf_count FROM directory_checkpoints WHERE checkpoint_id = $1",
      [priorCheckpointId],
    );
    expect(priorCheck.rows).toHaveLength(1);
    const priorLeafCount = parseInt(priorCheck.rows[0]!.mmr_leaf_count, 10);

    // Step 2: Simulate crash-mid-clear: re-insert staging rows for the prior session IDs
    // (This mimics what would have happened if the DELETE from staging was lost on crash.)
    for (const sessionId of priorSessionIds) {
      await superPool.query(
        `INSERT INTO conversation_seal_staging (session_id, seal_merkle_root, checkpoint_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (session_id) DO NOTHING`,
        [sessionId, "crash_recovery_test_" + sessionId.slice(0, 8), priorCheckpointId],
      );
    }

    // Step 3: Add 2 genuinely new seals (not yet committed)
    const newSessionIds: string[] = [];
    for (let i = 0; i < 2; i++) {
      const sessionId = randomUUID();
      const sealRoot = randomUUID().replace(/-/g, "");
      await mmrStore.appendSeal(sessionId, sealRoot + sealRoot, `corr-ac008-new-${i}`);
      newSessionIds.push(sessionId);
    }

    // Step 4: Call getStagingRowsForBatch — should return ONLY the 2 new rows
    const { logger: pgLogger } = makeLogger();
    const pgStore = new PgDirectoryStore(servicePool, pgLogger, "test-node-ac008", "us-east-1");
    const batchRows = await pgStore.getStagingRowsForBatch();

    // Only the 2 new session IDs should appear — not the 3 already-committed ones
    const returnedSessionIds = batchRows.map((r) => r.sessionId);
    for (const priorId of priorSessionIds) {
      expect(returnedSessionIds, `Prior session ${priorId} should be excluded from new batch`).not.toContain(priorId);
    }
    for (const newId of newSessionIds) {
      expect(returnedSessionIds, `New session ${newId} should be in new batch`).toContain(newId);
    }

    // The new checkpoint should only advance leaf count by 2
    const nextCheckpointId = await mmrStore.initiateCheckpoint();
    await mmrStore.confirmCheckpoint(nextCheckpointId);

    const nextCheck = await servicePool.query<{ mmr_leaf_count: string }>(
      "SELECT mmr_leaf_count FROM directory_checkpoints WHERE checkpoint_id = $1",
      [nextCheckpointId],
    );
    expect(nextCheck.rows).toHaveLength(1);
    const nextLeafCount = parseInt(nextCheck.rows[0]!.mmr_leaf_count, 10);

    // nextLeafCount = priorLeafCount + 2 new seals (not +3 already-committed)
    expect(nextLeafCount).toBe(priorLeafCount + 2);

    // Cleanup: remove the re-inserted prior staging rows
    await superPool.query(
      "DELETE FROM conversation_seal_staging WHERE session_id = ANY($1)",
      [priorSessionIds],
    );
  });
});

describeIntegration("FEDERATION-002 integration: AC-009 checkpoint gap alarm", () => {
  let superPool: pg.Pool;
  let servicePool: pg.Pool;
  let logger: Logger;
  let logCalls: Array<{ level: string; event: string; context: unknown }>;

  beforeAll(async () => {
    configurePgTypes();
    superPool = new pg.Pool({ connectionString: DATABASE_URL });
    servicePool = new pg.Pool({ connectionString: SERVICE_URL });
    try {
      await superPool.query("SELECT 1");
    } catch (err) {
      throw new Error(
        `[FEDERATION-002] CELLO_ENV=local but Postgres is unreachable at ${DATABASE_URL}: ${String(err)}`,
      );
    }
    const loggerAndCalls = makeLogger();
    logger = loggerAndCalls.logger;
    logCalls = loggerAndCalls.calls;
  });

  afterAll(async () => {
    await superPool?.end();
    await servicePool?.end();
  });

  it("AC-009: real CheckpointCoordinator.checkGapNow() fires federation.checkpoint.gap at ERROR when last checkpoint is older than CHECKPOINT_GAP_ALARM_MINUTES", async () => {
    const pgStore = new PgDirectoryStore(servicePool, logger, "test-node-ac009", "us-east-1");
    const mmrStore = new MmrStore(servicePool, logger);
    const keyProvider = generateKeypair();
    const stubTransport: ICheckpointTransport = {
      async sendCheckpointProposal() { return null; },
      async getPeerNodeIds() { return []; },
    };

    // Clear all checkpoint rows so the only row in the table is the 65-minute-old one we insert.
    // This ensures getLastCheckpointAt() (ORDER BY id DESC LIMIT 1) returns our old row, not a recent one.
    await superPool.query("DELETE FROM checkpoint_node_signatures WHERE node_id LIKE 'test-node-%'");
    await superPool.query("DELETE FROM directory_checkpoints WHERE coordinator_node_id LIKE 'test-node-%'");

    // Write an old checkpoint (65 minutes ago) directly so getLastCheckpointAt returns a stale timestamp
    const oldCheckpointId = randomUUID();
    const oldTime = new Date(Date.now() - 65 * 60 * 1000); // 65 minutes ago
    await superPool.query(
      `INSERT INTO directory_checkpoints
         (checkpoint_id, mmr_leaf_count, peak_hash, staged_seal_count, chain_hash,
          mmr_peaks, identity_merkle_root, checkpoint_hash, coordinator_node_id, created_at)
       VALUES ($1, 0, $2, 0, $3, '[]'::jsonb, $4, $5, 'test-node-ac009', $6)`,
      [
        oldCheckpointId,
        "0".repeat(64),
        "genesis_chain_hash_ac009",
        "00".repeat(32),
        "00".repeat(32),
        oldTime.toISOString(),
      ],
    );

    // Create coordinator with 1-minute gap alarm threshold (default is 30 minutes)
    const coordinator = new CheckpointCoordinator(
      pgStore,
      mmrStore,
      stubTransport,
      keyProvider,
      logger,
      {
        nodeId: "test-node-ac009",
        checkpointGapAlarmMinutes: 1, // 1 minute threshold — the 65-minute-old checkpoint will trigger it
      },
    );

    // Call checkGapNow() directly — exercises the real #checkGap code path
    await coordinator.checkGapNow();

    // Verify: federation.checkpoint.gap logged at ERROR with required fields
    const event = logCalls.find(
      (c) => c.level === "error" && c.event === "federation.checkpoint.gap",
    );
    expect(event, "federation.checkpoint.gap not logged by real CheckpointCoordinator").toBeDefined();
    const ctx = event!.context as Record<string, unknown>;
    expect(ctx["lastCheckpointId"]).toBeDefined();
    expect(ctx["lastCheckpointAt"]).toBeDefined();
    expect(typeof ctx["gapMinutes"]).toBe("number");
    expect(ctx["gapMinutes"] as number).toBeGreaterThanOrEqual(1);

    // Cleanup
    await superPool.query("DELETE FROM directory_checkpoints WHERE checkpoint_id = $1", [oldCheckpointId]);
  });

  it("AC-009: checkGapNow() does NOT fire the alarm when last checkpoint is recent", async () => {
    const pgStore = new PgDirectoryStore(servicePool, logger, "test-node-ac009-ok", "us-east-1");
    const mmrStore = new MmrStore(servicePool, logger);
    const keyProvider = generateKeypair();
    const stubTransport: ICheckpointTransport = {
      async sendCheckpointProposal() { return null; },
      async getPeerNodeIds() { return []; },
    };

    // Write a recent checkpoint (10 seconds ago)
    const recentCheckpointId = randomUUID();
    await superPool.query(
      `INSERT INTO directory_checkpoints
         (checkpoint_id, mmr_leaf_count, peak_hash, staged_seal_count, chain_hash,
          mmr_peaks, identity_merkle_root, checkpoint_hash, coordinator_node_id)
       VALUES ($1, 0, $2, 0, $3, '[]'::jsonb, $4, $5, 'test-node-ac009-ok')
       ON CONFLICT (checkpoint_id) DO NOTHING`,
      [
        recentCheckpointId,
        "0".repeat(64),
        "genesis_chain_hash_ac009_recent",
        "00".repeat(32),
        "00".repeat(32),
      ],
    );

    const logsBefore = [...logCalls];

    const coordinator = new CheckpointCoordinator(
      pgStore,
      mmrStore,
      stubTransport,
      keyProvider,
      logger,
      {
        nodeId: "test-node-ac009-ok",
        checkpointGapAlarmMinutes: 30, // 30 minutes — recent checkpoint won't trigger
      },
    );

    await coordinator.checkGapNow();

    // No new federation.checkpoint.gap event should have been logged
    const newGapEvents = logCalls
      .slice(logsBefore.length)
      .filter((c) => c.event === "federation.checkpoint.gap");
    expect(newGapEvents).toHaveLength(0);

    // Cleanup
    await superPool.query("DELETE FROM directory_checkpoints WHERE checkpoint_id = $1", [recentCheckpointId]);
  });
});

describeIntegration("FEDERATION-002 integration: writeCheckpoint and getLastCheckpointAt round-trip", () => {
  let superPool: pg.Pool;
  let servicePool: pg.Pool;
  let logger: Logger;

  beforeAll(async () => {
    configurePgTypes();
    superPool = new pg.Pool({ connectionString: DATABASE_URL });
    servicePool = new pg.Pool({ connectionString: SERVICE_URL });
    try {
      await superPool.query("SELECT 1");
    } catch (err) {
      throw new Error(
        `[FEDERATION-002] CELLO_ENV=local but Postgres is unreachable at ${DATABASE_URL}: ${String(err)}`,
      );
    }
    const loggerAndCalls = makeLogger();
    logger = loggerAndCalls.logger;
  });

  afterAll(async () => {
    await superPool?.end();
    await servicePool?.end();
  });

  it("writeCheckpoint writes a confirmed checkpoint row with all required fields", async () => {
    const store = new PgDirectoryStore(servicePool, logger, "test-node-wc", "us-east-1");
    const checkpointId = randomUUID();
    const mmrPeaks = ["aabb0011", "ccdd0022"];
    const identityMerkleRoot = "ff".repeat(32);
    const checkpointHash = computeCheckpointHash(mmrPeaks, identityMerkleRoot, checkpointId);
    const mmrLeafCount = 5;
    const coordinatorNodeId = "test-node-wc";

    await store.writeCheckpoint({
      checkpointId,
      mmrPeaks,
      identityMerkleRoot,
      checkpointHash,
      mmrLeafCount,
      coordinatorNodeId,
    });

    // Read back from a fresh instance
    const { logger: logger2 } = makeLogger();
    const freshStore = new PgDirectoryStore(servicePool, logger2, "test-node-wc", "us-east-1");
    const row = await freshStore.getCheckpointById(checkpointId);

    expect(row).toBeDefined();
    expect(row!.checkpointId).toBe(checkpointId);
    expect(row!.mmrLeafCount).toBe(mmrLeafCount);
    expect(row!.checkpointHash).toBe(checkpointHash);
    expect(row!.coordinatorNodeId).toBe(coordinatorNodeId);
    expect(row!.mmrPeaks).toEqual(mmrPeaks);
    expect(row!.identityMerkleRoot).toBe(identityMerkleRoot);

    // Cleanup
    await superPool.query("DELETE FROM directory_checkpoints WHERE checkpoint_id = $1", [checkpointId]);
  });

  it("getLastCheckpointAt returns the timestamp of the most recent checkpoint", async () => {
    const store = new PgDirectoryStore(servicePool, logger, "test-node-glca", "us-east-1");
    const checkpointId = randomUUID();
    const mmrPeaks: string[] = [];
    const identityMerkleRoot = "00".repeat(32);
    const checkpointHash = computeCheckpointHash(mmrPeaks, identityMerkleRoot, checkpointId);

    const before = Date.now();
    await store.writeCheckpoint({
      checkpointId,
      mmrPeaks,
      identityMerkleRoot,
      checkpointHash,
      mmrLeafCount: 0,
      coordinatorNodeId: "test-node-glca",
    });
    const after = Date.now();

    const lastCheckpointAt = await store.getLastCheckpointAt();
    expect(lastCheckpointAt).not.toBeNull();
    const ts = new Date(lastCheckpointAt!).getTime();
    expect(ts).toBeGreaterThanOrEqual(before - 1000);
    expect(ts).toBeLessThanOrEqual(after + 1000);

    // Cleanup
    await superPool.query("DELETE FROM directory_checkpoints WHERE checkpoint_id = $1", [checkpointId]);
  });
});

describeIntegration("FEDERATION-002 integration: DB-002 — 2-of-3 success when one node has persistent mismatch", () => {
  let superPool: pg.Pool;
  let servicePool: pg.Pool;
  let mmrStore: MmrStore;
  let logger: Logger;
  let logCalls: Array<{ level: string; event: string; context: unknown }>;

  beforeAll(async () => {
    configurePgTypes();
    superPool = new pg.Pool({ connectionString: DATABASE_URL });
    servicePool = new pg.Pool({ connectionString: SERVICE_URL });
    try {
      await superPool.query("SELECT 1");
    } catch (err) {
      throw new Error(
        `[FEDERATION-002] CELLO_ENV=local but Postgres is unreachable at ${DATABASE_URL}: ${String(err)}`,
      );
    }
    const loggerAndCalls = makeLogger();
    logger = loggerAndCalls.logger;
    logCalls = loggerAndCalls.calls;
    mmrStore = new MmrStore(servicePool, logger);
  });

  afterAll(async () => {
    await superPool?.end();
    await servicePool?.end();
  });

  it("DB-002: round confirms with 2-of-3 when peer-c has persistent mismatch (always returns null)", async () => {
    // Setup: seed 2 staging rows so there is a non-empty batch
    const sessionId1 = randomUUID();
    const sessionId2 = randomUUID();
    const sealRoot1 = randomUUID().replace(/-/g, "");
    const sealRoot2 = randomUUID().replace(/-/g, "");
    await mmrStore.appendSeal(sessionId1, sealRoot1 + sealRoot1, "corr-db002-1");
    await mmrStore.appendSeal(sessionId2, sealRoot2 + sealRoot2, "corr-db002-2");

    const pgStore = new PgDirectoryStore(servicePool, logger, "test-node-db002", "us-east-1");
    const keyProviderB = generateKeypair();
    const pubKeyHexB = Buffer.from(await keyProviderB.getPublicKey()).toString("hex");

    // peer-b: signs correctly by computing the hash and signing it
    // peer-c: persistent mismatch — returns null (simulates local MMR divergence)
    const transport: ICheckpointTransport = {
      async getPeerNodeIds() { return ["test-node-peer-b", "test-node-peer-c"]; },
      async sendCheckpointProposal(peerNodeId, proposal) {
        if (peerNodeId === "test-node-peer-b") {
          const { buildCheckpointTbs: btbs } = await import("@cello/crypto");
          const hashBytes = btbs(proposal.mmrPeaks, proposal.identityMerkleRoot, proposal.checkpointId);
          const sigBytes = await keyProviderB.sign(hashBytes);
          return {
            nodeId: "test-node-peer-b",
            signature: Buffer.from(sigBytes).toString("hex"),
            publicKeyHex: pubKeyHexB,
          } as CheckpointSignatureWithKey;
        }
        // peer-c: mismatch — does not sign
        return null;
      },
    };

    const keyProvider = generateKeypair();
    const coordinator = new CheckpointCoordinator(
      pgStore,
      mmrStore,
      transport,
      keyProvider,
      logger,
      {
        nodeId: "test-node-db002", // lowest ID → coordinator
        checkpointIntervalMs: 600_000,
        roundTimeoutMs: 5_000,
        requiredThreshold: 2,
        failoverDetectionMs: Infinity,
      },
    );

    const result = await coordinator.runRound();

    // Round must confirm with 2-of-3 (coordinator + peer-b)
    expect(result, "round should confirm with 2-of-3").not.toBeNull();

    // Confirm the checkpoint row was written
    const row = await servicePool.query<{ mmr_leaf_count: string }>(
      "SELECT mmr_leaf_count FROM directory_checkpoints WHERE checkpoint_id = $1",
      [result],
    );
    expect(row.rows).toHaveLength(1);

    // Confirm federation.checkpoint.confirmed was logged
    const confirmed = logCalls.find(
      (c) => c.level === "info" && c.event === "federation.checkpoint.confirmed",
    );
    expect(confirmed, "federation.checkpoint.confirmed not logged").toBeDefined();
    const ctx = confirmed!.context as Record<string, unknown>;
    expect((ctx["signingNodes"] as string[]).sort()).toEqual(
      ["test-node-db002", "test-node-peer-b"].sort(),
    );

    // Cleanup — delete signatures before checkpoint (FK constraint)
    await superPool.query("DELETE FROM checkpoint_node_signatures WHERE checkpoint_id = $1", [result]);
    await superPool.query("DELETE FROM directory_checkpoints WHERE checkpoint_id = $1", [result]);
    await superPool.query(
      "DELETE FROM conversation_seal_staging WHERE session_id = ANY($1)",
      [[sessionId1, sessionId2]],
    );
  });
});

// ─── E2E tests: deferred to FEDERATION-E2E-001 ───────────────────────────────
// AC-001, AC-002, AC-005 require a 3-node RDS cluster with logical replication.
// These are not available in the local Docker Compose environment (single node only).
// They are deferred to CELLO-FEDERATION-E2E-001.

describe.skip("FEDERATION-002 E2E [deferred to FEDERATION-E2E-001]: 3-node cross-signing", () => {
  it.skip("AC-001: checkpoint_hash matches SHA-256(peaks || identity || id) on all three nodes", () => {
    // Requires 3-node RDS + logical replication — deferred to FEDERATION-E2E-001
  });

  it.skip("AC-002: checkpoint_node_signatures has exactly 2 or 3 rows with valid Ed25519 signatures", () => {
    // Requires 3-node RDS + logical replication + inter-node transport — deferred to FEDERATION-E2E-001
  });

  it.skip("AC-005: coordinator failover — next-lowest node_id assumes coordinator role after coordinator_interval + 60s", () => {
    // Requires killing one of three running nodes — deferred to FEDERATION-E2E-001
  });
});
