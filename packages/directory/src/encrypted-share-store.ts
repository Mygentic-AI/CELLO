/**
 * CELLO-PERSIST-005 — EncryptedPgShareStore
 *
 * Stores and retrieves K_server_X FROST key shares from PostgreSQL using
 * envelope encryption via EnvelopeKeyProvider.
 *
 * Pseudocode (Phase P):
 *
 *   storeShare(agentId, epochId, shareBytes, correlationId?):
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
 *   getShareBytes(agentId, epochId, correlationId?):
 *     // 1. SELECT encrypted_share from agent_key_shares
 *     keyId = deriveKeyId(agentId, epochId)
 *     row = await pool.query(SELECT encrypted_share FROM agent_key_shares WHERE ...)
 *     if no row: return null
 *
 *     // 2. Decrypt
 *     plaintext = await envelopeKeyProvider.decrypt(row.encrypted_share, keyId)
 *     log key.decrypted at INFO with { keyId, agentId, correlationId? }
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
import type { EnvelopeKeyProvider, Logger } from "@cello-protocol/interfaces";

/**
 * Minimum bytes a real AEAD ciphertext adds over its plaintext (12-byte nonce + 16-byte tag for
 * AES-256-GCM). A LOWER BOUND, not an equality.
 *
 * It used to be an equality check (`length === plaintext + 28`), which silently assumed every
 * provider returns raw AES-GCM. GCP Cloud KMS does not: `encrypt()` returns KMS's own wrapped blob
 * carrying key metadata, so its length is not a fixed function of plaintext length (observed
 * ~1209 bytes where the equality demanded 1154). EVERY share write on GCP therefore failed
 * `SI-003` — and because the write is fire-and-forget, registration still reported success while
 * `agent_key_shares` stayed empty. Shares lived only in memory, so every directory restart
 * stranded every agent with `AGENT_NOT_BOOTSTRAPPED`.
 *
 * The equality bought nothing the bounds below do not: what SI-003 exists to catch is a provider
 * that returns plaintext, empty, or truncated bytes. That is now checked directly — including
 * ciphertext === plaintext, which an exact-length rule could never have caught for a provider
 * whose "encryption" is a no-op of the same length.
 */
const MIN_AEAD_OVERHEAD_BYTES = 28; // 12 (nonce) + 16 (auth tag)

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
   *
   * @param correlationId - optional correlationId for threading async flow context (AC-005)
   */
  async storeShare(
    agentId: string,
    epochId: string,
    shareBytes: Uint8Array,
    correlationId?: string,
  ): Promise<void> {
    const keyId = this.#keyId(agentId, epochId);
    const plaintextLen = shareBytes.length;

    // Step 1: Encrypt
    let ciphertext: Uint8Array;
    try {
      ciphertext = await this.#provider.encrypt(shareBytes, keyId);
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      // SI-001: log keyId and agentId only — never the plaintext share bytes
      this.#logger.error("key.encrypted.failed", error, { keyId, agentId });
      throw err;
    }

    // Step 2: Structural validity check (SI-003) — provider-agnostic.
    // Catches the failures that actually matter: empty output, output that cannot carry an
    // authentication tag, and output that IS the plaintext. Deliberately does NOT assume a
    // provider-specific ciphertext length — see MIN_AEAD_OVERHEAD_BYTES.
    const minLen = plaintextLen + MIN_AEAD_OVERHEAD_BYTES;
    // Plaintext-passthrough is checked BEFORE the length bound. A passthrough always trips the
    // length bound too, but "too short" would send an operator hunting a truncation bug when the
    // real fault is that nothing was encrypted at all.
    const reason =
      ciphertext.length === 0
        ? "provider returned empty ciphertext"
        : Buffer.from(ciphertext).equals(Buffer.from(shareBytes))
          ? "provider returned the PLAINTEXT unchanged — refusing to persist unencrypted share material"
          : ciphertext.length < minLen
            ? `too short to be authenticated: got ${ciphertext.length}, need at least ${minLen} (${plaintextLen} + ${MIN_AEAD_OVERHEAD_BYTES})`
            : null;
    if (reason !== null) {
      const structuralError = new Error(`ciphertext structural check failed: ${reason}`);
      this.#logger.error("key.encrypted.failed", structuralError, { keyId, agentId });
      throw structuralError;
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
    const context: Record<string, unknown> = { keyId, agentId };
    if (correlationId !== undefined) {
      context.correlationId = correlationId;
    }
    this.#logger.info("key.encrypted", context);
  }

  /**
   * CELLO-M8-LEVER-002 (burn): destroy the persisted K_server_X material for ALL of an agent's
   * epochs. agent_key_shares is APPEND-ONLY (row deletion forbidden), so we ZERO encrypted_share
   * (the GRANT covers UPDATE of encrypted_share/key_version/updated_at) — capability dies, the row /
   * accountability survives. key_version is stamped 'burned'. Idempotent (a re-burn re-zeroes).
   */
  async destroyShares(agentId: string): Promise<void> {
    const res = await this.#pool.query(
      `UPDATE agent_key_shares
          SET encrypted_share = '\\x'::bytea, key_version = 'burned', updated_at = now()
        WHERE agent_id = $1`,
      [agentId],
    );
    const epochsZeroed = res.rowCount ?? 0;
    if (epochsZeroed === 0) {
      // No agent_key_shares row matched. Under consistent keying (agent_id == k_local pubkey) this node
      // simply never held a share for this agent — a T-of-N non-participant — which is benign, so we do
      // NOT throw (that would break a legitimate non-participant node). But it is ALSO the exact shape a
      // keying/migration drift would take (a share held under a different key, silently left un-zeroed).
      // Surface it as a DISTINCT event so a real miss is alarmable and can never masquerade as a
      // completed burn — the success-shaped key.burned is reserved for an ACTUAL zeroing. LEVER-002's
      // promise is PROVABLE at-rest destruction, so a no-op must be distinguishable from a real erase.
      this.#logger.warn("key.burn.no_share", { agentId });
      return;
    }
    this.#logger.warn("key.burned", { agentId, epochsZeroed });
  }

  /**
   * Retrieve and decrypt a K_server_X share for the given agent/epoch.
   * Returns null if no share exists for that (agentId, epochId) pair.
   *
   * Throws if decryption fails (key.decrypted.failed logged).
   * Logs key.decrypted at INFO on success.
   *
   * Never logs the decrypted plaintext (SI-001).
   *
   * @param correlationId - optional correlationId for threading async flow context
   */
  async getAllShareBytes(): Promise<Array<{ agentId: string; epochId: string; plaintext: Uint8Array }>> {
    const result = await this.#pool.query<{ agent_id: string; epoch_id: string; encrypted_share: Buffer }>(
      `SELECT agent_id, epoch_id, encrypted_share FROM agent_key_shares`,
    );

    const shares: Array<{ agentId: string; epochId: string; plaintext: Uint8Array }> = [];
    for (const row of result.rows) {
      const keyId = this.#keyId(row.agent_id, row.epoch_id);
      const ciphertext = new Uint8Array(row.encrypted_share);
      try {
        const plaintext = await this.#provider.decrypt(ciphertext, keyId);
        shares.push({ agentId: row.agent_id, epochId: row.epoch_id, plaintext });
      } catch (err: unknown) {
        const error = err instanceof Error ? err : new Error(String(err));
        this.#logger.error("key.decrypted.failed", error, { keyId, agentId: row.agent_id });
        // Skip undecryptable shares (stale envelope key, rotated key version) rather than
        // crashing the entire directory. The caller (loadShares) already handles partial loads.
      }
    }
    return shares;
  }

  async getShareBytes(
    agentId: string,
    epochId: string,
    correlationId?: string,
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
      const error = err instanceof Error ? err : new Error(String(err));
      this.#logger.error("key.decrypted.failed", error, { keyId, agentId });
      throw err;
    }

    // SI-001: log keyId and agentId only — never the decrypted plaintext
    const context: Record<string, unknown> = { keyId, agentId };
    if (correlationId !== undefined) {
      context.correlationId = correlationId;
    }
    this.#logger.info("key.decrypted", context);
    return plaintext;
  }
}
