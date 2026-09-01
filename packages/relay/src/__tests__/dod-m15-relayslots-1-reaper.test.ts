/**
 * DOD-M15-RELAYSLOTS-1 — the reaper: reclaim before refusing, and never take a live conversation.
 *
 * A relay's reservation table is finite. When it fills, the relay has two things it can do: refuse
 * the next agent, or free something that nobody is using. Every outage in this area came from the
 * first, so the order is fixed — **reap, then refuse** — and refusal happens only at the absolute
 * ceiling with nothing left to reclaim.
 *
 * ─── The floor is not a tuning parameter ──────────────────────────────────────────────────────
 *
 * The reaper never touches a slot that has seen activity in the last six hours, however much
 * pressure the table is under. A conversation people are actually having can go quiet for an
 * afternoon; tearing it down to make room is the failure this whole unit is trying to prevent, one
 * level up. If everything is inside six hours the reaper frees nothing and the relay refuses at the
 * ceiling instead — which is the correct outcome, because at that point the table really is full of
 * things in use.
 *
 * ─── And a reaped party is told ───────────────────────────────────────────────────────────────
 *
 * Silent teardown is how "my agent just stopped working" happens. The notice says the slot was
 * reclaimed to free capacity and what to do about it.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  RelayConnectionGater,
  SLOT_REAP_ACTIVITY_FLOOR_MS,
  DEFAULT_SLOT_CEILING,
  DEFAULT_REAP_PRESSURE_FRACTION,
} from "../relay-connection-gater.js";
import type { Logger } from "@cello-protocol/interfaces";

const silentLogger: Logger = { debug() {}, info() {}, warn() {}, error() {} };

function peer(id: string): { toString(): string } {
  return { toString: () => id };
}

const AGENT = "aa".repeat(32);

/** A gater with a small ceiling so a test can create pressure without ten thousand peers. */
function makeGater(ceiling: number): { gater: RelayConnectionGater; hungUp: string[]; connected: Set<string> } {
  const hungUp: string[] = [];
  const connected = new Set<string>();
  const gater = new RelayConnectionGater({
    logger: silentLogger,
    reservationGraceMs: 60_000,
    slotCeiling: ceiling,
  });
  gater.attachNode({
    hangUp: async (id: string) => { hungUp.push(id); connected.delete(id); },
    // The reclaim backstop frees a traffic-free slot whose peer has gone, so the connection list
    // has to be honest or it reclaims everything the moment it is created.
    getConnections: () => [...connected].map((peerId) => ({ peerId })),
    releaseRelayReservation: () => true,
  } as unknown as Parameters<RelayConnectionGater["attachNode"]>[0]);
  return { gater, hungUp, connected };
}

/**
 * Prove first, THEN reserve — the order a real client now uses, and the order the relay's gate
 * requires. Reserving first is refused outright, which is the whole point of the gate.
 */
function takeSlot(gater: RelayConnectionGater, peerId: string, agent = AGENT, connected?: Set<string>): void {
  connected?.add(peerId);
  const admission = gater.admitSlot(peerId, agent);
  expect(admission.ok, `precondition: ${peerId} must be able to authenticate`).toBe(true);
  gater.recordAuthenticated(peerId);
  expect(
    gater.denyInboundRelayReservation(peer(peerId) as never),
    `precondition: ${peerId} must get a reservation once it has proved itself`,
  ).toBe(false);
}

describe("DOD-M15-RELAYSLOTS-1: the reaper", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("does nothing while the table is not under pressure, however old the slots are", () => {
    const { gater, hungUp, connected } = makeGater(10);
    takeSlot(gater, "peer-ancient", AGENT, connected);
    vi.advanceTimersByTime(SLOT_REAP_ACTIVITY_FLOOR_MS * 10);

    expect(
      gater.reapIdleSlots(),
      "one slot out of ten is not pressure. Reclaiming here would cost an agent its front door to " +
        "free capacity nobody wanted.",
    ).toEqual([]);
    expect(hungUp).toEqual([]);
  });

  it("★★★ under pressure it frees the quietest slots, oldest first, and stops once there is room", () => {
    // Ceiling 8, so the pressure line sits at 6 and eight slots is genuinely over it.
    const { gater, hungUp, connected } = makeGater(8);
    for (let i = 0; i < 8; i++) {
      takeSlot(gater, `peer-${String(i)}`, `${String(i)}`.padStart(2, "0").repeat(32), connected);
      // Staggered, so "quietest first" has something to order by.
      vi.advanceTimersByTime(1_000);
    }
    vi.advanceTimersByTime(SLOT_REAP_ACTIVITY_FLOOR_MS + 1);
    // Four of them are alive; four have never carried a byte.
    for (const i of [4, 5, 6, 7]) gater.recordActivity(`peer-${String(i)}`);

    const reaped = gater.reapIdleSlots();
    const reapedIds = reaped.map((r) => r.peerId);

    expect(
      reaped.length,
      "it stops the moment the table is back under the pressure line — freeing more than is needed " +
        "is a slower version of refusing too eagerly. Four slots were reapable; only two were taken.",
    ).toBe(2);
    expect(
      reapedIds.every((id) => ["peer-0", "peer-1", "peer-2", "peer-3"].includes(id)),
      "the four with recent traffic must be untouched — a slot carrying a conversation is not spare capacity",
    ).toBe(true);
    expect(reapedIds[0], "quietest first: peer-0 has been silent longest").toBe("peer-0");
    expect(hungUp).toEqual(reapedIds);
    expect(gater.slotCount()).toBe(8 - reaped.length);
  });

  it("★★★ NEVER reaps a slot with activity inside the floor, even with the table completely full", () => {
    const { gater, hungUp, connected } = makeGater(4);
    for (let i = 0; i < 4; i++) takeSlot(gater, `peer-${String(i)}`, `${String(i)}`.padStart(2, "0").repeat(32), connected);

    // Every slot has been silent for just under the floor. The table is 100% full.
    vi.advanceTimersByTime(SLOT_REAP_ACTIVITY_FLOOR_MS - 60_000);
    for (let i = 0; i < 4; i++) gater.recordActivity(`peer-${String(i)}`);

    expect(
      gater.reapIdleSlots(),
      "a conversation people are actually having can go quiet for an afternoon. Under maximum " +
        "pressure the right answer is to refuse the next caller, not to tear down a live session — " +
        "the floor is a floor, not a tuning parameter.",
    ).toEqual([]);
    expect(hungUp).toEqual([]);
    expect(gater.slotCount()).toBe(4);
  });

  it("treats a never-used slot's grant time as its activity, so a fresh receiver is not reaped", () => {
    const { gater, hungUp, connected } = makeGater(4);
    for (let i = 0; i < 4; i++) takeSlot(gater, `peer-${String(i)}`, `${String(i)}`.padStart(2, "0").repeat(32), connected);

    // Full table, nothing has ever carried traffic — but every slot was granted moments ago.
    expect(
      gater.reapIdleSlots(),
      "a waiting standing receiver has carried nothing by definition. Reaping one the instant the " +
        "table fills would make a busy relay unusable for every new agent arriving on it.",
    ).toEqual([]);
    expect(hungUp).toEqual([]);
  });

  it("names who was reaped so the relay can tell them, rather than tearing down in silence", () => {
    const { gater, connected } = makeGater(2);
    takeSlot(gater, "peer-quiet", AGENT, connected);
    takeSlot(gater, "peer-busy", "bb".repeat(32), connected);
    vi.advanceTimersByTime(SLOT_REAP_ACTIVITY_FLOOR_MS + 1);
    gater.recordActivity("peer-busy");

    const reaped = gater.reapIdleSlots();
    expect(reaped.map((r) => r.peerId)).toEqual(["peer-quiet"]);
    expect(
      reaped[0]!.agents,
      "the relay is the only party that knows this happened, so the reaper has to hand back WHICH " +
        "agent lost capacity. Without it the notice cannot be addressed to anyone and the teardown " +
        "is silent — which is how 'my agent just stopped working' happens.",
    ).toEqual([AGENT]);
    expect(reaped[0]!.idleMs, "and how long it had been quiet, so the notice can say why").toBeGreaterThan(
      SLOT_REAP_ACTIVITY_FLOOR_MS,
    );
  });

  it("★★★ a peer that authenticated WITHOUT a reservation does not create pressure", () => {
    const { gater, hungUp, connected } = makeGater(4);
    // One real reservation, then three peers that merely dialled in and authenticated — a session
    // node submitting leaves does exactly this and holds no circuit reservation at all.
    takeSlot(gater, "peer-reserved", AGENT, connected);
    for (let i = 0; i < 3; i++) {
      const admission = gater.admitSlot(`peer-dialed-${String(i)}`, `${String(i)}`.padStart(2, "0").repeat(32));
      expect(admission.ok).toBe(true);
    }
    vi.advanceTimersByTime(SLOT_REAP_ACTIVITY_FLOOR_MS + 1);

    expect(
      gater.slotCount(),
      "the reaper measures pressure against libp2p's RESERVATION ceiling. Counting connections that " +
        "hold no reservation made a table of one look like a table of four.",
    ).toBe(1);
    expect(
      gater.reapIdleSlots(),
      "one reservation out of four is not pressure. Counting the dial-ins would have fired the " +
        "reaper here and hung up a peer to free capacity that was never scarce.",
    ).toEqual([]);
    expect(hungUp).toEqual([]);
  });

  it("the pressure line and the ceiling have the values the relay actually runs with", () => {
    expect(
      DEFAULT_SLOT_CEILING,
      "libp2p ships 15, which caused a real outage — fifteen slots vanish immediately in normal " +
        "use. 4096 is ours and is not to be reverted.",
    ).toBe(4096);
    expect(DEFAULT_REAP_PRESSURE_FRACTION).toBeGreaterThan(0.5);
    expect(DEFAULT_REAP_PRESSURE_FRACTION).toBeLessThan(1);
    expect(SLOT_REAP_ACTIVITY_FLOOR_MS).toBe(6 * 60 * 60 * 1000);
  });
});
