/**
 * CELLO-ADAPTER-003 — Adapter review findings unit tests
 *
 * H-002: relay_unavailable code path test
 *   B-3 in the story spec says:
 *     "relay unreachable → directory returns relay_unavailable → {ok:false, reason:'relay_unavailable'}"
 *   This tests the full path: real directory node with a relay adapter that returns
 *   { ok: false, reason: "relay_unavailable" } from recordAssignment.
 *   We call clientA.initiateSession() directly (not through the MCP tool) because
 *   the cello_initiate_session schema only accepts target_pubkey and does not forward
 *   directory endpoint coordinates to the client method.
 *
 * AC-005 (L-001): transport not started → returns transport_not_started
 *   The spec behavior B-5 and AC-005 use "transport_not_started", not "client_not_initialized".
 *   This test asserts exactly "transport_not_started" (not a two-value array).
 *
 * L-003: Absence of not_available_in_m1
 *   The M1 stub that returned not_available_in_m1 is retired in ADAPTER-003.
 *   Verified here by documentation: grep -r not_available_in_m1 packages/ --include='*.ts' | grep -v test
 *   should return empty (no production code references that string).
 */

import { createHash } from "node:crypto";
import { Encoder, decode as cborDecode } from "cbor-x";
import * as lp from "it-length-prefixed";
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
import { generateKeypair } from "@cello/crypto";
import { createNode } from "@cello/transport";
import { createClient } from "@cello/client";
import { createDirectoryNode, SIGNALING_PROTOCOL_ID } from "@cello/directory";
import type { RelayAdapter, RelaySessionAssignment } from "@cello/directory";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../index.js";

setupV3Tests();

const CBOR_ENC = new Encoder({ tagUint8Array: false });

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseResult(result: Awaited<ReturnType<Client["callTool"]>>): unknown {
  const text = (result.content as Array<{ type: string; text: string }>)
    .find((c) => c.type === "text")?.text;
  if (!text) throw new Error("No text content in tool result");
  return JSON.parse(text);
}

/**
 * A relay adapter whose recordAssignment always returns { ok: false, reason: "relay_unavailable" }.
 * Used to test the relay_unavailable error path.
 */
function makeUnavailableRelayAdapter(): RelayAdapter {
  return {
    recordAssignment(_assignment: RelaySessionAssignment): { ok: false; reason: string } {
      return { ok: false, reason: "relay_unavailable" };
    },
    discardSession(_sessionId: Uint8Array): void {},
    submitForSeal(_sessionId: Uint8Array): { ok: false; reason: string } {
      return { ok: false, reason: "session_not_found" };
    },
    confirmSeal(_sessionId: Uint8Array): void {},
    rejectSeal(_sessionId: Uint8Array, _reason: string): void {},
  };
}

/**
 * Authenticate a node's signaling stream to the directory using CELLO-DIR-AUTH-v1.
 * Returns the open stream (caller is responsible for cleanup).
 */
async function authenticateToDirectory(
  nodeB: Awaited<ReturnType<typeof createNode>>,
  kpB: ReturnType<typeof generateKeypair>,
  pubkeyB: Uint8Array,
  dirMultiaddr: string,
  dirPeerId: string,
): Promise<{ stream: ReturnType<typeof nodeB.newStream> extends Promise<infer S> ? S : never }> {
  await nodeB.dial(dirMultiaddr);
  const stream = await nodeB.newStream(dirPeerId, SIGNALING_PROTOCOL_ID);

  // Read auth challenge, sign, send response (CELLO-DIR-AUTH-v1)
  const iter = (lp.decode(stream) as AsyncIterable<unknown>)[Symbol.asyncIterator]() as AsyncIterator<Uint8Array>;
  const { value: challengeRaw } = await iter.next();
  const challengeBytes = challengeRaw instanceof Uint8Array ? challengeRaw
    : (challengeRaw as unknown as { slice(): Uint8Array }).slice();
  const challengeFrame = cborDecode(challengeBytes) as Record<string, unknown>;
  const nonce = challengeFrame["nonce"] as Uint8Array;

  const domain = Buffer.from("CELLO-DIR-AUTH-v1", "utf8");
  const authMsg = new Uint8Array(Buffer.concat([domain, nonce, pubkeyB]));
  const msgHash = new Uint8Array(createHash("sha256").update(authMsg).digest());
  const sig = await kpB.sign(msgHash);

  stream.send(lp.encode.single(CBOR_ENC.encode({
    type: "signaling_auth_response",
    pubkey: new Uint8Array(pubkeyB),
    signature: new Uint8Array(sig),
  }) as Uint8Array));

  return { stream: stream as never };
}

let scope: TestScope;
beforeEach(() => { scope = createTestScope(); });
afterEach(() => scope.run(async () => {}));

// ─── H-002: relay_unavailable path ────────────────────────────────────────────

describe("H-002: relay unavailable → clientA.initiateSession returns relay_unavailable", () => {
  it("H-002: B is online (authenticated), relay.recordAssignment returns unavailable → A gets relay_unavailable", async () => {
    // Directory node with a relay adapter that always rejects recordAssignment
    const dirKey = generateKeypair();
    const unavailableRelay = makeUnavailableRelayAdapter();

    const dirNode = await createDirectoryNode({
      keyProvider: dirKey,
      relay: unavailableRelay,
      relayEndpoint: { peer_id: "12D3KooWRelayTest", multiaddrs: ["/ip4/127.0.0.1/tcp/9999"] },
    });
    scope.addCleanup(dirNode.stop);

    const dirPeerId = dirNode.node.getPeerId();
    const dirMultiaddrs = dirNode.node.listenAddresses();

    // Client A — the initiator
    const kpA = generateKeypair();
    const nodeA = await createNode({ keyProvider: kpA, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await nodeA.start();
    scope.addCleanup(() => nodeA.stop());

    // Client B — the target (must be online / authenticated to directory so it's not "target_offline")
    const kpB = generateKeypair();
    const nodeB = await createNode({ keyProvider: kpB, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await nodeB.start();
    scope.addCleanup(() => nodeB.stop());

    const pubkeyA = await kpA.getPublicKey();
    const pubkeyB = await kpB.getPublicKey();
    const pubkeyAHex = Buffer.from(pubkeyA).toString("hex");
    const pubkeyBHex = Buffer.from(pubkeyB).toString("hex");
    const peerIdA = nodeA.getPeerId();
    const peerIdB = nodeB.getPeerId();

    // Register peer info so the directory knows the multiaddrs
    dirNode.directory.registerPeerInfo(pubkeyAHex, peerIdA, nodeA.listenAddresses());
    dirNode.directory.registerPeerInfo(pubkeyBHex, peerIdB, nodeB.listenAddresses());

    // Create client A with real client so initiateSession actually sends to directory
    const clientA = createClient(nodeA, kpA);
    await clientA.registerHandler();

    // Authenticate B to the directory so it appears online
    const { stream: bStream } = await authenticateToDirectory(
      nodeB, kpB, new Uint8Array(pubkeyB), dirMultiaddrs[0], dirPeerId
    );
    scope.addCleanup(() => { try { bStream.abort(new Error("test_cleanup")); } catch {} });

    // Wait briefly for B's authentication to be registered
    await new Promise((r) => setTimeout(r, 50));

    // Call initiateSession directly on clientA (not through MCP) — this tests B-3 behavior:
    // directory finds B online, but relay.recordAssignment returns unavailable.
    //
    // Note: the cello_initiate_session MCP tool schema only accepts target_pubkey and does
    // not forward directory endpoint coordinates. We therefore test the client layer directly.
    const result = await clientA.initiateSession(pubkeyBHex, {
      directoryPeerId: dirPeerId,
      directoryMultiaddr: dirMultiaddrs[0],
      timeoutMs: 10_000,
    });

    // Must return relay_unavailable (not target_offline or timeout)
    expect(result.ok).toBe(false);
    expect((result as { ok: false; reason: string }).reason).toBe("relay_unavailable");

    // No session was allocated on A's side
    expect(clientA.listSessions()).toHaveLength(0);
  }, 20_000);
});

// ─── AC-005 / L-001: transport not started → transport_not_started ────────────

describe("AC-005 (L-001): transport not started returns transport_not_started exactly", () => {
  it("AC-005: cello_initiate_session with transport not started returns exactly transport_not_started", async () => {
    // Create a node but do NOT start it (so listenAddresses() returns [])
    const kp = generateKeypair();
    const node = await createNode({ keyProvider: kp, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    // node is NOT started — listenAddresses() returns []

    const clientStub = {
      addPeer: () => {},
      async send() { return { delivered: false as const, reason: "peer_not_connected" as const }; },
      async registerHandler() {},
      receive() { return null; },
      peekAll() { return []; },
      async receiveSessionAssignment() { return { ok: false as const, reason: "relay_auth_error" as const }; },
      listSessions() { return []; },
      async sendMessage() { return { ok: false as const, reason: "session_not_found" as const }; },
      receiveMessage() { return null; },
      receiveAnyMessage() { return null; },
      async initiateSessionSeal() { return { ok: false as const, reason: "session_not_found" as const }; },
      closeSession() {},
      onSessionAssignment() {},
      async initiateSession() { return { ok: false as const, reason: "directory_unreachable" as const }; },
    };

    const server = createMcpServer(node, clientStub as Parameters<typeof createMcpServer>[1], kp);
    const [st, ct] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    const mcpClient = new Client({ name: "test", version: "0.0.1" });
    await mcpClient.connect(ct);
    scope.addCleanup(async () => { try { await mcpClient.close(); } catch {} });
    scope.addCleanup(async () => { try { await server.close(); } catch {} });

    const result = parseResult(
      await mcpClient.callTool({
        name: "cello_initiate_session",
        arguments: { target_pubkey: "a".repeat(64) },
      })
    ) as Record<string, unknown>;

    // L-001: must be exactly "transport_not_started" — NOT "client_not_initialized"
    expect(result.error).toBeDefined();
    expect((result.error as Record<string, unknown>).reason).toBe("transport_not_started");
  }, 10_000);
});

// ─── L-003: no not_available_in_m1 in production code ────────────────────────

describe("L-003: not_available_in_m1 stub is retired", () => {
  it("L-003: production code no longer returns not_available_in_m1", async () => {
    // This test documents that the M1 stub is retired.
    // Verification: grep -r not_available_in_m1 packages/ --include='*.ts' | grep -v test
    // returns empty — no production .ts files reference that string.
    //
    // The implementation: server.ts now delegates to client.initiateSession()
    // and returns its result directly, never returning not_available_in_m1.
    // The optional-method check has been removed from server.ts.
    //
    // We verify this at the adapter level by confirming the tool calls through
    // to the client's initiateSession (a client that returns a real error, not not_available_in_m1).

    const kp = generateKeypair();
    const node = await createNode({ keyProvider: kp, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await node.start();
    scope.addCleanup(() => node.stop());

    // A client that has initiateSession and returns "directory_unreachable"
    const client = {
      addPeer: () => {},
      async send() { return { delivered: false as const, reason: "peer_not_connected" as const }; },
      async registerHandler() {},
      receive() { return null; },
      peekAll() { return []; },
      async receiveSessionAssignment() { return { ok: false as const, reason: "relay_auth_error" as const }; },
      listSessions() { return []; },
      async sendMessage() { return { ok: false as const, reason: "session_not_found" as const }; },
      receiveMessage() { return null; },
      receiveAnyMessage() { return null; },
      async initiateSessionSeal() { return { ok: false as const, reason: "session_not_found" as const }; },
      closeSession() {},
      onSessionAssignment() {},
      // This is the real initiateSession — returns directory_unreachable, NOT not_available_in_m1
      async initiateSession() { return { ok: false as const, reason: "directory_unreachable" as const }; },
    };

    const server = createMcpServer(node, client as Parameters<typeof createMcpServer>[1], kp);
    const [st, ct] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    const mcpClient = new Client({ name: "test", version: "0.0.1" });
    await mcpClient.connect(ct);
    scope.addCleanup(async () => { try { await mcpClient.close(); } catch {} });
    scope.addCleanup(async () => { try { await server.close(); } catch {} });

    const result = parseResult(
      await mcpClient.callTool({
        name: "cello_initiate_session",
        arguments: { target_pubkey: "a".repeat(64) },
      })
    ) as Record<string, unknown>;

    // Must NOT be "not_available_in_m1" — the stub is retired
    expect(result.reason).not.toBe("not_available_in_m1");
    // Must be a real error reason from initiateSession
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("directory_unreachable");
  }, 10_000);
});
