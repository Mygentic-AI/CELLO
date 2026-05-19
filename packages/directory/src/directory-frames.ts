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
  SessionSealRejected,
  SessionRequestError,
  NotAuthenticated,
  SealVerified,
  SealFrostSignature,
  SessionFrostSealed,
  PeerInfoAnnounce,
} from "./directory-types.js";

const ENC = new Encoder({ tagUint8Array: false });

// ─── Encode (directory → client) ─────────────────────────────────────────────

export function encodeSignalingAuthChallenge(frame: SignalingAuthChallenge): Uint8Array {
  return ENC.encode({ type: frame.type, nonce: frame.nonce });
}

export function encodeSignalingAuthFailed(frame: SignalingAuthFailed): Uint8Array {
  return ENC.encode({ type: frame.type, reason: frame.reason });
}

export function encodeSignalingAuthOk(_frame: SignalingAuthOk): Uint8Array {
  return ENC.encode({ type: "signaling_auth_ok" });
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
  return ENC.encode({ type: frame.type, assignment: encodedAssignment });
}

export function encodeSessionAbandoned(frame: SessionAbandoned): Uint8Array {
  return ENC.encode({ type: frame.type, session_id: frame.session_id });
}

export function encodeSessionSealed(frame: SessionSealed): Uint8Array {
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
    return ENC.encode(encoded);
  }
  // signature_type === "single" (deprecated M1 format)
  const f = frame as SessionSealedSingle;
  return ENC.encode({
    type: f.type,
    signature_type: "single",
    session_id: f.session_id,
    sealed_root: f.sealed_root,
    directory_signature: f.directory_signature,
    close_timestamp: f.close_timestamp > 0xffffffff
      ? BigInt(f.close_timestamp)
      : f.close_timestamp,
  });
}

export function encodeSealVerified(frame: SealVerified): Uint8Array {
  return ENC.encode({
    type: frame.type,
    session_id: frame.session_id,
    sealed_root: frame.sealed_root,
    leaf_count: frame.leaf_count,
    timestamp: frame.timestamp > 0xffffffff
      ? BigInt(frame.timestamp)
      : frame.timestamp,
  });
}

export function encodeSessionFrostSealed(frame: SessionFrostSealed): Uint8Array {
  return ENC.encode({
    type: frame.type,
    session_id: frame.session_id,
    sealed_root: frame.sealed_root,
    frost_signature: frame.frost_signature,
    signer_pubkey: frame.signer_pubkey,
  });
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

import type { RegisterSuccess, RegisterError, DkgReady } from "@cello/protocol-types";

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

// ─── CONNREQ-002: Connection frame encoders (directory → client) ──────────────

import type {
  ConnectionEstablished,
  ConnectionRejected,
  ConnectionInsufficient,
  ConnectionRequestError,
  ConnectionRequestInbound,
  DisclosureRequestInbound,
  DisclosureResponseInbound,
} from "@cello/protocol-types";

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

import type { RegisterRequest, DkgComplete, ConnectionRequest, ConnectionResponse, DisclosureRequest, DisclosureResponse } from "@cello/protocol-types";

import type { SealAttempt, SealRejectedTreeMismatch, SealAttemptAck, SealUnilateral, SealUnilateralTooEarly, SealUnilateralConfirmed, SealUnilateralNotification } from "./directory-types.js";

export type InboundSignalingFrame = SignalingAuthResponse | SessionRequest | SealFrostSignature | PeerInfoAnnounce | RegisterRequest | DkgComplete | ConnectionRequest | ConnectionResponse | DisclosureRequest | DisclosureResponse | SealAttempt | SealUnilateral;

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
    return { type: "signaling_auth_response", pubkey, signature };
  }

  if (o["type"] === "session_request") {
    const target_pubkey = toUint8Array(o["target_pubkey"]);
    if (!target_pubkey || target_pubkey.length !== 32) return null;
    // CONNREQ-002/SESSION-006: optional connection_id field (M3 adds it; M2 omits it)
    const connection_id = typeof o["connection_id"] === "string" ? o["connection_id"] : undefined;
    return { type: "session_request", target_pubkey, ...(connection_id !== undefined ? { connection_id } : {}) };
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
    return { type: "register_request", phone_stub, k_local_pubkey, ml_dsa_pubkey };
  }

  if (o["type"] === "dkg_complete") {
    const primary_pubkey = typeof o["primary_pubkey"] === "string" ? o["primary_pubkey"] : null;
    if (primary_pubkey === null) return null;
    return { type: "dkg_complete" as const, primary_pubkey };
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
    return { type: "seal_unilateral", session_id, reported_root, reported_seq };
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

export function encodeSealUnilateralConfirmed(frame: SealUnilateralConfirmed): Uint8Array {
  return ENC.encode({
    type: frame.type,
    session_id: frame.session_id,
    sealed_root: frame.sealed_root,
    sealed_at: frame.sealed_at,
  });
}

export function encodeSealUnilateralNotification(frame: SealUnilateralNotification): Uint8Array {
  return ENC.encode({
    type: frame.type,
    session_id: frame.session_id,
    sealed_root: frame.sealed_root,
    sealed_at: frame.sealed_at,
    seal_type: frame.seal_type,
  });
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
  | SealUnilateralNotification;

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
    return { type: "signaling_auth_ok" };
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

    const commonFields = {
      session_id,
      participant_a: pa,
      participant_b: pb,
      relay_endpoint: { peer_id: re_peer_id, multiaddrs: re_multiaddrs },
      directory_endpoint: { peer_id: de_peer_id, multiaddrs: de_multiaddrs },
      session_timestamp,
      directory_pubkey,
      directory_signature,
    };

    let assignment: SessionAssignment;
    if (signature_type === "frost") {
      const signer_pubkey = toUint8Array(raw["signer_pubkey"]);
      if (!signer_pubkey || signer_pubkey.length !== 32) return null;
      assignment = { ...commonFields, signature_type: "frost", signer_pubkey };
    } else {
      assignment = { ...commonFields, signature_type: "single" };
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

    const sig_type = o["signature_type"];
    if (sig_type === "frost") {
      const frost_signature = toUint8Array(o["frost_signature"]);
      const signer_pubkey = toUint8Array(o["signer_pubkey"]);
      if (!frost_signature || frost_signature.length !== 64) return null;
      if (!signer_pubkey || signer_pubkey.length !== 32) return null;
      // H-003: parse leaf_count if present (optional for backward compat)
      const leafCountRaw = o["leaf_count"];
      const leaf_count = typeof leafCountRaw === "number" ? leafCountRaw : undefined;
      const result: SessionSealedFrost = {
        type: "session_sealed" as const,
        signature_type: "frost" as const,
        session_id,
        sealed_root,
        frost_signature,
        signer_pubkey,
        close_timestamp,
      };
      if (leaf_count !== undefined) result.leaf_count = leaf_count;
      return result;
    }
    // Legacy M1 or explicit "single"
    const directory_signature = toUint8Array(o["directory_signature"]);
    if (!directory_signature || directory_signature.length !== 64) return null;
    const s: SessionSealedSingle = { type: "session_sealed", signature_type: "single", session_id, sealed_root, directory_signature, close_timestamp };
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
    return { type: "session_frost_sealed", session_id, sealed_root, frost_signature, signer_pubkey };
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
      reason !== "no_connection"
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
    return { type: "seal_unilateral_confirmed", session_id, sealed_root, sealed_at };
  }

  if (o["type"] === "seal_unilateral_notification") {
    const session_id = toUint8Array(o["session_id"]);
    const sealed_root = toUint8Array(o["sealed_root"]);
    const sealed_at = typeof o["sealed_at"] === "number" ? o["sealed_at"] : null;
    if (!session_id || session_id.length !== 16) return null;
    if (!sealed_root || sealed_root.length !== 32) return null;
    if (sealed_at === null) return null;
    return { type: "seal_unilateral_notification", session_id, sealed_root, sealed_at, seal_type: "UNILATERAL" };
  }

  return null;
}
