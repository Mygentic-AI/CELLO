/**
 * FROST DKG Wire Frame Types — REG-001 (real interactive DKG)
 *
 * These frames are exchanged on /cello/frost/1.0.0 streams during the
 * distributed key generation ceremony that runs as part of registration.
 *
 * The DKG follows @noble/curves/frost DKG.round1/round2/round3 (RFC 9591 Appendix C).
 * Each directory node (and the client) independently generates a secret polynomial
 * and exchanges commitments. primary_pubkey is derived from the joint contributions
 * of all participants.
 *
 * Three round-trip exchanges on /cello/frost/1.0.0 (one new stream per round per node):
 *
 *   Round 1: client asks each node to generate its polynomial
 *            → each node returns { commitment[], proofOfKnowledge }
 *   Round 2: client broadcasts all nodes' round1 data to each node
 *            → each node returns its unicast signing shares for the other nodes
 *   Round 3: client delivers received round2 shares to each node for finalization
 *            → each node stores its FrostSecret and returns its shareCommitment
 *
 * These frames are DISTINCT from the signing ceremony frames:
 *   frost_commit_request/response  — signing round 1 (nonce commitment)
 *   frost_sign_request/response    — signing round 2 (partial signature)
 *
 * Crypto reference: RFC 9591 (FROST DKG), RFC 8032 (Ed25519)
 */

// ─── Shared data shapes ───────────────────────────────────────────────────────

/**
 * Public round1 broadcast from one DKG participant.
 * Matches DKG_Round1 from @noble/curves/abstract/frost.
 */
export interface DkgRound1Broadcast {
  /** Participant's FROST identifier (serialized string from ed25519_FROST.Identifier) */
  identifier: string;
  /** VSS commitment vector: one 32-byte Ed25519 point per polynomial coefficient */
  commitment: Uint8Array[];
  /** Schnorr proof-of-knowledge of the participant's secret (64 bytes) */
  proofOfKnowledge: Uint8Array;
}

/**
 * Unicast round2 share from one participant to one other.
 * Matches DKG_Round2 from @noble/curves/abstract/frost.
 */
export interface DkgRound2Share {
  /** Identifier of the participant who generated this share */
  signerIdentifier: string;
  /** Identifier of the participant this share is addressed to */
  targetIdentifier: string;
  /** Signing share: 32-byte scalar */
  signingShare: Uint8Array;
}

// ─── Round 1 ──────────────────────────────────────────────────────────────────

/**
 * Client → Directory: begin DKG round 1 for this agent/epoch.
 * The directory node generates its own secret polynomial and returns
 * its public broadcast.
 */
export interface FrostDkgRound1Request {
  type: "frost_dkg_round1_request";
  /** Hex-encoded K_local public key */
  agentPubkey: string;
  /** Epoch identifier: "${agentPubkey}:epoch:1" */
  epochId: string;
  /** Threshold parameters for the DKG group */
  signers: { min: number; max: number };
}

export interface FrostDkgRound1ResponseOk {
  type: "frost_dkg_round1_response";
  ok: true;
  /** The node's public DKG broadcast (commitment + proof-of-knowledge) */
  broadcast: DkgRound1Broadcast;
}

export interface FrostDkgRound1ResponseErr {
  type: "frost_dkg_round1_response";
  ok: false;
  reason: "already_in_progress" | "internal_error";
}

export type FrostDkgRound1Response = FrostDkgRound1ResponseOk | FrostDkgRound1ResponseErr;

// ─── Round 2 ──────────────────────────────────────────────────────────────────

/**
 * Client → Directory: deliver all OTHER participants' round1 broadcasts to this node.
 * The directory node runs DKG.round2() and returns unicast shares for each other participant.
 */
export interface FrostDkgRound2Request {
  type: "frost_dkg_round2_request";
  agentPubkey: string;
  epochId: string;
  /** Round1 broadcasts from ALL other participants (excludes the receiving node itself) */
  othersRound1: DkgRound1Broadcast[];
}

export interface FrostDkgRound2ResponseOk {
  type: "frost_dkg_round2_response";
  ok: true;
  /** One signing share per other participant — client routes each to its recipient */
  sharesForOthers: DkgRound2Share[];
}

export interface FrostDkgRound2ResponseErr {
  type: "frost_dkg_round2_response";
  ok: false;
  reason: "round1_not_complete" | "verification_failed" | "internal_error";
}

export type FrostDkgRound2Response = FrostDkgRound2ResponseOk | FrostDkgRound2ResponseErr;

// ─── Round 3 ──────────────────────────────────────────────────────────────────

/**
 * Client → Directory: deliver round2 shares addressed to this node + all round1 data.
 * The directory node runs DKG.round3() and finalizes its FrostSecret.
 */
export interface FrostDkgRound3Request {
  type: "frost_dkg_round3_request";
  agentPubkey: string;
  epochId: string;
  /** Round2 shares addressed to this node (one per other participant) */
  sharesForMe: DkgRound2Share[];
  /** All participants' round1 broadcasts (same set used in round2) */
  allRound1: DkgRound1Broadcast[];
}

export interface FrostDkgRound3ResponseOk {
  type: "frost_dkg_round3_response";
  ok: true;
  /**
   * The group public key (primary_pubkey candidate) — 32-byte Ed25519 point.
   * This is FrostPublic.commitments[0] from round3 output.
   * The coordinator verifies all nodes return the same value before accepting.
   */
  shareCommitment: Uint8Array;
}

export interface FrostDkgRound3ResponseErr {
  type: "frost_dkg_round3_response";
  ok: false;
  reason: "round2_not_complete" | "share_verification_failed" | "internal_error";
}

export type FrostDkgRound3Response = FrostDkgRound3ResponseOk | FrostDkgRound3ResponseErr;

// ─── Union types ──────────────────────────────────────────────────────────────

export type FrostDkgRequest =
  | FrostDkgRound1Request
  | FrostDkgRound2Request
  | FrostDkgRound3Request;

export type FrostDkgResponse =
  | FrostDkgRound1Response
  | FrostDkgRound2Response
  | FrostDkgRound3Response;
