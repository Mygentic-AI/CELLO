import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/__tests__/**/*.test.ts"],
    pool: "threads",
    poolOptions: {
      threads: { maxThreads: 1, minThreads: 1 },
    },
  },
});
