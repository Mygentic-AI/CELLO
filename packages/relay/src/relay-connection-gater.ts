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

/**
 * DOD-M15-RELAYSLOTS-1 — the most reservation slots one registered agent may hold on one relay.
 *
 * An agent legitimately holds roughly one slot per live conversation plus one waiting: the receiver
 * promoted into a session, and the replacement built behind it. Thirty-two is generous against that
 * and still bounds the flood: filling a 4096-slot table would take about 128 registered agents, and
 * registration is email-gated and involves a threshold ceremony, so they are not free the way
 * keypairs are.
 *
 * The number is a judgement call and is meant to be revisited with real occupancy data. What is NOT
 * a judgement call is that reclaiming happens before refusing — see `admitSlot`.
 */
export const SLOT_CAP_PER_AGENT = 32;

/**
 * DOD-M15-RELAYSLOTS-1 — how long a slot must have carried NO traffic before the ledger will
 * reclaim it to make room for the same agent's new reservation.
 *
 * ⚠️ THIS FLOOR EXISTS BECAUSE THE RULE WITHOUT IT BROKE A LIVE SESSION, and the failure is worth
 * keeping written down because it is the shape this whole unit is meant to avoid. Reclaiming any
 * traffic-free slot on sight looks obviously safe, and it is not: an agent promoted into a session
 * builds a REPLACEMENT standing receiver immediately, and at that instant the promoted receiver has
 * carried nothing yet. The reclaim hung it up, and its counterparty's messages were then delivered
 * to a node no longer connected. An existing test caught it; nothing about the rule looked wrong.
 *
 * Five minutes is far beyond the seconds a promotion takes and far below the hours a stranded
 * connection lingers. It is also only a BACKSTOP: the common case — a daemon restart — is handled
 * by the disconnect path, which frees the slot at once.
 */
export const SLOT_RECLAIM_MIN_IDLE_MS = 5 * 60 * 1000;

export interface RelayConnectionGaterOptions {
  logger: Logger;
  /** See `DEFAULT_RESERVATION_GRACE_MS`. */
  reservationGraceMs?: number;
  /** See `SLOT_CAP_PER_AGENT`. Overridable per deployment and for tests. */
  slotCapPerAgent?: number;
}

/**
 * One reservation slot, from the moment it is granted until the peer goes away.
 *
 * `agentPubkeyHex` is null between the grant and the authentication that attributes it — a real
 * state, not a transient one: an unproven holder sits there until its grace timer revokes it.
 */
interface SlotRecord {
  /**
   * The registered agents reachable through this reservation. Empty between the grant and the first
   * authentication — a real state, not a transient one: an unproven holder sits there until its
   * grace timer revokes it.
   *
   * ⚠️ A SET, NOT ONE KEY. A reservation belongs to a transport connection, and nothing in the
   * protocol says one connection carries exactly one agent. An earlier version refused a second
   * agent authenticating over the same connection, which broke two existing rate-limit tests that
   * use precisely that shape to isolate the peer axis from the pubkey axis. Charging the slot to
   * every agent that authenticated over it is both honest and the conservative direction: each is
   * counted for capacity they can genuinely reach through.
   */
  agents: Set<string>;
  grantedAt: number;
  /**
   * When traffic last flowed over this slot, or null if it never has.
   *
   * ⚠️ ACTIVITY, NOT SESSION BINDINGS, and the choice matters. The relay CARRIES the traffic, so it
   * cannot be wrong about whether any flowed — and it is a sound signal precisely because nothing
   * can flow until a directory-signed assignment was presented. Classifying by binding instead is
   * wrong in three ordinary cases: the session never touched this relay, the assignment arrived
   * late, or the session ended while the reservation lingered.
   */
  lastActivityAt: number | null;
}

/** Why a slot was refused. Travels to the operator and is branched on by the daemon. */
export type SlotRefusal = { ok: false; reason: "slot_cap_exceeded"; held: number; cap: number };

export type SlotAdmission = { ok: true } | SlotRefusal;

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

  /**
   * DOD-M15-RELAYSLOTS-1 — the slot ledger. Transport peer id → what that slot is and who holds it.
   *
   * Keyed by peer id because that is what a reservation IS; attributed to an agent key because that
   * is the only thing stable across a daemon restart, and a restart regenerating its peer id is
   * precisely why the relay used to strand a slot per restart.
   */
  readonly #slots = new Map<string, SlotRecord>();
  readonly #slotCap: number;

  constructor(opts: RelayConnectionGaterOptions) {
    this.#logger = opts.logger;
    this.#graceMs = opts.reservationGraceMs ?? DEFAULT_RESERVATION_GRACE_MS;
    this.#slotCap = opts.slotCapPerAgent ?? SLOT_CAP_PER_AGENT;
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

  // ─── DOD-M15-RELAYSLOTS-1: the slot ledger ──────────────────────────────────────────────────

  /** How many slots this agent currently holds here. Only ATTRIBUTED slots count. */
  slotCountForAgent(agentPubkeyHex: string): number {
    let n = 0;
    for (const slot of this.#slots.values()) {
      if (slot.agents.has(agentPubkeyHex)) n++;
    }
    return n;
  }

  /** Total slots held, attributed or not — the number that approaches the relay's ceiling. */
  slotCount(): number {
    return this.#slots.size;
  }

  /**
   * Traffic flowed over this peer's slot. Called from the relay's own submit path, which is the one
   * place that cannot be mistaken about it.
   */
  recordActivity(peerId: string): void {
    const slot = this.#slots.get(peerId);
    if (slot) slot.lastActivityAt = Date.now();
  }

  /**
   * The peer is gone. Free its slot NOW rather than counting it until the reservation TTL expires —
   * that delay is how an agent that restarts a handful of times exhausts its own cap while holding
   * nothing.
   */
  recordDisconnect(peerId: string): void {
    this.#slots.delete(peerId);
    this.#reservedAt.delete(peerId);
    this.#authenticatedPeers.delete(peerId);
    const timer = this.#pendingRevoke.get(peerId);
    if (timer) {
      clearTimeout(timer);
      this.#pendingRevoke.delete(peerId);
    }
  }

  /**
   * Attribute this peer's slot to a registered agent, and decide whether the agent may keep it.
   *
   * Called once the relay has verified the agent's directory-issued online token, so
   * `agentPubkeyHex` is a fact rather than a claim. Returning a refusal means the relay refuses the
   * authentication and leaves the grace-window revoke timer running, so the slot is reclaimed.
   *
   * ─── RECLAIM BEFORE REFUSE ────────────────────────────────────────────────────────────────
   *
   * Before the cap is consulted, every slot this agent holds that has NEVER carried traffic is
   * released. That serves two purposes at once, and the second is not anti-abuse at all:
   *
   *  - it bounds the flood without the cap having to be tight, and
   *  - it fixes an ordinary bug. Every daemon restart used to consume a fresh slot and hold the old
   *    one for its full TTL, because the peer id changed and the relay could not tell it was the
   *    same agent.
   *
   * The ordering is the safety property, not a nicety. The relay's view of what is "in use" is
   * imperfect, so reclaiming first means a counting mistake costs an idle slot; refusing first means
   * it costs a real agent its front door. Every outage in this area came from the latter.
   */
  admitSlot(peerId: string, agentPubkeyHex: string): SlotAdmission {
    const existing = this.#slots.get(peerId);
    const now = Date.now();

    /**
     * Reclaim first (see above). Four conditions, and every one of them is load-bearing:
     *  - not this peer's own slot;
     *  - this agent is the ONLY one reachable through it, so releasing it cannot strand a
     *    co-tenant agent that has nothing to do with this reservation;
     *  - it has never carried traffic;
     *  - and it has been that way for longer than a promotion takes — see
     *    `SLOT_RECLAIM_MIN_IDLE_MS`, which exists because omitting it hung up a live session's
     *    receiver at the exact moment its replacement authenticated.
     */
    const reclaimed: string[] = [];
    for (const [id, slot] of this.#slots) {
      if (id === peerId) continue;
      if (!slot.agents.has(agentPubkeyHex) || slot.agents.size !== 1) continue;
      if (slot.lastActivityAt !== null) continue;
      if (now - slot.grantedAt < SLOT_RECLAIM_MIN_IDLE_MS) continue;
      reclaimed.push(id);
    }
    for (const id of reclaimed) {
      this.#logger.info("relay.slot.reclaimed", {
        peerId: truncId(id),
        agentPubkey: truncId(agentPubkeyHex),
        reason: "agent_re_reserved_while_holding_an_unused_slot",
        impact: "this slot had never carried traffic and its holder has re-reserved from a new " +
          "transport identity — almost always a daemon restart. Released so the agent is not " +
          "charged twice for one standing receiver.",
      });
      this.#releaseSlot(id);
    }

    /**
     * The cap is consulted whenever this slot is not ALREADY attributed to this agent — which is
     * every first authentication, including the common one where `denyInboundRelayReservation` has
     * already created an unattributed record for this peer.
     *
     * ⚠️ Written as `!existing` first, and the ledger test caught it: a reservation is always
     * granted before its holder authenticates, so `existing` is virtually never absent in
     * production and the cap was skipped on every real call. The check that mattered ran only on a
     * path the relay does not take.
     */
    if (!existing?.agents.has(agentPubkeyHex)) {
      const held = this.slotCountForAgent(agentPubkeyHex);
      if (held >= this.#slotCap) {
        this.#logger.warn("relay.slot.cap_exceeded", {
          agentPubkey: truncId(agentPubkeyHex),
          peerId: truncId(peerId),
          held,
          cap: this.#slotCap,
          impact: "this agent already holds the most reservation slots one agent may hold on this " +
            "relay, and none of them is idle enough to reclaim. Refused. For a real operator this " +
            "usually means sessions that fell apart are still counted — the refusal carries the " +
            "count so they can see what is being refused on.",
        });
        return { ok: false, reason: "slot_cap_exceeded", held, cap: this.#slotCap };
      }
    }

    if (existing) {
      existing.agents.add(agentPubkeyHex);
    } else {
      this.#slots.set(peerId, { agents: new Set([agentPubkeyHex]), grantedAt: now, lastActivityAt: null });
    }
    return { ok: true };
  }

  /** Hang the peer up and drop its ledger entry. */
  #releaseSlot(peerId: string): void {
    this.#slots.delete(peerId);
    this.#reservedAt.delete(peerId);
    this.#authenticatedPeers.delete(peerId);
    const timer = this.#pendingRevoke.get(peerId);
    if (timer) {
      clearTimeout(timer);
      this.#pendingRevoke.delete(peerId);
    }
    this.#node?.hangUp(peerId).catch((err: unknown) => {
      this.#logger.debug("relay.slot.release.hangup_failed", {
        peerId: truncId(peerId),
        error: err instanceof Error ? err.message : String(err),
      });
    });
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
      // DOD-M15-RELAYSLOTS-1: the slot goes with the reservation. Leaving the ledger entry behind
      // would count capacity this relay no longer serves, which is the wrong direction to be wrong
      // in — it would make the reaper refuse while the table was not actually full.
      this.#slots.delete(id);
      this.#reservedAt.delete(id);
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
    // DOD-M15-RELAYSLOTS-1: the slot exists from the moment it is granted, unattributed until the
    // holder authenticates. Recorded here so the total occupancy the reaper works against counts
    // reservations nobody has claimed yet — they take capacity exactly like the claimed ones do.
    if (!this.#slots.has(id)) {
      this.#slots.set(id, { agents: new Set(), grantedAt: Date.now(), lastActivityAt: null });
    }
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
