/**
 * CELLO-M7-UPGRADE-001 (DOD-UP-1) — seal_notarizations superseding row, store layer
 *
 * The unilateral→bilateral upgrade writes a NEW bilateral notarization row that SUPERSEDES the
 * existing unilateral one WITHOUT mutating it (append-only, AC-006). V31 replaced the global
 * UNIQUE(session_id) with UNIQUE(session_id, seal_type), so a session may now hold exactly one
 * unilateral and one bilateral row.
 *
 * What this proves at the store boundary (the J-UPGRADE spine test proves the live ceremony):
 *
 *  - A unilateral row then a superseding bilateral row coexist; the unilateral row is unchanged.
 *  - getNotarization() returns the AUTHORITATIVE seal — the bilateral row once an upgrade exists.
 *  - getNotarizationId('unilateral') returns the unilateral row id, and the bilateral row's
 *    supersedes_notarization_id points at exactly that id.
 *  - UNIQUE(session_id, seal_type) still rejects a duplicate of the SAME type (durable dedup).
 *  - The hash chain stays valid across both rows AND across a plain (default-bilateral) row —
 *    i.e. the V31 columns are correctly EXCLUDED from chain serialization (M4 bug #7 guard). A
 *    seal_type/supersedes column that leaked into the chain would break verifyChain here.
 *
 * test_type: integration — requires CELLO_ENV=local + Docker Compose Postgres with V31 applied.
 * Skips automatically when CELLO_ENV !== 'local'.
 *
 * Run with:
 *   docker compose up -d && docker compose run --rm flyway
 *   CELLO_ENV=local DATABASE_URL=postgresql://postgres:dev@localhost:5433/cello_dev \
 *     pnpm --filter @cello-protocol/directory run test -- m7-upgrade-001 \
 *     --pool-options.threads.maxThreads=1 --pool-options.threads.minThreads=1
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { randomBytes } from "node:crypto";
import pg from "pg";
import { PgDirectoryStore } from "../adapters/pg-directory-store.js";
import type { Logger, SealNotarization } from "@cello-protocol/interfaces";

const isLocal = process.env["CELLO_ENV"] === "local";
const DATABASE_URL =
  process.env["DATABASE_URL"] ?? "postgresql://postgres:dev@localhost:5433/cello_dev";
const describeIntegration = isLocal ? describe : describe.skip;

function noopLogger(): Logger {
  const fn = () => { /* swallow */ };
  return { debug: fn, info: fn, warn: fn, error: fn } as unknown as Logger;
}

function makeNotarization(opts?: Partial<SealNotarization> & { session_id?: Uint8Array }): SealNotarization {
  return {
    session_id: opts?.session_id ?? randomBytes(16),
    sealed_root: opts?.sealed_root ?? randomBytes(32),
    participant_a_pubkey: opts?.participant_a_pubkey ?? randomBytes(32),
    participant_b_pubkey: opts?.participant_b_pubkey ?? randomBytes(32),
    close_timestamp: opts?.close_timestamp ?? Date.now(),
    frost_signature: opts?.frost_signature ?? randomBytes(64),
    seal_type: opts?.seal_type,
    supersedes_notarization_id: opts?.supersedes_notarization_id,
  };
}

let superPool: pg.Pool;

beforeAll(async () => {
  if (!isLocal) return;
  superPool = new pg.Pool({ connectionString: DATABASE_URL });
  try {
    await superPool.query("SELECT 1");
  } catch (err) {
    throw new Error(`CELLO_ENV=local but Postgres is unreachable at ${DATABASE_URL}: ${String(err)}`);
  }
});

afterAll(async () => {
  if (!isLocal) return;
  await superPool?.end();
});

beforeEach(async () => {
  if (!isLocal) return;
  await superPool.query("TRUNCATE seal_notarizations RESTART IDENTITY CASCADE");
});

describeIntegration("DOD-UP-1: superseding notarization (store layer)", () => {
  it("writes a bilateral row that supersedes the unilateral row without mutating it (AC-006)", async () => {
    const logger = noopLogger();
    const store = new PgDirectoryStore(superPool, logger);
    const sessionId = randomBytes(16);
    const sessionIdHex = Buffer.from(sessionId).toString("hex");
    const sealedRoot = randomBytes(32);
    const pA = randomBytes(32);
    const pB = randomBytes(32);
    const uniSig = randomBytes(64);
    const biSig = randomBytes(64);

    // 1. Unilateral seal (B absent).
    await store.recordNotarization(
      makeNotarization({
        session_id: sessionId,
        sealed_root: sealedRoot,
        participant_a_pubkey: pA,
        participant_b_pubkey: pB,
        frost_signature: uniSig,
        seal_type: "unilateral",
      }),
      { correlationId: "up1-uni" },
    );

    const uniId = await store.getNotarizationId(sessionIdHex, "unilateral");
    expect(uniId).toBeGreaterThan(0);

    // 2. B returns, recovers + verifies, co-signs → superseding bilateral row over the SAME root.
    await store.recordNotarization(
      makeNotarization({
        session_id: sessionId,
        sealed_root: sealedRoot, // identical sealed root — the upgrade does not re-seal new content
        participant_a_pubkey: pA,
        participant_b_pubkey: pB,
        frost_signature: biSig,
        seal_type: "bilateral",
        supersedes_notarization_id: uniId,
      }),
      { correlationId: "up1-bi" },
    );

    // Both rows coexist.
    const rowCount = await superPool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM seal_notarizations WHERE session_id = decode($1,'hex')`,
      [sessionIdHex],
    );
    expect(parseInt(rowCount.rows[0]!.n, 10)).toBe(2);

    // getNotarization returns the AUTHORITATIVE (bilateral) seal.
    const authoritative = await store.getNotarization(sessionIdHex);
    expect(authoritative?.seal_type).toBe("bilateral");
    expect(Buffer.from(authoritative!.frost_signature)).toEqual(Buffer.from(biSig));
    expect(authoritative?.supersedes_notarization_id).toBe(uniId);
    // Same sealed root — the upgrade ratifies the existing seal, it does not change it.
    expect(Buffer.from(authoritative!.sealed_root)).toEqual(Buffer.from(sealedRoot));

    // The unilateral row is UNMUTATED — its signature is still the original unilateral sig.
    const uniRow = await superPool.query<{ frost_signature: Buffer; seal_type: string; supersedes_notarization_id: string | null }>(
      `SELECT frost_signature, seal_type, supersedes_notarization_id
       FROM seal_notarizations WHERE id = $1`,
      [uniId],
    );
    expect(uniRow.rows[0]!.seal_type).toBe("unilateral");
    expect(Buffer.from(uniRow.rows[0]!.frost_signature)).toEqual(Buffer.from(uniSig));
    expect(uniRow.rows[0]!.supersedes_notarization_id).toBeNull();
  });

  it("rejects a duplicate of the same seal_type (UNIQUE(session_id, seal_type) durable dedup)", async () => {
    const store = new PgDirectoryStore(superPool, noopLogger());
    const sessionId = randomBytes(16);
    const sessionIdHex = Buffer.from(sessionId).toString("hex");

    await store.recordNotarization(makeNotarization({ session_id: sessionId, seal_type: "unilateral" }), { correlationId: "dup-1" });
    // Second unilateral write for the same session → unique violation, swallowed (duplicate.rejected).
    await store.recordNotarization(makeNotarization({ session_id: sessionId, seal_type: "unilateral" }), { correlationId: "dup-2" });

    const rowCount = await superPool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM seal_notarizations WHERE session_id = decode($1,'hex')`,
      [sessionIdHex],
    );
    expect(parseInt(rowCount.rows[0]!.n, 10)).toBe(1);
  });

  it("hash chain stays valid across unilateral + superseding bilateral + a plain row", async () => {
    const store = new PgDirectoryStore(superPool, noopLogger());
    const sessionId = randomBytes(16);
    const sessionIdHex = Buffer.from(sessionId).toString("hex");

    // A plain notarization with NO explicit seal_type — defaults to 'bilateral', the pre-UP-1 path.
    await store.recordNotarization(makeNotarization(), { correlationId: "plain" });

    const uni = makeNotarization({ session_id: sessionId, seal_type: "unilateral" });
    await store.recordNotarization(uni, { correlationId: "chain-uni" });
    const uniId = await store.getNotarizationId(sessionIdHex, "unilateral");
    await store.recordNotarization(
      makeNotarization({ session_id: sessionId, seal_type: "bilateral", supersedes_notarization_id: uniId }),
      { correlationId: "chain-bi" },
    );

    // Verify with a FRESH store/pool — proves the chain holds on a clean SELECT, not in-memory state.
    const freshPool = new pg.Pool({ connectionString: DATABASE_URL });
    try {
      const freshStore = new PgDirectoryStore(freshPool, noopLogger());
      const result = await freshStore.verifyChain("seal_notarizations");
      expect(result.valid).toBe(true);
      expect(result.rowCount).toBe(3);
    } finally {
      await freshPool.end();
    }
  });

  // THE TEETH: prove the V31 columns are genuinely EXCLUDED from chain serialization (M4 bug #7
  // guard) — not merely consistent because every row was written under the same rules. A superuser
  // flip of seal_type / supersedes_notarization_id must leave the chain valid (they are not in the
  // hashed TBS), while the SAME kind of flip on frost_signature DOES break it. If a future change
  // pulled seal_type into the chain, the first assertion below would fail — and every pre-V31
  // notarization row in production (read back with the 'bilateral' default) would break too.
  it("superuser flip of seal_type / supersedes leaves the chain valid; flip of frost_signature breaks it", async () => {
    const store = new PgDirectoryStore(superPool, noopLogger());
    const sessionId = randomBytes(16);
    const sessionIdHex = Buffer.from(sessionId).toString("hex");
    await store.recordNotarization(
      makeNotarization({ session_id: sessionId, seal_type: "unilateral" }),
      { correlationId: "teeth" },
    );

    // Flip the two V31 columns WITHOUT recomputing chain_hash — simulates both a malicious edit and
    // the V31 default-backfill of a pre-existing row. Excluded columns ⇒ chain still verifies.
    // supersedes points at the row's own id (a real id, so the FK is satisfied) — the value is
    // irrelevant to the chain since the column is excluded; only that it changed matters.
    const rowId = await store.getNotarizationId(sessionIdHex, "unilateral");
    await superPool.query(
      `UPDATE seal_notarizations
         SET seal_type = 'bilateral', supersedes_notarization_id = $2
       WHERE session_id = decode($1,'hex')`,
      [sessionIdHex, rowId],
    );
    {
      const freshPool = new pg.Pool({ connectionString: DATABASE_URL });
      try {
        const result = await new PgDirectoryStore(freshPool, noopLogger()).verifyChain("seal_notarizations");
        expect(result.valid).toBe(true); // excluded → tamper-flip does not break the chain
      } finally {
        await freshPool.end();
      }
    }

    // Control: an integrity-target column (frost_signature) IS in the chain — flipping it breaks it.
    await superPool.query(
      `UPDATE seal_notarizations SET frost_signature = $1 WHERE session_id = decode($2,'hex')`,
      [Buffer.alloc(64), sessionIdHex],
    );
    {
      const freshPool = new pg.Pool({ connectionString: DATABASE_URL });
      try {
        const result = await new PgDirectoryStore(freshPool, noopLogger()).verifyChain("seal_notarizations");
        expect(result.valid).toBe(false); // in-chain → tamper detected
      } finally {
        await freshPool.end();
      }
    }
  });
});
