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
 * Run via: pnpm --filter @cello-protocol/directory run db:seed
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

    // Truncate append-only tables in dependency order so FK constraints don't block.
    // conversation_attestations and conversation_participation reference conversation_seals,
    // so they must be truncated before conversation_seals.
    await client.query(`
      TRUNCATE TABLE
        conversation_attestations,
        conversation_participation,
        conversation_seals,
        connection_requests,
        notification_events
      RESTART IDENTITY CASCADE
    `);

    // ── Scenario 1: Registered operator with no active sessions ─────────────
    // agent_registrations was dropped in V16 — agent_profiles (V9) is the authoritative
    // agent identity table. Scenario 1 is represented by a row in agent_profiles.
    // No seed data is inserted here; tests that require a registered agent should
    // insert directly into agent_profiles.

    // ── Scenario 2: Unregistered operator ───────────────────────────────────
    // No row needed — an absent agent_profiles row IS the unregistered state.

    // ── Scenario 3: Active session mid-conversation ──────────────────────────
    // A conversation_seals row with close_type='REOPEN' models a conversation that
    // has been (re)opened and is currently active. The conversation_participation
    // rows record which pseudonyms are in the conversation.
    await client.query(
      `INSERT INTO conversation_seals
         (conversation_id, merkle_root, close_type, participant_count, seal_date)
       VALUES ($1, $2, 'REOPEN', 2, current_date)`,
      [
        "00000000-0000-0000-0000-000000000010",
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      ],
    );
    await client.query(
      `INSERT INTO conversation_participation (conversation_id, party_pseudonym)
       VALUES ($1, $2), ($1, $3)`,
      [
        "00000000-0000-0000-0000-000000000010",
        "pseudonym-alice-dev",
        "pseudonym-bob-dev",
      ],
    );

    // ── Scenario 4: Sealed session ───────────────────────────────────────────
    // A conversation_seals row with close_type='MUTUAL_SEAL' is a fully sealed conversation.
    await client.query(
      `INSERT INTO conversation_seals
         (conversation_id, merkle_root, close_type, participant_count, seal_date)
       VALUES ($1, $2, 'MUTUAL_SEAL', 2, current_date - interval '1 day')`,
      [
        "00000000-0000-0000-0000-000000000020",
        "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      ],
    );
    await client.query(
      `INSERT INTO conversation_participation (conversation_id, party_pseudonym)
       VALUES ($1, $2), ($1, $3)`,
      [
        "00000000-0000-0000-0000-000000000020",
        "pseudonym-charlie-dev",
        "pseudonym-diana-dev",
      ],
    );

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
