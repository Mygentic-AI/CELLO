/**
 * CELLO Relay Node — wire types and internal types (NODE-002)
 *
 * Frame protocol: /cello/relay/1.0.0
 * Framing: it-length-prefixed (unsigned varint per multiformats spec)
 * Encoding: canonical CBOR per RFC 8949 §4.2.1
 *
 * Auth domain string: "CELLO-RELAY-AUTH-v1"
 * Auth signature: Ed25519(SHA-256("CELLO-RELAY-AUTH-v1" || nonce || pubkey), privkey)
 *   per RFC 8032 (Ed25519) and FIPS 180-4 (SHA-256)
 */

import type { Structure2 } from "@cello-protocol/protocol-types";
import { msgLeafHash, ctrlLeafHash, docLeafHash, rejectLeafHash } from "@cello-protocol/crypto";

// ─── Leaf kinds (DOD-DOC-LEAF-1) ─────────────────────────────────────────────

/** The leaf domains this relay witnesses. Domain-separated per RFC 6962 §2.1. */
export type RelayLeafKind = "msg" | "ctrl" | "doc" | "reject";

/**
 * Wire byte → domain. The ONLY mapping; a second copy is how the byte and the hash drift.
 *
 * 0x01 is deliberately absent and must never be added: it is the RFC 6962 internal-node
 * prefix, so a 64-byte leaf hashed under it is byte-identical to nodeHash(left, right) and
 * forges tree shape (§2.1.3). An unlisted byte is REFUSED, never coerced — coercion would
 * hash the leaf under a domain its sender did not use, diverging the two parties' roots.
 */
export const RELAY_LEAF_KINDS: Readonly<Record<number, RelayLeafKind>> = {
  0x00: "msg",
  0x02: "ctrl",
  0x04: "doc",
  0x05: "reject",
};

/** Domain → leaf-hash function. Must stay consistent with RELAY_LEAF_KINDS. */
export const RELAY_LEAF_HASHERS: Readonly<Record<RelayLeafKind, (data: Uint8Array) => Uint8Array>> = {
  msg: msgLeafHash,
  ctrl: ctrlLeafHash,
  doc: docLeafHash,
  reject: rejectLeafHash,
};

// ─── Auth frame types ─────────────────────────────────────────────────────────

export interface RelayAuthChallenge {
  type: "relay_auth_challenge";
  nonce: Uint8Array; // 32 bytes, CSPRNG
}

export interface RelayAuthResponse {
  type: "relay_auth_response";
  pubkey: Uint8Array;    // 32-byte Ed25519 K_local public key
  signature: Uint8Array; // 64-byte Ed25519 signature over "CELLO-RELAY-AUTH-v1" || nonce || pubkey
}

export type AuthFailedReason =
  | "nonce_expired"
  | "nonce_unknown"
  | "nonce_reused"
  | "signature_invalid";

export interface RelayAuthFailed {
  type: "relay_auth_failed";
  reason: AuthFailedReason;
}

export interface RelayAuthOk {
  type: "relay_auth_ok";
}

// ─── Data frame types ─────────────────────────────────────────────────────────

export interface HashSubmit {
  type: "hash_submit";
  session_id: Uint8Array;   // 16 bytes
  leaf_kind: number;        // see RELAY_LEAF_KINDS — the authoritative byte→domain map
  structure1_cbor: Uint8Array; // canonical CBOR of Structure 1
  sender_signature: Uint8Array; // 64-byte Ed25519 signature — same as inside structure1_cbor
  /**
   * The SEAL payload bytes — `DOD-M15-SEALWIRE-1` bullets 3+4. **CTRL LEAVES ONLY.**
   *
   * 🚨 THIS IS THE ONE FIELD THAT CARRIES LEAF CONTENT TO A RELAY, AND THE RELAY IS THE PARTY THIS
   * PROTOCOL EXISTS TO KEEP CONTENT AWAY FROM (INV-3). It is admissible for a ctrl leaf and for no
   * other kind, and the reason is narrow rather than general. A SEAL payload is
   * `[session_id, final_root, close_timestamp, "PENDING"]`:
   *   - `session_id` is already on this very frame;
   *   - `final_root` is the root over the NON-ctrl leaves, every one of which the relay sequenced —
   *     it can derive this itself, which is exactly what makes the directory's comparison meaningful;
   *   - `"PENDING"` is a constant.
   *
   * ⚠️ THIS USED TO SAY "the relay already knows all four", AND THE FOURTH IS NOT ONE OF THEM.
   * `close_timestamp` is the CLIENT's local clock at close, distinct from the relay's own stamp, so
   * what it discloses is the client's clock offset — single-digit milliseconds in practice, and I
   * judge that negligible against what this field buys. But "negligible" and "nothing" are different
   * claims and only one of them was true, so the sentence says three-known-plus-a-clock-offset now.
   *
   * ⚠️ AND THE BYTES ARE DECODED AS A SEAL PAYLOAD AT THE WIRE (review H1). Without that the
   * reasoning above describes a payload while the code accepts any 512 bytes, which is not the same
   * property at all.
   *
   * **That reasoning does not survive one leaf kind further.** A `msg` leaf's content is the
   * operator's plaintext; a `doc` leaf's is their document. `decodeInboundFrame` therefore REFUSES
   * the whole frame when this field appears on any non-ctrl leaf, at the wire boundary — not
   * downstream, because by then the bytes have been received and possibly written to a WAL.
   *
   * Why it must travel at all: the directory cannot check the relay against anything the relay
   * supplied. `final_root` is the client's own signed claim and is the only value that breaks that
   * circle — and it survives solely inside a SHA-256 pre-image the client never sends. See
   * `packages/directory/src/seal-final-root.ts`.
   */
  content_bytes?: Uint8Array;
  /**
   * FEDERATION-003 AC-005/AC-006/SI-002: Predecessor relay ACK for re-submission.
   *
   * When a client re-submits a hash to a new relay after the original relay went down,
   * the client includes the ACK it received from the predecessor relay. The new relay
   * uses this to verify the predecessor's signature before issuing its own ACK.
   *
   * If predecessor_relay_id is set, the new relay MUST verify the predecessor ACK:
   *   - Fetch predecessor's public key from directory via getRelayPublicKey(predecessor_relay_id)
   *   - If not found: reject with RELAY_PREDECESSOR_UNKNOWN (SI-002)
   *   - Verify Ed25519.verify(pubKey, buildRelayAckTbs(hash, seq, ts), predecessor_relay_signature)
   *   - If invalid: reject with RELAY_PREDECESSOR_UNKNOWN (SI-002 — no fallback)
   *
   * If predecessor_relay_id is absent: treated as a first submission (no predecessor verification).
   */
  predecessor_relay_id?: string;
  predecessor_relay_signature?: Uint8Array; // 64-byte Ed25519 ACK signature from predecessor
  predecessor_relay_sequence?: number;       // sequence_number from predecessor ACK
  predecessor_relay_timestamp?: number;      // timestamp from predecessor ACK
}

export interface LeafDeliver {
  type: "leaf_deliver";
  session_id: Uint8Array;       // 16 bytes
  leaf_kind: number;             // see RELAY_LEAF_KINDS
  sequence_number: number;       // MSG-004: seq from Structure 2; client uses this to update last_seen_seq without decoding structure2_cbor
  structure2_cbor: Uint8Array;
  structure1_cbor: Uint8Array;  // MSG-004: exact bytes sender signed; receiver needs last_seen_seq + timestamp
}

// ─── Error response types ─────────────────────────────────────────────────────

export type HashSubmitErrorReason =
  | "session_not_found"
  | "not_a_participant"
  | "leaf_kind_invalid"
  | "signature_invalid"
  | "sender_mismatch"
  | "last_seen_seq_ahead"
  /**
   * DOD-M15-TERMINAL-REASON-1 — three answers where there was one, because the one was wrong.
   *
   * `session_sealed` was returned for EVERY non-active status, and it was never true of either of
   * them. A refused seal is the opposite of sealed, and an in-flight one has not sealed yet. Worse,
   * a session that genuinely sealed is not in this branch at all — `confirmSeal` destroys it, so it
   * answers `session_not_found` — which made the two answers exactly inverted: success reported as
   * "not found", failure reported as "sealed".
   *
   * `session_sealed` is KEPT in the union rather than removed: it is what older relays still send,
   * and a client that meets it should treat it as the ambiguous legacy value it always was.
   */
  | "session_sealed"
  /** A directory read the seal and REFUSED it. Terminal, and there is no receipt. */
  | "seal_refused"
  /**
   * A seal is in flight — nothing notarized yet, and it may still succeed.
   *
   * DEFENSIVE, and honestly labelled: a client cannot normally observe this, because `hash_submit`
   * serializes per session (`await prev`) and adjudication runs inside that lock, so a concurrent
   * submission blocks until the seal resolves and then sees the outcome. It exists so the branch
   * cannot silently fall back to the wrong word if the lock is ever released earlier, and because
   * `DOD-M15-TRANSPORT-TERMINAL-1` made `sealing` a state a session can leave as well as enter.
   */
  | "seal_in_progress"
  /** FEDERATION-003 AC-006/SI-002: predecessor relay ACK could not be verified */
  | "RELAY_PREDECESSOR_UNKNOWN"
  /**
   * `DOD-M15-SEALWIRE-1` — the frame carried leaf content this relay will not hold.
   *
   * ⚠️ THIS EXISTS BECAUSE THE REFUSAL WAS OTHERWISE INVISIBLE TO THE CLIENT, and what filled the
   * gap was worse than silence. The relay refused by sending nothing; the client raced its ack
   * against a 10-second timeout, resolved `relay_submit_timeout`, and then RESET THE STREAM — which
   * is shared by every session that agent holds on this relay. So one refused frame stalled a send
   * for ten seconds, dropped every other conversation's stream, and put a transport word on the
   * screen for a deliberate policy decision made on a different machine.
   *
   * Terminal and immediate: re-sending the same frame cannot succeed, so a timeout is the wrong
   * shape as well as the wrong word.
   */
  | "content_not_permitted"
  /**
   * The submit could not be decoded, and it carried no `content_bytes` — so it is a malformed frame
   * rather than a content-policy refusal.
   *
   * ⚠️ THIS EXISTS BECAUSE `content_not_permitted` WAS ANSWERING FOR NINE CONDITIONS. A submit with a
   * short signature or an empty `structure1_cbor` was told it had violated a content policy, on a
   * frame with no content in it — a label for where the failure surfaced standing in for what went
   * wrong. Splitting them costs one union member and is the difference between a client author
   * checking their signature and a client author auditing a rule they never broke.
   */
  | "submit_malformed";

export interface HashSubmitError {
  type: "hash_submit_error";
  reason: HashSubmitErrorReason;
  /**
   * The UPSTREAM cause, when the relay has one — e.g. the directory's `merkle_root_mismatch` behind
   * a `seal_refused`. Optional: most refusals are self-explanatory, and an older client ignores an
   * unknown field. Invariant 3 — `reason` is the class, `detail` is what happened.
   */
  detail?: string;
}

export interface HashSubmitAck {
  type: "hash_submit_ack";
  sequence_number: number;
  /**
   * PERSIST-012: Stable identifier for the signing relay.
   * Allows the client (and future relays) to look up the relay's public key
   * for ACK signature verification. Absent when relay has no signing key.
   */
  relay_id?: string;
  /**
   * PERSIST-012: 64-byte Ed25519 signature over SHA-256(hash_bytes || seq_BE4 || ts_BE8).
   * Signed by the relay's signing key (not the transport key).
   * Absent when relay has no signing key configured.
   */
  relay_signature?: Uint8Array;
  /**
   * PERSIST-012: Unix ms timestamp embedded in the ACK TBS.
   * Required for deterministic signature reconstruction by the client.
   * Absent when relay has no signing key configured.
   */
  timestamp?: number;
  /**
   * DOD-MSG-4 (self-ordering content frame): the full CBOR-encoded Structure2 the relay just
   * committed for this leaf — the SAME record it delivers to the counterparty via leaf_deliver.
   * Returned to the SENDER so it can stamp the signed ordering record into its content frame, so the
   * receiver verifies + orders from the content frame alone (no dependence on the leaf_deliver stream).
   */
  structure2_cbor?: Uint8Array;
}

// ─── SessionAssignment (from directory, in-process call) ─────────────────────

export interface SessionAssignment {
  session_id: Uint8Array;         // 16 bytes
  participant_a: Uint8Array;      // 32-byte K_local pubkey
  participant_b: Uint8Array;      // 32-byte K_local pubkey
  session_timestamp: number;      // Unix ms
  directory_signature: Uint8Array; // 64-byte Ed25519 over canonical CBOR of assignment fields
  /**
   * M7-WIRE-001 AC-009: Initiator's ephemeral session Peer ID for relay binding.
   * When present, the relay verifies the connecting peer's libp2p Peer ID matches.
   */
  initiator_session_peer_id?: string;
  /**
   * M7-WIRE-001 AC-009: Counterparty's ephemeral session Peer ID for relay binding.
   * When present, the relay verifies the connecting peer's libp2p Peer ID matches.
   */
  counterparty_session_peer_id?: string;
  /**
   * M7-WIRE-001 AC-009: Transport mode for this session.
   * 'direct' — clients attempt direct P2P; relay is fallback only.
   * 'relay' — clients route all traffic through the relay.
   */
  transport_mode?: "direct" | "relay";
}

// ─── Internal relay session state ────────────────────────────────────────────

export type SessionStatus = "active" | "sealing" | "seal_rejected";

export interface RelaySessionState {
  /**
   * DOD-M15-SUBMIT-ID-1 — acks already issued, keyed by `<senderHex>:<submissionIdHex>`.
   *
   * A retransmission is answered from here instead of being given a new canonical position. Keyed by
   * SENDER as well as id so two participants cannot collide by minting the same id, and scoped to
   * the session so it dies with it — a retry only means anything inside the conversation it belongs
   * to, and the relay keeps no session state past the seal.
   *
   * Optional so existing persisted state loads unchanged.
   */
  issued_acks?: Map<string, import("./relay-types.js").HashSubmitAck>;
  assignment: SessionAssignment;
  genesis_prev_root: Uint8Array; // SHA-256(sorted(A,B) || session_id || session_timestamp)
  seq_counter: number;           // 0 initially; incremented to 1 on first leaf
  /**
   * Ordered. `content_bytes` is the ctrl leaf's SEAL payload when the submitting client carried one
   * (`DOD-M15-SEALWIRE-1` bullets 3+4) — stored so it reaches the directory in `SealData`, which is
   * the only way the directory can check a certified root against a CLIENT SIGNATURE rather than
   * against the relay's own arithmetic.
   *
   * Admissible on ctrl leaves alone, and the wire decoder is what enforces that — see
   * `HashSubmit.content_bytes`. Nothing here re-checks it, deliberately: a second, weaker copy of a
   * security rule is how the two ends of a hop drift apart.
   */
  leaf_log: Array<{ kind: RelayLeafKind; s2: Structure2; structure1_cbor: Uint8Array; content_bytes?: Uint8Array }>;
  status: SessionStatus;
  /**
   * The DIRECTORY's reason for refusing the seal, when the status is `seal_rejected`.
   *
   * `rejectSeal` took the cause and discarded it (`_reason`), so a participant learned only that a
   * refusal happened. Invariant 3: the upstream cause survives downstream.
   */
  seal_rejected_reason?: string;
  /**
   * RFC 6962 incremental stack. Each entry is the root of a complete 2^height-leaf subtree.
   * Invariant: entries are in ascending height order; no two entries share the same height.
   * Used to compute the running Merkle root in O(log n) per append.
   */
  tree_stack: Array<{ hash: Uint8Array; height: number }>;
  /**
   * Merkle root of all leaves appended so far.
   * Equals genesis_prev_root before the first leaf.
   * Updated after each leaf append via the incremental stack.
   */
  running_root: Uint8Array;
  /**
   * CELLO-M6B-009: Unix ms timestamp when this session was last written.
   * Set to Date.now() on recordSession() and updated on each setSession() call.
   * Used by the idle sweep to identify abandoned sessions.
   */
  lastActivityAt: number;
}

// ─── Seal interface ────────────────────────────────────────────────────────────

export interface SealData {
  // `content_bytes` rides along on ctrl leaves — the client-signed SEAL payload the directory needs
  // to break the circularity of checking a relay against the relay's own numbers.
  leaves: Array<{ kind: RelayLeafKind; s2: Structure2; structure1_cbor: Uint8Array; content_bytes?: Uint8Array }>;
  seq_count: number;
  merkle_root: Uint8Array;
}

// ─── CELLO-M7-SESSION-003: session-path liveness frames ────────────────────────

export interface SessionLivenessQuery {
  type: "session_liveness_query";
  session_id: Uint8Array;          // 16 bytes
  counterparty_pubkey: Uint8Array; // 32 bytes — recipient whose liveness is queried
}

export interface SessionLivenessResponse {
  type: "session_liveness_response";
  session_id: Uint8Array;
  counterparty_pubkey: Uint8Array;
  liveness: "alive" | "gone" | "unknown";
  observed_at: number;
}

/**
 * FED-OPTIONB-SETUP-001 (Option B, any-relay/any-directory): the CLIENT presents the
 * directory-signed session assignment to its chosen relay over its already-authenticated client
 * stream, replacing the old directory→relay `recordAssignment` dial. Unlike the directory-ADMIN
 * `record_assignment` frame (which requires a body-level `directory_signature` only the directory can
 * produce), this frame carries NO admin auth — the client cannot impersonate the directory. Its
 * authority is `assignment_signature`: the per-node directory signature over the relay TBS
 * ([session_id, participant_a, participant_b, session_timestamp, (initiator_peer_id,
 * counterparty_peer_id)]). The relay verifies it against ANY consortium directory pubkey, so any
 * sovereign directory can grant relay service.
 */
export interface ClientRecordAssignment {
  type: "client_record_assignment";
  session_id: Uint8Array;            // 16 bytes
  participant_a: Uint8Array;         // 32-byte initiator pubkey
  participant_b: Uint8Array;         // 32-byte counterparty pubkey
  session_timestamp: number;         // Unix ms
  initiator_session_peer_id?: string;
  counterparty_session_peer_id?: string;
  assignment_signature: Uint8Array;  // 64-byte per-node directory sig over the relay TBS (relayDirSig)
}
