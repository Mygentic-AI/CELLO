/**
 * KmsEnvelopeKeyProvider (Cloud KMS) — GCP EnvelopeKeyProvider (M12 DOD-ADAPTER-GCP-1, set by
 * M12-D6). This is the provider that wraps K_server_X FROST shares at rest before any DB INSERT.
 *
 * IMPORTANT: `EnvelopeKeyProvider` is NOT `SigningKeyProvider` — this never signs anything. It
 * encrypts share material under a Cloud KMS key that never leaves Google's HSM boundary.
 *
 * **Fail closed, always.** A decrypt failure THROWS; it never returns empty or partial bytes. A
 * fail-open envelope provider is the worst shape available here: the share store would persist or
 * hand out material that looks like a real K_server share, and the failure would surface much later
 * as an unrelated-looking ceremony error with no path back to the cause.
 *
 * `rotate()` is intentionally a no-op. Cloud KMS rotates key VERSIONS server-side and `decrypt`
 * resolves the version from the ciphertext itself, so — unlike the AWS re-encrypt flow the
 * interface was shaped around — there is nothing for the adapter to do. It must still not throw,
 * or a scheduled rotation would look broken.
 *
 * Auth is Application Default Credentials (the VM's attached service account; org policy forbids
 * SA keys), so no key material is handled in-process.
 */

import type { EnvelopeKeyProvider } from "@cello-protocol/interfaces";

/** Identifies the Cloud KMS crypto key that wraps share material. */
export interface GcpKmsConfig {
  readonly projectId: string;
  readonly locationId: string;
  readonly keyRingId: string;
  readonly cryptoKeyId: string;
}

/** The slice of `@google-cloud/kms` this adapter uses (injectable for tests). */
export interface KmsLike {
  encrypt(req: { name: string; plaintext: Buffer }): Promise<[{ ciphertext?: Buffer | Uint8Array | string | null }]>;
  decrypt(req: { name: string; ciphertext: Buffer }): Promise<[{ plaintext?: Buffer | Uint8Array | string | null }]>;
  cryptoKeyPath(project: string, location: string, keyRing: string, cryptoKey: string): string;
}

export class KmsEnvelopeKeyProvider implements EnvelopeKeyProvider {
  readonly #keyName: string;
  readonly #client: KmsLike;

  /** `client` is injected in tests; production passes a real `new KeyManagementServiceClient()`. */
  constructor(cfg: GcpKmsConfig, client: KmsLike) {
    this.#client = client;
    this.#keyName = client.cryptoKeyPath(cfg.projectId, cfg.locationId, cfg.keyRingId, cfg.cryptoKeyId);
  }

  /** `keyId` is the CALLER's logical label (e.g. "k-server-share"); the KMS key is fixed by config. */
  async encrypt(plaintext: Uint8Array, keyId: string): Promise<Uint8Array> {
    const [res] = await this.#client.encrypt({ name: this.#keyName, plaintext: Buffer.from(plaintext) });
    const ct = res?.ciphertext;
    if (ct === null || ct === undefined) {
      throw new Error(`gcp-kms: encrypt returned no ciphertext for '${keyId}' — refusing to persist unwrapped share material`);
    }
    return new Uint8Array(typeof ct === "string" ? Buffer.from(ct, "base64") : ct);
  }

  async decrypt(ciphertext: Uint8Array, keyId: string): Promise<Uint8Array> {
    // Any KMS error propagates unwrapped — the caller must never receive substitute bytes.
    const [res] = await this.#client.decrypt({ name: this.#keyName, ciphertext: Buffer.from(ciphertext) });
    const pt = res?.plaintext;
    if (pt === null || pt === undefined) {
      throw new Error(`gcp-kms: decrypt returned no plaintext for '${keyId}' — failing closed rather than yielding empty share material`);
    }
    return new Uint8Array(typeof pt === "string" ? Buffer.from(pt, "base64") : pt);
  }

  async rotate(_keyId: string): Promise<void> {
    // No-op by design — see the file header (Cloud KMS rotates versions server-side).
  }
}
