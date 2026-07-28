// PgAeStore — the pg-backed anti-entropy store, proven against the REAL directory schema
// (M12 DOD-AE-APPEND-1 / DOD-AE-MUTABLE-1; the DB half of /cello/anti-entropy/1.0.0).
// Gated CELLO_ENV=local (needs the directory Postgres at Docker Compose :5433, migrated to V49+).
//
// Covers the four tables this store round-trips end to end:
//   Tier-A (append-only, insert-if-absent): agent_profiles, agent_revocations
//   Tier-B (mutable, atomic merge-upsert):  agent_suspensions (kill switch), agent_presence
//
// The proofs that matter:
//  - advertise digests are computed by the SAME encoders the logic layer uses (so two nodes over
//    identical rows agree) — including BYTEA hex (agent_revocations.signature) and, for presence,
//    UTC-anchored epoch-millis (the `timestamp`-without-tz columns must be node-TZ-independent).
//  - suspension version is STABLE across an updated_at-only change (the §4 merge forbids wall-clock)
//    and MOVES on a paused/seq change.
//  - applyTierA is insert-if-absent by NATURAL key (a second apply of the same record inserts 0).
//  - applyTierB runs the audited merges: burn is monotonic OR even when the incoming seq LOSES;
//    higher seq wins; presence is wall-clock LWW. A converged re-apply changes nothing (termination).

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import pg from "pg";
import { PgAeStore } from "../pg-ae-store.js";
import { encodeTierARecord, AGENT_REVOCATIONS_SPEC, AGENT_PROFILES_SPEC } from "../ae-table-encoders.js";
import { encodeTierBVersion, SUSPENSION_VERSION_SPEC } from "../ae-mutable-version.js";
import { runAntiEntropyRound, type AeStoreView } from "../anti-entropy-engine.js";
import type { SuspensionRecord } from "../suspension-merge.js";
import type { PresenceRecord } from "../presence-merge.js";
import { configurePgTypes } from "../pg-type-config.js";

configurePgTypes();

const DB_URL = process.env.DATABASE_URL ?? "postgresql://postgres:dev@localhost:5433/cello_dev";
const describeLive = process.env.CELLO_ENV === "local" ? describe : describe.skip;

// All test keys are prefixed so cleanup is a scoped DELETE (the store uses its own pooled
// connections for the atomic Tier-B txn, so a single-client BEGIN/ROLLBACK can't isolate it).
const P = "aetest-";
const SIG_HEX = "ab".repeat(64); // 64-byte signature as hex
// agent_suspensions.authorized_by_account is NOT NULL — a real suspension always records the
// authorizing account (the write path sets it). Use a fixed UUID across fixtures + bodies.
const ACC = "00000000-0000-0000-0000-0000000000ae";

describeLive("PgAeStore — pg-backed anti-entropy (real schema)", () => {
  let pool: pg.Pool;
  let store: PgAeStore;
  // A store whose backend session runs in a NON-UTC timezone — proves the TIMESTAMPTZ epoch
  // coercions are node-TZ-independent (a bug using AT TIME ZONE would corrupt the instant here).
  let tzPool: pg.Pool;
  let tzStore: PgAeStore;

  beforeAll(() => {
    pool = new pg.Pool({ connectionString: DB_URL });
    store = new PgAeStore(pool);
    tzPool = new pg.Pool({ connectionString: DB_URL, options: "-c timezone=America/New_York" });
    tzStore = new PgAeStore(tzPool);
  });
  afterAll(async () => { await pool.end(); await tzPool.end(); });

  beforeEach(async () => {
    // Scoped cleanup — leave every other row untouched.
    await pool.query(`DELETE FROM agent_suspensions WHERE agent_id LIKE $1`, [`${P}%`]);
    await pool.query(`DELETE FROM agent_presence WHERE k_local_pubkey LIKE $1`, [`${P}%`]);
    await pool.query(`DELETE FROM agent_revocations WHERE agent_id LIKE $1`, [`${P}%`]);
    await pool.query(`DELETE FROM agent_profiles WHERE k_local_pubkey LIKE $1`, [`${P}%`]);
  });

  // ── Tier-A: advertise digest matches the encoder (incl. BYTEA hex) ──────────────────────────
  it("advertises agent_revocations hashes matching encodeTierARecord (BYTEA hex-encoded)", async () => {
    const row = { agent_id: `${P}rev1`, epoch_id: "e1", reason: "compromise", signature: SIG_HEX, revoked_at: "1785200000000" };
    await pool.query(
      `INSERT INTO agent_revocations (agent_id, epoch_id, reason, signature, revoked_at)
       VALUES ($1, $2, $3, decode($4,'hex'), $5)`,
      [row.agent_id, row.epoch_id, row.reason, row.signature, row.revoked_at],
    );
    const hashes = await store.tierARecordHashes("agent_revocations");
    // The store must hex-encode signature so the hash covers hex, never pg's Buffer JSON.
    const expected = encodeTierARecord(AGENT_REVOCATIONS_SPEC, row).hash;
    expect(hashes).toContain(expected);
  });

  // ── Tier-A: insert-if-absent by natural key ─────────────────────────────────────────────────
  it("applyTierA inserts a missing revocation, and a second apply of the same record inserts 0", async () => {
    const body = { agent_id: `${P}rev2`, epoch_id: "e1", reason: "x", signature: SIG_HEX, revoked_at: "1785200000001" };
    const hash = encodeTierARecord(AGENT_REVOCATIONS_SPEC, body).hash;

    const first = await store.applyTierA("agent_revocations", [{ hash, body }]);
    expect(first).toBe(1);
    const second = await store.applyTierA("agent_revocations", [{ hash, body }]);
    expect(second).toBe(0); // insert-if-absent by agent_id — no duplicate, no overwrite

    const got = await pool.query(`SELECT encode(signature,'hex') AS sig FROM agent_revocations WHERE agent_id=$1`, [body.agent_id]);
    expect(got.rows[0].sig).toBe(SIG_HEX); // round-tripped through decode/encode
  });

  it("serveTierA returns only the requested record bodies", async () => {
    const b1 = { agent_id: `${P}s1`, epoch_id: "e", reason: null, signature: SIG_HEX, revoked_at: "1" };
    const b2 = { agent_id: `${P}s2`, epoch_id: "e", reason: null, signature: SIG_HEX, revoked_at: "2" };
    const h1 = encodeTierARecord(AGENT_REVOCATIONS_SPEC, b1).hash;
    await store.applyTierA("agent_revocations", [{ hash: h1, body: b1 }, { hash: encodeTierARecord(AGENT_REVOCATIONS_SPEC, b2).hash, body: b2 }]);

    const served = await store.serveTierA("agent_revocations", [h1]);
    expect(served.map((r) => r.hash)).toEqual([h1]);
    expect((served[0].body as Record<string, unknown>).agent_id).toBe(b1.agent_id);
  });

  // ── Tier-B: suspension version stability (the §4 wall-clock exclusion) ───────────────────────
  it("suspension version is STABLE across an updated_at-only change, and MOVES on a paused change", async () => {
    const id = `${P}susp-ver`;
    await pool.query(
      `INSERT INTO agent_suspensions (agent_id, paused, burned, suspension_seq, origin_node, authorized_by_account, updated_at)
       VALUES ($1, true, false, 1, 'nodeA', $2, now())`, [id, ACC],
    );
    const v1 = (await store.tierBVersions("agent_suspensions")).get(id);
    // Touch ONLY updated_at (a display-only column excluded from the merge + version).
    await pool.query(`UPDATE agent_suspensions SET updated_at = now() + interval '1 hour' WHERE agent_id=$1`, [id]);
    const v2 = (await store.tierBVersions("agent_suspensions")).get(id);
    expect(v2).toBe(v1); // clock skew alone must never move the version → never a spurious pull

    await pool.query(`UPDATE agent_suspensions SET paused = false, suspension_seq = 2 WHERE agent_id=$1`, [id]);
    const v3 = (await store.tierBVersions("agent_suspensions")).get(id);
    expect(v3).not.toBe(v1); // a real merge-relevant change DOES move it
  });

  // ── Tier-B: the kill-switch merge, applied atomically ───────────────────────────────────────
  it("applyTierB burn is monotonic OR even when the incoming record LOSES the seq contest", async () => {
    const id = `${P}burn`;
    // Local: higher seq, un-paused, NOT burned. Incoming: lower seq, burned.
    await pool.query(
      `INSERT INTO agent_suspensions (agent_id, paused, burned, suspension_seq, origin_node, authorized_by_account, updated_at)
       VALUES ($1, false, false, 9, 'local', $2, now())`, [id, ACC],
    );
    const incoming: SuspensionRecord = {
      agent_id: id, paused: true, burned: true, reason: "kill", authorized_by_account: ACC, suspension_seq: 3, origin_node: "peer",
    };
    await store.applyTierB("agent_suspensions", [{ key: id, body: incoming }]);

    const r = (await pool.query(`SELECT paused, burned, suspension_seq FROM agent_suspensions WHERE agent_id=$1`, [id])).rows[0];
    expect(r.burned).toBe(true);   // burn survived despite losing the seq contest — irreversible
    expect(r.paused).toBe(false);  // higher local seq's paused won
    expect(Number(r.suspension_seq)).toBe(9);
  });

  it("applyTierB: higher incoming seq wins; a converged re-apply changes nothing (termination)", async () => {
    const id = `${P}seq`;
    await pool.query(
      `INSERT INTO agent_suspensions (agent_id, paused, burned, suspension_seq, origin_node, authorized_by_account, updated_at)
       VALUES ($1, false, false, 2, 'local', $2, now())`, [id, ACC],
    );
    const incoming: SuspensionRecord = {
      agent_id: id, paused: true, burned: false, reason: "pause", authorized_by_account: ACC, suspension_seq: 5, origin_node: "peer",
    };
    const applied = await store.applyTierB("agent_suspensions", [{ key: id, body: incoming }]);
    expect(applied).toBe(1);
    const r = (await pool.query(`SELECT paused, suspension_seq, origin_node FROM agent_suspensions WHERE agent_id=$1`, [id])).rows[0];
    expect(r.paused).toBe(true);
    expect(Number(r.suspension_seq)).toBe(5);
    expect(r.origin_node).toBe("peer");
    // Re-applying the SAME record now converges to identical state → 0 changes (termination).
    const again = await store.applyTierB("agent_suspensions", [{ key: id, body: incoming }]);
    expect(again).toBe(0);
  });

  it("applyTierB inserts a suspension that is absent locally", async () => {
    const id = `${P}new`;
    const incoming: SuspensionRecord = {
      agent_id: id, paused: true, burned: false, reason: null, authorized_by_account: ACC, suspension_seq: 1, origin_node: "peer",
    };
    const applied = await store.applyTierB("agent_suspensions", [{ key: id, body: incoming }]);
    expect(applied).toBe(1);
    const r = (await pool.query(`SELECT paused, suspension_seq FROM agent_suspensions WHERE agent_id=$1`, [id])).rows[0];
    expect(r.paused).toBe(true);
    expect(Number(r.suspension_seq)).toBe(1);
  });

  // ── Tier-B: presence LWW, UTC-anchored epoch versions ───────────────────────────────────────
  it("presence apply is wall-clock LWW: a newer updated_at wins, an older one loses", async () => {
    const k = `${P}pres`;
    const base = 1785200000000;
    await pool.query(
      `INSERT INTO agent_presence (k_local_pubkey, owning_node_id, online, last_seen_at, updated_at)
       VALUES ($1, 'nodeA', true, to_timestamp($2/1000.0) AT TIME ZONE 'UTC', to_timestamp($2/1000.0) AT TIME ZONE 'UTC')`,
      [k, base],
    );
    // Older write should NOT win.
    const older: PresenceRecord = { k_local_pubkey: k, online: false, owning_node_id: "nodeB", last_seen_at: String(base - 1000), updated_at: String(base - 1000) };
    await store.applyTierB("agent_presence", [{ key: k, body: older }]);
    let r = (await pool.query(`SELECT online, owning_node_id FROM agent_presence WHERE k_local_pubkey=$1`, [k])).rows[0];
    expect(r.online).toBe(true); // local (newer) survived

    // Newer write wins wholesale (online + owning node migrate).
    const newer: PresenceRecord = { k_local_pubkey: k, online: false, owning_node_id: "nodeC", last_seen_at: String(base + 5000), updated_at: String(base + 5000) };
    await store.applyTierB("agent_presence", [{ key: k, body: newer }]);
    r = (await pool.query(`SELECT online, owning_node_id FROM agent_presence WHERE k_local_pubkey=$1`, [k])).rows[0];
    expect(r.online).toBe(false);
    expect(r.owning_node_id).toBe("nodeC");
  });

  it("presence epoch coercion is node-TZ-INDEPENDENT: write on a non-UTC session, read the exact millis", async () => {
    // The teeth: this must hold under a NON-UTC backend session. The old AT-TIME-ZONE-'UTC' write
    // down-cast to a bare timestamp and reinterpreted it in the session TZ, so under America/New_York
    // the stored instant shifted 5h and the served millis would differ. The fix (plain to_timestamp
    // into TIMESTAMPTZ + plain EXTRACT(EPOCH)) round-trips the exact instant in any session TZ.
    const k = `${P}pres-tz`;
    const ms = 1785200000123;
    const incoming: PresenceRecord = { k_local_pubkey: k, online: true, owning_node_id: "nodeA", last_seen_at: String(ms), updated_at: String(ms) };
    await tzStore.applyTierB("agent_presence", [{ key: k, body: incoming }]);
    const served = (await tzStore.serveTierB("agent_presence", [k]))[0].body as PresenceRecord;
    expect(served.updated_at).toBe(String(ms));
    expect(served.last_seen_at).toBe(String(ms));
    // And a UTC-session node reads the SAME millis for that row → cross-node version agreement.
    const utcServed = (await store.serveTierB("agent_presence", [k]))[0].body as PresenceRecord;
    expect(utcServed.updated_at).toBe(String(ms));
  });

  // ── Finding 2: origin_node NULL (pre-V49) must not cause perpetual re-pull ───────────────────
  it("a NULL origin_node (pre-V49 row): the ADVERTISE version equals the SERVED-body version (no null↔'' split)", async () => {
    const id = `${P}nullorigin`;
    // A burned, pre-migration row: origin_node left NULL exactly as V49's backfill leaves it.
    await pool.query(
      `INSERT INTO agent_suspensions (agent_id, paused, burned, suspension_seq, origin_node, authorized_by_account, updated_at)
       VALUES ($1, true, true, 0, NULL, $2, now())`, [id, ACC],
    );
    // The bug: advertise hashed the RAW row (origin_node=null) while a peer hashes the SERVED body
    // (rowToBody → ""). If those differ, two nodes holding identical state advertise different
    // versions forever → perpetual re-pull on the kill-switch table. The COALESCE(origin_node,'')
    // at the SELECT makes the advertise path see "" too, so they MUST match.
    const advertiseVersion = (await store.tierBVersions("agent_suspensions")).get(id);
    const served = (await store.serveTierB("agent_suspensions", [id]))[0].body as SuspensionRecord;
    const peerVersion = encodeTierBVersion(SUSPENSION_VERSION_SPEC, {
      agent_id: served.agent_id, paused: served.paused, burned: served.burned, reason: served.reason,
      authorized_by_account: served.authorized_by_account, suspension_seq: String(served.suspension_seq),
      origin_node: served.origin_node,
    }).versionHash;
    expect(advertiseVersion).toBe(peerVersion);
  });

  // ── Finding 1: a concurrent kill-switch burn during an AE apply must NOT be reverted ─────────
  it("applyTierB FOR UPDATE preserves a burn committed by the write-seam mid-apply (no un-burn)", async () => {
    const id = `${P}race`;
    await pool.query(
      `INSERT INTO agent_suspensions (agent_id, paused, burned, suspension_seq, origin_node, authorized_by_account, updated_at)
       VALUES ($1, false, false, 5, 'local', $2, now())`, [id, ACC],
    );
    // Simulate the operator kill switch holding an uncommitted burn (seq 6) on the row.
    const seam = await pool.connect();
    await seam.query("BEGIN");
    await seam.query(
      `UPDATE agent_suspensions SET burned = true, suspension_seq = 6, updated_at = now() WHERE agent_id = $1`, [id],
    );
    // AE applies a LOSING (lower-seq, non-burned) record. Its SELECT … FOR UPDATE must block on the
    // seam's row lock until the burn commits, then merge OVER the committed burn (OR keeps it).
    const losing: SuspensionRecord = {
      agent_id: id, paused: false, burned: false, reason: null, authorized_by_account: ACC, suspension_seq: 3, origin_node: "peer",
    };
    const aeP = store.applyTierB("agent_suspensions", [{ key: id, body: losing }]);
    await new Promise((r) => setTimeout(r, 100)); // let AE reach the blocking FOR UPDATE
    await seam.query("COMMIT");
    seam.release();
    await aeP;

    const r = (await pool.query(`SELECT burned, suspension_seq FROM agent_suspensions WHERE agent_id=$1`, [id])).rows[0];
    expect(r.burned).toBe(true);            // the burn survived the concurrent losing AE apply
    expect(Number(r.suspension_seq)).toBe(6); // higher committed seq won; no regression to 5/3
  });

  // ── Engine wiring: a real anti-entropy round with the pg store as LOCAL ──────────────────────
  it("runAntiEntropyRound(pg, peer) pulls a newer suspension into pg, then terminates", async () => {
    const id = `${P}engine`;
    await pool.query(
      `INSERT INTO agent_suspensions (agent_id, paused, burned, suspension_seq, origin_node, authorized_by_account, updated_at)
       VALUES ($1, true, false, 2, 'local', $2, now())`, [id, ACC],
    );
    // A minimal in-memory peer advertising ONLY the suspension table, holding a newer (seq 3) clear.
    const newer: SuspensionRecord = {
      agent_id: id, paused: false, burned: false, reason: "clear", authorized_by_account: ACC, suspension_seq: 3, origin_node: "peer",
    };
    const peer: AeStoreView = {
      tierATables: () => [],
      tierBTables: () => ["agent_suspensions"],
      tierARecordHashes: () => [],
      tierBVersions: () => new Map([[id, encodeTierBVersion(SUSPENSION_VERSION_SPEC, {
        agent_id: newer.agent_id, paused: newer.paused, burned: newer.burned, reason: newer.reason,
        authorized_by_account: newer.authorized_by_account, suspension_seq: String(newer.suspension_seq),
        origin_node: newer.origin_node,
      }).versionHash]]),
      serveTierA: () => [],
      serveTierB: (_t, keys) => keys.filter((k) => k === id).map((k) => ({ key: k, body: newer })),
      applyTierA: () => 0,
      applyTierB: () => 0,
    };

    const first = await runAntiEntropyRound(store, peer);
    expect(first.tierBApplied).toBe(1); // the newer clear landed in pg through the real engine plan
    const r = (await pool.query(`SELECT paused, suspension_seq FROM agent_suspensions WHERE agent_id=$1`, [id])).rows[0];
    expect(r.paused).toBe(false);
    expect(Number(r.suspension_seq)).toBe(3);

    const second = await runAntiEntropyRound(store, peer);
    // TRUE termination: nothing was even pulled — pg's post-apply ADVERTISED version equals the
    // peer's, so the plan is empty. (tierBApplied 0 alone would also pass under a perpetual
    // re-pull-merge-to-same-row loop — the cross-encoding bug class; pulled:0 pins it out.)
    expect(second.tierBPulled).toBe(0);
    expect(second.tierBApplied).toBe(0);
  });

  // ── Tier-A coverage: agent_profiles insert-if-absent ─────────────────────────────────────────
  it("applyTierA inserts an agent_profiles row and is idempotent by k_local_pubkey", async () => {
    const body = { k_local_pubkey: `${P}kp`, primary_pubkey: "pp", ml_dsa_pubkey: "", phone_stub_hash: "", registered_at: "1785200000000" };
    const hash = encodeTierARecord(AGENT_PROFILES_SPEC, body).hash;
    expect(await store.applyTierA("agent_profiles", [{ hash, body }])).toBe(1);
    expect(await store.applyTierA("agent_profiles", [{ hash, body }])).toBe(0); // insert-if-absent
  });
});
