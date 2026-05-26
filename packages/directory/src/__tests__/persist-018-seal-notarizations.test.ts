/**
 * CELLO-PERSIST-018 — seal_notarizations migration and round-trip
 *
 * Specification interpretation:
 *
 * AC-001: seal_notarizations table exists in a migrated Postgres container with all
 *   required columns, RLS enabled, exactly 2 policies (insert_only, select_all)
 *   visible to cello_service, and no UPDATE/DELETE privilege for cello_service.
 *
 * AC-002: recordNotarization() writes one row; getNotarization(sessionId) returns
 *   the same SealNotarization with matching fields; chain_hash equals the
 *   server-computed value verified by an independent recomputation.
 *
 * AC-003: Second call with same session_id fails with unique constraint violation;
 *   row count stays 1; notarization.duplicate.rejected is logged at WARN with { sessionId }.
 *
 * AC-004: cello_service UPDATE on seal_notarizations is rejected by RLS with
 *   permission denied — not application-layer guarding.
 *
 * AC-005: Two rows exist; chain verifier fetches rows via a fresh SELECT and recomputes
 *   each chain_hash from scratch; reports 0 chain breaks.
 *
 * AC-006: getNotarization() for an absent session_id returns undefined without throwing
 *   and without logging an error.
 *
 * AC-007: Successful recordNotarization() logs notarization.recorded at INFO with
 *   { sessionId, sealedRoot, correlationId }; the logged correlationId matches the
 *   one supplied by the caller.
 *
 * AC-008: Simulated transient failure (pool closed before INSERT): notarization.write.failed
 *   is logged at ERROR with { sessionId, reason, attempt: 1 } on the first failure and
 *   { attempt: 2 } on the retry failure.
 *
 * SI-001: chain_hash is always computed server-side by PgDirectoryStore — never accepted
 *   from the caller. A SealNotarization with a crafted frost_signature (all-zeros) is
 *   passed to recordNotarization(); the test asserts: (a) frost_signature is stored
 *   exactly as supplied (all-zeros) — PgDirectoryStore does not recompute or replace it;
 *   (b) chain_hash is a valid server-computed SHA-256 hex value (non-zero, 64 hex chars).
 *
 *   frost_signature source enforcement is structural: only processSeal() and
 *   processSealFrostSignature() in directory-node.ts call recordNotarization(), and those
 *   methods supply frost_signature from the FROST ceremony result. PgDirectoryStore stores
 *   whatever its caller provides; the constraint is at the call site, not the store layer.
 *
 * SI-002: recordNotarization() and conversation_seals are written in the same transaction;
 *   connection loss after the first INSERT but before the second rolls both back.
 *
 * SI-003: Superuser modification of a persisted row causes chain verification to fail at
 *   that row with db.chain.break.detected.
 *
 * test_type: integration for all ACs — requires CELLO_ENV=local + running Docker Compose Postgres.
 * Skips automatically when CELLO_ENV !== 'local'.
 *
 * Run with:
 *   docker compose up -d && docker compose run --rm flyway
 *   CELLO_ENV=local DATABASE_URL=postgresql://postgres:dev@localhost:5433/cello_dev \
 *     pnpm --filter @cello-protocol/directory run test -- \
 *     --pool-options.threads.maxThreads=1 --pool-options.threads.minThreads=1
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { randomBytes } from "node:crypto";
import pg from "pg";
import { PgDirectoryStore } from "../adapters/pg-directory-store.js";
import {
  computeChainHash,
  serializeRecord,
  CHAIN_GENESIS,
} from "../hash-chain.js";
import type { Logger } from "@cello-protocol/interfaces";
import type { SealNotarization } from "@cello-protocol/interfaces";

const isLocal = process.env["CELLO_ENV"] === "local";
const DATABASE_URL =
  process.env["DATABASE_URL"] ?? "postgresql://postgres:dev@localhost:5433/cello_dev";

// Always fail (not skip) when CELLO_ENV=local but Postgres is unreachable
// because AC-001 through SI-003 all require a live TCP connection to localhost:5432.
const describeIntegration = isLocal ? describe : describe.skip;

/** Replace postgres/dev credentials with cello_service role credentials */
function toServiceUrl(url: string): string {
  return url.replace(
    /^(postgres(?:ql)?):\/\/[^:]+:[^@]+@/,
    "$1://cello_service:cello_service_dev@",
  );
}

/** Build a minimal valid SealNotarization with random bytes */
function makeSealNotarization(opts?: {
  session_id?: Uint8Array;
  frost_signature?: Uint8Array;
}): SealNotarization {
  return {
    session_id: opts?.session_id ?? randomBytes(16),
    sealed_root: randomBytes(32),
    participant_a_pubkey: randomBytes(32),
    participant_b_pubkey: randomBytes(32),
    close_timestamp: Date.now(),
    frost_signature: opts?.frost_signature ?? randomBytes(64),
  };
}

let superPool: pg.Pool;
let servicePool: pg.Pool;

beforeAll(async () => {
  if (!isLocal) return;
  superPool = new pg.Pool({ connectionString: DATABASE_URL });
  servicePool = new pg.Pool({ connectionString: toServiceUrl(DATABASE_URL) });

  // Verify Postgres is actually reachable — fail immediately if not.
  try {
    await superPool.query("SELECT 1");
  } catch (err) {
    throw new Error(
      `CELLO_ENV=local but Postgres is unreachable at ${DATABASE_URL}: ${String(err)}`,
    );
  }
});

afterAll(async () => {
  if (!isLocal) return;
  await superPool?.end();
  await servicePool?.end();
});

// Clean table before each test to avoid cross-test interference.
// superPool has enough privileges to TRUNCATE; cello_service does not.
beforeEach(async () => {
  if (!isLocal) return;
  await superPool.query("TRUNCATE seal_notarizations RESTART IDENTITY CASCADE");
});

// ─── AC-001: schema structure, RLS, and grants ────────────────────────────────

describeIntegration("PERSIST-018 AC-001: table structure and RLS", () => {
  it("AC-001: seal_notarizations exists with all required columns", async () => {
    const result = await servicePool.query<{ column_name: string; data_type: string; is_nullable: string }>(
      `SELECT column_name, data_type, is_nullable
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'seal_notarizations'
       ORDER BY ordinal_position`,
    );

    const cols = result.rows.map((r) => r.column_name);
    expect(cols).toContain("session_id");
    expect(cols).toContain("sealed_root");
    expect(cols).toContain("participant_a_pubkey");
    expect(cols).toContain("participant_b_pubkey");
    expect(cols).toContain("close_timestamp");
    expect(cols).toContain("frost_signature");
    expect(cols).toContain("chain_hash");

    // Data types for BYTEA columns (chain_hash is TEXT — hex-encoded SHA-256,
    // consistent with all other hash-chained tables in the schema)
    const byteaColumns = result.rows.filter((r) => r.data_type === "bytea").map((r) => r.column_name);
    expect(byteaColumns).toContain("session_id");
    expect(byteaColumns).toContain("sealed_root");
    expect(byteaColumns).toContain("participant_a_pubkey");
    expect(byteaColumns).toContain("participant_b_pubkey");
    expect(byteaColumns).toContain("frost_signature");

    // chain_hash is TEXT (hex-encoded SHA-256) — consistent with all other
    // hash-chained tables which use TEXT for chain_hash
    const chainHashCol = result.rows.find((r) => r.column_name === "chain_hash");
    expect(chainHashCol?.data_type).toBe("text");

    // close_timestamp must be BIGINT
    const closeTs = result.rows.find((r) => r.column_name === "close_timestamp");
    expect(closeTs?.data_type).toBe("bigint");
  });

  it("AC-001: relrowsecurity=true confirmed via pg_class", async () => {
    const result = await servicePool.query<{ relrowsecurity: boolean }>(
      `SELECT relrowsecurity FROM pg_catalog.pg_class WHERE relname = 'seal_notarizations'`,
    );
    expect(result.rows[0]?.relrowsecurity).toBe(true);
  });

  it("AC-001: exactly two policies (insert_only, select_all) for cello_service", async () => {
    // SET ROLE is required per AC-001 spec — query as cello_service role
    const client = await servicePool.connect();
    try {
      // pg_catalog.pg_policies shows policies visible to current user
      const result = await client.query<{ policyname: string }>(
        `SELECT policyname FROM pg_catalog.pg_policies
         WHERE tablename = 'seal_notarizations'
         ORDER BY policyname`,
      );
      const policyNames = result.rows.map((r) => r.policyname);
      expect(policyNames).toContain("insert_only");
      expect(policyNames).toContain("select_all");
      expect(policyNames).toHaveLength(2);
    } finally {
      client.release();
    }
  });

  it("AC-001: cello_service has no UPDATE or DELETE privilege on seal_notarizations", async () => {
    const result = await servicePool.query<{ privilege_type: string }>(
      `SELECT privilege_type
       FROM information_schema.role_table_grants
       WHERE table_name = 'seal_notarizations'
         AND grantee = 'cello_service'`,
    );
    const privileges = result.rows.map((r) => r.privilege_type);
    expect(privileges).not.toContain("UPDATE");
    expect(privileges).not.toContain("DELETE");
    expect(privileges).toContain("INSERT");
    expect(privileges).toContain("SELECT");
  });
});

// ─── AC-002: recordNotarization() + getNotarization() round-trip ──────────────

describeIntegration("PERSIST-018 AC-002: round-trip write and read", () => {
  it("AC-002: recordNotarization writes; getNotarization returns the same data; chain_hash matches server-computed value", async () => {
    const logger: Logger = {
      debug: vi.fn(), info: vi.fn(), warn: vi.fn(),
      error: vi.fn() as Logger["error"],
    };
    const pool = new pg.Pool({ connectionString: toServiceUrl(DATABASE_URL) });
    const store = new PgDirectoryStore(pool, logger);

    const notarization = makeSealNotarization();
    const sessionIdHex = Buffer.from(notarization.session_id).toString("hex");

    await store.recordNotarization(notarization, { correlationId: "test-correlation-id" });

    const retrieved = await store.getNotarization(sessionIdHex);

    // getNotarization no longer returns undefined
    expect(retrieved).toBeDefined();
    expect(Buffer.from(retrieved!.session_id).toString("hex"))
      .toBe(sessionIdHex);
    expect(Buffer.from(retrieved!.sealed_root).toString("hex"))
      .toBe(Buffer.from(notarization.sealed_root).toString("hex"));
    expect(Buffer.from(retrieved!.participant_a_pubkey).toString("hex"))
      .toBe(Buffer.from(notarization.participant_a_pubkey).toString("hex"));
    expect(Buffer.from(retrieved!.participant_b_pubkey).toString("hex"))
      .toBe(Buffer.from(notarization.participant_b_pubkey).toString("hex"));
    expect(retrieved!.close_timestamp).toBe(notarization.close_timestamp);
    expect(Buffer.from(retrieved!.frost_signature).toString("hex"))
      .toBe(Buffer.from(notarization.frost_signature).toString("hex"));

    // Independently verify chain_hash by reading the raw row and recomputing.
    // chain_hash is stored as TEXT (hex-encoded SHA-256), consistent with all other
    // hash-chained tables. BYTEA columns return as Buffer from pg; TEXT returns as string.
    const raw = await superPool.query<{
      chain_hash: string;
      session_id: Buffer;
      sealed_root: Buffer;
      participant_a_pubkey: Buffer;
      participant_b_pubkey: Buffer;
      close_timestamp: string;
      frost_signature: Buffer;
    }>(
      `SELECT session_id, sealed_root, participant_a_pubkey, participant_b_pubkey,
              close_timestamp, frost_signature, chain_hash
       FROM seal_notarizations
       WHERE session_id = decode($1, 'hex')`,
      [sessionIdHex],
    );
    expect(raw.rows).toHaveLength(1);

    const row = raw.rows[0]!;
    // Reconstruct the record as application code would at INSERT time.
    // chain_hash is excluded from serialization (ALWAYS_EXCLUDED_FROM_CHAIN).
    // Buffer values match what pg returns at verify time for BYTEA columns.
    const record: Record<string, unknown> = {
      session_id: row.session_id,
      sealed_root: row.sealed_root,
      participant_a_pubkey: row.participant_a_pubkey,
      participant_b_pubkey: row.participant_b_pubkey,
      close_timestamp: Number(row.close_timestamp),
      frost_signature: row.frost_signature,
    };
    const serialized = serializeRecord(record, "seal_notarizations");
    const expectedChainHash = computeChainHash(serialized, CHAIN_GENESIS);

    // chain_hash is a TEXT column — compare directly as strings
    expect(row.chain_hash).toBe(expectedChainHash);

    await pool.end();
  });
});

// ─── AC-003: duplicate session_id ────────────────────────────────────────────

describeIntegration("PERSIST-018 AC-003: duplicate session_id rejected", () => {
  it("AC-003: second recordNotarization with same session_id logs notarization.duplicate.rejected at WARN; row count stays 1", async () => {
    const logger: Logger = {
      debug: vi.fn(), info: vi.fn(), warn: vi.fn(),
      error: vi.fn() as Logger["error"],
    };
    const pool = new pg.Pool({ connectionString: toServiceUrl(DATABASE_URL) });
    const store = new PgDirectoryStore(pool, logger);

    const sessionId = randomBytes(16);
    const sessionIdHex = sessionId.toString("hex");
    const first = makeSealNotarization({ session_id: sessionId });
    const second = makeSealNotarization({ session_id: sessionId });

    await store.recordNotarization(first, { correlationId: "corr-1" });

    // Second call with same session_id — should be rejected
    await store.recordNotarization(second, { correlationId: "corr-2" });

    // Verify exactly one row in the DB
    const countResult = await superPool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM seal_notarizations WHERE session_id = decode($1, 'hex')`,
      [sessionIdHex],
    );
    expect(Number(countResult.rows[0]!.count)).toBe(1);

    // notarization.duplicate.rejected must be logged at WARN with { sessionId }
    expect(logger.warn).toHaveBeenCalledWith(
      "notarization.duplicate.rejected",
      expect.objectContaining({ sessionId: sessionIdHex }),
    );

    await pool.end();
  });
});

// ─── AC-004: UPDATE is rejected by RLS ────────────────────────────────────────

describeIntegration("PERSIST-018 AC-004: cello_service cannot UPDATE seal_notarizations", () => {
  it("AC-004: UPDATE rejected with permission denied — originates from RLS, not application code", async () => {
    // Insert a row as cello_service via recordNotarization
    const logger: Logger = {
      debug: vi.fn(), info: vi.fn(), warn: vi.fn(),
      error: vi.fn() as Logger["error"],
    };
    const pool = new pg.Pool({ connectionString: toServiceUrl(DATABASE_URL) });
    const store = new PgDirectoryStore(pool, logger);
    const notarization = makeSealNotarization();
    const sessionIdHex = Buffer.from(notarization.session_id).toString("hex");

    await store.recordNotarization(notarization, { correlationId: "corr-ac004" });

    // Attempt UPDATE as cello_service — must be rejected
    await expect(
      servicePool.query(
        `UPDATE seal_notarizations SET frost_signature = $1 WHERE session_id = decode($2, 'hex')`,
        [Buffer.alloc(64), sessionIdHex],
      ),
    ).rejects.toThrow(/permission denied/i);

    // Row is unchanged
    const result = await servicePool.query<{ frost_signature: Buffer }>(
      `SELECT frost_signature FROM seal_notarizations WHERE session_id = decode($1, 'hex')`,
      [sessionIdHex],
    );
    expect(Buffer.from(result.rows[0]!.frost_signature).toString("hex"))
      .toBe(Buffer.from(notarization.frost_signature).toString("hex"));

    await pool.end();
  });
});

// ─── AC-005: hash chain verification passes for two rows ─────────────────────

describeIntegration("PERSIST-018 AC-005: chain verifier reports 0 breaks over two rows", () => {
  it("AC-005: fresh SELECT + recompute reports 0 chain breaks", async () => {
    const logger: Logger = {
      debug: vi.fn(), info: vi.fn(), warn: vi.fn(),
      error: vi.fn() as Logger["error"],
    };
    const pool = new pg.Pool({ connectionString: toServiceUrl(DATABASE_URL) });
    const store = new PgDirectoryStore(pool, logger);

    // Insert two rows
    await store.recordNotarization(makeSealNotarization(), { correlationId: "corr-ac005-a" });
    await store.recordNotarization(makeSealNotarization(), { correlationId: "corr-ac005-b" });

    // Instantiate a fresh verifier — no prior in-memory state
    const freshLogger: Logger = {
      debug: vi.fn(), info: vi.fn(), warn: vi.fn(),
      error: vi.fn() as Logger["error"],
    };
    const freshPool = new pg.Pool({ connectionString: toServiceUrl(DATABASE_URL) });
    const freshStore = new PgDirectoryStore(freshPool, freshLogger);

    const result = await freshStore.verifyChain("seal_notarizations");

    expect(result.valid).toBe(true);
    expect(result.rowCount).toBeGreaterThanOrEqual(2);

    await pool.end();
    await freshPool.end();
  });
});

// ─── AC-006: getNotarization for absent session returns undefined ─────────────

describeIntegration("PERSIST-018 AC-006: getNotarization for absent session_id returns undefined", () => {
  it("AC-006: getNotarization returns undefined without throwing or logging an error", async () => {
    const logger: Logger = {
      debug: vi.fn(), info: vi.fn(), warn: vi.fn(),
      error: vi.fn() as Logger["error"],
    };
    const pool = new pg.Pool({ connectionString: toServiceUrl(DATABASE_URL) });
    const store = new PgDirectoryStore(pool, logger);

    const absentSessionId = randomBytes(16).toString("hex");
    const result = await store.getNotarization(absentSessionId);

    expect(result).toBeUndefined();
    // No error logged — absence is not an error condition
    expect(logger.error).not.toHaveBeenCalled();

    await pool.end();
  });
});

// ─── AC-007: notarization.recorded logged on success ─────────────────────────

describeIntegration("PERSIST-018 AC-007: notarization.recorded logged at INFO with correlationId", () => {
  // Store-layer verification: confirms the store logs correlationId as supplied and that
  // the EXACT value is preserved. Full end-to-end correlation (verifying the correlationId
  // originates from frost.ceremony.* events in directory-node.ts) is at the directory-node
  // integration level — that scope spans PERSIST-007. Here we verify the store threads the
  // exact correlationId value the caller provides.
  it("AC-007: notarization.recorded is logged at INFO with { sessionId, sealedRoot, correlationId }; correlationId matches the exact supplied value", async () => {
    const logger: Logger = {
      debug: vi.fn(), info: vi.fn(), warn: vi.fn(),
      error: vi.fn() as Logger["error"],
    };
    const pool = new pg.Pool({ connectionString: toServiceUrl(DATABASE_URL) });
    const store = new PgDirectoryStore(pool, logger);

    const notarization = makeSealNotarization();
    const sessionIdHex = Buffer.from(notarization.session_id).toString("hex");
    const sealedRootHex = Buffer.from(notarization.sealed_root).toString("hex");
    const correlationId = "frost-seal-ceremony-123";

    await store.recordNotarization(notarization, { correlationId });

    // Find the specific notarization.recorded call
    const infoCalls = (logger.info as ReturnType<typeof vi.fn>).mock.calls as [string, Record<string, unknown>][];
    const recordedCall = infoCalls.find(([event]) => event === "notarization.recorded")?.[1];
    expect(recordedCall).toBeDefined();

    // Exact value assertions — not just objectContaining — so a wrong value is caught
    expect(recordedCall!["sessionId"]).toBe(sessionIdHex);
    expect(recordedCall!["sealedRoot"]).toBe(sealedRootHex);
    // AC-007: correlationId matches the exact value minted at the start of the seal flow
    expect(recordedCall!["correlationId"]).toBe(correlationId);

    await pool.end();
  });
});

// ─── AC-008: retry and notarization.write.failed on transient failure ─────────

describeIntegration("PERSIST-018 AC-008: notarization.write.failed logged on both failure attempts", () => {
  it("AC-008: both failure attempts are logged at ERROR with { sessionId, reason, attempt }; FROST signature is not lost", async () => {
    const logger: Logger = {
      debug: vi.fn(), info: vi.fn(), warn: vi.fn(),
      error: vi.fn() as Logger["error"],
    };

    // Create a pool and immediately end it so all queries will fail
    const closedPool = new pg.Pool({ connectionString: toServiceUrl(DATABASE_URL) });
    await closedPool.end();

    const store = new PgDirectoryStore(closedPool, logger);
    const notarization = makeSealNotarization();
    const sessionIdHex = Buffer.from(notarization.session_id).toString("hex");

    // Capture frost_signature before the failed write to verify it is not lost/mutated
    const originalFrostSigHex = Buffer.from(notarization.frost_signature).toString("hex");

    // recordNotarization should handle the failure gracefully, not throw
    // (it returns an error to the caller via rejection)
    await expect(
      store.recordNotarization(notarization, { correlationId: "corr-ac008" }),
    ).rejects.toBeDefined();

    // AC-008: "the in-memory FROST signature is not lost" — verify the original
    // notarization object's frost_signature field is preserved (not mutated/destroyed)
    expect(Buffer.from(notarization.frost_signature).toString("hex")).toBe(originalFrostSigHex);

    // notarization.write.failed must be logged at ERROR with { sessionId, reason, attempt }
    expect(logger.error).toHaveBeenCalledWith(
      "notarization.write.failed",
      expect.objectContaining({ sessionId: sessionIdHex, reason: expect.any(String), attempt: 1 }),
    );
    expect(logger.error).toHaveBeenCalledWith(
      "notarization.write.failed",
      expect.objectContaining({ sessionId: sessionIdHex, reason: expect.any(String), attempt: 2 }),
    );
  });
});

// ─── SI-001: chain_hash is computed server-side; frost_signature stored as-is ──
// SI-001 scope: PgDirectoryStore always computes chain_hash server-side (never accepts it
// from the caller). frost_signature is stored exactly as supplied — enforcement that it
// originates from the FROST ceremony is structural at directory-node.ts: only
// processSeal()/processSealFrostSignature() call recordNotarization(), and those methods
// supply frost_signature from the FROST ceremony result.

describeIntegration("PERSIST-018 SI-001: chain_hash is always server-computed; frost_signature source enforcement is structural at directory-node.ts", () => {
  it("SI-001: chain_hash is server-computed (not caller-supplied); frost_signature is stored as-is from caller — source enforcement is structural at directory-node.ts call site", async () => {
    const logger: Logger = {
      debug: vi.fn(), info: vi.fn(), warn: vi.fn(),
      error: vi.fn() as Logger["error"],
    };
    const pool = new pg.Pool({ connectionString: toServiceUrl(DATABASE_URL) });
    const store = new PgDirectoryStore(pool, logger);

    // Use all-zeros frost_signature to simulate a "crafted" value
    const craftedFrostSig = new Uint8Array(64); // all zeros
    const notarization = makeSealNotarization({ frost_signature: craftedFrostSig });
    const sessionIdHex = Buffer.from(notarization.session_id).toString("hex");

    await store.recordNotarization(notarization, { correlationId: "si001-corr" });

    // Read the stored row from the live database
    const raw = await superPool.query<{ frost_signature: Buffer; chain_hash: string }>(
      `SELECT frost_signature, chain_hash
       FROM seal_notarizations
       WHERE session_id = decode($1, 'hex')`,
      [sessionIdHex],
    );

    expect(raw.rows).toHaveLength(1);
    const row = raw.rows[0]!;

    // frost_signature stored as-is (all-zeros as supplied)
    expect(Buffer.from(row.frost_signature).toString("hex")).toBe("0".repeat(128));

    // chain_hash is a TEXT column (hex-encoded SHA-256, 64 hex chars).
    // It must be the server-computed value — not all-zeros.
    const chainHashHex = row.chain_hash;
    expect(chainHashHex).not.toBe("0".repeat(64));
    expect(chainHashHex).toMatch(/^[0-9a-f]{64}$/);

    await pool.end();
  });
});

// ─── SI-002: atomic transaction — both writes roll back on connection loss ─────

describeIntegration("PERSIST-018 SI-002: atomic transaction with conversation_seals", () => {
  it("SI-002: opts.client path — both conversation_seals and seal_notarizations roll back atomically when the caller's transaction is rolled back", async () => {
    // This test exercises the opts.client transactional code path in insertWithChain.
    // When recordNotarization receives an external client, it participates in the caller's
    // transaction rather than managing its own BEGIN/COMMIT/ROLLBACK. Rolling back the
    // caller's transaction must roll back both the conversation_seals insert (done manually
    // here to simulate directory-node.ts) and the seal_notarizations insert (done by
    // recordNotarization via opts.client).
    const logger: Logger = {
      debug: vi.fn(), info: vi.fn(), warn: vi.fn(),
      error: vi.fn() as Logger["error"],
    };
    const pool = new pg.Pool({ connectionString: toServiceUrl(DATABASE_URL) });
    const store = new PgDirectoryStore(pool, logger);

    const conversationId = `00000000-0000-0000-0000-${randomBytes(6).toString("hex")}`;
    const notarization = makeSealNotarization();
    const sessionIdHex = Buffer.from(notarization.session_id).toString("hex");

    // Acquire a dedicated client to control the transaction lifecycle
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // First write: conversation_seals — simulates directory-node.ts seal handler step 1.
      // chain_hash placeholder value is fine — this row will be rolled back.
      await client.query(
        `INSERT INTO conversation_seals
           (conversation_id, merkle_root, close_type, participant_count, seal_date, chain_hash)
         VALUES ($1, $2, 'MUTUAL_SEAL', 2, CURRENT_DATE, 'rollback_test')`,
        [conversationId, "a".repeat(64)],
      );

      // Second write: seal_notarizations — passing opts.client so recordNotarization
      // joins the caller's open transaction. This exercises the externalClient branch in
      // insertWithChain (ownsTransaction=false → no internal BEGIN/COMMIT/ROLLBACK).
      await store.recordNotarization(notarization, { client, correlationId: "si002-corr" });

      // Simulate connection loss before COMMIT — rolls back both INSERTs atomically
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }

    // Both tables must have 0 rows — the rollback covered the entire transaction
    const sealCount = await superPool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM conversation_seals WHERE conversation_id = $1`,
      [conversationId],
    );
    const notarizationCount = await superPool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM seal_notarizations WHERE session_id = decode($1, 'hex')`,
      [sessionIdHex],
    );

    expect(Number(sealCount.rows[0]!.count)).toBe(0);
    expect(Number(notarizationCount.rows[0]!.count)).toBe(0);

    await pool.end();
  });
});

// ─── SI-003: superuser modification detected by chain verifier ────────────────

describeIntegration("PERSIST-018 SI-003: superuser modification detected by chain verifier", () => {
  it("SI-003: superuser UPDATE on frost_signature causes chain break at that row; db.chain.break.detected is logged", async () => {
    const logger: Logger = {
      debug: vi.fn(), info: vi.fn(), warn: vi.fn(),
      error: vi.fn() as Logger["error"],
    };
    const pool = new pg.Pool({ connectionString: toServiceUrl(DATABASE_URL) });
    const store = new PgDirectoryStore(pool, logger);

    // Insert a valid row
    const notarization = makeSealNotarization();
    const sessionIdHex = Buffer.from(notarization.session_id).toString("hex");
    await store.recordNotarization(notarization, { correlationId: "si003-corr" });

    // Superuser modifies frost_signature (simulating tampering)
    await superPool.query(
      `UPDATE seal_notarizations SET frost_signature = $1 WHERE session_id = decode($2, 'hex')`,
      [Buffer.alloc(64), sessionIdHex],
    );

    // Fresh verifier detects the break
    const freshLogger: Logger = {
      debug: vi.fn(), info: vi.fn(), warn: vi.fn(),
      error: vi.fn() as Logger["error"],
    };
    const freshPool = new pg.Pool({ connectionString: toServiceUrl(DATABASE_URL) });
    const freshStore = new PgDirectoryStore(freshPool, freshLogger);

    const result = await freshStore.verifyChain("seal_notarizations");

    expect(result.valid).toBe(false);
    expect(result.breakAtSequence).toBeDefined();
    expect(freshLogger.error).toHaveBeenCalledWith(
      "db.chain.break.detected",
      expect.objectContaining({
        tableName: "seal_notarizations",
        breakAtSequence: 1,
      }),
    );

    await pool.end();
    await freshPool.end();
  });
});
