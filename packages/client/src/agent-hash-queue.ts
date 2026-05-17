/**
 * CELLO-PERSIST-012 — Agent Hash Queue + Signed Relay ACKs
 *
 * ── Pseudocode (Phase P) ──────────────────────────────────────────────────────
 *
 * The agent hash queue is a first-class protocol primitive. When relay connectivity
 * is interrupted, the P2P conversation continues and hashes accumulate in the queue.
 * On relay recovery or reassignment, queued hashes are submitted in FIFO order.
 *
 * buildSignedAckTbs(hashHex, sequenceNumber, timestamp):
 *   // RFC 8032 (Ed25519), FIPS 180-4 (SHA-256)
 *   // Deterministic TBS for signing and verification. Fixed-width encodings prevent
 *   // ambiguity: a 4-byte and an 8-byte integer concatenated to 32-byte hash bytes.
 *   hashBytes = Buffer.from(hashHex, 'hex')               // 32 bytes
 *   seqBuf    = 4-byte big-endian uint32                   // 4 bytes
 *   tsBuf     = 8-byte big-endian uint64                   // 8 bytes
 *   preimage  = concat(hashBytes, seqBuf, tsBuf)           // 44 bytes
 *   return SHA-256(preimage)                                // 32 bytes
 *
 * verifyRelayAck(hashHex, ack, relayPubkey):
 *   // Reconstructs TBS and verifies Ed25519 signature
 *   tbs = buildSignedAckTbs(hashHex, ack.sequenceNumber, ack.timestamp)
 *   if ack.signature.length !== 64: return false
 *   return Ed25519.verify(relayPubkey, tbs, ack.signature)
 *
 * AgentHashQueue.enqueue(sessionId, hashHex, correlationId):
 *   // Must happen BEFORE relay submission (AC-001)
 *   pending = await #loadPending(sessionId)
 *   entry = { hashHex, sessionId, enqueuedAt: Date.now() }
 *   pending.push(entry)
 *   await #savePending(sessionId, pending)
 *   logger.info("client.hashqueue.enqueued", { agentId, sessionId, hashHex,
 *               queueDepth: pending.length, correlationId })
 *
 * AgentHashQueue.processAck(sessionId, hashHex, ack, lookupRelayPubkey, correlationId):
 *   // 1. Verify ACK signature (SI-001: never remove without valid ACK)
 *   relayPubkey = await lookupRelayPubkey(ack.relayId)
 *   if relayPubkey === null || !verifyRelayAck(hashHex, ack, relayPubkey):
 *     logger.warn("client.relay.ack.invalid", { agentId, sessionId, hashHex, reason })
 *     return  // hash stays in queue
 *   // 2. Store ACK as cryptographic receipt (SI-003: immutable, never overwrite)
 *   existing = await #loadAck(hashHex)
 *   if existing === undefined:
 *     await #saveAck(hashHex, ack)
 *   // 3. Remove from pending queue (only AFTER ACK is stored)
 *   pending = await #loadPending(sessionId)
 *   pending = pending.filter(e => e.hashHex !== hashHex)
 *   await #savePending(sessionId, pending)
 *   logger.info("client.hashqueue.acked", { agentId, sessionId, hashHex,
 *               sequenceNumber: ack.sequenceNumber, correlationId })
 *
 * AgentHashQueue.pollDepth():
 *   // Called on 30-second interval (externally scheduled)
 *   // Logs client.hashqueue.depth when depth > 0 (AC-006)
 *   // Also checks for stale entries (DB-001)
 *   allPending = await #loadAllPending()
 *   depth = total pending count
 *   if depth === 0: return
 *   logger.info("client.hashqueue.depth", { agentId, depth })
 *   // Check staleness
 *   oldestEntry = entry with minimum enqueuedAt
 *   oldestAge = Date.now() - oldestEntry.enqueuedAt
 *   if oldestAge > hashQueueMaxAgeMs:
 *     logger.warn("client.hashqueue.stale", { agentId, depth, oldestHashAge: oldestAge })
 *
 * Storage keys:
 *   pending queue:  "hq:pending:{sessionId}" → JSON PendingHashEntry[]
 *   ACK receipt:    "hq:ack:{hashHex}"        → JSON StoredRelayAck
 *   All-sessions index: "hq:sessions"         → JSON string[] of sessionIds with queues
 */

import { createHash } from "node:crypto";
import { verify } from "@cello/crypto";
import type { ClientStore, Logger } from "@cello/interfaces";

// ─── Types ────────────────────────────────────────────────────────────────────

/** A single entry in the local pending hash queue. */
export interface PendingHashEntry {
  /** Session this hash belongs to. */
  sessionId: string;
  /** SHA-256 content hash as lowercase hex (32 bytes → 64 chars). */
  hashHex: string;
  /** Unix ms when the entry was enqueued. Used for staleness checks. */
  enqueuedAt: number;
}

/** A relay's signed ACK for a submitted hash. Stored as an immutable receipt. */
export interface RelayAck {
  /** Stable identifier for the signing relay (used for pubkey lookup). */
  relayId: string;
  /** 32-byte Ed25519 public key of the relay that signed this ACK. */
  relayPubkey: Uint8Array;
  /** Relay-assigned sequence number for this hash. */
  sequenceNumber: number;
  /** Unix ms timestamp embedded in the ACK TBS. */
  timestamp: number;
  /** 64-byte Ed25519 signature over SHA-256(hashHex_bytes || seq_BE4 || ts_BE8). */
  signature: Uint8Array;
}

/** Stored form of RelayAck in ClientStore (JSON-serializable). */
interface StoredRelayAck {
  relayId: string;
  relayPubkeyHex: string;
  sequenceNumber: number;
  timestamp: number;
  signatureHex: string;
}

/** Sentinel returned by handleResubmitRejection when predecessor relay is unknown. */
export const RELAY_PREDECESSOR_UNKNOWN = "RELAY_PREDECESSOR_UNKNOWN" as const;
export type RelayPredecessorUnknown = typeof RELAY_PREDECESSOR_UNKNOWN;

/** Options for constructing an AgentHashQueue. */
export interface AgentHashQueueOptions {
  /** ClientStore for persisting the queue and ACK receipts. */
  store: ClientStore;
  /** Stable agent identifier — included in all log events. */
  agentId: string;
  /** Structured logger injected at the composition root. */
  logger: Logger;
  /**
   * Maximum age (ms) for a pending hash before DB-001 stale warning fires.
   * Default: 24 * 60 * 60 * 1000 (24 hours).
   */
  hashQueueMaxAgeMs?: number;
}

// ─── Storage key helpers ──────────────────────────────────────────────────────

function pendingKey(sessionId: string): string {
  return `hq:pending:${sessionId}`;
}

function ackKey(hashHex: string): string {
  return `hq:ack:${hashHex}`;
}

const SESSIONS_INDEX_KEY = "hq:sessions";

// ─── Pure crypto helpers ──────────────────────────────────────────────────────

/**
 * Build the to-be-signed bytes for a relay ACK.
 *
 * TBS = SHA-256(hash_bytes || seq_BE4 || ts_BE8)
 *
 * Deterministic fixed-width encoding prevents ambiguity:
 *   hash_bytes: 32 bytes from hex decode
 *   seq_BE4:    4-byte big-endian uint32
 *   ts_BE8:     8-byte big-endian uint64 (using BigInt for full 64-bit range)
 *
 * RFC 8032 (Ed25519), FIPS 180-4 (SHA-256)
 */
export function buildSignedAckTbs(
  hashHex: string,
  sequenceNumber: number,
  timestamp: number,
): Uint8Array {
  // 32 bytes: the content hash
  const hashBytes = Buffer.from(hashHex, "hex");

  // 4 bytes: sequence_number as big-endian uint32
  const seqBuf = Buffer.allocUnsafe(4);
  seqBuf.writeUInt32BE(sequenceNumber >>> 0, 0);

  // 8 bytes: timestamp as big-endian uint64 (using BigInt for correctness)
  const tsBuf = Buffer.allocUnsafe(8);
  const tsBig = BigInt(timestamp);
  tsBuf.writeBigUInt64BE(tsBig, 0);

  const preimage = Buffer.concat([hashBytes, seqBuf, tsBuf]);
  const digest = createHash("sha256").update(preimage).digest();
  return new Uint8Array(digest);
}

/**
 * Verify a relay ACK signature.
 *
 * Returns true if:
 *   - ack.signature is exactly 64 bytes
 *   - Ed25519.verify(relayPubkey, buildSignedAckTbs(hashHex, ack.sequenceNumber, ack.timestamp), ack.signature) is true
 *
 * RFC 8032 (Ed25519), FIPS 180-4 (SHA-256)
 */
export function verifyRelayAck(
  hashHex: string,
  ack: RelayAck,
  relayPubkey: Uint8Array,
): boolean {
  if (ack.signature.length !== 64) return false;
  const tbs = buildSignedAckTbs(hashHex, ack.sequenceNumber, ack.timestamp);
  return verify(relayPubkey, tbs, ack.signature);
}

// ─── AgentHashQueue ───────────────────────────────────────────────────────────

/**
 * Manages the local queue of Structure 1 hashes pending relay submission.
 *
 * Security invariants:
 *   SI-001: A hash is never removed from the pending queue without a valid stored ACK.
 *           The remove-from-queue step only executes after ACK verification passes.
 *   SI-002: getPending() returns items in strict insertion order. The caller is
 *           responsible for FIFO submission — the queue does not reorder.
 *   SI-003: Once an ACK is stored for a hash, subsequent ACKs for the same hash
 *           do not overwrite the existing receipt.
 *
 * Persistence: all state is stored in the injected ClientStore using JSON encoding.
 * Keys: "hq:pending:{sessionId}" and "hq:ack:{hashHex}".
 */
export class AgentHashQueue {
  readonly #store: ClientStore;
  readonly #agentId: string;
  readonly #logger: Logger;
  readonly #hashQueueMaxAgeMs: number;

  constructor(opts: AgentHashQueueOptions) {
    this.#store = opts.store;
    this.#agentId = opts.agentId;
    this.#logger = opts.logger;
    this.#hashQueueMaxAgeMs = opts.hashQueueMaxAgeMs ?? 24 * 60 * 60 * 1000;
  }

  // ─── Enqueue ───────────────────────────────────────────────────────────────

  /**
   * Enqueue a hash in the local hash queue before relay submission.
   *
   * Must be called BEFORE attempting relay submission (AC-001).
   * The hash is present in the queue until a valid signed ACK is processed.
   *
   * Logs: client.hashqueue.enqueued with { agentId, sessionId, hashHex, queueDepth, correlationId }
   */
  async enqueue(sessionId: string, hashHex: string, correlationId: string): Promise<void> {
    // Track the session in the sessions index for pollDepth()
    await this.#addToSessionsIndex(sessionId);

    const pending = await this.#loadPending(sessionId);
    const entry: PendingHashEntry = {
      sessionId,
      hashHex,
      enqueuedAt: Date.now(),
    };
    pending.push(entry);
    await this.#savePending(sessionId, pending);

    this.#logger.info("client.hashqueue.enqueued", {
      agentId: this.#agentId,
      sessionId,
      hashHex,
      queueDepth: pending.length,
      correlationId,
    });
  }

  // ─── Process ACK ──────────────────────────────────────────────────────────

  /**
   * Process a relay ACK for a previously enqueued hash.
   *
   * Steps (SI-001 enforced):
   *   1. Look up the relay's public key via lookupRelayPubkey(ack.relayId).
   *   2. Verify the ACK signature with verifyRelayAck().
   *   3. If verification fails: log client.relay.ack.invalid; return WITHOUT touching the queue.
   *   4. Store the ACK as immutable receipt (SI-003: skip if already stored).
   *   5. Remove the hash from the pending queue ONLY after ACK is stored.
   *
   * @param sessionId       - session the hash belongs to
   * @param hashHex         - the hash being ACKed
   * @param ack             - the relay's ACK frame
   * @param lookupRelayPubkey - async function that looks up relay pubkey by relayId
   * @param correlationId   - correlation ID for log tracing
   */
  async processAck(
    sessionId: string,
    hashHex: string,
    ack: RelayAck,
    lookupRelayPubkey: (relayId: string) => Promise<Uint8Array | null>,
    correlationId: string,
  ): Promise<void> {
    // Step 1: Look up the relay's public key
    const relayPubkey = await lookupRelayPubkey(ack.relayId);

    // Step 2: Verify ACK signature
    let validationError: string | null = null;
    if (relayPubkey === null) {
      validationError = "relay_pubkey_not_found";
    } else if (ack.signature.length !== 64) {
      validationError = "signature_malformed";
    } else if (!verifyRelayAck(hashHex, ack, relayPubkey)) {
      validationError = "signature_invalid";
    }

    if (validationError !== null) {
      // Step 3: Invalid — log warning and leave hash in queue (SI-001)
      this.#logger.warn("client.relay.ack.invalid", {
        agentId: this.#agentId,
        sessionId,
        hashHex,
        reason: validationError,
      });
      return;
    }

    // Step 4: Store ACK as immutable receipt (SI-003: never overwrite existing ACK)
    const existing = await this.#loadAck(hashHex);
    if (existing === undefined) {
      await this.#saveAck(hashHex, ack);
    }
    // If already stored: SI-003 guarantees the first ACK is preserved.

    // Step 5: Remove from pending queue ONLY after ACK is stored
    const pending = await this.#loadPending(sessionId);
    const updated = pending.filter((e) => e.hashHex !== hashHex);
    await this.#savePending(sessionId, updated);

    this.#logger.info("client.hashqueue.acked", {
      agentId: this.#agentId,
      sessionId,
      hashHex,
      sequenceNumber: ack.sequenceNumber,
      correlationId,
    });
  }

  // ─── Queue inspection ──────────────────────────────────────────────────────

  /**
   * Return all pending (un-ACKed) hashes for a session in insertion order (SI-002).
   */
  async getPending(sessionId: string): Promise<PendingHashEntry[]> {
    return this.#loadPending(sessionId);
  }

  /**
   * Return the stored relay ACK for a hash, or undefined if not yet ACKed.
   */
  async getAck(hashHex: string): Promise<RelayAck | undefined> {
    return this.#loadAck(hashHex);
  }

  /**
   * Return the total number of pending hashes for a session.
   */
  async depth(sessionId: string): Promise<number> {
    const pending = await this.#loadPending(sessionId);
    return pending.length;
  }

  // ─── Depth polling (AC-006, DB-001) ──────────────────────────────────────

  /**
   * Poll the total queue depth across all sessions.
   *
   * If depth > 0: logs client.hashqueue.depth at INFO with { agentId, depth }.
   * If depth > 0 and oldest entry is older than hashQueueMaxAgeMs: additionally logs
   *   client.hashqueue.stale at WARN with { agentId, depth, oldestHashAge } (DB-001).
   *
   * Called externally on a 30-second interval while the agent is running.
   * Test-friendly: call directly without waiting.
   */
  async pollDepth(): Promise<void> {
    const allPending = await this.#loadAllPending();
    const depth = allPending.length;
    if (depth === 0) return;

    this.#logger.info("client.hashqueue.depth", {
      agentId: this.#agentId,
      depth,
    });

    // DB-001: stale check
    const now = Date.now();
    let oldest = now;
    for (const entry of allPending) {
      if (entry.enqueuedAt < oldest) {
        oldest = entry.enqueuedAt;
      }
    }
    const oldestHashAge = now - oldest;
    if (oldestHashAge > this.#hashQueueMaxAgeMs) {
      this.#logger.warn("client.hashqueue.stale", {
        agentId: this.#agentId,
        depth,
        oldestHashAge,
      });
    }
  }

  // ─── Error handlers ────────────────────────────────────────────────────────

  /**
   * Handle a re-submission rejection from the new relay.
   *
   * Logs client.relay.resubmit.rejected at ERROR with { agentId, sessionId, hashHex, reason }.
   * The hash remains in the pending queue (DB-002: operator must resolve manually).
   *
   * @returns the reason string (for caller convenience)
   */
  async handleResubmitRejection(
    sessionId: string,
    hashHex: string,
    reason: string,
    _correlationId: string,
  ): Promise<string> {
    this.#logger.error("client.relay.resubmit.rejected", {
      agentId: this.#agentId,
      sessionId,
      hashHex,
      reason,
    });
    // Hash stays in queue — no state mutation
    return reason;
  }

  // ─── Private storage helpers ───────────────────────────────────────────────

  async #loadPending(sessionId: string): Promise<PendingHashEntry[]> {
    const raw = await this.#store.get(pendingKey(sessionId));
    if (raw === undefined) return [];
    try {
      return JSON.parse(Buffer.from(raw).toString("utf8")) as PendingHashEntry[];
    } catch {
      return [];
    }
  }

  async #savePending(sessionId: string, entries: PendingHashEntry[]): Promise<void> {
    const raw = Buffer.from(JSON.stringify(entries), "utf8");
    await this.#store.set(pendingKey(sessionId), new Uint8Array(raw));
  }

  async #loadAck(hashHex: string): Promise<RelayAck | undefined> {
    const raw = await this.#store.get(ackKey(hashHex));
    if (raw === undefined) return undefined;
    try {
      const stored = JSON.parse(Buffer.from(raw).toString("utf8")) as StoredRelayAck;
      return {
        relayId: stored.relayId,
        relayPubkey: new Uint8Array(Buffer.from(stored.relayPubkeyHex, "hex")),
        sequenceNumber: stored.sequenceNumber,
        timestamp: stored.timestamp,
        signature: new Uint8Array(Buffer.from(stored.signatureHex, "hex")),
      };
    } catch {
      return undefined;
    }
  }

  async #saveAck(hashHex: string, ack: RelayAck): Promise<void> {
    const stored: StoredRelayAck = {
      relayId: ack.relayId,
      relayPubkeyHex: Buffer.from(ack.relayPubkey).toString("hex"),
      sequenceNumber: ack.sequenceNumber,
      timestamp: ack.timestamp,
      signatureHex: Buffer.from(ack.signature).toString("hex"),
    };
    const raw = Buffer.from(JSON.stringify(stored), "utf8");
    await this.#store.set(ackKey(hashHex), new Uint8Array(raw));
  }

  async #addToSessionsIndex(sessionId: string): Promise<void> {
    const raw = await this.#store.get(SESSIONS_INDEX_KEY);
    let sessions: string[] = [];
    if (raw !== undefined) {
      try {
        sessions = JSON.parse(Buffer.from(raw).toString("utf8")) as string[];
      } catch {
        sessions = [];
      }
    }
    if (!sessions.includes(sessionId)) {
      sessions.push(sessionId);
      const newRaw = Buffer.from(JSON.stringify(sessions), "utf8");
      await this.#store.set(SESSIONS_INDEX_KEY, new Uint8Array(newRaw));
    }
  }

  async #loadAllPending(): Promise<PendingHashEntry[]> {
    const raw = await this.#store.get(SESSIONS_INDEX_KEY);
    if (raw === undefined) return [];
    let sessions: string[] = [];
    try {
      sessions = JSON.parse(Buffer.from(raw).toString("utf8")) as string[];
    } catch {
      return [];
    }

    const all: PendingHashEntry[] = [];
    for (const sessionId of sessions) {
      const pending = await this.#loadPending(sessionId);
      all.push(...pending);
    }
    return all;
  }
}
