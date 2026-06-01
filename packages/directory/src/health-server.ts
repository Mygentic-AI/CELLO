/**
 * Health check HTTP server for DEPLOY-002.
 *
 * Pseudocode:
 *   1. Create an HTTP server listening on the configured port.
 *   2. On GET /health, return 200 with JSON { status: "ok", nodeId, schemaVersion }.
 *   3. On GET /bootstrap, return 200 with JSON { multiaddr, peerId } when configured,
 *      or 503 with JSON { error: "not ready" } when multiaddr is not yet known.
 *   4. On any other path, return 404.
 *   5. Response must complete within 5 seconds (ECS health check timeout).
 *
 * The health server runs alongside the libp2p directory node inside the same
 * ECS task on port 9090. The ALB target group health check hits GET /health on
 * port 9090 (separated from the WS listener on port 8080).
 * The bootstrap endpoint is used by cello-mcp to auto-discover the directory
 * multiaddr without requiring manual CELLO_DIRECTORY_MULTIADDR configuration.
 */

import { createServer, type Server } from "node:http";
import { parse as parseUrl } from "node:url";
import type { Logger } from "@cello-protocol/interfaces";

export interface HealthServerOptions {
  nodeId: string;
  schemaVersion: number;
  logger: Logger;
  port: number;
  /** Full WS multiaddr including /p2p/<peer-id> suffix. When provided, GET /bootstrap returns 200. */
  multiaddr?: string;
  /** Peer ID hex string. When provided alongside multiaddr, returned in GET /bootstrap. */
  peerId?: string;
  /**
   * AC-007a (DX-001): Resolver for GET /agent-lookup?agent_id=<32hex>.
   * Returns the k_local_pubkey (64 hex chars) for the given agent_id, or undefined if not found.
   * Injected from the composition root so health-server has no direct dependency on PgDirectoryStore.
   */
  getKLocalPubkeyByAgentId?: (agentId: string) => string | undefined;
}

/**
 * Creates and returns (but does not start) an HTTP server that serves
 * the /health and /bootstrap endpoints. The caller is responsible for calling .listen().
 */
export function createHealthServer(opts: HealthServerOptions): Server {
  const { nodeId, schemaVersion, multiaddr, peerId, getKLocalPubkeyByAgentId } = opts;

  const healthResponseBody = JSON.stringify({
    status: "ok",
    nodeId,
    schemaVersion,
  });

  const bootstrapResponseBody = multiaddr
    ? JSON.stringify(peerId ? { multiaddr, peerId } : { multiaddr })
    : null;

  const server = createServer((req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(healthResponseBody);
      return;
    }

    if (req.method === "GET" && req.url === "/bootstrap") {
      if (bootstrapResponseBody !== null) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(bootstrapResponseBody);
      } else {
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "not ready" }));
      }
      return;
    }

    // AC-007a (DX-001): GET /agent-lookup?agent_id=<32hex>
    // Returns { k_local_pubkey: '<64hex>' } if found, 404 { error: 'not_found' } if not.
    // Routed via ALB BootstrapTargetGroup (port 9090), same as /bootstrap.
    if (req.method === "GET" && req.url?.startsWith("/agent-lookup")) {
      const parsed = parseUrl(req.url, true);
      const agentId = parsed.query["agent_id"];
      if (typeof agentId !== "string" || !/^[0-9a-f]{32}$/i.test(agentId)) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "invalid_agent_id", message: "agent_id must be exactly 32 lowercase hex chars" }));
        return;
      }
      if (!getKLocalPubkeyByAgentId) {
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "not_ready" }));
        return;
      }
      const kLocalPubkey = getKLocalPubkeyByAgentId(agentId);
      if (!kLocalPubkey) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "not_found" }));
        return;
      }
      // MED-2 (DX-001): Output validation — never return a value that isn't a 64-char
      // lowercase hex string. Malformed data from the store must not be forwarded to callers.
      if (!/^[0-9a-f]{64}$/.test(kLocalPubkey)) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "internal_error" }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ k_local_pubkey: kLocalPubkey }));
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  });

  return server;
}
