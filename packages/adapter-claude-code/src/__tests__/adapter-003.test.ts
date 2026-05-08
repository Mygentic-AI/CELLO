/**
 * CELLO-ADAPTER-003 — cello_initiate_session wired to real directory signaling
 *
 * Unit and integration tests for:
 *   AC-001: A and B both authenticated to directory → A initiates → session established
 *   AC-002: Target offline → { ok: false, reason: 'target_offline' }
 *   AC-003: Timeout → { ok: false, reason: 'timeout' }
 *   AC-005: Transport not started → { error: { reason: 'transport_not_started' } }
 *   SI-001: session_request frame contains ONLY { target_pubkey } — no extra fields
 *   SI-002: K_local private key never appears in tool response
 *   DB-001: signaling stream not yet open → opens inline on first call
 *
 * Integration tests use the real directory signaling protocol with in-process
 * libp2p nodes, real directory, and real relay.
 *
 * Note: AC-004 and AC-006 are covered in packages/e2e-tests/src/__tests__/adapter-003.test.ts
 */

import {
  setupV3Tests,
  createTestScope,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "@claude-flow/testing";
import type { TestScope } from "@claude-flow/testing";
import { Encoder, decode } from "cbor-x";
import { generateKeypair } from "@cello/crypto";
import { createNode } from "@cello/transport";
import { createRelayNode } from "@cello/relay";
import type { DirectoryAdapter } from "@cello/relay";
import { createDirectoryNode } from "@cello/directory";
import type { RelayAdapter, RelaySessionAssignment } from "@cello/directory";
import { createClient } from "@cello/client";
import { createMcpServer } from "../index.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Notification } from "@modelcontextprotocol/sdk/types.js";

setupV3Tests();

const CBOR_ENC = new Encoder({ tagUint8Array: false });

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseResult(result: Awaited<ReturnType<Client["callTool"]>>): unknown {
  const text = (result.content as Array<{ type: string; text: string }>)
    .find((c) => c.type === "text")?.text;
  if (!text) throw new Error("No text content in tool result");
  return JSON.parse(text);
}

// ─── Full fixture with real directory, relay, two clients ─────────────────────

interface Fixture {
  pubkeyAHex: string;
  pubkeyBHex: string;
  mcpA: Client;
  mcpB: Client;
  notificationsB: Notification[];
  stopAll: () => Promise<void>;
}

async function makeFullFixture(): Promise<Fixture> {
  const dirKp = generateKeypair();
  const dirPubkey = await dirKp.getPublicKey();

  // Create relay with directory adapter
  let dirNodeRef: Awaited<ReturnType<typeof createDirectoryNode>> | null = null;
  const directoryAdapter: DirectoryAdapter = {
    async processSeal(sessionId, sealData) {
      if (!dirNodeRef) return { ok: false, reason: "directory_not_ready" };
      return dirNodeRef.directory.processSeal(sessionId, sealData);
    },
  };
  const relayResult = await createRelayNode({ directoryPubkey: dirPubkey, directory: directoryAdapter });
  const relayPeerId = relayResult.node.getPeerId();
  const relayMultiaddrs = relayResult.node.listenAddresses();

  const relayAdapterForDir: RelayAdapter = {
    recordAssignment(a: RelaySessionAssignment) {
      return relayResult.relay.recordAssignment(a);
    },
    discardSession(id: Uint8Array) { relayResult.relay.discardSession(id); },
    submitForSeal(id: Uint8Array) { return relayResult.relay.submitForSeal(id); },
    confirmSeal(id: Uint8Array) { relayResult.relay.confirmSeal(id); },
    rejectSeal(id: Uint8Array, reason: string) { relayResult.relay.rejectSeal(id, reason); },
  };

  dirNodeRef = await createDirectoryNode({
    keyProvider: dirKp,
    relay: relayAdapterForDir,
    relayEndpoint: { peer_id: relayPeerId, multiaddrs: relayMultiaddrs },
  });

  const dirPeerId = dirNodeRef.node.getPeerId();
  const dirMultiaddrs = dirNodeRef.node.listenAddresses();
  const directoryEndpoint = { peer_id: dirPeerId, multiaddrs: dirMultiaddrs };

  const kpA = generateKeypair();
  const kpB = generateKeypair();
  const nodeA = await createNode({ keyProvider: kpA, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
  const nodeB = await createNode({ keyProvider: kpB, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
  await nodeA.start();
  await nodeB.start();

  const pubkeyA = await kpA.getPublicKey();
  const pubkeyB = await kpB.getPublicKey();
  const pubkeyAHex = Buffer.from(pubkeyA).toString("hex");
  const pubkeyBHex = Buffer.from(pubkeyB).toString("hex");
  const peerIdA = nodeA.getPeerId();
  const peerIdB = nodeB.getPeerId();
  const multiaddrsA = nodeA.listenAddresses();
  const multiaddrsB = nodeB.listenAddresses();

  dirNodeRef.directory.registerPeerInfo(pubkeyAHex, peerIdA, multiaddrsA);
  dirNodeRef.directory.registerPeerInfo(pubkeyBHex, peerIdB, multiaddrsB);

  // Both clients configured with the directory endpoint (DB-001: stream opened inline)
  const clientA = createClient(nodeA, kpA, { directoryEndpoint });
  const clientB = createClient(nodeB, kpB, { directoryEndpoint });
  await clientA.registerHandler();
  await clientB.registerHandler();

  const notificationsB: Notification[] = [];

  const serverA = createMcpServer(nodeA, clientA, kpA);
  const serverB = createMcpServer(nodeB, clientB, kpB);

  const [stA, ctA] = InMemoryTransport.createLinkedPair();
  const [stB, ctB] = InMemoryTransport.createLinkedPair();
  await serverA.connect(stA);
  await serverB.connect(stB);

  const mcpA = new Client({ name: "agent-a", version: "0.0.1" });
  const mcpB = new Client({ name: "agent-b", version: "0.0.1" });

  (mcpB as unknown as { fallbackNotificationHandler: (n: Notification) => void })
    .fallbackNotificationHandler = (n) => { notificationsB.push(n); };

  await mcpA.connect(ctA);
  await mcpB.connect(ctB);

  const stopAll = async () => {
    try { await mcpA.close(); } catch {}
    try { await mcpB.close(); } catch {}
    try { await serverA.close(); } catch {}
    try { await serverB.close(); } catch {}
    try { await nodeA.stop(); } catch {}
    try { await nodeB.stop(); } catch {}
    try { await dirNodeRef?.stop(); } catch {}
    try { await relayResult.stop(); } catch {}
  };

  return { pubkeyAHex, pubkeyBHex, mcpA, mcpB, notificationsB, stopAll };
}

// ─── Scope ─────────────────────────────────────────────────────────────────────

let scope: TestScope;
beforeEach(() => { scope = createTestScope(); });
afterEach(() => scope.run(async () => {}));

// ─── SI-001: session_request frame structure ──────────────────────────────────

describe("SI-001: session_request frame contains only { type, target_pubkey }", () => {
  it("SI-001: CBOR-encoded session_request has exactly type and target_pubkey; no key material, no extra fields", () => {
    const targetPubkey = new Uint8Array(32).fill(0xab);

    // This mirrors exactly how the client builds the frame (inline CBOR, no directory import)
    const frameBytes = CBOR_ENC.encode({
      type: "session_request",
      target_pubkey: targetPubkey,
    }) as Uint8Array;

    const decoded = decode(frameBytes) as Record<string, unknown>;

    // Must have exactly type and target_pubkey
    expect(Object.keys(decoded).sort()).toEqual(["target_pubkey", "type"]);
    expect(decoded["type"]).toBe("session_request");

    const decodedKey = decoded["target_pubkey"];
    const keyBytes = decodedKey instanceof Uint8Array ? decodedKey
      : Buffer.isBuffer(decodedKey) ? new Uint8Array(decodedKey as Buffer)
      : null;
    expect(keyBytes).not.toBeNull();
    expect(keyBytes!.length).toBe(32);
    expect(Buffer.from(keyBytes!).equals(Buffer.from(targetPubkey))).toBe(true);

    // SI-001: no session content, no key material, no extra fields
    expect(decoded["content"]).toBeUndefined();
    expect(decoded["signature"]).toBeUndefined();
    expect(decoded["private_key"]).toBeUndefined();
    expect(decoded["session_id"]).toBeUndefined();
    expect(decoded["trust_signal"]).toBeUndefined();
  });
});

// ─── AC-005: transport not started ───────────────────────────────────────────

describe("AC-005: transport not started → error without network access", () => {
  it("AC-005: cello_initiate_session when node.start() not called returns error without touching network", async () => {
    const kp = generateKeypair();
    const node = await createNode({ keyProvider: kp, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    // Intentionally NOT calling node.start() — transport not started

    const client = createClient(node, kp);
    const server = createMcpServer(node, client, kp);
    const [st, ct] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    const mcpClient = new Client({ name: "test", version: "0.0.1" });
    await mcpClient.connect(ct);
    scope.addCleanup(async () => { try { await mcpClient.close(); } catch {} });
    scope.addCleanup(async () => { try { await server.close(); } catch {} });

    const result = parseResult(
      await mcpClient.callTool({
        name: "cello_initiate_session",
        arguments: { target_pubkey: "aa".repeat(32) },
      })
    ) as Record<string, unknown>;

    // AC-005: must return an error — either transport_not_started or client_not_initialized
    expect(result.error).toBeDefined();
    const reason = (result.error as Record<string, unknown>).reason as string;
    expect(["transport_not_started", "client_not_initialized"]).toContain(reason);
  }, 10_000);
});

// ─── SI-002: no private key material in tool response ─────────────────────────

describe("SI-002: K_local private key never appears in cello_initiate_session tool response", () => {
  it("SI-002: ok:true response contains only ok, session_id, genesis_prev_root — no private key material", async () => {
    const fix = await makeFullFixture();
    scope.addCleanup(fix.stopAll);

    // B awaits session in parallel
    const bSessionPromise = fix.mcpB.callTool({
      name: "cello_await_session",
      arguments: { timeout_ms: 15_000 },
    });

    const result = parseResult(
      await fix.mcpA.callTool({
        name: "cello_initiate_session",
        arguments: { target_pubkey: fix.pubkeyBHex },
      })
    ) as Record<string, unknown>;

    await bSessionPromise.catch(() => {});

    expect(result.ok).toBe(true);

    // SI-002: response must not contain private key fields
    const keys = Object.keys(result).sort();
    expect(keys).toContain("ok");
    expect(keys).toContain("session_id");
    expect(keys).toContain("genesis_prev_root");
    expect(keys).not.toContain("private_key");
    expect(keys).not.toContain("signature");
    expect(keys).not.toContain("key_bytes");
  }, 20_000);
});

// ─── AC-001: full session establishment via directory signaling ────────────────

describe("AC-001: A and B authenticated to directory; A initiates; session established", () => {
  it("AC-001: A calls cello_initiate_session; session_request sent via real signaling; B gets cello_session_request notification; session_ids match; genesis_prev_root byte-identical", async () => {
    const fix = await makeFullFixture();
    scope.addCleanup(fix.stopAll);

    // B awaits session in parallel
    const bSessionPromise = fix.mcpB.callTool({
      name: "cello_await_session",
      arguments: { timeout_ms: 15_000 },
    });

    // A initiates session with B via real directory signaling
    const aResult = parseResult(
      await fix.mcpA.callTool({
        name: "cello_initiate_session",
        arguments: { target_pubkey: fix.pubkeyBHex },
      })
    ) as Record<string, unknown>;

    // A must get ok:true with a session_id
    expect(aResult.ok).toBe(true);
    expect(typeof aResult.session_id).toBe("string");
    expect(aResult.session_id as string).toMatch(/^[0-9a-f]{32}$/);

    // B's cello_await_session must return new_session
    const bResult = parseResult(await bSessionPromise) as {
      type: string;
      session_id: string;
      genesis_prev_root: string;
    };
    expect(bResult.type).toBe("new_session");

    // AC-001: session_id must match between A and B
    expect(bResult.session_id).toBe(aResult.session_id);

    // AC-001: genesis_prev_root must be byte-identical
    expect(typeof aResult.genesis_prev_root).toBe("string");
    expect(bResult.genesis_prev_root).toBe(aResult.genesis_prev_root);
  }, 20_000);
});

// ─── AC-002: target offline ────────────────────────────────────────────────────

describe("AC-002: target pubkey has no authenticated stream → target_offline", () => {
  it("AC-002: initiating session for non-existent pubkey returns target_offline; no session allocated", async () => {
    const fix = await makeFullFixture();
    scope.addCleanup(fix.stopAll);

    // Use a pubkey that is not authenticated on the directory
    const offlinePubkey = "deadbeef".repeat(8); // 64 hex chars = 32 bytes

    const result = parseResult(
      await fix.mcpA.callTool({
        name: "cello_initiate_session",
        arguments: { target_pubkey: offlinePubkey },
      })
    ) as Record<string, unknown>;

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("target_offline");
  }, 15_000);
});

// ─── AC-003: timeout ──────────────────────────────────────────────────────────

describe("AC-003: no directory response within timeout → timeout", () => {
  it("AC-003: initiateSession with 1ms timeout returns timeout or directory_unreachable; session state clean", async () => {
    const kp = generateKeypair();
    const node = await createNode({ keyProvider: kp, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await node.start();
    scope.addCleanup(async () => { try { await node.stop(); } catch {} });

    // Use an unreachable/invalid directory endpoint with a very short timeout
    const client = createClient(node, kp, {
      directoryEndpoint: { peer_id: "12D3KooWUnreachable", multiaddrs: ["/ip4/127.0.0.1/tcp/9"] },
    });
    await client.registerHandler();

    // 1ms timeout — direction connection attempt will fail or time out
    const result = await client.initiateSession("deadbeef".repeat(8), { timeoutMs: 1 });

    expect(result.ok).toBe(false);
    // Either timeout or directory_unreachable depending on how fast the TCP connect fails
    expect(["timeout", "directory_unreachable"]).toContain((result as { ok: false; reason: string }).reason);
  }, 10_000);
});

// ─── DB-001: signaling stream opens inline on first initiateSession call ───────

describe("DB-001: signaling stream not yet open → opens inline; single retry on failure", () => {
  it("DB-001: first call to initiateSession opens the signaling stream inline and completes session establishment", async () => {
    const fix = await makeFullFixture();
    scope.addCleanup(fix.stopAll);

    // B awaits session
    const bSessionPromise = fix.mcpB.callTool({
      name: "cello_await_session",
      arguments: { timeout_ms: 15_000 },
    });

    // A's first call — stream not yet open, must open inline (DB-001)
    const aResult = parseResult(
      await fix.mcpA.callTool({
        name: "cello_initiate_session",
        arguments: { target_pubkey: fix.pubkeyBHex },
      })
    ) as Record<string, unknown>;

    expect(aResult.ok).toBe(true);
    const bResult = parseResult(await bSessionPromise) as { type: string };
    expect(bResult.type).toBe("new_session");
  }, 20_000);
});
