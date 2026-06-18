import { defineConfig } from "vitest/config";

// J-SPINE live binary lane (M7). Spawns the real shipped binaries on localhost —
// deliberately invoked (`test:spine`), never part of the fast in-process suite.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.spine.test.ts"],
    testTimeout: 120_000,
    hookTimeout: 180_000,
    // Live binaries bind real ports and share one local Postgres — run serially.
    fileParallelism: false,
  },
});
