/**
 * In-process directory node stubs for FROST tests.
 *
 * CELLO-CRYPTO-003
 *
 * These stubs mimic the behavior of a real directory node's /cello/frost/1.0.0
 * protocol handler. They exercise the same ceremony protocol logic as real nodes
 * but run in-process for fast, deterministic tests.
 *
 * Stub configuration options:
 * - Normal: responds with valid partial signatures
 * - Unreachable: node is not reachable at initiation (caught by pre-ceremony check)
 * - Unresponsive: reachable at initiation, but signRound times out (returns null)
 * - InvalidResponse: returns random bytes (simulates malformed partial sig)
 */

import { ed25519_FROST } from "@noble/curves/ed25519.js";
import { randomBytes } from "@noble/hashes/utils.js";
import type {
  FrostPublic,
  FrostSecret,
  Nonces,
} from "@noble/curves/abstract/frost.js";
import type {
  DirectoryNodeStub,
  StubSignParams,
  StubCommitment,
} from "./types.js";

// ─── InProcessDirectoryNodeStub ───────────────────────────────────────────────

export class InProcessDirectoryNodeStub implements DirectoryNodeStub {
  readonly id: string;

  // Signing key — received via receiveShare() during bootstrap
  #key: { secret: FrostSecret; pub: FrostPublic } | null = null;

  // Behavior flags
  // #unreachable: not reachable at initiation (isReachable() → false)
  #unreachable = false;
  // #unresponsive: reachable at initiation, but signRound returns null (timeout simulation)
  #unresponsive = false;
  // #invalidResponse: returns random bytes on signRound (malformed partial sig)
  #invalidResponse = false;

  constructor(id: string) {
    this.id = id;
  }

  // ─── DirectoryNodeStub: receiveShare ─────────────────────────────────────────

  /**
   * Receive a FROST signing share from the bootstrap ceremony.
   * Called by bootstrapKeyShares during setup.
   */
  receiveShare(secret: FrostSecret, pub: FrostPublic): void {
    this.#key = { secret, pub };
  }

  /**
   * TEST-ONLY: Return the stored FROST key pair for use by external test harnesses
   * (e.g., to inject a share into a FrostDirectoryHandler via injectShareForTest).
   *
   * This deliberately exposes the raw FrostSecret for test setup purposes.
   * MUST NOT be called outside of test code.
   */
  getShareForTest(): { secret: FrostSecret; pub: FrostPublic } | null {
    return this.#key;
  }

  // ─── Test control methods ────────────────────────────────────────────────────

  /**
   * Mark this node as unreachable at ceremony initiation.
   * isReachable() will return false, causing the coordinator to exclude
   * this node before any rounds begin.
   */
  setUnreachable(flag: boolean): void {
    this.#unreachable = flag;
  }

  /**
   * Mark this node as unresponsive during signing rounds.
   * isReachable() returns true (node is connectable) but signRound returns null
   * (simulates a timeout after connection is established).
   */
  setUnresponsive(flag: boolean): void {
    this.#unresponsive = flag;
  }

  /** Make this stub return random bytes (simulate malformed partial sig) */
  setInvalidResponse(flag: boolean): void {
    this.#invalidResponse = flag;
  }

  // ─── DirectoryNodeStub interface ─────────────────────────────────────────────

  /**
   * Returns whether this node is reachable at ceremony initiation.
   * The coordinator uses this for the pre-ceremony availability check:
   * if fewer than `threshold` nodes are reachable, fail immediately
   * with DIRECTORY_BELOW_THRESHOLD.
   */
  isReachable(): boolean {
    return !this.#unreachable;
  }

  // Cache the pending nonce between generateCommitment() and signRound()
  // Per RFC 9591: nonces are one-time-use — consumed after signRound
  #pendingNonce: Nonces | null = null;

  /**
   * Generate a nonce commitment for the next signing round.
   * Called by the coordinator before collecting partial signatures.
   * Caches the nonce scalars for use in signRound().
   */
  generateCommitment(): StubCommitment {
    if (!this.#key) {
      throw new Error(`Stub ${this.id} has no key share (not bootstrapped)`);
    }
    const nonce = ed25519_FROST.commit(this.#key.secret);
    // Cache nonce scalars so signRound can use them
    this.#pendingNonce = nonce.nonces;
    return {
      nodeId: this.id,
      nonceCommitment: nonce.commitments,
      nonces: nonce.nonces,
    };
  }

  /**
   * Participate in a signing round.
   *
   * Uses the nonce cached from the preceding generateCommitment() call.
   * Returns a never-resolving Promise to simulate timeout (the coordinator's
   * per-node timer will fire first). Returns random bytes to simulate
   * an invalid partial sig.
   *
   * @returns Partial signature bytes, or a hanging Promise (simulate timeout)
   */
  async signRound(params: StubSignParams): Promise<Uint8Array | null> {
    // Unresponsive: simulate a node that never responds.
    // Return a Promise that never resolves — the coordinator's roundTimeoutMs
    // timer will fire first, treating this as a timeout.
    if (this.#unresponsive) {
      return new Promise<Uint8Array | null>(() => {
        // intentionally never resolve — coordinator timeout fires instead
      });
    }

    if (!this.#key) {
      return null;
    }

    // InvalidResponse: return random bytes (not a valid partial sig)
    if (this.#invalidResponse) {
      return new Uint8Array(randomBytes(32));
    }

    // Use the nonce cached from generateCommitment()
    if (!this.#pendingNonce) {
      // No pending nonce — should not happen in normal ceremony flow
      return null;
    }

    const nonces = this.#pendingNonce;
    this.#pendingNonce = null; // consume nonce (one-time use per RFC 9591)

    try {
      const sig = ed25519_FROST.signShare(
        this.#key.secret,
        params.pub,
        nonces,
        params.commitmentList,
        params.msg,
      );
      return sig;
    } catch {
      return null;
    }
  }
}

// ─── createInProcessStubs ─────────────────────────────────────────────────────

/**
 * Create n in-process directory node stubs.
 * Each stub has a unique deterministic ID.
 */
export function createInProcessStubs(n: number): InProcessDirectoryNodeStub[] {
  return Array.from({ length: n }, (_, i) => {
    // Use a stable, deterministic ID that works as a FROST identifier input
    const id = `cello-test-node-${i.toString().padStart(4, "0")}`;
    return new InProcessDirectoryNodeStub(id);
  });
}
