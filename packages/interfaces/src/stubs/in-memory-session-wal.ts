import type { SessionWal, Leaf } from "../session-wal.js";
import { RELAY_SESSION_UNRECOVERABLE } from "../session-wal.js";
import type { Logger } from "../logger.js";

export interface InMemorySessionWalOptions {
  logger: Logger;
}

/**
 * InMemorySessionWal — in-memory SessionWal stub for CELLO_ENV=local.
 *
 * No file I/O. Crash recovery is not testable in local mode but all other
 * SessionWal behaviors (append, reconstruct, delete, logging) work identically.
 */
export class InMemorySessionWal implements SessionWal {
  readonly #sessions = new Map<string, Leaf[]>();
  readonly #opened = new Set<string>();
  readonly #logger: Logger;

  constructor(opts: InMemorySessionWalOptions) {
    this.#logger = opts.logger;
  }

  async open(sessionId: string): Promise<void> {
    if (this.#opened.has(sessionId)) return;
    this.#opened.add(sessionId);
    if (!this.#sessions.has(sessionId)) {
      this.#sessions.set(sessionId, []);
    }
    this.#logger.info("relay.wal.opened", { sessionId, walPath: `memory:${sessionId}` });
  }

  async append(sessionId: string, leaf: Leaf): Promise<void> {
    if (!this.#opened.has(sessionId)) {
      throw new Error(`SessionWal: session not open — call open(${sessionId}) before append()`);
    }
    let leaves = this.#sessions.get(sessionId);
    if (!leaves) {
      leaves = [];
      this.#sessions.set(sessionId, leaves);
    }
    // Deep-copy byte arrays so callers cannot mutate stored state
    leaves.push({
      sequence_number: leaf.sequence_number,
      sender_pubkey: new Uint8Array(leaf.sender_pubkey),
      content_hash: new Uint8Array(leaf.content_hash),
      sender_signature: new Uint8Array(leaf.sender_signature),
      prev_root: new Uint8Array(leaf.prev_root),
    });
  }

  async reconstruct(sessionId: string): Promise<Leaf[] | typeof RELAY_SESSION_UNRECOVERABLE> {
    const start = Date.now();
    const leaves = this.#sessions.get(sessionId) ?? [];
    const durationMs = Date.now() - start;
    this.#logger.info("relay.wal.reconstructed", {
      sessionId,
      leafCount: leaves.length,
      durationMs,
    });
    // Return copies so callers cannot mutate stored state
    return leaves.map((l) => ({
      sequence_number: l.sequence_number,
      sender_pubkey: new Uint8Array(l.sender_pubkey),
      content_hash: new Uint8Array(l.content_hash),
      sender_signature: new Uint8Array(l.sender_signature),
      prev_root: new Uint8Array(l.prev_root),
    }));
  }

  async delete(sessionId: string): Promise<void> {
    this.#sessions.delete(sessionId);
    this.#opened.delete(sessionId);
    this.#logger.info("relay.wal.deleted", { sessionId });
  }
}
