/**
 * CELLO-PERSIST-003 — Append-only schema with RLS
 *
 * test_type: integration (AC-001 through AC-007) and unit (AC-007 lint, SI-002)
 * Requires CELLO_ENV=local and a running Docker Compose Postgres with Flyway migrations applied.
 * Skipped automatically when CELLO_ENV != 'local'.
 *
 * Run with:
 *   docker compose up -d && docker compose run --rm flyway
 *   CELLO_ENV=local DATABASE_URL=postgresql://postgres:dev@localhost:5433/cello_dev \
 *     pnpm --filter @cello/directory run test
 *
 * Covers:
 *   AC-001: every append-only table has relrowsecurity=true, exactly 2 policies for
 *           cello_service (insert_only, select_all), GRANT INSERT+SELECT, no GRANT UPDATE/DELETE
 *   AC-002: cello_service can INSERT into conversation_seals
 *   AC-003: cello_service UPDATE on conversation_seals raises permission denied
 *   AC-004: cello_service DELETE on conversation_seals raises permission denied
 *   AC-005: every append-only table rejects UPDATE and DELETE for cello_service
 *   AC-006: cello_service SELECT returns rows
 *   AC-007: migration lint — V2 migration contains all 4 required RLS statements per table,
 *           no GRANT UPDATE or DELETE for cello_service
 *   SI-001: cello_service is never granted UPDATE or DELETE (covered by AC-005)
 *   SI-002: RLS enabled in same migration as table creation (lint check)
 *   SI-003: cello_service cannot ALTER TABLE, DROP TABLE, or DROP POLICY
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const isLocal = process.env["CELLO_ENV"] === "local";
const DATABASE_URL =
  process.env["DATABASE_URL"] ?? "postgresql://postgres:dev@localhost:5433/cello_dev";

const MIGRATIONS_DIR = resolve(import.meta.dirname, "../../db/migrations");

// The full canonical append-only table list from persistence-layer-design line 1046
// Must match appendOnlyTables in src/bin/directory.ts
const APPEND_ONLY_TABLES = [
  // agent_registrations removed — table dropped in V16; agent_profiles (V9) is the authoritative agent identity table
  "social_verifications",
  "social_verification_freshness_checks",
  "social_binding_releases",
  "device_bindings",
  "endorsements",
  "attestations",
  "bio_history",
  "pseudonym_bindings",
  "connection_requests",
  "conversation_seals",
  "conversation_attestations",
  "conversation_participation",
  "conversation_proof_leaves",
  "conversation_proof_mmr_nodes",
  "directory_checkpoints",
  "checkpoint_node_signatures",
  "arbitration_verdicts",
  "notification_events",
  "revocations",
  "tombstones",
  "social_proof_freezes",
  "anomaly_events",
  "recovery_contact_designations",
  "recovery_contact_members",
  "recovery_events",
  "recovery_vouches",
  "voucher_accountability_events",
  "voucher_lockouts",
  "trust_seeders",
  "seeder_vouches",
  "seeder_accountability_events",
  "seeder_lockouts",
  "key_rotation_log",
  "identity_migration_log",
  "agent_authorizations",
  "authorization_revocations",
  "authorization_violation_events",
  "contact_aliases",
  "contact_alias_retirements",
  "directory_listings",
  "group_rooms",
  "room_memberships",
] as const;

// ─── Unit test: migration lint (AC-007, SI-002) ───────────────────────────────
// These run without a database connection — they parse the migration file text.

describe("PERSIST-003 AC-007 / SI-002: migration lint", () => {
  const migrationPath = resolve(MIGRATIONS_DIR, "V2__directory_schema.sql");

  it("AC-007: V2 migration file exists", () => {
    let content: string;
    try {
      content = readFileSync(migrationPath, "utf8");
    } catch {
      throw new Error(`V2__directory_schema.sql not found at ${migrationPath}`);
    }
    expect(content.length).toBeGreaterThan(0);
  });

  it("AC-007: every append-only table in V2 has all 4 required RLS statements", () => {
    const content = readFileSync(migrationPath, "utf8");

    const missing: Array<{ table: string; missing: string[] }> = [];

    for (const table of APPEND_ONLY_TABLES) {
      const required = [
        // 1. RLS enable (case-insensitive match)
        new RegExp(
          `ALTER\\s+TABLE\\s+${table}\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`,
          "i",
        ),
        // 2. insert_only policy
        new RegExp(
          `CREATE\\s+POLICY\\s+insert_only\\s+ON\\s+${table}\\s+FOR\\s+INSERT\\s+TO\\s+cello_service`,
          "i",
        ),
        // 3. select_all policy
        new RegExp(
          `CREATE\\s+POLICY\\s+select_all\\s+ON\\s+${table}\\s+FOR\\s+SELECT\\s+TO\\s+cello_service`,
          "i",
        ),
        // 4. GRANT INSERT, SELECT
        new RegExp(
          `GRANT\\s+INSERT\\s*,\\s*SELECT\\s+ON\\s+${table}\\s+TO\\s+cello_service`,
          "i",
        ),
      ];

      const labels = [
        `ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`,
        `CREATE POLICY insert_only ON ${table} FOR INSERT TO cello_service`,
        `CREATE POLICY select_all ON ${table} FOR SELECT TO cello_service`,
        `GRANT INSERT, SELECT ON ${table} TO cello_service`,
      ];

      const missingStatements: string[] = [];
      for (let i = 0; i < required.length; i++) {
        if (!required[i]!.test(content)) {
          missingStatements.push(labels[i]!);
        }
      }

      if (missingStatements.length > 0) {
        missing.push({ table, missing: missingStatements });
      }
    }

    if (missing.length > 0) {
      const detail = missing
        .map((m) => `  ${m.table}:\n${m.missing.map((s) => `    - ${s}`).join("\n")}`)
        .join("\n");
      throw new Error(`Migration V2 is missing RLS statements for the following tables:\n${detail}`);
    }
  });

  it("AC-007: V2 migration does not GRANT UPDATE or DELETE to cello_service", () => {
    const content = readFileSync(migrationPath, "utf8");

    // Reject any line that grants UPDATE or DELETE to cello_service
    const grantUpdatePattern =
      /GRANT\s+(?:[A-Z,\s]*\b(?:UPDATE|DELETE)\b[A-Z,\s]*)\s+ON\s+\S+\s+TO\s+cello_service/gi;

    const badGrants = content.match(grantUpdatePattern);
    expect(
      badGrants,
      `V2 migration must not GRANT UPDATE or DELETE to cello_service. Found: ${JSON.stringify(badGrants)}`,
    ).toBeNull();
  });

  it("DB-001: no migration file contains UPDATE DML (ADD COLUMN migrations must not UPDATE existing rows)", () => {
    // DB-001: ADD COLUMN migrations must never back-fill data via UPDATE.
    // An UPDATE in a migration locks the table and violates the append-only contract.
    const migrationFiles = readdirSync(MIGRATIONS_DIR).filter((f) => /^V\d+__.*\.sql$/.test(f));

    const violations: string[] = [];
    for (const file of migrationFiles) {
      const content = readFileSync(resolve(MIGRATIONS_DIR, file), "utf8");

      // Strip single-line comments (-- ...) and block comments (/* ... */) before scanning.
      const stripped = content
        .replace(/--[^\n]*/g, "")
        .replace(/\/\*[\s\S]*?\*\//g, "");

      // Match UPDATE as a DML statement: UPDATE followed by whitespace and a table name.
      // This distinguishes "UPDATE tbl SET ..." from "REVOKE UPDATE, DELETE" or
      // "GRANT UPDATE" where UPDATE is a privilege keyword, not DML.
      if (/\bUPDATE\s+\w/i.test(stripped)) {
        violations.push(file);
      }
    }

    expect(
      violations,
      `DB-001: the following migration files contain UPDATE DML, which is not permitted:\n${violations.join("\n")}`,
    ).toHaveLength(0);
  });

  it("SI-002: every table created in V2 has RLS enabled in the same file (not a separate migration)", () => {
    // This test verifies the structural requirement: RLS cannot be retroactively added.
    // The lint check in AC-007 already verifies all 4 statements are present in V2.
    // This test additionally checks that no V3+ migration file contains ENABLE ROW LEVEL SECURITY
    // for tables that were created in V2 (which would indicate retroactive addition).
    // For now, only V1 and V2 exist, so we verify V2 contains both CREATE TABLE and RLS for each table.
    const content = readFileSync(migrationPath, "utf8");

    for (const table of APPEND_ONLY_TABLES) {
      const hasCreateTable = new RegExp(
        `CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${table}\\s*\\(`,
        "i",
      ).test(content);
      const hasRls = new RegExp(
        `ALTER\\s+TABLE\\s+${table}\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`,
        "i",
      ).test(content);

      expect(
        hasCreateTable,
        `Table ${table} must be created in V2__directory_schema.sql`,
      ).toBe(true);
      expect(
        hasRls,
        `Table ${table} must have ENABLE ROW LEVEL SECURITY in the same migration (V2)`,
      ).toBe(true);
    }
  });
});

// ─── Integration tests — require CELLO_ENV=local + running Postgres ─────────

const describeIntegration = isLocal ? describe : describe.skip;

let superPool: pg.Pool;
let servicePool: pg.Pool;

beforeAll(async () => {
  if (!isLocal) return;
  // Superuser pool for schema inspection
  superPool = new pg.Pool({ connectionString: DATABASE_URL });

  // cello_service pool — connects as the restricted application role
  // DATABASE_URL uses postgres superuser; we swap credentials for the service role
  const serviceUrl = DATABASE_URL.replace(
    /^(postgres(?:ql)?):\/\/[^:]+:[^@]+@/,
    "$1://cello_service:cello_service_dev@",
  );
  servicePool = new pg.Pool({ connectionString: serviceUrl });
});

afterAll(async () => {
  if (!isLocal) return;
  await superPool?.end();
  await servicePool?.end();
});

describeIntegration("PERSIST-003 AC-001: all append-only tables have RLS + correct policies", () => {
  it("every table exists and has relrowsecurity=true", async () => {
    const client = await superPool.connect();
    try {
      const result = await client.query<{ tablename: string; relrowsecurity: boolean }>(
        `SELECT c.relname AS tablename, c.relrowsecurity
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public'
           AND c.relkind = 'r'
           AND c.relname = ANY($1)`,
        [APPEND_ONLY_TABLES as unknown as string[]],
      );

      const found = new Map(result.rows.map((r) => [r.tablename, r.relrowsecurity]));

      for (const table of APPEND_ONLY_TABLES) {
        expect(found.has(table), `Table '${table}' does not exist`).toBe(true);
        expect(found.get(table), `Table '${table}' does not have relrowsecurity=true`).toBe(true);
      }
    } finally {
      client.release();
    }
  });

  it("every table has exactly 2 policies for cello_service: insert_only and select_all", async () => {
    const client = await superPool.connect();
    try {
      const result = await client.query<{
        tablename: string;
        policyname: string;
        cmd: string;
        roles: string[];
      }>(
        `SELECT tablename, policyname, cmd, roles
         FROM pg_policies
         WHERE schemaname = 'public'
           AND tablename = ANY($1)
           AND 'cello_service' = ANY(roles)
         ORDER BY tablename, policyname`,
        [APPEND_ONLY_TABLES as unknown as string[]],
      );

      // Group by table
      const byTable = new Map<string, Array<{ policyname: string; cmd: string }>>();
      for (const row of result.rows) {
        if (!byTable.has(row.tablename)) byTable.set(row.tablename, []);
        byTable.get(row.tablename)!.push({ policyname: row.policyname, cmd: row.cmd });
      }

      for (const table of APPEND_ONLY_TABLES) {
        const policies = byTable.get(table) ?? [];
        expect(
          policies.length,
          `Table '${table}' should have exactly 2 policies for cello_service, found ${policies.length}: ${JSON.stringify(policies)}`,
        ).toBe(2);

        const policyNames = policies.map((p) => p.policyname).sort();
        expect(policyNames).toEqual(["insert_only", "select_all"]);

        const insertPolicy = policies.find((p) => p.policyname === "insert_only");
        const selectPolicy = policies.find((p) => p.policyname === "select_all");

        expect(insertPolicy?.cmd, `insert_only on ${table} must have cmd=INSERT`).toBe("INSERT");
        expect(selectPolicy?.cmd, `select_all on ${table} must have cmd=SELECT`).toBe("SELECT");
      }
    } finally {
      client.release();
    }
  });

  it("every table has GRANT INSERT and SELECT for cello_service, no GRANT UPDATE or DELETE", async () => {
    const client = await superPool.connect();
    try {
      const result = await client.query<{
        table_name: string;
        privilege_type: string;
        grantee: string;
      }>(
        `SELECT table_name, privilege_type, grantee
         FROM information_schema.role_table_grants
         WHERE table_schema = 'public'
           AND grantee = 'cello_service'
           AND table_name = ANY($1)`,
        [APPEND_ONLY_TABLES as unknown as string[]],
      );

      // Group grants by table
      const grantsByTable = new Map<string, Set<string>>();
      for (const row of result.rows) {
        if (!grantsByTable.has(row.table_name)) grantsByTable.set(row.table_name, new Set());
        grantsByTable.get(row.table_name)!.add(row.privilege_type);
      }

      for (const table of APPEND_ONLY_TABLES) {
        const grants = grantsByTable.get(table) ?? new Set();

        expect(
          grants.has("INSERT"),
          `Table '${table}' must have GRANT INSERT for cello_service`,
        ).toBe(true);

        expect(
          grants.has("SELECT"),
          `Table '${table}' must have GRANT SELECT for cello_service`,
        ).toBe(true);

        expect(
          grants.has("UPDATE"),
          `Table '${table}' must NOT have GRANT UPDATE for cello_service`,
        ).toBe(false);

        expect(
          grants.has("DELETE"),
          `Table '${table}' must NOT have GRANT DELETE for cello_service`,
        ).toBe(false);
      }
    } finally {
      client.release();
    }
  });
});

describeIntegration("PERSIST-003 AC-002: cello_service can INSERT into conversation_seals", () => {
  it("INSERT succeeds and row is visible", async () => {
    // Insert as cello_service via the service pool
    const conversationId = randomUUID();

    const serviceClient = await servicePool.connect();
    try {
      await serviceClient.query(
        `INSERT INTO conversation_seals
           (conversation_id, merkle_root, close_type, participant_count, seal_date, chain_hash)
         VALUES ($1, $2, 'MUTUAL_SEAL', 2, current_date, $3)`,
        [conversationId, "a".repeat(64), "0".repeat(64)],
      );
    } finally {
      serviceClient.release();
    }

    // Verify row is present using the superuser pool
    const superClient = await superPool.connect();
    try {
      const result = await superClient.query<{ conversation_id: string }>(
        `SELECT conversation_id FROM conversation_seals WHERE conversation_id = $1`,
        [conversationId],
      );
      expect(result.rows[0]?.conversation_id).toBe(conversationId);
    } finally {
      superClient.release();
    }
  });
});

describeIntegration(
  "PERSIST-003 AC-003: cello_service UPDATE on conversation_seals raises permission denied",
  () => {
    it("UPDATE raises permission denied (not silent UPDATE 0)", async () => {
      // First insert a row as superuser so we have a target
      const conversationId = randomUUID();
      const superClient = await superPool.connect();
      try {
        await superClient.query(
          `INSERT INTO conversation_seals
             (conversation_id, merkle_root, close_type, participant_count, seal_date, chain_hash)
           VALUES ($1, $2, 'MUTUAL_SEAL', 2, current_date, $3)`,
          [conversationId, "b".repeat(64), "0".repeat(64)],
        );
      } finally {
        superClient.release();
      }

      // Attempt UPDATE as cello_service — must throw permission denied
      const serviceClient = await servicePool.connect();
      let caughtError: Error | null = null;
      try {
        await serviceClient.query(
          `UPDATE conversation_seals SET merkle_root = $1 WHERE conversation_id = $2`,
          ["c".repeat(64), conversationId],
        );
      } catch (err: unknown) {
        caughtError = err instanceof Error ? err : new Error(String(err));
      } finally {
        serviceClient.release();
      }

      expect(caughtError, "UPDATE should have thrown a permission denied error").not.toBeNull();
      expect(
        caughtError!.message.toLowerCase(),
        `Expected permission denied error, got: ${caughtError!.message}`,
      ).toContain("permission denied");

      // Verify the row is unchanged
      const verifyClient = await superPool.connect();
      try {
        const result = await verifyClient.query<{ merkle_root: string }>(
          `SELECT merkle_root FROM conversation_seals WHERE conversation_id = $1`,
          [conversationId],
        );
        expect(result.rows[0]?.merkle_root).toBe("b".repeat(64));
      } finally {
        verifyClient.release();
      }
    });
  },
);

describeIntegration(
  "PERSIST-003 AC-004: cello_service DELETE on conversation_seals raises permission denied",
  () => {
    it("DELETE raises permission denied (not silent DELETE 0)", async () => {
      // Insert a row as superuser
      const conversationId = randomUUID();
      const superClient = await superPool.connect();
      try {
        await superClient.query(
          `INSERT INTO conversation_seals
             (conversation_id, merkle_root, close_type, participant_count, seal_date, chain_hash)
           VALUES ($1, $2, 'MUTUAL_SEAL', 2, current_date, $3)`,
          [conversationId, "d".repeat(64), "0".repeat(64)],
        );
      } finally {
        superClient.release();
      }

      // Attempt DELETE as cello_service — must throw permission denied
      const serviceClient = await servicePool.connect();
      let caughtError: Error | null = null;
      try {
        await serviceClient.query(
          `DELETE FROM conversation_seals WHERE conversation_id = $1`,
          [conversationId],
        );
      } catch (err: unknown) {
        caughtError = err instanceof Error ? err : new Error(String(err));
      } finally {
        serviceClient.release();
      }

      expect(caughtError, "DELETE should have thrown a permission denied error").not.toBeNull();
      expect(
        caughtError!.message.toLowerCase(),
        `Expected permission denied error, got: ${caughtError!.message}`,
      ).toContain("permission denied");

      // Verify the row still exists
      const verifyClient = await superPool.connect();
      try {
        const result = await verifyClient.query<{ count: string }>(
          `SELECT COUNT(*) AS count FROM conversation_seals WHERE conversation_id = $1`,
          [conversationId],
        );
        expect(parseInt(result.rows[0]!.count, 10)).toBe(1);
      } finally {
        verifyClient.release();
      }
    });
  },
);

describeIntegration(
  "PERSIST-003 AC-005 / SI-001: every append-only table rejects UPDATE and DELETE for cello_service",
  () => {
    it("iterates all tables and verifies UPDATE is rejected", async () => {
      const failures: string[] = [];

      for (const table of APPEND_ONLY_TABLES) {
        const serviceClient = await servicePool.connect();
        let caughtError: Error | null = null;
        try {
          // Attempt a no-op UPDATE (WHERE FALSE ensures no rows touched, but privilege check fires first)
          await serviceClient.query(`UPDATE ${table} SET id = id WHERE false`);
        } catch (err: unknown) {
          caughtError = err instanceof Error ? err : new Error(String(err));
        } finally {
          serviceClient.release();
        }

        if (
          caughtError === null ||
          !caughtError.message.toLowerCase().includes("permission denied")
        ) {
          failures.push(
            `${table}: UPDATE did not raise permission denied (got: ${caughtError?.message ?? "no error"})`,
          );
        }
      }

      expect(
        failures,
        `The following tables do not properly reject UPDATE:\n${failures.join("\n")}`,
      ).toHaveLength(0);
    });

    it("iterates all tables and verifies DELETE is rejected", async () => {
      const failures: string[] = [];

      for (const table of APPEND_ONLY_TABLES) {
        const serviceClient = await servicePool.connect();
        let caughtError: Error | null = null;
        try {
          await serviceClient.query(`DELETE FROM ${table} WHERE false`);
        } catch (err: unknown) {
          caughtError = err instanceof Error ? err : new Error(String(err));
        } finally {
          serviceClient.release();
        }

        if (
          caughtError === null ||
          !caughtError.message.toLowerCase().includes("permission denied")
        ) {
          failures.push(
            `${table}: DELETE did not raise permission denied (got: ${caughtError?.message ?? "no error"})`,
          );
        }
      }

      expect(
        failures,
        `The following tables do not properly reject DELETE:\n${failures.join("\n")}`,
      ).toHaveLength(0);
    });
  },
);

describeIntegration("PERSIST-003 AC-006: cello_service SELECT succeeds and returns rows", () => {
  it("SELECT on conversation_seals returns inserted rows", async () => {
    // Insert a row as superuser
    const conversationId = randomUUID();
    const superClient = await superPool.connect();
    try {
      await superClient.query(
        `INSERT INTO conversation_seals
           (conversation_id, merkle_root, close_type, participant_count, seal_date, chain_hash)
         VALUES ($1, $2, 'MUTUAL_SEAL', 2, current_date, $3)`,
        [conversationId, "e".repeat(64), "0".repeat(64)],
      );
    } finally {
      superClient.release();
    }

    // SELECT as cello_service — must return the row
    const serviceClient = await servicePool.connect();
    try {
      const result = await serviceClient.query<{ conversation_id: string }>(
        `SELECT conversation_id FROM conversation_seals WHERE conversation_id = $1`,
        [conversationId],
      );
      expect(result.rows[0]?.conversation_id).toBe(conversationId);
    } finally {
      serviceClient.release();
    }
  });
});

describeIntegration(
  "PERSIST-003 SI-003: cello_service cannot perform DDL (ALTER TABLE, DROP TABLE, DROP POLICY)",
  () => {
    it("cello_service cannot ALTER TABLE on an append-only table", async () => {
      const serviceClient = await servicePool.connect();
      let caughtError: Error | null = null;
      try {
        // Use a non-destructive DDL that would fail at the privilege check
        await serviceClient.query(
          `ALTER TABLE conversation_seals ADD COLUMN IF NOT EXISTS _ddl_test_col TEXT`,
        );
      } catch (err: unknown) {
        caughtError = err instanceof Error ? err : new Error(String(err));
      } finally {
        serviceClient.release();
      }

      expect(caughtError, "ALTER TABLE should have thrown an error").not.toBeNull();
      // Must be ownership or privilege error — not permission denied (DDL uses "must be owner")
      const msg = caughtError!.message.toLowerCase();
      expect(
        msg.includes("must be owner") || msg.includes("permission denied"),
        `Expected ownership error, got: ${caughtError!.message}`,
      ).toBe(true);
    });

    it("cello_service cannot DROP TABLE on an append-only table", async () => {
      const serviceClient = await servicePool.connect();
      let caughtError: Error | null = null;
      try {
        await serviceClient.query(`DROP TABLE IF EXISTS conversation_seals`);
      } catch (err: unknown) {
        caughtError = err instanceof Error ? err : new Error(String(err));
      } finally {
        serviceClient.release();
      }

      expect(caughtError, "DROP TABLE should have thrown an error").not.toBeNull();
      const msg = caughtError!.message.toLowerCase();
      expect(
        msg.includes("must be owner") || msg.includes("permission denied"),
        `Expected ownership error, got: ${caughtError!.message}`,
      ).toBe(true);
    });

    it("cello_service cannot DROP POLICY on an append-only table", async () => {
      const serviceClient = await servicePool.connect();
      let caughtError: Error | null = null;
      try {
        await serviceClient.query(
          `DROP POLICY IF EXISTS insert_only ON conversation_seals`,
        );
      } catch (err: unknown) {
        caughtError = err instanceof Error ? err : new Error(String(err));
      } finally {
        serviceClient.release();
      }

      expect(caughtError, "DROP POLICY should have thrown an error").not.toBeNull();
      const msg = caughtError!.message.toLowerCase();
      expect(
        msg.includes("must be owner") || msg.includes("permission denied"),
        `Expected ownership error, got: ${caughtError!.message}`,
      ).toBe(true);
    });
  },
);
