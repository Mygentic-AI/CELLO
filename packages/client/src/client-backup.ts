/**
 * client-backup.ts — Encrypted cloud backup for the CELLO client.
 *
 * PERSIST-011: Encrypts the local SQLCipher database file with AES-256-GCM
 * using a backup_key derived from identity_key via HKDF, and uploads the
 * ciphertext to the configured CloudStorageProvider.
 *
 * Security invariants:
 *   SI-001: backup_key is NEVER uploaded to cloud storage, stored in backup
 *           metadata, or included in any log event.
 *   SI-002: AES-256-GCM with a fresh random 96-bit nonce per backup.
 *           Nonce reuse with GCM leaks both the key and plaintext.
 *   SI-003: Restore writes the decrypted plaintext to a temporary file first.
 *           The live database is replaced only after checksum verification
 *           passes (atomic rename). Corrupt downloads are discarded.
 *
 * Key derivation (RFC 5869 HKDF, NIST SP 800-38D AES-GCM):
 *   backup_key = HKDF-SHA256(ikm=identity_key, salt=none,
 *                             info='backup-key' || NUL || agent_id, length=32)
 *
 * Ciphertext wire format:
 *   [nonce(12)] [auth_tag(16)] [encrypted_plaintext]
 *
 * Backup object key (cloud storage path):
 *   backups/<agentId>/<timestamp>.enc  (timestamp = Date.now() at backup initiation)
 *
 * Backup metadata (stored in ClientStore under 'backup:metadata'):
 *   { timestamp: number, destinationUrl: string, checksum: string }
 *   where checksum = SHA-256 hex of the full ciphertext blob (nonce+tag+ciphertext).
 */

import { randomBytes, createCipheriv, createDecipheriv, createHash } from "node:crypto";
import { readFile, writeFile, rename, unlink } from "node:fs/promises";
import type { CloudStorageProvider, Logger } from "@cello/interfaces";
import { deriveBackupKey } from "./backup-key-derivation.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const NONCE_BYTES = 12;  // 96-bit nonce for AES-256-GCM (NIST SP 800-38D)
const TAG_BYTES = 16;    // 128-bit authentication tag

/**
 * AC-007: Operator-facing warning about data that cannot be reconstructed.
 * This constant is exported so the composition root can surface it in operator runbooks
 * and configuration screens. The story requires it to be present in operator-facing
 * documentation, not just in code comments.
 */
export const BACKUP_WARNING =
  "Conversation Merkle trees are the only data that cannot be reconstructed from the directory. " +
  "If you lose your local database and have no backup, you lose the ability to substantiate any " +
  "dispute about those conversations.";

// ─── Types ────────────────────────────────────────────────────────────────────

/** Backup metadata stored in the local ClientStore. */
interface BackupMetadata {
  /**
   * Unix millisecond timestamp of when the backup completed (upload success).
   * This is NOT the backup initiation time — it records completion time.
   */
  timestamp: number;
  /** Cloud storage destination identifier (e.g. the storage key URL). */
  destinationUrl: string;
  /** SHA-256 hex digest of the full ciphertext blob. Used to verify download integrity. */
  checksum: string;
}

/** Options for constructing a ClientBackup instance. */
export interface ClientBackupOptions {
  /** Stable agent identifier — used in log events and storage key derivation. */
  agentId: string;
  /**
   * The agent's long-term identity_key (32 bytes).
   * backup_key and db_key are both derived from this.
   * NEVER stored, NEVER logged (SI-001).
   */
  identityKey: Uint8Array;
  /** Absolute path to the local SQLCipher database file. */
  dbPath: string;
  /**
   * Cloud storage adapter. If null, backup operations are skipped with a WARN log.
   * Null models the case where the operator has not configured cloud storage (AC-005).
   */
  cloudStorage: CloudStorageProvider | null;
  /** Structured logger injected from the composition root. */
  logger: Logger;
  /**
   * Optional: read backup metadata from the local store.
   * Defaults to no-op returning undefined if not provided (useful for pure encryption tests).
   */
  getMetadata?: (key: string) => Promise<Uint8Array | undefined>;
  /**
   * Optional: write backup metadata to the local store.
   * Defaults to no-op if not provided.
   */
  setMetadata?: (key: string, value: Uint8Array) => Promise<void>;
  /**
   * Optional: verify the restored database is readable after restore completes.
   * AC-003: After writing the decrypted file, restore() calls this callback
   * to open the database with db_key and verify records are readable before
   * declaring restore complete. If this callback throws, restore fails.
   * Defaults to no-op if not provided (useful for pure encryption tests).
   */
  verifyRestored?: (dbPath: string) => Promise<void>;
  /**
   * PERSIST-022: Storage destination type for observability.
   * Set by the composition root to "local" or "s3" depending on which
   * CloudStorageProvider is wired in. Logged in client.backup.completed.
   * Defaults to "local" for backward compatibility with M4 LocalCloudStorageProvider usage.
   */
  destinationType?: "local" | "s3";
}

// ─── ClientBackup ─────────────────────────────────────────────────────────────

/**
 * Manages encrypted cloud backup and restore for the CELLO client database.
 *
 * Lifecycle: construct → backup() | restore() (may be called multiple times).
 */
export class ClientBackup {
  readonly #agentId: string;
  readonly #identityKey: Uint8Array;
  readonly #dbPath: string;
  readonly #cloudStorage: CloudStorageProvider | null;
  readonly #logger: Logger;
  readonly #getMetadata: (key: string) => Promise<Uint8Array | undefined>;
  readonly #setMetadata: (key: string, value: Uint8Array) => Promise<void>;
  readonly #verifyRestored: (dbPath: string) => Promise<void>;
  readonly #destinationType: "local" | "s3";

  constructor(options: ClientBackupOptions) {
    this.#agentId = options.agentId;
    this.#identityKey = options.identityKey;
    this.#dbPath = options.dbPath;
    this.#cloudStorage = options.cloudStorage;
    this.#logger = options.logger;
    this.#getMetadata = options.getMetadata ?? (() => Promise.resolve(undefined));
    this.#setMetadata = options.setMetadata ?? (() => Promise.resolve());
    this.#verifyRestored = options.verifyRestored ?? (() => Promise.resolve());
    this.#destinationType = options.destinationType ?? "local";
  }

  /**
   * Encrypt the local SQLCipher database and upload it to cloud storage.
   *
   * On upload failure: logs client.backup.upload.failed and returns without throwing.
   * On no cloud storage configured: logs client.backup.not.configured (WARN) and returns.
   * On success: logs client.backup.completed and stores backup metadata.
   *
   * Pseudocode:
   *   1. If no cloudStorage → warn client.backup.not.configured, return.
   *   2. Derive backup_key via HKDF (RFC 5869).
   *   3. Read plaintext DB file.
   *   4. Generate fresh random 12-byte nonce (SI-002).
   *   5. Encrypt with AES-256-GCM (NIST SP 800-38D).
   *      Wire: [nonce(12)] [tag(16)] [ciphertext]
   *   6. Compute SHA-256 of the full blob.
   *   7. Upload blob to cloudStorage.
   *   8. On failure: log client.backup.upload.failed, return { ok: false, reason }.
   *   9. Store metadata { timestamp, destinationUrl, checksum } in local store.
   *  10. Log client.backup.completed.
   *  11. Return { ok: true }.
   */
  async backup(): Promise<{ ok: true } | { ok: false; reason: string }> {
    // AC-005: no cloud storage destination configured
    if (this.#cloudStorage === null) {
      this.#logger.warn("client.backup.not.configured", { agentId: this.#agentId });
      return { ok: true }; // Not configured is not a failure — warn is sufficient
    }

    const startMs = Date.now();

    // Derive backup_key — never stored, never logged (SI-001)
    const backupKey = deriveBackupKey(this.#identityKey, this.#agentId);

    // Read the plaintext database file
    const plaintext = await readFile(this.#dbPath);

    // Generate fresh random nonce per backup (SI-002 — never reuse nonce with GCM)
    const nonce = randomBytes(NONCE_BYTES);

    // Encrypt with AES-256-GCM (NIST SP 800-38D)
    const cipher = createCipheriv("aes-256-gcm", backupKey, nonce);
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();

    // Wire format: [nonce(12)] [tag(16)] [encrypted_plaintext]
    const blob = Buffer.concat([nonce, tag, encrypted]);

    // Zero backup_key immediately after use — it must not linger in memory (SI-001)
    backupKey.fill(0);

    // Compute SHA-256 checksum of the full blob (nonce+tag+ciphertext)
    const checksum = createHash("sha256").update(blob).digest("hex");

    // AC-002: key includes timestamp for uniqueness — backups/{agentId}/{timestamp}.enc
    const storageKey = `backups/${this.#agentId}/${startMs}.enc`;
    const destinationUrl = storageKey;

    // Upload to cloud storage
    try {
      await this.#cloudStorage.upload(storageKey, new Uint8Array(blob));
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : String(err);
      // SI-001: context contains only { reason, agentId } — no key material
      this.#logger.error("client.backup.upload.failed", { reason, agentId: this.#agentId });
      return { ok: false, reason }; // local DB is unaffected; next triggered backup retries the full upload
    }

    // Store backup metadata in the local store
    const metadata: BackupMetadata = {
      timestamp: Date.now(),
      destinationUrl,
      checksum,
    };
    const metaBytes = Buffer.from(JSON.stringify(metadata), "utf8");
    await this.#setMetadata("backup:metadata", new Uint8Array(metaBytes));

    const durationMs = Date.now() - startMs;

    this.#logger.info("client.backup.completed", {
      agentId: this.#agentId,
      destinationType: this.#destinationType,
      ciphertextBytes: blob.length,
      durationMs,
    });

    return { ok: true };
  }

  /**
   * Download and decrypt the backup, replacing the local database file.
   *
   * On checksum mismatch: logs client.backup.restore.failed with reason 'checksum_mismatch',
   * discards the corrupt download, does NOT overwrite the local DB, and throws.
   *
   * On decrypt failure: logs client.backup.restore.failed with reason 'decrypt_failed',
   * does NOT overwrite the local DB, and throws.
   *
   * On success: logs client.backup.restore.completed.
   *
   * Pseudocode:
   *   1. Derive backup_key via HKDF.
   *   2. Download ciphertext blob from cloudStorage.
   *   3. Read stored checksum from metadata.
   *   4. Compute SHA-256 of downloaded blob.
   *   5. If mismatch → log client.backup.restore.failed (checksum_mismatch), throw (SI-003).
   *   6. Decrypt with AES-256-GCM.
   *   7. Write plaintext to temp path: dbPath + '.restore-tmp' (SI-003).
   *   8. Atomic rename temp → dbPath.
   *   9. Call verifyRestored callback to open DB with db_key and verify readable (AC-003).
   *  10. Log client.backup.restore.completed.
   */
  async restore(): Promise<void> {
    // AC-005: no cloud storage destination configured
    if (this.#cloudStorage === null) {
      this.#logger.warn("client.backup.not.configured", { agentId: this.#agentId });
      throw new Error("Cloud storage not configured; cannot restore backup");
    }

    const startMs = Date.now();
    const tempPath = this.#dbPath + ".restore-tmp";

    // Derive backup_key — never stored, never logged (SI-001)
    const backupKey = deriveBackupKey(this.#identityKey, this.#agentId);

    let alreadyLogged = false;

    try {
      // Read stored metadata to get the storage key (destinationUrl).
      // The storage key is timestamp-based (backups/{agentId}/{timestamp}.enc),
      // so we must read it from metadata rather than reconstruct it.
      const storedMeta = await this.#readMetadata();

      // Without stored metadata we cannot verify the checksum — fail immediately.
      if (storedMeta === undefined) {
        this.#logger.error("client.backup.restore.failed", {
          reason: "no_backup_metadata",
          agentId: this.#agentId,
        });
        alreadyLogged = true;
        throw new Error("no_backup_metadata");
      }

      const storageKey = storedMeta.destinationUrl;

      // Download and verify
      const downloaded = await this.#cloudStorage.download(storageKey);
      if (downloaded === undefined) {
        const reason = "backup_not_found";
        this.#logger.error("client.backup.restore.failed", { reason, agentId: this.#agentId });
        alreadyLogged = true;
        throw new Error(`Backup not found at ${storageKey}`);
      }
      const blob = downloaded;

      // Verify checksum against stored metadata (SI-003)
      const actualChecksum = createHash("sha256").update(blob).digest("hex");

      if (storedMeta.checksum !== actualChecksum) {
        // SI-001: no key material in error context
        this.#logger.error("client.backup.restore.failed", {
          reason: "checksum_mismatch",
          agentId: this.#agentId,
        });
        alreadyLogged = true;
        // SI-003: temp file was not written yet; local DB untouched
        throw new Error("checksum_mismatch");
      }

      // Decrypt with AES-256-GCM
      // Wire format: [nonce(12)] [tag(16)] [encrypted_plaintext]
      const buf = Buffer.from(blob);
      const nonce = buf.subarray(0, NONCE_BYTES);
      const tag = buf.subarray(NONCE_BYTES, NONCE_BYTES + TAG_BYTES);
      const encryptedBody = buf.subarray(NONCE_BYTES + TAG_BYTES);

      const decipher = createDecipheriv("aes-256-gcm", backupKey, nonce);
      decipher.setAuthTag(tag);
      const plaintext = Buffer.concat([decipher.update(encryptedBody), decipher.final()]);

      // SI-003: write to temp path first, then atomically rename
      // If write fails mid-way, the live DB is untouched
      await writeFile(tempPath, plaintext);
      await rename(tempPath, this.#dbPath);

      // AC-003: After writing the restored file, open the database with db_key
      // and verify it is readable before declaring restore complete.
      // If verification throws, the error propagates and restore fails.
      await this.#verifyRestored(this.#dbPath);

      const durationMs = Date.now() - startMs;
      this.#logger.info("client.backup.restore.completed", {
        agentId: this.#agentId,
        sourceUrl: storageKey,
        durationMs,
      });
    } catch (err: unknown) {
      // Log errors if not already logged
      if (!alreadyLogged) {
        const reason = err instanceof Error ? err.message : String(err);
        this.#logger.error("client.backup.restore.failed", {
          reason,
          agentId: this.#agentId,
        });
      }
      // Attempt to clean up the temp file if it exists (ignore if already gone)
      await unlink(tempPath).catch(() => {});
      throw err;
    } finally {
      // Zero backup_key on all paths (SI-001)
      backupKey.fill(0);
    }
  }

  // ─── Private helpers ─────────────────────────────────────────────────────────

  /** Read and parse backup metadata from the local store. Returns undefined if not found. */
  async #readMetadata(): Promise<BackupMetadata | undefined> {
    const raw = await this.#getMetadata("backup:metadata");
    if (raw === undefined) return undefined;
    try {
      return JSON.parse(Buffer.from(raw).toString("utf8")) as BackupMetadata;
    } catch {
      return undefined;
    }
  }
}
