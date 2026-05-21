/**
 * CELLO-SESSION-007: Multi-session fan-in and session_sealed surfacing
 *
 * TDD Phase R — RED-first. Written BEFORE implementation completes.
 *
 * S — Specification:
 *
 * AC-001: cello_receive_session on S1 when S2 has queued messages → response includes
 *         other_sessions_pending: [S2]; subsequent cello_receive_session(S2) returns S2 message.
 *
 * AC-002: cello_receive (any-session) with two queued sessions → returns session_id and message
 *         from one session; other_sessions_pending lists the other; second call returns other.
 *
 * AC-003 (written as integration): blocked receiveSessionMessageAsync wakes when directory
 *         pushes session_sealed via injectDirectoryFrame — simulates the directory stream
 *         path with a real Ed25519 signature on the frame. Full multi-process coverage
 *         (separate OS processes, real libp2p signaling stream) is deferred to
 *         CELLO-PERSIST-E2E-001 per the story's component_stories reference.
 *
 * AC-004 (written as integration): blocked receiveMessageAsync (any-session) wakes on session_sealed;
 *         other session S2 is unaffected. Multi-process coverage deferred to
 *         CELLO-PERSIST-E2E-001.
 *
 * AC-005: receiveMessageAsync (any-session) with no messages → returns { type: 'timeout' }.
 *
 * AC-006: session_sealed enqueued while no receiver is active → next receiveMessage
 *         returns it immediately with sealed_root, close_timestamp, checkpoint_status.
 *
 * AC-007: cello-chat.md documents session_sealed inline; no old workaround text.
 *
 * SI-001: session_sealed for S never consumed by receiveMessage(S2) — SI adversarial test.
 *
 * SI-002: sealed_root from session_sealed event equals sealed_root in listSessions() record.
 *
 * Additional coverage:
 *   MCP layer: cello_receive_session returns session_sealed inline.
 *   MCP layer: cello_receive (any-session) tool exists; returns { type: 'timeout' }; includes session_id.
 *   Unit: other_sessions_pending populated when multiple sessions have queued messages.
 *
 * Crypto refs:
 *   Ed25519: RFC 8032 — directory signature on session_sealed TBS
 *   CBOR: RFC 8949
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
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Encoder } from "cbor-x";
import { generateKeypair } from "@cello/crypto";
import { createNode } from "@cello/transport";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { createClient } from "../client.js";
import { createMcpSessionServer } from "../mcp-server.js";
import type { CelloClient, SessionRecord } from "../types.js";

setupV3Tests();

const CBOR_ENC = new Encoder({ tagUint8Array: false });

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ─── Types ───────────────────────────────────────────────────────────────────

type TestClient = CelloClient & {
  injectTestSession(
    sessionIdHex: string,
    sessionId: Uint8Array,
    myPubkeyHex: string,
    directoryPubkey: Uint8Array,
    status?: SessionRecord["status"],
  ): void;
  injectDirectoryFrame(sessionIdHex: string, frame: Record<string, unknown>): void;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Build a real Ed25519-signed session_sealed frame.
 * The TBS is CBOR-encoded [session_id, sealed_root, close_timestamp] per M1 protocol.
 * Ed25519 signing: RFC 8032.
 */
async function buildSignedSealFrame(opts: {
  dirKp: ReturnType<typeof generateKeypair>;
  sessionId: Uint8Array;
  sealedRoot: Uint8Array;
  closeTimestamp: number;
}): Promise<Record<string, unknown>> {
  // TBS: CBOR([session_id, sealed_root, close_timestamp]) — M1 single-key path
  const tbs = CBOR_ENC.encode([
    opts.sessionId,
    opts.sealedRoot,
    opts.closeTimestamp > 0xffffffff ? BigInt(opts.closeTimestamp) : opts.closeTimestamp,
  ]) as Uint8Array;
  const dirSig = await opts.dirKp.sign(tbs);
  return {
    type: "session_sealed",
    session_id: opts.sessionId,
    sealed_root: opts.sealedRoot,
    close_timestamp: opts.closeTimestamp,
    directory_signature: dirSig,
    signature_type: "single",
  };
}

async function makeClient(): Promise<{ client: TestClient; stopAll: () => Promise<void> }> {
  const kp = generateKeypair();
  const node = await createNode({ keyProvider: kp, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
  await node.start();
  const client = createClient(node, kp) as unknown as TestClient;
  await client.registerHandler();
  const stopAll = async () => {
    try { await node.stop(); } catch {}
  };
  return { client, stopAll };
}

// ─── scope ────────────────────────────────────────────────────────────────────

let scope: TestScope;
beforeEach(() => { scope = createTestScope(); });
afterEach(() => scope.run(async () => {}));

// ─── AC-005: timeout ──────────────────────────────────────────────────────────

describe("AC-005: receiveMessageAsync (any-session) times out when no messages arrive", () => {
  it("AC-005: returns { type: 'timeout' } after timeout_ms elapses with no messages", async () => {
    const { client, stopAll } = await makeClient();
    scope.addCleanup(stopAll);

    const dirKp = generateKeypair();
    const dirPubkey = await dirKp.getPublicKey();
    const sessionId1 = new Uint8Array(32).fill(0x10);
    const s1Hex = Buffer.from(sessionId1).toString("hex");
    client.injectTestSession(s1Hex, sessionId1, "a".repeat(64), dirPubkey);

    const result = await client.receiveMessageAsync(50);
    expect(result.type).toBe("timeout");
  }, 3000);
});

// ─── AC-006: queued session_sealed returned immediately ───────────────────────

describe("AC-006: session_sealed enqueued while no receiver active", () => {
  it("AC-006: next receiveMessage returns lifecycle event immediately with sealed_root, close_timestamp, checkpoint_status", async () => {
    const { client, stopAll } = await makeClient();
    scope.addCleanup(stopAll);

    const dirKp = generateKeypair();
    const dirPubkey = await dirKp.getPublicKey();
    const sessionId = new Uint8Array(32).fill(0xAA);
    const sessionIdHex = Buffer.from(sessionId).toString("hex");
    const sealedRoot = new Uint8Array(32).fill(0xBB);
    const closeTimestamp = Date.now();

    client.injectTestSession(sessionIdHex, sessionId, "a".repeat(64), dirPubkey, "active");

    // Inject session_sealed while no receiver is active
    const frame = await buildSignedSealFrame({ dirKp, sessionId, sealedRoot, closeTimestamp });
    client.injectDirectoryFrame(sessionIdHex, frame);

    // receiveMessage must return the lifecycle event immediately — no waiting for timeout
    const msg = client.receiveMessage(sessionIdHex);
    expect(msg).not.toBeNull();
    expect(msg!.type).toBe("session_sealed");
    if (msg!.type === "session_sealed") {
      expect(Buffer.from(msg!.sealedRoot).toString("hex")).toBe(Buffer.from(sealedRoot).toString("hex"));
      expect(msg!.closeTimestamp).toBe(closeTimestamp);
      expect(msg!.checkpointStatus).toBe("pending");
    }
  }, 5000);
});

// ─── SI-001: session_sealed for S not consumed by receive(S2) ─────────────────

describe("SI-001: session_sealed for S not delivered to receive(S2)", () => {
  it("SI-001: adversarial — injectDirectoryFrame session_sealed on S1 does not appear in receiveMessage(S2)", async () => {
    const { client, stopAll } = await makeClient();
    scope.addCleanup(stopAll);

    const dirKp = generateKeypair();
    const dirPubkey = await dirKp.getPublicKey();

    const sessionId1 = new Uint8Array(32).fill(0x11);
    const sessionId2 = new Uint8Array(32).fill(0x22);
    const s1Hex = Buffer.from(sessionId1).toString("hex");
    const s2Hex = Buffer.from(sessionId2).toString("hex");
    const sealedRoot = new Uint8Array(32).fill(0xCC);
    const closeTimestamp = Date.now();

    client.injectTestSession(s1Hex, sessionId1, "a".repeat(64), dirPubkey, "active");
    client.injectTestSession(s2Hex, sessionId2, "a".repeat(64), dirPubkey, "active");

    // Inject session_sealed on S1 only
    const frame = await buildSignedSealFrame({ dirKp, sessionId: sessionId1, sealedRoot, closeTimestamp });
    client.injectDirectoryFrame(s1Hex, frame);

    // Adversarial condition: receiveMessage(S2) must NOT return the S1 lifecycle event
    const s2msg = client.receiveMessage(s2Hex);
    expect(s2msg).toBeNull();

    // receiveMessage(S1) must return it
    const s1msg = client.receiveMessage(s1Hex);
    expect(s1msg).not.toBeNull();
    expect(s1msg!.type).toBe("session_sealed");
  }, 5000);
});

// ─── SI-002: sealed_root matches listSessions() ───────────────────────────────

describe("SI-002: sealed_root in session_sealed event matches listSessions() record", () => {
  it("SI-002: adversarial — sealed_root comes from signed directory frame, equals listSessions() record", async () => {
    const { client, stopAll } = await makeClient();
    scope.addCleanup(stopAll);

    const dirKp = generateKeypair();
    const dirPubkey = await dirKp.getPublicKey();
    const sessionId = new Uint8Array(32).fill(0x55);
    const sessionIdHex = Buffer.from(sessionId).toString("hex");
    const sealedRoot = new Uint8Array(32).fill(0xDD);
    const closeTimestamp = Date.now();

    client.injectTestSession(sessionIdHex, sessionId, "a".repeat(64), dirPubkey, "active");

    const frame = await buildSignedSealFrame({ dirKp, sessionId, sealedRoot, closeTimestamp });
    client.injectDirectoryFrame(sessionIdHex, frame);

    const msg = client.receiveMessage(sessionIdHex);
    expect(msg).not.toBeNull();
    expect(msg!.type).toBe("session_sealed");
    if (msg!.type === "session_sealed") {
      // sealed_root in event must equal what listSessions() reports
      const sessions = client.listSessions();
      const record = sessions.find(s => Buffer.from(s.session_id).toString("hex") === sessionIdHex);
      expect(record).toBeDefined();
      expect(Buffer.from(record!.sealed_root!).toString("hex")).toBe(
        Buffer.from(msg!.sealedRoot).toString("hex")
      );
      // Both equal the original sealedRoot from the directory-signed frame
      expect(Buffer.from(msg!.sealedRoot).toString("hex")).toBe(
        Buffer.from(sealedRoot).toString("hex")
      );
    }
  }, 5000);
});

// ─── AC-001: other_sessions_pending hint ─────────────────────────────────────

describe("AC-001: receiveSessionMessageAsync on S1 includes other_sessions_pending when S2 has queued messages", () => {
  it("AC-001: S2 queued message causes other_sessions_pending: [S2] in receiveSessionMessageAsync(S1) result", async () => {
    const { client, stopAll } = await makeClient();
    scope.addCleanup(stopAll);

    const dirKp = generateKeypair();
    const dirPubkey = await dirKp.getPublicKey();

    const sessionId1 = new Uint8Array(32).fill(0x01);
    const sessionId2 = new Uint8Array(32).fill(0x02);
    const s1Hex = Buffer.from(sessionId1).toString("hex");
    const s2Hex = Buffer.from(sessionId2).toString("hex");

    client.injectTestSession(s1Hex, sessionId1, "a".repeat(64), dirPubkey, "active");
    client.injectTestSession(s2Hex, sessionId2, "a".repeat(64), dirPubkey, "active");

    // Enqueue session_sealed on S2 first
    const frame2 = await buildSignedSealFrame({
      dirKp,
      sessionId: sessionId2,
      sealedRoot: new Uint8Array(32).fill(0x02),
      closeTimestamp: Date.now(),
    });
    client.injectDirectoryFrame(s2Hex, frame2);

    // Also enqueue session_sealed on S1
    const frame1 = await buildSignedSealFrame({
      dirKp,
      sessionId: sessionId1,
      sealedRoot: new Uint8Array(32).fill(0x01),
      closeTimestamp: Date.now(),
    });
    client.injectDirectoryFrame(s1Hex, frame1);

    // receiveSessionMessageAsync(S1) should return S1's message AND include other_sessions_pending: [S2]
    const msg = await client.receiveSessionMessageAsync(s1Hex, 2000);
    expect(msg).not.toBeNull();
    expect(msg!.type).toBe("session_sealed");
    expect(msg!.otherSessionsPending).toEqual([s2Hex]);

    // Subsequent receiveMessage(S2) should return the S2 message
    const msg2 = client.receiveMessage(s2Hex);
    expect(msg2).not.toBeNull();
    expect(msg2!.type).toBe("session_sealed");
  }, 5000);
});

// ─── AC-002: receiveMessageAsync (any-session) returns session_id + other_sessions_pending ──

describe("AC-002: receiveMessageAsync (any-session) with two queued sessions", () => {
  it("AC-002: returns session_id and other_sessions_pending; second call returns remaining session", async () => {
    const { client, stopAll } = await makeClient();
    scope.addCleanup(stopAll);

    const dirKp = generateKeypair();
    const dirPubkey = await dirKp.getPublicKey();

    const sessionId1 = new Uint8Array(32).fill(0x03);
    const sessionId2 = new Uint8Array(32).fill(0x04);
    const s1Hex = Buffer.from(sessionId1).toString("hex");
    const s2Hex = Buffer.from(sessionId2).toString("hex");

    client.injectTestSession(s1Hex, sessionId1, "a".repeat(64), dirPubkey, "active");
    client.injectTestSession(s2Hex, sessionId2, "a".repeat(64), dirPubkey, "active");

    // Enqueue messages on both sessions
    for (const [sid, sidHex, fill] of [
      [sessionId1, s1Hex, 0x10],
      [sessionId2, s2Hex, 0x11],
    ] as [Uint8Array, string, number][]) {
      const frame = await buildSignedSealFrame({
        dirKp,
        sessionId: sid,
        sealedRoot: new Uint8Array(32).fill(fill),
        closeTimestamp: Date.now(),
      });
      client.injectDirectoryFrame(sidHex, frame);
    }

    // First receiveMessageAsync (any-session): returns one session's message + other in pending
    const result1 = await client.receiveMessageAsync(2000);
    expect(result1.type).not.toBe("timeout");
    if (result1.type !== "timeout") {
      expect(typeof result1.sessionIdHex).toBe("string");
      expect([s1Hex, s2Hex]).toContain(result1.sessionIdHex);
      expect(result1.otherSessionsPending).toHaveLength(1);
    }

    // Second call: returns the other session's message
    const result2 = await client.receiveMessageAsync(2000);
    expect(result2.type).not.toBe("timeout");
    if (result2.type !== "timeout" && result1.type !== "timeout") {
      expect(result2.sessionIdHex).not.toBe(result1.sessionIdHex);
    }
  }, 5000);
});

// ─── AC-003: blocked receiveSessionMessageAsync wakes on session_sealed ───────

describe("AC-003: blocked receiveSessionMessageAsync wakes when session_sealed arrives via directory stream", () => {
  it("AC-003: returns { type: 'session_sealed' } when directory pushes seal while call is blocked", async () => {
    const { client, stopAll } = await makeClient();
    scope.addCleanup(stopAll);

    const dirKp = generateKeypair();
    const dirPubkey = await dirKp.getPublicKey();
    const sessionId = new Uint8Array(32).fill(0xA3);
    const sessionIdHex = Buffer.from(sessionId).toString("hex");
    const sealedRoot = new Uint8Array(32).fill(0xF0);
    const closeTimestamp = Date.now() + 100;

    client.injectTestSession(sessionIdHex, sessionId, "a".repeat(64), dirPubkey, "active");

    // Start blocked receive BEFORE injecting the frame
    const receivePromise = client.receiveSessionMessageAsync(sessionIdHex, 5000);

    // Inject the seal frame asynchronously after the call is blocked
    buildSignedSealFrame({ dirKp, sessionId, sealedRoot, closeTimestamp }).then(frame => {
      // Inject after event loop tick to ensure receive is blocked first
      setTimeout(() => {
        client.injectDirectoryFrame(sessionIdHex, frame);
      }, 30);
    });

    const msg = await receivePromise;
    expect(msg).not.toBeNull();
    expect(msg!.type).toBe("session_sealed");
    if (msg!.type === "session_sealed") {
      expect(Buffer.from(msg!.sealedRoot).toString("hex")).toBe(Buffer.from(sealedRoot).toString("hex"));
      expect(msg!.closeTimestamp).toBe(closeTimestamp);
      expect(msg!.checkpointStatus).toBe("pending");
    }
  }, 8000);
});

// ─── AC-004: blocked receiveMessageAsync (any-session) wakes on session_sealed ─

describe("AC-004: blocked receiveMessageAsync (any-session) wakes on session_sealed; S2 unaffected", () => {
  it("AC-004: returns session_sealed for S1 while S2 remains active and receivable", async () => {
    const { client, stopAll } = await makeClient();
    scope.addCleanup(stopAll);

    const dirKp = generateKeypair();
    const dirPubkey = await dirKp.getPublicKey();
    const sessionId1 = new Uint8Array(32).fill(0xA4);
    const sessionId2 = new Uint8Array(32).fill(0xA5);
    const s1Hex = Buffer.from(sessionId1).toString("hex");
    const s2Hex = Buffer.from(sessionId2).toString("hex");
    const sealedRoot = new Uint8Array(32).fill(0xF1);
    const closeTimestamp = Date.now() + 100;

    client.injectTestSession(s1Hex, sessionId1, "a".repeat(64), dirPubkey, "active");
    client.injectTestSession(s2Hex, sessionId2, "a".repeat(64), dirPubkey, "active");

    // Start blocked receive BEFORE injecting the frame
    const receivePromise = client.receiveMessageAsync(5000);

    // Inject seal for S1 asynchronously
    buildSignedSealFrame({ dirKp, sessionId: sessionId1, sealedRoot, closeTimestamp }).then(frame => {
      setTimeout(() => {
        client.injectDirectoryFrame(s1Hex, frame);
      }, 30);
    });

    const result = await receivePromise;
    expect(result.type).not.toBe("timeout");
    if (result.type !== "timeout") {
      expect(result.type).toBe("session_sealed");
      expect(result.sessionIdHex).toBe(s1Hex);
    }

    // S2 session record is still active — not sealed
    const sessions = client.listSessions();
    const s2Record = sessions.find(s => Buffer.from(s.session_id).toString("hex") === s2Hex);
    expect(s2Record).toBeDefined();
    expect(s2Record!.status).toBe("active");
  }, 8000);
});

// ─── AC-007: cello-chat.md documentation ──────────────────────────────────────

describe("AC-007: cello-chat.md documents session_sealed inline and removes workarounds", () => {
  it("AC-007: cello-chat.md contains session_sealed type, cello_close_session is initiating-party-only, no session_not_active workaround", () => {
    const chatMdPath = resolve(
      __dirname,
      "../../../../.claude/commands/cello-chat.md"
    );
    const chatMd = readFileSync(chatMdPath, "utf8");

    // Agent B's Step 5 describes receiving { type: 'session_sealed' }
    expect(chatMd).toContain("session_sealed");

    // Documents cello_close_session as initiating-party-only tool
    expect(chatMd).toContain("initiating-party");

    // Old workaround text is removed: the old "seal_rejected, reason: session_not_active" fallback
    expect(chatMd).not.toContain("session_not_active");
  });
});

// ─── MCP layer: cello_receive_session returns session_sealed inline ───────────

describe("MCP: cello_receive_session surfaces session_sealed inline", () => {
  it("MCP cello_receive_session returns { type: 'session_sealed', session_id, sealed_root, close_timestamp, checkpoint_status } when lifecycle event is queued", async () => {
    const kp = generateKeypair();
    const node = await createNode({ keyProvider: kp, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await node.start();
    scope.addCleanup(async () => { try { await node.stop(); } catch {} });

    const celloClient = createClient(node, kp) as unknown as TestClient;
    await celloClient.registerHandler();

    const server = createMcpSessionServer(node, celloClient as unknown as CelloClient, kp);
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    const mcpClient = new Client({ name: "test", version: "0.0.1" });
    await mcpClient.connect(clientTransport);

    // Mark transport started
    await mcpClient.callTool({ name: "cello_status", arguments: {} });

    // Set up session and inject session_sealed event
    const dirKp = generateKeypair();
    const dirPubkey = await dirKp.getPublicKey();
    const sessionId = new Uint8Array(32).fill(0xBE);
    const sessionIdHex = Buffer.from(sessionId).toString("hex");
    const sealedRoot = new Uint8Array(32).fill(0xEF);
    const closeTimestamp = Date.now();

    celloClient.injectTestSession(sessionIdHex, sessionId, "a".repeat(64), dirPubkey, "active");

    const frame = await buildSignedSealFrame({ dirKp, sessionId, sealedRoot, closeTimestamp });
    celloClient.injectDirectoryFrame(sessionIdHex, frame);

    // cello_receive_session should return session_sealed immediately without polling
    const result = await mcpClient.callTool({
      name: "cello_receive_session",
      arguments: { session_id: sessionIdHex, timeout_ms: 1000 },
    });

    const text = (result.content as Array<{ type: string; text: string }>)
      .find((c) => c.type === "text")?.text;
    expect(text).toBeDefined();
    const parsed = JSON.parse(text!);
    expect(parsed.type).toBe("session_sealed");
    expect(parsed.session_id).toBe(sessionIdHex);
    expect(typeof parsed.sealed_root).toBe("string");
    expect(typeof parsed.close_timestamp).toBe("number");
    expect(parsed.checkpoint_status).toBe("pending");

    await mcpClient.close();
    await server.close();
  }, 10000);
});

// ─── MCP layer: cello_receive (any-session) tool ─────────────────────────────

describe("MCP: cello_receive (any-session) tool", () => {
  it("MCP cello_receive (any-session) returns { type: 'timeout' } when no messages arrive", async () => {
    const kp = generateKeypair();
    const node = await createNode({ keyProvider: kp, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await node.start();
    scope.addCleanup(async () => { try { await node.stop(); } catch {} });

    const celloClient = createClient(node, kp) as unknown as CelloClient;
    await celloClient.registerHandler();

    const server = createMcpSessionServer(node, celloClient, kp);
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    const mcpClient = new Client({ name: "test", version: "0.0.1" });
    await mcpClient.connect(clientTransport);

    await mcpClient.callTool({ name: "cello_status", arguments: {} });

    const result = await mcpClient.callTool({
      name: "cello_receive",
      arguments: { timeout_ms: 50 },
    });

    const text = (result.content as Array<{ type: string; text: string }>)
      .find((c) => c.type === "text")?.text;
    expect(text).toBeDefined();
    const parsed = JSON.parse(text!);
    expect(parsed.type).toBe("timeout");

    await mcpClient.close();
    await server.close();
  }, 5000);

  it("MCP cello_receive (any-session) includes session_id in response when message is available", async () => {
    const kp = generateKeypair();
    const node = await createNode({ keyProvider: kp, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await node.start();
    scope.addCleanup(async () => { try { await node.stop(); } catch {} });

    const celloClient = createClient(node, kp) as unknown as TestClient;
    await celloClient.registerHandler();

    const server = createMcpSessionServer(node, celloClient as unknown as CelloClient, kp);
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    const mcpClient = new Client({ name: "test", version: "0.0.1" });
    await mcpClient.connect(clientTransport);

    await mcpClient.callTool({ name: "cello_status", arguments: {} });

    // Set up session with a queued session_sealed event
    const dirKp = generateKeypair();
    const dirPubkey = await dirKp.getPublicKey();
    const sessionId = new Uint8Array(32).fill(0xCA);
    const sessionIdHex = Buffer.from(sessionId).toString("hex");
    const sealedRoot = new Uint8Array(32).fill(0xFE);
    const closeTimestamp = Date.now();

    celloClient.injectTestSession(sessionIdHex, sessionId, "a".repeat(64), dirPubkey, "active");

    const frame = await buildSignedSealFrame({ dirKp, sessionId, sealedRoot, closeTimestamp });
    celloClient.injectDirectoryFrame(sessionIdHex, frame);

    const result = await mcpClient.callTool({
      name: "cello_receive",
      arguments: { timeout_ms: 1000 },
    });

    const text = (result.content as Array<{ type: string; text: string }>)
      .find((c) => c.type === "text")?.text;
    expect(text).toBeDefined();
    const parsed = JSON.parse(text!);
    expect(parsed.type).toBe("session_sealed");
    // session_id must be included so caller knows which session
    expect(parsed.session_id).toBe(sessionIdHex);

    await mcpClient.close();
    await server.close();
  }, 10000);
});

// ─── Unit: other_sessions_pending with multiple queued sessions ───────────────

describe("Unit: other_sessions_pending computed correctly across three sessions", () => {
  it("other_sessions_pending includes all sessions with queued messages, excludes current session", async () => {
    const { client, stopAll } = await makeClient();
    scope.addCleanup(stopAll);

    const dirKp = generateKeypair();
    const dirPubkey = await dirKp.getPublicKey();

    // Three sessions: S1, S2, S3
    const sessionIds = [
      new Uint8Array(32).fill(0x21),
      new Uint8Array(32).fill(0x22),
      new Uint8Array(32).fill(0x23),
    ];
    const hexes = sessionIds.map(s => Buffer.from(s).toString("hex"));

    for (let i = 0; i < 3; i++) {
      client.injectTestSession(hexes[i]!, sessionIds[i]!, "a".repeat(64), dirPubkey, "active");
    }

    // Enqueue session_sealed on all three
    for (let i = 0; i < 3; i++) {
      const frame = await buildSignedSealFrame({
        dirKp,
        sessionId: sessionIds[i]!,
        sealedRoot: new Uint8Array(32).fill(0x30 + i),
        closeTimestamp: Date.now(),
      });
      client.injectDirectoryFrame(hexes[i]!, frame);
    }

    // receiveSessionMessageAsync(S1) — S2 and S3 have pending messages
    const msg = await client.receiveSessionMessageAsync(hexes[0]!, 2000);
    expect(msg).not.toBeNull();
    const pending = msg!.otherSessionsPending ?? [];
    expect(pending).toContain(hexes[1]!);
    expect(pending).toContain(hexes[2]!);
    expect(pending).not.toContain(hexes[0]!);
  }, 8000);
});
