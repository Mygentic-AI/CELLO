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

  /**
   * DOD-REFRESH-1: store a share AND await its durable persistence (unlike fire-and-forget storeShare).
   * A proactive refresh ROTATES the share to a new epoch — if the new-epoch share is reported stored but
   * never lands durably, a directory restart reverts to the old epoch and the client/directory epochs
   * SPLIT (signing breaks). The refresh must therefore confirm the durable write before reporting success.
   * Throws if the durable write fails. In-memory backends resolve immediately.
   */
  storeShareDurable(agentPubkey: string, epochId: string, share: LocalShare): Promise<void>;

  /**
   * DOD-REFRESH-1: the highest epoch N for which this node holds a share for `agentPubkey`, or undefined
   * if none. The epoch-expiry guard derives the current epoch from this (the reloaded shares ARE the epoch
   * record), so "old shares no longer sign" survives a directory restart even though the in-memory
   * #currentEpoch counter does not. Parsed from the "…:epoch:N" store keys.
   */
  getMaxEpoch(agentPubkey: string): number | undefined;

  /**
   * CELLO-M8-LEVER-002 (burn): destroy ALL K_server_X shares for an agent (every epoch). The
   * in-memory entries are removed; the persisted material is ZEROED (agent_key_shares is append-only —
   * row deletion is forbidden, so encrypted_share is overwritten empty: capability dies, the row /
   * accountability survives). Async because the persisted store is async; idempotent.
   */
  destroyShares(agentPubkey: string): Promise<void>;
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

  async storeShareDurable(agentPubkey: string, epochId: string, share: LocalShare): Promise<void> {
    // In-memory store: there is no out-of-process durability to await — storing IS the commit.
    this.#shares.set(`${agentPubkey}:${epochId}`, share);
  }

  getMaxEpoch(agentPubkey: string): number | undefined {
    const prefix = `${agentPubkey}:`;
    let max: number | undefined;
    for (const key of this.#shares.keys()) {
      if (!key.startsWith(prefix)) continue;
      const m = /:epoch:(\d+)$/.exec(key);
      if (!m) continue;
      const n = parseInt(m[1], 10);
      if (max === undefined || n > max) max = n;
    }
    return max;
  }

  async destroyShares(agentPubkey: string): Promise<void> {
    // Remove every (agentPubkey, epoch) entry — the key prefix is "${agentPubkey}:".
    const prefix = `${agentPubkey}:`;
    for (const key of this.#shares.keys()) {
      if (key.startsWith(prefix)) this.#shares.delete(key);
    }
  }
}
