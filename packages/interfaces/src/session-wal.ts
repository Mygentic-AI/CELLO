/**
 * SessionWal — write-ahead log interface for per-session Structure 2 leaf durability (PERSIST-013).
 *
 * Named SessionWal (not RelayWal) to distinguish per-session leaf WAL semantics
 * from the existing RelayWal assignment-durability interface. AC-007 in the story
 * YAML uses the old name — the implementation name is authoritative.
 *
 * 🚨 **NOTHING CURRENTLY WRITES OR READS THIS WAL, AND THE PARAGRAPH BELOW DESCRIBES AN INTENT, NOT
 * A BEHAVIOUR.** It used to be stated as fact — *"on relay crash + restart, the relay reads the WAL
 * and reconstructs in-memory Merkle state leaf by leaf without requiring agents to re-submit"* — and
 * that is a durability claim about hash-chain leaves, which is exactly the kind a reader trusts
 * without checking.
 *
 * What is actually true (verified 2026-08-23, `DOD-M15-SEALWIRE-1` bullet 7 review pass 2): the
 * relay's composition root constructs a `SessionWal` and **never passes it to the node** — the
 * `const sessionWal` in `bin/relay.ts` has carried an `eslint-disable` for unused-vars since
 * PERSIST-013 landed on 2026-05-16. So `RelayNode`'s injected copy has always been `null`, no
 * `open`/`append`/`reconstruct` runs in production, and a relay crash loses in-memory leaf state
 * exactly as it would with no WAL at all.
 *
 * The interface and both implementations are kept, and deliberately: they are a complete, tested
 * implementation of intended durability, and deleting them is a decision about whether relay leaf
 * durability is wanted — not a cleanup. Tracked as its own DoD item rather than left as a comment,
 * because a security-relevant gap with no pointer reads exactly like one that is handled.
 *
 * THE INTENT, unchanged: the session WAL records every Structure 2 leaf as it is sequenced by the
 * relay, so that on crash + restart the relay can reconstruct in-memory Merkle state leaf by leaf
 * without requiring agents to re-submit.
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
  structure1_cbor: Uint8Array;  // the exact bytes the sender signed — the only way to verify a leaf's
                                // signature after the fact, and the reason a reconstructed leaf is
                                // trustworthy. (Its previous note cited gap-fill, deleted in bullet 7.)
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

}
