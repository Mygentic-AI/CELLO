/**
 * CELLO-RELAY-001 — Relay Pool Manager test suite
 *
 * Specification:
 * ──────────────
 * AC-001 (integration): manifest loaded → verify Ed25519 sig → log relay.manifest.loaded
 *   { signerNodeId, relayCount, manifestVersion }; health checks begin within 30s.
 *
 * AC-002 (integration): corrupted signature → log relay.manifest.invalid at ERROR
 *   { reason: 'signature_verification_failed', signerNodeId } → halt (throw/reject).
 *
 * AC-003 (integration): health check interval fires → relay.health.check.passed logged
 *   at INFO with { relayId, latencyMs }; consecutiveFailures = 0.
 *
 * AC-004 (e2e): relay fails 3 consecutive pings → relay.health.check.failed at WARN
 *   { relayId, consecutiveFailures: 3, reason } → relay marked unavailable.
 *
 * AC-005 (e2e): relay recovers after 3 consecutive successes → relay.pool.recovered
 *   at INFO { relayId, downtimeDurationMs } → relay becomes available again.
 *
 * AC-006 (integration): all relays unavailable → RELAY_UNAVAILABLE error logged
 *   relay.pool.unavailable at ERROR { totalRelays, availableCount: 0 }.
 *
 * AC-007 (unit): pickRelay with RTT measurements → assigns lowest-RTT relay.
 *
 * AC-008 (unit): manifest version ≤ current → rejected, relay.manifest.version.stale
 *   logged at WARN { currentVersion, receivedVersion }.
 *
 * AC-009 (integration): relay not in manifest → never assigned even if registered.
 *
 * AC-012 (integration): relay with status=draining → excluded from new session assignments.
 *
 * AC-014 (unit): sign-ed25519.js produces deterministic signature that verifies.
 *
 * SI-001: manifest without valid Ed25519 sig → rejected at load time, directory halts.
 * SI-002: relay must be in verified manifest AND pass health checks to be assignable.
 * SI-003: manifest version never decreases.
 *
 * DB-001 (integration): S3 unavailable → retries with backoff, logs relay.manifest.load.failed
 *   { reason, attempt }.
 */

import { describe, it, expect, vi } from "vitest";
import { ed25519 } from "@noble/curves/ed25519.js";
import { RelayPoolManager } from "../relay-pool-manager.js";
import type { RelayPoolManifest, RelayManifestEntry } from "../relay-pool-manager.js";
import type { CloudStorageProvider, Logger } from "@cello-protocol/interfaces";

// ─── Test helpers ─────────────────────────────────────────────────────────────

/** Generate a test Ed25519 key pair deterministically from a seed integer. */
function makeTestKeypair(seed: number) {
  const privateKey = new Uint8Array(32).fill(seed);
  const publicKey = ed25519.getPublicKey(privateKey);
  return { privateKey, publicKey, publicKeyHex: Buffer.from(publicKey).toString("hex") };
}

/** Canonical JSON signing: sorted keys, no whitespace, UTF-8. */
function canonicalJson(obj: Record<string, unknown>): Uint8Array {
  const sorted = Object.fromEntries(
    Object.keys(obj).sort().map(k => [k, (obj as Record<string, unknown>)[k]])
  );
  return new TextEncoder().encode(JSON.stringify(sorted));
}

/** Build and sign a valid relay pool manifest. */
function buildSignedManifest(
  privateKey: Uint8Array,
  publicKeyHex: string,
  signerNodeId: string,
  relays: RelayManifestEntry[],
  version = 1,
  updatedAt?: string,
): RelayPoolManifest {
  const ts = updatedAt ?? new Date().toISOString();
  const body = { version, updatedAt: ts, relays };
  const payload = canonicalJson(body as unknown as Record<string, unknown>);
  const signature = ed25519.sign(payload, privateKey);
  return {
    version,
    signedBy: signerNodeId,
    signature: Buffer.from(signature).toString("hex"),
    updatedAt: ts,
    relays,
  };
}

/** A minimal relay entry. */
function makeRelay(id: string, status: "active" | "draining" = "active"): RelayManifestEntry {
  return {
    relayId: id,
    endpoint: `wss://relay-${id.slice(0, 8)}.example.com`,
    region: "us-east-1",
    status,
    healthCheckUrl: `http://10.0.0.${id.charCodeAt(0) % 200}:4000/health`,
  };
}

/** Capture log events emitted by the RelayPoolManager. */
function makeCapturingLogger(): Logger & { events: Array<{ level: string; name: string; ctx: unknown }> } {
  const events: Array<{ level: string; name: string; ctx: unknown }> = [];
  return {
    events,
    debug: (name, ctx) => events.push({ level: "debug", name, ctx }),
    info: (name, ctx) => events.push({ level: "info", name, ctx }),
    warn: (name, ctx) => events.push({ level: "warn", name, ctx }),
    error: (name, errOrCtx?, ctx?) => {
      const context = errOrCtx instanceof Error ? { ...(ctx ?? {}), error: errOrCtx.message } : errOrCtx;
      events.push({ level: "error", name, ctx: context });
    },
  };
}

/** Build an in-memory CloudStorageProvider with pre-loaded objects. */
function makeInMemoryStorage(entries?: Record<string, Uint8Array>): CloudStorageProvider {
  const store = new Map<string, Uint8Array>(Object.entries(entries ?? {}));
  return {
    async upload(key, data) { store.set(key, data); },
    async download(key) { return store.get(key); },
  };
}

/** Build a failing CloudStorageProvider for DB-001 tests. */
function makeFailingStorage(failCount = Infinity): CloudStorageProvider {
  let failures = 0;
  return {
    async upload() { throw new Error("S3 unavailable"); },
    async download() {
      if (failures < failCount) {
        failures++;
        throw new Error("S3 unavailable");
      }
      return undefined;
    },
  };
}

// ─── Key material ─────────────────────────────────────────────────────────────

const signerKeypair = makeTestKeypair(42);
const signerNodeId = "dir-node-01";

const relayA_id = "aaaa1111bbbb2222cccc3333dddd4444eeee5555ffff6666aaaa1111bbbb2222";
const relayB_id = "bbbb2222cccc3333dddd4444eeee5555ffff6666aaaa1111bbbb2222cccc3333";

// ─── AC-001 / SI-001: Manifest loading and signature verification ─────────────

describe("AC-001: valid manifest loads and verifies", () => {
  it("logs relay.manifest.loaded at INFO when signature is valid", async () => {
    const relays = [makeRelay(relayA_id), makeRelay(relayB_id)];
    const manifest = buildSignedManifest(
      signerKeypair.privateKey,
      signerKeypair.publicKeyHex,
      signerNodeId,
      relays,
    );
    const storage = makeInMemoryStorage({
      "relay-manifest.json": new TextEncoder().encode(JSON.stringify(manifest)),
    });
    const logger = makeCapturingLogger();

    const mgr = new RelayPoolManager({
      storage,
      signerPublicKeyHex: signerKeypair.publicKeyHex,
      logger,
      pingIntervalMs: 999_999, // disable auto-ping in this test
      failureThreshold: 3,
    });

    await mgr.loadManifest();

    const loaded = logger.events.find(e => e.name === "relay.manifest.loaded");
    expect(loaded).toBeDefined();
    expect(loaded!.level).toBe("info");
    expect(loaded!.ctx).toMatchObject({
      signerNodeId,
      relayCount: 2,
      manifestVersion: 1,
    });
  });
});

// ─── AC-002 / SI-001: Corrupted signature → halt ──────────────────────────────

describe("AC-002 / SI-001: corrupted manifest signature causes loadManifest to reject", () => {
  it("logs relay.manifest.invalid at ERROR and throws when signature is corrupted", async () => {
    const relays = [makeRelay(relayA_id)];
    const manifest = buildSignedManifest(
      signerKeypair.privateKey,
      signerKeypair.publicKeyHex,
      signerNodeId,
      relays,
    );
    // Corrupt the signature — flip last byte (XOR with 0xff ensures change even if it ends in "00")
    const lastByte = parseInt(manifest.signature.slice(-2), 16);
    const flipped = (lastByte ^ 0xff).toString(16).padStart(2, "0");
    manifest.signature = manifest.signature.slice(0, -2) + flipped;

    const storage = makeInMemoryStorage({
      "relay-manifest.json": new TextEncoder().encode(JSON.stringify(manifest)),
    });
    const logger = makeCapturingLogger();

    const mgr = new RelayPoolManager({
      storage,
      signerPublicKeyHex: signerKeypair.publicKeyHex,
      logger,
      pingIntervalMs: 999_999,
      failureThreshold: 3,
    });

    await expect(mgr.loadManifest()).rejects.toThrow();

    const invalid = logger.events.find(e => e.name === "relay.manifest.invalid");
    expect(invalid).toBeDefined();
    expect(invalid!.level).toBe("error");
    expect(invalid!.ctx).toMatchObject({
      reason: "signature_verification_failed",
      signerNodeId,
    });
  });

  it("logs relay.manifest.invalid when manifest JSON is missing signature field", async () => {
    const relays = [makeRelay(relayA_id)];
    const manifest = buildSignedManifest(
      signerKeypair.privateKey,
      signerKeypair.publicKeyHex,
      signerNodeId,
      relays,
    );
    // Remove signature field
    const { signature: _, ...manifestWithoutSig } = manifest;
    void _;

    const storage = makeInMemoryStorage({
      "relay-manifest.json": new TextEncoder().encode(JSON.stringify(manifestWithoutSig)),
    });
    const logger = makeCapturingLogger();

    const mgr = new RelayPoolManager({
      storage,
      signerPublicKeyHex: signerKeypair.publicKeyHex,
      logger,
      pingIntervalMs: 999_999,
      failureThreshold: 3,
    });

    await expect(mgr.loadManifest()).rejects.toThrow();
    expect(logger.events.some(e => e.name === "relay.manifest.invalid")).toBe(true);
  });
});

// ─── AC-003: Health check passes ─────────────────────────────────────────────

describe("AC-003: health check passes → relay.health.check.passed logged", () => {
  it("logs relay.health.check.passed at INFO with relayId and latencyMs", async () => {
    const relays = [makeRelay(relayA_id)];
    const manifest = buildSignedManifest(
      signerKeypair.privateKey,
      signerKeypair.publicKeyHex,
      signerNodeId,
      relays,
    );
    const storage = makeInMemoryStorage({
      "relay-manifest.json": new TextEncoder().encode(JSON.stringify(manifest)),
    });
    const logger = makeCapturingLogger();

    // Inject a ping function that always succeeds
    const pingFn = vi.fn().mockResolvedValue({ ok: true, latencyMs: 5 });

    const mgr = new RelayPoolManager({
      storage,
      signerPublicKeyHex: signerKeypair.publicKeyHex,
      logger,
      pingIntervalMs: 50, // fast for testing
      failureThreshold: 3,
      pingFn,
    });

    await mgr.loadManifest();

    // Wait for at least one ping cycle
    await new Promise(r => setTimeout(r, 200));
    mgr.stop();

    const passed = logger.events.find(e => e.name === "relay.health.check.passed");
    expect(passed).toBeDefined();
    expect(passed!.level).toBe("info");
    expect((passed!.ctx as Record<string, unknown>).relayId).toBe(relayA_id);
    expect(typeof (passed!.ctx as Record<string, unknown>).latencyMs).toBe("number");
  });
});

// ─── AC-004: 3 consecutive failures → unavailable ────────────────────────────

describe("AC-004: 3 consecutive health check failures mark relay unavailable", () => {
  it("logs relay.health.check.failed at WARN with consecutiveFailures: 3 and marks relay unavailable", async () => {
    const relays = [makeRelay(relayA_id), makeRelay(relayB_id)];
    const manifest = buildSignedManifest(
      signerKeypair.privateKey,
      signerKeypair.publicKeyHex,
      signerNodeId,
      relays,
    );
    const storage = makeInMemoryStorage({
      "relay-manifest.json": new TextEncoder().encode(JSON.stringify(manifest)),
    });
    const logger = makeCapturingLogger();

    // relayA fails, relayB succeeds
    const pingFn = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("10.0.0.")) {
        // Both relay healthCheckUrls contain 10.0.0., differentiate by the last byte
        const lastOctet = url.split(":")[1]?.split("/")[2]?.split(".")?.pop() ?? "";
        if (lastOctet === String(relayA_id.charCodeAt(0) % 200)) {
          return { ok: false, reason: "ECONNREFUSED" };
        }
      }
      return { ok: true, latencyMs: 10 };
    });

    const mgr = new RelayPoolManager({
      storage,
      signerPublicKeyHex: signerKeypair.publicKeyHex,
      logger,
      pingIntervalMs: 50,
      failureThreshold: 3,
      pingFn,
    });

    await mgr.loadManifest();
    // Wait for 3+ failure cycles
    await new Promise(r => setTimeout(r, 300));
    mgr.stop();

    const failed = logger.events.find(
      e => e.name === "relay.health.check.failed" &&
           (e.ctx as Record<string, unknown>).consecutiveFailures === 3,
    );
    expect(failed).toBeDefined();
    expect(failed!.level).toBe("warn");
    expect((failed!.ctx as Record<string, unknown>).relayId).toBe(relayA_id);
  });

  it("excludes the failed relay from pickRelay after 3 failures", async () => {
    const relays = [makeRelay(relayA_id), makeRelay(relayB_id)];
    const manifest = buildSignedManifest(
      signerKeypair.privateKey,
      signerKeypair.publicKeyHex,
      signerNodeId,
      relays,
    );
    const storage = makeInMemoryStorage({
      "relay-manifest.json": new TextEncoder().encode(JSON.stringify(manifest)),
    });
    const logger = makeCapturingLogger();

    // relayA always fails, relayB always succeeds
    const pingFn = vi.fn().mockImplementation(async (url: string) => {
      const aHealth = `http://10.0.0.${relayA_id.charCodeAt(0) % 200}:4000/health`;
      if (url === aHealth) {
        return { ok: false, reason: "ECONNREFUSED" };
      }
      return { ok: true, latencyMs: 10 };
    });

    const mgr = new RelayPoolManager({
      storage,
      signerPublicKeyHex: signerKeypair.publicKeyHex,
      logger,
      pingIntervalMs: 50,
      failureThreshold: 3,
      pingFn,
    });

    await mgr.loadManifest();
    // Wait for relay A to accumulate 3 failures
    await new Promise(r => setTimeout(r, 300));
    mgr.stop();

    // relay A should be unavailable — pickRelay should return relay B
    const assigned = mgr.pickRelay();
    expect(assigned).not.toBeNull();
    expect(assigned!.relayId).toBe(relayB_id);
  });
});

// ─── AC-005: Recovery after 3 consecutive successes ──────────────────────────

describe("AC-005: relay recovers after 3 consecutive successes", () => {
  it("logs relay.pool.recovered at INFO with relayId and downtimeDurationMs", async () => {
    const relays = [makeRelay(relayA_id)];
    const manifest = buildSignedManifest(
      signerKeypair.privateKey,
      signerKeypair.publicKeyHex,
      signerNodeId,
      relays,
    );
    const storage = makeInMemoryStorage({
      "relay-manifest.json": new TextEncoder().encode(JSON.stringify(manifest)),
    });
    const logger = makeCapturingLogger();

    // First 3 pings fail, then succeed
    let callCount = 0;
    const pingFn = vi.fn().mockImplementation(async () => {
      callCount++;
      return callCount <= 3
        ? { ok: false, reason: "ECONNREFUSED" }
        : { ok: true, latencyMs: 8 };
    });

    const mgr = new RelayPoolManager({
      storage,
      signerPublicKeyHex: signerKeypair.publicKeyHex,
      logger,
      pingIntervalMs: 50,
      failureThreshold: 3,
      pingFn,
    });

    await mgr.loadManifest();
    // Wait long enough for fail→recover cycle (3 fails + 3 successes + margin)
    await new Promise(r => setTimeout(r, 600));
    mgr.stop();

    const recovered = logger.events.find(e => e.name === "relay.pool.recovered");
    expect(recovered).toBeDefined();
    expect(recovered!.level).toBe("info");
    expect((recovered!.ctx as Record<string, unknown>).relayId).toBe(relayA_id);
    expect(typeof (recovered!.ctx as Record<string, unknown>).downtimeDurationMs).toBe("number");
  });
});

// ─── AC-006: All relays unavailable → relay.pool.unavailable ─────────────────

describe("AC-006: all relays unavailable → RELAY_UNAVAILABLE", () => {
  it("pickRelay returns null and logs relay.pool.unavailable when all relays are unavailable", async () => {
    const relays = [makeRelay(relayA_id)];
    const manifest = buildSignedManifest(
      signerKeypair.privateKey,
      signerKeypair.publicKeyHex,
      signerNodeId,
      relays,
    );
    const storage = makeInMemoryStorage({
      "relay-manifest.json": new TextEncoder().encode(JSON.stringify(manifest)),
    });
    const logger = makeCapturingLogger();

    // All pings fail
    const pingFn = vi.fn().mockResolvedValue({ ok: false, reason: "ECONNREFUSED" });

    const mgr = new RelayPoolManager({
      storage,
      signerPublicKeyHex: signerKeypair.publicKeyHex,
      logger,
      pingIntervalMs: 50,
      failureThreshold: 3,
      pingFn,
    });

    await mgr.loadManifest();
    // Wait for all relays to be marked unavailable
    await new Promise(r => setTimeout(r, 300));
    mgr.stop();

    const result = mgr.pickRelay();
    expect(result).toBeNull();

    const unavailable = logger.events.find(e => e.name === "relay.pool.unavailable");
    expect(unavailable).toBeDefined();
    expect(unavailable!.level).toBe("error");
    expect((unavailable!.ctx as Record<string, unknown>).totalRelays).toBe(1);
    expect((unavailable!.ctx as Record<string, unknown>).availableCount).toBe(0);
  });
});

// ─── AC-007: RTT-based relay selection ───────────────────────────────────────

describe("AC-007: pickRelay assigns lowest-RTT relay", () => {
  it("assigns relay-A (15ms) over relay-B (80ms) when RTT measurements are provided", async () => {
    const relays = [makeRelay(relayA_id), makeRelay(relayB_id)];
    const manifest = buildSignedManifest(
      signerKeypair.privateKey,
      signerKeypair.publicKeyHex,
      signerNodeId,
      relays,
    );
    const storage = makeInMemoryStorage({
      "relay-manifest.json": new TextEncoder().encode(JSON.stringify(manifest)),
    });
    const logger = makeCapturingLogger();

    const mgr = new RelayPoolManager({
      storage,
      signerPublicKeyHex: signerKeypair.publicKeyHex,
      logger,
      pingIntervalMs: 999_999,
      failureThreshold: 3,
    });

    await mgr.loadManifest();

    const rttMeasurements: Record<string, number> = {
      [relayA_id]: 15,
      [relayB_id]: 80,
    };

    const assigned = mgr.pickRelay(rttMeasurements);
    expect(assigned).not.toBeNull();
    expect(assigned!.relayId).toBe(relayA_id);
  });

  it("falls back to lowest consecutive failure count when no RTT measurements", async () => {
    const relays = [makeRelay(relayA_id), makeRelay(relayB_id)];
    const manifest = buildSignedManifest(
      signerKeypair.privateKey,
      signerKeypair.publicKeyHex,
      signerNodeId,
      relays,
    );
    const storage = makeInMemoryStorage({
      "relay-manifest.json": new TextEncoder().encode(JSON.stringify(manifest)),
    });
    const logger = makeCapturingLogger();

    const mgr = new RelayPoolManager({
      storage,
      signerPublicKeyHex: signerKeypair.publicKeyHex,
      logger,
      pingIntervalMs: 999_999,
      failureThreshold: 3,
    });

    await mgr.loadManifest();

    // Both relays have 0 failures — any available relay is fine
    const assigned = mgr.pickRelay();
    expect(assigned).not.toBeNull();
    expect([relayA_id, relayB_id]).toContain(assigned!.relayId);
  });

  it("with RTT measurements, skips unavailable relays even if they have lower RTT", async () => {
    const relays = [makeRelay(relayA_id), makeRelay(relayB_id)];
    const manifest = buildSignedManifest(
      signerKeypair.privateKey,
      signerKeypair.publicKeyHex,
      signerNodeId,
      relays,
    );
    const storage = makeInMemoryStorage({
      "relay-manifest.json": new TextEncoder().encode(JSON.stringify(manifest)),
    });
    const logger = makeCapturingLogger();

    const pingFn = vi.fn().mockImplementation(async (url: string) => {
      const aHealth = `http://10.0.0.${relayA_id.charCodeAt(0) % 200}:4000/health`;
      if (url === aHealth) return { ok: false, reason: "ECONNREFUSED" };
      return { ok: true, latencyMs: 10 };
    });

    const mgr = new RelayPoolManager({
      storage,
      signerPublicKeyHex: signerKeypair.publicKeyHex,
      logger,
      pingIntervalMs: 50,
      failureThreshold: 3,
      pingFn,
    });

    await mgr.loadManifest();
    // Let relay A accumulate 3 failures
    await new Promise(r => setTimeout(r, 300));
    mgr.stop();

    // relay A has lower RTT but is unavailable — should pick relay B
    const rttMeasurements: Record<string, number> = {
      [relayA_id]: 5,   // lower RTT but unavailable
      [relayB_id]: 100, // higher RTT but available
    };

    const assigned = mgr.pickRelay(rttMeasurements);
    expect(assigned).not.toBeNull();
    expect(assigned!.relayId).toBe(relayB_id);
  });
});

// ─── AC-008 / SI-003: Version staleness rejection ────────────────────────────

describe("AC-008 / SI-003: stale manifest version is rejected", () => {
  it("logs relay.manifest.version.stale at WARN when version ≤ current", async () => {
    const relays = [makeRelay(relayA_id)];
    const manifest = buildSignedManifest(
      signerKeypair.privateKey,
      signerKeypair.publicKeyHex,
      signerNodeId,
      relays,
      2,
    );
    const storage = makeInMemoryStorage({
      "relay-manifest.json": new TextEncoder().encode(JSON.stringify(manifest)),
    });
    const logger = makeCapturingLogger();

    const mgr = new RelayPoolManager({
      storage,
      signerPublicKeyHex: signerKeypair.publicKeyHex,
      logger,
      pingIntervalMs: 999_999,
      failureThreshold: 3,
    });

    // Load version=2 first
    await mgr.loadManifest();

    // Now try to reload with version=1 (stale)
    const staleManifest = buildSignedManifest(
      signerKeypair.privateKey,
      signerKeypair.publicKeyHex,
      signerNodeId,
      relays,
      1,
    );

    // Test via applyManifest directly — the same mgr instance already has version=2 loaded.
    const result = mgr.applyManifest(staleManifest);
    expect(result.ok).toBe(false);

    const staleLog = logger.events.find(e => e.name === "relay.manifest.version.stale");
    expect(staleLog).toBeDefined();
    expect(staleLog!.level).toBe("warn");
    expect((staleLog!.ctx as Record<string, unknown>).currentVersion).toBe(2);
    expect((staleLog!.ctx as Record<string, unknown>).receivedVersion).toBe(1);
  });

  it("rejects same-version manifest (version must strictly increase)", async () => {
    const relays = [makeRelay(relayA_id)];
    const manifest = buildSignedManifest(
      signerKeypair.privateKey,
      signerKeypair.publicKeyHex,
      signerNodeId,
      relays,
      2,
    );
    const storage = makeInMemoryStorage({
      "relay-manifest.json": new TextEncoder().encode(JSON.stringify(manifest)),
    });
    const logger = makeCapturingLogger();

    const mgr = new RelayPoolManager({
      storage,
      signerPublicKeyHex: signerKeypair.publicKeyHex,
      logger,
      pingIntervalMs: 999_999,
      failureThreshold: 3,
    });

    await mgr.loadManifest();

    // Same version=2 again
    const result = mgr.applyManifest(manifest);
    expect(result.ok).toBe(false);
    expect(logger.events.some(e => e.name === "relay.manifest.version.stale")).toBe(true);
  });
});

// ─── AC-009 / SI-002: Only manifest relays are eligible ──────────────────────

describe("AC-009 / SI-002: relay not in manifest is never assigned", () => {
  it("does not include an unmanifested relay in pickRelay results", async () => {
    const relayInManifest = makeRelay(relayA_id);
    const relays = [relayInManifest];
    const manifest = buildSignedManifest(
      signerKeypair.privateKey,
      signerKeypair.publicKeyHex,
      signerNodeId,
      relays,
    );
    const storage = makeInMemoryStorage({
      "relay-manifest.json": new TextEncoder().encode(JSON.stringify(manifest)),
    });
    const logger = makeCapturingLogger();

    const mgr = new RelayPoolManager({
      storage,
      signerPublicKeyHex: signerKeypair.publicKeyHex,
      logger,
      pingIntervalMs: 999_999,
      failureThreshold: 3,
    });

    await mgr.loadManifest();

    // Run 20 consecutive pickRelay calls — never relay B (not in manifest)
    for (let i = 0; i < 20; i++) {
      const assigned = mgr.pickRelay();
      expect(assigned?.relayId).not.toBe(relayB_id);
    }
  });
});

// ─── AC-012: Draining relay excluded from assignment ─────────────────────────

describe("AC-012: draining relay excluded from new session assignments", () => {
  it("never assigns a draining relay across 20 consecutive pickRelay calls", async () => {
    const drainingRelay = makeRelay(relayA_id, "draining");
    const activeRelay = makeRelay(relayB_id, "active");
    const relays = [drainingRelay, activeRelay];
    const manifest = buildSignedManifest(
      signerKeypair.privateKey,
      signerKeypair.publicKeyHex,
      signerNodeId,
      relays,
    );
    const storage = makeInMemoryStorage({
      "relay-manifest.json": new TextEncoder().encode(JSON.stringify(manifest)),
    });
    const logger = makeCapturingLogger();

    const mgr = new RelayPoolManager({
      storage,
      signerPublicKeyHex: signerKeypair.publicKeyHex,
      logger,
      pingIntervalMs: 999_999,
      failureThreshold: 3,
    });

    await mgr.loadManifest();

    for (let i = 0; i < 20; i++) {
      const assigned = mgr.pickRelay();
      expect(assigned).not.toBeNull();
      expect(assigned!.relayId).not.toBe(relayA_id); // draining relay never assigned
      expect(assigned!.relayId).toBe(relayB_id);
    }
  });
});

// ─── DB-001: S3 unavailable → retry with backoff ─────────────────────────────

describe("DB-001: S3 unavailable at startup → logs relay.manifest.load.failed and retries", () => {
  it("logs relay.manifest.load.failed at ERROR with { reason, attempt } when S3 fails", async () => {
    const logger = makeCapturingLogger();

    const mgr = new RelayPoolManager({
      storage: makeFailingStorage(),
      signerPublicKeyHex: signerKeypair.publicKeyHex,
      logger,
      pingIntervalMs: 999_999,
      failureThreshold: 3,
      maxLoadAttempts: 2,
      retryDelayMs: 10,
    });

    await expect(mgr.loadManifest()).rejects.toThrow();

    const failed = logger.events.filter(e => e.name === "relay.manifest.load.failed");
    expect(failed.length).toBeGreaterThanOrEqual(1);
    expect(failed[0]!.level).toBe("error");
    expect((failed[0]!.ctx as Record<string, unknown>).attempt).toBeDefined();
  });
});

// ─── AC-013: Empty signing key causes sign-manifest.sh to exit non-zero ──────

describe("AC-013: sign-manifest.sh exits non-zero when signing key is empty", () => {
  it("exits non-zero with the expected error message when the signing key secret is an empty placeholder", async () => {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const { writeFileSync, mkdirSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const execFileAsync = promisify(execFile);

    const scriptPath = new URL(
      "../../../../infra/sign-manifest.sh",
      import.meta.url,
    ).pathname;

    // Create a temp directory for the relay definitions file
    const tmpDir = join(tmpdir(), `cello-ac013-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });

    const relayDefsPath = join(tmpDir, "relays.json");
    writeFileSync(relayDefsPath, JSON.stringify([{
      relayId: "aaaa1111bbbb2222cccc3333dddd4444eeee5555ffff6666aaaa1111bbbb2222",
      endpoint: "wss://relay.example.com",
      region: "us-east-1",
      status: "active",
      healthCheckUrl: "http://10.0.0.1:4000/health",
    }]));

    // Create a mock aws script that returns the placeholder value
    const mockAwsPath = join(tmpDir, "aws");
    writeFileSync(mockAwsPath, `#!/bin/bash
# Mock aws CLI — returns empty placeholder for secretsmanager, errors for s3
if [[ "$1" == "secretsmanager" ]]; then
  echo "PLACEHOLDER_POPULATE_VIA_CLI"
  exit 0
fi
exit 1
`, { mode: 0o755 });

    try {
      await execFileAsync("bash", [scriptPath, "dev", "us-east-1", relayDefsPath], {
        env: {
          ...process.env,
          PATH: `${tmpDir}:${process.env["PATH"]}`,
        },
      });
      // If we get here, the script didn't exit non-zero — fail the test
      expect.fail("sign-manifest.sh should have exited non-zero");
    } catch (err: unknown) {
      const execError = err as { code: number; stderr: string };
      expect(execError.code).not.toBe(0);
      expect(execError.stderr).toContain(
        "Signing key is empty — populate cello/dev/directory/node-private-key in Secrets Manager before signing the manifest",
      );
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("exits non-zero when the signing key from Secrets Manager is empty string", async () => {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const { writeFileSync, mkdirSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const execFileAsync = promisify(execFile);

    const scriptPath = new URL(
      "../../../../infra/sign-manifest.sh",
      import.meta.url,
    ).pathname;

    const tmpDir = join(tmpdir(), `cello-ac013-empty-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });

    const relayDefsPath = join(tmpDir, "relays.json");
    writeFileSync(relayDefsPath, JSON.stringify([{
      relayId: "aaaa1111bbbb2222cccc3333dddd4444eeee5555ffff6666aaaa1111bbbb2222",
      endpoint: "wss://relay.example.com",
      region: "us-east-1",
      status: "active",
      healthCheckUrl: "http://10.0.0.1:4000/health",
    }]));

    // Create a mock aws script that returns empty string (simulating empty secret)
    const mockAwsPath = join(tmpDir, "aws");
    writeFileSync(mockAwsPath, `#!/bin/bash
# Mock aws CLI — returns empty for secretsmanager
if [[ "$1" == "secretsmanager" ]]; then
  echo ""
  exit 0
fi
exit 1
`, { mode: 0o755 });

    try {
      await execFileAsync("bash", [scriptPath, "dev", "us-east-1", relayDefsPath], {
        env: {
          ...process.env,
          PATH: `${tmpDir}:${process.env["PATH"]}`,
        },
      });
      expect.fail("sign-manifest.sh should have exited non-zero");
    } catch (err: unknown) {
      const execError = err as { code: number; stderr: string };
      expect(execError.code).not.toBe(0);
      expect(execError.stderr).toContain(
        "Signing key is empty — populate cello/dev/directory/node-private-key in Secrets Manager before signing the manifest",
      );
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ─── AC-014: sign-ed25519.js is deterministic ────────────────────────────────

describe("AC-014: sign-ed25519.js produces deterministic, verifiable signatures", () => {
  it("sign-ed25519.js outputs a hex signature that verifies and is deterministic", async () => {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execFileAsync = promisify(execFile);

    const scriptPath = new URL(
      "../../../../infra/scripts/sign-ed25519.js",
      import.meta.url,
    ).pathname;

    const privateKeyHex = Buffer.from(signerKeypair.privateKey).toString("hex");
    const message = "test-message-for-determinism";

    // Run twice — must produce the same output (deterministic)
    const result1 = await execFileAsync("node", [scriptPath, privateKeyHex, message]);
    const result2 = await execFileAsync("node", [scriptPath, privateKeyHex, message]);

    const sig1 = result1.stdout.trim();
    const sig2 = result2.stdout.trim();

    expect(sig1).toBe(sig2);
    expect(sig1).toMatch(/^[0-9a-f]{128}$/); // 64-byte signature = 128 hex chars

    // Verify the signature against the public key
    const sigBytes = Buffer.from(sig1, "hex");
    const msgBytes = new TextEncoder().encode(message);
    const isValid = ed25519.verify(sigBytes, msgBytes, signerKeypair.publicKey);
    expect(isValid).toBe(true);
  });
});

// ─── AC-010: sign-manifest.sh creates version=1 when no manifest exists ──────

describe("AC-010: sign-manifest.sh creates version=1 when no manifest exists", () => {
  it("creates a new manifest with version=1, valid signature, and success output", async () => {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const { writeFileSync, mkdirSync, rmSync, readFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const execFileAsync = promisify(execFile);

    const scriptPath = new URL(
      "../../../../infra/sign-manifest.sh",
      import.meta.url,
    ).pathname;

    const tmpDir = join(tmpdir(), `cello-ac010-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });

    // Create relay definitions JSON
    const relayDefsPath = join(tmpDir, "relays.json");
    writeFileSync(relayDefsPath, JSON.stringify([{
      relayId: "aaaa1111bbbb2222cccc3333dddd4444eeee5555ffff6666aaaa1111bbbb2222",
      endpoint: "wss://relay.example.com",
      region: "us-east-1",
      status: "active",
      healthCheckUrl: "http://10.0.0.1:4000/health",
    }]));

    // Fixed test signing key (32 bytes, seed=42)
    const testPrivateKeyHex = Buffer.from(signerKeypair.privateKey).toString("hex");
    const testPublicKeyHex = signerKeypair.publicKeyHex;

    // Path to capture uploaded manifest
    const manifestUploadPath = join(tmpDir, "uploaded-manifest.json");

    // Create mock aws script
    const mockAwsPath = join(tmpDir, "aws");
    writeFileSync(mockAwsPath, `#!/bin/bash
# Mock aws CLI for AC-010 test

if [[ "$1" == "secretsmanager" ]]; then
  # Return the test signing key
  echo "${testPrivateKeyHex}"
  exit 0
fi

if [[ "$1" == "s3" && "$2" == "cp" ]]; then
  # Check if this is a download (from s3://) or upload (to s3://)
  if [[ "$3" == s3://* ]]; then
    # Download: no existing manifest (exit 1)
    exit 1
  else
    # Upload: capture stdin to file
    cat > "${manifestUploadPath}"
    exit 0
  fi
fi

exit 1
`, { mode: 0o755 });

    try {
      const result = await execFileAsync("bash", [scriptPath, "dev", "us-east-1", relayDefsPath], {
        env: {
          ...process.env,
          PATH: `${tmpDir}:${process.env["PATH"]}`,
        },
      });

      // Verify stdout contains expected success indicators
      expect(result.stdout).toContain("Version: 1");
      expect(result.stdout).toContain("s3://cello-relay-manifest-dev-us-east-1/relay-manifest.json");
      expect(result.stdout).toContain("aws ecs update-service");

      // Verify the uploaded manifest
      const uploadedManifest = JSON.parse(readFileSync(manifestUploadPath, "utf-8"));
      expect(uploadedManifest.version).toBe(1);
      expect(uploadedManifest.signedBy).toBe(testPublicKeyHex);
      expect(uploadedManifest.relays).toHaveLength(1);
      expect(uploadedManifest.signature).toMatch(/^[0-9a-f]{128}$/);

      // Verify Ed25519 signature
      const { version, updatedAt, relays } = uploadedManifest;
      const body = { version, updatedAt, relays };
      const canonicalPayload = canonicalJson(body as unknown as Record<string, unknown>);
      const sigBytes = Buffer.from(uploadedManifest.signature, "hex");
      const isValid = ed25519.verify(sigBytes, canonicalPayload, signerKeypair.publicKey);
      expect(isValid).toBe(true);

    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ─── AC-011: sign-manifest.sh increments version by exactly 1 ─────────────────

describe("AC-011: sign-manifest.sh increments version by exactly 1", () => {
  it("increments version from 2 to 3, and from 3 to 4 on subsequent invocations", async () => {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const { writeFileSync, mkdirSync, rmSync, readFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const execFileAsync = promisify(execFile);

    const scriptPath = new URL(
      "../../../../infra/sign-manifest.sh",
      import.meta.url,
    ).pathname;

    const tmpDir = join(tmpdir(), `cello-ac011-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });

    // Create relay definitions JSON
    const relayDefsPath = join(tmpDir, "relays.json");
    writeFileSync(relayDefsPath, JSON.stringify([{
      relayId: "aaaa1111bbbb2222cccc3333dddd4444eeee5555ffff6666aaaa1111bbbb2222",
      endpoint: "wss://relay.example.com",
      region: "us-east-1",
      status: "active",
      healthCheckUrl: "http://10.0.0.1:4000/health",
    }]));

    const testPrivateKeyHex = Buffer.from(signerKeypair.privateKey).toString("hex");
    const testPublicKeyHex = signerKeypair.publicKeyHex;

    // Path to store the "current" manifest (simulating S3 state)
    const currentManifestPath = join(tmpDir, "current-manifest.json");
    const manifestUploadPath = join(tmpDir, "uploaded-manifest.json");

    // Build an initial manifest with version=2
    const relays = [makeRelay("aaaa1111bbbb2222cccc3333dddd4444eeee5555ffff6666aaaa1111bbbb2222")];
    const initialManifest = buildSignedManifest(
      signerKeypair.privateKey,
      testPublicKeyHex,
      testPublicKeyHex,
      relays,
      2,
      "2026-05-23T10:00:00Z",
    );
    writeFileSync(currentManifestPath, JSON.stringify(initialManifest));

    // Create mock aws script (tracks invocation count)
    const invocationCountPath = join(tmpDir, "invocation-count.txt");
    writeFileSync(invocationCountPath, "0");

    const mockAwsPath = join(tmpDir, "aws");
    writeFileSync(mockAwsPath, `#!/bin/bash
# Mock aws CLI for AC-011 test

if [[ "$1" == "secretsmanager" ]]; then
  echo "${testPrivateKeyHex}"
  exit 0
fi

if [[ "$1" == "s3" && "$2" == "cp" ]]; then
  if [[ "$3" == s3://* ]]; then
    # Download: return current manifest
    cat "${currentManifestPath}"
    exit 0
  else
    # Upload: capture stdin, increment invocation count, update current manifest
    cat > "${manifestUploadPath}"
    cp "${manifestUploadPath}" "${currentManifestPath}"
    COUNT=$(cat "${invocationCountPath}")
    echo $((COUNT + 1)) > "${invocationCountPath}"
    exit 0
  fi
fi

exit 1
`, { mode: 0o755 });

    try {
      // First invocation: version 2 → 3
      const result1 = await execFileAsync("bash", [scriptPath, "dev", "us-east-1", relayDefsPath], {
        env: {
          ...process.env,
          PATH: `${tmpDir}:${process.env["PATH"]}`,
        },
      });

      expect(result1.stdout).toContain("Version: 3");
      const manifest1 = JSON.parse(readFileSync(manifestUploadPath, "utf-8"));
      expect(manifest1.version).toBe(3);
      const updatedAt1 = manifest1.updatedAt;

      // Wait 1 second to ensure different timestamps
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Second invocation: version 3 → 4
      const result2 = await execFileAsync("bash", [scriptPath, "dev", "us-east-1", relayDefsPath], {
        env: {
          ...process.env,
          PATH: `${tmpDir}:${process.env["PATH"]}`,
        },
      });

      expect(result2.stdout).toContain("Version: 4");
      const manifest2 = JSON.parse(readFileSync(manifestUploadPath, "utf-8"));
      expect(manifest2.version).toBe(4);
      const updatedAt2 = manifest2.updatedAt;

      // Verify that updatedAt timestamps are different (monotonic versioning regardless of changes)
      expect(updatedAt1).not.toBe(updatedAt2);

      // Verify both signatures are valid
      for (const manifest of [manifest1, manifest2]) {
        const { version, updatedAt, relays: manifestRelays } = manifest;
        const body = { version, updatedAt, relays: manifestRelays };
        const canonicalPayload = canonicalJson(body as unknown as Record<string, unknown>);
        const sigBytes = Buffer.from(manifest.signature, "hex");
        const isValid = ed25519.verify(sigBytes, canonicalPayload, signerKeypair.publicKey);
        expect(isValid).toBe(true);
      }

    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
