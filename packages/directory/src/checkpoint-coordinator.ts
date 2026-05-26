/**
 * CELLO-FEDERATION-002 — CheckpointCoordinator and deterministic batch sort.
 *
 * This module provides:
 *   1. sortSealBatch(batch) — deterministic sort for MMR batch construction
 *      (recorded_at ASC, conversation_id ASC). AC-004, SI-003.
 *   2. CheckpointCoordinator — timer-based checkpoint orchestration with
 *      2-of-3 threshold enforcement and coordinator failover detection.
 *
 * Observability events (M4+ taxonomy):
 *   federation.checkpoint.round.initiated   INFO  { checkpointId, coordinatorNodeId, batchSize, correlationId }
 *   federation.checkpoint.confirmed         INFO  { checkpointId, mmrLeafCount, signingNodes, durationMs, correlationId }
 *   federation.checkpoint.signature.received INFO  { checkpointId, signingNodeId, correlationId }
 *   federation.checkpoint.skipped           WARN  { checkpointId, availableNodes, requiredThreshold, correlationId }
 *   federation.checkpoint.proposal.hash_mismatch ERROR { nodeId, checkpointId, expectedHash, receivedHash }
 *   federation.checkpoint.gap               ERROR { lastCheckpointId, lastCheckpointAt, gapMinutes }
 *
 * References: FIPS 180-4 (SHA-256), RFC 8032 (Ed25519 — for node signature verification).
 */

import { randomUUID } from "node:crypto";
import type { Logger, DirectoryStore } from "@cello-protocol/interfaces";
// buildCheckpointTbs: static import — both coordinator and verifier use the same function (AC-010-canonical-tbs)
import { computeCheckpointHash, buildCheckpointTbs, verify, type KeyProvider } from "@cello-protocol/crypto";
import type { ICheckpointTransport, CheckpointSignatureResponse } from "@cello-protocol/interfaces";
import type { MmrStore } from "./mmr-store.js";

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * A row from conversation_seal_staging to be included in the next batch.
 * Returned by PgDirectoryStore.getStagingRowsForBatch().
 */
export interface SealBatchRow {
  /** The staging row's unique identifier (UUID or BIGSERIAL as string). */
  stagingId: string;
  /** The conversation (session) UUID — used as the tiebreaker in the sort. */
  conversationId: string;
  /** The timestamp at which the seal was staged — primary sort key. */
  recordedAt: Date;
}

// Re-export from interfaces so callers can import from either location.
export type { ICheckpointTransport, CheckpointSignatureResponse, CheckpointProposal } from "@cello-protocol/interfaces";

/**
 * Configuration for CheckpointCoordinator.
 */
export interface CheckpointCoordinatorConfig {
  /** This node's node_id — used to determine coordinator role. */
  nodeId: string;
  /** Interval between checkpoint rounds (milliseconds, default 10 minutes). */
  checkpointIntervalMs?: number;
  /** Round timeout for collecting signatures (milliseconds, default 30 seconds). */
  roundTimeoutMs?: number;
  /** Coordinator failover detection window (milliseconds, default checkpointInterval + 60s). */
  failoverDetectionMs?: number;
  /** Gap alarm threshold (minutes, default 30 — from CHECKPOINT_GAP_ALARM_MINUTES env). */
  checkpointGapAlarmMinutes?: number;
  /** Required threshold for a checkpoint to be confirmed (default 2). */
  requiredThreshold?: number;
}

// CheckpointSignatureWithKey: the base CheckpointSignatureResponse now carries publicKeyHex.
// This alias preserves backward compatibility for existing tests.
export type CheckpointSignatureWithKey = CheckpointSignatureResponse;

// ─── Batch sort ───────────────────────────────────────────────────────────────

/**
 * Sort a seal batch deterministically for MMR construction.
 *
 * Sort order (SI-003): recorded_at ASC, then conversation_id ASC (UUID string comparison).
 * This is the ONLY permitted ordering for batch construction — any deviation produces
 * a different checkpoint_hash that honest nodes will not sign.
 *
 * Pseudocode (FIPS 180-4):
 *   1. Sort batch by recordedAt ascending (epoch milliseconds).
 *   2. For rows with identical recordedAt, sort by conversationId ascending (lexicographic UUID).
 *   3. Return the sorted array (does NOT mutate the input).
 *
 * @param batch - Seal batch rows from conversation_seal_staging.
 * @returns A new array with rows sorted by (recorded_at ASC, conversation_id ASC).
 */
export function sortSealBatch(batch: readonly SealBatchRow[]): SealBatchRow[] {
  return [...batch].sort((a, b) => {
    // Primary: recorded_at ascending
    const timeDiff = a.recordedAt.getTime() - b.recordedAt.getTime();
    if (timeDiff !== 0) return timeDiff;
    // Tiebreaker: conversation_id UUID ascending (lexicographic string comparison)
    if (a.conversationId < b.conversationId) return -1;
    if (a.conversationId > b.conversationId) return 1;
    return 0;
  });
}

// ─── CheckpointCoordinator ────────────────────────────────────────────────────

/**
 * CheckpointCoordinator orchestrates the 10-minute checkpoint cross-signing protocol.
 *
 * Pseudocode for the coordinator path (AC-001, AC-002, AC-003):
 *   1. Timer fires every checkpointIntervalMs.
 *   2. Check if this node is the coordinator: node_id must be the lowest available node_id
 *      among reachable peers (deterministic, no election needed).
 *   3. Get the seal batch: getStagingRowsForBatch() — excludes already-committed staging IDs
 *      (AC-008-crash-mid-clear).
 *   4. Sort the batch deterministically: sortSealBatch(batch) — recorded_at ASC, conversation_id ASC (SI-003).
 *   5. Compute MMR peaks from the sorted batch using the existing MmrStore state.
 *   6. Compute checkpoint_hash: computeCheckpointHash(mmrPeaks, identityMerkleRoot, checkpointId)
 *      where computeCheckpointHash is imported from @cello-protocol/crypto (AC-010-canonical-tbs).
 *   7. Broadcast the proposal to all peer nodes via ICheckpointTransport.
 *   8. Collect signatures within roundTimeoutMs (30 seconds).
 *   9. If < requiredThreshold (2) valid signatures: log federation.checkpoint.skipped at WARN.
 *      Do NOT clear staging. Do NOT write directory_checkpoints row.
 *  10. If >= requiredThreshold valid signatures:
 *       a. Write directory_checkpoints row via PgDirectoryStore.writeCheckpoint().
 *       b. Write checkpoint_node_signatures rows via PgDirectoryStore.writeCheckpointSignature().
 *       c. Clear staging batch via PgDirectoryStore.clearStagingBatch(stagingIds).
 *       d. Log federation.checkpoint.confirmed at INFO.
 *
 * Pseudocode for coordinator failover (AC-005):
 *   1. Non-coordinator nodes observe directory_checkpoints (replicated via logical replication).
 *   2. If no new row appears within checkpointIntervalMs + 60s from the last confirmed checkpoint:
 *      the node with the next-lowest available node_id assumes coordinator role.
 *   3. Detection: read getLastCheckpointAt() — if elapsed > failoverDetectionMs, initiate a round.
 *
 * Pseudocode for gap alarm (AC-009):
 *   1. On each timer tick (or dedicated gap-check timer), call getLastCheckpointAt().
 *   2. If elapsed > gapAlarmThresholdMs: log federation.checkpoint.gap at ERROR.
 *      The ops-critical alarm fires on this event.
 */
export class CheckpointCoordinator {
  readonly #nodeId: string;
  readonly #store: DirectoryStore;
  readonly #mmrStore: MmrStore;
  readonly #transport: ICheckpointTransport;
  readonly #logger: Logger;
  readonly #keyProvider: KeyProvider;
  readonly #checkpointIntervalMs: number;
  readonly #roundTimeoutMs: number;
  readonly #failoverDetectionMs: number;
  readonly #checkpointGapAlarmMinutes: number;
  readonly #requiredThreshold: number;

  /** Default checkpoint interval: 10 minutes. */
  static readonly DEFAULT_CHECKPOINT_INTERVAL_MS = 10 * 60 * 1000;
  /** Default round timeout: 30 seconds. */
  static readonly DEFAULT_ROUND_TIMEOUT_MS = 30 * 1000;
  /** Default checkpoint gap alarm: 30 minutes (CHECKPOINT_GAP_ALARM_MINUTES default). */
  static readonly DEFAULT_GAP_ALARM_MINUTES = 30;
  /** Default required threshold: 2-of-3. */
  static readonly DEFAULT_REQUIRED_THRESHOLD = 2;

  #intervalHandle: ReturnType<typeof setInterval> | null = null;
  #gapAlarmHandle: ReturnType<typeof setInterval> | null = null;
  #running = false;

  constructor(
    store: DirectoryStore,
    mmrStore: MmrStore,
    transport: ICheckpointTransport,
    keyProvider: KeyProvider,
    logger: Logger,
    config: CheckpointCoordinatorConfig,
  ) {
    this.#nodeId = config.nodeId;
    this.#store = store;
    this.#mmrStore = mmrStore;
    this.#transport = transport;
    this.#keyProvider = keyProvider;
    this.#logger = logger;
    this.#checkpointIntervalMs = config.checkpointIntervalMs ?? CheckpointCoordinator.DEFAULT_CHECKPOINT_INTERVAL_MS;
    this.#roundTimeoutMs = config.roundTimeoutMs ?? CheckpointCoordinator.DEFAULT_ROUND_TIMEOUT_MS;
    this.#checkpointGapAlarmMinutes = config.checkpointGapAlarmMinutes
      ?? Number(process.env["CHECKPOINT_GAP_ALARM_MINUTES"] ?? CheckpointCoordinator.DEFAULT_GAP_ALARM_MINUTES);
    this.#requiredThreshold = config.requiredThreshold ?? CheckpointCoordinator.DEFAULT_REQUIRED_THRESHOLD;
    // Failover detection window: checkpoint_interval + 60s
    this.#failoverDetectionMs = config.failoverDetectionMs ?? (this.#checkpointIntervalMs + 60 * 1000);
  }

  /**
   * Start the checkpoint timer and gap alarm.
   *
   * The checkpoint timer fires every checkpointIntervalMs.
   * The gap alarm checks once per minute.
   */
  start(): void {
    if (this.#running) return;
    this.#running = true;
    this.#intervalHandle = setInterval(() => void this.#onTimer(), this.#checkpointIntervalMs);
    // Gap alarm: check every minute
    this.#gapAlarmHandle = setInterval(() => void this.#checkGap(), 60 * 1000);
  }

  /**
   * Explicitly check whether the checkpoint gap alarm threshold has been exceeded.
   *
   * Exposed as a public method so operator tooling and integration tests can trigger
   * the gap-alarm check without waiting for the 60-second poll interval.
   * Production code uses the internal setInterval; this method is the same code path.
   */
  async checkGapNow(): Promise<void> {
    return this.#checkGap();
  }

  /** Stop the checkpoint timer and gap alarm. */
  stop(): void {
    if (!this.#running) return;
    this.#running = false;
    if (this.#intervalHandle !== null) {
      clearInterval(this.#intervalHandle);
      this.#intervalHandle = null;
    }
    if (this.#gapAlarmHandle !== null) {
      clearInterval(this.#gapAlarmHandle);
      this.#gapAlarmHandle = null;
    }
  }

  /**
   * Run a single checkpoint round (called by the timer or triggered manually for testing).
   *
   * If this node is not the coordinator (and the coordinator is alive), this is a no-op.
   * If this node is not the coordinator but the coordinator is absent (failover), this
   * method initiates the round as the new coordinator.
   *
   * @returns checkpointId if a checkpoint was confirmed, null if skipped.
   */
  async runRound(): Promise<string | null> {
    const correlationId = randomUUID();

    // Determine if this node should act as coordinator for this round.
    const peerNodeIds = await this.#transport.getPeerNodeIds();
    const allNodes = [...peerNodeIds, this.#nodeId].sort();

    // Check if the expected coordinator (lowest node_id) has recently produced a checkpoint.
    const lastCheckpointAt = await this.#store.getLastCheckpointAt();
    const now = Date.now();
    const elapsedMs = lastCheckpointAt !== null
      ? now - new Date(lastCheckpointAt).getTime()
      : Infinity;

    // Determine the coordinator node_id for this round:
    // - Primary: the lowest node_id in allNodes
    // - Failover: if no checkpoint in failoverDetectionMs, the next-lowest available node takes over
    let coordinatorNodeId: string;
    if (elapsedMs <= this.#failoverDetectionMs) {
      // Coordinator is active — use the lowest node_id
      coordinatorNodeId = allNodes[0]!;
    } else {
      // Coordinator appears absent — the next-lowest available node assumes coordinator role
      // "available" = in peerNodeIds (reachable) — the primary coordinator is not responding
      const primaryCoordinator = allNodes[0];
      if (this.#nodeId === primaryCoordinator) {
        // This node IS the primary coordinator — just run normally
        coordinatorNodeId = this.#nodeId;
      } else {
        // Primary coordinator absent — failover to next-lowest available
        const availableNodes = peerNodeIds.filter((id) => id !== primaryCoordinator);
        availableNodes.push(this.#nodeId);
        availableNodes.sort();
        coordinatorNodeId = availableNodes[0]!;
      }
    }

    // Only proceed if this node is the coordinator for this round
    if (coordinatorNodeId !== this.#nodeId) {
      return null; // Not our turn
    }

    return this.#runCoordinatorRound(correlationId, peerNodeIds);
  }

  /**
   * Verify a checkpoint proposal from the coordinator (called on non-coordinator nodes).
   *
   * Pseudocode (AC-006):
   *   1. Recompute the checkpoint hash from local MMR state using buildCheckpointTbs (AC-010-canonical-tbs).
   *   2. Compare with the received hash.
   *   3. If match: sign the checkpoint hash with this node's Ed25519 key and return the signature.
   *   4. If mismatch: log federation.checkpoint.proposal.hash_mismatch at ERROR and return null.
   *
   * @returns Ed25519 signature over the checkpoint hash bytes (hex-encoded), or null on mismatch.
   */
  async verifyAndSign(proposal: {
    checkpointId: string;
    checkpointHash: string;
    mmrPeaks: string[];
    identityMerkleRoot: string;
    mmrLeafCount: number;
  }): Promise<string | null> {
    // Step 1: Query local MMR state independently — never trust coordinator-supplied peaks.
    // A compromised coordinator could propose peaks that don't match the local chain.
    const localState = await this.#store.getCheckpointMmrState();

    // Step 2: Recompute hash from local state (AC-010-canonical-tbs).
    const localHash = computeCheckpointHash(
      localState.mmrPeaks,
      localState.identityMerkleRoot,
      proposal.checkpointId,
    );

    // Step 3: Compare against coordinator-supplied hash.
    if (localHash !== proposal.checkpointHash) {
      this.#logger.error("federation.checkpoint.proposal.hash_mismatch", {
        nodeId: this.#nodeId,
        checkpointId: proposal.checkpointId,
        expectedHash: localHash,
        receivedHash: proposal.checkpointHash,
      });
      return null;
    }

    // Step 4: Sign the checkpoint hash bytes (raw 32-byte Uint8Array, not hex string).
    // RFC 8032: Ed25519 signs the raw message bytes.
    // buildCheckpointTbs: static import from @cello-protocol/crypto (AC-010-canonical-tbs).
    const hashBytes = buildCheckpointTbs(
      localState.mmrPeaks,
      localState.identityMerkleRoot,
      proposal.checkpointId,
    );
    const sigBytes = await this.#keyProvider.sign(hashBytes);
    return Buffer.from(sigBytes).toString("hex");
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  /** Called by the interval timer. */
  async #onTimer(): Promise<void> {
    try {
      await this.runRound();
      await this.#checkGap();
    } catch (err) {
      // Log but do not rethrow — the interval must keep running
      const reason = err instanceof Error ? err.message : String(err);
      this.#logger.error("federation.checkpoint.round.error", {
        nodeId: this.#nodeId,
        reason,
      });
    }
  }

  /**
   * Run the coordinator protocol for this round.
   *
   * Pseudocode (AC-001, AC-002, AC-003, AC-008-crash-mid-clear):
   *   1. Get staging rows excluding already-committed ones (AC-008-crash-mid-clear).
   *   2. Sort the batch: sortSealBatch(batch) — SI-003.
   *   3. Read current MMR peaks.
   *   4. Compute checkpoint hash.
   *   5. Mint checkpointId.
   *   6. Log federation.checkpoint.round.initiated at INFO.
   *   7. Broadcast proposal to peers; await signatures within roundTimeoutMs.
   *      Include this node's own signature (coordinator signs too).
   *   8. Collect valid signatures (minimum requiredThreshold distinct node_ids).
   *      SI-001: same node_id twice does not count.
   *   9. If < threshold: log federation.checkpoint.skipped at WARN; return null.
   *  10. If >= threshold:
   *       a. writeCheckpoint(...)
   *       b. writeCheckpointSignature(...) for each signing node
   *       c. clearStagingBatch(stagingIds)
   *       d. log federation.checkpoint.confirmed at INFO
   *       e. return checkpointId
   */
  async #runCoordinatorRound(
    correlationId: string,
    peerNodeIds: string[],
  ): Promise<string | null> {
    const roundStartMs = Date.now();

    // Step 1: Get staging rows (AC-008-crash-mid-clear: excludes already-committed)
    const stagingRows = await this.#store.getStagingRowsForBatch();
    const batchSize = stagingRows.length;

    // Step 2: Sort deterministically (SI-003)
    const sortedBatch = sortSealBatch(
      stagingRows.map((r) => ({
        stagingId: r.stagingId,
        conversationId: r.sessionId,
        recordedAt: new Date(r.recordedAt),
      })),
    );
    const stagingIds = sortedBatch.map((r) => r.stagingId);

    // Step 3: Get current MMR peaks and identity merkle root
    const { mmrPeaks, identityMerkleRoot, mmrLeafCount } = await this.#store.getCheckpointMmrState();

    // Steps 4-5: Compute hash and mint checkpoint ID
    const checkpointId = randomUUID();
    const checkpointHash = computeCheckpointHash(mmrPeaks, identityMerkleRoot, checkpointId);

    // Step 6: Log round initiated
    this.#logger.info("federation.checkpoint.round.initiated", {
      checkpointId,
      coordinatorNodeId: this.#nodeId,
      batchSize,
      correlationId,
    });

    // Step 7: Collect signatures — coordinator signs too
    const signaturesCollected: Array<{ nodeId: string; signature: string }> = [];
    const seenNodeIds = new Set<string>();

    // Coordinator signs its own proposal first (RFC 8032)
    // buildCheckpointTbs is the static import from @cello-protocol/crypto (AC-010-canonical-tbs)
    const hashBytes = buildCheckpointTbs(mmrPeaks, identityMerkleRoot, checkpointId);
    const coordinatorSig = await this.#keyProvider.sign(hashBytes);
    const coordinatorSigHex = Buffer.from(coordinatorSig).toString("hex");
    signaturesCollected.push({ nodeId: this.#nodeId, signature: coordinatorSigHex });
    seenNodeIds.add(this.#nodeId);

    // Broadcast to peers and collect signatures
    const proposalPayload = {
      checkpointId,
      checkpointHash,
      mmrPeaks,
      identityMerkleRoot,
      mmrLeafCount,
    };

    await Promise.all(
      peerNodeIds.map(async (peerNodeId) => {
        if (seenNodeIds.has(peerNodeId)) return; // SI-001: skip duplicate node_id
        try {
          const response = await this.#transport.sendCheckpointProposal(
            peerNodeId,
            proposalPayload,
            this.#roundTimeoutMs,
          );
          if (response === null) return; // timeout or unreachable

          // Critical fix 1: response.nodeId must match the addressed peer.
          // Prevents a compromised transport from routing to peer A but returning nodeId=B,
          // consuming B's slot without B actually signing.
          if (response.nodeId !== peerNodeId) {
            this.#logger.warn("federation.checkpoint.signature.node_id_mismatch", {
              checkpointId,
              addressedPeer: peerNodeId,
              claimedNodeId: response.nodeId,
              correlationId,
            });
            return;
          }

          if (seenNodeIds.has(response.nodeId)) return; // SI-001: deduplicate

          // Critical fix 2: verify the signature using the peer's public key (RFC 8032).
          // A compromised peer can return any string as signature — without verification,
          // any response would be counted toward the 2-of-3 threshold.
          const responseWithKey = response as CheckpointSignatureResponse & { publicKeyHex?: string };
          if (!responseWithKey.publicKeyHex) {
            this.#logger.warn("federation.checkpoint.signature.missing_pubkey", {
              checkpointId,
              signingNodeId: response.nodeId,
              correlationId,
            });
            return;
          }
          const sigBytes = Buffer.from(response.signature, "hex");
          const pubKeyBytes = Buffer.from(responseWithKey.publicKeyHex, "hex");
          const isValid = verify(pubKeyBytes, hashBytes, sigBytes);
          if (!isValid) {
            this.#logger.warn("federation.checkpoint.signature.invalid", {
              checkpointId,
              signingNodeId: response.nodeId,
              correlationId,
            });
            return;
          }

          seenNodeIds.add(response.nodeId);
          signaturesCollected.push(response);
          this.#logger.info("federation.checkpoint.signature.received", {
            checkpointId,
            signingNodeId: response.nodeId,
            correlationId,
          });
        } catch {
          // Peer unreachable or returned error — skip for this round
        }
      }),
    );

    const availableNodes = signaturesCollected.length;

    // Step 9: Threshold check (SI-001)
    if (availableNodes < this.#requiredThreshold) {
      this.#logger.warn("federation.checkpoint.skipped", {
        checkpointId,
        availableNodes,
        requiredThreshold: this.#requiredThreshold,
        correlationId,
      });
      return null;
    }

    // Step 10: Confirmed — write checkpoint and signatures
    const durationMs = Date.now() - roundStartMs;

    // a. Write directory_checkpoints row
    await this.#store.writeCheckpoint({
      checkpointId,
      mmrPeaks,
      identityMerkleRoot,
      checkpointHash,
      mmrLeafCount,
      coordinatorNodeId: this.#nodeId,
    });

    // b. Write checkpoint_node_signatures rows
    for (const { nodeId, signature } of signaturesCollected) {
      await this.#store.writeCheckpointSignature({ checkpointId, nodeId, nodeSignature: signature });
    }

    // c. Clear staging batch (only the rows in this batch — AC-003)
    if (stagingIds.length > 0) {
      await this.#store.clearStagingBatch(stagingIds);
    }

    // d. Log confirmed
    this.#logger.info("federation.checkpoint.confirmed", {
      checkpointId,
      mmrLeafCount,
      signingNodes: signaturesCollected.map((s) => s.nodeId),
      durationMs,
      correlationId,
    });

    return checkpointId;
  }

  /** Check whether the checkpoint gap alarm threshold has been exceeded (AC-009). */
  async #checkGap(): Promise<void> {
    const lastCheckpointAt = await this.#store.getLastCheckpointAt();
    if (lastCheckpointAt === null) return;

    const now = Date.now();
    const gapMs = now - new Date(lastCheckpointAt).getTime();
    const gapMinutes = gapMs / (60 * 1000);

    if (gapMinutes >= this.#checkpointGapAlarmMinutes) {
      // Get last checkpoint ID for the alarm context
      const lastRow = await this.#store.getLastCheckpointRow();
      this.#logger.error("federation.checkpoint.gap", {
        lastCheckpointId: lastRow?.checkpointId ?? null,
        lastCheckpointAt,
        gapMinutes: Math.floor(gapMinutes),
      });
    }
  }
}
