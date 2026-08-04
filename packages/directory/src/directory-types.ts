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
  /**
   * Cross-node topology (item 3): set true ONLY on a transient "visiting" connection (a client
   * reaching into a node that is NOT its home to broker a cross-node session). A visiting auth still
   * gets a #streams entry (so the same-node flow sees it) but writes NO presence — connect or
   * disconnect — so it never clobbers the agent's real home ownership. NOT signature-bound: the TBS
   * ("CELLO-DIR-AUTH-v1" || nonce || pubkey) is unchanged; the flag rides the encrypted libp2p
   * channel and its only effect is suppressing presence writes. Absent ⇒ a normal home connection.
   */
  visiting?: boolean;
}

// ─── Cross-node discovery lookup (item 1) ────────────────────────────────────
// A post-auth "where is agent X?" query answered from FULLY-REPLICATED state (agent_profiles +
// agent_presence). Advisory — the target node's own #streams check stays authoritative.

export type DiscoveryLookupState = "online" | "offline" | "unknown_agent";

export interface DiscoveryLookup {
  type: "discovery_lookup";
  target_pubkey: Uint8Array; // 32-byte K_local pubkey (the address)
}

export interface DiscoveryLookupResult {
  type: "discovery_lookup_result";
  target_pubkey: Uint8Array;
  state: DiscoveryLookupState;
  /** Non-empty only when state = "online" (length 1 until the k>1 homing knob lands). */
  owning_node_ids: string[];
}

export interface DiscoveryLookupError {
  type: "discovery_lookup_error";
  reason: "lookup_failed";
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
  /**
   * DOD-NAT-REACHABILITY-1: the directory's available relay pool, so the agent's
   * standing receiver can take circuit-relay reservations BEFORE any session
   * exists (a NAT'd agent is otherwise unreachable for its first inbound
   * request). Not covered by the step-5 signature — it rides the authenticated
   * signaling channel, the same trust rail as session_assignment frames.
   * Absent on pre-NAT-REACHABILITY directories and when no relay is known.
   */
  relay_endpoints?: Array<{ peer_id: string; multiaddrs: string[] }>;
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
  /**
   * M7-WIRE-001 AC-009: Client-requested transport mode.
   * Defaults to 'relay' when absent. TRANSPORT-001 stub: directory currently
   * honours this value directly; real AutoNAT probe will override in TRANSPORT-001.
   */
  transport_mode?: "direct" | "relay";
  /**
   * M7-WIRE-002: Initiator opts in to the session_offer→session_offer_accept
   * round-trip so the SessionAssignment carries the counterparty's reachable
   * SESSION endpoint (its standing-receiver node, not its directory node).
   * Absent/false keeps pre-WIRE-002 callers on the original no-offer path.
   */
  wants_session_offer?: boolean;
  /**
   * MONIKER-2 AC1: the initiator's outbound display name, an UNVERIFIED HINT the
   * directory passes through into the assignment (never stored, never in the TBS).
   * Bounded at decode (string, 1–64 chars); the RECEIVER validates the charset.
   */
  moniker?: string;
  /** DOD-PRESENT-1: trust signals the initiator wishes to present to the target. */
  trust_signals?: Array<{ hash: string; blob: Uint8Array }>;
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

/**
 * DOD-DIR-FAILCLOSED-1 (D2) / daemon DOD-OFFER-REJECT-1 (D1): the target's definitive
 * "cannot accept" answer to a session_offer — the Generic Reject of the inbound-state matrix.
 * Resolves the directory's offer-accept waiter immediately (no 2 s stall) so the initiator
 * gets a fast session_request failure instead of a fabricated endpoint-less assignment.
 * session_id is null when the daemon had no session_id to echo (its no_session_id abort) —
 * such a reject is uncorrelatable and only logged.
 */
export interface SessionOfferReject {
  type: "session_offer_reject";
  session_id: Uint8Array | null;  // 16 bytes when present; null = uncorrelatable diagnostics
  reason: string;                 // e.g. "standing_receiver_unavailable"
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
  /**
   * MONIKER-2 AC1: the initiator's outbound display name, passed through from the
   * session_request. UNSIGNED (outside the TBS — no integrity claim, spec §2) and
   * optional; omitted when the initiator sent none. The receiver validates it at
   * its wire boundary before anything displays or stores it.
   */
  moniker?: string;
  /** DOD-PRESENT-1: trust signals that survived the directory's dumb check (membership + active). */
  trust_signals?: Array<{ hash: string; blob: Uint8Array }>;
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
import type { SessionSealed as SessionSealedBase } from "@cello-protocol/protocol-types";

// ─── M7-SESSION-004: Seal certificate legibility wire shape ────────────────────
// Local mirror of @cello-protocol/protocol-types SealLegibility. The published
// protocol-types predates this story's bump (deferred to milestone close per
// COORDINATION batching), so the wire shape is defined here — the same local-mirror
// pattern used for RelaySealData below. After the protocol-types dep bump (AC-013)
// this can switch to the canonical type.
export type AttestationMode = "live" | "recovered" | "absent";

export interface SealLegibilityParticipant {
  pubkey: Uint8Array;
  content_frontier_seq: number;
  last_authored_seq: number;
  attestation_mode: AttestationMode;
}

export interface SealLegibilityFinalMessage {
  sender_pubkey: Uint8Array;
  seq: number;
  answered: boolean;
}

export interface SealLegibility {
  attests: "receipt";
  implies_assent: false;
  disclaimer: string;
  participants: SealLegibilityParticipant[];
  final_message: SealLegibilityFinalMessage;
}

/**
 * DOD-LEG-2 (SI-002): the minimal signed-leaf material a receiving client needs to
 * INDEPENDENTLY re-derive each party's `content_frontier_seq` and reject an inflated
 * published frontier (`certificate_frontier_unverifiable`). The client verifies
 * `sender_signature` (Ed25519 over `structure1_cbor`) itself, so it does NOT trust the
 * directory for these values — only for transporting signed bytes it re-checks.
 */
export interface SealFrontierLeaf {
  structure1_cbor: Uint8Array;
  sender_pubkey: Uint8Array;
  sender_signature: Uint8Array;
}

/**
 * SessionSealed wire frame carrying the M7-SESSION-004 legibility certificate.
 * The directory always attaches `legibility` for new seals; the field is optional
 * for backward-compatible decode of pre-M7 frames. `frontier_leaves` (DOD-LEG-2) carries
 * the signed leaves so the client can re-derive + verify the published frontier.
 */
export type SessionSealedWithLegibility = SessionSealedBase & {
  legibility?: SealLegibility;
  frontier_leaves?: SealFrontierLeaf[];
};

/**
 * seal_verified frame carrying the legibility object (bilateral seal only). The directory sends
 * legibility to the seal initiator so the initiator's daemon binds the SAME legibility hash into
 * the TBS it co-signs — directory and daemon must agree on the bound TBS or the FROST seal fails.
 * Absent on the unilateral seal (which carries no legibility).
 */
export type SealVerifiedWithLegibility = import("@cello-protocol/protocol-types").SealVerified & {
  legibility?: SealLegibility;
  frontier_leaves?: SealFrontierLeaf[];
};

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
  /**
   * M7-SESSION-004 (review finding #3): the receipt-not-assent legibility certificate,
   * derived once at seal time. Carried here so a session that completes via the deferred
   * seal_deferred → session_frost_sealed path ends with the SAME legibility as a live
   * push — legibility is independent of delivery timing. Optional for backward-compatible
   * decode of pre-M7 frames.
   */
  legibility?: SealLegibility;
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
  | "session_request_missing_peer_id"  // M7-WIRE-001 AC-002: session_request missing initiator_session_peer_id or addrs
  | "agent_revoked"  // CELLO-M7-REMOVE-001 DOD-REMOVE-3: the target agent has been revoked
  | "agent_suspended"  // CELLO-M8-LEVER-001 DOD-INV-6: the target/initiator is PAUSED (reversible)
  // DOD-DIR-FAILCLOSED-1 (D2): the target never accepted the session_offer — it answered
  // session_offer_reject, or the wait timed out. Distinguishable from target_offline: the target
  // IS connected to the directory, it just cannot serve this session right now (e.g. its standing
  // receiver has not come up). The directory signs NOTHING on this path.
  | "counterparty_did_not_accept";

export interface SessionRequestError {
  type: "session_request_error";
  reason: SessionRequestErrorReason;
}

// ─── CELLO-M7-REMOVE-001 (DOD-REMOVE-2): agent revocation frames ──────────────
// Local copies until @cello-protocol/protocol-types is published with these shapes (M7-WIRE-001
// convention). The inbound request mirrors protocol-types RevokeAgentRequest; the signature is hex.

export interface RevokeAgentRequest {
  type: "revoke_agent";
  /** The directory-assigned agent_id (agent_profiles.agent_id) being revoked. */
  agent_id: string;
  epoch_id?: string;
  reason?: string;
  revoked_at: number;
  /** Hex Ed25519 signature over the canonical revocation TBS, by the agent's own K_local. */
  signature: string;
}

export interface AgentRevocationAck {
  type: "agent_revocation_ack";
  agent_id: string;
}

export type AgentRevocationErrorReason = "unknown_agent" | "not_self_authorized" | "signature_invalid" | "malformed" | "persist_failed";

export interface AgentRevocationError {
  type: "agent_revocation_error";
  reason: AgentRevocationErrorReason;
  agent_id?: string;
}

// ─── CELLO-M8-TRUST-001: trust-signal pickup delivery ──────────────────────────
// The directory delivers a sealed trust signal to the agent's daemon over signaling (OUTBOUND); the
// daemon opens it with its k_local, verifies the recomputed hash against signal_hash, stores it, and
// ACKs by id (INBOUND) — after which the directory DELETEs the pickup_queue row (capability to read
// the signal dies at the daemon; the directory keeps only the hash).
export interface TrustSignalPickup {
  type: "trust_signal_pickup";
  /** pickup_queue.id — the ACK handle. */
  id: string;
  signal_kind: string;
  /** The authoritative directory hash (identity tree), hex — the daemon's verification anchor. */
  signal_hash: string;
  /** The opaque sealed ciphertext; only the agent's k_local seed opens it. */
  ciphertext: Uint8Array;
}

export interface TrustSignalAck {
  type: "trust_signal_ack";
  /** The pickup_queue.id the daemon verified + stored; the directory deletes it on receipt. */
  id: string;
}

export interface NotAuthenticated {
  type: "not_authenticated";
}

// ─── REG-001: Registration frame types ────────────────────────────────────────

export type { RegisterRequest, DkgComplete, RegisterSuccess, RegisterError, RegisterErrorReason } from "@cello-protocol/protocol-types";

// ─── M8C-PRIMARY-1: Primary/Standby transfer frame types ─────────────────────

export type { PrimaryTransferRequest, PrimaryTransferAck, PrimaryTransferError } from "@cello-protocol/protocol-types";

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
/**
 * FED-OPTIONB-SEAL-001: a client-carried leaf for the directory's OFFLINE unilateral-tree rebuild. The
 * relay receipt fields (relay_id/relay_timestamp/relay_signature) are present ONLY for the present party's
 * own leaves (the relay signed an ACK over content_hash→seq → the teeth that pin order); the absent party's
 * leaves carry none (pinned by their sender_signature + sequence contiguity).
 */
export interface SealUnilateralLeaf {
  sequence_number: number;
  leaf_kind: number;                 // 0x00 message / 0x02 control (SEAL)
  structure2_cbor: Uint8Array;       // the relay's committed Structure2 (CBOR)
  structure1_cbor: Uint8Array;       // the sender-signed Structure1 (CBOR)
  relay_id?: string;                 // hex of the relay ack-signing pubkey (own leaves)
  relay_timestamp?: number;          // Unix ms in the relay ACK TBS (own leaves)
  relay_signature?: Uint8Array;      // 64-byte relay ACK signature (own leaves)
}

export interface SealUnilateral {
  type: "seal_unilateral";
  session_id: Uint8Array;     // 16 bytes
  reported_root: Uint8Array;  // 32-byte local Merkle root
  reported_seq: number;       // highest global sequence number in local tree
  // FED-OPTIONB-SEAL-001 (Option B): the carried leaf chain (both parties) for the directory's offline
  // tree rebuild. Optional for pre-M8B clients (the directory refuses a unilateral seal without it under
  // Option B — there is no longer a directory→relay getSealLeaves fallback).
  seal_leaves?: SealUnilateralLeaf[];
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
 * SESSION-002 unilateral seal certificate. Carried on both seal_unilateral_confirmed
 * (present party) and seal_unilateral_notification (absent party). It is sufficient for
 * the recipient to rebuild the canonical seal TBS and verify the signature against a key
 * it trusts INDEPENDENTLY of the delivering channel (SI-003) — a channel-swapped
 * sealed_root fails the signature check.
 */
export interface SealCertificateFields {
  sealed_root: Uint8Array;            // 32-byte sealed Merkle root (TBS-bound)
  leaf_count: number;                 // number of leaves in the sealed chain (TBS-bound)
  close_timestamp: number;            // Unix ms (TBS-bound)
  frost_signature: Uint8Array;        // 64-byte FROST (or single-key) signature over the seal TBS
  signature_type: "frost" | "single"; // 'frost' verifies vs the session primary_pubkey; 'single' vs the directory node key
  present_pubkey: Uint8Array;         // 32-byte present (submitting) party
  absent_pubkey: Uint8Array;          // 32-byte absent counterparty (never a signer)
  // DOD-LIVE-2: how the counterparty is recorded — ABSENT (the relay observed it gone) or
  // DELIVERED (alive / unknown fail-safe). Feeds DOD-LEG-3 attestation_mode in the cert.
  attestation_mode: "ABSENT" | "DELIVERED";
  seal_type: "UNILATERAL";
  // M8B FINDING-3 (cascade-2): the receipt-not-assent legibility certificate — the SAME
  // shape the bilateral session_sealed frame carries (per-party content frontiers, attestation
  // modes, final_message), with the absent counterparty recorded attestation_mode 'absent'.
  // The present party's daemon persists this (recordSealCertificate) so cello_get_sealed_receipt
  // returns a durable, retrievable receipt for a unilateral close — the whole point of sealing
  // when your counterparty has vanished. Optional for back-compat with pre-cascade-2 directories.
  legibility?: SealLegibility;
}

/**
 * seal_unilateral_confirmed: directory → submitting client, when unilateral seal succeeds.
 * Carries the full certificate (SESSION-002) so the present party verifies the signature
 * over the rebuilt TBS before recording the session sealed.
 */
export interface SealUnilateralConfirmed extends SealCertificateFields {
  type: "seal_unilateral_confirmed";
  session_id: Uint8Array;
  sealed_at: number;         // Unix timestamp ms (== close_timestamp; kept for back-compat)
  // M8B FINDING-5 (cascade-2): the signed leaves the legibility's per-party content_frontier_seq was
  // derived from — the SAME shape the bilateral session_sealed frame carries. Shipped ONLY on the
  // present party's confirm frame (not the absent party's notification) so the present party's daemon
  // can INDEPENDENTLY re-derive each frontier and REJECT an inflated directory-published value (SI-002).
  // Optional for back-compat with pre-FINDING-5 directories.
  frontier_leaves?: SealFrontierLeaf[];
}

/**
 * seal_unilateral_notification: directory → absent party, delivered on reconnect.
 * Carries the full certificate so the absent party (which has no local tail) verifies the
 * signature against an independently-trusted key WITHOUT trusting the channel.
 */
export interface SealUnilateralNotification extends SealCertificateFields {
  type: "seal_unilateral_notification";
  session_id: Uint8Array;
  sealed_at: number;
}

// ─── CELLO-M7-UPGRADE-001 (DOD-UP-1): unilateral → bilateral seal upgrade ─────────

/**
 * seal_upgrade_request: the previously-ABSENT party (B) → directory, after B has returned,
 * recovered + verified the content, and signed an attestation over the EXISTING sealed root R1.
 *
 * Model 2 (see M7 build journal 2026-06-23 decision): B does NOT re-seal over a new root — it
 * RATIFIES the unilateral seal's root R1. `ack_signature` is B's Ed25519 signature, made with B's
 * K_local, over the upgrade-ack TBS = CBOR([SEAL_UPGRADE_ACK_DOMAIN, session_id, sealed_root]).
 * The directory verifies it against the unilateral notarization's participant_b_pubkey — so only
 * the absent party itself can upgrade (AC-007, no delegation). The content-possession precondition
 * is enforced on B's daemon (it produces the ack ONLY after recover+verify); the directory's job
 * is to confirm the signature is genuinely B's over R1.
 */
export interface SealUpgradeRequest {
  type: "seal_upgrade_request";
  session_id: Uint8Array;       // 16 bytes
  returning_pubkey: Uint8Array; // 32 bytes — must equal the unilateral seal's absent party
  ack_signature: Uint8Array;    // 64-byte Ed25519 signature over the upgrade-ack TBS
  // leaf_count of the sealed chain (from the unilateral cert B received). The directory does not
  // store it on the notarization row; B forwards it so the directory can relay it on the confirmed
  // frame, letting the present party rebuild the seal TBS and verify its own attestation (AC-008).
  leaf_count: number;
}

export type SealUpgradeRejectedReason =
  | "no_unilateral_seal"   // no notarization exists for this session — nothing to upgrade
  | "already_bilateral"    // session is already bilaterally sealed (idempotent: B may treat as success)
  | "not_absent_party"     // sender is not the unilateral seal's absent party (AC-007)
  | "ack_signature_invalid"; // ack_signature does not verify against the absent party over R1

/**
 * seal_upgrade_rejected: directory → B, when the upgrade cannot proceed.
 */
export interface SealUpgradeRejected {
  type: "seal_upgrade_rejected";
  session_id: Uint8Array;
  reason: SealUpgradeRejectedReason;
}

/**
 * seal_upgrade_confirmed: directory → both parties, when the unilateral seal has been upgraded
 * to bilateral. Carries the DUAL-ATTESTATION certificate over the unchanged sealed root R1: the
 * present party's original seal signature AND the returning party's ratification. A client marks
 * the seal bilateral only after verifying BOTH against R1 (AC-008).
 */
export interface SealUpgradeConfirmed {
  type: "seal_upgrade_confirmed";
  session_id: Uint8Array;
  sealed_root: Uint8Array;              // 32-byte R1 — unchanged from the unilateral seal
  leaf_count: number;                   // leaves in the sealed chain — rebuilds the seal TBS (AC-008)
  close_timestamp: number;              // Unix ms — from the unilateral notarization
  present_pubkey: Uint8Array;           // 32-byte present party (A) — the original seal signer
  present_signature: Uint8Array;        // A's original seal signature over the seal TBS (from the unilateral row)
  present_signature_type: "frost" | "single"; // how to verify present_signature (vs A's primary_pubkey / directory node key)
  returning_pubkey: Uint8Array;         // 32-byte returning party (B)
  returning_signature: Uint8Array;      // B's ack signature over the upgrade-ack TBS
  seal_type: "BILATERAL";
}

// ─── Internal directory session state ─────────────────────────────────────────
// SealNotarization is a storage-only type — defined in @cello-protocol/interfaces, imported where needed.
export type { SealNotarization } from "@cello-protocol/interfaces";

// ─── Relay seal data (mirror of relay-types SealData, kept local to avoid cross-package import) ──

import type { Structure2 } from "@cello-protocol/protocol-types";

/**
 * A leaf domain the directory can see in a carried chain (DOD-DOC-LEAF-1). "doc" (0x04) and
 * "reject" (0x05) are document-collaboration leaves; only "ctrl" (0x02) is a SEAL ceremony leaf.
 */
export type RelaySealLeafKind = "msg" | "ctrl" | "doc" | "reject";

export interface RelaySealLeaf {
  kind: RelaySealLeafKind;
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
