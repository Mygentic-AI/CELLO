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
 * RESERVATION GRANTS are gated too, and getting there took three tries — the history is in the work
 * order and the short version is worth having here. libp2p hands `denyInboundRelayReservation` a
 * peer id and nothing else, so for as long as the client asked for its slot BEFORE saying who it
 * was, this hook had nothing to decide on: the slot was granted and the credential checked
 * afterwards, and an attacker who never opened an auth stream never met the check. Bounding the
 * damage downstream — per-address caps, an unproven budget, evicting the oldest — were all guesses
 * about who LOOKED bad, keyed on the one thing visible here, and a botnet walks through guesses.
 *
 * **The client now proves itself first**, so this hook asks a question of fact: does this peer have
 * a ledger entry naming a registered agent? A brand-new receiver's FIRST reservation is still
 * refused — it has proved nothing yet — and it then authenticates and asks again on the same
 * transport identity, which `#provenPeers` remembers across that reconnect. So the old warning
 * still holds in the only form that matters: denying an unproven peer would strand every new agent
 * IF the client did not prove first. It does.
 */

import type { ConnectionGater } from "@libp2p/interface";
import type { PeerId } from "@libp2p/interface";
import type { CelloNode } from "@cello-protocol/transport";
import type { Logger } from "@cello-protocol/interfaces";
import { truncId } from "./protocol-log.js";

export const SLOT_CAP_PER_AGENT = 32;

/**
 * DOD-M15-RELAYSLOTS-1 — how long the relay remembers that a peer id proved itself, after that
 * peer has disconnected.
 *
 * Spans one client reconnect and nothing more: the daemon proves on one connection and reserves on
 * the next, back to back. Two minutes is generous for that and short enough that a stale entry is
 * not a standing licence to reserve without proving.
 */
export const PROVEN_PEER_MEMORY_MS = 2 * 60 * 1000;

/**
 * DOD-M15-RELAYSLOTS-1 — **THE FLOOR. NOT A TUNING PARAMETER.**
 *
 * The reaper never touches a slot that has seen activity within six hours, however much pressure the
 * table is under. A conversation people are actually having can go quiet for an afternoon, and
 * tearing it down to free capacity is the same failure this unit exists to prevent, one level up:
 * refusing a legitimate agent, only worse, because it interrupts something already working.
 *
 * If everything is inside the floor, the reaper frees nothing and the relay refuses at the ceiling
 * instead. That is the correct outcome — at that point the table really is full of things in use.
 */
export const SLOT_REAP_ACTIVITY_FLOOR_MS = 6 * 60 * 60 * 1000;

/**
 * The relay's reservation ceiling. **Ours, not a default** — libp2p ships 15, which caused a real
 * outage: fifteen slots vanish immediately in normal use, because every agent needs one and (before
 * this unit) every daemon restart took a NEW one rather than reclaiming its own. Not to be reverted.
 * It does mean the number is a choice, and this is where it is written down.
 */
export const DEFAULT_SLOT_CEILING = 4096;

/**
 * How full the table must be before the reaper does anything at all.
 *
 * Below this line there is capacity to spare and reclaiming would cost some agent its front door to
 * free space nobody wanted. Above it, freeing a slot that has been silent for six hours is plainly
 * better than refusing the next agent to arrive.
 */
export const DEFAULT_REAP_PRESSURE_FRACTION = 0.8;

/** One slot the reaper freed, with what the relay needs to tell its holder why. */
export interface ReapedSlot {
  peerId: string;
  /** The agents reachable through it. Empty when it was never claimed by anyone. */
  agents: string[];
  /** How long it had been silent — what makes the notice explain itself rather than just assert. */
  idleMs: number;
}

export interface RelayConnectionGaterOptions {
  logger: Logger;
  /** See `SLOT_CAP_PER_AGENT`. Overridable per deployment and for tests. */
  slotCapPerAgent?: number;
  /** See `DEFAULT_SLOT_CEILING`. Must match the reservation limit the libp2p relay service runs with. */
  slotCeiling?: number;
  /** See `DEFAULT_REAP_PRESSURE_FRACTION`. */
  reapPressureFraction?: number;
}

/**
 * One reservation slot, from the moment its holder proves itself until the peer goes away.
 *
 * The entry now comes into existence at AUTHENTICATION, not at the grant — that inversion is the
 * whole of this order. There is no longer a window in which a slot is held by someone the relay
 * cannot name.
 */
interface SlotRecord {
  /**
   * DOD-M15-RELAYSLOTS-1: does a circuit RESERVATION back this entry, or is it merely a peer that
   * authenticated?
   *
   * The two are different populations and conflating them was a real defect: a session node that
   * dials the relay only to submit leaves holds no reservation, yet was being counted against the
   * ceiling that libp2p enforces on RESERVATIONS. The reaper's pressure line is a fraction of that
   * ceiling, so it could fire — and hang peers up — while the reservation table was nowhere near
   * full. Set by `denyInboundRelayReservation`, which is the only place a reservation is granted.
   */
  reserved: boolean;
  /**
   * DOD-M15-RELAYSLOTS-1 — **did this peer authenticate with a reservation as its stated purpose?**
   *
   * The gate requires it. Authenticating is not the same act as asking to hold a slot: a session
   * node dials in with `purpose: "delivery"` to submit a leaf, and it has no business reserving.
   * Without this flag its ledger entry — which the delivery auth legitimately creates — would have
   * satisfied the gate on its own, handing the reservation table a population the design never
   * described. Set only by a `purpose: "reservation"` auth, and it STAYS set: libp2p re-enters the
   * gate on every reservation refresh, and a refresh that found no proof would take a working
   * agent's front door away roughly half an hour after it opened.
   */
  provenForReservation: boolean;
  /**
   * The registered agents reachable through this reservation. Never empty in practice — the entry
   * is created by the authentication that names them.
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
  #node: CelloNode | null = null;

  /** session_id_hex → the two EPHEMERAL SESSION peer ids a recorded assignment names. */
  readonly #sessionBindings = new Map<string, { initiator: string; counterparty: string }>();
  /**
   * Review L3: transport peer id → when this relay granted it a reservation. Diagnostics only —
   * nothing gates on it. It exists so a denial can distinguish "the assignment has not arrived here
   * yet" from "this dialer has no business with this destination", which the reason string alone
   * cannot. Bounded by the slot ledger: every writer here has a matching delete in `#releaseSlot`
   * and `recordDisconnect`.
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

  /**
   * DOD-M15-RELAYSLOTS-1 — **peers that have proved themselves, remembered briefly after they go.**
   *
   * The gate needs to know, at reservation time, that this peer belongs to a registered agent. The
   * peer cannot tell it then: libp2p's hook carries only a peer id, and a reservation taken by hand
   * afterwards yields a slot with no dialable address, because libp2p only announces circuit
   * addresses for reservations its own discovery made. That was measured, not assumed.
   *
   * So the client proves itself on one connection, drops it, and comes back on a second connection
   * that reserves normally — SAME transport identity, because the daemon supplies the transport key.
   * This map is what carries the proof across that gap. Without it `recordDisconnect` would erase
   * the fact a moment before it is needed.
   *
   * Short-lived on purpose: it is crossing seconds, not sessions. An entry outliving its usefulness
   * is a peer id that can reserve without proving, which is the whole thing being prevented.
   *
   * ⚠️ **RESERVATION-PURPOSE AUTHS ONLY** — review finding 4. This used to be written on every
   * authentication, including the delivery auths a session node makes to submit a seal leaf. A
   * session node never asks for a reservation, so its entry was never read and never collected:
   * the only remover is the expiry branch of the gate, which runs only if that same peer id comes
   * back to reserve. On a busy relay the map grew without bound in ORDINARY traffic — no attacker
   * needed — and for two minutes each of those peer ids was licensed to take a reservation the
   * design never meant it to have. Written only where a reservation is the stated purpose, and
   * swept in `reapIdleSlots` so nothing depends on the peer coming back.
   */
  readonly #provenPeers = new Map<string, { agentPubkeyHex: string; expiresAt: number }>();

  /**
   * Peer ids that asked for a reservation without a proof, and when they first did.
   *
   * Not a gate — a NOISE FILTER, and review finding 3 is why it exists. Asking before proving is
   * the designed happy path: `#startReceiverNode` builds a receiver with a circuit listen address,
   * gets refused here, proves itself, and asks again. Logging that refusal at WARN made the single
   * highest-volume warning on the relay fire on the normal case, so an operator counting warnings
   * to spot a flood would have been counting their own agents. A peer that asks, is told to prove,
   * and asks AGAIN without proving is the shape that means something — that one is warned about.
   */
  readonly #unprovenAsks = new Map<string, number>();
  readonly #slotCap: number;
  readonly #slotCeiling: number;
  readonly #reapPressureFraction: number;

  constructor(opts: RelayConnectionGaterOptions) {
    this.#logger = opts.logger;
    this.#slotCap = opts.slotCapPerAgent ?? SLOT_CAP_PER_AGENT;
    this.#slotCeiling = opts.slotCeiling ?? DEFAULT_SLOT_CEILING;
    this.#reapPressureFraction = opts.reapPressureFraction ?? DEFAULT_REAP_PRESSURE_FRACTION;
  }

  /**
   * Wire the live node in AFTER `createNode()` resolves — the gater must exist and be passed into
   * `createNode({ connectionGater })` before any `CelloNode` exists to revoke a connection on, so
   * this is a required second step, not a constructor dependency cycle.
   */
  attachNode(node: CelloNode): void {
    this.#node = node;
  }

  /** Call from `recordAssignment()` when both session Peer IDs are present on the assignment. */
  recordSessionBinding(sessionIdHex: string, initiator: string, counterparty: string): void {
    this.#sessionBindings.set(sessionIdHex, { initiator, counterparty });
  }

  /** Call from `#cleanupSessionTracking` — a torn-down session no longer authorizes a dial-through. */
  removeSessionBinding(sessionIdHex: string): void {
    this.#sessionBindings.delete(sessionIdHex);
  }

  // ─── DOD-M15-RELAYSLOTS-1: the slot ledger ──────────────────────────────────────────────────

  /** How many slots this agent currently holds here. Only ATTRIBUTED slots count. */
  slotCountForAgent(agentPubkeyHex: string): number {
    return this.#reservedSlotsForAgent(agentPubkeyHex, "");
  }

  /**
   * RESERVATION-backed slots held, attributed or not — the number that approaches the relay's
   * ceiling, and the one the reaper measures pressure against.
   *
   * ⚠️ Deliberately NOT `#slots.size`. A peer that dialled in and authenticated without ever taking
   * a reservation holds a ledger entry but occupies nothing in libp2p's reservation table, and
   * counting it here made the reaper's pressure line fire against a table that was not full — which
   * would hang up peers to free capacity that was never scarce.
   */
  slotCount(): number {
    let n = 0;
    for (const slot of this.#slots.values()) if (slot.reserved) n++;
    return n;
  }

  /** The reservation ceiling this relay was configured with — the denominator `slotCount()` is read against. */
  slotCeiling(): number {
    return this.#slotCeiling;
  }

  /**
   * How many entries the proof bookkeeping is carrying.
   *
   * ⚠️ This exists because the alternative was an unobservable defect. Both maps behind it leaked —
   * written on every authentication, removed only if that same peer came back to reserve, which a
   * session node never does — and unbounded growth has no behaviour to assert against: the relay
   * keeps working, correctly, while its memory climbs. Deleting the sweep left every test green.
   * A number that can be read is what turns "it grows forever" into something a test can fail on.
   */
  proofBookkeepingSize(): number {
    return this.#provenPeers.size + this.#unprovenAsks.size;
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
    // The peer is gone and libp2p still holds its reservation — see `#giveBackReservation`.
    this.#giveBackReservation(peerId);
    this.#slots.delete(peerId);
    this.#reservedAt.delete(peerId);
    this.#unprovenAsks.delete(peerId);
    /**
     * ⚠️ `#provenPeers` DELIBERATELY SURVIVES THIS. Carrying the proof across the disconnect is the
     * entire reason that map exists: the client proves itself on one connection and reserves on the
     * next, because a reservation taken on the same connection as the proof yields no dialable
     * address. Deleting here would refuse every honest agent its front door. It expires on its own,
     * and the sweep collects it.
     */
  }

  /**
   * Attribute this peer's slot to a registered agent, and decide whether the agent may keep it.
   *
   * Called once the relay has verified the agent's directory-issued online token, so
   * `agentPubkeyHex` is a fact rather than a claim. Returning a refusal means the relay refuses the
   * authentication — and since the gate grants only to a peer this method has already admitted,
   * a refusal here is also what stops the reservation existing.
   *
   * `forReservation` says whether the caller named a reservation as the purpose of this
   * authentication. Only those may go on to hold a slot; see `SlotRecord.provenForReservation`.
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
  /*
   * ⚠️ `forReservation` is REQUIRED, deliberately. A default would make "I forgot to say" and "this
   * is not for a reservation" the same call, and the compiler would have nothing to say about it.
   * There is one production call site and it reads `resp.purpose` directly.
   */
  admitSlot(peerId: string, agentPubkeyHex: string, forReservation: boolean): SlotAdmission {
    const existing = this.#slots.get(peerId);
    const now = Date.now();

    /**
     * Reclaim first (see above). Four conditions, and every one of them is load-bearing:
     *  - not this peer's own slot;
     *  - this agent is the ONLY one reachable through it, so releasing it cannot strand a
     *    co-tenant agent that has nothing to do with this reservation;
     *  - it has never carried traffic;
     *  - **and its peer is GONE.** That last one is the guard that actually works. This rule exists
     *    to clean up a connection the relay never saw close; a peer that is still connected is by
     *    definition not that. Without it, an agent's own promoted receiver — silent because it has
     *    not submitted anything yet, and older than any age floor because it waited for its caller
     *    — is hung up the instant its replacement authenticates, killing the conversation that has
     *    just started.
     */
    const reclaimed: string[] = [];
    for (const [id, slot] of this.#slots) {
      if (id === peerId) continue;
      if (!slot.agents.has(agentPubkeyHex) || slot.agents.size !== 1) continue;
      if (slot.lastActivityAt !== null) continue;
      if (this.#isPeerConnected(id)) continue;
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
     * The cap is consulted whenever this slot is not ALREADY attributed to this agent.
     *
     * ⚠️ THE CONDITION IS `!existing?.agents.has(...)`, NEVER `!existing`, and that must survive
     * any rewrite of this method. It was written as `!existing` once and the ledger test caught it.
     * The reason it was wrong has since INVERTED — back then a reservation was always granted
     * before its holder authenticated, so `existing` was virtually never absent and the cap was
     * skipped on every real call; today authentication comes first, so `existing` is usually absent
     * and `!existing` would happen to work. It would go on happening to work right up until a peer
     * authenticates twice, which a reconnect does. Ask the question that is actually being asked:
     * is this agent already on this slot?
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

    // Remembered past this connection, and ONLY for a reservation proof — see `#provenPeers`.
    if (forReservation) {
      this.#provenPeers.set(peerId, { agentPubkeyHex, expiresAt: now + PROVEN_PEER_MEMORY_MS });
      this.#unprovenAsks.delete(peerId);
    }

    if (existing) {
      existing.agents.add(agentPubkeyHex);
      if (forReservation) existing.provenForReservation = true;
    } else {
      // A peer that has authenticated but holds no reservation yet. It occupies nothing in libp2p's
      // reservation table, so it is NOT counted against the ceiling the reaper measures — but the
      // entry has to exist, because it is what the gate reads when the reservation is asked for.
      this.#slots.set(peerId, {
        reserved: false,
        provenForReservation: forReservation,
        agents: new Set([agentPubkeyHex]),
        grantedAt: now,
        lastActivityAt: null,
      });
    }
    return { ok: true };
  }

  /**
   * DOD-M15-RELAYSLOTS-1 — **REAP, THEN REFUSE.** Free the quietest slots when the table is under
   * pressure, so the relay refuses only at the ceiling with nothing left to reclaim.
   *
   * Returns what was freed, so the relay can tell the agents that lost capacity. Silent teardown is
   * how "my agent just stopped working" happens, and the relay is the only party that knows.
   *
   * Three rules, in order:
   *
   *  1. **Below the pressure line, do nothing.** There is capacity to spare, and reclaiming would
   *     cost some agent its front door to free space nobody wanted.
   *  2. **Never inside the activity floor.** A slot that has carried traffic in the last six hours
   *     is off limits at any pressure — see `SLOT_REAP_ACTIVITY_FLOOR_MS`. A slot that has never
   *     carried traffic is measured from when it was GRANTED, which is what keeps a waiting standing
   *     receiver (silent by definition) from being reaped the instant it arrives on a busy relay.
   *  3. **Quietest first, and stop as soon as there is room.** Freeing more than the table needs is
   *     just a slower version of refusing too eagerly.
   */
  reapIdleSlots(notify?: (slot: ReapedSlot) => void): ReapedSlot[] {
    /**
     * ⚠️ **BEFORE THE PRESSURE CHECK, NOT AFTER** — review finding 4. Both of these maps are keyed
     * by peer ids the relay may never see again, and their only other remover runs when that peer
     * comes back. Sweeping them below the early return would mean they are collected only on a
     * relay that is already under pressure, which is precisely the relay that cannot afford to have
     * spent the intervening hours growing them.
     */
    this.#sweepProofBookkeeping();

    const pressureLine = Math.floor(this.#slotCeiling * this.#reapPressureFraction);
    // RESERVATION-backed only, on both sides of the comparison and in the target below. The ceiling
    // is libp2p's reservation limit, so measuring a population that includes plain authenticated
    // dial-ins would fire the reaper against a table that is not full.
    const reservedHeld = this.slotCount();
    if (reservedHeld <= pressureLine) return [];

    const now = Date.now();
    const candidates: Array<{ peerId: string; idleMs: number; agents: string[] }> = [];
    for (const [peerId, slot] of this.#slots) {
      if (!slot.reserved) continue; // frees nothing in the table this pressure is measured against
      const since = slot.lastActivityAt ?? slot.grantedAt;
      const idleMs = now - since;
      if (idleMs <= SLOT_REAP_ACTIVITY_FLOOR_MS) continue;
      candidates.push({ peerId, idleMs, agents: [...slot.agents] });
    }
    if (candidates.length === 0) {
      this.#logger.warn("relay.slot.reap.nothing_to_free", {
        held: reservedHeld,
        ceiling: this.#slotCeiling,
        floorHours: SLOT_REAP_ACTIVITY_FLOOR_MS / 3_600_000,
        impact: "the reservation table is under pressure and every slot in it has carried traffic " +
          "inside the activity floor. Nothing is reaped — the relay will refuse new agents at the " +
          "ceiling instead, which is correct here: the table is genuinely full of sessions in use. " +
          "If this persists, this relay needs more capacity, not a lower floor.",
      });
      return [];
    }

    candidates.sort((a, b) => b.idleMs - a.idleMs); // quietest first
    const target = reservedHeld - pressureLine;
    const reaped: ReapedSlot[] = [];
    for (const c of candidates) {
      if (reaped.length >= target) break;
      this.#logger.info("relay.slot.reaped", {
        peerId: truncId(c.peerId),
        agents: c.agents.map((a) => truncId(a)),
        idleHours: Math.round(c.idleMs / 3_600_000),
        held: reservedHeld,
        ceiling: this.#slotCeiling,
        impact: "this reservation was reclaimed to free capacity on a relay under pressure. It had " +
          "carried no traffic for longer than the activity floor. The agent's client rebuilds its " +
          "standing receiver on losing a reservation, so this is recoverable — but it is a real " +
          "interruption and the holder is told.",
      });
      /**
       * Review H3: **TELL THEM BEFORE HANGING THEM UP.** `#releaseSlot` disconnects the peer, and
       * the notice was being sent afterwards on an unawaited promise — so it raced the very
       * disconnect it was announcing, and on the loopback that race is usually lost quietly.
       */
      const entry: ReapedSlot = { peerId: c.peerId, agents: c.agents, idleMs: c.idleMs };
      try {
        notify?.(entry);
      } catch (err: unknown) {
        this.#logger.debug("relay.slot.reap.notify_failed", {
          peerId: truncId(c.peerId),
          error: err instanceof Error ? err.message : String(err),
        });
      }
      this.#releaseSlot(c.peerId);
      reaped.push(entry);
    }
    return reaped;
  }

  /**
   * The agents reachable through a slot, or null when there is no slot for that peer at all.
   *
   * Used by tests that must name WHICH peer holds a slot rather than only counting them — a count
   * is satisfied by the wrong peer holding the right number.
   */
  agentsForSlot(peerId: string): string[] | null {
    const slot = this.#slots.get(peerId);
    return slot ? [...slot.agents] : null;
  }

  /**
   * Is this peer still connected to us?
   *
   * ⚠️ **UNKNOWN COUNTS AS CONNECTED.** With no node attached this returns true, so the reclaim
   * rule declines to act rather than acting blind. When unsure whether a slot is in use, treat it
   * as in use — here that is the difference between leaving an idle slot alone and hanging up a
   * live conversation.
   */
  #isPeerConnected(peerId: string): boolean {
    if (!this.#node) return true;
    try {
      return this.#node.getConnections().some((c) => c.peerId === peerId);
    } catch {
      // A transport that cannot answer is not evidence the peer is gone.
      return true;
    }
  }

  /**
   * DOD-M15-RELAYSLOTS-1 — **GIVE THE RESERVATION BACK, not just the ledger row.**
   *
   * `hangUp` does not free a circuit reservation. Measured against `@libp2p/circuit-relay-v2@4.2.3`
   * (see the transport package's own test): the server frees one only when its TTL aborts, there is
   * no disconnect listener, and the TTL defaults to two hours. So every reclaim path this relay has
   * — the reaper under pressure, the reclaim of an agent's own unused slot, and the peer that
   * simply disconnects — was dropping bookkeeping while libp2p went on holding the slot against its
   * 4096 limit.
   *
   * ⚠️ The capability check is a VERSION check, not an optional feature. `releaseRelayReservation`
   * ships in `@cello-protocol/transport`; a relay running an older one cannot free reservations at
   * all, and that is a fact an operator has to be told rather than something to paper over — so it
   * is reported at ERROR, once, naming the consequence.
   */
  #giveBackReservation(peerId: string): void {
    /**
     * ⚠️ Review M2 — **DELETING THE ENTRY IS NOT ENOUGH.** libp2p keeps a per-reservation expiry
     * signal whose abort listener deletes the map entry, and deleting the entry does not cancel the
     * signal. So a released reservation leaves a timer running: if the same peer reconnects and
     * reserves again before it fires, the OLD signal aborts and deletes the NEW reservation. The
     * agent silently loses a slot mid-TTL and libp2p's client will not notice until it refreshes
     * against an expiry that no longer exists. `releaseRelayReservation` aborts the signal.
     */
    const node = this.#node as (CelloNode & { releaseRelayReservation?: (p: string) => boolean }) | null;
    if (!node) return;
    if (typeof node.releaseRelayReservation !== "function") {
      if (!this.#warnedNoReservationRelease) {
        this.#warnedNoReservationRelease = true;
        this.#logger.error("relay.reservation.release_unavailable", {
          impact: "this relay's transport package predates releaseRelayReservation, so hanging a " +
            "peer up does NOT return its circuit reservation — libp2p holds it for the full TTL. " +
            "Every slot this relay believes it reclaimed is still counted against its 4096 limit. " +
            "Upgrade @cello-protocol/transport; until then the reservation table drifts above what " +
            "this relay reports and will eventually refuse real agents.",
        });
      }
      return;
    }
    try {
      node.releaseRelayReservation(peerId);
    } catch (err: unknown) {
      this.#logger.debug("relay.reservation.release_failed", {
        peerId: truncId(peerId),
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /** Reported once — a relay either can release reservations or it cannot. */
  #warnedNoReservationRelease = false;

  /** Hang the peer up, give the reservation back, and drop its ledger entry. */
  #releaseSlot(peerId: string): void {
    this.#slots.delete(peerId);
    this.#reservedAt.delete(peerId);
    this.#unprovenAsks.delete(peerId);
    /**
     * ⚠️ `#provenPeers` survives here too, and for a second reason on top of the reconnect: the
     * reaper takes a slot from an agent that is still running, and that agent's client rebuilds its
     * standing receiver. Dropping the proof would make the rebuild ask, be refused, prove, and ask
     * again — recoverable, but a needless extra round trip on the path the reaper just disrupted.
     */
    this.#giveBackReservation(peerId);
    this.#node?.hangUp(peerId).catch((err: unknown) => {
      this.#logger.debug("relay.slot.release.hangup_failed", {
        peerId: truncId(peerId),
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  /**
   * DOD-M15-RELAYSLOTS-1 — **THE GATE. A stranger does not get a slot.**
   *
   * Refuses any reservation from a peer that has not already proven, on this connection, that it
   * belongs to a registered agent — and then applies that agent's slot cap before granting.
   *
   * ─── Why this is possible now, and why it was not before ─────────────────────────────────────
   *
   * libp2p hands this hook a peer id and nothing else. The token cannot ride the reservation, so
   * for as long as the client asked for its slot BEFORE saying who it was, this hook had nothing to
   * decide on: the slot was granted unconditionally and the token checked afterwards, and an
   * attacker who never opened an auth stream never met the check at all. One machine took the whole
   * table while every refusal the relay logged was correct.
   *
   * Two rounds of compensation followed and both made it worse before better — refusing past an
   * unproven budget made denying the relay eight times cheaper, and evicting the oldest picked the
   * honest agent every time. Both were guesses about who LOOKED bad, because an IP address was the
   * only thing visible here. A botnet walks through guesses.
   *
   * The client now dials, authenticates over `/cello/relay/1.0.0`, and only then asks for the slot
   * (`reserveRelaySlot` in the transport package). By the time this runs, the peer either has a
   * ledger entry naming a registered agent or it does not — and that is a fact, not a heuristic.
   *
   * ⚠️ REFUSING HERE IS SAFE ONLY BECAUSE OF THAT ORDERING. Denying an unproven peer used to strand
   * every brand-new agent's first reservation, which is the outage the class header describes. It no
   * longer can: a real client has authenticated before it reaches this point, and one that has not
   * is told so and retries after authenticating.
   */
  denyInboundRelayReservation(source: PeerId): boolean {
    const id = source.toString();
    let slot = this.#slots.get(id);

    /**
     * The peer proved itself on a previous connection and has come back to reserve — the ordinary
     * path, because a reservation taken on the SAME connection as the proof yields no dialable
     * address (libp2p only announces circuit addresses for reservations its own discovery made).
     * Re-establish the ledger entry from that proof.
     */
    if (!slot?.provenForReservation) {
      const proven = this.#provenPeers.get(id);
      if (proven && Date.now() < proven.expiresAt) {
        slot = slot ?? {
          reserved: false,
          provenForReservation: true,
          agents: new Set(),
          grantedAt: Date.now(),
          lastActivityAt: null,
        };
        slot.provenForReservation = true;
        slot.agents.add(proven.agentPubkeyHex);
        this.#slots.set(id, slot);
      } else if (proven) {
        // Expired rather than absent — say which, so a client whose two connections were slow apart
        // is not diagnosed as an unregistered stranger.
        this.#provenPeers.delete(id);
        this.#logger.warn("relay.reservation.denied", {
          peerId: truncId(id),
          reason: "proof_expired",
          memoryMs: PROVEN_PEER_MEMORY_MS,
          impact: "this peer proved itself, but too long ago — it must authenticate again before " +
            "reserving. A client that takes minutes between proving and reserving is unusual; the " +
            "two steps are normally back to back.",
        });
        return true; // DENY
      }
    }

    if (!slot?.provenForReservation || slot.agents.size === 0) {
      /**
       * ⚠️ **THE FIRST REFUSAL IS THE HAPPY PATH, AND MUST NOT BE LOGGED AS AN ATTACK** — review
       * finding 3. Every honest receiver arrives here exactly once per relay per build: it asks,
       * is refused, proves itself, and asks again. That is roughly all of this event's volume. It
       * was WARN with an impact naming "an older client or exactly the flood this gate exists to
       * stop" — two causes, neither of which produces it, on a line an operator was invited to
       * count when hunting a flood. They would have been counting their own agents.
       *
       * The second ask WITHOUT a proof in between is the shape that means something: a peer that
       * was told what to do and did not do it. That one is warned about.
       */
      const asks = (this.#unprovenAsks.get(id) ?? 0) + 1;
      this.#unprovenAsks.set(id, asks);
      const line = {
        peerId: truncId(id),
        reason: "not_authenticated",
        asksWithoutProving: asks,
      };
      if (asks === 1) {
        this.#logger.debug("relay.reservation.denied", {
          ...line,
          impact: "expected. A receiver asks for its slot, is refused, authenticates, and asks " +
            "again — this is the first half of that. It becomes a warning if the same peer asks " +
            "again without authenticating in between.",
        });
      } else {
        this.#logger.warn("relay.reservation.denied", {
          ...line,
          impact: "this peer has now asked for a reservation more than once without ever proving " +
            "it belongs to a registered agent. A current client authenticates between the two " +
            "asks, so this is either an older client — which should upgrade — or exactly the " +
            "flood this gate exists to stop. Refused; it holds nothing.",
        });
      }
      return true; // DENY
    }

    /**
     * The per-agent cap, enforced AT THE DOOR. It used to run after the fact, because the relay did
     * not know whose reservation it was granting until later; now it does, so the agent that is
     * already at its limit is told before a slot is handed over rather than after.
     */
    for (const agent of slot.agents) {
      const held = this.#reservedSlotsForAgent(agent, id);
      if (held >= this.#slotCap) {
        this.#logger.warn("relay.reservation.denied", {
          peerId: truncId(id),
          agentPubkey: truncId(agent),
          held,
          cap: this.#slotCap,
          reason: "slot_cap_exceeded",
          impact: "this agent already holds the most circuit reservations one agent may hold on " +
            "this relay. For a real operator that usually means sessions that were never closed — " +
            "the count says how many, so they can go and close some.",
        });
        return true; // DENY
      }
    }

    slot.reserved = true;
    this.#reservedAt.set(id, Date.now());
    return false; // ALLOW
  }

  /**
   * RESERVATION-backed slots this agent holds, excluding `exceptPeerId`.
   *
   * Review M3: the cap is charged against ONE population — reservations — at both checkpoints. It
   * used to count every authenticated peer at the auth step and only reservations at the grant
   * step, so an agent running 32 session nodes that dial in to submit leaves, holding no
   * reservations at all, was refused AUTHENTICATION and told to go and close sessions it did not
   * have. Two numbers against one limit is one number too many.
   */
  #reservedSlotsForAgent(agentPubkeyHex: string, exceptPeerId: string): number {
    let n = 0;
    for (const [peerId, slot] of this.#slots) {
      if (peerId === exceptPeerId) continue;
      if (slot.reserved && slot.agents.has(agentPubkeyHex)) n++;
    }
    return n;
  }

  /**
   * Drop expired proofs and the refusal counters for peers that have gone quiet.
   *
   * Neither map gates anything on its own — `#provenPeers` is already checked against its expiry at
   * the point of use, and `#unprovenAsks` only decides a log level. This is collection, not
   * correctness: without it a long-running relay carries an entry per peer id it ever refused.
   */
  #sweepProofBookkeeping(): void {
    const now = Date.now();
    for (const [id, proof] of this.#provenPeers) {
      if (now >= proof.expiresAt) this.#provenPeers.delete(id);
    }
    /**
     * A refused peer that has not been seen since the last sweep is not mid-handshake — the two
     * asks that matter are seconds apart, and the sweep interval is minutes. Anything still here is
     * bookkeeping about a peer that left, so the whole map goes; a peer that comes back and asks
     * twice again earns its warning again.
     */
    this.#unprovenAsks.clear();
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
