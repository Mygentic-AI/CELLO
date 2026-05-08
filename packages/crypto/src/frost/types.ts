/**
 * FROST Threshold Signing Abstraction — Type Definitions
 *
 * CELLO-CRYPTO-003
 *
 * Design decisions:
 * - `IThresholdSigner` is separate from `KeyProvider`. `KeyProvider` handles K_local
 *   envelope signing; `IThresholdSigner` handles the multi-party threshold ceremony.
 * - Two domain context strings are defined (M2 only):
 *   - "cello-frost-session-establishment-v1" — session establishment TBS
 *   - "cello-frost-seal-v1"                 — conversation seal TBS
 * - Context is prepended to the TBS before signing to achieve domain separation.
 *   FROST over ed25519 does not support a native context parameter, so we use
 *   a framed encoding: `<context>\0<tbs>`.
 * - `primary_pubkey` is the group public key (commitments[0] from FROST public package).
 *   It is derived deterministically from all n nodes' share commitments. Per-agent.
 */

// ─── Domain context strings ──────────────────────────────────────────────────

export const CONTEXT_SESSION_ESTABLISHMENT =
  "cello-frost-session-establishment-v1" as const;
export const CONTEXT_SEAL = "cello-frost-seal-v1" as const;

export type FrostContext =
  | typeof CONTEXT_SESSION_ESTABLISHMENT
  | typeof CONTEXT_SEAL;

// ─── Threshold signature result ───────────────────────────────────────────────

export type ThresholdSignatureOk = {
  readonly ok: true;
  readonly signature: Uint8Array; // 64-byte Ed25519 Schnorr threshold signature
};

export type ThresholdSignatureError = {
  readonly ok: false;
  readonly error: {
    readonly reason:
      | "DIRECTORY_BELOW_THRESHOLD" // fewer than `threshold` nodes reachable at initiation
      | "CEREMONY_TIMEOUT" // total ceremony exceeded ceremonyTimeoutMs
      | "CEREMONY_EXHAUSTED"; // maxRetries attempts all failed
  };
};

export type ThresholdSignature = ThresholdSignatureOk | ThresholdSignatureError;

// ─── Core abstraction ─────────────────────────────────────────────────────────

/**
 * IThresholdSigner: the swap point for all threshold signing in the protocol.
 *
 * Implementations MUST:
 * - Keep the local FROST key share within the crypto package boundary
 * - Never log or return key share material in any error or diagnostic path
 * - Use the context string for domain separation (framed: `<context>\0<tbs>`)
 */
export interface IThresholdSigner {
  /**
   * Participate in a threshold signing ceremony as coordinator.
   *
   * Opens streams to `threshold` directory nodes, runs the FROST protocol
   * with the given `context` string for domain separation, collects partial
   * signature shares, combines them, and returns the aggregated signature.
   *
   * @param ceremonyId - Unique identifier for this ceremony instance
   * @param tbs - The to-be-signed bytes (domain-specific payload)
   * @param context - Domain context string for separation (e.g. CONTEXT_SESSION_ESTABLISHMENT)
   */
  participateInCeremony(
    ceremonyId: string,
    tbs: Uint8Array,
    context: FrostContext,
  ): Promise<ThresholdSignature>;

  /**
   * Return the group public key (primary_pubkey) for this threshold signer.
   *
   * This is commitments[0] from the FROST public package — the constant term
   * of the dealer's Shamir polynomial commitment. It is the same 32-byte
   * Ed25519 point used to verify threshold signatures produced by participateInCeremony.
   *
   * Called by the directory to embed primary_pubkey in the SessionAssignment
   * (signer_pubkey field) so the counterparty can verify without a round-trip.
   *
   * Throws if not bootstrapped (no local share available).
   */
  getPrimaryPubkey(): Uint8Array;

  /**
   * Verify a combined FROST threshold signature.
   *
   * Used by the seal verifier (both initiator and counterparty) to confirm
   * that a session_sealed FROST signature is valid before transitioning to sealed.
   *
   * @param signature - 64-byte combined FROST signature
   * @param tbs - The to-be-signed bytes (same as passed to participateInCeremony)
   * @param context - Domain context string used during signing
   * @param publicKey - 32-byte group public key (primary_pubkey) to verify against
   * @returns true if the signature is valid
   */
  verifySignature(
    signature: Uint8Array,
    tbs: Uint8Array,
    context: FrostContext,
    publicKey: Uint8Array,
  ): boolean;
}

// ─── Configuration ────────────────────────────────────────────────────────────

/**
 * Configuration for FrostThresholdSigner.
 *
 * `directoryNodes` is used in production; `directoryNodeStubs` is an injection
 * point for in-process test stubs that exercise the same ceremony logic.
 */
export interface FrostThresholdSignerConfig {
  /** t in t-of-n: minimum signers required */
  readonly threshold: number;
  /** n: total participants */
  readonly participants: number;
  /** Production: multiaddr strings pointing to directory nodes */
  readonly directoryNodes?: string[];
  /** Test injection: in-process stubs that mimic directory node behavior */
  readonly directoryNodeStubs?: DirectoryNodeStub[];
  /** Timeout for a single round (one node response), default 3000ms */
  readonly roundTimeoutMs?: number;
  /** Timeout for the entire ceremony across all retries, default 30000ms */
  readonly ceremonyTimeoutMs?: number;
  /** Maximum ceremony attempts before CEREMONY_EXHAUSTED, default 3 */
  readonly maxRetries?: number;
}

// ─── Directory node stub interface (for tests) ───────────────────────────────

/**
 * DirectoryNodeStub: in-process stand-in for a real directory node's
 * /cello/frost/1.0.0 protocol handler.
 *
 * The stub holds its own FROST secret share and responds to ceremony rounds.
 * Stubs can be configured to timeout or return invalid partial signatures.
 */
export interface DirectoryNodeStub {
  /** Stable identifier for this stub node */
  readonly id: string;

  /**
   * Returns whether this node is reachable at ceremony initiation time.
   * An unreachable node is excluded before any rounds begin.
   * Used by the coordinator's pre-ceremony availability check.
   */
  isReachable(): boolean;

  /**
   * Participate in a signing round.
   *
   * Returns a partial signature share for the given commitment list and message,
   * or null to simulate a timeout.
   *
   * @param pub - The shared FROST public package
   * @param commitmentList - Nonce commitments from all signers in this round
   * @param msg - The framed message (context + tbs)
   * @returns Partial signature bytes, or null to simulate timeout
   */
  signRound(params: StubSignParams): Promise<Uint8Array | null>;

  /**
   * Generate nonce commitment for a round.
   * Called by the coordinator before collecting partial signatures.
   */
  generateCommitment(): StubCommitment;

  /**
   * Receive a FROST signing share from the bootstrap ceremony.
   * Called by bootstrapKeyShares during setup.
   */
  receiveShare(
    secret: import("@noble/curves/abstract/frost.js").FrostSecret,
    pub: import("@noble/curves/abstract/frost.js").FrostPublic,
  ): void;
}

export interface StubSignParams {
  pub: import("@noble/curves/abstract/frost.js").FrostPublic;
  commitmentList: import("@noble/curves/abstract/frost.js").NonceCommitments[];
  msg: Uint8Array;
}

export interface StubCommitment {
  nodeId: string;
  nonceCommitment: import("@noble/curves/abstract/frost.js").NonceCommitments;
  nonces: import("@noble/curves/abstract/frost.js").Nonces;
}

// ─── Bootstrap result ─────────────────────────────────────────────────────────

export interface BootstrapResult {
  /**
   * The group public key derived deterministically from all n nodes' share commitments.
   * 32-byte Ed25519 point. Stored alongside K_local.
   * This is the only key material returned from bootstrapKeyShares.
   */
  readonly primaryPubkey: Uint8Array;
}
