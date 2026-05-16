import type { ClientStore } from "../client-store.js";

/** In-memory ClientStore stub for CELLO_ENV=local. */
export class LocalClientStore implements ClientStore {
  readonly #store = new Map<string, Uint8Array>();

  async set(key: string, value: Uint8Array): Promise<void> {
    this.#store.set(key, value);
  }

  async get(key: string): Promise<Uint8Array | undefined> {
    return this.#store.get(key);
  }

  async delete(key: string): Promise<void> {
    this.#store.delete(key);
  }

  async has(key: string): Promise<boolean> {
    return this.#store.has(key);
  }
}
