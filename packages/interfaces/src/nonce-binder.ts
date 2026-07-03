/**
 * NonceBinder — local, idempotent single-use enforcement for pre-auth capabilities (M8B-PREAUTH-CAP).
 *
 * A pre-auth capability is a signed permission slip every directory verifies independently. Single-use
 * is enforced by binding the capability's `nonce` to the DKG epoch it authorizes: one nonce ⇒ one agent.
 * The bind is LOCAL per directory (never replicated — N nodes writing the same nonce concurrently would
 * halt logical replication). Single-use still holds: in an all-N ceremony every node binds locally; in a
 * quorum ceremony (> N/2) any two attempts share an overlapping node that rejects the replay.
 */

/** Result of binding a nonce to a registration epoch. */
export type NonceBindResult =
  | { bound: true } // first bind on this node, OR an idempotent re-bind to the SAME epoch
  | { bound: false; reason: "NONCE_ALREADY_BOUND" }; // already bound to a DIFFERENT epoch (replay)

export interface NonceBinder {
  /**
   * Bind `nonce` to `epochId`, idempotently. Returns `{ bound: true }` if the nonce was unbound (now
   * bound) or already bound to this same `epochId` (re-presentation within the same registration).
   * Returns `{ bound: false, reason: "NONCE_ALREADY_BOUND" }` if the nonce is already bound to a
   * DIFFERENT epoch — a replay into a second agent. Never throws for the bound/rejected distinction;
   * only infrastructure failures (DB unreachable) reject the promise.
   */
  bind(nonce: string, epochId: string): Promise<NonceBindResult>;
}
