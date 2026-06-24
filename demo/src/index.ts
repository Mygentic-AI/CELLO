/**
 * CELLO-DEMO-001 — Demo Agent (M7 daemon architecture)
 *
 * A standalone Node.js process that runs a CELLO agent responding to messages
 * with a hardcoded 4-message sequence. No LLM backend. No HTTP server.
 *
 * M7 ARCHITECTURE (rewritten from the M6 monolithic-connect model):
 *
 *   `connect` (cello-mcp) is now a THIN MCP shim that proxies to a long-running
 *   daemon over $CELLO_DIR/daemon.sock. The daemon is the node — it holds the key,
 *   the SQLite DB, the libp2p transport, and the directory connection. So this
 *   process does NOT configure the node; it assumes a daemon is already running
 *   (started by `cello login` / the cello-daemon systemd service) and the demo
 *   agent has been registered once (`cello register <agent> <token>`).
 *
 * Startup:
 *   1. Spawn cello-mcp (it only needs CELLO_DIR to find the daemon socket).
 *   2. cello_start_agent { name } — bring the demo agent online (creates its
 *      standing receiver, registers discoverability with the directory).
 *   3. cello_use_agent { name } — route session ops through the demo agent.
 *   4. Poll cello_status until directory_signaling === "connected" and the agent
 *      is loaded (has a pubkey). Log demo.started { agentId }.
 *   5. Run two loops concurrently:
 *
 * Await-session loop (replaces the M6 connection-request/accept loop):
 *   - cello_await_session { timeout_ms } → on { type: "new_session", session_id }
 *     track the session. Sessions are auto-active in M7 — there is no accept step.
 *
 * Receive loop (M7 cello_receive is non-blocking + per-session):
 *   - For each active, non-sealed session, drain cello_receive { session_id }.
 *   - On a message (content non-null): extract session_id + senderPubkey, DISCARD
 *     content (SI-002), and call handleMessage → sends the next of 4 → after the
 *     4th, cello_close_session.
 *
 * Environment variables:
 *   CELLO_DIR          $HOME/.cello — must match the daemon's CELLO_DIR (default ~/.cello)
 *   CELLO_AGENT_NAME   the registered agent name to run as (default "demo")
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  handleMessage,
  createSessionState,
  type SessionState,
  type DemoLogger,
  type DemoMcpClient,
} from "./message-handler.js";

// ─── Configuration ────────────────────────────────────────────────────────────

const CELLO_DIR = process.env["CELLO_DIR"] ?? join(homedir(), ".cello");
const AGENT_NAME = process.env["CELLO_AGENT_NAME"] ?? "demo";

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

function parseToolResult(result: unknown): Record<string, unknown> | null {
  if (
    result &&
    typeof result === "object" &&
    "content" in result &&
    Array.isArray((result as { content: unknown[] }).content) &&
    (result as { content: { type: string; text: string }[] }).content[0]?.type === "text"
  ) {
    try {
      return JSON.parse((result as { content: { type: string; text: string }[] }).content[0]!.text) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  return null;
}

// ─── MCP client wrapper ───────────────────────────────────────────────────────
// Implements DemoMcpClient for the message handler.

function makeDemoMcpClient(mcpClient: Client, log: DemoLogger): DemoMcpClient {
  return {
    async send(sessionId: string, content: string): Promise<{ delivered: boolean }> {
      try {
        const result = await mcpClient.callTool({ name: "cello_send", arguments: { session_id: sessionId, content } });
        // M7 cello_send → { ok: true, sequence_number } | { ok: false, reason, guidance }
        const parsed = parseToolResult(result);
        return { delivered: parsed?.["ok"] === true };
      } catch (err: unknown) {
        const reason = err instanceof Error ? err.message : String(err);
        log.error("demo.send.failed", { sessionId, reason });
        return { delivered: false };
      }
    },
    async closeSession(sessionId: string): Promise<{ closed: boolean }> {
      try {
        const result = await mcpClient.callTool({ name: "cello_close_session", arguments: { session_id: sessionId } });
        // M7 cello_close_session → { closed: true, ... } | { ok: false, reason, guidance }
        const parsed = parseToolResult(result);
        return { closed: parsed?.["closed"] === true };
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
  // Per-session state: tracks position and sealed status for each active session.
  const sessions = new Map<string, SessionState>();

  // cello-mcp connects to the daemon at $CELLO_DIR/daemon.sock. The daemon must
  // already be running (cello-daemon.service). The shim only needs CELLO_DIR — all
  // node config (key, DB, directory) belongs to the daemon, not here.
  const subprocessEnv: Record<string, string> = {
    ...(process.env as Record<string, string>),
    CELLO_DIR,
  };

  // Resolve the cello-mcp bin from node_modules/.bin (let the OS resolve the shebang).
  const { fileURLToPath } = await import("node:url");
  const here = fileURLToPath(new URL(".", import.meta.url));
  const celloMcpBin = join(here, "..", "node_modules", ".bin", "cello-mcp");

  const transport = new StdioClientTransport({ command: celloMcpBin, args: [], env: subprocessEnv });
  const mcpClient = new Client({ name: "cello-demo-agent", version: "2.0.0" });

  try {
    await mcpClient.connect(transport);
  } catch (err: unknown) {
    // The most common cause is "daemon not running" — cello-mcp exits when the
    // daemon socket is absent. The cello-daemon service must be up first.
    const reason = err instanceof Error ? err.message : String(err);
    logger.error("demo.connection.failed", { reason, hint: "is the cello-daemon service running? cello-mcp needs a daemon at $CELLO_DIR/daemon.sock" });
    process.exit(1);
  }

  // Bring the demo agent ONLINE (registered → online) and set it as current. The
  // agent must already be registered (cello register <name> <token>) — start_agent
  // fails otherwise, which is a hard, actionable error.
  try {
    const startRes = parseToolResult(await mcpClient.callTool({ name: "cello_start_agent", arguments: { name: AGENT_NAME } }));
    if (startRes?.["ok"] !== true) {
      logger.error("demo.connection.failed", {
        reason: `cello_start_agent failed for "${AGENT_NAME}": ${String(startRes?.["reason"] ?? "unknown")}`,
        guidance: String(startRes?.["guidance"] ?? `register the agent first: cello register ${AGENT_NAME} <token>`),
      });
      process.exit(1);
    }
    const useRes = parseToolResult(await mcpClient.callTool({ name: "cello_use_agent", arguments: { name: AGENT_NAME } }));
    if (useRes?.["ok"] !== true) {
      logger.error("demo.connection.failed", { reason: `cello_use_agent failed for "${AGENT_NAME}": ${String(useRes?.["reason"] ?? "unknown")}` });
      process.exit(1);
    }
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.error("demo.connection.failed", { reason });
    process.exit(1);
  }

  // Wait for the directory connection to come up and the agent to be loaded.
  // M7 cello_status → { daemon, directory_signaling, agents:[{name,state,pubkey}], ... }.
  let agentId: string;
  try {
    const POLL_MS = 2000;
    const TIMEOUT_MS = 30000;
    const deadline = Date.now() + TIMEOUT_MS;
    let pubkey: string | undefined;
    let signaling = "";

    while (Date.now() < deadline) {
      const status = parseToolResult(await mcpClient.callTool({ name: "cello_status", arguments: {} }));
      signaling = String(status?.["directory_signaling"] ?? "");
      const agents = (status?.["agents"] as { name?: string; state?: string; pubkey?: string }[] | undefined) ?? [];
      const me = agents.find((a) => a.name === AGENT_NAME);
      pubkey = me?.pubkey;
      // "online" or "current" both mean the standing receiver is up for this agent.
      const online = me?.state === "online" || me?.state === "current";
      if (signaling === "connected" && online && pubkey) break;
      await sleep(POLL_MS);
    }

    if (signaling !== "connected" || !pubkey) {
      logger.error("demo.connection.failed", {
        reason: signaling !== "connected"
          ? `directory_signaling="${signaling}" — daemon could not reach the directory`
          : `agent "${AGENT_NAME}" has no pubkey — registration may be incomplete`,
      });
      process.exit(1);
    }
    agentId = pubkey;
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.error("demo.connection.failed", { reason });
    process.exit(1);
  }

  logger.info("demo.started", { agentId, agentName: AGENT_NAME });

  const demoClient = makeDemoMcpClient(mcpClient, logger);

  // ── Await-session loop ─────────────────────────────────────────────────────
  // Picks up inbound sessions from strangers. In M7 sessions are auto-active on
  // arrival (no accept step) — we just track each new session_id.
  async function awaitSessionLoop(): Promise<void> {
    while (true) {
      try {
        const r = parseToolResult(await mcpClient.callTool({ name: "cello_await_session", arguments: { timeout_ms: 5000 } }));
        if (r?.["type"] === "new_session" && typeof r["session_id"] === "string") {
          const sessionId = r["session_id"];
          if (!sessions.has(sessionId)) {
            sessions.set(sessionId, createSessionState());
            logger.info("demo.session.new", { sessionId, counterpartyPubkey: String(r["counterparty_pubkey"] ?? "") });
          }
        }
        // type === "timeout": loop continues naturally
      } catch (err: unknown) {
        const reason = err instanceof Error ? err.message : String(err);
        logger.error("demo.await_session.failed", { reason });
        await sleep(1000);
      }
    }
  }

  // ── Receive loop ───────────────────────────────────────────────────────────
  // M7 cello_receive is non-blocking and per-session, so we poll each active
  // session and drain any buffered messages each tick.
  async function receiveLoop(): Promise<void> {
    while (true) {
      for (const [sessionId, state] of [...sessions]) {
        if (state.sealed) {
          // The 4-message sequence is done and we closed it — stop tracking.
          sessions.delete(sessionId);
          continue;
        }
        try {
          // Drain all currently-buffered messages for this session.
          while (true) {
            const r = parseToolResult(await mcpClient.callTool({ name: "cello_receive", arguments: { session_id: sessionId, timeout_ms: 1000 } }));
            if (r?.["ok"] !== true) break; // session gone / error — stop draining it this tick
            if (typeof r["content"] !== "string") break; // nothing buffered
            // SI-002: discard content here — handleMessage never sees it. Drive purely
            // off session_id + senderPubkey + the position-based sequence.
            const senderAgentId = String(r["senderPubkey"] ?? "");
            await handleMessage({ sessionId, senderAgentId, sessions, client: demoClient, logger });
            if (state.sealed) break; // sealed by the 4th message — stop draining
          }
        } catch (err: unknown) {
          const reason = err instanceof Error ? err.message : String(err);
          logger.error("demo.receive.failed", { sessionId, reason });
        }
      }
      await sleep(500);
    }
  }

  // Run both loops concurrently. Promise.all rejects if either throws past its
  // inner catch, which fires the outer .catch in main() → logs and exits.
  await Promise.all([awaitSessionLoop(), receiveLoop()]);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Entry point
main().catch((err: unknown) => {
  const reason = err instanceof Error ? err.message : String(err);
  logger.error("demo.connection.failed", { reason });
  process.exit(1);
});
