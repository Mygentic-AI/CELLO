import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // REG-001: DKG tests require longer timeout (real FROST crypto + libp2p streams)
    testTimeout: 30_000,
    // Use forks pool: each test file runs in its own child process — true isolation.
    // maxForks=1 means only one file runs at a time (peak memory ~4.5GB, safe for
    // the 8GB Docker constraint). This prevents Vitest lifecycle hook bleed where
    // beforeEach/afterEach from one file runs before tests in another file when
    // sharing a single thread (threads pool with maxThreads=1 doesn't isolate).
    pool: "forks",
    poolOptions: {
      forks: { maxForks: 1 },
    },
  },
});
