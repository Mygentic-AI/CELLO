/**
 * PgDirectoryStore — Postgres-backed DirectoryStore for CELLO_ENV=local (Docker Compose)
 * and production environments (RDS).
 *
 * Used only by the composition root (bin/directory.ts). Never imported from application code.
 * PERSIST-001 SI-002: not exported from packages/directory index.ts.
 *
 * PERSIST-021: BIGINT_COLUMNS and STORE_TABLES are exported for use by the static analysis
 * gate tests (AC-005 and AC-006) and by the deserialization path (SI-001).
 */

import pg from "pg";
import { configurePgTypes } from "../pg-type-config.js";
import type {
  DirectoryStore,
  DirectoryNotification,
  SealNotarization,
  Logger,
} from "@cello/interfaces";
import type { AgentProfile, ConnectionRecord, PendingConnectionRequest } from "@cello/protocol-types";
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
  seal_notarizations: ["id", "close_timestamp"],
  connection_requests: ["id"],
  connections: ["id", "established_at"],
  notification_queue: ["id"],
  pending_connection_requests: ["id"],
  // MMR tables with additional BIGINT columns
  conversation_proof_leaves: ["id", "leaf_index", "mmr_position"],
  conversation_proof_mmr_nodes: ["id", "mmr_position"],
  directory_checkpoints: ["id", "mmr_leaf_count"],
  // DEPLOY-001 / FEDERATION-001: directory_nodes and sessions tables (V17 migration)
  directory_nodes: ["id"],
  sessions: ["id"],
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
  "sessions",
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
  // In-memory profile cache — two indexes for the two lookup patterns:
  //   #profilesByLocalKey:   k_local_pubkey (own_pubkey) → profile
  //   #profilesByPrimaryKey: primary_pubkey (FROST group key) → profile
  // The connection pre-check (directory-node.ts line 1152) looks up by whatever
  // target_pubkey the initiating agent supplies. Agents supply the target's k_local_pubkey
  // (own_pubkey), but having both indexes means either key works robustly.
  readonly #profilesByLocalKey = new Map<string, AgentProfile>();
  readonly #profilesByPrimaryKey = new Map<string, AgentProfile>();

  constructor(pool: pg.Pool, logger: Logger) {
    configurePgTypes();
    this.#pool = pool;
    this.#logger = logger;
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

    const record: Record<string, unknown> = {
      session_id: sessionIdBuf,
      sealed_root: sealedRootBuf,
      participant_a_pubkey: participantABuf,
      participant_b_pubkey: participantBBuf,
      close_timestamp: notarization.close_timestamp,
      frost_signature: frostSigBuf,
    };

    const columns = [
      "session_id",
      "sealed_root",
      "participant_a_pubkey",
      "participant_b_pubkey",
      "close_timestamp",
      "frost_signature",
      "chain_hash",
    ];
    const values: unknown[] = [
      sessionIdBuf,
      sealedRootBuf,
      participantABuf,
      participantBBuf,
      notarization.close_timestamp,
      frostSigBuf,
      "", // placeholder — overwritten by insertWithChain
    ];
    const chainHashIndex = 6;

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

  /**
   * Retrieve a SealNotarization by session_id (hex-encoded).
   * Returns undefined if no row exists — absence is not an error.
   *
   * PERSIST-018 AC-006: does not throw and does not log an error on absence.
   */
  async getNotarization(sessionIdHex: string): Promise<SealNotarization | undefined> {
    const result = await this.#pool.query<Record<string, unknown>>(
      `SELECT session_id, sealed_root, participant_a_pubkey, participant_b_pubkey,
              close_timestamp, frost_signature
       FROM seal_notarizations
       WHERE session_id = decode($1, 'hex')`,
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
    }>("seal_notarizations", result.rows[0]!);
    return {
      session_id: new Uint8Array(row.session_id),
      sealed_root: new Uint8Array(row.sealed_root),
      participant_a_pubkey: new Uint8Array(row.participant_a_pubkey),
      participant_b_pubkey: new Uint8Array(row.participant_b_pubkey),
      close_timestamp: row.close_timestamp,
      frost_signature: new Uint8Array(row.frost_signature),
    };
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
      [pubkeyHex, JSON.stringify(event)],
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
  async drainNotifications(pubkeyHex: string, correlationId: string): Promise<DirectoryNotification[]> {
    const result = await this.#pool.query<{ id: string; payload: unknown }>(
      `WITH drained AS (
         DELETE FROM notification_queue WHERE pubkey_hex = $1
         RETURNING id, payload
       )
       SELECT id, payload FROM drained ORDER BY id ASC`,
      [pubkeyHex],
    );

    const notifications: DirectoryNotification[] = result.rows.map(
      (row) => row.payload as DirectoryNotification,
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

  setProfile(profile: AgentProfile): void {
    // Cache by both keys immediately — connection pre-check uses k_local_pubkey,
    // but indexing by primary_pubkey too means either key works robustly.
    this.#profilesByLocalKey.set(profile.k_local_pubkey, profile);
    this.#profilesByPrimaryKey.set(profile.primary_pubkey, profile);
    // Persist to Postgres (V9 migration adds agent_profiles table).
    this.#fire(this.#pool.query(
      `INSERT INTO agent_profiles
         (k_local_pubkey, primary_pubkey, ml_dsa_pubkey, phone_stub_hash, registered_at, status)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (k_local_pubkey) DO NOTHING`,
      [
        profile.k_local_pubkey,
        profile.primary_pubkey,
        profile.ml_dsa_pubkey,
        profile.phone_stub_hash,
        profile.registered_at,
        profile.status,
      ],
    ), "agent_profiles");
  }

  getProfile(pubkeyHex: string): AgentProfile | undefined {
    return this.#profilesByLocalKey.get(pubkeyHex) ?? this.#profilesByPrimaryKey.get(pubkeyHex);
  }

  hasProfile(pubkeyHex: string): boolean {
    return this.#profilesByLocalKey.has(pubkeyHex) || this.#profilesByPrimaryKey.has(pubkeyHex);
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
      [targetPubkey, JSON.stringify(request)],
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

    const requests: PendingConnectionRequest[] = result.rows.map(
      (row) => row.payload as PendingConnectionRequest,
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

  /**
   * Insert a session with owning_node_id.
   * The owning node is the sole writer for this session's hash chain.
   * session_id is a UUID per FEDERATION-001 AC-001 specification.
   */
  async insertSession(session: {
    sessionId: string;
    owningNodeId: string;
  }): Promise<{ id: number }> {
    const start = Date.now();
    const result = await this.#pool.query<{ id: string }>(
      `INSERT INTO sessions (session_id, owning_node_id)
       VALUES ($1::uuid, $2)
       RETURNING id`,
      [session.sessionId, session.owningNodeId],
    );
    const id = parseInt(result.rows[0].id, 10);
    this.#logger.info("adapter.persisted", {
      tableName: "sessions",
      rowCount: 1,
      durationMs: Date.now() - start,
    });
    return { id };
  }

  /**
   * Get a session by session_id (UUID).
   */
  async getSession(sessionId: string): Promise<{
    id: number;
    sessionId: string;
    owningNodeId: string;
  } | null> {
    const result = await this.#pool.query<Record<string, unknown>>(
      `SELECT * FROM sessions WHERE session_id = $1::uuid`,
      [sessionId],
    );
    if (result.rows.length === 0) return null;
    const row = deserializeRow<Record<string, unknown>>("sessions", result.rows[0]);
    return {
      id: row.id as number,
      sessionId: row.session_id as string,
      owningNodeId: row.owning_node_id as string,
    };
  }
}
