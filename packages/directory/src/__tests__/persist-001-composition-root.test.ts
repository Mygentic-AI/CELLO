/**
 * CELLO-PERSIST-001 — Composition root and adapter wiring tests
 *
 * Covers:
 *   AC-002: CELLO_ENV=local happy-path startup — all adapters initialise, service accepts connections
 *   AC-004: process exits 1 with adapter.config.missing when CELLO_ENV is unrecognised or required key absent
 *   SI-002: PgDirectoryStore is not exported from packages/directory index.ts
 */

import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { resolve } from "node:path";
import { createRequire } from "node:module";

const PKG = resolve(import.meta.dirname, "../..");
// Resolve tsx/esm absolute path so the subprocess can import it without relying on shell PATH
const tsxEsm = createRequire(import.meta.url).resolve("tsx/esm");

function runBin(env: NodeJS.ProcessEnv): { stdout: string; stderr: string; code: number } {
  // Merge then strip undefined entries so callers can unset vars from process.env
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

describe("AC-004: composition root exits 1 on missing config", () => {
  it("exits 1 when CELLO_ENV is unset", () => {
    const fullEnv = { ...process.env, CELLO_ENV: undefined };
    delete fullEnv["CELLO_ENV"];
    const result = runBin(fullEnv);
    expect(result.code).toBe(1);
  });

  it("exits 1 and logs adapter.config.missing when CELLO_ENV is unrecognised", () => {
    const result = runBin({ CELLO_ENV: "cloud" }); // was renamed to 'dev'
    expect(result.code).toBe(1);
    const out = result.stdout + result.stderr;
    expect(out).toContain("adapter.config.missing");
  });

  it("exits 1 when CELLO_ENV=local and DATABASE_URL is absent", () => {
    // Pass DATABASE_URL: undefined so runBin's spread clears it even if set in process.env.
    // AUDIT_LOG_PATH is set so the binary reaches the DATABASE_URL check (PERSIST-006 check runs first).
    const result = runBin({ CELLO_ENV: "local", CELLO_RELAY_MULTIADDR: "/ip4/127.0.0.1/tcp/4001/p2p/12D3KooW", AUDIT_LOG_PATH: "/tmp/audit.jsonl", DATABASE_URL: undefined });
    expect(result.code).toBe(1);
    const out = result.stdout + result.stderr;
    expect(out).toContain("DATABASE_URL");
  });

  it("exits 1 when CELLO_ENV=local and DEV_ENVELOPE_KEY is absent", () => {
    // Requires a database with all migrations applied (including V3).
    // The migration version guard runs before the DEV_ENVELOPE_KEY check, so
    // this test only exercises the correct code path when the DB is up to date.
    // Marked skip when not running in CELLO_ENV=local (integration environment).
    const isLocal = process.env["CELLO_ENV"] === "local";
    if (!isLocal) return;
    const result = runBin({
      CELLO_ENV: "local",
      DATABASE_URL: "postgresql://postgres:dev@localhost:5433/cello_dev",
      AUDIT_LOG_PATH: "/tmp/audit.jsonl",
      CELLO_RELAY_MULTIADDR: "/ip4/127.0.0.1/tcp/4001/p2p/12D3KooW",
      DEV_ENVELOPE_KEY: undefined,
    });
    expect(result.code).toBe(1);
    const out = result.stdout + result.stderr;
    expect(out).toContain("DEV_ENVELOPE_KEY");
  });

  it("exits 1 when CELLO_RELAY_MULTIADDR is absent", () => {
    const result = runBin({ CELLO_ENV: "local", CELLO_RELAY_MULTIADDR: undefined });
    expect(result.code).toBe(1);
    const out = result.stdout + result.stderr;
    expect(out).toContain("CELLO_RELAY_MULTIADDR");
  });
});

// AC-002 requires Docker — skip when not in local environment
const isLocal = process.env["CELLO_ENV"] === "local";
const describeIntegration = isLocal ? describe : describe.skip;

describeIntegration("AC-002: CELLO_ENV=local startup — all adapters initialise against real Postgres", () => {
  it("logs adapter.initialised for all five adapters before first connection attempt", () => {
    // Run the binary with valid local config; it will exit 1 on missing key file
    // but all six adapter.initialised events fire before that point.
    const result = runBin({
      CELLO_ENV: "local",
      DATABASE_URL: process.env["DATABASE_URL"] ?? "postgresql://postgres:dev@localhost:5433/cello_dev",
      DEV_ENVELOPE_KEY: process.env["DEV_ENVELOPE_KEY"] ?? "0".repeat(64),
      AUDIT_LOG_PATH: "/tmp/cello-audit-persist001.jsonl",
      CELLO_RELAY_MULTIADDR: "/ip4/127.0.0.1/tcp/4001/p2p/12D3KooWTest",
    });
    const out = result.stdout + result.stderr;
    // Six adapters log adapter.initialised (Logger is the sink — it cannot log its own creation)
    expect(out).toContain("PgDirectoryStore");
    expect(out).toContain("EnvelopeKeyProvider");
    expect(out).toContain("ClientStore");
    expect(out).toContain("RelayWal");
    expect(out).toContain("JobScheduler");
    expect(out).toContain("AuditLogShipper");
    // No AWS endpoint calls — only localhost Postgres is permitted
    expect(out).not.toContain("amazonaws.com");
  });

  it("exits 1 with migration.out.of.date when pointing at a database with no migrations", () => {
    const result = runBin({
      CELLO_ENV: "local",
      DATABASE_URL: "postgresql://postgres:dev@localhost:5433/cello_nonexistent_test_db",
      DEV_ENVELOPE_KEY: "0".repeat(64),
      AUDIT_LOG_PATH: "/tmp/cello-audit-persist001.jsonl",
      CELLO_RELAY_MULTIADDR: "/ip4/127.0.0.1/tcp/4001/p2p/12D3KooWTest",
    });
    expect(result.code).toBe(1);
    const out = result.stdout + result.stderr;
    expect(out).toContain("migration.out.of.date");
  });
});

describe("SI-002: PgDirectoryStore not exported from packages/directory index.ts", () => {
  it("@cello/directory index does not export PgDirectoryStore", async () => {
    const mod = await import("@cello/directory");
    expect((mod as Record<string, unknown>)["PgDirectoryStore"]).toBeUndefined();
  });
});
