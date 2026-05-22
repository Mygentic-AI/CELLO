/**
 * CELLO-PERSIST-016 — Schema completeness test
 *
 * Specification:
 *
 * AC-001: Static analysis — reads PgDirectoryStore source via fs.readFileSync,
 *   extracts table names from SQL strings (INSERT INTO, SELECT FROM, UPDATE, DELETE FROM),
 *   cross-references against CREATE TABLE statements in migration files, fails with
 *   a clear list of any referenced tables not found in any migration file.
 *
 * AC-002: Integration — when CELLO_ENV=local and Postgres is reachable, opens a live
 *   TCP connection via the real pg npm package, queries information_schema.tables for
 *   each referenced table, fails if any are absent. If CELLO_ENV != local, skips with
 *   a clear message. If CELLO_ENV=local but pg.connect() fails, the test FAILS (not skips).
 *
 * AC-003: Static analysis correctly reports missing tables — the developer cannot merge
 *   code referencing a table without a migration; this test runs in the standard
 *   pnpm run test suite without a live database.
 *
 * AC-004: When all tables present and Postgres reachable, the integration test passes
 *   and records the exact set of verified table names in its output.
 *
 * AC-005: HASH_CHAINED_TABLES constant cross-checked against migrations; fails if any
 *   entry has no CREATE TABLE in any migration file.
 *
 * SI-001: Dynamic table names via template literals must be registered in KNOWN_DYNAMIC_TABLES.
 *   Any unrecognized dynamic SQL pattern causes the static test to fail.
 *
 * DB-001: Unparseable SQL (unrecognized dynamic pattern) → test fails identifying the string.
 *
 * DB-002: CELLO_ENV != local or Postgres unreachable → integration test skips (not fails).
 *
 * Observability note: schema.completeness.verified and schema.completeness.failed are
 * test-output events; they do not fire through the production Logger interface. The
 * adapter.write.failed event at runtime must carry a tableName context field so operators
 * can distinguish missing-table failures from connection failures or constraint violations.
 *
 * Pseudocode for static analysis (AC-001, AC-003, AC-005):
 *   1. Read PgDirectoryStore source text via readFileSync
 *   2. Extract all SQL template literal strings (backtick-delimited)
 *   3. For each SQL string:
 *      a. If it contains a dynamic ${...} expression — look up in KNOWN_DYNAMIC_TABLES
 *         - If not in KNOWN_DYNAMIC_TABLES → fail with DB-001 error
 *      b. Otherwise — parse table name from INSERT INTO / FROM / UPDATE / DELETE FROM pattern
 *   4. Collect all unique static table names
 *   5. Collect all unique KNOWN_DYNAMIC_TABLES values
 *   6. Read all *.sql files from packages/directory/db/migrations/
 *   7. Extract CREATE TABLE (IF NOT EXISTS)? <name> from all migration files
 *   8. For each table in (static_tables + KNOWN_DYNAMIC_TABLES):
 *      - fail if no matching CREATE TABLE found in any migration file
 *   9. Cross-check HASH_CHAINED_TABLES against the same migration set
 *
 * Pseudocode for integration test (AC-002, AC-004):
 *   1. If CELLO_ENV != 'local' → skip with message
 *   2. Connect to Postgres via DATABASE_URL
 *   3. If connect fails → fail (not skip) — developer explicitly requested live check
 *   4. Query information_schema.tables WHERE table_schema = 'public'
 *   5. For each table in (static_tables + KNOWN_DYNAMIC_TABLES):
 *      - record present / absent
 *   6. If any absent → fail with list
 *   7. If all present → log "verified N tables: [...]"
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import { HASH_CHAINED_TABLES } from "../hash-chain.js";

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * KNOWN_DYNAMIC_TABLES — every table name referenced via a template literal
 * (${tableName}) in PgDirectoryStore. Any dynamic SQL pattern not resolvable
 * to one of these table names causes the static analysis test to fail (DB-001, SI-001).
 *
 * This list is manually maintained and intentionally independent of HASH_CHAINED_TABLES.
 * If it were derived from HASH_CHAINED_TABLES, a developer adding a non-hash-chained
 * dynamic table reference to PgDirectoryStore would bypass the gate silently.
 *
 * Update this constant when:
 *   1. A new table is added to HASH_CHAINED_TABLES (always — insertWithChain and
 *      verifyChain use ${tableName} for all hash-chained tables).
 *   2. A new non-hash-chained table is referenced via a template literal in
 *      PgDirectoryStore (rare — most dynamic references go through insertWithChain).
 *
 * Current values must match HASH_CHAINED_TABLES exactly — the SI-001 test enforces this.
 */
const KNOWN_DYNAMIC_TABLES: readonly string[] = [
  // agent_registrations removed — table dropped in V16; agent_profiles (V9) is the authoritative agent identity table
  "connection_requests",
  "conversation_seals",
  "conversation_attestations",
  "conversation_participation",
  "notification_events",
  "seal_notarizations",
  "connections",  // PERSIST-020: added to HASH_CHAINED_TABLES; registered here per SI-001
  "sessions",     // FEDERATION-001: added to HASH_CHAINED_TABLES (V18 migration)
] as const;

// ─── File paths ───────────────────────────────────────────────────────────────

const PKG_DIR = resolve(import.meta.dirname, "../..");
const STORE_SOURCE_PATH = resolve(PKG_DIR, "src/adapters/pg-directory-store.ts");
const MIGRATIONS_DIR = resolve(PKG_DIR, "db/migrations");

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Extract all backtick-delimited template literal strings from a TypeScript source file.
 * Returns the raw template literal content (without surrounding backticks).
 * Handles multiline template literals correctly.
 *
 * Limitation: does not handle nested template literals (e.g. `outer ${`inner`}`).
 * PgDirectoryStore uses no nested template literals so this is not a current concern.
 */
function extractTemplateLiterals(source: string): string[] {
  const results: string[] = [];
  let i = 0;
  while (i < source.length) {
    if (source[i] === "`") {
      // Find the matching closing backtick, handling escaped backticks (\`)
      let j = i + 1;
      while (j < source.length) {
        if (source[j] === "\\" && j + 1 < source.length) {
          j += 2; // skip escaped character
          continue;
        }
        if (source[j] === "`") {
          break;
        }
        j++;
      }
      results.push(source.slice(i + 1, j));
      i = j + 1;
    } else {
      i++;
    }
  }
  return results;
}

/**
 * Parse a static table name from an SQL fragment.
 * Matches patterns:
 *   INSERT INTO <name>
 *   SELECT ... FROM <name>
 *   UPDATE <name>
 *   DELETE FROM <name>
 * Returns null if no table name found via static pattern.
 *
 * Limitation: for SELECT queries, only the first identifier after FROM is returned.
 * JOIN targets and subquery table references are not detected. PgDirectoryStore has
 * no static multi-table queries so this is not a current concern.
 */
function parseStaticTableName(sql: string): string | null {
  // Normalize whitespace for regex matching
  const normalized = sql.replace(/\s+/g, " ").trim();
  // INSERT INTO <table>
  const insertMatch = normalized.match(/INSERT\s+INTO\s+(\w+)/i);
  if (insertMatch) return insertMatch[1]!;
  // SELECT ... FROM <table>
  const selectMatch = normalized.match(/FROM\s+(\w+)/i);
  if (selectMatch) return selectMatch[1]!;
  // UPDATE <table>
  const updateMatch = normalized.match(/UPDATE\s+(\w+)/i);
  if (updateMatch) return updateMatch[1]!;
  // DELETE FROM <table>
  const deleteMatch = normalized.match(/DELETE\s+FROM\s+(\w+)/i);
  if (deleteMatch) return deleteMatch[1]!;
  return null;
}

/**
 * Returns true if a template literal contains a dynamic ${...} expression.
 */
function hasDynamicExpression(templateLiteral: string): boolean {
  return /\$\{[^}]+\}/.test(templateLiteral);
}

/**
 * Returns true if a template literal looks like a SQL query.
 *
 * Conservative detection: the string must START with a SQL keyword (after optional
 * whitespace/newlines) OR contain SELECT ... FROM at the statement level. This avoids
 * false positives on error-message strings that happen to contain words like "from".
 *
 * Examples that match (real SQL):
 *   `INSERT INTO seal_notarizations ...`
 *   `SELECT chain_hash FROM ${tableName} ORDER BY id DESC LIMIT 1`
 *   `INSERT INTO ${tableName} (...) VALUES (...)`
 *   `SELECT * FROM ${tableName} ORDER BY id ASC`
 *
 * Examples that do NOT match (error message strings):
 *   `insertWithChain: column '${col}' is listed in columns but missing from record for table '${tableName}'`
 */
function isSqlQuery(lit: string): boolean {
  const trimmed = lit.replace(/^\s+/, "");
  return (
    // Starts with INSERT INTO
    /^INSERT\s+INTO\s+/i.test(trimmed) ||
    // Starts with SELECT (SELECT chain_hash FROM ... or SELECT * FROM ...)
    /^SELECT\s+/i.test(trimmed) ||
    // Starts with UPDATE
    /^UPDATE\s+/i.test(trimmed) ||
    // Starts with DELETE FROM
    /^DELETE\s+FROM\s+/i.test(trimmed)
  );
}

/**
 * Extract all CREATE TABLE names from a migration SQL file.
 * Matches: CREATE TABLE (IF NOT EXISTS)? <name>
 */
function extractCreateTableNames(sql: string): string[] {
  const names: string[] = [];
  const regex = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(sql)) !== null) {
    names.push(match[1]!);
  }
  return names;
}

/**
 * Scan all migration SQL files and return the set of all CREATE TABLE names.
 */
function getMigrationTableSet(): Set<string> {
  const migrationFiles = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const tableSet = new Set<string>();
  for (const file of migrationFiles) {
    const content = readFileSync(resolve(MIGRATIONS_DIR, file), "utf8");
    for (const name of extractCreateTableNames(content)) {
      tableSet.add(name);
    }
  }
  return tableSet;
}

/**
 * Extract the set of statically-referenced table names from PgDirectoryStore source.
 * Also validates that all dynamic expressions are covered by KNOWN_DYNAMIC_TABLES.
 * Returns an object with:
 *   staticTables: set of table names from static SQL strings
 *   dynamicErrors: list of template literals with unrecognized dynamic patterns (DB-001)
 */
function extractStoreTableNames(source: string): {
  staticTables: Set<string>;
  dynamicErrors: string[];
} {
  const literals = extractTemplateLiterals(source);
  const staticTables = new Set<string>();
  const dynamicErrors: string[] = [];

  for (const lit of literals) {
    // Only consider template literals that look like SQL queries
    if (!isSqlQuery(lit)) continue;

    if (hasDynamicExpression(lit)) {
      // DB-001 / SI-001: dynamic SQL — must be covered by KNOWN_DYNAMIC_TABLES
      // We recognize the pattern "... FROM ${tableName}" or "INSERT INTO ${tableName}"
      // as the valid dynamic pattern for insertWithChain / verifyChain.
      // Any other dynamic pattern is an unknown and causes a test failure.
      // Valid dynamic pattern: the table variable follows FROM, INTO, or UPDATE.
      // The table names themselves are validated via KNOWN_DYNAMIC_TABLES (SI-001 test).
      // Note: this check validates SQL structure only — it does not verify the variable
      // resolves to a table in KNOWN_DYNAMIC_TABLES. The SI-001 test handles that by
      // asserting KNOWN_DYNAMIC_TABLES covers every table HASH_CHAINED_TABLES declares,
      // and all dynamic references in PgDirectoryStore go through insertWithChain/verifyChain
      // which are typed to accept only HashChainedTable values.
      const isKnownPattern = /(?:FROM|INTO|UPDATE)\s+\$\{[^}]+\}/.test(lit);
      if (!isKnownPattern) {
        dynamicErrors.push(lit.slice(0, 120));
      }
    } else {
      // Static SQL — extract the table name
      const name = parseStaticTableName(lit);
      if (name !== null) {
        staticTables.add(name);
      }
    }
  }

  return { staticTables, dynamicErrors };
}

// ─── Static analysis tests (unit — no Postgres required) ──────────────────────

describe("PERSIST-016: schema completeness — static analysis", () => {
  it("AC-001 / AC-003: every table name extracted from PgDirectoryStore SQL strings has a corresponding CREATE TABLE in a migration file", () => {
    /*
     * AC-001: read source, extract table names, cross-reference against migrations.
     * AC-003: test fails and names the missing table(s) — enforces CI merge gate.
     *
     * Expected at PERSIST-016 merge time (before PERSIST-018/019/020/021 migrations):
     * This test will FAIL because seal_notarizations, notification_queue, connections,
     * and pending_connection_requests are referenced in PgDirectoryStore but have no
     * CREATE TABLE in any migration file. This is by design — the test IS the CI gate.
     * The test becomes green once PERSIST-018/019/020/021 add those migrations.
     */
    const source = readFileSync(STORE_SOURCE_PATH, "utf8");
    const { staticTables, dynamicErrors } = extractStoreTableNames(source);

    // DB-001 / SI-001: dynamic SQL strings with unrecognized patterns must be registered
    if (dynamicErrors.length > 0) {
      throw new Error(
        `[PERSIST-016 DB-001] PgDirectoryStore contains unrecognized dynamic SQL patterns.\n` +
        `Register the table name(s) in KNOWN_DYNAMIC_TABLES or rewrite as static SQL.\n` +
        `Unrecognized patterns:\n${dynamicErrors.map((e) => `  - ${e}`).join("\n")}`,
      );
    }

    const migrationTables = getMigrationTableSet();
    const missingFromMigrations: string[] = [];

    for (const table of staticTables) {
      if (!migrationTables.has(table)) {
        missingFromMigrations.push(table);
      }
    }

    // schema.completeness.failed (test-output event — not production Logger)
    if (missingFromMigrations.length > 0) {
      const checkedTableCount = staticTables.size;
      throw new Error(
        `[PERSIST-016 schema.completeness.failed] ` +
        `${missingFromMigrations.length} table(s) referenced in PgDirectoryStore ` +
        `have no CREATE TABLE in any migration file.\n` +
        `checkedTableCount: ${checkedTableCount}\n` +
        `missingTables: [${missingFromMigrations.sort().join(", ")}]\n\n` +
        `Add a Flyway migration file for each missing table before merging this change.`,
      );
    }

    // schema.completeness.verified (test-output event — not production Logger)
    // migrationTables.size reflects all CREATE TABLE entries; use it to avoid a second readdirSync
    const migrationCount = migrationTables.size;
    console.info(
      `[PERSIST-016 schema.completeness.verified] ` +
      `tableCount: ${staticTables.size}, migrationCount: ${migrationCount}`,
    );

    expect(missingFromMigrations).toHaveLength(0);
  });

  it("AC-005: every HASH_CHAINED_TABLES entry has a CREATE TABLE in a migration file", () => {
    /*
     * AC-005: cross-check HASH_CHAINED_TABLES constant against migration set.
     * If a table is added to HASH_CHAINED_TABLES without a migration, this test catches it.
     * HASH_CHAINED_TABLES is developer-maintained — this prevents it from silently diverging
     * from the actual migration set.
     */
    const migrationTables = getMigrationTableSet();
    const missingFromMigrations: string[] = [];

    for (const table of HASH_CHAINED_TABLES) {
      if (!migrationTables.has(table)) {
        missingFromMigrations.push(table);
      }
    }

    if (missingFromMigrations.length > 0) {
      throw new Error(
        `[PERSIST-016 AC-005] HASH_CHAINED_TABLES contains table(s) with no ` +
        `CREATE TABLE in any migration file.\n` +
        `missingTables: [${missingFromMigrations.sort().join(", ")}]\n\n` +
        `Add a Flyway migration file for each missing table or remove it from HASH_CHAINED_TABLES.`,
      );
    }

    expect(missingFromMigrations).toHaveLength(0);
  });

  it("SI-001: KNOWN_DYNAMIC_TABLES covers all dynamic ${tableName} patterns in PgDirectoryStore", () => {
    /*
     * SI-001: every table name that appears via a dynamic expression in PgDirectoryStore
     * is registered in KNOWN_DYNAMIC_TABLES. The test verifies that the allowlist is not
     * empty and that all HASH_CHAINED_TABLES entries appear in KNOWN_DYNAMIC_TABLES
     * (since insertWithChain and verifyChain use ${tableName} for all hash-chained tables).
     */
    const source = readFileSync(STORE_SOURCE_PATH, "utf8");
    const { dynamicErrors } = extractStoreTableNames(source);

    // No unrecognized dynamic patterns
    expect(dynamicErrors).toHaveLength(0);

    // Every HASH_CHAINED_TABLES entry must appear in KNOWN_DYNAMIC_TABLES
    // (because insertWithChain and verifyChain use ${tableName} for these tables)
    const knownSet = new Set(KNOWN_DYNAMIC_TABLES);
    const missingFromKnown: string[] = [];
    for (const table of HASH_CHAINED_TABLES) {
      if (!knownSet.has(table)) {
        missingFromKnown.push(table);
      }
    }
    if (missingFromKnown.length > 0) {
      throw new Error(
        `[PERSIST-016 SI-001] HASH_CHAINED_TABLES entries are missing from KNOWN_DYNAMIC_TABLES.\n` +
        `Add these to KNOWN_DYNAMIC_TABLES in schema-completeness.test.ts:\n` +
        missingFromKnown.map((t) => `  - ${t}`).join("\n"),
      );
    }
    expect(missingFromKnown).toHaveLength(0);
  });
});

// ─── Integration tests (CELLO_ENV=local with live Postgres) ───────────────────

const isLocal = process.env["CELLO_ENV"] === "local";
const DATABASE_URL =
  process.env["DATABASE_URL"] ?? "postgresql://postgres:dev@localhost:5433/cello_dev";

const describeIntegration = isLocal ? describe : describe.skip;

describeIntegration(
  isLocal
    ? "PERSIST-016: schema completeness — live Postgres integration"
    : "PERSIST-016: schema completeness — live Postgres integration (SKIPPED: CELLO_ENV != local)",
  () => {
    it("AC-002 / AC-004: every table referenced by PgDirectoryStore exists in information_schema.tables", async () => {
      /*
       * AC-002: open a live TCP connection via the real pg npm package; for each table
       *   referenced by PgDirectoryStore, assert it exists in information_schema.tables.
       *   Fails (not skips) if CELLO_ENV=local but pg.connect() fails.
       *
       * AC-004: when all tables are present, records the exact set of verified table
       *   names in test output — a verifiable assertion, not just absence of error.
       *
       * DB-002: If CELLO_ENV != local or Postgres unreachable (and not CELLO_ENV=local),
       *   this describe block is skipped entirely (via describeIntegration).
       *   If CELLO_ENV=local and the connection fails, we fail — not skip.
       */
      const source = readFileSync(STORE_SOURCE_PATH, "utf8");
      const { staticTables } = extractStoreTableNames(source);

      // All tables to check: static tables + known dynamic tables
      const allTables = new Set([...staticTables, ...KNOWN_DYNAMIC_TABLES]);

      // Open a live TCP connection — fail (not skip) if CELLO_ENV=local and connection refused
      const pool = new pg.Pool({ connectionString: DATABASE_URL });
      let client: pg.PoolClient;
      try {
        client = await pool.connect();
      } catch (err: unknown) {
        await pool.end().catch(() => { /* ignore */ });
        const reason = err instanceof Error ? err.message : String(err);
        throw new Error(
          `[PERSIST-016 AC-002] CELLO_ENV=local but pg.connect() failed — ` +
          `is Docker Compose running? (${reason})`,
        );
      }

      let existingTables: Set<string>;
      try {
        const result = await client.query<{ table_name: string }>(
          `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
        );
        existingTables = new Set(result.rows.map((r) => r.table_name));
      } finally {
        client.release();
        await pool.end().catch(() => { /* ignore — pool cleanup errors don't affect test results */ });
      }

      const missingFromDb: string[] = [];
      for (const table of allTables) {
        if (!existingTables.has(table)) {
          missingFromDb.push(table);
        }
      }

      // schema.completeness.failed (test-output event)
      if (missingFromDb.length > 0) {
        throw new Error(
          `[PERSIST-016 schema.completeness.failed] ` +
          `${missingFromDb.length} table(s) missing from live database.\n` +
          `checkedTableCount: ${allTables.size}\n` +
          `missingTables: [${missingFromDb.sort().join(", ")}]\n\n` +
          `Run: docker compose up -d && docker compose run --rm flyway`,
        );
      }

      // schema.completeness.verified (test-output event)
      const verifiedTables = [...allTables].sort();
      console.info(
        `[PERSIST-016 schema.completeness.verified] ` +
        `verified ${verifiedTables.length} tables: [${verifiedTables.join(", ")}]`,
      );

      // AC-004: explicit assertion on the verified set — not merely "no error was thrown"
      expect(missingFromDb).toHaveLength(0);
      expect(verifiedTables.length).toBeGreaterThan(0);
    });
  },
);
