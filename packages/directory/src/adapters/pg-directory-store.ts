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

  #fire(query: Promise<unknown>): void {
    void query.catch((err: unknown) => {
      const reason = err instanceof Error ? err.message : String(err);
      this.#logger.error("adapter.write.failed", { adapterName: "PgDirectoryStore", reason });
    });
  }

  // ─── SealNotarization ────────────────────────────────────────────────────

  recordNotarization(notarization: SealNotarization): void {
    this.#fire(this.#pool.query(
      `INSERT INTO seal_notarizations
         (session_id, sealed_root, participant_a_pubkey, participant_b_pubkey,
          close_timestamp, frost_signature)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (session_id) DO NOTHING`,
      [
        Buffer.from(notarization.session_id),
        Buffer.from(notarization.sealed_root),
        Buffer.from(notarization.participant_a_pubkey),
        Buffer.from(notarization.participant_b_pubkey),
        notarization.close_timestamp,
        Buffer.from(notarization.frost_signature),
      ],
    ));
  }

  getNotarization(_sessionIdHex: string): SealNotarization | undefined {
    // Synchronous interface — not yet used in M4 integration paths.
    // PgDirectoryStore is wired for M4 AC-002 startup; full async reads come in PERSIST-003+.
    return undefined;
  }

  // ─── Notification queues ─────────────────────────────────────────────────

  enqueueNotification(pubkeyHex: string, event: DirectoryNotification): void {
    this.#fire(this.#pool.query(
      `INSERT INTO notification_queue (pubkey_hex, payload)
       VALUES ($1, $2)`,
      [pubkeyHex, JSON.stringify(event)],
    ));
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
    ));
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
    // SI-001: validate connection_id against connection_requests with outcome = 'ACCEPTED'.
    // The connection_id issued by CONNREQ-002 matches the request_id in connection_requests.
    // Only accepted requests may produce a connection record — rejected/pending/expired must not.
    const reqCheck = await this.#pool.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM connection_requests WHERE request_id = $1::uuid AND outcome = 'ACCEPTED'`,
      [connectionId],
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
    const result = await this.#pool.query<{
      connection_id: string;
      participant_a: string;
      participant_b: string;
      established_at: string;
      status: string;
    }>(
      `SELECT connection_id, participant_a, participant_b, established_at, status
       FROM connections WHERE connection_id = $1`,
      [connectionId],
    );
    if (result.rows.length === 0) return null;
    const row = result.rows[0]!;
    return {
      connection_id: row.connection_id,
      participant_a: row.participant_a,
      participant_b: row.participant_b,
      established_at: Number(row.established_at),
      status: row.status as "active",
    };
  }

  queuePendingConnectionRequest(targetPubkey: string, request: PendingConnectionRequest): boolean {
    this.#fire(this.#pool.query(
      `INSERT INTO pending_connection_requests (target_pubkey, payload)
       VALUES ($1, $2)`,
      [targetPubkey, JSON.stringify(request)],
    ));
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

    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");

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

      await client.query("COMMIT");
      return chainHash;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => { /* ignore rollback errors */ });
      throw err;
    } finally {
      client.release();
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
