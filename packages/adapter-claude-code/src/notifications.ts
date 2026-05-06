import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/**
 * Push a claude/channel wake-up notification to the connected Claude Code session.
 * Content is never included — the agent calls cello_receive to retrieve the message.
 * SI-001 (ADAPTER-001): notification payload contains only type and sender pubkey.
 */
export async function pushChannelNotification(server: McpServer, from: string): Promise<void> {
  try {
    await server.server.notification({
      method: "notifications/claude/channel",
      params: { type: "cello_message", from },
    });
  } catch {
    // Transport may not be connected or may have closed — silently swallow
  }
}

/**
 * Push a cello_session_request claude/channel notification to the connected Claude Code session.
 * Carries only counterparty pubkey and session_id — no content, no multiaddrs, no trust data.
 * SI-001 (ADAPTER-002): notification payload contains exactly type, from, and session_id.
 * The agent calls cello_await_session to retrieve the full session details.
 */
export async function pushSessionRequestNotification(
  server: McpServer,
  from: string,
  sessionId: string,
): Promise<void> {
  try {
    await server.server.notification({
      method: "notifications/claude/channel",
      params: { type: "cello_session_request", from, session_id: sessionId },
    });
  } catch {
    // Transport may not be connected or may have closed — silently swallow
  }
}
