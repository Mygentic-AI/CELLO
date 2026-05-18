/**
 * CheckpointStatusProvider — interface for querying MMR checkpoint visibility
 * for a sealed session (PERSIST-017).
 *
 * Implemented by MmrStore in @cello/directory.
 * Consumed by adapter-claude-code/src/server.ts (createMcpServer) to surface
 * checkpoint_status in cello_close_session, cello_get_sealed_receipt, and
 * cello_get_inclusion_proof without importing @cello/directory directly.
 *
 * The adapter-claude-code package may not import @cello/directory per the
 * CONTEXT.md dependency rule: "adapter-* → client → transport, crypto, protocol-types.
 * No adapter imports from directory or relay."
 */

/**
 * Checkpoint visibility status for a sealed session's staged_root.
 *
 * 'pending'    — sealed_root is in conversation_seal_staging, no checkpoint yet
 * 'confirmed'  — sealed_root has been committed to a confirmed checkpoint
 * 'not_staged' — session has no staging row (never sealed or staging was corrupted)
 */
export type SealStagingStatus =
  | { status: "pending"; staged_at: number }          // staged_at: Unix epoch milliseconds
  | { status: "confirmed"; leaf_index: number; checkpoint_peak_hash: string; checkpoint_id: string; sibling_hashes: string[] }
  | { status: "not_staged" };

export interface CheckpointStatusProvider {
  /**
   * Return the checkpoint visibility status for a session's sealed_root.
   *
   * @param sessionId - Session ID hex string
   */
  getSealStagingStatus(sessionId: string): Promise<SealStagingStatus>;
}
