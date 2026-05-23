/**
 * CELLO Relay — frame CBOR codec (NODE-002)
 *
 * Encoding: canonical CBOR per RFC 8949 §4.2.1
 * Framing: it-length-prefixed on top of the libp2p stream (handled by caller)
 */

import { Encoder, decode } from "cbor-x";
import type {
  RelayAuthChallenge,
  RelayAuthResponse,
  RelayAuthFailed,
  RelayAuthOk,
  HashSubmit,
  HashSubmitAck,
  HashSubmitError,
  LeafDeliver,
  GapFillRequest,
  GapFillResponse,
  GapFillError,
} from "./relay-types.js";

const ENC = new Encoder({ tagUint8Array: false });

// ─── Encode ───────────────────────────────────────────────────────────────────

export function encodeAuthChallenge(frame: RelayAuthChallenge): Uint8Array {
  return ENC.encode({ type: frame.type, nonce: frame.nonce });
}

export function encodeAuthFailed(frame: RelayAuthFailed): Uint8Array {
  return ENC.encode({ type: frame.type, reason: frame.reason });
}

export function encodeAuthOk(_frame: RelayAuthOk): Uint8Array {
  return ENC.encode({ type: "relay_auth_ok" });
}

export function encodeHashSubmitAck(frame: HashSubmitAck): Uint8Array {
  // PERSIST-012: include relay_id, relay_signature, timestamp when present (signed ACK)
  if (frame.relay_id !== undefined && frame.relay_signature !== undefined && frame.timestamp !== undefined) {
    return ENC.encode({
      type: frame.type,
      sequence_number: frame.sequence_number,
      relay_id: frame.relay_id,
      relay_signature: frame.relay_signature,
      timestamp: frame.timestamp,
    });
  }
  return ENC.encode({ type: frame.type, sequence_number: frame.sequence_number });
}

export function encodeHashSubmitError(frame: HashSubmitError): Uint8Array {
  return ENC.encode({ type: frame.type, reason: frame.reason });
}

export function encodeLeafDeliver(frame: LeafDeliver): Uint8Array {
  return ENC.encode({
    type: frame.type,
    session_id: frame.session_id,
    leaf_kind: frame.leaf_kind,
    sequence_number: frame.sequence_number,
    structure2_cbor: frame.structure2_cbor,
    structure1_cbor: frame.structure1_cbor,
  });
}

// ─── PERSIST-014: Gap-fill encode ────────────────────────────────────────────

export function encodeGapFillResponse(frame: GapFillResponse): Uint8Array {
  return ENC.encode({
    type: frame.type,
    leaves: frame.leaves.map((l) => ({
      sequence_number: l.sequence_number,
      sender_pubkey: l.sender_pubkey,
      content_hash: l.content_hash,
      sender_signature: l.sender_signature,
      prev_root: l.prev_root,
      structure1_cbor: l.structure1_cbor,
    })),
  });
}

export function encodeGapFillError(frame: GapFillError): Uint8Array {
  return ENC.encode({ type: frame.type, reason: frame.reason });
}

// ─── Decode ───────────────────────────────────────────────────────────────────

export type InboundRelayFrame = RelayAuthResponse | HashSubmit | GapFillRequest;

function toUint8Array(v: unknown): Uint8Array | null {
  if (v instanceof Uint8Array) return v;
  if (Buffer.isBuffer(v)) return new Uint8Array(v);
  return null;
}

/** Decode a raw CBOR frame from the client stream. Returns null on malformed input. */
export function decodeInboundFrame(bytes: Uint8Array): InboundRelayFrame | null {
  let obj: unknown;
  try {
    obj = decode(bytes);
  } catch {
    return null;
  }
  if (typeof obj !== "object" || obj === null) return null;
  const o = obj as Record<string, unknown>;

  if (o["type"] === "relay_auth_response") {
    const pubkey = toUint8Array(o["pubkey"]);
    const signature = toUint8Array(o["signature"]);
    if (!pubkey || pubkey.length !== 32) return null;
    if (!signature || signature.length !== 64) return null;
    return { type: "relay_auth_response", pubkey, signature };
  }

  if (o["type"] === "hash_submit") {
    const session_id = toUint8Array(o["session_id"]);
    const structure1_cbor = toUint8Array(o["structure1_cbor"]);
    const sender_signature = toUint8Array(o["sender_signature"]);
    const leaf_kind = typeof o["leaf_kind"] === "number" ? o["leaf_kind"] : null;
    if (!session_id || session_id.length !== 16) return null;
    if (leaf_kind === null) return null;
    if (!structure1_cbor || structure1_cbor.length === 0) return null;
    if (!sender_signature || sender_signature.length !== 64) return null;
    // FEDERATION-003 AC-005/AC-006/SI-002: optional predecessor relay ACK fields
    const predecessor_relay_id = typeof o["predecessor_relay_id"] === "string" ? o["predecessor_relay_id"] : undefined;
    const predecessor_relay_signature = o["predecessor_relay_signature"] !== undefined ? toUint8Array(o["predecessor_relay_signature"]) ?? undefined : undefined;
    const predecessor_relay_sequence = typeof o["predecessor_relay_sequence"] === "number" ? o["predecessor_relay_sequence"] : undefined;
    const predecessor_relay_timestamp = typeof o["predecessor_relay_timestamp"] === "number" ? o["predecessor_relay_timestamp"] : undefined;
    return { type: "hash_submit", session_id, leaf_kind, structure1_cbor, sender_signature, predecessor_relay_id, predecessor_relay_signature, predecessor_relay_sequence, predecessor_relay_timestamp };
  }

  if (o["type"] === "gap_fill_request") {
    const session_id = toUint8Array(o["session_id"]);
    const from_seq = typeof o["from_seq"] === "number" ? o["from_seq"] : null;
    const to_seq = typeof o["to_seq"] === "number" ? o["to_seq"] : null;
    if (!session_id || session_id.length !== 16) return null;
    if (from_seq === null || to_seq === null) return null;
    return { type: "gap_fill_request", session_id, from_seq, to_seq };
  }

  return null;
}
