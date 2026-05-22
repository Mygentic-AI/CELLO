/**
 * NotificationQueue — persistence interface for queued SEAL_UNILATERAL notifications.
 *
 * Introduced in PERSIST-023 (M5) to back the pending_notifications table.
 *
 * Design decisions:
 *   - enqueue() is async: PgNotificationQueue must await the INSERT to guarantee persistence.
 *     InMemoryNotificationQueue also returns Promise<void> to satisfy the interface.
 *   - drainUndelivered() returns notifications in created_at ASC order. Rows are NOT deleted
 *     by drainUndelivered — they remain until acknowledge() is called.
 *     This allows idempotent re-delivery if the directory restarts between delivery and
 *     acknowledgement (DB-002).
 *   - acknowledge() is idempotent: deleting a non-existent row is a no-op, not an error.
 *     This handles the case where acknowledge() is called twice (e.g. retry on network error).
 *
 * Security invariants:
 *   - SI-001: rows are only deleted on explicit acknowledgement, never by TTL or background cleanup.
 *   - SI-003: at-most-once delivery is ensured by the row deletion on acknowledge.
 *
 * Adapter implementations:
 *   - packages/interfaces/stubs/in-memory-notification-queue.ts (CELLO_ENV=local)
 *   - packages/directory/src/adapters/pg-notification-queue.ts (CELLO_ENV=dev/staging/production)
 */

/** A notification queued for delivery to an absent agent. */
export interface QueuedNotification {
  /** UUID that uniquely identifies this notification row. */
  notificationId: string;
  /** The notification type (e.g. "seal_unilateral"). */
  notificationType: string;
  /** JSONB payload — opaque to the queue; interpreted by the consuming agent. */
  payload: Record<string, unknown>;
}

/**
 * NotificationQueue — delivery queue interface for SEAL_UNILATERAL notifications.
 *
 * Pseudocode for the delivery lifecycle:
 *   1. seal_unilateral triggered → enqueue(agentId, notification)
 *   2. agent reconnects → drain = drainUndelivered(agentId)
 *   3. for each notif in drain: deliver over signaling stream
 *   4. on agent ACK: acknowledge(notif.notificationId)
 *
 * Error handling:
 *   - enqueue: throws on Postgres error (caller must handle or fire-and-forget with logging)
 *   - drainUndelivered: throws on Postgres error
 *   - acknowledge: throws on Postgres error; idempotent (non-existent row is a no-op)
 */
export interface NotificationQueue {
  /**
   * Queue a notification for delivery to the specified agent.
   *
   * @param agentId - The recipient agent's identifier (e.g. k_local_pubkey hex)
   * @param notification - The notification to queue
   */
  enqueue(agentId: string, notification: QueuedNotification): Promise<void>;

  /**
   * Return all unacknowledged notifications for the specified agent, in created_at ASC order.
   *
   * Does NOT delete rows — rows remain until acknowledge() is called.
   * This allows idempotent re-delivery on reconnect after a directory restart.
   *
   * @param agentId - The recipient agent's identifier
   * @returns Array of notifications in delivery order (oldest first)
   */
  drainUndelivered(agentId: string): Promise<QueuedNotification[]>;

  /**
   * Mark a notification as delivered by deleting its row.
   *
   * Idempotent: acknowledging a non-existent notificationId is a no-op.
   * The caller (directory service) is the only entity that should call this.
   *
   * @param notificationId - UUID of the notification row to delete
   */
  acknowledge(notificationId: string): Promise<void>;
}
