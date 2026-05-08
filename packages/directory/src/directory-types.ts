/**
 * CELLO Directory Node — wire types and internal types (NODE-001)
 *
 * Frame protocol: /cello/signaling/1.0.0
 * Framing: it-length-prefixed (unsigned varint per multiformats spec)
 * Encoding: canonical CBOR per RFC 8949 §4.2.1
 *
 * Auth domain string: "CELLO-DIR-AUTH-v1"
 * Auth signature: Ed25519(SHA-256("CELLO-DIR-AUTH-v1" || nonce || pubkey), privkey)
 *   per RFC 8032 (Ed25519) and FIPS 180-4 (SHA-256)
 */

// ─── Auth frame types ─────────────────────────────────────────────────────────

export interface SignalingAuthChallenge {
  type: "signaling_auth_challenge";
  nonce: Uint8Array; // 32 bytes, CSPRNG
}

export interface SignalingAuthResponse {
  type: "signaling_auth_response";
  pubkey: Uint8Array;    // 32-byte Ed25519 K_local public key
  signature: Uint8Array; // 64-byte Ed25519 signature over "CELLO-DIR-AUTH-v1" || nonce || pubkey
}

export type DirAuthFailedReason =
  | "nonce_expired"
  | "nonce_unknown"
  | "signature_invalid";

export interface SignalingAuthFailed {
  type: "signaling_auth_failed";
  reason: DirAuthFailedReason;
}

export interface SignalingAuthOk {
  type: "signaling_auth_ok";
}

// ─── Session request / assignment frame types ──────────────────────────────────

export interface SessionRequest {
  type: "session_request";
  target_pubkey: Uint8Array; // 32-byte K_local pubkey of the desired counterparty
}

// SessionAssignment and participant/relay types live in @cello/protocol-types (MSG-004 boundary fix).
// Re-exported here for backwards compatibility.
import type { SessionAssignment, ParticipantInfo, RelayEndpointInfo } from "@cello/protocol-types";
export type { SessionAssignment, ParticipantInfo, RelayEndpointInfo };
/** @deprecated Use RelayEndpointInfo instead */
export type RelayEndpoint = RelayEndpointInfo;

export interface SessionAssignmentFrame {
  type: "session_assignment";
  assignment: SessionAssignment;
}

// ─── Session outcome frame types ──────────────────────────────────────────────

export interface SessionAbandoned {
  type: "session_abandoned";
  session_id: Uint8Array; // 16 bytes
}

/**
 * M1 session_sealed frame (single-key directory signature).
 * Refused in M2 clients per SESSION-005 SI-003.
 * @deprecated Use SessionSealedFrost instead in M2+.
 */
export interface SessionSealedSingle {
  type: "session_sealed";
  signature_type: "single";
  session_id: Uint8Array;          // 16 bytes
  sealed_root: Uint8Array;         // 32-byte final Merkle root
  directory_signature: Uint8Array; // 64-byte Ed25519 over canonical CBOR([session_id, sealed_root, close_timestamp])
  close_timestamp: number;         // Unix ms
}

/**
 * M2 session_sealed frame (FROST-notarized ceremony signature).
 * SESSION-005: seal_type is 'frost' when the FROST ceremony completes.
 */
export interface SessionSealedFrost {
  type: "session_sealed";
  signature_type: "frost";
  session_id: Uint8Array;          // 16 bytes
  sealed_root: Uint8Array;         // 32-byte final Merkle root
  frost_signature: Uint8Array;     // 64-byte combined FROST signature over seal TBS
  signer_pubkey: Uint8Array;       // 32-byte initiator primary_pubkey (group public key)
  close_timestamp: number;         // Unix ms
}

/** Discriminated union: M2 sends SessionSealedFrost; old M1 wire format is SessionSealedSingle. */
export type SessionSealed = SessionSealedSingle | SessionSealedFrost;

export interface SessionSealRejected {
  type: "session_seal_rejected";
  session_id: Uint8Array; // 16 bytes
  reason: SealRejectionReason;
}

export type SealRejectionReason =
  | "merkle_root_mismatch"
  | "leaf_signature_invalid"
  | "prev_root_chain_broken"
  | "causal_chain_violated"
  | "seal_leaves_invalid"
  | "seal_signature_invalid";

// ─── SESSION-005: New signaling frames ────────────────────────────────────────

/**
 * seal_verified: directory → seal initiator, after all three verification passes pass.
 * Tells the initiator: "I've verified the tree — coordinate the FROST ceremony now."
 * Per SESSION-005 step 4 in the seal ceremony flow.
 */
export interface SealVerified {
  type: "seal_verified";
  session_id: Uint8Array;  // 16 bytes
  sealed_root: Uint8Array; // 32-byte final Merkle root (recomputed by directory)
  leaf_count: number;      // total leaves in the verified tree
  timestamp: number;       // Unix ms (used in FROST TBS)
}

/**
 * seal_frost_signature: seal initiator → directory, after FROST ceremony completes.
 * The combined 64-byte FROST signature over the seal TBS.
 * Per SESSION-005 step 6 in the seal ceremony flow.
 */
export interface SealFrostSignature {
  type: "seal_frost_signature";
  session_id: Uint8Array;     // 16 bytes (identifies the session)
  frost_signature: Uint8Array; // 64-byte combined FROST output
}

/**
 * session_frost_sealed: directory → both clients, when a deferred seal ceremony completes.
 * Used when the directory was unreachable at seal time (seal_deferred) and later returns.
 * Per SESSION-005 deferred seal flow (DB-001/DB-002/DB-003).
 */
export interface SessionFrostSealed {
  type: "session_frost_sealed";
  session_id: Uint8Array;     // 16 bytes
  sealed_root: Uint8Array;    // 32-byte final Merkle root
  frost_signature: Uint8Array; // 64-byte combined FROST signature
  signer_pubkey: Uint8Array;  // 32-byte initiator primary_pubkey
}

// ─── Error frame types ─────────────────────────────────────────────────────────

export type SessionRequestErrorReason =
  | "target_offline"
  | "relay_unavailable"
  | "frost_signer_not_configured"  // SESSION-004: no IThresholdSigner registered for this initiator
  | "directory_below_threshold"    // SESSION-004: FROST ceremony failed — insufficient signers
  | "ceremony_conflict";           // SESSION-004: concurrent ceremony already in-flight for this agent

export interface SessionRequestError {
  type: "session_request_error";
  reason: SessionRequestErrorReason;
}

export interface NotAuthenticated {
  type: "not_authenticated";
}

// ─── Internal directory session state ─────────────────────────────────────────

export interface SealNotarization {
  session_id: Uint8Array;          // 16 bytes
  sealed_root: Uint8Array;         // 32-byte Merkle root
  participant_a_pubkey: Uint8Array; // 32 bytes
  participant_b_pubkey: Uint8Array; // 32 bytes
  close_timestamp: number;         // Unix ms
  directory_signature: Uint8Array; // 64-byte Ed25519 over canonical CBOR of notarization fields
}

// ─── Relay seal data (mirror of relay-types SealData, kept local to avoid cross-package import) ──

import type { Structure2 } from "@cello/protocol-types";

export interface RelaySealLeaf {
  kind: "msg" | "ctrl";
  s2: Structure2;
  structure1_cbor: Uint8Array;
}

export interface RelaySealData {
  leaves: RelaySealLeaf[];
  seq_count: number;
  merkle_root: Uint8Array;
}

// ─── Relay in-process assignment (lean subset for relay.recordAssignment) ─────

export interface RelaySessionAssignment {
  session_id: Uint8Array;
  participant_a: Uint8Array;  // 32-byte K_local pubkey
  participant_b: Uint8Array;  // 32-byte K_local pubkey
  session_timestamp: number;
  directory_signature: Uint8Array;
}

// ─── Time source abstraction (test-only injection) ────────────────────────────

/** Allows tests to drive nonce expiry without wall-clock sleep. */
export interface TimeSource {
  now(): number;
}

export const WALL_CLOCK: TimeSource = { now: () => Date.now() };
