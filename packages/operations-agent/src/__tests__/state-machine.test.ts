/**
 * state-machine.test.ts — Unit tests for the RegistrationStateMachine.
 *
 * Specification:
 *
 * AC-003b: Invalid email → state stays AWAITING_EMAIL, no OTP generated.
 * AC-005: 3 incorrect OTP attempts → OTP invalidated, state remains AWAITING_EMAIL_OTP.
 * SI-001: OTP hash stored as SHA-256(otp+salt), not a 6-digit string.
 * SI-002: Phone stored only as SHA-256 hash, not raw number.
 * SI-003: Cannot transition from INITIAL to EMAIL_CONFIRMED without phone verification.
 *
 * All tests use real SHA-256 via node:crypto — no mocks of crypto operations.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { isValidEmail, extractEmailDomain } from "../registration/state-machine.js";
import { generateOtp, generateOtpSalt, hashOtp, verifyOtp } from "../registration/otp.js";
import { hashPhone, normalizePhone } from "../registration/phone.js";

// ─── AC-003b: Email validation ────────────────────────────────────────────────

describe("isValidEmail — AC-003b", () => {
  it("returns true for valid email addresses", () => {
    expect(isValidEmail("user@example.com")).toBe(true);
    expect(isValidEmail("a@b.io")).toBe(true);
    expect(isValidEmail("user+tag@sub.domain.com")).toBe(true);
  });

  it("returns false for 'not an email' (no @ sign)", () => {
    expect(isValidEmail("not an email")).toBe(false);
    expect(isValidEmail("notanemail")).toBe(false);
    expect(isValidEmail("")).toBe(false);
  });

  it("returns false for strings with multiple @ signs", () => {
    expect(isValidEmail("a@b@c")).toBe(false);
  });

  it("returns false for @ at the start or end", () => {
    expect(isValidEmail("@example.com")).toBe(false);
    expect(isValidEmail("user@")).toBe(false);
  });
});

describe("extractEmailDomain", () => {
  it("extracts the domain part from a valid email", () => {
    expect(extractEmailDomain("user@example.com")).toBe("example.com");
    expect(extractEmailDomain("a@B.IO")).toBe("b.io");
  });
});

// ─── SI-001: OTP hashing ──────────────────────────────────────────────────────

describe("OTP hashing — SI-001", () => {
  it("generateOtp returns a 6-digit string", () => {
    const otp = generateOtp();
    expect(otp).toMatch(/^\d{6}$/);
  });

  it("generates different OTPs on successive calls", () => {
    const otps = new Set(Array.from({ length: 20 }, () => generateOtp()));
    // With 1,000,000 possible values, 20 calls should produce at least 5 unique values
    expect(otps.size).toBeGreaterThan(5);
  });

  it("hashOtp returns a 64-char hex string (SHA-256 output)", () => {
    const hash = hashOtp("123456", "somesalt");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("hashOtp output is NOT the 6-digit OTP itself (SI-001: DB breach does not reveal OTP)", () => {
    const otp = "123456";
    const hash = hashOtp(otp, "salt1");
    // The stored value must not be the plaintext 6-digit OTP
    expect(hash).not.toBe(otp);
    expect(hash).not.toMatch(/^\d{6}$/);
  });

  it("hashOtp is deterministic — same otp+salt always gives same hash", () => {
    const h1 = hashOtp("654321", "fixed-salt");
    const h2 = hashOtp("654321", "fixed-salt");
    expect(h1).toBe(h2);
  });

  it("hashOtp with different salts produces different hashes (prevents rainbow tables)", () => {
    const h1 = hashOtp("123456", "salt-a");
    const h2 = hashOtp("123456", "salt-b");
    expect(h1).not.toBe(h2);
  });

  it("verifyOtp returns true for correct OTP", () => {
    const otp = "789012";
    const salt = generateOtpSalt();
    const storedHash = hashOtp(otp, salt);
    expect(verifyOtp(otp, salt, storedHash)).toBe(true);
  });

  it("verifyOtp returns false for incorrect OTP", () => {
    const otp = "789012";
    const salt = generateOtpSalt();
    const storedHash = hashOtp(otp, salt);
    expect(verifyOtp("000000", salt, storedHash)).toBe(false);
  });
});

// ─── SI-002: Phone hashing ────────────────────────────────────────────────────

describe("Phone hashing — SI-002", () => {
  it("hashPhone returns a 64-char hex string", () => {
    const hash = hashPhone("+447911123456");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("hashPhone is deterministic for the same input", () => {
    const h1 = hashPhone("+447911123456");
    const h2 = hashPhone("+447911123456");
    expect(h1).toBe(h2);
  });

  it("hashPhone output is NOT the raw phone number (SI-002)", () => {
    const phone = "+447911123456";
    const hash = hashPhone(phone);
    expect(hash).not.toBe(phone);
    expect(hash).not.toContain(phone);
  });

  it("different phone numbers produce different hashes", () => {
    const h1 = hashPhone("+447911111111");
    const h2 = hashPhone("+447911222222");
    expect(h1).not.toBe(h2);
  });

  it("normalizePhone strips spaces and dashes", () => {
    expect(normalizePhone("+44 791 112 3456")).toBe("+447911123456");
    expect(normalizePhone("+1-800-555-1234")).toBe("+18005551234");
  });

  it("normalizePhone keeps leading +", () => {
    expect(normalizePhone("+447911123456")).toBe("+447911123456");
  });
});

// ─── SI-003: Cannot skip phone verification ───────────────────────────────────
//
// These tests verify the runtime enforcement of SI-003 using real engine/DB.
// Type-level checks were previously used here but do not satisfy the adversarial
// condition: "even when a crafted message attempts to provide an email OTP without
// having completed phone verification, the state machine rejects it."
//
// The engine.test.ts describeIntegration block covers SI-003 runtime enforcement:
// - A record in AWAITING_CONTACT state receiving a 6-digit OTP must not advance.
// - A record in AWAITING_CONTACT state receiving an email address must not advance.
//
// These integration tests require a DB connection and are gated on CELLO_ENV=local.

import pg from "pg";
import { RegistrationEngine } from "../registration/engine.js";
import { LocalPreAuthorizationClient } from "@cello-protocol/interfaces/stubs";
import type { Logger, MessagingChannel, OtpDeliveryProvider, ChannelIdentity } from "@cello-protocol/interfaces";
import { RegistrationRepository } from "../registration/repository.js";

const isLocal = process.env["CELLO_ENV"] === "local";
const describeIntegration = isLocal ? describe : describe.skip;

const OPS_AGENT_URL = (
  process.env["DATABASE_URL"] ?? "postgresql://postgres:dev@localhost:5433/cello_dev"
).replace(
  /^(postgres(?:ql)?):\/\/[^:]+:[^@]+@/,
  "$1://cello_ops_agent:cello_ops_agent_dev@",
);

function makeMinimalLogger(): Logger {
  return {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  };
}

function makeMinimalChannel(): { channel: MessagingChannel; inject: (from: string, msg: string) => Promise<void>; otpDelivery: OtpDeliveryProvider } {
  let handler: ((from: string, message: string) => void | Promise<void>) | undefined;
  const channel: MessagingChannel = {
    async send() {},
    onMessage(h) { handler = h; },
    async resolveIdentity(from): Promise<ChannelIdentity> {
      return { channel: "cli", channelUserId: from };
    },
  };
  const otpDelivery: OtpDeliveryProvider = {
    async sendOtp() {},
  };
  return {
    channel,
    otpDelivery,
    inject: async (from, msg) => { if (handler) await handler(from, msg); },
  };
}

describeIntegration("SI-003: State machine rejects OTP/email input before phone verification (runtime)", () => {
  let pool: pg.Pool;

  beforeEach(() => {
    pool = new pg.Pool({ connectionString: OPS_AGENT_URL });
  });

  afterEach(async () => {
    await pool.end();
  });

  it("SI-003: sending a 6-digit OTP to a record in AWAITING_CONTACT does not advance state", async () => {
    const userId = `si003-otp-${Date.now()}`;
    const { channel, otpDelivery, inject } = makeMinimalChannel();
    const engine = new RegistrationEngine({
      pool,
      channel,
      otpDelivery,
      preAuth: new LocalPreAuthorizationClient(),
      logger: makeMinimalLogger(),
      channelType: "cli",
      onError: (err) => { throw err; },
    });
    await engine.start();

    // Start registration (now in AWAITING_CONTACT)
    await inject(userId, "hello");

    // Adversarial: send a crafted 6-digit OTP without sharing phone
    await inject(userId, "123456");

    // State must still be AWAITING_CONTACT — no transition
    const repo = new RegistrationRepository(pool);
    const record = await repo.findActiveByChannelUser("cli", userId);
    expect(record?.state).toBe("AWAITING_CONTACT");

    engine.stop();
    // Cleanup
    if (record) await repo.transition(record.id, "EXPIRED");
  });

  it("SI-003: sending an email address to a record in AWAITING_CONTACT does not advance state", async () => {
    const userId = `si003-email-${Date.now()}`;
    const { channel, otpDelivery, inject } = makeMinimalChannel();
    const engine = new RegistrationEngine({
      pool,
      channel,
      otpDelivery,
      preAuth: new LocalPreAuthorizationClient(),
      logger: makeMinimalLogger(),
      channelType: "cli",
      onError: (err) => { throw err; },
    });
    await engine.start();

    // Start registration (now in AWAITING_CONTACT)
    await inject(userId, "hello");

    // Adversarial: send an email address without sharing phone first
    await inject(userId, "adversary@example.com");

    // State must still be AWAITING_CONTACT — no transition to AWAITING_EMAIL
    const repo = new RegistrationRepository(pool);
    const record = await repo.findActiveByChannelUser("cli", userId);
    expect(record?.state).toBe("AWAITING_CONTACT");

    engine.stop();
    // Cleanup
    if (record) await repo.transition(record.id, "EXPIRED");
  });
});
