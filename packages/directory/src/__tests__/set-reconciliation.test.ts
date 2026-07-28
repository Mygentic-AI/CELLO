/**
 * DOD-AE-APPEND-1 — set-reconciliation core tests.
 *
 * The pure heart of anti-entropy append-only sync (M12-ANTI-ENTROPY-DESIGN §3): records are
 * bucketed by the first byte of their record hash (256 buckets); a bucket digest is SHA-256 of
 * the sorted record hashes in it; the table digest is SHA-256 of the 256 bucket digests. Two
 * nodes compare table digests (equal → converged in one round trip), then walk only the differing
 * buckets and pull the set-difference. No clocks, order-independent.
 */

import { describe, it, expect } from "vitest";
import {
  BUCKET_COUNT,
  bucketIndex,
  bucketDigests,
  tableDigest,
  computeTableDigest,
  differingBuckets,
  missingLocally,
} from "../set-reconciliation.js";

// Deterministic pseudo record hashes (hex, 64 chars) — the first byte is what buckets them.
const h = (firstByte: number, tail = "00"): string =>
  firstByte.toString(16).padStart(2, "0") + tail.repeat(31);

describe("DOD-AE-APPEND-1: set reconciliation", () => {
  it("bucketIndex is the first byte of the record hash", () => {
    expect(bucketIndex(h(0))).toBe(0);
    expect(bucketIndex(h(255))).toBe(255);
    expect(bucketIndex(h(0x2a))).toBe(0x2a);
    expect(BUCKET_COUNT).toBe(256);
  });

  it("bucketDigests has 256 entries and is order-independent (determinism)", () => {
    const a = [h(1, "aa"), h(1, "bb"), h(200, "cc")];
    const shuffled = [h(200, "cc"), h(1, "bb"), h(1, "aa")];
    const da = bucketDigests(a);
    const ds = bucketDigests(shuffled);
    expect(da).toHaveLength(256);
    expect(da).toEqual(ds); // same set, any order → identical bucket digests
  });

  it("identical sets → identical table digest (converged in one round trip)", () => {
    const set = [h(3), h(99), h(250, "ff")];
    expect(computeTableDigest(set)).toBe(computeTableDigest([...set].reverse()));
  });

  it("differing sets → differing table digest", () => {
    const base = [h(3), h(99)];
    const plusOne = [h(3), h(99), h(100)];
    expect(computeTableDigest(base)).not.toBe(computeTableDigest(plusOne));
  });

  it("one added record changes exactly ONE bucket digest and the table digest", () => {
    const base = [h(10, "aa"), h(20, "bb")];
    const plus = [...base, h(77, "cc")]; // new record's first byte is (77).toString(16) → bucket 77
    const db = bucketDigests(base);
    const dp = bucketDigests(plus);
    const changed = differingBuckets(db, dp);
    expect(changed).toEqual([77]);
    expect(tableDigest(db)).not.toBe(tableDigest(dp));
  });

  it("differingBuckets returns only buckets that differ", () => {
    const a = bucketDigests([h(5), h(6)]);
    const b = bucketDigests([h(5), h(6), h(7)]);
    expect(differingBuckets(a, b)).toEqual([7]);
    expect(differingBuckets(a, a)).toEqual([]);
  });

  it("missingLocally is the set-difference peer − me (what I must pull), order-independent", () => {
    const mine = [h(1, "aa"), h(1, "bb")];
    const peer = [h(1, "bb"), h(1, "aa"), h(1, "cc"), h(1, "dd")];
    const missing = missingLocally(mine, peer);
    expect(new Set(missing)).toEqual(new Set([h(1, "cc"), h(1, "dd")]));
  });

  it("missingLocally is empty when I already have everything the peer has", () => {
    const mine = [h(1), h(2), h(3)];
    const peer = [h(2), h(1)];
    expect(missingLocally(mine, peer)).toEqual([]);
  });

  it("empty set has a stable table digest distinct from any non-empty set", () => {
    const empty = computeTableDigest([]);
    expect(empty).toBe(computeTableDigest([]));
    expect(empty).not.toBe(computeTableDigest([h(0)]));
  });

  it("a hash-collision within a bucket still converges (both sides sort identically)", () => {
    // Two records in the same bucket, present on both sides in different orders.
    const x = h(0x40, "11");
    const y = h(0x40, "22");
    expect(computeTableDigest([x, y])).toBe(computeTableDigest([y, x]));
  });

  it("a duplicate hash does NOT change the digest — set semantics enforced (HIGH-1)", () => {
    // Without dedup, [h,h] would inflate one bucket and cause permanent non-convergence vs [h].
    const one = computeTableDigest([h(1, "aa")]);
    const dup = computeTableDigest([h(1, "aa"), h(1, "aa"), h(1, "aa")]);
    expect(dup).toBe(one);
    // And within bucketDigests directly:
    expect(bucketDigests([h(5), h(5)])).toEqual(bucketDigests([h(5)]));
  });

  it("rejects a malformed record hash with a cause-naming error (HIGH-2/MEDIUM-3)", () => {
    expect(() => computeTableDigest([""])).toThrow(/malformed record hash/);
    expect(() => computeTableDigest(["abcd"])).toThrow(/malformed record hash/); // too short
    expect(() => bucketDigests([h(1) + "extra"])).toThrow(/malformed record hash/); // too long
    expect(() => bucketDigests(["z".repeat(64)])).toThrow(/malformed record hash/); // non-hex
    expect(() => bucketDigests([h(0xab, "cd").toUpperCase()])).toThrow(/malformed record hash/); // upper-case hex rejected
  });
});
