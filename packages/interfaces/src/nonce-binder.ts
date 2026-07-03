/**
 * NonceBinder — local, idempotent single-use enforcement for pre-auth capabilities (M8B-PREAUTH-CAP).
 *
 * A pre-auth capability is a signed permission slip every directory verifies independently. Single-use
 * is enforced by binding the capability's `nonce` to the AGENT it authorizes (the round-1 agent K_local
 * pubkey): one nonce ⇒ one agent. Binding to the agent pubkey — NOT the client-supplied epoch string —
 * is load-bearing: the epoch is attacker-controlled on the wire, so binding to it would let one
 * capability register two different agents under one reused epoch string.
 * The bind is LOCAL per directory (never replicated — N nodes writing the same nonce concurrently would
 * halt logical replication). Single-use still holds: in an all-N ceremony every node binds locally; in a
 * quorum ceremony (> N/2) any two attempts share an overlapping node that rejects the replay.
 */

/** Result of binding a nonce to the agent it authorizes. */
export type NonceBindResult =
  | { bound: true } // first bind on this node, OR an idempotent re-bind to the SAME agent
  | { bound: false; reason: "NONCE_ALREADY_BOUND" }; // already bound to a DIFFERENT agent (replay)

export interface NonceBinder {
  /**
   * Bind `nonce` to `agentPubkey`, idempotently. Returns `{ bound: true }` if the nonce was unbound (now
   * bound) or already bound to this same `agentPubkey` (re-presentation by the other N-1 nodes / retries
   * within the same registration). Returns `{ bound: false, reason: "NONCE_ALREADY_BOUND" }` if the nonce
   * is already bound to a DIFFERENT agent — a replay into a second agent. Never throws for the
   * bound/rejected distinction; only infrastructure failures (DB unreachable) reject the promise.
   */
  bind(nonce: string, agentPubkey: string): Promise<NonceBindResult>;
}
