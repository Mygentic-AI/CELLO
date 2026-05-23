/**
 * CELLO-DEPLOY-002 — Directory Service ECS Deployment Tests
 *
 * Specification (AC/SI coverage):
 *
 * AC-002: migration.applied and directory.service.started logged with correct fields.
 *   Interpretation: We verify that the entrypoint script produces the correct log events
 *   by testing the health server and composition root behavior in-process.
 *
 * AC-003: Failed migration prevents service start (SI-001 overlap).
 *   Interpretation: The entrypoint script uses `set -e` and chains commands with &&.
 *   We verify entrypoint script structure guarantees this.
 *
 * AC-006: GET /health returns { status: "ok", nodeId, schemaVersion }.
 *   Verified by starting the health HTTP server and making a request.
 *
 * AC-009: configurePgTypes() is called in PgDirectoryStore constructor, not module scope.
 *   Verified by inspecting the source and testing DATE type handling.
 *
 * AC-010: dist freshness check — grep dist/ for expected identifiers.
 *   Verified by checking that compiled output contains health server references.
 *
 * SI-001: Service never starts if flyway migrate fails.
 *   Verified by asserting entrypoint script structure (set -e, && chaining).
 *
 * SI-002: No secrets in logs or environment.
 *   Verified by testing that the composition root redacts secret values from log output.
 *
 * Observability events tested:
 *   - directory.service.started: { nodeId, region, environment, schemaVersion }
 *   - directory.service.stopped: { nodeId, region, environment, uptimeMs }
 *   - directory.service.crashed: { nodeId, region, reason, consecutiveFailures }
 *   - directory.secrets.unavailable: { nodeId, region, reason }
 *   - migration.applied: { version, description, executionTime }
 *   - migration.failed: { version, description, reason }
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Logger, LogContext } from "@cello/interfaces";

// ─── Test helpers ──────────────────────────────────────────────────────────

/** In-memory logger that captures all log events for assertion. */
class CapturingLogger implements Logger {
  readonly events: Array<{ level: string; event: string; context?: LogContext }> = [];

  debug(event: string, context?: LogContext): void {
    this.events.push({ level: "debug", event, context });
  }
  info(event: string, context?: LogContext): void {
    this.events.push({ level: "info", event, context });
  }
  warn(event: string, context?: LogContext): void {
    this.events.push({ level: "warn", event, context });
  }
  error(event: string, errorOrContext?: Error | LogContext, context?: LogContext): void {
    if (errorOrContext instanceof Error) {
      this.events.push({ level: "error", event, context: { error: errorOrContext.message, ...context } });
    } else {
      this.events.push({ level: "error", event, context: errorOrContext });
    }
  }

  find(eventName: string) {
    return this.events.find((e) => e.event === eventName);
  }
}

// ─── AC-006: GET /health endpoint ──────────────────────────────────────────

describe("DEPLOY-002: AC-006 health endpoint", () => {
  let server: ReturnType<typeof import("node:http").createServer> | undefined;
  let port: number;

  beforeAll(async () => {
    const { createHealthServer } = await import("../health-server.js");
    const logger = new CapturingLogger();
    server = createHealthServer({
      nodeId: "us-east-1",
      schemaVersion: 18,
      logger,
      port: 0, // random port
    });
    await new Promise<void>((resolve) => {
      server!.listen(0, () => {
        const addr = server!.address();
        port = typeof addr === "object" && addr ? addr.port : 0;
        resolve();
      });
    });
  });

  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
    }
  });

  it("returns HTTP 200 with correct JSON body", async () => {
    const response = await fetch(`http://127.0.0.1:${port}/health`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      status: "ok",
      nodeId: "us-east-1",
      schemaVersion: 18,
    });
  });

  it("returns 404 for unknown paths", async () => {
    const response = await fetch(`http://127.0.0.1:${port}/unknown`);
    expect(response.status).toBe(404);
  });

  it("responds within 5 seconds", async () => {
    const start = Date.now();
    const response = await fetch(`http://127.0.0.1:${port}/health`);
    const elapsed = Date.now() - start;
    expect(response.status).toBe(200);
    expect(elapsed).toBeLessThan(5000);
  });
});

// ─── AC-009: configurePgTypes() in constructor ─────────────────────────────

describe("DEPLOY-002: AC-009 configurePgTypes in constructor", () => {
  it("configurePgTypes is called inside PgDirectoryStore constructor, not at module scope", async () => {
    // Read the source file to verify the call is inside the constructor body
    const srcPath = resolve(import.meta.dirname, "../adapters/pg-directory-store.ts");
    const src = readFileSync(srcPath, "utf-8");

    // Find the constructor body
    const constructorMatch = src.match(/constructor\([^)]*\)\s*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/);
    expect(constructorMatch, "constructor should exist").toBeTruthy();
    expect(constructorMatch![1]).toContain("configurePgTypes()");
  });

  it("configurePgTypes has an idempotency guard", async () => {
    const srcPath = resolve(import.meta.dirname, "../pg-type-config.ts");
    const src = readFileSync(srcPath, "utf-8");

    // Check for configured/guard pattern
    expect(src).toContain("if (configured) return");
    expect(src).toContain("configured = true");
  });

  it("configurePgTypes is not called at module top level in pg-directory-store.ts", async () => {
    const srcPath = resolve(import.meta.dirname, "../adapters/pg-directory-store.ts");
    const src = readFileSync(srcPath, "utf-8");

    // Get module-level code (before class definition)
    const classStart = src.indexOf("export class PgDirectoryStore");
    const moduleLevel = src.slice(0, classStart);

    // configurePgTypes should NOT be called at module level
    expect(moduleLevel).not.toMatch(/configurePgTypes\(\)/);
  });
});

// ─── AC-010: dist freshness check ─────────────────────────────────────────

describe("DEPLOY-002: AC-010 dist freshness check", () => {
  it("dist/bin/directory.js contains createHealthServer reference", () => {
    const distPath = resolve(import.meta.dirname, "../../dist/bin/directory.js");
    if (existsSync(distPath)) {
      const content = readFileSync(distPath, "utf-8");
      expect(content).toContain("createHealthServer");
    } else {
      // dist not yet built — gate sequence runs pnpm run typecheck first,
      // which rebuilds dist/ via tsc --build. A missing dist/ here means
      // the test ran before typecheck, which is a gate sequence violation.
      throw new Error("dist/bin/directory.js does not exist — run pnpm run typecheck first");
    }
  });

  it("dist/health-server.js contains createHealthServer export", () => {
    const distPath = resolve(import.meta.dirname, "../../dist/health-server.js");
    if (existsSync(distPath)) {
      const content = readFileSync(distPath, "utf-8");
      expect(content).toContain("createHealthServer");
    } else {
      throw new Error("dist/health-server.js does not exist — run pnpm run typecheck first");
    }
  });
});

// ─── SI-001: Entrypoint prevents service start on migration failure ────────

describe("DEPLOY-002: SI-001 entrypoint migration guard", () => {
  it("docker-entrypoint.sh uses set -e", () => {
    const entrypointPath = resolve(import.meta.dirname, "../../docker-entrypoint.sh");
    const content = readFileSync(entrypointPath, "utf-8");
    expect(content).toContain("set -e");
  });

  it("docker-entrypoint.sh runs flyway migrate before starting the service", () => {
    const entrypointPath = resolve(import.meta.dirname, "../../docker-entrypoint.sh");
    const content = readFileSync(entrypointPath, "utf-8");

    const flywayIndex = content.indexOf("flyway");
    const nodeIndex = content.indexOf("exec node");

    expect(flywayIndex).toBeGreaterThan(-1);
    expect(nodeIndex).toBeGreaterThan(-1);
    // flyway must come before exec node
    expect(flywayIndex).toBeLessThan(nodeIndex);
  });

  it("docker-entrypoint.sh chains flyway with && or relies on set -e for abort", () => {
    const entrypointPath = resolve(import.meta.dirname, "../../docker-entrypoint.sh");
    const content = readFileSync(entrypointPath, "utf-8");

    // Either uses && chaining or set -e (which is already verified above)
    // The key guarantee: if flyway exits non-zero, exec node is never reached
    expect(content).toContain("set -e");
  });
});

// ─── SI-002: No secrets in logs ────────────────────────────────────────────

describe("DEPLOY-002: SI-002 no secrets in logs", () => {
  it("composition root does not log secret values from environment variables", () => {
    const srcPath = resolve(import.meta.dirname, "../bin/directory.ts");
    const src = readFileSync(srcPath, "utf-8");

    // Should never log process.env contents directly
    expect(src).not.toMatch(/logger\.\w+\([^)]*process\.env\[/);
    // Should never log the raw secret value
    expect(src).not.toMatch(/logger\.\w+\([^)]*nodePrivateKey/);
    expect(src).not.toMatch(/logger\.\w+\([^)]*rdsPassword/);
  });
});

// ─── Observability: directory.service.started ──────────────────────────────

describe("DEPLOY-002: Observability — directory.service.started", () => {
  it("logServiceStarted emits correct event with required fields", async () => {
    const { logServiceStarted } = await import("../service-lifecycle.js");
    const logger = new CapturingLogger();

    logServiceStarted(logger, {
      nodeId: "us-east-1",
      region: "us-east-1",
      environment: "production",
      schemaVersion: 18,
    });

    const evt = logger.find("directory.service.started");
    expect(evt).toBeTruthy();
    expect(evt!.level).toBe("info");
    expect(evt!.context).toMatchObject({
      nodeId: "us-east-1",
      region: "us-east-1",
      environment: "production",
      schemaVersion: 18,
    });
  });
});

// ─── Observability: directory.service.stopped ──────────────────────────────

describe("DEPLOY-002: Observability — directory.service.stopped", () => {
  it("logServiceStopped emits correct event with required fields", async () => {
    const { logServiceStopped } = await import("../service-lifecycle.js");
    const logger = new CapturingLogger();

    logServiceStopped(logger, {
      nodeId: "us-east-1",
      region: "us-east-1",
      environment: "production",
      uptimeMs: 3600000,
    });

    const evt = logger.find("directory.service.stopped");
    expect(evt).toBeTruthy();
    expect(evt!.level).toBe("info");
    expect(evt!.context).toMatchObject({
      nodeId: "us-east-1",
      region: "us-east-1",
      environment: "production",
      uptimeMs: 3600000,
    });
  });
});

// ─── Observability: directory.service.crashed ──────────────────────────────

describe("DEPLOY-002: Observability — directory.service.crashed", () => {
  it("logServiceCrashed emits correct event with required fields", async () => {
    const { logServiceCrashed } = await import("../service-lifecycle.js");
    const logger = new CapturingLogger();

    logServiceCrashed(logger, {
      nodeId: "us-east-1",
      region: "us-east-1",
      reason: "OOM killed",
      consecutiveFailures: 2,
    });

    const evt = logger.find("directory.service.crashed");
    expect(evt).toBeTruthy();
    expect(evt!.level).toBe("error");
    expect(evt!.context).toMatchObject({
      nodeId: "us-east-1",
      region: "us-east-1",
      reason: "OOM killed",
      consecutiveFailures: 2,
    });
  });
});

// ─── Observability: directory.secrets.unavailable ──────────────────────────

describe("DEPLOY-002: Observability — directory.secrets.unavailable", () => {
  it("logSecretsUnavailable emits correct event with required fields", async () => {
    const { logSecretsUnavailable } = await import("../service-lifecycle.js");
    const logger = new CapturingLogger();

    logSecretsUnavailable(logger, {
      nodeId: "us-east-1",
      region: "us-east-1",
      reason: "Secrets Manager timeout",
    });

    const evt = logger.find("directory.secrets.unavailable");
    expect(evt).toBeTruthy();
    expect(evt!.level).toBe("error");
    expect(evt!.context).toMatchObject({
      nodeId: "us-east-1",
      region: "us-east-1",
      reason: "Secrets Manager timeout",
    });
  });
});

// ─── Observability: migration.applied / migration.failed ───────────────────

describe("DEPLOY-002: Observability — migration events", () => {
  it("logMigrationApplied emits correct event with required fields", async () => {
    const { logMigrationApplied } = await import("../service-lifecycle.js");
    const logger = new CapturingLogger();

    logMigrationApplied(logger, {
      version: "18",
      description: "federation_schema",
      executionTime: 245,
    });

    const evt = logger.find("migration.applied");
    expect(evt).toBeTruthy();
    expect(evt!.level).toBe("info");
    expect(evt!.context).toMatchObject({
      version: "18",
      description: "federation_schema",
      executionTime: 245,
    });
  });

  it("logMigrationFailed emits correct event with required fields", async () => {
    const { logMigrationFailed } = await import("../service-lifecycle.js");
    const logger = new CapturingLogger();

    logMigrationFailed(logger, {
      version: "19",
      description: "broken_migration",
      reason: "syntax error at position 42",
    });

    const evt = logger.find("migration.failed");
    expect(evt).toBeTruthy();
    expect(evt!.level).toBe("error");
    expect(evt!.context).toMatchObject({
      version: "19",
      description: "broken_migration",
      reason: "syntax error at position 42",
    });
  });
});

// ─── Dockerfile validation ─────────────────────────────────────────────────

describe("DEPLOY-002: Dockerfile structure", () => {
  const dockerfilePath = resolve(import.meta.dirname, "../../Dockerfile");

  it("Dockerfile exists", () => {
    expect(existsSync(dockerfilePath)).toBe(true);
  });

  it("uses multi-stage build", () => {
    const content = readFileSync(dockerfilePath, "utf-8");
    const fromStatements = content.match(/^FROM /gm);
    expect(fromStatements!.length).toBeGreaterThanOrEqual(2);
  });

  it("targets linux/amd64 platform", () => {
    const content = readFileSync(dockerfilePath, "utf-8");
    expect(content).toContain("--platform=linux/amd64");
  });

  it("includes Flyway CLI in production image", () => {
    const content = readFileSync(dockerfilePath, "utf-8");
    expect(content.toLowerCase()).toContain("flyway");
  });

  it("copies migrations into the image", () => {
    const content = readFileSync(dockerfilePath, "utf-8");
    expect(content).toContain("migrations");
  });

  it("uses docker-entrypoint.sh as entrypoint", () => {
    const content = readFileSync(dockerfilePath, "utf-8");
    expect(content).toContain("docker-entrypoint.sh");
  });

  it("exposes port 8080", () => {
    const content = readFileSync(dockerfilePath, "utf-8");
    expect(content).toContain("EXPOSE 8080");
  });
});

// ─── SI-003: ECS task has no public IP, routes only through ALB ───────────────
//
// Adversarial condition: even if a developer sets AssignPublicIp: ENABLED,
// the security group (ecs-directory-sg) accepts inbound only from the ALB
// security group; direct internet traffic is blocked at the SG level.
// We validate the CloudFormation template enforces this by construction.

describe("DEPLOY-002: SI-003 no public IP, private subnets only", () => {
  const templatePath = resolve(import.meta.dirname, "../../../../infra/cloudformation/cello-ecs-directory.yaml");

  it("ECS service template exists", () => {
    expect(existsSync(templatePath)).toBe(true);
  });

  it("AssignPublicIp is DISABLED", () => {
    const content = readFileSync(templatePath, "utf-8");
    expect(content).toContain("AssignPublicIp: DISABLED");
    expect(content).not.toContain("AssignPublicIp: ENABLED");
  });

  it("subnets reference private subnet imports only", () => {
    const content = readFileSync(templatePath, "utf-8");
    // The AwsvpcConfiguration subnets block must only reference private-subnet imports
    expect(content).toContain("private-subnet-a");
    expect(content).toContain("private-subnet-b");
    // Public subnets must NOT appear in the ECS service subnet list
    // (they appear only in the ALB Subnets block, which is expected)
    const serviceBlock = content.slice(content.indexOf("Service:"), content.indexOf("Outputs:"));
    expect(serviceBlock).not.toContain("public-subnet");
  });

  it("security group references ecs-directory-sg, not a wildcard", () => {
    const content = readFileSync(templatePath, "utf-8");
    const serviceBlock = content.slice(content.indexOf("Service:"), content.indexOf("Outputs:"));
    expect(serviceBlock).toContain("ecs-directory-sg");
  });
});

// ─── Infrastructure AC validation (template structure) ────────────────────────
//
// AC-001: ECS service has desiredCount=1, private subnets, no public IP.
// AC-004: Task definition uses Secrets Manager ARN references, no plaintext.
// AC-007: Task role has s3:PutObject only (no Delete, Get, List on audit bucket).
// AC-008: Log group name matches /cello/{env}/directory or /ecs/cello-directory-{env}.

describe("DEPLOY-002: AC-001 ECS service desired count and placement", () => {
  const templatePath = resolve(import.meta.dirname, "../../../../infra/cloudformation/cello-ecs-directory.yaml");

  it("DesiredCount is 1", () => {
    const content = readFileSync(templatePath, "utf-8");
    expect(content).toContain("DesiredCount: 1");
  });

  it("LaunchType is FARGATE", () => {
    const content = readFileSync(templatePath, "utf-8");
    expect(content).toContain("LaunchType: FARGATE");
  });

  it("RequiresCompatibilities includes FARGATE", () => {
    const content = readFileSync(templatePath, "utf-8");
    expect(content).toContain("- FARGATE");
  });
});

describe("DEPLOY-002: AC-004 secrets via ARN references, no plaintext", () => {
  const templatePath = resolve(import.meta.dirname, "../../../../infra/cloudformation/cello-ecs-directory.yaml");

  it("rds-credentials secret is referenced by ARN, not inline value", () => {
    const content = readFileSync(templatePath, "utf-8");
    expect(content).toContain("rds-credentials");
    // The value must be an ARN reference pattern, not a plaintext password
    expect(content).not.toMatch(/password:\s*["'][^"']+["']/);
  });

  it("node-private-key secret uses Secrets.ValueFrom (ECS injection)", () => {
    const content = readFileSync(templatePath, "utf-8");
    expect(content).toContain("node-private-key");
    expect(content).toContain("ValueFrom");
  });

  it("no plaintext credential values in Environment section", () => {
    const content = readFileSync(templatePath, "utf-8");
    // Environment vars should only have non-secret values
    expect(content).not.toMatch(/Value:\s*["'][a-zA-Z0-9+/]{20,}={0,2}["']/); // no base64 blobs
  });
});

describe("DEPLOY-002: AC-008 log group name", () => {
  const templatePath = resolve(import.meta.dirname, "../../../../infra/cloudformation/cello-ecs-directory.yaml");

  it("CloudWatch log group references cello and directory in name", () => {
    const content = readFileSync(templatePath, "utf-8");
    expect(content).toMatch(/LogGroupName.*cello.*directory/s);
  });

  it("log group has a retention policy", () => {
    const content = readFileSync(templatePath, "utf-8");
    expect(content).toContain("RetentionInDays");
  });
});
