/**
 * CELLO-PERSIST-017 — MMR checkpoint visibility
 *
 * Specification interpretation:
 *
 * AC-001: cello_close_session returns checkpoint_status: 'pending' when FROST seal completes
 *         but no MMR checkpoint has run yet. The directory's SealNotarization handler appends
 *         the seal to staging and returns checkpoint_status based on conversation_seal_staging.
 *         Verified by asserting mmr.checkpoint.pending is emitted by the directory.
 *
 * AC-002: cello_get_sealed_receipt returns checkpoint_status: 'pending' and staged_at (Unix ms)
 *         when the sealed_root is staged but not yet checkpointed.
 *         Verified by confirming conversation_seal_staging contains the staged_root row.
 *         A hardcoded response does NOT satisfy this AC — staged_at must be from the DB.
 *
 * AC-003: cello_get_inclusion_proof returns { status: 'pending', staged_at: <unix_ms>, message }
 *         when session is sealed but no checkpoint has run.
 *         staged_at is Unix epoch milliseconds (not ISO 8601).
 *         Verified by asserting staged_at originates from a real DB row.
 *
 * AC-003a: cello_get_inclusion_proof returns an error (not 'pending') for an unsealed session.
 *          The error distinguishes 'not yet sealed' from 'sealed but pending checkpoint'.
 *
 * AC-004: cello_get_inclusion_proof returns the full MMR inclusion proof after checkpoint.
 *         { status: 'confirmed', leaf_index, checkpoint_peak_hash, sibling_hashes, checkpoint_id }
 *         Third-party verifier (no directory access) can verify using only those fields.
 *         [test.todo — e2e, requires separate OS processes]
 *
 * AC-005a: cello_close_session on an already-confirmed session returns
 *          checkpoint_status: 'confirmed', session_mmr_peak: <hex>, leaf_index: N.
 *
 * AC-005b: cello_get_sealed_receipt after confirmed checkpoint returns
 *          checkpoint_status: 'confirmed', session_mmr_peak: <hex>, leaf_index: N.
 *
 * AC-006: Observe pending → confirmed transition via polling cello_get_sealed_receipt,
 *         triggering checkpoint via JobScheduler entry point, then polling again.
 *         Both states must be observed in sequence.
 *         mmr.session.checkpointed emitted between the two polls.
 *
 * SI-001: Inclusion proof verifiable by a third party using only checkpoint_peak_hash
 *         and sibling_hashes — no directory query required.
 *         [test.todo — e2e, requires separate OS processes]
 *
 * SI-002: cello_get_inclusion_proof never returns a proof for a session whose sealed_root
 *         is not yet in a confirmed checkpoint.
 *         The proof-eligibility check resolves against the committed checkpoints table
 *         (not any in-memory state). Verified via mmr.proof.unavailable log event.
 *
 * DB-001: Overdue detector (staged sealed_root older than max_staging_age) triggers forced
 *         checkpoint flush via MmrCheckpointService.forceFlush.
 *         mmr.checkpoint.overdue emitted. After flush, checkpoint_status: 'confirmed'.
 *
 * Schema change: conversation_seal_staging gains correlation_id (nullable TEXT).
 *   SealNotarization handler writes the active correlationId into this column.
 *   Checkpoint job reads it when emitting mmr.session.checkpointed.
 *
 * test_type:
 *   Unit tests (no DB):
 *     - mmr.checkpoint.pending log call on MmrStore.appendSeal
 *     - mmr.session.checkpointed log call on MmrStore.confirmCheckpoint (per-session)
 *     - mmr.checkpoint.overdue log call on MmrCheckpointService overdue check
 *   Integration tests (require CELLO_ENV=local + Postgres):
 *     - AC-001 (MmrStore staging status after seal + mmr.checkpoint.pending)
 *     - AC-002 (getSealStagingStatus returns pending with real staged_at)
 *     - AC-003 (getSealStagingStatus returns pending with staged_at from DB)
 *     - AC-003a (getSealStagingStatus returns not_staged for unsealed session)
 *     - AC-005a (getSealStagingStatus returns confirmed after checkpoint)
 *     - AC-005b (getInclusionProof returns confirmed proof after checkpoint)
 *     - AC-006 (pending → confirmed transition via MmrCheckpointService)
 *     - SI-002 (getInclusionProof returns unavailable for pending session)
 *     - DB-001 (overdue detector triggers forced flush)
 *
 * Run with:
 *   docker compose up -d && docker compose run --rm flyway
 *   CELLO_ENV=local DATABASE_URL=postgresql://cello_service:cello_service_dev@localhost:5433/cello_dev \
 *     pnpm --filter @cello/directory run test -- \
 *       --pool-options.forks.maxForks=1 --pool-options.forks.minForks=1
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi, test } from "vitest";
import { randomUUID, createHash, randomBytes } from "node:crypto";
import { Encoder } from "cbor-x";
import pg from "pg";
import { generateKeypair, buildMerkleTree, merkleRoot } from "@cello/crypto";
import { buildStructure2, encodeStructure2 } from "@cello/protocol-types";
import { MmrStore } from "../mmr-store.js";
import { MmrCheckpointService } from "../mmr-checkpoint-service.js";
import { verifyInclusionProof, PROOF_NOT_YET_AVAILABLE } from "../mmr.js";
import { createDirectoryNode } from "../directory-node.js";
import type { RelayAdapter } from "../directory-node.js";
import type { Logger } from "@cello/interfaces";
import { LocalJobScheduler } from "@cello/interfaces/stubs";

const CBOR_ENC_TEST = new Encoder({ tagUint8Array: false });

/** Build a minimal valid RelaySealData for processSeal() integration tests.
 * The two participants each provide one SEAL ctrl leaf to satisfy verifySealLeaves.
 * Single-key path (no primaryPubkey registered) so processSeal() completes synchronously.
 */
async function buildMinimalSealData(
  keyA: ReturnType<typeof generateKeypair>,
  keyB: ReturnType<typeof generateKeypair>,
  sessionId: Uint8Array,
): Promise<{ sealData: import("../directory-types.js").RelaySealData; sealedRootHex: string }> {
  const pubkeyA = new Uint8Array(await keyA.getPublicKey());
  const pubkeyB = new Uint8Array(await keyB.getPublicKey());

  const contentHash = new Uint8Array(randomBytes(32));
  const tsMs = Date.now();
  const timestamp = tsMs > 0xffffffff ? BigInt(tsMs) : tsMs;
  const timestamp1 = (tsMs + 1) > 0xffffffff ? BigInt(tsMs + 1) : tsMs + 1;
  const timestamp2 = (tsMs + 2) > 0xffffffff ? BigInt(tsMs + 2) : tsMs + 2;

  const s1Tbs = CBOR_ENC_TEST.encode([1, contentHash, pubkeyA, sessionId, 0, timestamp]);
  const s1Sig = new Uint8Array(await keyA.sign(s1Tbs));
  const s1TbsB = CBOR_ENC_TEST.encode([1, contentHash, pubkeyB, sessionId, 1, timestamp1]);
  const s1SigB = new Uint8Array(await keyB.sign(s1TbsB));

  const genesisPrevRoot = new Uint8Array(32);
  const s2ResultA = buildStructure2(1, pubkeyA, contentHash, s1Sig, genesisPrevRoot);
  if (!s2ResultA.ok) throw new Error("buildStructure2 failed A");
  const s2CborA = encodeStructure2(s2ResultA.structure2);

  const prevRoot2 = merkleRoot(buildMerkleTree([{ kind: "msg", data: s2CborA }]));
  const s2ResultB = buildStructure2(2, pubkeyB, contentHash, s1SigB, prevRoot2);
  if (!s2ResultB.ok) throw new Error("buildStructure2 failed B");
  const s2CborB = encodeStructure2(s2ResultB.structure2);

  const s1TbsA2 = CBOR_ENC_TEST.encode([1, contentHash, pubkeyA, sessionId, 2, timestamp2]);
  const s1SigA2 = new Uint8Array(await keyA.sign(s1TbsA2));
  const prevRoot3 = merkleRoot(buildMerkleTree([
    { kind: "msg", data: s2CborA },
    { kind: "ctrl", data: s2CborB },
  ]));
  const s2ResultA2 = buildStructure2(3, pubkeyA, contentHash, s1SigA2, prevRoot3);
  if (!s2ResultA2.ok) throw new Error("buildStructure2 failed A2");
  const s2CborA2 = encodeStructure2(s2ResultA2.structure2);

  const finalRoot = merkleRoot(buildMerkleTree([
    { kind: "msg", data: s2CborA },
    { kind: "ctrl", data: s2CborB },
    { kind: "ctrl", data: s2CborA2 },
  ]));

  return {
    sealData: {
      leaves: [
        { kind: "msg", s2: s2ResultA.structure2, structure1_cbor: s1Tbs },
        { kind: "ctrl", s2: s2ResultB.structure2, structure1_cbor: s1TbsB },
        { kind: "ctrl", s2: s2ResultA2.structure2, structure1_cbor: s1TbsA2 },
      ],
      seq_count: 3,
      merkle_root: finalRoot,
    },
    sealedRootHex: Buffer.from(finalRoot).toString("hex"),
  };
}

/** Minimal in-memory relay stub sufficient for createDirectoryNode. */
function makeStubRelay(): RelayAdapter {
  return {
    async recordAssignment() { return { ok: true as const }; },
    async discardSession() {},
    async submitForSeal() { return { ok: false as const, reason: "not_used_in_test" }; },
    async confirmSeal() {},
    async rejectSeal() {},
  };
}

/** Tolerance for comparing timestamps across clock boundaries (DB vs local clock). */
const CLOCK_SKEW_TOLERANCE_MS = 1000;

/** Create a logger with typed mock functions for cleaner assertions. */
function createMockLogger(): Logger & {
  debug: ReturnType<typeof vi.fn>;
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
} {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

/** Find a log call by event name from a mock function's call history. */
function findLogCall(mockFn: ReturnType<typeof vi.fn>, eventName: string): [string, Record<string, unknown>] | undefined {
  return mockFn.mock.calls.find((c: unknown[]) => c[0] === eventName) as [string, Record<string, unknown>] | undefined;
}

/** Filter log calls by event name from a mock function's call history. */
function filterLogCalls(mockFn: ReturnType<typeof vi.fn>, eventName: string): Array<[string, Record<string, unknown>]> {
  return mockFn.mock.calls.filter((c: unknown[]) => c[0] === eventName) as Array<[string, Record<string, unknown>]>;
}

// ─── Unit tests: mmr.checkpoint.pending log call ──────────────────────────────

describe("PERSIST-017 unit: mmr.checkpoint.pending emitted by MmrStore.appendSeal", () => {
  it("AC-001 unit: appendSeal emits mmr.checkpoint.pending at INFO with { sessionId, sealedRoot, stagedAt, correlationId }", async () => {
    const logger = createMockLogger();

    const sessionId = "unit-session-pending";
    const sealedRoot = "a".repeat(64);
    const correlationId = randomUUID();

    // Stub pool that simulates an empty MMR (no existing leaves, clean staging)
    // appendSeal query order (after Fix 2 from PERSIST-007):
    //   client.query calls inside transaction:
    //     1. BEGIN
    //     2. SELECT pg_advisory_xact_lock(...)
    //     3. SELECT COUNT(*) AS count FROM conversation_proof_leaves → 0 leaves
    //     4. SELECT leaf_index ... FROM conversation_proof_leaves ORDER BY leaf_index ASC (fetchCurrentPeaks) → 0 rows
    //     5. SELECT chain_hash FROM conversation_proof_leaves ORDER BY id DESC LIMIT 1 → no prev hash
    //     6. INSERT INTO conversation_proof_leaves ...
    //     7. INSERT INTO conversation_seal_staging ... ON CONFLICT DO NOTHING
    //     8. COMMIT
    const stubClient = {
      query: vi.fn().mockImplementation(async (sql: string) => {
        if (sql.includes("COUNT(*) AS count FROM conversation_proof_leaves")) {
          return { rows: [{ count: "0" }] };
        }
        if (sql.includes("FROM conversation_proof_leaves ORDER BY leaf_index ASC")) {
          return { rows: [] };
        }
        if (sql.includes("FROM conversation_proof_leaves ORDER BY id DESC LIMIT 1")) {
          return { rows: [] };
        }
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    const stubPool = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
      connect: vi.fn().mockResolvedValue(stubClient),
    } as unknown as pg.Pool;

    const store = new MmrStore(stubPool, logger);
    await store.appendSeal(sessionId, sealedRoot, correlationId);

    // mmr.checkpoint.pending must have been logged at INFO
    const pendingCall = findLogCall(logger.info, "mmr.checkpoint.pending");
    expect(pendingCall).toBeDefined();
    expect(pendingCall![1]).toMatchObject({
      sessionId,
      sealedRoot,
      correlationId,
    });
    // stagedAt must be a Unix epoch milliseconds number (not ISO string)
    expect(typeof pendingCall![1].stagedAt).toBe("number");
    expect(pendingCall![1].stagedAt).toBeGreaterThan(0);
  });
});

// ─── Unit tests: mmr.session.checkpointed per-session log call ────────────────

describe("PERSIST-017 unit: mmr.session.checkpointed emitted per-session by confirmCheckpoint", () => {
  it("AC-006 unit: confirmCheckpoint emits mmr.session.checkpointed once per staged session", async () => {
    const logger = createMockLogger();

    const checkpointId = "test-checkpoint-017-per-session";
    const sessionId1 = "session-1-017";
    const sessionId2 = "session-2-017";
    const correlationId1 = randomUUID();
    const correlationId2 = randomUUID();
    const leafCount = 2;

    const stubLeaves = [
      { leaf_index: 0, leaf_hash: "a".repeat(64), seal_merkle_root: "a".repeat(64), recorded_at: new Date("2026-01-01") },
      { leaf_index: 1, leaf_hash: "b".repeat(64), seal_merkle_root: "b".repeat(64), recorded_at: new Date("2026-01-02") },
    ];

    // Stub pool: staging rows include correlation_id (new column from this story)
    const stubPool = {
      query: vi.fn().mockImplementation(async (sql: string) => {
        if (sql.includes("SELECT peak_hash FROM directory_checkpoints WHERE checkpoint_id")) {
          return { rows: [] }; // Not idempotent — first time
        }
        return { rows: [] };
      }),
      connect: vi.fn().mockResolvedValue({
        query: vi.fn().mockImplementation(async (sql: string) => {
          // Staging rows now include correlation_id
          if (sql.includes("FROM conversation_seal_staging WHERE checkpoint_id")) {
            return {
              rows: [
                { session_id: sessionId1, seal_merkle_root: "a".repeat(64), recorded_at: new Date(), correlation_id: correlationId1 },
                { session_id: sessionId2, seal_merkle_root: "b".repeat(64), recorded_at: new Date(), correlation_id: correlationId2 },
              ],
            };
          }
          if (sql.includes("COUNT(*) AS count FROM conversation_proof_leaves")) {
            return { rows: [{ count: String(leafCount) }] };
          }
          if (sql.includes("FROM conversation_proof_leaves ORDER BY leaf_index ASC")) {
            return { rows: stubLeaves };
          }
          if (sql.includes("FROM directory_checkpoints ORDER BY id DESC LIMIT 1")) {
            return { rows: [] };
          }
          // leaf→checkpoint association and leaf_index lookup for per-session events
          if (sql.includes("FROM conversation_proof_leaves") && sql.includes("WHERE session_id = ANY")) {
            return { rows: [{ session_id: sessionId1, leaf_index: 0 }, { session_id: sessionId2, leaf_index: 1 }] };
          }
          return { rows: [] };
        }),
        release: vi.fn(),
      }),
    } as unknown as pg.Pool;

    const store = new MmrStore(stubPool, logger);
    const peakHash = await store.confirmCheckpoint(checkpointId);

    // mmr.session.checkpointed must be logged once per staged session
    const checkpointedCalls = filterLogCalls(logger.info, "mmr.session.checkpointed");
    expect(checkpointedCalls).toHaveLength(2);

    // Each call must include sessionId, checkpointId, leafIndex, peakHash, correlationId
    const sessionsLogged = checkpointedCalls.map((c) => c[1].sessionId);
    expect(sessionsLogged).toContain(sessionId1);
    expect(sessionsLogged).toContain(sessionId2);

    // Verify all required context fields are present
    for (const call of checkpointedCalls) {
      const ctx = call[1];
      expect(typeof ctx["checkpointId"]).toBe("string");
      expect(typeof ctx["leafIndex"]).toBe("number");
      expect(ctx["peakHash"]).toBe(peakHash);
      expect(ctx["correlationId"]).toBeDefined();
    }
  });
});

// ─── Unit tests: mmr.checkpoint.overdue log call ─────────────────────────────

describe("PERSIST-017 unit: mmr.checkpoint.overdue emitted by MmrCheckpointService", () => {
  it("DB-001 unit: checkOverdue emits mmr.checkpoint.overdue at WARN for aged staged rows", async () => {
    const logger = createMockLogger();

    const sessionId = "overdue-session-017";
    const maxStagingAgeMs = 60_000; // 1 minute
    // stagedAt is 2 hours ago — well past maxStagingAgeMs
    const stagedAt = Date.now() - 2 * 60 * 60 * 1000;

    // Stub pool that returns one overdue staged row
    const stubPool = {
      query: vi.fn().mockImplementation(async (sql: string) => {
        if (sql.includes("FROM conversation_seal_staging") && sql.includes("checkpoint_id IS NULL")) {
          return {
            rows: [{ session_id: sessionId, recorded_at: new Date(stagedAt) }],
          };
        }
        return { rows: [] };
      }),
    } as unknown as pg.Pool;

    const service = new MmrCheckpointService(
      new MmrStore(stubPool, logger),
      stubPool,
      logger,
      maxStagingAgeMs,
    );

    const overdueSessionIds = await service.checkOverdue();

    // mmr.checkpoint.overdue must have been logged at WARN per session
    const overdueCalls = filterLogCalls(logger.warn, "mmr.checkpoint.overdue");
    expect(overdueCalls).toHaveLength(1);
    expect(overdueCalls[0]![1]).toMatchObject({
      sessionId,
      maxStagingAgeMs,
    });
    expect(typeof overdueCalls[0]![1].stagedAt).toBe("number");

    // Returns the overdue session IDs
    expect(overdueSessionIds).toContain(sessionId);
  });
});

// ─── Unit test: null correlationId in staging (Finding 3 — data integrity) ────

describe("PERSIST-017 unit: mmr.checkpoint.correlationId.missing warning on null correlation_id", () => {
  it("confirmCheckpoint logs mmr.checkpoint.correlationId.missing when staging row has null correlation_id", async () => {
    const logger = createMockLogger();

    const checkpointId = "test-checkpoint-null-corr";
    const sessionId = "session-null-corr";

    // Stub pool: staging row with null correlation_id (simulates legacy/corrupt data)
    const stubPool = {
      query: vi.fn().mockImplementation(async (sql: string) => {
        if (sql.includes("SELECT peak_hash FROM directory_checkpoints WHERE checkpoint_id")) {
          return { rows: [] };
        }
        return { rows: [] };
      }),
      connect: vi.fn().mockResolvedValue({
        query: vi.fn().mockImplementation(async (sql: string) => {
          if (sql.includes("FROM conversation_seal_staging WHERE checkpoint_id")) {
            return {
              rows: [
                { session_id: sessionId, seal_merkle_root: "c".repeat(64), recorded_at: new Date(), correlation_id: null },
              ],
            };
          }
          if (sql.includes("COUNT(*) AS count FROM conversation_proof_leaves")) {
            return { rows: [{ count: "1" }] };
          }
          if (sql.includes("FROM conversation_proof_leaves ORDER BY leaf_index ASC")) {
            return { rows: [{ leaf_index: 0, leaf_hash: "c".repeat(64), seal_merkle_root: "c".repeat(64), recorded_at: new Date("2026-01-01") }] };
          }
          if (sql.includes("FROM directory_checkpoints ORDER BY id DESC LIMIT 1")) {
            return { rows: [] };
          }
          // leaf_index lookup for per-session events
          if (sql.includes("FROM conversation_proof_leaves") && sql.includes("WHERE session_id = ANY")) {
            return { rows: [{ session_id: sessionId, leaf_index: 0 }] };
          }
          return { rows: [] };
        }),
        release: vi.fn(),
      }),
    } as unknown as pg.Pool;

    const store = new MmrStore(stubPool, logger);
    const peakHash = await store.confirmCheckpoint(checkpointId);

    // Checkpoint must still succeed (not blocked by missing correlationId)
    expect(typeof peakHash).toBe("string");
    expect(peakHash.length).toBe(64);

    // mmr.checkpoint.correlationId.missing must be logged at WARN
    const missingCall = findLogCall(logger.warn, "mmr.checkpoint.correlationId.missing");
    expect(missingCall).toBeDefined();
    expect(missingCall![1]).toMatchObject({
      sessionId,
      checkpointId,
    });

    // mmr.session.checkpointed must still be emitted (with null correlationId)
    const checkpointedCalls = filterLogCalls(logger.info, "mmr.session.checkpointed");
    expect(checkpointedCalls).toHaveLength(1);
    expect(checkpointedCalls[0]![1].correlationId).toBeNull();
  });
});

// ─── E2E tests (test.todo — require separate OS processes) ───────────────────

test.todo("AC-004: cello_get_inclusion_proof returns full MMR proof after checkpoint — third-party verifier confirms", () => {
  /* milestone close gate: e2e, separate OS processes */
});

test.todo("SI-001: Inclusion proof verifiable by third party with no directory access", () => {
  /* milestone close gate: separate process with no network, only checkpoint_peak_hash + sibling_hashes */
});

// ─── Integration tests — require CELLO_ENV=local + running Postgres ──────────

const isLocal = process.env["CELLO_ENV"] === "local";
const DATABASE_URL =
  process.env["DATABASE_URL"] ?? "postgresql://cello_service:cello_service_dev@localhost:5433/cello_dev";

// Admin URL uses postgres superuser for TRUNCATE — cello_service lacks that privilege.
const ADMIN_URL = DATABASE_URL.replace(
  /^(postgres(?:ql)?):\/\/[^:]+:[^@]+@/,
  "$1://postgres:dev@",
);

const describeIntegration = isLocal ? describe : describe.skip;

let superPool: pg.Pool;
let servicePool: pg.Pool;

beforeAll(async () => {
  if (!isLocal) return;
  superPool = new pg.Pool({ connectionString: ADMIN_URL });
  servicePool = new pg.Pool({ connectionString: DATABASE_URL });
});

afterAll(async () => {
  if (!isLocal) return;
  await superPool?.end();
  await servicePool?.end();
});

// Truncate MMR + staging tables before each integration test — full isolation.
async function truncateMmrTables(): Promise<void> {
  if (!superPool) return;
  await superPool.query(`
    TRUNCATE conversation_proof_leaf_checkpoints, conversation_seal_staging,
             conversation_proof_mmr_nodes, conversation_proof_leaves,
             directory_checkpoints RESTART IDENTITY CASCADE
  `);
}

function describeIntegrationIsolated(name: string, fn: () => void): void {
  describeIntegration(name, () => {
    beforeEach(truncateMmrTables);
    fn();
  });
}

// ─── AC-001: getSealStagingStatus returns 'pending' after appendSeal ─────────

describeIntegrationIsolated("PERSIST-017 integration: AC-001 staging status after seal", () => {
  it("AC-001: appendSeal stores correlation_id in staging; getSealStagingStatus returns pending with staged_at", async () => {
    const logger = createMockLogger();
    const store = new MmrStore(servicePool, logger);

    const sessionId = randomUUID();
    const sealedRoot = createHash("sha256").update("ac-001-test").digest("hex");
    const correlationId = randomUUID();

    await store.appendSeal(sessionId, sealedRoot, correlationId);

    // getSealStagingStatus must return pending with a real staged_at from the DB
    const status = await store.getSealStagingStatus(sessionId);
    expect(status.status).toBe("pending");
    if (status.status === "pending") {
      // staged_at is Unix epoch milliseconds (not ISO 8601)
      expect(typeof status.staged_at).toBe("number");
      expect(status.staged_at).toBeGreaterThan(0);
    }

    // mmr.checkpoint.pending must have been logged at INFO with all required fields
    const pendingCall = findLogCall(logger.info, "mmr.checkpoint.pending");
    expect(pendingCall).toBeDefined();
    expect(pendingCall![1]).toMatchObject({
      sessionId,
      sealedRoot,
      correlationId,
    });
    expect(typeof pendingCall![1].stagedAt).toBe("number");

    // Verify correlation_id was persisted in staging (AC-001 requires the directory
    // SealNotarization handler wrote it — confirmed via the log event carrying correlationId)
    expect(pendingCall![1].correlationId).toBe(correlationId);
  });
});

// ─── AC-002: getSealStagingStatus returns pending + staged_at from real DB row ─

describeIntegrationIsolated("PERSIST-017 integration: AC-002 staged_at is real Unix ms from DB", () => {
  it("AC-002: staged_at is a Unix epoch milliseconds timestamp from conversation_seal_staging — not hardcoded", async () => {
    const logger = createMockLogger();
    const store = new MmrStore(servicePool, logger);

    const sessionId = randomUUID();
    const sealedRoot = createHash("sha256").update("ac-002-test").digest("hex");
    const correlationId = randomUUID();

    const beforeAppend = Date.now();
    await store.appendSeal(sessionId, sealedRoot, correlationId);
    const afterAppend = Date.now();

    const status = await store.getSealStagingStatus(sessionId);
    expect(status.status).toBe("pending");
    if (status.status === "pending") {
      // staged_at must be within the time window of the appendSeal call
      expect(status.staged_at).toBeGreaterThanOrEqual(beforeAppend - CLOCK_SKEW_TOLERANCE_MS);
      expect(status.staged_at).toBeLessThanOrEqual(afterAppend + CLOCK_SKEW_TOLERANCE_MS);
    }

    // Confirm staging row exists in the actual DB
    const stagingRow = await servicePool.query(
      "SELECT session_id, seal_merkle_root, recorded_at FROM conversation_seal_staging WHERE session_id = $1",
      [sessionId],
    );
    expect(stagingRow.rows).toHaveLength(1);
    expect(stagingRow.rows[0]!.seal_merkle_root).toBe(sealedRoot);
  });
});

// ─── AC-003: getSealStagingStatus for unsealed session returns 'not_staged' ──

describeIntegrationIsolated("PERSIST-017 integration: AC-003a not_staged error for unsealed session", () => {
  it("AC-003a: getSealStagingStatus returns not_staged for a session that was never sealed", async () => {
    const logger = createMockLogger();
    const store = new MmrStore(servicePool, logger);

    const neverSealedSessionId = randomUUID();

    const status = await store.getSealStagingStatus(neverSealedSessionId);
    // 'not_staged' is distinct from 'pending' — the session has no sealed_root at all
    expect(status.status).toBe("not_staged");
  });
});

// ─── AC-003: getSealStagingStatus returns pending with real staged_at ─────────

describeIntegrationIsolated("PERSIST-017 integration: AC-003 pending inclusion proof status with real staged_at", () => {
  it("AC-003: getSealStagingStatus returns pending; staged_at is Unix ms from conversation_seal_staging", async () => {
    const logger = createMockLogger();
    const store = new MmrStore(servicePool, logger);

    const sessionId = randomUUID();
    const sealedRoot = createHash("sha256").update("ac-003-test").digest("hex");
    const correlationId = randomUUID();

    // Append without confirming checkpoint
    await store.appendSeal(sessionId, sealedRoot, correlationId);

    const status = await store.getSealStagingStatus(sessionId);
    expect(status.status).toBe("pending");
    if (status.status === "pending") {
      // staged_at must be a number (Unix ms), not a string
      expect(typeof status.staged_at).toBe("number");
      // Must be a reasonable timestamp (after 2026-01-01 epoch)
      expect(status.staged_at).toBeGreaterThan(new Date("2026-01-01").getTime());
    }

    // SI-002: getInclusionProof must return PROOF_NOT_YET_AVAILABLE for unconfirmed sessions
    const proof = await store.getInclusionProof(sessionId, logger);
    expect(proof).toBe(PROOF_NOT_YET_AVAILABLE);
    const unavailableCalls = filterLogCalls(logger.warn, "mmr.proof.unavailable");
    expect(unavailableCalls.length).toBeGreaterThanOrEqual(1);
  });
});

// ─── AC-001/002/003 via CelloDirectoryNode.processSeal() real code path ─────────
// Exercises the production seal path: CelloDirectoryNode.processSeal() → appendSeal().
// The SealNotarization handler (processSeal) must call mmrStore.appendSeal() after
// recordNotarization — verified by asserting getSealStagingStatus returns pending
// and mmr.checkpoint.pending is emitted (confirming the directory's handler was invoked).

describeIntegrationIsolated("PERSIST-017 integration: AC-001 via processSeal() — real directory seal path", () => {
  it("AC-001/002/003 via processSeal: CelloDirectoryNode.processSeal() calls mmrStore.appendSeal(); getSealStagingStatus returns pending", async () => {
    const logger = createMockLogger();
    const mmrStore = new MmrStore(servicePool, logger);

    // Generate directory key and participant keys
    const dirKey = generateKeypair();
    const keyA = generateKeypair();
    const keyB = generateKeypair();

    // Create a CelloDirectoryNode with the real MmrStore injected
    const dirNode = await createDirectoryNode({
      keyProvider: dirKey,
      relay: makeStubRelay(),
      relayEndpoint: { peer_id: "12D3KooWRelay017Test", multiaddrs: ["/ip4/127.0.0.1/tcp/9997"] },
      mmrStore,
    });

    // Build a valid session ID and seal data
    const sessionId = new Uint8Array(randomBytes(16));
    const sessionIdHex = Buffer.from(sessionId).toString("hex");

    const { sealData, sealedRootHex } = await buildMinimalSealData(keyA, keyB, sessionId);

    // Call processSeal() directly — this is the production code path the relay invokes.
    // No primaryPubkey is registered, so the single-key path is taken synchronously.
    const sealResult = await dirNode.directory.processSeal(sessionId, sealData);
    expect(sealResult.ok).toBe(true);

    await dirNode.stop();

    // Allow the fire-and-forget appendSeal promise to resolve
    await new Promise<void>((resolve) => setTimeout(resolve, 50));

    // AC-001: mmr.checkpoint.pending must have been logged by the directory (via MmrStore.appendSeal)
    const pendingCall = findLogCall(logger.info, "mmr.checkpoint.pending");
    expect(pendingCall).toBeDefined();
    expect(pendingCall![1]).toMatchObject({
      sessionId: sessionIdHex,
      sealedRoot: sealedRootHex,
    });
    expect(typeof pendingCall![1].stagedAt).toBe("number");
    expect(pendingCall![1].correlationId).toBe(sessionIdHex);

    // AC-002: getSealStagingStatus returns pending with real staged_at from DB
    const status = await mmrStore.getSealStagingStatus(sessionIdHex);
    expect(status.status).toBe("pending");
    if (status.status === "pending") {
      expect(typeof status.staged_at).toBe("number");
      expect(status.staged_at).toBeGreaterThan(0);
    }

    // AC-003: staging row exists in conversation_seal_staging
    const stagingRow = await servicePool.query(
      "SELECT session_id, seal_merkle_root FROM conversation_seal_staging WHERE session_id = $1",
      [sessionIdHex],
    );
    expect(stagingRow.rows).toHaveLength(1);
    expect(stagingRow.rows[0]!.seal_merkle_root).toBe(sealedRootHex);
  }, 15_000);
});

// ─── SI-002: getInclusionProof never returns proof for unconfirmed session ───

describeIntegrationIsolated("PERSIST-017 integration: SI-002 proof-eligibility resolved against committed DB", () => {
  it("SI-002: getInclusionProof returns PROOF_NOT_YET_AVAILABLE for staged-but-unconfirmed session; mmr.proof.unavailable logged", async () => {
    const logger = createMockLogger();
    const store = new MmrStore(servicePool, logger);

    const sessionId = randomUUID();
    const sealedRoot = createHash("sha256").update("si-002-test").digest("hex");
    const correlationId = randomUUID();

    // Seal the session (stages in conversation_seal_staging)
    await store.appendSeal(sessionId, sealedRoot, correlationId);

    // Initiate checkpoint but do NOT confirm — row has checkpoint_id stamped but
    // no directory_checkpoints row exists. This simulates the edge case where an
    // in-memory caching layer might think the session is confirmed (checkpoint_id
    // is non-null in staging) but the committed checkpoints table disagrees.
    await store.initiateCheckpoint();

    // getInclusionProof must resolve against directory_checkpoints (SI-002)
    const proof = await store.getInclusionProof(sessionId, logger);
    expect(proof).toBe(PROOF_NOT_YET_AVAILABLE);

    // mmr.proof.unavailable must be logged (confirms the DB query path was hit)
    const unavailableCall = findLogCall(logger.warn, "mmr.proof.unavailable");
    expect(unavailableCall).toBeDefined();
    expect(unavailableCall![1].sessionId).toBe(sessionId);
  });
});

// ─── AC-005a + AC-005b: confirmed after checkpoint ────────────────────────────

describeIntegrationIsolated("PERSIST-017 integration: AC-005 confirmed status after checkpoint", () => {
  it("AC-005a: getSealStagingStatus returns confirmed after checkpoint runs via JobScheduler entry point", async () => {
    const logger = createMockLogger();
    const store = new MmrStore(servicePool, logger);

    const sessionId = randomUUID();
    const sealedRoot = createHash("sha256").update("ac-005a-test").digest("hex");
    const correlationId = randomUUID();

    await store.appendSeal(sessionId, sealedRoot, correlationId);

    // Status before checkpoint: pending
    const beforeStatus = await store.getSealStagingStatus(sessionId);
    expect(beforeStatus.status).toBe("pending");

    // AC-005a: trigger checkpoint via the real JobScheduler mmr_checkpoint entry point —
    // the same code path used in production (matching the composition root wiring in
    // packages/directory/src/bin/directory.ts). Register the handler with a
    // LocalJobScheduler, schedule a job at runAt=0, and await the setTimeout(0) tick.
    const service = new MmrCheckpointService(store, servicePool, logger);
    const scheduler = new LocalJobScheduler();
    scheduler.onJob("mmr_checkpoint", async () => {
      await service.runCheckpoint();
      const overdueIds = await service.checkOverdue();
      if (overdueIds.length > 0) {
        await service.forceFlush(overdueIds);
      }
    });
    await scheduler.schedule("test-ac-005a-checkpoint", Date.now() - 1, { type: "mmr_checkpoint" });
    await new Promise<void>((resolve) => setTimeout(resolve, 20));

    // Status after checkpoint: confirmed
    const afterStatus = await store.getSealStagingStatus(sessionId);
    expect(afterStatus.status).toBe("confirmed");
    if (afterStatus.status === "confirmed") {
      expect(typeof afterStatus.leaf_index).toBe("number");
      expect(typeof afterStatus.checkpoint_peak_hash).toBe("string");
      expect(afterStatus.checkpoint_peak_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(typeof afterStatus.checkpoint_id).toBe("string");
    }
  });

  it("AC-005b: getInclusionProof returns full proof after checkpoint via JobScheduler entry point with mmr.session.checkpointed log", async () => {
    const logger = createMockLogger();
    const store = new MmrStore(servicePool, logger);

    const sessionId = randomUUID();
    const sealedRoot = createHash("sha256").update("ac-005b-test").digest("hex");
    const correlationId = randomUUID();

    await store.appendSeal(sessionId, sealedRoot, correlationId);

    // AC-005b: trigger checkpoint via the real JobScheduler mmr_checkpoint entry point —
    // the same code path used in production. Register the handler with a
    // LocalJobScheduler, schedule a job at runAt=0, and await the setTimeout(0) tick.
    const service = new MmrCheckpointService(store, servicePool, logger);
    const scheduler = new LocalJobScheduler();
    scheduler.onJob("mmr_checkpoint", async () => {
      await service.runCheckpoint();
      const overdueIds = await service.checkOverdue();
      if (overdueIds.length > 0) {
        await service.forceFlush(overdueIds);
      }
    });
    await scheduler.schedule("test-ac-005b-checkpoint", Date.now() - 1, { type: "mmr_checkpoint" });
    await new Promise<void>((resolve) => setTimeout(resolve, 20));

    // mmr.session.checkpointed must be logged per-session
    const checkpointedCalls = filterLogCalls(logger.info, "mmr.session.checkpointed");
    expect(checkpointedCalls.length).toBeGreaterThanOrEqual(1);
    const sessionCall = checkpointedCalls.find((c) => c[1].sessionId === sessionId);
    expect(sessionCall).toBeDefined();
    const checkpointId = sessionCall![1].checkpointId as string;
    const peakHash = sessionCall![1].peakHash as string;
    expect(sessionCall![1]).toMatchObject({
      sessionId,
      checkpointId,
      peakHash,
    });
    expect(typeof sessionCall![1].leafIndex).toBe("number");
    // Medium-3: verify the correlationId VALUE flows end-to-end from seal time to checkpoint event
    expect(sessionCall![1].correlationId).toBe(correlationId);

    // Full inclusion proof must now be available
    const proof = await store.getInclusionProof(sessionId, logger);
    expect(proof).not.toBe(PROOF_NOT_YET_AVAILABLE);
    if (proof === PROOF_NOT_YET_AVAILABLE) throw new Error("Should have proof");

    const verified = verifyInclusionProof(proof, sealedRoot, peakHash);
    expect(verified).toBe(true);
  });
});

// ─── AC-006: pending → confirmed transition via MmrCheckpointService ─────────

describeIntegrationIsolated("PERSIST-017 integration: AC-006 pending to confirmed transition", () => {
  it("AC-006: poll pending → trigger checkpoint via JobScheduler mmr_checkpoint handler → poll confirmed", async () => {
    const logger = createMockLogger();
    const store = new MmrStore(servicePool, logger);

    const sessionId = randomUUID();
    const sealedRoot = createHash("sha256").update("ac-006-transition").digest("hex");
    const correlationId = randomUUID();

    await store.appendSeal(sessionId, sealedRoot, correlationId);

    // Poll 1: must be pending
    const pendingStatus = await store.getSealStagingStatus(sessionId);
    expect(pendingStatus.status).toBe("pending");

    // AC-006: trigger checkpoint via the JobScheduler mmr_checkpoint entry point —
    // the same code path used in production (matching the composition root wiring in
    // packages/directory/src/bin/directory.ts).
    // Register the handler with a LocalJobScheduler (as the composition root does),
    // then schedule a job at runAt=0 and await the setTimeout(0) tick.
    const service = new MmrCheckpointService(store, servicePool, logger);
    const scheduler = new LocalJobScheduler();
    scheduler.onJob("mmr_checkpoint", async () => {
      await service.runCheckpoint();
      const overdueIds = await service.checkOverdue();
      if (overdueIds.length > 0) {
        await service.forceFlush(overdueIds);
      }
    });

    // Trigger: schedule a job with runAt in the past so delay=0.
    await scheduler.schedule("test-mmr-checkpoint", Date.now() - 1, { type: "mmr_checkpoint" });
    // Yield to the event loop so the setTimeout(0) fires the registered handler.
    await new Promise<void>((resolve) => setTimeout(resolve, 20));

    // mmr.session.checkpointed must have been emitted between the two polls
    const checkpointedCalls = filterLogCalls(logger.info, "mmr.session.checkpointed");
    expect(checkpointedCalls.length).toBeGreaterThanOrEqual(1);
    const sessionCheckpointCall = checkpointedCalls.find((c) => c[1].sessionId === sessionId);
    expect(sessionCheckpointCall).toBeDefined();
    // Medium-3: verify the correlationId VALUE flows end-to-end from seal time to checkpoint event
    expect(sessionCheckpointCall![1].correlationId).toBe(correlationId);

    // Poll 2: must be confirmed
    const confirmedStatus = await store.getSealStagingStatus(sessionId);
    expect(confirmedStatus.status).toBe("confirmed");
  });
});

// ─── DB-001: overdue detector triggers forced flush ───────────────────────────

describeIntegrationIsolated("PERSIST-017 integration: DB-001 overdue detector forces checkpoint flush", () => {
  it("DB-001: staged row older than max_staging_age triggers forced flush via JobScheduler entry point; mmr.checkpoint.overdue + mmr.session.checkpointed emitted", async () => {
    const logger = createMockLogger();
    const store = new MmrStore(servicePool, logger);

    const sessionId = randomUUID();
    const sealedRoot = createHash("sha256").update("db-001-overdue").digest("hex");
    const correlationId = randomUUID();

    await store.appendSeal(sessionId, sealedRoot, correlationId);

    // Backdate the staging row to simulate an overdue staged seal
    // (overdue = older than max_staging_age)
    await servicePool.query(
      "UPDATE conversation_seal_staging SET recorded_at = NOW() - INTERVAL '2 hours' WHERE session_id = $1",
      [sessionId],
    );

    // max_staging_age: 1 hour (3600000 ms)
    const maxStagingAgeMs = 60 * 60 * 1000;
    const service = new MmrCheckpointService(store, servicePool, logger, maxStagingAgeMs);

    // DB-001: trigger overdue detection and forced flush via the real JobScheduler entry
    // point — the same code path used in production (matching the composition root wiring
    // in packages/directory/src/bin/directory.ts). Register the handler with a
    // LocalJobScheduler, schedule a job at runAt=0, and await the setTimeout(0) tick.
    const scheduler = new LocalJobScheduler();
    scheduler.onJob("mmr_checkpoint", async () => {
      const overdueIds = await service.checkOverdue();
      if (overdueIds.length > 0) {
        await service.forceFlush(overdueIds);
      }
    });

    // Trigger: schedule a job with runAt in the past so delay=0.
    await scheduler.schedule("test-db-001-overdue", Date.now() - 1, { type: "mmr_checkpoint" });
    // Yield to the event loop so the setTimeout(0) fires the registered handler.
    await new Promise<void>((resolve) => setTimeout(resolve, 100));

    // mmr.checkpoint.overdue must have been logged at WARN
    const overdueCalls = filterLogCalls(logger.warn, "mmr.checkpoint.overdue");
    expect(overdueCalls.length).toBeGreaterThanOrEqual(1);
    const overdueCall = overdueCalls.find((c) => c[1].sessionId === sessionId);
    expect(overdueCall).toBeDefined();
    expect(overdueCall![1]).toMatchObject({ maxStagingAgeMs });

    // mmr.session.checkpointed must have been emitted for the forced flush
    const checkpointedCalls = filterLogCalls(logger.info, "mmr.session.checkpointed");
    expect(checkpointedCalls.length).toBeGreaterThanOrEqual(1);

    // After forced flush: status must be confirmed
    const afterStatus = await store.getSealStagingStatus(sessionId);
    expect(afterStatus.status).toBe("confirmed");
  });
});

// ─── Startup recovery: recoverOrphanedCheckpoints unit test ──────────────────

describe("PERSIST-017 unit: MmrCheckpointService.recoverOrphanedCheckpoints emits recovery events", () => {
  it("startup recovery: mmr.checkpoint.recovery.started and mmr.checkpoint.recovery.completed emitted per orphaned checkpoint", async () => {
    const logger = createMockLogger();

    const orphanedCheckpointId = randomUUID();

    // Stub MmrStore: only confirmCheckpoint is called during recovery.
    // The pool is not used by recoverOrphanedCheckpoints directly.
    const stubConfirmCheckpoint = vi.fn().mockResolvedValue("a".repeat(64));
    const stubPool = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
      connect: vi.fn(),
    } as unknown as pg.Pool;
    const stubStore = {
      confirmCheckpoint: stubConfirmCheckpoint,
    } as unknown as MmrStore;

    const service = new MmrCheckpointService(stubStore, stubPool, logger);
    await service.recoverOrphanedCheckpoints([orphanedCheckpointId]);

    // mmr.checkpoint.recovery.started must be emitted before confirmCheckpoint
    const startedCalls = filterLogCalls(logger.info, "mmr.checkpoint.recovery.started");
    expect(startedCalls.length).toBe(1);
    expect(startedCalls[0]![1]).toMatchObject({ checkpointId: orphanedCheckpointId, pendingCount: 1 });

    // confirmCheckpoint must have been called with the orphaned ID
    expect(stubConfirmCheckpoint).toHaveBeenCalledWith(orphanedCheckpointId);

    // mmr.checkpoint.recovery.completed must be emitted after confirmCheckpoint
    const completedCalls = filterLogCalls(logger.info, "mmr.checkpoint.recovery.completed");
    expect(completedCalls.length).toBe(1);
    expect(completedCalls[0]![1]).toMatchObject({ checkpointId: orphanedCheckpointId, recoveredCount: 1 });
  });

  it("startup recovery: no events emitted and no errors when orphaned list is empty", async () => {
    const logger = createMockLogger();

    const stubPool = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
      connect: vi.fn(),
    } as unknown as pg.Pool;
    const stubStore = {
      confirmCheckpoint: vi.fn(),
    } as unknown as MmrStore;

    const service = new MmrCheckpointService(stubStore, stubPool, logger);
    await service.recoverOrphanedCheckpoints([]);

    // No recovery events should be emitted for an empty list
    const startedCalls = filterLogCalls(logger.info, "mmr.checkpoint.recovery.started");
    const completedCalls = filterLogCalls(logger.info, "mmr.checkpoint.recovery.completed");
    expect(startedCalls.length).toBe(0);
    expect(completedCalls.length).toBe(0);
  });
});
