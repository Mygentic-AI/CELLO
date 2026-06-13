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

/**
 * M7-MANIFEST-002: Augmented signaling_auth_ok frame.
 *
 * After authenticating the client's step-4 response, the directory signs a TBS
 * (to-be-signed) byte array with its per-node Ed25519 key and includes nodeId,
 * signature, and timestamp. The client verifies this in step 6.
 *
 * Fields are optional for backward compatibility with pre-MANIFEST-002 clients.
 */
export interface SignalingAuthOk {
  type: "signaling_auth_ok";
  /** Directory node unique identifier. Present in MANIFEST-002+ directories. */
  nodeId?: string;
  /** Ed25519 signature over the step-5 TBS — 128-char hex (64 bytes). */
  signature?: string;
  /** ISO 8601 UTC timestamp at signing. Present alongside nodeId. */
  timestamp?: string;
}

/** M7-MANIFEST-002: Client requests a fresh manifest from the directory. */
export interface ManifestPollRequest {
  type: "manifest_poll_request";
}

/** M7-MANIFEST-002: Directory responds to a manifest poll with the current manifest. */
export interface ManifestPollResponse {
  type: "manifest_poll_response";
  manifest: import("@cello-protocol/protocol-types").ConsortiumManifest;
}

// ─── Peer info announce (client → directory, after signaling_auth_ok) ─────────

/**
 * Sent by the client immediately after receiving `signaling_auth_ok`.
 * Registers the agent's dialable libp2p Peer ID and listen multiaddrs with the directory.
 * The directory requires this before processing any `session_request` from this client.
 * AC-014/AC-015: NODE-001.
 */
export interface PeerInfoAnnounce {
  type: "peer_info_announce";
  peer_id: string;       // libp2p Peer ID string
  multiaddrs: string[];  // listen multiaddrs
}

// ─── Session request / assignment frame types ──────────────────────────────────

export interface SessionRequest {
  type: "session_request";
  target_pubkey: Uint8Array; // 32-byte K_local pubkey of the desired counterparty
  /** SESSION-006 / CONNREQ-002: required in M3; absent in M2 legacy frames */
  connection_id?: string;
  /**
   * CELLO-RELAY-001: client-reported RTT measurements to known relays.
   * Map from relayId (Ed25519 public key hex) to RTT in milliseconds.
   * Used by the directory to assign the lowest-latency available relay.
   * Optional — if absent, the directory assigns the relay with the lowest
   * consecutive failure count.
   */
  relay_rtt?: Record<string, number>;
  /**
   * M7-WIRE-001 AC-001: Initiator's ephemeral session libp2p Peer ID.
   * Required by handler — if absent, directory rejects with 'session_request_missing_peer_id'.
   * Optional at parse level for backward compat with pre-M7 frames.
   */
  initiator_session_peer_id?: string;
  /**
   * M7-WIRE-001 AC-001: Initiator's ephemeral session listen multiaddrs.
   * Required by handler — if absent, directory rejects with 'session_request_missing_peer_id'.
   * Optional at parse level for backward compat with pre-M7 frames.
   */
  initiator_session_addrs?: string[];
}

// ─── M7-WIRE-001: Session offer accept (target → directory) ─────────────────

/**
 * M7-WIRE-001 AC-003: Target accepts a session offer by providing its ephemeral
 * session Peer ID and listen multiaddrs. The directory embeds these in the final
 * SessionAssignment so both parties can attempt direct transport.
 */
export interface SessionOfferAccept {
  type: "session_offer_accept";
  session_id: Uint8Array;               // 16 bytes — matches pending session offer
  counterparty_session_peer_id: string;  // target's ephemeral session libp2p Peer ID
  counterparty_session_addrs: string[];  // target's ephemeral session listen multiaddrs
}

// SessionAssignment and participant/relay types live in @cello-protocol/protocol-types (MSG-004 boundary fix).
// Re-exported here for backwards compatibility.
import type { SessionAssignment as SessionAssignmentBase, ParticipantInfo, RelayEndpointInfo } from "@cello-protocol/protocol-types";
export type { ParticipantInfo, RelayEndpointInfo };

// M7-WIRE-001: Extend SessionAssignment with M7 fields locally until @cello-protocol/protocol-types
// is published at 0.0.5+. Remove this extension after AC-021 dependency update.
export type SessionAssignment = SessionAssignmentBase & {
  initiator_session_peer_id: string;
  initiator_session_addrs: string[];
  counterparty_session_peer_id: string;
  counterparty_session_addrs: string[];
  transport_mode: "direct" | "relay";
};
export type { SessionAssignmentBase };
/** @deprecated Use RelayEndpointInfo instead */
export type RelayEndpoint = RelayEndpointInfo;

export interface SessionAssignmentFrame {
  type: "session_assignment";
  assignment: SessionAssignment;
}

// ─── Session outcome frame types (re-exported from @cello-protocol/protocol-types) ────
// These are wire-format events that cross process boundaries.
export type {
  SessionAbandoned,
  SessionSealedSingle,
  SessionSealedFrost,
  SessionSealed,
  SealRejectionReason,
  SessionSealRejected,
  SealVerified,
} from "@cello-protocol/protocol-types";

// ─── SESSION-005: New signaling frames ────────────────────────────────────────

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
  | "ceremony_timeout"             // M6B-002: FROST ceremony timed out waiting for client response
  | "ceremony_exhausted"           // M6B-002: FROST ceremony ran but returned null (agent not bootstrapped)
  | "ceremony_conflict"            // SESSION-004: concurrent ceremony already in-flight for this agent
  | "peer_not_registered"          // NODE-001 AC-014: client has not sent peer_info_announce yet
  | "not_registered"               // REG-001 AC-009: agent has not completed registration
  | "no_connection"                // SESSION-006/CONNREQ-002: no active connection between initiator+target
  | "connection_id_required"       // SESSION-006: session_request missing connection_id field
  | "session_request_missing_peer_id";  // M7-WIRE-001 AC-002: session_request missing initiator_session_peer_id or addrs

export interface SessionRequestError {
  type: "session_request_error";
  reason: SessionRequestErrorReason;
}

export interface NotAuthenticated {
  type: "not_authenticated";
}

// ─── REG-001: Registration frame types ────────────────────────────────────────

export type { RegisterRequest, DkgComplete, RegisterSuccess, RegisterError, RegisterErrorReason } from "@cello-protocol/protocol-types";

// ─── CONNREQ-002: Connection request frame types (re-exported from protocol-types) ───

export type {
  ConnectionRequest,
  ConnectionRequestInbound,
  ConnectionResponse,
  ConnectionEstablished,
  ConnectionRejected,
  ConnectionInsufficient,
  ConnectionRequestError,
  ConnectionRequestErrorReason,
  DisclosureRequest,
  DisclosureRequestItem,
  DisclosureRequestInbound,
  DisclosureResponse,
  DisclosureResponseInbound,
} from "@cello-protocol/protocol-types";

// ─── PERSIST-014: Seal attempt frames ────────────────────────────────────────

/**
 * seal_attempt: client → directory, to report local Merkle state before sealing.
 * Each party submits independently; directory compares and either proceeds or rejects.
 */
export interface SealAttempt {
  type: "seal_attempt";
  session_id: Uint8Array;     // 16 bytes
  reported_root: Uint8Array;  // 32-byte local Merkle root
  reported_seq: number;       // highest global sequence number in local tree
}

/**
 * SEAL_REJECTED_TREE_MISMATCH: directory → both parties, when seal attempts have differing roots.
 */
export interface SealRejectedTreeMismatch {
  type: "seal_rejected_tree_mismatch";
  session_id: Uint8Array;
  party_a_sequence: number;
  party_b_sequence: number;
}

/**
 * seal_attempt_ack: directory → client, confirming the seal attempt was received.
 * If both parties submitted matching roots, the normal seal flow proceeds.
 */
export interface SealAttemptAck {
  type: "seal_attempt_ack";
  session_id: Uint8Array;
}

// ─── PERSIST-015: Unilateral seal types ──────────────────────────────────────

/**
 * seal_unilateral: client → directory, requesting a unilateral seal after delivery_grace_seconds.
 */
export interface SealUnilateral {
  type: "seal_unilateral";
  session_id: Uint8Array;     // 16 bytes
  reported_root: Uint8Array;  // 32-byte local Merkle root
  reported_seq: number;       // highest global sequence number in local tree
}

/**
 * seal_unilateral_too_early: directory → client, when grace period hasn't elapsed.
 */
export interface SealUnilateralTooEarly {
  type: "seal_unilateral_too_early";
  session_id: Uint8Array;
  remaining_seconds: number;
}

/**
 * seal_unilateral_confirmed: directory → submitting client, when unilateral seal succeeds.
 */
export interface SealUnilateralConfirmed {
  type: "seal_unilateral_confirmed";
  session_id: Uint8Array;
  sealed_root: Uint8Array;   // 32-byte sealed Merkle root
  sealed_at: number;         // Unix timestamp ms
}

/**
 * seal_unilateral_notification: directory → absent party, delivered on reconnect.
 */
export interface SealUnilateralNotification {
  type: "seal_unilateral_notification";
  session_id: Uint8Array;
  sealed_root: Uint8Array;
  sealed_at: number;
  seal_type: "UNILATERAL";
}

// ─── Internal directory session state ─────────────────────────────────────────
// SealNotarization is a storage-only type — defined in @cello-protocol/interfaces, imported where needed.
export type { SealNotarization } from "@cello-protocol/interfaces";

// ─── Relay seal data (mirror of relay-types SealData, kept local to avoid cross-package import) ──

import type { Structure2 } from "@cello-protocol/protocol-types";

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
  /**
   * M7-WIRE-001 AC-009: Initiator's ephemeral session Peer ID for relay binding.
   * The relay uses this to verify the connecting peer matches the session assignment.
   */
  initiator_session_peer_id?: string;
  /**
   * M7-WIRE-001 AC-009: Counterparty's ephemeral session Peer ID for relay binding.
   * The relay uses this to verify the connecting peer matches the session assignment.
   */
  counterparty_session_peer_id?: string;
  /**
   * M7-WIRE-001 AC-009: Transport mode for this session.
   * 'direct' — clients attempt direct P2P connection using ephemeral session Peer IDs.
   * 'relay' — clients route through the assigned relay.
   */
  transport_mode?: "direct" | "relay";
}

// ─── Time source abstraction (test-only injection) ────────────────────────────

/** Allows tests to drive nonce expiry without wall-clock sleep. */
export interface TimeSource {
  now(): number;
}

export const WALL_CLOCK: TimeSource = { now: () => Date.now() };
