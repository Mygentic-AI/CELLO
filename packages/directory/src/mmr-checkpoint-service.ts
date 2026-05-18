/**
 * CELLO-PERSIST-017 — MmrCheckpointService
 *
 * Provides:
 *   1. runCheckpoint()  — initiates + confirms a new MMR checkpoint for all staged seals
 *   2. checkOverdue()   — detects staged seals older than max_staging_age; returns their session IDs
 *   3. forceFlush()     — forces a checkpoint for specific staged sessions (called by overdue handler)
 *
 * Observability events emitted:
 *   mmr.checkpoint.overdue — WARN { sessionId, stagedAt, maxStagingAgeMs }
 *     correlationId: false — fires from scheduler context with no session correlationId in scope
 *
 * DB-001 (degraded behavior):
 *   The overdue detector is registered with JobScheduler in the directory composition root.
 *   It fires on the same cadence as the analytics job. When it fires, it calls forceFlush()
 *   for all staged sealed_roots older than max_staging_age. Agents polling
 *   cello_get_sealed_receipt will see checkpoint_status transition from 'pending' to
 *   'confirmed' within max_staging_age.
 *
 * Pseudocode:
 *   runCheckpoint():
 *     id = mmrStore.initiateCheckpoint()
 *     mmrStore.confirmCheckpoint(id)
 *
 *   checkOverdue():
 *     now = Date.now()
 *     rows = SELECT session_id, recorded_at FROM conversation_seal_staging
 *              WHERE checkpoint_id IS NULL
 *     for each row where (now - recorded_at.getTime()) > maxStagingAgeMs:
 *       logger.warn("mmr.checkpoint.overdue", { sessionId, stagedAt, maxStagingAgeMs })
 *     return overdueSessionIds
 *
 *   forceFlush(sessionIds):
 *     if sessionIds is empty: return
 *     id = mmrStore.initiateCheckpoint()
 *     mmrStore.confirmCheckpoint(id)
 *     // confirmCheckpoint handles the staging→checkpoint transition for ALL staged rows
 *     // (not just the overdue ones); forceFlush passes the full context to ensure
 *     // nothing is lost if additional rows were staged between checkOverdue and forceFlush.
 */

import type pg from "pg";
import type { Logger } from "@cello/interfaces";
import type { MmrStore } from "./mmr-store.js";

export class MmrCheckpointService {
  readonly #store: MmrStore;
  readonly #pool: pg.Pool;
  readonly #logger: Logger;
  readonly #maxStagingAgeMs: number;

  /** Default max_staging_age: 1 hour (3_600_000 ms). */
  static readonly DEFAULT_MAX_STAGING_AGE_MS = 60 * 60 * 1000;

  constructor(
    store: MmrStore,
    pool: pg.Pool,
    logger: Logger,
    maxStagingAgeMs: number = MmrCheckpointService.DEFAULT_MAX_STAGING_AGE_MS,
  ) {
    this.#store = store;
    this.#pool = pool;
    this.#logger = logger;
    this.#maxStagingAgeMs = maxStagingAgeMs;
  }

  /**
   * Run a full checkpoint cycle: initiate + confirm for all currently staged seals.
   *
   * AC-006: This is the same code path used in production (via JobScheduler registration).
   * Tests trigger this directly to exercise the exact production path.
   */
  async runCheckpoint(): Promise<string> {
    const checkpointId = await this.#store.initiateCheckpoint();
    const peakHash = await this.#store.confirmCheckpoint(checkpointId);
    return peakHash;
  }

  /**
   * Detect staged seals older than max_staging_age.
   *
   * Emits mmr.checkpoint.overdue at WARN for each overdue session.
   * Returns the list of overdue session IDs so the caller can invoke forceFlush().
   *
   * DB-001: correlationId is NOT threaded here — overdue detection fires from a scheduler
   * context with no session correlationId in scope at trigger time.
   */
  async checkOverdue(): Promise<string[]> {
    const now = Date.now();

    const res = await this.#pool.query<{ session_id: string; recorded_at: Date }>(
      "SELECT session_id, recorded_at FROM conversation_seal_staging WHERE checkpoint_id IS NULL",
    );

    const overdueIds: string[] = [];

    for (const row of res.rows) {
      const stagedAt = row.recorded_at.getTime();
      const ageMs = now - stagedAt;

      if (ageMs > this.#maxStagingAgeMs) {
        overdueIds.push(row.session_id);
        // mmr.checkpoint.overdue: correlationId is NOT threaded (scheduler context)
        this.#logger.warn("mmr.checkpoint.overdue", {
          sessionId: row.session_id,
          stagedAt,
          maxStagingAgeMs: this.#maxStagingAgeMs,
        });
      }
    }

    return overdueIds;
  }

  /**
   * Force a checkpoint flush for overdue staged sessions.
   *
   * Triggers a full checkpoint cycle (initiate + confirm) which commits ALL currently
   * staged seals — not just the overdue ones. This is intentional: a partial flush
   * would leave newly-staged (non-overdue) rows in staging while the overdue ones advance,
   * creating an inconsistent state. The checkpoint covers whatever is in staging at the
   * moment initiateCheckpoint() stamps checkpoint_id.
   *
   * @param overdueSessionIds — the session IDs returned by checkOverdue() (used for validation only)
   */
  async forceFlush(overdueSessionIds: string[]): Promise<void> {
    if (overdueSessionIds.length === 0) return;

    // Run a full checkpoint: initiate stamps checkpoint_id on all NULL rows,
    // confirm commits them and emits mmr.session.checkpointed per-session.
    await this.runCheckpoint();
  }
}
