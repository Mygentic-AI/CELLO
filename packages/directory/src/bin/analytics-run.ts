#!/usr/bin/env node
/**
 * CELLO-PERSIST-008 — analytics:run entrypoint
 *
 * Runs the analytics job once synchronously and exits with:
 *   0 — success
 *   1 — failure (analytics.job.failed logged before exit)
 *
 * Environment variables:
 *   CELLO_ENV              — required: local | dev | staging | production
 *   DATABASE_URL           — required: Postgres URL connected as cello_analytics (read)
 *   DATABASE_WRITE_URL     — optional: Postgres URL connected as cello_service (write);
 *                            defaults to DATABASE_URL with user replaced by cello_service
 */

import { randomUUID } from "node:crypto";
import pg from "pg";
import { StdoutLogger } from "@cello/interfaces/stubs";
import { AnalyticsJob } from "../analytics-job.js";

const logger = new StdoutLogger();

const env = process.env["CELLO_ENV"];
if (!env) {
  logger.error("adapter.config.missing", { missingKey: "CELLO_ENV" });
  process.exit(1);
}

const readUrl = process.env["DATABASE_URL"];
if (!readUrl) {
  logger.error("adapter.config.missing", { missingKey: "DATABASE_URL" });
  process.exit(1);
}

// Write pool defaults to cello_service user derived from DATABASE_URL
const writeUrl = process.env["DATABASE_WRITE_URL"]
  ?? readUrl.replace(/^(postgres(?:ql)?):\/\/[^:]+:[^@]+@/, "$1://cello_service:cello_service_dev@");

const readPool = new pg.Pool({ connectionString: readUrl });
const writePool = new pg.Pool({ connectionString: writeUrl });

const runId = randomUUID();

try {
  const job = new AnalyticsJob(readPool, writePool, logger);
  await job.run(runId, "cli");
  process.exit(0);
} catch {
  // analytics.job.failed already logged by AnalyticsJob.run()
  process.exit(1);
} finally {
  await readPool.end();
  await writePool.end();
}
