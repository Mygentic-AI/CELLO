/**
 * restart.test.ts — AC-007 + AC-010 integration gate: restart recovery.
 *
 * Specification:
 *
 * AC-007: On restart, all in-flight registrations are loaded from Postgres.
 *   - registration.state.recovered is logged for each record.
 *   - No correlationId in the log event (startup, no active flow).
 *   - Exactly one RegistrationRecord row exists with the original id.
 *   - User can continue from AWAITING_EMAIL_OTP without restarting registration.
 *
 * AC-010: Full flow from INITIAL to PRE_AUTH_TOKEN_ISSUED, then restart, then resume.
 *   - Complete flow against real Postgres.
 *   - Token from LocalPreAuthorizationClient matches DEV-CELLO- format.
 *   - After restart, recovered record is in AWAITING_EMAIL_OTP state.
 *   - Operator can complete by providing the OTP.
 *
 * Restart simulation: stop the engine (clearing timers), create a NEW engine instance
 * with the same database pool, and start it — simulating a process restart without
 * forking an actual OS process. The new instance has no in-memory state.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { RegistrationEngine } from "../registration/engine.js";
import { RegistrationRepository } from "../registration/repository.js";
import type { MessagingChannel, OtpDeliveryProvider, ChannelIdentity, Logger } from "@cello-protocol/interfaces";
import { LocalPreAuthorizationClient } from "@cello-protocol/interfaces/stubs";

const isLocal = process.env["CELLO_ENV"] === "local";
const describeIntegration = isLocal ? describe : describe.skip;

const DATABASE_URL =
  process.env["DATABASE_URL"] ?? "postgresql://postgres:dev@localhost:5433/cello_dev";

const OPS_AGENT_URL = DATABASE_URL.replace(
  /^(postgres(?:ql)?):\/\/[^:]+:[^@]+@/,
  "$1://cello_ops_agent:cello_ops_agent_dev@",
);

// ─── Test helpers ─────────────────────────────────────────────────────────────

type LogEvent = { method: string; event: string; context?: Record<string, unknown> };

function makeLogger(): { logger: Logger; events: LogEvent[] } {
  const events: LogEvent[] = [];
  const logger: Logger = {
    debug: (event, context) => events.push({ method: "debug", event, context: context as Record<string, unknown> }),
    info: (event, context) => events.push({ method: "info", event, context: context as Record<string, unknown> }),
    warn: (event, context) => events.push({ method: "warn", event, context: context as Record<string, unknown> }),
    error: (event) => events.push({ method: "error", event }),
  };
  return { logger, events };
}

type SentMessage = { to: string; message: string };

function makeChannel(): {
  channel: MessagingChannel;
  sent: SentMessage[];
  inject: (from: string, msg: string) => Promise<void>;
} {
  const sent: SentMessage[] = [];
  let handler: ((from: string, message: string) => void | Promise<void>) | undefined;
  const channel: MessagingChannel = {
    async send(to, message) { sent.push({ to, message }); },
    onMessage(h) { handler = h; },
    async resolveIdentity(from): Promise<ChannelIdentity> {
      return { channel: "cli", channelUserId: from };
    },
  };
  return { channel, sent, inject: async (from, msg) => { if (handler) await handler(from, msg); } };
}

function makeOtpCapture(): { provider: OtpDeliveryProvider; captured: Array<{ emailAddress: string; otp: string }> } {
  const captured: Array<{ emailAddress: string; otp: string }> = [];
  return {
    provider: {
      async sendOtp(emailAddress, otp) { captured.push({ emailAddress, otp }); },
    },
    captured,
  };
}

// ─── AC-007 + AC-010: Restart recovery ───────────────────────────────────────

describeIntegration("restart recovery (AC-007, AC-010)", () => {
  let pool: pg.Pool;

  beforeAll(() => {
    pool = new pg.Pool({ connectionString: OPS_AGENT_URL });
  });

  afterAll(async () => {
    await pool.end();
  });

  it("AC-007: recovered state logged at startup, user can continue from AWAITING_EMAIL_OTP", async () => {
    const userId = `restart-test-${Date.now()}`;
    const log1 = makeLogger();
    const ch1 = makeChannel();
    const otp1 = makeOtpCapture();

    // ── Phase 1: Drive to AWAITING_EMAIL_OTP ─────────────────────────────────
    const engine1 = new RegistrationEngine({
      pool,
      channel: ch1.channel,
      otpDelivery: otp1.provider,
      preAuth: new LocalPreAuthorizationClient(),
      logger: log1.logger,
      channelType: "cli",
    });
    await engine1.start();

    // Use userId-derived phone to avoid phone_stub_hash unique constraint conflicts
    // across test runs when a prior run left an active record.
    const phone1 = `+1${userId.replace(/\D/g, "").slice(0, 10).padEnd(10, "0")}`;
    await ch1.inject(userId, "hello");
    await ch1.inject(userId, `CONTACT:${userId}:${phone1}`);
    await ch1.inject(userId, "restart@example.com");

    // Verify we're in AWAITING_EMAIL_OTP
    const repo = new RegistrationRepository(pool);
    const mid = await repo.findActiveByChannelUser("cli", userId);
    expect(mid?.state).toBe("AWAITING_EMAIL_OTP");
    const originalId = mid!.id;
    const capturedOtp = otp1.captured[0].otp;

    // ── Phase 2: Kill engine (simulates process restart) ──────────────────────
    engine1.stop();

    // ── Phase 3: New engine instance — restart simulation ────────────────────
    const log2 = makeLogger();
    const ch2 = makeChannel();
    const otp2 = makeOtpCapture();

    const engine2 = new RegistrationEngine({
      pool,
      channel: ch2.channel,
      otpDelivery: otp2.provider,
      preAuth: new LocalPreAuthorizationClient(),
      logger: log2.logger,
      channelType: "cli",
    });
    await engine2.start();

    // registration.state.recovered must be logged with { registrationId, state }
    // and NO correlationId (startup recovery has no active flow)
    const recoveredEvents = log2.events.filter((e) => e.event === "registration.state.recovered");
    expect(recoveredEvents.length).toBeGreaterThanOrEqual(1);

    const ourRecoveredEvent = recoveredEvents.find(
      (e) => e.context?.registrationId === originalId,
    );
    expect(ourRecoveredEvent).toBeDefined();
    expect(ourRecoveredEvent?.context?.state).toBe("AWAITING_EMAIL_OTP");
    // correlationId must NOT be present (AC-007 spec — startup recovery has no active flow)
    expect(ourRecoveredEvent?.context).toBeDefined();
    expect(ourRecoveredEvent!.context!["correlationId"]).toBeUndefined();

    // ── Phase 4: Verify exactly one record with original id ──────────────────
    const rawResult = await pool.query(
      `SELECT COUNT(*) FROM registrations WHERE id = $1`,
      [originalId],
    );
    expect(parseInt(rawResult.rows[0].count, 10)).toBe(1);

    // ── Phase 5: User continues from AWAITING_EMAIL_OTP ──────────────────────
    await ch2.inject(userId, capturedOtp);

    // Should complete to PRE_AUTH_TOKEN_ISSUED
    const finalResult = await pool.query(
      `SELECT state FROM registrations WHERE id = $1`,
      [originalId],
    );
    expect(finalResult.rows[0].state).toBe("PRE_AUTH_TOKEN_ISSUED");

    // Token was delivered
    const tokenMsg = ch2.sent.find((m) => m.message.includes("DEV-CELLO-"));
    expect(tokenMsg).toBeDefined();

    engine2.stop();
  });

  // ─── AC-010: Full flow integration gate ────────────────────────────────────

  it("AC-010: full flow INITIAL→PRE_AUTH_TOKEN_ISSUED with restart, DEV-CELLO- token format", async () => {
    const userId = `ac010-${Date.now()}`;
    const log1 = makeLogger();
    const ch1 = makeChannel();
    const otp1 = makeOtpCapture();

    const engine1 = new RegistrationEngine({
      pool,
      channel: ch1.channel,
      otpDelivery: otp1.provider,
      preAuth: new LocalPreAuthorizationClient(),
      logger: log1.logger,
      channelType: "cli",
    });
    await engine1.start();

    // Drive through full flow
    const phone2 = `+1${userId.replace(/\D/g, "").slice(0, 10).padEnd(10, "0")}`;
    await ch1.inject(userId, "start");
    await ch1.inject(userId, `CONTACT:${userId}:${phone2}`);
    await ch1.inject(userId, "operator@mycompany.io");

    // Pause before completing OTP — simulate restart here
    engine1.stop();

    const repo = new RegistrationRepository(pool);
    const paused = await repo.findActiveByChannelUser("cli", userId);
    expect(paused?.state).toBe("AWAITING_EMAIL_OTP");
    const originalId = paused!.id;
    const capturedOtp = otp1.captured[0].otp;

    // Restart
    const log2 = makeLogger();
    const ch2 = makeChannel();
    const otp2 = makeOtpCapture();

    const engine2 = new RegistrationEngine({
      pool,
      channel: ch2.channel,
      otpDelivery: otp2.provider,
      preAuth: new LocalPreAuthorizationClient(),
      logger: log2.logger,
      channelType: "cli",
    });
    await engine2.start();

    // Verify recovery
    const recovered = log2.events.filter((e) => e.event === "registration.state.recovered");
    expect(recovered.some((e) => e.context?.registrationId === originalId)).toBe(true);

    // Complete OTP
    await ch2.inject(userId, capturedOtp);

    // Verify terminal state
    const final = await pool.query(
      `SELECT state FROM registrations WHERE id = $1`,
      [originalId],
    );
    expect(final.rows[0].state).toBe("PRE_AUTH_TOKEN_ISSUED");

    // Token format: DEV-CELLO- + 16 hex chars
    const tokenMsg = ch2.sent.find((m) => m.message.includes("DEV-CELLO-"));
    expect(tokenMsg).toBeDefined();
    expect(tokenMsg?.message).toMatch(/DEV-CELLO-[0-9a-f]{16}/);

    // registration.completed was logged with tokenId
    const completedEvent = log2.events.find((e) => e.event === "registration.completed");
    expect(completedEvent).toBeDefined();
    expect(completedEvent?.context?.tokenId).toBeDefined();

    engine2.stop();
  });
});
