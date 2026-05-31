/**
 * Bootstrap endpoint tests — GET /bootstrap on the directory health server.
 *
 * Specification:
 *
 * AC-1: GET /bootstrap returns 200 with { multiaddr, peerId } when multiaddr is configured.
 *   Interpretation: createHealthServer is called with multiaddr and peerId options.
 *   The endpoint returns both fields in the JSON body.
 *
 * AC-2: GET /bootstrap returns 503 with { error: "not ready" } when multiaddr is not configured.
 *   Interpretation: createHealthServer is called without the multiaddr option.
 *   The endpoint returns 503 so callers know the node is not ready to announce yet.
 *
 * AC-3: GET /health still works when multiaddr is configured (regression guard).
 *   Interpretation: Adding the bootstrap route must not break the existing health route.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Server } from "node:http";
import { createHealthServer } from "../health-server.js";

// ─── Shared logger stub ───────────────────────────────────────────────────────

const noopLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

// ─── Helper: start server on random port, return port + cleanup ───────────────

async function startServer(server: Server): Promise<{ port: number; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    server.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({
        port,
        close: () => new Promise<void>((res) => server.close(() => res())),
      });
    });
  });
}

// ─── AC-1: GET /bootstrap returns 200 when multiaddr is configured ────────────

describe("bootstrap endpoint: AC-1 configured", () => {
  let port: number;
  let close: () => Promise<void>;

  const testMultiaddr = "/dns4/directory-us1.cello.mygentic.ai/tcp/80/ws/p2p/12D3KooWTestPeerId0000";
  const testPeerId = "12D3KooWTestPeerId0000";

  beforeAll(async () => {
    const server = createHealthServer({
      nodeId: "us-east-1",
      schemaVersion: 21,
      logger: noopLogger,
      port: 0,
      multiaddr: testMultiaddr,
      peerId: testPeerId,
    });
    ({ port, close } = await startServer(server));
  });

  afterAll(async () => { await close(); });

  it("returns HTTP 200", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/bootstrap`);
    expect(res.status).toBe(200);
  });

  it("returns correct multiaddr in JSON body", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/bootstrap`);
    const body = await res.json() as { multiaddr: string; peerId: string };
    expect(body.multiaddr).toBe(testMultiaddr);
  });

  it("returns correct peerId in JSON body", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/bootstrap`);
    const body = await res.json() as { multiaddr: string; peerId: string };
    expect(body.peerId).toBe(testPeerId);
  });
});

// ─── AC-2: GET /bootstrap returns 503 when multiaddr is not configured ────────

describe("bootstrap endpoint: AC-2 not configured", () => {
  let port: number;
  let close: () => Promise<void>;

  beforeAll(async () => {
    const server = createHealthServer({
      nodeId: "local",
      schemaVersion: 21,
      logger: noopLogger,
      port: 0,
      // multiaddr intentionally omitted
    });
    ({ port, close } = await startServer(server));
  });

  afterAll(async () => { await close(); });

  it("returns HTTP 503", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/bootstrap`);
    expect(res.status).toBe(503);
  });

  it("returns { error: 'not ready' } in JSON body", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/bootstrap`);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("not ready");
  });
});

// ─── AC-3: GET /health still works when multiaddr is configured (regression) ───

describe("bootstrap endpoint: AC-3 health regression", () => {
  let port: number;
  let close: () => Promise<void>;

  beforeAll(async () => {
    const server = createHealthServer({
      nodeId: "us-east-1",
      schemaVersion: 21,
      logger: noopLogger,
      port: 0,
      multiaddr: "/dns4/directory-us1.cello.mygentic.ai/tcp/80/ws/p2p/12D3KooWTestPeerId0001",
      peerId: "12D3KooWTestPeerId0001",
    });
    ({ port, close } = await startServer(server));
  });

  afterAll(async () => { await close(); });

  it("GET /health still returns 200 with correct JSON", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(200);
    const body = await res.json() as { status: string; nodeId: string; schemaVersion: number };
    expect(body).toEqual({ status: "ok", nodeId: "us-east-1", schemaVersion: 21 });
  });
});
