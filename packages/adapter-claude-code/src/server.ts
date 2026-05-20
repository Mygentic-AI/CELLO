/**
 * CELLO Adapter — server.ts (ADAPTER-002 / M1)
 *
 * createMcpServer(node, client, keyProvider): McpServer
 *   Registers the M1 tool set against a CelloClient.
 *   Transport-agnostic: identical tool names, schemas, and wiring under
 *   InMemoryTransport (tests) and stdio (production). AC-007.
 *
 * PSEUDOCODE (Phase P — ADAPTER-002):
 *
 * State held by the MCP server instance:
 *   sessionEventQueue: Array<InboundSessionEvent>  FIFO; populated by onSessionAssignment handler
 *   sessionEventResolvers: Array<(event: InboundSessionEvent) => void>  blocked cello_await_session waiters
 *   startedAt: number = Date.now()
 *
 * Session event enqueue (onSessionAssignment handler):
 *   Receives: SessionAssignmentEvent { sessionIdHex, counterpartyPubkeyHex, genesisPrevRootHex }
 *   (from CelloClient.onSessionAssignment per CELLO-MCP-002; fields are pre-encoded as hex)
 *   1. Push cello_session_request notification via claude/channel (SI-001: only type, from, session_id)
 *   2. If sessionEventResolvers.length > 0:
 *      - shift the first resolver and call it with the event (wake up blocked cello_await_session)
 *   3. Else:
 *      - Push event to sessionEventQueue
 *
 * tool: cello_initiate_session({ target_pubkey: string })
 *   Delegates to CelloClient.initiateSession (added by MCP-002).
 *   Returns { ok: true, session_id: hex } or { ok: false, reason: string }.
 *   Stubbed if method not present on client.
 *
 * tool: cello_await_session({ timeout_ms: number })
 *   1. If sessionEventQueue.length > 0:
 *      - shift first event
 *      - return { type: 'new_session', session_id, counterparty_pubkey, genesis_prev_root }
 *   2. Else: block until event arrives or timeout expires:
 *      - Create a Promise that resolves when an event arrives or deadline fires
 *      - Push a resolver into sessionEventResolvers
 *      - Race: event arrival vs setTimeout(timeout_ms)
 *      - On arrival: return new_session
 *      - On timeout: remove resolver from array; return { type: 'timeout' }
 *
 * tool: cello_send({ session_id: string, content: string })
 *   1. Guard: transport_not_started
 *   2. UTF-8 encode content → contentBytes
 *   3. client.sendMessage(session_id, contentBytes) → SendMessageResult
 *   4. Map to MCP output:
 *      ok:true  → { delivered: true }
 *      ok:false → { delivered: false, reason: result.reason }
 *
 * tool: cello_receive({ session_id: string, timeout_ms: number })
 *   1. Guard: transport_not_started
 *   2. deadline = Date.now() + timeout_ms
 *   3. Poll every 20ms until deadline:
 *      a. msg = client.receiveMessage(session_id)
 *      b. if msg: return formatted message result
 *      c. await sleep(Math.min(20, remaining))
 *   4. return { type: 'timeout' }
 *
 * tool: cello_close_session({ session_id: string })
 *   client.closeSession(session_id)
 *   return { closed: true }
 *
 * tool: cello_list_sessions()
 *   return client.listSessions() mapped to wire shape
 *
 * tool: cello_get_sealed_receipt({ session_id: string })
 *   Stubbed in M1: return { available: false, reason: 'not_yet_sealed' }
 *   (SESSION-003 implements real seals)
 *
 * tool: cello_get_inclusion_proof({ session_id: string, content_hash: string })
 *   Stubbed in M1: return { available: false, reason: 'not_yet_sealed' }
 *
 * tool: cello_status()
 *   1. ownPubkey = Buffer.from(await keyProvider.getPublicKey()).toString('hex')
 *   2. sessions = client.listSessions()
 *   3. return {
 *        transport_started: transportStarted(),
 *        own_pubkey: ownPubkey,
 *        listen_addresses: node.listenAddresses(),
 *        connected_peer_count: node.getConnections().length,
 *        uptime_seconds: Math.floor((Date.now() - startedAt) / 1000),
 *        active_session_count: sessions.filter(s => s.status === 'active').length,
 *        directory_reachable: false  // M1 stub — directory reachability check deferred
 *      }
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { CelloClient, SessionAssignmentEvent } from "@cello/client";
import type { CelloNode } from "@cello/transport";
import type { KeyProvider } from "@cello/crypto";
import type { CheckpointStatusProvider } from "@cello/interfaces";
import { pushSessionRequestNotification } from "./notifications.js";

// ─── InboundSessionEvent ─────────────────────────────────────────────────────
// Alias for SessionAssignmentEvent — both have identical shape; using the alias
// makes clear this is internal adapter state distinct from the wire type.

type InboundSessionEvent = SessionAssignmentEvent;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function jsonText(value: unknown): { content: [{ type: "text"; text: string }] } {
  return { content: [{ type: "text" as const, text: JSON.stringify(value) }] };
}

const TRANSPORT_NOT_STARTED = jsonText({ error: { reason: "transport_not_started" } });
const CLIENT_NOT_INITIALIZED = jsonText({ error: { reason: "client_not_initialized" } });

// ─── createMcpServer ─────────────────────────────────────────────────────────

export function createMcpServer(
  node: CelloNode,
  client: CelloClient,
  keyProvider: KeyProvider,
  opts?: { checkpointStatusProvider?: CheckpointStatusProvider },
): McpServer {
  const checkpointStatusProvider = opts?.checkpointStatusProvider;
  const startedAt = Date.now();

  // ─── Session event queue ─────────────────────────────────────────────────
  const sessionEventQueue: InboundSessionEvent[] = [];
  const sessionEventResolvers: Array<(event: InboundSessionEvent) => void> = [];

  function transportStarted(): boolean {
    return node.listenAddresses().length > 0;
  }

  const server = new McpServer(
    { name: "cello", version: "0.1.0" },
    { capabilities: { experimental: { "claude/channel": {} } } }
  );

  // ─── Register onSessionAssignment handler ───────────────────────────────
  if (client != null && typeof client.onSessionAssignment === "function") {
    client.onSessionAssignment((event: SessionAssignmentEvent) => {
      void pushSessionRequestNotification(server, event.counterpartyPubkeyHex, event.sessionIdHex);

      if (sessionEventResolvers.length > 0) {
        const resolve = sessionEventResolvers.shift()!;
        resolve(event);
      } else {
        sessionEventQueue.push(event);
      }
    });
  }

  // ── cello_initiate_session ────────────────────────────────────────────────

  server.registerTool(
    "cello_initiate_session",
    {
      description: "Initiate a CELLO session with a target agent identified by their public key.",
      inputSchema: {
        target_pubkey: z.string().describe("Target agent public key hex (K_local pubkey of the peer)"),
      },
    },
    async ({ target_pubkey }) => {
      if (!transportStarted()) return TRANSPORT_NOT_STARTED;

      const result = await client.initiateSession(target_pubkey);
      if (result.ok) {
        return jsonText({
          ok: true,
          session_id: Buffer.from(result.sessionId).toString("hex"),
          genesis_prev_root: Buffer.from(result.genesisPrevRoot).toString("hex"),
        });
      }
      return jsonText({ ok: false, reason: result.reason });
    }
  );

  // ── cello_await_session ───────────────────────────────────────────────────

  server.registerTool(
    "cello_await_session",
    {
      description:
        "Wait for an inbound session request. Returns immediately if one is already queued, or blocks until one arrives or the timeout expires.",
      inputSchema: {
        timeout_ms: z.number().int().min(0).describe("Maximum wait time in milliseconds"),
      },
    },
    async ({ timeout_ms }) => {
      // If a queued event exists, return it immediately (FIFO)
      if (sessionEventQueue.length > 0) {
        const event = sessionEventQueue.shift()!;
        return jsonText({
          type: "new_session",
          session_id: event.sessionIdHex,
          counterparty_pubkey: event.counterpartyPubkeyHex,
          genesis_prev_root: event.genesisPrevRootHex,
        });
      }

      // Block until an event arrives or timeout fires
      const result = await new Promise<InboundSessionEvent | null>((resolve) => {
        let timerId: ReturnType<typeof setTimeout>;

        function resolveEvent(event: InboundSessionEvent): void {
          clearTimeout(timerId);
          resolve(event);
        }

        sessionEventResolvers.push(resolveEvent);

        timerId = setTimeout(() => {
          const idx = sessionEventResolvers.indexOf(resolveEvent);
          if (idx !== -1) sessionEventResolvers.splice(idx, 1);
          resolve(null);
        }, timeout_ms);
      });

      if (result === null) {
        return jsonText({ type: "timeout" });
      }

      return jsonText({
        type: "new_session",
        session_id: result.sessionIdHex,
        counterparty_pubkey: result.counterpartyPubkeyHex,
        genesis_prev_root: result.genesisPrevRootHex,
      });
    }
  );

  // ── cello_send (session-keyed, M1) ────────────────────────────────────────

  server.registerTool(
    "cello_send",
    {
      description: "Send a UTF-8 message on an active CELLO session.",
      inputSchema: {
        session_id: z.string().describe("Session ID hex (from cello_initiate_session or cello_await_session)"),
        content: z.string().describe("UTF-8 message content"),
      },
    },
    async ({ session_id, content }) => {
      if (client == null) return CLIENT_NOT_INITIALIZED;
      if (!transportStarted()) return TRANSPORT_NOT_STARTED;

      const contentBytes = new TextEncoder().encode(content);
      const result = await client.sendMessage(session_id, contentBytes);

      if (result.ok) {
        return jsonText({ delivered: true });
      }
      return jsonText({ delivered: false, reason: result.reason });
    }
  );

  // ── cello_receive (session-keyed, M1) ─────────────────────────────────────

  server.registerTool(
    "cello_receive",
    {
      description:
        "Wait for a message on a specific CELLO session. Blocks until a message arrives or the timeout expires.",
      inputSchema: {
        session_id: z
          .string()
          .describe("Session ID hex (from cello_initiate_session or cello_await_session)"),
        timeout_ms: z.number().int().min(0).describe("Maximum wait time in milliseconds"),
      },
    },
    async ({ session_id, timeout_ms }) => {
      if (client == null) return CLIENT_NOT_INITIALIZED;
      if (!transportStarted()) return TRANSPORT_NOT_STARTED;

      const deadline = Date.now() + timeout_ms;

      while (Date.now() < deadline) {
        const msg = client.receiveMessage(session_id);
        if (msg) {
          if (msg.type === "session_sealed") {
            return jsonText({
              type: "session_sealed",
              session_id: msg.sessionIdHex,
              sealed_root: Buffer.from(msg.sealedRoot).toString("hex"),
              close_timestamp: msg.closeTimestamp,
              checkpoint_status: msg.checkpointStatus,
            });
          }
          return jsonText(formatSessionMessage(msg, session_id));
        }

        const remaining = deadline - Date.now();
        if (remaining <= 0) break;
        await sleep(Math.min(20, remaining));
      }

      return jsonText({ type: "timeout" });
    }
  );

  // ── cello_close_session ───────────────────────────────────────────────────

  server.registerTool(
    "cello_close_session",
    {
      description: "Close and remove a CELLO session. Idempotent.",
      inputSchema: {
        session_id: z.string().describe("Session ID hex to close"),
      },
    },
    async ({ session_id }) => {
      if (client == null) return CLIENT_NOT_INITIALIZED;
      client.closeSession(session_id);

      // PERSIST-017: include checkpoint_status if CheckpointStatusProvider is wired in.
      // When not provided (M1 stubs, tests without DB), return closed: true only.
      if (checkpointStatusProvider) {
        const stagingStatus = await checkpointStatusProvider.getSealStagingStatus(session_id);
        if (stagingStatus.status === "pending") {
          return jsonText({ closed: true, checkpoint_status: "pending", staged_at: stagingStatus.staged_at });
        }
        if (stagingStatus.status === "confirmed") {
          return jsonText({
            closed: true,
            checkpoint_status: "confirmed",
            session_mmr_peak: stagingStatus.checkpoint_peak_hash,
            leaf_index: stagingStatus.leaf_index,
          });
        }
      }

      return jsonText({ closed: true });
    }
  );

  // ── cello_list_sessions ───────────────────────────────────────────────────

  server.registerTool(
    "cello_list_sessions",
    {
      description: "List all current CELLO sessions and their status.",
      inputSchema: {},
    },
    async () => {
      if (client == null) return CLIENT_NOT_INITIALIZED;
      const sessions = client.listSessions().map((s) => ({
        session_id: Buffer.from(s.session_id).toString("hex"),
        counterparty_pubkey: Buffer.from(s.counterparty_pubkey).toString("hex"),
        status: s.status,
      }));
      return jsonText(sessions);
    }
  );

  // ── cello_get_sealed_receipt ──────────────────────────────────────────────
  // PERSIST-017: returns checkpoint_status when CheckpointStatusProvider is wired.
  // Falls back to the M1 stub response when no provider is configured.

  server.registerTool(
    "cello_get_sealed_receipt",
    {
      description:
        "Retrieve the sealed receipt and MMR checkpoint status for a closed session.",
      inputSchema: {
        session_id: z.string().describe("Session ID hex"),
      },
    },
    async ({ session_id }) => {
      if (checkpointStatusProvider) {
        const stagingStatus = await checkpointStatusProvider.getSealStagingStatus(session_id);
        if (stagingStatus.status === "pending") {
          return jsonText({
            available: true,
            checkpoint_status: "pending",
            staged_at: stagingStatus.staged_at,
            attestation_self: "PENDING",
            attestation_self_reason: "MMR checkpoint not yet written",
          });
        }
        if (stagingStatus.status === "confirmed") {
          return jsonText({
            available: true,
            checkpoint_status: "confirmed",
            session_mmr_peak: stagingStatus.checkpoint_peak_hash,
            leaf_index: stagingStatus.leaf_index,
            checkpoint_id: stagingStatus.checkpoint_id,
          });
        }
        // not_staged: session was never sealed
        return jsonText({ available: false, reason: "not_yet_sealed" });
      }
      return jsonText({ available: false, reason: "not_yet_sealed" });
    }
  );

  // ── cello_get_inclusion_proof ─────────────────────────────────────────────
  // PERSIST-017: returns pending/confirmed status when CheckpointStatusProvider is wired.
  // Falls back to the M1 stub response when no provider is configured.

  server.registerTool(
    "cello_get_inclusion_proof",
    {
      description:
        "Retrieve the MMR inclusion proof status for a sealed session.",
      inputSchema: {
        session_id: z.string().describe("Session ID hex"),
        content_hash: z.string().describe("Content hash hex of the message"),
      },
    },
    async ({ session_id }) => {
      if (checkpointStatusProvider) {
        const stagingStatus = await checkpointStatusProvider.getSealStagingStatus(session_id);
        if (stagingStatus.status === "pending") {
          return jsonText({
            status: "pending",
            staged_at: stagingStatus.staged_at,
            message: "sealed_root staged; inclusion proof available after next MMR checkpoint",
          });
        }
        if (stagingStatus.status === "confirmed") {
          return jsonText({
            status: "confirmed",
            leaf_index: stagingStatus.leaf_index,
            checkpoint_peak_hash: stagingStatus.checkpoint_peak_hash,
            checkpoint_id: stagingStatus.checkpoint_id,
            sibling_hashes: stagingStatus.sibling_hashes,
          });
        }
        // not_staged: session was never sealed — error distinguishes from 'pending'
        return jsonText({ status: "error", reason: "not_yet_sealed" });
      }
      return jsonText({ available: false, reason: "not_yet_sealed" });
    }
  );

  // ── cello_status (extended with M1 fields) ────────────────────────────────

  server.registerTool(
    "cello_status",
    {
      description:
        "Return transport status, own pubkey, connection info, and M1 session summary.",
      inputSchema: {},
    },
    async () => {
      const ownPubkey = Buffer.from(await keyProvider.getPublicKey()).toString("hex");
      const sessions = client.listSessions();
      const activeSessionCount = sessions.filter((s) => s.status === "active").length;

      // directoryReachable check: any session with a directory_endpoint indicates reachability
      const directoryReachable = sessions.some(
        (s) => s.directory_endpoint && s.directory_endpoint.peer_id !== ""
      );

      return jsonText({
        transport_started: transportStarted(),
        own_pubkey: ownPubkey,
        listen_addresses: node.listenAddresses(),
        connected_peer_count: node.getConnections().length,
        uptime_seconds: Math.floor((Date.now() - startedAt) / 1000),
        active_session_count: activeSessionCount,
        directory_reachable: directoryReachable,
      });
    }
  );

  return server;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatSessionMessage(
  msg: { content: Uint8Array; senderPubkey: Uint8Array; sequenceNumber: number; leafHash: Uint8Array },
  sessionIdHex: string
): object {
  try {
    const content = new TextDecoder("utf-8", { fatal: true }).decode(msg.content);
    return {
      type: "message",
      content,
      session_id: sessionIdHex,
      sender_pubkey: Buffer.from(msg.senderPubkey).toString("hex"),
      sequence_number: msg.sequenceNumber,
      leaf_hash: Buffer.from(msg.leafHash).toString("hex"),
    };
  } catch {
    return {
      type: "decode_error",
      session_id: sessionIdHex,
      sender_pubkey: Buffer.from(msg.senderPubkey).toString("hex"),
      sequence_number: msg.sequenceNumber,
      leaf_hash: Buffer.from(msg.leafHash).toString("hex"),
    };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
