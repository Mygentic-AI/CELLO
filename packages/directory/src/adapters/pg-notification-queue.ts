/**
 * PgNotificationQueue — Postgres-backed NotificationQueue for CELLO_ENV=local/dev/staging/production.
 *
 * Implements the NotificationQueue interface from packages/interfaces/src/notification-queue.ts.
 * Backs the pending_notifications table introduced by the V20 Flyway migration.
 *
 * Used only by the composition root (bin/directory.ts). Never imported from application code.
 *
 * Design (PERSIST-023):
 *   - enqueue() writes a row to pending_notifications with all required columns.
 *     Rows survive directory restarts (AC-002).
 *   - drainUndelivered() queries pending_notifications WHERE recipient_agent_id = $1
 *     ORDER BY created_at ASC. Rows are NOT deleted — they remain until acknowledge().
 *     This ensures idempotent re-delivery if the directory restarts before the agent
 *     acknowledges (DB-002).
 *   - acknowledge() deletes the row by notification_id. Idempotent: DELETE of a
 *     non-existent row is a no-op (SI-003).
 *
 * Security invariants (PERSIST-023):
 *   - SI-001: rows are only deleted on explicit acknowledgement via acknowledge().
 *     No TTL, no background cleanup process, no expiry column.
 *   - SI-003: acknowledge() is idempotent — DELETE of non-existent row is a no-op.
 *
 * AC-009-table-extra-excluded:
 *   pending_notifications has no nullable columns not set at enqueue() time.
 *   All columns are NOT NULL with defaults:
 *     - notification_id: supplied by caller
 *     - recipient_agent_id: supplied by caller
 *     - notification_type: supplied by caller
 *     - payload: supplied by caller
 *     - created_at: DEFAULT now() — always set
 *   No delivered_at column exists — rows are deleted, not marked delivered.
 *   Therefore TABLE_EXTRA_EXCLUDED is not needed for this table.
 */

import pg from "pg";
import type { NotificationQueue, QueuedNotification, Logger } from "@cello-protocol/interfaces";

/**
 * PgNotificationQueue — Postgres-backed implementation of NotificationQueue.
 *
 * Constructor pseudocode:
 *   1. Store pg.Pool and Logger references.
 *   2. Record startup timestamp (used to compute deliveryLatencyMs in acknowledge()).
 */
export class PgNotificationQueue implements NotificationQueue {
  readonly #pool: pg.Pool;
  readonly #logger: Logger;

  constructor(pool: pg.Pool, logger: Logger) {
    this.#pool = pool;
    this.#logger = logger;
  }

  /**
   * Enqueue a notification for an absent agent.
   *
   * Pseudocode:
   *   INSERT INTO pending_notifications
   *     (notification_id, recipient_agent_id, notification_type, payload)
   *   VALUES ($1, $2, $3, $4::jsonb)
   *   ON CONFLICT (notification_id) DO NOTHING
   *   (idempotent: duplicate notification_id is a no-op, not an error)
   *   log pending_notification.queued at INFO with:
   *     { notificationId, recipientAgentId, notificationType }
   *
   * @param agentId - The recipient agent's identifier (e.g. k_local_pubkey hex)
   * @param notification - The notification to queue
   */
  async enqueue(agentId: string, notification: QueuedNotification): Promise<void> {
    await this.#pool.query(
      `INSERT INTO pending_notifications
         (notification_id, recipient_agent_id, notification_type, payload)
       VALUES ($1, $2, $3, $4::jsonb)
       ON CONFLICT (notification_id) DO NOTHING`,
      [
        notification.notificationId,
        agentId,
        notification.notificationType,
        JSON.stringify(notification.payload),
      ],
    );

    this.#logger.info("pending_notification.queued", {
      notificationId: notification.notificationId,
      recipientAgentId: agentId,
      notificationType: notification.notificationType,
    });
  }

  /**
   * Return all unacknowledged notifications for the specified agent, ordered by created_at ASC.
   *
   * Pseudocode:
   *   SELECT notification_id, recipient_agent_id, notification_type, payload, created_at
   *   FROM pending_notifications
   *   WHERE recipient_agent_id = $1
   *   ORDER BY created_at ASC
   *
   *   rows are NOT deleted — they remain until acknowledge() is called (SI-001, DB-002)
   *
   * @param agentId - The recipient agent's identifier
   * @returns Array of notifications in delivery order (oldest first, AC-006)
   */
  async drainUndelivered(agentId: string): Promise<QueuedNotification[]> {
    const result = await this.#pool.query<{
      notification_id: string;
      recipient_agent_id: string;
      notification_type: string;
      payload: unknown;
      created_at: string;
    }>(
      `SELECT notification_id, recipient_agent_id, notification_type, payload, created_at
       FROM pending_notifications
       WHERE recipient_agent_id = $1
       ORDER BY created_at ASC`,
      [agentId],
    );

    return result.rows.map((row) => ({
      notificationId: row.notification_id,
      notificationType: row.notification_type,
      payload: row.payload as Record<string, unknown>,
    }));
  }

  /**
   * Mark a notification as delivered by deleting its row.
   *
   * Pseudocode:
   *   Record startMs = Date.now()
   *   SELECT created_at FROM pending_notifications WHERE notification_id = $1
   *   DELETE FROM pending_notifications WHERE notification_id = $1
   *   deliveryLatencyMs = Date.now() - created_at (or Date.now() - startMs if not found)
   *   log notification.delivered at INFO with:
   *     { notificationId, recipientAgentId, notificationType, deliveryLatencyMs }
   *
   *   Idempotent: DELETE of non-existent row is a no-op (SI-003).
   *   The notification.delivered log is emitted only when a row is actually deleted.
   *
   * @param notificationId - UUID of the notification row to delete
   */
  async acknowledge(notificationId: string): Promise<void> {
    const startMs = Date.now();

    // Fetch the row before deleting so we can log recipientAgentId, notificationType,
    // and compute deliveryLatencyMs from created_at.
    const existing = await this.#pool.query<{
      recipient_agent_id: string;
      notification_type: string;
      created_at: string;
    }>(
      `SELECT recipient_agent_id, notification_type, created_at
       FROM pending_notifications
       WHERE notification_id = $1`,
      [notificationId],
    );

    if (existing.rows.length === 0) {
      // Row already deleted (idempotent acknowledge — SI-003). No log emitted.
      return;
    }

    const row = existing.rows[0]!;
    await this.#pool.query(
      `DELETE FROM pending_notifications WHERE notification_id = $1`,
      [notificationId],
    );

    // Compute delivery latency from the row's created_at timestamp.
    // created_at is returned as a string because configurePgTypes() disables Date parsing.
    // Use Date.parse() to convert the ISO string to ms.
    const createdAtMs = Date.parse(row.created_at);
    const deliveryLatencyMs = Number.isFinite(createdAtMs)
      ? Date.now() - createdAtMs
      : Date.now() - startMs;

    this.#logger.info("notification.delivered", {
      notificationId,
      recipientAgentId: row.recipient_agent_id,
      notificationType: row.notification_type,
      deliveryLatencyMs,
    });
  }
}
