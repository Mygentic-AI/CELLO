/**
 * otp.ts — OTP generation and hashing helpers for the registration state machine.
 *
 * Phase P — Pseudocode:
 *   generateOtp():
 *     num = crypto.randomInt(0, 1_000_000)  // uniform in [0, 1000000)
 *     return num.toString().padStart(6, '0') // zero-padded string
 *
 *   generateSalt():
 *     return crypto.randomBytes(16).toString('hex')   // 128-bit salt
 *
 *   hashOtp(otp, salt):
 *     // SI-001: SHA-256(otp + salt) — never store plaintext OTP
 *     return SHA-256(otp + salt)  (hex encoding)
 *
 *   verifyOtp(candidateOtp, salt, storedHash):
 *     return hashOtp(candidateOtp, salt) === storedHash
 *
 * Security: SI-001 — OTP hash is SHA-256(otp || salt). A database breach does
 * not reveal valid OTPs because SHA-256 is a one-way function and the salt
 * prevents rainbow table attacks on the small 6-digit OTP space.
 */

import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

/**
 * Generate a cryptographically random 6-digit OTP string.
 * Uses crypto.randomInt(0, 1_000_000) which provides uniform distribution
 * over [0, 999999] without modulo bias.
 * Zero-padded to always be exactly 6 characters.
 */
export function generateOtp(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

/**
 * Generate a random salt for OTP hashing.
 * 16 bytes (128 bits) of entropy — more than adequate for SHA-256 salting.
 */
export function generateOtpSalt(): string {
  return randomBytes(16).toString("hex");
}

/**
 * Hash an OTP with its salt using SHA-256.
 * Stored value: SHA-256(otp + salt) in hex encoding.
 * SI-001: the stored hash cannot be reversed to reveal the OTP.
 */
export function hashOtp(otp: string, salt: string): string {
  return createHash("sha256").update(otp + salt, "utf8").digest("hex");
}

/**
 * Verify a candidate OTP against its stored hash and salt.
 * Uses timingSafeEqual to prevent timing side-channel attacks.
 */
export function verifyOtp(candidateOtp: string, salt: string, storedHash: string): boolean {
  const candidateHash = hashOtp(candidateOtp, salt);
  return timingSafeEqual(Buffer.from(candidateHash, "utf8"), Buffer.from(storedHash, "utf8"));
}
