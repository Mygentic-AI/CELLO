/**
 * SigningKeyProvider — pluggable Ed25519 signing interface (PERSIST-010).
 *
 * IMPORTANT: This is the client-side Ed25519 signing abstraction. It is NOT:
 *   - KeyProvider (the @cello-protocol/crypto interface — same shape but lives in a different package)
 *   - EnvelopeKeyProvider (the KMS interface for wrapping K_server_X shares at rest)
 *
 * The private key NEVER crosses the provider boundary. The provider performs signing
 * internally and returns only the signature. This enables hardware-backed implementations
 * (OS Keychain, TPM, Secure Enclave) where the key never enters the Node.js heap.
 *
 * Backends:
 *   - EncryptedFileSigningKeyProvider (CELLO_ENV=local/dev) — reads encrypted key file
 *   - KeychainSigningKeyProvider (macOS/Windows desktop) — delegates to OS Keychain
 *   - Future: HSM-backed providers for production deployments
 *
 * RFC reference: Ed25519 signing per RFC 8032.
 */

/** 32-byte Ed25519 public key. */
export type SigningPublicKey = Uint8Array;

/** 64-byte Ed25519 signature. */
export type SigningSignature = Uint8Array;

/**
 * Error thrown by SigningKeyProvider when a sign() or init operation fails.
 * The client MUST propagate this error — never fall back to a weaker mechanism (SI-003).
 */
export class SigningKeyProviderError extends Error {
  readonly reason: string;
  readonly path?: string;

  constructor(reason: string, path?: string) {
    super(`SigningKeyProvider: ${reason}`);
    this.name = "SigningKeyProviderError";
    this.reason = reason;
    this.path = path;
  }
}

/** Options bag for sign() — allows threading correlationId from the caller. */
export interface SignOptions {
  /** Correlation ID threaded from the caller for log event tracing. */
  correlationId?: string;
}

/**
 * Pluggable Ed25519 signing interface.
 *
 * Contract:
 *   - getPublicKey() returns the 32-byte Ed25519 public key
 *   - sign(data) returns a 64-byte Ed25519 signature over data
 *   - NO method returns, exports, or exposes the private key in any form (SI-001)
 */
export interface SigningKeyProvider {
  /** Return the 32-byte Ed25519 public key. */
  getPublicKey(): Promise<SigningPublicKey>;

  /** Sign data and return a 64-byte Ed25519 signature. Never exposes the private key. */
  sign(data: Uint8Array, opts?: SignOptions): Promise<SigningSignature>;
}
