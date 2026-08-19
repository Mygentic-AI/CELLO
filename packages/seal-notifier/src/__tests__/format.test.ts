/**
 * The notifier's only judgement lives in formatting and throttling, so it is the only part tested
 * hard. The server around it is plumbing.
 *
 * The throttle tests matter more than they look: Andre's constraint was alerting he will not mute,
 * and an alert channel dies the first time it floods.
 */
import { describe, it, expect } from "vitest";
import { formatAlert, Throttle, type LogEntry } from "../format.js";

function entry(payload: Record<string, unknown>, zone = "us-east1-b"): LogEntry {
  return { timestamp: "2026-08-19T14:00:00Z", resource: { labels: { zone } }, jsonPayload: payload };
}

describe("formatAlert — what an operator reads on their phone", () => {
  it("a refused seal says a receipt was LOST, not that one might be", () => {
    const { text } = formatAlert(entry({
      event: "relay.seal.rejected",
      sessionId: "df2a2a0892cfd35973f70016aaf27ece",
      reason: 'connection_lost: The connection muxer is "closed" and not "open"',
    }));
    // The distinction is the whole message. A failed repair is a warning; a refused seal already
    // cost the operator a receipt and both agents are about to report a timeout.
    expect(text).toContain("could NOT be sealed");
    expect(text).toContain("A receipt was lost");
    expect(text).toContain("df2a2a0892cfd35973f70016aaf27ece");
  });

  it("a failed repair says NO receipt is lost yet — it is a warning, not a loss", () => {
    const { text } = formatAlert(entry({
      event: "relay.directory.redial.outcome", recovered: false, peerId: "12D3KooWExample",
    }));
    expect(text).toContain("repair FAILED");
    expect(text).toContain("No receipt lost yet");
  });

  it("names WHICH SIDE the fault is on when the eviction succeeded and the retry still failed", () => {
    const { text } = formatAlert(entry({
      event: "relay.directory.redial.outcome", recovered: false, eviction: "evicted",
    }));
    // This is the line that sends an operator to the right place. Evicted-and-still-failed means
    // the stale handle was NOT the problem — the exact wrong conclusion this whole milestone was
    // built on twice.
    expect(text).toContain("not a stale handle on our side");
  });

  it("says the node is running old code when it could not evict", () => {
    const { text } = formatAlert(entry({
      event: "relay.directory.redial.outcome", recovered: false, eviction: "unavailable",
    }));
    expect(text).toContain("rolled without the fix");
  });

  it("survives a log entry with almost nothing in it", () => {
    // The sink delivers whatever matched. A formatter that throws takes the alert with it.
    const { text, key } = formatAlert({});
    expect(text).toContain("CELLO");
    expect(key.length).toBeGreaterThan(0);
  });

  it("coalesces on the LINK, not the session — else every occurrence is unique", () => {
    const a = formatAlert(entry({ event: "relay.seal.rejected", sessionId: "aaa", peerId: "p1" }));
    const b = formatAlert(entry({ event: "relay.seal.rejected", sessionId: "bbb", peerId: "p1" }));
    // Same link failing twice is ONE problem. Keying on the session would make the cooldown
    // useless, which is how a channel floods and gets muted.
    expect(a.key).toBe(b.key);
  });

  it("does not coalesce across different zones", () => {
    const a = formatAlert(entry({ event: "relay.seal.rejected", peerId: "p1" }, "us-east1-b"));
    const b = formatAlert(entry({ event: "relay.seal.rejected", peerId: "p1" }, "europe-west1-b"));
    expect(a.key).not.toBe(b.key);
  });
});

describe("Throttle — alerting Andre will not mute", () => {
  it("sends the first, suppresses a repeat of the same link inside the cooldown", () => {
    const t = new Throttle({ cooldownMs: 1000, windowMs: 60_000, maxPerWindow: 100 });
    expect(t.decide("k", 0).action).toBe("send");
    expect(t.decide("k", 500).action).toBe("suppress");
    expect(t.decide("k", 1500).action).toBe("send");
  });

  it("does not let one noisy link silence a different one", () => {
    const t = new Throttle({ cooldownMs: 10_000, windowMs: 60_000, maxPerWindow: 100 });
    expect(t.decide("link-a", 0).action).toBe("send");
    expect(t.decide("link-a", 100).action).toBe("suppress");
    // A second link failing is new information and must get through.
    expect(t.decide("link-b", 200).action).toBe("send");
  });

  it("caps a fleet-wide storm and SAYS it is holding messages back", () => {
    const t = new Throttle({ cooldownMs: 0, windowMs: 60_000, maxPerWindow: 2 });
    expect(t.decide("a", 0).action).toBe("send");
    expect(t.decide("b", 1).action).toBe("send");

    const third = t.decide("c", 2);
    // A NOTICE, not silence. Dropping the rest quietly would make a fleet-wide outage look
    // quieter than a single bad link — the failure that teaches people to distrust a channel.
    expect(third.action).toBe("notice");
    if (third.action !== "notice") throw new Error("unreachable");
    expect(third.text).toContain("flood suppressed");
    expect(third.text).toContain("fleet-wide");

    // and only ONE notice per window, or the suppression itself becomes the flood
    expect(t.decide("d", 3).action).toBe("suppress");
    expect(t.decide("e", 4).action).toBe("suppress");
  });

  it("recovers when the window rolls, so a bad hour does not silence the next one", () => {
    const t = new Throttle({ cooldownMs: 0, windowMs: 1000, maxPerWindow: 1 });
    expect(t.decide("a", 0).action).toBe("send");
    expect(t.decide("b", 10).action).toBe("notice");
    expect(t.decide("c", 20).action).toBe("suppress");
    // New window — alerting must come back on its own. A throttle that latches is an outage.
    expect(t.decide("d", 1100).action).toBe("send");
  });
});
