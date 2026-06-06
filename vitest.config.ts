import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      "packages/adapter-claude-code",
      "packages/directory",
      "packages/relay",
      "packages/e2e-tests",
    ],
  },
});
