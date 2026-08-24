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
 *   directory → relay:  discard_session
 *   relay → directory:  seal_submission (relay-initiated when bilateral SEAL detected)
 *
 * DOD-M15-RELAYADMIN-DEAD-FRAMES-1 (2026-08-24): record_assignment, confirm_seal and reject_seal
 * were REMOVED from this wire protocol. No deployed directory has sent them since Option B
 * (client-presented assignments) and the seal-broker cutover shipped — every recorded fleet
 * image postdates both removal commits. discard_session remains the one live directory→relay
 * dial (AC-011 provisional-session cleanup on stream close). An authenticated frame naming one
 * of the three retired types now falls through to the "unknown frame type" abort in
 * relay-node.ts, same as any other unrecognised type — not silently accepted.
 */

import type { RelayLeafKind } from "./relay-types.js";

// ─── Directory → Relay request frames ────────────────────────────────────────

export interface DiscardSessionFrame {
  type: "discard_session";
  session_id: Uint8Array;         // 16 bytes
  directory_signature: Uint8Array; // 64-byte Ed25519 over CBOR of body without this field
}

export type DirectoryToRelayFrame = DiscardSessionFrame;

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
  kind: RelayLeafKind;
  s2: unknown;               // Structure2 — typed as unknown to avoid cross-package import
  structure1_cbor: Uint8Array;
}

// ─── Response frames ──────────────────────────────────────────────────────────

export interface DiscardOkFrame {
  type: "discard_ok";
}

export interface SealReceivedFrame {
  type: "seal_received";
}

export interface AuthInvalidFrame {
  type: "auth_invalid";
}

export type DirectoryRelayResponse =
  | DiscardOkFrame
  | SealReceivedFrame
  | AuthInvalidFrame;
