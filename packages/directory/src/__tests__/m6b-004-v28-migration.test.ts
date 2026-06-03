// AC-002 integration test: V28__grant_cello_service_update_agent_profiles.sql
// Story: CELLO-M6B-004
//
// This test verifies:
// - cello_service role can execute UPDATE on agent_profiles after V28 is applied
// - The exact operation linkAgentToAccount() uses succeeds without permission error
// - GRANT is idempotent (can be run multiple times)
//
// Note: This test assumes the database already has V1-V28 applied via Flyway
// (docker-compose brings up postgres with migrations applied). It does NOT
// re-apply migrations — it only verifies the V28 GRANT worked.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { readFileSync } from "fs";
import { join } from "path";

const describeIntegration =
  process.env.CELLO_ENV === "local" ? describe : describe.skip;

describeIntegration("V28 migration integration test (AC-002)", () => {
  let pool: Pool;

  beforeAll(async () => {
    // Connect to the local dev database (assumes migrations V1-V28 already applied)
    pool = new Pool({
      connectionString:
        process.env.DATABASE_URL ||
        "postgresql://postgres:dev@localhost:5433/cello_dev",
    });
  });

  afterAll(async () => {
    if (pool) {
      await pool.end();
    }
  });

  it("verifies V28 is applied and no checksum errors exist", async () => {
    // First, check if V28 is applied — this is a hard requirement for all other tests
    const v28Check = await pool.query(
      "SELECT version FROM flyway_schema_history WHERE version = '28' ORDER BY installed_rank DESC LIMIT 1"
    );

    if (v28Check.rows.length === 0) {
      throw new Error(
        "V28 migration not found in flyway_schema_history. " +
          "Run migrations first with docker-compose up or flyway migrate. " +
          "This is AC-002's integration gate — V28 must be applied before this test can pass."
      );
    }

    // Query flyway_schema_history to verify all migrations including V28
    const result = await pool.query(
      "SELECT version, description, success FROM flyway_schema_history ORDER BY installed_rank"
    );

    // All migrations should have success = true
    const failed = result.rows.filter((row) => !row.success);
    expect(failed).toHaveLength(0);

    // V28 should exist
    const v28 = result.rows.find((row) => row.version === "28");
    expect(v28).toBeDefined();
    expect(v28?.description).toContain("grant cello service update agent profiles");
    expect(v28?.success).toBe(true);
  });

  it("grants UPDATE permission to cello_service on agent_profiles (AC-002 exact test)", async () => {
    // Verify the exact operation linkAgentToAccount() uses succeeds
    // SET ROLE cello_service + UPDATE agent_profiles WHERE k_local_pubkey = ...
    await pool.query("SET ROLE cello_service");

    try {
      // This should succeed (no permission error)
      // Returns zero rows because 'nonexistent' doesn't match anything
      const result = await pool.query(
        `UPDATE agent_profiles
         SET account_id = NULL
         WHERE k_local_pubkey = $1
         RETURNING *`,
        ["nonexistent"]
      );

      // Should return zero rows (no match), but no permission error
      expect(result.rows).toHaveLength(0);
    } finally {
      // Always reset role, even if UPDATE fails
      await pool.query("RESET ROLE");
    }
  });

  it("verifies GRANT is idempotent (can be run multiple times)", async () => {
    // Read V28 migration file (from db/migrations/)
    const v28Path = join(
      __dirname,
      "../../db/migrations/V28__grant_cello_service_update_agent_profiles.sql"
    );
    const v28Sql = readFileSync(v28Path, "utf-8");

    // Extract just the GRANT statement (skip comments)
    const grantStatement = v28Sql
      .split("\n")
      .filter((line) => !line.trim().startsWith("--") && line.trim().length > 0)
      .join("\n");

    // Run GRANT again — should succeed (idempotent)
    await expect(pool.query(grantStatement)).resolves.not.toThrow();
  });

  it("verifies UPDATE permission exists in pg_class (not blocked by missing GRANT)", async () => {
    // Query pg_class relacl to verify cello_service has UPDATE (write) permission
    // This verifies the GRANT worked at the permission level (not RLS policy level)
    const result = await pool.query(
      `SELECT has_table_privilege('cello_service', 'agent_profiles', 'UPDATE') AS has_update`
    );

    expect(result.rows[0].has_update).toBe(true);

    // Also verify that without the GRANT, UPDATE would be false (negative test concept)
    // We can't test this directly, but the fact that AC-002 exact test passed
    // (UPDATE with nonexistent key) proves UPDATE permission exists at SQL level.
    // RLS policies are a separate concern — V28 only adds the GRANT, not RLS UPDATE policy.
  });

  it("verifies rollback statement works (REVOKE UPDATE)", async () => {
    // Test the documented rollback path in V28 migration comment
    // Rollback: REVOKE UPDATE ON agent_profiles FROM cello_service;

    // First, run REVOKE
    await pool.query("REVOKE UPDATE ON agent_profiles FROM cello_service");

    // Verify UPDATE is now blocked
    await pool.query("SET ROLE cello_service");
    await expect(
      pool.query(
        "UPDATE agent_profiles SET account_id = NULL WHERE k_local_pubkey = 'test'"
      )
    ).rejects.toThrow(/permission denied/);

    // Reset role before re-granting
    await pool.query("RESET ROLE");

    // Re-grant for cleanup (restore state for other tests)
    await pool.query("GRANT UPDATE ON agent_profiles TO cello_service");

    // Verify permission is restored
    const result = await pool.query(
      `SELECT has_table_privilege('cello_service', 'agent_profiles', 'UPDATE') AS has_update`
    );
    expect(result.rows[0].has_update).toBe(true);
  });
});
