/**
 * CELLO-M7-MSG-001 — InMemoryContentStore stub (AC-017 caps + TTL, SI-001 ciphertext).
 *
 * Resource caps + graceful degradation: byte cap, entry-count cap, TTL sweep,
 * delete-on-pickup. Each cap evicts the oldest entry for the affected recipient,
 * never crashes, never blocks live delivery.
 */

import { describe, it, expect } from "vitest";
import type { Logger, LogContext } from "../logger.js";
import { InMemoryContentStore } from "../stubs/in-memory-content-store.js";
import type { ContentStoreEntry } from "../content-store.js";

function captureLogger(): { logger: Logger; events: Array<{ name: string; ctx?: LogContext }> } {
  const events: Array<{ name: string; ctx?: LogContext }> = [];
  const logger: Logger = {
    debug: (name, ctx) => events.push({ name, ctx }),
    info: (name, ctx) => events.push({ name, ctx }),
    warn: (name, ctx) => events.push({ name, ctx }),
    error: (name, ctx) => events.push({ name, ctx }),
  };
  return { logger, events };
}

function entry(recipientByte: number, hashByte: number, bytes = 8, depositedAt = Date.now()): ContentStoreEntry {
  return {
    recipientPubkey: new Uint8Array(32).fill(recipientByte),
    contentHash: new Uint8Array(32).fill(hashByte),
    sessionId: new Uint8Array([1, 2, 3]),
    ciphertext: new Uint8Array(bytes).fill(0xee),
    depositedAt,
  };
}

const rHex = (b: number) => Buffer.from(new Uint8Array(32).fill(b)).toString("hex");
const cHex = (b: number) => Buffer.from(new Uint8Array(32).fill(b)).toString("hex");

describe("InMemoryContentStore (MSG-001)", () => {
  it("deposit → pull → confirmPickup removes the entry (delete-on-pickup)", async () => {
    const { logger } = captureLogger();
    const store = new InMemoryContentStore({ logger });
    await store.deposit(entry(1, 10));

    expect(await store.hasContent(rHex(1))).toBe(true);
    const pulled = await store.pull(rHex(1));
    expect(pulled).toHaveLength(1);
    // pull does NOT delete (so a failed cross-check can retry)
    expect(await store.hasContent(rHex(1))).toBe(true);

    await store.confirmPickup(rHex(1), cHex(10));
    expect(await store.hasContent(rHex(1))).toBe(false);
    expect(await store.pull(rHex(1))).toHaveLength(0);
  });

  it("pullOne returns a specific entry; confirmPickup is idempotent", async () => {
    const { logger } = captureLogger();
    const store = new InMemoryContentStore({ logger });
    await store.deposit(entry(2, 20));
    const one = await store.pullOne(rHex(2), cHex(20));
    expect(one).not.toBeNull();
    expect(one!.recipientPubkey).toEqual(new Uint8Array(32).fill(2));
    await store.confirmPickup(rHex(2), cHex(20));
    await store.confirmPickup(rHex(2), cHex(20)); // no throw
    expect(await store.pullOne(rHex(2), cHex(20))).toBeNull();
  });

  it("evicts the oldest entry for the affected recipient at the entry-count cap (AC-017b)", async () => {
    const { logger, events } = captureLogger();
    const store = new InMemoryContentStore({ logger, maxEntries: 2 });
    await store.deposit(entry(3, 30));
    await store.deposit(entry(3, 31));
    await store.deposit(entry(3, 32)); // exceeds cap → evict oldest (hash 30)

    const remaining = (await store.pull(rHex(3))).map((e) => Buffer.from(e.contentHash).toString("hex"));
    expect(remaining).not.toContain(cHex(30));
    expect(remaining).toContain(cHex(31));
    expect(remaining).toContain(cHex(32));

    const full = events.find((e) => e.name === "content.store.full");
    expect(full).toBeDefined();
    expect(full!.ctx).toMatchObject({ recipientPubkey: rHex(3), evictedCount: 1 });
  });

  it("evicts at the byte cap and the new deposit still succeeds (AC-017a)", async () => {
    const { logger, events } = captureLogger();
    const store = new InMemoryContentStore({ logger, maxBytes: 20 });
    await store.deposit(entry(4, 40, 8));
    await store.deposit(entry(4, 41, 8)); // 16 bytes total
    await store.deposit(entry(4, 42, 8)); // would be 24 > 20 → evict oldest

    const remaining = await store.pull(rHex(4));
    expect(remaining.length).toBeGreaterThanOrEqual(1);
    expect(events.some((e) => e.name === "content.store.full")).toBe(true);
    // newest deposit survived
    expect(remaining.map((e) => Buffer.from(e.contentHash).toString("hex"))).toContain(cHex(42));
  });

  it("TTL-expired entries are never delivered and are swept (AC-017c)", async () => {
    const { logger } = captureLogger();
    const store = new InMemoryContentStore({ logger, ttlMs: 1000 });
    const old = entry(5, 50, 8, Date.now() - 5000); // already expired
    await store.deposit(old);

    expect(await store.hasContent(rHex(5))).toBe(false);
    expect(await store.pull(rHex(5))).toHaveLength(0);
    expect(await store.pullOne(rHex(5), cHex(50))).toBeNull();

    const fresh = entry(6, 60, 8, Date.now());
    await store.deposit(fresh);
    const sweptDeleted = await store.sweepExpired(Date.now());
    expect(sweptDeleted).toBe(0); // fresh entry not expired
    expect(await store.hasContent(rHex(6))).toBe(true);
  });

  it("re-deposit of the same (recipient, hash) is first-writer-wins (benign no-op, original kept)", async () => {
    // F5 (review round 1): deposit is first-writer-wins, NOT last-writer-wins. A
    // re-deposit for a key that already holds a non-expired entry is a benign no-op so
    // an observer who sees the (recipient, content_hash) at the relay hash layer cannot
    // evict a legitimate parked blob by re-depositing junk under the same key. A
    // legitimate re-park parks the SAME content, so keeping the original is harmless.
    const { logger } = captureLogger();
    const store = new InMemoryContentStore({ logger });
    await store.deposit(entry(7, 70, 8));
    await store.deposit(entry(7, 70, 16));
    const pulled = await store.pull(rHex(7));
    expect(pulled).toHaveLength(1);
    expect(pulled[0].ciphertext.length).toBe(8); // first writer kept, second is a no-op
  });
});
