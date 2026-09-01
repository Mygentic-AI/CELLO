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
import { describe, it, expect, vi } from "vitest";
import { RelayConnectionGater, SLOT_CAP_PER_AGENT, PROVEN_PEER_MEMORY_MS } from "../relay-connection-gater.js";
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

/**
 * What a real client does: dial, authenticate WITH A RESERVATION AS THE STATED PURPOSE, then ask
 * for the slot. The third argument is that purpose, and it is not decoration — an auth that does
 * not name a reservation (a session node submitting a leaf) creates a ledger entry too, and the
 * gate must not grant on one.
 */
function proveThenReserve(
  gater: RelayConnectionGater,
  peerId: string,
  agent: string,
  connected: Set<string>,
): boolean {
  connected.add(peerId);
  if (!gater.admitSlot(peerId, agent, true).ok) return false;
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

  it("★★★ the proof survives the reconnect the client has to make, and only briefly", () => {
    const { gater, reserve, connected } = makeGater();
    const AGENT = "dd".repeat(32);

    // Connection one: the client proves itself and goes. This is forced, not a design choice — a
    // reservation taken on the same connection as the proof yields a slot with no dialable address.
    connected.add("receiver");
    expect(gater.admitSlot("receiver", AGENT, true).ok).toBe(true);
    gater.recordDisconnect("receiver");
    expect(gater.slotCount(), "nothing is held across the gap").toBe(0);

    // Connection two: same transport identity, and this one reserves.
    expect(
      reserve("receiver"),
      "if the proof did not survive the disconnect, a real agent could never get a reservation at " +
        "all — the gate would refuse everyone, which is exactly the outage the review caught.",
    ).toBe(true);
    expect(gater.slotCount()).toBe(1);
    expect(gater.agentsForSlot("receiver")).toEqual([AGENT]);
  });

  it("★★★ a proof does NOT last — a peer id cannot reserve forever on one old handshake", () => {
    vi.useFakeTimers();
    try {
      const { gater, reserve, connected } = makeGater();
      connected.add("stale");
      expect(gater.admitSlot("stale", "dd".repeat(32), true).ok).toBe(true);
      gater.recordDisconnect("stale");

      vi.advanceTimersByTime(PROVEN_PEER_MEMORY_MS + 1);

      expect(
        reserve("stale"),
        "a proof that never expires is a standing licence to reserve without proving, which is the " +
          "thing this gate exists to withhold.",
      ).toBe(false);
      expect(gater.slotCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("★★★ a registered agent that proves EVERYTHING FIRST is still capped — the attacker's ordering", () => {
    const { gater, connected } = makeGater();
    const AGENT = "cc".repeat(32);
    const N = SLOT_CAP_PER_AGENT + 20;

    /**
     * ⚠️ THIS ORDERING IS THE POINT, and the review found nothing testing it. Every other cap test
     * in this suite interleaves — prove one, reserve one, prove the next — so `admitSlot`'s cap
     * trips first and the cap inside the gate is never reached. Delete that check from
     * `denyInboundRelayReservation` and every one of those tests stays green.
     *
     * It is not redundant, because the two checks count the same population: RESERVATIONS. An
     * attacker who proves all N peer ids BEFORE reserving on any of them passes every `admitSlot`
     * with a held count of zero, and the gate is then the only thing left standing between one
     * registered agent and the whole table.
     */
    const peers: string[] = [];
    for (let i = 0; i < N; i++) {
      const id = `preproved-${String(i)}`;
      connected.add(id);
      expect(gater.admitSlot(id, AGENT, true).ok, "every proof is accepted — none holds a slot yet").toBe(true);
      peers.push(id);
    }

    let held = 0;
    for (const id of peers) {
      if (gater.denyInboundRelayReservation(peer(id) as never) === false) held++;
    }

    expect(held, "the gate's own cap is the only check this ordering reaches").toBe(SLOT_CAP_PER_AGENT);
    expect(gater.slotCount()).toBe(SLOT_CAP_PER_AGENT);
  });

  it("★★★ authenticating is not asking — a delivery auth does not license a reservation", () => {
    const { gater, connected } = makeGater();
    const AGENT = "ff".repeat(32);

    /**
     * A session node dials in to submit a seal leaf. That is a real, registered, fully authenticated
     * peer — and it has no business holding a circuit reservation. `admitSlot` still records it,
     * because the relay does want it counted and attributed; what it must not do is satisfy the
     * gate. Before `provenForReservation` existed, the ledger entry alone was enough and this peer
     * would have been granted.
     */
    connected.add("session-node");
    expect(gater.admitSlot("session-node", AGENT, false).ok).toBe(true);
    expect(gater.agentsForSlot("session-node"), "it IS in the ledger").toEqual([AGENT]);

    expect(
      gater.denyInboundRelayReservation(peer("session-node") as never),
      "authenticated, registered, attributed — and still refused, because it never said it wanted a slot",
    ).toBe(true);
    expect(gater.slotCount()).toBe(0);
  });

  it("a slow client is told its proof EXPIRED, not that it is a stranger", () => {
    vi.useFakeTimers();
    try {
      const lines: Array<{ event: string; fields: Record<string, unknown> }> = [];
      const connected = new Set<string>();
      const gater = new RelayConnectionGater({
        logger: {
          debug(event: string, fields?: Record<string, unknown>) { lines.push({ event, fields: fields ?? {} }); },
          info() {}, warn(event: string, fields?: Record<string, unknown>) { lines.push({ event, fields: fields ?? {} }); }, error() {},
        } as unknown as Logger,
      });
      gater.attachNode({
        hangUp: async () => {}, getConnections: () => [...connected].map((peerId) => ({ peerId })),
        releaseRelayReservation: () => true,
      } as unknown as Parameters<RelayConnectionGater["attachNode"]>[0]);

      connected.add("slowpoke");
      gater.admitSlot("slowpoke", "ab".repeat(32), true);
      gater.recordDisconnect("slowpoke");
      vi.advanceTimersByTime(PROVEN_PEER_MEMORY_MS + 1);
      gater.denyInboundRelayReservation(peer("slowpoke") as never);

      /**
       * The return value is identical either way — delete the whole expired branch and every other
       * test stays green, which is why this one exists. What differs is what the operator is told.
       * "You are not a registered agent" sends someone to check their registration; the truth is
       * that their two connections were minutes apart, and only this line says so.
       */
      const denial = lines.find((l) => l.event === "relay.reservation.denied");
      expect(denial?.fields["reason"], "an expired proof must not be reported as an unknown peer").toBe("proof_expired");
    } finally {
      vi.useRealTimers();
    }
  });

  it("the ordinary refuse-then-prove round trip is NOT logged as an attack", () => {
    const lines: Array<{ level: string; event: string; fields: Record<string, unknown> }> = [];
    const connected = new Set<string>();
    const rec = (level: string) => (event: string, fields?: Record<string, unknown>) => {
      lines.push({ level, event, fields: fields ?? {} });
    };
    const gater = new RelayConnectionGater({
      logger: { debug: rec("debug"), info: rec("info"), warn: rec("warn"), error: rec("error") } as unknown as Logger,
    });
    gater.attachNode({
      hangUp: async () => {}, getConnections: () => [...connected].map((peerId) => ({ peerId })),
      releaseRelayReservation: () => true,
    } as unknown as Parameters<RelayConnectionGater["attachNode"]>[0]);

    // Every honest receiver does exactly this, on every relay candidate, on every build.
    connected.add("honest");
    gater.denyInboundRelayReservation(peer("honest") as never);

    expect(
      lines.filter((l) => l.level === "warn" && l.event === "relay.reservation.denied"),
      "this is the designed happy path. Logged at WARN it becomes the highest-volume warning on " +
        "the relay, and an operator counting warnings to spot a flood is counting their own agents.",
    ).toEqual([]);
    expect(lines.filter((l) => l.level === "debug" && l.event === "relay.reservation.denied")).toHaveLength(1);

    // Asking a SECOND time without proving in between is the shape that means something.
    gater.denyInboundRelayReservation(peer("honest") as never);
    const warned = lines.filter((l) => l.level === "warn" && l.event === "relay.reservation.denied");
    expect(warned).toHaveLength(1);
    expect(warned[0]?.fields["asksWithoutProving"]).toBe(2);
  });

  it("one agent's cap is not spent by another's slots", () => {
    const { gater, connected } = makeGater();
    for (let i = 0; i < SLOT_CAP_PER_AGENT; i++) {
      proveThenReserve(gater, `a-${String(i)}`, "aa".repeat(32), connected);
    }
    expect(proveThenReserve(gater, "b-0", "bb".repeat(32), connected)).toBe(true);
  });
});
