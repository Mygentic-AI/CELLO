/**
 * PendingConnectionRequestTtlSweep — deletes rows from pending_connection_requests
 * that are older than 24 hours.
 *
 * Registered as a JobScheduler handler in the directory composition root
 * (PERSIST-019 behavior.trigger: "When the directory's TTL sweep runs").
 *
 * Pseudocode:
 *   run():
 *     DELETE FROM pending_connection_requests
 *       WHERE created_at < now() - INTERVAL '24 hours'
 *     RETURNING id
 *     purgedCount = count of deleted rows
 *     logger.info("queue.pending_connection_requests.expired", { purgedCount })
 *     RETURN purgedCount
 *
 * Observability (canonical taxonomy):
 *   queue.pending_connection_requests.expired — INFO — { purgedCount }
 */

import pg from "pg";
import type { Logger } from "@cello-protocol/interfaces";

export class PendingConnectionRequestTtlSweep {
  readonly #pool: pg.Pool;
  readonly #logger: Logger;

  constructor(pool: pg.Pool, logger: Logger) {
    this.#pool = pool;
    this.#logger = logger;
  }

  /**
   * Delete all pending_connection_requests rows older than 24 hours.
   * Logs queue.pending_connection_requests.expired at INFO with { purgedCount }.
   * Returns the number of purged rows.
   */
  async run(): Promise<number> {
    const result = await this.#pool.query<{ id: string }>(
      `DELETE FROM pending_connection_requests
       WHERE created_at < now() - INTERVAL '24 hours'
       RETURNING id`,
    );
    const purgedCount = result.rowCount ?? 0;
    this.#logger.info("queue.pending_connection_requests.expired", { purgedCount });
    return purgedCount;
  }
}
