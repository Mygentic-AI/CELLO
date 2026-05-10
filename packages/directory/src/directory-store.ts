/**
 * CELLO Directory Node — DirectoryStore and InMemoryDirectoryStore (NODE-001)
 *
 * DirectoryStore: persistence abstraction for directory state.
 * InMemoryDirectoryStore: in-process implementation for M1 testing.
 *
 * REG-001 additions:
 *   - AgentProfile storage: getProfile, hasProfile, setProfile
 *   - Phone stub hash index for phone_already_claimed guard
 */

import type { SealNotarization, SessionAbandoned, SessionSealed, SessionSealRejected, SealVerified } from "./directory-types.js";
import type { AgentProfile } from "@cello/protocol-types";

export type DirectoryNotification = SessionAbandoned | SessionSealed | SessionSealRejected | SealVerified;

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
}

const NOTIFICATION_QUEUE_BOUND = 256;

export class InMemoryDirectoryStore implements DirectoryStore {
  readonly #notarizations = new Map<string, SealNotarization>();
  readonly #notificationQueues = new Map<string, DirectoryNotification[]>();

  // REG-001: Agent profile storage
  readonly #profiles = new Map<string, AgentProfile>();
  // REG-001: phone_stub_hash → k_local_pubkey (for duplicate phone guard)
  readonly #phoneHashIndex = new Map<string, string>();

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
}
