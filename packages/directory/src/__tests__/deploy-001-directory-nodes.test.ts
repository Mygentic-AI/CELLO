/**
 * CELLO-DEPLOY-001 AC-010 — directory_nodes and sessions tables
 *
 * Specification:
 *
 * AC-010: directory_nodes and sessions (owning_node_id) are added to STORE_TABLES
 * in PgDirectoryStore; directory_nodes.id (BIGSERIAL) is declared in BIGINT_COLUMNS.
 * A round-trip integration test writes a directory_nodes row and a sessions row with
 * owning_node_id populated via the new PgDirectoryStore methods and reads them back
 * from a fresh PgDirectoryStore instance with no in-memory state (CELLO_ENV=local,
 * real Postgres — no stub). The fresh instance having no cache is itself the evidence
 * that the result came from a live SELECT.
 *
 * Pseudocode:
 *   1. Insert a directory_node { nodeId: "us-east-1", region: "us-east-1", status: "active" }
 *   2. Insert a session { sessionId: randomUUID(), owningNodeId: "us-east-1" }
 *      (session_id is UUID per FEDERATION-001 AC-001 specification)
 *   3. Create a FRESH PgDirectoryStore instance (new Pool connection — no shared state)
 *   4. Read directory_node by nodeId from the fresh instance
 *   5. Assert id is typeof number (BIGINT deserialization)
 *   6. Read session by sessionId from the fresh instance
 *   7. Assert id is typeof number, owningNodeId matches
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

// ─── Integration test: round-trip write/read ─────────────────────────────────

describeIntegration("DEPLOY-001: AC-010 integration — directory_nodes and sessions round-trip", () => {
  let adminPool: pg.Pool;
  let servicePool: pg.Pool;

  const mockLogger: Logger = {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  };

  beforeAll(async () => {
    configurePgTypes();
    adminPool = new pg.Pool({ connectionString: DATABASE_URL });
    servicePool = new pg.Pool({ connectionString: SERVICE_URL });

    // Create tables matching V17 migration if not already applied.
    // session_id is UUID per FEDERATION-001 AC-001 specification.
    const client = await adminPool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS directory_nodes (
          id BIGSERIAL PRIMARY KEY,
          node_id TEXT NOT NULL UNIQUE,
          region TEXT NOT NULL,
          endpoint TEXT,
          status TEXT NOT NULL DEFAULT 'active',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await client.query(`
        CREATE TABLE IF NOT EXISTS sessions (
          id BIGSERIAL PRIMARY KEY,
          session_id UUID NOT NULL UNIQUE,
          owning_node_id TEXT NOT NULL REFERENCES directory_nodes(node_id),
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      // Grant SELECT and INSERT only (no UPDATE — tables are append-only per design)
      await client.query(`GRANT SELECT, INSERT ON directory_nodes TO cello_service`);
      await client.query(`GRANT SELECT, INSERT ON sessions TO cello_service`);
      await client.query(`GRANT USAGE, SELECT ON SEQUENCE directory_nodes_id_seq TO cello_service`);
      await client.query(`GRANT USAGE, SELECT ON SEQUENCE sessions_id_seq TO cello_service`);
    } finally {
      client.release();
    }
  });

  afterAll(async () => {
    await servicePool.end();
    await adminPool.end();
  });

  it("writes directory_node, reads from fresh instance — id is number", async () => {
    // Write using one store instance
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

  it("writes session with owning_node_id, reads from fresh instance", async () => {
    // First ensure a directory_node exists for the FK reference
    const writeStore = new PgDirectoryStore(servicePool, mockLogger);
    const nodeId = `session-owner-${randomUUID().slice(0, 8)}`;
    await writeStore.insertDirectoryNode({
      nodeId,
      region: "eu-central-1",
    });

    // Insert a session — session_id is UUID per FEDERATION-001 AC-001
    const sessionId = randomUUID();
    const { id: writtenId } = await writeStore.insertSession({
      sessionId,
      owningNodeId: nodeId,
    });
    expect(typeof writtenId).toBe("number");

    // Read from fresh instance
    const freshPool = new pg.Pool({ connectionString: SERVICE_URL });
    try {
      const readStore = new PgDirectoryStore(freshPool, mockLogger);
      const session = await readStore.getSession(sessionId);

      expect(session).not.toBeNull();
      expect(session!.sessionId).toBe(sessionId);
      expect(session!.owningNodeId).toBe(nodeId);
      // BIGINT deserialization
      expect(typeof session!.id).toBe("number");
      expect(session!.id).toBe(writtenId);
    } finally {
      await freshPool.end();
    }
  });
});
