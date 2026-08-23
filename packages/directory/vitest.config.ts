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
    // DOD-M15-CHAINROUNDTRIP-1: assert every hash chain still verifies once every file has run.
    // A test file cannot do this job — it only sees damage from files that sorted before it, and
    // that is exactly how a test which tampered a row and forgot to restore it stayed invisible.
    //
    // `globalSetup`, not `globalTeardown`: vitest has no `globalTeardown` key. It takes the
    // teardown as a named export of the setup module, and an unrecognised key here is accepted in
    // silence — I wrote `globalTeardown` first and the suite passed with a deliberately poisoned
    // chain, which is the same "looks configured, does nothing" failure the file itself is about.
    globalSetup: ["./src/__tests__/helpers/verify-chains-teardown.ts"],
  },
});
