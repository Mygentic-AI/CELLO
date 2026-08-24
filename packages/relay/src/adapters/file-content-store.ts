/**
 * CELLO-M7-MSG-001 — FileContentStore.
 *
 * Durable, recipient-keyed store-and-forward queue for parked ENCRYPTED content.
 * Reuses the FileSessionWal pattern: WAL_DIR-rooted, fsync-durable, validateConfig
 * gate. Two deltas from the session WAL:
 *   (1) recipient-keyed + survives session teardown + TTL eviction
 *   (2) ENCRYPTED content blobs at rest (the relay cannot read them — SI-001)
 *
 * ─── On-disk layout ──────────────────────────────────────────────────────────
 *
 *   WAL_DIR/content/{recipientPubkeyHex}/{contentHashHex}__{depositedAt}__{bytes}.entry
 *
 * One file per parked entry. The metadata needed to rebuild the in-memory index
 * (depositedAt for FIFO/TTL, ciphertext byte count for the cap) is encoded IN THE
 * FILENAME, so a restart rebuilds the index from `readdir` alone — it never reads
 * (let alone base64-decodes) the ciphertext of every entry (M1, review round 1).
 * At the configured caps (up to 10k entries × ~1 MB) the old "decode every blob on
 * first access" path could transiently read gigabytes; filename metadata avoids it.
 *
 * delete-on-pickup and TTL/cap eviction unlink files; no log compaction is needed.
 * Deposit writes a temp file, fsyncs it, then renames (atomic) and fsyncs nothing
 * further — a crash never leaves a half-written entry under the final name.
 *
 * ─── Entry file format ───────────────────────────────────────────────────────
 *
 *   [JSON_BYTES] [UINT32BE checksum]   checksum = first 4 bytes of SHA-256(JSON)
 *   JSON = { rpk, ch, sid, ct, at }   (base64 byte fields + numeric depositedAt)
 *
 * A corrupt entry (checksum mismatch / parse error) is skipped, logged, and dropped
 * from the index — it is never delivered and never crashes the store.
 *
 * ─── Observability (injected Logger) ─────────────────────────────────────────
 *
 *   content.store.full     WARN  { recipientPubkey, evictedCount, evictedBytes }
 *                                — GLOBAL pressure forced eviction. Original meaning, preserved.
 *   content.store.recipient_rotated
 *                          INFO  { recipientPubkey, evictedCount, evictedBytes, impact }
 *                                — ordinary FIFO inside one recipient's own quota. Split out
 *                                  (DOD-M15-RELAYABUSE-1) so it stops drowning the WARN above.
 *   content.store.deposit_refused
 *                          WARN  { recipientPubkey, incomingBytes, bucketBytes, totalBytes,
 *                                  totalEntries, impact }
 *                                — a bound this deposit cannot fit inside; REFUSED before anything
 *                                  was evicted. Throws content_store_full / content_store_recipient_full.
 *   content.store.corrupt  WARN  { recipientPubkey, contentHash, reason }
 *   content.store.deposited DEBUG { recipientPubkey, contentHash, bytes }
 *   content.store.write.failed ERROR { recipientPubkey, contentHash, reason }
 */

import { open as fsOpen, mkdir, readdir, readFile, rename, unlink, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fsync } from "node:fs";
import { join } from "node:path";
import type { Logger, ContentStore, ContentStoreEntry } from "@cello-protocol/interfaces";
import { RELAY_PARK_REFUSALS } from "../relay-park-refusals.js";
import { CONTENT_STORE_TTL_MS, CONTENT_STORE_MAX_BYTES, CONTENT_STORE_MAX_ENTRIES, CONTENT_STORE_MAX_RECIPIENT_BYTES, CONTENT_STORE_MAX_RECIPIENT_ENTRIES } from "@cello-protocol/interfaces";

export type { ContentStore, ContentStoreEntry };

/**
 * M12-P18: resolve the parked-content retention (ms) from an operator-supplied RELAY_CONTENT_TTL_DAYS
 * value, falling back to `defaultMs` on absent/blank/invalid input. Pure and exported so the boot
 * glue that reads the env var is unit-tested rather than trusted — a NaN here would make the sweep
 * cutoff NaN and silently sweep nothing (or everything). Returns `invalid: true` only when a value
 * was SUPPLIED but unusable, so the caller can warn (a substituted default is fine; a silent one is
 * not — same rule as the idle sweep).
 */
export function resolveContentTtlMs(rawDays: string | undefined, defaultMs: number): { ttlMs: number; invalid: boolean } {
  if (rawDays === undefined || rawDays.trim() === "") return { ttlMs: defaultMs, invalid: false };
  const days = Number(rawDays);
  if (!Number.isFinite(days) || days <= 0) return { ttlMs: defaultMs, invalid: true };
  return { ttlMs: days * 24 * 60 * 60 * 1000, invalid: false };
}

interface EntryJson {
  rpk: string; // recipientPubkey base64
  ch: string;  // contentHash base64
  sid: string; // sessionId base64
  ct: string;  // ciphertext base64
  at: number;  // depositedAt
}

interface IndexEntry {
  bytes: number;
  depositedAt: number;
  /** Exact on-disk filename (metadata is encoded into it — see header). */
  fileName: string;
}

function b64(b: Uint8Array): string {
  return Buffer.from(b).toString("base64");
}

function fromB64(s: string): Uint8Array {
  return new Uint8Array(Buffer.from(s, "base64"));
}

function checksum(jsonBytes: Buffer): Buffer {
  return createHash("sha256").update(jsonBytes).digest().subarray(0, 4);
}

function fsyncPromise(fd: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    fsync(fd, (err) => (err ? reject(err) : resolve()));
  });
}

const ENTRY_SUFFIX = ".entry";

/** Build the on-disk filename for an entry (encodes depositedAt + ciphertext bytes). */
function entryFileName(cHex: string, depositedAt: number, bytes: number): string {
  return `${cHex}__${depositedAt}__${bytes}${ENTRY_SUFFIX}`;
}

/** Parse an entry filename back into its metadata, or null if it is not one of ours. */
function parseEntryFileName(fileName: string): { cHex: string; depositedAt: number; bytes: number } | null {
  if (!fileName.endsWith(ENTRY_SUFFIX)) return null;
  const stem = fileName.slice(0, -ENTRY_SUFFIX.length);
  const parts = stem.split("__");
  if (parts.length !== 3) return null;
  const [cHex, atStr, bytesStr] = parts;
  const depositedAt = Number(atStr);
  const bytes = Number(bytesStr);
  if (!cHex || !Number.isFinite(depositedAt) || !Number.isFinite(bytes)) return null;
  return { cHex, depositedAt, bytes };
}

export interface FileContentStoreOptions {
  walDir: string;
  logger: Logger;
  ttlMs?: number;
  maxBytes?: number;
  maxEntries?: number;
  /**
   * DOD-M15-RELAYABUSE-1: the most bytes ONE recipient's bucket may hold. Defaults to
   * `CONTENT_STORE_MAX_RECIPIENT_BYTES`.
   *
   * ⚠️ This is not the bound the audit asked for, and the reason is NARROWER than I first wrote.
   * I claimed a deposit "carries no depositor identity". **That was false** — review found the
   * transport already hands the handler a Noise-authenticated `remotePeerId`
   * (`CelloStreamHandler`), and `content-park.ts` simply discards it.
   *
   * The accurate statement: a libp2p peer id is not a CELLO agent identity and is cheap to rotate,
   * so a per-peer quota raises an attacker's cost without being a hard bound — which is why the
   * per-RECIPIENT cap is the one that actually binds. The distinction matters because the parent
   * line still asks for per-peer rate limiting, and "impossible" would have read as already ruled
   * out.
   */
  maxRecipientBytes?: number;
  /** DOD-M15-RELAYABUSE-1: the most ENTRIES one recipient's bucket may hold. See the constant. */
  maxRecipientEntries?: number;
}

export class FileContentStore implements ContentStore {
  readonly #root: string;
  readonly #logger: Logger;
  readonly #ttlMs: number;
  readonly #maxBytes: number;
  readonly #maxEntries: number;
  readonly #maxRecipientBytes: number;
  readonly #maxRecipientEntries: number;

  /** recipientHex -> (contentHashHex -> metadata), insertion-ordered for FIFO eviction. */
  readonly #index = new Map<string, Map<string, IndexEntry>>();
  #totalBytes = 0;
  #totalEntries = 0;
  #loaded = false;

  constructor(opts: FileContentStoreOptions) {
    this.#root = join(opts.walDir, "content");
    this.#logger = opts.logger;
    this.#ttlMs = opts.ttlMs ?? CONTENT_STORE_TTL_MS;
    this.#maxBytes = opts.maxBytes ?? CONTENT_STORE_MAX_BYTES;
    this.#maxEntries = opts.maxEntries ?? CONTENT_STORE_MAX_ENTRIES;
    this.#maxRecipientBytes = opts.maxRecipientBytes ?? CONTENT_STORE_MAX_RECIPIENT_BYTES;
    this.#maxRecipientEntries = opts.maxRecipientEntries ?? CONTENT_STORE_MAX_RECIPIENT_ENTRIES;
  }

  /** Same composition-root gate as FileSessionWal (AC-008). */
  static validateConfig(env: string, walDir: string): boolean {
    if (env === "local") return true;
    return !!walDir;
  }

  #recipientDir(rHex: string): string {
    return join(this.#root, rHex);
  }

  #pathFor(rHex: string, fileName: string): string {
    return join(this.#recipientDir(rHex), fileName);
  }

  /**
   * Rebuild the in-memory metadata index by scanning WAL_DIR/content on first use
   * (durable-restart path, AC-007/AC-016). The metadata is parsed from the FILENAMES
   * only — ciphertext is never read here (M1). FIFO/TTL order is reconstructed from
   * the depositedAt encoded in each filename.
   */
  async #ensureLoaded(): Promise<void> {
    if (this.#loaded) return;
    this.#loaded = true;
    let recipients: string[];
    try {
      recipients = await readdir(this.#root);
    } catch {
      return; // no content dir yet — nothing parked
    }
    for (const rHex of recipients) {
      let files: string[];
      try {
        files = await readdir(this.#recipientDir(rHex));
      } catch {
        continue;
      }
      const parsed: Array<{ cHex: string; depositedAt: number; bytes: number; fileName: string }> = [];
      for (const f of files) {
        const meta = parseEntryFileName(f);
        if (!meta) continue; // skip .tmp and anything not ours
        parsed.push({ ...meta, fileName: f });
      }
      // Sort by depositedAt so FIFO eviction order survives restart.
      parsed.sort((a, b) => a.depositedAt - b.depositedAt);
      const bucket = new Map<string, IndexEntry>();
      for (const m of parsed) {
        // If two files share a cHex (replace crash window), keep the newest and unlink the older.
        const existing = bucket.get(m.cHex);
        if (existing) {
          this.#totalBytes -= existing.bytes;
          this.#totalEntries -= 1;
          await this.#unlinkFile(rHex, existing.fileName);
        }
        bucket.set(m.cHex, { bytes: m.bytes, depositedAt: m.depositedAt, fileName: m.fileName });
        this.#totalBytes += m.bytes;
        this.#totalEntries += 1;
      }
      if (bucket.size > 0) this.#index.set(rHex, bucket);
    }
  }

  /** Read + checksum-validate the on-disk ciphertext for an indexed entry. */
  async #readEntry(rHex: string, cHex: string): Promise<ContentStoreEntry | null> {
    const meta = this.#index.get(rHex)?.get(cHex);
    if (!meta) return null;
    const path = this.#pathFor(rHex, meta.fileName);
    let bytes: Buffer;
    try {
      bytes = await readFile(path);
    } catch {
      return null;
    }
    if (bytes.length < 4) {
      this.#logger.warn("content.store.corrupt", { recipientPubkey: rHex, contentHash: cHex, reason: "truncated" });
      await this.#removeFromIndex(rHex, cHex);
      return null;
    }
    const jsonBytes = bytes.subarray(0, bytes.length - 4);
    const storedChecksum = bytes.subarray(bytes.length - 4);
    if (!storedChecksum.equals(checksum(Buffer.from(jsonBytes)))) {
      this.#logger.warn("content.store.corrupt", { recipientPubkey: rHex, contentHash: cHex, reason: "checksum_mismatch" });
      await this.#removeFromIndex(rHex, cHex);
      return null;
    }
    try {
      const j = JSON.parse(jsonBytes.toString("utf8")) as EntryJson;
      return {
        recipientPubkey: fromB64(j.rpk),
        contentHash: fromB64(j.ch),
        sessionId: fromB64(j.sid),
        ciphertext: fromB64(j.ct),
        depositedAt: j.at,
      };
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : String(err);
      this.#logger.warn("content.store.corrupt", { recipientPubkey: rHex, contentHash: cHex, reason: `json_parse_failed: ${reason}` });
      await this.#removeFromIndex(rHex, cHex);
      return null;
    }
  }

  async #unlinkFile(rHex: string, fileName: string): Promise<void> {
    try {
      await unlink(this.#pathFor(rHex, fileName));
    } catch {
      /* idempotent — already gone */
    }
  }

  async deposit(entry: ContentStoreEntry): Promise<void> {
    await this.#ensureLoaded();
    const rHex = Buffer.from(entry.recipientPubkey).toString("hex");
    const cHex = Buffer.from(entry.contentHash).toString("hex");
    let bucket = this.#index.get(rHex);
    if (!bucket) {
      bucket = new Map();
      this.#index.set(rHex, bucket);
    }

    // F5 (review round 1): first-writer-wins, NOT idempotent-replace. Deposit is open
    // by design and (recipientPubkey, contentHash) are both visible at the relay's hash
    // layer, so a last-writer-wins replace let an attacker who observes a leaf re-deposit
    // junk ciphertext under the same key and EVICT the legitimate parked blob
    // (denial-of-delivery). With first-writer-wins, a re-deposit for a key that already
    // holds a non-expired entry is a benign no-op (a legitimate re-park parks the SAME
    // content) and a hostile overwrite is rejected. An expired entry is replaced.
    const prev = bucket.get(cHex);
    if (prev) {
      if (!this.#isExpired(prev.depositedAt, Date.now())) return; // first writer wins
      this.#totalBytes -= prev.bytes;
      this.#totalEntries -= 1;
      bucket.delete(cHex);
      await this.#unlinkFile(rHex, prev.fileName);
    }

    const incomingBytes = entry.ciphertext.length;

    /**
     * ⚠️ REFUSE FIRST, EVICT SECOND — and getting this order wrong made the attack WORSE than the
     * defect it fixed. The first version evicted, then refused. Since eviction only ever scans the
     * DEPOSITING recipient's bucket (deliberately — a flood at one recipient must never delete
     * another's mail), a store filled by OTHER recipients meant the loop drained this recipient to
     * EMPTY, could not possibly make room, and then refused.
     *
     * That is an unauthenticated, repeatable, near-zero-cost wipe of a chosen victim: fill the store
     * globally, then send ONE 1-byte deposit addressed to them, and their entire undelivered mailbox
     * is unlinked while the attacker's own junk is untouched. The pre-change code at least stored the
     * incoming message; emptying the bucket and keeping nothing was new damage.
     *
     * So the ordering is now: work out whether eviction COULD make room, and if it could not, refuse
     * without touching a byte. Eviction is legitimate only for the bound this bucket actually
     * controls — its own quota.
     */
    let bucketBytes = 0;
    for (const e of bucket.values()) bucketBytes += e.bytes;
    const bucketEntries = bucket.size;

    // The room that exists for this recipient even if their whole bucket were dropped. Pressure from
    // OTHER recipients lives outside this bucket, so draining it cannot relieve them.
    const globalRoomIfDrained = this.#maxBytes - (this.#totalBytes - bucketBytes);
    const globalEntryRoomIfDrained = this.#maxEntries - (this.#totalEntries - bucketEntries);

    if (
      incomingBytes > globalRoomIfDrained ||
      incomingBytes > this.#maxRecipientBytes ||
      globalEntryRoomIfDrained < 1 ||
      this.#maxRecipientEntries < 1
    ) {
      this.#logger.warn("content.store.deposit_refused", {
        recipientPubkey: rHex,
        incomingBytes,
        bucketBytes,
        totalBytes: this.#totalBytes,
        totalEntries: this.#totalEntries,
        impact:
          "the parked-content store is at a bound this deposit cannot fit inside, so it was REFUSED " +
          "BEFORE anything was evicted — nothing already parked for this recipient or any other was " +
          "touched. The depositor keeps its copy in the durable retry queue and may retry.",
      });
      if (bucket.size === 0) this.#index.delete(rHex);
      throw new Error(
        incomingBytes > this.#maxRecipientBytes || this.#maxRecipientEntries < 1
          ? RELAY_PARK_REFUSALS.RECIPIENT_FULL
          : RELAY_PARK_REFUSALS.STORE_FULL,
      );
    }

    /**
     * Now evict, knowing it can succeed. FIFO WITHIN THIS RECIPIENT'S OWN QUOTA is the legitimate
     * case: their mailbox is full of their own older mail and the newest message wins. That is
     * ordinary rotation, not pressure — which is why it no longer raises `content.store.full`.
     */
    let evictedCount = 0;
    let evictedBytes = 0;
    // Which bound drove the eviction decides which signal it raises — see the log below.
    const globalPressure =
      this.#totalEntries + 1 > this.#maxEntries || this.#totalBytes + incomingBytes > this.#maxBytes;
    while (
      bucket.size > 0 &&
      (this.#totalEntries + 1 > this.#maxEntries ||
        this.#totalBytes + incomingBytes > this.#maxBytes ||
        bucketBytes + incomingBytes > this.#maxRecipientBytes ||
        bucket.size + 1 > this.#maxRecipientEntries)
    ) {      const oldestKey = bucket.keys().next().value as string | undefined;
      if (oldestKey === undefined) break;
      const oldest = bucket.get(oldestKey)!;
      bucket.delete(oldestKey);
      this.#totalBytes -= oldest.bytes;
      this.#totalEntries -= 1;
      evictedCount += 1;
      evictedBytes += oldest.bytes;
      bucketBytes -= oldest.bytes;
      await this.#unlinkFile(rHex, oldest.fileName);
    }
    /**
     * ⚠️ NO EMPTY-BUCKET CLEANUP HERE, and the reason is worth writing down because I nearly shipped
     * the opposite. The empty bucket is removed only on the REFUSAL path above, where nothing more
     * will be written. Doing it here too looks symmetrical and is a data-loss bug: `bucket.set(...)`
     * below writes the incoming entry into THIS map object, so detaching it from `#index` first
     * leaves the file on disk and the entry invisible to every read until a restart rebuilds from
     * `readdir`.
     */
    if (evictedCount > 0) {
      /**
       * ⚠️ RENAMED — review Finding 6. `content.store.full` used to mean "the relay is at 256 MiB":
       * rare and alarming. After the per-recipient cap it would also fire every time a busy offline
       * recipient rotates FIFO inside their own quota, which is ordinary steady state — one name for
       * two meanings, with the frequent benign one drowning the rare serious one.
       */
      if (globalPressure) {
        // The ORIGINAL meaning, preserved deliberately: the store as a whole is under pressure. Any
        // alert keyed on this name keeps firing for exactly the condition it was written for.
        this.#logger.warn("content.store.full", { recipientPubkey: rHex, evictedCount, evictedBytes });
      } else {
        this.#logger.info("content.store.recipient_rotated", {
          recipientPubkey: rHex,
          evictedCount,
          evictedBytes,
          impact:
            "this recipient's own oldest parked content was rotated out to make room inside their " +
            "own quota — no other recipient is affected, and this is expected for a recipient who " +
            "has been offline a long time",
        });
      }
    }

    // Write atomically: temp file → fsync → rename.
    const dir = this.#recipientDir(rHex);
    await mkdir(dir, { recursive: true });
    const j: EntryJson = {
      rpk: b64(entry.recipientPubkey),
      ch: b64(entry.contentHash),
      sid: b64(entry.sessionId),
      ct: b64(entry.ciphertext),
      at: entry.depositedAt,
    };
    const jsonBytes = Buffer.from(JSON.stringify(j), "utf8");
    const fileBytes = Buffer.concat([jsonBytes, checksum(jsonBytes)]);
    const fileName = entryFileName(cHex, entry.depositedAt, incomingBytes);
    const finalPath = this.#pathFor(rHex, fileName);
    const tmpPath = `${finalPath}.tmp`;
    try {
      const handle = await fsOpen(tmpPath, "w");
      try {
        await handle.write(fileBytes);
        await fsyncPromise(handle.fd);
      } finally {
        await handle.close();
      }
      await rename(tmpPath, finalPath);
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : String(err);
      this.#logger.error("content.store.write.failed", { recipientPubkey: rHex, contentHash: cHex, reason });
      await unlink(tmpPath).catch(() => {});
      throw err;
    }

    bucket.set(cHex, { bytes: incomingBytes, depositedAt: entry.depositedAt, fileName });
    this.#totalBytes += incomingBytes;
    this.#totalEntries += 1;
    this.#logger.debug("content.store.deposited", { recipientPubkey: rHex, contentHash: cHex, bytes: incomingBytes });
  }

  #isExpired(depositedAt: number, now: number): boolean {
    return now - depositedAt >= this.#ttlMs;
  }

  async #removeFromIndex(rHex: string, cHex: string): Promise<void> {
    const bucket = this.#index.get(rHex);
    if (!bucket) return;
    const meta = bucket.get(cHex);
    if (!meta) return;
    bucket.delete(cHex);
    this.#totalBytes -= meta.bytes;
    this.#totalEntries -= 1;
    if (bucket.size === 0) this.#index.delete(rHex);
    await this.#unlinkFile(rHex, meta.fileName);
  }

  async hasContent(recipientPubkeyHex: string): Promise<boolean> {
    await this.#ensureLoaded();
    const bucket = this.#index.get(recipientPubkeyHex);
    if (!bucket) return false;
    const now = Date.now();
    for (const [cHex, meta] of [...bucket.entries()]) {
      if (this.#isExpired(meta.depositedAt, now)) await this.#removeFromIndex(recipientPubkeyHex, cHex);
    }
    return (this.#index.get(recipientPubkeyHex)?.size ?? 0) > 0;
  }

  async listContentHashesFor(recipientPubkeyHex: string): Promise<string[]> {
    await this.#ensureLoaded();
    const bucket = this.#index.get(recipientPubkeyHex);
    if (!bucket) return [];
    const now = Date.now();
    for (const [cHex, meta] of [...bucket.entries()]) {
      if (this.#isExpired(meta.depositedAt, now)) await this.#removeFromIndex(recipientPubkeyHex, cHex);
    }
    return [...(this.#index.get(recipientPubkeyHex)?.keys() ?? [])];
  }

  async pull(recipientPubkeyHex: string): Promise<ContentStoreEntry[]> {
    await this.#ensureLoaded();
    const bucket = this.#index.get(recipientPubkeyHex);
    if (!bucket) return [];
    const now = Date.now();
    const out: ContentStoreEntry[] = [];
    for (const [cHex, meta] of [...bucket.entries()]) {
      if (this.#isExpired(meta.depositedAt, now)) {
        await this.#removeFromIndex(recipientPubkeyHex, cHex);
        continue;
      }
      const entry = await this.#readEntry(recipientPubkeyHex, cHex);
      if (entry) out.push(entry);
    }
    return out;
  }

  async pullOne(recipientPubkeyHex: string, contentHashHex: string): Promise<ContentStoreEntry | null> {
    await this.#ensureLoaded();
    const bucket = this.#index.get(recipientPubkeyHex);
    const meta = bucket?.get(contentHashHex);
    if (!meta) return null;
    if (this.#isExpired(meta.depositedAt, Date.now())) {
      await this.#removeFromIndex(recipientPubkeyHex, contentHashHex);
      return null;
    }
    return this.#readEntry(recipientPubkeyHex, contentHashHex);
  }

  async confirmPickup(recipientPubkeyHex: string, contentHashHex: string): Promise<void> {
    await this.#ensureLoaded();
    await this.#removeFromIndex(recipientPubkeyHex, contentHashHex);
  }

  async sweepExpired(now: number = Date.now()): Promise<number> {
    await this.#ensureLoaded();
    let deleted = 0;
    for (const [rHex, bucket] of [...this.#index.entries()]) {
      for (const [cHex, meta] of [...bucket.entries()]) {
        if (this.#isExpired(meta.depositedAt, now)) {
          await this.#removeFromIndex(rHex, cHex);
          deleted += 1;
        }
      }
    }
    return deleted;
  }

  /** Test/diagnostic helper: does the on-disk entry file exist? */
  async hasEntryFile(recipientPubkeyHex: string, contentHashHex: string): Promise<boolean> {
    await this.#ensureLoaded();
    const meta = this.#index.get(recipientPubkeyHex)?.get(contentHashHex);
    if (!meta) return false;
    try {
      await stat(this.#pathFor(recipientPubkeyHex, meta.fileName));
      return true;
    } catch {
      return false;
    }
  }
}
