/**
 * LocalEnvelopeKeyProvider — AES-256-GCM envelope key provider for CELLO_ENV=local.
 *
 * Pseudocode (Phase P):
 *
 *   encrypt(plaintext, keyId):
 *     // NIST SP 800-38D §8.2.1 — AES-256-GCM, 96-bit random nonce per operation
 *     iv = random(12 bytes)
 *     cipher = AES-256-GCM(#currentKey, iv, aad=utf8(keyId))
 *     ciphered = cipher.update(plaintext) || cipher.final()
 *     tag = cipher.authTag()
 *     return [iv (12)] || [tag (16)] || [ciphered]
 *
 *   decrypt(ciphertext, keyId):
 *     // Try #currentKey first; if auth tag fails, try #previousKey (rotation window)
 *     iv = ciphertext[0:12]
 *     tag = ciphertext[12:28]
 *     body = ciphertext[28:]
 *     for key in [#currentKey, #previousKey].filter(exists):
 *       try:
 *         decipher = AES-256-GCM(key, iv, aad=utf8(keyId))
 *         decipher.setAuthTag(tag)
 *         return decipher.update(body) || decipher.final()
 *       catch:
 *         continue
 *     throw DecryptionError
 *
 *   rotate(keyId):
 *     // Move #currentKey → #previousKey; generate new random #currentKey
 *     // Log key.rotation.initiated with { keyId }
 *     // No re-encryption of existing shares — dual-key coexistence model
 *     #previousKey = #currentKey
 *     #currentKey = random(32 bytes)
 *     logger?.info("key.rotation.initiated", { keyId })
 *
 * Security properties:
 *   - SI-004: random nonce (IV) per encrypt call — never reused (NIST SP 800-38D §8.2.1)
 *   - SI-003: output length = plaintext + 28 (IV_BYTES + TAG_BYTES)
 *   - keyId bound as AAD — ciphertext for keyId "A" cannot be decrypted with keyId "B"
 *   - dual-key coexistence: #previousKey retained during rotation window for backward decrypt
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { EnvelopeKeyProvider } from "../envelope-key-provider.js";
import type { Logger } from "../logger.js";

/** AES-256-GCM nonce length (96 bits — NIST SP 800-38D recommended) */
const IV_BYTES = 12;
/** AES-256-GCM authentication tag length (128 bits — maximum) */
const TAG_BYTES = 16;
/** DEV_ENVELOPE_KEY length: 32 bytes = 64 hex chars */
const KEY_HEX_LENGTH = 64;

/**
 * AES-256-GCM envelope key provider for CELLO_ENV=local.
 * Key is supplied at construction time (read from DEV_ENVELOPE_KEY by the composition root).
 * Never uses a hardcoded fallback key.
 *
 * Accepts an optional Logger for key.rotation.initiated events (AC-007).
 * Logger is injected at construction time — not at call time — so the same
 * logger that lives in the composition root is threaded through the provider.
 */
export class LocalEnvelopeKeyProvider implements EnvelopeKeyProvider {
  /** Active encryption key — used for all new encrypt() calls */
  #currentKey: Buffer;
  /** Previous key retained during rotation window — used as decrypt fallback (AC-007) */
  #previousKey: Buffer | undefined;
  readonly #logger: Logger | undefined;

  constructor(devEnvelopeKeyHex: string, logger?: Logger) {
    if (!devEnvelopeKeyHex || devEnvelopeKeyHex.length !== KEY_HEX_LENGTH) {
      throw new Error(
        `DEV_ENVELOPE_KEY must be a 64-character hex string (32 bytes). ` +
        `Got ${devEnvelopeKeyHex ? devEnvelopeKeyHex.length : 0} chars. ` +
        `Set DEV_ENVELOPE_KEY in your .env.local file.`,
      );
    }
    this.#currentKey = Buffer.from(devEnvelopeKeyHex, "hex");
    this.#logger = logger;
  }

  /**
   * Encrypt plaintext bytes under AES-256-GCM.
   * Output layout: [iv (12)] [tag (16)] [ciphertext]
   * Total overhead: 28 bytes (SI-003).
   * Nonce is random per call (SI-004).
   * keyId is bound as AAD — wrong keyId causes auth tag failure on decrypt (AC-004).
   */
  async encrypt(plaintext: Uint8Array, keyId: string): Promise<Uint8Array> {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv("aes-256-gcm", this.#currentKey, iv);
    cipher.setAAD(Buffer.from(keyId, "utf8"));
    const ciphered = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, ciphered]);
  }

  /**
   * Decrypt ciphertext produced by encrypt().
   * Tries #currentKey first; on auth tag failure, tries #previousKey (dual-key window).
   * Throws if neither key succeeds — no partial plaintext is returned (AC-004).
   */
  async decrypt(ciphertext: Uint8Array, keyId: string): Promise<Uint8Array> {
    const buf = Buffer.from(ciphertext);
    const iv = buf.subarray(0, IV_BYTES);
    const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
    const body = buf.subarray(IV_BYTES + TAG_BYTES);
    const aad = Buffer.from(keyId, "utf8");

    // Try current key first, then previous key (rotation window — AC-007)
    const keys: Buffer[] = [this.#currentKey];
    if (this.#previousKey !== undefined) {
      keys.push(this.#previousKey);
    }

    for (const key of keys) {
      try {
        const decipher = createDecipheriv("aes-256-gcm", key, iv);
        decipher.setAAD(aad);
        decipher.setAuthTag(tag);
        return new Uint8Array(Buffer.concat([decipher.update(body), decipher.final()]));
      } catch {
        // Auth tag mismatch — try next key
      }
    }

    throw new Error("Decryption failed: authentication tag mismatch for all available key versions");
  }

  /**
   * Rotate to a new randomly-generated key.
   * The previous key is retained in memory for decrypting shares written under it (AC-007).
   * Logs key.rotation.initiated with { keyId } if a Logger was provided.
   *
   * This implements the dual-key coexistence model: no immediate re-encryption of
   * existing shares. Shares written under the old key continue to decrypt correctly
   * during the rotation window.
   */
  async rotate(keyId: string): Promise<void> {
    this.#previousKey = this.#currentKey;
    this.#currentKey = randomBytes(32);
    this.#logger?.info("key.rotation.initiated", { keyId });
  }
}
