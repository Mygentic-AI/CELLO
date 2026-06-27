/**
 * WRITEAPI-001 — payload discipline for the directory write seam.
 *
 * The seam accepts ONLY three safe-to-replicate write kinds, each with a STRICT schema. There is no
 * free-text field anywhere — so plaintext, PII, and tokens have no slot to occupy (DOD-INV-2,
 * WRITEAPI-001 SI-001). Rejection is structural: an unknown kind, an unexpected key, a hash that is
 * not 64-hex, or a "ciphertext" that decodes to printable text are all rejected before any DB write.
 */

export const SUPPORTED_WRITE_KINDS = [
  "revocation_flag",
  "trust_signal_hash",
  "trust_signal_ciphertext",
] as const;
export type WriteKind = (typeof SUPPORTED_WRITE_KINDS)[number];

// The trust-signal hash is a SHA-256 digest in lowercase hex.
const SHA256_HEX = /^[0-9a-f]{64}$/;
// Signal kinds the identity tree currently understands (extend as new M-stories land consumers).
const SIGNAL_KINDS = new Set(["webauthn"]);
// A sealed ciphertext is opaque high-entropy bytes. Bound its size and reject anything that decodes
// to entirely printable text (a raw email / token / JSON would — a real sealed blob never does).
const MIN_SEALED_BYTES = 48; // ephemeral pubkey (32) + MAC (16) is the floor for a sealed box
const MAX_SEALED_BYTES = 65536;

export type ValidatedWrite =
  | { kind: "revocation_flag"; paused: boolean }
  | { kind: "trust_signal_hash"; signalKind: string; signalHash: string }
  | { kind: "trust_signal_ciphertext"; ciphertext: Buffer };

export type ValidationResult =
  | { ok: true; write: ValidatedWrite }
  | { ok: false; reason: string };

/** True iff `obj` is a plain object whose keys are exactly `keys` (no missing, no extra). */
function hasExactKeys(obj: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(obj);
  return actual.length === keys.length && keys.every((k) => Object.prototype.hasOwnProperty.call(obj, k));
}

/** True iff every decoded byte is printable ASCII or common whitespace — i.e. plausibly plaintext. */
function isAllPrintable(bytes: Buffer): boolean {
  for (const b of bytes) {
    const printable = b >= 0x20 && b <= 0x7e;
    const whitespace = b === 0x09 || b === 0x0a || b === 0x0d;
    if (!printable && !whitespace) return false;
  }
  return true;
}

/**
 * Validate a (writeKind, payload) pair into a persisted-ready shape, or a rejection reason.
 * Reasons are distinct per cause (lateral catch discipline): unsupported_kind, invalid_payload,
 * invalid_hash, invalid_signal_kind, invalid_ciphertext, not_object.
 */
export function validateWritePayload(writeKind: unknown, payload: unknown): ValidationResult {
  if (typeof writeKind !== "string" || !SUPPORTED_WRITE_KINDS.includes(writeKind as WriteKind)) {
    return { ok: false, reason: "unsupported_kind" };
  }
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return { ok: false, reason: "not_object" };
  }
  const p = payload as Record<string, unknown>;

  switch (writeKind as WriteKind) {
    case "revocation_flag": {
      // Exactly { mode }. mode ∈ {pause, clear}. No reason/free-text reaches the directory — the
      // operational reason is captured in the portal audit log, never replicated here.
      if (!hasExactKeys(p, ["mode"])) return { ok: false, reason: "invalid_payload" };
      if (p["mode"] !== "pause" && p["mode"] !== "clear") return { ok: false, reason: "invalid_payload" };
      return { ok: true, write: { kind: "revocation_flag", paused: p["mode"] === "pause" } };
    }
    case "trust_signal_hash": {
      if (!hasExactKeys(p, ["signalKind", "signalHash"])) return { ok: false, reason: "invalid_payload" };
      const signalKind = p["signalKind"];
      const signalHash = p["signalHash"];
      if (typeof signalKind !== "string" || !SIGNAL_KINDS.has(signalKind)) {
        return { ok: false, reason: "invalid_signal_kind" };
      }
      if (typeof signalHash !== "string" || !SHA256_HEX.test(signalHash)) {
        return { ok: false, reason: "invalid_hash" };
      }
      return { ok: true, write: { kind: "trust_signal_hash", signalKind, signalHash } };
    }
    case "trust_signal_ciphertext": {
      if (!hasExactKeys(p, ["ciphertext"])) return { ok: false, reason: "invalid_payload" };
      const ciphertext = p["ciphertext"];
      if (typeof ciphertext !== "string" || ciphertext.length === 0) {
        return { ok: false, reason: "invalid_ciphertext" };
      }
      let bytes: Buffer;
      try {
        bytes = Buffer.from(ciphertext, "base64");
      } catch {
        return { ok: false, reason: "invalid_ciphertext" };
      }
      // Reject non-base64 (Buffer.from is lenient — re-encode and compare to catch garbage), too
      // short to be a sealed box, oversized, or plausibly-plaintext (all printable).
      if (bytes.toString("base64").replace(/=+$/, "") !== ciphertext.replace(/=+$/, "")) {
        return { ok: false, reason: "invalid_ciphertext" };
      }
      if (bytes.length < MIN_SEALED_BYTES || bytes.length > MAX_SEALED_BYTES) {
        return { ok: false, reason: "invalid_ciphertext" };
      }
      if (isAllPrintable(bytes)) {
        return { ok: false, reason: "invalid_ciphertext" };
      }
      return { ok: true, write: { kind: "trust_signal_ciphertext", ciphertext: bytes } };
    }
  }
}
