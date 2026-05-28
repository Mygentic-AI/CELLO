/**
 * directory-pre-auth-client.ts — DirectoryPreAuthorizationClient
 *
 * Phase P — Pseudocode:
 *   requestToken(phoneStubHash, emailDomain):
 *     1. POST directoryInternalUrl with JSON body { phoneStubHash, emailDomain }
 *     2. Include header x-cello-internal-api-key: apiKey (SI-001)
 *     3. Include header Content-Type: application/json
 *     4. On network error (fetch throws): rethrow — caller logs registration.preauth.request.failed
 *     5. On HTTP error (non-2xx): throw with status code — caller logs the event
 *     6. On success: parse body, return { token: body.token }
 *
 * SI-002 (enforced by architecture): this wrapper exposes exactly ONE public method —
 * requestToken(). Even if an attacker extracts the API key from the container's
 * process environment, they cannot call registration, session, or checkpoint endpoints
 * via this client. The narrow interface is the blast-radius limit.
 *
 * The API key is sent as the x-cello-internal-api-key header, which matches
 * the InternalApiServer's authentication scheme (OPS-AGENT-001).
 */

import type { Logger, PreAuthorizationClient } from "@cello-protocol/interfaces";

export type DirectoryPreAuthClientOptions = {
  /** Full URL to the directory's /internal/pre-authorize endpoint */
  directoryInternalUrl: string;
  /** The DIRECTORY_API_KEY secret — sent as x-cello-internal-api-key */
  apiKey: string;
  /** Injected structured logger */
  logger: Logger;
  /**
   * Optional fetch override — defaults to globalThis.fetch.
   * Used in unit tests to inject mock network responses.
   */
  fetch?: typeof globalThis.fetch;
};

/**
 * DirectoryPreAuthorizationClient — production implementation of PreAuthorizationClient.
 *
 * Calls POST /internal/pre-authorize on the directory with the API key.
 * Exposes exactly one public method: requestToken() (SI-002).
 *
 * Use in CELLO_ENV = dev | staging | production only.
 * Local stub: LocalPreAuthorizationClient (packages/interfaces/stubs).
 */
export class DirectoryPreAuthorizationClient implements PreAuthorizationClient {
  readonly #url: string;
  readonly #apiKey: string;
  readonly #logger: Logger;
  readonly #fetch: typeof globalThis.fetch;

  constructor(opts: DirectoryPreAuthClientOptions) {
    this.#url = opts.directoryInternalUrl;
    this.#apiKey = opts.apiKey;
    this.#logger = opts.logger;
    this.#fetch = opts.fetch ?? globalThis.fetch;
  }

  /**
   * Request a pre-authorization token from the directory.
   *
   * On success: returns { token: string } — the token value only.
   * On failure: throws an Error. Callers are responsible for logging
   *   registration.preauth.request.failed at ERROR with { registrationId, httpStatus, correlationId }.
   *
   * SI-002: this is the ONLY public method on this class.
   */
  async requestToken(
    phoneStubHash: string,
    emailDomain: string,
  ): Promise<{ token: string }> {
    let response: Response;
    try {
      response = await this.#fetch(this.#url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-cello-internal-api-key": this.#apiKey,
        },
        body: JSON.stringify({ phoneStubHash, emailDomain }),
      });
    } catch (err) {
      // Network-level error (ECONNREFUSED, DNS failure, timeout, etc.)
      // Rethrow without logging — the state machine logs registration.preauth.request.failed
      const error = err instanceof Error ? err : new Error(String(err));
      this.#logger.error("registration.preauth.request.failed", error, {
        httpStatus: 0,
        correlationId: "network-error",
      });
      throw error;
    }

    if (!response.ok) {
      const message = `Directory pre-authorize returned HTTP ${response.status}`;
      const error = new Error(message);
      this.#logger.error("registration.preauth.request.failed", error, {
        httpStatus: response.status,
        correlationId: "http-error",
      });
      throw error;
    }

    const body = await response.json() as { token: string };
    return { token: body.token };
  }
}
