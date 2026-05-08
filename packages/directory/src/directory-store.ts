/**
 * CELLO Directory Node — DirectoryStore and InMemoryDirectoryStore (NODE-001)
 *
 * DirectoryStore: persistence abstraction for directory state.
 * InMemoryDirectoryStore: in-process implementation for M1 testing.
 */

import type { SealNotarization, SessionAbandoned, SessionSealed, SessionSealRejected, SealVerified } from "./directory-types.js";

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
}

const NOTIFICATION_QUEUE_BOUND = 256;

export class InMemoryDirectoryStore implements DirectoryStore {
  readonly #notarizations = new Map<string, SealNotarization>();
  readonly #notificationQueues = new Map<string, DirectoryNotification[]>();

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
}
