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
 *     pnpm --filter @cello/directory run test -- --pool-options.threads.maxThreads=1
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
