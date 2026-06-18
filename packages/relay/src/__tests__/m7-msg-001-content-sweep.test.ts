/**
 * CELLO-M7-MSG-001 (AC-017c): relay content-store TTL sweep scheduler.
 *
 * AC-017(c) requires that TTL-expired parked entries are reclaimed both on next
 * access AND by a periodic sweep — "a deposit arrives at the byte/count cap, or the
 * TTL sweep runs". The on-access path (hasContent/pull/pullOne/sweepExpired) already
 * exists; this suite covers the missing piece flagged in code review round 2: the
 * relay node must SCHEDULE the sweep so a recipient that parks content and never
 * reconnects has its expired entries proactively reclaimed (disk is not bounded only
 * by cap eviction). Mirrors the CELLO-M6B-009 idle-session sweep scheduler precedent.
 */

import { describe, it, expect, vi } from "vitest";
import { CelloRelayNode } from "../relay-node.js";
import { createNode } from "@cello-protocol/transport";
import { InMemoryKeyProvider } from "@cello-protocol/crypto";
import { InMemoryContentStore } from "@cello-protocol/interfaces/stubs";
import { CONTENT_STORE_TTL_MS } from "@cello-protocol/interfaces";
import type { Logger } from "@cello-protocol/interfaces";

function makeLogger(): { logger: Logger; debug: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> } {
  const debug = vi.fn();
  const error = vi.fn();
  const logger: Logger = { debug, info: vi.fn(), warn: vi.fn(), error };
  return { logger, debug, error };
}

async function makeRelay(logger: Logger, store: InMemoryContentStore): Promise<{ relay: CelloRelayNode; stop: () => Promise<void> }> {
  const keyProvider = new InMemoryKeyProvider(Buffer.alloc(32, 0xce));
  const node = await createNode({ keyProvider, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
  await node.start();
  const relay = new CelloRelayNode({
    node,
    directoryPubkey: Buffer.alloc(32, 0xdd),
    contentStore: store,
    logger,
  });
  await relay.start();
  return {
    relay,
    stop: async () => {
      relay.stopContentSweep();
      await node.stop();
    },
  };
}

describe("CELLO-M7-MSG-001 AC-017c: content-store TTL sweep scheduler", () => {
  it("startContentSweep() immediately sweeps an expired parked entry and emits content.store.sweep.complete", async () => {
    const { logger, debug } = makeLogger();
    const store = new InMemoryContentStore({ logger });
    const recipient = Buffer.alloc(32, 0x11);
    const recipientHex = Buffer.from(recipient).toString("hex");

    // Deposit an entry whose depositedAt is already older than the TTL — an entry the
    // on-access path would only reclaim if the (never-reconnecting) recipient were read.
    await store.deposit({
      recipientPubkey: recipient,
      contentHash: Buffer.alloc(32, 0x22),
      sessionId: Buffer.alloc(32, 0x33),
      ciphertext: Buffer.from("expired-ciphertext"),
      depositedAt: Date.now() - CONTENT_STORE_TTL_MS - 1_000,
    });

    const { relay, stop } = await makeRelay(logger, store);

    // Long interval so only the immediate sweep runs during the test.
    relay.startContentSweep(3_600_000);

    // The immediate sweep is async (sweepExpired resolves a Promise); wait for it.
    await vi.waitFor(() => {
      expect(debug).toHaveBeenCalledWith("content.store.sweep.complete", { deletedCount: 1 });
    });

    // The expired entry is gone without any recipient access.
    expect(await store.hasContent(recipientHex)).toBe(false);

    await stop();
  });

  it("startContentSweep() is a no-op when no content store is configured", async () => {
    const { logger, debug } = makeLogger();
    const keyProvider = new InMemoryKeyProvider(Buffer.alloc(32, 0xcf));
    const node = await createNode({ keyProvider, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await node.start();
    const relay = new CelloRelayNode({ node, directoryPubkey: Buffer.alloc(32, 0xdd), logger });
    await relay.start();

    relay.startContentSweep(3_600_000);
    // No store → no sweep event, no crash.
    await new Promise<void>((r) => setTimeout(r, 10));
    expect(debug).not.toHaveBeenCalledWith("content.store.sweep.complete", expect.anything());

    relay.stopContentSweep();
    await node.stop();
  });
});
