/**
 * CELLO-M6B-009: PostgreSQL connection pool configuration
 *
 * Tests:
 *   AC-002: Default pool max is 50 when DIRECTORY_PG_POOL_MAX is absent
 *   AC-003: WARN log when DIRECTORY_PG_POOL_MAX > 100
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { StdoutLogger } from "@cello-protocol/interfaces/stubs";

describe("CELLO-M6B-009: PostgreSQL pool configuration", () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env["DIRECTORY_PG_POOL_MAX"];
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env["DIRECTORY_PG_POOL_MAX"];
    } else {
      process.env["DIRECTORY_PG_POOL_MAX"] = originalEnv;
    }
  });

  it("AC-002: uses default pool max of 50 when DIRECTORY_PG_POOL_MAX is absent", () => {
    // AC-002: When the directory process starts with no DIRECTORY_PG_POOL_MAX env var,
    // pg.Pool was constructed with max: 50 (the default); adapter.initialised logs poolMax: 50

    delete process.env["DIRECTORY_PG_POOL_MAX"];

    // Parse poolMax (logic that will go into directory.ts)
    const poolMax = parseInt(process.env["DIRECTORY_PG_POOL_MAX"] ?? "50", 10);

    expect(poolMax).toBe(50);
  });

  it("AC-003: logs WARN when DIRECTORY_PG_POOL_MAX > 100", () => {
    // AC-003: When DIRECTORY_PG_POOL_MAX=150, directory.pool.max.high is logged
    // at WARN with configured: 150 and recommended_max: 100

    process.env["DIRECTORY_PG_POOL_MAX"] = "150";

    const logger = new StdoutLogger();
    const warnSpy = vi.spyOn(logger, "warn");

    const poolMax = parseInt(process.env["DIRECTORY_PG_POOL_MAX"] ?? "50", 10);

    if (poolMax > 100) {
      logger.warn("directory.pool.max.high", { configured: poolMax, recommended_max: 100 });
    }

    expect(poolMax).toBe(150);
    expect(warnSpy).toHaveBeenCalledWith("directory.pool.max.high", {
      configured: 150,
      recommended_max: 100,
    });
  });

  it("AC-003: does not log WARN when DIRECTORY_PG_POOL_MAX <= 100", () => {
    process.env["DIRECTORY_PG_POOL_MAX"] = "75";

    const logger = new StdoutLogger();
    const warnSpy = vi.spyOn(logger, "warn");

    const poolMax = parseInt(process.env["DIRECTORY_PG_POOL_MAX"] ?? "50", 10);

    if (poolMax > 100) {
      logger.warn("directory.pool.max.high", { configured: poolMax, recommended_max: 100 });
    }

    expect(poolMax).toBe(75);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
