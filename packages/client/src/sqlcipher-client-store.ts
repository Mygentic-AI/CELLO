/**
 * SQLCipherClientStore — SQLCipher-encrypted ClientStore for CELLO_ENV=dev+.
 *
 * PERSIST-009: Implements the ClientStore interface backed by SQLCipher-encrypted SQLite.
 * Used only by the composition root. Never exported from packages/client/src/index.ts.
 *
 * Security invariants (PERSIST-009):
 *   SI-001: db_key is NEVER logged, serialized, or included in any error message.
 *   SI-002: Constructor takes db_key (Uint8Array), NOT identity_key. The caller
 *           must derive db_key via deriveDbKey() before constructing this store.
 *   SI-003: No PRAGMA cipher_* commands that would weaken AES-256-CBC defaults.
 *
 * Degraded behavior (DB-001):
 *   On corrupt file or wrong key, logs client.store.open.failed and throws.
 *   Never creates a new empty database over a corrupt file.
 */

import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { ClientStore, Logger } from "@cello-protocol/interfaces";

// ─── Type shim for @journeyapps/sqlcipher ───────────────────────────────────

interface SqlCipherRunResult {
  lastID: number;
  changes: number;
}

interface SqlCipherRow {
  [key: string]: unknown;
}

interface SqlCipherDatabase {
  serialize(callback: () => void): void;
  run(sql: string, params?: unknown[], callback?: (this: SqlCipherRunResult, err: Error | null) => void): SqlCipherDatabase;
  get(sql: string, params?: unknown[], callback?: (err: Error | null, row?: SqlCipherRow) => void): SqlCipherDatabase;
  all(sql: string, params?: unknown[], callback?: (err: Error | null, rows?: SqlCipherRow[]) => void): SqlCipherDatabase;
  exec(sql: string, callback?: (err: Error | null) => void): SqlCipherDatabase;
  close(callback?: (err: Error | null) => void): void;
}

interface SqlCipherModule {
  Database: new (
    filename: string,
    mode: number,
    callback: (err: Error | null) => void,
  ) => SqlCipherDatabase;
  OPEN_READWRITE: number;
  OPEN_CREATE: number;
}

// ─── Constructor options ──────────────────────────────────────────────────────

export interface SQLCipherClientStoreOptions {
  /** Absolute path to the SQLite database file. */
  dbPath: string;
  /** Stable agent identifier — included in log events. */
  agentId: string;
  /** CELLO_ENV value — included in client.store.opened log event. */
  env?: string;
  /**
   * @internal test seam — defaults to packages/client/db/migrations/
   */
  migrationsPath?: string;
  /** Structured logger injected at the composition root. */
  logger: Logger;
}

// ─── SQLCipherClientStore ────────────────────────────────────────────────────

/**
 * ClientStore backed by a SQLCipher-encrypted SQLite database.
 *
 * Lifecycle: construct → open() → (use) → close().
 *
 * IMPORTANT: only import this from the composition root. The ESLint
 * no-restricted-imports rule enforces this at compile time.
 */
export class SQLCipherClientStore implements ClientStore {
  readonly #dbKey: Uint8Array;
  readonly #dbPath: string;
  readonly #agentId: string;
  readonly #env: string;
  readonly #migrationsPath: string;
  readonly #logger: Logger;

  // Mutable state set during open()
  #db: SqlCipherDatabase | null = null;

  /**
   * @param dbKey   - 32-byte database encryption key derived from identity_key via HKDF.
   *                  NEVER pass identity_key here — only the derived db_key (SI-002).
   * @param options - Store configuration including dbPath, agentId, and logger.
   */
  constructor(dbKey: Uint8Array, options: SQLCipherClientStoreOptions) {
    this.#dbKey = dbKey;
    this.#dbPath = options.dbPath;
    this.#agentId = options.agentId;
    this.#env = options.env ?? "unknown";
    this.#logger = options.logger;

    if (options.migrationsPath !== undefined) {
      this.#migrationsPath = options.migrationsPath;
    } else {
      // Resolve default migrations path relative to this module file.
      // Works for both the TypeScript source (packages/client/src/) and
      // the compiled output (packages/client/dist/), since db/ is a sibling of both.
      const moduleDir = dirname(fileURLToPath(import.meta.url));
      this.#migrationsPath = resolve(moduleDir, "../db/migrations");
    }
  }

  /**
   * Open the encrypted database, verify the key, and apply pending migrations.
   * Must be called before any read/write operations.
   *
   * Throws on:
   *   - corrupt file (file exists but is not a valid SQLCipher database)
   *   - wrong key (PRAGMA key does not decrypt the file)
   *   - migration failure
   *
   * On any throw, logs client.store.open.failed and does NOT create a new empty
   * database over the corrupt file (DB-001).
   */
  async open(): Promise<void> {
    // Load the native module. Using createRequire because @journeyapps/sqlcipher
    // is a CJS module and this file is ESM.
    const require = createRequire(import.meta.url);
    let sqlite3Module: SqlCipherModule;
    try {
      sqlite3Module = require("@journeyapps/sqlcipher") as SqlCipherModule;
    } catch (loadErr: unknown) {
      const reason = loadErr instanceof Error ? loadErr.message : String(loadErr);
      this.#logger.error("client.store.open.failed", { reason: `SQLCipher native module unavailable: ${reason}`, agentId: this.#agentId });
      throw new Error(`SQLCipher native module unavailable: ${reason}`);
    }

    const db = await this.#openDatabase(sqlite3Module);
    // NOTE: do not assign this.#db yet — #applyKey and #verifyKey must succeed first.

    try {
      // Apply PRAGMA key (SI-003: only the key PRAGMA — no weakening cipher settings)
      await this.#applyKey(db);

      // Verify the key is correct by reading the sqlite_master table.
      // If the key is wrong or the file is corrupt, this will fail.
      await this.#verifyKey(db);

      // Key is verified — safe to make the database accessible to other methods.
      this.#db = db;

      // Run migration runner — applies pending V{n}__*.sql files
      await this.#runMigrations(db);

      this.#logger.info("client.store.opened", {
        env: this.#env,
        dbPath: this.#dbPath,
        agentId: this.#agentId,
      });
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : String(err);
      // SI-001: never include key material in the error log
      this.#logger.error("client.store.open.failed", {
        reason,
        agentId: this.#agentId,
      });
      // Close the DB to release the file handle
      await new Promise<void>((resolve) => {
        db.close(() => resolve());
      });
      this.#db = null;
      throw err;
    }
  }

  /** Close the database. Idempotent — safe to call multiple times. */
  async close(): Promise<void> {
    if (this.#db === null) return;
    const db = this.#db;
    this.#db = null;
    await new Promise<void>((resolve, reject) => {
      db.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  // ─── ClientStore interface ─────────────────────────────────────────────────

  async set(key: string, value: Uint8Array): Promise<void> {
    this.#assertOpen();
    const db = this.#db!;
    return new Promise<void>((resolve, reject) => {
      db.run(
        `INSERT INTO client_store (key, value, updated_at)
         VALUES (?, ?, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        [key, Buffer.from(value)],
        function (err) {
          if (err) reject(err);
          else resolve();
        },
      );
    });
  }

  async get(key: string): Promise<Uint8Array | undefined> {
    this.#assertOpen();
    const db = this.#db!;
    return new Promise<Uint8Array | undefined>((resolve, reject) => {
      db.get(
        `SELECT value FROM client_store WHERE key = ?`,
        [key],
        (err, row) => {
          if (err) return reject(err);
          if (row === undefined) return resolve(undefined);
          // SQLite BLOB comes back as a Node.js Buffer.
          // Buffer is a Uint8Array subclass, but callers expect a plain Uint8Array.
          // Use the copy constructor `new Uint8Array(raw)` — NOT the ArrayBuffer view
          // form `new Uint8Array(raw.buffer, byteOffset, byteLength)` which shares the
          // underlying memory. A copy is required so callers cannot mutate stored data.
          const raw = (row as { value: Buffer | Uint8Array }).value;
          resolve(new Uint8Array(raw));
        },
      );
    });
  }

  async delete(key: string): Promise<void> {
    this.#assertOpen();
    const db = this.#db!;
    return new Promise<void>((resolve, reject) => {
      db.run(`DELETE FROM client_store WHERE key = ?`, [key], function (err) {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  async has(key: string): Promise<boolean> {
    this.#assertOpen();
    const db = this.#db!;
    return new Promise<boolean>((resolve, reject) => {
      db.get(
        `SELECT 1 as exists_flag FROM client_store WHERE key = ? LIMIT 1`,
        [key],
        (err, row) => {
          if (err) return reject(err);
          resolve(row !== undefined);
        },
      );
    });
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  #assertOpen(): void {
    if (this.#db === null) {
      throw new Error("SQLCipherClientStore: database is not open. Call open() first.");
    }
  }

  /** Open the SQLite database file. Returns the Database instance on success. */
  async #openDatabase(sqlite3Module: SqlCipherModule): Promise<SqlCipherDatabase> {
    return new Promise<SqlCipherDatabase>((resolve, reject) => {
      // OPEN_CREATE creates the file if absent (first run). On an existing corrupt file,
      // SQLite opens it without error at the OS level; #verifyKey detects the corruption
      // and throws without writing to the file — satisfying DB-001 (never overwrite a
      // corrupt database).
      const mode = sqlite3Module.OPEN_READWRITE | sqlite3Module.OPEN_CREATE;
      const db = new sqlite3Module.Database(this.#dbPath, mode, (err) => {
        if (err) reject(err);
        else resolve(db);
      });
    });
  }

  /**
   * Apply the SQLCipher PRAGMA key using the raw hex format.
   * The key is passed as x'<hex>' which is the SQLCipher raw key format.
   * SI-001: The key hex is used only in the PRAGMA string and never logged.
   * SI-003: Only the `key` PRAGMA is set — no cipher_* weakening PRAGMAs.
   */
  async #applyKey(db: SqlCipherDatabase): Promise<void> {
    const keyHex = Buffer.from(this.#dbKey).toString("hex");
    const pragmaSql = `PRAGMA key = "x'${keyHex}'"`;
    // SI-001: keyHex is used only in the PRAGMA string and is never logged.
    // SI-003: only the `key` PRAGMA is issued — no cipher_* weakening PRAGMAs.

    return new Promise<void>((resolve, reject) => {
      db.run(pragmaSql, [], function (err) {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  /**
   * Verify the PRAGMA key is correct by executing a test query.
   * If the key is wrong or the file is corrupt, this will throw with
   * an error like "SQLITE_NOTADB: file is not a database".
   *
   * DB-001: We do NOT catch and recover here — the error propagates to open()
   * which logs client.store.open.failed and throws, halting the client.
   */
  async #verifyKey(db: SqlCipherDatabase): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      db.get(`SELECT count(*) as c FROM sqlite_master`, [], (err, _row) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  /**
   * Run the custom migration runner.
   *
   * Algorithm:
   *   1. Ensure schema_migrations table exists.
   *   2. Read migration files from migrationsPath matching V{n}__*.sql.
   *   3. Sort by version number.
   *   4. For each file not yet in schema_migrations, run it in a transaction.
   *   5. Record the version in schema_migrations.
   *   6. Log client.store.migration.applied for each applied migration.
   */
  async #runMigrations(db: SqlCipherDatabase): Promise<void> {
    // Bootstrap the migrations table before any migration runs — this is not a migration
    // itself and must not be inside a migration transaction.
    // Step 1: bootstrap the schema_migrations table itself
    await this.#execSql(db,
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         version    TEXT PRIMARY KEY,
         applied_at TEXT NOT NULL DEFAULT (datetime('now'))
       )`,
    );

    // Step 2: read migration files
    const migrationFiles = this.#readMigrationFiles();

    // Step 3: find already-applied migrations
    const appliedVersions = await this.#queryAppliedVersions(db);

    // Step 4-6: apply pending migrations in order
    for (const { filename, version, description } of migrationFiles) {
      if (appliedVersions.has(version)) continue;

      const sql = readFileSync(filename, "utf-8");
      const startTime = Date.now();

      try {
        await this.#applyMigration(db, sql, version);
        const executionTime = Date.now() - startTime;
        this.#logger.info("client.store.migration.applied", {
          version,
          description,
          executionTime,
        });
      } catch (err: unknown) {
        const reason = err instanceof Error ? err.message : String(err);
        this.#logger.error("client.store.migration.failed", {
          version,
          description,
          reason,
        });
        throw err;
      }
    }
  }

  /** Read and sort migration files from the migrations directory. */
  #readMigrationFiles(): Array<{ filename: string; version: string; description: string }> {
    let files: string[];
    try {
      files = readdirSync(this.#migrationsPath);
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(`Cannot read migrations directory '${this.#migrationsPath}': ${reason}`);
    }

    const migrations = files
      .filter((f) => /^V\d+__.*\.sql$/.test(f))
      .map((f) => {
        const match = /^(V(\d+)__(.+))\.sql$/.exec(f);
        if (!match) throw new Error(`Unexpected migration filename: ${f}`);
        return {
          filename: resolve(this.#migrationsPath, f),
          version: match[1],          // e.g. "V1__client_schema"
          versionNum: parseInt(match[2], 10),
          description: match[3].replaceAll("_", " "), // e.g. "client schema"
        };
      })
      .sort((a, b) => a.versionNum - b.versionNum);

    return migrations;
  }

  /** Query the schema_migrations table and return the set of applied version strings. */
  async #queryAppliedVersions(db: SqlCipherDatabase): Promise<Set<string>> {
    return new Promise<Set<string>>((resolve, reject) => {
      db.all(`SELECT version FROM schema_migrations`, [], (err, rows) => {
        if (err) return reject(err);
        const versions = new Set<string>((rows ?? []).map((r) => String((r as { version: string }).version)));
        resolve(versions);
      });
    });
  }

  /**
   * Apply a single migration SQL within a transaction and record it in schema_migrations.
   *
   * Implementation note: db.serialize() enqueues all db.run/db.exec calls synchronously
   * before any callbacks fire, so error recovery inside serialize() is broken — the INSERT
   * and COMMIT are already queued when a ROLLBACK fires. This method uses a linear await
   * chain instead, which gives correct sequencing with real error propagation.
   */
  async #applyMigration(db: SqlCipherDatabase, sql: string, version: string): Promise<void> {
    const run = (stmt: string, params: unknown[] = []): Promise<void> =>
      new Promise<void>((res, rej) =>
        db.run(stmt, params, function (err) {
          if (err) rej(err);
          else res();
        }),
      );
    const exec = (stmt: string): Promise<void> =>
      new Promise<void>((res, rej) =>
        db.exec(stmt, (err) => {
          if (err) rej(err);
          else res();
        }),
      );

    await run("BEGIN");
    try {
      await exec(sql);
      await run(
        `INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, datetime('now'))`,
        [version],
      );
      await run("COMMIT");
    } catch (err) {
      // Best-effort rollback — if ROLLBACK itself fails we still re-throw the original error.
      await run("ROLLBACK").catch(() => {});
      throw err;
    }
  }

  /** Execute a SQL statement with no parameters. */
  async #execSql(db: SqlCipherDatabase, sql: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      db.exec(sql, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
}
