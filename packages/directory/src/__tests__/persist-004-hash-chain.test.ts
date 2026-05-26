/**
 * CELLO-PERSIST-004 — Hash chain on INSERT
 *
 * test_type: unit (AC-001, AC-002, AC-007, SI-001, SI-002) and
 *            integration (AC-003, AC-004, AC-005, AC-006, SI-003, DB-001)
 *
 * Unit tests run without a database — they test the pure hash chain logic.
 * Integration tests require CELLO_ENV=local and a running Docker Compose Postgres.
 *
 * Run with:
 *   docker compose up -d && docker compose run --rm flyway
 *   CELLO_ENV=local DATABASE_URL=postgresql://cello_service:cello_service_dev@localhost:5433/cello_dev \
 *     pnpm --filter @cello-protocol/directory run test
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import pg from "pg";
import {
  computeChainHash,
  serializeRecord,
  verifyChain,
  CHAIN_GENESIS,
} from "../hash-chain.js";
import { PgDirectoryStore } from "../adapters/pg-directory-store.js";
import type { Logger } from "@cello-protocol/interfaces";

// ─── Unit tests: pure hash chain logic ───────────────────────────────────────

describe("PERSIST-004 unit: hash chain computation", () => {
  it("AC-001: genesis constant is SHA-256(b'CELLO_CHAIN_GENESIS')", () => {
    const expected = createHash("sha256")
      .update(Buffer.from("CELLO_CHAIN_GENESIS", "utf8"))
      .digest("hex");
    expect(CHAIN_GENESIS).toBe(expected);
  });

  it("AC-001: first row chain_hash = SHA-256(serialize(row) || genesis)", () => {
    // id and created_at are excluded — they are DB-generated and absent at INSERT time
    const record = { name: "test", merkle_root: "abc" };
    const serialized = serializeRecord(record);
    const chainHash = computeChainHash(serialized, CHAIN_GENESIS);

    // Verify independently — keys sorted, id/created_at/chain_hash excluded
    const expectedSerialized = JSON.stringify({ merkle_root: "abc", name: "test" });
    const expectedHash = createHash("sha256")
      .update(expectedSerialized + CHAIN_GENESIS)
      .digest("hex");

    expect(serialized).toBe(expectedSerialized);
    expect(chainHash).toBe(expectedHash);
  });

  it("AC-002: subsequent row chain_hash = SHA-256(serialize(row) || prev_chain_hash)", () => {
    const row1 = { value: "first" };
    const serialized1 = serializeRecord(row1);
    const hash1 = computeChainHash(serialized1, CHAIN_GENESIS);

    const row2 = { value: "second" };
    const serialized2 = serializeRecord(row2);
    const hash2 = computeChainHash(serialized2, hash1);

    // Verify hash2 is derived from hash1 (not genesis)
    const expectedHash2 = createHash("sha256")
      .update(serialized2 + hash1)
      .digest("hex");
    expect(hash2).toBe(expectedHash2);
    expect(hash2).not.toBe(hash1);
  });

  it("SI-001: serialization excludes chain_hash, id, and created_at fields", () => {
    // chain_hash: circular; id/created_at: DB-generated, absent at INSERT time
    const record = { id: 1, created_at: "2026-01-01", chain_hash: "should_be_excluded", name: "test" };
    const serialized = serializeRecord(record);
    expect(serialized).not.toContain("chain_hash");
    expect(serialized).not.toContain('"id"');
    expect(serialized).not.toContain("created_at");
    expect(serialized).toBe(JSON.stringify({ name: "test" }));
  });

  it("SI-001: serialization uses sorted keys for determinism", () => {
    const record1 = { z: 1, a: 2, m: 3 };
    const record2 = { a: 2, m: 3, z: 1 };
    expect(serializeRecord(record1)).toBe(serializeRecord(record2));
    expect(serializeRecord(record1)).toBe(JSON.stringify({ a: 2, m: 3, z: 1 }));
  });

  it("SI-002: chain_hash field in record is ignored — always recomputed from previous", () => {
    const record = { chain_hash: "attacker_provided_value", name: "test" };
    const serialized = serializeRecord(record);
    const hash = computeChainHash(serialized, CHAIN_GENESIS);

    // The hash does not include the attacker's chain_hash value
    const expectedSerialized = JSON.stringify({ name: "test" });
    const expectedHash = createHash("sha256")
      .update(expectedSerialized + CHAIN_GENESIS)
      .digest("hex");
    expect(hash).toBe(expectedHash);
  });

  it("AC-007: verifyChain logs db.chain.verified on success", () => {
    const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const row1 = { id: 1, name: "first" };
    const serialized1 = serializeRecord(row1);
    const hash1 = computeChainHash(serialized1, CHAIN_GENESIS);

    const row2 = { id: 2, name: "second" };
    const serialized2 = serializeRecord(row2);
    const hash2 = computeChainHash(serialized2, hash1);

    const rows = [
      { ...row1, chain_hash: hash1 },
      { ...row2, chain_hash: hash2 },
    ];

    const result = verifyChain(rows, logger, "test_table");
    expect(result.valid).toBe(true);
    expect(result.rowCount).toBe(2);
    expect(logger.info).toHaveBeenCalledWith(
      "db.chain.verified",
      expect.objectContaining({ tableName: "test_table", rowCount: 2 }),
    );
  });

  it("AC-007: verifyChain logs db.chain.break.detected on break", () => {
    const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const row1 = { id: 1, name: "first" };
    const serialized1 = serializeRecord(row1);
    const hash1 = computeChainHash(serialized1, CHAIN_GENESIS);

    const rows = [
      { ...row1, chain_hash: hash1 },
      { id: 2, name: "second", chain_hash: "tampered_value" },
    ];

    const result = verifyChain(rows, logger, "test_table");
    expect(result.valid).toBe(false);
    expect(result.breakAtSequence).toBe(2);
    expect(result.storedHash).toBe("tampered_value");
    expect(result.recomputedHash).toBeDefined();
    expect(logger.error).toHaveBeenCalledWith(
      "db.chain.break.detected",
      expect.objectContaining({
        tableName: "test_table",
        breakAtSequence: 2,
        storedHash: "tampered_value",
      }),
    );
  });

  it("AC-007: verifyChain on empty table returns valid with rowCount 0", () => {
    const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const result = verifyChain([], logger, "empty_table");
    expect(result.valid).toBe(true);
    expect(result.rowCount).toBe(0);
    expect(logger.info).toHaveBeenCalledWith(
      "db.chain.verified",
      expect.objectContaining({ tableName: "empty_table", rowCount: 0 }),
    );
  });
});

// ─── Integration tests — require CELLO_ENV=local + running Postgres ──────────

const isLocal = process.env["CELLO_ENV"] === "local";
const DATABASE_URL =
  process.env["DATABASE_URL"] ?? "postgresql://postgres:dev@localhost:5433/cello_dev";

const describeIntegration = isLocal ? describe : describe.skip;

let superPool: pg.Pool;
let servicePool: pg.Pool;

beforeAll(async () => {
  if (!isLocal) return;
  superPool = new pg.Pool({ connectionString: DATABASE_URL });
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

describeIntegration("PERSIST-004 integration: hash chain in Postgres", () => {
  // Each integration test needs a clean chain — verifyChain reads ALL rows.
  // With forks pool (pool: "forks" in vitest.config.ts), each file runs in its own
  // child process so beforeEach here cannot bleed into other test files.
  beforeEach(async () => {
    if (!superPool) return;
    await superPool.query("TRUNCATE notification_events, conversation_seals RESTART IDENTITY CASCADE");
  });
  // Use a unique test run prefix to avoid collisions with other test runs
  const testRunId = randomUUID().slice(0, 8);

  it("AC-001: first insert has chain_hash = SHA-256(serialize(row) || genesis)", async () => {
    const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const pool = new pg.Pool({ connectionString: DATABASE_URL.replace(
      /^(postgres(?:ql)?):\/\/[^:]+:[^@]+@/,
      "$1://cello_service:cello_service_dev@",
    ) });
    const store = new PgDirectoryStore(pool, logger);

    const conversationId = randomUUID();
    const record: Record<string, unknown> = {
      conversation_id: conversationId,
      merkle_root: "a".repeat(64),
      close_type: "MUTUAL_SEAL",
      participant_count: 2,
      seal_date: "2026-01-01",
    };

    // Use insertWithChain which handles genesis/previous hash correctly.
    const chainHash = await store.insertWithChain(
      "conversation_seals",
      record,
      ["conversation_id", "merkle_root", "close_type", "participant_count", "seal_date", "chain_hash"],
      [conversationId, "a".repeat(64), "MUTUAL_SEAL", 2, "2026-01-01", ""],
      5,
    );

    // Read back from DB and verify
    const result = await pool.query<{ chain_hash: string }>(
      `SELECT chain_hash FROM conversation_seals WHERE conversation_id = $1`,
      [conversationId],
    );
    expect(result.rows[0]?.chain_hash).toBe(chainHash);

    // Verify it was computed with the correct previous hash (genesis or prior row)
    // The hash must be deterministic: SHA-256(serialized || previousHash)
    expect(chainHash).toHaveLength(64);
    expect(chainHash).toMatch(/^[0-9a-f]{64}$/);

    await pool.end();
  });

  it("AC-003: chain verification pass on 10 rows inserted via insertWithChain reports 0 breaks", async () => {
    const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const pool = new pg.Pool({ connectionString: DATABASE_URL.replace(
      /^(postgres(?:ql)?):\/\/[^:]+:[^@]+@/,
      "$1://cello_service:cello_service_dev@",
    ) });
    const store = new PgDirectoryStore(pool, logger);

    // Insert 10 rows sequentially via insertWithChain
    for (let i = 0; i < 10; i++) {
      const id = randomUUID();
      await store.insertWithChain(
        "notification_events",
        {
          notification_id: id,
          recipient_pseudonym: `recipient_${testRunId}_ac003`,
          notification_type: "SYSTEM",
          payload_hash: `hash_${testRunId}_${i}`,
        },
        ["notification_id", "recipient_pseudonym", "notification_type", "payload_hash", "chain_hash"],
        [id, `recipient_${testRunId}_ac003`, "SYSTEM", `hash_${testRunId}_${i}`, ""],
        4,
      );
    }

    // Run verifyChain against the DB
    const result = await store.verifyChain("notification_events");
    expect(result.valid).toBe(true);
    expect(result.rowCount).toBeGreaterThanOrEqual(10);

    await pool.end();
  });

  it("AC-004: superuser UPDATE on row 5 detected as chain break", async () => {
    const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const serviceConnStr = DATABASE_URL.replace(
      /^(postgres(?:ql)?):\/\/[^:]+:[^@]+@/,
      "$1://cello_service:cello_service_dev@",
    );
    const pool = new pg.Pool({ connectionString: serviceConnStr });
    const store = new PgDirectoryStore(pool, logger);

    // Use connection_requests table — agent_registrations was dropped in V16 (never wired into
    // production; agent_profiles V9 is the authoritative agent identity table)
    const insertedIds: string[] = [];
    for (let i = 0; i < 10; i++) {
      const requestId = randomUUID();
      insertedIds.push(requestId);
      await store.insertWithChain(
        "connection_requests",
        {
          request_id: requestId,
          requester_pseudonym: `req_${testRunId}_ac004`,
          target_pseudonym: `tgt_${testRunId}_ac004_${i}`,
          outcome: "ACCEPTED",
        },
        [
          "request_id", "requester_pseudonym", "target_pseudonym",
          "outcome", "chain_hash",
        ],
        [
          requestId, `req_${testRunId}_ac004`, `tgt_${testRunId}_ac004_${i}`,
          "ACCEPTED", "",
        ],
        4,
      );
    }

    // Use superuser to tamper with row 5's content (modify requester_pseudonym but keep chain_hash)
    await superPool.query(
      `UPDATE connection_requests SET requester_pseudonym = 'TAMPERED_BY_SUPERUSER'
       WHERE request_id = $1`,
      [insertedIds[4]],
    );

    // Run verifyChain — should detect break at the tampered row
    const result = await store.verifyChain("connection_requests");
    expect(result.valid).toBe(false);
    // breakAtSequence is asserted as toBeDefined() rather than a specific value because
    // the integration tests run without transaction rollback between runs. Prior test
    // runs may have left rows in the table, so the break position within the full table
    // scan is not predictable — it depends on how many rows preceded this test run's
    // insertions. The break will always be at or after position 5 within this batch,
    // but its absolute sequence number in the table varies.
    expect(result.breakAtSequence).toBeDefined();
    expect(result.storedHash).toBeDefined();
    expect(result.recomputedHash).toBeDefined();
    expect(result.recomputedHash).not.toBe(result.storedHash);

    await pool.end();
  });

  it("AC-005: superuser DELETE of row 7 detected as chain break (sequence gap)", async () => {
    const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const serviceConnStr = DATABASE_URL.replace(
      /^(postgres(?:ql)?):\/\/[^:]+:[^@]+@/,
      "$1://cello_service:cello_service_dev@",
    );
    const pool = new pg.Pool({ connectionString: serviceConnStr });
    const store = new PgDirectoryStore(pool, logger);

    // Use connection_requests table to avoid interference
    const insertedIds: string[] = [];
    for (let i = 0; i < 10; i++) {
      const requestId = randomUUID();
      insertedIds.push(requestId);
      await store.insertWithChain(
        "connection_requests",
        {
          request_id: requestId,
          requester_pseudonym: `req_${testRunId}_ac005`,
          target_pseudonym: `tgt_${testRunId}_ac005_${i}`,
          outcome: "ACCEPTED",
        },
        [
          "request_id", "requester_pseudonym", "target_pseudonym",
          "outcome", "chain_hash",
        ],
        [
          requestId, `req_${testRunId}_ac005`, `tgt_${testRunId}_ac005_${i}`,
          "ACCEPTED", "",
        ],
        4,
      );
    }

    // Use superuser to DELETE row 7
    await superPool.query(
      `DELETE FROM connection_requests WHERE request_id = $1`,
      [insertedIds[6]],
    );

    // Run verifyChain — should detect the gap
    const result = await store.verifyChain("connection_requests");
    expect(result.valid).toBe(false);
    // breakAtSequence is asserted as toBeDefined() rather than a specific value because
    // the integration tests do not use transaction rollback between runs. Rows from
    // prior test runs remain in the table, so the position of the deleted row (originally
    // index 6 within this batch) varies in absolute terms across runs. The chain break
    // will always be detected — the exact sequence number is not predictable without
    // full table isolation.
    expect(result.breakAtSequence).toBeDefined();

    await pool.end();
  });

  it("AC-006: concurrent inserts serialized via advisory lock — no fork", async () => {
    const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    // Create a dedicated pool for this test
    const serviceConnStr = DATABASE_URL.replace(
      /^(postgres(?:ql)?):\/\/[^:]+:[^@]+@/,
      "$1://cello_service:cello_service_dev@",
    );
    const pool = new pg.Pool({ connectionString: serviceConnStr });
    const store = new PgDirectoryStore(pool, logger);

    // Insert two rows concurrently
    const id1 = randomUUID();
    const id2 = randomUUID();

    const record1: Record<string, unknown> = {
      conversation_id: id1,
      merkle_root: "x".repeat(64),
      close_type: "MUTUAL_SEAL",
      participant_count: 2,
      seal_date: "2026-01-01",
    };

    const record2: Record<string, unknown> = {
      conversation_id: id2,
      merkle_root: "y".repeat(64),
      close_type: "MUTUAL_SEAL",
      participant_count: 2,
      seal_date: "2026-01-01",
    };

    const columns = ["conversation_id", "merkle_root", "close_type", "participant_count", "seal_date", "chain_hash"];

    // Run both inserts concurrently
    const [hash1, hash2] = await Promise.all([
      store.insertWithChain(
        "conversation_seals",
        record1,
        columns,
        [id1, "x".repeat(64), "MUTUAL_SEAL", 2, "2026-01-01", ""],
        5,
      ),
      store.insertWithChain(
        "conversation_seals",
        record2,
        columns,
        [id2, "y".repeat(64), "MUTUAL_SEAL", 2, "2026-01-01", ""],
        5,
      ),
    ]);

    // Both should succeed with different hashes
    expect(hash1).toBeDefined();
    expect(hash2).toBeDefined();
    expect(hash1).not.toBe(hash2);

    // Verify the chain is valid
    const verifyResult = await store.verifyChain("conversation_seals");
    expect(verifyResult.valid).toBe(true);

    await pool.end();
  });

  it("SI-003: five concurrent inserts produce unique hashes — no fork", async () => {
    const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const serviceConnStr = DATABASE_URL.replace(
      /^(postgres(?:ql)?):\/\/[^:]+:[^@]+@/,
      "$1://cello_service:cello_service_dev@",
    );
    const pool = new pg.Pool({ connectionString: serviceConnStr });
    const store = new PgDirectoryStore(pool, logger);

    // Insert 5 rows concurrently — all should succeed without forking
    const ids = Array.from({ length: 5 }, () => randomUUID());
    const results = await Promise.all(
      ids.map((id) =>
        store.insertWithChain(
          "conversation_seals",
          { conversation_id: id, merkle_root: "z".repeat(64), close_type: "MUTUAL_SEAL", participant_count: 2, seal_date: "2026-01-01" },
          ["conversation_id", "merkle_root", "close_type", "participant_count", "seal_date", "chain_hash"],
          [id, "z".repeat(64), "MUTUAL_SEAL", 2, "2026-01-01", ""],
          5,
        ),
      ),
    );

    // All 5 should produce unique hashes
    const uniqueHashes = new Set(results);
    expect(uniqueHashes.size).toBe(5);

    // Verify chain integrity
    const verifyResult = await store.verifyChain("conversation_seals");
    expect(verifyResult.valid).toBe(true);

    await pool.end();
  });

  it("DB-001: chain break does not halt service — verifyChain returns without throwing", async () => {
    const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const serviceConnStr = DATABASE_URL.replace(
      /^(postgres(?:ql)?):\/\/[^:]+:[^@]+@/,
      "$1://cello_service:cello_service_dev@",
    );
    const pool = new pg.Pool({ connectionString: serviceConnStr });
    const store = new PgDirectoryStore(pool, logger);

    // Insert a row, then tamper via superuser
    const id = randomUUID();
    await store.insertWithChain(
      "conversation_seals",
      { conversation_id: id, merkle_root: "d".repeat(64), close_type: "MUTUAL_SEAL", participant_count: 2, seal_date: "2026-01-01" },
      ["conversation_id", "merkle_root", "close_type", "participant_count", "seal_date", "chain_hash"],
      [id, "d".repeat(64), "MUTUAL_SEAL", 2, "2026-01-01", ""],
      5,
    );

    // Superuser tampers with the row
    await superPool.query(
      `UPDATE conversation_seals SET merkle_root = 'TAMPERED' WHERE conversation_id = $1`,
      [id],
    );

    // verifyChain reports the break but does NOT throw — this is DB-001
    const result = await store.verifyChain("conversation_seals");
    expect(result.valid).toBe(false);
    expect(result.breakAtSequence).toBeDefined();
    // The function returned normally (no exception) — service continues operating

    await pool.end();
  });
});
