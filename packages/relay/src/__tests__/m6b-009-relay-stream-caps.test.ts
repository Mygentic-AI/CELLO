/**
 * CELLO-M6B-009: Relay stream caps
 *
 * Specification (per story YAML):
 *   AC-005: /cello/relay/1.0.0 is registered with maxInboundStreams: 2048
 *           /cello/directory-relay/1.0.0 is registered with maxInboundStreams: 128
 *           Both verified by inspecting the node.handle() call arguments.
 *
 * Interpretation:
 *   The CelloNode.handle() interface accepts an optional { maxInboundStreams } third
 *   argument. We spy on that method before relay.start() is called to capture the
 *   exact options passed for each protocol ID. The test fails if:
 *     - handle() is not called with RELAY_PROTOCOL_ID and maxInboundStreams: 2048
 *     - handle() is not called with DIRECTORY_RELAY_PROTOCOL_ID and maxInboundStreams: 128
 *     - maxInboundStreams is absent (would mean the value is inherited from yamux defaults)
 */

import { describe, it, expect, vi } from "vitest";
import { createNode } from "@cello-protocol/transport";
import { InMemoryKeyProvider } from "@cello-protocol/crypto";
import { CelloRelayNode, RELAY_PROTOCOL_ID, DIRECTORY_RELAY_PROTOCOL_ID } from "../relay-node.js";

describe("CELLO-M6B-009 AC-005: Relay protocol handlers use explicit maxInboundStreams", () => {
  it("/cello/relay/1.0.0 is registered with maxInboundStreams: 2048", async () => {
    // AC-005: /cello/relay/1.0.0 is registered with maxInboundStreams: 2048
    // Verified by spying on node.handle() before relay.start() is called.

    const keyProvider = new InMemoryKeyProvider(Buffer.alloc(32, 0xaa));
    const node = await createNode({
      keyProvider,
      listenAddresses: ["/ip4/127.0.0.1/tcp/0"],
    });
    await node.start();

    const handleSpy = vi.spyOn(node, "handle");

    const relay = new CelloRelayNode({
      node,
      directoryPubkey: Buffer.alloc(32, 0xdd),
    });
    await relay.start();

    // Find the call for the relay protocol
    const relayCalls = handleSpy.mock.calls.filter((args) => args[0] === RELAY_PROTOCOL_ID);
    expect(relayCalls).toHaveLength(1);

    const relayOpts = relayCalls[0]![2];
    expect(relayOpts).toBeDefined();
    expect(relayOpts!.maxInboundStreams).toBe(2048);

    await node.stop();
  });

  it("/cello/directory-relay/1.0.0 is registered with maxInboundStreams: 128", async () => {
    // AC-005: /cello/directory-relay/1.0.0 is registered with maxInboundStreams: 128
    // Verified by spying on node.handle() before relay.start() is called.

    const keyProvider = new InMemoryKeyProvider(Buffer.alloc(32, 0xaa));
    const node = await createNode({
      keyProvider,
      listenAddresses: ["/ip4/127.0.0.1/tcp/0"],
    });
    await node.start();

    const handleSpy = vi.spyOn(node, "handle");

    const relay = new CelloRelayNode({
      node,
      directoryPubkey: Buffer.alloc(32, 0xdd),
    });
    await relay.start();

    // Find the call for the directory-relay protocol
    const dirRelayCalls = handleSpy.mock.calls.filter((args) => args[0] === DIRECTORY_RELAY_PROTOCOL_ID);
    expect(dirRelayCalls).toHaveLength(1);

    const dirRelayOpts = dirRelayCalls[0]![2];
    expect(dirRelayOpts).toBeDefined();
    expect(dirRelayOpts!.maxInboundStreams).toBe(128);

    await node.stop();
  });
});
