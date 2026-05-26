/**
 * Service lifecycle observability events for DEPLOY-002.
 *
 * Each function emits exactly one structured log event with the fields
 * specified in the story's observability section. Logger is injected,
 * never imported directly.
 *
 * Events:
 *   directory.service.started  — INFO  — { nodeId, region, environment, schemaVersion }
 *   directory.service.stopped  — INFO  — { nodeId, region, environment, uptimeMs }
 *   directory.service.crashed  — ERROR — { nodeId, region, reason, consecutiveFailures }
 *   directory.secrets.unavailable — ERROR — { nodeId, region, reason }
 *   migration.applied          — INFO  — { version, description, executionTime }
 *   migration.failed           — ERROR — { version, description, reason }
 */

import type { Logger, LogContext } from "@cello-protocol/interfaces";

// ─── directory.service.started ─────────────────────────────────────────────

export interface ServiceStartedContext {
  nodeId: string;
  region: string;
  environment: string;
  schemaVersion: number;
}

export function logServiceStarted(logger: Logger, ctx: ServiceStartedContext): void {
  logger.info("directory.service.started", ctx as unknown as LogContext);
}

// ─── directory.service.stopped ─────────────────────────────────────────────

export interface ServiceStoppedContext {
  nodeId: string;
  region: string;
  environment: string;
  uptimeMs: number;
}

export function logServiceStopped(logger: Logger, ctx: ServiceStoppedContext): void {
  logger.info("directory.service.stopped", ctx as unknown as LogContext);
}

// ─── directory.service.crashed ─────────────────────────────────────────────

export interface ServiceCrashedContext {
  nodeId: string;
  region: string;
  reason: string;
  consecutiveFailures: number;
}

export function logServiceCrashed(logger: Logger, ctx: ServiceCrashedContext): void {
  logger.error("directory.service.crashed", ctx as unknown as LogContext);
}

// ─── directory.secrets.unavailable ─────────────────────────────────────────

export interface SecretsUnavailableContext {
  nodeId: string;
  region: string;
  reason: string;
}

export function logSecretsUnavailable(logger: Logger, ctx: SecretsUnavailableContext): void {
  logger.error("directory.secrets.unavailable", ctx as unknown as LogContext);
}

// ─── migration.applied / migration.failed ──────────────────────────────────
// These helpers are ready for use but not yet called from production code.
// Flyway runs in docker-entrypoint.sh (shell), not in the Node.js process.
// To wire: parse Flyway's JSON output (flyway -outputType=json) in the
// entrypoint and pipe per-migration events to the Node.js process via stdin
// or a shared log file — or migrate from shell to a Node.js Flyway runner.
// TODO(DEPLOY-002): wire logMigrationApplied/logMigrationFailed once
// Flyway JSON output parsing is added to the entrypoint.

export interface MigrationAppliedContext {
  version: string;
  description: string;
  executionTime: number;
}

export function logMigrationApplied(logger: Logger, ctx: MigrationAppliedContext): void {
  logger.info("migration.applied", ctx as unknown as LogContext);
}

// ─── migration.failed ──────────────────────────────────────────────────────

export interface MigrationFailedContext {
  version: string;
  description: string;
  reason: string;
}

export function logMigrationFailed(logger: Logger, ctx: MigrationFailedContext): void {
  logger.error("migration.failed", ctx as unknown as LogContext);
}
