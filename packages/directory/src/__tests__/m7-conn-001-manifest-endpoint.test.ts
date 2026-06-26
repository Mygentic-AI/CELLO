/**
 * CELLO-M7-CONN-001 — GET /manifest on the directory health server.
 *
 * The consortium-manifest poll moves off the authenticated signaling stream to
 * unauthenticated HTTP (DOD-CONN-3). The directory serves the current signed
 * manifest at GET /manifest on the same health server (port 9090) that already
 * serves /bootstrap and /agent-lookup unauthenticated. Routed via the
 * BootstrapTargetGroup ALB ListenerRule (AC-008).
 *
 * Red-first: these tests fail until createHealthServer grows a getCurrentManifest
 * resolver + a GET /manifest handler.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Server } from "node:http";
import type { ConsortiumManifest } from "@cello-protocol/protocol-types";
import { createHealthServer } from "../health-server.js";

const noopLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

async function startServer(server: Server): Promise<{ port: number; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    server.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({ port, close: () => new Promise<void>((res) => server.close(() => res())) });
    });
  });
}

// A realistic public roster — nothing agent-specific (SI-002).
const sampleManifest: ConsortiumManifest = {
  version: 7,
  not_before: "2026-06-01T00:00:00Z",
  expires: "2026-12-01T00:00:00Z",
  nodes: [
    { nodeId: "us-east-1", pubkey: "a".repeat(64), region: "us-east-1", provider: "aws", endpoint: "/dns4/dir-us1/tcp/80/ws/p2p/12D3KooWUs1" },
    { nodeId: "eu-central-1", pubkey: "b".repeat(64), region: "eu-central-1", provider: "gcp", endpoint: "/dns4/dir-eu1/tcp/80/ws/p2p/12D3KooWEu1" },
  ],
  signatures: [
    { officerIndex: 0, signature: "c".repeat(128) },
    { officerIndex: 2, signature: "d".repeat(128) },
  ],
};

// ─── AC-008: GET /manifest returns 200 + the signed manifest when a store is configured ───
describe("CONN-001 /manifest: store configured", () => {
  let port: number;
  let close: () => Promise<void>;

  beforeAll(async () => {
    const server = createHealthServer({
      nodeId: "us-east-1",
      schemaVersion: 21,
      logger: noopLogger,
      port: 0,
      getCurrentManifest: () => sampleManifest,
    });
    ({ port, close } = await startServer(server));
  });
  afterAll(async () => { await close(); });

  it("returns HTTP 200", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/manifest`);
    expect(res.status).toBe(200);
  });

  it("returns the manifest verbatim in the JSON body", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/manifest`);
    const body = (await res.json()) as ConsortiumManifest;
    expect(body).toEqual(sampleManifest);
  });

  // SI-002: nothing agent-specific is ever served. The body's keys are exactly the
  // public-roster schema; each node carries only public infra fields.
  it("serves ONLY the public roster — no agent_id / k_local / per-agent fields (SI-002)", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/manifest`);
    const body = (await res.json()) as Record<string, unknown>;
    expect(new Set(Object.keys(body))).toEqual(
      new Set(["version", "not_before", "expires", "nodes", "signatures"]),
    );
    for (const node of body["nodes"] as Record<string, unknown>[]) {
      expect(new Set(Object.keys(node))).toEqual(
        new Set(["nodeId", "pubkey", "region", "provider", "endpoint"]),
      );
    }
    const raw = JSON.stringify(body).toLowerCase();
    for (const forbidden of ["agent_id", "agentid", "k_local", "klocal", "owner", "operator"]) {
      expect(raw).not.toContain(forbidden);
    }
  });
});

// ─── 503 when no manifest store is configured (resolver absent or returns null) ───
describe("CONN-001 /manifest: store absent", () => {
  it("returns 503 { error: 'not ready' } when no resolver is provided", async () => {
    const server = createHealthServer({ nodeId: "local", schemaVersion: 21, logger: noopLogger, port: 0 });
    const { port, close } = await startServer(server);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/manifest`);
      expect(res.status).toBe(503);
      expect(((await res.json()) as { error: string }).error).toBe("not ready");
    } finally {
      await close();
    }
  });

  it("returns 503 when the resolver returns null (no manifest loaded yet)", async () => {
    const server = createHealthServer({ nodeId: "local", schemaVersion: 21, logger: noopLogger, port: 0, getCurrentManifest: () => null });
    const { port, close } = await startServer(server);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/manifest`);
      expect(res.status).toBe(503);
    } finally {
      await close();
    }
  });
});

// ─── /health is liveness-only — never affected by manifest availability ───
describe("CONN-001 /manifest: /health stays liveness-only", () => {
  it("GET /health returns 200 even when no manifest store is configured", async () => {
    const server = createHealthServer({ nodeId: "local", schemaVersion: 21, logger: noopLogger, port: 0 });
    const { port, close } = await startServer(server);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      expect(res.status).toBe(200);
      expect(((await res.json()) as { status: string }).status).toBe("ok");
    } finally {
      await close();
    }
  });
});
