/**
 * CELLO Directory-Relay Protocol — wire types (CELLO-NODE-004)
 *
 * Frame protocol: /cello/directory-relay/1.0.0
 * Framing: it-length-prefixed (unsigned varint per multiformats spec)
 * Encoding: canonical CBOR per RFC 8949 §4.2.1
 * One request/response per stream open (same pattern as /cello/frost/1.0.0)
 *
 * Auth: relay verifies Ed25519 signature over canonical CBOR of the frame body
 *   (all fields except directory_signature).
 *   Signature domain: implicitly the CBOR field "type" value — no separate domain prefix.
 *   The relay holds the directory's known public key (CELLO_DIRECTORY_PUBKEY at startup).
 *
 * Direction:
 *   directory → relay:  discard_session, get_seal_leaves, get_session_liveness
 *   relay → directory:  seal_submission (relay-initiated when bilateral SEAL detected)
 *
 * DOD-M15-RELAYADMIN-DEAD-FRAMES-1 (2026-08-24): record_assignment, confirm_seal and reject_seal
 * were REMOVED from this wire protocol. No deployed directory has sent them since Option B
 * (client-presented assignments) and the seal-broker cutover shipped — every recorded fleet
 * image postdates both removal commits. An authenticated frame naming one of the three retired
 * types now falls through to the "unknown frame type" abort in relay-node.ts, same as any other
 * unrecognised type — not silently accepted, and logged there so it is diagnosable.
 *
 * ⚠️ **CORRECTED 2026-08-31 by the Opus re-review of that unit. The version of this header written
 * when those three frames were deleted said "discard_session remains the one live directory→relay
 * dial." That was FALSE, and dangerously so** — this milestone is running a deletion campaign, and
 * the next unit to read it would have concluded the two handlers below were also dead. Deleting
 * `get_session_liveness` would silently break the ABSENT attestation. The rewrite was more
 * assertive than the incomplete header it replaced, and carried a DoD tag that made it read as
 * freshly verified. The lesson is the one that unit was itself warned about: do not generalise
 * from the frames you looked at to the ones you did not.
 *
 * What is actually true, each re-derived from its call site (2026-08-31):
 *   - `discard_session`      — LIVE. `directory-node.ts:2766`, provisional-session cleanup.
 *   - `get_session_liveness` — LIVE. `directory-node.ts:4520`, the relay as liveness authority
 *                              for the ABSENT attestation. Deleting this breaks that attestation.
 *   - `get_seal_leaves`      — handler and sender both still present, but **no directory caller**:
 *                              Option B rebuilds the chain from client-carried leaves instead
 *                              (`directory-node.ts:4473`, `seal-unilateral-verify.ts`). That is the
 *                              same shape as the three frames this unit deleted. It is recorded,
 *                              not acted on, because that unit is closed — see its Newly discovered.
 */

import type { RelayLeafKind } from "./relay-types.js";

// ─── Directory → Relay request frames ────────────────────────────────────────

export interface DiscardSessionFrame {
  type: "discard_session";
  session_id: Uint8Array;         // 16 bytes
  directory_signature: Uint8Array; // 64-byte Ed25519 over CBOR of body without this field
}

/**
 * Re-review: the relay ALSO handles these two on this protocol (relay-node.ts:680, :701). They were
 * missing from this file entirely, which is how the union below came to claim the directory→relay
 * protocol carries exactly one frame.
 */
export interface GetSealLeavesFrame {
  type: "get_seal_leaves";
  session_id: Uint8Array;          // 16 bytes
  directory_signature: Uint8Array; // 64-byte Ed25519 over CBOR of body without this field
}

export interface GetSessionLivenessFrame {
  type: "get_session_liveness";
  counterparty_pubkey: Uint8Array; // 32 bytes
  directory_signature: Uint8Array; // 64-byte Ed25519 over CBOR of body without this field
}

/**
 * ⚠️ This union is not type-checked against the relay's dispatch — nothing consumes it, which is
 * exactly why it sat wrong (claiming a single-frame protocol) without anything failing. Treat it as
 * documentation that must be updated by hand whenever a branch is added to or removed from
 * `#handleDirectoryRelayStream`.
 */
export type DirectoryToRelayFrame =
  | DiscardSessionFrame
  | GetSealLeavesFrame
  | GetSessionLivenessFrame;

// ─── Relay → Directory request frames ────────────────────────────────────────

/**
 * Relay → Directory: sent when bilateral SEAL leaves detected.
 * The relay dials the directory and sends this frame.
 * Directory responds with seal_received after queuing verification.
 */
export interface SealSubmissionFrame {
  type: "seal_submission";
  session_id: Uint8Array;    // 16 bytes
  leaves: SealSubmissionLeaf[];
  seq_count: number;
  merkle_root: Uint8Array;   // 32-byte Merkle root as computed by relay
}

export interface SealSubmissionLeaf {
  kind: RelayLeafKind;
  s2: unknown;               // Structure2 — typed as unknown to avoid cross-package import
  structure1_cbor: Uint8Array;
}

// ─── Response frames ──────────────────────────────────────────────────────────

export interface DiscardOkFrame {
  type: "discard_ok";
}

export interface SealReceivedFrame {
  type: "seal_received";
}

export interface AuthInvalidFrame {
  type: "auth_invalid";
}

/**
 * Re-review: `seal_leaves`, `seal_leaves_unavailable` and `session_liveness` are all sent by the
 * relay (relay-node.ts:686, :692, :706) and were all missing here. Same cause as the request union
 * above — nothing consumes this type, so being wrong cost nothing until someone believed it.
 */
export interface SealLeavesFrame {
  type: "seal_leaves";
  session_id: Uint8Array;
  leaves: SealSubmissionLeaf[];
  seq_count: number;
  merkle_root: Uint8Array;
}

export interface SealLeavesUnavailableFrame {
  type: "seal_leaves_unavailable";
  reason: string;
}

export interface SessionLivenessFrame {
  type: "session_liveness";
  liveness: "alive" | "gone" | "unknown";
}

export type DirectoryRelayResponse =
  | DiscardOkFrame
  | SealLeavesFrame
  | SealLeavesUnavailableFrame
  | SessionLivenessFrame
  | SealReceivedFrame
  | AuthInvalidFrame;
