/**
 * S3AuditLogShipper — production S3-backed implementation of AuditLogShipper (SECOPS-001).
 *
 * CELLO_ENV=dev/staging/production audit log destination: S3 bucket (cello-audit-logs-{env}-{region}).
 *
 * Phase P pseudocode:
 * ─────────────────────────────────────────────────────────────────
 * ship(entry):
 *   // Per-write shipping — no intentional batching delay (AC-002)
 *   // If in degraded mode (buffer non-empty), add to buffer for ordering preservation.
 *   // HIGH-4: always emit audit.shipper.degraded while in degraded mode (not just on first failure).
 *   if this.#buffer.length > 0:
 *     this.#addToBuffer(entry)
 *     oldestEntryAge = Date.now() - this.#bufferOldestTs
 *     this.#logger.warn("audit.shipper.degraded", { reason: 'S3 unavailable', bufferedCount, oldestEntryAge })
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
 *     // HIGH-1/HIGH-3: update #bufferOldestTs after overflow drop
 *     if this.#buffer.length > 0: this.#bufferOldestTs = Date.now()
 *     else: this.#bufferOldestTs = 0
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
 *       // HIGH-1: update #bufferOldestTs after shift
 *       this.#bufferOldestTs = this.#buffer.length > 0 ? Date.now() : 0
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
 *   // HIGH-2: Wait for any in-progress retryFlush before draining.
 *   // MED-1: Concurrent flush calls return the actual shipped count from the in-flight flush.
 *   if this.#flushInProgress: await this.#flushPromise; return result
 *   this.#flushInProgress = true
 *   cancel any pending retry timer
 *   // HIGH-2: also wait for any in-flight #retryFlush
 *   if this.#retryPromise: await this.#retryPromise
 *   shipped = 0
 *   startMs = Date.now()
 *   try:
 *     for entry in snapshot of buffer:
 *       if Date.now() - startMs > flushTimeoutMs: break
 *       await this.#putToS3(entry)
 *       remove from buffer
 *       shipped++
 *     if buffer.length > 0:
 *       // MED-2: restore unshipped entries; protect with try/catch
 *       try: this.#buffer.unshift(...remaining)
 *       catch (e): this.#logger.error("audit.shipper.flush.failed", { lostEntryCount: ..., error })
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
  /** AWS region for the S3 bucket. Default: "us-east-1" */
  region?: string;
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
  // HIGH-1: Updated after each shift() so oldestEntryAge is always accurate
  #bufferOldestTs = 0;

  // Concurrency guard: flush() sets this to prevent double-shipping on concurrent calls
  // MED-1: #flushPromise is Promise<number> so concurrent callers get the actual shipped count
  #flushInProgress = false;
  #flushResolve?: (count: number) => void;
  #flushPromise?: Promise<number>;

  // HIGH-2: Tracks the in-flight #retryFlush promise to prevent concurrent flush+retry races
  #retryPromise?: Promise<void>;

  // Background retry timer handle (null = no retry scheduled)
  #retryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    bucketName: string,
    logger: Logger,
    s3Client?: S3Client,
    opts: S3AuditLogShipperOptions = {},
  ) {
    this.#bucket = bucketName;
    this.#logger = logger;
    const region = opts.region ?? "us-east-1";
    // Inject client for testing; create real client for production
    this.#client = s3Client ?? new S3Client({ region });
    this.#flushTimeoutMs = opts.flushTimeoutMs ?? DEFAULT_FLUSH_TIMEOUT_MS;
    this.#initialRetryMs = opts.initialRetryMs ?? INITIAL_RETRY_MS;
  }

  async ship(entry: AuditLogEntry): Promise<void> {
    // HIGH-4: If already in degraded mode, buffer this entry AND emit degraded warning.
    // Operators must see continued warnings during extended degraded operation, not just
    // the first failure event.
    if (this.#buffer.length > 0) {
      this.#addToBuffer(entry);
      const oldestEntryAge = Date.now() - this.#bufferOldestTs;
      this.#logger.warn("audit.shipper.degraded", {
        reason: "S3 unavailable",
        bufferedCount: this.#buffer.length,
        oldestEntryAge,
      });
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
    // MED-1: Concurrency guard — if a flush is already in progress, await it and return
    // its actual result (not 0), so all concurrent callers get the real shipped count.
    if (this.#flushInProgress) {
      if (this.#flushPromise) {
        return this.#flushPromise;
      }
      return 0;
    }

    this.#flushInProgress = true;
    // Cancel any pending background retry timer — flush takes over
    if (this.#retryTimer !== null) {
      clearTimeout(this.#retryTimer);
      this.#retryTimer = null;
    }

    // HIGH-2: Wait for any in-flight #retryFlush before draining the buffer.
    // Without this guard, flush() and #retryFlush() could both drain #buffer simultaneously.
    if (this.#retryPromise) {
      await this.#retryPromise;
    }

    // Set up the promise that concurrent callers can await (MED-1: typed as Promise<number>)
    this.#flushPromise = new Promise<number>((resolve) => {
      this.#flushResolve = resolve;
    });

    const startMs = Date.now();
    let shipped = 0;

    try {
      // Take a snapshot to iterate; clear buffer atomically before attempting
      const toShip = [...this.#buffer];
      this.#buffer.length = 0;

      for (const entry of toShip) {
        if (Date.now() - startMs > this.#flushTimeoutMs) {
          // Timeout exceeded — put remaining entries back
          // MED-2: protect the restore path with try/catch
          try {
            this.#buffer.unshift(...toShip.slice(shipped));
          } catch (restoreErr) {
            this.#logger.error("audit.shipper.flush.failed", {
              lostEntryCount: toShip.length - shipped,
              error: String(restoreErr),
            });
          }
          break;
        }
        try {
          await this.#putToS3(entry);
          shipped++;
        } catch {
          // S3 still unavailable — put remaining entries back and give up
          // MED-2: protect the restore path with try/catch
          try {
            this.#buffer.unshift(...toShip.slice(shipped));
          } catch (restoreErr) {
            this.#logger.error("audit.shipper.flush.failed", {
              lostEntryCount: toShip.length - shipped,
              error: String(restoreErr),
            });
          }
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
        this.#flushResolve(shipped);
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
   * HIGH-1/HIGH-3: Updates #bufferOldestTs after any shift() to keep oldestEntryAge accurate.
   */
  #addToBuffer(entry: AuditLogEntry): void {
    if (this.#buffer.length >= MAX_BUFFER) {
      // Drop oldest entry to prevent unbounded memory growth
      this.#buffer.shift();
      // HIGH-3: Update #bufferOldestTs after overflow drop so age is accurate going forward
      this.#bufferOldestTs = this.#buffer.length > 0 ? Date.now() : 0;
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
      // HIGH-2: Store the promise so flush() can await it before draining
      // LOW-1: Catch unexpected errors from #retryFlush so the loop doesn't silently die
      this.#retryPromise = this.#retryFlush(delayMs).catch((err) => {
        this.#logger.error("audit.shipper.retry.error", { error: String(err) });
      }).finally(() => {
        this.#retryPromise = undefined;
      });
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
      // HIGH-1: Update #bufferOldestTs after successful probe shift
      this.#bufferOldestTs = this.#buffer.length > 0 ? Date.now() : 0;

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
          // HIGH-1: Update #bufferOldestTs after each successful drain shift
          this.#bufferOldestTs = this.#buffer.length > 0 ? Date.now() : 0;
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
