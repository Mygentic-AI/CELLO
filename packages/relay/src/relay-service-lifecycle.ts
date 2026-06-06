/**
 * Relay service lifecycle observability events for DEPLOY-003.
 *
 * Pseudocode (Phase P):
 *   logRelayServiceStarted(logger, ctx):
 *     // Emit relay.service.started at INFO with { relayId, region, environment }
 *     // relayId = hex of Ed25519 public key derived from node-private-key
 *     logger.info("relay.service.started", { relayId, region, environment })
 *
 *   logRelayServiceStopped(logger, ctx):
 *     // Emit relay.service.stopped at INFO with { relayId, region, environment, uptimeMs }
 *     logger.info("relay.service.stopped", { relayId, region, environment, uptimeMs })
 *
 *   logRelayServiceStartFailed(logger, ctx):
 *     // SI-001: MUST NOT include relayId — key may not have been loaded yet
 *     // Emit relay.service.start.failed at ERROR with { reason, region }
 *     logger.error("relay.service.start.failed", { reason, region })
 *
 *   logRelayServiceCrashed(logger, ctx):
 *     // Emit relay.service.crashed at ERROR with { relayId, region, reason }
 *     logger.error("relay.service.crashed", { relayId, region, reason })
 *
 *   createRelayHealthServer(opts):
 *     // Create HTTP server. GET /health → 200 { relayId, status: 'ok' }
 *     // Any other path → 404.
 *     // Response must complete within 2 seconds (ECS health check timeout).
 *     server = createServer(handler)
 *     return server  // caller calls .listen()
 *
 * Events:
 *   relay.service.started      — INFO  — { relayId, region, environment }
 *   relay.service.stopped      — INFO  — { relayId, region, environment, uptimeMs }
 *   relay.service.start.failed — ERROR — { reason, region }
 *   relay.service.crashed      — ERROR — { relayId, region, reason }
 */

import { createServer, type Server } from "node:http";
import type { Logger, LogContext } from "@cello-protocol/interfaces";

// ─── relay.service.started ─────────────────────────────────────────────────────

export interface RelayServiceStartedContext {
  relayId: string;
  region: string;
  environment: string;
}

export function logRelayServiceStarted(logger: Logger, ctx: RelayServiceStartedContext): void {
  logger.info("relay.service.started", ctx as unknown as LogContext);
}

// ─── relay.service.stopped ─────────────────────────────────────────────────────

export interface RelayServiceStoppedContext {
  relayId: string;
  region: string;
  environment: string;
  uptimeMs: number;
}

export function logRelayServiceStopped(logger: Logger, ctx: RelayServiceStoppedContext): void {
  logger.info("relay.service.stopped", ctx as unknown as LogContext);
}

// ─── relay.service.start.failed ────────────────────────────────────────────────
//
// SI-001: this event MUST NOT include relayId.
// The relay private key may not have been loaded yet when this event fires.
// Including relayId here would require the key — which creates a temptation
// to log key bytes on error. The context contains only { reason, region }.

export interface RelayServiceStartFailedContext {
  reason: string;
  region: string;
}

export function logRelayServiceStartFailed(logger: Logger, ctx: RelayServiceStartFailedContext): void {
  logger.error("relay.service.start.failed", ctx as unknown as LogContext);
}

// ─── relay.service.crashed ─────────────────────────────────────────────────────

export interface RelayServiceCrashedContext {
  relayId: string;
  region: string;
  reason: string;
}

export function logRelayServiceCrashed(logger: Logger, ctx: RelayServiceCrashedContext): void {
  logger.error("relay.service.crashed", ctx as unknown as LogContext);
}

// ─── Health server (AC-007) ────────────────────────────────────────────────────
//
// GET /health returns HTTP 200 with JSON { relayId, status: 'ok' }.
// All other paths return 404.
// Used by the directory's relay pool health checks (INFRA-009).
// Exposed on port 4000 inside the VPC — not on the public ALB.

export interface RelayHealthServerOptions {
  relayId: string;
  logger: Logger;
  /** When true, /health returns 503 until markRegistered() is called.
   *  Set to true when CELLO_DIRECTORY_MULTIADDR is configured — a relay that
   *  hasn't registered cannot participate in session assignment and must not
   *  be treated as healthy by ECS or the directory's health checks. */
  requiresRegistration: boolean;
}

export interface RelayHealthServer {
  server: Server;
  /** Call once relay_register succeeds. Unblocks /health from 503 → 200. */
  markRegistered(): void;
}

/**
 * Creates and returns (but does not start) an HTTP server that serves
 * the /health endpoint for the relay. The caller is responsible for
 * calling .listen().
 *
 * When requiresRegistration is true, /health returns 503 with
 * { relayId, status: 'starting', reason: 'awaiting_directory_registration' }
 * until markRegistered() is called, after which it returns 200 with
 * { relayId, status: 'ok' }.
 *
 * This ensures ECS does not route traffic to a relay that cannot issue
 * verifiable ACKs — an unregistered relay has no place in the manifest
 * and cannot participate in session assignment.
 */
export function createRelayHealthServer(opts: RelayHealthServerOptions): RelayHealthServer {
  const { relayId, requiresRegistration } = opts;

  let registered = !requiresRegistration;

  const server = createServer((req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      if (registered) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ relayId, status: "ok" }));
      } else {
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ relayId, status: "starting", reason: "awaiting_directory_registration" }));
      }
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  });

  return {
    server,
    markRegistered(): void {
      registered = true;
    },
  };
}
