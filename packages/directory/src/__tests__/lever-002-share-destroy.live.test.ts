// LEVER-002 LIVE — burn share destruction: ZERO, not delete (append-only agent_key_shares).
//
// agent_key_shares forbids row deletion (append-only); the GRANT allows UPDATE of encrypted_share.
// destroyShares must ZERO the persisted material for ALL of an agent's epochs — capability dies, the
// row (accountability) survives — and drop the in-memory cache. Run against a DB with the full
// migration history (cello_spine).

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import type { EnvelopeKeyProvider, Logger } from "@cello-protocol/interfaces";
import { EncryptedPgShareStore } from "../encrypted-share-store.js";

const DB_URL = process.env.DATABASE_URL ?? "postgresql://postgres:dev@localhost:5433/cello_spine";
const AGENT = "burn-share-live-agent"; // agent_key_shares.agent_id holds the k_local pubkey hex
const noopLogger: Logger = { info() {}, warn() {}, error() {}, debug() {} } as unknown as Logger;
// destroyShares never calls encrypt/decrypt — a throwing stub proves that.
const stubProvider: EnvelopeKeyProvider = {
  encrypt: async () => { throw new Error("encrypt must not be called by destroyShares"); },
  decrypt: async () => { throw new Error("decrypt must not be called by destroyShares"); },
} as unknown as EnvelopeKeyProvider;

const describeLive = process.env.CELLO_ENV === "local" ? describe : describe.skip;

describeLive("LEVER-002 live — burn zeroes the persisted K_server share (append-only)", () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: DB_URL });
    await pool.query(`DELETE FROM agent_key_shares WHERE agent_id = $1`, [AGENT]);
    // Seed two epochs of non-empty encrypted material (as a real registration would).
    for (const epoch of ["e:1", "e:2"]) {
      await pool.query(
        `INSERT INTO agent_key_shares (agent_id, epoch_id, encrypted_share, key_version)
         VALUES ($1, $2, $3, 'v1')`,
        [AGENT, epoch, Buffer.from([1, 2, 3, 4, 5, 6, 7, 8])],
      );
    }
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM agent_key_shares WHERE agent_id = $1`, [AGENT]).catch(() => {});
    await pool.end();
  });

  it("destroyShares ZEROES encrypted_share for every epoch but keeps the rows (accountability survives)", async () => {
    const store = new EncryptedPgShareStore(pool, stubProvider, noopLogger);

    // Precondition: two rows with non-empty material.
    const before = await pool.query<{ n: string; nonempty: string }>(
      `SELECT count(*)::text AS n, count(*) FILTER (WHERE length(encrypted_share) > 0)::text AS nonempty
         FROM agent_key_shares WHERE agent_id = $1`,
      [AGENT],
    );
    expect(before.rows[0]).toMatchObject({ n: "2", nonempty: "2" });

    await store.destroyShares(AGENT);

    // The rows STILL EXIST (append-only — accountability survives), but the material is ZEROED and
    // stamped 'burned'. The capability is gone; the record remains.
    const after = await pool.query<{ n: string; nonempty: string; burned: string }>(
      `SELECT count(*)::text AS n,
              count(*) FILTER (WHERE length(encrypted_share) > 0)::text AS nonempty,
              count(*) FILTER (WHERE key_version = 'burned')::text AS burned
         FROM agent_key_shares WHERE agent_id = $1`,
      [AGENT],
    );
    expect(after.rows[0]).toMatchObject({ n: "2", nonempty: "0", burned: "2" });

    // Idempotent — a re-burn re-zeroes without error.
    await store.destroyShares(AGENT);
    const again = await pool.query<{ nonempty: string }>(
      `SELECT count(*) FILTER (WHERE length(encrypted_share) > 0)::text AS nonempty
         FROM agent_key_shares WHERE agent_id = $1`,
      [AGENT],
    );
    expect(again.rows[0].nonempty).toBe("0");
  });
});
