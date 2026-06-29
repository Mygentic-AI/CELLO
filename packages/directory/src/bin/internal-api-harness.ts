/**
 * Local internal-API harness (M8 SPINE-3 / READ-001 / WRITEAPI-001 served-e2e support).
 *
 * Stands up JUST the directory's internal HTTP API (createInternalApiServer) against the directory's
 * local Postgres — NO libp2p node, NO transport keys, NO KMS. This is exactly the surface the portal's
 * served e2e needs (account-by-email-stub, agents-by-account, agent-write); the full directory node is
 * not required to prove the portal↔directory read/write seam. The cross-node / federation behaviour is
 * the separate AWS close gate; this makes the SINGLE-directory served journeys a STANDING local gate.
 *
 * Env:
 *   DATABASE_URL        — directory Postgres (default postgresql://postgres:dev@localhost:5433/cello_dev)
 *   INTERNAL_API_PORT   — listen port (default 8081)
 *   INTERNAL_API_KEY    — bearer key the portal must send (default "local-e2e-key")
 *
 * Prints "internal-api-harness listening on <port>" to stdout when ready (the portal harness waits on
 * the port, not the log). Exits cleanly on SIGINT/SIGTERM.
 */
import pg from "pg";
import { createInternalApiServer } from "../internal-api-server.js";
import { configurePgTypes } from "../pg-type-config.js";

// Match the PRODUCTION directory: install the global TIMESTAMPTZ→string parser BEFORE the pool is
// created. Without this the harness returned Dates while prod returns strings — which is exactly
// how the agents-by-account `last_seen_at.toISOString()` crash (502) slipped past the portal e2e.
configurePgTypes();

const DB_URL = process.env["DATABASE_URL"] ?? "postgresql://postgres:dev@localhost:5433/cello_dev";
const PORT = parseInt(process.env["INTERNAL_API_PORT"] ?? "8081", 10);
const API_KEY = process.env["INTERNAL_API_KEY"] ?? "local-e2e-key";

// A minimal logger — JSON to stderr so it never pollutes any stdout the parent may read.
const logger = {
  info: (event: string, ctx?: unknown) => process.stderr.write(JSON.stringify({ level: "info", event, ctx }) + "\n"),
  warn: (event: string, ctx?: unknown) => process.stderr.write(JSON.stringify({ level: "warn", event, ctx }) + "\n"),
  error: (event: string, ctx?: unknown) => process.stderr.write(JSON.stringify({ level: "error", event, ctx }) + "\n"),
};

const pool = new pg.Pool({ connectionString: DB_URL });
const server = createInternalApiServer({ pool, internalApiKey: API_KEY, logger });

// Fail LOUD + fast on a bind error (e.g. an orphaned harness still holding the port) — otherwise the
// caller's readiness probe just times out and the real cause is buried.
server.on("error", (err: NodeJS.ErrnoException) => {
  const msg = err.code === "EADDRINUSE" ? `port ${PORT} already in use (orphaned harness?)` : String(err);
  process.stderr.write(`internal-api-harness: ${msg}\n`);
  process.exit(1);
});

server.listen(PORT, () => {
  // stdout ready line (single, parseable).
  process.stdout.write(`internal-api-harness listening on ${PORT}\n`);
});

async function shutdown() {
  await new Promise<void>((r) => server.close(() => r()));
  await pool.end().catch(() => {});
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
