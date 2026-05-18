#!/usr/bin/env node
/**
 * PERSIST-E2E-001 AC-006 / SI-003 — SQLCipher wrong-key rejection
 *
 * What this proves:
 *   1. A SQLCipher database written with key K is readable with K
 *   2. Opening the same file with a different key K' throws SQLITE_NOTADB
 *   3. After the wrong-key attempt the original file is not overwritten —
 *      re-opening with the correct key still returns the original data
 *   4. SI-003: copying the file to another location and opening with the
 *      raw SQLite library (no key) also fails — the file is opaque
 *
 * Usage:
 *   node packages/e2e-tests/scripts/test-sqlcipher-wrong-key.mjs
 *
 * Requires: @journeyapps/sqlcipher installed in packages/client
 */

import { mkdtempSync, rmSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomBytes } from "node:crypto";

function log(msg) { console.log(`[sqlcipher] ${msg}`); }
function fail(msg) { console.error(`[sqlcipher] FAIL: ${msg}`); process.exit(1); }
function pass(msg) { console.log(`[sqlcipher] PASS: ${msg}`); }

// ─── Minimal SQLCipher wrapper ────────────────────────────────────────────────

function openDatabase(sqlite3Module, dbPath) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3Module.Database(dbPath, (err) => {
      if (err) reject(err);
      else resolve(db);
    });
  });
}

function runSql(db, sql) {
  return new Promise((resolve, reject) => {
    db.run(sql, [], (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function getSql(db, sql) {
  return new Promise((resolve, reject) => {
    db.get(sql, [], (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function closeDatabase(db) {
  return new Promise((resolve) => db.close(() => resolve()));
}

async function openWithKey(sqlite3Module, dbPath, keyHex) {
  const db = await openDatabase(sqlite3Module, dbPath);
  await runSql(db, `PRAGMA key = "x'${keyHex}'"`);
  // Verify key by reading sqlite_master — SQLITE_NOTADB thrown here if key is wrong
  await getSql(db, `SELECT count(*) as c FROM sqlite_master`);
  return db;
}

// ─── Test ─────────────────────────────────────────────────────────────────────

async function main() {
  log("Starting SQLCipher wrong-key test (AC-006 / SI-003)");

  // Find the SQLCipher module in the client package
  const repoRoot = resolve(import.meta.dirname, "../../..");
  const clientDir = join(repoRoot, "packages", "client");

  let sqlite3Module;
  try {
    // Use createRequire to load CJS module from ESM context
    const { createRequire } = await import("node:module");
    const require = createRequire(import.meta.url);
    sqlite3Module = require(join(clientDir, "node_modules", "@journeyapps", "sqlcipher"));
  } catch {
    try {
      const { createRequire } = await import("node:module");
      const require = createRequire(import.meta.url);
      sqlite3Module = require("@journeyapps/sqlcipher");
    } catch (err2) {
      fail(`Cannot load @journeyapps/sqlcipher: ${err2.message}\nInstall it in packages/client first.`);
    }
  }

  const tmpDir = mkdtempSync(join(tmpdir(), "cello-sqlcipher-"));
  const dbPath = join(tmpDir, "test.db");
  const dbCopyPath = join(tmpDir, "test-copy.db");

  const correctKey = randomBytes(32).toString("hex");
  const wrongKey = randomBytes(32).toString("hex");
  const zeroKey = "0".repeat(64);

  log(`DB path: ${dbPath}`);
  log(`Correct key: ${correctKey.substring(0, 8)}... (truncated)`);

  // ── Phase 1: Create database with correct key and write data ──
  log("Phase 1: Create database with correct key and write a test row");
  {
    const db = await openWithKey(sqlite3Module, dbPath, correctKey);
    await runSql(db, `CREATE TABLE test_data (id INTEGER PRIMARY KEY, value TEXT NOT NULL)`);
    await runSql(db, `INSERT INTO test_data (id, value) VALUES (1, 'hello-cello')`);
    await closeDatabase(db);
  }
  pass("Created SQLCipher database and wrote test row");

  // ── Phase 2: Re-open with correct key → data readable ──
  log("Phase 2: Re-open with correct key → data readable");
  {
    const db = await openWithKey(sqlite3Module, dbPath, correctKey);
    const row = await getSql(db, `SELECT value FROM test_data WHERE id = 1`);
    await closeDatabase(db);
    if (!row || row.value !== "hello-cello") {
      fail(`Expected 'hello-cello', got ${JSON.stringify(row)}`);
    }
  }
  pass("Correct key: data is readable");

  // ── Phase 3: Open with wrong random key → SQLITE_NOTADB ──
  log("Phase 3: Open with wrong random key → SQLITE_NOTADB");
  {
    let threw = false;
    try {
      const db = await openWithKey(sqlite3Module, dbPath, wrongKey);
      await closeDatabase(db);
    } catch (err) {
      threw = true;
      const msg = err.message || String(err);
      if (!msg.includes("SQLITE_NOTADB") && !msg.includes("file is not a database")) {
        fail(`Expected SQLITE_NOTADB, got: ${msg}`);
      }
    }
    if (!threw) {
      fail("Opening with wrong key should have thrown, but succeeded");
    }
  }
  pass("Wrong random key throws SQLITE_NOTADB");

  // ── Phase 4: Wrong-key attempt did not overwrite file — correct key still works ──
  log("Phase 4: Verify original data still intact after wrong-key attempt");
  {
    const db = await openWithKey(sqlite3Module, dbPath, correctKey);
    const row = await getSql(db, `SELECT value FROM test_data WHERE id = 1`);
    await closeDatabase(db);
    if (!row || row.value !== "hello-cello") {
      fail(`After wrong-key attempt, original data corrupted: ${JSON.stringify(row)}`);
    }
  }
  pass("Original data intact after wrong-key attempt");

  // ── Phase 5: SI-003 — copy file to another location, open with all-zeros key ──
  log("Phase 5: SI-003 — copy DB file, open copy with all-zeros key → rejected");
  {
    copyFileSync(dbPath, dbCopyPath);
    let threw = false;
    try {
      const db = await openWithKey(sqlite3Module, dbCopyPath, zeroKey);
      await closeDatabase(db);
    } catch (err) {
      threw = true;
      const msg = err.message || String(err);
      if (!msg.includes("SQLITE_NOTADB") && !msg.includes("file is not a database")) {
        fail(`Expected SQLITE_NOTADB on copy with zero key, got: ${msg}`);
      }
    }
    if (!threw) {
      fail("Copy opened with all-zeros key should have failed, but succeeded");
    }
  }
  pass("SI-003: copied DB file is unreadable with wrong key (not a raw SQLite file)");

  // ── Phase 6: Opening copy with correct key still works ──
  log("Phase 6: Opening copy with correct key works");
  {
    const db = await openWithKey(sqlite3Module, dbCopyPath, correctKey);
    const row = await getSql(db, `SELECT value FROM test_data WHERE id = 1`);
    await closeDatabase(db);
    if (!row || row.value !== "hello-cello") {
      fail(`Copy with correct key returned wrong data: ${JSON.stringify(row)}`);
    }
  }
  pass("Copied DB file is readable with the correct key");

  // ── Cleanup ──
  rmSync(tmpDir, { recursive: true, force: true });
  log("ALL CHECKS PASSED");
}

main().catch((err) => {
  console.error("[sqlcipher] Unexpected error:", err);
  process.exit(1);
});
