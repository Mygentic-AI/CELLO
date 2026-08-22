import { defineConfig } from "vitest/config";
import SkipVisibilityReporter from "./vitest-skip-reporter.js";

export default defineConfig({
  test: {
    /**
     * DOD-M15-CI-SKIPS-SILENT-1: `default` keeps the normal output; the second reporter adds one
     * block AFTER the summary saying what did not run. It runs in the main process, which is the
     * only place that reaches the terminal the operator is actually reading — a `console.warn` from
     * inside a test lands thousands of lines earlier, and a `process.on("exit")` handler fires in a
     * worker and never arrives at all. Both were tried.
     */
    reporters: ["default", new SkipVisibilityReporter()],
    /**
     * DOD-M15-DIRECTORY-ROT-1 / DOD-M15-COMPOSE-CI-1 — THE DATABASE RUN IS SERIAL.
     *
     * Two packages talk to Postgres: `directory` (62 files) and `operations-agent` (8). The root
     * gate is ONE vitest process, so their files share a worker pool and interleave against ONE
     * database — and several of them assert WHOLE-TABLE properties (`verifyChain` from the chain
     * genesis, "an unseeded directory has no authorized issuers", exact row counts). Those are only
     * true of a table nobody else is writing.
     *
     * Measured on a freshly composed database, same command, same commit:
     *
     *   parallel, run 1 → 16 failures across 10 files
     *   parallel, run 2 → 19 failures across  6 files   ← a DIFFERENT set
     *   serial          →  0 failures, 2245 passed, 207s
     *
     * The moving failing set is the tell, and it is the same signature this milestone chased
     * before. Each package passes 100% when run alone; neither is broken.
     *
     * ─── Why this and not "fix the whole-table assertions" ────────────────────────────────────
     *
     * Those assertions are RIGHT. "An unseeded directory notarizes nothing rather than falling
     * open" is a property of the table, and scoping it to rows the test created would delete the
     * thing it proves. The alternative — a `TRUNCATE` in each file's setup — is what caused the
     * deadlocks recorded on the DoD line: an `AccessExclusiveLock` taken against another file
     * mid-INSERT, plus the destruction of rows other files are asserting on.
     *
     * ─── Scoped to the database run, deliberately ─────────────────────────────────────────────
     *
     * Without `CELLO_ENV=local` the integration suites are skipped, nothing touches Postgres, and
     * parallelism is free — so the fast unit gate on every push stays fast. The serial cost is paid
     * only by the run that actually needs it. This is a CONFIG default rather than a CI flag on
     * purpose: a flag only CI passes means a developer running the suite locally gets the flaky
     * behaviour and learns to distrust the suite.
     */
    fileParallelism: process.env["CELLO_ENV"] !== "local",
    projects: [
      "packages/directory",
      "packages/relay",
      "packages/e2e-tests",
      // Added 2026-08-19 with the seal notifier. A package absent from this list has its tests
      // silently skipped by the root gate — they neither run nor report, which reads as "no tests
      // to run" rather than "your tests are not wired in".
      "packages/seal-notifier",
      // DOD-M15-CI-SKIPS-SILENT-1 — the warning directly above was written and then not heeded.
      // These three packages held 24 test files that NO gate run has ever executed. The cost was
      // not hypothetical: the signup limiter units (DOD-M15-SIGNUP-1, -DURABLE-1) reported a green
      // gate whose 4000-odd passing tests did not include a single one of theirs.
      //
      // A comment cannot enforce this, which is why `root-gate-wiring.test.ts` now does: it fails
      // when any workspace package containing test files is missing from this list.
      "packages/operations-agent",
      "packages/interfaces",
      "packages/test-fixtures",
    ],
  },
});
