/**
 * m6b-016.test.ts — Integration tests for Registration Data Integrity (M6B-016).
 *
 * Specification:
 *
 * AC-001: First-time registration stores SHA-256(normalize(email)) in registrations.email_stub_hash;
 *         email_domain column does not exist; full email not in any DB column or log line.
 * AC-002: Re-registration with DIFFERENT email → email continuity rejection.
 * AC-003: Re-registration with SAME email → proceeds normally to PRE_AUTH_TOKEN_ISSUED.
 * AC-004: Registration completion upserts into channel_identities.
 * AC-005: Re-registration upserts channel_identities (exactly one row for phone+channel).
 * AC-006: Re-registration warning message does NOT contain "until it reconnects".
 * AC-007: Pre-auth token request body contains emailStubHash, not emailDomain.
 *
 * Security Invariants:
 * SI-001: channel_user_id never sent to directory (verified by captured request body).
 * SI-002: Email continuity enforced by hash comparison.
 * SI-003: channel_identities rows cannot be deleted by cello_ops_agent role.
 *
 * Observability:
 * - registration.email.hash_stored logged with { registrationId, correlationId }
 * - registration.email.continuity_rejected logged with { registrationId, channelUserId, correlationId }
 * - registration.channel_identity.upserted logged with { registrationId, channel, correlationId }
 *
 * Tests use real Postgres (describeIntegration) — no mock DB.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createHash } from "node:crypto";
import pg from "pg";
import { RegistrationEngine } from "../registration/engine.js";
import { RegistrationRepository } from "../registration/repository.js";
import { hashEmail } from "../registration/state-machine.js";
import type {
  Logger,
  MessagingChannel,
  OtpDeliveryProvider,
  ChannelIdentity,
  PreAuthorizationClient,
} from "@cello-protocol/interfaces";

const isLocal = process.env["CELLO_ENV"] === "local";
const describeIntegration = isLocal ? describe : describe.skip;

const DATABASE_URL =
  process.env["DATABASE_URL"] ?? "postgresql://postgres:dev@localhost:5433/cello_dev";

const OPS_AGENT_URL = DATABASE_URL.replace(
  /^(postgres(?:ql)?):\/\/[^:]+:[^@]+@/,
  "$1://cello_ops_agent:cello_ops_agent_dev@",
);

// ─── Test doubles ─────────────────────────────────────────────────────────────

function makeTestLogger(): {
  logger: Logger;
  events: Array<{ method: string; event: string; context?: Record<string, unknown> }>;
} {
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

function makeTestChannel(): {
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
      return { channel: "cli", channelUserId: from };
    },
  };

  async function injectMessage(from: string, message: string): Promise<void> {
    if (handler) {
      await handler(from, message);
    }
  }

  return { channel, sent, injectMessage };
}

function makeTestOtpDelivery(): {
  provider: OtpDeliveryProvider;
  captured: Array<{ emailAddress: string; otp: string }>;
} {
  const captured: Array<{ emailAddress: string; otp: string }> = [];
  const provider: OtpDeliveryProvider = {
    async sendOtp(emailAddress: string, otp: string): Promise<void> {
      captured.push({ emailAddress, otp });
    },
  };
  return { provider, captured };
}

/**
 * A capturing PreAuthorizationClient that records all request bodies.
 * Returns a dev token on success.
 */
function makeCapturingPreAuth(): {
  client: PreAuthorizationClient;
  calls: Array<{ phoneStubHash: string; emailStubHash: string; registrationId: string }>;
} {
  const calls: Array<{ phoneStubHash: string; emailStubHash: string; registrationId: string }> = [];
  const client: PreAuthorizationClient = {
    async requestToken(phoneStubHash: string, emailStubHash: string, registrationId: string) {
      calls.push({ phoneStubHash, emailStubHash, registrationId });
      return { token: "DEV-CELLO-test1234567890ab" };
    },
  };
  return { client, calls };
}

// ─── Helper: drive a registration to completion ────────────────────────────────

async function driveToCompletion(
  channelState: ReturnType<typeof makeTestChannel>,
  otpState: ReturnType<typeof makeTestOtpDelivery>,
  userId: string,
  email: string,
): Promise<void> {
  await channelState.injectMessage(userId, "hello");
  await channelState.injectMessage(userId, `CONTACT:${userId}:+447911123456`);
  await channelState.injectMessage(userId, email);
  const otp = otpState.captured[otpState.captured.length - 1].otp;
  await channelState.injectMessage(userId, otp);
}

// ─── Integration tests ─────────────────────────────────────────────────────────

describeIntegration("M6B-016 — Registration Data Integrity", () => {
  let pool: pg.Pool;
  let engine: RegistrationEngine;
  let loggerState: ReturnType<typeof makeTestLogger>;
  let channelState: ReturnType<typeof makeTestChannel>;
  let otpState: ReturnType<typeof makeTestOtpDelivery>;
  let preAuthState: ReturnType<typeof makeCapturingPreAuth>;
  let userId: string;

  beforeEach(async () => {
    pool = new pg.Pool({ connectionString: OPS_AGENT_URL });
    loggerState = makeTestLogger();
    channelState = makeTestChannel();
    otpState = makeTestOtpDelivery();
    preAuthState = makeCapturingPreAuth();
    userId = `m6b016-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    engine = new RegistrationEngine({
      pool,
      channel: channelState.channel,
      otpDelivery: otpState.provider,
      preAuth: preAuthState.client,
      logger: loggerState.logger,
      channelType: "cli",
      onError: (err) => { throw err; },
    });
    await engine.start();
  });

  afterEach(async () => {
    engine.stop();
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

  it("AC-001: first-time registration stores SHA-256(normalize(email)) in email_stub_hash; email_domain column does not exist", async () => {
    const email = "Alice@Example.COM";
    const expectedHash = hashEmail(email);

    // Drive registration to completion
    await driveToCompletion(channelState, otpState, userId, email);

    // Verify email_stub_hash in DB
    const result = await pool.query<{ email_stub_hash: string | null }>(
      `SELECT email_stub_hash FROM registrations
       WHERE channel_user_id = $1 AND state = 'PRE_AUTH_TOKEN_ISSUED'`,
      [userId],
    );
    expect(result.rows.length).toBe(1);
    expect(result.rows[0].email_stub_hash).toBe(expectedHash);

    // Verify email_domain column does NOT exist
    const colCheck = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'registrations' AND column_name = 'email_domain'`,
    );
    expect(colCheck.rows.length).toBe(0);

    // Verify the full email does not appear in any log line
    const allLogLines = loggerState.events.map((e) => JSON.stringify(e));
    for (const line of allLogLines) {
      expect(line).not.toContain("Alice@Example.COM");
      expect(line).not.toContain("alice@example.com");
    }

    // Verify registration.email.hash_stored was logged
    const hashStoredEvent = loggerState.events.find((e) => e.event === "registration.email.hash_stored");
    expect(hashStoredEvent).toBeDefined();
    expect(hashStoredEvent?.context?.registrationId).toBeDefined();
    expect(hashStoredEvent?.context?.correlationId).toBeDefined();
  });

  // ─── AC-002 ─────────────────────────────────────────────────────────────────

  it("AC-002: re-registration with DIFFERENT email is rejected by email continuity enforcement", async () => {
    const originalEmail = "original@example.com";
    const differentEmail = "attacker@example.com";

    // Complete the first registration
    await driveToCompletion(channelState, otpState, userId, originalEmail);

    // Start re-registration: send message → get warning
    await channelState.injectMessage(userId, "hello");
    // Confirm re-registration
    await channelState.injectMessage(userId, "CONFIRM");

    // Drive through phone verification
    await channelState.injectMessage(userId, `CONTACT:${userId}:+447911123456`);

    // Submit the DIFFERENT email
    await channelState.injectMessage(userId, differentEmail);

    // Get the OTP for the different email
    const otpEntry = otpState.captured[otpState.captured.length - 1];
    expect(otpEntry.emailAddress).toBe(differentEmail);

    // Submit the OTP — it verifies correctly but email continuity check rejects
    await channelState.injectMessage(userId, otpEntry.otp);

    // The rejection message should have been sent
    const rejectionMsg = channelState.sent.find((m) =>
      m.message.includes("same email address as your original registration"),
    );
    expect(rejectionMsg).toBeDefined();

    // The registration should NOT have advanced to PRE_AUTH_TOKEN_ISSUED
    const repo = new RegistrationRepository(pool);
    const active = await repo.findActiveByChannelUser("cli", userId);
    expect(active).not.toBeNull();
    expect(active?.state).not.toBe("PRE_AUTH_TOKEN_ISSUED");

    // Observability: registration.email.continuity_rejected was logged
    const rejectedEvent = loggerState.events.find(
      (e) => e.event === "registration.email.continuity_rejected",
    );
    expect(rejectedEvent).toBeDefined();
    expect(rejectedEvent?.method).toBe("warn");
    expect(rejectedEvent?.context?.registrationId).toBeDefined();
    expect(rejectedEvent?.context?.channelUserId).toBe(userId);
    expect(rejectedEvent?.context?.correlationId).toBeDefined();
  });

  // ─── AC-003 ─────────────────────────────────────────────────────────────────

  it("AC-003: re-registration with SAME email proceeds to PRE_AUTH_TOKEN_ISSUED", async () => {
    const email = "same@example.com";

    // Complete the first registration
    await driveToCompletion(channelState, otpState, userId, email);

    // Start re-registration
    await channelState.injectMessage(userId, "hello");
    await channelState.injectMessage(userId, "CONFIRM");
    await channelState.injectMessage(userId, `CONTACT:${userId}:+447911123456`);

    // Submit the SAME email
    await channelState.injectMessage(userId, email);
    const otpEntry = otpState.captured[otpState.captured.length - 1];
    await channelState.injectMessage(userId, otpEntry.otp);

    // Should have completed successfully — second token issued
    expect(preAuthState.calls.length).toBe(2); // first registration + re-registration
    const tokenMsg = channelState.sent.filter((m) => m.message.includes("DEV-CELLO-"));
    expect(tokenMsg.length).toBe(2);
  });

  // ─── AC-004 ─────────────────────────────────────────────────────────────────

  it("AC-004: registration completion upserts into channel_identities", async () => {
    const email = "channel@example.com";

    await driveToCompletion(channelState, otpState, userId, email);

    // Verify channel_identities has a row
    const result = await pool.query<{
      phone_stub_hash: string;
      channel: string;
      channel_user_id: string;
    }>(
      `SELECT phone_stub_hash, channel, channel_user_id FROM channel_identities
       WHERE channel_user_id = $1`,
      [userId],
    );
    expect(result.rows.length).toBe(1);
    expect(result.rows[0].channel).toBe("cli");
    expect(result.rows[0].channel_user_id).toBe(userId);
    expect(result.rows[0].phone_stub_hash).toBeDefined();

    // Observability: registration.channel_identity.upserted was logged
    const upsertedEvent = loggerState.events.find(
      (e) => e.event === "registration.channel_identity.upserted",
    );
    expect(upsertedEvent).toBeDefined();
    expect(upsertedEvent?.context?.registrationId).toBeDefined();
    expect(upsertedEvent?.context?.channel).toBe("cli");
    expect(upsertedEvent?.context?.correlationId).toBeDefined();
  });

  // ─── AC-005 ─────────────────────────────────────────────────────────────────

  it("AC-005: re-registration upserts channel_identities — exactly one row for (phone, channel)", async () => {
    const email = "reregister@example.com";

    // First registration
    await driveToCompletion(channelState, otpState, userId, email);

    // Re-registration
    await channelState.injectMessage(userId, "hello");
    await channelState.injectMessage(userId, "CONFIRM");
    await channelState.injectMessage(userId, `CONTACT:${userId}:+447911123456`);
    await channelState.injectMessage(userId, email);
    const otpEntry = otpState.captured[otpState.captured.length - 1];
    await channelState.injectMessage(userId, otpEntry.otp);

    // Verify exactly ONE row in channel_identities for this user
    const result = await pool.query<{ channel_user_id: string }>(
      `SELECT channel_user_id FROM channel_identities
       WHERE channel_user_id = $1 AND channel = 'cli'`,
      [userId],
    );
    expect(result.rows.length).toBe(1);
    expect(result.rows[0].channel_user_id).toBe(userId);
  });

  // ─── AC-006 ─────────────────────────────────────────────────────────────────

  it("AC-006: re-registration warning does NOT contain 'until it reconnects'", async () => {
    const email = "copy@example.com";

    // Complete first registration
    await driveToCompletion(channelState, otpState, userId, email);

    // Trigger re-registration warning
    await channelState.injectMessage(userId, "hello");

    // Find the warning message
    const warningMsg = channelState.sent.find(
      (m) => m.message.includes("CONFIRM") && m.to === userId,
    );
    expect(warningMsg).toBeDefined();
    expect(warningMsg!.message).not.toContain("until it reconnects");
    expect(warningMsg!.message).toContain("independently under the same account");
  });

  // ─── AC-007 ─────────────────────────────────────────────────────────────────

  it("AC-007: pre-auth token request contains emailStubHash, not emailDomain", async () => {
    const email = "payload@example.com";
    const expectedHash = hashEmail(email);

    await driveToCompletion(channelState, otpState, userId, email);

    // Verify the captured pre-auth request
    expect(preAuthState.calls.length).toBe(1);
    const call = preAuthState.calls[0];
    expect(call.emailStubHash).toBe(expectedHash);
    // Verify emailDomain is NOT in the payload
    expect((call as unknown as Record<string, unknown>)["emailDomain"]).toBeUndefined();
  });

  // ─── SI-001 ─────────────────────────────────────────────────────────────────

  it("SI-001: channel_user_id is never sent to the directory pre-auth API", async () => {
    const email = "si001@example.com";
    await driveToCompletion(channelState, otpState, userId, email);

    // The pre-auth call should contain phoneStubHash and emailStubHash, NOT channel_user_id
    const call = preAuthState.calls[0];
    expect(call.phoneStubHash).toBeDefined();
    expect(call.emailStubHash).toBeDefined();
    expect((call as unknown as Record<string, unknown>)["channelUserId"]).toBeUndefined();
    expect((call as unknown as Record<string, unknown>)["channel_user_id"]).toBeUndefined();
  });

  // ─── SI-003 ─────────────────────────────────────────────────────────────────

  it("SI-003: cello_ops_agent role cannot DELETE from channel_identities", async () => {
    const email = "si003@example.com";
    await driveToCompletion(channelState, otpState, userId, email);

    // Attempt to delete — should fail with permission denied
    await expect(
      pool.query("DELETE FROM channel_identities WHERE channel_user_id = $1", [userId]),
    ).rejects.toThrow(/permission denied/);
  });
});

// ─── Unit tests (no Postgres required) ────────────────────────────────────────

describe("hashEmail utility", () => {
  it("normalizes by trimming and lowercasing before hashing", () => {
    const h1 = hashEmail("  Alice@Example.COM  ");
    const h2 = hashEmail("alice@example.com");
    expect(h1).toBe(h2);
  });

  it("returns a 64-char hex string (SHA-256 output)", () => {
    const hash = hashEmail("user@example.com");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces consistent output — same email always same hash", () => {
    const h1 = hashEmail("test@domain.com");
    const h2 = hashEmail("test@domain.com");
    expect(h1).toBe(h2);
  });

  it("different emails produce different hashes", () => {
    const h1 = hashEmail("user1@domain.com");
    const h2 = hashEmail("user2@domain.com");
    expect(h1).not.toBe(h2);
  });

  it("matches manual SHA-256 computation", () => {
    const email = "test@example.com";
    const expected = createHash("sha256")
      .update("test@example.com", "utf8")
      .digest("hex");
    expect(hashEmail(email)).toBe(expected);
  });
});
