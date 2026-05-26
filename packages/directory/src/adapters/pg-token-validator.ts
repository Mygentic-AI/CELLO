/**
 * PgTokenValidator — production TokenValidator backed by pre_authorization_tokens table.
 *
 * OPS-AGENT-001: Validates pre-authorization tokens via Postgres using atomic consumption.
 * Implements TokenValidator for CELLO_ENV=dev/staging/production.
 *
 * For CELLO_ENV=local, use DevTokenValidator from @cello-protocol/interfaces/stubs.
 *
 * Atomic consumption: UPDATE … SET consumed_at = now() WHERE consumed_at IS NULL RETURNING id
 * A rowCount of 0 means the token was already consumed (SI-002: race-safe).
 *
 * Error reasons from validatePreAuthTokenForDkg map to TokenValidationResult.valid=false:
 *   "PRE_AUTH_TOKEN_MISSING"  → reason: "token is invalid or not found"
 *   "PRE_AUTH_TOKEN_EXPIRED"  → reason: "PRE_AUTH_TOKEN_EXPIRED"
 *   "PRE_AUTH_TOKEN_CONSUMED" → reason: "PRE_AUTH_TOKEN_CONSUMED"
 */

import { randomBytes } from "node:crypto";
import type pg from "pg";
import type { Logger } from "@cello-protocol/interfaces";
import type { TokenValidator, TokenValidationResult } from "@cello-protocol/interfaces";
import { validatePreAuthTokenForDkg } from "../pre-auth-token-repository.js";

/**
 * PgTokenValidator — implements TokenValidator for production environments.
 * Validates and atomically consumes pre-authorization tokens from Postgres.
 * Use in CELLO_ENV=dev/staging/production only.
 */
export class PgTokenValidator implements TokenValidator {
  readonly #pool: pg.Pool;
  readonly #logger: Logger | undefined;

  constructor(pool: pg.Pool, logger?: Logger) {
    this.#pool = pool;
    this.#logger = logger;
  }

  /**
   * Validate and atomically consume a pre-authorization token.
   * Returns { valid: true, phoneStubHash, emailDomain, tokenId } on success.
   * Returns { valid: false, reason } on any failure.
   * Never throws — all errors are encoded in the return type.
   *
   * A correlationId is minted per validateToken() call so that each validation
   * attempt is independently traceable in logs.
   */
  async validateToken(token: string): Promise<TokenValidationResult> {
    const correlationId = Buffer.from(randomBytes(16)).toString("hex");

    // Build a minimal logger shim if no logger injected — avoids null checks
    const log = this.#logger ?? {
      info: () => {},
      warn: () => {},
      error: () => {},
    };

    const result = await validatePreAuthTokenForDkg(this.#pool, {
      token,
      agentId: "(unknown)",
      correlationId,
      logger: log,
    });

    if (result.ok) {
      return {
        valid: true,
        phoneStubHash: result.phoneStubHash,
        emailDomain: result.emailDomain,
        tokenId: result.tokenId,
      };
    }

    // Map error codes to TokenValidationResult failure
    return {
      valid: false,
      reason: result.reason,
    };
  }
}
