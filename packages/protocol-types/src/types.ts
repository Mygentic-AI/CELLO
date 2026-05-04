/**
 * @cello/protocol-types — CELLO-MSG-001 (v0) + CELLO-MSG-003 (v1)
 *
 * Wire types for the MessageEnvelope.
 *
 * v0 TBS layout (positional, RFC 8949 §4.2.1 canonical CBOR):
 *   [protocol_version, content_hash, sender_pubkey, timestamp]
 *
 * v1 TBS layout (Structure 1, RFC 8949 §4.2.1 canonical CBOR):
 *   [protocol_version, content_hash, sender_pubkey, session_id, last_seen_seq, timestamp]
 *
 * Wire format (canonical CBOR, RFC 8949 §4.2.1):
 *   Full envelope is a CBOR map with the fields below.
 *
 * Ed25519 reference: RFC 8032
 * CBOR reference: RFC 8949
 */

// ─── Envelope v0 ─────────────────────────────────────────────────────────────

/**
 * A signed, tamper-evident message envelope (v0, M0).
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

// ─── Envelope v1 ─────────────────────────────────────────────────────────────

/**
 * A signed, tamper-evident message envelope (v1, M1).
 *
 * Adds session_id and last_seen_seq to the TBS array (Structure 1).
 * protocol_version is always 1. M1 hard-cuts v0 — these are never interoperable.
 *
 * TBS (Structure 1): [1, content_hash, sender_pubkey, session_id, last_seen_seq, timestamp]
 * All byte arrays are bare Uint8Array values — no CBOR tag.
 *
 * Ed25519 reference: RFC 8032
 * CBOR reference: RFC 8949 §4.2.1
 */
export interface MessageEnvelopeV1 {
  /** CBOR unsigned integer, always 1 in M1. */
  protocol_version: 1;

  /** 32-byte Ed25519 K_local public key of the sender. */
  sender_pubkey: Uint8Array;

  /** Raw message content, up to 1 MiB. */
  content: Uint8Array;

  /**
   * SHA-256(0x00 || content) — computed by msgLeafHash from @cello/crypto.
   * ALWAYS recomputed by buildEnvelopeV1; any caller-supplied value is ignored.
   */
  content_hash: Uint8Array;

  /** 16-byte session identifier. */
  session_id: Uint8Array;

  /**
   * Highest canonical sequence number seen from relay on this session.
   * 0 for the first message on a session.
   * CBOR unsigned integer, non-negative.
   */
  last_seen_seq: number;

  /** Unix milliseconds, non-negative. */
  timestamp: number;

  /**
   * 64-byte Ed25519 signature over canonical CBOR of Structure 1:
   * [1, content_hash, sender_pubkey, session_id, last_seen_seq, timestamp]
   */
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

// ─── v1 Result types ──────────────────────────────────────────────────────────

export type BuildResultV1 = { ok: true; envelope: MessageEnvelopeV1 } | { ok: false; error: EnvelopeError };
export type DeserializeResultV1 = { ok: true; envelope: MessageEnvelopeV1 } | { ok: false; error: EnvelopeError };
