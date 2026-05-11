/**
 * CELLO-OBS-001: Protocol logging for the relay node.
 *
 * Phase P (pseudocode):
 *   protocolLog(prefix, message):
 *     ts = ISO 8601 local time, millisecond precision, no trailing Z
 *     padded = "[" + prefix + "]" left-padded to 7 chars
 *     write to stdout: ts + "  " + padded + " " + message + "\n"
 *
 *   truncId(peerId):
 *     return first 8 chars of the base58 peer ID string
 *
 *   truncHex(hex):
 *     return first 8 chars of the hex string (4 bytes)
 *
 * Format: YYYY-MM-DDTHH:MM:SS.sss  [PREFIX] message
 *   - Timestamp: ISO 8601 local time, millisecond precision
 *   - Two spaces between timestamp and prefix
 *   - Prefix: 4–8 chars uppercase in brackets, padded to 7 total chars
 *   - NO ANSI color codes
 *   - Always-on: no log level flag, no conditional
 *
 * Security invariants:
 *   SI-001: never log private key material, FROST shares, nonces, or message content
 *   SI-002: never log full 32-byte values — truncate to 8 chars
 */

export type LogPrefix = "DIR" | "AUTH" | "REG" | "FROST" | "CONN" | "SESS" | "SEAL" | "RELAY";

/**
 * Write a single protocol log line to stdout.
 * Format: YYYY-MM-DDTHH:MM:SS.sss  [PREFIX] message
 */
export function protocolLog(prefix: LogPrefix | string, message: string): void {
  // ISO 8601 local time with milliseconds, no trailing "Z"
  // new Date().toISOString() produces "YYYY-MM-DDTHH:MM:SS.sssZ" — drop the Z
  const ts = new Date().toISOString().slice(0, 23);
  // Pad prefix to 7 chars total: "[" + prefix + "]" left-pad to 7
  const padded = `[${prefix}]`.padEnd(7);
  process.stdout.write(`${ts}  ${padded} ${message}\n`);
}

/**
 * Truncate a peer ID string to the first 8 characters.
 * Per SI-002: never log full peer IDs.
 */
export function truncId(peerId: string): string {
  return peerId.slice(0, 8);
}

/**
 * Truncate a hex string to the first 8 characters (4 bytes).
 * Per SI-002: never log full 32-byte values.
 */
export function truncHex(hex: string): string {
  return hex.slice(0, 8);
}
