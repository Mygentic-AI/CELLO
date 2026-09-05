/**
 * CELLO Relay — frame CBOR codec (NODE-002)
 *
 * Encoding: canonical CBOR per RFC 8949 §4.2.1
 * Framing: it-length-prefixed on top of the libp2p stream (handled by caller)
 */

import { Encoder, decode } from "cbor-x";
import { decodeSealPayload } from "@cello-protocol/protocol-types";
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
  SessionWitnessAlert,
  ClientRecordAssignment,
  SessionReplay,
  SessionReplayResult,
} from "./relay-types.js";
import type { SealUnilateralLeaf, SessionTipAttestation } from "@cello-protocol/interfaces";

const ENC = new Encoder({ tagUint8Array: false });

/**
 * 031-RELAYREPLAY — ceiling on a replayed conversation, applied BEFORE any signature is checked.
 *
 * Verification is O(N log N) in the leaf count (a Merkle rebuild per leaf for the prev_root chain),
 * and every byte of it is attacker-chosen: a `session_replay` arrives from an authenticated
 * participant, but "authenticated" is not "honest", and nothing in the batch is trustworthy until
 * the walk that this bound protects has finished. Without it one frame buys unbounded relay CPU.
 *
 * 4096 is far above any real conversation and far below the point where the walk is expensive. A
 * batch over it is refused as malformed rather than truncated — truncating a chain to fit a limit
 * is D4c, which this order rules out for the reason it rules it out everywhere: those messages
 * exist in both operators' transcripts.
 */
const MAX_REPLAY_LEAVES = 4096;

/**
 * The ctrl leaf kind — the ONLY kind whose content may reach a relay. See `HashSubmit.content_bytes`.
 * A literal rather than an import so the guard cannot be widened by a change to a shared map that
 * someone makes for an unrelated reason.
 */
const RELAY_CTRL_LEAF_KIND = 0x02;

/**
 * Ceiling on a carried SEAL payload. A real `encodeSealPayload` output is **69 bytes**, measured.
 *
 * ⚠️ THIS IS NOW BELT TO THE PAYLOAD DECODE'S BRACES, AND IT CANNOT BE TESTED INDEPENDENTLY — said
 * plainly rather than left as a guard that looks load-bearing.
 *
 * Once the bytes must decode as a seal payload (review H1), anything oversized is refused on content
 * grounds anyway, so no input distinguishes "the ceiling caught it" from "the decode caught it": a
 * mutant raising this to 4096 survives every test in the suite. It is kept for one reason the decode
 * does not cover — it bounds the work done BEFORE `decodeSealPayload` runs, so a client cannot make
 * this relay CBOR-parse a multi-megabyte buffer per submit. The order matters: the length check is
 * above the decode, deliberately.
 *
 * ⚠️ AND THE JOB IS SMALLER THAN THIS COMMENT FIRST CLAIMED. By the time this bound is reached, the
 * outer `decode(frameBytes)` has already parsed and materialised the whole frame — so what it saves
 * is one EXTRA parse of an already-resident buffer, not the allocation, and pathological nesting
 * inside it is caught by `decodeSealPayload`'s own try/catch regardless. Free, worth keeping, and
 * worth describing accurately: promising more than it delivers is the exact failure this unit is
 * about.
 *
 * "Untestable" also overstated it. It is not distinguishable *by the decoder's return value*; the
 * ordering property is assertable if the two checks are split into named functions. Not worth doing
 * — worth saying, because "untestable" invites the next reader to stop thinking.
 */
const MAX_CTRL_PAYLOAD_BYTES = 512;

// ─── Encode ───────────────────────────────────────────────────────────────────

export function encodeAuthChallenge(frame: RelayAuthChallenge): Uint8Array {
  return ENC.encode({ type: frame.type, nonce: frame.nonce });
}

export function encodeAuthFailed(frame: RelayAuthFailed): Uint8Array {
  // `retry_after_ms` rides only when present (rate_limited) — additive on the wire, same
  // convention as `hash_submit_error.detail` and `content_park_deposit_ack.retry_after_ms`.
  return ENC.encode({
    type: frame.type,
    reason: frame.reason,
    ...(frame.retry_after_ms !== undefined ? { retry_after_ms: frame.retry_after_ms } : {}),
    // DOD-M15-RELAYSLOTS-1: the slot-cap affordance. Same additive convention — present only for
    // `slot_cap_exceeded`, where the two numbers are what make the refusal actionable rather than
    // a dead end. See the fields' note on RelayAuthFailed.
    ...(frame.slots_held !== undefined ? { slots_held: frame.slots_held } : {}),
    ...(frame.slot_cap !== undefined ? { slot_cap: frame.slot_cap } : {}),
  });
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
  // `retry_after_ms` rides only when present (rate_limited) — DOD-M15-RELAYABUSE-1.
  return ENC.encode({
    type: frame.type,
    reason: frame.reason,
    ...(frame.detail ? { detail: frame.detail } : {}),
    ...(frame.retry_after_ms !== undefined ? { retry_after_ms: frame.retry_after_ms } : {}),
  });
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

// ─── DOD-M15-CORROBORATE-1: the witness alert ─────────────────────────────────

/**
 * Encode a `session_witness_alert`. Snake_case on the wire like every other relay frame, binary
 * `session_id`. `relay_id` rides only when this relay has a signing identity — additive, and a
 * recipient that cannot name the witness is told so by its absence rather than by a placeholder.
 */
export function encodeSessionWitnessAlert(frame: SessionWitnessAlert): Uint8Array {
  return ENC.encode({
    type: frame.type,
    session_id: frame.session_id,
    reason: frame.reason,
    ...(frame.relay_id !== undefined ? { relay_id: frame.relay_id } : {}),
    observed_at: frame.observed_at,
    submitter_is_counterparty: frame.submitter_is_counterparty,
    ...(frame.witness_signature !== undefined ? { witness_signature: frame.witness_signature } : {}),
  });
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

export type InboundRelayFrame = RelayAuthResponse | HashSubmit | SessionLivenessQuery | ClientRecordAssignment | SessionReplay;

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
    /**
     * DOD-M15-RELAYAUTH-1 review HIGH-1: `purpose: "reservation"` marks an auth whose ONLY job is
     * to prove key possession from THIS transport identity, so the relay can keep the peer's
     * circuit reservation. It must NOT claim the agent's delivery stream — see the dispatch in
     * relay-node.ts. Unknown/absent means the ordinary session auth, so an older client is
     * unaffected; an unrecognised value is treated as absent rather than refused, because the
     * failure mode of guessing wrong here is refusing a legitimate agent.
     */
    const purpose = o["purpose"] === "reservation" ? ("reservation" as const) : undefined;
    /**
     * DOD-M15-RELAYSLOTS-1: the directory-issued registration proof, carried through verbatim.
     *
     * A missing or non-binary field decodes to `undefined` rather than failing the whole frame, on
     * purpose: the relay then refuses with `online_token_required`, which reaches the operator and
     * says what to do. Failing the decode would abort the stream and leave them with a dead
     * connection and no reason — and it is the OMISSION case that an unmodified older client
     * produces, so it is the one that most needs to be explainable rather than silent.
     */
    const online_token = toUint8Array(o["online_token"]) ?? undefined;
    return {
      type: "relay_auth_response",
      pubkey,
      signature,
      ...(purpose ? { purpose } : {}),
      ...(online_token ? { online_token } : {}),
    };
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
      /**
       * ⚠️ IT MUST ACTUALLY BE A SEAL PAYLOAD — review H1, and this is the difference between the
       * safety property being TRUE and being merely CLAIMED.
       *
       * The guard used to be: ctrl leaf, non-empty, ≤512 bytes. Nothing required the bytes to be a
       * seal payload at all, so a client could put 512 bytes of the operator's message in a ctrl
       * leaf and this relay would take them. The type doc said "the relay already knows all four
       * fields, nothing is disclosed"; what the code enforced was "at most 512 arbitrary bytes per
       * close." A comment asserting a safety property the code does not have is the failure this
       * codebase has been correcting all week, and I wrote another one.
       *
       * Decoding it here also binds the payload to THIS session at the wire, instead of leaving a
       * `seal_payload_session_mismatch` for the directory to notice three hops later.
       */
      const payload = decodeSealPayload(cb);
      if (!payload) return null;
      if (payload.session_id.length !== session_id.length
          || !Buffer.from(payload.session_id).equals(Buffer.from(session_id))) return null;
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
    /**
     * 031-RELAYREPLAY. Read by TYPE, and `""` is kept rather than folded into `undefined`.
     *
     * They mean the same thing to `recordAssignment` — both produce the fresh (pre-031) TBS layout
     * — but a non-string is NOT quietly dropped to absent: it is refused with the rest of the
     * frame, because a client sending `prior_relay_id: 7` is not a client with an empty value, and
     * silently reading it as "fresh" would let a malformed resume through as an ordinary session.
     */
    const priorRaw = o["prior_relay_id"];
    if (priorRaw !== undefined && typeof priorRaw !== "string") return null;
    const prior_relay_id = priorRaw as string | undefined;
    return {
      type: "client_record_assignment",
      session_id,
      participant_a,
      participant_b,
      session_timestamp,
      initiator_session_peer_id,
      counterparty_session_peer_id,
      assignment_signature,
      ...(prior_relay_id !== undefined ? { prior_relay_id } : {}),
    };
  }

  // ─── 031-RELAYREPLAY: the replay batch ──────────────────────────────────────
  //
  // SHAPE ONLY. Nothing here is a trust decision — every field below is re-derived and verified in
  // `#processSessionReplay` against the directory-signed assignment. What this does is refuse a
  // frame whose bytes cannot be read at all, so a malformed batch is a named refusal rather than a
  // throw escaping into the stream handler.
  //
  // ⚠️ `counterparty_tip` IS DECODED LENIENTLY AND REFUSED STRICTLY, and the split is deliberate.
  // A missing or misshapen tip decodes to `undefined` and is then refused BY NAME by
  // `verifySessionTipAttestation` — rather than voiding the frame here, where the sender would get
  // "could not decode" and no idea which of six fields was wrong. Absent and wrong take the same
  // path either way; the difference is only whether the operator is told which one they sent.
  if (o["type"] === "session_replay") {
    const session_id = toUint8Array(o["session_id"]);
    const reported_root = toUint8Array(o["reported_root"]);
    if (!session_id || session_id.length !== 16) return null;
    if (!reported_root || reported_root.length !== 32) return null;
    const rawLeaves = o["leaves"];
    if (!Array.isArray(rawLeaves) || rawLeaves.length === 0 || rawLeaves.length > MAX_REPLAY_LEAVES) return null;
    const leaves: SealUnilateralLeaf[] = [];
    for (const entry of rawLeaves) {
      if (typeof entry !== "object" || entry === null) return null;
      const e = entry as Record<string, unknown>;
      const structure2_cbor = toUint8Array(e["structure2_cbor"]);
      const structure1_cbor = toUint8Array(e["structure1_cbor"]);
      const sequence_number = typeof e["sequence_number"] === "number" ? e["sequence_number"] : null;
      const leaf_kind = typeof e["leaf_kind"] === "number" ? e["leaf_kind"] : null;
      if (!structure2_cbor || structure2_cbor.length === 0) return null;
      if (!structure1_cbor || structure1_cbor.length === 0) return null;
      if (sequence_number === null || !Number.isInteger(sequence_number)) return null;
      if (leaf_kind === null) return null;
      const relay_id = typeof e["relay_id"] === "string" ? e["relay_id"] : undefined;
      const relay_timestamp = typeof e["relay_timestamp"] === "number" ? e["relay_timestamp"] : undefined;
      const relay_signature = e["relay_signature"] !== undefined ? toUint8Array(e["relay_signature"]) ?? undefined : undefined;
      /**
       * 🚨 NO `content_bytes` ON A REPLAY, ON ANY KIND. The relay's own submit path admits it for a
       * ctrl leaf because a SEAL payload is four values it already holds; a REPLAY carries a whole
       * conversation, and admitting leaf content here would hand a forwarding relay exactly what
       * INV-3 keeps from it. Refused rather than dropped, for the reason `hash_submit` refuses it:
       * a client offering the relay content it must never hold is not a tidy-up.
       */
      if (e["content_bytes"] !== undefined) return null;
      leaves.push({
        sequence_number,
        leaf_kind,
        structure2_cbor,
        structure1_cbor,
        ...(relay_id !== undefined ? { relay_id } : {}),
        ...(relay_timestamp !== undefined ? { relay_timestamp } : {}),
        ...(relay_signature !== undefined ? { relay_signature } : {}),
      });
    }
    let counterparty_tip: SessionTipAttestation | undefined;
    const rawTip = o["counterparty_tip"];
    if (typeof rawTip === "object" && rawTip !== null) {
      const t = rawTip as Record<string, unknown>;
      const pubkey = toUint8Array(t["pubkey"]);
      const root = toUint8Array(t["root"]);
      const signature = toUint8Array(t["signature"]);
      const last_seq = typeof t["last_seq"] === "number" ? t["last_seq"] : null;
      if (pubkey && root && signature && last_seq !== null) {
        counterparty_tip = { pubkey, last_seq, root, signature };
      }
    }
    return {
      type: "session_replay",
      session_id,
      reported_root,
      leaves,
      ...(counterparty_tip ? { counterparty_tip } : {}),
    };
  }

  return null;
}

/** The relay's answer to a replay batch. */
export function encodeSessionReplayResult(frame: SessionReplayResult): Uint8Array {
  return ENC.encode({
    type: "session_replay_result",
    session_id: frame.session_id,
    ok: frame.ok,
    ...(frame.reason !== undefined ? { reason: frame.reason } : {}),
    ...(frame.adopted_leaf_count !== undefined ? { adopted_leaf_count: frame.adopted_leaf_count } : {}),
    ...(frame.guidance !== undefined ? { guidance: frame.guidance } : {}),
  }) as Uint8Array;
}
