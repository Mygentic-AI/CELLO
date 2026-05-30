/**
 * directory-pre-auth-client.ts — DirectoryPreAuthorizationClient
 *
 * Phase P — Pseudocode:
 *   requestToken(phoneStubHash, emailDomain):
 *     1. POST directoryInternalUrl with JSON body { phoneStubHash, emailDomain }
 *     2. Include header x-cello-internal-api-key: apiKey (SI-001)
 *     3. Include header Content-Type: application/json
 *     4. On network error (fetch throws): throw PreAuthRequestError(message, httpStatus=0)
 *     5. On HTTP error (non-2xx): throw PreAuthRequestError(message, httpStatus=response.status)
 *     6. On success: parse body, return { token: body.token }
 *
 * Logging responsibility: the caller (state machine) owns registration.preauth.request.failed.
 * This client only throws — it never logs. This gives the caller access to registrationId
 * and correlationId, which are not available here.
 *
 * SI-002 (enforced by architecture): this wrapper exposes exactly ONE public method —
 * requestToken(). Even if an attacker extracts the API key from the container's
 * process environment, they cannot call registration, session, or checkpoint endpoints
 * via this client. The narrow interface is the blast-radius limit.
 *
 * The API key is sent as the x-cello-internal-api-key header, which matches
 * the InternalApiServer's authentication scheme (OPS-AGENT-001).
 */

import type { PreAuthorizationClient } from "@cello-protocol/interfaces";

/**
 * Thrown by DirectoryPreAuthorizationClient when the directory request fails.
 * Carries httpStatus (0 for network errors, HTTP status code for server errors)
 * so callers can include it in the registration.preauth.request.failed log event.
 */
export class PreAuthRequestError extends Error {
  readonly httpStatus: number;
  constructor(message: string, httpStatus: number) {
    super(message);
    this.name = "PreAuthRequestError";
    this.httpStatus = httpStatus;
  }
}

export type DirectoryPreAuthClientOptions = {
  /** Full URL to the directory's /internal/pre-authorize endpoint */
  directoryInternalUrl: string;
  /** The DIRECTORY_API_KEY secret — sent as x-cello-internal-api-key */
  apiKey: string;
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
  readonly #fetch: typeof globalThis.fetch;

  constructor(opts: DirectoryPreAuthClientOptions) {
    this.#url = opts.directoryInternalUrl;
    this.#apiKey = opts.apiKey;
    this.#fetch = opts.fetch ?? globalThis.fetch;
  }

  /**
   * Request a pre-authorization token from the directory.
   *
   * On success: returns { token: string } — the token value only.
   * On failure: throws PreAuthRequestError with httpStatus set.
   *   The caller (state machine) is responsible for logging
   *   registration.preauth.request.failed with { registrationId, httpStatus, correlationId }.
   *
   * SI-002: this is the ONLY public method on this class.
   */
  async requestToken(
    phoneStubHash: string,
    emailDomain: string,
    registrationId: string,
  ): Promise<{ token: string }> {
    let response: Response;
    try {
      response = await this.#fetch(this.#url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-cello-internal-api-key": this.#apiKey,
        },
        body: JSON.stringify({ phoneStubHash, emailDomain, registrationId }),
      });
    } catch (err) {
      // Network-level error (ECONNREFUSED, DNS failure, timeout, etc.)
      // Only rethrow — caller owns registration.preauth.request.failed logging.
      const message = err instanceof Error ? err.message : String(err);
      throw new PreAuthRequestError(message, 0);
    }

    if (!response.ok) {
      throw new PreAuthRequestError(
        `Directory pre-authorize returned HTTP ${response.status}`,
        response.status,
      );
    }

    const body = await response.json() as { token: string };
    return { token: body.token };
  }
}
