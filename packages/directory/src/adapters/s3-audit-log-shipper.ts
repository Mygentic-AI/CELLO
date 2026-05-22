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
 *     oldestEntryAge = Date.now() - this.#bufferOldestTs
 *     this.#logger.warn("audit.shipper.degraded", { reason, bufferedCount, oldestEntryAge })
 *     this.#startBackoffRetry()
 *
 * #addToBuffer(entry):
 *   // Bounded at MAX_BUFFER=10,000; drop oldest if full (AC-005)
 *   if this.#buffer.length >= MAX_BUFFER:
 *     this.#buffer.shift()  // drop oldest
 *     this.#logger.error("audit.shipper.buffer.overflow", { droppedCount: 1, bufferedCount: MAX_BUFFER })
 *   if this.#buffer.length === 0: this.#bufferOldestTs = Date.now()
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
 * #startBackoffRetry():
 *   // Start background retry loop if not already running (SI-001: backoff — EARS behavior)
 *   // Schedule: 1s, 2s, 4s, 8s, 16s, 32s, cap at 60s
 *   if this.#retryTimer !== null: return  // already scheduled
 *   this.#scheduleRetry(INITIAL_RETRY_MS)
 *
 * #scheduleRetry(delayMs):
 *   this.#retryTimer = setTimeout(async () => {
 *     this.#retryTimer = null
 *     if this.#buffer.length === 0: return  // buffer drained by flush()
 *     try:
 *       s3Key = await this.#putToS3(this.#buffer[0])
 *       // S3 is back — drain buffer
 *       this.#buffer.shift()
 *       this.#logger.info("audit.shipper.recovered", { bufferedCount: this.#buffer.length })
 *       // Flush remaining buffer entries
 *       for remaining entries: ship them
 *     catch:
 *       // S3 still unavailable — reschedule with backoff
 *       this.#scheduleRetry(Math.min(delayMs * 2, MAX_RETRY_MS))
 *   }, delayMs)
 *
 * flush():
 *   // Called on SIGTERM — attempt to ship all buffered within flushTimeoutMs (default: 10s)
 *   // Concurrent flush calls: #flushInProgress guard prevents double-shipping (AC concurrency)
 *   if this.#flushInProgress: await this.#flushPromise; return 0
 *   this.#flushInProgress = true
 *   cancel any pending retry timer
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

/** Initial retry delay in milliseconds (exponential backoff starting point) */
const INITIAL_RETRY_MS = 1_000;

/** Maximum retry delay in milliseconds (backoff cap) */
const MAX_RETRY_MS = 60_000;

export interface S3AuditLogShipperOptions {
  /** Maximum time (ms) to wait during flush() before giving up. Default: 10,000 */
  flushTimeoutMs?: number;
  /** Initial retry delay (ms) for exponential backoff. Default: 1,000 */
  initialRetryMs?: number;
}

export class S3AuditLogShipper implements AuditLogShipper {
  readonly #bucket: string;
  readonly #logger: Logger;
  // S3 client created in constructor ONLY — never at module scope (M4 adapter rule)
  readonly #client: S3Client;
  // Bounded in-memory buffer for degraded-mode accumulation
  readonly #buffer: AuditLogEntry[] = [];
  readonly #flushTimeoutMs: number;
  readonly #initialRetryMs: number;

  // Timestamp of the oldest entry currently in the buffer (for oldestEntryAge computation)
  #bufferOldestTs = 0;

  // Concurrency guard: flush() sets this to prevent double-shipping on concurrent calls
  #flushInProgress = false;
  #flushResolve?: () => void;
  #flushPromise?: Promise<void>;

  // Background retry timer handle (null = no retry scheduled)
  #retryTimer: ReturnType<typeof setTimeout> | null = null;

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
    this.#initialRetryMs = opts.initialRetryMs ?? INITIAL_RETRY_MS;
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
      // Enter degraded mode: buffer the entry and log with oldestEntryAge
      this.#addToBuffer(entry);
      const reason = err instanceof Error ? err.message : String(err);
      this.#logger.warn("audit.shipper.degraded", {
        reason,
        bufferedCount: this.#buffer.length,
        oldestEntryAge: Date.now() - this.#bufferOldestTs,
      });
      // Start background retry loop (idempotent — no-op if already running)
      this.#startBackoffRetry(this.#initialRetryMs);
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
    // Cancel any pending background retry — flush takes over
    if (this.#retryTimer !== null) {
      clearTimeout(this.#retryTimer);
      this.#retryTimer = null;
    }
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
    // Track the oldest entry's arrival time for oldestEntryAge reporting
    if (this.#buffer.length === 0) {
      this.#bufferOldestTs = Date.now();
    }
    this.#buffer.push(entry);
  }

  /**
   * Start the exponential backoff retry loop (idempotent — no-op if already running).
   * Schedule: initialRetryMs → 2x → 4x → … → cap at MAX_RETRY_MS (60s).
   * When a flush attempt succeeds, emits audit.shipper.recovered and drains the buffer.
   */
  #startBackoffRetry(delayMs: number): void {
    // Only one retry loop at a time
    if (this.#retryTimer !== null) return;
    this.#scheduleRetry(delayMs);
  }

  #scheduleRetry(delayMs: number): void {
    this.#retryTimer = setTimeout(() => {
      this.#retryTimer = null;
      // If buffer is empty (drained by flush() or successful ships) — nothing to do
      if (this.#buffer.length === 0) return;
      // Attempt to ship the oldest buffered entry as a probe
      void this.#retryFlush(delayMs);
    }, delayMs);
  }

  async #retryFlush(prevDelayMs: number): Promise<void> {
    if (this.#buffer.length === 0) return;

    const countBeforeFlush = this.#buffer.length;

    try {
      // Attempt to ship the first buffered entry as a probe
      const first = this.#buffer[0]!;
      await this.#putToS3(first);
      this.#buffer.shift();

      // S3 is back — log recovery and drain the rest of the buffer
      this.#logger.info("audit.shipper.recovered", {
        bufferedCount: countBeforeFlush,
      });

      // Drain remaining buffered entries (best-effort, no timeout here)
      while (this.#buffer.length > 0) {
        const entry = this.#buffer[0]!;
        try {
          await this.#putToS3(entry);
          this.#buffer.shift();
        } catch {
          // S3 went down again mid-drain — reschedule backoff from initial delay
          this.#scheduleRetry(this.#initialRetryMs);
          return;
        }
      }
    } catch {
      // S3 still unavailable — reschedule with exponential backoff (cap at MAX_RETRY_MS)
      const nextDelay = Math.min(prevDelayMs * 2, MAX_RETRY_MS);
      this.#scheduleRetry(nextDelay);
    }
  }
}
