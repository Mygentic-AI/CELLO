/**
 * server.test.ts — Unit tests for server.ts composition root.
 *
 * Specification (CELLO-OPS-AGENT-005B):
 *
 * AC-001: Health check endpoint confirms PostgreSQL connectivity, migration
 *   version match, and Telegram API reachability before logging ops_agent.started.
 *
 * SI-002: The composition root for CELLO_ENV=local wires stubs (CliAdapter,
 *   ConsoleOtpDeliveryProvider, LocalPreAuthorizationClient, DevTokenValidator).
 *   The production path wires real adapters.
 *
 * AC-006 / SI-001: No @cello-protocol/crypto key generation or FROST modules
 *   are imported (the ops-agent is a registration bot, not a protocol participant).
 *
 * Tests are pure unit tests — they exercise the adapter selection and
 * the health check endpoint logic without spawning a real server.
 *
 * The health check endpoint is tested by calling the exported handler directly.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  resolveAdapters,
  buildHealthReport,
  type AdapterConfig,
} from "../server.js";
import type { Logger } from "@cello-protocol/interfaces";
import {
  CliAdapter,
  ConsoleOtpDeliveryProvider,
  LocalPreAuthorizationClient,
} from "@cello-protocol/interfaces/stubs";
import { DirectoryPreAuthorizationClient } from "../directory-pre-auth-client.js";
import { TelegramAdapter } from "../telegram-adapter.js";
import { SesOtpDeliveryProvider } from "../ses/ses-otp-delivery-provider.js";

// ─── Logger helper ────────────────────────────────────────────────────────────

function makeLogger(): Logger {
  return {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  };
}

// ─── SI-001: @cello-protocol/crypto absent from production dependencies ───────

describe("SI-001: no FROST/crypto key generation in bundle", () => {
  /**
   * SI-001: The operations-agent is a registration bot — it must NOT depend on
   * @cello-protocol/crypto (key generation, FROST signing) or any FROST modules.
   * Verified by reading package.json and asserting the package is absent from
   * both dependencies and devDependencies. Module resolution via createRequire
   * would find sibling workspace packages, making it unsuitable here.
   */
  it("@cello-protocol/crypto is absent from package.json dependencies and devDependencies", () => {
    const pkgPath = resolve(new URL(".", import.meta.url).pathname, "../../package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const allDeps = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
    };
    expect(Object.keys(allDeps)).not.toContain("@cello-protocol/crypto");
  });
});

// ─── resolveAdapters() tests ──────────────────────────────────────────────────

describe("resolveAdapters", () => {
  /**
   * CELLO_ENV=local → stubs wired.
   * AC-001 / SI-002: local environment gets CliAdapter, ConsoleOtpDeliveryProvider,
   * LocalPreAuthorizationClient.
   */
  it("CELLO_ENV=local: wires stub adapters", () => {
    const config: AdapterConfig = {
      env: "local",
      logger: makeLogger(),
    };
    const adapters = resolveAdapters(config);
    expect(adapters.channel).toBeInstanceOf(CliAdapter);
    expect(adapters.otpDelivery).toBeInstanceOf(ConsoleOtpDeliveryProvider);
    expect(adapters.preAuth).toBeInstanceOf(LocalPreAuthorizationClient);
  });

  /**
   * CELLO_ENV=dev → real adapters wired.
   * AC-001: production adapter selection uses TelegramAdapter, SesOtpDeliveryProvider,
   * DirectoryPreAuthorizationClient.
   */
  it("CELLO_ENV=dev: wires real adapters", () => {
    const config: AdapterConfig = {
      env: "dev",
      logger: makeLogger(),
      telegramBotToken: "test-token",
      sesCredentials: { accessKeyId: "key", secretAccessKey: "secret" },
      sesFromAddress: "noreply@example.com",
      directoryInternalUrl: "http://directory:8080/internal/pre-authorize",
      directoryApiKey: "api-key",
    };
    const adapters = resolveAdapters(config);
    expect(adapters.channel).toBeInstanceOf(TelegramAdapter);
    expect(adapters.otpDelivery).toBeInstanceOf(SesOtpDeliveryProvider);
    expect(adapters.preAuth).toBeInstanceOf(DirectoryPreAuthorizationClient);
  });

  /**
   * CELLO_ENV=staging → same real adapters as dev.
   */
  it("CELLO_ENV=staging: wires real adapters", () => {
    const config: AdapterConfig = {
      env: "staging",
      logger: makeLogger(),
      telegramBotToken: "test-token",
      sesCredentials: { accessKeyId: "key", secretAccessKey: "secret" },
      sesFromAddress: "noreply@example.com",
      directoryInternalUrl: "http://directory:8080/internal/pre-authorize",
      directoryApiKey: "api-key",
    };
    const adapters = resolveAdapters(config);
    expect(adapters.channel).toBeInstanceOf(TelegramAdapter);
    expect(adapters.preAuth).toBeInstanceOf(DirectoryPreAuthorizationClient);
  });

  /**
   * CELLO_ENV=production → same real adapters as dev.
   */
  it("CELLO_ENV=production: wires real adapters", () => {
    const config: AdapterConfig = {
      env: "production",
      logger: makeLogger(),
      telegramBotToken: "test-token",
      sesCredentials: { accessKeyId: "key", secretAccessKey: "secret" },
      sesFromAddress: "noreply@example.com",
      directoryInternalUrl: "http://directory:8080/internal/pre-authorize",
      directoryApiKey: "api-key",
    };
    const adapters = resolveAdapters(config);
    expect(adapters.channel).toBeInstanceOf(TelegramAdapter);
    expect(adapters.preAuth).toBeInstanceOf(DirectoryPreAuthorizationClient);
  });

  /**
   * Missing required config for production environment throws at startup
   * with a descriptive error. The app must fail fast if any required adapter
   * configuration is missing (AC-001 startup requirement).
   */
  it("throws when CELLO_ENV=dev but TELEGRAM_BOT_TOKEN is missing", () => {
    const config: AdapterConfig = {
      env: "dev",
      logger: makeLogger(),
      // telegramBotToken deliberately omitted
      sesCredentials: { accessKeyId: "key", secretAccessKey: "secret" },
      sesFromAddress: "noreply@example.com",
      directoryInternalUrl: "http://directory:8080/internal/pre-authorize",
      directoryApiKey: "api-key",
    };
    expect(() => resolveAdapters(config)).toThrow(/TELEGRAM_BOT_TOKEN/i);
  });

  it("throws when CELLO_ENV=dev but DIRECTORY_API_KEY is missing", () => {
    const config: AdapterConfig = {
      env: "dev",
      logger: makeLogger(),
      telegramBotToken: "test-token",
      sesCredentials: { accessKeyId: "key", secretAccessKey: "secret" },
      sesFromAddress: "noreply@example.com",
      directoryInternalUrl: "http://directory:8080/internal/pre-authorize",
      // directoryApiKey deliberately omitted
    };
    expect(() => resolveAdapters(config)).toThrow(/DIRECTORY_API_KEY/i);
  });
});

// ─── buildHealthReport() tests ────────────────────────────────────────────────

describe("buildHealthReport", () => {
  /**
   * AC-001: Health report includes all three health dimensions.
   */
  it("returns healthy when all checks pass", () => {
    const report = buildHealthReport({
      dbConnected: true,
      migrationVersion: 26,
      expectedMigrationVersion: 26,
      telegramConnected: true,
    });
    expect(report.healthy).toBe(true);
    expect(report.checks.database).toBe("ok");
    expect(report.checks.migrations).toBe("ok");
    expect(report.checks.telegram).toBe("ok");
  });

  it("returns unhealthy when DB is disconnected", () => {
    const report = buildHealthReport({
      dbConnected: false,
      migrationVersion: 26,
      expectedMigrationVersion: 26,
      telegramConnected: true,
    });
    expect(report.healthy).toBe(false);
    // The bare word "failed" covered a bad password, a moved address, a down connector, the wrong
    // database and a missing table — six subsystems, one string. It now carries the cause, and says
    // so explicitly when the cause was not captured rather than pretending there was none.
    expect(report.checks.database).toBe("failed (cause not captured)");
  });

  it("names the SQLSTATE behind a failed connection when one was captured", () => {
    const report = buildHealthReport({
      dbConnected: false,
      migrationVersion: null,
      expectedMigrationVersion: 26,
      telegramConnected: true,
      databaseError: '28P01: password authentication failed for user "postgres"',
    });
    expect(report.checks.database).toContain("28P01");
  });

  it("returns unhealthy when migration version does not match", () => {
    const report = buildHealthReport({
      dbConnected: true,
      migrationVersion: 25,
      expectedMigrationVersion: 26,
      telegramConnected: true,
    });
    expect(report.healthy).toBe(false);
    expect(report.checks.migrations).toMatch(/mismatch/i);
  });

  it("returns unhealthy when Telegram is unreachable", () => {
    const report = buildHealthReport({
      dbConnected: true,
      migrationVersion: 26,
      expectedMigrationVersion: 26,
      telegramConnected: false,
    });
    expect(report.healthy).toBe(false);
    expect(report.checks.telegram).toBe("failed");
  });
});
