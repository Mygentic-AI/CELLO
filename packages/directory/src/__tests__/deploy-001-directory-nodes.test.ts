/**
 * CELLO-DEPLOY-001 AC-010 — directory_nodes table
 *
 * Specification:
 *
 * AC-010: directory_nodes is added to STORE_TABLES in PgDirectoryStore;
 * directory_nodes.id (BIGSERIAL) is declared in BIGINT_COLUMNS.
 * A round-trip integration test writes a directory_nodes row via PgDirectoryStore
 * and reads it back from a fresh PgDirectoryStore instance with no in-memory state
 * (CELLO_ENV=local, real Postgres — no stub). The fresh instance having no cache is
 * itself the evidence that the result came from a live SELECT.
 *
 * NOTE: sessions table and insertSession/getSession are also in scope for AC-010
 * ("sessions (owning_node_id)") but the sessions table is created by FEDERATION-001
 * (V18 migration). Sessions round-trip tests live in FEDERATION-001's test file.
 * The STORE_TABLES and BIGINT_COLUMNS static gate for sessions is tested here
 * because the methods exist in PgDirectoryStore in this branch.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
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

// ─── Static analysis: STORE_TABLES and BIGINT_COLUMNS include new tables ─────

describe("DEPLOY-001: AC-010 static analysis — directory_nodes and sessions in STORE_TABLES", () => {
  it("STORE_TABLES includes directory_nodes", () => {
    expect(STORE_TABLES).toContain("directory_nodes");
  });

  it("STORE_TABLES includes sessions", () => {
    expect(STORE_TABLES).toContain("sessions");
  });

  it("BIGINT_COLUMNS declares directory_nodes.id", () => {
    expect(BIGINT_COLUMNS["directory_nodes"]).toContain("id");
  });

  it("BIGINT_COLUMNS declares sessions.id", () => {
    expect(BIGINT_COLUMNS["sessions"]).toContain("id");
  });
});

// ─── Integration test: directory_nodes round-trip ────────────────────────────

describeIntegration("DEPLOY-001: AC-010 integration — directory_nodes round-trip", () => {
  let servicePool: pg.Pool;

  const mockLogger: Logger = {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  };

  beforeAll(async () => {
    configurePgTypes();
    servicePool = new pg.Pool({ connectionString: SERVICE_URL });
    // Tables are created by Flyway migration V17 applied via docker-compose.
    // Verify the table exists rather than recreating it.
    const result = await servicePool.query(
      `SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'directory_nodes'`
    );
    const count = parseInt(result.rows[0].count, 10);
    if (count === 0) {
      throw new Error(
        "directory_nodes table does not exist. " +
        "Ensure docker-compose is running and Flyway V17 migration has been applied."
      );
    }
  });

  afterAll(async () => {
    await servicePool.end();
  });

  it("writes directory_node, reads from fresh instance — id is number", async () => {
    const writeStore = new PgDirectoryStore(servicePool, mockLogger);
    const nodeId = `test-node-${randomUUID().slice(0, 8)}`;
    const { id: writtenId } = await writeStore.insertDirectoryNode({
      nodeId,
      region: "us-east-1",
      endpoint: "https://directory-us1.cello.mygentic.ai",
      status: "active",
    });
    expect(typeof writtenId).toBe("number");

    // Read from a completely fresh store instance (new pool = no shared state)
    const freshPool = new pg.Pool({ connectionString: SERVICE_URL });
    try {
      const readStore = new PgDirectoryStore(freshPool, mockLogger);
      const node = await readStore.getDirectoryNode(nodeId);

      expect(node).not.toBeNull();
      expect(node!.nodeId).toBe(nodeId);
      expect(node!.region).toBe("us-east-1");
      expect(node!.endpoint).toBe("https://directory-us1.cello.mygentic.ai");
      expect(node!.status).toBe("active");
      // BIGINT deserialization: id must be a number, not a string
      expect(typeof node!.id).toBe("number");
      expect(node!.id).toBe(writtenId);
    } finally {
      await freshPool.end();
    }
  });
});
