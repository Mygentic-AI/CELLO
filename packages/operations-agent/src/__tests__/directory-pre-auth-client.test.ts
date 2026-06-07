/**
 * directory-pre-auth-client.test.ts — Unit tests for DirectoryPreAuthorizationClient
 *
 * Specification (CELLO-OPS-AGENT-005B):
 *
 * SI-002: The DirectoryPreAuthorizationClient has exactly one public method: requestToken().
 *   No other directory methods are exposed. This limits blast radius if the API key
 *   is extracted from a compromised container.
 *
 * AC-005: When the directory endpoint returns connection refused (or any HTTP error),
 *   the client throws an error that is surfaced as registration.preauth.request.failed.
 *
 * Tests are pure unit tests — no real network calls, no Postgres required.
 * A mock fetch is injected via the constructor for isolation.
 */

import { describe, it, expect } from "vitest";
import { DirectoryPreAuthorizationClient, PreAuthRequestError } from "../directory-pre-auth-client.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeFetch(statusCode: number, body: unknown): typeof globalThis.fetch {
  return async (_url: string | URL | Request, _init?: RequestInit) => {
    return {
      ok: statusCode >= 200 && statusCode < 300,
      status: statusCode,
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as Response;
  };
}

function makeThrowingFetch(error: Error): typeof globalThis.fetch {
  return async (_url: string | URL | Request, _init?: RequestInit) => {
    throw error;
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("DirectoryPreAuthorizationClient", () => {
  /**
   * SI-002: Client exposes exactly one public method — requestToken().
   * Verified by enumerating own prototype methods.
   */
  it("SI-002: has exactly one public method — requestToken()", () => {
    const client = new DirectoryPreAuthorizationClient({
      directoryInternalUrl: "http://localhost:8080/internal/pre-authorize",
      apiKey: "test-api-key",
      fetch: makeFetch(200, { token: "CELLO-abc" }),
    });

    const publicMethods = Object.getOwnPropertyNames(
      Object.getPrototypeOf(client),
    ).filter(
      (name) =>
        name !== "constructor" &&
        typeof (client as unknown as Record<string, unknown>)[name] === "function",
    );

    expect(publicMethods).toEqual(["requestToken"]);
  });

  /**
   * AC-001 / happy path: requestToken() returns a token on 200 OK.
   */
  it("returns token on 200 OK from directory", async () => {
    const client = new DirectoryPreAuthorizationClient({
      directoryInternalUrl: "http://localhost:8080/internal/pre-authorize",
      apiKey: "test-key",
      fetch: makeFetch(200, { token: "CELLO-abc123" }),
    });

    const result = await client.requestToken("phone-hash", "example.com");
    expect(result.token).toBe("CELLO-abc123");
  });

  /**
   * AC-005: Throws PreAuthRequestError with httpStatus on HTTP 500 from directory.
   * Caller uses httpStatus to populate registration.preauth.request.failed log event.
   */
  it("throws PreAuthRequestError with httpStatus=500 when directory returns 500", async () => {
    const client = new DirectoryPreAuthorizationClient({
      directoryInternalUrl: "http://localhost:8080/internal/pre-authorize",
      apiKey: "test-key",
      fetch: makeFetch(500, { error: "internal server error" }),
    });

    const err = await client.requestToken("phone-hash", "example.com").catch((e) => e);
    expect(err).toBeInstanceOf(PreAuthRequestError);
    expect((err as PreAuthRequestError).httpStatus).toBe(500);
  });

  /**
   * AC-005: Throws PreAuthRequestError with httpStatus=0 on network error.
   * httpStatus=0 signals a network-level failure (no HTTP response received).
   */
  it("throws PreAuthRequestError with httpStatus=0 on network error", async () => {
    const networkError = new Error("ECONNREFUSED");
    const client = new DirectoryPreAuthorizationClient({
      directoryInternalUrl: "http://localhost:8080/internal/pre-authorize",
      apiKey: "test-key",
      fetch: makeThrowingFetch(networkError),
    });

    const err = await client.requestToken("phone-hash", "example.com").catch((e) => e);
    expect(err).toBeInstanceOf(PreAuthRequestError);
    expect((err as PreAuthRequestError).httpStatus).toBe(0);
    expect(err.message).toMatch(/ECONNREFUSED/);
  });

  /**
   * Sends x-cello-internal-api-key header with the configured key.
   */
  it("sends API key header with each request", async () => {
    let capturedHeaders: Record<string, string> = {};

    const capturingFetch: typeof globalThis.fetch = async (_url, init?) => {
      capturedHeaders = (init?.headers ?? {}) as Record<string, string>;
      return {
        ok: true,
        status: 200,
        json: async () => ({ token: "CELLO-test" }),
      } as Response;
    };

    const client = new DirectoryPreAuthorizationClient({
      directoryInternalUrl: "http://localhost:8080/internal/pre-authorize",
      apiKey: "secret-api-key-xyz",
      fetch: capturingFetch,
    });

    await client.requestToken("phone-hash", "example.com");
    expect(capturedHeaders["x-cello-internal-api-key"]).toBe("secret-api-key-xyz");
  });

  /**
   * Sends phoneStubHash and emailStubHash in request body.
   */
  it("sends phoneStubHash and emailStubHash in POST body", async () => {
    let capturedBody: unknown;

    const capturingFetch: typeof globalThis.fetch = async (_url, init?) => {
      capturedBody = JSON.parse(init?.body as string);
      return {
        ok: true,
        status: 200,
        json: async () => ({ token: "CELLO-test" }),
      } as Response;
    };

    const client = new DirectoryPreAuthorizationClient({
      directoryInternalUrl: "http://localhost:8080/internal/pre-authorize",
      apiKey: "key",
      fetch: capturingFetch,
    });

    await client.requestToken("abc123hash", "abc123emailhash");
    expect(capturedBody).toMatchObject({
      phoneStubHash: "abc123hash",
      emailStubHash: "abc123emailhash",
    });
  });
});
