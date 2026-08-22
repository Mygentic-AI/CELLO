import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
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
