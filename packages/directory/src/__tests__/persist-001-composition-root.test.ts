/**
 * CELLO-PERSIST-001 — Composition root and adapter wiring tests
 *
 * Covers:
 *   AC-002: CELLO_ENV=local happy-path startup — all adapters initialise, service accepts connections
 *   AC-004: process exits 1 with adapter.config.missing when CELLO_ENV is unrecognised or required key absent
 *   SI-002: PgDirectoryStore is not exported from packages/directory index.ts
 */

import { describe, it, expect, afterAll } from "vitest";
import { execSync } from "node:child_process";
import { resolve, join } from "node:path";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import pg from "pg";

/** Throwaway database created and dropped by the migration-guard test. */
const EMPTY_DB = "cello_nomigrations_persist001";

const PKG = resolve(import.meta.dirname, "../..");
// Resolve tsx/esm absolute path so the subprocess can import it without relying on shell PATH
const tsxEsm = createRequire(import.meta.url).resolve("tsx/esm");

// Postgres coordinates come from DATABASE_URL when present so the suite runs against whichever
// instance this checkout brought up — a second worktree cannot bind the same port, so hardcoding
// one silently pointed these tests at the OTHER checkout's database.
const PG_URL = process.env["DATABASE_URL"] ?? "postgresql://postgres:dev@localhost:5433/cello_dev";
/** Same server, different database name. */
function pgUrlFor(dbName: string): string {
  return PG_URL.replace(/\/[^/?]+(\?|$)/, `/${dbName}$1`);
}

// Track temp directories for cleanup
const tempDirs: string[] = [];

afterAll(async () => {
  for (const dir of tempDirs) {
    await rm(dir, { recursive: true, force: true });
  }
});

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
      // Generous on purpose. This spawns a real node that opens a pool, probes the server and
      // reads the migration history — and sibling test files in the same run create and drop
      // databases on that server. At 5s one case measured 5014ms and was killed, turning a
      // correct refusal into a timeout that looked like a logic failure.
      timeout: 30_000,
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

  it("exits 1 when CELLO_ENV=local and DATABASE_URL is absent", async () => {
    // Pass DATABASE_URL: undefined so runBin's spread clears it even if set in process.env.
    // AUDIT_LOG_PATH is set so the binary reaches the DATABASE_URL check (PERSIST-006 check runs first).
    const dir = await mkdtemp(join(tmpdir(), "cello-test-"));
    tempDirs.push(dir);
    const auditPath = join(dir, "audit.jsonl");
    const result = runBin({ CELLO_ENV: "local", CELLO_RELAY_MULTIADDR: "/ip4/127.0.0.1/tcp/4001/p2p/12D3KooW", AUDIT_LOG_PATH: auditPath, DATABASE_URL: undefined });
    expect(result.code).toBe(1);
    const out = result.stdout + result.stderr;
    expect(out).toContain("DATABASE_URL");
  });

  it("exits 1 when CELLO_ENV=local and DEV_ENVELOPE_KEY is absent", async () => {
    // Requires a database with all migrations applied (including V3).
    // The migration version guard runs before the DEV_ENVELOPE_KEY check, so
    // this test only exercises the correct code path when the DB is up to date.
    // Marked skip when not running in CELLO_ENV=local (integration environment).
    const isLocal = process.env["CELLO_ENV"] === "local";
    if (!isLocal) return;
    const dir = await mkdtemp(join(tmpdir(), "cello-test-"));
    tempDirs.push(dir);
    const auditPath = join(dir, "audit.jsonl");
    const result = runBin({
      CELLO_ENV: "local",
      DATABASE_URL: "postgresql://postgres:dev@localhost:5433/cello_dev",
      AUDIT_LOG_PATH: auditPath,
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
  it("logs adapter.initialised for all five adapters before first connection attempt", async () => {
    // Run the binary with valid local config; it will exit 1 on missing key file
    // but all six adapter.initialised events fire before that point.
    const dir = await mkdtemp(join(tmpdir(), "cello-test-"));
    tempDirs.push(dir);
    const auditPath = join(dir, "audit.jsonl");
    const result = runBin({
      CELLO_ENV: "local",
      DATABASE_URL: process.env["DATABASE_URL"] ?? "postgresql://postgres:dev@localhost:5433/cello_dev",
      DEV_ENVELOPE_KEY: process.env["DEV_ENVELOPE_KEY"] ?? "0".repeat(64),
      AUDIT_LOG_PATH: auditPath,
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

  // M12 DOD-INV-NODEID: every node is born `<cloud>-<region>` and is NEVER renamed — NODE_ID feeds
  // Identifier.derive(), so it is the FROST participant identifier, not a label. A node that
  // guessed one would sign frames and register shares under it permanently.
  it("REFUSES to start on a non-AWS cloud when NODE_ID is unset, rather than guessing one", () => {
    const result = runBin({
      CELLO_ENV: "dev",
      CELLO_CLOUD: "gcp",
      CELLO_REGION: "us-central1",
      NODE_ID: undefined,
    });
    expect(result.code).toBe(1);
    const out = result.stdout + result.stderr;
    expect(out).toContain("adapter.config.missing");
    expect(out).toContain("NODE_ID");
    // Specifically: it must not have quietly adopted the bare region as its identity.
    expect(out).not.toContain('"nodeId":"us-central1"');
  });

  it("still derives NODE_ID from the region on AWS — nodes already registered under it must not break", () => {
    // The legacy default is back-compat, not a pattern. Reaching the DATABASE_URL/RDS check proves
    // the NODE_ID guard did not fire.
    const result = runBin({
      CELLO_ENV: "dev",
      AWS_REGION: "eu-central-1",
      NODE_ID: undefined,
      CELLO_CLOUD: undefined,
    });
    expect(result.code).toBe(1); // no AWS credentials here — but for a LATER reason
    const out = result.stdout + result.stderr;
    expect(out).not.toContain('"missingKey":"NODE_ID"');
  });

  it("exits 1 with migration.out.of.date when pointing at a database with no migrations", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cello-test-"));
    tempDirs.push(dir);
    const auditPath = join(dir, "audit.jsonl");

    // A database that EXISTS but has never been migrated — which is what this test claims to
    // cover. Pointing at a database that does not exist tests the connection failure instead,
    // and the two have different causes and different correct events (see the next test).
    const admin = new pg.Pool({ connectionString: pgUrlFor("postgres") });
    try {
      await admin.query(`DROP DATABASE IF EXISTS ${EMPTY_DB}`);
      await admin.query(`CREATE DATABASE ${EMPTY_DB}`);
    } finally {
      await admin.end();
    }

    try {
      const result = runBin({
        CELLO_ENV: "local",
        DATABASE_URL: pgUrlFor(EMPTY_DB),
        DEV_ENVELOPE_KEY: "0".repeat(64),
        AUDIT_LOG_PATH: auditPath,
        CELLO_RELAY_MULTIADDR: "/ip4/127.0.0.1/tcp/4001/p2p/12D3KooWTest",
      });
      expect(result.code).toBe(1);
      const out = result.stdout + result.stderr;
      expect(out).toContain("migration.out.of.date");
    } finally {
      const cleanup = new pg.Pool({ connectionString: pgUrlFor("postgres") });
      await cleanup.query(`DROP DATABASE IF EXISTS ${EMPTY_DB}`).catch(() => { /* best effort */ });
      await cleanup.end();
    }
  });

  // M12 DOD-NODE-DIR-GCP-1: a node whose database is unreachable must say SO. It previously died
  // on an unhandled rejection from loadProfiles(), dumping a pg-pool stack with no CELLO event —
  // on a cloud VM that lands in a serial console as an unattributable crash, and it is the single
  // most likely first-boot failure against a freshly created managed database (wrong host, wrong
  // password, missing network grant).
  it("exits 1 with a NAMED directory.db.unavailable — not a raw pg stack — when the database is unreachable", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cello-test-"));
    tempDirs.push(dir);
    const auditPath = join(dir, "audit.jsonl");
    const result = runBin({
      CELLO_ENV: "local",
      DATABASE_URL: pgUrlFor("cello_absent_db_persist001"),
      DEV_ENVELOPE_KEY: "0".repeat(64),
      AUDIT_LOG_PATH: auditPath,
      CELLO_RELAY_MULTIADDR: "/ip4/127.0.0.1/tcp/4001/p2p/12D3KooWTest",
    });
    expect(result.code).toBe(1);
    const out = result.stdout + result.stderr;
    // Names the cause…
    expect(out).toContain("directory.db.unavailable");
    expect(out).toContain("cello_absent_db_persist001");
    // …and does not leak the credentials it was handed.
    expect(out).not.toContain("dev@");
    // …and is not an unhandled rejection.
    expect(out).not.toContain("pg-pool/index.js");
    expect(out).not.toContain("Error.captureStackTrace");
  });
});

describe("SI-002: PgDirectoryStore not exported from packages/directory index.ts", () => {
  it("@cello-protocol/directory index does not export PgDirectoryStore", async () => {
    const mod = await import("@cello-protocol/directory");
    expect((mod as Record<string, unknown>)["PgDirectoryStore"]).toBeUndefined();
  });
});
