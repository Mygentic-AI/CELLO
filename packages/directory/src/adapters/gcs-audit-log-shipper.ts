/**
 * GcsAuditLogShipper — Google Cloud Storage AuditLogShipper (M12 DOD-ADAPTER-GCP-1, set by
 * M12-D6). The GCP counterpart of `s3-audit-log-shipper.ts`, and it deliberately mirrors that
 * adapter's SEMANTICS rather than inventing simpler ones, because the composition root swaps them
 * by `CELLO_ENV` and every downstream expectation was formed against the S3 behavior:
 *
 *  - `ship()` writes through IMMEDIATELY (one object per entry, no batching delay). An audit trail
 *    that only lands on `flush()` loses everything a crash interrupts.
 *  - On a write failure the entry is BUFFERED, not dropped, and the shipper enters a degraded mode
 *    that keeps warning while the buffer is non-empty — a silent audit gap is the failure mode that
 *    matters here, since nothing downstream ever notices missing rows.
 *  - `flush()` drains the buffer and returns the number of entries shipped by THIS call (retries
 *    included), per the interface contract.
 *  - The buffer is bounded; at the cap the OLDEST entry is dropped and the drop is logged. Losing
 *    the oldest under sustained failure is a deliberate trade against unbounded memory growth on a
 *    node that is already degraded — but it is never silent.
 *
 * Auth is Application Default Credentials (the VM's attached service account; org policy forbids
 * SA keys), so this module handles no key material.
 */

import type { AuditLogEntry, AuditLogShipper, Logger } from "@cello-protocol/interfaces";
import type { GcsLike } from "./gcs-cloud-storage-provider.js";

/** Max entries held while GCS is unavailable, before the oldest is dropped. Mirrors the S3 cap. */
const MAX_BUFFER = 10_000;

export class GcsAuditLogShipper implements AuditLogShipper {
  readonly #bucket: string;
  readonly #logger: Logger;
  readonly #storage: GcsLike;
  readonly #buffer: AuditLogEntry[] = [];
  #bufferOldestTs = 0;
  #seq = 0;

  /** `storage` is injected in tests; production passes a real `new Storage()`. */
  constructor(bucket: string, logger: Logger, storage: GcsLike) {
    this.#bucket = bucket;
    this.#logger = logger;
    this.#storage = storage;
  }

  async ship(entry: AuditLogEntry): Promise<void> {
    // Ordering: once degraded, everything queues behind the buffer so entries stay in sequence.
    if (this.#buffer.length > 0) {
      this.#enqueue(entry);
      this.#logger.warn("audit.shipper.degraded", {
        reason: "gcs_unavailable",
        bufferedCount: this.#buffer.length,
        oldestEntryAge: Date.now() - this.#bufferOldestTs,
      });
      return;
    }
    try {
      await this.#write([entry]);
      this.#logger.info("audit.shipper.shipped", { entryCount: 1 });
    } catch (err: unknown) {
      this.#enqueue(entry);
      this.#logger.error("audit.shipper.failed", {
        reason: err instanceof Error ? err.message : String(err),
        bufferedCount: this.#buffer.length,
      });
    }
  }

  async flush(): Promise<number> {
    if (this.#buffer.length === 0) return 0;
    const pending = [...this.#buffer];
    try {
      await this.#write(pending);
    } catch (err: unknown) {
      // Retain the buffer — a dropped audit batch is unrecoverable and invisible, so a failed
      // flush must leave the entries queued for the next attempt rather than clearing them.
      this.#logger.error("audit.shipper.flush.failed", {
        reason: err instanceof Error ? err.message : String(err),
        bufferedCount: this.#buffer.length,
      });
      return 0;
    }
    this.#buffer.length = 0;
    this.#bufferOldestTs = 0;
    this.#logger.info("audit.shipper.flushed", { entryCount: pending.length });
    return pending.length;
  }

  #enqueue(entry: AuditLogEntry): void {
    if (this.#buffer.length >= MAX_BUFFER) {
      this.#buffer.shift(); // drop OLDEST — bounded memory on an already-degraded node
      this.#logger.error("audit.shipper.buffer.overflow", { maxBuffer: MAX_BUFFER });
    }
    this.#buffer.push(entry);
    if (this.#bufferOldestTs === 0) this.#bufferOldestTs = Date.now();
  }

  /** One object per write, JSON-lines — the same on-disk shape the S3 shipper produces. */
  async #write(entries: AuditLogEntry[]): Promise<void> {
    const body = entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
    const key = `audit/${new Date().toISOString()}-${this.#seq++}.jsonl`;
    await this.#storage.bucket(this.#bucket).file(key).save(Buffer.from(body, "utf8"));
  }
}
