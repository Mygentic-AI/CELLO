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

/** Far past any age floor — the ordinary life of a standing receiver waiting for its first call. */
const SLOT_REAP_HOURS_LATER_MS = 8 * 60 * 60 * 1000;

const AGENT_A = "aa".repeat(32);
const AGENT_B = "bb".repeat(32);

/**
 * `connected` is the set of peers the relay's libp2p node still holds a connection to. It is not
 * decoration: review measured that the reclaim rule's age floor cannot tell a stranded leftover from
 * a receiver that simply waited a long time for its first caller, and connectedness is the question
 * that can. A gater whose node reports no connections is a gater that thinks every peer has gone.
 */
function makeGater(opts: { connected?: Set<string> } = {}): {
  gater: RelayConnectionGater;
  hungUp: string[];
  connected: Set<string>;
} {
  const hungUp: string[] = [];
  const connected = opts.connected ?? new Set<string>();
  const gater = new RelayConnectionGater({ logger: silentLogger, reservationGraceMs: 60_000 });
  gater.attachNode({
    hangUp: async (id: string) => {
      hungUp.push(id);
      connected.delete(id);
    },
    getConnections: () => [...connected].map((peerId) => ({ peerId })),
  } as unknown as Parameters<RelayConnectionGater["attachNode"]>[0]);
  return { gater, hungUp, connected };
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
function takeSlot(
  gater: RelayConnectionGater,
  peerId: string,
  agent: string,
  connected?: Set<string>,
): ReturnType<RelayConnectionGater["admitSlot"]> {
  connected?.add(peerId);
  gater.denyInboundRelayReservation(peer(peerId) as never);
  const admission = gater.admitSlot(peerId, agent);
  if (admission.ok) gater.recordAuthenticated(peerId);
  return admission;
}

describe("DOD-M15-RELAYSLOTS-1: the slot ledger", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("attributes a slot to the agent key the token named, not to the transport peer id", () => {
    const { gater, connected } = makeGater();
    expect(takeSlot(gater, "peer-1", AGENT_A, connected).ok).toBe(true);
    expect(gater.slotCountForAgent(AGENT_A)).toBe(1);
    expect(gater.slotCountForAgent(AGENT_B)).toBe(0);
  });

  it("★★★ a slot whose peer is GONE is reused rather than held for the full TTL", () => {
    const { gater, hungUp, connected } = makeGater();
    expect(takeSlot(gater, "peer-before-restart", AGENT_A, connected).ok).toBe(true);
    vi.advanceTimersByTime(SLOT_RECLAIM_MIN_IDLE_MS + 1);

    // The daemon restarted and the relay never observed the close — a half-open connection, which
    // is the only case this rule exists for. Its libp2p peer id is regenerated, which is exactly
    // why, before the token, the relay could not tell this was the same agent.
    connected.delete("peer-before-restart");
    expect(takeSlot(gater, "peer-after-restart", AGENT_A, connected).ok).toBe(true);

    expect(
      gater.slotCountForAgent(AGENT_A),
      "the old slot had never carried a byte of traffic and its holder is gone. Holding it for its " +
        "full TTL is what made fifteen slots vanish in normal use and caused a real outage.",
    ).toBe(1);
    expect(hungUp).toEqual(["peer-before-restart"]);
  });

  it("★★★ a receiver that WAITED HOURS for its first caller is not reclaimed when promoted", () => {
    const { gater, hungUp, connected } = makeGater();
    expect(takeSlot(gater, "peer-promoted", AGENT_A, connected).ok).toBe(true);

    /**
     * ⚠️ THE PRODUCTION SEQUENCE, and the one the first version of this test missed.
     *
     * It said "promoted MOMENTS ago" and advanced no clock, so it only ever exercised the window
     * inside the age floor — and passed against a rule that hangs up the promoted receiver in every
     * ordinary case. A standing receiver normally waits a long time before anyone calls: it is
     * older than any age floor, and it has still carried nothing, because being promoted is not
     * traffic. Review measured this; the fix is that the guard asks whether the peer is still
     * CONNECTED, which it plainly is.
     */
    vi.advanceTimersByTime(SLOT_REAP_HOURS_LATER_MS);

    // Someone finally calls. The client promotes this receiver and immediately builds a replacement
    // behind it, which authenticates to the same relay.
    expect(takeSlot(gater, "peer-replacement", AGENT_A, connected).ok).toBe(true);

    expect(
      hungUp,
      "hanging up here kills the conversation that has just started, and from the agent's side it " +
        "is indistinguishable from the network dropping.",
    ).toEqual([]);
    expect(gater.slotCountForAgent(AGENT_A)).toBe(2);
  });

  it("does NOT reclaim a slot that has carried traffic — a live conversation is not spare capacity", () => {
    const { gater, hungUp, connected } = makeGater();
    expect(takeSlot(gater, "peer-live", AGENT_A, connected).ok).toBe(true);
    gater.recordActivity("peer-live");

    expect(takeSlot(gater, "peer-replacement", AGENT_A, connected).ok).toBe(true);

    expect(
      gater.slotCountForAgent(AGENT_A),
      "an agent legitimately holds one slot per live conversation plus one waiting — the promoted " +
        "receiver and the replacement built behind it.",
    ).toBe(2);
    expect(hungUp).toEqual([]);
  });

  it("★★★ refuses past the per-agent cap, and says which cap and what is being held", () => {
    const { gater, connected } = makeGater();
    for (let i = 0; i < SLOT_CAP_PER_AGENT; i++) {
      const r = takeSlot(gater, `peer-${String(i)}`, AGENT_A, connected);
      expect(r.ok, `slot ${String(i)} must be granted — the cap is ${String(SLOT_CAP_PER_AGENT)}`).toBe(true);
      // Traffic on every one, so none is reclaimable and the cap is what does the refusing.
      gater.recordActivity(`peer-${String(i)}`);
    }

    const refused = takeSlot(gater, "peer-one-too-many", AGENT_A, connected);
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
    const { gater, hungUp, connected } = makeGater();
    for (let i = 0; i < SLOT_CAP_PER_AGENT; i++) {
      expect(takeSlot(gater, `peer-${String(i)}`, AGENT_A, connected).ok).toBe(true);
      // All but ONE carry traffic.
      if (i !== 3) gater.recordActivity(`peer-${String(i)}`);
    }
    vi.advanceTimersByTime(SLOT_RECLAIM_MIN_IDLE_MS + 1);
    /**
     * And the quiet one's peer is GONE — a connection the relay never saw close, which is the only
     * thing this rule is for. A quiet peer that is still CONNECTED is a standing receiver waiting
     * for a caller, and reclaiming that is what killed a live conversation before review caught it.
     */
    connected.delete("peer-3");

    const admitted = takeSlot(gater, "peer-new", AGENT_A, connected);
    expect(
      admitted.ok,
      "refusing here would cost a real agent its front door to save a slot nothing was using. " +
        "Every outage in this area came from refusing too eagerly.",
    ).toBe(true);
    expect(hungUp).toEqual(["peer-3"]);
    expect(gater.slotCountForAgent(AGENT_A)).toBe(SLOT_CAP_PER_AGENT);
  });

  it("one agent's cap is not spent by another's slots", () => {
    const { gater, connected } = makeGater();
    for (let i = 0; i < SLOT_CAP_PER_AGENT; i++) {
      expect(takeSlot(gater, `a-${String(i)}`, AGENT_A, connected).ok).toBe(true);
      gater.recordActivity(`a-${String(i)}`);
    }
    expect(takeSlot(gater, "b-0", AGENT_B, connected).ok).toBe(true);
  });

  it("★★★ a disconnect frees the slot immediately — it is not held for the full TTL", () => {
    const { gater, connected } = makeGater();
    expect(takeSlot(gater, "peer-1", AGENT_A, connected).ok).toBe(true);
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
    const { gater, connected } = makeGater();
    expect(takeSlot(gater, "peer-1", AGENT_A, connected).ok).toBe(true);
    gater.recordActivity("peer-1");
    expect(gater.admitSlot("peer-1", AGENT_A).ok).toBe(true);
    expect(gater.slotCountForAgent(AGENT_A)).toBe(1);
  });

  it("two agents over ONE connection are each charged for it, and neither can reclaim it from under the other", () => {
    const { gater, hungUp, connected } = makeGater();
    expect(takeSlot(gater, "peer-shared", AGENT_A, connected).ok).toBe(true);
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
    expect(takeSlot(gater, "peer-a-new", AGENT_A, connected).ok).toBe(true);
    expect(hungUp, "releasing the shared slot would strand B, which had nothing to do with it").toEqual([]);
  });
});
