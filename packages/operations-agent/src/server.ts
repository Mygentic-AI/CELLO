/**
 * server.ts — Operations Agent composition root.
 *
 * Phase P — Pseudocode:
 *
 *   startup():
 *     1. Mint logger (StdoutLogger)
 *     2. Read CELLO_ENV from process.env; default to 'local'
 *     3. Call resolveAdapters(config) — fails fast if any required env var is missing
 *     4. Construct pg.Pool from RDS credentials
 *     5. Run health check:
 *        a. Query DB: SELECT version from flyway_schema_history ORDER BY installed_rank DESC LIMIT 1
 *        b. Verify migration version matches EXPECTED_MIGRATION_VERSION (V26)
 *        c. Call Telegram getMe endpoint (via TelegramAdapter.start({ skipPolling: true }))
 *           Or: for local env, skip Telegram check
 *     6. Build health report; if unhealthy: log ops_agent.startup.failed + exit(1)
 *     7. Construct RegistrationEngine; call engine.start()
 *     8. Log ops_agent.started { version, region, migrationVersion }
 *     9. Log ops_agent.telegram.connected { botUsername } (if real adapter)
 *    10. Start HTTP health check server on port 8080 (responds to GET /health)
 *    11. Register SIGTERM/SIGINT: engine.stop() + server.close() + pool.end()
 *
 *   resolveAdapters(config):
 *     if config.env === 'local':
 *       return { channel: CliAdapter, otpDelivery: ConsoleOtpDeliveryProvider,
 *                preAuth: LocalPreAuthorizationClient }
 *     else:
 *       assert TELEGRAM_BOT_TOKEN present or throw "TELEGRAM_BOT_TOKEN required"
 *       assert DIRECTORY_API_KEY present or throw "DIRECTORY_API_KEY required"
 *       assert DIRECTORY_INTERNAL_URL present or throw "DIRECTORY_INTERNAL_URL required"
 *       assert SES_FROM_ADDRESS present (or use default)
 *       return { channel: TelegramAdapter(token), otpDelivery: SesOtpDeliveryProvider,
 *                preAuth: DirectoryPreAuthorizationClient }
 *
 *   buildHealthReport(checks):
 *     healthy = all checks pass
 *     return { healthy, checks }
 *
 * Composition root rule: all adapters are instantiated here.
 * CELLO_ENV drives adapter selection.
 * The app fails at startup with a clear error if any required adapter config is missing.
 *
 * Observability events emitted here:
 *   - ops_agent.started (INFO) { version, region, migrationVersion }
 *   - ops_agent.telegram.connected (INFO) { botUsername }
 *   - ops_agent.startup.failed (ERROR) { reason, component }
 */

import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { SESClient } from "@aws-sdk/client-ses";
import { StdoutLogger } from "@cello-protocol/interfaces/stubs";
import {
  CliAdapter,
  ConsoleOtpDeliveryProvider,
  LocalPreAuthorizationClient,
} from "@cello-protocol/interfaces/stubs";
import type {
  Logger,
  MessagingChannel,
  OtpDeliveryProvider,
  PreAuthorizationClient,
} from "@cello-protocol/interfaces";
import { TelegramAdapter } from "./telegram-adapter.js";
import { SesOtpDeliveryProvider } from "./ses/ses-otp-delivery-provider.js";
import { DirectoryPreAuthorizationClient } from "./directory-pre-auth-client.js";
import { RegistrationEngine } from "./registration/engine.js";

// ─── Expected migration version ───────────────────────────────────────────────
// Read from env so schema bumps don't require a code change + pipeline deploy.
// Update EXPECTED_MIGRATION_VERSION in the ECS task definition env vars instead.
const EXPECTED_MIGRATION_VERSION = process.env["EXPECTED_MIGRATION_VERSION"]
  ? parseInt(process.env["EXPECTED_MIGRATION_VERSION"], 10)
  : 27;

// ─── Types exported for testing ───────────────────────────────────────────────

export type CelloEnv = "local" | "dev" | "staging" | "production";

export type AdapterConfig = {
  env: CelloEnv;
  logger: Logger;
  // Production-only fields — required when env !== 'local'
  telegramBotToken?: string;
  sesCredentials?: { accessKeyId: string; secretAccessKey: string };
  sesFromAddress?: string;
  sesRegion?: string;
  directoryInternalUrl?: string;
  directoryApiKey?: string;
};

export type ResolvedAdapters = {
  channel: MessagingChannel;
  otpDelivery: OtpDeliveryProvider;
  preAuth: PreAuthorizationClient;
  /** Channel type string for the RegistrationEngine */
  channelType: "telegram" | "cli";
};

export type HealthCheckInput = {
  dbConnected: boolean;
  migrationVersion: number | null;
  expectedMigrationVersion: number;
  telegramConnected: boolean;
};

export type HealthReport = {
  healthy: boolean;
  checks: {
    database: string;
    migrations: string;
    telegram: string;
  };
};

// ─── resolveAdapters ─────────────────────────────────────────────────────────

/**
 * Instantiate adapters based on CELLO_ENV.
 *
 * Local: stubs only (CliAdapter, ConsoleOtpDeliveryProvider, LocalPreAuthorizationClient).
 * Dev/staging/production: real adapters (TelegramAdapter, SesOtpDeliveryProvider,
 *   DirectoryPreAuthorizationClient).
 *
 * Throws immediately if any required configuration is missing for non-local envs.
 * This implements the "fail at startup with a clear error" composition root rule.
 */
export function resolveAdapters(config: AdapterConfig): ResolvedAdapters {
  const { env, logger } = config;

  if (env === "local") {
    return {
      channel: new CliAdapter(),
      otpDelivery: new ConsoleOtpDeliveryProvider(),
      preAuth: new LocalPreAuthorizationClient(),
      channelType: "cli",
    };
  }

  // Production / dev / staging — require all secrets
  const telegramBotToken = config.telegramBotToken;
  if (!telegramBotToken) {
    throw new Error(
      "TELEGRAM_BOT_TOKEN is required for CELLO_ENV=" + env + " but was not provided",
    );
  }

  const directoryApiKey = config.directoryApiKey;
  if (!directoryApiKey) {
    throw new Error(
      "DIRECTORY_API_KEY is required for CELLO_ENV=" + env + " but was not provided",
    );
  }

  const directoryInternalUrl = config.directoryInternalUrl;
  if (!directoryInternalUrl) {
    throw new Error(
      "DIRECTORY_INTERNAL_URL is required for CELLO_ENV=" + env + " but was not provided",
    );
  }

  const sesCredentials = config.sesCredentials;
  if (!sesCredentials) {
    throw new Error(
      "SES_CREDENTIALS is required for CELLO_ENV=" + env + " but was not provided",
    );
  }

  const sesFromAddress = config.sesFromAddress ?? "noreply@cello.mygentic.ai";

  // Construct SESClient with injected credentials (SI-003 from OPS-AGENT-004: no process.env reads).
  // Region passed explicitly — AWS SDK v3 reads AWS_REGION internally, but the project uses
  // AWS_DEFAULT_REGION as the canonical env var name (CLAUDE.md: AWS_REGION is reserved).
  const sesClient = new SESClient({
    region: config.sesRegion ?? "us-east-1",
    credentials: {
      accessKeyId: sesCredentials.accessKeyId,
      secretAccessKey: sesCredentials.secretAccessKey,
    },
  });

  return {
    channel: new TelegramAdapter({ token: telegramBotToken, logger }),
    otpDelivery: new SesOtpDeliveryProvider({
      sesClient,
      fromAddress: sesFromAddress,
      logger,
    }),
    preAuth: new DirectoryPreAuthorizationClient({
      directoryInternalUrl,
      apiKey: directoryApiKey,
    }),
    channelType: "telegram",
  };
}

// ─── buildHealthReport ────────────────────────────────────────────────────────

/**
 * Compute the health report from the three health check dimensions.
 *
 * AC-001: health check confirms PostgreSQL connectivity, migration version match,
 * and Telegram API reachability before ops_agent.started is logged.
 */
export function buildHealthReport(input: HealthCheckInput): HealthReport {
  const { dbConnected, migrationVersion, expectedMigrationVersion, telegramConnected } = input;

  const databaseCheck = dbConnected ? "ok" : "failed";

  let migrationsCheck: string;
  if (!dbConnected) {
    migrationsCheck = "skipped (db disconnected)";
  } else if (migrationVersion === null) {
    migrationsCheck = "mismatch: no migrations found, expected V" + expectedMigrationVersion;
  } else if (migrationVersion !== expectedMigrationVersion) {
    migrationsCheck =
      "mismatch: found V" + migrationVersion + ", expected V" + expectedMigrationVersion;
  } else {
    migrationsCheck = "ok";
  }

  const telegramCheck = telegramConnected ? "ok" : "failed";

  const healthy =
    dbConnected &&
    migrationVersion === expectedMigrationVersion &&
    telegramConnected;

  return {
    healthy,
    checks: {
      database: databaseCheck,
      migrations: migrationsCheck,
      telegram: telegramCheck,
    },
  };
}

// ─── Health check helpers ─────────────────────────────────────────────────────

async function checkDatabase(pool: pg.Pool): Promise<{
  connected: boolean;
  migrationVersion: number | null;
}> {
  try {
    const result = await pool.query<{ version: number }>(
      "SELECT version FROM flyway_schema_history ORDER BY installed_rank DESC LIMIT 1",
    );
    const raw = result.rows[0]?.version ?? null;
    const version = raw !== null ? Number(raw) : null;
    return { connected: true, migrationVersion: version };
  } catch {
    return { connected: false, migrationVersion: null };
  }
}

async function checkTelegram(
  adapter: TelegramAdapter,
): Promise<{ connected: boolean; botUsername: string }> {
  try {
    // start() with skipPolling=true calls getMe to verify the bot token is valid.
    // After start() returns, adapter.botUsername holds the verified username from getMe.
    await adapter.start({ skipPolling: true });
    return { connected: true, botUsername: adapter.botUsername };
  } catch {
    // Caller logs ops_agent.startup.failed via the health report path — no double-log here.
    return { connected: false, botUsername: "" };
  }
}

// ─── Main entrypoint ──────────────────────────────────────────────────────────

/**
 * Read configuration from environment variables and start the Operations Agent.
 * Called when this module is run as the process entrypoint (node server.js).
 *
 * Exits with code 1 on startup failure.
 */
async function main(): Promise<void> {
  const logger = new StdoutLogger();

  const env = (process.env["CELLO_ENV"] ?? "local") as CelloEnv;
  const region = process.env["AWS_DEFAULT_REGION"] ?? "local";
  const version = process.env["npm_package_version"] ?? "unknown";

  // ── Parse SES credentials ─────────────────────────────────────────────────
  let sesCredentials: { accessKeyId: string; secretAccessKey: string } | undefined;
  const sesCredentialsRaw = process.env["SES_CREDENTIALS"];
  if (sesCredentialsRaw) {
    try {
      sesCredentials = JSON.parse(sesCredentialsRaw) as {
        accessKeyId: string;
        secretAccessKey: string;
      };
    } catch {
      logger.error("ops_agent.startup.failed", {
        reason: "SES_CREDENTIALS JSON parse failed",
        component: "server",
      });
      process.exit(1);
    }
  }

  // ── Resolve adapters — fails fast on missing config ───────────────────────
  let adapters: ResolvedAdapters;
  try {
    adapters = resolveAdapters({
      env,
      logger,
      telegramBotToken: process.env["TELEGRAM_BOT_TOKEN"],
      sesCredentials,
      sesFromAddress: process.env["SES_FROM_ADDRESS"] ?? "noreply@cello.mygentic.ai",
      sesRegion: process.env["AWS_DEFAULT_REGION"] ?? "us-east-1",
      directoryInternalUrl: process.env["DIRECTORY_INTERNAL_URL"],
      directoryApiKey: process.env["DIRECTORY_API_KEY"],
    });
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    logger.error("ops_agent.startup.failed", error, {
      reason: error.message,
      component: "server",
    });
    process.exit(1);
  }

  // ── Parse RDS credentials ─────────────────────────────────────────────────
  let rdsUsername = "cello_ops_agent";
  let rdsPassword = "";
  const rdsCredentialsRaw = process.env["RDS_CREDENTIALS"];
  if (rdsCredentialsRaw) {
    try {
      const parsed = JSON.parse(rdsCredentialsRaw) as {
        username?: string;
        password?: string;
      };
      rdsUsername = parsed.username ?? rdsUsername;
      rdsPassword = parsed.password ?? rdsPassword;
    } catch {
      logger.error("ops_agent.startup.failed", {
        reason: "RDS_CREDENTIALS JSON parse failed",
        component: "server",
      });
      process.exit(1);
    }
  } else if (env !== "local") {
    logger.error("ops_agent.startup.failed", {
      reason: "RDS_CREDENTIALS required for CELLO_ENV=" + env,
      component: "server",
    });
    process.exit(1);
  }

  // ── Build database connection pool ────────────────────────────────────────
  const databaseUrl =
    process.env["DATABASE_URL"] ??
    `postgresql://${rdsUsername}:${encodeURIComponent(rdsPassword)}@${process.env["RDS_ENDPOINT"] ?? "localhost"}:${process.env["RDS_PORT"] ?? "5432"}/${process.env["RDS_DB_NAME"] ?? "cello_dev"}`;

  const pool = new pg.Pool({
    connectionString: databaseUrl,
    ssl: env !== "local" ? { rejectUnauthorized: false } : false,
  });

  // ── Health checks ─────────────────────────────────────────────────────────
  const { connected: dbConnected, migrationVersion } = await checkDatabase(pool);

  // The composition root guarantees env !== "local" always wires TelegramAdapter.
  // No instanceof guard needed — we rely on the composition root invariant.
  let telegramConnected = true;
  let verifiedBotUsername = "";
  if (env !== "local") {
    const telegramResult = await checkTelegram(adapters.channel as TelegramAdapter);
    telegramConnected = telegramResult.connected;
    verifiedBotUsername = telegramResult.botUsername;
  }

  const healthReport = buildHealthReport({
    dbConnected,
    migrationVersion,
    expectedMigrationVersion: EXPECTED_MIGRATION_VERSION,
    telegramConnected,
  });

  if (!healthReport.healthy) {
    logger.error("ops_agent.startup.failed", {
      reason: "Health check failed: " + JSON.stringify(healthReport.checks),
      component: "health-check",
    });
    await pool.end();
    process.exit(1);
  }

  // ── Start RegistrationEngine ───────────────────────────────────────────────
  const engine = new RegistrationEngine({
    pool,
    channel: adapters.channel,
    otpDelivery: adapters.otpDelivery,
    preAuth: adapters.preAuth,
    logger,
    channelType: adapters.channelType,
  });

  await engine.start();

  // Start Telegram polling now that the engine's message handler is registered.
  // The earlier start({ skipPolling: true }) only verified the token via getMe.
  if (env !== "local") {
    await (adapters.channel as TelegramAdapter).start();
  }

  // ── Emit startup observability events ─────────────────────────────────────
  logger.info("ops_agent.started", {
    version,
    region,
    migrationVersion: migrationVersion ?? 0,
  });

  if (env !== "local") {
    // botUsername comes from the verified getMe response in checkTelegram — not an env var.
    logger.info("ops_agent.telegram.connected", {
      botUsername: verifiedBotUsername,
    });
  }

  // ── HTTP health endpoint on port 8080 ──────────────────────────────────────
  // ECS health check polls GET /health; also used by staging smoke test (AC-007).
  const healthServer = createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", migrationVersion }));
  });

  healthServer.listen(8080, () => {
    logger.info("ops_agent.health_server.started", { port: 8080 });
  });

  // ── Graceful shutdown ──────────────────────────────────────────────────────
  const shutdown = async () => {
    logger.info("ops_agent.shutting_down", {});
    engine.stop();
    healthServer.close();
    await pool.end();
    process.exit(0);
  };

  process.on("SIGTERM", () => { void shutdown(); });
  process.on("SIGINT", () => { void shutdown(); });
}

// ── Run if this is the main entry point ────────────────────────────────────
// ESM equivalent of `if (require.main === module)`.
// fileURLToPath gives a full absolute path; comparing against process.argv[1]
// avoids the basename-only fragility of URL.pathname.endsWith().
if (fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    const logger = new StdoutLogger();
    logger.error("ops_agent.startup.failed", err instanceof Error ? err : new Error(String(err)), {
      reason: "Unhandled error in main()",
      component: "server",
    });
    process.exit(1);
  });
}
