import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // REG-001: DKG tests require longer timeout (real FROST crypto + libp2p streams)
    testTimeout: 30_000,
  },
});
