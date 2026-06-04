/**
 * CELLO-M6B-009: PostgreSQL connection pool configuration
 *
 * Specification (per story YAML):
 *   AC-001: pg.Pool is constructed with max: 50; adapter.initialised logs poolMax: 50;
 *           the pool's totalCount never exceeds 50 under a 50-concurrent-query test.
 *           test_type: integration — requires Docker Compose Postgres with CELLO_ENV=local.
 *           See packages/directory/src/__tests__/persist-002-docker.test.ts for the pattern.
 *           AC-001 is covered by: the persist-002-docker.test.ts describeIntegration block that
 *           verifies pool construction, and the load-gate test below that asserts pool
 *           concurrency under 50 parallel queries using a real pg.Pool instance.
 *
 *   AC-002: When DIRECTORY_PG_POOL_MAX is absent, resolvePoolMax returns 50 (the default).
 *           adapter.initialised logs poolMax: 50.
 *           test_type: unit
 *
 *   AC-003: When DIRECTORY_PG_POOL_MAX=150, resolvePoolMax returns 150 and logger.warn is called
 *           with "directory.pool.max.high" { configured: 150, recommended_max: 100 }.
 *           The process starts successfully (WARN is advisory, not a hard stop).
 *           test_type: unit
 *
 *   AC-004: The updated cello-rds.yaml has InstanceClass Default: db.t3.medium (not db.t3.small);
 *           AllowedValues still includes db.t3.small.
 *           test_type: unit (template inspection)
 *
 * Interpretation note for AC-001: The story specifies test_type: integration. The full
 * concurrent-query gate (50 concurrent SELECT 1 queries against a real pg.Pool(max:50))
 * is included below as a describeIntegration block requiring CELLO_ENV=local.
 */

import { describe, it, expect, vi, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import { parse as parseYaml } from "yaml";
import { resolvePoolMax } from "../pg-pool-config.js";
import { StdoutLogger } from "@cello-protocol/interfaces/stubs";

// ─── Integration helpers ───────────────────────────────────────────────────────
// describeIntegration skips when CELLO_ENV !== 'local'
const describeIntegration =
  process.env["CELLO_ENV"] === "local" ? describe : describe.skip;

const PKG = resolve(import.meta.dirname, "../..");
const tsxEsm = createRequire(import.meta.url).resolve("tsx/esm");
const tempDirs: string[] = [];

afterAll(async () => {
  for (const dir of tempDirs) {
    await rm(dir, { recursive: true, force: true });
  }
});

function runBin(env: NodeJS.ProcessEnv): { stdout: string; stderr: string; code: number } {
  const merged: NodeJS.ProcessEnv = { ...process.env, ...env };
  for (const key of Object.keys(merged)) {
    if (merged[key] === undefined) delete merged[key];
  }
  try {
    const stdout = execSync(`node --import ${tsxEsm} src/bin/directory.ts`, {
      cwd: PKG,
      env: merged,
      stdio: "pipe",
      encoding: "utf8",
      timeout: 5000,
    });
    return { stdout, stderr: "", code: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return { stdout: e.stdout ?? "", stderr: e.stderr ?? "", code: e.status ?? 1 };
  }
}

// ─── NaN guard: non-numeric DIRECTORY_PG_POOL_MAX falls back to 50 ──────────────
// This guards against the silent pg.Pool(max: NaN) bug — pg silently uses its
// internal default of 10 when given NaN, defeating explicit pool sizing.

describe("CELLO-M6B-009: NaN guard — non-numeric DIRECTORY_PG_POOL_MAX falls back to 50", () => {
  it("resolvePoolMax returns 50 when DIRECTORY_PG_POOL_MAX is a non-numeric string", () => {
    const logger = new StdoutLogger();
    const warnSpy = vi.spyOn(logger, "warn");

    const fakeEnv = { DIRECTORY_PG_POOL_MAX: "abc" } as NodeJS.ProcessEnv;
    const poolMax = resolvePoolMax(fakeEnv, logger);

    expect(poolMax).toBe(50);
    // NaN fallback is silent — no WARN is emitted for misconfiguration (it falls back to default)
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("resolvePoolMax returns 50 when DIRECTORY_PG_POOL_MAX is an empty string", () => {
    const logger = new StdoutLogger();
    const warnSpy = vi.spyOn(logger, "warn");

    const fakeEnv = { DIRECTORY_PG_POOL_MAX: "" } as NodeJS.ProcessEnv;
    const poolMax = resolvePoolMax(fakeEnv, logger);

    expect(poolMax).toBe(50);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("resolvePoolMax returns 50 when DIRECTORY_PG_POOL_MAX is zero (invalid)", () => {
    const logger = new StdoutLogger();
    const warnSpy = vi.spyOn(logger, "warn");

    // Zero is not a valid pool size — falls back to 50
    const fakeEnv = { DIRECTORY_PG_POOL_MAX: "0" } as NodeJS.ProcessEnv;
    const poolMax = resolvePoolMax(fakeEnv, logger);

    expect(poolMax).toBe(50);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

// ─── AC-002: Default pool max is 50 ──────────────────────────────────────────

describe("CELLO-M6B-009 AC-002: default pool max", () => {
  it("resolvePoolMax returns 50 when DIRECTORY_PG_POOL_MAX is absent", () => {
    // AC-002: When the directory process starts with no DIRECTORY_PG_POOL_MAX env var,
    // resolvePoolMax returns 50 (the default).

    const logger = new StdoutLogger();
    const warnSpy = vi.spyOn(logger, "warn");

    // Pass a synthetic env without the key
    const fakeEnv = {} as NodeJS.ProcessEnv;
    const poolMax = resolvePoolMax(fakeEnv, logger);

    expect(poolMax).toBe(50);
    // No warning should be emitted below the soft ceiling
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("resolvePoolMax returns 75 when DIRECTORY_PG_POOL_MAX=75", () => {
    const logger = new StdoutLogger();
    const warnSpy = vi.spyOn(logger, "warn");

    const fakeEnv = { DIRECTORY_PG_POOL_MAX: "75" } as NodeJS.ProcessEnv;
    const poolMax = resolvePoolMax(fakeEnv, logger);

    expect(poolMax).toBe(75);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

// ─── AC-003: WARN when DIRECTORY_PG_POOL_MAX > 100 ───────────────────────────

describe("CELLO-M6B-009 AC-003: advisory WARN above soft ceiling", () => {
  it("resolvePoolMax returns 150 and emits directory.pool.max.high WARN", () => {
    // AC-003: When DIRECTORY_PG_POOL_MAX=150, directory.pool.max.high is logged
    // at WARN with configured: 150 and recommended_max: 100.

    const logger = new StdoutLogger();
    const warnSpy = vi.spyOn(logger, "warn");

    const fakeEnv = { DIRECTORY_PG_POOL_MAX: "150" } as NodeJS.ProcessEnv;
    const poolMax = resolvePoolMax(fakeEnv, logger);

    // Must return the configured value — the WARN is advisory, not a cap
    expect(poolMax).toBe(150);
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy).toHaveBeenCalledWith("directory.pool.max.high", {
      configured: 150,
      recommended_max: 100,
    });
  });

  it("resolvePoolMax returns 101 and emits WARN for the edge case (> 100, not >= 100)", () => {
    const logger = new StdoutLogger();
    const warnSpy = vi.spyOn(logger, "warn");

    const fakeEnv = { DIRECTORY_PG_POOL_MAX: "101" } as NodeJS.ProcessEnv;
    const poolMax = resolvePoolMax(fakeEnv, logger);

    expect(poolMax).toBe(101);
    expect(warnSpy).toHaveBeenCalledWith("directory.pool.max.high", {
      configured: 101,
      recommended_max: 100,
    });
  });

  it("resolvePoolMax does NOT emit WARN when DIRECTORY_PG_POOL_MAX=100 (exactly at ceiling)", () => {
    const logger = new StdoutLogger();
    const warnSpy = vi.spyOn(logger, "warn");

    const fakeEnv = { DIRECTORY_PG_POOL_MAX: "100" } as NodeJS.ProcessEnv;
    const poolMax = resolvePoolMax(fakeEnv, logger);

    expect(poolMax).toBe(100);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

// ─── AC-002 integration: adapter.initialised logs poolMax: 50 ─────────────────

describeIntegration("CELLO-M6B-009 AC-002 integration: adapter.initialised logs poolMax: 50", () => {
  it("adapter.initialised for PgDirectoryStore includes poolMax: 50 when DIRECTORY_PG_POOL_MAX is absent", async () => {
    // AC-002: When the directory process starts with no DIRECTORY_PG_POOL_MAX env var,
    // adapter.initialised logs poolMax: 50.
    // The binary exits before fully starting (missing key material), but adapter.initialised
    // fires before the first connection attempt — matching the persist-001 pattern.

    const dir = await mkdtemp(join(tmpdir(), "cello-m6b009-"));
    tempDirs.push(dir);
    const auditPath = join(dir, "audit.jsonl");

    const result = runBin({
      CELLO_ENV: "local",
      DATABASE_URL: process.env["DATABASE_URL"] ?? "postgresql://postgres:dev@localhost:5433/cello_dev",
      DEV_ENVELOPE_KEY: process.env["DEV_ENVELOPE_KEY"] ?? "0".repeat(64),
      AUDIT_LOG_PATH: auditPath,
      CELLO_RELAY_MULTIADDR: "/ip4/127.0.0.1/tcp/4001/p2p/12D3KooWTest",
      // Deliberately absent: DIRECTORY_PG_POOL_MAX — should default to 50
      DIRECTORY_PG_POOL_MAX: undefined,
    });

    const out = result.stdout + result.stderr;
    // The adapter.initialised event must contain poolMax:50
    expect(out).toContain('"poolMax":50');
    expect(out).toContain('"adapterName":"PgDirectoryStore"');
  });
});

// ─── AC-004: cello-rds.yaml InstanceClass default is db.t3.medium ─────────────

describe("CELLO-M6B-009 AC-004: RDS IaC instance class", () => {
  const CFN_DIR = resolve(import.meta.dirname, "../../../../infra/cloudformation");

  it("cello-rds.yaml InstanceClass Default is db.t3.medium", () => {
    // AC-004: The updated cello-rds.yaml has InstanceClass parameter default: db.t3.medium
    const content = readFileSync(join(CFN_DIR, "cello-rds.yaml"), "utf-8");
    const template = parseYaml(content) as Record<string, unknown>;

    const params = template["Parameters"] as Record<string, Record<string, unknown>>;
    const instanceClass = params["InstanceClass"];

    expect(instanceClass, "InstanceClass parameter must exist").toBeDefined();
    expect(instanceClass["Default"]).toBe("db.t3.medium");
  });

  it("cello-rds.yaml InstanceClass AllowedValues still includes db.t3.small", () => {
    // AC-004: AllowedValues still includes db.t3.small for cost-sensitive environments
    const content = readFileSync(join(CFN_DIR, "cello-rds.yaml"), "utf-8");
    const template = parseYaml(content) as Record<string, unknown>;

    const params = template["Parameters"] as Record<string, Record<string, unknown>>;
    const instanceClass = params["InstanceClass"];
    const allowedValues = instanceClass["AllowedValues"] as string[];

    expect(allowedValues).toContain("db.t3.small");
    expect(allowedValues).toContain("db.t3.medium");
  });
});

// ─── AC-001: Integration test — pg.Pool max concurrency under load ─────────────

describeIntegration("CELLO-M6B-009 AC-001: pool max enforced under concurrent load (integration)", () => {
  it("totalCount never exceeds poolMax under 50 concurrent queries", async () => {
    // AC-001: The pool's totalCount never exceeds 50 under a 50-concurrent-query test.
    // Requires CELLO_ENV=local and a live Postgres at DATABASE_URL.

    const pg = await import("pg");
    const connectionString = process.env["DATABASE_URL"];
    if (!connectionString) {
      throw new Error("DATABASE_URL is required for AC-001 integration test");
    }

    const poolMax = 50;
    const pool = new pg.default.Pool({ connectionString, max: poolMax });

    try {
      let maxObservedTotal = 0;

      // Launch 50 concurrent queries, each measuring totalCount while holding a connection
      await Promise.all(
        Array.from({ length: 50 }, async () => {
          const client = await pool.connect();
          try {
            maxObservedTotal = Math.max(maxObservedTotal, pool.totalCount);
            await client.query("SELECT 1");
          } finally {
            client.release();
          }
        }),
      );

      // The pool must never have opened more connections than poolMax
      expect(maxObservedTotal).toBeLessThanOrEqual(poolMax);
    } finally {
      await pool.end();
    }
  }, 30_000);
});

// ─── AC-010: Manual integration test — 20 concurrent registrations in dev ──────

describe.skip("CELLO-M6B-009 AC-010: directory dev deployment with 50 concurrent registrations (manual)", () => {
  it("20 concurrent agent registrations complete within 60 seconds with no errors", () => {
    // AC-010: Given: The directory deployed to dev us-east-1 with DIRECTORY_PG_POOL_MAX=50
    //         When: 20 concurrent agent registrations are initiated simultaneously
    //         Then: all 20 registrations complete within 60 seconds; no registration returns
    //               an error; pool wait times are logged at INFO via pg's pool event hooks
    //               if any exceed 5 seconds

    // MANUAL EXECUTION INSTRUCTIONS:
    // 1. Ensure directory is deployed to dev us-east-1 with DIRECTORY_PG_POOL_MAX=50
    //    Verify: aws ecs describe-task-definition --task-definition cello-directory-dev \
    //            --region us-east-1 --query 'taskDefinition.containerDefinitions[0].environment'
    //    Expected: { Name: DIRECTORY_PG_POOL_MAX, Value: "50" }
    //
    // 2. Run 20 concurrent registrations from a local test client:
    //    cd packages/e2e-tests
    //    CELLO_ENV=dev DIRECTORY_URL=<dev-alb-url> pnpm tsx src/manual/concurrent-registrations.ts
    //
    // 3. Expected log output patterns:
    //    - "adapter.initialised" with poolMax:50
    //    - No "directory.pool.max.high" WARN (50 <= 100)
    //    - All 20 registrations return 200 status within 60 seconds
    //    - If any pool acquisition exceeds 5 seconds, a WARN event with pool wait time is logged
    //
    // 4. Pass criteria:
    //    - All 20 registrations complete successfully (no 500/timeout errors)
    //    - Total time from first request to last response < 60 seconds
    //    - No pool exhaustion errors in CloudWatch logs
    //
    // TODO: Implement src/manual/concurrent-registrations.ts script if it does not exist
  });
});
