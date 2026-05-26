/**
 * DirectoryStore — persistence interface for directory state (PERSIST-001 / NODE-001).
 *
 * Migrated from packages/directory/src/directory-store.ts so all packages can
 * depend on the interface without pulling in the full directory implementation.
 *
 * SealNotarization is a storage-only record (never sent on the wire) and is defined
 * locally here rather than in packages/protocol-types.
 */

import type {
  SessionAbandoned,
  SessionSealed,
  SessionSealRejected,
  SealVerified,
} from "@cello-protocol/protocol-types";
import type { AgentProfile, ConnectionEstablished, ConnectionRecord, PendingConnectionRequest } from "@cello-protocol/protocol-types";

// ─── ACCOUNT-001: Account identity types ─────────────────────────────────────

/**
 * Parameters for creating a new user_accounts row.
 * ACCOUNT-001: email_stub_hash is optional — email is not required at account creation time.
 */
export interface CreateAccountParams {
  accountId: string;        // UUID
  phoneStubHash: string;    // SHA-256(phone_stub) per FIPS 180-4
  emailStubHash?: string;   // SHA-256(email_stub) per FIPS 180-4 — optional
  correlationId?: string;   // For observability threading
}

/**
 * A persisted user_accounts row.
 * ACCOUNT-001: returned by createAccount().
 */
export interface AccountRow {
  id: number;               // BIGSERIAL — internal row ordering
  account_id: string;       // UUID PRIMARY KEY
  phone_stub_hash: string;  // SHA-256(phone_stub) — stored opaque; never decrypted by directory
  email_stub_hash: string | null; // SHA-256(email_stub) — optional; null if not set
  created_at: string;       // TIMESTAMPTZ as ISO string
  chain_hash: string;       // SHA-256 hash chain value
}

/** Internal storage record for a completed FROST-notarized seal ceremony. Never sent on the wire. */
export interface SealNotarization {
  session_id: Uint8Array;           // 16 bytes
  sealed_root: Uint8Array;          // 32-byte Merkle root
  participant_a_pubkey: Uint8Array; // 32 bytes
  participant_b_pubkey: Uint8Array; // 32 bytes
  close_timestamp: number;          // Unix ms
  frost_signature: Uint8Array;      // 64-byte FROST (or legacy Ed25519) signature over the notarization
}

export type DirectoryNotification = SessionAbandoned | SessionSealed | SessionSealRejected | SealVerified | ConnectionEstablished;

export interface DirectoryStore {
  /**
   * Store a completed SealNotarization.
   *
   * PERSIST-018: async — writes to Postgres with one retry on transient failure.
   * Logs notarization.recorded at INFO on success.
   * Logs notarization.write.failed at ERROR on each failure attempt.
   * Logs notarization.duplicate.rejected at WARN on unique constraint violation.
   *
   * @param opts.correlationId - The seal-ceremony correlationId minted at ceremony
   *   initiation. Threaded through all observability events in this flow.
   * @param opts.client - Optional pre-acquired PoolClient for transactional writes.
   *   When provided, the store uses this client instead of acquiring from the pool,
   *   enabling atomic multi-table writes (e.g. conversation_seals + seal_notarizations
   *   in a single transaction). SI-002 requires this capability.
   */
  recordNotarization(notarization: SealNotarization, opts?: { correlationId?: string; client?: unknown }): Promise<void>;

  /**
   * Retrieve a notarization by session_id hex.
   *
   * PERSIST-018: async — queries Postgres. Returns undefined if no row exists.
   * Does not throw and does not log an error on absence.
   */
  getNotarization(sessionIdHex: string): Promise<SealNotarization | undefined>;

  /**
   * Enqueue a notification event for a pubkey that has no active signaling stream.
   * Drops oldest if at the 256-event bound.
   * PERSIST-019: correlationId is optional; when provided it appears in the
   * notification.queued log event for traceability.
   */
  enqueueNotification(pubkeyHex: string, event: DirectoryNotification, correlationId?: string): void;

  /**
   * Drain the pending notification queue for a pubkey. Returns [] if none.
   * PERSIST-019: async so PgDirectoryStore can do a real SELECT+DELETE in a single
   * transaction (SI-001: prevents double delivery under concurrent reconnects).
   * correlationId appears in the notification.drained log event.
   */
  drainNotifications(pubkeyHex: string, correlationId: string): Promise<DirectoryNotification[]>;

  // ─── REG-001: Agent profile methods ──────────────────────────────────────

  /**
   * Store an AgentProfile. k_local_pubkey is the primary key.
   * Also indexes phone_stub_hash for phone_already_claimed guard.
   * REG-001 SI-002: Only called after successful FROST DKG.
   *
   * ACCOUNT-001: correlationId is optional. When the profile includes an account_id,
   * correlationId is threaded into the account.agent.linked and account.agent.link.failed
   * log events. M6 callers will populate it; pre-M6 callers pass nothing (undefined is
   * acceptable).
   */
  setProfile(profile: AgentProfile, correlationId?: string): void;

  /**
   * Retrieve a profile by k_local_pubkey hex. Returns undefined if not registered.
   */
  getProfile(kLocalPubkeyHex: string): AgentProfile | undefined;

  /**
   * Return true if an agent with this k_local_pubkey has already registered.
   */
  hasProfile(kLocalPubkeyHex: string): boolean;

  /**
   * Return true if the given phone_stub_hash (hex SHA-256) is already claimed.
   * Used for the phone_already_claimed duplicate guard.
   * REG-001 SI-001: raw phone_stub is NEVER passed here — only the hash.
   */
  hasPhoneStubHash(phoneStubHashHex: string): boolean;

  // ─── ACCOUNT-001: Account identity methods ───────────────────────────────

  /**
   * Create a new user_accounts row with hash chain enforcement.
   *
   * ACCOUNT-001: logs account.created at INFO on success.
   * Logs account.phone_stub_hash.duplicate at WARN on unique constraint violation;
   * rethrows so the caller can handle the failure.
   *
   * @param params.accountId - UUID for the new account
   * @param params.phoneStubHash - SHA-256(phone_stub) — must be unique
   * @param params.emailStubHash - Optional SHA-256(email_stub)
   * @param params.correlationId - For observability threading
   * @throws on duplicate phone_stub_hash or other DB error
   */
  createAccount(params: CreateAccountParams): Promise<AccountRow>;

  /**
   * Return all agent_profiles rows with account_id = accountId,
   * ordered by registered_at ASC.
   *
   * ACCOUNT-001 AC-002: returns both linked agents in registration order.
   * ACCOUNT-001 AC-004: NULL account_id rows are excluded from results.
   *
   * Returns [] if no agents are linked to this account.
   * Does not throw on empty result.
   */
  getAgentsByAccount(accountId: string): Promise<AgentProfile[]>;

  // ─── CONNREQ-002: Connection record methods ───────────────────────────────

  /**
   * Record an accepted connection request in connection_requests.
   * Must be called before createConnection — the SI-001 guard in the Postgres
   * implementation validates that a matching ACCEPTED row exists.
   * Called by directory-node.ts when a connection_response { verdict: 'accept' } arrives.
   */
  recordAcceptedConnectionRequest(requestId: string, requesterPseudonym: string, targetPseudonym: string): Promise<void>;

  /**
   * Create a connection record for A–B. Indexed by both pubkeys and by connection_id.
   * CONNREQ-002: called only after directory receives connection_response { verdict: 'accept' }.
   *
   * PERSIST-020: correlationId is the connection-request-scoped ID threaded through the
   * connection acceptance flow. Required for connection.persisted observability event.
   * The Postgres implementation validates connection_id against connection_requests before
   * writing. Throws if no matching pending request is found (SI-001).
   */
  createConnection(connectionId: string, participantA: string, participantB: string, establishedAt: number, correlationId: string): Promise<void>;

  /**
   * Check if an active connection exists between pubkeyA and pubkeyB.
   * Returns the connection record if found, null if not.
   * O(1) lookup on both composite indexes (forward + reverse).
   * SESSION-006: used by session_request handler to verify connection exists.
   *
   * PERSIST-020: returns Promise to support Postgres-backed implementations.
   */
  hasConnection(pubkeyA: string, pubkeyB: string): Promise<{ connection_id: string } | null>;

  /**
   * Retrieve a connection record by connection_id hex.
   * Returns null if not found. Does not throw on missing record.
   *
   * PERSIST-020: returns Promise to support Postgres-backed implementations.
   */
  getConnection(connectionId: string): Promise<ConnectionRecord | null>;

  /**
   * Enqueue a notification for delivery. Returns true on success.
   * No queue capacity limit is enforced in M4 (see DB-003).
   */
  queuePendingConnectionRequest(targetPubkey: string, request: PendingConnectionRequest): boolean;

  /**
   * Dequeue and return all pending connection requests for a target (in arrival order).
   * Returns [] if none queued. Only returns requests within the 24-hour TTL.
   * PERSIST-019: async so PgDirectoryStore can SELECT+DELETE in a single transaction
   * (SI-001). correlationId appears in queue.pending_connection_requests.drained event.
   */
  dequeuePendingConnectionRequests(targetPubkey: string, correlationId: string): Promise<PendingConnectionRequest[]>;

  // ─── FEDERATION-001: Session ownership methods ───────────────────────────

  /**
   * Write a sessions row with owning_node_id set to this node's node_id.
   *
   * FEDERATION-001 AC-009: inserts via the hash chain mechanism; the sessions
   * table is append-only and hash-chained. SI-001: the owning node is the sole
   * writer — callers pass the owning node's node_id explicitly so application code
   * cannot write for a foreign session.
   *
   * Throws if a sessions row for this session_id already exists (unique constraint).
   */
  writeSession(sessionId: string, owningNodeId: string): Promise<void>;

  /**
   * Retrieve the owning_node_id for a session_id.
   *
   * Returns undefined if no sessions row exists for this session_id.
   * Does not throw on absence.
   */
  getSessionOwner(sessionId: string): Promise<string | undefined>;

  /**
   * Verify a single replicated row's chain hash.
   *
   * FEDERATION-001 AC-005/AC-006: called by the receiving node when a row arrives
   * via logical replication. Computes SHA-256(record_contents || previous_chain_hash)
   * and compares to the row's chain_hash field.
   *
   * On match: logs federation.replication.verified at INFO with
   *   { nodeId, sessionId, leafIndex, chainHash, durationMs }.
   * On mismatch: logs federation.replication.chain_hash_mismatch at ERROR with
   *   { nodeId, sessionId, leafIndex, expectedHash, receivedHash }, then throws so the
   *   caller can halt replication for this session's rows pending operator investigation.
   *
   * @param tableName - The name of the hash-chained table the row belongs to.
   * @param row - The row as returned by the pg driver (field values are strings/numbers/etc).
   * @throws if the chain hash does not match (caller must halt replication on throw)
   */
  verifyReplicatedRow(tableName: string, row: Record<string, unknown>): Promise<void>;

  // ─── FEDERATION-002: Checkpoint cross-signing ───────────────────────────

  /**
   * Write a checkpoint_node_signatures row.
   *
   * FEDERATION-002 AC-009-store-tables: records a single node's Ed25519 signature for
   * a confirmed checkpoint. The (checkpoint_id, node_id) UNIQUE constraint ensures the
   * same node cannot submit two signatures for the same checkpoint.
   *
   * @throws on unique constraint violation (SQLSTATE 23505) — SI-001: same node twice
   *   does not count toward the threshold.
   */
  writeCheckpointSignature(params: {
    checkpointId: string;
    nodeId: string;
    nodeSignature: string;
  }): Promise<void>;

  /**
   * Get all checkpoint_node_signatures rows for a checkpoint_id.
   *
   * FEDERATION-002 AC-009-store-tables: round-trip read.
   * BIGSERIAL id is deserialized to number.
   */
  getCheckpointSignatures(checkpointId: string): Promise<Array<{
    id: number;
    checkpointId: string;
    nodeId: string;
    nodeSignature: string;
  }>>;

  /**
   * Write a directory_checkpoints row for a confirmed checkpoint.
   *
   * FEDERATION-002: append-only, hash-chained. Called by CheckpointCoordinator after
   * collecting >= requiredThreshold signatures.
   */
  writeCheckpoint(params: {
    checkpointId: string;
    mmrPeaks: string[];
    identityMerkleRoot: string;
    checkpointHash: string;
    mmrLeafCount: number;
    coordinatorNodeId: string;
  }): Promise<void>;

  /**
   * Retrieve a directory_checkpoints row by checkpoint_id.
   *
   * FEDERATION-002: used to verify a checkpoint was committed. Returns undefined if absent.
   */
  getCheckpointById(checkpointId: string): Promise<{
    checkpointId: string;
    mmrLeafCount: number;
    checkpointHash: string;
    coordinatorNodeId: string;
    mmrPeaks: string[];
    identityMerkleRoot: string;
  } | undefined>;

  /**
   * Get the ISO-8601 timestamp of the most recent confirmed checkpoint.
   *
   * FEDERATION-002 AC-009 gap alarm. Returns null if no checkpoints exist.
   */
  getLastCheckpointAt(): Promise<string | null>;

  /**
   * Get the checkpoint_id of the most recent confirmed checkpoint.
   *
   * FEDERATION-002 AC-009 gap alarm. Returns null if no checkpoints exist.
   */
  getLastCheckpointRow(): Promise<{ checkpointId: string } | null>;

  /**
   * Get staging rows eligible for the next checkpoint batch.
   *
   * FEDERATION-002 AC-008-crash-mid-clear: excludes staging rows whose session has
   * already been committed to conversation_proof_leaf_checkpoints.
   *
   * Returns rows without a checkpoint_id that have not been previously confirmed.
   */
  getStagingRowsForBatch(): Promise<Array<{
    stagingId: string;
    sessionId: string;
    recordedAt: string;
  }>>;

  /**
   * Get the current MMR state for checkpoint hash computation.
   *
   * FEDERATION-002: returns mmrPeaks, identityMerkleRoot, and mmrLeafCount.
   */
  getCheckpointMmrState(): Promise<{
    mmrPeaks: string[];
    identityMerkleRoot: string;
    mmrLeafCount: number;
  }>;

  /**
   * Delete staging rows by stagingId after a successful checkpoint.
   *
   * FEDERATION-002 AC-003: only deletes rows in the current batch (by id),
   * leaving rows inserted after initiateCheckpoint was called.
   *
   * @param stagingIds - Array of staging row IDs to delete.
   */
  clearStagingBatch(stagingIds: string[]): Promise<void>;

  // ─── FEDERATION-003: Relay registration ──────────────────────────────────

  /**
   * Register a relay node's Ed25519 public key.
   *
   * FEDERATION-003 AC-002/AC-003: idempotent by design.
   *   - If no row exists for relayId: insert a new row and log relay.registered at INFO.
   *   - If a row exists with the SAME publicKeyHex: no-op, log relay.already.registered at INFO.
   *   - If a row exists with a DIFFERENT publicKeyHex: throw RELAY_IDENTITY_CONFLICT,
   *     log relay.registration.conflict at ERROR.
   *
   * SI-001: relay_registrations is append-only — the existing key is NEVER overwritten.
   *
   * @param params.relayId - The hex-encoded Ed25519 public key of the relay (stable identifier)
   * @param params.publicKeyHex - 64-char hex of the relay's Ed25519 public key (same as relayId by convention)
   * @param params.region - AWS region where this relay runs
   * @throws Error with message containing "RELAY_IDENTITY_CONFLICT" if relayId already exists with a different key
   */
  registerRelay(params: { relayId: string; publicKeyHex: string; region: string }): Promise<void>;

  /**
   * Retrieve the registered public key hex for a relay by its relayId.
   *
   * FEDERATION-003 AC-004: used by clients and new relays to verify relay ACK signatures.
   * Returns undefined if the relayId is not registered.
   * Does not throw on absence.
   */
  getRelayPublicKey(relayId: string): Promise<string | undefined>;
}
