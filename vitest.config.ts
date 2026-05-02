import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      "packages/crypto",
      "packages/protocol-types",
      "packages/transport",
      "packages/client",
      "packages/adapter-claude-code",
      "packages/directory",
      "packages/relay",
      "packages/e2e-tests",
    ],
  },
});
