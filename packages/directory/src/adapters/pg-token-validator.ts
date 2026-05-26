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
   * Returns { valid: true, phoneStubHash, emailDomain, tokenId } on success.
   * Returns { valid: false, reason } on any failure.
   * Never throws — all errors are encoded in the return type.
   */
  async validateToken(token: string): Promise<TokenValidationResult> {
    const result = await consumePreAuthToken(this.#pool, token);

    if (result.ok) {
      return {
        valid: true,
        phoneStubHash: result.phoneStubHash,
        emailDomain: result.emailDomain,
        tokenId: result.tokenId,
      };
    }

    // Map error codes to TokenValidationResult failure.
    // Caller is responsible for logging the appropriate event.
    return {
      valid: false,
      reason: result.reason,
    };
  }
}
