/**
 * CELLO Relay Node — wire types and internal types (NODE-002)
 *
 * Frame protocol: /cello/relay/1.0.0
 * Framing: it-length-prefixed (unsigned varint per multiformats spec)
 * Encoding: canonical CBOR per RFC 8949 §4.2.1
 *
 * Auth domain string: "CELLO-RELAY-AUTH-v1"
 * Auth signature: Ed25519(SHA-256("CELLO-RELAY-AUTH-v1" || nonce || pubkey), privkey)
 *   per RFC 8032 (Ed25519) and FIPS 180-4 (SHA-256)
 */

import type { Structure2 } from "@cello/protocol-types";

// ─── Auth frame types ─────────────────────────────────────────────────────────

export interface RelayAuthChallenge {
  type: "relay_auth_challenge";
  nonce: Uint8Array; // 32 bytes, CSPRNG
}

export interface RelayAuthResponse {
  type: "relay_auth_response";
  pubkey: Uint8Array;    // 32-byte Ed25519 K_local public key
  signature: Uint8Array; // 64-byte Ed25519 signature over "CELLO-RELAY-AUTH-v1" || nonce || pubkey
}

export type AuthFailedReason =
  | "nonce_expired"
  | "nonce_unknown"
  | "nonce_reused"
  | "signature_invalid";

export interface RelayAuthFailed {
  type: "relay_auth_failed";
  reason: AuthFailedReason;
}

export interface RelayAuthOk {
  type: "relay_auth_ok";
}

// ─── Data frame types ─────────────────────────────────────────────────────────

export interface HashSubmit {
  type: "hash_submit";
  session_id: Uint8Array;   // 16 bytes
  leaf_kind: number;        // 0x00 (message) or 0x02 (control)
  structure1_cbor: Uint8Array; // canonical CBOR of Structure 1
  sender_signature: Uint8Array; // 64-byte Ed25519 signature — same as inside structure1_cbor
}

export interface LeafDeliver {
  type: "leaf_deliver";
  session_id: Uint8Array;       // 16 bytes
  leaf_kind: number;             // 0x00 or 0x02
  sequence_number: number;       // MSG-004: seq from Structure 2; client uses this to update last_seen_seq without decoding structure2_cbor
  structure2_cbor: Uint8Array;
  structure1_cbor: Uint8Array;  // MSG-004: exact bytes sender signed; receiver needs last_seen_seq + timestamp
}

// ─── Error response types ─────────────────────────────────────────────────────

export type HashSubmitErrorReason =
  | "session_not_found"
  | "not_a_participant"
  | "leaf_kind_invalid"
  | "signature_invalid"
  | "sender_mismatch"
  | "last_seen_seq_ahead"
  | "session_sealed";

export interface HashSubmitError {
  type: "hash_submit_error";
  reason: HashSubmitErrorReason;
}

export interface HashSubmitAck {
  type: "hash_submit_ack";
  sequence_number: number;
}

// ─── SessionAssignment (from directory, in-process call) ─────────────────────

export interface SessionAssignment {
  session_id: Uint8Array;         // 16 bytes
  participant_a: Uint8Array;      // 32-byte K_local pubkey
  participant_b: Uint8Array;      // 32-byte K_local pubkey
  session_timestamp: number;      // Unix ms
  directory_signature: Uint8Array; // 64-byte Ed25519 over canonical CBOR of assignment fields
}

// ─── Internal relay session state ────────────────────────────────────────────

export type SessionStatus = "active" | "sealing" | "seal_rejected";

export interface RelaySessionState {
  assignment: SessionAssignment;
  genesis_prev_root: Uint8Array; // SHA-256(sorted(A,B) || session_id || session_timestamp)
  seq_counter: number;           // 0 initially; incremented to 1 on first leaf
  leaf_log: Array<{ kind: "msg" | "ctrl"; s2: Structure2; structure1_cbor: Uint8Array }>; // ordered
  status: SessionStatus;
}

// ─── Seal interface ────────────────────────────────────────────────────────────

export interface SealData {
  leaves: Array<{ kind: "msg" | "ctrl"; s2: Structure2; structure1_cbor: Uint8Array }>;
  seq_count: number;
  merkle_root: Uint8Array;
}
