/**
 * CELLO INFRA-001 AC-006 — Cross-machine relay dial test
 *
 * Manual test: run on each machine independently with CELLO_RELAY_MULTIADDR set.
 * Verifies that the machine can dial the test relay EC2 instance and receive
 * a valid PeerId (confirming Noise handshake and identify completed).
 *
 * Scope: this test covers "both machines can dial the relay" (INFRA-001 AC-006).
 * Full circuit-relay-v2 traversal between two machines is covered by E2E-001.
 *
 * Usage:
 *   CELLO_RELAY_MULTIADDR=/ip4/<ip>/tcp/<port>/p2p/<peerID> \
 *     pnpm run test:cross-machine
 *
 * The relay multiaddr is stored in SSM Parameter Store at:
 *   /cello/test-relay-multiaddr (eu-west-1)
 */

import { describe, it, expect } from "vitest";
import { generateKeypair } from "@cello-protocol/crypto";
import { createNode } from "@cello-protocol/transport";

const relayMultiaddr = process.env["CELLO_RELAY_MULTIADDR"];

describe.skipIf(!relayMultiaddr)(
  "AC-006: cross-machine relay dial (requires CELLO_RELAY_MULTIADDR)",
  () => {
    it("AC-006: node dials test relay EC2 and receives a valid peerId", async () => {
      const kp = generateKeypair();
      const node = await createNode({
        keyProvider: kp,
        listenAddresses: ["/ip4/0.0.0.0/tcp/0"],
      });
      await node.start();
      try {
        const { peerId } = await node.dial(relayMultiaddr!);
        expect(typeof peerId).toBe("string");
        expect(peerId.length).toBeGreaterThan(0);
      } finally {
        await node.stop();
      }
    }, 30_000);
  }
);
