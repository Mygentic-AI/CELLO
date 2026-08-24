/**
 * CELLO Relay — per-depositor rate limiting for content-park deposits (`DOD-M15-RELAYABUSE-1`).
 *
 * ─── Why this exists ──────────────────────────────────────────────────────────────────────────
 *
 * The relay audit's first finding is *"No rate limiting of any kind — not on authentication
 * attempts, not on hash submission, not on gap-fill, not on the liveness query, not on content-park
 * deposits."* The park deposit is the sharpest of those: it is **unauthenticated by design** (anyone
 * may park ciphertext for anyone), frames are up to 4 MiB, and the store is shared.
 *
 * `DOD-M15-RELAYPARK-1` bounded the store so a flood can no longer fill the disk. **A bound is not a
 * limit.** With bounds alone an attacker still gets to spend the relay's CPU, its stream slots and
 * its disk writes at line rate, and still gets to churn a victim's mailbox against the per-recipient
 * cap indefinitely. The bound decides how much can be *stored*; this decides how fast it can be
 * *attempted*.
 *
 * ─── What it keys on, and the honest limit of that ────────────────────────────────────────────
 *
 * The **Noise-authenticated peer id** of whoever opened the stream. That is a real cryptographic
 * identity for the connection, and it was available all along — `CelloStreamHandler` passes it and
 * the park handler discarded it, which is why an earlier version of this work claimed a deposit
 * "carries no depositor identity". It does.
 *
 * ⚠️ **But a peer id is not a CELLO agent identity, and it is cheap to rotate.** A determined
 * attacker mints a fresh transport key per burst and gets a fresh bucket each time. So this raises
 * the cost of a flood and makes the ordinary abusive case (one peer, many deposits) ineffective; it
 * is NOT a hard bound, and the honest description is a speed bump rather than a gate. The hard bound
 * is the store's, which is why both exist.
 *
 * ─── Shape ───────────────────────────────────────────────────────────────────────────────────
 *
 * A fixed-window counter, deliberately, rather than a token bucket: the window boundary is legible
 * in a log ("42 deposits in the last minute, limit 30"), an operator can reason about it without
 * knowing the algorithm, and there is no accrued-credit surprise where a quiet peer suddenly bursts.
 */

/** How many deposits one peer may attempt per window, and how long the window is. */
export interface DepositRateLimitConfig {
  maxPerWindow: number;
  windowMs: number;
}

/**
 * Default: 30 deposits per minute per peer.
 *
 * Sized from what the path is FOR — parking messages for a counterparty who is offline. A busy
 * legitimate sender parks a handful; thirty a minute is far above any real conversation and far
 * below what a flood needs to be effective. Chosen to be boring rather than clever: the number an
 * operator would guess if asked.
 */
export const DEFAULT_DEPOSIT_RATE_LIMIT: DepositRateLimitConfig = { maxPerWindow: 30, windowMs: 60_000 };

interface Window {
  /** When the current window began. */
  startedAt: number;
  count: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  /** Attempts by this peer in the current window, INCLUDING the one just judged. */
  count: number;
  /** Milliseconds until this peer's window resets. Zero when allowed. */
  retryAfterMs: number;
}

/**
 * Per-peer fixed-window limiter.
 *
 * ⚠️ **Bounded memory is part of the contract, not an optimisation.** A limiter keyed on an
 * attacker-chosen identifier is itself a memory-exhaustion surface — the exact defect found in the
 * park store, where every deposit created a bucket that nothing ever removed. Idle windows are
 * dropped on each call, so the map holds only peers seen within one window.
 */
export class DepositRateLimiter {
  readonly #config: DepositRateLimitConfig;
  readonly #windows = new Map<string, Window>();

  constructor(config: DepositRateLimitConfig = DEFAULT_DEPOSIT_RATE_LIMIT) {
    this.#config = config;
  }

  /**
   * Judge one deposit attempt from `peerId`.
   *
   * ⚠️ An ABSENT peer id is allowed through, and that is a deliberate choice rather than an
   * oversight. It means the transport did not give us an authenticated identity for this stream, and
   * refusing on that basis would turn a limiter into an availability risk driven by a transport
   * detail — a deposit path that starts refusing everyone because a field went missing is a worse
   * outage than the abuse it prevents. The store's bounds still apply to those deposits.
   */
  check(peerId: string | undefined, now: number = Date.now()): RateLimitDecision {
    this.#evictIdle(now);
    if (peerId === undefined || peerId.length === 0) {
      return { allowed: true, count: 0, retryAfterMs: 0 };
    }

    const existing = this.#windows.get(peerId);
    if (existing === undefined || now - existing.startedAt >= this.#config.windowMs) {
      this.#windows.set(peerId, { startedAt: now, count: 1 });
      return { allowed: true, count: 1, retryAfterMs: 0 };
    }

    existing.count += 1;
    if (existing.count > this.#config.maxPerWindow) {
      return {
        allowed: false,
        count: existing.count,
        retryAfterMs: Math.max(0, existing.startedAt + this.#config.windowMs - now),
      };
    }
    return { allowed: true, count: existing.count, retryAfterMs: 0 };
  }

  /** Peers currently tracked — for tests and for an operator surface that wants the number. */
  size(): number {
    return this.#windows.size;
  }

  #evictIdle(now: number): void {
    for (const [peer, w] of this.#windows) {
      if (now - w.startedAt >= this.#config.windowMs) this.#windows.delete(peer);
    }
  }
}
