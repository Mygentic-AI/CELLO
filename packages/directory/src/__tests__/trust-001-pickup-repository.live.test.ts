// TRUST-001 LIVE — pickup queue drain + ACK + supersede against the REAL directory Postgres.
//
// Proves the daemon-delivery half's queue mechanics: drain returns an agent's unacked sealed signals
// (oldest first) EACH joined to its authoritative identity-tree hash (AC-001 verification anchor);
// ACK DELETES the row so the queue holds NO ciphertext for that signal afterward (AC-002); and a new
// ciphertext for an (agent, signal_kind) SUPERSEDES a prior undelivered one for that same kind (so a
// re-enrolled signal cannot leave a STALE row that hashes to the superseded anchor and re-fires
// hash_mismatch forever). Gated to CELLO_ENV=local. Run against a DB with the full migration history.
//
// RE-POINTED 2026-07-29 (M10B). This file had been RED since V48 (2026-07-25) and nobody noticed —
// two independent staleness problems, fixed by SUBJECT (the pickup repository is alive; only its
// drivers and one assertion were dead):
//   1. It seeded `identity_tree_entries` for the drain's hash anchor. V48 DROPPED that table; M10
//      delivery carries the hash on the pickup row itself (V47 `pickup_queue.signal_hash`). The seeding
//      is gone and `enqueuePickup` is passed `signalHash` directly — which is what production does.
//   2. Its supersede assertions were "one pending per (agent, KIND)". V52 (M10B-D23) deliberately
//      re-keys that to (agent, kind, HASH), because the old rule SILENTLY DESTROYED the second
//      endorsement of a subject. Those assertions now test supersede-by-CONTENT. Everything else —
//      agent-scoping, the co-tenant guard, ACK idempotence, oldest-first, the cross-tenant ACK guard —
//      is preserved exactly, because none of it changed.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { drainPickupForAgent, ackPickupDelete, sweepUndeliverablePickups } from "../pickup-repository.js";
import { enqueuePickup } from "../agent-write-repository.js";

const DB_URL = process.env.DATABASE_URL ?? "postgresql://postgres:dev@localhost:5433/cello_spine";
const AGENT = "trust-pickup-live-agent";
const OTHER_AGENT = "trust-pickup-live-other-agent"; // a co-tenant — its pickups must survive AGENT's supersede
const HASH_WEBAUTHN = "c".repeat(64);
const HASH_PHONE = "d".repeat(64);
const describeLive = process.env.CELLO_ENV === "local" ? describe : describe.skip;

describeLive("TRUST-001 live — pickup drain + ACK + supersede (real Postgres)", () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: DB_URL });
    await pool.query(`DELETE FROM pickup_queue WHERE agent_id = ANY($1)`, [[AGENT, OTHER_AGENT]]);
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM pickup_queue WHERE agent_id = ANY($1)`, [[AGENT, OTHER_AGENT]]).catch(() => {});
    await pool.end();
  });

  it("drain returns unacked signals (one per kind) with the joined identity-tree hash; ACK deletes them", async () => {
    // Two DISTINCT kinds → two concurrent rows for this agent (multi-row drain/ACK mechanics). Two rows of
    // the SAME kind is not a real scenario — each trust write is a (hash, ciphertext) pair and a second
    // pair for a kind SUPERSEDES the first (covered by the next test).
    const ctWeb = Buffer.from(Uint8Array.from({ length: 64 }, (_, i) => (i * 7 + 1) % 256));
    const ctPhone = Buffer.from(Uint8Array.from({ length: 64 }, (_, i) => (i * 11 + 3) % 256));
    await enqueuePickup(pool, { agentId: AGENT, signalKind: "webauthn", ciphertext: ctWeb, owningNodeId: "test-node", signalHash: HASH_WEBAUTHN });
    await enqueuePickup(pool, { agentId: AGENT, signalKind: "phone", ciphertext: ctPhone, owningNodeId: "test-node", signalHash: HASH_PHONE });

    const drained = await drainPickupForAgent(pool, AGENT);
    expect(drained).toHaveLength(2);
    // Each carries its OWN authoritative hash (the daemon's verification anchor) + the opaque ciphertext.
    const byKind = Object.fromEntries(drained.map((d) => [d.signalKind, d]));
    expect(byKind.webauthn.signalHash).toBe(HASH_WEBAUTHN);
    expect(byKind.phone.signalHash).toBe(HASH_PHONE);
    expect(Buffer.compare(byKind.webauthn.ciphertext, ctWeb)).toBe(0);
    expect(Buffer.compare(byKind.phone.ciphertext, ctPhone)).toBe(0);
    // Oldest-first: webauthn was enqueued before phone, so it drains first (ORDER BY created_at).
    expect(drained[0].signalKind).toBe("webauthn");

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

  it("a re-enqueue of the SAME signal_hash supersedes in place; a DIFFERENT hash coexists (M10B-D23)", async () => {
    // CHANGED BY V52, deliberately. The old rule was "one pending per (agent, KIND)", which meant a
    // second endorsement of the same subject overwrote the first — silent data loss, since endorsements
    // are inherently many-per-kind. Supersession now keys on CONTENT: re-delivering the identical
    // envelope collapses in place (so V37's READ COMMITTED duplicate race stays closed), while two
    // genuinely different signals of the same kind both survive.
    const ctOld = Buffer.from(Uint8Array.from({ length: 48 }, (_, i) => (i * 13 + 5) % 256));
    const ctNew = Buffer.from(Uint8Array.from({ length: 48 }, (_, i) => (i * 17 + 9) % 256));
    await enqueuePickup(pool, { agentId: AGENT, signalKind: "webauthn", ciphertext: ctOld, owningNodeId: "test-node", signalHash: HASH_WEBAUTHN });
    await enqueuePickup(pool, { agentId: AGENT, signalKind: "webauthn", ciphertext: ctNew, owningNodeId: "test-node", signalHash: HASH_WEBAUTHN });

    const drained = await drainPickupForAgent(pool, AGENT);
    const web = drained.filter((d) => d.signalKind === "webauthn");
    expect(web, "same hash → superseded in place, one row").toHaveLength(1);
    expect(Buffer.compare(web[0].ciphertext, ctNew)).toBe(0);

    // The defect V52 fixes: a DIFFERENT hash for the same (agent, kind) must NOT overwrite.
    await enqueuePickup(pool, { agentId: AGENT, signalKind: "webauthn", ciphertext: ctOld, owningNodeId: "test-node", signalHash: "e".repeat(64) });
    const bothHashes = (await drainPickupForAgent(pool, AGENT)).filter((d) => d.signalKind === "webauthn");
    expect(bothHashes, "two distinct signals of one kind BOTH survive — this is the M10B fix").toHaveLength(2);

    // Supersede is scoped to (agent, kind): a DIFFERENT kind enqueued alongside is untouched.
    await enqueuePickup(pool, { agentId: AGENT, signalKind: "phone", ciphertext: ctOld, owningNodeId: "test-node", signalHash: HASH_PHONE });
    await enqueuePickup(pool, { agentId: AGENT, signalKind: "webauthn", ciphertext: ctNew, owningNodeId: "test-node", signalHash: HASH_WEBAUTHN });
    const afterPhone = await drainPickupForAgent(pool, AGENT);
    expect(afterPhone.filter((d) => d.signalKind === "phone"), "a different kind is not superseded").toHaveLength(1);
    expect(afterPhone.filter((d) => d.signalKind === "webauthn"), "the two webauthn hashes are still distinct rows").toHaveLength(2);

    // Supersede is also scoped to agent_id — a DIFFERENT agent's pending pickup of the SAME kind must
    // SURVIVE our enqueue (an unscoped DELETE would silently destroy other tenants' undelivered signals,
    // the cross-tenant twin of the H1 ACK guard). Seed OTHER_AGENT's webauthn pickup, then re-enqueue
    // AGENT's webauthn; OTHER_AGENT's row must remain.
    await enqueuePickup(pool, { agentId: OTHER_AGENT, signalKind: "webauthn", ciphertext: ctOld, owningNodeId: "test-node", signalHash: HASH_WEBAUTHN });
    await enqueuePickup(pool, { agentId: AGENT, signalKind: "webauthn", ciphertext: ctNew, owningNodeId: "test-node", signalHash: HASH_WEBAUTHN });
    const otherDrain = await drainPickupForAgent(pool, OTHER_AGENT);
    expect(
      otherDrain.filter((d) => d.signalKind === "webauthn"),
      "supersede must be scoped to agent_id — a co-tenant's pending pickup is untouched",
    ).toHaveLength(1);
    expect(Buffer.compare(otherDrain.filter((d) => d.signalKind === "webauthn")[0].ciphertext, ctOld)).toBe(0);

    // Cleanup for the shared agent rows.
    for (const d of afterPhone) await ackPickupDelete(pool, d.id, AGENT);
    for (const d of otherDrain) await ackPickupDelete(pool, d.id, OTHER_AGENT);
    const leftover = (await drainPickupForAgent(pool, AGENT)).find((d) => d.signalKind === "webauthn");
    if (leftover) await ackPickupDelete(pool, leftover.id, AGENT);
  });

  it("the invariant is DB-ENFORCED: a raw duplicate pending INSERT for the same (agent,kind,HASH) is rejected", async () => {
    // The supersede is best-effort in app code under a concurrent same-(agent,kind) race; the V37 partial
    // UNIQUE index makes "one pending per kind" a real constraint. Prove it directly: a second raw INSERT
    // for the same (agent, kind) with acked_at NULL — exactly what two racing enqueues would attempt —
    // must be REJECTED by the database, not silently produce a second poison-pill row.
    const ct = Buffer.from(Uint8Array.from({ length: 32 }, (_, i) => (i * 3 + 1) % 256));
    await pool.query(`INSERT INTO pickup_queue (agent_id, signal_kind, ciphertext, signal_hash) VALUES ($1, 'webauthn', $2, $3)`, [AGENT, ct, HASH_WEBAUTHN]);
    await expect(
      pool.query(`INSERT INTO pickup_queue (agent_id, signal_kind, ciphertext, signal_hash) VALUES ($1, 'webauthn', $2, $3)`, [AGENT, ct, HASH_WEBAUTHN]),
      "a second pending row for the same (agent,kind,hash) must violate the unique index",
    ).rejects.toThrow(/duplicate key|unique/i);
    // A DIFFERENT HASH of the same kind is now ALLOWED — that is the M10B-D23 change, asserted directly.
    await pool.query(`INSERT INTO pickup_queue (agent_id, signal_kind, ciphertext, signal_hash) VALUES ($1, 'webauthn', $2, $3)`, [AGENT, ct, "f".repeat(64)]);
    // A DIFFERENT kind is still allowed, and the rows clear on ACK.
    await pool.query(`INSERT INTO pickup_queue (agent_id, signal_kind, ciphertext, signal_hash) VALUES ($1, 'phone', $2, $3)`, [AGENT, ct, HASH_PHONE]);
    for (const d of await drainPickupForAgent(pool, AGENT)) await ackPickupDelete(pool, d.id, AGENT);
    expect(await drainPickupForAgent(pool, AGENT)).toHaveLength(0);
  });

  it("sweepUndeliverablePickups deletes only ORPHANED (anchor-less) pending rows older than the TTL", async () => {
    // A pickup whose (agent,kind) has NO identity-tree anchor is undeliverable forever (the drain can
    // neither verify nor ACK it). The backstop deletes such rows once unambiguously orphaned (past TTL),
    // and ONLY those: a fresh anchor-less row (anchor may still be arriving) and an ANCHORED row of any
    // age both survive. 'orphan_kind' has no anchor for AGENT; 'webauthn' does (seeded in beforeAll).
    await pool.query(`DELETE FROM pickup_queue WHERE agent_id = $1`, [AGENT]);
    const ct = Buffer.from(Uint8Array.from({ length: 24 }, (_, i) => (i * 5 + 1) % 256));
    // (a) OLD anchor-less → must be swept.
    await pool.query(
      `INSERT INTO pickup_queue (agent_id, signal_kind, ciphertext, owning_node_id, created_at)
       VALUES ($1, 'orphan_kind', $2, 'test-node', now() - interval '48 hours')`,
      [AGENT, ct],
    );
    // (b) FRESH anchor-less → must survive (its anchor may still be in flight).
    await pool.query(
      `INSERT INTO pickup_queue (agent_id, signal_kind, ciphertext, owning_node_id, created_at)
       VALUES ($1, 'orphan_fresh', $2, 'test-node', now())`,
      [AGENT, ct],
    );
    // (c) OLD but SELF-ANCHORED — post-V48 "anchored" means the row carries its OWN signal_hash (V47),
    //     not that a row exists in the dropped identity_tree_entries → must survive (it IS deliverable).
    await pool.query(
      `INSERT INTO pickup_queue (agent_id, signal_kind, ciphertext, owning_node_id, created_at, signal_hash)
       VALUES ($1, 'webauthn', $2, 'test-node', now() - interval '48 hours', $3)`,
      [AGENT, ct, HASH_WEBAUTHN],
    );

    const swept = await sweepUndeliverablePickups(pool, "test-node", 24);
    expect(swept, "exactly one orphaned row (the old anchor-less one) is swept").toBe(1);

    const remaining = await drainPickupForAgent(pool, AGENT);
    const kinds = remaining.map((r) => r.signalKind).sort();
    expect(kinds, "the fresh anchor-less and the old anchored rows survive; only the old orphan is gone").toEqual([
      "orphan_fresh",
      "webauthn",
    ]);

    for (const d of remaining) await ackPickupDelete(pool, d.id, AGENT);
  });

  // ── M10 (M10-D22): an M10 wallet-signal delivery carries its OWN signal_hash on the pickup row and has
  // NO identity_tree_entries anchor (its anchor is signal_records). Two invariants the M8→M10 re-point
  // depends on: the drain must surface the row's own hash (not NULL), and the sweep must NOT treat an
  // anchor-less-but-self-anchored row as an orphan.
  const M10_HASH = "e".repeat(64);

  it("M10 drain: a row carrying its OWN signal_hash (no identity-tree anchor) drains that hash via COALESCE", async () => {
    await pool.query(`DELETE FROM pickup_queue WHERE agent_id = $1`, [AGENT]);
    const ct = Buffer.from(Uint8Array.from({ length: 40 }, (_, i) => (i * 13 + 2) % 256));
    // No upsertIdentityHash for 'phone' here (beforeAll seeded one — clear it so this row is genuinely
    // anchor-less, proving the hash comes from the ROW, not a stray JOIN).
    await pool.query(
      `INSERT INTO pickup_queue (agent_id, signal_kind, ciphertext, owning_node_id, signal_hash)
       VALUES ($1, 'phone', $2, 'test-node', $3)`,
      [AGENT, ct, M10_HASH],
    );
    const drained = await drainPickupForAgent(pool, AGENT);
    expect(drained).toHaveLength(1);
    expect(drained[0].signalHash, "the row's own signal_hash, not a NULL from the absent JOIN").toBe(M10_HASH);
    expect(Buffer.compare(drained[0].ciphertext, ct)).toBe(0);
    for (const d of drained) await ackPickupDelete(pool, d.id, AGENT);
  });

  it("M10 sweep: an OLD anchor-less row that carries its OWN signal_hash is NOT swept (it is deliverable)", async () => {
    await pool.query(`DELETE FROM pickup_queue WHERE agent_id = $1`, [AGENT]);
    const ct = Buffer.from(Uint8Array.from({ length: 24 }, (_, i) => (i * 3 + 5) % 256));
    // OLD (past TTL), anchor-less, but SELF-ANCHORED via pq.signal_hash → must survive the sweep.
    await pool.query(
      `INSERT INTO pickup_queue (agent_id, signal_kind, ciphertext, owning_node_id, signal_hash, created_at)
       VALUES ($1, 'phone', $2, 'test-node', $3, now() - interval '48 hours')`,
      [AGENT, ct, M10_HASH],
    );
    const swept = await sweepUndeliverablePickups(pool, "test-node", 24);
    expect(swept, "a self-anchored M10 row is NOT an orphan, even past TTL").toBe(0);
    expect(await drainPickupForAgent(pool, AGENT), "the M10 delivery survives and still drains").toHaveLength(1);
    for (const d of await drainPickupForAgent(pool, AGENT)) await ackPickupDelete(pool, d.id, AGENT);
  });
});
