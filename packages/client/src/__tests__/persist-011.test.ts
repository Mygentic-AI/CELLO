/**
 * CELLO-PERSIST-011 — Encrypted cloud backup
 *
 * Specification understanding per AC/SI:
 *
 *   AC-001: backup_key = HKDF-SHA256(ikm=identity_key, salt=none,
 *           info='backup-key' || agent_id, length=32)
 *           - Same inputs always produce the same backup_key.
 *           - backup_key != db_key for the same identity_key (distinct info strings).
 *
 *   AC-002: AES-256-GCM encryption:
 *           - ciphertext is NOT equal to the plaintext file bytes
 *           - decrypting with the same backup_key returns bytes identical to original
 *           - decrypting with a different key fails (GCM auth tag check)
 *
 *   AC-003: Full roundtrip via LocalCloudStorageProvider:
 *           - upload ciphertext, delete local DB, restore via identity_key
 *           - after restore, client opens DB with db_key, all records are present
 *
 *   AC-004: After upload completes, backup metadata readable from local store:
 *           - contains: timestamp, destinationUrl, checksum (SHA-256 of ciphertext blob)
 *
 *   AC-005: No cloud destination configured → client.backup.not.configured at WARN
 *           with { agentId }; operation exits without error; local DB unaffected.
 *
 *   AC-006: Corrupted ciphertext → checksum mismatch → client.backup.restore.failed
 *           at ERROR with { reason: 'checksum_mismatch', agentId };
 *           local DB file NOT overwritten.
 *
 *   AC-007: Operator documentation contains the Merkle tree data-loss warning.
 *
 *   SI-001: backup_key never appears in cloud storage, backup metadata, or log events
 *           — even when backup upload fails.
 *
 *   SI-002: AES-256-GCM with fresh random nonce per backup — two backups of the same
 *           DB produce different ciphertext (different nonces).
 *
 *   SI-003: Restore writes to a temp path first; atomically replaces the live DB only
 *           after checksum verification passes — corrupt download is discarded.
 *
 *   DB-001: Upload failure → client.backup.upload.failed at ERROR with { reason, agentId };
 *           local DB unaffected.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, createHash } from "node:crypto";
import { rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import type { Logger } from "@cello-protocol/interfaces";
import type { CloudStorageProvider } from "@cello-protocol/interfaces";

import { deriveBackupKey } from "../backup-key-derivation.js";
import { deriveDbKey } from "../db-key-derivation.js";
import { ClientBackup } from "../client-backup.js";
import { BACKUP_WARNING } from "../client-backup.js";
import { LocalCloudStorageProvider } from "@cello-protocol/interfaces/stubs";

// ─── SQLCipher integration for AC-003 — skip if native module unavailable ─────

let sqlCipherAvailable = false;
let SQLCipherClientStore: typeof import("../sqlcipher-client-store.js").SQLCipherClientStore;

try {
  const mod = await import("../sqlcipher-client-store.js");
  SQLCipherClientStore = mod.SQLCipherClientStore;
  sqlCipherAvailable = true;
} catch {
  // SQLCipher native module not available (CELLO_ENV=local CI scenario)
  sqlCipherAvailable = false;
}

const describeWithSQLCipher = sqlCipherAvailable ? describe : describe.skip;

// ─── Test helpers ────────────────────────────────────────────────────────────

/** Minimal spy logger. */
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

/** Create a temporary directory for test files. */
function makeTmpDir(): string {
  const dir = join(tmpdir(), `cello-persist-011-${randomBytes(8).toString("hex")}`);
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

// ─── AC-001: backup_key derivation ──────────────────────────────────────────

describe("PERSIST-011 AC-001 — backup_key derivation", () => {
  it("same identity_key + agent_id → same backup_key", () => {
    const identityKey = randomBytes(32);
    const agentId = "agent-backup-001";

    const key1 = deriveBackupKey(identityKey, agentId);
    const key2 = deriveBackupKey(identityKey, agentId);

    expect(key1).toEqual(key2);
    expect(key1).toBeInstanceOf(Uint8Array);
    expect(key1.length).toBe(32);
  });

  it("different identity_key → different backup_key", () => {
    const identityKeyA = randomBytes(32);
    const identityKeyB = randomBytes(32);
    const agentId = "agent-backup-001";

    const keyA = deriveBackupKey(identityKeyA, agentId);
    const keyB = deriveBackupKey(identityKeyB, agentId);

    expect(keyA).not.toEqual(keyB);
  });

  it("different agent_id → different backup_key", () => {
    const identityKey = randomBytes(32);

    const keyA = deriveBackupKey(identityKey, "agent-aaa");
    const keyB = deriveBackupKey(identityKey, "agent-bbb");

    expect(keyA).not.toEqual(keyB);
  });

  it("backup_key != db_key for the same identity_key (distinct HKDF info strings)", () => {
    const identityKey = randomBytes(32);
    const agentId = "agent-backup-001";

    const backupKey = deriveBackupKey(identityKey, agentId);
    const dbKey = deriveDbKey(identityKey, agentId);

    // The two keys must be cryptographically distinct
    expect(backupKey).not.toEqual(dbKey);
  });

  it("returns exactly 32 bytes", () => {
    const key = deriveBackupKey(randomBytes(32), "any-agent");
    expect(key.length).toBe(32);
    expect(key).toBeInstanceOf(Uint8Array);
  });
});

// ─── AC-002: AES-256-GCM encryption ─────────────────────────────────────────

describe("PERSIST-011 AC-002 — AES-256-GCM encryption", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    cleanupDir(tmpDir);
  });

  it("ciphertext is NOT equal to plaintext bytes", async () => {
    const identityKey = randomBytes(32);
    const agentId = "agent-ac002";
    const plaintext = randomBytes(1024);
    const dbPath = join(tmpDir, "fake.db");
    writeFileSync(dbPath, plaintext);

    const { logger } = makeSpyLogger();
    const cloudStorage = new LocalCloudStorageProvider(tmpDir);
    const localStore = new Map<string, Uint8Array>();
    const backup = new ClientBackup({
      agentId,
      identityKey,
      dbPath,
      cloudStorage,
      logger,
      getMetadata: (key) => Promise.resolve(localStore.get(key)),
      setMetadata: (key, val) => { localStore.set(key, val); return Promise.resolve(); },
    });

    await backup.backup();

    // Get destinationUrl from stored metadata (key is now backups/{agentId}/{timestamp}.enc)
    const metaBytes = localStore.get("backup:metadata");
    expect(metaBytes).toBeDefined();
    const meta = JSON.parse(Buffer.from(metaBytes!).toString("utf8")) as { destinationUrl: string };

    // Download the uploaded ciphertext blob using the actual storage key
    const ciphertextBlob = await cloudStorage.download(meta.destinationUrl);
    expect(ciphertextBlob).toBeDefined();
    // The blob must not equal the plaintext
    expect(Buffer.from(ciphertextBlob!)).not.toEqual(Buffer.from(plaintext));
  });

  it("decrypting with correct backup_key returns bytes identical to original", async () => {
    const identityKey = randomBytes(32);
    const agentId = "agent-ac002-roundtrip";
    const originalContent = randomBytes(512);
    const dbPath = join(tmpDir, "fake.db");
    writeFileSync(dbPath, originalContent);

    const { logger } = makeSpyLogger();
    const cloudStorage = new LocalCloudStorageProvider(tmpDir);
    const localStore = new Map<string, Uint8Array>();

    const backup = new ClientBackup({
      agentId,
      identityKey,
      dbPath,
      cloudStorage,
      logger,
      getMetadata: (key) => Promise.resolve(localStore.get(key)),
      setMetadata: (key, val) => { localStore.set(key, val); return Promise.resolve(); },
    });

    await backup.backup();

    // Delete local DB
    rmSync(dbPath);

    // Restore
    await backup.restore();

    // The restored file should match the original
    const restored = readFileSync(dbPath);
    expect(Buffer.from(restored)).toEqual(Buffer.from(originalContent));
  });

  it("decrypting with a different key fails (GCM auth tag mismatch)", async () => {
    const identityKey = randomBytes(32);
    const differentIdentityKey = randomBytes(32);
    const agentId = "agent-ac002-wrongkey";
    const plaintext = randomBytes(512);
    const dbPath = join(tmpDir, "fake.db");
    writeFileSync(dbPath, plaintext);

    const { logger } = makeSpyLogger();
    const cloudStorage = new LocalCloudStorageProvider(tmpDir);
    const localStore = new Map<string, Uint8Array>();

    // Backup with original identity key
    const backup = new ClientBackup({
      agentId,
      identityKey,
      dbPath,
      cloudStorage,
      logger,
      getMetadata: (key) => Promise.resolve(localStore.get(key)),
      setMetadata: (key, val) => { localStore.set(key, val); return Promise.resolve(); },
    });
    await backup.backup();

    // Try to restore with a different identity key — must fail
    const badBackup = new ClientBackup({
      agentId,
      identityKey: differentIdentityKey,
      dbPath,
      cloudStorage,
      logger,
      getMetadata: (key) => Promise.resolve(localStore.get(key)),
      setMetadata: (key, val) => { localStore.set(key, val); return Promise.resolve(); },
    });

    await expect(badBackup.restore()).rejects.toThrow();
  });
});

// ─── AC-003: Full restore roundtrip with real SQLCipher database ────────────

describeWithSQLCipher("PERSIST-011 AC-003 — full restore roundtrip with SQLCipher database", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    cleanupDir(tmpDir);
  });

  it("backup, delete, restore — client opens DB with db_key and all records are present", async () => {
    const identityKey = randomBytes(32);
    const agentId = "agent-ac003";
    const dbPath = join(tmpDir, "local.db");
    const dbKey = deriveDbKey(identityKey, agentId);

    const { logger } = makeSpyLogger();
    const cloudStorage = new LocalCloudStorageProvider(tmpDir);
    const localStore = new Map<string, Uint8Array>();

    // Step 1: Create and populate a real SQLCipher database with known records
    const store = new SQLCipherClientStore(dbKey, { dbPath, agentId, logger });
    await store.open();

    const testRecords = [
      { key: "session:001", value: new Uint8Array([1, 2, 3, 4]) },
      { key: "trust:002", value: new Uint8Array([5, 6, 7, 8]) },
      { key: "merkle:003", value: new Uint8Array([9, 10, 11, 12]) },
    ];

    for (const record of testRecords) {
      await store.set(record.key, record.value);
    }
    await store.close();

    // Step 2: Backup the database
    const backup = new ClientBackup({
      agentId,
      identityKey,
      dbPath,
      cloudStorage,
      logger,
      getMetadata: (key) => Promise.resolve(localStore.get(key)),
      setMetadata: (key, val) => { localStore.set(key, val); return Promise.resolve(); },
      // AC-003: verifyRestored opens DB with db_key and verifies records are readable
      verifyRestored: async (restoredPath: string) => {
        const verifyStore = new SQLCipherClientStore(dbKey, {
          dbPath: restoredPath,
          agentId,
          logger,
        });
        await verifyStore.open();

        // Verify all test records are present and match expected values
        for (const record of testRecords) {
          const retrieved = await verifyStore.get(record.key);
          if (retrieved === undefined) {
            await verifyStore.close();
            throw new Error(`Record ${record.key} not found after restore`);
          }
          if (Buffer.compare(Buffer.from(retrieved), Buffer.from(record.value)) !== 0) {
            await verifyStore.close();
            throw new Error(`Record ${record.key} value mismatch after restore`);
          }
        }

        await verifyStore.close();
      },
    });

    await backup.backup();

    // Step 3: Delete local DB
    rmSync(dbPath);
    expect(existsSync(dbPath)).toBe(false);

    // Step 4: Restore — verification callback is invoked before completion
    await backup.restore();

    // Step 5: Verify file exists and is a valid SQLCipher database with correct records
    expect(existsSync(dbPath)).toBe(true);

    const finalStore = new SQLCipherClientStore(dbKey, { dbPath, agentId, logger });
    await finalStore.open();

    for (const record of testRecords) {
      const retrieved = await finalStore.get(record.key);
      expect(retrieved).toBeDefined();
      expect(Buffer.from(retrieved!)).toEqual(Buffer.from(record.value));
    }

    await finalStore.close();
  });
});

// ─── AC-004: Backup metadata in local store ─────────────────────────────────

describe("PERSIST-011 AC-004 — backup metadata stored after upload", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    cleanupDir(tmpDir);
  });

  it("backup metadata contains timestamp, destinationUrl, and SHA-256 checksum of ciphertext", async () => {
    const identityKey = randomBytes(32);
    const agentId = "agent-ac004";
    const plaintext = randomBytes(256);
    const dbPath = join(tmpDir, "fake.db");
    writeFileSync(dbPath, plaintext);

    const { logger } = makeSpyLogger();
    const cloudStorage = new LocalCloudStorageProvider(tmpDir);
    const localStore = new Map<string, Uint8Array>();

    const backup = new ClientBackup({
      agentId,
      identityKey,
      dbPath,
      cloudStorage,
      logger,
      getMetadata: (key) => Promise.resolve(localStore.get(key)),
      setMetadata: (key, val) => { localStore.set(key, val); return Promise.resolve(); },
    });

    const before = Date.now();
    await backup.backup();
    const after = Date.now();

    // Read and parse metadata
    const metaBytes = localStore.get("backup:metadata");
    expect(metaBytes).toBeDefined();

    const meta = JSON.parse(Buffer.from(metaBytes!).toString("utf8")) as {
      timestamp: number;
      destinationUrl: string;
      checksum: string;
    };

    // timestamp must be a number within the test's time window
    expect(typeof meta.timestamp).toBe("number");
    expect(meta.timestamp).toBeGreaterThanOrEqual(before);
    expect(meta.timestamp).toBeLessThanOrEqual(after);

    // destinationUrl must be a non-empty string
    expect(typeof meta.destinationUrl).toBe("string");
    expect(meta.destinationUrl.length).toBeGreaterThan(0);

    // checksum must be a valid SHA-256 hex string (64 chars)
    expect(typeof meta.checksum).toBe("string");
    expect(meta.checksum).toMatch(/^[0-9a-f]{64}$/);

    // Verify the checksum matches the actual uploaded ciphertext
    // The storage key is meta.destinationUrl (backups/{agentId}/{timestamp}.enc)
    const uploaded = await cloudStorage.download(meta.destinationUrl);
    expect(uploaded).toBeDefined();
    const expectedChecksum = createHash("sha256").update(uploaded!).digest("hex");
    expect(meta.checksum).toBe(expectedChecksum);
  });
});

// ─── AC-005: No cloud storage configured ────────────────────────────────────

describe("PERSIST-011 AC-005 — backup skipped when no destination configured", () => {
  it("client.backup.not.configured logged at WARN with { agentId }; no error, no halt", async () => {
    const { logger, events } = makeSpyLogger();
    const dbPath = join(tmpdir(), `no-op-${randomBytes(8).toString("hex")}.db`);
    writeFileSync(dbPath, randomBytes(64));

    const backup = new ClientBackup({
      agentId: "agent-ac005",
      identityKey: randomBytes(32),
      dbPath,
      cloudStorage: null,
      logger,
    });

    // Must not throw
    await expect(backup.backup()).resolves.not.toThrow();

    // client.backup.not.configured must be logged at WARN with agentId
    const warnEvents = events.filter((e) => e.event === "client.backup.not.configured");
    expect(warnEvents.length).toBe(1);
    expect(warnEvents[0].level).toBe("warn");
    expect(warnEvents[0].context).toHaveProperty("agentId", "agent-ac005");

    // The local DB file must be unaffected
    expect(existsSync(dbPath)).toBe(true);
    rmSync(dbPath);
  });
});

// ─── AC-006: Corrupted ciphertext checksum mismatch ─────────────────────────

describe("PERSIST-011 AC-006 — corrupted ciphertext detected at restore", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    cleanupDir(tmpDir);
  });

  it("checksum mismatch → client.backup.restore.failed ERROR with { reason: 'checksum_mismatch', agentId }; local DB NOT overwritten", async () => {
    const identityKey = randomBytes(32);
    const agentId = "agent-ac006";
    const originalContent = randomBytes(256);
    const dbPath = join(tmpDir, "local.db");
    writeFileSync(dbPath, originalContent);

    const { logger, events } = makeSpyLogger();
    const cloudStorage = new LocalCloudStorageProvider(tmpDir);
    const localStore = new Map<string, Uint8Array>();

    const backup = new ClientBackup({
      agentId,
      identityKey,
      dbPath,
      cloudStorage,
      logger,
      getMetadata: (key) => Promise.resolve(localStore.get(key)),
      setMetadata: (key, val) => { localStore.set(key, val); return Promise.resolve(); },
    });

    await backup.backup();

    // Corrupt the uploaded ciphertext in cloud storage using the destinationUrl from metadata
    const metaBytes = localStore.get("backup:metadata");
    expect(metaBytes).toBeDefined();
    const storedMeta = JSON.parse(Buffer.from(metaBytes!).toString("utf8")) as { destinationUrl: string };
    const storageKey = storedMeta.destinationUrl;
    const goodCiphertext = await cloudStorage.download(storageKey);
    expect(goodCiphertext).toBeDefined();
    const corrupted = new Uint8Array(goodCiphertext!.length);
    corrupted.fill(0xff); // all-0xFF is definitely wrong
    await cloudStorage.upload(storageKey, corrupted);

    // Restore must fail (checksum mismatch)
    await expect(backup.restore()).rejects.toThrow();

    // client.backup.restore.failed logged at ERROR with reason: 'checksum_mismatch'
    const failEvents = events.filter((e) => e.event === "client.backup.restore.failed");
    expect(failEvents.length).toBe(1);
    expect(failEvents[0].level).toBe("error");
    expect(failEvents[0].context).toMatchObject({
      reason: "checksum_mismatch",
      agentId,
    });

    // Local DB must NOT be overwritten — original content still present
    expect(existsSync(dbPath)).toBe(true);
    const contents = readFileSync(dbPath);
    expect(Buffer.from(contents)).toEqual(Buffer.from(originalContent));
  });
});

// ─── AC-007: Operator documentation warning ─────────────────────────────────

describe("PERSIST-011 AC-007 — operator documentation contains Merkle tree warning", () => {
  it("BACKUP_WARNING constant contains the required data-loss statement", () => {
    // The story requires this warning be present in operator-facing documentation.
    // We verify it exists as an exported constant that can be surfaced by the composition root.
    expect(BACKUP_WARNING).toContain("Conversation Merkle trees are the only data");
    expect(BACKUP_WARNING).toContain("cannot be reconstructed from the directory");
    expect(BACKUP_WARNING).toContain("dispute");
  });
});

// ─── SI-001: backup_key never in cloud storage, metadata, or logs ────────────

describe("PERSIST-011 SI-001 — backup_key never in cloud storage, metadata, or logs", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    cleanupDir(tmpDir);
  });

  it("backup_key hex never appears in any log event (including upload failure)", async () => {
    const identityKey = randomBytes(32);
    const agentId = "agent-si001";
    const backupKey = deriveBackupKey(identityKey, agentId);
    const backupKeyHex = Buffer.from(backupKey).toString("hex").toLowerCase();

    const { logger, events } = makeSpyLogger();
    const dbPath = join(tmpDir, "local.db");
    writeFileSync(dbPath, randomBytes(256));

    const cloudStorage = new LocalCloudStorageProvider(tmpDir);
    const localStore = new Map<string, Uint8Array>();

    const backup = new ClientBackup({
      agentId,
      identityKey,
      dbPath,
      cloudStorage,
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

  it("backup_key hex never appears in backup metadata stored in local store", async () => {
    const identityKey = randomBytes(32);
    const agentId = "agent-si001-meta";
    const backupKey = deriveBackupKey(identityKey, agentId);
    const backupKeyHex = Buffer.from(backupKey).toString("hex").toLowerCase();

    const { logger } = makeSpyLogger();
    const dbPath = join(tmpDir, "local.db");
    writeFileSync(dbPath, randomBytes(64));

    const cloudStorage = new LocalCloudStorageProvider(tmpDir);
    const localStore = new Map<string, Uint8Array>();

    const backup = new ClientBackup({
      agentId,
      identityKey,
      dbPath,
      cloudStorage,
      logger,
      getMetadata: (key) => Promise.resolve(localStore.get(key)),
      setMetadata: (key, val) => { localStore.set(key, val); return Promise.resolve(); },
    });

    await backup.backup();

    // Check all metadata values stored in local store
    for (const [, value] of localStore.entries()) {
      const serialized = Buffer.from(value).toString("utf8").toLowerCase();
      expect(serialized).not.toContain(backupKeyHex);
    }
  });

  it("client.backup.upload.failed context contains only { reason, agentId } — no key material", async () => {
    const identityKey = randomBytes(32);
    const agentId = "agent-si001-fail";
    const backupKey = deriveBackupKey(identityKey, agentId);
    const backupKeyHex = Buffer.from(backupKey).toString("hex").toLowerCase();

    const { logger, events } = makeSpyLogger();
    const dbPath = join(tmpDir, "local.db");
    writeFileSync(dbPath, randomBytes(64));

    // Cloud storage that always fails on upload
    const failingStorage: CloudStorageProvider = {
      upload: () => Promise.reject(new Error("network error")),
      download: () => Promise.resolve(undefined),
    };

    const backup = new ClientBackup({
      agentId,
      identityKey,
      dbPath,
      cloudStorage: failingStorage,
      logger,
    });

    await backup.backup(); // must not throw — upload failure is handled

    const failEvents = events.filter((e) => e.event === "client.backup.upload.failed");
    expect(failEvents.length).toBe(1);
    expect(failEvents[0].level).toBe("error");
    expect(failEvents[0].context).toHaveProperty("reason");
    expect(failEvents[0].context).toHaveProperty("agentId");

    // key must not appear anywhere in the error event
    const serialized = JSON.stringify(failEvents[0]).toLowerCase();
    expect(serialized).not.toContain(backupKeyHex);
  });
});

// ─── SI-002: fresh random nonce per backup ───────────────────────────────────

describe("PERSIST-011 SI-002 — fresh random nonce per backup", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    cleanupDir(tmpDir);
  });

  it("two backups of the same DB file produce different ciphertext (different nonces)", async () => {
    const identityKey = randomBytes(32);
    const agentId = "agent-si002";
    const plaintext = randomBytes(256);
    const dbPath = join(tmpDir, "local.db");
    writeFileSync(dbPath, plaintext);

    const { logger } = makeSpyLogger();
    const cloudStorage1 = new LocalCloudStorageProvider(join(tmpDir, "storage1"));
    const cloudStorage2 = new LocalCloudStorageProvider(join(tmpDir, "storage2"));
    mkdirSync(join(tmpDir, "storage1"), { recursive: true });
    mkdirSync(join(tmpDir, "storage2"), { recursive: true });
    const localStore1 = new Map<string, Uint8Array>();
    const localStore2 = new Map<string, Uint8Array>();

    const backup1 = new ClientBackup({
      agentId,
      identityKey,
      dbPath,
      cloudStorage: cloudStorage1,
      logger,
      getMetadata: (key) => Promise.resolve(localStore1.get(key)),
      setMetadata: (key, val) => { localStore1.set(key, val); return Promise.resolve(); },
    });

    const backup2 = new ClientBackup({
      agentId,
      identityKey,
      dbPath,
      cloudStorage: cloudStorage2,
      logger,
      getMetadata: (key) => Promise.resolve(localStore2.get(key)),
      setMetadata: (key, val) => { localStore2.set(key, val); return Promise.resolve(); },
    });

    await backup1.backup();
    await backup2.backup();

    // Get destinationUrl from metadata — keys are backups/{agentId}/{timestamp}.enc
    const meta1Bytes = localStore1.get("backup:metadata");
    const meta2Bytes = localStore2.get("backup:metadata");
    expect(meta1Bytes).toBeDefined();
    expect(meta2Bytes).toBeDefined();
    const meta1 = JSON.parse(Buffer.from(meta1Bytes!).toString("utf8")) as { destinationUrl: string };
    const meta2 = JSON.parse(Buffer.from(meta2Bytes!).toString("utf8")) as { destinationUrl: string };

    const cipher1 = await cloudStorage1.download(meta1.destinationUrl);
    const cipher2 = await cloudStorage2.download(meta2.destinationUrl);

    expect(cipher1).toBeDefined();
    expect(cipher2).toBeDefined();
    // Different nonces → different ciphertexts (even with identical plaintext)
    expect(Buffer.from(cipher1!)).not.toEqual(Buffer.from(cipher2!));
  });
});

// ─── SI-003: Atomic restore — temp path, then replace ───────────────────────

describe("PERSIST-011 SI-003 — corrupt download discarded; local DB not overwritten", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    cleanupDir(tmpDir);
  });

  it("SI-003: on checksum failure, local DB file retains its pre-restore content", async () => {
    const identityKey = randomBytes(32);
    const agentId = "agent-si003";
    const originalContent = randomBytes(512);
    const dbPath = join(tmpDir, "local.db");
    writeFileSync(dbPath, originalContent);

    const { logger } = makeSpyLogger();
    const cloudStorage = new LocalCloudStorageProvider(tmpDir);
    const localStore = new Map<string, Uint8Array>();

    const backup = new ClientBackup({
      agentId,
      identityKey,
      dbPath,
      cloudStorage,
      logger,
      getMetadata: (key) => Promise.resolve(localStore.get(key)),
      setMetadata: (key, val) => { localStore.set(key, val); return Promise.resolve(); },
    });

    await backup.backup();

    // Corrupt cloud storage after backup — use destinationUrl from metadata
    const metaBytes = localStore.get("backup:metadata");
    expect(metaBytes).toBeDefined();
    const storedMeta = JSON.parse(Buffer.from(metaBytes!).toString("utf8")) as { destinationUrl: string };
    await cloudStorage.upload(storedMeta.destinationUrl, randomBytes(512));

    // Restore must fail
    await expect(backup.restore()).rejects.toThrow();

    // Local DB must still contain the pre-restore original content
    const afterAttempt = readFileSync(dbPath);
    expect(Buffer.from(afterAttempt)).toEqual(Buffer.from(originalContent));

    // No temp file should be left behind
    const tempPath = dbPath + ".restore-tmp";
    expect(existsSync(tempPath)).toBe(false);
  });
});

// ─── DB-001: Upload failure handling ─────────────────────────────────────────

describe("PERSIST-011 DB-001 — backup upload failure", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    cleanupDir(tmpDir);
  });

  it("upload failure → client.backup.upload.failed ERROR { reason, agentId }; local DB unaffected", async () => {
    const identityKey = randomBytes(32);
    const agentId = "agent-db001";
    const dbContent = randomBytes(256);
    const dbPath = join(tmpDir, "local.db");
    writeFileSync(dbPath, dbContent);

    const { logger, events } = makeSpyLogger();

    // Cloud storage that always fails on upload
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

    // Must NOT throw — upload failure is handled gracefully
    await expect(backup.backup()).resolves.not.toThrow();

    // client.backup.upload.failed must be logged at ERROR
    const failEvents = events.filter((e) => e.event === "client.backup.upload.failed");
    expect(failEvents.length).toBe(1);
    expect(failEvents[0].level).toBe("error");
    expect(failEvents[0].context).toHaveProperty("agentId", agentId);
    expect(failEvents[0].context).toHaveProperty("reason");
    expect(typeof failEvents[0].context.reason).toBe("string");

    // Local DB file must be unaffected
    const contents = readFileSync(dbPath);
    expect(Buffer.from(contents)).toEqual(Buffer.from(dbContent));
  });
});

// ─── Observability: client.backup.completed ──────────────────────────────────

describe("PERSIST-011 observability — client.backup.completed", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    cleanupDir(tmpDir);
  });

  it("client.backup.completed logged at INFO with { agentId, destinationType, ciphertextBytes, durationMs }", async () => {
    const identityKey = randomBytes(32);
    const agentId = "agent-obs-backup";
    const dbPath = join(tmpDir, "local.db");
    writeFileSync(dbPath, randomBytes(128));

    const { logger, events } = makeSpyLogger();
    const cloudStorage = new LocalCloudStorageProvider(tmpDir);
    const localStore = new Map<string, Uint8Array>();

    const backup = new ClientBackup({
      agentId,
      identityKey,
      dbPath,
      cloudStorage,
      logger,
      getMetadata: (key) => Promise.resolve(localStore.get(key)),
      setMetadata: (key, val) => { localStore.set(key, val); return Promise.resolve(); },
    });

    await backup.backup();

    const completedEvents = events.filter((e) => e.event === "client.backup.completed");
    expect(completedEvents.length).toBe(1);
    expect(completedEvents[0].level).toBe("info");
    expect(completedEvents[0].context).toHaveProperty("agentId", agentId);
    expect(completedEvents[0].context).toHaveProperty("destinationType");
    expect(completedEvents[0].context).toHaveProperty("ciphertextBytes");
    expect(completedEvents[0].context).toHaveProperty("durationMs");
    expect(typeof completedEvents[0].context.ciphertextBytes).toBe("number");
    expect(typeof completedEvents[0].context.durationMs).toBe("number");
  });
});

// ─── Observability: client.backup.restore.completed ──────────────────────────

describe("PERSIST-011 observability — client.backup.restore.completed", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    cleanupDir(tmpDir);
  });

  it("client.backup.restore.completed logged at INFO with { agentId, sourceUrl, durationMs }", async () => {
    const identityKey = randomBytes(32);
    const agentId = "agent-obs-restore";
    const originalContent = randomBytes(128);
    const dbPath = join(tmpDir, "local.db");
    writeFileSync(dbPath, originalContent);

    const { logger, events } = makeSpyLogger();
    const cloudStorage = new LocalCloudStorageProvider(tmpDir);
    const localStore = new Map<string, Uint8Array>();

    const backup = new ClientBackup({
      agentId,
      identityKey,
      dbPath,
      cloudStorage,
      logger,
      getMetadata: (key) => Promise.resolve(localStore.get(key)),
      setMetadata: (key, val) => { localStore.set(key, val); return Promise.resolve(); },
    });

    await backup.backup();
    rmSync(dbPath);
    await backup.restore();

    const restoreEvents = events.filter((e) => e.event === "client.backup.restore.completed");
    expect(restoreEvents.length).toBe(1);
    expect(restoreEvents[0].level).toBe("info");
    expect(restoreEvents[0].context).toHaveProperty("agentId", agentId);
    expect(restoreEvents[0].context).toHaveProperty("sourceUrl");
    expect(restoreEvents[0].context).toHaveProperty("durationMs");
    expect(typeof restoreEvents[0].context.durationMs).toBe("number");
  });
});
