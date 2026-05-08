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
  SessionSealed,
  SessionSealRejected,
  SessionRequestError,
  NotAuthenticated,
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
  return ENC.encode({
    type: frame.type,
    assignment: {
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
    },
  });
}

export function encodeSessionAbandoned(frame: SessionAbandoned): Uint8Array {
  return ENC.encode({ type: frame.type, session_id: frame.session_id });
}

export function encodeSessionSealed(frame: SessionSealed): Uint8Array {
  return ENC.encode({
    type: frame.type,
    session_id: frame.session_id,
    sealed_root: frame.sealed_root,
    directory_signature: frame.directory_signature,
    close_timestamp: frame.close_timestamp > 0xffffffff
      ? BigInt(frame.close_timestamp)
      : frame.close_timestamp,
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

export type InboundSignalingFrame = SignalingAuthResponse | SessionRequest;

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
  | NotAuthenticated;

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

    const assignment: SessionAssignment = {
      session_id,
      participant_a: pa,
      participant_b: pb,
      relay_endpoint: { peer_id: re_peer_id, multiaddrs: re_multiaddrs },
      directory_endpoint: { peer_id: de_peer_id, multiaddrs: de_multiaddrs },
      session_timestamp,
      directory_pubkey,
      directory_signature,
    };
    return { type: "session_assignment", assignment };
  }

  if (o["type"] === "session_sealed") {
    const session_id = toUint8Array(o["session_id"]);
    const sealed_root = toUint8Array(o["sealed_root"]);
    const directory_signature = toUint8Array(o["directory_signature"]);
    if (!session_id || session_id.length !== 16) return null;
    if (!sealed_root || sealed_root.length !== 32) return null;
    if (!directory_signature || directory_signature.length !== 64) return null;
    const _ct = o["close_timestamp"];
    const close_timestamp = typeof _ct === "number" ? _ct : typeof _ct === "bigint" ? Number(_ct) : null;
    if (close_timestamp === null) return null;
    return { type: "session_sealed", session_id, sealed_root, directory_signature, close_timestamp };
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
      reason !== "seal_leaves_invalid"
    ) return null;
    return { type: "session_seal_rejected", session_id, reason };
  }

  if (o["type"] === "session_abandoned") {
    const session_id = toUint8Array(o["session_id"]);
    if (!session_id || session_id.length !== 16) return null;
    return { type: "session_abandoned", session_id };
  }

  if (o["type"] === "session_request_error") {
    const reason = o["reason"];
    if (reason !== "target_offline" && reason !== "relay_unavailable") return null;
    return { type: "session_request_error", reason };
  }

  if (o["type"] === "not_authenticated") {
    return { type: "not_authenticated" };
  }

  return null;
}
