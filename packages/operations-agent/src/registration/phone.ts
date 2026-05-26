/**
 * phone.ts — Phone number normalization and hashing for SI-002 compliance.
 *
 * Phase P — Pseudocode:
 *   normalizePhone(raw):
 *     // Strip all non-digit characters except leading +
 *     strip non-digit, keep leading +
 *     return normalized
 *
 *   hashPhone(normalized):
 *     // SI-002: SHA-256 of normalized phone — never store raw phone number
 *     return SHA-256(normalized) in hex
 *
 * Security: SI-002 — Phone numbers are stored only as their SHA-256 hash.
 * A database breach does not reveal phone numbers. The hash is deterministic
 * so the same phone number always produces the same stub hash, enabling
 * deduplication checks without storing the raw number.
 */

import { createHash } from "node:crypto";

/**
 * Normalize a phone number to E.164-like format for consistent hashing.
 * Strips all whitespace, dashes, parentheses. Keeps leading +.
 */
export function normalizePhone(raw: string): string {
  // Keep leading + if present, then keep only digits
  const stripped = raw.startsWith("+")
    ? "+" + raw.slice(1).replace(/\D/g, "")
    : raw.replace(/\D/g, "");
  return stripped;
}

/**
 * Compute SHA-256(normalized_phone) in hex — the phone_stub_hash stored in the DB.
 * SI-002: Only this hash is stored, never the raw phone number.
 */
export function hashPhone(normalizedPhone: string): string {
  return createHash("sha256").update(normalizedPhone, "utf8").digest("hex");
}
