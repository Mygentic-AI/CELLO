/**
 * engine.test.ts — Integration tests for RegistrationEngine end-to-end flows.
 *
 * Specification:
 *
 * AC-001: New message → RegistrationRecord created with state=AWAITING_CONTACT.
 * AC-002: Contact event → PHONE_CONFIRMED → AWAITING_EMAIL; phone_stub_hash stored.
 * AC-002b: a DUE reminder is re-sent; state stays AWAITING_CONTACT; the expiry clock does NOT move.
 *   Bounded at two reminders per cycle by DOD-M15-CONTACTNAG-1 — see dod-m15-contactnag-1.test.ts.
 * AC-003: Valid email → OTP sent, AWAITING_EMAIL_OTP; otpHash stored (not plaintext).
 * AC-004: Correct OTP → EMAIL_CONFIRMED → PRE_AUTH_TOKEN_ISSUED, token delivered.
 * AC-005: 3 wrong OTPs → OTP invalidated; state transitions to AWAITING_EMAIL; new OTP cycle possible.
 * AC-006: Expired OTP → rejected; registration.otp.expired logged.
 * AC-008: 7-day expiry → record transitions to EXPIRED; fresh start allowed.
 * AC-009: 6th OTP send by ONE REQUESTER within 1 hour → rate limited (DOD-M15-SIGNUP-1: per
 *   requester, not per domain and not per address — the address is the target, not the sender).
 *
 * Observability:
 *   - registration.started logged with { registrationId, channel, correlationId }
 *   - registration.phone.verified logged with { registrationId, channel, correlationId }
 *   - registration.email.verified logged with { registrationId, correlationId }
 *   - registration.completed logged with { registrationId, tokenId, correlationId }
 *   - registration.otp.expired logged with { registrationId, correlationId }
 *   - registration.otp.rate_limited logged at WARN with { registrationId, sendCount, correlationId }
 *     (DOD-M15-SIGNUP-1: no emailDomain — the limiter keys on the REQUESTER, and the domain is gone)
 *
 * Tests use real Postgres (describeIntegration) — no mock DB.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import pg from "pg";
import { RegistrationEngine } from "../registration/engine.js";
import { RegistrationRepository } from "../registration/repository.js";
import type { Logger, MessagingChannel, OtpDeliveryProvider, ChannelIdentity, PreAuthorizationClient } from "@cello-protocol/interfaces";
import { LocalPreAuthorizationClient } from "@cello-protocol/interfaces/stubs";
import { PreAuthRequestError } from "../directory-pre-auth-client.js";

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
      for (const u of [userId, ...waveUsers]) {
        const active = await repo.findActiveByChannelUser("cli", u);
        if (active) await repo.transition(active.id, "EXPIRED");
      }
      waveUsers.length = 0;
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

  it("AC-002b: a DUE reminder is re-sent; state stays AWAITING_CONTACT; the expiry clock does NOT move", async () => {
    await channelState.injectMessage(userId, "hello");

    const repo = new RegistrationRepository(pool);
    const beforeRecord = await repo.findActiveByChannelUser("cli", userId);
    const originalUpdatedAt = beforeRecord!.updatedAt;
    const originalExpiresAt = beforeRecord!.expiresAt;
    const sentBefore = channelState.sent.length;

    // Age the cycle past the 10-minute first-reminder delay. The sweep is now a clock, not a
    // trigger: without this the correct behaviour is to stay silent.
    await repo.recordContactPrompt(beforeRecord!.id, 0, new Date(Date.now() - 11 * 60_000));

    await engine.triggerContactPromptSweep();

    const sentAfter = channelState.sent.length;
    expect(sentAfter).toBeGreaterThan(sentBefore);

    // State should still be AWAITING_CONTACT
    const record = await repo.findActiveByChannelUser("cli", userId);
    expect(record?.state).toBe("AWAITING_CONTACT");

    // updatedAt still moves — a reminder IS an event on the record.
    expect(record!.updatedAt.getTime()).toBeGreaterThan(originalUpdatedAt.getTime());

    // But expiresAt must NOT. THIS ASSERTION IS INVERTED FROM WHAT IT USED TO BE, on purpose.
    // AC-002b previously REQUIRED the re-prompt to push expiry forward ("prevent 7-day expiry"),
    // and that requirement is what made the loop unkillable: the only clock that could retire a
    // stalled record was reset by the very messages that should have stopped. A test asserting the
    // defect is worse than no test, because it defends it (DOD-M15-CONTACTNAG-1).
    expect(record!.expiresAt.getTime()).toBe(originalExpiresAt.getTime());
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

    // OA-1: the token is delivered as TWO messages — ① runnable instructions with the token inlined
    // into the real `cello register-agent` command, ② the bare token alone for clean one-tap copy.
    const instr = channelState.sent.find((m) => m.message.includes("cello register-agent [YOUR_NAME] DEV-CELLO-"));
    expect(instr).toBeDefined();
    // teeth: the old copy named CELLO_REGISTRATION_TOKEN (an env var the CLI reads nowhere) and gave
    // no runnable command — a literal follower was dead in the water. Both must be gone/present now.
    expect(instr!.message).not.toContain("CELLO_REGISTRATION_TOKEN");
    expect(instr!.message).toContain("cello create-agent [YOUR_NAME]");
    // teeth for the SECOND instance of the same cross-repo drift: the D-ENVVAR fix replaced the wrong
    // env var with a command that does not exist either. `cello register` is not a CLI verb — the
    // registry names `register-agent` — so a literal follower still hit an unknown command.
    expect(instr!.message).not.toMatch(/cello register(?!-agent)/);
    // A brand-new user has no CLI at all: the plugin ships the MCP shim only. Naming `cello login`
    // without the install that provides `cello` is the same dead end one step earlier.
    expect(instr!.message).toContain("npm install -g @cello-protocol/cli @cello-protocol/connect");
    // This message is the ONLY instruction a new user gets, so it must carry the whole path. It used
    // to stop at `cello status` — leaving them a registered agent that Claude Code could not see,
    // because nothing had mentioned the plugin. Pin all three steps.
    expect(instr!.message).toContain("/plugin marketplace add Mygentic-AI/cello-client");
    expect(instr!.message).toContain("/plugin install cello@cello-protocol");
    expect(instr!.message).toContain("/mcp");
    // Without the channels flag CELLO works but nothing ever wakes the session — the user has to
    // poll by hand and will conclude nobody is messaging them. It is a startup flag, so it cannot
    // be set after the fact, which is why it belongs in the one message they get (Andre, 2026-08-09).
    expect(instr!.message).toContain("claude --channels plugin:cello@cello-protocol");
    // The flag silently does not register unless CELLO is on the channels allowlist, so the message
    // must name that banner — a step that looks done and is not is the failure mode of this whole item.
    expect(instr!.message).toContain("not on the approved channels allowlist");
    // ② the bare-token message exists, equal to just the token (one-tap copy).
    const token = instr!.message.match(/DEV-CELLO-\S+/)![0];
    const bareToken = channelState.sent.find((m) => m.message === token);
    expect(bareToken).toBeDefined();

    // Observability
    const emailVerified = loggerState.events.find((e) => e.event === "registration.email.verified");
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

  // ─── AC-006 dead-end recovery ───────────────────────────────────────────────
  // The AC-006 test above proves the expired code is REJECTED. It never proved the operator can
  // RECOVER — which is why the dead-end survived it. These two drive expiry/invalidation all the
  // way through to a completed registration. Both fail without the AWAITING_EMAIL transition.

  it("AC-006: expired OTP → transitions to AWAITING_EMAIL; user re-enters email and completes (no dead-end)", async () => {
    await channelState.injectMessage(userId, "hello");
    await channelState.injectMessage(userId, `CONTACT:${userId}:+447911111111`);
    await channelState.injectMessage(userId, "user@example.com");

    await pool.query(
      `UPDATE registrations SET otp_expires_at = $1 WHERE channel_user_id = $2`,
      [new Date(Date.now() - 1000), userId],
    );

    const firstOtp = otpState.captured[0].otp;
    await channelState.injectMessage(userId, firstOtp);

    // The record MUST leave AWAITING_EMAIL_OTP. Before the fix it stayed, so every subsequent
    // message — including the email the notice asks for — replayed the expiry notice forever.
    const repo = new RegistrationRepository(pool);
    const afterExpiry = await repo.findActiveByChannelUser("cli", userId);
    expect(afterExpiry?.state).toBe("AWAITING_EMAIL");

    // The notice tells them how to recover, not just that they failed.
    const guidance = channelState.sent.find((m) =>
      m.message.toLowerCase().includes("expired") && m.message.toLowerCase().includes("email"),
    );
    expect(guidance).toBeDefined();

    // Recovery: re-entering the email issues a FRESH code that completes registration.
    await channelState.injectMessage(userId, "user@example.com");
    const secondOtp = otpState.captured[1]?.otp;
    expect(secondOtp).toBeDefined();
    expect(secondOtp).not.toBe(firstOtp);

    await channelState.injectMessage(userId, secondOtp!);
    const finalRow = await pool.query(
      `SELECT state FROM registrations WHERE id = $1`,
      [afterExpiry!.id],
    );
    expect(finalRow.rows[0].state).toBe("PRE_AUTH_TOKEN_ISSUED");
  });

  it("AC-006b: cleared OTP hash → transitions to AWAITING_EMAIL; recovery works (no dead-end)", async () => {
    await channelState.injectMessage(userId, "hello");
    await channelState.injectMessage(userId, `CONTACT:${userId}:+447911111111`);
    await channelState.injectMessage(userId, "user@example.com");
    const firstOtp = otpState.captured[0].otp;

    // The cleared-OTP sentinel: otp_hash NULL while the state is still AWAITING_EMAIL_OTP. The
    // !otpHash branch runs before the expiry check; before the fix it returned unchanged.
    await pool.query(
      `UPDATE registrations SET otp_hash = NULL WHERE channel_user_id = $1`,
      [userId],
    );

    await channelState.injectMessage(userId, "anything");

    const repo = new RegistrationRepository(pool);
    const after = await repo.findActiveByChannelUser("cli", userId);
    expect(after?.state).toBe("AWAITING_EMAIL");

    await channelState.injectMessage(userId, "user@example.com");
    const secondOtp = otpState.captured[1]?.otp;
    expect(secondOtp).toBeDefined();
    expect(secondOtp).not.toBe(firstOtp);

    await channelState.injectMessage(userId, secondOtp!);
    const finalRow = await pool.query(
      `SELECT state FROM registrations WHERE id = $1`,
      [after!.id],
    );
    expect(finalRow.rows[0].state).toBe("PRE_AUTH_TOKEN_ISSUED");
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

  // ─── H-001: registration.engine.error context fields ─────────────────────────

  it("H-001: registration.engine.error emits error.message and error.stack as context fields", async () => {
    // Inject a channel whose resolveIdentity always throws — this causes the engine's
    // inbound message handler to catch the error and emit registration.engine.error
    // with { "error.message", "error.stack" } as explicit context fields.
    const faultyChannelState = makeTestChannel();
    const { logger: faultyLogger, events: faultyEvents } = makeTestLogger();
    const faultyChannelWithThrow: MessagingChannel = {
      async send() {},
      onMessage(h) { faultyChannelState.channel.onMessage(h); },
      async resolveIdentity() { throw new Error("test-identity-failure"); },
    };

    const faultyEngine = new RegistrationEngine({
      pool,
      channel: faultyChannelWithThrow,
      otpDelivery: otpState.provider,
      preAuth: new LocalPreAuthorizationClient(),
      logger: faultyLogger,
      channelType: "cli",
      // No onError rethrow — let the engine log and continue
    });
    await faultyEngine.start();

    const faultyUserId = `fault-h001-${Date.now()}`;
    await faultyChannelState.injectMessage(faultyUserId, "hello");

    const engineErrorEvent = faultyEvents.find((e) => e.event === "registration.engine.error");
    expect(engineErrorEvent).toBeDefined();
    expect(engineErrorEvent?.context?.["error.message"]).toBe("test-identity-failure");
    expect(typeof engineErrorEvent?.context?.["error.stack"]).toBe("string");

    faultyEngine.stop();
  });

  // ─── AC-005b (OPS-AGENT-005B) — directory pre-auth failure ──────────────────
  // When the directory is unreachable, the state machine must:
  //   (1) keep the record in EMAIL_CONFIRMED state (not advance or regress),
  //   (2) log registration.preauth.request.failed at ERROR with { registrationId, httpStatus, correlationId },
  //   (3) send the user an error message asking them to try again later.

  it("AC-005b: directory pre-auth failure → EMAIL_CONFIRMED preserved, user notified, event logged", async () => {
    // Use an engine with a failing PreAuthorizationClient
    const failingPreAuth: PreAuthorizationClient = {
      async requestToken() {
        throw new PreAuthRequestError("connection refused", 503);
      },
    };

    const { logger: failLogger, events: failEvents } = makeTestLogger();
    const { channel: failChannel, sent: failSent, injectMessage: failInject } = makeTestChannel();
    const { provider: failOtp, captured: failCaptured } = makeTestOtpDelivery();

    const failUserId = `fail-preauth-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    const failEngine = new RegistrationEngine({
      pool,
      channel: failChannel,
      otpDelivery: failOtp,
      preAuth: failingPreAuth,
      logger: failLogger,
      channelType: "cli",
      onError: (err) => { throw err; },
    });
    await failEngine.start();
    try {
      // Drive to AWAITING_EMAIL_OTP
      await failInject(failUserId, "hello");
      await failInject(failUserId, `CONTACT:${failUserId}:+447911999000`);
      await failInject(failUserId, "user@fail-test.com");

      // Get OTP and submit the correct one — triggers requestToken() which throws
      const otp = failCaptured[0].otp;
      await failInject(failUserId, otp);

      // (1) State must be EMAIL_CONFIRMED — not PRE_AUTH_TOKEN_ISSUED, not FAILED
      const rawRow = await pool.query(
        `SELECT state FROM registrations WHERE channel_user_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [failUserId],
      );
      expect(rawRow.rows[0].state).toBe("EMAIL_CONFIRMED");

      // (2) registration.preauth.request.failed logged at ERROR with all required fields
      const failedEvent = failEvents.find((e) => e.event === "registration.preauth.request.failed");
      expect(failedEvent).toBeDefined();
      expect(failedEvent?.method).toBe("error");
      expect(failedEvent?.context?.registrationId).toBeDefined();
      expect(failedEvent?.context?.httpStatus).toBe(503);
      expect(failedEvent?.context?.correlationId).toBeDefined();

      // (3) User received an error message (non-retryable server error, not "try again")
      const errorMsg = failSent.find((m) =>
        m.message.toLowerCase().includes("server error") &&
        m.message.toLowerCase().includes("support")
      );
      expect(errorMsg).toBeDefined();
    } finally {
      failEngine.stop();
      try {
        const repo = new RegistrationRepository(pool);
        const active = await repo.findActiveByChannelUser("cli", failUserId);
        if (active) await repo.transition(active.id, "EXPIRED");
      } catch { /* ignore cleanup errors */ }
    }
  });

  // ─── AC-009 ─────────────────────────────────────────────────────────────────

  /**
   * DOD-M15-SIGNUP-1 — this AC encoded the defect, and my first correction encoded a worse one.
   *
   * ORIGINALLY it sent `user1@example.com` … `user6@example.com` and asserted the sixth was
   * refused. That only passes under DOMAIN keying, so it pinned the bug — strangers throttling each
   * other. But it was never "six people": all six came from ONE `userId`. It was one requester
   * asking for codes to six addresses, which is the ABUSE case, and it was the only test in the
   * repo constraining it.
   *
   * MY FIRST FIX made it worse. Rekeying to the email address and rewriting this test to assert
   * that six addresses from one user are all allowed deleted the only coverage of per-requester
   * throttling and replaced it with an assertion that per-requester throttling must NOT happen.
   * The test forbade the fix.
   *
   * The dimension these must separate is REQUESTER vs TARGET, and the three below do: one requester
   * is capped however many addresses they use, normalization cannot buy a fresh budget, and
   * different requesters never affect each other however much they share.
   */
  const resetToAwaitingEmail = async (user: string): Promise<void> => {
    // After each OTP send the record moves to AWAITING_EMAIL_OTP. Reset via the repo between sends.
    //
    // NOTE, because it changes what the abuse case COSTS: production offers no direct route back to
    // AWAITING_EMAIL. A real attacker pays three wrong OTPs or a 15-minute expiry per address — so
    // roughly four messages each, not one. That makes the abuse slower than these tests, never
    // impossible, and it is why the cap matters rather than being theatre.
    const repo = new RegistrationRepository(pool);
    const active = await repo.findActiveByChannelUser("cli", user);
    if (active && active.state !== "AWAITING_EMAIL") {
      await repo.transition(active.id, "AWAITING_EMAIL");
    }
  };

  /** Extra channel users a test enrolled, expired in afterEach so they cannot collide next run. */
  const waveUsers: string[] = [];

  const enrol = async (user: string, phone: string): Promise<void> => {
    await channelState.injectMessage(user, "hello");
    await channelState.injectMessage(user, `CONTACT:${user}:+${phone}`);
  };

  it("AC-009: ONE requester is capped at 5 codes an hour — even across different addresses", async () => {
    // The abuse case. Each address is a real "Your verification code is NNNNNN" email from CELLO's
    // verified sender to whoever owns it, so the cap has to follow the person asking, not the
    // address asked for. Deliberately SIX DIFFERENT addresses: keying on the address gives each its
    // own budget and lets this run forever.
    await enrol(userId, "447911111111");

    // SIX DIFFERENT DOMAINS. With all six on one domain, restoring the domain key still refuses the
    // sixth and this test would pass unchanged — it would be detecting a log field, not the key.
    const targets = ["a.example", "b.example", "c.test", "d.test", "e.invalid", "f.invalid"];
    for (let i = 0; i < 5; i++) {
      await channelState.injectMessage(userId, `victim@${targets[i]}`);
      await resetToAwaitingEmail(userId);
    }
    await channelState.injectMessage(userId, `victim@${targets[5]}`);

    const limited = loggerState.events.find((e) => e.event === "registration.otp.rate_limited");
    expect(limited, "a sixth code request from one person must be refused").toBeDefined();
    expect(limited?.method).toBe("warn");
    expect(limited?.context?.registrationId).toBeDefined();
    expect(limited?.context?.correlationId).toBeDefined();
    expect(limited?.context?.sendCount, "the count must be MEASURED, not the constant").toBe(5);
    // No email fingerprint in the log: an unsalted SHA-256 prefix over an address space this small
    // is a confirmable identifier, and the domain is what this unit removed.
    expect(limited?.context?.emailDomain, "the domain must not be in this event").toBeUndefined();
    expect(limited?.context?.emailStubPrefix, "nor an address fingerprint").toBeUndefined();

    // THE SEND MUST BE PREVENTED, not merely logged. Without this, logging the warn and sending
    // anyway passes every other assertion here.
    expect(otpState.captured.length, "exactly five codes may leave; the sixth is refused").toBe(5);
    // AND THE PERSON MUST BE TOLD — invariant 2's other half. Without this, deleting the
    // `channel.send` in the refusal branch passes too.
    const refusal = channelState.sent.filter((m) => /limit/i.test(m.message));
    expect(refusal.length, "the requester is told they hit the limit").toBeGreaterThan(0);
    expect(refusal.at(-1)?.message).toMatch(/sent to you in the past hour/);
  });

  it("AC-009: the window ROLLS — the allowance returns, it is not spent forever", async () => {
    /**
     * Review: the rolling reset was unpinned, so deleting the `.filter(t => t > cutoff)` from
     * `#overOtpLimit` passed every test — turning a one-hour limit into a permanent one. That is
     * also the exact promise the refusal copy makes to the person ("wait up to an hour"), so an
     * unpinned window means the message can become a lie without anything noticing.
     *
     * Driven by moving the CLOCK rather than waiting an hour: the stamps are real `Date.now()`
     * values, so advancing the system time past the window is what a real hour looks like to the
     * limiter.
     */
    await enrol(userId, "447911111113");
    for (let i = 0; i < 5; i++) {
      await channelState.injectMessage(userId, `w${i}@example.com`);
      await resetToAwaitingEmail(userId);
    }
    await channelState.injectMessage(userId, "w5@example.com");
    expect(
      loggerState.events.find((e) => e.event === "registration.otp.rate_limited"),
      "precondition: the sixth inside the window is refused",
    ).toBeDefined();
    const sentInWindow = otpState.captured.length;

    // Advance past the one-hour window.
    const realNow = Date.now;
    try {
      const shifted = realNow() + 61 * 60 * 1_000;
      Date.now = () => shifted;
      await resetToAwaitingEmail(userId);
      await channelState.injectMessage(userId, "after-the-hour@example.com");
    } finally {
      Date.now = realNow;
    }

    expect(
      otpState.captured.length,
      "once the window has rolled the allowance returns — a limit that never resets is a ban",
    ).toBe(sentInWindow + 1);
  });

  it("AC-009: a FAILED delivery does not spend one of the five, and does not accuse the user", async () => {
    /**
     * Two properties in one flow, both unpinned before and both mine to own.
     *
     * The count: `#recordOtpSend` runs only after `sendOtp` resolves. Moving it above the send
     * passed every test, because the fake provider never threw — so a bounce could spend one of a
     * person's five and lock them out having received nothing.
     *
     * The message: the throw used to skip the channel send entirely while the row had ALREADY moved
     * to AWAITING_EMAIL_OTP, so the person got silence and then, on their next message,
     * "Incorrect code. You have 2 attempts remaining." This unit un-shadowed the delivery-layer
     * refusal that makes that reachable, so it owns the behaviour.
     */
    await enrol(userId, "447911111114");
    let failNext = true;
    const realSend = otpState.provider.sendOtp.bind(otpState.provider);
    otpState.provider.sendOtp = async (addr: string, otp: string): Promise<void> => {
      if (failNext) { failNext = false; throw new Error("SES said no"); }
      await realSend(addr, otp);
    };

    await channelState.injectMessage(userId, "unreachable@example.com");

    // TOLD, and told the truth: no code exists to enter.
    const told = channelState.sent.at(-1)?.message ?? "";
    expect(told, "silence after a failed send is what produced the accusation").not.toBe("");
    expect(told).toMatch(/couldn't send|nothing was sent/i);
    expect(told, "must not imply a code is waiting for them").not.toMatch(/verification code has been sent/);
    expect(loggerState.events.find((e) => e.event === "registration.otp.delivery_failed")).toBeDefined();

    // ROLLED BACK, so their next message is read as an address and not as a wrong OTP.
    const repo = new RegistrationRepository(pool);
    const after = await repo.findActiveByChannelUser("cli", userId);
    expect(after?.state, "a failed send must not leave them in the OTP state").toBe("AWAITING_EMAIL");

    // NOT CHARGED: five more must still get through.
    for (let i = 0; i < 5; i++) {
      await channelState.injectMessage(userId, `retry${i}@example.com`);
      await resetToAwaitingEmail(userId);
    }
    expect(
      loggerState.events.find((e) => e.event === "registration.otp.rate_limited"),
      "the failed send must not have spent one of the five",
    ).toBeUndefined();
    expect(otpState.captured.length).toBe(5);
  });

  it("DOD-M15-SIGNUP-1: six DIFFERENT people on one domain do NOT throttle each other", async () => {
    // The regression this unit exists for, and the exact shape of an invite wave. SIX DISTINCT
    // requesters — the earlier version used one `userId` for all six, which made it assert that the
    // abuse case was permitted rather than that strangers are independent.
    // Phones derived from `userId`, which carries a timestamp and a random suffix. Static numbers
    // collide with the previous RUN on `idx_registrations_phone_stub_hash_active` — rows are never
    // deleted here (RLS forbids it), only expired, so a leftover active row is a hard failure that
    // looks like a logic bug. Caught by the revert test rather than by a second run.
    const stamp = userId.replace(/\D/g, "").slice(-8).padStart(8, "0");
    const users = Array.from({ length: 6 }, (_, i) => `${userId}-wave-${i}`);
    for (const [i, u] of users.entries()) {
      await enrol(u, `44${stamp}${i}`);
      await channelState.injectMessage(u, `person${i}@gmail.com`);
    }
    waveUsers.push(...users);

    expect(
      loggerState.events.find((e) => e.event === "registration.otp.rate_limited"),
      "six unrelated people sharing an email provider must not refuse each other a verification code",
    ).toBeUndefined();
  });
});
