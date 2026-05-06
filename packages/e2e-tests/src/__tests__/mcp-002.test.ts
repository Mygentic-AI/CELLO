/**
 * CELLO-MCP-002 — Session-aware MCP tool surface e2e tests
 *
 * Tests run via InMemoryTransport against real in-process libp2p nodes,
 * a real directory node, and a real relay node — same fixture as session003.test.ts.
 *
 * Covered ACs (e2e scope — complements mcp002.test.ts unit tests):
 *   AC-001: cello_initiate_session on A polls until directory assigns session → session_id returned
 *   AC-002: cello_await_session on B returns new_session when assignment arrives
 *   AC-003: cello_send (session-keyed) delivers message on active session
 *   AC-004: cello_receive (session-keyed) returns message with correct content and sender_pubkey
 *   AC-005: cello_list_sessions shows both A and B sessions with status:active, leaf_count > 0
 *
 * AC-010, AC-011 (seal ceremony via MCP) require the full SESSION-003 + directory seal flow
 * and are deferred to a future story (SESSION-MCP-003-E2E).
 */

import {
  setupV3Tests,
  createTestScope,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  waitFor,
} from "@claude-flow/testing";
import type { TestScope } from "@claude-flow/testing";
import { randomBytes } from "node:crypto";
import { Encoder } from "cbor-x";
import { generateKeypair } from "@cello/crypto";
import { createNode } from "@cello/transport";
import { createRelayNode } from "@cello/relay";
import type { DirectoryAdapter } from "@cello/relay";
import { createDirectoryNode } from "@cello/directory";
import type { RelayAdapter } from "@cello/directory";
import type { RelaySessionAssignment } from "@cello/directory";
import { createClient, createMcpSessionServer } from "@cello/client";
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

// ─── Full fixture: directory + relay + two clients + two MCP servers ──────────

interface Fixture {
  dirKp: ReturnType<typeof generateKeypair>;
  dirPubkey: Uint8Array;
  dirPeerId: string;
  dirMultiaddrs: string[];
  relayPeerId: string;
  relayMultiaddrs: string[];
  clientA: ReturnType<typeof createClient>;
  clientB: ReturnType<typeof createClient>;
  kpA: ReturnType<typeof generateKeypair>;
  kpB: ReturnType<typeof generateKeypair>;
  pubkeyAHex: string;
  pubkeyBHex: string;
  peerIdA: string;
  peerIdB: string;
  multiaddrsA: string[];
  multiaddrsB: string[];
  mcpA: Client;
  mcpB: Client;
  notificationsA: Notification[];
  notificationsB: Notification[];
  relay: Awaited<ReturnType<typeof createRelayNode>>["relay"];
  stopAll: () => Promise<void>;
}

async function makeFixture(): Promise<Fixture> {
  const dirKp = generateKeypair();
  const dirPubkey = await dirKp.getPublicKey();

  // Relay with directory adapter wired in
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

  const clientA = createClient(nodeA, kpA);
  const clientB = createClient(nodeB, kpB);
  await clientA.registerHandler();
  await clientB.registerHandler();

  const notificationsA: Notification[] = [];
  const notificationsB: Notification[] = [];

  const serverA = createMcpSessionServer(nodeA, clientA, kpA);
  const serverB = createMcpSessionServer(nodeB, clientB, kpB);

  const [stA, ctA] = InMemoryTransport.createLinkedPair();
  const [stB, ctB] = InMemoryTransport.createLinkedPair();
  await serverA.connect(stA);
  await serverB.connect(stB);

  const mcpA = new Client({ name: "agent-a", version: "0.0.1" });
  const mcpB = new Client({ name: "agent-b", version: "0.0.1" });

  (mcpA as unknown as { fallbackNotificationHandler: (n: Notification) => void })
    .fallbackNotificationHandler = (n) => { notificationsA.push(n); };
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

  return {
    dirKp, dirPubkey, dirPeerId, dirMultiaddrs,
    relayPeerId, relayMultiaddrs,
    clientA, clientB, kpA, kpB,
    pubkeyAHex, pubkeyBHex,
    peerIdA, peerIdB, multiaddrsA, multiaddrsB,
    mcpA, mcpB, notificationsA, notificationsB,
    relay: relayResult.relay,
    stopAll,
  };
}

/** Issue a directory-signed session assignment and deliver it to both clients. */
async function setupSession(fix: Fixture): Promise<{
  sessionIdHex: string;
  sessionId: Uint8Array;
}> {
  const sessionId = new Uint8Array(randomBytes(16));
  const sessionIdHex = Buffer.from(sessionId).toString("hex");
  const session_timestamp = Date.now();

  const pubkeyA = await fix.kpA.getPublicKey();
  const pubkeyB = await fix.kpB.getPublicKey();

  const tbs = CBOR_ENC.encode([
    sessionId,
    pubkeyA,
    pubkeyB,
    session_timestamp > 0xffffffff ? BigInt(session_timestamp) : session_timestamp,
  ]) as Uint8Array;
  const dirSig = await fix.dirKp.sign(tbs);

  const assignment = {
    session_id: sessionId,
    participant_a: { pubkey: pubkeyA, peer_id: fix.peerIdA, multiaddrs: fix.multiaddrsA },
    participant_b: { pubkey: pubkeyB, peer_id: fix.peerIdB, multiaddrs: fix.multiaddrsB },
    relay_endpoint: { peer_id: fix.relayPeerId, multiaddrs: fix.relayMultiaddrs },
    directory_endpoint: { peer_id: fix.dirPeerId, multiaddrs: fix.dirMultiaddrs },
    session_timestamp,
    directory_pubkey: fix.dirPubkey,
    directory_signature: new Uint8Array(dirSig),
  };

  const registered = fix.relay.recordAssignment({
    session_id: sessionId,
    participant_a: pubkeyA,
    participant_b: pubkeyB,
    session_timestamp,
    directory_signature: new Uint8Array(dirSig),
  });
  if (!registered.ok) throw new Error(`relay.recordAssignment failed: ${(registered as { reason?: string }).reason}`);

  const [rA, rB] = await Promise.all([
    fix.clientA.receiveSessionAssignment(assignment, pubkeyA),
    fix.clientB.receiveSessionAssignment(assignment, pubkeyB),
  ]);
  if (!rA.ok) throw new Error(`clientA.receiveSessionAssignment: ${(rA as { reason?: string }).reason}`);
  if (!rB.ok) throw new Error(`clientB.receiveSessionAssignment: ${(rB as { reason?: string }).reason}`);

  return { sessionIdHex, sessionId };
}

// ─── Scope ────────────────────────────────────────────────────────────────────

let scope: TestScope;
beforeEach(() => { scope = createTestScope(); });
afterEach(() => scope.run(async () => {}));

// ─── AC-001: cello_initiate_session polls until session appears ───────────────

describe("AC-001: cello_initiate_session returns session_id when assignment arrives", () => {
  it("AC-001: A polls for session with B's pubkey; directory issues assignment; session_id returned as 32-char hex", async () => {
    const fix = await makeFixture();
    scope.addCleanup(fix.stopAll);

    // Deliver the session assignment after a short delay (simulating directory response)
    setTimeout(() => {
      void setupSession(fix);
    }, 50);

    const result = parseResult(
      await fix.mcpA.callTool({
        name: "cello_initiate_session",
        arguments: { target_pubkey: fix.pubkeyBHex },
      })
    ) as Record<string, unknown>;

    // Must return a session_id, not an error
    expect(typeof result.session_id).toBe("string");
    expect((result.session_id as string)).toMatch(/^[0-9a-f]{32}$/);
    expect(result.counterparty_pubkey).toBe(fix.pubkeyBHex);
    expect(result.genesis_prev_root).toMatch(/^[0-9a-f]+$/);
  }, 15_000);
});

// ─── AC-002: cello_await_session returns new_session when assignment arrives ──

describe("AC-002: cello_await_session on B returns new_session with session details", () => {
  it("AC-002: B calls cello_await_session; assignment fires; returns {type:new_session,session_id,counterparty_pubkey}", async () => {
    const fix = await makeFixture();
    scope.addCleanup(fix.stopAll);

    // Fire assignment after a short delay so await_session is already blocked when it arrives
    setTimeout(() => {
      void setupSession(fix);
    }, 100);

    const result = parseResult(
      await fix.mcpB.callTool({
        name: "cello_await_session",
        arguments: { timeout_ms: 10_000 },
      })
    ) as { type: string; session_id: string; counterparty_pubkey: string; genesis_prev_root: string };

    expect(result.type).toBe("new_session");
    expect(result.session_id).toMatch(/^[0-9a-f]{32}$/);
    expect(result.counterparty_pubkey).toBe(fix.pubkeyAHex);
    expect(result.genesis_prev_root).toMatch(/^[0-9a-f]+$/);
  }, 15_000);
});

// ─── AC-003 + AC-004: cello_send + cello_receive round-trip ──────────────────

describe("AC-003 + AC-004: cello_send delivers; cello_receive returns message with correct content", () => {
  it("AC-003+004: A sends 'hello'; B's cello_receive returns {type:message, content:'hello', sender_pubkey:A's pubkey}", async () => {
    const fix = await makeFixture();
    scope.addCleanup(fix.stopAll);

    const { sessionIdHex } = await setupSession(fix);

    // AC-003: A sends via session-keyed cello_send
    const sendResult = parseResult(
      await fix.mcpA.callTool({
        name: "cello_send",
        arguments: { session_id: sessionIdHex, content: "hello" },
      })
    ) as { delivered: boolean; leaf_hash: string };

    expect(sendResult.delivered).toBe(true);
    expect(sendResult.leaf_hash).toMatch(/^[0-9a-f]{64}$/);

    // AC-004: B receives via session-keyed cello_receive
    const recvResult = parseResult(
      await fix.mcpB.callTool({
        name: "cello_receive",
        arguments: { session_id: sessionIdHex, timeout_ms: 10_000 },
      })
    ) as { type: string; content: string; sender_pubkey: string; sequence_number: number; leaf_hash: string };

    expect(recvResult.type).toBe("message");
    expect(recvResult.content).toBe("hello");
    expect(recvResult.sender_pubkey).toBe(fix.pubkeyAHex);
    expect(recvResult.leaf_hash).toMatch(/^[0-9a-f]{64}$/);
  }, 20_000);
});

// ─── AC-005: cello_list_sessions shows session with status and leaf_count ─────

describe("AC-005: cello_list_sessions shows active session on both A and B", () => {
  it("AC-005: after send+receive, both A and B list sessions with status:active and leaf_count>0", async () => {
    const fix = await makeFixture();
    scope.addCleanup(fix.stopAll);

    const { sessionIdHex } = await setupSession(fix);

    // Send a message so leaf_count > 0 on both sides
    await fix.mcpA.callTool({
      name: "cello_send",
      arguments: { session_id: sessionIdHex, content: "leaf-for-count" },
    });

    // Wait for B to receive and confirm the leaf landed
    await waitFor(
      () => fix.clientB.receiveMessage(sessionIdHex) !== null,
      { timeout: 10_000 }
    );

    // A's session list
    const listA = parseResult(
      await fix.mcpA.callTool({ name: "cello_list_sessions", arguments: {} })
    ) as Array<{ session_id: string; status: string; counterparty_pubkey: string; leaf_count: number }>;

    expect(listA).toHaveLength(1);
    expect(listA[0].session_id).toBe(sessionIdHex);
    expect(listA[0].status).toBe("active");
    expect(listA[0].counterparty_pubkey).toBe(fix.pubkeyBHex);
    expect(listA[0].leaf_count).toBeGreaterThan(0);

    // B's session list
    const listB = parseResult(
      await fix.mcpB.callTool({ name: "cello_list_sessions", arguments: {} })
    ) as Array<{ session_id: string; status: string; counterparty_pubkey: string; leaf_count: number }>;

    expect(listB).toHaveLength(1);
    expect(listB[0].session_id).toBe(sessionIdHex);
    expect(listB[0].status).toBe("active");
    expect(listB[0].counterparty_pubkey).toBe(fix.pubkeyAHex);
    expect(listB[0].leaf_count).toBeGreaterThan(0);
  }, 25_000);
});

// ─── AC-002 notification: cello_session_request fires on B ───────────────────

describe("AC-002 notification: cello_session_request channel notification fires on B when assignment arrives", () => {
  it("AC-002-notif: notifications/claude/channel fires with {type:cello_session_request, from:A_pubkey, session_id}", async () => {
    const fix = await makeFixture();
    scope.addCleanup(fix.stopAll);

    // Fire assignment while B is live
    await setupSession(fix);

    // Wait for B's notification
    await waitFor(
      () => fix.notificationsB.some((n) => n.method === "notifications/claude/channel"),
      { timeout: 5000 }
    );

    const notif = fix.notificationsB.find((n) => n.method === "notifications/claude/channel")!;
    const params = notif.params as Record<string, unknown>;

    expect(params.type).toBe("cello_session_request");
    expect(params.from).toBe(fix.pubkeyAHex);
    expect(typeof params.session_id).toBe("string");
    // SI-001: exactly these three keys — no genesis_prev_root, no multiaddrs, no content
    expect(Object.keys(params).sort()).toEqual(["from", "session_id", "type"]);
  }, 15_000);
});
