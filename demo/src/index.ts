/**
 * CELLO-DEMO-001 — Demo Agent
 *
 * A standalone Node.js process that runs a CELLO agent responding to messages
 * with a hardcoded 4-message sequence. No LLM backend. No database. No HTTP server.
 *
 * PSEUDOCODE (Phase P — DEMO-001):
 *
 * Startup:
 *   1. Load identity from CELLO_KEY_FILE (default: ~/.cello/key)
 *   2. Spawn cello-mcp subprocess (from @cello-protocol/connect)
 *   3. Connect MCP client to subprocess via stdio transport
 *   4. Call cello_status → if not reachable, log demo.connection.failed + exit
 *   5. Log demo.started { agentId, directoryUrl }
 *   6. Start connection request loop (polls cello_await_connection_request)
 *   7. Start message loop (polls cello_receive)
 *
 * Connection request loop:
 *   - Poll cello_await_connection_request with 5s timeout
 *   - On pending_review: call cello_accept_connection
 *   - On timeout: continue polling
 *   - On error: log and continue
 *
 * Message loop:
 *   - Poll cello_receive with 5s timeout
 *   - On message: extract session_id and sender_pubkey (discard content — SI-002)
 *     → call handleMessage({ sessionId, senderAgentId, sessions, client, logger })
 *   - On timeout: continue polling
 *   - On session_sealed: clean up session state from Map
 *   - On error: log and continue
 *
 * Environment variables:
 *   CELLO_KEY_FILE              Path to Ed25519 key file (default: ~/.cello/key)
 *   CELLO_DIRECTORY_MULTIADDR   libp2p multiaddr of the directory (required)
 *   CELLO_ENV                   Deployment environment (default: production)
 *   CELLO_DB_PATH               Path to SQLCipher database (default: ~/.cello/client.db)
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  handleMessage,
  type SessionState,
  type DemoLogger,
  type DemoMcpClient,
} from "./message-handler.js";

// ─── Configuration ────────────────────────────────────────────────────────────

const KEY_FILE = process.env["CELLO_KEY_FILE"] ?? join(homedir(), ".cello", "key");
const DIRECTORY_MULTIADDR = process.env["CELLO_DIRECTORY_MULTIADDR"];
const CELLO_ENV = process.env["CELLO_ENV"] ?? "production";
const DB_PATH = process.env["CELLO_DB_PATH"] ?? join(homedir(), ".cello", "client.db");

// Derive the directory URL for logging from the multiaddr
const DIRECTORY_URL = DIRECTORY_MULTIADDR ?? "(not configured)";

// ─── Logger ───────────────────────────────────────────────────────────────────
// Structured JSON logger that writes to stderr. No console.log in implementation code.

function makeLogger(): DemoLogger {
  function write(level: string, event: string, ctx: Record<string, unknown>): void {
    const entry = JSON.stringify({ level, event, ...ctx, ts: new Date().toISOString() });
    process.stderr.write(entry + "\n");
  }
  return {
    info: (event, ctx) => write("info", event, ctx),
    error: (event, ctx) => write("error", event, ctx),
  };
}

const logger = makeLogger();

// ─── Parse JSON from MCP tool result ─────────────────────────────────────────

function parseToolResult(result: unknown): unknown {
  if (
    result &&
    typeof result === "object" &&
    "content" in result &&
    Array.isArray((result as { content: unknown[] }).content) &&
    (result as { content: { type: string; text: string }[] }).content[0]?.type === "text"
  ) {
    try {
      return JSON.parse((result as { content: { type: string; text: string }[] }).content[0]!.text);
    } catch {
      return null;
    }
  }
  return null;
}

// ─── MCP client wrapper ───────────────────────────────────────────────────────
// Implements DemoMcpClient for the message handler

function makeDemoMcpClient(mcpClient: Client, log: DemoLogger): DemoMcpClient {
  return {
    async send(sessionId: string, content: string): Promise<{ delivered: boolean }> {
      try {
        const result = await mcpClient.callTool({ name: "cello_send", arguments: { session_id: sessionId, content } });
        const parsed = parseToolResult(result) as { delivered?: boolean } | null;
        return { delivered: parsed?.delivered === true };
      } catch (err: unknown) {
        const reason = err instanceof Error ? err.message : String(err);
        log.error("demo.send.failed", { sessionId, reason });
        return { delivered: false };
      }
    },
    async closeSession(sessionId: string): Promise<{ closed: boolean }> {
      try {
        const result = await mcpClient.callTool({ name: "cello_close_session", arguments: { session_id: sessionId } });
        const parsed = parseToolResult(result) as { closed?: boolean } | null;
        return { closed: parsed?.closed === true };
      } catch (err: unknown) {
        const reason = err instanceof Error ? err.message : String(err);
        log.error("demo.close.failed", { sessionId, reason });
        return { closed: false };
      }
    },
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Per-session state: tracks position and sealed status for each active session
  const sessions = new Map<string, SessionState>();

  // Build environment for the cello-mcp subprocess
  const subprocessEnv: Record<string, string> = {
    ...process.env as Record<string, string>,
    CELLO_KEY_FILE: KEY_FILE,
    CELLO_ENV,
    CELLO_DB_PATH: DB_PATH,
  };
  if (DIRECTORY_MULTIADDR) {
    subprocessEnv["CELLO_DIRECTORY_MULTIADDR"] = DIRECTORY_MULTIADDR;
  }

  // Spawn cello-mcp from @cello-protocol/connect
  // The binary is at node_modules/.bin/cello-mcp (installed as part of @cello-protocol/connect)
  // Use fileURLToPath to avoid import.meta.dirname lib compatibility issues (LOW-002)
  const { fileURLToPath } = await import("node:url");
  const __dirname = fileURLToPath(new URL(".", import.meta.url));
  const celloMcpBin = join(__dirname, "..", "node_modules", ".bin", "cello-mcp");

  const transport = new StdioClientTransport({
    command: "node",
    args: [celloMcpBin],
    env: subprocessEnv,
  });

  const mcpClient = new Client({ name: "cello-demo-agent", version: "1.0.0" });

  try {
    await mcpClient.connect(transport);
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.error("demo.connection.failed", { reason, directoryUrl: DIRECTORY_URL, relayMultiaddr: DIRECTORY_MULTIADDR ?? "" });
    process.exit(1);
  }

  // Check status — verify we are registered and reachable
  let agentId: string;
  try {
    const statusResult = await mcpClient.callTool({ name: "cello_status", arguments: {} });
    const status = parseToolResult(statusResult) as {
      registered?: boolean;
      own_pubkey?: string;
      directory_reachable?: boolean;
      transport_started?: boolean;
    } | null;

    if (!status?.registered || !status?.own_pubkey) {
      logger.error("demo.connection.failed", {
        reason: "cello_status returned registered=false or no own_pubkey — agent must complete registration before starting",
        directoryUrl: DIRECTORY_URL,
        relayMultiaddr: DIRECTORY_MULTIADDR ?? "",
      });
      process.exit(1);
    }

    agentId = status.own_pubkey;
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.error("demo.connection.failed", { reason, directoryUrl: DIRECTORY_URL, relayMultiaddr: DIRECTORY_MULTIADDR ?? "" });
    process.exit(1);
  }

  logger.info("demo.started", { agentId, directoryUrl: DIRECTORY_URL });

  const demoClient = makeDemoMcpClient(mcpClient, logger);

  // ── Connection request loop ───────────────────────────────────────────────
  // Polls for inbound connection requests and accepts all automatically (AC-003)
  async function connectionLoop(): Promise<void> {
    while (true) {
      try {
        const result = await mcpClient.callTool({
          name: "cello_await_connection_request",
          arguments: { timeout_ms: 5000 },
        });
        const parsed = parseToolResult(result) as {
          type?: string;
          request_id?: string;
          from_agent_id?: string;
        } | null;

        if (parsed?.type === "pending_review" && parsed.request_id) {
          await mcpClient.callTool({
            name: "cello_accept_connection",
            arguments: { request_id: parsed.request_id },
          });
        }
        // type === "timeout": loop continues naturally
      } catch (err: unknown) {
        const reason = err instanceof Error ? err.message : String(err);
        logger.error("demo.connection_request.failed", { reason });
        // Brief pause before retry to avoid tight error loop
        await sleep(1000);
      }
    }
  }

  // ── Message receive loop ──────────────────────────────────────────────────
  // Polls for messages from any active session (AC-002)
  async function messageLoop(): Promise<void> {
    while (true) {
      try {
        const result = await mcpClient.callTool({
          name: "cello_receive",
          arguments: { timeout_ms: 5000 },
        });
        const parsed = parseToolResult(result) as {
          type?: string;
          session_id?: string;
          sender_pubkey?: string;
          content?: string;
        } | null;

        if (parsed?.type === "message" && parsed.session_id && parsed.sender_pubkey) {
          // SI-002: discard content here — handleMessage never receives it
          const sessionId = parsed.session_id;
          const senderAgentId = parsed.sender_pubkey;
          await handleMessage({ sessionId, senderAgentId, sessions, client: demoClient, logger });
        } else if (parsed?.type === "session_sealed" && parsed.session_id) {
          // Mark sealed rather than deleting — prevents position reset if a remote peer
          // closes before we process message 4 locally (IMPORTANT-002)
          const s = sessions.get(parsed.session_id);
          if (s) s.sealed = true;
        }
        // type === "timeout": loop continues naturally
      } catch (err: unknown) {
        const reason = err instanceof Error ? err.message : String(err);
        logger.error("demo.receive.failed", { reason });
        await sleep(1000);
      }
    }
  }

  // Run both loops concurrently. Promise.all rejects if either loop throws past its
  // inner catch, which fires the outer .catch in main() → logs demo.connection.failed
  // and exits. Promise.race would silently swallow a resolved loop (CRITICAL-001).
  await Promise.all([connectionLoop(), messageLoop()]);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Entry point
main().catch((err: unknown) => {
  const reason = err instanceof Error ? err.message : String(err);
  logger.error("demo.connection.failed", { reason, directoryUrl: DIRECTORY_URL, relayMultiaddr: DIRECTORY_MULTIADDR ?? "" });
  process.exit(1);
});
