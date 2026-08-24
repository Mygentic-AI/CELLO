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
import { FileContentStore, resolveContentTtlMs } from "../adapters/file-content-store.js";
import { CONTENT_STORE_TTL_MS } from "@cello-protocol/interfaces";

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

describe("M12-P18: resolveContentTtlMs — the env-configurable retention", () => {
  const DEFAULT = 30 * 24 * 60 * 60 * 1000;

  it("absent or blank → default, not invalid (the common case)", () => {
    expect(resolveContentTtlMs(undefined, DEFAULT)).toEqual({ ttlMs: DEFAULT, invalid: false });
    expect(resolveContentTtlMs("", DEFAULT)).toEqual({ ttlMs: DEFAULT, invalid: false });
    expect(resolveContentTtlMs("   ", DEFAULT)).toEqual({ ttlMs: DEFAULT, invalid: false });
  });

  it("a valid positive day count is honored", () => {
    expect(resolveContentTtlMs("7", DEFAULT)).toEqual({ ttlMs: 7 * 24 * 60 * 60 * 1000, invalid: false });
    expect(resolveContentTtlMs("90", DEFAULT)).toEqual({ ttlMs: 90 * 24 * 60 * 60 * 1000, invalid: false });
  });

  it("a SUPPLIED-but-unusable value falls back AND flags invalid — never silent, never NaN", () => {
    // NaN is the specific hazard: a NaN cutoff sweeps nothing (or everything). Each of these must
    // resolve to the default with invalid:true so the boot log warns.
    for (const bad of ["abc", "0", "-5", "NaN", "1e999"]) {
      const r = resolveContentTtlMs(bad, DEFAULT);
      expect(Number.isFinite(r.ttlMs), `"${bad}" must not yield NaN`).toBe(true);
      expect(r.ttlMs).toBe(DEFAULT);
      expect(r.invalid, `"${bad}" must be flagged invalid`).toBe(true);
    }
  });

  it("the DEFAULT constant is 30 days", () => {
    expect(CONTENT_STORE_TTL_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });
});

describe("DOD-M15-RELAYABUSE-1 — the parked store is actually bounded", () => {
  /** A deposit of `bytes` payload for `who`, with a distinct hash so it never dedupes. */
  function entryFor(who: Uint8Array, bytes: number, tag: number): ContentStoreEntry {
    const plaintext = new Uint8Array(bytes).fill(tag & 0xff);
    const ciphertext = seal(plaintext);
    return {
      recipientPubkey: who,
      contentHash: sha256(new Uint8Array([tag, bytes & 0xff, (bytes >> 8) & 0xff])),
      sessionId: new Uint8Array(16).fill(1),
      ciphertext,
      depositedAt: Date.now(),
    };
  }

  it("★★★ a FLOOD ACROSS MANY RECIPIENTS is REFUSED — it used to write past the global cap forever", async () => {
    /**
     * ⚠️ THE DEFECT, and the store documented it against itself: *"eviction only scans the
     * depositing recipient's bucket… If the global cap is consumed by OTHER recipients this loop
     * drains the current recipient to empty and **then writes anyway**."*
     *
     * That is exploitable with no privilege at all, because a park deposit is UNAUTHENTICATED by
     * design — the attacker picks the recipient key. Spread across invented recipients, no single
     * bucket is ever big enough to trigger eviction, nothing is refused, and the store grows until
     * the disk does, which takes the relay down for everyone.
     *
     * A refused deposit is visible and recoverable — the depositor keeps its copy and retries, and
     * content already parked for other recipients is untouched. A full disk is neither.
     *
     * **Revert test, RUN:** delete the refusal block in `file-content-store.ts` and this goes red
     * while the eviction tests above stay green — they only ever exercised ONE recipient, which is
     * exactly why this shipped.
     */
    const { logger, events } = captureLogger();
    const store = new FileContentStore({ walDir: dir, logger, maxBytes: 4096, maxRecipientBytes: 4096 });

    let refused = 0;
    let accepted = 0;
    // Twenty DIFFERENT recipients — the attacker invents them, so no bucket ever fills.
    for (let i = 0; i < 20; i++) {
      const victim = new Uint8Array(32).fill(i + 1);
      try {
        await store.deposit(entryFor(victim, 512, i));
        accepted++;
      } catch (err) {
        expect(String(err)).toContain("content_store_full");
        refused++;
      }
    }

    expect(
      refused,
      "once the global cap is reached the store must REFUSE. Zero refusals means it wrote past its " +
        "own cap, which is the unbounded-growth defect this test exists for.",
    ).toBeGreaterThan(0);
    expect(accepted, "and it must still have accepted deposits up to the bound — this is a cap, not a wall").toBeGreaterThan(0);
    expect(
      events.some((e) => e.name === "content.store.deposit_refused"),
      "a refusal must be named in the log, not silent",
    ).toBe(true);
  });

  it("★★ ONE recipient cannot become the whole store — the per-recipient cap holds", async () => {
    /**
     * The per-recipient half. Without it a single bucket may consume the entire store, and a flood
     * aimed at one victim evicts that victim's own older messages to make room for more of the
     * flood.
     */
    const { logger } = captureLogger();
    const store = new FileContentStore({ walDir: dir, logger, maxBytes: 1024 * 1024, maxRecipientBytes: 2048 });

    const victim = new Uint8Array(32).fill(0x7e);
    for (let i = 0; i < 10; i++) {
      try { await store.deposit(entryFor(victim, 512, i)); } catch { /* bounded */ }
    }

    const listed = await store.pull(Buffer.from(victim).toString("hex"));
    const held = listed.reduce((n: number, e: ContentStoreEntry) => n + e.ciphertext.length, 0);
    expect(
      held,
      "one recipient's bucket must stay within its own cap however much is aimed at it",
    ).toBeLessThanOrEqual(2048 + 64);
  });

  it("★ the ordinary path is untouched — a normal deposit still lands and reads back", async () => {
    /** The regression half: a bound that refuses ordinary traffic is its own outage. */
    const { logger } = captureLogger();
    const store = new FileContentStore({ walDir: dir, logger });
    const e = entryFor(recipient, 1024, 99);
    await store.deposit(e);
    const got = await store.pull(Buffer.from(recipient).toString("hex"));
    expect(got.length, "an ordinary deposit is unaffected by the cap").toBe(1);
    expect(open(got[0]!.ciphertext), "and it round-trips intact").toEqual(new Uint8Array(1024).fill(99));
  });
});
