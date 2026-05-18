#!/usr/bin/env node
/**
 * PERSIST-E2E-001 SI-007 — pgaudit infrastructure is unmodifiable by cello_service
 *
 * What this proves:
 *   1. cello_service cannot DELETE rows from any append-only table
 *   2. cello_service cannot TRUNCATE any append-only table
 *   3. cello_service cannot DROP the pgaudit extension
 *   4. cello_service cannot ALTER SYSTEM to change pgaudit settings
 *   5. cello_service cannot UPDATE append-only tables
 *   6. The superuser (postgres) CAN delete (confirming RLS is role-specific)
 *
 * Usage:
 *   DATABASE_URL="postgresql://postgres:dev@localhost:5433/cello_dev" \
 *   node packages/e2e-tests/scripts/test-pgaudit-immutable.mjs
 */

import { resolve, join } from "node:path";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
const _require = createRequire(import.meta.url);
const pg = _require(join(resolve(import.meta.dirname, "../../.."), "packages/directory/node_modules/pg"));

function log(msg) { console.log(`[pgaudit-immutable] ${msg}`); }
function fail(msg) { console.error(`[pgaudit-immutable] FAIL: ${msg}`); process.exit(1); }
function pass(msg) { console.log(`[pgaudit-immutable] PASS: ${msg}`); }

const DATABASE_URL =
  process.env["DATABASE_URL"] ?? "postgresql://postgres:dev@localhost:5433/cello_dev";

const SERVICE_URL = DATABASE_URL.replace(
  /\/\/[^@]+@/,
  "//cello_service:cello_service_dev@",
);

// Tables that must be append-only — cello_service can INSERT and SELECT but not mutate.
// notification_queue and pending_connection_requests are intentionally excluded: they are
// drain queues with a DELETE policy for cello_service (rows are consumed, not archived).
const APPEND_ONLY_TABLES = [
  "agent_registrations",
  "agent_profiles",
  "conversation_seals",
  "conversation_attestations",
  "seal_notarizations",
  "connections",
  "notification_events",
];

async function assertPermissionDenied(pool, sql, args, label) {
  try {
    await pool.query(sql, args ?? []);
    fail(`${label}: expected permission denied but query succeeded`);
  } catch (err) {
    const msg = (err.message || String(err)).toLowerCase();
    if (!msg.includes("permission denied") && !msg.includes("insufficient privilege")) {
      fail(`${label}: expected permission denied, got: ${err.message}`);
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

  // ── Case 1: cello_service cannot DELETE from append-only tables ──
  log("Case 1: cello_service DELETE on append-only tables → permission denied");
  for (const table of APPEND_ONLY_TABLES) {
    // WHERE false means no rows match — we're testing the permission, not needing existing rows
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

  // ── Case 4: cello_service cannot ALTER SYSTEM to change pgaudit settings ──
  log("Case 4: cello_service cannot ALTER SYSTEM to change pgaudit.log");
  await assertPermissionDenied(
    servicePool,
    `ALTER SYSTEM SET pgaudit.log = 'none'`,
    [],
    "ALTER SYSTEM pgaudit.log as cello_service",
  );

  // ── Case 5: cello_service cannot UPDATE append-only tables ──
  log("Case 5: cello_service UPDATE on append-only tables → permission denied");
  for (const table of APPEND_ONLY_TABLES) {
    await assertPermissionDenied(
      servicePool,
      `UPDATE ${table} SET chain_hash = 'x' WHERE false`,
      [],
      `UPDATE ${table} as cello_service`,
    );
  }

  // ── Positive control: superuser CAN insert and delete ──
  log("Positive control: superuser can INSERT and DELETE notification_events (confirms RLS is role-specific)");
  const notifUuid = (() => {
    const h = randomBytes(16).toString("hex");
    return [h.slice(0,8), h.slice(8,12), h.slice(12,16), h.slice(16,20), h.slice(20,32)].join("-");
  })();
  await superPool.query(
    `INSERT INTO notification_events
       (notification_id, recipient_pseudonym, notification_type, payload_hash, chain_hash)
     VALUES ($1, $2, $3, $4, $5)`,
    [notifUuid, "si007-control", "SYSTEM", "aabbcc", "00".repeat(32)],
  );
  const del = await superPool.query(
    `DELETE FROM notification_events WHERE notification_id = $1`,
    [notifUuid],
  );
  if (del.rowCount === 0) {
    fail("Superuser DELETE did not remove the control row");
  }
  pass("Superuser can INSERT and DELETE (RLS is role-specific, not global lockout)");

  await superPool.end();
  await servicePool.end();
  log("ALL CHECKS PASSED");
}

main().catch(async (err) => {
  console.error("[pgaudit-immutable] Unexpected error:", err);
  process.exit(1);
});
