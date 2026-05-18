#!/usr/bin/env node
/**
 * Run all PERSIST-E2E-001 non-protocol scripts in sequence.
 *
 * Exit code 0 = all passed.
 * Exit code 1 = one or more failed.
 *
 * Usage:
 *   DATABASE_URL="postgresql://postgres:dev@localhost:5433/cello_dev" \
 *   DEV_ENVELOPE_KEY="0000000000000000000000000000000000000000000000000000000000000001" \
 *   node packages/e2e-tests/scripts/run-all.mjs
 */

import { spawn } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const scripts = [
  { name: "WAL crash recovery (AC-002 / SI-002)", file: "test-wal-crash-recovery.mjs" },
  { name: "WAL corruption (DB-001)", file: "test-wal-corruption.mjs" },
  { name: "SQLCipher wrong-key (AC-006 / SI-003)", file: "test-sqlcipher-wrong-key.mjs" },
  { name: "KMS failure blocks INSERT (SI-006)", file: "test-kms-failure-blocks-insert.mjs" },
  { name: "Hash chain tamper detection (SI-005)", file: "test-hash-chain-tamper.mjs" },
  { name: "pgaudit immutability (SI-007)", file: "test-pgaudit-immutable.mjs" },
];

async function runScript(scriptPath) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [scriptPath], {
      env: process.env,
      stdio: "inherit",
    });
    child.on("close", (code) => resolve(code ?? 1));
  });
}

async function main() {
  const results = [];

  for (const script of scripts) {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`Running: ${script.name}`);
    console.log("=".repeat(60));

    const scriptPath = resolve(__dirname, script.file);
    const exitCode = await runScript(scriptPath);

    results.push({ name: script.name, passed: exitCode === 0 });
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log("RESULTS SUMMARY");
  console.log("=".repeat(60));

  let anyFailed = false;
  for (const r of results) {
    const status = r.passed ? "PASS" : "FAIL";
    console.log(`  [${status}] ${r.name}`);
    if (!r.passed) anyFailed = true;
  }

  console.log("=".repeat(60));
  if (anyFailed) {
    console.error("\nOne or more scripts failed.");
    process.exit(1);
  } else {
    console.log("\nAll scripts passed.");
    process.exit(0);
  }
}

main().catch((err) => {
  console.error("run-all.mjs: unexpected error:", err);
  process.exit(1);
});
