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
   * CELLO-M7-SESSION-003: record that a session recipient's standing relay
   * connection is established (recipient authenticated). Keyed by recipient
   * pubkey — the same key as #deliveryQueues. Flips a prior 'gone' back to
   * 'alive' (a 'gone' verdict is never sticky across a genuine reconnect).
   * Returns { changed: true } only when the tracked state actually transitioned
   * to 'alive' (so the caller emits session.liveness.changed exactly once).
   */
  recordRecipientAlive(pubkeyHex: string): { changed: boolean };

  /**
   * CELLO-M7-SESSION-003: record that a tracked recipient's standing connection
   * has dropped (positive disconnect observation). No-op for an untracked
   * recipient — the relay NEVER fabricates 'gone' from a missing entry. Returns
   * { changed: true } only when an 'alive' entry transitioned to 'gone'.
   */
  recordRecipientGone(pubkeyHex: string): { changed: boolean };

  /**
   * CELLO-M7-SESSION-003: read a recipient's session-path liveness.
   * 'alive' iff the relay currently holds the standing connection; 'gone' iff a
   * disconnect was positively observed with no subsequent reconnect; 'unknown'
   * iff the recipient was never tracked. observedAt is the Unix ms of the last
   * transition (0 for 'unknown').
   */
  getRecipientLiveness(pubkeyHex: string): { liveness: "alive" | "gone" | "unknown"; observedAt: number };

  /**
   * CELLO-M6B-009 AC-006/AC-007: Sweep idle sessions.
   * Destroys sessions with lastActivityAt older than (Date.now() - maxIdleMs) and status 'active'.
   * Returns the hex session IDs of destroyed sessions.
   */
  sweepIdleSessions(maxIdleMs: number, logger: Logger): string[];

  /**
   * Test-only: back-date a session's lastActivityAt without going through setSession().
   *
   * setSession() always refreshes lastActivityAt to Date.now(), which makes it impossible
   * to test the idle-sweep logic using only the public API. This method directly sets
   * the stored timestamp, allowing tests to simulate aged-out sessions.
   *
   * @internal Do not call from production code — the method name is intentionally prefixed with
   * double-underscore to signal test-only use. This method is part of the interface because
   * idle-sweep tests require cross-package access (e2e-tests → relay-store). Moving it outside
   * the interface would require duplicating the session storage structure or exporting internal
   * Map references.
   */
  __setLastActivityAtForTest(sessionIdHex: string, ts: number): void;
}

const DELIVERY_QUEUE_BOUND = 256;

export class InMemoryRelayStore implements RelayStore {
  readonly #sessions = new Map<string, RelaySessionState>();
  readonly #deliveryQueues = new Map<string, Array<{ session_id: Uint8Array; leaf_kind: number; sequence_number: number; structure2_cbor: Uint8Array; structure1_cbor: Uint8Array }>>();
  // CELLO-M7-SESSION-003: per-recipient session-path liveness, keyed by recipient
  // pubkey (same key as #deliveryQueues). Absence of an entry means 'unknown'.
  readonly #liveness = new Map<string, { liveness: "alive" | "gone"; observedAt: number }>();
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

  // ─── CELLO-M7-SESSION-003: session-path liveness ────────────────────────────

  recordRecipientAlive(pubkeyHex: string): { changed: boolean } {
    const prior = this.#liveness.get(pubkeyHex);
    const changed = prior?.liveness !== "alive";
    this.#liveness.set(pubkeyHex, { liveness: "alive", observedAt: Date.now() });
    return { changed };
  }

  recordRecipientGone(pubkeyHex: string): { changed: boolean } {
    const prior = this.#liveness.get(pubkeyHex);
    // Never fabricate 'gone' for an untracked recipient — absence is 'unknown'.
    if (prior === undefined) return { changed: false };
    const changed = prior.liveness !== "gone";
    this.#liveness.set(pubkeyHex, { liveness: "gone", observedAt: Date.now() });
    return { changed };
  }

  getRecipientLiveness(pubkeyHex: string): { liveness: "alive" | "gone" | "unknown"; observedAt: number } {
    const entry = this.#liveness.get(pubkeyHex);
    if (entry === undefined) return { liveness: "unknown", observedAt: 0 };
    return { liveness: entry.liveness, observedAt: entry.observedAt };
  }

  /**
   * Test-only: back-date a session's lastActivityAt without going through setSession().
   * See interface JSDoc for full documentation.
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
  sweepIdleSessions(maxIdleMs: number, logger: Logger): string[] {
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

    return toSweep.map((s) => s.sessionIdHex);
  }
}
