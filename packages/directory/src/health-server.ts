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
 * ECS task. The ALB target group health check hits GET /health on port 443.
 * The bootstrap endpoint is used by cello-mcp to auto-discover the directory
 * multiaddr without requiring manual CELLO_DIRECTORY_MULTIADDR configuration.
 */

import { createServer, type Server } from "node:http";
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
}

/**
 * Creates and returns (but does not start) an HTTP server that serves
 * the /health and /bootstrap endpoints. The caller is responsible for calling .listen().
 */
export function createHealthServer(opts: HealthServerOptions): Server {
  const { nodeId, schemaVersion, multiaddr, peerId } = opts;

  const healthResponseBody = JSON.stringify({
    status: "ok",
    nodeId,
    schemaVersion,
  });

  const bootstrapResponseBody = multiaddr
    ? JSON.stringify({ multiaddr, peerId: peerId ?? "" })
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

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  });

  return server;
}
