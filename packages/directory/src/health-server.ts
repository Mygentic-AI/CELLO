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
import type { ConsortiumManifest } from "@cello-protocol/protocol-types";

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
  /**
   * CELLO-M7-CONN-001 (DOD-CONN-3): resolver for GET /manifest. Returns the current
   * signed consortium manifest, or null when no manifest store is configured / no
   * manifest is loaded yet. Injected from the composition root so health-server has no
   * direct dependency on the DirectoryManifestStore. The manifest is PUBLIC,
   * self-authenticating data (threshold-signed; clients verify against locally-pinned
   * root keys) — hence served unauthenticated, like /bootstrap and /agent-lookup.
   * Invariant (SI-002): the manifest carries ONLY the public node roster — nothing
   * agent-specific ever goes in it.
   */
  getCurrentManifest?: () => ConsortiumManifest | null;
  /**
   * DOD-REGISTRY-1: resolver for GET /registry. Returns the stored registry document
   * as raw bytes (opaque to the directory — clients verify the inner signature against
   * their build-time-pinned registry pubkey). 404 when no registry is published yet
   * (INV-TYPE-CARRY: absent = unclassified, not an error). Served unauthenticated on
   * port 9090, routed via the BootstrapTargetGroup ALB ListenerRule — same model as
   * /manifest (public, self-authenticating signed data).
   */
  getRegistryDocument?: () => { document: Buffer; version: number } | null;
}

/**
 * Creates and returns (but does not start) an HTTP server that serves
 * the /health and /bootstrap endpoints. The caller is responsible for calling .listen().
 */
export function createHealthServer(opts: HealthServerOptions): Server {
  const { nodeId, schemaVersion, multiaddr, peerId, getKLocalPubkeyByAgentId, getCurrentManifest, getRegistryDocument } = opts;

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

    // CELLO-M7-CONN-001 (DOD-CONN-3): GET /manifest — the consortium manifest poll over
    // unauthenticated HTTP. Returns the current signed manifest (clients verify the
    // threshold signature against locally-pinned root keys; the channel is not the trust
    // boundary). 503 until a manifest store is configured / a manifest is loaded — never a
    // junk body. Routed via the BootstrapTargetGroup ALB ListenerRule (AC-008), same as
    // /bootstrap and /agent-lookup. /health stays liveness-only and is unaffected.
    if (req.method === "GET" && req.url === "/manifest") {
      const manifest = getCurrentManifest ? getCurrentManifest() : null;
      if (manifest === null) {
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "not ready" }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(manifest));
      return;
    }

    // DOD-REGISTRY-1: GET /registry — the type registry poll over unauthenticated HTTP.
    // Same model as /manifest: public, self-authenticating signed data. Clients verify
    // the Ed25519 inner signature against a build-time-pinned registry pubkey. 404 when
    // no registry is published (INV-TYPE-CARRY: absent type = unclassified, not error).
    if (req.method === "GET" && req.url === "/registry") {
      const doc = getRegistryDocument ? getRegistryDocument() : null;
      if (doc === null) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "no_registry_published" }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/octet-stream", "x-cello-registry-version": String(doc.version) });
      res.end(doc.document);
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  });

  return server;
}
