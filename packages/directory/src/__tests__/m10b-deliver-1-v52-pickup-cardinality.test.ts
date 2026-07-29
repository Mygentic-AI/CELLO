/**
 * M10B / DOD-END-DELIVER-1 (M10B-D23) — V52 pickup_queue cardinality.
 *
 * THE DEFECT: under V37's (agent_id, signal_kind) pending-uniqueness, the SECOND endorsement of a
 * subject silently overwrote the first — no error, success returned. Journey case (a2) ("subject
 * offline at mint") is exactly the scenario that triggers it.
 *
 * The headline test below is the one that matters, and it carries an explicit REVERT PROOF: it
 * reconstructs V37's old index on a scratch table and demonstrates the overwrite, so the fix cannot be
 * reverted while the suite stays green.
 *
 * Gated on CELLO_ENV=local (Docker Postgres).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { enqueuePickup } from "../agent-write-repository.js";

const describeIntegration = process.env.CELLO_ENV === "local" ? describe : describe.skip;

describeIntegration("V52 pickup_queue cardinality (DOD-END-DELIVER-1 / M10B-D23)", () => {
  let pool: Pool;
  const tag = `v52test-${Math.floor(Date.now() / 1000)}-${Math.random().toString(16).slice(2, 8)}`;
  const A = (s: string): string => `${tag}-${s}`;

  beforeAll(() => {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL || "postgresql://postgres:dev@localhost:5433/cello_dev",
    });
  });

  afterAll(async () => {
    if (pool) {
      await pool.query("DELETE FROM pickup_queue WHERE agent_id LIKE $1", [`${tag}%`]).catch(() => {});
      await pool.query("DROP TABLE IF EXISTS v52_revert_probe").catch(() => {});
      await pool.end();
    }
  });

  it("TWO different endorsements for one offline subject BOTH survive (the defect)", async () => {
    const alice = A("alice");
    await enqueuePickup(pool, {
      agentId: alice, signalKind: "endorsement", ciphertext: Buffer.from([0x01]),
      owningNodeId: "n1", signalHash: A("from-bob"),
    });
    await enqueuePickup(pool, {
      agentId: alice, signalKind: "endorsement", ciphertext: Buffer.from([0x02]),
      owningNodeId: "n1", signalHash: A("from-carol"),
    });

    const { rows } = await pool.query(
      "SELECT signal_hash FROM pickup_queue WHERE agent_id = $1 AND acked_at IS NULL ORDER BY signal_hash",
      [alice],
    );
    expect(rows.map((r: { signal_hash: string }) => r.signal_hash)).toEqual([A("from-bob"), A("from-carol")].sort());
  });

  it("REVERT PROOF: V37's old key destroys the second endorsement", async () => {
    // Reconstruct the exact shape V37 enforced, on a scratch table, and show the loss. If someone
    // reverts V52, the test above goes red — and this test explains WHY, in executable form, rather
    // than in a comment that can drift.
    await pool.query("DROP TABLE IF EXISTS v52_revert_probe");
    await pool.query(`
      CREATE TABLE v52_revert_probe (
        id BIGSERIAL PRIMARY KEY, agent_id TEXT NOT NULL, signal_kind TEXT,
        ciphertext BYTEA NOT NULL, signal_hash TEXT, acked_at TIMESTAMPTZ
      )`);
    await pool.query(
      "CREATE UNIQUE INDEX ON v52_revert_probe (agent_id, signal_kind) WHERE acked_at IS NULL",
    );
    const up = `INSERT INTO v52_revert_probe (agent_id, signal_kind, ciphertext, signal_hash)
                VALUES ($1,$2,$3,$4)
                ON CONFLICT (agent_id, signal_kind) WHERE acked_at IS NULL
                DO UPDATE SET ciphertext = EXCLUDED.ciphertext, signal_hash = EXCLUDED.signal_hash`;
    await pool.query(up, ["alice", "endorsement", Buffer.from([0x01]), "from-bob"]);
    await pool.query(up, ["alice", "endorsement", Buffer.from([0x02]), "from-carol"]);

    const { rows } = await pool.query("SELECT signal_hash FROM v52_revert_probe WHERE agent_id = 'alice'");
    // ONE row, and it is Carol's — Bob's endorsement was destroyed, silently, with both writes
    // reporting success. That is the bug, reproduced.
    expect(rows).toHaveLength(1);
    expect(rows[0].signal_hash).toBe("from-carol");
  });

  it("a genuine re-enqueue of the IDENTICAL envelope still collapses to one row (V37's race stays closed)", async () => {
    const bob = A("bob");
    const h = A("same-hash");
    await enqueuePickup(pool, { agentId: bob, signalKind: "endorsement", ciphertext: Buffer.from([0x01]), owningNodeId: "n1", signalHash: h });
    await enqueuePickup(pool, { agentId: bob, signalKind: "endorsement", ciphertext: Buffer.from([0x99]), owningNodeId: "n1", signalHash: h });

    const { rows } = await pool.query(
      "SELECT encode(ciphertext,'hex') AS hex FROM pickup_queue WHERE agent_id = $1 AND acked_at IS NULL",
      [bob],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].hex).toBe("99"); // updated in place, not duplicated
  });

  it("two versions of a one-per-kind signal now coexist — the accepted supersession trade", async () => {
    // Stated rather than hidden: a re-minted phone signal no longer overwrites its predecessor's
    // pending row. Safe because the wallet is content-addressed and supersession is carried by
    // supersedes_hash + signal_records_effective + the daemon cascade — three mechanisms that do the
    // job properly, versus the pickup row's weaker copy which silently dropped data.
    const carol = A("carol");
    await enqueuePickup(pool, { agentId: carol, signalKind: "phone", ciphertext: Buffer.from([0x10]), owningNodeId: "n1", signalHash: A("phone-v1") });
    await enqueuePickup(pool, { agentId: carol, signalKind: "phone", ciphertext: Buffer.from([0x11]), owningNodeId: "n1", signalHash: A("phone-v2") });

    const { rows } = await pool.query(
      "SELECT count(*)::int AS n FROM pickup_queue WHERE agent_id = $1 AND signal_kind = 'phone' AND acked_at IS NULL",
      [carol],
    );
    expect(rows[0].n).toBe(2);
  });

  it("the old V37 index is gone and the new one is in place", async () => {
    const { rows } = await pool.query(
      "SELECT indexname FROM pg_indexes WHERE tablename = 'pickup_queue'",
    );
    const names = rows.map((r: { indexname: string }) => r.indexname);
    expect(names).toContain("idx_pickup_queue_one_pending_per_hash");
    expect(names).not.toContain("idx_pickup_queue_one_pending_per_kind");
  });
});
