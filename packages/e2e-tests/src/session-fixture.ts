/**
 * SessionFixture — canonical shared test infrastructure for CELLO E2E tests.
 *
 * Replaces the per-milestone makeFixture() / makeE2EFixture() / makeFullFixture()
 * functions that were previously copy-pasted into every test file. Add opts here
 * when a new milestone needs new capabilities; never duplicate this code elsewhere.
 *
 * What this provides:
 *   - Real relay node (createRelayNode)
 *   - Real directory node (createDirectoryNode)
 *   - Two real libp2p agent nodes with Ed25519 keypairs (A and B)
 *   - Optional third agent (C) via opts.withAgentC: true (CONNREQ-003)
 *   - FROST threshold signer for agent A (bootstrapped, 2-of-3 in-process stubs)
 *   - Optional FROST signer for agent B (for scenarios where B also initiates)
 *   - Optional MCP server + client pair wired per agent (for MCP tool surface tests)
 *   - Optional registration (runs real DKG ceremony via directory)
 *   - Optional connection policies (M3+)
 *   - Optional injected loggers for A and C (CONNREQ-003 observability tests)
 *   - Ordered cleanup (relay last, so directory can flush)
 *
 * Canonical location: packages/e2e-tests/src/session-fixture.ts
 *
 * Import as: import { createSessionFixture } from "../session-fixture.js";
 * (from packages/e2e-tests/src/__tests__/)
 */

import { randomBytes } from "node:crypto";
import { generateKeypair, FrostThresholdSigner } from "@cello-protocol/crypto";
import type { Logger } from "@cello-protocol/interfaces";
import {
  bootstrapKeyShares,
  clearTestShares,
} from "@cello-protocol/crypto/frost/frost-threshold-signer.js";
import { createInProcessStubs } from "@cello-protocol/crypto/frost/stubs.js";
import { createNode } from "@cello-protocol/transport";
import { createDirectoryNode } from "@cello-protocol/directory";
import { InMemoryDirectoryStore, InMemorySessionWal } from "@cello-protocol/interfaces/stubs";
import type { SessionWal } from "@cello-protocol/interfaces";
import { NetworkRelayAdapter } from "@cello-protocol/directory/network-relay-adapter.js";
import type { CelloDirectoryNode } from "@cello-protocol/directory";
import { createRelayNode } from "@cello-protocol/relay";
import type { CelloRelayNode, DirectoryAdapter } from "@cello-protocol/relay";
import { createClient } from "@cello-protocol/client";
import type { SignalRequirementPolicy } from "@cello-protocol/client";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AgentFixture {
  kp: ReturnType<typeof generateKeypair>;
  pubkey: Uint8Array;
  pubkeyHex: string;
  /** Raw libp2p node — for tests that need to stop/restart the agent's transport */
  node: Awaited<ReturnType<typeof import("@cello-protocol/transport").createNode>>;
  client: ReturnType<typeof createClient>;
  /** Set after register() is called (opts.register: true) */
  primaryPubkey?: string;
}

export interface SessionFixtureResult {
  dirStore: InMemoryDirectoryStore;
  /** Raw directory node — for tests that need registerPeerInfo, registerThresholdSigner, etc. */
  directory: CelloDirectoryNode;
  dirPeerId: string;
  dirMultiaddrs: string[];
  /** Raw relay node — for tests that need recordAssignment directly */
  relay: CelloRelayNode;
  relayPeerId: string;
  relayMultiaddrs: string[];
  agentA: AgentFixture;
  agentB: AgentFixture;
  /**
   * Third agent — only present when opts.withAgentC: true (CONNREQ-003 fan-out tests).
   * Uses the same directory and relay as A and B. Registered if opts.register: true.
   */
  agentC?: AgentFixture;
  /** FROST signer for A (always present) */
  signerA: FrostThresholdSigner;
  /** FROST signer for B (only when opts.bootstrapB: true) */
  signerB?: FrostThresholdSigner;
  /** Set when opts.withWal: true — the relay's in-memory WAL for gap-fill tests */
  sessionWal?: SessionWal;
  stopAll: () => Promise<void>;
}

export interface SessionFixtureOpts {
  /** Register both agents with the directory (runs real DKG). Default: false */
  register?: boolean;
  /** Also bootstrap FROST for agent B. Default: false */
  bootstrapB?: boolean;
  /** Connection policy for agent A. Default: open / deterministic */
  policyA?: SignalRequirementPolicy;
  /** Connection policy for agent B. Default: open / deterministic */
  policyB?: SignalRequirementPolicy;
  /** Round-2 disclosure timeout for B (ms). Default: directory default */
  round2TimeoutMs?: number;
  /** Require connection gate on the directory (SESSION-006). Default: false */
  requireConnectionGate?: boolean;
  /** Require registration on the directory (M3+). Default: false */
  requireRegistration?: boolean;
  /** Enable connection request counting on B (testing only). Default: false */
  trackEvaluateCount?: boolean;
  /** Whitelist of pubkeys B accepts without policy evaluation. Default: [] */
  whitelist?: string[];
  /** Connection timeout for both clients (ms). Default: 15_000 */
  connectionTimeoutMs?: number;
  /**
   * Wire directory and relay via NetworkRelayAdapter (/cello/directory-relay/1.0.0)
   * instead of in-process. Used by NODE-004 to verify the wire protocol between
   * directory and relay. Default: false (in-process wiring).
   */
  networkRelay?: boolean;
  /**
   * Wire an InMemorySessionWal to the relay so gap-fill requests are served.
   * Required for gap-fill reconciliation tests (PERSIST-014). Default: false.
   */
  withWal?: boolean;
  /**
   * deliveryGraceSeconds for the directory node (unilateral seal timeout).
   * Default: directory node default (600s).
   */
  deliveryGraceSeconds?: number;
  /**
   * Provision a third registered agent (Agent C) alongside A and B.
   * Used by CONNREQ-003 fan-out tests. Default: false.
   * When true, agentC is populated in the returned SessionFixtureResult.
   */
  withAgentC?: boolean;
  /** Connection policy for agent C (only used when withAgentC: true). Default: open / deterministic */
  policyC?: SignalRequirementPolicy;
  /**
   * Injected logger for agent A's client (CONNREQ-003 observability tests).
   * Default: no-op.
   */
  loggerA?: Logger;
  /**
   * Injected logger for agent C's client (CONNREQ-003 observability tests).
   * Default: no-op. Only meaningful when withAgentC: true.
   */
  loggerC?: Logger;
  /**
   * Injected logger for the directory node (CONNREQ-003 transport-path evidence tests).
   * Default: no-op.
   */
  loggerDir?: Logger;
  /**
   * Use per-session ephemeral libp2p nodes for all session establishment (M7-DAEMON-002).
   * When true, the fixture creates a daemon (via opts.daemon: true from DAEMON-001) that
   * uses per-session nodes; session Peer IDs returned will differ from the
   * directory-facing node Peer ID. Default: false (pre-M7 behavior unchanged).
   */
  ephemeralSessionNodes?: boolean;
  /**
   * Pre-create a standing receiver node at daemon startup (M7-DAEMON-002).
   * When true, the fixture waits for standing_receiver_ready: true in cello status
   * before returning to the test. Requires a running daemon. Default: false.
   */
  standingReceiver?: boolean;
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export async function createSessionFixture(
  opts: SessionFixtureOpts = {},
): Promise<SessionFixtureResult> {
  const dirStore = new InMemoryDirectoryStore();
  const connectionTimeoutMs = opts.connectionTimeoutMs ?? 15_000;

  // ── Relay ──────────────────────────────────────────────────────────────────
  const dirKeyProvider = generateKeypair();
  const dirPubkey = new Uint8Array(await dirKeyProvider.getPublicKey());

  // When networkRelay is true, directory calls relay via /cello/directory-relay/1.0.0
  // wire protocol. The relay needs a DirectoryAdapter shim that forwards processSeal.
  //
  // When networkRelay is false (default), the relay still needs a DirectoryAdapter shim
  // so that bilateral SEAL ctrl leaves trigger processSeal on the directory. The shim
  // is a late-binding closure that captures dirResult after the directory is created.
  let dirNodeRefForNetworkRelay: Awaited<ReturnType<typeof createDirectoryNode>> | null = null;
  let dirResultRef: Awaited<ReturnType<typeof createDirectoryNode>> | null = null;
  const directoryAdapterShim: DirectoryAdapter = opts.networkRelay
    ? {
        async processSeal(sessionId, sealData) {
          if (!dirNodeRefForNetworkRelay) return { ok: false, reason: "directory_not_ready" };
          return dirNodeRefForNetworkRelay.directory.processSeal(sessionId, sealData);
        },
      }
    : {
        async processSeal(sessionId, sealData) {
          if (!dirResultRef) return { ok: false, reason: "directory_not_ready" };
          return dirResultRef.directory.processSeal(sessionId, sealData);
        },
      };

  const noopLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
  const sessionWal = opts.withWal ? new InMemorySessionWal({ logger: noopLogger }) : undefined;

  const { relay: relayInstance, node: relayNode, stop: relayStop } = await createRelayNode({
    directoryPubkey: dirPubkey,
    directory: directoryAdapterShim,
    sessionWal,
  });
  const relayPeerId = relayNode.getPeerId();
  const relayMultiaddrs = relayNode.listenAddresses();
  const relayAddr = relayMultiaddrs[0]!;

  // ── Directory ──────────────────────────────────────────────────────────────
  let relayForDirectory: import("@cello-protocol/relay").CelloRelayNode | NetworkRelayAdapter;
  let stopNetworkAdapter: (() => Promise<void>) | undefined;

  if (opts.networkRelay) {
    const networkAdapter = new NetworkRelayAdapter({
      keyProvider: dirKeyProvider,
      relayPeerId,
      relayMultiaddrs,
    });
    relayForDirectory = networkAdapter;
    // connect() is called after dirNode starts (below)
    stopNetworkAdapter = async () => { /* NetworkRelayAdapter has no stop; node stops handle cleanup */ };
  } else {
    relayForDirectory = relayInstance;
  }

  const dirResult = await createDirectoryNode({
    keyProvider: dirKeyProvider,
    relay: relayForDirectory as Parameters<typeof createDirectoryNode>[0]["relay"],
    relayEndpoint: { peer_id: relayPeerId, multiaddrs: [relayAddr] },
    requireRegistration: opts.requireRegistration ?? false,
    requireConnectionGate: opts.requireConnectionGate ?? false,
    store: dirStore,
    deliveryGraceSeconds: opts.deliveryGraceSeconds,
    logger: opts.loggerDir,
  });

  if (opts.networkRelay) {
    dirNodeRefForNetworkRelay = dirResult;
    await (relayForDirectory as NetworkRelayAdapter).connect(dirResult.node);
  } else {
    // Wire the late-binding shim so the relay can call processSeal on the directory.
    dirResultRef = dirResult;
  }

  const { directory: directoryNode, node: dirNode, stop: stopDir } = dirResult;

  const dirPeerId = dirNode.getPeerId();
  const dirMultiaddrs = dirNode.listenAddresses();
  const directoryEndpoint = { peer_id: dirPeerId, multiaddrs: dirMultiaddrs };

  // ── Agent A ────────────────────────────────────────────────────────────────
  const kpA = generateKeypair();
  const pubkeyA = new Uint8Array(await kpA.getPublicKey());
  const pubkeyAHex = Buffer.from(pubkeyA).toString("hex");

  const nodeA = await createNode({ keyProvider: kpA, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
  await nodeA.start();

  const stubsA = createInProcessStubs(3);
  const bootstrapResultA = await bootstrapKeyShares(pubkeyA, { threshold: 2, participants: 3, directoryNodeStubs: stubsA });
  const signerA = new FrostThresholdSigner({ threshold: 2, participants: 3, directoryNodeStubs: stubsA }, pubkeyA);

  const clientA = createClient(nodeA, kpA, {
    directoryEndpoint,
    connectionPolicy: opts.policyA,
    connectionTimeoutMs,
    thresholdSigner: signerA,
    logger: opts.loggerA,
  });

  // ── Agent B ────────────────────────────────────────────────────────────────
  const kpB = generateKeypair();
  const pubkeyB = new Uint8Array(await kpB.getPublicKey());
  const pubkeyBHex = Buffer.from(pubkeyB).toString("hex");

  const nodeB = await createNode({ keyProvider: kpB, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
  await nodeB.start();

  let signerB: FrostThresholdSigner | undefined;
  if (opts.bootstrapB) {
    const stubsB = createInProcessStubs(3);
    await bootstrapKeyShares(pubkeyB, { threshold: 2, participants: 3, directoryNodeStubs: stubsB });
    signerB = new FrostThresholdSigner({ threshold: 2, participants: 3, directoryNodeStubs: stubsB }, pubkeyB);
  }

  const clientB = createClient(nodeB, kpB, {
    directoryEndpoint,
    connectionPolicy: opts.policyB,
    connectionTimeoutMs,
    thresholdSigner: signerB,
    round2TimeoutMs: opts.round2TimeoutMs,
    trackEvaluateCount: opts.trackEvaluateCount,
    whitelist: opts.whitelist,
  });

  await clientA.registerHandler();
  await clientB.registerHandler();

  // Register A's primary pubkey so the directory can verify FROST-signed seals.
  // Needed whenever the session seal path is exercised (e.g. NODE-004).
  clientA.setPrimaryPubkey(bootstrapResultA.primaryPubkey);
  directoryNode.registerPrimaryPubkey(pubkeyAHex, bootstrapResultA.primaryPubkey);

  // ── Agent C (optional, CONNREQ-003 fan-out tests) ──────────────────────────
  let agentCFixture: AgentFixture | undefined;
  let nodeC: Awaited<ReturnType<typeof createNode>> | undefined;
  if (opts.withAgentC) {
    const kpC = generateKeypair();
    const pubkeyC = new Uint8Array(await kpC.getPublicKey());
    const pubkeyCHex = Buffer.from(pubkeyC).toString("hex");

    const nodeCInstance = await createNode({ keyProvider: kpC, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await nodeCInstance.start();
    nodeC = nodeCInstance;

    const clientC = createClient(nodeCInstance, kpC, {
      directoryEndpoint,
      connectionPolicy: opts.policyC,
      connectionTimeoutMs,
      logger: opts.loggerC,
    });
    await clientC.registerHandler();

    agentCFixture = {
      kp: kpC, pubkey: pubkeyC, pubkeyHex: pubkeyCHex,
      node: nodeCInstance,
      client: clientC,
    };
  }

  // ── (removed) Optional MCP wiring — DOD-LEGACY-MCP-1, 2026-07-12 ──────────
  // This block used to build a `createMcpSessionServer` per agent and expose `mcp`/`notifications`
  // on each AgentFixture. That server was the legacy M1 in-process MCP server; it is DELETED. It was
  // never the shipped path — Claude Code talks to `bin/cello-mcp.ts`, a stdio→IPC proxy in front of
  // the daemon — so every e2e test that drove a tool through it was reaching the LIVE CelloClient
  // through a dead translator. Those tests now call the client directly (12 of the 15 were real
  // protocol coverage and were re-pointed, not deleted).
  //
  // Removing it is behaviourally identical to `withMcp: false` for every other consumer: the block
  // was a pure leaf. Its one outside effect was registering `client.onSessionAssignment(...)` — a
  // single-slot OBSERVER that fires after the session record is fully installed, never a gate. The
  // slot is now free for tests that want it.

  // ── Optional registration ──────────────────────────────────────────────────
  let primaryPubkeyA: string | undefined;
  if (opts.register) {
    // OPS-AGENT-001: pass preAuthToken so tests remain compatible when tokenValidator is wired.
    // DevTokenValidator accepts any 'DEV-' prefixed token in CELLO_ENV=local.
    const regA = await clientA.register(`+${Buffer.from(randomBytes(5)).toString("hex")}`, "DEV-test-token");
    if ("error" in regA) throw new Error(`Agent A registration failed: ${(regA as { error: string }).error}`);
    primaryPubkeyA = regA.primary_pubkey;

    const regB = await clientB.register(`+${Buffer.from(randomBytes(5)).toString("hex")}`, "DEV-test-token");
    if ("error" in regB) throw new Error(`Agent B registration failed: ${(regB as { error: string }).error}`);

    if (agentCFixture) {
      const regC = await agentCFixture.client.register(`+${Buffer.from(randomBytes(5)).toString("hex")}`, "DEV-test-token");
      if ("error" in regC) throw new Error(`Agent C registration failed: ${(regC as { error: string }).error}`);
      agentCFixture = { ...agentCFixture, primaryPubkey: regC.primary_pubkey };
    }
  }

  // ── Cleanup (nodes, then infrastructure) ─────────────────────────────────
  const stopAll = async () => {
    try { await nodeA.stop(); } catch {}
    try { await nodeB.stop(); } catch {}
    if (nodeC) { try { await nodeC.stop(); } catch {} }
    try { await stopDir(); } catch {}
    if (stopNetworkAdapter) await stopNetworkAdapter();
    try { await relayStop(); } catch {}
    clearTestShares();
  };

  return {
    dirStore,
    directory: directoryNode,
    dirPeerId,
    dirMultiaddrs,
    relay: relayInstance,
    relayPeerId,
    relayMultiaddrs,
    agentA: {
      kp: kpA, pubkey: pubkeyA, pubkeyHex: pubkeyAHex,
      node: nodeA,
      client: clientA, primaryPubkey: primaryPubkeyA,
    },
    agentB: {
      kp: kpB, pubkey: pubkeyB, pubkeyHex: pubkeyBHex,
      node: nodeB,
      client: clientB,
    },
    agentC: agentCFixture,
    signerA,
    signerB,
    sessionWal,
    stopAll,
  };
}
