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
import type { FrostContext } from "@cello/crypto/frost/types.js";
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

  // In-flight ceremony registry: "${agentPubkey}:${epochId}" → InFlightEntry
  // Tracks which Peer ID owns the in-flight ceremony for each (agent, epoch) pair.
  readonly #inFlight = new Map<string, InFlightEntry>();

  // Current epoch number per agent: agentPubkey → latest epoch N
  // Used to detect expired epoch requests.
  readonly #currentEpoch = new Map<string, number>();

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
    // Check epoch expiry before share lookup — an expired epoch should be rejected even if a
    // share was stored (the share is from a prior epoch and should no longer be used).
    if (this.#isExpiredEpoch(agentPubkey, epochId)) {
      return { ok: false, reason: "EPOCH_EXPIRED" };
    }
    const share = this.#shareStore.getShare(agentPubkey, epochId);
    if (!share) {
      return { ok: false, reason: "AGENT_NOT_BOOTSTRAPPED" };
    }
    const cacheKey = `${agentPubkey}:${epochId}`;
    // Sweep expired entries on each generateCommitment call (LOW-3: prevent memory leak)
    const now = Date.now();
    for (const [k, entry] of this.#pendingNonces) {
      if (now > entry.expiresAt) this.#pendingNonces.delete(k);
    }
    // HIGH-2: reject if a non-expired nonce is already pending — the coordinator must consume it first
    if (this.#pendingNonces.has(cacheKey)) {
      return { ok: false, reason: "NONCE_ALREADY_PENDING" };
    }
    const nonce = ed25519_FROST.commit(share.secret);
    // Cache pending nonce keyed by (agentPubkey, epochId) — consumed exclusively by signRawMessage
    this.#pendingNonces.set(cacheKey, { nonce: nonce.nonces, share, expiresAt: now + FrostDirectoryHandler.#PENDING_NONCE_TTL_MS });
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
    const { agentPubkey, epochId, framedMsg, commitmentList, peerIdString } = params;

    // Conflict check (same as handleCeremonyRound)
    const conflictKey = `${agentPubkey}:${epochId}`;
    const inFlightEntry = this.#inFlight.get(conflictKey);
    if (inFlightEntry && inFlightEntry.peerIdString !== peerIdString) {
      this.#fireFallbackCanary({
        type: "FALLBACK_CANARY",
        agentPubkey,
        epochId,
        inFlightPeerId: inFlightEntry.peerIdString,
        conflictingPeerId: peerIdString,
        timestamp: Date.now(),
      });
      return { ok: false, reason: "CEREMONY_CONFLICT" };
    }

    // Retrieve and consume the cached nonce from the prior generateCommitment call.
    // CRIT-1: a cached nonce is REQUIRED for signRawMessage — no fallback to fresh nonce.
    // The commitment for this nonce was already sent to the coordinator and included in
    // commitmentList. A fresh nonce would have no matching commitment in the list,
    // violating RFC 9591 §4.6 (binding factor input must include every participant's commitment).
    const cacheKey = `${agentPubkey}:${epochId}`;
    const pending = this.#pendingNonces.get(cacheKey);
    if (!pending || Date.now() > pending.expiresAt) {
      // No cached nonce or expired — the two-step commit→sign flow was not followed (or timed out).
      // Return AGENT_NOT_BOOTSTRAPPED so the coordinator excludes this node.
      if (pending) this.#pendingNonces.delete(cacheKey); // clean up expired entry
      return { ok: false, reason: "AGENT_NOT_BOOTSTRAPPED" };
    }
    this.#pendingNonces.delete(cacheKey); // consume — RFC 9591: one-time use

    const { nonce, share } = pending;

    let partialSig: Uint8Array;
    try {
      // commitmentList already includes this node's commitment (sent in frost_commit_response).
      partialSig = ed25519_FROST.signShare(
        share.secret,
        share.pub,
        nonce,
        commitmentList,
        framedMsg,
      );
    } catch (err) {
      console.error("[frost-handler] signRawMessage signShare failed:", err instanceof Error ? err.message : "unknown");
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
      console.error(
        "[frost-handler] signShare failed:",
        err instanceof Error ? err.message : "unknown error"
      );
      return { ok: false, reason: "AGENT_NOT_BOOTSTRAPPED" };
    }

    // Return ONLY the partial signature — share.secret is NOT included
    return { ok: true, partialSignature: partialSig };
  }

  #fireFallbackCanary(event: FallbackCanaryEvent): void {
    // M2: log only — no push notification
    console.warn(
      "[frost-handler] FALLBACK_CANARY:" +
        ` agent=${event.agentPubkey.slice(0, 16)}…` +
        ` epoch=${event.epochId}` +
        ` inFlight=${event.inFlightPeerId}` +
        ` conflict=${event.conflictingPeerId}` +
        ` ts=${event.timestamp}`
    );
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
 * This matches the framing in @cello/crypto frost-threshold-signer.ts so that
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
