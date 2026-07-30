/**
 * M12 `DOD-AE-STORE-1` — the pg-backed `AeStoreView` must reproduce the semantics the convergence
 * proof used.
 *
 * ─── Why this is the test that matters for this unit ────────────────────────────────────────────
 * The convergence proof runs against an in-memory store. If the Postgres store produces a DIFFERENT
 * record hash for the same logical row, the proof describes something nobody runs: two nodes holding
 * identical data would advertise different content addresses, see permanent divergence, and pull each
 * other's rows forever without ever converging. Nothing would error — the round would just never
 * settle.
 *
 * The DoD names the exact trap: **`agent_revocations.signature` is BYTEA and MUST be hex-encoded in
 * the SELECT**, because pg returns a Buffer and no type-parser override is installed. A Buffer and its
 * hex string are different values to `recordHash`, so getting this wrong is invisible in every
 * in-memory test and fatal on the wire. That is why this test asserts against a REAL database rather
 * than a fake pool: a fake returns whatever the test author already believed.
 *
 * Gated on `CELLO_ENV=local` like the other `.live.test.ts` files (docker-compose Postgres on 5433).
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import pg from "pg";
import { PgAeStore } from "../pg-ae-store.js";
import { encodeTierARecord, AGENT_REVOCATIONS_SPEC } from "../ae-table-encoders.js";
import { computeTableDigest } from "../set-reconciliation.js";

const DB_URL = process.env.DATABASE_URL ?? "postgresql://postgres:dev@localhost:5433/cello_dev";
const describeLive = process.env.CELLO_ENV === "local" ? describe : describe.skip;

/** Distinct enough not to collide with other suites sharing this database. */
const AGENT = "aestoreparity" + "0".repeat(51);
const EPOCH = `${AGENT}:epoch:1`;
const SIG_HEX = "ab".repeat(64);

describeLive("DOD-AE-STORE-1: the pg store and the encoders agree on the record hash", () => {
  let pool: pg.Pool;
  let store: PgAeStore;

  beforeAll(() => {
    pool = new pg.Pool({ connectionString: DB_URL });
    store = new PgAeStore(pool);
  });
  afterAll(async () => { await pool.end(); });
  afterEach(async () => { await pool.query("DELETE FROM agent_revocations WHERE agent_id = $1", [AGENT]); });

  async function insertRevocation(): Promise<void> {
    await pool.query(
      `INSERT INTO agent_revocations (agent_id, epoch_id, reason, signature, revoked_at)
       VALUES ($1, $2, $3, decode($4,'hex'), $5)
       ON CONFLICT (agent_id) DO NOTHING`,
      [AGENT, EPOCH, "m12 ae-store parity probe", SIG_HEX, "1753900000000"],
    );
  }

  it("a BYTEA column read back through the store hashes as its HEX STRING, not as a Buffer", async () => {
    // The DoD's named trap. If tierASelectExpr stopped hex-encoding, pg would hand the encoder a
    // Buffer, recordHash would hash a different value, and this node's advertised hash for a row
    // every other node also holds would differ — permanent, silent non-convergence.
    await insertRevocation();

    const served = await store.serveTierA("agent_revocations", await store.tierARecordHashes("agent_revocations"));
    const row = served.find((r) => (r.body as Record<string, unknown>)["agent_id"] === AGENT);
    expect(row, "the inserted revocation must be served").toBeDefined();

    const body = row!.body as Record<string, unknown>;
    expect(typeof body["signature"], "signature must cross the wire as a string, never a Buffer").toBe("string");
    expect(body["signature"]).toBe(SIG_HEX);
    expect(Buffer.isBuffer(body["signature"])).toBe(false);
  });

  it("the hash the store ADVERTISES equals the hash the encoders compute for the same logical row", async () => {
    // ★ THE PARITY ASSERTION. This is what makes the in-memory convergence proof describe the
    // production store: same logical row, same content address, on both paths.
    await insertRevocation();

    const served = await store.serveTierA("agent_revocations", await store.tierARecordHashes("agent_revocations"));
    const row = served.find((r) => (r.body as Record<string, unknown>)["agent_id"] === AGENT)!;

    const expected = encodeTierARecord(AGENT_REVOCATIONS_SPEC, {
      agent_id: AGENT,
      epoch_id: EPOCH,
      reason: "m12 ae-store parity probe",
      signature: SIG_HEX,
      revoked_at: "1753900000000",
    });
    expect(row.hash).toBe(expected.hash);
    // And the store's own claimed hash agrees with a recomputation from the body it just served —
    // the same check applyTierA performs on the receiving side, so a mismatch here would mean a node
    // refuses its own peer's honest record.
    expect(encodeTierARecord(AGENT_REVOCATIONS_SPEC, row.body as never).hash).toBe(row.hash);
  });

  it("proves its own discriminating power: a Buffer signature hashes DIFFERENTLY from its hex string", () => {
    // Without this, the parity assertions above could be passing for a trivial reason and nobody would
    // know. Rather than temporarily breaking tierASelectExpr to revert-test it, this pins the fact the
    // whole unit rests on: the two encodings are NOT interchangeable to recordHash. If they ever
    // became equal, the parity assertions would be vacuous — and this test would go red first.
    const asHex = encodeTierARecord(AGENT_REVOCATIONS_SPEC, {
      agent_id: AGENT, epoch_id: EPOCH, reason: "m12 ae-store parity probe",
      signature: SIG_HEX, revoked_at: "1753900000000",
    });
    const asBuffer = encodeTierARecord(AGENT_REVOCATIONS_SPEC, {
      agent_id: AGENT, epoch_id: EPOCH, reason: "m12 ae-store parity probe",
      signature: Buffer.from(SIG_HEX, "hex") as never, revoked_at: "1753900000000",
    });
    expect(asBuffer.hash).not.toBe(asHex.hash);
    // And it is the hex form the store must produce — asserted above against a real SELECT.
  });

  it("the table digest is stable across reads — an unchanged table cannot look divergent", async () => {
    // Divergence detection is digest equality. A digest that varies between reads of unchanged data
    // (row order, a re-encoded column) makes every round see a difference and pull forever.
    await insertRevocation();
    const a = await store.tierATableDigest("agent_revocations");
    const b = await store.tierATableDigest("agent_revocations");
    expect(a).toBe(b);
    // And it matches a digest computed from the hashes the store itself lists.
    expect(a).toBe(computeTableDigest(await store.tierARecordHashes("agent_revocations")));
  });

  it("still refuses the share table against a real database", async () => {
    // SHARES-LOCAL holds on the live path too, not only against a fake pool.
    await expect(store.serveTierA("agent_key_shares", ["x"])).rejects.toThrow(/unknown Tier-A table/);
  });
});
