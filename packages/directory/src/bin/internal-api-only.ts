/**
 * internal-api-only — a minimal standalone runner for the directory's internal HTTP API
 * (createInternalApiServer), with NO FROST / libp2p / relay stack. Boots a pg pool + the internal
 * API server only. Used by the cello-portal J-SPINE harness to exercise the REAL directory
 * account-resolution / read endpoints (READ-001) against a migrated Postgres, instead of the
 * portal's local DirectoryClient stub.
 *
 * Env: DATABASE_URL (required), INTERNAL_API_KEY (required), INTERNAL_API_PORT (default 8081).
 */
import pg from "pg";
import { createInternalApiServer } from "../internal-api-server.js";

function requireEnv(key: string): string {
  const v = process.env[key];
  if (!v) {
    // eslint-disable-next-line no-console -- standalone bin entrypoint.
    console.error(`[internal-api-only] missing required env ${key}`);
    process.exit(1);
  }
  return v;
}

const databaseUrl = requireEnv("DATABASE_URL");
const internalApiKey = requireEnv("INTERNAL_API_KEY");
const port = parseInt(process.env["INTERNAL_API_PORT"] ?? "8081", 10);

const pool = new pg.Pool({ connectionString: databaseUrl, max: 5 });

// Structured-enough logger for a harness bin (the real directory injects its own).
const logger = {
  info: (event: string, context?: Record<string, unknown>) =>
    process.stdout.write(JSON.stringify({ level: "info", event, ...context }) + "\n"),
  warn: (event: string, context?: Record<string, unknown>) =>
    process.stdout.write(JSON.stringify({ level: "warn", event, ...context }) + "\n"),
  error: (event: string, context?: Record<string, unknown>) =>
    process.stdout.write(JSON.stringify({ level: "error", event, ...context }) + "\n"),
};

const server = createInternalApiServer({ pool, internalApiKey, logger });
server.listen(port, () => {
  // eslint-disable-next-line no-console -- standalone bin entrypoint.
  console.log(`[internal-api-only] listening on :${port}`);
});

const shutdown = () => {
  server.close(() => {
    void pool.end().finally(() => process.exit(0));
  });
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
