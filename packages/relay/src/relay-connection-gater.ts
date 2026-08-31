/**
 * CELLO Relay — connection gater (DOD-M15-RELAYAUTH-1)
 *
 * ─── Why this exists ──────────────────────────────────────────────────────────────────────────
 *
 * The relay audit's second finding: "a stranger can hold a circuit address and dial straight
 * through to an agent, because the libp2p hook that restricts who may dial a reservation holder
 * was never installed." The direct route was closed earlier in this milestone (frame-handler
 * hardening); this is the same door, other side — the relayed-fallback path, for when a direct
 * connection cannot be made.
 *
 * libp2p's `circuit-relay-v2` server already calls two `ConnectionGater` hooks that this relay
 * never supplied a gater for at all (verified against the installed package):
 *   - `denyInboundRelayReservation(source)` — before granting a NAT-traversal reservation.
 *   - `denyOutboundRelayedConnection(source, destination)` — before relaying a dial FROM `source`
 *     THROUGH this relay TO `destination`. This is the hook the audit named: nothing gated it, so
 *     any peer holding any keypair could dial any reservation holder it learned the address of.
 *
 * ─── Two different bars, and why they differ ─────────────────────────────────────────────────
 *
 * DIAL-THROUGH is gated on a real credential: it is refused unless a directory-signed session
 * assignment names BOTH the dialer and the destination as participants (via their EPHEMERAL
 * SESSION libp2p Peer IDs, bound at `recordAssignment()` time — see `recordSessionBinding`). This
 * is the hard boundary; it cannot be bypassed by anything short of forging a directory signature.
 *
 * RESERVATION GRANTS cannot be gated the same way. Traced end to end (both repos) before writing
 * this: an agent requests its NAT-traversal reservation at `cello_start_agent` time — before it
 * has ever spoken CELLO's own relay protocol to ANYONE, often against a relay chosen independently
 * of which relay any later session will actually use. A gate that denied the reservation outright
 * for an unproven peer would strand every brand-new agent's very first reservation, every time —
 * the exact class of outage `DOD-NAT-REACHABILITY-1` already fixed once. So reservations are
 * granted immediately, exactly as today, and instead time-box UNPROVEN possession: if the holder
 * has not completed the relay's own Ed25519 challenge-response (`relay_auth_ok` — proof of key
 * possession, not yet a session) within a grace window, the reservation is revoked by disconnecting
 * them. `recordAuthenticated` cancels the timer the moment that proof arrives. The client side of
 * this (cello-client) now authenticates proactively as soon as it secures a reservation, instead of
 * waiting for a session to exist — see session-node-manager.ts's `#authenticateStandingReceiver`.
 *
 * This reservation timer is NOT the security boundary — an attacker who keeps an unproven
 * reservation alive within the grace window still cannot be DIALED THROUGH to, because that is
 * gated independently and unconditionally on a real session assignment. The timer exists so a
 * relay is not left indefinitely serving reservation slots to keypairs that never prove anything.
 */

import type { ConnectionGater } from "@libp2p/interface";
import type { PeerId } from "@libp2p/interface";
import type { CelloNode } from "@cello-protocol/transport";
import type { Logger } from "@cello-protocol/interfaces";
import { truncId } from "./protocol-log.js";

/**
 * Default grace window for an unproven reservation holder. Generous relative to how fast a
 * well-behaved client authenticates (it does so as its very next action after reserving — no
 * user-perceptible delay), tight enough that a relay does not carry dead-weight reservations for
 * long. A judgement call; overridable per deployment.
 */
export const DEFAULT_RESERVATION_GRACE_MS = 15_000;

export interface RelayConnectionGaterOptions {
  logger: Logger;
  /** See `DEFAULT_RESERVATION_GRACE_MS`. */
  reservationGraceMs?: number;
}

export class RelayConnectionGater implements ConnectionGater {
  readonly #logger: Logger;
  readonly #graceMs: number;
  #node: CelloNode | null = null;

  /** Transport peer ids (libp2p PeerId, stringified) that have completed relay_auth. */
  readonly #authenticatedPeers = new Set<string>();
  /** Transport peer id → pending revoke timer, for a reservation granted before auth completed. */
  readonly #pendingRevoke = new Map<string, NodeJS.Timeout>();
  /** session_id_hex → the two EPHEMERAL SESSION peer ids a recorded assignment names. */
  readonly #sessionBindings = new Map<string, { initiator: string; counterparty: string }>();
  /**
   * Review L3: transport peer id → when this relay granted it a reservation. Diagnostics only —
   * nothing gates on it. It exists so a denial can distinguish "the assignment has not arrived here
   * yet" from "this dialer has no business with this destination", which the reason string alone
   * cannot. Bounded the same way `#authenticatedPeers` is, and by the same population.
   */
  readonly #reservedAt = new Map<string, number>();

  constructor(opts: RelayConnectionGaterOptions) {
    this.#logger = opts.logger;
    this.#graceMs = opts.reservationGraceMs ?? DEFAULT_RESERVATION_GRACE_MS;
  }

  /**
   * Wire the live node in AFTER `createNode()` resolves — the gater must exist and be passed into
   * `createNode({ connectionGater })` before any `CelloNode` exists to revoke a connection on, so
   * this is a required second step, not a constructor dependency cycle.
   */
  attachNode(node: CelloNode): void {
    this.#node = node;
  }

  /** Call on every successful `relay_auth_ok` — cancels this peer's pending revoke, if any. */
  recordAuthenticated(peerId: string): void {
    this.#authenticatedPeers.add(peerId);
    const timer = this.#pendingRevoke.get(peerId);
    if (timer) {
      clearTimeout(timer);
      this.#pendingRevoke.delete(peerId);
    }
  }

  /** Call from `recordAssignment()` when both session Peer IDs are present on the assignment. */
  recordSessionBinding(sessionIdHex: string, initiator: string, counterparty: string): void {
    this.#sessionBindings.set(sessionIdHex, { initiator, counterparty });
  }

  /** Call from `#cleanupSessionTracking` — a torn-down session no longer authorizes a dial-through. */
  removeSessionBinding(sessionIdHex: string): void {
    this.#sessionBindings.delete(sessionIdHex);
  }

  /** For tests and an operator surface that wants the number, mirroring other bounded maps here. */
  pendingRevokeCount(): number {
    return this.#pendingRevoke.size;
  }

  /**
   * denyInboundRelayReservation: NEVER denies at grant time (see the class header for why), but
   * starts the grace-window revoke timer for a peer this relay has not seen prove key possession.
   */
  denyInboundRelayReservation(source: PeerId): boolean {
    const id = source.toString();
    if (this.#authenticatedPeers.has(id)) return false;
    if (this.#pendingRevoke.has(id)) return false; // timer already running from an earlier reservation attempt
    const timer = setTimeout(() => {
      this.#pendingRevoke.delete(id);
      if (this.#authenticatedPeers.has(id)) return; // authenticated in the last tick before firing
      this.#logger.warn("relay.reservation.revoked", {
        peerId: truncId(id),
        graceMs: this.#graceMs,
        reason: "no_relay_auth_within_grace_window",
        impact: "this reservation is being closed because its holder never proved Ed25519 key " +
          "possession via relay_auth — it was never usable to reach anyone regardless (dial-through " +
          "requires a separate, unconditional session-assignment check), so this only reclaims the slot",
      });
      this.#node?.hangUp(id).catch((err: unknown) => {
        this.#logger.debug("relay.reservation.revoke.hangup_failed", {
          peerId: truncId(id),
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }, this.#graceMs);
    // Review L1: a pending revoke must not hold the process open. Without unref, a relay asked to
    // stop sat there for up to the full grace window per reserving peer waiting on timers whose only
    // job is to hang up connections that are about to be torn down anyway.
    timer.unref?.();
    this.#pendingRevoke.set(id, timer);
    this.#reservedAt.set(id, Date.now());
    return false;
  }

  /**
   * Review L1: drop every pending revoke timer. Called from the relay's own `stop()` — the sweeps
   * there were already cleared, and these were not, so the gater alone could keep the event loop
   * alive after a clean shutdown.
   */
  stop(): void {
    for (const timer of this.#pendingRevoke.values()) clearTimeout(timer);
    this.#pendingRevoke.clear();
  }

  /**
   * denyOutboundRelayedConnection: the hook the audit named as "never installed." Denies unless a
   * currently-recorded session assignment names both `source` and `destination` (in either order —
   * either may be the one initiating the dial-through).
   */
  denyOutboundRelayedConnection(source: PeerId, destination: PeerId): boolean {
    const s = source.toString();
    const d = destination.toString();
    for (const binding of this.#sessionBindings.values()) {
      if ((binding.initiator === s && binding.counterparty === d) ||
          (binding.initiator === d && binding.counterparty === s)) {
        return false; // allow
      }
    }
    /**
     * Review L3: say enough to tell the two causes apart.
     *
     * "No assignment names both peers" is accurate and is an exit-point label. It reads as a
     * directory or credential problem, and it sent people hunting one — when the far more common
     * cause was a TIMING race: the assignment existed and simply had not been presented here yet
     * (review H1). The two extra fields separate them. A destination with NO bindings at all, whose
     * reservation was granted moments ago, is a race. A destination holding bindings to other peers
     * is a genuinely unauthorized dial.
     */
    let bindingsForDestination = 0;
    for (const binding of this.#sessionBindings.values()) {
      if (binding.initiator === d || binding.counterparty === d) bindingsForDestination++;
    }
    const reservedAt = this.#reservedAt.get(d);
    this.#logger.warn("relay.circuit.dial_denied", {
      source: truncId(s),
      destination: truncId(d),
      reason: "no_session_assignment_names_both_peers",
      destinationBindingCount: bindingsForDestination,
      destinationReservedMsAgo: reservedAt === undefined ? -1 : Date.now() - reservedAt,
      impact: "this relayed dial was refused — no recorded session assignment authorizes it. " +
        "destinationBindingCount 0 with a recent destinationReservedMsAgo usually means the " +
        "assignment has not been presented to THIS relay yet, not that the dialer is unauthorized; " +
        "a non-zero count means this destination is in other sessions but not one with this source. " +
        "destinationReservedMsAgo of -1 means this relay holds no reservation for the destination.",
    });
    return true; // deny
  }
}
