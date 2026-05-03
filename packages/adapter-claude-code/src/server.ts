/**
 * CELLO Adapter — server.ts (MCP-001)
 *
 * createMcpServer(node, client, keyProvider): McpServer
 *   Registers the M0 tool set (5 tools) against a CelloClient.
 *   Transport-agnostic: identical tool names, schemas, and wiring under
 *   InMemoryTransport (tests) and stdio (production). AC-006.
 *
 * PSEUDOCODE (Phase P):
 *
 * State held by the MCP server instance:
 *   peerRegistry: Map<peerPubkeyHex, { peerId: string; multiaddrs: string[] }>
 *   startedAt: number = Date.now()  (for uptime_seconds in cello_status)
 *
 * transportStarted():
 *   return node.listenAddresses().length > 0
 *   (if false, every tool returns { error: { reason: 'transport_not_started' } })
 *
 * tool: cello_connect_peer({ multiaddr: string })
 *   1. Guard: if !transportStarted() → return transport_not_started error
 *   2. node.dial(multiaddr) → { peerId }
 *      on throw: return { connected: false, reason: 'peer_unreachable' }
 *   3. peerIdFromString(peerId) → Ed25519PeerId
 *      if type !== 'Ed25519': return { connected: false, reason: 'dial_failed' }
 *   4. peerPubkeyHex = Buffer.from(peerId.publicKey.raw).toString('hex')
 *   5. peerRegistry.set(peerPubkeyHex, { peerId, multiaddrs: [multiaddr] })
 *   6. client.addPeer(peerPubkeyHex, peerId, [multiaddr])
 *   7. return { connected: true, peer_pubkey: peerPubkeyHex }
 *
 * tool: cello_send({ peer_pubkey: string, content: string })
 *   1. Guard: transport_not_started
 *   2. UTF-8 encode content → contentBytes
 *   3. client.send(peer_pubkey, contentBytes) → SendResult
 *   4. Map SendResult to MCP output:
 *      delivered:true  → { delivered: true, content_hash: result.contentHash }
 *      delivered:false → { delivered: false, reason: result.reason, content_hash: null }
 *
 * tool: cello_receive({ peer_pubkey?: string, timeout_ms: number })
 *   1. Guard: transport_not_started
 *   2. deadline = Date.now() + timeout_ms
 *   3. Poll every 20ms until deadline:
 *      a. all = client.peekAll()
 *      b. if peer_pubkey filter:
 *           match = all.find(e => e.senderPubkeyHex === peer_pubkey)
 *           if match: client.receive(peer_pubkey) to dequeue; return message result
 *         else (no filter):
 *           if all.length > 0: client.receive(all[0].senderPubkeyHex) to dequeue; return message result
 *      c. await sleep(20)
 *   4. return { type: 'timeout' }
 *
 *   Message result: try UTF-8 decode envelope.content:
 *     success → { type: 'message', content, sender_pubkey: hex, content_hash: hex, timestamp: int }
 *     failure → { type: 'decode_error', sender_pubkey: hex, content_hash: hex }
 *
 * tool: cello_list_peers()
 *   1. Guard: transport_not_started
 *   2. connections = node.getConnections()  → Array<{ peerId, encryption }>
 *   3. connectedPeerIds = new Set(connections.map(c => c.peerId))
 *   4. For each [peerPubkeyHex, { peerId, multiaddrs }] in peerRegistry:
 *      emit { peer_pubkey: peerPubkeyHex, multiaddrs, connected: connectedPeerIds.has(peerId) }
 *   5. return array
 *
 * tool: cello_status()
 *   NOTE: no transport_not_started guard — cello_status always responds regardless of
 *   transport state, returning transport_started: false when not yet started. AC-005/AC-009.
 *   1. ownPubkey = Buffer.from(await keyProvider.getPublicKey()).toString('hex')
 *   2. return {
 *        transport_started: transportStarted(),
 *        own_pubkey: ownPubkey,
 *        listen_addresses: node.listenAddresses(),
 *        connected_peer_count: node.getConnections().length,
 *        uptime_seconds: Math.floor((Date.now() - startedAt) / 1000)
 *      }
 *   NOTE: cello_status does NOT return transport_not_started error — it always responds
 *   (transport_started: false shows the state). The guard only applies to operational tools.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { peerIdFromString } from "@libp2p/peer-id";
import type { CelloClient } from "@cello/client";
import type { CelloNode } from "@cello/transport";
import type { KeyProvider } from "@cello/crypto";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function jsonText(value: unknown): { content: [{ type: "text"; text: string }] } {
  return { content: [{ type: "text" as const, text: JSON.stringify(value) }] };
}

const TRANSPORT_NOT_STARTED = jsonText({ error: { reason: "transport_not_started" } });

// ─── createMcpServer ─────────────────────────────────────────────────────────

export function createMcpServer(
  node: CelloNode,
  client: CelloClient,
  keyProvider: KeyProvider
): McpServer {
  const startedAt = Date.now();

  // peer_pubkey_hex → { peerId, multiaddrs }
  const peerRegistry = new Map<string, { peerId: string; multiaddrs: string[] }>();

  function transportStarted(): boolean {
    return node.listenAddresses().length > 0;
  }

  const server = new McpServer(
    { name: "cello", version: "0.0.1" },
    { capabilities: { experimental: { "claude/channel": {} } } }
  );

  // ── cello_connect_peer ────────────────────────────────────────────────────

  server.registerTool(
    "cello_connect_peer",
    {
      description: "Dial a peer by multiaddr and register them in the local peer registry.",
      inputSchema: {
        multiaddr: z.string().describe("Multiaddr string of the peer to connect to"),
      },
    },
    async ({ multiaddr }) => {
      if (!transportStarted()) return TRANSPORT_NOT_STARTED;

      let peerId: string;
      try {
        const result = await node.dial(multiaddr);
        peerId = result.peerId;
      } catch {
        return jsonText({ connected: false, reason: "peer_unreachable" });
      }

      let peerPubkeyHex: string;
      try {
        const pid = peerIdFromString(peerId);
        if (pid.type !== "Ed25519" || !pid.publicKey) {
          return jsonText({ connected: false, reason: "dial_failed" });
        }
        peerPubkeyHex = Buffer.from(pid.publicKey.raw).toString("hex");
      } catch {
        return jsonText({ connected: false, reason: "dial_failed" });
      }

      peerRegistry.set(peerPubkeyHex, { peerId, multiaddrs: [multiaddr] });
      client.addPeer(peerPubkeyHex, peerId, [multiaddr]);

      return jsonText({ connected: true, peer_pubkey: peerPubkeyHex });
    }
  );

  // ── cello_send ────────────────────────────────────────────────────────────

  server.registerTool(
    "cello_send",
    {
      description: "Send a UTF-8 message to a connected peer.",
      inputSchema: {
        peer_pubkey: z.string().describe("Peer public key hex (from cello_connect_peer)"),
        content: z.string().describe("UTF-8 message content"),
      },
    },
    async ({ peer_pubkey, content }) => {
      if (!transportStarted()) return TRANSPORT_NOT_STARTED;

      const contentBytes = new TextEncoder().encode(content);
      const result = await client.send(peer_pubkey, contentBytes);

      if (result.delivered) {
        return jsonText({ delivered: true, content_hash: result.contentHash });
      }
      return jsonText({ delivered: false, reason: result.reason, content_hash: null });
    }
  );

  // ── cello_receive ─────────────────────────────────────────────────────────

  server.registerTool(
    "cello_receive",
    {
      description: "Wait for a message, optionally filtered by sender peer_pubkey.",
      inputSchema: {
        peer_pubkey: z.string().optional().describe("Filter by sender pubkey hex (optional)"),
        timeout_ms: z.number().int().min(0).describe("Maximum wait time in milliseconds"),
      },
    },
    async ({ peer_pubkey, timeout_ms }) => {
      if (!transportStarted()) return TRANSPORT_NOT_STARTED;

      const deadline = Date.now() + timeout_ms;

      while (Date.now() < deadline) {
        // SI-002: peekAll() only surfaces envelopes that passed MSG-002 verify
        // (content_hash recompute + Ed25519 signature check). No re-verification here.
        const all = client.peekAll();

        if (peer_pubkey !== undefined) {
          // peekAll() is a non-destructive arrival log that never shrinks — a historical entry
          // for peer_pubkey may exist even after its queue was drained. Always guard the result.
          const envelope = client.receive(peer_pubkey);
          if (envelope) {
            return jsonText(formatMessage(envelope, peer_pubkey));
          }
        } else if (all.length > 0) {
          // Find the oldest unread message: the first senderPubkeyHex whose per-sender queue
          // is non-empty. We can't rely on all[0] because it may already be dequeued.
          for (const { senderPubkeyHex } of all) {
            const envelope = client.receive(senderPubkeyHex);
            if (envelope) {
              return jsonText(formatMessage(envelope, senderPubkeyHex));
            }
          }
        }

        // Check deadline before sleeping to avoid overshooting by 20ms on last iteration
        const remaining = deadline - Date.now();
        if (remaining <= 0) break;
        await sleep(Math.min(20, remaining));
      }

      return jsonText({ type: "timeout" });
    }
  );

  // ── cello_list_peers ──────────────────────────────────────────────────────

  server.registerTool(
    "cello_list_peers",
    {
      description: "List all peers currently in the local registry.",
      inputSchema: {},
    },
    async () => {
      if (!transportStarted()) return TRANSPORT_NOT_STARTED;

      const connections = node.getConnections();
      const connectedPeerIds = new Set(connections.map((c) => c.peerId));

      const peers = Array.from(peerRegistry.entries()).map(([pubkeyHex, { peerId, multiaddrs }]) => ({
        peer_pubkey: pubkeyHex,
        multiaddrs,
        connected: connectedPeerIds.has(peerId),
      }));

      return jsonText(peers);
    }
  );

  // ── cello_status ─────────────────────────────────────────────────────────

  server.registerTool(
    "cello_status",
    {
      description: "Return transport status, own pubkey, and connection info.",
      inputSchema: {},
    },
    async () => {
      const ownPubkey = Buffer.from(await keyProvider.getPublicKey()).toString("hex");
      return jsonText({
        transport_started: transportStarted(),
        own_pubkey: ownPubkey,
        listen_addresses: node.listenAddresses(),
        connected_peer_count: node.getConnections().length,
        uptime_seconds: Math.floor((Date.now() - startedAt) / 1000),
      });
    }
  );

  return server;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatMessage(
  envelope: { content: Uint8Array; senderPubkey: Uint8Array; contentHash: Uint8Array; timestamp: number },
  senderPubkeyHex: string
): object {
  try {
    const content = new TextDecoder("utf-8", { fatal: true }).decode(envelope.content);
    return {
      type: "message",
      content,
      sender_pubkey: senderPubkeyHex,
      content_hash: Buffer.from(envelope.contentHash).toString("hex"),
      timestamp: envelope.timestamp,
    };
  } catch {
    return {
      type: "decode_error",
      sender_pubkey: senderPubkeyHex,
      content_hash: Buffer.from(envelope.contentHash).toString("hex"),
    };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
