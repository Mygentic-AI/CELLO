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

// ─── Decode ───────────────────────────────────────────────────────────────────

export type InboundRelayFrame = RelayAuthResponse | HashSubmit;

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
    return { type: "hash_submit", session_id, leaf_kind, structure1_cbor, sender_signature };
  }

  return null;
}
