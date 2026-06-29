/**
 * CELLO Directory Node — FROST Protocol Handler (NODE-003)
 *
 * Implements the /cello/frost/1.0.0 libp2p stream protocol for the directory.
 *
 * Responsibilities:
 *   - Participate in FROST ceremony rounds (compute partial signatures)
 *   - Store K_server_X shares behind InMemoryShareStore
 *   - Detect in-flight ceremony conflicts for the same (agentPubkey, epochId)
 *   - Provide bootstrapKeyShares test-harness method (guarded by NODE_ENV=test)
 *
 * Crypto reference: FROST/Ed25519 per RFC 9591
 * Implementation: @noble/curves/ed25519_FROST
 *
 * ─── Phase P: Pseudocode ─────────────────────────────────────────────────────
 *
 * bootstrapKeyShares(agentPubkey):
 *   // GUARD: only callable in NODE_ENV === 'test'
 *   if NODE_ENV !== 'test': throw BootstrapNotAllowedInProduction
 *   // Generate a 1-of-1 FROST share for this directory node
 *   // (in real DKG, shares come from multi-party ceremony — this is a test shortcut)
 *   epochId = "${agentPubkey}:epoch:1"
 *   nodeIdentifier = derive(nodeId)
 *   deal = trustedDealer({ min: 1, max: 1 }, [nodeIdentifier])
 *   share = { secret: deal.secretShares[nodeIdentifier], pub: deal.public }
 *   shareStore.storeShare(agentPubkey, epochId, share)
 *   currentEpoch.set(agentPubkey, 1)
 *   commitment = deal.public.commitments[0]  // group public key point (32 bytes)
 *   return { shareCommitment: commitment }
 *   // NOTE: share.secret NEVER returned or logged
 *
 * handleCeremonyRound(params):
 *   { agentPubkey, epochId, tbs, context, commitmentList, peerIdString } = params
 *
 *   // Step 1: Check for in-flight conflict (different Peer ID for same (agent, epoch))
 *   conflictKey = "${agentPubkey}:${epochId}"
 *   inFlightEntry = #inFlight.get(conflictKey)
 *   if inFlightEntry and inFlightEntry.peerIdString !== peerIdString:
 *     // Fire FALLBACK_CANARY (log only in M2 — no push notification)
 *     fireFallbackCanary(agentPubkey, epochId, inFlightEntry.peerIdString, peerIdString)
 *     return { ok: false, reason: 'CEREMONY_CONFLICT' }
 *     // NOTE: in-flight ceremony from the original peer is NOT interrupted
 *
 *   // Step 2: Resolve K_server_X share (try store, then test stub)
 *   share = shareStore.getShare(agentPubkey, epochId)
 *   if share is null:
 *     stub = testStubMap.get("${agentPubkey}:${epochId}")
 *     if stub:  use stub for signing
 *     else:
 *       if isExpiredEpoch(agentPubkey, epochId): return { ok: false, reason: 'EPOCH_EXPIRED' }
 *       return { ok: false, reason: 'AGENT_NOT_BOOTSTRAPPED' }
 *
 *   // Step 3: Compute partial FROST signature
 *   msg = frameMessage(context, tbs)          // context\0tbs (domain separation)
 *   nonce = commit(share.secret)              // fresh one-time nonce (RFC 9591)
 *   fullList = [...commitmentList, nonce.commitments]
 *   partialSig = signShare(share.secret, share.pub, nonce.nonces, fullList, msg)
 *   return { ok: true, partialSignature: partialSig }
 *   // NOTE: share.secret NEVER included in return value
 *
 * checkConflict(agentPubkey, epochId, peerIdString, _ceremonyId):
 *   entry = #inFlight.get("${agentPubkey}:${epochId}")
 *   if entry is undefined: return false  // no in-flight ceremony
 *   return entry.peerIdString !== peerIdString  // true = different peer = conflict
 *
 * markInFlight(agentPubkey, epochId, peerIdString, ceremonyId):
 *   #inFlight.set("${agentPubkey}:${epochId}", { peerIdString, ceremonyId })
 *
 * isExpiredEpoch(agentPubkey, epochId):
 *   requestedN = parseEpochN(epochId)  // from "${agentId}:epoch:N"
 *   currentN = #currentEpoch.get(agentPubkey)
 *   if currentN is undefined: return false  // agent unknown → not bootstrapped (different error)
 *   return requestedN < currentN
 *
 * ─── End Pseudocode ──────────────────────────────────────────────────────────
 */

import { ed25519_FROST } from "@noble/curves/ed25519.js";
import type { NonceCommitments } from "@noble/curves/abstract/frost.js";
import type { FrostContext } from "@cello-protocol/crypto/frost/types.js";
import type { Logger } from "@cello-protocol/interfaces";
import type { ShareStore, LocalShare } from "./share-store.js";
import { InMemoryShareStore } from "./share-store.js";

// ─── Protocol ID ───────────────────────────────────────────────────────────────

export const FROST_PROTOCOL_ID = "/cello/frost/1.0.0";

// ─── Errors ────────────────────────────────────────────────────────────────────

/**
 * Thrown by bootstrapKeyShares when called outside NODE_ENV=test.
 * This ensures the test-harness bootstrap cannot be invoked in production.
 */
export class BootstrapNotAllowedInProduction extends Error {
  constructor() {
    super(
      "bootstrapKeyShares is a test-harness method. " +
        "It must not be called outside NODE_ENV=test. " +
        "Real DKG (M3) is required in production."
    );
    this.name = "BootstrapNotAllowedInProduction";
  }
}

// ─── DKG wire types ───────────────────────────────────────────────────────────

/**
 * Round 1 public broadcast — sent from directory node to client coordinator.
 * Contains the node's public polynomial commitment and proof-of-knowledge.
 * RFC 9591 §5.1.
 */
export interface DkgRound1Broadcast {
  /** Hex-encoded FROST participant identifier */
  readonly identifier: string;
  /** Polynomial commitment — array of 32-byte Ed25519 points */
  readonly commitment: Uint8Array[];
  /** Proof-of-knowledge — 64 bytes */
  readonly proofOfKnowledge: Uint8Array;
}

/**
 * Round 2 share — from one participant, addressed to another.
 * Contains the signing share polynomial evaluated at the target's identifier.
 * RFC 9591 §5.2.
 *
 * IMPORTANT identifier semantics:
 *   - `identifier` = SENDER's identifier (used by round3 to verify against round1 package)
 *   - `targetIdentifier` = RECIPIENT's identifier (used by coordinator for routing)
 */
export interface DkgRound2Share {
  /** Hex-encoded SENDER participant identifier (used by round3 for round1 matching) */
  readonly identifier: string;
  /** Hex-encoded RECIPIENT participant identifier (used by coordinator for routing) */
  readonly targetIdentifier: string;
  /** 32-byte signing share polynomial evaluation */
  readonly signingShare: Uint8Array;
}

// ─── DKG result types ─────────────────────────────────────────────────────────

export type DkgRound1Ok = {
  readonly ok: true;
  readonly broadcast: DkgRound1Broadcast;
};

export type DkgRound1Error = {
  readonly ok: false;
  readonly reason: "already_in_progress";
};

export type DkgRound1Result = DkgRound1Ok | DkgRound1Error;

export type DkgRound2Ok = {
  readonly ok: true;
  /** Shares addressed to each of the other participants */
  readonly sharesForOthers: DkgRound2Share[];
};

export type DkgRound2Error = {
  readonly ok: false;
  readonly reason: "not_in_round1";
};

export type DkgRound2Result = DkgRound2Ok | DkgRound2Error;

export type DkgRound3Ok = {
  readonly ok: true;
  /**
   * The FROST group public key (32-byte Ed25519 point).
   * This is commitments[0] from the finalized FrostPublic.
   * SECURITY: this is the ONLY key material that leaves dkgRound3.
   * The FrostSecret (polynomial coefficients) is stored internally.
   */
  readonly shareCommitment: Uint8Array;
};

export type DkgRound3Error = {
  readonly ok: false;
  readonly reason: "not_in_round2" | "share_verification_failed";
};

export type DkgRound3Result = DkgRound3Ok | DkgRound3Error;

// ─── DKG state ────────────────────────────────────────────────────────────────

type DkgStep = "round1_complete" | "round2_complete";

interface DkgState {
  // Mutable DKG_Secret from round1 (consumed/modified by round2 and round3)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  secret: any;
  // The node's own round1 public broadcast (needed for round3 validation)
  round1Public: DkgRound1Broadcast;
  step: DkgStep;
}

// ─── Result types ──────────────────────────────────────────────────────────────

export type CeremonyRoundOk = {
  readonly ok: true;
  readonly partialSignature: Uint8Array;
};

export type CeremonyRoundError = {
  readonly ok: false;
  readonly reason:
    | "AGENT_NOT_BOOTSTRAPPED"
    | "CEREMONY_CONFLICT"
    | "EPOCH_EXPIRED";
};

export type CeremonyRoundResult = CeremonyRoundOk | CeremonyRoundError;

// ─── Bootstrap result ─────────────────────────────────────────────────────────

export interface DirectoryBootstrapResult {
  /**
   * The FROST share commitment (32-byte Ed25519 group public key point).
   * This is the ONLY key material that leaves bootstrapKeyShares.
   * The actual FrostSecret is stored internally in the ShareStore and never exposed.
   */
  readonly shareCommitment: Uint8Array;
}

// ─── FALLBACK_CANARY event ────────────────────────────────────────────────────

export interface FallbackCanaryEvent {
  readonly type: "FALLBACK_CANARY";
  readonly agentPubkey: string;
  readonly epochId: string;
  readonly inFlightPeerId: string;
  readonly conflictingPeerId: string;
  readonly timestamp: number;
}

// ─── Ceremony round params ────────────────────────────────────────────────────

export interface CeremonyRoundParams {
  /** Agent pubkey hex — identifies which K_server_X share to use */
  readonly agentPubkey: string;
  /** Epoch identifier: "${agentId}:epoch:${N}" */
  readonly epochId: string;
  /** To-be-signed bytes */
  readonly tbs: Uint8Array;
  /** Domain context string for FROST message framing */
  readonly context: FrostContext;
  /** Nonce commitments from all signers in this round (Round 1 output) */
  readonly commitmentList: NonceCommitments[];
  /** Peer ID string of the requesting coordinator */
  readonly peerIdString: string;
  /** Unique ID for this ceremony instance */
  readonly ceremonyId: string;
}

// ─── In-flight registry entry ─────────────────────────────────────────────────

interface InFlightEntry {
  readonly peerIdString: string;
  readonly ceremonyId: string;
}

// ─── FrostDirectoryHandler options ───────────────────────────────────────────

export interface FrostDirectoryHandlerOptions {
  /** Stable ID for this directory node — used to derive FROST participant identifier */
  readonly nodeId: string;
  /** Share store for K_server_X persistence */
  readonly shareStore?: ShareStore;
  /** Optional FALLBACK_CANARY event listener (for testing/monitoring) */
  readonly onFallbackCanary?: (event: FallbackCanaryEvent) => void;
  /** Structured logger injected at the composition root */
  readonly logger?: Logger;
}

// ─── FrostDirectoryHandler ────────────────────────────────────────────────────

/**
 * FrostDirectoryHandler: server-side FROST signing handler for the directory node.
 *
 * Manages K_server_X share storage, partial signature computation,
 * and in-flight ceremony conflict detection for the /cello/frost/1.0.0 protocol.
 *
 * SECURITY INVARIANTS:
 * - K_server_X share bytes (FrostSecret) NEVER appear in any log, error, or wire message
 * - bootstrapKeyShares only executes in NODE_ENV=test
 * - Two simultaneous ceremonies from different Peer IDs for the same (agentPubkey, epochId)
 *   are detected and the second is rejected with CEREMONY_CONFLICT
 */
export class FrostDirectoryHandler {
  readonly #nodeId: string;
  readonly #shareStore: ShareStore;
  readonly #onFallbackCanary: ((event: FallbackCanaryEvent) => void) | undefined;
  readonly #logger: Logger | undefined;

  // In-flight ceremony registry: "${agentPubkey}:${epochId}" → InFlightEntry
  // Tracks which Peer ID owns the in-flight ceremony for each (agent, epoch) pair.
  readonly #inFlight = new Map<string, InFlightEntry>();

  // Current epoch number per agent: agentPubkey → latest epoch N
  // Used to detect expired epoch requests.
  readonly #currentEpoch = new Map<string, number>();

  // DKG state per (agentPubkey, epochId): agentPubkey:epochId → DkgState
  // Holds the mutable DKG_Secret between rounds.
  // State machine: idle → round1_complete → round2_complete → finalized (entry removed)
  readonly #dkgStates = new Map<string, DkgState>();

  // Pending nonce cache for two-step network protocol: agentPubkey:epochId → { nonce, share, expiresAt }
  // Populated by generateCommitment(); consumed exclusively by signRawMessage().
  // Nonces are one-time-use per RFC 9591; each entry is deleted on first consumption.
  // Entries expire after PENDING_NONCE_TTL_MS to prevent memory leaks from incomplete ceremonies.
  readonly #pendingNonces = new Map<string, { nonce: import("@noble/curves/abstract/frost.js").Nonces; share: LocalShare; expiresAt: number }>();

  static readonly #PENDING_NONCE_TTL_MS = 60_000; // 60 seconds — enough for any realistic ceremony


  constructor(opts: FrostDirectoryHandlerOptions) {
    this.#nodeId = opts.nodeId;
    this.#shareStore = opts.shareStore ?? new InMemoryShareStore();
    this.#onFallbackCanary = opts.onFallbackCanary;
    this.#logger = opts.logger;
  }

  get nodeId(): string { return this.#nodeId; }

  /**
   * CELLO-M8-LEVER-002 (burn): destroy THIS node's K_server_X share material for an agent (all
   * epochs) — the per-node reaction to a replicated burn. Delegates to the ShareStore (in-memory
   * dropped; persisted zeroed). Idempotent.
   */
  async destroyShares(agentPubkey: string): Promise<void> {
    await this.#shareStore.destroyShares(agentPubkey);
  }

  // ─── bootstrapKeyShares ──────────────────────────────────────────────────────

  /**
   * Test-harness shortcut for K_server_X share bootstrap.
   *
   * GUARD: Only callable in NODE_ENV=test. This is NOT a real multi-round DKG
   * (that comes in M3). Uses FROST trustedDealer to generate a server-side share
   * for this directory node.
   *
   * The generated share is stored in the ShareStore for (agentPubkey, epoch:1).
   * ONLY the share commitment (32-byte group public key point) is returned.
   * The FrostSecret is never returned, logged, or exposed.
   */
  bootstrapKeyShares(agentPubkey: string): DirectoryBootstrapResult {
    // GUARD: throw immediately before any crypto operations or store mutations
    if (process.env.NODE_ENV !== "test") {
      throw new BootstrapNotAllowedInProduction();
    }

    // Generate a FROST share for this node using trustedDealer.
    // In real DKG (M3): shares come from the multi-party distributed key generation ceremony.
    // Here we generate a 2-of-2 deal (minimum threshold per @noble/curves FROST constraints),
    // using this node's identifier + a dummy "director" identifier. Only this node's
    // share is stored; the dummy identifier's share is discarded.
    // This gives us a valid FrostSecret that can participate in real FROST ceremonies.
    const nodeIdentifier = ed25519_FROST.Identifier.derive(this.#nodeId);
    const dummyIdentifier = ed25519_FROST.Identifier.derive(`${this.#nodeId}:director`);
    const deal = ed25519_FROST.trustedDealer(
      { min: 2, max: 2 },
      [nodeIdentifier, dummyIdentifier]
    );

    const secret = deal.secretShares[nodeIdentifier];
    if (!secret) {
      throw new Error(`[frost-handler] Failed to generate share for node ${this.#nodeId}`);
    }

    const share: LocalShare = { secret, pub: deal.public };

    // Epoch 1 is the initial epoch (monotonic integer, starts at 1)
    const epochId = `${agentPubkey}:epoch:1`;
    this.#shareStore.storeShare(agentPubkey, epochId, share);
    this.#currentEpoch.set(agentPubkey, 1);

    // Return ONLY the share commitment — the group public key (32-byte Ed25519 point)
    // This is the verification material, NOT the signing secret.
    const shareCommitment = new Uint8Array(deal.public.commitments[0]);

    return { shareCommitment };
    // SECURITY: share.secret is scoped here and never returned or logged.
  }

  // ─── generateCommitment ──────────────────────────────────────────────────────

  /**
   * Generate a nonce commitment for an upcoming ceremony round.
   * Called by the network frost handler when a frost_commit_request arrives.
   * The commitment is cached internally; signRound uses and clears it.
   */
  async generateCommitment(
    agentPubkey: string,
    epochId: string,
  ): Promise<
    | { ok: true; nodeId: string; nonceCommitment: NonceCommitments }
    | { ok: false; reason: "AGENT_NOT_BOOTSTRAPPED" | "EPOCH_EXPIRED" | "NONCE_ALREADY_PENDING" }
  > {
    const agentShort = agentPubkey.slice(0, 16);
    this.#logger?.info("frost.debug.generateCommitment.enter", { agentShort, epochId, nodeId: this.#nodeId });

    if (this.#isExpiredEpoch(agentPubkey, epochId)) {
      this.#logger?.warn("frost.debug.generateCommitment.epoch_expired", { agentShort, epochId });
      return { ok: false, reason: "EPOCH_EXPIRED" };
    }

    const share = this.#shareStore.getShare(agentPubkey, epochId);
    this.#logger?.info("frost.debug.generateCommitment.share_lookup", {
      agentShort, epochId,
      shareFound: !!share,
      shareSecretType: share ? typeof (share.secret as unknown as Record<string, unknown>)?.signingShare : "N/A",
      shareSecretIsUint8Array: share ? ((share.secret as unknown as Record<string, unknown>)?.signingShare instanceof Uint8Array) : false,
      sharePubType: share ? typeof share.pub : "N/A",
      shareStoreSize: (this.#shareStore as unknown as { size?: number })?.size ?? "unknown",
    });

    if (!share) {
      this.#logger?.error("frost.debug.generateCommitment.no_share", { agentShort, epochId, nodeId: this.#nodeId });
      return { ok: false, reason: "AGENT_NOT_BOOTSTRAPPED" };
    }

    const cacheKey = `${agentPubkey}:${epochId}`;
    const now = Date.now();
    let expiredCount = 0;
    for (const [k, entry] of this.#pendingNonces) {
      if (now > entry.expiresAt) { this.#pendingNonces.delete(k); expiredCount++; }
    }
    this.#logger?.info("frost.debug.generateCommitment.nonce_sweep", { agentShort, expiredCount, pendingNonceCount: this.#pendingNonces.size });

    if (this.#pendingNonces.has(cacheKey)) {
      // DOD-SUSPEND-1 route-around: a pending nonce here is from an ABANDONED prior ceremony attempt —
      // the coordinator restarted the round with a fresh participant set (e.g. excluding a SUSPENDED
      // directory) and is re-requesting a commitment for the same (agent, epoch). The old nonce was
      // NEVER consumed by signRawMessage (it's still pending), so DISCARD it and generate a fresh one
      // below. FROST nonce safety holds: a nonce must never sign twice, but an unconsumed pending nonce
      // never signed, so replacing it is safe — the stale one is dropped. REFUSING here strands every
      // retry that re-touches an already-committed survivor (NONCE_ALREADY_PENDING cascades the survivor
      // into the excluded set), so a sub-threshold suspension exhausts instead of signing with the
      // healthy directories — defeating threshold-refusal ≠ single-node-refusal.
      const existing = this.#pendingNonces.get(cacheKey)!;
      this.#logger?.warn("frost.debug.generateCommitment.nonce_replaced", {
        agentShort, epochId, staleExpiresInMs: existing.expiresAt - now,
      });
      this.#pendingNonces.delete(cacheKey);
    }

    let nonce: ReturnType<typeof ed25519_FROST.commit>;
    try {
      nonce = ed25519_FROST.commit(share.secret);
      this.#logger?.info("frost.debug.generateCommitment.nonce_generated", { agentShort, epochId, nodeId: this.#nodeId });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.#logger?.error("frost.debug.generateCommitment.commit_threw", { agentShort, epochId, error: msg });
      return { ok: false, reason: "AGENT_NOT_BOOTSTRAPPED" };
    }

    this.#pendingNonces.set(cacheKey, { nonce: nonce.nonces, share, expiresAt: now + FrostDirectoryHandler.#PENDING_NONCE_TTL_MS });
    this.#logger?.info("frost.debug.generateCommitment.success", { agentShort, epochId, nodeId: this.#nodeId, pendingNonceCount: this.#pendingNonces.size });
    return { ok: true, nodeId: this.#nodeId, nonceCommitment: nonce.commitments };
  }

  // ─── handleCeremonyRound ─────────────────────────────────────────────────────

  /**
   * Handle a FROST ceremony round message from a coordinator client.
   *
   * Performs:
   * 1. In-flight conflict detection (different Peer ID for same (agent, epoch))
   * 2. K_server_X share lookup (store or test stub)
   * 3. Epoch expiry check
   * 4. Partial FROST signature computation
   *
   * SECURITY: The share's FrostSecret is used ONLY to compute the partial sig.
   * It is never included in the return value, error messages, or any log output.
   */
  async handleCeremonyRound(
    params: CeremonyRoundParams
  ): Promise<CeremonyRoundResult> {
    const { agentPubkey, epochId, tbs, context, commitmentList, peerIdString } =
      params;

    // Step 1: Check for in-flight conflict
    const conflictKey = `${agentPubkey}:${epochId}`;
    const inFlightEntry = this.#inFlight.get(conflictKey);
    if (inFlightEntry && inFlightEntry.peerIdString !== peerIdString) {
      // Different Peer ID — conflict detected
      // Fire FALLBACK_CANARY event (log only in M2 — no push notification)
      this.#fireFallbackCanary({
        type: "FALLBACK_CANARY",
        agentPubkey,
        epochId,
        inFlightPeerId: inFlightEntry.peerIdString,
        conflictingPeerId: peerIdString,
        timestamp: Date.now(),
      });
      // Return CEREMONY_CONFLICT — do NOT interrupt the in-flight ceremony
      return { ok: false, reason: "CEREMONY_CONFLICT" };
    }

    // Step 2: Resolve K_server_X share (in-process path only — no pendingNonces involvement)
    const share = this.#shareStore.getShare(agentPubkey, epochId);
    if (!share) {
      // Check if this is because the epoch is expired
      if (this.#isExpiredEpoch(agentPubkey, epochId)) {
        return { ok: false, reason: "EPOCH_EXPIRED" };
      }
      return { ok: false, reason: "AGENT_NOT_BOOTSTRAPPED" };
    }

    // Step 3: Compute partial FROST signature (generates its own nonce — in-process path)
    return this.#signWithShare(share, tbs, context, commitmentList);
  }

  // ─── signRawMessage ───────────────────────────────────────────────────────────

  /**
   * Sign a pre-framed message directly (no re-framing).
   *
   * Used by the network frost stream handler when the client sends a frost_sign_request
   * with a pre-framed message (context\0tbs already concatenated by the coordinator).
   * This avoids double-framing — the coordinator frames once, the directory signs the framed bytes.
   */
  async signRawMessage(params: {
    agentPubkey: string;
    epochId: string;
    framedMsg: Uint8Array;
    commitmentList: NonceCommitments[];
    peerIdString: string;
    ceremonyId: string;
  }): Promise<CeremonyRoundResult> {
    const { agentPubkey, epochId, framedMsg, commitmentList, peerIdString, ceremonyId } = params;
    const agentShort = agentPubkey.slice(0, 16);

    this.#logger?.info("frost.debug.signRawMessage.enter", {
      agentShort, epochId, ceremonyId, peerIdString: peerIdString.slice(0, 16),
      framedMsgLength: framedMsg?.length, framedMsgIsUint8Array: framedMsg instanceof Uint8Array,
      commitmentListLength: commitmentList?.length, nodeId: this.#nodeId,
    });

    const conflictKey = `${agentPubkey}:${epochId}`;
    const inFlightEntry = this.#inFlight.get(conflictKey);
    this.#logger?.info("frost.debug.signRawMessage.conflict_check", {
      agentShort, conflictFound: !!inFlightEntry,
      inFlightPeerId: inFlightEntry?.peerIdString?.slice(0, 16),
      requestingPeerId: peerIdString.slice(0, 16),
    });

    if (inFlightEntry && inFlightEntry.peerIdString !== peerIdString) {
      this.#logger?.warn("frost.debug.signRawMessage.ceremony_conflict", { agentShort, epochId });
      this.#fireFallbackCanary({ type: "FALLBACK_CANARY", agentPubkey, epochId, inFlightPeerId: inFlightEntry.peerIdString, conflictingPeerId: peerIdString, timestamp: Date.now() });
      return { ok: false, reason: "CEREMONY_CONFLICT" };
    }

    const cacheKey = `${agentPubkey}:${epochId}`;
    const pending = this.#pendingNonces.get(cacheKey);
    const now = Date.now();
    this.#logger?.info("frost.debug.signRawMessage.nonce_lookup", {
      agentShort, epochId, pendingFound: !!pending,
      pendingExpired: pending ? now > pending.expiresAt : null,
      expiresInMs: pending ? pending.expiresAt - now : null,
      totalPendingNonces: this.#pendingNonces.size,
      allPendingKeys: [...this.#pendingNonces.keys()].map(k => k.slice(0, 32)),
    });

    if (!pending || now > pending.expiresAt) {
      if (pending) this.#pendingNonces.delete(cacheKey);
      this.#logger?.error("frost.debug.signRawMessage.no_nonce", { agentShort, epochId, hadExpired: !!pending });
      return { ok: false, reason: "AGENT_NOT_BOOTSTRAPPED" };
    }
    this.#pendingNonces.delete(cacheKey);

    const { nonce, share } = pending;
    this.#logger?.info("frost.debug.signRawMessage.share_from_nonce", {
      agentShort, epochId,
      shareSecretType: typeof (share.secret as unknown as Record<string, unknown>)?.signingShare,
      shareSecretIsUint8Array: (share.secret as unknown as Record<string, unknown>)?.signingShare instanceof Uint8Array,
      sharePubCommitmentsLength: (share.pub as unknown as Record<string, unknown[]>)?.commitments?.length,
      nonceType: typeof nonce,
    });

    let partialSig: Uint8Array;
    try {
      this.#logger?.info("frost.debug.signRawMessage.calling_signShare", { agentShort, epochId });
      partialSig = ed25519_FROST.signShare(
        share.secret,
        share.pub,
        nonce,
        commitmentList,
        framedMsg,
      );
      this.#logger?.info("frost.debug.signRawMessage.signShare_success", { agentShort, epochId, sigLength: partialSig.length });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error ? err.stack : undefined;
      this.#logger?.error("frost.debug.signRawMessage.signShare_threw", {
        agentShort, epochId, error: msg, stack,
        secretSigningShareType: typeof (share.secret as unknown as Record<string, unknown>)?.signingShare,
        secretIdentifierType: typeof (share.secret as unknown as Record<string, unknown>)?.identifier,
        pubCommitmentsLength: (share.pub as unknown as Record<string, unknown[]>)?.commitments?.length,
        pubVerifyingSharesKeys: Object.keys((share.pub as unknown as Record<string, Record<string, unknown>>)?.verifyingShares ?? {}).slice(0, 3),
        commitmentListLength: commitmentList?.length,
        framedMsgIsUint8Array: framedMsg instanceof Uint8Array,
      });
      return { ok: false, reason: "AGENT_NOT_BOOTSTRAPPED" };
    }

    return { ok: true, partialSignature: partialSig };
  }

  // ─── checkConflict ────────────────────────────────────────────────────────────

  /**
   * Check whether a ceremony request from peerIdString creates a conflict.
   *
   * Returns true if there is already an in-flight ceremony for (agentPubkey, epochId)
   * from a DIFFERENT Peer ID. Returns false if:
   *   - No in-flight ceremony exists (no conflict)
   *   - Same Peer ID as the in-flight ceremony (retry — not a conflict)
   */
  checkConflict(
    agentPubkey: string,
    epochId: string,
    peerIdString: string,
    _ceremonyId: string
  ): boolean {
    const conflictKey = `${agentPubkey}:${epochId}`;
    const entry = this.#inFlight.get(conflictKey);
    if (!entry) return false; // no in-flight ceremony
    return entry.peerIdString !== peerIdString; // true = different peer = conflict
  }

  // ─── markInFlight ─────────────────────────────────────────────────────────────

  /**
   * Register (agentPubkey, epochId) as in-flight for peerIdString.
   *
   * Called when a ceremony round begins to track which Peer ID owns the ceremony.
   * A subsequent request from a different Peer ID will be detected as a conflict.
   */
  markInFlight(
    agentPubkey: string,
    epochId: string,
    peerIdString: string,
    ceremonyId: string
  ): void {
    const conflictKey = `${agentPubkey}:${epochId}`;
    this.#inFlight.set(conflictKey, { peerIdString, ceremonyId });
  }

  // ─── clearInFlight ────────────────────────────────────────────────────────────

  /**
   * Remove the in-flight registry entry for (agentPubkey, epochId).
   * Called when a ceremony completes or is abandoned.
   */
  clearInFlight(agentPubkey: string, epochId: string): void {
    const conflictKey = `${agentPubkey}:${epochId}`;
    this.#inFlight.delete(conflictKey);
  }

  // ─── injectShareForTest ───────────────────────────────────────────────────────

  /**
   * TEST-ONLY: Inject a LocalShare (FrostSecret + FrostPublic) into the handler's store.
   *
   * This simulates what would happen after a real DKG ceremony — the test can
   * provide the handler with a share from a known deal so it can participate in
   * signing rounds alongside the coordinator (FrostThresholdSigner) using the
   * same FrostPublic.
   *
   * Call stub.getShareForTest() before passing to obtain the LocalShare.
   *
   * SECURITY NOTE: only used in test contexts to populate the handler with share
   * material that was generated by the test's bootstrapKeyShares call.
   */
  injectShareForTest(
    agentPubkey: string,
    epochId: string,
    share: LocalShare
  ): void {
    if (process.env.NODE_ENV !== "test") {
      throw new BootstrapNotAllowedInProduction();
    }
    this.#shareStore.storeShare(agentPubkey, epochId, share);
    this.#currentEpoch.set(agentPubkey, parseEpochN(epochId) ?? 1);
  }

  // ─── DKG rounds ───────────────────────────────────────────────────────────────
  //
  // Implements the 3-round interactive FROST DKG per RFC 9591.
  // Each directory node maintains its own DKG_Secret between rounds.
  // State machine per (agentPubkey, epochId): idle → round1_complete → round2_complete → finalized
  //
  // SECURITY: dkgSecret (polynomial coefficients) NEVER appears in any return value,
  // error message, or log output. Only shareCommitment (group public key) is returned
  // from round3. ed25519_FROST.DKG.clean(secret) is called after round3 or on error.

  /**
   * Round 1: generate secret polynomial, store DKG secret, return public broadcast.
   *
   * FROST DKG §5.1 (RFC 9591): each participant generates a secret polynomial and
   * publishes a commitment and proof-of-knowledge.
   *
   * @param agentPubkey - hex-encoded K_local public key of the registering agent
   * @param epochId - epoch identifier: "${agentPubkey}:epoch:1"
   * @param signers - threshold parameters { min, max }
   */
  async dkgRound1(
    agentPubkey: string,
    epochId: string,
    signers: { min: number; max: number },
  ): Promise<DkgRound1Result> {
    const stateKey = `${agentPubkey}:${epochId}`;
    if (this.#dkgStates.has(stateKey)) {
      return { ok: false, reason: "already_in_progress" };
    }

    // Derive a stable FROST participant identifier from this node's ID.
    // RFC 9591 §4.2: identifiers must be unique among participants.
    const participantId = ed25519_FROST.Identifier.derive(this.#nodeId);

    // Generate secret polynomial and public commitment (RFC 9591 §5.1).
    // round1() returns { public: DKG_Round1, secret: DKG_Secret }
    // SECURITY: secret contains polynomial coefficients — never returned or logged.
    const r1 = ed25519_FROST.DKG.round1(participantId, signers);

    const broadcast: DkgRound1Broadcast = {
      identifier: r1.public.identifier,
      commitment: r1.public.commitment.map((c: Uint8Array) => new Uint8Array(c)),
      proofOfKnowledge: new Uint8Array(r1.public.proofOfKnowledge),
    };

    this.#dkgStates.set(stateKey, {
      secret: r1.secret,
      round1Public: broadcast,
      step: "round1_complete",
    });

    return { ok: true, broadcast };
    // SECURITY: r1.secret is stored in #dkgStates and never returned.
  }

  /**
   * Round 2: receive other participants' round1 broadcasts, compute round2 shares.
   *
   * FROST DKG §5.2 (RFC 9591): each participant evaluates its polynomial at each
   * other participant's identifier and sends the result as a signing share.
   *
   * @param agentPubkey - hex-encoded K_local public key
   * @param epochId - epoch identifier
   * @param othersRound1 - round1 broadcasts from ALL other participants (not including self)
   */
  async dkgRound2(
    agentPubkey: string,
    epochId: string,
    othersRound1: DkgRound1Broadcast[],
  ): Promise<DkgRound2Result> {
    const stateKey = `${agentPubkey}:${epochId}`;
    const state = this.#dkgStates.get(stateKey);
    if (!state || state.step !== "round1_complete") {
      return { ok: false, reason: "not_in_round1" };
    }

    // Convert DkgRound1Broadcast → @noble/curves DKG_Round1 shape
    const othersPublic = othersRound1.map((b) => ({
      identifier: b.identifier,
      commitment: b.commitment.map((c) => new Uint8Array(c)),
      proofOfKnowledge: new Uint8Array(b.proofOfKnowledge),
    }));

    // round2() returns Record<identifier, { identifier, signingShare }>
    // SECURITY: secret is mutated in-place by round2 (step advances to 2 internally).
    const shares = ed25519_FROST.DKG.round2(state.secret, othersPublic);

    // Convert to DkgRound2Share array.
    // The Record from round2() is keyed by TARGET identifier.
    // The value's `identifier` field is the SENDER's identifier (this node).
    //
    // DkgRound2Share.identifier = SENDER's identifier, because:
    //   - round3() matches round2 shares against round1 packages by identifier
    //   - The round1 package is identified by its sender (who submitted the broadcast)
    //   - So the round2 share must carry the sender's (this node's) identifier
    //
    // The coordinator routes shares to recipients using the targetIdentifier field.
    const sharesForOthers: DkgRound2Share[] = Object.entries(shares).map(([targetId, share]) => {
      const s = share as { identifier: string; signingShare: Uint8Array };
      return {
        identifier: s.identifier,   // SENDER's identifier (for round3 verification)
        targetIdentifier: targetId, // RECIPIENT's identifier (for coordinator routing)
        signingShare: new Uint8Array(s.signingShare),
      };
    });

    state.step = "round2_complete";

    return { ok: true, sharesForOthers };
  }

  /**
   * Round 3: receive round2 shares addressed to this node, finalize key, store FrostSecret.
   *
   * FROST DKG §5.3 (RFC 9591): each participant aggregates the received shares,
   * verifies them against the commitments, and derives the group public key.
   *
   * After round3, the FrostSecret is stored in the ShareStore for future signing ceremonies.
   *
   * @param agentPubkey - hex-encoded K_local public key
   * @param epochId - epoch identifier
   * @param sharesForMe - round2 shares addressed to this node (from all other participants)
   * @param allOthersRound1 - round1 broadcasts from all OTHER participants (same as round2 input)
   */
  async dkgRound3(
    agentPubkey: string,
    epochId: string,
    sharesForMe: DkgRound2Share[],
    allOthersRound1: DkgRound1Broadcast[],
  ): Promise<DkgRound3Result> {
    const stateKey = `${agentPubkey}:${epochId}`;
    const state = this.#dkgStates.get(stateKey);
    if (!state || state.step !== "round2_complete") {
      return { ok: false, reason: "not_in_round2" };
    }

    // Convert to @noble/curves expected shapes
    const round1Packages = allOthersRound1.map((b) => ({
      identifier: b.identifier,
      commitment: b.commitment.map((c) => new Uint8Array(c)),
      proofOfKnowledge: new Uint8Array(b.proofOfKnowledge),
    }));
    const round2Packages = sharesForMe.map((s) => ({
      identifier: s.identifier,
      signingShare: new Uint8Array(s.signingShare),
    }));

    let key: { public: import("@noble/curves/abstract/frost.js").FrostPublic; secret: import("@noble/curves/abstract/frost.js").FrostSecret };
    try {
      // round3(secret, othersRound1, sharesForMe) — RFC 9591 §5.3
      // Verifies each share against the corresponding commitment before aggregating.
      // Throws if any share fails verification.
      key = ed25519_FROST.DKG.round3(state.secret, round1Packages, round2Packages);
    } catch (err) {
      // Clean up secret material on error (RFC 9591: forward secrecy of polynomial)
      try { ed25519_FROST.DKG.clean(state.secret); } catch { /* ignore */ }
      this.#dkgStates.delete(stateKey);
      // SECURITY: do NOT include error message or state in return value
      this.#logger?.error("frost.dkg.round3.failed", { error: err instanceof Error ? err.message : "unknown" });
      return { ok: false, reason: "share_verification_failed" };
    }

    // Store the finalized FrostSecret in the share store (same path as bootstrapKeyShares).
    // This makes the node ready for signing ceremonies.
    const share: LocalShare = { secret: key.secret, pub: key.public };
    this.#shareStore.storeShare(agentPubkey, epochId, share);
    this.#currentEpoch.set(agentPubkey, parseEpochN(epochId) ?? 1);

    // Clean up DKG state — the DKG_Secret (polynomial) is no longer needed.
    // The FrostSecret (signing share) is now in the share store.
    try { ed25519_FROST.DKG.clean(state.secret); } catch { /* ignore */ }
    this.#dkgStates.delete(stateKey);

    // Return ONLY the group public key (commitments[0] = 32-byte Ed25519 point).
    // SECURITY: key.secret (the signing share) is stored in shareStore, never returned.
    const shareCommitment = new Uint8Array(key.public.commitments[0]);
    return { ok: true, shareCommitment };
  }

  // ─── Private helpers ──────────────────────────────────────────────────────────

  #signWithShare(
    share: LocalShare,
    tbs: Uint8Array,
    context: FrostContext,
    commitmentList: NonceCommitments[],
  ): CeremonyRoundResult {
    // Message framing: context\0tbs (domain separation per CRYPTO-003)
    const msg = frameMessage(context, tbs);

    // Generate a fresh nonce for this round (in-process test path only).
    // The network path uses signRawMessage which requires a pre-committed nonce from #pendingNonces.
    const nonceResult = ed25519_FROST.commit(share.secret);

    // Append this node's nonce commitment to the list provided by the coordinator
    const fullCommitmentList: NonceCommitments[] =
      commitmentList.length > 0
        ? [...commitmentList, nonceResult.commitments]
        : [nonceResult.commitments];

    // Compute partial signature
    let partialSig: Uint8Array;
    try {
      partialSig = ed25519_FROST.signShare(
        share.secret,
        share.pub,
        nonceResult.nonces,
        fullCommitmentList,
        msg
      );
    } catch (err) {
      // Crypto failure — do NOT include share bytes in the error
      this.#logger?.error("frost.sign.share.failed", { error: err instanceof Error ? err.message : "unknown error" });
      return { ok: false, reason: "AGENT_NOT_BOOTSTRAPPED" };
    }

    // Return ONLY the partial signature — share.secret is NOT included
    return { ok: true, partialSignature: partialSig };
  }

  #fireFallbackCanary(event: FallbackCanaryEvent): void {
    // M2: log only — no push notification
    this.#logger?.warn("frost.ceremony.fallback.canary", {
      agentId: event.agentPubkey.slice(0, 16),
      epochId: event.epochId,
      inFlightPeerId: event.inFlightPeerId,
      conflictingPeerId: event.conflictingPeerId,
      timestamp: event.timestamp,
    });
    if (this.#onFallbackCanary) {
      this.#onFallbackCanary(event);
    }
  }

  #isExpiredEpoch(agentPubkey: string, epochId: string): boolean {
    const requestedN = parseEpochN(epochId);
    if (requestedN === null) return false;

    const currentN = this.#currentEpoch.get(agentPubkey);
    if (currentN === undefined) return false; // agent unknown → not bootstrapped (different error)

    // If the requested epoch N < current epoch N, it's expired
    return requestedN < currentN;
  }
}

// ─── Module-level helpers ─────────────────────────────────────────────────────

/**
 * Parse epoch number N from an epoch identifier.
 * Format: "...:{anything}:epoch:{N}"
 * Returns null if the format doesn't match.
 */
function parseEpochN(epochId: string): number | null {
  const match = /^.*:epoch:(\d+)$/.exec(epochId);
  if (!match) return null;
  return parseInt(match[1], 10);
}

/**
 * Frame a TBS with a context string for domain separation.
 * Encoding: `<context>\0<tbs>`
 *
 * This matches the framing in @cello-protocol/crypto frost-threshold-signer.ts so that
 * the directory's partial signatures are compatible with the client-side aggregation.
 */
function frameMessage(context: string, tbs: Uint8Array): Uint8Array {
  const enc = new TextEncoder();
  const ctxBytes = enc.encode(context);
  const framed = new Uint8Array(ctxBytes.length + 1 + tbs.length);
  framed.set(ctxBytes, 0);
  framed[ctxBytes.length] = 0x00; // null separator (domain separation)
  framed.set(tbs, ctxBytes.length + 1);
  return framed;
}
