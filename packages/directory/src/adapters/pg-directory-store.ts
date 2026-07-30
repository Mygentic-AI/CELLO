/**
 * PgDirectoryStore — Postgres-backed DirectoryStore for CELLO_ENV=local (Docker Compose)
 * and production environments (RDS).
 *
 * Used only by the composition root (bin/directory.ts). Never imported from application code.
 * PERSIST-001 SI-002: not exported from packages/directory index.ts.
 *
 * PERSIST-021: BIGINT_COLUMNS and STORE_TABLES are exported for use by the static analysis
 * gate tests (AC-005 and AC-006) and by the deserialization path (SI-001).
 *
 * FEDERATION-001: sessions table added to BIGINT_COLUMNS and STORE_TABLES; writeSession,
 * getSessionOwner, verifyReplicatedRow, and startup pg-type verification added.
 *
 * ACCOUNT-001: user_accounts table added to BIGINT_COLUMNS and STORE_TABLES; createAccount
 * and getAgentsByAccount methods added; setProfile updated to accept optional account_id.
 */

import pg from "pg";
import { createHash } from "node:crypto";
import { configurePgTypes } from "../pg-type-config.js";
import { stringify as jsonStringify, parse as jsonParse } from "../json-typed.js";
import type {
  DirectoryStore,
  DirectoryNotification,
  SealNotarization,
  ConversationSealRecord,
  Logger,
  AccountRow,
  CreateAccountParams,
  AgentRevocationRecord,
  PickupItem,
  AgentPresenceLookup,
} from "@cello-protocol/interfaces";
import { drainPickupForAgent, ackPickupDelete, sweepUndeliverablePickups } from "../pickup-repository.js";
import { enqueueSubmission } from "../submission-queue-repository.js";
import { readPresenceForDiscovery } from "../agent-presence-repository.js";
import type { AgentProfile, ConnectionRecord, PendingConnectionRequest } from "@cello-protocol/protocol-types";
import {
  computeChainHash,
  serializeRecord,
  verifyChain,
  CHAIN_GENESIS,
  HASH_CHAINED_TABLES,
  type ChainVerificationResult,
  type HashChainedTable,
} from "../hash-chain.js";

/**
 * PERSIST-021: Per-table BIGINT/BIGSERIAL column declarations.
 *
 * Pseudocode for deserialization at read time:
 *   1. When a row is fetched from table T, consult BIGINT_COLUMNS[T].
 *   2. For each declared column C in BIGINT_COLUMNS[T], apply parseInt(row[C], 10).
 *   3. If a column is NOT declared in BIGINT_COLUMNS[T], leave its value as-is.
 *      The AC-005 static gate enforces completeness of BIGINT_COLUMNS in CI.
 *
 * Source of truth: Flyway migration files in packages/directory/db/migrations/
 *   V2__directory_schema.sql   — agent_registrations id BIGSERIAL (table dropped in V16; agent_profiles is authoritative)
 *   V5__mmr_tables.sql         — conversation_proof_leaves leaf_index, mmr_position;
 *                                conversation_proof_mmr_nodes mmr_position;
 *                                directory_checkpoints mmr_leaf_count
 *   V7__analytics_tables.sql   — analytics tables (not in STORE_TABLES)
 *   V10__missing_table_stubs.sql — seal_notarizations, notification_queue,
 *                                  pending_connection_requests, connections (id BIGSERIAL)
 *   V11__connections_full_schema.sql — connections established_at BIGINT
 *   V12__seal_notarizations.sql — seal_notarizations close_timestamp BIGINT
 *
 * AC-005 static analysis gate: parsed by persist-021-adapter-boundary-audit.test.ts to
 * assert no BIGINT/BIGSERIAL column in STORE_TABLES-owned tables is absent from this map.
 *
 * Exported so the AC-005 gate test can import and inspect it directly.
 */
export const BIGINT_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  // Tables with BIGSERIAL id column (read back in SELECT *)
  // agent_registrations removed — table dropped in V16; agent_profiles (V9) is the authoritative agent identity table
  // agent_profiles: id BIGSERIAL, registered_at BIGINT (Unix ms timestamp) — V9 migration
  agent_profiles: ["id", "registered_at"],
  conversation_seals: ["id"],
  conversation_attestations: ["id"],
  conversation_participation: ["id"],
  notification_events: ["id"],
  // CELLO-M7-UPGRADE-001 (DOD-UP-1): supersedes_notarization_id is a nullable BIGINT FK added
  // by V31 — declared here so the AC-005 static gate passes and deserializeRow coerces it from
  // the pg string to a JS number (null stays null). It is excluded from chain serialization.
  seal_notarizations: ["id", "close_timestamp", "supersedes_notarization_id"],
  connection_requests: ["id"],
  connections: ["id", "established_at"],
  notification_queue: ["id"],
  pending_connection_requests: ["id"],
  // MMR tables with additional BIGINT columns
  conversation_proof_leaves: ["id", "leaf_index", "mmr_position"],
  conversation_proof_mmr_nodes: ["id", "mmr_position"],
  directory_checkpoints: ["id", "mmr_leaf_count"],
  // DEPLOY-001: directory_nodes table (V17 migration)
  directory_nodes: ["id"],
  // FEDERATION-001: sessions table (V18 migration)
  sessions: ["id"],
  // FEDERATION-002: checkpoint_node_signatures table (V18 migration)
  checkpoint_node_signatures: ["id"],
  // FEDERATION-003: relay_registrations table (V19 migration)
  relay_registrations: ["id"],
  // ACCOUNT-001: user_accounts table (V22 migration) — id is BIGSERIAL
  user_accounts: ["id"],
} as const;

/**
 * PERSIST-021: All table names that PgDirectoryStore writes to.
 *
 * This list is the authoritative scope boundary for AC-005 and AC-006 static analysis gates:
 *   - AC-005: each table in STORE_TABLES must have all BIGINT columns declared in BIGINT_COLUMNS
 *   - AC-006: each table in STORE_TABLES must have integration test coverage (write + read)
 *
 * Tables NOT in this list (tables owned by other domain migrations, such as CONNREQ tables)
 * are excluded from AC-005 and AC-006 diffs.
 *
 * Scope: Persistence domain (PERSIST-* stories). CONNREQ-domain tables that PgDirectoryStore
 * may read (e.g. connection_requests for SI-001 validation) are included because PgDirectoryStore
 * writes to them via insertWithChain.
 *
 * Exported so AC-006 gate test can import and iterate over it.
 */
export const STORE_TABLES = [
  // agent_registrations removed — table dropped in V16; agent_profiles (V9) is the authoritative agent identity table
  "agent_profiles",
  "conversation_seals",
  "conversation_attestations",
  "conversation_participation",
  "notification_events",
  "seal_notarizations",
  "connection_requests",
  "connections",
  "notification_queue",
  "pending_connection_requests",
  "conversation_proof_leaves",
  "conversation_proof_mmr_nodes",
  "directory_checkpoints",
  "directory_nodes",
  // FEDERATION-001: sessions table added (V18 migration)
  "sessions",
  // FEDERATION-002: checkpoint_node_signatures table added (V18 migration)
  "checkpoint_node_signatures",
  // FEDERATION-003: relay_registrations table added (V19 migration)
  "relay_registrations",
  // ACCOUNT-001: user_accounts table added (V22 migration)
  "user_accounts",
] as const;

export type StoreTables = (typeof STORE_TABLES)[number];

/**
 * PERSIST-021: Deserialize a row from a named table, converting BIGINT columns to
 * JavaScript numbers using the BIGINT_COLUMNS declaration map.
 *
 * Pseudocode:
 *   1. Look up BIGINT_COLUMNS[tableName]. If not found, return row as-is (no BIGINT columns
 *      declared for this table — a string will propagate and be caught by AC-005 gate in CI).
 *   2. For each declared column in BIGINT_COLUMNS[tableName]:
 *      - If the value is a string (as returned by pg driver), apply parseInt(value, 10).
 *      - If the value is already a number, leave it unchanged.
 *   3. Columns NOT in the declared set are returned as-is, regardless of their string content.
 *      The AC-005 static gate (CI) is the enforcement mechanism for undeclared BIGINT columns —
 *      a runtime regex heuristic would incorrectly fire on all-digit TEXT columns
 *      (e.g., a phone_hash or payload value that happens to be all digits).
 *
 * Exported so integration tests can call deserializeRow directly to verify BIGINT coercion
 * in read paths that are not already exercised by PgDirectoryStore method return values.
 */
export function deserializeRow<T extends Record<string, unknown>>(
  tableName: string,
  row: Record<string, unknown>,
): T {
  const bigintCols = new Set(BIGINT_COLUMNS[tableName] ?? []);
  const result: Record<string, unknown> = {};
  for (const [col, value] of Object.entries(row)) {
    if (bigintCols.has(col)) {
      // Declared BIGINT column — coerce string to number (pg driver returns BIGINT as string)
      result[col] = typeof value === "string" ? parseInt(value, 10) : value;
    } else {
      // Not a declared BIGINT column — leave as-is
      result[col] = value;
    }
  }
  return result as T;
}


export class PgDirectoryStore implements DirectoryStore {
  readonly #pool: pg.Pool;
  readonly #logger: Logger;
  readonly #nodeId: string;
  readonly #region: string;
  // In-memory profile cache — two indexes for the two lookup patterns:
  //   #profilesByLocalKey:   k_local_pubkey (own_pubkey) → profile
  //   #profilesByPrimaryKey: primary_pubkey (FROST group key) → profile
  //   #profilesByAgentId:    agent_id (32 hex chars) → profile
  // The connection pre-check (directory-node.ts line 1152) looks up by whatever
  // target_pubkey the initiating agent supplies. Agents supply the target's k_local_pubkey
  // (own_pubkey), but having both indexes means either key works robustly.
  // AC-007a (DX-001): #profilesByAgentId supports GET /agent-lookup?agent_id=<hex>.
  readonly #profilesByLocalKey = new Map<string, AgentProfile>();
  readonly #profilesByPrimaryKey = new Map<string, AgentProfile>();
  readonly #profilesByAgentId = new Map<string, AgentProfile>();

  // CELLO-M7-REMOVE-001 (DOD-REMOVE-2/3): agent revocations. #revokedPubkeys is the synchronous
  // soft-refuse index (k_local_pubkey hex); #revocationsByAgentId serves the read-back (AC-002).
  readonly #revokedPubkeys = new Set<string>();
  readonly #revocationsByAgentId = new Map<string, AgentRevocationRecord>();

  /**
   * Pseudocode for constructor (FEDERATION-001 AC-011):
   *   1. Call configurePgTypes() — idempotent, safe to call multiple times.
   *   2. Store pool, logger, nodeId, region.
   *   3. (Async startup verification — call verifyPgTypes() after construction
   *      from the composition root or use the static factory method.)
   *
   * The startup type-parser verification (AC-011) is performed by verifyPgTypes()
   * which must be called once after construction. The constructor itself is sync
   * to preserve compatibility with existing call sites.
   *
   * @param pool - The pg.Pool instance for this node
   * @param logger - Injected logger (domain.noun.verb taxonomy)
   * @param nodeId - This node's node_id (used for ownership checks and observability)
   * @param region - This node's region (used for observability events)
   */
  constructor(pool: pg.Pool, logger: Logger, nodeId = "local", region = "local") {
    configurePgTypes();
    this.#pool = pool;
    this.#logger = logger;
    this.#nodeId = nodeId;
    this.#region = region;
  }

  async loadProfiles(): Promise<void> {
    const result = await this.#pool.query<{
      k_local_pubkey: string;
      primary_pubkey: string;
      ml_dsa_pubkey: string;
      phone_stub_hash: string;
      registered_at: number;
      status: string;
      agent_id: string | null;
    }>(`SELECT k_local_pubkey, primary_pubkey, ml_dsa_pubkey, phone_stub_hash, registered_at, status, agent_id FROM agent_profiles WHERE status = 'active'`);
    for (const row of result.rows) {
      // V27 migration adds agent_id column. Rows created before V27 have a backfilled value.
      // Fallback to SHA-256 derivation for any null rows (should not occur post-V27).
      const agentId = row.agent_id ?? createHash("sha256").update(row.k_local_pubkey, "utf8").digest("hex").slice(0, 32);
      const profile = {
        k_local_pubkey: row.k_local_pubkey,
        primary_pubkey: row.primary_pubkey,
        ml_dsa_pubkey: row.ml_dsa_pubkey,
        phone_stub_hash: row.phone_stub_hash,
        registered_at: Number(row.registered_at),
        status: row.status as "active",
        agent_id: agentId,
        profile: {},
      };
      this.#profilesByLocalKey.set(row.k_local_pubkey, profile);
      this.#profilesByPrimaryKey.set(row.primary_pubkey, profile);
      this.#profilesByAgentId.set(agentId, profile);
    }
    this.#logger.info("adapter.profiles.loaded", { count: result.rows.length });
    await this.#loadRevocations();
  }

  /**
   * REMOVE-001 (DOD-REMOVE-2/3): load the agent revocations into the synchronous in-memory indexes.
   * JOINs agent_profiles to recover each revoked agent's k_local_pubkey (not a stored column). Called
   * at the end of loadProfiles (startup + restart) so the soft-refuse path and the read-back are warm.
   */
  async #loadRevocations(): Promise<void> {
    const result = await this.#pool.query<{
      agent_id: string;
      k_local_pubkey: string | null;
      epoch_id: string | null;
      reason: string | null;
      signature: Buffer;
      revoked_at: string | number;
    }>(
      `SELECT ar.agent_id, ap.k_local_pubkey, ar.epoch_id, ar.reason, ar.signature, ar.revoked_at
         FROM agent_revocations ar
         LEFT JOIN agent_profiles ap ON ap.agent_id = ar.agent_id`,
    );
    let unenforceable = 0;
    for (const row of result.rows) {
      const kLocalPubkey = row.k_local_pubkey ?? "";
      const rec: AgentRevocationRecord = {
        agentId: row.agent_id,
        kLocalPubkey,
        epochId: row.epoch_id ?? "",
        reason: row.reason ?? "",
        signature: new Uint8Array(row.signature),
        revokedAt: Number(row.revoked_at),
      };
      this.#revocationsByAgentId.set(row.agent_id, rec);
      if (kLocalPubkey) {
        this.#revokedPubkeys.add(kLocalPubkey);
      } else {
        // The revocation exists but its agent_profiles row (and thus k_local_pubkey) is absent — e.g.
        // the revocation replicated ahead of the profile on a peer node. The soft-refuse gate keys by
        // pubkey, so this agent CANNOT be enforced until the profile arrives + reload. Surface it
        // LOUDLY (fallback-finder HIGH-2 / review): a silently-unenforceable revocation must not look
        // healthy. The row stays in the read-back map (getAgentRevocation) for verifiability.
        unenforceable++;
        this.#logger.error("adapter.revocation.unenforceable", { agentId: row.agent_id });
      }
    }
    this.#logger.info("adapter.revocations.loaded", { count: result.rows.length, unenforceable });
  }

  /**
   * Append a verified revocation. Resolves ONLY after the row is DURABLY committed (mirrors
   * recordNotarization: one retry, then rethrow) — the in-memory soft-refuse/read-back indexes are
   * updated AFTER the commit, so a failed write never leaves the directory advertising a revocation it
   * did not persist (review HIGH / fallback-finder HIGH-1). REJECTS on durable failure so the caller
   * sends a persist_failed error instead of a false "recorded" ack.
   */
  async insertAgentRevocation(rec: AgentRevocationRecord): Promise<void> {
    if (this.#revocationsByAgentId.has(rec.agentId)) return; // already durably recorded — idempotent
    const params = [rec.agentId, rec.epochId, rec.reason, Buffer.from(rec.signature), rec.revokedAt];
    const sql = `INSERT INTO agent_revocations (agent_id, epoch_id, reason, signature, revoked_at)
                 VALUES ($1, $2, $3, $4, $5) ON CONFLICT (agent_id) DO NOTHING`;
    try {
      await this.#pool.query(sql, params);
    } catch {
      this.#logger.error("adapter.revocation.write.failed", { agentId: rec.agentId, attempt: 1 });
      try {
        await this.#pool.query(sql, params); // retry once
      } catch (err2) {
        this.#logger.error("adapter.revocation.write.failed", { agentId: rec.agentId, attempt: 2 });
        throw err2 instanceof Error ? err2 : new Error(String(err2));
      }
    }
    // Durable — only now update the in-memory indexes (soft-refuse + read-back).
    this.#revocationsByAgentId.set(rec.agentId, rec);
    if (rec.kLocalPubkey) this.#revokedPubkeys.add(rec.kLocalPubkey);
    this.#logger.info("adapter.revocation.recorded", { agentId: rec.agentId });
  }

  isAgentRevoked(kLocalPubkeyHex: string): boolean {
    return this.#revokedPubkeys.has(kLocalPubkeyHex);
  }

  getAgentRevocation(agentId: string): AgentRevocationRecord | undefined {
    return this.#revocationsByAgentId.get(agentId);
  }

  // CELLO-M8-LEVER-001 (DOD-INV-6): reversible suspend honor-check. A pause is MUTABLE and a
  // security control, so this reads the live replicated row directly — NOT an in-memory cache that
  // could be stale and let a paused (possibly-compromised) agent sign. One indexed join from the
  // ceremony-time k_local_pubkey to the agent's current pause flag.
  async isAgentSuspended(kLocalPubkeyHex: string): Promise<boolean> {
    const result = await this.#pool.query(
      `SELECT 1 FROM agent_suspensions s
         JOIN agent_profiles p ON p.agent_id = s.agent_id
        WHERE p.k_local_pubkey = $1 AND s.paused = true
        LIMIT 1`,
      [kLocalPubkeyHex],
    );
    // rows.length (always an array), NOT rowCount ?? 0 — a security gate must not default fail-OPEN.
    return result.rows.length > 0;
  }

  // SUSPEND-1 review (fallback HIGH): does THIS node hold a profile for the agent? When it does not,
  // isAgentSuspended above JOINs to zero rows and the node signs BLIND to any suspension — the
  // single-node-honor gap. Used only to emit the loud `frost.suspension.uncheckable` warn.
  async hasAgentProfile(kLocalPubkeyHex: string): Promise<boolean> {
    const result = await this.#pool.query(
      `SELECT 1 FROM agent_profiles WHERE k_local_pubkey = $1 LIMIT 1`,
      [kLocalPubkeyHex],
    );
    return result.rows.length > 0;
  }

  async listBurnedAgentPubkeys(): Promise<string[]> {
    const result = await this.#pool.query<{ k_local_pubkey: string }>(
      `SELECT p.k_local_pubkey
         FROM agent_suspensions s
         JOIN agent_profiles p ON p.agent_id = s.agent_id
        WHERE s.burned = true`,
    );
    return result.rows.map((r) => r.k_local_pubkey);
  }

  async isAgentBurned(kLocalPubkeyHex: string): Promise<boolean> {
    const result = await this.#pool.query(
      `SELECT 1 FROM agent_suspensions s
         JOIN agent_profiles p ON p.agent_id = s.agent_id
        WHERE p.k_local_pubkey = $1 AND s.burned = true
        LIMIT 1`,
      [kLocalPubkeyHex],
    );
    // rows.length (always an array), NOT rowCount ?? 0 — a security gate must not default fail-OPEN.
    return result.rows.length > 0;
  }

  // CELLO-M8-TRUST-001: trust-signal pickup delivery (the pickup queue is keyed by agent_id).
  async getAgentIdByPubkey(kLocalPubkeyHex: string): Promise<string | null> {
    const result = await this.#pool.query<{ agent_id: string | null }>(
      `SELECT agent_id FROM agent_profiles WHERE k_local_pubkey = $1`,
      [kLocalPubkeyHex],
    );
    return result.rows[0]?.agent_id ?? null;
  }

  async drainPickup(agentId: string): Promise<PickupItem[]> {
    return drainPickupForAgent(this.#pool, agentId);
  }

  async ackPickup(id: string, agentId: string): Promise<void> {
    await ackPickupDelete(this.#pool, id, agentId);
  }

  async sweepUndeliverablePickups(ttlHours = 24): Promise<number> {
    return sweepUndeliverablePickups(this.#pool, this.#nodeId, ttlHours);
  }

  /** M10B / DOD-END-SUBMIT-1 — see the interface for why the boolean must not be discarded. */
  async enqueueSubmission(s: { submissionId: string; intakeKeyId: string; ciphertext: Buffer }): Promise<boolean> {
    return enqueueSubmission(this.#pool, s);
  }

  /**
   * FEDERATION-001 AC-011 / SI-004: Verify pg type parsers are configured correctly.
   *
   * Pseudocode:
   *   1. Query a known TIMESTAMPTZ column (created_at from directory_nodes or any table).
   *      Use a SELECT that returns a row with TIMESTAMPTZ to exercise the type parser.
   *   2. If the returned value is a string (not a Date object): type parsers are correct.
   *      Log db.type-parsers.verified at INFO with { nodeId, region }.
   *   3. If the returned value is a Date object: type parsers are not configured.
   *      Log db.type-parsers.verification.failed at ERROR with { nodeId, region }.
   *      Throw an error to prevent startup.
   *
   * Must be called once after construction from the composition root.
   * configurePgTypes() is called in the constructor — this method verifies the result.
   */
  async verifyPgTypes(): Promise<void> {
    // AC-011: query a known DATE literal to verify DATE type parsers are returning strings.
    // The multi-region chain hash risk is specifically with DATE columns — a DATE stored as
    // '2026-01-01' reads back as a different timestamp in a different timezone if type
    // parsers are not configured. SELECT '2026-01-01'::date requires no table to exist.
    const result = await this.#pool.query<{ d: unknown }>("SELECT '2026-01-01'::date AS d");
    const value = result.rows[0]?.d;
    if (typeof value !== "string") {
      this.#logger.error("db.type-parsers.verification.failed", {
        nodeId: this.#nodeId,
        region: this.#region,
      });
      throw new Error(
        `PgDirectoryStore: pg type parsers not configured — DATE literal returned ${typeof value}, expected string. ` +
        `configurePgTypes() must be called before any Pool is created.`,
      );
    }
    this.#logger.info("db.type-parsers.verified", {
      nodeId: this.#nodeId,
      region: this.#region,
    });
  }

  // PERSIST-016 observability: tableName is required so operators can distinguish a
  // missing-table failure from a connection failure or a constraint violation.
  #fire(query: Promise<unknown>, tableName: string): void {
    void query.catch((err: unknown) => {
      const reason = err instanceof Error ? err.message : String(err);
      this.#logger.error("adapter.write.failed", { adapterName: "PgDirectoryStore", reason, tableName });
    });
  }

  // ─── SealNotarization ────────────────────────────────────────────────────

  /**
   * Pseudocode (PERSIST-018):
   *
   * 1. Convert notarization fields to Buffers for Postgres BYTEA columns.
   * 2. Build the record object (without chain_hash — it is always computed).
   * 3. Call insertWithChain() which:
   *    a. Acquires a pg_advisory_xact_lock on "seal_notarizations"
   *    b. Fetches the previous chain_hash (or CHAIN_GENESIS if table is empty)
   *    c. Computes chain_hash = SHA-256(serialize(record) || previous_hash)
   *    d. Issues the INSERT with the computed chain_hash
   * 4. On success: log notarization.recorded at INFO with { sessionId, sealedRoot, correlationId }
   * 5. On unique constraint violation (duplicate session_id):
   *    log notarization.duplicate.rejected at WARN with { sessionId }; do not rethrow
   * 6. On other error (attempt 1): log notarization.write.failed at ERROR; retry once
   * 7. On retry failure (attempt 2): log notarization.write.failed at ERROR; rethrow
   *
   * SI-001: chain_hash is computed internally — never accepted from caller
   * SI-001: frost_signature is stored as-is from the caller (it comes from the
   *   FROST ceremony in directory-node.ts — this method never recomputes it)
   */
  async recordNotarization(
    notarization: SealNotarization,
    opts?: { correlationId?: string; client?: pg.PoolClient },
  ): Promise<void> {
    const sessionIdHex = Buffer.from(notarization.session_id).toString("hex");
    const sealedRootHex = Buffer.from(notarization.sealed_root).toString("hex");
    const correlationId = opts?.correlationId;
    const externalClient = opts?.client;

    // Build the record for chain serialization — exactly the fields stored in the table,
    // minus chain_hash (computed server-side) and id (BIGSERIAL, DB-generated).
    // Buffer values are used for serialization consistency with what pg returns at verify time.
    const sessionIdBuf = Buffer.from(notarization.session_id);
    const sealedRootBuf = Buffer.from(notarization.sealed_root);
    const participantABuf = Buffer.from(notarization.participant_a_pubkey);
    const participantBBuf = Buffer.from(notarization.participant_b_pubkey);
    const frostSigBuf = Buffer.from(notarization.frost_signature);

    // DOD-UP-1: seal_type discriminates unilateral vs bilateral; defaults to 'bilateral' (the
    // pre-UP-1 two-party path). supersedes_notarization_id points the superseding bilateral row
    // at the unilateral row it replaces; null on every other row. Both are EXCLUDED from chain
    // serialization (see hash-chain.ts TABLE_EXTRA_EXCLUDED) — they appear in the record only so
    // the insertWithChain column/record consistency guard is satisfied; serializeRecord drops them.
    const sealType: "unilateral" | "bilateral" = notarization.seal_type ?? "bilateral";
    const supersedesId: number | null = notarization.supersedes_notarization_id ?? null;

    const record: Record<string, unknown> = {
      session_id: sessionIdBuf,
      sealed_root: sealedRootBuf,
      participant_a_pubkey: participantABuf,
      participant_b_pubkey: participantBBuf,
      close_timestamp: notarization.close_timestamp,
      frost_signature: frostSigBuf,
      seal_type: sealType,
      supersedes_notarization_id: supersedesId,
    };

    const columns = [
      "session_id",
      "sealed_root",
      "participant_a_pubkey",
      "participant_b_pubkey",
      "close_timestamp",
      "frost_signature",
      "seal_type",
      "supersedes_notarization_id",
      "chain_hash",
    ];
    const values: unknown[] = [
      sessionIdBuf,
      sealedRootBuf,
      participantABuf,
      participantBBuf,
      notarization.close_timestamp,
      frostSigBuf,
      sealType,
      supersedesId,
      "", // placeholder — overwritten by insertWithChain
    ];
    const chainHashIndex = 8;

    // Attempt 1
    try {
      await this.insertWithChain("seal_notarizations", record, columns, values, chainHashIndex, externalClient, correlationId);
      this.#logger.info("notarization.recorded", {
        sessionId: sessionIdHex,
        sealedRoot: sealedRootHex,
        correlationId,
      });
      return;
    } catch (err) {
      // Unique constraint violation — duplicate session_id
      if (this.#isUniqueViolation(err)) {
        this.#logger.warn("notarization.duplicate.rejected", { sessionId: sessionIdHex });
        return;
      }
      const reason = err instanceof Error ? err.message : String(err);
      this.#logger.error("notarization.write.failed", { sessionId: sessionIdHex, reason, attempt: 1 });
    }

    // Attempt 2 (retry)
    try {
      await this.insertWithChain("seal_notarizations", record, columns, values, chainHashIndex, externalClient, correlationId);
      this.#logger.info("notarization.recorded", {
        sessionId: sessionIdHex,
        sealedRoot: sealedRootHex,
        correlationId,
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.#logger.error("notarization.write.failed", { sessionId: sessionIdHex, reason, attempt: 2 });
      throw err;
    }
  }

  /** Whether a Postgres error is a unique constraint violation (SQLSTATE 23505). */
  #isUniqueViolation(err: unknown): boolean {
    return (
      err instanceof Error &&
      "code" in err &&
      (err as { code: string }).code === "23505"
    );
  }

  /** Whether a Postgres error is a foreign key violation (SQLSTATE 23503). */
  #isFkViolation(err: unknown): boolean {
    return (
      err instanceof Error &&
      "code" in err &&
      (err as { code: string }).code === "23503"
    );
  }

  /**
   * Retrieve a SealNotarization by session_id (hex-encoded).
   * Returns undefined if no row exists — absence is not an error.
   *
   * PERSIST-018 AC-006: does not throw and does not log an error on absence.
   *
   * DOD-UP-1: a session may hold a unilateral row and a superseding bilateral row. We return
   * the AUTHORITATIVE seal — the bilateral row when an upgrade has occurred, else the unilateral
   * row. `ORDER BY (seal_type = 'bilateral') DESC` puts a bilateral row first; the seal_type and
   * supersedes_notarization_id fields are carried on the returned record.
   */
  async getNotarization(sessionIdHex: string): Promise<SealNotarization | undefined> {
    const result = await this.#pool.query<Record<string, unknown>>(
      `SELECT session_id, sealed_root, participant_a_pubkey, participant_b_pubkey,
              close_timestamp, frost_signature, seal_type, supersedes_notarization_id
       FROM seal_notarizations
       WHERE session_id = decode($1, 'hex')
       ORDER BY (seal_type = 'bilateral') DESC, id DESC
       LIMIT 1`,
      [sessionIdHex],
    );

    if (result.rows.length === 0) return undefined;

    const row = deserializeRow<{
      session_id: Buffer;
      sealed_root: Buffer;
      participant_a_pubkey: Buffer;
      participant_b_pubkey: Buffer;
      close_timestamp: number;
      frost_signature: Buffer;
      seal_type: "unilateral" | "bilateral";
      supersedes_notarization_id: number | null;
    }>("seal_notarizations", result.rows[0]!);
    return {
      session_id: new Uint8Array(row.session_id),
      sealed_root: new Uint8Array(row.sealed_root),
      participant_a_pubkey: new Uint8Array(row.participant_a_pubkey),
      participant_b_pubkey: new Uint8Array(row.participant_b_pubkey),
      close_timestamp: row.close_timestamp,
      frost_signature: new Uint8Array(row.frost_signature),
      seal_type: row.seal_type,
      supersedes_notarization_id: row.supersedes_notarization_id,
    };
  }

  /**
   * DOD-UP-1: fetch the DB row id of a notarization by (session, seal_type). The upgrade
   * ceremony calls this to set supersedes_notarization_id on the new bilateral row. Returns
   * undefined when no such row exists.
   */
  async getNotarizationId(
    sessionIdHex: string,
    sealType: "unilateral" | "bilateral",
  ): Promise<number | undefined> {
    const result = await this.#pool.query<{ id: string }>(
      `SELECT id FROM seal_notarizations
       WHERE session_id = decode($1, 'hex') AND seal_type = $2
       LIMIT 1`,
      [sessionIdHex, sealType],
    );
    if (result.rows.length === 0) return undefined;
    return parseInt(result.rows[0]!.id, 10);
  }

  // ─── SEAL-2: relationship-graph rows (Sybil/relationship-farming defense) ──────

  /**
   * Write the relationship-graph rows for a completed seal, ATOMICALLY across the three
   * hash-chained tables: conversation_seals (close_type + the sealed root HASH) + one
   * conversation_participation row per party (the graph edge: two parties of a sealed
   * conversation) + one conversation_attestations row per party.
   *
   * PRIVACY: relationship METADATA + the root HASH only — never content. `pseudonym` is the party's
   * k_local pubkey hex (stable graph identity the directory already holds in seal_notarizations).
   *
   * conversation_seals.conversation_id is UNIQUE, so this is written ONCE per conversation (the
   * normal-bilateral and unilateral seal paths). The unilateral→bilateral UPGRADE does NOT call this
   * — the A↔B edge already exists from the unilateral seal, and a second seal row would violate the
   * UNIQUE constraint. The seal's authoritative record is seal_notarizations; this is best-effort
   * analytics and must NEVER block a seal (callers fire-and-forget + log).
   */
  async recordConversationSeal(
    seal: ConversationSealRecord,
    opts?: { correlationId?: string; client?: pg.PoolClient },
  ): Promise<void> {
    const correlationId = opts?.correlationId;
    const externalClient = opts?.client;
    const ownsTransaction = !externalClient;
    const client = externalClient ?? await this.#pool.connect();
    try {
      if (ownsTransaction) await client.query("BEGIN");

      // 1. conversation_seals (FK parent — must precede participation/attestations). seal_date is a
      //    DATE column. CR-L4: compute the date in UTC as a 'YYYY-MM-DD' string rather than passing a
      //    Date — a Date is truncated to a date in the DB SESSION timezone, which would shift seal_date
      //    (and thus analytics last_activity = MAX(seal_date)) by a day near midnight on a non-UTC node.
      //    seal_date is excluded from the chain (hash-chain.ts), so this affects only analytics, never
      //    integrity. NB: the hex TEXT columns (merkle_root/pseudonym/seal_signature) DO chain; an
      //    all-decimal-digit value would be number-coerced by serializeRecord (CR-L2), binding only its
      //    leading ~16 digits — self-verifying (no break) and ~1e-12 likely for a 32-byte hash/pubkey.
      const sealDate = new Date(seal.closeTimestampMs).toISOString().slice(0, 10);
      await this.insertWithChain(
        "conversation_seals",
        { conversation_id: seal.conversationId, merkle_root: seal.merkleRootHex, close_type: seal.closeType, participant_count: seal.parties.length, seal_date: sealDate },
        ["conversation_id", "merkle_root", "close_type", "participant_count", "seal_date", "chain_hash"],
        [seal.conversationId, seal.merkleRootHex, seal.closeType, seal.parties.length, sealDate, ""],
        5,
        client,
        correlationId,
      );

      // 2. conversation_participation — one per party (the graph nodes/edge).
      for (const p of seal.parties) {
        await this.insertWithChain(
          "conversation_participation",
          { conversation_id: seal.conversationId, party_pseudonym: p.pseudonym },
          ["conversation_id", "party_pseudonym", "chain_hash"],
          [seal.conversationId, p.pseudonym, ""],
          2,
          client,
          correlationId,
        );
      }

      // 3. conversation_attestations — one per party (their seal-time attestation).
      for (const p of seal.parties) {
        await this.insertWithChain(
          "conversation_attestations",
          { conversation_id: seal.conversationId, participant_pseudonym: p.pseudonym, attestation: p.attestation, seal_signature: p.sealSignatureHex },
          ["conversation_id", "participant_pseudonym", "attestation", "seal_signature", "chain_hash"],
          [seal.conversationId, p.pseudonym, p.attestation, p.sealSignatureHex, ""],
          4,
          client,
          correlationId,
        );
      }

      if (ownsTransaction) await client.query("COMMIT");
      this.#logger.info("conversation.seal.recorded", {
        conversationId: seal.conversationId, closeType: seal.closeType, participantCount: seal.parties.length, correlationId,
      });
    } catch (err) {
      if (ownsTransaction) await client.query("ROLLBACK").catch(() => { /* ignore */ });
      const reason = err instanceof Error ? err.message : String(err);
      // Best-effort: a UNIQUE(conversation_id) violation (a duplicate seal for the same conversation)
      // is benign — the graph row already exists; log at WARN, do not surface.
      this.#logger.warn("conversation.seal.record.failed", { conversationId: seal.conversationId, reason, correlationId });
      // When the caller supplied a client (atomic with the notarization), rethrow so their
      // transaction rolls back consistently; when we own the transaction, swallow (never block a seal).
      if (!ownsTransaction) throw err;
    } finally {
      if (ownsTransaction) client.release();
    }
  }

  // ─── Notification queues (PERSIST-019) ───────────────────────────────────

  enqueueNotification(pubkeyHex: string, event: DirectoryNotification, correlationId?: string): void {
    // Pseudocode:
    //   INSERT INTO notification_queue (pubkey_hex, payload) VALUES ($1, $2)
    //   ON SUCCESS: logger.info("notification.queued", { pubkeyHex, notificationType, correlationId })
    //   ON FAILURE: logger.error("notification.enqueue.failed", err, { pubkeyHex, notificationType, reason })
    void this.#pool.query(
      `INSERT INTO notification_queue (pubkey_hex, payload)
       VALUES ($1, $2)`,
      [pubkeyHex, jsonStringify(event)],
    ).then(() => {
      // correlationId is always included — if undefined, CloudWatch records null rather
      // than silently omitting the field (AC spec requires correlationId as a required field).
      this.#logger.info("notification.queued", {
        pubkeyHex,
        notificationType: event.type,
        correlationId,
      });
    }).catch((err: unknown) => {
      const reason = err instanceof Error ? err.message : String(err);
      // Use 3-arg logger form so the Error stack trace is preserved in CloudWatch.
      this.#logger.error("notification.enqueue.failed", err as Error, {
        pubkeyHex,
        notificationType: event.type,
        reason,
      });
    });
  }

  /**
   * PERSIST-019: Drain all notifications for a pubkey from Postgres in a single atomic operation.
   * Implements the DirectoryStore interface (now async for real Postgres support).
   *
   * Pseudocode (SI-001: single atomic statement prevents double delivery):
   *   WITH drained AS (
   *     DELETE FROM notification_queue WHERE pubkey_hex = $1
   *     RETURNING id, payload
   *   )
   *   SELECT id, payload FROM drained ORDER BY id ASC
   *
   * The DELETE+RETURNING CTE is atomic — concurrent callers race to delete, but
   * only one DELETE wins; the second sees 0 rows (already deleted by the first).
   * No advisory lock needed — PostgreSQL MVCC handles this natively.
   *
   * AC-009: logs notification.drained when items are returned.
   * SI-001: atomic SELECT+DELETE prevents double delivery.
   */
  /**
   * DOD-SEAL-BROKER-1 (receipt fetch): the notarization for one session, from THIS node's copy.
   *
   * Reads the replicated table, so a node that never adjudicated the seal still answers correctly once
   * anti-entropy has carried the row. Newest first: V31 allows a superseding notarization for the same
   * session, and the current one is what a participant should be told about.
   */
  async getSealNotarization(sessionIdHex: string): Promise<{
    sessionIdHex: string;
    sealedRoot: Uint8Array;
    participantAPubkey: Uint8Array;
    participantBPubkey: Uint8Array;
    closeTimestamp: number;
    frostSignature: Uint8Array;
    sealType: string;
  } | null> {
    const r = await this.#pool.query<{
      sealed_root: Buffer;
      participant_a_pubkey: Buffer;
      participant_b_pubkey: Buffer;
      close_timestamp: string;
      frost_signature: Buffer;
      seal_type: string;
    }>(
      `SELECT sealed_root, participant_a_pubkey, participant_b_pubkey, close_timestamp,
              frost_signature, seal_type
         FROM seal_notarizations
        WHERE session_id = $1
        ORDER BY id DESC
        LIMIT 1`,
      [Buffer.from(sessionIdHex, "hex")],
    );
    const row = r.rows[0];
    if (!row) return null;
    return {
      sessionIdHex,
      sealedRoot: new Uint8Array(row.sealed_root),
      participantAPubkey: new Uint8Array(row.participant_a_pubkey),
      participantBPubkey: new Uint8Array(row.participant_b_pubkey),
      // BIGINT arrives as a string from pg; Number() is safe for a millisecond timestamp.
      closeTimestamp: Number(row.close_timestamp),
      frostSignature: new Uint8Array(row.frost_signature),
      sealType: row.seal_type,
    };
  }

  async drainNotifications(pubkeyHex: string, correlationId: string): Promise<DirectoryNotification[]> {
    const result = await this.#pool.query<{ id: string; payload: unknown }>(
      `WITH drained AS (
         DELETE FROM notification_queue WHERE pubkey_hex = $1
         RETURNING id, payload
       )
       SELECT id, payload FROM drained ORDER BY id ASC`,
      [pubkeyHex],
    );

    // pg auto-parses JSONB columns into JS objects, so row.payload is already parsed.
    // Re-stringify then jsonParse runs the Uint8Array reviver over the full object tree,
    // restoring any {__type:"Uint8Array",hex:"..."} sentinels to real Uint8Array instances.
    const notifications: DirectoryNotification[] = result.rows.map(
      (row) => jsonParse<DirectoryNotification>(JSON.stringify(row.payload)),
    );

    if (notifications.length > 0) {
      // AC-009: only logged when count > 0 per AC-009 trigger condition
      this.#logger.info("notification.drained", {
        pubkeyHex,
        count: notifications.length,
        correlationId,
      });
    }

    return notifications;
  }

  // ─── Agent profiles ───────────────────────────────────────────────────────

  setProfile(profile: AgentProfile, correlationId?: string): void {
    // Cache by all keys immediately — connection pre-check uses k_local_pubkey,
    // but indexing by primary_pubkey too means either key works robustly.
    // AC-007a (DX-001): also index by agent_id for /agent-lookup endpoint.
    this.#profilesByLocalKey.set(profile.k_local_pubkey, profile);
    this.#profilesByPrimaryKey.set(profile.primary_pubkey, profile);
    if (profile.agent_id) {
      this.#profilesByAgentId.set(profile.agent_id, profile);
    }

    // ACCOUNT-001: if account_id is provided, fire INSERT with account_id and emit
    // account.agent.linked only after the INSERT confirms success (MEDIUM finding #3:
    // log must not fire before the INSERT completes — a false positive log on FK failure
    // would emit "linked" followed by "link.failed" for the same operation, which is
    // contradictory and confusing for operators).
    const accountId = (profile as AgentProfile & { account_id?: string | null }).account_id ?? null;

    // Persist to Postgres (V9 migration adds agent_profiles table;
    // V22 migration adds account_id nullable column).
    if (accountId !== null && accountId !== undefined) {
      // When account_id is set, handle FK violation specifically to emit account.agent.link.failed.
      // account.agent.linked fires ONLY on INSERT success (after the INSERT resolves).
      const agentId = profile.k_local_pubkey;
      void this.#pool.query(
        `INSERT INTO agent_profiles
           (k_local_pubkey, primary_pubkey, ml_dsa_pubkey, phone_stub_hash, registered_at, status, account_id, agent_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (k_local_pubkey) DO NOTHING`,
        [
          profile.k_local_pubkey,
          profile.primary_pubkey,
          profile.ml_dsa_pubkey,
          profile.phone_stub_hash,
          profile.registered_at,
          profile.status,
          accountId,
          profile.agent_id,
        ],
      ).then(() => {
        // ACCOUNT-001: log account.agent.linked only after INSERT confirms success.
        // correlationId is threaded from M6 callers; undefined for pre-M6 usage.
        this.#logger.info("account.agent.linked", {
          accountId,
          agentId,
          correlationId,
        });
      }).catch((err: unknown) => {
        const reason = err instanceof Error ? err.message : String(err);
        // ACCOUNT-001: FK violation (23503) — account_id not in user_accounts
        if (this.#isFkViolation(err)) {
          this.#logger.error("account.agent.link.failed", {
            accountId,
            agentId,
            reason,
            correlationId,
          });
        } else {
          this.#logger.error("adapter.write.failed", { adapterName: "PgDirectoryStore", reason, tableName: "agent_profiles" });
        }
      });
    } else {
      this.#fire(
        this.#pool.query(
          `INSERT INTO agent_profiles
             (k_local_pubkey, primary_pubkey, ml_dsa_pubkey, phone_stub_hash, registered_at, status, agent_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT (k_local_pubkey) DO NOTHING`,
          [
            profile.k_local_pubkey,
            profile.primary_pubkey,
            profile.ml_dsa_pubkey,
            profile.phone_stub_hash,
            profile.registered_at,
            profile.status,
            profile.agent_id,
          ],
        ),
        "agent_profiles",
      );
    }
  }

  /**
   * ACCOUNT-001: Create a new user_accounts row via insertWithChain.
   *
   * Pseudocode:
   *   1. Build record with account_id, phone_stub_hash (email_stub_hash is optional).
   *   2. Call insertWithChain("user_accounts", ...) which acquires advisory lock,
   *      fetches previous chain_hash, computes new chain_hash, inserts row.
   *   3. On success: log account.created at INFO with { accountId, correlationId }.
   *      Never log phone_stub_hash or email_stub_hash.
   *   4. On unique constraint violation (duplicate phone_stub_hash):
   *      log account.phone_stub_hash.duplicate at WARN with
   *      { phoneStubHashPrefix (first 8 chars only), correlationId };
   *      rethrow so caller knows the operation failed.
   *   5. On other error: rethrow without additional logging (insertWithChain already logs
   *      adapter.persisted or adapter.write.failed as appropriate).
   */
  async createAccount(params: CreateAccountParams): Promise<AccountRow> {
    const { accountId, phoneStubHash, emailStubHash, correlationId } = params;

    const record: Record<string, unknown> = {
      account_id: accountId,
      phone_stub_hash: phoneStubHash,
    };
    if (emailStubHash !== undefined && emailStubHash !== null) {
      record["email_stub_hash"] = emailStubHash;
    }

    const columns = emailStubHash !== undefined && emailStubHash !== null
      ? ["account_id", "phone_stub_hash", "email_stub_hash", "chain_hash"]
      : ["account_id", "phone_stub_hash", "chain_hash"];

    const values: unknown[] = emailStubHash !== undefined && emailStubHash !== null
      ? [accountId, phoneStubHash, emailStubHash, ""]
      : [accountId, phoneStubHash, ""];

    const chainHashIndex = columns.length - 1;

    try {
      await this.insertWithChain(
        "user_accounts",
        record,
        columns,
        values,
        chainHashIndex,
        undefined,
        correlationId,
      );
      this.#logger.info("account.created", { accountId, correlationId });

      // Read back the inserted row to return AccountRow
      const result = await this.#pool.query<Record<string, unknown>>(
        `SELECT id, account_id, phone_stub_hash, email_stub_hash, created_at, chain_hash
         FROM user_accounts WHERE account_id = $1`,
        [accountId],
      );
      const row = deserializeRow<{
        id: number;
        account_id: string;
        phone_stub_hash: string;
        email_stub_hash: string | null;
        created_at: string;
        chain_hash: string;
      }>("user_accounts", result.rows[0]!);
      return {
        id: row.id,
        account_id: row.account_id,
        phone_stub_hash: row.phone_stub_hash,
        email_stub_hash: row.email_stub_hash,
        created_at: row.created_at,
        chain_hash: row.chain_hash,
      };
    } catch (err) {
      if (this.#isUniqueViolation(err)) {
        this.#logger.warn("account.phone_stub_hash.duplicate", {
          phoneStubHashPrefix: phoneStubHash.slice(0, 8),
          correlationId,
        });
        throw err;
      }
      throw err;
    }
  }

  /**
   * ACCOUNT-001: Return all agent_profiles rows with account_id = accountId,
   * ordered by registered_at ASC.
   *
   * Pseudocode:
   *   SELECT * FROM agent_profiles WHERE account_id = $1 ORDER BY registered_at ASC
   *   Returns [] if no rows found. Does not throw on empty result.
   *
   * AC-004: NULL account_id rows are excluded — the WHERE clause requires account_id = $1,
   *   so rows with NULL account_id never appear.
   */
  async getAgentsByAccount(accountId: string): Promise<AgentProfile[]> {
    const result = await this.#pool.query<Record<string, unknown>>(
      `SELECT k_local_pubkey, primary_pubkey, ml_dsa_pubkey, phone_stub_hash,
              registered_at, status, account_id, agent_id
       FROM agent_profiles
       WHERE account_id = $1
       ORDER BY registered_at ASC`,
      [accountId],
    );

    return result.rows.map((row) => {
      const deserialized = deserializeRow<{
        k_local_pubkey: string;
        primary_pubkey: string;
        ml_dsa_pubkey: string;
        phone_stub_hash: string;
        registered_at: number;
        status: string;
        account_id: string;
        agent_id: string | null;
      }>("agent_profiles", row);
      return {
        k_local_pubkey: deserialized.k_local_pubkey,
        primary_pubkey: deserialized.primary_pubkey,
        ml_dsa_pubkey: deserialized.ml_dsa_pubkey,
        phone_stub_hash: deserialized.phone_stub_hash,
        registered_at: deserialized.registered_at,
        status: deserialized.status as "active",
        profile: {} as Record<string, unknown>,
        agent_id: deserialized.agent_id ?? createHash("sha256").update(deserialized.k_local_pubkey, "utf8").digest("hex").slice(0, 32),
      };
    });
  }

  getProfile(pubkeyHex: string): AgentProfile | undefined {
    return this.#profilesByLocalKey.get(pubkeyHex) ?? this.#profilesByPrimaryKey.get(pubkeyHex);
  }

  /**
   * Cross-node item 0 (FINDING-8). Read-through: cache hit → return; miss → point-read the replicated
   * agent_profiles row and populate the cache before returning. The in-memory maps are loaded ONLY at
   * boot (loadProfiles), so getProfile is blind to any agent registered after this node started — the
   * exact case the cross-node flow hits (a visiting initiator registered after the broker booted).
   * The row is present via replication (modulo lag); miss in DB ⇒ genuinely unknown (state 3).
   * Fixing it at the store layer fixes every getProfile consumer at once.
   */
  async getProfileWithReadThrough(pubkeyHex: string, correlationId?: string): Promise<AgentProfile | undefined> {
    const cached = this.getProfile(pubkeyHex);
    if (cached) {
      this.#logger.info("directory.profile.read_through", { pubkey: pubkeyHex.slice(0, 16), result: "cache_hit", correlationId });
      return cached;
    }
    const result = await this.#pool.query<{
      k_local_pubkey: string;
      primary_pubkey: string;
      ml_dsa_pubkey: string;
      phone_stub_hash: string;
      registered_at: number;
      status: string;
      agent_id: string | null;
    }>(
      `SELECT k_local_pubkey, primary_pubkey, ml_dsa_pubkey, phone_stub_hash, registered_at, status, agent_id
         FROM agent_profiles WHERE k_local_pubkey = $1 AND status = 'active'`,
      [pubkeyHex],
    );
    if (result.rows.length === 0) {
      this.#logger.info("directory.profile.read_through", { pubkey: pubkeyHex.slice(0, 16), result: "read_through_miss", correlationId });
      return undefined;
    }
    const row = result.rows[0];
    // Mirror loadProfiles() row-mapping EXACTLY, including the pre-V27 agent_id fallback.
    const agentId = row.agent_id ?? createHash("sha256").update(row.k_local_pubkey, "utf8").digest("hex").slice(0, 32);
    const profile: AgentProfile = {
      k_local_pubkey: row.k_local_pubkey,
      primary_pubkey: row.primary_pubkey,
      ml_dsa_pubkey: row.ml_dsa_pubkey,
      phone_stub_hash: row.phone_stub_hash,
      registered_at: Number(row.registered_at),
      status: row.status as "active",
      agent_id: agentId,
      profile: {},
    };
    // Populate all three maps so every subsequent consumer (localKey / primaryKey / agentId) is warm.
    this.#profilesByLocalKey.set(row.k_local_pubkey, profile);
    this.#profilesByPrimaryKey.set(row.primary_pubkey, profile);
    this.#profilesByAgentId.set(agentId, profile);
    this.#logger.info("directory.profile.read_through", { pubkey: pubkeyHex.slice(0, 16), result: "read_through_found", correlationId });
    return profile;
  }

  /**
   * Cross-node item 1: point-read the replicated agent_presence row + the owning node's heartbeat
   * freshness (READ-001) for a discovery lookup. Returns raw facts; resolveDiscoveryState derives the
   * 3-state answer. A missing row ⇒ hasRow:false (the agent has a profile but never came online here).
   */
  async getAgentPresenceForDiscovery(pubkeyHex: string, nodeFreshnessMs: number): Promise<AgentPresenceLookup> {
    return readPresenceForDiscovery(this.#pool, pubkeyHex, nodeFreshnessMs);
  }

  hasProfile(pubkeyHex: string): boolean {
    return this.#profilesByLocalKey.has(pubkeyHex) || this.#profilesByPrimaryKey.has(pubkeyHex);
  }

  /** Returns all profiles loaded into memory (used for post-startup signer registration). */
  getAllLoadedProfiles(): AgentProfile[] {
    return Array.from(this.#profilesByLocalKey.values());
  }

  /**
   * AC-007a (DX-001): Look up a profile by agent_id (32 hex chars).
   * Returns the profile if found in memory, undefined otherwise.
   * Used by the health server's GET /agent-lookup endpoint.
   */
  getProfileByAgentId(agentId: string): AgentProfile | undefined {
    return this.#profilesByAgentId.get(agentId);
  }

  hasPhoneStubHash(_phoneStubHashHex: string): boolean {
    return false; // backing store read in PERSIST-003+
  }

  // ─── Connection records (PERSIST-020) ────────────────────────────────────

  async recordAcceptedConnectionRequest(
    requestId: string,
    requesterPseudonym: string,
    targetPseudonym: string,
  ): Promise<void> {
    const record: Record<string, unknown> = {
      request_id: requestId,
      requester_pseudonym: requesterPseudonym,
      target_pseudonym: targetPseudonym,
      outcome: "ACCEPTED",
    };
    const columns = ["request_id", "requester_pseudonym", "target_pseudonym", "outcome", "chain_hash"];
    const values = [requestId, requesterPseudonym, targetPseudonym, "ACCEPTED"];
    const chainHashIndex = 4;
    await this.insertWithChain("connection_requests", record, columns, values, chainHashIndex);
  }

  /**
   * Persist a new connection record with hash chain enforcement.
   *
   * Pseudocode:
   *   1. SI-001: Validate connection_id against connection_requests table.
   *      If no matching pending request exists → throw (reject before any INSERT).
   *   2. Compute chain_hash via insertWithChain (acquires advisory lock, fetches prev hash).
   *   3. INSERT into connections with all fields including computed chain_hash.
   *   4. Log connection.persisted at INFO with { connectionId, participantA, participantB, correlationId }.
   *   5. On failure: log connection.persist.failed at ERROR with { connectionId, reason, attempt }.
   *      Retry once. If retry fails, log again with attempt: 2.
   *
   * SI-001: connection_id is validated against connection_requests before INSERT.
   * SI-002: chain_hash is computed server-side inside insertWithChain; never accepted from caller.
   */
  async createConnection(
    connectionId: string,
    participantA: string,
    participantB: string,
    establishedAt: number,
    correlationId: string,
  ): Promise<void> {
    // SI-001: validate correlationId against connection_requests with outcome = 'ACCEPTED'.
    // correlationId is the request_id from the originating connection_requests row — the
    // identifier CONNREQ-002 issued when the request was accepted. connectionId is a freshly-
    // minted connection identifier and will never match request_id in connection_requests.
    // Only accepted requests may produce a connection record — rejected/pending/expired must not.
    const reqCheck = await this.#pool.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM connection_requests WHERE request_id = $1 AND outcome = 'ACCEPTED'`,
      [correlationId],
    );
    if ((reqCheck.rows[0]?.count ?? "0") === "0") {
      throw new Error(
        `createConnection: connection_id '${connectionId}' has no matching accepted row in connection_requests (SI-001)`,
      );
    }

    const record: Record<string, unknown> = {
      connection_id: connectionId,
      participant_a: participantA,
      participant_b: participantB,
      established_at: establishedAt,
      status: "active",
    };
    const columns = [
      "connection_id",
      "participant_a",
      "participant_b",
      "established_at",
      "status",
      "chain_hash",
    ];
    const values: unknown[] = [connectionId, participantA, participantB, establishedAt, "active", ""];
    const chainHashIndex = 5;

    // Attempt 1
    let attempt = 1;
    try {
      await this.insertWithChain("connections", record, columns, values, chainHashIndex);
    } catch (err) {
      const reason1 = err instanceof Error ? err.message : String(err);
      this.#logger.error("connection.persist.failed", { connectionId, reason: reason1, attempt });
      // Retry once (attempt 2)
      attempt = 2;
      try {
        await this.insertWithChain("connections", record, columns, values, chainHashIndex);
      } catch (err2) {
        const reason2 = err2 instanceof Error ? err2.message : String(err2);
        this.#logger.error("connection.persist.failed", { connectionId, reason: reason2, attempt });
        throw err2;
      }
    }

    // Observability: connection.persisted at INFO (AC-007)
    this.#logger.info("connection.persisted", {
      connectionId,
      participantA,
      participantB,
      correlationId,
    });
  }

  /**
   * Check if an active connection exists between pubkeyA and pubkeyB.
   * Uses an OR query over both composite indexes — symmetric without application-layer normalization.
   *
   * Pseudocode:
   *   SELECT connection_id, participant_a, participant_b, established_at, status
   *   FROM connections
   *   WHERE (participant_a = $1 AND participant_b = $2)
   *      OR (participant_a = $2 AND participant_b = $1)
   *   LIMIT 1
   */
  async hasConnection(pubkeyA: string, pubkeyB: string): Promise<{ connection_id: string } | null> {
    const result = await this.#pool.query<{
      connection_id: string;
      participant_a: string;
      participant_b: string;
      established_at: string;
      status: string;
    }>(
      `SELECT connection_id, participant_a, participant_b, established_at, status
       FROM connections
       WHERE (participant_a = $1 AND participant_b = $2)
          OR (participant_a = $2 AND participant_b = $1)
       LIMIT 1`,
      [pubkeyA, pubkeyB],
    );
    if (result.rows.length === 0) return null;
    return { connection_id: result.rows[0]!.connection_id };
  }

  /**
   * Retrieve a connection record by connection_id hex.
   * Returns null if not found. Does not throw on missing record (AC-008).
   */
  async getConnection(connectionId: string): Promise<ConnectionRecord | null> {
    const result = await this.#pool.query<Record<string, unknown>>(
      `SELECT connection_id, participant_a, participant_b, established_at, status
       FROM connections WHERE connection_id = $1`,
      [connectionId],
    );
    if (result.rows.length === 0) return null;
    const row = deserializeRow<{
      connection_id: string;
      participant_a: string;
      participant_b: string;
      established_at: number;
      status: string;
    }>("connections", result.rows[0]!);
    return {
      connection_id: row.connection_id,
      participant_a: row.participant_a,
      participant_b: row.participant_b,
      established_at: row.established_at,
      status: row.status as "active",
    };
  }

  queuePendingConnectionRequest(targetPubkey: string, request: PendingConnectionRequest): boolean {
    this.#fire(this.#pool.query(
      `INSERT INTO pending_connection_requests (target_pubkey, payload)
       VALUES ($1, $2)`,
      [targetPubkey, jsonStringify(request)],
    ), "pending_connection_requests");
    return true;
  }

  /**
   * PERSIST-019: Dequeue all pending connection requests for a target pubkey.
   * Implements the DirectoryStore interface (now async for real Postgres support).
   *
   * Pseudocode:
   *   Only returns rows where created_at > now() - INTERVAL '24 hours' (AC-005).
   *   Deletes returned rows in a single atomic CTE (SI-001: prevents double delivery).
   *   Stale rows (older than 24h) are NOT deleted by this method — they are
   *   removed only by the TTL sweep (PendingConnectionRequestTtlSweep, AC-006).
   *
   *   WITH drained AS (
   *     DELETE FROM pending_connection_requests
   *     WHERE target_pubkey = $1
   *       AND created_at > now() - INTERVAL '24 hours'
   *     RETURNING id, payload
   *   )
   *   SELECT id, payload FROM drained ORDER BY id ASC
   *
   * Logs queue.pending_connection_requests.drained at INFO with
   * { targetPubkey, count, correlationId }.
   */
  async dequeuePendingConnectionRequests(
    targetPubkey: string,
    correlationId: string,
  ): Promise<PendingConnectionRequest[]> {
    const result = await this.#pool.query<{ id: string; payload: unknown }>(
      `WITH drained AS (
         DELETE FROM pending_connection_requests
         WHERE target_pubkey = $1
           AND created_at > now() - INTERVAL '24 hours'
         RETURNING id, payload
       )
       SELECT id, payload FROM drained ORDER BY id ASC`,
      [targetPubkey],
    );

    // pg auto-parses JSONB columns into JS objects, so row.payload is already parsed.
    // Re-stringify then jsonParse runs the Uint8Array reviver over the full object tree.
    const requests: PendingConnectionRequest[] = result.rows.map(
      (row) => jsonParse<PendingConnectionRequest>(JSON.stringify(row.payload)),
    );

    if (requests.length > 0) {
      // AC-009 (pending_connection_requests): only logged when count > 0 per AC-009 trigger condition
      this.#logger.info("queue.pending_connection_requests.drained", {
        targetPubkey,
        count: requests.length,
        correlationId,
      });
    }

    return requests;
  }

  // ─── PERSIST-004: Hash chain methods ─────────────────────────────────────

  /**
   * Insert a row into a hash-chained table, computing and including the chain_hash.
   * Uses pg_advisory_xact_lock to serialize concurrent inserts.
   *
   * WHY advisory locks instead of SELECT FOR UPDATE:
   * The cello_service role has only INSERT+SELECT privileges (RLS policy from PERSIST-003).
   * FOR UPDATE requires UPDATE privilege, which cello_service does not have.
   * pg_advisory_xact_lock provides table-level serialization using only SELECT privilege,
   * and is automatically released at COMMIT/ROLLBACK.
   *
   * PERSIST-021 AC-009: After each successful INSERT, logs adapter.persisted at INFO with
   * { tableName, rowCount: 1, durationMs, correlationId }.
   * correlationId is threaded from calling context; omitted if not present.
   *
   * SI-002: chain_hash is always computed internally — never accepted from external callers.
   * SI-003: Advisory lock prevents forked chains under concurrent writes.
   *
   * @param tableName - The target hash-chained table
   * @param record - Record fields (chain_hash field is ignored if present — always recomputed)
   * @param columns - Column names in insertion order (must include chain_hash)
   * @param values - Corresponding values (chain_hash slot will be overwritten)
   * @param chainHashIndex - Index of chain_hash in the columns/values arrays
   * @param externalClient - Optional: use an external PoolClient (caller owns transaction lifecycle)
   * @param correlationId - Optional: correlation ID for adapter.persisted observability event
   */
  async insertWithChain(
    tableName: HashChainedTable,
    record: Record<string, unknown>,
    columns: string[],
    values: unknown[],
    chainHashIndex: number,
    externalClient?: pg.PoolClient,
    correlationId?: string,
  ): Promise<string> {
    // Runtime guard: tableName flows into SQL via template literal — verify it is in
    // the known-safe set even though TypeScript constrains it at compile time.
    if (!(HASH_CHAINED_TABLES as readonly string[]).includes(tableName)) {
      throw new Error(`insertWithChain: unknown table '${tableName}'`);
    }

    // Runtime guard: every column key (except chain_hash) must be present in record.
    // This catches caller bugs where columns/values and record diverge — both are used
    // independently (record for serialization, columns/values for the INSERT) so they
    // must stay in sync.
    for (const col of columns) {
      if (col === "chain_hash") continue;
      if (!(col in record)) {
        throw new Error(
          `insertWithChain: column '${col}' is listed in columns but missing from record for table '${tableName}'`,
        );
      }
    }

    // PERSIST-021 AC-009: track start time for durationMs calculation
    const insertStartMs = Date.now();

    // When an external client is provided, the caller owns the transaction lifecycle
    // (BEGIN/COMMIT/ROLLBACK). We only execute the chain logic within their transaction.
    const ownsTransaction = !externalClient;
    const client = externalClient ?? await this.#pool.connect();
    try {
      if (ownsTransaction) await client.query("BEGIN");

      // AC-006/SI-003: Advisory lock serializes concurrent chain extensions.
      // hashtext(tableName) produces a stable int4 lock key per table.
      // The lock is held for the transaction duration — released at COMMIT/ROLLBACK.
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [tableName]);

      const lastRow = await client.query<{ chain_hash: string }>(
        `SELECT chain_hash FROM ${tableName} ORDER BY id DESC LIMIT 1`,
      );

      const previousHash = lastRow.rows[0]?.chain_hash ?? CHAIN_GENESIS;
      const serialized = serializeRecord(record, tableName);
      const chainHash = computeChainHash(serialized, previousHash);

      // Clone values to avoid mutating the caller's array
      const insertValues = [...values];
      insertValues[chainHashIndex] = chainHash;

      const placeholders = insertValues.map((_, i) => `$${i + 1}`).join(", ");
      await client.query(
        `INSERT INTO ${tableName} (${columns.join(", ")}) VALUES (${placeholders})`,
        insertValues,
      );

      if (ownsTransaction) await client.query("COMMIT");

      // PERSIST-021 AC-009: log adapter.persisted at INFO after successful INSERT.
      // durationMs is wall-clock time from start of insertWithChain to commit confirmation.
      // correlationId is omitted when not present — not minted at the adapter layer (per story spec).
      const durationMs = Date.now() - insertStartMs;
      const persistedCtx: Record<string, unknown> = { tableName, rowCount: 1, durationMs };
      if (correlationId !== undefined) {
        persistedCtx["correlationId"] = correlationId;
      }
      this.#logger.info("adapter.persisted", persistedCtx);

      return chainHash;
    } catch (err) {
      if (ownsTransaction) await client.query("ROLLBACK").catch(() => { /* ignore rollback errors */ });
      throw err;
    } finally {
      if (ownsTransaction) client.release();
    }
  }

  /**
   * Verify the hash chain for a given table.
   * Fetches all rows ordered by id, recomputes all chain_hashes from genesis,
   * reports any divergence.
   *
   * PERSIST-021: rows are deserialized via deserializeRow before being passed to
   * verifyChain, so declared BIGINT columns are consistently typed as numbers.
   * Undeclared columns are left as-is (string); the AC-005 static gate enforces
   * completeness of BIGINT_COLUMNS in CI before changes reach production.
   *
   * AC-003: clean chain → { valid: true }
   * AC-004: tampered row → break at that position
   * AC-005: deleted row → chain recomputation detects the gap
   */
  async verifyChain(tableName: HashChainedTable): Promise<ChainVerificationResult> {
    const result = await this.#pool.query<Record<string, unknown>>(
      `SELECT * FROM ${tableName} ORDER BY id ASC`,
    );
    // PERSIST-021: deserialize each row so BIGINT columns are numbers.
    // AC-005 static gate in CI catches any undeclared BIGINT column before it reaches production.
    const deserializedRows = result.rows.map((row) =>
      deserializeRow(tableName, row),
    );
    return verifyChain(deserializedRows, this.#logger, tableName);
  }

  // ─── DEPLOY-001 / FEDERATION-001: directory_nodes and sessions ──────────────

  /**
   * Insert a directory node record.
   * Used at startup to register this node in the federation.
   */
  async insertDirectoryNode(node: {
    nodeId: string;
    region: string;
    endpoint?: string;
    status?: string;
    correlationId?: string;
  }): Promise<{ id: number }> {
    const start = Date.now();
    const result = await this.#pool.query<{ id: string }>(
      `INSERT INTO directory_nodes (node_id, region, endpoint, status)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [node.nodeId, node.region, node.endpoint ?? null, node.status ?? "active"],
    );
    const id = parseInt(result.rows[0].id, 10);
    this.#logger.info("adapter.persisted", {
      tableName: "directory_nodes",
      rowCount: 1,
      durationMs: Date.now() - start,
      ...(node.correlationId !== undefined && { correlationId: node.correlationId }),
    });
    return { id };
  }

  /**
   * Get a directory node by node_id.
   */
  async getDirectoryNode(nodeId: string): Promise<{
    id: number;
    nodeId: string;
    region: string;
    endpoint: string | null;
    status: string;
  } | null> {
    const result = await this.#pool.query<Record<string, unknown>>(
      `SELECT * FROM directory_nodes WHERE node_id = $1`,
      [nodeId],
    );
    if (result.rows.length === 0) return null;
    const row = deserializeRow<Record<string, unknown>>("directory_nodes", result.rows[0]);
    return {
      id: row.id as number,
      nodeId: row.node_id as string,
      region: row.region as string,
      endpoint: row.endpoint as string | null,
      status: row.status as string,
    };
  }

  // ─── FEDERATION-001: Session ownership ───────────────────────────────────

  /**
   * Write a sessions row via the hash chain mechanism.
   *
   * SI-001: application-layer ownership pre-check. If the session_id already exists
   * in the DB and is owned by a different node, this method throws before attempting
   * any hash chain write. This prevents a non-owning node from hijacking a session
   * that belongs to another node (even though the unique constraint also prevents a
   * duplicate INSERT, the application-layer check produces a clear ownership-violation
   * error rather than a generic constraint error).
   *
   * @throws OwnershipViolationError if session_id already exists with a different owning_node_id
   * @throws on DB unique constraint violation if session_id already exists (SQLSTATE 23505)
   */
  async writeSession(sessionId: string, owningNodeId: string): Promise<void> {
    // SI-001: check existing ownership before any chain write
    const existing = await this.#pool.query<{ owning_node_id: string }>(
      `SELECT owning_node_id FROM sessions WHERE session_id = $1`,
      [sessionId],
    );
    if (existing.rows.length > 0 && existing.rows[0]!.owning_node_id !== this.#nodeId) {
      throw new Error(
        `writeSession: ownership violation — session '${sessionId}' is owned by '${existing.rows[0]!.owning_node_id}', not '${this.#nodeId}' (SI-001)`,
      );
    }
    const record: Record<string, unknown> = {
      session_id: sessionId,
      owning_node_id: owningNodeId,
    };
    const columns = ["session_id", "owning_node_id", "chain_hash"];
    const values: unknown[] = [sessionId, owningNodeId, ""];
    const chainHashIndex = 2;
    await this.insertWithChain("sessions", record, columns, values, chainHashIndex);
  }

  /**
   * Retrieve the owning_node_id for a session_id.
   *
   * Returns undefined if no sessions row exists for this session_id.
   * Does not throw on absence.
   */
  async getSessionOwner(sessionId: string): Promise<string | undefined> {
    const result = await this.#pool.query<{ owning_node_id: string }>(
      `SELECT owning_node_id FROM sessions WHERE session_id = $1`,
      [sessionId],
    );
    return result.rows[0]?.owning_node_id;
  }

  // ─── FEDERATION-002: Checkpoint cross-signing ────────────────────────────

  /**
   * Write a checkpoint_node_signatures row.
   *
   * FEDERATION-002: records a single node's Ed25519 signature for a confirmed checkpoint.
   *
   * SI-001: the (checkpoint_id, node_id) UNIQUE constraint in the DB enforces that the same
   * node cannot submit two signatures for the same checkpoint. A duplicate INSERT throws
   * a 23505 unique-violation error — the caller (CheckpointCoordinator) counts only distinct
   * node_ids toward the threshold.
   *
   * NOTE: checkpoint_node_signatures is NOT hash-chained (no chain_hash column).
   * signed_at is excluded from ALWAYS_EXCLUDED_FROM_CHAIN (already present in hash-chain.ts).
   *
   * @param params.checkpointId - The UUID of the checkpoint being signed.
   * @param params.nodeId - The signing node's node_id.
   * @param params.nodeSignature - Hex-encoded Ed25519 signature over the checkpoint TBS.
   */
  async writeCheckpointSignature(params: {
    checkpointId: string;
    nodeId: string;
    nodeSignature: string;
  }): Promise<void> {
    const start = Date.now();
    await this.#pool.query(
      `INSERT INTO checkpoint_node_signatures (checkpoint_id, node_id, node_signature)
       VALUES ($1, $2, $3)`,
      [params.checkpointId, params.nodeId, params.nodeSignature],
    );
    this.#logger.info("adapter.persisted", {
      tableName: "checkpoint_node_signatures",
      rowCount: 1,
      durationMs: Date.now() - start,
    });
  }

  /**
   * Get all checkpoint_node_signatures rows for a given checkpoint_id.
   *
   * FEDERATION-002 AC-009-store-tables: round-trip read for writeCheckpointSignature.
   * BIGSERIAL id is deserialized to number via deserializeRow.
   *
   * @param checkpointId - The UUID of the checkpoint.
   * @returns Array of signature rows, each with id (number), checkpointId, nodeId, nodeSignature.
   */
  async getCheckpointSignatures(checkpointId: string): Promise<Array<{
    id: number;
    checkpointId: string;
    nodeId: string;
    nodeSignature: string;
  }>> {
    const result = await this.#pool.query<Record<string, unknown>>(
      `SELECT id, checkpoint_id, node_id, node_signature
       FROM checkpoint_node_signatures
       WHERE checkpoint_id = $1
       ORDER BY id ASC`,
      [checkpointId],
    );
    return result.rows.map((row) => {
      const deserialized = deserializeRow<{
        id: number;
        checkpoint_id: string;
        node_id: string;
        node_signature: string;
      }>("checkpoint_node_signatures", row);
      return {
        id: deserialized.id,
        checkpointId: deserialized.checkpoint_id,
        nodeId: deserialized.node_id,
        nodeSignature: deserialized.node_signature,
      };
    });
  }

  /**
   * Write a directory_checkpoints row for a confirmed checkpoint.
   *
   * FEDERATION-002: called by CheckpointCoordinator after collecting >= requiredThreshold
   * signatures. The checkpoint row is append-only and hash-chained via insertWithChain.
   *
   * @param params.checkpointId - UUID for this checkpoint.
   * @param params.mmrPeaks - Hex-encoded MMR peak hashes ordered by position ascending.
   * @param params.identityMerkleRoot - Hex-encoded identity Merkle root.
   * @param params.checkpointHash - SHA-256(canonical TBS) — computed by computeCheckpointHash.
   * @param params.mmrLeafCount - Total MMR leaf count at this checkpoint.
   * @param params.coordinatorNodeId - The node_id of the coordinator for this round.
   */
  async writeCheckpoint(params: {
    checkpointId: string;
    mmrPeaks: string[];
    identityMerkleRoot: string;
    checkpointHash: string;
    mmrLeafCount: number;
    coordinatorNodeId: string;
  }): Promise<void> {
    // directory_checkpoints is NOT in HASH_CHAINED_TABLES (insertWithChain is for
    // hash-chained tables only). Use the same manual chain hash pattern as MmrStore.confirmCheckpoint.
    const start = Date.now();
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext('directory_checkpoints'))");

      const record: Record<string, unknown> = {
        checkpoint_id: params.checkpointId,
        mmr_leaf_count: params.mmrLeafCount,
        peak_hash: params.checkpointHash,   // reuse peak_hash column (V5 compat)
        staged_seal_count: 0,
        // Use the native array here (not JSON.stringify) so the chain hash matches
        // what the pg driver returns on read-back (JSONB columns come back as parsed JS arrays).
        // The INSERT uses $5::jsonb with JSON.stringify separately — these are distinct concerns.
        mmr_peaks: params.mmrPeaks,
        identity_merkle_root: params.identityMerkleRoot,
        checkpoint_hash: params.checkpointHash,
        coordinator_node_id: params.coordinatorNodeId,
      };

      const prevRow = await client.query<{ chain_hash: string }>(
        "SELECT chain_hash FROM directory_checkpoints ORDER BY id DESC LIMIT 1",
      );
      const previousHash = prevRow.rows[0]?.chain_hash ?? CHAIN_GENESIS;
      const serialized = serializeRecord(record, "directory_checkpoints");
      const chainHash = computeChainHash(serialized, previousHash);

      // ON CONFLICT DO NOTHING: checkpoint_id is a fresh UUID minted per round — conflicts
      // cannot occur in normal operation. The clause exists as a crash-recovery guard only:
      // if the coordinator retries after a crash before clearing staging, the second INSERT
      // is a no-op and the caller proceeds to clear staging using the already-confirmed row.
      // checkpointId is always caller-generated via randomUUID() — reuse across rounds never happens.
      const result = await client.query(
        `INSERT INTO directory_checkpoints
           (checkpoint_id, mmr_leaf_count, peak_hash, staged_seal_count,
            mmr_peaks, identity_merkle_root, checkpoint_hash, coordinator_node_id,
            chain_hash)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9)
         ON CONFLICT (checkpoint_id) DO NOTHING`,
        [
          params.checkpointId,
          params.mmrLeafCount,
          params.checkpointHash,
          0,
          JSON.stringify(params.mmrPeaks),
          params.identityMerkleRoot,
          params.checkpointHash,
          params.coordinatorNodeId,
          chainHash,
        ],
      );

      // If rowCount is 0, checkpoint already exists (crash-recovery path).
      // Log at WARN so reuse is observable; do not throw — caller clears staging normally.
      if (result.rowCount === 0) {
        this.#logger.warn("adapter.checkpoint.already_exists", {
          tableName: "directory_checkpoints",
          checkpointId: params.checkpointId,
        });
      }

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => { /* ignore rollback errors */ });
      throw err;
    } finally {
      client.release();
    }

    this.#logger.info("adapter.persisted", {
      tableName: "directory_checkpoints",
      rowCount: 1,
      durationMs: Date.now() - start,
    });
  }

  /**
   * Retrieve a directory_checkpoints row by checkpoint_id.
   *
   * FEDERATION-002: used to verify that a checkpoint was committed.
   * Returns undefined if no row exists.
   */
  async getCheckpointById(checkpointId: string): Promise<{
    checkpointId: string;
    mmrLeafCount: number;
    checkpointHash: string;
    coordinatorNodeId: string;
    mmrPeaks: string[];
    identityMerkleRoot: string;
  } | undefined> {
    const result = await this.#pool.query<Record<string, unknown>>(
      `SELECT checkpoint_id, mmr_leaf_count, checkpoint_hash, coordinator_node_id,
              mmr_peaks, identity_merkle_root
       FROM directory_checkpoints
       WHERE checkpoint_id = $1`,
      [checkpointId],
    );
    if (result.rows.length === 0) return undefined;
    const row = deserializeRow<{
      checkpoint_id: string;
      mmr_leaf_count: number;
      checkpoint_hash: string;
      coordinator_node_id: string;
      mmr_peaks: unknown;
      identity_merkle_root: string;
    }>("directory_checkpoints", result.rows[0]!);
    // mmr_peaks is stored as JSONB — pg driver returns it as a JS value already parsed
    const mmrPeaks = Array.isArray(row.mmr_peaks)
      ? (row.mmr_peaks as string[])
      : (JSON.parse(row.mmr_peaks as string) as string[]);
    return {
      checkpointId: row.checkpoint_id,
      mmrLeafCount: row.mmr_leaf_count,
      checkpointHash: row.checkpoint_hash,
      coordinatorNodeId: row.coordinator_node_id,
      mmrPeaks,
      identityMerkleRoot: row.identity_merkle_root,
    };
  }

  /**
   * Get the created_at timestamp of the most recent confirmed checkpoint.
   *
   * FEDERATION-002 AC-009 gap alarm: used by CheckpointCoordinator to detect
   * if the last checkpoint is older than CHECKPOINT_GAP_ALARM_MINUTES.
   *
   * Returns null if no checkpoint rows exist.
   */
  async getLastCheckpointAt(): Promise<string | null> {
    const result = await this.#pool.query<{ created_at: unknown }>(
      `SELECT created_at FROM directory_checkpoints ORDER BY id DESC LIMIT 1`,
    );
    if (result.rows.length === 0) return null;
    const value = result.rows[0]!.created_at;
    // configurePgTypes() overrides TIMESTAMPTZ to return raw strings; however
    // new Date().toISOString() normalises both formats to ISO-8601.
    return new Date(value as string | Date).toISOString();
  }

  /**
   * Get the checkpoint_id of the most recent confirmed checkpoint.
   *
   * FEDERATION-002 AC-009 gap alarm: used by CheckpointCoordinator to include
   * lastCheckpointId in the federation.checkpoint.gap alarm event.
   *
   * Returns null if no checkpoint rows exist.
   */
  async getLastCheckpointRow(): Promise<{ checkpointId: string } | null> {
    const result = await this.#pool.query<{ checkpoint_id: string }>(
      `SELECT checkpoint_id FROM directory_checkpoints ORDER BY id DESC LIMIT 1`,
    );
    if (result.rows.length === 0) return null;
    return { checkpointId: result.rows[0]!.checkpoint_id };
  }

  /**
   * Get staging rows eligible for the next checkpoint batch.
   *
   * FEDERATION-002 AC-008-crash-mid-clear: excludes staging rows whose session_id
   * already appears in conversation_proof_leaf_checkpoints (already committed to a
   * previous checkpoint). This prevents double-counting seals on coordinator restart
   * after a crash mid-clear.
   *
   * Returns rows without a checkpoint_id (not yet assigned to a checkpoint round)
   * AND whose session has not been committed to conversation_proof_leaf_checkpoints.
   *
   * NOTE: staging rows that were re-inserted after a crash (with checkpoint_id already
   * set, but referencing a prior checkpoint) are also excluded via the join check.
   */
  async getStagingRowsForBatch(): Promise<Array<{
    stagingId: string;
    sessionId: string;
    recordedAt: string;
  }>> {
    const result = await this.#pool.query<{
      id: string;
      session_id: string;
      recorded_at: unknown;
    }>(
      `SELECT s.id, s.session_id::text, s.recorded_at
       FROM conversation_seal_staging s
       WHERE s.checkpoint_id IS NULL
         AND NOT EXISTS (
           SELECT 1
           FROM conversation_proof_leaves l
           JOIN conversation_proof_leaf_checkpoints lc ON lc.leaf_id = l.id
           WHERE l.session_id = s.session_id
         )
       ORDER BY s.recorded_at ASC, s.session_id ASC`,
    );
    return result.rows.map((row) => ({
      stagingId: String(row.id),
      sessionId: row.session_id,
      recordedAt: new Date(row.recorded_at as string | Date).toISOString(),
    }));
  }

  /**
   * Get the current MMR state for checkpoint hash computation.
   *
   * FEDERATION-002: returns mmrPeaks (ordered peak hashes), identityMerkleRoot,
   * and mmrLeafCount from the current confirmed state. The coordinator calls this
   * to compute the checkpoint hash before broadcasting the proposal.
   *
   * mmrPeaks: from the most recent directory_checkpoints row, or [] if none.
   * identityMerkleRoot: from the most recent directory_checkpoints row, or "00"*32 if none.
   * mmrLeafCount: from conversation_proof_leaves row count.
   */
  async getCheckpointMmrState(): Promise<{
    mmrPeaks: string[];
    identityMerkleRoot: string;
    mmrLeafCount: number;
  }> {
    const [checkpointResult, leafCountResult] = await Promise.all([
      this.#pool.query<{ mmr_peaks: unknown; identity_merkle_root: string }>(
        `SELECT mmr_peaks, identity_merkle_root
         FROM directory_checkpoints
         ORDER BY id DESC LIMIT 1`,
      ),
      this.#pool.query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM conversation_proof_leaves`,
      ),
    ]);

    const mmrLeafCount = parseInt(leafCountResult.rows[0]!.count, 10);

    if (checkpointResult.rows.length === 0) {
      return { mmrPeaks: [], identityMerkleRoot: "00".repeat(32), mmrLeafCount };
    }

    const row = checkpointResult.rows[0]!;
    const mmrPeaks = Array.isArray(row.mmr_peaks)
      ? (row.mmr_peaks as string[])
      : (JSON.parse(row.mmr_peaks as string) as string[]);

    return {
      mmrPeaks,
      identityMerkleRoot: row.identity_merkle_root,
      mmrLeafCount,
    };
  }

  /**
   * Clear staging rows by stagingId after a successful checkpoint.
   *
   * FEDERATION-002 AC-003: only rows in the current batch (identified by stagingId) are
   * cleared. Rows inserted DURING the checkpoint round (after initiateCheckpoint was
   * called) survive — their stagingId is not in the batch's stagingIds array.
   *
   * Uses DELETE ... WHERE id = ANY($1) for atomic batch deletion.
   *
   * @param stagingIds - Array of staging row IDs to delete (from getStagingRowsForBatch).
   */
  async clearStagingBatch(stagingIds: string[]): Promise<void> {
    if (stagingIds.length === 0) return;
    await this.#pool.query(
      `DELETE FROM conversation_seal_staging WHERE id = ANY($1::bigint[])`,
      [stagingIds],
    );
  }

  /**
   * Verify a single replicated row's chain hash.
   *
   * FEDERATION-001 AC-005/AC-006:
   *
   * Pseudocode:
   *   1. Record start time for durationMs.
   *   2. Fetch the previous chain hash from the table (row with the highest id < this row's id).
   *      If none exists, previousHash = CHAIN_GENESIS.
   *   3. Deserialize the row (BIGINT columns to numbers via deserializeRow).
   *   4. Compute expectedHash = SHA-256(serialize(deserializedRow) || previousHash).
   *   5. Compare expectedHash to row["chain_hash"].
   *   6. On match: log federation.replication.verified at INFO with
   *      { nodeId, sessionId, leafIndex, chainHash, durationMs }.
   *      sessionId: row["session_id"] cast to string (UUID text).
   *      leafIndex: row["id"] cast to number (the row's BIGSERIAL pk — used as leaf index).
   *   7. On mismatch: log federation.replication.chain_hash_mismatch at ERROR with
   *      { nodeId, sessionId, leafIndex, expectedHash, receivedHash }.
   *
   * @param tableName - The hash-chained table the row belongs to
   * @param row - The row as returned by the pg driver
   */
  async verifyReplicatedRow(tableName: string, row: Record<string, unknown>): Promise<void> {
    // Runtime guard: tableName flows into SQL via template literal — verify it is in
    // the known-safe set. HASH_CHAINED_TABLES is the definitive safe list.
    if (!(HASH_CHAINED_TABLES as readonly string[]).includes(tableName)) {
      throw new Error(`verifyReplicatedRow: unknown table '${tableName}'`);
    }
    const startMs = Date.now();
    const deserialized = deserializeRow(tableName, row);
    // Explicit coercion: deserializeRow applies parseInt only for tables declared in BIGINT_COLUMNS.
    // For robustness, ensure leafIndex is always a number regardless of pg driver output type.
    const rawId = deserialized["id"];
    const leafIndex = typeof rawId === "string" ? parseInt(rawId, 10) : (rawId as number);
    // session_id is a UUID string for tables that have it; use rowId label for tables without it.
    const sessionId = (deserialized["session_id"] as string | undefined) ?? `${tableName}:${leafIndex}`;
    const receivedHash = deserialized["chain_hash"] as string;

    // Fetch the previous row's chain_hash — the row with id = this row's id - 1 (or genesis).
    const prevResult = await this.#pool.query<{ chain_hash: string }>(
      `SELECT chain_hash FROM ${tableName} WHERE id < $1 ORDER BY id DESC LIMIT 1`,
      [leafIndex],
    );
    const previousHash = prevResult.rows[0]?.chain_hash ?? CHAIN_GENESIS;

    // Compute expected hash from the row's serializable content and the previous hash.
    const serialized = serializeRecord(deserialized, tableName);
    const expectedHash = computeChainHash(serialized, previousHash);
    const durationMs = Date.now() - startMs;

    if (expectedHash === receivedHash) {
      this.#logger.info("federation.replication.verified", {
        nodeId: this.#nodeId,
        sessionId,
        leafIndex,
        chainHash: receivedHash,
        durationMs,
      });
    } else {
      this.#logger.error("federation.replication.chain_hash_mismatch", {
        nodeId: this.#nodeId,
        sessionId,
        leafIndex,
        expectedHash,
        receivedHash,
      });
      // Throw so callers can halt replication for this session's rows pending operator investigation.
      throw new Error(
        `federation.replication.chain_hash_mismatch: table='${tableName}' leafIndex=${leafIndex} expected=${expectedHash} received=${receivedHash}`,
      );
    }
  }

  // ─── FEDERATION-003: Relay registration ──────────────────────────────────

  /**
   * Register a relay node's Ed25519 public key.
   *
   * Pseudocode (SPARC Phase P):
   *   1. SELECT public_key_hex FROM relay_registrations WHERE relay_id = $1.
   *   2. If row found AND public_key_hex matches: log relay.already.registered at INFO; return.
   *   3. If row found AND public_key_hex DIFFERS: log relay.registration.conflict at ERROR;
   *      throw Error("RELAY_IDENTITY_CONFLICT") — SI-001: key is never overwritten.
   *   4. If no row: call insertWithChain("relay_registrations", record, columns, values, chainHashIndex).
   *   5. On success: log relay.registered at INFO with { relayId, region }.
   *
   * SI-001: relay_registrations is append-only. An existing registration is never overwritten.
   *   Re-registration with same key → no-op (idempotent). Different key → RELAY_IDENTITY_CONFLICT.
   *
   * @throws Error with message containing "RELAY_IDENTITY_CONFLICT" if relayId exists with different key
   */
  async registerRelay(params: { relayId: string; publicKeyHex: string; region: string }): Promise<{ alreadyRegistered?: boolean }> {
    const { relayId, publicKeyHex, region } = params;

    // Check for existing registration
    const existing = await this.#pool.query<{ public_key_hex: string }>(
      `SELECT public_key_hex FROM relay_registrations WHERE relay_id = $1`,
      [relayId],
    );

    if (existing.rows.length > 0) {
      const existingKey = existing.rows[0]!.public_key_hex;
      if (existingKey === publicKeyHex) {
        // Idempotent re-registration — same key, same relay restarting.
        // Return alreadyRegistered: true so the handler layer can log relay.already.registered
        // and send relay_register_ok with already_registered: true to the relay.
        // Observability is the handler's responsibility (M4+ convention).
        return { alreadyRegistered: true };
      }
      // SI-001: different key for same relay_id — identity conflict, reject.
      // relay.registration.conflict is logged by the handler layer (M4+ convention).
      throw new Error(`RELAY_IDENTITY_CONFLICT: relay_id '${relayId}' already registered with a different public key`);
    }

    // New registration — insert via hash chain
    const record: Record<string, unknown> = {
      relay_id: relayId,
      public_key_hex: publicKeyHex,
      region,
    };
    const columns = ["relay_id", "public_key_hex", "region", "chain_hash"];
    const values: unknown[] = [relayId, publicKeyHex, region, ""];
    const chainHashIndex = 3;

    await this.insertWithChain("relay_registrations", record, columns, values, chainHashIndex);
    // Observability is the handler's responsibility — do not log relay.registered here.
    return {};
  }

  /**
   * Retrieve the registered public key hex for a relay by relayId.
   *
   * FEDERATION-003 AC-004: returns the public_key_hex for ACK signature verification.
   * Returns undefined if relayId is not registered.
   * Does not throw on absence.
   */
  async getRelayPublicKey(relayId: string): Promise<string | undefined> {
    const result = await this.#pool.query<{ public_key_hex: string }>(
      `SELECT public_key_hex FROM relay_registrations WHERE relay_id = $1`,
      [relayId],
    );
    return result.rows[0]?.public_key_hex;
  }

  // ─── M6B-010: Startup state restoration ──────────────────────────────────

  /**
   * Save a "Case B" active connection request to persistent storage.
   *
   * M6B-010 AC-001: called when a connection request is delivered to the target's
   * signaling stream (the frame is sent live, not queued to pending_connection_requests).
   * After delivery, the request moves from pending_connection_requests→DB into
   * #pendingConnectionRequests in memory. Writing to active_connection_requests here
   * ensures the request survives a directory restart.
   *
   * Pseudocode:
   *   INSERT INTO active_connection_requests
   *     (connection_request_id, sender_pubkey_hex, target_pubkey_hex,
   *      package_cbor, disclosure_round, expires_at)
   *   VALUES ($1, $2, $3, $4, $5, $6)
   *   ON CONFLICT (connection_request_id) DO NOTHING
   *
   * ON CONFLICT DO NOTHING: the request may be re-delivered on reconnect (after restart);
   * the second write is a no-op. The original expiry is preserved.
   *
   * @param params.connectionRequestId - Directory-assigned connection request ID
   * @param params.senderPubkeyHex - K_local hex of the sender
   * @param params.targetPubkeyHex - K_local hex of the target
   * @param params.packageCbor - The CBOR-encoded connection request package
   * @param params.disclosureRound - 1 for initial request, 2 for Round 2 disclosure
   * @param params.expiresAt - When this request expires (24h TTL matching pending_connection_requests)
   */
  async saveActiveConnectionRequest(params: {
    connectionRequestId: string;
    senderPubkeyHex: string;
    targetPubkeyHex: string;
    packageCbor: Uint8Array;
    disclosureRound: number;
    expiresAt: Date;
  }): Promise<void> {
    await this.#pool.query(
      `INSERT INTO active_connection_requests
         (connection_request_id, sender_pubkey_hex, target_pubkey_hex,
          package_cbor, disclosure_round, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (connection_request_id) DO NOTHING`,
      [
        params.connectionRequestId,
        params.senderPubkeyHex,
        params.targetPubkeyHex,
        Buffer.from(params.packageCbor),
        params.disclosureRound,
        params.expiresAt,
      ],
    );
  }

  /**
   * Delete an active connection request by ID.
   *
   * M6B-010 AC-001: called when a connection request is accepted, rejected, or
   * when the directory receives a cello_accept_connection or cello_reject_connection
   * frame. Removes the request from active_connection_requests so it is not
   * reloaded on the next startup.
   *
   * Also called when the request expires (cleanup path, optional — expired rows
   * are not loaded by loadActiveConnectionRequests anyway due to expires_at filter).
   */
  async deleteActiveConnectionRequest(connectionRequestId: string): Promise<void> {
    await this.#pool.query(
      `DELETE FROM active_connection_requests WHERE connection_request_id = $1`,
      [connectionRequestId],
    );
  }

  /**
   * Load all active connection requests that have not yet expired.
   *
   * M6B-010 AC-001 / SI-001: called at startup to populate #pendingConnectionRequests
   * in the new directory process instance.
   *
   * SI-001: the WHERE clause filters to expires_at > NOW() — expired requests are never
   * returned, even if they exist in the table. This prevents honoring stale requests
   * after a long restart delay.
   *
   * Pseudocode:
   *   SELECT connection_request_id, sender_pubkey_hex, target_pubkey_hex,
   *          package_cbor, disclosure_round, expires_at
   *   FROM active_connection_requests
   *   WHERE expires_at > NOW()
   *   ORDER BY created_at ASC
   */
  async loadActiveConnectionRequests(): Promise<Array<{
    connectionRequestId: string;
    senderPubkeyHex: string;
    targetPubkeyHex: string;
    packageCbor: Uint8Array;
    disclosureRound: number;
    expiresAt: Date;
  }>> {
    const result = await this.#pool.query<{
      connection_request_id: string;
      sender_pubkey_hex: string;
      target_pubkey_hex: string;
      package_cbor: Buffer;
      disclosure_round: number;
      expires_at: string | Date;
    }>(
      `SELECT connection_request_id, sender_pubkey_hex, target_pubkey_hex,
              package_cbor, disclosure_round, expires_at
       FROM active_connection_requests
       WHERE expires_at > NOW()
       ORDER BY created_at ASC`,
    );

    return result.rows.map((row) => ({
      connectionRequestId: row.connection_request_id,
      senderPubkeyHex: row.sender_pubkey_hex,
      targetPubkeyHex: row.target_pubkey_hex,
      packageCbor: new Uint8Array(row.package_cbor),
      disclosureRound: typeof row.disclosure_round === "string"
        ? parseInt(row.disclosure_round, 10)
        : row.disclosure_round,
      expiresAt: row.expires_at instanceof Date ? row.expires_at : new Date(row.expires_at),
    }));
  }

  /**
   * Write a session with participant pubkeys to the sessions table.
   *
   * M6B-010 AC-002/AC-003: extends writeSession() to also store initiator and target
   * pubkeys. These are used at startup to reconstruct #sessionParticipants and
   * #sessionLastActivity for active (unsealed) sessions.
   *
   * Participants default to '' in V18/V28 rows (no participant data for pre-M6B-010
   * sessions). This method always writes real pubkey values.
   *
   * @param sessionId - UUID of the session (from the FROST-signed SessionAssignment)
   * @param owningNodeId - node_id of this directory node (for federation ownership)
   * @param initiatorPubkeyHex - K_local pubkey hex of the session initiator (agent A)
   * @param targetPubkeyHex - K_local pubkey hex of the session target (agent B)
   */
  async writeSessionWithParticipants(
    sessionId: string,
    owningNodeId: string,
    initiatorPubkeyHex: string,
    targetPubkeyHex: string,
  ): Promise<void> {
    // SI-001: check existing ownership before any chain write (same as writeSession)
    const existing = await this.#pool.query<{ owning_node_id: string }>(
      `SELECT owning_node_id FROM sessions WHERE session_id = $1`,
      [sessionId],
    );
    if (existing.rows.length > 0 && existing.rows[0]!.owning_node_id !== owningNodeId) {
      throw new Error(
        `writeSessionWithParticipants: ownership violation — session '${sessionId}' is owned by '${existing.rows[0]!.owning_node_id}', not '${owningNodeId}' (SI-001)`,
      );
    }
    // Update participant columns if the session already exists (e.g. from writeSession)
    if (existing.rows.length > 0) {
      await this.#pool.query(
        `UPDATE sessions SET initiator_pubkey_hex = $1, target_pubkey_hex = $2
         WHERE session_id = $3 AND owning_node_id = $4`,
        [initiatorPubkeyHex, targetPubkeyHex, sessionId, owningNodeId],
      );
      return;
    }
    const record: Record<string, unknown> = {
      session_id: sessionId,
      owning_node_id: owningNodeId,
      initiator_pubkey_hex: initiatorPubkeyHex,
      target_pubkey_hex: targetPubkeyHex,
    };
    const columns = [
      "session_id", "owning_node_id", "initiator_pubkey_hex", "target_pubkey_hex", "chain_hash",
    ];
    const values: unknown[] = [sessionId, owningNodeId, initiatorPubkeyHex, targetPubkeyHex, ""];
    const chainHashIndex = 4;
    await this.insertWithChain("sessions", record, columns, values, chainHashIndex);
  }

  /**
   * Load active session participants from the sessions table.
   *
   * M6B-010 AC-002/AC-003: called at startup to reconstruct #sessionParticipants
   * and #sessionLastActivity. Returns only sessions that:
   *   1. Have non-empty initiator_pubkey_hex and target_pubkey_hex (set by writeSessionWithParticipants)
   *   2. Are NOT yet sealed (no matching row in seal_notarizations)
   *
   * The genesisTimestampMs is derived from sessions.created_at, which is the Postgres
   * TIMESTAMPTZ column set to NOW() at insert time. This is the session genesis timestamp
   * and is used to initialize #sessionLastActivity to a sensible value rather than 0.
   *
   * Pseudocode:
   *   SELECT s.session_id, s.initiator_pubkey_hex, s.target_pubkey_hex,
   *          EXTRACT(EPOCH FROM s.created_at) * 1000 AS genesis_ms
   *   FROM sessions s
   *   WHERE s.initiator_pubkey_hex <> ''
   *     AND s.target_pubkey_hex <> ''
   *     AND NOT EXISTS (
   *       SELECT 1 FROM seal_notarizations sn
   *       WHERE sn.session_id = s.session_id::bytea
   *     )
   */
  async loadActiveSessionParticipants(): Promise<Array<{
    sessionId: string;
    initiatorHex: string;
    targetHex: string;
    genesisTimestampMs: number;
  }>> {
    const result = await this.#pool.query<{
      session_id: string;
      initiator_pubkey_hex: string;
      target_pubkey_hex: string;
      genesis_ms: string;
    }>(
      // DATE_PART avoids EXTRACT(EPOCH FROM ...) which confuses the schema-completeness
      // static analyzer (regex /FROM\s+(\w+)/ matches 'FROM s.created_at' → 's').
      // DATE_PART('epoch', col) is functionally identical to EXTRACT(EPOCH FROM col).
      `SELECT session_id::text AS session_id,
              initiator_pubkey_hex,
              target_pubkey_hex,
              DATE_PART('epoch', created_at) * 1000 AS genesis_ms
       FROM sessions
       WHERE initiator_pubkey_hex <> ''
         AND target_pubkey_hex <> ''
         AND NOT EXISTS (
           SELECT 1 FROM seal_notarizations
           WHERE session_id = decode(replace(sessions.session_id::text, '-', ''), 'hex')
         )`,
    );

    return result.rows.map((row) => ({
      // CRIT-001: strip dashes so sessionId matches the 32-char hex format used as the
      // key in #sessionLastActivity and #sessionParticipants in directory-node.ts.
      // Postgres returns session_id as a dashed UUID string (e.g. "550e8400-..."), but all
      // runtime lookups use Buffer.from(session_id).toString("hex") which produces dashless hex.
      sessionId: row.session_id.replace(/-/g, ""),
      initiatorHex: row.initiator_pubkey_hex,
      targetHex: row.target_pubkey_hex,
      genesisTimestampMs: Math.round(parseFloat(row.genesis_ms)),
    }));
  }
}
