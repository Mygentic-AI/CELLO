/**
 * CELLO Relay — RelayStore and InMemoryRelayStore (NODE-002)
 *
 * RelayStore: persistence abstraction for relay session state.
 * InMemoryRelayStore: in-process implementation for M1 testing.
 */

import type { RelaySessionState, SessionAssignment } from "./relay-types.js";
import type { Logger } from "@cello-protocol/interfaces";

export interface RelayStore {
  /** Record a new session assignment from the directory. Returns false if session already exists. */
  recordSession(assignment: SessionAssignment, genesisRoot: Uint8Array): boolean;

  /** Get session state, or undefined if not found. */
  getSession(sessionIdHex: string): RelaySessionState | undefined;

  /** Update an existing session (replace state). Caller holds the mutation lock per session. */
  setSession(sessionIdHex: string, state: RelaySessionState): void;

  /** Destroy all per-session state after confirmSeal. */
  destroySession(sessionIdHex: string): void;

  /** Queue a leaf_deliver frame for a pubkey that has no active stream. Drops oldest if at the 256-frame bound. */
  enqueueDelivery(pubkeyHex: string, delivery: { session_id: Uint8Array; leaf_kind: number; sequence_number: number; structure2_cbor: Uint8Array; structure1_cbor: Uint8Array }): void;

  /** Drain the pending queue for a pubkey. Returns [] if none. */
  drainDeliveries(pubkeyHex: string): Array<{ session_id: Uint8Array; leaf_kind: number; sequence_number: number; structure2_cbor: Uint8Array; structure1_cbor: Uint8Array }>;

  /**
   * CELLO-M6B-009 AC-006/AC-007: Sweep idle sessions.
   * Destroys sessions with lastActivityAt older than (Date.now() - maxIdleMs) and status 'active'.
   * Returns the count of destroyed sessions.
   */
  sweepIdleSessions(maxIdleMs: number, logger: Logger): number;
}

const DELIVERY_QUEUE_BOUND = 256;

export class InMemoryRelayStore implements RelayStore {
  readonly #sessions = new Map<string, RelaySessionState>();
  readonly #deliveryQueues = new Map<string, Array<{ session_id: Uint8Array; leaf_kind: number; sequence_number: number; structure2_cbor: Uint8Array; structure1_cbor: Uint8Array }>>();

  recordSession(assignment: SessionAssignment, genesisRoot: Uint8Array): boolean {
    const key = Buffer.from(assignment.session_id).toString("hex");
    if (this.#sessions.has(key)) return false;
    this.#sessions.set(key, {
      assignment,
      genesis_prev_root: genesisRoot,
      seq_counter: 0,
      leaf_log: [],
      status: "active",
      tree_stack: [],
      running_root: genesisRoot,
      lastActivityAt: Date.now(), // CELLO-M6B-009 AC-009
    });
    return true;
  }

  getSession(sessionIdHex: string): RelaySessionState | undefined {
    return this.#sessions.get(sessionIdHex);
  }

  setSession(sessionIdHex: string, state: RelaySessionState): void {
    // CELLO-M6B-009 AC-009: update lastActivityAt on every write
    state.lastActivityAt = Date.now();
    this.#sessions.set(sessionIdHex, state);
  }

  destroySession(sessionIdHex: string): void {
    this.#sessions.delete(sessionIdHex);
  }

  enqueueDelivery(pubkeyHex: string, delivery: { session_id: Uint8Array; leaf_kind: number; sequence_number: number; structure2_cbor: Uint8Array; structure1_cbor: Uint8Array }): void {
    let queue = this.#deliveryQueues.get(pubkeyHex);
    if (!queue) {
      queue = [];
      this.#deliveryQueues.set(pubkeyHex, queue);
    }
    if (queue.length >= DELIVERY_QUEUE_BOUND) {
      queue.shift(); // drop oldest per spec (DB-001)
      console.warn(`[relay] relay_backpressure: delivery queue full for ${pubkeyHex.slice(0, 16)}…, oldest frame dropped`);
    }
    queue.push(delivery);
  }

  drainDeliveries(pubkeyHex: string): Array<{ session_id: Uint8Array; leaf_kind: number; sequence_number: number; structure2_cbor: Uint8Array; structure1_cbor: Uint8Array }> {
    const queue = this.#deliveryQueues.get(pubkeyHex);
    if (!queue || queue.length === 0) return [];
    const items = queue.splice(0);
    return items;
  }

  /**
   * CELLO-M6B-009 AC-006/AC-007: Sweep idle sessions.
   *
   * Destroys sessions with:
   *   - lastActivityAt < (Date.now() - maxIdleMs)
   *   - status === 'active'
   *
   * Sessions in 'sealing' or 'seal_rejected' status are not swept.
   * Sessions that transition to 'sealed' call destroySession in confirmSeal — they are already removed.
   *
   * SI-001: Mutex-holding sessions have recent lastActivityAt (setSession refreshes it) — cannot be swept mid-write.
   */
  sweepIdleSessions(maxIdleMs: number, logger: Logger): number {
    const now = Date.now();
    const cutoff = now - maxIdleMs;
    let sweptCount = 0;
    const remainingBeforeSweep = this.#sessions.size;

    for (const [sessionIdHex, state] of this.#sessions.entries()) {
      if (state.status === "active" && state.lastActivityAt < cutoff) {
        const idleDurationMs = now - state.lastActivityAt;
        logger.info("relay.session.idle.swept", { sessionId: sessionIdHex, idleDurationMs });
        this.#sessions.delete(sessionIdHex);
        sweptCount++;
      }
    }

    const remainingCount = remainingBeforeSweep - sweptCount;
    logger.info("relay.session.sweep.complete", { sweptCount, remainingCount });

    return sweptCount;
  }
}
