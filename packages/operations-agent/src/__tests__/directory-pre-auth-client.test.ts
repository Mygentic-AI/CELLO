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
import { DirectoryPreAuthorizationClient } from "../directory-pre-auth-client.js";
import type { Logger } from "@cello-protocol/interfaces";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeLogger(): { logger: Logger; events: Array<{ method: string; event: string; context?: Record<string, unknown> }> } {
  const events: Array<{ method: string; event: string; context?: Record<string, unknown> }> = [];
  const logger: Logger = {
    debug: (event, context) => events.push({ method: "debug", event, context: context as Record<string, unknown> }),
    info: (event, context) => events.push({ method: "info", event, context: context as Record<string, unknown> }),
    warn: (event, context) => events.push({ method: "warn", event, context: context as Record<string, unknown> }),
    error: (event, errorOrContext?, context?) => {
      const ctx = errorOrContext instanceof Error
        ? { error: errorOrContext.message, ...context }
        : errorOrContext as Record<string, unknown>;
      events.push({ method: "error", event, context: ctx });
    },
  };
  return { logger, events };
}

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
    const { logger } = makeLogger();
    const client = new DirectoryPreAuthorizationClient({
      directoryInternalUrl: "http://localhost:8080/internal/pre-authorize",
      apiKey: "test-api-key",
      logger,
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
    const { logger } = makeLogger();
    const client = new DirectoryPreAuthorizationClient({
      directoryInternalUrl: "http://localhost:8080/internal/pre-authorize",
      apiKey: "test-key",
      logger,
      fetch: makeFetch(200, { token: "CELLO-abc123" }),
    });

    const result = await client.requestToken("phone-hash", "example.com");
    expect(result.token).toBe("CELLO-abc123");
  });

  /**
   * AC-005: Throws on HTTP 500 from directory.
   */
  it("throws when directory returns 500", async () => {
    const { logger } = makeLogger();
    const client = new DirectoryPreAuthorizationClient({
      directoryInternalUrl: "http://localhost:8080/internal/pre-authorize",
      apiKey: "test-key",
      logger,
      fetch: makeFetch(500, { error: "internal server error" }),
    });

    await expect(client.requestToken("phone-hash", "example.com")).rejects.toThrow();
  });

  /**
   * AC-005: Throws on connection refused (network error).
   */
  it("throws on network error (connection refused)", async () => {
    const { logger } = makeLogger();
    const networkError = new Error("ECONNREFUSED");
    const client = new DirectoryPreAuthorizationClient({
      directoryInternalUrl: "http://localhost:8080/internal/pre-authorize",
      apiKey: "test-key",
      logger,
      fetch: makeThrowingFetch(networkError),
    });

    await expect(client.requestToken("phone-hash", "example.com")).rejects.toThrow("ECONNREFUSED");
  });

  /**
   * Sends x-cello-internal-api-key header with the configured key.
   */
  it("sends API key header with each request", async () => {
    const { logger } = makeLogger();
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
      logger,
      fetch: capturingFetch,
    });

    await client.requestToken("phone-hash", "example.com");
    expect(capturedHeaders["x-cello-internal-api-key"]).toBe("secret-api-key-xyz");
  });

  /**
   * Sends phoneStubHash and emailDomain in request body.
   */
  it("sends phoneStubHash and emailDomain in POST body", async () => {
    const { logger } = makeLogger();
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
      logger,
      fetch: capturingFetch,
    });

    await client.requestToken("abc123hash", "mycompany.com");
    expect(capturedBody).toMatchObject({
      phoneStubHash: "abc123hash",
      emailDomain: "mycompany.com",
    });
  });
});
