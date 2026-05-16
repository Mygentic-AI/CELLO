/**
 * RelayWal — write-ahead log interface for relay assignment durability (PERSIST-001).
 *
 * The relay WAL records session assignments before they are applied so they can
 * be replayed after a crash. Each entry is an opaque payload identified by sessionId.
 *
 * Production implementation: FileRelayWal (append-only file, CELLO_ENV=dev+).
 * Local stub: InMemoryRelayWal (CELLO_ENV=local).
 */
export interface RelayWal {
  /** Append a WAL entry for the given sessionId. */
  append(sessionId: string, payload: Uint8Array): Promise<void>;

  /** Mark a WAL entry as committed (applied). */
  commit(sessionId: string): Promise<void>;

  /** Return all uncommitted entries in append order (for crash recovery). */
  uncommitted(): Promise<Array<{ sessionId: string; payload: Uint8Array }>>;
}
