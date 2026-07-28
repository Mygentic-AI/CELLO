/**
 * Set reconciliation — the pure core of anti-entropy append-only sync (M12 DOD-AE-APPEND-1;
 * M12-ANTI-ENTROPY-DESIGN §3).
 *
 * Records are identified by their **record hash** (hex, SHA-256 of the record's domain-separated
 * canonical bytes — computed by the per-table encoders in later units). Reconciliation is a pure
 * set problem over those hashes:
 *
 *   1. Bucket each record hash by its first byte (256 buckets).
 *   2. A bucket digest = SHA-256 of the SORTED record hashes in it (sorting makes it
 *      order-independent, so two nodes with the same set produce the same digest).
 *   3. The table digest = SHA-256 over the 256 bucket digests. Equal table digests ⇒ converged
 *      in one round trip; differing ⇒ walk only the buckets whose digests differ and pull the
 *      set-difference.
 *
 * No clocks, no ordering agreement — append-only records are content-addressed, so "who has what"
 * is pure set membership. This module is transport-agnostic: it takes and returns hex strings, so
 * it is unit-tested with no libp2p and no database.
 */

import { createHash } from "node:crypto";

/** Number of buckets — one per possible first byte of a record hash. */
export const BUCKET_COUNT = 256;

/** SHA-256 of the given UTF-8 string, hex. */
function sha256Hex(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

/** The bucket a record hash falls into — its first byte (0..255). */
export function bucketIndex(recordHashHex: string): number {
  return parseInt(recordHashHex.slice(0, 2), 16);
}

/**
 * Per-bucket digests over a set of record hashes. Returns exactly BUCKET_COUNT entries; an empty
 * bucket gets the digest of the empty string so absence is still a stable, comparable value.
 * Sorting within each bucket makes the result independent of input order.
 */
export function bucketDigests(recordHashesHex: readonly string[]): string[] {
  const buckets: string[][] = Array.from({ length: BUCKET_COUNT }, () => []);
  for (const hash of recordHashesHex) {
    buckets[bucketIndex(hash)]!.push(hash);
  }
  return buckets.map((hashes) => sha256Hex(hashes.slice().sort().join("")));
}

/** The single table digest over a vector of bucket digests. */
export function tableDigest(buckets: readonly string[]): string {
  return sha256Hex(buckets.join(""));
}

/** Convenience: the table digest directly from a set of record hashes. */
export function computeTableDigest(recordHashesHex: readonly string[]): string {
  return tableDigest(bucketDigests(recordHashesHex));
}

/**
 * The bucket indices whose digests differ between two bucket-digest vectors — the only buckets
 * whose record-hash lists need to be exchanged. Both vectors must be BUCKET_COUNT long.
 */
export function differingBuckets(a: readonly string[], b: readonly string[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < BUCKET_COUNT; i++) {
    if (a[i] !== b[i]) out.push(i);
  }
  return out;
}

/**
 * The record hashes the PEER holds that the local node lacks — i.e. what the local node must
 * pull. Pure set-difference (peer − mine), order-independent.
 */
export function missingLocally(
  myRecordHashesHex: readonly string[],
  peerRecordHashesHex: readonly string[],
): string[] {
  const mine = new Set(myRecordHashesHex);
  return peerRecordHashesHex.filter((h) => !mine.has(h));
}
