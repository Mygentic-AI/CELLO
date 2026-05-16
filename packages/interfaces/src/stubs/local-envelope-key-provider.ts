import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { EnvelopeKeyProvider } from "../envelope-key-provider.js";

const IV_BYTES = 12;  // 96-bit IV for AES-256-GCM
const TAG_BYTES = 16;
const KEY_HEX_LENGTH = 64; // 32 bytes = 64 hex chars

/**
 * AES-256-GCM envelope key provider for CELLO_ENV=local.
 * Key is read from DEV_ENVELOPE_KEY (64-char hex). Never uses a hardcoded fallback.
 * keyId is recorded in AAD so ciphertexts are bound to their key slot.
 */
export class LocalEnvelopeKeyProvider implements EnvelopeKeyProvider {
  readonly #key: Buffer;

  constructor(devEnvelopeKeyHex: string) {
    if (!devEnvelopeKeyHex || devEnvelopeKeyHex.length !== KEY_HEX_LENGTH) {
      throw new Error(
        `DEV_ENVELOPE_KEY must be a 64-character hex string (32 bytes). ` +
        `Got ${devEnvelopeKeyHex ? devEnvelopeKeyHex.length : 0} chars. ` +
        `Set DEV_ENVELOPE_KEY in your .env.local file.`,
      );
    }
    this.#key = Buffer.from(devEnvelopeKeyHex, "hex");
  }

  async encrypt(plaintext: Uint8Array, keyId: string): Promise<Uint8Array> {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv("aes-256-gcm", this.#key, iv);
    cipher.setAAD(Buffer.from(keyId, "utf8"));
    const ciphered = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    // Layout: [iv (12)] [tag (16)] [ciphertext]
    return Buffer.concat([iv, tag, ciphered]);
  }

  async decrypt(ciphertext: Uint8Array, keyId: string): Promise<Uint8Array> {
    const buf = Buffer.from(ciphertext);
    const iv = buf.subarray(0, IV_BYTES);
    const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
    const body = buf.subarray(IV_BYTES + TAG_BYTES);
    const decipher = createDecipheriv("aes-256-gcm", this.#key, iv);
    decipher.setAAD(Buffer.from(keyId, "utf8"));
    decipher.setAuthTag(tag);
    return new Uint8Array(Buffer.concat([decipher.update(body), decipher.final()]));
  }

  async rotate(_keyId: string): Promise<void> {
    // No-op for local stub — key rotation is a KMS concern in production
  }
}
