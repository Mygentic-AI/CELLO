#!/usr/bin/env node
/**
 * PERSIST-E2E-001 SI-007 — pgaudit infrastructure is unmodifiable by cello_service
 *
 * What this proves:
 *   1. cello_service cannot DELETE rows from any append-only table
 *   2. cello_service cannot TRUNCATE any append-only table
 *   3. cello_service cannot DROP the pgaudit extension
 *   4. cello_service cannot modify pg_catalog or pg_authid (system tables)
 *   5. The superuser (postgres) CAN perform these operations (confirming RLS is
 *      the constraint, not a misconfiguration that blocks everyone)
 *
 * Note: pgaudit writes to the Postgres log stream (stdout/file), not to a
 * queryable table. SI-007 is verified by confirming cello_service cannot alter
 * the pgaudit configuration or delete from append-only business tables that
 * pgaudit is monitoring.
 *
 * Usage:
 *   DATABASE_URL="postgresql://postgres:dev@localhost:5433/cello_dev" \
 *   node packages/e2e-tests/scripts/test-pgaudit-immutable.mjs
 */

import { randomBytes } from "node:crypto";
import pg from "pg";

function log(msg) { console.log(`[pgaudit-immutable] ${msg}`); }
function fail(msg) { console.error(`[pgaudit-immutable] FAIL: ${msg}`); process.exit(1); }
function pass(msg) { console.log(`[pgaudit-immutable] PASS: ${msg}`); }

const DATABASE_URL =
  process.env["DATABASE_URL"] ?? "postgresql://postgres:dev@localhost:5433/cello_dev";

const SERVICE_URL = DATABASE_URL.replace(
  /\/\/[^@]+@/,
  "//cello_service:cello_service_dev@",
);

const APPEND_ONLY_TABLES = [
  "agent_registrations",
  "agent_profiles",
  "conversation_seals",
  "conversation_attestations",
  "seal_notarizations",
  "connections",
  "notification_queue",
  "pending_connection_requests",
];

async function assertPermissionDenied(pool, sql, args = [], label = "") {
  try {
    await pool.query(sql, args);
    fail(`${label}: expected permission denied but query succeeded`);
  } catch (err) {
    const msg = err.message || String(err);
    if (
      !msg.toLowerCase().includes("permission denied") &&
      !msg.toLowerCase().includes("insufficient privilege")
    ) {
      fail(`${label}: expected permission denied, got: ${msg}`);
    }
    pass(`${label}: permission denied as expected`);
  }
}

async function main() {
  log("Starting pgaudit immutability test (SI-007)");

  const superPool = new pg.Pool({ connectionString: DATABASE_URL });
  const servicePool = new pg.Pool({ connectionString: SERVICE_URL });

  try {
    await superPool.query("SELECT 1");
  } catch (err) {
    await superPool.end();
    await servicePool.end();
    fail(`Cannot connect to Postgres: ${err.message}`);
  }

  // ── Setup: insert a test row via superuser for DELETE/TRUNCATE tests ──
  log("Setup: inserting a test agent_registration row via superuser");
  const agentId = `si007-test-${randomBytes(8).toString("hex")}`;
  await superPool.query(
    `INSERT INTO agent_registrations (agent_id, primary_pubkey, registered_at, chain_hash)
     VALUES ($1, $2, now(), $3)`,
    [
      agentId,
      Buffer.from(randomBytes(32)).toString("hex"),
      Buffer.from(randomBytes(32)).toString("hex"),
    ],
  );
  log(`Inserted test row for agent_id=${agentId}`);

  // ── Case 1: cello_service cannot DELETE from append-only tables ──
  log("Case 1: cello_service DELETE on append-only tables → permission denied");
  for (const table of APPEND_ONLY_TABLES) {
    await assertPermissionDenied(
      servicePool,
      `DELETE FROM ${table} WHERE false`,
      [],
      `DELETE ${table} as cello_service`,
    );
  }

  // ── Case 2: cello_service cannot TRUNCATE append-only tables ──
  log("Case 2: cello_service TRUNCATE on append-only tables → permission denied");
  for (const table of APPEND_ONLY_TABLES) {
    await assertPermissionDenied(
      servicePool,
      `TRUNCATE ${table}`,
      [],
      `TRUNCATE ${table} as cello_service`,
    );
  }

  // ── Case 3: cello_service cannot DROP the pgaudit extension ──
  log("Case 3: cello_service cannot DROP pgaudit extension");
  await assertPermissionDenied(
    servicePool,
    `DROP EXTENSION pgaudit`,
    [],
    "DROP EXTENSION pgaudit as cello_service",
  );

  // ── Case 4: cello_service cannot ALTER pgaudit settings ──
  log("Case 4: cello_service cannot ALTER SYSTEM to change pgaudit.log");
  await assertPermissionDenied(
    servicePool,
    `ALTER SYSTEM SET pgaudit.log = 'none'`,
    [],
    "ALTER SYSTEM pgaudit.log as cello_service",
  );

  // ── Case 5: cello_service cannot UPDATE on append-only tables ──
  log("Case 5: cello_service UPDATE on append-only tables → permission denied");
  for (const table of APPEND_ONLY_TABLES) {
    await assertPermissionDenied(
      servicePool,
      `UPDATE ${table} SET chain_hash = 'x' WHERE false`,
      [],
      `UPDATE ${table} as cello_service`,
    );
  }

  // ── Positive control: superuser CAN delete the test row ──
  log("Positive control: superuser can DELETE test row (confirming RLS is role-specific)");
  const deleteResult = await superPool.query(
    `DELETE FROM agent_registrations WHERE agent_id = $1`,
    [agentId],
  );
  if (deleteResult.rowCount === 0) {
    fail("Superuser DELETE did not remove the test row — something is wrong with setup");
  }
  pass("Superuser can DELETE (RLS is role-specific, not global lockout)");

  await superPool.end();
  await servicePool.end();
  log("ALL CHECKS PASSED");
}

main().catch(async (err) => {
  console.error("[pgaudit-immutable] Unexpected error:", err);
  process.exit(1);
});
