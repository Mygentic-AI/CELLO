/**
 * @cello/protocol-types — CELLO-MSG-001
 *
 * Wire types for the MessageEnvelope (protocol version 0).
 *
 * TBS (to-be-signed) array layout (positional, RFC 8949 §4.2.1 canonical CBOR):
 *   [protocol_version, content_hash, sender_pubkey, timestamp]
 *
 * Wire format (canonical CBOR, RFC 8949 §4.2.1):
 *   Full envelope is a CBOR map with the six fields below.
 *
 * Ed25519 reference: RFC 8032
 * CBOR reference: RFC 8949
 */

// ─── Envelope ────────────────────────────────────────────────────────────────

/**
 * A signed, tamper-evident message envelope (v0).
 *
 * All byte arrays are bare Uint8Array values — no CBOR tag.
 * The timestamp is stored as a JS number (milliseconds since Unix epoch).
 */
export interface MessageEnvelope {
  /** CBOR unsigned integer, always 0 in M0. */
  protocol_version: 0;

  /** 32-byte Ed25519 K_local public key of the sender. */
  sender_pubkey: Uint8Array;

  /** Raw message content, up to 1 MiB. */
  content: Uint8Array;

  /**
   * SHA-256(0x00 || content) — computed by msgLeafHash from @cello/crypto.
   * ALWAYS recomputed by buildEnvelope; any caller-supplied value is ignored.
   */
  content_hash: Uint8Array;

  /** Unix milliseconds, non-negative. */
  timestamp: number;

  /** 64-byte Ed25519 signature over canonical CBOR of TBS. */
  sender_signature: Uint8Array;
}

// ─── Error shapes ─────────────────────────────────────────────────────────────

export interface ContentTooLargeError {
  reason: "content_too_large";
  message: string;
}

export interface ContentHashMismatchError {
  reason: "content_hash_mismatch";
  message: string;
}

export interface UnsupportedVersionError {
  reason: "unsupported_version";
  message: string;
}

export interface InvalidFieldError {
  reason: "invalid_field";
  field: string;
  message: string;
}

export interface MissingFieldError {
  reason: "missing_field";
  field: string;
  message: string;
}

export type EnvelopeError =
  | ContentTooLargeError
  | ContentHashMismatchError
  | UnsupportedVersionError
  | InvalidFieldError
  | MissingFieldError;

// ─── Result type ──────────────────────────────────────────────────────────────

export type BuildResult = { ok: true; envelope: MessageEnvelope } | { ok: false; error: EnvelopeError };
export type ValidateResult = { ok: true } | { ok: false; error: EnvelopeError };
export type DeserializeResult = { ok: true; envelope: MessageEnvelope } | { ok: false; error: EnvelopeError };
