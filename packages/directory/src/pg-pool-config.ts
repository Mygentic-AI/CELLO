/**
 * CELLO-M6B-009: PostgreSQL connection pool configuration helpers.
 *
 * Extracted into a dedicated module so the composition root (bin/directory.ts)
 * can delegate to this logic and tests can import it directly — avoiding the
 * "test re-implements the logic it claims to test" anti-pattern.
 */
import type { Logger } from "@cello-protocol/interfaces";

/**
 * Parse the DIRECTORY_PG_POOL_MAX environment variable.
 *
 * Returns the configured value, or 50 if the env var is absent.
 * Logs a WARN at the "directory.pool.max.high" event if the value
 * exceeds 100 (the soft ceiling for db.t3.medium shared across 3 nodes).
 *
 * @param env    NodeJS.ProcessEnv (process.env or a test-supplied substitute)
 * @param logger Logger instance for the advisory WARN
 * @returns      Resolved pool max (integer >= 1)
 */
export function resolvePoolMax(env: NodeJS.ProcessEnv, logger: Logger): number {
  const raw = parseInt(env["DIRECTORY_PG_POOL_MAX"] ?? "50", 10);
  // Guard against NaN (empty string, non-numeric value): pg.Pool silently uses its
  // internal default of 10 when given NaN, which defeats explicit pool sizing.
  const poolMax = Number.isFinite(raw) && raw > 0 ? raw : 50;

  if (poolMax > 100) {
    logger.warn("directory.pool.max.high", { configured: poolMax, recommended_max: 100 });
  }

  return poolMax;
}
