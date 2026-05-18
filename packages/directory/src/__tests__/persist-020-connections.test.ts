/**
 * CELLO-PERSIST-020 — connections migration, RLS, hash chain, and PgDirectoryStore round-trip
 *
 * Specification:
 *
 * AC-001: connections table exists after Flyway migrations with all required columns
 *   (connection_id TEXT UNIQUE, participant_a TEXT, participant_b TEXT,
 *   established_at BIGINT, status TEXT DEFAULT 'active', chain_hash BYTEA),
 *   relrowsecurity=true, exactly two RLS policies for cello_service (insert_only, select_all),
 *   no UPDATE or DELETE privilege, two composite indexes (participant_a,participant_b) and
 *   (participant_b,participant_a).
 *
 * AC-002: createConnection() persists a row; hasConnection(A,B) returns the record after write.
 *   A stub returning a canned row does NOT satisfy this AC — the INSERT and SELECT both
 *   execute against a live TCP connection.
 *
 * AC-003: hasConnection(B,A) (reversed) returns the same record as hasConnection(A,B) —
 *   symmetry is implemented via an OR query over both composite indexes, not via
 *   application-layer normalization. Verified by checking the returned record's
 *   participant_a/participant_b values are unchanged from insertion (not swapped).
 *
 * AC-004: After simulating a directory restart (new PgDirectoryStore instance with the same
 *   pool, no in-memory cache), hasConnection() returns the persisted record from the DB.
 *
 * AC-005: chain verification pass on two connection rows reports 0 chain breaks.
 *   Fresh verifier instance — no prior in-memory state.
 *
 * AC-006: cello_service UPDATE on connections raises a permission error. RLS enforcement —
 *   not application-layer guarding. Verified by issuing UPDATE directly via pg.query()
 *   as cello_service, bypassing PgDirectoryStore.
 *
 * AC-007: connection.persisted logged at INFO with { connectionId, participantA, participantB,
 *   correlationId } after a successful INSERT.
 *
 * AC-008: getConnection(unknownId) returns null — does not throw. Absence of a connection
 *   record is not an error. Fresh PgDirectoryStore instance (no cache).
 *
 * SI-001: A connection_id that does not correspond to a pending connection_requests row is
 *   rejected before any INSERT — the directory validates the connection_id against
 *   connection_requests before writing to connections. No row is inserted.
 *
 * SI-002: chain_hash is computed server-side; a caller-supplied chain_hash in the record
 *   is ignored and the server-computed value is stored instead.
 *
 * SI-003: Superuser tamper on an existing connection row detected by chain verification.
 *
 * DB-001 (degraded behavior): Postgres write failure logs connection.persist.failed at ERROR
 *   with { connectionId, reason } and retries; second failure logs with attempt: 2.
 *
 * DB-002: CELLO_ENV != local → all integration tests skip (not fail).
 *   CELLO_ENV=local + connection refused → tests fail.
 *
 * Pseudocode for createConnection():
 *   1. Call insertWithChain("connections", record, columns, values, chainHashIndex)
 *      — this acquires pg_advisory_xact_lock, fetches previous chain_hash, computes new one,
 *        inserts row with ON CONFLICT (connection_id) DO NOTHING
 *   2. On success: logger.info("connection.persisted", { connectionId, participantA, participantB, correlationId })
 *   3. On failure: logger.error("connection.persist.failed", { connectionId, reason, attempt })
 *      Retry once; on second failure log with attempt: 2
 *
 * Pseudocode for hasConnection(pubkeyA, pubkeyB):
 *   SELECT connection_id, participant_a, participant_b, established_at, status
 *   FROM connections
 *   WHERE (participant_a = $1 AND participant_b = $2)
 *      OR (participant_a = $2 AND participant_b = $1)
 *   LIMIT 1
 *   → Return first row as ConnectionRecord, or null if none.
 *
 * Pseudocode for getConnection(connectionId):
 *   SELECT connection_id, participant_a, participant_b, established_at, status
 *   FROM connections WHERE connection_id = $1
 *   → Return row as ConnectionRecord, or null if not found.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import pg from "pg";
import { randomUUID, randomBytes } from "node:crypto";
import { PgDirectoryStore } from "../adapters/pg-directory-store.js";
import { computeChainHash, serializeRecord, CHAIN_GENESIS } from "../hash-chain.js";
import type { Logger } from "@cello/interfaces";

// ─── Test environment setup ───────────────────────────────────────────────────

const isLocal = process.env["CELLO_ENV"] === "local";
const DATABASE_URL =
  process.env["DATABASE_URL"] ?? "postgresql://postgres:dev@localhost:5433/cello_dev";

// Service-role connection string (INSERT/SELECT/DELETE only — matches RLS policies)
const SERVICE_URL = DATABASE_URL.replace(
  /^(postgres(?:ql)?):\/\/[^:]+:[^@]+@/,
  "$1://cello_service:cello_service_dev@",
);

/**
 * Build a no-op logger for tests that don't care about log output.
 */
function makeLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

// ─── Integration test pool setup ─────────────────────────────────────────────

let superPool: pg.Pool;
let servicePool: pg.Pool;

beforeAll(async () => {
  if (!isLocal) return;
  superPool = new pg.Pool({ connectionString: DATABASE_URL });
  servicePool = new pg.Pool({ connectionString: SERVICE_URL });
});

afterAll(async () => {
  if (!isLocal) return;
  await superPool?.end();
  await servicePool?.end();
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Delete all rows for the given connection_ids from connections (superuser).
 * Used for test cleanup without relying on transaction rollback (which would
 * complicate tests that need to verify row persistence across PgDirectoryStore restarts).
 */
async function cleanupConnections(connectionIds: string[]): Promise<void> {
  if (connectionIds.length === 0) return;
  const placeholders = connectionIds.map((_, i) => `$${i + 1}`).join(", ");
  await superPool.query(
    `DELETE FROM connections WHERE connection_id IN (${placeholders})`,
    connectionIds,
  );
}

/**
 * Insert a matching connection_requests row so SI-001 validation passes.
 *
 * The SI-001 check in createConnection() does:
 *   SELECT COUNT(*) FROM connection_requests WHERE request_id = $1 AND outcome = 'ACCEPTED'
 * where $1 = correlationId (the 5th argument to createConnection).
 *
 * Callers must therefore pass the same `connectionId` used here as the `correlationId`
 * argument to createConnection() so the lookup finds this row.
 */
async function insertMatchingConnectionRequest(connectionId: string): Promise<void> {
  // connection_requests has request_id UUID UNIQUE, so we use the connectionId as request_id.
  // requester_pseudonym and target_pseudonym are required TEXT fields.
  // outcome must be one of 'ACCEPTED', 'REJECTED', 'EXPIRED', 'PENDING_ESCALATION'.
  await superPool.query(
    `INSERT INTO connection_requests (request_id, requester_pseudonym, target_pseudonym, outcome, chain_hash)
     VALUES ($1::uuid, $2, $3, 'ACCEPTED', $4)
     ON CONFLICT (request_id) DO NOTHING`,
    [
      connectionId,
      `req_${connectionId.slice(0, 8)}`,
      `tgt_${connectionId.slice(0, 8)}`,
      CHAIN_GENESIS, // minimal valid chain_hash — not verified by SI-001 in this test helper
    ],
  );
}

const describeIntegration = isLocal ? describe : describe.skip;

// ─── Integration tests — require CELLO_ENV=local + running Postgres ───────────

describeIntegration(
  isLocal
    ? "PERSIST-020 integration: connections table, RLS, hash chain"
    : "PERSIST-020 integration: connections (SKIPPED: CELLO_ENV != local)",
  () => {
    // ── AC-001: Schema and RLS ─────────────────────────────────────────────────

    it("AC-001: connections table exists with all required columns, RLS, 2 policies, indexes, no UPDATE/DELETE privilege", async () => {
      /*
       * AC-001: open a live TCP connection via the real pg package; if CELLO_ENV=local
       * and pg.connect() fails, the test FAILS (not skips).
       *
       * Verification checklist:
       *   - table exists in information_schema.tables
       *   - relrowsecurity = true (pg_catalog.pg_class)
       *   - exactly 2 policies: insert_only, select_all (pg_catalog.pg_policy after SET ROLE)
       *   - cello_service has no UPDATE or DELETE privilege (information_schema.role_table_grants)
       *   - composite indexes on (participant_a, participant_b) and (participant_b, participant_a)
       *   - required columns: connection_id TEXT, participant_a TEXT, participant_b TEXT,
       *       established_at BIGINT, status TEXT, chain_hash (TEXT or BYTEA)
       */
      let client: pg.PoolClient;
      try {
        client = await superPool.connect();
      } catch (err: unknown) {
        const reason = err instanceof Error ? err.message : String(err);
        throw new Error(
          `[PERSIST-020 AC-001] CELLO_ENV=local but pg.connect() failed — is Docker Compose running? (${reason})`,
        );
      }

      try {
        // 1. Table exists
        const tableResult = await client.query<{ table_name: string }>(
          `SELECT table_name FROM information_schema.tables
           WHERE table_schema = 'public' AND table_name = 'connections'`,
        );
        expect(tableResult.rows).toHaveLength(1);

        // 2. RLS enabled
        const rlsResult = await client.query<{ relrowsecurity: boolean }>(
          `SELECT relrowsecurity FROM pg_catalog.pg_class WHERE relname = 'connections'`,
        );
        expect(rlsResult.rows[0]?.relrowsecurity).toBe(true);

        // 3. Required columns exist
        const colResult = await client.query<{ column_name: string; data_type: string; column_default: string | null }>(
          `SELECT column_name, data_type, column_default
           FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'connections'
           ORDER BY ordinal_position`,
        );
        const colNames = colResult.rows.map((r) => r.column_name);
        expect(colNames).toContain("connection_id");
        expect(colNames).toContain("participant_a");
        expect(colNames).toContain("participant_b");
        expect(colNames).toContain("established_at");
        expect(colNames).toContain("status");
        expect(colNames).toContain("chain_hash");

        // established_at must be BIGINT
        const estAtRow = colResult.rows.find((r) => r.column_name === "established_at");
        expect(estAtRow?.data_type).toBe("bigint");

        // status must have a default of 'active'
        const statusRow = colResult.rows.find((r) => r.column_name === "status");
        expect(statusRow?.column_default).toMatch(/active/);

        // 4. Policies: exactly 2 for cello_service after SET ROLE
        await client.query("SET ROLE cello_service");
        const policyResult = await client.query<{ policyname: string }>(
          `SELECT policyname FROM pg_catalog.pg_policies
           WHERE tablename = 'connections'
           ORDER BY policyname`,
        );
        await client.query("RESET ROLE");
        const policyNames = policyResult.rows.map((r) => r.policyname);
        expect(policyNames).toHaveLength(2);
        expect(policyNames).toContain("insert_only");
        expect(policyNames).toContain("select_all");

        // 5. cello_service has no UPDATE or DELETE privilege
        const grantsResult = await client.query<{ privilege_type: string }>(
          `SELECT privilege_type FROM information_schema.role_table_grants
           WHERE grantee = 'cello_service' AND table_name = 'connections'`,
        );
        const grantTypes = grantsResult.rows.map((r) => r.privilege_type);
        expect(grantTypes).not.toContain("UPDATE");
        expect(grantTypes).not.toContain("DELETE");

        // 6. Composite indexes
        const indexResult = await client.query<{ indexname: string; indexdef: string }>(
          `SELECT indexname, indexdef FROM pg_indexes
           WHERE tablename = 'connections'
           ORDER BY indexname`,
        );
        const indexDefs = indexResult.rows.map((r) => r.indexdef);

        // Must have index on (participant_a, participant_b)
        const hasFwdIndex = indexDefs.some(
          (def) => /participant_a.*participant_b/i.test(def),
        );
        // Must have index on (participant_b, participant_a)
        const hasBwdIndex = indexDefs.some(
          (def) => /participant_b.*participant_a/i.test(def),
        );
        expect(hasFwdIndex).toBe(true);
        expect(hasBwdIndex).toBe(true);
      } finally {
        client.release();
      }
    });

    // ── AC-002: Write + read round-trip ────────────────────────────────────────

    it("AC-002: createConnection() persists a row; hasConnection() returns the record after write", async () => {
      /*
       * AC-002: real Postgres INSERT + SELECT via PgDirectoryStore (service role).
       * A stub returning a canned row does NOT satisfy this AC.
       *
       * Verification:
       *   - hasConnection(A,B) returns null before write
       *   - createConnection() is called
       *   - hasConnection(A,B) returns the persisted record with matching fields
       *   - the record contains connection_id, participant_a, participant_b, established_at, status
       */
      const connectionId = randomUUID();
      const participantA = randomBytes(32).toString("hex");
      const participantB = randomBytes(32).toString("hex");
      const establishedAt = Date.now();
      const logger = makeLogger();
      const store = new PgDirectoryStore(servicePool, logger);

      // Insert a connection_requests row so SI-001 validation passes
      await insertMatchingConnectionRequest(connectionId);

      // Pre-condition: no connection yet
      const priorResult = await store.hasConnection(participantA, participantB);
      expect(priorResult).toBeNull();

      // Write — correlationId = connectionId so it matches request_id in connection_requests (SI-001)
      await store.createConnection(connectionId, participantA, participantB, establishedAt, connectionId);

      // Read back — hasConnection must return real data from the database
      const result = await store.hasConnection(participantA, participantB);
      expect(result).not.toBeNull();
      expect(result?.connection_id).toBe(connectionId);

      // AC-002 requires all 5 fields: connection_id, participant_a, participant_b, established_at, status
      const fullRecord = await store.getConnection(connectionId);
      expect(fullRecord).not.toBeNull();
      expect(fullRecord?.connection_id).toBe(connectionId);
      expect(fullRecord?.participant_a).toBe(participantA);
      expect(fullRecord?.participant_b).toBe(participantB);
      expect(fullRecord?.established_at).toBe(establishedAt);
      expect(fullRecord?.status).toBe("active");

      // Clean up
      await cleanupConnections([connectionId]);
      await superPool.query("DELETE FROM connection_requests WHERE request_id = $1::uuid", [connectionId]);
    });

    // ── AC-003: Symmetric lookup ───────────────────────────────────────────────

    it("AC-003: hasConnection(B,A) returns the same record as hasConnection(A,B) — symmetry via OR query, not normalization", async () => {
      /*
       * AC-003: the OR query uses both composite indexes.
       * Verified by:
       *   1. Writing a connection with participant_a=A, participant_b=B
       *   2. Calling hasConnection(B,A) (reversed order)
       *   3. Asserting the returned record has participant_a=A and participant_b=B (unchanged —
       *      not swapped/normalized by the application layer)
       */
      const connectionId = randomUUID();
      const participantA = randomBytes(32).toString("hex");
      const participantB = randomBytes(32).toString("hex");
      const establishedAt = Date.now();
      const logger = makeLogger();
      const store = new PgDirectoryStore(servicePool, logger);

      await insertMatchingConnectionRequest(connectionId);
      await store.createConnection(connectionId, participantA, participantB, establishedAt, connectionId);

      // Forward lookup
      const fwdResult = await store.hasConnection(participantA, participantB);
      expect(fwdResult).not.toBeNull();
      expect(fwdResult?.connection_id).toBe(connectionId);

      // Reverse lookup — same connection_id returned
      const revResult = await store.hasConnection(participantB, participantA);
      expect(revResult).not.toBeNull();
      expect(revResult?.connection_id).toBe(connectionId);

      // Verify participant fields are UNCHANGED from insertion (not swapped/normalized)
      // by calling getConnection with the found connection_id
      const fullRecord = await store.getConnection(connectionId);
      expect(fullRecord).not.toBeNull();
      expect(fullRecord?.participant_a).toBe(participantA);
      expect(fullRecord?.participant_b).toBe(participantB);

      // Clean up
      await cleanupConnections([connectionId]);
      await superPool.query("DELETE FROM connection_requests WHERE request_id = $1::uuid", [connectionId]);
    });

    // ── AC-004: Restart survival ───────────────────────────────────────────────

    it("AC-004: hasConnection() returns persisted record after directory restart simulation (fresh PgDirectoryStore instance)", async () => {
      /*
       * AC-004: simulate restart by instantiating a new PgDirectoryStore with the
       * same database pool. A fresh instance has NO in-memory state — any result
       * from hasConnection() must come from a live SELECT against the database.
       *
       * The test asserts the connection_id matches the pre-restart record.
       */
      const connectionId = randomUUID();
      const participantA = randomBytes(32).toString("hex");
      const participantB = randomBytes(32).toString("hex");
      const establishedAt = Date.now();

      // Write using instance #1
      const logger1 = makeLogger();
      const store1 = new PgDirectoryStore(servicePool, logger1);
      await insertMatchingConnectionRequest(connectionId);
      await store1.createConnection(connectionId, participantA, participantB, establishedAt, connectionId);

      // Simulate restart: new instance, same pool (no in-memory state)
      const logger2 = makeLogger();
      const store2 = new PgDirectoryStore(servicePool, logger2);

      const result = await store2.hasConnection(participantA, participantB);
      expect(result).not.toBeNull();
      expect(result?.connection_id).toBe(connectionId);

      // Clean up
      await cleanupConnections([connectionId]);
      await superPool.query("DELETE FROM connection_requests WHERE request_id = $1::uuid", [connectionId]);
    });

    // ── AC-005: Hash chain verification ───────────────────────────────────────

    it("AC-005: chain verification on two connection rows reports 0 chain breaks", async () => {
      /*
       * AC-005: insert two connections via createConnection() (which uses insertWithChain),
       * then run verifyChain("connections") with a fresh PgDirectoryStore instance.
       * The fresh SELECT is itself the evidence — no prior state.
       *
       * Stale rows from other tests would cause chain recomputation to fail because
       * the previous hash depends on insertion order. Clean slate before inserting.
       */
      // Finding 4 fix: delete stale rows so chain verification starts from genesis.
      await superPool.query("DELETE FROM connections");

      const id1 = randomUUID();
      const id2 = randomUUID();
      const aKey = randomBytes(32).toString("hex");
      const bKey = randomBytes(32).toString("hex");
      const cKey = randomBytes(32).toString("hex");
      const dKey = randomBytes(32).toString("hex");
      const now = Date.now();

      const logger = makeLogger();
      const store = new PgDirectoryStore(servicePool, logger);

      await insertMatchingConnectionRequest(id1);
      await insertMatchingConnectionRequest(id2);
      // correlationId = id1 / id2 so it matches request_id in connection_requests (SI-001)
      await store.createConnection(id1, aKey, bKey, now, id1);
      await store.createConnection(id2, cKey, dKey, now + 1, id2);

      // Fresh verifier instance
      const verifyLogger = makeLogger();
      const verifyStore = new PgDirectoryStore(servicePool, verifyLogger);
      const result = await verifyStore.verifyChain("connections");
      expect(result.valid).toBe(true);

      // Clean up
      await cleanupConnections([id1, id2]);
      await superPool.query(
        "DELETE FROM connection_requests WHERE request_id IN ($1::uuid, $2::uuid)",
        [id1, id2],
      );
    });

    // ── AC-006: RLS blocks UPDATE ─────────────────────────────────────────────

    it("AC-006: cello_service UPDATE on connections is rejected by RLS — not application-layer guarding", async () => {
      /*
       * AC-006: issue UPDATE directly via pg.query() as cello_service, bypassing
       * application code. PostgreSQL must reject it.
       *
       * The rejection is either:
       *   'ERROR: permission denied for table connections' (no UPDATE grant)
       *   'ERROR: new row violates row-level security policy for table connections'
       *     (grant exists but no permissive UPDATE policy)
       * Either is acceptable — both originate from the database, not application code.
       *
       * Test asserts: operation fails AND row count is unchanged after the attempt.
       */
      const connectionId = randomUUID();
      const participantA = randomBytes(32).toString("hex");
      const participantB = randomBytes(32).toString("hex");
      const logger = makeLogger();
      const store = new PgDirectoryStore(servicePool, logger);

      await insertMatchingConnectionRequest(connectionId);
      await store.createConnection(connectionId, participantA, participantB, Date.now(), connectionId);

      // Direct UPDATE via service role — must fail
      let updateErrorMessage = "";
      try {
        await servicePool.query(
          `UPDATE connections SET status = 'revoked' WHERE connection_id = $1`,
          [connectionId],
        );
      } catch (err: unknown) {
        updateErrorMessage = err instanceof Error ? err.message : String(err);
      }

      // Verify rejection
      expect(updateErrorMessage).toMatch(/permission denied|row-level security policy/i);

      // Verify row is unchanged
      const rowResult = await superPool.query<{ status: string }>(
        `SELECT status FROM connections WHERE connection_id = $1`,
        [connectionId],
      );
      expect(rowResult.rows[0]?.status).toBe("active");

      // Clean up
      await cleanupConnections([connectionId]);
      await superPool.query("DELETE FROM connection_requests WHERE request_id = $1::uuid", [connectionId]);
    });

    // ── AC-007: Observability — connection.persisted logged ───────────────────

    it("AC-007: connection.persisted logged at INFO with { connectionId, participantA, participantB, correlationId }", async () => {
      /*
       * AC-007: after a successful INSERT, the logger must receive an info call
       * with event name 'connection.persisted' and all required context fields.
       */
      const connectionId = randomUUID();
      const participantA = randomBytes(32).toString("hex");
      const participantB = randomBytes(32).toString("hex");
      // correlationId = connectionId because insertMatchingConnectionRequest inserts request_id = connectionId.
      // SI-001 lookup checks request_id = correlationId, so they must match.
      const correlationId = connectionId;
      const logger = makeLogger();
      const store = new PgDirectoryStore(servicePool, logger);

      await insertMatchingConnectionRequest(connectionId);
      await store.createConnection(connectionId, participantA, participantB, Date.now(), correlationId);

      // connection.persisted must have been logged at INFO
      expect(logger.info).toHaveBeenCalledWith(
        "connection.persisted",
        expect.objectContaining({
          connectionId,
          participantA,
          participantB,
          correlationId,
        }),
      );

      // Clean up
      await cleanupConnections([connectionId]);
      await superPool.query("DELETE FROM connection_requests WHERE request_id = $1::uuid", [connectionId]);
    });

    // ── AC-008: getConnection with unknown ID returns null ────────────────────

    it("AC-008: getConnection(unknownId) returns null — does not throw; absence is not an error", async () => {
      /*
       * AC-008: fresh PgDirectoryStore instance (no cache); querying for an ID
       * that does not exist must return null without throwing.
       */
      const logger = makeLogger();
      const store = new PgDirectoryStore(servicePool, logger);

      const unknownId = randomUUID();
      const result = await store.getConnection(unknownId);
      expect(result).toBeNull();

      // No error event must have been logged
      expect(logger.error).not.toHaveBeenCalled();
    });

    // ── AC-008 extended: getConnection with known ID returns the record ────────

    it("AC-008 (extended): getConnection(knownId) returns the connection record", async () => {
      const connectionId = randomUUID();
      const participantA = randomBytes(32).toString("hex");
      const participantB = randomBytes(32).toString("hex");
      const establishedAt = Date.now();
      const logger = makeLogger();
      const store = new PgDirectoryStore(servicePool, logger);

      await insertMatchingConnectionRequest(connectionId);
      await store.createConnection(connectionId, participantA, participantB, establishedAt, connectionId);

      const result = await store.getConnection(connectionId);
      expect(result).not.toBeNull();
      expect(result?.connection_id).toBe(connectionId);
      expect(result?.participant_a).toBe(participantA);
      expect(result?.participant_b).toBe(participantB);
      expect(result?.status).toBe("active");

      // Clean up
      await cleanupConnections([connectionId]);
      await superPool.query("DELETE FROM connection_requests WHERE request_id = $1::uuid", [connectionId]);
    });

    // ── SI-001: connection_id must match a pending connection_requests row ─────

    it("SI-001: createConnection() with a connection_id not in connection_requests is rejected — no row inserted", async () => {
      /*
       * SI-001: directory validates connection_id against connection_requests before
       * writing to connections. If no matching pending request is found, the write
       * is rejected and no row is inserted into connections.
       *
       * Adversarial condition: an API caller submits a connection_id that was not
       * issued by the directory.
       *
       * Verification: row count in connections remains 0 for this connection_id
       * after the rejected call.
       */
      const arbitraryId = randomUUID(); // never inserted into connection_requests
      const participantA = randomBytes(32).toString("hex");
      const participantB = randomBytes(32).toString("hex");
      const logger = makeLogger();
      const store = new PgDirectoryStore(servicePool, logger);

      // This must reject without inserting.
      // An adversarial caller passes arbitraryId as both connectionId and correlationId;
      // neither exists in connection_requests so SI-001 rejects both.
      let caughtError: Error | undefined;
      try {
        await store.createConnection(arbitraryId, participantA, participantB, Date.now(), arbitraryId);
      } catch (err) {
        caughtError = err as Error;
      }

      // Must have thrown (or otherwise indicated failure)
      expect(caughtError).toBeDefined();

      // Verify no row was inserted
      const rowResult = await superPool.query<{ count: string }>(
        `SELECT COUNT(*) as count FROM connections WHERE connection_id = $1`,
        [arbitraryId],
      );
      expect(rowResult.rows[0]?.count).toBe("0");
    });

    // ── SI-001 (negative): rejected connection request must not produce a connection ──

    it("SI-001 (negative): createConnection() rejects a connection_id whose connection_request has outcome != ACCEPTED", async () => {
      /*
       * SI-001 extended: even if a connection_requests row exists, the outcome must be
       * 'ACCEPTED'. A rejected or pending request must not allow a connection record to be created.
       */
      const rejectedId = randomUUID();
      const participantA = randomBytes(32).toString("hex");
      const participantB = randomBytes(32).toString("hex");
      const logger = makeLogger();
      const store = new PgDirectoryStore(servicePool, logger);

      // Insert a connection_requests row with outcome = 'REJECTED' (not 'ACCEPTED')
      await superPool.query(
        `INSERT INTO connection_requests (request_id, requester_pseudonym, target_pseudonym, outcome, chain_hash)
         VALUES ($1::uuid, $2, $3, 'REJECTED', $4)
         ON CONFLICT (request_id) DO NOTHING`,
        [
          rejectedId,
          `req_${rejectedId.slice(0, 8)}`,
          `tgt_${rejectedId.slice(0, 8)}`,
          CHAIN_GENESIS,
        ],
      );

      // This must reject — outcome is not ACCEPTED.
      // correlationId = rejectedId so SI-001 finds the row and checks its outcome.
      let caughtError: Error | undefined;
      try {
        await store.createConnection(rejectedId, participantA, participantB, Date.now(), rejectedId);
      } catch (err) {
        caughtError = err as Error;
      }

      expect(caughtError).toBeDefined();
      expect(caughtError?.message).toMatch(/SI-001/);

      // Verify no row was inserted
      const rowResult = await superPool.query<{ count: string }>(
        `SELECT COUNT(*) as count FROM connections WHERE connection_id = $1`,
        [rejectedId],
      );
      expect(rowResult.rows[0]?.count).toBe("0");

      // Clean up
      await superPool.query("DELETE FROM connection_requests WHERE request_id = $1::uuid", [rejectedId]);
    });

    // ── SI-002: chain_hash computed server-side ────────────────────────────────

    it("SI-002: chain_hash is computed server-side — a caller-supplied chain_hash is ignored and overwritten", async () => {
      /*
       * SI-002: even if a caller includes a forged chain_hash in the record,
       * the server recomputes it from the previous row and genesis. The stored
       * value is the server-computed value, not the caller-supplied one.
       *
       * Since the DirectoryStore interface does not expose chain_hash as a parameter,
       * this test verifies by:
       *   1. Inserting a connection via createConnection()
       *   2. Reading back the chain_hash from the database
       *   3. Independently computing the expected chain_hash from the record
       *      using computeChainHash(serializeRecord(record), CHAIN_GENESIS) (first row)
       *   4. Asserting equality — the stored value matches the server-computed value
       */
      const connectionId = randomUUID();
      const participantA = randomBytes(32).toString("hex");
      const participantB = randomBytes(32).toString("hex");
      const establishedAt = Date.now();

      await insertMatchingConnectionRequest(connectionId);

      const logger = makeLogger();
      const store = new PgDirectoryStore(servicePool, logger);

      // Truncate connections to ensure clean chain (genesis start)
      await superPool.query("DELETE FROM connections");

      // correlationId = connectionId so SI-001 lookup finds the matching row in connection_requests
      await store.createConnection(connectionId, participantA, participantB, establishedAt, connectionId);

      // Read back the stored chain_hash
      const row = await superPool.query<{ chain_hash: string; connection_id: string; participant_a: string; participant_b: string; established_at: string; status: string }>(
        `SELECT chain_hash, connection_id, participant_a, participant_b, established_at, status
         FROM connections WHERE connection_id = $1`,
        [connectionId],
      );
      expect(row.rows).toHaveLength(1);
      const storedHash = row.rows[0]!.chain_hash;

      // Independently compute what the server should have computed for the first row
      // (CHAIN_GENESIS → because we truncated connections above before this insert)
      const record: Record<string, unknown> = {
        connection_id: connectionId,
        participant_a: participantA,
        participant_b: participantB,
        established_at: establishedAt,
        status: "active",
      };
      const expectedHash = computeChainHash(serializeRecord(record, "connections"), CHAIN_GENESIS);
      expect(storedHash).toBe(expectedHash);

      // Clean up
      await cleanupConnections([connectionId]);
      await superPool.query("DELETE FROM connection_requests WHERE request_id = $1::uuid", [connectionId]);
    });

    // ── SI-003: Superuser tamper detected ─────────────────────────────────────

    it("SI-003: superuser UPDATE on a connection row is detected by chain verification", async () => {
      /*
       * SI-003: any modification of a persisted connection record causes the chain
       * verification pass to fail at the modified row and fire db.chain.break.detected.
       *
       * Adversarial condition: database superuser modifies participant_a directly.
       */
      const connectionId = randomUUID();
      const participantA = randomBytes(32).toString("hex");
      const participantB = randomBytes(32).toString("hex");

      await insertMatchingConnectionRequest(connectionId);

      const logger = makeLogger();
      const store = new PgDirectoryStore(servicePool, logger);
      // correlationId = connectionId so SI-001 lookup finds the matching row in connection_requests
      await store.createConnection(connectionId, participantA, participantB, Date.now(), connectionId);

      // Superuser tampers with participant_a
      await superPool.query(
        `UPDATE connections SET participant_a = 'TAMPERED_BY_SUPERUSER' WHERE connection_id = $1`,
        [connectionId],
      );

      // Chain verification must detect the break
      const verifyLogger = makeLogger();
      const verifyStore = new PgDirectoryStore(servicePool, verifyLogger);
      const result = await verifyStore.verifyChain("connections");
      expect(result.valid).toBe(false);
      expect(result.breakAtSequence).toBeDefined();

      // db.chain.break.detected must have been logged
      expect(verifyLogger.error).toHaveBeenCalledWith(
        "db.chain.break.detected",
        expect.objectContaining({ tableName: "connections" }),
      );

      // Clean up
      await cleanupConnections([connectionId]);
      await superPool.query("DELETE FROM connection_requests WHERE request_id = $1::uuid", [connectionId]);
    });
  },
);
