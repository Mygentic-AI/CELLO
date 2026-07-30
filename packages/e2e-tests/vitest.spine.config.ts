import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

/**
 * cello-portal is a sibling repo, and `J-END` must drive its REAL ingress modules.
 *
 * Every earlier spine journey simulates the portal by seeding `signal_records` directly — sound when
 * the portal's role was to insert a row, and a FALSE GREEN for M10B, where the portal's ingress IS
 * the thing under test. A journey that seeded the directory would skip drain, authenticate, scan,
 * compose and mint entirely and still pass.
 *
 * Two aliases make those modules importable outside Next, mirroring the portal's own vitest config:
 * `@` is its path alias, and `server-only` is a build guard that throws outside an RSC — a spine test
 * is unambiguously the server, so it has nothing to protect here.
 */
const PORTAL_ROOT = resolve(__dirname, "../../../cello-portal");

// J-SPINE live binary lane (M7). Spawns the real shipped binaries on localhost —
// deliberately invoked (`test:spine`), never part of the fast in-process suite.
export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(PORTAL_ROOT, "src"),
      "server-only": resolve(PORTAL_ROOT, "test/empty.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.spine.test.ts"],
    testTimeout: 120_000,
    hookTimeout: 180_000,
    // Live binaries bind real ports and share one local Postgres — run serially.
    fileParallelism: false,
    env: {
      // The portal's config module REQUIRES this and throws without it. It was previously supplied by
      // an `export` in whatever shell ran the journey — which means the journey passed only in the
      // session that happened to export it, and failed for anyone else (including a later call in the
      // same session, since shell env does not persist). A test whose green depends on ambient shell
      // state is not reproducible. Declared here, matching the portal's own vitest config so the two
      // repos point at the SAME local database rather than diverging silently.
      PORTAL_DATABASE_URL:
        process.env.PORTAL_DATABASE_URL ?? "postgres://portal:portal@localhost:55432/cello_portal",
      CELLO_ENV: process.env.CELLO_ENV ?? "local",
    },
  },
});
