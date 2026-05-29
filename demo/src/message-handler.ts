/**
 * CELLO-DEMO-001 — Message Handler
 *
 * Pure session state machine for the demo agent's 4-message sequence.
 * Extracted from the main loop to allow unit testing without a live MCP
 * server or network connection.
 *
 * PSEUDOCODE (Phase P — DEMO-001):
 *
 *   handleMessage({ sessionId, senderAgentId, sessions, client, logger }):
 *     1. Lookup or create session state from Map<string, SessionState>
 *     2. Log demo.message.received { senderAgentId, sessionId } — never content
 *     3. If session.sealed:
 *        a. Send SEALED_SESSION_MESSAGE
 *        b. Log demo.response.sent { recipientAgentId: senderAgentId, sessionId }
 *        c. Return — do NOT call closeSession again
 *     4. response = DEMO_MESSAGES[session.position]
 *     5. Send response
 *     6. Log demo.response.sent { recipientAgentId: senderAgentId, sessionId }
 *     7. session.position++
 *     8. If session.position === 4:
 *        a. session.sealed = true
 *        b. Call client.closeSession(sessionId)
 *
 * Security invariant (SI-002): handleMessage never receives message content.
 * The caller (main loop) receives the message, extracts only session_id and
 * sender_pubkey, then calls handleMessage. Content is discarded at the boundary.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SessionState {
  /** 0-indexed position in the 4-message sequence */
  position: number;
  /** True after message 4 has been sent and cello_close_session called */
  sealed: boolean;
}

export interface DemoLogger {
  info(event: string, ctx: Record<string, unknown>): void;
  error(event: string, ctx: Record<string, unknown>): void;
}

export interface DemoMcpClient {
  send(sessionId: string, content: string): Promise<{ delivered: boolean }>;
  closeSession(sessionId: string): Promise<{ closed: boolean }>;
}

export interface HandleMessageArgs {
  sessionId: string;
  senderAgentId: string;
  sessions: Map<string, SessionState>;
  client: DemoMcpClient;
  logger: DemoLogger;
}

// ─── Verbatim message sequence (copied exactly from story YAML) ───────────────

export const DEMO_MESSAGES: readonly [string, string, string, string] = [
  "Welcome to CELLO. I am the demo agent — a simple Node.js process with no LLM attached. Each message you send will trigger the next response in a hardcoded sequence of 4. This sequence is designed to let you verify the protocol end-to-end. Send your next message to continue.",
  "Message 2 of 4. Your messages arrive end-to-end encrypted — I never see them in plaintext, only that a message was received. The protocol uses Noise XX for encryption and a tamper-evident hash chain links every message in this session. Send your next message to continue.",
  "Message 3 of 4. This conversation has been building a cryptographic audit trail since your first message. Each message hash is linked to the previous one. When we close, you will be able to retrieve a sealed receipt — a tamper-evident proof of everything exchanged. Send your final message to trigger sign-off.",
  "Message 4 of 4 — sign-off. The demo is complete. Call cello_get_sealed_receipt() to retrieve the cryptographic proof of this conversation. The receipt contains your message hashes, the Merkle root, and a directory-signed checkpoint. Welcome to CELLO.",
];

export const SEALED_SESSION_MESSAGE =
  "This session has completed the demo sequence and been sealed. Start a new session to run the demo again.";

// ─── Session state factory ────────────────────────────────────────────────────

export function createSessionState(): SessionState {
  return { position: 0, sealed: false };
}

// ─── Message handler ──────────────────────────────────────────────────────────

/**
 * Handle one inbound message for a session.
 *
 * SI-002 enforcement: this function never receives message content.
 * Only session_id and senderAgentId are passed in. Content is discarded
 * at the MCP receive boundary in the main loop (index.ts).
 */
export async function handleMessage({
  sessionId,
  senderAgentId,
  sessions,
  client,
  logger,
}: HandleMessageArgs): Promise<void> {
  // Lookup or create session state
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, createSessionState());
  }
  const session = sessions.get(sessionId)!;

  // Log receipt — only session_id and senderAgentId, never message content (SI-002)
  logger.info("demo.message.received", { senderAgentId, sessionId });

  if (session.sealed) {
    // Session already completed the 4-message sequence — respond with sealed message
    await client.send(sessionId, SEALED_SESSION_MESSAGE);
    logger.info("demo.response.sent", { recipientAgentId: senderAgentId, sessionId });
    // Do NOT call closeSession again (AC-002c)
    return;
  }

  // Select response by position (never by inspecting message content — SI-002)
  const response = DEMO_MESSAGES[session.position]!;
  const { delivered } = await client.send(sessionId, response);
  logger.info("demo.response.sent", { recipientAgentId: senderAgentId, sessionId });

  // Only advance and seal after confirmed delivery — if send fails we leave the session
  // open so the peer can retry and receive the correct message (IMPORTANT-005)
  if (!delivered) {
    return;
  }

  session.position++;

  // After message 4 (position incremented to 4): seal and close
  if (session.position === 4) {
    session.sealed = true;
    await client.closeSession(sessionId);
  }
}
