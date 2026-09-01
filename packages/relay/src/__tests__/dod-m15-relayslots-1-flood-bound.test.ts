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
 *
 * ⚠️ AND THE SECOND VERSION REFUSED, WHICH WAS WORSE. Bounding by DENYING meant that once the
 * unproven budget was full every new reservation was refused — including every honest agent's,
 * since an agent's reservation is unproven at the instant it is made. Denying the whole relay went
 * from needing 4096 slots to needing 512. So the bound now EVICTS the oldest unproven holder and
 * admits the caller, and these tests assert BOTH halves: the attacker stays bounded, and an honest
 * agent is never turned away.
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
      "every reservation is admitted — refusing is what made the outage cheaper to cause. The bound " +
        "shows up in what is HELD, not in what was turned away.",
    ).toBe(4096);
    expect(
      gater.slotCount(),
      "this is the assertion the first version of this unit could not make. Every refusal it " +
        "checked was correct and the attacker still held every slot, because the slot was handed " +
        "out before anything was checked.",
    ).toBe(UNPROVEN_RESERVATIONS_PER_SOURCE);
  });

  it("★★★ a distributed flood is bounded too — a new source per key is not a way around it", () => {
    const { gater, reserve } = makeGater();

    /**
     * One key, one address — the botnet shape, and the per-source bound does nothing against it
     * because every attempt is the first from its own address. Reservations arrive 10ms apart,
     * because a real flood takes real time; that matters, since the eviction floor exempts a slot
     * younger than a handshake and a test with a frozen clock would make every slot exempt.
     */
    let granted = 0;
    for (let i = 0; i < 4096; i++) {
      if (reserve(`bot-${String(i)}`, `198.51.${String(Math.floor(i / 250))}.${String(i % 250)}`)) granted++;
      vi.advanceTimersByTime(10);
    }

    expect(granted, "again: admitted, then bounded by eviction").toBe(4096);
    /**
     * ⚠️ THE BOUND DEGRADES HERE RATHER THAN HOLDING ABSOLUTELY, and that is a real limit worth
     * stating plainly. A flood arriving on one address per key, faster than a handshake completes,
     * is at that instant indistinguishable from a genuine stampede of new agents — same one slot
     * per source, same age. There is no signal to separate them, so the relay declines to guess and
     * the pool runs to roughly the global budget plus whatever arrived inside the floor window.
     *
     * What it costs the attacker is the thing worth measuring: thousands of distinct addresses, to
     * hold a fraction of a table they used to take entirely from one machine.
     */
    expect(
      gater.slotCount(),
      "spreading across addresses must not restore the original attack — the table stays mostly " +
        "available to real agents even in the case with the least signal to act on.",
    ).toBeLessThan(1024);
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
    // They authenticate, as a real client does about a round trip after reserving, and leave the
    // unproven pool entirely.
    for (let i = 0; i < UNPROVEN_RESERVATIONS_PER_SOURCE; i++) {
      expect(gater.admitSlot(`local-${String(i)}`, "aa".repeat(32)).ok).toBe(true);
      gater.recordAuthenticated(`local-${String(i)}`);
    }

    // The same host brings up a second wave. Nothing is evicted, because the budget is about
    // UNPROVEN reservations and this host is holding none.
    for (let i = 0; i < UNPROVEN_RESERVATIONS_PER_SOURCE; i++) {
      expect(reserve(`second-wave-${String(i)}`, HOST)).toBe(true);
    }

    expect(
      gater.slotCount(),
      "if the budget did not free on authentication, one busy host would be permanently capped at " +
        "sixteen agents no matter how long it had been running.",
    ).toBe(UNPROVEN_RESERVATIONS_PER_SOURCE * 2);
    // Review: the pass-one version of this test asserted the overflow was REFUSED, which reddened
    // under revert; replacing it with a count alone weakened it. This restores the teeth by naming
    // what must still be held — every first-wave agent, none of them evicted by the second wave.
    for (let i = 0; i < UNPROVEN_RESERVATIONS_PER_SOURCE; i++) {
      expect(
        gater.agentsForSlot(`local-${String(i)}`),
        `first-wave agent ${String(i)} must still hold its slot`,
      ).toContain("aa".repeat(32));
    }
  });

  it("★★★ at the budget the caller is ADMITTED and the oldest unproven one is dropped", () => {
    const { gater, reserve } = makeGater();
    const HOST = "203.0.113.9";

    for (let i = 0; i < UNPROVEN_RESERVATIONS_PER_SOURCE; i++) {
      expect(reserve(`squatter-${String(i)}`, HOST)).toBe(true);
      vi.advanceTimersByTime(10); // so "oldest" is unambiguous
    }
    expect(
      reserve("newcomer", HOST),
      "refusing here is precisely what made the previous version worse than the defect it fixed.",
    ).toBe(true);

    expect(gater.slotCount(), "the budget holds").toBe(UNPROVEN_RESERVATIONS_PER_SOURCE);
    /**
     * Review: this used to assert only the COUNT, which an evict-NEWEST implementation satisfies
     * just as well — so the test was named for a selector it could not see. Name the slots.
     */
    expect(gater.agentsForSlot("squatter-0"), "the oldest is the one that went").toBeNull();
    expect(gater.agentsForSlot(`squatter-${String(UNPROVEN_RESERVATIONS_PER_SOURCE - 1)}`), "the newest survived").toEqual([]);
    expect(gater.agentsForSlot("newcomer"), "and the caller was admitted, not refused").toEqual([]);
  });

  it("a peer whose address cannot be read still counts against the GLOBAL bound", () => {
    const { gater } = makeGater();
    // No entry in `addressOf`, so the connection list has no address for it — our own blind spot,
    // not something a caller can choose. It must not become a way through.
    for (let i = 0; i < UNPROVEN_RESERVATIONS_TOTAL + 50; i++) {
      expect(gater.denyInboundRelayReservation(peer(`unknown-${String(i)}`) as never)).toBe(false);
    }
    expect(gater.slotCount()).toBe(UNPROVEN_RESERVATIONS_TOTAL);
    expect(
      gater.unreadableSourceCount(),
      "review M1: an unreadable source must be COUNTED, not silently absorbed — otherwise the " +
        "per-source bound could stop existing in production with every test still green.",
    ).toBe(UNPROVEN_RESERVATIONS_TOTAL + 50);
  });

  it("★★★ an honest agent MID-HANDSHAKE survives the flood — the window every other test skipped", () => {
    const { gater, reserve } = makeGater();

    // The honest agent reserves and has NOT authenticated yet. This is the whole dangerous window,
    // and review measured that the first eviction rule hung this agent up: with "evict the oldest",
    // a churning flood keeps its own pool young, so the one slot sitting still is always the oldest
    // in the table. Every other test in this file authenticated in the same tick and never saw it.
    expect(reserve("honest", "192.0.2.99")).toBe(true);

    /**
     * The flood must be WIDE enough to reach the global budget, and getting that wrong is why the
     * first version of this test could not see the defect. With only a handful of addresses the
     * per-source branch trims each of them at 16 and the total never approaches 512 — so the global
     * branch, the one that could pick the honest agent, never runs at all. 64 addresses × 16 = 1024,
     * comfortably past it.
     */
    const FLOOD_SOURCES = 64;
    for (let i = 0; i < UNPROVEN_RESERVATIONS_TOTAL * 4; i++) {
      reserve(`flood-${String(i)}`, `203.0.113.${String(i % FLOOD_SOURCES)}`);
      vi.advanceTimersByTime(10);
    }
    expect(
      gater.slotCount(),
      "precondition: the flood must actually have reached the global budget, or the branch that " +
        "could evict the honest agent was never exercised and this test proves nothing.",
    ).toBeGreaterThanOrEqual(UNPROVEN_RESERVATIONS_TOTAL);

    /**
     * ⚠️ ASSERT THE SLOT, NOT THE ADMISSION. My first version of this test called `admitSlot` and
     * checked it succeeded — and it passes against the broken selector, because `admitSlot` CREATES
     * a ledger record for a peer that has none. It reports success for an agent whose reservation
     * was just torn out from under it. `agentsForSlot` returns null only when the slot is really
     * gone, which is the thing being claimed.
     */
    expect(
      gater.agentsForSlot("honest"),
      "if its slot was evicted while it was proving itself, the agent is hung up mid-handshake and " +
        "the operator sees a bare disconnect with no cause — less legible than the refusal this " +
        "eviction rule replaced. The honest agent holds ONE slot from its address while the flood " +
        "holds many from each of its own; taking from the source holding the most is what makes it " +
        "unreachable as a victim.",
    ).toEqual([]);

    // And it can still finish its handshake on the slot it kept.
    expect(gater.admitSlot("honest", "ee".repeat(32)).ok).toBe(true);
    expect(gater.slotCountForAgent("ee".repeat(32))).toBe(1);
  });

  it("★★★ an honest agent is NEVER refused, however hard the flood is running", () => {
    const { gater, reserve } = makeGater();

    // A flood far past the global budget, from many sources, none of which will authenticate.
    for (let i = 0; i < UNPROVEN_RESERVATIONS_TOTAL * 3; i++) {
      reserve(`flood-${String(i)}`, `198.51.${String(Math.floor(i / 250))}.${String(i % 250)}`);
    }

    // One real agent arrives from its own address, mid-flood, and does what a real client does.
    expect(
      reserve("honest", "192.0.2.99"),
      "this is the regression that made the previous fix worse than the defect: with a REFUSING " +
        "bound, an attacker holding 512 unproven slots denied every honest agent on a relay that " +
        "was 87% empty, and the operator was told PERMISSION_DENIED.",
    ).toBe(true);
    expect(gater.admitSlot("honest", "ee".repeat(32)).ok).toBe(true);
    gater.recordAuthenticated("honest");

    // And it keeps its slot: proven slots are never evicted to make room for the flood.
    for (let i = 0; i < 500; i++) reserve(`flood-late-${String(i)}`, `203.0.113.${String(i % 250)}`);
    expect(
      gater.slotCountForAgent("ee".repeat(32)),
      "an agent that has authenticated is out of the unproven pool entirely, so no amount of " +
        "flooding can take its reservation.",
    ).toBe(1);
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
