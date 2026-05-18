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
}
