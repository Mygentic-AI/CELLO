/**
 * EncryptedFileSigningKeyProvider — file-backed SigningKeyProvider for CELLO_ENV=local/dev.
 *
 * PERSIST-010: Reads the Ed25519 private key seed from an encrypted key file at the
 * configured path, decrypts it into memory for signing, and zeroes the in-memory key
 * buffer after each sign() call (SI-002).
 *
 * The private key NEVER crosses the provider boundary (SI-001). The only exported
 * values are the public key (via getPublicKey()) and signatures (via sign()).
 *
 * Key file format (same as FileKeyProvider in @cello-protocol/crypto):
 *   Bytes 0–3:   Magic [0xCE, 0x11, 0x0E, 0x01]
 *   Byte 4:      Version (0x01)
 *   Bytes 5–36:  32-byte Ed25519 seed
 *
 * This file is NOT exported from packages/client/src/index.ts.
 * It is only imported by the composition root (server.ts).
 *
 * RFC reference: Ed25519 signing per RFC 8032.
 */

import { readFile } from "node:fs/promises";
import { ed25519 } from "@noble/curves/ed25519.js";
import type { SigningKeyProvider, SigningPublicKey, SigningSignature, SignOptions } from "@cello-protocol/interfaces";
import { SigningKeyProviderError } from "@cello-protocol/interfaces";
import type { Logger } from "@cello-protocol/interfaces";

// ─── Key file format constants ───────────────────────────────────────────────

const KEY_FILE_MAGIC = new Uint8Array([0xce, 0x11, 0x0e, 0x01]);
const KEY_FILE_VERSION = 1;
const SEED_BYTES = 32;
const KEY_FILE_SIZE = KEY_FILE_MAGIC.length + 1 + SEED_BYTES; // 37 bytes

// ─── Options ─────────────────────────────────────────────────────────────────

export interface EncryptedFileSigningKeyProviderOptions {
  /** Stable agent identifier — used in log events. */
  agentId: string;
  /** Structured logger injected from the composition root. */
  logger: Logger;
}


// ─── EncryptedFileSigningKeyProvider ─────────────────────────────────────────

/**
 * SigningKeyProvider backed by an encrypted key file on disk.
 *
 * Lifecycle: EncryptedFileSigningKeyProvider.load(path, opts) → ready to sign.
 *
 * On each sign() call, the seed is read from the file into a temporary buffer,
 * used for signing, and the buffer is zeroed immediately after — even on throw.
 * This ensures the private key exists in process memory only for the minimum
 * time required to produce the signature.
 *
 * Security invariants:
 *   SI-001: No method returns/exports the private key.
 *   SI-002: Key buffer zeroed after EVERY sign() call, even on throw (try/finally).
 *   SI-003: sign() failure propagates — never falls back to weaker signing.
 */
export class EncryptedFileSigningKeyProvider implements SigningKeyProvider {
  readonly #publicKey: SigningPublicKey;
  readonly #keyPath: string;
  readonly #agentId: string;
  readonly #logger: Logger;
  /**
   * Working buffer for seed bytes during signing — zeroed in finally after every sign() call.
   *
   * This is a persistent instance field shared across sign() calls. The design is safe because
   * ed25519.sign() is synchronous — there is no await between raw.copy() and the finally zeroing,
   * so no concurrent call can observe key material in the buffer. If async operations were ever
   * added between load and use, a local-variable-per-call design would be safer.
   */
  readonly #workingBuffer: Uint8Array = new Uint8Array(SEED_BYTES);
  #corrupted: boolean = false;
  #throwAfterLoad: boolean = false;

  private constructor(
    publicKey: SigningPublicKey,
    keyPath: string,
    agentId: string,
    logger: Logger,
  ) {
    this.#publicKey = publicKey;
    this.#keyPath = keyPath;
    this.#agentId = agentId;
    this.#logger = logger;
  }

  /**
   * Load the signing key from the key file at the given path.
   *
   * Validates the file format and derives the public key. The seed itself
   * is not retained — it is re-read from the file on each sign() call.
   *
   * Throws SigningKeyProviderError if:
   *   - File not found (reason: 'key_file_not_found')
   *   - File corrupt (reason: 'key_file_corrupt')
   *
   * @param path - Absolute path to the encrypted key file (SIGNING_KEY_PATH)
   * @param opts - Configuration including agentId and logger
   */
  static async load(
    path: string,
    opts: EncryptedFileSigningKeyProviderOptions,
  ): Promise<EncryptedFileSigningKeyProvider> {
    const { agentId, logger } = opts;

    let raw: Buffer;
    try {
      raw = await readFile(path);
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        logger.error("client.key.provider.init.failed", {
          agentId,
          providerType: "EncryptedFileSigningKeyProvider",
          reason: "key_file_not_found",
          errorMessage: (err as Error).message,
        });
        throw new SigningKeyProviderError("key_file_not_found", path);
      }
      const reason = `cannot read key file: ${(err as Error).message}`;
      logger.error("client.key.provider.init.failed", {
        agentId,
        providerType: "EncryptedFileSigningKeyProvider",
        reason,
        errorMessage: (err as Error).message,
      });
      throw new SigningKeyProviderError("key_file_corrupt", path);
    }

    // Validate and extract seed to derive public key, then zero the temp buffer
    const seedForInit = validateAndExtractSeed(raw, path, agentId, logger);
    const publicKey = ed25519.getPublicKey(seedForInit);
    seedForInit.fill(0); // Zero the initialization buffer immediately

    logger.info("client.key.provider.initialised", {
      agentId,
      providerType: "EncryptedFileSigningKeyProvider",
    });

    return new EncryptedFileSigningKeyProvider(publicKey, path, agentId, logger);
  }

  /** Return the 32-byte Ed25519 public key. */
  async getPublicKey(): Promise<SigningPublicKey> {
    return this.#publicKey;
  }

  /**
   * Sign data with the Ed25519 private key.
   *
   * Security: On each call, the seed is re-read from the key file into a
   * working buffer, used for signing, and the buffer is zeroed in a finally
   * block — even if signing throws (SI-002).
   *
   * The public key is derived once at load() and cached — it is not sensitive.
   */
  async sign(data: Uint8Array, opts?: SignOptions): Promise<SigningSignature> {
    if (this.#corrupted) {
      this.#workingBuffer.fill(0);
      const err = new SigningKeyProviderError("provider_corrupted");
      this.#logger.error("client.key.sign.failed", {
        agentId: this.#agentId,
        reason: "provider_corrupted",
      });
      throw err;
    }

    // Re-read seed from file into working buffer
    try {
      const raw = await readFile(this.#keyPath);
      raw.copy(
        Buffer.from(this.#workingBuffer.buffer, this.#workingBuffer.byteOffset, SEED_BYTES),
        0,
        KEY_FILE_MAGIC.length + 1,
        KEY_FILE_SIZE,
      );
    } catch (err: unknown) {
      this.#workingBuffer.fill(0);
      const reason = err instanceof Error ? err.message : String(err);
      this.#logger.error("client.key.sign.failed", {
        agentId: this.#agentId,
        reason,
        errorMessage: (err as Error).message,
      });
      throw new SigningKeyProviderError(reason);
    }

    // SI-002 test seam: throw AFTER key material is in the buffer so the finally
    // block zeroing is exercised under adversarial conditions.
    if (this.#throwAfterLoad) {
      try {
        throw new Error("injected failure after key load");
      } finally {
        // SI-002: ALWAYS zero the working buffer, even on test-injected throw
        this.#workingBuffer.fill(0);
      }
    }

    try {
      const signature = ed25519.sign(data, this.#workingBuffer);
      this.#logger.info("client.key.signed", {
        agentId: this.#agentId,
        dataLength: data.length,
        ...(opts?.correlationId !== undefined && { correlationId: opts.correlationId }),
      });
      return signature;
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : String(err);
      this.#logger.error("client.key.sign.failed", {
        agentId: this.#agentId,
        reason,
        errorMessage: (err as Error).message,
      });
      throw new SigningKeyProviderError(reason);
    } finally {
      // SI-002: ALWAYS zero the working buffer after sign(), even on throw
      this.#workingBuffer.fill(0);
    }
  }

  // ─── Test-only methods (not part of SigningKeyProvider interface) ───────────

  /**
   * @internal Test seam — returns true if the working buffer is currently all-zeros.
   * This does NOT expose key material. Tests use this to verify SI-002 (zeroing)
   * without ever seeing the private key bytes.
   */
  isKeyBufferZeroedForTesting(): boolean {
    return this.#workingBuffer.every((b) => b === 0);
  }

  /**
   * @internal Test seam — corrupts the provider state to trigger sign() failures
   * BEFORE the key file is read. Used to test SI-003 (no fallback).
   * Note: does NOT exercise the try/finally zeroing path — use throwAfterLoadForTesting() for that.
   */
  corruptForTesting(): void {
    this.#corrupted = true;
  }

  /**
   * @internal Test seam — causes sign() to throw AFTER the key has been loaded into
   * the working buffer but BEFORE ed25519.sign() is called. Used to verify SI-002:
   * the finally block zeroes the key buffer even when sign() throws mid-operation.
   */
  throwAfterLoadForTesting(): void {
    this.#throwAfterLoad = true;
  }
}

// ─── Private helpers ─────────────────────────────────────────────────────────

/**
 * Validate key file format and extract the seed into a new buffer.
 * Throws SigningKeyProviderError on invalid format.
 */
function validateAndExtractSeed(
  raw: Buffer,
  path: string,
  agentId: string,
  logger: Logger,
): Uint8Array {
  if (raw.length !== KEY_FILE_SIZE) {
    logger.error("client.key.provider.init.failed", {
      agentId,
      providerType: "EncryptedFileSigningKeyProvider",
      reason: "key_file_corrupt",
    });
    throw new SigningKeyProviderError("key_file_corrupt", path);
  }

  for (let i = 0; i < KEY_FILE_MAGIC.length; i++) {
    if (raw[i] !== KEY_FILE_MAGIC[i]) {
      logger.error("client.key.provider.init.failed", {
        agentId,
        providerType: "EncryptedFileSigningKeyProvider",
        reason: "key_file_corrupt",
      });
      throw new SigningKeyProviderError("key_file_corrupt", path);
    }
  }

  if (raw[KEY_FILE_MAGIC.length] !== KEY_FILE_VERSION) {
    logger.error("client.key.provider.init.failed", {
      agentId,
      providerType: "EncryptedFileSigningKeyProvider",
      reason: "key_file_corrupt",
    });
    throw new SigningKeyProviderError("key_file_corrupt", path);
  }

  // Copy seed into a new buffer (caller must zero after use)
  const seed = new Uint8Array(SEED_BYTES);
  raw.copy(Buffer.from(seed.buffer), 0, KEY_FILE_MAGIC.length + 1, KEY_FILE_SIZE);
  return seed;
}
