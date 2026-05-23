/**
 * FEDERATION-002 — buildCheckpointTbs and computeCheckpointHash unit tests
 *
 * Specification (stated before each test per SPARC S phase):
 *
 * AC-010-canonical-tbs: buildCheckpointTbs lives in @cello/crypto — both the
 *   coordinator (which computes the hash to broadcast the proposal) and each
 *   non-coordinator verifier (which independently recomputes the hash to validate
 *   the proposal) import this function from @cello/crypto. No inline serialization
 *   of mmr_peaks exists in packages/directory.
 *
 * Cross-path contract test: coordinator serializes → non-coordinator serializes
 *   the same input → byte-for-byte identical output → same checkpoint hash.
 *   This prevents the silent divergence failure mode where two honest nodes
 *   produce different hashes from the same MMR state.
 *
 * AC-004 (sort determinism): The sort order (recorded_at ASC, conversation_id ASC)
 *   is the only permitted ordering. Different orderings produce different hashes
 *   (tested here via different mmrPeaks orderings producing different TBS bytes).
 *
 * SI-003: The deterministic sort is the only permitted ordering for MMR batch
 *   construction. Any other ordering produces a hash that honest nodes will not sign.
 *
 * Crypto reference: FIPS 180-4 (SHA-256). buildCheckpointTbs returns
 *   SHA-256(mmr_peaks_serialized || identity_merkle_root || checkpoint_id).
 */

import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { buildCheckpointTbs, computeCheckpointHash } from "../checkpoint.js";

const toHex = (b: Uint8Array): string => Buffer.from(b).toString("hex");

// ─── AC-010-canonical-tbs: buildCheckpointTbs lives in @cello/crypto ─────────

describe("AC-010-canonical-tbs: buildCheckpointTbs is importable from @cello/crypto", () => {
  it("buildCheckpointTbs exists and is a function", () => {
    expect(typeof buildCheckpointTbs).toBe("function");
  });

  it("computeCheckpointHash exists and is a function", () => {
    expect(typeof computeCheckpointHash).toBe("function");
  });
});

// ─── AC-010-canonical-tbs: returns 32-byte SHA-256 ───────────────────────────

describe("AC-010-canonical-tbs: buildCheckpointTbs returns correct SHA-256", () => {
  it("returns a 32-byte Uint8Array (FIPS 180-4 SHA-256 output size)", () => {
    const result = buildCheckpointTbs(
      ["aabbcc", "ddeeff"],
      "deadbeef".repeat(8),
      "123e4567-e89b-12d3-a456-426614174000",
    );
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.length).toBe(32);
  });

  it("computeCheckpointHash returns a 64-character hex string", () => {
    const result = computeCheckpointHash(
      ["aabbcc", "ddeeff"],
      "deadbeef".repeat(8),
      "123e4567-e89b-12d3-a456-426614174000",
    );
    expect(typeof result).toBe("string");
    expect(result.length).toBe(64);
    expect(result).toMatch(/^[0-9a-f]{64}$/);
  });

  it("buildCheckpointTbs and computeCheckpointHash agree — bytes vs hex of same value", () => {
    const peaks = ["aabb", "ccdd"];
    const identity = "ff".repeat(32);
    const checkpointId = "aaaabbbb-cccc-dddd-eeee-ffffffffffff";

    const tbsBytes = buildCheckpointTbs(peaks, identity, checkpointId);
    const hashHex = computeCheckpointHash(peaks, identity, checkpointId);

    expect(toHex(tbsBytes)).toBe(hashHex);
  });
});

// ─── AC-010-canonical-tbs: cross-path contract test ─────────────────────────
// "coordinator serializes → non-coordinator serializes the same input → byte-for-byte identical"
// This is the core lesson from M4 bug #12: two independent implementations of the same
// serialization diverged silently. Using a single shared function prevents this.

describe("AC-010-canonical-tbs: cross-path contract — coordinator and verifier produce identical bytes", () => {
  it("two independent calls with identical inputs produce byte-for-byte identical TBS", () => {
    const peaks = ["0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20", "a0b0c0d0"];
    const identity = "abcdef".repeat(10) + "0011";
    const checkpointId = "11223344-5566-7788-99aa-bbccddeeff00";

    // Simulate coordinator computing TBS
    const coordinatorTbs = buildCheckpointTbs(peaks, identity, checkpointId);

    // Simulate verifier independently computing TBS with same inputs
    const verifierTbs = buildCheckpointTbs(peaks, identity, checkpointId);

    // Must be byte-for-byte identical — no non-determinism permitted
    expect(coordinatorTbs).toEqual(verifierTbs);
    expect(toHex(coordinatorTbs)).toBe(toHex(verifierTbs));
  });

  it("different peak arrays produce different TBS bytes (ordering matters — SI-003)", () => {
    const identity = "aa".repeat(32);
    const checkpointId = "aaaabbbb-cccc-dddd-eeee-ffffffffffff";

    // Two different orderings of the same peaks
    const tbs1 = buildCheckpointTbs(["aabb", "ccdd"], identity, checkpointId);
    const tbs2 = buildCheckpointTbs(["ccdd", "aabb"], identity, checkpointId);

    // Different orderings must produce different hashes — enforces canonical sort SI-003
    expect(toHex(tbs1)).not.toBe(toHex(tbs2));
  });

  it("different identity_merkle_root produces different TBS bytes", () => {
    const peaks = ["aabb"];
    const checkpointId = "aaaabbbb-cccc-dddd-eeee-ffffffffffff";

    const tbs1 = buildCheckpointTbs(peaks, "00".repeat(32), checkpointId);
    const tbs2 = buildCheckpointTbs(peaks, "ff".repeat(32), checkpointId);

    expect(toHex(tbs1)).not.toBe(toHex(tbs2));
  });

  it("different checkpoint_id produces different TBS bytes", () => {
    const peaks = ["aabb"];
    const identity = "aa".repeat(32);

    const tbs1 = buildCheckpointTbs(peaks, identity, "aaaabbbb-cccc-dddd-eeee-ffffffffffff");
    const tbs2 = buildCheckpointTbs(peaks, identity, "aaaabbbb-cccc-dddd-eeee-000000000001");

    expect(toHex(tbs1)).not.toBe(toHex(tbs2));
  });
});

// ─── AC-010-canonical-tbs: verify hash formula matches independent computation ─

describe("AC-010-canonical-tbs: hash formula SHA-256(peaks_json || identity || checkpoint_id)", () => {
  it("output matches independently computed SHA-256 of the same concatenation — FIPS 180-4", () => {
    const peaks = ["aabbccddeeff", "11223344"];
    const identity = "99".repeat(32);
    const checkpointId = "aabbccdd-eeff-0011-2233-445566778899";

    // Independent computation — what an external verifier would compute
    const encoder = new TextEncoder();
    const peaksSerialized = JSON.stringify(peaks);  // '["aabbccddeeff","11223344"]' — no whitespace
    const preimage = Buffer.concat([
      Buffer.from(encoder.encode(peaksSerialized)),
      Buffer.from(encoder.encode(identity)),
      Buffer.from(encoder.encode(checkpointId)),
    ]);
    const expectedHash = createHash("sha256").update(preimage).digest("hex");

    const actualHash = computeCheckpointHash(peaks, identity, checkpointId);

    expect(actualHash).toBe(expectedHash);
  });

  it("empty peak array produces deterministic output (empty checkpoint case)", () => {
    const tbs1 = buildCheckpointTbs([], "00".repeat(32), "aaaabbbb-cccc-dddd-eeee-000000000001");
    const tbs2 = buildCheckpointTbs([], "00".repeat(32), "aaaabbbb-cccc-dddd-eeee-000000000001");
    expect(toHex(tbs1)).toBe(toHex(tbs2));
  });

  it("canonical JSON array format — peaks serialized as JSON array, no whitespace", () => {
    // Verify that the peaks are serialized as '["a","b"]' not '[ "a", "b" ]'
    // This is tested by verifying the hash matches a known-compact JSON serialization
    const peaks = ["aabb", "ccdd"];
    const identity = "11".repeat(32);
    const checkpointId = "aaaabbbb-cccc-dddd-eeee-000000000001";

    // Compact JSON: JSON.stringify(array) produces no whitespace
    const compactJson = JSON.stringify(peaks); // '["aabb","ccdd"]'
    expect(compactJson).toBe('["aabb","ccdd"]');

    // The hash must match the computation using compact JSON
    const encoder = new TextEncoder();
    const preimage = Buffer.concat([
      Buffer.from(encoder.encode(compactJson)),
      Buffer.from(encoder.encode(identity)),
      Buffer.from(encoder.encode(checkpointId)),
    ]);
    const expectedHash = createHash("sha256").update(preimage).digest("hex");
    expect(computeCheckpointHash(peaks, identity, checkpointId)).toBe(expectedHash);
  });
});

// ─── AC-004: sort determinism tested at the hash level ───────────────────────
// AC-004 tests sort determinism in the directory package. Here we verify that
// the hash function itself enforces that order — a coordinator using a different
// sort order would produce a hash honest nodes won't sign.

describe("AC-004 (sort determinism): different orderings produce different hashes", () => {
  it("batch sorted by recorded_at ASC, conversation_id ASC produces a specific hash; any other sort produces a different hash", () => {
    const identity = "cc".repeat(32);
    const checkpointId = "aaaabbbb-cccc-dddd-eeee-000000000001";

    // If the peaks array reflects the MMR state after correct sorting,
    // it will differ from peaks after wrong sorting — hence different hashes.
    // (The sort affects which leaves are appended in which order → different peaks.)
    const correctPeaks = ["aabb0001", "ccdd0002"];
    const wrongOrderPeaks = ["ccdd0002", "aabb0001"];

    const correctHash = computeCheckpointHash(correctPeaks, identity, checkpointId);
    const wrongHash = computeCheckpointHash(wrongOrderPeaks, identity, checkpointId);

    expect(correctHash).not.toBe(wrongHash);
  });
});
