/**
 * S3AuditLogShipper — production S3-backed implementation of AuditLogShipper (SECOPS-001).
 *
 * CELLO_ENV=dev/staging/production audit log destination: S3 bucket (cello-audit-logs-{env}-{region}).
 *
 * Phase P pseudocode:
 * ─────────────────────────────────────────────────────────────────
 * ship(entry):
 *   // Per-write shipping — no intentional batching delay (AC-002)
 *   // If in degraded mode (buffer non-empty), add to buffer for ordering preservation
 *   if this.#buffer.length > 0:
 *     this.#addToBuffer(entry)
 *     return
 *   try:
 *     s3Key = await this.#putToS3(entry)
 *     this.#logger.info("audit.shipper.shipped", { entryCount: 1, s3Key, durationMs })
 *   catch:
 *     this.#addToBuffer(entry)
 *     this.#logger.warn("audit.shipper.degraded", { reason, bufferedCount })
 *
 * #addToBuffer(entry):
 *   // Bounded at MAX_BUFFER=10,000; drop oldest if full (AC-005)
 *   if this.#buffer.length >= MAX_BUFFER:
 *     this.#buffer.shift()  // drop oldest
 *     this.#logger.error("audit.shipper.buffer.overflow", { droppedCount: 1, bufferedCount: MAX_BUFFER })
 *   this.#buffer.push(entry)
 *
 * #putToS3(entry):
 *   // Key: audit/{YYYY-MM-DD}/{timestamp}-{uuid}.jsonl
 *   s3Key = `audit/${date}/${timestamp}-${uuid}.jsonl`
 *   await this.#client.send(new PutObjectCommand({
 *     Bucket: this.#bucket, Key: s3Key,
 *     Body: JSON.stringify(entry), ContentType: "application/x-ndjson"
 *   }))
 *   return s3Key
 *
 * flush():
 *   // Called on SIGTERM — attempt to ship all buffered within flushTimeoutMs (default: 10s)
 *   // Concurrent flush calls: #flushInProgress guard prevents double-shipping (AC concurrency)
 *   if this.#flushInProgress: await this.#flushPromise; return 0
 *   this.#flushInProgress = true
 *   shipped = 0
 *   startMs = Date.now()
 *   try:
 *     for entry in snapshot of buffer:
 *       if Date.now() - startMs > flushTimeoutMs: break
 *       await this.#putToS3(entry)
 *       remove from buffer
 *       shipped++
 *     if buffer.length > 0:
 *       this.#logger.error("audit.shipper.flush.failed", { lostEntryCount: buffer.length })
 *     else:
 *       this.#logger.info("audit.shipper.flushed", { entriesShipped: shipped, durationMs })
 *   catch:
 *     this.#logger.error("audit.shipper.flush.failed", { lostEntryCount: buffer.length })
 *   finally:
 *     this.#flushInProgress = false
 *   return shipped
 * ─────────────────────────────────────────────────────────────────
 *
 * Security notes:
 *   - S3 client created in constructor ONLY — never at module scope (M4 bug #8)
 *   - No S3 types leak through the AuditLogShipper interface (SI-003)
 *   - Logger injected via constructor, never imported directly
 *   - No console.log/error/warn in this file
 *   - Bucket name from env var / constructor arg, never hardcoded
 */

import { randomUUID } from "node:crypto";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import type { AuditLogShipper, AuditLogEntry, Logger } from "@cello/interfaces";

/** Maximum number of entries to hold in the in-memory buffer (AC-005) */
const MAX_BUFFER = 10_000;

/** Default flush timeout in milliseconds (SIGTERM path — AC-007) */
const DEFAULT_FLUSH_TIMEOUT_MS = 10_000;

export interface S3AuditLogShipperOptions {
  /** Maximum time (ms) to wait during flush() before giving up. Default: 10,000 */
  flushTimeoutMs?: number;
}

export class S3AuditLogShipper implements AuditLogShipper {
  readonly #bucket: string;
  readonly #logger: Logger;
  // S3 client created in constructor ONLY — never at module scope (M4 adapter rule)
  readonly #client: S3Client;
  // Bounded in-memory buffer for degraded-mode accumulation
  readonly #buffer: AuditLogEntry[] = [];
  readonly #flushTimeoutMs: number;

  // Concurrency guard: flush() sets this to prevent double-shipping on concurrent calls
  #flushInProgress = false;
  #flushResolve?: () => void;
  #flushPromise?: Promise<void>;

  constructor(
    bucketName: string,
    region: string,
    logger: Logger,
    s3Client?: S3Client,
    opts: S3AuditLogShipperOptions = {},
  ) {
    this.#bucket = bucketName;
    this.#logger = logger;
    // Inject client for testing; create real client for production
    this.#client = s3Client ?? new S3Client({ region });
    this.#flushTimeoutMs = opts.flushTimeoutMs ?? DEFAULT_FLUSH_TIMEOUT_MS;
  }

  /**
   * Test-only accessor: exposes buffer size without exposing buffer contents.
   * Named with underscore prefix to signal internal-only intent; accessed in tests via
   * (shipper as unknown as { _bufferSizeForTest: number })._bufferSizeForTest
   */
  get _bufferSizeForTest(): number {
    return this.#buffer.length;
  }

  async ship(entry: AuditLogEntry): Promise<void> {
    // If already in degraded mode, buffer this entry for ordering preservation
    if (this.#buffer.length > 0) {
      this.#addToBuffer(entry);
      return;
    }

    const startMs = Date.now();
    try {
      const s3Key = await this.#putToS3(entry);
      this.#logger.info("audit.shipper.shipped", {
        entryCount: 1,
        s3Key,
        durationMs: Date.now() - startMs,
      });
    } catch (err) {
      // Enter degraded mode: buffer the entry and log
      this.#addToBuffer(entry);
      const reason = err instanceof Error ? err.message : String(err);
      this.#logger.warn("audit.shipper.degraded", {
        reason,
        bufferedCount: this.#buffer.length,
      });
    }
  }

  async flush(): Promise<number> {
    // Concurrency guard: if a flush is already in progress, wait for it and return 0
    if (this.#flushInProgress) {
      if (this.#flushPromise) {
        await this.#flushPromise;
      }
      return 0;
    }

    this.#flushInProgress = true;
    // Set up the promise that concurrent callers can await
    this.#flushPromise = new Promise<void>((resolve) => {
      this.#flushResolve = resolve;
    });

    const startMs = Date.now();
    let shipped = 0;

    try {
      // Take a snapshot length to avoid racing with concurrent ship() calls
      const toShip = [...this.#buffer];
      this.#buffer.length = 0; // clear atomically before attempting

      for (const entry of toShip) {
        if (Date.now() - startMs > this.#flushTimeoutMs) {
          // Timeout exceeded — put remaining entries back
          this.#buffer.unshift(...toShip.slice(shipped));
          break;
        }
        try {
          await this.#putToS3(entry);
          shipped++;
        } catch {
          // S3 still unavailable — put remaining entries back and give up
          this.#buffer.unshift(...toShip.slice(shipped));
          break;
        }
      }

      if (this.#buffer.length > 0) {
        this.#logger.error("audit.shipper.flush.failed", {
          lostEntryCount: this.#buffer.length,
        });
      } else {
        this.#logger.info("audit.shipper.flushed", {
          entriesShipped: shipped,
          durationMs: Date.now() - startMs,
        });
      }
    } finally {
      this.#flushInProgress = false;
      if (this.#flushResolve) {
        this.#flushResolve();
        this.#flushResolve = undefined;
        this.#flushPromise = undefined;
      }
    }

    return shipped;
  }

  /**
   * Put a single AuditLogEntry to S3.
   * Key format: audit/{YYYY-MM-DD}/{ISO-timestamp}-{uuid}.jsonl
   */
  async #putToS3(entry: AuditLogEntry): Promise<string> {
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10); // YYYY-MM-DD
    const timestampStr = now.toISOString().replace(/[:.]/g, "-"); // safe for S3 keys
    const uuid = randomUUID();
    const s3Key = `audit/${dateStr}/${timestampStr}-${uuid}.jsonl`;

    await this.#client.send(
      new PutObjectCommand({
        Bucket: this.#bucket,
        Key: s3Key,
        Body: JSON.stringify(entry),
        ContentType: "application/x-ndjson",
      }),
    );

    return s3Key;
  }

  /**
   * Add entry to bounded in-memory buffer.
   * If buffer is full, drops the oldest entry and logs audit.shipper.buffer.overflow (AC-005).
   */
  #addToBuffer(entry: AuditLogEntry): void {
    if (this.#buffer.length >= MAX_BUFFER) {
      // Drop oldest entry to prevent unbounded memory growth
      this.#buffer.shift();
      this.#logger.error("audit.shipper.buffer.overflow", {
        droppedCount: 1,
        bufferedCount: MAX_BUFFER,
      });
    }
    this.#buffer.push(entry);
  }
}
