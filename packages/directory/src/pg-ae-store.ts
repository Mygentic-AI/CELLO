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
 * **Scope.** Six tables round-trip: Tier-A agent_profiles, agent_revocations, user_accounts and
 * seal_notarizations; Tier-B agent_suspensions and agent_presence.
 *
 * **Hash-chained Tier-A tables apply through the INJECTED `ChainWriter`, never the generic INSERT** —
 * that would write them outside the tamper-evident chain that is their reason for existing. Chain
 * columns are node-local: an applying node recomputes them against ITS OWN tip and never copies the
 * origin's (design §2 "Hash chains under anti-entropy"). With no writer injected, such a table is
 * SKIPPED with an ERROR rather than written unchained — and the rest of the round still runs,
 * because starving Tier-B would take the kill switch down with them.
 *
 * **Which tables those are is `HASH_CHAINED_TABLES`, not a number anyone remembers.** This comment
 * said "the two" until 2026-08-03, and by then there were four: `conversation_seals` and
 * `relay_registrations` joined the AE set on 2026-07-31 without the `chained` flag and silently took
 * the generic path. The count is not a fact about the system, it is a fact about when someone last
 * looked — so the invariant is enforced by a test that iterates `HASH_CHAINED_TABLES` rather than
 * naming tables (m12-ae-chained-tables.test.ts).
 */

import type pg from "pg";
import type { HashChainedTable } from "./hash-chain.js";
import type { Logger } from "@cello-protocol/interfaces";
import {
  encodeTierARecord, type TierATableSpec, type TableRow,
  AGENT_PROFILES_SPEC, AGENT_REVOCATIONS_SPEC, USER_ACCOUNTS_SPEC, SEAL_NOTARIZATIONS_SPEC,
  CAPABILITY_CLAIM_CODES_SPEC, AUTHORIZED_ISSUERS_SPEC, SIGNAL_RECORDS_SPEC,
  SUBMISSION_RESULTS_SPEC, RELAY_REGISTRATIONS_SPEC, DIRECTORY_NODES_SPEC,
  CONVERSATION_SEALS_SPEC,
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
  /**
   * The EXACT name of the constraint enforcing this table's natural key.
   *
   * A duplicate on it is convergence (the row already arrived); a duplicate on any OTHER unique
   * constraint is a genuine fork and must be alarmed. Substring-matching the natural-key COLUMN name
   * against the constraint name cannot make that distinction — Postgres names a primary key
   * `<table>_pkey`, so `"user_accounts_pkey".includes("account_id")` is false and every ordinary
   * duplicate was reported as an identity fork, burying the one alarm that matters.
   *
   * Verified against `pg_constraint`, not derived from the migrations — and asserted there by a live
   * test, so a migration that renames one goes red instead of silently re-classifying every duplicate.
   */
  readonly naturalKeyConstraint: string;
  /**
   * Columns that must be non-null in an applied body, beyond the natural key.
   *
   * Tier-A apply is insert-if-absent, so a row that lands wrong CANNOT be repaired by a later round —
   * `ON CONFLICT DO NOTHING` keeps the local copy forever. That makes "refuse it at the door" the only
   * available correctness lever, and it is why this is a refusal rather than a coercion.
   */
  readonly requiredColumns?: readonly string[];
}

// ORDER IS LOAD-BEARING: the engine applies Tier-A in this order and design §3.3 requires
// accounts → profiles → (Tier-B) suspensions, because each references the one before it. Inert today
// only because `account_id` is not in AGENT_PROFILES_SPEC — and that spec gained a column one commit
// ago, so "inert today" is not a reason to leave it wrong.
const TIER_A: readonly TierAPg[] = [
  { spec: USER_ACCOUNTS_SPEC, bytea: [], chained: true, naturalKeyConstraint: "user_accounts_pkey" },
  {
    spec: AGENT_PROFILES_SPEC,
    bytea: [],
    naturalKeyConstraint: "agent_profiles_k_local_unique",
    // agent_id is what the suspension/burn gates JOIN on. A profile carrying NULL there is one the
    // kill switch cannot evaluate — the join yields zero rows and the gate answers "not suspended" —
    // and because agent_id is also in the content address, a NULL copy and a populated copy hash
    // differently and can never converge. Refusing it keeps that state from spreading further.
    requiredColumns: ["agent_id"],
  },
  { spec: AGENT_REVOCATIONS_SPEC, bytea: ["signature"], naturalKeyConstraint: "agent_revocations_pkey" },
  // ── The tables that were in the AWS Postgres mesh but never ported to AE ──────────────────────
  // Found 2026-07-31 when capability_claim_codes broke Telegram registration: the code was written
  // once on gcp-use1, and the DKG routed round 1 to gcp-usc1, which had never heard of it.
  // The fix: every table in setup-replication.sh's PUBLICATION_TABLES that has a stable natural key
  // belongs here. The AWS mesh replicated them automatically; AE requires explicit registration.
  { spec: CAPABILITY_CLAIM_CODES_SPEC, bytea: [], naturalKeyConstraint: "capability_claim_codes_pkey" },
  { spec: AUTHORIZED_ISSUERS_SPEC, bytea: [], naturalKeyConstraint: "authorized_issuers_pkey" },
  { spec: SIGNAL_RECORDS_SPEC, bytea: [], naturalKeyConstraint: "signal_records_pkey" },
  { spec: SUBMISSION_RESULTS_SPEC, bytea: ["ciphertext"], naturalKeyConstraint: "submission_results_pkey" },
  // chained: in HASH_CHAINED_TABLES, and missed here when this table was registered on 2026-07-31.
  // Its chain_hash is `NOT NULL DEFAULT ''` (V19), so the generic INSERT did not raise — it wrote
  // rows with an EMPTY chain hash, inside the table and outside its chain, silently. Latent rather
  // than realised (all three nodes held 0 rows when this was found on 2026-08-03), and the worse of
  // the two failures precisely because nothing would ever have reported it.
  { spec: RELAY_REGISTRATIONS_SPEC, bytea: [], chained: true, naturalKeyConstraint: "relay_registrations_relay_id_key" },
  { spec: DIRECTORY_NODES_SPEC, bytea: [], naturalKeyConstraint: "directory_nodes_node_id_key" },
  // chained: same omission, opposite symptom. conversation_seals.chain_hash is NOT NULL with no
  // default (V3), so every apply RAISED and the table never converged — proven on the live fleet,
  // where two nodes held 2 seals and gcp-use1 held 0 and could not acquire them. A seal receipt
  // present on only some directories is the notary's durability property failing.
  { spec: CONVERSATION_SEALS_SPEC, bytea: [], chained: true, naturalKeyConstraint: "conversation_seals_conversation_id_key" },
  // seal_notarizations last because its chained writer needs conversation_seals and profiles present.
  {
    spec: SEAL_NOTARIZATIONS_SPEC,
    bytea: ["session_id", "sealed_root", "participant_a_pubkey", "participant_b_pubkey", "frost_signature"],
    chained: true,
    naturalKeyConstraint: "seal_notarizations_session_seal_type_key",
  },
];

/**
 * The canonical hash-chain writer, injected rather than inherited. `PgDirectoryStore` already exposes
 * `insertWithChain` publicly and accepts an external client, so this store needs the ONE method — not
 * a reference to the whole store, which would drag the directory's entire surface into the sync path.
 */
export interface ChainWriter {
  insertWithChain(
    tableName: HashChainedTable,
    record: Record<string, unknown>,
    columns: string[],
    values: unknown[],
    chainHashIndex: number,
    externalClient?: pg.PoolClient,
    correlationId?: string,
  ): Promise<string>;
}

/**
 * Every Tier-A table paired with the constraint name that classifies its duplicates.
 *
 * Exported so the live catalogue check iterates the REGISTRY rather than a list someone typed. That
 * list had four entries while this registry had eleven — and `naturalKeyConstraint` was inert for the
 * unlisted tables only while they took the generic `ON CONFLICT DO NOTHING` path. Flagging two of
 * them `chained` made it load-bearing for both: `insertWithChain` issues a bare INSERT, so every
 * duplicate now raises 23505 and is classified by exact name match. A wrong name turns ordinary
 * convergence into a fork alarm on every round, burying the one that means something.
 */
export const TIER_A_NATURAL_KEY_CONSTRAINTS: ReadonlyArray<readonly [table: string, constraint: string]> =
  TIER_A.map((t) => [t.spec.table, t.naturalKeyConstraint] as const);

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
  /**
   * The body in its CANONICAL hashing form. The advertise path hashes the raw pg row, where BIGINT
   * columns are strings; `rowToBody` turns some of them into numbers so the merges can compare them.
   * Hashing the merge form directly meant the same logical row produced two different version hashes
   * depending on which path you arrived by — the in-memory store the convergence proof runs on does
   * not have that split (it stringifies for hashing and keeps natives for merging), and neither may
   * this one, or the proof describes something nobody runs.
   */
  toVersionRow(body: unknown): MutableRow;
  /**
   * Reject a wire body whose fields are the wrong TYPE, before any merge sees it.
   *
   * `applyTierB` recomputes the key/body agreement but nothing checks value types, and the channel
   * validates only that the key is a string. A peer body carrying `suspension_seq: "5"` against a
   * local `5` compares unequal, so the merge takes the higher-seq branch instead of the equal-seq
   * one — and `5 > "5"` is false, so the PEER wins and its `paused` is copied wholesale over ours,
   * bypassing the suspended-wins rule that is the kill switch's entire guarantee. It then never
   * converges. Authentication is not honesty; a type is part of the value.
   */
  validateBody(body: unknown): string | null;
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
  // Numerics as strings, matching the raw pg row the advertise path hashes (and `record-hash.ts`'s
  // rule that the encoder passes ALL numerics as strings).
  toVersionRow: (body): MutableRow => {
    const s2 = body as SuspensionRecord;
    return {
      agent_id: s2.agent_id, paused: s2.paused, burned: s2.burned, reason: s2.reason,
      authorized_by_account: s2.authorized_by_account,
      suspension_seq: String(s2.suspension_seq),
      origin_node: s2.origin_node,
    } as unknown as MutableRow;
  },
  validateBody: (body): string | null => {
    const b = body as Record<string, unknown>;
    if (typeof b["agent_id"] !== "string") return "agent_id must be a string";
    if (typeof b["paused"] !== "boolean") return `paused must be a boolean, got ${typeof b["paused"]}`;
    if (typeof b["burned"] !== "boolean") return `burned must be a boolean, got ${typeof b["burned"]}`;
    // The field that decides which merge branch runs, so its type IS the kill switch's correctness.
    const seq = b["suspension_seq"];
    if (typeof seq !== "number" || !Number.isInteger(seq) || !Number.isFinite(seq)) {
      return `suspension_seq must be a finite integer, got ${JSON.stringify(seq)} (${typeof seq})`;
    }
    for (const c of ["reason", "authorized_by_account", "origin_node"]) {
      const v = b[c];
      if (v !== null && typeof v !== "string") return `${c} must be a string or null, got ${typeof v}`;
    }
    return null;
  },
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
  // Already string-valued end to end; identity keeps the two Tier-B tables symmetric rather than
  // making the caller remember which one needs converting.
  toVersionRow: (body): MutableRow => body as MutableRow,
  validateBody: (body): string | null => {
    const b = body as Record<string, unknown>;
    if (typeof b["k_local_pubkey"] !== "string") return "k_local_pubkey must be a string";
    if (typeof b["online"] !== "boolean") return `online must be a boolean, got ${typeof b["online"]}`;
    if (typeof b["owning_node_id"] !== "string") return `owning_node_id must be a string, got ${typeof b["owning_node_id"]}`;
    for (const c of ["last_seen_at", "updated_at"]) {
      // Strings on the wire; `presence-merge` normalises non-finite to -Infinity, but a non-string
      // here still means the peer is not speaking the encoding both sides hash.
      if (typeof b[c] !== "string") return `${c} must be a string (epoch millis), got ${typeof b[c]}`;
    }
    return null;
  },
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
  readonly #logger: Logger | undefined;

  constructor(pool: pg.Pool, chainWriter?: ChainWriter, logger?: Logger) {
    this.#pool = pool;
    this.#chainWriter = chainWriter;
    this.#logger = logger;
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
      const missing = (t.requiredColumns ?? []).filter((c) => body[c] === null || body[c] === undefined);
      if (missing.length > 0) {
        throw new Error(
          `pg-ae-store: ${t.spec.table} record is missing required column(s) ${missing.join(", ")} — ` +
            `refusing to apply. Tier-A apply is insert-if-absent, so a row accepted with these null ` +
            `could never be repaired by a later round.`,
        );
      }
      const recomputed = encodeTierARecord(t.spec, body as TableRow).hash;
      if (recomputed !== rec.hash) {
        throw new Error(
          `pg-ae-store: ${t.spec.table} record content does not match its claimed hash (claimed ${rec.hash.slice(0, 16)}…, actual ${recomputed.slice(0, 16)}…) — refusing to apply`,
        );
      }
      if (t.chained) {
        // ABSENT IS NOT FINE. This table cannot be applied correctly without the writer, and it must
        // not fall through to the generic INSERT — that writes it UNCHAINED, outside the
        // tamper-evident chain that is the table's reason for existing. Throw.
        //
        // Blast radius is the ENGINE's concern, not this file's: `runAntiEntropyRound` now applies
        // Tier-A table by table and always reaches Tier-B, so a refusal here costs this table and
        // nothing else. A previous version of this code caught the throw HERE while reasoning about
        // the engine's control flow — a layering inversion that also guarded only one of the five
        // throw sites in this file, and that the in-memory store the convergence proof runs on did
        // not share.
        if (!this.#chainWriter) {
          throw new Error(
            `pg-ae-store: ${t.spec.table} is hash-chained and no ChainWriter was injected — refusing ` +
              `to apply it unchained`,
          );
        }

        // BYTEA columns arrive hex-encoded on the wire; the chain writer takes real values, and the
        // record it serializes must match what is stored or the chain hash will not reproduce.
        //
        // The round-trip assert is not belt-and-braces. `Buffer.from(str, "hex")` does NOT throw on
        // bad input — it stops at the first non-hex character and drops a trailing odd nibble. The
        // generic path four lines below hands hex to Postgres' `decode(…,'hex')`, which RAISES. So
        // without this, the chained path — the one carrying seal receipts — would be the quieter of
        // the two, in a file whose own header says authentication is not honesty. The wire hash is
        // computed over the hex STRING, so a truncated value passes the content-address check, and
        // `insertWithChain` would then chain-hash the truncation: `verifyChain` returns valid on a
        // corrupt receipt. For a notary that is the worst available outcome — the tamper-evidence
        // attests to the damage.
        const record: Record<string, unknown> = {};
        for (const c of cols) {
          const v = body[c] ?? null;
          if (t.bytea.includes(c) && typeof v === "string") {
            const buf = Buffer.from(v, "hex");
            if (buf.toString("hex") !== v.toLowerCase()) {
              throw new Error(
                `pg-ae-store: ${t.spec.table}.${c} is not valid hex — refusing to apply a record that ` +
                  `would be silently truncated`,
              );
            }
            record[c] = buf;
          } else {
            record[c] = v;
          }
        }
        // chain_hash is computed by the writer; it is passed as a placeholder it overwrites.
        const columns = [...cols, "chain_hash"];
        const values = [...cols.map((c) => record[c]), ""];
        try {
          await this.#chainWriter.insertWithChain(
            t.spec.table as HashChainedTable, record, columns, values, columns.length - 1,
          );
          inserted += 1;
        } catch (err) {
          const e = err as { code?: string; constraint?: string } | null;
          // A duplicate on the NATURAL KEY is convergence: the same row reaching a node twice, or
          // from two peers, is the steady state. A duplicate on any OTHER unique constraint is not —
          // `user_accounts.phone_stub_hash` is UNIQUE and is NOT the natural key, so two nodes minting
          // an account for one phone stub is an identity FORK, which is exactly the divergence
          // anti-entropy exists to surface. Swallowing it as "convergence" would discard the evidence.
          // Exact match, and an UNNAMED 23505 is NOT assumed benign: defaulting the unknown case to
          // "convergence" silently skips a row on evidence we do not have.
          const naturalKeyViolation = e?.code === "23505" && e.constraint === t.naturalKeyConstraint;
          if (!naturalKeyViolation) {
            if (e?.code === "23505") {
              this.#logger?.error("antientropy.apply.constraint_conflict", {
                table: t.spec.table,
                constraint: e.constraint,
                reason: "unique violation on a NON-natural-key constraint — two nodes hold conflicting rows",
              });
              continue;
            }
            // A write failure on one record must not take the round down with it (and Tier-B, and the
            // kill switch). Name it loudly and keep going; a persistent one recurs in the log every
            // round rather than silently blocking suspension propagation.
            this.#logger?.error("antientropy.apply.failed", {
              table: t.spec.table,
              reason: e instanceof Error ? e.message : String(err),
            });
            continue;
          }
        }
        continue;
      }

      const placeholders = cols
        .map((c, i) => (t.bytea.includes(c) ? `decode($${i + 1},'hex')` : `$${i + 1}`))
        .join(", ");
      const values = cols.map((c) => body[c] ?? null);
      // PER-RECORD, matching the chained branch above. Without this, anything Postgres raises abandons
      // every REMAINING record in the batch: `decode(…,'hex')` on a malformed BYTEA (decode RAISES,
      // unlike Buffer.from), or a 23505 on one of the unique constraints `ON CONFLICT (naturalKey)`
      // does NOT cover — `agent_profiles` alone has three. The engine contains the throw at table
      // granularity so the round survives, but the poisoned record is re-planned every round and the
      // rest of that table's backlog never lands.
      try {
        const res = await this.#pool.query(
          `INSERT INTO ${t.spec.table} (${cols.join(", ")}) VALUES (${placeholders})
           ON CONFLICT (${conflict}) DO NOTHING`,
          values,
        );
        inserted += res.rowCount ?? 0;
      } catch (err) {
        const e = err as { code?: string; constraint?: string } | null;
        // Name the RECORD, not just the table. The bare pg message ("invalid hexadecimal digit") does
        // not say which row or column, and the table arrives separately in the round's failure list.
        this.#logger?.error("antientropy.apply.failed", {
          table: t.spec.table,
          naturalKey: t.spec.naturalKey.map((k) => String(body[k])).join("\u0000"),
          constraint: e?.constraint,
          reason: e instanceof Error ? e.message : String(err),
        });
      }
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
    // Types, not just shape. Everything below merges peer-supplied values, and a wrong type changes
    // which merge BRANCH runs — silently, and in the kill switch's favour-losing direction.
    const typeError = t.validateBody(rec.body);
    if (typeError) {
      throw new Error(`pg-ae-store: ${t.spec.table} record '${rec.key}' body ${typeError} — refusing to apply`);
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
          const priorVersion = encodeTierBVersion(t.spec, t.toVersionRow(local)).versionHash;
          const merged = t.merge(local, incoming);
          const mergedVersion = encodeTierBVersion(t.spec, t.toVersionRow(merged)).versionHash;
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
