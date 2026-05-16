/**
 * CELLO-PERSIST-001 — Composition root and adapter wiring tests
 *
 * Covers:
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
    // Pass DATABASE_URL: undefined so runBin's spread clears it even if set in process.env
    const result = runBin({ CELLO_ENV: "local", CELLO_RELAY_MULTIADDR: "/ip4/127.0.0.1/tcp/4001/p2p/12D3KooW", DATABASE_URL: undefined });
    expect(result.code).toBe(1);
    const out = result.stdout + result.stderr;
    expect(out).toContain("DATABASE_URL");
  });

  it("exits 1 when CELLO_ENV=local and DEV_ENVELOPE_KEY is absent", () => {
    const result = runBin({
      CELLO_ENV: "local",
      DATABASE_URL: "postgresql://postgres:dev@localhost:5433/cello_dev",
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

describe("SI-002: PgDirectoryStore not exported from packages/directory index.ts", () => {
  it("@cello/directory index does not export PgDirectoryStore", async () => {
    const mod = await import("@cello/directory");
    expect((mod as Record<string, unknown>)["PgDirectoryStore"]).toBeUndefined();
  });
});
