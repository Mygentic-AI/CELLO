#!/usr/bin/env node
/**
 * PERSIST-E2E-001 DB-001 — WAL corruption → RELAY_SESSION_UNRECOVERABLE
 *
 * What this proves:
 *   1. A corrupt WAL entry (bad checksum) causes reconstruct() to return
 *      RELAY_SESSION_UNRECOVERABLE, not a partial leaf array
 *   2. A truncated WAL (partial write at end) also returns RELAY_SESSION_UNRECOVERABLE
 *   3. relay.wal.entry.corrupt and relay.wal.unrecoverable are logged
 *   4. A missing WAL file (no session history) returns [] not RELAY_SESSION_UNRECOVERABLE
 *      (the relay starts fresh — this is not a failure condition)
 *
 * Usage:
 *   node packages/e2e-tests/scripts/test-wal-corruption.mjs
 */

import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHash, randomBytes } from "node:crypto";

function log(msg) { console.log(`[wal-corrupt] ${msg}`); }
function fail(msg) { console.error(`[wal-corrupt] FAIL: ${msg}`); process.exit(1); }
function pass(msg) { console.log(`[wal-corrupt] PASS: ${msg}`); }

// ─── WAL write helpers (same format as file-session-wal.ts) ──────────────────

function serializeLeaf(seq) {
  const entry = {
    seq,
    spk: randomBytes(32).toString("base64"),
    ch: randomBytes(32).toString("base64"),
    ss: randomBytes(64).toString("base64"),
    pr: randomBytes(32).toString("base64"),
    sc: randomBytes(16).toString("base64"),
  };
  return Buffer.from(JSON.stringify(entry), "utf8");
}

function checksum(jsonBytes) {
  return createHash("sha256").update(jsonBytes).digest().subarray(0, 4);
}

function buildWalBuffer(leafCount) {
  const parts = [];
  for (let i = 1; i <= leafCount; i++) {
    const json = serializeLeaf(i);
    const hdr = Buffer.allocUnsafe(4);
    hdr.writeUInt32BE(json.length, 0);
    parts.push(hdr, json, checksum(json));
  }
  return Buffer.concat(parts);
}

// ─── Test cases ──────────────────────────────────────────────────────────────

async function main() {
  log("Starting WAL corruption test (DB-001)");

  const repoRoot = resolve(import.meta.dirname, "../../..");
  const walDir = mkdtempSync(join(tmpdir(), "cello-wal-corrupt-"));

  const { FileSessionWal, RELAY_SESSION_UNRECOVERABLE } = await import(
    `${repoRoot}/packages/relay/dist/adapters/file-session-wal.js`
  );
  const { StdoutLogger } = await import(
    `${repoRoot}/packages/interfaces/dist/stubs/index.js`
  );

  // ── Case 1: Missing WAL file → [] (fresh session, not an error) ──
  log("Case 1: Missing WAL → empty array (fresh session)");
  {
    const logger = new StdoutLogger();
    const wal = new FileSessionWal({ walDir, logger });
    const sessionId = `missing-${randomBytes(4).toString("hex")}`;
    const result = await wal.reconstruct(sessionId);
    if (result === RELAY_SESSION_UNRECOVERABLE) {
      fail("Missing WAL file should return [] not RELAY_SESSION_UNRECOVERABLE");
    }
    if (!Array.isArray(result) || result.length !== 0) {
      fail(`Missing WAL should return [], got: ${JSON.stringify(result)}`);
    }
    pass("Missing WAL returns [] (not an error)");
  }

  // ── Case 2: Valid WAL → correct leaf array ──
  log("Case 2: Valid WAL → correct leaf count");
  {
    const logger = new StdoutLogger();
    const wal = new FileSessionWal({ walDir, logger });
    const sessionId = `valid-${randomBytes(4).toString("hex")}`;
    const walPath = join(walDir, `${sessionId}.wal`);
    writeFileSync(walPath, buildWalBuffer(5));
    const result = await wal.reconstruct(sessionId);
    if (result === RELAY_SESSION_UNRECOVERABLE) {
      fail("Valid WAL returned RELAY_SESSION_UNRECOVERABLE");
    }
    if (result.length !== 5) {
      fail(`Expected 5 leaves from valid WAL, got ${result.length}`);
    }
    pass("Valid WAL reconstructs 5 leaves correctly");
  }

  // ── Case 3: Corrupt checksum on entry 3 → RELAY_SESSION_UNRECOVERABLE ──
  log("Case 3: Corrupt checksum on entry 3 → RELAY_SESSION_UNRECOVERABLE");
  {
    const capturedLogs = [];
    const logger = {
      info: () => {},
      warn: () => {},
      error: (event, ctx) => capturedLogs.push({ event, ctx }),
    };
    const wal = new FileSessionWal({ walDir, logger });
    const sessionId = `corrupt-${randomBytes(4).toString("hex")}`;
    const walPath = join(walDir, `${sessionId}.wal`);

    // Build valid buffer for 5 leaves
    const buf = Buffer.from(buildWalBuffer(5));

    // Locate entry 3 (0-indexed: 2) and flip its checksum bytes
    let offset = 0;
    let entryIdx = 0;
    let checksumOffset = -1;
    while (offset < buf.length && entryIdx < 3) {
      if (offset + 4 > buf.length) break;
      const jsonLen = buf.readUInt32BE(offset);
      offset += 4;
      if (entryIdx === 2) {
        // Checksum starts after the json bytes
        checksumOffset = offset + jsonLen;
        break;
      }
      offset += jsonLen + 4;
      entryIdx++;
    }

    if (checksumOffset < 0) fail("Could not locate entry 3 checksum in WAL buffer");

    // Flip all 4 checksum bytes
    for (let i = 0; i < 4; i++) {
      buf[checksumOffset + i] ^= 0xff;
    }

    writeFileSync(walPath, buf);
    const result = await wal.reconstruct(sessionId);

    if (result !== RELAY_SESSION_UNRECOVERABLE) {
      fail(`Corrupt WAL should return RELAY_SESSION_UNRECOVERABLE, got ${JSON.stringify(result)}`);
    }

    const corruptEvent = capturedLogs.find((l) => l.event === "relay.wal.entry.corrupt");
    if (!corruptEvent) {
      fail("relay.wal.entry.corrupt was not logged");
    }
    const unrecoverableEvent = capturedLogs.find((l) => l.event === "relay.wal.unrecoverable");
    if (!unrecoverableEvent) {
      fail("relay.wal.unrecoverable was not logged");
    }
    pass("Corrupt checksum → RELAY_SESSION_UNRECOVERABLE; relay.wal.entry.corrupt + relay.wal.unrecoverable logged");
  }

  // ── Case 4: Truncated WAL (partial last entry) → RELAY_SESSION_UNRECOVERABLE ──
  log("Case 4: Truncated WAL → RELAY_SESSION_UNRECOVERABLE");
  {
    const capturedLogs = [];
    const logger = {
      info: () => {},
      warn: () => {},
      error: (event, ctx) => capturedLogs.push({ event, ctx }),
    };
    const wal = new FileSessionWal({ walDir, logger });
    const sessionId = `truncated-${randomBytes(4).toString("hex")}`;
    const walPath = join(walDir, `${sessionId}.wal`);

    // Write valid 4 entries then truncate the 5th mid-write
    const full = buildWalBuffer(5);
    const truncated = full.subarray(0, full.length - 10); // chop last 10 bytes
    writeFileSync(walPath, truncated);

    const result = await wal.reconstruct(sessionId);
    if (result !== RELAY_SESSION_UNRECOVERABLE) {
      fail(`Truncated WAL should return RELAY_SESSION_UNRECOVERABLE, got ${JSON.stringify(result)}`);
    }
    const unrecoverable = capturedLogs.find((l) => l.event === "relay.wal.unrecoverable");
    if (!unrecoverable) {
      fail("relay.wal.unrecoverable was not logged for truncated WAL");
    }
    pass("Truncated WAL → RELAY_SESSION_UNRECOVERABLE + relay.wal.unrecoverable logged");
  }

  // ── Cleanup ──
  rmSync(walDir, { recursive: true, force: true });
  log("ALL CHECKS PASSED");
}

main().catch((err) => {
  console.error("[wal-corrupt] Unexpected error:", err);
  process.exit(1);
});
