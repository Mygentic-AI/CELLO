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
  /** Store a completed SealNotarization. */
  recordNotarization(notarization: SealNotarization): void;

  /** Retrieve a notarization by session_id hex. */
  getNotarization(sessionIdHex: string): SealNotarization | undefined;

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
   *
   * PERSIST-020: correlationId is the connection-request-scoped ID threaded through the
   * connection acceptance flow. Required for connection.persisted observability event.
   * The Postgres implementation validates connection_id against connection_requests before
   * writing. Throws if no matching pending request is found (SI-001).
   */
  createConnection(connectionId: string, participantA: string, participantB: string, establishedAt: number, correlationId?: string): Promise<void>;

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
