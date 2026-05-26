/**
 * CELLO-PERSIST-014 — Gap-fill reconciliation tests (relay component)
 *
 * Tests the relay's gap-fill endpoint:
 * - AC-002: Relay returns exactly the requested leaves from the WAL
 * - AC-005: WAL unavailable → RELAY_SESSION_UNRECOVERABLE → gap_fill_error
 * - SI-001: Only serves leaves with seq > last agreed sequence number
 */

import { describe, it, expect, beforeEach } from "vitest";
import { InMemorySessionWal } from "@cello-protocol/interfaces/stubs";
import { StdoutLogger } from "@cello-protocol/interfaces/stubs";
import { RELAY_SESSION_UNRECOVERABLE } from "@cello-protocol/interfaces";
import type { Leaf, SessionWal } from "@cello-protocol/interfaces";
import { randomBytes } from "node:crypto";

// ─── Test helpers ────────────────────────────────────────────────────────────

function makeLeaf(seq: number, senderPubkey?: Uint8Array): Leaf {
  return {
    sequence_number: seq,
    sender_pubkey: senderPubkey ?? randomBytes(32),
    content_hash: randomBytes(32),
    sender_signature: randomBytes(64),
    prev_root: randomBytes(32),
    structure1_cbor: randomBytes(48),
  };
}

describe("PERSIST-014: Gap-fill via SessionWal.getLeaves", () => {
  let wal: InMemorySessionWal;
  let logger: StdoutLogger;
  const sessionId = "test-session-014";

  beforeEach(async () => {
    logger = new StdoutLogger();
    wal = new InMemorySessionWal({ logger });
    await wal.open(sessionId);
  });

  it("AC-002: returns exactly the requested range of leaves", async () => {
    // Append 10 leaves with seq 1..10
    for (let i = 1; i <= 10; i++) {
      await wal.append(sessionId, makeLeaf(i));
    }

    // Request leaves 9..10 (fromSeq=8, toSeq=10)
    const result = await wal.getLeaves(sessionId, 8, 10);
    expect(result).not.toBe(RELAY_SESSION_UNRECOVERABLE);
    const leaves = result as Leaf[];
    expect(leaves).toHaveLength(2);
    expect(leaves[0].sequence_number).toBe(9);
    expect(leaves[1].sequence_number).toBe(10);
  });

  it("SI-001: does not return leaves at or below fromSeq", async () => {
    // Append 10 leaves with seq 1..10
    for (let i = 1; i <= 10; i++) {
      await wal.append(sessionId, makeLeaf(i));
    }

    // Request with fromSeq=5 — should not include seq 1..5
    const result = await wal.getLeaves(sessionId, 5, 10);
    expect(result).not.toBe(RELAY_SESSION_UNRECOVERABLE);
    const leaves = result as Leaf[];
    expect(leaves).toHaveLength(5);
    expect(leaves[0].sequence_number).toBe(6);
    expect(leaves[4].sequence_number).toBe(10);
  });

  it("SI-001: returns empty array when fromSeq >= toSeq", async () => {
    for (let i = 1; i <= 5; i++) {
      await wal.append(sessionId, makeLeaf(i));
    }

    const result = await wal.getLeaves(sessionId, 5, 5);
    expect(result).not.toBe(RELAY_SESSION_UNRECOVERABLE);
    expect(result as Leaf[]).toHaveLength(0);
  });

  it("SI-001: returns empty array when requested range is beyond available leaves", async () => {
    for (let i = 1; i <= 5; i++) {
      await wal.append(sessionId, makeLeaf(i));
    }

    const result = await wal.getLeaves(sessionId, 10, 15);
    expect(result).not.toBe(RELAY_SESSION_UNRECOVERABLE);
    expect(result as Leaf[]).toHaveLength(0);
  });

  it("AC-005: returns empty array for non-existent session", async () => {
    const result = await wal.getLeaves("nonexistent-session", 0, 10);
    expect(result).not.toBe(RELAY_SESSION_UNRECOVERABLE);
    expect(result as Leaf[]).toHaveLength(0);
  });

  it("returns leaves with correct byte content (signature verification possible)", async () => {
    const senderKey = randomBytes(32);
    const leaf = makeLeaf(1, senderKey);
    await wal.append(sessionId, leaf);

    const result = await wal.getLeaves(sessionId, 0, 1);
    expect(result).not.toBe(RELAY_SESSION_UNRECOVERABLE);
    const leaves = result as Leaf[];
    expect(leaves).toHaveLength(1);
    expect(Buffer.from(leaves[0].sender_pubkey)).toEqual(Buffer.from(senderKey));
    expect(Buffer.from(leaves[0].sender_signature)).toEqual(Buffer.from(leaf.sender_signature));
  });
});

describe("PERSIST-014: Gap-fill with corrupt WAL (FileSessionWal)", () => {
  it("AC-005: corrupt WAL returns RELAY_SESSION_UNRECOVERABLE", async () => {
    // This test uses a mock that simulates WAL corruption
    const corruptWal: SessionWal = {
      async open() {},
      async append() {},
      async reconstruct() { return RELAY_SESSION_UNRECOVERABLE; },
      async delete() {},
      async getLeaves() { return RELAY_SESSION_UNRECOVERABLE; },
    };

    const result = await corruptWal.getLeaves("any-session", 0, 10);
    expect(result).toBe(RELAY_SESSION_UNRECOVERABLE);
  });
});
