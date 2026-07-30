/**
 * Anti-entropy sync service — the libp2p face of `/cello/anti-entropy/1.0.0` (M12
 * DOD-AE-APPEND-1 / DOD-AE-MUTABLE-1; design §1a/§1c/§3/§6).
 *
 * Owns exactly three things; ALL protocol logic stays in the proven ae-channel layer:
 *  1. `streamWire` — adapts a libp2p Stream (lp varint framing, house convention) to `AeWire`.
 *  2. The responder registration: every inbound stream is served by `serveAeResponder`, channel-
 *     bound to the CONNECTION's Noise-authenticated remote PeerId (the transport's second handler
 *     arg — transport ≥0.0.27). A transport that doesn't deliver it fails CLOSED, never open.
 *  3. The dial loop: every `intervalMs`, dial each OTHER manifest node that carries a `peerId`
 *     (pre-M12 entries without one are unsyncable by design — the manifest must rotate first) and
 *     run the dialer side. Peers are pulled FROM; convergence comes from both nodes dialing each
 *     other. Failures are per-peer isolated: one unreachable node never blocks the others
 *     (sovereign-node fallback is a first-class concern).
 *
 * Observability (§6, injected logger, correlationId minted once per round):
 *   antientropy.peer.authenticated / antientropy.peer.auth_failed {peerNodeId, reason}
 *   antientropy.round.started / .completed {peerNodeId, pulled, applied, durationMs} / .failed
 *   antientropy.round.fork_suspected {peerNodeId, consecutive} — the engine's fork signature
 *     (`pulled > 0 && applied === 0`) seen ≥2 consecutive rounds against one peer. This is the
 *     consumer the engine header contracts; a repeating signature is an alarm, never health.
 */

import { randomUUID } from "node:crypto";
import * as lp from "it-length-prefixed";
import type { Stream } from "@libp2p/interface";
import type { ConsortiumManifest } from "@cello-protocol/protocol-types";
import type { Logger } from "@cello-protocol/interfaces";
import {
  AE_PROTOCOL_ID, runAeDialer, serveAeResponder,
  type AeWire, type AeNodeIdentity, AeProtocolError } from "./ae-channel.js";
import type { AeStoreView } from "./anti-entropy-engine.js";

/** The transport surface the service needs (structurally satisfied by CelloNode). */
export interface AeTransport {
  handle(
    protocolId: string,
    handler: (stream: Stream, remotePeerId?: string) => void | Promise<void>,
    opts?: { maxInboundStreams?: number },
  ): Promise<void>;
  dial(multiaddr: string): Promise<{ peerId: string }>;
  newStream(peerId: string, protocolId: string): Promise<Stream>;
}

/** Adapt a libp2p Stream to the channel's AeWire (lp varint framing, one CBOR frame per message). */
export function streamWire(stream: Stream): AeWire {
  const frames = lp.decode(stream)[Symbol.asyncIterator]();
  return {
    send(bytes) {
      stream.send(lp.encode.single(bytes));
    },
    async next() {
      try {
        const { value, done } = await frames.next();
        if (done || value === undefined) return null;
        return value instanceof Uint8Array ? value : (value as { subarray(): Uint8Array }).subarray();
      } catch (err) {
        // NOT swallowed into `null`. `null` means "the peer finished" and the channel renders it as
        // "wire closed while waiting for X" — which is a lie for the case that actually bites first:
        // `lp.decode` is called without options, so `maxDataLength` is the library default 4 MiB,
        // while `lp.encode.single` has NO cap. A responder serving a whole table in one frame (a node
        // rejoining with an empty DB, pulling all of agent_profiles) sends a frame OUR OWN decoder
        // then refuses — and the operator was told the network closed the wire, so they go and read
        // the peer's logs, which show a clean successful serve.
        throw new AeProtocolError(`AE frame read failed: ${describeThrown(err)}`);
      }
    },
    close() {
      stream.close().catch(() => { /* already closing */ });
    },
  };
}

/**
 * Render a thrown value for a log field.
 *
 * `String(err)` on a plain object yields the literally useless "[object Object]", and libp2p dial
 * failures throw aggregates rather than Errors — so an anti-entropy round that could not reach a
 * peer reported its cause as "[object Object]" and an operator learned nothing at all. Errors must
 * name their cause; that includes the ones that are not Error instances.
 */
export function describeThrown(err: unknown): string {
  if (err instanceof Error) {
    // AggregateError carries the real reasons in .errors; the outer message is usually generic.
    const inner = (err as { errors?: unknown[] }).errors;
    if (Array.isArray(inner) && inner.length > 0) {
      return `${err.message} [${inner.map((e) => (e instanceof Error ? e.message : String(e))).join("; ")}]`;
    }
    return err.message;
  }
  if (err !== null && typeof err === "object") {
    const o = err as Record<string, unknown>;
    const parts = ["name", "code", "message", "reason"]
      .filter((k) => typeof o[k] === "string" || typeof o[k] === "number")
      .map((k) => `${k}=${String(o[k])}`);
    if (parts.length > 0) return parts.join(" ");
    try {
      return JSON.stringify(err).slice(0, 300);
    } catch {
      return "unserialisable thrown object";
    }
  }
  return String(err);
}

/**
 * Derive the AE dial multiaddr for a manifest entry.
 *
 * **`endpoint` is the HTTP base, not the libp2p address, and the two are not always the same
 * port.** On AWS one ALB port fronts both `/bootstrap` and the WebSocket upgrade, so deriving the
 * dial address from `endpoint` happened to work. On a node with no load balancer they are
 * different listeners: `/bootstrap` is on the HTTP server and the WS upgrade is on the protocol
 * port. Deriving from `endpoint` there makes anti-entropy dial the HTTP server, which is not a
 * libp2p listener, and every round fails — while the manifest, the endpoint and the peerId are all
 * individually correct.
 *
 * So an entry MAY carry an explicit `multiaddr`, and when it does that is authoritative. Absent it,
 * the derivation is unchanged (https → tcp/443/wss, http → tcp/80/ws; IPv4-literal host → /ip4/,
 * hostname → /dns4/) so pre-M12 and AWS manifests behave exactly as before.
 */
export function manifestEntryMultiaddr(endpoint: string, peerId: string, multiaddr?: string): string {
  if (multiaddr) {
    return multiaddr.includes("/p2p/") ? multiaddr : `${multiaddr}/p2p/${peerId}`;
  }
  const url = new URL(endpoint);
  const https = url.protocol === "https:";
  const port = url.port !== "" ? Number(url.port) : https ? 443 : 80;
  const hostProto = /^\d{1,3}(\.\d{1,3}){3}$/.test(url.hostname) ? "ip4" : "dns4";
  return `/${hostProto}/${url.hostname}/tcp/${port}/${https ? "wss" : "ws"}/p2p/${peerId}`;
}

export interface AeSyncConfig {
  transport: AeTransport;
  /** Returns the current officer-VERIFIED manifest (§1b — the verifying store's getter). */
  manifest: () => ConsortiumManifest;
  identity: AeNodeIdentity;
  store: AeStoreView;
  logger: Logger;
  /** Dial-loop period. Default 60s. */
  intervalMs?: number;
}

export class AeSyncService {
  readonly #cfg: AeSyncConfig;
  #timer: ReturnType<typeof setInterval> | undefined;
  /** Per-peer consecutive fork-signature counter (pulled>0 && applied===0). */
  readonly #forkStreak = new Map<string, number>();

  constructor(cfg: AeSyncConfig) {
    this.#cfg = cfg;
  }

  /** Register the responder handler and start the periodic dial loop. */
  async start(): Promise<void> {
    const { transport, logger } = this.#cfg;
    await transport.handle(AE_PROTOCOL_ID, (stream, remotePeerId) => {
      void this.#serveInbound(stream, remotePeerId);
    }, { maxInboundStreams: 8 }); // peers = manifest nodes only — a small, known set

    const intervalMs = this.#cfg.intervalMs ?? 60_000;
    this.#timer = setInterval(() => {
      this.syncAllPeers().catch((err) => {
        logger.error("antientropy.round.failed", {
          reason: describeThrown(err),
          scope: "dial_loop",
        });
      });
    }, intervalMs);
    this.#timer.unref?.();
  }

  stop(): void {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = undefined;
  }

  async #serveInbound(stream: Stream, remotePeerId: string | undefined): Promise<void> {
    const { logger } = this.#cfg;
    // Channel binding needs the CONNECTION identity. No remotePeerId (pre-0.0.27 transport)
    // → fail CLOSED: refuse the stream rather than serve an unbindable peer.
    if (!remotePeerId) {
      logger.error("antientropy.peer.auth_failed", {
        peerNodeId: "unknown",
        reason: "transport_no_remote_peerid",
      });
      stream.close().catch(() => { /* closing */ });
      return;
    }
    try {
      await serveAeResponder({
        wire: streamWire(stream),
        manifest: this.#cfg.manifest(),
        identity: this.#cfg.identity,
        actualRemotePeerId: remotePeerId,
        store: this.#cfg.store,
      });
    } catch (err) {
      // A failed handshake / protocol violation. The stream is already closed by the responder's
      // own `finally` (serveAeResponder); name the cause (§6) — unauthenticated-attempt count
      // should be zero in a healthy consortium.
      logger.warn("antientropy.peer.auth_failed", {
        peerNodeId: "unproven", // identity claims before auth completes are unproven — never log them as fact
        remotePeerId,
        reason: describeThrown(err),
      });
    }
  }

  /** One pass over every OTHER manifest node with a dial identity. Per-peer isolation. */
  async syncAllPeers(): Promise<void> {
    const manifest = this.#cfg.manifest();
    for (const node of manifest.nodes) {
      if (node.nodeId === this.#cfg.identity.nodeId) continue;
      if (!node.peerId || !node.endpoint) continue; // pre-M12 entry — unsyncable until rotation
      await this.syncPeer(node.nodeId, node.endpoint, node.peerId, (node as { multiaddr?: string }).multiaddr);
    }
  }

  /** One dial + handshake + rounds attempt against a peer. */
  async #attempt(peerNodeId: string, endpoint: string, peerId: string, multiaddr?: string) {
    const { transport } = this.#cfg;
    // The dial pins /p2p/<manifest peerId>; libp2p aborts if the remote's Noise key mismatches.
    // Still, channel-bind against the OBSERVED identity the dial returned — evidence, not intent.
    const dialed = await transport.dial(manifestEntryMultiaddr(endpoint, peerId, multiaddr));
    const stream = await transport.newStream(dialed.peerId, AE_PROTOCOL_ID);
    return runAeDialer({
      wire: streamWire(stream),
      manifest: this.#cfg.manifest(),
      identity: this.#cfg.identity,
      remoteNodeId: peerNodeId,
      actualRemotePeerId: dialed.peerId,
      store: this.#cfg.store,
    });
  }

  /** Dial one peer and run the pull side; emits the §6 round events. Never throws. */
  async syncPeer(peerNodeId: string, endpoint: string, peerId: string, multiaddr?: string): Promise<void> {
    const { logger } = this.#cfg;
    const correlationId = randomUUID();
    const startMs = Date.now();
    logger.info("antientropy.round.started", { peerNodeId, correlationId });
    try {
      let result = await this.#attempt(peerNodeId, endpoint, peerId, multiaddr);
      // §1c manifest-rotation skew: during a rollout the peer may hold vN+1 while we still run vN
      // (or vice versa) — a sync outage here is a KILL-SWITCH PROPAGATION outage. On an identity-
      // binding failure, re-read the manifest (the verifying store re-reads + re-verifies from
      // disk) and retry ONCE with the possibly-fresh entry. auth_failed is emitted only after
      // both attempts fail. (Accepting the immediately-previous manifest — the other half of the
      // §1c rule — requires previous-manifest retention on both sides; owed, journaled.)
      // Scoped to the two reasons a manifest ROTATION can actually explain. It previously included
      // the catch-all that also meant "this peer is not in my manifest at all" — which no re-read can
      // fix, so every unknown peer cost a manifest re-read plus a second full dial, every interval.
      if (!result.ok && (result.reason === "manifest_entry_incomplete" || result.reason === "peerid_mismatch")) {
        const refreshed = this.#cfg.manifest().nodes.find((n) => n.nodeId === peerNodeId);
        if (refreshed?.peerId && refreshed.endpoint) {
          result = await this.#attempt(peerNodeId, refreshed.endpoint, refreshed.peerId, (refreshed as { multiaddr?: string }).multiaddr);
        }
      }
      if (!result.ok) {
        // `detail` carries WHY — which field the peer sent wrong, which value was rejected.
        // `reason` alone is the exit-point label: every distinct handshake violation arrives as
        // the single class "protocol_error", so dropping detail here discards the one piece of
        // information the handshake went to the trouble of producing.
        logger.warn("antientropy.peer.auth_failed", {
          peerNodeId,
          reason: result.reason,
          ...(result.detail !== undefined && { detail: result.detail }),
          correlationId,
        });
        return;
      }
      logger.info("antientropy.peer.authenticated", { peerNodeId, correlationId });

      const pulled = result.rounds.reduce((n, r) => n + r.tierAPulled + r.tierBPulled, 0);
      const applied = result.rounds.reduce((n, r) => n + r.tierAApplied + r.tierBApplied, 0);
      const planned = result.rounds.reduce((n, r) => n + r.tierAPlanned + r.tierBPlanned, 0);
      const failures = result.rounds.flatMap((r) => r.failures);

      // A table this node does not track, advertised by the peer — normal mid-rolling-deploy, and
      // silent until now. Named at WARN because the consequence is that the table is NOT replicating
      // in this direction until both nodes carry it.
      for (const u of result.unknownTables) {
        logger.warn("antientropy.round.table_unknown", {
          peerNodeId, tier: u.tier, table: u.table, correlationId,
          reason: "peer advertises a table this node does not track — skipped, so it is not replicating in this direction",
        });
      }
      logger.info("antientropy.round.completed", {
        peerNodeId, pulled, applied, planned, durationMs: Date.now() - startMs, correlationId,
      });

      // A table that failed no longer takes the round with it, so it has to be SAID — otherwise the
      // round reports completed while one table silently stopped replicating from this peer.
      for (const f of failures) {
        logger.error("antientropy.round.table_failed", {
          peerNodeId, tier: f.tier, table: f.table, reason: f.reason, correlationId,
        });
      }

      // SHORTFALL: the plan asked for records the peer did not serve. Tier-A is append-only and
      // Tier-B keys come from the peer's own advertisement, so on the normal path served === planned
      // — this never fires benignly, which is what makes it a signal. A withholding peer otherwise
      // returns pulled 0 / applied 0, which is byte-identical to convergence.
      const shortfall = planned - pulled;
      if (shortfall > 0) {
        logger.error("antientropy.round.shortfall", {
          peerNodeId, planned, served: pulled, shortfall, correlationId,
          reason: "peer advertised records it then did not serve — this round is NOT evidence of convergence",
        });
      }

      // The engine's fork signature: pulled>0 while applied===0. One occurrence can be a benign
      // mid-round write; a STREAK is a same-key/different-content fork that will never converge.
      // A shortfall or a table failure must NOT reset the streak: both mean this round proved
      // nothing, and clearing the counter on a round that proved nothing is how a fork hides.
      if (shortfall > 0 || failures.length > 0) {
        // leave the streak untouched — neither confirmed nor cleared
      } else if (pulled > 0 && applied === 0) {
        const streak = (this.#forkStreak.get(peerNodeId) ?? 0) + 1;
        this.#forkStreak.set(peerNodeId, streak);
        if (streak >= 2) {
          logger.error("antientropy.round.fork_suspected", { peerNodeId, consecutive: streak, correlationId });
        }
      } else {
        this.#forkStreak.delete(peerNodeId);
      }
    } catch (err) {
      logger.warn("antientropy.round.failed", {
        peerNodeId,
        reason: describeThrown(err),
        durationMs: Date.now() - startMs,
        correlationId,
      });
    }
  }
}
