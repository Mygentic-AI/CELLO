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
import { encodeTierARecord, AGENT_REVOCATIONS_SPEC, AGENT_PROFILES_SPEC, SIGNAL_RECORDS_SPEC } from "../ae-table-encoders.js";
import { encodeTierBVersion, SUSPENSION_VERSION_SPEC, DIRECTORY_NODE_HEARTBEAT_VERSION_SPEC } from "../ae-mutable-version.js";
import { runAntiEntropyRound, type AeStoreView } from "../anti-entropy-engine.js";
import { computeTableDigest } from "../set-reconciliation.js";
import { tierBTableDigest } from "../ae-round.js";
import type { SuspensionRecord } from "../suspension-merge.js";
import type { PresenceRecord } from "../presence-merge.js";
import type { DirectoryNodeHeartbeatRecord } from "../directory-node-heartbeat-merge.js";
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
    await pool.query(`DELETE FROM signal_records WHERE signal_hash LIKE $1`, [`${P}%`]);
    await pool.query(`DELETE FROM directory_nodes WHERE node_id LIKE $1`, [`${P}%`]);
  });

  // ── DOD-M15-HEARTBEAT-1: directory_nodes.last_heartbeat_at replicates as Tier B ──────────────
  //
  // Before this, every node read every OTHER node as never-heartbeated: `last_heartbeat_at` is
  // mutable and `directory_nodes` was Tier-A only, which hashes immutable columns. The column was
  // excluded by construction, so no query could show it missing — it simply never travelled.

  /** Seed a directory_nodes row at a given heartbeat instant (epoch millis; 0 = never). */
  const seedNode = async (nodeId: string, heartbeatMs: number): Promise<void> => {
    await pool.query(
      `INSERT INTO directory_nodes (node_id, region, status, last_heartbeat_at)
       VALUES ($1, $2, 'active', to_timestamp($3/1000.0))`,
      [nodeId, `${nodeId}-region`, heartbeatMs],
    );
  };

  /** A peer advertising ONLY directory_nodes' Tier-B half, holding one node at one heartbeat. */
  const heartbeatPeer = (nodeId: string, heartbeatMs: number): AeStoreView => {
    const body: DirectoryNodeHeartbeatRecord = { node_id: nodeId, last_heartbeat_at: String(heartbeatMs) };
    const versions = new Map([[
      nodeId,
      encodeTierBVersion(DIRECTORY_NODE_HEARTBEAT_VERSION_SPEC, body as unknown as Record<string, string>).versionHash,
    ]]);
    return {
      tierATables: () => [],
      tierBTables: () => ["directory_nodes"],
      tierARecordHashes: () => [],
      tierATableDigest: () => computeTableDigest([]),
      tierBTableDigest: () => tierBTableDigest(versions),
      tierBVersions: () => versions,
      serveTierA: () => [],
      serveTierB: (_t, keys) => keys.filter((k) => k === nodeId).map((k) => ({ key: k, body })),
      applyTierA: () => 0,
      applyTierB: () => 0,
    };
  };

  it("a node that was DOWN learns a peer's heartbeat through a real AE round, then terminates", async () => {
    // The DoD's user-visible claim: a node comes back and learns the others' heartbeats without a
    // restart. Locally this node is at epoch 0 — "registered, never heartbeated", which is exactly
    // what every node read for every peer before this line.
    const nodeId = `${P}europe-west1`;
    const fresh = 1785200060000;
    await seedNode(nodeId, 0);

    const first = await runAntiEntropyRound(store, heartbeatPeer(nodeId, fresh));
    expect(first.tierBApplied, "the peer's heartbeat should have landed").toBe(1);

    const row = (await pool.query(
      `SELECT (EXTRACT(EPOCH FROM last_heartbeat_at)*1000)::bigint AS ms, region
         FROM directory_nodes WHERE node_id=$1`, [nodeId],
    )).rows[0];
    // Assert the VALUE, not merely "it changed" — a merge that wrote now() would also move it.
    expect(String(row.ms)).toBe(String(fresh));
    // And the identity column Tier A owns is untouched by the Tier-B merge.
    expect(row.region).toBe(`${nodeId}-region`);

    const second = await runAntiEntropyRound(store, heartbeatPeer(nodeId, fresh));
    // TRUE termination: nothing is even PULLED. tierBApplied 0 alone would also pass under a
    // perpetual pull-merge-to-the-same-row loop, which is the cross-encoding bug class V65 exists
    // to prevent — pulled:0 is what pins it out.
    expect(second.tierBPulled).toBe(0);
    expect(second.tierBApplied).toBe(0);
  });

  it("a STALER heartbeat from a peer never moves the local one backwards", async () => {
    const nodeId = `${P}asia-northeast1`;
    const local = 1785200060000;
    await seedNode(nodeId, local);

    await runAntiEntropyRound(store, heartbeatPeer(nodeId, local - 30000));

    const ms = (await pool.query(
      `SELECT (EXTRACT(EPOCH FROM last_heartbeat_at)*1000)::bigint AS ms FROM directory_nodes WHERE node_id=$1`,
      [nodeId],
    )).rows[0].ms;
    expect(String(ms)).toBe(String(local));
  });

  it("a NULL last_heartbeat_at: the ADVERTISE version equals the SERVED-body version (no null↔\"null\" split)", async () => {
    // The failure the SELECT's COALESCE removes. Advertise hashes the RAW pg row; a peer hashes the
    // SERVED body. Without the coalesce those routes disagree (`null` vs the string "null"), so two
    // nodes holding IDENTICAL state advertise different versions forever and re-pull every round
    // without converging. agent_suspensions.origin_node hit exactly this.
    //
    // The fixture is a genuine NULL, not the epoch-0 stand-in: the column IS nullable (every node
    // registers before it first heartbeats), so NULL is the shape that reaches production, and a
    // test seeded with 0 would pass over the defect it is named for.
    const nodeId = `${P}us-central1`;
    await pool.query(
      `INSERT INTO directory_nodes (node_id, region, status, last_heartbeat_at)
       VALUES ($1, $2, 'active', NULL)`,
      [nodeId, `${nodeId}-region`],
    );
    const advertised = (await store.tierBVersions("directory_nodes")).get(nodeId);
    const served = (await store.serveTierB("directory_nodes", [nodeId]))[0].body as DirectoryNodeHeartbeatRecord;
    // Name the VALUE, not just the agreement: the two hashes would also agree if BOTH paths yielded
    // the string "null". Pinning it to "0" is what makes this assert the coalesce rather than a
    // coincidence, and "0" is the value the merge treats as never-heartbeated.
    expect(served.last_heartbeat_at).toBe("0");
    const peerComputed = encodeTierBVersion(
      DIRECTORY_NODE_HEARTBEAT_VERSION_SPEC,
      served as unknown as Record<string, string>,
    ).versionHash;
    expect(advertised).toBe(peerComputed);
  });

  it("one unknown node does NOT discard the real heartbeats behind it in the same batch", async () => {
    // The attack the containment exists for. The PEER chooses what serveTierB returns and in what
    // order, so it serves the poisoned key FIRST. If the refusal aborted the batch, this peer would
    // mute directory_nodes reconciliation every round, indefinitely — the guard costing the honest
    // path everything and the attacker one string. Ordering matters, so the unknown key is deliberately
    // first: with the records reversed this test would pass even with the batch-aborting behaviour.
    const realNode = `${P}real-node`;
    const fresh = 1785200060000;
    await seedNode(realNode, 0);

    const changed = await store.applyTierB("directory_nodes", [
      { key: `${P}unknown-first`, body: { node_id: `${P}unknown-first`, last_heartbeat_at: String(fresh) } },
      { key: realNode, body: { node_id: realNode, last_heartbeat_at: String(fresh) } },
    ]);

    expect(changed, "the real record behind the poisoned one must still apply").toBe(1);
    const ms = (await pool.query(
      `SELECT (EXTRACT(EPOCH FROM last_heartbeat_at)*1000)::bigint AS ms FROM directory_nodes WHERE node_id=$1`,
      [realNode],
    )).rows[0].ms;
    expect(String(ms)).toBe(String(fresh));
    // And the unknown one still created nothing.
    expect((await pool.query(`SELECT 1 FROM directory_nodes WHERE node_id=$1`, [`${P}unknown-first`])).rows).toHaveLength(0);
  });

  it("a MALFORMED record still aborts the batch — only the unknown-key case is contained", async () => {
    // The containment must not have widened into "Tier-B swallows everything". A type violation is a
    // protocol violation by the peer and the kill switch must not merge from a peer we cannot parse,
    // so this one still throws out of applyTierB.
    const nodeId = `${P}abort-check`;
    await seedNode(nodeId, 0);
    await expect(
      store.applyTierB("directory_nodes", [
        { key: nodeId, body: { node_id: nodeId, last_heartbeat_at: 1785200060000 } as unknown as DirectoryNodeHeartbeatRecord },
      ]),
    ).rejects.toThrow(/last_heartbeat_at must be a string/);
  });

  it("REFUSES a heartbeat for a node whose identity row has not replicated — it does not invent one, and SAYS SO", async () => {
    // This entry owns ONE column of a row whose `region` is NOT NULL and belongs to the Tier-A spec.
    // There is no honest INSERT, and a fabricated identity row is what the tier split exists to
    // prevent. Skipping the record is correct; skipping it SILENTLY is not — a heartbeat that never
    // lands and says nothing is indistinguishable from one that landed, so the log line is the whole
    // difference between a contained refusal and a silent fallback.
    const logged: Array<{ event: string; context: Record<string, unknown> }> = [];
    const capturing = new PgAeStore(pool, undefined, {
      error: (event: string, context: Record<string, unknown>) => logged.push({ event, context }),
      warn: () => {}, info: () => {}, debug: () => {},
    } as never);

    const nodeId = `${P}never-registered`;
    const body: DirectoryNodeHeartbeatRecord = { node_id: nodeId, last_heartbeat_at: "1785200060000" };
    const changed = await capturing.applyTierB("directory_nodes", [{ key: nodeId, body }]);

    expect(changed, "nothing changed — the record was skipped, not applied").toBe(0);
    expect((await pool.query(`SELECT 1 FROM directory_nodes WHERE node_id=$1`, [nodeId])).rows,
      "no row may be fabricated").toHaveLength(0);

    const refusal = logged.find((l) => l.event === "antientropy.apply.unknown_key");
    expect(refusal, "the skip must reach the operator, not just return 0").toBeDefined();
    expect(refusal!.context["table"]).toBe("directory_nodes");
    expect(refusal!.context["key"]).toBe(nodeId);
    expect(String(refusal!.context["reason"])).toMatch(/heartbeat for unknown node/);
  });

  it("heartbeat epoch coercion is node-TZ-INDEPENDENT (two regions must hash the same instant)", async () => {
    // Two nodes in different regions hashing local time is a divergence that reads as corruption.
    // A write using AT TIME ZONE would shift the stored instant under a non-UTC session.
    const nodeId = `${P}tz-node`;
    const ms = 1785200000123;
    await seedNode(nodeId, 0);
    await tzStore.applyTierB("directory_nodes", [{ key: nodeId, body: { node_id: nodeId, last_heartbeat_at: String(ms) } }]);
    const tzServed = (await tzStore.serveTierB("directory_nodes", [nodeId]))[0].body as DirectoryNodeHeartbeatRecord;
    const utcServed = (await store.serveTierB("directory_nodes", [nodeId]))[0].body as DirectoryNodeHeartbeatRecord;
    expect(tzServed.last_heartbeat_at).toBe(String(ms));
    expect(utcServed.last_heartbeat_at).toBe(String(ms));
  });

  it("directory_nodes is in BOTH tiers and the store resolves each to its own entry", async () => {
    // The one table in two tiers. If either lookup resolved to the wrong entry, Tier-A applies would
    // run through an LWW merge (or Tier-B pulls would hash immutable columns) and the divergence
    // would be silent.
    expect(store.tierATables()).toContain("directory_nodes");
    expect(store.tierBTables()).toContain("directory_nodes");
    const nodeId = `${P}bothtiers`;
    await seedNode(nodeId, 1785200000000);
    // The Tier-B body carries the heartbeat and NOT the identity columns.
    const served = (await store.serveTierB("directory_nodes", [nodeId]))[0].body as Record<string, unknown>;
    expect(Object.keys(served).sort()).toEqual(["last_heartbeat_at", "node_id"]);
  });

  // ── DOD-SIGNAL-REPLICATION-1: signal_records must actually apply ────────────────────────────
  //
  // This table had NO live coverage at all, which is why the defect survived: `scanner_version` is
  // TEXT NOT NULL with no default and was absent from SIGNAL_RECORDS_SPEC, so `applyTierA` — which
  // inserts exactly the spec's columns — failed on EVERY record with a not-null violation. 1530
  // consecutive failures in production and not one trust signal had ever crossed between nodes.
  //
  // The failure is SWALLOWED by design (a bad record must not take the round down), so the pre-fix
  // symptom here is `inserted === 0` and a row that never arrives — never a thrown error. Asserting
  // the row LANDS, with its real scanner_version, is the only assertion that catches it.
  it("applyTierA inserts a signal_record and carries scanner_version — the column that made every apply fail", async () => {
    const body = {
      signal_hash: `${P}sig1`,
      accepting_node: "gcp-use1",
      subject_kind: "agent",
      issuer_kind: "portal",
      issuer_pubkey: "cd".repeat(32),
      type: "track_record",
      supersedes_hash: null,
      scanner_version: "scan-v7",
    };
    const hash = encodeTierARecord(SIGNAL_RECORDS_SPEC, body).hash;

    const inserted = await store.applyTierA("signal_records", [{ hash, body }]);
    expect(inserted, "a signal record must actually land on the receiving node").toBe(1);

    const got = await pool.query(
      `SELECT scanner_version, subject_kind, type FROM signal_records WHERE signal_hash=$1 AND accepting_node=$2`,
      [body.signal_hash, body.accepting_node],
    );
    expect(got.rows).toHaveLength(1);
    // The submitter's signed assertion that the content was scanned clean at birth. If this arrived
    // as anything other than the issuer's own value, the replica's copy would be evidence of a scan
    // that never happened — which is why it is hashed rather than carried beside the hash.
    expect(got.rows[0].scanner_version).toBe("scan-v7");
    expect(got.rows[0].subject_kind).toBe("agent");

    // Insert-if-absent by natural key (signal_hash, accepting_node) — convergence, not a duplicate.
    expect(await store.applyTierA("signal_records", [{ hash, body }])).toBe(0);
  });

  // ── DOD-SIGNAL-REPLICATION-1 review F1: a revoke TOMBSTONE must never reach another node ──────
  //
  // `revokeSignal` writes the revocation as a row IN `signal_records`, keyed `(hash, 'revoke:'+node)`,
  // carrying `is_tombstone=true`, `status='revoked'` and PLACEHOLDER descriptive fields the issuer
  // never attested (`'(tombstone)'` for issuer_pubkey, type and scanner_version).
  //
  // None of `is_tombstone`, `status` or `revoker_*` is in the Tier-A spec — correctly, they are
  // mutable or local. So if such a row is advertised and served, it lands on the peer with the
  // COLUMN DEFAULTS: `is_tombstone=false`, `status='active'`. The revocation becomes an active
  // notarization. V62's own comment says this outcome is "worse than not crossing at all".
  //
  // It could not happen before, because the missing `scanner_version` made every apply fail — so
  // fixing that fix ARMED this. The sharpest consequence is the deliver gate in signal-write.ts,
  // whose `AND is_tombstone = false` is load-bearing precisely so a hash that only ever had a revoke
  // cannot pass: on the peer, the corrupted tombstone satisfies it.
  //
  // The revocation FACT already replicates properly via `signal_revocations` (V62). The tombstone row
  // is node-local bookkeeping and has no business on the wire.
  it("never advertises or serves a revoke tombstone — it would land on the peer as an ACTIVE signal", async () => {
    const realHash = `${P}sig-real`;
    const realBody = {
      signal_hash: realHash, accepting_node: "gcp-use1", subject_kind: "agent", issuer_kind: "portal",
      issuer_pubkey: "ab".repeat(32), type: "track_record", supersedes_hash: null, scanner_version: "scan-v1",
    };
    expect(await store.applyTierA("signal_records", [
      { hash: encodeTierARecord(SIGNAL_RECORDS_SPEC, realBody).hash, body: realBody },
    ])).toBe(1);

    // Written with the PRODUCTION column list and values from revokeSignal — a hand-built body would
    // not have caught this, which is the whole point.
    await pool.query(
      `INSERT INTO signal_records
         (signal_hash, accepting_node, subject_kind, issuer_kind, issuer_pubkey, type,
          supersedes_hash, status, revoked_at, scanner_version, is_tombstone)
       VALUES ($1, $2, 'agent','portal','(tombstone)','(tombstone)', NULL, 'revoked', now(), '(tombstone)', true)`,
      [realHash, `revoke:${"gcp-use1"}`],
    );

    const tombstoneBody = {
      signal_hash: realHash, accepting_node: "revoke:gcp-use1", subject_kind: "agent", issuer_kind: "portal",
      issuer_pubkey: "(tombstone)", type: "(tombstone)", supersedes_hash: null, scanner_version: "(tombstone)",
    };
    const tombstoneHash = encodeTierARecord(SIGNAL_RECORDS_SPEC, tombstoneBody).hash;

    const advertised = await store.tierARecordHashes("signal_records");
    expect(advertised, "a tombstone must not be offered to a peer").not.toContain(tombstoneHash);
    // The real row must still be advertised — the filter must not throw the table out with it.
    expect(advertised).toContain(encodeTierARecord(SIGNAL_RECORDS_SPEC, realBody).hash);

    // And a peer that asks for it by hash anyway gets nothing.
    expect(await store.serveTierA("signal_records", [tombstoneHash])).toEqual([]);
  });

  it("advertises signal_records hashes matching encodeTierARecord — two nodes agree on the digest", async () => {
    // Digest parity is what makes the two sides ASK for the right records. The sender SELECTs
    // naturalKey ∪ immutableColumns, so a column added to the spec must appear on both sides at once
    // or the nodes would disagree forever about what they each hold.
    const body = {
      signal_hash: `${P}sig2`,
      accepting_node: "gcp-euw1",
      subject_kind: "account",
      issuer_kind: "agent",
      issuer_pubkey: "ef".repeat(32),
      type: "vouch",
      supersedes_hash: null,
      scanner_version: "scan-v9",
    };
    const hash = encodeTierARecord(SIGNAL_RECORDS_SPEC, body).hash;
    expect(await store.applyTierA("signal_records", [{ hash, body }])).toBe(1);

    expect(await store.tierARecordHashes("signal_records")).toContain(hash);

    // And the body the store serves back must round-trip the column, or the next node to pull it
    // would hit the same not-null violation one hop later.
    const served = await store.serveTierA("signal_records", [hash]);
    expect((served[0].body as Record<string, unknown>).scanner_version).toBe("scan-v9");
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
      tierATableDigest: () => computeTableDigest([]),
      tierBTableDigest: () => tierBTableDigest(new Map([[id, encodeTierBVersion(SUSPENSION_VERSION_SPEC, {
        agent_id: newer.agent_id, paused: newer.paused, burned: newer.burned, reason: newer.reason,
        authorized_by_account: newer.authorized_by_account, suspension_seq: String(newer.suspension_seq),
        origin_node: newer.origin_node,
      }).versionHash]])),
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
    const body = { k_local_pubkey: `${P}kp`, agent_id: `${P}aid`, primary_pubkey: "pp", ml_dsa_pubkey: "", phone_stub_hash: "", registered_at: "1785200000000" };
    const hash = encodeTierARecord(AGENT_PROFILES_SPEC, body).hash;
    expect(await store.applyTierA("agent_profiles", [{ hash, body }])).toBe(1);
    expect(await store.applyTierA("agent_profiles", [{ hash, body }])).toBe(0); // insert-if-absent
  });

  it("REFUSES an agent_profiles body with no agent_id — the state it would create is unrepairable", async () => {
    // This body used to be accepted, and accepting it is how the live fleet ended up holding profiles
    // with a NULL agent_id. Two consequences, both permanent because Tier-A apply is insert-if-absent
    // and ON CONFLICT DO NOTHING keeps the local copy forever:
    //   1. the suspension/burn gates JOIN on agent_id, so the row makes the kill switch answer
    //      "not suspended" on this node;
    //   2. agent_id is in the content address, so a NULL copy and a populated copy of the same agent
    //      hash differently and the two nodes never converge — a standing fork signature.
    // A later round cannot fix either, so the door is the only place to refuse it.
    const body = { k_local_pubkey: `${P}kpnull`, primary_pubkey: "pp2", ml_dsa_pubkey: "", phone_stub_hash: "", registered_at: "1785200000001" };
    const hash = encodeTierARecord(AGENT_PROFILES_SPEC, body).hash;
    await expect(store.applyTierA("agent_profiles", [{ hash, body }])).rejects.toThrow(/missing required column\(s\) agent_id/);
    const r = await pool.query("SELECT 1 FROM agent_profiles WHERE k_local_pubkey = $1", [`${P}kpnull`]);
    expect(r.rows.length, "nothing may be written when the body is refused").toBe(0);
  });
});
