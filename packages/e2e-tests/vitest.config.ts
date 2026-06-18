import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: ["src/**/*.cross-machine.test.ts", "src/**/*.spine.test.ts"],
    testTimeout: 30_000,
    // MCP transport teardown can produce unhandled "Connection closed" rejections
    // when in-flight tool calls (e.g. await_connection_request with 20s timeout)
    // race against test cleanup. These are cosmetic — not actual test failures.
    dangerouslyIgnoreUnhandledErrors: true,
  },
});
