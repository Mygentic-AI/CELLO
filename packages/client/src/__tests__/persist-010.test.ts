/**
 * CELLO-PERSIST-010 — SigningKeyProvider abstraction
 *
 * Test coverage:
 *   AC-001: sign() returns valid Ed25519 signature verified by getPublicKey()
 *   AC-002: Ed25519 signatures are deterministic — same data → same signature
 *   AC-003: Interface has exactly getPublicKey() and sign() — no private key exposure
 *   AC-004: EncryptedFileSigningKeyProvider zeroes key after sign() (SI-002)
 *   AC-005: Missing key file → SigningKeyProviderError with reason 'key_file_not_found'
 *   AC-006: client.key.signed logged; no private key in logs
 *   AC-007: No direct private key access outside provider implementations (structural)
 *
 *   SI-001: No method returns the private key
 *   SI-002: Key zeroed after sign(), even on throw (try/finally)
 *   SI-003: No fallback to weaker signing on failure
 *
 * RFC reference: Ed25519 per RFC 8032.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { rmSync, mkdirSync, writeFileSync, readdirSync, statSync, readFileSync } from "node:fs";
import { verify } from "@cello-protocol/crypto";
import type { SigningKeyProvider } from "@cello-protocol/interfaces";
import { SigningKeyProviderError } from "@cello-protocol/interfaces";
import type { Logger } from "@cello-protocol/interfaces";

import { EncryptedFileSigningKeyProvider } from "../encrypted-file-signing-key-provider.js";

// ─── Test helpers ────────────────────────────────────────────────────────────

/** Minimal spy logger for capturing log events in tests. */
function makeSpyLogger() {
  const events: Array<{ level: string; event: string; context: Record<string, unknown> }> = [];
  const logger: Logger = {
    debug: (event: string, context: Record<string, unknown> = {}) => events.push({ level: "debug", event, context }),
    info: (event: string, context: Record<string, unknown> = {}) => events.push({ level: "info", event, context }),
    warn: (event: string, context: Record<string, unknown> = {}) => events.push({ level: "warn", event, context }),
    error: (event: string, context: Record<string, unknown> = {}) => events.push({ level: "error", event, context }),
  };
  return { logger, events };
}

/** Create a temporary directory for test key files. */
function makeTmpDir(): string {
  const dir = join(tmpdir(), `cello-persist-010-${randomBytes(8).toString("hex")}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Write a key file in the CELLO key file format (magic + version + 32-byte seed).
 * Format: [0xCE, 0x11, 0x0E, 0x01] + [0x01] + [32 bytes seed]
 */
function writeKeyFile(path: string, seed: Uint8Array): void {
  const magic = Buffer.from([0xce, 0x11, 0x0e, 0x01]);
  const version = Buffer.from([0x01]);
  const buf = Buffer.concat([magic, version, Buffer.from(seed)]);
  writeFileSync(path, buf, { mode: 0o600 });
}

function cleanupDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // ignore cleanup errors
  }
}

// ─── AC-001: sign() returns valid Ed25519 signature ─────────────────────────

describe("PERSIST-010 AC-001 — sign() returns valid Ed25519 signature", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    cleanupDir(tmpDir);
  });

  it("sign(data) returns a signature that verifies against getPublicKey()", async () => {
    const seed = randomBytes(32);
    const keyPath = join(tmpDir, "test.key");
    writeKeyFile(keyPath, seed);

    const { logger } = makeSpyLogger();
    const provider = await EncryptedFileSigningKeyProvider.load(keyPath, {
      agentId: "agent-ac001",
      logger,
    });

    const data = randomBytes(32);
    const signature = await provider.sign(data);
    const pubkey = await provider.getPublicKey();

    // Verify using the standard Ed25519 verify function (no mocks)
    const valid = verify(pubkey, data, signature);
    expect(valid).toBe(true);
  });

  it("signature is exactly 64 bytes", async () => {
    const seed = randomBytes(32);
    const keyPath = join(tmpDir, "test.key");
    writeKeyFile(keyPath, seed);

    const { logger } = makeSpyLogger();
    const provider = await EncryptedFileSigningKeyProvider.load(keyPath, {
      agentId: "agent-ac001-len",
      logger,
    });

    const data = randomBytes(32);
    const signature = await provider.sign(data);
    expect(signature.length).toBe(64);
  });

  it("public key is exactly 32 bytes", async () => {
    const seed = randomBytes(32);
    const keyPath = join(tmpDir, "test.key");
    writeKeyFile(keyPath, seed);

    const { logger } = makeSpyLogger();
    const provider = await EncryptedFileSigningKeyProvider.load(keyPath, {
      agentId: "agent-ac001-publen",
      logger,
    });

    const pubkey = await provider.getPublicKey();
    expect(pubkey.length).toBe(32);
  });
});

// ─── AC-002: Ed25519 signatures are deterministic ───────────────────────────

describe("PERSIST-010 AC-002 — Ed25519 signatures are deterministic", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    cleanupDir(tmpDir);
  });

  it("two calls to sign() with same data return identical signatures", async () => {
    const seed = randomBytes(32);
    const keyPath = join(tmpDir, "test.key");
    writeKeyFile(keyPath, seed);

    const { logger } = makeSpyLogger();
    const provider = await EncryptedFileSigningKeyProvider.load(keyPath, {
      agentId: "agent-ac002",
      logger,
    });

    const data = randomBytes(32);
    const sig1 = await provider.sign(data);
    const sig2 = await provider.sign(data);
    expect(sig1).toEqual(sig2);

    // Both verify
    const pubkey = await provider.getPublicKey();
    expect(verify(pubkey, data, sig1)).toBe(true);
    expect(verify(pubkey, data, sig2)).toBe(true);
  });
});

// ─── AC-003: Interface purity — only getPublicKey() and sign() ──────────────

describe("PERSIST-010 AC-003 — SigningKeyProvider interface has exactly two methods", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    cleanupDir(tmpDir);
  });

  it("SigningKeyProvider exposes only getPublicKey() and sign()", async () => {
    const seed = randomBytes(32);
    const keyPath = join(tmpDir, "test.key");
    writeKeyFile(keyPath, seed);

    const { logger } = makeSpyLogger();
    const provider: SigningKeyProvider = await EncryptedFileSigningKeyProvider.load(keyPath, {
      agentId: "agent-ac003",
      logger,
    });

    // Type-level check: provider satisfies SigningKeyProvider
    expect(typeof provider.getPublicKey).toBe("function");
    expect(typeof provider.sign).toBe("function");
  });

  it("interface has NO method that returns the private key (SI-001)", async () => {
    const seed = randomBytes(32);
    const keyPath = join(tmpDir, "test.key");
    writeKeyFile(keyPath, seed);

    const { logger } = makeSpyLogger();
    const provider = await EncryptedFileSigningKeyProvider.load(keyPath, {
      agentId: "agent-si001",
      logger,
    });

    // The provider object should not have any method that could expose raw key material.
    // Pattern catches: private, secret, seed, export, getKey, getBuffer, getInternal.
    // Note: isKeyBufferZeroedForTesting() is intentionally NOT caught — it returns boolean
    // only and does not expose key bytes.
    const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(provider));
    const dangerousMethods = methods.filter((m) =>
      /private|secret|seed|export|getKey|getBuffer|getInternal/i.test(m),
    );
    expect(dangerousMethods).toEqual([]);
  });
});

// ─── AC-004: Key zeroed after sign() (SI-002) ──────────────────────────────

describe("PERSIST-010 AC-004 / SI-002 — key buffer zeroed after sign()", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    cleanupDir(tmpDir);
  });

  it("key buffer zeroed after successful sign() call — verified via internal state", async () => {
    const seed = randomBytes(32);
    const keyPath = join(tmpDir, "test.key");
    writeKeyFile(keyPath, seed);

    const { logger } = makeSpyLogger();
    const provider = await EncryptedFileSigningKeyProvider.load(keyPath, {
      agentId: "agent-ac004",
      logger,
    });

    const data = randomBytes(32);
    const signature = await provider.sign(data);

    // Verify the signature is still valid (proves sign worked before zeroing)
    const pubkey = await provider.getPublicKey();
    expect(verify(pubkey, data, signature)).toBe(true);

    // The internal seed buffer should be zeroed after sign() — verified without
    // exposing the key bytes (SI-001): isKeyBufferZeroedForTesting() returns boolean only.
    expect(provider.isKeyBufferZeroedForTesting()).toBe(true);
  });

  it("key buffer zeroed even when sign() throws after key load (SI-002 try/finally)", async () => {
    const seed = randomBytes(32);
    const keyPath = join(tmpDir, "test.key");
    writeKeyFile(keyPath, seed);

    const { logger } = makeSpyLogger();
    const provider = await EncryptedFileSigningKeyProvider.load(keyPath, {
      agentId: "agent-si002-throw",
      logger,
    });

    // Use throwAfterLoadForTesting() — this causes sign() to throw AFTER the seed has
    // been read into the working buffer (non-zero key material is in the buffer at throw
    // time). The finally block must still zero it. This is the genuine SI-002 adversarial
    // path; corruptForTesting() exits before the file is read and never loads key material.
    provider.throwAfterLoadForTesting();

    // sign() should throw
    await expect(provider.sign(randomBytes(32))).rejects.toThrow("injected failure after key load");

    // The finally block must have zeroed the buffer even though sign() threw
    expect(provider.isKeyBufferZeroedForTesting()).toBe(true);
  });
});

// ─── AC-005: Missing key file → SigningKeyProviderError ─────────────────────

describe("PERSIST-010 AC-005 — missing key file throws at init", () => {
  it("throws SigningKeyProviderError with reason 'key_file_not_found' for missing path", async () => {
    const { logger } = makeSpyLogger();
    const nonexistentPath = join(tmpdir(), "nonexistent-key-file-" + randomBytes(8).toString("hex"));

    const thrown = await EncryptedFileSigningKeyProvider.load(nonexistentPath, {
      agentId: "agent-ac005",
      logger,
    }).catch((e: unknown) => e);

    expect(thrown).toBeInstanceOf(SigningKeyProviderError);
    expect(thrown).toMatchObject({
      name: "SigningKeyProviderError",
      reason: "key_file_not_found",
      path: nonexistentPath,
    });
  });

  it("logs client.key.provider.init.failed on missing key file", async () => {
    const { logger, events } = makeSpyLogger();
    const nonexistentPath = join(tmpdir(), "nonexistent-" + randomBytes(8).toString("hex"));

    try {
      await EncryptedFileSigningKeyProvider.load(nonexistentPath, {
        agentId: "agent-ac005-log",
        logger,
      });
    } catch {
      // expected
    }

    const failedEvents = events.filter((e) => e.event === "client.key.provider.init.failed");
    expect(failedEvents.length).toBe(1);
    expect(failedEvents[0].context).toMatchObject({
      agentId: "agent-ac005-log",
      providerType: "EncryptedFileSigningKeyProvider",
      reason: "key_file_not_found",
    });
  });
});

// ─── AC-006: Observability — client.key.signed logged, no private key ───────

describe("PERSIST-010 AC-006 — observability", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    cleanupDir(tmpDir);
  });

  it("client.key.signed logged at INFO with { agentId, dataLength }", async () => {
    const seed = randomBytes(32);
    const keyPath = join(tmpDir, "test.key");
    writeKeyFile(keyPath, seed);

    const { logger, events } = makeSpyLogger();
    const provider = await EncryptedFileSigningKeyProvider.load(keyPath, {
      agentId: "agent-ac006",
      logger,
    });

    const data = randomBytes(64);
    await provider.sign(data);

    const signedEvents = events.filter((e) => e.event === "client.key.signed");
    expect(signedEvents.length).toBe(1);
    expect(signedEvents[0].level).toBe("info");
    expect(signedEvents[0].context).toMatchObject({
      agentId: "agent-ac006",
      dataLength: 64,
    });
  });

  it("client.key.signed includes correlationId when provided via opts", async () => {
    const seed = randomBytes(32);
    const keyPath = join(tmpDir, "test.key");
    writeKeyFile(keyPath, seed);

    const { logger, events } = makeSpyLogger();
    const provider = await EncryptedFileSigningKeyProvider.load(keyPath, {
      agentId: "agent-ac006-corr",
      logger,
    });

    const data = randomBytes(64);
    await provider.sign(data, { correlationId: "corr-123" });

    const signedEvents = events.filter((e) => e.event === "client.key.signed");
    expect(signedEvents.length).toBe(1);
    expect(signedEvents[0].context).toMatchObject({
      agentId: "agent-ac006-corr",
      dataLength: 64,
      correlationId: "corr-123",
    });
  });

  it("client.key.signed omits correlationId when not provided", async () => {
    const seed = randomBytes(32);
    const keyPath = join(tmpDir, "test.key");
    writeKeyFile(keyPath, seed);

    const { logger, events } = makeSpyLogger();
    const provider = await EncryptedFileSigningKeyProvider.load(keyPath, {
      agentId: "agent-ac006-nocorr",
      logger,
    });

    const data = randomBytes(64);
    await provider.sign(data);

    const signedEvents = events.filter((e) => e.event === "client.key.signed");
    expect(signedEvents.length).toBe(1);
    expect(signedEvents[0].context).not.toHaveProperty("correlationId");
  });

  it("client.key.provider.initialised logged at INFO on successful load", async () => {
    const seed = randomBytes(32);
    const keyPath = join(tmpDir, "test.key");
    writeKeyFile(keyPath, seed);

    const { logger, events } = makeSpyLogger();
    await EncryptedFileSigningKeyProvider.load(keyPath, {
      agentId: "agent-ac006-init",
      logger,
    });

    const initEvents = events.filter((e) => e.event === "client.key.provider.initialised");
    expect(initEvents.length).toBe(1);
    expect(initEvents[0].level).toBe("info");
    expect(initEvents[0].context).toMatchObject({
      agentId: "agent-ac006-init",
      providerType: "EncryptedFileSigningKeyProvider",
    });
  });

  it("no private key bytes appear in any log event", async () => {
    const seed = randomBytes(32);
    const keyPath = join(tmpDir, "test.key");
    writeKeyFile(keyPath, seed);

    const seedHex = Buffer.from(seed).toString("hex").toLowerCase();

    const { logger, events } = makeSpyLogger();
    const provider = await EncryptedFileSigningKeyProvider.load(keyPath, {
      agentId: "agent-ac006-noleak",
      logger,
    });

    await provider.sign(randomBytes(32));

    // No log event should contain the private key hex
    for (const ev of events) {
      const serialized = JSON.stringify(ev).toLowerCase();
      expect(serialized).not.toContain(seedHex);
    }
  });

  it("no key file path appears in successful signing log events", async () => {
    const seed = randomBytes(32);
    const keyPath = join(tmpDir, "test.key");
    writeKeyFile(keyPath, seed);

    const { logger, events } = makeSpyLogger();
    const provider = await EncryptedFileSigningKeyProvider.load(keyPath, {
      agentId: "agent-ac006-nopath",
      logger,
    });

    await provider.sign(randomBytes(32));

    const signedEvents = events.filter((e) => e.event === "client.key.signed");
    for (const ev of signedEvents) {
      const serialized = JSON.stringify(ev);
      expect(serialized).not.toContain(keyPath);
    }
  });

  it("client.key.sign.failed logged when sign() throws", async () => {
    const seed = randomBytes(32);
    const keyPath = join(tmpDir, "test.key");
    writeKeyFile(keyPath, seed);

    const { logger, events } = makeSpyLogger();
    const provider = await EncryptedFileSigningKeyProvider.load(keyPath, {
      agentId: "agent-ac006-fail",
      logger,
    });

    // Corrupt to force failure
    provider.corruptForTesting();

    try {
      await provider.sign(randomBytes(32));
    } catch {
      // expected
    }

    const failEvents = events.filter((e) => e.event === "client.key.sign.failed");
    expect(failEvents.length).toBe(1);
    expect(failEvents[0].level).toBe("error");
    expect(failEvents[0].context).toHaveProperty("agentId", "agent-ac006-fail");
    expect(failEvents[0].context).toHaveProperty("reason");
  });
});

// ─── SI-003: No fallback to weaker signing ──────────────────────────────────

describe("PERSIST-010 SI-003 — no fallback to weaker signing", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    cleanupDir(tmpDir);
  });

  it("sign() failure propagates error; does not generate ephemeral key", async () => {
    const seed = randomBytes(32);
    const keyPath = join(tmpDir, "test.key");
    writeKeyFile(keyPath, seed);

    const { logger } = makeSpyLogger();
    const provider = await EncryptedFileSigningKeyProvider.load(keyPath, {
      agentId: "agent-si003",
      logger,
    });

    // Corrupt to force failure
    provider.corruptForTesting();

    // Must throw — no fallback
    const thrown = await provider.sign(randomBytes(32)).catch((e: unknown) => e);
    expect(thrown).toBeInstanceOf(SigningKeyProviderError);
    expect(thrown).toMatchObject({ name: "SigningKeyProviderError" });
  });
});

// ─── Corrupt key file ───────────────────────────────────────────────────────

describe("PERSIST-010 — corrupt key file handling", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    cleanupDir(tmpDir);
  });

  it("corrupt key file (wrong magic) throws with reason 'key_file_corrupt'", async () => {
    const keyPath = join(tmpDir, "corrupt.key");
    writeFileSync(keyPath, randomBytes(37)); // correct size, wrong magic

    const { logger } = makeSpyLogger();
    const thrown = await EncryptedFileSigningKeyProvider.load(keyPath, {
      agentId: "agent-corrupt",
      logger,
    }).catch((e: unknown) => e);

    expect(thrown).toBeInstanceOf(SigningKeyProviderError);
    expect(thrown).toMatchObject({
      name: "SigningKeyProviderError",
      reason: "key_file_corrupt",
    });
  });

  it("key file with wrong length throws with reason 'key_file_corrupt'", async () => {
    const keyPath = join(tmpDir, "short.key");
    writeFileSync(keyPath, randomBytes(10)); // too short

    const { logger } = makeSpyLogger();
    const thrown = await EncryptedFileSigningKeyProvider.load(keyPath, {
      agentId: "agent-short",
      logger,
    }).catch((e: unknown) => e);

    expect(thrown).toBeInstanceOf(SigningKeyProviderError);
    expect(thrown).toMatchObject({
      name: "SigningKeyProviderError",
      reason: "key_file_corrupt",
    });
  });
});

// ─── AC-007: No direct raw key access outside provider implementations ────────

describe("PERSIST-010 AC-007 — no direct private key access outside provider files", () => {
  /**
   * Static verification: scan all .ts source files under packages/client/src/ and assert
   * that @noble/curves/ed25519 (the raw Ed25519 signing primitive) is only imported in
   * files whose name matches *-signing-key-provider*.ts.
   *
   * Scope: packages/client only. The @cello-protocol/crypto package is the legitimate home of
   * low-level crypto primitives and may use ed25519 directly. This test enforces that
   * CLIENT application code always goes through the SigningKeyProvider abstraction,
   * never calling ed25519 directly with seed bytes.
   *
   * Test files (__tests__/**) are excluded — the test fixture in this file imports
   * EncryptedFileSigningKeyProvider which itself is the allowed entry point.
   */
  it("AC-007 — within @cello-protocol/client, @noble/curves/ed25519 only imported in *-signing-key-provider* files", () => {
    // packages/client/src/ — the application code boundary
    const clientSrcRoot = join(__dirname, "../");

    // Recursively collect all .ts files, excluding node_modules, dist, and __tests__
    function collectTsFiles(dir: string): string[] {
      const results: string[] = [];
      for (const entry of readdirSync(dir)) {
        const fullPath = join(dir, entry);
        if (entry === "node_modules" || entry === "dist" || entry === "__tests__") continue;
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
          results.push(...collectTsFiles(fullPath));
        } else if (entry.endsWith(".ts")) {
          results.push(fullPath);
        }
      }
      return results;
    }

    const appFiles = collectTsFiles(clientSrcRoot);

    // Files allowed to import @noble/curves/ed25519 directly
    const allowedPattern = /-signing-key-provider/;

    const violations: string[] = [];
    for (const filePath of appFiles) {
      // Skip allowed provider files
      if (allowedPattern.test(filePath)) continue;

      const content = readFileSync(filePath, "utf8");
      // Check for actual import statements using the raw ed25519 primitive.
      // We match only `import` or `require` statements, not comments or prose.
      const importPattern = /^\s*(?:import|export)\s+.*['"]@noble\/curves\/ed25519/m;
      const requirePattern = /require\s*\(\s*['"]@noble\/curves\/ed25519/;
      if (importPattern.test(content) || requirePattern.test(content)) {
        violations.push(filePath.replace(clientSrcRoot, "src/"));
      }
    }

    expect(violations).toEqual([]);
  });
});
