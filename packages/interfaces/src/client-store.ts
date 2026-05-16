/**
 * ClientStore — persistence interface for client-side session and key state (PERSIST-001).
 *
 * Production implementation: SQLCipherClientStore (encrypted SQLite, CELLO_ENV=dev+).
 * Local stub: LocalClientStore (in-memory, CELLO_ENV=local).
 */
export interface ClientStore {
  /** Persist an opaque blob under the given key. Overwrites any existing value. */
  set(key: string, value: Uint8Array): Promise<void>;

  /** Retrieve a previously stored blob. Returns undefined if not found. */
  get(key: string): Promise<Uint8Array | undefined>;

  /** Delete a stored blob. No-op if not found. */
  delete(key: string): Promise<void>;

  /** Return true if a blob exists for the given key. */
  has(key: string): Promise<boolean>;
}
