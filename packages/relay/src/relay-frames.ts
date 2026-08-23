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
  SessionLivenessQuery,
  SessionLivenessResponse,
  ClientRecordAssignment,
} from "./relay-types.js";

const ENC = new Encoder({ tagUint8Array: false });

/**
 * The ctrl leaf kind — the ONLY kind whose content may reach a relay. See `HashSubmit.content_bytes`.
 * A literal rather than an import so the guard cannot be widened by a change to a shared map that
 * someone makes for an unrelated reason.
 */
const RELAY_CTRL_LEAF_KIND = 0x02;

/**
 * Ceiling on a carried SEAL payload.
 *
 * The real thing is `[session_id(16), final_root(32), close_timestamp, "PENDING"]` — CBOR well under
 * 128 bytes. Without a bound, "ctrl leaves only" stops being much of a limit: it is still one
 * unbounded write into relay session state per close, free to the client. Generous against the real
 * payload, tiny against a message.
 */
const MAX_CTRL_PAYLOAD_BYTES = 512;

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
  // DOD-MSG-4: include structure2_cbor (the committed ordering record) when present, in BOTH the
  // signed and unsigned ACK shapes — the sender stamps it into its self-ordering content frame.
  if (frame.relay_id !== undefined && frame.relay_signature !== undefined && frame.timestamp !== undefined) {
    return ENC.encode({
      type: frame.type,
      sequence_number: frame.sequence_number,
      relay_id: frame.relay_id,
      relay_signature: frame.relay_signature,
      timestamp: frame.timestamp,
      structure2_cbor: frame.structure2_cbor,
    });
  }
  return ENC.encode({ type: frame.type, sequence_number: frame.sequence_number, structure2_cbor: frame.structure2_cbor });
}

export function encodeHashSubmitError(frame: HashSubmitError): Uint8Array {
  // `detail` rides only when present — Invariant 3 (DOD-M15-TERMINAL-REASON-1 review F6): the relay
  // carries the DIRECTORY's own refusal cause instead of discarding it behind a class name. An
  // older client ignores an unknown field, so this is additive on the wire.
  return ENC.encode({ type: frame.type, reason: frame.reason, ...(frame.detail ? { detail: frame.detail } : {}) });
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

// ─── M7-SESSION-001: session_interrupted control frame ────────────────────────

/**
 * Encode a session_interrupted control frame.
 * Relay-originated — no Merkle root, no FROST signature.
 * Best-effort delivery to remaining connected participant.
 *
 * WIRE CONVENTION (L-1): the on-wire field is INTENTIONALLY snake_case
 * `session_id`, matching every other relay frame (leaf_deliver, hash_submit,
 * the surviving session frames). The camelCase `sessionId` is the in-process TS field only; it is
 * mapped to `session_id` here. Do NOT "fix" this to camelCase — doing so breaks
 * the relay wire format and any decoder expecting `session_id`.
 */
export function encodeSessionInterrupted(frame: { type: "session_interrupted"; sessionId: string; reason: "peer_disconnected" | "timeout" }): Uint8Array {
  return ENC.encode({ type: frame.type, session_id: frame.sessionId, reason: frame.reason });
}

// ─── CELLO-M7-SESSION-003: session-path liveness frames ────────────────────────

/**
 * Encode a session_liveness_response frame.
 *
 * WIRE CONVENTION: snake_case keys, binary session_id (16 bytes) and
 * counterparty_pubkey (32 bytes) — byte-identical to the codec in
 * @cello-protocol/protocol-types (session-liveness.ts). The relay re-implements
 * the codec here because it cannot import the unpublished client package; the two
 * MUST stay in sync.
 */
export function encodeSessionLivenessResponse(frame: SessionLivenessResponse): Uint8Array {
  return ENC.encode({
    type: "session_liveness_response",
    session_id: frame.session_id,
    counterparty_pubkey: frame.counterparty_pubkey,
    liveness: frame.liveness,
    observed_at: frame.observed_at,
  });
}

// ─── Decode ───────────────────────────────────────────────────────────────────

export type InboundRelayFrame = RelayAuthResponse | HashSubmit | SessionLivenessQuery | ClientRecordAssignment;

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
    /**
     * `DOD-M15-SEALWIRE-1` bullets 3+4 — the SEAL payload, and the guard that keeps it a seal payload.
     *
     * 🚨 CTRL ONLY, REFUSED AT THE WIRE. A `msg` leaf's content is the operator's plaintext and a
     * `doc` leaf's is their document; accepting this field for either would hand a forwarding relay
     * the thing INV-3 exists to keep from it. Refusing the FRAME rather than dropping the field is
     * deliberate: a client sending content for a msg leaf is not a tidy-up, it is a client trying to
     * give the relay something it must never hold.
     *
     * Present-but-malformed voids the frame for the same reason its directory-side sibling does —
     * dropping it to absent makes a client that IS sending the payload indistinguishable from one
     * that is not, and downstream that reads as "the other side is on an old build."
     */
    let content_bytes: Uint8Array | undefined;
    if (o["content_bytes"] !== undefined) {
      if (leaf_kind !== RELAY_CTRL_LEAF_KIND) return null;
      const cb = toUint8Array(o["content_bytes"]);
      if (!cb || cb.length === 0 || cb.length > MAX_CTRL_PAYLOAD_BYTES) return null;
      content_bytes = cb;
    }
    return { type: "hash_submit", session_id, leaf_kind, structure1_cbor, sender_signature, predecessor_relay_id, predecessor_relay_signature, predecessor_relay_sequence, predecessor_relay_timestamp, ...(content_bytes ? { content_bytes } : {}) };
  }

  // CELLO-M7-SESSION-003: session_liveness_query
  if (o["type"] === "session_liveness_query") {
    const session_id = toUint8Array(o["session_id"]);
    const counterparty_pubkey = toUint8Array(o["counterparty_pubkey"]);
    if (!session_id || session_id.length !== 16) return null;
    if (!counterparty_pubkey || counterparty_pubkey.length !== 32) return null;
    return { type: "session_liveness_query", session_id, counterparty_pubkey };
  }

  // FED-OPTIONB-SETUP-001: client-presented session assignment (Option B). Shape-validate only;
  // the relay verifies assignment_signature over the reconstructed TBS against the consortium keys.
  if (o["type"] === "client_record_assignment") {
    const session_id = toUint8Array(o["session_id"]);
    const participant_a = toUint8Array(o["participant_a"]);
    const participant_b = toUint8Array(o["participant_b"]);
    const assignment_signature = toUint8Array(o["assignment_signature"]);
    const tsRaw = o["session_timestamp"];
    const session_timestamp = typeof tsRaw === "number" ? tsRaw : typeof tsRaw === "bigint" ? Number(tsRaw) : null;
    if (!session_id || session_id.length !== 16) return null;
    if (!participant_a || participant_a.length !== 32) return null;
    if (!participant_b || participant_b.length !== 32) return null;
    if (!assignment_signature || assignment_signature.length !== 64) return null;
    if (session_timestamp === null) return null;
    const initiator_session_peer_id =
      typeof o["initiator_session_peer_id"] === "string" && o["initiator_session_peer_id"] !== ""
        ? (o["initiator_session_peer_id"] as string)
        : undefined;
    const counterparty_session_peer_id =
      typeof o["counterparty_session_peer_id"] === "string" && o["counterparty_session_peer_id"] !== ""
        ? (o["counterparty_session_peer_id"] as string)
        : undefined;
    return {
      type: "client_record_assignment",
      session_id,
      participant_a,
      participant_b,
      session_timestamp,
      initiator_session_peer_id,
      counterparty_session_peer_id,
      assignment_signature,
    };
  }

  return null;
}
