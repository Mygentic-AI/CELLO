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

// ─── DOD-RELAY-DIRECTORY-RECONNECT-1: directory reachability, and the probe that watches it ───
//
// On 2026-08-08 every seal on the fleet failed for four hours while this file's health endpoint
// returned a constant `{ relayId, status: 'ok' }` computed once at startup. The relay could not
// reach any directory and therefore could not notarize a single session, and it passed every probe
// — so nothing alerted and the autohealer never replaced it.
//
// WHY THE THRESHOLD IS NOT ONE. A probe that fails on the first failed call would mark EVERY relay
// unhealthy during any transient directory blip, and the autohealer would cycle the entire fleet at
// once — which fixes nothing and removes the capacity that was still working. Sustained failure is
// the signal; a single miss is weather.
//
// WHY "NOT YET PROBED" IS HEALTHY. A relay that has just booted, or one with no directory
// configured at all, has no evidence either way. Reporting unhealthy there would fail every relay
// for the first seconds of its life and would make a local dev relay permanently unhealthy.

/** Consecutive failed probes before the relay reports itself unfit. */
export const DIRECTORY_UNHEALTHY_AFTER_CONSECUTIVE_FAILURES = 3;

export interface DirectoryHealthSnapshot {
  /** False only once failure is SUSTAINED — see the threshold note above. */
  reachable: boolean;
  consecutiveFailures: number;
  /** null until the first successful contact — distinguishes "never tried" from "tried and failed". */
  lastSuccessMs: number | null;
  lastFailureMs: number | null;
  lastReason?: string;
  lastDetail?: string;
}

export interface DirectoryHealthState {
  recordSuccess(): void;
  recordFailure(reason: string, detail?: string): void;
  snapshot(): DirectoryHealthSnapshot;
}

export function createDirectoryHealthState(now: () => number = Date.now): DirectoryHealthState {
  let consecutiveFailures = 0;
  let lastSuccessMs: number | null = null;
  let lastFailureMs: number | null = null;
  let lastReason: string | undefined;
  let lastDetail: string | undefined;

  return {
    recordSuccess() {
      consecutiveFailures = 0;
      lastSuccessMs = now();
      lastReason = undefined;
      lastDetail = undefined;
    },
    recordFailure(reason: string, detail?: string) {
      consecutiveFailures += 1;
      lastFailureMs = now();
      lastReason = reason;
      lastDetail = detail;
    },
    snapshot() {
      return {
        reachable: consecutiveFailures < DIRECTORY_UNHEALTHY_AFTER_CONSECUTIVE_FAILURES,
        consecutiveFailures,
        lastSuccessMs,
        lastFailureMs,
        ...(lastReason === undefined ? {} : { lastReason }),
        ...(lastDetail === undefined ? {} : { lastDetail }),
      };
    },
  };
}

export interface DirectoryProbeOptions {
  /** One round trip to the directory. Read-only — it must never mutate consortium state. */
  probe: () => Promise<{ ok: true } | { ok: false; reason: string; detail?: string }>;
  state: DirectoryHealthState;
  intervalMs: number;
  logger: Logger;
}

/**
 * Ask the directory whether it is there, on an interval, and record the answer.
 *
 * THE RELAY MUST BE ITS OWN DETECTOR. The connection died during a 2.5-hour window in which nobody
 * closed a session, and the first thing that noticed was a user's close hanging for seven minutes.
 * Nothing else in the process ever touches that connection between seals.
 *
 * Transitions are logged rather than every tick: a probe every 30s that logged each result would
 * bury the two lines that matter under thousands that do not.
 */
export function startDirectoryProbe(opts: DirectoryProbeOptions): () => void {
  const { probe, state, intervalMs, logger } = opts;
  let stopped = false;
  let wasReachable = true;

  const tick = async (): Promise<void> => {
    if (stopped) return;
    let result: { ok: true } | { ok: false; reason: string; detail?: string };
    try {
      result = await probe();
    } catch (err: unknown) {
      result = { ok: false, reason: "probe_threw", detail: err instanceof Error ? err.message : String(err) };
    }
    if (stopped) return;

    if (result.ok) {
      state.recordSuccess();
      if (!wasReachable) {
        wasReachable = true;
        logger.info("relay.directory.connection.restored", {});
      }
      return;
    }

    state.recordFailure(result.reason, result.detail);
    const snap = state.snapshot();
    if (wasReachable && !snap.reachable) {
      wasReachable = false;
      // ERROR, not WARN: at this point the relay cannot complete a seal for anyone, which is the
      // whole job. The previous incident produced only INFO and a WARN that also fired on success.
      logger.error("relay.directory.connection.lost", {
        reason: result.reason,
        detail: result.detail ?? "",
        consecutiveFailures: snap.consecutiveFailures,
      });
    }
  };

  const handle = setInterval(() => { void tick(); }, intervalMs);
  // Never hold the process open for a health probe — shutdown must not wait on it.
  handle.unref?.();
  return () => { stopped = true; clearInterval(handle); };
}

export interface RelayHealthServerOptions {
  relayId: string;
  logger: Logger;
  /**
   * Current directory reachability. Omitted when no directory is configured (local dev), in which
   * case the relay reports healthy — there is nothing to be unreachable.
   */
  directoryHealth?: () => DirectoryHealthSnapshot;
}

/**
 * Creates and returns (but does not start) an HTTP server that serves
 * the /health endpoint for the relay. The caller is responsible for
 * calling .listen().
 *
 * Response format: { relayId: string, status: 'ok' }
 */
export function createRelayHealthServer(opts: RelayHealthServerOptions): Server {
  const { relayId, directoryHealth } = opts;

  const server = createServer((req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      // COMPUTED PER REQUEST, not once at startup. The constant body was the reason a relay that
      // could not notarize anything for four hours passed every probe.
      const directory = directoryHealth?.();
      const healthy = directory === undefined || directory.reachable;
      // The directory block rides EVERY response, including 200s, so a relay can be watched
      // degrading rather than discovered at the moment it crosses the threshold.
      const body = JSON.stringify({
        relayId,
        status: healthy ? "ok" : "degraded",
        ...(directory === undefined ? {} : { directory }),
      });
      res.writeHead(healthy ? 200 : 503, { "Content-Type": "application/json" });
      res.end(body);
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  });

  return server;
}
