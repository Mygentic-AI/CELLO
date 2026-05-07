/**
 * CELLO Directory Node — ShareStore (NODE-003)
 *
 * ShareStore: abstraction for K_server_X FROST key share storage.
 * InMemoryShareStore: in-process implementation for M2 testing and initial deployment.
 *
 * ─── Phase P: Pseudocode ─────────────────────────────────────────────────────
 *
 * ShareStore interface:
 *   getShare(agentPubkey, epochId) → LocalShare | undefined
 *     // Look up the K_server_X share for (agentPubkey, epochId)
 *     // Returns undefined if no share stored
 *
 *   storeShare(agentPubkey, epochId, share) → void
 *     // Store the K_server_X share, keyed by (agentPubkey, epochId)
 *     // No share bytes are ever logged or returned beyond this boundary
 *
 * InMemoryShareStore:
 *   #shares = Map<"${agentPubkey}:${epochId}", LocalShare>
 *   getShare(agentPubkey, epochId):
 *     key = "${agentPubkey}:${epochId}"
 *     return #shares.get(key)
 *   storeShare(agentPubkey, epochId, share):
 *     key = "${agentPubkey}:${epochId}"
 *     #shares.set(key, share)
 *
 * Security invariant:
 *   - LocalShare contains FrostSecret (raw key bytes)
 *   - Only the FROST handler within this package may call getShare()
 *   - The interface never exposes FrostSecret outside the directory package
 *   - The storage backend is opaque: share bytes are neither logged nor exported
 *
 * ─── End Pseudocode ──────────────────────────────────────────────────────────
 */

import type { FrostPublic, FrostSecret } from "@noble/curves/abstract/frost.js";

// ─── LocalShare: FROST signing share held by this directory node ─────────────

/**
 * K_server_X local key share for this directory node.
 *
 * SECURITY: FrostSecret contains raw key scalar bytes.
 * This type must NEVER be logged, serialized to wire, or exposed in error messages.
 * It is opaque to any storage backend and only consumed by the FROST signing handler.
 */
export interface LocalShare {
  /** The FROST secret share for this node */
  readonly secret: FrostSecret;
  /** The shared FROST public package (commitment vector, verifying shares) */
  readonly pub: FrostPublic;
}

// ─── ShareStore interface ─────────────────────────────────────────────────────

/**
 * ShareStore: persistence abstraction for K_server_X FROST key shares.
 *
 * The backend is intentionally opaque to the caller: share bytes (FrostSecret)
 * may only be retrieved via getShare() and must never appear in any log,
 * error response, or wire message outside this package.
 */
export interface ShareStore {
  /**
   * Retrieve the K_server_X share for (agentPubkey, epochId).
   * Returns undefined if no share has been stored for that pair.
   */
  getShare(agentPubkey: string, epochId: string): LocalShare | undefined;

  /**
   * Store a K_server_X share for (agentPubkey, epochId).
   * If a share already exists for the key, it is overwritten.
   */
  storeShare(agentPubkey: string, epochId: string, share: LocalShare): void;
}

// ─── InMemoryShareStore ───────────────────────────────────────────────────────

/**
 * InMemoryShareStore: in-process share store for M2 testing and initial deployment.
 *
 * Stores K_server_X shares in a private Map. The composite key is:
 *   "${agentPubkey}:${epochId}"
 *
 * This matches the epoch identifier format defined in NODE-003:
 *   epoch ID format: "{agent_id}:epoch:{N}" (monotonic integer, starts at 1)
 * Combined with agentPubkey, the full store key is:
 *   "${agentPubkeyHex}:${agentIdHex}:epoch:${N}"
 */
export class InMemoryShareStore implements ShareStore {
  readonly #shares = new Map<string, LocalShare>();

  getShare(agentPubkey: string, epochId: string): LocalShare | undefined {
    return this.#shares.get(`${agentPubkey}:${epochId}`);
  }

  storeShare(agentPubkey: string, epochId: string, share: LocalShare): void {
    this.#shares.set(`${agentPubkey}:${epochId}`, share);
  }
}
