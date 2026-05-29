/**
 * CELLO-DEMO-001 — Demo Agent Unit Tests
 *
 * Specification (from story YAML):
 *
 * AC-002b: Two separate sessions track position independently — no cross-session
 *   contamination. Per-session state is keyed by session_id.
 *
 * AC-002c: A session that has received the sign-off (message 4) responds to a
 *   fifth message with the sealed-session message. cello_close_session is NOT
 *   called a second time.
 *
 * SI-002: The receive handler must not pass message content to any logger or
 *   storage. Only session_id and senderAgentId are logged. The hardcoded
 *   response is selected by position integer, never by inspecting message content.
 *
 * Verbatim message correctness: Each of the 4 messages must match the story YAML
 *   exactly — verified character-for-character.
 *
 * Test approach: The session state machine (handleMessage) is extracted from the
 * main loop as a pure function with injected dependencies. This allows unit testing
 * without a live MCP server or network connection.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  DEMO_MESSAGES,
  SEALED_SESSION_MESSAGE,
  createSessionState,
  handleMessage,
  type SessionState,
  type DemoLogger,
  type DemoMcpClient,
} from "../message-handler.js";

// ─── Verbatim message constants ────────────────────────────────────────────────

describe("Verbatim message sequence (story YAML spec)", () => {
  it("message 1 matches story YAML exactly", () => {
    expect(DEMO_MESSAGES[0]).toBe(
      "Welcome to CELLO. I am the demo agent — a simple Node.js process with no LLM attached. Each message you send will trigger the next response in a hardcoded sequence of 4. This sequence is designed to let you verify the protocol end-to-end. Send your next message to continue."
    );
  });

  it("message 2 matches story YAML exactly", () => {
    expect(DEMO_MESSAGES[1]).toBe(
      "Message 2 of 4. Your messages arrive end-to-end encrypted — I never see them in plaintext, only that a message was received. The protocol uses Noise XX for encryption and a tamper-evident hash chain links every message in this session. Send your next message to continue."
    );
  });

  it("message 3 matches story YAML exactly", () => {
    expect(DEMO_MESSAGES[2]).toBe(
      "Message 3 of 4. This conversation has been building a cryptographic audit trail since your first message. Each message hash is linked to the previous one. When we close, you will be able to retrieve a sealed receipt — a tamper-evident proof of everything exchanged. Send your final message to trigger sign-off."
    );
  });

  it("message 4 matches story YAML exactly", () => {
    expect(DEMO_MESSAGES[3]).toBe(
      "Message 4 of 4 — sign-off. The demo is complete. Call cello_get_sealed_receipt() to retrieve the cryptographic proof of this conversation. The receipt contains your message hashes, the Merkle root, and a directory-signed checkpoint. Welcome to CELLO."
    );
  });

  it("sealed session message matches story YAML exactly", () => {
    expect(SEALED_SESSION_MESSAGE).toBe(
      "This session has completed the demo sequence and been sealed. Start a new session to run the demo again."
    );
  });
});

// ─── AC-002b: Independent per-session position tracking ───────────────────────

describe("AC-002b: per-session position tracking — no cross-session contamination", () => {
  let sessions: Map<string, SessionState>;
  let mockClient: DemoMcpClient;
  let mockLogger: DemoLogger;

  beforeEach(() => {
    sessions = new Map();
    mockClient = {
      send: vi.fn().mockResolvedValue({ delivered: true }),
      closeSession: vi.fn().mockResolvedValue({ closed: true }),
    };
    mockLogger = {
      info: vi.fn(),
      error: vi.fn(),
    };
  });

  it("session A receiving message 3 gets message 3 of 4 regardless of session B position", async () => {
    const sessionA = "aaaaaa";
    const sessionB = "bbbbbb";

    // Session B receives 2 messages first
    await handleMessage({ sessionId: sessionB, senderAgentId: "sender-b", sessions, client: mockClient, logger: mockLogger });
    await handleMessage({ sessionId: sessionB, senderAgentId: "sender-b", sessions, client: mockClient, logger: mockLogger });
    // Session B is now at position 2 (next = message 3)

    // Session A receives 2 messages
    await handleMessage({ sessionId: sessionA, senderAgentId: "sender-a", sessions, client: mockClient, logger: mockLogger });
    await handleMessage({ sessionId: sessionA, senderAgentId: "sender-a", sessions, client: mockClient, logger: mockLogger });
    // Session A is now at position 2 (next = message 3)

    // Session A receives its 3rd message — should get message 3 of 4
    const sendCalls = (mockClient.send as ReturnType<typeof vi.fn>).mock.calls;
    // Check the most recent send call for sessionA
    const sessionASends = sendCalls.filter((call) => call[0] === sessionA);
    expect(sessionASends).toHaveLength(2);

    // Now send the 3rd message to session A
    await handleMessage({ sessionId: sessionA, senderAgentId: "sender-a", sessions, client: mockClient, logger: mockLogger });

    const allSends = (mockClient.send as ReturnType<typeof vi.fn>).mock.calls;
    const sessionASendsAfter = allSends.filter((call) => call[0] === sessionA);
    expect(sessionASendsAfter).toHaveLength(3);
    // The 3rd send to session A should be message 3 of 4 (index 2)
    expect(sessionASendsAfter[2]![1]).toBe(DEMO_MESSAGES[2]);
  });

  it("each new session starts at message 1", async () => {
    sessions = new Map();
    const sessionX = "session-x-111";
    const sessionY = "session-y-222";

    await handleMessage({ sessionId: sessionX, senderAgentId: "sx", sessions, client: mockClient, logger: mockLogger });
    await handleMessage({ sessionId: sessionY, senderAgentId: "sy", sessions, client: mockClient, logger: mockLogger });

    const sendCalls = (mockClient.send as ReturnType<typeof vi.fn>).mock.calls;
    const xSends = sendCalls.filter((c) => c[0] === sessionX);
    const ySends = sendCalls.filter((c) => c[0] === sessionY);

    // Both sessions should get message 1 for their first message
    expect(xSends[0]![1]).toBe(DEMO_MESSAGES[0]);
    expect(ySends[0]![1]).toBe(DEMO_MESSAGES[0]);
  });

  it("session B at position 3 does not affect session A at position 1", async () => {
    const sessionA = "session-a-001";
    const sessionB = "session-b-002";

    // Advance session B to position 3 (3 messages in)
    for (let i = 0; i < 3; i++) {
      await handleMessage({ sessionId: sessionB, senderAgentId: "sb", sessions, client: mockClient, logger: mockLogger });
    }

    // Session A sends first message — must get message 1
    await handleMessage({ sessionId: sessionA, senderAgentId: "sa", sessions, client: mockClient, logger: mockLogger });

    const sendCalls = (mockClient.send as ReturnType<typeof vi.fn>).mock.calls;
    const aSends = sendCalls.filter((c) => c[0] === sessionA);
    expect(aSends[0]![1]).toBe(DEMO_MESSAGES[0]);
  });
});

// ─── AC-002c: Post sign-off behavior ─────────────────────────────────────────

describe("AC-002c: post-sign-off — sealed session response, no second close", () => {
  let sessions: Map<string, SessionState>;
  let mockClient: DemoMcpClient;
  let mockLogger: DemoLogger;

  beforeEach(() => {
    sessions = new Map();
    mockClient = {
      send: vi.fn().mockResolvedValue({ delivered: true }),
      closeSession: vi.fn().mockResolvedValue({ closed: true }),
    };
    mockLogger = {
      info: vi.fn(),
      error: vi.fn(),
    };
  });

  it("fifth message after sign-off gets sealed-session response", async () => {
    const sessionId = "sealed-session-001";

    // Send all 4 messages to reach sign-off
    for (let i = 0; i < 4; i++) {
      await handleMessage({ sessionId, senderAgentId: "test-agent", sessions, client: mockClient, logger: mockLogger });
    }

    // Send a 5th message
    await handleMessage({ sessionId, senderAgentId: "test-agent", sessions, client: mockClient, logger: mockLogger });

    const sendCalls = (mockClient.send as ReturnType<typeof vi.fn>).mock.calls;
    const sessionSends = sendCalls.filter((c) => c[0] === sessionId);
    expect(sessionSends).toHaveLength(5);
    // The 5th send must be the sealed-session message
    expect(sessionSends[4]![1]).toBe(SEALED_SESSION_MESSAGE);
  });

  it("cello_close_session is called exactly once (after message 4), not after message 5+", async () => {
    const sessionId = "sealed-session-002";

    // Send 4 messages — triggers close after message 4
    for (let i = 0; i < 4; i++) {
      await handleMessage({ sessionId, senderAgentId: "test-agent", sessions, client: mockClient, logger: mockLogger });
    }

    // Verify close was called exactly once
    expect(mockClient.closeSession).toHaveBeenCalledTimes(1);
    expect(mockClient.closeSession).toHaveBeenCalledWith(sessionId);

    // Send a 5th message — close must NOT be called again
    await handleMessage({ sessionId, senderAgentId: "test-agent", sessions, client: mockClient, logger: mockLogger });
    expect(mockClient.closeSession).toHaveBeenCalledTimes(1);

    // Send a 6th message — close must still not be called again
    await handleMessage({ sessionId, senderAgentId: "test-agent", sessions, client: mockClient, logger: mockLogger });
    expect(mockClient.closeSession).toHaveBeenCalledTimes(1);
  });
});

// ─── SI-002: Message content never logged ─────────────────────────────────────

describe("SI-002: message content is never passed to logger or storage", () => {
  let sessions: Map<string, SessionState>;
  let mockClient: DemoMcpClient;
  let loggerInfoCalls: Array<[string, Record<string, unknown>]>;
  let loggerErrorCalls: Array<[string, Record<string, unknown>]>;

  beforeEach(() => {
    sessions = new Map();
    loggerInfoCalls = [];
    loggerErrorCalls = [];
    mockClient = {
      send: vi.fn().mockResolvedValue({ delivered: true }),
      closeSession: vi.fn().mockResolvedValue({ closed: true }),
    };
  });

  it("receive handler only logs session_id and senderAgentId — never message content", async () => {
    const mockLogger: DemoLogger = {
      info: vi.fn((event: string, ctx: Record<string, unknown>) => {
        loggerInfoCalls.push([event, ctx]);
      }),
      error: vi.fn((event: string, ctx: Record<string, unknown>) => {
        loggerErrorCalls.push([event, ctx]);
      }),
    };

    const sessionId = "si-002-test-session";
    const senderAgentId = "si-002-sender";
    // The message content that handleMessage should NEVER see or log
    // handleMessage doesn't receive content — it only receives sessionId and senderAgentId
    await handleMessage({ sessionId, senderAgentId, sessions, client: mockClient, logger: mockLogger });

    // Verify demo.message.received was logged
    const receivedEvent = loggerInfoCalls.find(([event]) => event === "demo.message.received");
    expect(receivedEvent).toBeDefined();

    // Verify the log context only has sessionId and senderAgentId
    const [, ctx] = receivedEvent!;
    expect(ctx).toHaveProperty("sessionId", sessionId);
    expect(ctx).toHaveProperty("senderAgentId", senderAgentId);
    // Must NOT have any content field
    expect(ctx).not.toHaveProperty("content");
    expect(ctx).not.toHaveProperty("message");
    expect(ctx).not.toHaveProperty("text");
    expect(ctx).not.toHaveProperty("body");
  });

  it("demo.response.sent is logged with recipientAgentId and sessionId only", async () => {
    const mockLogger: DemoLogger = {
      info: vi.fn((event: string, ctx: Record<string, unknown>) => {
        loggerInfoCalls.push([event, ctx]);
      }),
      error: vi.fn(),
    };

    const sessionId = "si-002-response-session";
    const senderAgentId = "si-002-responder";
    await handleMessage({ sessionId, senderAgentId, sessions, client: mockClient, logger: mockLogger });

    const sentEvent = loggerInfoCalls.find(([event]) => event === "demo.response.sent");
    expect(sentEvent).toBeDefined();

    const [, ctx] = sentEvent!;
    expect(ctx).toHaveProperty("sessionId", sessionId);
    expect(ctx).toHaveProperty("recipientAgentId", senderAgentId);
    expect(ctx).not.toHaveProperty("content");
    expect(ctx).not.toHaveProperty("response");
  });
});

// ─── Full 4-message sequence correctness ──────────────────────────────────────

describe("Full 4-message sequence delivers correct canned responses", () => {
  it("delivers messages 1 through 4 in order and closes after message 4", async () => {
    const sessions = new Map<string, SessionState>();
    const mockClient: DemoMcpClient = {
      send: vi.fn().mockResolvedValue({ delivered: true }),
      closeSession: vi.fn().mockResolvedValue({ closed: true }),
    };
    const mockLogger: DemoLogger = {
      info: vi.fn(),
      error: vi.fn(),
    };
    const sessionId = "full-sequence-test";
    const senderAgentId = "test-stranger";

    for (let i = 0; i < 4; i++) {
      await handleMessage({ sessionId, senderAgentId, sessions, client: mockClient, logger: mockLogger });
    }

    const sendCalls = (mockClient.send as ReturnType<typeof vi.fn>).mock.calls;
    expect(sendCalls).toHaveLength(4);

    for (let i = 0; i < 4; i++) {
      expect(sendCalls[i]![0]).toBe(sessionId);
      expect(sendCalls[i]![1]).toBe(DEMO_MESSAGES[i]);
    }

    // cello_close_session called once after message 4
    expect(mockClient.closeSession).toHaveBeenCalledTimes(1);
    expect(mockClient.closeSession).toHaveBeenCalledWith(sessionId);
  });
});

// ─── createSessionState helper ─────────────────────────────────────────────────

describe("createSessionState initializes position to 0", () => {
  it("returns a session state with position 0 and sealed false", () => {
    const state = createSessionState();
    expect(state.position).toBe(0);
    expect(state.sealed).toBe(false);
  });
});
