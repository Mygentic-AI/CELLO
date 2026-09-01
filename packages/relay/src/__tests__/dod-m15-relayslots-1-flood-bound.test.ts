/**
 * DOD-M15-RELAYSLOTS-1 — **CAN AN ATTACKER STILL TAKE THE TABLE?** The question the order's title
 * asks, tested directly.
 *
 * ─── Why this file exists, and it is not a happy story ────────────────────────────────────────
 *
 * The first version of this unit checked the directory-issued token on CELLO's own auth stream, and
 * every test asserted on REFUSALS: the right callers were refused, with the right reasons, and each
 * assertion was honest. The headline was still false.
 *
 * libp2p hands `denyInboundRelayReservation` nothing but a peer id — there is nowhere to put a
 * token, and the client has not sent one yet. So the slot was granted unconditionally and the token
 * was checked afterwards. An attacker who simply never opened an auth stream never met the check at
 * all: reserve, hold the slot for the fifteen-second grace window, get hung up, reconnect. At about
 * 273 connections a second, from one machine, they hold all 4096 for as long as they like.
 *
 * That is the gap between the letter of "a slot request without a valid token is refused" — which
 * was true — and "an agent cannot flood a relay's reservation slots", which was not.
 *
 * ─── So this asserts on OCCUPANCY, never on refusals ──────────────────────────────────────────
 *
 * A test that counts refusals cannot see this defect: every refusal was correct. The only assertion
 * that can is "after the attack, how much of the table does the attacker hold?"
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  RelayConnectionGater,
  UNPROVEN_RESERVATIONS_PER_SOURCE,
  UNPROVEN_RESERVATIONS_TOTAL,
} from "../relay-connection-gater.js";
import type { Logger } from "@cello-protocol/interfaces";

const silentLogger: Logger = { debug() {}, info() {}, warn() {}, error() {} };

function peer(id: string): { toString(): string } {
  return { toString: () => id };
}

/**
 * A gater whose node reports each peer's remote address, exactly as libp2p's connection list does.
 * `denyInboundRelayReservation` is handed only a peer id, so the address has to be looked up — and
 * being able to look it up is what makes a per-source bound possible at all.
 */
function makeGater(): {
  gater: RelayConnectionGater;
  /** peer id → the IP it is connecting from. Set before reserving. */
  addressOf: Map<string, string>;
  /** Reserve as `peerId` from `ip`; returns true if the relay GRANTED the slot. */
  reserve: (peerId: string, ip: string) => boolean;
} {
  const addressOf = new Map<string, string>();
  const gater = new RelayConnectionGater({ logger: silentLogger, reservationGraceMs: 60_000 });
  gater.attachNode({
    hangUp: async () => {},
    getConnections: () => [...addressOf].map(([peerId, ip]) => ({
      peerId,
      remoteAddr: `/ip4/${ip}/tcp/4001`,
    })),
  } as unknown as Parameters<RelayConnectionGater["attachNode"]>[0]);

  return {
    gater,
    addressOf,
    reserve: (peerId, ip) => {
      addressOf.set(peerId, ip);
      // libp2p's hook: `true` DENIES. So a granted slot is `deny === false`.
      return gater.denyInboundRelayReservation(peer(peerId) as never) === false;
    },
  };
}

describe("DOD-M15-RELAYSLOTS-1: the flood is BOUNDED, measured by what the attacker ends up holding", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("★★★ one machine minting throwaway keys cannot take the table", () => {
    const { gater, reserve } = makeGater();

    // 4096 throwaway keypairs — the whole ceiling — all from one host, none of which will ever
    // authenticate, because none of them can obtain a directory token.
    let granted = 0;
    for (let i = 0; i < 4096; i++) {
      if (reserve(`attacker-${String(i)}`, "203.0.113.7")) granted++;
    }

    expect(
      granted,
      "this is the assertion the first version of this unit could not make. Every refusal it " +
        "checked was correct and the attacker still held every slot, because the slot was handed " +
        "out before anything was checked.",
    ).toBe(UNPROVEN_RESERVATIONS_PER_SOURCE);
    expect(gater.slotCount()).toBe(UNPROVEN_RESERVATIONS_PER_SOURCE);
  });

  it("★★★ a distributed flood is bounded too — a new source per key is not a way around it", () => {
    const { gater, reserve } = makeGater();

    // One key, one address. This is the botnet shape, and the per-source cap alone does nothing
    // against it: every attempt is the first from its own address.
    let granted = 0;
    for (let i = 0; i < 4096; i++) {
      if (reserve(`bot-${String(i)}`, `198.51.${String(Math.floor(i / 250))}.${String(i % 250)}`)) granted++;
    }

    expect(
      granted,
      "without a global bound on unproven reservations, spreading across addresses restores the " +
        "original attack in full.",
    ).toBe(UNPROVEN_RESERVATIONS_TOTAL);
    expect(gater.slotCount()).toBeLessThan(4096);
  });

  it("★★★ an agent that AUTHENTICATES is never counted against the flood bound", () => {
    const { gater, reserve } = makeGater();

    // A busy relay: far more real agents than the unproven bound, all from different homes, each
    // proving itself the moment it has reserved — which is what a real client does.
    for (let i = 0; i < UNPROVEN_RESERVATIONS_TOTAL * 2; i++) {
      const id = `agent-${String(i)}`;
      expect(reserve(id, `192.0.2.${String(i % 250)}`), `agent ${String(i)} must get a slot`).toBe(true);
      expect(gater.admitSlot(id, `${String(i % 90).padStart(2, "0")}`.repeat(32)).ok).toBe(true);
      gater.recordAuthenticated(id);
    }

    expect(
      gater.slotCount(),
      "the bound is on UNPROVEN reservations only. If a proven agent were counted, this relay would " +
        "stop serving real agents long before its table was full — which is the failure mode this " +
        "whole unit exists to avoid, reintroduced by its own fix.",
    ).toBe(UNPROVEN_RESERVATIONS_TOTAL * 2);
  });

  it("★★★ authenticating FREES the source's budget, so an ordinary host is never wedged", () => {
    const { gater, reserve } = makeGater();
    const HOST = "192.0.2.50";

    // A host running many agents restarts them all at once — every one unproven for a moment.
    for (let i = 0; i < UNPROVEN_RESERVATIONS_PER_SOURCE; i++) {
      expect(reserve(`local-${String(i)}`, HOST)).toBe(true);
    }
    expect(reserve("local-overflow", HOST), "at the cap, the next one waits").toBe(false);

    // They authenticate, as a real client does within milliseconds of reserving.
    for (let i = 0; i < UNPROVEN_RESERVATIONS_PER_SOURCE; i++) {
      gater.admitSlot(`local-${String(i)}`, "aa".repeat(32));
      gater.recordAuthenticated(`local-${String(i)}`);
    }

    expect(
      reserve("local-after-auth", HOST),
      "an unproven reservation lasts about as long as a handshake. If the budget did not free on " +
        "authentication, one busy host would be permanently capped at sixteen agents.",
    ).toBe(true);
  });

  it("a peer whose address cannot be read still counts against the GLOBAL bound", () => {
    const { gater } = makeGater();
    // No entry in `addressOf`, so the connection list has no address for it — our own blind spot,
    // not something a caller can choose. It must not become a way through.
    let granted = 0;
    for (let i = 0; i < UNPROVEN_RESERVATIONS_TOTAL + 50; i++) {
      if (gater.denyInboundRelayReservation(peer(`unknown-${String(i)}`) as never) === false) granted++;
    }
    expect(granted).toBe(UNPROVEN_RESERVATIONS_TOTAL);
  });

  it("the bounds are the values the relay actually runs with", () => {
    expect(UNPROVEN_RESERVATIONS_PER_SOURCE).toBeGreaterThan(1);
    expect(UNPROVEN_RESERVATIONS_PER_SOURCE).toBeLessThan(64);
    expect(
      UNPROVEN_RESERVATIONS_TOTAL,
      "and the global bound must leave most of the table for real agents even while a flood is on",
    ).toBeLessThan(4096 / 4);
  });
});
