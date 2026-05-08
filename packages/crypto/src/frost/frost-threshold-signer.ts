/**
 * FrostThresholdSigner — FROST threshold signing over Ed25519 (RFC 9591)
 *
 * CELLO-CRYPTO-003
 *
 * Crypto reference: FROST / RFC 9591, Ed25519 / RFC 8032
 * Implementation: @noble/curves/ed25519 — ed25519_FROST
 *
 * ─── Phase P: Pseudocode ─────────────────────────────────────────────────────
 *
 * bootstrapKeyShares(agentPubkey, config):
 *   // TEST-ONLY shortcut — NOT real multi-round DKG (that's M3)
 *   // Guard: only callable in NODE_ENV=test
 *   assert NODE_ENV === 'test'
 *   identifiers = [derive(stub.id) for stub in stubs]
 *   dealerShares = trustedDealer({ min: threshold, max: participants }, identifiers)
 *   // Distribute each stub its share (persists in stub.#key)
 *   for each stub, share in dealerShares.secretShares:
 *     stub.receiveShare(share, dealerShares.public)
 *   // primary_pubkey = commitments[0] from the shared public package
 *   primary_pubkey = dealerShares.public.commitments[0]
 *   // Persist client's local key share (stored in module-level map keyed by agentPubkey)
 *   storeLocalShare(agentPubkey, { share: agentShare, pub: dealerShares.public })
 *   return { primaryPubkey: primary_pubkey }
 *   // NOTE: signing share NEVER returned or logged
 *
 * FrostThresholdSigner.participateInCeremony(ceremonyId, tbs, context):
 *   // Coordinator flow — RFC 9591 Section 5
 *   frame(tbs, context) → msg = encode(context + '\0' + tbs)  // domain separation
 *   localShare = loadLocalShare(agentPubkey)
 *   if localShare is null: throw "not bootstrapped"
 *   availableStubs = stubs (or directoryNodes via stream in production)
 *
 *   // Attempt loop — up to maxRetries
 *   for attempt in 1..maxRetries (honoring ceremonyTimeout):
 *     reachableStubs = stubs where not excluded
 *     if |reachableStubs| < threshold: return DIRECTORY_BELOW_THRESHOLD
 *     selectedStubs = reachableStubs[0..threshold-1]
 *
 *     // Round 1 — collect commitments (coordinator generates local nonce too)
 *     localNonce = commit(localShare.secret)
 *     commitments = [localNonce.commitments]
 *     for each stub in selectedStubs:
 *       c = stub.generateCommitment()
 *       commitments.push(c.commitment)
 *     commitmentList = sort(commitments, by identifier)
 *
 *     // Round 2 — collect partial signatures (with per-node timeout)
 *     validShares = {}
 *     excludedInThisRound = []
 *     for each (stub, stubCommitment) in selectedStubs (with roundTimeout):
 *       partialSig = await stub.signRound(pub, commitmentList, msg)  // timeout → null
 *       if partialSig is null: excludedInThisRound.push(stub); continue
 *       if !verifyShare(pub, commitmentList, msg, stub.id, partialSig):
 *         excludedInThisRound.push(stub); continue  // invalid partial — same as timeout
 *       validShares[stub.id] = partialSig
 *
 *     // Also compute coordinator's own partial sig
 *     coordinatorPartialSig = signShare(localShare.secret, pub, localNonce.nonces, commitmentList, msg)
 *     validShares[coordinatorId] = coordinatorPartialSig
 *
 *     if |validShares| >= threshold:
 *       signature = aggregate(pub, commitmentList, msg, validShares)
 *       return { ok: true, signature }
 *     else:
 *       // Not enough valid shares — retry with different participants
 *       continue
 *
 *   return { ok: false, error: { reason: 'CEREMONY_EXHAUSTED' } }
 *
 * primary_pubkey derivation:
 *   // In trustedDealer mode: commitments[0] is the group public key
 *   // This is the constant term of the dealer's Shamir polynomial commitment
 *   // It is deterministic given the dealer's secret polynomial
 *   // All participants' public shares verify against the same commitments[0]
 *   primary_pubkey = dealerShares.public.commitments[0]
 *
 * Round timeout / node replacement:
 *   // Each stub.signRound wraps in Promise.race([real, timeoutPromise])
 *   // If timeout wins → stub treated as excluded (same path as invalid sig)
 *   // On retry, excluded stubs are filtered from available pool
 *   // If available < threshold → DIRECTORY_BELOW_THRESHOLD (not retried)
 *
 * ─── End Pseudocode ──────────────────────────────────────────────────────────
 */

import { ed25519_FROST } from "@noble/curves/ed25519.js";
import type {
  FrostPublic,
  FrostSecret,
} from "@noble/curves/abstract/frost.js";
import type {
  IThresholdSigner,
  ThresholdSignature,
  FrostThresholdSignerConfig,
  DirectoryNodeStub,
  BootstrapResult,
  FrostContext,
} from "./types.js";
import { CONTEXT_SESSION_ESTABLISHMENT, CONTEXT_SEAL } from "./types.js";

// ─── Types ────────────────────────────────────────────────────────────────────

type AgentPubkeyHex = string;

interface LocalShare {
  readonly secret: FrostSecret;
  readonly pub: FrostPublic;
}

// Module-level store for local key shares, keyed by agent pubkey hex.
// This keeps the signing share within the package boundary.
// Private (#) module-level map — not exported.
const _localShares = new Map<AgentPubkeyHex, LocalShare>();

/**
 * Clear all local key shares stored in the module-level map.
 *
 * TEST-ONLY: guards against accumulation of key material across test cases.
 * Call in afterEach/afterAll to evict shares seeded by bootstrapKeyShares.
 *
 * Throws if called outside NODE_ENV=test so it can never be misused in
 * production (where it would collapse multi-party FROST to zero-share state).
 */
export function clearTestShares(): void {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("clearTestShares is test-only and must not be called in production");
  }
  _localShares.clear();
}

// ─── Message framing for domain separation ────────────────────────────────────

/**
 * Frame a TBS with a context string for domain separation.
 *
 * Encoding: `<context>\0<tbs>`
 * The null byte separator ensures unambiguous parsing: a context string
 * cannot contain \0, so there is no collision between different contexts
 * even when TBS bytes have the same content.
 */
function frameMessage(context: string, tbs: Uint8Array): Uint8Array {
  const enc = new TextEncoder();
  const ctxBytes = enc.encode(context);
  // context + 0x00 separator + tbs
  const framed = new Uint8Array(ctxBytes.length + 1 + tbs.length);
  framed.set(ctxBytes, 0);
  framed[ctxBytes.length] = 0x00; // null separator
  framed.set(tbs, ctxBytes.length + 1);
  return framed;
}

// ─── Agent pubkey serialization ───────────────────────────────────────────────

function toHex(bytes: Uint8Array): AgentPubkeyHex {
  return Buffer.from(bytes).toString("hex");
}

// ─── bootstrapKeyShares ───────────────────────────────────────────────────────

/**
 * Test-harness shortcut for key share bootstrap.
 *
 * GUARD: Only callable in NODE_ENV=test. This is NOT a real multi-round DKG
 * (that comes in M3). It uses trustedDealer to pre-populate shares for testing.
 *
 * Behavior:
 * 1. Generate FROST shares via trustedDealer for all n stub nodes
 * 2. Distribute each stub its signing share
 * 3. One of the identifiers is the "client" (coordinator) — its share is stored locally
 * 4. primary_pubkey = commitments[0] from the shared public package
 * 5. Return { primaryPubkey } — no key material beyond the group public key
 */
export async function bootstrapKeyShares(
  agentPubkey: Uint8Array,
  config: FrostThresholdSignerConfig,
): Promise<BootstrapResult> {
  if (process.env.NODE_ENV !== "test") {
    throw new Error(
      "bootstrapKeyShares is a test-only shortcut. " +
        "Real DKG (M3) is required in production.",
    );
  }

  const stubs = config.directoryNodeStubs;
  if (!stubs || stubs.length === 0) {
    throw new Error("bootstrapKeyShares requires directoryNodeStubs in test mode");
  }

  const { threshold, participants } = config;

  // Identifiers: one per stub node + one for the client (coordinator)
  // The client acts as participant "client:<agentPubkeyHex>"
  const clientIdStr = `client:${toHex(agentPubkey)}`;
  const clientIdentifier = ed25519_FROST.Identifier.derive(clientIdStr);
  const stubIdentifiers = stubs.map((stub) =>
    ed25519_FROST.Identifier.derive(stub.id),
  );
  const allIdentifiers = [clientIdentifier, ...stubIdentifiers];

  // trustedDealer: produces one FrostPublic + per-participant FrostSecret shares
  // The dealer polynomial's constant term commitment is the group public key.
  const deal = ed25519_FROST.trustedDealer(
    { min: threshold, max: participants + 1 }, // +1 for the client
    allIdentifiers,
  );

  // Distribute shares to stubs
  for (const stub of stubs) {
    const stubId = ed25519_FROST.Identifier.derive(stub.id);
    const stubShare = deal.secretShares[stubId];
    if (!stubShare) {
      throw new Error(`No share generated for stub ${stub.id}`);
    }
    stub.receiveShare(stubShare, deal.public);
  }

  // Store client's local share
  const clientShare = deal.secretShares[clientIdentifier];
  if (!clientShare) {
    throw new Error("No share generated for client");
  }
  _localShares.set(toHex(agentPubkey), {
    secret: clientShare,
    pub: deal.public,
  });

  // primary_pubkey = commitments[0] = the group public key (32-byte Ed25519 point)
  const primaryPubkey = deal.public.commitments[0];

  // Return ONLY primaryPubkey — no key material
  return { primaryPubkey: new Uint8Array(primaryPubkey) };
}

// ─── FrostThresholdSigner ─────────────────────────────────────────────────────

export class FrostThresholdSigner implements IThresholdSigner {
  readonly #config: Required<
    Omit<FrostThresholdSignerConfig, "directoryNodes" | "directoryNodeStubs">
  > & {
    readonly directoryNodes?: string[];
    readonly directoryNodeStubs?: DirectoryNodeStub[];
  };
  readonly #agentPubkey: Uint8Array;

  static readonly #DEFAULT_ROUND_TIMEOUT_MS = 3000;
  static readonly #DEFAULT_CEREMONY_TIMEOUT_MS = 30000;
  static readonly #DEFAULT_MAX_RETRIES = 3;

  constructor(config: FrostThresholdSignerConfig, agentPubkey: Uint8Array) {
    this.#config = {
      threshold: config.threshold,
      participants: config.participants,
      directoryNodes: config.directoryNodes,
      directoryNodeStubs: config.directoryNodeStubs,
      roundTimeoutMs:
        config.roundTimeoutMs ?? FrostThresholdSigner.#DEFAULT_ROUND_TIMEOUT_MS,
      ceremonyTimeoutMs:
        config.ceremonyTimeoutMs ??
        FrostThresholdSigner.#DEFAULT_CEREMONY_TIMEOUT_MS,
      maxRetries: config.maxRetries ?? FrostThresholdSigner.#DEFAULT_MAX_RETRIES,
    };
    this.#agentPubkey = agentPubkey;
  }

  /**
   * Get the group public key (primary_pubkey) for this signer.
   * Returns the key from the stored local share (populated by bootstrapKeyShares).
   */
  getPrimaryPubkey(): Uint8Array {
    const localShare = _localShares.get(toHex(this.#agentPubkey));
    if (!localShare) {
      throw new Error(
        "Not bootstrapped: call bootstrapKeyShares before using FrostThresholdSigner",
      );
    }
    return new Uint8Array(localShare.pub.commitments[0]);
  }

  /**
   * Verify a threshold signature against a public key and TBS with context.
   * Used by callers (and tests) to verify signatures produced by participateInCeremony.
   */
  verifySignature(
    signature: Uint8Array,
    tbs: Uint8Array,
    context: string,
    publicKey: Uint8Array,
  ): boolean {
    try {
      const msg = frameMessage(context, tbs);
      return ed25519_FROST.verify(signature, msg, publicKey);
    } catch {
      return false;
    }
  }

  /**
   * Participate in a FROST threshold signing ceremony as coordinator.
   *
   * RFC 9591 Section 5 coordinator flow with in-process stubs.
   * Full round coordination, timeout handling, and participant exclusion.
   */
  async participateInCeremony(
    ceremonyId: string,
    tbs: Uint8Array,
    context: FrostContext,
  ): Promise<ThresholdSignature> {
    const localShare = _localShares.get(toHex(this.#agentPubkey));
    if (!localShare) {
      throw new Error(
        "Not bootstrapped: call bootstrapKeyShares before using FrostThresholdSigner",
      );
    }

    const stubs = this.#config.directoryNodeStubs ?? [];
    const { threshold, roundTimeoutMs, ceremonyTimeoutMs, maxRetries } =
      this.#config;

    // Frame message for domain separation: context\0tbs
    const msg = frameMessage(context, tbs);

    const { pub } = localShare;
    const clientId = ed25519_FROST.Identifier.derive(
      `client:${toHex(this.#agentPubkey)}`,
    );

    // Ceremony-level timeout: a deadline across all retry attempts
    const ceremonyDeadline = Date.now() + ceremonyTimeoutMs;

    // Pre-ceremony availability check (RFC 9591 §5 coordinator pre-check):
    // Count nodes reachable at initiation. If fewer than (threshold - 1) are
    // reachable, fail immediately — the ceremony cannot possibly succeed.
    // (threshold - 1 because the client itself is one of the threshold signers)
    const reachableAtInitiation = stubs.filter((s) => s.isReachable());
    if (reachableAtInitiation.length < threshold - 1) {
      return {
        ok: false,
        error: { reason: "DIRECTORY_BELOW_THRESHOLD" },
      };
    }

    // Within-ceremony exclusion: stubs excluded during THIS ceremony.
    // A stub is excluded (within this ceremony) when it: (a) times out or
    // (b) returns an invalid partial signature (treated identically per story spec).
    // On each new participateInCeremony call, the exclusion set resets.
    const ceremonyExcluded = new Set<string>();

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      // Check ceremony-level timeout at the start of each attempt
      if (Date.now() >= ceremonyDeadline) {
        return {
          ok: false,
          error: { reason: "CEREMONY_TIMEOUT" },
        };
      }

      // Available stubs: reachable at initiation and not excluded in this ceremony
      const available = reachableAtInitiation.filter(
        (s) => !ceremonyExcluded.has(s.id),
      );

      // Select (threshold - 1) stubs for this round (client counts as one signer)
      const selected = available.slice(0, threshold - 1);

      if (selected.length < threshold - 1) {
        // Not enough non-excluded nodes remain for this attempt (fewer than
        // threshold - 1 stubs available after excluding failed nodes). Since the
        // client counts as one of the threshold signers, fewer than (threshold - 1)
        // stub participants means the ceremony cannot possibly succeed regardless of
        // further retries. Return DIRECTORY_BELOW_THRESHOLD immediately — same as
        // the pre-ceremony check — rather than sleeping and timing out with
        // CEREMONY_TIMEOUT (which would diverge from the spec).
        return {
          ok: false,
          error: { reason: "DIRECTORY_BELOW_THRESHOLD" },
        };
      }

      // Round 1: generate fresh nonces + commitment list
      const localNonce = ed25519_FROST.commit(localShare.secret);
      const stubCommits = selected.map((s) => s.generateCommitment());
      const commitmentList = [
        localNonce.commitments,
        ...stubCommits.map((c) => c.nonceCommitment),
      ];

      // Round 2: collect partial signatures with per-node timeout
      const sigShares: Record<string, Uint8Array> = {};
      let anyFailedThisRound = false;

      for (let i = 0; i < selected.length; i++) {
        const stub = selected[i];

        // Check ceremony timeout before each node
        if (Date.now() >= ceremonyDeadline) {
          return {
            ok: false,
            error: { reason: "CEREMONY_TIMEOUT" },
          };
        }

        // Race stub response against per-node timeout
        const timeoutPromise = new Promise<null>((resolve) =>
          setTimeout(() => resolve(null), roundTimeoutMs),
        );

        let partialSig: Uint8Array | null;
        try {
          partialSig = await Promise.race([
            stub.signRound({ pub, commitmentList, msg }),
            timeoutPromise,
          ]);
        } catch {
          partialSig = null;
        }

        if (partialSig === null) {
          // Timeout — exclude this stub for the rest of this ceremony;
          // pick replacement (different stub) in the next attempt
          ceremonyExcluded.add(stub.id);
          anyFailedThisRound = true;
          continue;
        }

        // Verify partial sig — invalid treated identically to timeout (story spec §AC-006)
        // The invalid partial is NEVER passed to the combiner/aggregator.
        let isValid: boolean;
        try {
          const stubId = ed25519_FROST.Identifier.derive(stub.id);
          isValid = ed25519_FROST.verifyShare(pub, commitmentList, msg, stubId, partialSig);
        } catch {
          isValid = false;
        }

        if (!isValid) {
          // Invalid partial sig — exclude for rest of this ceremony (same path as timeout)
          ceremonyExcluded.add(stub.id);
          anyFailedThisRound = true;
          continue;
        }

        const stubId = ed25519_FROST.Identifier.derive(stub.id);
        // String(stubId) makes the bigint→string coercion explicit: @noble/curves
        // Identifier is a bigint, and Record<string,…> keys are strings. Using
        // String() here documents the conversion rather than relying on implicit
        // JS coercion, and must match how aggregate() looks up shares.
        sigShares[String(stubId)] = partialSig;
      }

      // If any stub failed, this round's commitment list is inconsistent —
      // the failed stubs committed but did not sign valid shares.
      // Restart with a fresh participant set on the next attempt.
      if (anyFailedThisRound) {
        continue;
      }

      // All selected stubs provided valid partial sigs. Compute client's partial sig.
      let clientSig: Uint8Array;
      try {
        clientSig = ed25519_FROST.signShare(
          localShare.secret,
          pub,
          localNonce.nonces,
          commitmentList,
          msg,
        );
        sigShares[String(clientId)] = clientSig;
      } catch {
        continue;
      }

      if (Object.keys(sigShares).length < threshold) {
        continue;
      }

      // Aggregate
      let signature: Uint8Array;
      try {
        signature = ed25519_FROST.aggregate(pub, commitmentList, msg, sigShares);
      } catch {
        continue;
      }

      return { ok: true, signature };
    }

    // Check if we timed out or exhausted retries
    if (Date.now() >= ceremonyDeadline) {
      return {
        ok: false,
        error: { reason: "CEREMONY_TIMEOUT" },
      };
    }

    return {
      ok: false,
      error: { reason: "CEREMONY_EXHAUSTED" },
    };
  }
}

// ─── MockThresholdSigner ──────────────────────────────────────────────────────

/**
 * MockThresholdSigner: confirms the IThresholdSigner swap point is real.
 *
 * Implements IThresholdSigner without any FROST crypto. Used by AC-010 to
 * verify that callers work correctly against the interface without knowing
 * the concrete implementation.
 *
 * Returns a deterministic 64-byte signature (not cryptographically valid,
 * but structurally correct for interface tests).
 */
export class MockThresholdSigner implements IThresholdSigner {
  async participateInCeremony(
    _ceremonyId: string,
    tbs: Uint8Array,
    _context: FrostContext,
  ): Promise<ThresholdSignature> {
    // Return a 64-byte mock signature derived from the TBS
    // Not cryptographically valid — only for interface shape testing
    const sig = new Uint8Array(64);
    for (let i = 0; i < Math.min(tbs.length, 32); i++) {
      sig[i] = tbs[i];
    }
    sig[63] = 0x42; // marker
    return { ok: true, signature: sig };
  }

  verifySignature(
    _signature: Uint8Array,
    _tbs: Uint8Array,
    _context: FrostContext,
    _publicKey: Uint8Array,
  ): boolean {
    // Mock: always returns false (not a real verifier)
    return false;
  }
}

// Re-export context constants for convenience
export { CONTEXT_SESSION_ESTABLISHMENT, CONTEXT_SEAL };
