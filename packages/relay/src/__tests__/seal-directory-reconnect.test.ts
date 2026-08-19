// The seal outage of 2026-08-08: a relay that had been up 3 days stopped sealing, and the reason it
// reported was a lie.
//
// CelloNode.newStream does not throw Errors. It throws STRUCTURED PLAIN OBJECTS:
//
//     throw { reason: "connection_lost", peerId, message: `No open connection to peer ${id}` };
//
// The adapter's catch read `err instanceof Error ? err.message : "directory_unavailable"`. A plain
// object is not an Error, so every one of those became the string `directory_unavailable` — a
// network-shaped name for a failure that never touched the network. The true cause, connection_lost,
// was discarded at the only place it was ever visible.
//
// Two independent defects, and the tests below pin them separately because fixing one without the
// other leaves the system broken in a way that still cannot be diagnosed:
//
//   1. ERROR SUBSTITUTION — the real reason must survive. Live, three agents spent a day on this
//      because the string said "the directory is unavailable" while all three directories were
//      healthy, on the correct schema, with matching peer IDs and an open port.
//   2. NO RECONNECT — the libp2p handle is taken once at boot by connect() and trusted forever. When
//      the connection dies, newStream finds no open connection and the seal is refused, FOREVER,
//      with no redial. That is why a restart "fixed" it and why it would have come back.
//
// The timing is what identified it and is worth recording: the failing path returned in under a
// millisecond, because getConnections() is an in-memory lookup. The last working seal took 79ms —
// a real round trip. Any future regression here shows up as a suspiciously fast failure.

import { describe, it, expect, vi } from "vitest";
import { encode as cborEncode } from "cbor-x";
import * as lp from "it-length-prefixed";
import { NetworkDirectoryAdapter } from "../network-directory-adapter.js";
import type { SealData } from "../relay-types.js";

const PEER_ID = "12D3KooWMH58hm8xpuwgwaNSvnvXBuc126jfuUMVbrGNcU2MeEAX";
const MULTIADDR = `/ip4/34.75.172.108/tcp/8080/ws/p2p/${PEER_ID}`;

/** Exactly what CelloNode throws — a plain object, deliberately NOT an Error. */
function connectionLost() {
  return { reason: "connection_lost", peerId: PEER_ID, message: `No open connection to peer ${PEER_ID}` };
}

function encodeFrame(obj: unknown): Uint8Array {
  const encoded = lp.encode.single(cborEncode(obj) as Uint8Array);
  return encoded.subarray();
}

/** Minimal stand-in for the directory's side of a seal_submission exchange. */
function fakeStream(response: unknown) {
  const bytes = encodeFrame(response);
  return {
    send: vi.fn(),
    close: vi.fn(async () => {}),
    async *[Symbol.asyncIterator]() {
      yield bytes;
    },
  };
}

const SEAL: SealData = {
  leaves: [],
  merkle_root: new Uint8Array(32),
  seq_count: 3,
};

const sessionId = new Uint8Array(32).fill(7);

/**
 * The parts of `CelloNode` every double here needs but none of them declared.
 *
 * `onPeerConnect`/`onPeerDisconnect` are on the interface and a real node always has them — the
 * adapter subscribes to both on `connect()` to log a directory link dying at the moment it dies
 * (DOD-M12-CONN-OBSERVE-1), and a double without them was never a stand-in for the thing it doubles.
 * `hangUp` is the eviction that makes the redial able to repair anything (DOD-M12-CONN-EVICT-1);
 * a double without it exercises the pre-fix path while claiming to test the fixed one.
 */
function nodeBase() {
  return {
    onPeerConnect: vi.fn(),
    onPeerDisconnect: vi.fn(),
    hangUp: vi.fn(async () => {}),
    getConnections: vi.fn(() => []),
  };
}

describe("seal submission when the directory connection has died mid-life", () => {
  it("surfaces the REAL reason instead of substituting directory_unavailable", async () => {
    // The node is alive and dialable; only the existing connection is gone.
    const node = {
      ...nodeBase(),
      dial: vi.fn(async () => ({ peerId: PEER_ID })),
      newStream: vi.fn(async () => {
        throw connectionLost();
      }),
    };

    const adapter = new NetworkDirectoryAdapter({
      directoryPeerId: PEER_ID,
      directoryMultiaddrs: [MULTIADDR],
    });
    adapter.connect(node as never);

    const result = await adapter.processSeal(sessionId, SEAL);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    // The whole point: the operator must be able to tell a dead connection from an absent directory.
    expect(result.reason).toContain("connection_lost");
    expect(result.reason).not.toBe("directory_unavailable");
  });

  it("redials and retries when the connection is stale, rather than refusing the seal", async () => {
    // Reproduces the live shape precisely: the FIRST newStream finds no open connection (the handle
    // is 3 days old), a redial repairs it, and the second attempt succeeds. Before the fix the first
    // throw was terminal and the seal was rejected outright.
    let attempts = 0;
    const node = {
      ...nodeBase(),
      dial: vi.fn(async () => ({ peerId: PEER_ID })),
      newStream: vi.fn(async () => {
        attempts += 1;
        if (attempts === 1) throw connectionLost();
        return fakeStream({ type: "seal_received" });
      }),
    };

    const adapter = new NetworkDirectoryAdapter({
      directoryPeerId: PEER_ID,
      directoryMultiaddrs: [MULTIADDR],
    });
    adapter.connect(node as never);

    const result = await adapter.processSeal(sessionId, SEAL);

    expect(result.ok).toBe(true);
    expect(attempts).toBe(2);
    // The redial is the repair — without a second dial the retry would hit the same dead connection.
    expect(node.dial.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("does not swallow dial failures silently", async () => {
    // The dial loop was `try { await dial(addr); break; } catch { /* try next */ }` — an empty catch.
    // When every address failed there was no log line anywhere, which is why the two and a half hours
    // between the last good seal and the first failure contained no evidence at all.
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const node = {
      ...nodeBase(),
      dial: vi.fn(async () => {
        throw { reason: "dial_failed", message: "connection refused" };
      }),
      newStream: vi.fn(async () => {
        throw connectionLost();
      }),
    };

    const adapter = new NetworkDirectoryAdapter({
      directoryPeerId: PEER_ID,
      directoryMultiaddrs: [MULTIADDR],
      logger: logger as never,
    });
    adapter.connect(node as never);

    const result = await adapter.processSeal(sessionId, SEAL);

    expect(result.ok).toBe(false);
    const logged = logger.warn.mock.calls.map((c) => String(c[0]));
    expect(logged.some((e) => e.includes("dial"))).toBe(true);
  });

  it("still reports directory_unavailable when there is genuinely no node", async () => {
    // The one case the old string was right about. Kept so the fix does not erase a real signal.
    const adapter = new NetworkDirectoryAdapter({
      directoryPeerId: PEER_ID,
      directoryMultiaddrs: [MULTIADDR],
    });

    const result = await adapter.processSeal(sessionId, SEAL);

    expect(result).toEqual({ ok: false, reason: "directory_unavailable" });
  });
});
