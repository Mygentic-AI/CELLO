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
  // CELLO-M6B-006: track last known healthCheckUrl for no-op comparison
  healthCheckUrl?: string;
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
  // CELLO-M6B-006: track healthCheckUrl per relay for no-op detection
  #relayHealthCheckUrls = new Map<string, string>();

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
   */
  async loadManifest(): Promise<void> {
    let raw: Uint8Array | undefined;
    let lastAttempt = 0;

    // DB-001: retry with exponential backoff on S3 failures
    for (let attempt = 1; attempt <= this.#maxLoadAttempts; attempt++) {
      lastAttempt = attempt;
      try {
        raw = await this.#storage.download("relay-manifest.json");
        break; // success
      } catch (err: unknown) {
        const reason = err instanceof Error ? err.message : String(err);
        this.#logger.error("relay.manifest.load.failed", { reason, attempt });
        if (attempt < this.#maxLoadAttempts) {
          // Exponential backoff: retryDelayMs * 2^(attempt-1), capped at 60s
          const delay = Math.min(this.#retryDelayMs * Math.pow(2, attempt - 1), 60_000);
          await new Promise(r => setTimeout(r, delay));
        } else {
          throw new Error(`Manifest load failed after ${this.#maxLoadAttempts} attempts: ${reason}`);
        }
      }
    }

    if (!raw) {
      const reason = "manifest not found in S3";
      this.#logger.error("relay.manifest.load.failed", { reason, attempt: lastAttempt });
      throw new Error(reason);
    }

    // Parse manifest JSON
    let manifest: RelayPoolManifest;
    try {
      manifest = JSON.parse(new TextDecoder().decode(raw)) as RelayPoolManifest;
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : String(err);
      this.#logger.error("relay.manifest.load.failed", { reason, attempt: 1 });
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
    const applied = this.applyManifest(manifest);
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
   * @returns { ok: true } on success, { ok: false } if version is stale
   */
  applyManifest(manifest: RelayPoolManifest): { ok: boolean } {
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
          healthCheckUrl: relay.healthCheckUrl, // CELLO-M6B-006
        });
      }
      // CELLO-M6B-006: update healthCheckUrl map for no-op detection
      this.#relayHealthCheckUrls.set(relay.relayId, relay.healthCheckUrl);
    }

    // Remove state for relays no longer in the manifest
    for (const relayId of this.#failureState.keys()) {
      if (!newRelayIds.has(relayId)) {
        this.#failureState.delete(relayId);
        this.#relayHealthCheckUrls.delete(relayId); // CELLO-M6B-006
      }
    }

    this.#currentRelays = manifest.relays;

    this.#logger.info("relay.manifest.loaded", {
      signerNodeId: manifest.signedBy,
      relayCount: manifest.relays.length,
      manifestVersion: manifest.version,
    });

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

  /**
   * CELLO-M6B-006: Get the last known healthCheckUrl for a relay.
   * Used by directory to detect no-op registrations.
   * Returns undefined if relay unknown or never registered.
   */
  getRelayHealthCheckUrl(relayId: string): string | undefined {
    return this.#relayHealthCheckUrls.get(relayId);
  }

  /**
   * CELLO-M6B-006: Update the healthCheckUrl for a relay after manifest re-sign.
   * Used by directory after successful manifest upload.
   */
  updateRelayHealthCheckUrl(relayId: string, url: string): void {
    this.#relayHealthCheckUrls.set(relayId, url);
  }

  /**
   * CELLO-M6B-006: Re-sign the relay manifest with updated healthCheckUrl for a relay.
   *
   * Pseudocode:
   *   1. Check if healthCheckUrl changed — if unchanged, return { updated: false, reason: "no_change" }
   *   2. Load current manifest from S3
   *   3. Update the relay entry's healthCheckUrl
   *   4. Increment manifest version
   *   5. Build canonical payload (sorted keys: relays, updatedAt, version — shallow sort only)
   *   6. Sign with keyProvider (RFC 8032 Ed25519)
   *   7. Upload to S3
   *   8. Update in-memory healthCheckUrl map
   *   9. Log relay.manifest.updated with required context fields
   *   10. Return { updated: true, version: newVersion }
   *
   * @param params.relayId - relay to update
   * @param params.healthCheckUrl - new health check URL
   * @param params.keyProvider - directory node private key for signing
   * @returns { updated: true, version } on success, { updated: false, reason } if no-op or error
   */
  async reSignManifestForRelay(params: {
    relayId: string;
    healthCheckUrl: string;
    keyProvider: import("@cello-protocol/crypto").KeyProvider;
  }): Promise<{ updated: true; version: number } | { updated: false; reason: string }> {
    const { relayId, healthCheckUrl, keyProvider } = params;

    // 1. Check if URL changed
    const previousUrl = this.#relayHealthCheckUrls.get(relayId);
    if (previousUrl === healthCheckUrl) {
      return { updated: false, reason: "no_change" };
    }

    // 2. Load current manifest
    let manifestBytes: Uint8Array | undefined;
    try {
      manifestBytes = await this.#storage.download("relay-manifest.json");
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to load manifest: ${reason}`);
    }

    if (!manifestBytes) {
      throw new Error("manifest_not_found");
    }

    const manifest: RelayPoolManifest = JSON.parse(new TextDecoder().decode(manifestBytes));

    // 3. Update relay entry
    const relayEntry = manifest.relays.find(r => r.relayId === relayId);
    if (!relayEntry) {
      throw new Error(`relay_not_in_manifest: ${relayId}`);
    }

    relayEntry.healthCheckUrl = healthCheckUrl;

    // 4. Increment version
    manifest.version += 1;
    manifest.updatedAt = new Date().toISOString();

    // 5. Build canonical payload (sorted keys: relays, updatedAt, version — shallow sort only)
    const canonicalPayload = buildCanonicalPayload(manifest);

    // 6. Sign with keyProvider (RFC 8032 Ed25519)
    const signature = await keyProvider.sign(canonicalPayload);
    manifest.signature = Buffer.from(signature).toString("hex");
    // signedBy is hex string of the public key
    const pubkey = await keyProvider.getPublicKey();
    manifest.signedBy = Buffer.from(pubkey).toString("hex");

    // 7. Upload to S3
    await this.#storage.upload(
      "relay-manifest.json",
      new TextEncoder().encode(JSON.stringify(manifest))
    );

    // 8. Update in-memory healthCheckUrl map
    this.#relayHealthCheckUrls.set(relayId, healthCheckUrl);

    // 9. Log relay.manifest.updated with required context fields
    this.#logger.info("relay.manifest.updated", {
      relayId,
      region: relayEntry.region,
      manifestVersion: manifest.version,
      healthCheckUrl,
    });

    // 10. Return success
    return { updated: true, version: manifest.version };
  }
}
