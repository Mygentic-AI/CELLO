/**
 * DOD-M15-RELAYSLOTS-1 clause 0 — **CAN AN ATTACKER STILL HOLD SLOTS?** The order's title, tested
 * as a question about occupancy rather than about refusals.
 *
 * ─── The history this file exists to keep from repeating ──────────────────────────────────────
 *
 * Three versions of this unit shipped a check that was correct and a headline that was false.
 *
 *  1. The token was verified on CELLO's own auth stream, AFTER the slot was granted — because
 *     libp2p's reservation hook is handed a peer id and nothing else, and the client had not sent a
 *     token yet. An attacker who never opened an auth stream never met the check. Every refusal the
 *     relay logged was correct; one machine held the whole table.
 *  2. Refusing past an unproven budget. Once the budget was full every new reservation was refused,
 *     including every honest agent's, so denying the relay got eight times cheaper.
 *  3. Evicting the oldest unproven slot instead. An attacker's slots churn and stay young; an
 *     honest agent's sits still through its handshake and became the oldest thing in the table.
 *
 * Each was a guess about who LOOKED bad, because an IP address was the only thing visible at
 * reservation time. A botnet walks through guesses.
 *
 * ─── What is tested now ───────────────────────────────────────────────────────────────────────
 *
 * The client authenticates BEFORE it asks for a slot, so this hook can ask a question of fact:
 * has this peer proved it belongs to a registered agent? Everything below measures what an
 * attacker ENDS UP HOLDING — never how many refusals were produced, because refusal counts were
 * green through all three failures above.
 */
import { describe, it, expect } from "vitest";
import { RelayConnectionGater, SLOT_CAP_PER_AGENT } from "../relay-connection-gater.js";
import type { Logger } from "@cello-protocol/interfaces";

const silentLogger: Logger = { debug() {}, info() {}, warn() {}, error() {} };

function peer(id: string): { toString(): string } {
  return { toString: () => id };
}

/**
 * ⚠️ THE CONNECTION LIST MUST BE HONEST. The gater's reclaim backstop frees a traffic-free slot
 * whose peer is no longer connected, so a fake reporting an empty connection list tells it every
 * peer on earth has gone — and it dutifully reclaims each agent's slots as fast as they are made.
 * That is a lying fixture, not a defect, and it cost a confusing failure before being spotted.
 */
function makeGater(): {
  gater: RelayConnectionGater;
  connected: Set<string>;
  reserve: (peerId: string) => boolean;
} {
  const connected = new Set<string>();
  const gater = new RelayConnectionGater({ logger: silentLogger });
  gater.attachNode({
    hangUp: async (id: string) => { connected.delete(id); },
    getConnections: () => [...connected].map((peerId) => ({ peerId })),
    releaseRelayReservation: () => true,
  } as unknown as Parameters<RelayConnectionGater["attachNode"]>[0]);
  return {
    gater,
    connected,
    // libp2p's hook: `true` DENIES. A granted slot is `deny === false`.
    reserve: (peerId) => {
      connected.add(peerId);
      return gater.denyInboundRelayReservation(peer(peerId) as never) === false;
    },
  };
}

/** What a real client does: dial, prove itself, then ask for the slot. */
function proveThenReserve(
  gater: RelayConnectionGater,
  peerId: string,
  agent: string,
  connected: Set<string>,
): boolean {
  connected.add(peerId);
  if (!gater.admitSlot(peerId, agent).ok) return false;
  gater.recordAuthenticated(peerId);
  return gater.denyInboundRelayReservation(peer(peerId) as never) === false;
}

describe("DOD-M15-RELAYSLOTS-1 clause 0: an attacker cannot hold reservation slots", () => {
  it("★★★ one machine minting throwaway keys holds NOTHING", () => {
    const { gater, reserve } = makeGater();

    // 4096 throwaway keypairs, the whole ceiling. None can obtain a directory token, so none
    // authenticates — which is exactly what the attack looks like, and exactly what it cannot fake.
    let granted = 0;
    for (let i = 0; i < 4096; i++) {
      if (reserve(`attacker-${String(i)}`)) granted++;
    }

    expect(
      granted,
      "this is the assertion three versions of this unit could not make. Refusals were correct " +
        "every time and the attacker held the table anyway, because the slot was handed over " +
        "before anything was asked.",
    ).toBe(0);
    expect(gater.slotCount()).toBe(0);
  });

  it("★★★ a botnet with unlimited addresses holds NOTHING either", () => {
    const { gater, reserve } = makeGater();

    // The shape that defeated every address-based heuristic: one key, one address, thousands of
    // them. It defeats nothing now, because the gate does not look at addresses at all.
    for (let i = 0; i < 4096; i++) reserve(`bot-${String(i)}`);

    expect(
      gater.slotCount(),
      "the previous bounds were guesses about which SOURCE looked bad. A botnet has as many " +
        "sources as it likes; what it does not have is a registered agent.",
    ).toBe(0);
  });

  it("★★★ a real agent that proves itself first gets its slot", () => {
    const { gater, connected } = makeGater();
    expect(
      proveThenReserve(gater, "honest", "ee".repeat(32), connected),
      "refusing here would be the outage this whole order exists to avoid — the gate is only safe " +
        "because the client authenticates before it asks.",
    ).toBe(true);
    expect(gater.slotCount()).toBe(1);
  });

  it("a flood cannot crowd out a real agent, because it never occupies anything", () => {
    const { gater, reserve, connected } = makeGater();
    for (let i = 0; i < 4096; i++) reserve(`flood-${String(i)}`);

    expect(proveThenReserve(gater, "honest", "ee".repeat(32), connected)).toBe(true);
    expect(gater.slotCount()).toBe(1);
  });

  it("★★★ a REGISTERED agent is still bounded — one identity cannot take the table", () => {
    const { gater, connected } = makeGater();
    const AGENT = "aa".repeat(32);

    let held = 0;
    for (let i = 0; i < SLOT_CAP_PER_AGENT + 20; i++) {
      if (proveThenReserve(gater, `peer-${String(i)}`, AGENT, connected)) held++;
    }

    expect(
      held,
      "the token proves WHO you are, not that you may have everything. The per-agent cap is now " +
        "enforced at the door, because the relay knows which agent is asking before it grants.",
    ).toBe(SLOT_CAP_PER_AGENT);
    expect(gater.slotCount()).toBe(SLOT_CAP_PER_AGENT);
  });

  it("one agent's cap is not spent by another's slots", () => {
    const { gater, connected } = makeGater();
    for (let i = 0; i < SLOT_CAP_PER_AGENT; i++) {
      proveThenReserve(gater, `a-${String(i)}`, "aa".repeat(32), connected);
    }
    expect(proveThenReserve(gater, "b-0", "bb".repeat(32), connected)).toBe(true);
  });
});
