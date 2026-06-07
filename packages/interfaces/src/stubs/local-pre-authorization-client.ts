/**
 * LocalPreAuthorizationClient — PreAuthorizationClient stub for CELLO_ENV=local.
 *
 * Returns a token in the format 'DEV-CELLO-' + 16 hex chars.
 * Uses crypto.randomBytes(8).toString('hex') — NOT Math.random().
 * The DEV- prefix marks the token as a non-production stub token.
 * Security properties of SI-001 do not apply to this stub.
 *
 * Zero external dependencies. No network calls. No configuration required.
 * The composition root can wire this stub without any secrets or AWS credentials.
 *
 * Phase P — Pseudocode:
 *   requestToken(phoneStubHash, emailStubHash):
 *     randomPart = crypto.randomBytes(8).toString('hex')  // 8 bytes = 16 hex chars
 *     token = "DEV-CELLO-" + randomPart
 *     return { token }
 *
 * Note: The DEV-CELLO- prefix (10 chars) + 16 hex chars = 26 chars total.
 * This is distinct from the production format: "CELLO-" + 33 base58 chars = 39 chars.
 */

import { randomBytes } from "node:crypto";
import type { PreAuthorizationClient } from "../pre-authorization-client.js";

/**
 * LocalPreAuthorizationClient — implements PreAuthorizationClient for local development.
 * Returns DEV-CELLO- + 16 hex chars. No network or config required.
 * Use in CELLO_ENV=local only.
 */
export class LocalPreAuthorizationClient implements PreAuthorizationClient {
  /**
   * Generate and return a dev pre-authorization token.
   * Uses crypto.randomBytes for entropy (not Math.random).
   * Token format: "DEV-CELLO-" + 16 hex chars.
   */
  async requestToken(
    _phoneStubHash: string,
    _emailStubHash: string,
    _registrationId: string,
  ): Promise<{ token: string }> {
    const randomPart = randomBytes(8).toString("hex");
    return { token: `DEV-CELLO-${randomPart}` };
  }
}
