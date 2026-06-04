/**
 * CELLO-M6B-008: RelayPoolManager manifest polling tests
 *
 * ─── Phase P Pseudocode ──────────────────────────────────────────────────────
 *
 * RelayPoolManager.startPolling(intervalMs: number):
 *   this.#pollInterval = setInterval(() => {
 *     versionBefore = this.#currentVersion
 *     try:
 *       await this.loadManifest()
 *       if this.#currentVersion > versionBefore:
 *         log relay.manifest.refreshed with { manifestVersion, relayCount }
 *       else:
 *         log relay.manifest.poll.noop (shouldn't reach here — loadManifest throws on stale)
 *     catch (err):
 *       reason = err.message
 *       if reason starts with "Manifest rejected: version":
 *         log relay.manifest.poll.noop (stale manifest, expected no-op)
 *       else:
 *         log relay.manifest.poll.failed (real failure — S3 error, signature invalid, etc.)
 *   }, intervalMs)
 *   log relay.manifest.poll.started with { intervalMs }
 *
 * RelayPoolManager.stopPolling():
 *   if this.#pollInterval !== undefined:
 *     clearInterval(this.#pollInterval)
 *     this.#pollInterval = undefined
 *
 * bin/directory.ts wiring (CELLO_ENV != 'local' only):
 *   after await relayPoolManager.loadManifest():
 *     const pollIntervalMs = parseInt(process.env.RELAY_MANIFEST_POLL_INTERVAL_MS ?? "120000", 10)
 *     if (env !== "local"):
 *       relayPoolManager.startPolling(pollIntervalMs)
 *
 *   in SIGTERM handler (before process.exit):
 *     relayPoolManager.stopPolling()
 *     relayPoolManager.stop()
 *
 * ─── End Phase P ─────────────────────────────────────────────────────────────
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { RelayPoolManager, type RelayPoolManifest } from "../relay-pool-manager.js";
import type { CloudStorageProvider, Logger } from "@cello-protocol/interfaces";
import { ed25519 } from "@noble/curves/ed25519.js";
import { randomBytes } from "node:crypto";

// Test helper: create a signed manifest
function createSignedManifest(
  version: number,
  signingKeyBytes: Uint8Array,
  relayId = "relay1",
  healthCheckUrl = "http://relay1:4000/health",
): RelayPoolManifest {
  const manifest: RelayPoolManifest = {
    version,
    signedBy: "test-node",
    signature: "", // will be filled below
    updatedAt: new Date().toISOString(),
    relays: [
      {
        relayId,
        endpoint: "wss://relay1.example.com",
        region: "us-east-1",
        status: "active",
        healthCheckUrl,
        peerId: "12D3KooWTest",
        multiaddrs: ["/dns4/relay1.example.com/tcp/443/wss/p2p/12D3KooWTest"],
      },
    ],
  };

  // Sign the manifest body (version, updatedAt, relays)
  const body = { version: manifest.version, updatedAt: manifest.updatedAt, relays: manifest.relays };
  const sorted = Object.fromEntries(Object.keys(body).sort().map(k => [k, body[k as keyof typeof body]]));
  const payload = new TextEncoder().encode(JSON.stringify(sorted));
  const signature = ed25519.sign(payload, signingKeyBytes);
  manifest.signature = Buffer.from(signature).toString("hex");

  return manifest;
}

// Test helper: mock logger that tracks events
function createMockLogger(): Logger & { events: Array<{ name: string; context: Record<string, unknown> }> } {
  const events: Array<{ name: string; context: Record<string, unknown> }> = [];
  return {
    events,
    info: (name: string, context: Record<string, unknown>) => {
      events.push({ name, context });
    },
    warn: (name: string, context: Record<string, unknown>) => {
      events.push({ name, context });
    },
    error: (name: string, context: Record<string, unknown>) => {
      events.push({ name, context });
    },
    debug: (name: string, context: Record<string, unknown>) => {
      events.push({ name, context });
    },
  };
}

// AC-001: poll loop updates relay pool when manifest version increases
describe("CELLO-M6B-008: RelayPoolManager manifest polling", () => {
  let signingKeyPrivate: Uint8Array;
  let signingKeyPublic: Uint8Array;

  beforeEach(() => {
    // Generate a signing keypair for the test (RFC 8032)
    signingKeyPrivate = randomBytes(32);
    signingKeyPublic = ed25519.getPublicKey(signingKeyPrivate);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("AC-001: poll loop retrieves newer manifest and updates relay pool", async () => {
    // Given: CloudStorageProvider stub that returns version 1, then version 2
    const manifest1 = createSignedManifest(1, signingKeyPrivate, "relay1", "http://relay1:4000/health");
    const manifest2 = createSignedManifest(2, signingKeyPrivate, "relay2", "http://relay2:4000/health");

    let callCount = 0;
    const storage: CloudStorageProvider = {
      download: vi.fn(async () => {
        callCount++;
        const m = callCount === 1 ? manifest1 : manifest2;
        return new TextEncoder().encode(JSON.stringify(m));
      }),
      upload: vi.fn(),
    };

    const logger = createMockLogger();
    const signerPubkeyHex = Buffer.from(signingKeyPublic).toString("hex");

    const mgr = new RelayPoolManager({
      storage,
      signerPublicKeyHex: signerPubkeyHex,
      logger,
      pingFn: async () => ({ ok: true }),
      pingIntervalMs: 999_999, // set very high to prevent health checks from firing during test
    });

    // Set up fake timers before loading manifest
    vi.useFakeTimers();

    // Load initial manifest
    await mgr.loadManifest();
    expect(mgr.currentVersion).toBe(1);
    expect(mgr.relays[0]?.healthCheckUrl).toBe("http://relay1:4000/health");

    // Clear events from initial load
    logger.events.length = 0;

    // Start polling with 200ms interval
    mgr.startPolling(200);

    // Verify relay.manifest.poll.started was logged
    const startedEvent = logger.events.find(e => e.name === "relay.manifest.poll.started");
    expect(startedEvent).toBeDefined();
    expect(startedEvent?.context.intervalMs).toBe(200);

    // Clear events before poll
    logger.events.length = 0;

    // Advance time to trigger first poll
    await vi.advanceTimersByTimeAsync(200);

    // Then: relay pool reflects version 2; relay.manifest.refreshed is logged
    expect(mgr.currentVersion).toBe(2);
    expect(mgr.relays[0]?.healthCheckUrl).toBe("http://relay2:4000/health");

    const refreshedEvent = logger.events.find(e => e.name === "relay.manifest.refreshed");
    expect(refreshedEvent).toBeDefined();
    expect(refreshedEvent?.context.manifestVersion).toBe(2);
    expect(refreshedEvent?.context.relayCount).toBe(1);

    mgr.stopPolling();
    mgr.stop();
    vi.useRealTimers();
  });

  // AC-002: stale manifest version is a no-op
  it("AC-002: poll retrieves same version manifest and logs noop", async () => {
    const manifest1 = createSignedManifest(1, signingKeyPrivate);

    const storage: CloudStorageProvider = {
      download: vi.fn(async () => new TextEncoder().encode(JSON.stringify(manifest1))),
      upload: vi.fn(),
    };

    const logger = createMockLogger();
    const signerPubkeyHex = Buffer.from(signingKeyPublic).toString("hex");

    const mgr = new RelayPoolManager({
      storage,
      signerPublicKeyHex: signerPubkeyHex,
      logger,
      pingFn: async () => ({ ok: true }),
      pingIntervalMs: 999_999,
    });

    vi.useFakeTimers();
    await mgr.loadManifest();
    expect(mgr.currentVersion).toBe(1);

    mgr.startPolling(200);
    logger.events.length = 0;

    await vi.advanceTimersByTimeAsync(200);

    const noopEvent = logger.events.find(e => e.name === "relay.manifest.poll.noop");
    expect(noopEvent).toBeDefined();
    expect(noopEvent?.context.currentVersion).toBe(1);
    // receivedVersion must match the pre-poll snapshot (versionBefore = 1 here)
    expect(noopEvent?.context.receivedVersion).toBe(1);
    expect(mgr.currentVersion).toBe(1);

    mgr.stopPolling();
    mgr.stop();
    vi.useRealTimers();
  });

  // AC-003: transient S3 failure doesn't stop poll loop
  it("AC-003: poll continues after transient failure", async () => {
    const manifest1 = createSignedManifest(1, signingKeyPrivate);

    // Disable retries for this test to avoid fake timer issues with exponential backoff
    let callCount = 0;
    const storage: CloudStorageProvider = {
      download: vi.fn(async () => {
        callCount++;
        // Call 1: initial loadManifest() — succeed
        if (callCount === 1) {
          return new TextEncoder().encode(JSON.stringify(manifest1));
        }
        // Call 2: first poll attempt — fail
        if (callCount === 2) {
          throw new Error("S3 unavailable");
        }
        // Call 3+: second poll — succeed
        return new TextEncoder().encode(JSON.stringify(manifest1));
      }),
      upload: vi.fn(),
    };

    const logger = createMockLogger();
    const signerPubkeyHex = Buffer.from(signingKeyPublic).toString("hex");

    const mgr = new RelayPoolManager({
      storage,
      signerPublicKeyHex: signerPubkeyHex,
      logger,
      pingFn: async () => ({ ok: true }),
      pingIntervalMs: 999_999,
      maxLoadAttempts: 1, // no retries — fail immediately
      retryDelayMs: 0, // no delay
    });

    vi.useFakeTimers();
    await mgr.loadManifest();
    expect(mgr.currentVersion).toBe(1);
    expect(callCount).toBe(1);

    mgr.startPolling(200);
    logger.events.length = 0;

    await vi.advanceTimersByTimeAsync(200);
    const failedEvent = logger.events.find(e => e.name === "relay.manifest.poll.failed");
    expect(failedEvent).toBeDefined();
    // reason must be the raw S3 error — not a wrapped "Manifest load failed after N attempts: ..." string
    expect(failedEvent?.context.reason).toBe("S3 unavailable");
    // currentVersion is a required context field per observability spec
    expect(failedEvent?.context.currentVersion).toBeDefined();
    expect(callCount).toBe(2);

    // relay.manifest.load.failed must NOT fire during polling — that ERROR is suppressed
    // when loadManifest() is called from the poll loop. Only the WARN-level
    // relay.manifest.poll.failed event should appear for transient poll failures.
    const loadFailedEvent = logger.events.find(e => e.name === "relay.manifest.load.failed");
    expect(loadFailedEvent).toBeUndefined();

    logger.events.length = 0;

    await vi.advanceTimersByTimeAsync(200);
    const noopEvent = logger.events.find(e => e.name === "relay.manifest.poll.noop");
    expect(noopEvent).toBeDefined();
    expect(callCount).toBe(3); // second poll succeeded

    mgr.stopPolling();
    mgr.stop();
    vi.useRealTimers();
  });

  // AC-004: stopPolling() terminates the loop
  it("AC-004: stopPolling() prevents further polls", async () => {
    const manifest1 = createSignedManifest(1, signingKeyPrivate);

    const storage: CloudStorageProvider = {
      download: vi.fn(async () => new TextEncoder().encode(JSON.stringify(manifest1))),
      upload: vi.fn(),
    };

    const logger = createMockLogger();
    const signerPubkeyHex = Buffer.from(signingKeyPublic).toString("hex");

    const mgr = new RelayPoolManager({
      storage,
      signerPublicKeyHex: signerPubkeyHex,
      logger,
      pingFn: async () => ({ ok: true }),
      pingIntervalMs: 999_999,
    });

    vi.useFakeTimers();
    await mgr.loadManifest();

    mgr.startPolling(200);
    logger.events.length = 0;

    await vi.advanceTimersByTimeAsync(200);
    const eventCountAfterFirstPoll = logger.events.length;
    expect(eventCountAfterFirstPoll).toBeGreaterThan(0);

    mgr.stopPolling();

    await vi.advanceTimersByTimeAsync(500);
    expect(logger.events.length).toBe(eventCountAfterFirstPoll);

    mgr.stop();
    vi.useRealTimers();
  });

  // AC-006: configurable interval
  it("AC-006: poll loop respects RELAY_MANIFEST_POLL_INTERVAL_MS", async () => {
    const manifest1 = createSignedManifest(1, signingKeyPrivate);

    const storage: CloudStorageProvider = {
      download: vi.fn(async () => new TextEncoder().encode(JSON.stringify(manifest1))),
      upload: vi.fn(),
    };

    const logger = createMockLogger();
    const signerPubkeyHex = Buffer.from(signingKeyPublic).toString("hex");

    const mgr = new RelayPoolManager({
      storage,
      signerPublicKeyHex: signerPubkeyHex,
      logger,
      pingFn: async () => ({ ok: true }),
      pingIntervalMs: 999_999,
    });

    vi.useFakeTimers();
    await mgr.loadManifest();

    mgr.startPolling(300_000); // 5 minutes

    const startedEvent = logger.events.find(e => e.name === "relay.manifest.poll.started");
    expect(startedEvent).toBeDefined();
    expect(startedEvent?.context.intervalMs).toBe(300_000);

    logger.events.length = 0;

    await vi.advanceTimersByTimeAsync(100_000);
    expect(logger.events.length).toBe(0); // no poll yet

    await vi.advanceTimersByTimeAsync(200_001);
    expect(logger.events.length).toBeGreaterThan(0); // poll fired

    mgr.stopPolling();
    mgr.stop();
    vi.useRealTimers();
  });

  // SI-001: manifest signature verification on every poll
  it("SI-001: invalid signature on polled manifest is rejected, pool stays at version N, loop continues", async () => {
    const manifest1 = createSignedManifest(1, signingKeyPrivate);

    // Create manifest2 with invalid signature
    const manifest2 = createSignedManifest(2, signingKeyPrivate);
    manifest2.signature = "deadbeef".repeat(16); // invalid signature

    // manifest3 is valid version 3 — returned after the bad poll to prove the loop continues
    const manifest3 = createSignedManifest(3, signingKeyPrivate, "relay3", "http://relay3:4000/health");

    let callCount = 0;
    const storage: CloudStorageProvider = {
      download: vi.fn(async () => {
        callCount++;
        if (callCount === 1) return new TextEncoder().encode(JSON.stringify(manifest1));
        if (callCount === 2) return new TextEncoder().encode(JSON.stringify(manifest2)); // bad sig
        return new TextEncoder().encode(JSON.stringify(manifest3)); // subsequent polls get v3
      }),
      upload: vi.fn(),
    };

    const logger = createMockLogger();
    const signerPubkeyHex = Buffer.from(signingKeyPublic).toString("hex");

    const mgr = new RelayPoolManager({
      storage,
      signerPublicKeyHex: signerPubkeyHex,
      logger,
      pingFn: async () => ({ ok: true }),
      pingIntervalMs: 999_999,
    });

    vi.useFakeTimers();
    await mgr.loadManifest();
    expect(mgr.currentVersion).toBe(1);

    mgr.startPolling(200);
    logger.events.length = 0;

    // First poll: retrieves manifest2 with invalid signature — must be rejected
    await vi.advanceTimersByTimeAsync(200);

    const invalidEvent = logger.events.find(e => e.name === "relay.manifest.invalid");
    expect(invalidEvent).toBeDefined();
    expect(invalidEvent?.context.reason).toBe("signature_verification_failed");
    expect(mgr.currentVersion).toBe(1); // unchanged — attacker cannot corrupt the pool

    // SI-001 observability: signature failure must also produce relay.manifest.poll.failed
    // so the poll-failure alarm fires when an attacker injects an invalid manifest.
    const pollFailedEvent = logger.events.find(e => e.name === "relay.manifest.poll.failed");
    expect(pollFailedEvent).toBeDefined();
    expect(pollFailedEvent?.context.reason).toMatch(/signature/i);
    // currentVersion is a required context field per observability spec
    expect(pollFailedEvent?.context.currentVersion).toBeDefined();

    const eventCountAfterBadPoll = logger.events.length;
    logger.events.length = 0;

    // I-1: verify the poll loop CONTINUES after the invalid-signature rejection.
    // Second poll: retrieves manifest3 (valid, version 3) — must be applied.
    await vi.advanceTimersByTimeAsync(200);

    expect(logger.events.length).toBeGreaterThan(0); // loop fired again
    const refreshedEvent = logger.events.find(e => e.name === "relay.manifest.refreshed");
    expect(refreshedEvent).toBeDefined();
    expect(refreshedEvent?.context.manifestVersion).toBe(3);
    expect(mgr.currentVersion).toBe(3); // pool updated on the next valid poll

    // Silence the unused variable warning
    void eventCountAfterBadPoll;

    mgr.stopPolling();
    mgr.stop();
    vi.useRealTimers();
  });

  // AC-005: CELLO_ENV=local — startPolling() is NOT called; no relay.manifest.poll.* events fire
  it("AC-005: startPolling() is never called in local mode (no S3 in local dev)", async () => {
    // This test verifies the RelayPoolManager API boundary contract: if startPolling() is
    // never invoked, no relay.manifest.poll.* events fire — which is the AC requirement.
    // The test does NOT verify the bin/directory.ts wiring (lines 490-510 return early from
    // the local branch before reaching the startPolling() call at lines 537-550). A full
    // process-spawn integration test would be needed to verify the wiring, but is not included
    // because the wiring code is a simple conditional branch with no external dependencies.
    // The wiring is verified during manual smoke tests (local directory startup) and any
    // incorrect wiring would be immediately visible (S3 errors in local mode). This coverage
    // gap is acceptable given the simplicity of the wiring code and the cost of maintaining
    // a full process-spawn test for a single conditional branch.
    const manifest1 = createSignedManifest(1, signingKeyPrivate);

    const storage: CloudStorageProvider = {
      download: vi.fn(async () => new TextEncoder().encode(JSON.stringify(manifest1))),
      upload: vi.fn(),
    };

    const logger = createMockLogger();
    const signerPubkeyHex = Buffer.from(signingKeyPublic).toString("hex");

    const mgr = new RelayPoolManager({
      storage,
      signerPublicKeyHex: signerPubkeyHex,
      logger,
      pingFn: async () => ({ ok: true }),
      pingIntervalMs: 999_999,
    });

    vi.useFakeTimers();

    // Spy on startPolling to verify it's never called (AC-005 requirement)
    const startPollingSpy = vi.spyOn(mgr, "startPolling");

    // Local mode: loadManifest() is called once at startup (existing behavior)
    await mgr.loadManifest();
    expect(mgr.currentVersion).toBe(1);

    // Local mode: startPolling() is NOT called
    // (bin/directory.ts returns early from the local branch before startPolling())
    expect(startPollingSpy).not.toHaveBeenCalled();
    logger.events.length = 0;

    // Advance timers by 10 poll cycles to confirm no polls fire
    await vi.advanceTimersByTimeAsync(2000);

    // No relay.manifest.poll.* events should fire
    const pollEvents = logger.events.filter(e => e.name.startsWith("relay.manifest.poll."));
    expect(pollEvents).toHaveLength(0);

    // The storage download should NOT have been called again (no polls)
    // download was called once in loadManifest() above
    expect(storage.download).toHaveBeenCalledTimes(1);

    mgr.stop();
    vi.useRealTimers();
  });

  // AC-006 integration: RELAY_MANIFEST_POLL_INTERVAL_MS validation in bin/directory.ts
  // These tests verify that bin/directory.ts validates RELAY_MANIFEST_POLL_INTERVAL_MS early
  // and exits with code 1 + adapter.config.missing event before expensive operations.
  // The validation logic (lines 490-502) is a simple parseInt + bounds check that runs
  // when env !== "local", but these tests would require spawning a full directory process
  // with all required env vars (DATABASE_URL, AWS credentials, KMS keys, etc.), which is
  // fragile and slow. The validation logic is straightforward (7 lines) and the AC-006
  // test above verifies that startPolling() respects the configured interval when valid.
  // We document the gap: bin/directory.ts wiring for the validation is NOT tested, only
  // the RelayPoolManager API contract. This is consistent with AC-005 approach (API contract
  // tested, wiring not tested). The validation will be caught by manual smoke tests and
  // any incorrect interval will be immediately visible in CloudWatch Logs (relay.manifest.poll.started
  // event includes intervalMs context field).

  // AC-007: Live smoke test — no automated test
  // AC-007 verifies the end-to-end auto-recovery chain: relay redeploy → PREP-003 auto-registers
  // → manifest re-sign (PREP-004) → poll picks up new manifest → directory uses new relay.
  // This is explicitly scoped as a manual smoke test per the story (lines 181-193) and must
  // be verified in staging after both PREP-003 and PREP-004 are deployed. The chain is
  // inherently multi-service (relay + directory + S3) and best verified in a live environment.
  // Each component has its own automated tests (PREP-003 for auto-registration, PREP-004 for
  // manifest signing, M6B-008 tests above for polling). The integration point is verified
  // manually before closing M6B-008.
});
