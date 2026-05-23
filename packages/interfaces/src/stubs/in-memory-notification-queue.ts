/**
 * InMemoryNotificationQueue — local development stub for NotificationQueue.
 *
 * Used when CELLO_ENV=local. Notifications are stored in memory only —
 * they do not survive process restarts. This is the documented and expected
 * behavior for local development.
 *
 * Production environments (dev/staging/production) use PgNotificationQueue
 * which persists rows to the pending_notifications Postgres table.
 *
 * Implements: NotificationQueue (packages/interfaces/src/notification-queue.ts)
 * Used by: packages/directory/src/bin/directory.ts (composition root, CELLO_ENV=local)
 */

import type { NotificationQueue, QueuedNotification } from "../notification-queue.js";

/**
 * InMemoryNotificationQueue — in-memory stub for local development.
 *
 * Pseudocode:
 *   #notifications: Map<agentId, QueuedNotification[]>
 *
 *   enqueue(agentId, notification):
 *     append notification to #notifications[agentId]
 *
 *   drainUndelivered(agentId):
 *     return #notifications[agentId] ?? []
 *     (in-memory insertion order is the natural ASC order)
 *     rows are NOT deleted by this call — only by acknowledge()
 *
 *   acknowledge(notificationId):
 *     remove the notification with matching notificationId from all agent queues
 *     if not found: no-op (idempotent)
 */
export class InMemoryNotificationQueue implements NotificationQueue {
  readonly #notifications = new Map<string, QueuedNotification[]>();

  async enqueue(agentId: string, notification: QueuedNotification): Promise<void> {
    const queue = this.#notifications.get(agentId) ?? [];
    queue.push(notification);
    this.#notifications.set(agentId, queue);
  }

  async drainUndelivered(agentId: string): Promise<QueuedNotification[]> {
    return this.#notifications.get(agentId) ?? [];
  }

  async acknowledge(notificationId: string): Promise<void> {
    // Idempotent: iterate all agent queues and remove the matching notification.
    // If the notification is not found, this is a no-op (SI-003).
    for (const [agentId, queue] of this.#notifications.entries()) {
      const idx = queue.findIndex((n) => n.notificationId === notificationId);
      if (idx !== -1) {
        queue.splice(idx, 1);
        if (queue.length === 0) {
          this.#notifications.delete(agentId);
        }
        return;
      }
    }
    // Not found — no-op (idempotent per SI-003)
  }
}
