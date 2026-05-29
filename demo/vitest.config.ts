import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // MANDATORY: one worker only — Docker host has 8GB RAM; each vitest worker uses ~4.5GB
    poolOptions: {
      threads: {
        maxThreads: 1,
        minThreads: 1,
      },
    },
    include: ["src/__tests__/**/*.test.ts"],
  },
});
