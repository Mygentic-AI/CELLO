/**
 * CELLO Relay — RelayStore and InMemoryRelayStore (NODE-002)
 *
 * RelayStore: persistence abstraction for relay session state.
 * InMemoryRelayStore: in-process implementation for M1 testing.
 */

import type { RelaySessionState, SessionAssignment } from "./relay-types.js";
import type { Logger } from "@cello-protocol/interfaces";

// No-op logger used when no logger is injected into InMemoryRelayStore.
const NOOP_LOGGER: Logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

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
  readonly #logger: Logger;

  constructor(opts?: { logger?: Logger }) {
    this.#logger = opts?.logger ?? NOOP_LOGGER;
  }

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
    // CELLO-M6B-009 AC-009: update lastActivityAt on every write.
    // Spread to avoid mutating the caller's object — the caller's reference retains
    // the lastActivityAt value it passed in, while the stored copy has the refreshed timestamp.
    this.#sessions.set(sessionIdHex, { ...state, lastActivityAt: Date.now() });
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
      this.#logger.warn("relay.delivery.queue.full", { pubkeyHex: pubkeyHex.slice(0, 16) });
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
   * Test-only: back-date a session's lastActivityAt without going through setSession().
   *
   * setSession() always refreshes lastActivityAt to Date.now(), which makes it impossible
   * to test the idle-sweep logic using only the public API. This method directly sets
   * the stored timestamp, allowing tests to simulate aged-out sessions without relying
   * on the aliasing behaviour of getSession() (which returns a live Map reference today
   * but is not contractually guaranteed to do so).
   *
   * Do not call from production code — the method name is intentionally prefixed with
   * double-underscore to signal test-only use.
   *
   * Pattern rationale: This method must be public on the RelayStore interface because
   * the idle-sweep tests require cross-package access (e2e-tests → relay-store). Moving
   * it outside the interface would require duplicating the session storage structure or
   * exporting internal Map references. TypeScript's `@internal` JSDoc tag was considered
   * but would require `stripInternal: true` in tsconfig (breaking existing exports).
   * Runtime validation (checking NODE_ENV) was rejected because CELLO uses CELLO_ENV
   * ('local'/'dev'/'staging'/'production'), and test runners set CELLO_ENV=local for
   * integration tests — making NODE_ENV an unreliable test/production discriminator.
   * The double-underscore prefix is CELLO's established convention for test utilities
   * that must be exported but should never appear in production call paths.
   */
  __setLastActivityAtForTest(sessionIdHex: string, ts: number): void {
    const state = this.#sessions.get(sessionIdHex);
    if (state === undefined) {
      throw new Error(`__setLastActivityAtForTest: session ${sessionIdHex} not found`);
    }
    this.#sessions.set(sessionIdHex, { ...state, lastActivityAt: ts });
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

    // Collect candidates in a first pass to avoid modifying the Map while iterating it.
    // This is defensive: ECMAScript guarantees deleting the currently-yielded key is safe,
    // but deleting future keys during iteration causes them to be skipped. The two-pass
    // pattern is explicit about intent and safe for future maintainers.
    const toSweep: Array<{ sessionIdHex: string; idleDurationMs: number }> = [];
    for (const [sessionIdHex, state] of this.#sessions.entries()) {
      if (state.status === "active" && state.lastActivityAt < cutoff) {
        toSweep.push({ sessionIdHex, idleDurationMs: now - state.lastActivityAt });
      }
    }

    // Second pass: destroy and log each idle session.
    // Delete before logging so the log reflects what actually happened — if the
    // logger throws synchronously, the session has already been removed from memory
    // and will not leak. Log after delete = "this session was swept", not "we intend
    // to sweep this session".
    for (const { sessionIdHex, idleDurationMs } of toSweep) {
      this.#sessions.delete(sessionIdHex);
      logger.info("relay.session.idle.swept", { sessionId: sessionIdHex, idleDurationMs });
    }

    const sweptCount = toSweep.length;
    const remainingCount = this.#sessions.size;
    logger.info("relay.session.sweep.complete", { sweptCount, remainingCount });

    return sweptCount;
  }
}
