/**
 * CELLO-PERSIST-007 — MmrStore: Postgres-backed MMR operations.
 *
 * This class implements the Merkle Mountain Range (MMR) append, checkpoint, and
 * proof logic backed by the PostgreSQL tables:
 *   - conversation_proof_leaves    — one row per sealed conversation (append-only)
 *   - conversation_proof_mmr_nodes — internal MMR nodes (append-only)
 *   - directory_checkpoints        — confirmed checkpoints (append-only)
 *   - conversation_seal_staging    — staging (mutable; cleared per checkpoint)
 *
 * Used only from the composition root (bin/directory.ts) and tests. Not exported
 * from @cello/directory's public index.
 *
 * Observability events emitted:
 *   mmr.leaf.appended      — INFO   { sessionId, leafIndex, leafHash, correlationId }
 *   mmr.checkpoint.confirmed — INFO { checkpointId, leafCount, peakHash, stagedSealCount }
 *   mmr.checkpoint.incomplete — ERROR { checkpointId, stagedSealCount }
 *   mmr.proof.unavailable  — WARN  { sessionId, leafIndex }
 */

import pg from "pg";
import { randomUUID, createHash } from "node:crypto";
import type { Logger } from "@cello/interfaces";
import {
  appendLeafToMmr,
  computeInclusionProof,
  PROOF_NOT_YET_AVAILABLE,
  type MmrPeak,
  type ProofResult,
} from "./mmr.js";
import {
  computeChainHash,
  serializeRecord,
  verifyChain,
  CHAIN_GENESIS,
  type ChainVerificationResult,
} from "./hash-chain.js";

export class MmrStore {
  readonly #pool: pg.Pool;
  readonly #logger: Logger;

  constructor(pool: pg.Pool, logger: Logger) {
    this.#pool = pool;
    this.#logger = logger;
  }

  /**
   * Append a new seal to the MMR.
   *
   * Steps:
   *   1. Fetch current leaf count from conversation_proof_leaves (new leaf_index = count).
   *   2. Fetch current peaks from conversation_proof_mmr_nodes.
   *   3. Compute the new leaf and any new internal nodes via appendLeafToMmr().
   *   4. Insert the new leaf into conversation_proof_leaves with chain_hash.
   *   5. Insert any new internal nodes into conversation_proof_mmr_nodes with chain_hash.
   *   6. Insert a row into conversation_seal_staging.
   *   7. Log mmr.leaf.appended at INFO.
   *
   * SI-002: leaf_hash is computed from sealMerkleRoot here — never from caller input.
   * AC-002: uses advisory lock to prevent concurrent appends from forking the chain.
   *
   * @param sessionId - UUID of the session/conversation being sealed
   * @param sealMerkleRoot - The sealed conversation root hash (hex, 64 chars)
   * @param correlationId - Optional correlation ID for the async flow
   */
  async appendSeal(
    sessionId: string,
    sealMerkleRoot: string,
    correlationId?: string,
  ): Promise<{ leafIndex: number; leafHash: string }> {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");

      // Advisory lock: prevent concurrent MMR appends from forking the chain.
      // hashtext('mmr_append') gives a stable int4 lock key.
      //
      // Note on lock granularity: a single lock key covers both conversation_proof_leaves
      // and conversation_proof_mmr_nodes, departing from the per-table convention in
      // PERSIST-004. This is intentional: appending a leaf and its derived internal nodes
      // must be atomic — two concurrent appends that each hold their own table lock would
      // still interleave and fork the MMR. One lock key covering both tables is the correct
      // scope for this operation.
      await client.query("SELECT pg_advisory_xact_lock(hashtext('mmr_append'))");

      // Step 1: Get current leaf count (this becomes the new leaf_index)
      const countRes = await client.query<{ count: string }>(
        "SELECT COUNT(*) AS count FROM conversation_proof_leaves",
      );
      const leafIndex = parseInt(countRes.rows[0]!.count, 10);

      // Step 2: Fetch current peaks (rightmost internal nodes at each height level)
      const currentPeaks = await this.#fetchCurrentPeaks(client);

      // Step 3: Compute new leaf and nodes
      const recordedAt = new Date().toISOString();
      const result = appendLeafToMmr(leafIndex, sealMerkleRoot, recordedAt, currentPeaks);

      // Step 4: Insert the new leaf with chain_hash
      const leafRecord: Record<string, unknown> = {
        leaf_index: result.newLeaf.leaf_index,
        mmr_position: result.newLeaf.mmr_position,
        seal_merkle_root: sealMerkleRoot,
        leaf_hash: result.newLeaf.leaf_hash,
        session_id: sessionId,
        recorded_at: recordedAt,
      };

      const prevLeafHashRow = await client.query<{ chain_hash: string }>(
        "SELECT chain_hash FROM conversation_proof_leaves ORDER BY id DESC LIMIT 1",
      );
      const prevLeafHash = prevLeafHashRow.rows[0]?.chain_hash ?? CHAIN_GENESIS;
      const leafChainHash = computeChainHash(serializeRecord(leafRecord), prevLeafHash);

      await client.query(
        `INSERT INTO conversation_proof_leaves
           (leaf_index, mmr_position, seal_merkle_root, leaf_hash, session_id, recorded_at, chain_hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          result.newLeaf.leaf_index,
          result.newLeaf.mmr_position,
          sealMerkleRoot,
          result.newLeaf.leaf_hash,
          sessionId,
          recordedAt,
          leafChainHash,
        ],
      );

      // Step 5: Insert any new internal nodes with chain_hash
      for (const node of result.newNodes) {
        const nodeRecord: Record<string, unknown> = {
          mmr_position: node.mmr_position,
          hash: node.hash,
          height: node.height,
        };

        const prevNodeHashRow = await client.query<{ chain_hash: string }>(
          "SELECT chain_hash FROM conversation_proof_mmr_nodes ORDER BY id DESC LIMIT 1",
        );
        const prevNodeHash = prevNodeHashRow.rows[0]?.chain_hash ?? CHAIN_GENESIS;
        const nodeChainHash = computeChainHash(serializeRecord(nodeRecord), prevNodeHash);

        await client.query(
          `INSERT INTO conversation_proof_mmr_nodes (mmr_position, hash, height, chain_hash)
           VALUES ($1, $2, $3, $4)`,
          [node.mmr_position, node.hash, node.height, nodeChainHash],
        );
      }

      // Step 6: Insert into staging (no checkpoint_id yet)
      await client.query(
        `INSERT INTO conversation_seal_staging (session_id, seal_merkle_root, recorded_at)
         VALUES ($1, $2, $3)
         ON CONFLICT (session_id) DO NOTHING`,
        [sessionId, sealMerkleRoot, recordedAt],
      );

      await client.query("COMMIT");

      // Step 7: Log mmr.leaf.appended at INFO
      this.#logger.info("mmr.leaf.appended", {
        sessionId,
        leafIndex,
        leafHash: result.newLeaf.leaf_hash,
        correlationId: correlationId ?? null,
      });

      return { leafIndex, leafHash: result.newLeaf.leaf_hash };
    } catch (err) {
      await client.query("ROLLBACK").catch(() => { /* ignore rollback errors */ });
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Initiate a checkpoint: atomically stamp all un-checkpointed staging rows
   * with the new checkpoint_id. Returns the checkpoint_id.
   *
   * AC-005: Only rows without a checkpoint_id at initiation time are included.
   * SI-003: The checkpoint_id assignment is done in a single UPDATE within a transaction.
   */
  async initiateCheckpoint(): Promise<string> {
    const checkpointId = randomUUID();
    await this.#pool.query(
      `UPDATE conversation_seal_staging
       SET checkpoint_id = $1
       WHERE checkpoint_id IS NULL`,
      [checkpointId],
    );
    return checkpointId;
  }

  /**
   * Confirm a checkpoint:
   *   1. Fetch all staging rows with this checkpoint_id.
   *   2. Compute the current MMR peak hash.
   *   3. Insert a row into directory_checkpoints.
   *   4. Update conversation_proof_leaves.checkpoint_id for included leaves.
   *   5. Delete staged rows with this checkpoint_id.
   *   6. Log mmr.checkpoint.confirmed at INFO.
   *
   * DB-001: Idempotent — if the checkpoint row already exists, returns its peak_hash.
   *
   * @param checkpointId - The checkpoint_id returned by initiateCheckpoint()
   */
  async confirmCheckpoint(checkpointId: string): Promise<string> {
    // Check if checkpoint already exists (idempotent re-run for DB-001)
    const existing = await this.#pool.query<{ peak_hash: string }>(
      "SELECT peak_hash FROM directory_checkpoints WHERE checkpoint_id = $1",
      [checkpointId],
    );
    if (existing.rows.length > 0) {
      return existing.rows[0]!.peak_hash;
    }

    // Fetch staging rows for this checkpoint before opening the transaction
    const stagingRes = await this.#pool.query<{ session_id: string; seal_merkle_root: string; recorded_at: Date }>(
      "SELECT session_id, seal_merkle_root, recorded_at FROM conversation_seal_staging WHERE checkpoint_id = $1",
      [checkpointId],
    );
    const stagedSealCount = stagingRes.rows.length;

    // Get total leaf count
    const leafCountRes = await this.#pool.query<{ count: string }>(
      "SELECT COUNT(*) AS count FROM conversation_proof_leaves",
    );
    const leafCount = parseInt(leafCountRes.rows[0]!.count, 10);

    // Get current MMR peaks and compute peak hash
    const peaks = await this.#fetchCurrentPeaksFromPool();
    const peakHash = this.#computePeakHash(peaks);

    // Build the checkpoint row chain_hash before the transaction
    const checkpointRecord: Record<string, unknown> = {
      checkpoint_id: checkpointId,
      mmr_leaf_count: leafCount,
      peak_hash: peakHash,
      staged_seal_count: stagedSealCount,
    };

    const prevCheckpointHashRow = await this.#pool.query<{ chain_hash: string }>(
      "SELECT chain_hash FROM directory_checkpoints ORDER BY id DESC LIMIT 1",
    );
    const prevCheckpointHash = prevCheckpointHashRow.rows[0]?.chain_hash ?? CHAIN_GENESIS;
    const checkpointChainHash = computeChainHash(serializeRecord(checkpointRecord), prevCheckpointHash);

    // Atomically: INSERT checkpoint row + INSERT leaf→checkpoint associations + DELETE staging rows.
    // Wrapping all three in a single explicit transaction prevents orphaned staging rows if a crash
    // occurs between the INSERT and the DELETE (DB-001 idempotency depends on this atomicity).
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");

      await client.query(
        `INSERT INTO directory_checkpoints
           (checkpoint_id, mmr_leaf_count, peak_hash, staged_seal_count, chain_hash)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (checkpoint_id) DO NOTHING`,
        [checkpointId, leafCount, peakHash, stagedSealCount, checkpointChainHash],
      );

      // Insert into the checkpoint association join table for each leaf in this checkpoint.
      // conversation_proof_leaves is append-only (RLS: INSERT + SELECT only — no UPDATE).
      // Checkpoint association is recorded in conversation_proof_leaf_checkpoints instead,
      // which satisfies SI-003: each leaf can appear in at most one checkpoint (UNIQUE on leaf_id).
      const sessionIds = stagingRes.rows.map((r) => r.session_id);
      if (sessionIds.length > 0) {
        await client.query(
          `INSERT INTO conversation_proof_leaf_checkpoints (leaf_id, checkpoint_id)
           SELECT l.id, $1
           FROM conversation_proof_leaves l
           WHERE l.session_id = ANY($2)
           ON CONFLICT (leaf_id) DO NOTHING`,
          [checkpointId, sessionIds],
        );
      }

      // Delete staging rows for this checkpoint
      await client.query(
        "DELETE FROM conversation_seal_staging WHERE checkpoint_id = $1",
        [checkpointId],
      );

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => { /* ignore rollback errors */ });
      throw err;
    } finally {
      client.release();
    }

    // Log mmr.checkpoint.confirmed
    this.#logger.info("mmr.checkpoint.confirmed", {
      checkpointId,
      leafCount,
      peakHash,
      stagedSealCount,
    });

    return peakHash;
  }

  /**
   * Get an inclusion proof for a session's sealed conversation.
   *
   * SI-001: Returns PROOF_NOT_YET_AVAILABLE if the leaf has not been committed to a checkpoint.
   * The leaf is considered committed only when its session_id appears in the staging table
   * with a checkpoint_id that has a corresponding row in directory_checkpoints.
   */
  async getInclusionProof(sessionId: string, logger: Logger): Promise<ProofResult> {
    // Find the leaf for this session
    const leafRes = await this.#pool.query<{
      leaf_index: number;
      mmr_position: number;
      leaf_hash: string;
      seal_merkle_root: string;
      recorded_at: Date;
    }>(
      "SELECT leaf_index, mmr_position, leaf_hash, seal_merkle_root, recorded_at FROM conversation_proof_leaves WHERE session_id = $1",
      [sessionId],
    );

    if (leafRes.rows.length === 0) {
      logger.warn("mmr.proof.unavailable", { sessionId, leafIndex: -1 });
      return PROOF_NOT_YET_AVAILABLE;
    }

    const leafRow = leafRes.rows[0]!;
    const leafIndex = leafRow.leaf_index;

    // Check if this session has been checkpointed via the join table.
    // A leaf is committed to a checkpoint when a row exists in conversation_proof_leaf_checkpoints
    // linking the leaf's id to a confirmed checkpoint_id in directory_checkpoints.
    const checkpointRes = await this.#pool.query<{
      checkpoint_id: string;
      peak_hash: string;
      mmr_leaf_count: number;
    }>(
      `SELECT dc.checkpoint_id, dc.peak_hash, dc.mmr_leaf_count
       FROM conversation_proof_leaves l
       JOIN conversation_proof_leaf_checkpoints lc ON lc.leaf_id = l.id
       JOIN directory_checkpoints dc ON dc.checkpoint_id = lc.checkpoint_id
       WHERE l.session_id = $1
       LIMIT 1`,
      [sessionId],
    );

    if (checkpointRes.rows.length === 0) {
      // No checkpoint covers this leaf yet — still in staging
      logger.warn("mmr.proof.unavailable", { sessionId, leafIndex });
      return PROOF_NOT_YET_AVAILABLE;
    }

    const checkpoint = checkpointRes.rows[0]!;

    // Fetch only the leaves and nodes that existed at checkpoint time.
    // Using checkpoint.mmr_leaf_count ensures the proof is anchored to the checkpoint state,
    // not the current (potentially larger) MMR state.
    const allLeaves = await this.#pool.query<{
      leaf_index: number;
      mmr_position: number;
      leaf_hash: string;
      seal_merkle_root: string;
      recorded_at: Date;
    }>(
      "SELECT leaf_index, mmr_position, leaf_hash, seal_merkle_root, recorded_at FROM conversation_proof_leaves WHERE leaf_index < $1 ORDER BY leaf_index ASC",
      [checkpoint.mmr_leaf_count],
    );

    const allNodes = await this.#pool.query<{
      mmr_position: number;
      hash: string;
      height: number;
    }>(
      `SELECT n.mmr_position, n.hash, n.height
       FROM conversation_proof_mmr_nodes n
       WHERE n.mmr_position <= (
         SELECT MAX(mmr_position) FROM conversation_proof_leaves WHERE leaf_index < $1
       )
       ORDER BY n.mmr_position ASC`,
      [checkpoint.mmr_leaf_count],
    );

    const leaves = allLeaves.rows.map((r) => ({
      leaf_index: r.leaf_index,
      mmr_position: r.mmr_position,
      leaf_hash: r.leaf_hash,
      seal_merkle_root: r.seal_merkle_root,
      recorded_at: r.recorded_at.toISOString(),
      // Only set checkpoint_id on the target leaf; others are not part of this proof
      checkpoint_id: r.leaf_index === leafIndex ? checkpoint.checkpoint_id : null,
    }));

    const nodes = allNodes.rows.map((r) => ({
      mmr_position: r.mmr_position,
      hash: r.hash,
      height: r.height,
    }));

    // Reconstruct peaks from the checkpoint-time MMR state (mmr_leaf_count leaves).
    // Using current state would produce wrong peaks if new leaves were appended after
    // this checkpoint was confirmed.
    const peaks = await this.#fetchPeaksAtLeafCount(checkpoint.mmr_leaf_count);

    return computeInclusionProof(
      leafIndex,
      leaves,
      nodes,
      peaks,
      checkpoint.peak_hash,
      logger,
      sessionId,
    );
  }

  /**
   * Detect incomplete checkpoints: staging rows with a checkpoint_id that has no
   * corresponding row in directory_checkpoints. These indicate a crash mid-way
   * through confirmCheckpoint.
   *
   * DB-001: On startup, call this method and re-run confirmCheckpoint for each orphaned ID.
   */
  async detectIncompleteCheckpoints(logger: Logger): Promise<string[]> {
    const res = await this.#pool.query<{ checkpoint_id: string; staged_count: string }>(
      `SELECT s.checkpoint_id, COUNT(*) AS staged_count
       FROM conversation_seal_staging s
       WHERE s.checkpoint_id IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM directory_checkpoints c WHERE c.checkpoint_id = s.checkpoint_id
         )
       GROUP BY s.checkpoint_id`,
    );

    const orphanedIds = res.rows.map((r) => r.checkpoint_id);

    for (const row of res.rows) {
      logger.error("mmr.checkpoint.incomplete", {
        checkpointId: row.checkpoint_id,
        stagedSealCount: parseInt(row.staged_count, 10),
      });
    }

    return orphanedIds;
  }

  /**
   * Verify the hash chain for conversation_proof_leaves.
   * AC-007: Used to confirm MMR construction doesn't produce chain breaks.
   */
  async verifyLeavesChain(): Promise<ChainVerificationResult> {
    const res = await this.#pool.query<Record<string, unknown>>(
      "SELECT * FROM conversation_proof_leaves ORDER BY id ASC",
    );
    return verifyChain(res.rows, this.#logger, "conversation_proof_leaves");
  }

  /**
   * Verify the hash chain for conversation_proof_mmr_nodes.
   * AC-007: Used to confirm MMR construction doesn't produce chain breaks.
   */
  async verifyNodesChain(): Promise<ChainVerificationResult> {
    const res = await this.#pool.query<Record<string, unknown>>(
      "SELECT * FROM conversation_proof_mmr_nodes ORDER BY id ASC",
    );
    return verifyChain(res.rows, this.#logger, "conversation_proof_mmr_nodes");
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  /**
   * Fetch the current MMR peaks from the database.
   *
   * The current peaks are the topmost nodes in each sub-tree of the MMR.
   * We reconstruct them by taking all nodes and leaves, rebuilding the peak set.
   *
   * Pseudocode:
   *   1. Load all leaves (ordered by leaf_index) — they are height-0 peaks initially.
   *   2. Load all internal nodes (ordered by mmr_position).
   *   3. Apply the MMR merge algorithm to reconstruct the peak set.
   */
  async #fetchCurrentPeaksFromPool(): Promise<MmrPeak[]> {
    const client = await this.#pool.connect();
    try {
      return this.#fetchCurrentPeaks(client);
    } finally {
      client.release();
    }
  }

  /**
   * Reconstruct the MMR peak set as it was when exactly `leafCount` leaves had been appended.
   * Used by getInclusionProof to anchor proofs to checkpoint state rather than current state.
   */
  async #fetchPeaksAtLeafCount(leafCount: number): Promise<MmrPeak[]> {
    const leavesRes = await this.#pool.query<{
      leaf_index: number;
      leaf_hash: string;
      seal_merkle_root: string;
      recorded_at: Date;
    }>(
      "SELECT leaf_index, leaf_hash, seal_merkle_root, recorded_at FROM conversation_proof_leaves WHERE leaf_index < $1 ORDER BY leaf_index ASC",
      [leafCount],
    );

    let peaks: MmrPeak[] = [];
    for (const leaf of leavesRes.rows) {
      const r = appendLeafToMmr(
        leaf.leaf_index,
        leaf.seal_merkle_root,
        leaf.recorded_at.toISOString(),
        peaks,
      );
      peaks = r.newPeaks;
    }

    return peaks;
  }

  async #fetchCurrentPeaks(client: pg.PoolClient): Promise<MmrPeak[]> {
    // Rebuild peaks from scratch: apply the same append algorithm on stored leaf data.
    const leavesRes = await client.query<{
      leaf_index: number;
      leaf_hash: string;
      seal_merkle_root: string;
      recorded_at: Date;
    }>(
      "SELECT leaf_index, leaf_hash, seal_merkle_root, recorded_at FROM conversation_proof_leaves ORDER BY leaf_index ASC",
    );

    let peaks: MmrPeak[] = [];
    for (const leaf of leavesRes.rows) {
      const r = appendLeafToMmr(
        leaf.leaf_index,
        leaf.seal_merkle_root,
        leaf.recorded_at.toISOString(),
        peaks,
      );
      peaks = r.newPeaks;
    }

    return peaks;
  }

  /**
   * Compute a canonical peak hash from the current set of peaks.
   * This is the commitment value stored in directory_checkpoints.
   * Formula: SHA-256(peak1_hash || peak2_hash || ... || peakN_hash)
   * (all peak hashes concatenated left-to-right, then hashed)
   */
  #computePeakHash(peaks: MmrPeak[]): string {
    if (peaks.length === 0) return "0".repeat(64);
    if (peaks.length === 1) return peaks[0]!.hash;

    const hasher = createHash("sha256");
    for (const peak of peaks) {
      hasher.update(peak.hash);
    }
    return hasher.digest("hex");
  }
}
