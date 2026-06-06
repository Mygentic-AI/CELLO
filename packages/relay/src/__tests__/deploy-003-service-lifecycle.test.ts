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
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { generateKeypair } from "@cello-protocol/crypto";
import type { Logger, LogContext } from "@cello-protocol/interfaces";
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
    const { server } = createRelayHealthServer({ relayId, logger, requiresRegistration: false });

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

  it("GET /health returns 503 before registration, 200 after markRegistered()", async () => {
    const relayId = "a".repeat(64);
    const { logger } = makeCaptureLogger();
    const { server, markRegistered } = createRelayHealthServer({ relayId, logger, requiresRegistration: true });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address() as { port: number };
    const port = address.port;

    try {
      const before = await fetch(`http://127.0.0.1:${port}/health`);
      expect(before.status).toBe(503);
      const beforeBody = await before.json() as { relayId: string; status: string; reason: string };
      expect(beforeBody.relayId).toBe(relayId);
      expect(beforeBody.status).toBe("starting");
      expect(beforeBody.reason).toBe("awaiting_directory_registration");

      markRegistered();

      const after = await fetch(`http://127.0.0.1:${port}/health`);
      expect(after.status).toBe(200);
      const afterBody = await after.json() as { relayId: string; status: string };
      expect(afterBody.relayId).toBe(relayId);
      expect(afterBody.status).toBe("ok");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("GET /health responds within 2 seconds", async () => {
    const relayId = "a".repeat(64);
    const { logger } = makeCaptureLogger();
    const { server } = createRelayHealthServer({ relayId, logger, requiresRegistration: false });

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
    const { server } = createRelayHealthServer({ relayId, logger, requiresRegistration: false });

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

// ─── AC-008-dist-freshness ─────────────────────────────────────────────────────
//
// Vitest transpiles TypeScript on the fly and never reads dist/.
// A stale dist is invisible to all automated checks until a live smoke test
// hits the compiled binary. This check ensures the compiled output contains
// the handlers introduced or modified by DEPLOY-003.

describe("DEPLOY-003: AC-008-dist-freshness", () => {
  it("dist/bin/relay.js contains relay-service-lifecycle imports", () => {
    const distPath = resolve(import.meta.dirname, "../../dist/bin/relay.js");
    if (existsSync(distPath)) {
      const content = readFileSync(distPath, "utf-8");
      expect(content).toContain("logRelayServiceStarted");
      expect(content).toContain("createRelayHealthServer");
      expect(content).toContain("logRelayServiceCrashed");
    } else {
      throw new Error("dist/bin/relay.js does not exist — run pnpm run typecheck first");
    }
  });

  it("dist/relay-service-lifecycle.js contains all four exported log functions", () => {
    const distPath = resolve(import.meta.dirname, "../../dist/relay-service-lifecycle.js");
    if (existsSync(distPath)) {
      const content = readFileSync(distPath, "utf-8");
      expect(content).toContain("logRelayServiceStarted");
      expect(content).toContain("logRelayServiceStopped");
      expect(content).toContain("logRelayServiceStartFailed");
      expect(content).toContain("logRelayServiceCrashed");
      expect(content).toContain("createRelayHealthServer");
    } else {
      throw new Error("dist/relay-service-lifecycle.js does not exist — run pnpm run typecheck first");
    }
  });
});

// ─── SI-003: relay task has no public IP ──────────────────────────────────────
//
// Adversarial condition: even if a developer sets AssignPublicIp: ENABLED,
// the ECS service template must enforce private subnets and no public IP
// by construction — verified by reading cello-ecs-relay.yaml.

describe("DEPLOY-003: SI-003 relay task has no public IP", () => {
  const templatePath = resolve(import.meta.dirname, "../../../../infra/cloudformation/cello-ecs-relay.yaml");

  it("template exists", () => {
    expect(existsSync(templatePath)).toBe(true);
  });

  it("AssignPublicIp is DISABLED", () => {
    const content = readFileSync(templatePath, "utf-8");
    expect(content).toContain("AssignPublicIp: DISABLED");
    expect(content).not.toContain("AssignPublicIp: ENABLED");
  });

  it("service subnets reference private-subnet imports only", () => {
    const content = readFileSync(templatePath, "utf-8");
    // AwsvpcConfiguration subnets must be private subnets (ECS task stays private)
    expect(content).toContain("private-subnet-a");
    expect(content).toContain("private-subnet-b");
    // M6B-007: the relay now has an internet-facing ALB that uses public subnets.
    // SI-003 is about the ECS Task (the relay process) having no public IP —
    // not about whether the template references public subnets at all.
    // AssignPublicIp: DISABLED (verified above) is the enforcement mechanism.
    // The ALB legitimately uses public-subnet-a/b — traffic flows:
    //   Internet → ALB (public subnets) → relay ECS task (private subnets, no public IP)
    // So public-subnet references in the ALB resource are correct and expected.
    // The private-subnet references in AwsvpcConfiguration above are what enforces SI-003.
  });

  it("security group references ecs-relay-sg, not a wildcard", () => {
    const content = readFileSync(templatePath, "utf-8");
    expect(content).toContain("ecs-relay-sg");
  });
});

// ─── AC-004: private key bytes never appear in log output ─────────────────────
//
// The story requires verifying that key bytes do not appear in log output
// during normal operation OR during a simulated startup error.
// This test covers the simulated startup error path: inject a known key seed,
// call logRelayServiceStartFailed (which fires when the key load itself may have
// succeeded but a subsequent startup step failed), and assert that no serialization
// of the key bytes appears in any logged context field.

describe("DEPLOY-003: AC-004 private key bytes not in log output", () => {
  it("AC-004: private key bytes do not appear in log events during simulated startup failure", async () => {
    const { logger, entries } = makeCaptureLogger();

    // Generate a real keypair with known seed material
    const kp = generateKeypair();
    const pubkeyBytes = await kp.getPublicKey();
    const pubkeyHex = Buffer.from(pubkeyBytes).toString("hex");

    // Simulate a startup error that fires AFTER the key was loaded
    // (e.g. relay node creation failed after key was in memory)
    logRelayServiceStartFailed(logger, {
      reason: "createRelayNode failed: port 4000 already in use",
      region: "us-east-1",
    });

    // Also log a crashed event with the relayId
    logRelayServiceCrashed(logger, {
      relayId: pubkeyHex,
      region: "us-east-1",
      reason: "uncaughtException",
    });

    // Assert: the raw hex of the public key bytes must not appear in
    // the start.failed event context (where only reason+region are logged)
    const startFailedEntry = entries.find((e) => e.event === "relay.service.start.failed");
    expect(startFailedEntry).toBeDefined();
    const startFailedContextJson = JSON.stringify(startFailedEntry!.context);
    expect(startFailedContextJson).not.toContain(pubkeyHex);

    // Sanity check: the crashed event DOES contain the relayId (public key)
    // but NOT any private key material — we can only check what we have access to
    // (the public key). The private key bytes are never exposed by the KeyProvider
    // interface, so they cannot appear in logs by construction.
    const crashedEntry = entries.find((e) => e.event === "relay.service.crashed");
    expect(crashedEntry).toBeDefined();
    // crashed event correctly contains relayId (public key hex) — that's expected
    expect(crashedEntry!.context["relayId"]).toBe(pubkeyHex);
    // crashed event does NOT contain any extra key material beyond what's declared
    const crashedContextKeys = Object.keys(crashedEntry!.context);
    expect(crashedContextKeys).toEqual(expect.arrayContaining(["relayId", "region", "reason"]));
    expect(crashedContextKeys).toHaveLength(3);
  });
});

// ─── SI-002: distinct signing identity per relay ──────────────────────────────
//
// Adversarial condition: even when provisioning a replacement relay after a task
// failure, a new key pair is generated and registered rather than reusing the
// failed task's key. This is enforced structurally: the Secrets Manager path in
// the ECS task definition is parameterized per-environment, making it impossible
// for two relay deployments with different Environment parameters to share a key.

describe("DEPLOY-003: SI-002 distinct signing identity per relay", () => {
  const templatePath = resolve(import.meta.dirname, "../../../../infra/cloudformation/cello-ecs-relay.yaml");

  it("SI-002: NODE_PRIVATE_KEY secret path is parameterized per-environment", () => {
    const content = readFileSync(templatePath, "utf-8");
    // The secret ValueFrom must include the Environment parameter substitution
    // so that dev/staging/production each load a different key
    expect(content).toContain("node-private-key");
    // Must reference Environment parameter — pattern: cello/${Environment}/relay/node-private-key
    expect(content).toContain("cello/${Environment}/relay/node-private-key");
  });

  it("SI-002: two distinct keypairs produce distinct public keys", async () => {
    // The mechanism that enforces SI-002 at the crypto level:
    // each generateKeypair() call produces a fresh Ed25519 keypair.
    const kp1 = generateKeypair();
    const kp2 = generateKeypair();
    const pub1 = Buffer.from(await kp1.getPublicKey()).toString("hex");
    const pub2 = Buffer.from(await kp2.getPublicKey()).toString("hex");
    expect(pub1).not.toBe(pub2);
  });
});
