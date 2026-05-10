/**
 * CELLO Directory-Relay Protocol — wire types (CELLO-NODE-004)
 *
 * Frame protocol: /cello/directory-relay/1.0.0
 * Framing: it-length-prefixed (unsigned varint per multiformats spec)
 * Encoding: canonical CBOR per RFC 8949 §4.2.1
 * One request/response per stream open (same pattern as /cello/frost/1.0.0)
 *
 * Auth: relay verifies Ed25519 signature over canonical CBOR of the frame body
 *   (all fields except directory_signature).
 *   Signature domain: implicitly the CBOR field "type" value — no separate domain prefix.
 *   The relay holds the directory's known public key (CELLO_DIRECTORY_PUBKEY at startup).
 *
 * Direction:
 *   directory → relay:  record_assignment, discard_session, confirm_seal, reject_seal
 *   relay → directory:  seal_submission (relay-initiated when bilateral SEAL detected)
 */

// ─── Directory → Relay request frames ────────────────────────────────────────

export interface RecordAssignmentFrame {
  type: "record_assignment";
  session_id: Uint8Array;         // 16 bytes
  participant_a: Uint8Array;      // 32-byte K_local pubkey
  participant_b: Uint8Array;      // 32-byte K_local pubkey
  session_timestamp: number | bigint;  // Unix ms (bigint if > 0xffffffff)
  assignment_signature: Uint8Array; // 64-byte Ed25519 over CBOR([session_id, participant_a, participant_b, session_timestamp])
  directory_signature: Uint8Array; // 64-byte Ed25519 over CBOR of body without this field
}

export interface DiscardSessionFrame {
  type: "discard_session";
  session_id: Uint8Array;         // 16 bytes
  directory_signature: Uint8Array; // 64-byte Ed25519 over CBOR of body without this field
}

export interface ConfirmSealFrame {
  type: "confirm_seal";
  session_id: Uint8Array;         // 16 bytes
  directory_signature: Uint8Array; // 64-byte Ed25519 over CBOR of body without this field
}

export interface RejectSealFrame {
  type: "reject_seal";
  session_id: Uint8Array;         // 16 bytes
  reason: string;
  directory_signature: Uint8Array; // 64-byte Ed25519 over CBOR of body without this field
}

export type DirectoryToRelayFrame =
  | RecordAssignmentFrame
  | DiscardSessionFrame
  | ConfirmSealFrame
  | RejectSealFrame;

// ─── Relay → Directory request frames ────────────────────────────────────────

/**
 * Relay → Directory: sent when bilateral SEAL leaves detected.
 * The relay dials the directory and sends this frame.
 * Directory responds with seal_received after queuing verification.
 */
export interface SealSubmissionFrame {
  type: "seal_submission";
  session_id: Uint8Array;    // 16 bytes
  leaves: SealSubmissionLeaf[];
  seq_count: number;
  merkle_root: Uint8Array;   // 32-byte Merkle root as computed by relay
}

export interface SealSubmissionLeaf {
  kind: "msg" | "ctrl";
  s2: unknown;               // Structure2 — typed as unknown to avoid cross-package import
  structure1_cbor: Uint8Array;
}

// ─── Response frames ──────────────────────────────────────────────────────────

export interface AssignmentOkFrame {
  type: "assignment_ok";
}

export interface DiscardOkFrame {
  type: "discard_ok";
}

export interface ConfirmOkFrame {
  type: "confirm_ok";
}

export interface RejectOkFrame {
  type: "reject_ok";
}

export interface SealReceivedFrame {
  type: "seal_received";
}

export interface AuthInvalidFrame {
  type: "auth_invalid";
}

export type DirectoryRelayResponse =
  | AssignmentOkFrame
  | DiscardOkFrame
  | ConfirmOkFrame
  | RejectOkFrame
  | SealReceivedFrame
  | AuthInvalidFrame;
