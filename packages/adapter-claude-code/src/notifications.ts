import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/**
 * Push a claude/channel wake-up notification to the connected Claude Code session.
 * Content is never included — the agent calls cello_receive to retrieve the message.
 * SI-001: notification payload contains only type and sender pubkey.
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
