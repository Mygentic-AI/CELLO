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
 *   content.store.corrupt  WARN  { recipientPubkey, contentHash, reason }
 *   content.store.deposited DEBUG { recipientPubkey, contentHash, bytes }
 *   content.store.write.failed ERROR { recipientPubkey, contentHash, reason }
 */

import { open as fsOpen, mkdir, readdir, readFile, rename, unlink, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fsync } from "node:fs";
import { join } from "node:path";
import type { Logger, ContentStore, ContentStoreEntry } from "@cello-protocol/interfaces";
import { CONTENT_STORE_TTL_MS, CONTENT_STORE_MAX_BYTES, CONTENT_STORE_MAX_ENTRIES } from "@cello-protocol/interfaces";

export type { ContentStore, ContentStoreEntry };

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
}

export class FileContentStore implements ContentStore {
  readonly #root: string;
  readonly #logger: Logger;
  readonly #ttlMs: number;
  readonly #maxBytes: number;
  readonly #maxEntries: number;

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

    // Cap eviction: evict oldest-for-recipient until the new entry fits.
    // L1 (review round 1): the global byte/entry caps are BEST-EFFORT — eviction only
    // scans the depositing recipient's bucket so live delivery is never blocked. If the
    // global cap is consumed by OTHER recipients this loop drains the current recipient
    // to empty and then writes anyway; one hot recipient can push the store over the
    // global cap. This matches the AC-017 "oldest entry for the affected recipient"
    // wording; sustained content.store.full for one recipient is the capacity signal.
    let evictedCount = 0;
    let evictedBytes = 0;
    while (
      bucket.size > 0 &&
      (this.#totalEntries + 1 > this.#maxEntries || this.#totalBytes + incomingBytes > this.#maxBytes)
    ) {
      const oldestKey = bucket.keys().next().value as string | undefined;
      if (oldestKey === undefined) break;
      const oldest = bucket.get(oldestKey)!;
      bucket.delete(oldestKey);
      this.#totalBytes -= oldest.bytes;
      this.#totalEntries -= 1;
      evictedCount += 1;
      evictedBytes += oldest.bytes;
      await this.#unlinkFile(rHex, oldest.fileName);
    }
    if (evictedCount > 0) {
      this.#logger.warn("content.store.full", { recipientPubkey: rHex, evictedCount, evictedBytes });
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
