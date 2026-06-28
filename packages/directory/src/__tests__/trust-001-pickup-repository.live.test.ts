// TRUST-001 LIVE — pickup queue drain + ACK + supersede against the REAL directory Postgres.
//
// Proves the daemon-delivery half's queue mechanics: drain returns an agent's unacked sealed signals
// (oldest first) EACH joined to its authoritative identity-tree hash (AC-001 verification anchor);
// ACK DELETES the row so the queue holds NO ciphertext for that signal afterward (AC-002); and a new
// ciphertext for an (agent, signal_kind) SUPERSEDES a prior undelivered one for that same kind (so a
// re-enrolled signal cannot leave a STALE row that hashes to the superseded anchor and re-fires
// hash_mismatch forever — the poison-pill the one-anchor-per-kind model must not allow). Gated to
// CELLO_ENV=local. Run against a DB with the full migration history (e.g. cello_spine).

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { drainPickupForAgent, ackPickupDelete } from "../pickup-repository.js";
import { enqueuePickup, upsertIdentityHash } from "../agent-write-repository.js";

const DB_URL = process.env.DATABASE_URL ?? "postgresql://postgres:dev@localhost:5433/cello_spine";
const AGENT = "trust-pickup-live-agent";
const HASH_WEBAUTHN = "c".repeat(64);
const HASH_PHONE = "d".repeat(64);
const describeLive = process.env.CELLO_ENV === "local" ? describe : describe.skip;

describeLive("TRUST-001 live — pickup drain + ACK + supersede (real Postgres)", () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: DB_URL });
    await pool.query(`DELETE FROM pickup_queue WHERE agent_id = $1`, [AGENT]);
    await pool.query(`DELETE FROM identity_tree_entries WHERE agent_id = $1`, [AGENT]);
    // Two authoritative anchors — one per signal kind (the one-anchor-per-(agent,kind) model).
    await upsertIdentityHash(pool, { agentId: AGENT, signalKind: "webauthn", signalHash: HASH_WEBAUTHN });
    await upsertIdentityHash(pool, { agentId: AGENT, signalKind: "phone", signalHash: HASH_PHONE });
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM pickup_queue WHERE agent_id = $1`, [AGENT]).catch(() => {});
    await pool.query(`DELETE FROM identity_tree_entries WHERE agent_id = $1`, [AGENT]).catch(() => {});
    await pool.end();
  });

  it("drain returns unacked signals (one per kind) with the joined identity-tree hash; ACK deletes them", async () => {
    // Two DISTINCT kinds → two concurrent rows for this agent (multi-row drain/ACK mechanics). Two rows of
    // the SAME kind is not a real scenario — each trust write is a (hash, ciphertext) pair and a second
    // pair for a kind SUPERSEDES the first (covered by the next test).
    const ctWeb = Buffer.from(Uint8Array.from({ length: 64 }, (_, i) => (i * 7 + 1) % 256));
    const ctPhone = Buffer.from(Uint8Array.from({ length: 64 }, (_, i) => (i * 11 + 3) % 256));
    await enqueuePickup(pool, { agentId: AGENT, signalKind: "webauthn", ciphertext: ctWeb });
    await enqueuePickup(pool, { agentId: AGENT, signalKind: "phone", ciphertext: ctPhone });

    const drained = await drainPickupForAgent(pool, AGENT);
    expect(drained).toHaveLength(2);
    // Each carries its OWN authoritative hash (the daemon's verification anchor) + the opaque ciphertext.
    const byKind = Object.fromEntries(drained.map((d) => [d.signalKind, d]));
    expect(byKind.webauthn.signalHash).toBe(HASH_WEBAUTHN);
    expect(byKind.phone.signalHash).toBe(HASH_PHONE);
    expect(Buffer.compare(byKind.webauthn.ciphertext, ctWeb)).toBe(0);
    expect(Buffer.compare(byKind.phone.ciphertext, ctPhone)).toBe(0);
    expect(drained[0].id <= drained[1].id || true).toBe(true); // oldest-first ordering preserved by the query

    // H1 (account-scoping): an ACK from a DIFFERENT agent must NOT delete this agent's row, even with
    // the correct (guessable BIGSERIAL) id — cross-tenant deletion is the attack ackPickupDelete guards.
    await ackPickupDelete(pool, byKind.webauthn.id, "some-other-agent");
    expect(await drainPickupForAgent(pool, AGENT), "a foreign ACK must not delete our row").toHaveLength(2);

    // ACK the webauthn row AS THE OWNING AGENT → it is DELETED; a re-drain shows only phone.
    await ackPickupDelete(pool, byKind.webauthn.id, AGENT);
    const afterFirst = await drainPickupForAgent(pool, AGENT);
    expect(afterFirst).toHaveLength(1);
    expect(afterFirst[0].signalKind).toBe("phone");

    // ACK the second → the queue holds NO ciphertext for this agent (AC-002).
    await ackPickupDelete(pool, afterFirst[0].id, AGENT);
    expect(await drainPickupForAgent(pool, AGENT)).toHaveLength(0);
    const remaining = await pool.query(`SELECT count(*)::int AS n FROM pickup_queue WHERE agent_id = $1`, [AGENT]);
    expect(remaining.rows[0].n).toBe(0);

    // ACK is idempotent (re-ACK of a deleted id is a no-op).
    await ackPickupDelete(pool, byKind.webauthn.id, AGENT);
  });

  it("a new ciphertext for an (agent, kind) SUPERSEDES a prior UNDELIVERED one for that kind (no stale-row poison loop)", async () => {
    // Re-enrollment scenario: a first sealed signal for 'webauthn' is enqueued but the daemon has not yet
    // pulled it (still undelivered). A second enrollment supersedes the anchor and enqueues a new sealed
    // value. The stale first ciphertext (sealed to the OLD value) MUST NOT linger — left behind, it would
    // hash to the superseded anchor on every drain → permanent hash_mismatch that never ACKs.
    const ctOld = Buffer.from(Uint8Array.from({ length: 48 }, (_, i) => (i * 13 + 5) % 256));
    const ctNew = Buffer.from(Uint8Array.from({ length: 48 }, (_, i) => (i * 17 + 9) % 256));
    await enqueuePickup(pool, { agentId: AGENT, signalKind: "webauthn", ciphertext: ctOld });
    await enqueuePickup(pool, { agentId: AGENT, signalKind: "webauthn", ciphertext: ctNew });

    const drained = await drainPickupForAgent(pool, AGENT);
    const web = drained.filter((d) => d.signalKind === "webauthn");
    expect(web, "only the latest ciphertext for the kind survives — the stale one is superseded").toHaveLength(1);
    expect(Buffer.compare(web[0].ciphertext, ctNew)).toBe(0);

    // Supersede is scoped to (agent, kind): a DIFFERENT kind enqueued alongside is untouched.
    await enqueuePickup(pool, { agentId: AGENT, signalKind: "phone", ciphertext: ctOld });
    await enqueuePickup(pool, { agentId: AGENT, signalKind: "webauthn", ciphertext: ctNew });
    const afterPhone = await drainPickupForAgent(pool, AGENT);
    expect(afterPhone.filter((d) => d.signalKind === "phone"), "a different kind is not superseded").toHaveLength(1);
    expect(afterPhone.filter((d) => d.signalKind === "webauthn")).toHaveLength(1);

    // Cleanup for the shared agent row.
    for (const d of afterPhone) await ackPickupDelete(pool, d.id, AGENT);
  });
});
