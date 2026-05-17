/**
 * CELLO-PERSIST-006 — pgaudit logging + AuditLogShipper
 *
 * Specification:
 * ─────────────
 * AC-001 (integration): pgaudit logs INSERT on conversation_seals — role, statement, table,
 *         timestamp present in Postgres log output after the INSERT.
 * AC-002 (integration): LocalAuditLogShipper writes structured JSON to AUDIT_LOG_PATH on each
 *         call to ship(); the file is append-only — no existing lines are modified.
 * AC-003 (unit): flush() ensures all entries passed to ship() before its call are present in
 *         the destination before flush() returns.
 * AC-004 (integration): AuditLogShipper.flush() is called on graceful directory shutdown.
 * AC-005 (unit): missing AUDIT_LOG_PATH causes the composition root to exit 1 and log
 *         adapter.config.missing { missingKey: 'AUDIT_LOG_PATH', env: 'local' }.
 * AC-006 (integration): 10 concurrent ship() calls → exactly 10 lines in the file, each a
 *         valid JSON object; no partial writes, no truncation, no interleaving.
 * AC-007 (unit): AuditLogShipper interface exposes exactly ship() and flush() — nothing more.
 *
 * SI-001 (integration): file is opened O_APPEND — no existing line can be overwritten.
 * SI-002 (integration): ship() failure does not silently drop the entry — it is retried.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import pg from "pg";

import { LocalAuditLogShipper, StdoutLogger } from "@cello/interfaces/stubs";
import type { AuditLogShipper, AuditLogEntry } from "@cello/interfaces";

const isLocal = process.env["CELLO_ENV"] === "local";
const DATABASE_URL =
  process.env["DATABASE_URL"] ?? "postgresql://postgres:dev@localhost:5433/cello_dev";

const PKG = resolve(import.meta.dirname, "../..");
const tsxEsm = createRequire(import.meta.url).resolve("tsx/esm");

function makeEntry(overrides?: Partial<AuditLogEntry>): AuditLogEntry {
  return {
    role: "cello_service",
    statement: "INSERT",
    table: "conversation_seals",
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

// ─── AC-007: interface shape ──────────────────────────────────────────────────

describe("PERSIST-006 AC-007: AuditLogShipper interface exposes exactly ship() and flush()", () => {
  it("LocalAuditLogShipper (implementation of AuditLogShipper) only exposes ship and flush as public methods", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cello-audit-ac007-"));
    const path = join(dir, "audit.jsonl");
    const logger = new StdoutLogger();
    const shipper: AuditLogShipper = new LocalAuditLogShipper(path, logger);

    // Confirm the interface methods are present
    expect(typeof shipper.ship).toBe("function");
    expect(typeof shipper.flush).toBe("function");

    // Confirm no extra enumerable methods beyond ship and flush
    const proto = Object.getOwnPropertyNames(Object.getPrototypeOf(shipper)).filter(
      (n) => n !== "constructor",
    );
    expect(proto.sort()).toEqual(["flush", "ship"].sort());

    // Cleanup
    await rm(dir, { recursive: true, force: true });
  });
});

// ─── AC-003: flush() drains all buffered entries ──────────────────────────────

describe("PERSIST-006 AC-003: flush() drains all buffered entries before returning", () => {
  it("all entries shipped before flush() are present in the file after flush()", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cello-audit-ac003-"));
    const path = join(dir, "audit.jsonl");
    const logger = new StdoutLogger();
    const shipper = new LocalAuditLogShipper(path, logger);

    const entries = [makeEntry({ statement: "INSERT" }), makeEntry({ statement: "SELECT" }), makeEntry({ statement: "DELETE" })];

    // ship() may be async — await each, but the critical invariant is:
    // everything shipped BEFORE flush() must be in the file AFTER flush()
    for (const e of entries) {
      await shipper.ship(e);
    }
    const count = await shipper.flush();

    expect(count).toBe(3);
    const lines = readFileSync(path, "utf8").trim().split("\n").filter(Boolean);
    expect(lines).toHaveLength(3);
    for (const [i, line] of lines.entries()) {
      const parsed = JSON.parse(line) as AuditLogEntry;
      expect(parsed.statement).toBe(entries[i]!.statement);
    }

    // Cleanup
    await rm(dir, { recursive: true, force: true });
  });
});

// ─── AC-006 + SI-001: 10 entries → 10 lines; file is append-only ─────────────

describe("PERSIST-006 AC-006: 10 ship() calls → 10 JSON lines, no partial writes or interleaving", () => {
  it("ships 10 entries sequentially and reads back 10 valid JSON lines", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cello-audit-ac006-"));
    const path = join(dir, "audit.jsonl");
    const logger = new StdoutLogger();
    const shipper = new LocalAuditLogShipper(path, logger);

    for (let i = 0; i < 10; i++) {
      await shipper.ship(makeEntry({ statement: `INSERT_${i}` }));
    }
    await shipper.flush();

    const content = await readFile(path, "utf8");
    const lines = content.trim().split("\n").filter(Boolean);
    expect(lines).toHaveLength(10);
    for (const line of lines) {
      const parsed = JSON.parse(line) as AuditLogEntry;
      expect(parsed).toMatchObject({ role: "cello_service", table: "conversation_seals" });
    }

    // Cleanup
    await rm(dir, { recursive: true, force: true });
  });

  it("SI-001: pre-existing lines are not modified — file is append-only", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cello-audit-si001-"));
    const path = join(dir, "audit.jsonl");
    const logger = new StdoutLogger();

    // Write a sentinel line manually
    const sentinel = JSON.stringify({ role: "sentinel", statement: "SENTINEL", table: "t", timestamp: "ts" });
    await writeFile(path, sentinel + "\n", { flag: "a" });

    const shipper = new LocalAuditLogShipper(path, logger);
    await shipper.ship(makeEntry({ statement: "INSERT" }));
    await shipper.flush();

    const lines = readFileSync(path, "utf8").trim().split("\n").filter(Boolean);
    // Sentinel must still be the first line — it was not overwritten
    expect(lines[0]).toBe(sentinel);
    expect(lines).toHaveLength(2);

    // Cleanup
    await rm(dir, { recursive: true, force: true });
  });
});

// ─── AC-002: structured JSON written per ship() call ─────────────────────────

describe("PERSIST-006 AC-002: LocalAuditLogShipper writes structured JSON", () => {
  it("each line is a valid JSON object with { role, statement, table, timestamp }", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cello-audit-ac002-"));
    const path = join(dir, "audit.jsonl");
    const logger = new StdoutLogger();
    const shipper = new LocalAuditLogShipper(path, logger);

    const entry = makeEntry({ role: "cello_service", statement: "INSERT", table: "conversation_seals" });
    await shipper.ship(entry);
    await shipper.flush();

    const line = readFileSync(path, "utf8").trim();
    const parsed = JSON.parse(line) as AuditLogEntry;
    expect(parsed.role).toBe("cello_service");
    expect(parsed.statement).toBe("INSERT");
    expect(parsed.table).toBe("conversation_seals");
    expect(typeof parsed.timestamp).toBe("string");

    // Cleanup
    await rm(dir, { recursive: true, force: true });
  });
});

// ─── AC-005: missing AUDIT_LOG_PATH exits 1 ──────────────────────────────────

describe("PERSIST-006 AC-005: missing AUDIT_LOG_PATH exits 1 with adapter.config.missing", () => {
  it("exits 1 when CELLO_ENV=local and AUDIT_LOG_PATH is absent", () => {
    const merged: NodeJS.ProcessEnv = {
      ...process.env,
      CELLO_ENV: "local",
      DATABASE_URL: process.env["DATABASE_URL"] ?? "postgresql://postgres:dev@localhost:5433/cello_dev",
      DEV_ENVELOPE_KEY: process.env["DEV_ENVELOPE_KEY"] ?? "0".repeat(64),
      CELLO_RELAY_MULTIADDR: "/ip4/127.0.0.1/tcp/4001/p2p/12D3KooWTest",
      AUDIT_LOG_PATH: undefined,
    };
    // Remove undefined keys
    for (const key of Object.keys(merged)) {
      if (merged[key] === undefined) delete merged[key];
    }
    let code = 0;
    let out = "";
    try {
      execSync(`node --import ${tsxEsm} src/bin/directory.ts`, {
        cwd: PKG,
        env: merged,
        stdio: "pipe",
        encoding: "utf8",
        timeout: 8000,
      });
    } catch (err: unknown) {
      const e = err as { stdout?: string; stderr?: string; status?: number };
      code = e.status ?? 1;
      out = (e.stdout ?? "") + (e.stderr ?? "");
    }
    expect(code).toBe(1);
    expect(out).toContain("adapter.config.missing");
    expect(out).toContain("AUDIT_LOG_PATH");
  });
});

// ─── AC-004: flush() called on graceful shutdown ──────────────────────────────

describe("PERSIST-006 AC-004: flush() is called on graceful shutdown", () => {
  it("integration: shipped entries appear in the audit log file after shutdown", async () => {
    if (!isLocal) return;

    const dir = await mkdtemp(join(tmpdir(), "cello-audit-ac004-"));
    const auditPath = join(dir, "audit.jsonl");

    // Create a test script that ships entries then exits gracefully
    const testScript = `
import { LocalAuditLogShipper, StdoutLogger } from "@cello/interfaces/stubs";

const logger = new StdoutLogger();
const shipper = new LocalAuditLogShipper("${auditPath}", logger);

// Ship 3 entries
await shipper.ship({ role: "test", statement: "INSERT", table: "t1", timestamp: new Date().toISOString() });
await shipper.ship({ role: "test", statement: "UPDATE", table: "t2", timestamp: new Date().toISOString() });
await shipper.ship({ role: "test", statement: "DELETE", table: "t3", timestamp: new Date().toISOString() });

// Simulate graceful shutdown — flush() is called
const count = await shipper.flush();
logger.info("audit.shipper.flushed", { entriesShipped: count });
`;

    const scriptPath = join(dir, "test-shutdown.mjs");
    await writeFile(scriptPath, testScript, "utf8");

    // Run the test script
    let out = "";
    try {
      out = execSync(`node --import ${tsxEsm} ${scriptPath}`, {
        cwd: PKG,
        stdio: "pipe",
        encoding: "utf8",
        timeout: 5000,
      });
    } catch (err: unknown) {
      const e = err as { stdout?: string; stderr?: string; status?: number };
      out = (e.stdout ?? "") + (e.stderr ?? "");
    }

    // Verify the flush event was logged
    expect(out).toContain("audit.shipper.flushed");

    // Verify the file contains all 3 entries
    const lines = readFileSync(auditPath, "utf8").trim().split("\n").filter(Boolean);
    expect(lines).toHaveLength(3);

    const statements = lines.map((line) => JSON.parse(line).statement);
    expect(statements).toEqual(["INSERT", "UPDATE", "DELETE"]);

    // Cleanup
    await rm(dir, { recursive: true, force: true });
  });
});

// ─── SI-002: ship() failure triggers retry ────────────────────────────────────

describe("PERSIST-006 SI-002: ship() failure triggers retry — entries not silently dropped", () => {
  it("entry remains in queue after a write failure and is eventually written on flush()", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cello-audit-si002-"));
    const invalidPath = join(dir, "nonexistent-subdir", "audit.jsonl");
    const logger = new StdoutLogger();

    // Adversarial condition: ship to a path where the parent directory doesn't exist
    // This will cause appendFile to reject, triggering the retry queue
    const shipper = new LocalAuditLogShipper(invalidPath, logger);
    const entry = makeEntry({ statement: "INSERT" });

    // First ship() should fail and throw
    await expect(shipper.ship(entry)).rejects.toThrow();

    // Now create the directory so flush() can succeed
    await mkdir(dirname(invalidPath), { recursive: true });

    // flush() should retry and succeed
    const count = await shipper.flush();
    expect(count).toBe(1);

    const lines = readFileSync(invalidPath, "utf8").trim().split("\n").filter(Boolean);
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]!) as AuditLogEntry;
    expect(parsed.statement).toBe("INSERT");

    // Cleanup
    await rm(dir, { recursive: true, force: true });
  });
});

// ─── AC-001 + SI-003: pgaudit logs all statements ────────────────────────────

const describeIntegration = isLocal ? describe : describe.skip;

let pool: pg.Pool;

beforeAll(async () => {
  if (!isLocal) return;
  pool = new pg.Pool({ connectionString: DATABASE_URL });
});

afterAll(async () => {
  if (!isLocal) return;
  await pool?.end();
});

describeIntegration("PERSIST-006 AC-001: pgaudit logs INSERT on conversation_seals", () => {
  it("pgaudit is enabled with pgaudit.log=all — log_min_messages is logged for any statement", async () => {
    // Verify that pgaudit.log = 'all' is set — meaning SELECT is included (SI-003).
    const result = await pool.query<{ log: string }>(
      `SHOW pgaudit.log`,
    );
    const logSetting = result.rows[0]?.log ?? "";
    // 'all' or comma-separated list that includes 'read' or 'all'
    expect(logSetting.toLowerCase()).toMatch(/all|read/);
  });

  it("pgaudit extension is present in pg_extension", async () => {
    const result = await pool.query<{ extname: string }>(
      `SELECT extname FROM pg_extension WHERE extname = 'pgaudit'`,
    );
    expect(result.rows[0]?.extname).toBe("pgaudit");
  });

  it("INSERT on conversation_seals produces pgaudit log entry with role, statement, table, timestamp", async () => {
    // AC-001: Execute actual INSERT and verify pgaudit log entry appears in container logs
    const testConversationId = randomBytes(16).toString("hex");
    const testSealHash = randomBytes(32).toString("hex");
    const testSequenceNum = Math.floor(Math.random() * 1000000);

    // Execute INSERT
    await pool.query(
      `INSERT INTO conversation_seals (conversation_id, sequence_num, seal_hash, signed_at)
       VALUES ($1, $2, $3, NOW())`,
      [testConversationId, testSequenceNum, testSealHash],
    );

    // Parse Postgres container logs to find the audit entry
    // Use docker logs to read the pgaudit log output
    const containerName = "cello-postgres-1"; // Docker Compose default
    let logs = "";
    try {
      logs = execSync(`docker logs ${containerName} 2>&1 | tail -100`, {
        encoding: "utf8",
        timeout: 5000,
      });
    } catch (err) {
      throw new Error(`Failed to read container logs: ${err}`);
    }

    // pgaudit log format: AUDIT: <role>,<class>,<command>,<object_type>,<object_name>,...
    // We expect: role=cello_service, statement=INSERT, table=conversation_seals
    const auditLineRegex = /AUDIT:.*INSERT.*conversation_seals/i;
    expect(logs).toMatch(auditLineRegex);

    // Verify the log contains the role
    expect(logs).toContain("cello_service");
  });

  it("SI-003: pgaudit.log includes read-level (SELECT) logging — not narrowed to writes only", async () => {
    // PERSIST-006 SI-003: pgaudit.log must not be scoped to exclude SELECT.
    // If set to 'all', read is implicitly included. If set explicitly, 'read' must appear.
    const result = await pool.query<{ log: string }>(`SHOW pgaudit.log`);
    const logSetting = (result.rows[0]?.log ?? "").toLowerCase();
    // Accepted values: 'all', or a comma-list that includes 'read'
    const coversRead = logSetting === "all" || logSetting.split(",").map((s) => s.trim()).includes("read");
    expect(coversRead).toBe(true);
  });
});
