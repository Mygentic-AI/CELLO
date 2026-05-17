/**
 * CELLO-PERSIST-005 — EncryptedPgShareStore
 *
 * Stores and retrieves K_server_X FROST key shares from PostgreSQL using
 * envelope encryption via EnvelopeKeyProvider.
 *
 * Pseudocode (Phase P):
 *
 *   storeShare(agentId, epochId, shareBytes):
 *     // 1. Encrypt — NIST SP 800-38D (AES-256-GCM)
 *     keyId = deriveKeyId(agentId, epochId)
 *     ciphertext = await envelopeKeyProvider.encrypt(shareBytes, keyId)
 *
 *     // 2. Structural validity check (SI-003)
 *     //    Expected length: plaintext_length + 28 (12 nonce + 16 auth tag)
 *     //    Guard catches a broken provider before any INSERT
 *     expectedLen = shareBytes.length + OVERHEAD_BYTES
 *     if ciphertext.length !== expectedLen or ciphertext.length === 0:
 *       log key.encrypted.failed with { keyId, agentId, reason: "structural check failed" }
 *       throw Error("ciphertext structural check failed")
 *
 *     // 3. INSERT into agent_key_shares
 *     await pool.query(INSERT INTO agent_key_shares ...)
 *
 *     // 4. Log key.encrypted at INFO (AC-005)
 *     log key.encrypted with { keyId, agentId, correlationId? }
 *
 *   getShareBytes(agentId, epochId):
 *     // 1. SELECT encrypted_share from agent_key_shares
 *     keyId = deriveKeyId(agentId, epochId)
 *     row = await pool.query(SELECT encrypted_share FROM agent_key_shares WHERE ...)
 *     if no row: return null
 *
 *     // 2. Decrypt
 *     plaintext = await envelopeKeyProvider.decrypt(row.encrypted_share, keyId)
 *     log key.decrypted at INFO with { keyId, agentId }
 *     return plaintext
 *
 * Security invariants:
 *   SI-001: shareBytes (plaintext) never appears in any log event
 *   SI-002: the EnvelopeKeyProvider holds the master key; this store never touches key material
 *   SI-003: structural check before INSERT — broken provider caught immediately
 *
 * keyId derivation: "${agentId}:${epochId}" — stable, unique per (agent, epoch) pair.
 * This is the AAD bound in the AES-256-GCM ciphertext, so a ciphertext for one agent
 * cannot be used for another agent even if the underlying key bytes are the same.
 */

import pg from "pg";
import type { EnvelopeKeyProvider, Logger } from "@cello/interfaces";

/**
 * AES-256-GCM overhead: 12-byte nonce + 16-byte authentication tag.
 * Ciphertext length = plaintext length + OVERHEAD_BYTES.
 * This is the structural invariant checked by SI-003.
 */
const OVERHEAD_BYTES = 28; // 12 (nonce) + 16 (auth tag)

/**
 * EncryptedPgShareStore — writes and reads encrypted K_server_X shares
 * from the agent_key_shares table via envelope encryption.
 *
 * Used only by the composition root and tests. Not exported from the package index.
 */
export class EncryptedPgShareStore {
  readonly #pool: pg.Pool;
  readonly #provider: EnvelopeKeyProvider;
  readonly #logger: Logger;

  constructor(pool: pg.Pool, provider: EnvelopeKeyProvider, logger: Logger) {
    this.#pool = pool;
    this.#provider = provider;
    this.#logger = logger;
  }

  /**
   * Derive a stable keyId for a given (agentId, epochId) pair.
   * Used as AAD in AES-256-GCM — binding ciphertexts to their intended slot.
   */
  #keyId(agentId: string, epochId: string): string {
    return `${agentId}:${epochId}`;
  }

  /**
   * Encrypt and store a K_server_X share for the given agent/epoch.
   *
   * Throws if:
   *   - encryption fails (key.encrypted.failed logged)
   *   - ciphertext fails structural check (SI-003)
   *   - the database INSERT fails
   *
   * Never logs the plaintext shareBytes (SI-001).
   */
  async storeShare(
    agentId: string,
    epochId: string,
    shareBytes: Uint8Array,
  ): Promise<void> {
    const keyId = this.#keyId(agentId, epochId);
    const plaintextLen = shareBytes.length;

    // Step 1: Encrypt
    let ciphertext: Uint8Array;
    try {
      ciphertext = await this.#provider.encrypt(shareBytes, keyId);
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : String(err);
      // SI-001: log keyId and agentId only — never the plaintext share bytes
      this.#logger.error("key.encrypted.failed", { keyId, agentId, reason });
      throw err;
    }

    // Step 2: Structural validity check (SI-003)
    // AES-256-GCM output MUST be exactly plaintext_length + 28 bytes and non-empty.
    const expectedLen = plaintextLen + OVERHEAD_BYTES;
    if (ciphertext.length === 0 || ciphertext.length !== expectedLen) {
      const reason = `expected ${expectedLen} bytes (${plaintextLen} + ${OVERHEAD_BYTES} overhead), got ${ciphertext.length}`;
      this.#logger.error("key.encrypted.failed", { keyId, agentId, reason });
      throw new Error(`ciphertext structural check failed: ${reason}`);
    }

    // Step 3: INSERT into agent_key_shares
    await this.#pool.query(
      `INSERT INTO agent_key_shares (agent_id, epoch_id, encrypted_share, key_version)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (agent_id, epoch_id) DO UPDATE
         SET encrypted_share = EXCLUDED.encrypted_share,
             key_version = EXCLUDED.key_version,
             updated_at = now()`,
      [agentId, epochId, Buffer.from(ciphertext), "v1"],
    );

    // Step 4: Log key.encrypted at INFO (AC-005)
    // SI-001: context contains only keyId and agentId — no share material
    this.#logger.info("key.encrypted", { keyId, agentId });
  }

  /**
   * Retrieve and decrypt a K_server_X share for the given agent/epoch.
   * Returns null if no share exists for that (agentId, epochId) pair.
   *
   * Throws if decryption fails (key.decrypted.failed logged).
   * Logs key.decrypted at INFO on success.
   *
   * Never logs the decrypted plaintext (SI-001).
   */
  async getShareBytes(
    agentId: string,
    epochId: string,
  ): Promise<Uint8Array | null> {
    const keyId = this.#keyId(agentId, epochId);

    const result = await this.#pool.query<{ encrypted_share: Buffer }>(
      `SELECT encrypted_share FROM agent_key_shares WHERE agent_id = $1 AND epoch_id = $2`,
      [agentId, epochId],
    );

    if (result.rows.length === 0) {
      return null;
    }

    const ciphertext = new Uint8Array(result.rows[0]!.encrypted_share);

    let plaintext: Uint8Array;
    try {
      plaintext = await this.#provider.decrypt(ciphertext, keyId);
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : String(err);
      this.#logger.error("key.decrypted.failed", { keyId, agentId, reason });
      throw err;
    }

    // SI-001: log keyId and agentId only — never the decrypted plaintext
    this.#logger.info("key.decrypted", { keyId, agentId });
    return plaintext;
  }
}
