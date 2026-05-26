/**
 * SessionWal — write-ahead log interface for per-session Structure 2 leaf durability (PERSIST-013).
 *
 * Named SessionWal (not RelayWal) to distinguish per-session leaf WAL semantics
 * from the existing RelayWal assignment-durability interface. AC-007 in the story
 * YAML uses the old name — the implementation name is authoritative.
 *
 * The session WAL records every Structure 2 leaf as it is sequenced by the relay.
 * On relay crash + restart, the relay reads the WAL and reconstructs in-memory Merkle state
 * leaf by leaf without requiring agents to re-submit.
 *
 * This interface is separate from RelayWal (PERSIST-001), which covers assignment durability.
 * SessionWal covers leaf-level durability for per-session crash recovery.
 *
 * Production implementation: FileSessionWal (CELLO_ENV=dev/production).
 *   WAL file path: WAL_DIR/{sessionId}.wal
 *   Each entry: length-prefixed JSON + SHA-256 truncated checksum; fsync before returning.
 * Local stub: InMemorySessionWal (CELLO_ENV=local).
 *
 * On checksum failure or truncation: returns RELAY_SESSION_UNRECOVERABLE.
 * Partial reconstruction is impossible — either all leaves are valid or the session is unrecoverable.
 */

/** Sentinel value returned by reconstruct() when the WAL is corrupt or unrecoverable. */
export const RELAY_SESSION_UNRECOVERABLE = Symbol("RELAY_SESSION_UNRECOVERABLE");

/** A Structure 2 leaf as stored in the WAL. Fields mirror Structure2 in @cello-protocol/protocol-types. */
export interface Leaf {
  sequence_number: number;
  sender_pubkey: Uint8Array;
  content_hash: Uint8Array;
  sender_signature: Uint8Array;
  prev_root: Uint8Array;
  structure1_cbor: Uint8Array;  // exact bytes sender signed — required for gap-fill signature verification
}

/**
 * SessionWal interface — per-session WAL for Structure 2 leaf durability.
 *
 * AC-007: core methods — open, append, reconstruct, delete.
 */
export interface SessionWal {
  /**
   * Open the WAL for a session. Must be called before append().
   * Creates/opens the WAL file (or in-memory store) for the session.
   * Logs relay.wal.opened with { sessionId, walPath }.
   * Idempotent if called more than once for the same sessionId.
   */
  open(sessionId: string): Promise<void>;

  /**
   * Append a leaf to the WAL for the given sessionId.
   * The session must have been opened via open() before calling append().
   * Must be durable before resolving (SI-002: fsync before ACK).
   * On write failure: logs relay.wal.write.failed and rejects (DB-002).
   */
  append(sessionId: string, leaf: Leaf): Promise<void>;

  /**
   * Reconstruct all leaves for a session from the WAL.
   * Returns leaves in append order.
   * Returns [] if no WAL entry exists for sessionId (new session, not yet in WAL).
   * Returns RELAY_SESSION_UNRECOVERABLE if any entry is corrupt or the file is truncated.
   * On success: logs relay.wal.reconstructed with { sessionId, leafCount, durationMs }.
   * On failure: logs relay.wal.unrecoverable or relay.wal.entry.corrupt with { sessionId, reason }.
   */
  reconstruct(sessionId: string): Promise<Leaf[] | typeof RELAY_SESSION_UNRECOVERABLE>;

  /**
   * Delete the WAL for a session (called after seal confirmation).
   * Logs relay.wal.deleted with { sessionId }.
   * Idempotent — no error if the WAL does not exist.
   */
  delete(sessionId: string): Promise<void>;

  /**
   * PERSIST-014: Retrieve leaves for gap-fill reconciliation.
   * Returns leaves with sequence_number strictly greater than fromSeq
   * and less than or equal to toSeq.
   *
   * SI-001: Only serves leaves above the last agreed sequence number.
   * Returns RELAY_SESSION_UNRECOVERABLE if the WAL is corrupt or unavailable.
   * Returns [] if no leaves match the range.
   */
  getLeaves(sessionId: string, fromSeq: number, toSeq: number): Promise<Leaf[] | typeof RELAY_SESSION_UNRECOVERABLE>;
}
