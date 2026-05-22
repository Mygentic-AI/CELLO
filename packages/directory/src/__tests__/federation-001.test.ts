/**
 * CELLO-FEDERATION-001 — Federation schema migration and session ownership enforcement
 *
 * Specification (each AC stated before its test):
 *
 * AC-001: sessions table exists with correct columns and NOT NULL constraints.
 *   V18 migration creates sessions with session_id UUID NOT NULL UNIQUE, owning_node_id TEXT NOT NULL,
 *   created_at TIMESTAMPTZ NOT NULL. Verified via information_schema.columns.
 *
 * AC-002: directory_checkpoints has all V5 + V9 columns; checkpoint_node_signatures has full schema.
 *   V18 adds mmr_peaks JSONB, identity_merkle_root TEXT, checkpoint_hash TEXT, coordinator_node_id TEXT
 *   to directory_checkpoints. Adds checkpoint_id UUID, node_id TEXT, node_signature TEXT, signed_at
 *   TIMESTAMPTZ to checkpoint_node_signatures.
 *
 * AC-008-idempotency: running V18 migration twice produces no new flyway_schema_history rows.
 *   Every CREATE uses IF NOT EXISTS; every ALTER TABLE ADD COLUMN uses the DO $$ BEGIN IF NOT EXISTS
 *   (...) THEN ... END IF; END $$ pattern. Safe to run on a database that already has the V18 schema.
 *
 * AC-009-sessions-round-trip: write via writeSession, read back via fresh PgDirectoryStore instance.
 *   sessions is in STORE_TABLES, sessions.id is in BIGINT_COLUMNS. The fresh instance has no cache,
 *   so the returned value comes from a live SELECT.
 *
 * AC-011-configure-pg-types-startup: PgDirectoryStore.verifyPgTypes() emits db.type-parsers.verified
 *   at INFO with { nodeId, region } when type parsers are correctly configured.
 *
 * AC-012-table-extra-excluded: verifyChain('sessions') returns { valid: true } after writeSession.
 *   No nullable columns in sessions that would cause chain verification to fail.
 *
 * SI-001: non-owning node write rejected with ownership violation error.
 *   Adversarial condition: a non-owning node calls writeSession for a session already owned by
 *   another node. The owning_node_id in the existing sessions row differs from the caller's node_id.
 *   The write must be rejected by the unique constraint (same session_id cannot be inserted twice).
 *   Application-layer check in checkSessionOwnership() must throw before any INSERT.
 *
 * federation.replication.verified and federation.replication.chain_hash_mismatch events:
 *   verifyReplicatedRow logs the correct event with all required context fields.
 *
 * All tests require CELLO_ENV=local and a running Docker Compose Postgres with V18 migration applied.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { PgDirectoryStore, BIGINT_COLUMNS, STORE_TABLES } from "../adapters/pg-directory-store.js";
import { configurePgTypes } from "../pg-type-config.js";
import type { Logger } from "@cello/interfaces";

// ─── Environment setup ────────────────────────────────────────────────────────

const isLocal = process.env["CELLO_ENV"] === "local";
const DATABASE_URL =
  process.env["DATABASE_URL"] ?? "postgresql://postgres:dev@localhost:5433/cello_dev";

const SERVICE_URL = DATABASE_URL.replace(
  /^(postgres(?:ql)?):\/\/[^:]+:[^@]+@/,
  "$1://cello_service:cello_service_dev@",
);

const describeIntegration = isLocal ? describe : describe.skip;

// ─── Static analysis: STORE_TABLES and BIGINT_COLUMNS include sessions ────────

describe("FEDERATION-001: static analysis — sessions in STORE_TABLES and BIGINT_COLUMNS", () => {
  it("STORE_TABLES includes sessions", () => {
    expect(STORE_TABLES).toContain("sessions");
  });

  it("BIGINT_COLUMNS declares sessions.id", () => {
    expect(BIGINT_COLUMNS["sessions"]).toContain("id");
  });
});

// ─── Integration tests — require CELLO_ENV=local ─────────────────────────────

describeIntegration("FEDERATION-001 integration: AC-001 sessions table schema", () => {
  let superPool: pg.Pool;

  beforeAll(async () => {
    configurePgTypes();
    superPool = new pg.Pool({ connectionString: DATABASE_URL });
    try {
      await superPool.query("SELECT 1");
    } catch (err) {
      throw new Error(
        `[FEDERATION-001] CELLO_ENV=local but Postgres is unreachable at ${DATABASE_URL}: ${String(err)}`,
      );
    }
  });

  afterAll(async () => {
    await superPool?.end();
  });

  it("AC-001: sessions table exists with session_id UUID NOT NULL UNIQUE, owning_node_id TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL", async () => {
    // Verify table exists
    const tableResult = await superPool.query<{ count: string }>(
      `SELECT COUNT(*) FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'sessions'`,
    );
    expect(parseInt(tableResult.rows[0]!.count, 10)).toBe(1);

    // Verify column schema via information_schema.columns
    const colResult = await superPool.query<{
      column_name: string;
      data_type: string;
      is_nullable: string;
    }>(
      `SELECT column_name, data_type, is_nullable
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'sessions'
       ORDER BY column_name`,
    );
    const cols = Object.fromEntries(
      colResult.rows.map((r) => [r.column_name, { data_type: r.data_type, is_nullable: r.is_nullable }]),
    );

    // session_id UUID NOT NULL
    expect(cols["session_id"], "session_id column must exist").toBeDefined();
    expect(cols["session_id"]!.data_type).toBe("uuid");
    expect(cols["session_id"]!.is_nullable).toBe("NO");

    // owning_node_id TEXT NOT NULL
    expect(cols["owning_node_id"], "owning_node_id column must exist").toBeDefined();
    expect(cols["owning_node_id"]!.data_type).toBe("text");
    expect(cols["owning_node_id"]!.is_nullable).toBe("NO");

    // created_at TIMESTAMPTZ NOT NULL
    expect(cols["created_at"], "created_at column must exist").toBeDefined();
    // PostgreSQL represents TIMESTAMPTZ as "timestamp with time zone"
    expect(cols["created_at"]!.data_type).toBe("timestamp with time zone");
    expect(cols["created_at"]!.is_nullable).toBe("NO");

    // chain_hash TEXT NOT NULL
    expect(cols["chain_hash"], "chain_hash column must exist").toBeDefined();
    expect(cols["chain_hash"]!.is_nullable).toBe("NO");
  });
});

describeIntegration("FEDERATION-001 integration: AC-002 directory_checkpoints and checkpoint_node_signatures schema", () => {
  let superPool: pg.Pool;

  beforeAll(async () => {
    configurePgTypes();
    superPool = new pg.Pool({ connectionString: DATABASE_URL });
  });

  afterAll(async () => {
    await superPool?.end();
  });

  it("AC-002: directory_checkpoints has all V5 columns plus V18 additions", async () => {
    const colResult = await superPool.query<{ column_name: string; is_nullable: string }>(
      `SELECT column_name, is_nullable
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'directory_checkpoints'`,
    );
    const colNames = new Set(colResult.rows.map((r) => r.column_name));

    // V5 columns (must remain)
    expect(colNames).toContain("checkpoint_id");
    expect(colNames).toContain("mmr_leaf_count");
    expect(colNames).toContain("peak_hash");           // retained for backwards compatibility
    expect(colNames).toContain("staged_seal_count");
    expect(colNames).toContain("chain_hash");

    // V18 additions
    expect(colNames).toContain("mmr_peaks");
    expect(colNames).toContain("identity_merkle_root");
    expect(colNames).toContain("checkpoint_hash");
    expect(colNames).toContain("coordinator_node_id");
  });

  it("AC-002: checkpoint_node_signatures has full schema including V18 additions", async () => {
    const colResult = await superPool.query<{ column_name: string; data_type: string; is_nullable: string }>(
      `SELECT column_name, data_type, is_nullable
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'checkpoint_node_signatures'
       ORDER BY column_name`,
    );
    const cols = Object.fromEntries(
      colResult.rows.map((r) => [r.column_name, { data_type: r.data_type, is_nullable: r.is_nullable }]),
    );

    // id BIGSERIAL PRIMARY KEY (from V2)
    expect(cols["id"], "id column must exist").toBeDefined();

    // V18 additions
    expect(cols["checkpoint_id"], "checkpoint_id must exist").toBeDefined();
    expect(cols["checkpoint_id"]!.data_type).toBe("uuid");
    expect(cols["checkpoint_id"]!.is_nullable).toBe("NO");

    expect(cols["node_id"], "node_id must exist").toBeDefined();
    expect(cols["node_id"]!.data_type).toBe("text");
    expect(cols["node_id"]!.is_nullable).toBe("NO");

    expect(cols["node_signature"], "node_signature must exist").toBeDefined();
    expect(cols["node_signature"]!.data_type).toBe("text");
    expect(cols["node_signature"]!.is_nullable).toBe("NO");

    expect(cols["signed_at"], "signed_at must exist").toBeDefined();
    expect(cols["signed_at"]!.data_type).toBe("timestamp with time zone");
    expect(cols["signed_at"]!.is_nullable).toBe("NO");
  });
});

describeIntegration("FEDERATION-001 integration: AC-008-idempotency V18 migration idempotency", () => {
  let superPool: pg.Pool;

  beforeAll(async () => {
    configurePgTypes();
    superPool = new pg.Pool({ connectionString: DATABASE_URL });
  });

  afterAll(async () => {
    await superPool?.end();
  });

  it("AC-008-idempotency: re-running V18 SQL on an already-migrated database produces no error", async () => {
    // Read the V18 migration file and execute it again. Every CREATE uses IF NOT EXISTS;
    // every ALTER TABLE ADD COLUMN uses the idempotent DO $$ BEGIN IF NOT EXISTS (...) pattern.
    // Running it a second time must be safe and produce no error.
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const { fileURLToPath } = await import("node:url");

    const migrationsDir = resolve(
      fileURLToPath(new URL(import.meta.url)),
      "../../../db/migrations",
    );
    const v18Sql = readFileSync(`${migrationsDir}/V18__federation_schema.sql`, "utf-8");

    // Execute the V18 SQL again — must not throw
    await expect(superPool.query(v18Sql)).resolves.toBeDefined();

    // Verify flyway_schema_history row count has not changed (V18 is already recorded)
    const historyResult = await superPool.query<{ count: string }>(
      `SELECT COUNT(*) FROM flyway_schema_history WHERE version = '18'`,
    );
    // Exactly 1 row for V18 — running the SQL directly does not add a Flyway history entry
    expect(parseInt(historyResult.rows[0]!.count, 10)).toBe(1);
  });
});

describeIntegration("FEDERATION-001 integration: AC-009-sessions-round-trip", () => {
  let servicePool: pg.Pool;

  function makeLogger(): Logger {
    return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  }

  beforeAll(async () => {
    configurePgTypes();
    servicePool = new pg.Pool({ connectionString: SERVICE_URL });
  });

  afterAll(async () => {
    await servicePool?.end();
  });

  it("AC-009-sessions-round-trip: write via writeSession, read back via fresh PgDirectoryStore with no in-memory state; session_id and owning_node_id correct", async () => {
    const logger = makeLogger();
    const writeStore = new PgDirectoryStore(servicePool, logger, "node-1", "us-east-1");

    const sessionId = randomUUID();
    const owningNodeId = "node-1";

    // Write via writeSession
    await writeStore.writeSession(sessionId, owningNodeId);

    // Read back from a fresh store instance (new pool = no shared state, no in-memory cache)
    const freshPool = new pg.Pool({ connectionString: SERVICE_URL });
    try {
      const readStore = new PgDirectoryStore(freshPool, makeLogger(), "node-1", "us-east-1");
      const owner = await readStore.getSessionOwner(sessionId);

      expect(owner).toBe(owningNodeId);
    } finally {
      await freshPool.end();
    }
  });
});

describeIntegration("FEDERATION-001 integration: AC-011-configure-pg-types-startup", () => {
  let servicePool: pg.Pool;

  beforeAll(async () => {
    configurePgTypes();
    servicePool = new pg.Pool({ connectionString: SERVICE_URL });
  });

  afterAll(async () => {
    await servicePool?.end();
  });

  it("AC-011-configure-pg-types-startup: verifyPgTypes() emits db.type-parsers.verified at INFO with { nodeId, region }", async () => {
    const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const store = new PgDirectoryStore(servicePool, logger, "node-eu1", "eu-central-1");

    await store.verifyPgTypes();

    const infoCalls = (logger.info as ReturnType<typeof vi.fn>).mock.calls as [string, Record<string, unknown>][];
    const verifiedCall = infoCalls.find(([event]) => event === "db.type-parsers.verified");
    expect(verifiedCall, "db.type-parsers.verified must be logged at INFO").toBeDefined();
    expect(verifiedCall![1]["nodeId"]).toBe("node-eu1");
    expect(verifiedCall![1]["region"]).toBe("eu-central-1");

    // No error must have been logged
    expect(logger.error).not.toHaveBeenCalled();
  });
});

describeIntegration("FEDERATION-001 integration: AC-012-table-extra-excluded — verifyChain on sessions", () => {
  let servicePool: pg.Pool;
  let superPool: pg.Pool;

  function makeLogger(): Logger {
    return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  }

  beforeAll(async () => {
    configurePgTypes();
    superPool = new pg.Pool({ connectionString: DATABASE_URL });
    servicePool = new pg.Pool({ connectionString: SERVICE_URL });
    // Truncate sessions table for a clean chain (superuser required — cello_service has no TRUNCATE)
    await superPool.query("TRUNCATE sessions RESTART IDENTITY CASCADE");
  });

  afterAll(async () => {
    await superPool?.end();
    await servicePool?.end();
  });

  it("AC-012-table-extra-excluded: verifyChain('sessions') returns { valid: true } after writeSession", async () => {
    const logger = makeLogger();
    const store = new PgDirectoryStore(servicePool, logger, "node-verify", "us-east-1");

    const sessionId = randomUUID();
    await store.writeSession(sessionId, "node-verify");

    // Verify chain from a fresh store instance
    const freshLogger = makeLogger();
    const freshStore = new PgDirectoryStore(servicePool, freshLogger, "node-verify", "us-east-1");
    const result = await freshStore.verifyChain("sessions");

    expect(result.valid, "Chain must be valid after writeSession").toBe(true);
    expect(result.rowCount).toBeGreaterThanOrEqual(1);
  });
});

describeIntegration("FEDERATION-001 integration: SI-001 — non-owning node write rejected", () => {
  let servicePool: pg.Pool;
  let superPool: pg.Pool;

  function makeLogger(): Logger {
    return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  }

  beforeAll(async () => {
    configurePgTypes();
    superPool = new pg.Pool({ connectionString: DATABASE_URL });
    servicePool = new pg.Pool({ connectionString: SERVICE_URL });
  });

  afterAll(async () => {
    await superPool?.end();
    await servicePool?.end();
  });

  it("SI-001: attempting to write a sessions row with the same session_id twice is rejected by the unique constraint (non-owning node cannot hijack a session)", async () => {
    // Adversarial condition: a non-owning node tries to write a sessions row for a session
    // that already has an owning_node_id set. The unique constraint on session_id prevents
    // a second INSERT — no other node can take ownership of an established session.
    const logger = makeLogger();
    const node1Store = new PgDirectoryStore(servicePool, logger, "node-1", "us-east-1");

    const sessionId = randomUUID();

    // Node 1 writes the session — establishes ownership
    await node1Store.writeSession(sessionId, "node-1");

    // Verify node-1 owns the session
    const owner = await node1Store.getSessionOwner(sessionId);
    expect(owner).toBe("node-1");

    // Node 2 tries to write the same session_id — must be rejected
    const node2Logger = makeLogger();
    const node2Store = new PgDirectoryStore(servicePool, node2Logger, "node-2", "eu-central-1");

    await expect(node2Store.writeSession(sessionId, "node-2")).rejects.toThrow();

    // Verify no new row was written — session still belongs to node-1
    const ownerAfterAttempt = await node1Store.getSessionOwner(sessionId);
    expect(ownerAfterAttempt).toBe("node-1");

    // Verify from a separate DB connection (as required by SI-001)
    const separatePool = new pg.Pool({ connectionString: SERVICE_URL });
    try {
      const separateResult = await separatePool.query<{ owning_node_id: string; count: string }>(
        `SELECT owning_node_id, COUNT(*) as count FROM sessions WHERE session_id = $1 GROUP BY owning_node_id`,
        [sessionId],
      );
      // Only 1 row in sessions for this session_id — no duplicate
      expect(separateResult.rows).toHaveLength(1);
      expect(separateResult.rows[0]!.owning_node_id).toBe("node-1");
      expect(parseInt(separateResult.rows[0]!.count, 10)).toBe(1);
    } finally {
      await separatePool.end();
    }
  });
});

describeIntegration("FEDERATION-001 integration: verifyReplicatedRow observability", () => {
  let servicePool: pg.Pool;
  let superPool: pg.Pool;

  function makeLogger(): Logger {
    return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  }

  beforeAll(async () => {
    configurePgTypes();
    superPool = new pg.Pool({ connectionString: DATABASE_URL });
    servicePool = new pg.Pool({ connectionString: SERVICE_URL });
  });

  afterAll(async () => {
    await superPool?.end();
    await servicePool?.end();
  });

  it("AC-005: verifyReplicatedRow logs federation.replication.verified at INFO with all required fields on hash match", async () => {
    const logger = makeLogger();
    const store = new PgDirectoryStore(servicePool, logger, "node-receiver", "eu-central-1");

    const sessionId = randomUUID();
    await store.writeSession(sessionId, "node-receiver");

    // Read back the row from the DB
    const rowResult = await superPool.query<Record<string, unknown>>(
      `SELECT * FROM sessions WHERE session_id = $1`,
      [sessionId],
    );
    expect(rowResult.rows).toHaveLength(1);
    const row = rowResult.rows[0]!;

    // Call verifyReplicatedRow with the row — hash must match
    const verifyLogger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const verifyStore = new PgDirectoryStore(servicePool, verifyLogger, "node-receiver", "eu-central-1");
    await verifyStore.verifyReplicatedRow("sessions", row);

    // federation.replication.verified must be logged with all required fields
    const infoCalls = (verifyLogger.info as ReturnType<typeof vi.fn>).mock.calls as [string, Record<string, unknown>][];
    const verifiedCall = infoCalls.find(([event]) => event === "federation.replication.verified");
    expect(verifiedCall, "federation.replication.verified must be logged at INFO").toBeDefined();

    const ctx = verifiedCall![1];
    expect(ctx["nodeId"]).toBe("node-receiver");
    expect(ctx["sessionId"]).toBe(sessionId);
    expect(typeof ctx["leafIndex"]).toBe("number");
    expect(typeof ctx["chainHash"]).toBe("string");
    expect((ctx["chainHash"] as string).length).toBe(64); // SHA-256 hex
    expect(typeof ctx["durationMs"]).toBe("number");

    // No error must have been logged
    expect(verifyLogger.error).not.toHaveBeenCalled();
  });

  it("AC-006: verifyReplicatedRow logs federation.replication.chain_hash_mismatch at ERROR when chain_hash is wrong", async () => {
    const logger = makeLogger();
    const store = new PgDirectoryStore(servicePool, logger, "node-receiver-2", "eu-central-1");

    const sessionId = randomUUID();
    await store.writeSession(sessionId, "node-receiver-2");

    // Read back the row, then tamper with chain_hash
    const rowResult = await superPool.query<Record<string, unknown>>(
      `SELECT * FROM sessions WHERE session_id = $1`,
      [sessionId],
    );
    expect(rowResult.rows).toHaveLength(1);
    const tamperedRow = { ...rowResult.rows[0]!, chain_hash: "f".repeat(64) };

    // Call verifyReplicatedRow with the tampered row — hash must mismatch
    const verifyLogger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const verifyStore = new PgDirectoryStore(servicePool, verifyLogger, "node-receiver-2", "eu-central-1");
    await verifyStore.verifyReplicatedRow("sessions", tamperedRow);

    // federation.replication.chain_hash_mismatch must be logged at ERROR
    const errorCalls = (verifyLogger.error as ReturnType<typeof vi.fn>).mock.calls as [string, Record<string, unknown>][];
    const mismatchCall = errorCalls.find(([event]) => event === "federation.replication.chain_hash_mismatch");
    expect(mismatchCall, "federation.replication.chain_hash_mismatch must be logged at ERROR").toBeDefined();

    const ctx = mismatchCall![1];
    expect(ctx["nodeId"]).toBe("node-receiver-2");
    expect(ctx["sessionId"]).toBe(sessionId);
    expect(typeof ctx["leafIndex"]).toBe("number");
    expect(typeof ctx["expectedHash"]).toBe("string");
    expect(ctx["receivedHash"]).toBe("f".repeat(64));

    // No success event logged
    const infoCalls = (verifyLogger.info as ReturnType<typeof vi.fn>).mock.calls as [string, Record<string, unknown>][];
    const verifiedCall = infoCalls.find(([event]) => event === "federation.replication.verified");
    expect(verifiedCall, "federation.replication.verified must NOT be logged on mismatch").toBeUndefined();
  });
});
