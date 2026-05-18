#!/usr/bin/env node
/**
 * PERSIST-E2E-001 SI-006 — EnvelopeKeyProvider failure blocks K_server_X INSERT
 *
 * What this proves:
 *   1. When EnvelopeKeyProvider.encrypt() throws, storeShare() throws before INSERT
 *   2. key.encrypted.failed is logged with { keyId, agentId } — no plaintext
 *   3. The agent_key_shares table has no row after the failed attempt
 *   4. When the provider returns a ciphertext with wrong length (structural check),
 *      the INSERT is also blocked
 *   5. On encrypt success, the row IS inserted (positive control)
 *
 * Usage:
 *   DATABASE_URL="postgresql://postgres:dev@localhost:5433/cello_dev" \
 *   node packages/e2e-tests/scripts/test-kms-failure-blocks-insert.mjs
 *
 * Requires: running Postgres at DATABASE_URL
 */

import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import pg from "pg";

function log(msg) { console.log(`[kms-failure] ${msg}`); }
function fail(msg) { console.error(`[kms-failure] FAIL: ${msg}`); process.exit(1); }
function pass(msg) { console.log(`[kms-failure] PASS: ${msg}`); }

const DATABASE_URL =
  process.env["DATABASE_URL"] ?? "postgresql://postgres:dev@localhost:5433/cello_dev";

const repoRoot = resolve(import.meta.dirname, "../../..");

async function main() {
  log("Starting KMS failure blocks INSERT test (SI-006)");

  // Load EncryptedPgShareStore from built directory package
  const { EncryptedPgShareStore } = await import(
    `${repoRoot}/packages/directory/dist/encrypted-share-store.js`
  );

  const pool = new pg.Pool({ connectionString: DATABASE_URL });

  // Verify DB is reachable
  try {
    await pool.query("SELECT 1");
  } catch (err) {
    await pool.end();
    fail(`Cannot connect to Postgres at ${DATABASE_URL}: ${err.message}`);
  }

  const agentId = `test-agent-${randomBytes(8).toString("hex")}`;
  const epochId = "epoch-0";
  const shareBytes = randomBytes(32);

  // ── Case 1: Provider throws on encrypt → INSERT blocked ──
  log("Case 1: provider.encrypt() throws → INSERT blocked + key.encrypted.failed logged");
  {
    const capturedLogs = [];
    const logger = {
      info: () => {},
      warn: () => {},
      error: (event, err, ctx) => capturedLogs.push({ event, ctx }),
    };

    const failingProvider = {
      async encrypt() { throw new Error("KMS unavailable — simulated failure"); },
      async decrypt() { throw new Error("KMS unavailable"); },
      async rotate() {},
    };

    const store = new EncryptedPgShareStore(pool, failingProvider, logger);

    let threw = false;
    try {
      await store.storeShare(agentId, epochId, shareBytes);
    } catch {
      threw = true;
    }

    if (!threw) {
      fail("storeShare() should have thrown when provider.encrypt() fails");
    }

    // Verify key.encrypted.failed was logged
    const failedLog = capturedLogs.find((l) => l.event === "key.encrypted.failed");
    if (!failedLog) {
      fail("key.encrypted.failed was not logged when provider throws");
    }
    // Verify no plaintext in the log context
    const ctxStr = JSON.stringify(failedLog.ctx ?? {});
    const shareBytesBase64 = Buffer.from(shareBytes).toString("base64");
    const shareBytesHex = Buffer.from(shareBytes).toString("hex");
    if (ctxStr.includes(shareBytesBase64) || ctxStr.includes(shareBytesHex)) {
      fail("SI-001: plaintext share bytes appeared in key.encrypted.failed log context");
    }
    pass("key.encrypted.failed logged with no plaintext share bytes");

    // Verify no row was inserted
    const result = await pool.query(
      `SELECT id FROM agent_key_shares WHERE agent_id = $1 AND epoch_id = $2`,
      [agentId, epochId],
    );
    if (result.rows.length > 0) {
      fail("agent_key_shares row exists after failed encrypt — INSERT was not blocked");
    }
    pass("Case 1: no row inserted when provider.encrypt() throws");
  }

  // ── Case 2: Provider returns wrong-length ciphertext → structural check blocks INSERT ──
  log("Case 2: provider returns wrong-length ciphertext → structural check blocks INSERT");
  {
    const capturedLogs = [];
    const logger = {
      info: () => {},
      warn: () => {},
      error: (event, err, ctx) => capturedLogs.push({ event, ctx }),
    };

    const badLengthProvider = {
      // Returns 1 byte instead of plaintext + 28 (the AES-256-GCM overhead)
      async encrypt() { return new Uint8Array([0x42]); },
      async decrypt() { throw new Error("not needed"); },
      async rotate() {},
    };

    const store = new EncryptedPgShareStore(pool, badLengthProvider, logger);

    let threw = false;
    try {
      await store.storeShare(`${agentId}-b`, epochId, shareBytes);
    } catch {
      threw = true;
    }

    if (!threw) {
      fail("storeShare() should have thrown on wrong-length ciphertext");
    }

    const failedLog = capturedLogs.find((l) => l.event === "key.encrypted.failed");
    if (!failedLog) {
      fail("key.encrypted.failed was not logged for structural check failure");
    }

    const result = await pool.query(
      `SELECT id FROM agent_key_shares WHERE agent_id = $1 AND epoch_id = $2`,
      [`${agentId}-b`, epochId],
    );
    if (result.rows.length > 0) {
      fail("agent_key_shares row exists after structural check failure");
    }
    pass("Case 2: no row inserted on wrong-length ciphertext; key.encrypted.failed logged");
  }

  // ── Case 3: Working provider → row IS inserted (positive control) ──
  log("Case 3: working provider → INSERT succeeds (positive control)");
  {
    const capturedLogs = [];
    const logger = {
      info: (event, ctx) => capturedLogs.push({ event, ctx }),
      warn: () => {},
      error: () => {},
    };

    const DEV_KEY = process.env["DEV_ENVELOPE_KEY"] ?? "0".repeat(64);
    const { LocalEnvelopeKeyProvider } = await import(
      `${repoRoot}/packages/interfaces/dist/stubs/index.js`
    );
    const provider = new LocalEnvelopeKeyProvider(DEV_KEY, logger);
    const store = new EncryptedPgShareStore(pool, provider, logger);

    await store.storeShare(`${agentId}-c`, epochId, shareBytes);

    const result = await pool.query(
      `SELECT id FROM agent_key_shares WHERE agent_id = $1 AND epoch_id = $2`,
      [`${agentId}-c`, epochId],
    );
    if (result.rows.length === 0) {
      fail("Row was not inserted with working provider");
    }
    const encryptedLog = capturedLogs.find((l) => l.event === "key.encrypted");
    if (!encryptedLog) {
      fail("key.encrypted was not logged on successful store");
    }
    pass("Case 3: row inserted and key.encrypted logged with working provider");

    // Cleanup test row
    await pool.query(
      `DELETE FROM agent_key_shares WHERE agent_id = $1`,
      [`${agentId}-c`],
    );
  }

  await pool.end();
  log("ALL CHECKS PASSED");
}

main().catch(async (err) => {
  console.error("[kms-failure] Unexpected error:", err);
  process.exit(1);
});
