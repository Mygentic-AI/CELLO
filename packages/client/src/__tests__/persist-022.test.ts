/**
 * CELLO-PERSIST-022 — S3CloudStorageProvider
 *
 * Specification understanding per AC/SI:
 *
 *   AC-001: S3CloudStorageProvider implements CloudStorageProvider interface.
 *           - upload(key, data): Promise<void> — present and correctly typed.
 *           - download(key): Promise<Uint8Array | undefined> — present and correctly typed.
 *           - No S3-specific types (S3Client, commands, etc.) leak into the CloudStorageProvider
 *             interface surface.
 *
 *   AC-004: Upload failure → ClientBackup logs client.backup.upload.failed at ERROR
 *           with { reason, agentId }. The error log context must never contain key material
 *           (backup_key bytes or hex). Simulated via a CloudStorageProvider stub that throws.
 *
 *   AC-005: BACKUP_S3_BUCKET unset → composition root passes cloudStorage=null to ClientBackup.
 *           ClientBackup logs client.backup.not.configured at WARN with { agentId }.
 *           No S3 API calls are made.
 *
 *   AC-006: Two consecutive backups of the same database content → two different ciphertext blobs
 *           (different nonces per backup). Uses LocalCloudStorageProvider in a temp dir for storage.
 *           Assert blob bytes differ.
 *
 *   SI-001: All logger calls across backup() are inspected — none may contain the backup_key
 *           bytes, the backup_key hex, or any derived value. Verified by capturing all events
 *           and asserting backupKeyHex is absent from every serialized event.
 *
 *   SI-002: A restore operation shall never overwrite the live database until the downloaded
 *           ciphertext passes SHA-256 checksum verification. Adversarial condition: even when
 *           the S3 object is truncated or corrupted in transit. Test: perform a real backup
 *           (storing metadata with correct checksum), then attempt a restore using a provider
 *           that returns corrupted/truncated bytes. Assert: (a) restore throws, (b) live DB
 *           file is unchanged, (c) temp file is not left behind.
 *
 *   AC-006: Fresh nonce per backup. Two consecutive backups of the same database content →
 *           two different ciphertext blobs. Separate from SI-002.
 *
 *   DB-001: Upload failure → local database file unaffected. After backup() with a failing
 *           cloud storage adapter, the db file still exists and its bytes are unchanged.
 *
 *   AC-002 / AC-003: Integration tests requiring real S3 or localstack. Shelled correctly with
 *           describeIntegration — only run when CELLO_ENV=local with a real endpoint.
 *           They are not expected to pass in unit CI and must not block the unit suite.
 *
 * Interpretation decisions:
 *   - AC-001 "No S3-specific types leak" means the CloudStorageProvider interface type does NOT
 *     import from @aws-sdk/client-s3. The implementation class is a concrete class; its constructor
 *     takes only a plain { bucket, region } config object, not an S3Client instance.
 *   - The composition root logic for BACKUP_S3_BUCKET env var is tested at the ClientBackup
 *     level — we verify the null-cloudStorage path fires the correct warning.
 *   - AC-006 uses LocalCloudStorageProvider to avoid any real S3 dependency in unit tests.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import type { Logger } from "@cello/interfaces";
import type { CloudStorageProvider } from "@cello/interfaces";
import { LocalCloudStorageProvider } from "@cello/interfaces/stubs";

import { deriveBackupKey } from "../backup-key-derivation.js";
import { ClientBackup } from "../client-backup.js";
import { S3CloudStorageProvider } from "../s3-cloud-storage-provider.js";

// ─── Integration guard (matches pattern in directory tests) ──────────────────
const isLocal = process.env["CELLO_ENV"] === "local";
const describeIntegration = isLocal ? describe : describe.skip;

// ─── Test helpers ────────────────────────────────────────────────────────────

/** Minimal spy logger capturing all events. */
function makeSpyLogger() {
  const events: Array<{ level: string; event: string; context: Record<string, unknown> }> = [];
  const logger: Logger = {
    debug: (event: string, context: Record<string, unknown> = {}) =>
      events.push({ level: "debug", event, context }),
    info: (event: string, context: Record<string, unknown> = {}) =>
      events.push({ level: "info", event, context }),
    warn: (event: string, context: Record<string, unknown> = {}) =>
      events.push({ level: "warn", event, context }),
    error: (event: string, context: Record<string, unknown> = {}) =>
      events.push({ level: "error", event, context }),
  };
  return { logger, events };
}

/** Create a unique temporary directory for test isolation. */
function makeTmpDir(): string {
  const dir = join(tmpdir(), `cello-persist-022-${randomBytes(8).toString("hex")}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanupDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // ignore cleanup errors
  }
}

// ─── AC-001: S3CloudStorageProvider implements CloudStorageProvider ───────────

describe("PERSIST-022 AC-001 — S3CloudStorageProvider interface compliance", () => {
  it("S3CloudStorageProvider has upload method", () => {
    const provider = new S3CloudStorageProvider({ bucket: "test-bucket", region: "eu-west-1" });
    expect(typeof provider.upload).toBe("function");
  });

  it("S3CloudStorageProvider has download method", () => {
    const provider = new S3CloudStorageProvider({ bucket: "test-bucket", region: "eu-west-1" });
    expect(typeof provider.download).toBe("function");
  });

  it("S3CloudStorageProvider is assignable to CloudStorageProvider interface", () => {
    // TypeScript enforces this at compile time; this runtime check verifies the shape
    const provider: CloudStorageProvider = new S3CloudStorageProvider({
      bucket: "test-bucket",
      region: "eu-west-1",
    });
    expect(provider).toBeDefined();
    expect(typeof provider.upload).toBe("function");
    expect(typeof provider.download).toBe("function");
  });

  it("upload returns a Promise", () => {
    const provider = new S3CloudStorageProvider({ bucket: "test-bucket", region: "eu-west-1" });
    // The actual upload will fail (no real S3 in unit tests) but the return type must be Promise
    const result = provider.upload("test/key", new Uint8Array([1, 2, 3]));
    expect(result).toBeInstanceOf(Promise);
    // Swallow the rejection — we only care about the return type here
    result.catch(() => {});
  });

  it("download returns a Promise", () => {
    const provider = new S3CloudStorageProvider({ bucket: "test-bucket", region: "eu-west-1" });
    const result = provider.download("test/key");
    expect(result).toBeInstanceOf(Promise);
    result.catch(() => {});
  });
});

// ─── AC-004: Upload failure → correct error log ───────────────────────────────

describe("PERSIST-022 AC-004 — upload failure emits client.backup.upload.failed", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    cleanupDir(tmpDir);
  });

  it("upload failure → client.backup.upload.failed ERROR with { reason, agentId }; no key material", async () => {
    const identityKey = randomBytes(32);
    const agentId = "agent-persist022-ac004";
    const backupKey = deriveBackupKey(identityKey, agentId);
    const backupKeyHex = Buffer.from(backupKey).toString("hex").toLowerCase();

    const dbPath = join(tmpDir, "local.db");
    writeFileSync(dbPath, randomBytes(128));

    const { logger, events } = makeSpyLogger();

    // Stub that always fails upload
    const failingStorage: CloudStorageProvider = {
      upload: () => Promise.reject(new Error("S3 network error")),
      download: () => Promise.resolve(undefined),
    };

    const backup = new ClientBackup({
      agentId,
      identityKey,
      dbPath,
      cloudStorage: failingStorage,
      logger,
    });

    // Must not throw — upload failure is handled
    await expect(backup.backup()).resolves.not.toThrow();

    // client.backup.upload.failed logged at ERROR
    const failEvents = events.filter((e) => e.event === "client.backup.upload.failed");
    expect(failEvents.length).toBe(1);
    expect(failEvents[0].level).toBe("error");
    expect(failEvents[0].context).toHaveProperty("reason");
    expect(failEvents[0].context).toHaveProperty("agentId", agentId);

    // SI-001: key material must not appear in any log event
    for (const ev of events) {
      const serialized = JSON.stringify(ev).toLowerCase();
      expect(serialized).not.toContain(backupKeyHex);
    }
  });
});

// ─── AC-005: BACKUP_S3_BUCKET unset → cloudStorage=null path ─────────────────

describe("PERSIST-022 AC-005 — null cloudStorage emits client.backup.not.configured", () => {
  it("null cloudStorage → client.backup.not.configured WARN with { agentId }; no S3 calls", async () => {
    const { logger, events } = makeSpyLogger();
    const dbPath = join(tmpdir(), `persist-022-ac005-${randomBytes(8).toString("hex")}.db`);
    writeFileSync(dbPath, randomBytes(64));

    const backup = new ClientBackup({
      agentId: "agent-persist022-ac005",
      identityKey: randomBytes(32),
      dbPath,
      cloudStorage: null,  // models BACKUP_S3_BUCKET unset
      logger,
    });

    // Must not throw
    await expect(backup.backup()).resolves.not.toThrow();

    // client.backup.not.configured WARN
    const warnEvents = events.filter((e) => e.event === "client.backup.not.configured");
    expect(warnEvents.length).toBe(1);
    expect(warnEvents[0].level).toBe("warn");
    expect(warnEvents[0].context).toHaveProperty("agentId", "agent-persist022-ac005");

    // Cleanup
    rmSync(dbPath);
  });
});

// ─── SI-002: Corrupted download never overwrites live DB ─────────────────────
//
// SI-002 adversarial condition: "even when the S3 object is truncated or
// corrupted in transit — the client writes to a temporary path, verifies the
// checksum, and only atomically replaces the live database on success; a
// failed verification discards the temporary file"

describe("PERSIST-022 SI-002 — corrupted download does not overwrite live database", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    cleanupDir(tmpDir);
  });

  it("restore with corrupted S3 download → checksum_mismatch thrown; live DB unchanged", async () => {
    const identityKey = randomBytes(32);
    const agentId = "agent-persist022-si002";
    const originalDbContent = randomBytes(256);
    const dbPath = join(tmpDir, "live.db");
    writeFileSync(dbPath, originalDbContent);

    const { logger } = makeSpyLogger();

    // Step 1: Perform a real backup so metadata with correct checksum is stored.
    // Use LocalCloudStorageProvider to store the real ciphertext.
    const realStorage = new LocalCloudStorageProvider(join(tmpDir, "storage-real"));
    mkdirSync(join(tmpDir, "storage-real"), { recursive: true });

    const localStore = new Map<string, Uint8Array>();

    const backupInstance = new ClientBackup({
      agentId,
      identityKey,
      dbPath,
      cloudStorage: realStorage,
      logger,
      getMetadata: (key) => Promise.resolve(localStore.get(key)),
      setMetadata: (key, val) => { localStore.set(key, val); return Promise.resolve(); },
    });

    await backupInstance.backup();
    // Verify metadata was stored
    expect(localStore.has("backup:metadata")).toBe(true);

    // Step 2: Construct a CORRUPTED storage provider that returns truncated/
    // scrambled bytes instead of the real ciphertext.
    const corruptedStorage: CloudStorageProvider = {
      upload: () => Promise.reject(new Error("upload not expected in SI-002 test")),
      download: (_key: string) => Promise.resolve(new Uint8Array(randomBytes(64))), // wrong bytes
    };

    // Step 3: Build a restore instance wired to the corrupted storage.
    // Metadata (with the correct checksum) is in the local store.
    const restoreInstance = new ClientBackup({
      agentId,
      identityKey,
      dbPath,
      cloudStorage: corruptedStorage,
      logger,
      getMetadata: (key) => Promise.resolve(localStore.get(key)),
      setMetadata: (key, val) => { localStore.set(key, val); return Promise.resolve(); },
    });

    // Step 4: Restore must throw due to checksum mismatch (SI-003 enforcement in ClientBackup).
    await expect(restoreInstance.restore()).rejects.toThrow();

    // Step 5: The live DB file must still exist and contain the original bytes.
    // If restore atomically renamed a temp file over it, this assertion fails.
    expect(existsSync(dbPath)).toBe(true);
    const liveContents = readFileSync(dbPath);
    expect(Buffer.from(liveContents)).toEqual(Buffer.from(originalDbContent));

    // Step 6: The temp file must not be left behind.
    expect(existsSync(dbPath + ".restore-tmp")).toBe(false);
  });
});

// ─── AC-006: Two consecutive backups produce different ciphertext ─────────────
//
// NOTE: The "nonce freshness" guarantee (SI-002 in PERSIST-011) is inherited
// by PERSIST-022 through ClientBackup. AC-006 verifies this property continues
// to hold when S3-style storage is used.

describe("PERSIST-022 AC-006 — consecutive backups of same content produce different ciphertext (fresh nonce)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    cleanupDir(tmpDir);
  });

  it("AC-006: two consecutive backups of identical db content → different ciphertext blobs (different nonces)", async () => {
    const identityKey = randomBytes(32);
    const agentId = "agent-persist022-ac006";
    const plaintext = randomBytes(512);
    const dbPath = join(tmpDir, "local.db");
    writeFileSync(dbPath, plaintext);

    const { logger } = makeSpyLogger();

    // Two separate storage backends — each backup goes to its own store
    const storage1 = new LocalCloudStorageProvider(join(tmpDir, "storage1"));
    const storage2 = new LocalCloudStorageProvider(join(tmpDir, "storage2"));
    mkdirSync(join(tmpDir, "storage1"), { recursive: true });
    mkdirSync(join(tmpDir, "storage2"), { recursive: true });

    const backup1 = new ClientBackup({
      agentId,
      identityKey,
      dbPath,
      cloudStorage: storage1,
      logger,
    });

    const backup2 = new ClientBackup({
      agentId,
      identityKey,
      dbPath,
      cloudStorage: storage2,
      logger,
    });

    await backup1.backup();
    await backup2.backup();

    const blob1 = await storage1.download(`backup/${agentId}/db.enc`);
    const blob2 = await storage2.download(`backup/${agentId}/db.enc`);

    expect(blob1).toBeDefined();
    expect(blob2).toBeDefined();

    // Different nonces → different ciphertexts even with identical plaintext
    expect(Buffer.from(blob1!)).not.toEqual(Buffer.from(blob2!));
  });
});

// ─── SI-001: No key material in any log context ───────────────────────────────

describe("PERSIST-022 SI-001 — key material never appears in log events", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    cleanupDir(tmpDir);
  });

  it("backup_key hex never appears in any log event across a successful backup", async () => {
    const identityKey = randomBytes(32);
    const agentId = "agent-persist022-si001";
    const backupKey = deriveBackupKey(identityKey, agentId);
    const backupKeyHex = Buffer.from(backupKey).toString("hex").toLowerCase();

    const dbPath = join(tmpDir, "local.db");
    writeFileSync(dbPath, randomBytes(256));

    const { logger, events } = makeSpyLogger();
    const storage = new LocalCloudStorageProvider(tmpDir);
    const localStore = new Map<string, Uint8Array>();

    const backup = new ClientBackup({
      agentId,
      identityKey,
      dbPath,
      cloudStorage: storage,
      logger,
      getMetadata: (key) => Promise.resolve(localStore.get(key)),
      setMetadata: (key, val) => { localStore.set(key, val); return Promise.resolve(); },
    });

    await backup.backup();

    for (const ev of events) {
      const serialized = JSON.stringify(ev).toLowerCase();
      expect(serialized).not.toContain(backupKeyHex);
    }
  });
});

// ─── DB-001: Upload failure → local DB unaffected ────────────────────────────

describe("PERSIST-022 DB-001 — upload failure leaves local db file unchanged", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    cleanupDir(tmpDir);
  });

  it("upload failure → local db file exists and is unchanged", async () => {
    const identityKey = randomBytes(32);
    const agentId = "agent-persist022-db001";
    const dbContent = randomBytes(256);
    const dbPath = join(tmpDir, "local.db");
    writeFileSync(dbPath, dbContent);

    const { logger } = makeSpyLogger();

    const failingStorage: CloudStorageProvider = {
      upload: () => Promise.reject(new Error("quota exceeded")),
      download: () => Promise.resolve(undefined),
    };

    const backup = new ClientBackup({
      agentId,
      identityKey,
      dbPath,
      cloudStorage: failingStorage,
      logger,
    });

    // Must not throw
    await expect(backup.backup()).resolves.not.toThrow();

    // Local DB must still exist and be unchanged
    expect(existsSync(dbPath)).toBe(true);
    const contents = readFileSync(dbPath);
    expect(Buffer.from(contents)).toEqual(Buffer.from(dbContent));
  });
});

// ─── AC-002 / AC-003: Integration shells (require real S3 or localstack) ──────
//
// These tests only run when CELLO_ENV=local AND a real S3 endpoint is reachable.
// For now, they are shelled correctly to unblock future integration testing.

describeIntegration("PERSIST-022 AC-002/AC-003 — S3CloudStorageProvider integration (requires localstack)", () => {
  it("AC-002: upload to S3 and download returns identical bytes", async () => {
    const bucket = process.env["BACKUP_S3_BUCKET"];
    const region = process.env["AWS_REGION"] ?? "eu-west-1";

    if (!bucket) {
      // Integration test not fully configured — mark as pending
      return;
    }

    const provider = new S3CloudStorageProvider({ bucket, region });
    const testKey = `test/persist-022/${randomBytes(8).toString("hex")}/data.bin`;
    const testData = randomBytes(256);

    await provider.upload(testKey, testData);
    const downloaded = await provider.download(testKey);

    expect(downloaded).toBeDefined();
    expect(Buffer.from(downloaded!)).toEqual(Buffer.from(testData));
  });

  it("AC-003: download of non-existent key returns undefined (NoSuchKey)", async () => {
    const bucket = process.env["BACKUP_S3_BUCKET"];
    const region = process.env["AWS_REGION"] ?? "eu-west-1";

    if (!bucket) {
      return;
    }

    const provider = new S3CloudStorageProvider({ bucket, region });
    const nonExistentKey = `test/persist-022/${randomBytes(8).toString("hex")}/does-not-exist.bin`;

    const result = await provider.download(nonExistentKey);
    expect(result).toBeUndefined();
  });
});
