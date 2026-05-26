/**
 * CELLO-OPS-AGENT-000 — AC-007b / SI-002: cello_ops_agent role scope boundary
 *
 * test_type: integration
 * Requires CELLO_ENV=local and a running Docker Compose Postgres with V26 migration applied.
 * Skipped automatically when CELLO_ENV != 'local'.
 *
 * Run with:
 *   CELLO_ENV=local DATABASE_URL=postgresql://postgres:dev@localhost:5433/cello_dev \
 *     DEV_ENVELOPE_KEY=86e903357804be102cf6f55e1b86ed342e01a6f50835272200ac970d0d094ac7 \
 *     AUDIT_LOG_PATH=/tmp/cello-audit.jsonl \
 *     pnpm --filter @cello-protocol/directory run test -- --pool-options.threads.maxThreads=1
 *
 * AC-007b: Verifies cello_ops_agent scope boundary:
 *   - SELECT on registrations succeeds
 *   - SELECT on pre_authorization_tokens succeeds
 *   - SELECT on agent_profiles returns permission denied (42501)
 *   - SELECT on sessions returns permission denied (42501) — if table exists
 *   - DELETE on registrations returns permission denied (42501)
 *   - DELETE on pre_authorization_tokens returns permission denied (42501)
 *
 * SI-002 (adversarial): Even if the Operations Agent container is compromised,
 *   the attacker's database credential (cello_ops_agent) cannot delete any row,
 *   cannot read agent_profiles, sessions, or key material.
 *   Adversarial condition: cello_ops_agent attempts DELETE and cross-table SELECT.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";

const isLocal = process.env["CELLO_ENV"] === "local";
const DATABASE_URL =
  process.env["DATABASE_URL"] ?? "postgresql://postgres:dev@localhost:5433/cello_dev";

// cello_ops_agent connection: same host/db as DATABASE_URL, but different credentials
// The role uses password 'cello_ops_agent_dev' in the local dev environment.
// In production, the password is managed by the rotation Lambda (OPS-AGENT-005A).
const opsAgentUrl = DATABASE_URL.replace(
  /^(postgres(?:ql)?):\/\/[^:]+:[^@]+@/,
  "$1://cello_ops_agent:cello_ops_agent_dev@",
);

const describeIntegration = isLocal ? describe : describe.skip;

let opsAgentPool: pg.Pool;

beforeAll(async () => {
  if (!isLocal) return;
  opsAgentPool = new pg.Pool({ connectionString: opsAgentUrl });
});

afterAll(async () => {
  if (!isLocal) return;
  await opsAgentPool?.end();
});

// ─── Helper: attempt a query and return the pg error code, or null on success ───

async function attemptQuery(
  pool: pg.Pool,
  sql: string,
): Promise<{ succeeded: true } | { succeeded: false; code: string; message: string }> {
  const client = await pool.connect();
  try {
    await client.query(sql);
    return { succeeded: true };
  } catch (err: unknown) {
    const pgErr = err as { code?: string; message?: string };
    return {
      succeeded: false,
      code: pgErr.code ?? "UNKNOWN",
      message: pgErr.message ?? String(err),
    };
  } finally {
    client.release();
  }
}

describeIntegration(
  "OPS-AGENT-000 AC-007: schema structure assertions (registrations + pre_authorization_tokens)",
  () => {
    // Queries information_schema and pg_indexes to verify the schema is exactly as designed.
    // Uses opsAgentPool — SELECT on information_schema is available to any role.

    it("AC-007: registrations table exists", async () => {
      const result = await opsAgentPool.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'registrations'`,
      );
      expect(result.rows.length, "registrations table must exist").toBe(1);
    });

    it("AC-007: pre_authorization_tokens table exists", async () => {
      const result = await opsAgentPool.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'pre_authorization_tokens'`,
      );
      expect(result.rows.length, "pre_authorization_tokens table must exist").toBe(1);
    });

    it("AC-007: registrations columns have correct nullability", async () => {
      const result = await opsAgentPool.query<{ column_name: string; is_nullable: string }>(
        `SELECT column_name, is_nullable
         FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'registrations'`,
      );
      const cols = Object.fromEntries(result.rows.map((r) => [r.column_name, r.is_nullable]));

      // NOT NULL columns
      const notNullCols = [
        "id",
        "phone_stub_hash",
        "channel",
        "channel_user_id",
        "state",
        "state_data",
        "otp_attempt_count",
        "created_at",
        "updated_at",
        "expires_at",
        "chain_hash",
      ];
      for (const col of notNullCols) {
        expect(cols[col], `registrations.${col} must exist`).toBeDefined();
        expect(cols[col], `registrations.${col} must be NOT NULL`).toBe("NO");
      }

      // Nullable columns
      const nullableCols = ["email_domain", "otp_hash", "otp_salt", "otp_expires_at"];
      for (const col of nullableCols) {
        expect(cols[col], `registrations.${col} must exist`).toBeDefined();
        expect(cols[col], `registrations.${col} must be nullable`).toBe("YES");
      }
    });

    it("AC-007: partial UNIQUE index idx_registrations_phone_stub_hash_active exists on registrations", async () => {
      const result = await opsAgentPool.query<{ indexname: string }>(
        `SELECT indexname FROM pg_indexes
         WHERE tablename = 'registrations'
           AND indexname = 'idx_registrations_phone_stub_hash_active'`,
      );
      expect(
        result.rows.length,
        "partial UNIQUE index idx_registrations_phone_stub_hash_active must exist on registrations",
      ).toBe(1);
    });

    it("AC-007: pre_authorization_tokens.token has a UNIQUE index", async () => {
      // information_schema.constraint_column_usage only shows rows the current role owns,
      // so we use pg_indexes (globally visible) to verify the UNIQUE index on token.
      const result = await opsAgentPool.query<{ indexname: string }>(
        `SELECT indexname FROM pg_indexes
         WHERE tablename = 'pre_authorization_tokens'
           AND indexname = 'pre_authorization_tokens_token_key'`,
      );
      expect(
        result.rows.length,
        "pre_authorization_tokens.token must have a UNIQUE index (pre_authorization_tokens_token_key)",
      ).toBe(1);
    });

    it("AC-007: FK from pre_authorization_tokens.registration_id to registrations(id) exists", async () => {
      const result = await opsAgentPool.query<{ constraint_name: string }>(
        `SELECT rc.constraint_name
         FROM information_schema.referential_constraints rc
         JOIN information_schema.key_column_usage kcu
           ON rc.constraint_name = kcu.constraint_name
          AND rc.constraint_schema = kcu.table_schema
         JOIN information_schema.key_column_usage kcu2
           ON rc.unique_constraint_name = kcu2.constraint_name
          AND rc.unique_constraint_schema = kcu2.table_schema
         WHERE kcu.table_schema = 'public'
           AND kcu.table_name = 'pre_authorization_tokens'
           AND kcu.column_name = 'registration_id'
           AND kcu2.table_name = 'registrations'
           AND kcu2.column_name = 'id'`,
      );
      expect(
        result.rows.length,
        "FK from pre_authorization_tokens.registration_id to registrations(id) must exist",
      ).toBeGreaterThanOrEqual(1);
    });

    it("AC-007: pre_authorization_tokens.chain_hash is NOT NULL", async () => {
      const result = await opsAgentPool.query<{ is_nullable: string }>(
        `SELECT is_nullable FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'pre_authorization_tokens'
           AND column_name = 'chain_hash'`,
      );
      expect(result.rows.length, "pre_authorization_tokens.chain_hash column must exist").toBe(1);
      expect(result.rows[0]!.is_nullable, "pre_authorization_tokens.chain_hash must be NOT NULL").toBe(
        "NO",
      );
    });

    it("AC-007: pre_authorization_tokens.consumed_at is nullable", async () => {
      const result = await opsAgentPool.query<{ is_nullable: string }>(
        `SELECT is_nullable FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'pre_authorization_tokens'
           AND column_name = 'consumed_at'`,
      );
      expect(result.rows.length, "pre_authorization_tokens.consumed_at column must exist").toBe(1);
      expect(
        result.rows[0]!.is_nullable,
        "pre_authorization_tokens.consumed_at must be nullable",
      ).toBe("YES");
    });
  },
);

describeIntegration(
  "OPS-AGENT-000 AC-007b: cello_ops_agent role scope boundary",
  () => {
    it("AC-007b: SELECT on registrations as cello_ops_agent succeeds", async () => {
      const result = await attemptQuery(opsAgentPool, "SELECT 1 FROM registrations LIMIT 1");
      expect(
        result.succeeded,
        `Expected SELECT on registrations to succeed, got error: ${
          result.succeeded ? "" : result.message
        }`,
      ).toBe(true);
    });

    it("AC-007b: SELECT on pre_authorization_tokens as cello_ops_agent succeeds", async () => {
      const result = await attemptQuery(
        opsAgentPool,
        "SELECT 1 FROM pre_authorization_tokens LIMIT 1",
      );
      expect(
        result.succeeded,
        `Expected SELECT on pre_authorization_tokens to succeed, got error: ${
          result.succeeded ? "" : result.message
        }`,
      ).toBe(true);
    });

    it("AC-007b / SI-002 (adversarial): SELECT on agent_profiles as cello_ops_agent returns permission denied (42501)", async () => {
      // SI-002 adversarial condition: compromised Operations Agent container attempts
      // to read agent identity data. Must be blocked at the database level.
      const result = await attemptQuery(opsAgentPool, "SELECT 1 FROM agent_profiles LIMIT 1");
      expect(
        result.succeeded,
        "cello_ops_agent must NOT be able to SELECT from agent_profiles",
      ).toBe(false);
      if (!result.succeeded) {
        expect(
          result.code,
          `Expected PostgreSQL error code 42501 (permission denied), got: ${result.code} — ${result.message}`,
        ).toBe("42501");
      }
    });

    it("AC-007b / SI-002 (adversarial): SELECT on sessions as cello_ops_agent returns permission denied (42501) or table does not exist", async () => {
      // sessions table may not exist in all test environments — skip gracefully if absent.
      // If it exists, cello_ops_agent must be denied access (42501).
      // Error code 42P01 means "undefined_table" — table doesn't exist, which is also acceptable.
      const result = await attemptQuery(opsAgentPool, "SELECT 1 FROM sessions LIMIT 1");
      if (result.succeeded) {
        throw new Error("cello_ops_agent must NOT be able to SELECT from sessions");
      }
      // 42501 = permission denied, 42P01 = undefined table (sessions not in this migration set)
      expect(
        result.code === "42501" || result.code === "42P01",
        `Expected 42501 (permission denied) or 42P01 (table does not exist), got: ${result.code} — ${result.message}`,
      ).toBe(true);
    });

    it("AC-007b / SI-002 (adversarial): DELETE on registrations as cello_ops_agent returns permission denied (42501)", async () => {
      // SI-002 adversarial condition: compromised Operations Agent attempts DELETE.
      // WHERE false avoids any actual row modification; PostgreSQL checks privileges before executing.
      const result = await attemptQuery(
        opsAgentPool,
        "DELETE FROM registrations WHERE false",
      );
      expect(
        result.succeeded,
        "cello_ops_agent must NOT be able to DELETE from registrations (no-DELETE semantics)",
      ).toBe(false);
      if (!result.succeeded) {
        expect(
          result.code,
          `Expected PostgreSQL error code 42501 (permission denied), got: ${result.code} — ${result.message}`,
        ).toBe("42501");
      }
    });

    it("AC-007b / SI-002 (adversarial): DELETE on pre_authorization_tokens as cello_ops_agent returns permission denied (42501)", async () => {
      // SI-002 adversarial condition: compromised Operations Agent attempts DELETE on token table.
      const result = await attemptQuery(
        opsAgentPool,
        "DELETE FROM pre_authorization_tokens WHERE false",
      );
      expect(
        result.succeeded,
        "cello_ops_agent must NOT be able to DELETE from pre_authorization_tokens (no-DELETE semantics)",
      ).toBe(false);
      if (!result.succeeded) {
        expect(
          result.code,
          `Expected PostgreSQL error code 42501 (permission denied), got: ${result.code} — ${result.message}`,
        ).toBe("42501");
      }
    });
  },
);
