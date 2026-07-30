/**
 * pg-backed anti-entropy store (M12 DOD-AE-APPEND-1 / DOD-AE-MUTABLE-1) — the DB half of the
 * `/cello/anti-entropy/1.0.0` channel. It reads local directory state to ADVERTISE + SERVE it to a
 * peer, and APPLIES what a peer serves us: Tier-A insert-if-absent (append-only), Tier-B atomic
 * merge-upsert (mutable). The convergence logic is transport- and DB-agnostic and lives in
 * ae-table-encoders / ae-mutable-version / suspension-merge / presence-merge; THIS module is the
 * single place that knows the pg column types, and it owns the obligations those modules document:
 *
 *  - **BYTEA → hex.** `pg` returns BYTEA as a Node Buffer and there is no bytea type-parser
 *    override (pg-type-config only touches DATE/TIMESTAMP). A raw Buffer would hash as
 *    `{"type":"Buffer",…}` — a different, silently-divergent content address than the intended
 *    hex. So every BYTEA column is `encode(col,'hex')` on read and `decode($n,'hex')` on write.
 *  - **Timestamps → UTC epoch-millis.** The mutable tables' time columns are TIMESTAMPTZ, which
 *    stores an absolute instant. `EXTRACT(EPOCH FROM col)*1000` yields UTC epoch-millis directly
 *    (session-TZ-independent), and `to_timestamp(ms/1000.0)` writes the same instant back — NO
 *    `AT TIME ZONE` on either side (that would down-cast to a bare timestamp and reinterpret it in
 *    the session TZ, corrupting the instant on a non-UTC node). Only agent_presence carries a time
 *    column in its version/merge (wall-clock LWW); agent_suspensions EXCLUDES updated_at (§4 forbids
 *    wall-clock as a merge input).
 *  - **BIGINT + UUID** already arrive as strings (pg default); **booleans** as JS booleans
 *    (normalized by the version encoder). `origin_node` is COALESCE'd to '' at the SELECT so the
 *    advertise (raw-row) and serve/apply (rowToBody) encodings agree on pre-V49 NULL rows — a
 *    null↔'' split would make two nodes' version hashes for identical state diverge forever.
 *
 * **Atomicity — the kill switch must not be reverted by a concurrent operator write.** applyTierB
 * reads the local row `FOR UPDATE` inside a transaction on a DEDICATED connection, so the write-seam
 * (`applyRevocationFlag`, a single atomic `ON CONFLICT DO UPDATE`) blocks on that row lock and
 * re-evaluates its monotonic burn-OR / seq+1 against OUR committed row — it can never be lost. For a
 * row that does NOT yet exist (FOR UPDATE locks nothing), a plain INSERT races the seam's insert on
 * the unique index; the loser catches the unique violation and RETRIES, which now finds the row
 * under FOR UPDATE and merges it (burn preserved via the merge's OR). No merge logic is duplicated in
 * SQL, and the seam needs no change.
 *
 * **Scope.** This store round-trips the four tables it can serve AND apply with no external coupling:
 * Tier-A agent_profiles + agent_revocations, Tier-B agent_suspensions + agent_presence. The two
 * hash-chained Tier-A tables (user_accounts, seal_notarizations) need the canonical local chain
 * writer (`insertWithChain` — chain columns are node-local audit trails, written locally on apply
 * per design §2 "Hash chains under anti-entropy"); they are DELIBERATELY absent here rather than
 * half-wired (advertised-but-unappliable), and are the immediate follow-up unit.
 */

import type pg from "pg";
import {
  encodeTierARecord, type TierATableSpec, type TableRow,
  AGENT_PROFILES_SPEC, AGENT_REVOCATIONS_SPEC, USER_ACCOUNTS_SPEC, SEAL_NOTARIZATIONS_SPEC,
} from "./ae-table-encoders.js";
import {
  encodeTierBVersion, type TierBVersionSpec, type MutableRow,
  SUSPENSION_VERSION_SPEC, PRESENCE_VERSION_SPEC,
} from "./ae-mutable-version.js";
import { mergeSuspension, type SuspensionRecord } from "./suspension-merge.js";
import { mergePresence, type PresenceRecord } from "./presence-merge.js";
import type { AeStoreView, TierARecord, TierBRecord } from "./anti-entropy-engine.js";
import { computeTableDigest } from "./set-reconciliation.js";
import { tierBTableDigest } from "./ae-round.js";

export type { TierARecord, TierBRecord } from "./anti-entropy-engine.js";

// ── Tier-A table registry ─────────────────────────────────────────────────────────────────────
// Each entry pairs a logic-layer spec with the pg-specific knowledge (which columns are BYTEA).
interface TierAPg {
  readonly spec: TierATableSpec;
  /** Columns stored as BYTEA — hex-encoded on read, decoded on write. */
  readonly bytea: readonly string[];
  /**
   * Hash-chained tables cannot take the generic INSERT: it would write a row with no chain columns —
   * present and readable, but outside the tamper-evident chain that is the reason the table exists.
   * These apply through the canonical writer instead, which computes the chain against THIS node's
   * own tip. Chain values are never copied from the origin: two nodes' chains would then have to
   * agree on insertion order, which anti-entropy does not provide and does not need to.
   */
  readonly chained?: boolean;
}

const TIER_A: readonly TierAPg[] = [
  { spec: AGENT_PROFILES_SPEC, bytea: [] },
  { spec: AGENT_REVOCATIONS_SPEC, bytea: ["signature"] },
  { spec: USER_ACCOUNTS_SPEC, bytea: [], chained: true },
  {
    spec: SEAL_NOTARIZATIONS_SPEC,
    bytea: ["session_id", "sealed_root", "participant_a_pubkey", "participant_b_pubkey", "frost_signature"],
    chained: true,
  },
];

/**
 * The canonical hash-chain writer, injected rather than inherited. `PgDirectoryStore` already exposes
 * `insertWithChain` publicly and accepts an external client, so this store needs the ONE method — not
 * a reference to the whole store, which would drag the directory's entire surface into the sync path.
 */
export interface ChainWriter {
  insertWithChain(
    tableName: never,
    record: Record<string, unknown>,
    columns: string[],
    values: unknown[],
    chainHashIndex: number,
    externalClient?: pg.PoolClient,
    correlationId?: string,
  ): Promise<string>;
}

/** The columns to SELECT for a Tier-A table = natural key ∪ immutable columns (deduped). */
function tierAColumns(t: TierAPg): string[] {
  return [...new Set<string>([...t.spec.naturalKey, ...t.spec.immutableColumns])];
}

/** A SELECT projection with BYTEA columns hex-encoded so every value is a string|null. */
function tierASelectExpr(t: TierAPg): string {
  return tierAColumns(t)
    .map((c) => (t.bytea.includes(c) ? `encode(${c},'hex') AS ${c}` : c))
    .join(", ");
}

// ── Tier-B table registry ─────────────────────────────────────────────────────────────────────
// Each entry carries: the version spec, the SQL projection that yields exactly the merge/version
// columns (with UTC epoch coercion for timestamps), the merge function, a body→record adapter for
// the local row, and the merge-upsert writer. The two Tier-B tables differ enough (excluded vs
// included updated_at; different merge) that a small per-table object is clearer than a mega-generic.
interface TierBPg {
  readonly spec: TierBVersionSpec;
  /** SQL projection selecting the merge-relevant columns (see per-table note). */
  readonly select: string;
  /** Merge two record bodies into the converged body (audited join-semilattice). */
  merge(a: unknown, b: unknown): unknown;
  /** Adapt a pg row (from `select`) into the merge record body. */
  rowToBody(row: Record<string, unknown>): unknown;
  /** INSERT a body for a key that does not yet exist locally (races the seam on the unique index). */
  insert(client: pg.PoolClient, body: unknown): Promise<void>;
  /** UPDATE the existing (FOR UPDATE-locked) row to the merged body. */
  update(client: pg.PoolClient, body: unknown): Promise<void>;
  /** The natural-key column (single-column keys for both Tier-B tables). */
  readonly keyColumn: string;
}

const SUSPENSIONS: TierBPg = {
  spec: SUSPENSION_VERSION_SPEC,
  keyColumn: "agent_id",
  // updated_at is EXCLUDED (display only); authorized_by_account cast to text (uuid → string).
  // origin_node COALESCE'd to '' so the raw-row advertise encoding matches rowToBody on NULL (V49).
  select:
    `SELECT agent_id, paused, burned, reason, authorized_by_account::text AS authorized_by_account,
            suspension_seq, COALESCE(origin_node,'') AS origin_node FROM agent_suspensions`,
  merge: (a, b) => mergeSuspension(a as SuspensionRecord, b as SuspensionRecord),
  rowToBody: (r): SuspensionRecord => ({
    agent_id: r.agent_id as string,
    paused: r.paused as boolean,
    burned: r.burned as boolean,
    reason: (r.reason as string | null) ?? null,
    authorized_by_account: (r.authorized_by_account as string | null) ?? null,
    suspension_seq: Number(r.suspension_seq), // BIGINT-string → number (a per-agent write counter, ≪ 2^53)
    origin_node: (r.origin_node as string | null) ?? "",
  }),
  // updated_at is display-only (NOT a merge input); stamp now() so the human-facing column stays
  // fresh without ever influencing convergence.
  insert: async (client, body) => {
    const s = body as SuspensionRecord;
    await client.query(
      `INSERT INTO agent_suspensions (agent_id, paused, burned, reason, authorized_by_account, suspension_seq, origin_node, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7, now())`,
      [s.agent_id, s.paused, s.burned, s.reason, s.authorized_by_account, s.suspension_seq, s.origin_node],
    );
  },
  update: async (client, body) => {
    const s = body as SuspensionRecord;
    await client.query(
      `UPDATE agent_suspensions
          SET paused=$2, burned=$3, reason=$4, authorized_by_account=$5, suspension_seq=$6, origin_node=$7, updated_at=now()
        WHERE agent_id=$1`,
      [s.agent_id, s.paused, s.burned, s.reason, s.authorized_by_account, s.suspension_seq, s.origin_node],
    );
  },
};

const PRESENCE: TierBPg = {
  spec: PRESENCE_VERSION_SPEC,
  keyColumn: "k_local_pubkey",
  // TIMESTAMPTZ → absolute UTC epoch millis, no AT TIME ZONE (see file header).
  select:
    `SELECT k_local_pubkey, online, owning_node_id,
            (EXTRACT(EPOCH FROM last_seen_at)*1000)::bigint AS last_seen_at,
            (EXTRACT(EPOCH FROM updated_at )*1000)::bigint AS updated_at
       FROM agent_presence`,
  merge: (a, b) => mergePresence(a as PresenceRecord, b as PresenceRecord),
  rowToBody: (r): PresenceRecord => ({
    k_local_pubkey: r.k_local_pubkey as string,
    online: r.online as boolean,
    owning_node_id: r.owning_node_id as string,
    last_seen_at: String(r.last_seen_at), // BIGINT epoch-millis string
    updated_at: String(r.updated_at),
  }),
  // Write the MERGED epoch millis back (NOT now()) — the winning updated_at must be preserved or the
  // LWW ordering is lost and the next round re-triggers. to_timestamp writes the exact instant into
  // the TIMESTAMPTZ column, node-TZ-independent (no AT TIME ZONE).
  insert: async (client, body) => {
    const p = body as PresenceRecord;
    await client.query(
      `INSERT INTO agent_presence (k_local_pubkey, owning_node_id, online, last_seen_at, updated_at)
       VALUES ($1,$2,$3, to_timestamp($4/1000.0), to_timestamp($5/1000.0))`,
      [p.k_local_pubkey, p.owning_node_id, p.online, p.last_seen_at, p.updated_at],
    );
  },
  update: async (client, body) => {
    const p = body as PresenceRecord;
    await client.query(
      `UPDATE agent_presence
          SET owning_node_id=$2, online=$3, last_seen_at=to_timestamp($4/1000.0), updated_at=to_timestamp($5/1000.0)
        WHERE k_local_pubkey=$1`,
      [p.k_local_pubkey, p.owning_node_id, p.online, p.last_seen_at, p.updated_at],
    );
  },
};

const TIER_B: readonly TierBPg[] = [SUSPENSIONS, PRESENCE];

function tierA(table: string): TierAPg {
  const t = TIER_A.find((x) => x.spec.table === table);
  if (!t) throw new Error(`pg-ae-store: unknown Tier-A table '${table}'`);
  return t;
}
function tierB(table: string): TierBPg {
  const t = TIER_B.find((x) => x.spec.table === table);
  if (!t) throw new Error(`pg-ae-store: unknown Tier-B table '${table}'`);
  return t;
}

/** pg unique-constraint / exclusion violation (SQLSTATE 23505) — the insert-race retry signal. */
function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === "23505";
}

export class PgAeStore implements AeStoreView {
  readonly #pool: pg.Pool;
  readonly #chainWriter: ChainWriter | undefined;

  constructor(pool: pg.Pool, chainWriter?: ChainWriter) {
    this.#pool = pool;
    this.#chainWriter = chainWriter;
  }

  tierATables(): readonly string[] { return TIER_A.map((t) => t.spec.table); }
  tierBTables(): readonly string[] { return TIER_B.map((t) => t.spec.table); }

  // ── Advertise ──────────────────────────────────────────────────────────────────────────────
  /**
   * The Tier-A table digest — what a peer compares to detect divergence in O(1) per table. Computed
   * from this node's own rows; only when it differs does the peer pay for any hash list.
   */
  async tierATableDigest(table: string): Promise<string> {
    return computeTableDigest(await this.tierARecordHashes(table));
  }

  /** The Tier-B table digest — same O(1) divergence-detection role. */
  async tierBTableDigest(table: string): Promise<string> {
    return tierBTableDigest(await this.tierBVersions(table));
  }

  /** Record hashes for a Tier-A table (for the bucket walk + set reconciliation). */
  async tierARecordHashes(table: string): Promise<string[]> {
    const t = tierA(table);
    const res = await this.#pool.query<Record<string, unknown>>(`SELECT ${tierASelectExpr(t)} FROM ${t.spec.table}`);
    return res.rows.map((row) => encodeTierARecord(t.spec, row as TableRow).hash);
  }

  /** key → versionHash for a Tier-B table. */
  async tierBVersions(table: string): Promise<Map<string, string>> {
    const t = tierB(table);
    const res = await this.#pool.query<Record<string, unknown>>(t.select);
    const m = new Map<string, string>();
    for (const row of res.rows) {
      const { key, versionHash } = encodeTierBVersion(t.spec, row as MutableRow);
      m.set(key, versionHash);
    }
    return m;
  }

  // ── Serve (respond to a peer's pull) ─────────────────────────────────────────────────────────
  /** Fetch Tier-A bodies for the requested record hashes. */
  async serveTierA(table: string, hashes: readonly string[]): Promise<TierARecord[]> {
    const t = tierA(table);
    const want = new Set(hashes);
    const res = await this.#pool.query<Record<string, unknown>>(`SELECT ${tierASelectExpr(t)} FROM ${t.spec.table}`);
    const out: TierARecord[] = [];
    for (const row of res.rows) {
      const hash = encodeTierARecord(t.spec, row as TableRow).hash;
      if (want.has(hash)) out.push({ hash, body: row });
    }
    return out;
  }

  /** Fetch Tier-B bodies for the requested natural keys. */
  async serveTierB(table: string, keys: readonly string[]): Promise<TierBRecord[]> {
    const t = tierB(table);
    if (keys.length === 0) return [];
    const res = await this.#pool.query<Record<string, unknown>>(
      `${t.select} WHERE ${t.keyColumn} = ANY($1::text[])`, [keys as string[]],
    );
    return res.rows.map((row) => ({ key: String(row[t.keyColumn]), body: t.rowToBody(row) }));
  }

  // ── Apply (ingest what a peer served us) ─────────────────────────────────────────────────────
  /**
   * Tier-A: insert-if-absent by NATURAL key (ON CONFLICT DO NOTHING). Returns the number actually
   * inserted (not the number offered) — so a same-key/different-hash fork surfaces as a no-insert
   * rather than a silent overwrite. BYTEA columns are hex-decoded back to bytes.
   *
   * WIRE-INPUT DISCIPLINE: records may arrive from an authenticated PEER, and authentication is
   * not honesty. Every record's hash is RECOMPUTED from its body — a record whose claimed hash
   * does not match its content is a protocol violation and throws (fail loud; the caller's round
   * fails rather than a poisoned row landing under a false content address).
   */
  async applyTierA(table: string, records: readonly TierARecord[]): Promise<number> {
    if (records.length === 0) return 0;
    const t = tierA(table);
    const cols = t.spec.immutableColumns; // the body carries exactly these (naturalKey ⊆ immutable)
    const conflict = t.spec.naturalKey.join(", ");
    let inserted = 0;
    for (const rec of records) {
      const body = rec.body as Record<string, unknown>;
      const recomputed = encodeTierARecord(t.spec, body as TableRow).hash;
      if (recomputed !== rec.hash) {
        throw new Error(
          `pg-ae-store: ${t.spec.table} record content does not match its claimed hash (claimed ${rec.hash.slice(0, 16)}…, actual ${recomputed.slice(0, 16)}…) — refusing to apply`,
        );
      }
      if (t.chained) {
        // ABSENT IS NOT FINE: without the writer this table cannot be applied correctly, and falling
        // through to the generic INSERT would write it UNCHAINED — the advertised-but-unappliable
        // state the registry exists to prevent. Refuse, naming what is missing.
        if (!this.#chainWriter) {
          throw new Error(
            `pg-ae-store: ${t.spec.table} is hash-chained and no chain writer was injected — refusing ` +
              `to apply it unchained`,
          );
        }
        // BYTEA columns arrive hex-encoded on the wire; the chain writer takes real values, and the
        // record it serializes must match what is stored or the chain hash will not reproduce.
        const record: Record<string, unknown> = {};
        for (const c of cols) {
          const v = body[c] ?? null;
          record[c] = t.bytea.includes(c) && typeof v === "string" ? Buffer.from(v, "hex") : v;
        }
        // chain_hash is computed by the writer; it is passed as a placeholder it overwrites.
        const columns = [...cols, "chain_hash"];
        const values = [...cols.map((c) => record[c]), ""];
        record["chain_hash"] = "";
        try {
          await this.#chainWriter.insertWithChain(
            t.spec.table as never, record, columns, values, columns.length - 1,
          );
          inserted += 1;
        } catch (err) {
          // A duplicate is convergence, not failure: the same notarization reaching a node twice (or
          // from two peers) is the normal steady state. Anything else is a real write failure.
          if ((err as { code?: string } | null)?.code !== "23505") throw err;
        }
        continue;
      }

      const placeholders = cols
        .map((c, i) => (t.bytea.includes(c) ? `decode($${i + 1},'hex')` : `$${i + 1}`))
        .join(", ");
      const values = cols.map((c) => body[c] ?? null);
      const res = await this.#pool.query(
        `INSERT INTO ${t.spec.table} (${cols.join(", ")}) VALUES (${placeholders})
         ON CONFLICT (${conflict}) DO NOTHING`,
        values,
      );
      inserted += res.rowCount ?? 0;
    }
    return inserted;
  }

  /**
   * Tier-B: atomic merge-apply (see the file header's Atomicity note). For each record, in a txn on a
   * dedicated connection: read the local row `FOR UPDATE` (so a concurrent write-seam upsert blocks on
   * the row lock and can't be reverted), merge, and UPDATE — or, if the row is absent, INSERT and
   * RETRY on a unique-violation race (the retry then finds the row under FOR UPDATE and merges it).
   * Returns the number that actually CHANGED local state (by version hash) — a converged re-apply
   * returns 0, the termination signal.
   */
  async applyTierB(table: string, records: readonly TierBRecord[]): Promise<number> {
    if (records.length === 0) return 0;
    const t = tierB(table);
    let changed = 0;
    for (const rec of records) changed += await this.#applyOneTierB(t, rec);
    return changed;
  }

  async #applyOneTierB(t: TierBPg, rec: TierBRecord): Promise<number> {
    // WIRE-INPUT DISCIPLINE (kill-switch critical): the row is LOCKED by rec.key but the merge
    // output would be WRITTEN by the body's key column. If those disagree — a malicious
    // authenticated peer sending {key: victimA, body: {agent_id: victimB, …}} — the write lands on
    // an UNLOCKED, UNREAD row: the burn-OR was computed against the wrong row and victimB's
    // burned=true could be overwritten. Key and body must agree or nothing is applied.
    const bodyKey = (rec.body as Record<string, unknown>)[t.keyColumn];
    if (bodyKey !== rec.key) {
      throw new Error(
        `pg-ae-store: ${t.spec.table} record key '${rec.key}' does not match its body ${t.keyColumn} '${String(bodyKey)}' — refusing to apply`,
      );
    }
    const MAX_ATTEMPTS = 3;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const client = await this.#pool.connect();
      try {
        await client.query("BEGIN");
        const existing = await client.query<Record<string, unknown>>(
          `${t.select} WHERE ${t.keyColumn} = $1 FOR UPDATE`, [rec.key],
        );
        const incoming = rec.body;
        if (existing.rows.length > 0) {
          const local = t.rowToBody(existing.rows[0]);
          const priorVersion = encodeTierBVersion(t.spec, local as MutableRow).versionHash;
          const merged = t.merge(local, incoming);
          const mergedVersion = encodeTierBVersion(t.spec, merged as MutableRow).versionHash;
          if (mergedVersion !== priorVersion) {
            await t.update(client, merged);
            await client.query("COMMIT");
            return 1;
          }
          await client.query("COMMIT");
          return 0;
        }
        // Absent locally: FOR UPDATE locked nothing, so a concurrent insert (peer round OR the
        // operator seam) can win the unique index between our SELECT and INSERT. On that violation we
        // ROLLBACK and retry — the next pass sees the now-present row under FOR UPDATE and merges it,
        // so a burn/pause that landed in the window is preserved by the merge, never clobbered.
        try {
          await t.insert(client, incoming);
          await client.query("COMMIT");
          return 1;
        } catch (err) {
          if (isUniqueViolation(err)) {
            await client.query("ROLLBACK");
            continue;
          }
          throw err;
        }
      } catch (err) {
        await client.query("ROLLBACK").catch(() => { /* ignore rollback error */ });
        throw err;
      } finally {
        client.release();
      }
    }
    throw new Error(`pg-ae-store: applyTierB exceeded ${MAX_ATTEMPTS} attempts reconciling ${t.spec.table} key '${rec.key}'`);
  }
}
