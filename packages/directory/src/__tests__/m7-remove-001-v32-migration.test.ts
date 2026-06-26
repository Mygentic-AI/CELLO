/**
 * CELLO-M7-REMOVE-001 (DOD-REMOVE-4 / AC-004) — V32 agent_revocations migration integration gate.
 *
 * Verifies (against a database with ALL prior migrations already applied — docker-compose flyway):
 *   - V32 is present in flyway_schema_history and NO migration has a checksum/apply failure (V1..V32).
 *   - cello_service can INSERT + SELECT agent_revocations.
 *   - cello_service CANNOT UPDATE or DELETE agent_revocations — it is append-only (a permanent tombstone).
 *   - UNIQUE(agent_id): a second revocation for the same agent_id conflicts.
 *
 * Gated on CELLO_ENV=local (Docker Postgres). Run: docker compose run --rm flyway migrate, then
 * CELLO_ENV=local vitest run this file.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool, type PoolClient } from "pg";

const describeIntegration = process.env.CELLO_ENV === "local" ? describe : describe.skip;

describeIntegration("V32 agent_revocations migration (AC-004)", () => {
  let pool: Pool;
  const testAgentId = `v32test-${Math.floor(Date.now() / 1000)}-${Math.random().toString(16).slice(2, 8)}`;

  // SET ROLE only affects the connection it runs on, and node-pg's Pool hands out arbitrary
  // connections per query — so role-scoped tests MUST pin a single dedicated client.
  async function asCelloService<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await pool.connect();
    try {
      await c.query("SET ROLE cello_service");
      return await fn(c);
    } finally {
      await c.query("RESET ROLE").catch(() => {});
      c.release();
    }
  }

  beforeAll(() => {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL || "postgresql://postgres:dev@localhost:5433/cello_dev",
    });
  });

  afterAll(async () => {
    if (pool) {
      // Clean up the test row as superuser (cello_service cannot DELETE — that's the point).
      await pool.query("RESET ROLE").catch(() => {});
      await pool.query("DELETE FROM agent_revocations WHERE agent_id = $1", [testAgentId]).catch(() => {});
      await pool.end();
    }
  });

  it("V32 is applied and all migrations (V1..V32) succeeded — zero checksum/apply errors", async () => {
    const v32 = await pool.query("SELECT version, description, success FROM flyway_schema_history WHERE version = '32' LIMIT 1");
    if (v32.rows.length === 0) {
      throw new Error("V32 not in flyway_schema_history — run `docker compose run --rm flyway migrate` first (AC-004 gate).");
    }
    expect(v32.rows[0].description).toContain("agent revocations");
    expect(v32.rows[0].success).toBe(true);
    const all = await pool.query("SELECT version, success FROM flyway_schema_history");
    expect(all.rows.filter((r) => !r.success), "no migration may have failed").toHaveLength(0);
  });

  it("cello_service can INSERT + SELECT agent_revocations", async () => {
    await asCelloService(async (c) => {
      await c.query(
        `INSERT INTO agent_revocations (agent_id, epoch_id, reason, signature, revoked_at)
         VALUES ($1, '', 'voluntary', $2, $3)`,
        [testAgentId, Buffer.from(new Uint8Array(64)), Date.now()],
      );
      const sel = await c.query("SELECT agent_id, reason FROM agent_revocations WHERE agent_id = $1", [testAgentId]);
      expect(sel.rows).toHaveLength(1);
      expect(sel.rows[0].reason).toBe("voluntary");
    });
  });

  it("UNIQUE(agent_id): a second revocation for the same agent conflicts", async () => {
    await asCelloService(async (c) => {
      await expect(
        c.query(
          `INSERT INTO agent_revocations (agent_id, epoch_id, reason, signature, revoked_at) VALUES ($1, '', 'dup', $2, $3)`,
          [testAgentId, Buffer.from(new Uint8Array(64)), Date.now()],
        ),
      ).rejects.toThrow(/duplicate key|unique/i);
    });
  });

  it("cello_service has NO UPDATE or DELETE privilege (append-only tombstone)", async () => {
    const priv = await pool.query(
      `SELECT has_table_privilege('cello_service', 'agent_revocations', 'UPDATE') AS upd,
              has_table_privilege('cello_service', 'agent_revocations', 'DELETE') AS del,
              has_table_privilege('cello_service', 'agent_revocations', 'INSERT') AS ins,
              has_table_privilege('cello_service', 'agent_revocations', 'SELECT') AS sel`,
    );
    expect(priv.rows[0].ins).toBe(true);
    expect(priv.rows[0].sel).toBe(true);
    expect(priv.rows[0].upd, "UPDATE must be denied — revocations are permanent").toBe(false);
    expect(priv.rows[0].del, "DELETE must be denied — revocations are permanent").toBe(false);
  });

  it("cello_service UPDATE/DELETE are actually blocked at SQL level", async () => {
    await asCelloService(async (c) => {
      await expect(c.query("UPDATE agent_revocations SET reason = 'x' WHERE agent_id = $1", [testAgentId])).rejects.toThrow(/permission denied/);
      await expect(c.query("DELETE FROM agent_revocations WHERE agent_id = $1", [testAgentId])).rejects.toThrow(/permission denied/);
    });
  });
});
