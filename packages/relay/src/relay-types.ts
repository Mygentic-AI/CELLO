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

import type { Structure2 } from "@cello-protocol/protocol-types";
import { msgLeafHash, ctrlLeafHash, docLeafHash, rejectLeafHash } from "@cello-protocol/crypto";

// ─── Leaf kinds (DOD-DOC-LEAF-1) ─────────────────────────────────────────────

/** The leaf domains this relay witnesses. Domain-separated per RFC 6962 §2.1. */
export type RelayLeafKind = "msg" | "ctrl" | "doc" | "reject";

/**
 * Wire byte → domain. The ONLY mapping; a second copy is how the byte and the hash drift.
 *
 * 0x01 is deliberately absent and must never be added: it is the RFC 6962 internal-node
 * prefix, so a 64-byte leaf hashed under it is byte-identical to nodeHash(left, right) and
 * forges tree shape (§2.1.3). An unlisted byte is REFUSED, never coerced — coercion would
 * hash the leaf under a domain its sender did not use, diverging the two parties' roots.
 */
export const RELAY_LEAF_KINDS: Readonly<Record<number, RelayLeafKind>> = {
  0x00: "msg",
  0x02: "ctrl",
  0x04: "doc",
  0x05: "reject",
};

/** Domain → leaf-hash function. Must stay consistent with RELAY_LEAF_KINDS. */
export const RELAY_LEAF_HASHERS: Readonly<Record<RelayLeafKind, (data: Uint8Array) => Uint8Array>> = {
  msg: msgLeafHash,
  ctrl: ctrlLeafHash,
  doc: docLeafHash,
  reject: rejectLeafHash,
};

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
  leaf_kind: number;        // see RELAY_LEAF_KINDS — the authoritative byte→domain map
  structure1_cbor: Uint8Array; // canonical CBOR of Structure 1
  sender_signature: Uint8Array; // 64-byte Ed25519 signature — same as inside structure1_cbor
  /**
   * FEDERATION-003 AC-005/AC-006/SI-002: Predecessor relay ACK for re-submission.
   *
   * When a client re-submits a hash to a new relay after the original relay went down,
   * the client includes the ACK it received from the predecessor relay. The new relay
   * uses this to verify the predecessor's signature before issuing its own ACK.
   *
   * If predecessor_relay_id is set, the new relay MUST verify the predecessor ACK:
   *   - Fetch predecessor's public key from directory via getRelayPublicKey(predecessor_relay_id)
   *   - If not found: reject with RELAY_PREDECESSOR_UNKNOWN (SI-002)
   *   - Verify Ed25519.verify(pubKey, buildRelayAckTbs(hash, seq, ts), predecessor_relay_signature)
   *   - If invalid: reject with RELAY_PREDECESSOR_UNKNOWN (SI-002 — no fallback)
   *
   * If predecessor_relay_id is absent: treated as a first submission (no predecessor verification).
   */
  predecessor_relay_id?: string;
  predecessor_relay_signature?: Uint8Array; // 64-byte Ed25519 ACK signature from predecessor
  predecessor_relay_sequence?: number;       // sequence_number from predecessor ACK
  predecessor_relay_timestamp?: number;      // timestamp from predecessor ACK
}

export interface LeafDeliver {
  type: "leaf_deliver";
  session_id: Uint8Array;       // 16 bytes
  leaf_kind: number;             // see RELAY_LEAF_KINDS
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
  | "session_sealed"
  /** FEDERATION-003 AC-006/SI-002: predecessor relay ACK could not be verified */
  | "RELAY_PREDECESSOR_UNKNOWN";

export interface HashSubmitError {
  type: "hash_submit_error";
  reason: HashSubmitErrorReason;
}

export interface HashSubmitAck {
  type: "hash_submit_ack";
  sequence_number: number;
  /**
   * PERSIST-012: Stable identifier for the signing relay.
   * Allows the client (and future relays) to look up the relay's public key
   * for ACK signature verification. Absent when relay has no signing key.
   */
  relay_id?: string;
  /**
   * PERSIST-012: 64-byte Ed25519 signature over SHA-256(hash_bytes || seq_BE4 || ts_BE8).
   * Signed by the relay's signing key (not the transport key).
   * Absent when relay has no signing key configured.
   */
  relay_signature?: Uint8Array;
  /**
   * PERSIST-012: Unix ms timestamp embedded in the ACK TBS.
   * Required for deterministic signature reconstruction by the client.
   * Absent when relay has no signing key configured.
   */
  timestamp?: number;
  /**
   * DOD-MSG-4 (self-ordering content frame): the full CBOR-encoded Structure2 the relay just
   * committed for this leaf — the SAME record it delivers to the counterparty via leaf_deliver.
   * Returned to the SENDER so it can stamp the signed ordering record into its content frame, so the
   * receiver verifies + orders from the content frame alone (no dependence on the leaf_deliver stream).
   */
  structure2_cbor?: Uint8Array;
}

// ─── SessionAssignment (from directory, in-process call) ─────────────────────

export interface SessionAssignment {
  session_id: Uint8Array;         // 16 bytes
  participant_a: Uint8Array;      // 32-byte K_local pubkey
  participant_b: Uint8Array;      // 32-byte K_local pubkey
  session_timestamp: number;      // Unix ms
  directory_signature: Uint8Array; // 64-byte Ed25519 over canonical CBOR of assignment fields
  /**
   * M7-WIRE-001 AC-009: Initiator's ephemeral session Peer ID for relay binding.
   * When present, the relay verifies the connecting peer's libp2p Peer ID matches.
   */
  initiator_session_peer_id?: string;
  /**
   * M7-WIRE-001 AC-009: Counterparty's ephemeral session Peer ID for relay binding.
   * When present, the relay verifies the connecting peer's libp2p Peer ID matches.
   */
  counterparty_session_peer_id?: string;
  /**
   * M7-WIRE-001 AC-009: Transport mode for this session.
   * 'direct' — clients attempt direct P2P; relay is fallback only.
   * 'relay' — clients route all traffic through the relay.
   */
  transport_mode?: "direct" | "relay";
}

// ─── Internal relay session state ────────────────────────────────────────────

export type SessionStatus = "active" | "sealing" | "seal_rejected";

export interface RelaySessionState {
  assignment: SessionAssignment;
  genesis_prev_root: Uint8Array; // SHA-256(sorted(A,B) || session_id || session_timestamp)
  seq_counter: number;           // 0 initially; incremented to 1 on first leaf
  leaf_log: Array<{ kind: RelayLeafKind; s2: Structure2; structure1_cbor: Uint8Array }>; // ordered
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
  /**
   * CELLO-M6B-009: Unix ms timestamp when this session was last written.
   * Set to Date.now() on recordSession() and updated on each setSession() call.
   * Used by the idle sweep to identify abandoned sessions.
   */
  lastActivityAt: number;
}

// ─── Seal interface ────────────────────────────────────────────────────────────

export interface SealData {
  leaves: Array<{ kind: RelayLeafKind; s2: Structure2; structure1_cbor: Uint8Array }>;
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
  sender_pubkey: Uint8Array;    // 32 bytes
  content_hash: Uint8Array;     // 32 bytes
  sender_signature: Uint8Array; // 64 bytes
  prev_root: Uint8Array;        // 32 bytes
  structure1_cbor: Uint8Array;  // exact bytes sender signed — required for signature verification
}

export interface GapFillResponse {
  type: "gap_fill_response";
  leaves: GapFillLeaf[];
}

export interface GapFillError {
  type: "gap_fill_error";
  reason: "session_not_found" | "wal_unavailable" | "not_a_participant";
}

// ─── CELLO-M7-SESSION-003: session-path liveness frames ────────────────────────

export interface SessionLivenessQuery {
  type: "session_liveness_query";
  session_id: Uint8Array;          // 16 bytes
  counterparty_pubkey: Uint8Array; // 32 bytes — recipient whose liveness is queried
}

export interface SessionLivenessResponse {
  type: "session_liveness_response";
  session_id: Uint8Array;
  counterparty_pubkey: Uint8Array;
  liveness: "alive" | "gone" | "unknown";
  observed_at: number;
}

/**
 * FED-OPTIONB-SETUP-001 (Option B, any-relay/any-directory): the CLIENT presents the
 * directory-signed session assignment to its chosen relay over its already-authenticated client
 * stream, replacing the old directory→relay `recordAssignment` dial. Unlike the directory-ADMIN
 * `record_assignment` frame (which requires a body-level `directory_signature` only the directory can
 * produce), this frame carries NO admin auth — the client cannot impersonate the directory. Its
 * authority is `assignment_signature`: the per-node directory signature over the relay TBS
 * ([session_id, participant_a, participant_b, session_timestamp, (initiator_peer_id,
 * counterparty_peer_id)]). The relay verifies it against ANY consortium directory pubkey, so any
 * sovereign directory can grant relay service.
 */
export interface ClientRecordAssignment {
  type: "client_record_assignment";
  session_id: Uint8Array;            // 16 bytes
  participant_a: Uint8Array;         // 32-byte initiator pubkey
  participant_b: Uint8Array;         // 32-byte counterparty pubkey
  session_timestamp: number;         // Unix ms
  initiator_session_peer_id?: string;
  counterparty_session_peer_id?: string;
  assignment_signature: Uint8Array;  // 64-byte per-node directory sig over the relay TBS (relayDirSig)
}
