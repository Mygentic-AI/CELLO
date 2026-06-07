/**
 * PgTokenValidator — production TokenValidator backed by pre_authorization_tokens table.
 *
 * OPS-AGENT-001: Validates pre-authorization tokens via Postgres using atomic consumption.
 * Implements TokenValidator for CELLO_ENV=dev/staging/production.
 *
 * For CELLO_ENV=local, use DevTokenValidator from @cello-protocol/interfaces/stubs.
 *
 * Atomic consumption: consumePreAuthToken atomically sets consumed_at via
 *   UPDATE … WHERE consumed_at IS NULL RETURNING id
 * rowCount=0 → already consumed (SI-002: race-safe).
 *
 * Observability: logging is delegated to the caller (CelloDirectoryNode#handleFrostStream)
 * which holds the per-flow correlationId. PgTokenValidator does not log — it is a pure
 * mechanics adapter.
 */

import type pg from "pg";
import type { TokenValidator, TokenValidationResult } from "@cello-protocol/interfaces";
import { consumePreAuthToken } from "../pre-auth-token-repository.js";

/** Look up a token's DB UUID (for logging on failure paths). Returns null if not found. */
async function lookupTokenId(pool: pg.Pool, token: string): Promise<string | null> {
  try {
    const result = await pool.query<{ id: string }>(
      "SELECT id FROM pre_authorization_tokens WHERE token = $1",
      [token],
    );
    return result.rows[0]?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * PgTokenValidator — implements TokenValidator for production environments.
 * Atomically consumes pre-authorization tokens from Postgres.
 * Use in CELLO_ENV=dev/staging/production only.
 *
 * Logging is intentionally omitted here — the caller (directory-node.ts)
 * holds the per-flow correlationId and emits all observability events.
 */
export class PgTokenValidator implements TokenValidator {
  readonly #pool: pg.Pool;

  constructor(pool: pg.Pool) {
    this.#pool = pool;
  }

  /**
   * Atomically consume a pre-authorization token.
   * Returns { valid: true, phoneStubHash, emailStubHash, tokenId } on success.
   * Returns { valid: false, reason } on any failure.
   * Never throws — all errors are encoded in the return type.
   */
  async validateToken(token: string): Promise<TokenValidationResult> {
    const result = await consumePreAuthToken(this.#pool, token);

    if (result.ok) {
      return {
        valid: true,
        phoneStubHash: result.phoneStubHash,
        emailStubHash: result.emailStubHash,
        tokenId: result.tokenId,
      };
    }

    // Map error codes to TokenValidationResult failure.
    // Caller is responsible for logging the appropriate event.
    // Look up the DB UUID so the caller can include it in log events (HIGH-2).
    // NOT_FOUND → tokenId will be null (no row to look up).
    const tokenId = result.reason !== "PRE_AUTH_TOKEN_NOT_FOUND"
      ? await lookupTokenId(this.#pool, token)
      : null;
    return {
      valid: false,
      reason: result.reason,
      tokenId,
    };
  }
}
