/**
 * CELLO-DEPLOY-003: Relay service lifecycle and health server tests
 *
 * Specification (S phase):
 *
 * AC-002: relay.service.started logged at INFO with { relayId, region, environment }
 *         where relayId = public key hex from loaded signing key.
 *
 * AC-007: GET /health on port 0 (bound dynamically in tests) returns HTTP 200
 *         with JSON body { relayId, status: 'ok' } within 2 seconds.
 *
 * SI-001 (DB-001): On startup error (key load failure), relay.service.start.failed is logged
 *         at ERROR with { reason, region } only — NO relayId field (key may not be available).
 *
 * Observability events (relay.service.stopped): logged at INFO with
 *         { relayId, region, environment, uptimeMs }.
 *
 * relay.service.crashed: logged at ERROR with { relayId, region, reason }.
 *
 * Note: These are unit/in-process tests. The integration ACs (AC-001, AC-003–AC-006)
 * are verified via AWS CLI commands as specified in the story. This file covers
 * the observable unit behavior: event names, required context fields, SI-001.
 */

import { describe, it, expect } from "vitest";
import { generateKeypair } from "@cello/crypto";
import type { Logger, LogContext } from "@cello/interfaces";
import {
  logRelayServiceStarted,
  logRelayServiceStopped,
  logRelayServiceStartFailed,
  logRelayServiceCrashed,
  createRelayHealthServer,
} from "../relay-service-lifecycle.js";

// ─── Capture logger ────────────────────────────────────────────────────────────

interface LogEntry {
  level: "debug" | "info" | "warn" | "error";
  event: string;
  context: LogContext;
}

function makeCaptureLogger(): { logger: Logger; entries: LogEntry[] } {
  const entries: LogEntry[] = [];
  const logger: Logger = {
    debug: (event: string, ctx: LogContext) => entries.push({ level: "debug", event, context: ctx }),
    info: (event: string, ctx: LogContext) => entries.push({ level: "info", event, context: ctx }),
    warn: (event: string, ctx: LogContext) => entries.push({ level: "warn", event, context: ctx }),
    error: (event: string, ctx: LogContext) => entries.push({ level: "error", event, context: ctx }),
  };
  return { logger, entries };
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe("DEPLOY-003: relay service lifecycle events", () => {
  it("AC-002: relay.service.started is logged at INFO with { relayId, region, environment }", async () => {
    const { logger, entries } = makeCaptureLogger();
    const kp = generateKeypair();
    const pubkeyBytes = await kp.getPublicKey();
    const relayId = Buffer.from(pubkeyBytes).toString("hex");

    logRelayServiceStarted(logger, {
      relayId,
      region: "us-east-1",
      environment: "dev",
    });

    const entry = entries.find((e) => e.event === "relay.service.started");
    expect(entry).toBeDefined();
    expect(entry!.level).toBe("info");
    expect(entry!.context["relayId"]).toBe(relayId);
    expect(entry!.context["region"]).toBe("us-east-1");
    expect(entry!.context["environment"]).toBe("dev");
  });

  it("relay.service.stopped is logged at INFO with { relayId, region, environment, uptimeMs }", async () => {
    const { logger, entries } = makeCaptureLogger();
    const kp = generateKeypair();
    const pubkeyBytes = await kp.getPublicKey();
    const relayId = Buffer.from(pubkeyBytes).toString("hex");

    logRelayServiceStopped(logger, {
      relayId,
      region: "us-east-1",
      environment: "dev",
      uptimeMs: 12345,
    });

    const entry = entries.find((e) => e.event === "relay.service.stopped");
    expect(entry).toBeDefined();
    expect(entry!.level).toBe("info");
    expect(entry!.context["relayId"]).toBe(relayId);
    expect(entry!.context["region"]).toBe("us-east-1");
    expect(entry!.context["environment"]).toBe("dev");
    expect(entry!.context["uptimeMs"]).toBe(12345);
  });

  it("SI-001 + DB-001: relay.service.start.failed logged at ERROR with { reason, region } — no relayId in context", async () => {
    const { logger, entries } = makeCaptureLogger();

    const region = "us-east-1";
    const reason = "libp2p startup failed: port already in use";

    logRelayServiceStartFailed(logger, { reason, region });

    const entry = entries.find((e) => e.event === "relay.service.start.failed");
    expect(entry).toBeDefined();
    expect(entry!.level).toBe("error");
    expect(entry!.context["reason"]).toBe(reason);
    expect(entry!.context["region"]).toBe(region);

    // SI-001: relayId MUST NOT appear in start.failed context
    // (the key may not have been loaded yet when this error fires)
    expect(entry!.context["relayId"]).toBeUndefined();
  });

  it("relay.service.crashed is logged at ERROR with { relayId, region, reason }", async () => {
    const { logger, entries } = makeCaptureLogger();
    const kp = generateKeypair();
    const pubkeyBytes = await kp.getPublicKey();
    const relayId = Buffer.from(pubkeyBytes).toString("hex");

    logRelayServiceCrashed(logger, {
      relayId,
      region: "eu-central-1",
      reason: "uncaughtException: ENOMEM",
    });

    const entry = entries.find((e) => e.event === "relay.service.crashed");
    expect(entry).toBeDefined();
    expect(entry!.level).toBe("error");
    expect(entry!.context["relayId"]).toBe(relayId);
    expect(entry!.context["region"]).toBe("eu-central-1");
    expect(entry!.context["reason"]).toBe("uncaughtException: ENOMEM");
  });
});

describe("DEPLOY-003: relay health server", () => {
  it("AC-007: GET /health returns HTTP 200 with { relayId, status: 'ok' }", async () => {
    const kp = generateKeypair();
    const pubkeyBytes = await kp.getPublicKey();
    const relayId = Buffer.from(pubkeyBytes).toString("hex");

    const { logger } = makeCaptureLogger();
    const server = createRelayHealthServer({ relayId, logger });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address() as { port: number };
    const port = address.port;

    try {
      const resp = await fetch(`http://127.0.0.1:${port}/health`);
      expect(resp.status).toBe(200);
      const body = await resp.json() as { relayId: string; status: string };
      expect(body.status).toBe("ok");
      expect(body.relayId).toBe(relayId);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("GET /health responds within 2 seconds", async () => {
    const relayId = "a".repeat(64); // mock hex key
    const { logger } = makeCaptureLogger();
    const server = createRelayHealthServer({ relayId, logger });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address() as { port: number };
    const port = address.port;

    try {
      const start = Date.now();
      const resp = await fetch(`http://127.0.0.1:${port}/health`);
      const elapsed = Date.now() - start;
      expect(resp.status).toBe(200);
      expect(elapsed).toBeLessThan(2000);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("non-/health path returns 404", async () => {
    const relayId = "b".repeat(64);
    const { logger } = makeCaptureLogger();
    const server = createRelayHealthServer({ relayId, logger });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address() as { port: number };
    const port = address.port;

    try {
      const resp = await fetch(`http://127.0.0.1:${port}/other`);
      expect(resp.status).toBe(404);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
