/**
 * CELLO-PERSIST-013 — FileSessionWal and InMemorySessionWal
 *
 * FileSessionWal: per-session write-ahead log on local disk.
 * Records every Structure 2 leaf as it is sequenced. On relay crash + restart,
 * the relay reads the WAL and reconstructs in-memory Merkle state without requiring
 * agent re-submission.
 *
 * WAL file path: WAL_DIR/{sessionId}.wal
 *
 * ─── Wire format (per entry) ──────────────────────────────────────────────────
 *
 *   [UINT32BE json_byte_length] [JSON_BYTES] [UINT32BE checksum]
 *
 *   checksum = first 4 bytes of SHA-256(json_bytes)
 *   json_bytes = UTF-8 JSON of: {
 *     seq: number,
 *     spk: string,   // sender_pubkey — base64
 *     ch:  string,   // content_hash — base64
 *     ss:  string,   // sender_signature — base64
 *     pr:  string,   // prev_root — base64
 *   }
 *
 * Field names are abbreviated to keep entries compact.
 * On read: if any entry's checksum does not match → RELAY_SESSION_UNRECOVERABLE.
 * Partial reconstruction is impossible (SI-003).
 *
 * ─── Durability guarantee (SI-002) ───────────────────────────────────────────
 *
 * append() writes the entry and calls fsync(fd) before resolving. The ACK is
 * issued only after the data is durable on disk. The session must be opened via
 * open() before the first append().
 *
 * ─── Composition root wiring (AC-005) ────────────────────────────────────────
 *
 * Call FileSessionWal.assertConfig(env, walDir) at startup.
 * CELLO_ENV=dev/production: throws if walDir is empty (exits 1 → adapter.config.missing).
 * CELLO_ENV=local: InMemorySessionWal is used; no WAL_DIR required.
 *
 * ─── Observability (all via injected Logger) ─────────────────────────────────
 *
 * relay.wal.opened        INFO  { sessionId, walPath }              — at session open
 * relay.wal.reconstructed INFO  { sessionId, leafCount, durationMs } — on success
 * relay.wal.deleted       INFO  { sessionId }                       — after seal confirmation
 * relay.wal.unrecoverable ERROR { sessionId, reason }               — corrupt/truncated (once per session)
 * relay.wal.write.failed  ERROR { sessionId, reason }               — disk write failure
 * relay.wal.entry.corrupt ERROR { sessionId, entryIndex, reason }   — checksum mismatch (per entry)
 */

import { open as fsOpen, unlink, stat, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { fsync } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import type { Logger } from "@cello/interfaces";
import type { SessionWal, Leaf } from "@cello/interfaces";
import { RELAY_SESSION_UNRECOVERABLE } from "@cello/interfaces";
import { InMemorySessionWal } from "@cello/interfaces/stubs";

// Re-export for test imports and relay barrel
export { RELAY_SESSION_UNRECOVERABLE };
export type { SessionWal, Leaf };
export { InMemorySessionWal };

// ─── Wire format helpers ──────────────────────────────────────────────────────

interface WalJsonEntry {
  seq: number;
  spk: string; // sender_pubkey base64
  ch: string;  // content_hash base64
  ss: string;  // sender_signature base64
  pr: string;  // prev_root base64
  sc: string;  // structure1_cbor base64
}

function serializeEntry(leaf: Leaf): Buffer {
  const entry: WalJsonEntry = {
    seq: leaf.sequence_number,
    spk: Buffer.from(leaf.sender_pubkey).toString("base64"),
    ch:  Buffer.from(leaf.content_hash).toString("base64"),
    ss:  Buffer.from(leaf.sender_signature).toString("base64"),
    pr:  Buffer.from(leaf.prev_root).toString("base64"),
    sc:  Buffer.from(leaf.structure1_cbor).toString("base64"),
  };
  return Buffer.from(JSON.stringify(entry), "utf8");
}

function deserializeEntry(jsonBytes: Buffer): Leaf {
  const entry = JSON.parse(jsonBytes.toString("utf8")) as WalJsonEntry;
  return {
    sequence_number: entry.seq,
    sender_pubkey: new Uint8Array(Buffer.from(entry.spk, "base64")),
    content_hash: new Uint8Array(Buffer.from(entry.ch, "base64")),
    sender_signature: new Uint8Array(Buffer.from(entry.ss, "base64")),
    prev_root: new Uint8Array(Buffer.from(entry.pr, "base64")),
    structure1_cbor: new Uint8Array(Buffer.from(entry.sc ?? "", "base64")),
  };
}

function computeChecksum(jsonBytes: Buffer): Buffer {
  return createHash("sha256").update(jsonBytes).digest().subarray(0, 4);
}

function fsyncPromise(fd: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    fsync(fd, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

// ─── FileSessionWal ───────────────────────────────────────────────────────────

export interface FileSessionWalOptions {
  walDir: string;
  logger: Logger;
}

export class FileSessionWal implements SessionWal {
  readonly #walDir: string;
  readonly #logger: Logger;
  /** Per-session open file handles (append mode). Opened explicitly via open(). */
  readonly #handles = new Map<string, FileHandle>();
  /** Track which sessions have been explicitly opened. */
  readonly #opened = new Set<string>();

  constructor(opts: FileSessionWalOptions) {
    this.#walDir = opts.walDir;
    this.#logger = opts.logger;
  }

  /**
   * AC-005: Boolean config check for use in the composition root.
   * Returns false if walDir is missing in dev/production (so the caller can emit
   * a structured adapter.config.missing log event before process.exit(1)).
   * Returns true if configuration is valid.
   * CELLO_ENV=local: no WAL_DIR required — InMemorySessionWal is used instead.
   */
  static validateConfig(env: string, walDir: string): boolean {
    if (env === "local") return true;
    return !!walDir;
  }

  #walPath(sessionId: string): string {
    return join(this.#walDir, `${sessionId}.wal`);
  }

  /**
   * Open the WAL for a session. Must be called before append().
   * Creates/opens the WAL file for the session in append mode (O_CREAT | O_APPEND).
   * Logs relay.wal.opened with { sessionId, walPath }.
   * Idempotent — if already open, does nothing.
   * On file-system failure: logs relay.wal.write.failed and rejects.
   */
  async open(sessionId: string): Promise<void> {
    if (this.#opened.has(sessionId)) return;
    const walPath = this.#walPath(sessionId);
    let handle: FileHandle;
    try {
      // O_CREAT | O_APPEND: create if not exists; always append
      handle = await fsOpen(walPath, "a");
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : String(err);
      this.#logger.error("relay.wal.write.failed", { sessionId, reason });
      throw err;
    }
    this.#handles.set(sessionId, handle);
    this.#opened.add(sessionId);
    this.#logger.info("relay.wal.opened", { sessionId, walPath });
  }

  async append(sessionId: string, leaf: Leaf): Promise<void> {
    if (!this.#opened.has(sessionId)) {
      const reason = `session not open — call open(${sessionId}) before append()`;
      this.#logger.error("relay.wal.write.failed", { sessionId, reason });
      throw new Error(`SessionWal: ${reason}`);
    }

    const handle = this.#handles.get(sessionId)!;

    const jsonBytes = serializeEntry(leaf);
    const checksum = computeChecksum(jsonBytes);

    // Length-prefix header (4 bytes big-endian)
    const header = Buffer.allocUnsafe(4);
    header.writeUInt32BE(jsonBytes.length, 0);

    // Write: [UINT32BE length] [JSON bytes] [UINT32BE checksum]
    const entry = Buffer.concat([header, jsonBytes, checksum]);

    try {
      await handle.write(entry);
      // SI-002: fsync before resolving — the ACK is durable
      await fsyncPromise(handle.fd);
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : String(err);
      this.#logger.error("relay.wal.write.failed", { sessionId, reason });
      throw err;
    }
  }

  async reconstruct(sessionId: string): Promise<Leaf[] | typeof RELAY_SESSION_UNRECOVERABLE> {
    const start = Date.now();
    const walPath = this.#walPath(sessionId);

    // Check if WAL file exists; return empty array if it doesn't
    try {
      await stat(walPath);
    } catch {
      // File does not exist — new session, no crash recovery needed
      const durationMs = Date.now() - start;
      this.#logger.info("relay.wal.reconstructed", { sessionId, leafCount: 0, durationMs });
      return [];
    }

    // Close any open handle for this session before reading
    // (we may be reconstructing from a crashed process where the handle is gone)
    const existingHandle = this.#handles.get(sessionId);
    if (existingHandle) {
      try { await existingHandle.close(); } catch { /* ignore */ }
      this.#handles.delete(sessionId);
    }
    // Clear opened so a subsequent open() re-fires relay.wal.opened
    this.#opened.delete(sessionId);

    // Read the full file — L-003: use readFile() to allocate exactly the right size
    let fileBytes: Buffer;
    try {
      fileBytes = await readFile(walPath);
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : String(err);
      this.#logger.error("relay.wal.unrecoverable", { sessionId, reason });
      return RELAY_SESSION_UNRECOVERABLE;
    }

    // Parse entries
    const leaves: Leaf[] = [];
    let offset = 0;
    let entryIndex = 0;

    while (offset < fileBytes.length) {
      // Need at least 4 bytes for the length prefix
      if (offset + 4 > fileBytes.length) {
        // Truncated header — partial write
        this.#logger.error("relay.wal.unrecoverable", {
          sessionId,
          reason: `truncated_header at offset ${offset} (${fileBytes.length - offset} bytes remain)`,
        });
        return RELAY_SESSION_UNRECOVERABLE;
      }

      const jsonLen = fileBytes.readUInt32BE(offset);
      offset += 4;

      // Need jsonLen bytes + 4 bytes for checksum
      if (offset + jsonLen + 4 > fileBytes.length) {
        this.#logger.error("relay.wal.unrecoverable", {
          sessionId,
          reason: `truncated_entry at entryIndex ${entryIndex}, offset ${offset}, jsonLen ${jsonLen}`,
        });
        return RELAY_SESSION_UNRECOVERABLE;
      }

      const jsonBytes = fileBytes.subarray(offset, offset + jsonLen);
      offset += jsonLen;

      const storedChecksum = fileBytes.subarray(offset, offset + 4);
      offset += 4;

      const expectedChecksum = computeChecksum(Buffer.from(jsonBytes));

      if (!storedChecksum.equals(expectedChecksum)) {
        // L-005: relay.wal.entry.corrupt fires per-entry
        this.#logger.error("relay.wal.entry.corrupt", {
          sessionId,
          entryIndex,
          reason: "checksum_mismatch",
        });
        // L-005: relay.wal.unrecoverable fires once for the session
        this.#logger.error("relay.wal.unrecoverable", {
          sessionId,
          reason: `corrupt_entry at entryIndex ${entryIndex}`,
        });
        return RELAY_SESSION_UNRECOVERABLE;
      }

      let leaf: Leaf;
      try {
        leaf = deserializeEntry(Buffer.from(jsonBytes));
      } catch (err: unknown) {
        const reason = err instanceof Error ? err.message : String(err);
        // L-005: relay.wal.entry.corrupt fires per-entry
        this.#logger.error("relay.wal.entry.corrupt", {
          sessionId,
          entryIndex,
          reason: `json_parse_failed: ${reason}`,
        });
        // L-005: relay.wal.unrecoverable fires once for the session
        this.#logger.error("relay.wal.unrecoverable", {
          sessionId,
          reason: `corrupt_entry at entryIndex ${entryIndex}: json_parse_failed`,
        });
        return RELAY_SESSION_UNRECOVERABLE;
      }

      leaves.push(leaf);
      entryIndex++;
    }

    const durationMs = Date.now() - start;
    this.#logger.info("relay.wal.reconstructed", {
      sessionId,
      leafCount: leaves.length,
      durationMs,
    });

    // L-002: #opened was cleared above (so close + re-open is clean). The caller must
    // call open(sessionId) after reconstruct() to re-open the session for appending.
    // This fires relay.wal.opened at the correct time (session begin, not during reconstruct).

    return leaves;
  }

  async delete(sessionId: string): Promise<void> {
    // Close the open handle if any
    const handle = this.#handles.get(sessionId);
    if (handle) {
      try { await handle.close(); } catch { /* ignore */ }
      this.#handles.delete(sessionId);
    }
    this.#opened.delete(sessionId);

    const walPath = this.#walPath(sessionId);
    try {
      await unlink(walPath);
    } catch (err: unknown) {
      // Idempotent: if the file doesn't exist, that's fine
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        this.#logger.info("relay.wal.deleted", { sessionId });
        return;
      }
      // Unexpected error — surface it but still log
      throw err;
    }

    this.#logger.info("relay.wal.deleted", { sessionId });
  }

  /**
   * PERSIST-014: Read all WAL leaves from the file WITHOUT disturbing any open handle.
   * Unlike `reconstruct()`, this does NOT close or remove `#handles` or `#opened`.
   * Used for live gap-fill requests while the session may still be appending.
   */
  async #readAllFromFile(sessionId: string): Promise<Leaf[] | typeof RELAY_SESSION_UNRECOVERABLE> {
    const walPath = this.#walPath(sessionId);

    let fileBytes: Buffer;
    try {
      fileBytes = await readFile(walPath);
    } catch (err: unknown) {
      // File doesn't exist → no leaves yet
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      const reason = err instanceof Error ? err.message : String(err);
      this.#logger.error("relay.wal.unrecoverable", { sessionId, reason });
      return RELAY_SESSION_UNRECOVERABLE;
    }

    const leaves: Leaf[] = [];
    let offset = 0;
    let entryIndex = 0;

    while (offset < fileBytes.length) {
      if (offset + 4 > fileBytes.length) {
        this.#logger.error("relay.wal.unrecoverable", { sessionId, reason: `truncated_header at offset ${offset}` });
        return RELAY_SESSION_UNRECOVERABLE;
      }
      const jsonLen = fileBytes.readUInt32BE(offset);
      offset += 4;

      if (offset + jsonLen + 4 > fileBytes.length) {
        this.#logger.error("relay.wal.unrecoverable", { sessionId, reason: `truncated_entry at entryIndex ${entryIndex}` });
        return RELAY_SESSION_UNRECOVERABLE;
      }
      const jsonBytes = fileBytes.subarray(offset, offset + jsonLen);
      offset += jsonLen;

      const storedChecksum = fileBytes.subarray(offset, offset + 4);
      offset += 4;

      if (!storedChecksum.equals(computeChecksum(Buffer.from(jsonBytes)))) {
        this.#logger.error("relay.wal.entry.corrupt", { sessionId, entryIndex, reason: "checksum_mismatch" });
        this.#logger.error("relay.wal.unrecoverable", { sessionId, reason: `corrupt_entry at entryIndex ${entryIndex}` });
        return RELAY_SESSION_UNRECOVERABLE;
      }

      try {
        leaves.push(deserializeEntry(Buffer.from(jsonBytes)));
      } catch (err: unknown) {
        const reason = err instanceof Error ? err.message : String(err);
        this.#logger.error("relay.wal.entry.corrupt", { sessionId, entryIndex, reason: `json_parse_failed: ${reason}` });
        this.#logger.error("relay.wal.unrecoverable", { sessionId, reason: `corrupt_entry at entryIndex ${entryIndex}: json_parse_failed` });
        return RELAY_SESSION_UNRECOVERABLE;
      }

      entryIndex++;
    }

    return leaves;
  }

  /**
   * PERSIST-014: Retrieve leaves for gap-fill reconciliation.
   * Reads the WAL file directly without closing any active file handles.
   * SI-001: Only serves leaves with sequence_number > fromSeq and <= toSeq.
   */
  async getLeaves(sessionId: string, fromSeq: number, toSeq: number): Promise<Leaf[] | typeof RELAY_SESSION_UNRECOVERABLE> {
    const allLeaves = await this.#readAllFromFile(sessionId);
    if (allLeaves === RELAY_SESSION_UNRECOVERABLE) {
      return RELAY_SESSION_UNRECOVERABLE;
    }
    return allLeaves.filter((l) => l.sequence_number > fromSeq && l.sequence_number <= toSeq);
  }
}
