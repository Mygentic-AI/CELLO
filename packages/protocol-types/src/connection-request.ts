/**
 * CELLO Connection Request Wire Types — CONNREQ-002
 *
 * Phase P — Pseudocode
 * ─────────────────────────────────────────────────────────────────────────────
 * ROUND 1 flow (always happens):
 *
 * CLIENT A → DIRECTORY (on authenticated signaling stream):
 *   1. A sends connection_request { target_pubkey, package_cbor }
 *
 * DIRECTORY pre-checks:
 *   a. sender is registered → else connection_request_error { reason: 'not_registered' }
 *   b. target has active profile → else connection_request_error { reason: 'target_not_found' }
 *   c. no existing active connection → else connection_request_error { reason: 'already_connected' }
 *   d. fetch target's registered_at and is_provisional
 *   e. relay to target's stream as connection_request_inbound { from_pubkey, package_cbor,
 *      sender_registered_at, sender_is_provisional }
 *   If target offline → queue (up to 32), deliver on reconnect; if > 32, drop oldest, send
 *      connection_request_error { reason: 'target_unavailable' } to sender
 *
 * TARGET CLIENT receives connection_request_inbound:
 *   1. Check whitelist → if sender whitelisted, send connection_response { verdict: 'accept' }
 *      without calling evaluateConnectionPackage()
 *   2. validateConnectionPackage (CONNREQ-001: pseudonym binding, signatures, expiry)
 *   3. Build DirectoryContext from sender_registered_at, sender_is_provisional
 *   4. evaluateConnectionPackage() (CONNPOL-001)
 *   5. Act on ConnectionReport verdict:
 *      - auto_accept → send connection_response { verdict: 'accept' }
 *      - auto_reject → send connection_response { verdict: 'reject', reason }
 *      - auto_insufficient → send connection_response { verdict: 'insufficient', unmet_requirements }
 *      - pending_agent_review → queue report, fire onConnectionPendingReview
 *
 * DIRECTORY receives connection_response { verdict: 'accept' }:
 *   1. Generate 16-byte CSPRNG connection_id (FIPS 180-4 randomness)
 *   2. Create connection records in DirectoryStore
 *   3. Push connection_established { counterparty_pubkey, connection_id } to BOTH clients
 *
 * DIRECTORY receives connection_response { verdict: 'reject', reason }:
 *   Relay connection_rejected { target_pubkey, reason } to sender. No record created.
 *
 * DIRECTORY receives connection_response { verdict: 'insufficient', unmet_requirements }:
 *   Relay connection_insufficient { target_pubkey, unmet_requirements } to sender. No record.
 *
 * ROUND 2 (only when inference mode + agent calls cello_request_more_disclosure):
 *
 * TARGET calls cello_request_more_disclosure({ connection_request_id, requested_items[] }):
 *   Verify Round 1 (not already Round 2) → else { error: 'max_rounds_reached' }
 *   Send disclosure_request { connection_request_id, requested_items[] } to directory.
 *   Directory relays as disclosure_request_inbound { from_pubkey, connection_request_id,
 *     requested_items[] } to sender's stream.
 *   Start 2-minute Round 2 silence timer (round2TimeoutMs).
 *
 * SENDER receives disclosure_request_inbound:
 *   Fire onDisclosureRequested.
 *   cello_request_connection returns { result: 'disclosure_requested', connection_request_id,
 *     requested_items[] } — UNBLOCKS sender.
 *
 * SENDER calls cello_respond_to_disclosure_request({ connection_request_id, ... }):
 *   Construct package_v2, send disclosure_response { connection_request_id, package_cbor }.
 *   Directory relays as disclosure_response_inbound { connection_request_id, package_cbor }.
 *
 * TARGET receives disclosure_response_inbound:
 *   Validate package_v2, re-run evaluateConnectionPackage().
 *   Queue updated ConnectionReport; return via cello_await_connection_request.
 *   Agent may only call cello_accept_connection or cello_reject_connection now.
 *   If agent attempts cello_request_more_disclosure on Round 2 → { error: 'max_rounds_reached' }.
 *
 * ROUND 2 SILENCE TIMEOUT (2-minute timer at target):
 *   Target sends connection_response { verdict: 'reject', reason: 'disclosure_timeout' }.
 *   Directory relays connection_rejected { reason: 'disclosure_timeout' } to sender.
 *   cello_request_connection returns { result: 'rejected', reason: 'disclosure_timeout' }.
 *
 * 5-MINUTE OVERALL TIMEOUT (at sender):
 *   If no final response arrives within connectionTimeoutMs (default 300_000ms),
 *   cello_request_connection returns { result: 'timeout' }.
 *
 * SESSION-006 — session_request connection gate:
 *   client.initiateSession() checks local #connections map first.
 *   If no connection → return { error: { reason: 'no_connection', target_pubkey } }.
 *   session_request frame gains required connection_id field.
 *   Directory verifies connection_id matches active connection between initiator + target.
 *   Reject with no_connection or connection_id_required before any FROST ceremony.
 *
 * Crypto refs:
 *   ML-DSA-44 package signatures: NIST FIPS 204
 *   SHA-256 for connection_id entropy mix (if needed): FIPS 180-4
 *   FROST threshold signing: RFC 9591
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ─── Direction: client A → directory ─────────────────────────────────────────

/**
 * Sent by the initiator on its authenticated signaling stream.
 * package_cbor is the CBOR-encoded ConnectionPackage (CONNREQ-001).
 * The directory does NOT inspect package_cbor — it is opaque (ML-DSA signed by sender).
 */
export interface ConnectionRequest {
  type: "connection_request";
  /** Hex-encoded 32-byte K_local pubkey of the desired target */
  target_pubkey: string;
  /** CBOR-encoded ConnectionPackage bytes (opaque to directory) */
  package_cbor: Uint8Array;
}

// ─── Direction: directory → target client ─────────────────────────────────────

/**
 * Relayed by the directory to the target's signaling stream.
 * Augmented with sender's directory context fields.
 */
export interface ConnectionRequestInbound {
  type: "connection_request_inbound";
  /** Hex-encoded 32-byte K_local pubkey of the sender */
  from_pubkey: string;
  /** Connection request ID (directory-assigned, 16-byte hex) for Round 2 correlation */
  connection_request_id: string;
  /** CBOR-encoded ConnectionPackage (opaque relay — cannot be modified by directory) */
  package_cbor: Uint8Array;
  /** Unix ms timestamp when sender registered (from directory profile) */
  sender_registered_at: number;
  /** Whether sender's profile is provisional */
  sender_is_provisional: boolean;
}

// ─── Direction: target client → directory ─────────────────────────────────────

/** Verdict variants for the target client's response */
export type ConnectionResponseVerdict =
  | { verdict: "accept" }
  | { verdict: "reject"; reason: string }
  | { verdict: "insufficient"; unmet_requirements: unknown[] };

export interface ConnectionResponse {
  type: "connection_response";
  /** Connection request ID assigned by directory at relay time */
  connection_request_id: string;
  verdict: "accept" | "reject" | "insufficient";
  /** Present when verdict === 'reject' */
  reason?: string;
  /** Present when verdict === 'insufficient' */
  unmet_requirements?: unknown[];
}

// ─── Direction: directory → both clients ──────────────────────────────────────

/**
 * Delivered to both A and B after directory creates the connection record.
 * counterparty_pubkey is the other side's K_local (A receives B's, B receives A's).
 */
export interface ConnectionEstablished {
  type: "connection_established";
  /** Hex-encoded counterparty K_local pubkey */
  counterparty_pubkey: string;
  /** Hex-encoded 16-byte CSPRNG connection ID */
  connection_id: string;
}

// ─── Direction: directory → sender client ─────────────────────────────────────

export interface ConnectionRejected {
  type: "connection_rejected";
  /** Hex-encoded 32-byte target K_local pubkey */
  target_pubkey: string;
  reason: string;
}

export interface ConnectionInsufficient {
  type: "connection_insufficient";
  /** Hex-encoded 32-byte target K_local pubkey */
  target_pubkey: string;
  unmet_requirements: unknown[];
}

export interface ConnectionRequestError {
  type: "connection_request_error";
  reason: ConnectionRequestErrorReason;
  /** Only set when reason === "already_connected" — the existing connection_id so the client can hydrate and proceed immediately */
  connection_id?: string;
}

export type ConnectionRequestErrorReason =
  | "not_registered"        // sender has not completed registration
  | "target_not_found"      // no active profile for target_pubkey
  | "already_connected"     // active connection already exists between A and B
  | "target_unavailable";   // target offline and queue full (DB-001)

// ─── ROUND 2 frames ───────────────────────────────────────────────────────────

/**
 * Target → directory: initiate Round 2 disclosure request.
 */
export interface DisclosureRequest {
  type: "disclosure_request";
  connection_request_id: string;
  requested_items: DisclosureRequestItem[];
}

export interface DisclosureRequestItem {
  type: "endorsement" | "attestation";
  /** For endorsement: minimum count required */
  min_count?: number;
  /** For attestation: attestation type string */
  attestation_type?: string;
}

/**
 * Directory → sender: relayed disclosure request.
 */
export interface DisclosureRequestInbound {
  type: "disclosure_request_inbound";
  /** Hex-encoded target K_local pubkey */
  from_pubkey: string;
  connection_request_id: string;
  requested_items: DisclosureRequestItem[];
}

/**
 * Sender → directory: provide additional package items (or empty to decline).
 */
export interface DisclosureResponse {
  type: "disclosure_response";
  connection_request_id: string;
  /** CBOR-encoded updated ConnectionPackage (package_v2) */
  package_cbor: Uint8Array;
}

/**
 * Directory → target: relayed disclosure response.
 */
export interface DisclosureResponseInbound {
  type: "disclosure_response_inbound";
  connection_request_id: string;
  /** CBOR-encoded updated ConnectionPackage (package_v2) */
  package_cbor: Uint8Array;
}

// ─── DirectoryStore additions (CONNREQ-002) ───────────────────────────────────

/**
 * Connection record stored in the directory.
 * Indexed by both participants' pubkeys and by connection_id.
 */
export interface ConnectionRecord {
  /** Hex-encoded 16-byte CSPRNG connection ID */
  connection_id: string;
  /** Hex-encoded K_local pubkey of participant A */
  participant_a: string;
  /** Hex-encoded K_local pubkey of participant B */
  participant_b: string;
  /** Unix ms timestamp when the connection was established */
  established_at: number;
  status: "active";
}

/**
 * Pending connection request queued for an offline target.
 */
export interface PendingConnectionRequest {
  /** Connection request ID (directory-assigned) */
  connection_request_id: string;
  /** Hex-encoded sender K_local pubkey */
  sender_pubkey: string;
  /** The inbound frame to deliver when target reconnects */
  frame: ConnectionRequestInbound;
  /** Unix ms timestamp when queued (oldest = first to drop) */
  queued_at: number;
}

// ─── SESSION-006: session_request connection gate ────────────────────────────

/**
 * CLIENT-SIDE connection record (CONNREQ-002).
 * Cached so future session establishments can use the connection_id without re-querying.
 */
export interface ClientConnectionRecord {
  /** Hex-encoded 16-byte CSPRNG connection ID */
  connection_id: string;
  /** Hex-encoded counterparty K_local pubkey */
  counterparty_pubkey: string;
  /** Hex-encoded counterparty FROST primary_pubkey (from the connection exchange) */
  counterparty_primary_pubkey: string;
  /** Hex-encoded counterparty ML-DSA public key (from the connection package) */
  counterparty_ml_dsa_pubkey: string;
  /** Unix ms timestamp when established */
  established_at: number;
  status: "active";
  /** True when directory was unreachable during ml_dsa_pubkey cross-check */
  profile_unchecked?: boolean;
}

// ─── SESSION-006: updated session_request ────────────────────────────────────

/**
 * M3 session_request wire type — gains required connection_id field.
 * Defined here so protocol-types owns the canonical wire schema.
 */
export interface SessionRequestM3 {
  type: "session_request";
  /** Hex-encoded 32-byte K_local pubkey of the desired counterparty */
  target_pubkey: Uint8Array;
  /** Hex-encoded 16-byte connection ID — REQUIRED in M3 */
  connection_id: string;
}

// ─── SESSION-006 error reasons ────────────────────────────────────────────────

export type SessionRequestM3ErrorReason =
  | "no_connection"           // no active connection between initiator and target
  | "connection_id_required"; // session_request missing connection_id field (M2 legacy frame)
