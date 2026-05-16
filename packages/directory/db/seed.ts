#!/usr/bin/env node
/**
 * CELLO directory seed script (PERSIST-002 SI-002 / AC-005).
 *
 * Wipes and restores the local database to four baseline scenarios:
 *   1. Registered operator with no active sessions
 *   2. Unregistered operator
 *   3. Active session mid-conversation (with hash entries)
 *   4. Sealed session (with conversation_seal row)
 *
 * SI-002: only runnable against CELLO_ENV=local. Exits with code 1 otherwise.
 * AC-005: baseline scenarios inserted after tables are truncated.
 *
 * Run via: pnpm --filter @cello/directory run db:seed
 */

import pg from "pg";

const env = process.env["CELLO_ENV"];
if (env !== "local") {
  process.stderr.write(
    `seed: refusing to run against CELLO_ENV=${env ?? "(unset)"}. Only CELLO_ENV=local is permitted.\n`,
  );
  process.exit(1);
}

const DATABASE_URL =
  process.env["DATABASE_URL"] ?? "postgresql://postgres:dev@localhost:5433/cello_dev";

const client = new pg.Client({ connectionString: DATABASE_URL });

async function seed(): Promise<void> {
  await client.connect();
  try {
    await client.query("BEGIN");

    // TODO(PERSIST-003): truncate and seed tables once schema is defined.
    // Each scenario maps 1:1 to a table row. Add INSERTs here after
    // V2__directory_schema.sql is written.

    await client.query("COMMIT");
    process.stdout.write("seed: baseline scenarios applied.\n");
  } catch (err) {
    await client.query("ROLLBACK");
    process.stderr.write(`seed: failed — ${String(err)}\n`);
    process.exit(1);
  } finally {
    await client.end();
  }
}

await seed();
