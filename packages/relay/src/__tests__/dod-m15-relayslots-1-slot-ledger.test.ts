/**
 * DOD-M15-RELAYSLOTS-1 (part 2) — the slot ledger: what an agent may hold, and what it must give up.
 *
 * ─── Why a token is not enough ────────────────────────────────────────────────────────────────
 *
 * Part 1 stops an UNREGISTERED key from taking a reservation slot. It does nothing about a
 * REGISTERED one taking too many, and that hole is wide enough to drive the same attack through:
 * register two agents you own, open sessions between them, and take the table with slots that every
 * "is this slot in use" test would call legitimate.
 *
 * The token is also what makes the rest possible. Before it, the relay knew only transport peer ids,
 * and those change on every daemon restart — which is why a restart consumed a fresh slot and
 * stranded its old one for the full TTL rather than reclaiming it. The relay could not tell it was
 * the same agent. Once a slot is attributable to a directory-signed agent key, "this agent already
 * holds an unused slot" and "this agent holds too many" become answerable questions.
 *
 * ─── The ordering that is the safety property ─────────────────────────────────────────────────
 *
 * Every outage in this area came from refusing too eagerly, never from refusing too little, and the
 * relay's view of what is "in use" is imperfect by construction. So the ledger RECLAIMS before it
 * REFUSES: a counting mistake then costs an idle slot instead of costing a real agent its front
 * door. When it cannot tell whether a slot is in use, it treats it as in use.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { RelayConnectionGater, SLOT_CAP_PER_AGENT, SLOT_RECLAIM_MIN_IDLE_MS } from "../relay-connection-gater.js";
import type { Logger } from "@cello-protocol/interfaces";

const silentLogger: Logger = { debug() {}, info() {}, warn() {}, error() {} };

/** A stand-in for the libp2p PeerId the gater is handed — only `toString()` is ever used. */
function peer(id: string): { toString(): string } {
  return { toString: () => id };
}

const AGENT_A = "aa".repeat(32);
const AGENT_B = "bb".repeat(32);

function makeGater(opts: { hangUp?: (id: string) => Promise<void> } = {}): {
  gater: RelayConnectionGater;
  hungUp: string[];
} {
  const hungUp: string[] = [];
  const gater = new RelayConnectionGater({ logger: silentLogger, reservationGraceMs: 60_000 });
  gater.attachNode({
    hangUp: async (id: string) => {
      hungUp.push(id);
      await opts.hangUp?.(id);
    },
  } as unknown as Parameters<RelayConnectionGater["attachNode"]>[0]);
  return { gater, hungUp };
}

/**
 * Reserve, then authenticate — the exact sequence the relay performs, `recordAuthenticated`
 * included.
 *
 * ⚠️ That last call is not decoration. Without it the grace-window revoke timer stays armed, and any
 * test that advances the clock past it has all its slots hung up by the timer rather than by the
 * rule under test. Two assertions here failed that way first, and the reported cause — thirty-two
 * slots released instead of one — pointed at the ledger, not at the fixture.
 */
function takeSlot(gater: RelayConnectionGater, peerId: string, agent: string): ReturnType<RelayConnectionGater["admitSlot"]> {
  gater.denyInboundRelayReservation(peer(peerId) as never);
  const admission = gater.admitSlot(peerId, agent);
  if (admission.ok) gater.recordAuthenticated(peerId);
  return admission;
}

describe("DOD-M15-RELAYSLOTS-1: the slot ledger", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("attributes a slot to the agent key the token named, not to the transport peer id", () => {
    const { gater } = makeGater();
    expect(takeSlot(gater, "peer-1", AGENT_A).ok).toBe(true);
    expect(gater.slotCountForAgent(AGENT_A)).toBe(1);
    expect(gater.slotCountForAgent(AGENT_B)).toBe(0);
  });

  it("★★★ a long-stranded slot is REUSED rather than held for the full TTL", () => {
    const { gater, hungUp } = makeGater();
    expect(takeSlot(gater, "peer-before-restart", AGENT_A).ok).toBe(true);

    // Long enough that this cannot be a receiver the same agent created moments ago — the
    // distinction `SLOT_RECLAIM_MIN_IDLE_MS` exists to draw.
    vi.advanceTimersByTime(SLOT_RECLAIM_MIN_IDLE_MS + 1);

    // The daemon restarted and its half-open connection was never torn down, so the disconnect path
    // never fired. Its libp2p peer id is regenerated, which is exactly why — before the token — the
    // relay could not tell this was the same agent.
    expect(takeSlot(gater, "peer-after-restart", AGENT_A).ok).toBe(true);

    expect(
      gater.slotCountForAgent(AGENT_A),
      "the old slot had never carried a byte of traffic and its holder is long gone. Holding it for " +
        "its full TTL is what made fifteen slots vanish in normal use and caused a real outage.",
    ).toBe(1);
    expect(hungUp).toEqual(["peer-before-restart"]);
  });

  it("★★★ a receiver promoted MOMENTS ago is NOT reclaimed when its replacement authenticates", () => {
    const { gater, hungUp } = makeGater();
    expect(takeSlot(gater, "peer-promoted", AGENT_A).ok).toBe(true);

    // The client builds a replacement standing receiver the instant the first one is promoted into
    // a session. At this point the promoted one has carried nothing yet — it is about to.
    expect(takeSlot(gater, "peer-replacement", AGENT_A).ok).toBe(true);

    expect(
      hungUp,
      "reclaiming on 'never carried traffic' alone hung up the promoted receiver here, and its " +
        "counterparty's messages were then delivered to a node that was no longer connected. " +
        "Nothing about that rule looked wrong; an existing test is what caught it.",
    ).toEqual([]);
    expect(gater.slotCountForAgent(AGENT_A)).toBe(2);
  });

  it("does NOT reclaim a slot that has carried traffic — a live conversation is not spare capacity", () => {
    const { gater, hungUp } = makeGater();
    expect(takeSlot(gater, "peer-live", AGENT_A).ok).toBe(true);
    gater.recordActivity("peer-live");

    expect(takeSlot(gater, "peer-replacement", AGENT_A).ok).toBe(true);

    expect(
      gater.slotCountForAgent(AGENT_A),
      "an agent legitimately holds one slot per live conversation plus one waiting — the promoted " +
        "receiver and the replacement built behind it.",
    ).toBe(2);
    expect(hungUp).toEqual([]);
  });

  it("★★★ refuses past the per-agent cap, and says which cap and what is being held", () => {
    const { gater } = makeGater();
    for (let i = 0; i < SLOT_CAP_PER_AGENT; i++) {
      const r = takeSlot(gater, `peer-${String(i)}`, AGENT_A);
      expect(r.ok, `slot ${String(i)} must be granted — the cap is ${String(SLOT_CAP_PER_AGENT)}`).toBe(true);
      // Traffic on every one, so none is reclaimable and the cap is what does the refusing.
      gater.recordActivity(`peer-${String(i)}`);
    }

    const refused = takeSlot(gater, "peer-one-too-many", AGENT_A);
    expect(refused.ok).toBe(false);
    if (refused.ok || refused.reason !== "slot_cap_exceeded") {
      expect.fail(`expected slot_cap_exceeded, got ${refused.ok ? "ok" : refused.reason}`);
    }
    expect(
      refused.held,
      "people do not know what sessions they have open. A refusal that does not show the state it " +
        "is refusing on is a dead end, and reads as the product being broken.",
    ).toBe(SLOT_CAP_PER_AGENT);
    expect(refused.cap).toBe(SLOT_CAP_PER_AGENT);
  });

  it("★★★ reclaims before it refuses — an idle slot is freed rather than the caller being turned away", () => {
    const { gater, hungUp } = makeGater();
    for (let i = 0; i < SLOT_CAP_PER_AGENT; i++) {
      expect(takeSlot(gater, `peer-${String(i)}`, AGENT_A).ok).toBe(true);
      // All but ONE carry traffic. The quiet one is reclaimable.
      if (i !== 3) gater.recordActivity(`peer-${String(i)}`);
    }
    // Past the reclaim floor, so the quiet slot is old enough to be someone's leftover rather than
    // a receiver this agent created seconds ago.
    vi.advanceTimersByTime(SLOT_RECLAIM_MIN_IDLE_MS + 1);

    const admitted = takeSlot(gater, "peer-new", AGENT_A);
    expect(
      admitted.ok,
      "refusing here would cost a real agent its front door to save a slot nothing was using. " +
        "Every outage in this area came from refusing too eagerly.",
    ).toBe(true);
    expect(hungUp).toEqual(["peer-3"]);
    expect(gater.slotCountForAgent(AGENT_A)).toBe(SLOT_CAP_PER_AGENT);
  });

  it("one agent's cap is not spent by another's slots", () => {
    const { gater } = makeGater();
    for (let i = 0; i < SLOT_CAP_PER_AGENT; i++) {
      expect(takeSlot(gater, `a-${String(i)}`, AGENT_A).ok).toBe(true);
      gater.recordActivity(`a-${String(i)}`);
    }
    expect(takeSlot(gater, "b-0", AGENT_B).ok).toBe(true);
  });

  it("★★★ a disconnect frees the slot immediately — it is not held for the full TTL", () => {
    const { gater } = makeGater();
    expect(takeSlot(gater, "peer-1", AGENT_A).ok).toBe(true);
    gater.recordActivity("peer-1");
    expect(gater.slotCountForAgent(AGENT_A)).toBe(1);

    gater.recordDisconnect("peer-1");

    expect(
      gater.slotCountForAgent(AGENT_A),
      "the peer is gone. Counting its slot until the reservation TTL expires is how an agent that " +
        "restarts a few times runs out of its own cap.",
    ).toBe(0);
  });

  it("re-authenticating on the SAME peer id does not double-count", () => {
    const { gater } = makeGater();
    expect(takeSlot(gater, "peer-1", AGENT_A).ok).toBe(true);
    gater.recordActivity("peer-1");
    expect(gater.admitSlot("peer-1", AGENT_A).ok).toBe(true);
    expect(gater.slotCountForAgent(AGENT_A)).toBe(1);
  });

  it("two agents over ONE connection are each charged for it, and neither can reclaim it from under the other", () => {
    const { gater, hungUp } = makeGater();
    expect(takeSlot(gater, "peer-shared", AGENT_A).ok).toBe(true);
    expect(gater.admitSlot("peer-shared", AGENT_B).ok).toBe(true);

    expect(
      gater.slotCountForAgent(AGENT_A),
      "nothing in the protocol says one connection carries one agent, and two existing rate-limit " +
        "tests use exactly this shape to isolate the peer axis from the pubkey axis. Charging both " +
        "is honest and is the conservative direction — each is counted for capacity it can reach through.",
    ).toBe(1);
    expect(gater.slotCountForAgent(AGENT_B)).toBe(1);

    // A's new reservation must not release a slot B is also reachable through.
    vi.advanceTimersByTime(SLOT_RECLAIM_MIN_IDLE_MS + 1);
    expect(takeSlot(gater, "peer-a-new", AGENT_A).ok).toBe(true);
    expect(hungUp, "releasing the shared slot would strand B, which had nothing to do with it").toEqual([]);
  });
});
