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

// ─── Session request / assignment frame types ──────────────────────────────────

export interface SessionRequest {
  type: "session_request";
  target_pubkey: Uint8Array; // 32-byte K_local pubkey of the desired counterparty
}

export interface ParticipantInfo {
  pubkey: Uint8Array;    // 32-byte K_local pubkey
  peer_id: string;       // libp2p Peer ID (transport identity)
  multiaddrs: string[];  // dialable multiaddrs
}

export interface RelayEndpoint {
  peer_id: string;
  multiaddrs: string[];
}

export interface SessionAssignment {
  session_id: Uint8Array;           // 16 bytes, CSPRNG
  participant_a: ParticipantInfo;
  participant_b: ParticipantInfo;
  relay_endpoint: RelayEndpoint;
  session_timestamp: number;        // Unix ms
  directory_pubkey: Uint8Array;     // 32-byte directory identity pubkey
  directory_signature: Uint8Array;  // 64-byte Ed25519 over canonical CBOR of assignment fields
}

export interface SessionAssignmentFrame {
  type: "session_assignment";
  assignment: SessionAssignment;
}

// ─── Session outcome frame types ──────────────────────────────────────────────

export interface SessionSealed {
  type: "session_sealed";
  session_id: Uint8Array; // 16 bytes
  sealed_root: Uint8Array; // 32-byte final Merkle root
}

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
  | "seal_leaves_invalid";

// ─── Error frame types ─────────────────────────────────────────────────────────

export type SessionRequestErrorReason =
  | "target_offline"
  | "relay_unavailable";

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
