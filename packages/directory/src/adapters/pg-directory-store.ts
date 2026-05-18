/**
 * PgDirectoryStore — Postgres-backed DirectoryStore for CELLO_ENV=local (Docker Compose)
 * and production environments (RDS).
 *
 * Used only by the composition root (bin/directory.ts). Never imported from application code.
 * PERSIST-001 SI-002: not exported from packages/directory index.ts.
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
      await this.insertWithChain("seal_notarizations", record, columns, values, chainHashIndex, externalClient);
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
      await this.insertWithChain("seal_notarizations", record, columns, values, chainHashIndex, externalClient);
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
    const result = await this.#pool.query<{
      session_id: Buffer;
      sealed_root: Buffer;
      participant_a_pubkey: Buffer;
      participant_b_pubkey: Buffer;
      close_timestamp: string;
      frost_signature: Buffer;
    }>(
      `SELECT session_id, sealed_root, participant_a_pubkey, participant_b_pubkey,
              close_timestamp, frost_signature
       FROM seal_notarizations
       WHERE session_id = decode($1, 'hex')`,
      [sessionIdHex],
    );

    if (result.rows.length === 0) return undefined;

    const row = result.rows[0]!;
    return {
      session_id: new Uint8Array(row.session_id),
      sealed_root: new Uint8Array(row.sealed_root),
      participant_a_pubkey: new Uint8Array(row.participant_a_pubkey),
      participant_b_pubkey: new Uint8Array(row.participant_b_pubkey),
      close_timestamp: Number(row.close_timestamp),
      frost_signature: new Uint8Array(row.frost_signature),
    };
  }

  // ─── Notification queues ─────────────────────────────────────────────────

  enqueueNotification(pubkeyHex: string, event: DirectoryNotification): void {
    this.#fire(this.#pool.query(
      `INSERT INTO notification_queue (pubkey_hex, payload)
       VALUES ($1, $2)`,
      [pubkeyHex, JSON.stringify(event)],
    ), "notification_queue");
  }

  drainNotifications(_pubkeyHex: string): DirectoryNotification[] {
    // Synchronous drain is in-memory only in M4; Postgres-backed drain comes in PERSIST-003+.
    return [];
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

  // ─── Connection records ──────────────────────────────────────────────────

  createConnection(connectionId: string, participantA: string, participantB: string, establishedAt: number): void {
    this.#fire(this.#pool.query(
      `INSERT INTO connections
         (connection_id, participant_a, participant_b, established_at, status)
       VALUES ($1,$2,$3,$4,'active')
       ON CONFLICT (connection_id) DO NOTHING`,
      [connectionId, participantA, participantB, establishedAt],
    ), "connections");
  }

  hasConnection(_pubkeyA: string, _pubkeyB: string): { connection_id: string } | null {
    return null; // backing store read in PERSIST-003+
  }

  getConnection(_connectionId: string): ConnectionRecord | null {
    return null; // backing store read in PERSIST-003+
  }

  queuePendingConnectionRequest(targetPubkey: string, request: PendingConnectionRequest): boolean {
    this.#fire(this.#pool.query(
      `INSERT INTO pending_connection_requests (target_pubkey, payload)
       VALUES ($1, $2)`,
      [targetPubkey, JSON.stringify(request)],
    ), "pending_connection_requests");
    return true;
  }

  dequeuePendingConnectionRequests(_targetPubkey: string): PendingConnectionRequest[] {
    return []; // backing store read in PERSIST-003+
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
   * SI-002: chain_hash is always computed internally — never accepted from external callers.
   * SI-003: Advisory lock prevents forked chains under concurrent writes.
   *
   * @param tableName - The target hash-chained table
   * @param record - Record fields (chain_hash field is ignored if present — always recomputed)
   * @param columns - Column names in insertion order (must include chain_hash)
   * @param values - Corresponding values (chain_hash slot will be overwritten)
   * @param chainHashIndex - Index of chain_hash in the columns/values arrays
   */
  async insertWithChain(
    tableName: HashChainedTable,
    record: Record<string, unknown>,
    columns: string[],
    values: unknown[],
    chainHashIndex: number,
    externalClient?: pg.PoolClient,
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
   * AC-003: clean chain → { valid: true }
   * AC-004: tampered row → break at that position
   * AC-005: deleted row → chain recomputation detects the gap
   */
  async verifyChain(tableName: HashChainedTable): Promise<ChainVerificationResult> {
    const result = await this.#pool.query<Record<string, unknown>>(
      `SELECT * FROM ${tableName} ORDER BY id ASC`,
    );
    return verifyChain(result.rows, this.#logger, tableName);
  }
}
