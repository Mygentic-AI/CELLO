// SI-001 integration test: /internal/* endpoint authentication
// Story: CELLO-M6B-004
//
// This test verifies:
// - /internal/pre-authorize returns HTTP 401 when x-cello-internal-api-key header is missing
// - /internal/pre-authorize returns HTTP 200 or expected success when valid header is present
// - The directory code enforces authentication, not the ALB (ALB forwards all /internal/* requests)
//
// This test must run against a local directory server with INTERNAL_API_KEY set.
// It verifies the security invariant that unauthenticated requests are rejected.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, ChildProcess } from "child_process";
import { setTimeout } from "timers/promises";

const describeIntegration =
  process.env.CELLO_ENV === "local" ? describe : describe.skip;

describeIntegration("SI-001: Internal API authentication (HTTP 401)", () => {
  let directoryProcess: ChildProcess | null = null;
  const DIRECTORY_PORT = 9090; // Health server port — /internal/* is not on this port in production, but local dev uses 9090
  const INTERNAL_API_KEY = "test-api-key-12345678";

  beforeAll(async () => {
    // Start a local directory server with INTERNAL_API_KEY set
    // Note: This test assumes the directory server is already running via docker-compose
    // with INTERNAL_API_KEY environment variable set. If not, this test will fail.
    //
    // For now, we'll test against the assumption that docker-compose is running.
    // A future enhancement would be to spawn the directory server here.
    //
    // Wait for directory to be ready (up to 10 seconds)
    let ready = false;
    for (let i = 0; i < 10; i++) {
      try {
        const response = await fetch(`http://localhost:${DIRECTORY_PORT}/health`);
        if (response.ok) {
          ready = true;
          break;
        }
      } catch (err) {
        // Not ready yet
      }
      await setTimeout(1000);
    }

    if (!ready) {
      throw new Error(
        "Directory server not ready at http://localhost:9090/health. " +
          "Ensure docker-compose is running with CELLO_ENV=local and INTERNAL_API_KEY set."
      );
    }
  });

  afterAll(async () => {
    if (directoryProcess) {
      directoryProcess.kill("SIGTERM");
    }
  });

  it("returns HTTP 401 when x-cello-internal-api-key header is missing (SI-001)", async () => {
    // Make a request to /internal/pre-authorize with no authentication header
    // Expected: HTTP 401 (Unauthorized)
    //
    // Note: In local dev, /internal/* endpoints are served on port 8081 (internal API server).
    // The health server on port 9090 does not serve /internal/* endpoints.
    // This test must target the correct port based on the directory's configuration.
    //
    // For M6B-004, we assume docker-compose exposes port 8081 → directory container port 8081.
    // If docker-compose does not expose this port, this test will fail with connection refused.

    const INTERNAL_API_PORT = 8081;
    const response = await fetch(
      `http://localhost:${INTERNAL_API_PORT}/internal/pre-authorize`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          agentId: "test-agent-id",
          accountId: "00000000-0000-0000-0000-000000000000",
        }),
      }
    );

    // SI-001 requirement: must return HTTP 401, not 200, 403, or 500
    expect(response.status).toBe(401);

    // Verify response body contains an error message (not required by AC, but good practice)
    const body = await response.text();
    expect(body.toLowerCase()).toMatch(/(unauthorized|missing|api key)/i);
  });

  it("returns HTTP 200 or success when valid x-cello-internal-api-key header is present", async () => {
    // Make a request to /internal/pre-authorize with correct authentication header
    // Expected: HTTP 200 or 400 (if request body is invalid), but NOT 401
    //
    // This test verifies that the API key header grants access.
    // The actual response depends on whether the request body is valid.
    // For this test, we only care that 401 is NOT returned.

    const INTERNAL_API_PORT = 8081;
    const response = await fetch(
      `http://localhost:${INTERNAL_API_PORT}/internal/pre-authorize`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-cello-internal-api-key": process.env.INTERNAL_API_KEY || INTERNAL_API_KEY,
        },
        body: JSON.stringify({
          agentId: "test-agent-id",
          accountId: "00000000-0000-0000-0000-000000000000",
        }),
      }
    );

    // Must NOT be 401 — authentication succeeded
    expect(response.status).not.toBe(401);

    // Acceptable responses:
    // - 200: Success (pre-authorization created)
    // - 400: Bad request (invalid agentId format, etc.)
    // - 500: Internal error (directory issue, not auth failure)
    //
    // For this test, we only verify that authentication passed (not 401).
    expect([200, 400, 500]).toContain(response.status);
  });

  it("returns HTTP 401 when x-cello-internal-api-key header has incorrect value", async () => {
    // Make a request with wrong API key
    // Expected: HTTP 401 (wrong key = unauthorized)

    const INTERNAL_API_PORT = 8081;
    const response = await fetch(
      `http://localhost:${INTERNAL_API_PORT}/internal/pre-authorize`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-cello-internal-api-key": "wrong-api-key-value",
        },
        body: JSON.stringify({
          agentId: "test-agent-id",
          accountId: "00000000-0000-0000-0000-000000000000",
        }),
      }
    );

    // Wrong key → 401
    expect(response.status).toBe(401);
  });
});
