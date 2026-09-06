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
// 031-RELAYREPLAY: the leaf shape and the tip attestation are defined ONCE, in the package the
// directory and this relay both import — never mirrored here. See `seal-chain-verify.ts`.
import type { SealUnilateralLeaf, SessionTipAttestation } from "@cello-protocol/interfaces";

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
  /**
   * DOD-M15-RELAYAUTH-1: `"reservation"` proves key possession from THIS transport identity so the
   * relay keeps this peer's circuit reservation, and does nothing else. Absent (the default) is the
   * ordinary session auth, which additionally registers this stream as the agent's delivery target.
   *
   * ⚠️ The distinction exists because an agent legitimately runs SEVERAL nodes against one relay —
   * the node promoted into a session, plus the replacement standing receiver behind it. Both must
   * prove possession (each holds its own reservation), but only ONE may own the delivery stream.
   * Without this flag the replacement receiver's auth silently stole delivery from the live
   * session; with it, the replacement proves itself and leaves delivery alone.
   */
  purpose?: "reservation";
  /**
   * DOD-M15-RELAYSLOTS-1: the directory-issued proof that `pubkey` belongs to a REGISTERED agent,
   * minted when the directory marked that agent online. Opaque bytes to the client, which carries
   * them from its signaling auth acknowledgement to here without reading them.
   *
   * ⚠️ Optional on the TYPE, required by the relay. It is optional here because an older client
   * simply does not send the field, and the relay must be able to decode that frame in order to
   * refuse it with a reason the operator can act on — a decode failure would abort the stream and
   * tell them nothing. See `online_token_required` below.
   */
  online_token?: Uint8Array;
}

export type AuthFailedReason =
  | "nonce_expired"
  | "nonce_unknown"
  | "nonce_reused"
  | "signature_invalid"
  /** DOD-M15-RELAYABUSE-1: per-peer or per-claimed-pubkey auth attempt rate exceeded. */
  | "rate_limited"
  /**
   * DOD-M15-RELAYSLOTS-1 — the online-token refusals.
   *
   * Signing the relay's challenge proves possession of a keypair, and keypairs are free: without
   * this check an attacker mints one per slot and takes the whole reservation table while every
   * request looks well-formed. These reasons travel back to the operator AND are branched on by the
   * daemon deciding whether another relay would do any better, so they are enumerated rather than
   * collapsed into one code.
   */
  /** No `online_token` at all. A pre-token client, or a keypair that never registered. */
  | "online_token_required"
  /** Not the right length. Refused before anything is read out of it. */
  | "online_token_malformed"
  /** Well-formed, but no directory key this relay holds signed it. */
  | "online_token_signature_invalid"
  /** Signed, but past its expiry. The client refreshes over its directory stream and retries. */
  | "online_token_expired"
  /** Signed and unexpired, claiming a lifetime beyond what this relay will honour. */
  | "online_token_lifetime_too_long"
  /**
   * The token names a DIFFERENT key from the one that just completed the challenge. This is the
   * refusal that stops a lifted token being a bearer pass for any throwaway key.
   */
  | "online_token_pubkey_mismatch"
  /**
   * This relay holds no directory public key, so it cannot verify anything and refuses everyone.
   * A relay-side fault, not the caller's: the daemon should try a different relay.
   */
  | "online_token_no_directory_key"
  /**
   * DOD-M15-RELAYSLOTS-1: this agent already holds the most reservation slots one agent may hold
   * here, and none of them was idle enough to reclaim. Carries `slots_held` and `slot_cap`.
   *
   * A different relay WOULD grant this — but doing that quietly papers over leaked sessions and the
   * same wall arrives on the next relay, so the daemon surfaces it rather than spreading it.
   */
  | "slot_cap_exceeded";

export interface RelayAuthFailed {
  type: "relay_auth_failed";
  reason: AuthFailedReason;
  /**
   * DOD-M15-RELAYABUSE-1: milliseconds until the caller's rate-limit window clears. Present only
   * when `reason` is `rate_limited` — the relay knows when the window resets, so it says so rather
   * than leaving the caller to guess a retry interval.
   */
  retry_after_ms?: number;
  /**
   * DOD-M15-RELAYSLOTS-1: how many reservation slots this agent currently holds on this relay, and
   * the most one agent may hold. Present only when `reason` is `slot_cap_exceeded`.
   *
   * ⚠️ These two numbers ARE the affordance, and without them the refusal is a dead end. People do
   * not know what sessions they have open — sessions fall apart and sit there, idle and unreachable
   * and still counted — so anyone who hits this cap will believe they have nothing open. A bare
   * reason code tells them the product is broken; "you hold 32 of a maximum 32" tells them what to
   * go and close.
   */
  slots_held?: number;
  slot_cap?: number;
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
   * 033-ACKEMIT — the claim's `last_seen_hash` names content this relay did not record at the
   * position the claim names.
   *
   * SEPARATE FROM `signature_invalid`, and the distinction is the point: the signature verified, the
   * signer is a participant, and the leaf is well formed. What is wrong is the sender's account of
   * what they had SEEN — which is the one thing a position-only acknowledgement could never express
   * and therefore could never contradict.
   *
   * Carries a `detail` naming what was OBSERVED ("the acknowledged hash does not match the message
   * at that position") and never an inferred conclusion about the sender.
   */
  | "ack_hash_mismatch"
  /**
   * 033-ACKEMIT — this relay's sequence counter reaches the acknowledged position and its leaf log
   * does not, so it cannot check the claim.
   *
   * A FAULT ON THE RELAY, named apart from a mismatch so nobody is sent to ask their counterparty
   * about it. Unreachable while the counter and the log are advanced together; named because an
   * event that lies about its cause is worse the day it does fire.
   */
  | "ack_hash_unverifiable"
  /**
   * 034-CARRYLEAF — a participant tried to witness a leaf their counterparty authored, and this
   * relay already holds that leaf from that author.
   *
   * A counter-submit exists to catch up a leaf its author failed to witness, so one already
   * witnessed is a replay: Structure 1 binds the author, the content and the session but NOT a
   * position, so admitting it would let a participant consume a second canonical position with a
   * message their counterparty really did sign, at a place they never sent it.
   */
  | "counter_submit_duplicate"
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
   * 031-RELAYREPLAY — this relay inherited the conversation and has not been given its history.
   *
   * A submit here would be chained to this relay's genesis root and numbered 1, producing a validly
   * signed leaf in the wrong place. The remedy is one frame away, so this is a refusal with a next
   * step, not a queue: send `session_replay` first.
   */
  | "session_awaiting_replay"
  /**
   * 031-RELAYREPLAY (D5) — the two accounts of this conversation disagree about a message BOTH
   * sides hold. Terminal: this relay will not witness it, and nothing clears the state.
   *
   * A THIRD answer rather than a shade of `seal_in_progress`, for the reason
   * `DOD-M15-TERMINAL-REASON-1` split the other two: telling an operator to wait for a seal that
   * can never come is worse than telling them nothing.
   */
  | "session_diverged"
  /**
   * `DOD-M15-SELFCHAIN-1` — the submitter's link to their OWN previous message does not match what
   * this relay recorded as their last one.
   *
   * ⚠️ NAMES WHAT WAS OBSERVED, NEVER A CONCLUSION. The same signal is produced by a peer
   * reordering a conversation and by a client whose own chain record went out of step after a
   * restart, and this relay cannot tell them apart. The refusal escalates — the counterparty is
   * told by the witness — but the wording never attributes intent.
   */
  | "self_chain_mismatch"
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
  | "submit_malformed"
  /** DOD-M15-RELAYABUSE-1: per-peer or per-sender-pubkey hash_submit rate exceeded. */
  | "rate_limited"
  /**
   * DOD-M15-CORROBORATE-1: the leaf verified against NEITHER participant key in this session's
   * directory-signed assignment, checked at arrival. It replaces the `signature_invalid` this case
   * used to get: that word said the frame was internally inconsistent, when what actually happened
   * is that nobody in this conversation signed those bytes. The participants other than the
   * submitter are told separately (`session_witness_alert`).
   */
  | "leaf_signed_by_neither_participant"
  /**
   * DOD-M15-CORROBORATE-1 review F6: the leaf's own `structure1.session_id` names a DIFFERENT
   * session from the frame's. The signature is real; it was made over another conversation's leaf,
   * and sequencing it here would place a message in a transcript it was never written for.
   */
  | "leaf_session_mismatch";

export interface HashSubmitError {
  type: "hash_submit_error";
  reason: HashSubmitErrorReason;
  /**
   * The UPSTREAM cause, when the relay has one — e.g. the directory's `merkle_root_mismatch` behind
   * a `seal_refused`. Optional: most refusals are self-explanatory, and an older client ignores an
   * unknown field. Invariant 3 — `reason` is the class, `detail` is what happened.
   */
  detail?: string;
  /**
   * DOD-M15-RELAYABUSE-1: milliseconds until the caller's rate-limit window clears. Present only
   * when `reason` is `rate_limited`, mirroring `content_park_deposit_ack`'s own field — the relay
   * knows when the window resets, so throttling is distinguishable from an outage.
   */
  retry_after_ms?: number;
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
  /**
   * 031-RELAYREPLAY — the relay that witnessed this conversation up to the handover.
   *
   * 🚨 THIS IS THE ONLY WAY A RELAY CAN LEARN ANOTHER RELAY'S IDENTITY, and that is the whole
   * design. A relay holds no relay roster — only `CELLO_DIRECTORY_PUBKEYS` — so the predecessor's
   * id has to arrive somewhere unforgeable, and the directory-signed assignment TBS is the only
   * such place. It decides whose ACK receipts a replayed chain is judged against; a client that
   * could name its own predecessor would be choosing its own auditor.
   *
   * Non-empty ⇒ this is a RESUME and the relay must know it BEFORE the first frame arrives,
   * otherwise the first replayed leaf looks like message 1 of a brand-new conversation.
   *
   * ⚠️ ABSENT AND `""` BOTH MEAN "fresh", AND THEY PRODUCE THE SAME TBS BYTES — see
   * `recordAssignment`. A resume adds a SEVENTH field to the signed layout; a fresh session's
   * layout is byte-identical to what it was before this order, so no existing client breaks and
   * no client can promote its own session to a resume.
   */
  prior_relay_id?: string;
}

// ─── Internal relay session state ────────────────────────────────────────────

/**
 * `diverged` — 031-RELAYREPLAY, reconciliation rule D5.
 *
 * Two accounts of the same session disagreed about content at a position BOTH sides already hold.
 * That is not a reconciliation case; it is the attack a witness exists to prevent, so the session
 * is unsealable and stays that way. Nothing clears it: a relay that could be talked out of a
 * divergence verdict is a relay whose verdict is worth nothing.
 */
export type SessionStatus = "active" | "sealing" | "seal_rejected" | "diverged";

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
   * 031-RELAYREPLAY — set on `recordAssignment` when the directory-signed assignment names a prior
   * relay, and it is what makes this session a RESUME.
   *
   * Two consumers, and both of them refuse rather than tolerate:
   *   - `#processSessionReplay` verifies the batch's ACK receipts against THIS id and nothing else;
   *   - `#processHashSubmit` refuses a submit while `awaiting_replay` is true, because appending to
   *     a session whose inherited history has not arrived would chain the new leaf to a genesis
   *     root that is not this conversation's frontier.
   */
  prior_relay_id?: string;
  /**
   * 031-RELAYREPLAY — true from the moment a resume assignment is recorded until a replay batch has
   * been VERIFIED and adopted. Never set on an ordinary session.
   */
  awaiting_replay?: boolean;
  /** 031-RELAYREPLAY (D5) — why this session was marked diverged. Set with `status: "diverged"`. */
  diverged_reason?: string;
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
 * DOD-M15-CORROBORATE-1 — what this relay saw, told to the participants who did not send it.
 *
 * Emitted when a submitted leaf verifies against NEITHER key in the session's directory-signed
 * assignment. It is an OBSERVATION, not a verdict: it says this relay refused that submission and
 * nothing else, because one relay is one witness. The recipient is every participant OTHER than the
 * authenticated submitter — the submitter already has the `hash_submit_error`, and the whole point
 * is that the other side learns it from a party the submitter's client cannot silence.
 *
 * No pubkey of the submitter rides here. `submitter_is_counterparty` is the only fact the recipient
 * needs to act, and naming a key would turn an observation into an accusation this relay has no
 * standing to make alone.
 */
export interface SessionWitnessAlert {
  type: "session_witness_alert";
  session_id: Uint8Array;            // 16 bytes
  /**
   * 031-RELAYREPLAY widened this from a single literal to two, and it stays a CLOSED union for the
   * reason it was closed to begin with: a free-form reason lets a new code slip past every test in
   * its own guard file, and the client refuses an alert whose reason it cannot name.
   *
   * `replay_chain_diverged` — the two accounts of one conversation disagree about a message both
   * sides hold (reconciliation rule D5). Sent to the party that did NOT submit the batch, because
   * they are the one who would otherwise hear it only from the party it accuses.
   */
  reason:
    | "leaf_signed_by_neither_participant"
    | "replay_chain_diverged"
    /**
     * `DOD-M15-SELFCHAIN-1` — a submitted message's link to its own author's previous message does
     * not match this relay's record of it, so the ORDER of the conversation is in dispute.
     *
     * Sent to the party that did NOT submit, for the same reason `replay_chain_diverged` is: an
     * accusation routed through the party it is about is not evidence. It names what was OBSERVED
     * and never a conclusion — a client whose own chain record went out of step after a restart
     * produces this signal exactly as a reordering attempt does, and this relay cannot tell them
     * apart.
     */
    | "self_chain_broken"
    /**
     * 034-CARRYLEAF — a participant witnessed a leaf their COUNTERPARTY authored and did not submit.
     *
     * The relay is the only party positioned to state this: it is the one that knows the author
     * never asked for the leaf to be witnessed, and it is not a party to the conversation. **Both
     * participants are told**, and the same observation means different things to each — which is
     * why the message is composed at the daemon, from `submitter_is_counterparty`, rather than here:
     *
     *  - to the WITNESS: your counterparty did not put this message in the record; you did it for
     *    them. Once is a relay hiccup. Repeatedly is someone keeping their words out of the receipt.
     *  - to the AUTHOR: a message of yours was witnessed by your counterparty because your own
     *    submit never arrived — worth knowing, because it is usually your relay path failing.
     *
     * Signed like every other witness alert, so the recipient holds something transferable rather
     * than this relay's unsupported word.
     */
    | "leaf_witnessed_by_counterparty";
  /** WHICH witness. Absent when this relay runs without a signing identity. */
  relay_id?: string;
  /** Unix ms at which this relay observed the submission. */
  observed_at: number;
  /** True iff the authenticated submitter was the recipient's counterparty; false = a third party. */
  submitter_is_counterparty: boolean;
  /**
   * The relay's own signature over this observation — review F3, and the difference between a
   * witness and a rumour.
   *
   * Without it the recipient cannot show anyone what the relay said: "the relay told me" is exactly
   * as unverifiable as the accusation this unit exists to corroborate. `relay_id` is the hex of the
   * key that signs it (the same key behind every `hash_submit_ack`), so a recipient — or anyone they
   * later show this to — checks it the way an ack receipt is checked.
   *
   * Absent only when this relay has no signing identity at all. A relay that DECLARES a `relay_id`
   * and omits this is refused by the client: a claimed identity has to be proven, or omitting the
   * proof is the cheapest way to dodge it.
   */
  witness_signature?: Uint8Array;
}

/**
 * FED-OPTIONB-SETUP-001 (Option B, any-relay/any-directory): the CLIENT presents the
 * directory-signed session assignment to its chosen relay over its already-authenticated client
 * stream, replacing the old directory→relay `recordAssignment` dial. Unlike the retired
 * directory-ADMIN `record_assignment` frame (removed by DOD-M15-RELAYADMIN-DEAD-FRAMES-1; it
 * required a body-level `directory_signature` only the directory could produce), this frame
 * carries NO admin auth — the client cannot impersonate the directory. Its
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
  /**
   * 031-RELAYREPLAY — forwarded VERBATIM from the directory-signed assignment; see
   * `SessionAssignment.prior_relay_id`. The client is a courier for this field, not its author: a
   * value the directory did not sign makes the relay rebuild a seven-field TBS the signature does
   * not cover, and the assignment is refused with `directory_signature_invalid`.
   *
   * Nothing sends it yet — the client half is unit 3 of `M15-STORY-RELAYHANDOVER`.
   */
  prior_relay_id?: string;
}

// ─── 031-RELAYREPLAY: the replay batch ────────────────────────────────────────

/**
 * A conversation handed to a relay that did not witness its beginning.
 *
 * Accepted ONLY against a session recorded from a resume assignment (a non-empty, directory-signed
 * `prior_relay_id`), and adopted only when every check in `#processSessionReplay` holds. There is
 * no partial adoption: a partially-verifying chain is a refused chain, never silently truncated to
 * the part that did verify.
 *
 * ⚠️ NOTHING PRODUCES ONE. This unit is the READER; the client that builds a batch is unit 3. The
 * reader lands first on purpose — the relay must be able to refuse the new shape before any client
 * is allowed to depend on it being read.
 */
export interface SessionReplay {
  type: "session_replay";
  session_id: Uint8Array;   // 16 bytes
  /** The submitting party's own claimed content-hash root over all `leaves`. */
  reported_root: Uint8Array; // 32 bytes
  /** Both parties' signed leaves for this session, in canonical order (sequences exactly 1..N). */
  leaves: SealUnilateralLeaf[];
  /**
   * The COUNTERPARTY's signed tip. Typed optional because a frame can arrive without it and this
   * relay must then say so by name — NOT because absence is tolerated. See
   * `verifySessionTipAttestation`: contiguity cannot see a cut tail, and this is the only thing
   * that can.
   *
   * ⚠️ `undefined` HERE MEANS THE FIELD WAS NOT SENT, and nothing else — review H7. A tip that WAS
   * sent and is unreadable arrives with whatever decoded and is refused as MALFORMED. Reporting a
   * mangled attestation as an absent one sent an operator to ask their counterparty for a fresh
   * attestation when the fault was in their own encoder.
   */
  counterparty_tip?: SessionTipAttestation;
}

/** The relay's answer to a `session_replay`. `reason` is present iff `ok` is false. */
export interface SessionReplayResult {
  type: "session_replay_result";
  session_id: Uint8Array;
  ok: boolean;
  reason?: string;
  /** How many leaves this relay adopted, on success. */
  adopted_leaf_count?: number;
  /** Invariant 4 — every failure and waiting state names what to do next. */
  guidance?: string;
}

/**
 * DOD-M15-SWEEP-1 re-review item 1: the result of asking the directory for a relay's registered
 * public key.
 *
 * The point of the type is the second line: **`not_registered` is a directory VERDICT; everything
 * else is a failure to obtain one.** Before this existed, the lookup returned `string | undefined`
 * and the caller had no way to tell "the directory says it has no key for that relay" from "this
 * relay cannot reach its directory" — so an operator debugging a dead network link was told a relay
 * was unregistered.
 */
export type RelayPubkeyLookup =
  | { ok: true; publicKeyHex: string }
  | {
      ok: false;
      /**
       * `not_registered` — the directory answered and holds no key for this relay. A real answer.
       * Everything below means no answer was obtained, and must never be reported as "unregistered":
       * `no_transport` (this adapter has no node), `no_response` (stream closed with no frame),
       * `unexpected_response` (a frame arrived, but not the one asked for), `directory_unreachable`
       * (the call threw — dial, stream open, or decode).
       */
      reason: "not_registered" | "no_transport" | "no_response" | "unexpected_response" | "directory_unreachable";
      error?: string;
    };
