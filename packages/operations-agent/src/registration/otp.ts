/**
 * otp.ts — OTP generation and hashing helpers for the registration state machine.
 *
 * Phase P — Pseudocode:
 *   generateOtp():
 *     bytes = crypto.randomBytes(4)   // 32 bits of entropy
 *     num = bytes.readUInt32BE(0) % 1_000_000  // mod to 6 digits
 *     return num.toString().padStart(6, '0')    // zero-padded string
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

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Generate a cryptographically random 6-digit OTP string.
 * Uses rejection sampling to eliminate modulo bias:
 *   MAX_SAFE = floor(2^32 / 1_000_000) * 1_000_000 = 4_294_000_000
 *   Values in [0, MAX_SAFE) are uniformly mapped; values >= MAX_SAFE are discarded.
 *   Retry probability ≈ 0.023% — negligible performance impact.
 * Zero-padded to always be exactly 6 characters.
 */
export function generateOtp(): string {
  const MAX_SAFE = 4_294_000_000; // floor(2^32 / 1_000_000) * 1_000_000
  while (true) {
    const bytes = randomBytes(4);
    const num = bytes.readUInt32BE(0);
    if (num < MAX_SAFE) {
      return (num % 1_000_000).toString().padStart(6, "0");
    }
    // ~0.023% chance of retry — negligible
  }
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
