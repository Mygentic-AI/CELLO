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
function makeGater(ceiling: number): { gater: RelayConnectionGater; hungUp: string[] } {
  const hungUp: string[] = [];
  const gater = new RelayConnectionGater({
    logger: silentLogger,
    reservationGraceMs: 60_000,
    slotCeiling: ceiling,
  });
  gater.attachNode({
    hangUp: async (id: string) => { hungUp.push(id); },
  } as unknown as Parameters<RelayConnectionGater["attachNode"]>[0]);
  return { gater, hungUp };
}

function takeSlot(gater: RelayConnectionGater, peerId: string, agent = AGENT): void {
  gater.denyInboundRelayReservation(peer(peerId) as never);
  const admission = gater.admitSlot(peerId, agent);
  expect(admission.ok, `precondition: ${peerId} must get a slot`).toBe(true);
  gater.recordAuthenticated(peerId);
}

describe("DOD-M15-RELAYSLOTS-1: the reaper", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("does nothing while the table is not under pressure, however old the slots are", () => {
    const { gater, hungUp } = makeGater(10);
    takeSlot(gater, "peer-ancient");
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
    const { gater, hungUp } = makeGater(8);
    for (let i = 0; i < 8; i++) {
      takeSlot(gater, `peer-${String(i)}`, `${String(i)}`.padStart(2, "0").repeat(32));
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
    const { gater, hungUp } = makeGater(4);
    for (let i = 0; i < 4; i++) takeSlot(gater, `peer-${String(i)}`, `${String(i)}`.padStart(2, "0").repeat(32));

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
    const { gater, hungUp } = makeGater(4);
    for (let i = 0; i < 4; i++) takeSlot(gater, `peer-${String(i)}`, `${String(i)}`.padStart(2, "0").repeat(32));

    // Full table, nothing has ever carried traffic — but every slot was granted moments ago.
    expect(
      gater.reapIdleSlots(),
      "a waiting standing receiver has carried nothing by definition. Reaping one the instant the " +
        "table fills would make a busy relay unusable for every new agent arriving on it.",
    ).toEqual([]);
    expect(hungUp).toEqual([]);
  });

  it("names who was reaped so the relay can tell them, rather than tearing down in silence", () => {
    const { gater } = makeGater(2);
    takeSlot(gater, "peer-quiet", AGENT);
    takeSlot(gater, "peer-busy", "bb".repeat(32));
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
