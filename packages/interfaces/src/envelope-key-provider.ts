/**
 * EnvelopeKeyProvider — interface for encrypting K_server_X shares at rest (PERSIST-001 / PERSIST-005).
 *
 * IMPORTANT: This is NOT SigningKeyProvider (the client-side Ed25519 interface defined in M0).
 * EnvelopeKeyProvider is the KMS abstraction for wrapping FROST key shares in the directory's
 * persistent store. The two interfaces must never be confused or merged.
 *
 * Production implementation: KmsEnvelopeKeyProvider (AWS KMS, CELLO_ENV=dev+).
 * Local stub: LocalEnvelopeKeyProvider (AES-256-GCM with DEV_ENVELOPE_KEY, CELLO_ENV=local).
 */
export interface EnvelopeKeyProvider {
  /**
   * Encrypt plaintext bytes under the given keyId.
   * Returns an opaque ciphertext blob (includes IV/nonce; format is implementation-defined).
   */
  encrypt(plaintext: Uint8Array, keyId: string): Promise<Uint8Array>;

  /**
   * Decrypt ciphertext previously produced by encrypt() with the same keyId.
   */
  decrypt(ciphertext: Uint8Array, keyId: string): Promise<Uint8Array>;

  /**
   * Re-encrypt all data currently protected by keyId under a new key version.
   * Used for key rotation; no-op on stubs.
   */
  rotate(keyId: string): Promise<void>;
}
