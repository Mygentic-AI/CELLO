/**
 * RelayPoolManager — signed relay pool manifest, health checks, and latency-based
 * session assignment (CELLO-RELAY-001).
 *
 * ─── Phase P Pseudocode ──────────────────────────────────────────────────────
 *
 * The manifest signature scheme (RFC 8032 Ed25519):
 *   signed payload = canonical JSON of { version, updatedAt, relays }
 *   canonical JSON = sorted keys, no whitespace, UTF-8 encoded
 *   the "signedBy" and "signature" fields are EXCLUDED from the signed payload
 *
 * loadManifest():
 *   attempt = 1..maxLoadAttempts:
 *     try: raw = await storage.download("relay-manifest.json")
 *     if raw === undefined: throw new Error("manifest not found in S3")
 *     catch: log relay.manifest.load.failed { reason, attempt }
 *            wait retryDelayMs * 2^(attempt-1) before next attempt
 *   parse JSON → RelayPoolManifest
 *   validate: signedBy, signature, version, relays fields present
 *   build canonical payload: canonicalJson({ version, updatedAt, relays })
 *   verify: ed25519.verify(hexToBytes(signature), payload, hexToBytes(signerPublicKeyHex))
 *   if fails: log relay.manifest.invalid { reason: 'signature_verification_failed', signerNodeId }
 *             throw ManifestError
 *   call applyManifest() to check version monotonicity and update pool state
 *   start health check loop
 *
 * applyManifest(manifest):
 *   if manifest.version <= currentVersion:
 *     log relay.manifest.version.stale { currentVersion, receivedVersion: manifest.version }
 *     return { ok: false }
 *   update currentVersion = manifest.version
 *   for each relay in manifest.relays:
 *     if not in failureState: init { consecutiveFailures: 0, consecutiveSuccesses: 0,
 *                                    available: true, unavailableSince: undefined }
 *   remove relay state for relays no longer in manifest
 *   log relay.manifest.loaded { signerNodeId: manifest.signedBy, relayCount, manifestVersion }
 *   return { ok: true }
 *
 * #runHealthChecks():
 *   for each relay in currentRelays:
 *     skip if relay.status === 'draining'
 *     startTime = Date.now()
 *     try: result = await pingFn(relay.healthCheckUrl)
 *     catch: result = { ok: false, reason: err.message }
 *     latencyMs = Date.now() - startTime
 *     state = failureState.get(relay.relayId)
 *     if result.ok:
 *       state.consecutiveFailures = 0
 *       state.consecutiveSuccesses++
 *       if !state.available && state.consecutiveSuccesses >= failureThreshold:
 *         state.available = true
 *         downtimeDurationMs = Date.now() - (state.unavailableSince ?? Date.now())
 *         state.unavailableSince = undefined
 *         log relay.pool.recovered { relayId, downtimeDurationMs }
 *       log relay.health.check.passed { relayId, latencyMs }
 *     else:
 *       state.consecutiveSuccesses = 0
 *       state.consecutiveFailures++
 *       if state.available && state.consecutiveFailures >= failureThreshold:
 *         state.available = false
 *         state.unavailableSince = Date.now()
 *         log relay.health.check.failed { relayId, consecutiveFailures: failureThreshold, reason }
 *
 * pickRelay(rttMeasurements?):
 *   available = currentRelays.filter(r => r.status === 'active' && isAvailable(r.relayId))
 *   if available.length === 0:
 *     log relay.pool.unavailable { totalRelays: currentRelays.length, availableCount: 0 }
 *     return null
 *   if rttMeasurements provided:
 *     withRtt = available.filter(r => r.relayId in rttMeasurements)
 *     if withRtt.length > 0:
 *       return withRtt.sort by rttMeasurements[relayId] ascending [0]
 *   return available.sort by consecutiveFailures ascending [0]
 *
 * ─── End Phase P ─────────────────────────────────────────────────────────────
 */

import { ed25519 } from "@noble/curves/ed25519.js";
import type { CloudStorageProvider, Logger } from "@cello-protocol/interfaces";

// ─── Manifest types ───────────────────────────────────────────────────────────

export interface RelayManifestEntry {
  relayId: string;          // Ed25519 public key hex
  endpoint: string;         // WebSocket URL (e.g. wss://relay.example.com)
  region: string;           // AWS region
  status: "active" | "draining";
  healthCheckUrl: string;   // http://{private-ip}:4000/health (VPC-internal)
  /** libp2p Peer ID (base58btc encoded). Required for session assignment. */
  peerId?: string;
  /** libp2p multiaddrs for client connection (e.g. /dns4/relay.example.com/tcp/443/wss/p2p/...) */
  multiaddrs?: string[];
}

export interface RelayPoolManifest {
  version: number;          // monotonically increasing integer
  signedBy: string;         // node_id of the signing directory node
  signature: string;        // Ed25519 signature hex over canonical JSON of body
  updatedAt: string;        // ISO 8601 UTC
  relays: RelayManifestEntry[];
}

// ─── Ping function type ───────────────────────────────────────────────────────

export interface PingResult {
  ok: boolean;
  latencyMs?: number;
  reason?: string;
}

export type PingFn = (url: string) => Promise<PingResult>;

// ─── Internal relay state ─────────────────────────────────────────────────────

interface RelayState {
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  available: boolean;
  unavailableSince: number | undefined;
}

// ─── Configuration ────────────────────────────────────────────────────────────

export interface RelayPoolManagerOptions {
  /** CloudStorageProvider to read relay-manifest.json from. */
  storage: CloudStorageProvider;
  /** Ed25519 public key hex of the signing directory node (lowest node_id). */
  signerPublicKeyHex: string;
  /** Injected logger — never console.log. */
  logger: Logger;
  /** Health check interval in ms. Default: 30_000. */
  pingIntervalMs?: number;
  /** Number of consecutive failures before marking unavailable. Default: 3. */
  failureThreshold?: number;
  /** Injected ping function for testability. Default: real HTTP GET. */
  pingFn?: PingFn;
  /** Maximum manifest load attempts before giving up. Default: 5. */
  maxLoadAttempts?: number;
  /** Base retry delay in ms for S3 backoff. Default: 1_000. */
  retryDelayMs?: number;
}

// ─── Default ping function ────────────────────────────────────────────────────

/**
 * Default ping function: HTTP GET to the relay's health check endpoint.
 * Uses the built-in fetch API (Node.js 18+).
 */
async function defaultPingFn(url: string): Promise<PingResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (res.ok) {
      return { ok: true };
    }
    return { ok: false, reason: `HTTP ${res.status}` };
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : String(err);
    return { ok: false, reason };
  } finally {
    clearTimeout(timeout);
  }
}

// ─── Manifest signature verification ─────────────────────────────────────────

/**
 * Build canonical JSON of the manifest body (excludes signedBy and signature).
 * Canonical JSON: sorted keys, no whitespace, UTF-8 encoded per RELAY-001 signing rules.
 */
function buildCanonicalPayload(manifest: RelayPoolManifest): Uint8Array {
  const body: Record<string, unknown> = {
    version: manifest.version,
    updatedAt: manifest.updatedAt,
    relays: manifest.relays,
  };
  // Sorted keys per signing rules
  const sorted = Object.fromEntries(
    Object.keys(body).sort().map(k => [k, body[k]]),
  );
  return new TextEncoder().encode(JSON.stringify(sorted));
}

// ─── RelayPoolManager ─────────────────────────────────────────────────────────

export class RelayPoolManager {
  readonly #storage: CloudStorageProvider;
  readonly #signerPublicKeyHex: string;
  readonly #logger: Logger;
  readonly #pingIntervalMs: number;
  readonly #failureThreshold: number;
  readonly #pingFn: PingFn;
  readonly #maxLoadAttempts: number;
  readonly #retryDelayMs: number;

  #currentVersion = 0;
  #currentRelays: RelayManifestEntry[] = [];
  #failureState = new Map<string, RelayState>();
  #healthCheckTimer: ReturnType<typeof setInterval> | undefined;
  #pollInterval: ReturnType<typeof setInterval> | undefined;

  constructor(opts: RelayPoolManagerOptions) {
    this.#storage = opts.storage;
    this.#signerPublicKeyHex = opts.signerPublicKeyHex;
    this.#logger = opts.logger;
    this.#pingIntervalMs = opts.pingIntervalMs ?? 30_000;
    this.#failureThreshold = opts.failureThreshold ?? 3;
    this.#pingFn = opts.pingFn ?? defaultPingFn;
    this.#maxLoadAttempts = opts.maxLoadAttempts ?? 5;
    this.#retryDelayMs = opts.retryDelayMs ?? 1_000;
  }

  /**
   * Load and verify the relay pool manifest from S3.
   * Logs relay.manifest.loaded on success.
   * Throws on signature verification failure or exhausted retries.
   * Starts the health check loop on success.
   *
   * @param maxAttempts - override the configured maxLoadAttempts for this call only.
   * @param suppressLoadLog - when true, skip relay.manifest.load.failed ERROR logging
   *   and throw the raw S3 error (not wrapped). **Use ONLY in the poll loop context.**
   *   The poll loop handles transient S3 failures at the appropriate severity (WARN),
   *   so no ERROR should fire for an expected transient condition that resolves on the
   *   next poll cycle. This flag ensures exactly one event fires (relay.manifest.poll.failed
   *   at WARN) rather than relay.manifest.load.failed at ERROR followed by
   *   relay.manifest.poll.failed at WARN. Do not use this flag in startup or manual
   *   load paths where ERROR-level logging is correct.
   * @param suppressLoadedLog - when true, skip relay.manifest.loaded logging.
   *   Used by the poll loop (passed to applyManifest()) so that polling emits only
   *   relay.manifest.refreshed, not both relay.manifest.loaded and relay.manifest.refreshed.
   */
  async loadManifest(maxAttempts?: number, suppressLoadLog?: boolean, suppressLoadedLog = false): Promise<void> {
    let raw: Uint8Array | undefined;
    let lastAttempt = 0;
    const effectiveMaxAttempts = maxAttempts ?? this.#maxLoadAttempts;

    // DB-001: retry with exponential backoff on S3 failures
    for (let attempt = 1; attempt <= effectiveMaxAttempts; attempt++) {
      lastAttempt = attempt;
      try {
        raw = await this.#storage.download("relay-manifest.json");
        break; // success
      } catch (err: unknown) {
        const reason = err instanceof Error ? err.message : String(err);
        if (!suppressLoadLog) {
          this.#logger.error("relay.manifest.load.failed", { reason, attempt });
        }
        if (attempt < effectiveMaxAttempts) {
          // Exponential backoff: retryDelayMs * 2^(attempt-1), capped at 60s
          const delay = Math.min(this.#retryDelayMs * Math.pow(2, attempt - 1), 60_000);
          await new Promise(r => setTimeout(r, delay));
        } else if (suppressLoadLog) {
          // Re-throw the raw error so the poll loop gets the original S3 error
          // message in relay.manifest.poll.failed.reason — not the internal
          // "Manifest load failed after N attempts: ..." wrapper.
          throw err;
        } else {
          throw new Error(`Manifest load failed after ${effectiveMaxAttempts} attempts: ${reason}`);
        }
      }
    }

    if (!raw) {
      const reason = "manifest not found in S3";
      if (!suppressLoadLog) {
        this.#logger.error("relay.manifest.load.failed", { reason, attempt: lastAttempt });
      }
      throw new Error(reason);
    }

    // Parse manifest JSON
    let manifest: RelayPoolManifest;
    try {
      manifest = JSON.parse(new TextDecoder().decode(raw)) as RelayPoolManifest;
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : String(err);
      if (!suppressLoadLog) {
        this.#logger.error("relay.manifest.load.failed", { reason, attempt: 1 });
      }
      throw new Error(`Manifest JSON parse failed: ${reason}`);
    }

    // Validate required fields before signature verification
    if (!manifest.signedBy || !manifest.signature) {
      this.#logger.error("relay.manifest.invalid", {
        reason: "signature_verification_failed",
        signerNodeId: manifest.signedBy ?? "(missing)",
      });
      throw new Error("Manifest missing signature or signedBy fields");
    }

    // Verify Ed25519 signature over canonical JSON of { version, updatedAt, relays }
    // RFC 8032: Ed25519 signature verification
    const payload = buildCanonicalPayload(manifest);
    let signatureValid = false;
    try {
      const sigBytes = Buffer.from(manifest.signature, "hex");
      const pubKeyBytes = Buffer.from(this.#signerPublicKeyHex, "hex");
      signatureValid = ed25519.verify(sigBytes, payload, pubKeyBytes);
    } catch {
      signatureValid = false;
    }

    if (!signatureValid) {
      this.#logger.error("relay.manifest.invalid", {
        reason: "signature_verification_failed",
        signerNodeId: manifest.signedBy,
      });
      throw new Error("Manifest signature verification failed");
    }

    // Apply the manifest (checks version monotonicity, updates pool state)
    const applied = this.applyManifest(manifest, suppressLoadedLog);
    if (!applied.ok) {
      throw new Error(`Manifest rejected: version ${manifest.version} is not higher than current ${this.#currentVersion}`);
    }

    // Start health check loop
    this.#startHealthChecks();
  }

  /**
   * Apply an already-verified manifest to in-memory pool state.
   * Caller is responsible for verifying the manifest signature before calling.
   * Use loadManifest() for the full load-verify-apply flow.
   *
   * Checks version monotonicity (SI-003), updates relay pool state.
   * Called by loadManifest() after signature verification.
   * Exposed for testing (allows testing staleness rejection separately from sig verification).
   *
   * @param suppressLoadedLog - when true, skip relay.manifest.loaded logging.
   *   Used by the poll loop so that polling emits only relay.manifest.refreshed
   *   (the authoritative "poll picked up new manifest" signal), not both
   *   relay.manifest.loaded and relay.manifest.refreshed for the same event.
   * @returns { ok: true } on success, { ok: false } if version is stale
   */
  applyManifest(manifest: RelayPoolManifest, suppressLoadedLog = false): { ok: boolean } {
    // SI-003: version must strictly increase
    if (manifest.version <= this.#currentVersion) {
      this.#logger.warn("relay.manifest.version.stale", {
        currentVersion: this.#currentVersion,
        receivedVersion: manifest.version,
      });
      return { ok: false };
    }

    // Update version
    this.#currentVersion = manifest.version;

    // Update relay pool state
    const newRelayIds = new Set(manifest.relays.map(r => r.relayId));

    // Initialize state for new relays
    for (const relay of manifest.relays) {
      if (!this.#failureState.has(relay.relayId)) {
        this.#failureState.set(relay.relayId, {
          consecutiveFailures: 0,
          consecutiveSuccesses: 0,
          available: true,
          unavailableSince: undefined,
        });
      }
    }

    // Remove state for relays no longer in the manifest
    for (const relayId of this.#failureState.keys()) {
      if (!newRelayIds.has(relayId)) {
        this.#failureState.delete(relayId);
      }
    }

    this.#currentRelays = manifest.relays;

    if (!suppressLoadedLog) {
      this.#logger.info("relay.manifest.loaded", {
        signerNodeId: manifest.signedBy,
        relayCount: manifest.relays.length,
        manifestVersion: manifest.version,
      });
    }

    return { ok: true };
  }

  /**
   * Start the health check interval.
   * Idempotent — safe to call multiple times.
   */
  #startHealthChecks(): void {
    if (this.#healthCheckTimer !== undefined) return;

    // Run first check immediately (don't wait for the first interval)
    void this.#runHealthChecks();

    this.#healthCheckTimer = setInterval(() => {
      void this.#runHealthChecks();
    }, this.#pingIntervalMs);

    // Allow Node.js to exit even if the timer is still running
    if (typeof this.#healthCheckTimer === "object" && "unref" in this.#healthCheckTimer) {
      (this.#healthCheckTimer as NodeJS.Timeout).unref();
    }
  }

  /**
   * Run one round of health checks against all relays concurrently.
   * AC-003: logs relay.health.check.passed on success.
   * AC-004: logs relay.health.check.failed on 3 consecutive failures.
   * AC-005: logs relay.pool.recovered on 3 consecutive successes after unavailability.
   */
  async #runHealthChecks(): Promise<void> {
    await Promise.allSettled(
      this.#currentRelays.map(relay => this.#pingOne(relay)),
    );
  }

  /**
   * Ping a single relay and update its health state.
   */
  async #pingOne(relay: RelayManifestEntry): Promise<void> {
    const state = this.#failureState.get(relay.relayId);
    if (!state) return;

    const startTime = Date.now();
    let result: PingResult;
    try {
      result = await this.#pingFn(relay.healthCheckUrl);
    } catch (err: unknown) {
      result = { ok: false, reason: err instanceof Error ? err.message : String(err) };
    }
    const latencyMs = Date.now() - startTime;

    if (result.ok) {
      state.consecutiveFailures = 0;
      state.consecutiveSuccesses++;

      // AC-005: relay recovers after failureThreshold consecutive successes
      if (!state.available && state.consecutiveSuccesses >= this.#failureThreshold) {
        const downtimeDurationMs = state.unavailableSince !== undefined
          ? Date.now() - state.unavailableSince
          : 0;
        state.available = true;
        state.unavailableSince = undefined;
        this.#logger.info("relay.pool.recovered", { relayId: relay.relayId, downtimeDurationMs });
      }

      this.#logger.info("relay.health.check.passed", { relayId: relay.relayId, latencyMs });
    } else {
      state.consecutiveSuccesses = 0;
      state.consecutiveFailures++;

      // AC-004: mark unavailable after failureThreshold consecutive failures
      if (state.available && state.consecutiveFailures >= this.#failureThreshold) {
        state.available = false;
        state.unavailableSince = Date.now();
        this.#logger.warn("relay.health.check.failed", {
          relayId: relay.relayId,
          consecutiveFailures: this.#failureThreshold,
          reason: result.reason ?? "unknown",
        });
      }
    }
  }

  /**
   * Pick the best available relay for a new session.
   *
   * AC-007: if rttMeasurements provided, assigns the lowest-RTT available relay.
   * Fallback: lowest consecutive failure count.
   * AC-006: returns null if all relays are unavailable.
   * AC-009: only relays present in the verified manifest are eligible.
   * AC-012: draining relays are excluded.
   */
  pickRelay(rttMeasurements?: Record<string, number>): RelayManifestEntry | null {
    // AC-009 / AC-012: only active (not draining) relays from the manifest
    const available = this.#currentRelays.filter(r => {
      if (r.status !== "active") return false; // AC-012: draining excluded
      const state = this.#failureState.get(r.relayId);
      return state?.available === true;
    });

    if (available.length === 0) {
      // AC-006: log relay.pool.unavailable when all relays are unavailable
      this.#logger.error("relay.pool.unavailable", {
        totalRelays: this.#currentRelays.length,
        availableCount: 0,
      });
      return null;
    }

    // AC-007: RTT-based selection
    if (rttMeasurements && Object.keys(rttMeasurements).length > 0) {
      const withRtt = available.filter(r => r.relayId in rttMeasurements);
      if (withRtt.length > 0) {
        // Sort by RTT ascending, return lowest
        withRtt.sort((a, b) => (rttMeasurements[a.relayId]! - rttMeasurements[b.relayId]!));
        return withRtt[0]!;
      }
    }

    // Fallback: sort by consecutive failure count ascending
    const sorted = available.slice().sort((a, b) => {
      const stateA = this.#failureState.get(a.relayId);
      const stateB = this.#failureState.get(b.relayId);
      return (stateA?.consecutiveFailures ?? 0) - (stateB?.consecutiveFailures ?? 0);
    });
    return sorted[0]!;
  }

  /**
   * Start the manifest poll loop.
   * M6B-008: Polls S3 for manifest updates every intervalMs milliseconds.
   * When a newer manifest version is retrieved, applyManifest() updates the relay pool.
   * Transient S3 failures are logged but do not stop the poll loop.
   * Safe to call multiple times — idempotent.
   *
   * @param intervalMs — poll interval in milliseconds (default: 120_000 = 2 minutes)
   */
  startPolling(intervalMs: number): void {
    if (this.#pollInterval !== undefined) {
      // Already polling — no-op
      return;
    }

    this.#pollInterval = setInterval(() => {
      const versionBefore = this.#currentVersion;
      // Pass maxAttempts=1, suppressLoadLog=true, suppressLoadedLog=true:
      // - suppressLoadLog: transient S3 failure emits exactly one WARN event
      //   (relay.manifest.poll.failed), not ERROR (relay.manifest.load.failed)
      // - suppressLoadedLog: poll emits only relay.manifest.refreshed (the authoritative
      //   "poll picked up new manifest" signal), not both relay.manifest.loaded and
      //   relay.manifest.refreshed for the same occurrence
      void this.loadManifest(1, true, true)
        .then(() => {
          // loadManifest() calls applyManifest() internally. With suppressLoadedLog=true,
          // relay.manifest.loaded does NOT fire. Only relay.manifest.refreshed fires.
          if (this.#currentVersion > versionBefore) {
            this.#logger.info("relay.manifest.refreshed", {
              manifestVersion: this.#currentVersion,
              relayCount: this.#currentRelays.length,
            });
          } else {
            // Defensive path: loadManifest() throws on stale versions, so control should
            // never reach this else branch. If it does (e.g. a future loadManifest() change
            // stops throwing on stale), log noop. Both currentVersion and receivedVersion
            // reflect versionBefore since no update was applied.
            this.#logger.debug("relay.manifest.poll.noop", {
              currentVersion: versionBefore,
              receivedVersion: versionBefore,
            });
          }
        })
        .catch((err: unknown) => {
          const reason = err instanceof Error ? err.message : String(err);
          // Distinguish stale-version (no-op) from real failure
          if (reason.startsWith("Manifest rejected: version")) {
            this.#logger.debug("relay.manifest.poll.noop", {
              currentVersion: versionBefore,
              receivedVersion: versionBefore,
            });
          } else {
            this.#logger.warn("relay.manifest.poll.failed", {
              reason,
              currentVersion: this.#currentVersion,
            });
          }
        });
    }, intervalMs);

    this.#logger.info("relay.manifest.poll.started", { intervalMs });

    // Allow Node.js to exit even if the poll timer is still running
    if (typeof this.#pollInterval === "object" && "unref" in this.#pollInterval) {
      (this.#pollInterval as NodeJS.Timeout).unref();
    }
  }

  /**
   * Stop the manifest poll loop.
   * Safe to call multiple times — idempotent.
   */
  stopPolling(): void {
    if (this.#pollInterval !== undefined) {
      clearInterval(this.#pollInterval);
      this.#pollInterval = undefined;
    }
  }

  /**
   * Stop the health check interval. Used in tests to avoid open handles.
   */
  stop(): void {
    if (this.#healthCheckTimer !== undefined) {
      clearInterval(this.#healthCheckTimer);
      this.#healthCheckTimer = undefined;
    }
  }

  /** Expose current relays for testing and inspection. */
  get relays(): readonly RelayManifestEntry[] {
    return this.#currentRelays;
  }

  /** Expose current manifest version for testing. */
  get currentVersion(): number {
    return this.#currentVersion;
  }
}
