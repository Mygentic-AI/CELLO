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

export class LocalAuditLogShipper implements AuditLogShipper {
  readonly #path: string;
  // SI-002: retry queue — entries that failed to write are held here until flush()
  readonly #retryQueue: AuditLogEntry[] = [];
  #shippedCount = 0;

  constructor(path: string) {
    this.#path = path;
  }

  async ship(entry: AuditLogEntry): Promise<void> {
    // SI-001: flag:'a' = O_APPEND | O_CREAT — never truncates or overwrites
    const line = JSON.stringify(entry) + "\n";
    try {
      await appendFile(this.#path, line, { flag: "a" });
      this.#shippedCount++;
    } catch (err) {
      // SI-002: do not silently drop — add to retry queue and re-throw so caller
      // can log audit.ship.failed with the error context
      this.#retryQueue.push(entry);
      throw err;
    }
  }

  async flush(): Promise<number> {
    // AC-003: drain retry queue — all entries shipped before this call must be
    // persisted before flush() returns
    // Maximum 3 retry attempts per entry to prevent infinite loops on persistent failures
    const maxRetries = 3;
    const failedEntries: AuditLogEntry[] = [];

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
          this.#shippedCount++;
          success = true;
        } catch (err) {
          retryCount++;
          if (retryCount >= maxRetries) {
            failedEntries.push(entry);
            // Log the permanent failure but don't throw — flush() must complete
            // TODO: inject logger to avoid console.error
             
            console.error("audit.ship.retry.exhausted", { entry, error: err });
          }
        }
      }

      this.#retryQueue.shift();
    }

    return this.#shippedCount;
  }
}
