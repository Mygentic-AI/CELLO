/**
 * CELLO Directory Node — DirectoryStore and InMemoryDirectoryStore (NODE-001)
 *
 * DirectoryStore: persistence abstraction for directory state.
 * InMemoryDirectoryStore: in-process implementation for M1 testing.
 *
 * REG-001 additions:
 *   - AgentProfile storage: getProfile, hasProfile, setProfile
 *   - Phone stub hash index for phone_already_claimed guard
 *
 * CONNREQ-002 additions:
 *   - createConnection, hasConnection, getConnection
 *   - queuePendingConnectionRequest, dequeuePendingConnectionRequests
 */

import type { SealNotarization, SessionAbandoned, SessionSealed, SessionSealRejected, SealVerified } from "./directory-types.js";
import type { AgentProfile, ConnectionEstablished } from "@cello/protocol-types";
import type { ConnectionRecord, PendingConnectionRequest } from "@cello/protocol-types";

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

const NOTIFICATION_QUEUE_BOUND = 256;
const PENDING_CONNECTION_REQUEST_BOUND = 32;

export class InMemoryDirectoryStore implements DirectoryStore {
  readonly #notarizations = new Map<string, SealNotarization>();
  readonly #notificationQueues = new Map<string, DirectoryNotification[]>();

  // REG-001: Agent profile storage
  readonly #profiles = new Map<string, AgentProfile>();
  // REG-001: phone_stub_hash → k_local_pubkey (for duplicate phone guard)
  readonly #phoneHashIndex = new Map<string, string>();

  // CONNREQ-002: Connection records indexed by connection_id
  readonly #connections = new Map<string, ConnectionRecord>();
  // CONNREQ-002: "pubkeyA:pubkeyB" (sorted) → connection_id for O(1) pair lookup
  readonly #connectionPairs = new Map<string, string>();
  // CONNREQ-002: target_pubkey → queued pending connection requests (up to 32)
  readonly #pendingConnectionRequests = new Map<string, PendingConnectionRequest[]>();

  recordNotarization(notarization: SealNotarization): void {
    const key = Buffer.from(notarization.session_id).toString("hex");
    this.#notarizations.set(key, notarization);
  }

  getNotarization(sessionIdHex: string): SealNotarization | undefined {
    return this.#notarizations.get(sessionIdHex);
  }

  enqueueNotification(pubkeyHex: string, event: DirectoryNotification): void {
    let queue = this.#notificationQueues.get(pubkeyHex);
    if (!queue) {
      queue = [];
      this.#notificationQueues.set(pubkeyHex, queue);
    }
    if (queue.length >= NOTIFICATION_QUEUE_BOUND) {
      queue.shift();
      console.warn(`[directory] notification queue full for ${pubkeyHex.slice(0, 16)}…, oldest event dropped`);
    }
    queue.push(event);
  }

  drainNotifications(pubkeyHex: string): DirectoryNotification[] {
    const queue = this.#notificationQueues.get(pubkeyHex);
    if (!queue || queue.length === 0) return [];
    return queue.splice(0);
  }

  // ─── REG-001: Profile methods ─────────────────────────────────────────────

  setProfile(profile: AgentProfile): void {
    this.#profiles.set(profile.k_local_pubkey, profile);
    this.#phoneHashIndex.set(profile.phone_stub_hash, profile.k_local_pubkey);
  }

  getProfile(kLocalPubkeyHex: string): AgentProfile | undefined {
    return this.#profiles.get(kLocalPubkeyHex);
  }

  hasProfile(kLocalPubkeyHex: string): boolean {
    return this.#profiles.has(kLocalPubkeyHex);
  }

  hasPhoneStubHash(phoneStubHashHex: string): boolean {
    return this.#phoneHashIndex.has(phoneStubHashHex);
  }

  // ─── CONNREQ-002: Connection record methods ───────────────────────────────

  createConnection(connectionId: string, participantA: string, participantB: string, establishedAt: number): void {
    const record: ConnectionRecord = {
      connection_id: connectionId,
      participant_a: participantA,
      participant_b: participantB,
      established_at: establishedAt,
      status: "active",
    };
    this.#connections.set(connectionId, record);
    // Sorted pair key for symmetric lookup
    const pairKey = [participantA, participantB].sort().join(":");
    this.#connectionPairs.set(pairKey, connectionId);
  }

  hasConnection(pubkeyA: string, pubkeyB: string): { connection_id: string } | null {
    const pairKey = [pubkeyA, pubkeyB].sort().join(":");
    const connectionId = this.#connectionPairs.get(pairKey);
    if (!connectionId) return null;
    const record = this.#connections.get(connectionId);
    if (!record || record.status !== "active") return null;
    return { connection_id: connectionId };
  }

  getConnection(connectionId: string): ConnectionRecord | null {
    return this.#connections.get(connectionId) ?? null;
  }

  queuePendingConnectionRequest(targetPubkey: string, request: PendingConnectionRequest): boolean {
    let queue = this.#pendingConnectionRequests.get(targetPubkey);
    if (!queue) {
      queue = [];
      this.#pendingConnectionRequests.set(targetPubkey, queue);
    }
    if (queue.length >= PENDING_CONNECTION_REQUEST_BOUND) {
      queue.shift(); // drop oldest (DB-001: oldest dropped when queue full)
      queue.push(request);
      return false; // dropped one
    }
    queue.push(request);
    return true;
  }

  dequeuePendingConnectionRequests(targetPubkey: string): PendingConnectionRequest[] {
    const queue = this.#pendingConnectionRequests.get(targetPubkey);
    if (!queue || queue.length === 0) return [];
    return queue.splice(0);
  }
}
