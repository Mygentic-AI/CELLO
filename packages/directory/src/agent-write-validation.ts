/**
 * WRITEAPI-001 — payload discipline for the directory write seam.
 *
 * After M10-D18 this seam accepts ONE write kind: `revocation_flag` (the kill-switch). The trust-signal
 * arms (`trust_signal_hash` / `trust_signal_ciphertext`) and the `SIGNAL_KINDS` enum are RETIRED — trust
 * signals now enter ONLY through the signed chokepoint (`POST /internal/signal/submit`, re-hashed and
 * authorized against `authorized_issuers`) and are delivered via `POST /internal/signal/deliver`, never
 * this API-key seam. There is no free-text field anywhere — so plaintext, PII, and tokens have no slot to
 * occupy (DOD-INV-2, WRITEAPI-001 SI-001). Rejection is structural: an unknown kind, an unexpected key, or
 * a bad mode is rejected before any DB write.
 */

export const SUPPORTED_WRITE_KINDS = ["revocation_flag"] as const;
export type WriteKind = (typeof SUPPORTED_WRITE_KINDS)[number];

export type RevocationMode = "pause" | "clear" | "burn";
export type ValidatedWrite = { kind: "revocation_flag"; mode: RevocationMode };

export type ValidationResult =
  | { ok: true; write: ValidatedWrite }
  | { ok: false; reason: string };

/** True iff `obj` is a plain object whose keys are exactly `keys` (no missing, no extra). */
function hasExactKeys(obj: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(obj);
  return actual.length === keys.length && keys.every((k) => Object.prototype.hasOwnProperty.call(obj, k));
}

/**
 * Validate a (writeKind, payload) pair into a persisted-ready shape, or a rejection reason.
 * Reasons are distinct per cause (lateral catch discipline): unsupported_kind, invalid_payload, not_object.
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
      // Exactly { mode }. mode ∈ {pause, clear, burn}. No reason/free-text reaches the directory — the
      // operational reason is captured in the portal audit log, never replicated here. pause is
      // reversible; burn is PERMANENT (capability dies, accountability survives).
      if (!hasExactKeys(p, ["mode"])) return { ok: false, reason: "invalid_payload" };
      const mode = p["mode"];
      if (mode !== "pause" && mode !== "clear" && mode !== "burn") return { ok: false, reason: "invalid_payload" };
      return { ok: true, write: { kind: "revocation_flag", mode } };
    }
  }
}
