/**
 * Health check HTTP server for DEPLOY-002.
 *
 * Pseudocode:
 *   1. Create an HTTP server listening on the configured port.
 *   2. On GET /health, return 200 with JSON { status: "ok", nodeId, schemaVersion }.
 *   3. On any other path, return 404.
 *   4. Response must complete within 5 seconds (ECS health check timeout).
 *
 * The health server runs alongside the libp2p directory node inside the same
 * ECS task. The ALB target group health check hits GET /health on port 443.
 */

import { createServer, type Server } from "node:http";
import type { Logger } from "@cello-protocol/interfaces";

export interface HealthServerOptions {
  nodeId: string;
  schemaVersion: number;
  logger: Logger;
  port: number;
}

/**
 * Creates and returns (but does not start) an HTTP server that serves
 * the /health endpoint. The caller is responsible for calling .listen().
 */
export function createHealthServer(opts: HealthServerOptions): Server {
  const { nodeId, schemaVersion } = opts;

  const responseBody = JSON.stringify({
    status: "ok",
    nodeId,
    schemaVersion,
  });

  const server = createServer((req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(responseBody);
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  });

  return server;
}
