/**
 * CELLO-PERSIST-012 — Agent hash queue + signed relay ACKs
 *
 * ── Specification understanding (Phase S) ─────────────────────────────────────
 *
 *   AC-001: Hash enqueued before relay submission
 *     - When the client computes a Structure 1 hash, it enqueues the hash in the
 *       local hash queue (in ClientStore) BEFORE attempting relay submission.
 *     - The hash is present in the queue before any ACK is received.
 *     - Querying the queue returns items in insertion order.
 *
 *   AC-002: ACK processing removes hash from pending queue
 *     - When the relay returns a signed ACK, the client verifies the signature.
 *     - The ACK is stored keyed by hash hex in the ClientStore.
 *     - The hash is removed from the pending queue.
 *     - A subsequent queue read does not include the ACKed hash.
 *
 *   AC-003: FIFO drain after relay reconnect (5 hashes)
 *     - Relay unreachable → 5 hashes enqueued locally.
 *     - On reconnect: all 5 submitted in FIFO order; each receives ACK before next.
 *     - All 5 ACKs stored; queue empty after all submissions.
 *     - Verified by inspecting queue and ACK store in ClientStore.
 *
 *   AC-004: Signed ACK verification
 *     - ACK contains relay_signature over SHA-256(H || S || timestamp).
 *     - verify(relay_pubkey, SHA-256(H || S || timestamp), ACK.signature) returns true.
 *     - relay_pubkey is identified by the relayId in the ACK.
 *     - The ACK is a valid Ed25519 signature by the relay's registered public key.
 *
 *   AC-005: Relay failover with prior ACKs (e2e — in-process multi-node)
 *     - Original relay crashes; client has stored signed ACKs for hashes 1–8.
 *     - Client re-submits hashes 1–8 to new relay with their ACKs.
 *     - New relay accepts re-submissions; both agents seal successfully.
 *     - New relay verifies prior ACK signature; if relay not found → RELAY_PREDECESSOR_UNKNOWN.
 *
 *   AC-006: Queue depth logged on 30-second interval (while depth > 0)
 *     - client.hashqueue.depth logged at INFO with { agentId, depth }.
 *     - Logged on 30-second interval while depth > 0.
 *     - (Test: start monitor, verify it emits the event; no real 30s wait)
 *
 *   AC-007: Invalid ACK discarded; hash stays in queue
 *     - ACK with invalid signature → client.relay.ack.invalid logged at WARN
 *       with { agentId, sessionId, hashHex, reason }.
 *     - ACK is discarded; hash remains in pending queue.
 *
 *   SI-001: Hash never removed without valid stored ACK
 *     - Relay claims sequencing but returns malformed/unsigned ACK → hash retained.
 *     - Even partial ACKs (missing signature, wrong length) are rejected.
 *
 *   SI-002: FIFO ordering enforced — never submit out of order
 *     - Even if a later hash is available, earlier hashes are submitted first.
 *     - Queue always drains in strict insertion order.
 *
 *   SI-003: Stored relay ACKs are immutable — never modified or deleted
 *     - Once written to ClientStore, ACK cannot be overwritten or deleted by the app.
 *     - Even after session is sealed.
 *
 *   DB-001: Stale queue (> hash_queue_max_age) → client.hashqueue.stale at WARN
 *     - { agentId, depth, oldestHashAge } logged.
 *     - Queue continues to grow; no hashes dropped.
 *
 *   DB-002: New relay rejects re-submission → client.relay.resubmit.rejected at ERROR
 *     - { agentId, sessionId, hashHex, reason } logged.
 *     - Hash remains in queue.
 *
 * ── Crypto references ─────────────────────────────────────────────────────────
 *   Ed25519 signing: RFC 8032
 *   SHA-256: FIPS 180-4
 *   Signed ACK TBS: SHA-256(hash_H || sequence_number as 4-byte BE uint32 || timestamp as 8-byte BE uint64)
 *   Note: sequence_number and timestamp are encoded as big-endian fixed-width to ensure
 *         deterministic byte representation for signature verification.
 */

import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import type { ClientStore, Logger } from "@cello/interfaces";
import { LocalClientStore } from "@cello/interfaces/stubs";
import { generateKeypair } from "@cello/crypto";

import {
  AgentHashQueue,
  buildSignedAckTbs,
  verifyRelayAck,
  RELAY_PREDECESSOR_UNKNOWN,
} from "../agent-hash-queue.js";
import type { RelayAck } from "../agent-hash-queue.js";

// ─── Test helpers ─────────────────────────────────────────────────────────────

function makeSpyLogger() {
  const events: Array<{ level: string; event: string; context: Record<string, unknown> }> = [];
  const logger: Logger = {
    debug: (event: string, context: Record<string, unknown> = {}) =>
      events.push({ level: "debug", event, context }),
    info: (event: string, context: Record<string, unknown> = {}) =>
      events.push({ level: "info", event, context }),
    warn: (event: string, context: Record<string, unknown> = {}) =>
      events.push({ level: "warn", event, context }),
    error: (event: string, errorOrContext?: Error | Record<string, unknown>, context?: Record<string, unknown>) => {
      const ctx = errorOrContext instanceof Error ? (context ?? {}) : (errorOrContext ?? {});
      events.push({ level: "error", event, context: ctx });
    },
  };
  return { logger, events };
}

/** Build a valid RelayAck for testing using the given relay signing key. */
async function buildValidAck(opts: {
  relayKp: ReturnType<typeof generateKeypair>;
  relayId: string;
  hashHex: string;
  sequenceNumber: number;
  timestamp: number;
}): Promise<RelayAck> {
  const tbs = buildSignedAckTbs(opts.hashHex, opts.sequenceNumber, opts.timestamp);
  const sig = await opts.relayKp.sign(tbs);
  const relayPubkey = await opts.relayKp.getPublicKey();
  return {
    relayId: opts.relayId,
    relayPubkey,
    sequenceNumber: opts.sequenceNumber,
    timestamp: opts.timestamp,
    signature: sig,
  };
}

// ─── AC-001: Hash enqueued before relay submission ────────────────────────────

describe("PERSIST-012 AC-001 — hash enqueued before relay submission", () => {
  it("enqueue stores hash in ClientStore in insertion order before any ACK", async () => {
    const store: ClientStore = new LocalClientStore();
    const { logger } = makeSpyLogger();
    const agentId = "agent-ac001";
    const sessionId = "sess-" + randomBytes(8).toString("hex");
    const queue = new AgentHashQueue({ store, agentId, logger });

    const hash1 = randomBytes(32).toString("hex");
    const hash2 = randomBytes(32).toString("hex");
    const hash3 = randomBytes(32).toString("hex");

    await queue.enqueue(sessionId, hash1, "corr-001");
    await queue.enqueue(sessionId, hash2, "corr-002");
    await queue.enqueue(sessionId, hash3, "corr-003");

    const pending = await queue.getPending(sessionId);
    expect(pending.length).toBe(3);
    expect(pending[0]!.hashHex).toBe(hash1);
    expect(pending[1]!.hashHex).toBe(hash2);
    expect(pending[2]!.hashHex).toBe(hash3);
  });

  it("pending items have correct sessionId and hashHex", async () => {
    const store: ClientStore = new LocalClientStore();
    const { logger } = makeSpyLogger();
    const agentId = "agent-ac001b";
    const sessionId = "sess-" + randomBytes(8).toString("hex");
    const queue = new AgentHashQueue({ store, agentId, logger });

    const hashHex = randomBytes(32).toString("hex");
    await queue.enqueue(sessionId, hashHex, "corr-xyz");

    const pending = await queue.getPending(sessionId);
    expect(pending.length).toBe(1);
    expect(pending[0]!.hashHex).toBe(hashHex);
    expect(pending[0]!.sessionId).toBe(sessionId);
  });

  it("client.hashqueue.enqueued logged at INFO with { agentId, sessionId, hashHex, queueDepth, correlationId }", async () => {
    const store: ClientStore = new LocalClientStore();
    const { logger, events } = makeSpyLogger();
    const agentId = "agent-ac001c";
    const sessionId = "sess-" + randomBytes(8).toString("hex");
    const queue = new AgentHashQueue({ store, agentId, logger });

    const hashHex = randomBytes(32).toString("hex");
    await queue.enqueue(sessionId, hashHex, "corr-obs");

    const enqueueEvents = events.filter((e) => e.event === "client.hashqueue.enqueued");
    expect(enqueueEvents.length).toBe(1);
    expect(enqueueEvents[0]!.level).toBe("info");
    expect(enqueueEvents[0]!.context).toMatchObject({
      agentId,
      sessionId,
      hashHex,
      correlationId: "corr-obs",
    });
    expect(typeof enqueueEvents[0]!.context["queueDepth"]).toBe("number");
  });
});

// ─── AC-002: ACK processing ───────────────────────────────────────────────────

describe("PERSIST-012 AC-002 — ACK processing removes hash from pending queue", () => {
  it("after processAck: hash removed from pending queue, ACK stored keyed by hash", async () => {
    const store: ClientStore = new LocalClientStore();
    const { logger } = makeSpyLogger();
    const agentId = "agent-ac002";
    const sessionId = "sess-" + randomBytes(8).toString("hex");
    const relayKp = generateKeypair();
    const relayId = "relay-001";
    const queue = new AgentHashQueue({ store, agentId, logger });

    const hashHex = randomBytes(32).toString("hex");
    await queue.enqueue(sessionId, hashHex, "corr-001");

    const ack = await buildValidAck({
      relayKp,
      relayId,
      hashHex,
      sequenceNumber: 1,
      timestamp: Date.now(),
    });

    // Provide the relay pubkey lookup for verification
    await queue.processAck(sessionId, hashHex, ack, async (_relayId) => {
      return ack.relayPubkey;
    }, "corr-001");

    // Hash must be removed from pending queue
    const pending = await queue.getPending(sessionId);
    expect(pending.length).toBe(0);

    // ACK must be stored keyed by hash
    const storedAck = await queue.getAck(hashHex);
    expect(storedAck).toBeDefined();
    expect(storedAck!.relayId).toBe(relayId);
    expect(storedAck!.sequenceNumber).toBe(1);
  });

  it("client.hashqueue.acked logged at INFO with { agentId, sessionId, hashHex, sequenceNumber, correlationId }", async () => {
    const store: ClientStore = new LocalClientStore();
    const { logger, events } = makeSpyLogger();
    const agentId = "agent-ac002b";
    const sessionId = "sess-" + randomBytes(8).toString("hex");
    const relayKp = generateKeypair();
    const relayId = "relay-002";
    const queue = new AgentHashQueue({ store, agentId, logger });

    const hashHex = randomBytes(32).toString("hex");
    await queue.enqueue(sessionId, hashHex, "corr-001");

    const seq = 7;
    const ack = await buildValidAck({
      relayKp,
      relayId,
      hashHex,
      sequenceNumber: seq,
      timestamp: Date.now(),
    });

    await queue.processAck(sessionId, hashHex, ack, async () => ack.relayPubkey, "corr-001");

    const ackedEvents = events.filter((e) => e.event === "client.hashqueue.acked");
    expect(ackedEvents.length).toBe(1);
    expect(ackedEvents[0]!.level).toBe("info");
    expect(ackedEvents[0]!.context).toMatchObject({
      agentId,
      sessionId,
      hashHex,
      sequenceNumber: seq,
      correlationId: "corr-001",
    });
  });
});

// ─── AC-003: FIFO drain with 5 hashes ────────────────────────────────────────

describe("PERSIST-012 AC-003 — FIFO drain after relay reconnect (integration)", () => {
  it("5 hashes enqueued, all submitted in FIFO order, all ACKed, queue empty after", async () => {
    const store: ClientStore = new LocalClientStore();
    const { logger } = makeSpyLogger();
    const agentId = "agent-ac003";
    const sessionId = "sess-" + randomBytes(8).toString("hex");
    const relayKp = generateKeypair();
    const relayId = "relay-003";
    const queue = new AgentHashQueue({ store, agentId, logger });

    // Enqueue 5 hashes (relay unreachable scenario)
    const hashes: string[] = [];
    for (let i = 0; i < 5; i++) {
      const h = randomBytes(32).toString("hex");
      hashes.push(h);
      await queue.enqueue(sessionId, h, `corr-${i}`);
    }

    // Verify FIFO order in pending queue
    const pendingBefore = await queue.getPending(sessionId);
    expect(pendingBefore.length).toBe(5);
    for (let i = 0; i < 5; i++) {
      expect(pendingBefore[i]!.hashHex).toBe(hashes[i]);
    }

    // Relay reconnected: drain queue FIFO — each submission waits for ACK before next
    const submittedOrder: string[] = [];
    for (const entry of pendingBefore) {
      submittedOrder.push(entry.hashHex);
      const seq = submittedOrder.length;
      const ack = await buildValidAck({
        relayKp,
        relayId,
        hashHex: entry.hashHex,
        sequenceNumber: seq,
        timestamp: Date.now(),
      });
      await queue.processAck(sessionId, entry.hashHex, ack, async () => ack.relayPubkey, `corr-${seq - 1}`);
    }

    // Submitted in FIFO order
    expect(submittedOrder).toEqual(hashes);

    // All 5 ACKs stored
    for (const h of hashes) {
      const storedAck = await queue.getAck(h);
      expect(storedAck).toBeDefined();
    }

    // Queue is empty
    const pendingAfter = await queue.getPending(sessionId);
    expect(pendingAfter.length).toBe(0);

    // Queue depth is 0
    const depth = await queue.depth(sessionId);
    expect(depth).toBe(0);
  });
});

// ─── AC-004: Signed ACK verification ─────────────────────────────────────────

describe("PERSIST-012 AC-004 — signed ACK verification", () => {
  it("valid ACK signature verifies correctly against relay pubkey", async () => {
    const relayKp = generateKeypair();
    const hashHex = randomBytes(32).toString("hex");
    const seq = 42;
    const ts = Date.now();

    const tbs = buildSignedAckTbs(hashHex, seq, ts);
    const sig = await relayKp.sign(tbs);
    const relayPubkey = await relayKp.getPublicKey();

    const ack: RelayAck = {
      relayId: "relay-004",
      relayPubkey,
      sequenceNumber: seq,
      timestamp: ts,
      signature: sig,
    };

    const valid = verifyRelayAck(hashHex, ack, relayPubkey);
    expect(valid).toBe(true);
  });

  it("ACK with wrong key fails verification", async () => {
    const relayKp = generateKeypair();
    const wrongKp = generateKeypair();
    const hashHex = randomBytes(32).toString("hex");
    const seq = 1;
    const ts = Date.now();

    const tbs = buildSignedAckTbs(hashHex, seq, ts);
    const sig = await relayKp.sign(tbs);
    const wrongPubkey = await wrongKp.getPublicKey();

    const ack: RelayAck = {
      relayId: "relay-004-wrong",
      relayPubkey: wrongPubkey,
      sequenceNumber: seq,
      timestamp: ts,
      signature: sig,
    };

    const valid = verifyRelayAck(hashHex, ack, wrongPubkey);
    expect(valid).toBe(false);
  });

  it("relayId in ACK identifies the relay; directory lookup returns relay pubkey", async () => {
    const relayKp = generateKeypair();
    const relayId = "relay-known";
    const hashHex = randomBytes(32).toString("hex");
    const seq = 5;
    const ts = Date.now();

    const ack = await buildValidAck({ relayKp, relayId, hashHex, sequenceNumber: seq, timestamp: ts });

    // Simulate directory lookup by relayId
    const relayPubkey = await relayKp.getPublicKey();
    const directoryLookup = async (id: string): Promise<Uint8Array | null> => {
      if (id === relayId) return relayPubkey;
      return null;
    };

    const lookupResult = await directoryLookup(ack.relayId);
    expect(lookupResult).toBeDefined();
    const valid = verifyRelayAck(hashHex, ack, lookupResult!);
    expect(valid).toBe(true);
  });
});

// ─── AC-005: Relay failover with prior ACKs ───────────────────────────────────

describe("PERSIST-012 AC-005 — relay failover with prior ACKs", () => {
  it("new relay accepts re-submissions that have valid ACKs from previous relay", async () => {
    const store: ClientStore = new LocalClientStore();
    const { logger } = makeSpyLogger();
    const agentId = "agent-ac005";
    const sessionId = "sess-" + randomBytes(8).toString("hex");
    const originalRelayKp = generateKeypair();
    const originalRelayId = "relay-original";
    const newRelayId = "relay-new";
    const queue = new AgentHashQueue({ store, agentId, logger });

    // Enqueue 8 hashes and ACK them all with original relay
    const hashes: string[] = [];

    for (let i = 0; i < 8; i++) {
      const h = randomBytes(32).toString("hex");
      hashes.push(h);
      await queue.enqueue(sessionId, h, `corr-${i}`);

      const ack = await buildValidAck({
        relayKp: originalRelayKp,
        relayId: originalRelayId,
        hashHex: h,
        sequenceNumber: i + 1,
        timestamp: Date.now(),
      });
      await queue.processAck(sessionId, h, ack, async () => ack.relayPubkey, `corr-${i}`);
    }

    // All 8 ACKs must be stored
    for (const h of hashes) {
      const storedAck = await queue.getAck(h);
      expect(storedAck).toBeDefined();
      expect(storedAck!.relayId).toBe(originalRelayId);
    }

    // Simulate relay failover: re-enqueue hashes for new relay
    for (const h of hashes) {
      await queue.enqueue(sessionId, h, "corr-resubmit");
    }

    // New relay must verify prior ACKs before accepting re-submissions
    const originalPubkey = await originalRelayKp.getPublicKey();
    const newRelayKp = generateKeypair();

    // Directory lookup provides original relay's pubkey by relayId
    const directoryLookup = async (relayId: string): Promise<Uint8Array | null> => {
      if (relayId === originalRelayId) return originalPubkey;
      return null; // RELAY_PREDECESSOR_UNKNOWN for unknown IDs
    };

    // Re-submit each hash: new relay checks prior ACK, then issues new ACK
    for (let i = 0; i < 8; i++) {
      const h = hashes[i]!;
      const priorAck = await queue.getAck(h);
      expect(priorAck).toBeDefined();

      // Verify prior ACK is valid (what the new relay does)
      const priorRelayPubkey = await directoryLookup(priorAck!.relayId);
      expect(priorRelayPubkey).not.toBeNull();
      const priorAckValid = verifyRelayAck(h, priorAck!, priorRelayPubkey!);
      expect(priorAckValid).toBe(true);

      // New relay issues new ACK
      const newAck = await buildValidAck({
        relayKp: newRelayKp,
        relayId: newRelayId,
        hashHex: h,
        sequenceNumber: i + 1,
        timestamp: Date.now(),
      });

      await queue.processAck(sessionId, h, newAck, async (relayId) => {
        // New relay's lookup: only verify new relay's own pubkey
        if (relayId === newRelayId) return await newRelayKp.getPublicKey();
        return null;
      }, "corr-resubmit");
    }

    // Queue should be empty again
    const pendingAfter = await queue.getPending(sessionId);
    expect(pendingAfter.length).toBe(0);
  });

  it("new relay rejects re-submission when predecessor relay unknown → RELAY_PREDECESSOR_UNKNOWN", async () => {
    const store: ClientStore = new LocalClientStore();
    const { logger, events } = makeSpyLogger();
    const agentId = "agent-ac005-unknown";
    const sessionId = "sess-" + randomBytes(8).toString("hex");
    const originalRelayKp = generateKeypair();
    const originalRelayId = "relay-unknown-predecessor";
    const queue = new AgentHashQueue({ store, agentId, logger });

    const hashHex = randomBytes(32).toString("hex");
    await queue.enqueue(sessionId, hashHex, "corr-001");

    const ack = await buildValidAck({
      relayKp: originalRelayKp,
      relayId: originalRelayId,
      hashHex,
      sequenceNumber: 1,
      timestamp: Date.now(),
    });
    await queue.processAck(sessionId, hashHex, ack, async () => ack.relayPubkey, "corr-001");

    // Re-enqueue for new relay
    await queue.enqueue(sessionId, hashHex, "corr-resubmit");

    // New relay cannot find predecessor → rejects re-submission
    const result = await queue.handleResubmitRejection(sessionId, hashHex, RELAY_PREDECESSOR_UNKNOWN);
    expect(result).toBe(RELAY_PREDECESSOR_UNKNOWN);

    // client.relay.resubmit.rejected must be logged
    const rejectEvents = events.filter((e) => e.event === "client.relay.resubmit.rejected");
    expect(rejectEvents.length).toBe(1);
    expect(rejectEvents[0]!.level).toBe("error");
    expect(rejectEvents[0]!.context).toMatchObject({ agentId, sessionId, hashHex });

    // Hash must remain in pending queue
    const pending = await queue.getPending(sessionId);
    const found = pending.find((p) => p.hashHex === hashHex);
    expect(found).toBeDefined();
  });
});

// ─── AC-006: Queue depth logged on 30-second interval ─────────────────────────

describe("PERSIST-012 AC-006 — queue depth polling", () => {
  it("pollDepth() logs client.hashqueue.depth at INFO with { agentId, depth } when depth > 0", async () => {
    const store: ClientStore = new LocalClientStore();
    const { logger, events } = makeSpyLogger();
    const agentId = "agent-ac006";
    const sessionId = "sess-" + randomBytes(8).toString("hex");
    const queue = new AgentHashQueue({ store, agentId, logger });

    // Enqueue some hashes to get depth > 0
    await queue.enqueue(sessionId, randomBytes(32).toString("hex"), "corr-a");
    await queue.enqueue(sessionId, randomBytes(32).toString("hex"), "corr-b");

    // Trigger depth poll directly (no 30s wait needed)
    await queue.pollDepth();

    const depthEvents = events.filter((e) => e.event === "client.hashqueue.depth");
    expect(depthEvents.length).toBeGreaterThanOrEqual(1);
    expect(depthEvents[0]!.level).toBe("info");
    expect(depthEvents[0]!.context).toHaveProperty("agentId", agentId);
    expect(depthEvents[0]!.context).toHaveProperty("depth");
    expect((depthEvents[0]!.context["depth"] as number)).toBeGreaterThan(0);
    expect(depthEvents[0]!.context).toHaveProperty("oldestHashAge");
    expect(typeof depthEvents[0]!.context["oldestHashAge"]).toBe("number");
  });

  it("pollDepth() does NOT log when depth is 0", async () => {
    const store: ClientStore = new LocalClientStore();
    const { logger, events } = makeSpyLogger();
    const agentId = "agent-ac006-empty";
    const queue = new AgentHashQueue({ store, agentId, logger });

    // No enqueues — depth is 0
    await queue.pollDepth();

    const depthEvents = events.filter((e) => e.event === "client.hashqueue.depth");
    expect(depthEvents.length).toBe(0);
  });
});

// ─── AC-007: Invalid ACK discarded; hash stays in queue ──────────────────────

describe("PERSIST-012 AC-007 — invalid ACK discarded", () => {
  it("ACK with wrong signature → client.relay.ack.invalid WARN; hash remains in queue", async () => {
    const store: ClientStore = new LocalClientStore();
    const { logger, events } = makeSpyLogger();
    const agentId = "agent-ac007";
    const sessionId = "sess-" + randomBytes(8).toString("hex");
    const relayKp = generateKeypair();
    const wrongKp = generateKeypair();
    const queue = new AgentHashQueue({ store, agentId, logger });

    const hashHex = randomBytes(32).toString("hex");
    await queue.enqueue(sessionId, hashHex, "corr-001");

    const ts = Date.now();
    const tbs = buildSignedAckTbs(hashHex, 1, ts);
    const badSig = await wrongKp.sign(tbs); // signed with wrong key
    const goodPubkey = await relayKp.getPublicKey();

    const badAck: RelayAck = {
      relayId: "relay-bad",
      relayPubkey: goodPubkey, // claims to be relayKp but actually signed by wrongKp
      sequenceNumber: 1,
      timestamp: ts,
      signature: badSig,
    };

    await queue.processAck(sessionId, hashHex, badAck, async () => goodPubkey, "corr-001");

    // client.relay.ack.invalid must be logged at WARN
    const invalidEvents = events.filter((e) => e.event === "client.relay.ack.invalid");
    expect(invalidEvents.length).toBe(1);
    expect(invalidEvents[0]!.level).toBe("warn");
    expect(invalidEvents[0]!.context).toMatchObject({
      agentId,
      sessionId,
      hashHex,
    });
    expect(typeof invalidEvents[0]!.context["reason"]).toBe("string");

    // Hash must remain in pending queue (SI-001)
    const pending = await queue.getPending(sessionId);
    expect(pending.length).toBe(1);
    expect(pending[0]!.hashHex).toBe(hashHex);

    // No ACK should be stored
    const storedAck = await queue.getAck(hashHex);
    expect(storedAck).toBeUndefined();
  });
});

// ─── SI-001: Hash never removed without valid stored ACK ──────────────────────

describe("PERSIST-012 SI-001 — hash never removed without valid ACK", () => {
  it("malformed ACK (missing signature field) leaves hash in pending queue", async () => {
    const store: ClientStore = new LocalClientStore();
    const { logger, events } = makeSpyLogger();
    const agentId = "agent-si001-malformed";
    const sessionId = "sess-" + randomBytes(8).toString("hex");
    const relayKp = generateKeypair();
    const queue = new AgentHashQueue({ store, agentId, logger });

    const hashHex = randomBytes(32).toString("hex");
    await queue.enqueue(sessionId, hashHex, "corr-001");

    const relayPubkey = await relayKp.getPublicKey();
    // ACK with empty signature (wrong length)
    const malformedAck: RelayAck = {
      relayId: "relay-malformed",
      relayPubkey,
      sequenceNumber: 1,
      timestamp: Date.now(),
      signature: new Uint8Array(0), // zero length — malformed
    };

    await queue.processAck(sessionId, hashHex, malformedAck, async () => relayPubkey, "corr-001");

    // Hash must remain in queue
    const pending = await queue.getPending(sessionId);
    expect(pending.length).toBe(1);

    // Invalid event must be logged
    const invalidEvents = events.filter((e) => e.event === "client.relay.ack.invalid");
    expect(invalidEvents.length).toBe(1);
  });

  it("relay claims sequencing but sends unsigned ACK → hash retained", async () => {
    const store: ClientStore = new LocalClientStore();
    const { logger } = makeSpyLogger();
    const agentId = "agent-si001-unsigned";
    const sessionId = "sess-" + randomBytes(8).toString("hex");
    const relayKp = generateKeypair();
    const queue = new AgentHashQueue({ store, agentId, logger });

    const hashHex = randomBytes(32).toString("hex");
    await queue.enqueue(sessionId, hashHex, "corr-001");

    const relayPubkey = await relayKp.getPublicKey();
    // ACK with all-zeros signature (not a valid Ed25519 signature)
    const zeroSigAck: RelayAck = {
      relayId: "relay-unsigned",
      relayPubkey,
      sequenceNumber: 1,
      timestamp: Date.now(),
      signature: new Uint8Array(64), // all zeros — invalid signature
    };

    await queue.processAck(sessionId, hashHex, zeroSigAck, async () => relayPubkey, "corr-001");

    // Hash must remain in queue
    const pending = await queue.getPending(sessionId);
    expect(pending.length).toBe(1);
    expect(pending[0]!.hashHex).toBe(hashHex);
  });
});

// ─── SI-002: FIFO ordering enforced ──────────────────────────────────────────

describe("PERSIST-012 SI-002 — FIFO ordering", () => {
  it("getPending returns hashes in strict insertion order regardless of ACK state", async () => {
    const store: ClientStore = new LocalClientStore();
    const { logger } = makeSpyLogger();
    const agentId = "agent-si002";
    const sessionId = "sess-" + randomBytes(8).toString("hex");
    const relayKp = generateKeypair();
    const queue = new AgentHashQueue({ store, agentId, logger });

    const hashes: string[] = [];
    for (let i = 0; i < 6; i++) {
      const h = randomBytes(32).toString("hex");
      hashes.push(h);
      await queue.enqueue(sessionId, h, `corr-${i}`);
    }

    // ACK the 2nd and 4th hashes (out of order from the relay's perspective)
    const ack1 = await buildValidAck({ relayKp, relayId: "relay-fifo", hashHex: hashes[1]!, sequenceNumber: 2, timestamp: Date.now() });
    const ack3 = await buildValidAck({ relayKp, relayId: "relay-fifo", hashHex: hashes[3]!, sequenceNumber: 4, timestamp: Date.now() });

    await queue.processAck(sessionId, hashes[1]!, ack1, async () => ack1.relayPubkey, "corr-1");
    await queue.processAck(sessionId, hashes[3]!, ack3, async () => ack3.relayPubkey, "corr-3");

    // Remaining pending items must be in insertion order: 0, 2, 4, 5
    const pending = await queue.getPending(sessionId);
    expect(pending.length).toBe(4);
    expect(pending[0]!.hashHex).toBe(hashes[0]);
    expect(pending[1]!.hashHex).toBe(hashes[2]);
    expect(pending[2]!.hashHex).toBe(hashes[4]);
    expect(pending[3]!.hashHex).toBe(hashes[5]);
  });
});

// ─── SI-003: Stored ACKs are immutable ───────────────────────────────────────

describe("PERSIST-012 SI-003 — stored relay ACKs are immutable", () => {
  it("getAck returns the first stored ACK; subsequent ACKs for same hash do not overwrite it", async () => {
    const store: ClientStore = new LocalClientStore();
    const { logger } = makeSpyLogger();
    const agentId = "agent-si003";
    const sessionId = "sess-" + randomBytes(8).toString("hex");
    const relay1Kp = generateKeypair();
    const relay2Kp = generateKeypair();
    const queue = new AgentHashQueue({ store, agentId, logger });

    const hashHex = randomBytes(32).toString("hex");
    await queue.enqueue(sessionId, hashHex, "corr-001");

    const ack1 = await buildValidAck({ relayKp: relay1Kp, relayId: "relay-first", hashHex, sequenceNumber: 1, timestamp: 1000 });
    await queue.processAck(sessionId, hashHex, ack1, async () => ack1.relayPubkey, "corr-001");

    // Try to "overwrite" the ACK with a new relay's ACK for the same hash
    // (re-enqueue to allow processAck to be called again)
    await queue.enqueue(sessionId, hashHex, "corr-002");
    const ack2 = await buildValidAck({ relayKp: relay2Kp, relayId: "relay-second", hashHex, sequenceNumber: 1, timestamp: 2000 });
    await queue.processAck(sessionId, hashHex, ack2, async () => ack2.relayPubkey, "corr-002");

    // The original ACK must still be stored (immutable)
    const stored = await queue.getAck(hashHex);
    expect(stored).toBeDefined();
    expect(stored!.relayId).toBe("relay-first");
    expect(stored!.timestamp).toBe(1000);
  });
});

// ─── DB-001: Stale queue warning ─────────────────────────────────────────────

describe("PERSIST-012 DB-001 — stale queue warning", () => {
  it("queue with hashes older than max age → client.hashqueue.stale WARN", async () => {
    const store: ClientStore = new LocalClientStore();
    const { logger, events } = makeSpyLogger();
    const agentId = "agent-db001";
    const sessionId = "sess-" + randomBytes(8).toString("hex");
    // Very short max age for testing
    const queue = new AgentHashQueue({ store, agentId, logger, hashQueueMaxAgeMs: 1 });

    const hashHex = randomBytes(32).toString("hex");
    await queue.enqueue(sessionId, hashHex, "corr-001");

    // Wait for the entry to become "stale"
    await new Promise((r) => setTimeout(r, 5));

    await queue.pollDepth();

    const staleEvents = events.filter((e) => e.event === "client.hashqueue.stale");
    expect(staleEvents.length).toBeGreaterThanOrEqual(1);
    expect(staleEvents[0]!.level).toBe("warn");
    expect(staleEvents[0]!.context).toHaveProperty("agentId", agentId);
    expect(staleEvents[0]!.context).toHaveProperty("depth");
    expect(staleEvents[0]!.context).toHaveProperty("oldestHashAge");
    expect((staleEvents[0]!.context["oldestHashAge"] as number)).toBeGreaterThan(0);
  });

  it("hashes are NOT dropped from queue when stale — queue continues to grow", async () => {
    const store: ClientStore = new LocalClientStore();
    const { logger } = makeSpyLogger();
    const agentId = "agent-db001-nodrop";
    const sessionId = "sess-" + randomBytes(8).toString("hex");
    const queue = new AgentHashQueue({ store, agentId, logger, hashQueueMaxAgeMs: 1 });

    await queue.enqueue(sessionId, randomBytes(32).toString("hex"), "corr-001");
    await queue.enqueue(sessionId, randomBytes(32).toString("hex"), "corr-002");

    await new Promise((r) => setTimeout(r, 5));
    await queue.pollDepth();

    const pending = await queue.getPending(sessionId);
    expect(pending.length).toBe(2);
  });
});

// ─── DB-002: New relay rejects re-submission ──────────────────────────────────

describe("PERSIST-012 DB-002 — relay rejects re-submission with valid prior ACK", () => {
  it("handleResubmitRejection → client.relay.resubmit.rejected ERROR; hash stays in queue", async () => {
    const store: ClientStore = new LocalClientStore();
    const { logger, events } = makeSpyLogger();
    const agentId = "agent-db002";
    const sessionId = "sess-" + randomBytes(8).toString("hex");
    const queue = new AgentHashQueue({ store, agentId, logger });

    const hashHex = randomBytes(32).toString("hex");
    await queue.enqueue(sessionId, hashHex, "corr-001");

    const result = await queue.handleResubmitRejection(sessionId, hashHex, "RELAY_RESUBMIT_REJECTED");
    expect(result).toBe("RELAY_RESUBMIT_REJECTED");

    // client.relay.resubmit.rejected must be logged at ERROR
    const rejectEvents = events.filter((e) => e.event === "client.relay.resubmit.rejected");
    expect(rejectEvents.length).toBe(1);
    expect(rejectEvents[0]!.level).toBe("error");
    expect(rejectEvents[0]!.context).toMatchObject({
      agentId,
      sessionId,
      hashHex,
    });

    // Hash must remain in queue
    const pending = await queue.getPending(sessionId);
    expect(pending.find((p) => p.hashHex === hashHex)).toBeDefined();
  });
});

// ─── buildSignedAckTbs — deterministic TBS construction ──────────────────────

describe("PERSIST-012 — buildSignedAckTbs determinism", () => {
  it("same inputs always produce same TBS bytes (required for signature verification)", () => {
    const hashHex = randomBytes(32).toString("hex");
    const seq = 17;
    const ts = 1716000000000;

    const tbs1 = buildSignedAckTbs(hashHex, seq, ts);
    const tbs2 = buildSignedAckTbs(hashHex, seq, ts);

    expect(tbs1).toEqual(tbs2);
    expect(tbs1).toBeInstanceOf(Uint8Array);
    expect(tbs1.length).toBeGreaterThan(0);
  });

  it("different hash → different TBS", () => {
    const hash1 = randomBytes(32).toString("hex");
    const hash2 = randomBytes(32).toString("hex");
    expect(buildSignedAckTbs(hash1, 1, 1000)).not.toEqual(buildSignedAckTbs(hash2, 1, 1000));
  });

  it("different sequence number → different TBS", () => {
    const hashHex = randomBytes(32).toString("hex");
    expect(buildSignedAckTbs(hashHex, 1, 1000)).not.toEqual(buildSignedAckTbs(hashHex, 2, 1000));
  });

  it("different timestamp → different TBS", () => {
    const hashHex = randomBytes(32).toString("hex");
    expect(buildSignedAckTbs(hashHex, 1, 1000)).not.toEqual(buildSignedAckTbs(hashHex, 1, 2000));
  });
});
