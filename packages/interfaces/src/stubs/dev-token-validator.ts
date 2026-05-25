/**
 * DevTokenValidator — TokenValidator stub for CELLO_ENV=local.
 *
 * Accepts any token prefixed with 'DEV-' and returns a fixed principal.
 * Rejects all other tokens with a descriptive reason.
 *
 * Zero external dependencies. No network calls. No configuration required.
 * The DEV- prefix is a sentinel that prevents accidental use of dev tokens
 * against production endpoints.
 *
 * Phase P — Pseudocode:
 *   validateToken(token):
 *     if token starts with "DEV-":
 *       return { valid: true, phoneStubHash: "dev-phone-stub-hash", emailDomain: "dev.example.com" }
 *     else:
 *       return { valid: false, reason: "DevTokenValidator only accepts 'DEV-' prefix tokens" }
 */

import type { TokenValidator, TokenValidationResult } from "../token-validator.js";

/** Fixed phone stub hash returned by the dev stub for all valid DEV- tokens */
const DEV_PHONE_STUB_HASH = "dev-phone-stub-hash-0000000000000000000000000000000000000000";
/** Fixed email domain returned by the dev stub for all valid DEV- tokens */
const DEV_EMAIL_DOMAIN = "dev.example.com";

/**
 * DevTokenValidator — implements TokenValidator for local development.
 * Accepts DEV- prefixed tokens only. Returns a fixed principal.
 * Use in CELLO_ENV=local only.
 */
export class DevTokenValidator implements TokenValidator {
  /**
   * Validate a token. Accepts any string starting with 'DEV-'.
   * Returns a fixed principal — the exact values are not meaningful in local dev.
   */
  async validateToken(token: string): Promise<TokenValidationResult> {
    if (token.startsWith("DEV-")) {
      return {
        valid: true,
        phoneStubHash: DEV_PHONE_STUB_HASH,
        emailDomain: DEV_EMAIL_DOMAIN,
      };
    }
    return {
      valid: false,
      reason: "DevTokenValidator only accepts tokens with the 'DEV-' prefix. " +
        "Use CELLO_ENV=local and a 'DEV-' prefixed token for local development.",
    };
  }
}
