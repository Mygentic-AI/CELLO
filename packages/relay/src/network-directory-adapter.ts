/**
 * NetworkDirectoryAdapter — DirectoryAdapter backed by /cello/directory-relay/1.0.0.
 *
 * Used by the relay binary when directory and relay run as separate processes.
 * When bilateral SEAL leaves are detected, the relay calls processSeal() here,
 * which dials the directory and sends a seal_submission frame.
 *
 * FEDERATION-003: also implements registerWithDirectory() for relay startup registration.
 * The relay sends a relay_register frame containing its relayId, publicKeyHex, region,
 * timestamp, and a self-signature (SI-003). The directory verifies the signature and
 * writes to relay_registrations.
 */

import { Encoder, decode as cborDecode } from "cbor-x";
import * as lp from "it-length-prefixed";
import type { KeyProvider } from "@cello-protocol/crypto";
import { buildRelayRegistrationTbs } from "@cello-protocol/crypto";
import type { CelloNode } from "@cello-protocol/transport";
import type { Logger } from "@cello-protocol/interfaces";
import type { DirectoryAdapter } from "./relay-node.js";
import type { SealData } from "./relay-types.js";

const CBOR_ENC = new Encoder({ useRecords: false, mapsAsObjects: false });
const DIRECTORY_RELAY_PROTOCOL_ID = "/cello/directory-relay/1.0.0";

/**
 * Render whatever was thrown into a reason an operator can act on.
 *
 * `CelloNode` does NOT throw Errors — it throws structured plain objects:
 *
 *     throw { reason: "connection_lost", peerId, message: `No open connection to peer ${id}` };
 *
 * The previous `err instanceof Error ? err.message : "directory_unavailable"` therefore collapsed
 * EVERY transport failure into the single string `directory_unavailable`, which names a condition
 * (the directory is not reachable) that was not the one occurring. On 2026-08-08 that cost a day:
 * seals were refused with "directory unavailable" while all three directories were healthy, on the
 * right schema, with matching peer IDs and an open port — the actual fault being a dead local
 * connection. Distinct causes must produce distinct reasons.
 */
function describeThrown(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && err !== null) {
    const structured = err as { reason?: unknown; message?: unknown };
    const reason = typeof structured.reason === "string" ? structured.reason : undefined;
    const message = typeof structured.message === "string" ? structured.message : undefined;
    if (reason && message) return `${reason}: ${message}`;
    if (reason) return reason;
    if (message) return message;
  }
  if (typeof err === "string" && err.length > 0) return err;
  // Genuinely nothing to report. Kept as the last resort ONLY — never as a stand-in for a cause
  // that was available and discarded.
  return "directory_unavailable";
}

/** The stale-handle signal: a connection that libp2p no longer holds open. Repairable by redialling. */
function isConnectionLost(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { reason?: unknown }).reason === "connection_lost"
  );
}

export interface NetworkDirectoryAdapterOptions {
  directoryPeerId: string;
  directoryMultiaddrs: string[];
  /** Optional logger — when provided, relay.registered / relay.already.registered are
   *  logged at INFO with { relayId, region } on successful registration (AC-002). */
  logger?: Logger;
  /**
   * EVERY directory this relay may have to call, as pubkey → multiaddr — not just the configured
   * one. A seal is adjudicated by the directory that BROKERED the session, and may then follow a
   * redirect to a third; the probe watching only the configured one read green for eight hours
   * across a connection the seal needed and could not use (2026-08-19). Optional so a
   * single-directory deployment is unchanged.
   */
  allDirectoryEndpointsByPubkey?: Record<string, string>;
}

export class NetworkDirectoryAdapter implements DirectoryAdapter {
  readonly #directoryPeerId: string;
  readonly #directoryMultiaddrs: string[];
  readonly #logger: Logger | undefined;
  readonly #allDirectoryEndpoints: Record<string, string>;
  /** Last observed reachability per peer id, so the probe logs TRANSITIONS rather than every tick. */
  readonly #lastReachable = new Map<string, boolean>();
  /** When each directory last served a stream, so a death can be reported with a duration. */
  readonly #lastGoodMs = new Map<string, number>();
  #node: CelloNode | null = null;

  constructor(opts: NetworkDirectoryAdapterOptions) {
    this.#directoryPeerId = opts.directoryPeerId;
    this.#directoryMultiaddrs = opts.directoryMultiaddrs;
    this.#logger = opts.logger;
    this.#allDirectoryEndpoints = opts.allDirectoryEndpointsByPubkey ?? {};
  }

  /** peerId → addrs for every directory we might call; the configured one is always included. */
  #probeTargets(): Array<{ peerId: string; addrs: string[] }> {
    const byPeer = new Map<string, string[]>();
    byPeer.set(this.#directoryPeerId, this.#directoryMultiaddrs);
    for (const multiaddr of Object.values(this.#allDirectoryEndpoints)) {
      const parts = multiaddr.split("/");
      const i = parts.findIndex((p) => p === "p2p");
      const peerId = i !== -1 ? parts[i + 1] : undefined;
      // A malformed endpoint is skipped rather than probed as the configured directory — probing
      // the wrong peer is exactly the green-while-dead failure this exists to end.
      if (peerId && !byPeer.has(peerId)) byPeer.set(peerId, [multiaddr]);
    }
    return [...byPeer].map(([peerId, addrs]) => ({ peerId, addrs }));
  }

  connect(node: CelloNode): void {
    this.#node = node;

    // DOD-M12-CONN-OBSERVE-1: record the DEATH, not only the corpse.
    //
    // Every failure this milestone investigated was observed at the moment somebody tried to USE a
    // connection — minutes or hours after it actually died — so the cause was never in the logs and
    // three candidate mechanisms survived a full investigation. A connection to a directory going
    // away is a fleet-level event: ordinary message relaying does not touch these links, so nothing
    // else will ever surface it, and the first symptom is a customer's close timing out.
    //
    // Scoped to DIRECTORY peers deliberately. This node also holds a connection to every client
    // using the relay, and logging those would bury the handful of lines that matter.
    const directoryPeers = new Set(this.#probeTargets().map((t) => t.peerId));
    node.onPeerConnect((peerId: string) => {
      if (!directoryPeers.has(peerId)) return;
      this.#logger?.info("relay.directory.connection.opened", { peerId });
    });
    node.onPeerDisconnect((peerId: string) => {
      if (!directoryPeers.has(peerId)) return;
      const lastGood = this.#lastGoodMs.get(peerId);
      this.#logger?.warn("relay.directory.connection.closed", {
        peerId,
        ...(lastGood !== undefined ? { heldForMs: Date.now() - lastGood } : {}),
        impact: "seals adjudicated by this directory are refused until the connection is rebuilt; "
          + "message relaying is unaffected, so nothing else will surface it",
      });
    });
  }

  /**
   * What libp2p thinks it holds for a peer, at this instant.
   *
   * `status` is the SOCKET status and is NOT the muxer's — the two are separate fields checked in
   * that order when opening a stream, muxer first. So a stream failing with
   * `The connection muxer is "closed" and not "open"` returns before the socket is examined, and
   * this is the only way to learn which of the two we are actually looking at. `status: "open"`
   * next to a muxer failure is the case where a plain redial CANNOT help, because that is exactly
   * the connection libp2p's dial will hand back.
   *
   * Optional-chained on the field: an older `@cello-protocol/transport` returns entries without a
   * status, and reporting `undefined` honestly beats inventing "open".
   */
  #connSnapshot(peerId: string): { count: number; statuses: string[] } {
    try {
      const conns = this.#node?.getConnections().filter((c) => c.peerId === peerId) ?? [];
      return {
        count: conns.length,
        statuses: conns.map((c) => (c as { status?: string }).status ?? "unreported"),
      };
    } catch {
      return { count: -1, statuses: [] }; // never let instrumentation break a seal
    }
  }

  /**
   * DOD-RELAY-DIRECTORY-RECONNECT-1 — can this relay reach a directory RIGHT NOW?
   *
   * The reconnect above repairs the connection when a seal asks for it. This is the other half: the
   * relay must find out BEFORE a user does. On 2026-08-08 the connection died inside a 2.5-hour
   * window in which nobody closed a session, and the first thing that noticed was an operator's
   * close hanging for seven minutes — because nothing in the process touches that connection
   * between seals.
   *
   * DELIBERATELY THE SAME TRANSPORT A SEAL USES (`#openDirectoryStream`). A probe that dials by some
   * other route can be green while the route that matters is dead, which is precisely the failure it
   * exists to catch. It opens the stream and closes it: no frame is sent, so it cannot mutate
   * consortium state and cannot be mistaken for a seal submission.
   *
   * Returns a NAMED reason rather than throwing — the caller is a timer loop, and a throw there is
   * an unhandled rejection rather than a health signal. `directory_not_connected` (our own wiring)
   * stays distinct from a transport failure (the network); those are opposite bugs.
   */
  async checkDirectoryReachable(): Promise<{ ok: true } | { ok: false; reason: string; detail?: string }> {
    const node = this.#node;
    if (!node) return { ok: false, reason: "directory_not_connected" };

    // EVERY directory, not just the configured one. On 2026-08-19 this probe reported nothing at
    // all for the eight hours in which the connection a seal needed died — because the seal used
    // the BROKERING directory and then a redirect to a third, and this watched neither.
    const results: Array<{ peerId: string; ok: boolean; detail?: string }> = [];
    for (const { peerId, addrs } of this.#probeTargets()) {
      try {
        const stream = await this.#openDirectoryStream(node, addrs, peerId);
        await stream.close();
        results.push({ peerId, ok: true });
        this.#lastGoodMs.set(peerId, Date.now());
      } catch (err: unknown) {
        results.push({ peerId, ok: false, detail: describeThrown(err) });
      }
    }

    // TRANSITIONS ONLY. The failing state produced 220 lines an hour before, which is noise that
    // hides the one line that matters: the moment it changed. Each flip is logged once, and a
    // death carries how long that directory had been working — the duration we have never had.
    for (const r of results) {
      const was = this.#lastReachable.get(r.peerId);
      if (was === r.ok) continue;
      this.#lastReachable.set(r.peerId, r.ok);
      if (was === undefined) continue; // first observation is a baseline, not a transition
      if (r.ok) {
        this.#logger?.warn("relay.directory.reachability.recovered", { peerId: r.peerId });
      } else {
        const lastGood = this.#lastGoodMs.get(r.peerId);
        this.#logger?.warn("relay.directory.reachability.lost", {
          peerId: r.peerId,
          reason: r.detail,
          ...(lastGood !== undefined ? { workingForMs: Date.now() - lastGood } : {}),
          impact: "seals adjudicated by this directory will be refused until the connection is "
            + "repaired; ordinary message relaying is unaffected, so nothing else will surface it",
        });
      }
    }

    // The health surface keeps its existing meaning — the CONFIGURED directory — so a green
    // /health does not silently change definition. The per-directory truth is in the log above.
    const configured = results.find((r) => r.peerId === this.#directoryPeerId);
    if (configured && !configured.ok) {
      return { ok: false, reason: "directory_unreachable", ...(configured.detail ? { detail: configured.detail } : {}) };
    }
    return { ok: true };
  }

  /**
   * Open a directory stream, repairing a stale connection rather than failing on it.
   *
   * WHY THIS EXISTS. `connect()` is called once at relay boot and the handle is then trusted for the
   * life of the process — relays run for days. libp2p connections do not. When the connection to a
   * directory dropped, `newStream` found nothing open and threw, and the seal was refused outright
   * with no attempt to reconnect. Live on 2026-08-08: a relay 3 days into its life stopped sealing
   * entirely and stayed that way; every seal failed in UNDER A MILLISECOND because `getConnections()`
   * is an in-memory lookup that never touches the network. The last working seal had taken 79ms — a
   * real round trip. Restarting the relay "fixed" it, which is the tell that the fault was in state
   * held across the process's life, not in the fleet.
   *
   * The dial loop no longer swallows. Its empty `catch {}` meant a total dial failure produced no log
   * line at all, so the window in which the connection died contained zero evidence.
   *
   * Exactly one redial. A stale handle is repaired by the retry; a directory that is genuinely down
   * fails both attempts and must surface as such rather than spinning.
   */
  async #openDirectoryStream(node: CelloNode, addrs: string[], peerId: string) {
    /**
     * DOD-M12-CONN-EVICT-1: remove the registered connection so the redial below can do something.
     *
     * `libp2p.dial()` does not always reach the network — `openConnection` returns an EXISTING
     * connection whenever one is registered for the peer and its socket status reads `open`
     * (`findExistingConnection` filters on `con.status` and never looks at the muxer). So against a
     * dead muxer the old redial resolved from the registry, handed the same object back, and the
     * retry failed on the identical check that had just failed. That is why 38 refused seals all
     * carried a redial that "ran", and why only a process restart ever cleared it.
     */
    const evict = async (): Promise<"evicted" | "unavailable" | "failed"> => {
      // Narrow local type rather than a blanket cast: `hangUp` ships in
      // @cello-protocol/transport and this repo floats on `latest`, so a relay built before that
      // version is promoted must still run. Absence is REPORTED, never defaulted — without this
      // line a relay silently keeps the exact behaviour this unit exists to remove, and its logs
      // would look identical to a fixed one.
      const withHangUp = node as Partial<{ hangUp(p: string): Promise<void> }>;
      if (typeof withHangUp.hangUp !== "function") {
        this.#logger?.error("relay.directory.evict.unavailable", {
          peerId,
          impact: "this relay's @cello-protocol/transport predates hangUp, so the redial below can "
            + "only return the dead connection it already holds — seals adjudicated by this "
            + "directory will keep failing until the relay is rebuilt on a newer transport",
        });
        return "unavailable";
      }
      try {
        await withHangUp.hangUp(peerId);
        return "evicted";
      } catch (err: unknown) {
        // Does NOT rethrow. The caller is repairing a connection that is already unusable; failing
        // the repair here would replace a recoverable stale handle with a hard error, and the dial
        // that follows may still succeed.
        this.#logger?.warn("relay.directory.evict.failed", {
          peerId,
          reason: describeThrown(err),
          impact: "the dead connection may still be registered, so the redial can return it",
        });
        return "failed";
      }
    };

    const dial = async (): Promise<void> => {
      // MECHANISM 2. An empty list means the loop below never runs, `lastError` stays undefined,
      // nothing is logged, and the caller cannot tell this apart from a dial that worked. That is
      // a candidate cause of the live failure, so it gets its own line rather than silence.
      if (addrs.length === 0) {
        this.#logger?.warn("relay.directory.dial.no_address", {
          peerId,
          impact: "no address to dial, so the redial did nothing — the caller will see the same "
            + "dead connection it already had",
        });
        return;
      }
      let lastError: unknown;
      for (const addr of addrs) {
        try {
          await node.dial(addr);
          return;
        } catch (err: unknown) {
          lastError = err;
        }
      }
      if (lastError !== undefined) {
        this.#logger?.warn("relay.directory.dial.failed", {
          peerId,
          addressesTried: addrs.length,
          reason: describeThrown(lastError),
        });
      }
    };

    await dial();
    try {
      return await node.newStream(peerId, DIRECTORY_RELAY_PROTOCOL_ID);
    } catch (err: unknown) {
      if (!isConnectionLost(err)) throw err;
      // The SOCKET status beside the muxer failure is the measurement the whole diagnosis turned
      // on. libp2p checks muxer first and returns, so this error alone cannot distinguish a dead
      // muxer on a live socket — where a plain redial is a no-op, because that is precisely the
      // connection `dial()` hands back — from a connection that is dead through. Recorded before
      // the eviction, because eviction destroys the evidence.
      const before = this.#connSnapshot(peerId);
      this.#logger?.warn("relay.directory.connection.stale", {
        peerId,
        reason: describeThrown(err),
        action: "evicting, redialling and retrying once",
        connectionsBefore: before.count,
        socketStatusBefore: before.statuses,
      });
      const eviction = await evict();
      await dial();
      const after = this.#connSnapshot(peerId);
      try {
        const stream = await node.newStream(peerId, DIRECTORY_RELAY_PROTOCOL_ID);
        this.#logger?.warn("relay.directory.redial.outcome", {
          peerId,
          eviction,
          connectionsBefore: before.count,
          connectionsAfter: after.count,
          socketStatusBefore: before.statuses,
          socketStatusAfter: after.statuses,
          recovered: true,
        });
        return stream;
      } catch (retryErr: unknown) {
        this.#logger?.warn("relay.directory.redial.outcome", {
          peerId,
          eviction,
          connectionsBefore: before.count,
          connectionsAfter: after.count,
          socketStatusBefore: before.statuses,
          socketStatusAfter: after.statuses,
          recovered: false,
          reason: describeThrown(retryErr),
          // Reads the EVICTION first, because after this unit a repeat of the original failure
          // means something other than a stale handle and must not be diagnosed as one again.
          reading: eviction !== "evicted"
            ? "the dead connection was NOT evicted, so the dial could still return it — this is the "
              + "pre-fix behaviour and the eviction field says why"
            : "evicted and redialled and the stream STILL failed — not a stale handle; the "
              + "directory is refusing streams and no reconnect on this side will cure it",
        });
        throw retryErr;
      }
    }
  }

  /**
   * FEDERATION-003 AC-002 + CELLO-M6B-006: Register the relay with the directory.
   *
   * Pseudocode:
   *   1. Derive the self-signature TBS: buildRelayRegistrationTbs(relayId, publicKeyHex, timestamp)
   *      (FIPS 180-4 SHA-256 over UTF-8(relayId) || UTF-8(publicKeyHex) || timestamp_BE8)
   *   2. Sign TBS with the relay's Ed25519 key (RFC 8032).
   *   3. Send relay_register frame to directory:
   *      { type, relay_id, public_key_hex, region, health_check_url, timestamp, signature }
   *   4. Read response:
   *      - relay_register_ok   → return { ok: true }
   *      - relay_register_error with already_registered → return { ok: true, alreadyRegistered: true }
   *      - relay_register_error with RELAY_IDENTITY_CONFLICT → return { ok: false, reason: "RELAY_IDENTITY_CONFLICT" }
   *      - other / no response → return { ok: false, reason }
   *
   * @param params.relayId - hex encoding of the relay's Ed25519 public key
   * @param params.publicKeyHex - same as relayId (relay_id = hex(pubkey) by convention)
   * @param params.region - AWS region where this relay runs
   * @param params.healthCheckUrl - CELLO-M6B-006: VPC-internal health check URL
   * @param params.keyProvider - signing key for the self-signature (RFC 8032 Ed25519)
   */
  async registerWithDirectory(params: {
    relayId: string;
    publicKeyHex: string;
    region: string;
    healthCheckUrl: string;
    multiaddr: string;
    keyProvider: KeyProvider;
    /**
     * Which directory to register with. Defaults to the configured one.
     *
     * EVERY sovereign node needs to hear this independently. Each directory keeps its OWN relay
     * manifest, in its own regional bucket, and reads only that copy — so a relay that registers
     * with one node is invisible to the other two forever. Live on 2026-08-08: us-east1's manifest
     * was at v6 and current, while us-central1 and europe-west1 were both frozen on a v5 written ten
     * days earlier, because nothing had ever registered with them.
     */
    target?: { peerId: string; multiaddr: string };
  }): Promise<{ ok: true; alreadyRegistered?: boolean } | { ok: false; reason: string }> {
    if (!this.#node) return { ok: false, reason: "directory_unavailable" };

    const { relayId, publicKeyHex, region, healthCheckUrl, multiaddr, keyProvider, target } = params;
    const timestamp = Date.now();

    // SI-003: sign the TBS with the relay's own private key.
    // Only the holder of the private key corresponding to publicKeyHex can produce this signature.
    const tbs = buildRelayRegistrationTbs(relayId, publicKeyHex, timestamp);
    let signature: Uint8Array;
    try {
      signature = await keyProvider.sign(tbs);
    } catch (err: unknown) {
      return { ok: false, reason: err instanceof Error ? err.message : "sign_failed" };
    }

    const frame = CBOR_ENC.encode({
      type: "relay_register",
      relay_id: relayId,
      public_key_hex: publicKeyHex,
      region,
      health_check_url: healthCheckUrl,
      multiaddr,
      timestamp,
      signature,
    }) as Uint8Array;

    try {
      const stream = await this.#openDirectoryStream(
        this.#node,
        target ? [target.multiaddr] : this.#directoryMultiaddrs,
        target ? target.peerId : this.#directoryPeerId,
      );
      stream.send(lp.encode.single(frame));
      await stream.close();

      for await (const chunk of lp.decode(stream)) {
        const raw = chunk instanceof Uint8Array ? chunk : (chunk as unknown as { slice(): Uint8Array }).slice();
        const resp = cborDecode(raw) as Record<string, unknown>;
        if (resp["type"] === "relay_register_ok") {
          // CELLO-M6B-006: directory sends already_registered: true when the relay was
          // already registered with the same key (idempotent re-registration). This allows
          // the relay to log relay.already.registered rather than relay.registered (AC-002).
          const alreadyRegistered = resp["already_registered"] === true;
          // AC-002: log relay.registered or relay.already.registered at INFO with { relayId, region }
          if (alreadyRegistered) {
            this.#logger?.info("relay.already.registered", { relayId, region });
          } else {
            this.#logger?.info("relay.registered", { relayId, region });
          }
          return { ok: true, alreadyRegistered };
        }
        if (resp["type"] === "relay_register_error") {
          const reason = (resp["reason"] as string) ?? "directory_error";
          return { ok: false, reason };
        }
        return { ok: false, reason: "unexpected_response" };
      }
      return { ok: false, reason: "no_response" };
    } catch (err: unknown) {
      return { ok: false, reason: describeThrown(err) };
    }
  }

  /**
   * FEDERATION-003 AC-004: Look up a relay's registered public key from the directory.
   *
   * Sends a relay_pubkey_request frame over /cello/directory-relay/1.0.0.
   * Returns the public_key_hex string, or undefined if the relayId is not registered.
   * Used by the new relay when verifying a predecessor relay's ACK signature.
   */
  async getRelayPublicKey(relayId: string): Promise<string | undefined> {
    if (!this.#node) return undefined;

    const frame = CBOR_ENC.encode({
      type: "relay_pubkey_request",
      relay_id: relayId,
    }) as Uint8Array;

    try {
      const stream = await this.#openDirectoryStream(
        this.#node,
        this.#directoryMultiaddrs,
        this.#directoryPeerId,
      );
      stream.send(lp.encode.single(frame));
      await stream.close();

      for await (const chunk of lp.decode(stream)) {
        const raw = chunk instanceof Uint8Array ? chunk : (chunk as unknown as { slice(): Uint8Array }).slice();
        const resp = cborDecode(raw) as Record<string, unknown>;
        if (resp["type"] === "relay_pubkey_response") {
          return resp["public_key_hex"] as string | undefined;
        }
        return undefined;
      }
      return undefined;
    } catch {
      return undefined;
    }
  }

  async processSeal(
    sessionId: Uint8Array,
    sealData: SealData,
    /**
     * Optional override of WHICH directory adjudicates this seal. Defaults to the configured one.
     *
     * Needed because the seal must be adjudicated by a node that holds the seal initiator's
     * signaling stream — `seal_verified` is pushed from a LOCAL stream map, and notification_queue
     * is per-node and not replicated. The configured directory tells us where to go via a redirect;
     * the relay stores nothing about the consortium itself (DOD-INV-RELAY-EXTRACTABLE).
     */
    target?: { peerId: string; multiaddr: string },
  ): Promise<{ ok: true } | { ok: false; reason: string; redirect?: { nodeId: string; peerId: string; multiaddr: string } }> {
    if (!this.#node) return { ok: false, reason: "directory_unavailable" };

    const frame = CBOR_ENC.encode({
      type: "seal_submission",
      session_id: sessionId,
      leaves: sealData.leaves,
      merkle_root: sealData.merkle_root,
      seq_count: sealData.seq_count,
    }) as Uint8Array;

    try {
      // Ensure connected — to the redirect target when one was supplied, else the configured node.
      const addrs = target ? [target.multiaddr] : this.#directoryMultiaddrs;
      const peerId = target ? target.peerId : this.#directoryPeerId;

      const stream = await this.#openDirectoryStream(this.#node, addrs, peerId);
      stream.send(lp.encode.single(frame));
      await stream.close();

      for await (const chunk of lp.decode(stream)) {
        const raw = chunk instanceof Uint8Array ? chunk : (chunk as unknown as { slice(): Uint8Array }).slice();
        // `cborDecode`, matching registerWithDirectory and getRelayPublicKey. This call site used the
        // CBOR_ENC INSTANCE, which is constructed with `mapsAsObjects: false` — so it decodes a CBOR
        // map into a JS `Map`, and `resp["type"]` on a Map is always undefined. Every response then
        // fell through to the `?? "directory_error"` branch regardless of what the directory said.
        // Three call sites, two of them already correct; this was the odd one out.
        const resp = cborDecode(raw) as Record<string, unknown>;
        if (resp["type"] === "seal_received") return { ok: true };
        const redirect = resp["redirect"] as { nodeId: string; peerId: string; multiaddr: string } | undefined;
        return {
          ok: false,
          reason: (resp["reason"] as string) ?? "directory_error",
          ...(redirect?.peerId && redirect.multiaddr ? { redirect } : {}),
        };
      }
      return { ok: false, reason: "no_response" };
    } catch (err) {
      return { ok: false, reason: describeThrown(err) };
    }
  }
}
