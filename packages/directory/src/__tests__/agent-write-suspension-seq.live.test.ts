// M12 kill-switch write path — applyRevocationFlag mints suspension_seq + origin_node so the
// anti-entropy merge (§4) can order concurrent writes (DOD-AE-MUTABLE-1). Gated CELLO_ENV=local
// (needs the directory Postgres at Docker Compose :5433, migrated to V49+).
//
// suspension_seq is per-agent monotonic (the row's PK is agent_id, so "max(local)+1" is just
// "current + 1"). Every accepted write — pause, burn, and a real clear — advances it and stamps the
// accepting node's id. A clear that no-ops (burned or absent agent) must NOT advance it.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import pg from "pg";
import { applyRevocationFlag } from "../agent-write-repository.js";
import { configurePgTypes } from "../pg-type-config.js";

configurePgTypes();

const DB_URL = process.env.DATABASE_URL ?? "postgresql://postgres:dev@localhost:5433/cello_dev";
const describeLive = process.env.CELLO_ENV === "local" ? describe : describe.skip;

const P = "seqtest-";
const ACC = "00000000-0000-0000-0000-0000000000fe";
const NODE = "node-seq-test";

async function seq(pool: pg.Pool, agentId: string) {
  const r = await pool.query(
    `SELECT paused, burned, suspension_seq, origin_node FROM agent_suspensions WHERE agent_id=$1`, [agentId],
  );
  return r.rows[0];
}

describeLive("applyRevocationFlag — suspension_seq + origin_node minting", () => {
  let pool: pg.Pool;
  beforeAll(() => { pool = new pg.Pool({ connectionString: DB_URL }); });
  afterAll(async () => { await pool.end(); });
  beforeEach(async () => { await pool.query(`DELETE FROM agent_suspensions WHERE agent_id LIKE $1`, [`${P}%`]); });

  it("first pause creates the row at seq 1 with the accepting node; a second write bumps to seq 2", async () => {
    const id = `${P}a`;
    expect(await applyRevocationFlag(pool, { agentId: id, mode: "pause", accountId: ACC, originNode: NODE })).toBe("applied");
    let r = await seq(pool, id);
    expect(Number(r.suspension_seq)).toBe(1);
    expect(r.origin_node).toBe(NODE);
    expect(r.paused).toBe(true);

    expect(await applyRevocationFlag(pool, { agentId: id, mode: "pause", accountId: ACC, originNode: NODE })).toBe("applied");
    r = await seq(pool, id);
    expect(Number(r.suspension_seq)).toBe(2); // monotonic per-agent advance
  });

  it("a real clear (non-burned) advances the seq and sets paused=false", async () => {
    const id = `${P}b`;
    await applyRevocationFlag(pool, { agentId: id, mode: "pause", accountId: ACC, originNode: NODE }); // seq 1
    expect(await applyRevocationFlag(pool, { agentId: id, mode: "clear", accountId: ACC, originNode: NODE })).toBe("applied");
    const r = await seq(pool, id);
    expect(r.paused).toBe(false);
    expect(Number(r.suspension_seq)).toBe(2); // the clear is a real state change → advances
  });

  it("burn sets burned monotonically and advances seq; a later clear is rejected and does NOT advance", async () => {
    const id = `${P}c`;
    await applyRevocationFlag(pool, { agentId: id, mode: "pause", accountId: ACC, originNode: NODE }); // seq 1
    expect(await applyRevocationFlag(pool, { agentId: id, mode: "burn", accountId: ACC, originNode: NODE })).toBe("applied");
    let r = await seq(pool, id);
    expect(r.burned).toBe(true);
    expect(Number(r.suspension_seq)).toBe(2);

    // A clear on a burned agent is rejected (burned is terminal) and must not touch seq.
    expect(await applyRevocationFlag(pool, { agentId: id, mode: "clear", accountId: ACC, originNode: NODE })).toBe("burned_immutable");
    r = await seq(pool, id);
    expect(Number(r.suspension_seq)).toBe(2); // unchanged — the no-op clear did not advance
    expect(r.burned).toBe(true);
  });

  it("a clear on a never-suspended agent is a benign no-op (no row, no seq)", async () => {
    const id = `${P}d`;
    expect(await applyRevocationFlag(pool, { agentId: id, mode: "clear", accountId: ACC, originNode: NODE })).toBe("applied");
    expect(await seq(pool, id)).toBeUndefined();
  });

  it("two CONCURRENT writes to the same agent mint DISTINCT seqs (atomic +1, no lost update)", async () => {
    // The teeth for the atomicity claim: INSERT … ON CONFLICT DO UPDATE SET seq = seq + 1 is atomic
    // (the loser blocks on the winner's row lock and re-reads the committed seq). A non-atomic
    // read-then-write refactor would let both read N and write N+1 → a duplicated seq {1,1}, which
    // collapses two authenticated writes into one AE ordering slot. We assert {1,2}.
    const id = `${P}race`;
    await Promise.all([
      applyRevocationFlag(pool, { agentId: id, mode: "pause", accountId: ACC, originNode: NODE }),
      applyRevocationFlag(pool, { agentId: id, mode: "pause", accountId: ACC, originNode: NODE }),
    ]);
    const r = await seq(pool, id);
    expect(Number(r.suspension_seq)).toBe(2); // both writes landed, seq advanced twice — no collision
  });
});
