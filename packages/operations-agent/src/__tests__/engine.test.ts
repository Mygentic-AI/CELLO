/**
 * engine.test.ts — Integration tests for RegistrationEngine end-to-end flows.
 *
 * Specification:
 *
 * AC-001: New message → RegistrationRecord created with state=AWAITING_CONTACT.
 * AC-002: Contact event → PHONE_CONFIRMED → AWAITING_EMAIL; phone_stub_hash stored.
 * AC-002b: 10-min timeout → contact prompt re-sent; state stays AWAITING_CONTACT.
 * AC-003: Valid email → OTP sent, AWAITING_EMAIL_OTP; otpHash stored (not plaintext).
 * AC-004: Correct OTP → EMAIL_CONFIRMED → PRE_AUTH_TOKEN_ISSUED, token delivered.
 * AC-005: 3 wrong OTPs → OTP invalidated; state stays AWAITING_EMAIL_OTP.
 * AC-006: Expired OTP → rejected; registration.otp.expired logged.
 * AC-008: 7-day expiry → record transitions to EXPIRED; fresh start allowed.
 * AC-009: 6th OTP send within 1 hour → rate limited; registration.otp.rate_limited logged.
 *
 * Observability:
 *   - registration.started logged with { registrationId, channel, correlationId }
 *   - registration.phone.verified logged with { registrationId, channel, correlationId }
 *   - registration.email.verified logged with { registrationId, emailDomain, correlationId }
 *   - registration.completed logged with { registrationId, tokenId, correlationId }
 *   - registration.otp.expired logged with { registrationId, correlationId }
 *   - registration.otp.rate_limited logged at WARN with { registrationId, emailDomain, sendCount, correlationId }
 *
 * Tests use real Postgres (describeIntegration) — no mock DB.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import pg from "pg";
import { RegistrationEngine } from "../registration/engine.js";
import { RegistrationRepository } from "../registration/repository.js";
import type { Logger, MessagingChannel, OtpDeliveryProvider, ChannelIdentity } from "@cello-protocol/interfaces";
import { LocalPreAuthorizationClient } from "@cello-protocol/interfaces/stubs";

const isLocal = process.env["CELLO_ENV"] === "local";
const describeIntegration = isLocal ? describe : describe.skip;

const DATABASE_URL =
  process.env["DATABASE_URL"] ?? "postgresql://postgres:dev@localhost:5433/cello_dev";

const OPS_AGENT_URL = DATABASE_URL.replace(
  /^(postgres(?:ql)?):\/\/[^:]+:[^@]+@/,
  "$1://cello_ops_agent:cello_ops_agent_dev@",
);

// ─── Test doubles ─────────────────────────────────────────────────────────────

function makeTestLogger(): { logger: Logger; events: Array<{ method: string; event: string; context?: Record<string, unknown> }> } {
  const events: Array<{ method: string; event: string; context?: Record<string, unknown> }> = [];
  const logger: Logger = {
    debug: (event, context) => events.push({ method: "debug", event, context: context as Record<string, unknown> }),
    info: (event, context) => events.push({ method: "info", event, context: context as Record<string, unknown> }),
    warn: (event, context) => events.push({ method: "warn", event, context: context as Record<string, unknown> }),
    error: (event, errorOrContext, context) => events.push({ method: "error", event, context: context as Record<string, unknown> }),
  };
  return { logger, events };
}

type SentMessage = { to: string; message: string };

function makeTestChannel(channelType: "cli" | "telegram" = "cli"): {
  channel: MessagingChannel;
  sent: SentMessage[];
  injectMessage: (from: string, message: string) => Promise<void>;
} {
  const sent: SentMessage[] = [];
  let handler: ((from: string, message: string) => void | Promise<void>) | undefined;

  const channel: MessagingChannel = {
    async send(to: string, message: string): Promise<void> {
      sent.push({ to, message });
    },
    onMessage(h): void {
      handler = h;
    },
    async resolveIdentity(from: string): Promise<ChannelIdentity> {
      if (channelType === "cli") {
        return { channel: "cli", channelUserId: from };
      }
      return { channel: "telegram", channelUserId: from, phoneNumber: "+447911" + from };
    },
  };

  async function injectMessage(from: string, message: string): Promise<void> {
    if (handler) {
      await handler(from, message);
    }
  }

  return { channel, sent, injectMessage };
}

function makeTestOtpDelivery(): { provider: OtpDeliveryProvider; captured: Array<{ emailAddress: string; otp: string }> } {
  const captured: Array<{ emailAddress: string; otp: string }> = [];
  const provider: OtpDeliveryProvider = {
    async sendOtp(emailAddress: string, otp: string): Promise<void> {
      captured.push({ emailAddress, otp });
    },
  };
  return { provider, captured };
}

// ─── Integration tests ─────────────────────────────────────────────────────────

describeIntegration("RegistrationEngine integration", () => {
  let pool: pg.Pool;
  let engine: RegistrationEngine;
  let loggerState: ReturnType<typeof makeTestLogger>;
  let channelState: ReturnType<typeof makeTestChannel>;
  let otpState: ReturnType<typeof makeTestOtpDelivery>;
  let userId: string;

  beforeEach(async () => {
    pool = new pg.Pool({ connectionString: OPS_AGENT_URL });
    loggerState = makeTestLogger();
    channelState = makeTestChannel();
    otpState = makeTestOtpDelivery();
    userId = `test-user-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    engine = new RegistrationEngine({
      pool,
      channel: channelState.channel,
      otpDelivery: otpState.provider,
      preAuth: new LocalPreAuthorizationClient(),
      logger: loggerState.logger,
      channelType: "cli",
      onError: (err) => { throw err; },
    });
    await engine.start();
  });

  afterEach(async () => {
    engine.stop();
    // Expire any active records created by this test to prevent unique index conflicts
    // on subsequent runs. We cannot DELETE (RLS), but we can transition to EXPIRED.
    try {
      const repo = new RegistrationRepository(pool);
      const active = await repo.findActiveByChannelUser("cli", userId);
      if (active) {
        await repo.transition(active.id, "EXPIRED");
      }
    } catch { /* ignore cleanup errors */ }
    await pool.end();
  });

  // ─── AC-001 ─────────────────────────────────────────────────────────────────

  it("AC-001: first message creates RegistrationRecord in AWAITING_CONTACT state", async () => {
    await channelState.injectMessage(userId, "hello");

    // If the engine had an error processing the message, surface it
    const engineErrors = loggerState.events.filter((e) => e.event === "registration.engine.error");
    if (engineErrors.length > 0) {
      throw new Error(`Engine had processing errors: ${JSON.stringify(engineErrors)}`);
    }

    // Check DB
    const repo = new RegistrationRepository(pool);
    const record = await repo.findActiveByChannelUser("cli", userId);
    expect(record).not.toBeNull();
    expect(record?.state).toBe("AWAITING_CONTACT");

    // Check outbound message requests contact sharing
    expect(channelState.sent.length).toBeGreaterThan(0);
    const welcome = channelState.sent.find((m) => m.message.toLowerCase().includes("phone"));
    expect(welcome).toBeDefined();

    // Check registration.started was logged
    const started = loggerState.events.find((e) => e.event === "registration.started");
    expect(started).toBeDefined();
    expect(started?.context?.registrationId).toBeDefined();
    expect(started?.context?.channel).toBe("cli");
    expect(started?.context?.correlationId).toBeDefined();
  });

  // ─── AC-002 ─────────────────────────────────────────────────────────────────

  it("AC-002: contact event transitions AWAITING_CONTACT → AWAITING_EMAIL with phone_stub_hash stored", async () => {
    // Create registration first
    await channelState.injectMessage(userId, "hello");

    // Send contact event (format: CONTACT:<user_id>:<phone>)
    await channelState.injectMessage(userId, `CONTACT:${userId}:+447911123456`);

    const repo = new RegistrationRepository(pool);
    const record = await repo.findActiveByChannelUser("cli", userId);
    expect(record?.state).toBe("AWAITING_EMAIL");

    // phone_stub_hash is stored — we can verify by checking it's a SHA-256 hex string
    expect(record?.phoneStubHash).toMatch(/^[0-9a-f]{64}$/);

    // registration.phone.verified was logged
    const phoneVerified = loggerState.events.find((e) => e.event === "registration.phone.verified");
    expect(phoneVerified).toBeDefined();
    expect(phoneVerified?.context?.registrationId).toBeDefined();
    expect(phoneVerified?.context?.correlationId).toBeDefined();

    // Outbound message prompts for email
    const emailPrompt = channelState.sent.find((m) => m.message.toLowerCase().includes("email"));
    expect(emailPrompt).toBeDefined();
  });

  // ─── AC-002b ─────────────────────────────────────────────────────────────────

  it("AC-002b: contact prompt re-sent when AWAITING_CONTACT sweep runs; state stays AWAITING_CONTACT; updatedAt refreshed", async () => {
    await channelState.injectMessage(userId, "hello");

    const repo = new RegistrationRepository(pool);
    const beforeRecord = await repo.findActiveByChannelUser("cli", userId);
    const originalUpdatedAt = beforeRecord!.updatedAt;
    const originalExpiresAt = beforeRecord!.expiresAt;
    const sentBefore = channelState.sent.length;

    // Small delay to ensure updated_at changes
    await new Promise((r) => setTimeout(r, 10));

    // Trigger contact prompt sweep manually
    await engine.triggerContactPromptSweep();

    const sentAfter = channelState.sent.length;
    expect(sentAfter).toBeGreaterThan(sentBefore);

    // State should still be AWAITING_CONTACT
    const record = await repo.findActiveByChannelUser("cli", userId);
    expect(record?.state).toBe("AWAITING_CONTACT");

    // updatedAt and expiresAt must be refreshed in DB (AC-002b explicit requirement)
    expect(record!.updatedAt.getTime()).toBeGreaterThan(originalUpdatedAt.getTime());
    expect(record!.expiresAt.getTime()).toBeGreaterThan(originalExpiresAt.getTime());
  });

  // ─── AC-003 ─────────────────────────────────────────────────────────────────

  it("AC-003: valid email → OTP sent, AWAITING_EMAIL_OTP; otpHash stored not plaintext OTP", async () => {
    await channelState.injectMessage(userId, "hello");
    await channelState.injectMessage(userId, `CONTACT:${userId}:+447911111111`);
    await channelState.injectMessage(userId, "user@example.com");

    const repo = new RegistrationRepository(pool);
    const record = await repo.findActiveByChannelUser("cli", userId);
    expect(record?.state).toBe("AWAITING_EMAIL_OTP");
    if (record?.state !== "AWAITING_EMAIL_OTP") throw new Error("type guard");

    // OTP was delivered
    expect(otpState.captured.length).toBe(1);
    expect(otpState.captured[0].emailAddress).toBe("user@example.com");
    const deliveredOtp = otpState.captured[0].otp;
    expect(deliveredOtp).toMatch(/^\d{6}$/);

    // Stored hash is NOT the plaintext OTP (SI-001)
    expect(record.otpHash).not.toBe(deliveredOtp);
    expect(record.otpHash).not.toMatch(/^\d{6}$/);
    expect(record.otpHash).toMatch(/^[0-9a-f]{64}$/);

    // otpExpiresAt is ~15 minutes from now
    const expiresInMs = record.otpExpiresAt.getTime() - Date.now();
    expect(expiresInMs).toBeGreaterThan(14 * 60 * 1000);
    expect(expiresInMs).toBeLessThan(16 * 60 * 1000);
  });

  // ─── AC-003b ─────────────────────────────────────────────────────────────────

  it("AC-003b: invalid email → state stays AWAITING_EMAIL, no OTP generated", async () => {
    await channelState.injectMessage(userId, "hello");
    await channelState.injectMessage(userId, `CONTACT:${userId}:+447911111111`);
    await channelState.injectMessage(userId, "not an email");

    const repo = new RegistrationRepository(pool);
    const record = await repo.findActiveByChannelUser("cli", userId);
    expect(record?.state).toBe("AWAITING_EMAIL");
    expect(otpState.captured.length).toBe(0);

    // Error message sent
    const errorMsg = channelState.sent.find((m) =>
      m.message.toLowerCase().includes("valid email")
    );
    expect(errorMsg).toBeDefined();
  });

  // ─── AC-004 ─────────────────────────────────────────────────────────────────

  it("AC-004: correct OTP → EMAIL_CONFIRMED → PRE_AUTH_TOKEN_ISSUED, token delivered", async () => {
    await channelState.injectMessage(userId, "hello");
    await channelState.injectMessage(userId, `CONTACT:${userId}:+447911111111`);
    await channelState.injectMessage(userId, "user@example.com");

    // Get the OTP from the delivery provider capture
    const otp = otpState.captured[0].otp;
    await channelState.injectMessage(userId, otp);

    // Check terminal state in DB (loadAllActive won't find it since it's terminal)
    // Use direct query to find by channelUserId
    const rawResult = await pool.query(
      `SELECT state FROM registrations WHERE channel_user_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [userId],
    );
    expect(rawResult.rows[0].state).toBe("PRE_AUTH_TOKEN_ISSUED");

    // Token was sent to user
    const tokenMsg = channelState.sent.find((m) => m.message.includes("DEV-CELLO-"));
    expect(tokenMsg).toBeDefined();

    // Observability
    const emailVerified = loggerState.events.find((e) => e.event === "registration.email.verified");
    expect(emailVerified?.context?.emailDomain).toBe("example.com");
    expect(emailVerified?.context?.correlationId).toBeDefined();

    const completed = loggerState.events.find((e) => e.event === "registration.completed");
    expect(completed?.context?.tokenId).toBeDefined();
    expect(completed?.context?.correlationId).toBeDefined();
  });

  // ─── AC-005 ─────────────────────────────────────────────────────────────────

  it("AC-005: 3 wrong OTPs → transitions to AWAITING_EMAIL; user can request new OTP and complete", async () => {
    await channelState.injectMessage(userId, "hello");
    await channelState.injectMessage(userId, `CONTACT:${userId}:+447911111111`);
    await channelState.injectMessage(userId, "user@example.com");
    const firstOtp = otpState.captured[0].otp;

    // 3 wrong OTP attempts
    await channelState.injectMessage(userId, "000000");
    await channelState.injectMessage(userId, "111111");
    await channelState.injectMessage(userId, "222222");

    // After lockout, state transitions to AWAITING_EMAIL (not AWAITING_EMAIL_OTP)
    const repo = new RegistrationRepository(pool);
    const afterLockout = await repo.findActiveByChannelUser("cli", userId);
    expect(afterLockout?.state).toBe("AWAITING_EMAIL");
    // attemptCount reset to 0 on the AWAITING_EMAIL transition
    // (can be verified via direct DB query since RegistrationRecord doesn't surface it for AWAITING_EMAIL)
    const rawRow = await pool.query(
      `SELECT otp_attempt_count FROM registrations WHERE id = $1`,
      [afterLockout!.id],
    );
    expect(rawRow.rows[0].otp_attempt_count).toBe(0);

    // User was informed
    const invalidMsg = channelState.sent.find((m) =>
      m.message.toLowerCase().includes("invalidated") ||
      m.message.toLowerCase().includes("new")
    );
    expect(invalidMsg).toBeDefined();

    // User provides email again — new OTP cycle
    await channelState.injectMessage(userId, "user@example.com");
    const secondOtp = otpState.captured[1]?.otp;
    expect(secondOtp).toBeDefined();
    expect(secondOtp).not.toBe(firstOtp); // New OTP generated

    // User provides correct new OTP — should complete
    await channelState.injectMessage(userId, secondOtp!);
    const finalRow = await pool.query(
      `SELECT state FROM registrations WHERE id = $1`,
      [afterLockout!.id],
    );
    expect(finalRow.rows[0].state).toBe("PRE_AUTH_TOKEN_ISSUED");
  });

  // ─── AC-006 ─────────────────────────────────────────────────────────────────

  it("AC-006: expired OTP rejected; registration.otp.expired logged", async () => {
    await channelState.injectMessage(userId, "hello");
    await channelState.injectMessage(userId, `CONTACT:${userId}:+447911111111`);
    await channelState.injectMessage(userId, "user@example.com");

    // Manually expire the OTP by directly updating the DB
    await pool.query(
      `UPDATE registrations SET otp_expires_at = $1 WHERE channel_user_id = $2`,
      [new Date(Date.now() - 1000), userId],
    );

    const otp = otpState.captured[0].otp;
    await channelState.injectMessage(userId, otp);

    // OTP expired event was logged
    const expiredEvent = loggerState.events.find((e) => e.event === "registration.otp.expired");
    expect(expiredEvent).toBeDefined();
    expect(expiredEvent?.context?.registrationId).toBeDefined();
    expect(expiredEvent?.context?.correlationId).toBeDefined();

    // User was informed
    const expiredMsg = channelState.sent.find((m) =>
      m.message.toLowerCase().includes("expired")
    );
    expect(expiredMsg).toBeDefined();
  });

  // ─── AC-008 ─────────────────────────────────────────────────────────────────

  it("AC-008: 7-day expired record transitions to EXPIRED; new message starts fresh", async () => {
    // Create a registration with expiresAt in the past
    const repo = new RegistrationRepository(pool);
    const record = await repo.insert({
      phoneStubHash: "expired-phone-hash",
      channel: "cli",
      channelUserId: userId,
      state: "INITIAL",
      expiresAt: new Date(Date.now() - 1000), // already expired
    });
    await repo.transition(record.id, "AWAITING_CONTACT");

    // Send a message — should detect expiry and then create fresh registration
    await channelState.injectMessage(userId, "hello again");

    // registration.expired should be logged
    const expiredEvent = loggerState.events.find((e) => e.event === "registration.expired");
    expect(expiredEvent).toBeDefined();
    expect(expiredEvent?.context?.registrationId).toBe(record.id);

    // A new registration should have been started (registration.started)
    const startedEvents = loggerState.events.filter((e) => e.event === "registration.started");
    expect(startedEvents.length).toBeGreaterThan(0);
  });

  // ─── AC-009 ─────────────────────────────────────────────────────────────────

  it("AC-009: 6th OTP send within 1 hour is rate-limited; registration.otp.rate_limited logged", async () => {
    await channelState.injectMessage(userId, "hello");
    await channelState.injectMessage(userId, `CONTACT:${userId}:+447911111111`);

    // Send 5 emails (each triggers an OTP send)
    for (let i = 1; i <= 5; i++) {
      await channelState.injectMessage(userId, `user${i}@example.com`);
      // After each failed OTP, need to go back to AWAITING_EMAIL
      // Actually the state machine stays in AWAITING_EMAIL_OTP after first send
      // So we need to request from the same email domain — but the state machine
      // transitions to AWAITING_EMAIL_OTP after first email.
      // The rate limit is per email domain, tested on successive requests within same state.
      // For this test, let's reset state to AWAITING_EMAIL after each OTP to trigger 6 sends.
      const repo = new RegistrationRepository(pool);
      const active = await repo.findActiveByChannelUser("cli", userId);
      if (active && active.state !== "AWAITING_EMAIL") {
        await repo.transition(active.id, "AWAITING_EMAIL");
      }
    }

    // 6th attempt
    await channelState.injectMessage(userId, "user6@example.com");

    const rateLimitedEvent = loggerState.events.find((e) => e.event === "registration.otp.rate_limited");
    expect(rateLimitedEvent).toBeDefined();
    expect(rateLimitedEvent?.method).toBe("warn");
    expect(rateLimitedEvent?.context?.registrationId).toBeDefined();
    expect(rateLimitedEvent?.context?.emailDomain).toBe("example.com");
    // sendCount is the number of successful sends when the limit was reached (5 successful, 6th refused)
    expect(rateLimitedEvent?.context?.sendCount).toBe(5);
    expect(rateLimitedEvent?.context?.correlationId).toBeDefined();
  });
});
