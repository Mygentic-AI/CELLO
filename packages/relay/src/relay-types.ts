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
  /**
   * RFC 6962 incremental stack. Each entry is the root of a complete 2^height-leaf subtree.
   * Invariant: entries are in ascending height order; no two entries share the same height.
   * Used to compute the running Merkle root in O(log n) per append.
   */
  tree_stack: Array<{ hash: Uint8Array; height: number }>;
  /**
   * Merkle root of all leaves appended so far.
   * Equals genesis_prev_root before the first leaf.
   * Updated after each leaf append via the incremental stack.
   */
  running_root: Uint8Array;
}

// ─── Seal interface ────────────────────────────────────────────────────────────

export interface SealData {
  leaves: Array<{ kind: "msg" | "ctrl"; s2: Structure2; structure1_cbor: Uint8Array }>;
  seq_count: number;
  merkle_root: Uint8Array;
}

// ─── PERSIST-014: Gap-fill frame types ─────────────────────────────────────────

export interface GapFillRequest {
  type: "gap_fill_request";
  session_id: Uint8Array;    // 16 bytes
  from_seq: number;          // exclusive lower bound — leaves with seq > from_seq
  to_seq: number;            // inclusive upper bound — leaves with seq <= to_seq
}

export interface GapFillLeaf {
  sequence_number: number;
  sender_pubkey: Uint8Array;   // 32 bytes
  content_hash: Uint8Array;    // 32 bytes
  sender_signature: Uint8Array; // 64 bytes
  prev_root: Uint8Array;       // 32 bytes
}

export interface GapFillResponse {
  type: "gap_fill_response";
  leaves: GapFillLeaf[];
}

export interface GapFillError {
  type: "gap_fill_error";
  reason: "session_not_found" | "wal_unavailable" | "not_a_participant";
}
