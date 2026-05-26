/**
 * repository.test.ts — Integration tests for RegistrationRepository against real Postgres.
 *
 * Specification:
 *
 * AC-001: INSERT creates a row in AWAITING_CONTACT state.
 * AC-002: State transitions work: AWAITING_CONTACT → PHONE_CONFIRMED → AWAITING_EMAIL.
 * AC-003: AWAITING_EMAIL_OTP row contains otpHash (not plaintext OTP) and otpSalt.
 * AC-006: OTP expiry fields are set correctly when transitioning to AWAITING_EMAIL_OTP.
 * AC-007: loadAllActive returns all non-terminal records (restart recovery).
 * AC-008: findExpiredActive finds records with expiresAt < now.
 *
 * Chain hash: every transition must set chain_hash correctly.
 *
 * Runs only when CELLO_ENV=local is set (real Postgres required for RLS/chain tests).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { RegistrationRepository, computeRootChainHash } from "../registration/repository.js";

const isLocal = process.env["CELLO_ENV"] === "local";
const describeIntegration = isLocal ? describe : describe.skip;

const DATABASE_URL =
  process.env["DATABASE_URL"] ?? "postgresql://postgres:dev@localhost:5433/cello_dev";

// Use cello_ops_agent role for realistic permission testing
const OPS_AGENT_URL = DATABASE_URL.replace(
  /^(postgres(?:ql)?):\/\/[^:]+:[^@]+@/,
  "$1://cello_ops_agent:cello_ops_agent_dev@",
);

let pool: pg.Pool;
let repo: RegistrationRepository;

describeIntegration("RegistrationRepository integration", () => {
  beforeAll(() => {
    pool = new pg.Pool({ connectionString: OPS_AGENT_URL });
    repo = new RegistrationRepository(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  // ─── AC-001: Insert creates row in AWAITING_CONTACT ────────────────────────

  it("AC-001: insert creates a row, then transition to AWAITING_CONTACT", async () => {
    const ts = Date.now();
    const record = await repo.insert({
      phoneStubHash: `test-phone-hash-001-${ts}`,
      channel: "cli",
      channelUserId: `test-user-001-${ts}`,
      state: "INITIAL",
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    expect(record.id).toBeDefined();
    expect(record.state).toBe("INITIAL");
    expect(record.phoneStubHash).toBe(`test-phone-hash-001-${ts}`);
    expect(record.channel).toBe("cli");
    expect(record.channelUserId).toBe(`test-user-001-${ts}`);

    // Transition to AWAITING_CONTACT
    const awaiting = await repo.transition(record.id, "AWAITING_CONTACT");
    expect(awaiting.state).toBe("AWAITING_CONTACT");

    // Verify in DB
    const fromDb = await repo.findById(record.id);
    expect(fromDb?.state).toBe("AWAITING_CONTACT");
  });

  // ─── Chain hash integrity ──────────────────────────────────────────────────

  it("chain hash is computed correctly for root record", async () => {
    const ts = Date.now();
    const record = await repo.insert({
      phoneStubHash: `chain-hash-test-${ts}`,
      channel: "cli",
      channelUserId: `chain-user-001-${ts}`,
      state: "INITIAL",
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    // Verify root chain hash = SHA-256(id)
    const expectedRootHash = computeRootChainHash(record.id);

    // Fetch the raw row to check chain_hash
    const rawResult = await pool.query(
      `SELECT chain_hash FROM registrations WHERE id = $1`,
      [record.id],
    );
    expect(rawResult.rows[0].chain_hash).toBe(expectedRootHash);
  });

  it("chain hash is updated on transition", async () => {
    const ts = Date.now() + 1;
    const record = await repo.insert({
      phoneStubHash: `chain-hash-test-2-${ts}`,
      channel: "cli",
      channelUserId: `chain-user-002-${ts}`,
      state: "INITIAL",
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    // Transition and verify chain hash changes
    await repo.transition(record.id, "AWAITING_CONTACT");

    const rawResult = await pool.query(
      `SELECT chain_hash FROM registrations WHERE id = $1`,
      [record.id],
    );
    // Chain hash should have changed (is different from root)
    expect(rawResult.rows[0].chain_hash).not.toBe(computeRootChainHash(record.id));
  });

  // ─── AC-002: Phone verified → AWAITING_EMAIL ─────────────────────────────

  it("AC-002: transitions from AWAITING_CONTACT through PHONE_CONFIRMED to AWAITING_EMAIL", async () => {
    const ts = Date.now() + 2;
    const record = await repo.insert({
      phoneStubHash: `phone-hash-ac002-${ts}`,
      channel: "cli",
      channelUserId: `user-ac002-${ts}`,
      state: "INITIAL",
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    await repo.transition(record.id, "AWAITING_CONTACT");
    await repo.transition(record.id, "PHONE_CONFIRMED");
    const awaitingEmail = await repo.transition(record.id, "AWAITING_EMAIL");

    expect(awaitingEmail.state).toBe("AWAITING_EMAIL");
    expect(awaitingEmail.updatedAt).toBeDefined();

    const fromDb = await repo.findById(record.id);
    expect(fromDb?.state).toBe("AWAITING_EMAIL");
  });

  // ─── AC-003: AWAITING_EMAIL_OTP stores otpHash (not plaintext) ────────────

  it("AC-003: AWAITING_EMAIL_OTP row stores otpHash and otpSalt, not plaintext OTP", async () => {
    const ts = Date.now() + 3;
    const record = await repo.insert({
      phoneStubHash: `phone-hash-ac003-${ts}`,
      channel: "cli",
      channelUserId: `user-ac003-${ts}`,
      state: "INITIAL",
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    await repo.transition(record.id, "AWAITING_CONTACT");
    await repo.transition(record.id, "PHONE_CONFIRMED");
    await repo.transition(record.id, "AWAITING_EMAIL", { emailDomain: "example.com" });

    const otp = "654321";
    const salt = "test-salt-value";
    const { createHash } = await import("node:crypto");
    const otpHash = createHash("sha256").update(otp + salt, "utf8").digest("hex");

    const awaitingOtp = await repo.transition(record.id, "AWAITING_EMAIL_OTP", {
      otpHash,
      otpSalt: salt,
      otpExpiresAt: new Date(Date.now() + 15 * 60 * 1000),
      otpAttemptCount: 0,
    });

    expect(awaitingOtp.state).toBe("AWAITING_EMAIL_OTP");
    if (awaitingOtp.state !== "AWAITING_EMAIL_OTP") throw new Error("type guard");

    // otpHash in the record is the hashed value
    expect(awaitingOtp.otpHash).toBe(otpHash);
    // It is NOT a 6-digit string (SI-001)
    expect(awaitingOtp.otpHash).not.toMatch(/^\d{6}$/);

    // Fetch otp_salt separately (not in RegistrationRecord by design)
    const storedSalt = await repo.getOtpSalt(record.id);
    expect(storedSalt).toBe(salt);
  });

  // ─── AC-006: OTP expiry ────────────────────────────────────────────────────

  it("AC-006: otpExpiresAt is set to ~15 minutes from now on AWAITING_EMAIL_OTP transition", async () => {
    const ts = Date.now() + 4;
    const record = await repo.insert({
      phoneStubHash: `phone-hash-ac006-${ts}`,
      channel: "cli",
      channelUserId: `user-ac006-${ts}`,
      state: "INITIAL",
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    await repo.transition(record.id, "AWAITING_EMAIL_OTP", {
      otpHash: "deadbeef",
      otpSalt: "salt",
      otpExpiresAt: new Date(Date.now() + 15 * 60 * 1000),
      otpAttemptCount: 0,
    });

    const fromDb = await repo.findById(record.id);
    expect(fromDb?.state).toBe("AWAITING_EMAIL_OTP");
    if (fromDb?.state !== "AWAITING_EMAIL_OTP") throw new Error("type guard");

    const expiresInMs = fromDb.otpExpiresAt.getTime() - Date.now();
    // Should be within 14-16 minutes
    expect(expiresInMs).toBeGreaterThan(13 * 60 * 1000);
    expect(expiresInMs).toBeLessThan(16 * 60 * 1000);
  });

  // ─── AC-007: loadAllActive for restart recovery ────────────────────────────

  it("AC-007: loadAllActive returns non-terminal records", async () => {
    const ts7 = Date.now() + 7;
    const user1 = `restart-user-${ts7}-1`;
    const user2 = `restart-user-${ts7}-2`;

    const r1 = await repo.insert({
      phoneStubHash: `restart-hash-1-${ts7}`,
      channel: "cli",
      channelUserId: user1,
      state: "INITIAL",
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });
    await repo.transition(r1.id, "AWAITING_CONTACT");

    const r2 = await repo.insert({
      phoneStubHash: `restart-hash-2-${ts7}`,
      channel: "cli",
      channelUserId: user2,
      state: "INITIAL",
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });
    // Transition to terminal
    await repo.transition(r2.id, "PRE_AUTH_TOKEN_ISSUED");

    const active = await repo.loadAllActive();
    const activeIds = active.map((r) => r.id);

    expect(activeIds).toContain(r1.id);
    expect(activeIds).not.toContain(r2.id);
  });

  // ─── AC-008: findExpiredActive ─────────────────────────────────────────────

  it("AC-008: findExpiredActive finds records past their expiresAt", async () => {
    const ts8 = Date.now() + 8;
    const userId = `expired-user-${ts8}`;
    // Insert with expiresAt in the past
    const r = await repo.insert({
      phoneStubHash: `expired-hash-${ts8}`,
      channel: "cli",
      channelUserId: userId,
      state: "INITIAL",
      expiresAt: new Date(Date.now() - 1000), // 1 second in the past
    });
    await repo.transition(r.id, "AWAITING_CONTACT");

    const expired = await repo.findExpiredActive(new Date());
    const expiredIds = expired.map((rec) => rec.id);
    expect(expiredIds).toContain(r.id);
  });

  // ─── OTP attempt increment ────────────────────────────────────────────────

  it("incrementOtpAttempt increments count without clearing otp_hash", async () => {
    const ts = Date.now() + 5;
    const record = await repo.insert({
      phoneStubHash: `otp-attempt-hash-${ts}`,
      channel: "cli",
      channelUserId: `otp-user-${ts}`,
      state: "INITIAL",
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    await repo.transition(record.id, "AWAITING_EMAIL_OTP", {
      otpHash: "someHash",
      otpSalt: "someSalt",
      otpExpiresAt: new Date(Date.now() + 15 * 60 * 1000),
      otpAttemptCount: 0,
    });

    await repo.incrementOtpAttempt(record.id);
    const after = await repo.findById(record.id);
    if (after?.state !== "AWAITING_EMAIL_OTP") throw new Error("type guard");
    expect(after.attemptCount).toBe(1);
    expect(after.otpHash).toBe("someHash");
  });

  // ─── C-001: transition() clearOtp flag ────────────────────────────────────

  it("C-001: transition() with clearOtp:true sets OTP columns to NULL regardless of COALESCE", async () => {
    const ts = Date.now() + 9;
    const record = await repo.insert({
      phoneStubHash: `coalesce-test-hash-${ts}`,
      channel: "cli",
      channelUserId: `coalesce-user-${ts}`,
      state: "INITIAL",
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    // Set OTP fields
    await repo.transition(record.id, "AWAITING_EMAIL_OTP", {
      otpHash: "hash-value",
      otpSalt: "salt-value",
      otpExpiresAt: new Date(Date.now() + 15 * 60 * 1000),
      otpAttemptCount: 0,
    });

    // Transition with clearOtp: true — OTP fields must be NULL in DB
    await repo.transition(record.id, "EMAIL_CONFIRMED", { clearOtp: true });

    const rawResult = await pool.query(
      `SELECT otp_hash, otp_salt, otp_expires_at FROM registrations WHERE id = $1`,
      [record.id],
    );
    expect(rawResult.rows[0].otp_hash).toBeNull();
    expect(rawResult.rows[0].otp_salt).toBeNull();
    expect(rawResult.rows[0].otp_expires_at).toBeNull();
  });

  it("C-001: transition() without clearOtp preserves existing OTP values via COALESCE", async () => {
    const ts = Date.now() + 10;
    const record = await repo.insert({
      phoneStubHash: `coalesce-preserve-${ts}`,
      channel: "cli",
      channelUserId: `coalesce-user2-${ts}`,
      state: "INITIAL",
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    // Set OTP fields
    await repo.transition(record.id, "AWAITING_EMAIL_OTP", {
      otpHash: "preserved-hash",
      otpSalt: "preserved-salt",
      otpExpiresAt: new Date(Date.now() + 15 * 60 * 1000),
      otpAttemptCount: 0,
    });

    // Transition without OTP updates (no clearOtp, no otpHash/otpSalt) — values preserved
    await repo.transition(record.id, "AWAITING_EMAIL_OTP");

    const rawResult = await pool.query(
      `SELECT otp_hash, otp_salt FROM registrations WHERE id = $1`,
      [record.id],
    );
    expect(rawResult.rows[0].otp_hash).toBe("preserved-hash");
    expect(rawResult.rows[0].otp_salt).toBe("preserved-salt");
  });

  // ─── C-002: transitionOnOtpLockout is atomic ──────────────────────────────

  it("C-002: transitionOnOtpLockout atomically transitions to AWAITING_EMAIL with cleared OTP and reset count", async () => {
    const ts = Date.now() + 11;
    const record = await repo.insert({
      phoneStubHash: `lockout-test-hash-${ts}`,
      channel: "cli",
      channelUserId: `lockout-user-${ts}`,
      state: "INITIAL",
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    // Set OTP fields and increment attempt count to 2
    await repo.transition(record.id, "AWAITING_EMAIL_OTP", {
      otpHash: "lockout-hash",
      otpSalt: "lockout-salt",
      otpExpiresAt: new Date(Date.now() + 15 * 60 * 1000),
      otpAttemptCount: 2,
    });

    // Simulate lockout via atomic method
    const result = await repo.transitionOnOtpLockout(record.id);

    expect(result.state).toBe("AWAITING_EMAIL");

    const rawResult = await pool.query(
      `SELECT otp_hash, otp_salt, otp_expires_at, otp_attempt_count FROM registrations WHERE id = $1`,
      [record.id],
    );
    expect(rawResult.rows[0].otp_hash).toBeNull();
    expect(rawResult.rows[0].otp_salt).toBeNull();
    expect(rawResult.rows[0].otp_expires_at).toBeNull();
    expect(rawResult.rows[0].otp_attempt_count).toBe(0);
  });

  // ─── SI-002: cello_ops_agent cannot DELETE ─────────────────────────────────

  it("SI-002: cello_ops_agent role cannot DELETE from registrations", async () => {
    const ts = Date.now() + 6;
    const record = await repo.insert({
      phoneStubHash: `si002-hash-${ts}`,
      channel: "cli",
      channelUserId: `si002-user-${ts}`,
      state: "INITIAL",
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    await expect(
      pool.query(`DELETE FROM registrations WHERE id = $1`, [record.id]),
    ).rejects.toThrow();
  });
});
