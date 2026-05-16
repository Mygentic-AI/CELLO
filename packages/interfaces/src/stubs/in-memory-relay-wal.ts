import type { RelayWal } from "../relay-wal.js";

/** In-memory RelayWal stub for CELLO_ENV=local. */
export class InMemoryRelayWal implements RelayWal {
  readonly #entries = new Map<string, Uint8Array>();
  readonly #order: string[] = [];

  async append(sessionId: string, payload: Uint8Array): Promise<void> {
    this.#entries.set(sessionId, payload);
    this.#order.push(sessionId);
  }

  async commit(sessionId: string): Promise<void> {
    this.#entries.delete(sessionId);
    const idx = this.#order.indexOf(sessionId);
    if (idx !== -1) this.#order.splice(idx, 1);
  }

  async uncommitted(): Promise<Array<{ sessionId: string; payload: Uint8Array }>> {
    return this.#order
      .filter((id) => this.#entries.has(id))
      .map((id) => ({ sessionId: id, payload: this.#entries.get(id)! }));
  }
}
