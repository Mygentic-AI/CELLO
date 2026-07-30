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

/**
 * Number of buckets — one per possible value of the record hash's PREFIX. A record hash is
 * bucketed on its first `PREFIX_HEX_CHARS` hex chars, so `BUCKET_COUNT` and `PREFIX_HEX_CHARS`
 * are coupled: `BUCKET_COUNT === 16 ** PREFIX_HEX_CHARS`. Widening to a second prefix byte
 * (§7 scaling) means changing BOTH together — `PREFIX_HEX_CHARS` is derived from BUCKET_COUNT so
 * a lone edit to one can't silently leave the extra buckets permanently empty.
 */
export const BUCKET_COUNT = 256;
const PREFIX_HEX_CHARS = Math.log2(BUCKET_COUNT) / 4; // 256 → 2 hex chars (one byte)

/** A record hash is SHA-256, so exactly 64 lowercase hex chars. */
const RECORD_HASH_RE = /^[0-9a-f]{64}$/;

/** SHA-256 of the given UTF-8 string, hex. */
function sha256Hex(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

/** The bucket a record hash falls into — the integer value of its hex prefix (0..BUCKET_COUNT-1). */
export function bucketIndex(recordHashHex: string): number {
  return parseInt(recordHashHex.slice(0, PREFIX_HEX_CHARS), 16);
}

/**
 * Validate and deduplicate a record-hash set at the boundary. This enforces the contract the
 * module's name promises — it operates on a SET of fixed-length record hashes — rather than
 * assuming it:
 *  - **Dedup** (HIGH-1): a duplicate hash would inflate one node's bucket digest, and because the
 *    pull path is dupe-tolerant but the digest path is not, the pair would re-exchange that bucket
 *    forever without converging. Dedup makes the digest a true set digest. Valid callers have no
 *    dups (append-only + UNIQUE natural keys), so this repairs only malformed input.
 *  - **Fixed-length validation** (HIGH-2 / MEDIUM-3): the separator-less `join("")` is injective
 *    only because every hash is 64 hex. A variable-length hash could make two different sets share
 *    a bucket digest → silent false-convergence → a record never pulled. Rejecting non-64-hex
 *    input makes the join unambiguous by enforcement, and turns malformed input into a
 *    cause-naming error instead of an opaque `undefined.push` TypeError.
 */
function validatedSet(recordHashesHex: readonly string[]): string[] {
  const seen = new Set<string>();
  for (const hash of recordHashesHex) {
    if (!RECORD_HASH_RE.test(hash)) {
      throw new Error(`malformed record hash: ${JSON.stringify(hash)} (expected 64 lowercase hex)`);
    }
    seen.add(hash);
  }
  return [...seen];
}

/**
 * Per-bucket digests over a set of record hashes. Returns exactly BUCKET_COUNT entries; an empty
 * bucket gets the digest of the empty string so absence is still a stable, comparable value.
 * Input is validated + deduped (`validatedSet`); sorting within each bucket makes the result
 * independent of input order.
 */
export function bucketDigests(recordHashesHex: readonly string[]): string[] {
  const buckets: string[][] = Array.from({ length: BUCKET_COUNT }, () => []);
  for (const hash of validatedSet(recordHashesHex)) {
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
  // DEDUPED. A peer advertising the same hash twice would otherwise be asked for it twice, inflating
  // `tierAPulled` — which is the numerator of the fork alarm (`pulled > 0 && applied === 0`). Harmless
  // for correctness, since apply is insert-if-absent, but it lets a peer nudge a diagnostic.
  return [...new Set(peerRecordHashesHex.filter((h) => !mine.has(h)))];
}
