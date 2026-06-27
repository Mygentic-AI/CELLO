// TRUST-001 LIVE — pickup queue drain + ACK against the REAL directory Postgres.
//
// Proves the daemon-delivery half's queue mechanics: drain returns an agent's unacked sealed signals
// (oldest first) EACH joined to its authoritative identity-tree hash (AC-001 verification anchor);
// ACK DELETES the row so the queue holds NO ciphertext for that signal afterward (AC-002). Gated to
// CELLO_ENV=local. Run against a DB with the full migration history (e.g. cello_spine).

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { drainPickupForAgent, ackPickupDelete } from "../pickup-repository.js";
import { enqueuePickup, upsertIdentityHash } from "../agent-write-repository.js";

const DB_URL = process.env.DATABASE_URL ?? "postgresql://postgres:dev@localhost:5433/cello_spine";
const AGENT = "trust-pickup-live-agent";
const SIGNAL_HASH = "c".repeat(64);
const describeLive = process.env.CELLO_ENV === "local" ? describe : describe.skip;

describeLive("TRUST-001 live — pickup drain + ACK (real Postgres)", () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: DB_URL });
    await pool.query(`DELETE FROM pickup_queue WHERE agent_id = $1`, [AGENT]);
    await pool.query(`DELETE FROM identity_tree_entries WHERE agent_id = $1`, [AGENT]);
    // The authoritative hash anchor in the identity tree.
    await upsertIdentityHash(pool, { agentId: AGENT, signalKind: "webauthn", signalHash: SIGNAL_HASH });
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM pickup_queue WHERE agent_id = $1`, [AGENT]).catch(() => {});
    await pool.query(`DELETE FROM identity_tree_entries WHERE agent_id = $1`, [AGENT]).catch(() => {});
    await pool.end();
  });

  it("drain returns unacked signals with the joined identity-tree hash; ACK deletes them", async () => {
    const ct1 = Buffer.from(Uint8Array.from({ length: 64 }, (_, i) => (i * 7 + 1) % 256));
    const ct2 = Buffer.from(Uint8Array.from({ length: 64 }, (_, i) => (i * 11 + 3) % 256));
    await enqueuePickup(pool, { agentId: AGENT, signalKind: "webauthn", ciphertext: ct1 });
    await enqueuePickup(pool, { agentId: AGENT, signalKind: "webauthn", ciphertext: ct2 });

    const drained = await drainPickupForAgent(pool, AGENT);
    expect(drained).toHaveLength(2);
    // Each carries its authoritative hash (the daemon's verification anchor) + the opaque ciphertext.
    expect(drained[0].signalHash).toBe(SIGNAL_HASH);
    expect(drained[0].signalKind).toBe("webauthn");
    expect(Buffer.compare(drained[0].ciphertext, ct1)).toBe(0); // oldest first
    expect(Buffer.compare(drained[1].ciphertext, ct2)).toBe(0);

    // H1 (account-scoping): an ACK from a DIFFERENT agent must NOT delete this agent's row, even with
    // the correct (guessable BIGSERIAL) id — cross-tenant deletion is the attack ackPickupDelete guards.
    await ackPickupDelete(pool, drained[0].id, "some-other-agent");
    expect(await drainPickupForAgent(pool, AGENT), "a foreign ACK must not delete our row").toHaveLength(2);

    // ACK the first AS THE OWNING AGENT → it is DELETED; a re-drain shows only the second.
    await ackPickupDelete(pool, drained[0].id, AGENT);
    const afterFirst = await drainPickupForAgent(pool, AGENT);
    expect(afterFirst).toHaveLength(1);
    expect(Buffer.compare(afterFirst[0].ciphertext, ct2)).toBe(0);

    // ACK the second → the queue holds NO ciphertext for this agent (AC-002).
    await ackPickupDelete(pool, afterFirst[0].id, AGENT);
    expect(await drainPickupForAgent(pool, AGENT)).toHaveLength(0);
    const remaining = await pool.query(`SELECT count(*)::int AS n FROM pickup_queue WHERE agent_id = $1`, [AGENT]);
    expect(remaining.rows[0].n).toBe(0);

    // ACK is idempotent (re-ACK of a deleted id is a no-op).
    await ackPickupDelete(pool, drained[0].id, AGENT);
  });
});
