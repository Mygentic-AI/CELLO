/**
 * CELLO Directory — frame CBOR codec (NODE-001)
 *
 * Encoding: canonical CBOR per RFC 8949 §4.2.1
 * Framing: it-length-prefixed on top of the libp2p stream (handled by caller)
 */

import { Encoder, decode } from "cbor-x";
import type {
  SignalingAuthChallenge,
  SignalingAuthResponse,
  SignalingAuthFailed,
  SignalingAuthOk,
  SessionRequest,
  SessionAssignment,
  SessionAssignmentFrame,
  SessionAbandoned,
  SessionSealedSingle,
  SessionSealedFrost,
  SessionSealed,
  SessionSealedWithLegibility,
  SessionSealRejected,
  SessionRequestError,
  NotAuthenticated,
  SealVerified,
  SealFrostSignature,
  SessionFrostSealed,
  PeerInfoAnnounce,
  ManifestPollResponse,
  SessionOfferAccept,
  SessionOfferReject,
  RevokeAgentRequest,
  AgentRevocationAck,
  AgentRevocationError,
  TrustSignalPickup,
  TrustSignalAck,
  DiscoveryLookup,
  DiscoveryLookupResult,
  DiscoveryLookupError,
} from "./directory-types.js";

const ENC = new Encoder({ tagUint8Array: false });

// ─── Encode (directory → client) ─────────────────────────────────────────────

export function encodeSignalingAuthChallenge(frame: SignalingAuthChallenge): Uint8Array {
  return ENC.encode({ type: frame.type, nonce: frame.nonce });
}

export function encodeSignalingAuthFailed(frame: SignalingAuthFailed): Uint8Array {
  return ENC.encode({ type: frame.type, reason: frame.reason });
}

// CELLO-M7-REMOVE-001 (DOD-REMOVE-2): revocation reply encoders.
export function encodeAgentRevocationAck(frame: AgentRevocationAck): Uint8Array {
  return ENC.encode({ type: frame.type, agent_id: frame.agent_id });
}

export function encodeAgentRevocationError(frame: AgentRevocationError): Uint8Array {
  return ENC.encode({ type: frame.type, reason: frame.reason, agent_id: frame.agent_id });
}

/**
 * M7-MANIFEST-002: encode signaling_auth_ok with optional step-5 fields.
 *
 * Pre-MANIFEST-002 directories omit nodeId/signature/timestamp — the frame
 * remains a bare `{type: "signaling_auth_ok"}` for backward compatibility.
 * MANIFEST-002 directories include all three fields so the client can verify
 * the directory's identity against the consortium manifest (step 6).
 */
export function encodeSignalingAuthOk(frame: SignalingAuthOk): Uint8Array {
  const obj: Record<string, unknown> = { type: "signaling_auth_ok" };
  if (frame.nodeId !== undefined) obj["nodeId"] = frame.nodeId;
  if (frame.signature !== undefined) obj["signature"] = frame.signature;
  if (frame.timestamp !== undefined) obj["timestamp"] = frame.timestamp;
  return ENC.encode(obj);
}

// ─── M7-DIR-PING-001: Pong frame encoder (directory → client) ────────────────

/** Encode a pong frame: { type: "pong", ts: number }. Echoes back the client's ts value. */
export function encodePong(ts: number): Uint8Array {
  return ENC.encode({ type: "pong", ts });
}

// ─── M7-MANIFEST-002: Manifest poll frame encoders (directory → client) ──────

/** Encode a manifest_poll_response frame from directory → client. */
export function encodeManifestPollResponse(frame: ManifestPollResponse): Uint8Array {
  return ENC.encode({ type: "manifest_poll_response", manifest: frame.manifest });
}

// ─── Cross-node discovery lookup (item 1): directory → client responses ───────

/** Encode discovery_lookup_result. owning_node_ids is non-empty only when state = "online". */
export function encodeDiscoveryLookupResult(frame: DiscoveryLookupResult): Uint8Array {
  return ENC.encode({
    type: "discovery_lookup_result",
    target_pubkey: frame.target_pubkey,
    state: frame.state,
    owning_node_ids: frame.owning_node_ids,
  });
}

/**
 * Encode discovery_lookup_error — returned on a DB error during the lookup. NEVER a fabricated
 * `offline`/`unknown_agent` (those are authoritative answers), and the caller must NOT abort the
 * stream (it is the agent's home inbound). The client treats this as retryable, same as target_offline.
 */
export function encodeDiscoveryLookupError(frame: DiscoveryLookupError): Uint8Array {
  return ENC.encode({ type: "discovery_lookup_error", reason: frame.reason });
}

export function encodeSessionAssignment(frame: SessionAssignmentFrame): Uint8Array {
  const a = frame.assignment;
  // Build the encoded assignment object. Include signature_type always.
  // signer_pubkey is only present for 'frost' assignments (discriminated union).
  const encodedAssignment: Record<string, unknown> = {
    session_id: a.session_id,
    participant_a: {
      pubkey: a.participant_a.pubkey,
      peer_id: a.participant_a.peer_id,
      multiaddrs: a.participant_a.multiaddrs,
    },
    participant_b: {
      pubkey: a.participant_b.pubkey,
      peer_id: a.participant_b.peer_id,
      multiaddrs: a.participant_b.multiaddrs,
    },
    relay_endpoint: {
      peer_id: a.relay_endpoint.peer_id,
      multiaddrs: a.relay_endpoint.multiaddrs,
    },
    directory_endpoint: {
      peer_id: a.directory_endpoint.peer_id,
      multiaddrs: a.directory_endpoint.multiaddrs,
    },
    session_timestamp: a.session_timestamp,
    directory_pubkey: a.directory_pubkey,
    directory_signature: a.directory_signature,
    signature_type: a.signature_type,
  };
  if (a.signature_type === "frost") {
    encodedAssignment["signer_pubkey"] = a.signer_pubkey;
  }
  // M7-WIRE-001: encode session Peer ID fields — now typed on SessionAssignmentCommon
  if (a.initiator_session_peer_id) {
    encodedAssignment["initiator_session_peer_id"] = a.initiator_session_peer_id;
  }
  if (a.initiator_session_addrs && a.initiator_session_addrs.length > 0) {
    encodedAssignment["initiator_session_addrs"] = a.initiator_session_addrs;
  }
  if (a.counterparty_session_peer_id) {
    encodedAssignment["counterparty_session_peer_id"] = a.counterparty_session_peer_id;
  }
  if (a.counterparty_session_addrs && a.counterparty_session_addrs.length > 0) {
    encodedAssignment["counterparty_session_addrs"] = a.counterparty_session_addrs;
  }
  // Only encode transport_mode when both peer IDs are present (10-field TBS covers it).
  // When counterparty is absent (5-field TBS), transport_mode is not signed and must
  // not appear on the wire — otherwise a MITM could modify it without breaking verification.
  if (a.transport_mode && a.initiator_session_peer_id && a.counterparty_session_peer_id) {
    encodedAssignment["transport_mode"] = a.transport_mode;
  }
  // FED-OPTIONB-SETUP-001 (Option B): the per-node directory signature over the relay TBS. Present only
  // for relay-mode sessions (the directory sets it alongside the relay block). The CLIENT carries it to
  // its chosen relay (client_record_assignment), replacing the directory→relay dial. Cast because the
  // pinned @cello-protocol/protocol-types type may not yet declare the field (added in the DEPLOY-1 bump).
  const relayDirSig = (a as { relay_directory_signature?: Uint8Array }).relay_directory_signature;
  if (relayDirSig) {
    encodedAssignment["relay_directory_signature"] = relayDirSig;
  }
  // MONIKER-2 AC1b: the initiator's outbound name, UNSIGNED pass-through (outside every TBS —
  // no integrity claim, spec §2). Omitted when absent — never an empty string on the wire.
  if (a.moniker) {
    encodedAssignment["moniker"] = a.moniker;
  }
  return ENC.encode({ type: frame.type, assignment: encodedAssignment });
}

export function encodeSessionAbandoned(frame: SessionAbandoned): Uint8Array {
  return ENC.encode({ type: frame.type, session_id: frame.session_id });
}

export function encodeSessionSealed(frame: SessionSealedWithLegibility): Uint8Array {
  // M7-SESSION-004: the receipt-not-assent legibility certificate, when present,
  // is carried verbatim on the frame (canonical CBOR per RFC 8949 §4.2.1).
  const legibility = frame.legibility;
  if (frame.signature_type === "frost") {
    const encoded: Record<string, unknown> = {
      type: frame.type,
      signature_type: "frost",
      session_id: frame.session_id,
      sealed_root: frame.sealed_root,
      frost_signature: frame.frost_signature,
      signer_pubkey: frame.signer_pubkey,
      close_timestamp: frame.close_timestamp > 0xffffffff
        ? BigInt(frame.close_timestamp)
        : frame.close_timestamp,
    };
    if (frame.leaf_count !== undefined) {
      encoded["leaf_count"] = frame.leaf_count;
    }
    if (legibility !== undefined) encoded["legibility"] = legibility;
    // DOD-LEG-2 (SI-002): carry the signed leaves so the client can independently re-derive
    // + verify each party's content_frontier_seq (reject an inflated published frontier).
    if (frame.frontier_leaves !== undefined) encoded["frontier_leaves"] = frame.frontier_leaves;
    return ENC.encode(encoded);
  }
  // signature_type === "single" (deprecated M1 format)
  const f = frame as SessionSealedSingle;
  const encodedSingle: Record<string, unknown> = {
    type: f.type,
    signature_type: "single",
    session_id: f.session_id,
    sealed_root: f.sealed_root,
    directory_signature: f.directory_signature,
    close_timestamp: f.close_timestamp > 0xffffffff
      ? BigInt(f.close_timestamp)
      : f.close_timestamp,
  };
  if (legibility !== undefined) encodedSingle["legibility"] = legibility;
  return ENC.encode(encodedSingle);
}

export function encodeSealVerified(frame: SealVerified & { legibility?: import("./directory-types.js").SealLegibility; frontier_leaves?: import("./directory-types.js").SealFrontierLeaf[] }): Uint8Array {
  const encoded: Record<string, unknown> = {
    type: frame.type,
    session_id: frame.session_id,
    sealed_root: frame.sealed_root,
    leaf_count: frame.leaf_count,
    timestamp: frame.timestamp > 0xffffffff
      ? BigInt(frame.timestamp)
      : frame.timestamp,
  };
  // M7 legibility-TBS-binding: carry the legibility (bilateral seal only) so the initiator's
  // daemon binds the SAME hash into its co-signed TBS. The daemon decodes inbound frames generically
  // (cbor-x), so the nested object round-trips without a typed-decoder change.
  if (frame.legibility !== undefined) encoded["legibility"] = frame.legibility;
  // DOD-LEG-2: the signed leaves, so the initiator re-derives + refuses to co-sign an inflated frontier.
  if (frame.frontier_leaves !== undefined) encoded["frontier_leaves"] = frame.frontier_leaves;
  return ENC.encode(encoded);
}

export function encodeSessionFrostSealed(frame: SessionFrostSealed): Uint8Array {
  // M7-SESSION-004 (review finding #3): carry the legibility certificate verbatim when
  // present, so a deferred seal completion ends with the same receipt-not-assent
  // legibility as a live push (canonical CBOR per RFC 8949 §4.2.1).
  const encoded: Record<string, unknown> = {
    type: frame.type,
    session_id: frame.session_id,
    sealed_root: frame.sealed_root,
    frost_signature: frame.frost_signature,
    signer_pubkey: frame.signer_pubkey,
  };
  if (frame.legibility !== undefined) encoded["legibility"] = frame.legibility;
  return ENC.encode(encoded);
}


export function encodeSessionSealRejected(frame: SessionSealRejected): Uint8Array {
  return ENC.encode({ type: frame.type, session_id: frame.session_id, reason: frame.reason });
}

export function encodeSessionRequestError(frame: SessionRequestError): Uint8Array {
  return ENC.encode({ type: frame.type, reason: frame.reason });
}

export function encodeNotAuthenticated(frame: NotAuthenticated): Uint8Array {
  return ENC.encode({ type: frame.type });
}

// ─── REG-001: Registration frame encoders ────────────────────────────────────

import type { RegisterSuccess, RegisterError, DkgReady } from "@cello-protocol/protocol-types";

export function encodeRegisterSuccess(frame: RegisterSuccess): Uint8Array {
  return ENC.encode({ type: frame.type, agent_id: frame.agent_id, primary_pubkey: frame.primary_pubkey });
}

export function encodeRegisterError(frame: RegisterError): Uint8Array {
  const obj: Record<string, unknown> = { type: frame.type, reason: frame.reason };
  if (frame.agent_id !== undefined) obj["agent_id"] = frame.agent_id;
  if (frame.primary_pubkey !== undefined) obj["primary_pubkey"] = frame.primary_pubkey;
  if (frame.ml_dsa_pubkey !== undefined) obj["ml_dsa_pubkey"] = frame.ml_dsa_pubkey;
  return ENC.encode(obj);
}

export function encodeDkgReady(frame: DkgReady): Uint8Array {
  return ENC.encode({ type: frame.type, epochId: frame.epochId, participants: frame.participants, threshold: frame.threshold });
}

// ─── M8C-PRIMARY-1: Primary/Standby transfer frame encoders ──────────────────

import type { PrimaryTransferAck, PrimaryTransferError } from "@cello-protocol/protocol-types";

export function encodePrimaryTransferAck(frame: PrimaryTransferAck): Uint8Array {
  return ENC.encode({ type: frame.type, node_id: frame.node_id });
}

export function encodePrimaryTransferError(frame: PrimaryTransferError): Uint8Array {
  return ENC.encode({ type: frame.type, reason: frame.reason });
}

// ─── CONNREQ-002: Connection frame encoders (directory → client) ──────────────

import type {
  ConnectionEstablished,
  ConnectionRejected,
  ConnectionInsufficient,
  ConnectionRequestError,
  ConnectionRequestInbound,
  DisclosureRequestInbound,
  DisclosureResponseInbound,
} from "@cello-protocol/protocol-types";

export function encodeConnectionRequestError(frame: ConnectionRequestError): Uint8Array {
  const obj: Record<string, unknown> = { type: frame.type, reason: frame.reason };
  if (frame.connection_id !== undefined) obj["connection_id"] = frame.connection_id;
  return ENC.encode(obj);
}

export function encodeConnectionRequestInbound(frame: ConnectionRequestInbound): Uint8Array {
  return ENC.encode({
    type: frame.type,
    from_pubkey: frame.from_pubkey,
    connection_request_id: frame.connection_request_id,
    package_cbor: frame.package_cbor,
    sender_registered_at: frame.sender_registered_at,
    sender_is_provisional: frame.sender_is_provisional,
  });
}

export function encodeConnectionEstablished(frame: ConnectionEstablished): Uint8Array {
  return ENC.encode({ type: frame.type, counterparty_pubkey: frame.counterparty_pubkey, connection_id: frame.connection_id });
}

export function encodeConnectionRejected(frame: ConnectionRejected): Uint8Array {
  return ENC.encode({ type: frame.type, target_pubkey: frame.target_pubkey, reason: frame.reason });
}

export function encodeConnectionInsufficient(frame: ConnectionInsufficient): Uint8Array {
  return ENC.encode({ type: frame.type, target_pubkey: frame.target_pubkey, unmet_requirements: frame.unmet_requirements });
}

export function encodeDisclosureRequestInbound(frame: DisclosureRequestInbound): Uint8Array {
  return ENC.encode({
    type: frame.type,
    from_pubkey: frame.from_pubkey,
    connection_request_id: frame.connection_request_id,
    requested_items: frame.requested_items,
  });
}

export function encodeDisclosureResponseInbound(frame: DisclosureResponseInbound): Uint8Array {
  return ENC.encode({
    type: frame.type,
    connection_request_id: frame.connection_request_id,
    package_cbor: frame.package_cbor,
  });
}

// ─── Decode (client → directory) ─────────────────────────────────────────────

import type { RegisterRequest, DkgComplete, ConnectionRequest, ConnectionResponse, DisclosureRequest, DisclosureResponse, PrimaryTransferRequest } from "@cello-protocol/protocol-types";

import type { SealAttempt, SealRejectedTreeMismatch, SealAttemptAck, SealUnilateral, SealUnilateralTooEarly, SealUnilateralConfirmed, SealUnilateralNotification, ManifestPollRequest, SealUpgradeRequest, SealUpgradeConfirmed, SealUpgradeRejected } from "./directory-types.js";

/** M7-DIR-PING-001: client heartbeat frame. */
export type PingFrame = { type: "ping"; ts: number };
export type PongFrame = { type: "pong"; ts: number };

/** M7-SESSION-001 AC-009: seal-interrupted signaling frame types (pass-through routing). */
export type SealInterruptedRequestFrame = { type: "seal_interrupted_request"; sessionId: string; initiatorPubkey: string; counterpartyPubkey: string; leafCountAtInterruption: number; nonce: string };
/** initiatorPubkey is included so the directory can route the ack back to the initiator by direct lookup in #streams. */
export type SealInterruptedAckFrame = { type: "seal_interrupted_ack"; sessionId: string; initiatorPubkey: string; sealInterruptedLeaf: Record<string, unknown>; nonce: string };
/** initiatorPubkey is included so the directory can route the rejection back to the initiator by direct lookup in #streams. */
export type SealInterruptedRejectionFrame = { type: "seal_interrupted_rejection"; sessionId: string; initiatorPubkey: string; reason: string };

export type InboundSignalingFrame = SignalingAuthResponse | SessionRequest | SealFrostSignature | PeerInfoAnnounce | RegisterRequest | DkgComplete | ConnectionRequest | ConnectionResponse | DisclosureRequest | DisclosureResponse | SealAttempt | SealUnilateral | SealUpgradeRequest | ManifestPollRequest | PingFrame | SessionOfferAccept | SessionOfferReject | SealInterruptedRequestFrame | SealInterruptedAckFrame | SealInterruptedRejectionFrame | RevokeAgentRequest | TrustSignalAck | DiscoveryLookup | PrimaryTransferRequest;

/**
 * CELLO-M8-TRUST-001: encode a trust-signal pickup for delivery to the agent's daemon (OUTBOUND).
 * Carries the opaque sealed ciphertext + the authoritative identity-tree hash (the daemon's
 * verification anchor) + the ACK handle. Canonical CBOR.
 */
export function encodeTrustSignalPickup(frame: TrustSignalPickup): Uint8Array {
  return ENC.encode({
    type: "trust_signal_pickup",
    id: frame.id,
    signal_kind: frame.signal_kind,
    signal_hash: frame.signal_hash,
    ciphertext: frame.ciphertext,
  });
}

function toUint8Array(v: unknown): Uint8Array | null {
  if (v instanceof Uint8Array) return v;
  if (Buffer.isBuffer(v)) return new Uint8Array(v as Buffer);
  return null;
}

function toStringArray(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  if (!v.every((x) => typeof x === "string")) return null;
  return v as string[];
}

/** Decode a raw CBOR frame from a client signaling stream. Returns null on malformed input. */
export function decodeInboundSignalingFrame(bytes: Uint8Array): InboundSignalingFrame | null {
  let obj: unknown;
  try {
    obj = decode(bytes);
  } catch {
    return null;
  }
  if (typeof obj !== "object" || obj === null) return null;
  const o = obj as Record<string, unknown>;

  if (o["type"] === "signaling_auth_response") {
    const pubkey = toUint8Array(o["pubkey"]);
    const signature = toUint8Array(o["signature"]);
    if (!pubkey || pubkey.length !== 32) return null;
    if (!signature || signature.length !== 64) return null;
    // Cross-node item 3: carry the optional visiting flag through the typed allowlist. Only literal
    // `true` counts; absent / false ⇒ a normal home connection (backward compatible with old clients).
    const visiting = o["visiting"] === true ? true : undefined;
    return { type: "signaling_auth_response", pubkey, signature, ...(visiting ? { visiting } : {}) };
  }

  if (o["type"] === "discovery_lookup") {
    const target_pubkey = toUint8Array(o["target_pubkey"]);
    if (!target_pubkey || target_pubkey.length !== 32) return null;
    return { type: "discovery_lookup", target_pubkey };
  }

  if (o["type"] === "session_request") {
    const target_pubkey = toUint8Array(o["target_pubkey"]);
    if (!target_pubkey || target_pubkey.length !== 32) return null;
    // CONNREQ-002/SESSION-006: optional connection_id field (M3 adds it; M2 omits it)
    const connection_id = typeof o["connection_id"] === "string" ? o["connection_id"] : undefined;
    // M7-WIRE-001 AC-001/AC-002: initiator session Peer ID and addrs (optional at parse level; handler validates)
    const initiator_session_peer_id = typeof o["initiator_session_peer_id"] === "string" ? o["initiator_session_peer_id"] : undefined;
    const initiator_session_addrs = toStringArray(o["initiator_session_addrs"]) ?? undefined;
    const transport_mode_raw = o["transport_mode"];
    const transport_mode: "direct" | "relay" | undefined =
      transport_mode_raw === "direct" ? "direct" : transport_mode_raw === "relay" ? "relay" : undefined;
    // M7-WIRE-002: opt-in flag for the session_offer→accept round-trip. Must be
    // carried through this typed allowlist decoder or the directory's offer branch
    // (which reads parsedReq.wants_session_offer) never fires.
    const wants_session_offer = o["wants_session_offer"] === true ? true : undefined;
    // MONIKER-2 AC1b: bounded pass-through (string, 1–64 chars). The directory does NOT judge the
    // charset — the receiver is the validation authority; junk is merely size-bounded here.
    const moniker =
      typeof o["moniker"] === "string" && o["moniker"].length >= 1 && o["moniker"].length <= 64
        ? o["moniker"]
        : undefined;
    const result: SessionRequest = { type: "session_request", target_pubkey };
    if (connection_id !== undefined) result.connection_id = connection_id;
    if (initiator_session_peer_id !== undefined) result.initiator_session_peer_id = initiator_session_peer_id;
    if (initiator_session_addrs !== undefined) result.initiator_session_addrs = initiator_session_addrs;
    if (transport_mode !== undefined) result.transport_mode = transport_mode;
    if (wants_session_offer !== undefined) result.wants_session_offer = wants_session_offer;
    if (moniker !== undefined) result.moniker = moniker;
    return result;
  }

  if (o["type"] === "connection_request") {
    const target_pubkey = typeof o["target_pubkey"] === "string" ? o["target_pubkey"] : null;
    const package_cbor = toUint8Array(o["package_cbor"]);
    if (!target_pubkey) return null;
    if (!package_cbor) return null;
    return { type: "connection_request", target_pubkey, package_cbor };
  }

  if (o["type"] === "connection_response") {
    const connection_request_id = typeof o["connection_request_id"] === "string" ? o["connection_request_id"] : null;
    const verdict = o["verdict"];
    if (!connection_request_id) return null;
    if (verdict !== "accept" && verdict !== "reject" && verdict !== "insufficient") return null;
    const reason = typeof o["reason"] === "string" ? o["reason"] : undefined;
    const unmet_requirements = Array.isArray(o["unmet_requirements"]) ? o["unmet_requirements"] : undefined;
    return { type: "connection_response", connection_request_id, verdict, reason, unmet_requirements };
  }

  if (o["type"] === "disclosure_request") {
    const connection_request_id = typeof o["connection_request_id"] === "string" ? o["connection_request_id"] : null;
    if (!connection_request_id) return null;
    const requested_items = Array.isArray(o["requested_items"]) ? o["requested_items"] : [];
    return { type: "disclosure_request", connection_request_id, requested_items };
  }

  if (o["type"] === "disclosure_response") {
    const connection_request_id = typeof o["connection_request_id"] === "string" ? o["connection_request_id"] : null;
    const package_cbor = toUint8Array(o["package_cbor"]);
    if (!connection_request_id) return null;
    if (!package_cbor) return null;
    return { type: "disclosure_response", connection_request_id, package_cbor };
  }

  if (o["type"] === "seal_frost_signature") {
    const session_id = toUint8Array(o["session_id"]);
    const frost_signature = toUint8Array(o["frost_signature"]);
    if (!session_id || session_id.length !== 16) return null;
    if (!frost_signature || frost_signature.length !== 64) return null;
    return { type: "seal_frost_signature", session_id, frost_signature };
  }

  if (o["type"] === "peer_info_announce") {
    const peer_id = typeof o["peer_id"] === "string" ? o["peer_id"] : null;
    const multiaddrs = toStringArray(o["multiaddrs"]);
    if (!peer_id) return null;
    if (!multiaddrs) return null;
    return { type: "peer_info_announce", peer_id, multiaddrs };
  }

  if (o["type"] === "register_request") {
    const phone_stub = typeof o["phone_stub"] === "string" ? o["phone_stub"] : null;
    const k_local_pubkey = typeof o["k_local_pubkey"] === "string" ? o["k_local_pubkey"] : null;
    const ml_dsa_pubkey = typeof o["ml_dsa_pubkey"] === "string" ? o["ml_dsa_pubkey"] : null;
    if (phone_stub === null || k_local_pubkey === null || ml_dsa_pubkey === null) return null;
    // M8B quorum: this typed allowlist decoder drops any field it doesn't explicitly reconstruct, so
    // the client's reachable nodeIds (R) must be carried through here or #processRegisterRequest's
    // pick-Q logic never sees it (and falls back to all-N, refusing when any node is down).
    const reachable_node_ids = toStringArray(o["reachable_node_ids"]);
    const frame = { type: "register_request", phone_stub, k_local_pubkey, ml_dsa_pubkey } as Record<string, unknown>;
    if (reachable_node_ids) frame["reachable_node_ids"] = reachable_node_ids;
    return frame as unknown as InboundSignalingFrame;
  }

  if (o["type"] === "dkg_complete") {
    const primary_pubkey = typeof o["primary_pubkey"] === "string" ? o["primary_pubkey"] : null;
    if (primary_pubkey === null) return null;
    return { type: "dkg_complete" as const, primary_pubkey };
  }

  if (o["type"] === "primary_transfer_request") {
    // M8C-PRIMARY-1: per docs/planning/user-stories/m8c/M8C-PRIMARY-DESIGN.md Decision 4/3.
    const k_local_pubkey = typeof o["k_local_pubkey"] === "string" ? o["k_local_pubkey"] : null;
    const new_daemon_id = typeof o["new_daemon_id"] === "string" ? o["new_daemon_id"] : null;
    const old_daemon_id = typeof o["old_daemon_id"] === "string" ? o["old_daemon_id"] : null;
    const release_signature = typeof o["release_signature"] === "string" ? o["release_signature"] : null;
    const nonce = typeof o["nonce"] === "string" ? o["nonce"] : null;
    const timestamp = typeof o["timestamp"] === "number" ? o["timestamp"] : null;
    if (k_local_pubkey === null || new_daemon_id === null || old_daemon_id === null || release_signature === null || nonce === null || timestamp === null) return null;
    return { type: "primary_transfer_request" as const, k_local_pubkey, new_daemon_id, old_daemon_id, release_signature, nonce, timestamp };
  }

  if (o["type"] === "revoke_agent") {
    // CELLO-M7-REMOVE-001 DOD-REMOVE-2: a self-signed agent revocation on the authed signaling stream.
    const agent_id = typeof o["agent_id"] === "string" ? o["agent_id"] : null;
    const signature = typeof o["signature"] === "string" ? o["signature"] : null;
    const revoked_at = typeof o["revoked_at"] === "number" ? o["revoked_at"] : null;
    if (agent_id === null || signature === null || revoked_at === null) return null;
    const epoch_id = typeof o["epoch_id"] === "string" ? o["epoch_id"] : undefined;
    const reason = typeof o["reason"] === "string" ? o["reason"] : undefined;
    return { type: "revoke_agent", agent_id, epoch_id, reason, revoked_at, signature };
  }

  if (o["type"] === "trust_signal_ack") {
    // CELLO-M8-TRUST-001: the daemon confirms it opened + verified + stored a pickup; the directory
    // then DELETEs that pickup_queue row. id-only — nothing sensitive on the wire.
    const id = typeof o["id"] === "string" ? o["id"] : null;
    if (id === null) return null;
    return { type: "trust_signal_ack", id };
  }

  if (o["type"] === "seal_attempt") {
    const session_id = toUint8Array(o["session_id"]);
    const reported_root = toUint8Array(o["reported_root"]);
    const reported_seq = typeof o["reported_seq"] === "number" ? o["reported_seq"] : null;
    if (!session_id || session_id.length !== 16) return null;
    if (!reported_root || reported_root.length !== 32) return null;
    if (reported_seq === null) return null;
    return { type: "seal_attempt", session_id, reported_root, reported_seq };
  }

  if (o["type"] === "seal_unilateral") {
    const session_id = toUint8Array(o["session_id"]);
    const reported_root = toUint8Array(o["reported_root"]);
    const reported_seq = typeof o["reported_seq"] === "number" ? o["reported_seq"] : null;
    if (!session_id || session_id.length !== 16) return null;
    if (!reported_root || reported_root.length !== 32) return null;
    if (reported_seq === null) return null;
    // FED-OPTIONB-SEAL-001: the carried leaf chain for the directory's offline rebuild. Shape-validate
    // strictly — a malformed entry voids the whole carry (the directory then refuses the seal), never
    // silently drops a leaf (a dropped leaf would be an undetected omission). relay_* are optional
    // (absent for the counterparty's leaves) but must be well-formed when present.
    let seal_leaves: import("./directory-types.js").SealUnilateralLeaf[] | undefined;
    const rawLeaves = o["seal_leaves"];
    if (rawLeaves !== undefined) {
      if (!Array.isArray(rawLeaves)) return null;
      const parsed: import("./directory-types.js").SealUnilateralLeaf[] = [];
      for (const raw of rawLeaves) {
        if (typeof raw !== "object" || raw === null) return null;
        const r = raw as Record<string, unknown>;
        const sequence_number = typeof r["sequence_number"] === "number" ? r["sequence_number"] : null;
        const leaf_kind = typeof r["leaf_kind"] === "number" ? r["leaf_kind"] : null;
        const structure2_cbor = toUint8Array(r["structure2_cbor"]);
        const structure1_cbor = toUint8Array(r["structure1_cbor"]);
        if (sequence_number === null || leaf_kind === null) return null;
        if (!structure2_cbor || structure2_cbor.length === 0) return null;
        if (!structure1_cbor || structure1_cbor.length === 0) return null;
        const relay_id = typeof r["relay_id"] === "string" ? r["relay_id"] : undefined;
        const relay_timestamp = typeof r["relay_timestamp"] === "number" ? r["relay_timestamp"] : undefined;
        const relay_signature = r["relay_signature"] !== undefined ? toUint8Array(r["relay_signature"]) ?? undefined : undefined;
        // If any relay_* field is present, ALL three must be present + well-formed (a partial receipt is
        // a malformed carry, not a counterparty leaf).
        const anyRelay = relay_id !== undefined || relay_timestamp !== undefined || relay_signature !== undefined;
        if (anyRelay) {
          if (!relay_id || relay_timestamp === undefined || !relay_signature || relay_signature.length !== 64) return null;
        }
        parsed.push({ sequence_number, leaf_kind, structure2_cbor, structure1_cbor, relay_id, relay_timestamp, relay_signature });
      }
      seal_leaves = parsed;
    }
    return { type: "seal_unilateral", session_id, reported_root, reported_seq, seal_leaves };
  }

  // CELLO-M7-UPGRADE-001 (DOD-UP-1): returning absent party ratifies the unilateral seal.
  if (o["type"] === "seal_upgrade_request") {
    const session_id = toUint8Array(o["session_id"]);
    const returning_pubkey = toUint8Array(o["returning_pubkey"]);
    const ack_signature = toUint8Array(o["ack_signature"]);
    const leaf_count = typeof o["leaf_count"] === "number" ? o["leaf_count"] : null;
    if (!session_id || session_id.length !== 16) return null;
    if (!returning_pubkey || returning_pubkey.length !== 32) return null;
    if (!ack_signature || ack_signature.length !== 64) return null;
    if (leaf_count === null) return null;
    return { type: "seal_upgrade_request", session_id, returning_pubkey, ack_signature, leaf_count };
  }

  // M7-DIR-PING-001: heartbeat ping from client → directory
  if (o["type"] === "ping") {
    const tsRaw = o["ts"];
    const ts = typeof tsRaw === "number" ? tsRaw : typeof tsRaw === "bigint" ? Number(tsRaw) : null;
    if (ts === null || !Number.isFinite(ts)) return null;
    return { type: "ping", ts };
  }

  // M7-MANIFEST-002: manifest poll request from client → directory
  if (o["type"] === "manifest_poll_request") {
    return { type: "manifest_poll_request" };
  }

  // M7-WIRE-001 AC-003: session_offer_accept (target → directory)
  if (o["type"] === "session_offer_accept") {
    const session_id = toUint8Array(o["session_id"]);
    if (!session_id || session_id.length !== 16) return null;
    const counterparty_session_peer_id = typeof o["counterparty_session_peer_id"] === "string" ? o["counterparty_session_peer_id"] : null;
    const counterparty_session_addrs = toStringArray(o["counterparty_session_addrs"]);
    if (!counterparty_session_peer_id || !counterparty_session_addrs) return null;
    return { type: "session_offer_accept", session_id, counterparty_session_peer_id, counterparty_session_addrs };
  }

  // DOD-DIR-FAILCLOSED-1 (D2): session_offer_reject (target → directory) — the daemon-D1 answer
  // when the target cannot serve the offer. MUST live in this DECODER allowlist, not just the
  // dispatch chain: an unlisted type decodes to null and the directory replies not_authenticated,
  // so a dispatch-only branch would never fire (D1-review F2). session_id may be absent (the
  // daemon's no_session_id abort has nothing to echo) — decoded as null, logged, never dispatched
  // to a waiter.
  if (o["type"] === "session_offer_reject") {
    const session_id_raw = toUint8Array(o["session_id"]);
    const session_id = session_id_raw && session_id_raw.length === 16 ? session_id_raw : null;
    const reason = typeof o["reason"] === "string" && o["reason"].length >= 1 && o["reason"].length <= 128
      ? o["reason"]
      : "unspecified";
    return { type: "session_offer_reject", session_id, reason };
  }

  // M7-SESSION-001 AC-009: seal_interrupted signaling frames (pass-through routing)
  if (o["type"] === "seal_interrupted_request") {
    const sessionId = typeof o["sessionId"] === "string" ? o["sessionId"] : null;
    const initiatorPubkey = typeof o["initiatorPubkey"] === "string" ? o["initiatorPubkey"] : null;
    const counterpartyPubkey = typeof o["counterpartyPubkey"] === "string" ? o["counterpartyPubkey"] : null;
    const leafCountAtInterruption = typeof o["leafCountAtInterruption"] === "number" ? o["leafCountAtInterruption"] : null;
    const nonce = typeof o["nonce"] === "string" ? o["nonce"] : null;
    if (!sessionId || !initiatorPubkey || !counterpartyPubkey || leafCountAtInterruption === null || !nonce) return null;
    return { type: "seal_interrupted_request", sessionId, initiatorPubkey, counterpartyPubkey, leafCountAtInterruption, nonce };
  }

  if (o["type"] === "seal_interrupted_ack") {
    const sessionId = typeof o["sessionId"] === "string" ? o["sessionId"] : null;
    const initiatorPubkey = typeof o["initiatorPubkey"] === "string" ? o["initiatorPubkey"] : null;
    const sealInterruptedLeaf = typeof o["sealInterruptedLeaf"] === "object" && o["sealInterruptedLeaf"] !== null
      ? o["sealInterruptedLeaf"] as Record<string, unknown>
      : null;
    // The nonce is the initiator's L-2 replay guard: the ack MUST echo the request
    // nonce or the initiator rejects it as seal_interrupted_nonce_mismatch. The typed
    // relay decoder previously dropped it, breaking every bilateral seal-interrupted
    // (DOD-INT-2). Carry it through.
    const nonce = typeof o["nonce"] === "string" ? o["nonce"] : null;
    if (!sessionId || !initiatorPubkey || !sealInterruptedLeaf || nonce === null) return null;
    return { type: "seal_interrupted_ack", sessionId, initiatorPubkey, sealInterruptedLeaf, nonce };
  }

  if (o["type"] === "seal_interrupted_rejection") {
    const sessionId = typeof o["sessionId"] === "string" ? o["sessionId"] : null;
    const initiatorPubkey = typeof o["initiatorPubkey"] === "string" ? o["initiatorPubkey"] : null;
    const reason = typeof o["reason"] === "string" ? o["reason"] : null;
    if (!sessionId || !initiatorPubkey) return null;
    return { type: "seal_interrupted_rejection", sessionId, initiatorPubkey, reason: reason ?? "unknown" };
  }

  return null;
}

// ─── PERSIST-014: Seal attempt response encoders ─────────────────────────────

export function encodeSealRejectedTreeMismatch(frame: SealRejectedTreeMismatch): Uint8Array {
  return ENC.encode({
    type: frame.type,
    session_id: frame.session_id,
    party_a_sequence: frame.party_a_sequence,
    party_b_sequence: frame.party_b_sequence,
  });
}

export function encodeSealAttemptAck(frame: SealAttemptAck): Uint8Array {
  return ENC.encode({
    type: frame.type,
    session_id: frame.session_id,
  });
}

// ─── PERSIST-015: Unilateral seal response encoders ──────────────────────────

export function encodeSealUnilateralTooEarly(frame: SealUnilateralTooEarly): Uint8Array {
  return ENC.encode({
    type: frame.type,
    session_id: frame.session_id,
    remaining_seconds: frame.remaining_seconds,
  });
}

// ─── CELLO-M7-UPGRADE-001 (DOD-UP-1): seal upgrade response encoders ──────────

export function encodeSealUpgradeConfirmed(frame: SealUpgradeConfirmed): Uint8Array {
  return ENC.encode({
    type: frame.type,
    session_id: frame.session_id,
    sealed_root: frame.sealed_root,
    leaf_count: frame.leaf_count,
    close_timestamp: frame.close_timestamp,
    present_pubkey: frame.present_pubkey,
    present_signature: frame.present_signature,
    present_signature_type: frame.present_signature_type,
    returning_pubkey: frame.returning_pubkey,
    returning_signature: frame.returning_signature,
    seal_type: frame.seal_type,
  });
}

export function encodeSealUpgradeRejected(frame: SealUpgradeRejected): Uint8Array {
  return ENC.encode({
    type: frame.type,
    session_id: frame.session_id,
    reason: frame.reason,
  });
}

export function encodeSealUnilateralConfirmed(frame: SealUnilateralConfirmed): Uint8Array {
  const encoded: Record<string, unknown> = {
    type: frame.type,
    session_id: frame.session_id,
    sealed_root: frame.sealed_root,
    sealed_at: frame.sealed_at,
    // SESSION-002 certificate
    leaf_count: frame.leaf_count,
    close_timestamp: frame.close_timestamp,
    frost_signature: frame.frost_signature,
    signature_type: frame.signature_type,
    present_pubkey: frame.present_pubkey,
    absent_pubkey: frame.absent_pubkey,
    attestation_mode: frame.attestation_mode,
    seal_type: frame.seal_type,
    // M8B FINDING-3 (cascade-2): the legibility certificate, so the present party's daemon persists a
    // durable, retrievable receipt for a unilateral close. Directory-attested (NOT co-signed by the
    // counterparty) — but with FINDING-5 the client re-derives its frontiers from frontier_leaves below.
    legibility: frame.legibility,
  };
  // M8B FINDING-5 (cascade-2): carry the signed leaves so the present party re-derives + verifies each
  // party's content_frontier_seq and REJECTS an inflated published frontier (SI-002). Conditional so a
  // frame built without them (e.g. a hypothetical caller) still encodes cleanly.
  if (frame.frontier_leaves !== undefined) encoded["frontier_leaves"] = frame.frontier_leaves;
  return ENC.encode(encoded);
}

export function encodeSealUnilateralNotification(frame: SealUnilateralNotification): Uint8Array {
  return ENC.encode({
    type: frame.type,
    session_id: frame.session_id,
    sealed_root: frame.sealed_root,
    sealed_at: frame.sealed_at,
    // SESSION-002 certificate
    leaf_count: frame.leaf_count,
    close_timestamp: frame.close_timestamp,
    frost_signature: frame.frost_signature,
    signature_type: frame.signature_type,
    present_pubkey: frame.present_pubkey,
    absent_pubkey: frame.absent_pubkey,
    attestation_mode: frame.attestation_mode,
    seal_type: frame.seal_type,
    // M8B FINDING-3 (cascade-2): the absent party RECEIVES the legibility on reconnect (carried on
    // both the in-memory and durable delivery paths). Client-side persistence of it (so the absent
    // party's cello_get_sealed_receipt returns) is tracked as FINDING-6.
    legibility: frame.legibility,
  });
}

/**
 * SESSION-002: decode + validate the shared seal-certificate fields from a
 * seal_unilateral_confirmed / seal_unilateral_notification frame. `sealed_root` is
 * already decoded by the caller and threaded in. Returns null on any malformed field.
 */
function decodeSealCertFields(
  o: Record<string, unknown>,
  sealed_root: Uint8Array,
): import("./directory-types.js").SealCertificateFields | null {
  const leaf_count = typeof o["leaf_count"] === "number" ? o["leaf_count"] : null;
  const close_timestamp = typeof o["close_timestamp"] === "number" ? o["close_timestamp"] : null;
  const frost_signature = toUint8Array(o["frost_signature"]);
  const signature_type = o["signature_type"];
  const present_pubkey = toUint8Array(o["present_pubkey"]);
  const absent_pubkey = toUint8Array(o["absent_pubkey"]);
  const attestation_mode = o["attestation_mode"];
  if (leaf_count === null || close_timestamp === null) return null;
  if (!frost_signature || frost_signature.length !== 64) return null;
  if (signature_type !== "frost" && signature_type !== "single") return null;
  if (!present_pubkey || present_pubkey.length !== 32) return null;
  if (!absent_pubkey || absent_pubkey.length !== 32) return null;
  if (attestation_mode !== "ABSENT" && attestation_mode !== "DELIVERED") return null;
  // M8B FINDING-3 (cascade-2): pass the legibility certificate through so the outbound
  // decoder round-trips it (the real consumer is the client's generic CBOR decode). A
  // structurally-implausible object is dropped rather than failing the whole frame — the
  // seal is still valid without a receipt (a pre-cascade-2 directory ships none).
  const legibilityRaw = o["legibility"];
  const legibility =
    legibilityRaw && typeof legibilityRaw === "object" &&
    (legibilityRaw as Record<string, unknown>)["attests"] === "receipt"
      ? (legibilityRaw as import("./directory-types.js").SealLegibility)
      : undefined;
  return {
    sealed_root,
    leaf_count,
    close_timestamp,
    frost_signature,
    signature_type,
    present_pubkey,
    absent_pubkey,
    attestation_mode,
    seal_type: "UNILATERAL",
    ...(legibility ? { legibility } : {}),
  };
}

// ─── Decode outbound frames (for test helpers) ────────────────────────────────

export type OutboundSignalingFrame =
  | SignalingAuthChallenge
  | SignalingAuthFailed
  | SignalingAuthOk
  | SessionAssignmentFrame
  | SessionAbandoned
  | SessionSealed
  | SessionSealRejected
  | SessionRequestError
  | NotAuthenticated
  | SealVerified
  | SessionFrostSealed
  | RegisterSuccess
  | RegisterError
  | DkgReady
  | ConnectionEstablished
  | ConnectionRejected
  | ConnectionInsufficient
  | ConnectionRequestError
  | ConnectionRequestInbound
  | DisclosureRequestInbound
  | DisclosureResponseInbound
  | SealRejectedTreeMismatch
  | SealAttemptAck
  | SealUnilateralTooEarly
  | SealUnilateralConfirmed
  | SealUnilateralNotification
  | SealUpgradeConfirmed
  | SealUpgradeRejected
  | ManifestPollResponse
  | PongFrame;

/** Decode a frame sent by the directory (used in tests to inspect what was sent). */
export function decodeOutboundSignalingFrame(bytes: Uint8Array): OutboundSignalingFrame | null {
  let obj: unknown;
  try {
    obj = decode(bytes);
  } catch {
    return null;
  }
  if (typeof obj !== "object" || obj === null) return null;
  const o = obj as Record<string, unknown>;

  if (o["type"] === "signaling_auth_challenge") {
    const nonce = toUint8Array(o["nonce"]);
    if (!nonce || nonce.length !== 32) return null;
    return { type: "signaling_auth_challenge", nonce };
  }

  if (o["type"] === "signaling_auth_failed") {
    const reason = o["reason"];
    if (reason !== "nonce_expired" && reason !== "nonce_unknown" && reason !== "signature_invalid") return null;
    return { type: "signaling_auth_failed", reason };
  }

  if (o["type"] === "signaling_auth_ok") {
    // M7-MANIFEST-002: optional nodeId/signature/timestamp fields (step 5)
    const nodeId = typeof o["nodeId"] === "string" ? o["nodeId"] : undefined;
    const signature = typeof o["signature"] === "string" ? o["signature"] : undefined;
    const timestamp = typeof o["timestamp"] === "string" ? o["timestamp"] : undefined;
    const result: SignalingAuthOk = { type: "signaling_auth_ok" };
    if (nodeId !== undefined) result.nodeId = nodeId;
    if (signature !== undefined) result.signature = signature;
    if (timestamp !== undefined) result.timestamp = timestamp;
    return result;
  }

  if (o["type"] === "session_assignment") {
    const raw = o["assignment"] as Record<string, unknown> | undefined;
    if (!raw || typeof raw !== "object") return null;

    const session_id = toUint8Array(raw["session_id"]);
    if (!session_id || session_id.length !== 16) return null;

    const parseParticipant = (p: unknown) => {
      if (typeof p !== "object" || p === null) return null;
      const pp = p as Record<string, unknown>;
      const pubkey = toUint8Array(pp["pubkey"]);
      const peer_id = typeof pp["peer_id"] === "string" ? pp["peer_id"] : null;
      const multiaddrs = toStringArray(pp["multiaddrs"]);
      if (!pubkey || pubkey.length !== 32 || !peer_id || !multiaddrs) return null;
      return { pubkey, peer_id, multiaddrs };
    };

    const pa = parseParticipant(raw["participant_a"]);
    const pb = parseParticipant(raw["participant_b"]);
    if (!pa || !pb) return null;

    const re = raw["relay_endpoint"] as Record<string, unknown> | undefined;
    if (!re || typeof re !== "object") return null;
    const re_peer_id = typeof re["peer_id"] === "string" ? re["peer_id"] : null;
    const re_multiaddrs = toStringArray(re["multiaddrs"]);
    if (re_peer_id === null || !re_multiaddrs) return null;

    const de = raw["directory_endpoint"] as Record<string, unknown> | undefined;
    if (!de || typeof de !== "object") return null;
    const de_peer_id = typeof de["peer_id"] === "string" ? de["peer_id"] : null;
    const de_multiaddrs = toStringArray(de["multiaddrs"]);
    if (de_peer_id === null || !de_multiaddrs) return null;

    const session_timestamp = typeof raw["session_timestamp"] === "number" ? raw["session_timestamp"] : null;
    if (session_timestamp === null) return null;

    const directory_pubkey = toUint8Array(raw["directory_pubkey"]);
    const directory_signature = toUint8Array(raw["directory_signature"]);
    if (!directory_pubkey || directory_pubkey.length !== 32) return null;
    if (!directory_signature || directory_signature.length !== 64) return null;

    // SESSION-004: parse signature_type and signer_pubkey
    const signature_type = raw["signature_type"];
    if (signature_type !== "frost" && signature_type !== "single") return null;

    // M7-WIRE-001: parse session Peer ID fields from the wire format (undefined when absent for pre-M7 compat).
    const initiator_session_peer_id = typeof raw["initiator_session_peer_id"] === "string" && raw["initiator_session_peer_id"] !== "" ? raw["initiator_session_peer_id"] : undefined;
    const initiator_session_addrs = toStringArray(raw["initiator_session_addrs"]) ?? undefined;
    const counterparty_session_peer_id = typeof raw["counterparty_session_peer_id"] === "string" && raw["counterparty_session_peer_id"] !== "" ? raw["counterparty_session_peer_id"] : undefined;
    const counterparty_session_addrs = toStringArray(raw["counterparty_session_addrs"]) ?? undefined;
    const transport_mode_raw = raw["transport_mode"];
    const transport_mode: "direct" | "relay" | undefined = transport_mode_raw === "direct" ? "direct" : transport_mode_raw === "relay" ? "relay" : undefined;

    // MONIKER-2 AC1b: bounded pass-through on the decode side too (string, 1–64 chars);
    // undefined when absent — the receiver validates the charset at its own boundary.
    const moniker =
      typeof raw["moniker"] === "string" && raw["moniker"].length >= 1 && raw["moniker"].length <= 64
        ? raw["moniker"]
        : undefined;

    const commonFields = {
      session_id,
      participant_a: pa,
      participant_b: pb,
      relay_endpoint: { peer_id: re_peer_id, multiaddrs: re_multiaddrs },
      directory_endpoint: { peer_id: de_peer_id, multiaddrs: de_multiaddrs },
      session_timestamp,
      directory_pubkey,
      directory_signature,
      initiator_session_peer_id,
      initiator_session_addrs,
      counterparty_session_peer_id,
      counterparty_session_addrs,
      transport_mode,
      moniker,
    };

    // Cast needed until @cello-protocol/protocol-types@0.0.5 makes M7 fields optional (AC-020).
    let assignment: SessionAssignment;
    if (signature_type === "frost") {
      const signer_pubkey = toUint8Array(raw["signer_pubkey"]);
      if (!signer_pubkey || signer_pubkey.length !== 32) return null;
      assignment = { ...commonFields, signature_type: "frost", signer_pubkey } as SessionAssignment;
    } else {
      assignment = { ...commonFields, signature_type: "single" } as SessionAssignment;
    }

    return { type: "session_assignment", assignment };
  }

  if (o["type"] === "session_sealed") {
    const session_id = toUint8Array(o["session_id"]);
    const sealed_root = toUint8Array(o["sealed_root"]);
    if (!session_id || session_id.length !== 16) return null;
    if (!sealed_root || sealed_root.length !== 32) return null;
    const _ct = o["close_timestamp"];
    const close_timestamp = typeof _ct === "number" ? _ct : typeof _ct === "bigint" ? Number(_ct) : null;
    if (close_timestamp === null) return null;

    // M7-SESSION-004 (review finding #2): preserve the legibility certificate on the
    // session_sealed frame (both frost and single sub-branches) so a directory-side
    // decode round-trips it symmetrically with session_frost_sealed — no silent field loss.
    const legRaw = o["legibility"];
    const legibility = legRaw !== null && typeof legRaw === "object"
      ? (legRaw as import("./directory-types.js").SealLegibility)
      : undefined;

    const sig_type = o["signature_type"];
    if (sig_type === "frost") {
      const frost_signature = toUint8Array(o["frost_signature"]);
      const signer_pubkey = toUint8Array(o["signer_pubkey"]);
      if (!frost_signature || frost_signature.length !== 64) return null;
      if (!signer_pubkey || signer_pubkey.length !== 32) return null;
      // H-003: parse leaf_count if present (optional for backward compat)
      const leafCountRaw = o["leaf_count"];
      const leaf_count = typeof leafCountRaw === "number" ? leafCountRaw : undefined;
      const result: SessionSealedFrost & { legibility?: import("./directory-types.js").SealLegibility } = {
        type: "session_sealed" as const,
        signature_type: "frost" as const,
        session_id,
        sealed_root,
        frost_signature,
        signer_pubkey,
        close_timestamp,
      };
      if (leaf_count !== undefined) result.leaf_count = leaf_count;
      if (legibility !== undefined) result.legibility = legibility;
      return result;
    }
    // Legacy M1 or explicit "single"
    const directory_signature = toUint8Array(o["directory_signature"]);
    if (!directory_signature || directory_signature.length !== 64) return null;
    const s: SessionSealedSingle & { legibility?: import("./directory-types.js").SealLegibility } = { type: "session_sealed", signature_type: "single", session_id, sealed_root, directory_signature, close_timestamp };
    if (legibility !== undefined) s.legibility = legibility;
    return s;
  }

  if (o["type"] === "session_seal_rejected") {
    const session_id = toUint8Array(o["session_id"]);
    const reason = o["reason"];
    if (!session_id || session_id.length !== 16) return null;
    if (
      reason !== "merkle_root_mismatch" &&
      reason !== "leaf_signature_invalid" &&
      reason !== "prev_root_chain_broken" &&
      reason !== "causal_chain_violated" &&
      reason !== "seal_leaves_invalid" &&
      reason !== "seal_signature_invalid"
    ) return null;
    return { type: "session_seal_rejected", session_id, reason };
  }

  if (o["type"] === "seal_verified") {
    const session_id = toUint8Array(o["session_id"]);
    const sealed_root = toUint8Array(o["sealed_root"]);
    const leaf_count = typeof o["leaf_count"] === "number" ? o["leaf_count"] : null;
    const _ts = o["timestamp"];
    const timestamp = typeof _ts === "number" ? _ts : typeof _ts === "bigint" ? Number(_ts) : null;
    if (!session_id || session_id.length !== 16) return null;
    if (!sealed_root || sealed_root.length !== 32) return null;
    if (leaf_count === null) return null;
    if (timestamp === null) return null;
    return { type: "seal_verified", session_id, sealed_root, leaf_count, timestamp };
  }

  if (o["type"] === "session_frost_sealed") {
    const session_id = toUint8Array(o["session_id"]);
    const sealed_root = toUint8Array(o["sealed_root"]);
    const frost_signature = toUint8Array(o["frost_signature"]);
    const signer_pubkey = toUint8Array(o["signer_pubkey"]);
    if (!session_id || session_id.length !== 16) return null;
    if (!sealed_root || sealed_root.length !== 32) return null;
    if (!frost_signature || frost_signature.length !== 64) return null;
    if (!signer_pubkey || signer_pubkey.length !== 32) return null;
    const result: SessionFrostSealed = { type: "session_frost_sealed", session_id, sealed_root, frost_signature, signer_pubkey };
    // M7-SESSION-004 (review finding #3): preserve the legibility certificate when present.
    const legRaw = o["legibility"];
    if (legRaw !== null && typeof legRaw === "object") {
      result.legibility = legRaw as import("./directory-types.js").SealLegibility;
    }
    return result;
  }

  if (o["type"] === "session_abandoned") {
    const session_id = toUint8Array(o["session_id"]);
    if (!session_id || session_id.length !== 16) return null;
    return { type: "session_abandoned", session_id };
  }

  if (o["type"] === "session_request_error") {
    const reason = o["reason"];
    if (
      reason !== "target_offline" &&
      reason !== "relay_unavailable" &&
      reason !== "frost_signer_not_configured" &&
      reason !== "directory_below_threshold" &&
      reason !== "ceremony_conflict" &&
      reason !== "peer_not_registered" &&
      reason !== "not_registered" &&
      reason !== "connection_id_required" &&
      reason !== "no_connection" &&
      reason !== "session_request_missing_peer_id" &&
      reason !== "ceremony_timeout" &&
      reason !== "ceremony_exhausted" &&
      // DOD-DIR-FAILCLOSED-1 (D2): the fail-closed reason must also survive the OUTBOUND typed
      // allowlist, or the initiator's client decodes the error frame to null and sees a dropped
      // frame instead of the cause. (Same trap as D1-review F2 on the inbound decoder — an
      // allowlist that lives apart from the reason union silently swallows every new reason.)
      reason !== "counterparty_did_not_accept" &&
      // Present in the reason union since M7/M8 but never listed here — a `session_request_error`
      // carrying either would decode to null on the client. Same defect, found by the same fix.
      reason !== "agent_revoked" &&
      reason !== "agent_suspended"
    ) return null;
    return { type: "session_request_error", reason };
  }

  if (o["type"] === "connection_established") {
    const counterparty_pubkey = typeof o["counterparty_pubkey"] === "string" ? o["counterparty_pubkey"] : null;
    const connection_id = typeof o["connection_id"] === "string" ? o["connection_id"] : null;
    if (!counterparty_pubkey || !connection_id) return null;
    return { type: "connection_established", counterparty_pubkey, connection_id };
  }

  if (o["type"] === "connection_rejected") {
    const target_pubkey = typeof o["target_pubkey"] === "string" ? o["target_pubkey"] : null;
    const reason = typeof o["reason"] === "string" ? o["reason"] : null;
    if (!target_pubkey || !reason) return null;
    return { type: "connection_rejected", target_pubkey, reason };
  }

  if (o["type"] === "connection_insufficient") {
    const target_pubkey = typeof o["target_pubkey"] === "string" ? o["target_pubkey"] : null;
    const unmet_requirements = Array.isArray(o["unmet_requirements"]) ? o["unmet_requirements"] : null;
    if (!target_pubkey || !unmet_requirements) return null;
    return { type: "connection_insufficient", target_pubkey, unmet_requirements };
  }

  if (o["type"] === "connection_request_error") {
    const reason = o["reason"];
    if (
      reason !== "not_registered" &&
      reason !== "target_not_found" &&
      reason !== "already_connected" &&
      reason !== "target_unavailable"
    ) return null;
    return { type: "connection_request_error", reason };
  }

  if (o["type"] === "connection_request_inbound") {
    const from_pubkey = typeof o["from_pubkey"] === "string" ? o["from_pubkey"] : null;
    const connection_request_id = typeof o["connection_request_id"] === "string" ? o["connection_request_id"] : null;
    const package_cbor = toUint8Array(o["package_cbor"]);
    const sender_registered_at_raw = o["sender_registered_at"];
    const sender_registered_at = typeof sender_registered_at_raw === "number" ? sender_registered_at_raw
      : typeof sender_registered_at_raw === "bigint" ? Number(sender_registered_at_raw) : null;
    const sender_is_provisional = typeof o["sender_is_provisional"] === "boolean" ? o["sender_is_provisional"] : false;
    if (!from_pubkey || !connection_request_id || !package_cbor || sender_registered_at === null) return null;
    return { type: "connection_request_inbound", from_pubkey, connection_request_id, package_cbor, sender_registered_at, sender_is_provisional };
  }

  if (o["type"] === "disclosure_request_inbound") {
    const from_pubkey = typeof o["from_pubkey"] === "string" ? o["from_pubkey"] : null;
    const connection_request_id = typeof o["connection_request_id"] === "string" ? o["connection_request_id"] : null;
    const requested_items = Array.isArray(o["requested_items"]) ? o["requested_items"] : [];
    if (!from_pubkey || !connection_request_id) return null;
    return { type: "disclosure_request_inbound", from_pubkey, connection_request_id, requested_items };
  }

  if (o["type"] === "disclosure_response_inbound") {
    const connection_request_id = typeof o["connection_request_id"] === "string" ? o["connection_request_id"] : null;
    const package_cbor = toUint8Array(o["package_cbor"]);
    if (!connection_request_id || !package_cbor) return null;
    return { type: "disclosure_response_inbound", connection_request_id, package_cbor };
  }

  if (o["type"] === "not_authenticated") {
    return { type: "not_authenticated" };
  }

  if (o["type"] === "register_success") {
    const agent_id = typeof o["agent_id"] === "string" ? o["agent_id"] : null;
    const primary_pubkey = typeof o["primary_pubkey"] === "string" ? o["primary_pubkey"] : null;
    if (!agent_id || !primary_pubkey) return null;
    return { type: "register_success" as const, agent_id, primary_pubkey };
  }

  if (o["type"] === "register_error") {
    const reason = o["reason"];
    if (
      reason !== "already_registered" &&
      reason !== "phone_already_claimed" &&
      reason !== "invalid_verification" &&
      reason !== "dkg_failed" &&
      reason !== "not_authenticated" &&
      reason !== "dkg_verification_failed"
    ) return null;
    return { type: "register_error" as const, reason };
  }

  if (o["type"] === "dkg_ready") {
    const epochId = typeof o["epochId"] === "string" ? o["epochId"] : null;
    const participants = typeof o["participants"] === "number" ? o["participants"] : null;
    const threshold = typeof o["threshold"] === "number" ? o["threshold"] : null;
    if (!epochId || participants === null || threshold === null) return null;
    return { type: "dkg_ready" as const, epochId, participants, threshold };
  }

  // ─── PERSIST-014 outbound frames ─────────────────────────────────────────

  if (o["type"] === "seal_rejected_tree_mismatch") {
    const session_id = toUint8Array(o["session_id"]);
    const party_a_sequence = typeof o["party_a_sequence"] === "number" ? o["party_a_sequence"] : null;
    const party_b_sequence = typeof o["party_b_sequence"] === "number" ? o["party_b_sequence"] : null;
    if (!session_id || session_id.length !== 16) return null;
    if (party_a_sequence === null || party_b_sequence === null) return null;
    return { type: "seal_rejected_tree_mismatch", session_id, party_a_sequence, party_b_sequence };
  }

  if (o["type"] === "seal_attempt_ack") {
    const session_id = toUint8Array(o["session_id"]);
    if (!session_id || session_id.length !== 16) return null;
    return { type: "seal_attempt_ack", session_id };
  }

  // ─── PERSIST-015 outbound frames ─────────────────────────────────────────

  if (o["type"] === "seal_unilateral_too_early") {
    const session_id = toUint8Array(o["session_id"]);
    const remaining_seconds = typeof o["remaining_seconds"] === "number" ? o["remaining_seconds"] : null;
    if (!session_id || session_id.length !== 16) return null;
    if (remaining_seconds === null) return null;
    return { type: "seal_unilateral_too_early", session_id, remaining_seconds };
  }

  if (o["type"] === "seal_unilateral_confirmed") {
    const session_id = toUint8Array(o["session_id"]);
    const sealed_root = toUint8Array(o["sealed_root"]);
    const sealed_at = typeof o["sealed_at"] === "number" ? o["sealed_at"] : null;
    if (!session_id || session_id.length !== 16) return null;
    if (!sealed_root || sealed_root.length !== 32) return null;
    if (sealed_at === null) return null;
    const cert = decodeSealCertFields(o, sealed_root);
    if (!cert) return null;
    return { type: "seal_unilateral_confirmed", session_id, sealed_at, ...cert };
  }

  if (o["type"] === "seal_unilateral_notification") {
    const session_id = toUint8Array(o["session_id"]);
    const sealed_root = toUint8Array(o["sealed_root"]);
    const sealed_at = typeof o["sealed_at"] === "number" ? o["sealed_at"] : null;
    if (!session_id || session_id.length !== 16) return null;
    if (!sealed_root || sealed_root.length !== 32) return null;
    if (sealed_at === null) return null;
    const cert = decodeSealCertFields(o, sealed_root);
    if (!cert) return null;
    return { type: "seal_unilateral_notification", session_id, sealed_at, ...cert };
  }

  // CELLO-M7-UPGRADE-001 (DOD-UP-1): seal upgrade responses (directory → client)
  if (o["type"] === "seal_upgrade_confirmed") {
    const session_id = toUint8Array(o["session_id"]);
    const sealed_root = toUint8Array(o["sealed_root"]);
    const leaf_count = typeof o["leaf_count"] === "number" ? o["leaf_count"] : null;
    const close_timestamp = typeof o["close_timestamp"] === "number" ? o["close_timestamp"] : null;
    const present_pubkey = toUint8Array(o["present_pubkey"]);
    const present_signature = toUint8Array(o["present_signature"]);
    const present_signature_type = o["present_signature_type"];
    const returning_pubkey = toUint8Array(o["returning_pubkey"]);
    const returning_signature = toUint8Array(o["returning_signature"]);
    if (!session_id || session_id.length !== 16) return null;
    if (!sealed_root || sealed_root.length !== 32) return null;
    if (leaf_count === null) return null;
    if (close_timestamp === null) return null;
    if (!present_pubkey || present_pubkey.length !== 32) return null;
    if (!present_signature || present_signature.length !== 64) return null;
    if (present_signature_type !== "frost" && present_signature_type !== "single") return null;
    if (!returning_pubkey || returning_pubkey.length !== 32) return null;
    if (!returning_signature || returning_signature.length !== 64) return null;
    return {
      type: "seal_upgrade_confirmed", session_id, sealed_root, leaf_count, close_timestamp,
      present_pubkey, present_signature, present_signature_type,
      returning_pubkey, returning_signature, seal_type: "BILATERAL",
    };
  }

  if (o["type"] === "seal_upgrade_rejected") {
    const session_id = toUint8Array(o["session_id"]);
    const reason = o["reason"];
    if (!session_id || session_id.length !== 16) return null;
    if (reason !== "no_unilateral_seal" && reason !== "already_bilateral" &&
        reason !== "not_absent_party" && reason !== "ack_signature_invalid") return null;
    return { type: "seal_upgrade_rejected", session_id, reason };
  }

  // M7-MANIFEST-002: manifest poll response (directory → client)
  if (o["type"] === "manifest_poll_response") {
    const manifest = o["manifest"];
    if (typeof manifest !== "object" || manifest === null) return null;
    // Trust the manifest shape — full validation happens in the client's verifyManifest()
    return { type: "manifest_poll_response", manifest: manifest as ManifestPollResponse["manifest"] };
  }

  // M7-DIR-PING-001: heartbeat pong (directory → client)
  if (o["type"] === "pong") {
    const tsRaw = o["ts"];
    const ts = typeof tsRaw === "number" ? tsRaw : typeof tsRaw === "bigint" ? Number(tsRaw) : null;
    if (ts === null || !Number.isFinite(ts)) return null;
    return { type: "pong", ts };
  }

  return null;
}
