/**
 * TokenValidator — interface for validating pre-authorization tokens presented
 * by agents during FROST DKG.
 *
 * Phase A — Architecture note:
 *   The directory node calls this interface when an agent presents a token
 *   during cello_register(). The concrete validator (directory DB lookup vs
 *   dev stub) is hidden behind this boundary.
 *
 *   Local stub: DevTokenValidator (accepts 'DEV-' prefix tokens, returns a
 *               fixed principal — no network or DB dependency)
 *   Production implementation: DirectoryTokenValidator (M6 OPS-AGENT-001)
 */

/**
 * TokenValidationResult — result of validating a pre-authorization token.
 * Discriminated on `valid`.
 *
 * On success, returns the phone stub hash and email domain that were recorded
 * when the token was issued — these are used to associate the new agent profile
 * with the correct operator identity.
 *
 * OPS-AGENT-001: tokenId is the database UUID of the token row.
 * Used for observability (preauth.token.consumed, preauth.token.reuse.rejected,
 * preauth.token.expired events).
 * For DevTokenValidator (CELLO_ENV=local), tokenId is "dev-token" — no DB row.
 * For the { valid: false } case, tokenId may be null when the token is not found in the DB.
 */
export type TokenValidationResult =
  | { valid: true; phoneStubHash: string; emailStubHash: string; tokenId: string }
  | { valid: false; reason: string; tokenId: string | null };

/**
 * TokenValidator — validates a pre-authorization token and returns
 * the associated principal identity on success.
 */
export interface TokenValidator {
  /**
   * Validate a pre-authorization token.
   * Returns { valid: true, phoneStubHash, emailStubHash } on success.
   * Returns { valid: false, reason } on any failure (expired, consumed, not found, malformed).
   * Never throws — validation failures are encoded in the return type.
   */
  validateToken(token: string): Promise<TokenValidationResult>;
}
