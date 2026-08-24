/**
 * InMemoryContentStore — ContentStore stub for CELLO_ENV=local/test (M7-MSG-001).
 *
 * No file I/O. Restart durability is not testable in local mode, but every other
 * ContentStore behavior (deposit, pull, delete-on-pickup, TTL sweep, cap eviction,
 * logging) works identically to FileContentStore.
 */

import type { Logger } from "../logger.js";
import {
  type ContentStore,
  type ContentStoreEntry,
  CONTENT_STORE_TTL_MS,
  CONTENT_STORE_MAX_BYTES,
  CONTENT_STORE_MAX_ENTRIES,
  CONTENT_STORE_MAX_RECIPIENT_BYTES,
  CONTENT_STORE_MAX_RECIPIENT_ENTRIES,
} from "../content-store.js";

export interface InMemoryContentStoreOptions {
  logger: Logger;
  ttlMs?: number;
  maxBytes?: number;
  maxEntries?: number;
  /** DOD-M15-RELAYABUSE-1: the most bytes / entries ONE recipient's bucket may hold. */
  maxRecipientBytes?: number;
  maxRecipientEntries?: number;
}

function hex(b: Uint8Array): string {
  return Buffer.from(b).toString("hex");
}

function copyEntry(e: ContentStoreEntry): ContentStoreEntry {
  return {
    recipientPubkey: new Uint8Array(e.recipientPubkey),
    contentHash: new Uint8Array(e.contentHash),
    sessionId: new Uint8Array(e.sessionId),
    ciphertext: new Uint8Array(e.ciphertext),
    depositedAt: e.depositedAt,
  };
}

export class InMemoryContentStore implements ContentStore {
  readonly #logger: Logger;
  readonly #ttlMs: number;
  readonly #maxBytes: number;
  readonly #maxEntries: number;
  readonly #maxRecipientBytes: number;
  readonly #maxRecipientEntries: number;
  /** recipientPubkeyHex -> (contentHashHex -> entry), insertion-ordered for FIFO eviction. */
  readonly #byRecipient = new Map<string, Map<string, ContentStoreEntry>>();
  #totalBytes = 0;
  #totalEntries = 0;

  constructor(opts: InMemoryContentStoreOptions) {
    this.#logger = opts.logger;
    this.#ttlMs = opts.ttlMs ?? CONTENT_STORE_TTL_MS;
    this.#maxBytes = opts.maxBytes ?? CONTENT_STORE_MAX_BYTES;
    this.#maxEntries = opts.maxEntries ?? CONTENT_STORE_MAX_ENTRIES;
    this.#maxRecipientBytes = opts.maxRecipientBytes ?? CONTENT_STORE_MAX_RECIPIENT_BYTES;
    this.#maxRecipientEntries = opts.maxRecipientEntries ?? CONTENT_STORE_MAX_RECIPIENT_ENTRIES;
  }

  async deposit(entry: ContentStoreEntry): Promise<void> {
    const rKey = hex(entry.recipientPubkey);
    const cKey = hex(entry.contentHash);
    let bucket = this.#byRecipient.get(rKey);
    if (!bucket) {
      bucket = new Map();
      this.#byRecipient.set(rKey, bucket);
    }

    // F5 (review round 1): first-writer-wins, NOT idempotent-replace. Deposit is open
    // by design and (recipientPubkey, contentHash) are both visible at the relay's hash
    // layer, so a last-writer-wins replace let an attacker who observes a leaf re-deposit
    // junk ciphertext under the same key and EVICT the legitimate parked blob
    // (denial-of-delivery). With first-writer-wins, a re-deposit for a key that already
    // holds a non-expired entry is a benign no-op (a legitimate re-park parks the SAME
    // content; the seal stays honest) and a hostile overwrite is rejected. An expired
    // entry is replaced (a fresh re-park after TTL).
    const existing = bucket.get(cKey);
    if (existing) {
      if (!this.#isExpired(existing, Date.now())) return; // first writer wins
      this.#totalBytes -= existing.ciphertext.length;
      this.#totalEntries -= 1;
      bucket.delete(cKey);
    }

    const incomingBytes = entry.ciphertext.length;

    /**
     * DOD-M15-RELAYABUSE-1 — **THE SAME BOUNDS AS `FileContentStore`, and the reason they had to be
     * ported rather than left to the real store.**
     *
     * This stub is selected for `CELLO_ENV=local`, which is every local development run and the
     * ENTIRE spine harness. While it wrote unconditionally, no multi-process test could ever observe
     * a refusal — so the one behaviour the bound exists to produce was unreachable from the only
     * lane that runs real processes. An interface with two implementations that disagree about
     * whether a deposit can be refused is the defect this milestone exists to remove.
     *
     * REFUSE FIRST, EVICT SECOND, for the reason the file store records: eviction only ever scans
     * the DEPOSITING recipient's bucket, so when the pressure lives in OTHER buckets, draining this
     * one cannot help — and doing it anyway empties a victim's mailbox and still refuses.
     */
    let bucketBytes = 0;
    for (const e of bucket.values()) bucketBytes += e.ciphertext.length;
    const globalRoomIfDrained = this.#maxBytes - (this.#totalBytes - bucketBytes);
    const globalEntryRoomIfDrained = this.#maxEntries - (this.#totalEntries - bucket.size);

    if (
      incomingBytes > globalRoomIfDrained ||
      incomingBytes > this.#maxRecipientBytes ||
      globalEntryRoomIfDrained < 1 ||
      this.#maxRecipientEntries < 1
    ) {
      this.#logger.warn("content.store.deposit_refused", {
        recipientPubkey: rKey,
        incomingBytes,
        bucketBytes,
        totalBytes: this.#totalBytes,
        totalEntries: this.#totalEntries,
        impact:
          "the parked-content store is at a bound this deposit cannot fit inside, so it was REFUSED " +
          "before anything was evicted — nothing already parked was touched",
      });
      if (bucket.size === 0) this.#byRecipient.delete(rKey);
      throw new Error(
        incomingBytes > this.#maxRecipientBytes || this.#maxRecipientEntries < 1
          ? "content_store_recipient_full"
          : "content_store_full",
      );
    }

    let evictedCount = 0;
    let evictedBytes = 0;
    const globalPressure =
      this.#totalEntries + 1 > this.#maxEntries || this.#totalBytes + incomingBytes > this.#maxBytes;
    while (
      bucket.size > 0 &&
      (this.#totalEntries + 1 > this.#maxEntries ||
        this.#totalBytes + incomingBytes > this.#maxBytes ||
        bucketBytes + incomingBytes > this.#maxRecipientBytes ||
        bucket.size + 1 > this.#maxRecipientEntries)
    ) {
      const oldestKey = bucket.keys().next().value as string | undefined;
      if (oldestKey === undefined) break;
      const oldest = bucket.get(oldestKey)!;
      bucket.delete(oldestKey);
      this.#totalBytes -= oldest.ciphertext.length;
      this.#totalEntries -= 1;
      evictedCount += 1;
      evictedBytes += oldest.ciphertext.length;
      bucketBytes -= oldest.ciphertext.length;
    }
    if (evictedCount > 0) {
      if (globalPressure) {
        this.#logger.warn("content.store.full", { recipientPubkey: rKey, evictedCount, evictedBytes });
      } else {
        this.#logger.info("content.store.recipient_rotated", { recipientPubkey: rKey, evictedCount, evictedBytes });
      }
    }

    bucket.set(cKey, copyEntry(entry));
    this.#totalBytes += incomingBytes;
    this.#totalEntries += 1;
  }

  #isExpired(e: ContentStoreEntry, now: number): boolean {
    return now - e.depositedAt >= this.#ttlMs;
  }

  #deleteExpiredFromBucket(rKey: string, bucket: Map<string, ContentStoreEntry>, now: number): void {
    for (const [cKey, e] of [...bucket.entries()]) {
      if (this.#isExpired(e, now)) {
        bucket.delete(cKey);
        this.#totalBytes -= e.ciphertext.length;
        this.#totalEntries -= 1;
      }
    }
    if (bucket.size === 0) this.#byRecipient.delete(rKey);
  }

  async hasContent(recipientPubkeyHex: string): Promise<boolean> {
    const bucket = this.#byRecipient.get(recipientPubkeyHex);
    if (!bucket) return false;
    this.#deleteExpiredFromBucket(recipientPubkeyHex, bucket, Date.now());
    return (this.#byRecipient.get(recipientPubkeyHex)?.size ?? 0) > 0;
  }

  async listContentHashesFor(recipientPubkeyHex: string): Promise<string[]> {
    const bucket = this.#byRecipient.get(recipientPubkeyHex);
    if (!bucket) return [];
    this.#deleteExpiredFromBucket(recipientPubkeyHex, bucket, Date.now());
    const fresh = this.#byRecipient.get(recipientPubkeyHex);
    return fresh ? [...fresh.keys()] : [];
  }

  async pull(recipientPubkeyHex: string): Promise<ContentStoreEntry[]> {
    const bucket = this.#byRecipient.get(recipientPubkeyHex);
    if (!bucket) return [];
    this.#deleteExpiredFromBucket(recipientPubkeyHex, bucket, Date.now());
    const fresh = this.#byRecipient.get(recipientPubkeyHex);
    if (!fresh) return [];
    return [...fresh.values()].map(copyEntry);
  }

  async pullOne(recipientPubkeyHex: string, contentHashHex: string): Promise<ContentStoreEntry | null> {
    const bucket = this.#byRecipient.get(recipientPubkeyHex);
    if (!bucket) return null;
    const e = bucket.get(contentHashHex);
    if (!e) return null;
    if (this.#isExpired(e, Date.now())) {
      bucket.delete(contentHashHex);
      this.#totalBytes -= e.ciphertext.length;
      this.#totalEntries -= 1;
      if (bucket.size === 0) this.#byRecipient.delete(recipientPubkeyHex);
      return null;
    }
    return copyEntry(e);
  }

  async confirmPickup(recipientPubkeyHex: string, contentHashHex: string): Promise<void> {
    const bucket = this.#byRecipient.get(recipientPubkeyHex);
    if (!bucket) return;
    const e = bucket.get(contentHashHex);
    if (!e) return;
    bucket.delete(contentHashHex);
    this.#totalBytes -= e.ciphertext.length;
    this.#totalEntries -= 1;
    if (bucket.size === 0) this.#byRecipient.delete(recipientPubkeyHex);
  }

  async sweepExpired(now: number = Date.now()): Promise<number> {
    let deleted = 0;
    for (const [rKey, bucket] of [...this.#byRecipient.entries()]) {
      const before = bucket.size;
      this.#deleteExpiredFromBucket(rKey, bucket, now);
      const after = this.#byRecipient.get(rKey)?.size ?? 0;
      deleted += before - after;
    }
    return deleted;
  }
}
