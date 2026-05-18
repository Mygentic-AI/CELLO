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
} from "@cello/protocol-types";
import type { AgentProfile, ConnectionEstablished, ConnectionRecord, PendingConnectionRequest } from "@cello/protocol-types";

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
   */
  enqueueNotification(pubkeyHex: string, event: DirectoryNotification): void;

  /**
   * Drain the pending notification queue for a pubkey. Returns [] if none.
   */
  drainNotifications(pubkeyHex: string): DirectoryNotification[];

  // ─── REG-001: Agent profile methods ──────────────────────────────────────

  /**
   * Store an AgentProfile. k_local_pubkey is the primary key.
   * Also indexes phone_stub_hash for phone_already_claimed guard.
   * REG-001 SI-002: Only called after successful FROST DKG.
   */
  setProfile(profile: AgentProfile): void;

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

  // ─── CONNREQ-002: Connection record methods ───────────────────────────────

  /**
   * Create a connection record for A–B. Indexed by both pubkeys and by connection_id.
   * CONNREQ-002: called only after directory receives connection_response { verdict: 'accept' }.
   */
  createConnection(connectionId: string, participantA: string, participantB: string, establishedAt: number): void;

  /**
   * Check if an active connection exists between pubkeyA and pubkeyB.
   * Returns { connection_id } if found, null if not.
   * O(1) lookup on the connection index.
   * SESSION-006: used by session_request handler to verify connection exists.
   */
  hasConnection(pubkeyA: string, pubkeyB: string): { connection_id: string } | null;

  /**
   * Retrieve a connection record by connection_id hex.
   * Returns null if not found.
   */
  getConnection(connectionId: string): ConnectionRecord | null;

  /**
   * Queue a pending connection request for an offline target.
   * At most 32 per target; drops the oldest when full.
   * Returns false if the queue was at capacity and oldest was dropped.
   */
  queuePendingConnectionRequest(targetPubkey: string, request: PendingConnectionRequest): boolean;

  /**
   * Dequeue and return all pending connection requests for a target (in arrival order).
   * Returns [] if none queued.
   */
  dequeuePendingConnectionRequests(targetPubkey: string): PendingConnectionRequest[];
}
