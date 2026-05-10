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

// ─── Decode (client → directory) ─────────────────────────────────────────────

export type InboundSignalingFrame = SignalingAuthResponse | SessionRequest | SealFrostSignature | PeerInfoAnnounce;

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
    return { type: "session_request", target_pubkey };
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

  return null;
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
  | SessionFrostSealed;

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
      reason !== "peer_not_registered"
    ) return null;
    return { type: "session_request_error", reason };
  }

  if (o["type"] === "not_authenticated") {
    return { type: "not_authenticated" };
  }

  return null;
}
