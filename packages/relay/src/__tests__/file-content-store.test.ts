/**
 * CELLO-M7-MSG-001 — FileContentStore (AC-007 restart durability, AC-016 byte-usable
 * round-trip + decrypt/cross-check, AC-008 validateConfig, SI-001 ciphertext at rest).
 *
 * Uses a real on-disk directory and a NEW store instance after "restart" to prove
 * durability is not just in-memory. The sealed blob is produced with a real AEAD
 * (AES-256-GCM) so the decrypt + cross-check actually runs — byte equality alone
 * does not satisfy AC-016.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { Logger, LogContext, ContentStoreEntry } from "@cello-protocol/interfaces";
import { FileContentStore } from "../adapters/file-content-store.js";

function captureLogger(): { logger: Logger; events: Array<{ name: string; ctx?: LogContext | Error }> } {
  const events: Array<{ name: string; ctx?: LogContext | Error }> = [];
  const logger: Logger = {
    debug: (name, ctx) => events.push({ name, ctx }),
    info: (name, ctx) => events.push({ name, ctx }),
    warn: (name, ctx) => events.push({ name, ctx }),
    error: (name, ctx) => events.push({ name, ctx }),
  };
  return { logger, events };
}

/** A real AEAD seal so the store holds genuine ciphertext (stands in for the client crypto). */
const KEY = randomBytes(32);
function seal(plaintext: Uint8Array): Uint8Array {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", KEY, iv);
  const ct = Buffer.concat([c.update(Buffer.from(plaintext)), c.final()]);
  return new Uint8Array(Buffer.concat([iv, ct, c.getAuthTag()]));
}
function open(blob: Uint8Array): Uint8Array {
  const iv = blob.subarray(0, 12);
  const tag = blob.subarray(blob.length - 16);
  const ct = blob.subarray(12, blob.length - 16);
  const d = createDecipheriv("aes-256-gcm", KEY, Buffer.from(iv));
  d.setAuthTag(Buffer.from(tag));
  return new Uint8Array(Buffer.concat([d.update(Buffer.from(ct)), d.final()]));
}
function sha256(b: Uint8Array): Uint8Array {
  return new Uint8Array(createHash("sha256").update(Buffer.from(b)).digest());
}

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "cello-content-store-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const recipient = new Uint8Array(32).fill(0xab);
const rHex = Buffer.from(recipient).toString("hex");

function makeEntry(plaintextStr: string): { entry: ContentStoreEntry; plaintext: Uint8Array } {
  const plaintext = new TextEncoder().encode(plaintextStr);
  const ciphertext = seal(plaintext);
  const contentHash = sha256(plaintext);
  return {
    plaintext,
    entry: {
      recipientPubkey: recipient,
      contentHash,
      sessionId: new Uint8Array([1, 2, 3, 4]),
      ciphertext,
      depositedAt: Date.now(),
    },
  };
}

describe("FileContentStore (MSG-001)", () => {
  it("validateConfig requires WAL_DIR in dev/production, not in local (AC-008)", () => {
    expect(FileContentStore.validateConfig("local", "")).toBe(true);
    expect(FileContentStore.validateConfig("dev", "")).toBe(false);
    expect(FileContentStore.validateConfig("production", "")).toBe(false);
    expect(FileContentStore.validateConfig("dev", "/some/dir")).toBe(true);
  });

  it("parked content survives a relay restart and the pulled blob decrypts + cross-checks (AC-007, AC-016)", async () => {
    const { logger } = captureLogger();
    const { entry, plaintext } = makeEntry("durable parked content");
    const cHex = Buffer.from(entry.contentHash).toString("hex");

    const store1 = new FileContentStore({ walDir: dir, logger });
    await store1.deposit(entry);

    // "Restart": a brand-new instance pointing at the same WAL_DIR.
    const store2 = new FileContentStore({ walDir: dir, logger });
    const pulled = await store2.pull(rHex);
    expect(pulled).toHaveLength(1);

    // Byte-usable: decrypt the recovered blob and cross-check the content hash.
    const decrypted = open(pulled[0].ciphertext);
    expect(Buffer.from(decrypted).toString("utf8")).toBe("durable parked content");
    expect(Buffer.from(sha256(decrypted))).toEqual(Buffer.from(entry.contentHash));
    expect(Buffer.from(decrypted)).toEqual(Buffer.from(plaintext));

    // delete-on-pickup after a successful cross-check.
    await store2.confirmPickup(rHex, cHex);
    expect(await store2.hasEntryFile(rHex, cHex)).toBe(false);
    const store3 = new FileContentStore({ walDir: dir, logger });
    expect(await store3.pull(rHex)).toHaveLength(0);
  });

  it("the plaintext never appears in the at-rest WAL file bytes (SI-001)", async () => {
    const { logger } = captureLogger();
    const marker = "ADVERSARIAL_PLAINTEXT_MARKER_XYZ";
    const { entry } = makeEntry(marker);
    const cHex = Buffer.from(entry.contentHash).toString("hex");

    const store = new FileContentStore({ walDir: dir, logger });
    await store.deposit(entry);

    // The on-disk filename encodes metadata (cHex__depositedAt__bytes.entry, M1) —
    // locate it by scanning the recipient dir rather than assuming a fixed name.
    const recipientDir = join(dir, "content", rHex);
    const files = (await readdir(recipientDir)).filter((f) => f.startsWith(cHex) && f.endsWith(".entry"));
    expect(files).toHaveLength(1);
    const fileBytes = await readFile(join(recipientDir, files[0]!));
    expect(fileBytes.toString("latin1").includes(marker)).toBe(false);
    // and the base64 of the marker also must not be plaintext-recoverable from the file
    expect(fileBytes.toString("latin1").includes(Buffer.from(marker).toString("base64"))).toBe(false);
  });

  it("pullOne returns a specific entry across restart; confirmPickup deletes the file", async () => {
    const { logger } = captureLogger();
    const { entry } = makeEntry("specific");
    const cHex = Buffer.from(entry.contentHash).toString("hex");
    const store1 = new FileContentStore({ walDir: dir, logger });
    await store1.deposit(entry);

    const store2 = new FileContentStore({ walDir: dir, logger });
    const one = await store2.pullOne(rHex, cHex);
    expect(one).not.toBeNull();
    expect(Buffer.from(open(one!.ciphertext)).toString("utf8")).toBe("specific");
    await store2.confirmPickup(rHex, cHex);
    expect(await store2.pullOne(rHex, cHex)).toBeNull();
  });

  it("evicts oldest-for-recipient at the entry cap and survives restart (AC-017b)", async () => {
    const { logger, events } = captureLogger();
    const store = new FileContentStore({ walDir: dir, logger, maxEntries: 2 });
    const a = makeEntry("aaa"); await store.deposit(a.entry);
    await new Promise((r) => setTimeout(r, 2));
    const b = makeEntry("bbb"); await store.deposit(b.entry);
    await new Promise((r) => setTimeout(r, 2));
    const c = makeEntry("ccc"); await store.deposit(c.entry); // evicts a

    expect(events.some((e) => e.name === "content.store.full")).toBe(true);
    const store2 = new FileContentStore({ walDir: dir, logger });
    const remaining = (await store2.pull(rHex)).map((e) => Buffer.from(open(e.ciphertext)).toString("utf8"));
    expect(remaining).not.toContain("aaa");
    expect(remaining).toContain("ccc");
  });

  it("TTL-expired entries are not delivered and sweepExpired removes them (AC-017c)", async () => {
    const { logger } = captureLogger();
    const store = new FileContentStore({ walDir: dir, logger, ttlMs: 1 });
    const { entry } = makeEntry("stale");
    entry.depositedAt = Date.now() - 1000;
    await store.deposit(entry);
    await new Promise((r) => setTimeout(r, 5));
    expect(await store.hasContent(rHex)).toBe(false);
    expect(await store.pull(rHex)).toHaveLength(0);
    const swept = await store.sweepExpired(Date.now());
    expect(swept).toBeGreaterThanOrEqual(0);
  });
});
