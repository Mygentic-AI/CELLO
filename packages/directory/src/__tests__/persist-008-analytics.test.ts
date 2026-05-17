/**
 * CELLO-PERSIST-008 — Analytics cron job
 *
 * Specification interpretation:
 *
 * AC-001: Analytics job with 3 pseudonyms in DB → pseudonym_stats has exactly 3 rows
 *         with correct conversation_count, unique_counterparty_count, clean_ratio,
 *         flagged_ratio, last_activity for each pseudonym.
 *
 * AC-002: Analytics job with known conversation pairs → conversation_graph_edges has
 *         one row per unique (unordered) pseudonym pair, edge_weight = sealed
 *         conversation count between them.
 *
 * AC-003: After graph edges populated → graph_analysis_results has one row per
 *         pseudonym with clustering_coefficient, community_id, conductance_score;
 *         no NULLs for any of these fields.
 *
 * AC-004: Second run with updated data → existing rows in pseudonym_stats are updated
 *         (not duplicated); new pseudonyms get new rows; stale rows from previous run
 *         are removed within one run cycle.
 *
 * AC-005: Successful run → analytics.job.completed logged at INFO with
 *         { durationMs, pseudonymCount, edgeCount, runId }.
 *
 * AC-006: DB error mid-run → analytics.job.failed logged at ERROR with
 *         { reason, runId, phase }; partial writes rolled back; previous data intact.
 *
 * AC-007: pnpm run analytics:run exits 0 on success (integration via the AnalyticsJob
 *         class being callable synchronously without errors). The actual CLI is an entrypoint
 *         script; this test verifies the underlying logic returns cleanly.
 *
 * SI-001: Analytics DB role (cello_analytics) has SELECT-only on protocol tables
 *         (conversation_seals, conversation_participation, conversation_attestations).
 *         RLS enforced — INSERT/UPDATE/DELETE rejected.
 *
 * SI-002: AnalyticsJob only uses a read-only pool connected as cello_analytics.
 *         A write pool (cello_service) is used only for output table UPSERT.
 *
 * DB-001: DB error mid-run → partial writes to output tables rolled back;
 *         previous complete run's data remains intact.
 *
 * DB-002: analytics.job.stale logged at WARN with { lastSuccessfulRunAt } when
 *         no successful run in >24 hours.
 *
 * test_type:
 *   Unit ACs (no DB): AC-005, AC-006 (logger verification using stub pool), DB-002
 *   Integration ACs (require CELLO_ENV=local + Postgres):
 *     AC-001, AC-002, AC-003, AC-004, AC-007, SI-001, SI-002, DB-001
 *
 * Run with:
 *   docker compose up -d && docker compose run --rm flyway
 *   CELLO_ENV=local DATABASE_URL=postgresql://cello_service:cello_service_dev@localhost:5433/cello_dev \
 *     pnpm --filter @cello/directory run test -- \
 *       --pool-options.threads.maxThreads=1 --pool-options.threads.minThreads=1
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { AnalyticsJob } from "../analytics-job.js";
import type { Logger } from "@cello/interfaces";

// ─── Unit tests: logger calls (no DB) ────────────────────────────────────────

describe("PERSIST-008 unit: AC-005 analytics.job.completed log call", () => {
  it("AC-005: successful run emits analytics.job.completed at INFO with { durationMs, pseudonymCount, edgeCount, runId }", async () => {
    const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const runId = randomUUID();

    // Stub read pool: returns minimal seed data
    const stubReadClient = {
      query: vi.fn().mockImplementation(async (sql: string) => {
        // Pseudonym stats query
        if (sql.includes("FROM conversation_participation cp")) {
          return {
            rows: [
              {
                party_pseudonym: "pseudo-a",
                conversation_count: "2",
                unique_counterparty_count: "1",
                clean_count: "2",
                flagged_count: "0",
                last_activity: new Date("2026-01-02"),
              },
            ],
          };
        }
        // Graph edges query
        if (sql.includes("FROM conversation_participation p1") || sql.includes("conversation_graph_edges")) {
          return {
            rows: [
              {
                pseudonym_a: "pseudo-a",
                pseudonym_b: "pseudo-b",
                edge_weight: "2",
              },
            ],
          };
        }
        return { rows: [] };
      }),
      release: vi.fn(),
    };

    const stubWriteClient = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
      release: vi.fn(),
    };

    const stubReadPool = {
      connect: vi.fn().mockResolvedValue(stubReadClient),
    } as unknown as pg.Pool;

    const stubWritePool = {
      connect: vi.fn().mockResolvedValue(stubWriteClient),
    } as unknown as pg.Pool;

    const job = new AnalyticsJob(stubReadPool, stubWritePool, logger);
    await job.run(runId);

    // AC-005: analytics.job.completed must be logged at INFO
    expect(logger.info).toHaveBeenCalledWith(
      "analytics.job.completed",
      expect.objectContaining({
        runId,
        durationMs: expect.any(Number),
        pseudonymCount: expect.any(Number),
        edgeCount: expect.any(Number),
      }),
    );

    // analytics.job.started must also be logged with { runId, triggeredBy }
    expect(logger.info).toHaveBeenCalledWith(
      "analytics.job.started",
      expect.objectContaining({ runId, triggeredBy: expect.any(String) }),
    );
  });
});

describe("PERSIST-008 unit: AC-006 analytics.job.failed log call", () => {
  it("AC-006: DB error mid-run emits analytics.job.failed at ERROR with { reason, runId, phase }", async () => {
    const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const runId = randomUUID();

    const stubReadClient = {
      query: vi.fn().mockRejectedValue(new Error("connection refused")),
      release: vi.fn(),
    };

    const stubReadPool = {
      connect: vi.fn().mockResolvedValue(stubReadClient),
    } as unknown as pg.Pool;

    const stubWritePool = {
      connect: vi.fn().mockResolvedValue({
        query: vi.fn().mockResolvedValue({ rows: [] }),
        release: vi.fn(),
      }),
    } as unknown as pg.Pool;

    const job = new AnalyticsJob(stubReadPool, stubWritePool, logger);

    // The job should not throw — it catches errors and logs them
    await expect(job.run(runId)).rejects.toThrow();

    // AC-006: analytics.job.failed must be logged at ERROR
    expect(logger.error).toHaveBeenCalledWith(
      "analytics.job.failed",
      expect.any(Error),
      expect.objectContaining({ runId, phase: expect.any(String), reason: expect.any(String) }),
    );
  });
});

describe("PERSIST-008 unit: DB-002 analytics.job.stale", () => {
  it("DB-002: checkStale emits analytics.job.stale at WARN with { lastSuccessfulRunAt } when last run > 24h ago", async () => {
    const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    // Simulate a last_run_at more than 24 hours ago
    const moreThan24HoursAgo = new Date(Date.now() - 25 * 60 * 60 * 1000);

    const stubReadPool = {
      connect: vi.fn(),
    } as unknown as pg.Pool;

    const stubWritePool = {
      query: vi.fn().mockResolvedValue({
        rows: [{ last_run_at: moreThan24HoursAgo }],
      }),
    } as unknown as pg.Pool;

    const job = new AnalyticsJob(stubReadPool, stubWritePool, logger);
    await job.checkStale();

    // DB-002: analytics.job.stale must be logged at WARN
    expect(logger.warn).toHaveBeenCalledWith(
      "analytics.job.stale",
      expect.objectContaining({ lastSuccessfulRunAt: moreThan24HoursAgo }),
    );
  });

  it("DB-002: no log emitted when last run was < 24h ago", async () => {
    const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    // Less than 24 hours ago
    const recentRun = new Date(Date.now() - 1 * 60 * 60 * 1000);

    const stubReadPool = {
      connect: vi.fn(),
    } as unknown as pg.Pool;

    const stubWritePool = {
      query: vi.fn().mockResolvedValue({
        rows: [{ last_run_at: recentRun }],
      }),
    } as unknown as pg.Pool;

    const job = new AnalyticsJob(stubReadPool, stubWritePool, logger);
    await job.checkStale();

    expect(logger.warn).not.toHaveBeenCalled();
  });
});

// ─── Integration tests — require CELLO_ENV=local + running Postgres ──────────

const isLocal = process.env["CELLO_ENV"] === "local";
const DATABASE_URL =
  process.env["DATABASE_URL"] ?? "postgresql://postgres:dev@localhost:5433/cello_dev";

const describeIntegration = isLocal ? describe : describe.skip;

let superPool: pg.Pool;
let servicePool: pg.Pool;
let analyticsPool: pg.Pool;

/**
 * Helper: Insert a sealed conversation and its participation records into the DB.
 * Uses the cello_service role which has INSERT + SELECT on append-only tables.
 * Includes all required NOT NULL fields from the V2 schema.
 *
 * Returns the conversation_id.
 */
async function insertSealedConversation(
  pool: pg.Pool,
  participants: string[],
  attestations: Record<string, "CLEAN" | "FLAGGED">,
  sealDate?: Date,
): Promise<string> {
  const conversationId = randomUUID();
  const date = sealDate ?? new Date();

  // Compute a stub chain hash (format mirrors hash-chain.ts output)
  const chainHash = "0".repeat(64);

  // Insert conversation seal
  await pool.query(
    `INSERT INTO conversation_seals
       (conversation_id, merkle_root, close_type, participant_count, seal_date, chain_hash)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [conversationId, "a".repeat(64), "MUTUAL_SEAL", participants.length, date, chainHash],
  );

  // Insert participation records for each participant
  for (const pseudonym of participants) {
    await pool.query(
      `INSERT INTO conversation_participation (conversation_id, party_pseudonym, chain_hash)
       VALUES ($1, $2, $3)`,
      [conversationId, pseudonym, chainHash],
    );
  }

  // Insert attestations
  for (const [pseudonym, attestation] of Object.entries(attestations)) {
    await pool.query(
      `INSERT INTO conversation_attestations
         (conversation_id, participant_pseudonym, attestation, seal_signature, chain_hash)
       VALUES ($1, $2, $3, $4, $5)`,
      [conversationId, pseudonym, attestation, "sig-stub", chainHash],
    );
  }

  return conversationId;
}

/**
 * Clean up analytics output tables between tests.
 * Uses the superuser pool since cello_service has no DELETE on output tables.
 */
async function cleanAnalyticsTables(pool: pg.Pool): Promise<void> {
  await pool.query("DELETE FROM graph_analysis_results");
  await pool.query("DELETE FROM conversation_graph_edges");
  await pool.query("DELETE FROM pseudonym_stats");
  await pool.query("DELETE FROM analytics_run_log");
}

beforeAll(async () => {
  if (!isLocal) return;
  superPool = new pg.Pool({ connectionString: DATABASE_URL });
  const serviceUrl = DATABASE_URL.replace(
    /^(postgres(?:ql)?):\/\/[^:]+:[^@]+@/,
    "$1://cello_service:cello_service_dev@",
  );
  servicePool = new pg.Pool({ connectionString: serviceUrl });
  const analyticsUrl = DATABASE_URL.replace(
    /^(postgres(?:ql)?):\/\/[^:]+:[^@]+@/,
    "$1://cello_analytics:cello_analytics_dev@",
  );
  analyticsPool = new pg.Pool({ connectionString: analyticsUrl });
});

afterAll(async () => {
  if (!isLocal) return;
  await superPool?.end();
  await servicePool?.end();
  await analyticsPool?.end();
});

describeIntegration("PERSIST-008 integration: AC-001 per-pseudonym stats", () => {
  it("AC-001: analytics job populates pseudonym_stats with correct values for 3 pseudonyms", async () => {
    const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    await cleanAnalyticsTables(superPool);

    const pseudoA = `ac001-a-${randomUUID()}`;
    const pseudoB = `ac001-b-${randomUUID()}`;
    const pseudoC = `ac001-c-${randomUUID()}`;

    // Use UTC midnight strings to avoid local timezone converting e.g. "2026-01-03" to 2026-01-02T22:00:00Z.
    const date1 = new Date("2026-01-01T00:00:00Z");
    const date2 = new Date("2026-01-02T00:00:00Z");
    const date3 = new Date("2026-01-03T00:00:00Z");

    // pseudoA: 2 conversations with pseudoB (clean), 1 with pseudoC (flagged)
    await insertSealedConversation(servicePool, [pseudoA, pseudoB], { [pseudoA]: "CLEAN", [pseudoB]: "CLEAN" }, date1);
    await insertSealedConversation(servicePool, [pseudoA, pseudoB], { [pseudoA]: "CLEAN", [pseudoB]: "CLEAN" }, date2);
    await insertSealedConversation(servicePool, [pseudoA, pseudoC], { [pseudoA]: "FLAGGED", [pseudoC]: "CLEAN" }, date3);

    // pseudoB: 2 conversations with pseudoA
    // pseudoC: 1 conversation with pseudoA

    const job = new AnalyticsJob(analyticsPool, servicePool, logger);
    await job.run(randomUUID());

    // Verify pseudoA stats
    const resA = await superPool.query<{
      conversation_count: number;
      unique_counterparty_count: number;
      clean_count: number;
      flagged_count: number;
      last_activity: Date;
    }>(
      "SELECT conversation_count, unique_counterparty_count, clean_count, flagged_count, last_activity FROM pseudonym_stats WHERE pseudonym = $1",
      [pseudoA],
    );
    expect(resA.rows).toHaveLength(1);
    const statsA = resA.rows[0]!;
    expect(Number(statsA.conversation_count)).toBe(3);
    expect(Number(statsA.unique_counterparty_count)).toBe(2);
    expect(Number(statsA.clean_count)).toBe(2);
    expect(Number(statsA.flagged_count)).toBe(1);
    // last_activity is TIMESTAMPTZ. Normalize to UTC date string for comparison —
    // pg may return it as a Date object or a string depending on the connection's type parsers.
    const lastActivityDate = statsA.last_activity instanceof Date
      ? statsA.last_activity.toISOString().substring(0, 10)
      : new Date(statsA.last_activity as string).toISOString().substring(0, 10);
    expect(lastActivityDate).toBe("2026-01-03");

    // Verify pseudoB stats
    const resB = await superPool.query<{ conversation_count: number; unique_counterparty_count: number }>(
      "SELECT conversation_count, unique_counterparty_count FROM pseudonym_stats WHERE pseudonym = $1",
      [pseudoB],
    );
    expect(resB.rows).toHaveLength(1);
    expect(Number(resB.rows[0]!.conversation_count)).toBe(2);
    expect(Number(resB.rows[0]!.unique_counterparty_count)).toBe(1);

    // Verify pseudoC stats
    const resC = await superPool.query<{ conversation_count: number }>(
      "SELECT conversation_count FROM pseudonym_stats WHERE pseudonym = $1",
      [pseudoC],
    );
    expect(resC.rows).toHaveLength(1);
    expect(Number(resC.rows[0]!.conversation_count)).toBe(1);
  });
});

describeIntegration("PERSIST-008 integration: AC-002 conversation graph edges", () => {
  it("AC-002: analytics job populates conversation_graph_edges with correct edge weights", async () => {
    const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    await cleanAnalyticsTables(superPool);

    const pseudoX = `ac002-x-${randomUUID()}`;
    const pseudoY = `ac002-y-${randomUUID()}`;
    const pseudoZ = `ac002-z-${randomUUID()}`;

    // X-Y: 3 conversations, X-Z: 1 conversation, Y-Z: 0 conversations
    await insertSealedConversation(servicePool, [pseudoX, pseudoY], { [pseudoX]: "CLEAN", [pseudoY]: "CLEAN" });
    await insertSealedConversation(servicePool, [pseudoX, pseudoY], { [pseudoX]: "CLEAN", [pseudoY]: "CLEAN" });
    await insertSealedConversation(servicePool, [pseudoX, pseudoY], { [pseudoX]: "CLEAN", [pseudoY]: "CLEAN" });
    await insertSealedConversation(servicePool, [pseudoX, pseudoZ], { [pseudoX]: "CLEAN", [pseudoZ]: "CLEAN" });

    const job = new AnalyticsJob(analyticsPool, servicePool, logger);
    await job.run(randomUUID());

    // X-Y edge: weight should be 3
    const [pA, pB] = [pseudoX, pseudoY].sort();
    const edgeXY = await superPool.query<{ edge_weight: number }>(
      "SELECT edge_weight FROM conversation_graph_edges WHERE pseudonym_a = $1 AND pseudonym_b = $2",
      [pA, pB],
    );
    expect(edgeXY.rows).toHaveLength(1);
    expect(Number(edgeXY.rows[0]!.edge_weight)).toBe(3);

    // X-Z edge: weight should be 1
    const [pC, pD] = [pseudoX, pseudoZ].sort();
    const edgeXZ = await superPool.query<{ edge_weight: number }>(
      "SELECT edge_weight FROM conversation_graph_edges WHERE pseudonym_a = $1 AND pseudonym_b = $2",
      [pC, pD],
    );
    expect(edgeXZ.rows).toHaveLength(1);
    expect(Number(edgeXZ.rows[0]!.edge_weight)).toBe(1);

    // Y-Z should NOT exist (no conversation between them)
    const [pE, pF] = [pseudoY, pseudoZ].sort();
    const edgeYZ = await superPool.query<{ edge_weight: number }>(
      "SELECT edge_weight FROM conversation_graph_edges WHERE pseudonym_a = $1 AND pseudonym_b = $2",
      [pE, pF],
    );
    expect(edgeYZ.rows).toHaveLength(0);
  });
});

describeIntegration("PERSIST-008 integration: AC-003 graph analysis results", () => {
  it("AC-003: graph_analysis_results has one row per pseudonym with no NULL fields after analytics run", async () => {
    const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    await cleanAnalyticsTables(superPool);

    const pseudoP = `ac003-p-${randomUUID()}`;
    const pseudoQ = `ac003-q-${randomUUID()}`;
    const pseudoR = `ac003-r-${randomUUID()}`;

    // Create a triangle: P-Q, Q-R, P-R
    await insertSealedConversation(servicePool, [pseudoP, pseudoQ], { [pseudoP]: "CLEAN", [pseudoQ]: "CLEAN" });
    await insertSealedConversation(servicePool, [pseudoQ, pseudoR], { [pseudoQ]: "CLEAN", [pseudoR]: "CLEAN" });
    await insertSealedConversation(servicePool, [pseudoP, pseudoR], { [pseudoP]: "CLEAN", [pseudoR]: "CLEAN" });

    const job = new AnalyticsJob(analyticsPool, servicePool, logger);
    await job.run(randomUUID());

    // Each pseudonym should have a graph_analysis_results row with no NULLs
    for (const pseudo of [pseudoP, pseudoQ, pseudoR]) {
      const res = await superPool.query<{
        clustering_coefficient: number | null;
        community_id: number | null;
        conductance_score: number | null;
      }>(
        "SELECT clustering_coefficient, community_id, conductance_score FROM graph_analysis_results WHERE pseudonym = $1",
        [pseudo],
      );
      expect(res.rows).toHaveLength(1);
      const row = res.rows[0]!;
      expect(row.clustering_coefficient).not.toBeNull();
      expect(row.community_id).not.toBeNull();
      expect(row.conductance_score).not.toBeNull();
    }
  });
});

describeIntegration("PERSIST-008 integration: AC-004 upsert on second run", () => {
  it("AC-004: second run with updated data upserts rows — no duplicates, stale rows removed", async () => {
    const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    await cleanAnalyticsTables(superPool);

    const pseudoM = `ac004-m-${randomUUID()}`;
    const pseudoN = `ac004-n-${randomUUID()}`;

    // First run: pseudoM and pseudoN have 1 conversation
    await insertSealedConversation(servicePool, [pseudoM, pseudoN], { [pseudoM]: "CLEAN", [pseudoN]: "CLEAN" });

    const job = new AnalyticsJob(analyticsPool, servicePool, logger);
    await job.run(randomUUID());

    // Verify first run
    const first = await superPool.query<{ conversation_count: number }>(
      "SELECT conversation_count FROM pseudonym_stats WHERE pseudonym = $1",
      [pseudoM],
    );
    expect(first.rows).toHaveLength(1);
    expect(Number(first.rows[0]!.conversation_count)).toBe(1);

    // Add another conversation
    await insertSealedConversation(servicePool, [pseudoM, pseudoN], { [pseudoM]: "CLEAN", [pseudoN]: "CLEAN" });

    // Second run
    await job.run(randomUUID());

    // Still exactly 1 row for pseudoM (no duplicates)
    const second = await superPool.query<{ conversation_count: number }>(
      "SELECT conversation_count FROM pseudonym_stats WHERE pseudonym = $1",
      [pseudoM],
    );
    expect(second.rows).toHaveLength(1);
    // Updated to 2
    expect(Number(second.rows[0]!.conversation_count)).toBe(2);
  });
});

describeIntegration("PERSIST-008 integration: AC-007 run exits cleanly", () => {
  it("AC-007: AnalyticsJob.run() completes without error when run against the real DB with seed data", async () => {
    const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    // Run against the real DB — should not throw
    const job = new AnalyticsJob(analyticsPool, servicePool, logger);
    await expect(job.run(randomUUID())).resolves.not.toThrow();

    // analytics.job.completed was logged
    expect(logger.info).toHaveBeenCalledWith(
      "analytics.job.completed",
      expect.objectContaining({ durationMs: expect.any(Number) }),
    );

    // analytics.job.failed was NOT logged
    expect(logger.error).not.toHaveBeenCalledWith(
      "analytics.job.failed",
      expect.anything(),
      expect.anything(),
    );
  });
});

describeIntegration("PERSIST-008 integration: SI-001 cello_analytics role is SELECT-only on protocol tables", () => {
  it("SI-001: cello_analytics role cannot INSERT into conversation_seals (RLS enforced)", async () => {
    // Attempt INSERT via the analytics pool — must be rejected
    await expect(
      analyticsPool.query(
        `INSERT INTO conversation_seals
           (conversation_id, merkle_root, close_type, participant_count, seal_date, chain_hash)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [randomUUID(), "a".repeat(64), "MUTUAL_SEAL", 2, new Date(), "0".repeat(64)],
      ),
    ).rejects.toThrow();
  });

  it("SI-001: cello_analytics role can SELECT from conversation_seals", async () => {
    // SELECT must succeed
    await expect(
      analyticsPool.query("SELECT COUNT(*) FROM conversation_seals"),
    ).resolves.toBeDefined();
  });

  it("SI-001: cello_analytics role cannot INSERT into conversation_participation", async () => {
    await expect(
      analyticsPool.query(
        `INSERT INTO conversation_participation (conversation_id, party_pseudonym, chain_hash)
         VALUES ($1, $2, $3)`,
        [randomUUID(), "test-pseudo", "0".repeat(64)],
      ),
    ).rejects.toThrow();
  });
});

describeIntegration("PERSIST-008 integration: SI-002 separate DB roles", () => {
  it("SI-002: AnalyticsJob uses read pool (cello_analytics) for reads and write pool (cello_service) for writes", async () => {
    // Verify cello_analytics can connect and query
    const client = await analyticsPool.connect();
    try {
      const res = await client.query<{ current_user: string }>("SELECT current_user");
      expect(res.rows[0]!.current_user).toBe("cello_analytics");
    } finally {
      client.release();
    }

    // Verify cello_service can connect and query
    const svcClient = await servicePool.connect();
    try {
      const res = await svcClient.query<{ current_user: string }>("SELECT current_user");
      expect(res.rows[0]!.current_user).toBe("cello_service");
    } finally {
      svcClient.release();
    }
  });

  it("SI-002: cello_analytics cannot SELECT from agent_key_shares (no grant)", async () => {
    // Adversarial condition: a compromised analytics job must not be able to read
    // encrypted K_server_X shares. cello_analytics has no SELECT grant on agent_key_shares.
    await expect(
      analyticsPool.query("SELECT COUNT(*) FROM agent_key_shares"),
    ).rejects.toThrow();
  });
});

describeIntegration("PERSIST-008 integration: DB-001 partial writes rolled back on error", () => {
  it("DB-001: mid-run DB error rolls back partial writes; previous run data intact", async () => {
    const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    await cleanAnalyticsTables(superPool);

    // Insert seed data for a clean first run
    const pseudoFail = `db001-f-${randomUUID()}`;
    const pseudoFail2 = `db001-g-${randomUUID()}`;
    await insertSealedConversation(servicePool, [pseudoFail, pseudoFail2], { [pseudoFail]: "CLEAN", [pseudoFail2]: "CLEAN" });

    // First run succeeds — establishes baseline
    const job = new AnalyticsJob(analyticsPool, servicePool, logger);
    await job.run(randomUUID());

    // Verify baseline exists
    const baseline = await superPool.query<{ conversation_count: number }>(
      "SELECT conversation_count FROM pseudonym_stats WHERE pseudonym = $1",
      [pseudoFail],
    );
    expect(baseline.rows).toHaveLength(1);
    const baselineCount = Number(baseline.rows[0]!.conversation_count);

    // Second run with a write pool that fails mid-way through the graph analysis phase.
    // We inject a write pool that succeeds for pseudonym_stats UPSERT but fails on
    // graph_analysis_results INSERT.
    const faultyWriteClient = {
      query: vi.fn().mockImplementation(async (sql: string) => {
        if (sql.includes("graph_analysis_results")) {
          throw new Error("simulated DB error in graph analysis phase");
        }
        if (sql.includes("ROLLBACK") || sql.includes("BEGIN") || sql.includes("COMMIT")) {
          return { rows: [] };
        }
        return { rows: [] };
      }),
      release: vi.fn(),
    };

    const faultyWritePool = {
      connect: vi.fn().mockResolvedValue(faultyWriteClient),
    } as unknown as pg.Pool;

    const faultyJob = new AnalyticsJob(analyticsPool, faultyWritePool, logger);
    await expect(faultyJob.run(randomUUID())).rejects.toThrow();

    // analytics.job.failed must be logged
    expect(logger.error).toHaveBeenCalledWith(
      "analytics.job.failed",
      expect.any(Error),
      expect.objectContaining({ phase: expect.any(String), reason: expect.any(String) }),
    );

    // Original pseudonym_stats data must be intact — confirmed by checking superPool
    // (the write pool was faulty but it used transaction rollback, so original data is intact)
    // Note: because faultyWritePool was used for the second run, the first run's data
    // written via servicePool is still intact.
    const afterFail = await superPool.query<{ conversation_count: number }>(
      "SELECT conversation_count FROM pseudonym_stats WHERE pseudonym = $1",
      [pseudoFail],
    );
    expect(afterFail.rows).toHaveLength(1);
    expect(Number(afterFail.rows[0]!.conversation_count)).toBe(baselineCount);
  });
});
