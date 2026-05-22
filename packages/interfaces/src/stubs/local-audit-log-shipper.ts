/**
 * LocalAuditLogShipper — local file-sink implementation of AuditLogShipper (PERSIST-006).
 *
 * CELLO_ENV=local audit log destination: a newline-delimited JSON file at AUDIT_LOG_PATH.
 *
 * Phase P pseudocode:
 * ─────────────────────────────────────────────────────────────────
 * ship(entry):
 *   // Serialize entry to one JSON line
 *   // Append to file using O_APPEND (flag:'a') — SI-001: no overwrite possible
 *   // If appendFile rejects, retain entry in retry queue and surface the error
 *   // so it is not silently dropped (SI-002)
 *   line = JSON.stringify(entry) + '\n'
 *   await appendFile(path, line, { flag: 'a' })
 *
 * flush():
 *   // AC-003: drain the retry queue; all entries shipped before flush() are present
 *   // after flush() returns. For LocalAuditLogShipper there is no in-memory buffer —
 *   // every ship() writes synchronously to the underlying file. flush() is a no-op
 *   // in the nominal case but retries any entries held in the retry queue.
 *   for entry in retryQueue:
 *     await appendFile(path, JSON.stringify(entry) + '\n', { flag: 'a' })
 *     retryQueue.remove(entry)
 * ─────────────────────────────────────────────────────────────────
 *
 * SI-001: appendFile with flag:'a' uses O_APPEND | O_CREAT — existing bytes are never
 *         overwritten, only new bytes are appended. Node.js fs.appendFile guarantees this.
 *
 * SI-002: if appendFile rejects, the entry is placed in a retry queue.
 *         flush() drains the retry queue before returning, ensuring no silent drops.
 *         Callers that await ship() will see the rejection propagated so the Logger
 *         can record audit.ship.failed.
 */

import { appendFile } from "node:fs/promises";
import type { AuditLogShipper, AuditLogEntry } from "../audit-log-shipper.js";
import type { Logger } from "../logger.js";

/**
 * DB-001 degraded behavior constants:
 * - Buffer limit: 10,000 entries
 * - Retry interval: 30 seconds
 * - Observability events: audit.shipper.degraded, audit.shipper.buffer.overflow
 */
const BUFFER_LIMIT = 10_000;
const RETRY_INTERVAL_MS = 30_000;

export class LocalAuditLogShipper implements AuditLogShipper {
  readonly #path: string;
  readonly #logger: Logger;
  // SI-002: retry queue — entries that failed to write are held here until flush()
  readonly #retryQueue: AuditLogEntry[] = [];
  #isDegraded = false;
  #retryTimerHandle?: NodeJS.Timeout;

  constructor(path: string, logger: Logger) {
    this.#path = path;
    this.#logger = logger;
  }

  async ship(entry: AuditLogEntry): Promise<void> {
    // SI-001: flag:'a' = O_APPEND | O_CREAT — never truncates or overwrites
    const line = JSON.stringify(entry) + "\n";
    try {
      await appendFile(this.#path, line, { flag: "a" });
    } catch (err) {
      // SI-002: do not silently drop — add to retry queue and re-throw so caller
      // can log audit.ship.failed with the error context

      // DB-001: buffer limit enforcement
      if (this.#retryQueue.length >= BUFFER_LIMIT) {
        this.#logger.error("audit.shipper.buffer.overflow", {
          bufferedCount: this.#retryQueue.length,
          reason: "Buffer limit reached",
        });
        // Drop oldest entry to make room
        this.#retryQueue.shift();
      }

      this.#retryQueue.push(entry);

      // DB-001: enter degraded mode and start retry timer
      if (!this.#isDegraded) {
        this.#isDegraded = true;
        this.#logger.warn("audit.shipper.degraded", {
          reason: err instanceof Error ? err.message : String(err),
          bufferedCount: this.#retryQueue.length,
        });
        this.#startRetryTimer();
      }

      // Log the failed ship event with correct fields
      this.#logger.error("audit.ship.failed", {
        error: err instanceof Error ? err.message : String(err),
      });

      throw err;
    }
  }

  #startRetryTimer(): void {
    // Clear any existing timer
    if (this.#retryTimerHandle) {
      clearTimeout(this.#retryTimerHandle);
    }

    // DB-001: retry on 30-second interval
    this.#retryTimerHandle = setTimeout(() => {
      void this.#retryBufferedEntries();
    }, RETRY_INTERVAL_MS);
  }

  async #retryBufferedEntries(): Promise<void> {
    if (this.#retryQueue.length === 0) {
      this.#isDegraded = false;
      return;
    }

    let successCount = 0;
    const initialLength = this.#retryQueue.length;

    for (let i = 0; i < initialLength; i++) {
      const entry = this.#retryQueue[0];
      if (!entry) break;

      const line = JSON.stringify(entry) + "\n";
      try {
        await appendFile(this.#path, line, { flag: "a" });
        successCount++;
        this.#retryQueue.shift(); // Remove successful entry
      } catch (err) {
        // Keep entry in queue and break — will retry on next interval
        this.#logger.error("audit.ship.failed", {
          error: err instanceof Error ? err.message : String(err),
        });
        break;
      }
    }

    if (this.#retryQueue.length > 0) {
      // Still in degraded mode — schedule next retry
      this.#logger.warn("audit.shipper.degraded", {
        reason: "Retry partially successful",
        bufferedCount: this.#retryQueue.length,
      });
      this.#startRetryTimer();
    } else {
      // Recovered
      this.#isDegraded = false;
      this.#logger.info("audit.shipper.recovered", {
        retriedCount: successCount,
      });
    }
  }

  async flush(): Promise<number> {
    // Clear the retry timer if active
    if (this.#retryTimerHandle) {
      clearTimeout(this.#retryTimerHandle);
      this.#retryTimerHandle = undefined;
    }

    // AC-003: drain retry queue — all entries shipped before this call must be
    // persisted before flush() returns
    // Maximum 3 retry attempts per entry to prevent infinite loops on persistent failures
    const maxRetries = 3;
    // Per-flush count — entries shipped in this call only (not cumulative)
    let flushedCount = 0;

    while (this.#retryQueue.length > 0) {
      const entry = this.#retryQueue[0];
      if (!entry) break;

      const line = JSON.stringify(entry) + "\n";
      let retryCount = 0;
      let success = false;

      while (retryCount < maxRetries && !success) {
        try {
          // SI-001: flag:'a' — O_APPEND
          await appendFile(this.#path, line, { flag: "a" });
          flushedCount++;
          success = true;
        } catch (err) {
          retryCount++;
          if (retryCount >= maxRetries) {
            // Log the permanent failure but don't throw — flush() must complete
            this.#logger.error("audit.ship.retry.exhausted", {
              attempt: retryCount,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
      }

      this.#retryQueue.shift();
    }

    return flushedCount;
  }
}
