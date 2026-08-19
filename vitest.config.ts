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
    ],
  },
});
