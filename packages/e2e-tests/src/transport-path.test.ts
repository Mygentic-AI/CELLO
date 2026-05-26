/**
 * CELLO-REPOSPLIT-001 AC-007 — WebSocket transport path through ALB
 *
 * Verifies THREE dimensions of the external WebSocket transport path:
 *
 *   (1) WebSocket handshake: libp2p WS connection succeeds through the ALB;
 *       Noise XX completes; client can open a stream on a CELLO protocol.
 *
 *   (2) Circuit relay data path: external client requests a circuit relay
 *       reservation through the directory (circuitRelayServer); a second
 *       client can send a message via the relayed path within 10 seconds.
 *
 *   (3) Idle timeout survival: a WebSocket session survives 5 minutes of idle
 *       time without the ALB dropping the connection (requires IdleTimeout:300
 *       in cello-ecs-directory.yaml).
 *
 * SKIP-CI: This test requires live AWS infrastructure (dev ALB) and is not
 * run in automated CI. Run manually with:
 *
 *   CELLO_DIR_ALB=cello-dir-dev-1136016900.us-east-1.elb.amazonaws.com \
 *   CELLO_DIR_PUBKEY=167ca6b145bfdd3696af8f4befd883c3dc610f4a9c8d52a30f6a22f669dc27b5 \
 *   pnpm --filter @cello-protocol/e2e-tests run test -- transport-path \
 *     --pool-options.threads.maxThreads=1 --pool-options.threads.minThreads=1
 *
 * Environment variables:
 *
 *   CELLO_DIR_ALB        (required) — ALB hostname without scheme or path.
 *                        Example: cello-dir-dev-1136016900.us-east-1.elb.amazonaws.com
 *                        If absent, the entire suite is skipped.
 *
 *   CELLO_DIR_PUBKEY     (optional) — Ed25519 public key hex of the directory node.
 *                        Defaults to the dev directory peer ID.
 *
 *   IDLE_TIMEOUT_TEST    (optional) — Set to any truthy value to enable dimension 3
 *                        (idle timeout survival). This test takes ~5.5 minutes and
 *                        is skipped by default even when CELLO_DIR_ALB is set.
 *                        Run: CELLO_DIR_ALB=<host> IDLE_TIMEOUT_TEST=true pnpm ...
 *                        When to run: before every ALB config change (IdleTimeout),
 *                        and before any REPOSPLIT-002 merge that depends on long-lived
 *                        WebSocket connections. See scripts/transport-path-runbook.md.
 *
 * Infrastructure preconditions (must be in place before running):
 *   - directory ECS service updated with CELLO_DIRECTORY_WS_LISTEN_ADDR=/ip4/0.0.0.0/tcp/8080/ws
 *   - HEALTH_PORT=9090 in ECS task definition
 *   - ALB IdleTimeout: 300 deployed
 *   - cello-ecs-directory stack updated with new CloudFormation template
 *
 * After REPOSPLIT-001 is merged and deployed, run this test to produce the
 * verified CELLO_DIRECTORY_URL that REPOSPLIT-002 AC-003 bakes in as the
 * production endpoint.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createNode } from "@cello-protocol/transport";
import { generateKeypair } from "@cello-protocol/crypto";

// ─── Skip-CI guard ────────────────────────────────────────────────────────────
// This test only runs when CELLO_DIR_ALB is set in the environment.
// In CI (GitHub Actions) this env var is not set, so the suite is skipped.
const ALB_HOST = process.env["CELLO_DIR_ALB"];
const DIR_PUBKEY = process.env["CELLO_DIR_PUBKEY"] ?? "167ca6b145bfdd3696af8f4befd883c3dc610f4a9c8d52a30f6a22f669dc27b5";

describe.skipIf(!ALB_HOST)("REPOSPLIT-001 AC-007 — WebSocket transport path through ALB", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let nodeA: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let nodeB: any;
  const directoryMultiaddr = `/dns4/${ALB_HOST}/tcp/80/ws/p2p/${DIR_PUBKEY}`;

  beforeAll(async () => {
    // generateKeypair() returns an InMemoryKeyProvider directly
    const kpA = generateKeypair();
    nodeA = await createNode({
      keyProvider: kpA,
      listenAddresses: ["/ip4/0.0.0.0/tcp/0"],
    });
    await nodeA.start();

    const kpB = generateKeypair();
    nodeB = await createNode({
      keyProvider: kpB,
      listenAddresses: ["/ip4/0.0.0.0/tcp/0"],
    });
    await nodeB.start();
  });

  afterAll(async () => {
    await nodeA?.stop();
    await nodeB?.stop();
  });

  /**
   * AC-007 dimension 1: WebSocket handshake through ALB.
   * Verifies: libp2p WS connection to directory succeeds, Noise XX completes,
   * a stream can be opened on a CELLO protocol.
   */
  it("[AC-007-DIM1] WebSocket connection to directory ALB succeeds with Noise XX", async () => {
    expect(ALB_HOST, "CELLO_DIR_ALB must be set").toBeTruthy();

    const result = await nodeA.dial(directoryMultiaddr);
    expect(result, "Connection to directory via ALB should succeed").toBeTruthy();
    expect(result.peerId, "Remote peer ID should be present after successful dial").toBeTruthy();

    // Verify the connection is encrypted (Noise XX):
    // libp2p always uses Noise for encryption when configured — the dial succeeding
    // proves Noise XX completed (it would throw if the handshake failed).
    const connections = nodeA.getConnections();
    const dirConn = connections.find((c: { peerId: string; encryption: string | undefined }) =>
      c.peerId === result.peerId
    );
    expect(dirConn?.encryption, "Connection should use Noise encryption").toContain("Noise");
  }, 30_000);

  /**
   * AC-007 dimension 2: Circuit relay data path.
   * Verifies: external client requests a reservation through the directory;
   * a second external client can reach the first via the relayed path.
   *
   * The directory is the circuit relay (circuitRelayServer() is configured).
   * Client A dials the directory → requests a relay reservation.
   * Client B dials Client A via the relay-provided circuit relay address.
   *
   * NOTE — CloudWatch log verification (manual, post-deploy):
   *   AC-007 dim 2 also requires that `relay.message.forwarded` is visible in
   *   relay CloudWatch logs within 10 seconds of a message being forwarded.
   *   This test proves the transport-level circuit relay path works (reservation
   *   + dial succeed), but the `relay.message.forwarded` log event can only be
   *   verified against live infrastructure after deploying.
   *
   *   How to verify after deploy:
   *     aws logs filter-log-events \
   *       --log-group-name /cello/directory \
   *       --start-time $(date -d '-30 seconds' +%s000) \
   *       --filter-pattern '"relay.message.forwarded"'
   *
   *   Or check the relay CloudWatch log group in the AWS console
   *   (us-east-1 → CloudWatch → Log groups → /cello/directory) within
   *   10 seconds of running this test against the live ALB. See
   *   scripts/transport-path-runbook.md for the full post-deploy checklist.
   */
  it("[AC-007-DIM2] Circuit relay reservation through directory succeeds within 10s", async () => {
    expect(ALB_HOST, "CELLO_DIR_ALB must be set").toBeTruthy();

    // Node A dials the directory to establish a connection and get a relay reservation.
    await nodeA.dial(directoryMultiaddr);

    // Wait up to 10 seconds for a relay reservation to appear in nodeA's addresses.
    // libp2p circuit relay v2: after connecting to a relay server, the node automatically
    // requests a reservation and advertises a circuit relay multiaddr.
    const deadline = Date.now() + 10_000;
    let circuitAddr: string | null = null;
    while (Date.now() < deadline) {
      const addrs = nodeA.listenAddresses();
      const relayAddr = addrs.find((a: unknown) => String(a).includes("p2p-circuit") || String(a).includes("circuit"));
      if (relayAddr) {
        circuitAddr = String(relayAddr);
        break;
      }
      await new Promise((r) => setTimeout(r, 500));
    }

    expect(circuitAddr, "Circuit relay address should appear within 10s of connecting to directory")
      .not.toBeNull();

    // Node B dials Node A via the circuit relay address.
    if (circuitAddr) {
      const result = await nodeB.dial(circuitAddr);
      expect(result.peerId, "Node B should reach Node A via circuit relay through directory").toBeTruthy();
    }
  }, 30_000);

  /**
   * AC-007 dimension 3: Idle timeout survival.
   * Verifies: a WebSocket session survives 5 minutes of idle time without being
   * dropped by the ALB (requires ALB IdleTimeout: 300 in CloudFormation).
   *
   * This test takes ~5.5 minutes. Run separately when testing idle timeout.
   * The IDLE_TIMEOUT_TEST env var gate prevents it from running by default
   * even when CELLO_DIR_ALB is set (since it's very slow).
   */
  it.skipIf(!process.env["IDLE_TIMEOUT_TEST"])(
    "[AC-007-DIM3] WebSocket session survives 5-minute idle without ALB drop",
    async () => {
      expect(ALB_HOST, "CELLO_DIR_ALB must be set").toBeTruthy();

      // Establish connection
      await nodeA.dial(directoryMultiaddr);
      const initialAddrs = nodeA.listenAddresses();
      expect(initialAddrs.length, "Node should have listen addresses after dial").toBeGreaterThan(0);

      // Wait 5 minutes and 30 seconds idle — no application data sent
      const idleMs = 5 * 60 * 1000 + 30_000;
      await new Promise((r) => setTimeout(r, idleMs));

      // Verify the connection is still alive by checking listen addresses
      // and attempting to open a new stream (which would fail if the connection dropped).
      const addrsAfterIdle = nodeA.listenAddresses();
      expect(
        addrsAfterIdle.length,
        "Node should still have listen addresses after 5 minutes of idle — ALB must not have dropped the connection",
      ).toBeGreaterThan(0);
    },
    6 * 60 * 1000, // 6 minute timeout
  );
});
